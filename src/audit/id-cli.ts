/**
 * id-cli.ts — `bin/roadmap-id` entry point (`mint` and idempotent `migrate`).
 *
 * Subcommands:
 *   roadmap-id mint [repo-path] [--count N]
 *   roadmap-id migrate [repo-path] [--dry-run] [--rewrite-blocked-by]
 *   roadmap-id --help | -h
 */

import { chmodSync, lstatSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

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
  const gw = createGitGateway({ cwd: process.cwd() });
  return resolve(positional ?? gw.toplevel() ?? process.cwd());
}

const DOC_NAMES = ['roadmap-shipped.md', 'ROADMAP.md', 'roadmap-future.md', 'TODOS.md'] as const;
const DOC_PATHS = DOC_NAMES.flatMap((name) => [name, `docs/${name}`]);
const MINT_ID_SPACE = 16 ** WORK_ITEM_ID_DEFAULT_HEX + 16 ** (WORK_ITEM_ID_MAX_HEX - 1) + 16 ** WORK_ITEM_ID_MAX_HEX;

type PlanningDoc = { path: string; name: string; text: string; mode: number };

function readDocs(repoRoot: string): Map<string, PlanningDoc> {
  if (!statSync(repoRoot).isDirectory()) throw new Error('project path is not a directory');
  const root = realpathSync(repoRoot);
  const folder = join(root, 'docs');
  if (lstatSync(folder, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error('refusing linked docs directory');
  }
  const docs = new Map<string, PlanningDoc>();
  for (const name of DOC_PATHS) {
    const path = join(root, name);
    const st = lstatSync(path, { throwIfNoEntry: false });
    if (st === undefined) continue;
    if (!st.isFile()) throw new Error(`refusing non-regular planning document ${name}`);
    docs.set(name, { path, name, text: readFileSync(path, 'utf8'), mode: st.mode & 0o777 });
  }
  return docs;
}

function findDoc(docs: ReadonlyMap<string, PlanningDoc>, name: string): PlanningDoc | undefined {
  const root = docs.get(name);
  const satellite = docs.get(`docs/${name}`);
  // Match the audit's precedence for root files and satellite archives.
  return name === 'roadmap-future.md' || name === 'roadmap-shipped.md'
    ? satellite ?? root
    : root ?? satellite;
}

function collectTakenIds(docs: Iterable<PlanningDoc>, git: GitGateway): Set<string> {
  const taken = new Set<string>();
  for (const doc of docs) {
    for (const id of scanAllWorkItemIds(doc.text)) taken.add(id);
  }
  for (const id of git.historicalWorkItemIds(DOC_PATHS)) taken.add(id);
  return taken;
}

function replaceDoc(doc: PlanningDoc, text: string): void {
  if (!lstatSync(doc.path).isFile() || realpathSync(doc.path) !== doc.path ||
      readFileSync(doc.path, 'utf8') !== doc.text) {
    throw new Error(`planning document changed during migration: ${doc.name}`);
  }
  const staging = mkdtempSync(join(dirname(doc.path), '.roadmap-id-'));
  const tmp = join(staging, 'document');
  try {
    writeFileSync(tmp, text, { flag: 'wx', mode: 0o600 });
    chmodSync(tmp, doc.mode);
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
    const git = gitOverride ?? createGitGateway({ cwd: repoRoot });
    const taken = collectTakenIds(readDocs(repoRoot).values(), git);

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
    const docs = readDocs(repoRoot);
    const git = gitOverride ?? createGitGateway({ cwd: repoRoot });
    const taken = collectTakenIds(docs.values(), git);

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
    const archive = shipped === undefined ? undefined : migrateRoadmapText(shipped.text, taken);
    if (shipped !== undefined && archive !== undefined) {
      record(shipped, archive);
    }

    if (roadmap !== undefined) {
      // Migrate active/inline-shipped Tracks, then inline ## Future bullets if present in ROADMAP.md.
      const r1 = migrateRoadmapText(roadmap.text, taken, { rewriteBlockedBy, labelToId: archive?.labelToId });
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
