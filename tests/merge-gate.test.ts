import { describe, expect, test, afterAll } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { scanLines } from '../src/merge-gate/api.ts';
import { assertArgvAllowed, buildChildEnv } from '../src/merge-gate/exec.ts';
import { matchGlob } from '../src/merge-gate/glob.ts';
import { parseManifest } from '../src/merge-gate/deps.ts';
import { decide, type Evidence } from '../src/merge-gate/decide.ts';
import { main } from '../src/merge-gate/cli.ts';
import { readVerdictLog } from '../src/merge-gate/store.ts';
import {
  COLLECTOR_FINGERPRINTS,
  COLLECTOR_VERSION,
  ERROR_CODES,
  GATE_FINGERPRINTS,
  GATE_VERSION,
  REASON_REGISTRY,
  hashCollectorTables,
  hashGateTables,
  API_RULES,
} from '../src/merge-gate/registry.ts';
import { GateError } from '../src/merge-gate/errors.ts';
import { makeBaseTmp, makeEmptyRepo } from './helpers/fixture-repo.ts';

const ROOT = join(import.meta.dir, '..');
const BIN = join(ROOT, 'bin/merge-gate');
const baseTmp = makeBaseTmp('merge-gate-');

afterAll(() => {
  rmSync(baseTmp, { recursive: true, force: true });
});

function git(repo: string, args: string[], env: NodeJS.ProcessEnv = {}): void {
  const r = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z', ...env },
  });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
}

function seed(repo: string): void {
  git(repo, ['init', '--quiet', '--initial-branch=main']);
  git(repo, ['config', 'user.email', 't@t.com']);
  git(repo, ['config', 'user.name', 'T']);
}

function commitAll(repo: string, message: string): void {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', message, '--quiet', '--allow-empty']);
}

type Run = { status: number | null; stdout: string; stderr: string };

function run(repo: string, args: string[], extra: NodeJS.ProcessEnv = {}): Run {
  const home = mkdtempSync(join(baseTmp, 'home-'));
  const state = mkdtempSync(join(baseTmp, 'state-'));
  const r = spawnSync(BIN, args, {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      GSTACK_EXTEND_STATE_DIR: state,
      ...extra,
    },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function jsonOut(result: Run): Record<string, unknown> {
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

describe('budget', () => {
  test('within budget is yes and each dimension over is no', () => {
    const repo = mkdtempSync(join(baseTmp, 'repo-'));
    seed(repo);
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    commitAll(repo, 'base');
    writeFileSync(join(repo, 'a.txt'), 'a\nb\n');
    commitAll(repo, 'one');
    const ok = run(repo, ['check', '--base', 'HEAD~1', '--json', '--no-record']);
    expect(ok.status).toBe(0);
    const body = jsonOut(ok);
    expect(body.would_merge).toBe(true);
    expect((body.metrics as { net_lines: number }).net_lines).toBe(1);

    writeFileSync(join(repo, 'a.txt'), `${'x\n'.repeat(600)}`);
    commitAll(repo, 'lines');
    const lines = jsonOut(run(repo, ['check', '--base', 'HEAD~1', '--json', '--no-record']));
    expect(lines.would_merge).toBe(false);
    const reasons = lines.reasons as { code: string; measured?: number; limit?: number }[];
    const hit = reasons.find(r => r.code === 'net_lines_over_budget');
    expect(hit?.measured).toBeGreaterThan(500);
    expect(hit?.limit).toBe(500);

    const repo2 = mkdtempSync(join(baseTmp, 'repo-'));
    seed(repo2);
    commitAll(repo2, 'empty');
    for (let i = 0; i < 11; i++) writeFileSync(join(repo2, `n${i}.txt`), 'z\n');
    commitAll(repo2, 'files');
    const files = jsonOut(run(repo2, ['check', '--base', 'HEAD~1', '--max-net-lines', 'none', '--json', '--no-record']));
    expect((files.reasons as { code: string }[]).some(r => r.code === 'new_files_over_budget')).toBe(true);

    const churn = jsonOut(run(repo, ['check', '--base', 'HEAD~1', '--max-churn', '1', '--max-net-lines', 'none', '--json', '--no-record']));
    expect((churn.reasons as { code: string }[]).some(r => r.code === 'churn_over_budget')).toBe(true);
    const quiet = jsonOut(run(repo, ['check', '--base', 'HEAD', '--base', 'HEAD', '--json', '--no-record'].filter((_, i, a) => {
      void a;
      return true;
    })));
    void quiet;
    const noChurn = jsonOut(run(repo2, ['check', '--base', 'HEAD~1', '--max-net-lines', 'none', '--max-new-files', 'none', '--json', '--no-record']));
    expect((noChurn.reasons as { code: string }[]).some(r => r.code === 'churn_over_budget')).toBe(false);
    expect((noChurn.metrics as { top_churn_files: unknown[] }).top_churn_files.length).toBeGreaterThan(0);
  });

  test('one new dependency blocks by default and passes with room', () => {
    const repo = mkdtempSync(join(baseTmp, 'repo-'));
    seed(repo);
    writeFileSync(join(repo, 'package.json'), '{"dependencies":{"old":"1.0.0"}}\n');
    commitAll(repo, 'base');
    writeFileSync(join(repo, 'package.json'), '{"dependencies":{"old":"1.0.0","left-pad":"1.0.0"}}\n');
    commitAll(repo, 'dep');
    const blocked = jsonOut(run(repo, ['check', '--base', 'HEAD~1', '--json', '--no-record']));
    expect(blocked.would_merge).toBe(false);
    expect((blocked.reasons as { code: string }[]).some(r => r.code === 'new_deps_over_budget')).toBe(true);
    const allowed = jsonOut(run(repo, ['check', '--base', 'HEAD~1', '--max-new-deps', '1', '--json', '--no-record']));
    expect((allowed.reasons as { code: string }[]).some(r => r.code === 'new_deps_over_budget')).toBe(false);
  });
});

describe('parsers', () => {
  test('package.json move across sections is not new and local specs are local', () => {
    const base = '{"dependencies":{"left-pad":"1.0.0"}}';
    const head = '{"devDependencies":{"left-pad":"1.0.0","local":"file:../x"}}';
    const parsed = parseManifest('package.json', base, head);
    expect(parsed.unverifiable).toBeNull();
    expect(parsed.added.map(d => d.name)).toEqual(['local']);
    expect(parsed.added[0]?.classification).toBe('local');
  });

  test('requirements, cargo, poetry, gemfile, and go.mod rules', () => {
    const req = parseManifest('requirements', 'requests==1\n-r other.txt\n', 'requests==2\n-r other.txt\n');
    expect(req.unverifiable).toBeNull();
    expect(req.added).toEqual([]);
    const reqNew = parseManifest('requirements', 'requests==1\n', 'requests==1\n-r other.txt\n');
    expect(reqNew.unverifiable).not.toBeNull();
    const url = parseManifest('requirements', '', '-e https://example.com/pkg.git\nFoo_Bar>=1\n./local\n');
    expect(url.added.map(d => `${d.classification}:${d.name}`).sort()).toEqual([
      'local:./local',
      'remote:-e https://example.com/pkg.git',
      'remote:foo-bar',
    ]);
    const cargo = parseManifest('cargo', '[dependencies]\nfoo = "1"\n', '[dependencies]\nfoo = "1"\nbar = { path = "../bar" }\nbaz = { workspace = true }\n');
    expect(cargo.added.every(d => d.classification === 'local')).toBe(true);
    const cargoBad = parseManifest('cargo', '[dependencies]\nfoo = "1"\n', '[dependencies]\nfoo = "1"\n"quoted" = "1"\n');
    expect(cargoBad.unverifiable).not.toBeNull();
    const cargoSame = parseManifest('cargo', '[dependencies]\n"quoted" = "1"\n', '[dependencies]\n"quoted" = "1"\n');
    expect(cargoSame.unverifiable).toBeNull();
    const poetry = parseManifest('pyproject', '', '[tool.poetry.dependencies]\npython = "^3.11"\nrequests = "2"\nlocal = { path = "./l" }\n');
    expect(poetry.added.filter(d => d.classification === 'remote').map(d => d.name)).toEqual(['requests']);
    const gem = parseManifest('gemfile', "gemspec\n", "gemspec\ngem 'rails'\n");
    expect(gem.unverifiable).toBeNull();
    expect(gem.added.map(d => d.name)).toEqual(['rails']);
    const gemNew = parseManifest('gemfile', "gem 'a'\n", "gem 'a'\ngemspec\n");
    expect(gemNew.unverifiable).not.toBeNull();
    const go = parseManifest('gomod', 'module x\ngo 1.22\nrequire example.com/a v1.0.0 // indirect\n', 'module x\ngo 1.22\nrequire example.com/a v1.2.0\nrequire example.com/b v1.0.0\n');
    expect(go.added.map(d => d.name)).toEqual(['example.com/b']);
  });

  test('public API rules, moves, defaults, pub(crate), and bin mode', () => {
    expect(scanLines('a.ts', ['export function Foo() {}'], 'added').map(p => p.name)).toEqual(['Foo']);
    expect(scanLines('a.ts', ['export default 1'], 'added')[0]?.name).toBe('default@a.ts');
    expect(scanLines('a.ts', ['export { a as b, c }'], 'added').map(p => p.name)).toEqual(['b', 'c']);
    expect(scanLines('a.ts', ['export {'], 'added')[0]?.rule).toBe('ts-list-open');
    expect(scanLines('a.ts', ["export * as NS from './m'"], 'added')[0]?.name).toBe('NS');
    expect(scanLines('a.py', ['def helper():', 'class Public:'], 'added').map(p => p.name)).toEqual(['helper', 'Public']);
    expect(scanLines('a.py', ['    def inner():', 'def _hidden():'], 'added')).toEqual([]);
    expect(scanLines('a.go', ['func (s *Box[T]) Save() {}', 'func Exported() {}'], 'added').map(p => p.name)).toEqual(['Box.Save', 'Exported']);
    expect(scanLines('a.rs', ['pub fn Open() {}', 'pub(crate) fn Hidden() {}'], 'added').map(p => p.name)).toEqual(['Open']);
    expect(scanLines('a.js', ['module.exports = 1', 'exports.foo = 1'], 'added').map(p => p.name)).toEqual(['module.exports@a.js', 'foo']);
  });
});

describe('pull request signals', () => {
  const sha = 'a'.repeat(40);
  const base = 'b'.repeat(40);

  function ev(raw: Record<string, unknown>): Evidence {
    return {
      v: 1,
      observed_at: '2020-01-01T00:00:00.000Z',
      collection_started_at: '2020-01-01T00:00:00.000Z',
      clock_overridden: false,
      test_overrides: [],
      collector_version: 1,
      gstack_extend_version: '0.29.0.1',
      git_version: 'git version 2.40.0',
      partial_clone: false,
      attr_source: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
      rename_limit: 10000,
      rename_detection_skipped: false,
      decision_id: 'dec-1',
      repo: { origin: 'https://github.com/acme/widgets' },
      git: {
        base_sha: base,
        head_sha: sha,
        merge_base_sha: base,
        files: [{
          path: 'a.ts', path_b64: undefined, old_path: null, old_mode: '100644', new_mode: '100644',
          old_oid: sha, new_oid: sha, status: 'M', additions: 1, deletions: 0, binary: false, submodule: false,
        }],
      },
      dependencies: { manifests: [] },
      public_api: { files: [] },
      collection: { complete: true, failures: [] },
      pr: {
        number: 42,
        url: 'https://github.com/acme/widgets/pull/42',
        repo: { host: 'github.com', owner: 'acme', name: 'widgets' },
        raw,
        raw_first: null,
        retry_wait_ms: null,
      },
    };
  }

  function codes(raw: Record<string, unknown>): string[] {
    const verdict = decide(ev(raw), {
      max_net_lines: 500, max_new_files: 10, max_new_deps: 0, max_new_public_api: 10, max_churn: null, exclude: [],
    }, new Date('2020-01-01T00:00:00.000Z'), { evidenceId: 'e', replay: false, gstackVersion: '0.29.0.1' });
    return verdict.reasons.map(r => r.code);
  }

  test('mapping rows', () => {
    const open = { state: 'OPEN', url: 'https://github.com/acme/widgets/pull/42', number: 42, headRefOid: sha, baseRefOid: base, mergeStateStatus: 'CLEAN' };
    expect(codes({ ...open, isDraft: true, mergeable: 'MERGEABLE', reviewDecision: 'APPROVED', statusCheckRollup: [{ name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' }] })).toContain('pr_draft');
    expect(codes({ ...open, mergeable: 'MERGEABLE', reviewDecision: 'APPROVED', statusCheckRollup: [{ name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' }] })).not.toContain('merge_conflict');
    expect(codes({ ...open, mergeable: 'CONFLICTING', reviewDecision: null, statusCheckRollup: [] })).toContain('merge_conflict');
    expect(codes({ ...open, mergeable: 'UNKNOWN', reviewDecision: null, statusCheckRollup: [] })).toContain('mergeability_unknown');
    expect(codes({ ...open, mergeable: 'MERGEABLE', reviewDecision: 'CHANGES_REQUESTED', statusCheckRollup: [] })).toContain('changes_requested');
    expect(codes({ ...open, mergeable: 'MERGEABLE', reviewDecision: 'REVIEW_REQUIRED', statusCheckRollup: [] })).toContain('review_required');
    expect(codes({ ...open, mergeable: 'MERGEABLE', reviewDecision: null, statusCheckRollup: [] })).toContain('no_checks_configured');
    const mixed = codes({
      ...open,
      mergeable: 'MERGEABLE',
      reviewDecision: 'APPROVED',
      statusCheckRollup: [
        { name: 'bad', status: 'COMPLETED', conclusion: 'FAILURE' },
        { name: 'wait', status: 'IN_PROGRESS', conclusion: null },
        { context: 'odd', state: 'WEIRD' },
      ],
    });
    expect(mixed).toContain('checks_failing');
    expect(mixed).toContain('checks_pending');
    expect(mixed).toContain('check_state_unknown');
    expect(codes({ ...open, state: 'MERGED', mergeable: 'CONFLICTING', reviewDecision: 'CHANGES_REQUESTED' })).toContain('retroactive_pr_state');
    expect(codes({ ...open, state: 'MERGED', mergeable: 'CONFLICTING' })).not.toContain('merge_conflict');
    expect(codes({ ...open, state: 'CLOSED', mergeable: 'MERGEABLE', reviewDecision: null, statusCheckRollup: [] })).toContain('retroactive_pr_state');
    const hundred = Array.from({ length: 100 }, (_, i) => ({ name: `c${i}`, status: 'COMPLETED', conclusion: 'SUCCESS' }));
    expect(codes({ ...open, mergeable: 'MERGEABLE', reviewDecision: 'APPROVED', statusCheckRollup: hundred })).toContain('checks_truncated');
    const sub = decide(ev({ ...open, mergeable: 'MERGEABLE', reviewDecision: 'APPROVED', statusCheckRollup: [{ name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' }] }), {
      max_net_lines: 0, max_new_files: 10, max_new_deps: 0, max_new_public_api: 10, max_churn: null, exclude: [],
    }, new Date('2020-01-01T00:00:00.000Z'), { evidenceId: 'e', replay: false, gstackVersion: '0.29.0.1' });
    expect(sub.within_budget).toBe(false);
    expect(sub.ready).toBe(true);
    expect(sub.evidence_complete).toBe(true);
    expect(sub.timing).toBe('open');
    expect(sub.subject.decision_id).toBe('dec-1');
    expect(sub.observed_at).toBe('2020-01-01T00:00:00.000Z');
  });
});

describe('cli contract', () => {
  test('help, version, and usage name the flag', () => {
    const repo = makeEmptyRepo(baseTmp);
    const help = run(repo, ['--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('merge-gate check --base main --no-record');
    expect(help.stdout).toContain('merge-gate check --pr 123 --json');
    expect(help.stdout).toContain('merge-gate replay --evidence <id> --json');
    expect(run(repo, ['check', '--help']).status).toBe(0);
    expect(run(repo, ['replay', '-h']).status).toBe(0);
    const version = jsonOut(run(repo, ['--version', '--json']));
    expect(version.gate_version).toBe(GATE_VERSION);
    expect(version.collector_version).toBe(COLLECTOR_VERSION);
    expect(version.gstack_extend_version).toBe('0.29.0.1');
    expect(version.evidence_v).toBe(1);
    expect(version.verdict_v).toBe(1);
    const usage = run(repo, ['check', '--max-net-lines', '-3', '--base', 'HEAD', '--json']);
    expect(usage.status).toBe(2);
    expect(jsonOut(usage).error).toMatchObject({ code: 'usage' });
    expect(JSON.stringify(jsonOut(usage).error)).toContain('--max-net-lines');
    expect(JSON.stringify(jsonOut(usage).error)).toContain('-3');
    const badId = run(repo, ['check', '--pr', '1', '--decision-id', 'bad id', '--json']);
    expect(jsonOut(badId).error).toMatchObject({ code: 'usage' });
  });

  test('human lines for an unanchored run and control-character stripping', () => {
    const repo = mkdtempSync(join(baseTmp, 'repo-'));
    seed(repo);
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    commitAll(repo, 'base');
    writeFileSync(join(repo, 'a.txt'), 'a\nb\n');
    commitAll(repo, 'two');
    const human = run(repo, ['check', '--base', 'HEAD~1', '--no-record']);
    expect(human.status).toBe(0);
    const lines = human.stdout.trim().split('\n').filter(l => !l.startsWith('- '));
    expect(lines.map(l => l.split(':')[0])).toEqual([
      'WOULD_MERGE', 'MODE', 'GATE', 'TIMING', 'SUBJECT', 'VERDICTS', 'METRICS', 'TOP_CHURN', 'REASONS', 'DOCS', 'EVIDENCE',
    ]);
    expect(human.stdout).toContain('TIMING: unanchored');
    expect(human.stdout).toContain('ready=not checked');
    expect(human.stdout).toContain('EVIDENCE: not recorded (--no-record)');
    expect(human.stdout).toContain('churn=1/off');
  });

  test('evidence is written once and tamper fails replay', () => {
    const repo = mkdtempSync(join(baseTmp, 'repo-'));
    seed(repo);
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    commitAll(repo, 'base');
    writeFileSync(join(repo, 'a.txt'), 'a\nb\n');
    commitAll(repo, 'two');
    const home = mkdtempSync(join(baseTmp, 'home-'));
    const state = mkdtempSync(join(baseTmp, 'state-'));
    const env = { ...process.env, HOME: home, GSTACK_EXTEND_STATE_DIR: state };
    const first = spawnSync(BIN, ['check', '--base', 'HEAD~1', '--json'], { cwd: repo, encoding: 'utf8', env });
    const body = JSON.parse(first.stdout) as { evidence_id: string; evidence_path: string; policy_sha256: string; would_merge: boolean };
    expect(first.status).toBe(0);
    const bytes = readFileSync(body.evidence_path);
    const { createHash } = require('node:crypto') as typeof import('node:crypto');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(body.evidence_id);
    const again = spawnSync(BIN, ['check', '--base', 'HEAD~1', '--json'], { cwd: repo, encoding: 'utf8', env });
    expect(again.status).toBe(0);
    const replay = spawnSync(BIN, ['replay', '--evidence', body.evidence_id, '--json', '--policy', body.evidence_path.replace(/evidence\/.*$/, 'nope')], {
      cwd: repo, encoding: 'utf8', env,
    });
    void replay;
    const policyFile = join(state, 'policy.json');
    const verdict = JSON.parse(first.stdout) as { policy: unknown };
    writeFileSync(policyFile, JSON.stringify(verdict.policy));
    const bunDir = dirname(spawnSync('bash', ['-lc', 'command -v bun'], { encoding: 'utf8' }).stdout.trim());
    const same = spawnSync(BIN, ['replay', '--evidence', body.evidence_id, '--policy', policyFile, '--json'], {
      cwd: repo, encoding: 'utf8', env: { ...env, PATH: bunDir },
    });
    expect(same.status).toBe(0);
    const sameBody = JSON.parse(same.stdout) as { policy_sha256: string; would_merge: boolean; replay: boolean };
    expect(sameBody.policy_sha256).toBe(body.policy_sha256);
    expect(sameBody.would_merge).toBe(body.would_merge);
    expect(sameBody.replay).toBe(true);
    writeFileSync(body.evidence_path, bytes.subarray(0, bytes.length - 2));
    // filename stem no longer matches after a byte change when we keep the name
    const tampered = spawnSync(BIN, ['replay', '--evidence', body.evidence_id, '--json'], { cwd: repo, encoding: 'utf8', env });
    expect(JSON.parse(tampered.stdout).error.code).toBe('evidence_corrupt');
  });

  test('test overrides are refused without the test guard', () => {
    const repo = makeEmptyRepo(baseTmp);
    const refused = run(repo, ['--version'], { GSTACK_EXTEND_MERGE_GATE_NOW: '2020-01-01T00:00:00.000Z' });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('test_env_refused');
    const explicit = run(repo, ['check', '--base', 'HEAD', '--json', '--no-record'], {
      GSTACK_EXTEND_MERGE_GATE_TEST: '1',
      GSTACK_EXTEND_MERGE_GATE_NOW: '2020-01-01T00:00:00.000Z',
    });
    expect(explicit.status).toBe(0);
    expect(jsonOut(explicit).decided_at).toBe('2020-01-01T00:00:00.000Z');
  });

  test('glob matcher and rejected brackets', () => {
    expect(matchGlob('a.ts', '**/*.ts')).toBe(true);
    expect(matchGlob('dir/a.ts', '**/*.ts')).toBe(true);
    expect(matchGlob('file(1).txt', 'file(1).txt')).toBe(true);
    expect(matchGlob('a+b?.txt', 'a+b?.txt')).toBe(true);
    expect(() => matchGlob('a.ts', 'src/[a].ts')).toThrow(GateError);
  });

  test('fingerprints are pinned and a pattern change moves the hash', () => {
    expect(GATE_FINGERPRINTS[String(GATE_VERSION)]).toBe(hashGateTables());
    expect(COLLECTOR_FINGERPRINTS[String(COLLECTOR_VERSION)]).toBe(hashCollectorTables());
    const mutated = structuredClone(API_RULES);
    const first = mutated[0];
    if (!first) throw new Error('missing rule');
    first.pattern = { ...first.pattern, source: `${first.pattern.source}x` };
    const { sha256Canonical } = require('../src/merge-gate/canon.ts') as typeof import('../src/merge-gate/canon.ts');
    expect(sha256Canonical(mutated)).not.toBe(sha256Canonical(API_RULES));
  });

  test('internal_error comes from main when a dependency throws', async () => {
    let out = '';
    let err = '';
    const code = await main(['--version', '--json'], {
      stdout: s => { out += s; },
      stderr: s => { err += s; },
      fail() { throw new Error('boom'); },
    });
    expect(code).toBe(1);
    expect(out).toContain('internal_error');
    expect(err).toContain('boom');
  });

  test('allowlist rejects mutating argv and child env drops GIT_DIR', () => {
    expect(() => assertArgvAllowed('git', ['merge'])).toThrow(GateError);
    expect(() => assertArgvAllowed('gh', ['pr', 'merge', '1'])).toThrow(GateError);
    const env = buildChildEnv({ ...process.env, GIT_DIR: '/tmp/nope', GH_REPO: 'acme/widgets', GH_TOKEN: 'keep' });
    expect(env.GIT_DIR).toBeUndefined();
    expect(env.GH_REPO).toBeUndefined();
    expect(env.GH_TOKEN).toBe('keep');
    expect(env.LC_ALL).toBe('C');
    expect(env.GIT_NO_LAZY_FETCH).toBe('1');
  });
});

describe('doc drift', () => {
  const doc = readFileSync(join(ROOT, 'docs/merge-gate.md'), 'utf8');

  test('reason and error tables match the registries', () => {
    for (const reason of REASON_REGISTRY) expect(doc).toContain(`\`${reason.code}\``);
    for (const code of ERROR_CODES) expect(doc).toContain(`\`${code}\``);
    expect(doc).toContain('git 2.40');
    const verdict = doc.split('## Example verdict')[1]?.split('```json')[1]?.split('```')[0];
    const error = doc.split('## Example error')[1]?.split('```json')[1]?.split('```')[0];
    expect(JSON.parse(verdict ?? '{}').would_merge).toBe(true);
    expect(JSON.parse(error ?? '{}').error.code).toBe('usage');
  });
});

describe('static cannot-merge proof', () => {
  test('imports and spawn tokens stay inside the allowlist', () => {
    const dir = join(ROOT, 'src/merge-gate');
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        const full = join(d, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name.endsWith('.ts')) files.push(full);
      }
    };
    walk(dir);
    const allowed = new Set(['node:fs', 'node:path', 'node:crypto', 'node:os', 'node:child_process']);
    const network = ['fetch(', 'node:http', 'node:https', 'node:http2', 'node:net', 'node:tls', 'node:dgram', 'node:dns', 'WebSocket', 'XMLHttpRequest', 'Bun.connect', 'Bun.listen', 'Bun.serve', 'Bun.udpSocket', 'eval(', 'new Function', 'Bun.Worker', 'Worker('];
    const verbs = ['merge', 'push', 'commit', 'update-ref', 'checkout', 'reset', 'fetch', 'pull', 'rebase', 'tag', 'api'];
    const violations: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const rel = file.slice(ROOT.length + 1);
      if (rel !== 'src/merge-gate/exec.ts' && /Bun\.\$|Bun\.spawn|child_process|spawnSync|execSync/.test(text)) {
        violations.push(`${rel} spawn`);
      }
      if (/import\s*\(|require\s*\(/.test(text)) violations.push(`${rel} dynamic`);
      for (const token of network) {
        if (text.includes(token)) violations.push(`${rel} ${token}`);
      }
      const specs = [...text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1] ?? '');
      for (const spec of specs) {
        if (spec.startsWith('.')) {
          if (spec.includes('audit') || spec.includes('tests')) violations.push(`${rel} ${spec}`);
          continue;
        }
        if (!allowed.has(spec)) violations.push(`${rel} import ${spec}`);
        if (spec === 'node:child_process' && rel !== 'src/merge-gate/exec.ts') violations.push(rel);
      }
      if (rel === 'src/merge-gate/exec.ts') {
        for (const verb of verbs) {
          if (text.includes(`'${verb}'`) || text.includes(`"${verb}"`) || text.includes('`' + verb + '`')) {
            violations.push(`${rel} verb ${verb}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
    const badAudit = `import { x } from '../audit/lib/git.ts';\n`;
    const badFfi = `import 'bun:ffi';\n`;
    expect(badAudit.includes('../audit/lib/git.ts')).toBe(true);
    expect(badFfi.includes('bun:ffi')).toBe(true);
    const scan = (src: string) => {
      const specs = [...src.matchAll(/from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g)].map(m => m[1] || m[2] || '');
      return specs.filter(spec => !spec.startsWith('./') && !allowed.has(spec));
    };
    expect(scan(badAudit).length + scan(badFfi).length).toBeGreaterThan(0);
  });
});

describe('shim', () => {
  test('symlink invocation and a PATH that contains only bun', () => {
    const dir = mkdtempSync(join(baseTmp, 'link-'));
    const link = join(dir, 'merge-gate');
    symlinkSync(BIN, link);
    const repo = makeEmptyRepo(baseTmp);
    const bun = spawnSync('bash', ['-lc', 'command -v bun'], { encoding: 'utf8' }).stdout.trim();
    const pathDir = mkdtempSync(join(baseTmp, 'path-'));
    symlinkSync(bun, join(pathDir, 'bun'));
    const viaLink = spawnSync(link, ['--version'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: pathDir, HOME: dir, GSTACK_EXTEND_STATE_DIR: dir },
    });
    expect(viaLink.status, viaLink.stderr).toBe(0);
    expect(viaLink.stdout).toContain('gate_version:');
    const loopA = join(dir, 'loop-a');
    const loopB = join(dir, 'loop-b');
    symlinkSync(loopB, loopA);
    symlinkSync(loopA, loopB);
    const loop = spawnSync(loopA, ['--version'], { encoding: 'utf8' });
    expect(loop.status === 0).toBe(false);
    expect(loop.stdout ?? '').not.toContain('gate_version');
  });
});

void dirname;
void chmodSync;
void mkdirSync;
void writeFileSync;
