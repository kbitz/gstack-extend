import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { main } from '../src/review-state/cli.ts';
import { ADDITIVE_V1_DEFAULTS, applyCommand, REASON_TABLE, serializeState, STATE_KEYS, validateStoredState, type ReviewRunState } from '../src/review-state/state.ts';
import { readHelperVersion } from '../src/review-state/store.ts';
import { GIT_ENV, makeBaseTmp, makeEmptyRepo } from './helpers/fixture-repo.ts';

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
  if (json) {
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
      ['record pass', () => ({ pass_id: uid(10), state: 'completed', completed_at: '2026-11-10T18:00:00Z' }), 'completed_at', 'state'],
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
    expect(launcher).toContain('exec bun --no-env-file --no-install --config=/dev/null');
    const design = readFileSync(DESIGN_PATH, 'utf8');
    const anchors = [...design.matchAll(/<a id="reason-([a-z-]+)"><\/a>/g)].map((m) => m[1]);
    expect(anchors).toEqual(REASON_TABLE.map((r) => r.reason));

    const empty = newDir();
    const h = runCli(['--help'], { cwd: empty });
    expect(h.code).toBe(0);
    expect(h.out).toContain('Experimental until Track 79A');
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
    expect(Object.keys(parsed)).toEqual(['schema', 'rev', 'writer', 'run', 'binding', 'plan', 'policy', 'continuation', 'segments', 'passes', 'corrections', 'gates', 'audits', 'checkpoints', 'finish']);
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
      if (mode === 'lock-tmp') writeFileSync(join(d, 'review-run-state.json.tmp-999-abcd'), '{"partial":');
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
      expect(callCmd(d, 'record pass', mkPassStarted(10)).json).toMatchObject({ reason: 'recorded', rev: 2 });
    }
  });

  test('concurrent writers serialize under lock without losing records or corrupting state', async () => {
    const d = newDir();
    callCmd(d, 'start', mkStart(1));
    const p1 = writeJson(d, 'p1.json', mkPassStarted(10));
    const p2 = writeJson(d, 'p2.json', mkPassStarted(11, { cycle: 2 }));
    const p1Conflict = writeJson(d, 'p1-conflict.json', mkPassStarted(10, { cycle: 9 }));

    const spawnHelper = (inputFile: string) =>
      new Promise<{ code: number; json: Record<string, unknown> }>((resolvePromise) => {
        let out = '';
        const child = spawn(BIN_PATH, ['record', 'pass', '--dir', d, '--input', inputFile], {
          cwd: repo,
          env: { ...process.env, GSTACK_EXTEND_REVIEW_STATE_LOCK_WAIT_MS: '10000' },
        });
        child.stdout.on('data', (chunk) => { out += String(chunk); });
        child.on('close', (code) => resolvePromise({ code: code ?? 1, json: JSON.parse(out.trim()) }));
      });

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
    for (const coll of ['passes', 'corrections', 'gates', 'audits', 'checkpoints'] as const) {
      for (const rec of v086State[coll]) delete rec.segment;
    }
    writeFileSync(statePath, `${JSON.stringify(v086State, null, 2)}\n`);

    // Replay against v0.86.0 state works cleanly without conflict
    expect(callCmd(d, 'start', mkStart(1)).json.reason).toBe('replayed');
    expect(callCmd(d, 'record pass', mkPassStarted(10)).json.reason).toBe('replayed');
    expect(callCmd(d, 'record gate', { gate_id: uid(40), name: 'tests', result: 'passed', candidate: { commit: headSha } }).json.reason).toBe('replayed');

    // Next write stamps root writer, preserves null segment on pre-existing records, and stamps segment=1 on new record
    const nextCp = callCmd(d, 'checkpoint', { checkpoint_id: uid(61), kind: 'stop' });
    expect(nextCp.json.reason).toBe('recorded');
    const upgraded = JSON.parse(readFileSync(statePath, 'utf8')) as ReviewRunState;
    expect(upgraded.writer).toBe(readHelperVersion());
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
        : ['busy', 'unwritable'].includes(entry.reason) ? 'same-input'
        : ['worktree-mismatch', 'finished', 'exists', 'corrupt', 'newer-schema'].includes(entry.reason) ? 'never'
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
});
