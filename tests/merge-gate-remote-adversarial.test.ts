import { afterAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../src/merge-gate/cli.ts';
import { parseManifest } from '../src/merge-gate/deps.ts';
import { assertArgvAllowed, buildChildEnv } from '../src/merge-gate/exec.ts';
import { GH_FIELDS } from '../src/merge-gate/registry.ts';
import { identityMatches, parsePrUrl, parseRemote, repoSpecFromRemote, stripRemoteUrl } from '../src/merge-gate/redact.ts';
import { makeBaseTmp } from './helpers/fixture-repo.ts';

const fixtureUser = 'user';
const fixturePassword = 'synthetic';

const cases = [
  { remote: 'ssh://git@ghe.corp.example:2222/o/r.git', host: 'ghe.corp.example', api: 'ghe.corp.example', spec: 'ghe.corp.example/o/r' },
  { remote: 'ssh://git@ghe.corp.example:2222/o/r.git/', host: 'ghe.corp.example', api: 'ghe.corp.example', spec: 'ghe.corp.example/o/r' },
  { remote: 'ssh://git@github.com:443/o/r.git', host: 'github.com', api: 'github.com', spec: 'o/r' },
  { remote: `https://${fixtureUser}:${fixturePassword}@github.com/o/r.git/?query=1#fragment`, host: 'github.com', api: 'github.com', spec: 'o/r' },
  { remote: 'git@github.com:o/r.git/', host: 'github.com', api: 'github.com', spec: 'o/r' },
  { remote: 'github.com:o/r.git', host: 'github.com', api: 'github.com', spec: 'o/r' },
  { remote: 'github-work:o/r.git', host: 'github-work', api: 'github.com', spec: 'o/r' },
  { remote: 'github-work:o/r.git/', host: 'github-work', api: 'github.com', spec: 'o/r' },
  { remote: 'ssh://github-work:2222/o/r.git', host: 'github-work', api: 'github.com', spec: 'o/r' },
] as const;

for (const { remote, host, api, spec } of cases) {
  test(`remote identity and gh repository spec: ${remote}`, () => {
    const identity = parseRemote(remote);
    expect(identity).toEqual({ host, owner: 'o', name: 'r' });
    const pr = parsePrUrl(`https://${api}/o/r/pull/7`);
    expect(pr).not.toBeNull();
    expect(identityMatches(identity!, pr!)).toBe(true);
    expect(repoSpecFromRemote(identity!)).toBe(spec);
    expect(() => assertArgvAllowed('gh', ['pr', 'view', '7', '-R', spec, '--json', GH_FIELDS])).not.toThrow();
  });
}

test('SSH port normalization preserves the dotted-host and owner/name guard', () => {
  const remote = parseRemote('ssh://git@ghe.corp.example:2222/o/r.git')!;
  expect(identityMatches(remote, parsePrUrl('https://github.com/o/r/pull/7')!)).toBe(false);
  expect(identityMatches(remote, parsePrUrl('https://ghe.corp.example/other/r/pull/7')!)).toBe(false);
  expect(identityMatches(remote, parsePrUrl('https://ghe.corp.example/o/other/pull/7')!)).toBe(false);
  expect(identityMatches(remote, parsePrUrl('https://ghe.corp.example/O/R/pull/7')!)).toBe(true);
});

test('a userless SSH alias still requires matching owner/name', () => {
  const remote = parseRemote('github-work:o/r.git')!;
  expect(identityMatches(remote, parsePrUrl('https://github.com/other/r/pull/7')!)).toBe(false);
  expect(identityMatches(remote, parsePrUrl('https://github.com/o/other/pull/7')!)).toBe(false);
  expect(identityMatches(remote, parsePrUrl('https://evil.example/o/r/pull/7')!)).toBe(false);
  expect(identityMatches(remote, parsePrUrl('https://github.com/o/r/pull/7')!)).toBe(true);
});

test('dotted transport aliases are not silently mapped to a different API hostname', () => {
  const remote = parseRemote('ssh://git@ssh.github.com:443/o/r.git')!;
  expect(remote.host).toBe('ssh.github.com');
  expect(repoSpecFromRemote(remote)).toBe('ssh.github.com/o/r');
  expect(identityMatches(remote, parsePrUrl('https://github.com/o/r/pull/7')!)).toBe(false);
});

test('HTTP ports remain explicit and local paths do not become remote identities', () => {
  expect(parseRemote('https://ghe.corp.example:8443/o/r.git')?.host).toBe('ghe.corp.example:8443');
  for (const remote of ['/tmp/o/r.git', '../o/r.git', './o/r.git', 'file:///tmp/o/r.git', 'o/r.git', './dir:with-colon/o/r.git']) {
    expect(parseRemote(remote)).toBeNull();
  }
});

test('transport::address remotes strip credentials and local paths from the address', () => {
  const creds = `${fixtureUser}:${fixturePassword}@`;
  expect(stripRemoteUrl(`hg::https://${creds}hg.example.com/o/r`)).toBe('hg::https://hg.example.com/o/r');
  expect(stripRemoteUrl(`https::https://${creds}github.com/o/r.git`)).toBe('https::https://github.com/o/r.git');
  expect(stripRemoteUrl('gcrypt::/home/someone/backup.git')).toBe('gcrypt::local:backup.git');
});

test('requirement names keep no URL credentials', () => {
  const creds = `${fixtureUser}:${fixturePassword}@`;
  const head = `https://${creds}packages.example.com/pkg-1.0.whl\n-e git+https://${creds}github.com/o/lib.git#egg=lib\n`;
  expect(parseManifest('requirements', '', head).added).toEqual([
    { name: '-e git+https://github.com/o/lib.git#egg=lib', classification: 'remote' },
    { name: 'https://packages.example.com/pkg-1.0.whl', classification: 'remote' },
  ]);
  const secret = 'access_token=synthetic';
  const queried = `https://packages.example.com/pkg-1.0.whl?${secret}\n`;
  expect(parseManifest('requirements', '', queried).added).toEqual([
    { name: 'https://packages.example.com/pkg-1.0.whl', classification: 'remote' },
  ]);
});

test('an owner or repository named pull still parses as a pull request URL', () => {
  expect(parsePrUrl('https://github.com/o/pull/pull/5')).toEqual({ host: 'github.com', owner: 'o', name: 'pull', number: 5 });
  expect(parsePrUrl('https://github.com/pull/r/pull/5')).toEqual({ host: 'github.com', owner: 'pull', name: 'r', number: 5 });
  expect(parsePrUrl('https://github.com/o/pull/5')).toBeNull();
});

test('forced color and TTY settings do not reach git or gh', () => {
  const env = buildChildEnv({ PATH: '/bin', CLICOLOR_FORCE: '1', GH_FORCE_TTY: '1' });
  expect(env.CLICOLOR_FORCE).toBeUndefined();
  expect(env.GH_FORCE_TTY).toBeUndefined();
  expect(env.PATH).toBe('/bin');
});

const baseTmp = makeBaseTmp('merge-gate-port-');
const GIT = Bun.which('git') ?? '/usr/bin/git';
afterAll(() => rmSync(baseTmp, { recursive: true, force: true }));

function fixture(remote: string) {
  const tmp = (prefix: string) => mkdtempSync(join(baseTmp, prefix));
  const repo = tmp('repo-');
  const shim = tmp('path-');
  const env = {
    ...process.env, HOME: tmp('home-'), GSTACK_EXTEND_STATE_DIR: tmp('state-'),
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', PATH: `${shim}:${process.env.PATH ?? ''}`,
  };
  const git = (args: string[]) => {
    const result = spawnSync(GIT, ['-C', repo, ...args], { env, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  git(['init', '--quiet', '--initial-branch=main']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'user.email', 'test@example.invalid']);
  git(['remote', 'add', 'origin', remote]);
  for (const content of ['base\n', 'base\nhead\n']) {
    writeFileSync(join(repo, 'a.txt'), content);
    git(['add', '-A']);
    git(['commit', '--quiet', '-m', 'fixture']);
  }
  const response = {
    number: 7, url: 'https://github.com/o/r/pull/7', state: 'OPEN', isDraft: false,
    mergeable: 'MERGEABLE', reviewDecision: 'APPROVED', statusCheckRollup: [],
    headRefOid: git(['rev-parse', 'HEAD']), baseRefOid: git(['rev-parse', 'HEAD~1']),
  };
  const log = join(shim, 'gh-called.json');
  const executable = join(shim, 'gh');
  writeFileSync(executable, `#!${process.execPath}\n
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));
process.stdout.write(${JSON.stringify(JSON.stringify(response))});
`);
  chmodSync(executable, 0o755);
  return { repo, env, log };
}

async function run(f: ReturnType<typeof fixture>, args: string[]) {
  let stdout = '';
  let stderr = '';
  const status = await main(['check', ...args, '--json'], {
    cwd: f.repo, env: f.env, now: () => new Date('2020-01-01T00:00:00.000Z'),
    stdout: s => { stdout += s; }, stderr: s => { stderr += s; },
  });
  expect(stderr).toBe('');
  return { status, body: JSON.parse(stdout) };
}

for (const [label, remote, target, code, status] of [
  ['PR URL', 'https://github.com/o/r.git', 'https://github.com:8443/o/r/pull/7', 'usage', 2],
  ['HTTPS remote', 'https://github.com:8443/o/r.git', '7', 'no_remote', 1],
  ['HTTP remote', 'http://github.com:8080/o/r.git', '7', 'no_remote', 1],
] as const) {
  test(`non-default port in ${label} is rejected before gh`, async () => {
    const f = fixture(remote);
    if (label === 'PR URL') {
      // A cache lookup would fail store validation instead of returning usage.
      const store = join(f.env.GSTACK_EXTEND_STATE_DIR, 'merge-gate');
      mkdirSync(store);
      chmodSync(store, 0o755);
    }
    const args = ['--pr', target, ...(label === 'PR URL' ? ['--decision-id', 'port-test'] : [])];
    const result = await run(f, args);
    expect(result.status).toBe(status);
    expect(result.body.error.code).toBe(code);
    expect(result.body.error.message).toContain('ports are unsupported');
    expect(result.body.error.fix).toContain('SSH remote');
    expect(existsSync(f.log)).toBe(false);
  });
}

for (const [label, remote, target, repoSpec] of [
  ['default HTTPS PR URL', 'https://github.com/o/r.git', 'https://github.com:443/o/r/pull/7', 'github.com/o/r'],
  ['default HTTPS remote', 'https://github.com:443/o/r.git', '7', 'o/r'],
  ['default HTTP remote', 'http://github.com:80/o/r.git', '7', 'o/r'],
  ['SSH transport port', 'ssh://git@github.com:2222/o/r.git', '7', 'o/r'],
] as const) {
  test(`${label} reaches gh with the expected API identity`, async () => {
    const f = fixture(remote);
    const result = await run(f, ['--pr', target, '--no-record']);
    expect(result.status).toBe(0);
    expect(result.body.would_merge).toBe(true);
    const args = JSON.parse(readFileSync(f.log, 'utf8')) as string[];
    expect(args[args.indexOf('-R') + 1]).toBe(repoSpec);
  });
}
