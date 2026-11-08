import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '..');
const REPO_ROOT_REAL = realpathSync(REPO_ROOT);
const SCRIPT_REL = 'scripts/full-suite.sh';
const SCRIPT_PATH = join(REPO_ROOT, SCRIPT_REL);
const CLAUDE_REL = 'CLAUDE.md';

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

interface StubCall {
  pwd: string;
  evalsAll: string;
  args: string[];
}

function parseStubLog(raw: string): StubCall[] {
  return raw
    .split('---END---\n')
    .filter(block => block.length > 0)
    .map(block => {
      const lines = block.replace(/\n$/, '').split('\n');
      let pwd = '';
      let evalsAll = '';
      const args: string[] = [];
      for (const line of lines) {
        if (line.startsWith('PWD=')) pwd = line.slice(4);
        else if (line.startsWith('EVALS_ALL=')) evalsAll = line.slice('EVALS_ALL='.length);
        else if (line.startsWith('ARG=')) args.push(line.slice(4));
      }
      return { pwd: realpathSync(pwd), evalsAll, args };
    });
}

describe('scripts/full-suite.sh', () => {
  // Value: protects=the script's bash shebang, strict mode, CDPATH unset before the repo-root cd, frozen-lockfile install, exported EVALS_ALL=1
  //   and exec passthrough order;
  //   fails_when=any required line is removed or reordered so install no longer runs in the repo root before the full test exec;
  //   why_new=scripts/full-suite.sh is a new entrypoint with no existing content lock; seam=none
  test('locks the script contents and line order', () => {
    const lines = readFileSync(SCRIPT_PATH, 'utf8').split('\n');
    expect(lines[0]).toBe('#!/usr/bin/env bash');
    expect(lines).toContain('set -euo pipefail');

    const unsetIdx = lines.indexOf('unset CDPATH');
    const cdIdx = lines.indexOf('cd "$(dirname "$0")/.."');
    const installIdx = lines.indexOf('bun install --frozen-lockfile');
    const exportIdx = lines.indexOf('export EVALS_ALL=1');
    const execIdx = lines.indexOf('exec bun run test "$@"');

    expect(unsetIdx).toBeGreaterThan(0);
    expect(cdIdx).toBeGreaterThan(unsetIdx);
    expect(installIdx).toBeGreaterThan(cdIdx);
    expect(exportIdx).toBeGreaterThan(0);
    expect(execIdx).toBeGreaterThan(installIdx);
    expect(execIdx).toBeGreaterThan(exportIdx);
  });

  // Value: protects=direct execution without a shell wrapper on the filesystem and in the git index once tracked;
  //   fails_when=scripts/full-suite.sh loses its user-executable bit on disk or is staged as 100644;
  //   why_new=callers without a shell invoke scripts/full-suite.sh directly; seam=none
  test('keeps the executable bit on disk and in the git index when tracked', () => {
    expect(statSync(SCRIPT_PATH).mode & 0o100).not.toBe(0);

    const ls = spawnSync('git', ['ls-files', '-s', '--', SCRIPT_REL], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(ls.status).toBe(0);
    const tracked = ls.stdout.trim();
    if (tracked.length > 0) {
      expect(tracked.startsWith('100755 ')).toBe(true);
    }
  });

  // Value: protects=direct execution from a foreign cwd runs bun install --frozen-lockfile in the repo root, then
  //   execs bun run test with EVALS_ALL=1 and unchanged argv, propagates the suite exit code, and stops before tests on install failure;
  //   the documented relative call with an exported CDPATH still lands in the repo root;
  //   fails_when=the script fails to cd (including through CDPATH), drops or splits extra arguments, omits EVALS_ALL=1, loses the exit code, or runs tests after an install error;
  //   why_new=line-level content checks alone do not execute the script or verify runtime env, argv, cwd and exit propagation; seam=stub bun on PATH
  test('executes directly against a stub bun with repo-root cd, install-then-test order, EVALS_ALL=1, argv passthrough and install-failure abort', () => {
    const dir = mkdtempSync(join(tmpdir(), 'full-suite-script-'));
    tempDirs.push(dir);

    const stubBun = join(dir, 'bun');
    writeFileSync(
      stubBun,
      [
        '#!/bin/sh',
        '{',
        '  printf "PWD=%s\\n" "$PWD"',
        '  printf "EVALS_ALL=%s\\n" "${EVALS_ALL-unset}"',
        '  for arg in "$@"; do',
        '    printf "ARG=%s\\n" "$arg"',
        '  done',
        '  printf -- "---END---\\n"',
        '} >> "$STUB_BUN_LOG"',
        'if [ "${1-}" = "install" ]; then',
        '  exit "${STUB_INSTALL_EXIT:-0}"',
        'fi',
        'exit "${STUB_SUITE_EXIT:-0}"',
        '',
      ].join('\n'),
    );
    chmodSync(stubBun, 0o755);

    let callSeq = 0;
    const runScript = (opts: {
      installExit: number;
      suiteExit: number;
      args: string[];
      command?: string;
      cwd?: string;
      extraEnv?: NodeJS.ProcessEnv;
    }) => {
      const logPath = join(dir, `bun-calls-${++callSeq}.log`);
      const env: NodeJS.ProcessEnv = { ...process.env };
      delete env.EVALS_ALL;
      delete env.CDPATH;
      env.PATH = `${dir}:${process.env.PATH ?? ''}`;
      env.STUB_BUN_LOG = logPath;
      env.STUB_INSTALL_EXIT = String(opts.installExit);
      env.STUB_SUITE_EXIT = String(opts.suiteExit);
      Object.assign(env, opts.extraEnv);

      const res = spawnSync(opts.command ?? SCRIPT_PATH, opts.args, {
        cwd: opts.cwd ?? dir,
        env,
        encoding: 'utf8',
        timeout: 60_000,
      });
      const calls = existsSync(logPath) ? parseStubLog(readFileSync(logPath, 'utf8')) : [];
      return { res, calls };
    };

    const withArgs = runScript({
      installExit: 0,
      suiteExit: 3,
      args: ['--bail', 'tests/a b.test.ts'],
    });
    expect(withArgs.res.status).toBe(3);
    expect(withArgs.calls).toEqual([
      {
        pwd: REPO_ROOT_REAL,
        evalsAll: 'unset',
        args: ['install', '--frozen-lockfile'],
      },
      {
        pwd: REPO_ROOT_REAL,
        evalsAll: '1',
        args: ['run', 'test', '--bail', 'tests/a b.test.ts'],
      },
    ]);

    const bare = runScript({
      installExit: 0,
      suiteExit: 0,
      args: [],
    });
    expect(bare.res.status).toBe(0);
    expect(bare.calls).toEqual([
      {
        pwd: REPO_ROOT_REAL,
        evalsAll: 'unset',
        args: ['install', '--frozen-lockfile'],
      },
      {
        pwd: REPO_ROOT_REAL,
        evalsAll: '1',
        args: ['run', 'test'],
      },
    ]);

    const failedInstall = runScript({
      installExit: 7,
      suiteExit: 0,
      args: ['--bail'],
    });
    expect(failedInstall.res.status).toBe(7);
    expect(failedInstall.calls).toEqual([
      {
        pwd: REPO_ROOT_REAL,
        evalsAll: 'unset',
        args: ['install', '--frozen-lockfile'],
      },
    ]);

    // The documented relative call makes the root cd operand relative (`scripts/..`), which bash
    // resolves through an exported CDPATH; a decoy entry holding `scripts/` must not capture it.
    const decoy = join(dir, 'cdpath-decoy');
    mkdirSync(join(decoy, 'scripts'), { recursive: true });
    const relativeWithCdpath = runScript({
      installExit: 0,
      suiteExit: 0,
      args: [],
      command: SCRIPT_REL,
      cwd: REPO_ROOT,
      extraEnv: { CDPATH: decoy },
    });
    expect(relativeWithCdpath.res.status).toBe(0);
    expect(relativeWithCdpath.res.stdout).toBe('');
    expect(relativeWithCdpath.calls).toEqual([
      {
        pwd: REPO_ROOT_REAL,
        evalsAll: 'unset',
        args: ['install', '--frozen-lockfile'],
      },
      {
        pwd: REPO_ROOT_REAL,
        evalsAll: '1',
        args: ['run', 'test'],
      },
    ]);
  });

  // Value: protects=CLAUDE.md's Testing section naming scripts/full-suite.sh as the fresh-checkout full-run entrypoint;
  //   fails_when=the Testing section drops the scripts/full-suite.sh reference;
  //   why_new=Criterion 4 requires CLAUDE.md's Testing section to document the script; seam=none
  test('CLAUDE.md Testing section names scripts/full-suite.sh', () => {
    const claude = readFileSync(join(REPO_ROOT, CLAUDE_REL), 'utf8');
    const start = claude.indexOf('## Testing');
    expect(start).toBeGreaterThanOrEqual(0);
    const nextHeading = claude.indexOf('\n## ', start + 1);
    const testingSection = claude.slice(start, nextHeading === -1 ? undefined : nextHeading);
    expect(testingSection).toContain(SCRIPT_REL);
  });
});
