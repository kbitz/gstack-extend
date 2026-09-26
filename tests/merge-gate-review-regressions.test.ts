import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { main } from '../src/merge-gate/cli.ts';
import { collect, type CollectInput } from '../src/merge-gate/collect.ts';
import { decide, type Verdict } from '../src/merge-gate/decide.ts';
import { parseManifest } from '../src/merge-gate/deps.ts';
import { COLLECTOR_VERSION, DEFAULT_POLICY, EVIDENCE_V } from '../src/merge-gate/registry.ts';
import { makeBaseTmp } from './helpers/fixture-repo.ts';

const baseTmp = makeBaseTmp('merge-gate-review-');
const GIT = Bun.which('git') ?? '/usr/bin/git';
const BUN = process.execPath;
const NOW = '2020-01-01T00:00:00.000Z';
const VERSION = readFileSync(join(import.meta.dir, '..', 'VERSION'), 'utf8').trim();
let env: NodeJS.ProcessEnv = {};

beforeEach(() => {
  env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', HOME: tmp('home-'), GSTACK_EXTEND_STATE_DIR: tmp('state-') };
});

afterAll(() => rmSync(baseTmp, { recursive: true, force: true }));

function tmp(prefix: string): string {
  return mkdtempSync(join(baseTmp, prefix));
}

function git(repo: string, args: string[]): string {
  const result = spawnSync(GIT, ['-C', repo, ...args], { env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function changeRepo(path = 'a.txt', before = 'a\n', after = 'a\nb\n'): string {
  const repo = tmp('repo-');
  git(repo, ['init', '--quiet', '--initial-branch=main']);
  git(repo, ['config', 'user.name', 'Test']);
  git(repo, ['config', 'user.email', 'test@example.invalid']);
  for (const [message, content] of [['base', before], ['head', after]]) {
    writeFileSync(join(repo, path), content ?? '');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '--quiet', '-m', message ?? 'change']);
  }
  return repo;
}

function input(repo: string): CollectInput {
  return {
    cwd: repo, env, mode: 'git', baseRef: 'HEAD~1', headRef: 'HEAD',
    remote: 'origin', decisionId: null, gitTimeoutMs: 5000, ghTimeoutMs: 5000,
    retryMs: 0, now: () => new Date(NOW), clockOverridden: false,
    testOverrides: [], debug: false,
  };
}

function writeExec(path: string, body: string): void {
  writeFileSync(path, `#!${BUN}\n${body}`);
  chmodSync(path, 0o755);
}

function commitFiles(repo: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '-m', 'fixture change']);
}

function budgetRepo(): string {
  const repo = changeRepo();
  commitFiles(repo, {
    'generated/bundle.ts': `export const Generated = 1;\n${'// generated\n'.repeat(501)}`,
    'generated/package.json': '{"dependencies":{"foo":"1"}}\n',
  });
  return repo;
}

type JsonOutput = Verdict & { evidence_path: string; error?: { code: string; message: string } };

async function runJson(args: string[], repo: string, state = tmp('state-'), extraEnv: NodeJS.ProcessEnv = {}) {
  let stdout = '';
  let stderr = '';
  const status = await main([...args, '--json'], {
    cwd: repo,
    env: { ...env, ...extraEnv, HOME: tmp('home-'), GSTACK_EXTEND_STATE_DIR: state },
    now: () => new Date(NOW),
    stdout: s => { stdout += s; },
    stderr: s => { stderr += s; },
  });
  return { status, body: JSON.parse(stdout) as JsonOutput, stderr, state };
}

describe('merge-gate review regressions', () => {
  for (const retry of [false, true]) {
    test(`PR observed_at precedes local collection (${retry ? 'retry' : 'single response'})`, () => {
      const repo = changeRepo();
      git(repo, ['remote', 'add', 'origin', 'https://github.com/acme/widgets.git']);
      const shim = tmp('path-');
      const ghCount = join(shim, 'gh-count');
      const diffStarted = join(shim, 'diff-started');
      const response = {
        number: 7, url: 'https://github.com/acme/widgets/pull/7', state: 'OPEN',
        isDraft: false, mergeable: 'MERGEABLE', reviewDecision: 'APPROVED',
        statusCheckRollup: [], baseRefOid: git(repo, ['rev-parse', 'HEAD~1']),
        headRefOid: git(repo, ['rev-parse', 'HEAD']),
      };
      const responses = retry ? [{ ...response, mergeable: 'UNKNOWN' }, response] : [response];
      writeExec(join(shim, 'gh'), `
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const path = ${JSON.stringify(ghCount)};
const count = existsSync(path) ? Number(readFileSync(path, 'utf8')) : 0;
writeFileSync(path, String(count + 1));
process.stdout.write(JSON.stringify(${JSON.stringify(responses)}[count]));
`);
      writeExec(join(shim, 'git'), `
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
if (args.includes('--raw')) writeFileSync(${JSON.stringify(diffStarted)}, '1');
const result = spawnSync(${JSON.stringify(GIT)}, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
`);
      const observed = retry ? '2020-01-01T00:00:20.000Z' : '2020-01-01T00:00:10.000Z';
      const result = collect({
        ...input(repo), mode: 'pr', prNumber: '7',
        env: { ...env, PATH: `${shim}:${process.env.PATH ?? ''}` },
        now: () => {
          if (existsSync(diffStarted)) return new Date('2020-01-01T00:01:00.000Z');
          if (existsSync(ghCount)) return new Date(Number(readFileSync(ghCount, 'utf8')) === 2 ? '2020-01-01T00:00:20.000Z' : '2020-01-01T00:00:10.000Z');
          return new Date(NOW);
        },
      });
      expect(result.evidence.collection_started_at).toBe(NOW);
      expect(result.evidence).toMatchObject({ v: EVIDENCE_V, collector_version: COLLECTOR_VERSION, gstack_extend_version: VERSION });
      expect(result.evidence.observed_at).toBe(observed);
      expect(result.evidence.pr?.raw_first === null).toBe(!retry);
      expect(existsSync(diffStarted)).toBe(true);
    });
  }

  const local = '{ path = "../foo", platform = "darwin" }';
  const remote = '{ version = "^1.0", source = "pypi", platform = "linux" }';
  for (const [name, alternatives, classification] of [
    ['local then remote', [local, remote], 'remote'],
    ['remote then local', [remote, local], 'remote'],
    ['only local', [local], 'local'],
    ['only remote', [remote], 'remote'],
  ] as const) {
    test(`Poetry alternatives: ${name}`, () => {
      const before = '[tool.poetry.dependencies]\n';
      const after = `${before}foo = [${alternatives.join(', ')}]\n`;
      expect(parseManifest('pyproject', before, after)).toEqual({
        added: [{ name: 'foo', classification }], removed: [], unverifiable: null,
      });
      const { evidence } = collect(input(changeRepo('pyproject.toml', before, after)));
      const verdict = decide(evidence, DEFAULT_POLICY, new Date(NOW), {
        evidenceId: 'a'.repeat(64), replay: false, gstackVersion: 'test',
      });
      expect(verdict.metrics.new_deps).toBe(classification === 'remote' ? 1 : 0);
      expect(verdict.would_merge).toBe(classification === 'local');
    });
  }

  for (const unreadable of [false, true]) {
    test(`linked-worktree info/attributes keeps a logical subject (${unreadable ? 'unreadable' : 'effective'})`, () => {
      const repo = changeRepo();
      const worktree = join(tmp('linked-'), 'worktree');
      git(repo, ['worktree', 'add', '--quiet', '--detach', worktree, 'HEAD']);
      const attributes = join(repo, '.git/info/attributes');
      if (unreadable) mkdirSync(attributes);
      else writeFileSync(attributes, '*.txt -diff\n');
      const result = collect(input(worktree));
      expect(result.evidence.collection.failures).toContainEqual({
        stage: 'attributes', code: 'info_attributes', subjects: ['.git/info/attributes'],
      });
      expect(result.canonical).not.toContain(repo);
      expect(result.canonical).not.toContain(worktree);
    });
  }
});

describe('merge-gate explicit plan contracts', () => {
  test('replay applies or removes exclusions over the same recorded evidence (DX-2)', async () => {
    const repo = budgetRepo();
    const recorded = await runJson(['check', '--base', 'HEAD~1', '--exclude', 'generated/**'], repo);
    expect(recorded.status).toBe(0);
    expect(recorded.body.would_merge).toBe(true);
    const replayArgs = ['replay', '--evidence', recorded.body.evidence_id];
    const included = await runJson(replayArgs, repo, recorded.state);
    const excluded = await runJson([...replayArgs, '--exclude', 'generated/**'], repo, recorded.state);
    expect([included.status, excluded.status]).toEqual([0, 0]);
    expect(included.body.evidence_id).toBe(excluded.body.evidence_id);
    expect(included.body.would_merge).toBe(false);
    expect(included.body.metrics).toMatchObject({ net_lines: 503, churn: 503, new_files: 2, new_deps: 1, new_public_api: 1 });
    expect(excluded.body.metrics).toMatchObject({ net_lines: 0, churn: 0, new_files: 0, new_deps: 0, new_public_api: 0 });
    expect(excluded.body.metrics.excluded).toEqual([
      { path: 'generated/bundle.ts', reason: 'user_glob' },
      { path: 'generated/package.json', reason: 'user_glob' },
    ]);
    expect(excluded.body.policy_sha256).toBe(recorded.body.policy_sha256);
    expect(included.body.policy_sha256).not.toBe(recorded.body.policy_sha256);
    expect(excluded.body.would_merge).toBe(true);
  });

  for (const [dimension, reason, measured] of [
    ['max_net_lines', 'net_lines_over_budget', 503],
    ['max_new_files', 'new_files_over_budget', 2],
    ['max_new_deps', 'new_deps_over_budget', 1],
    ['max_new_public_api', 'new_public_api_over_budget', 1],
    ['max_churn', 'churn_over_budget', 503],
  ] as const) {
    test(`none disables ${dimension} after it blocks (DX-3)`, async () => {
      const repo = budgetRepo();
      const policy = join(tmp('policy-'), 'policy.json');
      writeFileSync(policy, JSON.stringify({ [dimension]: 0 }));
      const args = ['check', '--base', 'HEAD~1', '--no-record', '--policy', policy];
      const blocked = await runJson(args, repo);
      const disabled = await runJson([...args, `--${dimension.replaceAll('_', '-')}`, 'none'], repo);
      expect([blocked.status, disabled.status]).toEqual([0, 0]);
      expect(blocked.body.reasons.filter(r => r.blocking).map(r => r.code)).toEqual([reason]);
      expect(blocked.body.reasons.find(r => r.code === reason)).toMatchObject({ measured, limit: 0 });
      expect(blocked.body.would_merge).toBe(false);
      expect(disabled.body.policy[dimension]).toBeNull();
      expect(disabled.body.would_merge).toBe(true);
    });
  }

  test('a tree object is rejected as either base or head (CEO-S14)', async () => {
    const repo = changeRepo();
    const tree = git(repo, ['rev-parse', 'HEAD^{tree}']);
    for (const refs of [['--base', tree], ['--base', 'HEAD~1', '--head', tree]]) {
      const result = await runJson(['check', ...refs, '--no-record'], repo);
      expect(result.status).toBe(1);
      expect(result.body.error?.code).toBe('ref_not_found');
      expect(result.body.error?.message).toContain(tree);
    }
  });

  test('unexpected raw diff status records evidence_incomplete (ENG-16)', async () => {
    const repo = changeRepo();
    const shim = tmp('path-');
    const raw = `:100644 100644 ${'a'.repeat(40)} ${'b'.repeat(40)} X\0a.txt\0` + '1\t0\ta.txt\0';
    writeExec(join(shim, 'git'), `
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
if (args.includes('--raw')) {
  process.stdout.write(${JSON.stringify(raw)});
  process.exit(0);
}
const result = spawnSync(${JSON.stringify(GIT)}, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
`);
    const result = await runJson(['check', '--base', 'HEAD~1'], repo, tmp('state-'), { PATH: `${shim}:${process.env.PATH ?? ''}` });
    expect(result.status).toBe(0);
    expect(result.body.would_merge).toBe(false);
    expect(result.body.reasons.filter(r => r.blocking).map(r => r.code)).toEqual(['evidence_incomplete']);
    const stored = JSON.parse(readFileSync(result.body.evidence_path, 'utf8'));
    expect(stored.collection).toEqual({ complete: false, failures: [{ stage: 'diff', code: 'bad_status', subjects: ['a.txt'] }] });
  });

  test('excluded entries are capped but their total remains exact (ENG-16)', async () => {
    const repo = changeRepo();
    commitFiles(repo, Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`excluded/${String(i).padStart(3, '0')}.txt`, 'x\n'])));
    const result = await runJson(['check', '--base', 'HEAD~1', '--exclude', 'excluded/**', '--no-record'], repo);
    expect(result.status).toBe(0);
    expect(result.body.would_merge).toBe(true);
    expect(result.body.metrics.excluded).toHaveLength(100);
    expect(result.body.metrics.excluded_count).toBe(101);
    expect(result.body.metrics.excluded.at(-1)).toEqual({ path: 'excluded/099.txt', reason: 'user_glob' });
    expect(result.body.metrics).toMatchObject({ net_lines: 0, churn: 0, new_files: 0 });
  });

  test('symlinked verdict log is refused without changing its target (ENG-16)', async () => {
    const repo = changeRepo();
    const state = tmp('state-');
    const store = join(state, 'merge-gate');
    mkdirSync(store, { mode: 0o700 });
    const target = join(tmp('outside-'), 'log.jsonl');
    writeFileSync(target, 'untouched\n');
    symlinkSync(target, join(store, 'verdicts.jsonl'));
    const result = await runJson(['check', '--base', 'HEAD~1'], repo, state);
    expect(result.status).toBe(1);
    expect(result.body.error?.code).toBe('store_refused');
    expect(readFileSync(target, 'utf8')).toBe('untouched\n');
  });

  test('replay refuses a symlinked evidence file by id or path (ENG-16)', async () => {
    const repo = changeRepo();
    const recorded = await runJson(['check', '--base', 'HEAD~1'], repo);
    expect(recorded.status).toBe(0);
    const path = recorded.body.evidence_path;
    const target = join(tmp('outside-'), 'evidence.json');
    writeFileSync(target, readFileSync(path));
    rmSync(path);
    symlinkSync(target, path);
    for (const evidence of [recorded.body.evidence_id, path]) {
      const result = await runJson(['replay', '--evidence', evidence], repo, recorded.state);
      expect(result.status).toBe(1);
      expect(result.body.error?.code).toBe('store_refused');
    }
  });

  test('a real gitlink is excluded from every metric', async () => {
    const repo = changeRepo();
    const commit = git(repo, ['rev-parse', 'HEAD']);
    git(repo, ['update-index', '--add', '--cacheinfo', `160000,${commit},vendor`]);
    git(repo, ['commit', '--quiet', '-m', 'add gitlink']);
    const result = await runJson(['check', '--base', 'HEAD~1'], repo);
    expect(result.status).toBe(0);
    expect(result.body.would_merge).toBe(true);
    expect(result.body.metrics).toMatchObject({ net_lines: 0, churn: 0, new_files: 0, new_deps: 0, new_public_api: 0, excluded: [{ path: 'vendor', reason: 'submodule' }] });
    const stored = JSON.parse(readFileSync(result.body.evidence_path, 'utf8'));
    expect(stored.git.files[0]).toMatchObject({ status: 'A', new_mode: '160000', submodule: true });
  });

  test('a regular file changed to a symlink records raw status T', () => {
    const repo = changeRepo();
    rmSync(join(repo, 'a.txt'));
    symlinkSync('target.txt', join(repo, 'a.txt'));
    git(repo, ['add', 'a.txt']);
    git(repo, ['commit', '--quiet', '-m', 'change file type']);
    const result = collect(input(repo));
    expect(result.evidence.collection).toEqual({ complete: true, failures: [] });
    expect(result.evidence.git.files).toHaveLength(1);
    expect(result.evidence.git.files[0]).toMatchObject({ path: 'a.txt', status: 'T', old_mode: '100644', new_mode: '120000', submodule: false });
  });

  test('hostile external and submodule diff config cannot alter facts or execute', () => {
    const repo = changeRepo('api.ts', 'export const A = 1;\n', 'export const A = 2;\n');
    const oldCommit = git(repo, ['rev-parse', 'HEAD~1']);
    const newCommit = git(repo, ['rev-parse', 'HEAD']);
    git(repo, ['update-index', '--add', '--cacheinfo', `160000,${oldCommit},vendor`]);
    git(repo, ['commit', '--quiet', '-m', 'base gitlink']);
    writeFileSync(join(repo, 'api.ts'), 'export const B = 2;\n');
    git(repo, ['add', 'api.ts']);
    git(repo, ['update-index', '--cacheinfo', `160000,${newCommit},vendor`]);
    git(repo, ['commit', '--quiet', '-m', 'change API and gitlink']);
    const baseline = collect(input(repo));
    const dir = tmp('external-');
    const marker = join(dir, 'executed');
    const command = join(dir, 'external-diff');
    writeExec(command, `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'executed');\n`);
    git(repo, ['config', 'diff.external', command]);
    git(repo, ['config', 'diff.submodule', 'log']);
    expect(collect(input(repo)).canonical).toBe(baseline.canonical);
    expect(existsSync(marker)).toBe(false);
    expect(baseline.evidence.git.files.some(f => f.submodule)).toBe(true);
    expect(baseline.evidence.public_api.files).toHaveLength(1);
  });

  test('API collection chunks more than 1000 paths without losing facts (ENG-7)', () => {
    const repo = changeRepo();
    commitFiles(repo, Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`api${String(i).padStart(4, '0')}.ts`, `export const Export${i} = ${i};\n`])));
    const shim = tmp('path-');
    const calls = join(shim, 'patch-counts');
    writeExec(join(shim, 'git'), `
import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
if (args.includes('-U0')) appendFileSync(${JSON.stringify(calls)}, String(args.length - args.indexOf('--') - 1) + '\\n');
const result = spawnSync(${JSON.stringify(GIT)}, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
`);
    const result = collect({ ...input(repo), env: { ...env, PATH: `${shim}:${process.env.PATH ?? ''}` } });
    expect(readFileSync(calls, 'utf8').trim().split('\n').map(Number)).toEqual([1000, 1]);
    expect(result.evidence.collection).toEqual({ complete: true, failures: [] });
    expect(result.evidence.git.files).toHaveLength(1001);
    expect(result.evidence.public_api.files).toHaveLength(1001);
    expect(new Set(result.evidence.public_api.files.flatMap(f => f.added.map(p => p.name))).size).toBe(1001);
    expect(result.evidence.git.files.some(f => f.api_skipped)).toBe(false);
  });
});
