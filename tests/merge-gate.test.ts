import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { scanLines } from '../src/merge-gate/api.ts';
import { canonicalJson, sha256Canonical, sha256Hex } from '../src/merge-gate/canon.ts';
import { main } from '../src/merge-gate/cli.ts';
import { decide, validateEvidence, type Evidence } from '../src/merge-gate/decide.ts';
import { parseManifest, type ManifestKind } from '../src/merge-gate/deps.ts';
import { parseUnified, unquoteGitPath } from '../src/merge-gate/diff.ts';
import { GateError } from '../src/merge-gate/errors.ts';
import { assertArgvAllowed, buildChildEnv } from '../src/merge-gate/exec.ts';
import { matchGlob } from '../src/merge-gate/glob.ts';
import {
  API_RULES,
  COLLECTOR_FINGERPRINTS,
  COLLECTOR_VERSION,
  DEFAULT_POLICY,
  ERROR_CODES,
  GATE_FINGERPRINTS,
  GATE_VERSION,
  GH_FIELDS,
  REASON_REGISTRY,
  hashCollectorTables,
  hashGateTables,
  type Policy,
} from '../src/merge-gate/registry.ts';
import { readVerdictLog, writeEvidence } from '../src/merge-gate/store.ts';
import { makeBaseTmp } from './helpers/fixture-repo.ts';

// Test JSON is read loosely; the shapes under test are asserted field by field.
// biome-ignore lint: test-only escape hatch
type J = any;

const ROOT = join(import.meta.dir, '..');
const BIN = join(ROOT, 'bin/merge-gate');
const BUN = process.execPath;
const REAL_GIT = Bun.which('git') ?? '/usr/bin/git';
const DATES = { GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z' };
const NOW = '2020-01-02T00:00:00.000Z';
const VERSION = readFileSync(join(ROOT, 'VERSION'), 'utf8').trim();
const baseTmp = makeBaseTmp('merge-gate-');

afterAll(() => {
  rmSync(baseTmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------- helpers

function tmp(prefix: string): string {
  return mkdtempSync(join(baseTmp, prefix));
}

function git(repo: string, args: string[], input?: string | Buffer): string {
  const r = spawnSync(REAL_GIT, ['-C', repo, ...args], { env: { ...process.env, ...DATES }, input });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.toString()}`);
  return r.stdout.toString('utf8').trim();
}

type Files = Record<string, string | Buffer | null>;

function commit(repo: string, files: Files, message = 'change'): string {
  for (const [path, content] of Object.entries(files)) {
    const full = join(repo, path);
    if (content === null) rmSync(full, { force: true });
    else {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
  }
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '--allow-empty', '-m', message]);
  return git(repo, ['rev-parse', 'HEAD']);
}

function newRepo(files: Files = {}): string {
  const repo = tmp('repo-');
  git(repo, ['init', '--quiet', '--initial-branch=main']);
  git(repo, ['config', 'user.email', 't@t.com']);
  git(repo, ['config', 'user.name', 'T']);
  commit(repo, files, 'base');
  return repo;
}

/** A repo whose HEAD~1..HEAD is `before` -> `after`. */
function changeRepo(before: Files, after: Files): string {
  const repo = newRepo(before);
  commit(repo, after);
  return repo;
}

type Run = { status: number | null; stdout: string; stderr: string; state: string };
type RunOpts = { cwd?: string; env?: NodeJS.ProcessEnv; path?: string; state?: string; stdin?: string; test?: boolean };

function run(args: string[], opts: RunOpts = {}): Run {
  const state = opts.state ?? tmp('state-');
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: tmp('home-'), GSTACK_EXTEND_STATE_DIR: state };
  if (opts.test) {
    env.GSTACK_EXTEND_MERGE_GATE_TEST = '1';
    env.GSTACK_EXTEND_MERGE_GATE_NOW = NOW;
    env.GSTACK_EXTEND_MERGE_GATE_RETRY_MS = '0';
  }
  Object.assign(env, opts.env);
  if (opts.path !== undefined) env.PATH = opts.path;
  const r = spawnSync(BIN, args, { cwd: opts.cwd ?? baseTmp, env, input: opts.stdin, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', state };
}

function out(r: Run): J {
  try {
    return JSON.parse(r.stdout);
  } catch {
    throw new Error(`not JSON (exit ${r.status}): ${r.stdout}\n${r.stderr}`);
  }
}

function code(r: Run): string {
  return out(r).error?.code ?? '(no error)';
}

function blocking(verdict: J): string[] {
  return (verdict.reasons as J[]).filter(r => r.blocking).map(r => r.code);
}

function reasonCodes(verdict: J): string[] {
  return (verdict.reasons as J[]).map(r => r.code);
}

/** `check --base HEAD~1` against a repo, recorded into a fresh store, returning verdict and evidence. */
function checkRecorded(repo: string, extra: string[] = [], opts: RunOpts = {}): { verdict: J; evidence: J; run: Run } {
  const r = run(['check', '--base', 'HEAD~1', '--json', ...extra], { cwd: repo, test: true, ...opts });
  const verdict = out(r);
  if (verdict.error) throw new Error(JSON.stringify(verdict.error));
  return { verdict, evidence: JSON.parse(readFileSync(verdict.evidence_path, 'utf8')), run: r };
}

function checkQuick(repo: string, extra: string[] = []): J {
  return out(run(['check', '--base', 'HEAD~1', '--json', '--no-record', ...extra], { cwd: repo }));
}

function writeExec(path: string, text: string): void {
  writeFileSync(path, text);
  chmodSync(path, 0o755);
}

type GhStep = { stdout?: unknown; stderr?: string; exit?: number; sleepMs?: number };

const GH_JS = `
const fs = require('node:fs');
const path = require('node:path');
const dir = path.dirname(process.argv[1]);
fs.appendFileSync(path.join(dir, 'gh.log'), JSON.stringify(process.argv.slice(2)) + '\\n');
const countFile = path.join(dir, 'gh.count');
const n = fs.existsSync(countFile) ? Number(fs.readFileSync(countFile, 'utf8')) : 0;
fs.writeFileSync(countFile, String(n + 1));
const steps = JSON.parse(fs.readFileSync(path.join(dir, 'gh.steps.json'), 'utf8'));
const step = steps[Math.min(n, steps.length - 1)];
if (step.sleepMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, step.sleepMs);
if (step.stderr) process.stderr.write(step.stderr);
if (step.stdout !== undefined) process.stdout.write(typeof step.stdout === 'string' ? step.stdout : JSON.stringify(step.stdout));
process.exit(step.exit ?? 0);
`;

/**
 * A PATH directory holding only what a case needs: `bun`, a `git` (the real
 * binary, an argv logger, or a custom script), and optionally a `gh` shim that
 * replays `gh` steps in order and logs its argv.
 */
function shimDir(opts: { git?: 'real' | 'log' | 'none' | string; gh?: GhStep[]; bun?: boolean } = {}): string {
  const dir = tmp('path-');
  if (opts.bun !== false) symlinkSync(BUN, join(dir, 'bun'));
  const gitMode = opts.git ?? 'real';
  if (gitMode === 'real') symlinkSync(REAL_GIT, join(dir, 'git'));
  else if (gitMode === 'log') {
    writeExec(join(dir, 'git'), `#!/bin/sh\nd=\${0%/*}\n{ printf 'CALL\\0'; for a in "$@"; do printf '%s\\0' "$a"; done; } >> "$d/git.log"\nexec '${REAL_GIT}' "$@"\n`);
  } else if (gitMode !== 'none') writeExec(join(dir, 'git'), gitMode);
  if (opts.gh) {
    writeFileSync(join(dir, 'gh.steps.json'), JSON.stringify(opts.gh));
    writeFileSync(join(dir, 'gh.js'), GH_JS);
    writeExec(join(dir, 'gh'), `#!/bin/sh\nexec '${BUN}' '${join(dir, 'gh.js')}' "$@"\n`);
  }
  return dir;
}

function ghCalls(dir: string): string[][] {
  if (!existsSync(join(dir, 'gh.log'))) return [];
  return readFileSync(join(dir, 'gh.log'), 'utf8').trim().split('\n').map(l => JSON.parse(l) as string[]);
}

function gitCalls(dir: string): string[][] {
  if (!existsSync(join(dir, 'git.log'))) return [];
  const calls: string[][] = [];
  for (const part of readFileSync(join(dir, 'git.log'), 'utf8').split('\0')) {
    if (part === 'CALL') calls.push([]);
    else if (part !== '' || calls.length > 0) calls[calls.length - 1]?.push(part);
  }
  return calls.map(c => (c[c.length - 1] === '' ? c.slice(0, -1) : c));
}

/** A git shim that answers `git version` with `version` and runs the real git otherwise. */
function gitVersionShim(version: string): string {
  return `#!/bin/sh\nif [ "$1" = version ]; then echo 'git version ${version}'; exit 0; fi\nexec '${REAL_GIT}' "$@"\n`;
}

type PrRepo = { repo: string; base: string; head: string };

function prRepo(remote = 'https://github.com/acme/widgets.git'): PrRepo {
  const repo = newRepo({ 'a.txt': 'a\n' });
  const base = git(repo, ['rev-parse', 'HEAD']);
  const head = commit(repo, { 'a.txt': 'a\nb\n' });
  git(repo, ['remote', 'add', 'origin', remote]);
  return { repo, base, head };
}

function prJson(pr: PrRepo, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 7,
    url: 'https://github.com/acme/widgets/pull/7',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: 'APPROVED',
    statusCheckRollup: [{ name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    baseRefName: 'main',
    baseRefOid: pr.base,
    headRefName: 'feature',
    headRefOid: pr.head,
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    labels: [{ name: 'shadow' }],
    author: { login: 'octo' },
    createdAt: '2020-01-01T00:00:00Z',
    updatedAt: '2020-01-01T00:00:00Z',
    mergedAt: null,
    closedAt: null,
    reviewRequests: [],
    ...over,
  };
}

function prRun(pr: PrRepo, steps: GhStep[], args: string[] = ['--pr', '7'], opts: RunOpts = {}): { run: Run; path: string } {
  const path = opts.path ?? shimDir({ gh: steps });
  const r = run(['check', ...args, '--json'], { cwd: pr.repo, test: true, ...opts, path });
  return { run: r, path };
}

// ---------------------------------------------------------------- dependency parsers

type ParserCase = { name: string; kind: ManifestKind; base: string | null; head: string; added?: string[]; bad?: boolean };

const PARSER_CASES: ParserCase[] = [
  // package.json
  { name: 'npm: section move is not new', kind: 'package.json', base: '{"dependencies":{"a":"1"}}', head: '{"devDependencies":{"a":"1"}}', added: [] },
  { name: 'npm: local specs are local', kind: 'package.json', base: '{}', head: '{"dependencies":{"w":"workspace:*","f":"file:../f","l":"link:../l","p":"portal:../p"}}', added: ['local:f', 'local:l', 'local:p', 'local:w'] },
  { name: 'npm: new manifest counts every entry', kind: 'package.json', base: null, head: '{"dependencies":{"a":"1"},"peerDependencies":{"b":"2"}}', added: ['remote:a', 'remote:b'] },
  { name: 'npm: invalid JSON', kind: 'package.json', base: '{}', head: '{', bad: true },
  { name: 'npm: non-string spec', kind: 'package.json', base: '{}', head: '{"dependencies":{"a":1}}', bad: true },
  // requirements
  { name: 'req: unchanged -r include is fine', kind: 'requirements', base: 'a==1\n-r other.txt\n', head: 'a==2\n-r other.txt\n', added: [] },
  { name: 'req: added -r include', kind: 'requirements', base: 'a==1\n', head: 'a==1\n-r other.txt\n', bad: true },
  { name: 'req: added -c constraint', kind: 'requirements', base: 'a==1\n', head: 'a==1\n--constraint c.txt\n', bad: true },
  { name: 'req: editable URL counts by full line', kind: 'requirements', base: '', head: '-e https://example.com/pkg.git\n', added: ['remote:-e https://example.com/pkg.git'] },
  { name: 'req: editable path is local', kind: 'requirements', base: '', head: '-e ./pkg\n', added: ['local:-e ./pkg'] },
  { name: 'req: local path and file URL', kind: 'requirements', base: '', head: './local\nfile:///tmp/pkg\n', added: ['local:./local', 'local:file:///tmp/pkg'] },
  { name: 'req: direct references', kind: 'requirements', base: '', head: 'baz @ file:///tmp/baz\nqux @ https://example.com/qux.whl\n', added: ['local:baz', 'remote:qux'] },
  { name: 'req: normalization collapses separator runs', kind: 'requirements', base: 'foo__bar==1\n', head: 'Foo.Bar==2\n', added: [] },
  { name: 'req: extras, markers, and specifiers', kind: 'requirements', base: '', head: 'uvicorn[standard]>=0.20,<1 ; python_version >= "3.8"\n', added: ['remote:uvicorn'] },
  { name: 'req: global options are ignored', kind: 'requirements', base: '--index-url https://pypi.org/simple\na==1\n', head: '--index-url https://pypi.org/simple\n--extra-index-url https://x.example/simple\na==2\n', added: [] },
  { name: 'req: hash continuation lines', kind: 'requirements', base: 'a==1 \\\n    --hash=sha256:aa\n', head: 'a==2 \\\n    --hash=sha256:bb\n', added: [] },
  { name: 'req: unknown option on an added line', kind: 'requirements', base: '', head: '--weird x\n', bad: true },
  { name: 'req: malformed added line', kind: 'requirements', base: '', head: '!!!\n', bad: true },
  { name: 'req: malformed unchanged line', kind: 'requirements', base: '!!!\na==1\n', head: '!!!\na==2\n', added: [] },
  // pyproject
  { name: 'py: project metadata is not a dependency', kind: 'pyproject', base: null, head: '[project]\nname = "x"\nversion = "1"\ndescription = "d"\ndependencies = ["requests"]\n', added: ['remote:requests'] },
  { name: 'py: multi-line array entry', kind: 'pyproject', base: '[project]\ndependencies = [\n  "a>=1",\n]\n', head: '[project]\ndependencies = [\n  "a>=1",\n  "b[x]>=2",\n]\n', added: ['remote:b'] },
  { name: 'py: optional-dependencies table', kind: 'pyproject', base: '[project]\n', head: '[project]\n[project.optional-dependencies]\ndev = ["pytest"]\n', added: ['remote:pytest'] },
  { name: 'py: dotted project key', kind: 'pyproject', base: '', head: 'project.dependencies = ["httpx"]\n', added: ['remote:httpx'] },
  { name: 'py: poetry skips python and records path as local', kind: 'pyproject', base: '', head: '[tool.poetry.dependencies]\npython = "^3.11"\nrequests = "2"\nlocal = { path = "./l" }\n', added: ['local:local', 'remote:requests'] },
  { name: 'py: poetry group', kind: 'pyproject', base: '', head: '[tool.poetry.group.dev.dependencies]\npytest = "^8"\n', added: ['remote:pytest'] },
  { name: 'py: unrelated array of tables unchanged', kind: 'pyproject', base: '[[tool.x.y]]\na = 1\n[project]\ndependencies = ["a"]\n', head: '[[tool.x.y]]\na = 1\n[project]\ndependencies = ["a", "b"]\n', added: ['remote:b'] },
  { name: 'py: quoted tool keys are not dependencies', kind: 'pyproject', base: '', head: '[tool.ruff.lint.per-file-ignores]\n"__init__.py" = ["F401"]\n', added: [] },
  // Cargo
  { name: 'cargo: string, path, and workspace', kind: 'cargo', base: '[dependencies]\nfoo = "1"\n', head: '[dependencies]\nfoo = "1"\nbar = { path = "../bar" }\nbaz = { workspace = true }\nqux = { version = "2" }\n', added: ['local:bar', 'local:baz', 'remote:qux'] },
  { name: 'cargo: subtable with path is local', kind: 'cargo', base: '', head: '[dependencies.foo]\npath = "../foo"\n[dependencies.bar]\nworkspace = true\n[dependencies.baz]\nversion = "1"\n', added: ['local:bar', 'local:foo', 'remote:baz'] },
  { name: 'cargo: target and workspace subtables', kind: 'cargo', base: '', head: "[target.'cfg(unix)'.dependencies.libc]\nversion = \"0.2\"\n[workspace.dependencies.serde]\nversion = \"1\"\n[target.'cfg(windows)'.dev-dependencies]\nwinapi = \"0.3\"\n", added: ['remote:libc', 'remote:serde', 'remote:winapi'] },
  { name: 'cargo: underscore table names', kind: 'cargo', base: '', head: '[dev_dependencies]\nx = "1"\n', added: ['remote:x'] },
  { name: 'cargo: quoted and dotted keys', kind: 'cargo', base: '', head: '[dependencies]\n"quoted" = "1"\nfoo.version = "2"\n', added: ['remote:foo', 'remote:quoted'] },
  { name: 'cargo: unchanged [[bin]]', kind: 'cargo', base: '[package]\nversion = "1"\n[[bin]]\nname = "x"\n[dependencies]\nserde = "1"\n', head: '[package]\nversion = "2"\n[[bin]]\nname = "x"\n[dependencies]\nserde = "1"\n', added: [] },
  { name: 'cargo: added array of tables under a dependency table', kind: 'cargo', base: '[dependencies]\n', head: '[dependencies]\n[[dependencies.bar]]\n', bad: true },
  { name: 'cargo: unchanged array of tables under a dependency table', kind: 'cargo', base: '[[dependencies.bar]]\n', head: '[[dependencies.bar]]\n', added: [] },
  { name: 'cargo: malformed added line', kind: 'cargo', base: '[dependencies]\n', head: '[dependencies]\nfoo = "1\n', bad: true },
  { name: 'cargo: multi-line features array', kind: 'cargo', base: '[features]\ndefault = [\n  "std",\n]\n', head: '[features]\ndefault = [\n  "std",\n  "alloc",\n]\n', added: [] },
  // Gemfile
  { name: 'gem: gem lines and column-zero comments', kind: 'gemfile', base: "source 'https://rubygems.org'\ngem 'rails'\n", head: "# Dependencies\nsource 'https://rubygems.org'\ngem 'rails'\ngem 'pg', '~> 1.5', require: false\n", added: ['remote:pg'] },
  { name: 'gem: path option is local', kind: 'gemfile', base: '', head: "gem 'mine', path: '../mine'\n", added: ['local:mine'] },
  { name: 'gem: group, ruby, and platforms', kind: 'gemfile', base: '', head: "ruby '3.3.0'\ngroup :test, :development do\n  gem 'rspec'\nend\nplatforms :jruby do\n  gem 'jdbc'\nend\n", added: ['remote:jdbc', 'remote:rspec'] },
  { name: 'gem: unchanged gemspec', kind: 'gemfile', base: 'gemspec\n', head: "gemspec\ngem 'rails'\n", added: ['remote:rails'] },
  { name: 'gem: added gemspec', kind: 'gemfile', base: "gem 'a'\n", head: "gem 'a'\ngemspec\n", bad: true },
  { name: 'gem: dynamic Ruby on an added line', kind: 'gemfile', base: '', head: "gem ENV['NAME']\n", bad: true },
  // go.mod
  { name: 'go: indirect requires are not counted', kind: 'gomod', base: 'module x\ngo 1.22\nrequire example.com/a v1.0.0 // indirect\n', head: 'module x\ngo 1.22\nrequire example.com/a v1.2.0\nrequire example.com/b v1.0.0\n', added: ['remote:example.com/b'] },
  { name: 'go: comments in a require block', kind: 'gomod', base: 'module x\n', head: 'module x\nrequire ( // core\n\t// deps\n\texample.com/a v1.0.0\n\texample.com/b v1.0.0 // indirect\n)\n', added: ['indirect:example.com/b', 'remote:example.com/a'] },
  { name: 'go: added replace', kind: 'gomod', base: 'module x\n', head: 'module x\nreplace example.com/a => ../a\n', bad: true },
  { name: 'go: unchanged replace', kind: 'gomod', base: 'module x\nreplace example.com/a => ../a\n', head: 'module x\nreplace example.com/a => ../a\nrequire example.com/b v1.0.0\n', added: ['remote:example.com/b'] },
  { name: 'go: toolchain and tool directives', kind: 'gomod', base: 'module x\n', head: 'module x\ntoolchain go1.22.1\ntool example.com/t\n', added: [] },
  { name: 'go: unknown directive on an added line', kind: 'gomod', base: 'module x\n', head: 'module x\nfrobnicate x\n', bad: true },
];

describe('dependency parsers', () => {
  for (const c of PARSER_CASES) {
    test(c.name, () => {
      const parsed = parseManifest(c.kind, c.base, c.head);
      if (c.bad) {
        expect(parsed.unverifiable).not.toBeNull();
        return;
      }
      expect(parsed.unverifiable).toBeNull();
      expect(parsed.added.map(d => `${d.classification}:${d.name}`).sort()).toEqual(c.added ?? []);
    });
  }
});

describe('manifests through collection', () => {
  test('new dependency blocks by default and passes with room (CEO-T1)', () => {
    const repo = changeRepo({ 'package.json': '{"dependencies":{"old":"1.0.0"}}\n' }, { 'package.json': '{"dependencies":{"old":"1.0.0","left-pad":"1.0.0"}}\n' });
    const blocked = checkQuick(repo);
    expect(blocked.would_merge).toBe(false);
    expect(blocking(blocked)).toEqual(['new_deps_over_budget']);
    expect(blocked.reasons[0].subjects).toEqual(['package.json:left-pad']);
    expect(checkQuick(repo, ['--max-new-deps', '1']).would_merge).toBe(true);
  });

  test('a renamed manifest compares its old path and a new sub-package counts every entry', () => {
    const repo = changeRepo({ 'package.json': '{"dependencies":{"a":"1"}}\n' }, { 'package.json': null, 'pkg/package.json': '{"dependencies":{"a":"1"}}\n', 'sub/package.json': '{"dependencies":{"b":"1"}}\n' });
    const verdict = checkQuick(repo);
    expect(verdict.metrics.new_deps).toBe(1);
    expect(verdict.reasons[0].subjects).toEqual(['sub/package.json:b']);
  });

  test('deleted and test-path manifests never block; unsupported ones name the ecosystem (DX-18)', () => {
    const deleted = changeRepo({ 'pom.xml': '<project/>\n', 'package.json': '{"dependencies":{"a":"1"}}\n' }, { 'pom.xml': null, 'package.json': null });
    expect(checkQuick(deleted).would_merge).toBe(true);
    const fixture = changeRepo({ 'x.txt': 'x\n' }, { 'tests/fixtures/app/package.json': '{"dependencies":{"a":"1"}}\n' });
    expect(checkQuick(fixture).metrics.new_deps).toBe(0);
    const maven = checkQuick(changeRepo({ 'x.txt': 'x\n' }, { 'pom.xml': '<project/>\n' }));
    const reason = (maven.reasons as J[]).find(r => r.code === 'deps_unverifiable');
    expect(reason.detail).toBe('Maven manifests are not parsed by collector v1 (documented limitation)');
    expect(reason.subjects).toEqual(['pom.xml']);
  });
});

// ---------------------------------------------------------------- public API

type ApiCase = { name: string; path: string; lines: string[]; context?: string; want: string[] };

const API_CASES: ApiCase[] = [
  { name: 'ts-decl forms', path: 'a.ts', lines: ['export function Foo() {}', 'export async function* gen() {}', 'export abstract class Base {}', 'export declare const x: number;', 'export const enum Color {}', 'export default class Main {}'], want: ['ts-decl:Foo', 'ts-decl:gen', 'ts-decl:Base', 'ts-decl:x', 'ts-decl:Color', 'ts-decl:Main'] },
  { name: 'ts-default only when ts-decl does not match', path: 'a.ts', lines: ['export default 1', 'export default function named() {}'], want: ['ts-default:default@a.ts', 'ts-decl:named'] },
  { name: 'ts-list entries, aliases, and inline type', path: 'a.ts', lines: ['export { a as b, c, type D }', 'export { x as default }'], want: ['ts-list:b', 'ts-list:c', 'ts-list:D', 'ts-list:default@a.ts'] },
  { name: 'ts-list across lines', path: 'a.ts', lines: ['export {', '  A,', '  type B as C, E,', '} from "./m";', 'const not = 1;'], want: ['ts-list:A', 'ts-list:C', 'ts-list:E'] },
  { name: 'ts-list inside an existing block', path: 'a.ts', context: 'export {', lines: ['  D,', '  E'], want: ['ts-list:D', 'ts-list:E'] },
  { name: 'ts-star alias and module', path: 'a.mts', lines: ["export * as NS from './m'", "export * from './n'"], want: ['ts-star:NS', 'ts-star:*:./n'] },
  { name: 'js-cjs forms', path: 'a.cjs', lines: ['module.exports = {}', 'exports.foo = 1', 'module.exports.bar = 2', 'if (exports.baz == 1) {}'], want: ['js-cjs-assign:module.exports@a.cjs', 'js-cjs:foo', 'js-cjs:bar'] },
  { name: 'py-def top level only, no underscore', path: 'a.py', lines: ['def helper():', 'async def run():', 'class Public:', '    def inner():', 'def _hidden():'], want: ['py-def:helper', 'py-def:run', 'py-def:Public'] },
  { name: 'go functions, generic methods, types, and var lists', path: 'a.go', lines: ['func (s *Box[K, V]) Save() {}', 'func (b box) Load() {}', 'func Exported() {}', 'func hidden() {}', 'type Thing struct {', 'var A, b, C = 1, 2, 3'], want: ['go-exported:Box.Save', 'go-exported:box.Load', 'go-exported:Exported', 'go-exported:Thing', 'go-exported:A', 'go-exported:C'] },
  { name: 'go names in a new const block', path: 'a.go', lines: ['const (', '\tA = iota', '\tB', '\tc', ')', 'func f() {', '\tDoThing()', '}'], want: ['go-exported:A', 'go-exported:B'] },
  { name: 'go names inside an existing var block', path: 'a.go', context: 'var (', lines: ['\tDefault Config', '\tlimit = 3'], want: ['go-exported:Default'] },
  { name: 'rust pub items and restricted visibility', path: 'a.rs', lines: ['pub fn Open() {}', '    pub async unsafe fn run() {}', 'pub(crate) fn Hidden() {}', 'pub(super) struct S;', 'pub(in crate::x) enum E {}'], want: ['rust-pub:Open', 'rust-pub:run'] },
  { name: 'no rule for other extensions', path: 'a.sh', lines: ['export FOO=1'], want: [] },
];

describe('public API rules (CEO-S13)', () => {
  for (const c of API_CASES) {
    test(c.name, () => {
      expect(scanLines(c.path, c.lines, c.context).map(p => `${p.rule}:${p.name}`)).toEqual(c.want);
    });
  }
});

describe('public API through collection', () => {
  const api = (before: Files, after: Files, extra: string[] = []) => checkQuick(changeRepo(before, after), extra);

  test('moves and renames cancel; a rename plus a new export counts one', () => {
    const exports3 = 'export function a() {}\nexport function b() {}\nexport const c = 1;\n';
    expect(api({ 'src/old.ts': exports3 }, { 'src/old.ts': null, 'src/new.ts': exports3 }).metrics.new_public_api).toBe(0);
    expect(api({ 'src/one.ts': 'export function a() {}\n// pad\n// pad\n' }, { 'src/one.ts': null, 'src/two.ts': 'import x from "y";\nexport function a() {}\nconst q = 2;\nconst r = 3;\n' }).metrics.new_public_api).toBe(0);
    expect(api({ 'src/old.ts': `${exports3}// l1\n// l2\n` }, { 'src/old.ts': null, 'src/new.ts': `${exports3}// l1\n// l2\nexport function d() {}\n` }).metrics.new_public_api).toBe(1);
  });

  test('two files each adding export default count two', () => {
    expect(api({ 'x.txt': 'x\n' }, { 'a.ts': 'export default 1\n', 'b.ts': 'export default 2\n' }).metrics.new_public_api).toBe(2);
  });

  test('bin executables and mode flips count; edited bin scripts make coverage partial (CEO-V3)', () => {
    const repo = newRepo({ 'bin/old': '#!/bin/sh\necho old\n' });
    writeExec(join(repo, 'bin/tool'), '#!/bin/sh\necho hi\n');
    chmodSync(join(repo, 'bin/old'), 0o755);
    commit(repo, {});
    const verdict = checkQuick(repo);
    expect(verdict.metrics.new_public_api).toBe(2);
    expect(verdict.metrics.coverage.new_public_api).toBe('partial');
    expect(verdict.metrics.unmeasured_api_files.map((f: J) => f.path).sort()).toEqual(['bin/old', 'bin/tool']);
    expect(reasonCodes(verdict)).toContain('api_coverage_partial');
  });

  test('README-only change has complete coverage (ENG-13)', () => {
    const verdict = api({ 'README.md': 'a\n' }, { 'README.md': 'a\nb\n', 'data.json': '{}\n' });
    expect(verdict.metrics.coverage.new_public_api).toBe('complete');
  });

  test('a source line that looks like a patch header cannot hide exports', () => {
    const verdict = api({ 'x.txt': 'x\n' }, { 'api.ts': '/*\n++ b/decoy.ts\n*/\nexport function Public() {}\nexport function Other() {}\n' });
    expect(verdict.metrics.new_public_api).toBe(2);
  });

  test('names added to an existing multi-line export block count', () => {
    const verdict = api({ 'm.ts': 'export {\n  Existing,\n};\n' }, { 'm.ts': 'export {\n  Existing,\n  E0,\n  E1,\n};\n' });
    expect(verdict.metrics.new_public_api).toBe(2);
  });

  test('unusual file names: leading dash, carriage return, space and non-ASCII rename', () => {
    expect(api({ 'x.txt': 'x\n' }, { '-a.ts': 'export const Dash = 1;\n' }).metrics.new_public_api).toBe(1);
    expect(api({ 'x.txt': 'x\n' }, { 'a\rb.ts': 'export const Cr = 1;\n' }).metrics.new_public_api).toBe(1);
    const body = 'export const A = 1;\n// 1\n// 2\n// 3\n';
    const renamed = checkQuick(changeRepo({ 'old name.ts': body }, { 'old name.ts': null, 'nëw näme.ts': `${body}export const B = 2;\n` }));
    expect(renamed.metrics.new_public_api).toBe(1);
    expect(renamed.metrics.top_churn_files[0].path).toBe('nëw näme.ts');
  });

  test('a non-UTF-8 name is stored with path_b64 and left unmeasured (CEO-R4)', () => {
    const repo = newRepo({ 'x.txt': 'x\n' });
    const blob = git(repo, ['hash-object', '-w', '--stdin'], 'export const Latin = 1;\n');
    const listing = spawnSync(REAL_GIT, ['-C', repo, 'ls-tree', '-z', 'HEAD']).stdout;
    const name = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x2e, 0x74, 0x73]);
    const tree = git(repo, ['mktree', '-z'], Buffer.concat([listing, Buffer.from(`100644 blob ${blob}\t`), name, Buffer.from([0])]));
    const sha = git(repo, ['commit-tree', tree, '-p', 'HEAD', '-m', 'latin']);
    git(repo, ['update-ref', 'refs/heads/main', sha]);
    const { verdict, evidence } = checkRecorded(repo);
    const fact = (evidence.git.files as J[]).find(f => f.path_b64);
    expect(Buffer.from(fact.path_b64, 'base64').equals(name)).toBe(true);
    expect(fact.path).toBe('caf�.ts');
    expect(fact.api_skipped).toBe('non_utf8_path');
    expect(verdict.metrics.coverage.new_public_api).toBe('partial');
  });

  test('oversized files are skipped as too_large (ENG-7)', () => {
    const lines = checkQuick(changeRepo({ 'x.txt': 'x\n' }, { 'many.ts': 'const x = 1;\n'.repeat(20_001) }), ['--max-net-lines', 'none']);
    expect(lines.metrics.unmeasured_api_files).toEqual([{ path: 'many.ts', reason: 'too_large' }]);
    const blob = checkQuick(changeRepo({ 'x.txt': 'x\n' }, { 'wide.ts': `export const Big = "${'x'.repeat(30 * 1024 * 1024)}";\n` }));
    expect(blob.metrics.unmeasured_api_files).toEqual([{ path: 'wide.ts', reason: 'too_large' }]);
    expect(blob.metrics.new_public_api).toBe(0);
  }, 60_000);
});

describe('diff parsing', () => {
  test('hunk counts are consumed exactly', () => {
    const patch = [
      'diff --git a/api.ts b/api.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/api.ts',
      '@@ -0,0 +1,3 @@',
      '+/*',
      '+++ b/decoy.ts',
      '+export const X = 1;',
      'diff --git a/gone.ts b/gone.ts',
      'deleted file mode 100644',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@ const (',
      '-export const Y = 2;',
      '\\ No newline at end of file',
      '',
    ].join('\n');
    const map = parseUnified(Buffer.from(patch));
    expect([...map.keys()]).toEqual(['api.ts', 'gone.ts']);
    expect(map.get('api.ts')?.hunks[0]?.added).toEqual(['/*', '++ b/decoy.ts', 'export const X = 1;']);
    expect(map.get('gone.ts')?.hunks[0]).toEqual({ context: 'const (', added: [], removed: ['export const Y = 2;'] });
  });

  test('quoted paths decode named escapes and octal UTF-8 bytes', () => {
    expect(unquoteGitPath('"a\\rb\\a\\b\\f\\v\\t\\n\\"\\\\.ts"')).toBe('a\rb\u0007\b\f\u000b\t\n"\\.ts');
    expect(unquoteGitPath('"caf\\303\\251.ts"')).toBe('café.ts');
    expect(unquoteGitPath('plain.ts')).toBe('plain.ts');
  });
});

// ---------------------------------------------------------------- ENG-1 invariance

describe('deterministic git facts (ENG-1)', () => {
  const before: Files = { 'f.txt': 'a\n', 'old.ts': 'export const A = 1;\n// 1\n// 2\n// 3\n', 'café.ts': 'x\n' };
  const after: Files = { 'f.txt': 'a\nb\nc\n', 'old.ts': null, 'new.ts': 'export const A = 1;\n// 1\n// 2\n// 3\n', 'café.ts': 'x\ny\n' };
  const facts = (repo: string) => {
    const { evidence } = checkRecorded(repo);
    return canonicalJson({ files: evidence.git.files, api: evidence.public_api, collection: evidence.collection });
  };

  test('worktree, repository, and replace-object settings leave facts byte-identical', () => {
    const baseline = facts(changeRepo(before, after));
    const perturb: [string, (repo: string) => void][] = [
      ['uncommitted .gitattributes', r => writeFileSync(join(r, '.gitattributes'), '*.txt binary\n*.ts -diff\n')],
      ['core.attributesFile', r => {
        writeFileSync(join(r, '..', `${r.split('/').pop()}.attrs`), '* binary\n');
        git(r, ['config', 'core.attributesFile', join(r, '..', `${r.split('/').pop()}.attrs`)]);
      }],
      ['diff.renameLimit=1', r => git(r, ['config', 'diff.renameLimit', '1'])],
      ['diff.algorithm=patience', r => git(r, ['config', 'diff.algorithm', 'patience'])],
      ['core.quotePath=true', r => git(r, ['config', 'core.quotePath', 'true'])],
      ['core.bigFileThreshold=1', r => git(r, ['config', 'core.bigFileThreshold', '1'])],
      ['diff.ignoreSubmodules=all', r => git(r, ['config', 'diff.ignoreSubmodules', 'all'])],
      ['a replace object', r => {
        const other = git(r, ['commit-tree', git(r, ['rev-parse', 'HEAD~1^{tree}']), '-p', 'HEAD~1', '-m', 'decoy']);
        git(r, ['replace', 'HEAD', other]);
      }],
    ];
    for (const [name, apply] of perturb) {
      const repo = changeRepo(before, after);
      apply(repo);
      expect({ name, facts: facts(repo) }).toEqual({ name, facts: baseline });
    }
  }, 60_000);

  test('a .gitattributes added by the change does not mark files binary', () => {
    const { evidence } = checkRecorded(changeRepo(before, { ...after, '.gitattributes': '*.txt binary\n' }));
    const fact = (evidence.git.files as J[]).find(f => f.path === 'f.txt');
    expect(fact).toMatchObject({ binary: false, additions: 2, deletions: 0 });
  });

  test('.git/info/attributes is recorded as a collection failure', () => {
    const repo = changeRepo(before, after);
    mkdirSync(join(repo, '.git/info'), { recursive: true });
    writeFileSync(join(repo, '.git/info/attributes'), '# comment only\n');
    expect(checkRecorded(repo).evidence.collection.complete).toBe(true);
    writeFileSync(join(repo, '.git/info/attributes'), '*.txt -diff\n');
    const { verdict, evidence } = checkRecorded(repo);
    expect(evidence.collection.failures).toEqual([{ stage: 'attributes', code: 'info_attributes', subjects: ['.git/info/attributes'] }]);
    expect(blocking(verdict)).toContain('evidence_incomplete');
  });

  test('child environment drops GIT_* and GH_REPO and pins config', () => {
    const env = buildChildEnv({ ...process.env, GIT_DIR: '/tmp/nope', GIT_CONFIG_PARAMETERS: "'x.y=z'", GH_REPO: 'acme/widgets', GH_TOKEN: 'keep' });
    expect(env.GIT_DIR).toBeUndefined();
    expect(env.GIT_CONFIG_PARAMETERS).toBeUndefined();
    expect(env.GH_REPO).toBeUndefined();
    expect(env.GH_TOKEN).toBe('keep');
    expect(env).toMatchObject({ LC_ALL: 'C', GIT_NO_LAZY_FETCH: '1', GIT_ATTR_NOSYSTEM: '1', GIT_CONFIG_KEY_2: 'core.attributesFile', GIT_CONFIG_VALUE_2: '/dev/null' });
  });
});

// ---------------------------------------------------------------- budget and verdict

describe('budget', () => {
  test('within budget, each dimension over, none, and churn', () => {
    const repo = changeRepo({ 'a.txt': 'a\n' }, { 'a.txt': 'a\nb\n' });
    const ok = checkQuick(repo);
    expect(ok.would_merge).toBe(true);
    expect(ok.metrics).toMatchObject({ net_lines: 1, churn: 1, new_files: 0, top_churn_files: [{ path: 'a.txt', churn: 1 }] });
    expect(reasonCodes(ok)).not.toContain('churn_over_budget');
    const lines = checkQuick(changeRepo({ 'a.txt': 'a\n' }, { 'a.txt': 'x\n'.repeat(600) }));
    expect(lines.reasons[0]).toMatchObject({ code: 'net_lines_over_budget', measured: 599, limit: 500, class: 'budget' });
    const files: Files = {};
    for (let i = 0; i < 11; i++) files[`n${i}.txt`] = 'z\n';
    files['bun.lock'] = 'lock\n';
    const many = checkQuick(changeRepo({ 'x.txt': 'x\n' }, files));
    const hit = (many.reasons as J[]).find(r => r.code === 'new_files_over_budget');
    expect(hit.measured).toBe(11);
    expect(hit.subjects).not.toContain('bun.lock');
    expect(checkQuick(changeRepo({ 'x.txt': 'x\n' }, files), ['--max-new-files', 'none']).would_merge).toBe(true);
    expect(blocking(checkQuick(repo, ['--max-churn', '0']))).toEqual(['churn_over_budget']);
  });

  test('exclusions: lockfiles, binaries, and user globs including a trailing **', () => {
    const repo = changeRepo({ 'x.txt': 'x\n' }, {
      'bun.lock': 'l\n'.repeat(900),
      'img.bin': Buffer.from([0, 1, 2, 0, 3]),
      'vendor/lib/a.js': 'v\n'.repeat(700),
      'gen/deep/x.ts': 'export const G = 1;\n',
    });
    const verdict = checkQuick(repo, ['--exclude', 'vendor/**', '--exclude', '**/deep/*.ts']);
    expect(verdict.would_merge).toBe(true);
    expect(verdict.metrics.new_files).toBe(1);
    expect(verdict.metrics.excluded).toEqual(expect.arrayContaining([
      { path: 'bun.lock', reason: 'lockfile' },
      { path: 'img.bin', reason: 'binary' },
      { path: 'vendor/lib/a.js', reason: 'user_glob' },
      { path: 'gen/deep/x.ts', reason: 'user_glob' },
    ]));
    expect(reasonCodes(verdict)).toContain('binary_files_excluded');
    expect(verdict.policy.exclude).toEqual(['**/deep/*.ts', 'vendor/**']);
  });

  test('empty diff blocks when the base contains the head (CEO-S7)', () => {
    const repo = newRepo({ 'a.txt': 'a\n' });
    const verdict = out(run(['check', '--base', 'HEAD', '--json', '--no-record'], { cwd: repo }));
    expect(blocking(verdict)).toEqual(['empty_diff']);
    expect(verdict.evidence_complete).toBe(false);
  });

  test('glob matcher semantics (ENG-5)', () => {
    expect(matchGlob('a.ts', '**/*.ts')).toBe(true);
    expect(matchGlob('dir/a.ts', '**/*.ts')).toBe(true);
    expect(matchGlob('vendor/a.ts', 'vendor/**')).toBe(true);
    expect(matchGlob('vendor/x/y.ts', 'vendor/**')).toBe(true);
    expect(matchGlob('vendorx/a.ts', 'vendor/**')).toBe(false);
    expect(matchGlob('a.ts', '**')).toBe(true);
    expect(matchGlob('a/b/c', 'a/**/c')).toBe(true);
    expect(matchGlob('a/c', 'a/**/c')).toBe(true);
    expect(matchGlob('file(1).txt', 'file(1).txt')).toBe(true);
    expect(matchGlob('a+b?.txt', 'a+b?.txt')).toBe(true);
    expect(matchGlob('ab.txt', 'a?.txt')).toBe(false);
    expect(() => matchGlob('a.ts', 'src/[a].ts')).toThrow(GateError);
    expect(() => matchGlob('a.ts', '{a,b}.ts')).toThrow(GateError);
  });
});

// ---------------------------------------------------------------- decide

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);
const POLICY: Policy = { ...DEFAULT_POLICY, exclude: [] };

function evidence(over: Partial<Evidence> = {}, raw: Record<string, unknown> | null = null): Evidence {
  return {
    v: 1,
    observed_at: '2020-01-01T00:00:00.000Z',
    collection_started_at: '2020-01-01T00:00:00.000Z',
    clock_overridden: true,
    test_overrides: ['GSTACK_EXTEND_MERGE_GATE_NOW'],
    collector_version: 1,
    gstack_extend_version: '0.29.1.0',
    git_version: 'git version 2.44.0',
    partial_clone: false,
    attr_source: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
    rename_limit: 10000,
    rename_detection_skipped: false,
    decision_id: null,
    repo: { origin: 'https://github.com/acme/widgets.git' },
    git: {
      base_sha: SHA_A,
      head_sha: SHA_B,
      merge_base_sha: SHA_A,
      files: [{ path: 'f.txt', old_path: null, old_mode: '100644', new_mode: '100644', old_oid: SHA_C, new_oid: SHA_C, status: 'M', additions: 1, deletions: 0, binary: false, submodule: false }],
    },
    dependencies: { manifests: [] },
    public_api: { files: [] },
    collection: { complete: true, failures: [] },
    pr: raw === null ? null : {
      number: 42,
      url: 'https://github.com/acme/widgets/pull/42',
      repo: { host: 'github.com', owner: 'acme', name: 'widgets' },
      raw,
      raw_first: null,
      retry_wait_ms: null,
    },
    ...over,
  };
}

const OPEN = { state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN', statusCheckRollup: [{ name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' }] };
const at = new Date('2020-01-01T00:00:00.000Z');
const judge = (e: Evidence, policy: Policy = POLICY) => decide(e, policy, at, { evidenceId: 'e'.repeat(64), replay: false, gstackVersion: '0.29.1.0' });
const prCodes = (raw: Record<string, unknown>) => judge(evidence({}, { ...OPEN, ...raw })).reasons.map(r => r.code);

type PrRow = [string, Record<string, unknown>, string | null];

const PR_ROWS: PrRow[] = [
  ['draft', { isDraft: true }, 'pr_draft'],
  ['mergeable', { mergeable: 'MERGEABLE' }, null],
  ['conflicting', { mergeable: 'CONFLICTING' }, 'merge_conflict'],
  ['mergeable unknown', { mergeable: 'UNKNOWN' }, 'mergeability_unknown'],
  ['mergeable absent', { mergeable: undefined }, 'mergeability_unknown'],
  ['approved', { reviewDecision: 'APPROVED' }, null],
  ['no review policy (empty)', { reviewDecision: '' }, null],
  ['no review policy (null)', { reviewDecision: null }, null],
  ['changes requested', { reviewDecision: 'CHANGES_REQUESTED' }, 'changes_requested'],
  ['review required', { reviewDecision: 'REVIEW_REQUIRED' }, 'review_required'],
  ['unrecognized review decision', { reviewDecision: 'SOMETHING_NEW' }, 'review_required'],
  ['check run in progress', { statusCheckRollup: [{ name: 'c', status: 'IN_PROGRESS', conclusion: null }] }, 'checks_pending'],
  ['check run success', { statusCheckRollup: [{ name: 'c', status: 'COMPLETED', conclusion: 'SUCCESS' }] }, null],
  ...(['NEUTRAL', 'SKIPPED'].map(c => [`check run ${c}`, { statusCheckRollup: [{ name: 'c', status: 'COMPLETED', conclusion: c }] }, null] as PrRow)),
  ...(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'].map(c => [`check run ${c}`, { statusCheckRollup: [{ name: 'c', status: 'COMPLETED', conclusion: c }] }, 'checks_failing'] as PrRow)),
  ['check run odd conclusion', { statusCheckRollup: [{ name: 'c', status: 'COMPLETED', conclusion: 'ODD' }] }, 'check_state_unknown'],
  ['status success', { statusCheckRollup: [{ context: 's', state: 'SUCCESS' }] }, null],
  ...(['PENDING', 'EXPECTED'].map(s => [`status ${s}`, { statusCheckRollup: [{ context: 's', state: s }] }, 'checks_pending'] as PrRow)),
  ...(['FAILURE', 'ERROR'].map(s => [`status ${s}`, { statusCheckRollup: [{ context: 's', state: s }] }, 'checks_failing'] as PrRow)),
  ['status odd state', { statusCheckRollup: [{ context: 's', state: 'WEIRD' }] }, 'check_state_unknown'],
  ['empty rollup', { statusCheckRollup: [] }, 'no_checks_configured'],
  ['absent rollup', { statusCheckRollup: undefined }, 'check_state_unknown'],
];

describe('pull request mapping (CEO-S1)', () => {
  for (const [name, raw, want] of PR_ROWS) {
    test(name, () => {
      const codes: string[] = prCodes(raw);
      const readiness = codes.filter(c => REASON_REGISTRY.find(r => r.code === c)?.class === 'readiness' || c === 'no_checks_configured');
      expect(readiness).toEqual(want === null ? [] : [want]);
    });
  }

  test('all check reasons that apply are listed, and 100 contexts are truncated', () => {
    const codes = prCodes({ statusCheckRollup: [{ name: 'a', status: 'COMPLETED', conclusion: 'FAILURE' }, { name: 'b', status: 'QUEUED' }, { context: 'c', state: 'ODD' }] });
    expect(codes).toEqual(expect.arrayContaining(['checks_failing', 'checks_pending', 'check_state_unknown']));
    const hundred = Array.from({ length: 100 }, (_, i) => ({ name: `c${i}`, status: 'COMPLETED', conclusion: 'SUCCESS' }));
    expect(prCodes({ statusCheckRollup: hundred })).toContain('checks_truncated');
    const failing = judge(evidence({}, { ...OPEN, statusCheckRollup: [{ name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' }] }));
    expect(failing.reasons.find(r => r.code === 'checks_failing')).toMatchObject({ detail: 'failing checks: lint', subjects: ['lint'], subjects_count: 1 });
    expect(judge(evidence({}, { ...OPEN, mergeable: 'CONFLICTING' })).reasons.find(r => r.code === 'merge_conflict')?.detail).toBe('GitHub reports mergeable CONFLICTING');
  });

  test('merged and closed pull requests are retroactive and budget-only', () => {
    for (const state of ['MERGED', 'CLOSED']) {
      const verdict = judge(evidence({}, { ...OPEN, state, mergeable: 'CONFLICTING', reviewDecision: 'CHANGES_REQUESTED' }));
      expect(verdict.timing).toBe('retroactive');
      expect(verdict.ready).toBeNull();
      expect(verdict.reasons.map(r => r.code)).toEqual(['retroactive_pr_state']);
    }
  });

  test('sub-verdicts separate budget, readiness, and evidence (CEO-V2)', () => {
    const over = judge(evidence({}, OPEN), { ...POLICY, max_net_lines: 0 });
    expect([over.within_budget, over.ready, over.evidence_complete]).toEqual([false, true, true]);
    const pending = judge(evidence({}, { ...OPEN, statusCheckRollup: [{ name: 'c', status: 'QUEUED' }] }));
    expect([pending.within_budget, pending.ready, pending.evidence_complete]).toEqual([true, false, true]);
    const unverifiable = judge(evidence({ dependencies: { manifests: [{ path: 'pom.xml', added: [], removed: [], unverifiable: true, unverifiable_detail: 'x' }] } }, OPEN));
    expect([unverifiable.within_budget, unverifiable.ready, unverifiable.evidence_complete]).toEqual([true, true, false]);
    expect(unverifiable.subject).toEqual({ origin: 'https://github.com/acme/widgets.git', pr_number: 42, pr_url: 'https://github.com/acme/widgets/pull/42', base_sha: SHA_A, head_sha: SHA_B, merge_base_sha: SHA_A, decision_id: null });
  });

  test('replay validation rejects mistyped fields', () => {
    expect(validateEvidence(evidence())).toBe(true);
    const bad = (mutate: (e: J) => void) => {
      const e: J = structuredClone(evidence({}, OPEN));
      mutate(e);
      return validateEvidence(e);
    };
    expect(bad(e => { e.git.files[0].additions = 'not-a-number'; })).toBe(false);
    expect(bad(e => { e.git.files[0].deletions = -1; })).toBe(false);
    expect(bad(e => { e.git.files[0].status = 'X'; })).toBe(false);
    expect(bad(e => { e.dependencies.manifests = [{ path: 'p', added: [{ name: 'a', classification: 'weird' }], removed: [], unverifiable: false }]; })).toBe(false);
    expect(bad(e => { e.public_api.files = [{ path: 'a.ts', added: 'x', removed: [] }]; })).toBe(false);
    expect(bad(e => { e.collection.failures = [{ stage: 's' }]; })).toBe(false);
    expect(bad(e => { e.pr.raw = []; })).toBe(false);
    expect(bad(e => { delete e.repo; })).toBe(false);
  });
});

/**
 * ENG-17 behavioral golden corpus: inline evidence and the verdicts `decide`
 * returns for it. A decide-side change moves the hash; bump `gate_version`
 * and add the new hash rather than editing an old one.
 */
const GOLDEN_VERDICTS: Record<string, string> = {
  '1': '2b8b75337f59987a3ce26868a63ecbd71c74d2a48c12d36e454631e3b59d994a',
};

describe('golden corpus (ENG-17)', () => {
  test('decide behavior is pinned per gate_version', () => {
    const lock = { path: 'bun.lock', old_path: null, old_mode: '100644', new_mode: '100644', old_oid: SHA_C, new_oid: SHA_C, status: 'A', additions: 900, deletions: 0, binary: false, submodule: false };
    const cases: [Evidence, Policy][] = [
      [evidence(), POLICY],
      [evidence({ git: { ...evidence().git, files: [...evidence().git.files, lock] } }), { ...POLICY, max_net_lines: 0, exclude: ['f.txt'] }],
      [evidence({}, { ...OPEN, isDraft: true, statusCheckRollup: [] }), { ...POLICY, max_churn: 0 }],
      [evidence({}, { ...OPEN, state: 'MERGED' }), POLICY],
      [evidence({ collection: { complete: false, failures: [{ stage: 'manifest', code: 'read_failed', subjects: ['package.json'] }] }, rename_detection_skipped: true }), POLICY],
      [evidence({ public_api: { files: [{ path: 'a.ts', added: [{ rule: 'ts-decl', name: 'A' }, { rule: 'ts-decl', name: 'B' }], removed: [{ rule: 'ts-decl', name: 'A' }] }, { path: 'a.test.ts', added: [{ rule: 'ts-decl', name: 'T' }], removed: [] }] } }), { ...POLICY, max_new_public_api: 0 }],
    ];
    const verdicts = cases.map(([e, p]) => judge(e, p));
    expect(GOLDEN_VERDICTS[String(GATE_VERSION)]).toBe(sha256Canonical(verdicts));
  });

  test('table fingerprints are pinned and a pattern change moves the hash', () => {
    expect(GATE_FINGERPRINTS[String(GATE_VERSION)]).toBe(hashGateTables());
    expect(COLLECTOR_FINGERPRINTS[String(COLLECTOR_VERSION)]).toBe(hashCollectorTables());
    const mutated = structuredClone(API_RULES);
    const first = mutated[0]?.matchers[0];
    if (!first) throw new Error('missing rule');
    first.pattern = { ...first.pattern, source: `${first.pattern.source}x` };
    expect(sha256Canonical(mutated)).not.toBe(sha256Canonical(API_RULES));
  });
});

// ---------------------------------------------------------------- pull request mode

describe('pull request mode', () => {
  test('number form passes -R and the fixed field list; pr.raw is frozen', () => {
    const pr = prRepo();
    const response = prJson(pr);
    const { run: r, path } = prRun(pr, [{ stdout: response }]);
    const verdict = out(r);
    expect(verdict.timing).toBe('open');
    expect(verdict.would_merge).toBe(true);
    expect(verdict.subject).toMatchObject({ pr_number: 7, head_sha: pr.head, base_sha: pr.base, origin: 'https://github.com/acme/widgets.git' });
    expect(ghCalls(path)).toEqual([['pr', 'view', '7', '-R', 'acme/widgets', '--json', GH_FIELDS]]);
    const stored = JSON.parse(readFileSync(verdict.evidence_path, 'utf8'));
    expect(stored.pr.raw).toEqual(response);
    expect(stored.pr.raw.labels).toEqual([{ name: 'shadow' }]);
    expect(stored.pr.raw_first).toBeNull();
    expect(stored.observed_at).toBe(NOW);
  });

  test('URL forms and enterprise hosts', () => {
    const pr = prRepo();
    for (const url of ['https://github.com/acme/widgets/pull/7', 'https://github.com/acme/widgets/pull/7/files#diff-1']) {
      const { run: r, path } = prRun(pr, [{ stdout: prJson(pr) }], ['--pr', url]);
      expect(out(r).would_merge).toBe(true);
      expect(ghCalls(path)[0]?.[4]).toBe('github.com/acme/widgets');
    }
    const ghe = prRepo('git@ghe.example.com:acme/widgets.git');
    const { run: hit, path } = prRun(ghe, [{ stdout: prJson(ghe, { url: 'https://ghe.example.com/acme/widgets/pull/7' }) }]);
    expect(out(hit).would_merge).toBe(true);
    expect(ghCalls(path)[0]?.[4]).toBe('ghe.example.com/acme/widgets');
    for (const bad of ['http://github.com/acme/widgets/pull/7', 'https://github.com/acme/widgets/issues/7', '0', '-3']) {
      expect(code(prRun(pr, [{ stdout: prJson(pr) }], ['--pr', bad]).run)).toBe('usage');
    }
  });

  test('SSH alias hosts match and --remote selects the base repository', () => {
    const alias = prRepo('git@github-work:acme/widgets.git');
    const { run: r, path } = prRun(alias, [{ stdout: prJson(alias) }]);
    expect(out(r).would_merge).toBe(true);
    expect(ghCalls(path)[0]?.[4]).toBe('acme/widgets');
    const fork = prRepo('https://github.com/me/widgets.git');
    git(fork.repo, ['remote', 'add', 'upstream', 'https://github.com/acme/widgets.git']);
    expect(code(prRun(fork, [{ stdout: prJson(fork) }]).run)).toBe('repo_mismatch');
    const { run: up, path: upPath } = prRun(fork, [{ stdout: prJson(fork) }], ['--pr', '7', '--remote', 'upstream']);
    expect(out(up).would_merge).toBe(true);
    expect(ghCalls(upPath)[0]?.[4]).toBe('acme/widgets');
  });

  test('repo_mismatch in URL form, number form, and across dotted hosts', () => {
    const pr = prRepo();
    expect(code(prRun(pr, [{ stdout: prJson(pr, { url: 'https://github.com/other/widgets/pull/7' }) }], ['--pr', 'https://github.com/other/widgets/pull/7']).run)).toBe('repo_mismatch');
    expect(code(prRun(pr, [{ stdout: prJson(pr, { url: 'https://github.com/other/widgets/pull/7' }) }]).run)).toBe('repo_mismatch');
    const ghe = prRepo('https://ghe.example.com/acme/widgets.git');
    expect(code(prRun(ghe, [{ stdout: prJson(ghe, { url: 'https://github.com/acme/widgets/pull/7' }) }]).run)).toBe('repo_mismatch');
  });

  test('mergeability retry: UNKNOWN then MERGEABLE, UNKNOWN twice, and a head that moves', () => {
    const pr = prRepo();
    const { run: r } = prRun(pr, [{ stdout: prJson(pr, { mergeable: 'UNKNOWN' }) }, { stdout: prJson(pr) }]);
    const verdict = out(r);
    expect(verdict.would_merge).toBe(true);
    const stored = JSON.parse(readFileSync(verdict.evidence_path, 'utf8'));
    expect(stored.pr.raw_first.mergeable).toBe('UNKNOWN');
    expect(stored.pr.raw.mergeable).toBe('MERGEABLE');
    expect(stored.pr.retry_wait_ms).toBe(0);
    expect(blocking(out(prRun(pr, [{ stdout: prJson(pr, { mergeable: 'UNKNOWN' }) }]).run))).toEqual(['mergeability_unknown']);
    const moved = commit(pr.repo, { 'a.txt': 'a\nb\nc\n' });
    const second = out(prRun(pr, [{ stdout: prJson(pr, { mergeable: 'UNKNOWN' }) }, { stdout: prJson({ ...pr, head: moved }) }]).run);
    expect(second.subject.head_sha).toBe(moved);
    expect(second.metrics.net_lines).toBe(2);
  });

  test('retroactive verdicts through the CLI', () => {
    const pr = prRepo();
    const verdict = out(prRun(pr, [{ stdout: prJson(pr, { state: 'MERGED', mergedAt: '2020-01-01T00:00:00Z', mergeable: 'UNKNOWN' }) }]).run);
    expect(verdict.timing).toBe('retroactive');
    expect(verdict.ready).toBeNull();
    expect(reasonCodes(verdict)).toEqual(['retroactive_pr_state']);
  });

  test('gh failures: missing, failing with redaction, auth, multiple remotes, bad JSON', () => {
    const pr = prRepo();
    expect(code(prRun(pr, [], ['--pr', '7'], { path: shimDir() }).run)).toBe('gh_missing');
    const failed = out(prRun(pr, [{ exit: 1, stderr: 'HTTP 404: token ghp_abcdefghijklmnop123 rejected\n' }]).run);
    expect(failed.error.code).toBe('gh_failed');
    expect(failed.error.message).toContain('[REDACTED]');
    expect(failed.error.message).not.toContain('ghp_');
    const auth = out(prRun(pr, [{ exit: 4, stderr: 'not logged in\n' }]).run);
    expect(auth.error).toMatchObject({ code: 'gh_auth', fix: 'gh auth status -h github.com; gh auth login -h github.com' });
    const multi = out(prRun(pr, [{ exit: 1, stderr: 'multiple remotes detected\n' }]).run);
    expect(multi.error.fix).toBe('pass the PR URL instead of a number');
    expect(code(prRun(pr, [{ stdout: '{not json' }]).run)).toBe('gh_bad_json');
    const { headRefOid: _drop, ...missing } = prJson(pr);
    expect(code(prRun(pr, [{ stdout: missing }]).run)).toBe('gh_bad_json');
    expect(code(prRun(pr, [{ stdout: prJson(pr, { number: '7' }) }]).run)).toBe('gh_bad_json');
  });

  test('missing commits produce one fetch line and a missing remote is no_remote', () => {
    const pr = prRepo();
    const gone = { ...pr, head: 'd'.repeat(40), base: 'e'.repeat(40) };
    const both = out(prRun(pr, [{ stdout: prJson(gone, { baseRefName: 'release;rm' }) }]).run);
    expect(both.error).toMatchObject({ code: 'commit_not_local', fix: "git fetch origin pull/7/head 'release;rm'" });
    const headOnly = out(prRun(pr, [{ stdout: prJson({ ...pr, head: 'd'.repeat(40) }) }]).run);
    expect(headOnly.error.fix).toBe('git fetch origin pull/7/head');
    git(pr.repo, ['remote', 'remove', 'origin']);
    expect(code(prRun(pr, [{ stdout: prJson(pr) }]).run)).toBe('no_remote');
  });

  test('spawn_timeout with --timeout 1', () => {
    const pr = prRepo();
    const r = prRun(pr, [{ sleepMs: 3000, stdout: prJson(pr) }], ['--pr', '7', '--timeout', '1']).run;
    expect(out(r).error).toMatchObject({ code: 'spawn_timeout', message: 'gh pr exceeded 1000ms' });
  }, 20_000);

  test('decision ids: round trip, per-PR independence, and URL/number spellings share a key', () => {
    const pr = prRepo();
    const state = tmp('state-');
    const path = shimDir({ gh: [{ stdout: prJson(pr) }] });
    const first = out(run(['check', '--pr', '7', '--decision-id', 'd1', '--json'], { cwd: pr.repo, test: true, state, path }));
    expect(first.idempotent).toBeUndefined();
    expect(first.subject.decision_id).toBe('d1');
    const again = out(run(['check', '--pr', 'https://github.com/acme/widgets/pull/7', '--decision-id', 'd1', '--json', '--max-net-lines', '0'], { cwd: pr.repo, test: true, state, path }));
    expect(again.idempotent).toBe(true);
    expect(again.evidence_id).toBe(first.evidence_id);
    expect(again.policy).toEqual(first.policy);
    expect(ghCalls(path)).toHaveLength(1);
    const other = shimDir({ gh: [{ stdout: prJson(pr, { number: 8, url: 'https://github.com/acme/widgets/pull/8' }) }] });
    expect(out(run(['check', '--pr', '8', '--decision-id', 'd1', '--json'], { cwd: pr.repo, test: true, state, path: other })).idempotent).toBeUndefined();
    expect(readVerdictLog(join(state, 'merge-gate/verdicts.jsonl')).verdicts).toHaveLength(2);
  });

  test('concurrent callers with one decision id record one decision and one line (ENG-4)', async () => {
    const pr = prRepo();
    const state = tmp('state-');
    const path = shimDir({ gh: [{ stdout: prJson(pr), sleepMs: 200 }] });
    const env = { ...process.env, HOME: tmp('home-'), GSTACK_EXTEND_STATE_DIR: state, GSTACK_EXTEND_MERGE_GATE_TEST: '1', GSTACK_EXTEND_MERGE_GATE_RETRY_MS: '0', PATH: path };
    const procs = [0, 1].map(() => Bun.spawn([BIN, 'check', '--pr', '7', '--decision-id', 'race', '--json'], { cwd: pr.repo, env, stdout: 'pipe', stderr: 'pipe' }));
    const results = await Promise.all(procs.map(async p => ({ status: await p.exited, body: JSON.parse(await new Response(p.stdout).text()) as J })));
    expect(results.map(r => r.status)).toEqual([0, 0]);
    expect(results[0]?.body.evidence_id).toBe(results[1]?.body.evidence_id);
    expect(readdirSync(join(state, 'merge-gate/decisions')).filter(n => n.endsWith('.json'))).toHaveLength(1);
    expect(readVerdictLog(join(state, 'merge-gate/verdicts.jsonl')).verdicts).toHaveLength(1);
  }, 20_000);

  test('a failed append is repaired by the retry, not skipped (ENG-4, ENG-2)', () => {
    const pr = prRepo();
    const state = tmp('state-');
    const path = shimDir({ gh: [{ stdout: prJson(pr) }] });
    mkdirSync(join(state, 'merge-gate'), { recursive: true, mode: 0o700 });
    chmodSync(join(state, 'merge-gate'), 0o700);
    writeFileSync(join(state, 'merge-gate/verdicts.jsonl'), '', { mode: 0o400 });
    const failed = run(['check', '--pr', '7', '--decision-id', 'd1', '--json'], { cwd: pr.repo, test: true, state, path });
    expect(code(failed)).toBe('store_error');
    const decisions = readdirSync(join(state, 'merge-gate/decisions'));
    expect(decisions.filter(n => n.endsWith('.json'))).toHaveLength(1);
    expect(decisions.filter(n => n.endsWith('.logged'))).toHaveLength(0);
    chmodSync(join(state, 'merge-gate/verdicts.jsonl'), 0o600);
    const retry = out(run(['check', '--pr', '7', '--decision-id', 'd1', '--json'], { cwd: pr.repo, test: true, state, path }));
    expect(retry.idempotent).toBe(true);
    const log = readVerdictLog(join(state, 'merge-gate/verdicts.jsonl'));
    expect(log.verdicts).toHaveLength(1);
    expect((log.verdicts[0] as J).evidence_id).toBe(retry.evidence_id);
    run(['check', '--pr', '7', '--decision-id', 'd1', '--json'], { cwd: pr.repo, test: true, state, path });
    expect(readVerdictLog(join(state, 'merge-gate/verdicts.jsonl')).verdicts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- cannot merge

describe('cannot merge, by construction', () => {
  test('runtime: every spawned argv is allowlisted and repository state is unchanged', () => {
    const pr = prRepo();
    writeFileSync(join(pr.repo, 'untracked.txt'), 'u\n');
    const snapshot = () => ({
      refs: git(pr.repo, ['for-each-ref', '--format=%(refname) %(objectname)']),
      head: git(pr.repo, ['symbolic-ref', 'HEAD']) + git(pr.repo, ['rev-parse', 'HEAD']),
      index: sha256Hex(readFileSync(join(pr.repo, '.git/index'))),
      status: git(pr.repo, ['--no-optional-locks', 'status', '--porcelain=v1', '--untracked-files=all']),
      config: readFileSync(join(pr.repo, '.git/config'), 'utf8'),
    });
    const before = snapshot();
    const path = shimDir({ git: 'log', gh: [{ stdout: prJson(pr, { mergeable: 'UNKNOWN' }) }, { stdout: prJson(pr) }] });
    const r = run(['check', '--pr', '7', '--decision-id', 'x', '--json'], { cwd: pr.repo, test: true, path });
    expect(out(r).would_merge).toBe(true);
    const calls = [...gitCalls(path).map(a => ['git', a] as const), ...ghCalls(path).map(a => ['gh', a] as const)];
    expect(calls.length).toBeGreaterThan(8);
    for (const [cmd, args] of calls) expect(() => assertArgvAllowed(cmd, args)).not.toThrow();
    expect(snapshot()).toEqual(before);
  });

  test('allowlist unit checks (forbidden_command)', () => {
    const attr = '--attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904';
    for (const [cmd, args] of [['git', ['merge']], ['git', [attr, 'push']], ['git', [attr, 'fetch', 'origin']], ['gh', ['pr', 'merge', '1']], ['gh', ['api', 'x']], ['git', [attr, 'config', 'user.name', 'x']], ['git', [attr, '-c', 'x=y', 'version']]] as [string, string[]][]) {
      expect(() => assertArgvAllowed(cmd, args)).toThrow(GateError);
    }
    expect(() => assertArgvAllowed('git', ['version'])).not.toThrow();
  });

  const SRC = join(ROOT, 'src/merge-gate');
  const NETWORK = ['fetch(', 'node:http', 'node:https', 'node:http2', 'node:net', 'node:tls', 'node:dgram', 'node:dns', 'WebSocket', 'XMLHttpRequest', 'Bun.connect', 'Bun.listen', 'Bun.serve', 'Bun.udpSocket', 'eval(', 'new Function', 'Bun.Worker', 'Worker('];
  const VERBS = ['merge', 'push', 'commit', 'update-ref', 'checkout', 'reset', 'fetch', 'pull', 'rebase', 'tag', 'api'];
  const IMPORTS = new Set(['node:fs', 'node:path', 'node:crypto', 'node:os']);

  /** ENG-9: one scanner for the real tree and for injected fixtures. */
  function scanSource(file: string, text: string): string[] {
    const rel = relative(SRC, file);
    const isExec = rel === 'exec.ts';
    const found: string[] = [];
    const specs = [...text.matchAll(/(?:\bfrom\s*|\bimport\s*)['"]([^'"]+)['"]/g)].map(m => m[1] ?? '');
    for (const spec of specs) {
      if (spec.startsWith('.')) {
        const target = resolve(dirname(file), spec);
        if (!target.startsWith(`${SRC}/`)) found.push(`escape ${spec}`);
      } else if (!(IMPORTS.has(spec) || (isExec && spec === 'node:child_process'))) found.push(`import ${spec}`);
    }
    if (/\bimport\s*\(|\brequire\s*\(/.test(text)) found.push('dynamic import');
    for (const token of NETWORK) if (text.includes(token)) found.push(`network ${token}`);
    if (!isExec && /Bun\.\$|Bun\.spawn|child_process|spawnSync|execSync/.test(text)) found.push('spawn');
    if (isExec) {
      for (const verb of VERBS) {
        if ([`'${verb}'`, `"${verb}"`, `\`${verb}\``].some(q => text.includes(q))) found.push(`verb ${verb}`);
      }
    }
    return found;
  }

  test('static: the real tree passes and injected fixtures fail', () => {
    const files = readdirSync(SRC).filter(n => n.endsWith('.ts')).map(n => join(SRC, n));
    expect(files.length).toBeGreaterThan(8);
    const violations = files.flatMap(f => scanSource(f, readFileSync(f, 'utf8')).map(v => `${relative(SRC, f)}: ${v}`));
    expect(violations).toEqual([]);
    const bad: [string, string][] = [
      ['collect.ts', "import { x } from '../audit/lib/git.ts';\n"],
      ['collect.ts', "import 'bun:ffi';\n"],
      ['collect.ts', "import vm from 'node:vm';\n"],
      ['collect.ts', "import { x } from '../../tests/helpers/run-bin.ts';\n"],
      ['collect.ts', "const m = await import('./x.ts');\n"],
      ['collect.ts', "import { spawnSync } from 'node:child_process';\n"],
      ['decide.ts', 'await fetch("https://x");\n'],
      ['exec.ts', "const verb = 'push';\n"],
      ['exec.ts', 'const verb = `fetch`;\n'],
    ];
    for (const [name, text] of bad) expect({ name, text, found: scanSource(join(SRC, name), text).length > 0 }).toMatchObject({ found: true });
  });
});

// ---------------------------------------------------------------- store

describe('store', () => {
  test('evidence is written once, its hash is its id, and tampering fails replay (CEO-S10)', () => {
    const repo = changeRepo({ 'a.txt': 'a\n' }, { 'a.txt': 'a\nb\n' });
    const state = tmp('state-');
    const first = out(run(['check', '--base', 'HEAD~1', '--json'], { cwd: repo, state }));
    const bytes = readFileSync(first.evidence_path);
    expect(sha256Hex(bytes)).toBe(first.evidence_id);
    expect(statSync(first.evidence_path).mode & 0o777).toBe(0o600);
    expect(statSync(join(state, 'merge-gate')).mode & 0o777).toBe(0o700);
    writeFileSync(first.evidence_path, bytes.subarray(0, bytes.length - 2));
    expect(code(run(['replay', '--evidence', first.evidence_id, '--json'], { cwd: repo, state }))).toBe('evidence_corrupt');
  });

  test('different bytes under an existing id fail and a leftover temp file does not block', () => {
    const state = tmp('state-');
    const env = { GSTACK_EXTEND_STATE_DIR: state };
    const id = 'f'.repeat(64);
    writeEvidence(env, Buffer.from('{"a":1}'), id);
    writeFileSync(join(state, 'merge-gate/evidence/.tmp-1-abcdef'), 'junk');
    expect(writeEvidence(env, Buffer.from('{"a":1}'), id)).toBe(join(state, 'merge-gate/evidence', `${id}.json`));
    expect(() => writeEvidence(env, Buffer.from('{"a":2}'), id)).toThrow(GateError);
    writeEvidence(env, Buffer.from('{"b":1}'), 'e'.repeat(64));
  });

  test('a torn trailing line is repaired and readers count malformed lines (ENG-2)', () => {
    const repo = changeRepo({ 'a.txt': 'a\n' }, { 'a.txt': 'a\nb\n' });
    const state = tmp('state-');
    mkdirSync(join(state, 'merge-gate'), { recursive: true });
    chmodSync(join(state, 'merge-gate'), 0o700);
    writeFileSync(join(state, 'merge-gate/verdicts.jsonl'), '{"partial":', { mode: 0o600 });
    expect(run(['check', '--base', 'HEAD~1', '--json'], { cwd: repo, state }).status).toBe(0);
    const text = readFileSync(join(state, 'merge-gate/verdicts.jsonl'), 'utf8');
    expect(text.split('\n')).toHaveLength(3);
    const log = readVerdictLog(join(state, 'merge-gate/verdicts.jsonl'));
    expect(log.skipped_lines).toBe(1);
    expect(log.verdicts).toHaveLength(1);
    expect((log.verdicts[0] as J).evidence_path).toBeUndefined();
  });

  test('symlinked, loose-mode, foreign, and read-only stores fail cleanly', () => {
    const repo = changeRepo({ 'a.txt': 'a\n' }, { 'a.txt': 'a\nb\n' });
    const linked = tmp('state-');
    const real = tmp('real-');
    symlinkSync(real, join(linked, 'merge-gate'));
    expect(code(run(['check', '--base', 'HEAD~1', '--json'], { cwd: repo, state: linked }))).toBe('store_refused');
    const loose = tmp('state-');
    mkdirSync(join(loose, 'merge-gate'), { mode: 0o755 });
    chmodSync(join(loose, 'merge-gate'), 0o755);
    expect(code(run(['check', '--base', 'HEAD~1', '--json'], { cwd: repo, state: loose }))).toBe('store_refused');
    expect(code(run(['replay', '--all', '--jsonl'], { cwd: repo, state: loose }))).toBe('store_refused');
    const parent = tmp('ro-');
    chmodSync(parent, 0o555);
    const readOnly = run(['check', '--base', 'HEAD~1'], { cwd: repo, state: join(parent, 'state') });
    expect(readOnly.status).toBe(1);
    expect(readOnly.stdout).toBe('');
    expect(readOnly.stderr).toContain('ERROR store_error');
    expect(readOnly.stderr).toContain('--no-record');
    chmodSync(parent, 0o755);
  });
});

// ---------------------------------------------------------------- replay

describe('replay (CEO-S6, DX-12)', () => {
  function recorded(): { repo: string; state: string; verdict: J } {
    const repo = changeRepo({ 'a.txt': 'a\n' }, { 'a.txt': 'a\nb\n' });
    const state = tmp('state-');
    const verdict = out(run(['check', '--base', 'HEAD~1', '--json'], { cwd: repo, state, test: true }));
    return { repo, state, verdict };
  }

  test('by id, by path, and by an arbitrary filename', () => {
    const { repo, state, verdict } = recorded();
    const byId = out(run(['replay', '--evidence', verdict.evidence_id, '--json'], { cwd: repo, state }));
    expect(byId).toMatchObject({ replay: true, evidence_id: verdict.evidence_id, would_merge: true, observed_at: NOW });
    expect(out(run(['replay', '--evidence', verdict.evidence_path, '--json'], { cwd: repo, state })).evidence_id).toBe(verdict.evidence_id);
    const copy = join(tmp('copy-'), 'saved.json');
    writeFileSync(copy, readFileSync(verdict.evidence_path));
    expect(out(run(['replay', '--evidence', copy, '--json'], { cwd: repo, state })).evidence_id).toBe(verdict.evidence_id);
    expect(code(run(['replay', '--evidence', join(tmp('none-'), 'x.json'), '--json'], { cwd: repo, state }))).toBe('evidence_not_found');
  });

  test('--all orders by observed_at, reports failures by filename, skips temp files, and exits 1', () => {
    const { repo, state, verdict } = recorded();
    const dir = join(state, 'merge-gate/evidence');
    const corrupt = '0'.repeat(64);
    writeFileSync(join(dir, `${corrupt}.json`), '{"v":1}');
    writeFileSync(join(dir, '.tmp-1-abc'), 'junk');
    const jsonl = run(['replay', '--all', '--jsonl'], { cwd: repo, state });
    expect(jsonl.status).toBe(1);
    const rows = jsonl.stdout.trim().split('\n').map(l => JSON.parse(l) as J);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ evidence_id: corrupt, error: { code: 'evidence_corrupt' } });
    expect(rows[1]).toMatchObject({ evidence_id: verdict.evidence_id, replay: true });
    const human = run(['replay', '--all'], { cwd: repo, state });
    expect(human.stdout.split('\n')[0]).toBe(`error ${corrupt} evidence_corrupt`);
    expect(human.stdout.split('\n')[1]).toMatch(new RegExp(`^yes ${verdict.evidence_id} local [0-9a-f]{7}\\.\\.[0-9a-f]{7} -$`));
  });

  test('an empty store exits 0 with no output', () => {
    const r = run(['replay', '--all', '--jsonl']);
    expect([r.status, r.stdout]).toEqual([0, '']);
  });

  test('unknown v, a newer collector, and invalid structure fail', () => {
    const { repo, state, verdict } = recorded();
    const value = JSON.parse(readFileSync(verdict.evidence_path, 'utf8'));
    const write = (mutate: (e: J) => void) => {
      const e = structuredClone(value);
      mutate(e);
      const path = join(tmp('ev-'), 'e.json');
      writeFileSync(path, JSON.stringify(e));
      return code(run(['replay', '--evidence', path, '--json'], { cwd: repo, state }));
    };
    expect(write(e => { e.v = 2; })).toBe('evidence_unsupported_version');
    expect(write(e => { e.collector_version = COLLECTOR_VERSION + 1; })).toBe('evidence_unsupported_version');
    expect(write(e => { e.git.files[0].additions = 'not-a-number'; })).toBe('evidence_corrupt');
    expect(write(e => { e.dependencies = {}; })).toBe('evidence_corrupt');
  });

  test('a policy override changes the verdict with zero spawns', () => {
    const { repo, state, verdict } = recorded();
    const path = tmp('path-');
    symlinkSync(BUN, join(path, 'bun'));
    for (const name of ['git', 'gh']) writeExec(join(path, name), `#!/bin/sh\n: > "\${0%/*}/spawned-${name}"\nexit 1\n`);
    const policy = join(tmp('policy-'), 'p.json');
    writeFileSync(policy, JSON.stringify(verdict.policy));
    const same = out(run(['replay', '--evidence', verdict.evidence_id, '--policy', policy, '--json'], { cwd: repo, state, path }));
    expect(same.policy_sha256).toBe(verdict.policy_sha256);
    expect(same.would_merge).toBe(true);
    const tighter = out(run(['replay', '--evidence', verdict.evidence_id, '--max-net-lines', '0', '--json'], { cwd: repo, state, path }));
    expect(blocking(tighter)).toEqual(['net_lines_over_budget']);
    expect(readdirSync(path).filter(n => n.startsWith('spawned'))).toEqual([]);
  });
});

// ---------------------------------------------------------------- errors, one per code

type ErrorCase = { code: string; exit: number; run: () => Run };

describe('errors end to end (CEO-S4)', () => {
  const change = () => changeRepo({ 'a.txt': 'a\n' }, { 'a.txt': 'a\nb\n' });
  const pr = () => prRepo();
  const CASES: ErrorCase[] = [
    { code: 'usage', exit: 2, run: () => run(['check', '--json']) },
    { code: 'not_a_repo', exit: 1, run: () => run(['check', '--base', 'HEAD', '--json', '--no-record'], { cwd: tmp('plain-') }) },
    { code: 'git_missing', exit: 1, run: () => run(['check', '--base', 'HEAD', '--json', '--no-record'], { cwd: change(), path: shimDir({ git: 'none' }) }) },
    { code: 'git_unsupported_version', exit: 1, run: () => run(['check', '--base', 'HEAD~1', '--json', '--no-record'], { cwd: change(), path: shimDir({ git: gitVersionShim('2.39.5') }) }) },
    { code: 'ref_not_found', exit: 1, run: () => run(['check', '--base', 'nope', '--json', '--no-record'], { cwd: change() }) },
    {
      code: 'no_merge_base', exit: 1, run: () => {
        const repo = change();
        git(repo, ['checkout', '--quiet', '--orphan', 'other']);
        commit(repo, { 'z.txt': 'z\n' }, 'orphan');
        return run(['check', '--base', 'main', '--json', '--no-record'], { cwd: repo });
      },
    },
    { code: 'commit_not_local', exit: 1, run: () => { const p = pr(); return prRun(p, [{ stdout: prJson({ ...p, head: 'd'.repeat(40) }) }]).run; } },
    { code: 'no_remote', exit: 1, run: () => run(['check', '--pr', '7', '--json'], { cwd: change(), test: true, path: shimDir({ gh: [{ stdout: '{}' }] }) }) },
    { code: 'repo_mismatch', exit: 1, run: () => { const p = pr(); return prRun(p, [{ stdout: prJson(p, { url: 'https://github.com/x/y/pull/7' }) }]).run; } },
    { code: 'gh_missing', exit: 1, run: () => prRun(pr(), [], ['--pr', '7'], { path: shimDir() }).run },
    { code: 'gh_failed', exit: 1, run: () => prRun(pr(), [{ exit: 1, stderr: 'boom\n' }]).run },
    { code: 'gh_bad_json', exit: 1, run: () => prRun(pr(), [{ stdout: 'nope' }]).run },
    { code: 'gh_auth', exit: 1, run: () => prRun(pr(), [{ exit: 4 }]).run },
    { code: 'spawn_timeout', exit: 1, run: () => prRun(pr(), [{ sleepMs: 2000 }], ['--pr', '7'], { env: { GSTACK_EXTEND_MERGE_GATE_TIMEOUT_MS: '200' } }).run },
    { code: 'evidence_not_found', exit: 1, run: () => run(['replay', '--evidence', 'f'.repeat(64), '--json']) },
    {
      code: 'evidence_corrupt', exit: 1, run: () => {
        const path = join(tmp('ev-'), `${'a'.repeat(64)}.json`);
        writeFileSync(path, '{}');
        return run(['replay', '--evidence', path, '--json']);
      },
    },
    {
      code: 'evidence_unsupported_version', exit: 1, run: () => {
        const path = join(tmp('ev-'), 'x.json');
        writeFileSync(path, '{"v":9}');
        return run(['replay', '--evidence', path, '--json']);
      },
    },
    { code: 'store_error', exit: 1, run: () => { const p = tmp('ro-'); chmodSync(p, 0o555); return run(['check', '--base', 'HEAD~1', '--json'], { cwd: change(), state: join(p, 's') }); } },
    { code: 'store_refused', exit: 1, run: () => { const s = tmp('state-'); symlinkSync(tmp('real-'), join(s, 'merge-gate')); return run(['check', '--base', 'HEAD~1', '--json'], { cwd: change(), state: s }); } },
    { code: 'test_env_refused', exit: 1, run: () => run(['--version', '--json'], { env: { GSTACK_EXTEND_MERGE_GATE_NOW: NOW } }) },
    { code: 'bun_missing', exit: 1, run: () => run(['--version', '--json'], { path: '/nonexistent' }) },
    { code: 'git_failed', exit: 1, run: () => run(['check', '--base', 'HEAD~1', '--json', '--no-record'], { cwd: change(), path: shimDir({ git: `#!/bin/sh\nfor a in "$@"; do [ "$a" = --raw ] && { echo 'fatal: boom' >&2; exit 128; }; done\nexec '${REAL_GIT}' "$@"\n` }) }) },
  ];

  for (const c of CASES) {
    test(c.code, () => {
      const r = c.run();
      expect({ exit: r.status, code: code(r) }).toEqual({ exit: c.exit, code: c.code });
      const err = out(r).error;
      expect(Object.keys(out(r))).toEqual(['error', 'v']);
      expect(Object.keys(err)).toEqual(['code', 'doc', 'fix', 'message']);
      expect(err.doc).toBe('docs/merge-gate.md#errors');
    }, 20_000);
  }

  test('every registry code has an end-to-end case or a unit case', () => {
    const covered = new Set([...CASES.map(c => c.code), 'forbidden_command', 'internal_error']);
    expect(ERROR_CODES.filter(c => !covered.has(c))).toEqual([]);
  });

  test('internal_error comes from main when a dependency throws (CEO-R5)', async () => {
    let stdout = '';
    let stderr = '';
    const status = await main(['--version', '--json'], { stdout: s => { stdout += s; }, stderr: s => { stderr += s; }, fail() { throw new Error('boom'); } });
    expect(status).toBe(1);
    expect(JSON.parse(stdout).error.code).toBe('internal_error');
    expect(stderr).toContain('boom');
  });

  test('git floor: 2.41 for a full clone, 2.45 for a partial clone; ref_not_found suggests the remote ref', () => {
    const repo = change();
    const check = (version: string) => out(run(['check', '--base', 'HEAD~1', '--json', '--no-record'], { cwd: repo, path: shimDir({ git: gitVersionShim(version) }) }));
    expect(check('2.40.9').error).toMatchObject({ code: 'git_unsupported_version', message: 'git 2.40 is below 2.41', fix: 'install git 2.41 or newer' });
    expect(check('2.44.0').would_merge).toBe(true);
    git(repo, ['config', 'remote.origin.url', 'https://github.com/acme/widgets.git']);
    git(repo, ['config', 'remote.origin.promisor', 'true']);
    expect(check('2.44.0').error).toMatchObject({ code: 'git_unsupported_version', message: 'git 2.44 is below 2.45 (partial clone)' });
    expect(check('2.45.0').would_merge).toBe(true);
    git(repo, ['update-ref', 'refs/remotes/origin/feature', 'HEAD']);
    expect(out(run(['check', '--base', 'feature', '--json', '--no-record'], { cwd: repo })).error.fix).toBe('try origin/feature');
  });

  test("the user's global safe.directory survives the empty child config; a repo-local one does not", () => {
    const repo = change();
    const foreign = shimDir({ git: `#!/bin/sh\nGIT_TEST_ASSUME_DIFFERENT_OWNER=1 exec '${REAL_GIT}' "$@"\n` });
    const isolated = () => ({ HOME: tmp('home-'), XDG_CONFIG_HOME: tmp('xdg-'), GIT_CONFIG_NOSYSTEM: '1' });
    const check = (env: NodeJS.ProcessEnv) => run(['check', '--base', 'HEAD~1', '--json', '--no-record'], { cwd: repo, path: foreign, env });
    expect(code(check(isolated()))).toBe('not_a_repo');
    const trusted = isolated();
    writeFileSync(join(trusted.HOME, '.gitconfig'), '[safe]\n\tdirectory = *\n');
    expect(out(check(trusted)).would_merge).toBe(true);
    git(repo, ['config', 'safe.directory', '*']);
    expect(code(check(isolated()))).toBe('not_a_repo');
  });

  test('a git process killed by a signal is a recorded failure, not success', () => {
    const repo = changeRepo({ 'x.txt': 'x\n' }, { 'a.ts': 'export const A = 1;\n' });
    const killer = shimDir({ git: `#!/bin/sh\nfor a in "$@"; do [ "$a" = -U0 ] && kill -9 $$; done\nexec '${REAL_GIT}' "$@"\n` });
    const verdict = out(run(['check', '--base', 'HEAD~1', '--json', '--no-record'], { cwd: repo, path: killer }));
    expect(blocking(verdict)).toContain('evidence_incomplete');
    expect(verdict.metrics.unmeasured_api_files).toEqual([{ path: 'a.ts', reason: 'patch_failed' }]);
  });

  test('an oversized raw diff is evidence_incomplete (CEO-S8)', () => {
    const repo = changeRepo({ 'x.txt': 'x\n' }, { 'x.txt': 'y\n' });
    const dir = tmp('path-');
    symlinkSync(BUN, join(dir, 'bun'));
    writeFileSync(join(dir, 'big.js'), [
      "const { spawnSync } = require('node:child_process');",
      "const { writeSync } = require('node:fs');",
      'const args = process.argv.slice(2);',
      "if (args.includes('--raw')) { const mb = Buffer.alloc(1024 * 1024, 97); for (let i = 0; i < 65; i++) writeSync(1, mb); process.exit(0); }",
      `process.exit(spawnSync('${REAL_GIT}', args, { stdio: 'inherit' }).status ?? 1);`,
    ].join('\n'));
    writeExec(join(dir, 'git'), `#!/bin/sh\nexec '${BUN}' '${join(dir, 'big.js')}' "$@"\n`);
    const verdict = out(run(['check', '--base', 'HEAD~1', '--json', '--no-record'], { cwd: repo, path: dir }));
    expect(blocking(verdict)).toEqual(['evidence_incomplete']);
    expect(verdict.reasons[0].detail).toBe('diff: buffer_overflow');
  }, 30_000);
});

// ---------------------------------------------------------------- CLI contract

describe('cli contract', () => {
  test('help, version, and budget flags (CEO-D3, DX-4)', () => {
    const help = run(['--help']);
    expect(help.status).toBe(0);
    for (const line of ['merge-gate check --base main --no-record', 'merge-gate check --pr 123 --json', 'merge-gate replay --evidence <id> --json', '--max-net-lines N', '--max-churn N', '--policy <path|->', '--exclude <glob>']) {
      expect(help.stdout).toContain(line);
    }
    expect(run(['check', '--help']).stdout).toContain('--decision-id <id>');
    expect(run(['replay', '-h']).status).toBe(0);
    expect(out(run(['--version', '--json']))).toEqual({ collector_version: COLLECTOR_VERSION, evidence_v: 1, gate_version: GATE_VERSION, gstack_extend_version: VERSION, verdict_v: 1 });
  });

  test('usage errors name the flag and the value (DX-15)', () => {
    const repo = change();
    const message = (args: string[]) => out(run([args[0] ?? '', '--json', ...args.slice(1)], { cwd: repo })).error;
    expect(message(['check', '--max-net-lines', '-3', '--base', 'HEAD'])).toMatchObject({ code: 'usage', message: "--max-net-lines: '-3' is not a non-negative integer or none" });
    expect(message(['check', '--base']).message).toBe('--base requires a value');
    expect(message(['check', '--base', '-x']).message).toBe("--base: '-x' starts with -, which is not a valid value");
    expect(message(['check', '--base', 'HEAD', '--evidence', 'x']).message).toBe('--evidence is not a check flag');
    expect(message(['replay', '--all', '--base', 'HEAD']).message).toBe('--base is not a replay flag');
    expect(message(['check', '--base', 'HEAD', '--jsonl']).code).toBe('usage');
    expect(message(['replay', '--evidence', 'x', '--jsonl']).message).toBe('--jsonl is only valid with replay --all');
    expect(message(['replay', '--all']).code).toBe('usage');
    expect(message(['check', '--pr', '1', '--remote', '-bad']).code).toBe('usage');
    expect(message(['check', '--pr', '1', '--remote', 'a b']).message).toBe("--remote: 'a b' is not a remote name");
    expect(message(['check', '--base', 'HEAD', '--policy', '/nonexistent/p.json']).message).toBe("--policy: could not read '/nonexistent/p.json' (ENOENT)");
    expect(message(['check', '--pr', '1', '--decision-id', 'bad id']).code).toBe('usage');
    expect(message(['check', '--base', 'HEAD', '--decision-id', 'x']).code).toBe('usage');
    expect(message(['check', '--repo-root', 'acme/widgets', '--base', 'HEAD']).message).toContain('looks like owner/name');
    expect(message(['check', '--base', 'HEAD', '--exclude', 'src/[a].ts']).code).toBe('usage');
    expect(message(['check', '--base', 'HEAD', 'toString']).message).toBe('unknown flag toString');
  });

  const change = () => changeRepo({ 'a.txt': 'a\n' }, { 'a.txt': 'a\nb\n' });

  test('--policy from a file and from stdin; flags override it (DX-3)', () => {
    const repo = change();
    const fromStdin = out(run(['check', '--base', 'HEAD~1', '--json', '--no-record', '--policy', '-'], { cwd: repo, stdin: '{"max_net_lines":0}' }));
    expect(fromStdin.policy).toEqual({ exclude: [], max_churn: null, max_net_lines: 0, max_new_deps: null, max_new_files: null, max_new_public_api: null });
    expect(blocking(fromStdin)).toEqual(['net_lines_over_budget']);
    const overridden = out(run(['check', '--base', 'HEAD~1', '--json', '--no-record', '--policy', '-', '--max-net-lines', '5'], { cwd: repo, stdin: '{"max_net_lines":0}' }));
    expect(overridden.would_merge).toBe(true);
    expect(code(run(['check', '--base', 'HEAD~1', '--json', '--no-record', '--policy', '-'], { cwd: repo, stdin: '{"bogus":1}' }))).toBe('usage');
  });

  test('golden human output: unanchored (DX-6)', () => {
    const repo = change();
    const base = git(repo, ['rev-parse', '--short=7', 'HEAD~1']);
    const head = git(repo, ['rev-parse', '--short=7', 'HEAD']);
    const human = run(['check', '--base', 'HEAD~1', '--no-record'], { cwd: repo });
    expect(human.status).toBe(0);
    expect(human.stdout).toBe([
      'WOULD_MERGE: yes',
      'MODE: shadow',
      'GATE: v1',
      'TIMING: unanchored',
      `SUBJECT: local ${base}..${head}`,
      'VERDICTS: within_budget=yes ready=not checked evidence_complete=yes',
      'METRICS: net_lines=1/500 churn=1/off new_files=0/10 new_deps=0/0 new_public_api=0/10',
      'TOP_CHURN: a.txt (1)',
      'REASONS:',
      '- pr_signals_not_checked: git-only mode does not read pull request signals (info)',
      'DOCS: docs/merge-gate.md#reasons',
      'EVIDENCE: not recorded (--no-record)',
      '',
    ].join('\n'));
  });

  test('golden human output: open and retroactive (DX-6)', () => {
    const pr = prRepo();
    const head = pr.head.slice(0, 7);
    const humanPr = (raw: Record<string, unknown>) => run(['check', '--pr', '7', '--no-record'], { cwd: pr.repo, test: true, path: shimDir({ gh: [{ stdout: prJson(pr, raw) }] }) }).stdout;
    expect(humanPr({ reviewDecision: 'REVIEW_REQUIRED' })).toBe([
      'WOULD_MERGE: no',
      'MODE: shadow',
      'GATE: v1',
      'TIMING: open',
      `SUBJECT: github.com/acme/widgets#7 @ ${head}`,
      'VERDICTS: within_budget=yes ready=no evidence_complete=yes',
      'METRICS: net_lines=1/500 churn=1/off new_files=0/10 new_deps=0/0 new_public_api=0/10',
      'TOP_CHURN: a.txt (1)',
      'REASONS:',
      '- review_required: reviewDecision is REVIEW_REQUIRED (blocking)',
      '- github_merge_state: mergeStateStatus is CLEAN (info)',
      'DOCS: docs/merge-gate.md#reasons',
      'EVIDENCE: not recorded (--no-record)',
      '',
    ].join('\n'));
    expect(humanPr({ state: 'CLOSED' }).split('\n').slice(3, 10)).toEqual([
      'TIMING: retroactive',
      `SUBJECT: github.com/acme/widgets#7 @ ${head}`,
      'VERDICTS: within_budget=yes ready=not checked evidence_complete=yes',
      'METRICS: net_lines=1/500 churn=1/off new_files=0/10 new_deps=0/0 new_public_api=0/10',
      'TOP_CHURN: a.txt (1)',
      'REASONS:',
      '- retroactive_pr_state: pull request state is CLOSED; PR signals are not applied to a closed observation (info)',
    ]);
  });

  test('human output strips terminal and bidi controls; JSON keeps them (CEO-R3)', () => {
    const name = 'a\u001b[31mred‮txt.txt';
    const repo = changeRepo({ 'x.txt': 'x\n' }, { [name]: 'r\n' });
    const human = run(['check', '--base', 'HEAD~1', '--no-record'], { cwd: repo }).stdout;
    expect(human).toContain('TOP_CHURN: a[31mredtxt.txt (1)');
    expect(/[\u001b‮]/.test(human)).toBe(false);
    expect(checkQuick(repo).metrics.top_churn_files[0].path).toBe(name);
  });

  test('debug tracing never changes stdout (CEO-R7)', () => {
    const repo = change();
    const plain = run(['check', '--base', 'HEAD~1', '--json', '--no-record'], { cwd: repo, test: true });
    const traced = run(['check', '--base', 'HEAD~1', '--json', '--no-record'], { cwd: repo, test: true, env: { GSTACK_EXTEND_MERGE_GATE_DEBUG: '1' } });
    expect(traced.stdout).toBe(plain.stdout);
    expect(traced.stderr).toContain('debug argv=git version status=0');
  });

  test('a hostile cwd cannot preload code or redirect the store (ENG-8)', () => {
    const repo = change();
    const marker = join(tmp('marker-'), 'PRELOADED');
    writeFileSync(join(repo, 'evil.ts'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x');\n`);
    writeFileSync(join(repo, 'bunfig.toml'), 'preload = ["./evil.ts"]\n');
    const evilStore = tmp('evil-');
    writeFileSync(join(repo, '.env'), `GSTACK_EXTEND_STATE_DIR=${evilStore}\nGSTACK_EXTEND_MERGE_GATE_NOW=1999-01-01T00:00:00Z\n`);
    const r = run(['check', '--base', 'HEAD~1', '--json'], { cwd: repo });
    expect(r.status).toBe(0);
    expect(existsSync(marker)).toBe(false);
    expect(readdirSync(evilStore)).toEqual([]);
    expect(out(r).evidence_path.startsWith(r.state)).toBe(true);
  });

  test('test overrides need the guard and an explicit store (ENG-12)', () => {
    const repo = change();
    expect(code(run(['check', '--base', 'HEAD~1', '--json'], { cwd: repo, env: { GSTACK_EXTEND_MERGE_GATE_NOW: NOW } }))).toBe('test_env_refused');
    const honored = out(run(['check', '--base', 'HEAD~1', '--json'], { cwd: repo, test: true }));
    expect(honored.decided_at).toBe(NOW);
    const stored = JSON.parse(readFileSync(honored.evidence_path, 'utf8'));
    expect(stored.test_overrides).toEqual(['GSTACK_EXTEND_MERGE_GATE_NOW', 'GSTACK_EXTEND_MERGE_GATE_RETRY_MS']);
    expect(stored.clock_overridden).toBe(true);
  });

  test('evidence stores no absolute local path and strips credentials (CEO-S5, ENG-11)', () => {
    const repo = change();
    // A fake token, assembled at runtime so secret scanners do not flag the fixture.
    const credentialed = `${['https://user', `ghp_${'secret123'}`].join(':')}@github.com/acme/widgets.git?x=1#frag`;
    git(repo, ['remote', 'add', 'origin', credentialed]);
    expect(checkRecorded(repo).evidence.repo.origin).toBe('https://github.com/acme/widgets.git');
    git(repo, ['remote', 'set-url', 'origin', '/srv/git/widgets.git']);
    const { evidence } = checkRecorded(repo);
    expect(evidence.repo.origin).toBe('local:widgets.git');
    expect(JSON.stringify(evidence)).not.toContain(repo);
  });

  test('the shim runs through a symlink with a PATH holding only bun, and fails a loop cleanly (DX-1)', () => {
    const dir = tmp('link-');
    const link = join(dir, 'merge-gate');
    symlinkSync(BIN, link);
    const path = tmp('path-');
    symlinkSync(BUN, join(path, 'bun'));
    const viaLink = spawnSync(link, ['--version'], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: path, HOME: dir, GSTACK_EXTEND_STATE_DIR: dir } });
    expect(viaLink.status, viaLink.stderr).toBe(0);
    expect(viaLink.stdout).toContain('gate_version: 1');
    symlinkSync(join(dir, 'loop-b'), join(dir, 'loop-a'));
    symlinkSync(join(dir, 'loop-a'), join(dir, 'loop-b'));
    const loop = spawnSync(join(dir, 'loop-a'), ['--version'], { encoding: 'utf8' });
    expect(loop.status).not.toBe(0);
  });
});

// ---------------------------------------------------------------- doc drift

/** The pinned fixture the doc's example verdict is generated from. */
function exampleVerdict(): J {
  const e = evidence({ repo: { origin: 'https://github.com/acme/widgets.git' } });
  const id = sha256Hex(canonicalJson(e));
  return { ...decide(e, POLICY, at, { evidenceId: id, replay: false, gstackVersion: '0.29.1.0' }), evidence_path: null };
}

function docTable(doc: string, heading: string): string[][] {
  const section = doc.split(`\n## ${heading}\n`)[1]?.split('\n## ')[0] ?? '';
  return section.split('\n').filter(l => /^\| `/.test(l)).map(l => l.split('|').slice(1, -1).map(c => c.trim()));
}

function docBlock(doc: string, heading: string): string {
  return doc.split(`\n## ${heading}\n`)[1]?.split('```json\n')[1]?.split('\n```')[0] ?? '';
}

describe('doc drift', () => {
  const doc = readFileSync(join(ROOT, 'docs/merge-gate.md'), 'utf8');
  const reasons = (d: string) => docTable(d, 'Reasons').map(([c, cls, b]) => ({ code: c?.replace(/`/g, ''), class: cls, blocking: b === 'yes' }));
  const errors = (d: string) => docTable(d, 'Errors').map(([c, exit]) => ({ code: c?.replace(/`/g, ''), exit: Number(exit) }));
  const registryReasons = REASON_REGISTRY.map(r => ({ code: r.code, class: r.class, blocking: r.blocking }));
  const registryErrors = ERROR_CODES.map(c => ({ code: c, exit: c === 'usage' ? 2 : 1 }));

  test('reason and error tables equal the registries', () => {
    expect(reasons(doc)).toEqual(registryReasons);
    expect(errors(doc)).toEqual(registryErrors);
  });

  test('a one-cell change is detected', () => {
    const mutated = doc.replace('| `empty_diff` | evidence | yes |', '| `empty_diff` | evidence | no |');
    expect(mutated).not.toBe(doc);
    expect(reasons(mutated)).not.toEqual(registryReasons);
    expect(errors(doc.replace('| `usage` | 2 |', '| `usage` | 1 |'))).not.toEqual(registryErrors);
  });

  test('example verdict and error are generated output', () => {
    expect(docBlock(doc, 'Example verdict')).toBe(canonicalJson(exampleVerdict()));
    const usage = run(['check', '--json']);
    expect(docBlock(doc, 'Example error')).toBe(usage.stdout.trim());
  });
});
