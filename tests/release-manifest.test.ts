/**
 * release-manifest.test.ts — the release and manifest checks.
 *
 * A release commit changes VERSION, the CHANGELOG entry and package.json's
 * version field. Diff selection runs this suite (plus the two telemetry
 * suites, which validate VERSION's format) for such a commit instead of the
 * whole suite, so it pins what those three files must agree on:
 *
 *   - VERSION matches the format the auto-tag workflow accepts;
 *   - package.json's version is VERSION's MAJOR.MINOR.PATCH;
 *   - CHANGELOG.md's first release heading is VERSION, and the release-notes
 *     extractor the workflow runs finds a non-empty section for it.
 *
 * It is also the release ordering gate (CLAUDE.md#versioning): VERSION stays at
 * or above every merged release tag and above a changed base VERSION, never
 * padded-equals another tag, keeps three parts after a three-part top tag or
 * under the merge base's CLAUDE.md marker (the first such release being the
 * next MINOR with PATCH 0), and that marker stays exact. Those
 * checks read Git state no touchfile can select: fetched tags, full history and
 * origin/main (or origin/master).
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { makeBaseTmp, makeEmptyRepo } from './helpers/fixture-repo.ts';

const ROOT = join(import.meta.dir, '..');
const VERSION = readFileSync(join(ROOT, 'VERSION'), 'utf8').trim();

describe('release and manifest checks', () => {
  test('VERSION matches the format the auto-tag workflow accepts', () => {
    const workflow = readFileSync(join(ROOT, '.github/workflows/auto-tag.yml'), 'utf8');
    const pattern = /grep -qE '([^']+)'/.exec(workflow)?.[1];
    expect(pattern).toBeDefined();
    expect(new RegExp(pattern!).test(VERSION)).toBe(true);
  });

  test("package.json's version is VERSION's MAJOR.MINOR.PATCH", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version?: unknown };
    expect(manifest.version).toBe(VERSION.split('.').slice(0, 3).join('.'));
  });

  test("CHANGELOG.md's first release is VERSION and the extractor finds its notes", () => {
    const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
    const first = /^## \[([^\]]+)\] - \d{4}-\d{2}-\d{2}$/m.exec(changelog)?.[1];
    expect(first).toBe(VERSION);
    const notes = spawnSync('bash', [join(ROOT, 'scripts/extract-changelog-section.sh'), VERSION], { cwd: ROOT, encoding: 'utf8' });
    expect(notes.status).toBe(0);
    expect(notes.stdout.trim().length).toBeGreaterThan(0);
  });
});

// These guards are deliberately here: /ship-and-land and /docs-ship run this
// suite before landing. auto-tag only checks syntax and does not enforce order.
const FORMAT_MARKER = 'Release format: MAJOR.MINOR.PATCH (three-part; no suffixes).';
const RELEASE_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*))?$/;
const GUIDE = 'See CLAUDE.md#versioning.';
// Inherited GIT_DIR/GIT_WORK_TREE (as in git hooks) would aim fixture commands at another repository.
const GIT_ENV = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
function gitAt(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}
function compareRelease(a: string, b: string): number {
  const left = a.split('.').map(BigInt), right = b.split('.').map(BigInt);
  for (let i = 0; i < 4; i++) {
    if ((left[i] ?? 0n) > (right[i] ?? 0n)) return 1;
    if ((left[i] ?? 0n) < (right[i] ?? 0n)) return -1;
  }
  return 0;
}
function markerViolations(cwd: string, ref: string): string[] {
  const entry = gitAt(cwd, ['ls-tree', ref, '--', 'CLAUDE.md']);
  if (!entry) return [];
  if (!entry.startsWith('100644 ') && !entry.startsWith('100755 ')) {
    return [`RELEASE_POLICY_FILE: ${ref}:CLAUDE.md is not a regular blob. Fix: restore a regular instruction file. ${GUIDE}`];
  }
  const lines = gitAt(cwd, ['show', `${ref}:CLAUDE.md`]).split('\n').filter(line => line.startsWith('Release format:'));
  return lines.length > 1 || lines.some(line => line !== FORMAT_MARKER)
    ? [`RELEASE_POLICY_MARKER: ${ref}:CLAUDE.md has a duplicated or altered release marker. Fix: use exactly '${FORMAT_MARKER}'. ${GUIDE}`] : [];
}
function releaseViolations(cwd: string, version: string): string[] {
  const errors: string[] = [];
  const fail = (code: string, message: string, fix: string) => errors.push(`${code}: ${message}. Fix: ${fix}. ${GUIDE}`);
  if (!RELEASE_RE.test(version)) {
    fail('RELEASE_VERSION_FORMAT', `VERSION=${version} is malformed`, 'write three numeric parts without suffixes or leading zeros (four parts only before cutover)');
    return errors;
  }
  if (gitAt(cwd, ['rev-parse', '--is-shallow-repository']) === 'true') {
    fail('RELEASE_SHALLOW', `VERSION=${version} has incomplete history`, 'run git fetch --unshallow --tags origin');
    return errors;
  }
  const all = gitAt(cwd, ['tag', '--list']).split('\n').filter(Boolean);
  const merged = gitAt(cwd, ['tag', '--merged', 'HEAD', '--sort=-v:refname']).split('\n').filter(Boolean);
  const valid = (tag: string) => tag.startsWith('v') && RELEASE_RE.test(tag.slice(1));
  const releases = merged.filter(valid);
  const ignored = merged.filter(tag => !valid(tag));
  if (ignored.length) console.info(`RELEASE_IGNORED_TAGS: ${ignored.join(', ')}`);
  if (!releases.length) fail('RELEASE_TAGS_MISSING', `VERSION=${version} has zero merged release tags (ignored: ${ignored.join(', ') || 'none'})`, 'run git fetch --tags origin and restore release history');
  for (const tag of releases) {
    if (compareRelease(version, tag.slice(1)) < 0) fail('RELEASE_VERSION_ORDER', `VERSION=${version} is below merged tag ${tag}`, 'choose a version above every release tag and align VERSION, package.json and CHANGELOG.md');
  }
  for (const tag of all.filter(valid)) {
    if (compareRelease(version, tag.slice(1)) === 0 && (tag !== `v${version}` || !merged.includes(tag))) {
      fail('RELEASE_PADDED_EQUAL_TAG', `VERSION=${version} collides with ${tag} (merged=${merged.includes(tag)})`, 'choose an unused higher version; keep existing tags intact');
    }
  }
  if (releases[0]?.slice(1).split('.').length === 3 && version.split('.').length !== 3) {
    fail('RELEASE_FORMAT_THREE_PART', `VERSION=${version} follows three-part top tag ${releases[0]}`, 'write MAJOR.MINOR.PATCH in VERSION, package.json and the CHANGELOG.md heading');
  }
  let base: string | undefined;
  for (const ref of ['origin/main', 'origin/master']) {
    const result = spawnSync('git', ['merge-base', 'HEAD', ref], { cwd, encoding: 'utf8', env: GIT_ENV });
    if (result.status === 0) { base = result.stdout.trim(); break; }
  }
  if (!base) {
    fail('RELEASE_BASE_MISSING', `VERSION=${version} has no merge base with origin/main or origin/master`, 'fetch the target remote branch; local main and TOUCHFILES_BASE are not policy bases');
    return errors;
  }
  errors.push(...markerViolations(cwd, base));
  // Tags can lag the base (auto-tag delayed or failed), so a changed VERSION must also pass the base's own.
  const baseRead = spawnSync('git', ['show', `${base}:VERSION`], { cwd, encoding: 'utf8', env: GIT_ENV });
  const baseVersion = baseRead.status === 0 ? baseRead.stdout.trim() : '';
  if (RELEASE_RE.test(baseVersion) && version !== baseVersion && compareRelease(version, baseVersion) <= 0) {
    fail('RELEASE_VERSION_BASE_ORDER', `VERSION=${version} changes base VERSION=${baseVersion} without exceeding it`, 'choose a version above the base VERSION even when its tag is missing');
  }
  const basePolicy = gitAt(cwd, ['ls-tree', base, '--', 'CLAUDE.md']);
  if (basePolicy.startsWith('100644 ') || basePolicy.startsWith('100755 ')) {
    const policy = gitAt(cwd, ['show', `${base}:CLAUDE.md`]);
    if (policy.split('\n').includes(FORMAT_MARKER) && version !== baseVersion && version.split('.').length !== 3) {
      fail('RELEASE_FORMAT_THREE_PART', `VERSION=${version} differs from base VERSION=${baseVersion} whose policy requires three parts`, 'write MAJOR.MINOR.PATCH in VERSION, package.json and the CHANGELOG.md heading');
    } else if (policy.split('\n').includes(FORMAT_MARKER) && version !== baseVersion
      && baseVersion.split('.').length !== 3 && releases.every(tag => tag.split('.').length !== 3)) {
      // Cutover: the first three-part release is the next 0.x MINOR with PATCH 0.
      const prior = [baseVersion, ...releases.map(tag => tag.slice(1))].filter(v => RELEASE_RE.test(v))
        .reduce((a, b) => (compareRelease(a, b) >= 0 ? a : b), '0.0.0');
      const [major, minor, patch] = version.split('.').map(Number);
      const [priorMajor, priorMinor] = prior.split('.').map(Number);
      if (major !== priorMajor || minor <= priorMinor || patch !== 0) {
        fail('RELEASE_CUTOVER_MINOR', `VERSION=${version} is the first three-part release after ${prior}`, `use the next MINOR with PATCH 0 (${priorMajor}.${priorMinor + 1}.0) and disclose the switch`);
      }
    }
  }
  return errors;
}

test('release ordering and base-policy guards', () => {
  expect(releaseViolations(ROOT, VERSION)).toEqual([]);
});
test('the release marker is exact and unique in working instructions and a regular HEAD blob', () => {
  expect(readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8').split('\n').filter(line => line.startsWith('Release format:'))).toEqual([FORMAT_MARKER]);
  expect(markerViolations(ROOT, 'HEAD')).toEqual([]);
});

const releaseTmp = makeBaseTmp('release-compatibility-');
afterAll(() => rmSync(releaseTmp, { recursive: true, force: true }));
function policyRepo(markerOnBase = false): string {
  const repo = makeEmptyRepo(releaseTmp);
  writeFileSync(join(repo, 'VERSION'), '0.46.0.0\n');
  writeFileSync(join(repo, 'CLAUDE.md'), markerOnBase ? FORMAT_MARKER + '\n' : '# Legacy policy\n');
  gitAt(repo, ['add', '.']); gitAt(repo, ['commit', '-qm', 'base']);
  gitAt(repo, ['tag', 'v0.46.0.0']);
  gitAt(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  return repo;
}
describe('release guard controls in isolated repositories', () => {
  test('this Track may release four parts; HEAD marker and TOUCHFILES_BASE cannot activate base policy', () => {
    const repo = policyRepo();
    writeFileSync(join(repo, 'CLAUDE.md'), FORMAT_MARKER + '\n');
    gitAt(repo, ['add', '.']); gitAt(repo, ['commit', '-qm', 'marker']);
    const before = process.env.TOUCHFILES_BASE;
    try {
      process.env.TOUCHFILES_BASE = 'HEAD';
      expect(releaseViolations(repo, '0.46.1.0')).toEqual([]);
    } finally {
      if (before === undefined) delete process.env.TOUCHFILES_BASE; else process.env.TOUCHFILES_BASE = before;
    }
  }, 20000);
  test('base marker requires three slots only when VERSION changes, with origin/master fallback', () => {
    const repo = policyRepo(true);
    expect(releaseViolations(repo, '0.46.0.0')).toEqual([]);
    expect(releaseViolations(repo, '0.47.0')).toEqual([]);
    expect(releaseViolations(repo, '0.47.0.0').join('\n')).toContain('RELEASE_FORMAT_THREE_PART: VERSION=0.47.0.0 differs from base VERSION=0.46.0.0');
    gitAt(repo, ['update-ref', 'refs/remotes/origin/master', 'origin/main']);
    gitAt(repo, ['update-ref', '-d', 'refs/remotes/origin/main']);
    expect(releaseViolations(repo, '0.47.0')).toEqual([]);
  }, 20000);
  test('regressions, padded equality and an unmerged exact tag fail; exact merged equality passes', () => {
    const repo = policyRepo();
    expect(releaseViolations(repo, '0.45.0').join('\n')).toContain('RELEASE_VERSION_ORDER');
    expect(releaseViolations(repo, '0.46.0').join('\n')).toContain('RELEASE_PADDED_EQUAL_TAG');
    expect(releaseViolations(repo, '0.46.0.0')).toEqual([]);
    gitAt(repo, ['checkout', '-qb', 'other']);
    gitAt(repo, ['commit', '--allow-empty', '-qm', 'outside history']);
    gitAt(repo, ['tag', 'v0.47.0']);
    gitAt(repo, ['checkout', '-q', 'main']);
    expect(releaseViolations(repo, '0.47.0').join('\n')).toContain('v0.47.0 (merged=false)');
  }, 20000);
  test('three-part top tag prevents width regression', () => {
    const repo = policyRepo();
    gitAt(repo, ['tag', 'v0.47.0']);
    expect(releaseViolations(repo, '0.48.0.0').join('\n')).toContain('RELEASE_FORMAT_THREE_PART');
    expect(releaseViolations(repo, '0.48.0')).toEqual([]);
  }, 20000);
  test('missing tags, missing remote base, shallow history and non-release tags are explicit', () => {
    const repo = policyRepo();
    gitAt(repo, ['tag', '-d', 'v0.46.0.0']);
    for (const tag of ['foo', 'v1.0.0-rc1']) gitAt(repo, ['tag', tag]);
    expect(releaseViolations(repo, '0.47.0').join('\n')).toContain('RELEASE_TAGS_MISSING');
    gitAt(repo, ['tag', 'v0.46.0.0']);
    expect(releaseViolations(repo, '0.47.0')).toEqual([]);
    gitAt(repo, ['update-ref', '-d', 'refs/remotes/origin/main']);
    expect(releaseViolations(repo, '0.47.0').join('\n')).toContain('RELEASE_BASE_MISSING');
    const shallow = join(releaseTmp, 'shallow');
    gitAt(releaseTmp, ['clone', '-q', '--depth=1', `file://${repo}`, shallow]);
    expect(releaseViolations(shallow, '0.47.0').join('\n')).toContain('git fetch --unshallow --tags origin');
  }, 20000);
  test('altered, duplicated and symlink policy markers fail', () => {
    const repo = policyRepo(true);
    for (const text of [FORMAT_MARKER + '\n' + FORMAT_MARKER, 'Release format: changed']) {
      writeFileSync(join(repo, 'CLAUDE.md'), text);
      gitAt(repo, ['add', '.']); gitAt(repo, ['commit', '-qm', 'bad marker']);
      expect(markerViolations(repo, 'HEAD').join('\n')).toContain('RELEASE_POLICY_MARKER');
    }
    rmSync(join(repo, 'CLAUDE.md'));
    symlinkSync('VERSION', join(repo, 'CLAUDE.md'));
    gitAt(repo, ['add', '.']); gitAt(repo, ['commit', '-qm', 'symlink']);
    expect(markerViolations(repo, 'HEAD').join('\n')).toContain('RELEASE_POLICY_FILE');
  }, 20000);
  test('a changed VERSION must exceed an untagged base VERSION', () => {
    const repo = policyRepo(true);
    writeFileSync(join(repo, 'VERSION'), '0.47.0.0\n');
    gitAt(repo, ['add', '.']); gitAt(repo, ['commit', '-qm', 'untagged release']);
    gitAt(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    for (const version of ['0.47.0', '0.46.5']) {
      expect(releaseViolations(repo, version).join('\n')).toContain(`RELEASE_VERSION_BASE_ORDER: VERSION=${version} changes base VERSION=0.47.0.0`);
    }
    expect(releaseViolations(repo, '0.47.0.0')).toEqual([]);
    expect(releaseViolations(repo, '0.48.0')).toEqual([]);
  }, 20000);
  test('the first three-part release under the base marker is the next 0.x MINOR', () => {
    const repo = policyRepo(true);
    for (const version of ['0.46.1', '0.47.1', '1.0.0']) {
      expect(releaseViolations(repo, version).join('\n')).toContain(`RELEASE_CUTOVER_MINOR: VERSION=${version}`);
    }
    expect(releaseViolations(repo, '0.47.0')).toEqual([]);
    writeFileSync(join(repo, 'VERSION'), '0.47.0\n');
    gitAt(repo, ['add', '.']); gitAt(repo, ['commit', '-qm', 'untagged cutover']);
    gitAt(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    expect(releaseViolations(repo, '0.47.1')).toEqual([]);
    gitAt(repo, ['tag', 'v0.47.0']);
    expect(releaseViolations(repo, '0.47.1')).toEqual([]);
  }, 20000);
  test('malformed and leading-zero VERSION values fail before any history check', () => {
    const repo = policyRepo();
    for (const version of ['0.010.0', '00.47.0', '0.47', '0.47.0.0.0', 'v0.47.0', '0.47.0-rc1']) {
      const errors = releaseViolations(repo, version);
      expect([version, errors.length, errors[0]?.split(':')[0]]).toEqual([version, 1, 'RELEASE_VERSION_FORMAT']);
    }
  }, 20000);
});

describe('auto-tag and release notes across formats', () => {
  test('the workflow ERE accepts three/four parts and rejects malformed and leading-zero values', () => {
    const workflow = readFileSync(join(ROOT, '.github/workflows/auto-tag.yml'), 'utf8');
    const patterns = [...workflow.matchAll(/grep -qE '([^']+)'/g)];
    expect(patterns).toHaveLength(1);
    for (const version of ['0.47.0', '1.0.0', '0.46.0.0', '0.47', '0.47.0.0.0', 'v0.47.0', '0.47.0-rc1', '0.010.0', '00.1.0']) {
      const result = spawnSync('bash', ['-c', 'printf "%s\\n" "$1" | grep -qE "$2"', 'check', version, patterns[0][1]], { encoding: 'utf8' });
      expect(result.status).toBe(['0.47.0', '1.0.0', '0.46.0.0'].includes(version) ? 0 : 1);
      expect(result.stderr).toBe('');
    }
    expect(workflow).toContain('::error::Invalid VERSION');
    expect(workflow).toContain('expected MAJOR.MINOR.PATCH');
    expect(workflow).toContain('gh release edit $TAG --notes-file');
    expect(workflow).not.toContain('"$NOTES_FILE" 2>/dev/null');
  });
  test('extractor returns exactly the three-part section and fails for missing notes', () => {
    const repo = policyRepo();
    writeFileSync(join(repo, 'CHANGELOG.md'), '# Changes\n\n## [0.47.0.1] - 2026-10-23\nWrong section\n\n## [0.47.0] - 2026-10-23\nCandidate notes\n\n## [0.46.0.0] - 2026-10-22\nOld notes\n');
    for (const version of ['0.47.0', '9.0.0']) {
      const result = spawnSync('bash', [join(ROOT, 'scripts/extract-changelog-section.sh'), version], { cwd: repo, encoding: 'utf8' });
      expect(result.status).toBe(version === '0.47.0' ? 0 : 1);
      if (result.status === 0) expect(result.stdout.trim()).toBe('Candidate notes');
      else expect(result.stderr).toContain('No CHANGELOG section found');
    }
  }, 20000);
});
