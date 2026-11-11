/** Track 24A workflow metrics: real launcher subprocesses in isolated homes (docs/workflow-metrics.schema.json). */
import { afterAll, describe, test, expect } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { openChildStdio, openFifoStdin } from './helpers/child-stdio.ts';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv from 'ajv';
import { HELPER_BIN, cleanupTelemetryFixtures, compareRealStores, harvestSessionIds, makeTelemetryFixture, realStoreSpecs, snapshotRealStores, assertRealStoresUntouched, type StoreSpec, type TelemetryFixture } from './helpers/telemetry-env';
import { appendFileSync, realpathSync, truncateSync, utimesSync } from 'node:fs';

afterAll(cleanupTelemetryFixtures, 60_000);
const ROOT = join(import.meta.dir, '..');
const schema = JSON.parse(readFileSync(join(ROOT, 'docs/workflow-metrics.schema.json'), 'utf8'));
const ajv = new Ajv({ strict: true, allErrors: true });
ajv.addSchema(schema);
const validRecord = ajv.getSchema('workflow-metrics')!;
const validEnvelope = ajv.getSchema('workflow-metrics#/definitions/envelope')!;
const u = () => randomUUID();
const HEAD = 'a'.repeat(40), TREE = 'b'.repeat(40), BASE = 'c'.repeat(40);
const CTX = { candidate_head: HEAD, candidate_tree: TREE, candidate_base: BASE, binding: 'clean', skill_sha256: 'd'.repeat(64), parent_session_id: null };
type Env = Record<string, string>;

function runRaw(env: Env, args: string[], input?: string | Buffer, cwd?: string, bin = HELPER_BIN) {
  return spawnSync(bin, args, { env, cwd, input: input ?? '', encoding: 'utf8', timeout: 15_000 });
}
function metrics(env: Env, op: string, payload?: unknown, cwd?: string, extraArgs: string[] = []) {
  const r = runRaw(env, ['metrics', op, ...extraArgs], payload === undefined ? '' : JSON.stringify(payload), cwd);
  expect(r.status).toBe(0);
  const envelope = JSON.parse(r.stdout);
  expect(validEnvelope(envelope)).toBe(true);
  expect(new TextEncoder().encode(r.stdout).length).toBeLessThanOrEqual(16 * 1024);
  if (envelope.diagnostics) expect(JSON.stringify(envelope.diagnostics).length).toBeLessThanOrEqual(4 * 1024);
  return { envelope, stderr: r.stderr, stdout: r.stdout };
}
function gitRepo(fix: TelemetryFixture, name = 'repo') {
  const cwd = join(fix.home, name);
  mkdirSync(cwd, { recursive: true });
  expect(spawnSync('git', ['init', '-q', cwd], { env: fix.env }).status).toBe(0);
  return cwd;
}
function start(fix: TelemetryFixture, repo: string, stage = 'review-and-prep', env: Env = fix.env) {
  const r = runRaw(env, ['start', '--skill', `extend:${stage}`], '', repo);
  expect(r.status).toBe(0);
  const sid = /session=(extend-[0-9a-f-]{36})/.exec(r.stdout)?.[1];
  expect(sid).toBeTruthy();
  return sid!;
}
function base(sid: string, stage = 'review-and-prep') {
  return { v: 1, stage, session_id: sid, event_id: u() };
}
function beginRun(fix: TelemetryFixture, repo: string, sid: string, stage = 'review-and-prep', env: Env = fix.env) {
  const step = u();
  const payload = { ...base(sid, stage), step_id: step, parent_step_id: null, kind: 'run', phase: 'run', context: CTX };
  const { envelope } = metrics(env, 'begin', payload, repo);
  expect(envelope.status).toBe('recorded');
  return { step, payload };
}
function ledgerFile(fix: TelemetryFixture, sid: string) {
  return join(fix.home, '.gstack-extend/analytics/workflow-metrics', createHash('sha256').update(sid).digest('hex') + '.jsonl');
}
function ledgerLines(fix: TelemetryFixture, sid: string) {
  const file = ledgerFile(fix, sid);
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
}
function read(fix: TelemetryFixture, sid: string, eventId?: string, env: Env = fix.env) {
  const args = ['--session-id', sid, ...(eventId ? ['--event-id', eventId] : [])];
  return metrics(env, 'read', undefined, undefined, args);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value as object).sort().map(k => JSON.stringify(k) + ':' + canonical((value as any)[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}
/** Write stored records directly (imported-fixture path): controlled timestamps, correct digests. */
function craft(fix: TelemetryFixture, sid: string, rows: Array<{ op: string; at: number; request: any }>, producerVersion: string | null = '0.36.13.0') {
  const file = ledgerFile(fix, sid);
  mkdirSync(join(file, '..'), { recursive: true });
  const lines = rows.map(({ op, at, request }) => {
    const digest = createHash('sha256').update(canonical({ op, request })).digest('hex');
    const record = { v: op === 'usage' ? 2 : 1, op, event_id: request.event_id, request_digest: digest, captured_at_ms: at, producer_version: producerVersion, request };
    expect(validRecord(record), `${op} ${JSON.stringify(validRecord.errors)}`).toBe(true); // helper and schema agree
    return JSON.stringify(record);
  });
  writeFileSync(file, lines.join('\n') + '\n');
  return file;
}
function runRows(sid: string, at = 1000) {
  const step = u();
  return { step, rows: [{ op: 'begin', at, request: { ...base(sid), step_id: step, parent_step_id: null, kind: 'run', phase: 'run', context: CTX } }] };
}
function finding(id: string, patch: Record<string, unknown> = {}) {
  return { finding_id: id, severity_source: 'P2', severity_rubric: 'core', adjudication: 'accepted', resolution: 'open', duplicate_of: null, ...patch };
}
function passRows(sid: string, opts: { scope?: string; at?: number; voices?: Array<{ voice: string; na?: boolean; findings?: any[]; outcome?: string; select?: boolean }> } = {}) {
  const at = opts.at ?? 2000, passId = u(), voices = opts.voices ?? [{ voice: 'core', findings: [] }];
  const rows: any[] = [{ op: 'pass', at, request: { ...base(sid), pass_id: passId, scope: opts.scope ?? 'local', state: 'started', required_voice_ids: voices.map(v => v.voice) } }];
  const attempts: Record<string, string> = {};
  for (const v of voices) {
    if (v.na) {
      rows.push({ op: 'pass', at: at + 30, request: { ...base(sid), pass_id: passId, scope: opts.scope ?? 'local', state: 'voice-complete', voice_id: v.voice, voice_status: 'not-applicable', na_reason: 'not-applicable' } });
      continue;
    }
    const attempt = u();
    attempts[v.voice] = attempt;
    const outcome = v.outcome ?? 'completed';
    rows.push({ op: 'pass', at: at + 10, request: { ...base(sid), pass_id: passId, scope: opts.scope ?? 'local', state: 'attempt', voice_id: v.voice, attempt_id: attempt, predecessor_attempt_id: null, attempt_outcome: outcome, ...(outcome === 'completed' ? { findings: v.findings ?? [] } : {}) } });
    if (v.select !== false) rows.push({ op: 'pass', at: at + 20, request: { ...base(sid), pass_id: passId, scope: opts.scope ?? 'local', state: 'voice-complete', voice_id: v.voice, voice_status: 'completed', selected_attempt_id: attempt } });
  }
  rows.push({ op: 'pass', at: at + 40, request: { ...base(sid), pass_id: passId, scope: opts.scope ?? 'local', state: 'completed' } });
  return { passId, attempts, rows };
}

/** Run the real module in-process with test-only patches (fault injection without a production seam). */
function patched(fix: TelemetryFixture, name: string, patchLines: string[], op: string, payload: unknown, cwd: string) {
  const script = join(fix.home, name + '.py');
  writeFileSync(script, [
    'import importlib.util, os, sys',
    `spec = importlib.util.spec_from_file_location("workflow_metrics", ${JSON.stringify(join(ROOT, 'bin/lib/workflow_metrics.py'))})`,
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    ...patchLines,
    `m.main([${JSON.stringify(op)}])`,
  ].join('\n'));
  return spawnSync('python3', ['-B', '-I', script], { env: fix.env, cwd, input: JSON.stringify(payload), encoding: 'utf8', timeout: 15_000 });
}

describe('C1 discovery, disabled capture, no legacy side effects', () => {
  test('help needs no stdin or state and creates nothing', () => {
    const fix = makeTelemetryFixture('community');
    for (const args of [['metrics', '--help'], ['metrics'], ...['begin', 'end', 'decision', 'pass', 'correction', 'read'].map(op => ['metrics', op, '--help'])]) {
      const r = runRaw(fix.env, args);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('docs/telemetry.md#workflow-metrics');
      expect(r.stderr).toBe('');
    }
    const top = runRaw(fix.env, ['--help']);
    expect(top.stdout).toContain('metrics: optional local step/pass capture');
    expect(top.stdout).toContain('Usage: gstack-extend-telemetry start|finish');
    expect(existsSync(join(fix.home, '.gstack-extend'))).toBe(false);
    expect(fix.readStubArgs()).toEqual([]);
  });
  test('unknown operation and unexpected argv are fixed invalid-input envelopes, exit 0', () => {
    const fix = makeTelemetryFixture('community');
    const bad = metrics(fix.env, 'bogus-op');
    expect(bad.envelope).toMatchObject({ status: 'unavailable', reason: 'invalid-input' });
    const argv = runRaw(fix.env, ['metrics', 'begin', 'extra'], '{}');
    expect(JSON.parse(argv.stdout)).toMatchObject({ status: 'unavailable', reason: 'invalid-input' });
    expect(existsSync(join(fix.home, '.gstack-extend'))).toBe(false);
  });
  test('env off and provenance=false disable before lookup, mutation or logger calls', () => {
    // Coverage audit (/ship Step 7, 2026-10-19) added the env-false, provenance-off and config-symlink modes.
    // Value: protects=metrics capture stays off for every spelling and state that turns legacy provenance off (env false, provenance=off, unreadable config);
    //   fails_when=the off/false tuple loses a value or an unreadable or symlinked config is read as enabled; why_new=the loop covered only env=off and provenance=false;
    //   seam=none; no_claim=legacy provenance gating itself (tests/telemetry.test.ts owns it)
    for (const mode of ['env', 'env-false', 'provenance', 'provenance-off', 'config-symlink'] as const) {
      const fix = makeTelemetryFixture('community');
      const repo = gitRepo(fix);
      let env = fix.env;
      const config = join(fix.home, '.gstack-extend/config');
      if (mode === 'env' || mode === 'env-false') env = { ...fix.env, GSTACK_EXTEND_WORKFLOW_METRICS: mode === 'env' ? 'off' : 'false' };
      else {
        mkdirSync(join(fix.home, '.gstack-extend'), { recursive: true });
        if (mode === 'config-symlink') {
          // An unreadable config stays off (docs/telemetry.md): a linked config is not trusted even when it says true.
          writeFileSync(join(fix.home, 'linked-config'), 'provenance=true\n');
          symlinkSync(join(fix.home, 'linked-config'), config);
        } else writeFileSync(config, mode === 'provenance' ? 'provenance=false\n' : 'provenance=off\n');
      }
      const payload = { ...base('extend-' + u()), step_id: u(), parent_step_id: null, kind: 'run', phase: 'run', context: CTX };
      const { envelope } = metrics(env, 'begin', payload, repo);
      expect(envelope, mode).toMatchObject({ status: 'disabled', reason: 'capture-disabled', data: { capture: 'disabled' } });
      if (mode === 'env' || mode === 'env-false') expect(envelope.diagnostics.config_source).toEqual(['GSTACK_EXTEND_WORKFLOW_METRICS']);
      expect(existsSync(join(fix.home, '.gstack-extend/analytics'))).toBe(false);
      expect(fix.readStubArgs()).toEqual([]);
      expect(fix.readLedger()).toEqual([]);
    }
  }, 30_000); // five fixture homes now, not two
  test('metrics-only calls write no stage-runs row and never invoke the logger stub', () => {
    const fix = makeTelemetryFixture('community');
    const repo = gitRepo(fix);
    const sid = start(fix, repo);
    beginRun(fix, repo, sid);
    expect(fix.readLedger()).toEqual([]);
    expect(fix.readStubArgs()).toEqual([]); // start writes skill_start directly; the logger runs only at legacy finish
    expect(fix.readJsonl().map(r => r.event_type)).toEqual(['skill_start']);
  }, 30_000);
});

describe('C2/E3 exact invocation binding', () => {
  test('binds from a subdirectory, survives legacy finish, and reads back', () => {
    const fix = makeTelemetryFixture('community');
    const repo = gitRepo(fix);
    const sub = join(repo, 'sub/dir');
    mkdirSync(sub, { recursive: true });
    const sid = start(fix, repo);
    const { step } = beginRun(fix, repo, sid);
    const before = read(fix, sid).envelope;
    expect(before.data.run.candidate.candidate_head).toBe(HEAD);
    expect(runRaw(fix.env, ['finish', '--skill', 'extend:review-and-prep', '--outcome', 'success'], '', repo).status).toBe(0);
    const after = read(fix, sid).envelope;
    expect(after.status).toBe('ok');
    expect(after.data.records).toBe(2);
    // Later records need no git: a decision from outside any checkout still records.
    const dec = metrics(fix.env, 'decision', { ...base(sid), step_id: step, phase: 'readiness', decision: 'RUN', reason: 'required' }, fix.home).envelope;
    expect(dec.status).toBe('recorded');
  }, 30_000);
  test('subdirectory start binds; consumed handoff, wrong checkout and unknown ID do not', () => {
    const fix = makeTelemetryFixture('community');
    const repo = gitRepo(fix), other = gitRepo(fix, 'other');
    const sub = join(repo, 'nested');
    mkdirSync(sub);
    const sid = start(fix, sub);
    // begin from the subdirectory resolves the same root
    const payload = { ...base(sid), step_id: u(), parent_step_id: null, kind: 'run', phase: 'run', context: CTX };
    expect(metrics(fix.env, 'begin', payload, sub).envelope.status).toBe('recorded');
    // a fresh invocation whose finish already consumed the handoff cannot bind afterwards
    const sid2 = start(fix, repo, 'ship-and-land');
    expect(runRaw(fix.env, ['finish', '--skill', 'extend:ship-and-land', '--outcome', 'success'], '', repo).status).toBe(0);
    const late = metrics(fix.env, 'begin', { ...base(sid2, 'ship-and-land'), step_id: u(), parent_step_id: null, kind: 'run', phase: 'run', context: CTX }, repo).envelope;
    expect(late.status).toBe('unavailable');
    expect(['identity-missing', 'ambiguous-binding']).toContain(late.reason);
    expect(existsSync(ledgerFile(fix, sid2))).toBe(false);
    // wrong checkout / invented session
    const ghost = 'extend-' + u();
    expect(metrics(fix.env, 'begin', { ...base(ghost), step_id: u(), parent_step_id: null, kind: 'run', phase: 'run', context: CTX }, other).envelope)
      .toMatchObject({ status: 'unavailable', reason: 'identity-missing' });
    // non-initial events never create a run implicitly
    expect(metrics(fix.env, 'end', { ...base(ghost), step_id: u(), outcome: 'completed' }, repo).envelope)
      .toMatchObject({ status: 'unavailable', reason: 'capture-missing' });
    expect(read(fix, ghost).envelope).toMatchObject({ status: 'unavailable', reason: 'capture-missing' });
    // Coverage audit (/ship Step 7, 2026-10-19).
    // Value: protects=an existing run file with no bound run still binds only through the exact start handoff;
    //   fails_when=the bind on an existing-but-empty ledger is skipped, so an invented ID records a run; why_new=every binding case above starts with no run file;
    //   seam=none; no_claim=how an empty run file arises (a crash between create and first write is simulated by writing one)
    const blank = (id: string) => { mkdirSync(join(ledgerFile(fix, id), '..'), { recursive: true }); writeFileSync(ledgerFile(fix, id), ''); };
    const emptyGhost = 'extend-' + u();
    blank(emptyGhost);
    expect(metrics(fix.env, 'decision', { ...base(emptyGhost), step_id: u(), phase: 'tests', decision: 'RUN', reason: 'required' }, repo).envelope)
      .toMatchObject({ status: 'unavailable', reason: 'capture-missing' });
    expect(metrics(fix.env, 'begin', { ...base(emptyGhost), step_id: u(), parent_step_id: null, kind: 'run', phase: 'run', context: CTX }, repo).envelope)
      .toMatchObject({ status: 'unavailable', reason: 'identity-missing' });
    expect(readFileSync(ledgerFile(fix, emptyGhost), 'utf8')).toBe('');
    const sid3 = start(fix, repo);
    blank(sid3);
    expect(metrics(fix.env, 'begin', { ...base(sid3), step_id: u(), parent_step_id: null, kind: 'run', phase: 'run', context: CTX }, repo).envelope.status).toBe('recorded');
    expect(ledgerLines(fix, sid3)).toHaveLength(1);
  }, 30_000);
  test('wrong stage, second run begin, and stage drift against the bound run are refused', () => {
    const fix = makeTelemetryFixture('community');
    const repo = gitRepo(fix);
    const sid = start(fix, repo);
    const wrongStage = metrics(fix.env, 'begin', { ...base(sid, 'ship-and-land'), step_id: u(), parent_step_id: null, kind: 'run', phase: 'run', context: CTX }, repo).envelope;
    expect(wrongStage).toMatchObject({ status: 'unavailable', reason: 'identity-missing' });
    beginRun(fix, repo, sid);
    const second = metrics(fix.env, 'begin', { ...base(sid), step_id: u(), parent_step_id: null, kind: 'run', phase: 'run', context: CTX }, repo).envelope;
    expect(second).toMatchObject({ status: 'conflict', reason: 'event-conflict' });
    const drift = metrics(fix.env, 'decision', { ...base(sid, 'ship-and-land'), step_id: u(), phase: 'ship', decision: 'RUN', reason: 'required' }, repo).envelope;
    expect(drift).toMatchObject({ status: 'unavailable', reason: 'identity-mismatch' });
    expect(ledgerLines(fix, sid)).toHaveLength(1);
  }, 30_000);
  test('candidate overrides apply per event; replay keeps the original context', () => {
    const fix = makeTelemetryFixture('community');
    const repo = gitRepo(fix);
    const sid = start(fix, repo);
    const { step, payload } = beginRun(fix, repo, sid);
    const child = u();
    metrics(fix.env, 'begin', { ...base(sid), step_id: child, parent_step_id: step, kind: 'phase', phase: 'tests', context: { candidate_head: 'e'.repeat(40) } }, repo);
    const replay = metrics(fix.env, 'begin', payload, repo).envelope;
    expect(replay.status).toBe('replayed');
    const data = read(fix, sid).envelope.data;
    expect(data.run.candidate.candidate_head).toBe(HEAD);
    expect(ledgerLines(fix, sid)).toHaveLength(2);
  }, 30_000);
  // Coverage audit (/ship Step 7, 2026-10-19).
  // Value: protects=the documented ledger location follows an absolute GSTACK_EXTEND_STATE_DIR and ignores a relative one, as legacy start does;
  //   fails_when=metrics resolves its state root differently from legacy, so binding fails or records land outside the chosen root;
  //   why_new=every other metrics test leaves the override unset or equal to the HOME default; seam=none; no_claim=legacy state-root handling (tests/telemetry.test.ts owns it)
  test('an absolute state-dir override holds the run; a relative one falls back to HOME and writes nothing in the checkout', () => {
    const fix = makeTelemetryFixture('community');
    const repo = gitRepo(fix);
    const custom = join(fix.home, 'custom-state');
    const env = { ...fix.env, GSTACK_EXTEND_STATE_DIR: custom };
    const sid = start(fix, repo, 'review-and-prep', env);
    beginRun(fix, repo, sid, 'review-and-prep', env);
    const digest = createHash('sha256').update(sid).digest('hex');
    expect(existsSync(join(custom, 'analytics/workflow-metrics', digest + '.jsonl'))).toBe(true);
    expect(existsSync(join(fix.home, '.gstack-extend/analytics/workflow-metrics'))).toBe(false);
    expect(existsSync(join(fix.home, '.gstack-extend/workflow-metrics-locks'))).toBe(false);
    expect(read(fix, sid, undefined, env).envelope).toMatchObject({ status: 'ok', data: { records: 1 } });
    expect(read(fix, sid).envelope).toMatchObject({ status: 'unavailable', reason: 'capture-missing' });
    const relative = { ...fix.env, GSTACK_EXTEND_STATE_DIR: 'relative-state' };
    const sid2 = start(fix, repo, 'review-and-prep', relative);
    beginRun(fix, repo, sid2, 'review-and-prep', relative);
    expect(ledgerLines(fix, sid2)).toHaveLength(1);
    expect(existsSync(join(repo, 'relative-state'))).toBe(false);
  }, 30_000);
});

describe('C3 write, replay, conflict and targeted reconciliation', () => {
  test('identical replay keeps timestamp and count; changed payload conflicts; schema holds', () => {
    const fix = makeTelemetryFixture('community');
    const repo = gitRepo(fix);
    const sid = start(fix, repo);
    const { payload } = beginRun(fix, repo, sid);
    const first = read(fix, sid, payload.event_id).envelope;
    expect(first.data.event.status).toBe('match');
    const replay = metrics(fix.env, 'begin', payload, repo).envelope;
    expect(replay.status).toBe('replayed');
    expect(replay.data.captured_at_ms).toBe(first.data.event.captured_at_ms);
    expect(ledgerLines(fix, sid)).toHaveLength(1);
    const changed = metrics(fix.env, 'begin', { ...payload, context: { ...CTX, binding: 'dirty' } }, repo).envelope;
    expect(changed).toMatchObject({ status: 'conflict', reason: 'event-conflict' });
    expect(ledgerLines(fix, sid)).toHaveLength(1);
    for (const line of ledgerLines(fix, sid)) expect(validRecord(JSON.parse(line))).toBe(true);
    // absent only on a valid snapshot
    expect(read(fix, sid, u()).envelope.data.event.status).toBe('absent');
  }, 30_000);
  test('stored records survive a subdirectory read and never echo into it', () => {
    const fix = makeTelemetryFixture('community');
    const repo = gitRepo(fix);
    const sid = start(fix, repo);
    beginRun(fix, repo, sid);
    const out = read(fix, sid);
    expect(out.stdout).not.toContain('"request"');
    expect(out.envelope.data.receipt_text.length).toBeLessThanOrEqual(2 * 1024);
  }, 30_000);
});

describe('C4/E10 pass and finding algebra (crafted imports)', () => {
  test('accepted=2 fixed=1 open=1, severity normalization, duplicates not accepted', () => {
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u();
    const run = runRows(sid);
    const p = passRows(sid, { voices: [{ voice: 'core', findings: [
      finding('F1', { severity_source: 'P1', resolution: 'fixed' }),
      finding('F2', { severity_source: 'medium' }),
      finding('F3', { severity_source: 'unknown', adjudication: 'unclassified', resolution: 'unknown' }),
      finding('F4', { adjudication: 'duplicate', resolution: 'unknown', duplicate_of: 'F1' }),
      finding('F5', { adjudication: 'rejected', resolution: 'unknown' }),
    ] }] });
    craft(fix, sid, [...run.rows, ...p.rows]);
    const data = read(fix, sid).envelope.data;
    expect(data.local_passes).toBe(1);
    expect(data.findings).toMatchObject({ accepted: 2, fixed: 1, open: 1, rejected: 1, duplicate: 1, unclassified: 1 });
    expect(data.findings.by_normalized_severity).toMatchObject({ high: 1, medium: 3, unclassified: 1 });
    expect(data.greptile_passes).toBe(0);
    expect(data.greptile_findings).toBeNull();
  }, 30_000);
  test('retry/fallback: only the selected completed attempt counts; unselected success ignored', () => {
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u();
    const run = runRows(sid);
    const passId = u(), failed = u(), selected = u(), unselected = u();
    const attempt = (id: string, at: number, outcome: string, findings?: any[], pred: string | null = null) => ({
      op: 'pass', at, request: { ...base(sid), pass_id: passId, scope: 'local', state: 'attempt', voice_id: 'core', attempt_id: id, predecessor_attempt_id: pred, attempt_outcome: outcome, ...(outcome === 'completed' ? { findings } : {}) },
    });
    craft(fix, sid, [...run.rows,
      { op: 'pass', at: 2000, request: { ...base(sid), pass_id: passId, scope: 'local', state: 'started', required_voice_ids: ['core', 'docs'] } },
      attempt(failed, 2010, 'failed'),
      attempt(selected, 2020, 'completed', [finding('S1', { resolution: 'fixed' })], failed),
      attempt(unselected, 2030, 'completed', [finding('U1'), finding('U2')], selected),
      { op: 'pass', at: 2040, request: { ...base(sid), pass_id: passId, scope: 'local', state: 'voice-complete', voice_id: 'core', voice_status: 'completed', selected_attempt_id: selected } },
      { op: 'pass', at: 2050, request: { ...base(sid), pass_id: passId, scope: 'local', state: 'voice-complete', voice_id: 'docs', voice_status: 'not-applicable', na_reason: 'user-deferred' } },
      { op: 'pass', at: 2060, request: { ...base(sid), pass_id: passId, scope: 'local', state: 'completed' } },
      { op: 'correction', at: 2070, request: { ...base(sid), correction_kind: 'retry', attempt_id: selected, pass_id: passId, voice_id: 'core' } },
    ]);
    const data = read(fix, sid).envelope.data;
    expect(data.findings).toMatchObject({ accepted: 1, fixed: 1, open: 0 });
    expect(data.excluded_na_voices).toBe(1);
    expect(data.receipt_text).toContain('na_voices=1'); // an N/A exclusion is visible in the receipt
    expect(data.corrections.retry).toBe(1);
  }, 30_000);
  test('explicit empty findings are zero; missing voice and selected failed attempt are null', () => {
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u();
    craft(fix, sid, [...runRows(sid).rows, ...passRows(sid, { voices: [{ voice: 'core', findings: [] }] }).rows]);
    expect(read(fix, sid).envelope.data.findings).toMatchObject({ accepted: 0, fixed: 0, open: 0 });
    const sid2 = 'extend-' + u();
    craft(fix, sid2, [...runRows(sid2).rows, ...passRows(sid2, { voices: [{ voice: 'core', findings: [], select: false }, { voice: 'adv', findings: [] }] }).rows]);
    const missing = read(fix, sid2).envelope.data;
    expect(missing.findings).toBeNull();
    expect(missing.local_passes).toBeNull();
    expect(missing.unknown_reasons).toContain('incomplete-pass');
    const sid3 = 'extend-' + u();
    craft(fix, sid3, [...runRows(sid3).rows, ...passRows(sid3, { voices: [{ voice: 'core', outcome: 'partial' }] }).rows]);
    expect(read(fix, sid3).envelope.data.findings).toBeNull();
  }, 30_000);
  test('greptile is separate; finding correction applies once; duplicate completions count once', () => {
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u();
    const local = passRows(sid, { voices: [{ voice: 'core', findings: [finding('L1')] }] });
    const grep = passRows(sid, { scope: 'greptile', at: 3000, voices: [{ voice: 'greptile', findings: [finding('G1'), finding('G2')] }] });
    const dupCompleted = { op: 'pass', at: 2090, request: { ...base(sid), pass_id: local.passId, scope: 'local', state: 'completed' } };
    const fixCorrection = { op: 'correction', at: 2100, request: { ...base(sid), correction_kind: 'finding', finding_id: 'L1', resolution: 'fixed', pass_id: local.passId, attempt_id: local.attempts.core } };
    craft(fix, sid, [...runRows(sid).rows, ...local.rows, dupCompleted, fixCorrection, ...grep.rows]);
    const data = read(fix, sid).envelope.data;
    expect(data.local_passes).toBe(1);
    expect(data.greptile_passes).toBe(1);
    expect(data.findings).toMatchObject({ accepted: 1, fixed: 1, open: 0 });
    expect(data.greptile_findings).toMatchObject({ accepted: 2, open: 2 });
    // The receipt keeps local and Greptile findings apart, so open Greptile findings are never hidden.
    expect(data.receipt_text).toContain('local_findings accepted=1 fixed=1 open=0');
    expect(data.receipt_text).toContain('greptile_findings accepted=2 fixed=0 open=2');
  }, 30_000);
  // Coverage audit (/ship Step 7, 2026-10-19).
  // Value: protects=local_passes counts each closed round and sums its findings, while a round lacking its completed record stays uncounted with unknown findings;
  //   fails_when=per-scope totals keep only the last round, or a round with every voice closed counts before its completed record;
  //   why_new=every existing pass fixture holds one round per scope; seam=none; no_claim=whether producers emit every round they run
  test('two closed local rounds both count and sum; a round missing its completed record does not', () => {
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u();
    const first = passRows(sid, { voices: [{ voice: 'core', findings: [finding('F1', { resolution: 'fixed' }), finding('F2')] }] });
    const second = passRows(sid, { at: 5000, voices: [{ voice: 'core', findings: [finding('F1')] }] });
    craft(fix, sid, [...runRows(sid).rows, ...first.rows, ...second.rows]);
    const both = read(fix, sid).envelope;
    expect(both.status).toBe('ok');
    expect(both.data).toMatchObject({ local_passes: 2, local_attempted: 2 });
    expect(both.data.findings).toMatchObject({ accepted: 3, fixed: 1, open: 2 });
    expect(both.data.receipt_text).toContain('local_passes=2; local_attempted=2');
    const sid2 = 'extend-' + u();
    const open = passRows(sid2, { voices: [{ voice: 'core', findings: [finding('F1')] }] });
    craft(fix, sid2, [...runRows(sid2).rows, ...open.rows.filter((r: any) => r.request.state !== 'completed')]);
    const pending = read(fix, sid2).envelope;
    expect(pending.status).toBe('ok');
    expect(pending.data).toMatchObject({ local_passes: 0, local_attempted: 1, findings: null });
    expect(pending.data.unknown_reasons).toContain('incomplete-pass');
  }, 30_000);
});

describe('E11/E12 intervals, waits, candidate drift and clocks', () => {
  test('overlapping children union instead of sum; waits grouped; unknown parent keeps child', () => {
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u();
    const run = runRows(sid, 0);
    const parent = u(), childA = u(), childB = u(), orphan = u(), wait = u();
    const begin = (step: string, at: number, patch: any = {}) => ({ op: 'begin', at, request: { ...base(sid), step_id: step, parent_step_id: run.step, kind: 'voice', phase: 'voice', ...patch } });
    const end = (step: string, at: number, patch: any = {}) => ({ op: 'end', at, request: { ...base(sid), step_id: step, outcome: 'completed', ...patch } });
    craft(fix, sid, [...run.rows,
      begin(parent, 0, { kind: 'phase', phase: 'local-pass' }), end(parent, 100),
      begin(childA, 10, { parent_step_id: parent }), end(childA, 70),
      begin(childB, 40, { parent_step_id: parent }), end(childB, 90),
      begin(orphan, 200, { parent_step_id: u() }), end(orphan, 230),
      begin(wait, 300, { kind: 'wait', phase: undefined, wait_category: 'human' }), end(wait, 360),
    ].map(r => ({ ...r, request: Object.fromEntries(Object.entries(r.request).filter(([, v]) => v !== undefined)) })));
    const data = read(fix, sid).envelope.data;
    expect(data.union_observed_wall_ms).toBe(100 + 30 + 60);
    expect(data.unknown_parents).toBe(1);
    expect(data.waits).toEqual([{ wait_category: 'human', count: 1, observed_wall_duration_ms: 60, unknown_durations: 0 }]);
    expect(data.clock_basis).toBe('utc-wall');
    expect(data.clock_quality).toBe('clock-sensitive');
    expect(data.qualified_elapsed_ms).toBeNull();
  }, 30_000);
  test('backward endpoints null the duration; forward jumps stay labelled; drift keeps wall time as mixed', () => {
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u();
    const back = u(), drift = u();
    craft(fix, sid, [...runRows(sid, 0).rows,
      { op: 'begin', at: 5000, request: { ...base(sid), step_id: back, parent_step_id: null, kind: 'phase', phase: 'tests' } },
      { op: 'end', at: 4000, request: { ...base(sid), step_id: back, outcome: 'completed' } },
      { op: 'begin', at: 6000, request: { ...base(sid), step_id: drift, parent_step_id: null, kind: 'phase', phase: 'tests' } },
      { op: 'end', at: 9000, request: { ...base(sid), step_id: drift, outcome: 'completed', context: { candidate_head: 'f'.repeat(40) } } },
    ]);
    const data = read(fix, sid).envelope.data;
    const tests = data.phases.find((p: any) => p.phase === 'tests');
    expect(tests.observed_wall_duration_ms).toBeNull();
    expect(tests.unknown_durations).toBe(1);
    expect(data.union_observed_wall_ms).toBe(3000);
    expect(data.mixed_candidate_steps).toBe(1);
    expect(data.unknown_reasons).toContain('clock-invalid');
    expect(data.qualified_elapsed_ms).toBeNull();
    expect(data.receipt_text).toContain('clock-sensitive');
  }, 30_000);
});

describe('E1/E14 invalid input never mutates and never echoes', () => {
  test('table of malformed producer inputs', () => {
    const fix = makeTelemetryFixture('community');
    const repo = gitRepo(fix);
    const sid = start(fix, repo);
    const good = { ...base(sid), step_id: u(), parent_step_id: null, kind: 'run', phase: 'run', context: CTX };
    const modelAttempt = (model: string) => JSON.stringify({ ...base(sid), pass_id: u(), scope: 'local', state: 'attempt', voice_id: 'core', attempt_id: u(), predecessor_attempt_id: null, attempt_outcome: 'completed', findings: [], model_context: { requested_model: model, requested_effort: null, reported_model: null, reported_effort: null, requested_source: 'launcher-config', reported_source: 'unavailable', unknown_reason: 'not-reported' } });
    const cases: Array<[string, string | Buffer, string]> = [
      ['unknown key', JSON.stringify({ ...good, bogus: 1 }), 'invalid-input'],
      ['missing key', JSON.stringify({ v: 1, stage: 'review-and-prep' }), 'invalid-input'],
      ['duplicate keys', '{"v":1,"v":1}', 'invalid-input'],
      ['nonfinite', '{"v":NaN}', 'invalid-input'],
      ['bool as int', JSON.stringify({ ...good, v: true }), 'invalid-input'],
      ['version 2', JSON.stringify({ ...good, v: 2 }), 'unsupported-version'],
      ['huge version', JSON.stringify({ ...good, v: 0 }).replace('"v":0', '"v":' + '9'.repeat(4000)), 'unsupported-version'],
      ['not json', 'hello', 'invalid-input'],
      ['invalid utf8', Buffer.from([0x7b, 0xff, 0x7d]), 'invalid-input'],
      ['too deep', JSON.stringify({ ...good, context: { candidate_head: [[[[[[[['x']]]]]]]] } }), 'invalid-input'],
      ['oversized', 'x'.repeat(16 * 1024 + 1), 'invalid-input'],
      ['empty', '', 'invalid-input'],
      ['free-form model with spaces', modelAttempt('some model name'), 'invalid-input'],
      ['model with slash path', modelAttempt('/tmp/secret-model'), 'invalid-input'],
      ['model email', modelAttempt('a@example.com'), 'invalid-input'],
      ['model overlong', modelAttempt('m'.repeat(200)), 'invalid-input'],
      ['empty required voices', JSON.stringify({ ...base(sid), pass_id: u(), scope: 'local', state: 'started', required_voice_ids: [] }), 'invalid-input'],
      ['duplicate finding ids in one attempt (findings)', JSON.stringify({ ...base(sid), pass_id: u(), scope: 'local', state: 'attempt', voice_id: 'core', attempt_id: u(), predecessor_attempt_id: null, attempt_outcome: 'completed', findings: [finding('F1'), finding('F1')] }), 'invalid-input'],
      ['self duplicate_of (findings)', JSON.stringify({ ...base(sid), pass_id: u(), scope: 'local', state: 'attempt', voice_id: 'core', attempt_id: u(), predecessor_attempt_id: null, attempt_outcome: 'completed', findings: [finding('F2', { adjudication: 'duplicate', resolution: 'unknown', duplicate_of: 'F2' })] }), 'invalid-input'],
      ['model reported from launcher config', modelAttempt('m1').replace('"reported_source":"unavailable"', '"reported_source":"launcher-config"'), 'invalid-input'],
      ['model reported while unavailable', modelAttempt('m1').replace('"reported_model":null', '"reported_model":"m2"'), 'invalid-input'],
      ['257 findings array bound', JSON.stringify({ ...base(sid), pass_id: u(), scope: 'local', state: 'attempt', voice_id: 'core', attempt_id: u(), predecessor_attempt_id: null, attempt_outcome: 'completed', findings: Array.from({ length: 257 }, () => finding('F')) }), 'invalid-input'],
    ];
    for (const [name, input, reason] of cases) {
      const op = name.includes('model') || name.includes('voices') || name.includes('findings') ? 'pass' : 'begin';
      const r = runRaw(fix.env, ['metrics', op], input, repo);
      expect(r.status).toBe(0);
      const envelope = JSON.parse(r.stdout);
      expect(envelope.reason, name).toBe(reason);
      expect(envelope.diagnostics.trace, name).toBeNull();
      expect(envelope.diagnostics.doc_anchor, name).toContain('#workflow-metrics-');
      expect(JSON.stringify(envelope.diagnostics).length, name).toBeLessThanOrEqual(4 * 1024);
      expect(r.stdout, name).not.toContain('9'.repeat(100));
      expect(r.stdout + r.stderr).not.toContain('secret-model');
      expect(r.stdout + r.stderr).not.toContain('a@example.com');
    }
    // a session_id carrying path-like text is rejected without echo
    const leaky = runRaw(fix.env, ['metrics', 'begin'], JSON.stringify({ ...good, session_id: '/tmp/secret-token-xyz' }), repo);
    expect(leaky.stdout + leaky.stderr).not.toContain('secret-token-xyz');
    expect(ledgerLines(fix, sid)).toHaveLength(0);
    expect(existsSync(ledgerFile(fix, sid))).toBe(false);
  }, 60_000);
  test('regular-file stdin works; delayed and nonclosing pipes time out bounded', async () => {
    const fix = makeTelemetryFixture('community');
    const repo = gitRepo(fix);
    const sid = start(fix, repo);
    const payload = { ...base(sid), step_id: u(), parent_step_id: null, kind: 'run', phase: 'run', context: CTX };
    const file = join(fix.home, 'payload.json');
    writeFileSync(file, JSON.stringify(payload));
    const viaFile = spawnSync('bash', ['-c', `"${HELPER_BIN}" metrics begin < "${file}"`], { env: fix.env, cwd: repo, encoding: 'utf8', timeout: 15_000 });
    expect(JSON.parse(viaFile.stdout).status).toBe('recorded');
    const attempt = (delayMs: number, close: boolean) => new Promise<{ stdout: string; ms: number }>((resolve, reject) => {
      const t0 = Date.now();
      const stdin = openFifoStdin();
      const io = openChildStdio();
      const child = spawn(HELPER_BIN, ['metrics', 'decision'], {
        env: fix.env,
        cwd: repo,
        stdio: [stdin.readFd, io.stdoutFd, io.stderrFd],
      });
      let exited = false;
      child.on('error', err => {
        stdin.dispose();
        io.dispose();
        reject(err);
      });
      child.on('close', () => {
        exited = true;
        const { stdout } = io.read();
        stdin.dispose();
        io.dispose();
        resolve({ stdout, ms: Date.now() - t0 });
      });
      setTimeout(() => {
        if (exited) return;
        stdin.write(JSON.stringify({ ...base(sid), step_id: u(), phase: 'tests', decision: 'RUN', reason: 'required' }));
        if (close) stdin.end();
        else setTimeout(() => child.kill('SIGKILL'), 4000);
      }, delayMs);
    });
    // The 250 ms deadline must fire long before a write that arrives at 2.5 s, and must name its cause.
    const delayed = await attempt(2500, true);
    expect(JSON.parse(delayed.stdout)).toMatchObject({ reason: 'invalid-input', diagnostics: { cause: 'input-timeout' } });
    expect(delayed.ms).toBeLessThan(2500); // gstack-timing-ok: the bound is the contract under test (10x the 250 ms deadline)
    const open = await attempt(0, false);
    expect(JSON.parse(open.stdout)).toMatchObject({ reason: 'invalid-input', diagnostics: { cause: 'input-timeout' } });
    expect(open.ms).toBeLessThan(4000); // gstack-timing-ok: an unbounded read would be killed at 4 s with no envelope
  }, 60_000);
  test('terminal stdin is rejected immediately (pty fixture)', () => {
    const fix = makeTelemetryFixture('community');
    const repo = gitRepo(fix);
    const script = join(fix.home, 'pty-run.py');
    writeFileSync(script, [
      'import os, pty, subprocess, sys',
      'master, slave = pty.openpty()',
      `r = subprocess.run([${JSON.stringify(HELPER_BIN)}, "metrics", "begin"], stdin=slave, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=10)`,
      'print(r.stdout)',
      'print(r.stderr, file=sys.stderr)',
    ].join('\n'));
    const r = spawnSync('python3', [script], { env: fix.env, cwd: repo, encoding: 'utf8', timeout: 20_000 });
    expect(r.status).toBe(0);
    const envelope = JSON.parse(r.stdout.trim().split('\n')[0]);
    expect(envelope).toMatchObject({ reason: 'invalid-input' });
    expect(envelope.diagnostics.cause).toBe('stdin-tty');
  }, 30_000);
});

describe('E4 safe files and the nonblocking lock', () => {
  function boundFixture() {
    const fix = makeTelemetryFixture('community');
    const repo = gitRepo(fix);
    const sid = start(fix, repo);
    const { step } = beginRun(fix, repo, sid);
    return { fix, repo, sid, step };
  }
  test('symlink, hardlink and FIFO ledgers are refused without writing through them', () => {
    for (const kind of ['symlink', 'hardlink', 'fifo'] as const) {
      const { fix, repo, sid, step } = boundFixture();
      const file = ledgerFile(fix, sid);
      const original = readFileSync(file, 'utf8');
      const target = join(fix.home, 'target-' + kind);
      writeFileSync(target, 'KEEP\n');
      rmSync(file);
      if (kind === 'symlink') symlinkSync(target, file);
      else if (kind === 'hardlink') linkSync(target, file);
      else expect(spawnSync('mkfifo', [file], { env: fix.env }).status).toBe(0);
      const { envelope } = metrics(fix.env, 'decision', { ...base(sid), step_id: step, phase: 'tests', decision: 'RUN', reason: 'required' }, repo);
      expect(envelope.status, kind).toBe('unavailable');
      expect(envelope.reason, kind).toBe('unsafe-path');
      expect(readFileSync(target, 'utf8')).toBe('KEEP\n');
      void original;
    }
  }, 60_000);
  test('held lock returns lock-busy with no retry; release lets the same payload record', async () => {
    const { fix, repo, sid, step } = boundFixture();
    const lockFile = join(fix.home, '.gstack-extend/workflow-metrics-locks', createHash('sha256').update(sid).digest('hex') + '.lock');
    const ready = join(fix.home, 'locked');
    const holder = join(fix.home, 'hold.py');
    writeFileSync(holder, [
      'import fcntl, os, time, sys',
      `fd = os.open(${JSON.stringify(lockFile)}, os.O_RDWR)`,
      'fcntl.flock(fd, fcntl.LOCK_EX)',
      `open(${JSON.stringify(ready)}, "w").write("1")`,
      'time.sleep(30)',
    ].join('\n'));
    const child = spawn('python3', [holder], { env: fix.env });
    try {
      for (let i = 0; i < 100 && !existsSync(ready); i++) await new Promise(r => setTimeout(r, 50));
      expect(existsSync(ready)).toBe(true);
      const payload = { ...base(sid), step_id: step, phase: 'tests', decision: 'RUN', reason: 'required' };
      const busy = metrics(fix.env, 'decision', payload, repo).envelope;
      expect(busy).toMatchObject({ status: 'unavailable', reason: 'lock-busy' });
      expect(ledgerLines(fix, sid)).toHaveLength(1);
      child.kill('SIGKILL');
      await new Promise(r => child.on('close', r));
      expect(metrics(fix.env, 'decision', payload, repo).envelope.status).toBe('recorded');
    } finally {
      child.kill('SIGKILL');
    }
  }, 60_000);
  test('parallel writers and readers: every envelope parses, no torn records', async () => {
    const { fix, repo, sid, step } = boundFixture();
    const payloads = Array.from({ length: 8 }, () => ({ ...base(sid), step_id: step, phase: 'tests', decision: 'RUN', reason: 'required' }));
    const results = await Promise.all(payloads.map(p => new Promise<any>((resolve, reject) => {
      const stdin = openFifoStdin();
      const child = spawn(HELPER_BIN, ['metrics', 'decision'], {
        env: fix.env,
        cwd: repo,
        stdio: [stdin.readFd, 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout!.on('data', d => { out += d; });
      child.on('error', err => {
        stdin.dispose();
        reject(err);
      });
      child.on('close', () => {
        stdin.dispose();
        resolve(JSON.parse(out));
      });
      stdin.write(JSON.stringify(p));
      stdin.end();
    })));
    const recorded = results.filter(r => r.status === 'recorded').length;
    expect(results.every(r => ['recorded', 'unavailable'].includes(r.status))).toBe(true);
    expect(recorded).toBeGreaterThanOrEqual(1);
    expect(ledgerLines(fix, sid)).toHaveLength(1 + recorded);
    const data = read(fix, sid).envelope.data;
    expect(data.malformed_records).toBe(0);
    expect(data.partial_tail).toBe(false);
  }, 60_000);
});

describe('E5/E13 partial snapshots and capacity', () => {
  test('torn tail blocks appends, targeted read is unknown, valid prefix still summarised as partial', () => {
    const fix = makeTelemetryFixture('community');
    const repo = gitRepo(fix);
    const sid = start(fix, repo);
    const { payload } = beginRun(fix, repo, sid);
    const file = ledgerFile(fix, sid);
    writeFileSync(file, readFileSync(file, 'utf8') + '{"v":1,"op":"dec');
    const append = metrics(fix.env, 'decision', { ...base(sid), step_id: u(), phase: 'tests', decision: 'RUN', reason: 'required' }, repo).envelope;
    expect(append).toMatchObject({ status: 'partial', reason: 'partial-tail' });
    const targeted = read(fix, sid, u()).envelope;
    expect(targeted.status).toBe('partial');
    expect(targeted.data.event.status).toBe('unknown');
    expect(targeted.data.partial_tail).toBe(true);
    expect(targeted.data.records).toBe(1);
    // replay of the exact bound event still resolves from the valid prefix without appending
    expect(metrics(fix.env, 'begin', payload, repo).envelope.status).toBe('replayed');
    expect(read(fix, sid, payload.event_id).envelope.data.event.status).toBe('match');
  }, 30_000);
  test('malformed complete line and unknown version: partial, no repair, no complete claim', () => {
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u();
    const file = craft(fix, sid, runRows(sid).rows);
    writeFileSync(file, readFileSync(file, 'utf8') + '{"v":2,"op":"begin"}\nnot-json\n');
    const envelope = read(fix, sid).envelope;
    expect(envelope.status).toBe('partial');
    expect(envelope.data.malformed_records).toBe(2);
    expect(envelope.data.capture).toBe('partial');
    // An unreadable line may have been any pass, correction or fix record.
    expect(envelope.data).toMatchObject({ local_passes: null, greptile_passes: null, fix_cycles: null, excluded_na_voices: null });
    expect(Object.values(envelope.data.corrections).every(v => v === null)).toBe(true);
    const repo = gitRepo(fix);
    const append = metrics(fix.env, 'decision', { ...base(sid), step_id: u(), phase: 'tests', decision: 'RUN', reason: 'required' }, repo).envelope;
    expect(append).toMatchObject({ status: 'partial', reason: 'malformed-record' });
    expect(readFileSync(file, 'utf8')).toContain('not-json'); // untouched
  }, 30_000);
  test('4096-record cap refuses the next append; an oversized file reads partial', () => {
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u();
    const rows: any[] = [...runRows(sid).rows];
    for (let i = 0; i < 4095; i++) rows.push({ op: 'decision', at: 2000 + i, request: { ...base(sid), step_id: u(), phase: 'tests', decision: 'RUN', reason: 'required' } });
    const file = craft(fix, sid, rows);
    const data = read(fix, sid).envelope.data;
    expect(data.records).toBe(4096);
    const repo = gitRepo(fix);
    const append = metrics(fix.env, 'decision', { ...base(sid), step_id: u(), phase: 'tests', decision: 'RUN', reason: 'required' }, repo).envelope;
    expect(append).toMatchObject({ status: 'unavailable', reason: 'capacity' });
    // Newline-terminated junk: only the 8 MiB read cap turns this into partial-tail; without the
    // cap the junk would read as one malformed line instead.
    writeFileSync(file, readFileSync(file, 'utf8') + 'x'.repeat(8 * 1024 * 1024) + '\n');
    const over = read(fix, sid).envelope;
    expect(over).toMatchObject({ status: 'partial', reason: 'partial-tail' });
    expect(over.data.malformed_records).toBe(0);
    expect(over.data.records).toBe(4096);
  }, 120_000);
  test('256 findings in one crafted attempt read back exactly', () => {
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u();
    const many = Array.from({ length: 256 }, (_, i) => finding('F' + i));
    craft(fix, sid, [...runRows(sid).rows, ...passRows(sid, { voices: [{ voice: 'core', findings: many }] }).rows]);
    expect(read(fix, sid).envelope.data.findings).toMatchObject({ accepted: 256, open: 256 });
  }, 30_000);
});

describe('E6/E7 confirmation, crash boundary and one identical replay (injected faults)', () => {
  test('fsync failure is unconfirmed; the same ID replays without duplicating once healthy', () => {
    const fix = makeTelemetryFixture('community');
    const repo = gitRepo(fix);
    const sid = start(fix, repo);
    const payload = { ...base(sid), step_id: u(), parent_step_id: null, kind: 'run', phase: 'run', context: CTX };
    const failing = patched(fix, 'fsync-fail', [
      'orig = os.fsync',
      'os.fsync = lambda fd: (_ for _ in ()).throw(OSError("injected"))',
    ], 'begin', payload, repo);
    expect(JSON.parse(failing.stdout)).toMatchObject({ status: 'unconfirmed', reason: 'io-error' });
    expect(failing.stdout + failing.stderr).not.toContain('injected');
    // the record may be visible; targeted read + exactly one identical replay reconciles it
    const linesBefore = ledgerLines(fix, sid).length;
    expect(linesBefore).toBe(1);
    expect(read(fix, sid, payload.event_id).envelope.data.event.status).toBe('match');
    expect(metrics(fix.env, 'begin', payload, repo).envelope.status).toBe('replayed');
    expect(ledgerLines(fix, sid)).toHaveLength(1);
  }, 30_000);
  test('short write is unconfirmed and later appends refuse to write behind torn bytes', () => {
    const fix = makeTelemetryFixture('community');
    const repo = gitRepo(fix);
    const sid = start(fix, repo);
    const payload = { ...base(sid), step_id: u(), parent_step_id: null, kind: 'run', phase: 'run', context: CTX };
    const short = patched(fix, 'short-write', [
      'orig = os.write',
      'def half(fd, data):\n    n = max(1, len(data)//2)\n    orig(fd, data[:n])\n    return n',
      'os.write = half',
    ], 'begin', payload, repo);
    expect(JSON.parse(short.stdout)).toMatchObject({ status: 'unconfirmed', reason: 'io-error' });
    const next = metrics(fix.env, 'begin', payload, repo).envelope;
    expect(next.status).toBe('partial');
  }, 30_000);
  test('process loss after append leaves no envelope; read then one replay stays single', () => {
    const fix = makeTelemetryFixture('community');
    const repo = gitRepo(fix);
    const sid = start(fix, repo);
    const payload = { ...base(sid), step_id: u(), parent_step_id: null, kind: 'run', phase: 'run', context: CTX };
    const lost = patched(fix, 'crash', ['m._confirm = lambda paths, fd=None: os._exit(3)'], 'begin', payload, repo);
    expect(lost.status).not.toBe(0);
    expect(lost.stdout).toBe(''); // no envelope: callers must treat capture as unknown, never success
    expect(ledgerLines(fix, sid)).toHaveLength(1);
    expect(read(fix, sid, payload.event_id).envelope.data.event.status).toBe('match');
    expect(metrics(fix.env, 'begin', payload, repo).envelope.status).toBe('replayed');
    expect(ledgerLines(fix, sid)).toHaveLength(1);
  }, 30_000);
  test('unexpected failures carry only a sanitized trace (basename, line, class)', () => {
    const fix = makeTelemetryFixture('community');
    const repo = gitRepo(fix);
    const sid = start(fix, repo);
    const payload = { ...base(sid), step_id: u(), parent_step_id: null, kind: 'run', phase: 'run', context: CTX };
    const boom = patched(fix, 'boom', [
      'def explode(op, req):\n    raise RuntimeError("secret-detail-xyz")',
      'm.mutate = explode',
    ], 'begin', payload, repo);
    const envelope = JSON.parse(boom.stdout);
    expect(envelope).toMatchObject({ status: 'unavailable', reason: 'io-error' });
    expect(envelope.diagnostics.trace.exception_class).toBe('RuntimeError');
    expect(envelope.diagnostics.trace.file).not.toContain('/');
    expect(boom.stdout + boom.stderr).not.toContain('secret-detail-xyz');
  }, 30_000);
});

describe('E8/E9/E15 entity cardinality, correction graph, interrupted capture', () => {
  test('duplicate step ends count once with unknown duration; repeated phase uses fresh steps', () => {
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u();
    const step = u(), again = u();
    craft(fix, sid, [...runRows(sid, 0).rows,
      { op: 'begin', at: 100, request: { ...base(sid), step_id: step, parent_step_id: null, kind: 'phase', phase: 'tests' } },
      { op: 'end', at: 160, request: { ...base(sid), step_id: step, outcome: 'completed' } },
      { op: 'end', at: 170, request: { ...base(sid), step_id: step, outcome: 'completed' } },
      { op: 'begin', at: 200, request: { ...base(sid), step_id: again, parent_step_id: null, kind: 'phase', phase: 'tests' } },
      { op: 'end', at: 240, request: { ...base(sid), step_id: again, outcome: 'completed' } },
    ]);
    const data = read(fix, sid).envelope.data;
    const tests = data.phases.find((p: any) => p.phase === 'tests');
    expect(tests.steps_started).toBe(2);
    expect(tests.steps_completed).toBe(2);
    expect(tests.observed_wall_duration_ms).toBeNull();
    expect(data.unknown_reasons).toContain('conflicting-terminal');
  }, 30_000);
  test('superseding a voice selection works once; competing corrections and cross-candidate are unknown', () => {
    const fix = makeTelemetryFixture('community');
    const build = (competing: boolean, crossCandidate = false) => {
      const sid = 'extend-' + u();
      const passId = u(), a1 = u(), a2 = u();
      const voiceComplete = { op: 'pass', at: 2040, request: { ...base(sid), pass_id: passId, scope: 'local', state: 'voice-complete', voice_id: 'core', voice_status: 'completed', selected_attempt_id: a1 } };
      const supersede = (at: number, selected: string) => ({
        op: 'correction', at, request: { ...base(sid), correction_kind: 'fallback', attempt_id: selected, pass_id: passId, voice_id: 'core', supersedes_event_id: voiceComplete.request.event_id, selected_attempt_id: selected },
      });
      const attemptRow = (id: string, at: number, findings: any[], ctx?: any) => ({
        op: 'pass', at, request: { ...base(sid), pass_id: passId, scope: 'local', state: 'attempt', voice_id: 'core', attempt_id: id, predecessor_attempt_id: null, attempt_outcome: 'completed', findings, ...(ctx ? { context: ctx } : {}) },
      });
      craft(fix, sid, [...runRows(sid).rows,
        { op: 'pass', at: 2000, request: { ...base(sid), pass_id: passId, scope: 'local', state: 'started', required_voice_ids: ['core'] } },
        attemptRow(a1, 2010, [finding('OLD')]),
        attemptRow(a2, 2020, [finding('NEW'), finding('NEW2')], crossCandidate ? { candidate_head: '9'.repeat(40) } : undefined),
        voiceComplete, supersede(2050, a2), ...(competing ? [supersede(2060, a1)] : []),
        { op: 'pass', at: 2070, request: { ...base(sid), pass_id: passId, scope: 'local', state: 'completed' } },
      ]);
      return read(fix, sid).envelope.data;
    };
    expect(build(false).findings).toMatchObject({ accepted: 2 });
    const competing = build(true);
    expect(competing.findings).toBeNull();
    expect(competing.unknown_reasons).toContain('competing-correction');
    const cross = build(false, true);
    expect(cross.findings).toBeNull();
    expect(cross.unknown_reasons).toContain('cross-candidate');
  }, 30_000);
  test('missing begin stays unknown; an open run receipt still states its capture status', () => {
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u();
    craft(fix, sid, [...runRows(sid).rows,
      { op: 'end', at: 500, request: { ...base(sid), step_id: u(), outcome: 'paused' } }]);
    const data = read(fix, sid).envelope.data;
    expect(data.unknown_reasons).toContain('missing-begin');
    expect(data.receipt_text).toContain('capture=partial');
    const sid2 = 'extend-' + u();
    craft(fix, sid2, runRows(sid2).rows);
    const open = read(fix, sid2).envelope.data;
    expect(open.receipt_text).toContain('capture=');
    expect(open.receipt_text.length).toBeLessThanOrEqual(2048);
    expect(open.findings).toBeNull(); // no pass ran: unknown, never zero
    expect(open.local_passes).toBe(0);
  }, 30_000);
});

describe('C7 installed copies resolve the adjacent module under -I', () => {
  test('copied install through a symlinked launcher; a planted cwd module is never imported', () => {
    const fix = makeTelemetryFixture('community');
    const install = join(fix.home, 'install');
    cpSync(join(ROOT, 'bin'), join(install, 'bin'), { recursive: true });
    cpSync(join(ROOT, 'VERSION'), join(install, 'VERSION'));
    const linkDir = join(fix.home, 'path-bin');
    mkdirSync(linkDir);
    symlinkSync(join(install, 'bin/gstack-extend-telemetry'), join(linkDir, 'gstack-extend-telemetry'));
    const launcher = join(linkDir, 'gstack-extend-telemetry');
    const repo = gitRepo(fix);
    writeFileSync(join(repo, 'workflow_metrics.py'), 'print("PLANTED")\nraise SystemExit(9)\n');
    writeFileSync(join(repo, 'telemetry_usage.py'), 'print("PLANTED")\nraise SystemExit(9)\n');
    mkdirSync(join(repo, 'quota'), { recursive: true });
    writeFileSync(join(repo, 'quota/__init__.py'), 'print("PLANTED")\nraise SystemExit(9)\n');
    const env = { ...fix.env, PYTHONPATH: '.' };
    const started = spawnSync(launcher, ['start', '--skill', 'extend:ship-and-land'], { env, cwd: repo, encoding: 'utf8', timeout: 15_000 });
    const sid = /session=(extend-[0-9a-f-]{36})/.exec(started.stdout)?.[1]!;
    const began = spawnSync(launcher, ['metrics', 'begin'], {
      env, cwd: repo, encoding: 'utf8', timeout: 15_000,
      input: JSON.stringify({ ...base(sid, 'ship-and-land'), step_id: u(), parent_step_id: null, kind: 'run', phase: 'run', context: CTX }),
    });
    expect(began.stdout + began.stderr).not.toContain('PLANTED');
    expect(JSON.parse(began.stdout).status).toBe('recorded');
    const finished = spawnSync(launcher, ['finish', '--skill', 'extend:ship-and-land', '--outcome', 'success'], { env, cwd: repo, encoding: 'utf8', timeout: 15_000 });
    expect(finished.status).toBe(0);
    expect(finished.stdout + finished.stderr).not.toContain('PLANTED');
    const readBack = spawnSync(launcher, ['metrics', 'read', '--session-id', sid], { env, cwd: repo, encoding: 'utf8', timeout: 15_000 });
    expect(JSON.parse(readBack.stdout).data.stage).toBe('ship-and-land');
    expect(existsSync(join(install, 'bin/lib/workflow_metrics.py'))).toBe(true);
    expect(existsSync(join(install, 'bin/lib/telemetry_usage.py'))).toBe(true);
  }, 30_000);
  test('a stalled git lookup bounds the first bind instead of waiting', () => {
    const fix = makeTelemetryFixture('community');
    const repo = gitRepo(fix);
    const sid = start(fix, repo);
    const shimBin = join(fix.home, 'slow-bin');
    mkdirSync(shimBin);
    writeFileSync(join(shimBin, 'git'), '#!/bin/sh\nsleep 5\n');
    chmodSync(join(shimBin, 'git'), 0o755);
    const t0 = Date.now();
    const { envelope } = metrics({ ...fix.env, PATH: shimBin + ':' + fix.env.PATH }, 'begin',
      { ...base(sid), step_id: u(), parent_step_id: null, kind: 'run', phase: 'run', context: CTX }, repo);
    expect(envelope).toMatchObject({ status: 'unavailable', reason: 'ambiguous-binding' });
    expect(Date.now() - t0).toBeLessThan(4000); // gstack-timing-ok: a 5 s git stall must be cut by the bounded lookup
    expect(existsSync(ledgerFile(fix, sid))).toBe(false);
  }, 30_000);
  test('parent invocation identity is explicit or null, and candidates round-trip', () => {
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u(), parent = 'extend-' + u();
    const run = runRows(sid);
    run.rows[0].request.context = { ...CTX, parent_session_id: parent };
    craft(fix, sid, run.rows);
    const data = read(fix, sid).envelope.data;
    expect(data.run.parent_session_id).toBe(parent);
    expect(data.run.candidate).toMatchObject({ candidate_head: HEAD, candidate_tree: TREE, candidate_base: BASE, binding: 'clean' });
  }, 30_000);
  test('the unchanged launcher carries no metrics knowledge', () => {
    const launcher = readFileSync(join(ROOT, 'bin/gstack-extend-telemetry'), 'utf8');
    expect(launcher).not.toContain('metrics');
    expect(launcher).toContain('telemetry-protocol: start-finish-v1');
  });
});

// Review-and-prep fixes (2026-10-19): reader semantics the approved contract requires.
describe('review fixes: finding corrections, duplicates and decisions', () => {
  const twoVoices = (sid: string) => passRows(sid, { voices: [{ voice: 'core', findings: [finding('F1')] }, { voice: 'adv', findings: [finding('F1')] }] });
  const corr = (sid: string, at: number, patch: Record<string, unknown>) => ({ op: 'correction', at, request: { ...base(sid), correction_kind: 'finding', finding_id: 'F1', ...patch } });
  test('a linear chain applies, adjudication corrections move findings; competing heads and unqualified targets stay unknown', () => {
    const fix = makeTelemetryFixture('community');
    const build = (rows: (sid: string, p: ReturnType<typeof passRows>) => any[], voices = 'one') => {
      const sid = 'extend-' + u();
      const p = voices === 'one' ? passRows(sid, { voices: [{ voice: 'core', findings: [finding('F1')] }] }) : twoVoices(sid);
      craft(fix, sid, [...runRows(sid).rows, ...p.rows, ...rows(sid, p)]);
      return read(fix, sid).envelope;
    };
    // Value: protects=EN2 one-chain supersession; fails_when=a correction that skips its predecessor still applies; why_new=only voice selections were covered; seam=none; no_claim=producer intent
    const chain = build((sid) => { const c1 = corr(sid, 2100, { resolution: 'fixed' }); return [c1, corr(sid, 2110, { resolution: 'open', supersedes_event_id: c1.request.event_id })]; });
    expect(chain.data.findings).toMatchObject({ accepted: 1, fixed: 0, open: 1 });
    const competing = build((sid) => { const c1 = corr(sid, 2100, { resolution: 'fixed' }); return [c1,
      corr(sid, 2110, { resolution: 'open', supersedes_event_id: c1.request.event_id }),
      corr(sid, 2120, { resolution: 'fixed', supersedes_event_id: c1.request.event_id })]; });
    expect(competing.data.findings.accepted).toBeNull();
    expect(competing.data.unknown_reasons).toContain('competing-correction');
    expect(competing).toMatchObject({ status: 'partial' });
    // Two voices both number a finding F1: a fully qualified correction hits one; a bare finding_id is ambiguous.
    const qualified = build((sid, p) => [corr(sid, 2100, { resolution: 'fixed', pass_id: p.passId, voice_id: 'adv', attempt_id: p.attempts.adv })], 'two');
    expect(qualified.data.findings).toMatchObject({ accepted: 2, fixed: 1, open: 1 });
    const bare = build((sid) => [corr(sid, 2100, { resolution: 'fixed' })], 'two');
    expect(bare.data.findings.accepted).toBeNull();
    // Coverage audit (/ship Step 7, 2026-10-19).
    // Value: protects=a finding correction that changes adjudication moves the finding out of accepted/open into its new bucket;
    //   fails_when=only resolution corrections apply and a triage reclassification is ignored; why_new=every correction above changes resolution only;
    //   seam=none; no_claim=producer triage accuracy
    const deferred = build((sid) => [corr(sid, 2100, { adjudication: 'deferred' })]);
    expect(deferred).toMatchObject({ status: 'ok', data: { findings: { accepted: 0, deferred: 1, open: 0 } } });
    const rejected = build((sid) => [corr(sid, 2100, { adjudication: 'rejected' })]);
    expect(rejected).toMatchObject({ status: 'ok', data: { findings: { accepted: 0, rejected: 1, open: 0, fixed: 0 } } });
    // Two corrections on different findings may each supersede their shared attempt event.
    const siblings = (() => {
      const sid = 'extend-' + u();
      const p = passRows(sid, { voices: [{ voice: 'core', findings: [finding('F1'), finding('F2')] }] });
      const attemptEvent = p.rows.find((r: any) => r.request.state === 'attempt').request.event_id;
      craft(fix, sid, [...runRows(sid).rows, ...p.rows,
        { op: 'correction', at: 2100, request: { ...base(sid), correction_kind: 'finding', finding_id: 'F1', resolution: 'fixed', supersedes_event_id: attemptEvent } },
        { op: 'correction', at: 2110, request: { ...base(sid), correction_kind: 'finding', finding_id: 'F2', resolution: 'fixed', supersedes_event_id: attemptEvent } }]);
      return read(fix, sid).envelope;
    })();
    expect(siblings).toMatchObject({ status: 'ok', data: { findings: { accepted: 2, fixed: 2, open: 0 } } });
  }, 60_000);
  test('a correction resolves once across local and Greptile findings; zero or two matches stay unknown', () => {
    const fix = makeTelemetryFixture('community');
    const build = (patch: Record<string, unknown>) => {
      const sid = 'extend-' + u();
      const local = passRows(sid, { voices: [{ voice: 'core', findings: [finding('F1')] }] });
      const grep = passRows(sid, { scope: 'greptile', at: 3000, voices: [{ voice: 'greptile', findings: [finding('F1')] }] });
      craft(fix, sid, [...runRows(sid).rows, ...local.rows, ...grep.rows,
        { op: 'correction', at: 4000, request: { ...base(sid), correction_kind: 'finding', finding_id: 'F1', resolution: 'fixed', ...patch } }]);
      return { data: read(fix, sid).envelope.data, grep };
    };
    const shared = build({});
    expect(shared.data.findings.fixed).toBeNull();
    expect(shared.data.greptile_findings.fixed).toBeNull();
    expect(shared.data.unknown_reasons).toContain('competing-correction');
    const missing = build({ finding_id: 'F9' });
    expect(missing.data.findings.fixed).toBeNull();
    expect(missing.data.unknown_reasons).toContain('missing-reference');
    const sid = 'extend-' + u();
    const local = passRows(sid, { voices: [{ voice: 'core', findings: [finding('F1')] }] });
    const grep = passRows(sid, { scope: 'greptile', at: 3000, voices: [{ voice: 'greptile', findings: [finding('F1')] }] });
    craft(fix, sid, [...runRows(sid).rows, ...local.rows, ...grep.rows,
      { op: 'correction', at: 4000, request: { ...base(sid), correction_kind: 'finding', finding_id: 'F1', resolution: 'fixed', pass_id: grep.passId } }]);
    const targeted = read(fix, sid).envelope.data;
    expect(targeted.findings).toMatchObject({ fixed: 0, open: 1 });
    expect(targeted.greptile_findings).toMatchObject({ fixed: 1, open: 0 });
  }, 60_000);
  test('a duplicate claim by correction is rejected at intake; duplicates live on the finding', () => {
    const fix = makeTelemetryFixture('community');
    const repo = gitRepo(fix);
    const sid = start(fix, repo);
    beginRun(fix, repo, sid);
    const dup = metrics(fix.env, 'correction', { ...base(sid), correction_kind: 'finding', finding_id: 'F1', adjudication: 'duplicate' }, repo).envelope;
    expect(dup).toMatchObject({ status: 'unavailable', reason: 'invalid-input', diagnostics: { field: 'adjudication' } });
    expect(ledgerLines(fix, sid)).toHaveLength(1);
  }, 30_000);
  test('a correction to a finding of an unclosed pass is neither missing nor a broken record', () => {
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u();
    const p = passRows(sid, { voices: [{ voice: 'core', findings: [finding('F1')] }, { voice: 'adv', outcome: 'failed' }] });
    craft(fix, sid, [...runRows(sid).rows, ...p.rows,
      corr(sid, 2100, { resolution: 'fixed', pass_id: p.passId, voice_id: 'core', attempt_id: p.attempts.core })]);
    const envelope = read(fix, sid).envelope;
    expect(envelope.status).toBe('ok');
    expect(envelope.data.unknown_reasons).not.toContain('missing-reference');
    expect(envelope.data.unknown_reasons).toContain('incomplete-pass');
    expect(envelope.data.findings).toBeNull();
  }, 30_000);
  test('a fix step closed inconsistently or declared with mixed kinds makes fix_cycles unknown', () => {
    const fix = makeTelemetryFixture('community');
    const build = (rows: (sid: string, step: string) => any[]) => {
      const sid = 'extend-' + u(), step = u();
      craft(fix, sid, [...runRows(sid, 0).rows, ...rows(sid, step)]);
      return read(fix, sid).envelope.data;
    };
    const twoEnds = build((sid, step) => [
      { op: 'begin', at: 10, request: { ...base(sid), step_id: step, parent_step_id: null, kind: 'fix', phase: 'fix' } },
      { op: 'end', at: 20, request: { ...base(sid), step_id: step, outcome: 'failed' } },
      { op: 'end', at: 30, request: { ...base(sid), step_id: step, outcome: 'completed' } }]);
    expect(twoEnds.fix_cycles).toBeNull();
    const mixedKinds = build((sid, step) => [
      { op: 'begin', at: 10, request: { ...base(sid), step_id: step, parent_step_id: null, kind: 'fix', phase: 'fix' } },
      { op: 'begin', at: 11, request: { ...base(sid), step_id: step, parent_step_id: null, kind: 'phase', phase: 'fix' } },
      { op: 'end', at: 20, request: { ...base(sid), step_id: step, outcome: 'completed' } }]);
    expect(mixedKinds.fix_cycles).toBeNull();
  }, 30_000);
  test('a duplicate_of naming no finding in the run leaves totals unknown', () => {
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u();
    craft(fix, sid, [...runRows(sid).rows, ...passRows(sid, { voices: [{ voice: 'core', findings: [
      finding('F1'), finding('F2', { adjudication: 'duplicate', resolution: 'unknown', duplicate_of: 'NOPE' })] }] }).rows]);
    const data = read(fix, sid).envelope.data;
    expect(data.findings.accepted).toBeNull();
    expect(data.unknown_reasons).toContain('missing-reference');
  }, 30_000);
  test('decisions count once per step and phase; differing choices count as none; fix cycles read back', () => {
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u();
    const reuseStep = u(), conflictStep = u();
    const fixStep = (id: string, at: number, outcome: string) => [
      { op: 'begin', at, request: { ...base(sid), step_id: id, parent_step_id: null, kind: 'fix', phase: 'fix' } },
      { op: 'end', at: at + 10, request: { ...base(sid), step_id: id, outcome } },
    ];
    craft(fix, sid, [...runRows(sid, 0).rows,
      { op: 'decision', at: 50, request: { ...base(sid), step_id: reuseStep, phase: 'tests', decision: 'REUSE', reason: 'matching-evidence' } },
      { op: 'decision', at: 51, request: { ...base(sid), step_id: reuseStep, phase: 'tests', decision: 'REUSE', reason: 'matching-evidence' } },
      { op: 'decision', at: 60, request: { ...base(sid), step_id: u(), phase: 'coverage', decision: 'N/A', reason: 'not-applicable' } },
      { op: 'decision', at: 70, request: { ...base(sid), step_id: conflictStep, phase: 'documentation', decision: 'RUN', reason: 'required' } },
      { op: 'decision', at: 71, request: { ...base(sid), step_id: conflictStep, phase: 'documentation', decision: 'REUSE', reason: 'matching-evidence' } },
      ...fixStep(u(), 100, 'completed'), ...fixStep(u(), 200, 'completed'), ...fixStep(u(), 300, 'failed')]);
    const envelope = read(fix, sid).envelope;
    const phase = (p: string) => envelope.data.phases.find((x: any) => x.phase === p);
    expect(phase('tests').decisions).toEqual({ RUN: 0, REUSE: 1, 'N/A': 0 });
    expect(phase('tests').observed_wall_duration_ms).toBeNull();
    expect(phase('coverage').decisions['N/A']).toBe(1);
    expect(phase('documentation').decisions).toEqual({ RUN: 0, REUSE: 0, 'N/A': 0 });
    expect(envelope.data.unknown_reasons).toContain('conflicting-terminal');
    expect(envelope.data.fix_cycles).toBe(2);
    const sid2 = 'extend-' + u();
    craft(fix, sid2, [...runRows(sid2, 0).rows,
      { op: 'correction', at: 300, request: { ...base(sid2), correction_kind: 'fix-cycle', fix_step_id: u() } }]);
    const d2 = read(fix, sid2).envelope.data;
    expect(d2.fix_cycles).toBeNull();
    expect(d2.unknown_reasons).toContain('missing-reference');
  }, 30_000);
});

describe('review fixes: unknown is never zero, pauses stay open, candidates inherit', () => {
  test('a paused wait has unknown duration and is left out of the union; the run still reads ok', () => {
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u();
    const run = runRows(sid, 0), wait = u();
    craft(fix, sid, [...run.rows,
      { op: 'begin', at: 300, request: { ...base(sid), step_id: wait, parent_step_id: run.step, kind: 'wait', wait_category: 'human' } },
      { op: 'end', at: 360, request: { ...base(sid), step_id: wait, outcome: 'paused' } }]);
    const envelope = read(fix, sid).envelope;
    expect(envelope.status).toBe('ok');
    expect(envelope.data.waits).toEqual([{ wait_category: 'human', count: 1, observed_wall_duration_ms: null, unknown_durations: 1 }]);
    expect(envelope.data.union_observed_wall_ms).toBeNull();
    expect(envelope.data.unknown_reasons).toEqual(expect.arrayContaining(['open-wait', 'missing-end']));
    expect(envelope.data.receipt_text).toContain('capture=ok');
  }, 30_000);
  test('broken references and event conflicts make the read partial; an open run does not', () => {
    const fix = makeTelemetryFixture('community');
    const orphanSid = 'extend-' + u();
    craft(fix, orphanSid, [...runRows(orphanSid, 0).rows,
      { op: 'begin', at: 10, request: { ...base(orphanSid), step_id: u(), parent_step_id: u(), kind: 'phase', phase: 'tests' } }]);
    expect(read(fix, orphanSid).envelope).toMatchObject({ status: 'partial', reason: 'malformed-record', data: { capture: 'partial' } });
    const conflictSid = 'extend-' + u();
    const same = u();
    craft(fix, conflictSid, [...runRows(conflictSid, 0).rows,
      { op: 'decision', at: 10, request: { ...base(conflictSid), event_id: same, step_id: u(), phase: 'tests', decision: 'RUN', reason: 'required' } },
      { op: 'decision', at: 11, request: { ...base(conflictSid), event_id: same, step_id: u(), phase: 'tests', decision: 'REUSE', reason: 'matching-evidence' } }]);
    expect(read(fix, conflictSid).envelope).toMatchObject({ status: 'partial', reason: 'event-conflict' });
    const openSid = 'extend-' + u();
    craft(fix, openSid, runRows(openSid, 0).rows);
    expect(read(fix, openSid).envelope).toMatchObject({ status: 'ok', reason: null });
  }, 30_000);
  test('orphaned pass records and review work with no pass or fix records read unknown, never zero', () => {
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u();
    const g = passRows(sid, { scope: 'greptile', at: 3000, voices: [{ voice: 'greptile', findings: [] }] });
    craft(fix, sid, [...runRows(sid, 0).rows, ...g.rows.filter((r: any) => r.request.state !== 'started')]);
    const orphan = read(fix, sid).envelope.data;
    expect(orphan.greptile_passes).toBeNull();
    expect(orphan.greptile_attempted).toBeNull();
    expect(orphan.local_passes).toBe(0);
    expect(orphan.receipt_text).toContain('greptile_passes=unknown');
    const sid2 = 'extend-' + u();
    craft(fix, sid2, [...runRows(sid2, 0).rows,
      { op: 'decision', at: 10, request: { ...base(sid2), step_id: u(), phase: 'local-pass', decision: 'RUN', reason: 'required' } },
      { op: 'decision', at: 20, request: { ...base(sid2), step_id: u(), phase: 'fix', decision: 'RUN', reason: 'required' } }]);
    const phaseOnly = read(fix, sid2).envelope.data;
    expect(phaseOnly.local_passes).toBeNull();
    expect(phaseOnly.fix_cycles).toBeNull();
    expect(phaseOnly.receipt_text).toContain('local_passes=unknown');
    expect(phaseOnly.unknown_reasons).toContain('unrecorded-work'); // the receipt names why
    expect(phaseOnly.receipt_text).not.toContain('unknown=none');
  }, 30_000);
  test('attempts inherit the pass candidate and ends inherit the begin; only an explicit change is mixed', () => {
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u();
    const fixed = { candidate_head: 'e'.repeat(40), candidate_tree: 'f'.repeat(40) };
    const p = passRows(sid, { voices: [{ voice: 'core', findings: [finding('F1')] }] });
    p.rows[0].request.context = fixed; // pass 2 after a fix commit declares the new candidate once
    const same = u(), moved = u();
    craft(fix, sid, [...runRows(sid, 0).rows, ...p.rows,
      { op: 'begin', at: 10, request: { ...base(sid), step_id: same, parent_step_id: null, kind: 'phase', phase: 'tests', context: fixed } },
      { op: 'end', at: 20, request: { ...base(sid), step_id: same, outcome: 'completed' } },
      { op: 'begin', at: 30, request: { ...base(sid), step_id: moved, parent_step_id: null, kind: 'phase', phase: 'tests' } },
      { op: 'end', at: 40, request: { ...base(sid), step_id: moved, outcome: 'completed', context: fixed } }]);
    const data = read(fix, sid).envelope.data;
    expect(data.local_passes).toBe(1);
    expect(data.findings).toMatchObject({ accepted: 1, open: 1 });
    expect(data.unknown_reasons).not.toContain('cross-candidate');
    expect(data.mixed_candidate_steps).toBe(1);
  }, 30_000);
});

describe('Track 31A untimed visits: RUN decisions pair with begun steps by step_id', () => {
  const NEW = '0.51.0', OLD = '0.50.0';
  const span = (sid: string, phase: string, id: string, at: number, parent: string | null = null, outcome = 'completed') => [
    { op: 'begin', at, request: { ...base(sid), step_id: id, parent_step_id: parent, kind: 'phase', phase } },
    { op: 'end', at: at + 40, request: { ...base(sid), step_id: id, outcome } },
  ];
  const decide = (sid: string, phase: string, id: string, at: number, decision = 'RUN') =>
    ({ op: 'decision', at, request: { ...base(sid), step_id: id, phase, decision, reason: decision === 'RUN' ? 'required' : 'matching-evidence' } });
  const phaseOf = (data: any, name: string) => data.phases.find((p: any) => p.phase === name);
  const readCrafted = (rows: (sid: string, runStep: string) => any[], version: string | null) => {
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u();
    const run = runRows(sid, 0);
    craft(fix, sid, [...run.rows, ...rows(sid, run.step)], version);
    return read(fix, sid).envelope.data;
  };

  test('a RUN-only phase and a timed plus an untimed visit read unknown, never zero; REUSE-only is unchanged', () => {
    const only = readCrafted(sid => [decide(sid, 'scope', u(), 10)], NEW);
    expect(phaseOf(only, 'scope')).toEqual({ phase: 'scope', decisions: { RUN: 1, REUSE: 0, 'N/A': 0 }, steps_started: 0, steps_completed: 0, observed_wall_duration_ms: null, unknown_durations: 1 });
    expect(only.unknown_reasons).toContain('unrecorded-work');
    expect(only.receipt_text).toContain('unrecorded-work'); // the receipt's unknown= list names it
    expect(only.capture).toBe('ok');
    const timed = u();
    const mixed = readCrafted(sid => [decide(sid, 'scope', timed, 10), ...span(sid, 'scope', timed, 11), decide(sid, 'scope', u(), 100)], NEW);
    expect(phaseOf(mixed, 'scope')).toMatchObject({ decisions: { RUN: 2, REUSE: 0, 'N/A': 0 }, steps_started: 1, steps_completed: 1, observed_wall_duration_ms: null, unknown_durations: 1 });
    const reuse = readCrafted(sid => [decide(sid, 'tests', u(), 10, 'REUSE')], NEW);
    expect(phaseOf(reuse, 'tests')).toMatchObject({ steps_started: 0, observed_wall_duration_ms: null, unknown_durations: 0 });
    expect(reuse.unknown_reasons).not.toContain('unrecorded-work');
  }, 60_000);

  test('a spanned visit reads timed; a stray extra fresh-ID RUN decision beside it reads one unknown', () => {
    const step = u();
    const clean = readCrafted(sid => [decide(sid, 'coverage', step, 10), ...span(sid, 'coverage', step, 11)], NEW);
    expect(phaseOf(clean, 'coverage')).toMatchObject({ steps_started: 1, observed_wall_duration_ms: 40, unknown_durations: 0 });
    expect(clean.unknown_reasons).not.toContain('unrecorded-work');
    const stray = readCrafted(sid => [decide(sid, 'coverage', step, 10), ...span(sid, 'coverage', step, 11), decide(sid, 'coverage', u(), 60)], NEW);
    expect(phaseOf(stray, 'coverage')).toMatchObject({ decisions: { RUN: 2, REUSE: 0, 'N/A': 0 }, observed_wall_duration_ms: null, unknown_durations: 1 });
    expect(stray.unknown_reasons).toContain('unrecorded-work');
  }, 60_000);

  test('the two-visit counterexample in a new-version ledger reads one unknown', () => {
    // Visit A has a span and a dropped decision; visit B has a decision and a dropped begin.
    const data = readCrafted(sid => [...span(sid, 'documentation', u(), 11), decide(sid, 'documentation', u(), 100)], NEW);
    expect(phaseOf(data, 'documentation')).toMatchObject({ decisions: { RUN: 1, REUSE: 0, 'N/A': 0 }, steps_started: 1, observed_wall_duration_ms: null, unknown_durations: 1 });
    expect(data.unknown_reasons).toContain('unrecorded-work');
  }, 60_000);

  test('the legacy fresh-ID offset still pairs in an old-version ledger, and offsets only older records', () => {
    const legacy = readCrafted(sid => [decide(sid, 'documentation', u(), 10), ...span(sid, 'documentation', u(), 11)], OLD);
    expect(phaseOf(legacy, 'documentation')).toMatchObject({ steps_started: 1, observed_wall_duration_ms: 40, unknown_durations: 0 });
    expect(legacy.unknown_reasons).not.toContain('unrecorded-work');
    const unlabelled = readCrafted(sid => [decide(sid, 'documentation', u(), 10), ...span(sid, 'documentation', u(), 11)], '0.40.0.0');
    expect(phaseOf(unlabelled, 'documentation').unknown_durations).toBe(0); // four-part history compares padded
    // A mixed-version ledger offsets its older decision with the one step, never the newer one.
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u();
    const run = runRows(sid, 0);
    craft(fix, sid, [...run.rows, decide(sid, 'documentation', u(), 10), ...span(sid, 'documentation', u(), 11)], OLD);
    const file = ledgerFile(fix, sid);
    const newer = [decide(sid, 'documentation', u(), 200)].map(({ op, at, request }) => {
      const digest = createHash('sha256').update(canonical({ op, request })).digest('hex');
      return JSON.stringify({ v: 1, op, event_id: request.event_id, request_digest: digest, captured_at_ms: at, producer_version: NEW, request });
    });
    writeFileSync(file, readFileSync(file, 'utf8') + newer.join('\n') + '\n');
    const mixed = read(fix, sid).envelope.data;
    expect(phaseOf(mixed, 'documentation')).toMatchObject({ decisions: { RUN: 2, REUSE: 0, 'N/A': 0 }, steps_started: 1, observed_wall_duration_ms: null, unknown_durations: 1 });
    // Records with no readable producer version are older by definition.
    const none = readCrafted(sid2 => [decide(sid2, 'documentation', u(), 10), ...span(sid2, 'documentation', u(), 11)], null);
    expect(phaseOf(none, 'documentation').unknown_durations).toBe(0);
  }, 60_000);

  test('a nested same-phase step never offsets: one timed visit with a nested step plus a second untimed visit reads one unknown', () => {
    const outer = u();
    for (const version of [NEW, OLD]) {
      const data = readCrafted(sid => [decide(sid, 'triage', outer, 10), ...span(sid, 'triage', outer, 11), ...span(sid, 'triage', u(), 20, outer), decide(sid, 'triage', u(), 100)], version);
      expect(phaseOf(data, 'triage')).toMatchObject({ decisions: { RUN: 2, REUSE: 0, 'N/A': 0 }, steps_started: 2, observed_wall_duration_ms: null, unknown_durations: 1 });
      expect(data.unknown_reasons).toContain('unrecorded-work');
    }
  }, 60_000);

  test('a tests decision that carries its enclosing pregate step reads covered; a pregate step never covers another phase', () => {
    const pregate = u();
    const covered = readCrafted(sid => [decide(sid, 'pregate', pregate, 10), decide(sid, 'tests', pregate, 11), ...span(sid, 'pregate', pregate, 12)], NEW);
    expect(phaseOf(covered, 'tests')).toEqual({ phase: 'tests', decisions: { RUN: 1, REUSE: 0, 'N/A': 0 }, steps_started: 0, steps_completed: 0, observed_wall_duration_ms: null, unknown_durations: 0 });
    expect(phaseOf(covered, 'pregate')).toMatchObject({ steps_started: 1, observed_wall_duration_ms: 40, unknown_durations: 0 });
    expect(covered.unknown_reasons).not.toContain('unrecorded-work');
    const other = readCrafted(sid => [decide(sid, 'coverage', pregate, 11), ...span(sid, 'pregate', pregate, 12)], NEW);
    expect(phaseOf(other, 'coverage').unknown_durations).toBe(1);
  }, 60_000);

  test('a RUN decision carrying the run step\'s ID is never covered', () => {
    for (const version of [NEW, OLD]) {
      const data = readCrafted((sid, runStep) => [decide(sid, 'run', runStep, 10),
        { op: 'end', at: 500, request: { ...base(sid), step_id: runStep, outcome: 'completed' } }], version);
      // The closed run step has its own interval, yet the decision naming it stays untimed.
      expect(phaseOf(data, 'run')).toMatchObject({ decisions: { RUN: 1, REUSE: 0, 'N/A': 0 }, steps_started: 1, steps_completed: 1, unknown_durations: 1, observed_wall_duration_ms: null });
      expect(data.unknown_reasons).toContain('unrecorded-work');
      // An unrelated spare phase span must not rescue a decision naming the run, even in legacy ledgers.
      const spare = readCrafted((sid, runStep) => [decide(sid, 'scope', runStep, 10),
        ...span(sid, 'scope', u(), 20, runStep)], version);
      expect(phaseOf(spare, 'scope')).toMatchObject({ steps_started: 1, unknown_durations: 1, observed_wall_duration_ms: null });
      expect(spare.unknown_reasons).toContain('unrecorded-work');
    }
  }, 60_000);

  test('a pre-change ledger reads identically apart from the untimed fields', () => {
    // Fresh decision IDs everywhere, as every producer before this release wrote them.
    const rows = (sid: string) => [decide(sid, 'evidence', u(), 5), ...span(sid, 'evidence', u(), 6),
      decide(sid, 'tests', u(), 50, 'REUSE'), decide(sid, 'commit', u(), 60), decide(sid, 'commit', u(), 61)];
    const data = readCrafted(sid => rows(sid), OLD);
    expect(phaseOf(data, 'evidence')).toEqual({ phase: 'evidence', decisions: { RUN: 1, REUSE: 0, 'N/A': 0 }, steps_started: 1, steps_completed: 1, observed_wall_duration_ms: 40, unknown_durations: 0 });
    expect(phaseOf(data, 'tests')).toEqual({ phase: 'tests', decisions: { RUN: 0, REUSE: 1, 'N/A': 0 }, steps_started: 0, steps_completed: 0, observed_wall_duration_ms: null, unknown_durations: 0 });
    // Pre-change this read observed null with zero unknowns; now two untimed RUN visits are named.
    expect(phaseOf(data, 'commit')).toEqual({ phase: 'commit', decisions: { RUN: 2, REUSE: 0, 'N/A': 0 }, steps_started: 0, steps_completed: 0, observed_wall_duration_ms: null, unknown_durations: 2 });
    expect(data).toMatchObject({ capture: 'ok', records: 7, union_observed_wall_ms: 40, qualified_elapsed_ms: null, local_passes: 0, fix_cycles: 0 });
    expect(data.unknown_reasons).toEqual(['missing-end', 'unrecorded-work']); // the open run step is unchanged
  }, 60_000);
});

describe('review fixes: stdin, stored-line and confirmation edges', () => {
  test('closed stdin is invalid-input, and an inherited pipe keeps its blocking mode', () => {
    const fix = makeTelemetryFixture('community');
    const closed = spawnSync('bash', ['-c', `"${HELPER_BIN}" metrics begin <&-`], { env: fix.env, encoding: 'utf8', timeout: 15_000 });
    const envelope = JSON.parse(closed.stdout);
    expect(envelope).toMatchObject({ status: 'unavailable', reason: 'invalid-input', diagnostics: { cause: 'stdin-unavailable', trace: null } });
    const shared = spawnSync('bash', ['-c', `(sleep 1) | { "${HELPER_BIN}" metrics begin >/dev/null 2>&1; python3 -c 'import os; print(os.get_blocking(0))'; }`],
      { env: fix.env, encoding: 'utf8', timeout: 15_000 });
    expect(shared.stdout.trim()).toBe('True');
    // A closed stderr must not push the diagnostic line into stdout: stdout stays one JSON object.
    const noStderr = spawnSync('bash', ['-c', `echo '{}' | "${HELPER_BIN}" metrics begin 2>&-`], { env: fix.env, encoding: 'utf8', timeout: 15_000 });
    expect(noStderr.stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(noStderr.stdout)).toMatchObject({ reason: 'invalid-input' });
  }, 30_000);
  test('a broken stderr pipe never adds a second envelope to stdout', () => {
    const fix = makeTelemetryFixture('community');
    const repo = gitRepo(fix);
    // Through telemetry.py's dispatch, where a raised stderr write used to add a fallback envelope.
    const script = join(fix.home, 'broken-stderr.py');
    writeFileSync(script, [
      'import importlib.util, sys',
      `spec = importlib.util.spec_from_file_location("telemetry_main", ${JSON.stringify(join(ROOT, 'bin/lib/telemetry.py'))})`,
      't = importlib.util.module_from_spec(spec); spec.loader.exec_module(t)',
      'class Broken:\n    def write(self, *a):\n        raise BrokenPipeError()\n    def flush(self):\n        pass',
      'sys.stderr = Broken()',
      't.main(["metrics", "begin"])',
    ].join('\n'));
    const broken = spawnSync('python3', ['-B', '-I', script], { env: fix.env, cwd: repo, input: '{"v":1}', encoding: 'utf8', timeout: 15_000 });
    const lines = broken.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ status: 'unavailable', reason: 'invalid-input' });
  }, 30_000);
  test('a parser recursion failure is invalid-input too-deep, never an unexpected io-error', () => {
    const fix = makeTelemetryFixture('community');
    const repo = gitRepo(fix);
    const deep = patched(fix, 'recursion', ['def boom(*a, **k):\n    raise RecursionError()', 'm.json.loads = boom'], 'begin', { v: 1 }, repo);
    expect(JSON.parse(deep.stdout)).toMatchObject({ reason: 'invalid-input', diagnostics: { cause: 'too-deep', trace: null } });
  }, 30_000);
  test('a stored line whose request is not an object is malformed, not an unreadable run', () => {
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u();
    const file = craft(fix, sid, runRows(sid).rows);
    writeFileSync(file, readFileSync(file, 'utf8') + JSON.stringify({ v: 1, op: 'end', event_id: u(), request_digest: '0'.repeat(64), captured_at_ms: 1, producer_version: null, request: [] }) + '\n');
    const envelope = read(fix, sid).envelope;
    expect(envelope).toMatchObject({ status: 'partial', reason: 'malformed-record' });
    expect(envelope.data.malformed_records).toBe(1);
    expect(envelope.data.records).toBe(1);
  }, 30_000);
  test('directory-entry sync failure alone is unconfirmed; a failed replay re-confirmation appends nothing', () => {
    const fix = makeTelemetryFixture('community');
    const repo = gitRepo(fix);
    const sid = start(fix, repo);
    const payload = { ...base(sid), step_id: u(), parent_step_id: null, kind: 'run', phase: 'run', context: CTX };
    const dirOnly = ['import stat', 'orig = os.fsync',
      'def f(fd):\n    if stat.S_ISDIR(os.fstat(fd).st_mode):\n        raise OSError("injected")\n    return orig(fd)',
      'os.fsync = f'];
    expect(JSON.parse(patched(fix, 'dir-fsync', dirOnly, 'begin', payload, repo).stdout)).toMatchObject({ status: 'unconfirmed', reason: 'io-error' });
    expect(ledgerLines(fix, sid)).toHaveLength(1);
    const replay = JSON.parse(patched(fix, 'replay-fsync', dirOnly, 'begin', payload, repo).stdout);
    expect(replay).toMatchObject({ status: 'unconfirmed', reason: 'io-error', diagnostics: { cause: 'replay-confirm' } });
    expect(ledgerLines(fix, sid)).toHaveLength(1);
    expect(metrics(fix.env, 'begin', payload, repo).envelope.status).toBe('replayed');
  }, 30_000);
  test('symlinked metrics dir, lock dir and lock file are refused without writing through them', () => {
    for (const which of ['analytics/workflow-metrics', 'workflow-metrics-locks', 'lockfile'] as const) {
      const fix = makeTelemetryFixture('community');
      const repo = gitRepo(fix);
      const sid = start(fix, repo);
      const state = join(fix.home, '.gstack-extend');
      const target = join(fix.home, 'elsewhere');
      mkdirSync(target, { recursive: true });
      mkdirSync(join(state, 'analytics'), { recursive: true });
      writeFileSync(join(target, 'keep'), 'KEEP');
      if (which === 'lockfile') {
        mkdirSync(join(state, 'workflow-metrics-locks'), { recursive: true });
        symlinkSync(join(target, 'keep'), join(state, 'workflow-metrics-locks', createHash('sha256').update(sid).digest('hex') + '.lock'));
      } else symlinkSync(target, join(state, which));
      const { envelope } = metrics(fix.env, 'begin', { ...base(sid), step_id: u(), parent_step_id: null, kind: 'run', phase: 'run', context: CTX }, repo);
      expect(envelope, which).toMatchObject({ status: 'unavailable', reason: 'unsafe-path' });
      expect(readdirSync(target), which).toEqual(['keep']);
      expect(readFileSync(join(target, 'keep'), 'utf8'), which).toBe('KEEP');
    }
  }, 60_000);
  test('a real start ID is not adopted from a different checkout', () => {
    const fix = makeTelemetryFixture('community');
    const repo = gitRepo(fix), other = gitRepo(fix, 'other');
    const sid = start(fix, repo);
    const payload = () => ({ ...base(sid), step_id: u(), parent_step_id: null, kind: 'run', phase: 'run', context: CTX });
    expect(metrics(fix.env, 'begin', payload(), other).envelope).toMatchObject({ status: 'unavailable', reason: 'identity-missing' });
    expect(existsSync(ledgerFile(fix, sid))).toBe(false);
    expect(metrics(fix.env, 'begin', payload(), repo).envelope.status).toBe('recorded');
  }, 30_000);
  test('an unloadable metrics module yields the fixed unavailable envelope and leaves legacy start intact', () => {
    const fix = makeTelemetryFixture('community');
    const install = join(fix.home, 'install');
    cpSync(join(ROOT, 'bin'), join(install, 'bin'), { recursive: true });
    cpSync(join(ROOT, 'VERSION'), join(install, 'VERSION'));
    writeFileSync(join(install, 'bin/lib/workflow_metrics.py'), 'raise RuntimeError("secret-xyz")\n');
    const repo = gitRepo(fix);
    const bin = join(install, 'bin/gstack-extend-telemetry');
    const r = runRaw(fix.env, ['metrics', 'begin'], '{}', repo, bin);
    expect(r.status).toBe(0);
    const envelope = JSON.parse(r.stdout);
    expect(validEnvelope(envelope)).toBe(true);
    expect(envelope).toMatchObject({ status: 'unavailable', reason: 'io-error', diagnostics: null });
    expect(r.stdout + r.stderr).not.toContain('secret-xyz');
    expect(runRaw(fix.env, ['start', '--skill', 'extend:review-and-prep'], '', repo, bin).stdout).toMatch(/session=extend-/);
  }, 30_000);
  test('three-part producer versions are accepted for the planned release format', () => {
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u();
    const file = craft(fix, sid, runRows(sid).rows);
    writeFileSync(file, readFileSync(file, 'utf8').replace('"producer_version":"0.36.13.0"', '"producer_version":"1.0.0"'));
    const envelope = read(fix, sid).envelope;
    expect(envelope.status).toBe('ok');
    expect(envelope.data.run.producer_version).toBe('1.0.0');
  }, 30_000);
});

// Track 31A: the real-store guard in tests/helpers/telemetry-env.ts, exercised against a temporary STAND-IN store
// (never the real one). The core functions take explicit store specs; the suite-wide afterAll above runs the guard
// on the real stores for this file.
describe('Track 31A real-store guard', () => {
  const SUITE = 'tests/workflow-metrics.test.ts';
  const HELPER_MODULE = join(ROOT, 'tests/helpers/telemetry-env.ts');
  const OPTS = { suite: SUITE, home: '' };
  const sha = (text: string) => createHash('sha256').update(text).digest('hex');
  const fresh = () => `extend-${randomUUID()}`;
  const row = (id: string) => JSON.stringify({ session_id: id, stage: 'review-and-prep' }) + '\n';
  type Stand = { dir: string; extend: string; upstream: string; specs: StoreSpec[]; ledger: string; skillUsage: string; existing: string; dispose: () => void };

  function standIn(): Stand {
    const dir = mkdtempSync(join(tmpdir(), 'gx-guard-standin-'));
    const extend = join(dir, 'extend');
    const upstream = join(dir, 'upstream');
    const key = sha('repo+skill');
    const existing = fresh();
    for (const sub of ['analytics/workflow-metrics', `telemetry/${key}`, `telemetry-completed/${key}`, 'telemetry-locks', 'workflow-metrics-locks']) mkdirSync(join(extend, sub), { recursive: true });
    mkdirSync(join(upstream, 'analytics'), { recursive: true });
    const ledger = join(extend, 'analytics/stage-runs.jsonl');
    writeFileSync(ledger, row(existing) + row(fresh()));
    writeFileSync(join(extend, 'analytics/workflow-metrics', sha(existing) + '.jsonl'), row(existing));
    writeFileSync(join(extend, 'telemetry', key, sha(existing) + '.json'), JSON.stringify({ session_id: existing, root: '/work/repo' }));
    writeFileSync(join(extend, 'telemetry-completed', key, sha(existing) + '.json'), JSON.stringify({ session_id: existing, root: '/work/repo', done: [] }));
    writeFileSync(join(extend, 'telemetry-locks', key + '.lock'), '');
    const skillUsage = join(upstream, 'analytics/skill-usage.jsonl');
    writeFileSync(skillUsage, JSON.stringify({ skill: 'qa', ts: '2026-01-01T00:00:00Z' }) + '\n' + JSON.stringify({ skill: 'ship', ts: '2026-01-02T00:00:00Z' }) + '\n');
    const specs: StoreSpec[] = [
      { label: 'stand-in extend store', root: extend, kind: 'extend' },
      { label: 'stand-in upstream store', root: upstream, kind: 'upstream' },
    ];
    const dispose = () => {
      for (const root of [extend, upstream]) chmodSync(root, 0o755);
      rmSync(dir, { recursive: true, force: true });
    };
    return { dir, extend, upstream, specs, ledger, skillUsage, existing, dispose };
  }
  function withStand(body: (s: Stand) => void | Promise<void>) {
    return async () => {
      const s = standIn();
      try {
        await body(s);
      } finally {
        s.dispose();
      }
    };
  }
  const codes = (r: { findings: Array<{ code: string }> }) => r.findings.map(f => f.code).sort();
  const summaryOf = (lines: string[]) => lines[lines.length - 1]!;
  const SUMMARY = /^REAL-STORE-GUARD: (verified|unverified|failed) \(\d+ files, \d+ ms\)/;

  // Value: protects=the guard watches each inherited absolute state sink once and ignores relative overrides;
  // fails_when=a resolver variable is omitted, a relative root is accepted or canonical roots are duplicated;
  // why_new=existing guard cases supply explicit specs and spawned cases use default HOME only; seam=none;
  // no_claim=real-store contents or installed resolver precedence (temporary root discovery only).
  test('store discovery includes every absolute override, excludes relative paths and deduplicates canonical roots', withStand(s => {
    const home = join(s.dir, 'home');
    const sources = [
      ['GSTACK_EXTEND_STATE_DIR', 'extend'], ['GSTACK_STATE_ROOT', 'upstream'], ['GSTACK_STATE_DIR', 'upstream'],
      ['GSTACK_HOME', 'upstream'], ['CLAUDE_PLUGIN_DATA', 'upstream'], ['CLAUDE_PLUGIN_ROOT', 'upstream'],
    ] as const;
    const defaults: StoreSpec[] = [
      { label: '~/.gstack-extend', root: join(home, '.gstack-extend'), kind: 'extend' },
      { label: '~/.gstack', root: join(home, '.gstack'), kind: 'upstream' },
    ];
    const env = Object.fromEntries(sources.map(([name]) => [name, join(s.dir, name)]));
    // Half the roots exist; missing absolute roots must remain watched because they may appear later.
    for (const [name] of sources.slice(0, 3)) mkdirSync(env[name]!);
    expect(realStoreSpecs(env, home)).toEqual([
      ...defaults, ...sources.map(([name, kind]) => ({ label: `$${name}`, root: env[name]!, kind })),
    ]);
    for (const [name] of sources) {
      expect(realStoreSpecs({ [name]: 'relative/state' }, home), name).toEqual(defaults);
      expect(realStoreSpecs({ [name]: '' }, home), name).toEqual(defaults);
    }
    expect(realStoreSpecs({ GSTACK_EXTEND_STATE_DIR: s.extend, GSTACK_STATE_ROOT: s.extend + '/.', GSTACK_STATE_DIR: s.extend }, home))
      .toEqual([...defaults, { label: '$GSTACK_EXTEND_STATE_DIR', root: s.extend, kind: 'shared' }]);
  }), 60_000);

  // Value: protects=co-located sinks retain both ledger rewrite policies after canonical-root deduplication;
  // fails_when=an extend rewrite passes or an upstream rotation becomes a corruption failure;
  // why_new=existing discovery tests only assert path deduplication; seam=none;
  // no_claim=real-store acceptance (stand-in stores only).
  test('co-located stores fail extend rewrites while upstream rotation remains unverified', withStand(s => {
    const home = join(s.dir, 'shared-home');
    const shared = join(home, '.gstack');
    mkdirSync(join(shared, 'analytics/workflow-metrics'), { recursive: true });
    const specs = realStoreSpecs({ GSTACK_EXTEND_STATE_DIR: shared + '/.' }, home);
    expect(specs.map(spec => spec.root)).toEqual([join(home, '.gstack-extend'), shared]);
    for (const rel of ['analytics/stage-runs.jsonl', 'analytics/workflow-metrics/session.jsonl', 'analytics/skill-usage.jsonl']) {
      const file = join(shared, rel);
      writeFileSync(file, row(fresh()));
      const snap = snapshotRealStores(specs, { ...OPTS, home });
      writeFileSync(file, 'rewritten\n');
      const result = compareRealStores(snap, [], { ...OPTS, home });
      expect(result.status, rel).toBe(rel.endsWith('skill-usage.jsonl') ? 'unverified' : 'failed');
      expect(codes(result), rel).toEqual(rel.endsWith('skill-usage.jsonl') ? [] : ['prefix-rewrite']);
      expect(result.files, rel).toBe(readdirSync(join(shared, 'analytics'), { recursive: true }).filter(name => String(name).endsWith('.jsonl')).length);
    }
  }), 60_000);

  // Value: protects=large-ledger scans detect split session IDs and escaped roots only in appended bytes;
  // fails_when=chunk carry is removed or a pre-snapshot prefix is scanned as a new escaped root;
  // why_new=current planted-ID and escaped-root fixtures fit inside one read chunk; seam=none;
  // no_claim=all concurrent filesystem races (deterministic large temporary ledgers only).
  test('large-ledger scans find split IDs and escaped roots without rescanning the old prefix', withStand(s => {
    const chunk = 1024 * 1024;
    const id = fresh();
    const escaped = join(tmpdir(), 'gx-tel-chunk-fixture');
    const splitAt = (value: string, start: number, split: number) => ' '.repeat(chunk - start - split) + value + '\n';
    // The old prefix has a suspicious path but no appended bytes: it is not a fresh escape.
    const prefix = JSON.stringify({ root: escaped }) + '\n';
    writeFileSync(s.ledger, prefix);
    const snap = snapshotRealStores(s.specs, OPTS);
    expect(compareRealStores(snap, [id], OPTS).status).toBe('verified');
    appendFileSync(s.ledger, splitAt(id, Buffer.byteLength(prefix), 12));
    const leaked = compareRealStores(snap, [id], OPTS);
    expect(codes(leaked)).toEqual(['appended-id']);
    expect(leaked.findings[0]!.ids).toEqual([id]);
    expect([...harvestSessionIds(join(s.extend, 'analytics'))]).toContain(id);
    // Start with a fresh short ledger and put the root needle across the next read boundary.
    writeFileSync(s.ledger, row(s.existing));
    const rootSnap = snapshotRealStores(s.specs, OPTS);
    const rootPrefixSize = Buffer.byteLength(readFileSync(s.ledger));
    const split = Buffer.byteLength(join(tmpdir(), 'gx-tel-')) - 3;
    appendFileSync(s.ledger, splitAt(escaped, rootPrefixSize, split));
    const rooted = compareRealStores(rootSnap, [], OPTS);
    expect(codes(rooted)).toEqual(['escaped-root']);
    expect(rooted.status).toBe('failed');
  }), 60_000);

  test('a planted harvested id in an appended range fails with appended-id and a complete message', withStand(s => {
    const snap = snapshotRealStores(s.specs, OPTS);
    const id = fresh();
    appendFileSync(s.ledger, row(id));
    const r = compareRealStores(snap, [id], OPTS);
    expect(r.status).toBe('failed');
    expect(codes(r)).toEqual(['appended-id']);
    for (const line of r.lines.slice(0, -1)) expect(line).toStartWith('REAL-STORE-GUARD:appended-id ');
    const line = r.lines[0]!;
    for (const part of [
      'what: store=stand-in extend store path=stand-in extend store/analytics/stage-runs.jsonl size=', `suite=${SUITE}`, `session-id=${id}`, 'inherited-vars=',
      `fix: find the spawn in ${SUITE} that escaped isolation and run it through \`makeTelemetryFixture\` or the isolation prelude`,
      'recovery: side effects are complete; never edit, move or delete the real rows; report them to the owner and rerun after the fix',
      'docs: docs/telemetry.md#workflow-metrics-guard-appended-id',
    ]) expect(line).toContain(part);
    expect(r.lines.join('\n')).not.toContain(s.dir); // roots outside HOME print as labels, never absolute paths
    expect(summaryOf(r.lines)).toMatch(/^REAL-STORE-GUARD: failed \(\d+ files, \d+ ms\)$/);
    expect(() => assertRealStoresUntouched(snap, [id], OPTS)).toThrow('REAL-STORE-GUARD:appended-id');
    // A new file holding the id fails the same way; an id already in the pre-snapshot store is excluded.
    writeFileSync(join(s.extend, 'analytics/late.jsonl'), row(id));
    expect(codes(compareRealStores(snap, [id], OPTS))).toEqual(['appended-id', 'appended-id']);
    expect(compareRealStores(snapshotRealStores(s.specs, OPTS), [s.existing], OPTS).status).toBe('verified');
    appendFileSync(s.ledger, row(s.existing));
    expect(compareRealStores(snap, [s.existing], OPTS).findings).toEqual([]);
  }), 60_000);

  test('unrelated appended bytes and new unrelated files pass', withStand(s => {
    const snap = snapshotRealStores(s.specs, OPTS);
    appendFileSync(s.ledger, row(fresh()));
    appendFileSync(s.skillUsage, JSON.stringify({ skill: 'qa' }) + '\n');
    writeFileSync(join(s.extend, 'analytics/workflow-metrics', sha('someone-else') + '.jsonl'), row(fresh()));
    const r = compareRealStores(snap, [fresh()], OPTS);
    expect(r.status).toBe('verified');
    expect(r.lines).toHaveLength(1);
    expect(summaryOf(r.lines)).toMatch(SUMMARY);
  }), 60_000);

  test('a rewritten, shrunk or removed gstack-extend ledger fails with prefix-rewrite; an upstream rewrite reads unverified', () => {
    const mutate: Record<string, (s: Stand) => void> = {
      'same-length rewrite': s => writeFileSync(s.ledger, readFileSync(s.ledger, 'utf8').replace('"session_id"', '"sessionXid"')),
      shrink: s => truncateSync(s.ledger, 10),
      removal: s => rmSync(s.ledger),
      'workflow-metrics ledger': s => writeFileSync(join(s.extend, 'analytics/workflow-metrics', sha(s.existing) + '.jsonl'), 'rewritten\n'),
    };
    for (const [name, change] of Object.entries(mutate)) {
      const s = standIn();
      try {
        const snap = snapshotRealStores(s.specs, OPTS);
        change(s);
        const r = compareRealStores(snap, [], OPTS);
        expect([name, r.status]).toEqual([name, 'failed']);
        expect(codes(r)).toEqual(['prefix-rewrite']);
        expect(r.lines[0]).toStartWith('REAL-STORE-GUARD:prefix-rewrite ');
      } finally {
        s.dispose();
      }
    }
    const s = standIn();
    try {
      const snap = snapshotRealStores(s.specs, OPTS);
      writeFileSync(s.skillUsage, 'rotated\n');
      const r = compareRealStores(snap, [], OPTS);
      expect(r.status).toBe('unverified');
      expect(r.findings).toEqual([]);
      expect(summaryOf(r.lines)).toContain('upstream ledger shrank or was rewritten');
      const strict = compareRealStores(snap, [], { ...OPTS, strict: true });
      expect(strict.status).toBe('failed');
      expect(codes(strict)).toEqual(['unexpected']);
      expect(strict.lines[0]).toContain('GSTACK_EXTEND_STORE_GUARD=strict');
    } finally {
      s.dispose();
    }
  }, 60_000);

  test('a deleted or rewritten unrelated handoff, marker or lock passes', withStand(s => {
    const snap = snapshotRealStores(s.specs, OPTS);
    const key = readdirSync(join(s.extend, 'telemetry'))[0]!;
    rmSync(join(s.extend, 'telemetry', key), { recursive: true });
    writeFileSync(join(s.extend, 'telemetry-completed', key, sha(s.existing) + '.json'), JSON.stringify({ session_id: s.existing, root: '/elsewhere/repo', done: ['usage'] }));
    rmSync(join(s.extend, 'telemetry-locks', key + '.lock'));
    const r = compareRealStores(snap, [fresh()], OPTS);
    expect(r.status).toBe('verified');
  }), 60_000);

  test('a file named for a harvested id fails with named-file in every name-keyed tree', () => {
    for (const rel of ['telemetry/k/H.json', 'telemetry-completed/k/H.json', 'telemetry-locks/H.lock', 'analytics/workflow-metrics/H.jsonl', 'workflow-metrics-locks/H.lock']) {
      const s = standIn();
      try {
        const snap = snapshotRealStores(s.specs, OPTS);
        const id = fresh();
        const target = join(s.extend, rel.replace('H', sha(id)));
        mkdirSync(join(target, '..'), { recursive: true });
        writeFileSync(target, '');
        // Another session's hash does not match.
        expect(compareRealStores(snap, [fresh()], OPTS).status).toBe('verified');
        const r = compareRealStores(snap, [id], OPTS);
        expect([rel, r.status, codes(r)]).toEqual([rel, 'failed', ['named-file']]);
        expect(r.lines[0]).toStartWith('REAL-STORE-GUARD:named-file ');
        expect(r.lines[0]).toContain(`session-id=${id}`);
        expect(r.lines[0]).toContain(`path=stand-in extend store/${rel.replace('H', sha(id))}`);
      } finally {
        s.dispose();
      }
    }
  }, 60_000);

  test('an unreadable store reads unverified with a warning naming the path, fails under strict, and a missing store passes', withStand(s => {
    if (process.getuid?.() === 0) return; // root ignores permission bits
    const snap = snapshotRealStores(s.specs, OPTS);
    chmodSync(s.upstream, 0o000);
    const r = compareRealStores(snap, [fresh()], OPTS);
    expect(r.status).toBe('unverified');
    expect(r.lines.some(line => line.startsWith('REAL-STORE-GUARD: warning unverified store=stand-in upstream store path=stand-in upstream store cause=unreadable store (EACCES) fix=restore read access and rerun'))).toBe(true);
    expect(summaryOf(r.lines)).toMatch(/^REAL-STORE-GUARD: unverified \(\d+ files, \d+ ms\): unreadable store \(EACCES\); fix: restore read access and rerun$/);
    const strict = compareRealStores(snap, [fresh()], { ...OPTS, strict: true });
    expect(strict.status).toBe('failed');
    expect(strict.lines[0]).toStartWith('REAL-STORE-GUARD:unexpected ');
    expect(strict.lines[0]).toContain('fix: restore read access and rerun');
    const before = process.env.GSTACK_EXTEND_STORE_GUARD;
    process.env.GSTACK_EXTEND_STORE_GUARD = 'strict';
    try {
      expect(compareRealStores(snap, [fresh()], OPTS).status).toBe('failed');
    } finally {
      if (before === undefined) delete process.env.GSTACK_EXTEND_STORE_GUARD;
      else process.env.GSTACK_EXTEND_STORE_GUARD = before;
    }
    chmodSync(s.upstream, 0o755);
    const missing: StoreSpec[] = [{ label: 'missing store', root: join(s.dir, 'never-created'), kind: 'extend' }];
    const absent = compareRealStores(snapshotRealStores(missing, OPTS), [fresh()], OPTS);
    expect([absent.status, absent.files]).toEqual(['verified', 0]);
  }), 60_000);

  function escapingChild(s: Stand, finishToo: boolean) {
    const fix = makeTelemetryFixture('off');
    const repo = join(fix.home, 'repo');
    mkdirSync(repo, { recursive: true });
    expect(spawnSync('git', ['init', '-q', repo], { env: fix.env }).status).toBe(0);
    // The child inherits a state override pointing at the stand-in store, so its writes leave nothing in its fixture home.
    const env = { ...fix.env, GSTACK_EXTEND_STATE_DIR: s.extend };
    const started = spawnSync(HELPER_BIN, ['start', '--skill', 'extend:review-and-prep'], { env, cwd: repo, encoding: 'utf8', timeout: 30_000 });
    expect(started.stdout).toMatch(/session=extend-/);
    if (finishToo) {
      const done = spawnSync(HELPER_BIN, ['finish', '--skill', 'extend:review-and-prep', '--outcome', 'success'], { env, cwd: repo, encoding: 'utf8', timeout: 30_000 });
      expect(done.status).toBe(0);
    }
    expect(harvestSessionIds(fix.home).size).toBe(0);
    return { fix, repo };
  }
  test('a child that inherits GSTACK_EXTEND_STATE_DIR pointing at the store fails with escaped-root', withStand(s => {
    const snap = snapshotRealStores(s.specs, OPTS);
    escapingChild(s, false);
    const r = compareRealStores(snap, [], OPTS);
    expect(r.status).toBe('failed');
    expect(codes(r)).toEqual(['escaped-root']);
    expect(r.lines[0]).toStartWith('REAL-STORE-GUARD:escaped-root ');
    expect(r.lines[0]).toContain('handoff binds a root under a path under the runner\'s temp directory (gx-tel-)');
    expect(r.lines.join('\n')).not.toContain(s.dir);
  }), 90_000);

  test('an escaping child that runs start and finish from a git repository still fails through its completion marker (realpath)', withStand(s => {
    const snap = snapshotRealStores(s.specs, OPTS);
    const { fix } = escapingChild(s, true);
    const r = compareRealStores(snap, [], OPTS);
    expect(r.status).toBe('failed');
    expect(r.findings.map(f => f.path).some(path => path.includes('/telemetry-completed/'))).toBe(true);
    expect(codes(r)).toContain('escaped-root');
    expect(r.lines.some(line => line.includes('completion marker binds a root'))).toBe(true);
    // macOS reports /private/var/... for a /var/... temp directory: the marker's root is the realpath form.
    const roots = readdirSync(join(s.extend, 'telemetry-completed'), { recursive: true }).map(String).filter(name => name.endsWith('.json'))
      .map(name => JSON.parse(readFileSync(join(s.extend, 'telemetry-completed', name), 'utf8')).root as string);
    expect(roots.filter(root => root.startsWith(realpathSync(fix.home)))).toHaveLength(1);
  }), 90_000);

  test('a session that exists only in a crafted ledger is harvested, and its id fails when it reaches a store', withStand(s => {
    const fix = makeTelemetryFixture('off');
    const crafted = fresh();
    const dir = join(fix.home, '.gstack-extend/analytics/workflow-metrics');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, sha(crafted) + '.jsonl'), JSON.stringify({ v: 1, session_id: crafted, kind: 'run' }) + '\n');
    expect([...harvestSessionIds(fix.home)]).toEqual([crafted]);
    const repo = join(fix.home, 'repo');
    mkdirSync(repo, { recursive: true });
    spawnSync('git', ['init', '-q', repo], { env: fix.env });
    const sid = /session=(extend-[0-9a-f-]{36})/.exec(spawnSync(HELPER_BIN, ['start', '--skill', 'extend:review-and-prep'], { env: fix.env, cwd: repo, encoding: 'utf8', timeout: 30_000 }).stdout)?.[1];
    expect(sid).toBeTruthy();
    expect([...harvestSessionIds(fix.home)].sort()).toEqual([crafted, sid!].sort()); // handoff and crafted ledger
    const snap = snapshotRealStores(s.specs, OPTS);
    appendFileSync(s.ledger, row(crafted));
    expect(codes(compareRealStores(snap, harvestSessionIds(fix.home), OPTS))).toEqual(['appended-id']);
  }), 90_000);

  test('a symlink in a store is skipped, reported by path and never followed', withStand(s => {
    const outside = join(s.dir, 'outside.jsonl');
    const id = fresh();
    writeFileSync(outside, row(id));
    const snap = snapshotRealStores(s.specs, OPTS);
    symlinkSync(outside, join(s.extend, 'analytics/linked.jsonl'));
    symlinkSync(join(s.dir, 'extend'), join(s.upstream, 'analytics/dirlink'));
    const r = compareRealStores(snap, [id], OPTS);
    expect(r.findings).toEqual([]);
    expect(r.status).toBe('unverified');
    for (const path of ['stand-in extend store/analytics/linked.jsonl', 'stand-in upstream store/analytics/dirlink']) {
      expect(r.lines.some(line => line.includes(`path=${path} cause=skipped symlink`))).toBe(true);
    }
    expect(r.lines.join('\n')).not.toContain(s.dir);
  }), 60_000);

  // Value: protects=the guard skips a symlinked store root and reports unverified or strict failure;
  // fails_when=a root symlink is followed and its target is scanned or reported verified;
  // why_new=the existing symlink case covers links inside a store only; seam=none;
  // no_claim=real-store acceptance (temporary store root and symlink only).
  test('a symlinked store root is skipped before scanning its target and fails under strict', withStand(s => {
    const link = join(s.dir, 'linked-root');
    symlinkSync(s.extend, link);
    for (const suffix of ['', '/', '/.', '/./', '/.//.']) {
      const root = link + suffix;
      // Discovery must keep the refused link even when its real target is already watched.
      expect(realStoreSpecs({ GSTACK_EXTEND_STATE_DIR: s.extend, GSTACK_STATE_ROOT: root }, '')).toEqual([
        { label: '$GSTACK_EXTEND_STATE_DIR', root: s.extend, kind: 'extend' },
        { label: '$GSTACK_STATE_ROOT', root, kind: 'upstream' },
      ]);
      const specs: StoreSpec[] = [{ label: 'linked stand-in store', root, kind: 'extend' }];
      const snap = snapshotRealStores(specs, OPTS);
      const result = compareRealStores(snap, [s.existing], OPTS);
      expect(result.status, suffix).toBe('unverified');
      expect(result.findings).toEqual([]);
      expect(result.files).toBe(0);
      expect(snap.files).toBe(0);
      expect(snap.tokens).toEqual([]);
      expect(result.lines.some(line => line.includes('path=linked stand-in store cause=skipped symlink'))).toBe(true);
      const strict = compareRealStores(snap, [s.existing], { ...OPTS, strict: true });
      expect(strict.status).toBe('failed');
      expect(codes(strict)).toEqual(['unexpected']);
      expect(readFileSync(s.ledger, 'utf8')).toContain(s.existing);
    }
  }), 60_000);

  test('a concurrent append between stat and hash never reads as a prefix rewrite', withStand(s => {
    let appended = 0;
    const late = (abs: string) => {
      if (abs.endsWith('stage-runs.jsonl') && appended++ === 0) appendFileSync(abs, row(fresh()));
    };
    // Snapshot side: the append lands after the stat, so the recorded size and hash stop short of it.
    const snap = snapshotRealStores(s.specs, { ...OPTS, hooks: { afterStat: late } });
    expect(appended).toBe(1);
    expect(snap.stores[0]!.ledgers['analytics/stage-runs.jsonl']!.size).toBeLessThan(readFileSync(s.ledger).length);
    expect(compareRealStores(snap, [fresh()], OPTS).status).toBe('verified');
    // Compare side: the later prefix is compared over the snapshot's length, and the read stops at the stat'd size.
    appended = 0;
    const r = compareRealStores(snap, [fresh()], { ...OPTS, hooks: { afterStat: (abs, phase) => phase === 'compare' && late(abs) } });
    expect(appended).toBe(1);
    expect(r.status).toBe('verified');
  }), 60_000);

  test('an internal failure reports unexpected with the error class and a compact trace', () => {
    const r = compareRealStores({} as never, [], OPTS);
    expect(r.status).toBe('failed');
    expect(r.lines[0]).toStartWith('REAL-STORE-GUARD:unexpected ');
    expect(r.lines[0]).toMatch(/what: store=real stores path=unknown — \w*Error: .* @ /);
    expect(r.lines[0]).toContain('docs: docs/telemetry.md#workflow-metrics-guard-unexpected');
    expect(summaryOf(r.lines)).toMatch(/^REAL-STORE-GUARD: failed \(\d+ files, \d+ ms\)$/);
  });

  function spawnedBunTest(plant: boolean) {
    const dir = mkdtempSync(join(tmpdir(), 'gx-guard-spawn-')); // outside the repo directory
    const home = join(dir, 'home');
    const childTmp = join(dir, 'tmp');
    mkdirSync(join(home, '.gstack-extend/analytics'), { recursive: true });
    mkdirSync(childTmp);
    const store = join(home, '.gstack-extend/analytics/stage-runs.jsonl');
    writeFileSync(store, row(fresh()));
    const fixtureNote = join(dir, 'fixture-home.txt');
    const file = join(dir, 'planted.test.ts');
    writeFileSync(file, [
      "import { afterAll, test } from 'bun:test';",
      "import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      `import { cleanupTelemetryFixtures, makeTelemetryFixture } from ${JSON.stringify(HELPER_MODULE)};`,
      'afterAll(cleanupTelemetryFixtures);',
      "test('mints a session id and lets it escape into the real store', () => {",
      "  const fix = makeTelemetryFixture('off');",
      `  writeFileSync(${JSON.stringify(fixtureNote)}, fix.home);`,
      "  const id = 'extend-' + crypto.randomUUID();",
      "  mkdirSync(join(fix.home, '.gstack-extend/analytics'), { recursive: true });",
      "  writeFileSync(join(fix.home, '.gstack-extend/analytics/stage-runs.jsonl'), JSON.stringify({ session_id: id }) + '\\n');",
      `  if (${plant}) appendFileSync(join(process.env.HOME!, '.gstack-extend/analytics/stage-runs.jsonl'), JSON.stringify({ session_id: id }) + '\\n');`,
      '});',
    ].join('\n'));
    // HOME is the stand-in: to the child's helper it is the runner's real HOME. No state override is inherited.
    const r = spawnSync(process.execPath, ['test', file], { cwd: dir, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, TMPDIR: childTmp }, encoding: 'utf8', timeout: 120_000 });
    const out = (r.stdout ?? '') + (r.stderr ?? '');
    const leftovers = readdirSync(childTmp).filter(name => name.startsWith('gx-tel-'));
    const fixtureHome = readFileSync(fixtureNote, 'utf8');
    rmSync(dir, { recursive: true, force: true });
    return { status: r.status, out, leftovers, fixtureHomeExists: existsSync(fixtureHome) };
  }
  test('a spawned bun test with a planted id exits nonzero, prints the guard line and still removes the fixture home', () => {
    const r = spawnedBunTest(true);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/^REAL-STORE-GUARD:appended-id /m);
    expect(r.out).toContain('docs/telemetry.md#workflow-metrics-guard-appended-id');
    expect(r.out).toMatch(/^REAL-STORE-GUARD: failed \(\d+ files, \d+ ms\)/m);
    expect(r.fixtureHomeExists).toBe(false);
    expect(r.leftovers).toEqual([]);
  }, 180_000);
  test('a spawned bun test that stays isolated exits zero and records a verified summary', () => {
    const r = spawnedBunTest(false);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/^REAL-STORE-GUARD: verified \(\d+ files, \d+ ms\)/m);
    expect(r.out).not.toContain('REAL-STORE-GUARD:appended-id');
    expect(r.fixtureHomeExists).toBe(false);
  }, 180_000);

  test('the smoke CLI snapshots and compares without writing content into the snapshot file', withStand(s => {
    const home = join(s.dir, 'home');
    mkdirSync(join(home, '.gstack-extend/analytics'), { recursive: true });
    const secret = 'CONTENT-MUST-NOT-LEAK';
    const store = join(home, '.gstack-extend/analytics/stage-runs.jsonl');
    const old = fresh();
    writeFileSync(store, JSON.stringify({ session_id: old, note: secret }) + '\n');
    const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home };
    const run = (args: string[]) => spawnSync(process.execPath, [HELPER_MODULE, ...args], { env, encoding: 'utf8', timeout: 60_000 });
    const snapFile = join(s.dir, 'real.snapshot.json');
    const snapped = run(['--snapshot', snapFile]);
    expect(snapped.status).toBe(0);
    expect(snapped.stdout).toMatch(/^REAL-STORE-GUARD: snapshot written \(\d+ files, \d+ ms\)$/m);
    const text = readFileSync(snapFile, 'utf8');
    expect(text).not.toContain(secret);
    expect(text).not.toContain(old); // pre-existing session ids are stored as hashes
    expect(text).toContain(sha(old));
    expect(run(['--compare', snapFile]).stdout).toMatch(/^REAL-STORE-GUARD: verified \(\d+ files, \d+ ms\)$/m);
    const id = fresh();
    appendFileSync(store, row(id));
    const isolated = join(s.dir, 'isolated-state');
    mkdirSync(isolated);
    writeFileSync(join(isolated, 'stage-runs.jsonl'), row(id)); // the smoke's own isolated additions
    const failed = run(['--compare', snapFile, '--harvest', isolated]);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toMatch(/^REAL-STORE-GUARD:appended-id /m);
    const idsFile = join(s.dir, 'ids.txt');
    writeFileSync(idsFile, `# smoke ids\n${id}\n`);
    expect(run(['--compare', snapFile, '--ids', idsFile]).status).toBe(1);
    expect(run(['--compare', join(s.dir, 'missing.json')]).status).toBe(2);
    expect(run([]).status).toBe(2);
  }), 120_000);
});

// Track 57A: every logged finding names the part that reported it (a v2 `pass`), and the read counts per part.
describe('Track 57A finding attribution', () => {
  const v2 = (rows: any[]) => rows.map(r => (r.op === 'pass' ? { ...r, request: { ...r.request, v: 2 } } : r));
  const att = (id: string, foundBy: string[], patch: Record<string, unknown> = {}) =>
    finding(id, { found_by: foundBy, attribution_reason: null, ...patch });
  const unatt = (id: string, reason: string, patch: Record<string, unknown> = {}) =>
    finding(id, { found_by: [], attribution_reason: reason, ...patch });
  const FIXED = { resolution: 'fixed' };
  const REJECTED = { adjudication: 'rejected', resolution: 'unknown' };
  const MERGED = ['native-adversarial', 'specialist:security', 'specialist:testing'];

  test('(a) each part and a merged finding are counted per part, unattributed by reason, v1 totals unchanged', () => {
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u();
    const run = runRows(sid);
    const local = passRows(sid, { voices: [
      { voice: 'core', findings: [att('C1', ['core']), unatt('U1', 'not-reported'), unatt('U2', 'unlisted-part'), unatt('U3', 'unsupported')] },
      { voice: 'testing', findings: [att('S1', ['specialist:testing'], FIXED), att('M1', MERGED, { severity_rubric: 'adversarial' })] },
      { voice: 'red-team', findings: [att('R1', ['red-team'], REJECTED)] },
      { voice: 'security', findings: [att('D1', ['specialist:security'], { adjudication: 'duplicate', resolution: 'unknown', duplicate_of: 'M1' })] },
      { voice: 'native-adversarial', findings: [att('N1', ['native-adversarial'])] },
      { voice: 'outside-challenge', findings: [att('O1', ['outside:challenge'])] },
      { voice: 'outside-structured', findings: [att('O2', ['outside:structured'], { adjudication: 'deferred' })] },
      { voice: 'qa', findings: [att('Q1', ['qa'])] },
    ] });
    const greptile = passRows(sid, { scope: 'greptile', at: 3000, voices: [{ voice: 'greptile', findings: [att('G1', ['greptile']), att('G2', ['greptile'], REJECTED)] }] });
    craft(fix, sid, [...run.rows, ...v2(local.rows), ...v2(greptile.rows)]);
    const data = read(fix, sid).envelope.data;
    expect(data.capture).toBe('ok');
    expect(data.unknown_reasons).toEqual(['missing-end']); // only the crafted run step is open
    expect(data.findings).toMatchObject({ accepted: 9, fixed: 1, open: 8, rejected: 1, deferred: 1, duplicate: 1, unclassified: 0 }); // the v1 totals
    const part = (reported: number, accepted: number, rejected: number) => ({ reported, accepted, rejected });
    expect(data.findings.by_part).toEqual({
      core: part(1, 1, 0),
      'native-adversarial': part(2, 2, 0), // N1 and the merged M1
      'outside:challenge': part(1, 1, 0),
      'outside:structured': part(1, 0, 0),
      qa: part(1, 1, 0),
      'red-team': part(1, 0, 1),
      'specialist:security': part(2, 1, 0), // the merged M1 and its duplicate row D1
      'specialist:testing': part(2, 2, 0), // S1 and the merged M1
    });
    expect(Object.keys(data.findings.by_part)).toEqual([...Object.keys(data.findings.by_part)].sort());
    expect(data.findings.unattributed).toEqual({ 'not-reported': 1, 'unlisted-part': 1, unsupported: 1, 'v1-record': 0 });
    expect(data.greptile_findings).toMatchObject({ accepted: 1, rejected: 1 });
    expect(data.greptile_findings.by_part).toEqual({ greptile: part(2, 1, 1) });
    expect(data.greptile_findings.unattributed).toEqual({ 'not-reported': 0, 'unlisted-part': 0, unsupported: 0, 'v1-record': 0 });
    expect(data.receipt_text).not.toContain('by_part'); // the receipt line is unchanged
  }, 30_000);

  test('(a) a correction applies before the per-part counts: a fixed or rejected finding follows its adjudication', () => {
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u();
    const p = passRows(sid, { voices: [{ voice: 'testing', findings: [att('S1', ['specialist:testing']), att('S2', ['specialist:testing'])] }] });
    craft(fix, sid, [...runRows(sid).rows, ...v2(p.rows),
      { op: 'correction', at: 2100, request: { ...base(sid), correction_kind: 'finding', finding_id: 'S2', pass_id: p.passId, voice_id: 'testing', attempt_id: p.attempts.testing, adjudication: 'rejected', resolution: 'unknown' } }]);
    const data = read(fix, sid).envelope.data;
    expect(data.findings.by_part).toEqual({ 'specialist:testing': { reported: 2, accepted: 1, rejected: 1 } });
  }, 30_000);

  test('(b) earlier v1 rows read as unknown (v1-record); a mixed ledger counts both', () => {
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u();
    const old = passRows(sid, { voices: [{ voice: 'core', findings: [finding('F1', FIXED), finding('F2'), finding('F3', REJECTED)] }] });
    craft(fix, sid, [...runRows(sid).rows, ...old.rows]);
    const before = read(fix, sid).envelope.data;
    expect(before.findings).toMatchObject({ accepted: 2, fixed: 1, open: 1, rejected: 1 });
    expect(before.findings.by_part).toEqual({});
    expect(before.findings.unattributed).toEqual({ 'not-reported': 0, 'unlisted-part': 0, unsupported: 0, 'v1-record': 3 });

    const mixedSid = 'extend-' + u();
    const first = passRows(mixedSid, { voices: [{ voice: 'core', findings: [finding('A1'), finding('A2')] }] });
    const second = passRows(mixedSid, { at: 3000, voices: [{ voice: 'testing', findings: [att('B1', ['specialist:testing']), unatt('B2', 'not-reported')] }] });
    craft(fix, mixedSid, [...runRows(mixedSid).rows, ...first.rows, ...v2(second.rows)]);
    const mixed = read(fix, mixedSid).envelope.data;
    expect(mixed.local_passes).toBe(2);
    expect(mixed.findings.accepted).toBe(4);
    expect(mixed.findings.by_part).toEqual({ 'specialist:testing': { reported: 1, accepted: 1, rejected: 0 } });
    expect(mixed.findings.unattributed).toEqual({ 'not-reported': 1, 'unlisted-part': 0, unsupported: 0, 'v1-record': 2 });
  }, 30_000);

  test('(c)(e) the helper and the schema agree on every v1 and v2 finding shape; invalid input never mutates', () => {
    const fix = makeTelemetryFixture('community');
    const repo = gitRepo(fix);
    const sid = start(fix, repo);
    beginRun(fix, repo, sid);
    const lines = ledgerLines(fix, sid).length;
    const many = (n: number) => Array.from({ length: n }, (_, i) => `specialist:s${i}`);
    const cases: Array<[string, number, Record<string, unknown>, boolean]> = [
      ['v1 finding', 1, {}, true],
      ['v1 finding carrying found_by', 1, { found_by: ['core'] }, false],
      ['v1 finding carrying attribution_reason', 1, { attribution_reason: 'not-reported' }, false],
      ['v2 attributed', 2, { found_by: ['core'], attribution_reason: null }, true],
      ['v2 every label form', 2, { found_by: ['specialist:data-migration', 'red-team', 'native-adversarial', 'core', 'qa', 'greptile', 'outside:challenge', 'outside:structured'], attribution_reason: null }, true],
      ['v2 not-reported', 2, { found_by: [], attribution_reason: 'not-reported' }, true],
      ['v2 unlisted-part', 2, { found_by: [], attribution_reason: 'unlisted-part' }, true],
      ['v2 unsupported', 2, { found_by: [], attribution_reason: 'unsupported' }, true],
      ['v2 eight labels', 2, { found_by: many(8), attribution_reason: null }, true],
      ['v2 missing found_by', 2, { attribution_reason: null }, false],
      ['v2 missing attribution_reason', 2, { found_by: ['core'] }, false],
      ['v2 bad label', 2, { found_by: ['specialist:Testing'], attribution_reason: null }, false],
      ['v2 unknown label', 2, { found_by: ['reviewer'], attribution_reason: null }, false],
      ['v2 bare specialist', 2, { found_by: ['specialist:'], attribution_reason: null }, false],
      ['v2 outside phase outside the list', 2, { found_by: ['outside:other'], attribution_reason: null }, false],
      ['v2 empty label', 2, { found_by: [''], attribution_reason: null }, false],
      ['v2 non-string label', 2, { found_by: [7], attribution_reason: null }, false],
      ['v2 specialist:red-team', 2, { found_by: ['specialist:red-team'], attribution_reason: null }, false],
      ['v2 duplicate label', 2, { found_by: ['core', 'core'], attribution_reason: null }, false],
      ['v2 nine labels', 2, { found_by: many(9), attribution_reason: null }, false],
      ['v2 found_by not an array', 2, { found_by: 'core', attribution_reason: null }, false],
      ['v2 nonempty with a reason', 2, { found_by: ['core'], attribution_reason: 'not-reported' }, false],
      ['v2 empty with null', 2, { found_by: [], attribution_reason: null }, false],
      ['v2 empty with v1-record', 2, { found_by: [], attribution_reason: 'v1-record' }, false],
      ['v2 empty with a made-up reason', 2, { found_by: [], attribution_reason: 'guessed' }, false],
      ['v2 unknown key', 2, { found_by: ['core'], attribution_reason: null, part: 'core' }, false],
    ];
    let recorded = 0;
    for (const [name, v, patch, valid] of cases) {
      const request = { ...base(sid), v, pass_id: u(), scope: 'local', state: 'attempt', voice_id: 'core', attempt_id: u(), predecessor_attempt_id: null, attempt_outcome: 'completed',
        findings: [{ ...finding('F1'), ...patch }] };
      const record = { v: 1, op: 'pass', event_id: request.event_id, request_digest: 'e'.repeat(64), captured_at_ms: 0, producer_version: null, request };
      expect(validRecord(record), `${name}: schema`).toBe(valid);
      const { envelope } = metrics(fix.env, 'pass', request, repo);
      expect(envelope.reason, name).toBe(valid ? null : 'invalid-input');
      expect(envelope.status, name).toBe(valid ? 'recorded' : 'unavailable');
      if (valid) recorded += 1;
      expect(ledgerLines(fix, sid), `${name}: ledger`).toHaveLength(lines + recorded);
    }
    // the stored record wrapper stays v1 whatever the request's v is
    for (const line of ledgerLines(fix, sid)) expect(JSON.parse(line).v).toBe(1);
  }, 120_000);

  test('(c) only pass takes v2: a v2 begin, a v4 pass and a boolean version stay refused; a live v2 pass sequence reads back', () => {
    const fix = makeTelemetryFixture('community');
    const repo = gitRepo(fix);
    const sid = start(fix, repo);
    const run = beginRun(fix, repo, sid);
    const refused = (op: string, payload: unknown) => metrics(fix.env, op, payload, repo).envelope;
    const begin = { ...base(sid), step_id: u(), parent_step_id: null, kind: 'phase', phase: 'tests' };
    expect(refused('begin', { ...begin, v: 2 })).toMatchObject({ status: 'unavailable', reason: 'unsupported-version', diagnostics: { expected: '1', actual: 2 } });
    expect(refused('end', { ...base(sid), v: 2, step_id: run.step, outcome: 'completed' }).reason).toBe('unsupported-version');
    expect(refused('decision', { ...base(sid), v: 2, step_id: u(), phase: 'tests', decision: 'RUN', reason: 'required' }).reason).toBe('unsupported-version');
    expect(refused('correction', { ...base(sid), v: 2, correction_kind: 'fix-cycle', fix_step_id: u() }).reason).toBe('unsupported-version');
    const passId = u(), attemptId = u();
    const pass = (extra: Record<string, unknown>, v = 2) => ({ ...base(sid), v, pass_id: passId, scope: 'local', ...extra });
    expect(refused('pass', pass({ state: 'started', required_voice_ids: ['testing'] }, 4))).toMatchObject({ reason: 'unsupported-version', diagnostics: { expected: '1|2|3', actual: 4 } });
    expect(refused('pass', pass({ state: 'started', required_voice_ids: ['testing'] }, true as any)).reason).toBe('invalid-input');
    const steps: Array<Record<string, unknown>> = [
      { state: 'started', required_voice_ids: ['testing'] },
      { state: 'attempt', voice_id: 'testing', attempt_id: attemptId, predecessor_attempt_id: null, attempt_outcome: 'completed', findings: [att('F1', ['specialist:testing', 'red-team']), unatt('F2', 'unlisted-part')] },
      { state: 'voice-complete', voice_id: 'testing', voice_status: 'completed', selected_attempt_id: attemptId },
      { state: 'completed' },
    ];
    const payloads = steps.map(step => pass(step));
    for (const payload of payloads) expect(refused('pass', payload).status, JSON.stringify(payload.state)).toBe('recorded');
    const data = read(fix, sid).envelope.data;
    expect(data.local_passes).toBe(1);
    expect(data.findings.by_part).toEqual({ 'red-team': { reported: 1, accepted: 1, rejected: 0 }, 'specialist:testing': { reported: 1, accepted: 1, rejected: 0 } });
    expect(data.findings.unattributed).toEqual({ 'not-reported': 0, 'unlisted-part': 1, unsupported: 0, 'v1-record': 0 });
    expect(refused('pass', payloads[1]).status).toBe('replayed'); // an identical v2 attempt replays like any other
  }, 60_000);

  test('(d) bound: 24 distinct parts stay reported; 25 null by_part with too-many-parts and the read stays ok', () => {
    const fix = makeTelemetryFixture('community');
    const labels = (n: number) => Array.from({ length: n }, (_, i) => `specialist:s${i}`);
    for (const [n, over] of [[24, false], [25, true]] as const) {
      const sid = 'extend-' + u();
      const findings = labels(n).map((label, i) => att(`F${i}`, [label]));
      craft(fix, sid, [...runRows(sid).rows, ...v2(passRows(sid, { voices: [{ voice: 'testing', findings }] }).rows)]);
      const out = read(fix, sid); // metrics() holds the envelope within 16 KiB
      expect(out.envelope.status).toBe('ok');
      expect(out.envelope.data.capture).toBe('ok');
      expect(out.envelope.data.findings.accepted).toBe(n);
      expect(out.envelope.data.findings.unattributed).toEqual({ 'not-reported': 0, 'unlisted-part': 0, unsupported: 0, 'v1-record': 0 });
      if (over) {
        expect(out.envelope.data.findings.by_part).toBeNull();
        expect(out.envelope.data.unknown_reasons).toContain('too-many-parts');
      } else {
        expect(Object.keys(out.envelope.data.findings.by_part)).toHaveLength(24);
        expect(out.envelope.data.unknown_reasons).not.toContain('too-many-parts');
      }
    }
  }, 60_000);

  test('(d) a full scope of attributed findings keeps the envelope within 16 KiB', () => {
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u();
    const findings = Array.from({ length: 200 }, (_, i) => att(`F${i}`, i % 3 ? [`specialist:s${i % 24}`] : MERGED));
    const local = passRows(sid, { voices: [{ voice: 'testing', findings }] });
    const greptile = passRows(sid, { scope: 'greptile', at: 3000, voices: [{ voice: 'greptile', findings: Array.from({ length: 200 }, (_, i) => att(`G${i}`, [`specialist:g${i % 24}`])) }] });
    craft(fix, sid, [...runRows(sid).rows, ...v2(local.rows), ...v2(greptile.rows)]);
    const out = read(fix, sid);
    expect(out.envelope.status).toBe('ok');
    expect(out.envelope.data.findings.by_part).not.toBeNull();
    expect(out.envelope.data.greptile_findings.by_part).not.toBeNull();
  }, 30_000);

  test('(e) the schema rejects a begin request with v:2 and a pass request whose findings do not match its version', () => {
    const sid = 'extend-' + u();
    const wrap = (op: string, request: any) => ({ v: 1, op, event_id: request.event_id, request_digest: 'e'.repeat(64), captured_at_ms: 0, producer_version: null, request });
    const begin = { ...base(sid), step_id: u(), parent_step_id: null, kind: 'phase', phase: 'tests' };
    expect(validRecord(wrap('begin', begin))).toBe(true);
    expect(validRecord(wrap('begin', { ...begin, v: 2 }))).toBe(false);
    expect(validRecord({ ...wrap('begin', begin), v: 2 })).toBe(false); // the record wrapper stays v1
    const attempt = (v: number, f: any) => ({ ...base(sid), v, pass_id: u(), scope: 'local', state: 'attempt', voice_id: 'core', attempt_id: u(), predecessor_attempt_id: null, attempt_outcome: 'completed', findings: [f] });
    expect(validRecord(wrap('pass', attempt(2, att('F1', ['core']))))).toBe(true);
    expect(validRecord(wrap('pass', attempt(1, att('F1', ['core']))))).toBe(false);
    expect(validRecord(wrap('pass', attempt(2, finding('F1'))))).toBe(false);
    expect(validRecord(wrap('pass', attempt(3, finding('F1'))))).toBe(false);
  });

  test('(f) the helper, schema, docs and skill share one vocabulary', () => {
    const dumped = spawnSync('python3', ['-B', '-I', '-c', [
      'import importlib.util, json',
      `spec = importlib.util.spec_from_file_location("workflow_metrics", ${JSON.stringify(join(ROOT, 'bin/lib/workflow_metrics.py'))})`,
      'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
      'print(json.dumps({"part": m.PART_RE.pattern, "reasons": list(m.ATTRIBUTION_REASONS), "found_by": m.MAX_FOUND_BY, "parts": m.MAX_PARTS}))',
    ].join('\n')], { encoding: 'utf8', timeout: 15_000 });
    expect(dumped.status).toBe(0);
    const helper = JSON.parse(dumped.stdout) as { part: string; reasons: string[]; found_by: number; parts: number };
    const defs = schema.definitions;
    expect(defs.part.pattern).toBe(`^${helper.part}$`);
    expect(defs.finding_v2.properties.found_by.maxItems).toBe(helper.found_by);
    expect([...defs.finding_v2.properties.attribution_reason.enum.filter((r: string | null) => r !== null)]).toEqual(helper.reasons);
    expect(defs.finding_v2.required).toEqual([...defs.finding.required, 'found_by', 'attribution_reason']);
    expect(Object.keys(defs.finding_v2.properties).sort()).toEqual([...Object.keys(defs.finding.properties), 'found_by', 'attribution_reason'].sort());

    const skill = readFileSync(join(ROOT, 'skills', 'review-and-prep.md'), 'utf8');
    const from = skill.indexOf('- Finding attribution (`v:2`)');
    expect(from).toBeGreaterThan(0);
    const bullet = skill.slice(from, skill.indexOf('\n- ', from + 1)).replace(/\s+/g, ' ');
    const labelForms = ['specialist:<name>', 'red-team', 'native-adversarial', 'core', 'qa', 'greptile', 'outside:challenge', 'outside:structured'];
    const part = new RegExp(`^${helper.part}$`);
    for (const form of labelForms) {
      expect(bullet, form).toContain('`' + form + '`');
      expect(part.test(form.replace('<name>', 'testing')), form).toBe(true);
    }
    expect(part.test('specialist:red-team')).toBe(true); // the grammar admits it; the helper and schema reject it explicitly
    expect(ajv.validate('workflow-metrics#/definitions/part', 'specialist:red-team')).toBe(false);
    expect(ajv.validate('workflow-metrics#/definitions/part', 'specialist:testing')).toBe(true);
    for (const reason of helper.reasons) expect(bullet, reason).toContain('`' + reason + '`');
    expect(bullet).not.toContain('v1-record'); // read-only: a producer never sends it

    const docs = readFileSync(join(ROOT, 'docs/telemetry.md'), 'utf8').replace(/\s+/g, ' ').toLowerCase();
    for (const form of labelForms) expect(docs, form).toContain('`' + form + '`');
    for (const reason of [...helper.reasons, 'v1-record', 'too-many-parts']) expect(docs, reason).toContain('`' + reason + '`');
    expect(docs).toContain(`more than ${helper.parts} distinct parts`);
    expect(docs).toContain(`at most ${helper.found_by} unique labels`);
  });
});

// Track 64C: a delegated specialist part is a v3 `pass` attempt that carries a `delegate` object, and the read reports usage per provider label.
describe('Track 64C delegated attempts (pass v3)', () => {
  const att = (id: string, foundBy: string[], patch: Record<string, unknown> = {}) =>
    finding(id, { found_by: foundBy, attribution_reason: null, ...patch });
  const delegate = (patch: Record<string, unknown> = {}) => ({
    provider: 'alpha', model: 'model-a', outcome: 'credited', fallback_reason: null, replay: false, wall_ms: 1200,
    input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 5, ...patch,
  });
  const fellBack = (patch: Record<string, unknown> = {}) => delegate({ outcome: 'fell-back', fallback_reason: 'timeout', input_tokens: null, output_tokens: null,
    cache_read_input_tokens: null, cache_creation_input_tokens: null, ...patch });
  const attempt = (sid: string, patch: Record<string, unknown> = {}) => ({ ...base(sid), v: 3, pass_id: u(), scope: 'local', state: 'attempt', voice_id: 'testing',
    attempt_id: u(), predecessor_attempt_id: null, attempt_outcome: 'completed', findings: [att('F1', ['specialist:testing'])], delegate: delegate(), ...patch });
  const wrap = (request: any) => ({ v: 1, op: 'pass', event_id: request.event_id, request_digest: 'e'.repeat(64), captured_at_ms: 0, producer_version: null, request });
  // One v3 pass whose voices each list their attempts in order; the last attempt of a voice is the selected one.
  type Try = { outcome?: string; delegate?: Record<string, unknown>; findings?: any[] };
  function passV3(sid: string, voices: Array<{ voice: string; tries: Try[] }>, at = 2000) {
    const passId = u(), ids: Record<string, string[]> = {};
    const row = (n: number, request: Record<string, unknown>) => ({ op: 'pass', at: at + n, request: { ...base(sid), v: 3, pass_id: passId, scope: 'local', ...request } });
    const rows: any[] = [row(0, { state: 'started', required_voice_ids: voices.map(v => v.voice) })];
    for (const { voice, tries } of voices) {
      ids[voice] = tries.map(() => u());
      tries.forEach((t, i) => {
        const outcome = t.outcome ?? 'completed';
        rows.push(row(10 + i, { state: 'attempt', voice_id: voice, attempt_id: ids[voice]![i], predecessor_attempt_id: i ? ids[voice]![i - 1] : null, attempt_outcome: outcome,
          ...(outcome === 'completed' ? { findings: t.findings ?? [] } : {}), ...(t.delegate ? { delegate: t.delegate } : {}) }));
      });
      rows.push(row(20, { state: 'voice-complete', voice_id: voice, voice_status: 'completed', selected_attempt_id: ids[voice]![tries.length - 1] }));
    }
    rows.push(row(40, { state: 'completed' }));
    return { passId, ids, rows };
  }

  test('a v3 attempt with a delegate records and replays, and the stored wrapper stays v1', () => {
    const fix = makeTelemetryFixture('community');
    const repo = gitRepo(fix);
    const sid = start(fix, repo);
    beginRun(fix, repo, sid);
    const passId = u();
    const request = attempt(sid, { pass_id: passId });
    expect(metrics(fix.env, 'pass', { ...base(sid), v: 3, pass_id: passId, scope: 'local', state: 'started', required_voice_ids: ['testing'] }, repo).envelope.status).toBe('recorded');
    expect(metrics(fix.env, 'pass', request, repo).envelope).toMatchObject({ status: 'recorded', reason: null });
    expect(metrics(fix.env, 'pass', request, repo).envelope.status).toBe('replayed');
    const stored = ledgerLines(fix, sid).map(line => JSON.parse(line)).filter(r => r.op === 'pass' && r.request.state === 'attempt');
    expect(stored).toHaveLength(1);
    expect(stored[0].v).toBe(1);
    expect(stored[0].request.delegate).toEqual(request.delegate);
    expect(validRecord(stored[0])).toBe(true);
  }, 60_000);

  test('the delegate field rules agree in the helper and the schema, and an invalid request never mutates the ledger', () => {
    const fix = makeTelemetryFixture('community');
    const repo = gitRepo(fix);
    const sid = start(fix, repo);
    beginRun(fix, repo, sid);
    const lines = ledgerLines(fix, sid).length;
    const failed = { attempt_outcome: 'failed', findings: undefined };
    const reasons = ['unresolved-claim', 'timeout', 'failed', 'refused', 'needs-context', 'uncredited', 'unparsed-finding', 'worktree-changed'];
    const cases: Array<[string, Record<string, unknown>, Record<string, unknown>, boolean]> = [
      ['credited', delegate(), {}, true],
      ...reasons.map(reason => [`fell back: ${reason}`, fellBack({ fallback_reason: reason }), failed, true] as [string, Record<string, unknown>, Record<string, unknown>, boolean]),
      ['unreported counts are null', delegate({ wall_ms: null, input_tokens: null, output_tokens: null, cache_read_input_tokens: null, cache_creation_input_tokens: null }), {}, true],
      ['a replay', delegate({ replay: true }), {}, true],
      ['credited with a reason', delegate({ fallback_reason: 'timeout' }), {}, false],
      ['credited on a failed attempt', delegate(), failed, false],
      ['credited on a partial attempt', delegate(), { attempt_outcome: 'partial', findings: undefined }, false],
      ['fell back on a completed attempt', fellBack(), {}, false],
      ['fell back on a partial attempt', fellBack(), { attempt_outcome: 'partial', findings: undefined }, false],
      ['fell back without a reason', fellBack({ fallback_reason: null }), failed, false],
      ['an unknown reason', fellBack({ fallback_reason: 'guessed' }), failed, false],
      ['an uppercase label', delegate({ provider: 'Alpha' }), {}, false],
      ['a label that starts with a digit', delegate({ provider: '1a' }), {}, false],
      ['an empty label', delegate({ provider: '' }), {}, false],
      ['a 33-character label', delegate({ provider: 'a'.repeat(33) }), {}, false],
      ['a 32-character label', delegate({ provider: 'a'.repeat(32) }), {}, true],
      ['a model with a space', delegate({ model: 'model a' }), {}, false],
      ['an empty model', delegate({ model: '' }), {}, false],
      ['a 129-character model', delegate({ model: 'm'.repeat(129) }), {}, false],
      ['a non-boolean replay', delegate({ replay: 'yes' }), {}, false],
      ['a negative wall time', delegate({ wall_ms: -1 }), {}, false],
      ['a fractional token count', delegate({ input_tokens: 1.5 }), {}, false],
      ['a string token count', delegate({ output_tokens: '5' }), {}, false],
      ['a token count above 2^53', delegate({ cache_read_input_tokens: 2 ** 53 }), {}, false],
      ['a missing key', (() => { const d: any = delegate(); delete d.replay; return d; })(), {}, false],
      ['an unknown key', delegate({ prompt: 'text' }), {}, false],
      ['null', null as any, {}, false],
      ['an array', [] as any, {}, false],
    ];
    let recorded = 0;
    for (const [name, d, patch, valid] of cases) {
      const request: any = attempt(sid, { delegate: d, ...patch });
      for (const key of Object.keys(request)) if (request[key] === undefined) delete request[key];
      expect(validRecord(wrap(request)), `${name}: schema`).toBe(valid);
      const { envelope } = metrics(fix.env, 'pass', request, repo);
      expect(envelope.reason, name).toBe(valid ? null : 'invalid-input');
      expect(envelope.status, name).toBe(valid ? 'recorded' : 'unavailable');
      if (valid) recorded += 1;
      expect(ledgerLines(fix, sid), `${name}: ledger`).toHaveLength(lines + recorded);
    }
  }, 180_000);

  test('delegate is refused on v1, v2 and on every other state, and v4 is unsupported', () => {
    const fix = makeTelemetryFixture('community');
    const repo = gitRepo(fix);
    const sid = start(fix, repo);
    beginRun(fix, repo, sid);
    const lines = ledgerLines(fix, sid).length;
    const refused = (request: any) => metrics(fix.env, 'pass', request, repo).envelope;
    for (const v of [1, 2]) {
      const request: any = attempt(sid, { v, findings: [v === 1 ? finding('F1') : att('F1', ['core'])] });
      expect(validRecord(wrap(request)), `v${v}: schema`).toBe(false);
      expect(refused(request), `v${v}`).toMatchObject({ status: 'unavailable', reason: 'invalid-input' });
    }
    const passId = u(), attemptId = u();
    const others: Array<Record<string, unknown>> = [
      { state: 'started', required_voice_ids: ['testing'] },
      { state: 'voice-complete', voice_id: 'testing', voice_status: 'completed', selected_attempt_id: attemptId },
      { state: 'completed' },
    ];
    for (const extra of others) {
      const request = { ...base(sid), v: 3, pass_id: passId, scope: 'local', ...extra, delegate: delegate() };
      expect(validRecord(wrap(request)), `${extra.state}: schema`).toBe(false);
      expect(refused(request), String(extra.state)).toMatchObject({ status: 'unavailable', reason: 'invalid-input' });
    }
    expect(refused(attempt(sid, { v: 4 }))).toMatchObject({ reason: 'unsupported-version', diagnostics: { expected: '1|2|3', actual: 4 } });
    expect(ledgerLines(fix, sid)).toHaveLength(lines);
    // v3 findings take the v2 shape: a v1-shaped finding on a v3 attempt is invalid.
    expect(refused(attempt(sid, { findings: [finding('F1')] })).reason).toBe('invalid-input');
  }, 90_000);

  test('a read reports per provider label: usage without replays, fallbacks by reason, and found/accepted/rejected after corrections', () => {
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u();
    const first = passV3(sid, [
      { voice: 'testing', tries: [{ delegate: delegate(), findings: [att('T1', ['specialist:testing']), att('T2', ['specialist:testing'])] }] },
      // alpha-less fallback: beta times out, then the host runs the part and names the delegate attempt as its predecessor
      { voice: 'maintainability', tries: [{ outcome: 'failed', delegate: fellBack({ provider: 'beta', model: 'model-b', wall_ms: 5000 }) }, { findings: [att('M1', ['specialist:maintainability'])] }] },
      { voice: 'performance', tries: [{ delegate: delegate({ provider: 'beta', model: 'model-b', wall_ms: 2000, input_tokens: 7, output_tokens: 3, cache_read_input_tokens: null, cache_creation_input_tokens: null }),
        findings: [att('P1', ['specialist:performance'])] }] },
    ]);
    const replay = passV3(sid, [
      { voice: 'testing', tries: [{ delegate: delegate({ replay: true }), findings: [att('T3', ['specialist:testing'])] }] },
    ], 3000);
    craft(fix, sid, [...runRows(sid).rows, ...first.rows, ...replay.rows,
      { op: 'correction', at: 2100, request: { ...base(sid), correction_kind: 'finding', finding_id: 'T2', pass_id: first.passId, voice_id: 'testing', attempt_id: first.ids.testing![0], adjudication: 'rejected', resolution: 'unknown' } }]);
    const data = read(fix, sid).envelope.data;
    expect(data.capture).toBe('ok');
    expect(data.local_passes).toBe(2);
    expect(data.delegated).toEqual({
      alpha: { attempts: 2, credited: 2, fell_back: 0, by_reason: {}, wall_ms: 1200, input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10,
        cache_creation_input_tokens: 5, tokens_unreported: 0, reported: 3, accepted: 2, rejected: 1 },
      beta: { attempts: 2, credited: 1, fell_back: 1, by_reason: { timeout: 1 }, wall_ms: 7000, input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0, tokens_unreported: 1, reported: 1, accepted: 1, rejected: 0 },
    });
    expect(Object.keys(data.delegated)).toEqual(['alpha', 'beta']);
    // the part counts are untouched by delegation: the delegate's findings are the specialist's findings
    expect(data.findings.by_part['specialist:testing']).toEqual({ reported: 3, accepted: 2, rejected: 1 });
    expect(data.findings.by_part['specialist:maintainability']).toEqual({ reported: 1, accepted: 1, rejected: 0 });
    expect(data.receipt_text).not.toContain('delegated'); // the receipt line is unchanged
  }, 60_000);

  // Value: protects=provider usage and findings share the pass-scoped attempt identity;
  // fails_when=a reused attempt ID loses a provider or transfers its findings; why_new=existing passes use distinct IDs.
  test('reused attempt IDs in distinct passes keep provider usage and findings aligned, including replays', () => {
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u(), sharedAttempt = u();
    const run = runRows(sid);
    const beta = { provider: 'beta', model: 'model-b', wall_ms: 2400, input_tokens: 200, output_tokens: 100,
      cache_read_input_tokens: 20, cache_creation_input_tokens: 10 };
    const passes = [
      passV3(sid, [{ voice: 'testing', tries: [{ delegate: delegate(), findings: [att('A1', ['specialist:testing'])] }] }]),
      passV3(sid, [{ voice: 'testing', tries: [{ delegate: delegate(beta), findings: [att('B1', ['specialist:testing'])] }] }], 3000),
      passV3(sid, [{ voice: 'testing', tries: [{ delegate: delegate({ ...beta, replay: true }), findings: [att('B2', ['specialist:testing'])] }] }], 4000),
    ];
    for (const pass of passes) {
      for (const row of pass.rows) {
        if (row.request.state === 'attempt') row.request.attempt_id = sharedAttempt;
        if (row.request.state === 'voice-complete') row.request.selected_attempt_id = sharedAttempt;
      }
    }
    craft(fix, sid, [...run.rows, ...passes.flatMap(pass => pass.rows),
      { op: 'correction', at: 4100, request: { ...base(sid), correction_kind: 'finding', finding_id: 'B2', pass_id: passes[2]!.passId,
        voice_id: 'testing', attempt_id: sharedAttempt, adjudication: 'rejected', resolution: 'unknown' } },
      { op: 'end', at: 4200, request: { ...base(sid), step_id: run.step, outcome: 'completed' } }]);
    const data = read(fix, sid).envelope.data;
    expect(data.capture).toBe('ok');
    expect(data.unknown_reasons).toEqual([]);
    expect(data.local_passes).toBe(3);
    expect(data.findings).toMatchObject({ accepted: 2, rejected: 1 });
    expect(data.delegated).toEqual({
      alpha: { attempts: 1, credited: 1, fell_back: 0, by_reason: {}, wall_ms: 1200, input_tokens: 100, output_tokens: 50,
        cache_read_input_tokens: 10, cache_creation_input_tokens: 5, tokens_unreported: 0, reported: 1, accepted: 1, rejected: 0 },
      beta: { attempts: 2, credited: 2, fell_back: 0, by_reason: {}, wall_ms: 2400, input_tokens: 200, output_tokens: 100,
        cache_read_input_tokens: 20, cache_creation_input_tokens: 10, tokens_unreported: 0, reported: 2, accepted: 1, rejected: 1 },
    });
  }, 60_000);

  test('earlier ledgers read unchanged: a v1-only and a v2-only ledger report delegated {}', () => {
    const fix = makeTelemetryFixture('community');
    const old = 'extend-' + u(), attributed = 'extend-' + u();
    craft(fix, old, [...runRows(old).rows, ...passRows(old, { voices: [{ voice: 'core', findings: [finding('F1', { resolution: 'fixed' }), finding('F2')] }] }).rows]);
    const v2 = passRows(attributed, { voices: [{ voice: 'testing', findings: [att('S1', ['specialist:testing'])] }] });
    craft(fix, attributed, [...runRows(attributed).rows, ...v2.rows.map(r => ({ ...r, request: { ...r.request, v: 2 } }))]);
    const before = read(fix, old).envelope.data;
    expect(before.delegated).toEqual({});
    expect(before.findings).toMatchObject({ accepted: 2, fixed: 1, open: 1 });
    expect(before.findings.by_part).toEqual({});
    const after = read(fix, attributed).envelope.data;
    expect(after.delegated).toEqual({});
    expect(after.findings.by_part).toEqual({ 'specialist:testing': { reported: 1, accepted: 1, rejected: 0 } });
  }, 60_000);

  test('nine provider labels null the delegated block with too-many-providers and the read stays ok; eight are reported', () => {
    const fix = makeTelemetryFixture('community');
    for (const [n, over] of [[8, false], [9, true]] as const) {
      const sid = 'extend-' + u();
      const voices = Array.from({ length: n }, (_, i) => ({ voice: `part${i}`, tries: [{ delegate: delegate({ provider: `p${i}` }), findings: [] as any[] }] }));
      craft(fix, sid, [...runRows(sid).rows, ...passV3(sid, voices).rows]);
      const data = read(fix, sid).envelope.data;
      expect(data.capture).toBe('ok');
      if (over) {
        expect(data.delegated).toBeNull();
        expect(data.unknown_reasons).toContain('too-many-providers');
      } else {
        expect(Object.keys(data.delegated)).toHaveLength(8);
        expect(data.unknown_reasons).not.toContain('too-many-providers');
      }
    }
  }, 60_000);

  // Coverage audit (/ship Step 7, Track 64C).
  // Value: protects=incomplete passes retain delegate usage but leave finding counts unknown;
  // fails_when=an incomplete pass reports zero findings or discards observed delegate usage;
  // why_new=the existing integrity case only checks that the whole delegate block is null;
  // seam=none; no_claim=real provider acceptance (synthetic ledger; real metrics reader).
  test('the delegated block is null under an integrity unknown, and its finding counts are null when the local findings are unknown', () => {
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u();
    const pass = passV3(sid, [{ voice: 'testing', tries: [{ delegate: delegate(), findings: [att('T1', ['specialist:testing'])] }] }]);
    // An unfinished pass has valid observed spend, but no selected findings can be counted yet.
    craft(fix, sid, [...runRows(sid).rows, ...pass.rows.filter(row => row.request.state !== 'completed')]);
    const incomplete = read(fix, sid).envelope.data;
    expect(incomplete.capture).toBe('ok');
    expect(incomplete.unknown_reasons).toContain('incomplete-pass');
    expect(incomplete.findings).toBeNull();
    expect(incomplete.delegated).toEqual({
      alpha: { attempts: 1, credited: 1, fell_back: 0, by_reason: {}, wall_ms: 1200, input_tokens: 100,
        output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 5, tokens_unreported: 0,
        reported: null, accepted: null, rejected: null },
    });
    // a correction that names no recorded finding is a missing reference: the read is partial and delegated is null
    craft(fix, sid, [...runRows(sid).rows, ...pass.rows,
      { op: 'correction', at: 2100, request: { ...base(sid), correction_kind: 'finding', finding_id: 'NOPE', pass_id: pass.passId, adjudication: 'rejected', resolution: 'unknown' } }]);
    const data = read(fix, sid).envelope.data;
    expect(data.capture).toBe('partial');
    expect(data.delegated).toBeNull();
  }, 60_000);

  test('validRecord accepts good v3 records and rejects bad ones', () => {
    const sid = 'extend-' + u();
    expect(validRecord(wrap(attempt(sid)))).toBe(true);
    const failedAttempt: any = attempt(sid, { delegate: fellBack(), attempt_outcome: 'failed' });
    delete failedAttempt.findings;
    expect(validRecord(wrap(failedAttempt))).toBe(true);
    expect(validRecord(wrap(attempt(sid, { delegate: delegate({ outcome: 'fell-back', fallback_reason: 'timeout' }) })))).toBe(false);
    expect(validRecord(wrap(attempt(sid, { v: 2 })))).toBe(false);
    expect(validRecord(wrap({ ...base(sid), v: 3, pass_id: u(), scope: 'local', state: 'completed', delegate: delegate() }))).toBe(false);
    expect(validRecord(wrap(attempt(sid, { v: 4 })))).toBe(false);
  });

  test('the helper, schema, runner, docs and skill share the fallback reasons and the label grammar', async () => {
    const dumped = spawnSync('python3', ['-B', '-I', '-c', [
      'import importlib.util, json',
      `spec = importlib.util.spec_from_file_location("workflow_metrics", ${JSON.stringify(join(ROOT, 'bin/lib/workflow_metrics.py'))})`,
      'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
      'print(json.dumps({"reasons": list(m.FALLBACK_REASONS), "label": m.DELEGATE_LABEL_RE.pattern, "outcomes": list(m.DELEGATE_OUTCOMES), "providers": m.MAX_PROVIDERS, "passes": list(m.PASS_VERSIONS)}))',
    ].join('\n')], { encoding: 'utf8', timeout: 15_000 });
    expect(dumped.status).toBe(0);
    const helper = JSON.parse(dumped.stdout) as { reasons: string[]; label: string; outcomes: string[]; providers: number; passes: number[] };
    const { FALLBACK_REASONS, LABEL_RE, MODEL_RE } = await import('../src/review-delegate/delegate');
    expect(helper.reasons).toEqual([...FALLBACK_REASONS]);
    expect(helper.label).toBe(LABEL_RE.source.replace(/^\^|\$$/g, ''));
    expect(helper.passes).toEqual([1, 2, 3]);
    const def = schema.definitions.delegate;
    expect(def.properties.fallback_reason.enum.filter((r: string | null) => r !== null)).toEqual(helper.reasons);
    expect(def.properties.outcome.enum).toEqual(helper.outcomes);
    expect(def.properties.provider.pattern).toBe(`^${helper.label}$`);
    expect(schema.definitions.safe_id.pattern).toBe(MODEL_RE.source);
    expect(schema.definitions.unknown_reason.enum).toContain('too-many-providers');
    const docs = readFileSync(join(ROOT, 'docs/telemetry.md'), 'utf8').replace(/\s+/g, ' ');
    const skill = readFileSync(join(ROOT, 'skills/review-and-prep.md'), 'utf8').replace(/\s+/g, ' ');
    const delegated = skill.slice(skill.indexOf('### Delegate named specialist parts'), skill.indexOf('### Reopen review only for behavior-changing repairs'));
    for (const reason of helper.reasons) {
      expect(docs, reason).toContain('`' + reason + '`');
      expect(delegated, reason).toContain('`' + reason + '`');
    }
    expect(docs).toContain(`more than ${helper.providers} distinct provider labels`);
    expect(docs).toContain('`too-many-providers`');
    expect(helper.label).toBe('[a-z][a-z0-9-]{0,31}');
  });
});

// Coverage audit (/ship Step 7, 2026-11-02).
// Value: protects=both scopes retain 24 maximum-length part labels alongside full phase/wait summaries and event reconciliation within 16 KiB;
//   fails_when=attribution growth makes a valid full read fall back to capacity or lose summary data;
//   why_new=existing envelope cases use short labels and omit full phase/wait summaries and event lookup;
//   seam=none; no_claim=installed-agent attribution accuracy or arbitrary ledger size (schema-valid imported records in an isolated HOME)
test('maximum-length attribution in both scopes preserves a full read and event lookup within 16 KiB', () => {
  const fix = makeTelemetryFixture('community');
  const sid = 'extend-' + u();
  const run = runRows(sid);
  const phases = ['run', 'evidence', 'scope', 'base-integration', 'local-pass', 'voice', 'completion', 'pregate',
    'coverage', 'documentation', 'tests', 'commit', 'publication', 'external-review', 'triage', 'fix', 'readiness',
    'handoff', 'reuse', 'release', 'ship', 'landing'];
  const waits = ['human', 'external-review', 'checks', 'deploy', 'tool', 'other'];
  const rows: any[] = [...run.rows];
  for (const phase of phases.filter(p => p !== 'run')) {
    const step = u();
    rows.push(
      { op: 'decision', at: 1999, request: { ...base(sid), step_id: step, phase, decision: 'RUN', reason: 'required' } },
      { op: 'begin', at: 2000, request: { ...base(sid), step_id: step, parent_step_id: run.step, kind: phase === 'fix' ? 'fix' : 'phase', phase } },
      { op: 'end', at: 2100, request: { ...base(sid), step_id: step, outcome: 'completed' } },
    );
  }
  for (const wait_category of waits) {
    const step = u();
    rows.push(
      { op: 'begin', at: 2200, request: { ...base(sid), step_id: step, parent_step_id: run.step, kind: 'wait', wait_category } },
      { op: 'end', at: 2300, request: { ...base(sid), step_id: step, outcome: 'completed' } },
    );
  }
  const labels = Array.from({ length: 24 }, (_, i) => `specialist:${`s${i}`.padEnd(64, 'x')}`);
  for (const scope of ['local', 'greptile']) {
    const findings = labels.map((label, i) => finding(`${scope}-${i}`, { found_by: [label], attribution_reason: null }));
    rows.push(...passRows(sid, { scope, at: 3000, voices: [{ voice: 'testing', findings }] }).rows
      .map(row => ({ ...row, request: { ...row.request, v: 2 } })));
  }
  const end = { ...base(sid), step_id: run.step, outcome: 'completed' };
  rows.push({ op: 'end', at: 4000, request: end });
  const ledger = craft(fix, sid, rows);
  const before = readFileSync(ledger, 'utf8');
  const { envelope, stdout } = read(fix, sid, end.event_id);
  expect(envelope).toMatchObject({ status: 'ok', reason: null, data: { capture: 'ok', unknown_reasons: [], local_passes: 1, greptile_passes: 1 } });
  const expectedParts = Object.fromEntries(labels.map(label => [label, { reported: 1, accepted: 1, rejected: 0 }]));
  for (const totals of [envelope.data.findings, envelope.data.greptile_findings]) {
    expect(totals.accepted).toBe(24);
    expect(totals.by_part).toEqual(expectedParts);
  }
  expect(envelope.data.phases.map((phase: any) => phase.phase)).toEqual([...phases].sort());
  expect(envelope.data.phases.every((phase: any) => phase.steps_completed === 1 && phase.observed_wall_duration_ms > 0)).toBe(true);
  expect(envelope.data.waits).toEqual([...waits].sort().map(wait_category => ({ wait_category, count: 1, observed_wall_duration_ms: 100, unknown_durations: 0 })));
  expect(envelope.data.event).toEqual({ status: 'match', request_digest: createHash('sha256').update(canonical({ op: 'end', request: end })).digest('hex'), captured_at_ms: 4000 });
  expect(Buffer.byteLength(stdout)).toBeLessThanOrEqual(16 * 1024);
  expect(Buffer.byteLength(envelope.data.receipt_text)).toBeLessThanOrEqual(2 * 1024);
  expect(readFileSync(ledger, 'utf8')).toBe(before);
}, 120_000);

// Coverage audit (/ship Step 7, 2026-11-02).
// Value: protects=ambiguous finding corrections leave both attribution summaries null in each affected scope;
//   fails_when=unknown attribution becomes an empty or populated count map despite unresolved correction targets;
//   why_new=existing ambiguous-correction tests assert scalar nulls without checking the new attribution fields;
//   seam=none; no_claim=installed-agent correction accuracy (schema-valid imported records in an isolated HOME)
test('ambiguous finding corrections leave both scopes attribution unknown', () => {
  const fix = makeTelemetryFixture('community');
  const sid = 'extend-' + u();
  const rows: any[] = [...runRows(sid).rows];
  for (const scope of ['local', 'greptile']) {
    const findings = [finding('F1', { found_by: [scope === 'local' ? 'core' : 'greptile'], attribution_reason: null })];
    rows.push(...passRows(sid, { scope, voices: [{ voice: 'testing', findings }] }).rows
      .map(row => ({ ...row, request: { ...row.request, v: 2 } })));
  }
  rows.push({ op: 'correction', at: 3000, request: { ...base(sid), correction_kind: 'finding', finding_id: 'F1', resolution: 'fixed' } });
  craft(fix, sid, rows);
  const { envelope } = read(fix, sid);
  expect(envelope.status).toBe('partial');
  expect(envelope.data.unknown_reasons).toContain('competing-correction');
  for (const totals of [envelope.data.findings, envelope.data.greptile_findings]) {
    expect(totals.accepted).toBeNull();
    expect(totals.by_part).toBeNull();
    expect(totals.unattributed).toBeNull();
  }
}, 120_000);

describe('Track 67A run token usage capture and read --usage', () => {
  const FIXTURE_DIR = join(ROOT, 'tests/fixtures/run-usage');
  const T0 = Date.parse('2026-01-01T00:00:00Z');
  const T_END = Date.parse('2026-01-01T00:01:00Z');

  function readUsage(fix: TelemetryFixture, sid: string, extraArgs: string[] = []) {
    return runRaw(fix.env, ['metrics', 'read', '--session-id', sid, '--usage', ...extraArgs]);
  }

  function loadFixtureText(name: string, replacements: Record<string, string> = {}) {
    let text = readFileSync(join(FIXTURE_DIR, name), 'utf8');
    for (const [k, v] of Object.entries(replacements)) {
      text = text.split(k).join(v);
    }
    return text;
  }

  function runPythonCollect(fix: TelemetryFixture, scriptLines: string[]) {
    const driver = join(fix.home, `collect-${randomUUID()}.py`);
    writeFileSync(driver, [
      'import importlib.util, json, os, sys',
      `sys.path.insert(0, ${JSON.stringify(join(ROOT, 'bin/lib'))})`,
      'import telemetry_usage as tu, workflow_metrics as wm',
      ...scriptLines,
    ].join('\n'));
    const res = spawnSync('python3', ['-B', '-I', driver], { env: fix.env, cwd: fix.home, encoding: 'utf8', timeout: 15_000 });
    expect(res.status, res.stderr || res.stdout).toBe(0);
    return JSON.parse(res.stdout);
  }

  test('Claude streaming dedup, nested toolUseId linkage, voices join, cli_reported separation, and privacy sentinels', () => {
    const fix = makeTelemetryFixture('community');
    const repo = join(fix.home, 'work-repo');
    mkdirSync(repo, { recursive: true });
    const projDir = join(fix.home, '.claude/projects/work-repo');
    const subDir = join(projDir, 'syn-claude-parent-001/subagents');
    mkdirSync(subDir, { recursive: true });

    writeFileSync(join(projDir, 'syn-claude-parent-001.jsonl'), loadFixtureText('claude-parent.jsonl', { __CWD__: repo }));
    writeFileSync(join(subDir, 'agent-syn-claude-sub-001.jsonl'), loadFixtureText('claude-subagent.jsonl', { __CWD__: repo }));
    writeFileSync(join(subDir, 'agent-syn-claude-nested-001.jsonl'), loadFixtureText('claude-nested-linked.jsonl', { __CWD__: repo }));
    writeFileSync(join(subDir, 'agent-syn-claude-nested-001.meta.json'), JSON.stringify({ spawnDepth: 2, toolUseId: 'toolu_nested_001' }));
    writeFileSync(join(subDir, 'agent-syn-claude-nested-unlinked.jsonl'), loadFixtureText('claude-nested-unlinked.jsonl', { __CWD__: repo }));
    writeFileSync(join(subDir, 'agent-syn-claude-nested-unlinked.meta.json'), JSON.stringify({ spawnDepth: 2, toolUseId: 'toolu_missing_999' }));

    const sid = 'extend-' + u();
    const stepLocal = u(), stepTests = u();
    const run = runRows(sid, T0);
    const p = passRows(sid, { at: T0 + 13_000, voices: [{ voice: 'red-team', findings: [] }] });
    const passId = p.passId;
    const attemptId = p.attempts['red-team']!;
    const voicesDir = join(fix.home, '.gstack/projects/work-repo/review-and-prep');
    mkdirSync(voicesDir, { recursive: true });
    writeFileSync(join(voicesDir, 'voices.jsonl'), loadFixtureText('voices.jsonl', {
      __SESSION_ID__: sid,
      '22222222-2222-4222-8222-222222222222': passId,
      '33333333-3333-4333-8333-333333333333': attemptId,
    }));

    craft(fix, sid, [
      ...run.rows,
      { op: 'begin', at: T0 + 2_000, request: { ...base(sid), step_id: stepLocal, parent_step_id: run.step, kind: 'phase', phase: 'local-pass' } },
      { op: 'end', at: T0 + 40_000, request: { ...base(sid), step_id: stepLocal, outcome: 'completed' } },
      { op: 'begin', at: T0 + 42_000, request: { ...base(sid), step_id: stepTests, parent_step_id: run.step, kind: 'phase', phase: 'tests' } },
      { op: 'end', at: T0 + 58_000, request: { ...base(sid), step_id: stepTests, outcome: 'completed' } },
      ...p.rows,
    ]);

    const collected = runPythonCollect(fix, [
      `os.environ["CLAUDE_CODE_SESSION_ID"] = "syn-claude-parent-001"`,
      `status = wm.capture_usage(${JSON.stringify(sid)}, "review-and-prep", ${T0 / 1000}, ${T_END / 1000}, "claude", ${JSON.stringify(repo)}, home=${JSON.stringify(fix.home)})`,
      `print(json.dumps({"status": status}))`,
    ]);
    expect(collected.status).toBe('recorded');

    const lines = ledgerLines(fix, sid).map(l => JSON.parse(l));
    const usageLine = lines[lines.length - 1]!;
    expect(usageLine.v).toBe(2);
    expect(usageLine.op).toBe('usage');
    expect(validRecord(usageLine)).toBe(true);

    // Criterion 11 privacy check: no raw session/agent IDs, paths or content sentinels in stored line or projection.
    const rawLedgerText = readFileSync(ledgerFile(fix, sid), 'utf8');
    const usageRead = readUsage(fix, sid);
    const usageEnv = JSON.parse(usageRead.stdout);
    expect(usageEnv.status).toBe('ok');
    for (const forbidden of [
      'syn-claude-parent-001',
      'syn-claude-sub-001',
      'syn-claude-nested-001',
      'syn-claude-nested-unlinked',
      'SYNTHETIC_PROMPT_SENTINEL_DO_NOT_STORE',
      'SYNTHETIC_REPLY_SENTINEL',
      repo,
    ]) {
      expect(rawLedgerText).not.toContain(forbidden);
      expect(usageRead.stdout).not.toContain(forbidden);
    }

    // Streaming dedup: msg-stream-1 output counted once at 40 (+ msg-turn-2 output 60 + subagent 75 + nested 15 + unlinked 12 = 202).
    // Input: 100 + 200 + 300 + 50 + 40 = 690. Cache read: 50 + 80 + 10 + 0 + 0 = 140. Cache write: 20 + 0 + 5 + 0 + 0 = 25. Reasoning: null (not-reported on Claude).
    const uData = usageEnv.data;
    expect(uData.harness).toBe('claude');
    expect(uData.reasons).toContain('window-not-reported');
    expect(uData.reasons).toContain('not-reported');
    expect(uData.totals.direct).toMatchObject({
      input: 690,
      cache_read: 140,
      cache_write: 25,
      output: 202,
      reasoning: null,
      null_reasons: ['not-reported'],
    });
    expect(uData.by_phase['local-pass'].direct).toMatchObject({ input: 490, output: 142 });
    expect(uData.by_phase['tests'].direct).toMatchObject({ input: 200, output: 60 });
    expect(uData.children).toMatchObject({ direct: 3, correlated: 0, unknown: 0 });

    // Nested linked child has parent_ref pointing to subagent; unlinked depth-2 child has parent_ref null.
    const nestedSources = usageLine.request.sources.filter((s: any) => s.relation === 'nested');
    expect(nestedSources).toHaveLength(2);
    expect(nestedSources.filter((s: any) => s.parent_ref !== null)).toHaveLength(1);
    expect(nestedSources.filter((s: any) => s.parent_ref === null)).toHaveLength(1);

    // Voices join & cli_reported kept separate from log totals.
    expect(uData.by_pass).toHaveLength(1);
    expect(uData.by_pass[0]).toMatchObject({
      pass_id: passId,
      attempt_id: attemptId,
      voice_id: 'red-team',
      link_evidence: 'direct',
      input: 350, // subagent (300) + linked nested child (50)
      output: 90, // subagent (75) + linked nested child (15)
    });
    expect(uData.cli_reported).toEqual([{
      voice_id: 'red-team',
      link: { pass_id: passId, attempt_id: attemptId, voice_id: 'red-team', pass: 1, attempt: 1 },
      input_tokens: 315,
      output_tokens: 75,
      cache_read_input_tokens: 10,
      cache_creation_input_tokens: 5,
    }]);

    // A child ID alone admits an older voice row without a metrics session ID.
    const childOnly = JSON.parse(readFileSync(join(voicesDir, 'voices.jsonl'), 'utf8'));
    delete childOnly.metrics.session_id;
    writeFileSync(join(voicesDir, 'voices.jsonl'), JSON.stringify(childOnly) + '\n');
    const fallback = runPythonCollect(fix, [
      `req = tu.collect("claude", "syn-claude-parent-001", ${T0}, ${T_END}, ${JSON.stringify(repo)}, "review-and-prep", ${JSON.stringify(sid)}, {}, home=${JSON.stringify(fix.home)})`,
      'print(json.dumps(req))',
    ]);
    expect(fallback.sources.find((s: any) => s.relation === 'subagent').link).toMatchObject({ pass_id: passId, attempt_id: attemptId });
    expect(fallback.cli_reported).toEqual(uData.cli_reported);
  }, 60_000);

  test('Codex cumulative deltas, counter reset epoch, subagent_history_start_ordinal, grandchild lineage, mid-file tail seed, and window reset_crossed', () => {
    const fix = makeTelemetryFixture('community');
    const repo = join(fix.home, 'codex-repo');
    mkdirSync(repo, { recursive: true });
    const sessDir = join(fix.home, '.codex/sessions/2026/01/01');
    mkdirSync(sessDir, { recursive: true });

    const parentTid = '01940000-0000-7000-8000-000000000001';
    const childTid = '01940000-0000-7000-8000-000000000002';
    const grandTid = '01940000-0000-7000-8000-000000000003';
    writeFileSync(join(sessDir, `rollout-2026-01-01T00-00-00-${parentTid}.jsonl`), loadFixtureText('codex-parent.jsonl', { __CWD__: repo }));
    writeFileSync(join(sessDir, `rollout-2026-01-01T00-00-12-${childTid}.jsonl`), loadFixtureText('codex-subagent.jsonl', { __CWD__: repo }));
    writeFileSync(join(sessDir, `rollout-2026-01-01T00-00-19-${grandTid}.jsonl`), loadFixtureText('codex-grandchild.jsonl', { __CWD__: repo }));

    const sid = 'extend-' + u();
    const run = runRows(sid, T0);
    craft(fix, sid, run.rows);

    const res = runPythonCollect(fix, [
      `os.environ["CODEX_THREAD_ID"] = ${JSON.stringify(parentTid)}`,
      `status = wm.capture_usage(${JSON.stringify(sid)}, "review-and-prep", ${T0 / 1000}, ${T_END / 1000}, "codex", ${JSON.stringify(repo)}, home=${JSON.stringify(fix.home)})`,
      `print(json.dumps({"status": status}))`,
    ]);
    expect(res.status).toBe('recorded');

    const usageEnv = JSON.parse(readUsage(fix, sid).stdout);
    expect(usageEnv.status).toBe('ok');
    const uData = usageEnv.data;
    // Parent: turn 1 (input 400 uncached + 100 cached, out 80, reasoning 20)
    //       + turn 2 delta (input 200 uncached + 200 cached, out 70, reasoning 30)
    //       + turn 3 reset epoch (input 200 uncached + 50 cached, out 40, reasoning 10)
    //       = parent input 800, cache_read 350, output 190, reasoning 60
    // Child (ordinals 0 and 1 skipped because subagent_history_start_ordinal=2):
    //       ordinal 2 (total 160, cached 40 -> input 120, cache_read 40, output 35, reasoning 5)
    // Grandchild (depth 2 via parent_thread_id chain):
    //       (total 90, cached 10 -> input 80, cache_read 10, output 25, reasoning 5)
    expect(uData.totals.direct).toMatchObject({
      input: 1000,
      cache_read: 400,
      cache_write: null,
      output: 250,
      reasoning: 70,
      null_reasons: ['not-reported'],
    });
    expect(uData.children).toMatchObject({ direct: 2, correlated: 0, unknown: 0 });
    expect(uData.windows.length).toBeGreaterThanOrEqual(2);
    for (const w of uData.windows) {
      expect(w.attributable).toBe(false);
      expect(w).not.toHaveProperty('credits');
      expect(w).not.toHaveProperty('plan_type');
    }

    // Keep exactly the final two counter rows: the first seeds, the second starts a new epoch.
    const parentLines = loadFixtureText('codex-parent.jsonl', { __CWD__: repo }).trim().split('\n');
    const tailBytes = Buffer.byteLength(parentLines.slice(-2).join('\n') + '\n') + 1;
    const midRes = runPythonCollect(fix, [
      `tu.MAX_TAIL_BYTES = ${tailBytes}`,
      `req = tu.collect("codex", ${JSON.stringify(parentTid)}, ${T0}, ${T_END}, ${JSON.stringify(repo)}, "review-and-prep", ${JSON.stringify(sid)}, {}, home=${JSON.stringify(fix.home)})`,
      'print(json.dumps(req))',
    ]);
    expect(midRes.reasons).toContain('log-truncated');
    expect(midRes.buckets.filter((b: any) => midRes.sources[b.source].relation === 'own')).toEqual([
      expect.objectContaining({ input: 200, cache_read: 50, output: 40, reasoning: 10, responses: 1 }),
    ]);

    // Account reset is independent of cumulative token counter reset.
    const resetRows = parentLines.map(line => JSON.parse(line));
    const finalLimits = resetRows.at(-1).payload.rate_limits;
    finalLimits.primary.resets_at += 120;
    finalLimits.secondary.used_percent = 2;
    writeFileSync(join(sessDir, `rollout-2026-01-01T00-00-00-${parentTid}.jsonl`), resetRows.map(row => JSON.stringify(row)).join('\n') + '\n');
    const resetRes = runPythonCollect(fix, [
      `req = tu.collect("codex", ${JSON.stringify(parentTid)}, ${T0}, ${T_END}, ${JSON.stringify(repo)}, "review-and-prep", ${JSON.stringify(sid)}, {}, home=${JSON.stringify(fix.home)})`,
      'print(json.dumps(req))',
    ]);
    for (const slot of ['primary', 'secondary']) {
      const windows = resetRes.windows.filter((w: any) => w.slot === slot);
      expect(windows[0].reset_crossed).toBe(false);
      expect(windows.at(-1).reset_crossed).toBe(true);
    }
  }, 60_000);

  test('concurrent foreign session makes unlinked cross-harness candidates unknown/ambiguous; distinct voices.jsonl intervals correlate two outside calls', () => {
    const fix = makeTelemetryFixture('community');
    const repo = join(fix.home, 'shared-repo');
    mkdirSync(repo, { recursive: true });
    const projDir = join(fix.home, '.claude/projects/shared-repo');
    const codexDir = join(fix.home, '.codex/sessions/2026/01/01');
    mkdirSync(projDir, { recursive: true });
    mkdirSync(codexDir, { recursive: true });

    writeFileSync(join(projDir, 'syn-claude-parent-001.jsonl'), loadFixtureText('claude-parent.jsonl', { __CWD__: repo }));

    // Two outside Codex rollouts in the same worktree during the run window.
    const out1 = '01940000-0000-7000-8000-000000000011';
    const out2 = '01940000-0000-7000-8000-000000000012';
    writeFileSync(join(codexDir, `rollout-2026-01-01T00-00-15-${out1}.jsonl`), [
      JSON.stringify({ timestamp: '2026-01-01T00:00:15Z', type: 'session_meta', payload: { id: out1, cwd: repo, model: 'gpt-5.4' } }),
      JSON.stringify({ timestamp: '2026-01-01T00:00:18Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 110, cached_input_tokens: 10, output_tokens: 20, reasoning_output_tokens: 0, total_tokens: 130 } } } }),
    ].join('\n') + '\n');
    writeFileSync(join(codexDir, `rollout-2026-01-01T00-00-40-${out2}.jsonl`), [
      JSON.stringify({ timestamp: '2026-01-01T00:00:40Z', type: 'session_meta', payload: { id: out2, cwd: repo, model: 'gpt-5.4' } }),
      JSON.stringify({ timestamp: '2026-01-01T00:00:44Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 220, cached_input_tokens: 20, output_tokens: 30, reasoning_output_tokens: 0, total_tokens: 250 } } } }),
    ].join('\n') + '\n');

    // Case 1: With two distinct voices.jsonl intervals and no foreign session, both outside calls are correlated.
    const sid1 = 'extend-' + u();
    const voicesDir = join(fix.home, '.gstack/projects/shared-repo/review-and-prep');
    mkdirSync(voicesDir, { recursive: true });
    writeFileSync(join(voicesDir, 'voices.jsonl'), [
      JSON.stringify({
        v: 1, stage: 'review-and-prep', recorded_at: '2026-01-01T00:00:20Z', pass: 1, attempt: 1, scope: 'full',
        voice_id: 'outside-challenge', host: 'codex', subagent_ref: { kind: 'outside-process', id: null, name: 'codex' },
        dispatched_at: '2026-01-01T00:00:14Z', returned_at: '2026-01-01T00:00:20Z', time_basis: 'parent-observed',
        outcome: 'completed', metrics: { session_id: sid1, pass_id: null, attempt_id: null },
      }),
      JSON.stringify({
        v: 1, stage: 'review-and-prep', recorded_at: '2026-01-01T00:00:46Z', pass: 1, attempt: 1, scope: 'full',
        voice_id: 'outside-structured', host: 'codex', subagent_ref: { kind: 'outside-process', id: null, name: 'codex' },
        dispatched_at: '2026-01-01T00:00:39Z', returned_at: '2026-01-01T00:00:46Z', time_basis: 'parent-observed',
        outcome: 'completed', metrics: { session_id: sid1, pass_id: null, attempt_id: null },
      }),
    ].join('\n') + '\n');

    craft(fix, sid1, runRows(sid1, T0).rows);
    runPythonCollect(fix, [
      `os.environ["CLAUDE_CODE_SESSION_ID"] = "syn-claude-parent-001"`,
      `print(json.dumps(wm.capture_usage(${JSON.stringify(sid1)}, "review-and-prep", ${T0 / 1000}, ${T_END / 1000}, "claude", ${JSON.stringify(repo)}, home=${JSON.stringify(fix.home)})))`,
    ]);
    const corrData = JSON.parse(readUsage(fix, sid1).stdout).data;
    expect(corrData.children.correlated).toBe(2);
    expect(corrData.totals.correlated).toMatchObject({ input: 300, cache_read: 30, output: 50 });
    expect(corrData.by_pass).toEqual([
      expect.objectContaining({ pass_id: null, pass: 1, attempt_id: null, attempt: 1,
        voice_id: 'outside-challenge', link_evidence: 'correlated', input: 100, output: 20 }),
      expect.objectContaining({ pass_id: null, pass: 1, attempt_id: null, attempt: 1,
        voice_id: 'outside-structured', link_evidence: 'correlated', input: 200, output: 30 }),
    ]);
    const correlatedSources = ledgerLines(fix, sid1).map(line => JSON.parse(line))
      .find(row => row.op === 'usage').request.sources.filter((s: any) => s.relation === 'cross-harness');
    expect(correlatedSources.map((s: any) => ({ link: s.link, evidence: s.link_evidence })))
      .toEqual(expect.arrayContaining(['outside-challenge', 'outside-structured'].map(voice_id => ({
        link: { pass_id: null, pass: 1, attempt_id: null, attempt: 1, voice_id }, evidence: 'correlated',
      }))));

    // Case 2: Plant a foreign session already active before T0 and still active after T0 in the same checkout.
    writeFileSync(join(projDir, 'syn-foreign-active.jsonl'), [
      JSON.stringify({ type: 'user', sessionId: 'syn-foreign-active', timestamp: '2025-12-31T23:59:00Z', cwd: repo, message: { role: 'user', content: 'foreign' } }),
      JSON.stringify({ type: 'assistant', sessionId: 'syn-foreign-active', timestamp: '2026-01-01T00:00:30Z', cwd: repo, message: { id: 'm-for', role: 'assistant', model: 'claude-opus-4-6', usage: { input_tokens: 999, output_tokens: 999 } } }),
    ].join('\n') + '\n');

    const sid2 = 'extend-' + u();
    craft(fix, sid2, runRows(sid2, T0).rows);
    runPythonCollect(fix, [
      `os.environ["CLAUDE_CODE_SESSION_ID"] = "syn-claude-parent-001"`,
      `print(json.dumps(wm.capture_usage(${JSON.stringify(sid2)}, "review-and-prep", ${T0 / 1000}, ${T_END / 1000}, "claude", ${JSON.stringify(repo)}, home=${JSON.stringify(fix.home)})))`,
    ]);
    const ambData = JSON.parse(readUsage(fix, sid2).stdout).data;
    expect(ambData.reasons).toContain('ambiguous');
    expect(ambData.children.correlated).toBe(0);
    expect(ambData.children.unknown).toBe(2);
    expect(ambData.totals.correlated.input).toBe(0);
    expect(ambData.totals.unknown.input).toBe(300);
  }, 60_000);

  test('overlapping sibling steps go to unattributed; outlived-step and may-continue flags; Cursor/Grok unverified-source; scan-budget and too-many-buckets fallback', () => {
    const fix = makeTelemetryFixture('community');
    const repo = join(fix.home, 'edge-repo');
    mkdirSync(repo, { recursive: true });
    const projDir = join(fix.home, '.claude/projects/edge-repo');
    const subDir = join(projDir, 'syn-claude-parent-001/subagents');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(projDir, 'syn-claude-parent-001.jsonl'), loadFixtureText('claude-parent.jsonl', { __CWD__: repo }));
    // Subagent starts at T0+15s (inside stepA [T0+5s, T0+25s]), logs a second turn at T0+30s (outliving stepA),
    // and logs a record at T_END+2s (post-finish -> may-continue).
    writeFileSync(join(subDir, 'agent-syn-claude-sub-001.jsonl'), [
      loadFixtureText('claude-subagent.jsonl', { __CWD__: repo }).trim(),
      JSON.stringify({ type: 'assistant', sessionId: 'syn-claude-parent-001', agentId: 'syn-claude-sub-001', isSidechain: true, timestamp: '2026-01-01T00:00:30Z', cwd: repo, message: { id: 'msg-sub-2', role: 'assistant', model: 'claude-sonnet-4-6', usage: { input_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 10 } } }),
      JSON.stringify({ type: 'assistant', sessionId: 'syn-claude-parent-001', agentId: 'syn-claude-sub-001', isSidechain: true, timestamp: '2026-01-01T00:01:05Z', cwd: repo, message: { id: 'msg-sub-3', role: 'assistant', model: 'claude-sonnet-4-6', usage: { input_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 10 } } }),
    ].join('\n') + '\n');

    const sid = 'extend-' + u();
    const run = runRows(sid, T0);
    const stepA = u(), stepB = u();
    // Overlapping sibling steps [T0+5s, T0+25s] and [T0+8s, T0+18s] cover parent turn 1 at T0+12s.
    craft(fix, sid, [
      ...run.rows,
      { op: 'begin', at: T0 + 5_000, request: { ...base(sid), step_id: stepA, parent_step_id: run.step, kind: 'phase', phase: 'scope' } },
      { op: 'end', at: T0 + 25_000, request: { ...base(sid), step_id: stepA, outcome: 'completed' } },
      { op: 'begin', at: T0 + 8_000, request: { ...base(sid), step_id: stepB, parent_step_id: run.step, kind: 'phase', phase: 'evidence' } },
      { op: 'end', at: T0 + 18_000, request: { ...base(sid), step_id: stepB, outcome: 'completed' } },
    ]);

    runPythonCollect(fix, [
      `os.environ["CLAUDE_CODE_SESSION_ID"] = "syn-claude-parent-001"`,
      `print(json.dumps(wm.capture_usage(${JSON.stringify(sid)}, "review-and-prep", ${T0 / 1000}, ${T_END / 1000}, "claude", ${JSON.stringify(repo)}, home=${JSON.stringify(fix.home)})))`,
    ]);
    const edgeData = JSON.parse(readUsage(fix, sid).stdout).data;
    expect(edgeData.reasons).toEqual(expect.arrayContaining(['outlived-step', 'may-continue']));
    expect(edgeData.children['outlived-step']).toBe(1);
    expect(edgeData.children['may-continue']).toBe(1);
    expect(edgeData.by_phase.unattributed.direct).toMatchObject({ input: 350, output: 110 });
    expect(edgeData.by_phase.scope.direct).toMatchObject({ input: 300, output: 75 });
    expect(edgeData.by_phase.evidence).toBeUndefined();
    const overlapBuckets = ledgerLines(fix, sid).map(line => JSON.parse(line)).find(row => row.op === 'usage').request.buckets;
    expect(overlapBuckets.filter((b: any) => b.placement === 'overlapping')).toEqual(expect.arrayContaining([
      expect.objectContaining({ step_id: null, input: 100, output: 40 }),
    ]));

    // Cursor and Grok return unavailable with unverified-source.
    for (const unsupportedAgent of ['cursor', 'grok']) {
      const uSid = 'extend-' + u();
      craft(fix, uSid, runRows(uSid, T0).rows);
      runPythonCollect(fix, [
        `print(json.dumps(wm.capture_usage(${JSON.stringify(uSid)}, "review-and-prep", ${T0 / 1000}, ${T_END / 1000}, ${JSON.stringify(unsupportedAgent)}, ${JSON.stringify(repo)}, home=${JSON.stringify(fix.home)})))`,
      ]);
      const uRead = JSON.parse(readUsage(fix, uSid).stdout).data;
      expect(uRead.harness).toBe(unsupportedAgent);
      expect(uRead.reasons).toContain('unverified-source');
      expect(uRead.totals.direct.input).toBeNull();
    }

    // Tiny scan budget triggers scan-budget.
    const budgetRes = runPythonCollect(fix, [
      'tu.SCAN_BUDGET_BYTES = 64',
      `req = tu.collect("claude", "syn-claude-parent-001", ${T0}, ${T_END}, ${JSON.stringify(repo)}, "review-and-prep", ${JSON.stringify(sid)}, {}, home=${JSON.stringify(fix.home)})`,
      'print(json.dumps(req))',
    ]);
    expect(budgetRes.status).toBe('partial');
    expect(budgetRes.reasons).toContain('scan-budget');

    // Oversize bucket count (> MAX_USAGE_BUCKETS) merges by (source, model) with too-many-buckets.
    const mergeSid = 'extend-' + u();
    craft(fix, mergeSid, runRows(mergeSid, T0).rows);
    runPythonCollect(fix, [
      'wm.MAX_USAGE_BUCKETS = 1',
      `os.environ["CLAUDE_CODE_SESSION_ID"] = "syn-claude-parent-001"`,
      `print(json.dumps(wm.capture_usage(${JSON.stringify(mergeSid)}, "review-and-prep", ${T0 / 1000}, ${T_END / 1000}, "claude", ${JSON.stringify(repo)}, home=${JSON.stringify(fix.home)})))`,
    ]);
    const mergedData = JSON.parse(readUsage(fix, mergeSid).stdout).data;
    expect(mergedData.reasons).toContain('too-many-buckets');
  }, 60_000);

  test('end-to-end launcher flow: start -> metrics begin -> phase begin/end -> finish, plus no-capture gates and --usage/--event-id exclusion', () => {
    const fix = makeTelemetryFixture('community');
    const repo = gitRepo(fix);
    const sid = start(fix, repo, 'review-and-prep');
    const { step: runStep } = beginRun(fix, repo, sid, 'review-and-prep');
    const phaseStep = u();
    expect(metrics(fix.env, 'begin', { ...base(sid), step_id: phaseStep, parent_step_id: runStep, kind: 'phase', phase: 'pregate' }, repo).envelope.status).toBe('recorded');

    // Plant a Claude session log with timestamp inside the active run window.
    const nowIso = new Date().toISOString();
    const claudeProj = join(fix.home, '.claude/projects/e2e-proj');
    mkdirSync(claudeProj, { recursive: true });
    writeFileSync(join(claudeProj, 'e2e-claude-sess.jsonl'), [
      JSON.stringify({ type: 'assistant', sessionId: 'e2e-claude-sess', timestamp: nowIso, cwd: repo, message: { id: 'm-e2e-1', role: 'assistant', model: 'claude-opus-4-6', usage: { input_tokens: 123, cache_read_input_tokens: 45, cache_creation_input_tokens: 6, output_tokens: 78 } } }),
    ].join('\n') + '\n');

    expect(metrics(fix.env, 'end', { ...base(sid), step_id: phaseStep, outcome: 'completed' }, repo).envelope.status).toBe('recorded');
    expect(metrics(fix.env, 'end', { ...base(sid), step_id: runStep, outcome: 'completed' }, repo).envelope.status).toBe('recorded');

    const beforePlain = read(fix, sid).envelope;
    const fin = runRaw({ ...fix.env, CLAUDE_CODE_SESSION_ID: 'e2e-claude-sess' }, ['finish', '--skill', 'extend:review-and-prep', '--outcome', 'success'], '', repo);
    expect(fin.status).toBe(0);
    expect(fin.stdout).toBe('');

    const afterPlain = read(fix, sid).envelope;
    expect(afterPlain.status).toBe('ok');
    expect(afterPlain.data.records).toBe(beforePlain.data.records + 1);
    expect(afterPlain.data.receipt_text).toBe(beforePlain.data.receipt_text);
    expect({ ...afterPlain.data, records: beforePlain.data.records }).toEqual(beforePlain.data);

    const usageEnv = JSON.parse(readUsage(fix, sid).stdout);
    expect(usageEnv.status).toBe('ok');
    expect(usageEnv.data.totals.direct).toMatchObject({ input: 123, cache_read: 45, cache_write: 6, output: 78 });
    expect(usageEnv.data.by_phase.pregate.direct).toMatchObject({ input: 123, output: 78 });

    // --usage and --event-id together are rejected as invalid-input.
    const both = JSON.parse(readUsage(fix, sid, ['--event-id', u()]).stdout);
    expect(both).toMatchObject({ status: 'unavailable', reason: 'invalid-input' });

    // No capture for extend:roadmap, an unbound ledger, or GSTACK_EXTEND_WORKFLOW_METRICS=off.
    const roadSid = start(fix, repo, 'roadmap');
    expect(runRaw(fix.env, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success'], '', repo).status).toBe(0);
    expect(existsSync(ledgerFile(fix, roadSid))).toBe(false);

    const unboundSid = start(fix, repo, 'review-and-prep');
    expect(runRaw(fix.env, ['finish', '--skill', 'extend:review-and-prep', '--outcome', 'success'], '', repo).status).toBe(0);
    expect(existsSync(ledgerFile(fix, unboundSid))).toBe(false);

    const offSid = start(fix, repo, 'ship-and-land');
    beginRun(fix, repo, offSid, 'ship-and-land');
    expect(runRaw({ ...fix.env, GSTACK_EXTEND_WORKFLOW_METRICS: 'off' }, ['finish', '--skill', 'extend:ship-and-land', '--outcome', 'success'], '', repo).status).toBe(0);
    expect(ledgerLines(fix, offSid)).toHaveLength(1);
  }, 60_000);

  // Value: protects=finish-time accounting under truncation, competing logs and resource limits;
  // fails_when=out-of-window/foreign copies replace direct facts, or partial collection claims complete totals;
  // why_new=the original corpus exercises small stable files only; seam=isolated Python clock/stream injection.
  function ownClaudeFixture() {
    const fix = makeTelemetryFixture('community');
    const repo = join(fix.home, 'review-regression');
    const project = join(fix.home, '.claude/projects/review-regression');
    mkdirSync(repo, { recursive: true });
    mkdirSync(project, { recursive: true });
    const own = join(project, 'syn-claude-parent-001.jsonl');
    writeFileSync(own, loadFixtureText('claude-parent.jsonl', { __CWD__: repo }));
    const collect = `tu.collect("claude", "syn-claude-parent-001", ${T0}, ${T_END}, ${JSON.stringify(repo)}, "review-and-prep", "extend-11111111-1111-4111-8111-111111111111", {}, home=${JSON.stringify(fix.home)})`;
    return { fix, repo, project, own, collect };
  }

  test('review regression: the parsing loop stops when its injected time budget expires', () => {
    const { fix, collect } = ownClaudeFixture();
    const result = runPythonCollect(fix, [
      'clock = [0.0]', 'calls = [0]', 'tu.SCAN_BUDGET_S = 1.0',
      'tu.time.monotonic = lambda: clock[0]', 'original_parse = tu.parse_record',
      'def counted_parse(*args, **kwargs):',
      '    calls[0] += 1', '    clock[0] += 1.0',
      '    return original_parse(*args, **kwargs)',
      'tu.parse_record = counted_parse', `req = ${collect}`,
      'print(json.dumps({"calls": calls[0], "request": req}))',
    ]);
    expect(result.request.reasons).toContain('scan-budget');
    expect(result.calls).toBeLessThanOrEqual(1);
  });

  test('review regression: voices and child metadata reads stay bounded if files grow after stat', () => {
    const { fix, repo, project, collect } = ownClaudeFixture();
    const sub = join(project, 'syn-claude-parent-001/subagents');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, 'agent-child.jsonl'), loadFixtureText('claude-subagent.jsonl', { __CWD__: repo }));
    const meta = join(sub, 'agent-child.meta.json');
    writeFileSync(meta, '{}');
    const voiceDir = join(fix.home, '.gstack/projects/review-regression/review-and-prep');
    mkdirSync(voiceDir, { recursive: true });
    const voices = join(voiceDir, 'voices.jsonl');
    writeFileSync(voices, '{}\n');
    const result = runPythonCollect(fix, [
      'import io', `targets = {${JSON.stringify(meta)}: 65536, ${JSON.stringify(voices)}: 1024 * 1024}`,
      'read_sizes = {}', 'original_open = tu.Path.open',
      'class GrowingStream(io.BytesIO):',
      '    def __init__(self, name):',
      '        self.name = name', '        super().__init__(b"{}" + b" " * (targets[name] * 2))',
      '    def read(self, size=-1):',
      '        data = super().read(size)',
      '        read_sizes[self.name] = read_sizes.get(self.name, 0) + len(data)',
      '        return data',
      'def growing_open(path, *args, **kwargs):',
      '    if str(path) in targets: return GrowingStream(str(path))',
      '    return original_open(path, *args, **kwargs)',
      'tu.Path.open = growing_open', `req = ${collect}`,
      'print(json.dumps({"sizes": read_sizes, "request": req}))',
    ]);
    expect(result.sizes[meta]).toBeLessThanOrEqual(65536);
    expect(result.sizes[voices]).toBeLessThanOrEqual(1024 * 1024);
  });

  test('review regression: a streaming copy after finish cannot replace an in-window fact', () => {
    const { fix, own, collect } = ownClaudeFixture();
    const late = JSON.parse(readFileSync(own, 'utf8').trim().split('\n')[3]!);
    late.timestamp = '2026-01-01T00:01:01Z';
    late.message.usage.output_tokens = 999;
    appendFileSync(own, JSON.stringify(late) + '\n');
    const req = runPythonCollect(fix, [`print(json.dumps(${collect}))`]);
    expect(req.buckets.reduce((sum: number, b: any) => sum + b.output, 0)).toBe(100);
  });

  test('review regression: rejected foreign copies cannot overwrite direct usage', () => {
    const { fix, own, project, collect } = ownClaudeFixture();
    const foreign = JSON.parse(readFileSync(own, 'utf8').trim().split('\n')[3]!);
    foreign.cwd = join(fix.home, 'unrelated-repository');
    foreign.sessionId = 'foreign';
    foreign.message.usage.output_tokens = 999;
    writeFileSync(join(project, 'foreign.jsonl'), JSON.stringify(foreign) + '\n');
    const req = runPythonCollect(fix, [`print(json.dumps(${collect}))`]);
    expect(req.buckets.reduce((sum: number, b: any) => sum + b.output, 0)).toBe(100);
  });

  test('review regression: a truncated Claude session keeps its original foreign start', () => {
    const { fix, repo, project, collect } = ownClaudeFixture();
    const parent = loadFixtureText('claude-parent.jsonl', { __CWD__: repo }).trim().split('\n').map(line => JSON.parse(line));
    const early = { ...parent[0], sessionId: 'foreign', timestamp: '2025-12-31T23:59:00Z' };
    const pad = { ...early, message: { content: 'x'.repeat(4000) } };
    const last = { ...parent[3], sessionId: 'foreign', message: { ...parent[3].message, id: 'foreign-only' } };
    writeFileSync(join(project, 'foreign.jsonl'), [early, pad, last].map(row => JSON.stringify(row)).join('\n') + '\n');
    const req = runPythonCollect(fix, ['tu.MAX_TAIL_BYTES = 3000', `print(json.dumps(${collect}))`]);
    expect(req.sources.filter((s: any) => s.evidence === 'correlated')).toEqual([]);
  });

  test('review regression: child tail indices cannot masquerade as copied-history ordinals', () => {
    const fix = makeTelemetryFixture('community');
    const repo = join(fix.home, 'child-tail');
    const sessions = join(fix.home, '.codex/sessions/2026/01/01');
    mkdirSync(repo, { recursive: true }); mkdirSync(sessions, { recursive: true });
    const parent = '01940000-0000-7000-8000-000000000001';
    const child = '01940000-0000-7000-8000-000000000002';
    writeFileSync(join(sessions, `rollout-2026-01-01T00-00-00-${parent}.jsonl`), loadFixtureText('codex-parent.jsonl', { __CWD__: repo }));
    const meta = { timestamp: '2026-01-01T00:00:12Z', type: 'session_meta', payload: { id: child, cwd: repo, parent_thread_id: parent, subagent_history_start_ordinal: 10 } };
    const counter = (second: number, input: number, output: number) => ({ timestamp: `2026-01-01T00:00:${second}Z`, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: 0, output_tokens: output, reasoning_output_tokens: 0 } } } });
    const tail = [counter(30, 100, 10), counter(40, 150, 20)].map(row => JSON.stringify(row)).join('\n') + '\n';
    const padding = Array.from({ length: 12 }, () => JSON.stringify({ type: 'notice', text: 'x'.repeat(500) })).join('\n');
    writeFileSync(join(sessions, `rollout-2026-01-01T00-00-12-${child}.jsonl`), JSON.stringify(meta) + '\n' + padding + '\n' + tail);
    const req = runPythonCollect(fix, [
      `tu.MAX_TAIL_BYTES = ${Buffer.byteLength(tail) + 1}`,
      `print(json.dumps(tu.collect("codex", ${JSON.stringify(parent)}, ${T0}, ${T_END}, ${JSON.stringify(repo)}, "review-and-prep", "extend-11111111-1111-4111-8111-111111111111", {}, home=${JSON.stringify(fix.home)})))`,
    ]);
    expect(req.buckets.filter((b: any) => req.sources[b.source].relation === 'subagent')).toEqual([
      expect.objectContaining({ input: 50, output: 10, responses: 1 }),
    ]);
    expect(req.status).toBe('partial');
  });

  test('review regression: oversized Codex metadata either preserves lineage or reports partial coverage', () => {
    const fix = makeTelemetryFixture('community');
    const repo = join(fix.home, 'large-meta');
    const sessions = join(fix.home, '.codex/sessions/2026/01/01');
    mkdirSync(repo, { recursive: true }); mkdirSync(sessions, { recursive: true });
    const parent = '01940000-0000-7000-8000-000000000001';
    const child = '01940000-0000-7000-8000-000000000002';
    writeFileSync(join(sessions, `rollout-2026-01-01T00-00-00-${parent}.jsonl`), loadFixtureText('codex-parent.jsonl', { __CWD__: repo }));
    const rows = loadFixtureText('codex-subagent.jsonl', { __CWD__: repo }).trim().split('\n').map(line => JSON.parse(line));
    rows[0].payload.instructions = 'x'.repeat(70000);
    writeFileSync(join(sessions, `rollout-2026-01-01T00-00-12-${child}.jsonl`), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    const req = runPythonCollect(fix, [
      `print(json.dumps(tu.collect("codex", ${JSON.stringify(parent)}, ${T0}, ${T_END}, ${JSON.stringify(repo)}, "review-and-prep", "extend-11111111-1111-4111-8111-111111111111", {}, home=${JSON.stringify(fix.home)})))`,
    ]);
    const linked = req.sources.some((s: any) => s.relation === 'subagent');
    expect(linked || (req.status === 'partial' && req.reasons.some((reason: string) =>
      ['log-truncated', 'scan-budget'].includes(reason)))).toBe(true);
  });

  test('review regression: capacity-discarded buckets project unknown totals instead of zero', () => {
    const { fix, repo } = ownClaudeFixture();
    const sid = 'extend-' + u(); craft(fix, sid, runRows(sid, T0).rows);
    const result = runPythonCollect(fix, [
      'wm.MAX_USAGE_RECORD_BYTES = 1024', 'os.environ["CLAUDE_CODE_SESSION_ID"] = "syn-claude-parent-001"',
      `print(json.dumps(wm.capture_usage(${JSON.stringify(sid)}, "review-and-prep", ${T0 / 1000}, ${T_END / 1000}, "claude", ${JSON.stringify(repo)}, home=${JSON.stringify(fix.home)})))`,
    ]);
    expect(result).toBe('recorded');
    const usage = JSON.parse(readUsage(fix, sid).stdout).data;
    expect(usage.reasons).toContain('capacity');
    expect(usage.totals.direct.input).toBeNull();
    expect(usage.totals.direct.null_reasons).toContain('capacity');
  });

  test('review batch 2: discovery deadline before any usage projects null totals', () => {
    const { fix, repo } = ownClaudeFixture();
    const sid = 'extend-' + u(); craft(fix, sid, runRows(sid, T0).rows);
    const result = runPythonCollect(fix, [
      'clock = [0.0]', 'tu.SCAN_BUDGET_S = 1.0', 'tu.time.monotonic = lambda: clock[0]',
      'original_entries = tu._entries',
      'def slow_entries(path, budget):',
      '    clock[0] = 2.0', '    yield from original_entries(path, budget)',
      'tu._entries = slow_entries', 'wm._load_telemetry_usage = lambda: tu',
      'os.environ["CLAUDE_CODE_SESSION_ID"] = "syn-claude-parent-001"',
      `print(json.dumps(wm.capture_usage(${JSON.stringify(sid)}, "review-and-prep", ${T0 / 1000}, ${T_END / 1000}, "claude", ${JSON.stringify(repo)}, home=${JSON.stringify(fix.home)})))`,
    ]);
    expect(result).toBe('recorded');
    const usage = JSON.parse(readUsage(fix, sid).stdout).data;
    expect(usage.reasons).toContain('scan-budget');
    for (const total of Object.values(usage.totals)) {
      expect(total).toEqual({ input: null, cache_read: null, cache_write: null, output: null, reasoning: null, null_reasons: ['scan-budget'] });
    }
  });

  test('review batch 2: unknown original Claude start retains usage with unknown evidence', () => {
    const { fix, repo, own, project, collect } = ownClaudeFixture();
    const row = JSON.parse(readFileSync(own, 'utf8').trim().split('\n')[3]!);
    for (const [i, header] of [JSON.stringify({ cwd: repo }), '{broken'].entries()) {
      const tail = { ...row, sessionId: `unknown-start-${i}`, message: { ...row.message, id: `unknown-start-${i}` } };
      writeFileSync(join(project, `unknown-start-${i}.jsonl`), header + '\n' + JSON.stringify({ text: 'x'.repeat(4000) }) + '\n' + JSON.stringify(tail) + '\n');
    }
    const req = runPythonCollect(fix, ['tu.MAX_TAIL_BYTES = 3000', `print(json.dumps(${collect}))`]);
    const candidates = req.sources.filter((s: any) => s.relation === 'cross-harness');
    expect(candidates).toHaveLength(2);
    expect(candidates.every((s: any) => s.evidence === 'unknown' && !s.complete)).toBe(true);
    expect(req.status).toBe('partial');
    expect(req.reasons).toEqual(expect.arrayContaining(['log-truncated', 'ambiguous']));
    expect(req.buckets.filter((b: any) => req.sources[b.source].evidence === 'unknown').reduce((sum: number, b: any) => sum + b.output, 0)).toBe(80);
  });

  test('review batch 2: already collected inline child survives deadline finalization', () => {
    const { fix, own, collect } = ownClaudeFixture();
    const parent = JSON.parse(readFileSync(own, 'utf8').trim().split('\n')[3]!);
    const child = { ...parent, agentId: 'inline-child', isSidechain: true, message: { ...parent.message, id: 'inline-only', usage: { input_tokens: 17, output_tokens: 9 } } };
    writeFileSync(own, [parent, child].map(row => JSON.stringify(row)).join('\n') + '\n');
    const req = runPythonCollect(fix, [
      'clock = [0.0]', 'tu.SCAN_BUDGET_S = 1.0', 'tu.time.monotonic = lambda: clock[0]',
      'original_parse = tu.parse_record',
      'def expire_after_child(store, agent, row, state, index):',
      '    fact = original_parse(store, agent, row, state, index)',
      '    if row.get("agentId") == "inline-child": clock[0] = 2.0',
      '    return fact', 'tu.parse_record = expire_after_child',
      `print(json.dumps(${collect}))`,
    ]);
    expect(req.reasons).toContain('scan-budget');
    expect(req.sources.filter((s: any) => s.relation === 'subagent')).toHaveLength(1);
    expect(req.buckets.filter((b: any) => req.sources[b.source].relation === 'subagent')).toEqual([
      expect.objectContaining({ input: 17, output: 9, responses: 1 }),
    ]);
  });

  test('review batch 2: short header reserves actual bytes and buffered facts survive byte exhaustion', () => {
    const { fix, own, collect } = ownClaudeFixture();
    const row = JSON.parse(readFileSync(own, 'utf8').trim().split('\n')[3]!);
    const header = JSON.stringify({ timestamp: '2025-12-31T23:59:00Z' }) + '\n';
    const tail = JSON.stringify(row) + '\n';
    writeFileSync(own, header + JSON.stringify({ text: 'x'.repeat(4000) }) + '\n' + tail);
    const retained = runPythonCollect(fix, [
      'tu.time.monotonic = lambda: 0.0', 'tu.MAX_TAIL_BYTES = 3000',
      `tu.SCAN_BUDGET_BYTES = ${Buffer.byteLength(header) + Buffer.byteLength(tail) + 1}`,
      // Tail starts inside padding; after dropping it, retain one complete usage line.
      `tu.MAX_TAIL_BYTES = ${Buffer.byteLength(tail) + 1}`,
      `print(json.dumps(${collect}))`,
    ]);
    expect(retained.reasons).toContain('scan-budget');
    expect(retained.buckets).toEqual([expect.objectContaining({ input: 100, output: 40, responses: 1 })]);

    // A readline allowance may exceed remaining capacity without consuming it.
    const reservation = runPythonCollect(fix, [
      'tu.time.monotonic = lambda: 0.0', 'budget = tu._Budget(3.0, 100)',
      'budget.charge(80)', 'allow = budget.reserve(1000)', 'budget.charge(5)',
      'print(json.dumps({"allow": allow, "remaining": budget.reserve(1000), "exhausted": budget.exhausted}))',
    ]);
    expect(reservation).toEqual({ allow: 20, remaining: 15, exhausted: false });
  });

  test('review batch 2: integral float counts survive dedup replacement and schema validation', () => {
    const { fix, repo, own } = ownClaudeFixture();
    const sid = 'extend-' + u(); craft(fix, sid, runRows(sid, T0).rows);
    const row = JSON.parse(readFileSync(own, 'utf8').trim().split('\n')[3]!);
    const previous = { ...row, message: { ...row.message, usage: { input_tokens: 90, output_tokens: 10 } } };
    const next = { ...row, message: { ...row.message, usage: { input_tokens: 100, output_tokens: 40 } } };
    writeFileSync(own, [previous, next].map(item => JSON.stringify(item).replace(/"(input_tokens|output_tokens)":(\d+)/g, '"$1":$2.0')).join('\n') + '\n');
    const result = runPythonCollect(fix, [
      'os.environ["CLAUDE_CODE_SESSION_ID"] = "syn-claude-parent-001"',
      `print(json.dumps(wm.capture_usage(${JSON.stringify(sid)}, "review-and-prep", ${T0 / 1000}, ${T_END / 1000}, "claude", ${JSON.stringify(repo)}, home=${JSON.stringify(fix.home)})))`,
    ]);
    expect(result).toBe('recorded');
    const usage = JSON.parse(readUsage(fix, sid).stdout).data;
    expect(usage.totals.direct).toMatchObject({ input: 100, output: 40 });
    expect(ledgerLines(fix, sid).map(line => JSON.parse(line)).find(item => item.op === 'usage').request.buckets[0].responses).toBe(1);
  });

  test.each(['file-count', 'file-size'])('review batch 3: voices %s omission cannot manufacture a unique pass link', (limit) => {
    const { fix, repo, own, project, collect } = ownClaudeFixture();
    const parentRows = readFileSync(own, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const candidate = { ...parentRows[3], sessionId: 'outside-candidate', message: { ...parentRows[3].message, id: 'outside-only' } };
    writeFileSync(join(project, 'outside-candidate.jsonl'), JSON.stringify(candidate) + '\n');
    // A foreign session prevents fallback to a run-only correlation.
    writeFileSync(join(project, 'already-active.jsonl'), [
      { ...parentRows[0], sessionId: 'already-active', timestamp: '2025-12-31T23:59:00Z' },
      { ...parentRows[0], sessionId: 'already-active', timestamp: '2026-01-01T00:00:30Z' },
    ].map(row => JSON.stringify(row)).join('\n') + '\n');
    const sid = 'extend-11111111-1111-4111-8111-111111111111';
    const voice = (voice_id: string, session_id = sid) => ({
      stage: 'review-and-prep', voice_id, pass: 1, attempt: 1,
      metrics: { session_id }, subagent_ref: { kind: 'outside-process', id: null },
      dispatched_at: '2026-01-01T00:00:10Z', returned_at: '2026-01-01T00:00:20Z',
    });
    const putVoice = (name: string, row: any, modifiedSeconds: number) => {
      const dir = join(fix.home, '.gstack/projects/review-regression/review-and-prep', name);
      mkdirSync(dir, { recursive: true });
      const path = join(dir, 'voices.jsonl');
      writeFileSync(path, JSON.stringify(row) + '\n');
      utimesSync(path, T0 / 1000 + modifiedSeconds, T0 / 1000 + modifiedSeconds);
      return path;
    };
    putVoice('retained', voice('outside-first'), 62);
    const omitted = putVoice('omitted', voice('outside-second'), 61);
    const capture = () => runPythonCollect(fix, [
      'tu.time.monotonic = lambda: 0.0', 'opened = []', 'original_open = tu.Path.open',
      'def track_open(path, *args, **kwargs):',
      '    if path.name == "voices.jsonl": opened.append(str(path))',
      '    return original_open(path, *args, **kwargs)', 'tu.Path.open = track_open',
      `req = ${collect}`,
      'record = {"op": "usage", "event_id": req["event_id"], "request_digest": wm.request_digest("usage", req), "request": req}',
      'print(json.dumps({"request": req, "projection": wm.summarize_usage([record], 0, False, False), "opened": opened}))',
    ]);
    const complete = capture();
    expect(complete.projection.totals.unknown.output).toBe(40);
    expect(complete.projection.by_pass).toEqual([]);
    expect(complete.request.reasons).not.toContain('capacity');

    if (limit === 'file-count') {
      // Both matching rows are recent and small; 63 newer unrelated runs evict the second one.
      for (let i = 0; i < 63; i++) putVoice(`other-${i}`, voice('other-run', 'extend-' + u()), 100 + i);
    } else {
      appendFileSync(omitted, JSON.stringify({ note: 'x'.repeat(1024 * 1024) }) + '\n');
      utimesSync(omitted, T0 / 1000 + 61, T0 / 1000 + 61);
    }
    const limited = capture();
    expect(limited.opened).toHaveLength(limit === 'file-count' ? 64 : 1);
    expect(limited.opened).not.toContain(omitted);
    const source = limited.request.sources.find((s: any) => s.relation === 'cross-harness');
    expect(source).toMatchObject({ evidence: 'unknown', link: null, link_evidence: null });
    expect(limited.request.status).toBe('partial');
    expect(limited.request.reasons).toEqual(expect.arrayContaining(['capacity', 'ambiguous']));
    expect(limited.projection.totals.direct.output).toBe(100);
    expect(limited.projection.totals.unknown.output).toBe(40);
    expect(limited.projection.totals.correlated.output).toBe(0);
    expect(limited.projection.by_pass).toEqual([]);
  });

  test('continuation regression: child usage after run end stays counted and is marked may-continue', () => {
    const { fix, repo, project } = ownClaudeFixture();
    const sub = join(project, 'syn-claude-parent-001/subagents');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, 'agent-syn-claude-sub-001.jsonl'),
      loadFixtureText('claude-subagent.jsonl', { __CWD__: repo }).replace('00:00:20Z', '00:00:50Z'));
    const sid = 'extend-' + u(), run = runRows(sid, T0);
    craft(fix, sid, [...run.rows, { op: 'end', at: T0 + 40_000,
      request: { ...base(sid), step_id: run.step, outcome: 'completed' } }]);
    expect(runPythonCollect(fix, [
      'os.environ["CLAUDE_CODE_SESSION_ID"] = "syn-claude-parent-001"',
      `print(json.dumps(wm.capture_usage(${JSON.stringify(sid)}, "review-and-prep", ${T0 / 1000}, ${T_END / 1000}, "claude", ${JSON.stringify(repo)}, home=${JSON.stringify(fix.home)})))`,
    ])).toBe('recorded');
    const req = ledgerLines(fix, sid).map(line => JSON.parse(line)).find(row => row.op === 'usage').request;
    const index = req.sources.findIndex((s: any) => s.relation === 'subagent');
    expect(req.sources[index]).toMatchObject({ complete: false, reasons: expect.arrayContaining(['may-continue']) });
    expect(req.buckets.filter((b: any) => b.source === index)).toEqual([
      expect.objectContaining({ input: 300, output: 75 }),
    ]);
    expect(JSON.parse(readUsage(fix, sid).stdout).data).toMatchObject({ capture: 'partial', children: { 'may-continue': 1 } });
  });

  test.each(['own', 'child'])('continuation regression: unreadable Claude %s log keeps totals unknown', (failedSource) => {
    const { fix, repo, project, own, collect } = ownClaudeFixture();
    const sub = join(project, 'syn-claude-parent-001/subagents');
    mkdirSync(sub, { recursive: true });
    const child = join(sub, 'agent-syn-claude-sub-001.jsonl');
    writeFileSync(child, loadFixtureText('claude-subagent.jsonl', { __CWD__: repo }));
    const result = runPythonCollect(fix, [
      'original_open = tu.Path.open', 'attempts = []',
      'def fail_read(path, mode="r", *args, **kwargs):',
      `    if str(path) == ${JSON.stringify(failedSource === 'own' ? own : child)} and mode == "rb":`,
      '        attempts.append(True)', '        raise PermissionError("synthetic owned read failure")',
      '    return original_open(path, mode, *args, **kwargs)', 'tu.Path.open = fail_read',
      `req = ${collect}`, 'wm.validate_request("usage", req)',
      'rec = {"op": "usage", "event_id": req["event_id"], "request_digest": wm.request_digest("usage", req), "request": req}',
      'print(json.dumps({"request": req, "data": wm.summarize_usage([rec], 0, False, False), "attempts": attempts}))',
    ]);
    expect(result.attempts).not.toEqual([]);
    expect(result.request.sources.find((s: any) => s.relation === (failedSource === 'own' ? 'own' : 'subagent')))
      .toMatchObject({ complete: false, reasons: expect.arrayContaining(['log-missing']) });
    expect(result.data.capture).toBe('partial');
    expect(result.data.totals.direct).toMatchObject({ input: null, output: null, null_reasons: expect.arrayContaining(['log-missing']) });
    // Other sources' observed facts survive; an unknown total does not erase evidence.
    expect(result.request.buckets.length).toBeGreaterThan(0);
  });

  test('continuation regression: model metadata cannot exceed the serialized record cap', () => {
    const { fix, repo, project } = ownClaudeFixture();
    const sub = join(project, 'syn-claude-parent-001/subagents');
    mkdirSync(sub, { recursive: true });
    for (let child = 0; child < 63; child++) {
      const rows = Array.from({ length: 16 }, (_, model) => ({
        type: 'assistant', sessionId: 'syn-claude-parent-001', agentId: `syn-child-${child}`,
        isSidechain: true, timestamp: '2026-01-01T00:00:20Z', cwd: repo,
        message: { id: `syn-message-${child}-${model}`, role: 'assistant', model: `m${String(model).padStart(2, '0')}-` + 'x'.repeat(124),
          usage: { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 } },
      }));
      writeFileSync(join(sub, `agent-syn-child-${child}.jsonl`), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    }
    const sid = 'extend-' + u(); craft(fix, sid, runRows(sid, T0).rows);
    expect(runPythonCollect(fix, [
      'os.environ["CLAUDE_CODE_SESSION_ID"] = "syn-claude-parent-001"',
      `print(json.dumps(wm.capture_usage(${JSON.stringify(sid)}, "review-and-prep", ${T0 / 1000}, ${T_END / 1000}, "claude", ${JSON.stringify(repo)}, home=${JSON.stringify(fix.home)})))`,
    ])).toBe('recorded');
    const line = ledgerLines(fix, sid).find(line => JSON.parse(line).op === 'usage')!;
    expect(Buffer.byteLength(line + '\n')).toBeLessThanOrEqual(65536);
    expect(validRecord(JSON.parse(line))).toBe(true);
    expect(JSON.parse(line).request).toMatchObject({ status: 'partial', reasons: expect.arrayContaining(['capacity']), buckets: [] });
    expect(JSON.parse(readUsage(fix, sid).stdout).data.totals.direct.input).toBeNull();
  });

  test.each(['own', 'child'])('continuation regression: unreadable Codex %s log keeps totals unknown', (failedSource) => {
    const fix = makeTelemetryFixture('community');
    const repo = join(fix.home, 'codex-unreadable'), sessions = join(fix.home, '.codex/sessions/2026/01/01');
    mkdirSync(repo, { recursive: true }); mkdirSync(sessions, { recursive: true });
    const parent = '01940000-0000-7000-8000-000000000001', child = '01940000-0000-7000-8000-000000000002';
    const ownPath = join(sessions, `rollout-2026-01-01T00-00-00-${parent}.jsonl`);
    const childPath = join(sessions, `rollout-2026-01-01T00-00-12-${child}.jsonl`);
    writeFileSync(ownPath, loadFixtureText('codex-parent.jsonl', { __CWD__: repo }));
    writeFileSync(childPath, loadFixtureText('codex-subagent.jsonl', { __CWD__: repo }));
    const result = runPythonCollect(fix, [
      'original_open = tu.Path.open', 'attempts = [0]',
      'def fail_read(path, mode="r", *args, **kwargs):',
      `    if str(path) == ${JSON.stringify(failedSource === 'own' ? ownPath : childPath)} and mode == "rb":`,
      '        attempts[0] += 1',
      // Child discovery reads session_meta first; fail the subsequent full-log read.
      `        if attempts[0] > ${failedSource === 'own' ? 0 : 1}: raise PermissionError("synthetic owned read failure")`,
      '    return original_open(path, mode, *args, **kwargs)', 'tu.Path.open = fail_read',
      `req = tu.collect("codex", ${JSON.stringify(parent)}, ${T0}, ${T_END}, ${JSON.stringify(repo)}, "review-and-prep", "extend-11111111-1111-4111-8111-111111111111", {}, home=${JSON.stringify(fix.home)})`,
      'wm.validate_request("usage", req)',
      'rec = {"op": "usage", "event_id": req["event_id"], "request_digest": wm.request_digest("usage", req), "request": req}',
      'print(json.dumps({"request": req, "data": wm.summarize_usage([rec], 0, False, False)}))',
    ]);
    expect(result.request.sources.find((s: any) => s.relation === (failedSource === 'own' ? 'own' : 'subagent')))
      .toMatchObject({ complete: false, reasons: expect.arrayContaining(['log-missing']) });
    expect(result.data.capture).toBe('partial');
    expect(result.data.totals.direct).toMatchObject({ input: null, output: null, null_reasons: expect.arrayContaining(['log-missing']) });
    expect(result.request.buckets.length).toBeGreaterThan(0);
  });

  test('continuation regression: an unmatched in-harness voice is not an outside-call interval', () => {
    const { fix } = ownClaudeFixture();
    const sid = 'extend-' + u();
    const dir = join(fix.home, '.gstack/projects/review-regression/review-and-prep');
    mkdirSync(dir, { recursive: true });
    const rows = ['agent-id', 'outside-process'].map((kind, i) => ({
      stage: 'review-and-prep', voice_id: i ? 'outside-challenge' : 'testing', pass: 1, attempt: 1,
      metrics: { session_id: sid }, subagent_ref: { kind, id: i ? null : 'missing-child' },
      dispatched_at: '2026-01-01T00:00:10Z', returned_at: '2026-01-01T00:00:20Z',
    }));
    writeFileSync(join(dir, 'voices.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    const result = runPythonCollect(fix, [
      `links, intervals, reported = tu._read_voices_join(tu.Path(${JSON.stringify(fix.home)}), "review-and-prep", ${JSON.stringify(sid)}, ${T0}, set(), tu._Budget(3.0, 64 * 1024 * 1024), set())`,
      'print(json.dumps([interval[2]["voice_id"] for interval in intervals]))',
    ]);
    expect(result).toEqual(['outside-challenge']);
  });

  test.each(['claude-log', 'codex-header', 'voices-file', 'malformed-voices', 'disappeared-voices', 'unreadable-directory'])('continuation discovery: unreadable %s prevents false correlation', (kind) => {
    const { fix, repo, project, own, collect } = ownClaudeFixture();
    const rows = readFileSync(own, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    writeFileSync(join(project, 'outside-candidate.jsonl'), JSON.stringify({
      ...rows[3], sessionId: 'outside-candidate', message: { ...rows[3].message, id: 'outside-only' },
    }) + '\n');
    const sid = 'extend-11111111-1111-4111-8111-111111111111';
    const voice = (voice_id: string) => ({
      stage: 'review-and-prep', voice_id, pass: 1, attempt: 1,
      metrics: { session_id: sid }, subagent_ref: { kind: 'outside-process', id: null },
      dispatched_at: '2026-01-01T00:00:10Z', returned_at: '2026-01-01T00:00:20Z',
    });
    const putVoice = (name: string) => {
      const dir = join(fix.home, '.gstack/projects/review-regression/review-and-prep', name);
      mkdirSync(dir, { recursive: true });
      const path = join(dir, 'voices.jsonl'); writeFileSync(path, JSON.stringify(voice(name)) + '\n');
      return path;
    };
    let unreadable: string;
    if (kind === 'claude-log') {
      unreadable = join(project, 'already-active.jsonl');
      writeFileSync(unreadable, ['2025-12-31T23:59:00Z', '2026-01-01T00:00:30Z'].map(timestamp =>
        JSON.stringify({ ...rows[0], sessionId: 'already-active', timestamp })).join('\n') + '\n');
    } else if (kind === 'codex-header') {
      const dir = join(fix.home, '.codex/sessions/2026/01/01'); mkdirSync(dir, { recursive: true });
      unreadable = join(dir, 'rollout-2026-01-01T00-00-15-01940000-0000-7000-8000-000000000099.jsonl');
      writeFileSync(unreadable, loadFixtureText('codex-parent.jsonl', { __CWD__: repo }));
      putVoice('outside-available');
    } else {
      putVoice('outside-available'); unreadable = putVoice('outside-unreadable');
      if (kind === 'malformed-voices') writeFileSync(unreadable, 'not-json\n');
    }
    const result = runPythonCollect(fix, [
      'original_open = tu.Path.open', 'attempts = []',
      'original_stat = tu._safe_stat_regular', 'stat_attempts = []',
      'def fail_stat(path):',
      `    if ${kind === 'disappeared-voices' ? 'True' : 'False'} and str(path) == ${JSON.stringify(unreadable)}:`,
      '        stat_attempts.append(True)',
      '        if len(stat_attempts) == 2:',
      '            attempts.append(True)', '            return None',
      '    return original_stat(path)', 'tu._safe_stat_regular = fail_stat',
      'original_scandir = tu.os.scandir',
      'def fail_scandir(path):',
      `    if ${kind === 'unreadable-directory' ? 'True' : 'False'} and str(path) == str(tu.Path(${JSON.stringify(unreadable)}).parent):`,
      '        attempts.append(True)', '        raise PermissionError("synthetic directory discovery failure")',
      '    return original_scandir(path)', 'tu.os.scandir = fail_scandir',
      'def fail_read(path, mode="r", *args, **kwargs):',
      `    if ${['disappeared-voices', 'unreadable-directory'].includes(kind) ? 'False' : 'True'} and str(path) == ${JSON.stringify(unreadable)} and mode == "rb":`,
      '        attempts.append(True)',
      `        if ${kind === 'malformed-voices' ? 'False' : 'True'}: raise PermissionError("synthetic discovery read failure")`,
      '    return original_open(path, mode, *args, **kwargs)', 'tu.Path.open = fail_read',
      `req = ${collect}`, 'wm.validate_request("usage", req)',
      'rec = {"op": "usage", "event_id": req["event_id"], "request_digest": wm.request_digest("usage", req), "request": req}',
      'print(json.dumps({"request": req, "data": wm.summarize_usage([rec], 0, False, False), "attempts": attempts}))',
    ]);
    expect(result.attempts).not.toEqual([]);
    expect(result.request.sources.find((s: any) => s.relation === 'cross-harness'))
      .toMatchObject({ evidence: 'unknown', link: null, link_evidence: null });
    expect(result.data.capture).toBe('partial');
    const reason = kind === 'codex-header' ? 'log-truncated' : kind === 'malformed-voices' ? 'malformed-record' : 'log-missing';
    expect(result.data.reasons).toEqual(expect.arrayContaining(['ambiguous', reason]));
    expect(result.data.totals.direct.output).toBe(100);
    expect(result.data.totals.correlated.output).toBe(0);
    expect(result.data.totals.unknown.output).toBe(40);
    expect(result.data.by_pass).toEqual([]);
  });

  test('sys.addaudithook guard proves zero network, subprocess, sqlite or credential-file access during capture, plus static import check', () => {
    // Static check on bin/lib/telemetry_usage.py.
    const src = readFileSync(join(ROOT, 'bin/lib/telemetry_usage.py'), 'utf8');
    expect(src).not.toContain('CURSOR_API_KEY');
    for (const forbiddenMod of ['quota.claude', 'quota.codex', 'quota.cursor', 'quota.store', 'quota.Lock', 'quota.identity', 'quota.index', 'quota.samples', 'quota.readers', 'socket', 'subprocess', 'sqlite3', 'urllib', 'http']) {
      expect(src).not.toContain(forbiddenMod);
    }

    const fix = makeTelemetryFixture('community');
    const repo = join(fix.home, 'audit-repo');
    mkdirSync(repo, { recursive: true });
    const projDir = join(fix.home, '.claude/projects/audit-repo');
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, 'syn-claude-parent-001.jsonl'), loadFixtureText('claude-parent.jsonl', { __CWD__: repo }));

    // Plant credential-named files inside the fixture HOME to prove capture never opens them.
    writeFileSync(join(fix.home, '.claude.json'), '{"oauthToken":" planted "}');
    writeFileSync(join(fix.home, '.claude/.credentials.json'), '{"secret":" planted "}');
    mkdirSync(join(fix.home, '.codex'), { recursive: true });
    writeFileSync(join(fix.home, '.codex/auth.json'), '{"token":" planted "}');
    mkdirSync(join(fix.home, '.ssh'), { recursive: true });
    writeFileSync(join(fix.home, '.ssh/id_ed25519'), 'planted');
    mkdirSync(join(fix.home, 'Library/Keychains'), { recursive: true });
    writeFileSync(join(fix.home, 'Library/Keychains/login.keychain-db'), 'planted');

    const sid = 'extend-' + u();
    craft(fix, sid, runRows(sid, T0).rows);

    const audited = runPythonCollect(fix, [
      'violations = []',
      'FORBIDDEN_OPEN = (".claude.json", ".credentials.json", "auth.json", "hosts.yml", "cli-config.json", "jev.json")',
      'def hook(event, args):',
      '    if event.startswith("socket.") or event in ("subprocess.Popen", "os.system", "sqlite3.connect"):',
      '        violations.append((event, str(args)))',
      '    elif event == "open" and args:',
      '        p = str(args[0])',
      '        base_name = os.path.basename(p)',
      '        if base_name in FORBIDDEN_OPEN or "/.ssh/" in p or "/Keychains/" in p:',
      '            violations.append((event, p))',
      'sys.addaudithook(hook)',
      `os.environ["CLAUDE_CODE_SESSION_ID"] = "syn-claude-parent-001"`,
      `status = wm.capture_usage(${JSON.stringify(sid)}, "review-and-prep", ${T0 / 1000}, ${T_END / 1000}, "claude", ${JSON.stringify(repo)}, home=${JSON.stringify(fix.home)})`,
      'print(json.dumps({"status": status, "violations": violations}))',
    ]);
    expect(audited.status).toBe('recorded');
    expect(audited.violations).toEqual([]);
  }, 60_000);

  test('nested containing steps (run > phase > voice) assign usage to the innermost step via ancestor elimination', () => {
    const { fix, repo } = ownClaudeFixture();
    const sid = 'extend-' + u();
    const run = runRows(sid, T0);
    const phaseStep = u();
    const voiceStep = u();
    const testsStep = u();
    // claude-parent.jsonl has turn 1 at T0+10s..T0+12s (input 100, output 40) and turn 2 at T0+45s (input 200, output 60).
    // Nest voiceStep [T0+5s, T0+20s] inside phaseStep (local-pass) [T0+2s, T0+35s], both inside run.step.
    craft(fix, sid, [
      ...run.rows,
      { op: 'begin', at: T0 + 2_000, request: { ...base(sid), step_id: phaseStep, parent_step_id: run.step, kind: 'phase', phase: 'local-pass' } },
      { op: 'begin', at: T0 + 5_000, request: { ...base(sid), step_id: voiceStep, parent_step_id: phaseStep, kind: 'voice', phase: 'voice' } },
      { op: 'end', at: T0 + 20_000, request: { ...base(sid), step_id: voiceStep, outcome: 'completed' } },
      { op: 'end', at: T0 + 35_000, request: { ...base(sid), step_id: phaseStep, outcome: 'completed' } },
      { op: 'begin', at: T0 + 40_000, request: { ...base(sid), step_id: testsStep, parent_step_id: run.step, kind: 'phase', phase: 'tests' } },
      { op: 'end', at: T0 + 55_000, request: { ...base(sid), step_id: testsStep, outcome: 'completed' } },
    ]);

    const status = runPythonCollect(fix, [
      'os.environ["CLAUDE_CODE_SESSION_ID"] = "syn-claude-parent-001"',
      `print(json.dumps(wm.capture_usage(${JSON.stringify(sid)}, "review-and-prep", ${T0 / 1000}, ${T_END / 1000}, "claude", ${JSON.stringify(repo)}, home=${JSON.stringify(fix.home)})))`,
    ]);
    expect(status).toBe('recorded');

    const usageRec = ledgerLines(fix, sid).map(l => JSON.parse(l)).find(r => r.op === 'usage')!;
    expect(usageRec.request.buckets).toEqual([
      expect.objectContaining({ placement: 'step', step_id: voiceStep, input: 100, output: 40 }),
      expect.objectContaining({ placement: 'step', step_id: testsStep, input: 200, output: 60 }),
    ]);

    const usageEnv = JSON.parse(readUsage(fix, sid).stdout);
    expect(usageEnv.status).toBe('ok');
    expect(usageEnv.data.by_phase.voice.direct).toMatchObject({ input: 100, output: 40 });
    expect(usageEnv.data.by_phase.tests.direct).toMatchObject({ input: 200, output: 60 });
    expect(usageEnv.data.by_phase['local-pass']).toBeUndefined();
    expect(usageEnv.data.by_phase.unattributed).toBeUndefined();
  });

  test('missing-usage projection returns capture=missing, no-usage-record, and null totals on a bound ledger without usage', () => {
    const fix = makeTelemetryFixture('community');
    const sid = 'extend-' + u();
    const run = runRows(sid, T0);
    craft(fix, sid, [
      ...run.rows,
      { op: 'end', at: T0 + 10_000, request: { ...base(sid), step_id: run.step, outcome: 'completed' } },
    ]);

    const usageEnv = JSON.parse(readUsage(fix, sid).stdout);
    expect(usageEnv.status).toBe('ok');
    expect(usageEnv.reason).toBeNull();
    expect(usageEnv.data).toEqual({
      capture: 'missing',
      reasons: ['no-usage-record'],
      stage: 'review-and-prep',
      harness: null,
      window: null,
      observed_through_ms: null,
      totals: {
        direct: { input: null, cache_read: null, cache_write: null, output: null, reasoning: null, null_reasons: ['not-reported'] },
        correlated: { input: null, cache_read: null, cache_write: null, output: null, reasoning: null, null_reasons: ['not-reported'] },
        unknown: { input: null, cache_read: null, cache_write: null, output: null, reasoning: null, null_reasons: ['not-reported'] },
      },
      by_model: [],
      by_phase: {},
      by_pass: [],
      children: { direct: 0, correlated: 0, unknown: 0, 'outlived-step': 0, 'may-continue': 0 },
      cli_reported: [],
      windows: [],
    });
  });

  test('conflicting usage rows and dangling step, pass, and attempt references report partial capture without double counting', () => {
    const fix = makeTelemetryFixture('community');
    const ownSource = {
      ref: 'a'.repeat(64),
      agent: 'claude',
      relation: 'own',
      parent_ref: null,
      evidence: 'direct',
      link: null,
      link_evidence: null,
      models: ['claude-opus-4-6'],
      first_ms: T0 + 10_000,
      last_ms: T0 + 12_000,
      complete: true,
      reasons: [],
    };
    const makeUsageReq = (overrides: Record<string, any> = {}) => ({
      v: 1,
      stage: 'review-and-prep',
      session_id: 'extend-' + u(),
      event_id: u(),
      status: 'ok',
      harness: 'claude',
      window: { begin_ms: T0, end_ms: T_END },
      observed_through_ms: T0 + 20_000,
      reasons: [],
      sources: [ownSource],
      buckets: [
        { source: 0, model: 'claude-opus-4-6', step_id: null, placement: 'outside-steps', input: 100, cache_read: 0, cache_write: 0, output: 40, reasoning: null, null_reasons: ['not-reported'], responses: 1 },
      ],
      windows: [],
      cli_reported: [],
      ...overrides,
    });

    // 1. Two distinct usage records in one ledger: conflicting-usage, no double-counted totals.
    const sidDup = 'extend-' + u();
    const runDup = runRows(sidDup, T0);
    const req1 = makeUsageReq({ session_id: sidDup, event_id: u() });
    const req2 = makeUsageReq({
      session_id: sidDup,
      event_id: u(),
      buckets: [{ source: 0, model: 'claude-opus-4-6', step_id: null, placement: 'outside-steps', input: 500, cache_read: 0, cache_write: 0, output: 200, reasoning: null, null_reasons: ['not-reported'], responses: 1 }],
    });
    craft(fix, sidDup, [
      ...runDup.rows,
      { op: 'usage', at: T0 + 30_000, request: req1 },
      { op: 'usage', at: T0 + 31_000, request: req2 },
    ]);
    const dupEnv = JSON.parse(readUsage(fix, sidDup).stdout);
    expect(dupEnv).toMatchObject({ status: 'partial', reason: 'malformed-record' });
    expect(dupEnv.data.capture).toBe('partial');
    expect(dupEnv.data.reasons).toContain('conflicting-usage');
    expect(dupEnv.data.totals.direct).toMatchObject({ input: 100, output: 40 });

    // 2. Same event_id on two usage records with differing payloads: event-conflict + conflicting-usage, no double-counted totals.
    const sidSameId = 'extend-' + u();
    const sharedEventId = u();
    craft(fix, sidSameId, [
      ...runRows(sidSameId, T0).rows,
      { op: 'usage', at: T0 + 30_000, request: makeUsageReq({ session_id: sidSameId, event_id: sharedEventId }) },
      { op: 'usage', at: T0 + 31_000, request: makeUsageReq({
        session_id: sidSameId,
        event_id: sharedEventId,
        buckets: [{ source: 0, model: 'claude-opus-4-6', step_id: null, placement: 'outside-steps', input: 900, cache_read: 0, cache_write: 0, output: 300, reasoning: null, null_reasons: ['not-reported'], responses: 1 }],
      }) },
    ]);
    const sameIdEnv = JSON.parse(readUsage(fix, sidSameId).stdout);
    expect(sameIdEnv).toMatchObject({ status: 'partial', reason: 'malformed-record' });
    expect(sameIdEnv.data.capture).toBe('partial');
    expect(sameIdEnv.data.reasons).toEqual(expect.arrayContaining(['conflicting-usage', 'event-conflict']));
    expect(sameIdEnv.data.totals.direct).toMatchObject({ input: 100, output: 40 });

    // 3. Dangling step_id, source.link pass_id/attempt_id, and cli_reported.link pass_id/attempt_id each yield missing-reference.
    const knownPass = passRows('extend-' + u(), { at: T0 + 5_000, voices: [{ voice: 'red-team', findings: [] }] });
    for (const [label, buildCase] of [
      ['dangling-step', (sid: string) => ({
        extraRows: [],
        req: makeUsageReq({
          session_id: sid,
          buckets: [{ source: 0, model: 'claude-opus-4-6', step_id: u(), placement: 'step', input: 100, cache_read: 0, cache_write: 0, output: 40, reasoning: null, null_reasons: ['not-reported'], responses: 1 }],
        }),
      })],
      ['dangling-source-pass', (sid: string) => ({
        extraRows: [],
        req: makeUsageReq({
          session_id: sid,
          sources: [
            ownSource,
            { ref: 'b'.repeat(64), agent: 'claude', relation: 'subagent', parent_ref: 'a'.repeat(64), evidence: 'direct', link: { pass_id: u(), attempt_id: null, voice_id: 'red-team', pass: 1, attempt: 1 }, link_evidence: 'direct', models: ['claude-sonnet-4-6'], first_ms: T0 + 10_000, last_ms: T0 + 12_000, complete: true, reasons: [] },
          ],
        }),
      })],
      ['dangling-source-attempt', (sid: string) => {
        const p = passRows(sid, { at: T0 + 5_000, voices: [{ voice: 'red-team', findings: [] }] });
        return {
          extraRows: p.rows,
          req: makeUsageReq({
            session_id: sid,
            sources: [
              ownSource,
              { ref: 'b'.repeat(64), agent: 'claude', relation: 'subagent', parent_ref: 'a'.repeat(64), evidence: 'direct', link: { pass_id: p.passId, attempt_id: u(), voice_id: 'red-team', pass: 1, attempt: 1 }, link_evidence: 'direct', models: ['claude-sonnet-4-6'], first_ms: T0 + 10_000, last_ms: T0 + 12_000, complete: true, reasons: [] },
            ],
          }),
        };
      }],
      ['dangling-cli-pass', (sid: string) => ({
        extraRows: [],
        req: makeUsageReq({
          session_id: sid,
          cli_reported: [{
            voice_id: 'red-team',
            link: { pass_id: knownPass.passId, attempt_id: null, voice_id: 'red-team', pass: 1, attempt: 1 },
            input_tokens: 50, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
          }],
        }),
      })],
      ['dangling-cli-attempt', (sid: string) => {
        const p = passRows(sid, { at: T0 + 5_000, voices: [{ voice: 'red-team', findings: [] }] });
        return {
          extraRows: p.rows,
          req: makeUsageReq({
            session_id: sid,
            cli_reported: [{
              voice_id: 'red-team',
              link: { pass_id: p.passId, attempt_id: u(), voice_id: 'red-team', pass: 1, attempt: 1 },
              input_tokens: 50, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
            }],
          }),
        };
      }],
    ] as const) {
      const sid = 'extend-' + u();
      const { extraRows, req } = buildCase(sid);
      craft(fix, sid, [
        ...runRows(sid, T0).rows,
        ...extraRows,
        { op: 'usage', at: T0 + 30_000, request: req },
      ]);
      const env = JSON.parse(readUsage(fix, sid).stdout);
      expect(env, label).toMatchObject({ status: 'partial', reason: 'malformed-record' });
      expect(env.data.capture, label).toBe('partial');
      expect(env.data.reasons, label).toContain('missing-reference');
      expect(env.data.totals.direct, label).toMatchObject({ input: 100, output: 40 });
      if (label === 'dangling-step') {
        expect(env.data.by_phase.unattributed.direct, label).toMatchObject({ input: 100, output: 40 });
      }
    }
  });

  test('projection limits: 16 model groups and 32 pass groups at the limit and limit+1 null overflowed projections without truncating', () => {
    const fix = makeTelemetryFixture('community');

    // Model groups: MAX_USAGE_MODELS = 16 vs 17.
    for (const count of [16, 17]) {
      const sid = 'extend-' + u();
      const req = {
        v: 1,
        stage: 'review-and-prep',
        session_id: sid,
        event_id: u(),
        status: 'ok',
        harness: 'claude',
        window: { begin_ms: T0, end_ms: T_END },
        observed_through_ms: T0 + 20_000,
        reasons: [],
        sources: [
          { ref: 'a'.repeat(64), agent: 'claude', relation: 'own', parent_ref: null, evidence: 'direct', link: null, link_evidence: null, models: ['claude-model-01'], first_ms: T0 + 10_000, last_ms: T0 + 12_000, complete: true, reasons: [] },
        ],
        buckets: Array.from({ length: count }, (_, i) => ({
          source: 0,
          model: `claude-model-${String(i + 1).padStart(2, '0')}`,
          step_id: null,
          placement: 'outside-steps',
          input: 10,
          cache_read: 0,
          cache_write: 0,
          output: 2,
          reasoning: null,
          null_reasons: ['not-reported'],
          responses: 1,
        })),
        windows: [],
        cli_reported: [],
      };
      craft(fix, sid, [
        ...runRows(sid, T0).rows,
        { op: 'usage', at: T0 + 30_000, request: req },
      ]);
      const env = JSON.parse(readUsage(fix, sid).stdout);
      expect(env.status).toBe('ok');
      expect(env.reason).toBeNull();
      expect(env.data.totals.direct).toMatchObject({ input: count * 10, output: count * 2 });
      if (count === 16) {
        expect(env.data.capture).toBe('ok');
        expect(env.data.reasons).not.toContain('too-many-models');
        expect(env.data.by_model).toHaveLength(16);
      } else {
        expect(env.data.capture).toBe('partial');
        expect(env.data.reasons).toContain('too-many-models');
        expect(env.data.by_model).toBeNull();
      }
    }

    // Pass groups: MAX_USAGE_PASSES = 32 vs 33.
    for (const count of [32, 33]) {
      const sid = 'extend-' + u();
      const sources = Array.from({ length: count }, (_, i) => ({
        ref: String(i + 1).padStart(64, '0'),
        agent: 'claude',
        relation: 'subagent',
        parent_ref: null,
        evidence: 'direct',
        link: { pass_id: null, pass: 1, attempt_id: null, attempt: i + 1, voice_id: `voice-${String(i + 1).padStart(2, '0')}` },
        link_evidence: 'direct',
        models: ['claude-sonnet-4-6'],
        first_ms: T0 + 10_000,
        last_ms: T0 + 12_000,
        complete: true,
        reasons: [],
      }));
      const buckets = Array.from({ length: count }, (_, i) => ({
        source: i,
        model: 'claude-sonnet-4-6',
        step_id: null,
        placement: 'outside-steps',
        input: 5,
        cache_read: 0,
        cache_write: 0,
        output: 1,
        reasoning: null,
        null_reasons: ['not-reported'],
        responses: 1,
      }));
      const req = {
        v: 1,
        stage: 'review-and-prep',
        session_id: sid,
        event_id: u(),
        status: 'ok',
        harness: 'claude',
        window: { begin_ms: T0, end_ms: T_END },
        observed_through_ms: T0 + 20_000,
        reasons: [],
        sources,
        buckets,
        windows: [],
        cli_reported: [],
      };
      craft(fix, sid, [
        ...runRows(sid, T0).rows,
        { op: 'usage', at: T0 + 30_000, request: req },
      ]);
      const env = JSON.parse(readUsage(fix, sid).stdout);
      expect(env.status).toBe('ok');
      expect(env.reason).toBeNull();
      expect(env.data.totals.direct).toMatchObject({ input: count * 5, output: count * 1 });
      if (count === 32) {
        expect(env.data.capture).toBe('ok');
        expect(env.data.reasons).not.toContain('too-many-passes');
        expect(env.data.by_pass).toHaveLength(32);
      } else {
        expect(env.data.capture).toBe('partial');
        expect(env.data.reasons).toContain('too-many-passes');
        expect(env.data.by_pass).toBeNull();
      }
    }
  });
});

describe('Track 69A first-cycle overlap measurement', () => {
  // Value: protects=E5 before/after concurrency measurement uses the existing v2 pass attribution and interval-union wall-clock summary without a new parser;
  //   fails_when=overlapping voice intervals inflate union wall time to the sequential sum or alter findings.by_part;
  //   why_new=Track 69A overlaps specialists, native adversarial and the sequential outside pair while keeping Red Team after specialist merge and QA last;
  //   seam=none; no_claim=installed-agent wall-clock savings (synthetic ledger through real metrics read)
  test('sequential and overlapped cycle-1 runs produce identical findings.by_part and interval-union wall time below the sequential sum', () => {
    const fix = makeTelemetryFixture('community');
    const voices = [
      { voice: 'core', findings: [finding('C1', { found_by: ['core'], attribution_reason: null, resolution: 'fixed' })] },
      { voice: 'testing', findings: [finding('T1', { found_by: ['specialist:testing', 'red-team'], attribution_reason: null, resolution: 'fixed' })] },
      { voice: 'maintainability', findings: [finding('M1', { found_by: ['specialist:maintainability'], attribution_reason: null })] },
      { voice: 'red-team', findings: [] },
      { voice: 'native-adversarial', findings: [finding('A1', { found_by: ['native-adversarial'], attribution_reason: null, resolution: 'fixed' })] },
      { voice: 'outside-challenge', findings: [finding('O1', { found_by: ['outside:challenge'], attribution_reason: null })] },
      { voice: 'outside-structured', findings: [] },
      { voice: 'qa', findings: [finding('Q1', { found_by: ['qa'], attribution_reason: null })] },
    ];
    const buildRun = (sid: string, localSpan: [number, number], voiceSpans: Array<[number, number]>) => {
      const run = runRows(sid, localSpan[0]);
      const localStep = u();
      const rows: any[] = [
        ...run.rows,
        { op: 'begin', at: localSpan[0], request: { ...base(sid), step_id: localStep, parent_step_id: run.step, kind: 'phase', phase: 'local-pass' } },
      ];
      for (const [lo, hi] of voiceSpans) {
        const vStep = u();
        rows.push(
          { op: 'begin', at: lo, request: { ...base(sid), step_id: vStep, parent_step_id: localStep, kind: 'voice', phase: 'voice' } },
          { op: 'end', at: hi, request: { ...base(sid), step_id: vStep, outcome: 'completed' } },
        );
      }
      const pass = passRows(sid, { scope: 'local', at: localSpan[0] + 100, voices });
      rows.push(...pass.rows.map((r) => ({ ...r, request: { ...r.request, v: 2 } })));
      rows.push(
        { op: 'end', at: localSpan[1], request: { ...base(sid), step_id: localStep, outcome: 'completed' } },
        { op: 'end', at: localSpan[1], request: { ...base(sid), step_id: run.step, outcome: 'completed' } },
      );
      craft(fix, sid, rows);
      return read(fix, sid).envelope.data;
    };

    const seqSpans: Array<[number, number]> = [
      [1000, 2000], // core
      [2000, 3000], // testing
      [3000, 4000], // maintainability
      [4000, 5000], // red-team
      [5000, 6000], // native-adversarial
      [6000, 7000], // outside-challenge
      [7000, 8000], // outside-structured
      [8000, 9000], // qa
    ];
    const ovlSpans: Array<[number, number]> = [
      [1000, 2000], // core
      [2000, 3000], // testing (window)
      [2000, 3000], // maintainability (window)
      [3000, 4000], // red-team (after specialist merge)
      [2000, 3000], // native-adversarial (window)
      [2000, 3000], // outside-challenge (window, outside pair 1)
      [3000, 4000], // outside-structured (window, outside pair 2 sequential after challenge)
      [4000, 5000], // qa (last, after every reader)
    ];
    const sequentialSumMs = ovlSpans.reduce((sum, [lo, hi]) => sum + (hi - lo), 0);
    expect(sequentialSumMs).toBe(8000);

    const seq = buildRun('extend-' + u(), [1000, 9000], seqSpans);
    const ovl = buildRun('extend-' + u(), [1000, 5000], ovlSpans);

    expect(seq.capture).toBe('ok');
    expect(ovl.capture).toBe('ok');
    expect(ovl.findings.by_part).toEqual(seq.findings.by_part);
    expect(ovl.findings.by_part).toEqual({
      core: { reported: 1, accepted: 1, rejected: 0 },
      'native-adversarial': { reported: 1, accepted: 1, rejected: 0 },
      'outside:challenge': { reported: 1, accepted: 1, rejected: 0 },
      qa: { reported: 1, accepted: 1, rejected: 0 },
      'red-team': { reported: 1, accepted: 1, rejected: 0 },
      'specialist:maintainability': { reported: 1, accepted: 1, rejected: 0 },
      'specialist:testing': { reported: 1, accepted: 1, rejected: 0 },
    });

    const seqLocalPass = seq.phases.find((p: any) => p.phase === 'local-pass');
    const ovlLocalPass = ovl.phases.find((p: any) => p.phase === 'local-pass');
    const seqVoice = seq.phases.find((p: any) => p.phase === 'voice');
    const ovlVoice = ovl.phases.find((p: any) => p.phase === 'voice');

    expect(seqLocalPass.observed_wall_duration_ms).toBe(8000);
    expect(seq.union_observed_wall_ms).toBe(8000);
    expect(seqVoice.observed_wall_duration_ms).toBe(8000);

    expect(ovlLocalPass.observed_wall_duration_ms).toBe(4000);
    expect(ovl.union_observed_wall_ms).toBe(4000);
    expect(ovlVoice.observed_wall_duration_ms).toBe(4000);
    expect(ovlLocalPass.observed_wall_duration_ms).toBeLessThan(sequentialSumMs);
    expect(ovl.union_observed_wall_ms).toBeLessThan(sequentialSumMs);
  }, 60_000);
});

describe('Track 77B review-state derive parity and sandboxed-segment recovery', () => {
  const REVIEW_STATE_BIN = join(ROOT, 'bin/review-state');
  const GIT_COMMIT_ENV = {
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  };

  function setupGitRepoWithCommits(fix: TelemetryFixture, name = 'repo') {
    const repo = gitRepo(fix, name);
    const gitEnv = { ...fix.env, ...GIT_COMMIT_ENV };
    writeFileSync(join(repo, 'a.txt'), 'base\n');
    expect(spawnSync('git', ['-C', repo, 'add', 'a.txt'], { env: gitEnv }).status).toBe(0);
    expect(spawnSync('git', ['-C', repo, 'commit', '-m', 'base', '--quiet'], { env: gitEnv }).status).toBe(0);
    const baseSha = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { env: gitEnv, encoding: 'utf8' }).stdout.trim();
    writeFileSync(join(repo, 'a.txt'), 'head\n');
    expect(spawnSync('git', ['-C', repo, 'add', 'a.txt'], { env: gitEnv }).status).toBe(0);
    expect(spawnSync('git', ['-C', repo, 'commit', '-m', 'head', '--quiet'], { env: gitEnv }).status).toBe(0);
    const headSha = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { env: gitEnv, encoding: 'utf8' }).stdout.trim();
    const treeSha = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD^{tree}'], { env: gitEnv, encoding: 'utf8' }).stdout.trim();
    return { repo, baseSha, headSha, treeSha };
  }

  let inputCounter = 0;
  function callReviewState(env: Env, repo: string, dir: string, cmd: string[], payload: unknown) {
    const file = join(dir, `in-${++inputCounter}.json`);
    writeFileSync(file, JSON.stringify(payload));
    const res = spawnSync(REVIEW_STATE_BIN, [...cmd, '--dir', dir, '--input', file], { env, cwd: repo, encoding: 'utf8', timeout: 15_000 });
    expect(res.status, `${cmd.join(' ')}: ${res.stderr}`).toBe(0);
    return JSON.parse(res.stdout.trim());
  }

  test('D14 parity: derived metrics from review-state match direct metrics begin|pass|correction|end across passes, attribution, delegation, and corrections', () => {
    const fix = makeTelemetryFixture('community');
    const { repo, baseSha, headSha, treeSha } = setupGitRepoWithCommits(fix, 'repo-parity');
    const dir = join(fix.home, 'ev-parity');
    mkdirSync(dir, { recursive: true });

    const sidDerived = start(fix, repo);
    const sidDirect = start(fix, repo);

    const runId = u();
    const localPassId = u();
    const grepPassId = u();
    const coreAttId = u();
    const secFailAttId = u();
    const secFallbackAttId = u();
    const perfAttId = u();
    const qaFailAttId = u();
    const qaRetryAttId = u();
    const grepAttId = u();
    const corrId = u();

    const coreFindings = [
      { finding_id: 'F-CORE', severity_source: 'P1', severity_rubric: 'core', adjudication: 'accepted', resolution: 'open', duplicate_of: null, found_by: ['core', 'red-team'], attribution_reason: null },
      { finding_id: 'F-DUP', severity_source: 'P2', severity_rubric: 'core', adjudication: 'duplicate', resolution: 'unknown', duplicate_of: 'F-CORE', found_by: ['outside:challenge'], attribution_reason: null },
      { finding_id: 'F-REJ', severity_source: 'P3', severity_rubric: 'other', adjudication: 'rejected', resolution: 'unknown', duplicate_of: null, found_by: ['outside:structured'], attribution_reason: null },
    ];
    const perfFindings = [
      { finding_id: 'F-PERF', severity_source: 'high', severity_rubric: 'specialist', adjudication: 'accepted', resolution: 'fixed', duplicate_of: null, found_by: ['specialist:performance'], attribution_reason: null },
    ];
    const qaFindings = [
      { finding_id: 'F-QA', severity_source: 'medium', severity_rubric: 'other', adjudication: 'deferred', resolution: 'open', duplicate_of: null, found_by: ['qa'], attribution_reason: null },
    ];
    const grepFindings = [
      { finding_id: 'G-1', severity_source: 'P2', severity_rubric: 'greptile', adjudication: 'accepted', resolution: 'fixed', duplicate_of: null, found_by: ['greptile'], attribution_reason: null },
    ];

    const fellBackDelegate = {
      provider: 'openai',
      model: 'gpt-5',
      outcome: 'fell-back',
      fallback_reason: 'timeout',
      replay: false,
      wall_ms: 5000,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: null,
    };
    const creditedDelegate = {
      provider: 'openai',
      model: 'gpt-5',
      outcome: 'credited',
      fallback_reason: null,
      replay: false,
      wall_ms: 850,
      input_tokens: 400,
      output_tokens: 120,
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 20,
    };

    // 1. Record run through bin/review-state
    callReviewState(fix.env, repo, dir, ['start'], {
      run_id: runId,
      base: baseSha,
      plan: { ref: 'docs/plan.md', sha256: 'a'.repeat(64) },
      policy: { value: 'hold scope', source: 'caller prompt' },
      continuation: { prior_stops: 0, max: 3 },
      session_id: sidDerived,
    });
    callReviewState(fix.env, repo, dir, ['record', 'pass'], {
      pass_id: localPassId,
      state: 'started',
      scope: 'local',
      cycle: 1,
      coverage: 'full',
      candidate: { commit: headSha, base: baseSha },
      required_voices: ['core', 'specialist-sec', 'specialist-perf', 'qa'],
      started_at: '2026-11-11T18:00:00Z',
    });
    callReviewState(fix.env, repo, dir, ['record', 'pass'], {
      pass_id: localPassId,
      state: 'attempt',
      voice_id: 'core',
      attempt_id: coreAttId,
      outcome: 'completed',
      findings: coreFindings.map((f, i) => ({ ...f, ...(i === 0 ? { receipt_class: 'non-blocking' } : {}) })),
    });
    callReviewState(fix.env, repo, dir, ['record', 'pass'], {
      pass_id: localPassId,
      state: 'attempt',
      voice_id: 'specialist-sec',
      part: 'specialist:security',
      attempt_id: secFailAttId,
      outcome: 'failed',
      delegate: { ...fellBackDelegate, call_id: 'b'.repeat(64) },
    });
    callReviewState(fix.env, repo, dir, ['record', 'pass'], {
      pass_id: localPassId,
      state: 'attempt',
      voice_id: 'specialist-sec',
      attempt_id: secFallbackAttId,
      predecessor_attempt_id: secFailAttId,
      outcome: 'completed',
      findings: [],
    });
    callReviewState(fix.env, repo, dir, ['record', 'pass'], {
      pass_id: localPassId,
      state: 'attempt',
      voice_id: 'specialist-perf',
      part: 'specialist:performance',
      attempt_id: perfAttId,
      outcome: 'completed',
      delegate: { ...creditedDelegate, call_id: 'c'.repeat(64) },
      findings: perfFindings,
    });
    callReviewState(fix.env, repo, dir, ['record', 'pass'], {
      pass_id: localPassId,
      state: 'attempt',
      voice_id: 'qa',
      attempt_id: qaFailAttId,
      outcome: 'failed',
    });
    callReviewState(fix.env, repo, dir, ['record', 'pass'], {
      pass_id: localPassId,
      state: 'attempt',
      voice_id: 'qa',
      attempt_id: qaRetryAttId,
      predecessor_attempt_id: qaFailAttId,
      outcome: 'completed',
      findings: qaFindings,
    });
    for (const [voiceId, attId] of [
      ['core', coreAttId],
      ['specialist-sec', secFallbackAttId],
      ['specialist-perf', perfAttId],
      ['qa', qaRetryAttId],
    ] as const) {
      callReviewState(fix.env, repo, dir, ['record', 'pass'], {
        pass_id: localPassId,
        state: 'voice-complete',
        voice_id: voiceId,
        selected_attempt_id: attId,
      });
    }
    callReviewState(fix.env, repo, dir, ['record', 'pass'], {
      pass_id: localPassId,
      state: 'completed',
      completed_at: '2026-11-11T18:05:00Z',
    });

    // Greptile pass
    callReviewState(fix.env, repo, dir, ['record', 'pass'], {
      pass_id: grepPassId,
      state: 'started',
      scope: 'greptile',
      cycle: 1,
      coverage: 'full',
      candidate: { commit: headSha, base: baseSha },
      required_voices: ['greptile'],
      started_at: '2026-11-11T18:06:00Z',
    });
    callReviewState(fix.env, repo, dir, ['record', 'pass'], {
      pass_id: grepPassId,
      state: 'attempt',
      voice_id: 'greptile',
      attempt_id: grepAttId,
      outcome: 'completed',
      findings: grepFindings,
    });
    callReviewState(fix.env, repo, dir, ['record', 'pass'], {
      pass_id: grepPassId,
      state: 'voice-complete',
      voice_id: 'greptile',
      selected_attempt_id: grepAttId,
    });
    callReviewState(fix.env, repo, dir, ['record', 'pass'], {
      pass_id: grepPassId,
      state: 'completed',
      completed_at: '2026-11-11T18:07:00Z',
    });

    // Finding correction on F-CORE -> resolution: fixed
    callReviewState(fix.env, repo, dir, ['record', 'correction'], {
      correction_id: corrId,
      target: { pass_id: localPassId, voice_id: 'core', attempt_id: coreAttId, finding_id: 'F-CORE' },
      resolution: 'fixed',
    });
    callReviewState(fix.env, repo, dir, ['finish'], {
      outcome: 'prepared',
      base: baseSha,
    });

    const deriveRes = runRaw(fix.env, ['derive', '--dir', dir], '', repo);
    expect(deriveRes.status).toBe(0);
    const deriveSummary = JSON.parse(deriveRes.stdout);
    expect(deriveSummary).toMatchObject({
      status: 'ok',
      reason: null,
      run_id: runId,
      skipped: [],
      segments: [{ segment: 1, session_id: sidDerived, derived: false, binding: 'handoff', replayed: 0 }],
    });

    // 2. Write the equivalent records directly via metrics begin|pass|correction|end on sidDirect
    const directStep = u();
    const candCtx = { candidate_head: headSha, candidate_tree: treeSha, candidate_base: baseSha, binding: 'unknown' };
    expect(metrics(fix.env, 'begin', { ...base(sidDirect), step_id: directStep, parent_step_id: null, kind: 'run', phase: 'run', context: { ...candCtx, skill_sha256: null, parent_session_id: null } }, repo).envelope.status).toBe('recorded');
    expect(metrics(fix.env, 'pass', { v: 2, stage: 'review-and-prep', session_id: sidDirect, event_id: u(), pass_id: localPassId, scope: 'local', state: 'started', required_voice_ids: ['core', 'specialist-sec', 'specialist-perf', 'qa'], context: candCtx }, repo).envelope.status).toBe('recorded');
    expect(metrics(fix.env, 'pass', { v: 2, stage: 'review-and-prep', session_id: sidDirect, event_id: u(), pass_id: localPassId, scope: 'local', state: 'attempt', voice_id: 'core', attempt_id: coreAttId, predecessor_attempt_id: null, attempt_outcome: 'completed', findings: coreFindings }, repo).envelope.status).toBe('recorded');
    expect(metrics(fix.env, 'pass', { v: 3, stage: 'review-and-prep', session_id: sidDirect, event_id: u(), pass_id: localPassId, scope: 'local', state: 'attempt', voice_id: 'specialist-sec', attempt_id: secFailAttId, predecessor_attempt_id: null, attempt_outcome: 'failed', delegate: fellBackDelegate }, repo).envelope.status).toBe('recorded');
    expect(metrics(fix.env, 'pass', { v: 2, stage: 'review-and-prep', session_id: sidDirect, event_id: u(), pass_id: localPassId, scope: 'local', state: 'attempt', voice_id: 'specialist-sec', attempt_id: secFallbackAttId, predecessor_attempt_id: secFailAttId, attempt_outcome: 'completed', findings: [] }, repo).envelope.status).toBe('recorded');
    expect(metrics(fix.env, 'pass', { v: 3, stage: 'review-and-prep', session_id: sidDirect, event_id: u(), pass_id: localPassId, scope: 'local', state: 'attempt', voice_id: 'specialist-perf', attempt_id: perfAttId, predecessor_attempt_id: null, attempt_outcome: 'completed', delegate: creditedDelegate, findings: perfFindings }, repo).envelope.status).toBe('recorded');
    expect(metrics(fix.env, 'pass', { v: 2, stage: 'review-and-prep', session_id: sidDirect, event_id: u(), pass_id: localPassId, scope: 'local', state: 'attempt', voice_id: 'qa', attempt_id: qaFailAttId, predecessor_attempt_id: null, attempt_outcome: 'failed' }, repo).envelope.status).toBe('recorded');
    expect(metrics(fix.env, 'pass', { v: 2, stage: 'review-and-prep', session_id: sidDirect, event_id: u(), pass_id: localPassId, scope: 'local', state: 'attempt', voice_id: 'qa', attempt_id: qaRetryAttId, predecessor_attempt_id: qaFailAttId, attempt_outcome: 'completed', findings: qaFindings }, repo).envelope.status).toBe('recorded');
    for (const [voiceId, attId] of [
      ['core', coreAttId],
      ['specialist-sec', secFallbackAttId],
      ['specialist-perf', perfAttId],
      ['qa', qaRetryAttId],
    ] as const) {
      expect(metrics(fix.env, 'pass', { v: 2, stage: 'review-and-prep', session_id: sidDirect, event_id: u(), pass_id: localPassId, scope: 'local', state: 'voice-complete', voice_id: voiceId, voice_status: 'completed', selected_attempt_id: attId }, repo).envelope.status).toBe('recorded');
    }
    expect(metrics(fix.env, 'pass', { v: 2, stage: 'review-and-prep', session_id: sidDirect, event_id: u(), pass_id: localPassId, scope: 'local', state: 'completed' }, repo).envelope.status).toBe('recorded');

    expect(metrics(fix.env, 'pass', { v: 2, stage: 'review-and-prep', session_id: sidDirect, event_id: u(), pass_id: grepPassId, scope: 'greptile', state: 'started', required_voice_ids: ['greptile'], context: candCtx }, repo).envelope.status).toBe('recorded');
    expect(metrics(fix.env, 'pass', { v: 2, stage: 'review-and-prep', session_id: sidDirect, event_id: u(), pass_id: grepPassId, scope: 'greptile', state: 'attempt', voice_id: 'greptile', attempt_id: grepAttId, predecessor_attempt_id: null, attempt_outcome: 'completed', findings: grepFindings }, repo).envelope.status).toBe('recorded');
    expect(metrics(fix.env, 'pass', { v: 2, stage: 'review-and-prep', session_id: sidDirect, event_id: u(), pass_id: grepPassId, scope: 'greptile', state: 'voice-complete', voice_id: 'greptile', voice_status: 'completed', selected_attempt_id: grepAttId }, repo).envelope.status).toBe('recorded');
    expect(metrics(fix.env, 'pass', { v: 2, stage: 'review-and-prep', session_id: sidDirect, event_id: u(), pass_id: grepPassId, scope: 'greptile', state: 'completed' }, repo).envelope.status).toBe('recorded');

    expect(metrics(fix.env, 'correction', { ...base(sidDirect), correction_kind: 'finding', pass_id: localPassId, voice_id: 'core', attempt_id: coreAttId, finding_id: 'F-CORE', resolution: 'fixed' }, repo).envelope.status).toBe('recorded');
    expect(metrics(fix.env, 'correction', { ...base(sidDirect), correction_kind: 'fallback', pass_id: localPassId, voice_id: 'specialist-sec', attempt_id: secFallbackAttId }, repo).envelope.status).toBe('recorded');
    expect(metrics(fix.env, 'correction', { ...base(sidDirect), correction_kind: 'retry', pass_id: localPassId, voice_id: 'qa', attempt_id: qaRetryAttId }, repo).envelope.status).toBe('recorded');
    expect(metrics(fix.env, 'end', { ...base(sidDirect), step_id: directStep, outcome: 'completed' }, repo).envelope.status).toBe('recorded');

    const derivedRead = read(fix, sidDerived).envelope.data;
    const directRead = read(fix, sidDirect).envelope.data;

    expect(derivedRead.capture).toBe('ok');
    expect(derivedRead.local_passes).toBe(directRead.local_passes);
    expect(derivedRead.greptile_passes).toBe(directRead.greptile_passes);
    expect(derivedRead.greptile_attempted).toBe(directRead.greptile_attempted);
    expect(derivedRead.findings).toEqual(directRead.findings);
    expect(derivedRead.greptile_findings).toEqual(directRead.greptile_findings);
    expect(derivedRead.delegated).toEqual(directRead.delegated);
  }, 60_000);

  test('sandboxed first segment (session_id: null) + resumed second segment: cross-segment corrections, post-finish marker binding, idempotent replay, and forged session rejection', () => {
    const fix = makeTelemetryFixture('community');
    const { repo, baseSha, headSha } = setupGitRepoWithCommits(fix, 'repo-sandbox');
    const dir = join(fix.home, 'ev-sandbox');
    mkdirSync(dir, { recursive: true });

    const runId = u();
    const pass1Id = u();
    const att1Id = u();
    const corr1Id = u();
    const corr2Id = u();

    // Segment 1 starts with session_id: null (no telemetry start could run)
    callReviewState(fix.env, repo, dir, ['start'], {
      run_id: runId,
      base: baseSha,
      plan: { ref: 'docs/plan.md', sha256: 'a'.repeat(64) },
      policy: { value: 'hold scope', source: 'caller prompt' },
      continuation: { prior_stops: 0, max: 3 },
      session_id: null,
    });
    callReviewState(fix.env, repo, dir, ['record', 'pass'], {
      pass_id: pass1Id,
      state: 'started',
      scope: 'local',
      cycle: 1,
      coverage: 'full',
      candidate: { commit: headSha, base: baseSha },
      required_voices: ['core'],
      started_at: '2026-11-11T18:00:00Z',
    });
    callReviewState(fix.env, repo, dir, ['record', 'pass'], {
      pass_id: pass1Id,
      state: 'attempt',
      voice_id: 'core',
      attempt_id: att1Id,
      outcome: 'completed',
      findings: [
        { finding_id: 'F-1', severity_source: 'P1', severity_rubric: 'core', adjudication: 'accepted', resolution: 'open', duplicate_of: null, found_by: ['core', 'specialist:testing'], attribution_reason: null },
      ],
    });
    callReviewState(fix.env, repo, dir, ['record', 'pass'], {
      pass_id: pass1Id,
      state: 'voice-complete',
      voice_id: 'core',
      selected_attempt_id: att1Id,
    });
    callReviewState(fix.env, repo, dir, ['record', 'pass'], {
      pass_id: pass1Id,
      state: 'completed',
      completed_at: '2026-11-11T18:05:00Z',
    });
    callReviewState(fix.env, repo, dir, ['record', 'correction'], {
      correction_id: corr1Id,
      target: { pass_id: pass1Id, voice_id: 'core', attempt_id: att1Id, finding_id: 'F-1' },
      adjudication: 'accepted',
      resolution: 'open',
    });
    callReviewState(fix.env, repo, dir, ['checkpoint'], {
      checkpoint_id: u(),
      kind: 'pause',
      base: baseSha,
    });

    // Segment 2 starts with a real telemetry session, then finishes BEFORE derive runs (testing completed-marker binding!)
    const sid2 = start(fix, repo);
    callReviewState(fix.env, repo, dir, ['checkpoint'], {
      checkpoint_id: u(),
      kind: 'resume',
      base: baseSha,
      session_id: sid2,
    });
    callReviewState(fix.env, repo, dir, ['record', 'correction'], {
      correction_id: corr2Id,
      target: { pass_id: pass1Id, voice_id: 'core', attempt_id: att1Id, finding_id: 'F-1' },
      resolution: 'fixed',
      supersedes: corr1Id,
    });
    callReviewState(fix.env, repo, dir, ['finish'], {
      outcome: 'prepared',
      base: baseSha,
    });

    // Finish sid2 first so its handoff moves to telemetry-completed/
    expect(runRaw(fix.env, ['finish', '--skill', 'extend:review-and-prep', '--session-id', sid2, '--outcome', 'success'], '', repo).status).toBe(0);

    const statePath = join(dir, 'review-run-state.json');
    const beforeState = readFileSync(statePath, 'utf8');

    const d1 = JSON.parse(runRaw(fix.env, ['derive', '--dir', dir], '', repo).stdout);
    expect(d1.status).toBe('ok');
    expect(d1.segments).toHaveLength(2);
    expect(d1.segments[0]).toMatchObject({ segment: 1, derived: true, binding: 'derived', reason: null });
    expect(d1.segments[1]).toMatchObject({ segment: 2, session_id: sid2, derived: false, binding: 'completed-marker', reason: null });
    expect(d1.stage_runs).toEqual({ written: 1, present: 0 });
    expect(readFileSync(statePath, 'utf8')).toBe(beforeState);

    const sid1 = d1.segments[0].session_id;
    const read1 = read(fix, sid1).envelope.data;
    expect(read1.capture).toBe('ok');
    expect(read1.local_passes).toBe(1);
    expect(read1.findings).toMatchObject({
      accepted: 1,
      fixed: 1,
      open: 0,
      by_part: {
        core: { reported: 1, accepted: 1, rejected: 0 },
        'specialist:testing': { reported: 1, accepted: 1, rejected: 0 },
      },
    });
    expect(read1.qualified_elapsed_ms).toBeNull();
    expect(read1.unknown_reasons).toContain('missing-end');
    expect(read1.unknown_reasons).not.toContain('missing-reference');

    const read2 = read(fix, sid2).envelope.data;
    expect(read2.capture).toBe('ok');
    expect(read2.unknown_reasons).not.toContain('missing-reference');

    // Second derive replays every event and stage_runs row without duplicating ledger lines
    const lines1Before = ledgerLines(fix, sid1).length;
    const lines2Before = ledgerLines(fix, sid2).length;
    const d2 = JSON.parse(runRaw(fix.env, ['derive', '--dir', dir], '', repo).stdout);
    expect(d2.status).toBe('ok');
    expect(d2.segments[0]).toMatchObject({ segment: 1, binding: 'already-bound', recorded: 0, replayed: lines1Before });
    expect(d2.segments[1]).toMatchObject({ segment: 2, binding: 'already-bound', recorded: 0, replayed: lines2Before });
    expect(d2.stage_runs).toEqual({ written: 0, present: 1 });
    expect(ledgerLines(fix, sid1)).toHaveLength(lines1Before);
    expect(ledgerLines(fix, sid2)).toHaveLength(lines2Before);

    // Forged non-derived session_id with no handoff, marker, or bound ledger fails with identity-missing
    const dirForged = join(fix.home, 'ev-forged');
    mkdirSync(dirForged, { recursive: true });
    const forgedSid = 'extend-' + u();
    callReviewState(fix.env, repo, dirForged, ['start'], {
      run_id: u(),
      base: baseSha,
      plan: { ref: 'docs/plan.md', sha256: 'a'.repeat(64) },
      policy: { value: 'hold scope', source: 'caller prompt' },
      continuation: { prior_stops: 0, max: 3 },
      session_id: forgedSid,
    });
    const dForged = JSON.parse(runRaw(fix.env, ['derive', '--dir', dirForged], '', repo).stdout);
    expect(dForged).toMatchObject({
      status: 'unavailable',
      reason: 'identity-missing',
      segments: [{ segment: 1, session_id: forgedSid, derived: false, binding: 'unbound', recorded: 0, replayed: 0, reason: 'identity-missing' }],
    });
    expect(existsSync(ledgerFile(fix, forgedSid))).toBe(false);
  }, 60_000);
});
