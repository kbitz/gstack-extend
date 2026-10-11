/**
 * lib-install-safety.test.ts — tests for bin/lib/install-safety.sh.
 *
 * Shell-out from TS, mirroring the bashVersionGt helper at
 * tests/update.test.ts:460. The lib stays bash because it's sourced by
 * the bash setup script; TS port would force setup → bun shell-out.
 *
 * Coverage:
 *   - is_safe_install_path: happy path, nonexistent (ancestor walk),
 *     outside-$HOME, world-writable (chmod 0777), broken symlink, $HOME
 *     resolution, slash-delimited prefix (kb2 vs kb).
 *   - is_safe_target_path: directory (safe), symlink (refused), regular
 *     file (refused), nonexistent (safe — mkdir -p will create).
 *   - stat flavor: GNU- and BSD-style stat shims on PATH, so both owner-uid
 *     probe orders run on either OS, accepting the caller's uid and
 *     refusing a foreign one.
 *
 * A real foreign-owned directory needs sudo chown, so foreign-uid refusal
 * runs through the stat shims; setup-hosts O2 covers it end to end.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeBaseTmp } from './helpers/fixture-repo.ts';

const ROOT = join(import.meta.dir, '..');
const LIB = join(ROOT, 'bin', 'lib', 'install-safety.sh');

const baseTmp = makeBaseTmp('install-safety-');
afterAll(() => {
  try { rmSync(baseTmp, { recursive: true, force: true }); } catch {}
});

// Run a bash function from the lib. Returns { exitCode, stdout, stderr }.
function runFn(fn: 'is_safe_install_path' | 'is_safe_target_path', arg: string, env: Record<string, string> = {}) {
  // Pass the arg via positional ($1) so it can never be shell-interpolated.
  const script = `source "$0"; ${fn} "$1"`;
  const r = spawnSync('bash', ['-c', script, LIB, arg], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return {
    exitCode: r.status ?? -1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

describe('is_safe_install_path', () => {
  test('returns 0 for $HOME itself', () => {
    const r = runFn('is_safe_install_path', process.env.HOME ?? '');
    expect(r.exitCode).toBe(0);
  });

  test('returns 0 for a non-existent in-home path (ancestor walk)', () => {
    const target = join(process.env.HOME ?? '', `safety-test-nonexistent-${Date.now()}`);
    const r = runFn('is_safe_install_path', target);
    expect(r.exitCode).toBe(0);
  });

  test('returns 1 for paths outside $HOME', () => {
    // On macOS /tmp resolves to /private/tmp (root-owned) so ownership
    // fires first; either failure mode is correct refusal. The
    // "user-owned symlink to OUTSIDE-$HOME target" test below specifically
    // exercises the inside-$HOME branch.
    const r = runFn('is_safe_install_path', '/tmp');
    expect(r.exitCode).toBe(1);
  });

  test('returns 1 for non-existent path with non-existent root ancestor', () => {
    // /nonexistent-root-$$ resolves to nearest-existing-ancestor "/", which
    // is foreign-owned (uid 0 on macOS, 0 on Linux).
    const r = runFn('is_safe_install_path', `/nonexistent-root-${Date.now()}`);
    expect(r.exitCode).toBe(1);
  });

  test('returns 1 for world-writable directory', () => {
    const target = join(baseTmp, `world-writable-${Date.now()}`);
    mkdirSync(target);
    chmodSync(target, 0o777);
    // Set $HOME to baseTmp so the inside-HOME check passes;
    // the failure must come from world-writable.
    const r = runFn('is_safe_install_path', target, { HOME: baseTmp });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('world-writable');
  });

  test('returns 0 for user-owned symlink to in-home target (legit dotfiles pattern)', () => {
    // Simulate: ~/.claude/skills -> ~/dotfiles/claude-skills
    const fakeHome = join(baseTmp, `legit-home-${Date.now()}`);
    const dotfilesDir = join(fakeHome, 'dotfiles', 'claude-skills');
    mkdirSync(dotfilesDir, { recursive: true });
    const symlinkPath = join(fakeHome, '.claude', 'skills');
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    symlinkSync(dotfilesDir, symlinkPath);
    const r = runFn('is_safe_install_path', symlinkPath, { HOME: fakeHome });
    expect(r.exitCode).toBe(0);
  });

  test('returns 1 for user-owned symlink to OUTSIDE-$HOME target', () => {
    // Simulate: ~/.claude/skills -> /tmp/foo (user owns /tmp/foo on macOS,
    // but it's outside resolved $HOME, so refuse).
    const fakeHome = join(baseTmp, `outside-home-${Date.now()}`);
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    const targetOutsideHome = join(baseTmp, `outside-target-${Date.now()}`);
    mkdirSync(targetOutsideHome);
    const symlinkPath = join(fakeHome, '.claude', 'skills');
    symlinkSync(targetOutsideHome, symlinkPath);
    const r = runFn('is_safe_install_path', symlinkPath, { HOME: fakeHome });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('outside resolved $HOME');
  });

  test('returns 1 for broken symlink', () => {
    const fakeHome = join(baseTmp, `broken-home-${Date.now()}`);
    mkdirSync(fakeHome, { recursive: true });
    const broken = join(fakeHome, 'broken-link');
    symlinkSync('/nonexistent-target-whatever', broken);
    const r = runFn('is_safe_install_path', broken, { HOME: fakeHome });
    expect(r.exitCode).toBe(1);
  });

  test('slash-delimited HOME match: /Users/kb2 is NOT inside /Users/kb', () => {
    // Simulate two homes with prefix-overlap names. Without slash-delimited
    // case match, naive "$path"* prefix would accept this.
    const homeKb = join(baseTmp, 'home-kb');
    const homeKb2 = join(baseTmp, 'home-kb2');
    mkdirSync(homeKb, { recursive: true });
    mkdirSync(homeKb2, { recursive: true });
    const r = runFn('is_safe_install_path', homeKb2, { HOME: homeKb });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('outside resolved $HOME');
  });

  test('empty arg returns 1', () => {
    const r = runFn('is_safe_install_path', '');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('empty path argument');
  });
});

// Each shim answers its own flavor's owner-uid form with this user's uid and
// fails the other flavor's form the way the real tool does. GNU `-f` means
// --file-system: it prints file-system details on stdout, then fails on the
// '%u' operand. BSD `-c` is an illegal option with nothing on stdout.
const STAT_SHIMS = {
  GNU: `#!/bin/sh
case "$1" in
  -c) [ "$2" = '%u' ] && { id -u; exit 0; } ;;
  -f) printf '  File: "%s"\\n    ID: 0 Namelen: 255 Type: btrfs\\n' "$3"
      echo "stat: cannot read file system information for '%u'" >&2; exit 1 ;;
esac
exit 2
`,
  BSD: `#!/bin/sh
case "$1" in
  -f) [ "$2" = '%u' ] && { id -u; exit 0; } ;;
  -c) echo 'stat: illegal option -- c' >&2; exit 1 ;;
esac
exit 2
`,
};

// Check a fresh in-home skills dir with `shim` installed as `stat` ahead of PATH.
function runWithStat(name: string, shim: string) {
  const bins = join(baseTmp, `${name}-bins`);
  mkdirSync(bins, { recursive: true });
  writeFileSync(join(bins, 'stat'), shim);
  chmodSync(join(bins, 'stat'), 0o755);
  const fakeHome = join(baseTmp, `${name}-home`);
  mkdirSync(join(fakeHome, '.claude', 'skills'), { recursive: true });
  return runFn('is_safe_install_path', join(fakeHome, '.claude', 'skills'), {
    HOME: fakeHome,
    PATH: `${bins}:${process.env.PATH ?? '/usr/bin:/bin'}`,
  });
}

describe('is_safe_install_path stat flavor', () => {
  for (const [flavor, shim] of Object.entries(STAT_SHIMS)) {
    // Value: protects=a user-owned install root is accepted whichever stat flavor answers;
    //   fails_when=a failing probe's stdout reaches the uid (GNU `-f` probed first) or the BSD fallback is dropped;
    //   why_new=the real-stat tests above exercise only the host's own flavor; seam=none
    test(`accepts a user-owned in-home directory with ${flavor}-style stat`, () => {
      const r = runWithStat(`stat-${flavor}`, shim);
      expect(r.stderr).toBe('');
      expect(r.exitCode).toBe(0);
    });

    // Value: protects=the uid each stat flavor reports decides ownership, so a foreign-owned root is refused;
    //   fails_when=a probe's answer is ignored or replaced (e.g. by `id -u`) or reaches the check with extra stdout;
    //   why_new=the accept shims report the caller's own uid, so a probe that ignored stat still passes them;
    //   seam=none
    test(`refuses a directory that ${flavor}-style stat reports as foreign-owned`, () => {
      const mine = process.getuid!();
      const foreign = mine + 1;
      const foreignShim = shim.replace('id -u', `echo ${foreign}`);
      expect(foreignShim).not.toBe(shim);
      const r = runWithStat(`stat-${flavor}-foreign`, foreignShim);
      expect(r.stderr).toContain(`(owned by uid ${foreign}, expected ${mine})`);
      expect(r.exitCode).toBe(1);
    });
  }

  // Value: protects=an install root whose owner no stat flavor can read is refused, not trusted;
  //   fails_when=an empty owner uid is treated as safe or falls through to the uid-mismatch message;
  //   why_new=every other test gets a uid from stat, so the empty-uid refusal never runs; seam=none
  test('refuses when neither stat flavor can read the owner uid', () => {
    const r = runWithStat('stat-none', `#!/bin/sh
echo 'stat: unsupported' >&2
exit 1
`);
    expect(r.stderr).toContain('stat could not read ownership');
    expect(r.exitCode).toBe(1);
  });
});

describe('is_safe_target_path', () => {
  test('returns 0 for non-existent path (mkdir -p will create)', () => {
    const target = join(baseTmp, `nonexistent-target-${Date.now()}`);
    const r = runFn('is_safe_target_path', target);
    expect(r.exitCode).toBe(0);
  });

  test('returns 0 for existing directory', () => {
    const target = join(baseTmp, `dir-target-${Date.now()}`);
    mkdirSync(target);
    const r = runFn('is_safe_target_path', target);
    expect(r.exitCode).toBe(0);
  });

  test('returns 1 for symlink (any kind)', () => {
    const dir = join(baseTmp, `dir-${Date.now()}`);
    mkdirSync(dir);
    const symlinkPath = join(baseTmp, `symlink-${Date.now()}`);
    symlinkSync(dir, symlinkPath);
    const r = runFn('is_safe_target_path', symlinkPath);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('symlink');
  });

  test('returns 1 for regular file', () => {
    const filePath = join(baseTmp, `regular-file-${Date.now()}`);
    writeFileSync(filePath, 'content');
    const r = runFn('is_safe_target_path', filePath);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('not a directory');
  });

  test('empty arg returns 1', () => {
    const r = runFn('is_safe_target_path', '');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('empty path argument');
  });
});
