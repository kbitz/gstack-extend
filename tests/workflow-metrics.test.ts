/** Track 24A workflow metrics: real launcher subprocesses in isolated homes (docs/workflow-metrics.schema.json). */
import { afterAll, describe, test, expect } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv from 'ajv';
import { HELPER_BIN, cleanupTelemetryFixtures, compareRealStores, harvestSessionIds, makeTelemetryFixture, snapshotRealStores, assertRealStoresUntouched, type StoreSpec, type TelemetryFixture } from './helpers/telemetry-env';
import { appendFileSync, realpathSync, truncateSync } from 'node:fs';

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
function craft(fix: TelemetryFixture, sid: string, rows: Array<{ op: string; at: number; request: any }>, producerVersion = '0.36.13.0') {
  const file = ledgerFile(fix, sid);
  mkdirSync(join(file, '..'), { recursive: true });
  const lines = rows.map(({ op, at, request }) => {
    const digest = createHash('sha256').update(canonical({ op, request })).digest('hex');
    const record = { v: 1, op, event_id: request.event_id, request_digest: digest, captured_at_ms: at, producer_version: producerVersion, request };
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
  const readCrafted = (rows: (sid: string, runStep: string) => any[], version: string) => {
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
    const none = readCrafted(sid2 => [decide(sid2, 'documentation', u(), 10), ...span(sid2, 'documentation', u(), 11)], '0.1.0');
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
