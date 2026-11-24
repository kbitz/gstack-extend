/**
 * id-cli.ts — `bin/roadmap-id` entry point (`mint` and idempotent `migrate`).
 *
 * Subcommands:
 *   roadmap-id mint [repo-path] [--count N]
 *   roadmap-id migrate [repo-path] [--dry-run] [--rewrite-blocked-by]
 *   roadmap-id --help | -h
 */

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { createGitGateway, type GitGateway } from './lib/git.ts';
import {
  extractInlineBulletId,
  migrateFutureText,
  migrateRoadmapText,
  migrateTodosText,
  mintRandomId,
  parseTrackIdLine,
  scanAllWorkItemIds,
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

function findDoc(repoRoot: string, name: string): string | null {
  const root = join(repoRoot, name);
  const docs = join(repoRoot, 'docs', name);
  const docsFirst = name === 'roadmap-future.md' || name === 'roadmap-shipped.md';
  const first = docsFirst ? docs : root;
  const second = docsFirst ? root : docs;
  if (existsSync(first) && statSync(first).isFile()) return first;
  if (existsSync(second) && statSync(second).isFile()) return second;
  return null;
}

function resolveRepoRoot(positional: string | null): string {
  if (positional !== null) return positional;
  const gw = createGitGateway({ cwd: process.cwd() });
  return gw.toplevel() ?? process.cwd();
}

type DocPaths = {
  shipped: string | null;
  roadmap: string | null;
  future: string | null;
  todos: string | null;
};

function discoverDocs(repoRoot: string): DocPaths {
  return {
    shipped: findDoc(repoRoot, 'roadmap-shipped.md'),
    roadmap: findDoc(repoRoot, 'ROADMAP.md'),
    future: findDoc(repoRoot, 'roadmap-future.md'),
    todos: findDoc(repoRoot, 'TODOS.md'),
  };
}

function readDoc(path: string | null): string {
  if (path === null || !existsSync(path) || !statSync(path).isFile()) return '';
  return readFileSync(path, 'utf8');
}

function collectLiveTakenIds(docs: DocPaths): Set<string> {
  const taken = new Set<string>();
  for (const p of [docs.shipped, docs.roadmap, docs.future, docs.todos]) {
    const text = readDoc(p);
    for (const id of scanAllWorkItemIds(text)) taken.add(id);
  }
  return taken;
}

function collectTrackLabelToId(content: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = content.split('\n');
  let curLabel: string | null = null;
  let inFence = false;
  for (const line of lines) {
    if (/^[ \t]*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^## /.test(line)) {
      curLabel = null;
      continue;
    }
    const tm = /^#{3,5} Track ([0-9]+[A-Z](?:\.[0-9]+)?):/.exec(line);
    if (tm !== null) {
      curLabel = tm[1]!;
      continue;
    }
    if (curLabel !== null) {
      const parsed = parseTrackIdLine(line);
      if (parsed !== null && parsed.id !== null && !map.has(curLabel)) {
        map.set(curLabel, parsed.id);
      }
      continue;
    }
    const lm = /^- Track ([0-9]+[A-Z](?:\.[0-9]+)?)[ \t]*[—–-]/.exec(line);
    if (lm !== null) {
      const parsed = extractInlineBulletId(line);
      if (parsed !== null && parsed.id !== null && !map.has(lm[1]!)) {
        map.set(lm[1]!, parsed.id);
      }
    }
  }
  return map;
}

export type CliResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export function runIdCli(argv: string[], gitOverride?: GitGateway): CliResult {
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
        if (val === undefined || !/^[1-9][0-9]*$/.test(val)) {
          return { stdout: '', stderr: `roadmap-id mint: invalid --count value\n${USAGE}`, exitCode: 2 };
        }
        count = Number.parseInt(val, 10);
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
    const docs = discoverDocs(repoRoot);
    const taken = collectLiveTakenIds(docs);

    const git = gitOverride ?? createGitGateway({ cwd: repoRoot });
    const historyPaths = [
      'TODOS.md',
      'docs/TODOS.md',
      'ROADMAP.md',
      'docs/ROADMAP.md',
      'docs/roadmap-future.md',
      'roadmap-future.md',
      'docs/roadmap-shipped.md',
      'roadmap-shipped.md',
    ];
    for (const id of git.historicalWorkItemIds(historyPaths)) {
      taken.add(id);
    }

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
    const docs = discoverDocs(repoRoot);
    const taken = collectLiveTakenIds(docs);

    const lines: string[] = [];
    let totalAdded = 0;
    let anyChanged = false;
    const labelToId = new Map<string, string>();

    // Order: roadmap-shipped.md, ROADMAP.md, roadmap-future.md, TODOS.md
    if (docs.shipped !== null) {
      const before = readDoc(docs.shipped);
      const res = migrateRoadmapText(before, taken, { rewriteBlockedBy: false });
      const rel = relative(repoRoot, docs.shipped) || docs.shipped;
      lines.push(`ADDED: ${rel} (${res.added})`);
      totalAdded += res.added;
      if (res.text !== before) {
        anyChanged = true;
        if (!dryRun) writeFileSync(docs.shipped, res.text);
      }
      for (const [k, v] of collectTrackLabelToId(res.text)) {
        if (!labelToId.has(k)) labelToId.set(k, v);
      }
    }

    if (docs.roadmap !== null) {
      const before = readDoc(docs.roadmap);
      // Migrate active/inline-shipped Tracks, then inline ## Future bullets if present in ROADMAP.md.
      const r1 = migrateRoadmapText(before, taken, { rewriteBlockedBy, labelToId });
      const r2 = migrateFutureText(r1.text, taken);
      const added = r1.added + r2.added;
      const rel = relative(repoRoot, docs.roadmap) || docs.roadmap;
      lines.push(`ADDED: ${rel} (${added})`);
      totalAdded += added;
      if (r2.text !== before) {
        anyChanged = true;
        if (!dryRun) writeFileSync(docs.roadmap, r2.text);
      }
    }

    if (docs.future !== null) {
      const before = readDoc(docs.future);
      const res = migrateFutureText(before, taken);
      const rel = relative(repoRoot, docs.future) || docs.future;
      lines.push(`ADDED: ${rel} (${res.added})`);
      totalAdded += res.added;
      if (res.text !== before) {
        anyChanged = true;
        if (!dryRun) writeFileSync(docs.future, res.text);
      }
    }

    if (docs.todos !== null) {
      const before = readDoc(docs.todos);
      const res = migrateTodosText(before, taken);
      const rel = relative(repoRoot, docs.todos) || docs.todos;
      lines.push(`ADDED: ${rel} (${res.added})`);
      totalAdded += res.added;
      if (res.text !== before) {
        anyChanged = true;
        if (!dryRun) writeFileSync(docs.todos, res.text);
      }
    }

    lines.push(`ADDED: ${totalAdded}`);
    const status = !anyChanged ? 'unchanged' : dryRun ? 'dry-run' : 'ok';
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
