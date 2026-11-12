import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { main } from '../src/review-state/cli.ts';
import { EXPORT_SCHEMA, NAMESPACE, projectState, uuidv5 } from '../src/review-state/export.ts';
import { executeRender, RENDER_SCHEMA, RENDER_SHAPES } from '../src/review-state/render.ts';
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
    expect(att20.request.v).toBe(2);
    expect(att20.request.findings[0]).not.toHaveProperty('receipt_class');
    const att21 = exp.records.find((r: any) => r.op === 'pass' && r.request.attempt_id === uid(21));
    expect(att21.request.v).toBe(3);
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
    writeFileSync( statePath, '{corrupt\n');
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
});
