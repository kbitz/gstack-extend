import { afterAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../src/merge-gate/cli.ts';
import type { Evidence, Verdict } from '../src/merge-gate/decide.ts';
import { makeBaseTmp } from './helpers/fixture-repo.ts';

const baseTmp = makeBaseTmp('merge-gate-collection-adversarial-');
const GIT = Bun.which('git') ?? '/usr/bin/git';
const NOW = '2020-01-01T00:00:00.000Z';

afterAll(() => rmSync(baseTmp, { recursive: true, force: true }));

function tmp(prefix: string): string {
  return mkdtempSync(join(baseTmp, prefix));
}

function changeRepo(env: NodeJS.ProcessEnv): string {
  const repo = tmp('repo-');
  const git = (args: string[]) => {
    const result = spawnSync(GIT, ['-C', repo, ...args], { env, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
  };
  git(['init', '--quiet', '--initial-branch=main']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'user.email', 'test@example.invalid']);
  for (const [message, content] of [['base', 'export const A = 1;\n'], ['head', 'export const A = 1;\nexport const B = 2;\n']]) {
    writeFileSync(join(repo, 'a.ts'), content ?? '');
    git(['add', '-A']);
    git(['commit', '--quiet', '-m', message ?? 'change']);
  }
  return repo;
}

async function runJson(args: string[], cwd: string, env: NodeJS.ProcessEnv, expectedStatus = 0) {
  let stdout = '';
  let stderr = '';
  const status = await main([...args, '--json'], {
    cwd, env, now: () => new Date(NOW),
    stdout: s => { stdout += s; },
    stderr: s => { stderr += s; },
  });
  expect(status).toBe(expectedStatus);
  expect(stderr).toBe('');
  return JSON.parse(stdout) as Verdict & { evidence_path: string; error?: { code: string } };
}

for (const [label, warning, phase] of [
  ['current Git raw', 'warning: exhaustive rename detection was skipped due to too many files.\n', '--raw'],
  ['legacy Git raw', 'warning: inexact rename detection was skipped due to too many files.\n', '--raw'],
  ['current Git patch', 'warning: exhaustive rename detection was skipped due to too many files.\n', '-U0'],
  ['legacy Git patch', 'warning: inexact rename detection was skipped due to too many files.\n', '-U0'],
  ['unrelated warning', 'warning: a harmless diagnostic\n', '-U0'],
] as const) {
  test(`rename skip warning persists into evidence and replay: ${label}`, async () => {
    const env = {
      ...process.env, HOME: tmp('home-'), GSTACK_EXTEND_STATE_DIR: tmp('state-'),
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    };
    const repo = changeRepo(env);
    const shim = tmp('path-');
    const executable = join(shim, 'git');
    writeFileSync(executable, `#!${process.execPath}\n
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
if (args.includes(${JSON.stringify(phase)})) process.stderr.write(${JSON.stringify(warning)});
const result = spawnSync(${JSON.stringify(GIT)}, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
`);
    chmodSync(executable, 0o755);
    const recorded = await runJson(['check', '--base', 'HEAD~1'], repo, { ...env, PATH: `${shim}:${process.env.PATH ?? ''}` });
    const skipped = label !== 'unrelated warning';
    const evidence = JSON.parse(readFileSync(recorded.evidence_path, 'utf8')) as Evidence;
    expect(evidence.rename_detection_skipped).toBe(skipped);
    const logPath = join(env.GSTACK_EXTEND_STATE_DIR, 'merge-gate/verdicts.jsonl');
    const logBefore = readFileSync(logPath, 'utf8');
    const replayed = await runJson(['replay', '--evidence', recorded.evidence_id], repo, { ...env, PATH: tmp('empty-path-') });
    expect(replayed.evidence_id).toBe(recorded.evidence_id);
    expect(replayed.replay).toBe(true);
    expect(readFileSync(logPath, 'utf8')).toBe(logBefore);
    for (const verdict of [recorded, replayed]) {
      expect(verdict.evidence_complete).toBe(!skipped);
      expect(verdict.would_merge).toBe(!skipped);
      expect(verdict.reasons.some(r => r.code === 'rename_detection_incomplete' && r.blocking && r.class === 'evidence')).toBe(skipped);
    }
  });
}

for (const field of ['headRefOid', 'baseRefOid'] as const) {
  for (const value of ['main', 'not-a-sha']) {
    test(`malformed GitHub ${field} (${value}) returns gh_bad_json`, async () => {
      const env = {
        ...process.env, HOME: tmp('home-'), GSTACK_EXTEND_STATE_DIR: tmp('state-'),
        GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
      };
      const repo = changeRepo(env);
      const git = (args: string[]) => {
        const result = spawnSync(GIT, ['-C', repo, ...args], { env, encoding: 'utf8' });
        if (result.status !== 0) throw new Error(result.stderr);
        return result.stdout.trim();
      };
      git(['remote', 'add', 'origin', 'https://github.com/acme/widgets.git']);
      const response = {
        number: 7, url: 'https://github.com/acme/widgets/pull/7', state: 'OPEN',
        isDraft: false, mergeable: 'MERGEABLE', reviewDecision: 'APPROVED', statusCheckRollup: [],
        headRefOid: git(['rev-parse', 'HEAD']), baseRefOid: git(['rev-parse', 'HEAD~1']),
        [field]: value,
      };
      const shim = tmp('gh-path-');
      const executable = join(shim, 'gh');
      writeFileSync(executable, `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(JSON.stringify(response))});\n`);
      chmodSync(executable, 0o755);
      const result = await runJson(['check', '--pr', '7'], repo, { ...env, PATH: `${shim}:${process.env.PATH ?? ''}` }, 1);
      expect(result.error?.code).toBe('gh_bad_json');
    });
  }
}

test('long-line API blobs split below the patch output budget', async () => {
  const env = {
    ...process.env, HOME: tmp('home-'), GSTACK_EXTEND_STATE_DIR: tmp('state-'),
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  };
  const repo = changeRepo(env);
  const count = 70;
  const blob = `export const LongLine = '${'x'.repeat(999_950)}';\n`;
  expect(Buffer.byteLength(blob)).toBeLessThan(1024 * 1024);
  expect(Buffer.byteLength(blob) * count).toBeGreaterThan(64 * 1024 * 1024);
  for (let i = 0; i < count; i++) writeFileSync(join(repo, `long-${i}.ts`), blob);
  for (const args of [['add', '-A'], ['commit', '--quiet', '-m', 'long lines']]) {
    const result = spawnSync(GIT, ['-C', repo, ...args], { env, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
  }
  const shim = tmp('chunk-path-');
  const log = join(shim, 'patches.jsonl');
  const executable = join(shim, 'git');
  writeFileSync(executable, `#!${process.execPath}\n
import { appendFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
const result = spawnSync(${JSON.stringify(GIT)}, args, { maxBuffer: 128 * 1024 * 1024 });
if (args.includes('-U0')) appendFileSync(${JSON.stringify(log)}, JSON.stringify({ bytes: result.stdout.length, paths: args.slice(args.indexOf('--') + 1) }) + '\\n');
writeFileSync(1, result.stdout);
writeFileSync(2, result.stderr);
process.exit(result.status ?? 1);
`);
  chmodSync(executable, 0o755);
  const recorded = await runJson(['check', '--base', 'HEAD~1'], repo, { ...env, PATH: `${shim}:${process.env.PATH ?? ''}` });
  const patches = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { bytes: number; paths: string[] });
  expect(patches.length).toBeGreaterThan(1);
  expect(patches.every(patch => patch.bytes < 4_000_000)).toBe(true);
  expect(new Set(patches.flatMap(patch => patch.paths)).size).toBe(count);
  expect(recorded.evidence_complete).toBe(true);
  expect(recorded.metrics.new_public_api).toBe(count);
  expect(recorded.metrics.coverage.new_public_api).toBe('complete');
  const evidence = JSON.parse(readFileSync(recorded.evidence_path, 'utf8')) as Evidence;
  expect(evidence.collection.failures).toEqual([]);
  expect(evidence.public_api.files).toHaveLength(count);
}, 30_000);
