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
 *      foreign-symlink preserved, --bogus rejected, install-time safety
 *      (symlink at $target / regular file at $target / world-writable
 *      $SKILLS_DIR / outside-$HOME), --skills-dir arg validation,
 *      --skills-dir install path REJECTED (Track 5A), --skills-dir +
 *      --uninstall preserved (legacy v0.16.0 cleanup contract).
 *   3. semver (4-digit): version_gt for >, ==, <. Tests bin/lib/semver.sh
 *      via bash shell-out — the bash lib stays live until Track 2A cutover.
 *      Independent TS coverage in tests/lib-semver.test.ts.
 *   4. bin/update-check: version regex validation (5 valid + 9 invalid),
 *      4-digit upgrade detection, 3-digit ↔ 4-digit-with-.0 up-to-date.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { makeBaseTmp } from './helpers/fixture-repo.ts';
import { runBin } from './helpers/run-bin.ts';

const ROOT = join(import.meta.dir, '..');
const UPDATE_RUN = join(ROOT, 'bin', 'update-run');
const UPDATE_CHECK = join(ROOT, 'bin', 'update-check');
const SETUP = join(ROOT, 'setup');
const SEMVER_LIB = join(ROOT, 'bin', 'lib', 'semver.sh');
const INSTALL_SAFETY_LIB = join(ROOT, 'bin', 'lib', 'install-safety.sh');

// Mirrors the SKILLS array in setup. Hardcoded rather than parsed from
// setup itself so a malformed setup edit fails the test loudly instead of
// silently shrinking the symlink check.
const REAL_SETUP_SKILLS = [
  'pair-review',
  'roadmap',
  'full-review',
  'review-apparatus',
  'test-plan',
] as const;

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

// Variant of createFixtureRepo that swaps the echo-only stub setup for
// the REAL setup script + bin/lib/install-safety.sh + empty placeholder
// skills/*.md files. Used by the post-upgrade path-1 resolution test to
// exercise the setup-after-pull symlink rebuild. Kept separate from
// createFixtureRepo so the lighter scenarios (happy/branch-switch/dirty/
// diverged) don't suddenly depend on install-safety semantics and bun
// availability for their setup invocation.
function createFixtureRepoWithRealSetup(name: string): string {
  const dir = join(baseTmp, name);
  const remoteDir = join(baseTmp, `${name}-remote`);

  mkdirSync(remoteDir, { recursive: true });
  spawnSync('git', ['-C', remoteDir, 'init', '--bare', '--initial-branch=main', '--quiet']);

  mkdirSync(join(dir, 'bin', 'lib'), { recursive: true });
  mkdirSync(join(dir, 'skills'), { recursive: true });
  spawnSync('git', ['-C', dir, 'init', '--initial-branch=main', '--quiet']);
  spawnSync('git', ['-C', dir, 'remote', 'add', 'origin', remoteDir]);

  writeFileSync(join(dir, 'VERSION'), '1.0.0\n');

  // Real setup + its sourced dependency. setup checks for `bun` on PATH at
  // line 16 — the test process inherits the developer's PATH via runBin's
  // env scoping, so bun is available.
  writeFileSync(join(dir, 'setup'), readFileSync(SETUP));
  chmodSync(join(dir, 'setup'), 0o755);
  writeFileSync(join(dir, 'bin', 'lib', 'install-safety.sh'), readFileSync(INSTALL_SAFETY_LIB));

  // Real update-run.
  writeFileSync(join(dir, 'bin', 'update-run'), readFileSync(UPDATE_RUN));
  chmodSync(join(dir, 'bin', 'update-run'), 0o755);

  // Empty placeholder skill .md files — setup only needs `[ -f $src ]` to
  // pass before creating the symlink. Content is irrelevant; symlink
  // targets just have to exist.
  for (const skill of REAL_SETUP_SKILLS) {
    writeFileSync(join(dir, 'skills', `${skill}.md`), '');
  }

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
      // Pre-seed the two cache files update-run is expected to clear.
      // Without this pre-seeding the post-run existsSync(...).toBe(false)
      // assertions are vacuous — the files never existed to begin with.
      writeFileSync(join(stateDir, 'last-update-check'), 'UP_TO_DATE 1.0.0\n');
      writeFileSync(join(stateDir, 'update-snoozed'), '1.1.0 1 1700000000\n');
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

    test('clears last-update-check cache after upgrade', () => {
      expect(existsSync(join(stateDir, 'last-update-check'))).toBe(false);
    });

    test('clears update-snoozed after upgrade', () => {
      expect(existsSync(join(stateDir, 'update-snoozed'))).toBe(false);
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

  // ─── Track 6B: post-upgrade path-1 resolution (real-setup fixture) ──
  //
  // The four scenarios above use a stub setup (echo "setup ran"), so they
  // verify update-run's git mechanics but not the setup-after-pull seam.
  // This scenario uses createFixtureRepoWithRealSetup so the fixture's
  // setup actually rebuilds ~/.claude/skills/{name}/SKILL.md symlinks
  // pointing into the fixture's skills/ directory. After update-run
  // completes:
  //   1. UPGRADE_OK fires (sanity).
  //   2. The path-1 location holds a symlink (not a regular file/missing).
  //   3. readlinkSync resolves to fixture/skills/{name}.md (not ROOT — the
  //      test runs under a mock $HOME so a leak to the developer's real
  //      gstack-extend install would mis-resolve here).
  //   4. The skill-preamble readlink chain (`dirname dirname $_SKILL_SRC`)
  //      yields _EXTEND_ROOT = fixture root, matching the CP#3 contract.
  describe('post-upgrade path-1 resolution (Track 6B)', () => {
    let repo: string;
    let homeDir: string;
    let result: ReturnType<typeof runBin>;

    beforeAll(() => {
      repo = createFixtureRepoWithRealSetup('post-upgrade-path1');
      pushNewVersion(`${baseTmp}/post-upgrade-path1-remote`, '1.4.0');
      const stateDir = join(baseTmp, 'post-upgrade-path1-state');
      homeDir = join(baseTmp, 'post-upgrade-path1-home');
      mkdirSync(stateDir, { recursive: true });
      mkdirSync(homeDir, { recursive: true });
      result = runBin(UPDATE_RUN, [repo], {
        home: homeDir,
        gstackExtendDir: ROOT,
        gstackExtendStateDir: stateDir,
      });
    });

    test('upgrade succeeds with real setup invocation', () => {
      const out = result.stdout + result.stderr;
      expect(out).toContain('UPGRADE_OK 1.0.0 1.4.0');
      // Real setup announces its work; confirms it actually ran.
      expect(out).toContain('Installed 5 skills');
    });

    test('path-1 SKILL.md is a symlink under mock $HOME', () => {
      const link = join(homeDir, '.claude', 'skills', 'pair-review', 'SKILL.md');
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
    });

    test('path-1 symlink resolves into the fixture (not ROOT)', () => {
      const link = join(homeDir, '.claude', 'skills', 'pair-review', 'SKILL.md');
      // The symlink target MUST point into the fixture's skills/, proving
      // the fixture's setup ran. A target of `<ROOT>/skills/pair-review.md`
      // would mean the developer's real gstack-extend leaked in through an
      // unscoped env var — a serious test-isolation bug. realpathSync
      // canonicalizes both sides because macOS resolves /var → /private/var
      // (setup uses `pwd -P` at line 27 to capture SCRIPT_DIR).
      expect(realpathSync(readlinkSync(link))).toBe(
        realpathSync(join(repo, 'skills', 'pair-review.md')),
      );
    });

    test('CP#3 preamble probe resolves $_EXTEND_ROOT to fixture root', () => {
      // Mirrors the existing 'Track 5A skill preamble probe' shape: run
      // the same bash readlink-chain a skill preamble would, but AFTER
      // an update-run cycle instead of after a fresh setup.
      //
      // Env scoping is critical: spreading process.env would inherit the
      // developer's GSTACK_EXTEND_DIR/BASH_ENV/PWD into the probe and
      // defeat the test-isolation the assertions claim to enforce.
      // Both adversarial reviewers caught a prior version that did this.
      // cwd is pinned to homeDir for the same reason: the script's second
      // readlink falls back to `.claude/skills/pair-review/SKILL.md`
      // (path 2), and an unscoped cwd could find a stale workspace-local
      // .claude/ directory and silently satisfy the probe with the wrong
      // target. PATH is needed so `bash` can find `readlink` and `dirname`.
      const script = `
        set -u
        _SKILL_SRC=$(readlink ~/.claude/skills/pair-review/SKILL.md 2>/dev/null \\
                  || readlink .claude/skills/pair-review/SKILL.md 2>/dev/null)
        _EXTEND_ROOT=$(dirname "$(dirname "$_SKILL_SRC")" 2>/dev/null)
        printf '%s\\n' "$_EXTEND_ROOT"
      `;
      const r = spawnSync('bash', ['-c', script], {
        encoding: 'utf8',
        env: { HOME: homeDir, PATH: process.env.PATH ?? '/usr/bin:/bin' },
        cwd: homeDir,
      });
      // Guard against the failure mode where the probe exits 0 with empty
      // stdout (both readlinks failed but `_SKILL_SRC` is still defined
      // under `set -u` because command substitution succeeds even when
      // the command inside fails). Without this, `realpathSync('')` would
      // resolve to cwd and the test would pass for the wrong reason.
      expect(r.status).toBe(0);
      const probeOut = (r.stdout ?? '').trim();
      expect(probeOut).not.toBe('');
      expect(probeOut).not.toBe('.');
      // Canonicalize both sides: setup's pwd -P resolves /var → /private/var
      // on macOS, so the bash probe yields the realpath form.
      expect(realpathSync(probeOut)).toBe(realpathSync(repo));
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

// ─── --skills-dir is now uninstall-only ──────────────────────────────
//
// Track 5A retired --skills-dir as an install path: skill preambles only
// probe ~/.claude/skills/{name}/ and .claude/skills/{name}/, so symlinks
// at custom paths are never discovered. The flag is preserved ONLY when
// paired with --uninstall, as a one-way escape hatch for cleaning up
// v0.16.0-era installs (codex T1 catch, D12).
//
// The contract-preservation tests below seed the custom-install layout
// directly via fs APIs (mkdirSync + symlinkSync) instead of running the
// retired install path. They still assert the same uninstall contract.

describe('setup --skills-dir (arg validation, applies to uninstall path)', () => {
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
    const r = runSetup(['--skills-dir', 'relative/path', '--uninstall'], home);
    expect(r.stdout + r.stderr).toContain('requires an absolute path');
  });
});

describe('setup --skills-dir for install path is rejected (Track 5A retirement)', () => {
  test('--skills-dir without --uninstall exits 1 with migration message', () => {
    const home = join(baseTmp, 'sd-reject-home');
    mkdirSync(home, { recursive: true });
    const customDir = join(baseTmp, 'sd-reject-custom');
    const r = runSetup(['--skills-dir', customDir], home);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('--skills-dir is no longer accepted for install');
    expect(r.stderr).toContain('--uninstall');
    // No symlinks should have been created.
    expect(existsSync(join(customDir, 'pair-review'))).toBe(false);
  });
});

// Manually seed a v0.16.0-era custom install layout: 5 skill dirs, each
// with SKILL.md as a symlink to the corresponding skills/{name}.md in
// the gstack-extend repo. Mirrors what setup --skills-dir <path> would
// have produced before Track 5A.
function seedCustomInstall(customDir: string): void {
  for (const skill of ['pair-review', 'roadmap', 'full-review', 'review-apparatus', 'test-plan']) {
    const target = join(customDir, skill);
    mkdirSync(target, { recursive: true });
    symlinkSync(join(ROOT, 'skills', `${skill}.md`), join(target, 'SKILL.md'));
  }
}

describe('setup --skills-dir + --uninstall (legacy v0.16.0 cleanup path)', () => {
  test('--skills-dir + --uninstall removes from custom dir (5 skills)', () => {
    const home = join(baseTmp, 'sd-home7');
    mkdirSync(home, { recursive: true });
    const customDir = join(baseTmp, 'sd-uninstall-custom');
    seedCustomInstall(customDir);
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
    seedCustomInstall(customDir);
    const r = runSetup(['--uninstall', '--skills-dir', customDir], home);
    expect(r.stdout + r.stderr).toContain('Removed pair-review');
  });

  test('--skills-dir + --uninstall handles paths with spaces', () => {
    const home = join(baseTmp, 'sd-home9');
    mkdirSync(home, { recursive: true });
    const customDir = join(baseTmp, 'with space', 'skills');
    seedCustomInstall(customDir);
    const r = runSetup(['--skills-dir', customDir, '--uninstall'], home);
    expect(r.stdout + r.stderr).toContain('Removed pair-review');
  });
});

// ─── Track 5A: install-time safety hardening (D6 expanded coverage) ──
//
// Codex round 2 (E2): the eng-review test seam ("happy path only +
// simulated ownership") missed bugs likely to ship. These integration
// tests exercise real fs reject paths that don't need sudo:
//   - $SKILLS_DIR is world-writable (chmod 0777)
//   - $SKILLS_DIR is a symlink to OUTSIDE the resolved $HOME
//   - per-skill $target is a symlink (T4 + Z layered hardening)
//   - per-skill $target exists as a regular file (FIFO, char-device too)
//   - $SKILLS_DIR is a user-owned symlink to an in-$HOME target (legit
//     dotfiles/sync pattern; MUST succeed)

describe('setup install-time safety: $SKILLS_DIR layer', () => {
  test('refuses install if $SKILLS_DIR resolves outside $HOME', () => {
    const home = join(baseTmp, 'safety-outside-home');
    mkdirSync(join(home, '.claude'), { recursive: true });
    // Symlink ~/.claude/skills -> a path outside $HOME (under baseTmp/...
    // which sits at /private/tmp on macOS, NOT inside our fake $HOME).
    const targetOutsideHome = join(baseTmp, 'safety-outside-target');
    mkdirSync(targetOutsideHome);
    symlinkSync(targetOutsideHome, join(home, '.claude', 'skills'));
    const r = runSetup([], home);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('outside resolved $HOME');
  });

  test('refuses install if $SKILLS_DIR resolves to a world-writable dir', () => {
    const home = join(baseTmp, 'safety-ww-home');
    const skillsDir = join(home, '.claude', 'skills');
    mkdirSync(skillsDir, { recursive: true });
    chmodSync(skillsDir, 0o777);
    const r = runSetup([], home);
    // Restore mode for cleanup safety.
    try {
      chmodSync(skillsDir, 0o755);
    } catch {}
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('world-writable');
  });

  test('accepts install when $SKILLS_DIR is a user-owned symlink to in-$HOME target (legit dotfiles)', () => {
    const home = join(baseTmp, 'safety-dotfiles-home');
    const dotfilesDir = join(home, 'dotfiles', 'claude-skills');
    mkdirSync(dotfilesDir, { recursive: true });
    mkdirSync(join(home, '.claude'), { recursive: true });
    symlinkSync(dotfilesDir, join(home, '.claude', 'skills'));
    const r = runSetup([], home);
    expect(r.stdout + r.stderr).toContain('Installed 5 skills');
    // Symlinks landed inside the dotfiles dir (the resolved target).
    expect(lstatSync(join(dotfilesDir, 'pair-review', 'SKILL.md')).isSymbolicLink()).toBe(true);
  });
});

describe('setup install-time safety: per-$target layer', () => {
  test('refuses install if $target is a symlink', () => {
    const home = join(baseTmp, 'safety-target-symlink-home');
    mkdirSync(join(home, '.claude', 'skills'), { recursive: true });
    // Plant a symlink at one of the to-be-installed targets.
    symlinkSync('/nonexistent-elsewhere', join(home, '.claude', 'skills', 'pair-review'));
    const r = runSetup([], home);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('symlink');
    // Preflight refusal — no other skills should be installed either.
    expect(existsSync(join(home, '.claude', 'skills', 'roadmap', 'SKILL.md'))).toBe(false);
  });

  test('refuses install if $target is a regular file', () => {
    const home = join(baseTmp, 'safety-target-file-home');
    mkdirSync(join(home, '.claude', 'skills'), { recursive: true });
    writeFileSync(join(home, '.claude', 'skills', 'pair-review'), 'not a directory');
    const r = runSetup([], home);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('not a directory');
    expect(existsSync(join(home, '.claude', 'skills', 'roadmap', 'SKILL.md'))).toBe(false);
  });

  test('LEGACY_SKILLS (browse-native) iteration also gets symlink check', () => {
    const home = join(baseTmp, 'safety-legacy-symlink-home');
    mkdirSync(join(home, '.claude', 'skills'), { recursive: true });
    // Plant a SYMLINK at the legacy browse-native target (where v0.10.0
    // would have installed before removal). Uninstall must visibly skip.
    symlinkSync('/elsewhere', join(home, '.claude', 'skills', 'browse-native'));
    const r = runSetup(['--uninstall'], home);
    // Uninstall should succeed for non-existent SKILLS targets (none
    // installed in this fixture) and visibly skip the symlinked legacy.
    expect(r.exitCode).toBe(0);
    expect(r.stdout + r.stderr).toContain('browse-native');
    expect(r.stdout + r.stderr).toContain('symlink');
    // The symlink is preserved (we don't operate on attacker-controlled paths).
    expect(lstatSync(join(home, '.claude', 'skills', 'browse-native')).isSymbolicLink()).toBe(true);
  });

  test('refuses uninstall pass to operate on a symlinked $target', () => {
    const home = join(baseTmp, 'safety-uninstall-symlink-home');
    mkdirSync(join(home, '.claude', 'skills'), { recursive: true });
    // Install normally first.
    runSetup([], home);
    // Now replace one $target with a symlink.
    rmSync(join(home, '.claude', 'skills', 'pair-review'), { recursive: true });
    symlinkSync('/elsewhere', join(home, '.claude', 'skills', 'pair-review'));
    const r = runSetup(['--uninstall'], home);
    // Uninstall continues for other skills but skips the symlinked one.
    expect(r.stdout + r.stderr).toContain('symlink');
    expect(lstatSync(join(home, '.claude', 'skills', 'pair-review')).isSymbolicLink()).toBe(true);
  });
});

// ─── Track 5A: skill preamble two-path probe (CP#3 integration) ──────
//
// Default install creates symlinks at ~/.claude/skills/{name}/SKILL.md
// (path 1). Vendored install drops symlinks at .claude/skills/{name}/
// SKILL.md inside the project root (path 2). Both forms must let a skill
// preamble resolve $_EXTEND_ROOT correctly via the readlink chain
// `_SKILL_SRC=$(readlink path1 || readlink path2)` then
// `_EXTEND_ROOT=$(dirname dirname $_SKILL_SRC)`.

describe('Track 5A skill preamble probe (CP#3 integration)', () => {
  // Run the real preamble probe block from skills/pair-review.md against
  // a controlled fixture and verify $_EXTEND_ROOT resolves correctly.
  function runPreambleProbe(home: string, vendoredDir: string | null): {
    extendRoot: string;
    exitCode: number | null;
  } {
    const script = `
      set -u
      cd "$1"
      _SKILL_SRC=$(readlink ~/.claude/skills/pair-review/SKILL.md 2>/dev/null \\
                || readlink .claude/skills/pair-review/SKILL.md 2>/dev/null)
      _EXTEND_ROOT=$(dirname "$(dirname "$_SKILL_SRC")" 2>/dev/null)
      printf '%s\\n' "$_EXTEND_ROOT"
    `;
    const cwd = vendoredDir ?? home;
    const r = spawnSync('bash', ['-c', script, 'preamble-probe', cwd], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home },
    });
    return {
      extendRoot: (r.stdout ?? '').trim(),
      exitCode: r.status,
    };
  }

  test('default install: path 1 resolves $_EXTEND_ROOT to repo source', () => {
    const home = join(baseTmp, 'cp3-default-home');
    mkdirSync(home, { recursive: true });
    const setupResult = runSetup([], home);
    expect(setupResult.stdout + setupResult.stderr).toContain('Installed 5 skills');
    const probe = runPreambleProbe(home, null);
    expect(probe.extendRoot).toBe(ROOT);
  });

  test('vendored install: path 2 fallthrough resolves $_EXTEND_ROOT', () => {
    // Default install absent (fresh $HOME); vendored install at
    // <projectRoot>/.claude/skills/{name}/SKILL.md.
    const home = join(baseTmp, 'cp3-vendored-home');
    mkdirSync(home, { recursive: true });
    const projectRoot = join(baseTmp, 'cp3-vendored-project');
    mkdirSync(join(projectRoot, '.claude', 'skills', 'pair-review'), { recursive: true });
    symlinkSync(
      join(ROOT, 'skills', 'pair-review.md'),
      join(projectRoot, '.claude', 'skills', 'pair-review', 'SKILL.md'),
    );
    const probe = runPreambleProbe(home, projectRoot);
    expect(probe.extendRoot).toBe(ROOT);
  });

  test('truly-broken install: both probes empty, $_EXTEND_ROOT empty (silent no-op per D10)', () => {
    const home = join(baseTmp, 'cp3-broken-home');
    mkdirSync(home, { recursive: true });
    const projectRoot = join(baseTmp, 'cp3-broken-project');
    mkdirSync(projectRoot, { recursive: true });
    const probe = runPreambleProbe(home, projectRoot);
    // dirname dirname "" yields "." — _EXTEND_ROOT is "." and the
    // subsequent [ -x "$_EXTEND_ROOT/bin/update-check" ] check fails
    // silently, matching D10 semantics.
    expect(probe.extendRoot).toBe('.');
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
