/**
 * setup-init-wire.test.ts — end-to-end tests for the CLI symlink wiring
 * and self-registration that Track 12A added to `setup`.
 *
 * Coverage:
 *   - `setup` (install) wires ~/.local/bin/gstack-extend → bin/gstack-extend
 *   - Self-registration writes the gstack-extend repo's entry into
 *     projects.json (D4.A, with || true fail-soft semantics)
 *   - `setup` is idempotent: re-running doesn't break symlink or registry
 *   - `setup --uninstall` removes ONLY symlinks pointing at our bin,
 *     never touching unrelated symlinks at the same name
 *   - Missing ~/.local/bin/ falls back to a tip, doesn't fail setup
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeBaseTmp } from './helpers/fixture-repo.ts';

const ROOT = join(import.meta.dir, '..');
const SETUP = join(ROOT, 'setup');

const baseTmp = makeBaseTmp('setup-wire-');
afterAll(() => {
  try { rmSync(baseTmp, { recursive: true, force: true }); } catch {}
});

function scope(name: string, withLocalBin = true) {
  const home = join(baseTmp, name);
  const localBin = join(home, '.local', 'bin');
  const state = join(home, 'state');
  const groot = join(home, 'gstack');
  mkdirSync(home, { recursive: true });
  mkdirSync(state, { recursive: true });
  mkdirSync(groot, { recursive: true });
  if (withLocalBin) mkdirSync(localBin, { recursive: true });
  return { home, localBin, state, groot };
}

function runSetup(s: ReturnType<typeof scope>, extraArgs: string[] = []) {
  const r = spawnSync(SETUP, extraArgs, {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: s.home,
      GSTACK_EXTEND_STATE_DIR: s.state,
      GSTACK_STATE_ROOT: s.groot,
    },
    timeout: 60_000,
  });
  return {
    exitCode: r.status ?? -1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

describe('CLI symlink wiring', () => {
  test('install wires the symlink to bin/gstack-extend', () => {
    const s = scope('install');
    const r = runSetup(s);
    expect(r.exitCode).toBe(0);
    // Track 13A refactor: setup now wires multiple bins via wire_bin(); the
    // message format dropped "CLI" since gstack-extend-telemetry isn't a CLI
    // in the user-facing sense. Both wires should appear.
    expect(r.stdout).toContain('Wired gstack-extend →');
    expect(r.stdout).toContain('Wired gstack-extend-telemetry →');
    const symlink = join(s.localBin, 'gstack-extend');
    expect(existsSync(symlink)).toBe(true);
    expect(readlinkSync(symlink)).toBe(join(ROOT, 'bin', 'gstack-extend'));
    // Track 13A: telemetry wrapper symlink also wired
    const telSymlink = join(s.localBin, 'gstack-extend-telemetry');
    expect(existsSync(telSymlink)).toBe(true);
    expect(readlinkSync(telSymlink)).toBe(join(ROOT, 'bin', 'gstack-extend-telemetry'));
  });

  test('install is idempotent: re-run produces the same symlink', () => {
    const s = scope('install-idem');
    runSetup(s);
    const r2 = runSetup(s);
    expect(r2.exitCode).toBe(0);
    const symlink = join(s.localBin, 'gstack-extend');
    expect(readlinkSync(symlink)).toBe(join(ROOT, 'bin', 'gstack-extend'));
  });

  test('install warns + skips when a non-symlink file already sits at the destination', () => {
    const s = scope('install-blocked');
    writeFileSync(join(s.localBin, 'gstack-extend'), '#!/bin/sh\necho user-script\n');
    const r = runSetup(s);
    // Setup must not crash even though our wire is blocked.
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain('exists and is not a symlink');
    // User script untouched.
    expect(readFileSync(join(s.localBin, 'gstack-extend'), 'utf8')).toContain('user-script');
  });

  test('install prints tip when ~/.local/bin/ is missing (no failure)', () => {
    const s = scope('install-no-localbin', /* withLocalBin */ false);
    const r = runSetup(s);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("~/.local/bin doesn't exist");
    // No symlink and no crash.
    expect(existsSync(join(s.localBin, 'gstack-extend'))).toBe(false);
  });
});

describe('self-registration (D4.A)', () => {
  test('install writes gstack-extend entry to projects.json', () => {
    const s = scope('self-register');
    const r = runSetup(s);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Self-registered gstack-extend');

    const reg = JSON.parse(readFileSync(join(s.state, 'projects.json'), 'utf8'));
    expect(reg.projects.length).toBeGreaterThanOrEqual(1);
    const entry = reg.projects.find((p: { slug: string }) =>
      typeof p.slug === 'string' && p.slug.includes('gstack-extend')
    );
    expect(entry).toBeDefined();
    expect(entry.version_scheme).toBe('4-digit');
  });

  test('install is idempotent on registry: re-run does not duplicate', () => {
    const s = scope('self-register-idem');
    runSetup(s);
    runSetup(s);
    const reg = JSON.parse(readFileSync(join(s.state, 'projects.json'), 'utf8'));
    const matches = reg.projects.filter((p: { slug: string }) =>
      typeof p.slug === 'string' && p.slug.includes('gstack-extend')
    );
    expect(matches).toHaveLength(1);
  });
});

describe('uninstall', () => {
  test('removes the symlink we created', () => {
    const s = scope('uninstall');
    runSetup(s);
    const r = runSetup(s, ['--uninstall']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Removed gstack-extend CLI symlink');
    expect(existsSync(join(s.localBin, 'gstack-extend'))).toBe(false);
  });

  test('refuses to remove a symlink that points elsewhere', () => {
    const s = scope('uninstall-foreign');
    const foreign = join(s.localBin, 'gstack-extend');
    // Create a symlink pointing at /usr/bin/true (or any other arbitrary
    // existing file) — must NOT be removed by uninstall.
    symlinkSync('/usr/bin/true', foreign);
    const r = runSetup(s, ['--uninstall']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Skipped gstack-extend CLI symlink (points elsewhere');
    expect(existsSync(foreign)).toBe(true);
    expect(readlinkSync(foreign)).toBe('/usr/bin/true');
  });

  test('handles missing symlink silently (no error)', () => {
    const s = scope('uninstall-noop');
    const r = runSetup(s, ['--uninstall']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Uninstall complete');
  });
});
