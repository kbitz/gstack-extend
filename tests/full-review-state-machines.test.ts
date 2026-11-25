import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { routeSourceTag, validateTagExpression } from '../src/audit/lib/source-tag.ts';
import { main } from '../src/full-review/state-machines-cli.ts';
import { cleanGitEnv, type ScanResult } from '../src/full-review/state-machines.ts';

const REPO_ROOT = resolve(import.meta.dir, '..');
const BIN = join(REPO_ROOT, 'bin/full-review-state-machines');
const FIXTURES_ROOT = join(REPO_ROOT, 'tests/fixtures/full-review-state-machines');
const BASE_TMP = mkdtempSync(join(tmpdir(), 'fr-state-machines-test-'));

afterAll(() => {
  rmSync(BASE_TMP, { recursive: true, force: true });
});

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  const visit = (cur: string) => {
    for (const entry of readdirSync(cur, { withFileTypes: true })) {
      const abs = join(cur, entry.name);
      if (entry.isDirectory()) visit(abs);
      else out.push(abs);
    }
  };
  visit(dir);
  return out.sort();
}

function materializeFixture(name: string, options: { initGit?: boolean } = {}): string {
  const srcRoot = join(FIXTURES_ROOT, name);
  const destRoot = mkdtempSync(join(BASE_TMP, `${name}-`));
  for (const abs of walkFiles(srcRoot)) {
    const relTxt = relative(srcRoot, abs);
    const rel = relTxt.endsWith('.txt') ? relTxt.slice(0, -4) : relTxt;
    const target = join(destRoot, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(abs, 'utf8'));
  }
  if (options.initGit) {
    const init = spawnSync('git', ['init', '--quiet', destRoot], { encoding: 'utf8', timeout: 15_000, env: cleanGitEnv() });
    expect(init.status).toBe(0);
  }
  return destRoot;
}

function runMain(argv: string[], cwd: string = BASE_TMP): { status: number; stdout: string; stderr: string } {
  let stdout = '';
  let stderr = '';
  const status = main(argv, {
    cwd,
    stdout: chunk => {
      stdout += chunk;
    },
    stderr: chunk => {
      stderr += chunk;
    },
  });
  return { status, stdout, stderr };
}

function runSubprocess(argv: string[], cwd: string = BASE_TMP): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync('/bin/sh', [BIN, ...argv], { cwd, encoding: 'utf8', timeout: 15_000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function assertMechanicsOnly(result: ScanResult): void {
  const forbiddenKeys = new Set(['severity', 'verdict', 'classification', 'recommendation']);
  for (const candidate of result.candidates) {
    for (const key of Object.keys(candidate)) {
      expect(forbiddenKeys.has(key)).toBe(false);
    }
    for (const key of Object.keys(candidate.facts)) {
      expect(forbiddenKeys.has(key)).toBe(false);
    }
    expect(candidate.sites.length).toBeGreaterThan(0);
    for (const site of candidate.sites) {
      expect(site.line).toBeGreaterThan(0);
      expect(site.file.length).toBeGreaterThan(0);
    }
  }
}

describe('bin/full-review-state-machines mechanical pre-scanner', () => {
  // Value: protects=all six intra-language mechanical signals fire on seeded Python implicit state machines with accurate sites and zero verdict fields; fails_when=any signal regresses or emits non-mechanical judgments; why_new=Track 100A T3; seam=none
  test('surfaces S1-S6 on seeded Python implicit-state-machine fixture with mechanics-only output', () => {
    const dir = materializeFixture('implicit-sm-py', { initGit: true });
    const res = runSubprocess(['--format', 'json', dir]);
    expect(res.status).toBe(0);
    expect(res.stderr).toBe('');
    const parsed = JSON.parse(res.stdout) as ScanResult;
    expect(parsed.schema).toBe('full-review-state-machines/v1');
    expect(parsed.discovery).toBe('git');
    expect(parsed.scanned_by_language).toEqual({ python: 2, ts_js: 0 });
    expect(parsed.skipped_files).toBe(0);
    assertMechanicsOnly(parsed);

    const signals = new Set(parsed.candidates.map(c => c.signal));
    expect(signals).toEqual(
      new Set([
        'string-state-fanout',
        'boolean-state-bag',
        'mutation-fanout',
        'write-decode-gap',
        'cross-file-inferred-state',
        'counter-thresholds',
      ]),
    );

    const bag = parsed.candidates.find(c => c.signal === 'boolean-state-bag')!;
    expect(bag.subject).toBe('OrderRecord');
    expect(bag.facts.fields).toEqual(['in_flight', 'pending_retry', 'settled_at']);

    const gap = parsed.candidates.find(c => c.signal === 'write-decode-gap')!;
    expect(gap.subject).toBe('lease_token');
    expect(gap.sites).toEqual([{ file: 'workflow.py', line: 42, function: 'save_order' }]);

    const crossFile = parsed.candidates.find(c => c.signal === 'cross-file-inferred-state')!;
    expect(crossFile.facts.function).toBe('infer_order_phase');
    expect(crossFile.facts.state_files).toEqual([
      'order_checkpoint.json',
      'order_done.marker',
      'order_lock.flag',
    ]);
  });

  // Value: protects=all six intra-language mechanical signals fire on seeded TS/JS implicit state machines; fails_when=TS/JS lexical parsing misses any signal; why_new=Track 100A T3; seam=none
  test('surfaces S1-S6 on seeded TypeScript implicit-state-machine fixture', () => {
    const dir = materializeFixture('implicit-sm-ts');
    const res = runMain(['--format', 'json', dir]);
    expect(res.status).toBe(0);
    expect(res.stderr).toBe('');
    const parsed = JSON.parse(res.stdout) as ScanResult;
    expect(parsed.discovery).toBe('walk');
    expect(parsed.scanned_by_language).toEqual({ python: 0, ts_js: 2 });
    assertMechanicsOnly(parsed);

    const signals = new Set(parsed.candidates.map(c => c.signal));
    expect(signals).toEqual(
      new Set([
        'string-state-fanout',
        'boolean-state-bag',
        'mutation-fanout',
        'write-decode-gap',
        'cross-file-inferred-state',
        'counter-thresholds',
      ]),
    );

    const bag = parsed.candidates.find(c => c.signal === 'boolean-state-bag')!;
    expect(bag.subject).toBe('JobRecord');
    expect(bag.facts.fields).toEqual(['inFlight', 'awaitingAck', 'settledAt']);

    const gap = parsed.candidates.find(c => c.signal === 'write-decode-gap')!;
    expect(gap.subject).toBe('leaseToken');
    expect(gap.sites).toEqual([{ file: 'workflow.ts', line: 40, function: 'saveJob' }]);
  });

  // Value: protects=cross-language vocabulary drift flags overlapping Python and TS vocabularies without a parity test and stays quiet when a parity test exists; fails_when=S7 misses asymmetric tokens or ignores parity tests; why_new=Track 100A T3; seam=none
  test('surfaces S7 on cross-language vocabulary drift and suppresses it when a parity test exists', () => {
    const driftDir = materializeFixture('cross-lang-drift');
    const driftRes = runMain(['--format', 'json', driftDir]);
    expect(driftRes.status).toBe(0);
    const driftParsed = JSON.parse(driftRes.stdout) as ScanResult;
    assertMechanicsOnly(driftParsed);
    const drift = driftParsed.candidates.find(c => c.signal === 'cross-language-enum-drift');
    expect(drift).toBeDefined();
    expect(drift!.facts.shared_tokens).toEqual(['completed', 'pending', 'running']);
    expect(drift!.facts.python_only).toEqual(['paused']);
    expect(drift!.facts.ts_js_only).toEqual(['cancelled']);

    mkdirSync(join(driftDir, 'tests'));
    writeFileSync(join(driftDir, 'tests/test_status.py'), [
      '# session_status.py and session-status.ts',
      'from session_status import SessionStatus',
      'assert SessionStatus.PENDING == "pending"',
    ].join('\n'));
    const stillDrifts = JSON.parse(runMain(['--format', 'json', driftDir]).stdout) as ScanResult;
    expect(stillDrifts.candidates.some(c => c.signal === 'cross-language-enum-drift')).toBe(true);

    const parityDir = materializeFixture('cross-lang-parity');
    const parityRes = runMain(['--format', 'json', parityDir]);
    expect(parityRes.status).toBe(0);
    const parityParsed = JSON.parse(parityRes.stdout) as ScanResult;
    expect(parityParsed.candidates.filter(c => c.signal === 'cross-language-enum-drift')).toEqual([]);
  });

  // Value: protects=the plain-check fixture surfaces only write-decode-gap without false positives on fan-out or boolean bags; fails_when=the scanner conflates a single unchecked persisted key with a full implicit state machine; why_new=Track 100A T3; seam=none
  test('plain-check fixture surfaces only write-decode-gap', () => {
    const dir = materializeFixture('plain-check');
    const res = runMain(['--format', 'json', dir]);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout) as ScanResult;
    assertMechanicsOnly(parsed);

    const signals = new Set(parsed.candidates.map(c => c.signal));
    expect(signals).toEqual(new Set(['write-decode-gap']));
    expect(parsed.candidates.map(c => [c.subject, c.sites[0]?.file, c.sites[0]?.function])).toEqual([
      ['formatVersion', 'store.ts', 'saveConfig'],
      ['schema_version', 'store.py', 'save_session'],
    ]);
  });

  // Value: protects=record identity and evidence sites; fails_when=unrelated source suppresses or manufactures candidates; why_new=cycle 1 regressions
  test('associates typed fields, persisted keys and file probes with their own code', () => {
    const dir = mkdtempSync(join(BASE_TMP, 'associated-'));
    writeFileSync(join(dir, 'order.py'), [
      'from typing import Literal',
      'OtherStatus = Literal["pending", "done", "waiting"]',
      'def load_order(data):',
      '    return data["status"]',
      'def save_order(path, order):',
      '    path.write_text(json.dumps({"status": order.status, "revision": order.revision}))',
    ].join('\n'));
    writeFileSync(join(dir, 'job.js'), [
      'const job = { inFlight: false, pendingRetry: false, settledAt: null };',
      'function isPending(job) { return job.status === "pending"; }',
      'function isDone(job) { return job.status === "done"; }',
      'function isWaiting(job) { return job.status === "waiting"; }',
      'function loadAudit(data) { return data.revision; }',
      'function saveJob(path, job) {',
      '  writeFileSync(path, JSON.stringify({ status: job.status, revision: 2 }));',
      '}',
      'function loadJob(data) { return data.status; }',
      'function unrelated(ready) {',
      '  const unused = ["job_state.json", "job_done.flag", "job_checkpoint.json"];',
      '  if (ready && existsSync("settings.json")) return "ready";',
      '}',
    ].join('\n'));
    const result = runMain(['--format', 'json', dir]);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as ScanResult;
    expect(report.candidates.map(c => c.signal)).not.toContain('cross-file-inferred-state');
    expect(report.candidates.find(c => c.signal === 'string-state-fanout')?.sites.map(s => s.line)).toEqual([2, 3, 4]);
    expect(report.candidates.find(c => c.signal === 'boolean-state-bag')?.facts.fields)
      .toEqual(['inFlight', 'pendingRetry', 'settledAt']);
    expect(report.candidates.filter(c => c.signal === 'write-decode-gap').map(c => c.sites[0]))
      .toEqual([
        { file: 'job.js', line: 7, function: 'saveJob' },
        { file: 'order.py', line: 6, function: 'save_order' },
      ]);
  });

  // Value: protects=signal diversity at the cap; fails_when=one kind consumes all candidate slots; why_new=cycle 1 regression
  test('keeps distinct signals when a noisy signal exceeds the candidate limit', () => {
    const dir = materializeFixture('implicit-sm-ts');
    const records = Array.from({ length: 8 }, (_, i) =>
      'const job' + i + ' = { inFlight: false, pendingRetry: false, settledAt: null };');
    writeFileSync(join(dir, 'later.ts'), records.join('\n'));
    const capped = runMain(['--format', 'json', '--max-candidates', '6', dir]);
    expect(capped.status).toBe(0);
    const report = JSON.parse(capped.stdout) as ScanResult;
    expect(report.truncated).toBe(true);
    expect(report.candidates.length).toBe(6);
    expect(new Set(report.candidates.map(c => c.signal)).size).toBe(6);
  });

  // Value: protects=typed imported record members and persisted payload correlation; fails_when=ordinary annotations or options become false candidates; why_new=cycle 2 regressions
  test('uses imported record types and reads loader bodies after object return annotations', () => {
    const dir = mkdtempSync(join(BASE_TMP, 'typed-callers-'));
    writeFileSync(join(dir, 'model.ts'), [
      'export type JobStatus = "pending" | "running" | "done";',
      'export interface Job { status: JobStatus; }',
    ].join('\n'));
    writeFileSync(join(dir, 'job.ts'), [
      'import {',
      '  Job,',
      '} from "./model";',
      'function pending(job: Job) { return job.status === "pending"; }',
      'function running(job: Job) { return job.status === "running"; }',
      'function done(job: Job) { return job.status === "done"; }',
      'function saveJob(path, job) {',
      '  writeFileSync(path, JSON.stringify({ id: job.id, revision: 2 }), { encoding: "utf8" });',
      '}',
      'function loadJob(data): { id: string } {',
      '  if (!Number.isInteger(data.revision)) throw Error("bad revision");',
      '  return { id: data.id };',
      '}',
    ].join('\n'));
    const result = runMain(['--format', 'json', dir]);
    expect(result.status).toBe(0);
    expect((JSON.parse(result.stdout) as ScanResult).candidates).toEqual([]);
  });

  // Value: protects=Git scans tracked sources under build and lexical strings cannot hide subsequent fields; fails_when=walk exclusions or string braces affect legitimate Git fixtures; why_new=cycle 2 regressions
  test('scans tracked Git build tooling with strings and nested templates before declarations', () => {
    const dir = materializeFixture('clean-and-other-langs', { initGit: true });
    mkdirSync(join(dir, 'build'));
    const tick = String.fromCharCode(96);
    writeFileSync(join(dir, 'build/jobs.ts'), [
      'const label = ' + tick + 'outer ' + '$' + '{' + tick + 'inner' + tick + '}' + tick + ';',
      'class Job {',
      '  label = "}";',
      '  inFlight: boolean = false;',
      '  pendingRetry: boolean = false;',
      '  settledAt: string | null = null;',
      '}',
    ].join('\n'));
    const add = spawnSync('git', ['-C', dir, 'add', '-f', 'build/jobs.ts'], { env: cleanGitEnv(), timeout: 15_000 });
    expect(add.status).toBe(0);
    const result = runMain(['--format', 'json', dir]);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as ScanResult;
    expect(report.candidates.find(c => c.signal === 'boolean-state-bag')?.sites.map(s => s.line)).toEqual([4, 5, 6]);
  });

  // Value: protects=branch operands and unique threshold sites; fails_when=unused file probes or one compound condition look like lifecycle fan-out; why_new=cycle 2 regressions
  test('counts threshold branches and file operands rather than unrelated code', () => {
    const dir = mkdtempSync(join(BASE_TMP, 'probe-branches-'));
    const file = join(dir, 'job.ts');
    writeFileSync(file, [
      'function choose(ready, attempts) {',
      '  if (ready && attempts > 2.5 && attempts < 4) console.log("ready");',
      '  existsSync("job_state.json");',
      '  existsSync("job_done.flag");',
      '  existsSync("job_checkpoint.json");',
      '}',
    ].join('\n'));
    const result = runMain(['--format', 'json', dir]);
    expect(result.status).toBe(0);
    expect((JSON.parse(result.stdout) as ScanResult).candidates).toEqual([]);
    const lower = runMain(['--format', 'json', '--min-thresholds', '1', dir]);
    const counter = (JSON.parse(lower.stdout) as ScanResult).candidates.find(c => c.signal === 'counter-thresholds');
    expect(counter?.facts).toMatchObject({ thresholds: ['< 4', '> 2.5'], site_count: 1 });
  });

  // Value: protects=formatted probes, destination-first saves, typed Literals and code-only assignments; fails_when=the scanner loses real sites or reports illustrative strings; why_new=third-cycle reproduced defects
  test('keeps multiline branch, save payload, and typed Literal evidence distinct', () => {
    const dir = mkdtempSync(join(BASE_TMP, 'formatted-evidence-'));
    writeFileSync(join(dir, 'job.ts'), [
      'function choose() {',
      '  if (',
      '    existsSync("job_state.json") ||',
      '    existsSync("job_done.flag") ||',
      '    existsSync("job_checkpoint.json")',
      '  ) return "ready";',
      '}',
      'function saveJob(path, job) {',
      '  const payload = { id: job.id, revision: 2, note: "opened, checked, closed" };',
      '  save(path, payload);',
      '}',
      'function loadJob(data) { return { id: data.id, note: data.note }; }',
      'function one() { return "job.status = pending"; }',
      'function two() { return "job.status = running"; }',
      'function three() { return "job.status = done"; }',
    ].join('\n'));
    writeFileSync(join(dir, 'job.py'), [
      'from typing import Literal',
      'class Job:',
      '    status: Literal["pending", "running", "done"]',
      'def pending(job: Job):',
      '    return job.status == "pending"',
      'def running(job: Job):',
      '    return job.status == "running"',
      'def done(job: Job):',
      '    return job.status == "done"',
    ].join('\n'));
    const result = runMain(['--format', 'json', '--min-sites', '2', dir]);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as ScanResult;
    expect(report.candidates.map(candidate => [candidate.signal, candidate.subject])).toEqual([
      ['cross-file-inferred-state', 'job.ts:choose'],
      ['write-decode-gap', 'revision'],
    ]);
    expect(report.candidates[0]!.sites.map(site => site.line).sort()).toEqual([3, 4, 5]);
    expect(report.candidates[1]!.sites).toEqual([{ file: 'job.ts', line: 9, function: 'saveJob' }]);
  });

  // Value: protects=clean typed code and unsupported languages emit NO_CANDIDATES and exit 0 with accurate skipped counts; fails_when=typed enums, reducer modules, or non-Python/non-TS files trigger false positives or errors; why_new=Track 100A T3; seam=none
  test('clean-and-other-langs emits zero candidates and skips unsupported extensions cleanly', () => {
    const dir = materializeFixture('clean-and-other-langs');
    const textRes = runSubprocess([dir]);
    expect(textRes.status).toBe(0);
    expect(textRes.stderr).toBe('');
    expect(textRes.stdout.trim()).toBe('NO_CANDIDATES');

    const jsonRes = runMain(['--format', 'json', dir]);
    expect(jsonRes.status).toBe(0);
    const parsed = JSON.parse(jsonRes.stdout) as ScanResult;
    expect(parsed.candidates).toEqual([]);
    expect(parsed.scanned_by_language).toEqual({ python: 1, ts_js: 1 });
    expect(parsed.skipped_files).toBe(3); // main.go, lib.rs, README.md
  });

  // Value: protects=CLI routing, limits and read-only discovery; fails_when=inputs or results violate the published CLI contract; why_new=Track 100A T3
  test('CLI flags, limits, escaping symlinks, --help/-h, and error exit codes behave deterministically', () => {
    for (const flag of ['--help', '-h']) {
      const scratch = mkdtempSync(join(BASE_TMP, 'help-'));
      const r = runSubprocess([flag], scratch);
      expect(r.status).toBe(0);
      expect(r.stderr).toBe('');
      expect(r.stdout).toContain('Usage: full-review-state-machines');
      expect(r.stdout).toContain('--max-candidates');
      expect(readdirSync(scratch)).toEqual([]);
    }

    const badArg = runMain(['--not-a-flag']);
    expect(badArg.status).toBe(2);
    expect(badArg.stderr).toContain('unknown option');

    const badFormat = runMain(['--format', 'xml']);
    expect(badFormat.status).toBe(2);

    const badNum = runMain(['--min-fields', '0']);
    expect(badNum.status).toBe(2);

    const missingDir = runMain([join(BASE_TMP, 'does-not-exist-9999')]);
    expect(missingDir.status).toBe(1);
    expect(missingDir.stderr).toContain('does not exist');

    // Limit tuning & truncation
    const pyDir = materializeFixture('implicit-sm-py');
    const raised = runMain(['--format', 'json', '--min-fields', '5', '--max-candidates', '2', pyDir]);
    expect(raised.status).toBe(0);
    const raisedParsed = JSON.parse(raised.stdout) as ScanResult;
    expect(raisedParsed.candidates.some(c => c.signal === 'boolean-state-bag')).toBe(false);
    expect(raisedParsed.candidates.length).toBe(2);
    expect(raisedParsed.truncated).toBe(true);
    expect(raisedParsed.total_candidates).toBeGreaterThan(2);
    const sites = runMain(['--format', 'json', '--min-sites', '20', '--min-files', '20', pyDir]);
    expect(sites.status).toBe(0);
    const sitesParsed = JSON.parse(sites.stdout) as ScanResult;
    expect(sitesParsed.candidates.map(c => c.signal)).not.toContain('mutation-fanout');
    expect(sitesParsed.candidates.map(c => c.signal)).not.toContain('string-state-fanout');

    // Escaping symlink is skipped
    const outsideDir = mkdtempSync(join(BASE_TMP, 'outside-'));
    const outsideFile = join(outsideDir, 'escaped.py');
    writeFileSync(outsideFile, 'x = 1\n');
    const cleanDir = materializeFixture('clean-and-other-langs');
    symlinkSync(outsideFile, join(cleanDir, 'escaped_link.py'));
    const symRes = runMain(['--format', 'json', cleanDir]);
    expect(symRes.status).toBe(0);
    const symParsed = JSON.parse(symRes.stdout) as ScanResult;
    expect(symParsed.scanned_by_language).toEqual({ python: 1, ts_js: 1 });
    expect(symParsed.skipped_files).toBe(4);
  });
});

describe('fixture-backed implicit-state-machine lens classification and source-tag contract', () => {
  // Value: protects=scanner evidence pairs with hand-authored /full-review contract examples, [make explicit now]/[plain check] tags, validateTagExpression, and routeSourceTag; fails_when=classification tags break finding grammar, source-tag validation, or routing; why_new=Track 100A T3 criterion 5; seam=none; no_claim=live LLM judgment
  test('seeded implicit state machine vs plain-check findings satisfy /full-review grammar and source-tag routing', () => {
    const smDir = materializeFixture('implicit-sm-py');
    const smScan = JSON.parse(runMain(['--format', 'json', smDir]).stdout) as ScanResult;
    expect(smScan.candidates.some(c => c.signal === 'boolean-state-bag')).toBe(true);
    const mutation = smScan.candidates.find(c => c.signal === 'mutation-fanout');
    expect(mutation?.sites).toContainEqual({ file: 'workflow.py', line: 22, function: 'submit_order' });

    const pcDir = materializeFixture('plain-check');
    const pcScan = JSON.parse(runMain(['--format', 'json', pcDir]).stdout) as ScanResult;
    expect(pcScan.candidates.map(c => c.signal)).toEqual(['write-decode-gap', 'write-decode-gap']);
    const gap = pcScan.candidates.find(c => c.subject === 'schema_version');
    expect(gap?.sites).toContainEqual({ file: 'store.py', line: 12, function: 'save_session' });

    const findingLineRe =
      /^FILE: (.+?) \| LINE: ([0-9-]+) \| SEVERITY: (critical|necessary|nice-to-have|edge-case) \| DESCRIPTION: (.+?) \| HYPOTHESIS: (.+)$/;

    const findings = [
      {
        line:
          'FILE: workflow.py | LINE: 22 | SEVERITY: necessary | DESCRIPTION: [make explicit now] Submit marks orders in flight, but cancellation keeps that flag set; completion sets settled_at and can then overwrite completed with dead. Retrying submit can also overwrite cancelled with failed. | HYPOTHESIS: Centralize transitions in an explicit OrderState type and transition table that owns lifecycle flags and validates loaded state.',
        site: mutation!.sites.find(site => site.line === 22),
        expectedRoute: 'KEEP',
        expectedMarker: '[make explicit now]',
      },
      {
        line:
          'FILE: store.py | LINE: 12 | SEVERITY: necessary | DESCRIPTION: [plain check] save_session persists schema_version but load_session ignores it, allowing a corrupt or incompatible persisted record to decode silently. | HYPOTHESIS: Add a single assertion in load_session validating data["schema_version"] against the supported version before returning.',
        site: gap!.sites[0],
        expectedRoute: 'KEEP',
        expectedMarker: '[plain check]',
      },
      {
        line:
          'FILE: order.py | LINE: 12 | SEVERITY: edge-case | DESCRIPTION: is_terminal is a pure derivation over OrderStatus with no reachable impossible state; dropped at source. | HYPOTHESIS: No change needed.',
        site: undefined,
        expectedRoute: 'KILL',
        expectedMarker: null,
      },
    ];

    for (const f of findings) {
      const m = findingLineRe.exec(f.line);
      expect(m, f.line).not.toBeNull();
      const [, file, line, severity, description] = m!;
      if (f.expectedMarker) {
        expect(description).toContain(f.expectedMarker);
        expect(f.site).toMatchObject({ file, line: Number(line) });
      }
      const tag = '[full-review:' + severity + ',files=' + file + ']';
      expect(validateTagExpression(tag).ok).toBe(true);
      expect(routeSourceTag(tag).action).toBe(f.expectedRoute);
    }
  });
});

describe('fixture hygiene and consumer independence', () => {
  // Value: protects=fixture suffix isolation; fails_when=fixture code reaches the repository test selector; why_new=Track 100A T3
  test('every file under tests/fixtures/full-review-state-machines/ ends in .txt', () => {
    const allFixtureFiles = walkFiles(FIXTURES_ROOT);
    expect(allFixtureFiles.length).toBeGreaterThan(0);
    for (const abs of allFixtureFiles) {
      expect(abs.endsWith('.txt'), `expected .txt suffix on ${relative(REPO_ROOT, abs)}`).toBe(true);
    }
  });

  // Value: protects=consumer independence of shipped assets; fails_when=consumer-specific sample text leaks into the scanner; why_new=Track 100A T3
  test('shipped skill, helper, docs, and fixtures contain no personal or consumer-specific identifiers', () => {
    const filesToCheck = [
      join(REPO_ROOT, 'skills/full-review.md'),
      join(REPO_ROOT, 'bin/full-review-state-machines'),
      join(REPO_ROOT, 'src/full-review/state-machines.ts'),
      join(REPO_ROOT, 'src/full-review/state-machines-cli.ts'),
      join(REPO_ROOT, 'docs/source-tag-contract.md'),
      ...walkFiles(FIXTURES_ROOT),
    ];
    const forbidden = [
      /\/Users\/[a-z0-9_-]+/i,
      /\/home\/[a-z0-9_-]+\/(?!\.gstack)/i,
      /\bmmm-factory\b/i,
      /\bkarlos\b/i,
      /\bthreading\b/i,
    ];
    for (const file of filesToCheck) {
      const content = readFileSync(file, 'utf8');
      for (const re of forbidden) {
        // docs/source-tag-contract.md has one historical example line referencing kbitz/threading; skip that pre-existing example line
        const filtered = file.endsWith('docs/source-tag-contract.md')
          ? content.split('\n').filter(l => !l.includes('surfaced during Group 2 pair-review')).join('\n')
          : content;
        expect(re.test(filtered), `${relative(REPO_ROOT, file)} matched ${re}`).toBe(false);
      }
    }
    expect(existsSync(BIN)).toBe(true);
  });
});
