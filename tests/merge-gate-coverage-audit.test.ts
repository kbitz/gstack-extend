import { afterAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../src/merge-gate/cli.ts';
import { decide, type Evidence } from '../src/merge-gate/decide.ts';
import { parseManifest } from '../src/merge-gate/deps.ts';
import type { FileFact } from '../src/merge-gate/diff.ts';
import { DEFAULT_POLICY, OUTPUT_CAPS, type Policy } from '../src/merge-gate/registry.ts';
import { makeBaseTmp } from './helpers/fixture-repo.ts';

const root = makeBaseTmp('merge-gate-coverage-');
const realGit = Bun.which('git') ?? '/usr/bin/git';
let serial = 0;
afterAll(() => rmSync(root, { recursive: true, force: true }));

function slot(): string {
  const dir = join(root, String(serial++));
  mkdirSync(dir);
  return dir;
}

function gitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: root,
    XDG_CONFIG_HOME: root,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z',
    ...extra,
  };
}

function git(repo: string, args: string[], env: NodeJS.ProcessEnv = gitEnv()): string {
  const result = spawnSync(realGit, ['-C', repo, ...args], { env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
}

function initRepo(): string {
  const repo = join(slot(), 'repo');
  mkdirSync(repo);
  git(repo, ['init', '--quiet', '--initial-branch=main']);
  git(repo, ['config', 'user.name', 'Test']);
  git(repo, ['config', 'user.email', 'test@example.invalid']);
  return repo;
}

function commit(repo: string, files: Record<string, string | null>, message = 'change'): void {
  for (const [path, body] of Object.entries(files)) {
    const full = join(repo, path);
    if (body === null) rmSync(full);
    else {
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, body);
    }
  }
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '-m', message]);
}

function versionShim(version: string, configLine?: string): string {
  const dir = join(slot(), 'path');
  mkdirSync(dir);
  const script = [
    '#!/bin/sh',
    `if [ "$1" = version ]; then echo 'git version ${version}'; exit 0; fi`,
    configLine === undefined
      ? ''
      : `for a in "$@"; do if [ "$a" = --get-regexp ]; then printf '%s\\n' ${JSON.stringify(configLine)}; exit 0; fi; done`,
    `exec '${realGit}' "$@"`,
  ].filter(line => line !== '').join('\n');
  writeFileSync(join(dir, 'git'), script, { mode: 0o755 });
  return dir;
}

async function run(args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; stdin?: string } = {}) {
  let stdout = '';
  let stderr = '';
  const status = await main(args, {
    cwd: opts.cwd ?? root,
    env: opts.env ?? gitEnv(),
    stdout: s => { stdout += s; },
    stderr: s => { stderr += s; },
    ...(opts.stdin !== undefined ? { readStdin: () => opts.stdin ?? '' } : {}),
  });
  return { status, stdout, stderr, body: stdout.trim() === '' ? null : JSON.parse(stdout) as Record<string, any> };
}

test('an empty commit blocks with the no-files empty_diff detail', async () => {
  const repo = initRepo();
  commit(repo, { 'a.txt': 'a\n' }, 'base');
  git(repo, ['commit', '--quiet', '--allow-empty', '-m', 'empty']);
  const result = await run(['check', '--base', 'HEAD~1', '--json', '--no-record'], { cwd: repo });
  expect(result.status, result.stderr).toBe(0);
  const reason = result.body.reasons.find((r: { code: string }) => r.code === 'empty_diff');
  expect(reason).toMatchObject({ blocking: true, detail: 'the diff contains no changed files' });
  expect(result.body.would_merge).toBe(false);
});

test('a shallow clone with no merge base says to unshallow', async () => {
  const origin = initRepo();
  commit(origin, { 'a.txt': 'a\n' }, 'base');
  const shallow = join(slot(), 'shallow');
  const cloned = spawnSync(realGit, ['clone', '--quiet', '--no-local', '--depth', '1', origin, shallow], { env: gitEnv(), encoding: 'utf8' });
  expect(cloned.status, cloned.stderr).toBe(0);
  git(shallow, ['config', 'user.name', 'Test']);
  git(shallow, ['config', 'user.email', 'test@example.invalid']);
  git(shallow, ['checkout', '--quiet', '--orphan', 'side']);
  commit(shallow, { 'b.txt': 'b\n' }, 'side');
  const result = await run(['check', '--base', 'main', '--head', 'side', '--json', '--no-record'], { cwd: shallow });
  expect(result.status).toBe(1);
  expect(result.body.error).toMatchObject({ code: 'no_merge_base', fix: 'git fetch --unshallow' });
});

test('git version edges: unparseable text, a newer major, and partial-clone false values', async () => {
  const repo = initRepo();
  commit(repo, { 'a.txt': 'a\n' }, 'base');
  commit(repo, { 'a.txt': 'a\nb\n' }, 'head');
  const check = async (path: string) => run(['check', '--base', 'HEAD~1', '--json', '--no-record'], {
    cwd: repo,
    env: gitEnv({ PATH: `${path}:${process.env.PATH ?? ''}` }),
  });

  const garbage = await check(versionShim('not-a-version'));
  expect(garbage.status).toBe(1);
  expect(garbage.body.error).toMatchObject({
    code: 'git_unsupported_version',
    message: 'could not parse git version: git version not-a-version',
  });

  const newer = await check(versionShim('3.0.0'));
  expect(newer.status, newer.stderr).toBe(0);
  expect(newer.body.would_merge).toBe(true);

  git(repo, ['remote', 'add', 'origin', 'https://github.com/acme/widgets.git']);
  for (const value of ['false', 'no', 'off', '0', 'FALSE', 'No', 'OFF']) {
    git(repo, ['config', 'remote.origin.promisor', value]);
    const ignored = await check(versionShim('2.44.0'));
    expect(ignored.status, `${value}: ${ignored.stderr}${ignored.stdout}`).toBe(0);
  }
  git(repo, ['config', '--unset-all', 'remote.origin.promisor']);
  for (const [key, value] of [['extensions.partialClone', 'true'], ['remote.origin.partialclonefilter', 'blob:none']] as const) {
    git(repo, ['config', key, value]);
    const blocked = await check(versionShim('2.44.0'));
    expect(blocked.status, `${key}: ${blocked.stderr}${blocked.stdout}`).toBe(1);
    expect(blocked.body.error.message).toContain('partial clone');
    git(repo, ['config', '--unset-all', key]);
  }

  const bare = await check(versionShim('2.44.0', 'remote.origin.promisor'));
  expect(bare.status).toBe(1);
  expect(bare.body.error.message).toContain('below 2.45 (partial clone)');
});

test('usage covers unknown commands, mixed modes, policy shape, and bad test overrides', async () => {
  const unknown = await run(['nope', '--json']);
  expect(unknown.status).toBe(2);
  expect(unknown.body.error.message).toBe("unknown command 'nope'");
  const blank = await run([]);
  expect(blank.status).toBe(2);
  expect(blank.stderr).toContain("ERROR usage: unknown command ''");

  const mixed = await run(['check', '--pr', '1', '--base', 'main', '--json']);
  expect(mixed.status).toBe(2);
  expect(mixed.body.error.message).toBe('--pr cannot be combined with --base or --head');
  const timeout = await run(['check', '--base', 'HEAD', '--timeout', '0', '--json']);
  expect(timeout.body.error.message).toBe("--timeout: '0' is not a positive integer");

  const policyDir = slot();
  const writePolicy = (name: string, text: string) => {
    const path = join(policyDir, name);
    writeFileSync(path, text);
    return path;
  };
  const policy = async (text: string) => run(
    ['check', '--base', 'HEAD', '--json', '--no-record', '--policy', writePolicy(`${serial}.json`, text)],
  );
  expect((await policy('[]')).body.error.message).toContain('is not a JSON object');
  expect((await policy('null')).body.error.message).toContain('is not a JSON object');
  expect((await policy('{"max_net_lines":1.5}')).body.error.message).toBe("--policy: '1.5' is not a non-negative integer or null");
  expect((await policy('{"exclude":"vendor/**"}')).body.error.message).toBe('--policy: exclude must be an array of globs');

  const guarded = (extra: Record<string, string>) => run(['check', '--base', 'HEAD', '--json', '--no-record'], {
    env: gitEnv({ GSTACK_EXTEND_MERGE_GATE_TEST: '1', ...extra }),
  });
  expect((await guarded({ GSTACK_EXTEND_MERGE_GATE_NOW: 'yesterday' })).body.error.message).toContain('is not a time');
  expect((await guarded({ GSTACK_EXTEND_MERGE_GATE_TIMEOUT_MS: '0' })).body.error.message).toBe('GSTACK_EXTEND_MERGE_GATE_TIMEOUT_MS is not a positive number');
  expect((await guarded({ GSTACK_EXTEND_MERGE_GATE_RETRY_MS: '-1' })).body.error.message).toBe('GSTACK_EXTEND_MERGE_GATE_RETRY_MS is not a non-negative number');
});

test('removed dependencies are stored and not counted; optionalDependencies are', async () => {
  const moved = parseManifest(
    'package.json',
    '{"dependencies":{"old":"1"},"optionalDependencies":{"opt":"1"}}',
    '{"optionalDependencies":{"opt":"1","extra":"2"}}',
  );
  expect(moved.added).toEqual([{ name: 'extra', classification: 'remote' }]);
  expect(moved.removed).toEqual([{ name: 'old', classification: 'remote' }]);

  const repo = initRepo();
  commit(repo, { 'package.json': '{"dependencies":{"left-pad":"1.0.0","stay":"1.0.0"}}\n' }, 'base');
  commit(repo, { 'package.json': '{"dependencies":{"stay":"1.0.0"}}\n' }, 'head');
  const state = join(slot(), 'state');
  const result = await run(['check', '--base', 'HEAD~1', '--json'], {
    cwd: repo,
    env: gitEnv({ GSTACK_EXTEND_STATE_DIR: state }),
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.body.metrics.new_deps).toBe(0);
  expect(result.body.would_merge).toBe(true);
  const evidence = JSON.parse(readFileSync(result.body.evidence_path, 'utf8'));
  expect(evidence.dependencies.manifests[0].removed).toEqual([{ name: 'left-pad', classification: 'remote' }]);
  expect(evidence.dependencies.manifests[0].added).toEqual([]);
});

test('a rename from a non-manifest counts every dependency as new', async () => {
  const repo = initRepo();
  commit(repo, { 'notes.json': '{"dependencies":{"kept":"1"}}\n' }, 'base');
  git(repo, ['mv', 'notes.json', 'package.json']);
  git(repo, ['commit', '--quiet', '-m', 'rename']);
  expect(git(repo, ['diff', '--raw', '--find-renames', 'HEAD~1', 'HEAD'])).toMatch(/ R\d+\tnotes\.json\tpackage\.json/);
  const result = await run(['check', '--base', 'HEAD~1', '--json', '--no-record'], { cwd: repo });
  expect(result.status, result.stderr).toBe(0);
  expect(result.body.metrics.new_deps).toBe(1);
  expect(result.body.reasons.find((r: { code: string }) => r.code === 'new_deps_over_budget').subjects).toEqual(['package.json:kept']);
});

test('reason subjects, check names, and unmeasured API files keep a capped list and a full count', () => {
  const sha = (ch: string) => ch.repeat(40);
  const file = (path: string, over: Partial<FileFact> = {}): FileFact => ({
    path,
    old_path: null,
    old_mode: '100644',
    new_mode: '100644',
    old_oid: sha('c'),
    new_oid: sha('d'),
    status: 'A',
    additions: 1,
    deletions: 0,
    binary: false,
    submodule: false,
    ...over,
  });
  const evidence = (files: FileFact[], pr: Evidence['pr'] = null): Evidence => ({
    v: 1,
    observed_at: '2020-01-01T00:00:00.000Z',
    collection_started_at: '2020-01-01T00:00:00.000Z',
    clock_overridden: false,
    test_overrides: [],
    collector_version: 1,
    gstack_extend_version: '0',
    git_version: 'git version 2.54.0',
    partial_clone: false,
    attr_source: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
    rename_limit: 10000,
    rename_detection_skipped: false,
    decision_id: null,
    repo: { origin: null },
    git: { base_sha: sha('a'), head_sha: sha('b'), merge_base_sha: sha('a'), files },
    dependencies: { manifests: [] },
    public_api: { files: [] },
    collection: { complete: true, failures: [] },
    pr,
  });
  const judge = (e: Evidence, policy: Policy = { ...DEFAULT_POLICY, exclude: [] }) =>
    decide(e, policy, new Date('2020-01-01T00:00:00.000Z'), { evidenceId: 'e'.repeat(64), replay: false, gstackVersion: '0' });

  const many = judge(
    evidence(Array.from({ length: OUTPUT_CAPS.subjects + 1 }, (_, i) => file(`n${String(i).padStart(2, '0')}.txt`))),
    { ...DEFAULT_POLICY, exclude: [], max_new_files: 0 },
  );
  const filesReason = many.reasons.find(r => r.code === 'new_files_over_budget');
  expect(filesReason?.subjects).toHaveLength(OUTPUT_CAPS.subjects);
  expect(filesReason?.subjects_count).toBe(OUTPUT_CAPS.subjects + 1);

  const rollup = Array.from({ length: OUTPUT_CAPS.detail_names + 1 }, (_, i) => ({
    name: `c${String(i).padStart(2, '0')}`,
    status: 'COMPLETED',
    conclusion: 'FAILURE',
  }));
  const checks = judge(evidence([file('a.txt', { status: 'M' })], {
    number: 7,
    url: 'https://github.com/acme/widgets/pull/7',
    repo: { host: 'github.com', owner: 'acme', name: 'widgets' },
    raw: { state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', reviewDecision: 'APPROVED', statusCheckRollup: rollup },
    raw_first: null,
    retry_wait_ms: null,
  }));
  const failing = checks.reasons.find(r => r.code === 'checks_failing');
  expect(failing?.detail).toBe(`failing checks: ${rollup.slice(0, OUTPUT_CAPS.detail_names).map(c => c.name).join(', ')}`);
  expect(failing?.subjects).toHaveLength(OUTPUT_CAPS.subjects);
  expect(failing?.subjects_count).toBe(OUTPUT_CAPS.detail_names + 1);

  const unmeasured = judge(evidence(Array.from({ length: OUTPUT_CAPS.unmeasured_api + 1 }, (_, i) => file(`s${i}.sh`, { status: 'M' }))));
  expect(unmeasured.metrics.unmeasured_api_files).toHaveLength(OUTPUT_CAPS.unmeasured_api);
  expect(unmeasured.metrics.unmeasured_api_count).toBe(OUTPUT_CAPS.unmeasured_api + 1);
  expect(unmeasured.metrics.coverage.new_public_api).toBe('partial');
});

test('a changed API file omitted from the patch is unmeasured as patch_missing', async () => {
  const repo = initRepo();
  commit(repo, { 'a.ts': 'export const A = 1;\n' }, 'base');
  commit(repo, { 'a.ts': 'export const A = 1;\nexport const B = 2;\n' }, 'head');
  const path = join(slot(), 'path');
  mkdirSync(path);
  writeFileSync(join(path, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = -U0 ] && exit 0; done\nexec '${realGit}' "$@"\n`, { mode: 0o755 });
  const result = await run(['check', '--base', 'HEAD~1', '--json', '--no-record'], {
    cwd: repo,
    env: gitEnv({ PATH: `${path}:${process.env.PATH ?? ''}` }),
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.body.metrics.unmeasured_api_files).toEqual([{ path: 'a.ts', reason: 'patch_missing' }]);
  expect(result.body.metrics.new_public_api).toBe(0);
  expect(result.body.would_merge).toBe(true);
});

test('a thrown non-Error is internal_error and multiline TOML specs fail closed', async () => {
  let stdout = '';
  let stderr = '';
  const status = await main(['--version', '--json'], {
    stdout: s => { stdout += s; },
    stderr: s => { stderr += s; },
    fail() { throw 'boom'; },
  });
  expect(status).toBe(1);
  expect(stderr).toBe('boom\n');
  expect(JSON.parse(stdout).error).toMatchObject({ code: 'internal_error', message: 'boom' });
  for (const head of ['[dependencies]\nserde = """\n1.0\n"""\n', "[dependencies]\nserde = '''\n1.0\n'''\n"]) {
    expect(parseManifest('cargo', null, head).unverifiable).toContain('outside the collector v1 grammar');
  }
});

test('enterprise gh auth names the remote host, and a quoted refspec keeps an apostrophe', async () => {
  const repo = initRepo();
  commit(repo, { 'a.txt': 'a\n' }, 'base');
  commit(repo, { 'a.txt': 'a\nb\n' }, 'head');
  git(repo, ['remote', 'add', 'origin', 'https://ghe.corp.example/acme/widgets.git']);
  const path = join(slot(), 'path');
  mkdirSync(path);
  writeFileSync(join(path, 'gh'), '#!/bin/sh\necho "not logged in" >&2\nexit 4\n', { mode: 0o755 });
  const auth = await run(['check', '--pr', '7', '--json', '--no-record'], {
    cwd: repo,
    env: gitEnv({ PATH: `${path}:${process.env.PATH ?? ''}` }),
  });
  expect(auth.status).toBe(1);
  expect(auth.body.error).toMatchObject({
    code: 'gh_auth',
    fix: 'gh auth status -h ghe.corp.example; gh auth login -h ghe.corp.example',
  });

  const head = git(repo, ['rev-parse', 'HEAD']).trim();
  const missing = 'e'.repeat(40);
  const response = JSON.stringify({
    number: 7,
    url: 'https://ghe.corp.example/acme/widgets/pull/7',
    state: 'OPEN',
    headRefOid: head,
    baseRefOid: missing,
    baseRefName: "rel'ease",
  });
  writeFileSync(join(path, 'gh'), `#!/bin/sh\nprintf '%s' ${JSON.stringify(response)}\n`, { mode: 0o755 });
  chmodSync(join(path, 'gh'), 0o755);
  const quoted = await run(['check', '--pr', '7', '--json', '--no-record'], {
    cwd: repo,
    env: gitEnv({ PATH: `${path}:${process.env.PATH ?? ''}` }),
  });
  expect(quoted.status).toBe(1);
  expect(quoted.body.error).toMatchObject({
    code: 'commit_not_local',
    message: 'missing local commit for the pull request base',
    fix: "git fetch origin 'rel'\\''ease'",
  });
});
