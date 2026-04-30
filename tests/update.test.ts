/**
 * update.test.ts — tests for bin/update-run, setup, semver, bin/update-check.
 *
 * Migrated from scripts/test-update.sh (deleted in Track 3A).
 *
 * Four scenario clusters:
 *   1. bin/update-run: missing-arg, not-git-repo, happy-path on main,
 *      non-main-branch auto-switch + restore, dirty-worktree + branch-switch,
 *      diverged-main ff-only failure.
 *   2. setup: default install (5 skills), --with-native rejected, --uninstall,
 *      foreign-symlink preserved, --bogus rejected, --skills-dir custom dir,
 *      --skills-dir validation (missing-value, flag-as-value, relative-path),
 *      --skills-dir default-mismatch warning, --skills-dir + --uninstall,
 *      reversed flag order, --skills-dir-with-spaces.
 *   3. semver (4-digit): version_gt for >, ==, <. Tests bin/lib/semver.sh
 *      via bash shell-out — the bash lib stays live until Track 2A cutover.
 *      Independent TS coverage in tests/lib-semver.test.ts.
 *   4. bin/update-check: version regex validation (5 valid + 9 invalid),
 *      4-digit upgrade detection, 3-digit ↔ 4-digit-with-.0 up-to-date.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';

import { makeBaseTmp } from './helpers/fixture-repo.ts';
import { runBin } from './helpers/run-bin.ts';

const ROOT = join(import.meta.dir, '..');
const UPDATE_RUN = join(ROOT, 'bin', 'update-run');
const UPDATE_CHECK = join(ROOT, 'bin', 'update-check');
const SETUP = join(ROOT, 'setup');
const SEMVER_LIB = join(ROOT, 'bin', 'lib', 'semver.sh');

const baseTmp = makeBaseTmp('update-test-');
afterAll(() => {
  try { rmSync(baseTmp, { recursive: true, force: true }); } catch {}
});

// ─── Fixture-repo factory ────────────────────────────────────────────
//
// Creates a "local" repo + "remote" bare repo pair, with VERSION=1.0.0,
// a minimal setup stub, and the real bin/update-run copied in. Used for
// every update-run scenario.

function createFixtureRepo(name: string): string {
  const dir = join(baseTmp, name);
  const remoteDir = join(baseTmp, `${name}-remote`);

  mkdirSync(remoteDir, { recursive: true });
  spawnSync('git', ['-C', remoteDir, 'init', '--bare', '--initial-branch=main', '--quiet']);

  mkdirSync(join(dir, 'bin'), { recursive: true });
  mkdirSync(join(dir, 'skills'), { recursive: true });
  spawnSync('git', ['-C', dir, 'init', '--initial-branch=main', '--quiet']);
  spawnSync('git', ['-C', dir, 'remote', 'add', 'origin', remoteDir]);

  writeFileSync(join(dir, 'VERSION'), '1.0.0\n');
  writeFileSync(join(dir, 'setup'), '#!/usr/bin/env bash\necho "setup ran"\n');
  chmodSync(join(dir, 'setup'), 0o755);

  // Copy real update-run + dependencies in.
  writeFileSync(join(dir, 'bin', 'update-run'), readFileSync(UPDATE_RUN));
  chmodSync(join(dir, 'bin', 'update-run'), 0o755);

  spawnSync('git', ['-C', dir, 'add', '-A']);
  spawnSync('git', ['-C', dir, 'commit', '-m', 'initial', '--quiet']);
  spawnSync('git', ['-C', dir, 'push', 'origin', 'main', '--quiet']);
  return dir;
}

function pushNewVersion(remoteDir: string, version: string): void {
  const work = `${remoteDir}-work`;
  spawnSync('git', ['clone', '--quiet', remoteDir, work]);
  writeFileSync(join(work, 'VERSION'), `${version}\n`);
  spawnSync('git', ['-C', work, 'add', 'VERSION']);
  spawnSync('git', ['-C', work, 'commit', '-m', `bump to ${version}`, '--quiet']);
  spawnSync('git', ['-C', work, 'push', 'origin', 'main', '--quiet']);
  rmSync(work, { recursive: true, force: true });
}

// ─── bin/update-run ─────────────────────────────────────────────────

describe('bin/update-run', () => {
  describe('missing-arg + non-git rejection', () => {
    test('rejects missing repo root argument', () => {
      const r = spawnSync(UPDATE_RUN, [], { encoding: 'utf8' });
      const out = (r.stdout ?? '') + (r.stderr ?? '');
      expect(out).toContain('UPGRADE_FAILED missing repo root argument');
    });

    test('rejects non-git directory', () => {
      const notGit = join(baseTmp, 'not-a-repo');
      mkdirSync(notGit, { recursive: true });
      const r = spawnSync(UPDATE_RUN, [notGit], { encoding: 'utf8' });
      const out = (r.stdout ?? '') + (r.stderr ?? '');
      expect(out).toContain('UPGRADE_FAILED not a git repo');
    });
  });

  describe('happy path on main', () => {
    let repo: string;
    let stateDir: string;
    let homeDir: string;
    let result: ReturnType<typeof runBin>;

    beforeAll(() => {
      repo = createFixtureRepo('happy');
      pushNewVersion(`${baseTmp}/happy-remote`, '1.1.0');
      stateDir = join(baseTmp, 'happy-state');
      homeDir = join(baseTmp, 'happy-home');
      mkdirSync(stateDir, { recursive: true });
      mkdirSync(homeDir, { recursive: true });
      result = runBin(UPDATE_RUN, [repo], {
        home: homeDir,
        gstackExtendDir: ROOT,
        gstackExtendStateDir: stateDir,
      });
    });

    test('upgrades from main successfully', () => {
      const out = result.stdout + result.stderr;
      expect(out).toContain('UPGRADE_OK 1.0.0 1.1.0');
    });

    test('writes just-upgraded-from marker', () => {
      const marker = join(stateDir, 'just-upgraded-from');
      expect(existsSync(marker)).toBe(true);
      expect(readFileSync(marker, 'utf8').trim()).toBe('1.0.0');
    });
  });

  describe('non-main branch auto-switch', () => {
    let repo: string;
    let result: ReturnType<typeof runBin>;

    beforeAll(() => {
      repo = createFixtureRepo('branch-switch');
      // Create + switch to feature branch with a commit.
      spawnSync('git', ['-C', repo, 'checkout', '-b', 'feature/test', '--quiet']);
      writeFileSync(join(repo, 'branch-file.txt'), 'branch work\n');
      spawnSync('git', ['-C', repo, 'add', 'branch-file.txt']);
      spawnSync('git', ['-C', repo, 'commit', '-m', 'branch commit', '--quiet']);

      pushNewVersion(`${baseTmp}/branch-switch-remote`, '1.2.0');

      const stateDir = join(baseTmp, 'branch-state');
      const homeDir = join(baseTmp, 'branch-home');
      mkdirSync(stateDir, { recursive: true });
      mkdirSync(homeDir, { recursive: true });
      result = runBin(UPDATE_RUN, [repo], {
        home: homeDir,
        gstackExtendDir: ROOT,
        gstackExtendStateDir: stateDir,
      });
    });

    test('warns about branch switch', () => {
      expect(result.stdout + result.stderr).toContain("switched from branch 'feature/test' to main");
    });

    test('upgrade succeeds after branch switch', () => {
      expect(result.stdout + result.stderr).toContain('UPGRADE_OK');
    });

    test('preserves feature branch (not destroyed)', () => {
      const r = spawnSync('git', ['-C', repo, 'branch', '--list', 'feature/test'], { encoding: 'utf8' });
      expect(r.stdout?.trim()).toContain('feature/test');
    });

    test('restores original branch after upgrade', () => {
      const r = spawnSync('git', ['-C', repo, 'branch', '--show-current'], { encoding: 'utf8' });
      expect(r.stdout?.trim()).toBe('feature/test');
    });
  });

  describe('dirty worktree + branch switch', () => {
    let repo: string;
    let result: ReturnType<typeof runBin>;

    beforeAll(() => {
      repo = createFixtureRepo('dirty');
      spawnSync('git', ['-C', repo, 'checkout', '-b', 'feature/dirty', '--quiet']);
      writeFileSync(join(repo, 'feature-file.txt'), 'committed work\n');
      spawnSync('git', ['-C', repo, 'add', 'feature-file.txt']);
      spawnSync('git', ['-C', repo, 'commit', '-m', 'feature commit', '--quiet']);
      writeFileSync(join(repo, 'VERSION'), 'uncommitted change\n');

      pushNewVersion(`${baseTmp}/dirty-remote`, '1.3.0');

      const stateDir = join(baseTmp, 'dirty-state');
      const homeDir = join(baseTmp, 'dirty-home');
      mkdirSync(stateDir, { recursive: true });
      mkdirSync(homeDir, { recursive: true });
      result = runBin(UPDATE_RUN, [repo], {
        home: homeDir,
        gstackExtendDir: ROOT,
        gstackExtendStateDir: stateDir,
      });
    });

    test('upgrade succeeds with dirty worktree', () => {
      expect(result.stdout + result.stderr).toContain('UPGRADE_OK');
    });

    test('restores feature branch after dirty-worktree upgrade', () => {
      const r = spawnSync('git', ['-C', repo, 'branch', '--show-current'], { encoding: 'utf8' });
      expect(r.stdout?.trim()).toBe('feature/dirty');
    });
  });

  describe('diverged main (ff-only failure)', () => {
    let repo: string;
    let result: ReturnType<typeof runBin>;

    beforeAll(() => {
      repo = createFixtureRepo('diverged');
      // Local-only commit on main.
      writeFileSync(join(repo, 'local-only.txt'), 'local-only change\n');
      spawnSync('git', ['-C', repo, 'add', 'local-only.txt']);
      spawnSync('git', ['-C', repo, 'commit', '-m', 'local diverge', '--quiet']);

      // Different commit on remote main.
      const work = `${baseTmp}/diverged-remote-work`;
      spawnSync('git', ['clone', '--quiet', `${baseTmp}/diverged-remote`, work]);
      writeFileSync(join(work, 'remote-only.txt'), 'remote\n');
      spawnSync('git', ['-C', work, 'add', 'remote-only.txt']);
      spawnSync('git', ['-C', work, 'commit', '-m', 'remote diverge', '--quiet']);
      spawnSync('git', ['-C', work, 'push', 'origin', 'main', '--quiet']);
      rmSync(work, { recursive: true, force: true });

      const stateDir = join(baseTmp, 'diverged-state');
      const homeDir = join(baseTmp, 'diverged-home');
      mkdirSync(stateDir, { recursive: true });
      mkdirSync(homeDir, { recursive: true });
      result = runBin(UPDATE_RUN, [repo], {
        home: homeDir,
        gstackExtendDir: ROOT,
        gstackExtendStateDir: stateDir,
      });
    });

    test('fails safely on diverged main', () => {
      expect(/UPGRADE_FAILED.*ff-only/.test(result.stdout + result.stderr)).toBe(true);
    });

    test('preserves local commits on failure', () => {
      const r = spawnSync('git', ['-C', repo, 'log', '--oneline', '-1'], { encoding: 'utf8' });
      expect(r.stdout).toContain('local diverge');
    });
  });
});

// ─── setup ───────────────────────────────────────────────────────────

function runSetup(args: string[], home: string): { stdout: string; stderr: string; exitCode: number | null } {
  // Scope env to PATH + HOME — same isolation discipline as runBin().
  // Prevents the developer's shell GSTACK_EXTEND_*/TMPDIR vars from leaking
  // into setup tests and shifting symlink targets to unexpected paths.
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: home,
  };
  if (process.env.TMPDIR !== undefined) env.TMPDIR = process.env.TMPDIR;
  const r = spawnSync(SETUP, args, { encoding: 'utf8', env });
  return {
    stdout: typeof r.stdout === 'string' ? r.stdout : '',
    stderr: typeof r.stderr === 'string' ? r.stderr : '',
    exitCode: r.status,
  };
}

// Helper for both update-check tests: copy the binary + its bash deps
// (semver lib, config) into a fixture repo so it can run standalone.
function seedUpdateCheckBinaries(repo: string): void {
  writeFileSync(join(repo, 'bin', 'update-check'), readFileSync(UPDATE_CHECK));
  chmodSync(join(repo, 'bin', 'update-check'), 0o755);
  mkdirSync(join(repo, 'bin', 'lib'), { recursive: true });
  writeFileSync(join(repo, 'bin', 'lib', 'semver.sh'), readFileSync(SEMVER_LIB));
  writeFileSync(join(repo, 'bin', 'config'), readFileSync(join(ROOT, 'bin', 'config')));
  chmodSync(join(repo, 'bin', 'config'), 0o755);
}

describe('setup default install', () => {
  let mockHome: string;
  let r: ReturnType<typeof runSetup>;

  beforeAll(() => {
    mockHome = join(baseTmp, 'setup-default-home');
    mkdirSync(mockHome, { recursive: true });
    r = runSetup([], mockHome);
  });

  test('installs 5 skills to default skills dir', () => {
    expect(r.stdout + r.stderr).toContain('Installed 5 skills');
  });

  for (const skill of ['pair-review', 'review-apparatus', 'test-plan']) {
    test(`creates ${skill} symlink to repo source`, () => {
      const link = join(mockHome, '.claude', 'skills', skill, 'SKILL.md');
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(readlinkSync(link)).toBe(join(ROOT, 'skills', `${skill}.md`));
    });
  }

  test('does NOT install browse-native (removed in v0.10.0)', () => {
    const link = join(mockHome, '.claude', 'skills', 'browse-native', 'SKILL.md');
    expect(existsSync(link)).toBe(false);
  });
});

describe('setup --with-native rejected', () => {
  test('rejects --with-native flag (removed in v0.10.0)', () => {
    const home = join(baseTmp, 'setup-native-home');
    mkdirSync(home, { recursive: true });
    const r = runSetup(['--with-native'], home);
    expect(r.stdout + r.stderr).toContain('Unknown option');
  });
});

describe('setup --uninstall', () => {
  let mockHome: string;
  let r: ReturnType<typeof runSetup>;

  beforeAll(() => {
    mockHome = join(baseTmp, 'setup-uninstall-home');
    mkdirSync(mockHome, { recursive: true });
    runSetup([], mockHome); // install first
    r = runSetup(['--uninstall'], mockHome);
  });

  test('uninstalls pair-review', () => {
    expect(r.stdout + r.stderr).toContain('Removed pair-review');
  });

  test('pair-review symlink removed after uninstall', () => {
    const link = join(mockHome, '.claude', 'skills', 'pair-review', 'SKILL.md');
    expect(existsSync(link)).toBe(false);
  });
});

describe('setup --uninstall preserves foreign browse-native symlink', () => {
  test('foreign symlink at known legacy path stays put', () => {
    const home = join(baseTmp, 'setup-legacy-home');
    mkdirSync(join(home, '.claude', 'skills', 'browse-native'), { recursive: true });
    const link = join(home, '.claude', 'skills', 'browse-native', 'SKILL.md');
    spawnSync('ln', ['-sf', '/nonexistent/elsewhere.md', link]);
    runSetup(['--uninstall'], home);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
  });
});

describe('setup unknown flag rejection', () => {
  test('rejects --bogus flag', () => {
    const home = join(baseTmp, 'setup-bogus-home');
    mkdirSync(home, { recursive: true });
    const r = runSetup(['--bogus'], home);
    expect(r.stdout + r.stderr).toContain('Unknown option');
    expect(existsSync(join(home, '.claude', 'skills', 'pair-review'))).toBe(false);
  });
});

describe('setup --skills-dir', () => {
  test('installs to custom dir + symlink targets repo source', () => {
    const home = join(baseTmp, 'sd-home1');
    mkdirSync(home, { recursive: true });
    const customDir = join(baseTmp, 'sd-custom');
    const r = runSetup(['--skills-dir', customDir], home);
    expect(/Installed [0-9]+ skills into /.test(r.stdout + r.stderr)).toBe(true);
    const link = join(customDir, 'pair-review', 'SKILL.md');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(join(ROOT, 'skills', 'pair-review.md'));
    // Default home untouched.
    expect(existsSync(join(home, '.claude', 'skills', 'pair-review'))).toBe(false);
  });

  test('rejects --skills-dir with no value', () => {
    const home = join(baseTmp, 'sd-home2');
    mkdirSync(home, { recursive: true });
    const r = runSetup(['--skills-dir'], home);
    expect(r.stdout + r.stderr).toContain('requires a path argument');
    expect(r.exitCode).not.toBe(0);
  });

  test('rejects --skills-dir followed by another flag', () => {
    const home = join(baseTmp, 'sd-home3');
    mkdirSync(home, { recursive: true });
    const r = runSetup(['--skills-dir', '--uninstall'], home);
    expect(r.stdout + r.stderr).toContain('requires a path argument');
  });

  test('rejects --skills-dir with relative path', () => {
    const home = join(baseTmp, 'sd-home4');
    mkdirSync(home, { recursive: true });
    const r = runSetup(['--skills-dir', 'relative/path'], home);
    expect(r.stdout + r.stderr).toContain('requires an absolute path');
  });

  test('--skills-dir != default prints known-limitation warning', () => {
    const home = join(baseTmp, 'sd-home5');
    mkdirSync(home, { recursive: true });
    const customDir = join(baseTmp, 'sd-warn-custom');
    const r = runSetup(['--skills-dir', customDir], home);
    expect(r.stdout + r.stderr).toContain('Skill preambles still hardcode');
  });

  test('default install does NOT print known-limitation warning', () => {
    const home = join(baseTmp, 'sd-home6');
    mkdirSync(home, { recursive: true });
    const r = runSetup([], home);
    expect(r.stdout + r.stderr).not.toContain('Skill preambles still hardcode');
  });

  test('--skills-dir + --uninstall removes from custom dir (5 skills)', () => {
    const home = join(baseTmp, 'sd-home7');
    mkdirSync(home, { recursive: true });
    const customDir = join(baseTmp, 'sd-uninstall-custom');
    runSetup(['--skills-dir', customDir], home);
    const r = runSetup(['--skills-dir', customDir, '--uninstall'], home);
    expect(r.stdout + r.stderr).toContain('Removed pair-review');
    expect(existsSync(join(customDir, 'pair-review', 'SKILL.md'))).toBe(false);
    const removedCount = (r.stdout.match(/^Removed /gm) ?? []).length;
    expect(removedCount).toBe(5);
  });

  test('--uninstall --skills-dir (reversed flag order) works', () => {
    const home = join(baseTmp, 'sd-home8');
    mkdirSync(home, { recursive: true });
    const customDir = join(baseTmp, 'sd-reversed-custom');
    runSetup(['--skills-dir', customDir], home);
    const r = runSetup(['--uninstall', '--skills-dir', customDir], home);
    expect(r.stdout + r.stderr).toContain('Removed pair-review');
  });

  test('--skills-dir handles paths with spaces', () => {
    const home = join(baseTmp, 'sd-home9');
    mkdirSync(home, { recursive: true });
    const customDir = join(baseTmp, 'with space', 'skills');
    const r = runSetup(['--skills-dir', customDir], home);
    expect(/Installed [0-9]+ skills into/.test(r.stdout + r.stderr)).toBe(true);
    expect(lstatSync(join(customDir, 'pair-review', 'SKILL.md')).isSymbolicLink()).toBe(true);
  });
});

// ─── semver (4-digit) — tests bin/lib/semver.sh via shell-out ───────
//
// The bash semver lib stays live until Track 2A cutover (consumed by bash
// bin/roadmap-audit). Independent TS coverage in tests/lib-semver.test.ts.

function bashVersionGt(a: string, b: string): boolean {
  // Pass values via positional args ($1, $2) so they can never be
  // shell-interpolated into the script body — defends against future
  // callers passing user-controlled values (e.g., remote VERSION strings).
  const script = 'source "$0"; if version_gt "$1" "$2"; then echo true; else echo false; fi';
  const r = spawnSync('bash', ['-c', script, SEMVER_LIB, a, b], { encoding: 'utf8' });
  return (r.stdout ?? '').trim() === 'true';
}

describe('semver (4-digit) via bin/lib/semver.sh', () => {
  test('0.8.9.1 > 0.8.9.0', () => {
    expect(bashVersionGt('0.8.9.1', '0.8.9.0')).toBe(true);
  });

  test('0.9.0 > 0.8.9.0', () => {
    expect(bashVersionGt('0.9.0', '0.8.9.0')).toBe(true);
  });

  test('0.8.9 == 0.8.9.0 (not greater)', () => {
    expect(bashVersionGt('0.8.9', '0.8.9.0')).toBe(false);
  });

  test('0.8.9.0 == 0.8.9 (not greater)', () => {
    expect(bashVersionGt('0.8.9.0', '0.8.9')).toBe(false);
  });

  test('0.8.9.0 < 0.8.9.1 (not greater)', () => {
    expect(bashVersionGt('0.8.9.0', '0.8.9.1')).toBe(false);
  });
});

// ─── update-check ───────────────────────────────────────────────────

const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?$/;

describe('update-check version regex', () => {
  for (const ver of ['0.8.9', '0.8.9.0', '1.0.0', '0.8.10', '10.20.30.40']) {
    test(`accepts valid version: ${ver}`, () => {
      expect(VERSION_RE.test(ver)).toBe(true);
    });
  }

  for (const ver of ['1..2', '1.2.', '1.2.3.4.5', '1', 'abc', '1.2', '.1.2.3', '1.2.3.', '1.2.3.4.5.6']) {
    test(`rejects invalid version: ${ver}`, () => {
      expect(VERSION_RE.test(ver)).toBe(false);
    });
  }
});

describe('update-check with 4-digit versions', () => {
  test('detects upgrade: 0.8.9.0 → 0.8.9.1', () => {
    const repo = createFixtureRepo('uc-fourseg');
    writeFileSync(join(repo, 'VERSION'), '0.8.9.0\n');
    spawnSync('git', ['-C', repo, 'add', 'VERSION']);
    spawnSync('git', ['-C', repo, 'commit', '-m', 'set 4-digit version', '--quiet']);

    seedUpdateCheckBinaries(repo);

    // Fake remote that serves a newer version.
    const remoteFile = join(baseTmp, 'uc-remote-fourseg');
    writeFileSync(remoteFile, '0.8.9.1\n');

    const stateDir = join(baseTmp, 'uc-fourseg-state');
    const homeDir = join(baseTmp, 'uc-fourseg-home');
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(homeDir, { recursive: true });

    const r = runBin(join(repo, 'bin', 'update-check'), ['--force'], {
      home: homeDir,
      gstackExtendDir: repo,
      gstackExtendStateDir: stateDir,
      extraEnv: {
        GSTACK_EXTEND_REMOTE_URL: `file://${remoteFile}`,
      },
    });
    expect(r.stdout + r.stderr).toContain('UPGRADE_AVAILABLE 0.8.9.0 0.8.9.1');
  });

  test('3-digit 0.8.9 treats 4-digit 0.8.9.0 remote as up-to-date', () => {
    const repo = createFixtureRepo('uc-mixed');
    writeFileSync(join(repo, 'VERSION'), '0.8.9\n');
    spawnSync('git', ['-C', repo, 'add', 'VERSION']);
    spawnSync('git', ['-C', repo, 'commit', '-m', 'set 3-digit version', '--quiet']);

    seedUpdateCheckBinaries(repo);

    const remoteFile = join(baseTmp, 'uc-mixed-remote-version');
    writeFileSync(remoteFile, '0.8.9.0\n');

    const stateDir = join(baseTmp, 'uc-mixed-state');
    const homeDir = join(baseTmp, 'uc-mixed-home');
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(homeDir, { recursive: true });

    const r = runBin(join(repo, 'bin', 'update-check'), ['--force'], {
      home: homeDir,
      gstackExtendDir: repo,
      gstackExtendStateDir: stateDir,
      extraEnv: {
        GSTACK_EXTEND_REMOTE_URL: `file://${remoteFile}`,
      },
    });
    expect(r.stdout.trim()).toBe('');
  });
});
