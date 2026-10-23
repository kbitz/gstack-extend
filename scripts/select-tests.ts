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
 *   - A package.json change to its version field alone is not a global hit
 *     (packageJsonChange in tests/helpers/touchfiles.ts).
 *   - Spawns `bun test --timeout 30000 ${selected}` unless argv already
 *     sets `--timeout`. Propagates the exit code and forwards
 *     SIGINT/SIGTERM to the child.
 *
 * Every run prints a selection report to stderr: each test file that runs,
 * each one skipped, and why. A caller-chosen file list (pregate's runner form)
 * is reported against the diff selection, so a file the diff selects but the
 * caller did not request is named. TEST_SELECTION_OUT=<file> also writes the
 * report as JSON (`schema: select-tests/v1`). A skipped file did not run; the
 * report never counts it as passed.
 *
 * Run `bun run test:full` to skip the wrapper entirely.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  PACKAGE_JSON,
  computeTestSelection,
  detectBaseBranch,
  getChangedFiles,
  listTestFiles,
  packageJsonChange,
  type Selection,
} from '../tests/helpers/touchfiles.ts';

const REPO_ROOT = resolve(import.meta.dir, '..');

export const REPORT_SCHEMA = 'select-tests/v1';

/** One test file in the report and why it ran or was skipped. */
export type ReportEntry = { file: string; why: string };

export type SelectionReport = {
  schema: typeof REPORT_SCHEMA;
  /** `select`: the diff chose; `all`: every file runs; `argv`: the caller chose. */
  mode: 'select' | 'all' | 'argv';
  reason: string;
  base: string | null;
  changed: string[];
  notes: string[];
  total: number;
  ran: ReportEntry[];
  skipped: ReportEntry[];
};

export type WrapperAction =
  | { kind: 'argv'; args: string[]; log: string; report: SelectionReport }
  | { kind: 'all'; reason: string; log: string; report: SelectionReport }
  | { kind: 'select'; selected: string[]; log: string; report: SelectionReport };

const SKIPPED_WHY = 'no changed file is a dependency';

function report(fields: Omit<SelectionReport, 'schema'>): SelectionReport {
  return { schema: REPORT_SCHEMA, ...fields };
}

/** Why the diff selected `test`, from its hits: `skills/x.md (declared skills/**)`, `src/a.ts (import)`. */
export function hitWhy(sel: Selection, test: string): string {
  const hits = sel.hits?.[test] ?? [];
  const parts = hits.map(h => h.via === 'self' ? `${h.file} (the test itself)` : h.via === 'import' ? `${h.file} (import)` : `${h.file} (declared ${h.glob})`);
  return parts.length > 3 ? `${parts.slice(0, 3).join('; ')}; +${parts.length - 3} more` : parts.join('; ');
}

/** Test files named exactly by argv, or null when argv holds anything else (flags, filters). */
function requestedFiles(argv: string[], testFiles: string[]): string[] | null {
  const files = argv.map(a => a.replace(/^\.\//, ''));
  return files.length > 0 && files.every(f => testFiles.includes(f)) ? files : null;
}

/** The diff selection, or why there is none. */
function diffSelection(env: NodeJS.ProcessEnv, cwd: string, testFiles: string[]):
  | { base: null }
  | { base: string; changed: string[]; notes: string[]; sel: Selection } {
  const base = detectBaseBranch(cwd, env);
  if (!base) return { base: null };
  const changed = getChangedFiles(base, cwd);
  const notes: string[] = [];
  let packageJsonVersionOnly = false;
  if (changed.includes(PACKAGE_JSON)) {
    packageJsonVersionOnly = packageJsonChange(base, cwd) === 'version-only';
    notes.push(packageJsonVersionOnly
      ? `${PACKAGE_JSON}: only its version field changed, so it is not a global input`
      : `${PACKAGE_JSON}: more than its version field changed, so it is a global input`);
  }
  const sel = computeTestSelection(changed, testFiles, { repoRoot: cwd, packageJsonVersionOnly });
  return { base, changed, notes, sel };
}

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
  // A checkout without tests/ still passes argv through; it just has nothing to report.
  let testFiles: string[] = [];
  try { testFiles = listTestFiles(opts.cwd); } catch { /* no tests/ directory */ }
  const total = testFiles.length;
  if (opts.argv.length > 0) {
    const log = `argv passthrough: bun test ${opts.argv.join(' ')}`;
    const requested = requestedFiles(opts.argv, testFiles);
    if (!requested) {
      return {
        kind: 'argv', args: opts.argv, log,
        report: report({ mode: 'argv', reason: 'argv', base: null, changed: [], notes: ['the arguments are not only test file paths, so the run is not reported file by file'], total, ran: [], skipped: [] }),
      };
    }
    // A caller-chosen list (pregate's `bun run test -- {files}`): name what the diff would also run.
    const diff = diffSelection(opts.env, opts.cwd, testFiles);
    const diffSelected = diff.base && diff.sel.reason === 'diff' ? new Set(diff.sel.selected) : null;
    const notes = diff.base ? [...diff.notes] : ['no base branch found, so the request is not compared with a diff selection'];
    const skipped = testFiles.filter(t => !requested.includes(t)).map(file => ({
      file,
      why: diffSelected?.has(file) && diff.base
        ? `not requested by the caller; the diff selects it: ${hitWhy(diff.sel, file)}`
        : 'not requested by the caller',
    }));
    if (diff.base && diff.sel.reason !== 'diff') notes.push(`the diff selection would run every test file (${diff.sel.reason})`);
    const uncovered = skipped.filter(s => s.why.includes('the diff selects it')).length;
    if (diffSelected) notes.push(uncovered ? `${uncovered} file(s) the diff selects were not requested` : 'the request covers the diff selection');
    return {
      kind: 'argv', args: opts.argv, log,
      report: report({
        mode: 'argv', reason: 'argv', base: diff.base, changed: diff.base ? diff.changed : [], notes, total,
        ran: requested.map(file => ({ file, why: 'requested by the caller' })), skipped,
      }),
    };
  }
  const all = (reason: string, log: string, why: string, extra: Partial<SelectionReport> = {}): WrapperAction => ({
    kind: 'all', reason, log,
    report: report({ mode: 'all', reason, base: null, changed: [], notes: [], total, ran: testFiles.map(file => ({ file, why })), skipped: [], ...extra }),
  });
  if (opts.env.EVALS_ALL === '1') {
    return all('evals_all', 'EVALS_ALL=1 → running all tests', 'EVALS_ALL=1 requests every test');
  }
  const diff = diffSelection(opts.env, opts.cwd, testFiles);
  if (!diff.base) {
    return all('no-base', 'no base branch found (origin/main, origin/master, main, master) → running all', 'no base branch to diff against');
  }
  const { base, changed, notes, sel } = diff;
  const context = { base, changed, notes };

  if (sel.reason === 'empty-diff') {
    return all('empty-diff', `empty diff vs ${base} → running all`, `no committed change against ${base}`, context);
  }
  if (sel.reason.startsWith('global')) {
    return all('global', `${sel.reason} → running all`, `global input (${sel.reason.replace(/^global: /, '')})`, context);
  }
  if (sel.reason === 'no-match-fallback') {
    const sample = changed.slice(0, 3).join(', ');
    const ellipsis = changed.length > 3 ? ', ...' : '';
    return all(
      'no-match-fallback',
      `${changed.length} changed file(s), 0 tests matched (${sample}${ellipsis}) → running all`,
      'no test depends on the changed files, so every test runs',
      context,
    );
  }
  return {
    kind: 'select',
    selected: sel.selected,
    log: `selected: ${sel.selected.length}/${testFiles.length}, skipped: ${sel.skipped.length}, reason: ${sel.reason}`,
    report: report({
      mode: 'select', reason: sel.reason, ...context, total,
      ran: sel.selected.map(file => ({ file, why: hitWhy(sel, file) })),
      skipped: sel.skipped.map(file => ({ file, why: SKIPPED_WHY })),
    }),
  };
}

/** The report as stderr lines (each prefixed by the caller). */
export function reportLines(r: SelectionReport): string[] {
  const lines: string[] = [];
  if (r.base) {
    const shown = r.changed.slice(0, 8).join(', ');
    lines.push(`base ${r.base}; ${r.changed.length} changed file(s)${r.changed.length ? `: ${shown}${r.changed.length > 8 ? ', ...' : ''}` : ''}`);
  }
  for (const note of r.notes) lines.push(`note: ${note}`);
  if (r.mode === 'all') {
    lines.push(`ran all ${r.ran.length} test file(s): ${r.ran[0]?.why ?? r.reason}`);
    return lines;
  }
  for (const e of r.ran) lines.push(`ran ${e.file}: ${e.why}`);
  const groups = new Map<string, string[]>();
  for (const e of r.skipped) groups.set(e.why, [...(groups.get(e.why) ?? []), e.file]);
  for (const [why, files] of groups) lines.push(`skipped ${files.length} (${why}): ${files.join(', ')}`);
  return lines;
}

/** Write the JSON report atomically; a failed write warns and never fails the run. */
export function writeReport(r: SelectionReport, path: string): string | null {
  const target = resolve(path);
  const tmp = `${target}.tmp-${process.pid}`;
  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(tmp, JSON.stringify(r, null, 2) + '\n');
    renameSync(tmp, target);
    return null;
  } catch (e) {
    // Leave nothing behind: a stray temp file inside the checkout would dirty the tested tree.
    try { rmSync(tmp, { force: true }); } catch { /* best effort */ }
    return (e as Error).message;
  }
}

function log(msg: string): void {
  process.stderr.write(`[select-tests] ${msg}\n`);
}

/**
 * Bun's default deadline is 5000ms for a test and for before/after hooks.
 * A synchronous hook cannot be interrupted, so a fixture delete that finishes
 * in a few seconds alone and takes longer under the full suite is failed
 * after it returns. Git-heavy tests cross the same line. 30s covers the
 * slowest cleanup observed (about 15s) without turning a hang into a long
 * wait. An explicit `--timeout` from the caller is left alone.
 */
export const TEST_TIMEOUT_MS = '30000';

export function bunTestArgs(args: string[]): string[] {
  if (args.some((arg) => arg === '--timeout' || arg.startsWith('--timeout='))) return args;
  return ['--timeout', TEST_TIMEOUT_MS, ...args];
}

function runBunTest(args: string[], cwd: string): never {
  const child = spawn('bun', ['test', ...bunTestArgs(args)], { cwd, stdio: 'inherit' });
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
  for (const line of reportLines(action.report)) log(line);
  const out = process.env.TEST_SELECTION_OUT;
  if (out && out.trim() !== '') {
    const failed = writeReport(action.report, out);
    log(failed ? `report not written to ${out}: ${failed}` : `report: ${resolve(out)}`);
  }
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
