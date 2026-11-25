/**
 * git.ts — typed gateway over every git subprocess call the audit makes.
 *
 * Per D3 of the eng review, this is the ONLY module in src/audit/** that may
 * spawn subprocesses. tests/audit-no-stray-shellouts.test.ts enforces that
 * by failing the build if Bun.$ / Bun.spawn / child_process appears anywhere
 * else under src/audit/.
 *
 * Surface (covers every git invocation in the bash audit):
 *   toplevel()                     git rev-parse --show-toplevel
 *   tags()                         git tag --list  (lexicographic)
 *   tagsLatest()                   git --no-pager tag --list --sort=-v:refname | head -1
 *   mergeBase(ref)                 git merge-base HEAD ref
 *   diffNamesBetween(from, to)     git --no-pager diff --name-only from..to
 *   logFirstWithPhrase(phrase, f)  git log -1 --format=%ai -S "phrase" -- f
 *   logSubjectsSince(since, f)     git log --format=%s --after=since -- f
 *
 * All methods return plain TS values; failures (git missing, non-repo cwd,
 * empty output) return null / [] rather than throwing. Match bash's
 * `2>/dev/null || true` semantics exactly — the audit must keep running
 * even when git is unhealthy.
 *
 * LC_ALL=C parity: env LC_ALL=C is forced on every spawn so byte-order of
 * git output (tags, paths, subjects) matches bash regardless of the
 * shell's locale.
 */

import { spawnSync } from 'node:child_process';

export type GitSpawnResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

export type GitSpawn = (args: string[], cwd: string) => GitSpawnResult;

export type GitGateway = {
  /** Resolve repository root, or null if not in a repo. */
  toplevel(): string | null;
  /** Return all tags (lexicographic order — for callers that want bare list). */
  tags(): string[];
  /** Latest tag by `sort=-v:refname` semantics, or null. */
  tagsLatest(): string | null;
  /** merge-base of HEAD and `ref`, or null if the ref is missing. */
  mergeBase(ref: string): string | null;
  /** File names changed between two refs (e.g., latestTag..HEAD). */
  diffNamesBetween(from: string, to: string): string[];
  /** Date of the most recent commit that added/removed `phrase` in `file`. */
  logFirstWithPhrase(phrase: string, file: string): { date: string } | null;
  /** Subjects of commits to `file` since `sinceISO`. */
  logSubjectsSince(sinceISO: string, file: string): string[];
  /** Union of unstaged, staged, and untracked paths (drift check). */
  workingTreePaths(): string[];
};

export type GitGatewayDeps = {
  cwd: string;
  spawn?: GitSpawn;
};

export const defaultSpawn: GitSpawn = (args, cwd) => {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C', GIT_PAGER: 'cat' },
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
};

export function createGitGateway(deps: GitGatewayDeps): GitGateway {
  const spawn = deps.spawn ?? defaultSpawn;
  const cwd = deps.cwd;

  const splitLines = (s: string): string[] => {
    if (s === '') return [];
    return s.replace(/\n$/, '').split('\n');
  };

  return {
    toplevel(): string | null {
      const r = spawn(['rev-parse', '--show-toplevel'], cwd);
      if (!r.ok) return null;
      const out = r.stdout.trim();
      return out === '' ? null : out;
    },

    tags(): string[] {
      const r = spawn(['tag', '--list'], cwd);
      if (!r.ok) return [];
      return splitLines(r.stdout);
    },

    tagsLatest(): string | null {
      const r = spawn(['--no-pager', 'tag', '--list', '--sort=-v:refname'], cwd);
      if (!r.ok) return null;
      const lines = splitLines(r.stdout);
      return lines[0] ?? null;
    },

    mergeBase(ref: string): string | null {
      const r = spawn(['merge-base', 'HEAD', ref], cwd);
      if (!r.ok) return null;
      const out = r.stdout.trim();
      return out === '' ? null : out;
    },

    diffNamesBetween(from: string, to: string): string[] {
      const r = spawn(['--no-pager', 'diff', '--name-only', `${from}..${to}`], cwd);
      if (!r.ok) return [];
      return splitLines(r.stdout);
    },

    logFirstWithPhrase(phrase: string, file: string): { date: string } | null {
      const r = spawn(['log', '-1', '--format=%ai', '-S', phrase, '--', file], cwd);
      if (!r.ok) return null;
      const date = r.stdout.trim();
      if (date === '') return null;
      return { date };
    },

    logSubjectsSince(sinceISO: string, file: string): string[] {
      const r = spawn(['log', '--format=%s', `--after=${sinceISO}`, '--', file], cwd);
      if (!r.ok) return [];
      return splitLines(r.stdout);
    },

    workingTreePaths(): string[] {
      const out = new Set<string>();
      const batches: string[][] = [
        ['diff', '--name-only', 'HEAD'],
        ['diff', '--name-only', '--cached'],
        ['ls-files', '--others', '--exclude-standard'],
      ];
      for (const args of batches) {
        const r = spawn(args, cwd);
        if (!r.ok) continue;
        for (const line of splitLines(r.stdout)) {
          if (line !== '') out.add(line);
        }
      }
      return [...out].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    },
  };
}
