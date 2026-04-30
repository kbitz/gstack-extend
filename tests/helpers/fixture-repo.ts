/**
 * fixture-repo.ts — shared helpers for tests that build tmp git repos
 * from `tests/roadmap-audit/<fixture>/files/` (or arbitrary file trees).
 *
 * Used by audit-shadow.test.ts, audit-snapshots.test.ts, audit-cli-contract.test.ts,
 * test-plan-e2e.test.ts. Centralizes:
 *   - per-test mkdtemp isolation (no shared $HOME or cache paths leak)
 *   - deterministic git init (anonymous user, single empty commit baseline)
 *   - recursive file-tree copy (matches bash `cp -R src/. dst/`)
 *
 * Cleanup convention: callers create one base tmpdir at describe()-time, pass
 * it to every setupRepo() call, and register `process.on('exit')` cleanup.
 * Per-test repos live as subdirs of the base tmpdir so they vanish together.
 */

import { mkdtempSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

export type Fixture = {
  name: string;
  dir: string;
  args: string[];
};

/**
 * Walk `tests/roadmap-audit/` and return one Fixture per direct child dir.
 * Reads optional `args` file (whitespace-split, no quoting) per fixture.
 *
 * Stable lexicographic order so test names are deterministic.
 */
export function loadFixtures(fixturesDir: string): Fixture[] {
  const out: Fixture[] = [];
  for (const name of readdirSync(fixturesDir)) {
    const dir = join(fixturesDir, name);
    if (!statSync(dir).isDirectory()) continue;
    const argsFile = join(dir, 'args');
    let args: string[] = [];
    try {
      const raw = readFileSync(argsFile, 'utf8').trim();
      args = raw === '' ? [] : raw.split(/\s+/);
    } catch {
      // No args file — empty args.
    }
    out.push({ name, dir, args });
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

/**
 * Create a tmpdir under `baseTmp`, copy the fixture's `files/` subtree (if
 * any) into it, and `git init` + commit so the audit can read git state.
 *
 * Returns the absolute repo path.
 */
export function setupRepo(fixtureDir: string, baseTmp: string): string {
  const repo = mkdtempSync(join(baseTmp, 'fix-'));
  const filesDir = join(fixtureDir, 'files');
  if (statSync(filesDir, { throwIfNoEntry: false })?.isDirectory()) {
    copyDirSync(filesDir, repo);
  }
  // --initial-branch=main is consistent with makeEmptyRepo() and avoids
  // git's user-default falling back to "master" on older installs (which
  // breaks main-branch-aware audit checks like FRESHNESS).
  // Check exit codes — silent git failures (xcrun trip on first run, missing
  // git binary, OOM during commit) used to produce confusing audit-side
  // errors. Surface the spawn failure here instead.
  runGit(repo, ['init', '--quiet', '--initial-branch=main']);
  runGit(repo, ['config', 'user.email', 't@t.com']);
  runGit(repo, ['config', 'user.name', 'T']);
  runGit(repo, ['add', '-A']);
  runGit(repo, ['commit', '-m', 'init', '--quiet', '--allow-empty']);
  return repo;
}

function runGit(repo: string, args: string[]): void {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${r.status}): ${r.stderr ?? '(no stderr)'}`);
  }
}

/**
 * Create a fresh empty repo at `baseTmp/<random>` with anonymous git config
 * and an empty initial commit. Caller writes files + commits as needed.
 */
export function makeEmptyRepo(baseTmp: string): string {
  const repo = mkdtempSync(join(baseTmp, 'repo-'));
  spawnSync('git', ['-C', repo, 'init', '--quiet', '--initial-branch=main'], { encoding: 'utf8' });
  spawnSync('git', ['-C', repo, 'config', 'user.email', 't@t.com'], { encoding: 'utf8' });
  spawnSync('git', ['-C', repo, 'config', 'user.name', 'T'], { encoding: 'utf8' });
  spawnSync('git', ['-C', repo, 'commit', '--allow-empty', '-m', 'init', '--quiet'], {
    encoding: 'utf8',
  });
  return repo;
}

/**
 * Recursive directory copy — matches bash `cp -R src/. dst/` semantics
 * (dotfiles included, dst created if missing).
 */
export function copyDirSync(src: string, dst: string): void {
  for (const name of readdirSync(src)) {
    const srcPath = join(src, name);
    const dstPath = join(dst, name);
    const st = statSync(srcPath);
    if (st.isDirectory()) {
      mkdirSync(dstPath, { recursive: true });
      copyDirSync(srcPath, dstPath);
    } else {
      mkdirSync(dirname(dstPath), { recursive: true });
      writeFileSync(dstPath, readFileSync(srcPath));
    }
  }
}

/**
 * Allocate a fresh base tmpdir for a test file; caller is responsible for
 * registering exit-time cleanup (typically `process.on('exit', () => rmSync(...))`).
 */
export function makeBaseTmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}
