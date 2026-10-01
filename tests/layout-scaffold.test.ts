import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chmodSync, constants, copyFileSync, lstatSync, linkSync, readdirSync, readlinkSync, renameSync, rmdirSync, statSync, symlinkSync, utimesSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { main, help, BUN_FLOOR, EXIT_CODES, type CliIo } from '../src/layout-scaffold/cli.ts';
import { defaultAudit, type AuditSnapshot } from '../src/layout-scaffold/plan.ts';
import { defaultFs, Refusal, REFUSAL_ACTIONS, escapeValue, type FileSystem, type Root } from '../src/layout-scaffold/root.ts';
import { childEnv, defaultGitSpawn, INDEX_MAX_BUFFER, type GitSpawn } from '../src/layout-scaffold/git.ts';
import { CANONICAL_DIRS, probeSpelling, resolveTarget } from '../src/layout-scaffold/preflight.ts';
import type { DocMoveRecord } from '../src/audit/checks/doc-location.ts';
import { walkMdFiles } from '../src/audit/lib/md-walk.ts';

const EXTEND_ROOT = resolve(import.meta.dir, '..');
const DRAFT = '## Current Plan\n#### Group 101: Example\n##### Track 101A: Example\n_touches: src/example.ts_\n- **Build example** -- fixture (S)\n';

describe('Process: hardened launchers', () => {
  let temp: string;
  let root: string;
  let env: Record<string, string>;

  beforeEach(() => {
    temp = realpathSync(mkdtempSync(join(tmpdir(), 'layout-process-')));
    root = join(temp, 'repo');
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(temp, 'home'));
    env = {
      PATH: process.env.PATH!, HOME: join(temp, 'home'),
      GSTACK_EXTEND_DIR: EXTEND_ROOT, GSTACK_EXTEND_STATE_DIR: join(temp, 'state'),
    };
    writeFileSync(join(root, 'docs/ROADMAP.md'), DRAFT);
    writeFileSync(join(root, 'preload.ts'), "import { writeFileSync } from 'node:fs'; writeFileSync('preload-marker', 'ran');\n");
    writeFileSync(join(root, 'probe.ts'), "console.log('probe ran');\n");
    writeFileSync(join(root, 'bunfig.toml'), 'preload = ["./preload.ts"]\n');
  });

  afterEach(() => rmSync(temp, { recursive: true, force: true }));

  test('positive control runs preload; every audit launcher starts read-only without it', () => {
    const control = spawnSync(process.execPath, ['probe.ts'], { cwd: root, env, input: '', encoding: 'utf8' });
    expect(control.status).toBe(0);
    expect(control.stdout).toContain('probe ran');
    expect(readFileSync(join(root, 'preload-marker'), 'utf8')).toBe('ran');
    unlinkSync(join(root, 'preload-marker'));

    const rows = [
      { bin: 'layout-scaffold', args: ['plan', '--root', root], input: '', line: 'STATUS: ok' },
      { bin: 'roadmap-audit', args: [root], input: '', line: 'DOC_LOCATION' },
      { bin: 'roadmap-pack', args: ['--stdin', root], input: DRAFT, line: 'BINS:' },
      { bin: 'roadmap-touches', args: ['report-cross-group', root], input: '', line: 'CROSS_GROUP:' },
      { bin: 'roadmap-renumber', args: ['--map', '101A=91A', '--dry-run', root], input: '', line: 'DRY_RUN:' },
    ];
    for (const row of rows) {
      const result = spawnSync(join(EXTEND_ROOT, 'bin', row.bin), row.args, {
        cwd: root, env, input: row.input, encoding: 'utf8',
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain(row.line);
      expect(existsSync(join(root, 'preload-marker'))).toBe(false);
      const launcher = readFileSync(join(EXTEND_ROOT, 'bin', row.bin), 'utf8');
      expect(launcher.split('\n').filter(line => line.startsWith('exec '))).toEqual([
        expect.stringContaining('exec bun --no-env-file --no-install --config=/dev/null '),
      ]);
    }
    expect(readFileSync(join(root, 'docs/ROADMAP.md'), 'utf8')).toBe(DRAFT);
  });
});


const DESIGN = '# Architecture\n```mermaid\ngraph TD\nA --> B\n```\nExplanation\n';
const INBOX = '- [ ] one\n- [ ] two\n- [ ] three\n- [ ] four\n- [ ] five\n';
let temp: string;
let root: string;
let testEnv: NodeJS.ProcessEnv;
beforeEach(() => {
  temp = realpathSync(mkdtempSync(join(tmpdir(), 'layout-scaffold-')));
  root = join(temp, 'root'); mkdirSync(root); mkdirSync(join(temp, 'home'));
  testEnv = { PATH: process.env.PATH, HOME: join(temp, 'home'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
});
afterEach(() => rmSync(temp, { recursive: true, force: true }));
function file(path: string, content = 'example\n') {
  mkdirSync(resolve(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), content);
}
function canonical() { for (const path of CANONICAL_DIRS) mkdirSync(join(root, path), { recursive: true }); }
function git(args: string[], input = '', expected = 0) {
  const result = spawnSync('/usr/bin/git', ['-C', root, ...args], { env: childEnv(testEnv, true), input, encoding: 'utf8' });
  expect(result.status).toBe(expected); return result.stdout;
}
function gitRepo() {
  git(['init', '--quiet', '--initial-branch=main']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.test']);
  git(['commit', '--quiet', '--allow-empty', '-m', 'fixture']);
}
function track(...paths: string[]) { git(['add', '--', ...paths]); git(['commit', '--quiet', '-m', 'fixture files']); }
function invoke(args: string[], overrides: Partial<CliIo> = {}) {
  let stdout = ''; let stderr = '';
  const code = main(args, { stdout: text => { stdout += text; }, stderr: text => { stderr += text; }, cwd: root, env: testEnv, ...overrides });
  return { code, stdout, stderr };
}
function plan(extra: string[] = [], overrides: Partial<CliIo> = {}) { return invoke(['plan', '--root', root, ...extra], overrides); }
function id(result: ReturnType<typeof invoke>) {
  const match = /^PLAN_ID: ([0-9a-f]{64})$/m.exec(result.stdout); expect(match).not.toBeNull(); return match![1]!;
}
function applyId(planId: string, extra: string[] = [], overrides: Partial<CliIo> = {}) {
  return invoke(['apply', '--root', root, '--plan-id', planId, ...extra], overrides);
}
function status(result: ReturnType<typeof invoke>, expected: string, code: number, computed = true, isPlan = false) {
  expect(result.code).toBe(code);
  expect(result.stdout.match(/^STATUS: .+$/gm)).toEqual([`STATUS: ${expected}`]);
  expect(result.stdout.match(/^BLOCKED: \d+$/gm)?.length ?? 0).toBe(computed ? 1 : 0);
  expect(result.stdout.match(/^EXCLUDED: \d+$/gm)?.length ?? 0).toBe(computed ? 1 : 0);
  expect(result.stdout.match(/^PLAN_ID: [0-9a-f]{64}$/gm)?.length ?? 0).toBe(isPlan && computed ? 1 : 0);
}
// Include index bytes; never follow links or open FIFOs, and ignore access times.
function tree(path = temp): string {
  const result: string[] = [];
  function walk(full: string, rel: string) {
    const st = lstatSync(full); result.push(`${rel}|${st.mode}`);
    if (st.isSymbolicLink()) result.push(readlinkSync(full));
    else if (st.isDirectory()) for (const name of readdirSync(full).sort()) walk(join(full, name), `${rel}/${name}`);
    else if (st.isFile()) result.push(readFileSync(full).toString('base64'));
  }
  walk(path, ''); return JSON.stringify(result);
}
function refused(code: keyof typeof REFUSAL_ACTIONS, extra: string[] = [], overrides: Partial<CliIo> = {}) {
  const before = tree(); const result = plan(extra, overrides);
  expect(tree()).toBe(before); status(result, 'refused', 1, !['root_invalid', 'git_unusable', 'audit_failed', 'internal_error'].includes(code), true);
  expect(result.stdout).toContain(`REFUSAL ${code}:`); expect(result.stdout).toContain('nothing was written');
  expect(result.stdout).toContain('layout-scaffold --help'); expect(result.stderr).toBe(''); return result;
}
function record(source = 'arch.md', destination: string | null = 'docs/designs/arch.md', changes: Partial<DocMoveRecord> = {}): DocMoveRecord {
  return { check: 'DOC_TYPE_MISMATCH', source, destination, missingParent: null, heuristic: true, blocked: null, ...changes };
}
function snapshot(...moves: DocMoveRecord[]): AuditSnapshot { return { moves, exists: {}, unreadableDirs: [] }; }
function withFs(changes: Partial<FileSystem>): FileSystem { return { ...defaultFs, ...changes }; }
function changedStat(st: Stats, changes: Partial<Stats>): Stats { return Object.assign(Object.create(Object.getPrototypeOf(st)), st, changes); }

// Value: locks the E1/H10 streams, status and KEY-line caller contract.
describe('CLI contract and roots', () => {
  test('help, version, refusal table and limit statements', () => {
    for (const flag of ['--help', '-h']) {
      const result = invoke([flag]); expect(result.code).toBe(0); expect(result.stderr).toBe(''); expect(result.stdout).toBe(help());
    }
    expect(help()).toContain(`Bun >= ${BUN_FLOOR}`);
    expect([...help().matchAll(/^  (\d):/gm)].map(match => Number(match[1]))).toEqual([...EXIT_CODES]);
    const table = help().split('Refusal codes and next actions:\n')[1]!;
    expect([...table.matchAll(/^  ([a-z_]+):/gm)].map(match => match[1])).toEqual(Object.keys(REFUSAL_ACTIONS));
    for (const text of ['cannot verify that a human', 'check-then-act, not atomic', 'compromised agent', 'ZWNJ, ZWJ', 'unknown state', '"$_EXTEND_ROOT/bin/layout-scaffold"', 'bin/layout-scaffold plan']) expect(help()).toContain(text);
    expect(help()).not.toContain('option C');
    expect(invoke(['--version']).stdout).toBe(`layout-scaffold ${readFileSync(join(EXTEND_ROOT, 'VERSION'), 'utf8').trim()}\n`);
  });
  const usage = [[], ['unknown'], ['plan', '--wat'], ['plan', '--json'], ['apply'], ['apply', '--plan-id', 'ABC'],
    ['apply', '--plan-id', 'a'.repeat(63)], ['plan', '--authorize-external'], ['plan', '--root'],
    ['apply', '--scaffold-only', '--authorize-external'], ['plan', '--scaffold-only', '--exclude', 'arch.md']];
  for (const args of usage) test(`usage ${JSON.stringify(args)}`, () => {
    const before = tree(); const result = invoke(args); expect(tree()).toBe(before);
    expect(result.code).toBe(2); expect(result.stdout).toBe(''); expect(result.stderr).toMatch(/^ERROR usage: .*\nFIX: /);
  });
  test('missing, empty and file roots refuse without plan keys', () => {
    file('ordinary');
    for (const path of ['', join(root, 'missing'), join(root, 'ordinary'), '/', testEnv.HOME!]) {
      const before = tree(); const result = invoke(['plan', '--root', path]); status(result, 'refused', 1, false);
      expect(result.stdout).toContain('REFUSAL root_invalid:'); expect(tree()).toBe(before);
    }
  });
  test('plain cwd requires explicit root; mount-boundary message permits explicit plain mode', () => {
    const result = invoke(['plan']); status(result, 'refused', 1, false); expect(result.stdout).toContain('pass --root');
    const spawn: GitSpawn = (args, opts) => args.includes('--is-inside-work-tree')
      ? { status: 128, stdout: '', stderr: 'fatal: not a git repository (or any parent up to mount point /tmp)\n' } : defaultGitSpawn(args, opts);
    status(plan([], { git: spawn }), 'ok', 0, true, true);
  });
  test('default Git toplevel, explicit subdir and symlinked root bind correctly', () => {
    gitRepo(); file('sub/TODOS.md'); track('sub/TODOS.md');
    const sub = join(root, 'sub'); const defaultPlan = invoke(['plan'], { cwd: sub });
    const alias = join(temp, 'alias'); symlinkSync(root, alias);
    expect(id(invoke(['plan', '--root', alias]))).toBe(id(defaultPlan));
    const subPlan = invoke(['plan', '--root', sub]); status(subPlan, 'ok', 0, true, true);
    const result = invoke(['apply', '--root', sub, '--plan-id', id(subPlan)]); status(result, 'applied', 0);
    expect(git(['ls-files', 'sub/docs/TODOS.md'])).toContain('sub/docs/TODOS.md');
  });
  test('bare repository, unusable gitfile and dangling ancestor gitfile are not plain', () => {
    git(['init', '--bare', '--quiet']); refused('git_unusable');
    rmSync(root, { recursive: true }); mkdirSync(root); file('.git', 'gitdir: /missing/worktree\n'); refused('git_unusable');
    unlinkSync(join(root, '.git')); writeFileSync(join(temp, '.git'), 'gitdir: /missing/worktree\n'); refused('git_unusable');
  });
  test('dubious ownership stays a Git refusal', () => {
    refused('git_unusable', [], { git: (args, opts) => args.includes('--is-inside-work-tree')
      ? { status: 128, stdout: '', stderr: 'fatal: detected dubious ownership\n' } : defaultGitSpawn(args, opts) });
  });
  test('root containing LF and fake STATUS prints exactly one escaped status', () => {
    root = join(temp, 'x\nSTATUS: ok'); mkdirSync(root);
    const result = plan(); status(result, 'ok', 0, true, true); expect(result.stdout).toContain('x\\x0ASTATUS: ok');
  });
});

// Value: real filesystem and index snapshots catch any write before whole-batch acceptance.
describe('directory, source and destination preflight', () => {
  for (const path of CANONICAL_DIRS) for (const kind of ['file', 'fifo', 'dangling']) test(`${path} as ${kind}`, () => {
    if (path !== 'docs') mkdirSync(join(root, 'docs'));
    if (kind === 'file') writeFileSync(join(root, path), 'wrong type');
    if (kind === 'dangling') symlinkSync(join(temp, 'missing'), join(root, path));
    if (kind === 'fifo') expect(spawnSync('/usr/bin/mkfifo', [join(root, path)]).status).toBe(0);
    const result = refused('preflight_type'); expect(result.stdout).toContain(escapeValue(path));
    expect(result.stdout.match(/^REFUSAL /gm)?.length).toBe(1);
  });
  test('live and dangling source links, with dangling discovery distinguished from injected record', () => {
    canonical(); writeFileSync(join(temp, 'readme'), 'readme'); symlinkSync(join(temp, 'readme'), join(root, 'docs/README.md'));
    refused('source_symlink'); unlinkSync(join(root, 'docs/README.md')); symlinkSync(join(temp, 'missing'), join(root, 'docs/README.md'));
    const before = tree(); const result = plan(); status(result, 'ok', 0, true, true); expect(result.stdout).toContain('already canonical'); expect(tree()).toBe(before);
    refused('source_symlink', [], { audit: () => snapshot(record('docs/README.md', 'README.md', { heuristic: false })) });
  });
  test('source directory link and source nested repo refuse', () => {
    mkdirSync(join(root, 'real')); file('real/arch.md', DESIGN); symlinkSync('real', join(root, 'linked'));
    const injected = { audit: () => snapshot(record('linked/arch.md')) }; refused('source_component', [], injected);
    file('real/.git', 'nested entry'); refused('source_component', [], { audit: () => snapshot(record('real/arch.md')) });
  });
  for (const kind of ['directory', 'directory-link', 'fifo', 'dangling']) test(`audit-derived destination ${kind}`, () => {
    canonical(); file('TODOS.md'); const dest = join(root, 'docs/TODOS.md');
    if (kind === 'directory') mkdirSync(dest);
    if (kind === 'directory-link') { mkdirSync(join(temp, 'outside')); symlinkSync(join(temp, 'outside'), dest); }
    if (kind === 'fifo') expect(spawnSync('/usr/bin/mkfifo', [dest]).status).toBe(0);
    if (kind === 'dangling') symlinkSync(join(temp, 'missing'), dest);
    refused('dest_exists');
  });
  test('directory at root README with misplaced docs README; injected regular-file collision', () => {
    canonical(); mkdirSync(join(root, 'README.md')); file('docs/README.md'); refused('dest_exists');
    file('arch.md', DESIGN); file('docs/designs/arch.md', 'exists');
    refused('dest_exists', [], { audit: () => snapshot(record()) });
  });
  test('same basename and case-variant basename duplicates refuse on every volume', () => {
    file('a/arch.md', DESIGN); file('b/arch.md', DESIGN); refused('dest_duplicate');
    unlinkSync(join(root, 'b/arch.md')); file('b/ARCH.md', DESIGN); refused('dest_duplicate');
  });
  test('destination .git component refuses', () => {
    file('arch.md', DESIGN); refused('dest_git', [], { audit: () => snapshot(record('arch.md', '.git/arch.md')) });
  });
  test('first valid move plus later invalid move leaves files and index unchanged on apply', () => {
    gitRepo(); canonical(); file('TODOS.md'); track('TODOS.md'); file('docs/README.md'); mkdirSync(join(root, 'README.md'));
    const p = refused('dest_exists'); const before = tree(); const result = applyId(id(p)); status(result, 'refused', 1); expect(tree()).toBe(before);
  });
  test('spelling probes are injectable on every volume, including precomposeUnicode', () => {
    canonical(); file('docs/TODOS.md');
    const fs = withFs({ readdirSync: path => path === root ? ['Docs'] : defaultFs.readdirSync(path) });
    refused('source_spelling', [], { fs });
    expect(() => probeSpelling(root, 'docs/TODOS.md', false, fs)).toThrow('on-disk spelling is Docs');
    const unicodeFs = { lstatSync: () => statSync(root), readdirSync: () => ['cafe\u0301.md'] };
    expect(() => probeSpelling(root, 'café.md', true, unicodeFs)).not.toThrow();
    expect(() => probeSpelling(root, 'café.md', false, unicodeFs)).toThrow('on-disk spelling');
  });
});

// Value: operand data cannot inject output or commands; exclusions remove items before checks.
describe('records, hidden characters and exclusions', () => {
  for (const operand of ['', '/absolute.md', '../arch.md', 'a/../arch.md', './arch.md', 'a//arch.md']) test(`bad operand ${JSON.stringify(operand)}`, () => {
    file('arch.md', DESIGN);
    refused('bad_operand', [], { audit: () => snapshot(record(operand)) });
    refused('bad_operand', [], { audit: () => snapshot(record('arch.md', operand)) });
  });
  const hidden = ['\0', '\r', '\n', '\t', '\x7f', '\x85', '\u00ad', '\u200b', '\u200c', '\u200d', '\u200e', '\u202e', '\u2066', '\u2069',
    '\u2060', '\u2061', '\u2062', '\u2063', '\u2064', '\u2028', '\u2029', '\ufeff', '\u{e0001}', '\ufe0f', '\u{e0100}', '\u034f', '\ufffd'];
  for (const char of hidden) test(`hidden operand ${escapeValue(char)}`, () => {
    canonical(); const source = `arch${char}.md`; file('good.md', DESIGN);
    // NUL cannot be stored in a filesystem name; exercise that record via the audit seam.
    if (char !== '\0') file(source, DESIGN);
    const audit = char === '\0' ? () => snapshot(record(source)) : defaultAudit;
    const p = plan([], { audit }); status(p, 'ok', 0, true, true);
    expect(p.stdout).toContain('filename contains hidden characters'); expect(p.stdout).toContain(escapeValue(char)); expect(p.stdout).toContain('BLOCKED: 1');
    const result = applyId(id(p), [], { audit }); status(result, 'applied', 0); expect(result.stdout).toContain('BLOCKED: 1');
    if (char !== '\0') { expect(readFileSync(join(root, source), 'utf8')).toBe(DESIGN); expect(existsSync(join(root, 'docs/designs/good.md'))).toBe(true); }
  });
  test('hidden destination and hidden missingParent are Blocked', () => {
    file('arch.md', DESIGN);
    for (const move of [record('arch.md', 'docs/designs/x\u200d.md'), record('arch.md', 'docs/designs/arch.md', { missingParent: 'docs/\u200d' })]) {
      const result = plan([], { audit: () => snapshot(move) }); expect(result.stdout).toContain('BLOCKED: 1'); expect(result.stdout).not.toContain('Moves:');
    }
  });
  for (const source of ['space name.md', "quote'name.md", '$value.md', '`literal`.md', 'a&&b.md', '-leading.md']) test(`tracked filename data ${source}`, () => {
    gitRepo(); file(source, DESIGN); track(source); const captured: string[][] = [];
    const spawn: GitSpawn = (args, opts) => { if (args.includes('mv')) captured.push(args); return defaultGitSpawn(args, opts); };
    const p = plan([], { git: spawn }); const result = applyId(id(p), [], { git: spawn }); status(result, 'applied', 0);
    expect(captured).toHaveLength(1); expect(captured[0]!.slice(-4)).toEqual(['mv', '--', source, `docs/designs/${source}`]);
    expect(readFileSync(join(root, 'docs/designs', source), 'utf8')).toBe(DESIGN);
  });
  test('exclude one of two moves, including same-basename collision escape', () => {
    file('a/arch.md', DESIGN); file('b/arch.md', DESIGN); const p = plan(['--exclude', 'b/arch.md']);
    status(p, 'ok', 0, true, true); expect(p.stdout).toContain('Excluded:\n- b/arch.md');
    const before = tree(); status(applyId(id(p)), 'stale', 1, false); expect(tree()).toBe(before);
    const result = applyId(id(p), ['--exclude', 'b/arch.md']); status(result, 'applied', 0); expect(result.stdout).toContain('EXCLUDED: 1');
    expect(existsSync(join(root, 'a/arch.md'))).toBe(false); expect(readFileSync(join(root, 'b/arch.md'), 'utf8')).toBe(DESIGN);
    expect(result.stdout).not.toContain('Unexpected findings:');
  });
  test('all excluded is no no-op, unmatched refuses, stale wins over unmatched', () => {
    canonical(); file('arch.md', DESIGN);
    const p = plan(['--exclude', 'arch.md']); expect(p.stdout).toContain('Excluded:'); expect(p.stdout).not.toContain('nothing to do');
    refused('exclude_unmatched', ['--exclude', 'missing.md']);
    unlinkSync(join(root, 'arch.md')); const before = tree(); const result = applyId(id(p), ['--exclude', 'arch.md']);
    status(result, 'stale', 1, false); expect(result.stdout).not.toContain('exclude_unmatched'); expect(tree()).toBe(before);
  });
  test('item-scoped source-link refusal can be excluded', () => {
    canonical(); writeFileSync(join(temp, 'target'), DESIGN); symlinkSync(join(temp, 'target'), join(root, 'arch.md'));
    file('good.md', DESIGN); const p = plan(['--exclude', 'arch.md']); status(p, 'ok', 0, true, true);
    const result = applyId(id(p), ['--exclude', 'arch.md']); status(result, 'applied', 0); expect(lstatSync(join(root, 'arch.md')).isSymbolicLink()).toBe(true);
  });
  test('heuristic label appears only on design moves; inbox and collision stay Blocked', () => {
    canonical(); file('TODOS.md'); file('arch.md', DESIGN); file('inbox.md', INBOX);
    const p = plan(); expect(p.stdout.match(/heuristic \(mermaid\/plantuml fence\)/g)).toHaveLength(1);
    expect(p.stdout).toContain('move TODOS.md → docs/TODOS.md\n'); expect(p.stdout).toContain('BLOCKED: 1');
    const result = applyId(id(p)); status(result, 'applied', 0); expect(result.stdout).toContain('BLOCKED: 1');
    expect(readFileSync(join(root, 'inbox.md'), 'utf8')).toBe(INBOX);
  });
  test('typed injected snapshot fully controls planning and re-audit', () => {
    file('real-but-out-of-view.md', DESIGN); file('fake.md'); let calls = 0;
    const audit = () => ++calls === 1 ? snapshot(record('fake.md', 'docs/designs/fake.md')) : snapshot();
    const p = plan([], { audit: () => snapshot(record('fake.md', 'docs/designs/fake.md')) });
    const result = applyId(id(p), [], { audit }); status(result, 'applied', 0); expect(calls).toBe(2);
    expect(readFileSync(join(root, 'real-but-out-of-view.md'), 'utf8')).toBe(DESIGN);
    expect(existsSync(join(root, 'docs/designs/fake.md'))).toBe(true);
  });
  test('Blocked record identity survives suggestion changes after scaffolding', () => {
    file('inbox.md', INBOX); const p = plan(); expect(p.stdout).toContain('BLOCKED: 1');
    const result = applyId(id(p)); status(result, 'applied', 0); expect(result.stdout).not.toContain('Unexpected findings');
    // Inject a blocked design record whose missingParent changes after mkdir.
    file('blocked.md', DESIGN); let calls = 0;
    const blocked = record('blocked.md', 'docs/designs/blocked.md', { blocked: 'collision', missingParent: 'docs/designs' });
    const audit = () => snapshot({ ...blocked, missingParent: ++calls > 1 ? null : 'docs/designs' });
    const b = plan([], { audit: () => snapshot(blocked) }); status(applyId(id(b), [], { audit }), 'applied', 0);
  });
});

// Value: resolved targets and authorization bind actual write locations, including internal links.
describe('containment, drift and authorization', () => {
  test('internal direct and chained directory links pass for untracked moves', () => {
    mkdirSync(join(root, 'real')); symlinkSync('real', join(root, 'middle')); symlinkSync('middle', join(root, 'docs')); file('TODOS.md');
    const p = plan(); status(p, 'ok', 0, true, true); expect(p.stdout).not.toContain('External');
    status(applyId(id(p)), 'applied', 0); expect(readFileSync(join(root, 'real/TODOS.md'), 'utf8')).toBe('example\n');
  });
  test('external parent and absent children require id-bound authorization', () => {
    const outside = join(temp, 'outside'); mkdirSync(outside); symlinkSync(outside, join(root, 'docs')); file('TODOS.md');
    const before = tree(); const p = plan(); status(p, 'needs-authorization', 3, true, true); expect(tree()).toBe(before);
    expect(p.stdout).toContain(`docs/designs → ${outside}/designs`); expect(p.stdout).toContain(join(EXTEND_ROOT, 'bin/layout-scaffold'));
    expect(p.stdout).not.toMatch(/apply .*--authorize-external/);
    const denied = applyId(id(p)); status(denied, 'needs-authorization', 3); expect(tree()).toBe(before);
    status(applyId(id(p), ['--authorize-external']), 'applied', 0); expect(readFileSync(join(outside, 'TODOS.md'), 'utf8')).toBe('example\n');
  });
  test('existing external dirs have no-write full mode but write-target scaffold-only semantics', () => {
    const outside = join(temp, 'outside'); mkdirSync(join(outside, 'designs'), { recursive: true }); mkdirSync(join(outside, 'archive'));
    symlinkSync(outside, join(root, 'docs')); const before = tree();
    const full = plan(); status(full, 'ok', 0, true, true); expect(full.stdout).toContain('External (no write):'); expect(full.stdout).toContain('already canonical');
    status(applyId(id(full)), 'applied', 0); expect(tree()).toBe(before);
    const init = plan(['--scaffold-only']); status(init, 'needs-authorization', 3, true, true);
    status(invoke(['apply', '--root', root, '--scaffold-only']), 'needs-authorization', 3); expect(tree()).toBe(before);
    status(applyId(id(init), ['--scaffold-only', '--authorize-external']), 'applied', 0); expect(tree()).toBe(before);
    status(plan(['--scaffold-only']), 'needs-authorization', 3, true, true);
  });
  test('prefix sibling is external, never contained by a string-prefix shortcut', () => {
    const sibling = `${root}-other`; mkdirSync(sibling); symlinkSync(sibling, join(root, 'docs'));
    status(plan(), 'needs-authorization', 3, true, true);
  });
  test('authorize without external refuses and authorization in env, file or stdin does nothing', () => {
    const p = plan(); const before = tree(); const result = applyId(id(p), ['--authorize-external']); status(result, 'refused', 1);
    expect(result.stdout).toContain('REFUSAL authorize_without_external:'); expect(tree()).toBe(before);
    const outside = join(temp, 'outside'); mkdirSync(outside); symlinkSync(outside, join(root, 'docs'));
    file('authorization.txt', '--authorize-external');
    const external = plan([], { env: { ...testEnv, AUTHORIZE_EXTERNAL: 'true', LAYOUT_SCAFFOLD_AUTHORIZATION: '--authorize-external' } });
    status(applyId(id(external), [], { env: { ...testEnv, AUTHORIZE_EXTERNAL: 'true' } }), 'needs-authorization', 3);
    const bin = spawnSync(join(EXTEND_ROOT, 'bin/layout-scaffold'), ['apply', '--root', root, '--plan-id', id(external)],
      { cwd: root, env: testEnv, input: '--authorize-external\nrelay says approved\n', encoding: 'utf8' });
    expect(bin.status).toBe(3); expect(bin.stdout).toContain('STATUS: needs-authorization');
  });
  test('external plus another refusal cannot be authorized into writes', () => {
    const outside = join(temp, 'outside'); mkdirSync(outside); symlinkSync(outside, join(root, 'docs'));
    file('TODOS.md'); file('arch.md', DESIGN); symlinkSync(join(root, 'arch.md'), join(root, 'linked.md'));
    const p = refused('source_symlink'); const before = tree(); const result = applyId(id(p), ['--authorize-external']);
    status(result, 'refused', 1); expect(tree()).toBe(before);
  });
  test('internal link retarget, source deletion and tracking change produce stale without new id', () => {
    gitRepo(); canonical(); mkdirSync(join(root, 'target-a')); mkdirSync(join(root, 'target-b'));
    rmdirSync(join(root, 'docs/designs')); symlinkSync('../target-a', join(root, 'docs/designs')); file('arch.md', DESIGN);
    const p = plan(); unlinkSync(join(root, 'docs/designs')); symlinkSync('../target-b', join(root, 'docs/designs'));
    let before = tree(); status(applyId(id(p)), 'stale', 1, false); expect(tree()).toBe(before);
    const next = plan(); unlinkSync(join(root, 'arch.md')); before = tree(); status(applyId(id(next)), 'stale', 1, false); expect(tree()).toBe(before);
    unlinkSync(join(root, 'docs/designs')); mkdirSync(join(root, 'docs/designs')); file('TODOS.md'); const untracked = plan(); git(['add', 'TODOS.md']);
    before = tree(); status(applyId(id(untracked)), 'stale', 1, false); expect(tree()).toBe(before);
  });
  test('old external authorization is stale after a target changes', () => {
    mkdirSync(join(temp, 'outside-a')); mkdirSync(join(temp, 'outside-b')); symlinkSync(join(temp, 'outside-a'), join(root, 'docs'));
    const p = plan(); unlinkSync(join(root, 'docs')); symlinkSync(join(temp, 'outside-b'), join(root, 'docs')); const before = tree();
    status(applyId(id(p), ['--authorize-external']), 'stale', 1, false); expect(tree()).toBe(before);
  });
  test('docs link into Git metadata and resolved nested repository refuse', () => {
    gitRepo(); symlinkSync('.git', join(root, 'docs')); refused('git_dir_target'); unlinkSync(join(root, 'docs'));
    file('nested/.git', 'nested repo marker'); symlinkSync('nested', join(root, 'docs')); refused('nested_repo');
  });
  test('resolver propagates EACCES, ELOOP, ENOTDIR and distinguishes a dangling ancestor', () => {
    for (const code of ['EACCES', 'ELOOP', 'ENOTDIR']) {
      const fs = withFs({ lstatSync: () => { throw Object.assign(new Error(code), { code }); } });
      try { resolveTarget(root, 'missing/child', fs); throw new Error('expected refusal'); }
      catch (error) { expect(error).toBeInstanceOf(Refusal); expect((error as Refusal).code).toBe('resolve_error'); expect((error as Error).message).toContain(code); }
    }
    symlinkSync(join(temp, 'missing'), join(root, 'broken'));
    try { resolveTarget(root, 'broken/child', defaultFs); throw new Error('expected refusal'); }
    catch (error) { expect((error as Refusal).code).toBe('beneath_dangling_link'); }
    symlinkSync('cycle', join(root, 'cycle')); expect(() => resolveTarget(root, 'cycle/child', defaultFs)).toThrow('ELOOP');
  });
});

// Value: predictable Git failures refuse before mkdir/mv; the index is part of the unchanged tree.
describe('Git inventory and tracking', () => {
  test('tracking probe nonzero and ENOBUFS refuse with distinct codes and 512 MiB limit', () => {
    gitRepo(); file('TODOS.md'); track('TODOS.md');
    for (const [errorCode, refusal] of [['EIO', 'tracking_probe'], ['ENOBUFS', 'index_too_large']] as const) {
      const spawn: GitSpawn = (args, opts) => {
        expect(opts.maxBuffer).toBe(INDEX_MAX_BUFFER);
        if (args.includes('ls-files')) { expect(args).toContain('-t'); expect(args).toContain('-z'); expect(args).toContain('--stage');
          return { status: 2, stdout: '', stderr: 'probe failed', error: Object.assign(new Error(errorCode), { code: errorCode }) }; }
        return defaultGitSpawn(args, opts);
      };
      refused(refusal, [], { git: spawn });
    }
  });
  for (const path of CANONICAL_DIRS) test(`uninitialized gitlink at ${path}`, () => {
    gitRepo(); git(['update-index', '--add', '--cacheinfo', `160000,${git(['rev-parse', 'HEAD']).trim()},${path}`]);
    refused('gitlink');
  });
  test('real conflicted merge is unmerged_source', () => {
    gitRepo(); file('TODOS.md', 'base\n'); track('TODOS.md'); git(['checkout', '--quiet', '-b', 'side']);
    file('TODOS.md', 'side\n'); git(['commit', '--quiet', '-am', 'side']); git(['checkout', '--quiet', 'main']);
    file('TODOS.md', 'main\n'); git(['commit', '--quiet', '-am', 'main']); git(['merge', 'side'], '', 1);
    refused('unmerged_source');
  });
  test('index lock and sparse checkout refuse tracked batch', () => {
    gitRepo(); file('TODOS.md'); track('TODOS.md'); file('.git/index.lock', 'locked'); refused('index_locked');
    unlinkSync(join(root, '.git/index.lock')); git(['config', 'core.sparseCheckout', 'true']); refused('sparse_checkout');
  });
  test('skip-worktree source refuses', () => {
    gitRepo(); file('TODOS.md'); track('TODOS.md'); git(['update-index', '--skip-worktree', 'TODOS.md']); refused('skip_worktree');
  });
  test('destination deleted from working tree remains in index', () => {
    gitRepo(); file('TODOS.md', 'source\n'); file('docs/TODOS.md', 'destination\n'); track('TODOS.md', 'docs/TODOS.md');
    unlinkSync(join(root, 'docs/TODOS.md')); refused('dest_in_index');
  });
  test('index destination directory-prefix conflict refuses', () => {
    gitRepo(); file('TODOS.md'); file('docs/TODOS.md/child'); track('TODOS.md', 'docs/TODOS.md/child');
    rmSync(join(root, 'docs/TODOS.md'), { recursive: true }); refused('dest_in_index');
  });
  test('case-variant index spelling is checked independently of volume', () => {
    gitRepo(); file('TODOS.md');
    const spawn: GitSpawn = (args, opts) => args.includes('ls-files')
      ? { status: 0, stdout: `H 100644 ${'a'.repeat(40)} 0\ttodos.md\0`, stderr: '' } : defaultGitSpawn(args, opts);
    refused('source_spelling', [], { git: spawn });
  });
  test('tracked destination through internal and authorized external links refuses', () => {
    gitRepo(); file('TODOS.md'); track('TODOS.md'); mkdirSync(join(root, 'real')); symlinkSync('real', join(root, 'docs'));
    refused('tracked_through_link'); unlinkSync(join(root, 'docs')); mkdirSync(join(temp, 'outside')); symlinkSync(join(temp, 'outside'), join(root, 'docs'));
    const p = refused('tracked_through_link'); const before = tree(); status(applyId(id(p), ['--authorize-external']), 'refused', 1); expect(tree()).toBe(before);
  });
  test('tracked cross-device destination refuses, untracked same situation may copy', () => {
    gitRepo(); canonical(); file('TODOS.md'); track('TODOS.md');
    const fs = withFs({ statSync: path => changedStat(defaultFs.statSync(path), { dev: path === join(root, 'docs') ? 9999 : 1 }) });
    refused('cross_device', [], { fs }); git(['rm', '--cached', 'TODOS.md']);
    const copyFs = { ...fs, linkSync: () => { throw Object.assign(new Error('different device'), { code: 'EXDEV' }); } };
    const p = plan([], { fs: copyFs }); const result = applyId(id(p), [], { fs: copyFs }); status(result, 'applied', 0); expect(result.stdout).toContain('copy TODOS.md');
  });
  test('literal pathspec, pinned config and parent env never mutate in imported main', () => {
    gitRepo(); file('TODOS.md'); track('TODOS.md'); const parent = { ...testEnv, GIT_DIR: '/bad', GIT_CEILING_DIRECTORIES: root,
      GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'evil' };
    const original = { ...parent }; const processOriginal = { ...process.env };
    const spawn: GitSpawn = (args, opts) => {
      expect(opts.executable.startsWith('/')).toBe(true); expect(opts.env.GIT_DIR).toBeUndefined(); expect(opts.env.GIT_CEILING_DIRECTORIES).toBeUndefined();
      expect(opts.env.GIT_LITERAL_PATHSPECS).toBe('1'); expect(opts.env.LC_ALL).toBe('C');
      expect(args.slice(0, 6)).toEqual(['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.quotePath=false']);
      if (!args.includes('mv')) expect(opts.env.GIT_OPTIONAL_LOCKS).toBe('0');
      expect(opts.env.GIT_CONFIG_GLOBAL).toBe('/dev/null'); return defaultGitSpawn(args, opts);
    };
    const p = plan([], { env: parent, git: spawn }); status(applyId(id(p), [], { env: parent, git: spawn }), 'applied', 0);
    expect(parent).toEqual(original); expect(process.env).toEqual(processOriginal);
  });
});

// Value: injected failures prove honest partial state and exclusive destination semantics.
describe('apply and post-apply failures', () => {
  test('full tracked plus untracked happy path, plain move and idempotent canonical no-op', () => {
    gitRepo(); file('TODOS.md'); track('TODOS.md'); file('docs/README.md'); file('arch.md', DESIGN);
    const p = plan(); expect(p.stdout).toContain('git mv TODOS.md'); expect(p.stdout).toContain('move arch.md');
    const result = applyId(id(p)); status(result, 'applied', 0); expect(result.stdout).toContain('Staged moves: 1; unstaged moves: 2');
    expect(defaultAudit(root).moves).toEqual([]); const before = tree(); const done = plan(); expect(done.stdout).toContain('already canonical');
    status(applyId(id(done)), 'applied', 0); expect(tree()).toBe(before);
  });
  test('scaffold-only creates dirs, ignores misplaced doc, and second apply is byte-identical', () => {
    file('TODOS.md'); const result = invoke(['apply', '--root', root, '--scaffold-only']); status(result, 'applied', 0);
    expect(readFileSync(join(root, 'TODOS.md'), 'utf8')).toBe('example\n'); for (const path of CANONICAL_DIRS) expect(statSync(join(root, path)).isDirectory()).toBe(true);
    const before = tree(); const p = plan(['--scaffold-only']); expect(p.stdout).toContain('scaffold-only: moves not checked');
    status(invoke(['apply', '--root', root, '--scaffold-only']), 'applied', 0); expect(tree()).toBe(before);
    status(applyId('0'.repeat(64), ['--scaffold-only']), 'stale', 1, false); expect(tree()).toBe(before);
  });
  test('first mkdir throw is partial; later mkdir throw lists completed and unattempted', () => {
    const p = plan();
    for (const failAt of [1, 2]) {
      let count = 0; const fs = withFs({ mkdirSync: path => { if (++count === failAt) throw Object.assign(new Error('mkdir failure'), { code: 'EACCES' }); defaultFs.mkdirSync(path); } });
      const result = applyId(id(p), [], { fs }); status(result, 'partial', 4); expect(result.stdout).toContain('Failed:\n- mkdir'); expect(result.stdout).toContain('Not attempted:\n- mkdir');
      expect(result.stdout).toContain('rmdir empty directories to undo');
      if (failAt === 1) expect(result.stdout).toContain('Completed:\n- (none)'); else expect(result.stdout).toContain('Completed:\n- mkdir docs');
    }
  });
  test('mkdir EEXIST only accepts a real directory', () => {
    const p = plan();
    const fs = withFs({ mkdirSync: path => { defaultFs.mkdirSync(path); throw Object.assign(new Error('raced dir'), { code: 'EEXIST' }); } });
    status(applyId(id(p), [], { fs }), 'applied', 0);
  });
  test('git mv failure checks working-tree and index postconditions, even after a rename', () => {
    gitRepo(); canonical(); file('TODOS.md'); track('TODOS.md'); const p = plan();
    const fail: GitSpawn = (args, opts) => args.includes('mv') ? { status: 128, stdout: '', stderr: 'Git failed' } : defaultGitSpawn(args, opts);
    const first = applyId(id(p), [], { git: fail }); status(first, 'partial', 4); expect(first.stdout).toContain('working-tree rename incomplete; index update incomplete');
    const renameThenFail: GitSpawn = (args, opts) => { if (args.includes('mv')) {
      renameSync(join(root, 'TODOS.md'), join(root, 'docs/TODOS.md')); return { status: 128, stdout: '', stderr: 'failed after rename' }; }
      return defaultGitSpawn(args, opts); };
    const result = applyId(id(p), [], { git: renameThenFail }); status(result, 'partial', 4);
    expect(result.stdout).toContain('working-tree rename happened; index update incomplete'); expect(result.stdout).toContain('inspect git status');
  });
  test('successful exit with wrong git mv postconditions is partial', () => {
    gitRepo(); canonical(); file('TODOS.md'); track('TODOS.md'); const p = plan();
    const lie: GitSpawn = (args, opts) => args.includes('mv') ? { status: 0, stdout: '', stderr: '' } : defaultGitSpawn(args, opts);
    status(applyId(id(p), [], { git: lie }), 'partial', 4);
  });
  for (const code of ['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EMLINK']) test(`link ${code} uses exclusive copy fallback`, () => {
    canonical(); file('docs/README.md', 'original'); const mtime = new Date(1_700_000_000_000); utimesSync(join(root, 'docs/README.md'), mtime, mtime);
    const p = plan(); const fs = withFs({ linkSync: () => { throw Object.assign(new Error(code), { code }); } });
    const result = applyId(id(p), [], { fs }); status(result, 'applied', 0); expect(result.stdout).toContain('copy docs/README.md → README.md');
    expect(statSync(join(root, 'README.md')).mtimeMs).toBe(mtime.getTime()); expect(existsSync(join(root, 'docs/README.md'))).toBe(false);
  });
  test('utimes failure is a note, not a failed move', () => {
    canonical(); file('docs/README.md'); const p = plan(); const fs = withFs({
      linkSync: () => { throw Object.assign(new Error('cross device'), { code: 'EXDEV' }); }, utimesSync: () => { throw new Error('mtime failure'); },
    });
    const result = applyId(id(p), [], { fs }); status(result, 'applied', 0); expect(result.stdout).toContain('mtime not preserved');
  });
  test('non-fallback link failure stops without changing source', () => {
    canonical(); file('docs/README.md'); const p = plan(); const before = tree();
    const fs = withFs({ linkSync: () => { throw Object.assign(new Error('link denied'), { code: 'EACCES' }); } });
    status(applyId(id(p), [], { fs }), 'partial', 4); expect(tree()).toBe(before);
  });
  test('partial exclusive-copy ENOSPC cleans destination and keeps source', () => {
    canonical(); file('docs/README.md', 'original'); const p = plan(); const fs = withFs({
      linkSync: () => { throw Object.assign(new Error('cross device'), { code: 'EXDEV' }); },
      copyFileSync: (_src, dest, flags) => { expect(flags).toBe(constants.COPYFILE_EXCL); writeFileSync(dest, 'partial'); throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); },
    });
    const result = applyId(id(p), [], { fs }); status(result, 'partial', 4); expect(result.stdout).toContain('removed exclusively created partial copy');
    expect(readFileSync(join(root, 'docs/README.md'), 'utf8')).toBe('original'); expect(existsSync(join(root, 'README.md'))).toBe(false);
  });
  test('existing destination at mutation is never overwritten or cleaned up', () => {
    canonical(); file('docs/README.md', 'source'); const p = plan(); const fs = withFs({
      linkSync: (_src, dest) => { writeFileSync(dest, 'raced'); throw Object.assign(new Error('exists'), { code: 'EEXIST' }); },
    });
    status(applyId(id(p), [], { fs }), 'partial', 4); expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe('raced'); expect(readFileSync(join(root, 'docs/README.md'), 'utf8')).toBe('source');
  });
  for (const name of ['README.md', 'LICENSE']) test(`failed unlink of ${name} leaves both paths and next plan Blocked`, () => {
    canonical(); file(`docs/${name}`, 'original'); const p = plan(); const fs = withFs({ unlinkSync: path => {
      if (path === join(root, 'docs', name)) throw Object.assign(new Error('unlink failure'), { code: 'EACCES' }); defaultFs.unlinkSync(path);
    } });
    const result = applyId(id(p), [], { fs }); status(result, 'partial', 4); expect(result.stdout).toContain('both paths present'); expect(result.stdout).toContain(`compare docs/${name} and ${name}, keep one by hand`);
    const next = plan(); expect(next.stdout).toContain('BLOCKED: 1'); expect(next.stdout).toContain('exists in both root and docs/'); expect(next.stdout).not.toContain('already canonical');
  });
  test('unexpected record or re-audit throw is incomplete, with one STATUS line', () => {
    const p = plan(); let calls = 0;
    const audit = () => ++calls === 1 ? snapshot() : snapshot(record('unexpected.md'));
    const result = applyId(id(p), [], { audit }); status(result, 'incomplete', 4); expect(result.stdout).toContain('Unexpected findings:');
    calls = 0; const next = plan(); const throwingAudit = () => { if (++calls === 2) throw new Error('re-audit threw'); return snapshot(); };
    const thrown = applyId(id(next), [], { audit: throwingAudit }); status(thrown, 'incomplete', 4); expect(thrown.stdout).toContain('re-audit threw');
  });
  test('throw before planning is internal_error with stack on stderr and no computed keys', () => {
    const before = tree(); const result = plan([], { audit: () => { throw new Error('injected audit throw'); } });
    status(result, 'refused', 1, false); expect(result.stdout).toContain('REFUSAL internal_error:'); expect(result.stderr).toContain('injected audit throw'); expect(tree()).toBe(before);
  });
  test('scaffold-only verifies the approved resolved targets after writes', () => {
    mkdirSync(join(root, 'replacement')); const p = plan(['--scaffold-only']); let last = false;
    const fs = withFs({ mkdirSync: path => { defaultFs.mkdirSync(path); if (path.endsWith('/designs')) {
      rmdirSync(join(root, 'docs/designs')); symlinkSync('../replacement', join(root, 'docs/designs')); last = true;
    } } });
    const result = applyId(id(p), ['--scaffold-only'], { fs }); expect(last).toBe(true); status(result, 'incomplete', 4); expect(result.stdout).toContain('approved resolved target');
  });
});


// Value: distinguish a failed half-move from intentional mirrors, and expose incomplete discovery.
describe('both-exist precision and unreadable discovery', () => {
  test('different-content root/docs README and CLAUDE are canonical, not Blocked', () => {
    canonical();
    for (const name of ['README.md', 'CLAUDE.md']) { file(name, 'root copy'); file(`docs/${name}`, 'different doc'); }
    const result = plan(); expect(result.stdout).toContain('BLOCKED: 0'); expect(result.stdout).toContain('already canonical');
  });
  test('same bytes with different mtime is an intentional mirror; shared inode qualifies alone', () => {
    canonical(); file('LICENSE', 'license'); file('docs/LICENSE', 'license');
    utimesSync(join(root, 'LICENSE'), new Date(1_600_000_000_000), new Date(1_600_000_000_000));
    utimesSync(join(root, 'docs/LICENSE'), new Date(1_700_000_000_000), new Date(1_700_000_000_000));
    expect(plan().stdout).toContain('BLOCKED: 0'); unlinkSync(join(root, 'docs/LICENSE')); linkSync(join(root, 'LICENSE'), join(root, 'docs/LICENSE'));
    const result = plan(); expect(result.stdout).toContain('BLOCKED: 1'); expect(result.stdout).not.toContain('already canonical');
  });
  test('identical bytes and mtime from failed copy/unlink are Blocked', () => {
    canonical(); file('docs/LICENSE', 'original'); const p = plan();
    const fs = withFs({ linkSync: () => { throw Object.assign(new Error('cross device'), { code: 'EXDEV' }); },
      unlinkSync: path => { if (path === join(root, 'docs/LICENSE')) throw new Error('unlink failure'); defaultFs.unlinkSync(path); } });
    status(applyId(id(p), [], { fs }), 'partial', 4); expect(plan().stdout).toContain('BLOCKED: 1');
    expect(statSync(join(root, 'LICENSE')).ino).not.toBe(statSync(join(root, 'docs/LICENSE')).ino);
  });
  test('project docs at both locations always Blocked whatever content or mtime', () => {
    canonical(); for (const name of ['TODOS.md', 'ROADMAP.md', 'PROGRESS.md']) { file(name, 'root'); file(`docs/${name}`, 'different'); }
    const result = plan(); status(result, 'ok', 0, true, true); expect(result.stdout).toContain('BLOCKED: 3'); expect(result.stdout).not.toContain('already canonical');
    status(applyId(id(result)), 'applied', 0);
  });
  test('injected unreadable dirs suppress no-op and survive expected post-audit', () => {
    canonical(); const audit = () => ({ ...snapshot(), unreadableDirs: [join(root, 'private')] }); const p = plan([], { audit });
    expect(p.stdout).toContain('Not scanned:'); expect(p.stdout).not.toContain('already canonical'); status(applyId(id(p), [], { audit }), 'applied', 0);
  });
  test.skipIf(process.getuid?.() === 0)('unreadable depth-2 directory callback and Not scanned (requires non-root permissions)', () => {
    canonical(); file('private/arch.md', DESIGN); const before = tree(); const path = join(root, 'private');
    chmodSync(path, 0);
    try {
      const unreadable: string[] = []; walkMdFiles(root, 2, dir => unreadable.push(dir)); expect(unreadable).toEqual([path]);
      expect(walkMdFiles(root).some(item => item.rel === 'private/arch.md')).toBe(false);
      const result = plan(); expect(result.stdout).toContain(`Not scanned:\n- ${path}`); expect(result.stdout).not.toContain('already canonical');
    } finally { chmodSync(path, 0o755); }
    expect(tree()).toBe(before);
  });
  test.skipIf(process.getuid?.() === 0)('chmod 000 markdown yields audit_failed before planning and incomplete in re-audit', () => {
    canonical(); file('private.md', 'private'); const path = join(root, 'private.md'); const before = tree(); chmodSync(path, 0);
    try { const result = plan(); status(result, 'refused', 1, false); expect(result.stdout).toContain('REFUSAL audit_failed:'); expect(result.stdout).toContain(path); expect(result.stdout).toContain('EACCES'); expect(result.stderr).toBe(''); }
    finally { chmodSync(path, 0o644); } expect(tree()).toBe(before);
    file('TODOS.md'); const p = plan(); let calls = 0;
    try {
      const audit = () => { if (++calls === 2) chmodSync(path, 0); return defaultAudit(root); };
      const result = applyId(id(p), [], { audit }); status(result, 'incomplete', 4); expect(result.stdout).toContain('EACCES');
    } finally { chmodSync(path, 0o644); }
  });
  test('case-insensitive-volume spelling: runtime skip reason is explicit', () => {
    const probe = join(temp, 'CaseProbe'); writeFileSync(probe, 'probe'); const insensitive = existsSync(join(temp, 'caseprobe')); unlinkSync(probe);
    if (!insensitive) { console.info('SKIP case-insensitive-volume E2E spelling: volume is case-sensitive; injected spelling rows still run'); return; }
    mkdirSync(join(root, 'Docs')); file('TODOS.md'); refused('source_spelling');
  });
});

function bin(args: string[], env: NodeJS.ProcessEnv = testEnv, input = '') {
  return spawnSync(join(EXTEND_ROOT, 'bin/layout-scaffold'), args, { cwd: root, env, input, encoding: 'utf8' });
}
// Value: entry-point protection covers the legacy in-process audit gateway, not only io.git.
describe('Process: entry-point Git safety and launcher failures', () => {
  test('planted git and repository fsmonitor are never executed through the helper', () => {
    gitRepo(); file('TODOS.md'); track('TODOS.md');
    const marker = join(root, 'program-marker'); file('git', `#!/bin/sh\nprintf ran > '${marker}'\nexit 1\n`); chmodSync(join(root, 'git'), 0o755);
    file('fsmonitor', `#!/bin/sh\nprintf ran > '${marker}'\nexit 0\n`); chmodSync(join(root, 'fsmonitor'), 0o755);
    git(['config', 'core.fsmonitor', join(root, 'fsmonitor')]);
    const env = { ...testEnv, PATH: `.:relative:${testEnv.PATH}` }; const p = bin(['plan', '--root', root], env);
    expect(p.status).toBe(0); expect(p.stderr).toBe(''); expect(existsSync(marker)).toBe(false);
    const planId = /^PLAN_ID: ([a-f0-9]{64})$/m.exec(p.stdout)![1]!;
    const result = bin(['apply', '--root', root, '--plan-id', planId], env); expect(result.status).toBe(0); expect(result.stdout).toContain('STATUS: applied'); expect(existsSync(marker)).toBe(false);
  });
  test('inherited GIT_DIR and ceiling overrides are ignored, including explicit subdir root', () => {
    gitRepo(); file('sub/TODOS.md'); track('sub/TODOS.md'); const other = join(temp, 'other'); mkdirSync(other);
    expect(spawnSync('/usr/bin/git', ['-C', other, 'init', '--quiet'], { env: childEnv(testEnv, true) }).status).toBe(0);
    const env = { ...testEnv, GIT_DIR: join(other, '.git'), GIT_CEILING_DIRECTORIES: root };
    const p = bin(['plan', '--root', join(root, 'sub')], env); expect(p.status).toBe(0); expect(p.stdout).toContain('git mv TODOS.md');
    const planId = /^PLAN_ID: ([a-f0-9]{64})$/m.exec(p.stdout)![1]!;
    const result = bin(['apply', '--root', join(root, 'sub'), '--plan-id', planId], env); expect(result.status).toBe(0); expect(result.stdout).toContain('STATUS: applied');
    expect(git(['ls-files', 'sub/docs/TODOS.md'])).toContain('sub/docs/TODOS.md');
  });
  test('bin caller flows: plan-confirm-apply and one-shot scaffolding twice', () => {
    file('TODOS.md'); const p = bin(['plan', '--root', root]); expect(p.status).toBe(0); expect(p.stdout).toMatch(/^STATUS: ok$/m);
    const planId = /^PLAN_ID: ([a-f0-9]{64})$/m.exec(p.stdout)![1]!;
    const result = bin(['apply', '--root', root, '--plan-id', planId]); expect(result.status).toBe(0); expect(result.stdout).toMatch(/^STATUS: applied$/m);
    for (let i = 0; i < 2; i++) { const init = bin(['apply', '--root', root, '--scaffold-only']); expect(init.status).toBe(0); expect(init.stdout).toMatch(/^STATUS: applied$/m); }
  });
  test('bin authorized scaffold-only sequence reauthorizes every invocation', () => {
    const outside = join(temp, 'outside'); mkdirSync(outside); symlinkSync(outside, join(root, 'docs'));
    const p = bin(['plan', '--root', root, '--scaffold-only']); expect(p.status).toBe(3); expect(p.stdout).toContain(`docs → ${outside}`);
    const planId = /^PLAN_ID: ([a-f0-9]{64})$/m.exec(p.stdout)![1]!;
    const result = bin(['apply', '--root', root, '--scaffold-only', '--plan-id', planId, '--authorize-external']); expect(result.status).toBe(0); expect(result.stdout).toContain('STATUS: applied');
    expect(statSync(join(outside, 'designs')).isDirectory()).toBe(true); expect(bin(['plan', '--root', root, '--scaffold-only']).status).toBe(3);
  });
  test('missing and non-absolute Bun yield ERROR/FIX exit 5 without STATUS', () => {
    const missing = bin(['plan', '--root', root], { ...testEnv, PATH: '' }); expect(missing.status).toBe(5); expect(missing.stdout).toBe(''); expect(missing.stderr).toContain('ERROR bun_missing:'); expect(missing.stderr).toContain('FIX:');
    file('bun', '#!/bin/sh\nexit 0\n'); chmodSync(join(root, 'bun'), 0o755);
    const relative = bin(['plan', '--root', root], { ...testEnv, PATH: '.' }); expect(relative.status).toBe(5); expect(relative.stderr).toContain('ERROR bun_missing:'); expect(relative.stdout).toBe('');
    // macOS sh expands relative PATH hits to absolute paths; inject only the
    // command-v lookup to exercise the non-absolute-result branch on every host.
    const lookup = spawnSync('/bin/sh', ['-c', 'command() { printf "./bun\\n"; }; . "$1"', 'lookup', join(EXTEND_ROOT, 'bin/layout-scaffold')],
      { env: testEnv, cwd: root, input: '', encoding: 'utf8' });
    expect(lookup.status).toBe(5); expect(lookup.stderr).toContain('ERROR bun_not_absolute:'); expect(lookup.stdout).toBe('');
  });
  test('source missing, relative symlinked launcher, and symlink-loop resolution', () => {
    const copied = join(temp, 'copy/bin/layout-scaffold'); mkdirSync(resolve(copied, '..'), { recursive: true }); copyFileSync(join(EXTEND_ROOT, 'bin/layout-scaffold'), copied); chmodSync(copied, 0o755);
    const missing = spawnSync(copied, ['plan', '--root', root], { env: testEnv, cwd: root, input: '', encoding: 'utf8' });
    expect(missing.status).toBe(5); expect(missing.stderr).toContain('ERROR source_missing:'); expect(missing.stdout).toBe('');
    const link = join(temp, 'linked'); symlinkSync(join(EXTEND_ROOT, 'bin/layout-scaffold'), join(temp, 'target')); symlinkSync('target', link);
    const linked = spawnSync(link, ['--version'], { env: testEnv, input: '', encoding: 'utf8' }); expect(linked.status).toBe(0); expect(linked.stdout).toContain('layout-scaffold'); expect(linked.stderr).toBe('');
    symlinkSync('loop', join(temp, 'loop'));
    // Source the shim with the looping name as $0; the kernel cannot execute a loop itself.
    const loop = spawnSync('/bin/sh', ['-c', '. "$1"', join(temp, 'loop'), join(EXTEND_ROOT, 'bin/layout-scaffold')], { env: testEnv, input: '', encoding: 'utf8' });
    expect(loop.status).toBe(5); expect(loop.stderr).toContain('ERROR symlink_loop:'); expect(loop.stdout).toBe('');
  });
});


test('internal read error after planning but before the first mutation is refused with computed counters', () => {
  canonical(); file('docs/README.md'); const p = plan(); const before = tree();
  const fs = withFs({ statSync: path => { if (path === join(root, 'docs/README.md')) throw new Error('source metadata unreadable before mutation'); return defaultFs.statSync(path); } });
  const result = applyId(id(p), [], { fs }); status(result, 'refused', 1);
  expect(result.stdout).toContain('REFUSAL internal_error:'); expect(result.stderr).toContain('source metadata unreadable'); expect(tree()).toBe(before);
});

test('disappeared injected source refuses during planning', () => {
  canonical(); refused('resolve_error', [], { audit: () => snapshot(record('vanished.md')) });
});

test('NFC-equal destinations are duplicates even on a case-sensitive volume', () => {
  file('a/café.md', DESIGN); file('b/cafe\u0301.md', DESIGN); refused('dest_duplicate');
});

test('precomposeUnicode also accepts NFC-equal index source spelling', () => {
  gitRepo(); canonical(); file('cafe\u0301.md', DESIGN); git(['config', 'core.precomposeUnicode', 'true']);
  const physical = join(root, 'cafe\u0301.md');
  const fs = withFs({ lstatSync: path => defaultFs.lstatSync(path === join(root, 'café.md') ? physical : path),
    statSync: path => defaultFs.statSync(path === join(root, 'café.md') ? physical : path) });
  const spawn: GitSpawn = (args, opts) => args.includes('ls-files')
    ? { status: 0, stdout: `H 100644 ${'a'.repeat(40)} 0\tcafe\u0301.md\0`, stderr: '' } : defaultGitSpawn(args, opts);
  const result = plan([], { fs, git: spawn, audit: () => snapshot(record('café.md', 'docs/designs/café.md')) });
  status(result, 'ok', 0, true, true); expect(result.stdout).toContain('git mv café.md');
});

test('shared inode qualifies alone without reading either root-doc copy', () => {
  canonical(); file('LICENSE', 'license'); linkSync(join(root, 'LICENSE'), join(root, 'docs/LICENSE'));
  const audit = () => ({ ...snapshot(), exists: { rootLicense: true, docsLicense: true } });
  const fs = withFs({ readFileSync: () => { throw new Error('same inode should not need byte reads'); } });
  const result = plan([], { fs, audit }); status(result, 'ok', 0, true, true); expect(result.stdout).toContain('BLOCKED: 1');
});
