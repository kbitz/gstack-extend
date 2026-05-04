#!/usr/bin/env bun
/**
 * select-tests.ts — `bun test` wrapper that narrows by `git diff` from a
 * detected base branch. Wired into `package.json scripts.test`.
 *
 * Behavior:
 *   - User-supplied argv (any args after `bun run test --`) bypasses
 *     selection and runs `bun test <argv>` verbatim. This preserves
 *     `bun test --watch foo.test.ts`, `bun test path/to/specific.test.ts`,
 *     etc. Selection only fires for the bare `bun run test` call.
 *   - EVALS_ALL=1 also bypasses selection.
 *   - Four safety fallbacks force run-all (logged):
 *       1. empty diff
 *       2. base branch missing
 *       3. global touchfile hit
 *       4. non-empty diff but zero tests selected
 *   - Spawns `bun test ${selected}`, propagates exit code, forwards
 *     SIGINT/SIGTERM to the child.
 *
 * Run `bun run test:full` to skip the wrapper entirely.
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import {
  computeTestSelection,
  detectBaseBranch,
  getChangedFiles,
  listTestFiles,
} from '../tests/helpers/touchfiles.ts';

const REPO_ROOT = resolve(import.meta.dir, '..');

export type WrapperAction =
  | { kind: 'argv'; args: string[]; log: string }
  | { kind: 'all'; reason: string; log: string }
  | { kind: 'select'; selected: string[]; log: string };

/**
 * Pure decision function — given argv, env, and cwd, return the action
 * the wrapper should take. Side-effect-free except for git/fs reads via
 * detectBaseBranch / getChangedFiles / listTestFiles / analyzeTestImports.
 *
 * Tests construct a fixture repo and pass `cwd` to exercise every branch.
 */
export function planWrapperAction(opts: {
  argv: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
}): WrapperAction {
  if (opts.argv.length > 0) {
    return {
      kind: 'argv',
      args: opts.argv,
      log: `argv passthrough: bun test ${opts.argv.join(' ')}`,
    };
  }
  if (opts.env.EVALS_ALL === '1') {
    return { kind: 'all', reason: 'evals_all', log: 'EVALS_ALL=1 → running all tests' };
  }
  const base = detectBaseBranch(opts.cwd, opts.env);
  if (!base) {
    return {
      kind: 'all',
      reason: 'no-base',
      log: 'no base branch found (origin/main, origin/master, main, master) → running all',
    };
  }
  const changed = getChangedFiles(base, opts.cwd);
  const testFiles = listTestFiles(opts.cwd);
  const sel = computeTestSelection(changed, testFiles, { repoRoot: opts.cwd });

  if (sel.reason === 'empty-diff') {
    return { kind: 'all', reason: 'empty-diff', log: `empty diff vs ${base} → running all` };
  }
  if (sel.reason.startsWith('global')) {
    return { kind: 'all', reason: 'global', log: `${sel.reason} → running all` };
  }
  if (sel.reason === 'no-match-fallback') {
    const sample = changed.slice(0, 3).join(', ');
    const ellipsis = changed.length > 3 ? ', ...' : '';
    return {
      kind: 'all',
      reason: 'no-match-fallback',
      log: `${changed.length} changed file(s), 0 tests matched (${sample}${ellipsis}) → running all`,
    };
  }
  return {
    kind: 'select',
    selected: sel.selected,
    log: `selected: ${sel.selected.length}/${testFiles.length}, skipped: ${sel.skipped.length}, reason: ${sel.reason}`,
  };
}

function log(msg: string): void {
  process.stderr.write(`[select-tests] ${msg}\n`);
}

function runBunTest(args: string[], cwd: string): never {
  const child = spawn('bun', ['test', ...args], { cwd, stdio: 'inherit' });
  const forward = (sig: NodeJS.Signals) => {
    if (!child.killed) child.kill(sig);
  };
  process.on('SIGINT', () => forward('SIGINT'));
  process.on('SIGTERM', () => forward('SIGTERM'));
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
  return undefined as never;
}

if (import.meta.main) {
  const action = planWrapperAction({
    argv: process.argv.slice(2),
    env: process.env,
    cwd: REPO_ROOT,
  });
  log(action.log);
  switch (action.kind) {
    case 'argv':
      runBunTest(action.args, REPO_ROOT);
      break;
    case 'all':
      runBunTest(['tests/'], REPO_ROOT);
      break;
    case 'select':
      runBunTest(action.selected, REPO_ROOT);
      break;
  }
}
