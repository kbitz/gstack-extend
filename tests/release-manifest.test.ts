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
 * padded-equals another tag, exceeds the remote tip's VERSION, keeps four parts
 * while the merge base has no CLAUDE.md marker, keeps three parts after a
 * three-part top tag or under the marker (the first such release being the next
 * unused 0.x MINOR with PATCH 0), and HEAD's marker stays exact. It reports
 * incomplete or stray tags against a four-part base VERSION. Those checks read
 * Git state no touchfile can select: fetched tags, full history and
 * refs/remotes/origin/main (or refs/remotes/origin/master).
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { GIT_ENV, makeBaseTmp, makeEmptyRepo } from './helpers/fixture-repo.ts';

const ROOT = join(import.meta.dir, '..');
// ASCII whitespace only, as auto-tag's `tr -d '[:space:]'` strips; a BOM or NBSP must fail the format check.
const VERSION = readFileSync(join(ROOT, 'VERSION'), 'utf8').replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');

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
const MARKER_PREFIX = 'Release format:';
const FORMAT_MARKER = `${MARKER_PREFIX} MAJOR.MINOR.PATCH (three-part; no suffixes).`;
const RELEASE_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*))?$/;
const GUIDE = 'See CLAUDE.md#versioning.';
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
function highest(versions: string[]): string {
  return versions.reduce((a, b) => (a === '' || compareRelease(b, a) > 0 ? b : a), '');
}
function markerViolations(cwd: string, ref: string): string[] {
  const entry = gitAt(cwd, ['ls-tree', ref, '--', 'CLAUDE.md']);
  if (!entry) return [];
  if (!entry.startsWith('100644 ') && !entry.startsWith('100755 ')) {
    return [`RELEASE_POLICY_FILE: ${ref}:CLAUDE.md is not a regular blob. Fix: restore a regular instruction file. ${GUIDE}`];
  }
  const lines = gitAt(cwd, ['show', `${ref}:CLAUDE.md`]).split('\n').filter(line => line.startsWith(MARKER_PREFIX));
  return lines.length > 1 || lines.some(line => line !== FORMAT_MARKER)
    ? [`RELEASE_POLICY_MARKER: ${ref}:CLAUDE.md has a duplicated or altered release marker. Fix: use exactly '${FORMAT_MARKER}'. ${GUIDE}`] : [];
}
// Any marker line, or a CLAUDE.md that is not a regular blob, makes a ref's policy three-part: an
// amended marker cannot silently switch the policy off. HEAD's marker is checked for exactness separately.
function policyActive(cwd: string, ref: string): boolean {
  const entry = gitAt(cwd, ['ls-tree', ref, '--', 'CLAUDE.md']);
  if (!entry) return false;
  if (!entry.startsWith('100644 ') && !entry.startsWith('100755 ')) return true;
  return gitAt(cwd, ['show', `${ref}:CLAUDE.md`]).split('\n').some(line => line.startsWith(MARKER_PREFIX));
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
  const top = highest(releases.map(tag => tag.slice(1)));
  // Full ref names: a tag or branch called origin/main must not stand in for the remote base.
  let base: string | undefined, baseRef = '';
  for (const ref of ['refs/remotes/origin/main', 'refs/remotes/origin/master']) {
    const result = spawnSync('git', ['merge-base', 'HEAD', ref], { cwd, encoding: 'utf8', env: GIT_ENV });
    if (result.status === 0) { base = result.stdout.trim(); baseRef = ref; break; }
  }
  if (!base) {
    fail('RELEASE_BASE_MISSING', `VERSION=${version} has no merge base with refs/remotes/origin/main or refs/remotes/origin/master`, 'run git fetch origin; a same-named local tag or branch, local main and TOUCHFILES_BASE are not policy bases');
    return errors;
  }
  // Tags can lag the base (auto-tag delayed or failed), so a changed VERSION must also pass the base's own.
  const baseRead = spawnSync('git', ['show', `${base}:VERSION`], { cwd, encoding: 'utf8', env: GIT_ENV });
  const baseVersion = baseRead.status === 0 ? baseRead.stdout.trim() : '';
  if (RELEASE_RE.test(baseVersion) && version !== baseVersion && compareRelease(version, baseVersion) <= 0) {
    fail('RELEASE_VERSION_BASE_ORDER', `VERSION=${version} changes base VERSION=${baseVersion} without exceeding it`, 'choose a version above the base VERSION even when its tag is missing');
  }
  // Against a four-part base VERSION, a three-part top tag below it means the four-part tags were never
  // fetched, and one at or above it is a local tag no release of this history carries.
  if (RELEASE_RE.test(baseVersion) && baseVersion.split('.').length === 4 && top.split('.').length === 3) {
    if (compareRelease(top, baseVersion) < 0) {
      fail('RELEASE_TAGS_INCOMPLETE', `merged release tags stop at v${top}, below base VERSION=${baseVersion}`, 'run git fetch --tags origin');
    } else {
      fail('RELEASE_TAG_STRAY', `merged tag v${top} is three-part at or above four-part base VERSION=${baseVersion}`, 'inspect git tag --list and delete the stray local tag');
    }
    return errors;
  }
  if (top.split('.').length === 3 && version.split('.').length !== 3) {
    fail('RELEASE_FORMAT_THREE_PART', `VERSION=${version} follows three-part top tag v${top}`, 'write MAJOR.MINOR.PATCH in VERSION, package.json and the CHANGELOG.md heading');
  }
  if (version === baseVersion) return errors;
  // A release branch behind the remote must merge it first: another workspace may have released there,
  // or the marker may have landed, and the older base's advice would be wrong.
  const remote = baseRef.replace('refs/remotes/', '');
  const tipRead = spawnSync('git', ['show', `${baseRef}:VERSION`], { cwd, encoding: 'utf8', env: GIT_ENV });
  const tipVersion = tipRead.status === 0 ? tipRead.stdout.trim() : '';
  if (RELEASE_RE.test(tipVersion) && tipVersion !== baseVersion && compareRelease(version, tipVersion) <= 0) {
    fail('RELEASE_BASE_STALE', `VERSION=${version} does not exceed ${remote}'s VERSION=${tipVersion}`, `merge ${remote} and choose a version above it`);
    return errors;
  }
  const active = policyActive(cwd, base);
  if (!active && policyActive(cwd, baseRef)) {
    fail('RELEASE_BASE_STALE', `VERSION=${version} is cut from base ${base.slice(0, 12)}, before ${remote} gained the release marker`, `merge ${remote} and rerun`);
    return errors;
  }
  // The base VERSION's width sets the era; tags decide only when the base has no valid VERSION.
  const legacy = (RELEASE_RE.test(baseVersion) ? baseVersion : top).split('.').length === 4;
  const parts = version.split('.');
  if (!active && legacy && parts.length === 3) {
    fail('RELEASE_FORMAT_LEGACY', `VERSION=${version} is three-part, but base ${base.slice(0, 12)} has no release marker`, 'keep MAJOR.MINOR.PATCH.MICRO until a release cut from a base containing the marker');
  } else if (active && parts.length !== 3) {
    fail('RELEASE_FORMAT_THREE_PART', `VERSION=${version} differs from base VERSION=${baseVersion} whose policy requires three parts`, 'write MAJOR.MINOR.PATCH in VERSION, package.json and the CHANGELOG.md heading');
  } else if (active && legacy) {
    // Cutover: the first three-part release is the next 0.x MINOR above the base VERSION and every
    // fetched tag, merged or not, with PATCH 0 (CLAUDE.md's cutover procedure).
    const prior = highest([baseVersion, ...all.filter(valid).map(tag => tag.slice(1))].filter(v => RELEASE_RE.test(v)));
    const [priorMajor, priorMinor] = prior.split('.').map(Number);
    const source = prior === baseVersion ? 'the base VERSION'
      : `tag v${prior}${releases.includes(`v${prior}`) ? '' : ' (not merged into HEAD; delete it if stray)'}`;
    if (priorMajor !== 0) {
      fail('RELEASE_CUTOVER_MINOR', `the cutover must stay in 0.x, but ${source} is ${prior}`, 'inspect git tag --list for stray tags from other remotes');
    } else if (version !== `${priorMajor}.${priorMinor + 1}.0`) {
      fail('RELEASE_CUTOVER_MINOR', `VERSION=${version} is the first three-part release after ${prior}, set by ${source}`, `use the next unused 0.x MINOR with PATCH 0, ${priorMajor}.${priorMinor + 1}.0, and disclose the switch`);
    }
  }
  return errors;
}

test('release ordering and base-policy guards', () => {
  expect(releaseViolations(ROOT, VERSION)).toEqual([]);
});
test('the release marker is exact and unique in working instructions and a regular HEAD blob', () => {
  expect(readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8').split('\n').filter(line => line.startsWith(MARKER_PREFIX))).toEqual([FORMAT_MARKER]);
  expect(markerViolations(ROOT, 'HEAD')).toEqual([]);
});

const releaseTmp = makeBaseTmp('release-compatibility-');
afterAll(() => rmSync(releaseTmp, { recursive: true, force: true }));
function policyRepo(markerOnBase: boolean | string = false): string {
  const repo = makeEmptyRepo(releaseTmp);
  gitAt(repo, ['tag', 'v0.18.3']); // pre-four-part history below the legacy top, as in this repository
  writeFileSync(join(repo, 'VERSION'), '0.46.0.0\n');
  writeFileSync(join(repo, 'CLAUDE.md'), markerOnBase === true ? FORMAT_MARKER + '\n' : `${markerOnBase || '# Legacy policy'}\n`);
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
      for (const version of ['0.46.1', '1.0.0']) {
        expect(releaseViolations(repo, version).join('\n')).toContain(`RELEASE_FORMAT_LEGACY: VERSION=${version}`);
      }
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
    writeFileSync(join(repo, 'VERSION'), '0.47.0\n');
    gitAt(repo, ['add', '.']); gitAt(repo, ['commit', '-qm', 'release 0.47.0']);
    gitAt(repo, ['tag', 'v0.47.0']);
    gitAt(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    expect(releaseViolations(repo, '0.48.0.0').join('\n')).toContain('RELEASE_FORMAT_THREE_PART');
    expect(releaseViolations(repo, '0.48.0')).toEqual([]);
  }, 20000);
  test('missing tags, missing remote base, shallow history and non-release tags are explicit', () => {
    const repo = policyRepo();
    gitAt(repo, ['tag', '-d', 'v0.46.0.0', 'v0.18.3']);
    for (const tag of ['foo', 'v1.0.0-rc1']) gitAt(repo, ['tag', tag]);
    expect(releaseViolations(repo, '0.47.0.0').join('\n')).toContain('RELEASE_TAGS_MISSING');
    gitAt(repo, ['tag', 'v0.46.0.0']);
    expect(releaseViolations(repo, '0.47.0.0')).toEqual([]);
    gitAt(repo, ['update-ref', '-d', 'refs/remotes/origin/main']);
    expect(releaseViolations(repo, '0.47.0.0').join('\n')).toContain('RELEASE_BASE_MISSING');
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
    expect(releaseViolations(repo, '0.47.0').join('\n')).toContain('is the first three-part release after 0.47.0.0, set by the base VERSION. Fix: use the next unused 0.x MINOR with PATCH 0, 0.48.0');
    expect(releaseViolations(repo, '0.47.0.0')).toEqual([]);
    expect(releaseViolations(repo, '0.48.0')).toEqual([]);
  }, 20000);
  test('the first three-part release under the base marker is the next 0.x MINOR', () => {
    const repo = policyRepo(true);
    for (const version of ['0.46.1', '0.47.1', '0.48.0', '1.0.0']) {
      expect(releaseViolations(repo, version).join('\n')).toContain(`RELEASE_CUTOVER_MINOR: VERSION=${version}`);
    }
    expect(releaseViolations(repo, '0.47.0')).toEqual([]);
    writeFileSync(join(repo, 'VERSION'), '0.47.0\n');
    gitAt(repo, ['add', '.']); gitAt(repo, ['commit', '-qm', 'untagged cutover']);
    gitAt(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    expect(releaseViolations(repo, '0.47.1')).toEqual([]);
    gitAt(repo, ['tag', 'v0.47.0']);
    expect(releaseViolations(repo, '0.47.1')).toEqual([]);
    // After the cutover, auto-tag may lag one release behind a three-part base VERSION.
    writeFileSync(join(repo, 'VERSION'), '0.47.1\n');
    gitAt(repo, ['add', '.']); gitAt(repo, ['commit', '-qm', 'untagged 0.47.1']);
    gitAt(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    expect(releaseViolations(repo, '0.47.1')).toEqual([]);
    expect(releaseViolations(repo, '0.47.2')).toEqual([]);
    expect(releaseViolations(repo, '0.47.2.0').join('\n')).toContain('RELEASE_FORMAT_THREE_PART');
  }, 20000);
  test('a three-part tag on local-only history cannot switch the era', () => {
    for (const marker of [false, true]) {
      const repo = policyRepo(marker);
      gitAt(repo, ['tag', 'v0.48.5']);
      for (const version of ['0.46.0.0', '0.48.5', '0.49.0']) {
        expect([marker, version, releaseViolations(repo, version).map(e => e.split(':')[0]).at(-1)])
          .toEqual([marker, version, 'RELEASE_TAG_STRAY']);
      }
    }
  }, 30000);
  test('a release behind the remote tip must merge it first', () => {
    const repo = policyRepo(true);
    gitAt(repo, ['checkout', '-qb', 'release']);
    gitAt(repo, ['checkout', '-q', 'main']);
    writeFileSync(join(repo, 'VERSION'), '0.47.0\n');
    gitAt(repo, ['add', '.']); gitAt(repo, ['commit', '-qm', 'cutover lands elsewhere']);
    gitAt(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    gitAt(repo, ['checkout', '-q', 'release']);
    expect(releaseViolations(repo, '0.47.0').join('\n')).toContain("RELEASE_BASE_STALE: VERSION=0.47.0 does not exceed origin/main's VERSION=0.47.0");
    expect(releaseViolations(repo, '0.46.0.0')).toEqual([]);
  }, 20000);
  test('the cutover goes above every fetched tag, including tags outside HEAD, and stays in 0.x', () => {
    const repo = policyRepo(true);
    const outside = gitAt(repo, ['commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'outside history']);
    for (const stray of ['v0.47.0.0', 'v0.47.1', 'v0.47.0.1']) {
      gitAt(repo, ['tag', stray, outside]);
      expect([stray, releaseViolations(repo, '0.47.0').join('\n')]).toEqual([stray, expect.stringContaining('use the next unused 0.x MINOR with PATCH 0, 0.48.0')]);
      expect([stray, releaseViolations(repo, '0.48.0')]).toEqual([stray, []]);
      gitAt(repo, ['tag', '-d', stray]);
    }
    gitAt(repo, ['tag', 'v1.91.185.0', outside]);
    for (const version of ['0.47.0', '1.92.0']) {
      expect(releaseViolations(repo, version).join('\n')).toContain('the cutover must stay in 0.x');
    }
  }, 30000);
  test('only pre-four-part tags below a four-part base VERSION report incomplete tags', () => {
    for (const marker of [false, true]) {
      const repo = policyRepo(marker);
      gitAt(repo, ['tag', '-d', 'v0.46.0.0']);
      for (const version of ['0.46.0.0', '0.46.1', '0.47.0', '0.47.0.0']) {
        expect([marker, version, releaseViolations(repo, version).map(e => e.split(':')[0])])
          .toEqual([marker, version, ['RELEASE_TAGS_INCOMPLETE']]);
      }
    }
  }, 30000);
  // Value: protects=with no valid base VERSION, the top merged tag's width sets the era and the cutover target;
  //   fails_when=the era stops falling back to tags, or a malformed base VERSION reaches the cutover's version comparison;
  //   why_new=every other fixture base carries a valid VERSION, so the tag fallback never runs; seam=none;
  //   no_claim=a missing and a malformed base VERSION are each checked in one era only (Git-only fixtures)
  test('without a valid base VERSION, the top merged tag sets the era', () => {
    const missing = policyRepo();
    gitAt(missing, ['rm', '-q', 'VERSION']); gitAt(missing, ['commit', '-qm', 'base without VERSION']);
    gitAt(missing, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    expect(releaseViolations(missing, '0.47.0').join('\n')).toContain('RELEASE_FORMAT_LEGACY: VERSION=0.47.0');
    expect(releaseViolations(missing, '0.46.1.0')).toEqual([]);
    const malformed = policyRepo(true);
    writeFileSync(join(malformed, 'VERSION'), '0.46.0.0-rc1\n');
    gitAt(malformed, ['add', '.']); gitAt(malformed, ['commit', '-qm', 'malformed base VERSION']);
    gitAt(malformed, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    expect(releaseViolations(malformed, '0.47.0')).toEqual([]);
    const early = releaseViolations(malformed, '0.46.1').join('\n');
    expect(early).toContain('RELEASE_CUTOVER_MINOR: VERSION=0.46.1');
    expect(early).toContain('use the next unused 0.x MINOR with PATCH 0, 0.47.0');
  }, 30000);
  test('a tag named origin/main cannot stand in for the remote base', () => {
    const repo = policyRepo();
    gitAt(repo, ['tag', 'origin/main', 'HEAD~1']);
    writeFileSync(join(repo, 'CLAUDE.md'), FORMAT_MARKER + '\n');
    gitAt(repo, ['add', '.']); gitAt(repo, ['commit', '-qm', 'marker lands']);
    gitAt(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    expect(releaseViolations(repo, '0.47.0.0').join('\n')).toContain('RELEASE_FORMAT_THREE_PART');
    expect(releaseViolations(repo, '0.47.0')).toEqual([]);
  }, 20000);
  test('a release branch cut before the marker reached origin/main must merge it first', () => {
    const repo = policyRepo();
    gitAt(repo, ['checkout', '-qb', 'release']);
    gitAt(repo, ['checkout', '-q', 'main']);
    writeFileSync(join(repo, 'CLAUDE.md'), FORMAT_MARKER + '\n');
    gitAt(repo, ['add', '.']); gitAt(repo, ['commit', '-qm', 'marker lands']);
    gitAt(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    gitAt(repo, ['checkout', '-q', 'release']);
    for (const version of ['0.46.1.0', '0.47.0']) {
      expect(releaseViolations(repo, version).join('\n')).toContain(`RELEASE_BASE_STALE: VERSION=${version}`);
    }
    expect(releaseViolations(repo, '0.46.0.0')).toEqual([]);
  }, 20000);
  test('an amended or non-regular base marker keeps three parts required without failing the PR', () => {
    for (const setup of ['amended', 'symlink'] as const) {
      const repo = policyRepo(setup === 'amended' ? 'Release format: MAJOR.MINOR.PATCH (three-part; no prefixes or suffixes).' : '# placeholder');
      if (setup === 'symlink') {
        rmSync(join(repo, 'CLAUDE.md'));
        symlinkSync('VERSION', join(repo, 'CLAUDE.md'));
        gitAt(repo, ['add', '-A']); gitAt(repo, ['commit', '-qm', 'symlinked policy']);
        gitAt(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
      }
      expect([setup, releaseViolations(repo, '0.46.0.0')]).toEqual([setup, []]);
      expect([setup, releaseViolations(repo, '0.47.0')]).toEqual([setup, []]);
      expect(releaseViolations(repo, '0.47.0.0').join('\n')).toContain('RELEASE_FORMAT_THREE_PART');
    }
  }, 20000);
  // Value (extended): protects=fixture setup ignores the user's global git config as well as an inherited GIT_DIR;
  //   fails_when=GIT_ENV stops pinning GIT_CONFIG_GLOBAL=/dev/null, so a signing or hook setting breaks fixture commits;
  //   why_new=the GIT_DIR case left the user-config half of the helper's isolation unexercised; seam=none;
  //   no_claim=system git config (GIT_CONFIG_NOSYSTEM) and suites' own raw git calls, which docs/TODOS.md defers
  test('shared fixture repos ignore a GIT_DIR inherited at startup, as under a git hook, and user git config', () => {
    const outer = makeEmptyRepo(releaseTmp);
    // A global config under which every commit fails to sign; the control proves git reads it here.
    const home = join(releaseTmp, 'signing-home');
    mkdirSync(home);
    writeFileSync(join(home, '.gitconfig'), '[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = false\n');
    const userConfig = { ...Object.fromEntries(Object.entries(GIT_ENV).filter(([key]) => key !== 'GIT_CONFIG_GLOBAL')), HOME: home };
    const control = spawnSync('git', ['-C', outer, 'commit', '--allow-empty', '-qm', 'signed'], { encoding: 'utf8', env: userConfig });
    expect(control.status).not.toBe(0);
    const child = spawnSync(process.execPath, ['--no-env-file', '--config=/dev/null', '--no-install', '-e',
      'const { makeEmptyRepo } = await import(process.argv[1]); console.log(makeEmptyRepo(process.argv[2]));',
      join(import.meta.dir, 'helpers/fixture-repo.ts'), releaseTmp],
      { encoding: 'utf8', env: { ...process.env, GIT_DIR: join(outer, '.git'), HOME: home } });
    if (child.status !== 0) throw new Error(`fixture child exited ${child.status}: ${child.stderr}`);
    const fixture = child.stdout.trim();
    expect(gitAt(outer, ['rev-list', '--count', 'HEAD'])).toBe('1');
    expect(existsSync(join(fixture, '.git'))).toBe(true);
    expect(gitAt(fixture, ['rev-list', '--count', 'HEAD'])).toBe('1');
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
  }, 20000);
  // Value: protects=auto-tag fails a malformed VERSION with its ::error:: fix and no tag, tags a three-part one, and
  //   publishes its notes or warns with the edit hint and the extractor's stderr;
  //   fails_when=a step mis-tags a three-part VERSION, drops the annotation or hint, or hides extractor stderr in any spelling;
  //   why_new=the check above greps the YAML text and runs only its ERE; seam=none;
  //   no_claim=the GitHub runner, token permissions and real gh (step bodies run under bash -e with a stub gh and a local bare origin)
  test('auto-tag steps tag a three-part VERSION and publish its notes, or fail and warn with fixes', () => {
    const lines = readFileSync(join(ROOT, '.github/workflows/auto-tag.yml'), 'utf8').split('\n');
    const step = (name: string): string => {
      const start = lines.findIndex(line => line.trim() === `- name: ${name}`);
      const run = lines.findIndex((line, i) => start >= 0 && i > start && line.trim() === 'run: |');
      if (run < 0) throw new Error(`auto-tag step '${name}' has no run block`);
      const indent = lines[run + 1]!.search(/\S/);
      const body: string[] = [];
      for (const line of lines.slice(run + 1)) {
        if (line.trim() && line.search(/\S/) < indent) break;
        body.push(line.slice(indent));
      }
      return body.join('\n');
    };
    const repo = makeEmptyRepo(releaseTmp);
    const origin = join(releaseTmp, 'auto-tag-origin.git');
    gitAt(releaseTmp, ['init', '-q', '--bare', origin]);
    gitAt(repo, ['remote', 'add', 'origin', origin]);
    mkdirSync(join(repo, 'scripts'));
    symlinkSync(join(ROOT, 'scripts/extract-changelog-section.sh'), join(repo, 'scripts/extract-changelog-section.sh'));
    const bin = join(releaseTmp, 'auto-tag-bin'), tmp = join(releaseTmp, 'auto-tag-tmp');
    const ghLog = join(releaseTmp, 'auto-tag-gh.log'), output = join(releaseTmp, 'auto-tag-output');
    mkdirSync(bin); mkdirSync(tmp);
    writeFileSync(join(bin, 'gh'), '#!/bin/sh\nprintf \'gh %s\\n\' "$*" >> "$GH_LOG"\n[ "$1 $2" = "release view" ] && exit 1\n'
      + 'while [ $# -gt 0 ]; do [ "$1" = --notes-file ] && cat "$2" >> "$GH_LOG"; shift; done\nexit 0\n', { mode: 0o755 });
    const env = { ...GIT_ENV, PATH: `${bin}:${process.env.PATH}`, TMPDIR: tmp, GH_LOG: ghLog, GITHUB_OUTPUT: output, GH_TOKEN: 'stub' };
    const runStep = (name: string, extra: Record<string, string> = {}) =>
      spawnSync('bash', ['-e', '-c', step(name)], { cwd: repo, encoding: 'utf8', env: { ...env, ...extra } });

    writeFileSync(join(repo, 'VERSION'), '0.08.0\n');
    const malformed = runStep('Read version and create tag');
    expect([malformed.status, gitAt(repo, ['tag', '--list'])]).toEqual([1, '']);
    expect(malformed.stdout).toContain("::error::Invalid VERSION '0.08.0': expected MAJOR.MINOR.PATCH");
    expect(malformed.stdout).toContain('Fix VERSION, package.json and CHANGELOG.md');

    writeFileSync(join(repo, 'VERSION'), '0.47.0\n');
    const tagged = runStep('Read version and create tag');
    expect(tagged.status).toBe(0);
    expect(readFileSync(output, 'utf8')).toBe('version=0.47.0\ntag=v0.47.0\ntag_created=true\n');
    expect(gitAt(origin, ['tag', '--list'])).toBe('v0.47.0');

    const release = { TAG: 'v0.47.0', VERSION: '0.47.0' };
    writeFileSync(join(repo, 'CHANGELOG.md'), '# Changes\n\n## [0.47.0] - 2026-10-24\nCandidate notes\n\n## [0.46.0.0] - 2026-10-22\nOld notes\n');
    const notes = runStep('Create GitHub release', release);
    expect([notes.status, notes.stderr]).toEqual([0, '']);
    expect(notes.stdout).toContain('Using CHANGELOG.md section for release notes.');
    const published = readFileSync(ghLog, 'utf8');
    expect(published).toStartWith('gh release view v0.47.0\ngh release create v0.47.0 --title v0.47.0 --notes-file ');
    expect(published).toContain('Candidate notes');
    expect(published).not.toContain('Old notes');

    rmSync(ghLog);
    writeFileSync(join(repo, 'CHANGELOG.md'), '# Changes\n\n## [0.46.0.0] - 2026-10-22\nOld notes\n');
    const fallback = runStep('Create GitHub release', release);
    expect(fallback.status).toBe(0);
    expect(fallback.stdout).toContain('::warning::No CHANGELOG section for 0.47.0');
    expect(fallback.stdout).toContain('then run: gh release edit v0.47.0 --notes-file <corrected-notes-file>');
    expect(fallback.stderr).toContain('No CHANGELOG section found for version 0.47.0');
    expect(readFileSync(ghLog, 'utf8')).toBe('gh release view v0.47.0\ngh release create v0.47.0 --title v0.47.0 --generate-notes\n');
  }, 30000);
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
