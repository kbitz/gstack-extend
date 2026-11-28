import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { PART_KEYS, PARTS } from '../src/review-delegate/delegate.ts';
import { BUILD_COMMANDS, buildHelp, buildRequest, FLAG_TABLES, parseDelegationLine, PASS_STATE_FLAGS, PASS_STATES, rubricForPart } from '../src/review-state/build.ts';
import { main } from '../src/review-state/cli.ts';
import { EXPORT_SCHEMA, NAMESPACE, projectState, uuidv5, type ReviewStateExport } from '../src/review-state/export.ts';
import { allocateExclusiveFile, FIELD_FMT, isFreshForBinding, makeCtx, RENDER_EXAMPLES, RENDER_SCHEMA, RENDER_SHAPES, renderDelegationPolicyLine, tilde, unresolvedFindings, wirePart, type RenderCtx } from '../src/review-state/render.ts';
import { SHOW_SCHEMA } from '../src/review-state/show.ts';
import { ADDITIVE_V1_DEFAULTS, applyCommand, DELEGATE_RUNNER_EXTRA_KEYS, HEX40_RE, REASON_TABLE, REQUEST_EXAMPLES, REQUEST_SHAPES, serializeState, STATE_KEYS, validateStoredState, writerOrderKnown, WTREE_RE, type CommandName, type DelegationPolicy, type EnvChecker, type GitInfo, type ReviewRunState } from '../src/review-state/state.ts';
import { classifyLockHolder, readHelperVersion, readLocalBootId, readLocalPidNs } from '../src/review-state/store.ts';
import { openChildStdio, spawnSync as spawnWithFileOutput } from './helpers/child-stdio.ts';
import { GIT_ENV, makeBaseTmp, makeEmptyRepo } from './helpers/fixture-repo.ts';
import { cleanupTelemetryFixtures, HELPER_BIN, makeTelemetryFixture } from './helpers/telemetry-env';

const REPO_ROOT = resolve(import.meta.dir, '..');
const BIN_PATH = join(REPO_ROOT, 'bin', 'review-state');
const DESIGN_PATH = join(REPO_ROOT, 'docs', 'designs', 'review-run-state.md');

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const uid = (n: number) =>
  [8, 4, 4, 4, 12].map((len, i) => (i === 2 ? '7' : i === 3 ? '8' : '') + n.toString(16).padStart(i === 2 || i === 3 ? len - 1 : len, '0')).join('-');

let baseTmp = '';
let repo = '';
let baseSha = '';
let headSha = '';
let treeSha = '';
let dirSeq = 0;

function git(cwd: string, args: string[]): string {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: GIT_ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function newDir(): string {
  const d = join(baseTmp, `ev-${++dirSeq}`);
  mkdirSync(d, { recursive: true });
  return d;
}

function writeJson(dir: string, name: string, payload: unknown): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(payload));
  return p;
}

function runCli(args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; versionPath?: string } = {}) {
  let out = '', err = '';
  const code = main(args, { stdout: (t) => { out += t; }, stderr: (t) => { err += t; }, cwd: opts.cwd ?? repo, env: { ...process.env, ...opts.env }, versionPath: opts.versionPath });
  const json = out.trim().startsWith('{') ? JSON.parse(out.trim()) : null;
  if (json && 'reason' in json) {
    // Check metadata on the real success/refusal paths, not only the envelope factory.
    const entry = REASON_TABLE.find((e) => e.reason === json.reason)!;
    expect(entry).toBeDefined();
    expect(code, json.reason).toBe(entry.exit);
    expect(json.status, json.reason).toBe(entry.status);
    expect(json.side_effects, json.reason).toBe(entry.side_effects);
    expect(json.retry, json.reason).toBe(entry.retry);
    expect(json.helper_version, json.reason).toBe(readHelperVersion(opts.versionPath));
    expect(json.retry_after_ms, json.reason).toBe(json.reason === 'busy'
      ? Number(opts.env?.GSTACK_EXTEND_REVIEW_STATE_LOCK_WAIT_MS ?? process.env.GSTACK_EXTEND_REVIEW_STATE_LOCK_WAIT_MS ?? '5000') : null);
  }
  return { code, out, err, json };
}

function callCmd(dir: string, cmd: string, payload: unknown, opts: { cwd?: string; env?: NodeJS.ProcessEnv; file?: string; versionPath?: string } = {}) {
  const f = writeJson(dir, opts.file ?? `in-${++dirSeq}.json`, payload);
  return runCli([...cmd.split(' '), '--dir', dir, '--input', f], opts);
}

const mkStart = (n = 1, extra: Record<string, unknown> = {}) => ({
  run_id: uid(n),
  base: baseSha,
  plan: { ref: 'docs/plan.md', sha256: sha256('plan-bytes') },
  policy: { value: 'hold scope', source: 'caller prompt', delegation: { status: 'active', parts: ['specialist:security', 'red-team'], config: sha256('cfg'), tools: ['specialist:security'] } },
  continuation: { prior_stops: 0, max: 3 },
  pr: { url: 'https://github.com/kbitz/gstack-extend/pull/240', repo: 'kbitz/gstack-extend', number: 240, head_repo: 'kbitz/gstack-extend', head_branch: 'main', base_ref: 'origin/main' },
  gh_login: 'kbitz',
  session_id: `extend-${uid(900 + n)}`,
  ...extra,
});

const mkPassStarted = (n = 10, extra: Record<string, unknown> = {}) => ({
  pass_id: uid(n),
  state: 'started',
  scope: 'local',
  cycle: 1,
  coverage: 'full',
  candidate: { commit: headSha, base: baseSha, wtree: 'wt:clean' },
  required_voices: ['core', 'specialist-sec'],
  started_at: '2026-11-10T18:00:00Z',
  ...extra,
});

const REAL_POLICY_LINE = 'review-and-prep-policy/v1; in-cap=delta; continuation=repair-only; documentation-audit=final; full-suite=external; final-gate-repair=tests-docs; parent-io=lean; delegate=maintainability,adversarial,red-team; repair-review=behavior-changing; repair-cycles=light; test-gaps=record; blocking=shown; post-audit=classify; run-state=record; max-continuations=1';

let startSeedStatePath = '';
let attemptSeedStatePath = '';
let correctionSeedStatePath = '';
let unrelatedCommitSha = '';

function ensureRefusalSeeds(): { startState: string; attemptState: string; correctionState: string; unrelatedSha: string } {
  if (!startSeedStatePath) {
    const dStart = newDir();
    if (callCmd(dStart, 'start', mkStart(1)).code !== 0) throw new Error('start seed failed');
    startSeedStatePath = join(dStart, 'review-run-state.json');

    const dAtt = newDir();
    copyFileSync(startSeedStatePath, join(dAtt, 'review-run-state.json'));
    if (callCmd(dAtt, 'record pass', mkPassStarted(10)).code !== 0) throw new Error('pass seed failed');
    if (callCmd(dAtt, 'record pass', {
      pass_id: uid(10), state: 'attempt', voice_id: 'core', part: 'core', attempt_id: uid(20), outcome: 'completed',
      findings: [{ finding_id: 'F-1', severity_source: 'P1', severity_rubric: 'core', adjudication: 'accepted', resolution: 'open', found_by: ['core'] }],
    }).code !== 0) throw new Error('core attempt seed failed');
    if (callCmd(dAtt, 'record pass', {
      pass_id: uid(10), state: 'attempt', voice_id: 'specialist-sec', part: 'specialist:security', attempt_id: uid(21), outcome: 'failed',
    }).code !== 0) throw new Error('specialist attempt seed failed');
    attemptSeedStatePath = join(dAtt, 'review-run-state.json');

    const dCorr = newDir();
    copyFileSync(attemptSeedStatePath, join(dCorr, 'review-run-state.json'));
    if (callCmd(dCorr, 'record correction', {
      correction_id: uid(30),
      target: { pass_id: uid(10), voice_id: 'core', attempt_id: uid(20), finding_id: 'F-1' },
      resolution: 'fixed',
      fixed_in: headSha,
    }).code !== 0) throw new Error('correction seed failed');
    correctionSeedStatePath = join(dCorr, 'review-run-state.json');

    unrelatedCommitSha = git(repo, ['commit-tree', treeSha, '-m', 'unrelated']);
  }
  return {
    startState: startSeedStatePath,
    attemptState: attemptSeedStatePath,
    correctionState: correctionSeedStatePath,
    unrelatedSha: unrelatedCommitSha,
  };
}

function dirFromSeed(seedStatePath: string): { dir: string; statePath: string; beforeBytes: string } {
  const dir = newDir();
  const statePath = join(dir, 'review-run-state.json');
  copyFileSync(seedStatePath, statePath);
  const beforeBytes = readFileSync(statePath, 'utf8');
  return { dir, statePath, beforeBytes };
}

beforeAll(() => {
  baseTmp = makeBaseTmp('review-state-test-');
  repo = makeEmptyRepo(baseTmp);
  baseSha = git(repo, ['rev-parse', 'HEAD']);
  writeFileSync(join(repo, 'file.txt'), 'v1\n');
  git(repo, ['add', 'file.txt']);
  git(repo, ['commit', '-m', 'c2', '--quiet']);
  headSha = git(repo, ['rev-parse', 'HEAD']);
  treeSha = git(repo, ['rev-parse', 'HEAD^{tree}']);
});

afterAll(() => {
  if (baseTmp) rmSync(baseTmp, { recursive: true, force: true });
});
afterAll(cleanupTelemetryFixtures, 60_000);

describe('bin/review-state', () => {
  test('replay preserves each pass timestamp and JSON numeric zero', () => {
    const gitInfo = { repo: '/fixture/.git', toplevel: '/fixture', branch: 'topic', head: headSha, tree: treeSha };
    const env = { commitExists: () => true, commitTree: () => treeSha, isAncestor: () => true, checkEvidence: () => null };
    const times = ['2026-11-10T18:00:00Z', '2026-11-10T18:01:00Z'];
    const start = mkStart(1, { continuation: { prior_stops: 0, max: -0 } });
    const opened = applyCommand(null, 'start', start, gitInfo, env, times[0]!);
    if (opened.reason !== 'recorded') throw Error('start failed');
    expect(applyCommand(JSON.parse(serializeState(opened.state)), 'start', start, gitInfo, env, times[1]!).reason).toBe('replayed');
    const input = mkPassStarted();
    const pass = applyCommand(opened.state, 'record pass', input, gitInfo, env, times[0]!);
    if (pass.reason !== 'recorded') throw Error('pass failed');
    const done = { pass_id: input.pass_id, state: 'completed', completed_at: times[1] };
    const completed = applyCommand(pass.state, 'record pass', done, gitInfo, env, times[1]!);
    if (completed.reason !== 'recorded') throw Error('complete failed');
    expect(applyCommand(completed.state, 'record pass', input, gitInfo, env, times[1]!).detail.recorded_at).toBe(times[0]);
    expect(applyCommand(completed.state, 'record pass', done, gitInfo, env, times[0]!).detail.recorded_at).toBe(times[1]);
  });

  test('rejects nested corrupt state without rewriting or consulting removed external evidence', () => {
    const d = newDir();
    callCmd(d, 'start', mkStart());
    callCmd(d, 'record pass', mkPassStarted());
    const finding = { finding_id: 'F', severity_source: 'P1', severity_rubric: 'core', adjudication: 'accepted', resolution: 'open', found_by: ['core'] };
    const delegate = { provider: 'p', model: 'm', outcome: 'credited', fallback_reason: null, replay: false, wall_ms: 1, input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: null, call_id: sha256('call') };
    callCmd(d, 'record pass', { pass_id: uid(10), state: 'attempt', voice_id: 'core', part: 'core', attempt_id: uid(20), outcome: 'completed', delegate, findings: [finding] });
    callCmd(d, 'record pass', { pass_id: uid(10), state: 'voice-complete', voice_id: 'core', selected_attempt_id: uid(20) });
    callCmd(d, 'record correction', { correction_id: uid(30), target: { pass_id: uid(10), voice_id: 'core', attempt_id: uid(20), finding_id: 'F' }, resolution: 'fixed' });
    writeFileSync(join(d, 'proof'), 'proof');
    const evidence = [{ path: 'proof', sha256: sha256('proof') }];
    callCmd(d, 'record gate', { gate_id: uid(40), name: 'pregate', result: 'passed', candidate: { commit: headSha }, details: { raw_verdict: 'PASS', wrapper_verdict: 'PASS', policy: 'head', record_path: 'proof', record_sha256: sha256('proof'), skipped_lanes: [] }, evidence });
    callCmd(d, 'record audit', { audit_id: uid(50), name: 'documentation', result: 'current', details: { report_id: 'd', section_path: 'proof', section_sha256: sha256('proof') }, candidate: { commit: headSha }, evidence });
    callCmd(d, 'checkpoint', { checkpoint_id: uid(60), kind: 'stop', evidence });
    callCmd(d, 'finish', { outcome: 'blocked', stop_reason: 'test', base: baseSha, full_review_evidence: { status: 'available', commit: headSha, tree: treeSha, source: 'ev://baseline' }, evidence });
    const statePath = join(d, 'review-run-state.json');
    const valid = JSON.parse(readFileSync(statePath, 'utf8'));
    const { head: correctionHead, tree: correctionTree, segment: _correctionSegment, recorded_at, ...correctionInput } = valid.corrections[0];
    const changedGit = { repo: valid.run.repo, toplevel: repo, branch: 'main', head: baseSha, tree: treeSha };
    const noExternalReads = { commitExists: () => { throw Error('replay consulted Git'); }, commitTree: () => { throw Error('replay consulted Git'); }, isAncestor: () => { throw Error('replay consulted Git'); }, checkEvidence: () => { throw Error('replay consulted evidence'); } };
    expect(applyCommand(valid, 'record correction', correctionInput, changedGit, noExternalReads, '2026-11-10T19:00:00Z')).toMatchObject({ reason: 'replayed', detail: { head: correctionHead ?? headSha, tree: correctionTree ?? treeSha, recorded_at } });
    unlinkSync(join(d, 'proof'));
    expect(callCmd(d, 'start', mkStart()).json.reason).toBe('replayed');
    const paths = ['run.pr', 'policy.delegation', 'passes.0', 'passes.0.candidate', 'passes.0.voices.0', 'passes.0.voices.0.attempts.0', 'passes.0.voices.0.attempts.0.delegate', 'passes.0.voices.0.attempts.0.findings.0', 'corrections.0', 'corrections.0.target', 'gates.0', 'gates.0.details', 'gates.0.evidence.0', 'audits.0', 'audits.0.details', 'checkpoints.0', 'finish', 'finish.full_review_evidence'];
    for (const path of paths) {
      for (const mutation of ['unknown', 'missing', 'type']) {
        const state = structuredClone(valid);
        let obj = state;
        for (const key of path.split('.')) obj = obj[key];
        if (mutation === 'unknown') obj.unknown_field = true;
        else if (mutation === 'missing') delete obj[Object.keys(obj)[0]!];
        else obj[Object.keys(obj)[0]!] = [];
        const bytes = JSON.stringify(state);
        writeFileSync(statePath, bytes);
        expect(callCmd(d, 'checkpoint', { checkpoint_id: uid(61), kind: 'stop' }).json.reason, `${path}:${mutation}`).toBe('corrupt');
        expect(readFileSync(statePath, 'utf8')).toBe(bytes);
      }
    }
    for (const mutate of [
      (s: any) => { s.corrections[0].target.finding_id = 'missing'; },
      (s: any) => { s.corrections[0].supersedes = uid(999); },
      (s: any) => { s.passes[0].voices[0].attempts[0].predecessor_attempt_id = uid(999); },
      (s: any) => { s.passes[0].voices[0].selected_attempt_id = uid(999); },
      (s: any) => { s.passes.push(structuredClone(s.passes[0])); },
    ]) {
      const state = structuredClone(valid); mutate(state);
      const bytes = JSON.stringify(state); writeFileSync(statePath, bytes);
      expect(callCmd(d, 'checkpoint', { checkpoint_id: uid(61), kind: 'stop' }).json.reason).toBe('corrupt');
      expect(readFileSync(statePath, 'utf8')).toBe(bytes);
    }
  });

  test('all command and pass request shapes reject unknown, missing, mistyped and enum fields', () => {
    const shapes = [
      ['start', () => mkStart(), 'run_id', 'policy.source'],
      ['record pass', () => mkPassStarted(), 'pass_id', 'scope'],
      ['record pass', () => ({ pass_id: uid(10), state: 'attempt', voice_id: 'core', attempt_id: uid(20), outcome: 'failed' }), 'attempt_id', 'outcome'],
      ['record pass', () => ({ pass_id: uid(10), state: 'voice-complete', voice_id: 'core', not_applicable: 'not-applicable' }), 'voice_id', 'not_applicable'],
      ['record pass', () => ({ pass_id: uid(10), state: 'completed', completed_at: '2026-11-10T18:00:00Z' }), 'pass_id', 'state'],
      ['record correction', () => ({ correction_id: uid(30), target: { pass_id: uid(10), voice_id: 'core', attempt_id: uid(20), finding_id: 'F' }, resolution: 'fixed' }), 'correction_id', 'resolution'],
      ['record gate', () => ({ gate_id: uid(40), name: 'tests', result: 'passed', candidate: { commit: headSha } }), 'gate_id', 'result'],
      ['record audit', () => ({ audit_id: uid(50), name: 'coverage', result: 'passed', candidate: { commit: headSha }, details: { pct: 100, threshold: 80 } }), 'audit_id', 'name'],
      ['checkpoint', () => ({ checkpoint_id: uid(60), kind: 'stop' }), 'checkpoint_id', 'kind'],
      ['finish', () => ({ outcome: 'prepared', base: baseSha }), 'base', 'outcome'],
    ] as const;
    for (const [cmd, build, field, enumPath] of shapes) {
      const valid: any = build();
      const setup = () => {
        const d = newDir();
        if (cmd !== 'start') callCmd(d, 'start', mkStart());
        if ((cmd === 'record pass' && valid.state !== 'started') || cmd === 'record correction') callCmd(d, 'record pass', mkPassStarted());
        if (cmd === 'record correction') callCmd(d, 'record pass', { pass_id: uid(10), state: 'attempt', voice_id: 'core', attempt_id: uid(20), outcome: 'completed', findings: [{ finding_id: 'F', severity_source: 'P1', severity_rubric: 'core', adjudication: 'accepted', resolution: 'open', found_by: ['core'] }] });
        return d;
      };
      expect(callCmd(setup(), cmd, valid).json.reason, `${cmd}:${valid.state ?? 'valid'} baseline`).toBe('recorded');
      for (const mode of ['unknown', 'hyphenated', 'camelCase', 'missing', 'type', 'enum']) {
        const payload: any = build();
        if (mode === 'unknown') payload.extra = true;
        else if (mode === 'hyphenated' || mode === 'camelCase') payload[mode === 'hyphenated' ? 'record-id' : 'recordId'] = uid(999);
        else if (mode === 'missing') delete payload[field];
        else if (mode === 'type') payload[field] = [];
        else {
          const parts = enumPath.split('.'); let obj = payload;
          for (const key of parts.slice(0, -1)) obj = obj[key];
          obj[parts.at(-1)!] = 'not-an-enum';
        }
        const d = setup();
        const before = existsSync(join(d, 'review-run-state.json')) ? readFileSync(join(d, 'review-run-state.json'), 'utf8') : null;
        const result = callCmd(d, cmd, payload).json;
        expect(result.reason, `${cmd}:${mode}`).toBe('invalid-input');
        const path = mode === 'enum' ? enumPath : mode === 'unknown' ? 'extra' : mode === 'hyphenated' ? 'record-id' : mode === 'camelCase' ? 'recordId' : field;
        const rule = mode === 'enum' ? 'invalid-enum' : mode === 'missing' ? 'missing-key' : mode === 'type' ? 'invalid-value' : 'unknown-key';
        expect(result.detail.violations, `${cmd}:${mode}`).toContainEqual(expect.objectContaining({ path, rule }));
        expect(existsSync(join(d, 'review-run-state.json')) ? readFileSync(join(d, 'review-run-state.json'), 'utf8') : null).toBe(before);
      }
    }
  });

  test('voice retries retain per-attempt parts and a closed voice refuses new attempts', () => {
    const d = newDir(); callCmd(d, 'start', mkStart()); callCmd(d, 'record pass', mkPassStarted());
    const local = { pass_id: uid(10), state: 'attempt', voice_id: 'core', attempt_id: uid(20), outcome: 'failed' };
    expect(callCmd(d, 'record pass', local).json.reason).toBe('recorded');
    const delegated = { ...local, attempt_id: uid(21), part: 'core', delegate: { provider: 'p', model: 'm', outcome: 'fell-back', fallback_reason: 'failed', replay: false, wall_ms: 1, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: null, call_id: sha256('delegate') } };
    expect(callCmd(d, 'record pass', delegated).json.reason).toBe('recorded');
    expect(callCmd(d, 'record pass', { ...local, attempt_id: uid(22), outcome: 'completed', findings: [] }).json.reason).toBe('recorded');
    expect(callCmd(d, 'record pass', local).json.reason).toBe('replayed');
    expect(callCmd(d, 'record pass', delegated).json.reason).toBe('replayed');
    expect(callCmd(d, 'record pass', { pass_id: uid(10), state: 'voice-complete', voice_id: 'core', selected_attempt_id: uid(22) }).json.reason).toBe('recorded');
    expect(callCmd(d, 'record pass', { ...local, attempt_id: uid(23) }).json.reason).toBe('invalid-input');
    expect(callCmd(d, 'record pass', local).json.reason).toBe('replayed');
    expect(JSON.parse(readFileSync(join(d, 'review-run-state.json'), 'utf8')).passes[0].voices[0].part).toBe('core');
  });

  test('a completed voice refuses newly appended findings while an identical attempt still replays', () => {
    const d = newDir(); callCmd(d, 'start', mkStart()); callCmd(d, 'record pass', mkPassStarted());
    const attempt = { pass_id: uid(10), state: 'attempt', voice_id: 'core', attempt_id: uid(20), outcome: 'completed', findings: [] };
    expect(callCmd(d, 'record pass', attempt).json.reason).toBe('recorded');
    callCmd(d, 'record pass', { pass_id: uid(10), state: 'voice-complete', voice_id: 'core', selected_attempt_id: uid(20) });
    expect(callCmd(d, 'record pass', { ...attempt, attempt_id: uid(21) }).json.reason).toBe('invalid-input');
    expect(callCmd(d, 'record pass', attempt).json.reason).toBe('replayed');
  });

  test.each(['pregate', 'documentation'])('validates pinned %s detail evidence without a duplicated evidence-array item', (name) => {
    const d = newDir(); callCmd(d, 'start', mkStart());
    const details = name === 'pregate'
      ? { raw_verdict: 'PASS', wrapper_verdict: 'PASS', policy: 'head', record_path: 'proof', record_sha256: sha256('proof'), skipped_lanes: [] }
      : { report_id: 'doc', section_path: 'proof', section_sha256: sha256('proof') };
    const cmd = name === 'pregate' ? 'record gate' : 'record audit';
    const payload = { [name === 'pregate' ? 'gate_id' : 'audit_id']: uid(40), name, result: 'passed', candidate: { commit: headSha }, details };
    expect(callCmd(d, cmd, payload).json.reason).toBe('invalid-input');
    writeFileSync(join(d, 'proof'), 'wrong');
    expect(callCmd(d, cmd, payload).json.reason).toBe('invalid-input');
    writeFileSync(join(d, 'proof'), 'proof');
    expect(callCmd(d, cmd, payload).json.reason).toBe('recorded');
    unlinkSync(join(d, 'proof'));
    expect(callCmd(d, cmd, payload).json.reason).toBe('replayed');
  });

  test('final-component directory symlinks stay refused with trailing slash and pinned detail evidence is verified', () => {
    const d = newDir(), link = join(baseTmp, 'trailing-link'); symlinkSync(d, link);
    const input = writeJson(d, 'input.json', mkStart());
    expect(runCli(['start', '--dir', '', '--input', input]).json).toMatchObject({ reason: 'bad-dir', detail: { condition: 'relative' } });
    expect(runCli(['start', '--dir', `${link}/`, '--input', input]).json).toMatchObject({ reason: 'bad-dir', detail: { condition: 'symlink' } });
    callCmd(d, 'start', mkStart());
    for (const [cmd, payload] of [
      ['record gate', { gate_id: uid(40), name: 'pregate', result: 'passed', candidate: { commit: headSha }, details: { raw_verdict: 'PASS', wrapper_verdict: 'PASS', policy: 'head', record_path: 'absent', record_sha256: sha256('absent'), skipped_lanes: [] } }],
      ['record audit', { audit_id: uid(50), name: 'documentation', result: 'current', candidate: { commit: headSha }, details: { report_id: 'doc', section_path: 'absent', section_sha256: sha256('absent') } }],
    ] as const) expect(callCmd(d, cmd, payload).json.reason).toBe('invalid-input');
  });

  test('lock initialization failure cleans its exclusive lock before identical retry', () => {
    const d = newDir(), input = writeJson(d, 'input.json', mkStart());
    const script = `import { mock } from 'bun:test'; const fs = {...await import('node:fs')}; let fail = true;
      mock.module('node:fs', () => ({...fs, fsyncSync(fd) { if (fail) { fail=false; throw Object.assign(new Error('injected'), {code:'ENOSPC',syscall:'fsync'}); } return fs.fsyncSync(fd); }}));
      const {executeCommand}=await import(${JSON.stringify(join(REPO_ROOT, 'src/review-state/store.ts'))});
      const first=executeCommand('start',${JSON.stringify(d)},${JSON.stringify(input)},${JSON.stringify(repo)});
      const lock=fs.existsSync(${JSON.stringify(join(d, 'review-run-state.json.lock'))});
      const second=executeCommand('start',${JSON.stringify(d)},${JSON.stringify(input)},${JSON.stringify(repo)},{...process.env,GSTACK_EXTEND_REVIEW_STATE_LOCK_WAIT_MS:'0'});
      console.log(JSON.stringify({first:first.reason,lock,second:second.reason}));`;
    const result = spawnSync(process.execPath, ['--no-env-file', '--no-install', '--config=/dev/null', '-e', script], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ first: 'unwritable', lock: false, second: 'recorded' });
  });

  test.each([false, true])('Git binding pins its tree and refreshes after a forced lock wait: %s', (changeDuringWait) => {
    const ownRepo = makeEmptyRepo(baseTmp);
      const d = newDir(), input = writeJson(d, 'input.json', { ...mkStart(), base: git(ownRepo, ['rev-parse', 'HEAD']) });
      const lock = join(d, 'review-run-state.json.lock');
      if (changeDuringWait) writeFileSync(lock, 'held');
      const before = git(ownRepo, ['rev-parse', 'HEAD']);
      // The injected Git read simulates HEAD changing between the two discovery calls.
      // The injected EEXIST path forces one actual wait-loop visit before releasing the lock.
      const script = `import {mock} from 'bun:test'; const fs={...await import('node:fs')}, cp={...await import('node:child_process')};
        const cwd=${JSON.stringify(ownRepo)}, lock=${JSON.stringify(lock)}; const gitEnv={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('GIT_'))),GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
        function advance() {fs.writeFileSync(cwd+'/new-file','new'); for(const args of [['add','new-file'],['commit','-m','advance']]) { const r=cp.spawnSync('git',['-C',cwd,...args],{env:gitEnv}); if(r.status!==0)throw Error('fixture commit'); }}
        let once=true;
        mock.module('node:child_process',()=>({...cp,spawnSync(file,args,options){const r=cp.spawnSync(file,args,options); if(!${changeDuringWait} && once && args.at(-2)==='rev-parse' && args.at(-1)==='HEAD'){once=false;advance();} return r;}}));
        mock.module('node:fs',()=>({...fs,openSync(path,...args){try{return fs.openSync(path,...args);}catch(e){if(${changeDuringWait} && once && path===lock && e.code==='EEXIST'){once=false;advance();fs.unlinkSync(lock);}throw e;}}}));
        const {executeCommand}=await import(${JSON.stringify(join(REPO_ROOT, 'src/review-state/store.ts'))});
        const r=executeCommand('start',${JSON.stringify(d)},${JSON.stringify(input)},cwd);
        const state=JSON.parse(fs.readFileSync(${JSON.stringify(join(d, 'review-run-state.json'))},'utf8'));
        console.log(JSON.stringify({reason:r.reason,binding:state.binding}));`;
      const result = spawnSync(process.execPath, ['--no-env-file', '--no-install', '--config=/dev/null', '-e', script], { encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      const { reason, binding } = JSON.parse(result.stdout);
      expect(reason).toBe('recorded');
      expect(binding.head).toBe(changeDuringWait ? git(ownRepo, ['rev-parse', 'HEAD']) : before);
      expect(binding.tree).toBe(git(ownRepo, ['rev-parse', `${binding.head}^{tree}`]));
  });
  test('launcher exec line and --help reason parity with REASON_TABLE and design anchors', () => {
    const launcher = readFileSync(BIN_PATH, 'utf8');
    expect(launcher).toContain('if ! bun_prereq_probe; then');
    expect(launcher).toContain('exec "$BUN_PREREQ_RAW_PATH" --no-env-file --no-install --config=/dev/null');
    const design = readFileSync(DESIGN_PATH, 'utf8');
    const anchors = [...design.matchAll(/<a id="reason-([a-z-]+)"><\/a>/g)].map((m) => m[1]);
    expect(anchors).toEqual(REASON_TABLE.map((r) => r.reason));

    const empty = newDir();
    const h = runCli(['--help'], { cwd: empty });
    expect(h.code).toBe(0);
    expect(h.out).toContain('Experimental internal helper; /review-and-prep records its run state by default.');
    expect(h.out).toContain('bin/review-state full-review-record WORKSPACE DIR write|check KIND FILE|BOUNDARY');
    const helpReasons = [...h.out.matchAll(/^ {2}([a-z-]+) \(status=/gm)].map((m) => m[1]);
    expect(helpReasons).toEqual(REASON_TABLE.map((r) => r.reason));
    for (const sub of [['start', '--help'], ['record', 'pass', '--help'], ['checkpoint', '-h'], ['finish', '--help']]) {
      expect(runCli(sub, { cwd: empty }).code).toBe(0);
    }
    expect(readdirSync(empty)).toEqual([]);
  });

  test('design walkthrough payloads from docs/designs/review-run-state.md record and replay', () => {
    const design = readFileSync(DESIGN_PATH, 'utf8');
    const blocks = [...design.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) =>
      JSON.parse(m[1]!.replaceAll('<BASE_SHA>', baseSha).replaceAll('<HEAD_SHA>', headSha).replaceAll('<PLAN_SHA256>', sha256('walkthrough-plan'))),
    );
    expect(blocks.length).toBe(4);
    const d = newDir();
    expect(callCmd(d, 'start', blocks[0]).json).toMatchObject({ status: 'recorded', rev: 1 });
    expect(callCmd(d, 'record pass', blocks[1]).json).toMatchObject({ status: 'recorded', rev: 2 });
    expect(callCmd(d, 'record pass', blocks[2]).json).toMatchObject({ status: 'recorded', rev: 3 });
    expect(callCmd(d, 'finish', blocks[3]).json).toMatchObject({ status: 'recorded', rev: 4 });
    expect(callCmd(d, 'finish', blocks[3]).json).toMatchObject({ status: 'replayed', rev: 4 });
  });

  test('accepts every command and record type, reruns gates, and stabilizes serialized key order', () => {
    const d = newDir();
    writeFileSync(join(d, 'ev.txt'), 'evidence-body');
    const ev = [{ path: 'ev.txt', sha256: sha256('evidence-body') }];
    expect(callCmd(d, 'start', mkStart(1)).json).toMatchObject({ reason: 'recorded', rev: 1 });
    expect(callCmd(d, 'record pass', mkPassStarted(10)).json).toMatchObject({ reason: 'recorded', rev: 2 });

    const att1 = {
      pass_id: uid(10), state: 'attempt', voice_id: 'specialist-sec', part: 'specialist:security', attempt_id: uid(20), outcome: 'failed',
      delegate: { provider: 'codex', model: 'gpt-5', outcome: 'fell-back', fallback_reason: 'timeout', replay: false, wall_ms: 120, input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: null, call_id: sha256('call-1') },
    };
    expect(callCmd(d, 'record pass', att1).json).toMatchObject({ reason: 'recorded', rev: 3 });

    const att2 = {
      pass_id: uid(10), state: 'attempt', voice_id: 'specialist-sec', part: 'specialist:security', attempt_id: uid(21), outcome: 'completed', predecessor_attempt_id: uid(20),
      dispatched_at: '2026-11-10T18:01:00Z', returned_at: '2026-11-10T18:02:00Z',
      delegate: { provider: 'claude', model: 'sonnet', outcome: 'credited', fallback_reason: null, replay: true, wall_ms: 200, input_tokens: 50, output_tokens: 25, cache_read_input_tokens: 10, cache_creation_input_tokens: 5, call_id: sha256('call-2') },
      findings: [
        { finding_id: 'F-1', severity_source: 'P1', severity_rubric: 'specialist', adjudication: 'accepted', resolution: 'open', found_by: ['specialist:security'] },
        { finding_id: 'F-2', severity_source: 'P2', severity_rubric: 'specialist', adjudication: 'duplicate', resolution: 'unknown', duplicate_of: 'F-1', found_by: [], attribution_reason: 'not-reported' },
      ],
    };
    expect(callCmd(d, 'record pass', att2).json).toMatchObject({ reason: 'recorded', rev: 4 });
    expect(callCmd(d, 'record pass', { pass_id: uid(10), state: 'voice-complete', voice_id: 'specialist-sec', selected_attempt_id: uid(21) }).json).toMatchObject({ reason: 'recorded', rev: 5 });
    expect(callCmd(d, 'record pass', { pass_id: uid(10), state: 'voice-complete', voice_id: 'core', not_applicable: 'not-applicable' }).json).toMatchObject({ reason: 'recorded', rev: 6 });
    expect(callCmd(d, 'record pass', { pass_id: uid(10), state: 'completed', completed_at: '2026-11-10T18:03:00Z' }).json).toMatchObject({ reason: 'recorded', rev: 7 });

    const corr1 = { correction_id: uid(30), target: { pass_id: uid(10), voice_id: 'specialist-sec', attempt_id: uid(21), finding_id: 'F-1' }, resolution: 'fixed', fixed_in: headSha };
    const corr2 = { correction_id: uid(31), target: { pass_id: uid(10), voice_id: 'specialist-sec', attempt_id: uid(21), finding_id: 'F-1' }, receipt_class: 'non-blocking', supersedes: uid(30) };
    expect(callCmd(d, 'record correction', corr1).json).toMatchObject({ reason: 'recorded', rev: 8 });
    expect(callCmd(d, 'record correction', corr2).json).toMatchObject({ reason: 'recorded', rev: 9 });

    const gPre = { gate_id: uid(40), name: 'pregate', result: 'failed', candidate: { commit: headSha, base: baseSha }, details: { raw_verdict: 'FAIL', wrapper_verdict: 'FAIL', policy: 'head', record_path: 'ev.txt', record_sha256: sha256('evidence-body'), skipped_lanes: ['lint'] }, evidence: ev };
    const gPre2 = { ...gPre, gate_id: uid(41), result: 'passed', details: { ...gPre.details, raw_verdict: 'PASS', wrapper_verdict: 'PASS', skipped_lanes: [] } };
    const gGrep = { gate_id: uid(42), name: 'greptile', result: 'passed', candidate: { commit: baseSha, base: baseSha }, details: { value: 'reviewed (0 comments)', run: 'https://github.com/kbitz/gstack-extend/pull/240' } };
    const gTests = { gate_id: uid(43), name: 'tests', result: 'passed', reason: 'targeted green', candidate: { commit: headSha, base: baseSha } };
    for (const g of [gPre, gPre2, gGrep, gTests]) expect(callCmd(d, 'record gate', g).json.reason).toBe('recorded');

    const aCov = { audit_id: uid(50), name: 'coverage', result: 'passed', details: { pct: 92.5, threshold: 80 }, candidate: { commit: headSha, base: baseSha }, evidence: ev };
    const aDoc = { audit_id: uid(51), name: 'documentation', result: 'passed', details: { report_id: 'doc-1', section_path: 'ev.txt', section_sha256: sha256('evidence-body') }, candidate: { commit: headSha, base: baseSha } };
    expect(callCmd(d, 'record audit', aCov).json.reason).toBe('recorded');
    expect(callCmd(d, 'record audit', aDoc).json.reason).toBe('recorded');

    for (const [i, kind] of (['before-fix', 'next-cycle', 'stop', 'external-gate'] as const).entries()) {
      expect(callCmd(d, 'checkpoint', { checkpoint_id: uid(60 + i), kind, base: baseSha, wtree: 'wt:1', evidence: ev }).json.reason).toBe('recorded');
    }

    const fin = { outcome: 'prepared', base: baseSha, wtree: 'wt:1', review_restriction_resolved: true, readiness_confirmed_at: '2026-11-10T18:10:00Z', full_review_evidence: { status: 'available', commit: headSha, tree: treeSha, source: 'ev://cycle-1-baseline' }, user_facing_changes: ['Added bin/review-state helper.'], evidence: ev };
    expect(callCmd(d, 'finish', fin).json.reason).toBe('recorded');

    const rawBytes = readFileSync(join(d, 'review-run-state.json'), 'utf8');
    const parsed = JSON.parse(rawBytes) as ReviewRunState;
    expect(Object.keys(parsed)).toEqual(['schema', 'rev', 'writer', 'host', 'run', 'binding', 'plan', 'policy', 'continuation', 'segments', 'passes', 'corrections', 'gates', 'audits', 'checkpoints', 'finish']);
    expect(Object.keys(parsed)).toEqual([...STATE_KEYS.root]);
    expect(Object.keys(parsed.passes[0]!)).toEqual([...STATE_KEYS.pass]);
    expect(Object.keys(parsed.corrections[0]!)).toEqual([...STATE_KEYS.correction]);
    expect(Object.keys(parsed.gates[0]!)).toEqual([...STATE_KEYS.gate]);
    expect(Object.keys(parsed.audits[0]!)).toEqual([...STATE_KEYS.audit]);
    expect(Object.keys(parsed.checkpoints[0]!)).toEqual([...STATE_KEYS.checkpoint]);
    expect(serializeState(parsed)).toBe(rawBytes);
    const reverseKeys = (value: any): any => Array.isArray(value) ? value.map(reverseKeys)
      : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)])) : value;
    const reordered = reverseKeys(parsed);
    expect(validateStoredState(reordered, join(d, 'review-run-state.json')).ok).toBe(true);
    expect(serializeState(reordered)).toBe(rawBytes);
    expect(Object.keys(parsed.audits[0]!.details)).toEqual(['pct', 'threshold']);
    const unavailable = { ...parsed, finish: { ...parsed.finish!, full_review_evidence: { status: 'unavailable' as const, reason: 'record-missing' } } };
    expect(serializeState(reverseKeys(unavailable))).toBe(serializeState(unavailable));
  });

  test.each([
    ['unknown/hyphenated/camelCase keys & multiple violations', 'start', () => ({ 'run-id': uid(1), runId: uid(1), base: 'bad' }), ['run_id', 'base', 'plan', 'policy', 'continuation', 'run-id', 'runId']],
    ['out-of-enum policy.source & bad continuation', 'start', () => mkStart(1, { policy: { value: null, source: 'wrong' }, continuation: { prior_stops: 1, max: 1, continues: null } }), ['policy.source', 'continuation.continues']],
    ['missingcommit in Git', 'start', () => mkStart(1, { base: sha256('missing').slice(0, 40) }), ['base']],
    ['delegated attempt without part or with specialist:red-team', 'record pass', () => ({ pass_id: uid(10), state: 'attempt', voice_id: 'core', part: 'specialist:red-team', attempt_id: uid(20), outcome: 'completed', delegate: { provider: 'codex', model: 'm', outcome: 'credited', fallback_reason: null, replay: false, wall_ms: 1, input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, call_id: sha256('c') }, findings: [] }), ['part']],
    ['correction setting adjudication duplicate', 'record correction', () => ({ correction_id: uid(30), target: { pass_id: uid(10), voice_id: 'core', attempt_id: uid(20), finding_id: 'F-1' }, adjudication: 'duplicate' }), ['adjudication']],
    ['external-gate checkpoint without base', 'checkpoint', () => ({ checkpoint_id: uid(60), kind: 'external-gate' }), ['base']],
    ['stopped finish without delta_base/stop_count/stop_reason', 'finish', () => ({ outcome: 'stopped', base: baseSha }), ['stop_reason', 'delta_base', 'stop_count']],
  ])('refuses invalid input: %s', (_label, cmd, payload, expectedPaths) => {
    const d = newDir();
    if (cmd !== 'start') callCmd(d, 'start', mkStart(1));
    const res = callCmd(d, cmd, payload());
    expect(res.code).toBe(1);
    expect(res.json.reason).toBe('invalid-input');
    const paths = (res.json.detail.violations as { path: string }[]).map((v) => v.path);
    for (const p of expectedPaths) expect(paths).toContain(p);
  });

  test('replay, conflict, exists, lifecycle, pause/resume segments, open-pass rules, and head_moved', () => {
    const d = newDir();
    expect(callCmd(d, 'record pass', mkPassStarted(10)).json.reason).toBe('not-started');
    expect(callCmd(d, 'start', mkStart(1)).json).toMatchObject({ reason: 'recorded', rev: 1 });
    expect(callCmd(d, 'start', mkStart(2)).json).toMatchObject({ reason: 'exists', rev: 1 });
    expect(callCmd(d, 'start', mkStart(1, { gh_login: 'other' })).json).toMatchObject({ reason: 'conflict', detail: { path: 'gh_login', stored: 'kbitz', sent: 'other' } });

    expect(callCmd(d, 'record pass', mkPassStarted(10)).json).toMatchObject({ reason: 'recorded', rev: 2 });
    expect(callCmd(d, 'record pass', mkPassStarted(10)).json).toMatchObject({ reason: 'replayed', rev: 2 });
    expect(callCmd(d, 'record pass', mkPassStarted(10, { cycle: 2 })).json).toMatchObject({ reason: 'conflict', detail: { path: 'cycle', stored: '1', sent: '2' } });

    // Pause and resume lifecycle
    const pausePayload = { checkpoint_id: uid(70), kind: 'pause', base: baseSha };
    expect(callCmd(d, 'checkpoint', pausePayload).json).toMatchObject({ reason: 'recorded', rev: 3 });
    expect(callCmd(d, 'record pass', mkPassStarted(11)).json.reason).toBe('paused');
    // Replayed record accepted while paused
    expect(callCmd(d, 'record pass', mkPassStarted(10)).json).toMatchObject({ reason: 'replayed', rev: 3 });
    expect(callCmd(d, 'checkpoint', pausePayload).json).toMatchObject({ reason: 'replayed', rev: 3 });

    const wt2 = join(baseTmp, 'wt-recreated');
    git(repo, ['worktree', 'add', '--detach', wt2, headSha]);
    git(wt2, ['checkout', '-B', 'resume-branch']);
    // Branch mismatch refused; same branch in recreated worktree accepted at resume
    expect(callCmd(d, 'checkpoint', { checkpoint_id: uid(71), kind: 'resume' }, { cwd: wt2 }).json.reason).toBe('worktree-mismatch');
    git(repo, ['checkout', '--detach', headSha]);
    git(wt2, ['checkout', '-f', '-B', 'main', headSha]);
    const resumeSession = `extend-${uid(999)}`;
    expect(callCmd(d, 'checkpoint', { checkpoint_id: uid(71), kind: 'resume', session_id: resumeSession }, { cwd: wt2 }).json).toMatchObject({ reason: 'recorded', rev: 4 });
    git(wt2, ['checkout', '--detach', headSha]);
    git(repo, ['checkout', 'main']);

    // Open pass blocks prepared finish, allows needs-context finish
    expect(callCmd(d, 'finish', { outcome: 'prepared', base: baseSha }).json.reason).toBe('invalid-input');
    expect(callCmd(d, 'record pass', { pass_id: uid(99), state: 'attempt', voice_id: 'core', attempt_id: uid(25), outcome: 'failed' }).json.reason).toBe('invalid-input');
    expect(callCmd(d, 'record pass', { pass_id: uid(10), state: 'attempt', voice_id: 'core', attempt_id: uid(25), outcome: 'partial' }).json.reason).toBe('recorded');

    const dOpen = newDir();
    callCmd(dOpen, 'start', mkStart(1));
    callCmd(dOpen, 'record pass', mkPassStarted(10));
    callCmd(dOpen, 'record pass', { pass_id: uid(10), state: 'attempt', voice_id: 'core', attempt_id: uid(25), outcome: 'failed' });
    expect(callCmd(dOpen, 'finish', { outcome: 'needs-context', base: baseSha, stop_reason: 'missing env' }).json.reason).toBe('recorded');
    expect(JSON.parse(readFileSync(join(dOpen, 'review-run-state.json'), 'utf8')).passes[0].voices[0].attempts).toHaveLength(1);

    // Complete pass 10 in d, then test closed-pass attempt refusal and finish + head_moved
    expect(callCmd(d, 'record pass', { pass_id: uid(10), state: 'completed', completed_at: '2026-11-10T18:05:00Z' }).json.reason).toBe('recorded');
    expect(callCmd(d, 'record pass', { pass_id: uid(10), state: 'attempt', voice_id: 'core', attempt_id: uid(26), outcome: 'failed' }).json.reason).toBe('invalid-input');
    expect(callCmd(d, 'record pass', { pass_id: uid(10), state: 'voice-complete', voice_id: 'core', not_applicable: 'not-applicable' }).json.reason).toBe('invalid-input');

    const stopFin = { outcome: 'stopped', base: baseSha, stop_reason: 'cycle cap', delta_base: baseSha, stop_count: 1, full_review_evidence: { status: 'unavailable', reason: 'not run' } };
    expect(callCmd(d, 'finish', stopFin).json.reason).toBe('recorded');
    expect(callCmd(d, 'start', mkStart(1)).json.reason).toBe('replayed');
    expect(callCmd(d, 'record pass', mkPassStarted(10)).json.reason).toBe('replayed');
    expect(callCmd(d, 'record pass', mkPassStarted(12)).json.reason).toBe('finished');
    expect(callCmd(d, 'finish', { outcome: 'blocked', base: baseSha, stop_reason: 'other' }).json.reason).toBe('finished');

    git(repo, ['checkout', '--detach', headSha]);
    git(wt2, ['checkout', '-B', 'main', headSha]);
    git(wt2, ['commit', '--allow-empty', '-m', 'ahead', '--quiet']);
    expect(callCmd(d, 'finish', stopFin, { cwd: wt2 }).json).toMatchObject({ reason: 'replayed', detail: { head_moved: true } });
    git(wt2, ['checkout', '--detach', headSha]);
    git(repo, ['checkout', '-f', '-B', 'main', headSha]);
    const st = JSON.parse(readFileSync(join(d, 'review-run-state.json'), 'utf8')) as ReviewRunState;
    expect(st.segments).toHaveLength(2);
    expect(st.segments[1]?.session_id).toBe(resumeSession);
  });

  test('bad-dir conditions, not-in-worktree, GIT_DIR isolation, --input and usage checks, and evidence checks', () => {
    const d = newDir();
    const f = writeJson(d, 'start.json', mkStart(1));
    const notFile = join(baseTmp, 'regular-file');
    writeFileSync(notFile, 'x');
    const symDir = join(baseTmp, 'sym-dir');
    symlinkSync(d, symDir);
    const inWt = join(repo, 'inside-wt');
    mkdirSync(inWt, { recursive: true });

    expect(runCli(['start', '--dir', 'rel/dir', '--input', f]).json).toMatchObject({ reason: 'bad-dir', detail: { condition: 'relative' } });
    expect(runCli(['start', '--dir', join(baseTmp, 'no-such-dir'), '--input', f]).json).toMatchObject({ reason: 'bad-dir', detail: { condition: 'missing' } });
    expect(runCli(['start', '--dir', notFile, '--input', f]).json).toMatchObject({ reason: 'bad-dir', detail: { condition: 'not-directory' } });
    expect(runCli(['start', '--dir', symDir, '--input', f]).json).toMatchObject({ reason: 'bad-dir', detail: { condition: 'symlink' } });
    expect(runCli(['start', '--dir', inWt, '--input', f]).json).toMatchObject({ reason: 'bad-dir', detail: { condition: 'in-worktree' } });
    expect(runCli(['start', '--dir', d, '--input', f], { cwd: baseTmp }).json.reason).toBe('not-in-worktree');

    // GIT_DIR / GIT_WORK_TREE pointing elsewhere is ignored
    const otherRepo = makeEmptyRepo(baseTmp);
    expect(runCli(['start', '--dir', d, '--input', f], { env: { GIT_DIR: join(otherRepo, '.git'), GIT_WORK_TREE: otherRepo, GSTACK_EXTEND_REVIEW_STATE_LOCK_WAIT_MS: '0' } }).json.reason).toBe('recorded');
    expect(runCli(['start', '--dir', d, '--input', f], { env: { GSTACK_EXTEND_REVIEW_STATE_LOCK_WAIT_MS: '60000' } }).json.reason).toBe('replayed');
    expect(runCli(['start', '--dir', d, '--input', f], { env: { GSTACK_EXTEND_REVIEW_STATE_LOCK_WAIT_MS: '60001' } })).toMatchObject({ code: 2, json: { reason: 'usage' } });

    // --input refusals (relative, outside --dir, symlink, > 1 MiB) and CLI usage
    const otherDir = newDir();
    const outFile = writeJson(otherDir, 'out.json', mkStart(1));
    const symIn = join(d, 'sym-in.json');
    symlinkSync(f, symIn);
    const bigIn = join(d, 'big.json');
    writeFileSync(bigIn, 'x'.repeat(1048577));
    for (const badIn of ['rel.json', outFile, symIn, bigIn]) {
      expect(runCli(['start', '--dir', d, '--input', badIn])).toMatchObject({ code: 2, json: { reason: 'usage' } });
    }
    expect(runCli(['bogus'])).toMatchObject({ code: 2, json: { reason: 'usage' } });

    // Evidence digest mismatch and symlink outside --dir refused
    symlinkSync(notFile, join(d, 'escape.txt'));
    writeFileSync(join(d, 'good.txt'), 'ok');
    expect(callCmd(d, 'record gate', { gate_id: uid(80), name: 'g', result: 'passed', candidate: { commit: headSha }, evidence: [{ path: 'good.txt', sha256: sha256('wrong') }] }).json.reason).toBe('invalid-input');
    expect(callCmd(d, 'record gate', { gate_id: uid(81), name: 'g', result: 'passed', candidate: { commit: headSha }, evidence: [{ path: 'escape.txt', sha256: sha256('x') }] }).json.reason).toBe('invalid-input');

    // Stored state whose evidence file was later deleted is still read, not corrupt
    expect(callCmd(d, 'record gate', { gate_id: uid(82), name: 'g', result: 'passed', candidate: { commit: headSha }, evidence: [{ path: 'good.txt', sha256: sha256('ok') }] }).json.reason).toBe('recorded');
    unlinkSync(join(d, 'good.txt'));
    expect(callCmd(d, 'checkpoint', { checkpoint_id: uid(83), kind: 'stop' }).json.reason).toBe('recorded');

    // Corrupt state refused with bytes unchanged
    writeFileSync(join(d, 'review-run-state.json'), '{"corrupt":true}\n');
    const resCorrupt = callCmd(d, 'checkpoint', { checkpoint_id: uid(84), kind: 'stop' });
    expect(resCorrupt).toMatchObject({ code: 1, json: { status: 'unreadable', reason: 'corrupt' } });
    expect(readFileSync(join(d, 'review-run-state.json'), 'utf8')).toBe('{"corrupt":true}\n');
  });

  test.skipIf(typeof process.getuid === 'function' && process.getuid() === 0)('unwritable directory returns exit 3 with errno (skipped when running as root)', () => {
    const d = newDir();
    const f = writeJson(d, 'start.json', mkStart(1));
    chmodSync(d, 0o500);
    try {
      const res = runCli(['start', '--dir', d, '--input', f]);
      expect(res.code).toBe(3);
      expect(res.json.reason).toBe('unwritable');
      expect(res.json.detail.errno).toBe('EACCES');
    } finally {
      chmodSync(d, 0o700);
    }
  });

  test('busy holder reporting and interrupted-start recovery across lock-only, lock+tmp, and lock+state', () => {
    for (const mode of ['lock-only', 'lock-tmp', 'lock-state'] as const) {
      const d = newDir();
      const startFile = writeJson(d, 'start.json', mkStart(1));
      if (mode === 'lock-state') expect(runCli(['start', '--dir', d, '--input', startFile]).code).toBe(0);
      const plantedTmp = join(d, 'review-run-state.json.tmp-999-abcd');
      if (mode !== 'lock-only') writeFileSync(plantedTmp, '{"partial":');
      const lockPath = join(d, 'review-run-state.json.lock');
      writeFileSync(lockPath, mode === 'lock-only' ? '' : JSON.stringify({ pid: 424242, host: 'test-host', started_at: '2026-11-10T18:00:00Z' }));

      const busyRes = runCli(['start', '--dir', d, '--input', startFile], { env: { GSTACK_EXTEND_REVIEW_STATE_LOCK_WAIT_MS: '0' } });
      expect(busyRes.code).toBe(4);
      expect(busyRes.json.reason).toBe('busy');
      expect(busyRes.json.detail.holder).toMatchObject(mode === 'lock-only' ? { unknown: true } : { pid: 424242, host: 'test-host', unknown: false });
      expect(busyRes.json.fix).toContain('review-run-state.json.lock');

      unlinkSync(lockPath);
      const recStart = runCli(['start', '--dir', d, '--input', startFile]);
      expect(recStart.code).toBe(0);
      expect(recStart.json.reason).toBe(mode === 'lock-state' ? 'replayed' : 'recorded');
      if (mode === 'lock-tmp') {
        expect(existsSync(plantedTmp)).toBe(false);
        expect(recStart.json.detail.warnings).toEqual(['removed 1 leftover temporary file(s)']);
      } else {
        expect(recStart.json.detail.warnings).toBeUndefined();
      }
      if (mode === 'lock-state') expect(existsSync(plantedTmp)).toBe(true);
      const recPass = callCmd(d, 'record pass', mkPassStarted(10));
      expect(recPass.json).toMatchObject({ reason: 'recorded', rev: 2 });
      if (mode === 'lock-state') {
        expect(existsSync(plantedTmp)).toBe(false);
        expect(recPass.json.detail.warnings).toEqual(['removed 1 leftover temporary file(s)']);
      } else {
        expect(recPass.json.detail.warnings).toBeUndefined();
      }
    }
  });

  test('concurrent writers serialize under lock without losing records or corrupting state', async () => {
    const d = newDir();
    callCmd(d, 'start', mkStart(1));
    const p1 = writeJson(d, 'p1.json', mkPassStarted(10));
    const p2 = writeJson(d, 'p2.json', mkPassStarted(11, { cycle: 2 }));
    const p1Conflict = writeJson(d, 'p1-conflict.json', mkPassStarted(10, { cycle: 9 }));

    const spawnHelper = async (inputFile: string) => {
      const io = openChildStdio();
      try {
        const child = spawn(BIN_PATH, ['record', 'pass', '--dir', d, '--input', inputFile], {
          cwd: repo,
          env: { ...process.env, GSTACK_EXTEND_REVIEW_STATE_LOCK_WAIT_MS: '10000' },
          stdio: ['ignore', io.stdoutFd, io.stderrFd],
        });
        const code = await new Promise<number | null>((resolvePromise, reject) => {
          child.once('error', reject);
          child.once('close', resolvePromise);
        });
        const { stdout, stderr } = io.read();
        expect(stdout, stderr).not.toBe('');
        return { code: code ?? 1, json: JSON.parse(stdout) as Record<string, unknown> };
      } finally {
        io.dispose();
      }
    };

    // 1. Two concurrent writers recording different passes both land and advance rev by 2
    const [r1, r2] = await Promise.all([spawnHelper(p1), spawnHelper(p2)]);
    expect([r1.code, r2.code]).toEqual([0, 0]);
    expect([r1.json.reason, r2.json.reason]).toEqual(['recorded', 'recorded']);
    expect(JSON.parse(readFileSync(join(d, 'review-run-state.json'), 'utf8')).rev).toBe(3);

    // 2. Concurrent writers with same pass_id and different input yield one recorded and one conflict
    const p3a = writeJson(d, 'p3a.json', mkPassStarted(12, { cycle: 1 }));
    const p3b = writeJson(d, 'p3b.json', mkPassStarted(12, { cycle: 2 }));
    const [c1, c2] = await Promise.all([spawnHelper(p3a), spawnHelper(p3b)]);
    expect([c1.json.reason, c2.json.reason].sort()).toEqual(['conflict', 'recorded']);
    expect(await spawnHelper(p1Conflict)).toMatchObject({ code: 1, json: { reason: 'conflict' } });

    // 3. A lock held by the test and released mid-wait lets the waiting writer complete
    const lockPath = join(d, 'review-run-state.json.lock');
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, host: 'local', started_at: '2026-11-10T18:00:00Z' }));
    const p4 = writeJson(d, 'p4.json', mkPassStarted(13));
    const waiter = spawnHelper(p4);
    setTimeout(() => { if (existsSync(lockPath)) unlinkSync(lockPath); }, 120);
    const wRes = await waiter;
    expect(wRes).toMatchObject({ code: 0, json: { reason: 'recorded', rev: 5 } });
  });

  test('--version ignores inherited version overrides', () => {
    const versionFile = join(newDir(), 'VERSION');
    writeFileSync(versionFile, '9.9.9\n');
    const expected = readFileSync(join(REPO_ROOT, 'VERSION'), 'utf8').trim();
    expect(runCli(['--version'], { env: { GSTACK_EXTEND_REVIEW_STATE_VERSION_PATH: versionFile } })).toMatchObject({
      code: 0,
      out: `review-state ${expected}\n`,
      err: '',
    });
  });

  test('--version flag and helper_version envelope field read VERSION and fall back on missing, symlink, or malformed files', () => {
    const repoVersion = readFileSync(join(REPO_ROOT, 'VERSION'), 'utf8').trim();
    expect(readHelperVersion()).toBe(repoVersion);

    const verRes = runCli(['--version'], { cwd: baseTmp });
    expect(verRes.code).toBe(0);
    expect(verRes.out).toBe(`review-state ${repoVersion}\n`);
    expect(verRes.err).toBe('');

    // Missing VERSION file falls back to unknown / null
    const missingPath = join(baseTmp, 'no-such-version');
    expect(runCli(['--version'], { versionPath: missingPath })).toMatchObject({
      code: 0,
      out: 'review-state unknown\n',
    });

    // Symlink VERSION file is refused and falls back to unknown / null
    const realVerFile = join(baseTmp, 'ver-real');
    writeFileSync(realVerFile, '1.2.3.4\n');
    const symVerFile = join(baseTmp, 'ver-sym');
    symlinkSync(realVerFile, symVerFile);
    expect(readHelperVersion(realVerFile)).toBe('1.2.3.4');
    expect(readHelperVersion(symVerFile)).toBeNull();

    // Malformed VERSION file falls back to null
    const badVerFile = join(baseTmp, 'ver-bad');
    writeFileSync(badVerFile, 'v0.86.1-beta\n');
    expect(readHelperVersion(badVerFile)).toBeNull();

    // Envelopes carry helper_version (both string and null fallback) and stamp writer on writes
    const d = newDir();
    const startRes = callCmd(d, 'start', mkStart(1), { versionPath: realVerFile });
    expect(startRes.json.helper_version).toBe('1.2.3.4');
    const state1 = JSON.parse(readFileSync(join(d, 'review-run-state.json'), 'utf8')) as ReviewRunState;
    expect(state1.writer).toBe('1.2.3.4');

    const passRes = callCmd(d, 'record pass', mkPassStarted(10), { versionPath: badVerFile });
    expect(passRes.json.helper_version).toBeNull();
    const state2 = JSON.parse(readFileSync(join(d, 'review-run-state.json'), 'utf8')) as ReviewRunState;
    expect(state2.writer).toBeNull();
  });

  test('cross-version compatibility: newer-schema for v2+ and for v1 with newer writer + unknown key, corrupt for equal/older/null writer', () => {
    const curVerFile = join(baseTmp, 'ver-0861');
    writeFileSync(curVerFile, '0.86.1\n');
    const options = { versionPath: curVerFile };

    const d = newDir();
    callCmd(d, 'start', mkStart(1), options);
    const statePath = join(d, 'review-run-state.json');
    const baseline = JSON.parse(readFileSync(statePath, 'utf8'));

    // 1. Schema v2 returns newer-schema (exit 1, status unreadable) without modifying file
    const v2Bytes = JSON.stringify({ ...baseline, schema: 'review-run-state/v2' });
    writeFileSync(statePath, v2Bytes);
    const v2Res = callCmd(d, 'checkpoint', { checkpoint_id: uid(60), kind: 'stop' }, options);
    expect(v2Res.code).toBe(1);
    expect(v2Res.json).toMatchObject({
      status: 'unreadable',
      reason: 'newer-schema',
      side_effects: 'none',
      retry: 'never',
      retry_after_ms: null,
      detail: { schema: 'review-run-state/v2' },
    });
    expect(readFileSync(statePath, 'utf8')).toBe(v2Bytes);

    // 2. Schema v1 with a newer 3- or 4-part writer AND an unknown key returns newer-schema
    for (const newerWriter of ['0.86.1.1', '0.86.2', '0.87.0', '1.0.0']) {
      const newerUnknown = JSON.stringify({ ...baseline, writer: newerWriter, future_v1_field: true });
      writeFileSync(statePath, newerUnknown);
      const res = callCmd(d, 'checkpoint', { checkpoint_id: uid(60), kind: 'stop' }, options);
      expect(res.code).toBe(1);
      expect(res.json).toMatchObject({
        status: 'unreadable',
        reason: 'newer-schema',
        detail: { schema: 'review-run-state/v1', writer: newerWriter },
      });
      expect(readFileSync(statePath, 'utf8')).toBe(newerUnknown);
    }

    // 3. Same unknown key with equal (including padded 0.86.1.0), older, or null writer returns corrupt
    for (const sameOrOlderWriter of ['0.86.1', '0.86.1.0', '0.86.0', '0.85.9.9', null]) {
      const corruptBytes = JSON.stringify({ ...baseline, writer: sameOrOlderWriter, future_v1_field: true });
      writeFileSync(statePath, corruptBytes);
      const res = callCmd(d, 'checkpoint', { checkpoint_id: uid(60), kind: 'stop' }, options);
      expect(res.code).toBe(1);
      expect(res.json.reason).toBe('corrupt');
      expect(readFileSync(statePath, 'utf8')).toBe(corruptBytes);
    }

    // 4. Schema v1 with a newer writer but valid v1 structure reads and writes cleanly, updating writer to current helper_version
    writeFileSync(statePath, JSON.stringify({ ...baseline, writer: '9.9.9' }));
    const okRes = callCmd(d, 'checkpoint', { checkpoint_id: uid(60), kind: 'stop' }, options);
    expect(okRes.code).toBe(0);
    expect(okRes.json.reason).toBe('recorded');
    expect(JSON.parse(readFileSync(statePath, 'utf8')).writer).toBe('0.86.1');

    // 5. Unavailable helper version (missing versionPath) with unknown key and writer 9.9.9 returns corrupt, not newer-schema, and start does not move it
    const missingVerOpts = { versionPath: join(baseTmp, 'no-such-version-file') };
    const unknownWith999 = JSON.stringify({ ...baseline, writer: '9.9.9', future_v1_field: true });
    writeFileSync(statePath, unknownWith999);
    const noVerCp = callCmd(d, 'checkpoint', { checkpoint_id: uid(62), kind: 'stop' }, missingVerOpts);
    expect(noVerCp.code).toBe(1);
    expect(noVerCp.json.reason).toBe('corrupt');
    expect(readFileSync(statePath, 'utf8')).toBe(unknownWith999);
    const noVerStart = callCmd(d, 'start', mkStart(2), missingVerOpts);
    expect(noVerStart.code).toBe(1);
    expect(noVerStart.json.reason).toBe('corrupt');
    expect(readFileSync(statePath, 'utf8')).toBe(unknownWith999);
    expect(readdirSync(d).filter((n) => n.startsWith('review-run-state.json.corrupt-'))).toEqual([]);

    // 6. Helper 0.86.1 and unsafe-integer writer 9007199254740993.0.0 + unknown key returns corrupt, not newer-schema, and start does not move it; valid structure still records
    const unsafeWriter = '9007199254740993.0.0';
    const unsafeUnknown = JSON.stringify({ ...baseline, writer: unsafeWriter, future_v1_field: true });
    writeFileSync(statePath, unsafeUnknown);
    const unsafeCp = callCmd(d, 'checkpoint', { checkpoint_id: uid(63), kind: 'stop' }, options);
    expect(unsafeCp.code).toBe(1);
    expect(unsafeCp.json.reason).toBe('corrupt');
    expect(readFileSync(statePath, 'utf8')).toBe(unsafeUnknown);
    const unsafeStart = callCmd(d, 'start', mkStart(3), options);
    expect(unsafeStart.code).toBe(1);
    expect(unsafeStart.json.reason).toBe('corrupt');
    expect(readFileSync(statePath, 'utf8')).toBe(unsafeUnknown);
    expect(readdirSync(d).filter((n) => n.startsWith('review-run-state.json.corrupt-'))).toEqual([]);

    writeFileSync(statePath, JSON.stringify({ ...baseline, writer: unsafeWriter }));
    const unsafeValidRes = callCmd(d, 'checkpoint', { checkpoint_id: uid(64), kind: 'stop' }, options);
    expect(unsafeValidRes.code).toBe(0);
    expect(unsafeValidRes.json.reason).toBe('recorded');
    expect(JSON.parse(readFileSync(statePath, 'utf8')).writer).toBe('0.86.1');
  });

  test('stored v0.86.0 state without writer or segment reads cleanly and gains both on the next write', () => {
    expect(Object.keys(ADDITIVE_V1_DEFAULTS)).toEqual(['root', 'passes', 'corrections', 'gates', 'audits', 'checkpoints']);
    const d = newDir();
    writeFileSync(join(d, 'ev.txt'), 'proof');
    const ev = [{ path: 'ev.txt', sha256: sha256('proof') }];
    callCmd(d, 'start', mkStart(1));
    callCmd(d, 'record pass', mkPassStarted(10));
    callCmd(d, 'record pass', {
      pass_id: uid(10),
      state: 'attempt',
      voice_id: 'core',
      attempt_id: uid(20),
      outcome: 'completed',
      findings: [{ finding_id: 'F-1', severity_source: 'P1', severity_rubric: 'core', adjudication: 'accepted', resolution: 'open', found_by: ['core'] }],
    });
    callCmd(d, 'record correction', {
      correction_id: uid(30),
      target: { pass_id: uid(10), voice_id: 'core', attempt_id: uid(20), finding_id: 'F-1' },
      resolution: 'fixed',
    });
    callCmd(d, 'record gate', { gate_id: uid(40), name: 'tests', result: 'passed', candidate: { commit: headSha } });
    callCmd(d, 'record audit', { audit_id: uid(50), name: 'coverage', result: 'passed', details: { pct: 95, threshold: 80 }, candidate: { commit: headSha } });
    callCmd(d, 'checkpoint', { checkpoint_id: uid(60), kind: 'before-fix', evidence: ev });

    const statePath = join(d, 'review-run-state.json');
    const v086State = JSON.parse(readFileSync(statePath, 'utf8'));
    delete v086State.writer;
    delete v086State.host;
    for (const coll of ['passes', 'corrections', 'gates', 'audits', 'checkpoints'] as const) {
      for (const rec of v086State[coll]) delete rec.segment;
    }
    writeFileSync(statePath, `${JSON.stringify(v086State, null, 2)}\n`);
    const v086Validated = validateStoredState(JSON.parse(readFileSync(statePath, 'utf8')), statePath);
    expect(v086Validated.ok).toBe(true);
    if (v086Validated.ok) expect(v086Validated.state.host).toBeNull();

    // Replay against v0.86.0 state works cleanly without conflict
    expect(callCmd(d, 'start', mkStart(1)).json.reason).toBe('replayed');
    expect(callCmd(d, 'record pass', mkPassStarted(10)).json.reason).toBe('replayed');
    expect(callCmd(d, 'record gate', { gate_id: uid(40), name: 'tests', result: 'passed', candidate: { commit: headSha } }).json.reason).toBe('replayed');

    // Next write stamps root writer, keeps null host and null segment on pre-existing records, and stamps segment=1 on new record
    const nextCp = callCmd(d, 'checkpoint', { checkpoint_id: uid(61), kind: 'stop' });
    expect(nextCp.json.reason).toBe('recorded');
    const upgraded = JSON.parse(readFileSync(statePath, 'utf8')) as ReviewRunState;
    expect(upgraded.writer).toBe(readHelperVersion());
    expect(upgraded.host).toBeNull();
    expect(upgraded.passes[0]?.segment).toBeNull();
    expect(upgraded.corrections[0]?.segment).toBeNull();
    expect(upgraded.gates[0]?.segment).toBeNull();
    expect(upgraded.audits[0]?.segment).toBeNull();
    expect(upgraded.checkpoints[0]?.segment).toBeNull();
    expect(upgraded.checkpoints[1]?.segment).toBe(1);
  });

  test('side_effects, retry, and retry_after_ms match REASON_TABLE across all reasons', () => {
    for (const entry of REASON_TABLE) {
      expect(entry.side_effects, entry.reason).toBe(entry.reason === 'recorded' ? 'committed' : 'none');
      const retry = ['recorded', 'replayed'].includes(entry.reason) ? 'no'
        : ['busy', 'unwritable', 'internal-error'].includes(entry.reason) ? 'same-input'
        : ['worktree-mismatch', 'cross-host', 'finished', 'exists', 'corrupt', 'newer-schema'].includes(entry.reason) ? 'never'
        : 'after-fix';
      expect(entry.retry, entry.reason).toBe(retry);
    }

    // Verify busy CLI envelope carries lockWaitMs in retry_after_ms while recorded/replayed carry null
    const d = newDir();
    const rec = callCmd(d, 'start', mkStart(1));
    expect(rec.json).toMatchObject({ reason: 'recorded', side_effects: 'committed', retry: 'no', retry_after_ms: null });
    const rep = callCmd(d, 'start', mkStart(1));
    expect(rep.json).toMatchObject({ reason: 'replayed', side_effects: 'none', retry: 'no', retry_after_ms: null });

    const lockPath = join(d, 'review-run-state.json.lock');
    writeFileSync(lockPath, JSON.stringify({ pid: 99999, host: 'test', started_at: '2026-11-10T18:00:00Z' }));
    const busy = callCmd(d, 'start', mkStart(1), { env: { GSTACK_EXTEND_REVIEW_STATE_LOCK_WAIT_MS: '15' } });
    expect(busy.code).toBe(4);
    expect(busy.json).toMatchObject({ reason: 'busy', side_effects: 'none', retry: 'same-input', retry_after_ms: 15 });
    unlinkSync(lockPath);
  });

  test('segment stamping across pause and resume, replay invariance, and out-of-range segment validation', () => {
    const d = newDir();
    callCmd(d, 'start', mkStart(1));
    callCmd(d, 'record pass', mkPassStarted(10));
    callCmd(d, 'record pass', {
      pass_id: uid(10),
      state: 'attempt',
      voice_id: 'core',
      attempt_id: uid(20),
      outcome: 'completed',
      findings: [
        { finding_id: 'F-1', severity_source: 'P1', severity_rubric: 'core', adjudication: 'accepted', resolution: 'open', found_by: ['core'] },
        { finding_id: 'F-2', severity_source: 'P2', severity_rubric: 'core', adjudication: 'accepted', resolution: 'open', found_by: ['core'] },
      ],
    });
    callCmd(d, 'record correction', {
      correction_id: uid(30),
      target: { pass_id: uid(10), voice_id: 'core', attempt_id: uid(20), finding_id: 'F-1' },
      resolution: 'fixed',
    });
    callCmd(d, 'record gate', { gate_id: uid(40), name: 'tests', result: 'passed', candidate: { commit: headSha } });
    callCmd(d, 'record audit', { audit_id: uid(50), name: 'coverage', result: 'passed', details: { pct: 90, threshold: 80 }, candidate: { commit: headSha } });
    callCmd(d, 'checkpoint', { checkpoint_id: uid(60), kind: 'pause', base: baseSha });

    // Resume opens segment 2; the resume checkpoint itself carries segment 2
    callCmd(d, 'checkpoint', { checkpoint_id: uid(61), kind: 'resume', session_id: `extend-${uid(950)}` });
    callCmd(d, 'record pass', mkPassStarted(11, { cycle: 2 }));
    callCmd(d, 'record correction', {
      correction_id: uid(31),
      target: { pass_id: uid(10), voice_id: 'core', attempt_id: uid(20), finding_id: 'F-2' },
      resolution: 'fixed',
    });
    callCmd(d, 'record gate', { gate_id: uid(41), name: 'tests', result: 'passed', candidate: { commit: headSha } });
    callCmd(d, 'record audit', { audit_id: uid(51), name: 'coverage', result: 'passed', details: { pct: 95, threshold: 80 }, candidate: { commit: headSha } });

    const statePath = join(d, 'review-run-state.json');
    const st = JSON.parse(readFileSync(statePath, 'utf8')) as ReviewRunState;
    expect(st.segments.map((s) => s.segment)).toEqual([1, 2]);
    expect(st.passes.map((p) => p.segment)).toEqual([1, 2]);
    expect(st.corrections.map((c) => c.segment)).toEqual([1, 2]);
    expect(st.gates.map((g) => g.segment)).toEqual([1, 2]);
    expect(st.audits.map((a) => a.segment)).toEqual([1, 2]);
    expect(st.checkpoints.map((c) => c.segment)).toEqual([1, 2]);

    // Replay of segment-1 records while in segment 2 is unaffected by segment or writer
    expect(callCmd(d, 'record pass', mkPassStarted(10)).json.reason).toBe('replayed');
    expect(callCmd(d, 'record correction', {
      correction_id: uid(30),
      target: { pass_id: uid(10), voice_id: 'core', attempt_id: uid(20), finding_id: 'F-1' },
      resolution: 'fixed',
    }).json.reason).toBe('replayed');
    expect(callCmd(d, 'record gate', { gate_id: uid(40), name: 'tests', result: 'passed', candidate: { commit: headSha } }).json.reason).toBe('replayed');
    expect(callCmd(d, 'record audit', { audit_id: uid(50), name: 'coverage', result: 'passed', details: { pct: 90, threshold: 80 }, candidate: { commit: headSha } }).json.reason).toBe('replayed');
    expect(callCmd(d, 'checkpoint', { checkpoint_id: uid(60), kind: 'pause', base: baseSha }).json.reason).toBe('replayed');
    expect(callCmd(d, 'checkpoint', { checkpoint_id: uid(61), kind: 'resume', session_id: `extend-${uid(950)}` }).json.reason).toBe('replayed');

    // Out-of-range segment values (0, 3 when segments.length is 2, or string) are rejected as corrupt
    for (const badSeg of [0, 3, -1, '1']) {
      const badState = structuredClone(st) as any;
      badState.passes[0].segment = badSeg;
      writeFileSync(statePath, JSON.stringify(badState));
      expect(callCmd(d, 'checkpoint', { checkpoint_id: uid(62), kind: 'stop' }).json.reason).toBe('corrupt');
    }
  });

  test('export --dir DIR: uuidv5 RFC 4122 parity, 2-segment projection, cross-segment corrections, skipped segment:null records, stage_runs, refusals, and read-only --dir', () => {
    // 1. RFC 4122 §4.3 UUIDv5 vector and Python uuid.uuid5 parity
    expect(uuidv5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'python.org')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d');
    const pyUuid = spawnSync(
      'python3',
      ['-c', `import uuid; print(uuid.uuid5(uuid.UUID("${NAMESPACE}"), "run-1:segment:1"))`],
      { encoding: 'utf8' },
    );
    expect(pyUuid.status).toBe(0);
    expect(uuidv5(NAMESPACE, 'run-1:segment:1')).toBe(pyUuid.stdout.trim());

    // 2. Build a 2-segment run:
    //    - Segment 1: session_id: null (sandboxed), pass 10 with core + delegated specialist-sec, finding F-1 (receipt_class stripped) and F-2,
    //      correction 30 on F-1, pause checkpoint closing segment 1.
    //    - Segment 2: recorded session_id via resume checkpoint, pass 11 with fell-back delegated attempt + fallback retry, non-delegated failed attempt + retry,
    //      not-applicable voice, cross-segment corrections on F-1 (receipt-only 31 omitted, 32 superseding 31 -> supersedes_event_id names 30) and F-2
    //      (receipt-only 33 followed by 34 -> supersedes_event_id omitted), and finish(prepared).
    const d = newDir();
    const runId = uid(1);
    const recSid2 = `extend-${uid(902)}`;
    callCmd(d, 'start', mkStart(1, { session_id: null }));
    callCmd(d, 'record pass', mkPassStarted(10, { required_voices: ['core', 'specialist-sec'] }));
    callCmd(d, 'record pass', {
      pass_id: uid(10),
      state: 'attempt',
      voice_id: 'core',
      attempt_id: uid(20),
      outcome: 'completed',
      findings: [
        { finding_id: 'F-1', severity_source: 'P1', severity_rubric: 'core', adjudication: 'accepted', resolution: 'open', found_by: ['core'], receipt_class: 'non-blocking' },
        { finding_id: 'F-2', severity_source: 'P2', severity_rubric: 'core', adjudication: 'accepted', resolution: 'open', found_by: ['core'] },
      ],
    });
    callCmd(d, 'record pass', {
      pass_id: uid(10),
      state: 'attempt',
      voice_id: 'specialist-sec',
      part: 'specialist:security',
      attempt_id: uid(21),
      outcome: 'completed',
      delegate: {
        provider: 'openai',
        model: 'gpt-5',
        outcome: 'credited',
        fallback_reason: null,
        replay: false,
        wall_ms: 420,
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: null,
        call_id: sha256('call-21'),
      },
      findings: [
        { finding_id: 'F-3', severity_source: 'high', severity_rubric: 'specialist', adjudication: 'accepted', resolution: 'fixed', found_by: ['specialist:security'] },
      ],
    });
    callCmd(d, 'record pass', { pass_id: uid(10), state: 'voice-complete', voice_id: 'core', selected_attempt_id: uid(20) });
    callCmd(d, 'record pass', { pass_id: uid(10), state: 'voice-complete', voice_id: 'specialist-sec', selected_attempt_id: uid(21) });
    callCmd(d, 'record pass', { pass_id: uid(10), state: 'completed', completed_at: '2026-11-10T18:05:00Z' });
    callCmd(d, 'record correction', {
      correction_id: uid(30),
      target: { pass_id: uid(10), voice_id: 'core', attempt_id: uid(20), finding_id: 'F-1' },
      adjudication: 'accepted',
      resolution: 'open',
    });
    callCmd(d, 'checkpoint', { checkpoint_id: uid(60), kind: 'pause', base: baseSha });

    // Segment 2: resume with recorded session_id
    callCmd(d, 'checkpoint', { checkpoint_id: uid(61), kind: 'resume', base: baseSha, session_id: recSid2 });
    callCmd(d, 'record pass', mkPassStarted(11, { cycle: 2, required_voices: ['core', 'specialist-sec', 'qa'] }));
    // Voice specialist-sec: fell-back delegated attempt followed by completed native fallback attempt
    callCmd(d, 'record pass', {
      pass_id: uid(11),
      state: 'attempt',
      voice_id: 'specialist-sec',
      part: 'specialist:security',
      attempt_id: uid(22),
      outcome: 'failed',
      delegate: {
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
        call_id: sha256('call-22'),
      },
    });
    callCmd(d, 'record pass', {
      pass_id: uid(11),
      state: 'attempt',
      voice_id: 'specialist-sec',
      attempt_id: uid(23),
      predecessor_attempt_id: uid(22),
      outcome: 'completed',
      findings: [],
    });
    // Voice core: failed non-delegated attempt followed by completed retry
    callCmd(d, 'record pass', {
      pass_id: uid(11),
      state: 'attempt',
      voice_id: 'core',
      attempt_id: uid(24),
      outcome: 'failed',
    });
    callCmd(d, 'record pass', {
      pass_id: uid(11),
      state: 'attempt',
      voice_id: 'core',
      attempt_id: uid(25),
      predecessor_attempt_id: uid(24),
      outcome: 'completed',
      findings: [],
    });
    callCmd(d, 'record pass', { pass_id: uid(11), state: 'voice-complete', voice_id: 'specialist-sec', selected_attempt_id: uid(23) });
    callCmd(d, 'record pass', { pass_id: uid(11), state: 'voice-complete', voice_id: 'core', selected_attempt_id: uid(25) });
    callCmd(d, 'record pass', { pass_id: uid(11), state: 'voice-complete', voice_id: 'qa', not_applicable: 'not-applicable' });
    callCmd(d, 'record pass', { pass_id: uid(11), state: 'completed', completed_at: '2026-11-10T18:15:00Z' });

    // Cross-segment corrections recorded in segment 2 targeting segment 1's pass 10:
    // - Correction 31 on F-1 is receipt-only (omitted from metrics records)
    // - Correction 32 on F-1 supersedes 31 and sets resolution: 'fixed' -> its supersedes_event_id must name correction 30's event_id!
    // - Correction 33 on F-2 is fixed_in-only (omitted from metrics records)
    // - Correction 34 on F-2 supersedes 33 and sets resolution: 'fixed' -> its supersedes_event_id must be omitted!
    callCmd(d, 'record correction', {
      correction_id: uid(31),
      target: { pass_id: uid(10), voice_id: 'core', attempt_id: uid(20), finding_id: 'F-1' },
      receipt_class: 'test-gap-recorded',
      supersedes: uid(30),
    });
    callCmd(d, 'record correction', {
      correction_id: uid(32),
      target: { pass_id: uid(10), voice_id: 'core', attempt_id: uid(20), finding_id: 'F-1' },
      resolution: 'fixed',
      supersedes: uid(31),
    });
    callCmd(d, 'record correction', {
      correction_id: uid(33),
      target: { pass_id: uid(10), voice_id: 'core', attempt_id: uid(20), finding_id: 'F-2' },
      fixed_in: headSha,
    });
    callCmd(d, 'record correction', {
      correction_id: uid(34),
      target: { pass_id: uid(10), voice_id: 'core', attempt_id: uid(20), finding_id: 'F-2' },
      resolution: 'fixed',
      supersedes: uid(33),
    });
    callCmd(d, 'finish', { outcome: 'prepared', base: baseSha });

    const statePath = join(d, 'review-run-state.json');
    const beforeBytes = readFileSync(statePath, 'utf8');

    // Run export on a read-only --dir (when not root) to prove no lock file is created
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    if (!isRoot) chmodSync(d, 0o500);
    let expRes;
    try {
      expRes = runCli(['export', '--dir', d]);
      expect(existsSync(join(d, 'review-run-state.json.lock'))).toBe(false);
    } finally {
      if (!isRoot) chmodSync(d, 0o700);
    }
    expect(expRes.code).toBe(0);
    expect(expRes.err).toBe('');
    expect(readFileSync(statePath, 'utf8')).toBe(beforeBytes);

    expect(runCli(['export', '--dir', d]).out).toBe(expRes.out);
    const exp = expRes.json;
    expect(exp.schema).toBe(EXPORT_SCHEMA);
    expect(exp.run.run_id).toBe(runId);
    const derivedSid1 = `extend-${uuidv5(NAMESPACE, `${runId}:segment:1`)}`;
    expect(exp.segments).toEqual([
      expect.objectContaining({
        segment: 1,
        recorded_session_id: null,
        session_id: derivedSid1,
        derived: true,
        end: 'paused',
        outcome: 'blocked',
        run_step_id: uuidv5(NAMESPACE, `${runId}:segment:1:run`),
      }),
      expect.objectContaining({
        segment: 2,
        recorded_session_id: recSid2,
        session_id: recSid2,
        derived: false,
        end: 'finished',
        outcome: 'success',
        run_step_id: uuidv5(NAMESPACE, `${runId}:segment:2:run`),
      }),
    ]);

    // stage_runs contains only closed derived segments (segment 1)
    expect(exp.stage_runs).toEqual([
      {
        segment: 1,
        session_id: derivedSid1,
        started_at: exp.segments[0].started_at,
        ended_at: exp.segments[0].ended_at,
        outcome: 'blocked',
        branch: exp.run.branch,
      },
    ]);

    // Check stripped fields (receipt_class on findings, call_id on delegate)
    const att20 = exp.records.find((r: any) => r.op === 'pass' && r.request.attempt_id === uid(20));
    expect(att20.request.v).toBe(4);
    expect(att20.request.findings).toMatchObject([
      { finding_key: null, finding_class: null },
      { finding_key: null, finding_class: null },
    ]);
    expect(att20.request.findings[0]).not.toHaveProperty('receipt_class');
    const att21 = exp.records.find((r: any) => r.op === 'pass' && r.request.attempt_id === uid(21));
    expect(att21.request.v).toBe(4);
    expect(att21.request.findings).toMatchObject([{ finding_key: null, finding_class: null }]);
    expect(att21.request.delegate).not.toHaveProperty('call_id');
    expect(att21.request.delegate.provider).toBe('openai');

    // Cross-segment finding corrections are routed to segment 1's session, receipt/fixed_in-only omitted, supersedes_event_id resolved
    const findingCorrs = exp.records.filter((r: any) => r.op === 'correction' && r.request.correction_kind === 'finding');
    expect(findingCorrs.map((r: any) => r.request.event_id)).toEqual([
      uuidv5(NAMESPACE, `${runId}:correction:${uid(30)}`),
      uuidv5(NAMESPACE, `${runId}:correction:${uid(32)}`),
      uuidv5(NAMESPACE, `${runId}:correction:${uid(34)}`),
    ]);
    expect(findingCorrs.every((r: any) => r.session_id === derivedSid1)).toBe(true);
    expect(findingCorrs[1].request.supersedes_event_id).toBe(uuidv5(NAMESPACE, `${runId}:correction:${uid(30)}`));
    expect(findingCorrs[2].request).not.toHaveProperty('supersedes_event_id');

    // Retry and fallback attempt corrections in segment 2 (ordered by pass.voices: core first, specialist-sec second)
    const attemptCorrs = exp.records.filter((r: any) => r.op === 'correction' && r.request.correction_kind !== 'finding');
    expect(attemptCorrs).toEqual([
      {
        session_id: recSid2,
        op: 'correction',
        request: {
          v: 1,
          stage: 'review-and-prep',
          session_id: recSid2,
          event_id: uuidv5(NAMESPACE, `${runId}:attempt-correction:${uid(11)}:core:${uid(25)}`),
          correction_kind: 'retry',
          pass_id: uid(11),
          voice_id: 'core',
          attempt_id: uid(25),
        },
      },
      {
        session_id: recSid2,
        op: 'correction',
        request: {
          v: 1,
          stage: 'review-and-prep',
          session_id: recSid2,
          event_id: uuidv5(NAMESPACE, `${runId}:attempt-correction:${uid(11)}:specialist-sec:${uid(23)}`),
          correction_kind: 'fallback',
          pass_id: uid(11),
          voice_id: 'specialist-sec',
          attempt_id: uid(23),
        },
      },
    ]);

    // Run end is omitted on derived segment 1 and emitted on recorded segment 2
    const ends = exp.records.filter((r: any) => r.op === 'end');
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({
      session_id: recSid2,
      op: 'end',
      request: {
        step_id: uuidv5(NAMESPACE, `${runId}:segment:2:run`),
        outcome: 'completed',
      },
    });

    // 3. Branch move still exports cleanly; repo mismatch returns worktree-mismatch
    git(repo, ['checkout', '-b', 'moved-branch', '--quiet']);
    try {
      expect(runCli(['export', '--dir', d]).code).toBe(0);
    } finally {
      git(repo, ['checkout', '-', '--quiet']);
    }
    const linkedTree = join(baseTmp, 'export-linked-tree');
    git(repo, ['worktree', 'add', '--detach', linkedTree, 'HEAD']);
    expect(runCli(['export', '--dir', d], { cwd: linkedTree }).out).toBe(expRes.out);
    const otherRepo = makeEmptyRepo(baseTmp);
    expect(runCli(['export', '--dir', d], { cwd: otherRepo })).toMatchObject({
      code: 1,
      json: { command: 'export', status: 'refused', reason: 'worktree-mismatch' },
    });

    // 4. Upgraded v0.86.0 state with segment: null on pass 10 routes pass 10 and all corrections targeting pass 10 to skipped[]
    const nullSegState = JSON.parse(beforeBytes) as ReviewRunState;
    nullSegState.passes[0]!.segment = null;
    const nullSegExport = projectState(nullSegState, readHelperVersion());
    expect(nullSegExport.skipped).toEqual([
      { kind: 'pass', id: uid(10), pass_id: uid(10), reason: 'segment-unknown' },
      { kind: 'correction', id: uid(30), correction_id: uid(30), reason: 'segment-unknown' },
      { kind: 'correction', id: uid(31), correction_id: uid(31), reason: 'segment-unknown' },
      { kind: 'correction', id: uid(32), correction_id: uid(32), reason: 'segment-unknown' },
      { kind: 'correction', id: uid(33), correction_id: uid(33), reason: 'segment-unknown' },
      { kind: 'correction', id: uid(34), correction_id: uid(34), reason: 'segment-unknown' },
    ]);
    expect(nullSegExport.records.some((r) => r.request.pass_id === uid(10))).toBe(false);

    // 5. Refusal envelopes and help for export
    expect(runCli(['export', '--help']).code).toBe(0);
    expect(runCli(['export', '--help']).out).toContain('review-state export');
    expect(runCli(['--help']).out).toContain('bin/review-state export --dir DIR');
    expect(runCli(['export', '--dir', d, '--input', statePath])).toMatchObject({
      code: 2,
      json: { command: 'export', status: 'usage', reason: 'usage' },
    });
    expect(runCli(['export', '--dir', newDir()])).toMatchObject({
      code: 1,
      json: { command: 'export', status: 'refused', reason: 'not-started' },
    });
    expect(runCli(['export', '--dir', 'rel/dir'])).toMatchObject({
      code: 1,
      json: { command: 'export', status: 'refused', reason: 'bad-dir' },
    });
    expect(runCli(['export', '--dir', d], { cwd: baseTmp })).toMatchObject({
      code: 1,
      json: { command: 'export', status: 'refused', reason: 'not-in-worktree' },
    });
    writeFileSync(statePath, JSON.stringify({ ...JSON.parse(beforeBytes), schema: 'review-run-state/v2' }));
    expect(runCli(['export', '--dir', d])).toMatchObject({
      code: 1,
      json: { command: 'export', status: 'unreadable', reason: 'newer-schema' },
    });
    writeFileSync(statePath, '{corrupt\n');
    expect(runCli(['export', '--dir', d])).toMatchObject({
      code: 1,
      json: { command: 'export', status: 'unreadable', reason: 'corrupt' },
    });
  });

  test('checkpoint ready records on open run, replays, requires 40-hex ancestor base, refuses paused/finished, and round-trips byte-identically', () => {
    const d = newDir();
    expect(callCmd(d, 'start', mkStart(1)).json).toMatchObject({ reason: 'recorded', rev: 1 });
    expect(callCmd(d, 'checkpoint', { checkpoint_id: uid(60), kind: 'ready' }).json.detail.violations).toContainEqual({
      path: 'base', rule: 'invalid-value', expected: 'required-hex40-for-ready',
    });

    git(repo, ['checkout', '--orphan', 'unrelated-branch']);
    writeFileSync(join(repo, 'unrelated.txt'), 'u');
    git(repo, ['add', 'unrelated.txt']);
    git(repo, ['commit', '-m', 'unrelated', '--quiet']);
    const unrelatedSha = git(repo, ['rev-parse', 'HEAD']);
    git(repo, ['checkout', '-f', 'main']);
    expect(callCmd(d, 'checkpoint', { checkpoint_id: uid(61), kind: 'ready', base: unrelatedSha }).json.detail.violations).toContainEqual({
      path: 'base', rule: 'not-ancestor', expected: 'ancestor-of-head',
    });

    const readyPayload = { checkpoint_id: uid(62), kind: 'ready', base: baseSha, wtree: 'wt:ready' };
    expect(callCmd(d, 'checkpoint', readyPayload).json).toMatchObject({ reason: 'recorded', rev: 2 });
    expect(callCmd(d, 'checkpoint', readyPayload).json).toMatchObject({ reason: 'replayed', rev: 2 });
    const statePath = join(d, 'review-run-state.json'), rawBytes = readFileSync(statePath, 'utf8');
    const state = JSON.parse(rawBytes) as ReviewRunState;
    expect(state.segments[0]?.end).toBeNull();
    expect(state.checkpoints[0]).toMatchObject({ kind: 'ready', base: baseSha, wtree: 'wt:ready', head: headSha, tree: treeSha });

    const validated = validateStoredState(JSON.parse(rawBytes), statePath, readHelperVersion());
    expect(validated.ok && serializeState(validated.state)).toBe(rawBytes);

    callCmd(d, 'checkpoint', { checkpoint_id: uid(63), kind: 'pause', base: baseSha });
    expect(callCmd(d, 'checkpoint', { checkpoint_id: uid(64), kind: 'ready', base: baseSha }).json).toMatchObject({ status: 'refused', reason: 'paused' });
    callCmd(d, 'checkpoint', { checkpoint_id: uid(65), kind: 'resume', session_id: `extend-${uid(902)}` });
    callCmd(d, 'finish', { outcome: 'prepared', base: baseSha });
    expect(callCmd(d, 'checkpoint', { checkpoint_id: uid(66), kind: 'ready', base: baseSha }).json).toMatchObject({ status: 'refused', reason: 'finished' });
  });

  test('render command renders full-receipt, comment, body, and final across exit states without mutating or locking state', () => {
    expect(Object.keys(RENDER_SHAPES)).toEqual(['render (full-receipt)', 'render (comment)', 'render (body)', 'render (final)']);
    const helpDir = newDir();
    expect(runCli(['render', '--help']).out).toContain(RENDER_SCHEMA);
    expect(runCli(['--help']).out).toContain('bin/review-state render --dir DIR --input FILE');
    expect(existsSync(join(helpDir, 'review-run-state.json'))).toBe(false);

    const runRender = (dir: string, name: string, payload: unknown) => runCli(['render', '--dir', dir, '--input', writeJson(dir, name, payload)]);
    const dMissing = newDir();
    expect(runRender(dMissing, 'missing.json', { output: 'full-receipt' })).toMatchObject({
      code: 1, json: { command: 'render', status: 'refused', reason: 'not-started' },
    });

    const dReady = newDir();
    const files: Record<string, string> = {
      'pregate.json': '{"ok":true}\n',
      'doc-sec.md': '## Documentation\n- Current.\n',
      'sections.md': '## Completion matrix\nAll required voices completed.\n',
      'summary.md': 'Summary of changes.\nTests: pass.\n',
      'bad-summary.md': '## Bad heading\nText.\n',
    };
    for (const [fn, txt] of Object.entries(files)) writeFileSync(join(dReady, fn), txt);
    const commentUrl = 'https://github.com/kbitz/gstack-extend/pull/240#issuecomment-999';

    callCmd(dReady, 'start', mkStart(1, {
      wtree: 'e5e5e5e5e5e5e5e5',
      policy: { value: 'review-and-prep-policy/v1; run-state=record', source: 'caller prompt', delegation: { status: 'active', parts: ['specialist:testing', 'native-adversarial'], config: sha256('cfg'), tools: ['specialist:testing'] } },
    }));
    expect(runRender(dReady, 'no-ready.json', { output: 'full-receipt' }).json.detail.violations).toContainEqual({
      path: '$', rule: 'not-renderable', expected: 'renderable-exit-and-output',
    });

    callCmd(dReady, 'record pass', mkPassStarted(10, { required_voices: ['specialist-testing'] }));
    callCmd(dReady, 'record pass', {
      pass_id: uid(10), state: 'attempt', voice_id: 'specialist-testing', part: 'specialist:testing', attempt_id: uid(20), outcome: 'completed',
      delegate: { provider: 'codex', model: 'gpt-5', outcome: 'credited', fallback_reason: null, replay: false, wall_ms: 900, input_tokens: 120, output_tokens: 40, cache_read_input_tokens: 10, cache_creation_input_tokens: null, call_id: sha256('call-ready') },
      findings: [],
    });
    callCmd(dReady, 'record pass', { pass_id: uid(10), state: 'voice-complete', voice_id: 'specialist-testing', selected_attempt_id: uid(20) });
    callCmd(dReady, 'record pass', { pass_id: uid(10), state: 'completed', completed_at: '2026-11-10T18:05:00Z' });
    callCmd(dReady, 'record gate', {
      gate_id: uid(40), name: 'pregate', result: 'passed', candidate: { commit: headSha, base: baseSha, wtree: 'e5e5e5e5e5e5e5e5' },
      details: { raw_verdict: 'pass', wrapper_verdict: 'pass', policy: 'base', record_path: 'pregate.json', record_sha256: sha256(files['pregate.json']!), skipped_lanes: [] },
    });
    callCmd(dReady, 'record gate', {
      gate_id: uid(41), name: 'greptile', result: 'passed', candidate: { commit: baseSha, base: baseSha },
      details: { value: `completed on ${baseSha}; findings dispositioned in the receipt, so triage only newer feedback`, run: 'https://github.com/kbitz/gstack-extend/pull/240#pullrequestreview-1' },
    });
    callCmd(dReady, 'record audit', { audit_id: uid(50), name: 'coverage', result: 'pass', details: { pct: 100, threshold: 'pass' }, candidate: { commit: headSha, base: baseSha, wtree: 'e5e5e5e5e5e5e5e5' } });
    callCmd(dReady, 'record audit', { audit_id: uid(51), name: 'documentation', result: 'accepted', details: { report_id: 'doc-1', section_path: 'doc-sec.md', section_sha256: sha256(files['doc-sec.md']!) }, candidate: { commit: headSha, base: baseSha, wtree: 'e5e5e5e5e5e5e5e5' } });
    callCmd(dReady, 'checkpoint', { checkpoint_id: uid(60), kind: 'ready', base: baseSha, wtree: 'e5e5e5e5e5e5e5e5' });

    const statePath = join(dReady, 'review-run-state.json'), stateBeforeRender = readFileSync(statePath, 'utf8');
    expect(runCli(['render', '--dir', dReady, '--input', writeJson(dMissing, 'outside.json', { output: 'full-receipt' })])).toMatchObject({
      code: 2, json: { command: 'render', status: 'usage', reason: 'usage' },
    });

    for (const [name, payload, want] of [
      ['r-unknown.json', { output: 'full-receipt', unknown_key: 1 }, { path: 'unknown_key', rule: 'unknown-key', expected: 'no unknown keys' }],
      ['r-null-section.json', { output: 'full-receipt', sections: [null] }, { path: 'sections[0]', rule: 'invalid-type', expected: 'object' }],
      ['r-null-receipt.json', { output: 'comment', full_receipt: null }, { path: 'full_receipt', rule: 'invalid-type', expected: 'object' }],
      ['r-null-summary.json', { output: 'body', full_receipt: null, summary: null, comment_url: commentUrl }, { path: 'summary', rule: 'invalid-type', expected: 'object' }],
      ['r-bad-digest.json', { output: 'full-receipt', sections: [{ path: 'sections.md', sha256: '0'.repeat(64) }] }, { path: 'sections[0]', rule: 'evidence-digest-mismatch', expected: 'valid-file-in-dir-with-matching-sha256' }],
    ] as const) {
      expect(runRender(dReady, name, payload).json.detail.violations).toContainEqual(want);
    }

    const fullRes1 = runRender(dReady, 'r-full-1.json', { output: 'full-receipt', sections: [{ path: 'sections.md', sha256: sha256(files['sections.md']!) }] });
    const fullRes2 = runRender(dReady, 'r-full-2.json', { output: 'full-receipt', sections: [{ path: 'sections.md', sha256: sha256(files['sections.md']!) }] });
    for (const [res, idx] of [[fullRes1, 1], [fullRes2, 2]] as const) {
      expect(res.code).toBe(0);
      const p = res.json.files[0].path;
      expect(p).toBe(join(dReady, `full-receipt-${idx}.md`));
      expect(statSync(p).mode & 0o777).toBe(0o600);
      expect(sha256(readFileSync(p, 'utf8'))).toBe(res.json.files[0].sha256);
    }
    expect(readFileSync(fullRes1.json.files[0].path, 'utf8')).toContain('delegation: active (parts=testing,adversarial; config=');
    expect(readFileSync(fullRes1.json.files[0].path, 'utf8')).toContain('## Completion matrix');

    const fullRef1 = { path: 'full-receipt-1.md', sha256: fullRes1.json.files[0].sha256 };
    const commentRes = runRender(dReady, 'r-comment.json', { output: 'comment', full_receipt: fullRef1 });
    expect(commentRes.json).toMatchObject({ schema: RENDER_SCHEMA, output: 'comment', exit: 'ready', files: [{ path: join(dReady, 'comment-receipt-1.md') }] });
    const comRef1 = { path: 'comment-receipt-1.md', sha256: commentRes.json.files[0].sha256 };

    expect(runRender(dReady, 'r-bad-sum.json', {
      output: 'body', full_receipt: fullRef1, summary: { path: 'bad-summary.md', sha256: sha256(files['bad-summary.md']!) }, comment_url: commentUrl,
    }).json.detail.violations).toContainEqual({ path: 'summary', rule: 'invalid-value', expected: 'no-h2-heading' });

    const bodyRes = runRender(dReady, 'r-body.json', {
      output: 'body', comment_url: commentUrl, full_receipt: fullRef1, summary: { path: 'summary.md', sha256: sha256(files['summary.md']!) },
    });
    expect(readFileSync(bodyRes.json.files[0].path, 'utf8')).toContain(`## Review and prep\n\nprepared\n\nSummary of changes.\nTests: pass.\n\nReceipt: ${commentUrl}\nEvidence: `);
    expect(readFileSync(statePath, 'utf8')).toBe(stateBeforeRender);
    expect(existsSync(join(dReady, 'review-run-state.json.lock'))).toBe(false);
    expect(runRender(dReady, 'r-final-early.json', { output: 'final', comment_url: commentUrl, full_receipt: fullRef1, comment_file: comRef1 }).json).toMatchObject({ reason: 'invalid-input' });

    callCmd(dReady, 'finish', {
      outcome: 'prepared', base: baseSha, wtree: 'e5e5e5e5e5e5e5e5', readiness_confirmed_at: '2026-11-10T18:10:00Z',
      user_facing_changes: ['Rendered receipts and handoffs from run state.'],
    });
    expect(runRender(dReady, 'r-pr-conflict.json', {
      output: 'final', comment_url: commentUrl, full_receipt: fullRef1, comment_file: comRef1,
      pr: { number: 999, url: 'https://github.com/kbitz/gstack-extend/pull/999', repo: 'kbitz/gstack-extend', base_ref: 'origin/main', head_repo: 'kbitz/gstack-extend', head_branch: 'main' },
    }).json.detail.violations).toContainEqual({ path: 'pr', rule: 'conflicts-with-state', expected: 'matches-run-pr' });

    const finalRes = runRender(dReady, 'r-final.json', {
      output: 'final', comment_url: commentUrl, full_receipt: fullRef1, comment_file: comRef1, save_before_shipping: 'notes/finding.md',
    });
    const finalText = readFileSync(finalRes.json.files[0].path, 'utf8');
    expect(finalText).toContain(`Prepared HEAD: ${headSha}; readiness confirmed at 2026-11-10T18:10:00Z`);
    expect(finalText).toContain('Save before shipping: notes/finding.md; move them out of\nthis checkout without committing them, since they block release work until then.');
    expect(finalText).toContain('User-facing change: Rendered receipts and handoffs from run state.');
    expect(finalText).toContain(`Stage handoff: stage-handoff/v1; stage: review; next: ship-and-land; status: done; head: ${headSha}; plan-sha256: ${sha256('plan-bytes')}`);

    const tampered = `${readFileSync(commentRes.json.files[0].path, 'utf8')}extra\n`;
    writeFileSync(join(dReady, 'comment-receipt-9.md'), tampered);
    expect(runRender(dReady, 'r-final-bad.json', {
      output: 'final', comment_url: commentUrl, full_receipt: fullRef1, comment_file: { path: 'comment-receipt-9.md', sha256: sha256(tampered) },
    }).json.detail.violations).toContainEqual({ path: 'comment_file', rule: 'receipt-mismatch', expected: 'matches-finished-state' });

    // Stale ready when HEAD advances after checkpoint ready
    const dStale = newDir(), wtStale = join(baseTmp, 'wt-stale-ready');
    callCmd(dStale, 'start', mkStart(2));
    callCmd(dStale, 'checkpoint', { checkpoint_id: uid(63), kind: 'ready', base: baseSha });
    git(repo, ['worktree', 'add', '--detach', wtStale, headSha]);
    git(wtStale, ['commit', '--allow-empty', '-m', 'advance-after-ready', '--quiet']);
    expect(runCli(['render', '--dir', dStale, '--input', writeJson(dStale, 'stale.json', { output: 'full-receipt' })], { cwd: wtStale }).json.detail.violations[0]?.rule).toBe('stale-ready');
    git(repo, ['worktree', 'remove', '--force', wtStale]);

    // Paused, external-gate, stopped, blocked, needs-context exits
    const dPause = newDir();
    writeFileSync(join(dPause, 'summary.md'), 'Paused for manual checks.\n');
    callCmd(dPause, 'start', mkStart(3));
    callCmd(dPause, 'record gate', { gate_id: uid(42), name: 'greptile', result: 'not-run', candidate: { commit: headSha, base: baseSha }, details: { value: 'postponed — awaiting manual testing', run: null } });
    callCmd(dPause, 'checkpoint', { checkpoint_id: uid(64), kind: 'pause', base: baseSha, wtree: 'wt:pause' });
    const pFull = runRender(dPause, 'p-full.json', { output: 'full-receipt', review_restriction_resolved: true });
    const pRef = { path: 'full-receipt-1.md', sha256: pFull.json.files[0].sha256 };
    expect(runRender(dPause, 'p-comment.json', { output: 'comment', full_receipt: pRef, review_restriction_resolved: true }).code).toBe(0);
    expect(readFileSync(join(dPause, 'comment-paused-1.md'), 'utf8')).toContain(`<!-- review-and-prep:paused:${headSha} -->`);
    expect(readFileSync(join(dPause, 'comment-paused-1.md'), 'utf8')).toContain('reviewRestrictionResolved: true');
    expect(runRender(dPause, 'p-body.json', { output: 'body', comment_url: commentUrl, full_receipt: pRef, summary: { path: 'summary.md', sha256: sha256('Paused for manual checks.\n') } }).code).toBe(0);
    const pFinal = runRender(dPause, 'p-final.json', { output: 'final', required_user_checks: 'M1 check terminal flow' });
    expect(readFileSync(pFinal.json.files[0].path, 'utf8')).toContain('Run /pair-review for draft PR https://github.com/kbitz/gstack-extend/pull/240');

    const dExt = newDir();
    callCmd(dExt, 'start', mkStart(4));
    callCmd(dExt, 'checkpoint', { checkpoint_id: uid(65), kind: 'external-gate', base: baseSha });
    callCmd(dExt, 'checkpoint', { checkpoint_id: uid(66), kind: 'pause', base: baseSha });
    const extFinal = runRender(dExt, 'ext-final.json', { output: 'final', auto_choice_lines: ['Auto-chosen (veto by replying on this PR): Rename helper? → keep name'] });
    const extText = readFileSync(extFinal.json.files[0].path, 'utf8');
    expect(extText).toContain(`Evidence directory: ${dExt}\nAuto-chosen (veto by replying on this PR): Rename helper? → keep name\nExternal gate: external-gate/v1; head: ${headSha}; tree: ${treeSha}; base: ${baseSha}`);
    expect(extText).not.toContain('Stage handoff:');

    const dStop = newDir();
    callCmd(dStop, 'start', mkStart(5));
    callCmd(dStop, 'finish', { outcome: 'stopped', base: baseSha, stop_reason: 'cycle cap', delta_base: baseSha, stop_count: 1 });
    expect(runRender(dStop, 's-res-bad.json', { output: 'full-receipt', review_restriction_resolved: true }).json.detail.violations).toContainEqual({
      path: 'review_restriction_resolved', rule: 'forbidden-for-exit', expected: 'ready-or-paused-only',
    });
    const sFull = runRender(dStop, 's-full.json', { output: 'full-receipt' });
    const stopComment = runRender(dStop, 's-comment.json', { output: 'comment', full_receipt: { path: 'full-receipt-1.md', sha256: sFull.json.files[0].sha256 } });
    expect(readFileSync(stopComment.json.files[0].path, 'utf8')).toContain(`<!-- review-and-prep:stopped:${headSha} -->`);
    expect(readFileSync(runRender(dStop, 's-final.json', { output: 'final' }).json.files[0].path, 'utf8')).toContain('Run /review-and-prep continue for PR https://github.com/kbitz/gstack-extend/pull/240');

    const dBlockedOther = newDir();
    callCmd(dBlockedOther, 'start', mkStart(6));
    callCmd(dBlockedOther, 'finish', { outcome: 'blocked', base: baseSha, stop_reason: 'merge-conflict' });
    expect(runRender(dBlockedOther, 'bo-body.json', { output: 'body', comment_url: null, full_receipt: { path: 'full-receipt-1.md', sha256: '0'.repeat(64) }, summary: { path: 's.md', sha256: '0'.repeat(64) } }).json.detail.violations).toContainEqual({
      path: '$', rule: 'not-renderable', expected: 'renderable-exit-and-output',
    });

    const dBlocked = newDir();
    writeFileSync(join(dBlocked, 'summary.md'), 'Provider failed.\n');
    callCmd(dBlocked, 'start', mkStart(7));
    callCmd(dBlocked, 'finish', { outcome: 'blocked', base: baseSha, stop_reason: 'provider-failures' });
    const blkFull = runRender(dBlocked, 'b-full.json', { output: 'full-receipt' });
    expect(runRender(dBlocked, 'b-body.json', { output: 'body', comment_url: null, full_receipt: { path: 'full-receipt-1.md', sha256: blkFull.json.files[0].sha256 }, summary: { path: 'summary.md', sha256: sha256('Provider failed.\n') } }).code).toBe(0);
    expect(readFileSync(join(dBlocked, 'pr-body-1.md'), 'utf8')).toContain('## Review and prep\n\nBLOCKED — provider failures\n\nProvider failed.\n\nReceipt: none yet\n');
    expect(readFileSync(runRender(dBlocked, 'b-final.json', { output: 'final' }).json.files[0].path, 'utf8')).toContain('status: blocked;');

    const dNeeds = newDir();
    callCmd(dNeeds, 'start', mkStart(8));
    callCmd(dNeeds, 'finish', { outcome: 'needs-context', base: baseSha, stop_reason: 'missing spec' });
    expect(readFileSync(runRender(dNeeds, 'n-final.json', { output: 'final' }).json.files[0].path, 'utf8')).toContain('status: needs-context;');
  });

  // Value: protects=render field bounds, wrong types, final exit combinations, stale audit/gate selection, delegated fallback selection, correction folding, formatter refusal envelopes, summary normalization, allocateExclusiveFile collision/failure cleanup, UTF-8 metadata and tilde prefix boundaries; fails_when=any render input rule, derivation rule or exclusive file write cleanup regresses; why_new=Track 89A T6 (Criterion 4); seam=CLI, executeRender, FIELD_FMT, unresolvedFindings, allocateExclusiveFile, tilde
  test('render covers remaining exit/field combinations, bounds, latest-selection, fallback, corrections, refusal envelopes, summary normalization, exclusive file allocation, UTF-8 metadata and tilde()', () => {
    const runRender = (dir: string, name: string, payload: unknown, opts?: { env?: NodeJS.ProcessEnv }) =>
      runCli(['render', '--dir', dir, '--input', writeJson(dir, name, payload)], opts);
    const commentUrl = 'https://github.com/kbitz/gstack-extend/pull/240#issuecomment-2001';
    const validPr = {
      number: 240,
      url: 'https://github.com/kbitz/gstack-extend/pull/240',
      repo: 'kbitz/gstack-extend',
      base_ref: 'origin/main',
      head_repo: 'kbitz/gstack-extend',
      head_branch: 'topic',
    };
    const autoLine = 'Auto-chosen (veto by replying on this PR): Keep existing name? → yes';

    // 1. Field bounds, wrong types, output missing/unknown, and full_receipt / comment_file name patterns
    const dBounds = newDir();
    writeFileSync(join(dBounds, 'other.md'), 'other\n');
    writeFileSync(join(dBounds, 'full-receipt-1.md'), 'receipt\n');
    writeFileSync(join(dBounds, 'comment-receipt-1.md'), 'comment\n');
    const otherRef = { path: 'other.md', sha256: sha256('other\n') };
    const validFullRef = { path: 'full-receipt-1.md', sha256: sha256('receipt\n') };
    const validComRef = { path: 'comment-receipt-1.md', sha256: sha256('comment\n') };
    callCmd(dBounds, 'start', mkStart(701));
    callCmd(dBounds, 'record gate', {
      gate_id: uid(702), name: 'greptile', result: 'not-run',
      candidate: { commit: headSha, base: baseSha },
      details: { value: 'skipped — no root configuration; do not run it', run: null },
    });
    callCmd(dBounds, 'checkpoint', { checkpoint_id: uid(703), kind: 'ready', base: baseSha });

    const fiftyOneSections = Array.from({ length: 51 }, () => otherRef);
    const fiftyOneAuto = Array.from({ length: 51 }, (_, i) => `${autoLine} ${i}`);
    for (const [name, payload, want] of [
      ['missing-output.json', {}, { path: 'output', rule: 'missing-key', expected: 'full-receipt|comment|body|final' }],
      ['unknown-output.json', { output: 'unknown' }, { path: 'output', rule: 'invalid-enum', expected: 'full-receipt|comment|body|final' }],
      ['sections-too-many.json', { output: 'full-receipt', sections: fiftyOneSections }, { path: 'sections', rule: 'invalid-value', expected: 'array-0..50' }],
      ['sections-not-array.json', { output: 'full-receipt', sections: 'not-array' }, { path: 'sections', rule: 'invalid-value', expected: 'array-0..50' }],
      ['bad-full-name.json', { output: 'comment', full_receipt: otherRef }, { path: 'full_receipt.path', rule: 'invalid-value', expected: 'full-receipt-<n>.md' }],
      ['bad-com-name.json', { output: 'final', full_receipt: validFullRef, comment_file: otherRef, comment_url: commentUrl }, { path: 'comment_file.path', rule: 'invalid-value', expected: 'comment-receipt-<n>.md' }],
      ['save-empty.json', { output: 'final', save_before_shipping: '' }, { path: 'save_before_shipping', rule: 'invalid-value', expected: 'string-1..500|null' }],
      ['save-too-long.json', { output: 'final', save_before_shipping: 's'.repeat(501) }, { path: 'save_before_shipping', rule: 'invalid-value', expected: 'string-1..500|null' }],
      ['save-type.json', { output: 'final', save_before_shipping: 42 }, { path: 'save_before_shipping', rule: 'invalid-value', expected: 'string-1..500|null' }],
      ['checks-empty.json', { output: 'final', required_user_checks: '' }, { path: 'required_user_checks', rule: 'invalid-value', expected: 'string-1..2000|null' }],
      ['checks-too-long.json', { output: 'final', required_user_checks: 'c'.repeat(2001) }, { path: 'required_user_checks', rule: 'invalid-value', expected: 'string-1..2000|null' }],
      ['checks-type.json', { output: 'final', required_user_checks: 42 }, { path: 'required_user_checks', rule: 'invalid-value', expected: 'string-1..2000|null' }],
      ['auto-too-many.json', { output: 'final', auto_choice_lines: fiftyOneAuto }, { path: 'auto_choice_lines', rule: 'invalid-value', expected: 'auto-choice-line-array' }],
      ['auto-bad-prefix.json', { output: 'final', auto_choice_lines: ['Not prefixed: choice'] }, { path: 'auto_choice_lines', rule: 'invalid-value', expected: 'auto-choice-line-array' }],
      ['auto-empty-tail.json', { output: 'final', auto_choice_lines: ['Auto-chosen (veto by replying on this PR):    '] }, { path: 'auto_choice_lines', rule: 'invalid-value', expected: 'auto-choice-line-array' }],
      ['login-empty.json', { output: 'final', gh_login: '' }, { path: 'gh_login', rule: 'invalid-value', expected: 'string-1..128|null' }],
      ['login-too-long.json', { output: 'final', gh_login: 'u'.repeat(129) }, { path: 'gh_login', rule: 'invalid-value', expected: 'string-1..128|null' }],
      ['login-newline.json', { output: 'final', gh_login: 'bad\nuser' }, { path: 'gh_login', rule: 'invalid-value', expected: 'string-1..128|null' }],
    ] as const) {
      const r = runRender(dBounds, name, payload);
      expect(r.code, name).toBe(1);
      expect(r.json.detail.violations, name).toContainEqual(want);
    }
    callCmd(dBounds, 'finish', { outcome: 'prepared', base: baseSha, readiness_confirmed_at: '2026-11-10T18:10:00Z' });
    expect(runRender(dBounds, 'login-conflict.json', {
      output: 'final', gh_login: 'other-login', full_receipt: validFullRef, comment_file: validComRef, comment_url: commentUrl,
    }).json.detail.violations).toContainEqual({ path: 'gh_login', rule: 'conflicts-with-state', expected: 'matches-run-gh-login' });

    // Table-driven final cases per exit (prepared, paused, stopped, external-gate, blocked, needs-context) with null start pr/gh_login
    const makeNullPrDir = (seq: number) => {
      const d = newDir();
      writeFileSync(join(d, 'full-receipt-1.md'), 'receipt\n');
      writeFileSync(join(d, 'comment-receipt-1.md'), 'comment\n');
      callCmd(d, 'start', mkStart(seq, { pr: null, gh_login: null }));
      callCmd(d, 'record gate', {
        gate_id: uid(seq + 1000), name: 'greptile', result: 'not-run',
        candidate: { commit: headSha, base: baseSha },
        details: { value: 'skipped — no root configuration; do not run it', run: null },
      });
      return d;
    };

    const dPrepNull = makeNullPrDir(710);
    callCmd(dPrepNull, 'finish', { outcome: 'prepared', base: baseSha, readiness_confirmed_at: '2026-11-10T18:10:00Z' });
    const dPauseNull = makeNullPrDir(711);
    callCmd(dPauseNull, 'checkpoint', { checkpoint_id: uid(721), kind: 'pause', base: baseSha });
    const dStopNull = makeNullPrDir(712);
    callCmd(dStopNull, 'finish', { outcome: 'stopped', base: baseSha, stop_reason: 'cycle cap', delta_base: baseSha, stop_count: 1 });
    const dExtNull = makeNullPrDir(713);
    callCmd(dExtNull, 'checkpoint', { checkpoint_id: uid(722), kind: 'external-gate', base: baseSha });
    callCmd(dExtNull, 'checkpoint', { checkpoint_id: uid(723), kind: 'pause', base: baseSha });
    const dBlkNull = makeNullPrDir(714);
    callCmd(dBlkNull, 'finish', { outcome: 'blocked', base: baseSha, stop_reason: 'provider-failures' });
    const dNeedsNull = makeNullPrDir(715);
    callCmd(dNeedsNull, 'finish', { outcome: 'needs-context', base: baseSha, stop_reason: 'missing input' });

    for (const [label, dir, payload, wantViolations] of [
      [
        'prepared missing required fields and carrying forbidden fields',
        dPrepNull,
        { output: 'final', required_user_checks: 'M1 check', auto_choice_lines: [autoLine] },
        [
          { path: 'full_receipt', rule: 'missing-key', expected: 'object' },
          { path: 'comment_file', rule: 'missing-key', expected: 'object' },
          { path: 'comment_url', rule: 'missing-key', expected: 'http-url' },
          { path: 'pr', rule: 'missing-key', expected: 'object' },
          { path: 'gh_login', rule: 'missing-key', expected: 'string' },
          { path: 'required_user_checks', rule: 'forbidden-for-exit', expected: 'null' },
          { path: 'auto_choice_lines', rule: 'forbidden-for-exit', expected: 'empty' },
        ],
      ],
      [
        'paused missing required_user_checks and pr and carrying prepared extras',
        dPauseNull,
        { output: 'final', save_before_shipping: 'wip.md' },
        [
          { path: 'required_user_checks', rule: 'missing-key', expected: 'string-1..2000' },
          { path: 'pr', rule: 'missing-key', expected: 'object' },
          { path: '$', rule: 'forbidden-for-exit', expected: 'paused-final-fields-only' },
        ],
      ],
      [
        'paused carrying auto_choice_lines',
        dPauseNull,
        { output: 'final', required_user_checks: 'M1 check', pr: validPr, auto_choice_lines: [autoLine] },
        [{ path: '$', rule: 'forbidden-for-exit', expected: 'paused-final-fields-only' }],
      ],
      [
        'stopped missing pr and carrying forbidden fields',
        dStopNull,
        { output: 'final', required_user_checks: 'M1 check' },
        [
          { path: 'pr', rule: 'missing-key', expected: 'object' },
          { path: '$', rule: 'forbidden-for-exit', expected: 'stopped-final-fields-only' },
        ],
      ],
      [
        'external-gate carrying prepared extras',
        dExtNull,
        { output: 'final', save_before_shipping: 'wip.md' },
        [{ path: '$', rule: 'forbidden-for-exit', expected: 'external-gate-final-fields-only' }],
      ],
      [
        'external-gate carrying required_user_checks',
        dExtNull,
        { output: 'final', required_user_checks: 'M1 check' },
        [{ path: '$', rule: 'forbidden-for-exit', expected: 'external-gate-final-fields-only' }],
      ],
      [
        'blocked carrying auto_choice_lines',
        dBlkNull,
        { output: 'final', auto_choice_lines: [autoLine] },
        [{ path: '$', rule: 'forbidden-for-exit', expected: 'stage-line-final-fields-only' }],
      ],
      [
        'needs-context carrying save_before_shipping',
        dNeedsNull,
        { output: 'final', save_before_shipping: 'wip.md' },
        [{ path: '$', rule: 'forbidden-for-exit', expected: 'stage-line-final-fields-only' }],
      ],
    ] as const) {
      const res = runRender(dir, `final-${label.replace(/\s+/g, '-')}.json`, payload);
      expect(res.code, label).toBe(1);
      for (const v of wantViolations) {
        expect(res.json.detail.violations, label).toContainEqual(v);
      }
    }

    // 2. Stale audit and latest evidence selection, wtree null vs mismatch, Checks not run first-seen order
    const binding = { head: headSha, tree: treeSha, base: baseSha, wtree: '1111111111111111' };
    expect(isFreshForBinding({ commit: headSha, tree: treeSha, base: baseSha, wtree: '2222222222222222' }, binding)).toBe(false);
    expect(isFreshForBinding({ commit: headSha, tree: treeSha, base: baseSha, wtree: null }, binding)).toBe(true);
    expect(isFreshForBinding({ commit: headSha, tree: treeSha, base: baseSha, wtree: '2222222222222222' }, { ...binding, wtree: null })).toBe(true);

    const dSelection = newDir();
    writeFileSync(join(dSelection, 'pregate.json'), '{"ok":true}\n');
    writeFileSync(join(dSelection, 'doc.md'), '## Docs\n');
    callCmd(dSelection, 'start', mkStart(730, { wtree: '1111111111111111' }));
    callCmd(dSelection, 'record gate', {
      gate_id: uid(731), name: 'greptile', result: 'not-run',
      candidate: { commit: headSha, base: baseSha },
      details: { value: 'skipped — no root configuration; do not run it', run: null },
    });
    // First-seen order: pregate (passed), tests (not-run), lint (not-run), then pregate (not-run), lint (passed) -> pregate, tests
    callCmd(dSelection, 'record gate', {
      gate_id: uid(732), name: 'pregate', result: 'passed',
      candidate: { commit: headSha, base: baseSha, wtree: '1111111111111111' },
      details: { raw_verdict: 'pass', wrapper_verdict: 'pass', policy: 'base', record_path: 'pregate.json', record_sha256: sha256('{"ok":true}\n'), skipped_lanes: [] },
    });
    callCmd(dSelection, 'record gate', {
      gate_id: uid(733), name: 'tests', result: 'not-run', reason: 'deferred',
      candidate: { commit: headSha, base: baseSha, wtree: '1111111111111111' },
    });
    callCmd(dSelection, 'record gate', {
      gate_id: uid(734), name: 'lint', result: 'not-run', reason: 'pending',
      candidate: { commit: headSha, base: baseSha, wtree: '1111111111111111' },
    });
    expect(callCmd(dSelection, 'record gate', {
      gate_id: uid(735), name: 'pregate', result: 'not-run', reason: 'invalidated',
      candidate: { commit: headSha, base: baseSha, wtree: '1111111111111111' },
      details: { raw_verdict: 'pass', wrapper_verdict: 'pass', policy: 'base', record_path: 'pregate.json', record_sha256: sha256('{"ok":true}\n'), skipped_lanes: [] },
    }).json.reason).toBe('recorded');
    callCmd(dSelection, 'record gate', {
      gate_id: uid(736), name: 'lint', result: 'passed',
      candidate: { commit: headSha, base: baseSha, wtree: null },
    });
    // Coverage and documentation audits: fresh first, then stale (coverage on baseSha; documentation with mismatched non-null wtree)
    callCmd(dSelection, 'record audit', {
      audit_id: uid(737), name: 'coverage', result: 'passed',
      details: { pct: 95, threshold: 80 },
      candidate: { commit: headSha, base: baseSha, wtree: '1111111111111111' },
    });
    callCmd(dSelection, 'record audit', {
      audit_id: uid(738), name: 'coverage', result: 'passed',
      details: { pct: 95, threshold: 80 },
      candidate: { commit: baseSha, base: baseSha, wtree: '1111111111111111' },
    });
    callCmd(dSelection, 'record audit', {
      audit_id: uid(739), name: 'documentation', result: 'passed',
      details: { report_id: 'doc-1', section_path: 'doc.md', section_sha256: sha256('## Docs\n') },
      candidate: { commit: headSha, base: baseSha, wtree: '1111111111111111' },
    });
    callCmd(dSelection, 'record audit', {
      audit_id: uid(740), name: 'documentation', result: 'passed',
      details: { report_id: 'doc-2', section_path: 'doc.md', section_sha256: sha256('## Docs\n') },
      candidate: { commit: headSha, base: baseSha, wtree: '2222222222222222' },
    });
    callCmd(dSelection, 'checkpoint', { checkpoint_id: uid(741), kind: 'ready', base: baseSha, wtree: '1111111111111111' });
    const selState = JSON.parse(readFileSync(join(dSelection, 'review-run-state.json'), 'utf8')) as ReviewRunState;
    const selCtx = makeCtx(selState, { dir: dSelection });
    expect(FIELD_FMT.checksNotRun(selCtx)).toBe('Checks not run: pregate, tests');
    expect(FIELD_FMT.shipGates(selCtx)).toEqual([
      `Ship gates: head=${headSha}; tree=${treeSha}; base=${baseSha}`,
      '- pregate: not-run',
      '- coverage: not-run',
      '- documentation: not-run',
    ]);

    // 3. Delegated fallback selection and 4. Correction folding
    callCmd(dSelection, 'record pass', mkPassStarted(750, { required_voices: ['testing', 'maintainability', 'core'] }));
    // Voice 1 (testing): failed delegated attempt, then selected host fallback attempt -> renders last delegated attempt with outcome=fell-back, reason=timeout, findings=0
    callCmd(dSelection, 'record pass', {
      pass_id: uid(750), state: 'attempt', voice_id: 'testing', part: 'specialist:testing',
      attempt_id: uid(751), outcome: 'failed',
      delegate: {
        provider: 'codex', model: 'gpt-5', outcome: 'fell-back', fallback_reason: 'timeout', replay: false,
        wall_ms: 400, input_tokens: 50, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: null, call_id: sha256('del-fall'),
      },
    });
    callCmd(dSelection, 'record pass', {
      pass_id: uid(750), state: 'attempt', voice_id: 'testing', part: 'specialist:testing',
      attempt_id: uid(752), predecessor_attempt_id: uid(751), outcome: 'completed',
      findings: [{ finding_id: 'F-HOST', severity_source: 'P2', severity_rubric: 'specialist', adjudication: 'accepted', resolution: 'open', found_by: ['specialist:testing'] }],
    });
    callCmd(dSelection, 'record pass', { pass_id: uid(750), state: 'voice-complete', voice_id: 'testing', selected_attempt_id: uid(752) });

    // Voice 2 (maintainability): two delegated attempts, first is selected credited -> first wins over later delegated one
    callCmd(dSelection, 'record pass', {
      pass_id: uid(750), state: 'attempt', voice_id: 'maintainability', part: 'specialist:maintainability',
      attempt_id: uid(753), outcome: 'completed',
      delegate: {
        provider: 'claude', model: 'sonnet', outcome: 'credited', fallback_reason: null, replay: false,
        wall_ms: 200, input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, call_id: sha256('del-selected'),
      },
      findings: [{ finding_id: 'F-CRED', severity_source: 'P3', severity_rubric: 'specialist', adjudication: 'accepted', resolution: 'open', found_by: ['specialist:maintainability'] }],
    });
    callCmd(dSelection, 'record pass', {
      pass_id: uid(750), state: 'attempt', voice_id: 'maintainability', part: 'specialist:maintainability',
      attempt_id: uid(754), predecessor_attempt_id: uid(753), outcome: 'failed',
      delegate: {
        provider: 'claude', model: 'sonnet', outcome: 'fell-back', fallback_reason: 'rate-limit', replay: false,
        wall_ms: 50, input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, call_id: sha256('del-later'),
      },
    });
    callCmd(dSelection, 'record pass', { pass_id: uid(750), state: 'voice-complete', voice_id: 'maintainability', selected_attempt_id: uid(753) });

    // Voice 3 (core): findings for correction folding
    expect(callCmd(dSelection, 'record pass', {
      pass_id: uid(750), state: 'attempt', voice_id: 'core', part: 'core',
      attempt_id: uid(755), outcome: 'completed',
      findings: [
        { finding_id: 'F-CHAIN', severity_source: 'P1', severity_rubric: 'core', adjudication: 'unclassified', resolution: 'open', found_by: ['core'] },
        { finding_id: 'F-DUP', severity_source: 'P2', severity_rubric: 'core', adjudication: 'duplicate', resolution: 'unknown', duplicate_of: 'F-CHAIN', found_by: ['core'] },
        { finding_id: 'F-RC', severity_source: 'P2', severity_rubric: 'core', adjudication: 'accepted', resolution: 'open', found_by: ['core'] },
        { finding_id: 'F-REJ', severity_source: 'P3', severity_rubric: 'core', adjudication: 'accepted', resolution: 'open', found_by: ['core'] },
      ],
    }).json.reason).toBe('recorded');
    expect(callCmd(dSelection, 'record pass', { pass_id: uid(750), state: 'voice-complete', voice_id: 'core', selected_attempt_id: uid(755) }).json.reason).toBe('recorded');
    expect(callCmd(dSelection, 'record pass', { pass_id: uid(750), state: 'completed', completed_at: '2026-11-10T18:05:00Z' }).json.reason).toBe('recorded');

    // Correction chain on F-CHAIN: accepted+fixed, then reopened -> ends open
    expect(callCmd(dSelection, 'record correction', {
      correction_id: uid(760),
      target: { pass_id: uid(750), voice_id: 'core', attempt_id: uid(755), finding_id: 'F-CHAIN' },
      adjudication: 'accepted', resolution: 'fixed', fixed_in: headSha,
    }).json.reason).toBe('recorded');
    expect(callCmd(dSelection, 'record correction', {
      correction_id: uid(761),
      target: { pass_id: uid(750), voice_id: 'core', attempt_id: uid(755), finding_id: 'F-CHAIN' },
      supersedes: uid(760), resolution: 'open',
    }).json.reason).toBe('recorded');
    // F-RC -> receipt_class 'test-gap-recorded'; F-REJ -> rejected + unknown
    expect(callCmd(dSelection, 'record correction', {
      correction_id: uid(763),
      target: { pass_id: uid(750), voice_id: 'core', attempt_id: uid(755), finding_id: 'F-RC' },
      receipt_class: 'test-gap-recorded',
    }).json.reason).toBe('recorded');
    expect(callCmd(dSelection, 'record correction', {
      correction_id: uid(764),
      target: { pass_id: uid(750), voice_id: 'core', attempt_id: uid(755), finding_id: 'F-REJ' },
      adjudication: 'rejected', resolution: 'unknown',
    }).json.reason).toBe('recorded');

    const afterPassState = JSON.parse(readFileSync(join(dSelection, 'review-run-state.json'), 'utf8')) as ReviewRunState;
    const delLines = FIELD_FMT.delegatedParts(makeCtx(afterPassState, { dir: dSelection }));
    expect(delLines).toEqual([
      `Delegated part: testing; provider=codex; model=gpt-5; outcome=fell-back; reason=timeout; wall_ms=400; input_tokens=50; output_tokens=0; cache_read_input_tokens=0; cache_creation_input_tokens=unknown; findings=0; call=${sha256('del-fall')}`,
      `Delegated part: maintainability; provider=claude; model=sonnet; outcome=credited; reason=none; wall_ms=200; input_tokens=100; output_tokens=20; cache_read_input_tokens=0; cache_creation_input_tokens=0; findings=1; call=${sha256('del-selected')}`,
    ]);
    // Inject synthetic corrections with mismatched pass_id/voice_id/attempt_id on F-CHAIN and open resolution on rejected/duplicate/non-blocking to verify target isolation and exclusion rules
    const coreAttempt = afterPassState.passes[0]!.voices[2]!.attempts[0]!;
    const withForeignCor: ReviewRunState = {
      ...afterPassState,
      passes: [
        {
          ...afterPassState.passes[0]!,
          voices: [
            afterPassState.passes[0]!.voices[0]!,
            afterPassState.passes[0]!.voices[1]!,
            {
              ...afterPassState.passes[0]!.voices[2]!,
              attempts: [
                {
                  ...coreAttempt,
                  findings: [
                    ...(coreAttempt.findings ?? []),
                    { finding_id: 'F-DUP-OPEN', severity_source: 'P2', severity_rubric: 'core', adjudication: 'duplicate', resolution: 'open', duplicate_of: 'F-CHAIN', found_by: ['core'], attribution_reason: null, receipt_class: null, finding_class: null, identity: null },
                    { finding_id: 'F-REJ-OPEN', severity_source: 'P3', severity_rubric: 'core', adjudication: 'rejected', resolution: 'open', duplicate_of: null, found_by: ['core'], attribution_reason: null, receipt_class: null, finding_class: null, identity: null },
                    { finding_id: 'F-NB-OPEN', severity_source: 'P3', severity_rubric: 'core', adjudication: 'accepted', resolution: 'open', duplicate_of: null, found_by: ['core'], attribution_reason: null, receipt_class: 'non-blocking', finding_class: null, identity: null },
                  ],
                },
              ],
            },
          ],
        },
      ],
      corrections: [
        ...afterPassState.corrections,
        {
          correction_id: uid(765),
          target: { pass_id: uid(999), voice_id: 'core', attempt_id: uid(755), finding_id: 'F-CHAIN' },
          supersedes: null, adjudication: 'rejected', resolution: 'unknown', receipt_class: null, fixed_in: null, recorded_at: '2026-11-10T18:06:00Z',
        },
        {
          correction_id: uid(766),
          target: { pass_id: uid(750), voice_id: 'testing', attempt_id: uid(755), finding_id: 'F-CHAIN' },
          supersedes: null, adjudication: 'rejected', resolution: 'unknown', receipt_class: null, fixed_in: null, recorded_at: '2026-11-10T18:06:01Z',
        },
        {
          correction_id: uid(767),
          target: { pass_id: uid(750), voice_id: 'core', attempt_id: uid(752), finding_id: 'F-CHAIN' },
          supersedes: null, adjudication: 'rejected', resolution: 'unknown', receipt_class: null, fixed_in: null, recorded_at: '2026-11-10T18:06:02Z',
        },
      ],
    };
    expect(unresolvedFindings(withForeignCor)).toEqual(['F-HOST P2', 'F-CRED P3', 'F-CHAIN P1']);

    // 5. Formatter refusal envelopes: greptile-gate-missing, greptile-value-unrecognized, and skipped-pregate-lanes-too-long
    const dNoGrep = newDir();
    callCmd(dNoGrep, 'start', mkStart(770));
    callCmd(dNoGrep, 'checkpoint', { checkpoint_id: uid(771), kind: 'ready', base: baseSha });
    const rNoGrep = runRender(dNoGrep, 'no-grep.json', { output: 'full-receipt' });
    expect(rNoGrep.code).toBe(1);
    expect(rNoGrep.json.detail.violations).toEqual([{ path: '$', rule: 'greptile-gate-missing', expected: 'greptile-gate-recorded' }]);
    expect(readdirSync(dNoGrep).filter((f) => f.startsWith('full-receipt-'))).toEqual([]);

    const dBadGrep = newDir();
    callCmd(dBadGrep, 'start', mkStart(768));
    callCmd(dBadGrep, 'record gate', {
      gate_id: uid(769), name: 'greptile', result: 'passed',
      candidate: { commit: headSha, base: baseSha },
      details: { value: 'reviewed (0 comments)', run: null },
    });
    callCmd(dBadGrep, 'checkpoint', { checkpoint_id: uid(767), kind: 'ready', base: baseSha });
    const rBadGrep = runRender(dBadGrep, 'bad-grep.json', { output: 'full-receipt' });
    expect(rBadGrep.code).toBe(1);
    expect(rBadGrep.json.reason).toBe('invalid-input');
    expect(rBadGrep.json.detail.violations).toEqual([{ path: '$', rule: 'greptile-value-unrecognized', expected: 'completed|unverified|skipped|postponed' }]);
    expect(readdirSync(dBadGrep).filter((f) => f.startsWith('full-receipt-'))).toEqual([]);

    const dLongLanes = newDir();
    writeFileSync(join(dLongLanes, 'full-receipt-1.md'), 'receipt\n');
    writeFileSync(join(dLongLanes, 'pregate.json'), '{"ok":true}\n');
    callCmd(dLongLanes, 'start', mkStart(772));
    const longLanes = Array.from({ length: 60 }, (_, i) => `lane-number-${i}-with-extra-padding`);
    expect(callCmd(dLongLanes, 'record gate', {
      gate_id: uid(773), name: 'pregate', result: 'not-run', reason: 'skipped',
      candidate: { commit: headSha, base: baseSha },
      details: { raw_verdict: 'pass', wrapper_verdict: 'pass', policy: 'base', record_path: 'pregate.json', record_sha256: sha256('{"ok":true}\n'), skipped_lanes: longLanes },
    }).json.reason).toBe('recorded');
    callCmd(dLongLanes, 'finish', { outcome: 'stopped', base: baseSha, stop_reason: 'cycle cap', delta_base: baseSha, stop_count: 1 });
    const rLongLanes = runRender(dLongLanes, 'long-lanes.json', {
      output: 'comment', full_receipt: { path: 'full-receipt-1.md', sha256: sha256('receipt\n') },
    });
    expect(rLongLanes.code).toBe(1);
    expect(rLongLanes.json.detail.violations).toEqual([{ path: '$', rule: 'skipped-pregate-lanes-too-long', expected: 'max-500-chars' }]);
    expect(readdirSync(dLongLanes).filter((f) => f.startsWith('comment-stopped-'))).toEqual([]);

    // 6. Summary rejection and normalization, plus 8. UTF-8 metadata
    const dSum = newDir();
    callCmd(dSum, 'start', mkStart(775));
    callCmd(dSum, 'record gate', {
      gate_id: uid(776), name: 'greptile', result: 'not-run',
      candidate: { commit: headSha, base: baseSha },
      details: { value: 'skipped — no root configuration; do not run it', run: null },
    });
    callCmd(dSum, 'checkpoint', { checkpoint_id: uid(777), kind: 'ready', base: baseSha });
    writeFileSync(join(dSum, 'sec-crlf.md'), 'Section line 1 — café 😀\r\nSection line 2\r\n\r\n');
    const rFullUtf8 = runRender(dSum, 'full-utf8.json', {
      output: 'full-receipt', sections: [{ path: 'sec-crlf.md', sha256: sha256('Section line 1 — café 😀\r\nSection line 2\r\n\r\n') }],
    });
    expect(rFullUtf8.code).toBe(0);
    const fullUtf8Path = rFullUtf8.json.files[0].path as string;
    const fullUtf8Text = readFileSync(fullUtf8Path, 'utf8');
    expect(fullUtf8Text).not.toContain('\r');
    expect(fullUtf8Text.endsWith('Section line 1 — café 😀\nSection line 2\n')).toBe(true);
    expect(rFullUtf8.json.files[0].bytes).toBe(Buffer.byteLength(fullUtf8Text, 'utf8'));
    expect(rFullUtf8.json.files[0].chars).toBe(fullUtf8Text.length);
    expect(rFullUtf8.json.files[0].bytes).toBeGreaterThan(rFullUtf8.json.files[0].chars);
    const sumFullRef = { path: 'full-receipt-1.md', sha256: rFullUtf8.json.files[0].sha256 };

    for (const [fn, content, expectedRule] of [
      ['sum-empty.md', '   \r\n\t\n', 'non-empty-summary'],
      ['sum-marker.md', 'Contains <!-- review-and-prep:receipt:abc --> marker.\n', 'no-review-and-prep-marker'],
      ['sum-paused.md', 'Status is PAUSED because manual testing required.\n', 'no-paused-phrase-outside-paused'],
    ] as const) {
      writeFileSync(join(dSum, fn), content);
      const rBadSum = runRender(dSum, `${fn}.json`, {
        output: 'body', comment_url: commentUrl, full_receipt: sumFullRef, summary: { path: fn, sha256: sha256(content) },
      });
      expect(rBadSum.code, fn).toBe(1);
      expect(rBadSum.json.detail.violations, fn).toEqual([{ path: 'summary', rule: 'invalid-value', expected: expectedRule }]);
    }

    writeFileSync(join(dSum, 'sum-crlf.md'), 'Line A\r\nLine B\r\n\r\n');
    const rBodyCrlf = runRender(dSum, 'body-crlf.json', {
      output: 'body', comment_url: commentUrl, full_receipt: sumFullRef,
      summary: { path: 'sum-crlf.md', sha256: sha256('Line A\r\nLine B\r\n\r\n') },
    });
    expect(rBodyCrlf.code).toBe(0);
    const bodyCrlfText = readFileSync(rBodyCrlf.json.files[0].path, 'utf8');
    expect(bodyCrlfText).not.toContain('\r');
    expect(bodyCrlfText).toContain('prepared\n\nLine A\nLine B\n\nReceipt:');

    // Paused phrase is allowed on a paused exit
    callCmd(dSum, 'checkpoint', { checkpoint_id: uid(778), kind: 'pause', base: baseSha });
    const rBodyPausedPhrase = runRender(dSum, 'body-paused-ok.json', {
      output: 'body', comment_url: commentUrl, full_receipt: sumFullRef,
      summary: { path: 'sum-paused.md', sha256: sha256('Status is PAUSED because manual testing required.\n') },
    });
    expect(rBodyPausedPhrase.code).toBe(0);

    // 7. Output-name collisions and owned-write failures via allocateExclusiveFile
    // Exercise the diagnostic path bound regardless of the host's TMPDIR.
    const dAlloc = join(newDir(), 'render-diagnostic-path-'.repeat(4));
    mkdirSync(dAlloc);
    // readdir failure
    const rReaddirFail = allocateExclusiveFile(dAlloc, dAlloc, 'full-receipt', 'hello\n', '/home/user', {
      readdir: () => { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }); },
    });
    expect(rReaddirFail).toEqual({
      ok: false,
      detail: { errno: 'EACCES', syscall: 'readdir', path: dAlloc.slice(0, 80) },
    });

    // EEXIST retry landing on the next number
    let openCalls = 0;
    const rRetryNext = allocateExclusiveFile(dAlloc, dAlloc, 'full-receipt', 'hello\n', '/home/user', {
      open: (p, flags, mode) => {
        openCalls++;
        if (openCalls === 1) throw Object.assign(new Error('exists'), { code: 'EEXIST', syscall: 'open' });
        return require('node:fs').openSync(p, flags, mode);
      },
    });
    expect(rRetryNext.ok).toBe(true);
    if (rRetryNext.ok) {
      expect(rRetryNext.file.path).toBe(join(dAlloc, 'full-receipt-2.md'));
      expect(openCalls).toBe(2);
    }

    // Exhaustion after 64 tries
    let exhaustCalls = 0;
    const rExhaust = allocateExclusiveFile(dAlloc, dAlloc, 'full-receipt', 'hello\n', '/home/user', {
      open: () => {
        exhaustCalls++;
        throw Object.assign(new Error('exists'), { code: 'EEXIST', syscall: 'open' });
      },
    });
    expect(exhaustCalls).toBe(64);
    expect(rExhaust).toEqual({
      ok: false,
      detail: { errno: 'EEXIST', syscall: 'open', path: join(dAlloc, 'full-receipt-*.md').slice(0, 80) },
    });

    // Write failure removes only the file this call created
    const targetPath = join(dAlloc, 'full-receipt-3.md');
    const rWriteFail = allocateExclusiveFile(dAlloc, dAlloc, 'full-receipt', 'hello\n', '/home/user', {
      write: () => { throw Object.assign(new Error('no space'), { code: 'ENOSPC', syscall: 'write' }); },
    });
    expect(rWriteFail).toEqual({
      ok: false,
      detail: { errno: 'ENOSPC', syscall: 'write', path: targetPath.slice(0, 80) },
    });
    expect(existsSync(join(dAlloc, 'full-receipt-3.md'))).toBe(false);
    expect(existsSync(join(dAlloc, 'full-receipt-2.md'))).toBe(true);

    // fsync failure removes the owned file
    const rFsyncFail = allocateExclusiveFile(dAlloc, dAlloc, 'full-receipt', 'hello\n', '/home/user', {
      fsync: () => { throw Object.assign(new Error('io error'), { code: 'EIO', syscall: 'fsync' }); },
    });
    expect(rFsyncFail).toEqual({
      ok: false,
      detail: { errno: 'EIO', syscall: 'fsync', path: targetPath.slice(0, 80) },
    });
    expect(existsSync(join(dAlloc, 'full-receipt-3.md'))).toBe(false);

    // Replaced inode during fsync failure is left alone
    const rReplacedInode = allocateExclusiveFile(dAlloc, dAlloc, 'full-receipt', 'hello\n', '/home/user', {
      fsync: () => {
        unlinkSync(targetPath);
        writeFileSync(targetPath, 'replacement from another writer\n');
        throw Object.assign(new Error('io error after replacement'), { code: 'EIO', syscall: 'fsync' });
      },
    });
    expect(rReplacedInode.ok).toBe(false);
    expect(existsSync(targetPath)).toBe(true);
    expect(readFileSync(targetPath, 'utf8')).toBe('replacement from another writer\n');

    // 8. tilde() home-prefix display path boundaries
    expect(tilde('/home/user/dir/file.md', '/home/user')).toBe('~/dir/file.md');
    expect(tilde('/home/user/dir/file.md', '/home/user///')).toBe('~/dir/file.md');
    expect(tilde('/home/user2/dir/file.md', '/home/user')).toBe('/home/user2/dir/file.md');
    expect(tilde('/home/user', '/home/user')).toBe('/home/user');
    expect(tilde('/etc/hosts', '/')).toBe('/etc/hosts');
    expect(tilde('/etc/hosts', '///')).toBe('/etc/hosts');
  });

  test('render outputs evidence locators in published PR comments and bodies while keeping local paths for full-receipt, CLI display, and H-F final', () => {
    const commentUrl = 'https://github.com/kbitz/gstack-extend/pull/240#issuecomment-1001';
    const pregateBytes = '{"ok":true}\n';
    const docSecBytes = '## Documentation\n- Current.\n';
    const summaryBytes = 'Summary of changes.\n';

    const dReady = newDir(), dPause = newDir(), dStop = newDir(), dBlocked = newDir();
    for (const d of [dReady, dPause, dStop, dBlocked]) writeFileSync(join(d, 'summary.md'), summaryBytes);
    writeFileSync(join(dReady, 'pregate.json'), pregateBytes);
    writeFileSync(join(dReady, 'doc-sec.md'), docSecBytes);

    callCmd(dReady, 'start', mkStart(9, { wtree: 'e5e5e5e5e5e5e5e5' }));
    callCmd(dReady, 'record gate', {
      gate_id: uid(43), name: 'pregate', result: 'passed', candidate: { commit: headSha, base: baseSha, wtree: 'e5e5e5e5e5e5e5e5' },
      details: { raw_verdict: 'pass', wrapper_verdict: 'pass', policy: 'base', record_path: 'pregate.json', record_sha256: sha256(pregateBytes), skipped_lanes: [] },
    });
    callCmd(dReady, 'record gate', {
      gate_id: uid(44), name: 'greptile', result: 'passed', candidate: { commit: baseSha, base: baseSha },
      details: { value: `completed on ${baseSha}; findings dispositioned in the receipt, so triage only newer feedback`, run: 'https://github.com/kbitz/gstack-extend/pull/240#pullrequestreview-1' },
    });
    callCmd(dReady, 'record audit', {
      audit_id: uid(52), name: 'documentation', result: 'accepted',
      details: { report_id: 'doc-1', section_path: 'doc-sec.md', section_sha256: sha256(docSecBytes) },
      candidate: { commit: headSha, base: baseSha, wtree: 'e5e5e5e5e5e5e5e5' },
    });
    callCmd(dReady, 'checkpoint', { checkpoint_id: uid(67), kind: 'ready', base: baseSha, wtree: 'e5e5e5e5e5e5e5e5' });

    callCmd(dPause, 'start', mkStart(10));
    callCmd(dPause, 'record gate', { gate_id: uid(45), name: 'greptile', result: 'not-run', candidate: { commit: headSha, base: baseSha }, details: { value: 'postponed — awaiting manual testing', run: null } });
    callCmd(dPause, 'checkpoint', { checkpoint_id: uid(68), kind: 'pause', base: baseSha, wtree: 'wt:pause' });

    callCmd(dStop, 'start', mkStart(11));
    callCmd(dStop, 'finish', { outcome: 'stopped', base: baseSha, stop_reason: 'cycle cap', delta_base: baseSha, stop_count: 1 });

    callCmd(dBlocked, 'start', mkStart(12));
    callCmd(dBlocked, 'finish', { outcome: 'blocked', base: baseSha, stop_reason: 'provider-failures' });

    const runs = [
      { dir: dReady, hasComment: true, commentUrl },
      { dir: dPause, hasComment: true, commentUrl },
      { dir: dStop, hasComment: true, commentUrl },
      { dir: dBlocked, hasComment: false, commentUrl: null },
    ] as const;

    const fullRefs = new Map<string, { path: string; sha256: string }>();
    for (const r of runs) {
      const name = basename(r.dir);
      const res = runCli(['render', '--dir', r.dir, '--input', writeJson(r.dir, 'full.json', { output: 'full-receipt' })], { env: { HOME: baseTmp } });
      expect(res.code).toBe(0);
      expect(res.json.files[0].display).toBe(`~/${name}/full-receipt-1.md`);
      const fullText = readFileSync(res.json.files[0].path, 'utf8');
      expect(fullText).toMatch(new RegExp(`^Run state: recorded \\(~/${name}/review-run-state\\.json; rev \\d+\\)$`, 'm'));
      if (r.dir === dReady) {
        expect(fullText).toContain(`record: ~/${name}/pregate.json; sha256: ${sha256(pregateBytes)}`);
        expect(fullText).toContain(`section: ~/${name}/doc-sec.md; sha256: ${sha256(docSecBytes)}`);
      }
      fullRefs.set(r.dir, { path: 'full-receipt-1.md', sha256: res.json.files[0].sha256 });
    }

    for (const [envIdx, envOpt] of [{}, { HOME: baseTmp }, {}].entries()) {
      const homeStr = (envOpt.HOME ?? process.env.HOME ?? '').replace(/\/+$/, '');
      for (const r of runs) {
        const cliDir = envIdx === 2 ? r.dir + '/.' : r.dir;
        const name = basename(r.dir), fullRef = fullRefs.get(r.dir)!;
        if (r.hasComment) {
          const cRes = runCli(['render', '--dir', cliDir, '--input', writeJson(r.dir, `c-${envIdx}.json`, { output: 'comment', full_receipt: fullRef })], { env: envOpt });
          expect(cRes.code).toBe(0);
          if (envOpt.HOME === baseTmp) expect(cRes.json.files[0].display).toMatch(new RegExp(`^~/${name}/comment-(receipt|paused|stopped)-\\d+\\.md$`));
          const cText = readFileSync(cRes.json.files[0].path, 'utf8');
          expect(cText).not.toContain(r.dir);
          expect(cText).not.toContain('~/');
          if (homeStr.length > 1) expect(cText).not.toContain(homeStr);
          expect(cText).toContain(`Full receipt: ${name}/full-receipt-1.md; sha256: ${fullRef.sha256}`);
          if (r.dir === dReady) {
            expect(cText).toContain(`record: ${name}/pregate.json; sha256: ${sha256(pregateBytes)}`);
            expect(cText).toContain(`section: ${name}/doc-sec.md; sha256: ${sha256(docSecBytes)}`);
          }
        }
        const bRes = runCli(['render', '--dir', cliDir, '--input', writeJson(r.dir, `b-${envIdx}.json`, {
          output: 'body', comment_url: r.commentUrl, full_receipt: fullRef, summary: { path: 'summary.md', sha256: sha256(summaryBytes) },
        })], { env: envOpt });
        expect(bRes.code).toBe(0);
        if (envOpt.HOME === baseTmp) expect(bRes.json.files[0].display).toMatch(new RegExp(`^~/${name}/pr-body-\\d+\\.md$`));
        const bText = readFileSync(bRes.json.files[0].path, 'utf8');
        expect(bText).not.toContain(r.dir);
        expect(bText).not.toContain('~/');
        if (homeStr.length > 1) expect(bText).not.toContain(homeStr);
        expect(bText).toContain(`Evidence: ${name}/full-receipt-1.md; sha256: ${fullRef.sha256}`);
      }
    }
  });

  // Value: protects=digest-pinned evidence and exclusive output ownership; fails_when=render reopens checked paths, removes an unowned file after open fails, or rounds an existing numeric suffix; why_new=review reproductions; seam=child-local filesystem mocks; no_claim=OS sandboxing
  test.each(['replace-section', 'failed-open', 'readback-replacement', 'large-suffix'])('render consumes checked bytes and preserves outputs it did not create (%s)', (mode) => {
      const d = newDir();
      callCmd(d, 'start', mkStart());
      callCmd(d, 'record gate', { gate_id: uid(41), name: 'greptile', result: 'not-run', candidate: { commit: headSha, base: baseSha }, details: { value: 'skipped — no root configuration', run: null } });
      callCmd(d, 'checkpoint', { checkpoint_id: uid(60), kind: 'ready', base: baseSha });
      writeFileSync(join(d, 'section.md'), 'Digest-pinned section.\n');
      const input = writeJson(d, 'render.json', { output: 'full-receipt', sections: [{ path: 'section.md', sha256: sha256('Digest-pinned section.\n') }] });
      if (mode === 'large-suffix') writeFileSync(join(d, 'full-receipt-9007199254740993.md'), 'existing receipt\n');
      const child = `
        import { mock } from 'bun:test';
        const fs = await import('node:fs');
        const mode = ${JSON.stringify(mode)};
        const storePath = ${JSON.stringify(join(REPO_ROOT, 'src/review-state/store.ts'))};
        const store = await import(storePath);
        const checkDirFile = store.checkDirFile, openSync = fs.openSync, readFileSync = fs.readFileSync;
        if (mode === 'replace-section') mock.module(storePath, () => ({ ...store,
          checkDirFile(...args) {
            const result = checkDirFile(...args);
            if (result.ok && args[1] === 'section.md') fs.writeFileSync(result.realPath, 'Replacement after validation.\\n');
            return result;
          }
        }));
        if (mode === 'failed-open') mock.module('node:fs', () => ({ ...fs,
          openSync(path, flags, permissions) {
            if (flags === 'wx' && String(path).includes('/full-receipt-')) {
              fs.writeFileSync(path, 'Other writer owns this output.\\n');
              throw Object.assign(new Error('injected descriptor exhaustion'), { code: 'EMFILE' });
            }
            return openSync(path, flags, permissions);
          }
        }));
        if (mode === 'readback-replacement') mock.module('node:fs', () => ({ ...fs,
          readFileSync(path, ...args) {
            if (String(path).includes('/full-receipt-')) {
              fs.renameSync(path, String(path) + '.original');
              fs.writeFileSync(path, 'Other writer owns this output.\\n');
            }
            return readFileSync(path, ...args);
          }
        }));
        const { executeRender } = await import(${JSON.stringify(join(REPO_ROOT, 'src/review-state/render.ts'))});
        console.log(JSON.stringify(executeRender(${JSON.stringify(d)}, ${JSON.stringify(input)}, ${JSON.stringify(repo)})));
      `;
      const r = spawnSync(process.execPath, ['--no-env-file', '--config=/dev/null', '--no-install', '-e', child], { cwd: repo, env: GIT_ENV, encoding: 'utf8', timeout: 15000 });
      expect(r.status, r.stderr).toBe(0);
      const result = JSON.parse(r.stdout);
      if (mode === 'failed-open' || mode === 'readback-replacement') {
        expect(result.ok).toBe(false);
        expect(result.envelope).toMatchObject({ reason: 'unwritable', detail: { errno: mode === 'failed-open' ? 'EMFILE' : 'EIO' } });
        expect(existsSync(join(d, 'full-receipt-1.md'))).toBe(true);
        expect(readFileSync(join(d, 'full-receipt-1.md'), 'utf8')).toBe('Other writer owns this output.\n');
      } else {
        expect(result.ok).toBe(true);
        const output = result.renderDoc.files[0].path;
        expect(readFileSync(output, 'utf8')).toContain('Digest-pinned section.\n');
        expect(readFileSync(output, 'utf8')).not.toContain('Replacement after validation.');
        if (mode === 'replace-section') expect(readFileSync(join(d, 'section.md'), 'utf8')).toBe('Replacement after validation.\n');
        if (mode === 'large-suffix') expect(output).toBe(join(d, 'full-receipt-9007199254740994.md'));
      }
  });

  // Value: protects=interrupted-session resume transitions, same-session refusal, replay, and export projection; fails_when=an open run refuses checkpoint resume, stamps ended_at from caller times, emits a false run end, or drops derived interrupted stage_runs; why_new=Track 79A part 1 T1; seam=none; no_claim=daemon process crash signals
  test('checkpoint resume on an open run closes the interrupted segment at its last helper write and exports without run end', () => {
    const d = newDir();
    const sid1 = `extend-${uid(901)}`;
    const sid2 = `extend-${uid(902)}`;
    expect(callCmd(d, 'start', mkStart(1, { session_id: sid1 })).code).toBe(0);
    // Caller-supplied started_at is intentionally far in the future to prove ended_at uses helper-stamped recorded_at.
    expect(callCmd(d, 'record pass', {
      pass_id: uid(10), state: 'started', scope: 'local', cycle: 1, coverage: 'full',
      candidate: { commit: headSha, base: baseSha }, required_voices: ['core'], started_at: '2099-01-01T00:00:00Z',
    }).code).toBe(0);
    const gateRes = callCmd(d, 'record gate', {
      gate_id: uid(20), name: 'probe-113a', result: 'passed', candidate: { commit: headSha, base: baseSha },
    });
    expect(gateRes.code).toBe(0);
    const lastHelperTs = gateRes.json.detail.recorded_at as string;

    // Same non-null session_id on an open run is refused as same-session-resume.
    const sameSid = callCmd(d, 'checkpoint', { checkpoint_id: uid(30), kind: 'resume', session_id: sid1 });
    expect(sameSid.code).toBe(1);
    expect(sameSid.json.reason).toBe('invalid-input');
    expect(sameSid.json.detail.violations).toContainEqual({
      path: 'session_id',
      rule: 'same-session-resume',
      expected: 'different-session-id-or-null-when-resuming-open-run',
    });

    // Different session_id closes segment 1 as "interrupted" at lastHelperTs and opens segment 2.
    const resCp = callCmd(d, 'checkpoint', {
      checkpoint_id: uid(31), kind: 'resume', base: baseSha, wtree: 'wt:resume-1', session_id: sid2,
    }, { file: 'cp-resume.json' });
    expect(resCp.code).toBe(0);
    expect(resCp.json.reason).toBe('recorded');

    // Retrying the identical checkpoint_id replays cleanly (checked before lifecycle / same-session-resume).
    const replayCp = runCli(['checkpoint', '--dir', d, '--input', join(d, 'cp-resume.json')]);
    expect(replayCp.code).toBe(0);
    expect(replayCp.json.reason).toBe('replayed');

    const stored = JSON.parse(readFileSync(join(d, 'review-run-state.json'), 'utf8')) as ReviewRunState;
    expect(stored.segments).toHaveLength(2);
    expect(stored.segments[0]).toMatchObject({
      segment: 1,
      end: 'interrupted',
      ended_at: lastHelperTs,
      session_id: sid1,
    });
    expect(stored.segments[0]!.ended_at).not.toBe('2099-01-01T00:00:00Z');
    expect(stored.segments[1]).toMatchObject({
      segment: 2,
      end: null,
      ended_at: null,
      session_id: sid2,
    });
    expect(stored.checkpoints[0]).toMatchObject({
      checkpoint_id: uid(31),
      segment: 2,
      kind: 'resume',
      session_id: sid2,
    });

    // The interrupted segment exports its partial cycle without a run end.
    const exp1 = runCli(['export', '--dir', d]);
    expect(exp1.code).toBe(0);
    expect(exp1.json.segments[0]).toMatchObject({
      segment: 1,
      end: 'interrupted',
      ended_at: lastHelperTs,
      derived: false,
      outcome: 'unknown',
    });
    const interruptedRecords = exp1.json.records.filter((r: { session_id: string }) => r.session_id === sid1);
    expect(interruptedRecords.map((r: { op: string }) => r.op)).toEqual(['begin', 'pass', 'finding-cycles']);
    expect(interruptedRecords[2].request.cycles).toMatchObject([{ observed: 'partial' }]);
    expect(exp1.json.stage_runs).toEqual([]);

    // Resume on a finished run is still refused with "finished".
    expect(callCmd(d, 'record pass', {
      pass_id: uid(10), state: 'attempt', voice_id: 'core', attempt_id: uid(11), outcome: 'completed', findings: [],
    }).code).toBe(0);
    expect(callCmd(d, 'record pass', {
      pass_id: uid(10), state: 'voice-complete', voice_id: 'core', selected_attempt_id: uid(11),
    }).code).toBe(0);
    expect(callCmd(d, 'record pass', {
      pass_id: uid(10), state: 'completed', completed_at: '2026-11-10T18:05:00Z',
    }).code).toBe(0);
    expect(callCmd(d, 'finish', { outcome: 'prepared', base: baseSha }).code).toBe(0);
    const afterFin = callCmd(d, 'checkpoint', { checkpoint_id: uid(32), kind: 'resume', session_id: `extend-${uid(903)}` });
    expect(afterFin.code).toBe(1);
    expect(afterFin.json.reason).toBe('finished');

    // Derived (session_id: null) interrupted segment exports a stage_runs entry with outcome: "unknown".
    const dDerived = newDir();
    expect(callCmd(dDerived, 'start', mkStart(2, { session_id: null })).code).toBe(0);
    const g2 = callCmd(dDerived, 'record gate', {
      gate_id: uid(21), name: 'tests', result: 'passed', candidate: { commit: headSha, base: baseSha },
    });
    expect(callCmd(dDerived, 'checkpoint', { checkpoint_id: uid(33), kind: 'resume', session_id: null }).code).toBe(0);
    const exp2 = runCli(['export', '--dir', dDerived]);
    expect(exp2.code).toBe(0);
    expect(exp2.json.stage_runs).toEqual([
      {
        segment: 1,
        session_id: `extend-${uuidv5(NAMESPACE, `${uid(2)}:segment:1`)}`,
        started_at: exp2.json.segments[0].started_at,
        ended_at: g2.json.detail.recorded_at,
        outcome: 'unknown',
        branch: 'main',
      },
    ]);

    // The current reader accepts interrupted; an unknown future enum from a newer writer stays newer-schema.
    const validInterrupted = validateStoredState(JSON.parse(readFileSync(join(d, 'review-run-state.json'), 'utf8')), join(d, 'review-run-state.json'), '0.86.0');
    expect(validInterrupted.ok).toBe(true);
    const futureBadEnum = JSON.parse(readFileSync(join(d, 'review-run-state.json'), 'utf8'));
    futureBadEnum.writer = '99.0.0';
    futureBadEnum.segments[0].end = 'future-end-kind';
    expect(validateStoredState(futureBadEnum, join(d, 'review-run-state.json'), '0.87.0')).toMatchObject({
      ok: false,
      reason: 'newer-schema',
      detail: { writer: '99.0.0' },
    });
  });

  // Value: protects=read-only show across every checkpoint kind, head relation, freshness, evidence_ok, and refusal modes; fails_when=show mutates state or locks, misreports a checkpoint or head relation, or accepts mismatched worktrees/flags; why_new=Track 79A part 1 T2; seam=none; no_claim=skill prose execution
  test('show reports resume state across every checkpoint kind and refuses missing, mismatched, corrupt, and invalid inputs without touching state', () => {
    expect(runCli(['--help']).out).toContain('bin/review-state show --dir DIR [--base SHA] [--wtree TOKEN]');
    expect(runCli(['show', '--help']).out).toContain(`review-state show — experimental read-only resume inspection (${SHOW_SCHEMA})`);

    // Missing state -> not-started
    const dEmpty = newDir();
    const notStarted = runCli(['show', '--dir', dEmpty]);
    expect(notStarted.code).toBe(1);
    expect(notStarted.json.reason).toBe('not-started');

    // Flag usage errors on show and other commands
    const dummyIn = writeJson(dEmpty, 'dummy.json', {});
    expect(runCli(['show', '--dir', dEmpty, '--input', dummyIn]).json.reason).toBe('usage');
    expect(runCli(['show', '--dir', dEmpty, '--base', 'not-a-hex40']).json.reason).toBe('usage');
    expect(runCli(['show', '--dir', dEmpty, '--base', 'f'.repeat(40)]).json.reason).toBe('usage');
    expect(runCli(['show', '--dir', dEmpty, '--wtree', 'bad wtree token']).json.reason).toBe('usage');
    expect(runCli(['export', '--dir', dEmpty, '--base', baseSha]).json.reason).toBe('usage');
    expect(runCli(['export', '--dir', dEmpty, '--wtree', 'wt:ok']).json.reason).toBe('usage');

    // Walk through checkpoints: none -> before-fix -> next-cycle -> external-gate + pause -> resume -> pause -> resume -> ready -> stop
    const d = newDir();
    writeFileSync(join(d, 'ev-test.txt'), 'gate evidence\n');
    const evRef = { path: 'ev-test.txt', sha256: sha256('gate evidence\n') };
    callCmd(d, 'start', mkStart(10, { wtree: 'wt:v1' }));
    callCmd(d, 'record pass', {
      pass_id: uid(100), state: 'started', scope: 'local', cycle: 1, coverage: 'full',
      candidate: { commit: headSha, base: baseSha, wtree: 'wt:v1' }, required_voices: ['core', 'red-team'], started_at: '2026-11-10T18:00:00Z',
    });
    callCmd(d, 'record pass', {
      pass_id: uid(100), state: 'attempt', voice_id: 'core', part: 'core', attempt_id: uid(101), outcome: 'completed',
      findings: [
        { finding_id: 'F1', severity_source: 'P2', severity_rubric: 'core', adjudication: 'accepted', resolution: 'open', found_by: ['core'] },
      ],
    });
    callCmd(d, 'record pass', {
      pass_id: uid(100), state: 'voice-complete', voice_id: 'core', selected_attempt_id: uid(101),
    });
    callCmd(d, 'record pass', {
      pass_id: uid(100), state: 'voice-complete', voice_id: 'red-team', not_applicable: 'not-applicable',
    });
    callCmd(d, 'record gate', {
      gate_id: uid(200), name: 'tests', result: 'passed',
      candidate: { commit: headSha, base: baseSha, wtree: 'wt:v1' }, evidence: [evRef],
    });
    callCmd(d, 'record gate', {
      gate_id: uid(201), name: 'greptile', result: 'not-run',
      candidate: { commit: headSha, base: baseSha }, details: { value: 'skipped — no root configuration; do not run it', run: null },
    });
    callCmd(d, 'record audit', {
      audit_id: uid(300), name: 'coverage', result: 'passed',
      details: { pct: 95, threshold: 90 }, candidate: { commit: headSha, base: baseSha, wtree: 'wt:v1' }, evidence: [evRef],
    });

    // 1. No checkpoint yet (open pass)
    const statePath = join(d, 'review-run-state.json');
    const bytesBeforeShow = readFileSync(statePath, 'utf8');
    const sNone = runCli(['show', '--dir', d, '--base', baseSha, '--wtree', 'wt:v1']);
    expect(sNone.code).toBe(0);
    expect(readFileSync(statePath, 'utf8')).toBe(bytesBeforeShow);
    expect(existsSync(join(d, 'review-run-state.json.lock'))).toBe(false);
    expect(sNone.json).toMatchObject({
      schema: SHOW_SCHEMA,
      lifecycle: 'open',
      exit: null,
      head: { current: headSha, tree: treeSha, reference: headSha, relation: 'same' },
      last_checkpoint: null,
      unresolved: ['F1 P2'],
    });
    expect(sNone.json.passes[0].voices).toEqual([
      { voice_id: 'core', required: true, status: 'selected' },
      { voice_id: 'red-team', required: true, status: 'not-applicable' },
    ]);
    expect(sNone.json.gates[0]).toMatchObject({ name: 'tests', result: 'passed', fresh: true, evidence_ok: true });
    expect(sNone.json.audits[0]).toMatchObject({ name: 'coverage', result: 'passed', fresh: true, evidence_ok: true });
    expect(runCli(['show', '--dir', d]).json.gates[0].fresh).toBeNull();
    expect(runCli(['show', '--dir', d, '--base', baseSha, '--wtree', 'wt:other']).json.gates[0].fresh).toBe(false);

    // Deleting the evidence file flips evidence_ok to false without failing show.
    unlinkSync(join(d, 'ev-test.txt'));
    const sMissingEv = runCli(['show', '--dir', d, '--base', baseSha]);
    expect(sMissingEv.code).toBe(0);
    expect(sMissingEv.json.gates[0].evidence_ok).toBe(false);
    expect(sMissingEv.json.audits[0].evidence_ok).toBe(false);
    writeFileSync(join(d, 'ev-test.txt'), 'gate evidence\n');

    // Complete pass and check checkpoint progression
    callCmd(d, 'record pass', { pass_id: uid(100), state: 'completed', completed_at: '2026-11-10T18:05:00Z' });
    callCmd(d, 'checkpoint', { checkpoint_id: uid(400), kind: 'before-fix' });
    expect(runCli(['show', '--dir', d]).json).toMatchObject({
      lifecycle: 'open',
      exit: null,
      last_checkpoint: { kind: 'before-fix', head: headSha },
    });

    callCmd(d, 'checkpoint', { checkpoint_id: uid(401), kind: 'next-cycle' });
    expect(runCli(['show', '--dir', d]).json.last_checkpoint).toMatchObject({ kind: 'next-cycle', head: headSha });

    callCmd(d, 'checkpoint', { checkpoint_id: uid(402), kind: 'external-gate', base: baseSha, wtree: 'wt:v1' });
    callCmd(d, 'checkpoint', { checkpoint_id: uid(403), kind: 'pause', base: baseSha, wtree: 'wt:v1' });
    expect(runCli(['show', '--dir', d]).json).toMatchObject({
      lifecycle: 'paused',
      exit: 'external-gate',
      last_checkpoint: { kind: 'pause', head: headSha },
    });

    callCmd(d, 'checkpoint', { checkpoint_id: uid(404), kind: 'resume', base: baseSha, session_id: `extend-${uid(910)}` });
    expect(runCli(['show', '--dir', d]).json).toMatchObject({
      lifecycle: 'open',
      exit: null,
      last_checkpoint: { kind: 'resume', segment: 2 },
    });

    callCmd(d, 'checkpoint', { checkpoint_id: uid(405), kind: 'pause', base: baseSha, wtree: 'wt:v1' });
    expect(runCli(['show', '--dir', d]).json).toMatchObject({
      lifecycle: 'paused',
      exit: 'paused',
      last_checkpoint: { kind: 'pause', segment: 2 },
    });

    callCmd(d, 'checkpoint', { checkpoint_id: uid(406), kind: 'resume', base: baseSha, session_id: `extend-${uid(911)}` });
    callCmd(d, 'checkpoint', { checkpoint_id: uid(407), kind: 'ready', base: baseSha, wtree: 'wt:v1' });

    // Render full-receipt on ready and verify unresolved parity + rendered file list sorting
    writeFileSync(join(d, 'full-receipt-10.md'), 'ten\n');
    writeFileSync(join(d, 'full-receipt-2.md'), 'two\n');
    const rFull = callCmd(d, 'render', { output: 'full-receipt' });
    expect(rFull.code).toBe(0);
    const fullText = readFileSync(rFull.json.files[0].path, 'utf8');
    const parsedState = JSON.parse(readFileSync(statePath, 'utf8')) as ReviewRunState;
    expect(fullText).toContain(`Unresolved: ${unresolvedFindings(parsedState).join(', ')}`);

    const sReady = runCli(['show', '--dir', d, '--base', baseSha]);
    expect(sReady.code).toBe(0);
    expect(sReady.json).toMatchObject({
      lifecycle: 'open',
      exit: 'ready',
      last_checkpoint: { kind: 'ready', segment: 3 },
      unresolved: ['F1 P2'],
    });
    expect(sReady.json.rendered.map((f: { path: string }) => f.path)).toEqual([
      'full-receipt-2.md',
      'full-receipt-10.md',
      'full-receipt-11.md',
    ]);

    callCmd(d, 'checkpoint', { checkpoint_id: uid(408), kind: 'stop' });
    expect(runCli(['show', '--dir', d]).json).toMatchObject({
      lifecycle: 'open',
      exit: null,
      last_checkpoint: { kind: 'stop', segment: 3 },
    });

    // Resume from open run at stop checkpoint -> closes segment 3 as interrupted, opens segment 4
    expect(callCmd(d, 'checkpoint', { checkpoint_id: uid(409), kind: 'resume', session_id: `extend-${uid(912)}` }).code).toBe(0);
    const sAfterOpenResume = runCli(['show', '--dir', d]);
    expect(sAfterOpenResume.json.segments[2]).toMatchObject({ segment: 3, end: 'interrupted' });
    expect(sAfterOpenResume.json.segments[3]).toMatchObject({ segment: 4, end: null });

    // Ahead and diverged HEAD relations + branch and repo mismatch in worktrees
    const wtAhead = join(baseTmp, 'wt-show-ahead');
    git(repo, ['worktree', 'add', '-b', 'other-branch', wtAhead, headSha]);
    // On other-branch, show refuses with worktree-mismatch (branch mismatch) while export succeeds
    const sBranchMismatch = runCli(['show', '--dir', d], { cwd: wtAhead });
    expect(sBranchMismatch.code).toBe(1);
    expect(sBranchMismatch.json.reason).toBe('worktree-mismatch');
    expect(sBranchMismatch.json.detail).toMatchObject({ expected_branch: 'main', actual_branch: 'other-branch' });
    expect(runCli(['export', '--dir', d], { cwd: wtAhead }).code).toBe(0);
    git(repo, ['worktree', 'remove', '--force', wtAhead]);

    // Ahead and diverged on the bound branch using a cloned repo sharing the same git common dir vs separate repo
    const otherRepo = makeEmptyRepo(baseTmp, 'other-repo-show');
    expect(runCli(['show', '--dir', d], { cwd: otherRepo }).json.reason).toBe('worktree-mismatch');

    // Create a commit on main in repo -> ahead; then reset to baseSha -> diverged; then restore headSha
    git(repo, ['commit', '--allow-empty', '-m', 'ahead-commit', '--quiet']);
    const aheadSha = git(repo, ['rev-parse', 'HEAD']);
    const sAhead = runCli(['show', '--dir', d, '--base', baseSha]);
    expect(sAhead.code).toBe(0);
    expect(sAhead.json.head).toMatchObject({ current: aheadSha, reference: headSha, relation: 'ahead' });
    expect(sAhead.json.gates[0].fresh).toBe(false);

    git(repo, ['reset', '--hard', baseSha, '--quiet']);
    const sDiverged = runCli(['show', '--dir', d, '--base', baseSha]);
    expect(sDiverged.code).toBe(0);
    expect(sDiverged.json.head).toMatchObject({ current: baseSha, reference: headSha, relation: 'diverged' });
    git(repo, ['reset', '--hard', headSha, '--quiet']);

    // Corrupt and newer-schema on show
    const dCorrupt = newDir();
    writeFileSync(join(dCorrupt, 'review-run-state.json'), '{not-json\n');
    expect(runCli(['show', '--dir', dCorrupt]).json.reason).toBe('corrupt');

    const dNewer = newDir();
    writeFileSync(join(dNewer, 'review-run-state.json'), JSON.stringify({ schema: 'review-run-state/v2', writer: '9.9.9' }));
    expect(runCli(['show', '--dir', dNewer]).json.reason).toBe('newer-schema');
  });

  // Value: protects=writer provenance versus the executing helper version; fails_when=show omits the stored writer or substitutes it for an unavailable helper version; why_new=Track 79A T2 required inspection fields; seam=real stored-state reader
  test('show distinguishes the stored writer from the executing helper version', () => {
    const d = newDir();
    expect(callCmd(d, 'start', mkStart()).code).toBe(0);
    const statePath = join(d, 'review-run-state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    state.writer = '99.0.0';
    writeFileSync(statePath, JSON.stringify(state));
    const versionPath = join(d, 'helper-version');
    writeFileSync(versionPath, '0.92.0\n');
    expect(runCli(['show', '--dir', d], { versionPath }).json).toMatchObject({
      writer: '99.0.0', helper_version: '0.92.0',
    });
    expect(runCli(['show', '--dir', d], { versionPath: join(d, 'missing-version') }).json).toMatchObject({
      writer: '99.0.0', helper_version: null,
    });
  });

  // Value: protects=resume immediately after every supported checkpoint; fails_when=one checkpoint cannot resume or show loses its lifecycle, exit, or head binding; why_new=Track 79A T2's per-checkpoint proving matrix; seam=CLI and durable segments
  test('show and the following resume agree for each checkpoint kind and a finished run', () => {
    for (const kind of [null, 'before-fix', 'next-cycle', 'stop', 'ready', 'pause', 'external-gate', 'resume', 'finished']) {
      const d = newDir();
      expect(callCmd(d, 'start', mkStart(1)).code).toBe(0);
      if (kind === 'finished') {
        expect(callCmd(d, 'finish', { outcome: 'prepared', base: baseSha }).code).toBe(0);
      } else if (kind !== null) {
        expect(callCmd(d, 'checkpoint', {
          checkpoint_id: uid(100), kind, base: baseSha,
          ...(kind === 'resume' ? { session_id: `extend-${uid(1001)}` } : {}),
        }).code).toBe(0);
        if (kind === 'external-gate') {
          expect(callCmd(d, 'checkpoint', { checkpoint_id: uid(101), kind: 'pause', base: baseSha }).code).toBe(0);
        }
      }
      const statePath = join(d, 'review-run-state.json');
      const before = readFileSync(statePath, 'utf8');
      const shown = runCli(['show', '--dir', d]);
      expect(shown.code, String(kind)).toBe(0);
      const paused = kind === 'pause' || kind === 'external-gate';
      expect(shown.json).toMatchObject({
        lifecycle: kind === 'finished' ? 'finished' : paused ? 'paused' : 'open',
        exit: kind === 'finished' ? 'prepared' : kind === 'external-gate' ? 'external-gate' : kind === 'pause' ? 'paused' : kind === 'ready' ? 'ready' : null,
        head: { current: headSha, relation: 'same' },
        last_checkpoint: kind === null || kind === 'finished' ? null : { kind: kind === 'external-gate' ? 'pause' : kind },
      });
      expect(readFileSync(statePath, 'utf8')).toBe(before);
      expect(existsSync(join(d, 'review-run-state.json.lock'))).toBe(false);
      const resumed = callCmd(d, 'checkpoint', {
        checkpoint_id: uid(102), kind: 'resume', base: baseSha, session_id: `extend-${uid(1002)}`,
      });
      if (kind === 'finished') {
        expect(resumed.code).toBe(1);
        expect(resumed.json.reason).toBe('finished');
        expect(readFileSync(statePath, 'utf8')).toBe(before);
      } else {
        expect(resumed.code, String(kind)).toBe(0);
        const after = JSON.parse(readFileSync(statePath, 'utf8'));
        expect(after.segments).toHaveLength(shown.json.segments.length + 1);
        expect(after.segments.at(-2).end).toBe(paused ? 'paused' : 'interrupted');
        expect(after.segments.at(-1).end).toBeNull();
      }
    }
  });

  // Value: protects=start mapping of policy-line delegate= part names to stored part labels, replay across both spellings, and refusal of unknown parts or receipt-line strings; fails_when=start rejects delegate= names, stores unmapped names, breaks label replay, or accepts unknown parts; why_new=Track 80A T1 Test A; seam=CLI and stored state
  test('start accepts the orchestrator\'s delegate= part names, stores part labels, replays across both spellings and refuses unknown parts', () => {
    const partsMatch = /(?:^|; )delegate=([^;]+)/.exec(REAL_POLICY_LINE);
    expect(partsMatch).not.toBeNull();
    const parts = partsMatch![1]!.split(',');
    expect(parts).toEqual(['maintainability', 'adversarial', 'red-team']);

    const d = newDir();
    const startNames = mkStart(1, {
      policy: {
        value: REAL_POLICY_LINE,
        source: 'caller prompt',
        delegation: { status: 'active', parts, config: sha256('cfg'), tools: [] },
      },
    });
    expect(callCmd(d, 'start', startNames).json).toMatchObject({ reason: 'recorded', rev: 1 });
    const stored = JSON.parse(readFileSync(join(d, 'review-run-state.json'), 'utf8')) as ReviewRunState;
    expect(stored.policy.delegation).toEqual({
      status: 'active',
      parts: ['specialist:maintainability', 'native-adversarial', 'red-team'],
      config: sha256('cfg'),
      tools: [],
    });
    expect(callCmd(d, 'start', startNames).json).toMatchObject({ reason: 'replayed', rev: 1 });

    const startLabels = mkStart(1, {
      policy: {
        value: REAL_POLICY_LINE,
        source: 'caller prompt',
        delegation: {
          status: 'active',
          parts: ['specialist:maintainability', 'native-adversarial', 'red-team'],
          config: sha256('cfg'),
          tools: [],
        },
      },
    });
    expect(callCmd(d, 'start', startLabels).json).toMatchObject({ reason: 'replayed', rev: 1 });

    const dTools = newDir();
    const startWithTools = mkStart(2, {
      policy: {
        value: REAL_POLICY_LINE,
        source: 'caller prompt',
        delegation: { status: 'active', parts, config: sha256('cfg'), tools: ['adversarial', 'red-team'] },
      },
    });
    expect(callCmd(dTools, 'start', startWithTools).json).toMatchObject({ reason: 'recorded', rev: 1 });
    const storedTools = JSON.parse(readFileSync(join(dTools, 'review-run-state.json'), 'utf8')) as ReviewRunState;
    expect(storedTools.policy.delegation).toEqual({
      status: 'active',
      parts: ['specialist:maintainability', 'native-adversarial', 'red-team'],
      config: sha256('cfg'),
      tools: ['native-adversarial', 'red-team'],
    });

    for (const [delegation, violation] of [
      [
        { status: 'active', parts: ['maintainability', 'security'], config: sha256('cfg'), tools: [] },
        { path: 'policy.delegation.parts', rule: 'invalid-value', expected: 'nonempty-unique-part-array' },
      ],
      [
        { status: 'active', parts: ['maintainability', 'specialist:maintainability'], config: sha256('cfg'), tools: [] },
        { path: 'policy.delegation.parts', rule: 'invalid-value', expected: 'nonempty-unique-part-array' },
      ],
      [
        { status: 'active', parts, config: sha256('cfg'), tools: ['testing'] },
        { path: 'policy.delegation.tools', rule: 'invalid-value', expected: 'subset-of-parts' },
      ],
      [
        `delegation: active (parts=maintainability,adversarial,red-team; config=${sha256('cfg')})`,
        { path: 'policy.delegation', rule: 'invalid-type', expected: 'object|null' },
      ],
    ] as const) {
      const dRef = newDir();
      const res = callCmd(dRef, 'start', mkStart(3, {
        policy: { value: REAL_POLICY_LINE, source: 'caller prompt', delegation },
      }));
      expect(res.code).toBe(1);
      expect(res.json.reason).toBe('invalid-input');
      expect(res.json.detail.violations).toContainEqual(violation);
      expect(existsSync(join(dRef, 'review-run-state.json'))).toBe(false);
    }

    const dParity = newDir();
    expect(callCmd(dParity, 'start', mkStart(4, {
      policy: {
        value: REAL_POLICY_LINE,
        source: 'caller prompt',
        delegation: { status: 'active', parts: [...PARTS], config: sha256('cfg'), tools: [] },
      },
    })).json).toMatchObject({ reason: 'recorded', rev: 1 });
    const storedParity = JSON.parse(readFileSync(join(dParity, 'review-run-state.json'), 'utf8')) as ReviewRunState;
    expect(storedParity.policy.delegation).toEqual({
      status: 'active',
      parts: [
        'specialist:testing',
        'specialist:maintainability',
        'specialist:performance',
        'specialist:simplification',
        'native-adversarial',
        'red-team',
      ],
      config: sha256('cfg'),
      tools: [],
    });
    if (storedParity.policy.delegation?.status !== 'active') throw new Error('expected active delegation');
    expect(storedParity.policy.delegation.parts.map(wirePart)).toEqual([...PARTS]);
  });

  // Value: protects=strict refusal of the two observed malformed start continuation shapes ({count, max} and prior_stops >= 1 without continues) with exact violations and a specific expected-shape message/fix; fails_when=start accepts {count, max} or missing continues on a continuation, or drops the specific expected-shape message; why_new=Track 80A owner-approved continuation scope addition; seam=CLI and state file
  test('start refuses observed malformed continuation shapes ({count, max} and prior_stops: 1 without continues) with exact violations and expected-shape message', () => {
    const dCountMax = newDir();
    const resCountMax = callCmd(dCountMax, 'start', mkStart(10, {
      continuation: { count: 0, max: 1 },
    }));
    expect(resCountMax.code).toBe(1);
    expect(resCountMax.json.reason).toBe('invalid-input');
    expect(resCountMax.json.detail.violations).toContainEqual({
      path: 'continuation.prior_stops',
      rule: 'missing-key',
      expected: 'prior_stops',
    });
    expect(resCountMax.json.detail.violations).toContainEqual({
      path: 'continuation.count',
      rule: 'unknown-key',
      expected: 'no unknown keys',
    });
    expect(resCountMax.json.detail.message).toBe(
      'continuation must be {prior_stops, max, continues} (40-hex iff prior_stops>=1)',
    );
    expect(resCountMax.json.fix).toContain('{"prior_stops": 0, "max": <int>, "continues": null}');
    expect(resCountMax.json.fix).toContain('{"prior_stops": <k>, "max": <int>, "continues": "<40-hex Stopped at SHA>"}');
    expect(resCountMax.err).toContain('ERROR INVALID_INPUT: continuation must be {prior_stops, max, continues} (40-hex iff prior_stops>=1)');
    expect(existsSync(join(dCountMax, 'review-run-state.json'))).toBe(false);

    const dMissingContinues = newDir();
    const resMissingContinues = callCmd(dMissingContinues, 'start', mkStart(11, {
      continuation: { prior_stops: 1, max: 1 },
    }));
    expect(resMissingContinues.code).toBe(1);
    expect(resMissingContinues.json.reason).toBe('invalid-input');
    expect(resMissingContinues.json.detail.violations).toContainEqual({
      path: 'continuation.continues',
      rule: 'invalid-value',
      expected: 'required-when-prior_stops>=1',
    });
    expect(resMissingContinues.json.detail.message).toBe(
      'continuation must be {prior_stops, max, continues} (40-hex iff prior_stops>=1)',
    );
    expect(resMissingContinues.json.fix).toContain('never {"count", "max"} or prior_stops >= 1 without continues');
    expect(resMissingContinues.err).toContain('ERROR INVALID_INPUT: continuation must be {prior_stops, max, continues} (40-hex iff prior_stops>=1)');
    expect(existsSync(join(dMissingContinues, 'review-run-state.json'))).toBe(false);

    const dNonNullOnZero = newDir();
    const resNonNullOnZero = callCmd(dNonNullOnZero, 'start', mkStart(12, {
      continuation: { prior_stops: 0, max: 1, continues: baseSha },
    }));
    expect(resNonNullOnZero.code).toBe(1);
    expect(resNonNullOnZero.json.reason).toBe('invalid-input');
    expect(resNonNullOnZero.json.detail.violations).toContainEqual({
      path: 'continuation.continues',
      rule: 'invalid-value',
      expected: 'null-when-prior_stops===0',
    });
    expect(existsSync(join(dNonNullOnZero, 'review-run-state.json'))).toBe(false);
  });

  // Value: protects=generic diagnostics and refusal atomicity for start's missing-commit and mixed-input errors; fails_when=continuation shape advice hides a reference error or unrelated violation; why_new=review reproduced diagnostic overreach; seam=CLI and state file
  test.each([
    [
      'a correctly shaped continuation whose commit is missing',
      () => mkStart(13, { continuation: { prior_stops: 1, max: 1, continues: sha256('missing').slice(0, 40) } }),
      { path: 'continuation.continues', rule: 'commit-not-found', expected: 'existing-git-commit' },
    ],
    [
      'a malformed continuation alongside an invalid delegation part',
      () => mkStart(14, {
        continuation: { count: 0, max: 1 },
        policy: { value: REAL_POLICY_LINE, source: 'caller prompt', delegation: { status: 'active', parts: ['security'], config: sha256('cfg'), tools: [] } },
      }),
      { path: 'policy.delegation.parts', rule: 'invalid-value', expected: 'nonempty-unique-part-array' },
    ],
  ])('start keeps generic diagnostics for %s', (_label, payload, violation) => {
    const dir = newDir();
    const res = callCmd(dir, 'start', payload());
    expect(res.code).toBe(1);
    expect(res.json.reason).toBe('invalid-input');
    expect(res.json.detail.violations).toContainEqual(violation);
    expect(res.json.detail).not.toHaveProperty('message');
    expect(res.json.fix).toBe('Fix the payload violations and rerun with a new or corrected --input file.');
    expect(existsSync(join(dir, 'review-run-state.json'))).toBe(false);
  });

  // Value: protects=non-start commands' generic unknown-key advice and unchanged state; fails_when=a stray continuation key gets start-only shape advice; why_new=red-team finding reproduced in QA captures 002/003; seam=CLI and state file
  test.each([
    ['checkpoint', () => ({ checkpoint_id: uid(61), kind: 'before-fix', continuation: {} })],
    ['finish', () => ({ outcome: 'prepared', base: baseSha, continuation: {} })],
  ])('%s keeps generic diagnostics for an unknown continuation key', (cmd, payload) => {
    const { startState } = ensureRefusalSeeds();
    const { dir, statePath, beforeBytes } = dirFromSeed(startState);
    const res = callCmd(dir, cmd, payload());
    expect(res.code).toBe(1);
    expect(res.json.reason).toBe('invalid-input');
    expect(res.json.detail.violations).toEqual([{ path: 'continuation', rule: 'unknown-key', expected: 'no unknown keys' }]);
    expect(res.json.detail).not.toHaveProperty('message');
    expect(res.json.fix).toBe('Fix the payload violations and rerun with a new or corrected --input file.');
    expect(readFileSync(statePath, 'utf8')).toBe(beforeBytes);
  });

  // Value: protects=byte-identical stored state and rendered delegation / Delegated part lines between delegate= names and part labels at start; fails_when=names at start change serialized state or rendered receipt lines; why_new=Track 80A T1 Test B; seam=applyCommand, serializeState, and render formatters
  test('delegate= names and part labels at start write byte-identical state and render the same delegation and Delegated part lines', () => {
    const gitInfo = { repo: '/fixture/.git', toplevel: '/fixture', branch: 'topic', head: headSha, tree: treeSha };
    const env = { commitExists: () => true, commitTree: () => treeSha, isAncestor: () => true, checkEvidence: () => null };
    const partsFromLine = /(?:^|; )delegate=([^;]+)/.exec(REAL_POLICY_LINE)![1]!.split(',');

    const runSequence = (parts: string[], tools: string[]): ReviewRunState => {
      let state: ReviewRunState | null = null;
      const step = (cmd: Parameters<typeof applyCommand>[1], input: unknown, ts: string) => {
        const res = applyCommand(state, cmd, input, gitInfo, env, ts, '0.92.0');
        if (res.reason !== 'recorded') throw new Error(`${cmd} failed: ${JSON.stringify(res)}`);
        state = res.state;
      };
      step('start', mkStart(1, {
        policy: {
          value: REAL_POLICY_LINE,
          source: 'caller prompt',
          delegation: { status: 'active', parts, config: sha256('cfg'), tools },
        },
      }), '2026-11-10T18:00:00Z');
      step('record pass', mkPassStarted(10, {
        required_voices: ['maintainability', 'native-adversarial', 'red-team'],
      }), '2026-11-10T18:01:00Z');
      step('record pass', {
        pass_id: uid(10), state: 'attempt', voice_id: 'maintainability', part: 'specialist:maintainability',
        attempt_id: uid(20), outcome: 'completed',
        delegate: {
          provider: 'claude', model: 'sonnet', outcome: 'credited', fallback_reason: null, replay: false,
          wall_ms: 150, input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 20, cache_creation_input_tokens: 5, call_id: sha256('call-maint'),
        },
        findings: [{
          finding_id: 'F-MAINT', severity_source: 'P2', severity_rubric: 'specialist',
          adjudication: 'accepted', resolution: 'open', found_by: ['specialist:maintainability'],
        }],
      }, '2026-11-10T18:02:00Z');
      step('record pass', {
        pass_id: uid(10), state: 'attempt', voice_id: 'native-adversarial', part: 'native-adversarial',
        attempt_id: uid(21), outcome: 'completed',
        delegate: {
          provider: 'codex', model: 'gpt-5', outcome: 'credited', fallback_reason: null, replay: false,
          wall_ms: 210, input_tokens: 200, output_tokens: 60, cache_read_input_tokens: 30, cache_creation_input_tokens: null, call_id: sha256('call-adv'),
        },
        findings: [{
          finding_id: 'F-ADV', severity_source: 'P1', severity_rubric: 'adversarial',
          adjudication: 'accepted', resolution: 'open', found_by: ['native-adversarial'],
        }],
      }, '2026-11-10T18:03:00Z');
      step('record pass', {
        pass_id: uid(10), state: 'attempt', voice_id: 'red-team', part: 'red-team',
        attempt_id: uid(22), outcome: 'failed',
        delegate: {
          provider: 'codex', model: 'gpt-5', outcome: 'fell-back', fallback_reason: 'timeout', replay: false,
          wall_ms: 300, input_tokens: 80, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: null, call_id: sha256('call-rt'),
        },
      }, '2026-11-10T18:04:00Z');
      step('record pass', {
        pass_id: uid(10), state: 'voice-complete', voice_id: 'maintainability', selected_attempt_id: uid(20),
      }, '2026-11-10T18:05:00Z');
      step('record pass', {
        pass_id: uid(10), state: 'voice-complete', voice_id: 'native-adversarial', selected_attempt_id: uid(21),
      }, '2026-11-10T18:06:00Z');
      return state!;
    };

    const a = runSequence(partsFromLine, ['adversarial', 'red-team']);
    const b = runSequence(['specialist:maintainability', 'native-adversarial', 'red-team'], ['native-adversarial', 'red-team']);
    expect(serializeState(a)).toBe(serializeState(b));
    expect(renderDelegationPolicyLine(a.policy.delegation)).toBe(
      `delegation: active (parts=maintainability,adversarial,red-team; config=${sha256('cfg')}; tools=adversarial,red-team)`,
    );
    const linesA = FIELD_FMT.delegatedParts({ state: a } as unknown as RenderCtx);
    const linesB = FIELD_FMT.delegatedParts({ state: b } as unknown as RenderCtx);
    expect(linesA).toEqual(linesB);
    expect(linesA).toHaveLength(3);
    expect(linesA.map((l) => l.split('; ')[0])).toEqual([
      'Delegated part: maintainability',
      'Delegated part: adversarial',
      'Delegated part: red-team',
    ]);
    for (const line of linesA) expect(line.split('; ')).toHaveLength(12);

    // Two passes, each with a delegated maintainability attempt, render two Delegated part: maintainability lines in pass order
    const call1 = sha256('call-maint-pass-1');
    const call2 = sha256('call-maint-pass-2');
    const twoPassRes1 = applyCommand(a, 'record pass', mkPassStarted(11, {
      required_voices: ['maintainability'],
    }), gitInfo, env, '2026-11-10T18:07:00Z', '0.92.0');
    if (twoPassRes1.reason !== 'recorded') throw new Error(JSON.stringify(twoPassRes1));
    const twoPassRes2 = applyCommand(twoPassRes1.state, 'record pass', {
      pass_id: uid(11), state: 'attempt', voice_id: 'maintainability', part: 'specialist:maintainability',
      attempt_id: uid(23), outcome: 'completed',
      delegate: {
        provider: 'claude', model: 'sonnet', outcome: 'credited', fallback_reason: null, replay: false,
        wall_ms: 180, input_tokens: 110, output_tokens: 35, cache_read_input_tokens: 10, cache_creation_input_tokens: 0, call_id: call2,
      },
      findings: [],
    }, gitInfo, env, '2026-11-10T18:08:00Z', '0.92.0');
    if (twoPassRes2.reason !== 'recorded') throw new Error(JSON.stringify(twoPassRes2));
    const maintLines = FIELD_FMT.delegatedParts({ state: twoPassRes2.state } as unknown as RenderCtx)
      .filter((line) => line.startsWith('Delegated part: maintainability;'));
    expect(maintLines).toEqual([
      `Delegated part: maintainability; provider=claude; model=sonnet; outcome=credited; reason=none; wall_ms=150; input_tokens=100; output_tokens=40; cache_read_input_tokens=20; cache_creation_input_tokens=5; findings=1; call=${sha256('call-maint')}`,
      `Delegated part: maintainability; provider=claude; model=sonnet; outcome=credited; reason=none; wall_ms=180; input_tokens=110; output_tokens=35; cache_read_input_tokens=10; cache_creation_input_tokens=0; findings=0; call=${call2}`,
    ]);
    for (const line of maintLines) expect(line.split('; ')).toHaveLength(12);
    expect(call1).not.toBe(call2);
  });

  // Value: protects=attempt and finding cross-field validator rules and refusal atomicity; fails_when=an invalid attempt, delegate, or finding records or mutates state; why_new=Track 80A T3 attempt/finding gaps; seam=CLI and state file
  test.each([
    [
      'predecessor_attempt_id from another voice',
      () => ({
        pass_id: uid(10), state: 'attempt', voice_id: 'specialist-sec', part: 'specialist:security',
        attempt_id: uid(22), outcome: 'completed', predecessor_attempt_id: uid(20), findings: [],
      }),
      { path: 'predecessor_attempt_id', rule: 'invalid-reference', expected: 'prior-attempt-on-voice' },
    ],
    [
      'duplicate attempt_id across voices',
      () => ({
        pass_id: uid(10), state: 'attempt', voice_id: 'specialist-sec', part: 'specialist:security',
        attempt_id: uid(20), outcome: 'completed', findings: [],
      }),
      { path: 'attempt_id', rule: 'duplicate-value', expected: 'unique-attempt-id' },
    ],
    [
      'duplicate finding_id within the same attempt',
      () => ({
        pass_id: uid(10), state: 'attempt', voice_id: 'specialist-sec', part: 'specialist:security',
        attempt_id: uid(22), outcome: 'completed',
        findings: [
          { finding_id: 'F-2', severity_source: 'P1', severity_rubric: 'specialist', adjudication: 'accepted', resolution: 'open', found_by: ['specialist:security'] },
          { finding_id: 'F-2', severity_source: 'P2', severity_rubric: 'specialist', adjudication: 'accepted', resolution: 'open', found_by: ['specialist:security'] },
        ],
      }),
      { path: 'findings[1].finding_id', rule: 'duplicate-value', expected: 'unique-within-attempt' },
    ],
    [
      'attempt part disagreeing with voice part',
      () => ({
        pass_id: uid(10), state: 'attempt', voice_id: 'specialist-sec', part: 'specialist:testing',
        attempt_id: uid(22), outcome: 'completed', findings: [],
      }),
      { path: 'part', rule: 'invalid-value', expected: 'matching-voice-part:specialist:security' },
    ],
    [
      'failed attempt with credited delegate',
      () => ({
        pass_id: uid(10), state: 'attempt', voice_id: 'specialist-sec', part: 'specialist:security',
        attempt_id: uid(22), outcome: 'failed',
        delegate: { provider: 'codex', model: 'gpt-5', outcome: 'credited', fallback_reason: null, replay: false, wall_ms: 10, input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: null, call_id: sha256('del') },
      }),
      { path: 'delegate.outcome', rule: 'invalid-value', expected: 'credited-requires-completed-and-null-fallback_reason' },
    ],
    [
      'completed attempt with fell-back delegate',
      () => ({
        pass_id: uid(10), state: 'attempt', voice_id: 'specialist-sec', part: 'specialist:security',
        attempt_id: uid(22), outcome: 'completed',
        delegate: { provider: 'codex', model: 'gpt-5', outcome: 'fell-back', fallback_reason: 'timeout', replay: false, wall_ms: 10, input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: null, call_id: sha256('del') },
        findings: [],
      }),
      { path: 'delegate.outcome', rule: 'invalid-value', expected: 'fell-back-requires-failed-and-fallback_reason' },
    ],
    [
      'delegated attempt with no part',
      () => ({
        pass_id: uid(10), state: 'attempt', voice_id: 'specialist-sec', part: null,
        attempt_id: uid(22), outcome: 'completed',
        delegate: { provider: 'codex', model: 'gpt-5', outcome: 'credited', fallback_reason: null, replay: false, wall_ms: 10, input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: null, call_id: sha256('del') },
        findings: [],
      }),
      { path: 'part', rule: 'invalid-value', expected: 'part-label-required-for-delegated-attempt' },
    ],
    [
      'finding with non-empty found_by and attribution_reason',
      () => ({
        pass_id: uid(10), state: 'attempt', voice_id: 'specialist-sec', part: 'specialist:security',
        attempt_id: uid(22), outcome: 'completed',
        findings: [{ finding_id: 'F-2', severity_source: 'P1', severity_rubric: 'core', adjudication: 'accepted', resolution: 'open', found_by: ['core'], attribution_reason: 'not-reported' }],
      }),
      { path: 'findings[0].attribution_reason', rule: 'invalid-value', expected: 'null-when-found_by-nonempty' },
    ],
    [
      'finding with empty found_by and no attribution_reason',
      () => ({
        pass_id: uid(10), state: 'attempt', voice_id: 'specialist-sec', part: 'specialist:security',
        attempt_id: uid(22), outcome: 'completed',
        findings: [{ finding_id: 'F-2', severity_source: 'P1', severity_rubric: 'core', adjudication: 'accepted', resolution: 'open', found_by: [] }],
      }),
      { path: 'findings[0].attribution_reason', rule: 'invalid-enum', expected: 'not-reported|unlisted-part|unsupported' },
    ],
    [
      'rejected finding with resolution open',
      () => ({
        pass_id: uid(10), state: 'attempt', voice_id: 'specialist-sec', part: 'specialist:security',
        attempt_id: uid(22), outcome: 'completed',
        findings: [{ finding_id: 'F-2', severity_source: 'P1', severity_rubric: 'specialist', adjudication: 'rejected', resolution: 'open', found_by: ['specialist:security'] }],
      }),
      { path: 'findings[0].resolution', rule: 'invalid-value', expected: 'unknown-for-rejected-or-duplicate' },
    ],
    [
      'duplicate finding without duplicate_of',
      () => ({
        pass_id: uid(10), state: 'attempt', voice_id: 'specialist-sec', part: 'specialist:security',
        attempt_id: uid(22), outcome: 'completed',
        findings: [{ finding_id: 'F-2', severity_source: 'P1', severity_rubric: 'specialist', adjudication: 'duplicate', resolution: 'unknown', found_by: ['specialist:security'] }],
      }),
      { path: 'findings[0].duplicate_of', rule: 'invalid-value', expected: 'required-for-duplicate' },
    ],
    [
      'finding with duplicate_of equal to its own finding_id',
      () => ({
        pass_id: uid(10), state: 'attempt', voice_id: 'specialist-sec', part: 'specialist:security',
        attempt_id: uid(22), outcome: 'completed',
        findings: [{ finding_id: 'F-2', severity_source: 'P1', severity_rubric: 'specialist', adjudication: 'duplicate', resolution: 'unknown', duplicate_of: 'F-2', found_by: ['specialist:security'] }],
      }),
      { path: 'findings[0].duplicate_of', rule: 'invalid-value', expected: 'another-finding' },
    ],
    [
      'failed attempt sending findings array',
      () => ({
        pass_id: uid(10), state: 'attempt', voice_id: 'specialist-sec', part: 'specialist:security',
        attempt_id: uid(22), outcome: 'failed', findings: [],
      }),
      { path: 'findings', rule: 'invalid-value', expected: 'null-when-outcome-not-completed' },
    ],
  ])('refuses invalid attempt/finding input (%s) without mutating state', (_label, buildPayload, expectedViolation) => {
    const { attemptState } = ensureRefusalSeeds();
    const { dir, statePath, beforeBytes } = dirFromSeed(attemptState);
    const res = callCmd(dir, 'record pass', buildPayload());
    expect(res.code).toBe(1);
    expect(res.json.reason).toBe('invalid-input');
    expect(res.json.detail.violations).toContainEqual(expectedViolation);
    expect(readFileSync(statePath, 'utf8')).toBe(beforeBytes);
  });

  // Value: protects=cross-attempt finding_id acceptance and stored-state per-attempt uniqueness check; fails_when=a second voice recording F-1 is refused or fails show, or a stored attempt repeating F-1 within itself is accepted; why_new=T2; seam=applyCommand, validateStoredState, and show
  test('accepts a repeated finding_id across attempts and reads it through show while refusing a duplicate within one stored attempt as corrupt', () => {
    const { attemptState } = ensureRefusalSeeds();
    const { dir, statePath } = dirFromSeed(attemptState);
    const res = callCmd(dir, 'record pass', {
      pass_id: uid(10), state: 'attempt', voice_id: 'specialist-sec', part: 'specialist:security',
      attempt_id: uid(22), outcome: 'completed', predecessor_attempt_id: uid(21),
      findings: [{ finding_id: 'F-1', severity_source: 'P1', severity_rubric: 'specialist', adjudication: 'accepted', resolution: 'open', found_by: ['specialist:security'] }],
    });
    expect(res.code).toBe(0);
    expect(res.json.reason).toBe('recorded');
    const st = JSON.parse(readFileSync(statePath, 'utf8')) as ReviewRunState;
    expect(st.passes[0]!.voices.find((v) => v.voice_id === 'core')!.attempts[0]!.findings!.map((f) => f.finding_id)).toEqual(['F-1']);
    expect(st.passes[0]!.voices.find((v) => v.voice_id === 'specialist-sec')!.attempts[1]!.findings!.map((f) => f.finding_id)).toEqual(['F-1']);

    const showOk = runCli(['show', '--dir', dir]);
    expect(showOk.code).toBe(0);
    expect(showOk.err).toBe('');

    const corrupt = structuredClone(st);
    corrupt.passes[0]!.voices[0]!.attempts[0]!.findings!.push(structuredClone(corrupt.passes[0]!.voices[0]!.attempts[0]!.findings![0]!));
    const corruptBytes = JSON.stringify(corrupt);
    writeFileSync(statePath, corruptBytes);
    const showCorrupt = runCli(['show', '--dir', dir]);
    expect(showCorrupt.code).toBe(1);
    expect(showCorrupt.json.reason).toBe('corrupt');
    expect(showCorrupt.json.detail.message).toBe('duplicate-value at passes[0].voices[0].attempts[0].findings[1].finding_id');
    expect(readFileSync(statePath, 'utf8')).toBe(corruptBytes);
  });

  // Value: protects=voice-complete selection xor and completed-attempt-on-voice rules; fails_when=voice-complete accepts both/neither field or selects a missing, failed, or other-voice attempt; why_new=Track 80A T3 voice-selection gaps; seam=CLI and state file
  test.each([
    [
      'core with both selected_attempt_id and not_applicable',
      () => ({ pass_id: uid(10), state: 'voice-complete', voice_id: 'core', selected_attempt_id: uid(20), not_applicable: 'not-applicable' }),
      { path: 'selected_attempt_id', rule: 'invalid-value', expected: 'exactly-one-of-selected_attempt_id-or-not_applicable' },
    ],
    [
      'core with neither selected_attempt_id nor not_applicable',
      () => ({ pass_id: uid(10), state: 'voice-complete', voice_id: 'core' }),
      { path: 'selected_attempt_id', rule: 'invalid-value', expected: 'exactly-one-of-selected_attempt_id-or-not_applicable' },
    ],
    [
      'core selecting a missing attempt_id',
      () => ({ pass_id: uid(10), state: 'voice-complete', voice_id: 'core', selected_attempt_id: uid(29) }),
      { path: 'selected_attempt_id', rule: 'invalid-reference', expected: 'completed-attempt-on-voice' },
    ],
    [
      'specialist-sec selecting its failed attempt',
      () => ({ pass_id: uid(10), state: 'voice-complete', voice_id: 'specialist-sec', selected_attempt_id: uid(21) }),
      { path: 'selected_attempt_id', rule: 'invalid-reference', expected: 'completed-attempt-on-voice' },
    ],
    [
      'specialist-sec selecting core\'s completed attempt',
      () => ({ pass_id: uid(10), state: 'voice-complete', voice_id: 'specialist-sec', selected_attempt_id: uid(20) }),
      { path: 'selected_attempt_id', rule: 'invalid-reference', expected: 'completed-attempt-on-voice' },
    ],
  ])('refuses invalid voice-complete input (%s) without mutating state', (_label, buildPayload, expectedViolation) => {
    const { attemptState } = ensureRefusalSeeds();
    const { dir, statePath, beforeBytes } = dirFromSeed(attemptState);
    const res = callCmd(dir, 'record pass', buildPayload());
    expect(res.code).toBe(1);
    expect(res.json.reason).toBe('invalid-input');
    expect(res.json.detail.violations).toContainEqual(expectedViolation);
    expect(readFileSync(statePath, 'utf8')).toBe(beforeBytes);
  });

  // Value: protects=correction target lookup, linear supersedes chain, effective rejected resolution, and fixed_in commit existence; fails_when=a broken correction chain or invalid resolution/commit records; why_new=Track 80A T3 correction-chain gaps; seam=CLI and state file
  test.each([
    [
      'target finding F-9 does not exist',
      () => ({
        correction_id: uid(31),
        target: { pass_id: uid(10), voice_id: 'core', attempt_id: uid(20), finding_id: 'F-9' },
        resolution: 'fixed',
      }),
      { path: 'target', rule: 'invalid-reference', expected: 'existing-finding' },
    ],
    [
      'supersedes omitted after prior correction',
      () => ({
        correction_id: uid(31),
        target: { pass_id: uid(10), voice_id: 'core', attempt_id: uid(20), finding_id: 'F-1' },
        resolution: 'open',
      }),
      { path: 'supersedes', rule: 'invalid-reference', expected: uid(30) },
    ],
    [
      'supersedes naming unknown correction uid(39)',
      () => ({
        correction_id: uid(31),
        target: { pass_id: uid(10), voice_id: 'core', attempt_id: uid(20), finding_id: 'F-1' },
        resolution: 'open',
        supersedes: uid(39),
      }),
      { path: 'supersedes', rule: 'invalid-reference', expected: uid(30) },
    ],
    [
      'adjudication rejected inheriting prior fixed resolution',
      () => ({
        correction_id: uid(31),
        target: { pass_id: uid(10), voice_id: 'core', attempt_id: uid(20), finding_id: 'F-1' },
        adjudication: 'rejected',
        supersedes: uid(30),
      }),
      { path: 'resolution', rule: 'invalid-value', expected: 'unknown-for-rejected-or-duplicate' },
    ],
    [
      'fixed_in commit missing from Git',
      () => ({
        correction_id: uid(31),
        target: { pass_id: uid(10), voice_id: 'core', attempt_id: uid(20), finding_id: 'F-1' },
        fixed_in: sha256('missing').slice(0, 40),
        supersedes: uid(30),
      }),
      { path: 'fixed_in', rule: 'commit-not-found', expected: 'existing-git-commit' },
    ],
    [
      'adjudication rejected with resolution fixed in the same payload',
      () => ({
        correction_id: uid(31),
        target: { pass_id: uid(10), voice_id: 'core', attempt_id: uid(20), finding_id: 'F-1' },
        adjudication: 'rejected',
        resolution: 'fixed',
        supersedes: uid(30),
      }),
      { path: 'resolution', rule: 'invalid-value', expected: 'unknown-when-rejected' },
    ],
  ])('refuses invalid correction input (%s) without mutating state', (_label, buildPayload, expectedViolation) => {
    const { correctionState } = ensureRefusalSeeds();
    const { dir, statePath, beforeBytes } = dirFromSeed(correctionState);
    const res = callCmd(dir, 'record correction', buildPayload());
    expect(res.code).toBe(1);
    expect(res.json.reason).toBe('invalid-input');
    expect(res.json.detail.violations).toContainEqual(expectedViolation);
    expect(readFileSync(statePath, 'utf8')).toBe(beforeBytes);
  });

  // Value: protects=finish ancestry/commit existence and checkpoint session_id/base rules; fails_when=finish or checkpoint accepts non-ancestor or missing commits or misplaced session_id/base; why_new=Track 80A T4 finish/checkpoint gaps; seam=CLI and state file
  test.each([
    [
      'finish prepared with unrelated non-ancestor base',
      'finish',
      (unrelatedSha: string) => ({ outcome: 'prepared', base: unrelatedSha }),
      { path: 'base', rule: 'not-ancestor', expected: 'ancestor-of-head' },
    ],
    [
      'finish with missing base commit',
      'finish',
      () => ({ outcome: 'prepared', base: sha256('missing').slice(0, 40) }),
      { path: 'base', rule: 'commit-not-found', expected: 'existing-git-commit' },
    ],
    [
      'finish stopped with missing delta_base commit',
      'finish',
      () => ({ outcome: 'stopped', base: baseSha, stop_reason: 'cap', stop_count: 1, delta_base: sha256('missing').slice(0, 40) }),
      { path: 'delta_base', rule: 'commit-not-found', expected: 'existing-git-commit' },
    ],
    [
      'finish prepared with missing full_review_evidence.commit',
      'finish',
      () => ({
        outcome: 'prepared',
        base: baseSha,
        full_review_evidence: { status: 'available', commit: sha256('missing').slice(0, 40), tree: treeSha, source: 'ev://x' },
      }),
      { path: 'full_review_evidence.commit', rule: 'commit-not-found', expected: 'existing-git-commit' },
    ],
    [
      'checkpoint before-fix with non-null session_id',
      'checkpoint',
      () => ({ checkpoint_id: uid(60), kind: 'before-fix', session_id: `extend-${uid(950)}` }),
      { path: 'session_id', rule: 'invalid-value', expected: 'null-when-kind-not-resume' },
    ],
    [
      'checkpoint pause without base',
      'checkpoint',
      () => ({ checkpoint_id: uid(60), kind: 'pause' }),
      { path: 'base', rule: 'invalid-value', expected: 'required-hex40-for-external-gate-and-pause' },
    ],
    [
      'checkpoint before-fix with missing base commit',
      'checkpoint',
      () => ({ checkpoint_id: uid(60), kind: 'before-fix', base: sha256('missing').slice(0, 40) }),
      { path: 'base', rule: 'commit-not-found', expected: 'existing-git-commit' },
    ],
  ])('refuses invalid finish/checkpoint input (%s) without mutating state', (_label, cmd, buildPayload, expectedViolation) => {
    const { startState, unrelatedSha } = ensureRefusalSeeds();
    const { dir, statePath, beforeBytes } = dirFromSeed(startState);
    const res = callCmd(dir, cmd, buildPayload(unrelatedSha));
    expect(res.code).toBe(1);
    expect(res.json.reason).toBe('invalid-input');
    expect(res.json.detail.violations).toContainEqual(expectedViolation);
    expect(readFileSync(statePath, 'utf8')).toBe(beforeBytes);
  });

  // Value: protects=latestHelperTimestamp across all eight helper-stamped record kinds, millisecond precision over lexical order, and segment started_at fallback; fails_when=a record kind is skipped, string comparison beats Date.parse, or an earlier segment's timestamp leaks into a later segment; why_new=Track 80A T4 G27; seam=applyCommand
  test('interrupted end timestamp picks the latest helper-stamped record across pass started/completed, attempt, voice-complete, correction, gate, audit and checkpoint with millisecond precision and segment started_at fallback', () => {
    const gitInfo = { repo: '/fixture/.git', toplevel: '/fixture', branch: 'topic', head: headSha, tree: treeSha };
    const env = { commitExists: () => true, commitTree: () => treeSha, isAncestor: () => true, checkEvidence: () => null };
    const T_START = '2026-11-10T17:00:00Z';
    const T_BASE = '2026-11-10T18:00:00Z';
    const T_WIN = '2026-11-10T18:00:00.001Z';
    const T_RESUME = '2026-11-10T19:00:00Z';
    const T_CALLER = '2099-01-01T00:00:00Z';

    const kinds = [
      'pass-started',
      'attempt',
      'voice-complete',
      'correction',
      'gate',
      'audit',
      'checkpoint',
      'pass-completed',
    ] as const;

    for (const winner of kinds) {
      let state: ReviewRunState | null = null;
      const apply = (cmd: Parameters<typeof applyCommand>[1], input: unknown, ts: string) => {
        const res = applyCommand(state, cmd, input, gitInfo, env, ts);
        if (res.reason !== 'recorded') throw new Error(`${cmd} failed for ${winner}: ${JSON.stringify(res)}`);
        state = res.state;
      };
      const tsFor = (k: (typeof kinds)[number]) => (k === winner ? T_WIN : T_BASE);

      apply('start', mkStart(1, { session_id: `extend-${uid(901)}` }), T_START);
      apply('record pass', mkPassStarted(10, { required_voices: ['core'], started_at: T_CALLER }), tsFor('pass-started'));
      apply('record pass', {
        pass_id: uid(10), state: 'attempt', voice_id: 'core', part: 'core', attempt_id: uid(20), outcome: 'completed',
        dispatched_at: T_CALLER, returned_at: T_CALLER,
        findings: [{ finding_id: 'F-1', severity_source: 'P1', severity_rubric: 'core', adjudication: 'accepted', resolution: 'open', found_by: ['core'] }],
      }, tsFor('attempt'));
      apply('record pass', {
        pass_id: uid(10), state: 'voice-complete', voice_id: 'core', selected_attempt_id: uid(20),
      }, tsFor('voice-complete'));
      apply('record correction', {
        correction_id: uid(30),
        target: { pass_id: uid(10), voice_id: 'core', attempt_id: uid(20), finding_id: 'F-1' },
        resolution: 'fixed',
      }, tsFor('correction'));
      apply('record gate', {
        gate_id: uid(40), name: 'tests', result: 'passed', candidate: { commit: headSha, base: baseSha },
      }, tsFor('gate'));
      apply('record audit', {
        audit_id: uid(50), name: 'coverage', result: 'passed', details: { pct: 95, threshold: 80 }, candidate: { commit: headSha, base: baseSha },
      }, tsFor('audit'));
      apply('checkpoint', {
        checkpoint_id: uid(60), kind: 'before-fix',
      }, tsFor('checkpoint'));
      apply('record pass', {
        pass_id: uid(10), state: 'completed', completed_at: T_CALLER,
      }, tsFor('pass-completed'));
      apply('checkpoint', {
        checkpoint_id: uid(61), kind: 'resume', session_id: `extend-${uid(902)}`,
      }, T_RESUME);

      expect(state!.segments[0], winner).toMatchObject({
        end: 'interrupted',
        ended_at: T_WIN,
      });
    }

    // Fallback 1: start, then resume -> ended_at equals segment's started_at.
    const s1 = applyCommand(null, 'start', mkStart(1, { session_id: `extend-${uid(901)}` }), gitInfo, env, T_START);
    if (s1.reason !== 'recorded') throw new Error('start failed');
    const r1 = applyCommand(s1.state, 'checkpoint', { checkpoint_id: uid(70), kind: 'resume', session_id: `extend-${uid(902)}` }, gitInfo, env, T_RESUME);
    if (r1.reason !== 'recorded') throw new Error('resume failed');
    expect(r1.state.segments[0]).toMatchObject({
      started_at: T_START,
      ended_at: T_START,
      end: 'interrupted',
    });

    // Fallback 2: start (T0), gate (T1), pause (T2), resume (T3), then resume (T4, third session) -> segment 2 ended_at equals T3.
    const t0 = '2026-11-10T17:00:00Z';
    const t1 = '2026-11-10T17:10:00Z';
    const t2 = '2026-11-10T17:20:00Z';
    const t3 = '2026-11-10T17:30:00Z';
    const t4 = '2026-11-10T17:40:00Z';
    let st: ReviewRunState | null = null;
    for (const [cmd, input, ts] of [
      ['start', mkStart(2, { session_id: `extend-${uid(911)}` }), t0],
      ['record gate', { gate_id: uid(80), name: 'tests', result: 'passed', candidate: { commit: headSha, base: baseSha } }, t1],
      ['checkpoint', { checkpoint_id: uid(81), kind: 'pause', base: baseSha }, t2],
      ['checkpoint', { checkpoint_id: uid(82), kind: 'resume', session_id: `extend-${uid(912)}` }, t3],
      ['checkpoint', { checkpoint_id: uid(83), kind: 'resume', session_id: `extend-${uid(913)}` }, t4],
    ] as const) {
      const res = applyCommand(st, cmd, input, gitInfo, env, ts);
      if (res.reason !== 'recorded') throw new Error(`${cmd} failed`);
      st = res.state;
    }
    expect(st!.segments[1]).toMatchObject({
      segment: 2,
      started_at: t3,
      ended_at: t3,
      end: 'interrupted',
    });
  });

  test.each(['grow', 'same-size', 'delete', 'pinned-detail', 'symlink-retarget', 'replace-same-size-mtime', 'none'] as const)('rechecks evidence under lock and refuses evidence-changed (%s)', (mode) => {
    const { dir, statePath, beforeBytes } = dirFromSeed(ensureRefusalSeeds().startState);
    const fixedTime = new Date(1700000000000);
    writeFileSync(join(dir, 'ev.txt'), 'abc\n');
    writeFileSync(join(dir, 'rec.json'), '{"ok":true}\n');
    if (mode === 'symlink-retarget') {
      writeFileSync(join(dir, 'a.txt'), 'abc\n');
      writeFileSync(join(dir, 'b.txt'), 'xyz\n');
      utimesSync(join(dir, 'a.txt'), fixedTime, fixedTime);
      utimesSync(join(dir, 'b.txt'), fixedTime, fixedTime);
      symlinkSync('a.txt', join(dir, 'ev-link'));
    }
    if (mode === 'replace-same-size-mtime') {
      utimesSync(join(dir, 'ev.txt'), fixedTime, fixedTime);
      writeFileSync(join(dir, 'ev-replacement.txt'), 'xyz\n');
      utimesSync(join(dir, 'ev-replacement.txt'), fixedTime, fixedTime);
    }
    const payload = mode === 'pinned-detail'
      ? { gate_id: uid(501), name: 'pregate', result: 'passed', candidate: { commit: headSha, base: baseSha }, details: { raw_verdict: 'PASS', wrapper_verdict: 'passed', policy: 'base', record_path: 'rec.json', record_sha256: sha256('{"ok":true}\n'), skipped_lanes: [] } }
      : mode === 'symlink-retarget'
        ? { gate_id: uid(501), name: 'tests', result: 'passed', candidate: { commit: headSha, base: baseSha }, evidence: [{ path: 'ev-link', sha256: sha256('abc\n') }] }
        : { gate_id: uid(501), name: 'tests', result: 'passed', candidate: { commit: headSha, base: baseSha }, evidence: [{ path: 'ev.txt', sha256: sha256('abc\n') }] };
    const input = writeJson(dir, 'gate.json', payload);
    const lockPath = join(dir, 'review-run-state.json.lock');
    const script = `import { mock } from 'bun:test'; const fs = {...await import('node:fs')};
      const dir = ${JSON.stringify(dir)}, lock = ${JSON.stringify(lockPath)}, mode = ${JSON.stringify(mode)};
      let once = true;
      mock.module('node:fs', () => ({...fs, openSync(p, flags, ...rest) {
        if (once && String(p) === lock && flags === 'wx') {
          once = false;
          if (mode === 'grow') fs.writeFileSync(dir + '/ev.txt', 'longer-content\\n');
          if (mode === 'same-size') { const t = new Date(Date.now() + 60000); fs.writeFileSync(dir + '/ev.txt', 'xyz\\n'); fs.utimesSync(dir + '/ev.txt', t, t); }
          if (mode === 'delete') fs.unlinkSync(dir + '/ev.txt');
          if (mode === 'pinned-detail') fs.writeFileSync(dir + '/rec.json', '{"ok":false,"more":1}\\n');
          if (mode === 'symlink-retarget') { fs.unlinkSync(dir + '/ev-link'); fs.symlinkSync('b.txt', dir + '/ev-link'); }
          if (mode === 'replace-same-size-mtime') { fs.renameSync(dir + '/ev-replacement.txt', dir + '/ev.txt'); }
        }
        return fs.openSync(p, flags, ...rest);
      }}));
      const { executeCommand } = await import(${JSON.stringify(join(REPO_ROOT, 'src/review-state/store.ts'))});
      console.log(JSON.stringify(executeCommand('record gate', dir, ${JSON.stringify(input)}, ${JSON.stringify(repo)})));`;
    const r = spawnSync(process.execPath, ['--no-env-file', '--no-install', '--config=/dev/null', '-e', script], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const res = JSON.parse(r.stdout);
    if (mode === 'none') {
      expect(res).toMatchObject({ reason: 'recorded', rev: 2 });
    } else {
      expect(res.reason).toBe('invalid-input');
      expect(res.detail.violations).toEqual([{ path: 'evidence[0]', rule: 'evidence-changed', expected: 'valid-evidence-file-in-dir' }]);
      expect(readFileSync(statePath, 'utf8')).toBe(beforeBytes);
      expect(existsSync(lockPath)).toBe(false);
      expect(readdirSync(dir).filter((n) => n.startsWith('review-run-state.json.tmp-'))).toEqual([]);
    }
  });

  test('leftover temporary-file sweep skips refused commands and removes only regular matching files on recorded writes', () => {
    const { dir } = dirFromSeed(ensureRefusalSeeds().startState);
    expect(callCmd(dir, 'record pass', mkPassStarted(10)).json.reason).toBe('recorded');
    const matching = 'review-run-state.json.tmp-42-beef';
    const tmpSymlink = 'review-run-state.json.tmp-8-face';
    const nonMatching = ['review-run-state.json.tmp-12-ABCD', 'review-run-state.json.tmp-x-ab', 'review-run-state.json.tmp-1-ab.bak'];
    writeFileSync(join(dir, matching), 'stale');
    for (const f of nonMatching) writeFileSync(join(dir, f), 'keep');
    mkdirSync(join(dir, 'review-run-state.json.tmp-7-ab'));
    symlinkSync(nonMatching[0]!, join(dir, tmpSymlink));

    expect(callCmd(dir, 'record pass', mkPassStarted(10, { cycle: 2 })).json.reason).toBe('conflict');
    expect(existsSync(join(dir, matching))).toBe(true);
    expect(callCmd(dir, 'record pass', {}).json.reason).toBe('invalid-input');
    expect(existsSync(join(dir, matching))).toBe(true);

    const rec = callCmd(dir, 'checkpoint', { checkpoint_id: uid(510), kind: 'stop' });
    expect(rec.json).toMatchObject({ reason: 'recorded', detail: { warnings: ['removed 1 leftover temporary file(s)'] } });
    expect(existsSync(join(dir, matching))).toBe(false);
    for (const kept of [...nonMatching, 'review-run-state.json.tmp-7-ab', tmpSymlink]) {
      expect(existsSync(join(dir, kept))).toBe(true);
    }
  });

  test.each(['unlink-eacces', 'dir-fsync-order', 'dir-fsync-eio', 'readdir-eio', 'stat-eacces', 'lstat-enoent', 'combined-warnings'] as const)('sweep unlink failure and post-rename directory fsync ordering and failure (%s)', (mode) => {
    const { dir } = dirFromSeed(ensureRefusalSeeds().startState);
    if (mode === 'stat-eacces') {
      writeFileSync(join(dir, 'ev-prior.txt'), 'prior-ev\n');
      expect(callCmd(dir, 'record gate', {
        gate_id: uid(509), name: 'tests', result: 'passed', candidate: { commit: headSha, base: baseSha },
        evidence: [{ path: 'ev-prior.txt', sha256: sha256('prior-ev\n') }],
      }).json.reason).toBe('recorded');
    }
    const planted = join(dir, 'review-run-state.json.tmp-55-cafe');
    const removableTmp = join(dir, 'review-run-state.json.tmp-56-beef');
    if (mode === 'unlink-eacces' || mode === 'readdir-eio' || mode === 'stat-eacces' || mode === 'lstat-enoent' || mode === 'combined-warnings') {
      writeFileSync(planted, 'stale');
    }
    if (mode === 'combined-warnings') {
      writeFileSync(removableTmp, 'remove-me');
    }
    const input = writeJson(dir, 'pass.json', mkPassStarted(10));
    const script = `import { mock } from 'bun:test'; const fs = {...await import('node:fs')};
      const realDir = fs.realpathSync(${JSON.stringify(dir)}), planted = ${JSON.stringify(planted)}, mode = ${JSON.stringify(mode)};
      const lockPath = realDir + '/review-run-state.json.lock', priorEv = realDir + '/ev-prior.txt';
      const dirFds = new Set(), events = [];
      let inSweep = false;
      mock.module('node:fs', () => ({...fs,
        openSync(p, ...rest) { const fd = fs.openSync(p, ...rest); if (String(p) === realDir) dirFds.add(fd); return fd; },
        readdirSync(p, ...rest) {
          if (String(p) === realDir) {
            if (mode === 'readdir-eio') throw Object.assign(new Error('eio'), { code: 'EIO', syscall: 'scandir' });
            inSweep = true;
          }
          return fs.readdirSync(p, ...rest);
        },
        statSync(p, ...rest) {
          if (mode === 'stat-eacces' && String(p) === priorEv) throw Object.assign(new Error('eacces'), { code: 'EACCES', syscall: 'stat' });
          return fs.statSync(p, ...rest);
        },
        lstatSync(p, ...rest) {
          if (mode === 'lstat-enoent' && inSweep && String(p) === planted) {
            inSweep = false;
            fs.unlinkSync(planted);
            throw Object.assign(new Error('enoent'), { code: 'ENOENT', syscall: 'lstat' });
          }
          return fs.lstatSync(p, ...rest);
        },
        renameSync(a, b) { fs.renameSync(a, b); events.push('rename'); },
        fsyncSync(fd) {
          if (dirFds.has(fd)) {
            events.push('dir-fsync');
            if (mode === 'dir-fsync-eio' || mode === 'combined-warnings') throw Object.assign(new Error('eio'), { code: 'EIO', syscall: 'fsync' });
          }
          return fs.fsyncSync(fd);
        },
        unlinkSync(p) {
          if ((mode === 'unlink-eacces' || mode === 'combined-warnings') && String(p) === planted) throw Object.assign(new Error('eacces'), { code: 'EACCES', syscall: 'unlink' });
          if (mode === 'combined-warnings' && String(p) === lockPath) throw Object.assign(new Error('eacces'), { code: 'EACCES', syscall: 'unlink' });
          return fs.unlinkSync(p);
        },
      }));
      const { executeCommand } = await import(${JSON.stringify(join(REPO_ROOT, 'src/review-state/store.ts'))});
      console.log(JSON.stringify({ res: executeCommand('record pass', realDir, ${JSON.stringify(input)}, ${JSON.stringify(repo)}), events }));`;
    const r = spawnSync(process.execPath, ['--no-env-file', '--no-install', '--config=/dev/null', '-e', script], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const { res, events } = JSON.parse(r.stdout);
    expect(res).toMatchObject({ reason: 'recorded', rev: mode === 'stat-eacces' ? 3 : 2 });
    if (mode === 'combined-warnings') {
      expect(existsSync(join(dir, 'review-run-state.json.lock'))).toBe(true);
      unlinkSync(join(dir, 'review-run-state.json.lock'));
      expect(existsSync(removableTmp)).toBe(false);
      expect(existsSync(planted)).toBe(true);
      expect(res.detail.warnings).toEqual([
        'removed 1 leftover temporary file(s)',
        'failed to remove leftover temporary file: EACCES',
        'failed to sync directory: EIO',
        'failed to remove lock: EACCES',
      ]);
    } else {
      expect(existsSync(join(dir, 'review-run-state.json.lock'))).toBe(false);
    }
    if (mode === 'unlink-eacces') expect(res.detail.warnings).toEqual(['failed to remove leftover temporary file: EACCES']);
    if (mode === 'readdir-eio') {
      expect(res.detail.warnings).toEqual(['failed to list leftover temporary files: EIO']);
      expect(existsSync(planted)).toBe(true);
    }
    if (mode === 'stat-eacces') {
      expect(res.detail.warnings).toEqual(['skipped leftover temporary-file sweep: recorded evidence could not be resolved']);
      expect(existsSync(planted)).toBe(true);
    }
    if (mode === 'lstat-enoent') {
      expect(res.detail.warnings).toBeUndefined();
      expect(existsSync(planted)).toBe(false);
    }
    if (mode === 'dir-fsync-order') {
      expect(res.detail.warnings).toBeUndefined();
      expect(events).toEqual(['rename', 'dir-fsync']);
    }
    if (mode === 'dir-fsync-eio') expect(res.detail.warnings).toEqual(['failed to sync directory: EIO']);
  });

  test('command --help prints valid JSON examples for every shape, valid CLI examples for show/export, and REQUEST_EXAMPLES record in sequence', () => {
    const checkShapeHelp = (argv: string[], key: string, shape: { required: readonly string[]; optional: Record<string, unknown> }, expectedEx: unknown) => {
      const out = runCli(argv).out;
      const sec = out.split('\n\n').find((b) => b.startsWith(`${key}:\n`));
      expect(sec, key).toBeDefined();
      const exLines = sec!.split('\n').filter((l) => l.startsWith('  Example: '));
      expect(exLines.length, key).toBe(1);
      const parsed = JSON.parse(exLines[0]!.slice('  Example: '.length));
      const allowed = new Set([...shape.required, ...Object.keys(shape.optional)]);
      for (const req of shape.required) expect(req in parsed, `${key}.${req}`).toBe(true);
      for (const k of Object.keys(parsed)) expect(allowed.has(k), `${key}.${k}`).toBe(true);
      expect(parsed).toEqual(expectedEx);
    };

    for (const [key, shape] of Object.entries(REQUEST_SHAPES)) {
      const cmd = key.startsWith('record pass') ? ['record', 'pass'] : key.split(' ');
      checkShapeHelp([...cmd, '--help'], key, shape, REQUEST_EXAMPLES[key as keyof typeof REQUEST_SHAPES]);
    }
    for (const [key, shape] of Object.entries(RENDER_SHAPES)) {
      checkShapeHelp(['render', '--help'], key, shape, RENDER_EXAMPLES[key as keyof typeof RENDER_SHAPES]);
    }
    expect(runCli(['record', '--help']).out.match(/^ {2}Example: /gm)?.length).toBe(8);
    expect(runCli(['render', '--help']).out.match(/^ {2}Example: /gm)?.length).toBe(4);

    for (const [cmd, allowedFlags] of [['show', new Set(['--dir', '--base', '--wtree'])], ['export', new Set(['--dir'])]] as const) {
      const exLines = runCli([cmd, '--help']).out.split('\n').filter((l) => l.startsWith('  Example: '));
      expect(exLines.length).toBe(1);
      const prefix = `  Example: bin/review-state ${cmd} `;
      expect(exLines[0]!.startsWith(prefix)).toBe(true);
      const tokens = exLines[0]!.slice(prefix.length).split(' ');
      expect(tokens.length % 2).toBe(0);
      const seen = new Map<string, string>();
      for (let i = 0; i < tokens.length; i += 2) {
        expect(allowedFlags.has(tokens[i]!)).toBe(true);
        expect(seen.has(tokens[i]!)).toBe(false);
        seen.set(tokens[i]!, tokens[i + 1]!);
      }
      expect(isAbsolute(seen.get('--dir') ?? '')).toBe(true);
      if (seen.has('--base')) expect(HEX40_RE.test(seen.get('--base')!)).toBe(true);
      if (seen.has('--wtree')) expect(WTREE_RE.test(seen.get('--wtree')!)).toBe(true);
    }

    const stubGit: GitInfo = {
      toplevel: '/repo', repo: '/repo/.git', branch: 'main',
      head: '0123456789abcdef0123456789abcdef01234567', tree: 'fedcba9876543210fedcba9876543210fedcba98',
    };
    const stubEnv: EnvChecker = {
      commitExists: () => true, commitTree: () => stubGit.tree, isAncestor: () => true, checkEvidence: () => null,
    };
    let state: ReviewRunState | null = null;
    for (const [key, example] of Object.entries(REQUEST_EXAMPLES)) {
      const cmd = (key.startsWith('record pass') ? 'record pass' : key) as CommandName;
      const out = applyCommand(state, cmd, example, stubGit, stubEnv, '2026-11-10T18:10:00Z', '0.93.2');
      expect(out.reason, key).toBe('recorded');
      if (out.reason === 'recorded') state = out.state;
    }
    expect(validateStoredState(JSON.parse(serializeState(state!)), '/tmp/review-run-state.json', '0.93.2').ok).toBe(true);
  });

  test.each(['tmp-write', 'tmp-fsync', 'rename', 'lock-remove'] as const)('store write/fsync/rename faults roll back cleanly and lock-remove fault records with warning (%s)', (mode) => {
    const { dir, statePath, beforeBytes } = dirFromSeed(ensureRefusalSeeds().startState);
    const input = writeJson(dir, 'pass.json', mkPassStarted(10));
    const lockPath = join(dir, 'review-run-state.json.lock');
    const script = `import { mock } from 'bun:test'; const fs = {...await import('node:fs')};
      const mode = ${JSON.stringify(mode)}, lock = ${JSON.stringify(lockPath)};
      const tmpFds = new Set(); let capturedTmp = '';
      mock.module('node:fs', () => ({...fs,
        openSync(p, ...rest) {
          const fd = fs.openSync(p, ...rest);
          if (String(p).includes('review-run-state.json.tmp-')) { tmpFds.add(fd); capturedTmp = String(p); }
          return fd;
        },
        writeSync(fd, ...rest) {
          if (mode === 'tmp-write' && tmpFds.has(fd)) throw Object.assign(new Error('enospc'), { code: 'ENOSPC', syscall: 'write' });
          return fs.writeSync(fd, ...rest);
        },
        fsyncSync(fd) {
          if (mode === 'tmp-fsync' && tmpFds.has(fd)) throw Object.assign(new Error('eio'), { code: 'EIO', syscall: 'fsync' });
          return fs.fsyncSync(fd);
        },
        renameSync(a, b) {
          if (mode === 'rename' && String(a).includes('review-run-state.json.tmp-')) throw Object.assign(new Error('exdev'), { code: 'EXDEV', syscall: 'rename' });
          return fs.renameSync(a, b);
        },
        unlinkSync(p) {
          if (mode === 'lock-remove' && String(p) === lock) throw Object.assign(new Error('eacces'), { code: 'EACCES', syscall: 'unlink' });
          return fs.unlinkSync(p);
        },
      }));
      const { executeCommand } = await import(${JSON.stringify(join(REPO_ROOT, 'src/review-state/store.ts'))});
      console.log(JSON.stringify({ res: executeCommand('record pass', ${JSON.stringify(dir)}, ${JSON.stringify(input)}, ${JSON.stringify(repo)}), capturedTmp }));`;
    const r = spawnSync(process.execPath, ['--no-env-file', '--no-install', '--config=/dev/null', '-e', script], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const { res, capturedTmp } = JSON.parse(r.stdout);
    if (mode === 'lock-remove') {
      expect(res).toMatchObject({ reason: 'recorded', rev: 2, detail: { warnings: ['failed to remove lock: EACCES'] } });
      expect(existsSync(lockPath)).toBe(true);
      unlinkSync(lockPath);
    } else {
      const expected = mode === 'tmp-write' ? { errno: 'ENOSPC', syscall: 'write' } : mode === 'tmp-fsync' ? { errno: 'EIO', syscall: 'fsync' } : { errno: 'EXDEV', syscall: 'rename' };
      expect(res.exitCode).toBe(3);
      expect(res.reason).toBe('unwritable');
      expect(res.detail).toEqual({ ...expected, path: capturedTmp.slice(0, 80) });
      expect(readFileSync(statePath, 'utf8')).toBe(beforeBytes);
      expect(existsSync(lockPath)).toBe(false);
      expect(readdirSync(dir).filter((n) => n.startsWith('review-run-state.json.tmp-'))).toEqual([]);
      expect(runCli(['record', 'pass', '--dir', dir, '--input', input]).json).toMatchObject({ reason: 'recorded', rev: 2 });
    }
  });

  test('VERSION guard rejects a directory and a 129-byte file while accepting a 128-byte file', () => {
    const vDir = join(baseTmp, 'ver-dir');
    mkdirSync(vDir, { recursive: true });
    const v129 = join(baseTmp, 'ver-129');
    writeFileSync(v129, `1.2.3${' '.repeat(123)}\n`);
    const v128 = join(baseTmp, 'ver-128');
    writeFileSync(v128, `1.2.3${' '.repeat(122)}\n`);
    expect(statSync(v129).size).toBe(129);
    expect(statSync(v128).size).toBe(128);

    expect(readHelperVersion(vDir)).toBeNull();
    expect(readHelperVersion(v129)).toBeNull();
    expect(readHelperVersion(v128)).toBe('1.2.3');
    expect(runCli(['--version'], { versionPath: vDir }).out).toBe('review-state unknown\n');
    expect(runCli(['--version'], { versionPath: v129 }).out).toBe('review-state unknown\n');

    const d = newDir();
    const res = callCmd(d, 'start', mkStart(1), { versionPath: v129 });
    expect(res.json.helper_version).toBeNull();
    expect((JSON.parse(readFileSync(join(d, 'review-run-state.json'), 'utf8')) as ReviewRunState).writer).toBeNull();
  });

  test.each([
    ['start', (d: string, f: string) => ['start', '--dir', d, '--dir', d, '--input', f], 'duplicate --dir flag', true],
    ['start', (d: string, f: string) => ['start', '--dir', d, '--input', f, '--input', f], 'duplicate --input flag', true],
    ['start', (_d: string, f: string) => ['start', '--input', f, '--dir'], '--dir requires a value', false],
    ['start', (d: string) => ['start', '--dir', d, '--input'], '--input requires a value', true],
    ['start', (d: string, f: string) => ['start', '--dir', d, '--input', f, '--force'], 'unknown argument --force', true],
    ['start', (d: string, f: string) => ['start', '--dir', d, '--input', f, '--base', 'a'.repeat(40)], 'start does not accept --base', true],
    ['start', (d: string, f: string) => ['start', '--dir', d, '--input', f, '--wtree', 'wt:x'], 'start does not accept --wtree', true],
    ['start', (d: string) => ['start', '--dir', d], '--input is required', true],
    ['render', (d: string, f: string) => ['render', '--dir', d, '--dir', d, '--input', f], 'duplicate --dir flag', true],
    ['render', (d: string, f: string) => ['render', '--dir', d, '--input', f, '--input', f], 'duplicate --input flag', true],
    ['render', (d: string) => ['render', '--dir', d, '--input'], '--input requires a value', true],
    ['render', (d: string, f: string) => ['render', '--dir', d, '--input', f, '--force'], 'unknown argument --force', true],
    ['render', (d: string, f: string) => ['render', '--dir', d, '--input', f, '--base', 'a'.repeat(40)], 'render does not accept --base', true],
    ['render', (d: string, f: string) => ['render', '--dir', d, '--input', f, '--wtree', 'wt:x'], 'render does not accept --wtree', true],
    ['show', (d: string) => ['show', '--dir', d, '--dir', d], 'duplicate --dir flag', true],
    ['show', (d: string) => ['show', '--dir', d, '--base', 'a'.repeat(40), '--base', 'a'.repeat(40)], 'duplicate --base flag', true],
    ['show', (d: string) => ['show', '--dir', d, '--wtree', 'wt:a', '--wtree', 'wt:b'], 'duplicate --wtree flag', true],
    ['show', (d: string) => ['show', '--dir', d, '--base'], '--base requires a value', true],
    ['show', (d: string) => ['show', '--dir', d, '--wtree'], '--wtree requires a value', true],
    ['show', (d: string) => ['show', '--dir', d, '--force'], 'unknown argument --force', true],
    ['show', () => ['show'], '--dir is required', false],
  ] as const)('CLI flag refusal for %s (%#)', (command, mkArgv, message, hasDir) => {
    const d = newDir();
    const f = writeJson(d, 'in.json', {});
    const beforeFiles = readdirSync(d);
    const usageFix = REASON_TABLE.find((r) => r.reason === 'usage')!.fix;
    const res = runCli(mkArgv(d, f));
    expect(res.code).toBe(2);
    expect(res.json).toEqual({
      v: 1,
      command,
      status: 'usage',
      reason: 'usage',
      detail: { message },
      fix: usageFix,
      state_path: hasDir ? join(d, 'review-run-state.json') : null,
      rev: null,
      helper_version: readHelperVersion(),
      side_effects: 'none',
      retry: 'after-fix',
      retry_after_ms: null,
    });
    expect(res.err).toBe(`ERROR USAGE: ${message}\nFIX: ${usageFix}\n`);
    expect(readdirSync(d)).toEqual(beforeFiles);
  });

  test('show projects open voices, correction chains, latest-by-first-seen gates/audits, tampered implicit evidence, and rendered file filtering/sorting', () => {
    const d = newDir();
    writeFileSync(join(d, 'pregate-record.json'), '{"verdict":"pass"}\n');
    writeFileSync(join(d, 'doc-section.md'), 'doc ok\n');
    callCmd(d, 'start', mkStart(1));
    callCmd(d, 'record pass', mkPassStarted(10, { required_voices: ['core', 'specialist-sec', 'qa'] }));
    callCmd(d, 'record pass', {
      pass_id: uid(10), state: 'attempt', voice_id: 'core', part: 'core', attempt_id: uid(20), outcome: 'completed',
      findings: [
        { finding_id: 'F-1', severity_source: 'P1', severity_rubric: 'core', adjudication: 'accepted', resolution: 'open', found_by: ['core'] },
        { finding_id: 'F-2', severity_source: 'P2', severity_rubric: 'core', adjudication: 'accepted', resolution: 'open', found_by: ['core'] },
        { finding_id: 'F-3', severity_source: 'P3', severity_rubric: 'core', adjudication: 'accepted', resolution: 'open', found_by: ['core'] },
        { finding_id: 'F-4', severity_source: 'P2', severity_rubric: 'core', adjudication: 'accepted', resolution: 'open', found_by: ['core'] },
        { finding_id: 'F-5', severity_source: 'P3', severity_rubric: 'core', adjudication: 'accepted', resolution: 'open', found_by: ['core'] },
      ],
    });
    callCmd(d, 'record pass', { pass_id: uid(10), state: 'voice-complete', voice_id: 'core', selected_attempt_id: uid(20) });
    callCmd(d, 'record pass', { pass_id: uid(10), state: 'attempt', voice_id: 'specialist-sec', part: 'specialist:security', attempt_id: uid(21), outcome: 'failed' });

    const tgt = (fid: string) => ({ pass_id: uid(10), voice_id: 'core', attempt_id: uid(20), finding_id: fid });
    callCmd(d, 'record correction', { correction_id: uid(31), target: tgt('F-1'), resolution: 'fixed', fixed_in: headSha });
    callCmd(d, 'record correction', { correction_id: uid(32), target: tgt('F-2'), adjudication: 'rejected', resolution: 'unknown' });
    callCmd(d, 'record correction', { correction_id: uid(33), target: tgt('F-3'), receipt_class: 'test-gap-recorded' });
    callCmd(d, 'record correction', { correction_id: uid(34), target: tgt('F-4'), resolution: 'fixed', fixed_in: headSha });
    callCmd(d, 'record correction', { correction_id: uid(35), target: tgt('F-4'), resolution: 'open', supersedes: uid(34) });

    const cand = { commit: headSha, base: baseSha };
    callCmd(d, 'record gate', { gate_id: uid(41), name: 'tests', result: 'passed', candidate: cand });
    callCmd(d, 'record gate', {
      gate_id: uid(42), name: 'pregate', result: 'passed', candidate: cand,
      details: { raw_verdict: 'PASS', wrapper_verdict: 'passed', policy: 'base', record_path: 'pregate-record.json', record_sha256: sha256('{"verdict":"pass"}\n'), skipped_lanes: [] },
    });
    callCmd(d, 'record gate', { gate_id: uid(43), name: 'tests', result: 'failed', candidate: cand });

    callCmd(d, 'record audit', { audit_id: uid(51), name: 'coverage', result: 'passed', details: { pct: 95, threshold: 90 }, candidate: cand });
    callCmd(d, 'record audit', {
      audit_id: uid(52), name: 'documentation', result: 'passed',
      details: { report_id: 'doc-1', section_path: 'doc-section.md', section_sha256: sha256('doc ok\n') }, candidate: cand,
    });
    callCmd(d, 'record audit', { audit_id: uid(53), name: 'coverage', result: 'failed', details: { pct: 50, threshold: 90 }, candidate: cand });

    writeFileSync(join(d, 'pregate-record.json'), '{"verdict":"tampered"}\n');
    writeFileSync(join(d, 'doc-section.md'), 'tampered doc\n');

    const included = ['comment-receipt-1.md', 'comment-paused-2.md', 'comment-stopped-1.md', 'final-3.md', 'pr-body-1.md', 'full-receipt-2.md', 'full-receipt-10.md'];
    for (const f of included) writeFileSync(join(d, f), `body:${f}\n`);
    for (const f of ['full-receipt-0.md', 'final-01.md', 'notes.md', 'pr-body-1.md.bak']) writeFileSync(join(d, f), 'excluded\n');
    mkdirSync(join(d, 'final-9.md'));
    const outsideFile = join(baseTmp, 'outside-rendered.md');
    writeFileSync(outsideFile, 'outside\n');
    symlinkSync(outsideFile, join(d, 'comment-receipt-5.md'));

    const s = runCli(['show', '--dir', d]).json;
    expect(s.passes[0].voices).toEqual([
      { voice_id: 'core', required: true, status: 'selected' },
      { voice_id: 'specialist-sec', required: true, status: 'open' },
      { voice_id: 'qa', required: true, status: 'open' },
    ]);
    expect(s.unresolved).toEqual(['F-4 P2', 'F-5 P3']);
    expect(s.gates.map((g: { name: string; result: string; evidence_ok: boolean }) => [g.name, g.result, g.evidence_ok])).toEqual([
      ['tests', 'failed', true],
      ['pregate', 'passed', false],
    ]);
    expect(s.audits.map((a: { name: string; result: string; evidence_ok: boolean }) => [a.name, a.result, a.evidence_ok])).toEqual([
      ['coverage', 'failed', true],
      ['documentation', 'passed', false],
    ]);
    const expectedOrder = ['comment-paused-2.md', 'comment-receipt-1.md', 'comment-stopped-1.md', 'final-3.md', 'full-receipt-2.md', 'full-receipt-10.md', 'pr-body-1.md'];
    expect(s.rendered).toEqual(expectedOrder.map((path) => ({ path, sha256: sha256(`body:${path}\n`) })));
  });

  test('show returns empty rendered list when directory enumeration throws EIO', () => {
    const { dir } = dirFromSeed(ensureRefusalSeeds().startState);
    writeFileSync(join(dir, 'full-receipt-1.md'), 'receipt\n');
    const script = `import { mock } from 'bun:test'; const fs = {...await import('node:fs')};
      const realDir = fs.realpathSync(${JSON.stringify(dir)});
      mock.module('node:fs', () => ({...fs, readdirSync(p, ...rest) {
        if (String(p) === realDir) throw Object.assign(new Error('eio'), { code: 'EIO', syscall: 'scandir' });
        return fs.readdirSync(p, ...rest);
      }}));
      const { executeShow } = await import(${JSON.stringify(join(REPO_ROOT, 'src/review-state/show.ts'))});
      console.log(JSON.stringify(executeShow(realDir, ${JSON.stringify(repo)})));`;
    const r = spawnSync(process.execPath, ['--no-env-file', '--no-install', '--config=/dev/null', '-e', script], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const res = JSON.parse(r.stdout);
    expect(res.ok).toBe(true);
    expect(res.showDoc.rendered).toEqual([]);
  });

  // Value: protects=legacy evidence retention; fails_when=sweep deletes a referenced target; why_new=orphan tests never name live refs; seam=CLI.
  test.each(['explicit', 'pregate', 'documentation', 'checkpoint', 'finish'] as const)('sweep preserves legacy recorded evidence (%s)', (kind) => {
    const { dir } = dirFromSeed(ensureRefusalSeeds().startState);
    const evidenceName = 'review-run-state.json.tmp-42-beef';
    writeFileSync(join(dir, 'evidence.txt'), 'retained evidence\n');
    symlinkSync('evidence.txt', join(dir, 'evidence-link'));
    const ev = { path: 'evidence-link', sha256: sha256('retained evidence\n') }, candidate = { commit: headSha, base: baseSha };
    let cmd = 'record gate', payload: Record<string, unknown> = { gate_id: uid(601), name: 'tests', result: 'passed', candidate, evidence: [ev] };
    if (kind === 'pregate') payload = { gate_id: uid(601), name: 'pregate', result: 'passed', candidate, details: { raw_verdict: 'PASS', wrapper_verdict: 'passed', policy: 'base', record_path: ev.path, record_sha256: ev.sha256, skipped_lanes: [] } };
    if (kind === 'documentation') { cmd = 'record audit'; payload = { audit_id: uid(601), name: 'documentation', result: 'passed', candidate, details: { report_id: 'doc-1', section_path: ev.path, section_sha256: ev.sha256 } }; }
    if (kind === 'checkpoint') { cmd = 'checkpoint'; payload = { checkpoint_id: uid(601), kind: 'stop', evidence: [ev] }; }
    if (kind === 'finish') {
      cmd = 'finish';
      payload = { outcome: 'blocked', stop_reason: 'fixture', base: baseSha, evidence: [ev] };
      linkSync(join(dir, 'evidence.txt'), join(dir, 'review-run-state.json.tmp-45-cafe'));
    }
    expect(callCmd(dir, cmd, payload, { file: 'live-input.json' }).json.reason).toBe('recorded');
    if (kind === 'finish') {
      expect(existsSync(join(dir, 'review-run-state.json.tmp-45-cafe'))).toBe(true);
      expect(readFileSync(join(dir, 'review-run-state.json.tmp-45-cafe'), 'utf8')).toBe('retained evidence\n');
    }
    unlinkSync(join(dir, 'evidence-link')); symlinkSync(evidenceName, join(dir, 'evidence-link'));
    writeFileSync(join(dir, evidenceName), 'retained evidence\n');
    if (kind === 'explicit') {
      linkSync(join(dir, evidenceName), join(dir, 'review-run-state.json.tmp-46-babe'));
    }
    expect(runCli([...cmd.split(' '), '--dir', dir, '--input', join(dir, 'live-input.json')]).json.reason).toBe('replayed');
    if (kind !== 'finish') {
      writeFileSync(join(dir, 'review-run-state.json.tmp-44-dead'), 'orphan');
      expect(callCmd(dir, 'checkpoint', { checkpoint_id: uid(602), kind: 'stop' }).json.detail.warnings).toEqual(['removed 1 leftover temporary file(s)']);
      expect(readFileSync(join(dir, evidenceName), 'utf8')).toBe('retained evidence\n');
      if (kind === 'explicit') {
        expect(existsSync(join(dir, 'review-run-state.json.tmp-46-babe'))).toBe(true);
        expect(readFileSync(join(dir, 'review-run-state.json.tmp-46-babe'), 'utf8')).toBe('retained evidence\n');
      }
    }
  });
  test('helper temporary names refuse new input and evidence without deleting either file', () => {
    const { dir, statePath, beforeBytes } = dirFromSeed(ensureRefusalSeeds().startState);
    const name = 'review-run-state.json.tmp-43-cafe', path = join(dir, name);
    const inRes = callCmd(dir, 'checkpoint', { checkpoint_id: uid(603), kind: 'stop' }, { file: name });
    expect(inRes.code).toBe(2);
    expect(inRes.json).toMatchObject({ reason: 'usage', detail: { message: '--input must not use helper temporary-file names' } });
    for (const [idx, nearMiss] of ['review-run-state.json.tmp-1-ab.bak', 'x-review-run-state.json.tmp-1-ab'].entries()) {
      expect(callCmd(dir, 'checkpoint', { checkpoint_id: uid(650 + idx), kind: 'stop' }, { file: nearMiss }).json.reason).toBe('recorded');
    }
    const afterNearMissBytes = readFileSync(statePath, 'utf8');
    writeFileSync(path, 'evidence'); symlinkSync(name, join(dir, 'alias'));
    for (const evPath of [name, 'alias']) {
      const r = callCmd(dir, 'record gate', { gate_id: uid(604), name: 'tests', result: 'passed', candidate: { commit: headSha, base: baseSha }, evidence: [{ path: evPath, sha256: sha256('evidence') }] });
      expect(r.json.detail.violations).toEqual([{ path: 'evidence[0]', rule: 'evidence-reserved-path', expected: 'valid-evidence-file-in-dir' }]);
      expect(readFileSync(path, 'utf8')).toBe('evidence'); expect(readFileSync(statePath, 'utf8')).toBe(afterNearMissBytes);
    }
    expect(beforeBytes).not.toBe(afterNearMissBytes);
  });

  // Value: protects=regression coverage across all six observed invalid-input causes (C1–C6) from the seven opted-in factory runs; fails_when=a fixed legitimate payload (C1, C5, C6) is refused or fails to replay, or a rightly refused caller error (C2, C3, C4) records or drops its violation/message; why_new=reliability Track T3(a) end-to-end evidence replay table; seam=CLI and state file
  test('replays each observed run-state invalid-input payload from the reliability Track evidence', () => {
    const planObj = { ref: 'docs/plan.md', sha256: sha256('plan-bytes') };
    const cases: Array<{
      id: string;
      cmd: 'start' | 'record pass';
      setup?: (dir: string) => void;
      payload: Record<string, unknown>;
      expectReason: 'recorded' | 'invalid-input';
      verify: (dir: string, res: ReturnType<typeof callCmd>, inputFile: string) => void;
    }> = [
      {
        id: 'C1-78a',
        cmd: 'start',
        payload: {
          run_id: uid(701),
          base: baseSha,
          plan: planObj,
          policy: {
            value: REAL_POLICY_LINE,
            source: 'caller prompt',
            delegation: {
              status: 'active',
              parts: ['maintainability', 'adversarial', 'red-team'],
              config: sha256('78a-cfg'),
              tools: [],
            },
          },
          continuation: { prior_stops: 0, max: 1, continues: null },
          session_id: `extend-${uid(978)}`,
          pr: null,
          gh_login: 'kbitz',
        },
        expectReason: 'recorded',
        verify: (dir) => {
          const stored = JSON.parse(readFileSync(join(dir, 'review-run-state.json'), 'utf8')) as ReviewRunState;
          expect(stored.policy.delegation).toEqual({
            status: 'active',
            parts: ['specialist:maintainability', 'native-adversarial', 'red-team'],
            config: sha256('78a-cfg'),
            tools: [],
          });
        },
      },
      {
        id: 'C1-80b',
        cmd: 'start',
        payload: {
          run_id: uid(702),
          base: baseSha,
          plan: planObj,
          policy: {
            value: REAL_POLICY_LINE,
            source: 'caller prompt',
            delegation: {
              status: 'active',
              parts: ['adversarial', 'red-team'],
              config: sha256('80b-cfg'),
              tools: [],
            },
          },
          continuation: { prior_stops: 0, max: 1, continues: null },
          session_id: `extend-${uid(980)}`,
          pr: null,
          gh_login: 'kbitz',
        },
        expectReason: 'recorded',
        verify: (dir) => {
          const stored = JSON.parse(readFileSync(join(dir, 'review-run-state.json'), 'utf8')) as ReviewRunState;
          expect(stored.policy.delegation).toEqual({
            status: 'active',
            parts: ['native-adversarial', 'red-team'],
            config: sha256('80b-cfg'),
            tools: [],
          });
        },
      },
      {
        id: 'C2+C3-79a',
        cmd: 'start',
        payload: {
          run_id: uid(703),
          base: baseSha,
          plan: planObj,
          policy: {
            value: REAL_POLICY_LINE,
            source: 'caller prompt',
            delegation: `delegation: active (parts=maintainability,adversarial,red-team; config=${sha256('79a-cfg')})`,
          },
          continuation: { count: 0, max: 1 },
          session_id: null,
          pr: null,
          gh_login: 'kbitz',
        },
        expectReason: 'invalid-input',
        verify: (dir, res) => {
          expect(res.json.detail.violations).toContainEqual({
            path: 'policy.delegation',
            rule: 'invalid-type',
            expected: 'object|null',
          });
          expect(res.json.detail.violations).toContainEqual({
            path: 'continuation.prior_stops',
            rule: 'missing-key',
            expected: 'prior_stops',
          });
          expect(res.json.detail.violations).toContainEqual({
            path: 'continuation.count',
            rule: 'unknown-key',
            expected: 'no unknown keys',
          });
          expect(res.json.detail.message).toBeUndefined();
          expect(existsSync(join(dir, 'review-run-state.json'))).toBe(false);
        },
      },
      {
        id: 'C4-secret-scanner',
        cmd: 'start',
        payload: {
          run_id: uid(704),
          base: baseSha,
          wtree: sha256('4e1309bc-wtree').slice(0, 40),
          pr: {
            url: 'https://github.com/kbitz/gstack-extend/pull/248',
            repo: 'kbitz/gstack-extend',
            number: 248,
            head_repo: 'kbitz/gstack-extend',
            head_branch: 'feature/4e1309bc',
            base_ref: 'main',
          },
          plan: planObj,
          policy: {
            value: 'review-and-prep-policy/v1; in-cap=full; continuation=full; documentation-audit=final; full-suite=external; final-gate-repair=tests-docs; parent-io=lean; delegate=maintainability,adversarial,red-team; test-gaps=record; blocking=shown; post-audit=classify; run-state=record; max-continuations=1',
            source: 'user decision',
            delegation: {
              status: 'active',
              parts: ['specialist:maintainability', 'native-adversarial', 'red-team'],
              config: sha256('4e1309bc-cfg'),
              tools: [],
            },
          },
          continuation: { prior_stops: 1, max: 1 },
          gh_login: 'kbitz',
          session_id: `extend-${uid(948)}`,
        },
        expectReason: 'invalid-input',
        verify: (dir, res) => {
          expect(res.json.detail.violations).toContainEqual({
            path: 'continuation.continues',
            rule: 'invalid-value',
            expected: 'required-when-prior_stops>=1',
          });
          expect(res.json.detail.message).toContain('{prior_stops, max, continues}');
          expect(existsSync(join(dir, 'review-run-state.json'))).toBe(false);
        },
      },
      {
        id: 'C5-81a',
        cmd: 'record pass',
        setup: (dir) => {
          expect(callCmd(dir, 'start', mkStart(705)).json.reason).toBe('recorded');
        },
        payload: {
          pass_id: uid(810),
          state: 'started',
          scope: 'local',
          cycle: 1,
          coverage: 'full',
          candidate: { commit: headSha, base: baseSha },
          required_voices: [
            'core',
            'testing',
            'maintainability',
            'security',
            'simplification',
            'red-team',
            'adversarial',
            'outside-challenge',
            'outside-structured',
            'qa',
          ],
        },
        expectReason: 'recorded',
        verify: (dir, res, inputFile) => {
          const stored = JSON.parse(readFileSync(join(dir, 'review-run-state.json'), 'utf8')) as ReviewRunState;
          expect(stored.passes[0]!.started_at).toBe(res.json.detail.recorded_at);
          expect(runCli(['record', 'pass', '--dir', dir, '--input', inputFile]).json.reason).toBe('replayed');
        },
      },
      {
        id: 'C6-80a-base',
        cmd: 'record pass',
        setup: (dir) => {
          expect(callCmd(dir, 'start', mkStart(706)).json.reason).toBe('recorded');
          expect(callCmd(dir, 'record pass', mkPassStarted(806, {
            required_voices: ['core', 'native-adversarial'],
          })).json.reason).toBe('recorded');
        },
        payload: {
          pass_id: uid(806),
          state: 'attempt',
          voice_id: 'native-adversarial',
          part: 'native-adversarial',
          attempt_id: uid(807),
          outcome: 'completed',
          dispatched_at: '2026-11-14T05:34:07.339Z',
          returned_at: '2026-11-14T05:37:07.311Z',
          delegate: {
            provider: 'claude-1',
            model: 'claude-opus-5-5',
            outcome: 'credited',
            fallback_reason: null,
            replay: false,
            wall_ms: 179972,
            input_tokens: 2,
            output_tokens: 18509,
            cache_read_input_tokens: 658,
            cache_creation_input_tokens: 38743,
            call_id: sha256('80a-base-adv-call'),
          },
          findings: [
            {
              finding_id: 'adv-alias-specialist',
              severity_source: 'INFORMATIONAL',
              severity_rubric: 'adversarial',
              adjudication: 'rejected',
              resolution: 'unknown',
              found_by: ['native-adversarial'],
            },
          ],
        },
        expectReason: 'recorded',
        verify: (dir, _res, inputFile) => {
          const stored = JSON.parse(readFileSync(join(dir, 'review-run-state.json'), 'utf8')) as ReviewRunState;
          const voice = stored.passes[0]!.voices.find((vo) => vo.voice_id === 'native-adversarial')!;
          expect(voice.attempts[0]!.findings![0]!.severity_source).toBe('info');
          expect(runCli(['record', 'pass', '--dir', dir, '--input', inputFile]).json.reason).toBe('replayed');
        },
      },
    ];

    for (const row of cases) {
      const dir = newDir();
      row.setup?.(dir);
      const fileName = `${row.id}.json`;
      const res = callCmd(dir, row.cmd, row.payload, { file: fileName });
      expect(res.json.reason, row.id).toBe(row.expectReason);
      row.verify(dir, res, join(dir, fileName));
    }
  });

  // Value: protects=helper timestamp stamping and replay semantics when started_at or completed_at is omitted or null; fails_when=omitted or null timestamps fail to record, fail to match on replay, fail to conflict when an omitted pass is re-sent with a different explicit timestamp, or accept malformed timestamps; why_new=reliability Track T1/T3(b); seam=CLI and state file
  test('record pass stamps omitted started_at and completed_at and replays without them', () => {
    const d = newDir();
    expect(callCmd(d, 'start', mkStart(710)).json.reason).toBe('recorded');

    // Omitted started_at and explicit null both stamp recorded_at and replay cleanly.
    const startedOmitted = {
      pass_id: uid(711),
      state: 'started',
      scope: 'local',
      cycle: 1,
      coverage: 'full',
      candidate: { commit: headSha, base: baseSha },
      required_voices: ['core'],
    };
    const rStart = callCmd(d, 'record pass', startedOmitted, { file: 'pass-started-omitted.json' });
    expect(rStart.json.reason).toBe('recorded');
    const stateAfterStart = JSON.parse(readFileSync(join(d, 'review-run-state.json'), 'utf8')) as ReviewRunState;
    expect(stateAfterStart.passes[0]!.started_at).toBe(rStart.json.detail.recorded_at);
    expect(callCmd(d, 'record pass', { ...startedOmitted, started_at: null }).json.reason).toBe('replayed');

    // Omitted-then-explicit different timestamp conflicts at started_at.
    const rStartConflict = callCmd(d, 'record pass', { ...startedOmitted, started_at: '2020-01-01T00:00:00Z' });
    expect(rStartConflict.json.reason).toBe('conflict');
    expect(rStartConflict.json.detail).toMatchObject({
      id: uid(711),
      path: 'started_at',
      stored: rStart.json.detail.recorded_at,
      sent: '2020-01-01T00:00:00Z',
    });

    // completed without completed_at records with stored completed_at === detail.recorded_at; explicit null replays.
    const completedOmitted = { pass_id: uid(711), state: 'completed' };
    const rComp = callCmd(d, 'record pass', completedOmitted, { file: 'pass-completed-omitted.json' });
    expect(rComp.json.reason).toBe('recorded');
    const stateAfterComp = JSON.parse(readFileSync(join(d, 'review-run-state.json'), 'utf8')) as ReviewRunState;
    expect(stateAfterComp.passes[0]!.completed_at).toBe(rComp.json.detail.recorded_at);
    expect(runCli(['record', 'pass', '--dir', d, '--input', join(d, 'pass-completed-omitted.json')]).json.reason).toBe('replayed');
    expect(callCmd(d, 'record pass', { ...completedOmitted, completed_at: null }).json.reason).toBe('replayed');
    expect(callCmd(d, 'record pass', { ...completedOmitted, completed_at: '2020-01-01T00:05:00Z' }).json).toMatchObject({
      reason: 'conflict',
      detail: { id: uid(711), path: 'completed_at', stored: rComp.json.detail.recorded_at, sent: '2020-01-01T00:05:00Z' },
    });

    // Explicit-then-omitted (and explicit null) replays for both started_at and completed_at.
    const explicitStart = mkPassStarted(712, { started_at: '2026-11-10T18:00:00Z' });
    expect(callCmd(d, 'record pass', explicitStart).json.reason).toBe('recorded');
    const { started_at: _omitS, ...explicitStartWithoutTs } = explicitStart;
    expect(callCmd(d, 'record pass', explicitStartWithoutTs).json.reason).toBe('replayed');
    expect(callCmd(d, 'record pass', { ...explicitStartWithoutTs, started_at: null }).json.reason).toBe('replayed');

    const explicitComp = { pass_id: uid(712), state: 'completed', completed_at: '2026-11-10T18:05:00Z' };
    expect(callCmd(d, 'record pass', explicitComp).json.reason).toBe('recorded');
    expect(callCmd(d, 'record pass', { pass_id: uid(712), state: 'completed' }).json.reason).toBe('replayed');
    expect(callCmd(d, 'record pass', { pass_id: uid(712), state: 'completed', completed_at: null }).json.reason).toBe('replayed');

    // Non-ISO or array started_at / completed_at is refused with iso8601-utc-z|null, leaving state bytes unchanged.
    const openPass = mkPassStarted(713);
    expect(callCmd(d, 'record pass', openPass).json.reason).toBe('recorded');
    const beforeBytes = readFileSync(join(d, 'review-run-state.json'), 'utf8');
    for (const bad of ['not-iso', '2026-11-10T18:00:00+00:00', []]) {
      const rBadStart = callCmd(d, 'record pass', { ...mkPassStarted(714), started_at: bad });
      expect(rBadStart.json.reason).toBe('invalid-input');
      expect(rBadStart.json.detail.violations).toEqual([
        { path: 'started_at', rule: 'invalid-value', expected: 'iso8601-utc-z|null' },
      ]);
      expect(readFileSync(join(d, 'review-run-state.json'), 'utf8')).toBe(beforeBytes);

      const rBadComp = callCmd(d, 'record pass', { pass_id: uid(713), state: 'completed', completed_at: bad });
      expect(rBadComp.json.reason).toBe('invalid-input');
      expect(rBadComp.json.detail.violations).toEqual([
        { path: 'completed_at', rule: 'invalid-value', expected: 'iso8601-utc-z|null' },
      ]);
      expect(readFileSync(join(d, 'review-run-state.json'), 'utf8')).toBe(beforeBytes);
    }
  });

  // Value: protects=input-only alias mapping of upstream CRITICAL and INFORMATIONAL on findings[].severity_source while keeping ENUMS.severity and validateStoredState strict; fails_when=CRITICAL or INFORMATIONAL fails to map to critical/info, other non-enum spellings are accepted, or validateStoredState accepts unmapped uppercase labels on disk; why_new=reliability Track T2/T3(c); seam=CLI and validateStoredState
  test('attempt findings accept upstream CRITICAL and INFORMATIONAL severity labels only', () => {
    const d = newDir();
    expect(callCmd(d, 'start', mkStart(720)).json.reason).toBe('recorded');
    expect(callCmd(d, 'record pass', mkPassStarted(721)).json.reason).toBe('recorded');

    const baseAttempt = {
      pass_id: uid(721),
      state: 'attempt',
      voice_id: 'core',
      attempt_id: uid(722),
      outcome: 'completed',
      findings: [
        {
          finding_id: 'F-crit',
          severity_source: 'CRITICAL',
          severity_rubric: 'core',
          adjudication: 'accepted',
          resolution: 'open',
          found_by: ['core'],
        },
        {
          finding_id: 'F-info',
          severity_source: 'INFORMATIONAL',
          severity_rubric: 'core',
          adjudication: 'rejected',
          resolution: 'unknown',
          found_by: ['core'],
        },
      ],
    };
    expect(callCmd(d, 'record pass', baseAttempt, { file: 'attempt-upstream-sev.json' }).json.reason).toBe('recorded');
    expect(runCli(['record', 'pass', '--dir', d, '--input', join(d, 'attempt-upstream-sev.json')]).json.reason).toBe('replayed');

    const statePath = join(d, 'review-run-state.json');
    const stored = JSON.parse(readFileSync(statePath, 'utf8')) as ReviewRunState;
    expect(stored.passes[0]!.voices[0]!.attempts[0]!.findings!.map((f) => f.severity_source)).toEqual(['critical', 'info']);
    expect(validateStoredState(stored, statePath).ok).toBe(true);

    // Stored-state reader stays strict: CRITICAL or INFORMATIONAL in stored JSON is rejected.
    for (const rawSev of ['CRITICAL', 'INFORMATIONAL']) {
      const mutated = structuredClone(stored) as any;
      mutated.passes[0].voices[0].attempts[0].findings[0].severity_source = rawSev;
      expect(validateStoredState(mutated, statePath)).toMatchObject({ ok: false, reason: 'corrupt' });
    }

    // Other spellings outside ENUMS.severity are refused with the unchanged enum text.
    const beforeBytes = readFileSync(statePath, 'utf8');
    for (const badSev of ['High', 'informational', 'INFO', 'CRITICAL ']) {
      const rBad = callCmd(d, 'record pass', {
        ...baseAttempt,
        attempt_id: uid(723),
        findings: [{ ...baseAttempt.findings[0]!, finding_id: 'F-bad', severity_source: badSev }],
      });
      expect(rBad.json.reason).toBe('invalid-input');
      expect(rBad.json.detail.violations).toEqual([
        {
          path: 'findings[0].severity_source',
          rule: 'invalid-enum',
          expected: 'P0|P1|P2|P3|critical|high|medium|low|info|unknown',
        },
      ]);
      expect(readFileSync(statePath, 'utf8')).toBe(beforeBytes);
    }
  });

  // Value: protects=C7 (runner parts[] entry accepted as delegate while 10-key delegate without call_id is refused, plus PART_KEYS parity) and C8 (candidate.tree accepted when equal to commit tree and refused with tree-mismatch otherwise across pass started, gate, and audit); fails_when=a runner parts[] entry is refused or stored with extra keys, a delegate without call_id records, PART_KEYS drifts from STATE_KEYS.delegate U DELEGATE_RUNNER_EXTRA_KEYS, or candidate.tree fails to record/replay or accepts a mismatched tree; why_new=0.94.x C7/C8 regressions (T1, T2); seam=CLI, state serialization, and render formatters
  test('replays the 0.94.x delegated-run refusals (C7, C8)', () => {
    // Criterion 8: every key in PART_KEYS is in STATE_KEYS.delegate or DELEGATE_RUNNER_EXTRA_KEYS.
    const storedDelegateSet = new Set<string>(STATE_KEYS.delegate);
    const extraDelegateSet = new Set<string>(DELEGATE_RUNNER_EXTRA_KEYS);
    for (const k of DELEGATE_RUNNER_EXTRA_KEYS) expect(storedDelegateSet.has(k), k).toBe(false);
    for (const k of PART_KEYS) {
      expect(storedDelegateSet.has(k) || extraDelegateSet.has(k), `PART_KEYS.${k}`).toBe(true);
    }
    expect(new Set([...STATE_KEYS.delegate, ...DELEGATE_RUNNER_EXTRA_KEYS])).toEqual(new Set(PART_KEYS));

    // C8 minimal shape: start with active delegation, then record pass started with candidate.tree and 12 required_voices.
    const c8Start = mkStart(801, {
      policy: {
        value: REAL_POLICY_LINE,
        source: 'caller prompt',
        delegation: {
          status: 'active',
          parts: ['maintainability', 'adversarial', 'red-team'],
          config: sha256('c8-cfg'),
          tools: [],
        },
      },
      continuation: { prior_stops: 0, max: 1, continues: null },
      pr: null,
    });
    const c8Voices = [
      'core',
      'specialist:testing',
      'specialist:maintainability',
      'specialist:security',
      'specialist:performance',
      'specialist:simplification',
      'specialist:state-machines',
      'red-team',
      'native-adversarial',
      'outside:challenge',
      'outside:structured',
      'qa',
    ];
    expect(c8Voices).toHaveLength(12);

    const dTree = newDir();
    const dNoTree = newDir();
    expect(callCmd(dTree, 'start', c8Start).json.reason).toBe('recorded');
    expect(callCmd(dNoTree, 'start', c8Start).json.reason).toBe('recorded');

    const passWithTree = {
      pass_id: uid(810),
      state: 'started',
      scope: 'local',
      cycle: 1,
      coverage: 'full',
      delta_from: null,
      candidate: { commit: headSha, tree: treeSha, base: baseSha },
      required_voices: c8Voices,
      started_at: '2026-11-15T07:50:19Z',
    };
    const passWithoutTree = {
      ...passWithTree,
      candidate: { commit: headSha, base: baseSha },
    };
    expect(callCmd(dTree, 'record pass', passWithTree, { file: 'c8-pass-tree.json' }).json.reason).toBe('recorded');
    expect(callCmd(dNoTree, 'record pass', passWithoutTree).json.reason).toBe('recorded');

    const normTimes = (raw: string): string => {
      const s = JSON.parse(raw) as ReviewRunState;
      const t = '2026-11-15T07:50:00Z';
      s.run.started_at = t;
      s.segments[0]!.started_at = t;
      s.passes[0]!.recorded_at = t;
      for (const vo of s.passes[0]!.voices) {
        if (vo.recorded_at !== null) vo.recorded_at = t;
        for (const a of vo.attempts) a.recorded_at = t;
      }
      return serializeState(s);
    };
    const treeStatePath = join(dTree, 'review-run-state.json');
    const noTreeStatePath = join(dNoTree, 'review-run-state.json');
    expect(normTimes(readFileSync(treeStatePath, 'utf8'))).toBe(normTimes(readFileSync(noTreeStatePath, 'utf8')));

    // Replay with equal tree -> replayed; replay with wrong tree -> invalid-input (tree-mismatch), state unchanged.
    const beforePassReplayBytes = readFileSync(treeStatePath, 'utf8');
    expect(runCli(['record', 'pass', '--dir', dTree, '--input', join(dTree, 'c8-pass-tree.json')]).json.reason).toBe('replayed');
    const rReplayWrongTree = callCmd(dTree, 'record pass', {
      ...passWithTree,
      candidate: { commit: headSha, tree: baseSha, base: baseSha },
    });
    expect(rReplayWrongTree.json.reason).toBe('invalid-input');
    expect(rReplayWrongTree.json.detail.violations).toEqual([
      { path: 'candidate.tree', rule: 'tree-mismatch', expected: 'tree-of-candidate.commit' },
    ]);
    expect(readFileSync(treeStatePath, 'utf8')).toBe(beforePassReplayBytes);

    // New pass with wrong 40-hex tree -> invalid-input (tree-mismatch), state bytes unchanged.
    const rNewWrongTree = callCmd(dTree, 'record pass', {
      ...passWithTree,
      pass_id: uid(811),
      candidate: { commit: headSha, tree: baseSha, base: baseSha },
    });
    expect(rNewWrongTree.json.reason).toBe('invalid-input');
    expect(rNewWrongTree.json.detail.violations).toEqual([
      { path: 'candidate.tree', rule: 'tree-mismatch', expected: 'tree-of-candidate.commit' },
    ]);
    expect(readFileSync(treeStatePath, 'utf8')).toBe(beforePassReplayBytes);

    // record gate and record audit with equal candidate.tree -> recorded; with wrong tree -> tree-mismatch.
    const gateOk = {
      gate_id: uid(812),
      name: 'tests',
      result: 'passed',
      candidate: { commit: headSha, tree: treeSha, base: baseSha },
    };
    expect(callCmd(dTree, 'record gate', gateOk).json.reason).toBe('recorded');
    expect(callCmd(dTree, 'record gate', gateOk).json.reason).toBe('replayed');
    expect(callCmd(dTree, 'record gate', { ...gateOk, candidate: { commit: headSha, tree: baseSha, base: baseSha } }).json.detail.violations).toEqual([
      { path: 'candidate.tree', rule: 'tree-mismatch', expected: 'tree-of-candidate.commit' },
    ]);
    expect(callCmd(dTree, 'record gate', { ...gateOk, gate_id: uid(813), candidate: { commit: headSha, tree: baseSha, base: baseSha } }).json.detail.violations).toEqual([
      { path: 'candidate.tree', rule: 'tree-mismatch', expected: 'tree-of-candidate.commit' },
    ]);

    const auditOk = {
      audit_id: uid(814),
      name: 'coverage',
      result: 'passed',
      details: { pct: 95, threshold: 90 },
      candidate: { commit: headSha, tree: treeSha, base: baseSha },
    };
    expect(callCmd(dTree, 'record audit', auditOk).json.reason).toBe('recorded');
    expect(callCmd(dTree, 'record audit', auditOk).json.reason).toBe('replayed');
    expect(callCmd(dTree, 'record audit', { ...auditOk, candidate: { commit: headSha, tree: baseSha, base: baseSha } }).json.detail.violations).toEqual([
      { path: 'candidate.tree', rule: 'tree-mismatch', expected: 'tree-of-candidate.commit' },
    ]);
    expect(callCmd(dTree, 'record audit', { ...auditOk, audit_id: uid(815), candidate: { commit: headSha, tree: baseSha, base: baseSha } }).json.detail.violations).toEqual([
      { path: 'candidate.tree', rule: 'tree-mismatch', expected: 'tree-of-candidate.commit' },
    ]);

    // C7 minimal shape: observed attempt shape (delegate with 10 keys, missing call_id) -> refused at delegate.call_id.
    const dRow = newDir();
    const d11 = newDir();
    for (const dir of [dRow, d11]) {
      expect(callCmd(dir, 'start', c8Start).json.reason).toBe('recorded');
      expect(callCmd(dir, 'record pass', {
        pass_id: uid(820),
        state: 'started',
        scope: 'local',
        cycle: 1,
        coverage: 'full',
        candidate: { commit: headSha, base: baseSha },
        required_voices: ['core', 'maintainability', 'native-adversarial', 'red-team'],
        started_at: '2026-11-15T13:58:00Z',
      }).json.reason).toBe('recorded');
    }

    const rowStatePath = join(dRow, 'review-run-state.json');
    const beforeAttemptBytes = readFileSync(rowStatePath, 'utf8');
    const tenKeyDelegate = {
      provider: 'antigravity-1',
      model: 'gemini-4-argon-high',
      outcome: 'credited',
      fallback_reason: null,
      replay: false,
      wall_ms: 28644,
      input_tokens: 26808,
      output_tokens: 2005,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: null,
    };
    const baseMaintAttempt = {
      pass_id: uid(820),
      state: 'attempt',
      voice_id: 'maintainability',
      part: 'specialist:maintainability',
      attempt_id: uid(821),
      outcome: 'completed',
      findings: [],
      dispatched_at: '2026-11-15T13:58:49.618Z',
      returned_at: '2026-11-15T13:59:18.262Z',
    };
    const rMissingCallId = callCmd(dRow, 'record pass', {
      ...baseMaintAttempt,
      delegate: tenKeyDelegate,
    });
    expect(rMissingCallId.json.reason).toBe('invalid-input');
    expect(rMissingCallId.json.detail.violations[0]).toEqual({
      path: 'delegate.call_id',
      rule: 'missing-key',
      expected: 'call_id',
    });
    expect(readFileSync(rowStatePath, 'utf8')).toBe(beforeAttemptBytes);

    // Whole runner parts[] entry (all 18 PART_KEYS) -> recorded, projected to 11 keys, replays, and matches 11-key state and rendered line.
    const callId = sha256('c7-maint-call');
    const runnerEntry = {
      part: 'maintainability',
      provider: 'antigravity-1',
      model: 'gemini-4-argon-high',
      call_id: callId,
      replay: false,
      dispatched: true,
      dispatched_at: '2026-11-15T13:58:49.618Z',
      returned_at: '2026-11-15T13:59:18.262Z',
      wall_ms: 28644,
      input_tokens: 26808,
      output_tokens: 2005,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: null,
      parse: 'valid',
      verdict: 'clean',
      outcome: 'credited',
      fallback_reason: null,
      findings: [],
    };
    expect(Object.keys(runnerEntry)).toEqual([...PART_KEYS]);
    const elevenKeyDelegate = { ...tenKeyDelegate, call_id: callId };

    expect(callCmd(dRow, 'record pass', { ...baseMaintAttempt, delegate: runnerEntry }, { file: 'c7-row.json' }).json.reason).toBe('recorded');
    expect(runCli(['record', 'pass', '--dir', dRow, '--input', join(dRow, 'c7-row.json')]).json.reason).toBe('replayed');
    expect(callCmd(dRow, 'record pass', { ...baseMaintAttempt, delegate: elevenKeyDelegate }).json.reason).toBe('replayed');

    expect(callCmd(d11, 'record pass', { ...baseMaintAttempt, delegate: elevenKeyDelegate }).json.reason).toBe('recorded');
    for (const dir of [dRow, d11]) {
      expect(callCmd(dir, 'record pass', {
        pass_id: uid(820),
        state: 'voice-complete',
        voice_id: 'maintainability',
        selected_attempt_id: uid(821),
      }).json.reason).toBe('recorded');
    }

    const stRow = JSON.parse(readFileSync(rowStatePath, 'utf8')) as ReviewRunState;
    const st11 = JSON.parse(readFileSync(join(d11, 'review-run-state.json'), 'utf8')) as ReviewRunState;
    const storedDelegate = stRow.passes[0]!.voices.find((v) => v.voice_id === 'maintainability')!.attempts[0]!.delegate!;
    expect(Object.keys(storedDelegate)).toEqual([...STATE_KEYS.delegate]);
    expect(storedDelegate).toEqual(elevenKeyDelegate);
    expect(normTimes(serializeState(stRow))).toBe(normTimes(serializeState(st11)));
    const linesRow = FIELD_FMT.delegatedParts({ state: stRow } as unknown as RenderCtx);
    const lines11 = FIELD_FMT.delegatedParts({ state: st11 } as unknown as RenderCtx);
    expect(linesRow).toEqual(lines11);
    expect(linesRow).toEqual([
      `Delegated part: maintainability; provider=antigravity-1; model=gemini-4-argon-high; outcome=credited; reason=none; wall_ms=28644; input_tokens=26808; output_tokens=2005; cache_read_input_tokens=0; cache_creation_input_tokens=unknown; findings=0; call=${callId}`,
    ]);

    // Meaning checks on runner extras: mismatched part, mismatched dispatched_at/returned_at, and unknown key.
    const beforeMeaningBytes = readFileSync(rowStatePath, 'utf8');
    for (const [override, expectedViolation] of [
      [
        { part: 'adversarial' },
        { path: 'delegate.part', rule: 'invalid-value', expected: 'matching-attempt-part' },
      ],
      [
        { dispatched_at: '2026-11-15T13:58:00.000Z' },
        { path: 'delegate.dispatched_at', rule: 'invalid-value', expected: 'equal-to-attempt-dispatched_at' },
      ],
      [
        { returned_at: '2026-11-15T13:59:59.000Z' },
        { path: 'delegate.returned_at', rule: 'invalid-value', expected: 'equal-to-attempt-returned_at' },
      ],
      [
        { extra_runner_field: true },
        { path: 'delegate.extra_runner_field', rule: 'unknown-key', expected: 'no unknown keys' },
      ],
    ] as const) {
      const rBad = callCmd(dRow, 'record pass', {
        ...baseMaintAttempt,
        voice_id: 'native-adversarial',
        part: 'specialist:maintainability',
        attempt_id: uid(822),
        delegate: { ...runnerEntry, ...override },
      });
      expect(rBad.json.reason).toBe('invalid-input');
      expect(rBad.json.detail.violations).toContainEqual(expectedViolation);
      expect(readFileSync(rowStatePath, 'utf8')).toBe(beforeMeaningBytes);
    }
  });

  // Value: protects=D15 classification and behavior of pilot refusals C9 (probe gate details), C10 (pending adjudication), C11 (part-label required_voices arrays), C12 (invocation prompt policy.source), and C13 (bare record usage refusal); fails_when=an invalid C9/C10/C12/C13 payload records or mutates state, or a documented C9/C10/C11/C12 form is refused; why_new=Track 83A T2; seam=CLI and state file
  test('replays the pilot refusals (C9–C13)', () => {
    const d = newDir();
    const statePath = join(d, 'review-run-state.json');

    // C12: start policy.source "invocation prompt" refused; "caller prompt" records.
    const c12BadStart = mkStart(830, {
      policy: { value: REAL_POLICY_LINE, source: 'invocation prompt' },
    });
    const rC12Bad = callCmd(d, 'start', c12BadStart);
    expect(rC12Bad.code).toBe(1);
    expect(rC12Bad.json.reason).toBe('invalid-input');
    expect(rC12Bad.json.detail.violations).toEqual([
      { path: 'policy.source', rule: 'invalid-enum', expected: 'caller prompt|user decision|none supplied' },
    ]);
    expect(existsSync(statePath)).toBe(false);

    const c12GoodStart = mkStart(830, {
      policy: { value: REAL_POLICY_LINE, source: 'caller prompt' },
    });
    expect(callCmd(d, 'start', c12GoodStart).json.reason).toBe('recorded');

    // C11: three observed required_voices arrays holding part labels all record on the current helper.
    const c11VoiceArrays = [
      ['core', 'outside:challenge'],
      ['core', 'specialist:security', 'native-adversarial'],
      ['core', 'specialist:maintainability', 'specialist:testing', 'outside:challenge', 'outside:structured', 'native-adversarial', 'red-team'],
    ] as const;
    c11VoiceArrays.forEach((voices, idx) => {
      const rPass = callCmd(d, 'record pass', {
        pass_id: uid(831 + idx),
        state: 'started',
        scope: 'local',
        cycle: idx + 1,
        coverage: 'full',
        candidate: { commit: headSha, base: baseSha },
        required_voices: [...voices],
      });
      expect(rPass.json.reason, `C11 array ${idx}`).toBe('recorded');
    });

    // C9: probe-<id> gate with details.captures or details.label/details.key refused; probe gate with evidence and no details records.
    writeFileSync(join(d, 'probe-001.json'), '{"outcome":"passed"}\n');
    writeFileSync(join(d, 'capture-001.txt'), 'capture output\n');
    const probeEv = [
      { path: 'probe-001.json', sha256: sha256('{"outcome":"passed"}\n') },
      { path: 'capture-001.txt', sha256: sha256('capture output\n') },
    ];
    const beforeC9Bytes = readFileSync(statePath, 'utf8');
    const rC9Captures = callCmd(d, 'record gate', {
      gate_id: uid(835),
      name: 'probe-001',
      result: 'passed',
      candidate: { commit: headSha, base: baseSha },
      details: { captures: ['001'] },
    });
    expect(rC9Captures.code).toBe(1);
    expect(rC9Captures.json.reason).toBe('invalid-input');
    expect(rC9Captures.json.detail.violations).toEqual([
      { path: 'details.captures', rule: 'unknown-key', expected: 'no unknown keys' },
    ]);
    expect(readFileSync(statePath, 'utf8')).toBe(beforeC9Bytes);

    const rC9LabelKey = callCmd(d, 'record gate', {
      gate_id: uid(835),
      name: 'probe-001',
      result: 'passed',
      candidate: { commit: headSha, base: baseSha },
      details: { label: 'probe-001', key: 'k1' },
    });
    expect(rC9LabelKey.code).toBe(1);
    expect(rC9LabelKey.json.reason).toBe('invalid-input');
    expect(rC9LabelKey.json.detail.violations).toEqual([
      { path: 'details.label', rule: 'unknown-key', expected: 'no unknown keys' },
      { path: 'details.key', rule: 'unknown-key', expected: 'no unknown keys' },
    ]);
    expect(readFileSync(statePath, 'utf8')).toBe(beforeC9Bytes);

    expect(callCmd(d, 'record gate', {
      gate_id: uid(835),
      name: 'probe-001',
      result: 'passed',
      candidate: { commit: headSha, base: baseSha },
      evidence: probeEv,
    }).json.reason).toBe('recorded');

    // C10: finding with adjudication "pending" refused; same finding with "unclassified" records.
    const beforeC10Bytes = readFileSync(statePath, 'utf8');
    const c10FindingBase = {
      finding_id: 'C10-F1',
      severity_source: 'P2',
      severity_rubric: 'core',
      resolution: 'open',
      found_by: ['core'],
    };
    const rC10Bad = callCmd(d, 'record pass', {
      pass_id: uid(831),
      state: 'attempt',
      voice_id: 'core',
      part: 'core',
      attempt_id: uid(836),
      outcome: 'completed',
      findings: [{ ...c10FindingBase, adjudication: 'pending' }],
    });
    expect(rC10Bad.code).toBe(1);
    expect(rC10Bad.json.reason).toBe('invalid-input');
    expect(rC10Bad.json.detail.violations).toEqual([
      { path: 'findings[0].adjudication', rule: 'invalid-enum', expected: 'accepted|rejected|deferred|duplicate|unclassified' },
    ]);
    expect(readFileSync(statePath, 'utf8')).toBe(beforeC10Bytes);

    expect(callCmd(d, 'record pass', {
      pass_id: uid(831),
      state: 'attempt',
      voice_id: 'core',
      part: 'core',
      attempt_id: uid(836),
      outcome: 'completed',
      findings: [{ ...c10FindingBase, adjudication: 'unclassified' }],
    }).json.reason).toBe('recorded');

    // C13: bare record with no subtype answers usage with unknown command "record" and leaves state file unchanged.
    const beforeC13Bytes = readFileSync(statePath, 'utf8');
    const c13Input = writeJson(d, 'c13-bare-record.json', { pass_id: uid(831), state: 'completed' });
    const rC13 = runCli(['record', '--dir', d, '--input', c13Input]);
    expect(rC13.code).toBe(2);
    expect(rC13.json).toMatchObject({
      status: 'usage',
      reason: 'usage',
      command: 'record',
      detail: { message: 'unknown command "record"' },
    });
    expect(readFileSync(statePath, 'utf8')).toBe(beforeC13Bytes);
  });

  // Value: protects=accepted part-label voice IDs survive metrics projection, including fallback and finding corrections;
  // fails_when=export forwards colon labels to the strict metrics writer or changes historical IDs;
  // why_new=C8 replay stopped at state recording; seam=real Python metrics validator; no_claim=installed-agent acceptance
  test('projects part-label voice IDs into valid metrics without changing stored labels or legacy IDs', () => {
    const d = newDir();
    const start = mkStart(850);
    expect(callCmd(d, 'start', start).json.reason).toBe('recorded');
    const passId = uid(851);
    expect(callCmd(d, 'record pass', {
      pass_id: passId, state: 'started', scope: 'local', cycle: 1, coverage: 'full',
      candidate: { commit: headSha, tree: treeSha, base: baseSha },
      required_voices: ['core', 'specialist:maintainability', 'outside:challenge'],
    }).json.reason).toBe('recorded');
    expect(callCmd(d, 'record pass', {
      pass_id: passId, state: 'attempt', voice_id: 'specialist:maintainability',
      part: 'specialist:maintainability', attempt_id: uid(852), outcome: 'failed',
      delegate: { provider: 'reviewer', model: 'model', outcome: 'fell-back', fallback_reason: 'failed',
        replay: false, wall_ms: 1, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0,
        cache_creation_input_tokens: null, call_id: sha256('fallback') },
    }).json.reason).toBe('recorded');
    expect(callCmd(d, 'record pass', {
      pass_id: passId, state: 'attempt', voice_id: 'specialist:maintainability',
      part: 'specialist:maintainability', attempt_id: uid(853), predecessor_attempt_id: uid(852),
      outcome: 'completed', findings: [{ finding_id: 'label-F1', severity_source: 'P2',
        severity_rubric: 'specialist', adjudication: 'accepted', resolution: 'open',
        found_by: ['specialist:maintainability'] }],
    }).json.reason).toBe('recorded');
    expect(callCmd(d, 'record pass', { pass_id: passId, state: 'voice-complete',
      voice_id: 'specialist:maintainability', selected_attempt_id: uid(853) }).json.reason).toBe('recorded');
    expect(callCmd(d, 'record pass', { pass_id: passId, state: 'voice-complete',
      voice_id: 'outside:challenge', not_applicable: 'not-applicable' }).json.reason).toBe('recorded');
    expect(callCmd(d, 'record correction', { correction_id: uid(854),
      target: { pass_id: passId, voice_id: 'specialist:maintainability', attempt_id: uid(853), finding_id: 'label-F1' },
      resolution: 'fixed', fixed_in: headSha }).json.reason).toBe('recorded');
    const statePath = join(d, 'review-run-state.json');
    const originalBytes = readFileSync(statePath, 'utf8');
    const st = JSON.parse(originalBytes) as ReviewRunState;
    const projected = projectState(st);
    const validator = spawnSync('python3', ['-B', '-I', '-c', [
      'import importlib.util,json,sys',
      's=importlib.util.spec_from_file_location("workflow_metrics",sys.argv[1])',
      'm=importlib.util.module_from_spec(s);s.loader.exec_module(m)',
      'for event in json.load(sys.stdin)["records"]: m.validate_request(event["op"],event["request"])',
    ].join('\n'), join(REPO_ROOT, 'bin', 'lib', 'workflow_metrics.py')], {
      input: JSON.stringify(projected), encoding: 'utf8', timeout: 10_000,
    });
    expect(validator.status, validator.stderr).toBe(0);
    const metricId = uuidv5(NAMESPACE, `${start.run_id}:voice:specialist:maintainability`);
    const passStart = projected.records.find((r) => r.op === 'pass' && r.request.state === 'started')!;
    expect(passStart.request.required_voice_ids).toEqual([
      'core', metricId, uuidv5(NAMESPACE, `${start.run_id}:voice:outside:challenge`),
    ]);
    for (const r of projected.records.filter((r) => r.request.voice_id && r.request.voice_id !== 'core')) {
      expect([metricId, uuidv5(NAMESPACE, `${start.run_id}:voice:outside:challenge`)]).toContain(r.request.voice_id);
    }
    expect(projected.records.some((r) => r.request.correction_kind === 'finding')).toBe(true);
    expect(projected.records.some((r) => r.request.correction_kind === 'fallback')).toBe(true);
    expect(projectState(st)).toEqual(projected);
    expect(st.passes[0]!.required_voices).toContain('specialist:maintainability');
    expect(readFileSync(statePath, 'utf8')).toBe(originalBytes);
  });

  // Value: protects=D15 classification table and three-consecutive-run success target in docs/designs/review-run-state.md; fails_when=D15 drops any of the eight observed cause paths or the original/restated three-consecutive-run target; why_new=reliability Track T6 + C7/C8 T3; seam=design doc contract
  test('design doc D15 records all eight observed cause paths and the restated three-consecutive-run success target', () => {
    const design = readFileSync(DESIGN_PATH, 'utf8');
    const d15Start = design.indexOf('## D15.');
    const changeLogStart = design.indexOf('## Change log');
    expect(d15Start).toBeGreaterThan(-1);
    expect(changeLogStart).toBeGreaterThan(d15Start);
    const d15 = design.slice(d15Start, changeLogStart).replace(/\s+/g, ' ');
    for (const causePath of [
      'policy.delegation.parts',
      'policy.delegation',
      'continuation',
      'continuation.continues',
      'started_at',
      'findings[0].severity_source',
      'delegate.call_id',
      'candidate.tree',
      'findings[0].severity_rubric',
      'findings',
      'details.threshold',
      'findings[0].finding_id',
    ]) {
      expect(d15, causePath).toContain('`' + causePath + '`');
    }
    for (const row of [
      '| C7 | `record pass` (`attempt`) `delegate.call_id` | keys copied from another tool |',
      '| C8 | `record pass` (`started`) `candidate.tree` | keys copied from another tool |',
      '| C14 | `record pass` (`attempt`) `findings[0].severity_rubric` | enum spelling |',
      '| C15 | `record pass` (`attempt`) `findings` | conditional nullability |',
      '| C18 |',
      '| C19 |',
      '| C21 |',
    ]) {
      expect(d15, row).toContain(row);
    }
    expect(d15).toContain(
      'The next three consecutive factory `/review-and-prep` runs of this repository that send `run-state=record` on a helper release containing this change each end with `Run state: recorded (…)` in their full receipt and none carries an `invalid-input` refusal',
    );
    expect(d15).toContain(
      "the next three consecutive factory-orchestrated `/review-and-prep` runs that send `run-state=record` with an active `delegate=` value, on a helper release containing C7's and C8's fixes, each end with `Run state: recorded (…)` in their full receipt, record their delegated parts' attempts, and carry no `invalid-input` refusal",
    );
    expect(d15).toContain(
      "Target: the next 3 consecutive factory-orchestrated `/review-and-prep` runs with an active `delegate=` value on a helper release containing `build`, each ending `Run state: recorded (…)` in their full receipt, recording their delegated parts' attempts, and carrying no `invalid-input` refusal, measured afterwards from the factory's own reviews' evidence directories with no owner by-hand runs counted.",
    );
  });

  // Value: protects=unreported delegate wall_ms and token counts stored as explicit nulls, rendered as unknown, and exported to workflow metrics with fallback correction; fails_when=null delegate counts are refused, rendered as 0/null, break all-integer parity, or fail stored-state validation; why_new=Track 83A T1; seam=CLI, render, export, and workflow_metrics.py validator
  test('stores, replays, renders, and exports delegated attempts with unreported null counts while preserving all-integer bytes', () => {
    const d = newDir();
    const start = mkStart(860, {
      policy: {
        value: REAL_POLICY_LINE,
        source: 'caller prompt',
        delegation: {
          status: 'active',
          parts: ['maintainability', 'adversarial', 'red-team'],
          config: sha256('t1-cfg'),
          tools: [],
        },
      },
    });
    expect(callCmd(d, 'start', start).json.reason).toBe('recorded');
    const passId = uid(861);
    expect(callCmd(d, 'record pass', {
      pass_id: passId,
      state: 'started',
      scope: 'local',
      cycle: 1,
      coverage: 'full',
      candidate: { commit: headSha, tree: treeSha, base: baseSha },
      required_voices: ['core', 'specialist:maintainability', 'native-adversarial', 'red-team'],
    }).json.reason).toBe('recorded');

    const noCallId = sha256('t1-no-call');
    const noCallRunnerEntry = {
      part: 'maintainability',
      provider: 'codex',
      model: 'gpt-5',
      call_id: noCallId,
      replay: false,
      dispatched: false,
      dispatched_at: null,
      returned_at: null,
      wall_ms: null,
      input_tokens: null,
      output_tokens: null,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
      parse: 'not-applicable',
      verdict: 'unavailable',
      outcome: 'fell-back',
      fallback_reason: 'unresolved-claim',
      findings: [],
    };
    const noCallAttempt = {
      pass_id: passId,
      state: 'attempt',
      voice_id: 'specialist:maintainability',
      part: 'specialist:maintainability',
      attempt_id: uid(862),
      outcome: 'failed',
      dispatched_at: null,
      returned_at: null,
      delegate: noCallRunnerEntry,
    };
    expect(callCmd(d, 'record pass', noCallAttempt, { file: 't1-no-call.json' }).json.reason).toBe('recorded');
    expect(runCli(['record', 'pass', '--dir', d, '--input', join(d, 't1-no-call.json')]).json.reason).toBe('replayed');

    // Host fallback attempt naming the failed delegated attempt
    expect(callCmd(d, 'record pass', {
      pass_id: passId,
      state: 'attempt',
      voice_id: 'specialist:maintainability',
      part: 'specialist:maintainability',
      attempt_id: uid(863),
      predecessor_attempt_id: uid(862),
      outcome: 'completed',
      findings: [],
    }).json.reason).toBe('recorded');
    expect(callCmd(d, 'record pass', {
      pass_id: passId,
      state: 'voice-complete',
      voice_id: 'specialist:maintainability',
      selected_attempt_id: uid(863),
    }).json.reason).toBe('recorded');

    // Credited entry with integer wall_ms and null token counts
    const noUsageCallId = sha256('t1-no-usage');
    expect(callCmd(d, 'record pass', {
      pass_id: passId,
      state: 'attempt',
      voice_id: 'native-adversarial',
      part: 'native-adversarial',
      attempt_id: uid(864),
      outcome: 'completed',
      dispatched_at: '2026-11-15T14:00:00Z',
      returned_at: '2026-11-15T14:00:05Z',
      delegate: {
        part: 'adversarial',
        provider: 'claude',
        model: 'claude-sonnet-4-6',
        call_id: noUsageCallId,
        replay: false,
        dispatched: true,
        dispatched_at: '2026-11-15T14:00:00Z',
        returned_at: '2026-11-15T14:00:05Z',
        wall_ms: 5120,
        input_tokens: null,
        output_tokens: null,
        cache_read_input_tokens: null,
        cache_creation_input_tokens: null,
        parse: 'valid',
        verdict: 'clean',
        outcome: 'credited',
        fallback_reason: null,
        findings: [],
      },
      findings: [],
    }).json.reason).toBe('recorded');
    expect(callCmd(d, 'record pass', {
      pass_id: passId,
      state: 'voice-complete',
      voice_id: 'native-adversarial',
      selected_attempt_id: uid(864),
    }).json.reason).toBe('recorded');

    // All-integer entry
    const intCallId = sha256('t1-all-int');
    expect(callCmd(d, 'record pass', {
      pass_id: passId,
      state: 'attempt',
      voice_id: 'red-team',
      part: 'red-team',
      attempt_id: uid(865),
      outcome: 'completed',
      delegate: {
        provider: 'antigravity-1',
        model: 'gemini-4-argon-high',
        call_id: intCallId,
        replay: false,
        wall_ms: 1400,
        input_tokens: 900,
        output_tokens: 210,
        cache_read_input_tokens: 300,
        cache_creation_input_tokens: 50,
        outcome: 'credited',
        fallback_reason: null,
      },
      findings: [],
    }).json.reason).toBe('recorded');
    expect(callCmd(d, 'record pass', {
      pass_id: passId,
      state: 'voice-complete',
      voice_id: 'red-team',
      selected_attempt_id: uid(865),
    }).json.reason).toBe('recorded');

    // Complete pass, greptile gate, ready checkpoint, and render full-receipt
    expect(callCmd(d, 'record pass', {
      pass_id: passId,
      state: 'attempt',
      voice_id: 'core',
      part: 'core',
      attempt_id: uid(866),
      outcome: 'completed',
      findings: [],
    }).json.reason).toBe('recorded');
    expect(callCmd(d, 'record pass', {
      pass_id: passId,
      state: 'voice-complete',
      voice_id: 'core',
      selected_attempt_id: uid(866),
    }).json.reason).toBe('recorded');
    expect(callCmd(d, 'record pass', {
      pass_id: passId,
      state: 'completed',
      completed_at: '2026-11-15T14:01:00Z',
    }).json.reason).toBe('recorded');
    expect(callCmd(d, 'record gate', {
      gate_id: uid(867),
      name: 'greptile',
      result: 'not-run',
      candidate: { commit: headSha, base: baseSha },
      details: { value: 'skipped — no root configuration; do not run it', run: null },
    }).json.reason).toBe('recorded');
    expect(callCmd(d, 'checkpoint', {
      checkpoint_id: uid(868),
      kind: 'ready',
      base: baseSha,
    }).json.reason).toBe('recorded');

    const statePath = join(d, 'review-run-state.json');
    const st = JSON.parse(readFileSync(statePath, 'utf8')) as ReviewRunState;
    expect(validateStoredState( JSON.parse(serializeState(st))).ok).toBe(true);

    const maintDelegate = st.passes[0]!.voices.find((v) => v.voice_id === 'specialist:maintainability')!.attempts[0]!.delegate!;
    expect(maintDelegate).toEqual({
      provider: 'codex',
      model: 'gpt-5',
      outcome: 'fell-back',
      fallback_reason: 'unresolved-claim',
      replay: false,
      wall_ms: null,
      input_tokens: null,
      output_tokens: null,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
      call_id: noCallId,
    });

    const rFull = callCmd(d, 'render', { output: 'full-receipt' });
    expect(rFull.code).toBe(0);
    const fullText = readFileSync(rFull.json.files[0].path, 'utf8');
    expect(fullText).toContain(
      `Delegated part: maintainability; provider=codex; model=gpt-5; outcome=fell-back; reason=unresolved-claim; wall_ms=unknown; input_tokens=unknown; output_tokens=unknown; cache_read_input_tokens=unknown; cache_creation_input_tokens=unknown; findings=0; call=${noCallId}`,
    );
    expect(fullText).toContain(
      `Delegated part: adversarial; provider=claude; model=claude-sonnet-4-6; outcome=credited; reason=none; wall_ms=5120; input_tokens=unknown; output_tokens=unknown; cache_read_input_tokens=unknown; cache_creation_input_tokens=unknown; findings=0; call=${noUsageCallId}`,
    );
    expect(fullText).toContain(
      `Delegated part: red-team; provider=antigravity-1; model=gemini-4-argon-high; outcome=credited; reason=none; wall_ms=1400; input_tokens=900; output_tokens=210; cache_read_input_tokens=300; cache_creation_input_tokens=50; findings=0; call=${intCallId}`,
    );

    const projected = projectState(st);
    const validator = spawnSync('python3', ['-B', '-I', '-c', [
      'import importlib.util,json,sys',
      's=importlib.util.spec_from_file_location("workflow_metrics",sys.argv[1])',
      'm=importlib.util.module_from_spec(s);s.loader.exec_module(m)',
      'for event in json.load(sys.stdin)["records"]: m.validate_request(event["op"],event["request"])',
    ].join('\n'), join(REPO_ROOT, 'bin', 'lib', 'workflow_metrics.py')], {
      input: JSON.stringify(projected), encoding: 'utf8', timeout: 10_000,
    });
    expect(validator.status, validator.stderr).toBe(0);
    const noCallMetricAttempt = projected.records.find(
      (r) => r.op === 'pass' && r.request.state === 'attempt' && r.request.attempt_id === uid(862),
    )!;
    expect(noCallMetricAttempt.request.delegate).toMatchObject({
      wall_ms: null,
      input_tokens: null,
      output_tokens: null,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
    });
    const fallbackCorr = projected.records.find(
      (r) => r.op === 'correction' && r.request.attempt_id === uid(863),
    )!;
    expect(fallbackCorr.request.correction_kind).toBe('fallback');

    // Negative and string wall_ms refused on input and stored state
    const beforeRefuseBytes = readFileSync(statePath, 'utf8');
    for (const badWall of [-1, '12'] as const) {
      const rBad = callCmd(d, 'record pass', {
        pass_id: passId,
        state: 'attempt',
        voice_id: 'red-team',
        part: 'red-team',
        attempt_id: uid(869),
        outcome: 'completed',
        delegate: {
          provider: 'codex',
          model: 'gpt-5',
          outcome: 'credited',
          fallback_reason: null,
          replay: false,
          wall_ms: badWall,
          input_tokens: null,
          output_tokens: null,
          cache_read_input_tokens: null,
          cache_creation_input_tokens: null,
          call_id: intCallId,
        },
        findings: [],
      });
      expect(rBad.json.reason).toBe('invalid-input');
      expect(rBad.json.detail.violations).toEqual([
        { path: 'delegate.wall_ms', rule: 'invalid-value', expected: 'non-negative-integer|null' },
      ]);
      expect(readFileSync(statePath, 'utf8')).toBe(beforeRefuseBytes);

      const badStored = JSON.parse(serializeState(st));
      badStored.passes[0].voices[1].attempts[0].delegate.wall_ms = badWall;
      const vStored = validateStoredState(badStored);
      expect(vStored).toEqual({
        ok: false,
        reason: 'corrupt',
        detail: {
          path: 'review-run-state.json',
          message: 'invalid-value at passes[0].voices[1].attempts[0].delegate.wall_ms',
        },
      });
    }
  });

  // Value: protects=every build example in docs/review-run-state-calls.md and D13's walkthrough in docs/designs/review-run-state.md against CLI/schema drift; fails_when=a documented build line fails runCli, a BUILD_COMMANDS entry or record pass state is missing from the examples, or D13's walkthrough fails applyCommand/validateStoredState; why_new=T3/T4 build examples; seam=CLI and src/review-state/build.ts + state.ts; no_claim=installed-agent execution
  test('every build example in docs/review-run-state-calls.md records in sequence and the D13 walkthrough records', () => {
    const splitShLine = (line: string): string[] => {
      const tokens: string[] = [];
      let cur = '';
      let quote: '"' | "'" | null = null;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]!;
        if (quote) {
          if (ch === quote) quote = null;
          else cur += ch;
        } else if (ch === '"' || ch === "'") {
          quote = ch;
        } else if (/\s/.test(ch)) {
          if (cur.length > 0) { tokens.push(cur); cur = ''; }
        } else {
          cur += ch;
        }
      }
      if (cur.length > 0) tokens.push(cur);
      return tokens;
    };

    const callsDoc = readFileSync(join(REPO_ROOT, 'docs', 'review-run-state-calls.md'), 'utf8');
    const shFences = [...callsDoc.matchAll(/```sh\n([\s\S]*?)\n```/g)].map((m) =>
      m[1]!.split('\n').map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('#')),
    );
    expect(shFences.length).toBeGreaterThanOrEqual(4);
    const seqLines = shFences[0]!;
    const stoppedLines = shFences[1]!;
    const escalatedLines = shFences[2]!;
    const blockedLines = shFences[3]!;

    const exCommit = '0123456789abcdef0123456789abcdef01234567';
    const exBase = '89abcdef0123456789abcdef0123456789abcdef';
    const exSha256 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    const prepFiles = (dir: string) => {
      writeJson(dir, 'delegate-specialist.json', {
        v: 1,
        status: 'ran',
        config_sha256: exSha256,
        parts: [{
          part: 'maintainability',
          provider: 'claude',
          model: 'claude-sonnet-4-6',
          call_id: exSha256,
          replay: false,
          dispatched: true,
          dispatched_at: '2026-11-10T18:01:00Z',
          returned_at: '2026-11-10T18:02:00Z',
          wall_ms: 1200,
          input_tokens: 400,
          output_tokens: 120,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: null,
          parse: 'valid',
          verdict: 'clean',
          outcome: 'credited',
          fallback_reason: null,
          findings: [],
        }],
      });
      writeFileSync(join(dir, 'probe-0123456789ab.json'), '{"outcome":"passed"}\n');
      writeFileSync(join(dir, 'pregate.json'), '{"verdict":"PASS"}\n');
      writeFileSync(join(dir, 'documentation.md'), '### Documentation\nPassed.\n');
    };

    const subLine = (line: string, dir: string): string[] => {
      const substituted = line
        .replaceAll('<extend-root>', REPO_ROOT)
        .replaceAll('<evidence directory>', dir)
        .replaceAll(exCommit, headSha)
        .replaceAll(exBase, baseSha);
      const tokens = splitShLine(substituted);
      expect(tokens[0]).toBe(`${REPO_ROOT}/bin/review-state`);
      expect(tokens[1]).toBe('build');
      return tokens.slice(1);
    };

    const dSeq = newDir();
    prepFiles(dSeq);
    const seenCommands = new Set<string>();
    const seenPassStates = new Set<string>();
    for (const [idx, line] of seqLines.entries()) {
      const argv = subLine(line, dSeq);
      const cmd = argv[1] === 'record' ? `record ${argv[2]}` : argv[1]!;
      seenCommands.add(cmd);
      if (cmd === 'record pass') {
        const stIdx = argv.indexOf('--state');
        if (stIdx !== -1 && argv[stIdx + 1]) seenPassStates.add(argv[stIdx + 1]!);
      }
      const res = runCli(argv);
      expect(res.json.reason, `seq line #${idx}: ${line}`).toBe('recorded');
    }
    for (const cmd of BUILD_COMMANDS) expect(seenCommands.has(cmd), `missing command ${cmd}`).toBe(true);
    for (const st of PASS_STATES) expect(seenPassStates.has(st), `missing pass state ${st}`).toBe(true);
    const seqState = JSON.parse(readFileSync(join(dSeq, 'review-run-state.json'), 'utf8')) as ReviewRunState;
    expect(validateStoredState(seqState).ok).toBe(true);

    // Separate stopped finish example after start in a fresh directory
    const dStop = newDir();
    prepFiles(dStop);
    expect(runCli(subLine(seqLines[0]!, dStop)).json.reason).toBe('recorded');
    for (const [idx, line] of stoppedLines.entries()) {
      const res = runCli(subLine(line, dStop));
      expect(res.json.reason, `stopped line #${idx}: ${line}`).toBe('recorded');
    }
    const stopState = JSON.parse(readFileSync(join(dStop, 'review-run-state.json'), 'utf8')) as ReviewRunState;
    expect(stopState.finish?.outcome).toBe('stopped');
    expect(validateStoredState(stopState).ok).toBe(true);

    // Separate escalated finish example after start in a fresh directory
    const dEsc = newDir();
    prepFiles(dEsc);
    expect(runCli(subLine(seqLines[0]!, dEsc)).json.reason).toBe('recorded');
    for (const [idx, line] of escalatedLines.entries()) {
      const res = runCli(subLine(line, dEsc));
      expect(res.json.reason, `escalated line #${idx}: ${line}`).toBe('recorded');
    }
    const escState = JSON.parse(readFileSync(join(dEsc, 'review-run-state.json'), 'utf8')) as ReviewRunState;
    expect(escState.finish?.outcome).toBe('escalated');
    expect(validateStoredState(escState).ok).toBe(true);

    const dBlocked = newDir();
    expect(runCli(subLine(seqLines[0]!, dBlocked)).json.reason).toBe('recorded');
    for (const line of blockedLines) {
      expect(runCli(subLine(line, dBlocked)).json.reason, line).toBe('recorded');
    }
    const blockedState = JSON.parse(readFileSync(join(dBlocked, 'review-run-state.json'), 'utf8')) as ReviewRunState;
    expect(blockedState.finish?.outcome).toBe('blocked');

    const gitInfo: GitInfo = {
      repo: '/fixture/.git',
      toplevel: '/fixture',
      branch: 'topic',
      head: exCommit,
      tree: exCommit,
    };
    const env: EnvChecker = {
      commitExists: (s) => s === exCommit || s === exBase,
      commitTree: () => exCommit,
      isAncestor: () => true,
      checkEvidence: () => null,
    };
    const now = '2026-11-10T18:00:00Z';
    const designDoc = readFileSync(DESIGN_PATH, 'utf8');
    const walkthroughBlocks = [...designDoc.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) =>
      JSON.parse(m[1]!.replaceAll('<BASE_SHA>', exBase).replaceAll('<HEAD_SHA>', exCommit).replaceAll('<PLAN_SHA256>', sha256('walkthrough-plan'))),
    );
    expect(walkthroughBlocks).toHaveLength(4);
    const walkthroughSteps: Array<[CommandName, unknown]> = [
      ['start', walkthroughBlocks[0]],
      ['record pass', walkthroughBlocks[1]],
      ['record pass', walkthroughBlocks[2]],
      ['finish', walkthroughBlocks[3]],
    ];
    let walkState: ReviewRunState | null = null;
    for (const [cmd, payload] of walkthroughSteps) {
      const res = applyCommand(walkState, cmd, payload, gitInfo, env, now);
      expect(res.reason, `walkthrough ${cmd}`).toBe('recorded');
      if (res.reason !== 'recorded') throw new Error(`walkthrough ${cmd} failed`);
      walkState = JSON.parse(serializeState(res.state)) as ReviewRunState;
      expect(validateStoredState(walkState).ok).toBe(true);
    }
  });

  // Value: protects=start policy.delegation parts/tools validation and root continuation type advice; fails_when=missing/non-array/empty/non-string delegation parts or malformed/unknown/duplicate-normalized tools or non-object root continuation are accepted or omit continuation advice or write a state file; why_new=Track 83A T6 (AC5); seam=CLI and src/review-state/state.ts; no_claim=installed-agent execution
  test('start validates delegation parts/tools boundary shapes, omitted tools replay, and root continuation type advice', () => {
    // 1. Missing parts
    {
      const d = newDir();
      const res = callCmd(d, 'start', mkStart(880, {
        policy: {
          value: REAL_POLICY_LINE,
          source: 'caller prompt',
          delegation: { status: 'active', config: sha256('cfg'), tools: [] },
        },
      }));
      expect(res.json.reason).toBe('invalid-input');
      expect(res.json.detail.violations).toEqual([
        { path: 'policy.delegation.parts', rule: 'missing-key', expected: 'parts' },
        { path: 'policy.delegation.parts', rule: 'invalid-value', expected: 'nonempty-unique-part-array' },
      ]);
      expect(existsSync(join(d, 'review-run-state.json'))).toBe(false);
    }

    // 2. Non-array parts, empty parts, and non-string parts entries ([1], [null], [{}])
    for (const badParts of ['maintainability', {}, [], [1], [null], [{}]] as const) {
      const d = newDir();
      const res = callCmd(d, 'start', mkStart(881, {
        policy: {
          value: REAL_POLICY_LINE,
          source: 'caller prompt',
          delegation: { status: 'active', parts: badParts, config: sha256('cfg'), tools: [] },
        },
      }));
      expect(res.json.reason).toBe('invalid-input');
      expect(res.json.detail.violations).toEqual([
        { path: 'policy.delegation.parts', rule: 'invalid-value', expected: 'nonempty-unique-part-array' },
      ]);
      expect(existsSync(join(d, 'review-run-state.json'))).toBe(false);
    }

    // 3. Omitted tools stores [] and replays against explicit tools: []
    {
      const d = newDir();
      const omittedToolsStart = mkStart(882, {
        policy: {
          value: REAL_POLICY_LINE,
          source: 'caller prompt',
          delegation: { status: 'active', parts: ['maintainability', 'red-team'], config: sha256('cfg') },
        },
      });
      const r1 = callCmd(d, 'start', omittedToolsStart);
      expect(r1.json.reason).toBe('recorded');
      const stored = JSON.parse(readFileSync(join(d, 'review-run-state.json'), 'utf8')) as ReviewRunState;
      expect(stored.policy.delegation).toEqual({
        status: 'active',
        parts: ['specialist:maintainability', 'red-team'],
        config: sha256('cfg'),
        tools: [],
      });
      const r2 = callCmd(d, 'start', {
        ...omittedToolsStart,
        policy: {
          ...omittedToolsStart.policy,
          delegation: { status: 'active', parts: ['maintainability', 'red-team'], config: sha256('cfg'), tools: [] },
        },
      });
      expect(r2.json.reason).toBe('replayed');
    }

    // 4. Malformed or unknown tools and normalized tools uniqueness
    for (const badTools of [
      'maintainability',
      [1],
      ['unknown-part'],
      ['maintainability', 'specialist:maintainability'],
    ] as const) {
      const d = newDir();
      const res = callCmd(d, 'start', mkStart(883, {
        policy: {
          value: REAL_POLICY_LINE,
          source: 'caller prompt',
          delegation: {
            status: 'active',
            parts: ['maintainability', 'red-team'],
            config: sha256('cfg'),
            tools: badTools,
          },
        },
      }));
      expect(res.json.reason).toBe('invalid-input');
      expect(res.json.detail.violations).toEqual([
        { path: 'policy.delegation.tools', rule: 'invalid-value', expected: 'subset-of-parts' },
      ]);
      expect(existsSync(join(d, 'review-run-state.json'))).toBe(false);
    }

    // 5. Root continuation type advice (null, number, array)
    for (const badCont of [null, 1, []] as const) {
      const d = newDir();
      const res = callCmd(d, 'start', mkStart(884, { continuation: badCont as unknown as Record<string, unknown> }));
      expect(res.json.reason).toBe('invalid-input');
      expect(res.json.detail.violations).toEqual([
        { path: 'continuation', rule: 'invalid-type', expected: 'object' },
      ]);
      expect(res.json.detail.message).toBe('continuation must be {prior_stops, max, continues} (40-hex iff prior_stops>=1)');
      expect(res.json.fix).toBe('Pass continuation as {"prior_stops": 0, "max": <int>, "continues": null} on an initial run, or {"prior_stops": <k>, "max": <int>, "continues": "<40-hex Stopped at SHA>"} when prior_stops >= 1 (never {"count", "max"} or prior_stops >= 1 without continues).');
      expect(existsSync(join(d, 'review-run-state.json'))).toBe(false);
    }
  });

  // Value: protects=RENDER_EXAMPLES in src/review-state/render.ts against real executeRender validation; fails_when=any RENDER_EXAMPLES entry (full-receipt, comment, body, final) fails to render in order when only placeholder sha256 digests are replaced with the real file digests; why_new=Track 83A T6 (AC5); seam=CLI and src/review-state/render.ts; no_claim=installed-agent execution
  test('RENDER_EXAMPLES render in sequence through real validation in a fixture repository', () => {
    const d = newDir();
    expect(callCmd(d, 'start', mkStart(885)).json.reason).toBe('recorded');
    expect(callCmd(d, 'record gate', {
      gate_id: uid(886),
      name: 'greptile',
      result: 'not-run',
      candidate: { commit: headSha, base: baseSha },
      details: { value: 'skipped — no root configuration; do not run it', run: null },
    }).json.reason).toBe('recorded');
    expect(callCmd(d, 'checkpoint', {
      checkpoint_id: uid(887),
      kind: 'ready',
      base: baseSha,
    }).json.reason).toBe('recorded');

    const sectionsContent = '### Verification\nAll targeted tests passed.\n';
    const summaryContent = 'Align run-state call documentation and helper evidence paths.\n';
    writeFileSync(join(d, 'sections.md'), sectionsContent);
    writeFileSync(join(d, 'summary.md'), summaryContent);
    const sectionsSha = sha256(sectionsContent);
    const summarySha = sha256(summaryContent);

    // 1. render (full-receipt)
    const fullExample = structuredClone(RENDER_EXAMPLES['render (full-receipt)']);
    fullExample.sections[0] = { ...fullExample.sections[0]!, sha256: sectionsSha };
    const rFull = callCmd(d, 'render', fullExample);
    expect(rFull.code).toBe(0);
    expect(rFull.json.schema).toBe(RENDER_SCHEMA);
    expect(rFull.json.files[0].path).toBe(join(d, RENDER_EXAMPLES['render (comment)'].full_receipt.path));
    const fullReceiptSha = rFull.json.files[0].sha256 as string;

    // 2. render (comment)
    const commentExample = structuredClone(RENDER_EXAMPLES['render (comment)']);
    commentExample.full_receipt = { ...commentExample.full_receipt, sha256: fullReceiptSha };
    const rComment = callCmd(d, 'render', commentExample);
    expect(rComment.code).toBe(0);
    expect(rComment.json.schema).toBe(RENDER_SCHEMA);
    expect(rComment.json.files[0].path).toBe(join(d, RENDER_EXAMPLES['render (final)'].comment_file.path));
    const commentReceiptSha = rComment.json.files[0].sha256 as string;

    // 3. render (body)
    const bodyExample = structuredClone(RENDER_EXAMPLES['render (body)']);
    bodyExample.full_receipt = { ...bodyExample.full_receipt, sha256: fullReceiptSha };
    bodyExample.summary = { ...bodyExample.summary, sha256: summarySha };
    const rBody = callCmd(d, 'render', bodyExample);
    expect(rBody.code).toBe(0);
    expect(rBody.json.schema).toBe(RENDER_SCHEMA);
    expect(rBody.json.files[0].path).toBe(join(d, 'pr-body-1.md'));

    // Record finish prepared with readiness_confirmed_at
    expect(callCmd(d, 'finish', {
      outcome: 'prepared',
      base: baseSha,
      wtree: null,
      review_restriction_resolved: false,
      readiness_confirmed_at: '2026-11-15T18:30:00Z',
    }).json.reason).toBe('recorded');

    // 4. render (final)
    const finalExample = structuredClone(RENDER_EXAMPLES['render (final)']);
    finalExample.full_receipt = { ...finalExample.full_receipt, sha256: fullReceiptSha };
    finalExample.comment_file = { ...finalExample.comment_file, sha256: commentReceiptSha };
    const rFinal = callCmd(d, 'render', finalExample);
    expect(rFinal.code).toBe(0);
    expect(rFinal.json.schema).toBe(RENDER_SCHEMA);
    expect(rFinal.json.files[0].path).toBe(join(d, 'final-1.md'));
  });

  // Value: protects=C7, C8, C14, and C15 observed caller refusals on --input and verifies that the build subcommand records each one cleanly, refuses --finding on a non-completed attempt with the documented reason, and replays on identical reruns reusing the same request file; fails_when=--input accepts a broken C7/C14/C15 payload, build fails to record C7/C8/C14/C15 or writes candidate.tree, build accepts --finding on a failed attempt, or an identical build rerun writes a second request file or fails to replay; why_new=T3 (AC1, AC2, AC7, AC8); seam=CLI, build.ts, store.ts, state.ts
  test('build path records each observed caller refusal (C7, C8, C14, C15)', () => {
    const cfgSha = sha256('build-replay-cfg');
    const planSha = sha256('build-replay-plan');
    const reqFiles = (dir: string) => readdirSync(dir).filter((f) => f.startsWith('request-') && f.endsWith('.json')).sort();

    // C7 & C8 directory
    const d78 = newDir();
    const startArgs78 = [
      'build', 'start', '--dir', d78,
      '--run-id', uid(901),
      '--base', baseSha,
      '--plan-ref', 'docs/plan.md',
      '--plan-sha256', planSha,
      '--policy-value', REAL_POLICY_LINE,
      '--policy-source', 'caller prompt',
      '--delegation-line', `delegation: active (parts=maintainability,adversarial,red-team; config=${cfgSha})`,
      '--max-continuations', '1',
    ];
    expect(runCli(startArgs78).json.reason).toBe('recorded');
    const startReqFiles = reqFiles(d78);
    expect(startReqFiles).toHaveLength(1);
    expect(runCli(startArgs78).json.reason).toBe('replayed');
    expect(reqFiles(d78)).toEqual(startReqFiles);

    // C8: 12 observed voices through build record pass --state started; written request has no tree key, stored candidate.tree is treeSha
    const c8Voices = [
      'core',
      'specialist:testing',
      'specialist:maintainability',
      'specialist:security',
      'specialist:performance',
      'specialist:simplification',
      'specialist:state-machines',
      'red-team',
      'native-adversarial',
      'outside:challenge',
      'outside:structured',
      'qa',
    ];
    const pass78Id = uid(902);
    const c8StartedArgs = [
      'build', 'record', 'pass', '--dir', d78,
      '--pass-id', pass78Id,
      '--state', 'started',
      '--scope', 'local',
      '--cycle', '1',
      '--coverage', 'full',
      '--commit', headSha,
      '--base', baseSha,
      ...c8Voices.flatMap((v) => ['--voice', v]),
    ];
    expect(runCli(c8StartedArgs).json.reason).toBe('recorded');
    const passStartedReqName = reqFiles(d78).find((f) => f.startsWith('request-record-pass-'))!;
    const passStartedReq = JSON.parse(readFileSync(join(d78, passStartedReqName), 'utf8'));
    expect('tree' in passStartedReq.candidate).toBe(false);
    const stAfterC8 = JSON.parse(readFileSync(join(d78, 'review-run-state.json'), 'utf8')) as ReviewRunState;
    expect(stAfterC8.passes[0]!.candidate.tree).toBe(treeSha);
    expect(stAfterC8.passes[0]!.required_voices).toEqual(c8Voices);
    const afterC8ReqFiles = reqFiles(d78);
    expect(runCli(c8StartedArgs).json.reason).toBe('replayed');
    expect(reqFiles(d78)).toEqual(afterC8ReqFiles);

    // C7: observed 10-key hand-written attempt still refuses delegate.call_id missing-key through --input
    const tenKeyDelegate = {
      provider: 'provider-a',
      model: 'model-a',
      outcome: 'credited',
      fallback_reason: null,
      replay: false,
      wall_ms: 28644,
      input_tokens: 26808,
      output_tokens: 2005,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: null,
    };
    const rC7Input = callCmd(d78, 'record pass', {
      pass_id: pass78Id,
      state: 'attempt',
      voice_id: 'specialist:maintainability',
      part: 'specialist:maintainability',
      attempt_id: uid(903),
      outcome: 'completed',
      dispatched_at: '2026-11-15T13:58:49.618Z',
      returned_at: '2026-11-15T13:59:18.262Z',
      delegate: tenKeyDelegate,
      findings: [],
    });
    expect(rC7Input.json.reason).toBe('invalid-input');
    expect(rC7Input.json.detail.violations[0]).toEqual({
      path: 'delegate.call_id',
      rule: 'missing-key',
      expected: 'call_id',
    });

    // C7 via build --delegate-file: runner output with all PART_KEYS records and stores call_id
    const c7CallId = sha256('c7-runner-call');
    writeJson(d78, 'c7-runner.json', {
      v: 1,
      status: 'ran',
      config_sha256: cfgSha,
      parts: [{
        part: 'maintainability',
        ...tenKeyDelegate,
        call_id: c7CallId,
        dispatched: true,
        dispatched_at: '2026-11-15T13:58:49.618Z',
        returned_at: '2026-11-15T13:59:18.262Z',
        parse: 'valid',
        verdict: 'clean',
        findings: [],
      }],
    });
    const c7BuildArgs = [
      'build', 'record', 'pass', '--dir', d78,
      '--pass-id', pass78Id,
      '--state', 'attempt',
      '--voice-id', 'specialist:maintainability',
      '--part', 'specialist:maintainability',
      '--attempt-id', uid(903),
      '--delegate-file', 'c7-runner.json',
    ];
    expect(runCli(c7BuildArgs).json.reason).toBe('recorded');
    const afterC7ReqFiles = reqFiles(d78);
    expect(runCli(c7BuildArgs).json.reason).toBe('replayed');
    expect(reqFiles(d78)).toEqual(afterC7ReqFiles);
    const stAfterC7 = JSON.parse(readFileSync(join(d78, 'review-run-state.json'), 'utf8')) as ReviewRunState;
    const c7Attempt = stAfterC7.passes[0]!.voices.find((v) => v.voice_id === 'specialist:maintainability')!.attempts[0]!;
    expect(c7Attempt.outcome).toBe('completed');
    expect(c7Attempt.delegate?.call_id).toBe(c7CallId);

    // C14 (PR #260's review): 6-voice started pass; --input with severity_rubric "red-team" refuses at findings[0] and findings[1]; build with --delegate-file and --finding records with specialist rubric
    const d14 = newDir();
    expect(runCli([
      'build', 'start', '--dir', d14,
      '--run-id', uid(910),
      '--base', baseSha,
      '--plan-ref', 'docs/plan.md',
      '--plan-sha256', planSha,
      '--policy-value', REAL_POLICY_LINE,
      '--policy-source', 'caller prompt',
      '--delegation-line', `delegation: active (parts=maintainability,adversarial,red-team; config=${cfgSha})`,
      '--max-continuations', '1',
    ]).json.reason).toBe('recorded');
    const c14PassId = uid(911);
    const c14Voices = ['core', 'specialist:maintainability', 'red-team', 'native-adversarial', 'outside:challenge', 'outside:structured'];
    expect(runCli([
      'build', 'record', 'pass', '--dir', d14,
      '--pass-id', c14PassId,
      '--state', 'started',
      '--scope', 'local',
      '--cycle', '1',
      '--coverage', 'full',
      '--commit', headSha,
      '--base', baseSha,
      ...c14Voices.flatMap((v) => ['--voice', v]),
    ]).json.reason).toBe('recorded');

    const c14CallId = '8c10689dcbac82dba7078666f9297dd78c087c6b820e0861b68d0de17be7ba80';
    const c14RunnerEntry = {
      part: 'red-team',
      provider: 'provider-b',
      model: 'model-b',
      call_id: c14CallId,
      replay: false,
      dispatched: true,
      dispatched_at: '2026-11-15T23:56:52.598Z',
      returned_at: '2026-11-16T00:05:15.656Z',
      wall_ms: 503058,
      input_tokens: 55792,
      output_tokens: 48794,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: null,
      parse: 'valid',
      verdict: 'findings',
      outcome: 'credited',
      fallback_reason: null,
      findings: [{ severity: 'CRITICAL' }, { severity: 'INFORMATIONAL' }],
    };
    const c14AttemptId = uid(912);
    const rC14Input = callCmd(d14, 'record pass', {
      pass_id: c14PassId,
      state: 'attempt',
      voice_id: 'red-team',
      part: 'red-team',
      attempt_id: c14AttemptId,
      outcome: 'completed',
      dispatched_at: '2026-11-15T23:56:52.598Z',
      returned_at: '2026-11-16T00:05:15.656Z',
      delegate: c14RunnerEntry,
      findings: [
        { finding_id: 'red-team-1-1', severity_source: 'CRITICAL', severity_rubric: 'red-team', adjudication: 'unclassified', resolution: 'open', found_by: ['red-team'] },
        { finding_id: 'red-team-1-2', severity_source: 'INFORMATIONAL', severity_rubric: 'red-team', adjudication: 'unclassified', resolution: 'open', found_by: ['red-team'] },
      ],
    });
    expect(rC14Input.json.reason).toBe('invalid-input');
    expect(rC14Input.json.detail.violations).toEqual([
      { path: 'findings[0].severity_rubric', rule: 'invalid-enum', expected: 'core|specialist|adversarial|greptile|gstack-review|other|unknown' },
      { path: 'findings[1].severity_rubric', rule: 'invalid-enum', expected: 'core|specialist|adversarial|greptile|gstack-review|other|unknown' },
    ]);

    writeJson(d14, 'c14-delegate-red-team.json', {
      v: 1,
      status: 'ran',
      config_sha256: cfgSha,
      parts: [c14RunnerEntry],
    });
    const c14BuildArgs = [
      'build', 'record', 'pass', '--dir', d14,
      '--pass-id', c14PassId,
      '--state', 'attempt',
      '--voice-id', 'red-team',
      '--part', 'red-team',
      '--attempt-id', c14AttemptId,
      '--delegate-file', 'c14-delegate-red-team.json',
      '--finding', 'red-team-1-1,CRITICAL,red-team',
      '--finding', 'red-team-1-2,INFORMATIONAL,red-team',
    ];
    expect(runCli(c14BuildArgs).json.reason).toBe('recorded');
    const afterC14ReqFiles = reqFiles(d14);
    expect(runCli(c14BuildArgs).json.reason).toBe('replayed');
    expect(reqFiles(d14)).toEqual(afterC14ReqFiles);
    const stAfterC14 = JSON.parse(readFileSync(join(d14, 'review-run-state.json'), 'utf8')) as ReviewRunState;
    const c14Attempt = stAfterC14.passes[0]!.voices.find((v) => v.voice_id === 'red-team')!.attempts[0]!;
    expect(c14Attempt.outcome).toBe('completed');
    expect(c14Attempt.dispatched_at).toBe('2026-11-15T23:56:52.598Z');
    expect(c14Attempt.returned_at).toBe('2026-11-16T00:05:15.656Z');
    expect(c14Attempt.findings).toEqual([
      {
        finding_id: 'red-team-1-1',
        severity_source: 'critical',
        severity_rubric: 'specialist',
        adjudication: 'unclassified',
        resolution: 'open',
        duplicate_of: null,
        found_by: ['red-team'],
        attribution_reason: null,
        receipt_class: null,
        finding_class: null,
        identity: null,
      },
      {
        finding_id: 'red-team-1-2',
        severity_source: 'info',
        severity_rubric: 'specialist',
        adjudication: 'unclassified',
        resolution: 'open',
        duplicate_of: null,
        found_by: ['red-team'],
        attribution_reason: null,
        receipt_class: null,
        finding_class: null,
        identity: null,
      },
    ]);

    // C15 (PR #261's review): 7-voice started pass; --input with outcome "failed" and findings: [] refuses; build with fell-back runner entry records with outcome "failed", findings: null, and dispatch times; build plus --finding refuses at --finding and leaves state bytes unchanged
    const d15 = newDir();
    expect(runCli([
      'build', 'start', '--dir', d15,
      '--run-id', uid(920),
      '--base', baseSha,
      '--plan-ref', 'docs/plan.md',
      '--plan-sha256', planSha,
      '--policy-value', REAL_POLICY_LINE,
      '--policy-source', 'caller prompt',
      '--delegation-line', `delegation: active (parts=maintainability,adversarial,red-team; config=${cfgSha})`,
      '--max-continuations', '1',
    ]).json.reason).toBe('recorded');
    const c15PassId = uid(921);
    const c15Voices = ['core', 'maintainability', 'red-team', 'qa', 'adversarial', 'outside-challenge', 'outside-structured'];
    expect(runCli([
      'build', 'record', 'pass', '--dir', d15,
      '--pass-id', c15PassId,
      '--state', 'started',
      '--scope', 'local',
      '--cycle', '1',
      '--coverage', 'full',
      '--commit', headSha,
      '--base', baseSha,
      ...c15Voices.flatMap((v) => ['--voice', v]),
    ]).json.reason).toBe('recorded');

    const c15CallId = 'a6941fa45f8725fe86dee1be9c2795c5e7a846d637e7b04ce70120bc4d8bc5f8';
    const c15RunnerEntry = {
      part: 'red-team',
      provider: 'provider-b',
      model: 'model-b',
      call_id: c15CallId,
      replay: false,
      dispatched: true,
      dispatched_at: '2026-11-16T03:18:00.938Z',
      returned_at: '2026-11-16T03:23:46.244Z',
      wall_ms: 345306,
      input_tokens: 36020,
      output_tokens: 29978,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: null,
      parse: 'failed',
      verdict: 'unverified',
      outcome: 'fell-back',
      fallback_reason: 'needs-context',
      findings: [],
    };
    const c15AttemptId = uid(922);
    const rC15Input = callCmd(d15, 'record pass', {
      pass_id: c15PassId,
      state: 'attempt',
      voice_id: 'red-team',
      part: 'red-team',
      attempt_id: c15AttemptId,
      outcome: 'failed',
      delegate: c15RunnerEntry,
      findings: [],
    });
    expect(rC15Input.json.reason).toBe('invalid-input');
    expect(rC15Input.json.detail.violations).toEqual([
      { path: 'findings', rule: 'invalid-value', expected: 'null-when-outcome-not-completed' },
    ]);

    writeJson(d15, 'c15-delegate-red-team.json', {
      v: 1,
      status: 'ran',
      config_sha256: cfgSha,
      parts: [c15RunnerEntry],
    });
    const c15BuildArgs = [
      'build', 'record', 'pass', '--dir', d15,
      '--pass-id', c15PassId,
      '--state', 'attempt',
      '--voice-id', 'red-team',
      '--part', 'red-team',
      '--attempt-id', c15AttemptId,
      '--delegate-file', 'c15-delegate-red-team.json',
    ];
    const state15Path = join(d15, 'review-run-state.json');
    const rC15BadFinding = runCli([...c15BuildArgs, '--finding', 'red-team-1-1,CRITICAL,red-team']);
    expect(rC15BadFinding.code).toBe(0);
    expect(rC15BadFinding.json.reason).toBe('recorded');
    expect(rC15BadFinding.json.detail.overrides).toEqual([
      { flag: '--finding', sent: ['red-team-1-1,CRITICAL,red-team'], used: null, rule: 'null-when-outcome-not-completed' },
    ]);
    const afterC15ReqFiles = reqFiles(d15);
    expect(runCli(c15BuildArgs).json.reason).toBe('replayed');
    expect(reqFiles(d15)).toEqual(afterC15ReqFiles);
    const stAfterC15 = JSON.parse(readFileSync(state15Path, 'utf8')) as ReviewRunState;
    const c15Attempt = stAfterC15.passes[0]!.voices.find((v) => v.voice_id === 'red-team')!.attempts[0]!;
    expect(c15Attempt.outcome).toBe('failed');
    expect(c15Attempt.findings).toBeNull();
    expect(c15Attempt.dispatched_at).toBe('2026-11-16T03:18:00.938Z');
    expect(c15Attempt.returned_at).toBe('2026-11-16T03:23:46.244Z');
  });

  // Value: protects=option/value ownership during --dir extraction; fails_when=a literal --dir/--input value is treated as an option or removing --dir silently stitches an omitted value to a later flag; why_new=review reproduction; seam=CLI and persisted finish
  test('build preserves option values while extracting the state directory', () => {
    for (const reason of ['--dir', '--input']) {
      const d = newDir();
      const start = ['build', 'start', '--dir', d, '--run-id', uid(960), '--base', baseSha, '--plan-ref', 'docs/plan.md', '--plan-sha256', sha256('option-values'), '--policy-source', 'none supplied', '--max-continuations', '1'];
      expect(runCli(start).json.reason).toBe('recorded');
      expect(runCli(['build', 'finish', '--stop-reason', reason, '--dir', d, '--outcome', 'blocked', '--base', baseSha, '--review-restriction-resolved']).json.reason).toBe('recorded');
      const st = JSON.parse(readFileSync(join(d, 'review-run-state.json'), 'utf8')) as ReviewRunState;
      expect(st.finish?.stop_reason).toBe(reason);
      expect(st.finish?.review_restriction_resolved).toBe(true);
    }
    const d = newDir();
    expect(runCli(['build', 'start', '--dir', d, '--run-id', uid(961), '--base', baseSha, '--plan-ref', 'docs/plan.md', '--plan-sha256', sha256('missing-value'), '--policy-source', 'none supplied', '--max-continuations', '1']).json.reason).toBe('recorded');
    const before = readFileSync(join(d, 'review-run-state.json'));
    const bad = runCli(['build', 'finish', '--outcome', 'blocked', '--base', baseSha, '--stop-reason', '--dir', d, '--review-restriction-resolved']);
    expect(bad.code).toBe(2);
    expect(bad.json.reason).toBe('usage');
    expect(readFileSync(join(d, 'review-run-state.json'))).toEqual(before);
  });

  // Value: protects=previous canonical request evidence on an open failure; fails_when=EMFILE before exclusive creation unlinks an existing request; why_new=review reproduction; seam=isolated child CLI and filesystem
  test('build preserves an existing request when opening it fails before creation', () => {
    const d = newDir();
    const args = ['build', 'start', '--dir', d, '--run-id', uid(962), '--base', baseSha, '--plan-ref', 'docs/plan.md', '--plan-sha256', sha256('open-failure'), '--policy-source', 'none supplied', '--max-continuations', '1'];
    expect(runCli(args).json.reason).toBe('recorded');
    const req = join(d, readdirSync(d).find((name) => name.startsWith('request-start-'))!);
    const beforeRequest = readFileSync(req);
    const beforeState = readFileSync(join(d, 'review-run-state.json'));
    const script = `
      import { mock } from 'bun:test';
      import * as fs from 'node:fs';
      const original = { ...fs };
      mock.module('node:fs', () => ({ ...original, openSync(p, ...args) {
        if (String(p).includes('/request-start-')) {
          const error = new Error('injected open failure'); error.code = 'EMFILE'; error.syscall = 'open'; throw error;
        }
        return original.openSync(p, ...args);
      }}));
      const { main } = await import(process.argv[1]);
      const code = main(JSON.parse(process.argv[2]), { cwd: process.argv[3], stdout: s => process.stdout.write(s), stderr: s => process.stderr.write(s) });
      process.exit(code);
    `;
    const child = spawnWithFileOutput('bun', ['--no-env-file', '--config=/dev/null', '-e', script, join(REPO_ROOT, 'src/review-state/cli.ts'), JSON.stringify(args), repo], { env: GIT_ENV, encoding: 'utf8', timeout: 10000 });
    expect(child.status).toBe(3);
    expect(JSON.parse(child.stdout).reason).toBe('unwritable');
    expect(existsSync(req)).toBe(true);
    expect(readFileSync(req)).toEqual(beforeRequest);
    expect(readFileSync(join(d, 'review-run-state.json'))).toEqual(beforeState);
  });

  // Value: protects=build refusal rules, table-order deterministic request serialization, parseDelegationLine round-trip against renderDelegationPolicyLine, and build --help coverage; fails_when=unknown/duplicate/missing flags or bad evidence/delegate/delegation inputs are accepted or create a state file, flag order changes serialized bytes, parseDelegationLine fails to invert renderDelegationPolicyLine, or build --help omits a command or pass state; why_new=T3 (AC1, AC2, AC7, AC8); seam=CLI, build.ts, render.ts
  test('build refusals, flag order and delegation-line round trip', () => {
    const d = newDir();
    const statePath = join(d, 'review-run-state.json');
    writeFileSync(join(d, 'multi-parts.json'), JSON.stringify({
      v: 1,
      status: 'ran',
      config_sha256: sha256('cfg'),
      parts: [],
    }));
    writeFileSync(join(d, 'bad-json.json'), '{not-json');

    // Usage refusals: unknown flag, duplicate scalar flag, value-less flag, build --input, bare build record
    for (const [argv, expectedCommand, expectedMsg] of [
      [['build', 'start', '--dir', d, '--unknown'], 'start', 'unknown argument --unknown'],
      [['build', 'start', '--dir', d, '--run-id', uid(1), '--run-id', uid(2)], 'start', 'duplicate --run-id flag'],
      [['build', 'start', '--dir', d, '--run-id'], 'start', '--run-id requires a value'],
      [['build', 'finish', '--dir', d, '--review-restriction-resolved', '--review-restriction-resolved'], 'finish', 'duplicate --review-restriction-resolved flag'],
      [['build', 'start', '--dir', d, '--input', join(d, 'multi-parts.json')], 'start', 'build does not accept --input'],
      [['build', '--input', join(d, 'multi-parts.json')], 'build', 'build does not accept --input'],
      [['build', 'record', '--dir', d], 'record', 'unknown command "record"'],
      [['build', '--dir', d], 'build', 'unknown command "build"'],
      [['build', 'start'], 'start', '--dir is required'],
    ] as const) {
      const res = runCli([...argv]);
      expect(res.code, argv.join(' ')).toBe(2);
      expect(res.json.reason).toBe('usage');
      expect(res.json.command).toBe(expectedCommand);
      expect(res.json.detail).toEqual({ message: expectedMsg });
      expect(existsSync(statePath)).toBe(false);
    }

    // Invalid-input refusals: missing required flag, missing/invalid --state, checkDirFile rules, no-matching-part, invalid-json delegate file, malformed --delegation-line, mutually exclusive full_review_evidence
    for (const [argv, expectedViolation] of [
      [
        ['build', 'start', '--dir', d, '--base', baseSha, '--plan-ref', 'docs/plan.md', '--plan-sha256', sha256('p'), '--policy-source', 'none supplied', '--max-continuations', '1'],
        { path: '--run-id', rule: 'missing-flag', expected: 'run_id' },
      ],
      [
        ['build', 'record', 'pass', '--dir', d, '--pass-id', uid(1)],
        { path: '--state', rule: 'missing-flag', expected: 'state' },
      ],
      [
        ['build', 'record', 'pass', '--dir', d, '--pass-id', uid(1), '--state', 'bogus'],
        { path: '--state', rule: 'invalid-enum', expected: 'started|attempt|voice-complete|completed' },
      ],
      [
        ['build', 'checkpoint', '--dir', d, '--checkpoint-id', uid(2), '--kind', 'ready', '--base', baseSha, '--evidence', '../outside.txt'],
        { path: '--evidence', rule: 'evidence-outside-dir', expected: 'valid-evidence-file-in-dir' },
      ],
      [
        ['build', 'checkpoint', '--dir', d, '--checkpoint-id', uid(2), '--kind', 'ready', '--base', baseSha, '--evidence', 'missing.txt'],
        { path: '--evidence', rule: 'evidence-missing', expected: 'valid-evidence-file-in-dir' },
      ],
      [
        ['build', 'record', 'pass', '--dir', d, '--pass-id', uid(1), '--state', 'attempt', '--voice-id', 'red-team', '--part', 'red-team', '--attempt-id', uid(3), '--delegate-file', 'multi-parts.json'],
        { path: '--delegate-file', rule: 'no-matching-part', expected: 'single-parts-entry-for-red-team' },
      ],
      [
        ['build', 'record', 'pass', '--dir', d, '--pass-id', uid(1), '--state', 'attempt', '--voice-id', 'red-team', '--attempt-id', uid(3), '--delegate-file', 'multi-parts.json'],
        { path: '--part', rule: 'missing-flag', expected: 'part' },
      ],
      [
        ['build', 'record', 'pass', '--dir', d, '--pass-id', uid(1), '--state', 'attempt', '--voice-id', 'red-team', '--part', 'red-team', '--attempt-id', uid(3), '--delegate-file', 'bad-json.json'],
        { path: '--delegate-file', rule: 'invalid-json', expected: 'valid-json-object' },
      ],
      [
        ['build', 'start', '--dir', d, '--run-id', uid(1), '--base', baseSha, '--plan-ref', 'docs/plan.md', '--plan-sha256', sha256('p'), '--policy-source', 'caller prompt', '--delegation-line', 'delegation: malformed', '--max-continuations', '1'],
        { path: '--delegation-line', rule: 'invalid-value', expected: 'delegation: active (parts=...; config=...[; tools=...])|delegation: inactive \u2014 <reason>' },
      ],
      [
        ['build', 'finish', '--dir', d, '--outcome', 'stopped', '--base', baseSha, '--stop-reason', 'cap', '--delta-base', headSha, '--stop-count', '1', '--full-review-commit', headSha, '--full-review-tree', treeSha, '--full-review-source', 'https://example.com/1', '--full-review-unavailable', 'missing'],
        { path: '--full-review-unavailable', rule: 'invalid-value', expected: 'mutually-exclusive-with-full-review-commit-tree-source' },
      ],
    ] as const) {
      const res = runCli([...argv]);
      expect(res.code, argv.join(' ')).toBe(1);
      expect(res.json.reason).toBe('invalid-input');
      expect(res.json.detail.violations).toEqual([expectedViolation]);
      expect(existsSync(statePath)).toBe(false);
    }

    // Same flags in two orders write identical bytes and replay
    const dOrder1 = newDir();
    const dOrder2 = newDir();
    const orderA = [
      '--run-id', uid(950),
      '--base', baseSha,
      '--wtree', 'wt:clean',
      '--gh-login', 'octocat',
      '--plan-ref', 'docs/plan.md',
      '--plan-sha256', sha256('order-plan'),
      '--policy-value', REAL_POLICY_LINE,
      '--policy-source', 'caller prompt',
      '--prior-stops', '1',
      '--max-continuations', '2',
      '--continues', headSha,
      '--session-id', `extend-${uid(951)}`,
    ];
    const orderB = [
      '--session-id', `extend-${uid(951)}`,
      '--continues', headSha,
      '--max-continuations', '2',
      '--prior-stops', '1',
      '--policy-source', 'caller prompt',
      '--policy-value', REAL_POLICY_LINE,
      '--plan-sha256', sha256('order-plan'),
      '--plan-ref', 'docs/plan.md',
      '--gh-login', 'octocat',
      '--wtree', 'wt:clean',
      '--base', baseSha,
      '--run-id', uid(950),
    ];
    expect(buildRequest('start', orderA, dOrder1)).toEqual(buildRequest('start', orderB, dOrder2));
    expect(runCli(['build', 'start', '--dir', dOrder1, ...orderA]).json.reason).toBe('recorded');
    expect(runCli(['build', 'start', '--dir', dOrder2, ...orderB]).json.reason).toBe('recorded');
    const reqFile1 = readdirSync(dOrder1).find((f) => f.startsWith('request-start-'))!;
    const reqFile2 = readdirSync(dOrder2).find((f) => f.startsWith('request-start-'))!;
    expect(reqFile1).toBe(reqFile2);
    expect(readFileSync(join(dOrder1, reqFile1), 'utf8')).toBe(readFileSync(join(dOrder2, reqFile2), 'utf8'));
    expect(runCli(['build', 'start', '--dir', dOrder1, ...orderB]).json.reason).toBe('replayed');

    // parseDelegationLine(renderDelegationPolicyLine(d)) round-trip
    const activeWithTools: DelegationPolicy = {
      status: 'active',
      parts: ['specialist:maintainability', 'native-adversarial', 'red-team'],
      config: sha256('del-cfg-tools'),
      tools: ['specialist:maintainability', 'red-team'],
    };
    const activeWithoutTools: DelegationPolicy = {
      status: 'active',
      parts: ['specialist:testing', 'specialist:performance', 'native-adversarial'],
      config: sha256('del-cfg-no-tools'),
      tools: [],
    };
    const inactiveDel: DelegationPolicy = {
      status: 'inactive',
      reason: 'no Review delegates line',
    };
    for (const del of [activeWithTools, activeWithoutTools, inactiveDel]) {
      const rendered = renderDelegationPolicyLine(del);
      expect(rendered).not.toBeNull();
      expect(parseDelegationLine(rendered)).toEqual(del);
    }

    // rubricForPart mapping
    expect(rubricForPart('core')).toBe('core');
    expect(rubricForPart('specialist:maintainability')).toBe('specialist');
    expect(rubricForPart('red-team')).toBe('specialist');
    expect(rubricForPart('native-adversarial')).toBe('adversarial');
    expect(rubricForPart('greptile')).toBe('greptile');
    expect(rubricForPart('qa')).toBe('other');
    expect(rubricForPart('outside:challenge')).toBe('other');
    expect(rubricForPart('outside:structured')).toBe('other');
    expect(rubricForPart(undefined)).toBe('unknown');

    // build --help has a section for every BUILD_COMMANDS entry and every record pass state
    const helpRes = runCli(['build', '--help']);
    expect(helpRes.code).toBe(0);
    expect(helpRes.out).toBe(buildHelp());
    for (const cmd of BUILD_COMMANDS) {
      if (cmd === 'record pass') {
        for (const st of PASS_STATES) {
          expect(helpRes.out).toContain(`record pass (--state ${st}):\n  required:`);
        }
      } else {
        expect(helpRes.out).toContain(`${cmd}:\n  required:`);
      }
    }
  });

  test("replays PR #263's rejected correction (C16): build overrides a contradicting --resolution with unknown, warns and records", () => {
    const d = newDir(), passId = '002d2488-ed60-4d4f-9b83-01720b1d42ca', attId = 'ec9b7710-cdcf-4ab5-8bc3-7dc7ee7e3dc7', a4Id = '31e0b113-1473-43e6-b717-e50b99491811';
    const reqFiles = () => readdirSync(d).filter((f) => f.startsWith('request-') && f.endsWith('.json')).sort();
    expect(runCli(['build', 'start', '--dir', d, '--run-id', uid(970), '--base', baseSha, '--plan-ref', 'docs/plan.md', '--plan-sha256', sha256('pr263'), '--policy-source', 'caller prompt', '--max-continuations', '1']).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', d, '--pass-id', passId, '--state', 'started', '--scope', 'local', '--cycle', '1', '--coverage', 'full', '--commit', headSha, '--base', baseSha, '--voice', 'native-adversarial']).json.reason).toBe('recorded');
    expect(runCli([
      'build', 'record', 'pass', '--dir', d, '--pass-id', passId, '--state', 'attempt', '--voice-id', 'native-adversarial', '--part', 'native-adversarial', '--attempt-id', attId, '--outcome', 'completed',
      '--finding', 'A1,critical,native-adversarial', '--finding', 'A2,critical,native-adversarial', '--finding', 'A3,info,native-adversarial', '--finding', 'A4,info,native-adversarial', '--finding', 'A5,info,native-adversarial',
    ]).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', d, '--pass-id', passId, '--state', 'voice-complete', '--voice-id', 'native-adversarial', '--selected-attempt-id', attId]).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', d, '--pass-id', passId, '--state', 'completed']).json.reason).toBe('recorded');
    for (const [cid, fid] of [['9ae507ca-9129-4636-b395-e69dd1345ea0', 'A1'], ['9efef6f0-38a1-4544-bb8e-546c554d97f0', 'A2'], ['899ed21a-0b85-4f72-b29c-556a97c75861', 'A3']] as const) {
      expect(runCli(['build', 'record', 'correction', '--dir', d, '--correction-id', cid, '--pass-id', passId, '--voice-id', 'native-adversarial', '--attempt-id', attId, '--finding-id', fid, '--adjudication', 'accepted', '--resolution', 'fixed', '--fixed-in', headSha]).json.reason).toBe('recorded');
    }

    const dInput = newDir();
    copyFileSync(join(d, 'review-run-state.json'), join(dInput, 'review-run-state.json'));
    const baseA4 = ['build', 'record', 'correction', '--dir', d, '--correction-id', a4Id, '--pass-id', passId, '--voice-id', 'native-adversarial', '--attempt-id', attId, '--finding-id', 'A4', '--adjudication', 'rejected'];
    const rA4 = runCli([...baseA4, '--resolution', 'open']);
    expect(rA4.json.reason).toBe('recorded');
    expect(rA4.err).toBe('WARNING BUILD_OVERRIDE: record correction --resolution sent "open"; used "unknown"; rule unknown-when-rejected\n');
    const expectedOverride = [{ flag: '--resolution', sent: 'open', used: 'unknown', rule: 'unknown-when-rejected' }];
    expect(rA4.json.detail.overrides).toEqual(expectedOverride);

    const a4ReqFiles = reqFiles(), logPath = join(d, 'build-overrides.jsonl');
    const logLines1 = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(logLines1).toHaveLength(1);
    expect(logLines1[0]).toMatchObject({ v: 1, command: 'record correction', overrides: expectedOverride });
    expect(a4ReqFiles).toContain(logLines1[0].request);
    expect(JSON.parse(readFileSync(join(d, logLines1[0].request), 'utf8')).resolution).toBe('unknown');

    const rOmit = runCli(baseA4);
    expect([rOmit.json.reason, rOmit.err, rOmit.json.detail.overrides]).toEqual(['replayed', '', undefined]);
    expect(reqFiles()).toEqual(a4ReqFiles);
    expect(readFileSync(logPath, 'utf8').trim().split('\n')).toHaveLength(1);

    const rFixed = runCli([...baseA4, '--resolution', 'fixed']);
    expect(rFixed.json.reason).toBe('replayed');
    expect(rFixed.err).toBe('WARNING BUILD_OVERRIDE: record correction --resolution sent "fixed"; used "unknown"; rule unknown-when-rejected\n');
    expect(readFileSync(logPath, 'utf8').trim().split('\n')).toHaveLength(2);

    const st = JSON.parse(readFileSync(join(d, 'review-run-state.json'), 'utf8')) as ReviewRunState;
    expect(st.corrections.find((c) => c.correction_id === a4Id)?.resolution).toBe('unknown');
    expect(unresolvedFindings(st)).toEqual(['A5 info']);

    const rRaw = callCmd(dInput, 'record correction', { correction_id: a4Id, target: { pass_id: passId, voice_id: 'native-adversarial', attempt_id: attId, finding_id: 'A4' }, adjudication: 'rejected', resolution: 'open' });
    expect(rRaw.json.reason).toBe('invalid-input');
    expect(rRaw.json.detail.violations).toEqual([{ path: 'resolution', rule: 'invalid-value', expected: 'unknown-when-rejected' }]);
    expect(readFileSync(join(REPO_ROOT, 'docs', 'review-run-state-calls.md'), 'utf8')).toContain(
      'With `--adjudication rejected`, omit `--resolution`: the helper writes `unknown`, and any other `--resolution` is replaced with `unknown` and reported as an override.',
    );
  });

  test('legacy rejecting corrections keep omitted resolution on new calls and replay after upgrade', () => {
    const target = { pass_id: uid(10), voice_id: 'core', attempt_id: uid(20), finding_id: 'F-1' };
    const args = (dir: string, id: string, supersedes: string) => ['build', 'record', 'correction', '--dir', dir, '--correction-id', id, '--pass-id', target.pass_id, '--voice-id', target.voice_id, '--attempt-id', target.attempt_id, '--finding-id', target.finding_id, '--adjudication', 'rejected', '--supersedes', supersedes];
    for (const legacyRecorded of [true, false]) {
      const { dir: d, statePath } = dirFromSeed(ensureRefusalSeeds().attemptState);
      const prior = uid(1001), id = uid(1002);
      expect(callCmd(d, 'record correction', { correction_id: prior, target, resolution: 'unknown' }).json.reason).toBe('recorded');
      // Exact pre-change builder request: resolution is absent, so the store inherits unknown.
      const legacyRequest = { correction_id: id, target, adjudication: 'rejected', supersedes: prior };
      const legacyBytes = `${JSON.stringify(legacyRequest)}\n`;
      const requestName = `request-record-correction-${sha256(legacyBytes).slice(0, 16)}.json`;
      if (legacyRecorded) {
        writeFileSync(join(d, requestName), legacyBytes);
        expect(runCli(['record', 'correction', '--dir', d, '--input', join(d, requestName)]).json.reason).toBe('recorded');
      }
      const before = readFileSync(statePath, 'utf8');
      const r = runCli(args(d, id, prior));
      expect([r.json.reason, r.err, r.json.detail.overrides]).toEqual([legacyRecorded ? 'replayed' : 'recorded', '', undefined]);
      expect(readFileSync(join(d, requestName), 'utf8')).toBe(legacyBytes);
      if (legacyRecorded) expect(readFileSync(statePath, 'utf8')).toBe(before);
      const recorded = readFileSync(statePath, 'utf8');
      expect(runCli(args(d, id, prior)).json.reason).toBe('replayed');
      expect(readFileSync(statePath, 'utf8')).toBe(recorded);
      expect(JSON.parse(recorded).corrections.at(-1).resolution).toBeNull();
      expect(existsSync(join(d, 'build-overrides.jsonl'))).toBe(false);
      const requestFiles = readdirSync(d).filter((f) => f.startsWith('request-')).sort();
      const override = runCli([...args(d, id, prior), '--resolution', 'open']);
      expect(override.json.reason).toBe('replayed');
      expect(override.json.detail.overrides).toEqual([{ flag: '--resolution', sent: 'open', used: null, rule: 'unknown-when-rejected' }]);
      expect(override.err).toContain('used null; rule unknown-when-rejected');
      expect(readdirSync(d).filter((f) => f.startsWith('request-')).sort()).toEqual(requestFiles);
      expect(readFileSync(statePath, 'utf8')).toBe(recorded);
      // A later correction must not change how the earlier request is rebuilt for replay.
      expect(callCmd(d, 'record correction', { correction_id: uid(1003), target, adjudication: 'accepted', resolution: 'open', supersedes: id }).json.reason).toBe('recorded');
      expect(runCli(args(d, id, prior)).json.reason).toBe('replayed');
    }
  });

  test('unsafe override log targets warn without blocking recording or changing linked files', () => {
    for (const kind of ['fifo', 'directory', 'symlink', 'hardlink']) {
      const { dir: d, statePath } = dirFromSeed(ensureRefusalSeeds().attemptState);
      const log = join(d, 'build-overrides.jsonl'), sentinel = join(d, 'sentinel');
      writeFileSync(sentinel, 'unchanged\n');
      if (kind === 'fifo') expect(spawnSync('mkfifo', [log], { env: GIT_ENV }).status).toBe(0);
      else if (kind === 'directory') mkdirSync(log);
      else if (kind === 'symlink') symlinkSync(sentinel, log);
      else linkSync(sentinel, log);
      const r = spawnWithFileOutput(BIN_PATH, ['build', 'record', 'correction', '--dir', d, '--correction-id', uid(1004), '--pass-id', uid(10), '--voice-id', 'core', '--attempt-id', uid(20), '--finding-id', 'F-1', '--adjudication', 'rejected', '--resolution', 'open'], { cwd: repo, env: GIT_ENV, encoding: 'utf8', timeout: 2000 });
      expect(r.status, kind).toBe(0);
      const result = JSON.parse(r.stdout);
      expect(result.reason).toBe('recorded');
      expect(result.detail.overrides).toEqual([{ flag: '--resolution', sent: 'open', used: 'unknown', rule: 'unknown-when-rejected' }]);
      expect(r.stderr).toContain('WARNING BUILD_OVERRIDE_LOG:');
      expect(r.stderr).toContain('WARNING BUILD_OVERRIDE: record correction --resolution');
      expect(readFileSync(sentinel, 'utf8')).toBe('unchanged\n');
      expect(JSON.parse(readFileSync(statePath, 'utf8')).corrections.at(-1).resolution).toBe('unknown');
    }
  });

  test('a fresh rejecting correction derives unknown without a resolution flag or override', () => {
    const { dir: d, statePath } = dirFromSeed(ensureRefusalSeeds().attemptState);
    const args = ['build', 'record', 'correction', '--dir', d, '--correction-id', uid(1005), '--pass-id', uid(10), '--voice-id', 'core', '--attempt-id', uid(20), '--finding-id', 'F-1', '--adjudication', 'rejected'];
    const r = runCli(args);
    expect([r.json.reason, r.err, r.json.detail.overrides]).toEqual(['recorded', '', undefined]);
    expect(JSON.parse(readFileSync(statePath, 'utf8')).corrections.at(-1).resolution).toBe('unknown');
    const request = readdirSync(d).find((f) => f.startsWith('request-record-correction-'))!;
    expect(JSON.parse(readFileSync(join(d, request), 'utf8')).resolution).toBe('unknown');
    expect(runCli(args).json.reason).toBe('replayed');
    expect(existsSync(join(d, 'build-overrides.jsonl'))).toBe(false);
  });

  test("build record correction derives supersedes from the target finding's latest correction", () => {
    const { dir: d, statePath } = dirFromSeed(ensureRefusalSeeds().attemptState);
    const c1 = uid(1011), c2 = uid(1012), c3 = uid(1013);
    const baseArgs = (dir: string, id: string) => ['build', 'record', 'correction', '--dir', dir, '--correction-id', id, '--pass-id', uid(10), '--voice-id', 'core', '--attempt-id', uid(20), '--finding-id', 'F-1'];
    const reqFiles = (dir: string) => readdirSync(dir).filter((f) => f.startsWith('request-record-correction-') && f.endsWith('.json')).sort();

    const r1 = runCli([...baseArgs(d, c1), '--receipt-class', 'non-blocking']);
    expect([r1.json.reason, r1.err, r1.json.detail.overrides]).toEqual(['recorded', '', undefined]);
    const [req1] = reqFiles(d);
    expect('supersedes' in JSON.parse(readFileSync(join(d, req1!), 'utf8'))).toBe(false);

    const dExplicit = newDir();
    copyFileSync(statePath, join(dExplicit, 'review-run-state.json'));

    const c2Args = (dir: string) => [...baseArgs(dir, c2), '--resolution', 'fixed', '--fixed-in', headSha];
    const r2 = runCli(c2Args(d));
    expect([r2.json.reason, r2.err, r2.json.detail.overrides]).toEqual(['recorded', '', undefined]);
    const req2 = reqFiles(d).find((f) => f !== req1)!;
    const req2Bytes = readFileSync(join(d, req2), 'utf8');
    expect(JSON.parse(req2Bytes).supersedes).toBe(c1);

    const r2Explicit = runCli([...c2Args(dExplicit), '--supersedes', c1]);
    expect([r2Explicit.json.reason, r2Explicit.err, r2Explicit.json.detail.overrides]).toEqual(['recorded', '', undefined]);
    expect(reqFiles(dExplicit)).toEqual([req2]);
    expect(readFileSync(join(dExplicit, req2), 'utf8')).toBe(req2Bytes);

    const r3 = runCli([...baseArgs(d, c3), '--adjudication', 'rejected']);
    expect([r3.json.reason, r3.err, r3.json.detail.overrides]).toEqual(['recorded', '', undefined]);

    const st = JSON.parse(readFileSync(statePath, 'utf8')) as ReviewRunState;
    expect(st.corrections.map((c) => [c.correction_id, c.supersedes])).toEqual([
      [c1, null],
      [c2, c1],
      [c3, c2],
    ]);

    const r2Replay = runCli(c2Args(d));
    expect([r2Replay.json.reason, r2Replay.err, r2Replay.json.detail.overrides]).toEqual(['replayed', '', undefined]);
    expect(existsSync(join(d, 'build-overrides.jsonl'))).toBe(false);

    const dEmpty = newDir();
    const rNoState = runCli([...c2Args(dEmpty), '--supersedes', c1]);
    expect([rNoState.json.reason, rNoState.json.detail.overrides]).toEqual(['not-started', undefined]);
    expect(rNoState.err).not.toContain('WARNING BUILD_OVERRIDE');
    expect(JSON.parse(readFileSync(join(dEmpty, reqFiles(dEmpty)[0]!), 'utf8')).supersedes).toBe(c1);
    expect(existsSync(join(dEmpty, 'build-overrides.jsonl'))).toBe(false);
  });

  test('build overrides a contradicting --supersedes with the latest correction, warns, logs and records', () => {
    const reqFiles = (dir: string) => readdirSync(dir).filter((f) => f.startsWith('request-record-correction-') && f.endsWith('.json')).sort();
    const baseArgs = (dir: string, id: string) => ['build', 'record', 'correction', '--dir', dir, '--correction-id', id, '--pass-id', uid(10), '--voice-id', 'core', '--attempt-id', uid(20), '--finding-id', 'F-1'];

    // Case 1: prior corrections A then B; sending --supersedes A overrides with B.
    const { dir: d1, statePath: sp1 } = dirFromSeed(ensureRefusalSeeds().attemptState);
    const idA = uid(1014), idB = uid(1015), idC = uid(1016);
    expect(runCli([...baseArgs(d1, idA), '--receipt-class', 'non-blocking']).json.reason).toBe('recorded');
    expect(runCli([...baseArgs(d1, idB), '--resolution', 'fixed', '--fixed-in', headSha]).json.reason).toBe('recorded');
    const beforeFiles1 = new Set(reqFiles(d1));
    const rC = runCli([...baseArgs(d1, idC), '--adjudication', 'rejected', '--supersedes', idA]);
    const ov1 = { flag: '--supersedes', sent: idA, used: idB, rule: 'latest-correction-on-finding' };
    expect(rC.json.reason).toBe('recorded');
    expect(rC.err).toBe(`WARNING BUILD_OVERRIDE: record correction --supersedes sent "${idA}"; used "${idB}"; rule latest-correction-on-finding\n`);
    expect(rC.json.detail.overrides).toEqual([ov1]);
    const written1 = reqFiles(d1).find((f) => !beforeFiles1.has(f))!;
    expect(JSON.parse(readFileSync(join(d1, written1), 'utf8')).supersedes).toBe(idB);
    expect(JSON.parse(readFileSync(sp1, 'utf8')).corrections.at(-1).supersedes).toBe(idB);
    const log1 = readFileSync(join(d1, 'build-overrides.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(log1).toHaveLength(1);
    expect(log1[0]).toMatchObject({ v: 1, command: 'record correction', request: written1, overrides: [ov1] });

    // Case 2: no prior correction on finding; sending --supersedes <uuid> overrides with null and omits the key.
    const { dir: d2, statePath: sp2 } = dirFromSeed(ensureRefusalSeeds().attemptState);
    const idFirst = uid(1017), wrongSup = uid(1018);
    const rFirst = runCli([...baseArgs(d2, idFirst), '--receipt-class', 'non-blocking', '--supersedes', wrongSup]);
    const ov2 = { flag: '--supersedes', sent: wrongSup, used: null, rule: 'latest-correction-on-finding' };
    expect(rFirst.json.reason).toBe('recorded');
    expect(rFirst.err).toBe(`WARNING BUILD_OVERRIDE: record correction --supersedes sent "${wrongSup}"; used null; rule latest-correction-on-finding\n`);
    expect(rFirst.json.detail.overrides).toEqual([ov2]);
    const [written2] = reqFiles(d2);
    expect('supersedes' in JSON.parse(readFileSync(join(d2, written2!), 'utf8'))).toBe(false);
    expect(JSON.parse(readFileSync(sp2, 'utf8')).corrections.at(-1).supersedes).toBeNull();
    const log2 = readFileSync(join(d2, 'build-overrides.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(log2).toHaveLength(1);
    expect(log2[0]).toMatchObject({ v: 1, command: 'record correction', request: written2, overrides: [ov2] });
  });

  test("replays PR #265's second correction (C17): build derives supersedes from the latest correction and records", () => {
    const d = newDir();
    const passId = '06902024-e629-4744-af53-bf92081e6d4f';
    const attId = 'ee603c57-7c31-496b-9d4b-0dbee7f584db';
    const firstId = '4eeb9d41-c35a-44be-af02-2b29cdf98dc1';
    const secondId = '83223003-c274-4ba7-af50-7c99e4a4a356';
    expect(runCli(['build', 'start', '--dir', d, '--run-id', uid(1019), '--base', baseSha, '--plan-ref', 'docs/plan.md', '--plan-sha256', sha256('pr265'), '--policy-source', 'caller prompt', '--max-continuations', '1']).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', d, '--pass-id', passId, '--state', 'started', '--scope', 'local', '--cycle', '1', '--coverage', 'full', '--commit', headSha, '--base', baseSha, '--voice', 'native-adversarial']).json.reason).toBe('recorded');
    expect(runCli([
      'build', 'record', 'pass', '--dir', d, '--pass-id', passId, '--state', 'attempt', '--voice-id', 'native-adversarial', '--part', 'native-adversarial', '--attempt-id', attId, '--outcome', 'completed',
      '--finding', 'A1,high,native-adversarial', '--finding', 'A2,medium,native-adversarial',
    ]).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', d, '--pass-id', passId, '--state', 'voice-complete', '--voice-id', 'native-adversarial', '--selected-attempt-id', attId]).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', d, '--pass-id', passId, '--state', 'completed']).json.reason).toBe('recorded');
    expect(runCli([
      'build', 'record', 'correction', '--dir', d, '--correction-id', firstId, '--pass-id', passId, '--voice-id', 'native-adversarial', '--attempt-id', attId, '--finding-id', 'A2',
      '--adjudication', 'accepted', '--resolution', 'open', '--receipt-class', 'non-blocking',
    ]).json.reason).toBe('recorded');

    const dInput = newDir();
    copyFileSync(join(d, 'review-run-state.json'), join(dInput, 'review-run-state.json'));

    const rSecond = runCli([
      'build', 'record', 'correction', '--dir', d, '--correction-id', secondId, '--pass-id', passId, '--voice-id', 'native-adversarial', '--attempt-id', attId, '--finding-id', 'A2',
      '--adjudication', 'rejected',
    ]);
    expect([rSecond.json.reason, rSecond.err, rSecond.json.detail.overrides]).toEqual(['recorded', '', undefined]);
    expect(existsSync(join(d, 'build-overrides.jsonl'))).toBe(false);
    const st = JSON.parse(readFileSync(join(d, 'review-run-state.json'), 'utf8')) as ReviewRunState;
    const storedSecond = st.corrections.find((c) => c.correction_id === secondId);
    expect(storedSecond).toMatchObject({ correction_id: secondId, adjudication: 'rejected', resolution: 'unknown', supersedes: firstId });

    const rRaw = callCmd(dInput, 'record correction', {
      correction_id: secondId,
      target: { pass_id: passId, voice_id: 'native-adversarial', attempt_id: attId, finding_id: 'A2' },
      adjudication: 'rejected',
      resolution: 'unknown',
    });
    expect(rRaw.json.reason).toBe('invalid-input');
    expect(rRaw.json.detail.violations).toEqual([{ path: 'supersedes', rule: 'invalid-reference', expected: firstId }]);
  });

  test('build overrides a flag that contradicts a value the helper fixes, warns, logs and records', () => {
    const reqFiles = (dir: string) => readdirSync(dir).filter((f) => f.startsWith('request-') && f.endsWith('.json')).sort();
    const seedStart = newDir(), seedOpen = newDir(), passId = uid(981);
    const startRes = runCli(['build', 'start', '--dir', seedStart, '--run-id', uid(980), '--base', baseSha, '--plan-ref', 'docs/plan.md', '--plan-sha256', sha256('t2-seed'), '--policy-source', 'none supplied', '--max-continuations', '1']);
    expect([startRes.json.reason, startRes.err, startRes.json.detail.overrides]).toEqual(['recorded', '', undefined]);
    copyFileSync(join(seedStart, 'review-run-state.json'), join(seedOpen, 'review-run-state.json'));
    const openRes = runCli(['build', 'record', 'pass', '--dir', seedOpen, '--pass-id', passId, '--state', 'started', '--scope', 'local', '--cycle', '1', '--coverage', 'full', '--commit', headSha, '--base', baseSha, '--voice', 'core', '--voice', 'red-team']);
    expect([openRes.json.reason, openRes.err, existsSync(join(seedOpen, 'build-overrides.jsonl'))]).toEqual(['recorded', '', false]);

    const tDisp = '2026-11-16T01:00:00Z', tRet = '2026-11-16T01:05:00Z';
    const mkRunner = (outcome: 'credited' | 'fell-back') => ({
      v: 1, status: 'ran', config_sha256: sha256('cfg'),
      parts: [{ part: 'red-team', provider: 'p', model: 'm', call_id: sha256(outcome), replay: false, dispatched: true, dispatched_at: tDisp, returned_at: tRet, wall_ms: 10, input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: null, parse: 'valid', verdict: 'clean', outcome, fallback_reason: outcome === 'credited' ? null : 'failed', findings: [] }],
    });
    const prepDir = (startOnly: boolean) => {
      const d = newDir();
      copyFileSync(join(startOnly ? seedStart : seedOpen, 'review-run-state.json'), join(d, 'review-run-state.json'));
      if (!startOnly) { writeJson(d, 'credited.json', mkRunner('credited')); writeJson(d, 'fell-back.json', mkRunner('fell-back')); writeFileSync(join(d, 'pregate.json'), '{}\n'); writeFileSync(join(d, 'doc.md'), 'ok\n'); }
      return d;
    };

    const rows: Array<{ startOnly?: boolean; emptyDir?: boolean; cmd: string; clean: string[]; extra: string[]; ov: { flag: string; sent: string | string[]; used: string | null; rule: string } }> = [
      { emptyDir: true, cmd: 'start', clean: ['start', '--run-id', uid(982), '--base', baseSha, '--plan-ref', 'docs/plan.md', '--plan-sha256', sha256('p'), '--policy-source', 'none supplied', '--max-continuations', '1'], extra: ['--continues', headSha], ov: { flag: '--continues', sent: headSha, used: null, rule: 'null-when-prior_stops===0' } },
      { cmd: 'record pass', clean: ['record', 'pass', '--pass-id', uid(983), '--state', 'started', '--scope', 'local', '--cycle', '2', '--coverage', 'full', '--commit', headSha, '--voice', 'core'], extra: ['--delta-from', baseSha], ov: { flag: '--delta-from', sent: baseSha, used: null, rule: 'null-when-full' } },
      { cmd: 'record pass', clean: ['record', 'pass', '--pass-id', passId, '--state', 'attempt', '--voice-id', 'red-team', '--part', 'red-team', '--attempt-id', uid(984), '--delegate-file', 'credited.json'], extra: ['--outcome', 'failed'], ov: { flag: '--outcome', sent: 'failed', used: 'completed', rule: 'credited-requires-completed-and-null-fallback_reason' } },
      { cmd: 'record pass', clean: ['record', 'pass', '--pass-id', passId, '--state', 'attempt', '--voice-id', 'red-team', '--part', 'red-team', '--attempt-id', uid(985), '--delegate-file', 'fell-back.json'], extra: ['--outcome', 'completed'], ov: { flag: '--outcome', sent: 'completed', used: 'failed', rule: 'fell-back-requires-failed-and-fallback_reason' } },
      { cmd: 'record pass', clean: ['record', 'pass', '--pass-id', passId, '--state', 'attempt', '--voice-id', 'core', '--part', 'core', '--attempt-id', uid(986), '--outcome', 'failed'], extra: ['--finding', 'F-1,P2,core'], ov: { flag: '--finding', sent: ['F-1,P2,core'], used: null, rule: 'null-when-outcome-not-completed' } },
      { cmd: 'record pass', clean: ['record', 'pass', '--pass-id', passId, '--state', 'attempt', '--voice-id', 'red-team', '--part', 'red-team', '--attempt-id', uid(987), '--delegate-file', 'credited.json'], extra: ['--dispatched-at', '2026-11-16T00:00:00Z'], ov: { flag: '--dispatched-at', sent: '2026-11-16T00:00:00Z', used: tDisp, rule: 'equal-to-attempt-dispatched_at' } },
      { cmd: 'record pass', clean: ['record', 'pass', '--pass-id', passId, '--state', 'attempt', '--voice-id', 'red-team', '--part', 'red-team', '--attempt-id', uid(988), '--delegate-file', 'credited.json'], extra: ['--returned-at', '2026-11-16T00:05:00Z'], ov: { flag: '--returned-at', sent: '2026-11-16T00:05:00Z', used: tRet, rule: 'equal-to-attempt-returned_at' } },
      { cmd: 'record gate', clean: ['record', 'gate', '--gate-id', uid(989), '--name', 'pregate', '--result', 'passed', '--commit', headSha, '--pregate-raw-verdict', 'PASS', '--pregate-wrapper-verdict', 'passed', '--pregate-policy', 'base', '--pregate-record', 'pregate.json'], extra: ['--greptile-value', 'clean'], ov: { flag: '--greptile-value', sent: 'clean', used: null, rule: 'greptile-gate-only' } },
      { cmd: 'record gate', clean: ['record', 'gate', '--gate-id', uid(990), '--name', 'greptile', '--result', 'passed', '--commit', headSha, '--greptile-value', 'clean'], extra: ['--skipped-lane', 'unit'], ov: { flag: '--skipped-lane', sent: ['unit'], used: null, rule: 'pregate-gate-only' } },
      { cmd: 'record gate', clean: ['record', 'gate', '--gate-id', uid(991), '--name', 'probe-1', '--result', 'passed', '--commit', headSha], extra: ['--greptile-run', 'https://example.com/r'], ov: { flag: '--greptile-run', sent: 'https://example.com/r', used: null, rule: 'greptile-gate-only' } },
      { cmd: 'record audit', clean: ['record', 'audit', '--audit-id', uid(992), '--name', 'documentation', '--result', 'passed', '--report-id', 'doc-1', '--section', 'doc.md', '--commit', headSha], extra: ['--coverage-pct', '90'], ov: { flag: '--coverage-pct', sent: '90', used: null, rule: 'coverage-audit-only' } },
      { cmd: 'record audit', clean: ['record', 'audit', '--audit-id', uid(993), '--name', 'coverage', '--result', 'passed', '--coverage-threshold', '80', '--commit', headSha], extra: ['--report-id', 'doc-1'], ov: { flag: '--report-id', sent: 'doc-1', used: null, rule: 'documentation-audit-only' } },
      { cmd: 'checkpoint', clean: ['checkpoint', '--checkpoint-id', uid(994), '--kind', 'ready', '--base', baseSha], extra: ['--session-id', `extend-${uid(994)}`], ov: { flag: '--session-id', sent: `extend-${uid(994)}`, used: null, rule: 'null-when-kind-not-resume' } },
      { startOnly: true, cmd: 'finish', clean: ['finish', '--outcome', 'prepared', '--base', baseSha], extra: ['--stop-reason', 'cap'], ov: { flag: '--stop-reason', sent: 'cap', used: null, rule: 'null-when-prepared' } },
      { startOnly: true, cmd: 'finish', clean: ['finish', '--outcome', 'blocked', '--base', baseSha, '--stop-reason', 'err'], extra: ['--delta-base', baseSha], ov: { flag: '--delta-base', sent: baseSha, used: null, rule: 'null-when-not-stopped' } },
      { startOnly: true, cmd: 'finish', clean: ['finish', '--outcome', 'blocked', '--base', baseSha, '--stop-reason', 'err'], extra: ['--stop-count', '1'], ov: { flag: '--stop-count', sent: '1', used: null, rule: 'null-when-not-stopped' } },
    ];
    expect(rows).toHaveLength(16);
    for (const row of rows) {
      const d = row.emptyDir ? newDir() : prepDir(Boolean(row.startOnly));
      const r1 = runCli(['build', ...row.clean, '--dir', d, ...row.extra]);
      expect(r1.json.reason, row.ov.rule).toBe('recorded');
      expect(r1.err).toBe(`WARNING BUILD_OVERRIDE: ${row.cmd} ${row.ov.flag} sent ${JSON.stringify(row.ov.sent)}; used ${JSON.stringify(row.ov.used)}; rule ${row.ov.rule}\n`);
      expect(r1.json.detail.overrides).toEqual([row.ov]);
      expect(readFileSync(join(d, 'build-overrides.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
      const files1 = reqFiles(d);
      expect(runCli(['build', ...row.clean, '--dir', d]).json.reason, `replay ${row.ov.rule}`).toBe('replayed');
      expect(reqFiles(d)).toEqual(files1);
    }

    const dPos = prepDir(false);
    for (const posArgs of [
      ['build', 'record', 'pass', '--dir', dPos, '--pass-id', uid(995), '--state', 'started', '--scope', 'local', '--cycle', '2', '--coverage', 'delta', '--delta-from', baseSha, '--commit', headSha, '--voice', 'core'],
      ['build', 'record', 'pass', '--dir', dPos, '--pass-id', passId, '--state', 'attempt', '--voice-id', 'red-team', '--part', 'red-team', '--attempt-id', uid(996), '--delegate-file', 'credited.json', '--dispatched-at', tDisp],
      ['build', 'checkpoint', '--dir', dPos, '--checkpoint-id', uid(997), '--kind', 'resume', '--session-id', `extend-${uid(997)}`],
    ]) {
      const rPos = runCli(posArgs);
      expect([rPos.json.reason, rPos.err, rPos.json.detail.overrides]).toEqual(['recorded', '', undefined]);
    }
    expect(existsSync(join(dPos, 'build-overrides.jsonl'))).toBe(false);

    const beforeVcState = readFileSync(join(dPos, 'review-run-state.json'), 'utf8'), beforeVcFiles = reqFiles(dPos);
    const rVc = runCli(['build', 'record', 'pass', '--dir', dPos, '--pass-id', passId, '--state', 'voice-complete', '--voice-id', 'core', '--selected-attempt-id', uid(996), '--not-applicable', 'not-applicable']);
    expect([rVc.code, rVc.json.reason, rVc.json.detail.violations]).toEqual([1, 'invalid-input', [{ path: '--selected-attempt-id', rule: 'invalid-value', expected: 'exactly-one-of-selected_attempt_id-or-not_applicable' }]]);
    expect(reqFiles(dPos)).toEqual(beforeVcFiles);
    expect(readFileSync(join(dPos, 'review-run-state.json'), 'utf8')).toBe(beforeVcState);
  });

  test('design D13 builder coverage table lists every cross-field rule in applyCommand with its handling', () => {
    const src = readFileSync(join(REPO_ROOT, 'src', 'review-state', 'state.ts'), 'utf8');
    const slice = src.slice(src.indexOf('export function applyCommand('), src.indexOf('function latestHelperTimestamp('));
    const anchors = [
      ['start', "if (command === 'start') {"], ['record pass', "if (command === 'record pass') {"],
      ['record pass (started)', "if (pState === 'started') {"], ['record pass (attempt)', "if (pState === 'attempt') {"],
      ['record pass (voice-complete)', "if (pState === 'voice-complete') {"], ['record pass (completed)', "checkShape(rawInput, 'record pass (completed)'"],
      ['record correction', "if (command === 'record correction') {"], ['record gate', "if (command === 'record gate') {"],
      ['record audit', "if (command === 'record audit') {"], ['checkpoint', "if (command === 'checkpoint') {"], ['finish', '// finish'],
    ] as const;
    const pos = anchors.map(([cmd, a]) => {
      const idx = slice.indexOf(a);
      expect([idx > -1, slice.indexOf(a, idx + 1)], a).toEqual([true, -1]);
      return { cmd, idx };
    });
    for (let i = 1; i < pos.length; i++) expect(pos[i]!.idx).toBeGreaterThan(pos[i - 1]!.idx);

    const drop = new Set(['uuid', 'nonempty-unique-part-array', 'nonempty-unique-voice-id-array', 'unique-part-array-0..8']);
    const expectedSet = new Set<string>(), segByCmd = new Map<string, string>(), computedRefs: string[] = [];
    for (let i = 0; i < pos.length; i++) {
      const seg = slice.slice(pos[i]!.idx, i + 1 < pos.length ? pos[i + 1]!.idx : slice.length);
      segByCmd.set(pos[i]!.cmd, seg);
      for (const m of seg.matchAll(/\{\s*path:\s*([^,]+),\s*rule:\s*'(?:invalid-value|tree-mismatch)',\s*expected:\s*((?:`[^`]*`|'[^']*'|[^\}])+)\}/g)) {
        const path = m[1]!.trim().replace(/^['"`]|['"`]$/g, '').replace(/\$\{fp\}/g, 'findings[i]');
        const expExpr = m[2]!.includes('?') ? m[2]!.slice(m[2]!.indexOf('?') + 1) : m[2]!;
        for (const lit of expExpr.matchAll(/['"`]([^'"`]+)['"`]/g)) {
          const exp = lit[1]!.replace(/\$\{voice\.part\}/g, '<part>');
          if (!drop.has(exp)) expectedSet.add(`${pos[i]!.cmd}|${path}|${exp}`);
        }
      }
      for (const m of seg.matchAll(/\{\s*path:\s*([^,]+),\s*rule:\s*'invalid-reference',\s*expected:\s*((?:`[^`]*`|'[^']*'|[^\}])+)\}/g)) {
        const path = m[1]!.trim().replace(/^['"`]|['"`]$/g, '');
        if (!/^'[^']*'$/.test(m[2]!.trim())) computedRefs.push(`${pos[i]!.cmd}|${path}`);
      }
    }
    expect(computedRefs).toEqual(['record correction|supersedes']);
    expectedSet.add('record correction|supersedes|latest-correction-on-finding');
    for (const [cmd, path, exp, anchor] of [
      ['record pass (attempt)', 'findings', 'required-when-outcome-completed', "rawInput.outcome === 'completed' ? ['findings'] : []"],
      ['record pass (attempt)', 'findings[i].attribution_reason', 'enum-when-found_by-empty', 'fb.length === 0 && !inEnum(ENUMS.attrReason)(fc.attribution_reason)'],
      ['start', 'policy.delegation', 'keys-by-status', "pol.delegation.status === 'active'"],
      ['record gate', 'details', 'required-for-pregate-and-greptile', "gName === 'pregate' || gName === 'greptile' ? ['details'] : []"],
      ['record gate', 'details', 'keys-by-name', "checkKeys(c.details, [], [], 'details', v)"],
      ['record audit', 'details', 'keys-by-name', "c.name === 'documentation'"],
      ['finish', 'full_review_evidence', 'keys-by-status', "c.full_review_evidence.status === 'available'"],
    ] as const) {
      expect(segByCmd.get(cmd)).toContain(anchor);
      expectedSet.add(`${cmd}|${path}|${exp}`);
    }

    const design = readFileSync(DESIGN_PATH, 'utf8'), secStart = design.indexOf('### Builder coverage of cross-field rules');
    const tableLines = design.slice(secStart, design.indexOf('\n### ', secStart + 1)).split('\n').filter((l) => l.startsWith('| `'));
    const validHandlings = new Set(['derived', 'overridden-with-warning', 'refused', 'not applicable']);
    const docKeys = tableLines.map((line) => {
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      expect(validHandlings.has(cells[3]!), line).toBe(true);
      return `${cells[0]!.slice(1, -1)}|${cells[1]!.slice(1, -1)}|${cells[2]!.slice(1, -1)}`;
    });
    expect(docKeys).toHaveLength(new Set(docKeys).size);
    expect(new Set(docKeys)).toEqual(expectedSet);
  });

  test('build literal-null flag list matches validator nullability and text-null refusal', () => {
    const stubGit: GitInfo = { toplevel: '/repo', repo: '/repo/.git', branch: 'main', head: headSha, tree: treeSha };
    const stubEnv: EnvChecker = { commitExists: () => true, commitTree: () => treeSha, isAncestor: () => true, checkEvidence: () => null };
    const stateBefore = new Map<string, ReviewRunState | null>();
    let state: ReviewRunState | null = null;
    for (const [key, example] of Object.entries(REQUEST_EXAMPLES)) {
      stateBefore.set(key, state);
      const out = applyCommand(state, (key.startsWith('record pass') ? 'record pass' : key) as CommandName, example, stubGit, stubEnv, '2026-11-10T18:10:00Z', '0.93.2');
      if (out.reason === 'recorded') state = out.state;
    }
    const setPath = (obj: Record<string, unknown>, key: string, val: unknown) => {
      const [a, b] = key.split('.');
      if (b) obj[a!] = { ...(obj[a!] as Record<string, unknown>), [b]: val };
      else obj[a!] = val;
    };
    const getPath = (obj: Record<string, unknown>, key: string): unknown => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
    const probeViolations = (shape: keyof typeof REQUEST_EXAMPLES, cmd: CommandName, flag: string, key: string, val: unknown) => {
      const raw = structuredClone(REQUEST_EXAMPLES[shape]) as Record<string, unknown>;
      if (shape === 'start' && key.startsWith('pr.')) raw.pr = { url: 'https://github.com/o/r/pull/1', repo: 'o/r', number: 1, head_repo: 'o/r', head_branch: 'b', base_ref: 'main' };
      if (shape === 'record gate' && flag.startsWith('--greptile-')) { raw.name = 'greptile'; raw.details = { value: 'v', run: null }; }
      if (shape === 'record gate' && flag.startsWith('--pregate-')) { raw.name = 'pregate'; raw.details = { raw_verdict: 'PASS', wrapper_verdict: 'passed', policy: 'base', record_path: 'r.json', record_sha256: sha256('r'), skipped_lanes: [] }; }
      if (shape === 'record audit' && flag === '--report-id') { raw.name = 'documentation'; raw.details = { report_id: 'd1', section_path: 's.md', section_sha256: sha256('s') }; }
      if (shape === 'finish' && flag === '--full-review-unavailable') raw.full_review_evidence = { status: 'unavailable', reason: 'r' };
      else if (shape === 'finish' && flag.startsWith('--full-review-')) raw.full_review_evidence = { status: 'available', commit: headSha, tree: treeSha, source: 's' };
      setPath(raw, key, val);
      const out = applyCommand(stateBefore.get(shape) ?? null, cmd, raw, stubGit, stubEnv, '2026-11-10T18:10:00Z', '0.93.2');
      return ((out.detail.violations as Array<{ path: string; expected: string }> | undefined) ?? []).filter((x) => x.path === key);
    };
    const cleanByShape: Record<string, (flag: string) => string[]> = {
      start: () => ['--run-id', uid(1), '--base', baseSha, '--plan-ref', 'docs/plan.md', '--plan-sha256', sha256('p'), '--policy-source', 'none supplied', '--max-continuations', '1', '--prior-stops', '1'],
      'record pass (started)': () => ['--pass-id', uid(2), '--state', 'started', '--scope', 'local', '--cycle', '1', '--coverage', 'delta', '--commit', headSha, '--voice', 'core'],
      'record pass (attempt)': () => ['--pass-id', uid(2), '--state', 'attempt', '--voice-id', 'core', '--attempt-id', uid(3), '--outcome', 'completed'],
      'record pass (voice-complete)': (f) => ['--pass-id', uid(2), '--state', 'voice-complete', '--voice-id', 'core', ...(f === '--selected-attempt-id' ? ['--not-applicable', 'not-applicable'] : ['--selected-attempt-id', uid(3)])],
      'record pass (completed)': () => ['--pass-id', uid(2), '--state', 'completed'],
      'record correction': () => ['--correction-id', uid(4), '--pass-id', uid(2), '--voice-id', 'core', '--attempt-id', uid(3), '--finding-id', 'F-1'],
      'record gate': () => ['--gate-id', uid(5), '--name', 'greptile', '--result', 'passed', '--commit', headSha, '--greptile-value', 'clean'],
      'record audit': () => ['--audit-id', uid(6), '--name', 'coverage', '--result', 'passed', '--coverage-threshold', '80', '--commit', headSha],
      checkpoint: () => ['--checkpoint-id', uid(7), '--kind', 'resume'],
      finish: (f) => ['--outcome', f === '--stop-reason' ? 'blocked' : 'stopped', '--base', baseSha, ...(f === '--stop-reason' ? [] : ['--stop-reason', 'cap'])],
    };
    const tables = [
      ['start', 'start', FLAG_TABLES.start], ...PASS_STATES.map((st) => [`record pass (${st})`, 'record pass', PASS_STATE_FLAGS[st]] as const),
      ['record correction', 'record correction', FLAG_TABLES['record correction']], ['record gate', 'record gate', FLAG_TABLES['record gate']],
      ['record audit', 'record audit', FLAG_TABLES['record audit']], ['checkpoint', 'checkpoint', FLAG_TABLES.checkpoint], ['finish', 'finish', FLAG_TABLES.finish],
    ] as const;
    const emptyDir = newDir(), omits: string[] = [], keepsText: string[] = [];
    for (const [shape, cmd, rows] of tables) {
      for (const row of rows) {
        if (row.kind !== 'string' && row.kind !== 'int' && row.kind !== 'number-or-string') { expect(row.nullOmits, `${shape} ${row.flag}`).toBeUndefined(); continue; }
        const vFalse = probeViolations(shape, cmd, row.flag, row.key, false);
        expect(vFalse.length, `${shape} ${row.flag}`).toBeGreaterThan(0);
        const nullable = vFalse.some((x) => x.expected.endsWith('|null'));
        const refuses = probeViolations(shape, cmd, row.flag, row.key, 'null').some((x) => x.expected.endsWith('|null'));
        expect(Boolean(row.nullOmits), `${shape} ${row.flag}`).toBe(nullable && refuses);
        const clean = cleanByShape[shape]!(row.flag), label = `${shape} ${row.flag}`;
        if (row.nullOmits) {
          omits.push(label);
          expect(buildRequest(cmd, [...clean, row.flag, 'null'], emptyDir), label).toEqual(buildRequest(cmd, clean, emptyDir));
        } else if (nullable) {
          keepsText.push(label);
          const built = buildRequest(cmd, [...clean, row.flag, 'null'], emptyDir);
          expect(built.ok && getPath(built.request, row.key), label).toBe('null');
        }
      }
    }
    expect(omits).toEqual([
      'start --delegation-line', 'start --continues', 'start --session-id',
      'record pass (started) --delta-from', 'record pass (started) --base',
      'record pass (attempt) --part', 'record pass (attempt) --predecessor-attempt-id', 'record pass (attempt) --dispatched-at', 'record pass (attempt) --returned-at',
      'record pass (voice-complete) --selected-attempt-id', 'record pass (voice-complete) --not-applicable',
      'record correction --adjudication', 'record correction --resolution', 'record correction --receipt-class', 'record correction --fixed-in', 'record correction --supersedes',
      'record gate --base', 'record gate --greptile-run', 'record audit --coverage-pct', 'record audit --base',
      'checkpoint --base', 'checkpoint --session-id', 'finish --delta-base', 'finish --stop-count', 'finish --readiness-confirmed-at',
    ]);
    expect(keepsText).toEqual([
      'start --wtree', 'start --gh-login', 'start --policy-value', 'record pass (started) --wtree',
      'record gate --reason', 'record gate --wtree', 'record audit --wtree', 'checkpoint --wtree', 'finish --stop-reason', 'finish --wtree',
    ]);
  });

  test('coverage audit requests that record today keep byte-identical request bytes', () => {
    const d = newDir();
    expect(runCli(['build', 'start', '--dir', d, '--run-id', uid(1020), '--base', baseSha, '--plan-ref', 'docs/plan.md', '--plan-sha256', sha256('t1-bytes'), '--policy-source', 'none supplied', '--max-continuations', '1']).json.reason).toBe('recorded');
    const a64 = 'a'.repeat(64);
    const cases: Array<{ id: string; flags: string[]; result: string; detailsJson: string }> = [
      { id: uid(1021), flags: ['--result', 'passed', '--coverage-pct', '92', '--coverage-threshold', '80'], result: 'passed', detailsJson: '{"pct":92,"threshold":80}' },
      { id: uid(1022), flags: ['--result', 'pass', '--coverage-threshold', 'pass'], result: 'pass', detailsJson: '{"pct":null,"threshold":"pass"}' },
      { id: uid(1023), flags: ['--result', 'completed', '--coverage-pct', 'null', '--coverage-threshold', 'skipped \u2014 zero application executable paths'], result: 'completed', detailsJson: '{"pct":null,"threshold":"skipped \u2014 zero application executable paths"}' },
      { id: uid(1024), flags: ['--result', 'passed', '--coverage-pct', 'null', '--coverage-threshold', 'null'], result: 'passed', detailsJson: '{"pct":null,"threshold":"null"}' },
      { id: uid(1025), flags: ['--result', 'passed', '--coverage-pct', '83.33', '--coverage-threshold', 'PASS target 80%; gaps recorded under test-gaps=record (3)'], result: 'passed', detailsJson: '{"pct":83.33,"threshold":"PASS target 80%; gaps recorded under test-gaps=record (3)"}' },
      { id: uid(1026), flags: ['--result', 'passed', '--coverage-pct', 'null', '--coverage-threshold', a64], result: 'passed', detailsJson: `{"pct":null,"threshold":"${a64}"}` },
    ];
    for (const c of cases) {
      const res = runCli(['build', 'record', 'audit', '--dir', d, '--audit-id', c.id, '--name', 'coverage', ...c.flags, '--commit', headSha]);
      expect(res.json.reason, c.id).toBe('recorded');
      expect(res.err, c.id).toBe('');
      expect(res.json.detail.overrides, c.id).toBeUndefined();
      expect(existsSync(join(d, 'build-overrides.jsonl')), c.id).toBe(false);
      const expectedBytes = `{"audit_id":"${c.id}","name":"coverage","result":"${c.result}","details":${c.detailsJson},"candidate":{"commit":"${headSha}"}}\n`;
      const reqName = `request-record-audit-${sha256(expectedBytes).slice(0, 16)}.json`;
      expect(readFileSync(join(d, reqName), 'utf8'), c.id).toBe(expectedBytes);
    }
  });

  test("replays PR #266's and PR #267's coverage audits (C18): build moves an over-long threshold explanation into result, warns and records", () => {
    const d = newDir();
    expect(runCli(['build', 'start', '--dir', d, '--run-id', uid(1030), '--base', baseSha, '--plan-ref', 'docs/plan.md', '--plan-sha256', sha256('c18-plan'), '--policy-source', 'caller prompt', '--max-continuations', '1']).json.reason).toBe('recorded');
    writeFileSync(join(d, 'cov-ev1.txt'), 'evidence-1\n');
    writeFileSync(join(d, 'cov-ev2.txt'), 'evidence-2\n');

    const d2 = newDir();
    copyFileSync(join(d, 'review-run-state.json'), join(d2, 'review-run-state.json'));
    writeFileSync(join(d2, 'cov-ev1.txt'), 'evidence-1\n');
    writeFileSync(join(d2, 'cov-ev2.txt'), 'evidence-2\n');

    const pr266Id = 'fe04b191-dfef-4da0-9b54-c5faab6ca595';
    const pr266Text = 'skipped \u2014 no application executable paths; null coverage; static contract tests protect approved boundary';
    expect(pr266Text).toHaveLength(105);
    const pr266Composed = `passed \u2014 ${pr266Text}`;
    const pr266Argv = [
      'build', 'record', 'audit', '--dir', d,
      '--audit-id', pr266Id, '--name', 'coverage', '--result', 'passed',
      '--coverage-pct', 'null', '--coverage-threshold', pr266Text,
      '--commit', headSha, '--base', baseSha,
      '--evidence', 'cov-ev1.txt', '--evidence', 'cov-ev2.txt',
    ];
    const r266 = runCli(pr266Argv);
    expect(r266.json.reason).toBe('recorded');
    const expectedOverrides266 = [
      { flag: '--coverage-threshold', sent: pr266Text, used: 'see result', rule: 'threshold-explanation-in-result' },
      { flag: '--result', sent: 'passed', used: pr266Composed, rule: 'threshold-explanation-in-result' },
    ];
    expect(r266.err).toBe(
      `WARNING BUILD_OVERRIDE: record audit --coverage-threshold sent ${JSON.stringify(pr266Text)}; used "see result"; rule threshold-explanation-in-result\n` +
      `WARNING BUILD_OVERRIDE: record audit --result sent "passed"; used ${JSON.stringify(pr266Composed)}; rule threshold-explanation-in-result\n`,
    );
    expect(r266.json.detail.overrides).toEqual(expectedOverrides266);
    const logLines = readFileSync(join(d, 'build-overrides.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(logLines).toHaveLength(1);
    expect(logLines[0]).toMatchObject({ v: 1, command: 'record audit', overrides: expectedOverrides266 });

    const st266 = JSON.parse(readFileSync(join(d, 'review-run-state.json'), 'utf8')) as ReviewRunState;
    const stored266 = st266.audits.find((a) => a.audit_id === pr266Id);
    expect(stored266).toMatchObject({
      audit_id: pr266Id,
      name: 'coverage',
      result: pr266Composed,
      details: { pct: null, threshold: 'see result' },
    });
    expect(runCli(pr266Argv).json.reason).toBe('replayed');

    const raw266 = callCmd(d2, 'record audit', {
      audit_id: pr266Id,
      name: 'coverage',
      result: 'passed',
      details: { pct: null, threshold: pr266Text },
      candidate: { commit: headSha, base: baseSha },
      evidence: [
        { path: 'cov-ev1.txt', sha256: sha256('evidence-1\n') },
        { path: 'cov-ev2.txt', sha256: sha256('evidence-2\n') },
      ],
    });
    expect(raw266.code).toBe(1);
    expect(raw266.json.reason).toBe('invalid-input');
    expect(raw266.json.detail.violations).toEqual([
      { path: 'details.threshold', rule: 'invalid-value', expected: 'number-0..100|string-1..64' },
    ]);

    const pr267Id = uid(1031);
    const pr267Text = 'PASS target 80%; 3 gaps recorded; reused byte-identical behavior after nonconflicting base merge';
    expect(pr267Text).toHaveLength(96);
    const pr267Composed = `passed \u2014 ${pr267Text}`;
    const r267 = runCli([
      'build', 'record', 'audit', '--dir', d,
      '--audit-id', pr267Id, '--name', 'coverage', '--result', 'passed',
      '--coverage-pct', '83.33', '--coverage-threshold', pr267Text,
      '--commit', headSha, '--base', baseSha,
    ]);
    expect(r267.json.reason).toBe('recorded');
    const st267 = JSON.parse(readFileSync(join(d, 'review-run-state.json'), 'utf8')) as ReviewRunState;
    expect(st267.audits.find((a) => a.audit_id === pr267Id)).toMatchObject({
      audit_id: pr267Id,
      name: 'coverage',
      result: pr267Composed,
      details: { pct: 83.33, threshold: 'see result' },
    });

    const beforeOver200 = readFileSync(join(d, 'review-run-state.json'), 'utf8');
    const rOver200 = runCli([
      'build', 'record', 'audit', '--dir', d,
      '--audit-id', uid(1032), '--name', 'coverage', '--result', 'r'.repeat(150),
      '--coverage-pct', '83.33', '--coverage-threshold', pr267Text,
      '--commit', headSha,
    ]);
    expect(rOver200.code).toBe(1);
    expect(rOver200.json.reason).toBe('invalid-input');
    expect(rOver200.json.detail.violations).toEqual([
      { path: 'details.threshold', rule: 'invalid-value', expected: 'number-0..100|string-1..64' },
    ]);
    expect(readFileSync(join(d, 'review-run-state.json'), 'utf8')).toBe(beforeOver200);
  });

  test('a skipped or not-applicable coverage audit records through build with its reason in --result and threshold n/a', () => {
    const d1 = newDir(), d2 = newDir();
    for (const dir of [d1, d2]) {
      expect(runCli(['build', 'start', '--dir', dir, '--run-id', uid(1033), '--base', baseSha, '--plan-ref', 'docs/plan.md', '--plan-sha256', sha256('skip-cov'), '--policy-source', 'none supplied', '--max-continuations', '1']).json.reason).toBe('recorded');
    }
    const skipId = uid(1034);
    const skipRes = 'skipped \u2014 no application executable paths';
    const argvOmit = ['build', 'record', 'audit', '--dir', d1, '--audit-id', skipId, '--name', 'coverage', '--result', skipRes, '--commit', headSha];
    const rOmit = runCli(argvOmit);
    expect([rOmit.json.reason, rOmit.err, rOmit.json.detail.overrides]).toEqual(['recorded', '', undefined]);
    expect(existsSync(join(d1, 'build-overrides.jsonl'))).toBe(false);
    const st1 = JSON.parse(readFileSync(join(d1, 'review-run-state.json'), 'utf8')) as ReviewRunState;
    expect(st1.audits[0]).toMatchObject({
      audit_id: skipId,
      name: 'coverage',
      result: skipRes,
      details: { pct: null, threshold: 'n/a' },
    });
    expect(runCli(argvOmit).json.reason).toBe('replayed');

    const rNull = runCli(['build', 'record', 'audit', '--dir', d2, '--audit-id', skipId, '--name', 'coverage', '--result', skipRes, '--coverage-pct', 'null', '--commit', headSha]);
    expect([rNull.json.reason, rNull.err, rNull.json.detail.overrides]).toEqual(['recorded', '', undefined]);
    const req1 = readdirSync(d1).find((f) => f.startsWith('request-record-audit-'))!;
    const req2 = readdirSync(d2).find((f) => f.startsWith('request-record-audit-'))!;
    expect(req1).toBe(req2);
    expect(readFileSync(join(d1, req1), 'utf8')).toBe(readFileSync(join(d2, req2), 'utf8'));

    const beforeNum = readFileSync(join(d1, 'review-run-state.json'), 'utf8');
    const rNumNoThresh = runCli(['build', 'record', 'audit', '--dir', d1, '--audit-id', uid(1035), '--name', 'coverage', '--result', 'passed', '--coverage-pct', '92', '--commit', headSha]);
    expect(rNumNoThresh.code).toBe(1);
    expect(rNumNoThresh.json.reason).toBe('invalid-input');
    expect(rNumNoThresh.json.detail.violations).toEqual([
      { path: 'details.threshold', rule: 'missing-key', expected: 'threshold' },
    ]);
    expect(readFileSync(join(d1, 'review-run-state.json'), 'utf8')).toBe(beforeNum);
  });

  test("replays PR #268's record call (C19): build accepts --dir between record and its subtype", () => {
    const d1 = newDir(), d2 = newDir(), d3 = newDir();
    for (const dir of [d1, d2, d3]) {
      expect(runCli(['build', 'start', '--dir', dir, '--run-id', uid(1036), '--base', baseSha, '--plan-ref', 'docs/plan.md', '--plan-sha256', sha256('c19-plan'), '--policy-source', 'caller prompt', '--max-continuations', '1']).json.reason).toBe('recorded');
    }
    const gateId = uid(1037);
    const tail = ['--gate-id', gateId, '--name', 'greptile', '--result', 'not-run', '--reason', 'no root configuration', '--commit', headSha, '--base', baseSha, '--greptile-value', 'skipped \u2014 no root configuration; do not run it'];
    const rCanon = runCli(['build', 'record', 'gate', '--dir', d1, ...tail]);
    const rPr268 = runCli(['build', 'record', '--dir', d2, 'gate', ...tail]);
    expect([rCanon.json.reason, rCanon.err]).toEqual(['recorded', '']);
    expect([rPr268.json.reason, rPr268.err]).toEqual(['recorded', '']);
    const req1 = readdirSync(d1).find((f) => f.startsWith('request-record-gate-'))!;
    const req2 = readdirSync(d2).find((f) => f.startsWith('request-record-gate-'))!;
    expect(req1).toBe(req2);
    expect(readFileSync(join(d1, req1), 'utf8')).toBe(readFileSync(join(d2, req2), 'utf8'));

    const rBogus = runCli(['build', 'record', '--dir', d3, 'bogus', '--gate-id', gateId]);
    expect(rBogus.code).toBe(2);
    expect(rBogus.json.reason).toBe('usage');
    expect(rBogus.json.command).toBe('record');
    expect(rBogus.json.detail).toEqual({ message: 'unknown command "record"' });
    expect(readdirSync(d3).filter((f) => f.startsWith('request-record-'))).toEqual([]);
  });

  // Value: protects=voice selection after a failed attempt, explicit deferral and absent lookup targets; fails_when=derivation counts failed attempts, overrides deferral or dereferences a missing target; why_new=the original C20 cases use completed or empty histories and readable matching state; seam=none; no_claim=filesystem faults or concurrent state changes
  test("replays PR #277's voice-complete (C20): build fills in the voice's only completed attempt", () => {
    const d = newDir(), passId = '22521534-98a2-4e70-a725-905abb3c06ac', attId = '2e2b72d4-6548-4e4d-8340-0257b66a6a40';
    const voices = ['core', 'specialist:maintainability', 'red-team', 'qa', 'native-adversarial', 'outside:challenge', 'outside:structured'];
    expect(runCli(['build', 'start', '--dir', d, '--run-id', uid(1038), '--base', baseSha, '--plan-ref', 'docs/plan.md', '--plan-sha256', sha256('c20-plan'), '--policy-source', 'caller prompt', '--max-continuations', '1']).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', d, '--pass-id', passId, '--state', 'started', '--scope', 'local', '--cycle', '1', '--coverage', 'full', '--commit', headSha, '--base', baseSha, ...voices.flatMap((v) => ['--voice', v])]).json.reason).toBe('recorded');
    writeJson(d, 'maint.json', {
      v: 1, status: 'ran', config_sha256: sha256('cfg'),
      parts: [{ part: 'maintainability', provider: 'p', model: 'm', call_id: sha256('c20-call'), replay: false, dispatched: true, dispatched_at: '2026-11-18T01:00:00Z', returned_at: '2026-11-18T01:02:00Z', wall_ms: 10, input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: null, parse: 'valid', verdict: 'clean', outcome: 'credited', fallback_reason: null, findings: [] }],
    });
    expect(runCli(['build', 'record', 'pass', '--dir', d, '--pass-id', passId, '--state', 'attempt', '--voice-id', 'specialist:maintainability', '--part', 'specialist:maintainability', '--attempt-id', attId, '--delegate-file', 'maint.json']).json.reason).toBe('recorded');

    const vcBase = ['build', 'record', 'pass', '--dir', d, '--pass-id', passId, '--state', 'voice-complete'];
    const rA = runCli([...vcBase, '--voice-id', 'specialist:maintainability', '--selected-attempt-id', 'null']);
    expect([rA.json.reason, rA.err, rA.json.detail.overrides, rA.json.detail.derived]).toEqual([
      'recorded', '', undefined, [{ flag: '--selected-attempt-id', used: attId, rule: 'only-completed-attempt-on-voice' }],
    ]);
    const expBytesA = `{"pass_id":"${passId}","state":"voice-complete","voice_id":"specialist:maintainability","selected_attempt_id":"${attId}"}\n`;
    expect(readFileSync(join(d, `request-record-pass-${sha256(expBytesA).slice(0, 16)}.json`), 'utf8')).toBe(expBytesA);
    const stA = JSON.parse(readFileSync(join(d, 'review-run-state.json'), 'utf8')) as ReviewRunState;
    expect(stA.passes[0]!.voices.find((v) => v.voice_id === 'specialist:maintainability')!.selected_attempt_id).toBe(attId);
    const reqsAfterA = readdirSync(d).filter((f) => f.startsWith('request-')).sort();
    expect(runCli([...vcBase, '--voice-id', 'specialist:maintainability']).json.reason).toBe('replayed');
    expect(runCli([...vcBase, '--voice-id', 'specialist:maintainability', '--selected-attempt-id', attId]).json.reason).toBe('replayed');
    expect(readdirSync(d).filter((f) => f.startsWith('request-')).sort()).toEqual(reqsAfterA);

    const coreAtt1 = uid(1039), coreAtt2 = uid(1040);
    expect(runCli(['build', 'record', 'pass', '--dir', d, '--pass-id', passId, '--state', 'attempt', '--voice-id', 'core', '--part', 'core', '--attempt-id', coreAtt1, '--outcome', 'completed']).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', d, '--pass-id', passId, '--state', 'attempt', '--voice-id', 'core', '--part', 'core', '--attempt-id', coreAtt2, '--predecessor-attempt-id', coreAtt1, '--outcome', 'completed']).json.reason).toBe('recorded');
    const beforeB = readFileSync(join(d, 'review-run-state.json'), 'utf8');
    const expViol = [{ path: 'selected_attempt_id', rule: 'invalid-value', expected: 'exactly-one-of-selected_attempt_id-or-not_applicable' }];
    for (const extra of [['--selected-attempt-id', 'null'], []] as const) {
      const rB = runCli([...vcBase, '--voice-id', 'core', ...extra]);
      expect([rB.code, rB.json.reason, rB.json.detail.violations, rB.json.detail.derived]).toEqual([1, 'invalid-input', expViol, undefined]);
    }
    expect(readFileSync(join(d, 'review-run-state.json'), 'utf8')).toBe(beforeB);

    const rC0 = runCli([...vcBase, '--voice-id', 'red-team', '--selected-attempt-id', 'null']);
    expect([rC0.code, rC0.json.reason, rC0.json.detail.violations, rC0.json.detail.derived]).toEqual([1, 'invalid-input', expViol, undefined]);
    const rC1 = runCli([...vcBase, '--voice-id', 'red-team', '--selected-attempt-id', 'null', '--not-applicable', 'not-applicable']);
    expect([rC1.json.reason, rC1.err, rC1.json.detail.overrides, rC1.json.detail.derived]).toEqual(['recorded', '', undefined, undefined]);
    const stC = JSON.parse(readFileSync(join(d, 'review-run-state.json'), 'utf8')) as ReviewRunState;
    expect(stC.passes[0]!.voices.find((v) => v.voice_id === 'red-team')).toMatchObject({ selected_attempt_id: null, not_applicable: 'not-applicable' });
    const expBytesC = `{"pass_id":"${passId}","state":"voice-complete","voice_id":"red-team","not_applicable":"not-applicable"}\n`;
    expect(readFileSync(join(d, `request-record-pass-${sha256(expBytesC).slice(0, 16)}.json`), 'utf8')).toBe(expBytesC);
    expect(runCli([...vcBase, '--voice-id', 'red-team', '--not-applicable', 'not-applicable']).json.reason).toBe('replayed');

    const rD = runCli([...vcBase, '--voice-id', 'qa', '--selected-attempt-id', 'null', '--selected-attempt-id', attId]);
    expect([rD.code, rD.json.reason, rD.json.detail]).toEqual([2, 'usage', { message: 'duplicate --selected-attempt-id flag' }]);
    const qaAttempt = ['build', 'record', 'pass', '--dir', d, '--pass-id', passId, '--state', 'attempt', '--voice-id', 'qa', '--part', 'qa'];
    expect(runCli([...qaAttempt, '--attempt-id', uid(1041), '--outcome', 'failed']).json.reason).toBe('recorded');
    expect(runCli([...vcBase, '--voice-id', 'qa']).json.detail).toEqual({ violations: expViol });
    expect(runCli([...qaAttempt, '--attempt-id', uid(1042), '--outcome', 'completed', '--predecessor-attempt-id', uid(1041)]).json.reason).toBe('recorded');
    const { dir: deferredDir, statePath } = dirFromSeed(join(d, 'review-run-state.json'));
    const explicit = runCli(['build', 'record', 'pass', '--dir', deferredDir, '--pass-id', passId, '--state', 'voice-complete', '--voice-id', 'qa', '--not-applicable', 'user-deferred']);
    const deferredVoice = (JSON.parse(readFileSync(statePath, 'utf8')) as ReviewRunState).passes[0]!.voices.find((v) => v.voice_id === 'qa');
    expect([explicit.json.reason, explicit.json.detail.derived, deferredVoice?.selected_attempt_id, deferredVoice?.not_applicable]).toEqual(['recorded', undefined, null, 'user-deferred']);
    expect(runCli([...vcBase, '--voice-id', 'qa']).json).toMatchObject({ reason: 'recorded', detail: { derived: [{ flag: '--selected-attempt-id', used: uid(1042), rule: 'only-completed-attempt-on-voice' }] } });
    for (const [dir, pass, voice] of [[newDir(), passId, 'qa'], [d, uid(1043), 'qa'], [d, passId, 'missing-voice']] as const) {
      expect(runCli(['build', 'record', 'pass', '--dir', dir, '--pass-id', pass, '--state', 'voice-complete', '--voice-id', voice]).json.detail).toEqual({ violations: expViol });
    }
  });

  // Value: protects=recording the same finding_id across multiple voices in one pass and again in a later pass; fails_when=record pass refuses a repeated finding_id across attempts with unique-finding-id-in-run or stored-state validation rejects the resulting state; why_new=replays PR #280 (C21); seam=build CLI, state store, show, render, and export
  test("replays PR #280's multiply-reported finding (C21): two voices and a later pass record the same finding ID", () => {
    const d = newDir();
    const pass1Id = uid(1050), att1Core = uid(1051), att1Testing = uid(1052);
    const pass2Id = uid(1053), att2Core = uid(1054);
    const findingId = 'telemetry.py:1203:testing';
    expect(runCli(['build', 'start', '--dir', d, '--run-id', uid(1049), '--base', baseSha, '--plan-ref', 'docs/plan.md', '--plan-sha256', sha256('pr280'), '--policy-source', 'caller prompt', '--max-continuations', '1']).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', d, '--pass-id', pass1Id, '--state', 'started', '--scope', 'local', '--cycle', '1', '--coverage', 'full', '--commit', headSha, '--base', baseSha, '--voice', 'core', '--voice', 'testing']).json.reason).toBe('recorded');
    expect(runCli([
      'build', 'record', 'pass', '--dir', d, '--pass-id', pass1Id, '--state', 'attempt',
      '--voice-id', 'core', '--part', 'core', '--attempt-id', att1Core, '--outcome', 'completed',
      '--finding', `${findingId},P2,specialist:testing,qa,outside:challenge`,
    ]).json.reason).toBe('recorded');
    const rAtt2 = runCli([
      'build', 'record', 'pass', '--dir', d, '--pass-id', pass1Id, '--state', 'attempt',
      '--voice-id', 'testing', '--part', 'specialist:testing', '--attempt-id', att1Testing, '--outcome', 'completed',
      '--finding', `${findingId},P2,specialist:testing`,
    ]);
    expect([rAtt2.json.reason, rAtt2.json.detail.violations]).toEqual(['recorded', undefined]);
    expect(runCli(['build', 'record', 'pass', '--dir', d, '--pass-id', pass1Id, '--state', 'voice-complete', '--voice-id', 'core', '--selected-attempt-id', att1Core]).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', d, '--pass-id', pass1Id, '--state', 'voice-complete', '--voice-id', 'testing', '--selected-attempt-id', att1Testing]).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', d, '--pass-id', pass1Id, '--state', 'completed']).json.reason).toBe('recorded');

    expect(runCli(['build', 'record', 'pass', '--dir', d, '--pass-id', pass2Id, '--state', 'started', '--scope', 'local', '--cycle', '2', '--coverage', 'full', '--commit', headSha, '--base', baseSha, '--voice', 'core']).json.reason).toBe('recorded');
    expect(runCli([
      'build', 'record', 'pass', '--dir', d, '--pass-id', pass2Id, '--state', 'attempt',
      '--voice-id', 'core', '--part', 'core', '--attempt-id', att2Core, '--outcome', 'completed',
      '--finding', `${findingId},P2,core,qa`,
    ]).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', d, '--pass-id', pass2Id, '--state', 'voice-complete', '--voice-id', 'core', '--selected-attempt-id', att2Core]).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', d, '--pass-id', pass2Id, '--state', 'completed']).json.reason).toBe('recorded');

    const st = JSON.parse(readFileSync(join(d, 'review-run-state.json'), 'utf8')) as ReviewRunState;
    const p1CoreFindings = st.passes[0]!.voices.find((v) => v.voice_id === 'core')!.attempts[0]!.findings!;
    const p1TestingFindings = st.passes[0]!.voices.find((v) => v.voice_id === 'testing')!.attempts[0]!.findings!;
    const p2CoreFindings = st.passes[1]!.voices.find((v) => v.voice_id === 'core')!.attempts[0]!.findings!;
    expect(p1CoreFindings).toMatchObject([{ finding_id: findingId, found_by: ['specialist:testing', 'qa', 'outside:challenge'] }]);
    expect(p1TestingFindings).toMatchObject([{ finding_id: findingId, found_by: ['specialist:testing'] }]);
    expect(p2CoreFindings).toMatchObject([{ finding_id: findingId, found_by: ['core', 'qa'] }]);

    const expRes = runCli(['export', '--dir', d]);
    expect([expRes.code, expRes.err]).toEqual([0, '']);
    const exportedAttempts = expRes.json.records.filter((r: any) => r.op === 'pass' && r.request.state === 'attempt');
    expect(exportedAttempts.map((r: any) => [r.request.attempt_id, r.request.findings.map((f: any) => f.finding_id)])).toEqual([
      [att1Core, [findingId]],
      [att1Testing, [findingId]],
      [att2Core, [findingId]],
    ]);

    const showRes = runCli(['show', '--dir', d]);
    expect([showRes.code, showRes.err, showRes.json.unresolved]).toEqual([0, '', [`${findingId} P2`]]);
  });

  // Value: protects=unresolvedFindings folding across multiple voices and passes, latest-pass governing rule, and first-appearance order; fails_when=a multiply-reported finding appears twice in Unresolved:, a cycle-1 fix hides a cycle-2 re-report, a correction on pass 1 settles a pass-2 re-report, or repeated reports change first-appearance order; why_new=T3; seam=unresolvedFindings, render full-receipt, and build CLI
  test('unresolvedFindings folds multiply-reported findings by first appearance, applies corrections on any governing report in the latest reporting pass, and renders Unresolved: once', () => {
    // (a) Two voices report X in one pass with no correction: X is listed once (with first governing report's severity).
    // Corrections (fixed on voice A, rejected on voice B, receipt_class on either report) remove X.
    const d1 = newDir(), p1 = uid(1060), attA = uid(1061), attB = uid(1062);
    expect(runCli(['build', 'start', '--dir', d1, '--run-id', uid(1059), '--base', baseSha, '--plan-ref', 'docs/plan.md', '--plan-sha256', sha256('t3-a'), '--policy-source', 'caller prompt', '--max-continuations', '1']).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', d1, '--pass-id', p1, '--state', 'started', '--scope', 'local', '--cycle', '1', '--coverage', 'full', '--commit', headSha, '--base', baseSha, '--voice', 'core', '--voice', 'testing']).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', d1, '--pass-id', p1, '--state', 'attempt', '--voice-id', 'core', '--part', 'core', '--attempt-id', attA, '--outcome', 'completed', '--finding', 'X,P1,core']).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', d1, '--pass-id', p1, '--state', 'attempt', '--voice-id', 'testing', '--part', 'specialist:testing', '--attempt-id', attB, '--outcome', 'completed', '--finding', 'X,P2,specialist:testing']).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', d1, '--pass-id', p1, '--state', 'voice-complete', '--voice-id', 'core', '--selected-attempt-id', attA]).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', d1, '--pass-id', p1, '--state', 'voice-complete', '--voice-id', 'testing', '--selected-attempt-id', attB]).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', d1, '--pass-id', p1, '--state', 'completed']).json.reason).toBe('recorded');

    const seedA = join(d1, 'review-run-state.json');
    expect(unresolvedFindings(JSON.parse(readFileSync(seedA, 'utf8')) as ReviewRunState)).toEqual(['X P1']);

    for (const [idx, corrArgs] of [
      ['--voice-id', 'core', '--attempt-id', attA, '--adjudication', 'accepted', '--resolution', 'fixed', '--fixed-in', headSha],
      ['--voice-id', 'testing', '--attempt-id', attB, '--adjudication', 'rejected'],
      ['--voice-id', 'core', '--attempt-id', attA, '--receipt-class', 'non-blocking'],
      ['--voice-id', 'testing', '--attempt-id', attB, '--receipt-class', 'test-gap-recorded'],
    ].entries()) {
      const { dir, statePath } = dirFromSeed(seedA);
      expect(runCli(['build', 'record', 'correction', '--dir', dir, '--correction-id', uid(1063 + idx), '--pass-id', p1, '--finding-id', 'X', ...corrArgs]).json.reason).toBe('recorded');
      expect(unresolvedFindings(JSON.parse(readFileSync(statePath, 'utf8')) as ReviewRunState)).toEqual([]);
    }

    // (b) X is fixed in pass 1 and re-reported in pass 2: X is listed once, as open.
    // A new correction on the pass-1 report leaves X listed; a correction on the pass-2 report removes it.
    expect(runCli(['build', 'record', 'correction', '--dir', d1, '--correction-id', uid(1070), '--pass-id', p1, '--voice-id', 'core', '--attempt-id', attA, '--finding-id', 'X', '--adjudication', 'accepted', '--resolution', 'fixed', '--fixed-in', headSha]).json.reason).toBe('recorded');
    expect(unresolvedFindings(JSON.parse(readFileSync(seedA, 'utf8')) as ReviewRunState)).toEqual([]);

    const p2 = uid(1071), att2A = uid(1072);
    expect(runCli(['build', 'record', 'pass', '--dir', d1, '--pass-id', p2, '--state', 'started', '--scope', 'local', '--cycle', '2', '--coverage', 'full', '--commit', headSha, '--base', baseSha, '--voice', 'core']).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', d1, '--pass-id', p2, '--state', 'attempt', '--voice-id', 'core', '--part', 'core', '--attempt-id', att2A, '--outcome', 'completed', '--finding', 'X,P2,core']).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', d1, '--pass-id', p2, '--state', 'voice-complete', '--voice-id', 'core', '--selected-attempt-id', att2A]).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', d1, '--pass-id', p2, '--state', 'completed']).json.reason).toBe('recorded');
    expect(unresolvedFindings(JSON.parse(readFileSync(seedA, 'utf8')) as ReviewRunState)).toEqual(['X P2']);

    // (c) A rendered full-receipt through render shows Unresolved: naming X once.
    expect(runCli(['build', 'record', 'gate', '--dir', d1, '--gate-id', uid(1073), '--name', 'greptile', '--result', 'not-run', '--reason', 'no config', '--commit', headSha, '--base', baseSha, '--greptile-value', 'skipped — no config; do not run it']).json.reason).toBe('recorded');
    expect(runCli(['build', 'checkpoint', '--dir', d1, '--checkpoint-id', uid(1074), '--kind', 'ready', '--base', baseSha]).json.reason).toBe('recorded');
    const rFull = callCmd(d1, 'render', { output: 'full-receipt' });
    expect(rFull.code).toBe(0);
    expect(readFileSync(rFull.json.files[0].path, 'utf8')).toContain('\nUnresolved: X P2\n');

    // Targeting rule: a new correction on pass 1's report leaves X listed; a correction on pass 2's report removes it.
    const { dir: dOldTarget, statePath: spOldTarget } = dirFromSeed(seedA);
    expect(runCli(['build', 'record', 'correction', '--dir', dOldTarget, '--correction-id', uid(1075), '--pass-id', p1, '--voice-id', 'testing', '--attempt-id', attB, '--finding-id', 'X', '--adjudication', 'rejected']).json.reason).toBe('recorded');
    expect(unresolvedFindings(JSON.parse(readFileSync(spOldTarget, 'utf8')) as ReviewRunState)).toEqual(['X P2']);

    const { dir: dNewTarget, statePath: spNewTarget } = dirFromSeed(seedA);
    expect(runCli(['build', 'record', 'correction', '--dir', dNewTarget, '--correction-id', uid(1076), '--pass-id', p2, '--voice-id', 'core', '--attempt-id', att2A, '--finding-id', 'X', '--adjudication', 'accepted', '--resolution', 'fixed', '--fixed-in', headSha]).json.reason).toBe('recorded');
    expect(unresolvedFindings(JSON.parse(readFileSync(spNewTarget, 'utf8')) as ReviewRunState)).toEqual([]);

    // (d) X and Y, both open, with X repeated: output order is first appearance.
    const dOrder1 = newDir(), po1 = uid(1080), po1A = uid(1081), po1B = uid(1082), po2 = uid(1083), po2A = uid(1084);
    expect(runCli(['build', 'start', '--dir', dOrder1, '--run-id', uid(1079), '--base', baseSha, '--plan-ref', 'docs/plan.md', '--plan-sha256', sha256('t3-d1'), '--policy-source', 'caller prompt', '--max-continuations', '1']).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', dOrder1, '--pass-id', po1, '--state', 'started', '--scope', 'local', '--cycle', '1', '--coverage', 'full', '--commit', headSha, '--base', baseSha, '--voice', 'core', '--voice', 'testing']).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', dOrder1, '--pass-id', po1, '--state', 'attempt', '--voice-id', 'core', '--part', 'core', '--attempt-id', po1A, '--outcome', 'completed', '--finding', 'X,P1,core']).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', dOrder1, '--pass-id', po1, '--state', 'attempt', '--voice-id', 'testing', '--part', 'specialist:testing', '--attempt-id', po1B, '--outcome', 'completed', '--finding', 'Y,P2,specialist:testing', '--finding', 'X,P1,specialist:testing']).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', dOrder1, '--pass-id', po1, '--state', 'voice-complete', '--voice-id', 'core', '--selected-attempt-id', po1A]).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', dOrder1, '--pass-id', po1, '--state', 'voice-complete', '--voice-id', 'testing', '--selected-attempt-id', po1B]).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', dOrder1, '--pass-id', po1, '--state', 'completed']).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', dOrder1, '--pass-id', po2, '--state', 'started', '--scope', 'local', '--cycle', '2', '--coverage', 'full', '--commit', headSha, '--base', baseSha, '--voice', 'core']).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', dOrder1, '--pass-id', po2, '--state', 'attempt', '--voice-id', 'core', '--part', 'core', '--attempt-id', po2A, '--outcome', 'completed', '--finding', 'X,P1,core']).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', dOrder1, '--pass-id', po2, '--state', 'voice-complete', '--voice-id', 'core', '--selected-attempt-id', po2A]).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', dOrder1, '--pass-id', po2, '--state', 'completed']).json.reason).toBe('recorded');
    expect(unresolvedFindings(JSON.parse(readFileSync(join(dOrder1, 'review-run-state.json'), 'utf8')) as ReviewRunState)).toEqual(['X P1', 'Y P2']);

    const dOrder2 = newDir(), qo1 = uid(1086), qo1A = uid(1087), qo1B = uid(1088);
    expect(runCli(['build', 'start', '--dir', dOrder2, '--run-id', uid(1085), '--base', baseSha, '--plan-ref', 'docs/plan.md', '--plan-sha256', sha256('t3-d2'), '--policy-source', 'caller prompt', '--max-continuations', '1']).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', dOrder2, '--pass-id', qo1, '--state', 'started', '--scope', 'local', '--cycle', '1', '--coverage', 'full', '--commit', headSha, '--base', baseSha, '--voice', 'core', '--voice', 'testing']).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', dOrder2, '--pass-id', qo1, '--state', 'attempt', '--voice-id', 'core', '--part', 'core', '--attempt-id', qo1A, '--outcome', 'completed', '--finding', 'Y,P2,core', '--finding', 'X,P1,core']).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', dOrder2, '--pass-id', qo1, '--state', 'attempt', '--voice-id', 'testing', '--part', 'specialist:testing', '--attempt-id', qo1B, '--outcome', 'completed', '--finding', 'X,P1,specialist:testing']).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', dOrder2, '--pass-id', qo1, '--state', 'voice-complete', '--voice-id', 'core', '--selected-attempt-id', qo1A]).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', dOrder2, '--pass-id', qo1, '--state', 'voice-complete', '--voice-id', 'testing', '--selected-attempt-id', qo1B]).json.reason).toBe('recorded');
    expect(runCli(['build', 'record', 'pass', '--dir', dOrder2, '--pass-id', qo1, '--state', 'completed']).json.reason).toBe('recorded');
    expect(unresolvedFindings(JSON.parse(readFileSync(join(dOrder2, 'review-run-state.json'), 'utf8')) as ReviewRunState)).toEqual(['Y P2', 'X P1']);
  });

  // Value: protects=separation of Git execution failures (timeout, spawn, signal), uncaught errors, and missing-Bun runtime from invalid-input; fails_when=Git execution failure returns commit-not-found or not-in-worktree, trace file is written before --dir validation or leaks payload, lock/tmp remains on throw, or missing Bun prints no envelope; why_new=Track 88A T1; seam=subprocess mock.module and /bin/sh launcher
  test('internal-error separates Git execution failures, uncaught throws, and missing-Bun launcher guard from invalid-input', () => {
    const { dir, statePath, beforeBytes } = dirFromSeed(ensureRefusalSeeds().startState);
    const missingSha = sha256('nonexistent-commit').slice(0, 40);
    const gatePayload = { gate_id: uid(1101), name: 'tests', result: 'passed', candidate: { commit: missingSha, base: baseSha } };
    const gateInput = writeJson(dir, 'gate-in.json', gatePayload);

    // 1. Without mock, missing commit stays invalid-input (commit-not-found)
    const noMockRes = runCli(['record', 'gate', '--dir', dir, '--input', gateInput]);
    expect(noMockRes.code).toBe(1);
    expect(noMockRes.json.reason).toBe('invalid-input');
    expect(noMockRes.json.detail.violations).toContainEqual({ path: 'candidate.commit', rule: 'commit-not-found', expected: 'existing-git-commit' });
    expect(readFileSync(statePath, 'utf8')).toBe(beforeBytes);

    // 2. With spawnSync mocked to return ETIMEDOUT + SIGTERM on cat-file: exit 5, internal-error, trace file mode 0600 with stack, no lock/tmp left
    const catFileScript = `import { mock } from 'bun:test'; const cp = {...await import('node:child_process')};
      mock.module('node:child_process', () => ({...cp, spawnSync(file, args, options) {
        if (file === 'git' && Array.isArray(args) && args.includes('cat-file')) {
          const err = Object.assign(new Error('spawnSync git ETIMEDOUT'), { code: 'ETIMEDOUT', syscall: 'spawnSync git' });
          return { pid: 123, output: [null, '', ''], stdout: '', stderr: '', status: null, signal: 'SIGTERM', error: err };
        }
        return cp.spawnSync(file, args, options);
      }}));
      const { main } = await import(${JSON.stringify(join(REPO_ROOT, 'src/review-state/cli.ts'))});
      let out = '', err = '';
      const code = main(['record', 'gate', '--dir', ${JSON.stringify(dir)}, '--input', ${JSON.stringify(gateInput)}], {
        stdout: (t) => { out += t; }, stderr: (t) => { err += t; }, cwd: ${JSON.stringify(repo)}, env: process.env,
      });
      console.log(JSON.stringify({ code, out: out.trim(), err }));`;
    const rCat = spawnSync(process.execPath, ['--no-env-file', '--no-install', '--config=/dev/null', '-e', catFileScript], { encoding: 'utf8' });
    expect(rCat.status, rCat.stderr).toBe(0);
    const catOut = JSON.parse(rCat.stdout);
    expect(catOut.code).toBe(5);
    const catEnv = JSON.parse(catOut.out);
    expect(catEnv).toMatchObject({
      v: 1,
      command: 'record gate',
      status: 'error',
      reason: 'internal-error',
      side_effects: 'none',
      retry: 'same-input',
      retry_after_ms: null,
      detail: {
        cause: 'git-execution',
        git: 'cat-file',
        errno: 'ETIMEDOUT',
        signal: 'SIGTERM',
      },
    });
    expect(typeof catEnv.detail.trace).toBe('string');
    expect(catEnv.detail.trace).toMatch(/^review-state-error-\d{8}T\d{6}Z-\d+-[0-9a-f]{8}\.txt$/);
    const tracePath = join(dir, catEnv.detail.trace);
    expect(existsSync(tracePath)).toBe(true);
    expect(statSync(tracePath).mode & 0o777).toBe(0o600);
    const traceContent = readFileSync(tracePath, 'utf8');
    expect(traceContent).toContain('cause: git-execution');
    expect(traceContent).toContain('git: cat-file');
    expect(traceContent).toContain('GitExecutionError');
    expect(traceContent).not.toContain(uid(1101));
    expect(catOut.err).toContain('ERROR INTERNAL_ERROR:');
    expect(catOut.err).toContain('FIX: Rerun the identical command once');
    const errFrameLines = catOut.err.split('\n').filter((l: string) => /^\s*at\s/.test(l));
    expect(errFrameLines.length).toBeGreaterThanOrEqual(1);
    expect(errFrameLines.length).toBeLessThanOrEqual(3);
    expect(readFileSync(statePath, 'utf8')).toBe(beforeBytes);
    expect(existsSync(join(dir, 'review-run-state.json.lock'))).toBe(false);
    expect(readdirSync(dir).filter((n) => n.startsWith('review-run-state.json.tmp-'))).toEqual([]);

    // 3. Spawn failure (ENOENT, status: null) on rev-parse --show-toplevel: internal-error with trace: null and no file created in --dir; outside worktree still returns not-in-worktree
    const emptyDir = newDir();
    const startIn = writeJson(emptyDir, 'start.json', mkStart(1102));
    const beforeFiles = readdirSync(emptyDir).sort();
    const enoentScript = `import { mock } from 'bun:test'; const cp = {...await import('node:child_process')};
      mock.module('node:child_process', () => ({...cp, spawnSync(file, args, options) {
        if (file === 'git' && Array.isArray(args) && args.includes('--show-toplevel')) {
          const err = Object.assign(new Error('spawnSync git ENOENT'), { code: 'ENOENT', syscall: 'spawnSync git' });
          return { pid: 0, output: [null, '', ''], stdout: '', stderr: '', status: null, signal: null, error: err };
        }
        return cp.spawnSync(file, args, options);
      }}));
      const { main } = await import(${JSON.stringify(join(REPO_ROOT, 'src/review-state/cli.ts'))});
      let out = '', err = '';
      const code = main(['start', '--dir', ${JSON.stringify(emptyDir)}, '--input', ${JSON.stringify(startIn)}], {
        stdout: (t) => { out += t; }, stderr: (t) => { err += t; }, cwd: ${JSON.stringify(repo)}, env: process.env,
      });
      console.log(JSON.stringify({ code, env: JSON.parse(out.trim()) }));`;
    const rEnoent = spawnSync(process.execPath, ['--no-env-file', '--no-install', '--config=/dev/null', '-e', enoentScript], { encoding: 'utf8' });
    expect(rEnoent.status, rEnoent.stderr).toBe(0);
    const enoentOut = JSON.parse(rEnoent.stdout);
    expect(enoentOut.code).toBe(5);
    expect(enoentOut.env).toMatchObject({
      command: 'start',
      status: 'error',
      reason: 'internal-error',
      detail: { cause: 'git-execution', git: 'rev-parse', errno: 'ENOENT', signal: null, trace: null },
    });
    expect(readdirSync(emptyDir).sort()).toEqual(beforeFiles);
    expect(runCli(['start', '--dir', emptyDir, '--input', startIn], { cwd: baseTmp }).json.reason).toBe('not-in-worktree');

    // 4. Signal (SIGKILL, status: null) on export's rev-parse --git-common-dir: internal-error with command: "export"
    const sigkillScript = `import { mock } from 'bun:test'; const cp = {...await import('node:child_process')};
      mock.module('node:child_process', () => ({...cp, spawnSync(file, args, options) {
        if (file === 'git' && Array.isArray(args) && args.includes('--git-common-dir')) {
          return { pid: 456, output: [null, '', ''], stdout: '', stderr: '', status: null, signal: 'SIGKILL' };
        }
        return cp.spawnSync(file, args, options);
      }}));
      const { main } = await import(${JSON.stringify(join(REPO_ROOT, 'src/review-state/cli.ts'))});
      let out = '', err = '';
      const code = main(['export', '--dir', ${JSON.stringify(dir)}], {
        stdout: (t) => { out += t; }, stderr: (t) => { err += t; }, cwd: ${JSON.stringify(repo)}, env: process.env,
      });
      console.log(JSON.stringify({ code, env: JSON.parse(out.trim()) }));`;
    const rKill = spawnSync(process.execPath, ['--no-env-file', '--no-install', '--config=/dev/null', '-e', sigkillScript], { encoding: 'utf8' });
    expect(rKill.status, rKill.stderr).toBe(0);
    const killOut = JSON.parse(rKill.stdout);
    expect(killOut.code).toBe(5);
    expect(killOut.env).toMatchObject({
      command: 'export',
      status: 'error',
      reason: 'internal-error',
      detail: { cause: 'git-execution', git: 'rev-parse', errno: null, signal: 'SIGKILL' },
    });

    // 5. Uncaught error (node:crypto randomBytes mocked to throw) on record pass: exit 5, cause: "uncaught", lock removed, state unchanged
    const passIn = writeJson(dir, 'pass-in.json', mkPassStarted(1103));
    const uncaughtScript = `import { mock } from 'bun:test'; const crypto = {...await import('node:crypto')};
      mock.module('node:crypto', () => ({...crypto, randomBytes() {
        throw new Error('entropy pool unavailable');
      }}));
      const { main } = await import(${JSON.stringify(join(REPO_ROOT, 'src/review-state/cli.ts'))});
      let out = '', err = '';
      const code = main(['record', 'pass', '--dir', ${JSON.stringify(dir)}, '--input', ${JSON.stringify(passIn)}], {
        stdout: (t) => { out += t; }, stderr: (t) => { err += t; }, cwd: ${JSON.stringify(repo)}, env: process.env,
      });
      console.log(JSON.stringify({ code, env: JSON.parse(out.trim()) }));`;
    const rUncaught = spawnSync(process.execPath, ['--no-env-file', '--no-install', '--config=/dev/null', '-e', uncaughtScript], { encoding: 'utf8' });
    expect(rUncaught.status, rUncaught.stderr).toBe(0);
    const uncaughtOut = JSON.parse(rUncaught.stdout);
    expect(uncaughtOut.code).toBe(5);
    expect(uncaughtOut.env).toMatchObject({
      command: 'record pass',
      status: 'error',
      reason: 'internal-error',
      detail: { cause: 'uncaught', message: 'entropy pool unavailable' },
    });
    expect(existsSync(join(dir, 'review-run-state.json.lock'))).toBe(false);
    expect(readFileSync(statePath, 'utf8')).toBe(beforeBytes);

    // 6. Launcher with empty PATH: exit 5, runtime-missing envelope on stdout, ERROR INTERNAL_ERROR on stderr
    const emptyPathDir = newDir();
    const rLauncher = spawnSync('/bin/sh', [BIN_PATH, 'start', '--dir', emptyDir, '--input', startIn], {
      cwd: repo,
      env: { PATH: emptyPathDir },
      encoding: 'utf8',
    });
    expect(rLauncher.status).toBe(5);
    const stdoutLines = rLauncher.stdout.trim().split('\n');
    expect(stdoutLines).toHaveLength(1);
    const parsedLauncher = JSON.parse(stdoutLines[0]!);
    expect(parsedLauncher).toMatchObject({
      v: 1,
      command: 'unknown',
      status: 'error',
      reason: 'internal-error',
      detail: { cause: 'runtime-missing', trace: null },
      state_path: null,
      rev: null,
      helper_version: null,
      side_effects: 'none',
      retry: 'same-input',
      retry_after_ms: null,
    });
    expect(parsedLauncher.detail.message).toContain('PREREQ_BUN_MISSING');
    expect(parsedLauncher.fix).toContain('continue inline (D1)');
    expect(rLauncher.stderr).toContain('ERROR INTERNAL_ERROR: PREREQ_BUN_MISSING');
    expect(rLauncher.stderr).toContain('\nFIX: ');
  });

  // Value: protects=automatic stale-lock reclamation, live/other-host/pid_ns preservation, 60s unparseable grace, writer own-token recheck, and rename-verify-restore; fails_when=a live or other-host lock is broken, a dead same-host lock stays busy, or a displaced writer overwrites state; why_new=Track 88A T2; seam=CLI, child process pid, and node:fs mocks
  test('stale-lock reclamation reclaims dead same-host, boot-changed, and aged unparseable locks while preserving live, other-host, and displaced locks', () => {
    const deadChild = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { encoding: 'utf8' });
    const deadPid = deadChild.pid!;
    expect(deadPid).toBeGreaterThan(0);

    // 1. Same-host lock with full content and exited pid is reclaimed with wait 0
    const d1 = newDir();
    const lock1 = join(d1, 'review-run-state.json.lock');
    writeFileSync(lock1, `${JSON.stringify({
      pid: deadPid,
      host: hostname(),
      started_at: '2026-11-10T18:00:00Z',
      token: 'a'.repeat(32),
      boot_id: readLocalBootId(),
      pid_ns: readLocalPidNs(),
    })}\n`);
    const r1 = callCmd(d1, 'start', mkStart(1110), { env: { GSTACK_EXTEND_REVIEW_STATE_LOCK_WAIT_MS: '0' } });
    expect(r1.code).toBe(0);
    expect(r1.json).toMatchObject({
      reason: 'recorded',
      rev: 1,
      detail: { warnings: ['reclaimed stale lock (process-exited)'] },
    });
    expect(existsSync(lock1)).toBe(false);

    // 2. Legacy {pid, host, started_at} same-host lock with exited pid is reclaimed
    writeFileSync(lock1, `${JSON.stringify({ pid: deadPid, host: hostname(), started_at: '2026-11-10T18:00:00Z' })}\n`);
    const r2 = callCmd(d1, 'record pass', mkPassStarted(1111), { env: { GSTACK_EXTEND_REVIEW_STATE_LOCK_WAIT_MS: '0' } });
    expect(r2.code).toBe(0);
    expect(r2.json).toMatchObject({
      reason: 'recorded',
      rev: 2,
      detail: { warnings: ['reclaimed stale lock (process-exited)'] },
    });
    expect(existsSync(lock1)).toBe(false);

    // 3. Same-host lock held by live pid of the test runner returns busy with lock bytes unchanged
    const liveLockBytes = `${JSON.stringify({
      pid: process.pid,
      host: hostname(),
      started_at: '2026-11-10T18:00:00Z',
      token: 'b'.repeat(32),
      boot_id: readLocalBootId(),
      pid_ns: readLocalPidNs(),
    })}\n`;
    writeFileSync(lock1, liveLockBytes);
    const rLive = callCmd(d1, 'checkpoint', { checkpoint_id: uid(1112), kind: 'stop' }, { env: { GSTACK_EXTEND_REVIEW_STATE_LOCK_WAIT_MS: '0' } });
    expect(rLive.code).toBe(4);
    expect(rLive.json.reason).toBe('busy');
    expect(rLive.json.detail.holder).not.toHaveProperty('token');
    expect(readFileSync(lock1, 'utf8')).toBe(liveLockBytes);

    // 4. Other-host lock with exited pid returns busy with lock bytes unchanged
    const otherHostBytes = `${JSON.stringify({
      pid: deadPid,
      host: `other-${hostname()}`,
      started_at: '2026-11-10T18:00:00Z',
      token: 'c'.repeat(32),
    })}\n`;
    writeFileSync(lock1, otherHostBytes);
    const rOther = callCmd(d1, 'checkpoint', { checkpoint_id: uid(1112), kind: 'stop' }, { env: { GSTACK_EXTEND_REVIEW_STATE_LOCK_WAIT_MS: '0' } });
    expect(rOther.code).toBe(4);
    expect(rOther.json.reason).toBe('busy');
    expect(readFileSync(lock1, 'utf8')).toBe(otherHostBytes);
    unlinkSync(lock1);

    // 5. Unparseable lock: aged 120s in the past is reclaimed; fresh one returns busy
    writeFileSync(lock1, '{truncated');
    const past = new Date(Date.now() - 120_000);
    utimesSync(lock1, past, past);
    const rAged = callCmd(d1, 'checkpoint', { checkpoint_id: uid(1113), kind: 'stop' }, { env: { GSTACK_EXTEND_REVIEW_STATE_LOCK_WAIT_MS: '0' } });
    expect(rAged.code).toBe(0);
    expect(rAged.json).toMatchObject({
      reason: 'recorded',
      rev: 3,
      detail: { warnings: ['reclaimed stale lock (unparseable-aged)'] },
    });
    expect(existsSync(lock1)).toBe(false);

    writeFileSync(lock1, '{fresh-unparseable');
    const rFresh = callCmd(d1, 'checkpoint', { checkpoint_id: uid(1114), kind: 'stop' }, { env: { GSTACK_EXTEND_REVIEW_STATE_LOCK_WAIT_MS: '0' } });
    expect(rFresh.code).toBe(4);
    expect(rFresh.json.reason).toBe('busy');
    expect(readFileSync(lock1, 'utf8')).toBe('{fresh-unparseable');
    unlinkSync(lock1);

    // 6. Token recheck: mock openSync of temporary file to replace lock with another token -> busy, state unchanged, replacement lock intact
    const statePath1 = join(d1, 'review-run-state.json');
    const beforeTokenRecheck = readFileSync(statePath1, 'utf8');
    const cpIn = writeJson(d1, 'cp-token.json', { checkpoint_id: uid(1115), kind: 'stop' });
    const replacementBytes = `${JSON.stringify({ pid: process.pid, host: hostname(), started_at: '2026-11-10T18:05:00Z', token: 'd'.repeat(32) })}\n`;
    const tokenScript = `import { mock } from 'bun:test'; const fs = {...await import('node:fs')};
      const lock = ${JSON.stringify(lock1)}, rep = ${JSON.stringify(replacementBytes)};
      mock.module('node:fs', () => ({...fs, openSync(p, flags, ...rest) {
        const fd = fs.openSync(p, flags, ...rest);
        if (String(p).includes('review-run-state.json.tmp-') && flags === 'wx') {
          fs.writeFileSync(lock, rep);
        }
        return fd;
      }}));
      const { executeCommand } = await import(${JSON.stringify(join(REPO_ROOT, 'src/review-state/store.ts'))});
      console.log(JSON.stringify(executeCommand('checkpoint', ${JSON.stringify(d1)}, ${JSON.stringify(cpIn)}, ${JSON.stringify(repo)}, { ...process.env, GSTACK_EXTEND_REVIEW_STATE_LOCK_WAIT_MS: '0' })));`;
    const rTok = spawnSync(process.execPath, ['--no-env-file', '--no-install', '--config=/dev/null', '-e', tokenScript], { encoding: 'utf8' });
    expect(rTok.status, rTok.stderr).toBe(0);
    const tokRes = JSON.parse(rTok.stdout);
    expect(tokRes.exitCode).toBe(4);
    expect(tokRes.reason).toBe('busy');
    expect(readFileSync(statePath1, 'utf8')).toBe(beforeTokenRecheck);
    expect(readFileSync(lock1, 'utf8')).toBe(replacementBytes);
    expect(readdirSync(d1).filter((n) => n.startsWith('review-run-state.json.tmp-'))).toEqual([]);
    unlinkSync(lock1);

    // 7. Rename, verify and restore even when a new holder has identical stat identity.
    writeFileSync(lock1, `${JSON.stringify({ pid: deadPid, host: hostname(), started_at: '2026-11-10T18:00:00Z', token: 'e'.repeat(32) })}\n`);
    const liveReplacementBytes = `${JSON.stringify({ pid: process.pid, host: hostname(), started_at: '2026-11-10T18:06:00Z', token: 'f'.repeat(32) })}\n`;
    const fixedLockTime = new Date(1700000000000);
    utimesSync(lock1, fixedLockTime, fixedLockTime);
    const restoreScript = `import { mock } from 'bun:test'; const fs = {...await import('node:fs')};
      const lock = ${JSON.stringify(lock1)}, liveBytes = ${JSON.stringify(liveReplacementBytes)};
      let once = true;
      mock.module('node:fs', () => ({...fs, renameSync(a, b) {
        if (once && String(a) === lock && String(b).includes('.lock.stale-')) {
          once = false;
          fs.writeFileSync(lock, liveBytes);
          fs.utimesSync(lock, new Date(${fixedLockTime.getTime()}), new Date(${fixedLockTime.getTime()}));
        }
        return fs.renameSync(a, b);
      }}));
      const { executeCommand } = await import(${JSON.stringify(join(REPO_ROOT, 'src/review-state/store.ts'))});
      console.log(JSON.stringify(executeCommand('checkpoint', ${JSON.stringify(d1)}, ${JSON.stringify(cpIn)}, ${JSON.stringify(repo)}, { ...process.env, GSTACK_EXTEND_REVIEW_STATE_LOCK_WAIT_MS: '0' })));`;
    const rRestore = spawnSync(process.execPath, ['--no-env-file', '--no-install', '--config=/dev/null', '-e', restoreScript], { encoding: 'utf8' });
    expect(rRestore.status, rRestore.stderr).toBe(0);
    const restoreRes = JSON.parse(rRestore.stdout);
    expect(restoreRes.exitCode).toBe(4);
    expect(restoreRes.reason).toBe('busy');
    expect(readFileSync(lock1, 'utf8')).toBe(liveReplacementBytes);
    expect(readdirSync(d1).filter((n) => n.includes('.lock.stale-'))).toEqual([]);
    unlinkSync(lock1);
  });

  // Value: protects=Linux boot_id and pid_ns lock classification; fails_when=a live pid from a prior boot_id is not reclaimed or a different pid_ns is broken; why_new=Track 88A T2 Linux-specific check; seam=CLI and /proc
  test.skipIf(readLocalBootId() === null)('Linux boot_id mismatch reclaims lock as boot-changed while pid_ns mismatch stays busy', () => {
    const d = newDir();
    const lockPath = join(d, 'review-run-state.json.lock');
    writeFileSync(lockPath, `${JSON.stringify({
      pid: process.pid,
      host: hostname(),
      started_at: '2026-11-10T18:00:00Z',
      token: '1'.repeat(32),
      boot_id: '00000000-0000-0000-0000-000000000000',
      pid_ns: readLocalPidNs(),
    })}\n`);
    const rBoot = callCmd(d, 'start', mkStart(1120), { env: { GSTACK_EXTEND_REVIEW_STATE_LOCK_WAIT_MS: '0' } });
    expect(rBoot.code).toBe(0);
    expect(rBoot.json).toMatchObject({
      reason: 'recorded',
      rev: 1,
      detail: { warnings: ['reclaimed stale lock (boot-changed)'] },
    });
    expect(existsSync(lockPath)).toBe(false);

    if (readLocalPidNs() !== null) {
      const deadChild = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { encoding: 'utf8' });
      const nsLockBytes = `${JSON.stringify({
        pid: deadChild.pid,
        host: hostname(),
        started_at: '2026-11-10T18:00:00Z',
        token: '2'.repeat(32),
        boot_id: readLocalBootId(),
        pid_ns: 'pid:[9999999999]',
      })}\n`;
      writeFileSync(lockPath, nsLockBytes);
      const rNs = callCmd(d, 'checkpoint', { checkpoint_id: uid(1121), kind: 'stop' }, { env: { GSTACK_EXTEND_REVIEW_STATE_LOCK_WAIT_MS: '0' } });
      expect(rNs.code).toBe(4);
      expect(rNs.json.reason).toBe('busy');
      expect(readFileSync(lockPath, 'utf8')).toBe(nsLockBytes);
      unlinkSync(lockPath);
    }
    expect(classifyLockHolder('', Date.now(), Date.now(), hostname(), 'b1', 'ns1').status).toBe('unverifiable');
  });

  // Value: protects=single-host state binding and legacy host:null compatibility; fails_when=start omits host, another host's state is accepted by write/replay/show/export/render, or host:null is backfilled; why_new=Track 88A T3; seam=CLI and stored state
  test('start stamps host, cross-host refuses every write/replay/show/export/render without mutating state, and host:null stays null', () => {
    const d = newDir();
    const startPayload = mkStart(1130);
    expect(callCmd(d, 'start', startPayload).json.reason).toBe('recorded');
    const statePath = join(d, 'review-run-state.json');
    const st = JSON.parse(readFileSync(statePath, 'utf8')) as ReviewRunState;
    expect(st.host).toBe(hostname());

    // Edit to host: "other-host": every write command (including replay of identical start), show, export, and render refuse with cross-host
    const otherHostState = { ...st, host: `other-${hostname()}` };
    const otherBytes = `${JSON.stringify(otherHostState, null, 2)}\n`;
    writeFileSync(statePath, otherBytes);
    for (const [cmd, payload] of [
      ['start', startPayload],
      ['record pass', mkPassStarted(1131)],
      ['record correction', { correction_id: uid(1132), target: { pass_id: uid(1131), voice_id: 'core', attempt_id: uid(1133), finding_id: 'F-1' }, resolution: 'fixed' }],
      ['record gate', { gate_id: uid(1134), name: 'tests', result: 'passed', candidate: { commit: headSha, base: baseSha } }],
      ['record audit', { audit_id: uid(1135), name: 'coverage', result: 'passed', details: { pct: 90, threshold: 80 }, candidate: { commit: headSha, base: baseSha } }],
      ['checkpoint', { checkpoint_id: uid(1136), kind: 'stop' }],
      ['finish', { outcome: 'prepared', base: baseSha }],
    ] as const) {
      const res = callCmd(d, cmd, payload);
      expect(res.code, cmd).toBe(1);
      expect(res.json, cmd).toMatchObject({
        command: cmd,
        status: 'refused',
        reason: 'cross-host',
        rev: 1,
        detail: { expected_host: `other-${hostname()}`.slice(0, 80), actual_host: hostname().slice(0, 80) },
      });
      expect(readFileSync(statePath, 'utf8')).toBe(otherBytes);
    }
    for (const roArgs of [
      ['show', '--dir', d],
      ['export', '--dir', d],
      ['render', '--dir', d, '--input', writeJson(d, 'render-in.json', { output: 'full-receipt' })],
    ]) {
      const res = runCli(roArgs);
      expect(res.code, roArgs[0]).toBe(1);
      expect(res.json, roArgs[0]).toMatchObject({
        command: roArgs[0],
        status: 'refused',
        reason: 'cross-host',
        rev: 1,
      });
      expect(readFileSync(statePath, 'utf8')).toBe(otherBytes);
    }

    // host: null records, replays, and keeps null
    const nullHostState = { ...st, host: null };
    writeFileSync(statePath, `${JSON.stringify(nullHostState, null, 2)}\n`);
    expect(callCmd(d, 'start', startPayload).json.reason).toBe('replayed');
    expect(callCmd(d, 'checkpoint', { checkpoint_id: uid(1137), kind: 'stop' }).json.reason).toBe('recorded');
    expect(runCli(['show', '--dir', d]).code).toBe(0);
    expect(runCli(['export', '--dir', d]).code).toBe(0);
    const afterNullWrite = JSON.parse(readFileSync(statePath, 'utf8')) as ReviewRunState;
    expect(afterNullWrite.host).toBeNull();
  });

  // Value: protects=moving a corrupt state aside at start when writer ordering is known and preserving corrupt/newer-schema bytes otherwise; fails_when=start fails to move garbage or older/equal/null-writer corrupt states, overwrites an existing corrupt backup, moves on invalid start input or newer-schema, or loses original state on failed second rename; why_new=Track 88A T4; seam=CLI and node:fs renameSync mock
  test('start moves a corrupt state aside when writer ordering is known and preserves it on failed publication', () => {
    expect(writerOrderKnown(null, null)).toBe(true);
    expect(writerOrderKnown(undefined, null)).toBe(true);
    expect(writerOrderKnown('0.86.1', '0.86.1')).toBe(true);
    expect(writerOrderKnown('0.86.1', null)).toBe(false);
    expect(writerOrderKnown('9007199254740993.0.0', '0.86.1')).toBe(false);

    const verFile = join(baseTmp, 'ver-move-aside');
    writeFileSync(verFile, '0.86.1\n');
    const opts = { versionPath: verFile };

    const d = newDir();
    const statePath = join(d, 'review-run-state.json');

    // 1. start on garbage JSON moves it aside and records rev 1; a second corrupt start in the same second gets a distinct name
    const garbage1 = '{not valid json 1\n';
    writeFileSync(statePath, garbage1);
    const r1 = callCmd(d, 'start', mkStart(1140), opts);
    expect(r1.code).toBe(0);
    expect(r1.json).toMatchObject({ reason: 'recorded', rev: 1 });
    const moved1 = r1.json.detail.moved_aside as string;
    expect(moved1).toMatch(/^review-run-state\.json\.corrupt-\d{8}T\d{6}Z-[0-9a-f]{8}$/);
    expect(readFileSync(join(d, moved1), 'utf8')).toBe(garbage1);
    const validBase = JSON.parse(readFileSync(statePath, 'utf8')) as ReviewRunState;
    expect(validBase.rev).toBe(1);

    const garbage2 = '{not valid json 2\n';
    writeFileSync(statePath, garbage2);
    const r2 = callCmd(d, 'start', mkStart(1141), opts);
    expect(r2.code).toBe(0);
    const moved2 = r2.json.detail.moved_aside as string;
    expect(moved2).toMatch(/^review-run-state\.json\.corrupt-\d{8}T\d{6}Z-[0-9a-f]{8}$/);
    expect(moved2).not.toBe(moved1);
    expect(readFileSync(join(d, moved1), 'utf8')).toBe(garbage1);
    expect(readFileSync(join(d, moved2), 'utf8')).toBe(garbage2);

    // 2. start on a v1 state with an unknown key and older, equal, or null writer moves it aside
    for (const [idx, writer] of (['0.85.0', '0.86.1', null] as const).entries()) {
      const corruptV1 = JSON.stringify({ ...validBase, writer, unknown_key: idx });
      writeFileSync(statePath, corruptV1);
      const res = callCmd(d, 'start', mkStart(1142 + idx), opts);
      expect(res.code, String(writer)).toBe(0);
      expect(res.json.reason).toBe('recorded');
      expect(res.json.rev).toBe(1);
      const movedName = res.json.detail.moved_aside as string;
      expect(movedName).toMatch(/^review-run-state\.json\.corrupt-\d{8}T\d{6}Z-[0-9a-f]{8}$/);
      expect(readFileSync(join(d, movedName), 'utf8')).toBe(corruptV1);
    }

    // 3. start with invalid input on a corrupt state returns invalid-input and moves nothing
    const beforeInvalid = '{corrupt-stay-put\n';
    writeFileSync(statePath, beforeInvalid);
    const movedBeforeInvalid = readdirSync(d).filter((n) => n.startsWith('review-run-state.json.corrupt-')).sort();
    const rInvalid = callCmd(d, 'start', { run_id: 'bad' }, opts);
    expect(rInvalid.code).toBe(1);
    expect(rInvalid.json.reason).toBe('invalid-input');
    expect(readFileSync(statePath, 'utf8')).toBe(beforeInvalid);
    expect(readdirSync(d).filter((n) => n.startsWith('review-run-state.json.corrupt-')).sort()).toEqual(movedBeforeInvalid);

    // 4. start on schema v2, and on an unknown key with a newer writer, returns newer-schema and moves nothing
    for (const newerBytes of [
      JSON.stringify({ ...validBase, schema: 'review-run-state/v2' }),
      JSON.stringify({ ...validBase, writer: '0.87.0', unknown_future: true }),
    ]) {
      writeFileSync(statePath, newerBytes);
      const rNewer = callCmd(d, 'start', mkStart(1150), opts);
      expect(rNewer.code).toBe(1);
      expect(rNewer.json.reason).toBe('newer-schema');
      expect(readFileSync(statePath, 'utf8')).toBe(newerBytes);
      expect(readdirSync(d).filter((n) => n.startsWith('review-run-state.json.corrupt-')).sort()).toEqual(movedBeforeInvalid);
    }

    // 5. Failed publication leaves the original corrupt file in place.
    const restoreCorruptBytes = '{corrupt-restore-on-rename-fault\n';
    writeFileSync(statePath, restoreCorruptBytes);
    const startFile = writeJson(d, 'start-fault.json', mkStart(1155));
    const faultScript = `import { mock } from 'bun:test'; const fs = {...await import('node:fs')};
      mock.module('node:fs', () => ({...fs, renameSync(a, b) {
        if (String(a).includes('review-run-state.json.tmp-')) {
          throw Object.assign(new Error('injected rename failure'), { code: 'EIO', syscall: 'rename' });
        }
        return fs.renameSync(a, b);
      }}));
      const { executeCommand } = await import(${JSON.stringify(join(REPO_ROOT, 'src/review-state/store.ts'))});
      console.log(JSON.stringify(executeCommand('start', ${JSON.stringify(d)}, ${JSON.stringify(startFile)}, ${JSON.stringify(repo)}, process.env, ${JSON.stringify(verFile)})));`;
    const rFault = spawnSync(process.execPath, ['--no-env-file', '--no-install', '--config=/dev/null', '-e', faultScript], { encoding: 'utf8' });
    expect(rFault.status, rFault.stderr).toBe(0);
    const faultRes = JSON.parse(rFault.stdout);
    expect(faultRes.exitCode).toBe(3);
    expect(faultRes.reason).toBe('unwritable');
    expect(readFileSync(statePath, 'utf8')).toBe(restoreCorruptBytes);
    expect(readdirSync(d).filter((n) => n.startsWith('review-run-state.json.corrupt-')).sort()).toEqual(movedBeforeInvalid);

    // 6. Recovery leaves files that an older corrupt state may reference.
    const legacyTmp = 'review-run-state.json.tmp-56-beef';
    writeFileSync(join(d, legacyTmp), 'legacy evidence\n');
    const recovery = callCmd(d, 'start', mkStart(1156), opts);
    expect(recovery.json).toMatchObject({
      reason: 'recorded',
      detail: { warnings: ['skipped leftover temporary-file sweep: recorded evidence could not be resolved'] },
    });
    expect(readFileSync(join(d, legacyTmp), 'utf8')).toBe('legacy evidence\n');
  });

  // Value: protects=bounded corrupt-state recovery; fails_when=archive errors loop instead of returning unwritable and releasing the lock; why_new=publication rename faults did not cover claiming the backup name.
  test('start returns unwritable on a corrupt backup destination error and releases the lock', () => {
    const dir = newDir();
    const statePath = join(dir, 'review-run-state.json');
    const corrupt = '{invalid state\n';
    writeFileSync(statePath, corrupt);
    const input = writeJson(dir, 'input.json', mkStart(1157));
    const script = `import { mock } from 'bun:test'; const fs = {...await import('node:fs')};
      const prefix = ${JSON.stringify(statePath + '.corrupt-')};
      const fault = (syscall) => Object.assign(new Error('backup name fault'), { code: 'EIO', syscall });
      mock.module('node:fs', () => ({...fs,
        linkSync(a, b) {
          if (String(b).startsWith(prefix)) throw fault('link');
          return fs.linkSync(a, b);
        },
        lstatSync(path, ...rest) {
          if (String(path).startsWith(prefix)) throw fault('lstat');
          return fs.lstatSync(path, ...rest);
        },
      }));
      const { executeCommand } = await import(${JSON.stringify(join(REPO_ROOT, 'src/review-state/store.ts'))});
      console.log(JSON.stringify(executeCommand('start', ${JSON.stringify(dir)}, ${JSON.stringify(input)}, ${JSON.stringify(repo)})));`;
    const result = spawnSync(process.execPath, ['--no-env-file', '--no-install', '--config=/dev/null', '-e', script], { encoding: 'utf8', timeout: 5000 });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ exitCode: 3, reason: 'unwritable', detail: { errno: 'EIO' } });
    expect(readFileSync(statePath, 'utf8')).toBe(corrupt);
    expect(readdirSync(dir).sort()).toEqual(['input.json', 'review-run-state.json']);
  });

  // Value: protects=bounded lock wait and old unreadable lock retention; fails_when=a failed lock read retries indefinitely or treats unread bytes as stale; why_new=existing stale tests read their locks successfully.
  test.each(['ENOENT', 'EIO'])('a failed lock inspection returns busy without touching the lock (%s)', (errno) => {
    const dir = newDir();
    const lock = join(dir, 'review-run-state.json.lock');
    const input = writeJson(dir, 'input.json', mkStart(1116));
    const bytes = JSON.stringify({ pid: process.pid, host: hostname(), started_at: '2026-11-10T18:00:00Z' });
    writeFileSync(lock, bytes);
    const past = new Date(Date.now() - 120_000);
    utimesSync(lock, past, past);
    const script = `import { mock } from 'bun:test'; const fs = {...await import('node:fs')};
      const lock = ${JSON.stringify(lock)}, fault = () => Object.assign(new Error('lock read fault'), { code: ${JSON.stringify(errno)} });
      mock.module('node:fs', () => ({...fs,
        openSync(path, flags, ...rest) {
          if (path === lock && flags !== 'wx') throw fault();
          return fs.openSync(path, flags, ...rest);
        },
        readFileSync(path, ...rest) {
          if (path === lock) throw fault();
          return fs.readFileSync(path, ...rest);
        },
      }));
      const { executeCommand } = await import(${JSON.stringify(join(REPO_ROOT, 'src/review-state/store.ts'))});
      console.log(JSON.stringify(executeCommand('start', ${JSON.stringify(dir)}, ${JSON.stringify(input)}, ${JSON.stringify(repo)}, { ...process.env, GSTACK_EXTEND_REVIEW_STATE_LOCK_WAIT_MS: '0' })));`;
    const result = spawnSync(process.execPath, ['--no-env-file', '--no-install', '--config=/dev/null', '-e', script], { encoding: 'utf8', timeout: 5000 });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ exitCode: 4, reason: 'busy', detail: { holder: { unknown: true } } });
    expect(readFileSync(lock, 'utf8')).toBe(bytes);
    expect(existsSync(join(dir, 'review-run-state.json'))).toBe(false);
  });
});

describe('full-review-record', () => {
  const MISSED_NEXT_CYCLE = 'FULL_REVIEW_RECORD: missed cycle-1-baseline at next-cycle';
  const REFUSED_PREFIX = 'FULL_REVIEW_RECORD: refused cycle-1-baseline:';
  const REFUSED_UNREADABLE = 'FULL_REVIEW_RECORD: refused cycle-1-baseline: write point not reached (run-state unreadable)';
  const REFUSED_PROBE = 'FULL_REVIEW_RECORD: refused cycle-1-baseline: write point not reached (0123456789ab)';
  const POLICY_RUN_STATE = 'review-and-prep-policy/v1; run-state=record';

  let s1 = '';
  let dirtySnap = '';

  beforeAll(() => {
    const baseTree = git(repo, ['rev-parse', `${baseSha}^{tree}`]);
    s1 = git(repo, ['commit-tree', treeSha, '-p', headSha, '-m', 's1']);
    dirtySnap = git(repo, ['commit-tree', baseTree, '-p', headSha, '-m', 'dirty']);
  });

  const writeInput = (data: unknown): string => writeJson(baseTmp, `frec-in-${++dirSeq}.json`, data);

  const runRecord = (action: string, kind: string, arg: string, dir: string, extraEnv?: NodeJS.ProcessEnv) =>
    runCli(['full-review-record', repo, dir, action, kind, arg], extraEnv ? { env: extraEnv } : {});

  const baseRecord = (overrides: Record<string, unknown> = {}) => ({
    schema: 'review-and-prep-cycle-1-baseline/v1',
    provenance: 'write-point',
    b: headSha,
    t: treeSha,
    snapshot: s1,
    snapshot_tree_equals_t: true,
    stages: [{ name: 'core', result: 'completed' }],
    probes: [{ id: '0123456789ab', key: 'cli:bun test', outcome: 'passed' }],
    completed: 'true',
    ...overrides,
  });

  test('missed write caught at before-fix writes cleanly at write-point', () => {
    const evDir = newDir();
    const c1 = runRecord('check', 'cycle-1-baseline', 'before-fix', evDir);
    expect(c1.code).toBe(1);
    expect(c1.out.trim()).toBe('FULL_REVIEW_RECORD: missing cycle-1-baseline');
    expect(existsSync(join(evDir, 'cycle-1-baseline.missed.json'))).toBe(false);

    const w = runRecord('write', 'cycle-1-baseline', writeInput(baseRecord()), evDir);
    expect(w.code, w.err).toBe(0);
    expect(w.out.trim()).toMatch(/^FULL_REVIEW_RECORD: written cycle-1-baseline; provenance=write-point; sha256=[0-9a-f]{64}$/);

    const c2 = runRecord('check', 'cycle-1-baseline', 'before-fix', evDir);
    expect(c2.code, c2.err).toBe(0);
    expect(c2.out.trim()).toBe('FULL_REVIEW_RECORD: present cycle-1-baseline; provenance=write-point; completed=true');
  });

  test('missed write past the window locks out write-point and requires snapshot-bound evidence for late write', () => {
    const evDir = newDir();
    const cNext = runRecord('check', 'cycle-1-baseline', 'next-cycle', evDir);
    expect(cNext.code).toBe(1);
    expect(cNext.out.trim()).toBe(MISSED_NEXT_CYCLE);
    const missPath = join(evDir, 'cycle-1-baseline.missed.json');
    expect(existsSync(missPath)).toBe(true);

    const wPoint = runRecord('write', 'cycle-1-baseline', writeInput(baseRecord()), evDir);
    expect(wPoint.code).toBe(3);
    expect(wPoint.out.trim()).toBe('FULL_REVIEW_RECORD: refused cycle-1-baseline: missed at next-cycle');

    const wNoSources = runRecord('write', 'cycle-1-baseline', writeInput(baseRecord({ provenance: 'late' })), evDir);
    expect(wNoSources.code).toBe(3);
    expect(wNoSources.out.trim()).toContain(REFUSED_PREFIX);

    const outsideFile = join(baseTmp, `outside-${++dirSeq}.txt`);
    writeFileSync(outsideFile, `reviewed snapshot ${s1}\n`);
    const wOutside = runRecord('write', 'cycle-1-baseline', writeInput(baseRecord({ provenance: 'late', sources: [outsideFile] })), evDir);
    expect(wOutside.code).toBe(3);
    expect(wOutside.out.trim()).toContain('outside the evidence directory');

    const noSnapFile = join(evDir, 'review-no-snap.txt');
    writeFileSync(noSnapFile, 'reviewed some other commit\n');
    const wNoSnap = runRecord('write', 'cycle-1-baseline', writeInput(baseRecord({ provenance: 'late', sources: ['review-no-snap.txt'] })), evDir);
    expect(wNoSnap.code).toBe(3);
    expect(wNoSnap.out.trim()).toContain('does not name the snapshot');
    expect(existsSync(join(evDir, 'cycle-1-baseline.json'))).toBe(false);

    const evFile = join(evDir, 'review-cycle-1.txt');
    writeFileSync(evFile, `core review complete for snapshot ${s1}\n`);
    const wLate = runRecord('write', 'cycle-1-baseline', writeInput(baseRecord({ provenance: 'late', sources: ['review-cycle-1.txt'] })), evDir);
    expect(wLate.code, wLate.err).toBe(0);
    expect(wLate.out.trim()).toMatch(/^FULL_REVIEW_RECORD: written cycle-1-baseline; provenance=late; sha256=[0-9a-f]{64}$/);

    const written = JSON.parse(readFileSync(join(evDir, 'cycle-1-baseline.json'), 'utf8'));
    expect(written.sources).toBeUndefined();
    expect(written.late).toEqual({
      boundary: 'next-cycle',
      miss_sha256: sha256(readFileSync(missPath)),
      sources: [{ path: 'review-cycle-1.txt', sha256: sha256(readFileSync(evFile)) }],
    });

    const cStop = runRecord('check', 'cycle-1-baseline', 'stop', evDir);
    expect(cStop.code, cStop.err).toBe(0);
    expect(cStop.out.trim()).toBe('FULL_REVIEW_RECORD: present cycle-1-baseline; provenance=late; completed=true');
  });

  test('an unrepaired miss reports missed at stop with no record file', () => {
    const evDir = newDir();
    expect(runRecord('check', 'cycle-1-baseline', 'next-cycle', evDir).code).toBe(1);
    const cStop = runRecord('check', 'cycle-1-baseline', 'stop', evDir);
    expect(cStop.code).toBe(1);
    expect(cStop.out.trim()).toBe(MISSED_NEXT_CYCLE);
    expect(existsSync(join(evDir, 'cycle-1-baseline.json'))).toBe(false);
  });

  test('late write without a next-cycle miss record is refused', () => {
    const evDir = newDir();
    writeFileSync(join(evDir, 'review-cycle-1.txt'), `snapshot ${s1}\n`);
    const lateInput = writeInput(baseRecord({ provenance: 'late', sources: ['review-cycle-1.txt'] }));

    const wNone = runRecord('write', 'cycle-1-baseline', lateInput, evDir);
    expect(wNone.code).toBe(3);
    expect(wNone.out.trim()).toContain(REFUSED_PREFIX);

    writeFileSync(
      join(evDir, 'cycle-1-baseline.missed.json'),
      JSON.stringify({ schema: 'review-and-prep-record-miss/v1', kind: 'cycle-1-baseline', boundary: 'stop', detected_at: '2026-11-09T00:00:00.000Z' }),
    );
    const wStopBoundary = runRecord('write', 'cycle-1-baseline', lateInput, evDir);
    expect(wStopBoundary.code).toBe(3);
    expect(wStopBoundary.out.trim()).toContain(REFUSED_PREFIX);
    expect(existsSync(join(evDir, 'cycle-1-baseline.json'))).toBe(false);
  });

  test('second write prints exists, exits 2 and leaves the file unchanged', () => {
    const evDir = newDir();
    const w1 = runRecord('write', 'cycle-1-baseline', writeInput(baseRecord()), evDir);
    expect(w1.code, w1.err).toBe(0);
    const recFile = join(evDir, 'cycle-1-baseline.json');
    const before = readFileSync(recFile);

    const w2 = runRecord('write', 'cycle-1-baseline', writeInput(baseRecord({ completed: 'false', cause: 'reviewer-incomplete: red-team' })), evDir);
    expect(w2.code).toBe(2);
    expect(w2.out.trim()).toBe('FULL_REVIEW_RECORD: exists cycle-1-baseline');
    expect(readFileSync(recFile)).toEqual(before);
  });

  test('validation rejects missing keys, boolean completed and tree disagreement, and flags corrupt files as unreadable', () => {
    const evDir = newDir();
    const noStages = baseRecord();
    delete (noStages as Record<string, unknown>).stages;
    const rMissing = runRecord('write', 'cycle-1-baseline', writeInput(noStages), evDir);
    expect(rMissing.code).toBe(3);
    expect(rMissing.out.trim()).toBe('FULL_REVIEW_RECORD: invalid cycle-1-baseline: stages');

    const rBool = runRecord('write', 'cycle-1-baseline', writeInput(baseRecord({ completed: true })), evDir);
    expect(rBool.code).toBe(3);
    expect(rBool.out.trim()).toBe('FULL_REVIEW_RECORD: invalid cycle-1-baseline: completed');

    const rTree = runRecord('write', 'cycle-1-baseline', writeInput(baseRecord({ snapshot: dirtySnap, snapshot_tree_equals_t: true })), evDir);
    expect(rTree.code).toBe(3);
    expect(rTree.out.trim()).toBe('FULL_REVIEW_RECORD: invalid cycle-1-baseline: snapshot_tree_equals_t');
    expect(existsSync(join(evDir, 'cycle-1-baseline.json'))).toBe(false);

    writeFileSync(join(evDir, 'cycle-1-baseline.json'), '{not valid json\n');
    const cCorrupt = runRecord('check', 'cycle-1-baseline', 'stop', evDir);
    expect(cCorrupt.code).toBe(1);
    expect(cCorrupt.out.trim()).toBe('FULL_REVIEW_RECORD: unreadable cycle-1-baseline: json');
  });

  test('record I/O failures are explicit and never report a persisted miss', () => {
    const evDir = newDir();
    const absent = join(evDir, 'absent');
    const miss = runRecord('check', 'cycle-1-baseline', 'next-cycle', absent);
    expect(miss.code).toBe(1);
    expect(miss.out.trim()).toBe('FULL_REVIEW_RECORD: unreadable cycle-1-baseline: miss record (ENOENT)');
    expect(miss.err).toBe('');
    expect(existsSync(join(absent, 'cycle-1-baseline.missed.json'))).toBe(false);
    const write = runRecord('write', 'cycle-1-baseline', writeInput(baseRecord()), absent);
    expect(write.code).toBe(3);
    expect(write.out.trim()).toBe('FULL_REVIEW_RECORD: invalid cycle-1-baseline: record write (ENOENT)');
    expect(write.err).toBe('');
  });

  test('non-object miss records fail closed with structured output', () => {
    const evDir = newDir();
    const missPath = join(evDir, 'cycle-1-baseline.missed.json');
    for (const value of [null, true, 1, 'invalid', []]) {
      const bytes = JSON.stringify(value);
      writeFileSync(missPath, bytes);
      const check = runRecord('check', 'cycle-1-baseline', 'next-cycle', evDir);
      expect(check.code).toBe(1);
      expect(check.out.trim()).toBe('FULL_REVIEW_RECORD: missed cycle-1-baseline at unreadable');
      expect(check.err).toBe('');
      const write = runRecord('write', 'cycle-1-baseline', writeInput(baseRecord()), evDir);
      expect(write.code).toBe(3);
      expect(write.out).toContain('refused cycle-1-baseline: missed at unreadable');
      expect(readFileSync(missPath, 'utf8')).toBe(bytes);
      expect(existsSync(join(evDir, 'cycle-1-baseline.json'))).toBe(false);
    }
  });

  test('late records cannot use their own input or generated record files as sources', () => {
    const evDir = newDir();
    expect(runRecord('check', 'cycle-1-baseline', 'next-cycle', evDir).code).toBe(1);
    const input = join(evDir, 'assembled.json');
    writeFileSync(input, JSON.stringify(baseRecord({ provenance: 'late', sources: ['assembled.json'] })));
    const self = runRecord('write', 'cycle-1-baseline', input, evDir);
    expect(self.code).toBe(3);
    expect(self.out).toContain('is not review evidence');
    writeFileSync(join(evDir, 'cycle-1-fix-review.json'), JSON.stringify({ cycle_2_snapshot: s1 }));
    const generated = runRecord('write', 'cycle-1-baseline', writeInput(baseRecord({ provenance: 'late', sources: ['cycle-1-fix-review.json'] })), evDir);
    expect(generated.code).toBe(3);
    expect(generated.out).toContain('is not review evidence');
    expect(existsSync(join(evDir, 'cycle-1-baseline.json'))).toBe(false);
    writeFileSync(join(evDir, '..notes.txt'), `core reviewed ${s1}\n`);
    const retained = runRecord('write', 'cycle-1-baseline', writeInput(baseRecord({ provenance: 'late', sources: ['..notes.txt'] })), evDir);
    expect(retained.code, retained.err).toBe(0);
  });

  test('completion flags reject inconsistent probe outcomes', () => {
    const evDir = newDir();
    for (const outcome of ['blocked', 'inconclusive', 'not-run', 'reproduced']) {
      const probes = [{ id: '0123456789ab', key: 'cli:bun test', outcome, fingerprint: 'app.ts:1:contract' }];
      const baseline = runRecord('write', 'cycle-1-baseline', writeInput(baseRecord({ probes })), evDir);
      expect(baseline.code).toBe(3);
      expect(baseline.out).toContain('invalid cycle-1-baseline: completed');
      if (outcome !== 'reproduced') {
        const fix = runRecord('write', 'cycle-1-fix-review', writeInput({
          schema: 'review-and-prep-cycle-1-fix-review/v1', provenance: 'write-point',
          cycle_1_snapshot: s1, cycle_2_snapshot: s1, scope: `delta from ${s1}`,
          stages: [{ name: 'core', result: 'completed' }], probes, fix_reviewed: 'true',
        }), evDir);
        expect(fix.code).toBe(3);
        expect(fix.out).toContain('invalid cycle-1-fix-review: fix_reviewed');
      }
    }
    const pending = runRecord('write', 'cycle-1-baseline', writeInput(baseRecord({ completed: 'pending-fix-review', cause: 'no reproduced probe' })), evDir);
    expect(pending.code).toBe(3);
    expect(pending.out).toContain('invalid cycle-1-baseline: completed');
    expect(existsSync(join(evDir, 'cycle-1-baseline.json'))).toBe(false);
    expect(existsSync(join(evDir, 'cycle-1-fix-review.json'))).toBe(false);
  });

  test('cycle-1-fix-review supports before-fix, next-cycle and late write naming cycle_2_snapshot', () => {
    const evDir = newDir();
    const s2 = dirtySnap;
    const fixRecord = (overrides: Record<string, unknown> = {}) => ({
      schema: 'review-and-prep-cycle-1-fix-review/v1',
      provenance: 'write-point',
      cycle_1_snapshot: s1,
      cycle_2_snapshot: s2,
      scope: `delta from ${s1}`,
      stages: [{ name: 'core', result: 'completed' }],
      probes: [{ id: '0123456789ab', key: 'cli:bun test', outcome: 'passed', evidence: 'probe-rerun.txt' }],
      fix_reviewed: 'true',
      ...overrides,
    });

    expect(runRecord('check', 'cycle-1-fix-review', 'before-fix', evDir).out.trim()).toBe('FULL_REVIEW_RECORD: missing cycle-1-fix-review');
    expect(runRecord('check', 'cycle-1-fix-review', 'next-cycle', evDir).out.trim()).toBe('FULL_REVIEW_RECORD: missed cycle-1-fix-review at next-cycle');

    writeFileSync(join(evDir, 'cycle-1-only.txt'), `only names ${s1}\n`);
    const wWrongSnap = runRecord('write', 'cycle-1-fix-review', writeInput(fixRecord({ provenance: 'late', sources: ['cycle-1-only.txt'] })), evDir);
    expect(wWrongSnap.code).toBe(3);
    expect(wWrongSnap.out.trim()).toContain('does not name the snapshot');

    writeFileSync(join(evDir, 'cycle-2-review.txt'), `delta from ${s1} to ${s2} reviewed\n`);
    const wLate = runRecord('write', 'cycle-1-fix-review', writeInput(fixRecord({ provenance: 'late', sources: ['cycle-2-review.txt'] })), evDir);
    expect(wLate.code, wLate.err).toBe(0);
    expect(wLate.out.trim()).toMatch(/^FULL_REVIEW_RECORD: written cycle-1-fix-review; provenance=late; sha256=[0-9a-f]{64}$/);

    const cStop = runRecord('check', 'cycle-1-fix-review', 'stop', evDir);
    expect(cStop.code, cStop.err).toBe(0);
    expect(cStop.out.trim()).toBe('FULL_REVIEW_RECORD: present cycle-1-fix-review; provenance=late; fix-reviewed=true');
  });

  test('cycle-1-fix-review accepts scope "full" and rejects near-miss scopes', () => {
    const evDir = newDir();
    const fixRecord = (scope: string) => ({
      schema: 'review-and-prep-cycle-1-fix-review/v1',
      provenance: 'write-point',
      cycle_1_snapshot: s1,
      cycle_2_snapshot: s1,
      scope,
      stages: [{ name: 'core', result: 'completed' }],
      probes: [{ id: '0123456789ab', key: 'cli:bun test', outcome: 'passed', evidence: 'probe-rerun.txt' }],
      fix_reviewed: 'true',
    });

    for (const badScope of ['Full', 'full ', `full from ${s1}`, 'partial', '']) {
      const r = runRecord('write', 'cycle-1-fix-review', writeInput(fixRecord(badScope)), evDir);
      expect(r.code, badScope).toBe(3);
      expect(r.out.trim(), badScope).toBe('FULL_REVIEW_RECORD: invalid cycle-1-fix-review: scope');
      expect(existsSync(join(evDir, 'cycle-1-fix-review.json')), badScope).toBe(false);
    }

    const w = runRecord('write', 'cycle-1-fix-review', writeInput(fixRecord('full')), evDir);
    expect(w.code, w.err).toBe(0);
    expect(w.out.trim()).toMatch(/^FULL_REVIEW_RECORD: written cycle-1-fix-review; provenance=write-point; sha256=[0-9a-f]{64}$/);
    expect(existsSync(join(evDir, 'cycle-1-fix-review.json'))).toBe(true);

    const c = runRecord('check', 'cycle-1-fix-review', 'stop', evDir);
    expect(c.code, c.err).toBe(0);
    expect(c.out.trim()).toBe('FULL_REVIEW_RECORD: present cycle-1-fix-review; provenance=write-point; fix-reviewed=true');
  });

  test('REVIEW_STATE_DIR precheck enforces cycle-1 pass, required voices and probe gates on write-point and late writes', () => {
    const evDir = newDir();
    const absentDir = newDir();
    const wAbsent = runRecord('write', 'cycle-1-baseline', writeInput(baseRecord()), evDir, { REVIEW_STATE_DIR: absentDir });
    expect(wAbsent.code).toBe(3);
    expect(wAbsent.out.trim()).toBe(REFUSED_UNREADABLE);
    expect(existsSync(join(evDir, 'cycle-1-baseline.json'))).toBe(false);

    const garbageDir = newDir();
    writeFileSync(join(garbageDir, 'review-run-state.json'), '{not-json\n');
    const wGarbage = runRecord('write', 'cycle-1-baseline', writeInput(baseRecord()), evDir, { REVIEW_STATE_DIR: garbageDir });
    expect(wGarbage.code).toBe(3);
    expect(wGarbage.out.trim()).toBe(REFUSED_UNREADABLE);
    expect(existsSync(join(evDir, 'cycle-1-baseline.json'))).toBe(false);

    expect(callCmd(evDir, 'start', {
      run_id: '019315e0-0000-7000-8000-000000000001',
      base: headSha,
      plan: { ref: 'plan.md', sha256: 'a'.repeat(64) },
      policy: { value: POLICY_RUN_STATE, source: 'caller prompt' },
      continuation: { prior_stops: 0, max: 0 },
    }).code).toBe(0);
    const wNoPass = runRecord('write', 'cycle-1-baseline', writeInput(baseRecord()), evDir, { REVIEW_STATE_DIR: evDir });
    expect(wNoPass.code).toBe(3);
    expect(wNoPass.out.trim()).toBe('FULL_REVIEW_RECORD: refused cycle-1-baseline: write point not reached (cycle-1-pass)');
    expect(existsSync(join(evDir, 'cycle-1-baseline.json'))).toBe(false);

    expect(callCmd(evDir, 'record pass', {
      pass_id: '019315e0-0000-7000-8000-000000000002',
      state: 'started',
      scope: 'local',
      cycle: 1,
      coverage: 'full',
      candidate: { commit: headSha, base: headSha },
      required_voices: ['core'],
      started_at: '2026-11-12T00:00:00Z',
    }).code).toBe(0);
    const wNoVoice = runRecord('write', 'cycle-1-baseline', writeInput(baseRecord()), evDir, { REVIEW_STATE_DIR: evDir });
    expect(wNoVoice.code).toBe(3);
    expect(wNoVoice.out.trim()).toBe('FULL_REVIEW_RECORD: refused cycle-1-baseline: write point not reached (core)');
    expect(existsSync(join(evDir, 'cycle-1-baseline.json'))).toBe(false);

    expect(callCmd(evDir, 'record pass', {
      pass_id: '019315e0-0000-7000-8000-000000000002',
      state: 'attempt',
      voice_id: 'core',
      attempt_id: '019315e0-0000-7000-8000-000000000003',
      outcome: 'completed',
      findings: [],
    }).code).toBe(0);
    expect(callCmd(evDir, 'record pass', {
      pass_id: '019315e0-0000-7000-8000-000000000002',
      state: 'voice-complete',
      voice_id: 'core',
      selected_attempt_id: '019315e0-0000-7000-8000-000000000003',
    }).code).toBe(0);
    const wNoProbe = runRecord('write', 'cycle-1-baseline', writeInput(baseRecord()), evDir, { REVIEW_STATE_DIR: evDir });
    expect(wNoProbe.code).toBe(3);
    expect(wNoProbe.out.trim()).toBe(REFUSED_PROBE);
    expect(existsSync(join(evDir, 'cycle-1-baseline.json'))).toBe(false);

    expect(callCmd(evDir, 'record gate', {
      gate_id: '019315e0-0000-7000-8000-000000000004',
      name: 'probe-0123456789ab',
      result: 'passed',
      candidate: { commit: headSha, base: headSha },
    }).code).toBe(0);
    const wOk = runRecord('write', 'cycle-1-baseline', writeInput(baseRecord()), evDir, { REVIEW_STATE_DIR: evDir });
    expect(wOk.code, wOk.err).toBe(0);
    expect(wOk.out.trim()).toMatch(/^FULL_REVIEW_RECORD: written cycle-1-baseline; provenance=write-point; sha256=[0-9a-f]{64}$/);
    expect(existsSync(join(evDir, 'cycle-1-baseline.json'))).toBe(true);

    const lateDir = newDir();
    expect(callCmd(lateDir, 'start', {
      run_id: '019315e0-0000-7000-8000-000000000011',
      base: headSha,
      plan: { ref: 'plan.md', sha256: 'a'.repeat(64) },
      policy: { value: POLICY_RUN_STATE, source: 'caller prompt' },
      continuation: { prior_stops: 0, max: 0 },
    }).code).toBe(0);
    expect(callCmd(lateDir, 'record pass', {
      pass_id: '019315e0-0000-7000-8000-000000000012',
      state: 'started',
      scope: 'local',
      cycle: 1,
      coverage: 'full',
      candidate: { commit: headSha, base: headSha },
      required_voices: ['core'],
      started_at: '2026-11-12T00:00:00Z',
    }).code).toBe(0);
    expect(callCmd(lateDir, 'record pass', {
      pass_id: '019315e0-0000-7000-8000-000000000012',
      state: 'attempt',
      voice_id: 'core',
      attempt_id: '019315e0-0000-7000-8000-000000000013',
      outcome: 'completed',
      findings: [],
    }).code).toBe(0);
    expect(callCmd(lateDir, 'record pass', {
      pass_id: '019315e0-0000-7000-8000-000000000012',
      state: 'voice-complete',
      voice_id: 'core',
      selected_attempt_id: '019315e0-0000-7000-8000-000000000013',
    }).code).toBe(0);
    expect(runRecord('check', 'cycle-1-baseline', 'next-cycle', lateDir).code).toBe(1);
    writeFileSync(join(lateDir, 'review-cycle-1.txt'), `core review complete for snapshot ${s1}\n`);
    const wLateRefused = runRecord(
      'write',
      'cycle-1-baseline',
      writeInput(baseRecord({ provenance: 'late', sources: ['review-cycle-1.txt'] })),
      lateDir,
      { REVIEW_STATE_DIR: lateDir },
    );
    expect(wLateRefused.code).toBe(3);
    expect(wLateRefused.out.trim()).toBe(REFUSED_PROBE);
    expect(existsSync(join(lateDir, 'cycle-1-baseline.json'))).toBe(false);
  });

  // Value: protects=REVIEW_STATE_DIR precheck edge cases: valid-JSON states failing validateStoredState, first local full cycle-1 pass in record order, failed-attempt voice completion, not-applicable voice completion, and same-name probe gate on another candidate commit; fails_when=malformed state passes precheck, second pass masks first pass, failed or not-applicable voice is refused, or a probe gate on another commit satisfies the precheck; why_new=Track 89A T5 (Criterion 3); seam=CLI full-review-record and src/review-state/fence.ts
  test('REVIEW_STATE_DIR precheck covers malformed stored states, first cycle-1 pass order, failed and not-applicable voices, and probe gates on another candidate', () => {
    // 1. Valid JSON that fails validateStoredState: {} and a started state whose passes[0] lacks required_voices
    const emptyObjDir = newDir();
    writeFileSync(join(emptyObjDir, 'review-run-state.json'), '{}\n');
    const wEmptyObj = runRecord('write', 'cycle-1-baseline', writeInput(baseRecord()), emptyObjDir, { REVIEW_STATE_DIR: emptyObjDir });
    expect(wEmptyObj.code).toBe(3);
    expect(wEmptyObj.out.trim()).toBe(REFUSED_UNREADABLE);
    expect(existsSync(join(emptyObjDir, 'cycle-1-baseline.json'))).toBe(false);

    const badPassDir = newDir();
    expect(callCmd(badPassDir, 'start', {
      run_id: '019315e0-0000-7000-8000-000000000101',
      base: headSha,
      plan: { ref: 'plan.md', sha256: 'a'.repeat(64) },
      policy: { value: POLICY_RUN_STATE, source: 'caller prompt' },
      continuation: { prior_stops: 0, max: 0 },
    }).code).toBe(0);
    expect(callCmd(badPassDir, 'record pass', {
      pass_id: '019315e0-0000-7000-8000-000000000102',
      state: 'started',
      scope: 'local',
      cycle: 1,
      coverage: 'full',
      candidate: { commit: headSha, base: headSha },
      required_voices: ['core'],
      started_at: '2026-11-12T00:00:00Z',
    }).code).toBe(0);
    const badPassPath = join(badPassDir, 'review-run-state.json');
    const badPassRaw = JSON.parse(readFileSync(badPassPath, 'utf8'));
    delete badPassRaw.passes[0].required_voices;
    writeFileSync(badPassPath, `${JSON.stringify(badPassRaw, null, 2)}\n`);
    expect(validateStoredState(badPassRaw, badPassPath).ok).toBe(false);
    const wBadPass = runRecord('write', 'cycle-1-baseline', writeInput(baseRecord()), badPassDir, { REVIEW_STATE_DIR: badPassDir });
    expect(wBadPass.code).toBe(3);
    expect(wBadPass.out.trim()).toBe(REFUSED_UNREADABLE);
    expect(existsSync(join(badPassDir, 'cycle-1-baseline.json'))).toBe(false);

    // 2. First full cycle-one pass in record order: two local, full, cycle 1 passes
    const orderOkDir = newDir();
    expect(callCmd(orderOkDir, 'start', {
      run_id: '019315e0-0000-7000-8000-000000000111',
      base: headSha,
      plan: { ref: 'plan.md', sha256: 'a'.repeat(64) },
      policy: { value: POLICY_RUN_STATE, source: 'caller prompt' },
      continuation: { prior_stops: 0, max: 0 },
    }).code).toBe(0);
    expect(callCmd(orderOkDir, 'record pass', {
      pass_id: '019315e0-0000-7000-8000-000000000112',
      state: 'started',
      scope: 'local',
      cycle: 1,
      coverage: 'full',
      candidate: { commit: headSha, base: headSha },
      required_voices: ['core'],
      started_at: '2026-11-12T00:00:00Z',
    }).code).toBe(0);
    expect(callCmd(orderOkDir, 'record pass', {
      pass_id: '019315e0-0000-7000-8000-000000000112',
      state: 'attempt',
      voice_id: 'core',
      attempt_id: '019315e0-0000-7000-8000-000000000113',
      outcome: 'completed',
      findings: [{
        finding_id: 'legacy-fence-finding',
        severity_source: 'P1',
        severity_rubric: 'core',
        adjudication: 'accepted',
        resolution: 'open',
        found_by: ['core'],
      }],
    }).code).toBe(0);
    expect(callCmd(orderOkDir, 'record pass', {
      pass_id: '019315e0-0000-7000-8000-000000000112',
      state: 'voice-complete',
      voice_id: 'core',
      selected_attempt_id: '019315e0-0000-7000-8000-000000000113',
    }).code).toBe(0);
    // Second local, full, cycle 1 pass whose required voice 'red-team' has no result
    expect(callCmd(orderOkDir, 'record pass', {
      pass_id: '019315e0-0000-7000-8000-000000000114',
      state: 'started',
      scope: 'local',
      cycle: 1,
      coverage: 'full',
      candidate: { commit: headSha, base: headSha },
      required_voices: ['red-team'],
      started_at: '2026-11-12T00:01:00Z',
    }).code).toBe(0);
    expect(callCmd(orderOkDir, 'record gate', {
      gate_id: '019315e0-0000-7000-8000-000000000115',
      name: 'probe-0123456789ab',
      result: 'passed',
      candidate: { commit: headSha, base: headSha },
    }).code).toBe(0);
    // Use the pre-identity persisted shape for the successful fence and the reversed-order refusal.
    const legacyPath = join(orderOkDir, 'review-run-state.json');
    const legacyState = JSON.parse(readFileSync(legacyPath, 'utf8')) as ReviewRunState;
    Reflect.deleteProperty(legacyState.continuation, 'prior_state');
    Reflect.deleteProperty(legacyState.continuation, 'prior_findings');
    const legacyFinding = legacyState.passes[0]!.voices[0]!.attempts[0]!.findings![0]!;
    Reflect.deleteProperty(legacyFinding, 'finding_class');
    Reflect.deleteProperty(legacyFinding, 'identity');
    writeFileSync(legacyPath, JSON.stringify(legacyState));
    const wOrderOk = runRecord('write', 'cycle-1-baseline', writeInput(baseRecord()), orderOkDir, { REVIEW_STATE_DIR: orderOkDir });
    expect(wOrderOk.code, wOrderOk.err).toBe(0);
    expect(existsSync(join(orderOkDir, 'cycle-1-baseline.json'))).toBe(true);

    // Reversed order: first pass has required voice 'red-team' with no result; second pass has 'core' completed
    const orderRevDir = newDir();
    const revState = JSON.parse(readFileSync(join(orderOkDir, 'review-run-state.json'), 'utf8'));
    revState.passes = [revState.passes[1], revState.passes[0]];
    writeFileSync(join(orderRevDir, 'review-run-state.json'), `${JSON.stringify(revState, null, 2)}\n`);
    const wOrderRev = runRecord('write', 'cycle-1-baseline', writeInput(baseRecord()), orderRevDir, { REVIEW_STATE_DIR: orderRevDir });
    expect(wOrderRev.code).toBe(3);
    expect(wOrderRev.out.trim()).toBe('FULL_REVIEW_RECORD: refused cycle-1-baseline: write point not reached (red-team)');
    expect(existsSync(join(orderRevDir, 'cycle-1-baseline.json'))).toBe(false);

    // 3. Failed-attempt voice result (no voice-complete) + 4. Not-applicable voice result + 5. Same-name probe gate on another candidate
    const voiceAndProbeDir = newDir();
    expect(callCmd(voiceAndProbeDir, 'start', {
      run_id: '019315e0-0000-7000-8000-000000000121',
      base: baseSha,
      plan: { ref: 'plan.md', sha256: 'a'.repeat(64) },
      policy: { value: POLICY_RUN_STATE, source: 'caller prompt' },
      continuation: { prior_stops: 0, max: 0 },
    }).code).toBe(0);
    expect(callCmd(voiceAndProbeDir, 'record pass', {
      pass_id: '019315e0-0000-7000-8000-000000000122',
      state: 'started',
      scope: 'local',
      cycle: 1,
      coverage: 'full',
      candidate: { commit: headSha, base: baseSha },
      required_voices: ['core', 'outside:challenge'],
      started_at: '2026-11-12T00:00:00Z',
    }).code).toBe(0);
    // 'core' has only a failed attempt and no voice-complete
    expect(callCmd(voiceAndProbeDir, 'record pass', {
      pass_id: '019315e0-0000-7000-8000-000000000122',
      state: 'attempt',
      voice_id: 'core',
      attempt_id: '019315e0-0000-7000-8000-000000000123',
      outcome: 'failed',
    }).code).toBe(0);
    // 'outside:challenge' is closed with --not-applicable not-applicable and no attempt
    expect(runCli([
      'build', 'record', 'pass', '--dir', voiceAndProbeDir,
      '--pass-id', '019315e0-0000-7000-8000-000000000122',
      '--state', 'voice-complete',
      '--voice-id', 'outside:challenge',
      '--not-applicable', 'not-applicable',
    ]).code).toBe(0);
    // Probe gate recorded on baseSha (another candidate commit) leaves the write refused (0123456789ab)
    expect(callCmd(voiceAndProbeDir, 'record gate', {
      gate_id: '019315e0-0000-7000-8000-000000000124',
      name: 'probe-0123456789ab',
      result: 'passed',
      candidate: { commit: baseSha, base: baseSha },
    }).code).toBe(0);
    const incompleteRecord = baseRecord({
      stages: [
        { name: 'core', result: 'incomplete' },
        { name: 'outside:challenge', result: 'skipped — not-applicable' },
      ],
      completed: 'false',
      cause: 'reviewer-incomplete',
    });
    const wWrongCommitProbe = runRecord('write', 'cycle-1-baseline', writeInput(incompleteRecord), voiceAndProbeDir, { REVIEW_STATE_DIR: voiceAndProbeDir });
    expect(wWrongCommitProbe.code).toBe(3);
    expect(wWrongCommitProbe.out.trim()).toBe(REFUSED_PROBE);
    expect(existsSync(join(voiceAndProbeDir, 'cycle-1-baseline.json'))).toBe(false);

    // Adding the matching probe gate on headSha writes the record and preserves the caller's completed value
    expect(callCmd(voiceAndProbeDir, 'record gate', {
      gate_id: '019315e0-0000-7000-8000-000000000125',
      name: 'probe-0123456789ab',
      result: 'passed',
      candidate: { commit: headSha, base: baseSha },
    }).code).toBe(0);
    const wMatchingProbe = runRecord('write', 'cycle-1-baseline', writeInput(incompleteRecord), voiceAndProbeDir, { REVIEW_STATE_DIR: voiceAndProbeDir });
    expect(wMatchingProbe.code, wMatchingProbe.err).toBe(0);
    const writtenBaseline = JSON.parse(readFileSync(join(voiceAndProbeDir, 'cycle-1-baseline.json'), 'utf8'));
    expect(writtenBaseline.completed).toBe('false');
    expect(writtenBaseline.cause).toBe('reviewer-incomplete');
  });

  test('interrupted cycle-1 session recovers via show and checkpoint resume without continuation=full', () => {
    const evDir = newDir();
    expect(callCmd(evDir, 'start', {
      run_id: '019315e0-0000-7000-8000-000000000021',
      base: headSha,
      plan: { ref: 'plan.md', sha256: 'a'.repeat(64) },
      policy: { value: POLICY_RUN_STATE, source: 'caller prompt' },
      continuation: { prior_stops: 0, max: 0 },
      session_id: 'extend-019315e0-0000-7000-8000-000000000022',
    }).code).toBe(0);
    expect(callCmd(evDir, 'record pass', {
      pass_id: '019315e0-0000-7000-8000-000000000023',
      state: 'started',
      scope: 'local',
      cycle: 1,
      coverage: 'full',
      candidate: { commit: headSha, base: headSha },
      required_voices: ['core'],
      started_at: '2026-11-12T00:00:00Z',
    }).code).toBe(0);
    expect(callCmd(evDir, 'record pass', {
      pass_id: '019315e0-0000-7000-8000-000000000023',
      state: 'attempt',
      voice_id: 'core',
      attempt_id: '019315e0-0000-7000-8000-000000000024',
      outcome: 'completed',
      findings: [],
    }).code).toBe(0);
    expect(callCmd(evDir, 'record pass', {
      pass_id: '019315e0-0000-7000-8000-000000000023',
      state: 'voice-complete',
      voice_id: 'core',
      selected_attempt_id: '019315e0-0000-7000-8000-000000000024',
    }).code).toBe(0);

    const baselineInput = writeInput(baseRecord());
    const wInterrupted = runRecord('write', 'cycle-1-baseline', baselineInput, evDir, { REVIEW_STATE_DIR: evDir });
    expect(wInterrupted.code).toBe(3);
    expect(wInterrupted.out.trim()).toBe(REFUSED_PROBE);

    const showBefore = runCli(['show', '--dir', evDir, '--base', headSha]);
    expect(showBefore.code).toBe(0);
    expect(showBefore.json.lifecycle).toBe('open');
    expect(showBefore.json.last_checkpoint).toBeNull();
    expect(showBefore.json.gates.some((g: { name: string }) => g.name.startsWith('probe-'))).toBe(false);

    expect(callCmd(evDir, 'checkpoint', {
      checkpoint_id: '019315e0-0000-7000-8000-000000000025',
      kind: 'resume',
      base: headSha,
      session_id: 'extend-019315e0-0000-7000-8000-000000000026',
    }).code).toBe(0);
    expect(callCmd(evDir, 'record gate', {
      gate_id: '019315e0-0000-7000-8000-000000000027',
      name: 'probe-0123456789ab',
      result: 'passed',
      candidate: { commit: headSha, base: headSha },
    }).code).toBe(0);

    const wRecovered = runRecord('write', 'cycle-1-baseline', baselineInput, evDir, { REVIEW_STATE_DIR: evDir });
    expect(wRecovered.code, wRecovered.err).toBe(0);
    expect(wRecovered.out.trim()).toMatch(/^FULL_REVIEW_RECORD: written cycle-1-baseline; provenance=write-point; sha256=[0-9a-f]{64}$/);

    const showAfter = runCli(['show', '--dir', evDir, '--base', headSha]);
    expect(showAfter.code).toBe(0);
    expect(showAfter.json.segments[0]).toMatchObject({ segment: 1, end: 'interrupted' });
    expect(showAfter.json.segments[1]).toMatchObject({ segment: 2, end: null });
  });

  test('full-review-record --help and -h exit 0, document usage, kinds, boundaries, REVIEW_STATE_DIR, verbs and exit codes, and write nothing', () => {
    const empty = newDir();
    for (const flag of ['--help', '-h']) {
      const h = runCli(['full-review-record', flag], { cwd: empty });
      expect(h.code).toBe(0);
      expect(h.err).toBe('');
      expect(h.out).toContain('bin/review-state full-review-record WORKSPACE DIR write KIND FILE');
      expect(h.out).toContain('bin/review-state full-review-record WORKSPACE DIR check KIND BOUNDARY');
      expect(h.out).toContain('cycle-1-baseline');
      expect(h.out).toContain('cycle-1-fix-review');
      expect(h.out).toContain('before-fix');
      expect(h.out).toContain('next-cycle');
      expect(h.out).toContain('stop');
      expect(h.out).toContain('REVIEW_STATE_DIR');
      expect(h.out).toContain('not a review-state result envelope');
      for (const verb of ['written', 'present', 'missing', 'missed', 'unreadable', 'exists', 'invalid', 'refused']) {
        expect(h.out).toContain(`FULL_REVIEW_RECORD: ${verb} `);
      }
      expect(h.out).toContain('Exit codes: 0 written|present · 1 missing|missed|unreadable · 2 exists · 3 invalid|refused');
    }
    expect(readdirSync(empty)).toEqual([]);
  });

  test('argument errors keep the program messages and exit 3', () => {
    const evDir = newDir();
    const rMissing = runCli(['full-review-record', repo, evDir, 'check']);
    expect(rMissing.code).toBe(3);
    expect(rMissing.err).toBe('');
    expect(rMissing.out.trim()).toBe('FULL_REVIEW_RECORD: invalid undefined: kind');

    const rKind = runRecord('check', 'bogus', 'stop', evDir);
    expect(rKind.code).toBe(3);
    expect(rKind.err).toBe('');
    expect(rKind.out.trim()).toBe('FULL_REVIEW_RECORD: invalid bogus: kind');

    const rAction = runRecord('delete', 'cycle-1-baseline', 'stop', evDir);
    expect(rAction.code).toBe(3);
    expect(rAction.err).toBe('');
    expect(rAction.out.trim()).toBe('FULL_REVIEW_RECORD: invalid cycle-1-baseline: action');

    const rBoundary = runRecord('check', 'cycle-1-baseline', 'later', evDir);
    expect(rBoundary.code).toBe(3);
    expect(rBoundary.err).toBe('');
    expect(rBoundary.out.trim()).toBe('FULL_REVIEW_RECORD: invalid cycle-1-baseline: boundary');
  });

  test('launcher smoke through BIN_PATH returns stdout lines and exit codes 1, 0, 2 and 3', () => {
    const evDir = newDir();
    const inFile = writeInput(baseRecord());
    const spawnRec = (args: string[]) =>
      spawnWithFileOutput(BIN_PATH, ['full-review-record', repo, evDir, ...args], { encoding: 'utf8', env: GIT_ENV });

    const rMissing = spawnRec(['check', 'cycle-1-baseline', 'before-fix']);
    expect(rMissing.status).toBe(1);
    expect(rMissing.stderr).toBe('');
    expect(rMissing.stdout.trim()).toBe('FULL_REVIEW_RECORD: missing cycle-1-baseline');

    const rWritten = spawnRec(['write', 'cycle-1-baseline', inFile]);
    expect(rWritten.status).toBe(0);
    expect(rWritten.stderr).toBe('');
    expect(rWritten.stdout.trim()).toMatch(/^FULL_REVIEW_RECORD: written cycle-1-baseline; provenance=write-point; sha256=[0-9a-f]{64}$/);

    const rExists = spawnRec(['write', 'cycle-1-baseline', inFile]);
    expect(rExists.status).toBe(2);
    expect(rExists.stderr).toBe('');
    expect(rExists.stdout.trim()).toBe('FULL_REVIEW_RECORD: exists cycle-1-baseline');

    const rInvalid = spawnRec(['check', 'bogus', 'stop']);
    expect(rInvalid.status).toBe(3);
    expect(rInvalid.stderr).toBe('');
    expect(rInvalid.stdout.trim()).toBe('FULL_REVIEW_RECORD: invalid bogus: kind');
  });

  test('helper-built state with a corrupted stored-state field is refused as run-state unreadable and writes no record', () => {
    const evDir = newDir();
    expect(callCmd(evDir, 'start', {
      run_id: '019315e0-0000-7000-8000-000000000031',
      base: headSha,
      plan: { ref: 'plan.md', sha256: 'a'.repeat(64) },
      policy: { value: POLICY_RUN_STATE, source: 'caller prompt' },
      continuation: { prior_stops: 0, max: 0 },
    }).code).toBe(0);
    expect(callCmd(evDir, 'record pass', {
      pass_id: '019315e0-0000-7000-8000-000000000032',
      state: 'started',
      scope: 'local',
      cycle: 1,
      coverage: 'full',
      candidate: { commit: headSha, base: headSha },
      required_voices: ['core'],
      started_at: '2026-11-12T00:00:00Z',
    }).code).toBe(0);
    expect(callCmd(evDir, 'record pass', {
      pass_id: '019315e0-0000-7000-8000-000000000032',
      state: 'attempt',
      voice_id: 'core',
      attempt_id: '019315e0-0000-7000-8000-000000000033',
      outcome: 'completed',
      findings: [],
    }).code).toBe(0);
    expect(callCmd(evDir, 'record pass', {
      pass_id: '019315e0-0000-7000-8000-000000000032',
      state: 'voice-complete',
      voice_id: 'core',
      selected_attempt_id: '019315e0-0000-7000-8000-000000000033',
    }).code).toBe(0);
    expect(callCmd(evDir, 'record gate', {
      gate_id: '019315e0-0000-7000-8000-000000000034',
      name: 'probe-0123456789ab',
      result: 'passed',
      candidate: { commit: headSha, base: headSha },
    }).code).toBe(0);

    const statePath = join(evDir, 'review-run-state.json');
    const raw = JSON.parse(readFileSync(statePath, 'utf8'));
    raw.run.repo = 123;
    writeFileSync(statePath, `${JSON.stringify(raw, null, 2)}\n`);
    expect(validateStoredState(raw, statePath).ok).toBe(false);

    const w = runRecord('write', 'cycle-1-baseline', writeInput(baseRecord()), evDir, { REVIEW_STATE_DIR: evDir });
    expect(w.code).toBe(3);
    expect(w.err).toBe('');
    expect(w.out.trim()).toBe(REFUSED_UNREADABLE);
    expect(existsSync(join(evDir, 'cycle-1-baseline.json'))).toBe(false);
  });
});

describe('finish outcome escalated (H-G refresh escalation)', () => {
  const planSha = 'a'.repeat(64);
  const startEscalatedRun = (dir: string) => {
    expect(callCmd(dir, 'start', {
      run_id: '019315e0-0000-7000-8000-000000000041',
      base: baseSha,
      plan: { ref: 'plan.md', sha256: planSha },
      policy: { value: null, source: 'none supplied' },
      continuation: { prior_stops: 0, max: 1 },
      session_id: 'extend-019315e0-0000-7000-8000-000000000049',
    }).code).toBe(0);
  };

  test('requires stop_reason from the closed H-G set and refuses other reasons, delta_base, or stop_count', () => {
    const reasons = [
      'reviewed-code-conflict',
      'reviewed-behavior-change',
      'delta-finding',
      'delta-unverified',
      'final-gate-failed',
    ] as const;

    for (const reason of reasons) {
      const dir = newDir();
      startEscalatedRun(dir);
      const ok = callCmd(dir, 'finish', { outcome: 'escalated', base: baseSha, stop_reason: reason });
      expect(ok.code, reason).toBe(0);
      expect(ok.json.reason, reason).toBe('recorded');
      const stored = JSON.parse(readFileSync(join(dir, 'review-run-state.json'), 'utf8')) as ReviewRunState;
      expect(stored.finish?.outcome).toBe('escalated');
      expect(stored.finish?.stop_reason).toBe(reason);
      expect(validateStoredState(stored).ok).toBe(true);
    }

    const dirBad = newDir();
    startEscalatedRun(dirBad);
    const missingReason = callCmd(dirBad, 'finish', { outcome: 'escalated', base: baseSha });
    expect(missingReason.code).toBe(1);
    expect(missingReason.json.reason).toBe('invalid-input');

    const badReason = callCmd(dirBad, 'finish', { outcome: 'escalated', base: baseSha, stop_reason: 'other-reason' });
    expect(badReason.code).toBe(1);
    expect(badReason.json.reason).toBe('invalid-input');
    expect((badReason.json.detail as { violations: Array<{ path: string; rule: string }> }).violations)
      .toContainEqual(expect.objectContaining({ path: 'stop_reason', rule: 'invalid-enum' }));

    const withDelta = callCmd(dirBad, 'finish', {
      outcome: 'escalated',
      base: baseSha,
      stop_reason: 'reviewed-code-conflict',
      delta_base: headSha,
    });
    expect(withDelta.code).toBe(1);
    expect(withDelta.json.reason).toBe('invalid-input');

    const withStopCount = callCmd(dirBad, 'finish', {
      outcome: 'escalated',
      base: baseSha,
      stop_reason: 'reviewed-code-conflict',
      stop_count: 1,
    });
    expect(withStopCount.code).toBe(1);
    expect(withStopCount.json.reason).toBe('invalid-input');
  });

  test('renders final as the exact stage line and refuses comment, body, and full-receipt', () => {
    const dir = newDir();
    startEscalatedRun(dir);
    expect(callCmd(dir, 'finish', {
      outcome: 'escalated',
      base: baseSha,
      stop_reason: 'reviewed-behavior-change',
    }).code).toBe(0);

    const fin = callCmd(dir, 'render', { output: 'final' });
    expect(fin.code).toBe(0);
    expect(fin.json.exit).toBe('escalated');
    const finalFile = (fin.json.files as Array<{ path: string }>)[0]!.path;
    const text = readFileSync(finalFile, 'utf8');
    expect(text).toBe(
      `Stage handoff: stage-handoff/v1; stage: review; next: review-and-prep; status: stopped; head: ${headSha}; plan-sha256: ${planSha}\n`,
    );

    const fullRef = callCmd(dir, 'render', { output: 'full-receipt' });
    expect(fullRef.code).toBe(1);
    expect(fullRef.json.reason).toBe('invalid-input');
    expect((fullRef.json.detail as { violations: Array<{ rule: string }> }).violations[0]?.rule).toBe('not-renderable');

    const dummyFull = join(dir, 'full-receipt-1.md');
    writeFileSync(dummyFull, 'dummy\n');
    const dummySha = createHash('sha256').update('dummy\n').digest('hex');
    const dummySum = join(dir, 'summary.md');
    writeFileSync(dummySum, 'Summary text.\n');
    const sumSha = createHash('sha256').update('Summary text.\n').digest('hex');

    const commentRef = callCmd(dir, 'render', { output: 'comment', full_receipt: { path: 'full-receipt-1.md', sha256: dummySha } });
    expect(commentRef.code).toBe(1);
    expect((commentRef.json.detail as { violations: Array<{ rule: string }> }).violations[0]?.rule).toBe('not-renderable');

    const bodyRef = callCmd(dir, 'render', {
      output: 'body',
      full_receipt: { path: 'full-receipt-1.md', sha256: dummySha },
      summary: { path: 'summary.md', sha256: sumSha },
      comment_url: 'https://github.com/example/project/pull/1#issuecomment-1',
    });
    expect(bodyRef.code).toBe(1);
    expect((bodyRef.json.detail as { violations: Array<{ rule: string }> }).violations[0]?.rule).toBe('not-renderable');
  });

  test('export reports a blocked segment outcome and no completed run end', () => {
    const dir = newDir();
    startEscalatedRun(dir);
    expect(callCmd(dir, 'finish', {
      outcome: 'escalated',
      base: baseSha,
      stop_reason: 'final-gate-failed',
    }).code).toBe(0);

    const exp = runCli(['export', '--dir', dir]);
    expect(exp.code).toBe(0);
    const segments = exp.json.segments as Array<{ outcome: string }>;
    expect(segments[0]?.outcome).toBe('blocked');
    const records = exp.json.records as Array<{ op: string; request: { outcome?: string } }>;
    const endRecs = records.filter((r) => r.op === 'end');
    expect(endRecs.length).toBeGreaterThan(0);
    expect(endRecs.every((r) => r.request.outcome !== 'completed')).toBe(true);
  });

  test('reads a pre-refresh stored state and rejects an unknown recorded escalation reason', () => {
    // Captured from the 0.120.0 state writer at 6cd4603 before the escalation outcome existed.
    const legacy = JSON.parse(`{
      "schema": "review-run-state/v1",
      "rev": 2,
      "writer": "0.120.0",
      "host": "fixture",
      "run": {"run_id":"019315e0-0000-7000-8000-000000000041","skill":"review-and-prep","repo":"/fixture/project/.git","branch":"feature","pr":null,"gh_login":null,"started_at":"2026-11-10T18:00:00Z"},
      "binding": {"head":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","tree":"cccccccccccccccccccccccccccccccccccccccc","base":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","wtree":null},
      "plan": {"ref":"plan.md","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
      "policy": {"value":null,"source":"none supplied","delegation":null},
      "continuation": {"prior_stops":0,"max":0,"continues":null},
      "segments": [{"segment":1,"started_at":"2026-11-10T18:00:00Z","ended_at":"2026-11-10T18:02:00Z","end":"finished","session_id":null,"toplevel":"/fixture/project"}],
      "passes": [],
      "corrections": [],
      "gates": [],
      "audits": [],
      "checkpoints": [],
      "finish": {"outcome":"needs-context","stop_reason":"missing-plan","head":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","tree":"cccccccccccccccccccccccccccccccccccccccc","base":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","delta_base":null,"stop_count":null,"wtree":null,"review_restriction_resolved":false,"readiness_confirmed_at":null,"full_review_evidence":null,"user_facing_changes":[],"evidence":[],"finished_at":"2026-11-10T18:02:00Z"}
    }`) as ReviewRunState;
    expect(validateStoredState(legacy).ok).toBe(true);

    const invalid = { ...legacy, finish: { ...legacy.finish, outcome: 'escalated', stop_reason: 'other-reason' } };
    expect(validateStoredState(invalid)).toEqual({
      ok: false,
      reason: 'corrupt',
      detail: { path: 'review-run-state.json', message: 'invalid-enum at finish.stop_reason' },
    });
  });
});

describe('cross-cycle finding identity', () => {
  const stateFile = 'review-run-state.json';
  const priorFile = 'prior-run-state.json';
  const identityFile = 'identity-example.txt';
  const readState = (dir: string): ReviewRunState => JSON.parse(readFileSync(join(dir, stateFile), 'utf8'));
  const show = (dir: string) => {
    const result = runCli(['show', '--dir', dir]);
    expect(result.code, result.out).toBe(0);
    return result.json;
  };
  const start = (dir: string, id: number, extra: Record<string, unknown> = {}) =>
    callCmd(dir, 'start', mkStart(id, extra));
  const continued = (stops = 1) => ({ prior_stops: stops, max: 3, continues: headSha });
  const record = (dir: string, payload: Record<string, unknown>) => {
    const result = callCmd(dir, 'record pass', payload);
    expect(result.json.reason, result.out).toBe('recorded');
    return result;
  };
  const begin = (dir: string, pass: number, extra: Record<string, unknown> = {}) =>
    record(dir, mkPassStarted(pass, { required_voices: ['core'], ...extra }));
  const finding = (finding_id: string, line?: number, finding_class = 'correctness', path = 'file.txt') => ({
    finding_id, severity_source: 'P1', severity_rubric: 'core', adjudication: 'accepted', resolution: 'open', found_by: ['core'],
    finding_class, ...(line === undefined ? {} : { identity: { path, line } }),
  });
  const attempt = (dir: string, pass: number, id: number, findings: ReturnType<typeof finding>[], anchor_commit?: string, voice_id = 'core') =>
    record(dir, {
      pass_id: uid(pass), state: 'attempt', voice_id, part: 'core', attempt_id: uid(id), outcome: 'completed',
      findings, ...(anchor_commit === undefined ? {} : { anchor_commit }),
    });
  const select = (dir: string, pass: number, id: number, voice_id = 'core') =>
    record(dir, { pass_id: uid(pass), state: 'voice-complete', voice_id, selected_attempt_id: uid(id) });
  const complete = (dir: string, pass: number) =>
    record(dir, { pass_id: uid(pass), state: 'completed' });
  const stop = (dir: string, stop_count = 1) => {
    const result = callCmd(dir, 'finish', { outcome: 'stopped', base: baseSha, stop_reason: 'cycle cap', delta_base: headSha, stop_count });
    expect(result.json.reason, result.out).toBe('recorded');
    return readFileSync(join(dir, stateFile));
  };
  const report = (dir: string, pass: number, findings: ReturnType<typeof finding>[], anchor?: string, extra: Record<string, unknown> = {}) => {
    begin(dir, pass, extra);
    attempt(dir, pass, pass + 1, findings, anchor);
    select(dir, pass, pass + 1);
    complete(dir, pass);
  };
  const snapshot = (content: string | Buffer) => {
    const fixturePath = join(newDir(), 'file.txt');
    writeFileSync(fixturePath, content);
    const blob = git(repo, ['hash-object', '-w', fixturePath]);
    const tree = spawnSync('git', ['-C', repo, 'mktree'], {
      encoding: 'utf8', env: GIT_ENV, input: `100644 blob ${blob}\tfile.txt\n`,
    });
    expect(tree.status, tree.stderr).toBe(0);
    return git(repo, ['commit-tree', tree.stdout.trim(), '-p', headSha, '-m', 'frozen review candidate']);
  };
  const copyPrior = (dir: string, bytes: Buffer, path = priorFile) => {
    writeFileSync(join(dir, path), bytes);
    return { path, sha256: sha256(bytes) };
  };
  const imports = (dir: string, id: number, bytes: Buffer, stops = 1) =>
    start(dir, id, { continuation: continued(stops), prior_state: copyPrior(dir, bytes) });
  const render = (dir: string, input: unknown) => {
    const result = callCmd(dir, 'render', input);
    expect(result.code, result.out).toBe(0);
    return { file: result.json.files[0], text: readFileSync(result.json.files[0].path, 'utf8') };
  };
  const exportRun = (dir: string): ReviewStateExport => {
    const result = runCli(['export', '--dir', dir]);
    expect(result.code, result.out).toBe(0);
    expect(result.json.schema).toBe('review-state-export/v1');
    return result.json;
  };
  const runMetrics = () => {
    const fixture = makeTelemetryFixture('community');
    const telemetry = (args: string[]) => {
      const result = spawnSync(HELPER_BIN, args, { cwd: repo, env: fixture.env, encoding: 'utf8', timeout: 15_000 });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toBe('');
      return JSON.parse(result.stdout);
    };
    return {
      derive: (dir: string) => telemetry(['derive', '--dir', dir]),
      read: (sid: string) => telemetry(['metrics', 'read', '--session-id', sid]),
      ledger: (sid: string) => readFileSync(join(fixture.home, '.gstack-extend', 'analytics', 'workflow-metrics', `${sha256(sid)}.jsonl`), 'utf8'),
    };
  };

  // Value: protects=path-free finding attribution and evolving cycle snapshots through the real metrics writer; fails_when=mid-run re-derives conflict, drop counts, or duplicate unchanged records; why_new=105B criteria 1/4; seam=review-state export, telemetry derive and metrics read
  test('derives path-free finding identities and appends evolving cycle snapshots only once', () => {
    const dir = newDir();
    const frozen = snapshot('first premise\nsecond premise on the same path\n');
    const metrics = runMetrics();
    expect(start(dir, 1500, { session_id: null }).json.reason).toBe('recorded');
    begin(dir, 1510);

    const projectAndRead = (cycles: unknown[], recorded: number) => {
      const exported = exportRun(dir);
      const sid = exported.segments[0]!.session_id;
      const sidecar = exported.records.find(({ op }) => op === 'finding-cycles')!;
      expect(sidecar).toEqual({
        session_id: sid, op: 'finding-cycles', request: {
          v: 1, stage: 'review-and-prep', session_id: sid, cycles,
          event_id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
        },
      });
      expect(metrics.derive(dir)).toMatchObject({
        status: 'ok', reason: null, data: { sessions: [{ session_id: sid, recorded, failed: 0, reason: null }] },
      });
      expect(metrics.read(sid)).toMatchObject({ status: 'ok', data: { capture: 'ok', finding_cycles: cycles } });
      const ledger = metrics.ledger(sid);
      for (const records of [JSON.stringify(exported.records), ledger]) {
        expect(records).not.toContain('file.txt');
        expect(records).not.toContain('"path"');
      }
      return { exported, sidecar, ledger };
    };

    const openCycle = {
      run: 1, cycle: 1, coverage: 'full', observed: 'partial', new: 0, carried: 0,
      repeated_premise: 0, repeated_premise_pairs: 0, unkeyed: 0, prior: 'none',
    };
    const open = projectAndRead([openCycle], 3);
    const { finding_class: _class, ...unkeyed } = finding('unkeyed');
    record(dir, {
      pass_id: uid(1510), state: 'attempt', voice_id: 'core', part: 'core', attempt_id: uid(1511), outcome: 'completed',
      anchor_commit: frozen,
      findings: [finding('keyed', 1), finding('class-only', undefined, 'docs'), unkeyed],
      delegate: {
        provider: 'openai', model: 'gpt-5', outcome: 'credited', fallback_reason: null, replay: false,
        wall_ms: 420, input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20,
        cache_creation_input_tokens: null, call_id: sha256('call-1511'),
      },
    });
    select(dir, 1510, 1511);
    complete(dir, 1510);
    const completedCycle = { ...openCycle, observed: 'complete', new: 1, unkeyed: 2 };
    const completed = projectAndRead([completedCycle], 4);
    const exportedAttempt = completed.exported.records.find(({ request }) => request.attempt_id === uid(1511))!;
    const key = readState(dir).passes[0]!.voices[0]!.attempts[0]!.findings![0]!.identity!.key;
    expect(key).toMatch(/^fk1:[0-9a-f]{16}$/);
    expect(exportedAttempt.request).toMatchObject({
      v: 4, delegate: { provider: 'openai', outcome: 'credited' }, findings: [
        { finding_id: 'keyed', finding_key: key, finding_class: 'correctness' },
        { finding_id: 'class-only', finding_key: null, finding_class: 'docs' },
        { finding_id: 'unkeyed', finding_key: null, finding_class: null },
      ],
    });

    report(dir, 1520, [finding('carried', 1), finding('repeated-premise', 2)], frozen, { cycle: 2, coverage: 'delta', delta_from: baseSha });
    const secondCycle = {
      ...openCycle, cycle: 2, coverage: 'delta', observed: 'complete', new: 1, carried: 1,
      repeated_premise: 1, repeated_premise_pairs: 1,
    };
    const completeCycles = [completedCycle, secondCycle];
    const second = projectAndRead(completeCycles, 5);
    const replay = projectAndRead(completeCycles, 0);
    expect(replay.sidecar).toEqual(second.sidecar);
    expect(replay.ledger).toBe(second.ledger);

    // An empty follow-up makes cycle 2 partial again, then restores the exact completed counts.
    begin(dir, 1522, { cycle: 2, coverage: 'delta', delta_from: baseSha });
    const reopened = projectAndRead([completedCycle, { ...secondCycle, observed: 'partial' }], 2);
    attempt(dir, 1522, 1523, []);
    select(dir, 1522, 1523);
    complete(dir, 1522);
    const restored = projectAndRead(completeCycles, 4);
    expect(restored.sidecar.request.cycles).toEqual(second.sidecar.request.cycles);
    expect(restored.sidecar.request.event_id).not.toBe(second.sidecar.request.event_id);
    const finalReplay = projectAndRead(completeCycles, 0);
    expect(finalReplay.sidecar).toEqual(restored.sidecar);
    expect(finalReplay.ledger).toBe(restored.ledger);

    const snapshots = [open, completed, second, reopened, restored];
    expect(new Set(snapshots.map(({ sidecar }) => sidecar.request.event_id)).size).toBe(snapshots.length);
    const rows = restored.ledger.trimEnd().split('\n').map(line => JSON.parse(line));
    expect(rows.filter(({ op }) => op === 'finding-cycles')).toMatchObject(
      snapshots.map(({ sidecar }) => ({ v: 3, request: sidecar.request, event_id: sidecar.request.event_id })),
    );
    expect(rows.find(({ event_id }) => event_id === exportedAttempt.request.event_id)).toMatchObject({ v: 1, op: 'pass', request: exportedAttempt.request });
  }, 30_000);

  // Value: protects=latest segment cycle ownership after replay; fails_when=a transferred cycle leaves the former segment reporting an older snapshot; why_new=105B review regression; seam=review-state export and workflow metrics
  test('refreshes a prior segment snapshot when a resumed pass takes ownership of a cycle', () => {
    const dir = newDir();
    expect(start(dir, 1700, { session_id: null }).json.reason).toBe('recorded');
    const metrics = runMetrics();
    report(dir, 1710, []);
    const firstExport = exportRun(dir);
    const firstSid = firstExport.segments[0]!.session_id;
    expect(metrics.derive(dir)).toMatchObject({ status: 'ok' });
    expect(metrics.read(firstSid).data.finding_cycles).toMatchObject([{ cycle: 1 }]);

    report(dir, 1720, [], undefined, { cycle: 2 });
    expect(callCmd(dir, 'checkpoint', { checkpoint_id: uid(1730), kind: 'pause', base: baseSha }).json.reason).toBe('recorded');
    expect(metrics.derive(dir)).toMatchObject({ status: 'ok' });
    expect(metrics.read(firstSid).data.finding_cycles).toMatchObject([{ cycle: 1 }, { cycle: 2 }]);

    expect(callCmd(dir, 'checkpoint', { checkpoint_id: uid(1731), kind: 'resume', base: baseSha, session_id: null }).json.reason).toBe('recorded');
    report(dir, 1740, [], undefined, { cycle: 2 });
    const resumedExport = exportRun(dir);
    const secondSid = resumedExport.segments[1]!.session_id;
    const expectedCycles = resumedExport.records.filter(({ op }) => op === 'finding-cycles');
    expect(expectedCycles).toMatchObject([
      { session_id: firstSid, request: { cycles: [{ cycle: 1 }] } },
      { session_id: secondSid, request: { cycles: [{ cycle: 2 }] } },
    ]);
    expect(metrics.derive(dir)).toMatchObject({ status: 'ok' });
    expect(metrics.read(firstSid)).toMatchObject({ status: 'ok', data: { finding_cycles: [{ cycle: 1 }] } });
    expect(metrics.read(secondSid)).toMatchObject({ status: 'ok', data: { finding_cycles: [{ cycle: 2 }] } });
    expect(metrics.derive(dir)).toMatchObject({ status: 'ok', data: { sessions: [{ recorded: 0 }, { recorded: 0 }] } });
  }, 30_000);

  // Value: protects=the run end when an advisory snapshot is refused; fails_when=derive drops the terminal record on the sidecar limit; why_new=105B review regression; seam=review-state export and telemetry derive
  test('keeps the run end when a cycle snapshot exceeds its bounds', () => {
    const dir = newDir();
    const fixture = makeTelemetryFixture('community');
    const telemetry = (...args: string[]) =>
      spawnSync(HELPER_BIN, args, { cwd: repo, env: fixture.env, encoding: 'utf8', timeout: 15_000 });
    const started = telemetry('start', '--skill', 'extend:review-and-prep');
    expect(started.status, started.stderr).toBe(0);
    const sid = /session=(extend-[0-9a-f-]{36})/.exec(started.stdout)?.[1];
    expect(sid).toBeDefined();
    expect(start(dir, 1800, { session_id: sid }).json.reason).toBe('recorded');
    report(dir, 1810, [], undefined, { cycle: 2 ** 31 });
    expect(callCmd(dir, 'checkpoint', { checkpoint_id: uid(1820), kind: 'pause', base: baseSha }).json.reason).toBe('recorded');

    const derived = telemetry('derive', '--dir', dir);
    expect(derived.status, derived.stderr).toBe(0);
    expect(JSON.parse(derived.stdout)).toMatchObject({
      status: 'partial', data: { sessions: [{ session_id: sid, reason: 'invalid-input' }] },
    });
    const ledgerPath = join(fixture.home, '.gstack-extend/analytics/workflow-metrics', sha256(sid!) + '.jsonl');
    const ledger = readFileSync(ledgerPath, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
    expect(ledger.map(record => [record.op, record.request.outcome ?? null])).toEqual([
      ['begin', null], ['pass', null], ['pass', null], ['pass', null], ['pass', null], ['end', 'paused'],
    ]);
  }, 30_000);

  // Value: protects=first-seen cycle grouping and last-known segment ownership through pauses and legacy null segments; fails_when=a local cycle splits, moves to a null segment, or displaces an interleaved Greptile cycle; why_new=105B criterion 4; seam=stored-state export
  test('projects each cycle once into its last known segment and skips groups with no segment', () => {
    const dir = newDir();
    expect(start(dir, 1530, { session_id: null }).json.reason).toBe('recorded');
    report(dir, 1540, []);
    report(dir, 1550, [], undefined, { scope: 'greptile' });
    report(dir, 1560, [], undefined, { cycle: 2 });
    expect(callCmd(dir, 'checkpoint', { checkpoint_id: uid(1570), kind: 'pause', base: baseSha }).json.reason).toBe('recorded');
    const recordedSid = `extend-${uid(1571)}`;
    expect(callCmd(dir, 'checkpoint', { checkpoint_id: uid(1571), kind: 'resume', base: baseSha, session_id: recordedSid }).json.reason).toBe('recorded');
    report(dir, 1580, [], undefined, { coverage: 'delta', delta_from: baseSha });
    report(dir, 1590, []);
    report(dir, 1600, [], undefined, { cycle: 3 });

    const legacy = readState(dir);
    legacy.passes[4]!.segment = null;
    legacy.passes[5]!.segment = null;
    writeFileSync(join(dir, stateFile), JSON.stringify(legacy));
    const exported = exportRun(dir);
    expect(exported.skipped.map(({ id }) => id)).toEqual([uid(1590), uid(1600)]);
    expect(exported.records.filter(({ op }) => op === 'finding-cycles')).toMatchObject([
      { session_id: exported.segments[0]!.session_id, request: { cycles: [
        { cycle: 'greptile', coverage: 'full' }, { cycle: 2, coverage: 'full' },
      ] } },
      { session_id: recordedSid, request: { cycles: [{ cycle: 1, coverage: 'mixed' }] } },
    ]);
  });

  // Value: protects=frozen-blob key normalization and safe downgrade; fails_when=the live file or line number enters the key, Unicode whitespace collapses, duplicate normalized lines alias or same-line same-class reports share a key; why_new=102A E1-E3; seam=direct JSON and Git objects
  test('golden fk1 vectors survive re-anchoring and distinguish classes on one line', () => {
    const dir = newDir();
    const source = '\talpha  \t beta \r\ncafé\u00a0détail\r\n  duplicate\r\n\tduplicate\r\nfinal';
    const frozen = snapshot(source);
    const moved = snapshot(`unrelated line\r\n${source}`);
    expect(start(dir, 1100).json.reason).toBe('recorded');
    begin(dir, 1110);
    const findings = [
      finding('A', 1, 'correctness', './file.txt'),
      finding('B', 1, 'contract'),
      finding('C', 1),
      finding('D', 2),
      finding('E', 3),
      finding('F', 5),
      finding('G', 6),
      finding('H', 1, 'correctness', 'deleted.txt'),
    ];
    const result = attempt(dir, 1110, 1111, findings, frozen);
    expect(result.err).toContain('WARNING IDENTITY_DOWNGRADED');
    expect(result.json.detail.identity_downgraded.map((entry: { finding_id: string }) => entry.finding_id).sort())
      .toEqual(['C', 'E', 'G', 'H']);
    select(dir, 1110, 1111);
    complete(dir, 1110);
    report(dir, 1120, [finding('A-again', 2)], moved, { cycle: 2 });
    const [original, reanchored] = readState(dir).passes.map((pass) => pass.voices[0]!.attempts[0]!.findings!);
    expect(original!.map(({ finding_class, identity }) => [finding_class, identity?.key ?? null])).toEqual([
      ['correctness', 'fk1:d4783c16027feaec'],
      ['contract', 'fk1:56b779da16a17cc9'],
      ['correctness', null],
      ['correctness', 'fk1:e59f379ffc515b0b'],
      ['correctness', null],
      ['correctness', 'fk1:748d98f4ff9322f7'],
      ['correctness', null],
      ['correctness', null],
    ]);
    expect(original![0]!.identity?.path).toBe('file.txt');
    expect(reanchored![0]!.identity).toEqual(original![0]!.identity!);
    expect(show(dir).finding_cycles).toMatchObject([
      { cycle: 1, new: 4, carried: 0, unkeyed: 4 },
      { cycle: 2, new: 0, carried: 1, unkeyed: 0 },
    ]);
    for (const output of [result.out, result.err, JSON.stringify(readState(dir)), JSON.stringify(show(dir))]) {
      expect(output).not.toContain('café');
      expect(output).not.toContain('alpha beta');
    }
  });

  test('replays the mandatory attempt payload without rereading identity evidence', () => {
    const dir = newDir();
    const frozen = snapshot('unique replay anchor');
    expect(start(dir, 1101).json.reason).toBe('recorded');
    begin(dir, 1102);
    writeFileSync(join(dir, identityFile), 'F-retry contract file.txt 1\n');
    const args = [
      'build', 'record', 'pass', '--dir', dir, '--pass-id', uid(1102), '--state', 'attempt',
      '--voice-id', 'core', '--part', 'core', '--attempt-id', uid(1103), '--outcome', 'completed',
      '--finding-identity-file', identityFile, '--anchor-commit', frozen, '--finding', 'F-retry,P1,core',
    ];
    expect(runCli(args).json.reason).toBe('recorded');
    const original = readFileSync(join(dir, stateFile));
    expect(readState(dir).passes[0]?.voices[0]?.attempts[0]?.findings?.[0]?.identity?.key).toMatch(/^fk1:/);
    unlinkSync(join(dir, identityFile));
    const replay = runCli(args);
    expect(replay.code, replay.err).toBe(0);
    expect(replay.json.reason).toBe('replayed');
    expect(readFileSync(join(dir, stateFile))).toEqual(original);
    expect(runCli([...args.slice(0, -1), 'F-retry,P2,core']).json.reason).toBe('conflict');
  });

  test('accepts null file flags and keys a selected replacement of an unselected attempt', () => {
    const dir = newDir();
    const frozen = snapshot('provisional citation\ncorrected citation');
    expect(start(dir, 1104).json.reason).toBe('recorded');
    begin(dir, 1105);
    const attemptPayload = {
      pass_id: uid(1105), state: 'attempt', voice_id: 'core', part: 'core', outcome: 'completed',
      anchor_commit: frozen,
    };
    const first = record(dir, {
      ...attemptPayload, attempt_id: uid(1106), finding_identity_file: null, findings: [finding('F-retry', 1)],
    });
    expect(first.err).toBe('');
    const replacement = record(dir, {
      ...attemptPayload, attempt_id: uid(1107), predecessor_attempt_id: uid(1106), findings: [finding('F-retry', 2)],
    });
    expect(replacement.err).toBe('');
    select(dir, 1105, 1107);
    complete(dir, 1105);
    const [unselected, selected] = readState(dir).passes[0]!.voices[0]!.attempts;
    expect(unselected?.findings?.[0]?.identity?.key).toMatch(/^fk1:/);
    expect(selected?.findings?.[0]?.identity?.key).toMatch(/^fk1:/);
    expect(selected?.findings?.[0]?.identity).not.toEqual(unselected?.findings?.[0]?.identity);
    expect(show(dir).finding_cycles).toMatchObject([{ new: 1, unkeyed: 0 }]);
  });

  // Value: protects=build file errors remain advisory and preserve valid keys; fails_when=the optional file refuses an attempt, an extra line for a different attempt downgrades a finding or a malformed row drops neighboring keys; why_new=102A E3/E9; seam=build CLI
  test('identity file errors identify affected lines and preserve 19 valid keys', () => {
    const dir = newDir();
    const frozen = snapshot(Array.from({ length: 22 }, (_, index) => `unique anchor ${index + 1}`).join('\n'));
    expect(start(dir, 1130).json.reason).toBe('recorded');
    begin(dir, 1140, { required_voices: ['core', 'second'] });
    const goodIds = Array.from({ length: 19 }, (_, index) => `good-${index + 1}`);
    const args = (id: number, voice: string, ids: string[], file = identityFile, anchor = frozen) => [
      'build', 'record', 'pass', '--dir', dir, '--pass-id', uid(1140), '--state', 'attempt',
      '--voice-id', voice, '--part', 'core', '--attempt-id', uid(id), '--outcome', 'completed',
      '--finding-identity-file', file, ...(anchor ? ['--anchor-commit', anchor] : []),
      ...ids.flatMap((findingId) => ['--finding', `${findingId},P1,core`]),
    ];
    writeFileSync(join(dir, identityFile), [
      ...goodIds.map((id, index) => `${id} correctness file.txt ${index + 1}`),
      'collision correctness file.txt 1',
      'malformed correctness file.txt',
      'badClass invalid file.txt 20',
      'duplicate correctness file.txt 20',
      'duplicate contract file.txt 21',
      'badPath correctness ../file.txt 20',
      'badLine correctness file.txt -1',
      'different-voice correctness file.txt 21',
      '',
    ].join('\n'));
    const badIds = ['collision', 'malformed', 'badClass', 'duplicate', 'badPath', 'badLine', 'absent'];
    const result = runCli(args(1141, 'core', [...goodIds, ...badIds]));
    expect(result.json.reason, result.out).toBe('recorded');
    expect(result.err).toBe('WARNING IDENTITY_DOWNGRADED: 7 finding(s); see detail.identity_downgraded\n');
    expect(result.json.detail.identity_downgraded).toEqual(
      expect.arrayContaining([
        { line: 20, finding_id: 'collision', rule: expect.any(String) },
        { line: 21, finding_id: 'malformed', rule: expect.any(String) },
        { line: 22, finding_id: 'badClass', rule: expect.any(String) },
        { line: 24, finding_id: 'duplicate', rule: expect.any(String) },
        { line: 25, finding_id: 'badPath', rule: expect.any(String) },
        { line: 26, finding_id: 'badLine', rule: expect.any(String) },
        expect.objectContaining({ finding_id: 'absent' }),
      ]),
    );
    const [first] = readState(dir).passes[0]!.voices[0]!.attempts;
    expect(first!.findings!.filter((item) => item.identity).map((item) => item.finding_id)).toEqual(goodIds);
    expect(first!.findings!.find((item) => item.finding_id === 'badClass')?.finding_class).toBeNull();
    expect(first!.findings!.find((item) => item.finding_id === 'duplicate')?.finding_class).toBeNull();
    expect(first!.findings!.find((item) => item.finding_id === 'malformed')?.finding_class).toBe('correctness');
    expect(runCli(args(1142, 'second', ['different-voice'])).err).toBe('');
    expect(readState(dir).passes[0]!.voices[1]!.attempts[0]!.findings?.[0]?.identity).not.toBeNull();

    const unusable = [
      ['missing.txt', null],
      ['oversized.txt', Buffer.alloc(256 * 1024 + 1, 0x20)],
      ['invalid-utf8.txt', Buffer.from([0xff])],
    ] as const;
    for (const [offset, [file, bytes]] of unusable.entries()) {
      if (bytes) writeFileSync(join(dir, file), bytes);
      const res = runCli(args(1150 + offset, 'core', ['one', 'two'], file));
      expect(res.json.reason).toBe('recorded');
      expect(res.json.detail.identity_downgraded.map((e: { rule: string }) => e.rule)).toEqual(['identity-file-unusable', 'identity-file-unusable']);
      expect(readState(dir).passes[0]!.voices[0]!.attempts.at(-1)?.findings?.map((f) => f.finding_class)).toEqual([null, null]);
    }
    symlinkSync(identityFile, join(dir, 'symlink.txt'));
    const linked = runCli(args(1154, 'core', ['good-1'], 'symlink.txt'));
    expect(linked.json.detail.identity_downgraded[0]).toMatchObject({ finding_id: 'good-1', rule: 'identity-file-unusable' });
    linkSync(join(dir, identityFile), join(dir, 'alias.txt'));
    const alias = runCli(args(1156, 'core', ['good-1'], 'alias.txt'));
    expect(alias.json.detail.identity_downgraded[0]).toMatchObject({ finding_id: 'good-1', rule: 'identity-file-unusable' });
    unlinkSync(join(dir, 'alias.txt'));
    const missingAnchor = runCli(args(1155, 'core', ['good-1'], identityFile, ''));
    expect(missingAnchor.json.reason).toBe('recorded');
    expect(missingAnchor.json.detail.identity_downgraded[0]).toMatchObject({ finding_id: 'good-1', rule: 'anchor-commit-missing' });
    expect(readState(dir).passes[0]!.voices[0]!.attempts.at(-1)?.findings?.[0]).toMatchObject({ finding_class: 'correctness', identity: null });
  });

  // Value: protects=selected-attempt grouping, class-only conflict handling and same-ID carry on a changed anchor; fails_when=unselected findings enter a count, corrections rewrite counts, Greptile folds into local evidence, or partial observations appear complete; why_new=102A A3/E5; seam=show and stopped render
  test('cycle reports preserve observation order and remain independent of adjudication', () => {
    const dir = newDir();
    const frozen = snapshot('original anchor\nmodified anchor\na new premise\n');
    expect(start(dir, 1160).json.reason).toBe('recorded');
    begin(dir, 1170, { required_voices: ['core', 'second', 'third'] });
    attempt(dir, 1170, 1171, [finding('unselected', 3)], frozen);
    attempt(dir, 1170, 1172, [finding('same', 1)], frozen);
    attempt(dir, 1170, 1173, [finding('same'), finding('same-anchor-other-id', 1)], frozen, 'second');
    const conflicting = attempt(dir, 1170, 1174, [finding('same', 2)], frozen, 'third');
    expect(conflicting.json.detail.identity_downgraded).toMatchObject([{ finding_id: 'same', rule: expect.any(String) }]);
    expect(readState(dir).passes[0]!.voices[2]!.attempts[0]!.findings?.[0]?.identity).toBeNull();
    select(dir, 1170, 1172);
    select(dir, 1170, 1173, 'second');
    select(dir, 1170, 1174, 'third');
    complete(dir, 1170);
    report(dir, 1180, [], frozen, { coverage: 'delta', delta_from: baseSha });

    report(dir, 1190, [], frozen, { cycle: 1, scope: 'greptile' });
    report(dir, 1200, [finding('same', 2), finding('another', 3)], frozen, { cycle: 2, coverage: 'delta', delta_from: baseSha });
    report(dir, 1210, [finding('rename', 1)], frozen, { cycle: 1, scope: 'greptile' });
    begin(dir, 1220, { cycle: 3 });
    attempt(dir, 1220, 1221, [finding('not-yet-selected', 3, 'docs')], frozen);
    const beforeCorrection = show(dir).finding_cycles;
    expect(beforeCorrection).toMatchObject([
      { run: 1, cycle: 1, coverage: 'mixed', observed: 'complete', new: 1, carried: 0, repeated_premise: 0, repeated_premise_pairs: 0, unkeyed: 0, prior: 'none' },
      { run: 1, cycle: 'greptile', coverage: 'full', observed: 'complete', new: 0, carried: 0, repeated_premise: 0, unkeyed: 0, prior: 'none' },
      { run: 1, cycle: 2, coverage: 'delta', observed: 'complete', new: 1, carried: 1, repeated_premise: 1, repeated_premise_pairs: 1, unkeyed: 0, prior: 'none' },
      { run: 1, cycle: 'greptile', coverage: 'full', observed: 'complete', new: 0, carried: 1, unkeyed: 0, prior: 'none' },
      { run: 1, cycle: 3, coverage: 'full', observed: 'partial', new: 0, carried: 0, unkeyed: 0, prior: 'none' },
    ]);
    const correction = callCmd(dir, 'record correction', {
      correction_id: uid(1225), target: { pass_id: uid(1200), voice_id: 'core', attempt_id: uid(1201), finding_id: 'another' },
      adjudication: 'rejected', resolution: 'unknown',
    });
    expect(correction.json.reason).toBe('recorded');
    expect(show(dir).unresolved).not.toContain('another P1');
    expect(show(dir).finding_cycles).toEqual(beforeCorrection);
    const stopped = stop(dir);
    const full = render(dir, { output: 'full-receipt' });
    const comment = render(dir, { output: 'comment', full_receipt: { path: basename(full.file.path), sha256: full.file.sha256 } });
    const expectedLine = 'Finding cycle: run=1; cycle=2; coverage=delta; observed=complete; new=1; carried=1; repeated_premise=1; repeated_premise_pairs=1; unkeyed=0; prior=none';
    const digestLine = `Run state digest: run=${uid(1160)}; sha256=${sha256(stopped)}`;
    expect(full.text).toContain(expectedLine);
    expect(comment.text).toContain(expectedLine);
    expect(full.text).toContain(digestLine);
    expect(comment.text).not.toContain(digestLine);
    expect(comment.text.indexOf('Continuation:')).toBeLessThan(comment.text.indexOf('Finding cycle:'));
    expect(render(dir, { output: 'final' }).text).not.toContain('Finding cycle:');
  });

  // Value: protects=repeat concentration and class-specific identities; fails_when=distinct earlier pairs collapse or a changed class carries by key; why_new=102A A1/A3/D7; seam=show
  test('equal repeated-premise totals distinguish one previous pair from four', () => {
    const path = 'file.txt';
    const frozen = snapshot(Array.from({ length: 8 }, (_, i) => `distinct line ${i + 1}`).join('\n'));
    const classes = ['safety', 'concurrency', 'contract', 'validation'];
    for (const [index, mode] of ['concentrated', 'spread'].entries()) {
      const dir = newDir();
      expect(start(dir, 1451 + index).json.reason).toBe('recorded');
      const selectedClasses = mode === 'concentrated' ? classes.map(() => 'safety') : classes;
      report(dir, 1460, selectedClasses.map((tag, i) => finding(`before-${i}`, i + 1, tag, path)), frozen);
      const findings = selectedClasses.map((tag, i) => finding(`later-${i}`, i + 5, tag, path));
      findings.push(finding('class-reassigned', 1, 'correctness', path));
      report(dir, 1470, findings, frozen, { cycle: 2 });
      expect(show(dir).finding_cycles[1]).toMatchObject({
        carried: 0, new: 5, repeated_premise: 4, repeated_premise_pairs: mode === 'concentrated' ? 1 : 4,
      });
    }
  });

  // Value: protects=continuation provenance, idempotent start and advisory import bounds; fails_when=wrong same-head evidence imports, missing copies erase completeness, or show discloses prior entries; why_new=102A E4/E5; seam=start, show, render and export
  test('imports digest-bound evidence across two continuations and replays from the stored summary', () => {
    const first = newDir();
    const frozen = snapshot('old line\nnew line\n');
    expect(start(first, 1230).json.reason).toBe('recorded');
    report(first, 1240, [finding('first', 1)], frozen);
    const firstBytes = stop(first);

    const second = newDir();
    const prior = copyPrior(second, firstBytes);
    const startArgs = [
      'build', 'start', '--dir', second, '--run-id', uid(1250), '--base', baseSha, '--plan-ref', 'docs/plan.md',
      '--plan-sha256', sha256('plan-bytes'), '--policy-source', 'none supplied', '--prior-stops', '1',
      '--max-continuations', '3', '--continues', headSha, '--prior-state-file', prior.path, '--prior-state-sha256',
    ];
    const exact = [...startArgs, prior.sha256];
    const summary = { status: 'imported', reason: null, complete: true, entry_count: 1, source: { ...prior, run_id: uid(1230) } };
    expect(runCli(exact).json).toMatchObject({ reason: 'recorded', detail: { prior_findings: summary } });
    unlinkSync(join(second, priorFile));
    expect(runCli(exact).json).toMatchObject({ reason: 'replayed', detail: { prior_findings: summary } });
    expect(runCli([...startArgs, sha256('different')]).json.reason).toBe('conflict');
    expect(show(second).continuation.prior_findings).toEqual(summary);

    report(second, 1260, [finding('second', 1), finding('third', 2)], frozen);
    const known = show(second).finding_cycles[0];
    expect(known).toEqual({
      run: 2, cycle: 1, coverage: 'full', observed: 'complete', new: 1, carried: 1,
      repeated_premise: 1, repeated_premise_pairs: 1, unkeyed: 0, prior: 'imported',
    });
    const secondBytes = stop(second, 2);
    const secondExport = exportRun(second);
    const sid = secondExport.segments[0]!.session_id;
    expect(secondExport.records.find(({ op }) => op === 'finding-cycles')?.request.cycles).toEqual([known]);
    const metrics = runMetrics();
    expect(metrics.derive(second)).toMatchObject({ status: 'ok', data: { sessions: [{ session_id: sid, failed: 0 }] } });
    expect(metrics.read(sid)).toMatchObject({ status: 'ok', data: { capture: 'ok', finding_cycles: [known] } });
    for (const records of [JSON.stringify(secondExport.records), metrics.ledger(sid)]) {
      expect(records).not.toContain('file.txt');
      expect(records).not.toContain('"path"');
    }

    const third = newDir();
    expect(imports(third, 1270, secondBytes, 2).json).toMatchObject({ reason: 'recorded', detail: { prior_findings: { complete: true, entry_count: 2, source: { run_id: uid(1250) } } } });
    report(third, 1280, [finding('fourth', 1)], frozen);
    expect(show(third).finding_cycles[0]).toMatchObject({ run: 3, cycle: 1, new: 0, carried: 1 });
    const priorEntries = readState(third).continuation.prior_findings;
    expect(priorEntries).toMatchObject({ entries: expect.arrayContaining([{ run: 1, cycle: 1, key: expect.any(String), finding_class: 'correctness', path: 'file.txt' }, { run: 2, cycle: 1, key: expect.any(String), finding_class: 'correctness', path: 'file.txt' }]) });
    const exportWithIdentity = exportRun(third);
    expect(exportWithIdentity.records.find(({ request }) => request.state === 'attempt')?.request).toMatchObject({
      v: 4, findings: [{ finding_key: expect.stringMatching(/^fk1:[0-9a-f]{16}$/), finding_class: 'correctness' }],
    });
    expect(exportWithIdentity.records.find(({ op }) => op === 'finding-cycles')?.request.cycles).toMatchObject([
      { new: 0, carried: 1, unkeyed: 0, prior: 'imported' },
    ]);
    const legacy = readState(third);
    Reflect.deleteProperty(legacy.continuation, 'prior_findings');
    Reflect.deleteProperty(legacy.continuation, 'prior_state');
    for (const item of legacy.passes[0]!.voices[0]!.attempts[0]!.findings!) {
      Reflect.deleteProperty(item, 'identity');
      Reflect.deleteProperty(item, 'finding_class');
    }
    writeFileSync(join(third, stateFile), JSON.stringify(legacy));
    const legacyShow = show(third);
    expect(legacyShow).toMatchObject({ finding_prior: 'unavailable', finding_prior_reason: 'not-recorded' });
    expect(legacyShow.finding_cycles[0]).toMatchObject({ unkeyed: 1, prior: 'unavailable:not-recorded' });
    expect(validateStoredState(legacy).ok).toBe(true);
    const legacyExport = exportRun(third);
    expect(legacyExport.records.find(({ request }) => request.state === 'attempt')?.request).toMatchObject({
      v: 4, findings: [{ finding_key: null, finding_class: null }],
    });
    expect(legacyExport.records.find(({ op }) => op === 'finding-cycles')?.request.cycles).toMatchObject([
      { unkeyed: 1, prior: 'unavailable:not-recorded' },
    ]);

    const missing = newDir();
    expect(start(missing, 1290, { continuation: continued() }).json.reason).toBe('recorded');
    report(missing, 1300, [finding('second', 1), finding('third', 2)], frozen);
    const uncertain = show(missing).finding_cycles[0];
    expect(uncertain).toMatchObject({ run: 2, cycle: 1, prior: 'unavailable:not-supplied' });
    expect(uncertain.carried).toBeLessThan(known.carried);
    expect(uncertain.new).toBeGreaterThan(known.new);
    const missingBytes = stop(missing, 2);
    const afterMissing = newDir();
    expect(imports(afterMissing, 1310, missingBytes, 2).json).toMatchObject({ detail: { prior_findings: { status: 'imported', complete: false } } });
    report(afterMissing, 1320, [], frozen);
    expect(show(afterMissing).finding_cycles[0]).toMatchObject({ prior: 'partial', observed: 'complete', new: 0, carried: 0, unkeyed: 0 });

    const wrongSameHead = newDir();
    const wrongPrior = copyPrior(wrongSameHead, secondBytes);
    const wrong = start(wrongSameHead, 1330, { continuation: continued(), prior_state: { ...wrongPrior, sha256: prior.sha256 } });
    expect(wrong.json).toMatchObject({ reason: 'recorded', detail: { prior_findings: { status: 'unavailable', reason: 'digest-mismatch' } } });
    expect(wrong.err).toContain('WARNING PRIOR_IMPORT_UNAVAILABLE');
  });

  // Value: protects=precise advisory errors and legacy stop compatibility; fails_when=bad or unrelated copy blocks start, reserved names are read as input, or undigested/legacy evidence is called complete; why_new=102A E4/E6; seam=start
  test('prior imports report unavailable reasons and preserve legacy uncertainty', () => {
    const source = newDir();
    expect(start(source, 1340, { continuation: continued() }).json.reason).toBe('recorded');
    const open = readFileSync(join(source, stateFile));
    const stopped = stop(source, 2);
    const legacy = readState(source);
    Reflect.deleteProperty(legacy.continuation, 'prior_findings');
    Reflect.deleteProperty(legacy.continuation, 'prior_state');
    const stoppedState = JSON.parse(stopped.toString('utf8'));
    const badCases = [
      ['corrupt', Buffer.from('invalid JSON')],
      ['newer-schema', Buffer.from(JSON.stringify({ ...stoppedState, schema: 'review-run-state/v100' }))],
      ['not-stopped', open],
      ['head-mismatch', Buffer.from(JSON.stringify({ ...stoppedState, finish: { ...stoppedState.finish, head: baseSha } }))],
      ['binding-mismatch', Buffer.from(JSON.stringify({ ...stoppedState, run: { ...stoppedState.run, branch: 'different' } }))],
      ['unusable-file', Buffer.from([0xff])],
    ] as const;
    for (const [offset, [reason, bytes]] of badCases.entries()) {
      const dest = newDir();
      const result = imports(dest, 1350 + offset, bytes);
      expect(result.json).toMatchObject({ reason: 'recorded', detail: { prior_findings: { status: 'unavailable', reason } } });
      expect(result.err).toMatch(new RegExp(`WARNING PRIOR_IMPORT_UNAVAILABLE: .*: ${reason}; fix: .+`));
      expect(show(dest)).toMatchObject({ finding_prior: 'unavailable', finding_prior_reason: reason });
    }
    for (const [offset, path] of [stateFile, 'review-run-state.json.lock', '../outside.json', 'missing.json', 'link.json'].entries()) {
      const dest = newDir();
      if (path === 'link.json') {
        copyPrior(dest, stopped);
        symlinkSync(priorFile, join(dest, path));
      }
      const result = start(dest, 1360 + offset, { continuation: continued(), prior_state: { path, sha256: sha256(stopped) } });
      expect(result.json).toMatchObject({ reason: 'recorded', detail: { prior_findings: { status: 'unavailable', reason: 'unusable-file' } } });
      expect(result.err).toContain('WARNING PRIOR_IMPORT_UNAVAILABLE');
    }
    const legacyDest = newDir();
    expect(imports(legacyDest, 1370, Buffer.from(JSON.stringify(legacy)), 2).json.detail.prior_findings)
      .toMatchObject({ status: 'imported', complete: false, entry_count: 0 });
    report(legacyDest, 1380, []);
    expect(show(legacyDest).finding_cycles[0]).toMatchObject({ prior: 'partial', new: 0, carried: 0, unkeyed: 0 });

    const initial = newDir();
    const initialResult = start(initial, 1390, { prior_state: copyPrior(initial, stopped) });
    expect(initialResult.json.reason).toBe('recorded');
    expect(initialResult.err).toBe('');
    expect(show(initial).finding_prior).toBe('none');
    report(initial, 1400, [finding('keyed', 1)], headSha);
    const noDigest = newDir();
    copyPrior(noDigest, stop(initial));
    const legacyReceipt = start(noDigest, 1410, { continuation: continued(), prior_state: { path: priorFile, sha256: null } });
    expect(legacyReceipt.json.detail.prior_findings).toMatchObject({ status: 'imported', complete: false, entry_count: 1 });
    const malformedDigest = newDir();
    copyPrior(malformedDigest, stopped);
    const malformedReceipt = start(malformedDigest, 1411, {
      continuation: continued(), prior_state: { path: priorFile, sha256: 'incomplete-digest' },
    });
    expect(malformedReceipt.json.detail.prior_findings?.reason).toBe('digest-mismatch');
    expect(malformedReceipt.err).toContain(`--prior-state-file ${priorFile}: digest-mismatch`);
  });

  // Value: protects=selected keyless legacy stops import as partial; fails_when=import calls their history complete;
  // why_new=the empty legacy continuation exercises a different partial-history rule; seam=none; no_claim=receipt discovery.
  test('imports a legacy initial stop with a selected keyless finding as partial', () => {
    const source = newDir();
    expect(start(source, 1412).json.reason).toBe('recorded');
    report(source, 1413, [finding('legacy-finding')]);
    stop(source);
    const legacy = readState(source);
    Reflect.deleteProperty(legacy.continuation, 'prior_state');
    Reflect.deleteProperty(legacy.continuation, 'prior_findings');
    const selected = legacy.passes[0]!.voices[0]!.attempts[0]!.findings![0]!;
    Reflect.deleteProperty(selected, 'finding_class');
    Reflect.deleteProperty(selected, 'identity');

    const continuation = newDir();
    const result = imports(continuation, 1415, Buffer.from(JSON.stringify(legacy)));
    expect(result.json.detail.prior_findings).toMatchObject({ status: 'imported', complete: false, entry_count: 0 });
    report(continuation, 1416, []);
    expect(show(continuation).finding_cycles[0]).toMatchObject({ prior: 'partial', unkeyed: 0 });
  });

  // Value: protects=4 MiB input and bounded prior summaries; fails_when=large inputs are refused below the byte limit or either entry cap drops all history, marks it complete, or retains oldest entries instead of newest; why_new=102A E4; seam=store import and show
  test('prior import caps keep newest entries and a near-limit state still loads', () => {
    const seed = newDir();
    expect(start(seed, 1420).json.reason).toBe('recorded');
    report(seed, 1430, [finding('first', 1)], headSha);
    stop(seed);
    const source = readState(seed);
    const selected = source.passes[0]!.voices[0]!.attempts[0]!;
    const template = selected.findings![0]!;
    const key = (index: number) => `fk1:${index.toString(16).padStart(16, '0')}`;
    const fileLimit = 4 * 1024 * 1024;
    for (const [offset, [path, count]] of ([['file.txt', 2001], ['f'.repeat(490), 1250]] as const).entries()) {
      selected.findings = Array.from({ length: count }, (_, i) => ({
        ...template, finding_id: `finding-${i}`, identity: { key: key(i), path },
      }));
      const serialized = Buffer.from(JSON.stringify(source));
      const padded = Buffer.concat([serialized, Buffer.alloc(fileLimit - serialized.length, 0x20)]);
      const dest = newDir();
      const result = imports(dest, 1440 + offset, padded);
      expect(result.json).toMatchObject({ reason: 'recorded', detail: { prior_findings: { status: 'imported', complete: false } } });
      const imported = readState(dest).continuation.prior_findings;
      if (imported?.status !== 'imported') throw new Error('prior import unavailable');
      const { entries } = imported;
      expect(entries).toHaveLength(result.json.detail.prior_findings.entry_count);
      if (offset === 0) expect(entries).toHaveLength(2000);
      expect(entries.length).toBeLessThan(count);
      expect(entries.some((entry) => entry.key === key(count - 1))).toBe(true);
      expect(entries.find((entry) => entry.key === key(0))).toBeUndefined();
      expect(Buffer.byteLength(JSON.stringify(entries))).toBeLessThanOrEqual(512 * 1024);
      expect(show(dest).continuation.prior_findings).not.toHaveProperty('entries');
    }
    const oversized = newDir();
    expect(imports(oversized, 1450, Buffer.alloc(fileLimit + 1, 0x20)).json)
      .toMatchObject({ reason: 'recorded', detail: { prior_findings: { status: 'unavailable', reason: 'unusable-file' } } });
  });
});
