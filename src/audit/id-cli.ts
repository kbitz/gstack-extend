/**
 * id-cli.ts — `bin/roadmap-id` entry point (`mint` and idempotent `migrate`).
 *
 * Subcommands:
 *   roadmap-id mint [repo-path] [--count N]
 *   roadmap-id migrate [repo-path] [--dry-run] [--rewrite-blocked-by]
 *   roadmap-id --help | -h
 */

import { chmodSync, lstatSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { createGitGateway, type GitGateway } from './lib/git.ts';
import {
  migrateFutureText,
  migrateRoadmapText,
  migrateTodosText,
  mintRandomId,
  type MigrateResult,
  scanAllWorkItemIds,
  WORK_ITEM_ID_DEFAULT_HEX,
  WORK_ITEM_ID_MAX_HEX,
} from './lib/work-item-id.ts';

export const USAGE = `Usage: roadmap-id mint [repo-path] [--count N]
       roadmap-id migrate [repo-path] [--dry-run] [--rewrite-blocked-by]
       roadmap-id --help | -h

Mint unique immutable work-item IDs (wi-<hex>) or migrate existing planning docs.

Subcommands:
  mint      Mint N unique IDs (default 1) unused in live docs and git history
  migrate   Assign deterministic IDs to existing entries/cards without altering other text

Options:
  [repo-path]           Repository root (defaults to Git toplevel or cwd)
  --count N             Number of IDs to mint (positive integer, default 1)
  --dry-run             Report migration additions without writing files
  --rewrite-blocked-by  Also rewrite resolvable Track labels on _blocked-by: lines to IDs
  -h, --help            Show this help and exit 0
`;

function resolveRepoRoot(positional: string | null): string {
  if (positional !== null) return resolve(positional);
  const gw = createGitGateway({ cwd: process.cwd(), bindToCwd: true });
  return resolve(gw.toplevel() ?? process.cwd());
}

const DOC_NAMES = ['roadmap-shipped.md', 'ROADMAP.md', 'roadmap-future.md', 'TODOS.md'] as const;
const DOC_PATHS = DOC_NAMES.flatMap((name) => [name, `docs/${name}`]);
const MINT_ID_SPACE = 16 ** WORK_ITEM_ID_DEFAULT_HEX + 16 ** (WORK_ITEM_ID_MAX_HEX - 1) + 16 ** WORK_ITEM_ID_MAX_HEX;

type PlanningDoc = { path: string; name: string; text: string; mode: number };
type PlanningDocs = { root: string; docs: Map<string, PlanningDoc>; historicalPaths: Set<string> };

function projectRelativePath(root: string, path: string): string | null {
  const nested = relative(root, path);
  return nested === '..' || nested.startsWith(`..${sep}`) || isAbsolute(nested) ? null : nested;
}

function readDocs(repoRoot: string, mode: 'mint' | 'migrate'): PlanningDocs {
  if (!statSync(repoRoot).isDirectory()) throw new Error('project path is not a directory');
  const root = realpathSync(repoRoot);
  let folder = join(root, 'docs');
  if (lstatSync(folder, { throwIfNoEntry: false })?.isSymbolicLink()) {
    const target = statSync(folder, { throwIfNoEntry: false })?.isDirectory() ? realpathSync(folder) : null;
    if (target !== null && projectRelativePath(root, target) !== null) {
      folder = target;
    } else if (mode === 'migrate') {
      throw new Error('linked docs directory must resolve to a directory inside the project');
    }
  }
  const docs = new Map<string, PlanningDoc>();
  const historicalPaths = new Set(DOC_PATHS);
  for (const name of DOC_PATHS) {
    const path = name.startsWith('docs/') ? join(folder, name.slice(5)) : join(root, name);
    historicalPaths.add(relative(root, path));
    // Mint reads linked planning files the audit can see. Migrate replaces
    // regular files and leaves the project's docs directory link intact.
    const st = mode === 'mint'
      ? statSync(path, { throwIfNoEntry: false })
      : lstatSync(path, { throwIfNoEntry: false });
    if (st === undefined) continue;
    if (!st.isFile()) throw new Error(`refusing non-regular planning document ${name}`);
    if (mode === 'mint') {
      const historicalPath = projectRelativePath(root, realpathSync(path));
      if (historicalPath !== null) historicalPaths.add(historicalPath);
    }
    const bytes = readFileSync(path);
    const text = bytes.toString('utf8');
    if (mode === 'migrate' && !Buffer.from(text, 'utf8').equals(bytes)) {
      throw new Error(`planning document is not valid UTF-8: ${name}`);
    }
    docs.set(name, { path, name, text, mode: st.mode & 0o777 });
  }
  return { root, docs, historicalPaths };
}

function findDoc(docs: ReadonlyMap<string, PlanningDoc>, name: string): PlanningDoc | undefined {
  const root = docs.get(name);
  const satellite = docs.get(`docs/${name}`);
  // Match the audit's precedence for root files and satellite archives.
  return name === 'roadmap-future.md' || name === 'roadmap-shipped.md'
    ? satellite ?? root
    : root ?? satellite;
}

function collectTakenIds({ root, docs, historicalPaths }: PlanningDocs, git: GitGateway): Set<string> {
  const taken = new Set<string>();
  for (const doc of docs.values()) {
    for (const id of scanAllWorkItemIds(doc.text)) taken.add(id);
  }
  const layout = { root, directory: 'docs', documentNames: DOC_NAMES };
  for (const id of git.historicalWorkItemIds([...historicalPaths], layout)) taken.add(id);
  return taken;
}

function replaceDoc(doc: PlanningDoc, text: string): void {
  const parent = dirname(doc.path);
  if (realpathSync(parent) !== parent) throw new Error(`planning document path changed during migration: ${doc.name}`);
  const staging = mkdtempSync(join(parent, '.roadmap-id-'));
  const tmp = join(staging, 'document');
  try {
    writeFileSync(tmp, text, { flag: 'wx', mode: 0o600 });
    chmodSync(tmp, doc.mode);
    if (!lstatSync(doc.path).isFile() || realpathSync(doc.path) !== doc.path ||
        realpathSync(tmp) !== tmp || !readFileSync(doc.path).equals(Buffer.from(doc.text, 'utf8'))) {
      throw new Error(`planning document changed during migration: ${doc.name}`);
    }
    renameSync(tmp, doc.path);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export type CliResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export function runIdCli(argv: string[], gitOverride?: GitGateway): CliResult {
  try {
    return execute(argv, gitOverride);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { stdout: '', stderr: `roadmap-id: ${message}\n`, exitCode: 1 };
  }
}

function execute(argv: string[], gitOverride?: GitGateway): CliResult {
  if (argv.length === 0) {
    return { stdout: '', stderr: USAGE, exitCode: 2 };
  }
  if (argv[0] === '--help' || argv[0] === '-h') {
    return { stdout: USAGE, stderr: '', exitCode: 0 };
  }

  const sub = argv[0]!;
  const rest = argv.slice(1);

  if (sub === 'mint') {
    let count = 1;
    const positionals: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i]!;
      if (arg === '--help' || arg === '-h') {
        return { stdout: USAGE, stderr: '', exitCode: 0 };
      }
      if (arg === '--count') {
        const val = rest[++i];
        const candidate = Number(val);
        if (val === undefined || !/^[1-9][0-9]*$/.test(val) ||
            !Number.isSafeInteger(candidate) || candidate > MINT_ID_SPACE) {
          return { stdout: '', stderr: `roadmap-id mint: invalid --count value\n${USAGE}`, exitCode: 2 };
        }
        count = candidate;
        continue;
      }
      if (arg.startsWith('-')) {
        return { stdout: '', stderr: `roadmap-id mint: unknown option '${arg}'\n${USAGE}`, exitCode: 2 };
      }
      positionals.push(arg);
    }
    if (positionals.length > 1) {
      return { stdout: '', stderr: `roadmap-id mint: too many arguments\n${USAGE}`, exitCode: 2 };
    }

    const repoRoot = resolveRepoRoot(positionals[0] ?? null);
    const git = gitOverride ?? createGitGateway({ cwd: repoRoot, bindToCwd: true });
    const taken = collectTakenIds(readDocs(repoRoot, 'mint'), git);

    const minted: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = mintRandomId(taken);
      taken.add(id);
      minted.push(id);
    }
    return { stdout: minted.join('\n') + '\n', stderr: '', exitCode: 0 };
  }

  if (sub === 'migrate') {
    let dryRun = false;
    let rewriteBlockedBy = false;
    const positionals: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i]!;
      if (arg === '--help' || arg === '-h') {
        return { stdout: USAGE, stderr: '', exitCode: 0 };
      }
      if (arg === '--dry-run') {
        dryRun = true;
        continue;
      }
      if (arg === '--rewrite-blocked-by') {
        rewriteBlockedBy = true;
        continue;
      }
      if (arg.startsWith('-')) {
        return { stdout: '', stderr: `roadmap-id migrate: unknown option '${arg}'\n${USAGE}`, exitCode: 2 };
      }
      positionals.push(arg);
    }
    if (positionals.length > 1) {
      return { stdout: '', stderr: `roadmap-id migrate: too many arguments\n${USAGE}`, exitCode: 2 };
    }

    const repoRoot = resolveRepoRoot(positionals[0] ?? null);
    const planning = readDocs(repoRoot, 'migrate');
    const { docs } = planning;
    const git = gitOverride ?? createGitGateway({ cwd: repoRoot, bindToCwd: true });
    const taken = collectTakenIds(planning, git);

    const lines: string[] = [];
    let totalAdded = 0;
    const changes: Array<{ doc: PlanningDoc; text: string }> = [];
    function record(doc: PlanningDoc, result: MigrateResult) {
      lines.push(`ADDED: ${doc.name} (${result.added})`);
      totalAdded += result.added;
      if (doc.text !== result.text) changes.push({ doc, text: result.text });
    }

    // Order: roadmap-shipped.md, ROADMAP.md, roadmap-future.md, TODOS.md
    const shipped = findDoc(docs, 'roadmap-shipped.md');
    const roadmap = findDoc(docs, 'ROADMAP.md');
    const future = findDoc(docs, 'roadmap-future.md');
    const todos = findDoc(docs, 'TODOS.md');
    const archive = shipped === undefined ? undefined : migrateRoadmapText(shipped.text, taken, { fromShippedArchive: true });
    if (shipped !== undefined && archive !== undefined) {
      record(shipped, archive);
    }

    if (roadmap !== undefined) {
      // Migrate active/inline-shipped Tracks, then inline ## Future bullets if present in ROADMAP.md.
      const r1 = migrateRoadmapText(roadmap.text, taken, {
        rewriteBlockedBy, labelToId: archive?.labelToId, workItemIdCounts: archive?.workItemIdCounts,
      });
      const r2 = migrateFutureText(r1.text, taken);
      record(roadmap, { ...r2, added: r1.added + r2.added });
    }

    if (future !== undefined) record(future, migrateFutureText(future.text, taken));
    if (todos !== undefined) record(todos, migrateTodosText(todos.text, taken));
    if (!dryRun) {
      for (const { doc, text } of changes) replaceDoc(doc, text);
    }

    lines.push(`ADDED: ${totalAdded}`);
    const status = changes.length === 0 ? 'unchanged' : dryRun ? 'dry-run' : 'ok';
    lines.push(`STATUS: ${status}`);
    return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
  }

  return { stdout: '', stderr: `roadmap-id: unknown subcommand '${sub}'\n${USAGE}`, exitCode: 2 };
}

if (import.meta.main) {
  const r = runIdCli(process.argv.slice(2));
  if (r.stdout !== '') process.stdout.write(r.stdout);
  if (r.stderr !== '') process.stderr.write(r.stderr);
  process.exit(r.exitCode);
}
