/**
 * run-bin.ts — uniform spawnSync wrapper for invoking shell binaries from
 * tests, with consistent env scoping and a per-call HOME requirement.
 *
 * Why a helper: 5+ test sites (audit-snapshots, audit-cli-contract, update,
 * audit-shadow, possibly test-plan-e2e) shell out to bash binaries. Each
 * needs the same env shape (GSTACK_EXTEND_DIR, GSTACK_EXTEND_STATE_DIR,
 * isolated HOME) and stderr capture. Inlining 5x is the duplication
 * codex flagged.
 *
 * Defense-in-depth: callers MUST pass `home` (no defaulting to
 * process.env.HOME) so concurrent test files can't pollute each other's
 * mock $HOME. The helper enforces this at the type level.
 */

import { spawnSync, type SpawnSyncOptions } from 'node:child_process';

export type RunBinOpts = {
  /**
   * Mock $HOME for the spawned process. Required — no defaulting to
   * process.env.HOME. Pass a per-test mkdtemp dir.
   */
  home: string;
  /**
   * GSTACK_EXTEND_DIR — repo root for the spawned binary to find its
   * lib files. Usually the test file's `ROOT` constant.
   */
  gstackExtendDir: string;
  /**
   * GSTACK_EXTEND_STATE_DIR — per-test state isolation. Pass a per-test
   * mkdtemp dir so user-level config can't leak in.
   */
  gstackExtendStateDir: string;
  /**
   * Extra env vars merged on top of the defaults. Use for binary-specific
   * vars like GSTACK_EXTEND_REMOTE_URL.
   */
  extraEnv?: Record<string, string>;
  /**
   * Per-call timeout in ms. Defaults to 60_000 (matches audit-shadow).
   */
  timeout?: number;
  /**
   * Working directory for the spawned process. Optional. When unset, the
   * spawned process inherits the test process's cwd (typically the repo
   * root) — fine for most calls. Pass a tmpdir when the binary's behavior
   * depends on cwd and you want isolation (e.g., `bin/roadmap-audit` with
   * no repo arg auto-detects from cwd).
   */
  cwd?: string;
};

export type RunBinResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

/**
 * Spawn `binPath` with `args`, return captured stdout/stderr/exitCode.
 *
 * Inherits PATH and a few harmless env vars from the parent (so e.g.
 * `git` and `bash` resolve), but explicitly scopes HOME, GSTACK_EXTEND_*,
 * and TMPDIR.
 */
export function runBin(binPath: string, args: string[], opts: RunBinOpts): RunBinResult {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: opts.home,
    GSTACK_EXTEND_DIR: opts.gstackExtendDir,
    GSTACK_EXTEND_STATE_DIR: opts.gstackExtendStateDir,
  };
  // Preserve TMPDIR so mktemp inside the spawned binary stays inside the
  // test's tmp tree (most CI runners set TMPDIR; macOS sets it via launchd).
  if (process.env.TMPDIR !== undefined) env.TMPDIR = process.env.TMPDIR;
  if (opts.extraEnv) Object.assign(env, opts.extraEnv);

  const spawnOpts: SpawnSyncOptions = {
    encoding: 'utf8',
    env,
    timeout: opts.timeout ?? 60_000,
  };
  if (opts.cwd !== undefined) spawnOpts.cwd = opts.cwd;
  const r = spawnSync(binPath, args, spawnOpts);
  return {
    stdout: typeof r.stdout === 'string' ? r.stdout : '',
    stderr: typeof r.stderr === 'string' ? r.stderr : '',
    exitCode: r.status,
  };
}
