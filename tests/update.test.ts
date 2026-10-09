/**
 * update.test.ts — tests for bin/update-run, setup, semver, bin/update-check.
 *
 * Migrated from scripts/test-update.sh (deleted in Track 3A).
 *
 * Four scenario clusters:
 *   1. bin/update-run: missing-arg, not-git-repo, happy-path on main,
 *      non-main-branch auto-switch + restore, dirty-worktree + branch-switch,
 *      diverged-main ff-only failure.
 *   2. setup: default install (every SKILLS entry), --with-native rejected, --uninstall,
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
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  statSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { makeBaseTmp } from './helpers/fixture-repo.ts';
import { runBin } from './helpers/run-bin.ts';
import {
  MARKER_LINE,
  extractPreambleFence,
  hostDir,
  resolverProbeScript,
  runShell,
  scopedEnv,
  strictShells,
  writePointer,
  writeUpdateCheck,
} from './helpers/extend-root.ts';
import { EXPECTED_SETUP_SKILLS as REAL_SETUP_SKILLS } from './helpers/expected-setup-skills.ts';

const ROOT = join(import.meta.dir, '..');
const UPDATE_RUN = join(ROOT, 'bin', 'update-run');
const UPDATE_CHECK = join(ROOT, 'bin', 'update-check');
const SETUP = join(ROOT, 'setup');
const SEMVER_LIB = join(ROOT, 'bin', 'lib', 'semver.sh');
const RUN_MIGRATIONS = join(ROOT, 'bin', 'lib', 'run-migrations.sh');
const INSTALL_SAFETY_LIB = join(ROOT, 'bin', 'lib', 'install-safety.sh');

const baseTmp = makeBaseTmp('update-test-');
afterAll(() => {
  try { rmSync(baseTmp, { recursive: true, force: true }); } catch {}
});

// update-run runs `setup --host auto`. A fake `claude` keeps the Claude assertions
// independent of which agent CLIs (for example `cursor` alone) the developer has on PATH.
const CLAUDE_PATH = (() => {
  const dir = join(baseTmp, 'claude-bin');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'claude'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(dir, 'claude'), 0o755);
  return `${dir}:${process.env.PATH ?? '/usr/bin:/bin'}`;
})();

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
function createFixtureRepoWithRealSetup(
  name: string,
  opts: { skills?: readonly string[]; setupText?: string; beforeCommit?: (dir: string) => void } = {},
): string {
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
  writeFileSync(join(dir, 'setup'), opts.setupText ?? readFileSync(SETUP, 'utf8'));
  chmodSync(join(dir, 'setup'), 0o755);
  writeFileSync(join(dir, 'bin', 'lib', 'install-safety.sh'), readFileSync(INSTALL_SAFETY_LIB));

  // Real update-run.
  writeFileSync(join(dir, 'bin', 'update-run'), readFileSync(UPDATE_RUN));
  chmodSync(join(dir, 'bin', 'update-run'), 0o755);

  // Empty placeholder skill .md files — setup only needs `[ -f $src ]` to
  // pass before creating the symlink. Content is irrelevant; symlink
  // targets just have to exist.
  for (const skill of opts.skills ?? REAL_SETUP_SKILLS) {
    writeFileSync(join(dir, 'skills', `${skill}.md`), '');
  }

  opts.beforeCommit?.(dir);

  spawnSync('git', ['-C', dir, 'add', '-A']);
  spawnSync('git', ['-C', dir, 'commit', '-m', 'initial', '--quiet']);
  spawnSync('git', ['-C', dir, 'push', 'origin', 'main', '--quiet']);
  return dir;
}

function pushNewVersion(
  remoteDir: string,
  version: string,
  extraFiles?: Record<string, string>,
): void {
  const work = `${remoteDir}-work`;
  spawnSync('git', ['clone', '--quiet', remoteDir, work]);
  writeFileSync(join(work, 'VERSION'), `${version}\n`);
  spawnSync('git', ['-C', work, 'add', 'VERSION']);
  if (extraFiles) {
    for (const [rel, content] of Object.entries(extraFiles)) {
      const dest = join(work, rel);
      mkdirSync(dirname(dest), { recursive: true });
      let mode: number | undefined;
      try { mode = statSync(dest).mode; } catch { mode = undefined; }
      writeFileSync(dest, content);
      if (mode !== undefined) chmodSync(dest, mode & 0o777);
      spawnSync('git', ['-C', work, 'add', rel]);
    }
  }
  spawnSync('git', ['-C', work, 'commit', '-m', `bump to ${version}`, '--quiet']);
  spawnSync('git', ['-C', work, 'push', 'origin', 'main', '--quiet']);
  rmSync(work, { recursive: true, force: true });
}

function migrationPayload(scripts: Record<string, string>): Record<string, string> {
  const files: Record<string, string> = {
    'bin/lib/semver.sh': readFileSync(SEMVER_LIB, 'utf8'),
    'bin/lib/run-migrations.sh': readFileSync(RUN_MIGRATIONS, 'utf8'),
  };
  for (const [name, body] of Object.entries(scripts)) {
    files[`migrations/${name}`] = body;
  }
  return files;
}

// ─── bin/update-run ─────────────────────────────────────────────────

describe('bin/update-run', () => {
  test('forwards real setup skipped hosts alongside checkout upgrade success', () => {
    // bin/update-check makes the pair-review link setup-owned, so a copy pass
    // that failed to skip the shared directory would replace it with a file.
    const repo = createFixtureRepoWithRealSetup('skipped-hosts', {
      beforeCommit(dir) {
        writeFileSync(join(dir, 'bin', 'update-check'), '#!/usr/bin/env bash\n');
        chmodSync(join(dir, 'bin', 'update-check'), 0o755);
      },
    });
    pushNewVersion(`${baseTmp}/skipped-hosts-remote`, '1.1.0');
    const home = join(baseTmp, 'skipped-hosts-home');
    const claude = hostDir(home, 'claude', '');
    mkdirSync(join(claude, 'pair-review'), { recursive: true });
    symlinkSync(join(repo, 'skills', 'pair-review.md'), join(claude, 'pair-review', 'SKILL.md'));
    const custom = join(claude, 'implement');
    mkdirSync(custom);
    writeFileSync(join(custom, 'SKILL.md'), 'CUSTOMIZED\n');
    writeFileSync(join(custom, '.extend-root'), `${repo}\n`);
    for (const host of ['codex', 'opencode', 'cursor'] as const) {
      const root = hostDir(home, host, '');
      mkdirSync(dirname(root), { recursive: true });
      symlinkSync(claude, root);
    }
    const result = runBin(UPDATE_RUN, [repo], {
      home, gstackExtendDir: repo, gstackExtendStateDir: join(baseTmp, 'skipped-hosts-state'),
    });
    expect(result.exitCode).toBe(0);
    // Cursor yields to Claude, which this run refreshed; the copy hosts stay stale.
    expect(result.stdout.match(/^SETUP_SKIPPED_HOSTS .+$/gm)).toEqual([
      'SETUP_SKIPPED_HOSTS codex,opencode',
    ]);
    expect(result.stdout).toContain('UPGRADE_OK 1.0.0 1.1.0');
    expect(result.stderr).toContain('Shared-directory migration');
    expect(lstatSync(join(claude, 'pair-review', 'SKILL.md')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(custom, 'SKILL.md'), 'utf8')).toBe('CUSTOMIZED\n');
  });

  test('forwards setup skipped hosts when setup fails and still emits one failure result', () => {
    const repo = createFixtureRepo('skipped-hosts-failure');
    pushNewVersion(`${baseTmp}/skipped-hosts-failure-remote`, '1.1.0', {
      setup: '#!/usr/bin/env bash\necho "SETUP_SKIPPED_HOSTS codex"\nexit 1\n',
    });
    const home = join(baseTmp, 'skipped-hosts-failure-home');
    mkdirSync(home, { recursive: true });
    const result = runBin(UPDATE_RUN, [repo], {
      home, gstackExtendDir: repo, gstackExtendStateDir: join(baseTmp, 'skipped-hosts-failure-state'),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('SETUP_SKIPPED_HOSTS codex\n');
    expect(result.stdout.match(/^UPGRADE_FAILED .+$/gm)).toHaveLength(1);
    expect(result.stdout).toContain('UPGRADE_FAILED stage=setup');
    expect(result.stdout).not.toContain('UPGRADE_OK');
  });

  // Auto-upgrades run the shared block from every preamble, so it must report skipped hosts itself.
  test('the shared upgrade flow reports skipped hosts; the upgrade skill adds recovery', () => {
    const skill = readFileSync(join(ROOT, 'skills', 'gstack-extend-upgrade.md'), 'utf8');
    const shared = skill.split('<!-- SHARED:upgrade-flow -->')[1]!.split('<!-- /SHARED:upgrade-flow -->')[0]!;
    expect(shared).toContain('`SETUP_SKIPPED_HOSTS <csv>` line, whatever the result, name each listed host');
    expect(shared).toContain('Shared-directory migration');
    expect(shared).toContain('Never say every host was refreshed.');
    const after = skill.split('## After upgrading')[1]!;
    expect(after).toContain('`SETUP_SKIPPED_HOSTS <csv>`');
    expect(after).toContain('`"<root>/setup" --host auto`');
    expect(after).toContain('After `UPGRADE_FAILED stage=setup`, tell');
    expect(after).toContain('`"<root>/bin/update-run" "<root>"`');
  });

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

    test('does not emit UPGRADE_FAILED on success', () => {
      // EXIT trap (Track 10A) must stay silent on a clean exit 0 — a
      // spurious UPGRADE_FAILED after UPGRADE_OK is the false-failure bug.
      expect(result.stdout + result.stderr).not.toContain('UPGRADE_FAILED');
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

    test('emits exactly one UPGRADE_FAILED and no UPGRADE_OK', () => {
      // The ff-only path emits its own explicit UPGRADE_FAILED; the EXIT
      // trap's _RESULT_EMITTED guard (Track 10A) must NOT double-emit.
      const out = result.stdout + result.stderr;
      expect((out.match(/UPGRADE_FAILED/g) ?? []).length).toBe(1);
      expect(out).not.toContain('UPGRADE_OK');
    });
  });

  // ─── Track 6B: post-upgrade path-1 resolution (real-setup fixture) ──
  //
  // The four scenarios above use a stub setup (echo "setup ran"), so they
  // verify update-run's git mechanics but not the setup-after-pull seam.
  // The path every existing install takes to receive a skill added in a
  // later release: the fixture starts with setup's SKILLS array without
  // implement, the pushed version adds that skill file plus the current
  // setup, and update-run's setup-after-pull
  // must link the new skill without disturbing the old ones.
  describe('post-upgrade install of a newly registered skill', () => {
    const NEW_SKILL = 'implement';
    const oldSkills = REAL_SETUP_SKILLS.filter((s) => s !== NEW_SKILL);
    let repo: string;
    let homeDir: string;
    let preOut = '';
    let linkedBeforeUpgrade = true;
    let result: ReturnType<typeof runBin>;

    beforeAll(() => {
      const realSetup = readFileSync(SETUP, 'utf8');
      const oldSetup = realSetup.replace(new RegExp(`^  ${NEW_SKILL}\\n`, 'm'), '');
      if (oldSetup === realSetup) {
        throw new Error(`fixture: could not remove ${NEW_SKILL} from setup SKILLS`);
      }
      repo = createFixtureRepoWithRealSetup('upgrade-new-skill', {
        skills: oldSkills,
        setupText: oldSetup,
      });
      const stateDir = join(baseTmp, 'upgrade-new-skill-state');
      homeDir = join(baseTmp, 'upgrade-new-skill-home');
      mkdirSync(stateDir, { recursive: true });
      mkdirSync(homeDir, { recursive: true });

      // Existing install: the old setup links only the pre-existing skills.
      const env: Record<string, string> = {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: homeDir,
      };
      if (process.env.TMPDIR !== undefined) env.TMPDIR = process.env.TMPDIR;
      const pre = spawnSync(join(repo, 'setup'), [], { encoding: 'utf8', env });
      preOut = (pre.stdout ?? '') + (pre.stderr ?? '');
      if (pre.status !== 0) {
        throw new Error(`fixture: pre-upgrade setup failed: ${preOut}`);
      }
      linkedBeforeUpgrade = existsSync(join(homeDir, '.claude', 'skills', NEW_SKILL, 'SKILL.md'));

      pushNewVersion(`${baseTmp}/upgrade-new-skill-remote`, '1.4.0', {
        setup: realSetup,
        [`skills/${NEW_SKILL}.md`]: '',
      });
      result = runBin(UPDATE_RUN, [repo], {
        home: homeDir,
        gstackExtendDir: ROOT,
        gstackExtendStateDir: stateDir,
        extraEnv: { PATH: CLAUDE_PATH },
      });
    });

    test('pre-upgrade install linked only the pre-existing skills', () => {
      expect(preOut).toContain(`Installed ${oldSkills.length} skills`);
      expect(linkedBeforeUpgrade).toBe(false);
    });

    test('upgrade succeeds with the new setup', () => {
      expect(result.stdout + result.stderr).toContain('UPGRADE_OK 1.0.0 1.4.0');
    });

    test('new skill is linked into the fixture after update-run', () => {
      const link = join(homeDir, '.claude', 'skills', NEW_SKILL, 'SKILL.md');
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(realpathSync(readlinkSync(link))).toBe(
        realpathSync(join(repo, 'skills', `${NEW_SKILL}.md`)),
      );
    });

    for (const skill of oldSkills) {
      test(`${skill} stays linked into the fixture after update-run`, () => {
        const link = join(homeDir, '.claude', 'skills', skill, 'SKILL.md');
        expect(lstatSync(link).isSymbolicLink()).toBe(true);
        expect(realpathSync(readlinkSync(link))).toBe(
          realpathSync(join(repo, 'skills', `${skill}.md`)),
        );
      });
    }
  });

  // This scenario uses createFixtureRepoWithRealSetup so the fixture's
  // setup actually rebuilds ~/.claude/skills/{name}/SKILL.md symlinks
  // pointing into the fixture's skills/ directory. After update-run
  // completes:
  //   1. UPGRADE_OK fires (sanity).
  //   2. The path-1 location holds a symlink (not a regular file/missing).
  //   3. readlinkSync resolves to fixture/skills/{name}.md (not ROOT — the
  //      test runs under a mock $HOME so a leak to the developer's real
  //      gstack-extend install would mis-resolve here).
  //   4. The extracted extend-root resolver span yields _EXTEND_ROOT =
  //      fixture root, matching the CP#3 contract.
  describe('post-upgrade path-1 resolution (Track 6B)', () => {
    let repo: string;
    let homeDir: string;
    let result: ReturnType<typeof runBin>;
    let beforeMarker: ReturnType<typeof probeExtendRoot>;

    beforeAll(() => {
      repo = createFixtureRepoWithRealSetup('post-upgrade-path1', {
        beforeCommit(dir) {
          const bin = join(dir, 'bin', 'update-check');
          writeFileSync(bin, '#!/usr/bin/env bash\necho old-update-check\n');
          chmodSync(bin, 0o755);
        },
      });
      const preHome = join(baseTmp, 'post-upgrade-path1-pre-home');
      writePointer(preHome, 'claude', 'gstack-extend-upgrade', repo);
      writeFileSync(join(hostDir(preHome, 'claude', 'gstack-extend-upgrade'), 'SKILL.md'), 'copy\n');
      beforeMarker = probeExtendRoot(preHome, preHome);
      pushNewVersion(`${baseTmp}/post-upgrade-path1-remote`, '1.4.0', {
        'bin/update-check': readFileSync(UPDATE_CHECK, 'utf8'),
      });
      const stateDir = join(baseTmp, 'post-upgrade-path1-state');
      homeDir = join(baseTmp, 'post-upgrade-path1-home');
      mkdirSync(stateDir, { recursive: true });
      mkdirSync(homeDir, { recursive: true });
      result = runBin(UPDATE_RUN, [repo], {
        home: homeDir,
        gstackExtendDir: ROOT,
        gstackExtendStateDir: stateDir,
        extraEnv: { PATH: CLAUDE_PATH },
      });
    });

    test('upgrade succeeds with real setup invocation', () => {
      const out = result.stdout + result.stderr;
      expect(out).toContain('UPGRADE_OK 1.0.0 1.4.0');
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

    test('start state is unverified because the marker is missing', () => {
      expect(beforeMarker.length).toBeGreaterThan(0);
      for (const r of beforeMarker) {
        expect(r.stderr).toBe('');
        expect(r.status).toBe(0);
        expect(r.root).toBe('');
        expect(r.unverified).toContain("lacks the line '# extend-root-protocol: v1'");
      }
    });

    test('CP#3 preamble probe resolves $_EXTEND_ROOT to fixture root', () => {
      // After update-run, setup has rebuilt the Claude symlink. The
      // extracted resolver (not a hand-copied readlink chain) must
      // resolve the fixture root. Env is HOME and PATH only, and cwd is
      // the mock home, so a workspace-local .claude/ cannot satisfy it.
      const after = probeExtendRoot(homeDir, homeDir);
      for (const r of after) {
        expect(r.stderr).toBe('');
        expect(r.status).toBe(0);
        expect(r.root).not.toBe('');
        expect(r.root).not.toBe('.');
        expect(realpathSync(r.root)).toBe(realpathSync(repo));
      }
    });
  });

  // ─── Track 10A: EXIT trap on mid-run stage failure ─────────────────
  //
  // The scenarios above exercise update-run's explicit exit paths. This
  // one kills a stage mid-run AFTER the branch switch — a failing `setup`
  // pulled from the remote dies at `_STAGE=setup` under `set -e`, by which
  // point update-run has already moved feature/trap → main. That is the
  // only failure point that exercises REAL branch restoration: a fetch- or
  // stash-stage failure would never have left feature/trap to begin with.
  // Asserts the EXIT trap: emits exactly one UPGRADE_FAILED naming the
  // failed stage, restores the original branch, pops the stash, and leaves
  // no success side effects behind.
  describe('EXIT trap on mid-run stage failure (Track 10A)', () => {
    let repo: string;
    let stateDir: string;
    let result: ReturnType<typeof runBin>;

    beforeAll(() => {
      repo = createFixtureRepo('trap-setup-fail');
      spawnSync('git', ['-C', repo, 'checkout', '-b', 'feature/trap', '--quiet']);
      writeFileSync(join(repo, 'trap-file.txt'), 'committed\n');
      spawnSync('git', ['-C', repo, 'add', 'trap-file.txt']);
      spawnSync('git', ['-C', repo, 'commit', '-m', 'trap commit', '--quiet']);
      // Dirty a tracked file so update-run stashes — lets us assert the
      // trap pops the stash back after restoring the branch.
      writeFileSync(join(repo, 'VERSION'), '9.9.9-dirty\n');
      // Push a failing `setup` to the remote so `git pull --ff-only` brings
      // it in and `_STAGE=setup` dies AFTER checkout-main.
      const work = `${baseTmp}/trap-setup-fail-remote-work`;
      spawnSync('git', ['clone', '--quiet', `${baseTmp}/trap-setup-fail-remote`, work]);
      writeFileSync(join(work, 'setup'), '#!/usr/bin/env bash\nexit 1\n');
      spawnSync('git', ['-C', work, 'add', 'setup']);
      spawnSync('git', ['-C', work, 'commit', '-m', 'failing setup', '--quiet']);
      spawnSync('git', ['-C', work, 'push', 'origin', 'main', '--quiet']);
      rmSync(work, { recursive: true, force: true });

      stateDir = join(baseTmp, 'trap-setup-fail-state');
      const homeDir = join(baseTmp, 'trap-setup-fail-home');
      mkdirSync(stateDir, { recursive: true });
      mkdirSync(homeDir, { recursive: true });
      result = runBin(UPDATE_RUN, [repo], {
        home: homeDir,
        gstackExtendDir: ROOT,
        gstackExtendStateDir: stateDir,
      });
    });

    test('trap emits UPGRADE_FAILED naming the failed stage', () => {
      expect(result.stdout + result.stderr).toContain('UPGRADE_FAILED stage=setup');
    });

    test('trap emits exactly one result line, no UPGRADE_OK', () => {
      const out = result.stdout + result.stderr;
      expect((out.match(/UPGRADE_FAILED/g) ?? []).length).toBe(1);
      expect(out).not.toContain('UPGRADE_OK');
    });

    test('trap restores the original branch (post-checkout-main failure)', () => {
      // update-run reached _STAGE=setup, so it had already switched
      // feature/trap → main. A passing assertion here means the trap
      // actually checked the branch back out.
      const r = spawnSync('git', ['-C', repo, 'branch', '--show-current'], { encoding: 'utf8' });
      expect(r.stdout?.trim()).toBe('feature/trap');
    });

    test('trap pops the stash (dirty change restored)', () => {
      expect(readFileSync(join(repo, 'VERSION'), 'utf8').trim()).toBe('9.9.9-dirty');
    });

    test('no just-upgraded-from marker written on failure', () => {
      expect(existsSync(join(stateDir, 'just-upgraded-from'))).toBe(false);
    });
  });

  // ─── Track 15B: migrations runner + ledger ─────────────────────────
  describe('Track 15B migrations runner', () => {
    const okScript = `#!/usr/bin/env bash
printf 'ok\\n' >> "$STATE_DIR/ran-ok"
`;
    const failScript = `#!/usr/bin/env bash
printf 'fail\\n' >> "$STATE_DIR/ran-fail"
exit 1
`;
    const earlyScript = `#!/usr/bin/env bash
printf 'early\\n' >> "$STATE_DIR/ran-order"
`;
    const lateScript = `#!/usr/bin/env bash
printf 'late\\n' >> "$STATE_DIR/ran-order"
`;

    test('absent migrations/ dir: UPGRADE_OK, no MIGRATION_WARN', () => {
      const repo = createFixtureRepo('mig-absent');
      pushNewVersion(`${baseTmp}/mig-absent-remote`, '1.1.0', migrationPayload({}));
      const stateDir = join(baseTmp, 'mig-absent-state');
      const homeDir = join(baseTmp, 'mig-absent-home');
      mkdirSync(stateDir, { recursive: true });
      mkdirSync(homeDir, { recursive: true });
      const result = runBin(UPDATE_RUN, [repo], {
        home: homeDir,
        gstackExtendDir: ROOT,
        gstackExtendStateDir: stateDir,
      });
      const out = result.stdout + result.stderr;
      expect(out).toContain('UPGRADE_OK 1.0.0 1.1.0');
      expect(out).not.toContain('MIGRATION_WARN');
    });

    test('in-window script runs once; second same-VERSION run does not re-run', () => {
      const repo = createFixtureRepo('mig-once');
      pushNewVersion(`${baseTmp}/mig-once-remote`, '1.1.0', migrationPayload({
        'v1.1.0.sh': okScript,
      }));
      const stateDir = join(baseTmp, 'mig-once-state');
      const homeDir = join(baseTmp, 'mig-once-home');
      mkdirSync(stateDir, { recursive: true });
      mkdirSync(homeDir, { recursive: true });
      const first = runBin(UPDATE_RUN, [repo], {
        home: homeDir,
        gstackExtendDir: ROOT,
        gstackExtendStateDir: stateDir,
      });
      expect(first.stdout + first.stderr).toContain('UPGRADE_OK 1.0.0 1.1.0');
      expect(readFileSync(join(stateDir, 'ran-ok'), 'utf8')).toBe('ok\n');
      expect(readFileSync(join(stateDir, 'migrations-applied'), 'utf8')).toContain('v1.1.0.sh');

      const second = runBin(UPDATE_RUN, [repo], {
        home: homeDir,
        gstackExtendDir: ROOT,
        gstackExtendStateDir: stateDir,
      });
      expect(second.stdout + second.stderr).toContain('UPGRADE_OK 1.1.0 1.1.0');
      expect(readFileSync(join(stateDir, 'ran-ok'), 'utf8')).toBe('ok\n');
    });

    test('older-than-OLD skipped; newer-than-NEW skipped; ==OLD skipped; ==NEW runs', () => {
      const repo = createFixtureRepo('mig-window');
      pushNewVersion(`${baseTmp}/mig-window-remote`, '1.1.0', migrationPayload({
        'v0.9.0.sh': `#!/usr/bin/env bash\nprintf 'old\\n' >> "$STATE_DIR/ran-window"\n`,
        'v1.0.0.sh': `#!/usr/bin/env bash\nprintf 'eqold\\n' >> "$STATE_DIR/ran-window"\n`,
        'v1.1.0.sh': `#!/usr/bin/env bash\nprintf 'eqnew\\n' >> "$STATE_DIR/ran-window"\n`,
        'v1.2.0.sh': `#!/usr/bin/env bash\nprintf 'future\\n' >> "$STATE_DIR/ran-window"\n`,
      }));
      const stateDir = join(baseTmp, 'mig-window-state');
      const homeDir = join(baseTmp, 'mig-window-home');
      mkdirSync(stateDir, { recursive: true });
      mkdirSync(homeDir, { recursive: true });
      const result = runBin(UPDATE_RUN, [repo], {
        home: homeDir,
        gstackExtendDir: ROOT,
        gstackExtendStateDir: stateDir,
      });
      expect(result.stdout + result.stderr).toContain('UPGRADE_OK 1.0.0 1.1.0');
      expect(readFileSync(join(stateDir, 'ran-window'), 'utf8')).toBe('eqnew\n');
    });

    test('failing script: MIGRATION_WARN + UPGRADE_OK + same-VERSION retry', () => {
      const repo = createFixtureRepo('mig-fail');
      pushNewVersion(`${baseTmp}/mig-fail-remote`, '1.1.0', migrationPayload({
        'v1.1.0.sh': failScript,
      }));
      const stateDir = join(baseTmp, 'mig-fail-state');
      const homeDir = join(baseTmp, 'mig-fail-home');
      mkdirSync(stateDir, { recursive: true });
      mkdirSync(homeDir, { recursive: true });
      const first = runBin(UPDATE_RUN, [repo], {
        home: homeDir,
        gstackExtendDir: ROOT,
        gstackExtendStateDir: stateDir,
      });
      const out1 = first.stdout + first.stderr;
      expect(out1).toContain('UPGRADE_OK 1.0.0 1.1.0');
      expect(out1).toContain('MIGRATION_WARN v1.1.0.sh exit=1');
      expect(out1).not.toContain('UPGRADE_FAILED');
      expect(readFileSync(join(stateDir, 'migrations-failed'), 'utf8')).toContain('v1.1.0.sh');
      expect(readFileSync(join(stateDir, 'ran-fail'), 'utf8')).toBe('fail\n');

      const second = runBin(UPDATE_RUN, [repo], {
        home: homeDir,
        gstackExtendDir: ROOT,
        gstackExtendStateDir: stateDir,
      });
      const out2 = second.stdout + second.stderr;
      expect(out2).toContain('UPGRADE_OK 1.1.0 1.1.0');
      expect(out2).toContain('MIGRATION_WARN v1.1.0.sh exit=1');
      expect(readFileSync(join(stateDir, 'ran-fail'), 'utf8')).toBe('fail\nfail\n');
    });

    test('two in-window scripts run in version order', () => {
      const repo = createFixtureRepo('mig-order');
      pushNewVersion(`${baseTmp}/mig-order-remote`, '1.1.0', migrationPayload({
        'v1.0.10.sh': lateScript,
        'v1.0.9.sh': earlyScript,
      }));
      const stateDir = join(baseTmp, 'mig-order-state');
      const homeDir = join(baseTmp, 'mig-order-home');
      mkdirSync(stateDir, { recursive: true });
      mkdirSync(homeDir, { recursive: true });
      const result = runBin(UPDATE_RUN, [repo], {
        home: homeDir,
        gstackExtendDir: ROOT,
        gstackExtendStateDir: stateDir,
      });
      expect(result.stdout + result.stderr).toContain('UPGRADE_OK 1.0.0 1.1.0');
      expect(readFileSync(join(stateDir, 'ran-order'), 'utf8')).toBe('early\nlate\n');
    });

    test('script that reads stdin does not skip a later script', () => {
      const repo = createFixtureRepo('mig-stdin');
      pushNewVersion(`${baseTmp}/mig-stdin-remote`, '1.1.0', migrationPayload({
        'v1.0.9.sh': `#!/usr/bin/env bash
cat >/dev/null
printf 'ate\\n' >> "$STATE_DIR/ran-stdin"
`,
        'v1.0.10.sh': `#!/usr/bin/env bash
printf 'later\\n' >> "$STATE_DIR/ran-stdin"
`,
      }));
      const stateDir = join(baseTmp, 'mig-stdin-state');
      const homeDir = join(baseTmp, 'mig-stdin-home');
      mkdirSync(stateDir, { recursive: true });
      mkdirSync(homeDir, { recursive: true });
      const result = runBin(UPDATE_RUN, [repo], {
        home: homeDir,
        gstackExtendDir: ROOT,
        gstackExtendStateDir: stateDir,
      });
      expect(result.stdout + result.stderr).toContain('UPGRADE_OK 1.0.0 1.1.0');
      expect(readFileSync(join(stateDir, 'ran-stdin'), 'utf8')).toBe('ate\nlater\n');
    });

    test('later script still runs after an earlier one fails', () => {
      const repo = createFixtureRepo('mig-continue');
      pushNewVersion(`${baseTmp}/mig-continue-remote`, '1.1.0', migrationPayload({
        'v1.0.9.sh': failScript,
        'v1.0.10.sh': okScript,
      }));
      const stateDir = join(baseTmp, 'mig-continue-state');
      const homeDir = join(baseTmp, 'mig-continue-home');
      mkdirSync(stateDir, { recursive: true });
      mkdirSync(homeDir, { recursive: true });
      const out = runBin(UPDATE_RUN, [repo], {
        home: homeDir,
        gstackExtendDir: ROOT,
        gstackExtendStateDir: stateDir,
      });
      const text = out.stdout + out.stderr;
      expect(text).toContain('UPGRADE_OK 1.0.0 1.1.0');
      expect(text).toContain('MIGRATION_WARN v1.0.9.sh exit=1');
      expect(readFileSync(join(stateDir, 'ran-ok'), 'utf8')).toBe('ok\n');
      expect(readFileSync(join(stateDir, 'migrations-applied'), 'utf8')).toContain('v1.0.10.sh');
      expect(readFileSync(join(stateDir, 'migrations-failed'), 'utf8')).toContain('v1.0.9.sh');
    });

    test('old update-run without the call site does not run pulled scripts', () => {
      const repo = createFixtureRepo('mig-oldbin');
      pushNewVersion(`${baseTmp}/mig-oldbin-remote`, '1.1.0', migrationPayload({
        'v1.1.0.sh': okScript,
      }));
      const stub = join(baseTmp, 'old-update-run');
      writeFileSync(stub, `#!/usr/bin/env bash
set -euo pipefail
INSTALL_DIR="\${1:-}"
OLD=$(tr -d '[:space:]' < "\$INSTALL_DIR/VERSION")
git -C "\$INSTALL_DIR" fetch origin
git -C "\$INSTALL_DIR" pull --ff-only origin main
"\$INSTALL_DIR/setup" --host auto --quiet
NEW=$(tr -d '[:space:]' < "\$INSTALL_DIR/VERSION")
echo "UPGRADE_OK \$OLD \$NEW"
`);
      chmodSync(stub, 0o755);
      const stateDir = join(baseTmp, 'mig-oldbin-state');
      const homeDir = join(baseTmp, 'mig-oldbin-home');
      mkdirSync(stateDir, { recursive: true });
      mkdirSync(homeDir, { recursive: true });
      const result = runBin(stub, [repo], {
        home: homeDir,
        gstackExtendDir: ROOT,
        gstackExtendStateDir: stateDir,
      });
      expect(result.stdout + result.stderr).toContain('UPGRADE_OK 1.0.0 1.1.0');
      expect(existsSync(join(stateDir, 'ran-ok'))).toBe(false);
      expect(existsSync(join(repo, 'bin', 'lib', 'run-migrations.sh'))).toBe(true);
    });

    test('gstack-extend-upgrade skill names MIGRATION_WARN outside SHARED:upgrade-flow', () => {
      const skill = readFileSync(join(ROOT, 'skills', 'gstack-extend-upgrade.md'), 'utf8');
      const shared = skill.slice(
        skill.indexOf('<!-- SHARED:upgrade-flow -->'),
        skill.indexOf('<!-- /SHARED:upgrade-flow -->'),
      );
      expect(shared).not.toContain('MIGRATION_WARN');
      expect(skill).toContain('MIGRATION_WARN');
      expect(skill).toContain('bin/update-run');
      expect(skill).toContain('JUST_UPGRADED');
    });
  });

  describe('Track 15B follow-up (hop-from + helper paths)', () => {
    const okScript = `#!/usr/bin/env bash
printf 'ok\\n' >> "$STATE_DIR/ran-ok"
`;
    const failScript = `#!/usr/bin/env bash
printf 'fail\\n' >> "$STATE_DIR/ran-fail"
exit 1
`;

    function makeHelperInstall(
      name: string,
      scripts: Record<string, string> = {},
      opts: { semver?: boolean; migrationsDir?: boolean } = {},
    ): { install: string; state: string; home: string } {
      const install = join(baseTmp, name, 'install');
      const state = join(baseTmp, name, 'state');
      const home = join(baseTmp, name, 'home');
      mkdirSync(join(install, 'bin', 'lib'), { recursive: true });
      mkdirSync(state, { recursive: true });
      mkdirSync(home, { recursive: true });
      if (opts.semver !== false) {
        writeFileSync(join(install, 'bin', 'lib', 'semver.sh'), readFileSync(SEMVER_LIB));
      }
      if (opts.migrationsDir !== false) {
        mkdirSync(join(install, 'migrations'), { recursive: true });
        for (const [scriptName, body] of Object.entries(scripts)) {
          writeFileSync(join(install, 'migrations', scriptName), body);
        }
      }
      return { install, state, home };
    }

    function runHelper(
      install: string,
      state: string,
      oldV: string,
      newV: string,
      home: string,
    ) {
      return runBin(RUN_MIGRATIONS, [install, state, oldV, newV], {
        home,
        gstackExtendDir: ROOT,
        gstackExtendStateDir: state,
      });
    }

    test('helper missing-args: MIGRATION_WARN helper exit=missing-args, exit 0', () => {
      const { install, state, home } = makeHelperInstall('helper-missing-args');
      writeFileSync(join(state, 'migrations-hop-from'), '1.0.0\n');
      const result = runBin(RUN_MIGRATIONS, [install, state], {
        home,
        gstackExtendDir: ROOT,
        gstackExtendStateDir: state,
      });
      const out = result.stdout + result.stderr;
      expect(out).toContain('MIGRATION_WARN helper exit=missing-args');
      expect(result.exitCode).toBe(0);
      expect(readFileSync(join(state, 'migrations-hop-from'), 'utf8')).toBe('1.0.0\n');
    });

    test('helper missing semver.sh: exit=semver-missing, hop-from kept', () => {
      const { install, state, home } = makeHelperInstall('helper-no-semver', {}, { semver: false });
      writeFileSync(join(state, 'migrations-hop-from'), '1.0.0\n');
      const result = runHelper(install, state, '1.0.0', '1.1.0', home);
      const out = result.stdout + result.stderr;
      expect(out).toContain('MIGRATION_WARN helper exit=semver-missing');
      expect(result.exitCode).toBe(0);
      expect(readFileSync(join(state, 'migrations-hop-from'), 'utf8')).toBe('1.0.0\n');
    });

    test('helper bad-version NEW=unknown: no unbound abort, retries failed name', () => {
      const { install, state, home } = makeHelperInstall('helper-unknown-new', {
        'v1.1.0.sh': okScript,
      });
      writeFileSync(join(state, 'migrations-failed'), 'v1.1.0.sh\n');
      const result = runHelper(install, state, '1.1.0', 'unknown', home);
      const out = result.stdout + result.stderr;
      expect(result.exitCode).toBe(0);
      expect(out).toContain('MIGRATION_WARN helper exit=bad-version');
      expect(out).not.toContain('unbound variable');
      expect(readFileSync(join(state, 'ran-ok'), 'utf8')).toBe('ok\n');
      expect(readFileSync(join(state, 'migrations-applied'), 'utf8')).toContain('v1.1.0.sh');
    });

    test('failed name newer than semver NEW is not retried', () => {
      const { install, state, home } = makeHelperInstall('helper-failed-upper', {
        'v1.2.0.sh': okScript,
      });
      writeFileSync(join(state, 'migrations-failed'), 'v1.2.0.sh\n');
      const result = runHelper(install, state, '1.1.0', '1.1.0', home);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(state, 'ran-ok'))).toBe(false);
      expect(readFileSync(join(state, 'migrations-failed'), 'utf8')).toContain('v1.2.0.sh');
    });

    test('empty migrations/ (.gitkeep only): no MIGRATION_WARN, hop-from cleared', () => {
      const { install, state, home } = makeHelperInstall('helper-empty-mig');
      writeFileSync(join(install, 'migrations', '.gitkeep'), '');
      writeFileSync(join(state, 'migrations-hop-from'), '1.0.0\n');
      const result = runHelper(install, state, '1.0.0', '1.1.0', home);
      const out = result.stdout + result.stderr;
      expect(result.exitCode).toBe(0);
      expect(out).not.toContain('MIGRATION_WARN');
      expect(existsSync(join(state, 'migrations-hop-from'))).toBe(false);
    });

    test('symlink and non-semver name are skipped', () => {
      const { install, state, home } = makeHelperInstall('helper-skip-names', {
        'vfoo.sh': okScript,
      });
      writeFileSync(join(install, 'migrations', 'real.sh'), okScript);
      symlinkSync(join(install, 'migrations', 'real.sh'), join(install, 'migrations', 'v1.1.0.sh'));
      const result = runHelper(install, state, '1.0.0', '1.1.0', home);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(state, 'ran-ok'))).toBe(false);
    });

    test('fail then succeed clears migrations-failed', () => {
      const { install, state, home } = makeHelperInstall('helper-fail-then-ok', {
        'v1.1.0.sh': failScript,
      });
      const first = runHelper(install, state, '1.0.0', '1.1.0', home);
      expect(first.stdout + first.stderr).toContain('MIGRATION_WARN v1.1.0.sh exit=1');
      expect(readFileSync(join(state, 'migrations-failed'), 'utf8')).toContain('v1.1.0.sh');

      writeFileSync(join(install, 'migrations', 'v1.1.0.sh'), okScript);
      const second = runHelper(install, state, '1.1.0', '1.1.0', home);
      expect(second.exitCode).toBe(0);
      expect(readFileSync(join(state, 'ran-ok'), 'utf8')).toBe('ok\n');
      expect(readFileSync(join(state, 'migrations-applied'), 'utf8')).toContain('v1.1.0.sh');
      expect(readFileSync(join(state, 'migrations-failed'), 'utf8')).not.toContain('v1.1.0.sh');
    });

    test('unexpected helper abort emits MIGRATION_WARN helper and keeps hop-from', () => {
      const { install, state, home } = makeHelperInstall('helper-abort', {
        'v1.1.0.sh': okScript,
      });
      writeFileSync(join(state, 'migrations-hop-from'), '1.0.0\n');
      chmodSync(state, 0o555);
      const result = runHelper(install, state, '1.0.0', '1.1.0', home);
      chmodSync(state, 0o755);
      const out = result.stdout + result.stderr;
      expect(result.exitCode).toBe(0);
      expect(out).toMatch(/MIGRATION_WARN helper/);
      expect(readFileSync(join(state, 'migrations-hop-from'), 'utf8')).toBe('1.0.0\n');
      expect(existsSync(join(state, 'ran-ok'))).toBe(false);
    });

    test('setup-fail after pull: hop-from keeps window for the next hop', () => {
      const repo = createFixtureRepo('mig-setup-fail');
      pushNewVersion(`${baseTmp}/mig-setup-fail-remote`, '1.1.0', {
        ...migrationPayload({ 'v1.1.0.sh': okScript }),
        setup: '#!/usr/bin/env bash\nexit 1\n',
      });
      const stateDir = join(baseTmp, 'mig-setup-fail-state');
      const homeDir = join(baseTmp, 'mig-setup-fail-home');
      mkdirSync(stateDir, { recursive: true });
      mkdirSync(homeDir, { recursive: true });

      const first = runBin(UPDATE_RUN, [repo], {
        home: homeDir,
        gstackExtendDir: ROOT,
        gstackExtendStateDir: stateDir,
      });
      const out1 = first.stdout + first.stderr;
      expect(out1).toContain('UPGRADE_FAILED stage=setup');
      expect(readFileSync(join(stateDir, 'migrations-hop-from'), 'utf8').trim()).toBe('1.0.0');
      expect(existsSync(join(stateDir, 'ran-ok'))).toBe(false);

      const work = `${baseTmp}/mig-setup-fail-remote-work2`;
      spawnSync('git', ['clone', '--quiet', `${baseTmp}/mig-setup-fail-remote`, work]);
      writeFileSync(join(work, 'setup'), '#!/usr/bin/env bash\necho "setup ran"\n');
      chmodSync(join(work, 'setup'), 0o755);
      spawnSync('git', ['-C', work, 'add', 'setup']);
      spawnSync('git', ['-C', work, 'commit', '-m', 'fix setup', '--quiet']);
      spawnSync('git', ['-C', work, 'push', 'origin', 'main', '--quiet']);
      rmSync(work, { recursive: true, force: true });

      const second = runBin(UPDATE_RUN, [repo], {
        home: homeDir,
        gstackExtendDir: ROOT,
        gstackExtendStateDir: stateDir,
      });
      const out2 = second.stdout + second.stderr;
      expect(out2).toContain('UPGRADE_OK 1.0.0 1.1.0');
      expect(readFileSync(join(stateDir, 'ran-ok'), 'utf8')).toBe('ok\n');
      expect(existsSync(join(stateDir, 'migrations-hop-from'))).toBe(false);
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

  test('installs all skills to default skills dir', () => {
    expect(r.stdout + r.stderr).toContain(`Installed ${REAL_SETUP_SKILLS.length} skills`);
  });

  for (const skill of REAL_SETUP_SKILLS) {
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

  for (const skill of REAL_SETUP_SKILLS) {
    test(`uninstalls ${skill}`, () => {
      expect(r.stdout + r.stderr).toContain(`Removed ${skill}`);
    });

    test(`${skill} symlink removed after uninstall`, () => {
      const link = join(mockHome, '.claude', 'skills', skill, 'SKILL.md');
      expect(existsSync(link)).toBe(false);
    });
  }
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
  // Keep retired names: this fixture models the historical five-skill install.
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
    expect(r.stdout + r.stderr).toContain(`Installed ${REAL_SETUP_SKILLS.length} skills`);
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

// ─── Track 16D: extend-root resolver behavior ────────────────────────
//
// The extracted span from skills/gstack-extend-upgrade.md is the only
// probe. It never runs a tail and never the real bin/update-check,
// except the env-pin test below.

const RESOLVER_SKILL = 'gstack-extend-upgrade';

function probeExtendRoot(home: string, cwd: string, skillText?: string) {
  const text = skillText ?? readFileSync(join(ROOT, 'skills', 'gstack-extend-upgrade.md'), 'utf8');
  const script = resolverProbeScript(text);
  return strictShells().map((sh) => {
    const r = runShell(sh.shell, sh.args, script, scopedEnv(home), cwd);
    const lines = (r.stdout ?? '').split('\n');
    return {
      shell: sh.shell,
      status: r.status,
      stderr: r.stderr ?? '',
      root: lines[0] ?? '',
      unverified: lines[1] ?? '',
    };
  });
}

function expectResolved(home: string, cwd: string, root: string, skillText?: string): void {
  const results = probeExtendRoot(home, cwd, skillText);
  expect(results.length).toBeGreaterThan(0);
  for (const r of results) {
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    if (root === '') expect(r.root).toBe('');
    else expect(realpathSync(r.root)).toBe(realpathSync(root));
  }
}

function claudeSymlink(home: string, root: string): void {
  mkdirSync(join(root, 'skills'), { recursive: true });
  writeFileSync(join(root, 'skills', `${RESOLVER_SKILL}.md`), 'skill\n');
  const dir = hostDir(home, 'claude', RESOLVER_SKILL);
  mkdirSync(dir, { recursive: true });
  symlinkSync(join(root, 'skills', `${RESOLVER_SKILL}.md`), join(dir, 'SKILL.md'));
}

function codexPointer(home: string, root: string, value = root, newline = true): void {
  writePointer(home, 'codex', RESOLVER_SKILL, value, newline);
  writeFileSync(join(hostDir(home, 'codex', RESOLVER_SKILL), 'SKILL.md'), 'copy\n');
}

function plantHostile(cwd: string, root: string): void {
  writeUpdateCheck(root);
  mkdirSync(join(root, 'skills'), { recursive: true });
  writeFileSync(join(root, 'skills', `${RESOLVER_SKILL}.md`), 'hostile\n');
  const dir = join(cwd, '.claude', 'skills', RESOLVER_SKILL);
  mkdirSync(dir, { recursive: true });
  symlinkSync(`../../../evil/skills/${RESOLVER_SKILL}.md`, join(dir, 'SKILL.md'));
  writeFileSync(join(dir, '.extend-root'), `${root}\n`);
}

describe('Track 16D extend-root resolver matrix', () => {
  test('Claude symlink install resolves', () => {
    const home = join(baseTmp, 'mx-claude-home');
    const root = join(baseTmp, 'mx-claude-root');
    writeUpdateCheck(root);
    claudeSymlink(home, root);
    expectResolved(home, home, root);
  });

  test('Codex regular-file copy plus pointer resolves', () => {
    const home = join(baseTmp, 'mx-codex-home');
    const root = join(baseTmp, 'mx-codex-root');
    writeUpdateCheck(root);
    codexPointer(home, root);
    expectResolved(home, home, root);
  });

  test('hostile cwd is ignored when HOME has a Codex pointer', () => {
    const home = join(baseTmp, 'mx-hostile-home');
    const legit = join(baseTmp, 'mx-hostile-legit');
    const cwd = join(baseTmp, 'mx-hostile-cwd');
    writeUpdateCheck(legit);
    codexPointer(home, legit);
    plantHostile(cwd, join(cwd, 'evil'));
    expectResolved(home, cwd, legit);
  });

  test('cwd-relative install is never trusted', () => {
    const home = join(baseTmp, 'mx-vendored-home');
    const cwd = join(baseTmp, 'mx-vendored-cwd');
    mkdirSync(home, { recursive: true });
    plantHostile(cwd, join(cwd, 'evil'));
    expectResolved(home, cwd, '');
  });

  test('relative pointer contents are rejected', () => {
    for (const value of ['.', 'x']) {
      const home = join(baseTmp, `mx-rel-${value === '.' ? 'dot' : 'x'}`);
      const cwd = join(baseTmp, `mx-rel-cwd-${value === '.' ? 'dot' : 'x'}`);
      mkdirSync(cwd, { recursive: true });
      codexPointer(home, join(baseTmp, 'unused'), value);
      const results = probeExtendRoot(home, cwd);
      for (const r of results) {
        expect(r.stderr).toBe('');
        expect(r.root).toBe('');
        expect(r.unverified).toContain('non-absolute path');
      }
    }
  });

  test('a bad first candidate falls through to the next', () => {
    const variants = [
      { name: 'markerless', prep: (root: string) => writeUpdateCheck(root, { marker: false }) },
      { name: 'nonexec', prep: (root: string) => writeUpdateCheck(root, { executable: false }) },
      { name: 'directory', prep: (root: string) => writeUpdateCheck(root, { asDirectory: true }) },
    ];
    for (const v of variants) {
      const home = join(baseTmp, `mx-fall-${v.name}-home`);
      const bad = join(baseTmp, `mx-fall-${v.name}-bad`);
      const good = join(baseTmp, `mx-fall-${v.name}-good`);
      v.prep(bad);
      writeUpdateCheck(good);
      claudeSymlink(home, bad);
      codexPointer(home, good);
      expectResolved(home, home, good);
    }
  });

  test('a stow-style relative symlink resolves against the link directory', () => {
    const home = join(baseTmp, 'mx-stow-home');
    const root = join(home, 'stub');
    writeUpdateCheck(root);
    mkdirSync(join(root, 'skills'), { recursive: true });
    const skillFile = join(root, 'skills', `${RESOLVER_SKILL}.md`);
    writeFileSync(skillFile, 'skill\n');
    const dir = hostDir(home, 'claude', RESOLVER_SKILL);
    mkdirSync(dir, { recursive: true });
    symlinkSync(`../../../stub/skills/${RESOLVER_SKILL}.md`, join(dir, 'SKILL.md'));
    expectResolved(home, home, root);
  });

  test('a relative link to a marker-less root prints UNVERIFIED', () => {
    const home = join(baseTmp, 'mx-stow-bad-home');
    const root = join(home, 'stub');
    writeUpdateCheck(root, { marker: false });
    mkdirSync(join(root, 'skills'), { recursive: true });
    writeFileSync(join(root, 'skills', `${RESOLVER_SKILL}.md`), 'skill\n');
    const dir = hostDir(home, 'claude', RESOLVER_SKILL);
    mkdirSync(dir, { recursive: true });
    symlinkSync(`../../../stub/skills/${RESOLVER_SKILL}.md`, join(dir, 'SKILL.md'));
    const results = probeExtendRoot(home, home);
    for (const r of results) {
      expect(r.stderr).toBe('');
      expect(r.root).toBe('');
      expect(r.unverified).toContain("lacks the line '# extend-root-protocol: v1'");
    }
  });

  test('a link to a deleted checkout prints the moved-or-deleted cause', () => {
    const home = join(baseTmp, 'mx-deleted-home');
    const root = join(baseTmp, 'mx-deleted-root');
    writeUpdateCheck(root);
    claudeSymlink(home, root);
    rmSync(root, { recursive: true, force: true });
    const results = probeExtendRoot(home, home);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
      expect(r.root).toBe('');
      expect(r.unverified).toContain('has no bin/update-check (checkout moved or deleted)');
    }
  });

  test('a lone non-executable update-check prints the restore cause', () => {
    const home = join(baseTmp, 'mx-nonexec-home');
    const root = join(baseTmp, 'mx-nonexec-root');
    writeUpdateCheck(root, { executable: false });
    claudeSymlink(home, root);
    const results = probeExtendRoot(home, home);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
      expect(r.root).toBe('');
      expect(r.unverified).toContain('is not a readable executable file');
      expect(r.unverified).toContain('checkout -- bin/update-check');
    }
  });

  test('an empty pointer prints its own cause', () => {
    const home = join(baseTmp, 'mx-empty-home');
    const cwd = join(baseTmp, 'mx-empty-cwd');
    mkdirSync(cwd, { recursive: true });
    const pointer = writePointer(home, 'codex', RESOLVER_SKILL, '', false);
    writeFileSync(pointer, '');
    writeFileSync(join(hostDir(home, 'codex', RESOLVER_SKILL), 'SKILL.md'), 'copy\n');
    const results = probeExtendRoot(home, cwd);
    for (const r of results) {
      expect(r.stderr).toBe('');
      expect(r.root).toBe('');
      expect(r.unverified).toContain('is empty');
      expect(r.unverified).toContain(pointer);
    }
  });

  test('a pointer with no trailing newline is accepted', () => {
    const home = join(baseTmp, 'mx-nonewline-home');
    const root = join(baseTmp, 'mx-nonewline-root');
    writeUpdateCheck(root);
    codexPointer(home, root, root, false);
    expectResolved(home, home, root);
  });

  test('a HOME and root containing spaces work', () => {
    const home = join(baseTmp, 'mx home');
    const root = join(baseTmp, 'mx root');
    writeUpdateCheck(root);
    claudeSymlink(home, root);
    expectResolved(home, home, root);
  });

  test('a setup-generated Codex copy resolves the real checkout from a spaced HOME', () => {
    const home = join(baseTmp, 'mx gen home');
    mkdirSync(home, { recursive: true });
    const setupResult = runSetup(['--host', 'codex'], home);
    expect(setupResult.exitCode).toBe(0);
    const copy = readFileSync(join(hostDir(home, 'codex', RESOLVER_SKILL), 'SKILL.md'), 'utf8');
    const cwd = join(baseTmp, 'mx-gen-hostile');
    plantHostile(cwd, join(cwd, 'evil'));
    expectResolved(home, cwd, ROOT, copy);
  });
});

describe('Track 16D update-check env pin', () => {
  test('upgrade tail pins GSTACK_EXTEND_DIR to the verified root', () => {
    const home = join(baseTmp, 'pin-home');
    const state = join(baseTmp, 'pin-state');
    const hostile = join(baseTmp, 'pin-hostile');
    const sentinel = join(baseTmp, 'pin-sentinel');
    mkdirSync(state, { recursive: true });
    writeFileSync(join(state, 'config'), 'update_check=false\n');
    mkdirSync(join(hostile, 'bin'), { recursive: true });
    writeFileSync(join(hostile, 'bin', 'config'), `#!/bin/sh\necho ran > ${JSON.stringify(sentinel)}\necho false\n`);
    chmodSync(join(hostile, 'bin', 'config'), 0o755);
    writePointer(home, 'claude', RESOLVER_SKILL, ROOT);
    writeFileSync(join(hostDir(home, 'claude', RESOLVER_SKILL), 'SKILL.md'), 'copy\n');
    const script = extractPreambleFence(readFileSync(join(ROOT, 'skills', 'gstack-extend-upgrade.md'), 'utf8'));
    const r = runShell('bash', ['-euc'], script, scopedEnv(home, {
      GSTACK_EXTEND_DIR: hostile,
      GSTACK_EXTEND_STATE_DIR: state,
      GSTACK_EXTEND_REMOTE_URL: 'http://127.0.0.1:9/VERSION',
    }), home);
    expect(r.status).toBe(0);
    expect(r.stdout ?? '').toContain('EXTEND_ROOT:');
    expect(existsSync(sentinel)).toBe(false);
  });
});

describe('extend-root protocol marker', () => {
  test('bin/update-check carries the v1 identity line', () => {
    const text = readFileSync(UPDATE_CHECK, 'utf8');
    expect(text.split('\n')).toContain(MARKER_LINE);
    expect(text).toContain('Protocol identity:');
    expect(text).toContain('Compatible bin changes never touch it');
    expect(text).toContain('v2 replaces v1');
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

// Track 23C checker and upgrade visibility. Frames below are built in the test,
// not by setup's writer, so the reader contract stands on its own.

function deviceId(path: string): string {
  const resolved = realpathSync(path);
  const mac = spawnSync('/usr/bin/stat', ['-f', '%d:%i', resolved], { encoding: 'utf8' });
  if (mac.status === 0 && (mac.stdout ?? '').trim()) return (mac.stdout ?? '').trim();
  const linux = spawnSync('/usr/bin/stat', ['-c', '%d:%i', resolved], { encoding: 'utf8' });
  return (linux.stdout ?? '').trim();
}

function encodeFrame(records: string[][]): Buffer {
  const fields = ['gstack-extend-install-status', '1'];
  for (const record of records) fields.push(...record);
  fields.push('END', String(records.length));
  return Buffer.concat(fields.map((field) => Buffer.from(`${field}\0`, 'utf8')));
}

function factRecord(home: string, over: Partial<Record<string, string>> = {}): string[] {
  const logical = over.logical ?? join(home, '.claude', 'skills');
  return [
    'fact',
    over.homeId ?? deviceId(home),
    over.origin ?? '/origin/checkout',
    over.oqual ?? 'this_checkout',
    over.host ?? 'claude',
    logical,
    over.physical ?? '',
    over.inode ?? '',
    over.skill ?? '',
    over.reason ?? 'shared_directory',
    over.cause ?? 'shared_with_codex',
    over.canon ?? 'not_applicable',
    over.variant ?? 'not_applicable',
    over.version ?? '1.0.0',
    over.sha ?? '',
    over.detect ?? 'explicit_host',
  ];
}

function isolatedTools(tag: string): string {
  const dir = join(baseTmp, `path-${tag}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'claude'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(dir, 'claude'), 0o755);
  if (!existsSync(join(dir, 'bun'))) symlinkSync(process.execPath, join(dir, 'bun'));
  const git = spawnSync('/bin/bash', ['-lc', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  if (git && !existsSync(join(dir, 'git'))) symlinkSync(git, join(dir, 'git'));
  return `${dir}:/bin:/usr/bin`;
}

function checkInstall(repo: string, home: string, state: string, args: string[] = [], remote = ''): ReturnType<typeof runBin> {
  return runBin(join(repo, 'bin', 'update-check'), args, {
    home,
    gstackExtendDir: repo,
    gstackExtendStateDir: state,
    extraEnv: {
      PATH: '/bin:/usr/bin',
      ...(remote ? { GSTACK_EXTEND_REMOTE_URL: remote } : {}),
    },
  });
}

function warnedFixture(name: string, remoteBody = '1.0.0\n', version = '9.9.9') {
  const repo = createFixtureRepo(name);
  seedUpdateCheckBinaries(repo);
  const home = join(baseTmp, `${name}-home`);
  const state = join(baseTmp, `${name}-state`);
  mkdirSync(home, { recursive: true });
  mkdirSync(state, { recursive: true });
  const remoteFile = join(baseTmp, `${name}-remote-ver`);
  writeFileSync(remoteFile, remoteBody);
  const logical = join(home, '.claude', 'skills');
  const record = factRecord(home, {
    logical,
    skill: 'implement',
    reason: 'preserved_regular',
    cause: 'regular_file_not_overwritten',
    canon: 'differs_canonical',
    variant: 'differs_stripped',
    version,
    detect: 'not_applicable',
  });
  const frame = encodeFrame([record]);
  writeFileSync(join(state, 'install-status'), frame);
  return { repo, home, state, remote: `file://${remoteFile}`, frame, logical };
}

const ORDINARY_CAPTURE = `_UPD=$(GSTACK_EXTEND_DIR="$_EXTEND_ROOT" "$_EXTEND_ROOT/bin/update-check" 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD" || true`;
const FORCE_CAPTURE = `_UPD=$(GSTACK_EXTEND_DIR="$_EXTEND_ROOT" "$_EXTEND_ROOT/bin/update-check" --force 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD" || true`;

function runFrozen(repo: string, home: string, state: string, capture: string, remote: string) {
  const script = `set -euo pipefail\n_EXTEND_ROOT=${JSON.stringify(repo)}\n${capture}\n`;
  return spawnSync('/bin/bash', ['-c', script], {
    encoding: 'utf8',
    env: {
      PATH: '/bin:/usr/bin',
      HOME: home,
      GSTACK_EXTEND_STATE_DIR: state,
      GSTACK_EXTEND_REMOTE_URL: remote,
    },
  });
}

function plantCopy(home: string, skill: string, body: string, origin: string): string {
  const dir = join(home, '.claude', 'skills', skill);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), body);
  writeFileSync(join(dir, '.extend-root'), `${origin}\n`);
  return dir;
}

describe('track 23C update visibility', () => {
  test('W1 absent and empty snapshots stay quiet', () => {
    const absent = warnedFixture('w1-absent');
    rmSync(join(absent.state, 'install-status'));
    const missing = checkInstall(absent.repo, absent.home, absent.state, [], absent.remote);
    expect(missing.exitCode).toBe(0);
    expect(missing.stdout).not.toContain('INSTALL_WARN');
    expect(existsSync(join(absent.state, 'install-status'))).toBe(false);

    const empty = warnedFixture('w1-empty');
    writeFileSync(join(empty.state, 'install-status'), encodeFrame([]));
    const quiet = checkInstall(empty.repo, empty.home, empty.state, [], empty.remote);
    expect(quiet.exitCode).toBe(0);
    expect(quiet.stdout).not.toContain('INSTALL_WARN');

    const home = join(baseTmp, 'w1-clean-home');
    mkdirSync(home, { recursive: true });
    const setup = spawnSync(SETUP, ['--host', 'claude', '--quiet'], {
      encoding: 'utf8',
      env: { PATH: isolatedTools('w1'), HOME: home, TMPDIR: process.env.TMPDIR ?? '/tmp' },
    });
    expect(setup.status).toBe(0);
    expect(setup.stdout ?? '').not.toContain('INSTALL_WARN');
    const again = spawnSync(SETUP, ['--host', 'claude', '--quiet'], {
      encoding: 'utf8',
      env: { PATH: isolatedTools('w1b'), HOME: home, TMPDIR: process.env.TMPDIR ?? '/tmp' },
    });
    expect(again.status).toBe(0);
    const seen = checkInstall(absent.repo, home, join(home, '.gstack-extend'), [], absent.remote);
    expect(seen.stdout).not.toContain('INSTALL_WARN');
  });

  test('W2 an independent frame round-trips both records', () => {
    const home = join(baseTmp, 'w2-home');
    const state = join(baseTmp, 'w2-state');
    const decoyHome = join(baseTmp, 'w2-decoy-home');
    mkdirSync(home, { recursive: true });
    mkdirSync(state, { recursive: true });
    mkdirSync(join(decoyHome, '.gstack-extend'), { recursive: true });
    const logical = join(home, '.claude', 'skills');
    const records = [
      factRecord(home, { logical, reason: 'shared_directory', cause: 'shared_with_codex', skill: '' }),
      factRecord(home, {
        logical,
        skill: 'implement',
        reason: 'preserved_regular',
        cause: 'regular_file_not_overwritten',
        canon: 'differs_canonical',
        variant: 'differs_stripped',
        version: '0.36.0.1',
        detect: 'not_applicable',
      }),
    ];
    const frame = encodeFrame(records);
    writeFileSync(join(state, 'install-status'), frame);
    const decoy = encodeFrame([factRecord(decoyHome, {
      logical: join(decoyHome, '.claude', 'skills'),
      skill: 'roadmap',
      reason: 'preserved_regular',
      cause: 'decoyfact',
      canon: 'differs_canonical',
      variant: 'differs_stripped',
      detect: 'not_applicable',
    })]);
    writeFileSync(join(decoyHome, '.gstack-extend', 'install-status'), decoy);
    const repo = createFixtureRepo('w2-repo');
    seedUpdateCheckBinaries(repo);
    const remote = join(baseTmp, 'w2-remote');
    writeFileSync(remote, '1.0.0\n');
    const seen = checkInstall(repo, home, state, [], `file://${remote}`);
    expect(seen.exitCode).toBe(0);
    expect(seen.stdout).toContain('reason=shared_directory');
    expect(seen.stdout).toContain('cause=shared_with_codex');
    expect(seen.stdout).toContain('skill=implement');
    expect(seen.stdout).toContain('compare=differs_canonical');
    expect(seen.stdout).toContain('variant=differs_stripped');
    expect(seen.stdout).toContain('observed=0.36.0.1');
    expect(seen.stdout).toContain(`path=${logical}`);
    expect(seen.stdout).not.toContain('decoyfact');
    expect(readFileSync(join(state, 'install-status'))).toEqual(frame);
    expect(readFileSync(join(decoyHome, '.gstack-extend', 'install-status'))).toEqual(decoy);
  });

  test('W3 unknown, truncated, extra and oversized state stays visible', () => {
    const fx = warnedFixture('w3');
    const status = join(fx.state, 'install-status');
    const cases: Array<[string, Buffer, string]> = [
      ['unknown_schema', Buffer.from('gstack-extend-install-status\x002\x00END\x000\x00', 'utf8'), 'unknown_schema'],
      ['unknown_record', encodeFrame([['note', ...factRecord(fx.home).slice(1)]]), 'unknown_record'],
      ['truncated', Buffer.from('gstack-extend-install-status\x001\x00fact\x00', 'utf8'), 'truncated'],
      ['extra_data', Buffer.concat([encodeFrame([]), Buffer.from('extra\0', 'utf8')]), 'extra_data'],
      ['count_mismatch', Buffer.from('gstack-extend-install-status\x001\x00END\x001\x00', 'utf8'), 'count_mismatch'],
      ['malformed', Buffer.from('not-the-magic\x001\x00END\x000\x00', 'utf8'), 'malformed'],
    ];
    for (const [label, body, cause] of cases) {
      writeFileSync(status, body);
      const seen = checkInstall(fx.repo, fx.home, fx.state, [], fx.remote);
      expect(seen.stdout, label).toContain(`cause=${cause}`);
      expect(seen.stdout, label).toContain('reason=status_unverified');
      expect(readFileSync(status), label).toEqual(body);
    }

    const other = factRecord(fx.home, { homeId: '9:9', cause: 'otherhome' });
    const last = factRecord(fx.home, { skill: 'implement', reason: 'preserved_regular', cause: 'cause4097', canon: 'differs_canonical', variant: 'differs_stripped', detect: 'not_applicable' });
    const many = encodeFrame([...Array.from({ length: 4096 }, () => other), last]);
    expect(many.length).toBeLessThanOrEqual(1048576);
    writeFileSync(status, many);
    const limited = checkInstall(fx.repo, fx.home, fx.state, [], fx.remote);
    expect(limited.stdout).toContain('cause=oversized');
    expect(limited.stdout).not.toContain('cause4097');
    expect(readFileSync(status)).toEqual(many);

    const huge = Buffer.alloc(1048577, 0x61);
    writeFileSync(status, huge);
    const oversized = checkInstall(fx.repo, fx.home, fx.state, [], fx.remote);
    expect(oversized.stdout).toContain('cause=oversized');
    expect(readFileSync(status)).toEqual(huge);
  }, 20000);

  test('W4 a symlink status is diagnosed and the target is untouched', () => {
    const fx = warnedFixture('w4');
    const status = join(fx.state, 'install-status');
    const victim = join(fx.state, 'victim');
    writeFileSync(victim, 'VICTIM\n');
    rmSync(status);
    symlinkSync(victim, status);
    const seen = checkInstall(fx.repo, fx.home, fx.state, [], fx.remote);
    expect(seen.stdout).toContain('reason=status_unreadable');
    expect(seen.stdout).toContain('cause=symlink');
    expect(readFileSync(victim, 'utf8')).toBe('VICTIM\n');
  });

  test('W6 readers see the predecessor, then the successor', async () => {
    const home = join(baseTmp, 'w6-home');
    const origin = realpathSync(ROOT);
    mkdirSync(home, { recursive: true });
    plantCopy(home, 'implement', 'WRITER A\n', origin);
    const first = spawnSync(SETUP, ['--host', 'claude', '--quiet'], {
      encoding: 'utf8',
      env: { PATH: isolatedTools('w6a'), HOME: home, TMPDIR: process.env.TMPDIR ?? '/tmp' },
    });
    expect(first.status).toBe(0);
    const status = join(home, '.gstack-extend', 'install-status');
    const prior = readFileSync(status);
    rmSync(join(home, '.claude', 'skills', 'pair-review'), { recursive: true, force: true });
    plantCopy(home, 'pair-review', 'WRITER B\n', origin);

    const coord = join(baseTmp, 'w6-coord');
    const bins = join(baseTmp, 'w6-bins');
    mkdirSync(coord, { recursive: true });
    mkdirSync(bins, { recursive: true });
    const release = join(coord, 'release');
    const seen = join(coord, 'seen');
    spawnSync('mkfifo', [release]);
    writeFileSync(join(bins, 'mv'), `#!/bin/bash
dest=""
for a in "$@"; do dest=$a; done
case "$dest" in
  */install-status)
    : > ${JSON.stringify(seen)}
    cat ${JSON.stringify(release)} >/dev/null
    ;;
esac
exec /bin/mv "$@"
`);
    chmodSync(join(bins, 'mv'), 0o755);
    const child = spawn(SETUP, ['--host', 'claude', '--quiet'], {
      env: { PATH: `${bins}:${isolatedTools('w6b')}`, HOME: home, TMPDIR: process.env.TMPDIR ?? '/tmp' },
    });
    const started = Date.now();
    expect(await new Promise<boolean>((resolve) => {
      const timer = setInterval(() => {
        if (existsSync(seen) || Date.now() - started > 10000) {
          clearInterval(timer);
          resolve(existsSync(seen));
        }
      }, 20);
    })).toBe(true);
    const repo = createFixtureRepo('w6-repo');
    seedUpdateCheckBinaries(repo);
    const remote = join(baseTmp, 'w6-remote');
    writeFileSync(remote, '1.0.0\n');
    const during = checkInstall(repo, home, join(home, '.gstack-extend'), [], `file://${remote}`);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(during.stdout).toContain('reason=status_pending');
    expect(during.stdout).toContain('skill=implement');
    expect(during.stdout).not.toContain('skill=pair-review');
    expect(readFileSync(status)).toEqual(prior);
    writeFileSync(release, '\n');
    const code = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 10000);
      child.on('exit', (exitCode) => {
        clearTimeout(timer);
        resolve(exitCode);
      });
    });
    expect(code).toBe(0);
    const after = checkInstall(repo, home, join(home, '.gstack-extend'), [], `file://${remote}`);
    expect(after.stdout).not.toContain('reason=status_pending');
    expect(after.stdout).toContain('skill=implement');
    expect(after.stdout).toContain('skill=pair-review');
    const next = readFileSync(status);
    expect(next.includes(Buffer.from('gstack-extend-install-status\0'))).toBe(true);
    expect(next.includes(Buffer.from('\0END\0'))).toBe(true);
    expect(next).not.toEqual(prior);
  }, 20000);

  test('R1 disabled checks stay silent and re-enable restores the warning', () => {
    const fx = warnedFixture('r1', '2.0.0\n');
    const status = join(fx.state, 'install-status');
    writeFileSync(join(fx.state, 'config'), 'update_check=false\n');
    const silent = checkInstall(fx.repo, fx.home, fx.state, ['--force'], fx.remote);
    expect(silent.exitCode).toBe(0);
    expect(silent.stdout).toBe('');
    expect(readFileSync(status)).toEqual(fx.frame);
    writeFileSync(join(fx.state, 'config'), 'update_check=true\n');
    const restored = checkInstall(fx.repo, fx.home, fx.state, [], fx.remote);
    expect(restored.stdout).toContain('skill=implement');
    expect(restored.stdout).toContain('reason=preserved_regular');
    expect(readFileSync(status)).toEqual(fx.frame);
  });

  test('R2 a warm cache still prints local warnings', () => {
    const current = warnedFixture('r2-current');
    writeFileSync(join(current.state, 'last-update-check'), 'UP_TO_DATE 1.0.0\n');
    const upToDate = checkInstall(current.repo, current.home, current.state, [], current.remote);
    expect(upToDate.exitCode).toBe(0);
    expect(upToDate.stdout).not.toContain('UPGRADE_AVAILABLE');
    expect(upToDate.stdout).toContain('reason=preserved_regular');

    const newer = warnedFixture('r2-newer', '2.0.0\n');
    writeFileSync(join(newer.state, 'last-update-check'), 'UPGRADE_AVAILABLE 1.0.0 2.0.0\n');
    const available = checkInstall(newer.repo, newer.home, newer.state, [], newer.remote);
    const lines = available.stdout.trim().split('\n');
    expect(lines[0]).toBe('UPGRADE_AVAILABLE 1.0.0 2.0.0');
    expect(lines.slice(1).join('\n')).toContain('reason=preserved_regular');
  });

  test('R3 snooze hides the version line and keeps the warning', () => {
    const now = Math.floor(Date.now() / 1000);
    const active = warnedFixture('r3-active', '2.0.0\n');
    writeFileSync(join(active.state, 'last-update-check'), 'UPGRADE_AVAILABLE 1.0.0 2.0.0\n');
    writeFileSync(join(active.state, 'update-snoozed'), `2.0.0 1 ${now}\n`);
    const snoozed = checkInstall(active.repo, active.home, active.state, [], active.remote);
    expect(snoozed.stdout).not.toContain('UPGRADE_AVAILABLE');
    expect(snoozed.stdout).toContain('reason=preserved_regular');

    const expired = warnedFixture('r3-expired', '2.0.0\n');
    writeFileSync(join(expired.state, 'last-update-check'), 'UPGRADE_AVAILABLE 1.0.0 2.0.0\n');
    writeFileSync(join(expired.state, 'update-snoozed'), '2.0.0 1 1\n');
    const elapsed = checkInstall(expired.repo, expired.home, expired.state, [], expired.remote);
    expect(elapsed.stdout).toContain('UPGRADE_AVAILABLE 1.0.0 2.0.0');
    expect(elapsed.stdout).toContain('reason=preserved_regular');

    const moved = warnedFixture('r3-moved', '2.0.0\n');
    writeFileSync(join(moved.state, 'last-update-check'), 'UPGRADE_AVAILABLE 1.0.0 2.0.0\n');
    writeFileSync(join(moved.state, 'update-snoozed'), `9.9.9 1 ${now}\n`);
    const changed = checkInstall(moved.repo, moved.home, moved.state, [], moved.remote);
    expect(changed.stdout).toContain('UPGRADE_AVAILABLE 1.0.0 2.0.0');
    expect(changed.stdout).toContain('reason=preserved_regular');

    const forced = warnedFixture('r3-force', '2.0.0\n');
    writeFileSync(join(forced.state, 'last-update-check'), 'UP_TO_DATE 1.0.0\n');
    writeFileSync(join(forced.state, 'update-snoozed'), `2.0.0 1 ${now}\n`);
    const busted = checkInstall(forced.repo, forced.home, forced.state, ['--force'], forced.remote);
    expect(busted.stdout).toContain('UPGRADE_AVAILABLE 1.0.0 2.0.0');
    expect(busted.stdout).toContain('reason=preserved_regular');
    expect(existsSync(join(forced.state, 'update-snoozed'))).toBe(false);
  });

  test('R4 missing version and a bad remote still show local warnings', () => {
    const missing = warnedFixture('r4-missing');
    rmSync(join(missing.repo, 'VERSION'));
    const noVersion = checkInstall(missing.repo, missing.home, missing.state, [], missing.remote);
    expect(noVersion.exitCode).toBe(0);
    expect(noVersion.stdout).toContain('reason=preserved_regular');
    expect(noVersion.stdout).not.toContain('UPGRADE_AVAILABLE');

    const empty = warnedFixture('r4-empty');
    writeFileSync(join(empty.repo, 'VERSION'), '\n');
    const blank = checkInstall(empty.repo, empty.home, empty.state, [], empty.remote);
    expect(blank.exitCode).toBe(0);
    expect(blank.stdout).toContain('reason=preserved_regular');

    const invalid = warnedFixture('r4-invalid', '<html>nope</html>\n');
    const bad = checkInstall(invalid.repo, invalid.home, invalid.state, [], invalid.remote);
    expect(bad.exitCode).toBe(0);
    expect(bad.stdout).toContain('reason=preserved_regular');
    expect(bad.stdout).not.toContain('UPGRADE_AVAILABLE');

    const offline = warnedFixture('r4-offline');
    const down = checkInstall(offline.repo, offline.home, offline.state, [], 'http://127.0.0.1:9/VERSION');
    expect(down.exitCode).toBe(0);
    expect(down.stdout).toContain('reason=preserved_regular');
    expect(down.stdout).not.toContain('UPGRADE_AVAILABLE');
  });

  test('R5 just-upgraded stays first and the marker is one-shot', () => {
    const fx = warnedFixture('r5', '2.0.0\n');
    writeFileSync(join(fx.state, 'just-upgraded-from'), '0.9.0\n');
    const first = checkInstall(fx.repo, fx.home, fx.state, [], fx.remote);
    const text = first.stdout;
    const just = text.indexOf('JUST_UPGRADED 0.9.0 1.0.0');
    const available = text.indexOf('UPGRADE_AVAILABLE 1.0.0 2.0.0');
    const warn = text.indexOf('reason=preserved_regular');
    expect(just).toBeGreaterThanOrEqual(0);
    expect(just).toBeLessThan(available);
    expect(available).toBeLessThan(warn);
    expect(existsSync(join(fx.state, 'just-upgraded-from'))).toBe(false);
    const second = checkInstall(fx.repo, fx.home, fx.state, [], fx.remote);
    expect(second.stdout).not.toContain('JUST_UPGRADED');
    expect(second.stdout).toContain('reason=preserved_regular');
  });

  test('R6 frozen preambles show warnings after version results', () => {
    for (const skill of ['roadmap.md', 'pair-review.md', 'full-review.md']) {
      expect(readFileSync(join(ROOT, 'skills', skill), 'utf8')).toContain(ORDINARY_CAPTURE.split('\n')[0]!);
    }
    expect(readFileSync(join(ROOT, 'skills', 'gstack-extend-upgrade.md'), 'utf8')).toContain(FORCE_CAPTURE.split('\n')[0]!);
    const fx = warnedFixture('r6', '2.0.0\n');
    for (const capture of [ORDINARY_CAPTURE, FORCE_CAPTURE]) {
      const seen = runFrozen(fx.repo, fx.home, fx.state, capture, fx.remote);
      expect(seen.status).toBe(0);
      const text = seen.stdout ?? '';
      expect(text.indexOf('UPGRADE_AVAILABLE 1.0.0 2.0.0')).toBeGreaterThanOrEqual(0);
      expect(text.indexOf('UPGRADE_AVAILABLE 1.0.0 2.0.0')).toBeLessThan(text.indexOf('reason=preserved_regular'));
      expect(seen.stderr ?? '').not.toContain('INSTALL_WARN');
    }
  });

  test('R7 warning text is inert, deduped, and pinned to the recorded version', () => {
    const home = join(baseTmp, 'r7-home');
    const state = join(baseTmp, 'r7-state');
    mkdirSync(home, { recursive: true });
    mkdirSync(state, { recursive: true });
    const pwned = join(home, 'pwned');
    const nasty = join(home, `$(touch ${pwned})`);
    mkdirSync(nasty, { recursive: true });
    const repo = createFixtureRepo('r7');
    seedUpdateCheckBinaries(repo);
    const remote = join(baseTmp, 'r7-ver');
    writeFileSync(remote, '1.0.0\n');
    const hostile = factRecord(home, { logical: nasty, cause: 'shared_with_codex' });
    writeFileSync(join(state, 'install-status'), encodeFrame([hostile, hostile]));
    const seen = runFrozen(repo, home, state, ORDINARY_CAPTURE, `file://${remote}`);
    expect(seen.status).toBe(0);
    const warnings = (seen.stdout ?? '').split('\n').filter((line) => line.includes('reason=shared_directory'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('\\$\\(touch');
    expect(existsSync(pwned)).toBe(false);

    const pinned = warnedFixture('r7-pin');
    writeFileSync(join(pinned.repo, 'VERSION'), '3.0.0\n');
    const later = checkInstall(pinned.repo, pinned.home, pinned.state, [], pinned.remote);
    expect(later.stdout).toContain('observed=9.9.9');
    expect(later.stdout).toContain('freshness=unverified');
    expect(later.stdout).not.toContain('observed=3.0.0');
  });

  test('U1 a git failure leaves install status untouched', () => {
    const repo = createFixtureRepo('u1-diverged');
    writeFileSync(join(repo, 'local-only.txt'), 'local-only change\n');
    spawnSync('git', ['-C', repo, 'add', 'local-only.txt']);
    spawnSync('git', ['-C', repo, 'commit', '-m', 'local diverge', '--quiet']);
    const work = `${baseTmp}/u1-diverged-remote-work`;
    spawnSync('git', ['clone', '--quiet', `${baseTmp}/u1-diverged-remote`, work]);
    writeFileSync(join(work, 'remote-only.txt'), 'remote\n');
    spawnSync('git', ['-C', work, 'add', 'remote-only.txt']);
    spawnSync('git', ['-C', work, 'commit', '-m', 'remote diverge', '--quiet']);
    spawnSync('git', ['-C', work, 'push', 'origin', 'main', '--quiet']);
    rmSync(work, { recursive: true, force: true });
    writeFileSync(join(repo, 'dirty.txt'), 'keep me\n');
    const home = join(baseTmp, 'u1-home');
    const state = join(baseTmp, 'u1-state');
    mkdirSync(home, { recursive: true });
    mkdirSync(state, { recursive: true });
    const prior = encodeFrame([factRecord(home, { skill: 'implement', reason: 'preserved_regular', cause: 'regular_file_not_overwritten', canon: 'differs_canonical', variant: 'differs_stripped', detect: 'not_applicable' })]);
    writeFileSync(join(state, 'install-status'), prior);
    const result = runBin(UPDATE_RUN, [repo], { home, gstackExtendDir: repo, gstackExtendStateDir: state });
    const out = result.stdout + result.stderr;
    expect((out.match(/UPGRADE_FAILED/g) ?? []).length).toBe(1);
    expect(out).not.toContain('UPGRADE_OK');
    expect(readFileSync(join(state, 'install-status'))).toEqual(prior);
    expect(readFileSync(join(repo, 'dirty.txt'), 'utf8')).toBe('keep me\n');
    const log = spawnSync('git', ['-C', repo, 'log', '--oneline', '-1'], { encoding: 'utf8' });
    expect(log.stdout).toContain('local diverge');
  });

  test('U2 an old runner pulls the new setup and the frozen preamble sees it', () => {
    const repo = createFixtureRepoWithRealSetup('u2', {
      setupText: '#!/usr/bin/env bash\necho "old setup"\n',
      beforeCommit(dir) {
        writeFileSync(join(dir, 'bin', 'update-check'), '#!/usr/bin/env bash\nexit 0\n');
        chmodSync(join(dir, 'bin', 'update-check'), 0o755);
      },
    });
    pushNewVersion(`${baseTmp}/u2-remote`, '1.1.0', {
      setup: readFileSync(SETUP, 'utf8'),
      'bin/update-check': readFileSync(UPDATE_CHECK, 'utf8'),
      'bin/lib/semver.sh': readFileSync(SEMVER_LIB, 'utf8'),
      'bin/config': readFileSync(join(ROOT, 'bin', 'config'), 'utf8'),
    });
    const home = join(baseTmp, 'u2-home');
    const state = join(baseTmp, 'u2-state');
    mkdirSync(state, { recursive: true });
    plantCopy(home, 'implement', 'CUSTOM COPY\n', realpathSync(repo));
    const result = runBin(UPDATE_RUN, [repo], {
      home,
      gstackExtendDir: repo,
      gstackExtendStateDir: state,
      extraEnv: { PATH: isolatedTools('u2') },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('UPGRADE_OK 1.0.0 1.1.0');
    expect(result.stdout).not.toContain('UPGRADE_FAILED');
    expect(readFileSync(join(home, '.claude', 'skills', 'implement', 'SKILL.md'), 'utf8')).toBe('CUSTOM COPY\n');
    const remote = join(baseTmp, 'u2-ver');
    writeFileSync(remote, '1.1.0\n');
    const seen = runFrozen(repo, home, state, ORDINARY_CAPTURE, `file://${remote}`);
    expect(seen.status).toBe(0);
    expect(seen.stdout ?? '').toContain('skill=implement');
    expect(seen.stdout ?? '').toContain('reason=preserved_regular');
    expect(seen.stderr ?? '').not.toContain('INSTALL_WARN');
  }, 20000);

  test('U3 a failed setup keeps one failure and the observations', () => {
    const repo = createFixtureRepoWithRealSetup('u3');
    pushNewVersion(`${baseTmp}/u3-remote`, '1.1.0');
    const home = join(baseTmp, 'u3-home');
    const state = join(baseTmp, 'u3-state');
    mkdirSync(state, { recursive: true });
    const skills = join(home, '.claude', 'skills');
    mkdirSync(skills, { recursive: true });
    chmodSync(skills, 0o777);
    const prior = encodeFrame([factRecord(home, {
      skill: 'implement',
      reason: 'preserved_regular',
      cause: 'regular_file_not_overwritten',
      canon: 'differs_canonical',
      variant: 'differs_stripped',
      detect: 'not_applicable',
    })]);
    writeFileSync(join(state, 'install-status'), prior);
    const result = runBin(UPDATE_RUN, [repo], {
      home,
      gstackExtendDir: repo,
      gstackExtendStateDir: state,
      extraEnv: { PATH: isolatedTools('u3') },
    });
    const out = result.stdout + result.stderr;
    expect(result.exitCode).toBe(1);
    expect((out.match(/UPGRADE_FAILED/g) ?? []).length).toBe(1);
    expect(out).not.toContain('UPGRADE_OK');
    seedUpdateCheckBinaries(repo);
    const remote = join(baseTmp, 'u3-ver');
    writeFileSync(remote, '1.1.0\n');
    const seen = checkInstall(repo, home, state, [], `file://${remote}`);
    expect(seen.stdout).toContain('reason=unsafe_directory');
    expect(seen.stdout).toContain('cause=world_writable');
    expect(seen.stdout).toContain('skill=implement');
  }, 20000);

  test('U4 a publication failure still yields one UPGRADE_OK', () => {
    const repo = createFixtureRepoWithRealSetup('u4');
    pushNewVersion(`${baseTmp}/u4-remote`, '1.1.0');
    const home = join(baseTmp, 'u4-home');
    const state = join(baseTmp, 'u4-state');
    mkdirSync(home, { recursive: true });
    mkdirSync(state, { recursive: true });
    const prior = encodeFrame([factRecord(home, {
      skill: 'implement',
      reason: 'preserved_regular',
      cause: 'regular_file_not_overwritten',
      canon: 'differs_canonical',
      variant: 'differs_stripped',
      detect: 'not_applicable',
    })]);
    writeFileSync(join(state, 'install-status'), prior);
    const bins = join(baseTmp, 'u4-bins');
    mkdirSync(bins, { recursive: true });
    writeFileSync(join(bins, 'mv'), `#!/bin/bash
dest=""
for a in "$@"; do dest=$a; done
case "$dest" in
  */install-status) exit 1 ;;
esac
exec /bin/mv "$@"
`);
    chmodSync(join(bins, 'mv'), 0o755);
    const result = runBin(UPDATE_RUN, [repo], {
      home,
      gstackExtendDir: repo,
      gstackExtendStateDir: state,
      extraEnv: { PATH: `${bins}:${isolatedTools('u4')}` },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('UPGRADE_OK 1.0.0 1.1.0');
    expect((result.stdout.match(/UPGRADE_OK/g) ?? []).length).toBe(1);
    expect(result.stdout).not.toContain('UPGRADE_FAILED');
    expect(result.stdout).toContain('cause=rename_failed');
    expect(result.stdout).toContain('saved=no');
    expect(readFileSync(join(state, 'install-status'))).toEqual(prior);
    expect(lstatSync(join(home, '.claude', 'skills', 'pair-review', 'SKILL.md')).isSymbolicLink()).toBe(true);
  }, 20000);

  test('U5 a same-version setup retry records the preserved copy', () => {
    const repo = createFixtureRepoWithRealSetup('u5');
    const home = join(baseTmp, 'u5-home');
    const state = join(baseTmp, 'u5-state');
    mkdirSync(state, { recursive: true });
    plantCopy(home, 'implement', 'STILL CUSTOM\n', realpathSync(repo));
    const result = runBin(UPDATE_RUN, [repo], {
      home,
      gstackExtendDir: repo,
      gstackExtendStateDir: state,
      extraEnv: { PATH: isolatedTools('u5') },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('UPGRADE_OK 1.0.0 1.0.0');
    expect((result.stdout.match(/UPGRADE_OK/g) ?? []).length).toBe(1);
    expect(readFileSync(join(repo, 'VERSION'), 'utf8')).toBe('1.0.0\n');
    seedUpdateCheckBinaries(repo);
    expect(readFileSync(join(home, '.claude', 'skills', 'implement', 'SKILL.md'), 'utf8')).toBe('STILL CUSTOM\n');
    const remote = join(baseTmp, 'u5-ver');
    writeFileSync(remote, '1.0.0\n');
    const seen = checkInstall(repo, home, state, [], `file://${remote}`);
    expect(seen.stdout).toContain('skill=implement');
    expect(seen.stdout).toContain('reason=preserved_regular');
    expect(seen.stdout).toContain('freshness=unverified');
  }, 20000);
});
