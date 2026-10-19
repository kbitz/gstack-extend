/** Track 24A workflow metrics: real launcher subprocesses in isolated homes (docs/workflow-metrics.schema.json). */
import { afterAll, describe, test, expect } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv from 'ajv';
import { HELPER_BIN, cleanupTelemetryFixtures, makeTelemetryFixture, type TelemetryFixture } from './helpers/telemetry-env';

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
function craft(fix: TelemetryFixture, sid: string, rows: Array<{ op: string; at: number; request: any }>) {
  const file = ledgerFile(fix, sid);
  mkdirSync(join(file, '..'), { recursive: true });
  const lines = rows.map(({ op, at, request }) => {
    const digest = createHash('sha256').update(canonical({ op, request })).digest('hex');
    const record = { v: 1, op, event_id: request.event_id, request_digest: digest, captured_at_ms: at, producer_version: '0.36.13.0', request };
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
    for (const mode of ['env', 'provenance'] as const) {
      const fix = makeTelemetryFixture('community');
      const repo = gitRepo(fix);
      let env = fix.env;
      if (mode === 'env') env = { ...fix.env, GSTACK_EXTEND_WORKFLOW_METRICS: 'off' };
      else { mkdirSync(join(fix.home, '.gstack-extend'), { recursive: true }); writeFileSync(join(fix.home, '.gstack-extend/config'), 'provenance=false\n'); }
      const payload = { ...base('extend-' + u()), step_id: u(), parent_step_id: null, kind: 'run', phase: 'run', context: CTX };
      const { envelope } = metrics(env, 'begin', payload, repo);
      expect(envelope).toMatchObject({ status: 'disabled', reason: 'capture-disabled', data: { capture: 'disabled' } });
      if (mode === 'env') expect(envelope.diagnostics.config_source).toEqual(['GSTACK_EXTEND_WORKFLOW_METRICS']);
      expect(existsSync(join(fix.home, '.gstack-extend/analytics'))).toBe(false);
      expect(fix.readStubArgs()).toEqual([]);
      expect(fix.readLedger()).toEqual([]);
    }
  });
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
    expect(after.data.records).toBe(1);
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
      const child = spawn(HELPER_BIN, ['metrics', 'decision'], { env: fix.env, cwd: repo });
      let out = '', exited = false;
      child.stdin.on('error', () => {}); // a write after the helper's deadline exit may EPIPE
      child.stdout.on('data', d => { out += d; });
      child.on('error', reject);
      child.on('close', () => { exited = true; resolve({ stdout: out, ms: Date.now() - t0 }); });
      setTimeout(() => {
        if (exited) return;
        child.stdin.write(JSON.stringify({ ...base(sid), step_id: u(), phase: 'tests', decision: 'RUN', reason: 'required' }));
        if (close) child.stdin.end();
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
      const child = spawn(HELPER_BIN, ['metrics', 'decision'], { env: fix.env, cwd: repo });
      let out = '';
      child.stdout.on('data', d => { out += d; });
      child.on('error', reject);
      child.on('close', () => resolve(JSON.parse(out)));
      child.stdin.end(JSON.stringify(p));
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
    const env = { ...fix.env, PYTHONPATH: '.' };
    const started = spawnSync(launcher, ['start', '--skill', 'extend:ship-and-land'], { env, cwd: repo, encoding: 'utf8', timeout: 15_000 });
    const sid = /session=(extend-[0-9a-f-]{36})/.exec(started.stdout)?.[1]!;
    const began = spawnSync(launcher, ['metrics', 'begin'], {
      env, cwd: repo, encoding: 'utf8', timeout: 15_000,
      input: JSON.stringify({ ...base(sid, 'ship-and-land'), step_id: u(), parent_step_id: null, kind: 'run', phase: 'run', context: CTX }),
    });
    expect(began.stdout + began.stderr).not.toContain('PLANTED');
    expect(JSON.parse(began.stdout).status).toBe('recorded');
    const readBack = spawnSync(launcher, ['metrics', 'read', '--session-id', sid], { env, cwd: repo, encoding: 'utf8', timeout: 15_000 });
    expect(JSON.parse(readBack.stdout).data.stage).toBe('ship-and-land');
    expect(existsSync(join(install, 'bin/lib/workflow_metrics.py'))).toBe(true);
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
  test('a linear chain applies; competing heads, unqualified targets and duplicate claims stay unknown', () => {
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
    const duplicateByCorrection = build((sid) => [corr(sid, 2100, { adjudication: 'duplicate' })]);
    expect(duplicateByCorrection.data.findings.duplicate).toBeNull();
  }, 60_000);
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

describe('review fixes: stdin, stored-line and confirmation edges', () => {
  test('closed stdin is invalid-input, and an inherited pipe keeps its blocking mode', () => {
    const fix = makeTelemetryFixture('community');
    const closed = spawnSync('bash', ['-c', `"${HELPER_BIN}" metrics begin <&-`], { env: fix.env, encoding: 'utf8', timeout: 15_000 });
    const envelope = JSON.parse(closed.stdout);
    expect(envelope).toMatchObject({ status: 'unavailable', reason: 'invalid-input', diagnostics: { cause: 'stdin-unavailable', trace: null } });
    const shared = spawnSync('bash', ['-c', `(sleep 1) | { "${HELPER_BIN}" metrics begin >/dev/null 2>&1; python3 -c 'import os; print(os.get_blocking(0))'; }`],
      { env: fix.env, encoding: 'utf8', timeout: 15_000 });
    expect(shared.stdout.trim()).toBe('True');
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
