/**
 * git.ts — read-only git plumbing for docs-ship: refs, the PR's own diff
 * (merge-base to head), hunks, blobs at a revision and tracked files.
 */
import { spawnSync } from 'node:child_process';

export class Refusal extends Error {
  constructor(public code: string, message: string, public fix: string, public exit = 3) {
    super(message);
  }
}

export type GitResult = { code: number; stdout: string; stderr: string };
export type Git = (args: string[], allowFail?: boolean) => GitResult;

export function gitIn(cwd: string): Git {
  return (args, allowFail = false) => {
    const r = spawnSync('git', ['-c', 'core.quotepath=off', '--no-pager', '--literal-pathspecs', ...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
    });
    const code = r.status ?? 1;
    if (code !== 0 && !allowFail) {
      throw new Refusal('GIT_FAILED', `git ${args.join(' ')} failed: ${(r.stderr ?? '').trim()}`, 'run it inside the PR checkout with the base fetched');
    }
    return { code, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
}

export function topLevel(cwd: string): string {
  const r = gitIn(cwd)(['rev-parse', '--show-toplevel'], true);
  if (r.code !== 0) throw new Refusal('NOT_A_REPO', `${cwd} is not inside a git repository`, 'run docs-ship from the PR checkout');
  return r.stdout.trim();
}

export function commitOf(git: Git, ref: string, flag: string): string {
  const r = git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`], true);
  if (r.code !== 0) throw new Refusal('BAD_REF', `${flag} ${ref} is not a commit`, `fetch it first (git fetch origin) or pass a commit`);
  return r.stdout.trim();
}

export function mergeBase(git: Git, base: string, head: string): string {
  const r = git(['merge-base', base, head], true);
  if (r.code !== 0) throw new Refusal('NO_MERGE_BASE', 'base and head share no history', 'pass the PR base branch as --base');
  return r.stdout.trim();
}

export type Change = { status: string; path: string; oldMode: string; newMode: string };

/** The PR's own changes: merge-base to head, renames split into delete + add. */
export function changes(git: Git, from: string, to: string): Change[] {
  const out = git(['diff', '--raw', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', from, to]).stdout;
  const parts = out.split('\0');
  const list: Change[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const meta = parts[i]!;
    if (!meta.startsWith(':')) break;
    const [oldMode, newMode, , , status] = meta.slice(1).split(' ');
    list.push({ status: (status ?? '?').charAt(0), path: parts[i + 1]!, oldMode: oldMode!, newMode: newMode! });
  }
  return list;
}

export type Line = { line: number; text: string };
export type Hunks = { added: Line[]; removed: Line[]; removedAt: number[] };

/** Added lines carry head line numbers; removed lines carry base line numbers and the head line they sat at. */
export function hunks(git: Git, from: string, to: string, path: string): Hunks {
  const out = git(['diff', '-U0', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', '--text', '--no-color', from, to, '--', path]).stdout;
  const result: Hunks = { added: [], removed: [], removedAt: [] };
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const raw of out.split('\n')) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (h) {
      oldLine = Number(h[1]);
      newLine = Number(h[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (raw.startsWith('+')) {
      result.added.push({ line: newLine, text: raw.slice(1) });
      newLine++;
    } else if (raw.startsWith('-')) {
      result.removed.push({ line: oldLine, text: raw.slice(1) });
      result.removedAt.push(Math.max(newLine, 1));
      oldLine++;
    } else if (raw.startsWith(' ')) {
      oldLine++;
      newLine++;
    }
  }
  return result;
}

/** Tracked path type at a revision: blob, tree, or undefined when absent. */
export function objectType(git: Git, rev: string, path: string): string | undefined {
  const r = git(['cat-file', '-t', `${rev}:${path}`], true);
  return r.code === 0 ? r.stdout.trim() : undefined;
}

function modeOf(git: Git, rev: string, path: string): string | undefined {
  const r = git(['ls-tree', '-z', rev, '--', path], true);
  if (r.code !== 0 || r.stdout === '') return undefined;
  return r.stdout.split(' ')[0];
}

/** Blob text at a revision, following in-repo symlinks; undefined when absent. */
export function readAt(git: Git, rev: string, path: string): string | undefined {
  let current = path;
  for (let hop = 0; hop < 5; hop++) {
    const mode = modeOf(git, rev, current);
    if (mode === undefined) return undefined;
    const r = git(['cat-file', 'blob', `${rev}:${current}`], true);
    if (r.code !== 0) return undefined;
    if (mode !== '120000') return r.stdout;
    const dir = current.includes('/') ? current.slice(0, current.lastIndexOf('/')) : '';
    const next = normalizePath(dir, r.stdout.trim());
    if (next === undefined) return undefined;
    current = next;
  }
  return undefined;
}

/** The repo-relative path a symlinked file resolves to (itself when not a link). */
export function resolvedPath(git: Git, rev: string, path: string): string | undefined {
  let current = path;
  for (let hop = 0; hop < 5; hop++) {
    const mode = modeOf(git, rev, current);
    if (mode === undefined) return undefined;
    if (mode !== '120000') return current;
    const target = git(['cat-file', 'blob', `${rev}:${current}`]).stdout.trim();
    const dir = current.includes('/') ? current.slice(0, current.lastIndexOf('/')) : '';
    const next = normalizePath(dir, target);
    if (next === undefined) return undefined;
    current = next;
  }
  return undefined;
}

export function trackedFiles(git: Git, rev: string): string[] {
  return git(['ls-tree', '-r', '-z', '--name-only', rev]).stdout.split('\0').filter(Boolean);
}

export function worktreeClean(git: Git): boolean {
  return git(['status', '--porcelain=v1', '-z', '--untracked-files=normal']).stdout === '';
}

/** Join a relative target onto a repo-relative directory; undefined when it escapes the root. */
export function normalizePath(dir: string, target: string): string | undefined {
  const parts = target.startsWith('/') ? [] : dir.split('/').filter(Boolean);
  for (const seg of target.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join('/');
}

/** Commit date and subject when the SHA names a commit here; the reason otherwise. */
export function lookupCommit(git: Git, sha: string): { ok: true; detail: string } | { ok: false; reason: string } {
  const r = git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${sha}^{commit}`], true);
  if (r.code !== 0) {
    const ambiguous = git(['rev-parse', '--disambiguate=' + sha], true).stdout.trim().split('\n').filter(Boolean).length > 1;
    return { ok: false, reason: ambiguous ? 'ambiguous' : 'not-found' };
  }
  const full = r.stdout.trim();
  const log = git(['log', '-1', '--format=%cs %s', full], true).stdout.trim();
  return { ok: true, detail: `${full.slice(0, 12)} ${log}` };
}
