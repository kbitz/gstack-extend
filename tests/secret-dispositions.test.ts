import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { cpSync, chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { makeEmptyRepo } from './helpers/fixture-repo';
import { DISPOSITIONS, evaluate, parseEntries, sha256, type Check, type Entry, type Part } from '../src/secret-dispositions/evaluate';
import { countsFor, decide, eligibleComponent, exitFor, isDelimitedAfter, knownComponents, maskComponents, offsetOf, type ScanFinding } from '../src/secret-dispositions/scan-text';

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

describe('whole-file parts', () => {
  // Upstream hands a tracked Python or Dart file over whole: `keep` lists its added line numbers
  // and findings render as `line N`, a source line number. Other files keep `added line N`.
  const file = 'app/settings.py', LOCATION = 'finding location does not match upstream added-line selection';
  const RESOLVE = 'finding does not resolve to an exact current source line', AMBIGUOUS = 'finding path is missing or ambiguous';
  const lines = ['# existing', examples[1]!.text, '# existing', examples[2]!.text, ''];
  const whole = (extra: Partial<Part> = { keep: [2] }): Part => ({ file, text: lines.join('\n'), ...extra });
  const at = (loc: string, head = 'MEDIUM env.kv [secret]') => `${head}: sensitive assignment (${file}, ${loc})`;
  const record = (ps: Part[], found: string[], rules = found.map(() => 'env.kv')): Check => ({ id: 'secrets', status: 'fail', code: 'PREGATE_SECRETS',
    inputs: { added_lines: sha256(JSON.stringify(ps)) }, detail: `${rules.length} credential finding(s) in added lines (${rules.join(', ')})`, lines: found });
  const approve = (text: string, rule = 'env.kv', path = file): Entry => ({ ...entries[0]!, path, rule, line_sha256: sha256(text) });
  const src = (text = lines.join('\n')) => new Map([[file, text]]);

  test('both location forms are satisfied by matching entries in one record', () => {
    const plain: Part = { file: 'src/other.js', text: examples[2]!.text };
    const ps = [whole(), plain];
    const found = [at('line 2'), `MEDIUM env.kv [secret]: sensitive assignment (${plain.file}, added line 1)`];
    const result = evaluate(record(ps, found), ps, [approve(examples[1]!.text), approve(plain.text, 'env.kv', plain.file)],
      new Map([[file, lines.join('\n')], [plain.file, plain.text]]));
    expect(result.errors).toEqual([]);
    expect(result.satisfied).toBe(true);
    expect(result.matched.map(m => [m.finding.path, m.finding.added_line])).toEqual([[file, 2], [plain.file, 1]]);
  });
  test('a finding on a line that is not an added line cannot be satisfied, even with a matching entry', () => {
    const result = evaluate(record([whole()], [at('line 4')]), [whole()], [approve(examples[2]!.text)], src());
    expect(result.satisfied).toBe(false);
    expect(result.errors).toContain(LOCATION);
    expect(result.matched).toEqual([]);
    expect(result.unmatched).toEqual([]);
  });
  test('engine findings follow the same location rule, including a HIGH one', () => {
    for (const head of ['MEDIUM engine.synthetic [secret]', 'HIGH engine.input_too_large [secret]']) {
      const rule = head.split(' ')[1]!;
      const result = evaluate(record([whole()], [at('line 4', head)], [rule]), [whole()], [approve(examples[2]!.text, rule)], src());
      expect(result.satisfied).toBe(false);
      expect(result.errors).toContain(LOCATION);
      expect(result.matched).toEqual([]);
      expect(result.unmatched).toEqual([]);
    }
  });
  test('the wrong form for the part is an error each way', () => {
    const plain: Part = { file, text: examples[1]!.text };
    for (const [part, loc] of [[whole(), 'added line 2'], [plain, 'line 1']] as const) {
      const result = evaluate(record([part], [at(loc)]), [part], [approve(examples[1]!.text)], src(part.text));
      expect(result.satisfied).toBe(false);
      expect(result.errors).toContain(LOCATION);
      expect(result.matched).toEqual([]);
    }
  });
  test('a line number out of range is an error in either form', () => {
    const outside = evaluate(record([whole()], [at('line 999')]), [whole()], [approve(examples[1]!.text)], src());
    expect(outside.errors).toContain(LOCATION);
    const kept = whole({ keep: [999] }), plain: Part = { file, text: examples[1]!.text };
    for (const [part, loc] of [[kept, 'line 999'], [plain, 'added line 999']] as const) {
      const result = evaluate(record([part], [at(loc)]), [part], [approve(examples[1]!.text)], src(part.text));
      expect(result.satisfied).toBe(false);
      expect(result.errors).toContain(RESOLVE);
      expect(result.matched).toEqual([]);
    }
    const zero = evaluate(record([whole()], [at('line 0')]), [whole()], [approve(examples[1]!.text)], src());
    expect(zero.satisfied).toBe(false);
    expect(zero.errors).toContain('unrecognized upstream finding line');
  });
  test('ambiguous path suffixes stay ambiguous; keep never breaks the tie', () => {
    const a = (keep?: number[]): Part => ({ file: 'safe.py', text: examples[1]!.text, ...(keep ? { keep } : {}) });
    const b = (keep?: number[]): Part => ({ file: 'other (safe.py', text: examples[2]!.text, ...(keep ? { keep } : {}) });
    const sources = new Map([[a().file, a().text], [b().file, b().text]]);
    const approvals = [approve(a().text, 'env.kv', a().file), approve(b().text, 'env.kv', b().file)];
    const item = (p: Part, kind: string) => `MEDIUM env.kv [secret]: assignment (${p.file}, ${kind} 1)`;
    // Both parts whole-file, then one whole-file and one plain. The second finding's line ends with the first part's suffix.
    for (const ps of [[a([1]), b([1])], [a([1]), b()]]) {
      const kind = ps[1]!.keep ? 'line' : 'added line';
      const result = evaluate(record(ps, [item(ps[0]!, 'line'), item(ps[1]!, kind)]), ps, approvals, sources);
      expect(result.satisfied).toBe(false);
      expect(result.errors).toContain(AMBIGUOUS);
      expect(result.matched).toHaveLength(1);
      expect(result.matched[0]!.finding.path).toBe('safe.py');
    }
  });
  test('the added-line input hash covers keep', () => {
    const raw = record([whole()], [at('line 2')]);
    expect(evaluate(raw, [whole()], [approve(examples[1]!.text)], src()).satisfied).toBe(true);
    for (const other of [whole({}), whole({ keep: [3] })]) {
      const stale = { ...raw, inputs: { added_lines: sha256(JSON.stringify([other])) } };
      const result = evaluate(stale, [whole()], [approve(examples[1]!.text)], src());
      expect(result.satisfied).toBe(false);
      expect(result.errors).toContain('added-line input hash differs from the raw pregate record');
    }
  });
  test('the source line must be exact: absent, at another line or one byte off is refused', () => {
    const entry = approve(examples[1]!.text), raw = record([whole()], [at('line 2')]);
    const moved = ['# existing', '# existing', examples[1]!.text, examples[2]!.text, ''].join('\n');
    const absent = ['# existing', '# changed', '# existing', examples[2]!.text, ''].join('\n');
    const off = ['# existing', `${examples[1]!.text} `, '# existing', examples[2]!.text, ''].join('\n');
    for (const text of [absent, moved, off]) {
      const result = evaluate(raw, [whole()], [entry], src(text));
      expect(result.satisfied).toBe(false);
      expect(result.errors).toContain(RESOLVE);
      expect(result.matched).toEqual([]);
    }
  });
  test('the entry hash is exact on a whole-file part, including a CR', () => {
    const crLines = ['# existing', `${examples[1]!.text}\r`, '# existing', examples[2]!.text, ''], text = crLines.join('\n');
    const part: Part = { file, text, keep: [2] }, raw = record([part], [at('line 2')]);
    const unmatched = evaluate(raw, [part], [approve(examples[1]!.text)], src(text));
    expect(unmatched.satisfied).toBe(false);
    expect(unmatched.matched).toEqual([]);
    expect(unmatched.unmatched).toHaveLength(1);
    expect(unmatched.unmatched[0]!.line_sha256).toBe(sha256(`${examples[1]!.text}\r`));
    const matched = evaluate(raw, [part], [approve(`${examples[1]!.text}\r`)], src(text));
    expect(matched.errors).toEqual([]);
    expect(matched.satisfied).toBe(true);
    expect(matched.matched).toHaveLength(1);
  });
  test('HIGH on an added line stays unapprovable', () => {
    const head = 'HIGH env.kv [secret]';
    const result = evaluate(record([whole()], [at('line 2', head)]), [whole()], [approve(examples[1]!.text)], src());
    expect(result.satisfied).toBe(false);
    expect(result.matched).toEqual([]);
    expect(result.unmatched.map(f => f.severity)).toEqual(['HIGH']);
  });
  test('a MEDIUM non-secret is no blocker on an added line and a location error elsewhere', () => {
    const advisory = (loc: string) => at(loc, 'MEDIUM hostname [internal]');
    const kept = record([whole()], [at('line 2'), advisory('line 2')], ['env.kv']);
    const ok = evaluate(kept, [whole()], [approve(examples[1]!.text)], src());
    expect(ok.errors).toEqual([]);
    expect(ok.satisfied).toBe(true);
    const outside = record([whole()], [at('line 2'), advisory('line 4')], ['env.kv']);
    const refused = evaluate(outside, [whole()], [approve(examples[1]!.text)], src());
    expect(refused.satisfied).toBe(false);
    expect(refused.errors).toContain(LOCATION);
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
  test('a whole-file part reaches the evaluator with keep intact and its `line N` finding is dispositioned', () => {
    // Same hermetic upstream, except that its scanner hands over a tracked Python file whole.
    const wholeUpstream = join(temp, `fake-upstream-whole-${crypto.randomUUID()}`);
    cpSync(upstream, wholeUpstream, { recursive: true });
    const f = pythonFixture(), record = join(temp, `raw-whole-${crypto.randomUUID()}.json`);
    const part = { file: f.file, text: `# existing\n${examples[2]!.text}\n${examples[1]!.text}\n`, keep: [3] };
    write(join(wholeUpstream, 'lib/pregate/checks/secrets.ts'), `export const addedLines = () => ${JSON.stringify([part])};`);
    const secrets = { id: 'secrets', status: 'fail', code: 'PREGATE_SECRETS', inputs: { added_lines: sha256(JSON.stringify([part])) },
      detail: '1 credential finding(s) in added lines (env.kv)', lines: [`MEDIUM env.kv [secret]: sensitive assignment (${f.file}, line 3)`] };
    write(record, JSON.stringify({ schema_version: 1, tree: 'a'.repeat(40), head: f.head, base: `origin/main@${f.base.slice(0, 12)}`, verdict: 'fail',
      checks: ids.map(id => id === 'secrets' ? secrets : { id, status: 'pass' }), requires_remote: [] }));
    const before = readFileSync(record, 'utf8');
    const r = run(f.repo, wholeUpstream, record), output = JSON.parse(r.stdout);
    expect(output.errors).toEqual([]);
    expect(r.status).toBe(0);
    expect(output.matched).toHaveLength(1);
    expect(output.matched[0].finding.path).toBe(f.file);
    expect(output.matched[0].finding.added_line).toBe(3);
    expect(output.receipt).toContain(`${DISPOSITIONS}#/entries/0`);
    expect(readFileSync(record, 'utf8')).toBe(before);
  });
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

test('the disposition document states both location forms, their files and the refusal', () => {
  const text = readFileSync(join(root, 'docs/secret-dispositions.md'), 'utf8').replace(/\s+/g, ' ');
  for (const phrase of ['`line N`', '`added line N`', '`added_line`', '`.py`, `.pyi`, `.dart`',
    'finding location does not match upstream added-line selection', 'cannot be satisfied by any entry', '`engine.` finding',
    'accepted location form']) expect(text).toContain(phrase);
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

// A generic tracked Python file: upstream hands the whole file to the scanner and reports `line N`.
function pythonFixture() {
  const repo = makeEmptyRepo(temp), file = 'app/settings.py';
  write(join(repo, file), `# existing\n${examples[2]!.text}\n`);
  git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'base python file');
  const base = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'update-ref', 'refs/remotes/origin/main', base);
  write(join(repo, file), `# existing\n${examples[2]!.text}\n${examples[1]!.text}\n`);
  write(join(repo, DISPOSITIONS), JSON.stringify({ version: 1, entries: [{ ...entries[1]!, path: file }] }, null, 2) + '\n');
  git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'add a line and its approval');
  return { repo, base, head: git(repo, 'rev-parse', 'HEAD'), file };
}

test.skipIf(!installed)('actual installed pregate: an added line of a tracked Python file satisfies its disposition', () => {
  const f = pythonFixture(), record = join(temp, 'installed-python-pregate.json');
  const scan = spawnSync(join(installed!, 'bin/gstack-pregate'), ['--base', 'main', '--stage', 'preflight', '--out', record],
    { cwd: f.repo, encoding: 'utf8', timeout: 120_000, env: { ...process.env, GSTACK_STATE_ROOT: join(temp, 'gstack-state') } });
  expect(scan.status).toBe(1);
  const raw = readFileSync(record, 'utf8');
  const secrets = JSON.parse(raw).checks.find((c: Check) => c.id === 'secrets');
  expect(secrets.status).toBe('fail');
  // Upstream dropped the non-added line 2 and rendered the whole-file form for line 3.
  expect(secrets.lines).toHaveLength(1);
  expect(secrets.lines[0]).toEndWith(`(${f.file}, line 3)`);
  const allowed = run(f.repo, installed!, record, 'preflight'), output = JSON.parse(allowed.stdout);
  expect(allowed.stderr).toBe('');
  expect(output.errors).toEqual([]);
  expect(allowed.status).toBe(0);
  expect(output.matched).toHaveLength(1);
  expect(output.matched[0].finding.path).toBe(f.file);
  expect(output.matched[0].finding.added_line).toBe(3);
  expect(readFileSync(record, 'utf8')).toBe(raw);
}, 180_000);

const tsReal = ['2026', '1111', '-', '1605', '31'].join('');
const tsOther = ['2026', '1111', '-', '1605', '49'].join('');
const commentNum = ['680', '683', '7577'].join('');
const tokenWithDigits = ['gh', 'p_', 'A'.repeat(30), '123', '456'].join('');
const tokenLettersOnly = ['gh', 'p_', 'B'.repeat(36)].join('');
const sampleEmail = ['reviewer', '@', 'widgets', '.', 'invalid'].join('');

describe('scan-text pure core (T1)', () => {
  test('normalization boundaries cannot join bound digits to outside numbers', () => {
    const dir = '/evidence/run-2026', prUrl = 'https://github.com/acme/widgets/pull/174';
    const unstable = [0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0xa0, 0xff15, 0x1d7d3].map(n => String.fromCodePoint(n));
    for (const point of unstable) for (const separator of ['', ' ', '.', '-']) {
      expect(knownComponents(`${dir}${separator}${point}${commentNum}`, { evidenceDirs: [dir] })).toEqual([]);
      expect(knownComponents(`${prUrl}#issuecomment-${commentNum}${separator}${point}5`, { prUrl })).toEqual([]);
    }
  });

  test('knownComponents and every branch of the after-rule', () => {
    const dir = `/home/u/.gstack/projects/acme/review-and-prep/${tsReal}`;
    const tilde = `~/.gstack/projects/acme/review-and-prep/${tsReal}`;
    const prUrl = 'https://github.com/acme/widgets/pull/174';
    const cLink = `${prUrl}#issuecomment-${commentNum}`;
    for (const s of [dir, `${dir}/full-receipt-1.md`, `${tilde}. Next`, `${dir}-note`, `${dir} ok`]) {
      expect(knownComponents(s, { evidenceDirs: [dir, tilde] })).toHaveLength(2);
    }
    expect(knownComponents(cLink, { prUrl })).toEqual([{ start: `${prUrl}#issuecomment-`.length, end: cLink.length, context: 'pr-comment' }]);
    for (const suffix of ['a', 'Z', '0', '_', ' 5', '.5', '-5']) {
      expect(isDelimitedAfter(`${dir}${suffix}`, dir.length)).toBe(false);
      expect(knownComponents(`${dir}${suffix}`, { evidenceDirs: [dir] })).toEqual([]);
      if (suffix !== '0') expect(knownComponents(`${cLink}${suffix}`, { prUrl })).toEqual([]);
    }
  });

  test('maskComponents preserves string length and every non-digit character', () => {
    const dir = `/home/u/.gstack/projects/acme/review-and-prep/${tsReal}`;
    const prUrl = 'https://github.com/acme/widgets/pull/174';
    const text = `Evidence: ${dir}/full-receipt-1.md\nReceipt: ${prUrl}#issuecomment-${commentNum}\n`;
    const comps = knownComponents(text, { evidenceDirs: [dir], prUrl });
    const masked = maskComponents(text, comps);
    expect(masked.length).toBe(text.length);
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!, inComp = ch >= '0' && ch <= '9' && comps.some(c => i >= c.start && i < c.end);
      expect(masked[i]).toBe(inComp ? 'x' : ch);
    }
  });

  test('offsetOf maps 1-based line and col across LF and CRLF text', () => {
    const lf = 'alpha\nbeta\ngamma', crlf = 'ab\r\ncd\r\nef';
    expect([offsetOf(lf, 1, 1), offsetOf(lf, 2, 1), offsetOf(lf, 2, 3), offsetOf(lf, 3, 5)]).toEqual([0, 6, 8, 15]);
    expect([offsetOf(crlf, 1, 1), offsetOf(crlf, 1, 3), offsetOf(crlf, 2, 1), offsetOf(crlf, 3, 2)]).toEqual([0, 2, 4, 9]);
    expect([offsetOf(lf, 0, 1), offsetOf(lf, 1, 0), offsetOf(lf, 4, 1), offsetOf(lf, 1, 99)]).toEqual([-1, -1, -1, -1]);
  });

  test('each eligibility condition fails on its own and decide handles multiset edge cases', () => {
    const dir = `/home/u/.gstack/projects/acme/review-and-prep/${tsReal}`, text = `Path: ${dir}`;
    const comps = knownComponents(text, { evidenceDirs: [dir] }), col = text.indexOf(tsReal) + 1;
    const valid: ScanFinding = { id: 'pii.cc', severity: 'MEDIUM', category: 'pii', line: 1, col, preview: `${tsReal.slice(0, 4)}********…` };
    expect(eligibleComponent(text, comps, valid)?.context).toBe('evidence-dir');
    for (const bad of [{ id: 'pii.email' }, { severity: 'HIGH' }, { category: 'secret' }, { col: 1 }, { preview: '9999********' }]) {
      expect(eligibleComponent(text, comps, { ...valid, ...bad })).toBeUndefined();
    }
    expect(decide(text, comps, { findings: [valid], oversize: true }, { findings: [] }).status).toBe('none');
    expect(decide(text, comps, { findings: [valid] }, { findings: [valid] }).status).toBe('none');
    const other: ScanFinding = { id: 'pii.email', severity: 'MEDIUM', category: 'pii', line: 1, col: 1, preview: 'revi****' };
    expect(decide(text, comps, { findings: [valid, other] }, { findings: [] }).status).toBe('inconclusive');
    expect([exitFor([{ severity: 'HIGH' }]), exitFor([{ severity: 'MEDIUM' }]), exitFor([{ severity: 'WARN' }])]).toEqual([3, 2, 0]);
    expect(countsFor([{ severity: 'HIGH' }, { severity: 'MEDIUM' }, { severity: 'LOW' }, { severity: 'WARN' }])).toEqual({ HIGH: 1, MEDIUM: 1, LOW: 1, WARN: 1 });
  });
});

describe('scan-text CLI with hermetic upstream double (T2 & T3)', () => {
  const fakeUpstream = join(temp, 'fake-redact-upstream'), fakeBin = join(fakeUpstream, 'bin/gstack-redact');
  write(fakeBin, `#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const stateFile = process.env.FAKE_REDACT_STATE_FILE, mode = process.env.FAKE_REDACT_MODE || '';
const call = stateFile ? (existsSync(stateFile) ? Number(readFileSync(stateFile, 'utf8')) + 1 : 1) : 1;
if (stateFile) writeFileSync(stateFile, String(call));
if ((mode === 'fail-first' && call === 1) || (mode === 'fail-second' && call === 2)) process.exit(1);
if ((mode === 'bad-json-first' && call === 1) || (mode === 'bad-json-second' && call === 2)) { console.log('not-json'); process.exit(0); }
const text = readFileSync(process.argv[process.argv.indexOf('--from-file') + 1], 'utf8');
const starts = [0]; for (let i = 0; i < text.length; i++) if (text[i] === '\\n') starts.push(i + 1);
const lineCol = (at) => {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= at) lo = mid; else hi = mid - 1; }
  return { line: lo + 1, col: at - starts[lo] + 1 };
};
const luhn = (s) => {
  const d = s.replace(/\\D/g, ''); if (d.length < 13 || d.length > 19) return false;
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) { let n = d.charCodeAt(i) - 48; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; }
  return sum % 10 === 0;
};
const findings = [], add = (id, severity, category, offset, span) => findings.push({
  id, tier: severity, severity, category, description: id, ...lineCol(offset),
  preview: span.slice(0, 4) + '*'.repeat(Math.min(Math.max(0, span.length - 4), 8)) + (span.length > 12 ? '…' : ''),
  autoRedactable: category === 'pii', repoVisibility: 'unknown',
});
for (const m of text.matchAll(/(?<![0-9A-Za-z_])[0-9](?:[ -]?[0-9]){12,18}(?![0-9A-Za-z_])/g)) if (luhn(m[0])) add('pii.cc', 'MEDIUM', 'pii', m.index, m[0]);
for (const m of text.matchAll(/(?<![\\w.])[0-9]{10,15}(?![\\w.])/g)) add('pii.phone.e164', 'MEDIUM', 'pii', m.index, m[0]);
for (const m of text.matchAll(new RegExp(['gh', 'p_[A-Za-z0-9]{36}'].join(''), 'g'))) add('github.pat', 'HIGH', 'secret', m.index, m[0]);
for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/g)) add('pii.email', 'MEDIUM', 'pii', m.index, m[0]);
if (mode === 'add-finding-second' && call === 2) add('pii.email', 'MEDIUM', 'pii', 0, 'added@widgets.invalid');
if (mode === 'unknown-severity') add('engine.future', 'CRITICAL', 'secret', 0, 'future');
findings.sort((a, b) => a.line - b.line || a.col - b.col || a.id.localeCompare(b.id));
const counts = { HIGH: 0, MEDIUM: 0, LOW: 0, WARN: 0 }; for (const f of findings) counts[f.severity === 'CRITICAL' ? 'HIGH' : f.severity] += 1;
if (mode === 'inconsistent-counts') counts.HIGH += 1;
console.log(JSON.stringify({ findings, counts, repoVisibility: 'unknown', oversize: false }, null, 2));
process.exitCode = counts.HIGH > 0 ? 3 : counts.MEDIUM > 0 ? 2 : 0;
if (mode === 'wrong-exit-second' && call === 2) process.exitCode = 3;
`);
  chmodSync(fakeBin, 0o755);

  function runScanText(repo: string, homeDir: string, args: string[], extra: Record<string, string> = {}) {
    const env: Record<string, string | undefined> = { ...process.env, HOME: homeDir, ...extra };
    delete env.GSTACK_STATE_ROOT; delete env.GSTACK_HOME;
    return spawnSync(join(root, 'bin/secret-dispositions'), ['scan-text', ...args], { cwd: repo, encoding: 'utf8', timeout: 60_000, env });
  }

  test('(a) the two real shapes are marked known_safe with exit 0', () => {
    const repo = makeEmptyRepo(temp), homeDir = mkdtempSync(join(temp, 'home-a-'));
    const evDir = join(homeDir, '.gstack/projects/acme/review-and-prep', tsReal), tildeDir = `~/.gstack/projects/acme/review-and-prep/${tsReal}`;
    mkdirSync(evDir, { recursive: true });
    const prUrl = 'https://github.com/acme/widgets/pull/174', bodyFile = join(temp, `body-a-${crypto.randomUUID()}.md`);
    writeFileSync(bodyFile, `Evidence: ${evDir} and ${tildeDir}\nFull receipt: ${tildeDir}/full-receipt-1.md (${evDir}/full-receipt-1.md)\nReceipt: ${prUrl}#issuecomment-${commentNum}`);
    const r = runScanText(repo, homeDir, ['--gstack-root', fakeUpstream, '--from-file', bodyFile, '--evidence-dir', evDir, '--pr-url', prUrl]);
    const out = JSON.parse(r.stdout);
    expect([r.status, out.version, out.status, out.upstream_exit, out.findings.length]).toEqual([0, 1, 'applied', 2, 0]);
    expect(out.counts).toEqual({ HIGH: 0, MEDIUM: 0, LOW: 0, WARN: 0 });
    expect(out.known_safe.map((k: { id: string; context: string }) => [k.id, k.context])).toEqual([
      ['pii.cc', 'evidence-dir'], ['pii.cc', 'evidence-dir'], ['pii.cc', 'evidence-dir'], ['pii.cc', 'evidence-dir'], ['pii.phone.e164', 'pr-comment'],
    ]);
  });

  test('(b) similar numbers outside the bound contexts still flag with exit 2', () => {
    const repo = makeEmptyRepo(temp), homeDir = mkdtempSync(join(temp, 'home-b-'));
    const evDir = join(homeDir, '.gstack/projects/acme/review-and-prep', tsReal), otherDir = join(homeDir, '.gstack/projects/acme/review-and-prep', tsOther);
    mkdirSync(evDir, { recursive: true }); mkdirSync(otherDir, { recursive: true });
    const prUrl = 'https://github.com/acme/widgets/pull/174', otherPr = 'https://github.com/acme/widgets/pull/175';
    for (const line of [`Bare: ${tsReal}`, `Bare: ${commentNum}`, `Other ts: ${tsOther}`, `${otherPr}#issuecomment-${commentNum}`, `${otherDir}/full-receipt-1.md`]) {
      const file = join(temp, `body-b-${crypto.randomUUID()}.md`); writeFileSync(file, line);
      const r = runScanText(repo, homeDir, ['--gstack-root', fakeUpstream, '--from-file', file, '--evidence-dir', evDir, '--pr-url', prUrl]);
      const out = JSON.parse(r.stdout);
      expect([r.status, out.findings.length > 0, out.known_safe.length]).toEqual([2, true, 0]);
    }
  });

  test('(c) a secret inside the evidence path still flags with exit 3 and never enters known_safe', () => {
    const repo = makeEmptyRepo(temp), homeDir = mkdtempSync(join(temp, 'home-c-'));
    for (const tok of [tokenWithDigits, tokenLettersOnly]) {
      const evDir = join(homeDir, 'scratch/review-and-prep', `run-${tsReal}-${tok}`), file = join(temp, `body-c-${crypto.randomUUID()}.md`);
      mkdirSync(evDir, { recursive: true }); writeFileSync(file, `Evidence: ${evDir}/full-receipt-1.md\n`);
      const r = runScanText(repo, homeDir, ['--gstack-root', fakeUpstream, '--from-file', file, '--evidence-dir', evDir]), out = JSON.parse(r.stdout);
      expect(r.status).toBe(3);
      expect(out.findings.some((f: ScanFinding) => f.id === 'github.pat' && f.severity === 'HIGH')).toBe(true);
      expect(out.known_safe.some((k: { id: string }) => k.id === 'github.pat')).toBe(false);
    }
  });

  test('(d) other findings match direct upstream output and no-context call returns status none', () => {
    const repo = makeEmptyRepo(temp), homeDir = mkdtempSync(join(temp, 'home-d-'));
    const evDir = join(homeDir, '.gstack/projects/acme/review-and-prep', tsReal), file = join(temp, `body-d-${crypto.randomUUID()}.md`);
    mkdirSync(evDir, { recursive: true }); writeFileSync(file, `Contact: ${sampleEmail}\nToken: ${tokenLettersOnly}\nEvidence: ${evDir}\n`);
    const direct = JSON.parse(spawnSync(fakeBin, ['--from-file', file, '--json'], { encoding: 'utf8' }).stdout);
    const withCtx = runScanText(repo, homeDir, ['--gstack-root', fakeUpstream, '--from-file', file, '--evidence-dir', evDir]), outCtx = JSON.parse(withCtx.stdout);
    expect([withCtx.status, outCtx.status]).toEqual([3, 'applied']);
    expect(outCtx.findings).toEqual(direct.findings.filter((f: ScanFinding) => f.id !== 'pii.cc'));
    const noCtx = runScanText(repo, homeDir, ['--gstack-root', fakeUpstream, '--from-file', file]), outNone = JSON.parse(noCtx.stdout);
    expect([noCtx.status, outNone.status, outNone.known_safe.length]).toEqual([3, 'none', 0]);
    expect(outNone.findings).toEqual(direct.findings);
  });

  test('(e) fail closed when first or second scan fails or adds a finding', () => {
    const repo = makeEmptyRepo(temp), homeDir = mkdtempSync(join(temp, 'home-e-'));
    const evDir = join(homeDir, '.gstack/projects/acme/review-and-prep', tsReal), file = join(temp, `body-e-${crypto.randomUUID()}.md`);
    mkdirSync(evDir, { recursive: true }); writeFileSync(file, `Evidence: ${evDir}\n`);
    const first = JSON.parse(spawnSync(fakeBin, ['--from-file', file, '--json'], { encoding: 'utf8' }).stdout);
    for (const mode of ['add-finding-second', 'fail-second', 'bad-json-second', 'wrong-exit-second']) {
      const r = runScanText(repo, homeDir, ['--gstack-root', fakeUpstream, '--from-file', file, '--evidence-dir', evDir],
        { FAKE_REDACT_STATE_FILE: join(temp, `state-${crypto.randomUUID()}`), FAKE_REDACT_MODE: mode });
      const out = JSON.parse(r.stdout);
      expect([r.status, out.upstream_exit, out.status, out.findings.length, out.known_safe.length]).toEqual([2, 2, 'inconclusive', 1, 0]);
      expect(out.findings).toEqual(first.findings);
    }
    for (const mode of ['fail-first', 'bad-json-first', 'unknown-severity', 'inconsistent-counts']) {
      const r = runScanText(repo, homeDir, ['--gstack-root', fakeUpstream, '--from-file', file, '--evidence-dir', evDir],
        { FAKE_REDACT_STATE_FILE: join(temp, `state-${crypto.randomUUID()}`), FAKE_REDACT_MODE: mode });
      expect([r.status, JSON.parse(r.stdout).version, typeof JSON.parse(r.stdout).error]).toEqual([1, 1, 'string']);
    }
  });

  test('relative state roots fall through to the next absolute root', () => {
    const repo = makeEmptyRepo(temp), homeDir = mkdtempSync(join(temp, 'home-relative-')), alternate = join(homeDir, 'alternate');
    const file = join(temp, `relative-${crypto.randomUUID()}.md`);
    for (const stateHome of ['', 'relative', alternate]) {
      const evDir = join(stateHome === alternate ? alternate : join(homeDir, '.gstack'), 'projects/acme/review-and-prep', tsReal);
      mkdirSync(evDir, { recursive: true }); writeFileSync(file, `Evidence: ${evDir}\n`);
      const env = { ...process.env, HOME: homeDir, GSTACK_STATE_ROOT: 'relative', GSTACK_HOME: stateHome };
      const r = spawnSync(join(root, 'bin/secret-dispositions'), ['scan-text', '--gstack-root', fakeUpstream, '--from-file', file, '--evidence-dir', evDir], { cwd: repo, encoding: 'utf8', timeout: 60_000, env });
      expect([r.status, JSON.parse(r.stdout).status]).toEqual([0, 'applied']);
    }
  });

  test('scanner bin-directory aliases into the project are rejected', () => {
    const repo = makeEmptyRepo(temp), homeDir = mkdtempSync(join(temp, 'home-scanner-alias-'));
    const inProject = join(repo, 'scanner'), aliasRoot = mkdtempSync(join(temp, 'scanner-alias-')), file = join(temp, `alias-${crypto.randomUUID()}.md`);
    cpSync(fakeUpstream, inProject, { recursive: true }); symlinkSync(join(inProject, 'bin'), join(aliasRoot, 'bin')); writeFileSync(file, 'Synthetic input\n');
    expect(runScanText(repo, homeDir, ['--gstack-root', aliasRoot, '--from-file', file]).status).toBe(1);
  });

  test('canonical evidence paths and aliases retain tilde spelling when HOME is a symlink', () => {
    const repo = makeEmptyRepo(temp), homeDir = mkdtempSync(join(temp, 'home-canonical-')), alias = `${homeDir}-alias`;
    const evDir = join(homeDir, '.gstack/projects/acme/review-and-prep', tsReal), file = join(temp, `home-alias-${crypto.randomUUID()}.md`);
    const secondAlias = `${homeDir}-second-alias`;
    mkdirSync(evDir, { recursive: true }); symlinkSync(homeDir, alias); symlinkSync(homeDir, secondAlias);
    writeFileSync(file, `Evidence: ~/.gstack/projects/acme/review-and-prep/${tsReal}\nCanonical: ${evDir}\n`);
    for (const dir of [evDir, join(secondAlias, '.gstack/projects/acme/review-and-prep', tsReal)]) {
      const r = runScanText(repo, alias, ['--gstack-root', fakeUpstream, '--from-file', file, '--evidence-dir', dir]);
      expect([r.status, JSON.parse(r.stdout).status]).toEqual([0, 'applied']);
    }
  });

  test('(f) validation rejects invalid evidence dirs, PR URLs, flags and in-project gstack-root with exit 1', () => {
    const repo = makeEmptyRepo(temp), homeDir = mkdtempSync(join(temp, 'home-f-'));
    const validEv = join(homeDir, '.gstack/projects/acme/review-and-prep', tsReal), outsideEv = join(homeDir, 'other/review-and-prep', tsReal);
    const linkedEv = join(homeDir, '.gstack/projects/acme/review-and-prep/linked'), file = join(temp, `body-f-${crypto.randomUUID()}.md`);
    mkdirSync(validEv, { recursive: true }); mkdirSync(outsideEv, { recursive: true }); symlinkSync(validEv, linkedEv); writeFileSync(file, `Evidence: ${validEv}\n`);
    for (const badDir of [outsideEv, join(homeDir, '.gstack/projects/acme/review-and-prep'), join(homeDir, 'scratch/review-and-prep'), 'relative/dir', linkedEv, `${validEv}-missing`, `${validEv}/`, `${validEv}/../${tsReal}`]) {
      expect(runScanText(repo, homeDir, ['--gstack-root', fakeUpstream, '--from-file', file, '--evidence-dir', badDir]).status).toBe(1);
    }
    for (const badUrl of ['https://user:pass@github.com/acme/widgets/pull/174', 'https://gitlab.com/acme/widgets/pull/174', 'https://github.com/acme/widgets/pull/174/files']) {
      expect(runScanText(repo, homeDir, ['--gstack-root', fakeUpstream, '--from-file', file, '--pr-url', badUrl]).status).toBe(1);
    }
    for (const argv of [['--gstack-root', fakeUpstream, '--from-file', file, '--unknown', '1'], ['--gstack-root', fakeUpstream, '--from-file', file, '--from-file', file], ['--gstack-root', fakeUpstream, '--from-file'], ['--gstack-root', fakeUpstream, '--from-file', '--pr-url']]) {
      expect(runScanText(repo, homeDir, argv).status).toBe(1);
    }
    const inProjRoot = join(repo, 'untrusted-gstack'); cpSync(fakeUpstream, inProjRoot, { recursive: true });
    const inProj = runScanText(repo, homeDir, ['--gstack-root', inProjRoot, '--from-file', file]);
    expect([inProj.status, JSON.parse(inProj.stdout).error]).toEqual([1, 'gstack root must be a trusted installation outside the project']);
  });

  test('(g) leaves no .scan-text-* directory behind and never mutates input or dispositions', () => {
    const repo = makeEmptyRepo(temp), homeDir = mkdtempSync(join(temp, 'home-g-')), workDir = mkdtempSync(join(temp, 'work-g-'));
    const evDir = join(homeDir, '.gstack/projects/acme/review-and-prep', tsReal), file = join(workDir, 'body.md'), original = `Evidence: ${evDir}/full-receipt-1.md\n`;
    mkdirSync(evDir, { recursive: true }); writeFileSync(file, original);
    expect(runScanText(repo, homeDir, ['--gstack-root', fakeUpstream, '--from-file', file, '--evidence-dir', evDir]).status).toBe(0);
    expect([readdirSync(workDir), readFileSync(file, 'utf8')]).toEqual([['body.md'], original]);
    const failSec = runScanText(repo, homeDir, ['--gstack-root', fakeUpstream, '--from-file', file, '--evidence-dir', evDir],
      { FAKE_REDACT_STATE_FILE: join(temp, `state-g-${crypto.randomUUID()}`), FAKE_REDACT_MODE: 'fail-second' });
    expect([failSec.status, readdirSync(workDir), readFileSync(file, 'utf8')]).toEqual([2, ['body.md'], original]);
    expect(() => readFileSync(join(repo, DISPOSITIONS))).toThrow();
  });
});

test.skipIf(!installed)('(h) actual installed gstack-redact: flags real shapes directly, scan-text clears only bound contexts', () => {
  const repo = makeEmptyRepo(temp), homeDir = mkdtempSync(join(temp, 'home-h-'));
  const evDir = join(homeDir, '.gstack/projects/acme/review-and-prep', tsReal), tildeDir = `~/.gstack/projects/acme/review-and-prep/${tsReal}`;
  mkdirSync(evDir, { recursive: true });
  const prUrl = 'https://github.com/acme/widgets/pull/174', bodyFile = join(temp, `body-h-${crypto.randomUUID()}.md`);
  writeFileSync(bodyFile, `Evidence: ${evDir} and ${tildeDir}/full-receipt-1.md\nReceipt: ${prUrl}#issuecomment-${commentNum}\n`);
  const env: Record<string, string | undefined> = { ...process.env, HOME: homeDir }; delete env.GSTACK_STATE_ROOT; delete env.GSTACK_HOME;
  expect(spawnSync(join(installed!, 'bin/gstack-redact'), ['--from-file', bodyFile, '--json'], { cwd: repo, encoding: 'utf8', timeout: 60_000, env }).status).toBe(2);
  const wrapped = spawnSync(join(root, 'bin/secret-dispositions'), ['scan-text', '--gstack-root', installed!, '--from-file', bodyFile, '--evidence-dir', evDir, '--pr-url', prUrl], { cwd: repo, encoding: 'utf8', timeout: 60_000, env });
  const out = JSON.parse(wrapped.stdout);
  expect([wrapped.status, out.status, out.findings.length]).toEqual([0, 'applied', 0]);
  expect(out.known_safe.map((k: { id: string; context: string }) => [k.id, k.context])).toEqual([['pii.cc', 'evidence-dir'], ['pii.cc', 'evidence-dir'], ['pii.phone.e164', 'pr-comment']]);
  const outsideFile = join(temp, `outside-h-${crypto.randomUUID()}.md`); writeFileSync(outsideFile, `Unbound: ${tsReal} and ${commentNum}\n`);
  const outside = spawnSync(join(root, 'bin/secret-dispositions'), ['scan-text', '--gstack-root', installed!, '--from-file', outsideFile, '--evidence-dir', evDir, '--pr-url', prUrl], { cwd: repo, encoding: 'utf8', timeout: 60_000, env });
  expect([outside.status, JSON.parse(outside.stdout).findings.length >= 2]).toEqual([2, true]);
  const secretEv = join(homeDir, 'scratch/review-and-prep', `run-${tsReal}-${tokenWithDigits}`), secretFile = join(temp, `secret-h-${crypto.randomUUID()}.md`);
  mkdirSync(secretEv, { recursive: true }); writeFileSync(secretFile, `Evidence: ${secretEv}/full-receipt-1.md\n`);
  expect(spawnSync(join(root, 'bin/secret-dispositions'), ['scan-text', '--gstack-root', installed!, '--from-file', secretFile, '--evidence-dir', secretEv], { cwd: repo, encoding: 'utf8', timeout: 60_000, env }).status).toBe(3);
  const boundaryEv = join(homeDir, '.gstack/projects/acme/review-and-prep/run-2026'); mkdirSync(boundaryEv, { recursive: true });
  for (const boundary of [String.fromCodePoint(0x200b), '', ' ']) {
    const phone = ['555', '012', '3456'].join(''), tail = boundary ? `${boundary}${phone}` : phone.replace(/\d/g, d => String.fromCodePoint(0xff10 + Number(d)));
    writeFileSync(bodyFile, `Evidence: ${boundaryEv}${tail}\n`);
    const direct = spawnSync(join(installed!, 'bin/gstack-redact'), ['--from-file', bodyFile, '--json'], { cwd: repo, encoding: 'utf8', timeout: 60_000, env });
    const safe = spawnSync(join(root, 'bin/secret-dispositions'), ['scan-text', '--gstack-root', installed!, '--from-file', bodyFile, '--evidence-dir', boundaryEv], { cwd: repo, encoding: 'utf8', timeout: 60_000, env });
    expect([direct.status, safe.status, JSON.parse(safe.stdout).known_safe]).toEqual([2, 2, []]);
    expect(JSON.parse(safe.stdout).findings).toEqual(JSON.parse(direct.stdout).findings);
  }
}, 180_000);
