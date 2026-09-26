import { afterAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../src/merge-gate/cli.ts';
import { sha256Hex } from '../src/merge-gate/canon.ts';
import { assertArgvAllowed } from '../src/merge-gate/exec.ts';
import { makeBaseTmp } from './helpers/fixture-repo.ts';

const root = makeBaseTmp('merge-gate-plan-contract-');
const realGit = Bun.which('git') ?? '/usr/bin/git';
let serial = 0;
afterAll(() => rmSync(root, { recursive: true, force: true }));

function fixture() {
  const dir = join(root, String(serial++));
  const repo = join(dir, 'repo');
  const state = join(dir, 'state');
  const path = join(dir, 'path');
  for (const p of [repo, state, path]) mkdirSync(p, { recursive: true });
  const env = {
    ...process.env, HOME: dir, XDG_CONFIG_HOME: dir, GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null', GSTACK_EXTEND_STATE_DIR: state,
    GSTACK_EXTEND_MERGE_GATE_TEST: '1', GSTACK_EXTEND_MERGE_GATE_NOW: '2020-01-02T00:00:00Z',
    GSTACK_EXTEND_MERGE_GATE_RETRY_MS: '0',
    GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z',
  };
  const git = (args: string[]) => {
    const result = spawnSync(realGit, ['-C', repo, ...args], { env, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout;
  };
  git(['init', '--quiet', '--initial-branch=main']);
  git(['config', 'user.name', 'Fixture']);
  git(['config', 'user.email', 'fixture@example.invalid']);
  writeFileSync(join(repo, 'package.json'), '{}\n');
  git(['add', 'package.json']);
  git(['commit', '--quiet', '-m', 'base']);
  writeFileSync(join(repo, 'package.json'), '{"dependencies":{"new-package":"1"}}\n');
  git(['add', 'package.json']);
  git(['commit', '--quiet', '-m', 'head']);
  const calls = join(dir, 'calls.jsonl');
  writeFileSync(join(path, 'git'), `#!${process.execPath}\n` + [
    "import { appendFileSync } from 'node:fs';",
    "import { spawnSync } from 'node:child_process';",
    'const args = process.argv.slice(2);',
    `appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n');`,
    "if (process.env.MERGE_GATE_FAIL_BATCH === '1' && args.includes('--batch')) { process.stderr.write('fatal: synthetic missing manifest blob\\n'); process.exit(128); }",
    `const result = spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit' });`,
    'process.exit(result.status ?? 1);',
  ].join('\n'), { mode: 0o755 });
  const invoke = async (args: string[], extra: Record<string, string> = {}) => {
    let stdout = '';
    let stderr = '';
    const status = await main(args, {
      cwd: repo, env: { ...env, PATH: path, ...extra },
      stdout: s => { stdout += s; }, stderr: s => { stderr += s; },
    });
    return { status, stdout, stderr };
  };
  return { repo, state, path, calls, git, invoke };
}

test('ENG-7: failed manifest collection stays incomplete when stored evidence is replayed', async () => {
  const f = fixture();
  const checked = await f.invoke(['check', '--base', 'HEAD~1', '--json'], { MERGE_GATE_FAIL_BATCH: '1' });
  expect(checked.status, checked.stderr).toBe(0);
  const verdict = JSON.parse(checked.stdout);
  const evidence = JSON.parse(readFileSync(verdict.evidence_path, 'utf8'));
  expect(evidence.collection.complete).toBe(false);
  expect(evidence.collection.failures).toContainEqual({ stage: 'manifest', code: 'git_failed', subjects: ['package.json'] });
  expect(evidence.dependencies.manifests[0].unverifiable).toBe(true);
  expect(verdict.evidence_complete).toBe(false);
  const beforeCalls = readFileSync(f.calls, 'utf8');
  const log = join(f.state, 'merge-gate/verdicts.jsonl');
  const beforeLog = readFileSync(log);
  const replay = await f.invoke(['replay', '--evidence', verdict.evidence_id, '--json']);
  expect(replay.status, replay.stderr).toBe(0);
  const replayed = JSON.parse(replay.stdout);
  expect(replayed).toMatchObject({ replay: true, would_merge: false, evidence_complete: false, evidence_id: verdict.evidence_id });
  expect(replayed.reasons.some((r: { code: string; blocking: boolean }) => r.code === 'evidence_incomplete' && r.blocking)).toBe(true);
  expect(readFileSync(f.calls, 'utf8')).toBe(beforeCalls);
  expect(readFileSync(log)).toEqual(beforeLog);
});

function treeBytes(dir: string, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of readdirSync(dir).sort()) {
    if (prefix === '' && name === '.git') continue;
    const full = join(dir, name);
    const rel = prefix + name;
    const st = lstatSync(full);
    if (st.isSymbolicLink()) out[rel] = { mode: st.mode, target: readlinkSync(full) };
    else if (st.isDirectory()) Object.assign(out, treeBytes(full, rel + '/'));
    else out[rel] = { mode: st.mode, sha256: sha256Hex(readFileSync(full)) };
  }
  return out;
}

test('no-merge proof: Git and PR checks and replay preserve refs, HEAD, index and all working-tree bytes', async () => {
  const f = fixture();
  f.git(['remote', 'add', 'origin', 'https://github.com/acme/widgets.git']);
  const pr = {
    number: 7, url: 'https://github.com/acme/widgets/pull/7', state: 'OPEN',
    isDraft: false, mergeable: 'MERGEABLE', reviewDecision: 'APPROVED',
    mergeStateStatus: 'CLEAN', statusCheckRollup: [], baseRefName: 'main',
    baseRefOid: f.git(['rev-parse', 'HEAD~1']).trim(),
    headRefOid: f.git(['rev-parse', 'HEAD']).trim(),
  };
  writeFileSync(join(f.path, 'gh'), `#!${process.execPath}\n` + [
    "import { appendFileSync } from 'node:fs';",
    `appendFileSync(${JSON.stringify(f.calls + '.gh')}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
    `process.stdout.write(${JSON.stringify(JSON.stringify(pr))});`,
  ].join('\n'), { mode: 0o755 });
  writeFileSync(join(f.repo, 'package.json'), '{"dirty":true}\n');
  writeFileSync(join(f.repo, 'untracked.bin'), Buffer.from([0, 1, 255, 10]));
  symlinkSync('package.json', join(f.repo, 'untracked-link'));
  const snapshot = () => ({
    refs: f.git(['for-each-ref', '--format=%(refname) %(objectname)']),
    head: readFileSync(join(f.repo, '.git/HEAD')),
    index: readFileSync(join(f.repo, '.git/index')),
    config: readFileSync(join(f.repo, '.git/config')),
    files: treeBytes(f.repo),
  });
  const before = snapshot();
  const checked = await f.invoke(['check', '--base', 'HEAD~1', '--json']);
  expect(checked.status, checked.stderr).toBe(0);
  expect(snapshot()).toEqual(before);
  const verdict = JSON.parse(checked.stdout);
  for (let attempt = 0; attempt < 2; attempt++) {
    const prCheck = await f.invoke(['check', '--pr', '7', '--decision-id', 'proof', '--json']);
    expect(prCheck.status, prCheck.stderr).toBe(0);
    expect(snapshot()).toEqual(before);
  }
  const ghCalls = readFileSync(f.calls + '.gh', 'utf8').trim().split('\n');
  expect(ghCalls).toHaveLength(1);
  for (const line of ghCalls) expect(() => assertArgvAllowed('gh', JSON.parse(line))).not.toThrow();
  const calls = readFileSync(f.calls, 'utf8');
  for (const line of calls.trim().split('\n')) expect(() => assertArgvAllowed('git', JSON.parse(line))).not.toThrow();
  for (const args of [
    ['replay', '--evidence', verdict.evidence_id, '--json'],
    ['replay', '--all', '--jsonl'],
  ]) {
    const replay = await f.invoke(args);
    expect(replay.status, replay.stderr).toBe(0);
    expect(snapshot()).toEqual(before);
    expect(readFileSync(f.calls, 'utf8')).toBe(calls);
  }
});
