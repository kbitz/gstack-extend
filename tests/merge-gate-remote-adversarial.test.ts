import { expect, test } from 'bun:test';
import { assertArgvAllowed } from '../src/merge-gate/exec.ts';
import { GH_FIELDS } from '../src/merge-gate/registry.ts';
import { identityMatches, parsePrUrl, parseRemote, repoSpecFromRemote } from '../src/merge-gate/redact.ts';

const cases = [
  { remote: 'ssh://git@ghe.corp.example:2222/o/r.git', host: 'ghe.corp.example', api: 'ghe.corp.example', spec: 'ghe.corp.example/o/r' },
  { remote: 'ssh://git@ghe.corp.example:2222/o/r.git/', host: 'ghe.corp.example', api: 'ghe.corp.example', spec: 'ghe.corp.example/o/r' },
  { remote: 'ssh://git@github.com:443/o/r.git', host: 'github.com', api: 'github.com', spec: 'o/r' },
  { remote: 'https://user:synthetic@github.com/o/r.git/?query=1#fragment', host: 'github.com', api: 'github.com', spec: 'o/r' },
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
