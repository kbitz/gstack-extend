/**
 * lib-session-paths.test.ts — tests for bin/lib/session-paths.sh.
 *
 * Shell-out from TS, mirroring lib-install-safety.test.ts's runFn pattern.
 * The lib stays bash because skill bash blocks source it directly.
 *
 * Coverage:
 *   - session_dir: standard slug, GSTACK_STATE_ROOT override, basename
 *     PWD fallback when gstack-slug missing, sanitization of weird chars,
 *     empty-arg error.
 *   - session_archive_dir: standard composition, empty-arg errors.
 *   - _session_resolve_slug: gstack-slug success, gstack-slug-missing
 *     fallback, fully-stripped basename guarded by sentinel.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { makeBaseTmp } from './helpers/fixture-repo.ts';

const ROOT = join(import.meta.dir, '..');
const LIB = join(ROOT, 'bin', 'lib', 'session-paths.sh');

const baseTmp = makeBaseTmp('session-paths-');
afterAll(() => {
  try { rmSync(baseTmp, { recursive: true, force: true }); } catch {}
});

type RunResult = { exitCode: number; stdout: string; stderr: string };

// Run a function from the lib. Args are positional; env is layered on top of
// process.env. cwd defaults to the repo root (so gstack-slug picks up the
// real remote and we get a stable slug for tests that don't pin it).
function runFn(
  fn: 'session_dir' | 'session_archive_dir' | '_session_resolve_slug',
  args: string[] = [],
  opts: { env?: Record<string, string>; cwd?: string } = {},
): RunResult {
  // Pass args as positionals so they can never be shell-interpolated.
  // $0 is the lib path; $1.. are the args.
  const argRefs = args.map((_, i) => `"\${${i + 1}}"`).join(' ');
  const script = `source "$0"; ${fn} ${argRefs}`;
  const r = spawnSync('bash', ['-c', script, LIB, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...(opts.env ?? {}) },
    cwd: opts.cwd ?? ROOT,
  });
  return {
    exitCode: r.status ?? -1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

describe('session_dir', () => {
  test('echoes ${GSTACK_STATE_ROOT}/projects/<slug>/<skill>', () => {
    const stateRoot = join(baseTmp, 'state-explicit');
    const r = runFn('session_dir', ['pair-review'], {
      env: { GSTACK_STATE_ROOT: stateRoot },
    });
    expect(r.exitCode).toBe(0);
    // Slug comes from the real gstack-slug since cwd is the repo root.
    // We just assert the prefix and suffix; the slug value is environment-
    // specific but stable for this repo.
    expect(r.stdout).toStartWith(`${stateRoot}/projects/`);
    expect(r.stdout).toEndWith('/pair-review');
  });

  test('defaults GSTACK_STATE_ROOT to $HOME/.gstack', () => {
    const fakeHome = join(baseTmp, 'home-default');
    mkdirSync(fakeHome, { recursive: true });
    const r = runFn('session_dir', ['full-review'], {
      env: { HOME: fakeHome, GSTACK_STATE_ROOT: '' },
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toStartWith(`${fakeHome}/.gstack/projects/`);
    expect(r.stdout).toEndWith('/full-review');
  });

  test('falls back to basename PWD when gstack-slug binary is missing', () => {
    // Point HOME at a fresh dir with no .claude/skills/gstack/bin/gstack-slug
    // so the fallback branch runs. Run from a tmpdir whose basename is the
    // expected slug — this lets us assert exact equality.
    const fakeHome = join(baseTmp, 'home-no-gstack');
    mkdirSync(fakeHome, { recursive: true });
    const workDir = join(baseTmp, 'no-remote-myrepo');
    mkdirSync(workDir, { recursive: true });
    const stateRoot = join(baseTmp, 'state-fallback');
    const r = runFn('session_dir', ['pair-review'], {
      env: { HOME: fakeHome, GSTACK_STATE_ROOT: stateRoot },
      cwd: workDir,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe(`${stateRoot}/projects/no-remote-myrepo/pair-review`);
  });

  test('sanitizes basename PWD to [a-zA-Z0-9._-] when falling back', () => {
    const fakeHome = join(baseTmp, 'home-sanitize');
    mkdirSync(fakeHome, { recursive: true });
    // mkdtemp/mkdir on POSIX rejects '/' so we use chars that are legal in
    // dir names but get stripped by tr -cd: spaces and ! are dropped, .
    // and - survive.
    const workDir = join(baseTmp, 'weird name!.test-dir');
    mkdirSync(workDir, { recursive: true });
    const stateRoot = join(baseTmp, 'state-sanitize');
    const r = runFn('session_dir', ['roadmap-proposals'], {
      env: { HOME: fakeHome, GSTACK_STATE_ROOT: stateRoot },
      cwd: workDir,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe(`${stateRoot}/projects/weirdname.test-dir/roadmap-proposals`);
  });

  test('returns 1 with stderr when skill arg is empty', () => {
    const r = runFn('session_dir', ['']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('skill argument required');
    expect(r.stdout).toBe('');
  });
});

describe('session_archive_dir', () => {
  test('composes -archived-<ts> sibling path', () => {
    const stateRoot = join(baseTmp, 'state-archive');
    const r = runFn('session_archive_dir', ['pair-review', '20260507-091500'], {
      env: { GSTACK_STATE_ROOT: stateRoot },
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toStartWith(`${stateRoot}/projects/`);
    expect(r.stdout).toEndWith('/pair-review-archived-20260507-091500');
  });

  test('returns 1 when skill arg is empty', () => {
    const r = runFn('session_archive_dir', ['', '20260507-091500']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('skill and ts arguments required');
  });

  test('returns 1 when ts arg is empty', () => {
    const r = runFn('session_archive_dir', ['pair-review', '']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('skill and ts arguments required');
  });
});

describe('_session_resolve_slug', () => {
  test('uses gstack-slug output when binary is available (real repo)', () => {
    // Run from the actual repo root; gstack-slug should produce a non-empty
    // slug derived from the git remote. We assert non-empty + sanitized
    // rather than a specific value (it depends on remote config).
    const r = runFn('_session_resolve_slug', [], {});
    expect(r.exitCode).toBe(0);
    expect(r.stdout.length).toBeGreaterThan(0);
    expect(r.stdout).toMatch(/^[a-zA-Z0-9._-]+$/);
  });

  test('falls back to "unknown-project" when basename is fully stripped', () => {
    const fakeHome = join(baseTmp, 'home-stripped');
    mkdirSync(fakeHome, { recursive: true });
    // Directory name with ZERO sanitized chars: only '!' and '@' survive
    // creation but tr -cd 'a-zA-Z0-9._-' strips both, leaving "".
    const workDir = join(baseTmp, '!@!@');
    mkdirSync(workDir, { recursive: true });
    const r = runFn('_session_resolve_slug', [], {
      env: { HOME: fakeHome },
      cwd: workDir,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('unknown-project');
  });
});
