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
import { scanAllWorkItemIds } from './work-item-id.ts';

export type GitSpawnResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

export type GitSpawnOptions = {
  maxBuffer?: number;
  env?: NodeJS.ProcessEnv;
};

export type GitSpawn = (args: string[], cwd: string, options?: GitSpawnOptions) => GitSpawnResult;

export type HistoryWorkItemIdsResult =
  | { kind: 'ids'; ids: string[] }
  | { kind: 'not-a-repo' }
  | { kind: 'shallow' }
  | { kind: 'error'; detail: string };

type GitProjectRootResult =
  | { kind: 'root'; path: string }
  | { kind: 'not-a-repo' }
  | { kind: 'error'; detail: string };

export type GitGateway = {
  /** Resolve repository root, or null if not in a repo. */
  toplevel(): string | null;
  /** Resolve a project root without collapsing Git errors into repository absence. */
  projectToplevel(): GitProjectRootResult;
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
  /** Scan local Git history for all work-item IDs across every reachable commit. */
  historyWorkItemIds(): HistoryWorkItemIdsResult;
};

export type GitGatewayDeps = {
  cwd: string;
  spawn?: GitSpawn;
  isolateEnv?: boolean;
};

const HISTORY_MAX_BUFFER = 256 * 1024 * 1024;

const ISOLATED_GIT_ENV_VARS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_INDEX_FILE',
  'GIT_NAMESPACE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_PREFIX',
  'GIT_LITERAL_PATHSPECS',
  'GIT_GLOB_PATHSPECS',
  'GIT_NOGLOB_PATHSPECS',
  'GIT_ICASE_PATHSPECS',
] as const;

function buildIsolatedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_NO_LAZY_FETCH: '1',
    // Also prevent transport on older Git builds when promisor objects are missing.
    GIT_ALLOW_PROTOCOL: '',
  };
  for (const key of ISOLATED_GIT_ENV_VARS) {
    delete env[key];
  }
  return env;
}

function isNotGitRepository(result: GitSpawnResult): boolean {
  return /^fatal: not a git repository(?:[ (:]|$)/i.test(result.stderr);
}

export const defaultSpawn: GitSpawn = (args, cwd, options) => {
  const baseEnv = options?.env ?? process.env;
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...baseEnv, LC_ALL: 'C', GIT_PAGER: 'cat' },
    ...(options?.maxBuffer !== undefined ? { maxBuffer: options.maxBuffer } : {}),
  });
  const stderr = result.stderr ?? '';
  const errorDetail = result.error ? result.error.message : '';
  return {
    ok: result.status === 0 && !result.error,
    stdout: result.stdout ?? '',
    stderr: stderr !== '' ? stderr : errorDetail,
  };
};

export function createGitGateway(deps: GitGatewayDeps): GitGateway {
  const rawSpawn = deps.spawn ?? defaultSpawn;
  const cwd = deps.cwd;
  const isolatedEnv = deps.isolateEnv ? buildIsolatedEnv() : undefined;

  const spawn = (args: string[], extra?: GitSpawnOptions): GitSpawnResult => {
    if (isolatedEnv === undefined && extra === undefined) {
      return rawSpawn(args, cwd);
    }
    const opts: GitSpawnOptions = {
      ...(isolatedEnv !== undefined ? { env: isolatedEnv } : {}),
      ...(extra ?? {}),
    };
    return rawSpawn(args, cwd, opts);
  };

  const splitLines = (s: string): string[] => {
    if (s === '') return [];
    return s.replace(/\n$/, '').split('\n');
  };

  return {
    toplevel(): string | null {
      const r = spawn(['rev-parse', '--show-toplevel']);
      if (!r.ok) return null;
      const out = r.stdout.trim();
      return out === '' ? null : out;
    },

    projectToplevel(): GitProjectRootResult {
      const result = spawn(['rev-parse', '--show-toplevel']);
      if (!result.ok && isNotGitRepository(result)) return { kind: 'not-a-repo' };
      // Strip Git's output terminator while preserving valid path whitespace.
      const path = result.stdout.replace(/\n$/, '');
      if (!result.ok || path === '') {
        return { kind: 'error', detail: result.stderr.trim() || 'git rev-parse --show-toplevel failed' };
      }
      return { kind: 'root', path };
    },

    tags(): string[] {
      const r = spawn(['tag', '--list']);
      if (!r.ok) return [];
      return splitLines(r.stdout);
    },

    tagsLatest(): string | null {
      const r = spawn(['--no-pager', 'tag', '--list', '--sort=-v:refname']);
      if (!r.ok) return null;
      const lines = splitLines(r.stdout);
      return lines[0] ?? null;
    },

    mergeBase(ref: string): string | null {
      const r = spawn(['merge-base', 'HEAD', ref]);
      if (!r.ok) return null;
      const out = r.stdout.trim();
      return out === '' ? null : out;
    },

    diffNamesBetween(from: string, to: string): string[] {
      const r = spawn(['--no-pager', 'diff', '--name-only', `${from}..${to}`]);
      if (!r.ok) return [];
      return splitLines(r.stdout);
    },

    logFirstWithPhrase(phrase: string, file: string): { date: string } | null {
      const r = spawn(['log', '-1', '--format=%ai', '-S', phrase, '--', file]);
      if (!r.ok) return null;
      const date = r.stdout.trim();
      if (date === '') return null;
      return { date };
    },

    logSubjectsSince(sinceISO: string, file: string): string[] {
      const r = spawn(['log', '--format=%s', `--after=${sinceISO}`, '--', file]);
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
        const r = spawn(args);
        if (!r.ok) continue;
        for (const line of splitLines(r.stdout)) {
          if (line !== '') out.add(line);
        }
      }
      return [...out].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    },

    historyWorkItemIds(): HistoryWorkItemIdsResult {
      const inside = spawn(['rev-parse', '--is-inside-work-tree']);
      if (!inside.ok) {
        if (isNotGitRepository(inside)) return { kind: 'not-a-repo' };
        return { kind: 'error', detail: inside.stderr.trim() || 'git rev-parse --is-inside-work-tree failed' };
      }
      // A successful discovery can print false, for example in a bare repository.

      const shallow = spawn(['rev-parse', '--is-shallow-repository']);
      if (!shallow.ok) {
        return { kind: 'error', detail: shallow.stderr.trim() || 'git rev-parse --is-shallow-repository failed' };
      }
      if (shallow.stdout.trim() === 'true') {
        return { kind: 'shallow' };
      }

      const historyArgs = [
        '-c', 'core.quotepath=off',
        'log', '--all', '--no-relative', '--no-renames', '-m', '--root',
        '--no-color', '--no-ext-diff', '--no-textconv', '--no-show-signature', '--format=',
      ];
      const buffer = { maxBuffer: HISTORY_MAX_BUFFER };
      const patches = spawn([...historyArgs, '--text', '-G', 'wi-[0-9a-f]{4,8}', '-p', '-U0'], buffer);
      if (!patches.ok) {
        return { kind: 'error', detail: patches.stderr.trim() || 'git log patches failed' };
      }
      // Pickaxe matches contents. Scan names separately to include historical
      // filename-only IDs, including intake files that had no ID field.
      const paths = spawn([...historyArgs, '--name-only', '-z'], buffer);
      if (!paths.ok) {
        return { kind: 'error', detail: paths.stderr.trim() || 'git log paths failed' };
      }
      const ids = new Set([...scanAllWorkItemIds(patches.stdout), ...scanAllWorkItemIds(paths.stdout)]);
      return { kind: 'ids', ids: [...ids] };
    },
  };
}
