import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { makeEmptyRepo } from './helpers/fixture-repo';
import { DISPOSITIONS, evaluate, parseEntries, sha256, type Check, type Entry } from '../src/secret-dispositions/evaluate';

const root = resolve(import.meta.dir, '..');
const temp = mkdtempSync(join(tmpdir(), 'secret-dispositions-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));
// Fictional approval metadata belongs only to these isolated test fixtures.
const examples = [
  { file: 'src/mmm_factory/managerusage.py', line: 50, text: 'session = row.get("manager_session") if row and row.get("stage") == "manager" else None', reason: 'This is a Python expression, not a literal credential.' },
  { file: 'tests/test_factory_manager.py', line: 322, text: 'secret = "SECRET-TOKEN-VALUE"', reason: 'This sentinel is checked to be absent from error output.' },
  { file: 'tests/test_manager_usage.py', line: 21, text: 'SESSION = "5d2c8a10-3b7e-4c11-9a64-8f0e1b2c3d4e"', reason: 'This UUID is a synthetic test identifier.' },
];
const parts = examples.map(({ file, text }) => ({ file, text }));
const entries: Entry[] = examples.map(e => ({ path: e.file, rule: 'env.kv', line_sha256: sha256(e.text), reason: e.reason,
  approved_by: 'Fixture reviewer', approved_at: '2026-10-23T12:00:00Z' }));
const sources = () => new Map(parts.map(p => [p.file, p.text]));
const check = (): Check => ({ id: 'secrets', status: 'fail', code: 'PREGATE_SECRETS', inputs: { added_lines: sha256(JSON.stringify(parts)) },
  detail: '3 credential finding(s) in added lines (env.kv, env.kv, env.kv)',
  lines: parts.map(p => `MEDIUM env.kv [secret]: sensitive assignment (${p.file}, added line 1)`) });

describe('exact-line disposition matching', () => {
  test('the three requested examples pass without mutating the raw failure', () => {
    const raw = check(), before = JSON.stringify(raw);
    const result = evaluate(raw, parts, entries, sources());
    expect(result.satisfied).toBe(true);
    expect(result.matched.map(m => m.approval)).toEqual(entries);
    expect(result.stale).toEqual([]);
    expect(JSON.stringify(raw)).toBe(before);
    expect(raw.status).toBe('fail');
  });
  test('changed line fails, reports its stale entry, and retains other matches', () => {
    const changed = parts.map((p, i) => ({ ...p, text: p.text + (i === 0 ? ' ' : '') }));
    const raw = check(); raw.inputs!.added_lines = sha256(JSON.stringify(changed));
    const result = evaluate(raw, changed, entries, new Map(changed.map(p => [p.file, p.text])));
    expect(result.satisfied).toBe(false);
    expect(result.unmatched).toHaveLength(1);
    expect(result.stale.map(s => s.path)).toEqual([examples[0]!.file]);
    expect(result.matched).toHaveLength(2);
  });
  test('HIGH cannot be approved, including non-secret categories', () => {
    for (const category of ['secret', 'pii']) {
      const raw = check(); raw.lines![0] = raw.lines![0]!.replace('MEDIUM', 'HIGH').replace('[secret]', `[${category}]`);
      const result = evaluate(raw, parts, entries, sources());
      expect(result.satisfied).toBe(false);
      expect(result.unmatched[0]!.severity).toBe('HIGH');
    }
  });
  test('missing approval, different path and different rule cannot match', () => {
    for (const approvals of [entries.slice(1), entries.map(e => ({ ...e, path: `other/${e.path}` })), entries.map(e => ({ ...e, rule: 'different' }))]) {
      expect(evaluate(check(), parts, approvals, sources()).satisfied).toBe(false);
    }
  });
  test('unchanged lines moved within a file stay valid; deleted entries are stale even on a raw pass', () => {
    const moved = new Map(parts.map(p => [p.file, `# moved\n${p.text}\n`]));
    expect(evaluate(check(), parts, entries, moved).satisfied).toBe(true);
    moved.delete(parts[0]!.file);
    const result = evaluate({ id: 'secrets', status: 'pass' }, [], entries, moved);
    expect(result.satisfied).toBe(true);
    expect(result.stale).toHaveLength(1);
  });
  test('line hashes preserve whitespace, CR and exact text', () => {
    const line = examples[0]!.text;
    for (const changed of [` ${line}`, `${line} `, `${line}\r`, line.replace('None', 'False')]) expect(sha256(changed)).not.toBe(sha256(line));
  });
  test('unknown, truncated, empty and inconsistent finding evidence fails closed', () => {
    for (const change of [
      { lines: [] }, { lines: check().lines!.slice(1) }, { lines: ['HIGH findings (unknown format)'] },
      { detail: 'HIGH finding(s) in added lines' }, { status: 'incomplete' }, { code: 'OTHER' },
      { inputs: { added_lines: 'changed' } }, { detail: '2 credential finding(s) in added lines (env.kv, env.kv)' },
      { lines: check().lines!.map(l => l.replace('added line 1', 'added line 999')) },
    ]) expect(evaluate({ ...check(), ...change }, parts, entries, sources()).satisfied).toBe(false);
  });
  test('a MEDIUM non-secret advisory does not become a new blocker', () => {
    const raw = check(); raw.lines!.push(`MEDIUM hostname [internal]: private name (${parts[0]!.file}, added line 1)`);
    expect(evaluate(raw, parts, entries, sources()).satisfied).toBe(true);
  });
  test('a parenthesized filename cannot borrow another path approval', () => {
    const distinct = [{ file: 'safe.py', text: examples[1]!.text }, { file: 'other (safe.py', text: examples[2]!.text }];
    const raw = { ...check(), inputs: { added_lines: sha256(JSON.stringify(distinct)) },
      detail: '2 credential finding(s) in added lines (env.kv, env.kv)',
      lines: distinct.map(p => `MEDIUM env.kv [secret]: assignment (${p.file}, added line 1)`) };
    const approved = [{ ...entries[1]!, path: 'safe.py' }];
    const result = evaluate(raw, distinct, approved, new Map(distinct.map(p => [p.file, p.text])));
    expect(result.satisfied).toBe(false);
    expect(result.errors).toContain('finding path is missing or ambiguous');
    expect(result.matched).toHaveLength(1);
  });
  test('schema requires exact paths, approval metadata and unique tuples', () => {
    expect(parseEntries({ version: 1, entries })).toEqual(entries);
    for (const change of [{ path: '../outside' }, { path: '/outside' }, { path: 'a/../b' }, { path: '.git/config' },
      { path: 'a\\b' }, { line_sha256: 'abc' }, { reason: '' }, { approved_by: '' },
      { approved_at: 'yesterday' }, { approved_at: '2026-02-31T12:00:00Z' }]) {
      expect(() => parseEntries({ version: 1, entries: [{ ...entries[0], ...change }] })).toThrow();
    }
    expect(() => parseEntries({ version: 2, entries })).toThrow();
    expect(() => parseEntries({ version: 1, entries: [entries[0], entries[0]] })).toThrow();
  });
});

function write(file: string, content: string) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content); }
function git(repo: string, ...args: string[]) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}
function fixture() {
  const repo = makeEmptyRepo(temp);
  const base = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'update-ref', 'refs/remotes/origin/main', base);
  for (const e of examples) write(join(repo, e.file), `${'# context\n'.repeat(e.line - 1)}${e.text}\n`);
  write(join(repo, DISPOSITIONS), JSON.stringify({ version: 1, entries }, null, 2) + '\n');
  git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'fixture approvals and examples');
  return { repo, base, head: git(repo, 'rev-parse', 'HEAD') };
}
function run(repo: string, upstream: string, record: string, stage = 'all') {
  return spawnSync(join(root, 'bin/secret-dispositions'), ['--gstack-root', upstream, '--pregate', record, '--stage', stage],
    { cwd: repo, encoding: 'utf8', timeout: 60_000 });
}

describe('read-only CLI gate', () => {
  const upstream = join(temp, 'fake-upstream');
  const ids = ['regen', 'secrets', 'strays', 'literals', 'timing', 'guards', 'lanes'];
  // Hermetic upstream API doubles, separate from the opt-in actual scanner test below.
  write(join(upstream, 'lib/pregate/index.ts'), `
    import { readFileSync } from 'node:fs';
    export const CHECKS = ${JSON.stringify(ids)}.map(id => ({ id, stage: id === 'lanes' ? 'tests' : 'preflight' }));
    export const readPregateFile = path => ({file: JSON.parse(readFileSync(path, 'utf8'))});
    export const verifyPregate = (repo, file) => ({current: file.tree === '${'a'.repeat(40)}'});
    export const verdictOf = file => file.checks.some(c => c.status === 'fail') ? 'fail' : 'pass';
  `);
  write(join(upstream, 'lib/pregate/context.ts'), 'export const touchedFiles = () => [];');
  write(join(upstream, 'lib/pregate/checks/secrets.ts'), `export const addedLines = () => ${JSON.stringify(parts)};`);
  function setup() {
    const f = fixture(), record = join(temp, `raw-${crypto.randomUUID()}.json`);
    const raw = { schema_version: 1, tree: 'a'.repeat(40), head: f.head, base: `origin/main@${f.base.slice(0, 12)}`, verdict: 'fail',
      checks: ids.map(id => id === 'secrets' ? check() : { id, status: 'pass' }), requires_remote: [] };
    const save = () => write(record, JSON.stringify(raw));
    save(); return { ...f, raw, record, save };
  }
  test('prints raw fail, all three entry references and hashes; never changes either input', () => {
    const f = setup(), before = readFileSync(f.record, 'utf8'), approvals = readFileSync(join(f.repo, DISPOSITIONS), 'utf8');
    const r = run(f.repo, upstream, f.record), output = JSON.parse(r.stdout);
    expect(r.status).toBe(0);
    expect(output.raw_verdict).toBe('fail'); expect(output.raw_secrets).toBe('fail');
    expect(output.receipt).toContain('secrets: raw fail; 3 findings dispositioned');
    for (let i = 0; i < 3; i++) expect(output.receipt).toContain(`${DISPOSITIONS}#/entries/${i}`);
    expect(output.raw_sha256).toBe(sha256(before));
    expect(readFileSync(f.record, 'utf8')).toBe(before);
    expect(readFileSync(join(f.repo, DISPOSITIONS), 'utf8')).toBe(approvals);
  });
  test('uncommitted approvals, other failures, missing checks, stale tree/head/base and remote obligations block', () => {
    const cases = [
      (f: ReturnType<typeof setup>) => write(join(f.repo, DISPOSITIONS), JSON.stringify({ version: 1, entries })),
      (f: ReturnType<typeof setup>) => { f.raw.checks[0]!.status = 'fail'; },
      (f: ReturnType<typeof setup>) => { f.raw.checks[0]!.status = 'incomplete'; },
      (f: ReturnType<typeof setup>) => { f.raw.checks.pop(); },
      (f: ReturnType<typeof setup>) => { f.raw.checks.push(f.raw.checks[0]!); },
      (f: ReturnType<typeof setup>) => { f.raw.tree = 'b'.repeat(40); },
      (f: ReturnType<typeof setup>) => { f.raw.head = 'b'.repeat(40); },
      (f: ReturnType<typeof setup>) => { f.raw.base = 'origin/main@bbbbbbbbbbbb'; },
      (f: ReturnType<typeof setup>) => { f.raw.verdict = 'pass'; },
      (f: ReturnType<typeof setup>) => { (f.raw.requires_remote as unknown[]).push({ lane: 'remote', receipt: null }); },
    ];
    for (const mutate of cases) {
      const f = setup(); mutate(f); f.save();
      const r = run(f.repo, upstream, f.record);
      expect(r.status).not.toBe(0); expect(JSON.parse(r.stdout).satisfied).toBe(false);
    }
  });
  test('no approval file is created for a missing entry', () => {
    const f = setup(); rmSync(join(f.repo, DISPOSITIONS));
    const r = run(f.repo, upstream, f.record);
    expect(r.status).toBe(1); expect(JSON.parse(r.stdout).unmatched).toHaveLength(3);
    expect(() => readFileSync(join(f.repo, DISPOSITIONS))).toThrow();
  });
  test('write/approval flags are rejected', () => {
    const f = setup();
    for (const arg of ['--add', '--approve', '--write']) {
      const r = spawnSync(join(root, 'bin/secret-dispositions'), [arg, 'yes'], { cwd: f.repo, encoding: 'utf8' });
      expect(r.status).toBe(2);
    }
  });
  test('a symlink cannot supply an approved source or disposition file', () => {
    const f = setup(), file = join(f.repo, examples[0]!.file), target = join(temp, 'linked-source');
    write(target, examples[0]!.text); rmSync(file); symlinkSync(target, file);
    const r = run(f.repo, upstream, f.record), output = JSON.parse(r.stdout);
    expect(r.status).toBe(1);
    expect(output.stale).toHaveLength(1);
    const approvalFile = join(f.repo, DISPOSITIONS);
    const approvalTarget = join(temp, 'linked-approvals'); write(approvalTarget, readFileSync(approvalFile, 'utf8'));
    rmSync(approvalFile); symlinkSync(approvalTarget, approvalFile);
    expect(run(f.repo, upstream, f.record).status).toBe(2);
  });
  test('raw passes do not read unrelated symlinks and still report stale approvals', () => {
    const f = setup(), file = join(f.repo, examples[0]!.file);
    f.raw.checks = f.raw.checks.map(c => ({ ...c, status: 'pass' })); f.raw.verdict = 'pass'; f.save();
    rmSync(file); symlinkSync('missing-target', file);
    symlinkSync('missing-target', join(f.repo, 'CLAUDE.md'));
    const r = run(f.repo, upstream, f.record), output = JSON.parse(r.stdout);
    expect(r.status).toBe(0); expect(output.stale).toHaveLength(1);
  });
  test('in-project upstream code is rejected before import', () => {
    const f = setup();
    const localUpstream = join(f.repo, 'untrusted-upstream');
    cpSync(upstream, localUpstream, { recursive: true });
    const r = run(f.repo, localUpstream, f.record);
    expect(r.status).toBe(2); expect(JSON.parse(r.stdout).satisfied).toBe(false);
    expect(JSON.parse(r.stdout).error).toBe('gstack root must be a trusted installation outside the project');
  });
});

test('both wrapper instructions require user approval and preserve failed test evidence', () => {
  for (const skill of ['review-and-prep', 'ship-and-land']) {
    const text = readFileSync(join(root, `skills/${skill}.md`), 'utf8');
    expect(text).toContain('bin/secret-dispositions --gstack-root <trusted-gstack-root> --pregate <raw-record>');
    expect(text).toContain("for the user's approval in this session before adding or changing any entry");
    expect(text).toContain('Never edit\nthe raw record or promote a failed test ledger entry.');
    expect(text).toContain('HIGH, unmatched MEDIUM');
  }
  const ship = readFileSync(join(root, 'skills/ship-and-land.md'), 'utf8');
  expect(ship).toContain('Only after the current evaluator exits 0');
  expect(ship).toContain('run that receipt command without its `--pregate <raw-record>`');
  expect(ship).toContain('The native receipt then makes no pregate claim.');
});

const installed = process.env.GSTACK_SECRET_DISPOSITIONS_INTEGRATION_ROOT;
test.skipIf(!installed)('actual installed pregate: three examples pass only in wrapper; edit becomes stale and fails', () => {
  const f = fixture(), record = join(temp, 'installed-pregate.json');
  const scan = () => spawnSync(join(installed!, 'bin/gstack-pregate'), ['--base', 'main', '--stage', 'preflight', '--out', record],
    { cwd: f.repo, encoding: 'utf8', timeout: 120_000, env: { ...process.env, GSTACK_STATE_ROOT: join(temp, 'gstack-state') } });
  const first = scan();
  expect(first.status).toBe(1);
  const raw = readFileSync(record, 'utf8');
  expect(JSON.parse(raw).checks.find((c: Check) => c.id === 'secrets').status).toBe('fail');
  const allowed = run(f.repo, installed!, record, 'preflight');
  expect(allowed.stderr).toBe('');
  expect(JSON.parse(allowed.stdout).errors).toEqual([]);
  expect(allowed.status).toBe(0);
  expect(JSON.parse(allowed.stdout).matched).toHaveLength(3);
  expect(readFileSync(record, 'utf8')).toBe(raw);
  const receipt = (...args: string[]) => spawnSync(join(installed!, 'bin/gstack-ship-receipt'),
    ['write', '--base', 'main', '--session-kind', 'spawned', '--json', ...args],
    { cwd: f.repo, encoding: 'utf8', timeout: 60_000 });
  expect(receipt('--pregate', record).status).toBe(1);
  const nativeReceipt = receipt();
  expect(nativeReceipt.status).toBe(0);
  expect(JSON.parse(nativeReceipt.stdout).pregate).toBeUndefined();
  expect(readFileSync(record, 'utf8')).toBe(raw);
  write(join(f.repo, examples[0]!.file), `${examples[0]!.text} # changed\n`);
  expect(scan().status).toBe(1);
  const blocked = run(f.repo, installed!, record, 'preflight'), output = JSON.parse(blocked.stdout);
  expect(blocked.status).toBe(1);
  expect(output.unmatched).toHaveLength(1);
  expect(output.stale.map((e: Entry) => e.path)).toEqual([examples[0]!.file]);
}, 180_000);
