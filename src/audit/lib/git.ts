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
 * Read-only audit methods return plain TS values; failures (git missing, non-repo cwd,
 * empty output) return null / [] rather than throwing. Match bash's
 * `2>/dev/null || true` semantics exactly — the audit must keep running
 * even when git is unhealthy.
 *
 * LC_ALL=C parity: env LC_ALL=C is forced on every spawn so byte-order of
 * git output (tags, paths, subjects) matches bash regardless of the
 * shell's locale.
 */

import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import { scanAllWorkItemIds } from './work-item-id.ts';

export type GitSpawnResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

export type GitSpawn = (args: string[], cwd: string, maxBuffer?: number) => GitSpawnResult;

// History patches include full changed lines. A single planning-document
// migration can exceed the child process default of 1 MiB.
const HISTORY_PATCH_BUFFER_BYTES = 64 * 1024 * 1024;

type PlanningHistoryLayout = {
  root: string;
  directory: string;
  documentNames: readonly string[];
};

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
  /** Reserve IDs from available Git history. Throws if history cannot be checked. */
  historicalWorkItemIds(relPaths: string[], layout?: PlanningHistoryLayout): string[];
};

export type GitGatewayDeps = {
  cwd: string;
  spawn?: GitSpawn;
  bindToCwd?: boolean;
};

// Git hooks set repository-local variables even when an invoked command
// changes directory. A caller bound to a project path uses Git discovery.
const GIT_REPOSITORY_ENV = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_CONFIG',
  'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS', 'GIT_DIR', 'GIT_GRAFT_FILE',
  'GIT_IMPLICIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_NAMESPACE',
  'GIT_NO_REPLACE_OBJECTS', 'GIT_OBJECT_DIRECTORY', 'GIT_PREFIX',
  'GIT_QUARANTINE_PATH', 'GIT_REPLACE_REF_BASE', 'GIT_SHALLOW_FILE', 'GIT_WORK_TREE',
];

function spawnGit(args: string[], cwd: string, maxBuffer?: number, bindToCwd = false): GitSpawnResult {
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: 'C', GIT_PAGER: 'cat' };
  if (bindToCwd) {
    for (const key of GIT_REPOSITORY_ENV) delete env[key];
  }
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer,
    env,
  });
  return {
    ok: result.status === 0 && result.error === undefined,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

export const defaultSpawn: GitSpawn = spawnGit;

/** Follow committed planning links across moves while keeping the log path-limited. */
function historicalPlanningPaths(
  spawn: GitSpawn,
  cwd: string,
  relPaths: string[],
  layout: PlanningHistoryLayout,
): string[] {
  const files = new Set(relPaths);
  const directories = new Set([layout.directory]);
  const scanned = new Set<string>();
  const targets = new Map<string, string>();
  for (;;) {
    const paths = [...new Set([...files, ...directories])].filter((path) => !scanned.has(path));
    if (paths.length === 0) return [...files];
    for (const path of paths) scanned.add(path);
    const log = spawn(
      ['--literal-pathspecs', 'log', '--all', '--full-history', '-m', '--format=', '--raw', '--no-color', '--relative',
        '--no-abbrev', '--no-renames', '-z', '--', ...paths],
      cwd,
      HISTORY_PATCH_BUFFER_BYTES,
    );
    if (!log.ok) throw new Error('could not read planning document link history');
    const selected = new Set(paths);
    const rows = log.stdout.split('\0');
    for (let i = 0; i + 1 < rows.length; i += 2) {
      const path = rows[i + 1]!;
      if (!selected.has(path)) continue;
      const [oldMode, newMode, oldObject, newObject] = rows[i]!.trimStart().slice(1).split(' ');
      for (const [mode, object] of [[oldMode, oldObject], [newMode, newObject]] as const) {
        if (mode !== '120000' || object === undefined) continue;
        let blob = targets.get(object);
        if (blob === undefined) {
          const result = spawn(['cat-file', 'blob', object], cwd);
          if (!result.ok) throw new Error('could not read a historical planning document link');
          blob = result.stdout;
          targets.set(object, blob);
        }
        const target = isAbsolute(blob) ? relative(layout.root, blob) : normalize(join(dirname(path), blob));
        if (target === '..' || target.startsWith(`..${sep}`) || isAbsolute(target)) continue;
        if (directories.has(path)) {
          if (target && target !== '.') directories.add(target);
          for (const name of layout.documentNames) files.add(join(target, name));
        } else if (target && target !== '.') {
          files.add(target);
        }
      }
    }
  }
}

export function createGitGateway(deps: GitGatewayDeps): GitGateway {
  const spawn: GitSpawn = deps.spawn ??
    ((args, cwd, maxBuffer) => spawnGit(args, cwd, maxBuffer, deps.bindToCwd));
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

    historicalWorkItemIds(relPaths: string[], layout?: PlanningHistoryLayout): string[] {
      if (relPaths.length === 0) return [];
      // The mint and migration commands cannot safely treat a failed Git
      // command as an empty reservation set. A non-repository is legitimate.
      const repo = spawn(['rev-parse', '--is-inside-work-tree'], cwd);
      if (!repo.ok) {
        if (/^fatal: not a git repository \(or any\b/.test(repo.stderr)) return [];
        throw new Error('could not establish Git history for work-item IDs');
      }
      const paths = layout === undefined ? relPaths : historicalPlanningPaths(spawn, cwd, relPaths, layout);
      const r = spawn(
        ['--literal-pathspecs', 'log', '--all', '--full-history', '-m', '--no-color', '--no-ext-diff', '--no-textconv', '--text',
          '-G', 'wi-[0-9a-f]{4,8}', '--format=', '-p', '-U0', '--', ...paths],
        cwd,
        HISTORY_PATCH_BUFFER_BYTES,
      );
      if (!r.ok) throw new Error('could not read Git history for work-item IDs');
      return scanAllWorkItemIds(r.stdout);
    },
  };
}
