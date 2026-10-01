import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { buildAuditCtx, parseArgs } from '../audit/cli.ts';
import { docLocationMoves, type DocMoveRecord } from '../audit/checks/doc-location.ts';
import { docTypeMoves } from '../audit/checks/doc-type.ts';
import { walkMdFiles } from '../audit/lib/md-walk.ts';
import type { AuditFileExists } from '../audit/types.ts';
import type { GitGateway } from './git.ts';
import { preflight, type Preflight } from './preflight.ts';
import { checkOperand, errno, escapeValue, HIDDEN, Refusal, REFUSAL_ACTIONS, type FileSystem, type Root } from './root.ts';

export type AuditSnapshot = { moves: DocMoveRecord[]; exists: Partial<AuditFileExists>; unreadableDirs: string[] };
export type Audit = (root: string) => AuditSnapshot;
export const defaultAudit: Audit = root => {
  try {
    const unreadableDirs: string[] = [];
    walkMdFiles(root, 2, dir => unreadableDirs.push(dir));
    const ctx = buildAuditCtx({ repoRoot: root, extendDir: join(import.meta.dir, '../..'), argv: parseArgs([]) });
    return { moves: [...docLocationMoves(ctx), ...docTypeMoves(ctx)], exists: ctx.exists, unreadableDirs };
  } catch (error) {
    const e = error as NodeJS.ErrnoException;
    if (e.code) throw new Refusal('audit_failed', e.path ?? root, errno(error));
    throw error;
  }
};
export type Blocked = { check: string; source: string; destination: string | null; reason: string };
export type Options = { command: 'plan' | 'apply'; root?: string; scaffoldOnly: boolean; excludes: string[]; planId?: string; authorize: boolean };
export type Plan = Preflight & { root: Root; scaffoldOnly: boolean; blocked: Blocked[]; excluded: DocMoveRecord[]; excludes: string[]; unreadableDirs: string[]; id: string };

const BOTH_PAIRS: [string, keyof AuditFileExists, keyof AuditFileExists, boolean][] = [
  ['README.md', 'rootReadme', 'docsReadme', false], ['CHANGELOG.md', 'rootChangelog', 'docsChangelog', false],
  ['CLAUDE.md', 'rootClaude', 'docsClaude', false], ['VERSION', 'rootVersion', 'docsVersion', false],
  ['LICENSE', 'rootLicense', 'docsLicense', false], ['LICENSE.md', 'rootLicenseMd', 'docsLicenseMd', false],
  ['TODOS.md', 'rootTodos', 'docsTodos', true], ['ROADMAP.md', 'rootRoadmap', 'docsRoadmap', true],
  ['PROGRESS.md', 'rootProgress', 'docsProgress', true],
];
export function bothExist(snapshot: AuditSnapshot, root: string, fs: FileSystem): Blocked[] {
  const blocked: Blocked[] = [];
  for (const [name, rootKey, docsKey, project] of BOTH_PAIRS) {
    if (!snapshot.exists[rootKey] || !snapshot.exists[docsKey]) continue;
    const source = project ? name : `docs/${name}`;
    if (!project) {
      const a = fs.statSync(join(root, name)); const b = fs.statSync(join(root, 'docs', name));
      const sameInode = a.dev === b.dev && a.ino === b.ino;
      const copy = !sameInode && a.size === b.size && Math.floor(a.mtimeMs / 1000) === Math.floor(b.mtimeMs / 1000)
        && fs.readFileSync(join(root, name)).equals(fs.readFileSync(join(root, 'docs', name)));
      if (!sameInode && !copy) continue;
    }
    blocked.push({ check: project ? 'TAXONOMY' : 'DOC_LOCATION', source,
      destination: project ? `docs/${name}` : name, reason: 'exists in both root and docs/; reconcile by hand' });
  }
  return blocked;
}
export function identity(item: { check: string; source: string }): string { return JSON.stringify([item.check, item.source]); }

export function buildPlan(root: Root, options: Options, audit: Audit, fs: FileSystem, git: GitGateway): Plan {
  const snapshot = options.scaffoldOnly ? { moves: [], exists: {}, unreadableDirs: [] } : audit(root.path);
  const excludes = [...new Set(options.excludes)].sort();
  const excluded = snapshot.moves.filter(move => excludes.includes(move.source));
  const refusals = excludes.filter(source => !snapshot.moves.some(move => move.source === source))
    .map(source => new Refusal('exclude_unmatched', source, 'exclude value does not match a planned source'));
  const blocked = bothExist(snapshot, root.path, fs);
  const records: DocMoveRecord[] = [];
  for (const move of snapshot.moves) {
    if (excludes.includes(move.source)) continue;
    try {
      for (const path of [move.source, move.destination, move.missingParent]) if (path !== null) checkOperand(path);
    } catch (error) {
      if (!(error instanceof Refusal)) throw error;
      refusals.push(error); continue;
    }
    const hidden = [move.source, move.destination, move.missingParent].some(path => path !== null && HIDDEN.test(path));
    if (hidden || move.blocked) {
      blocked.push({ check: move.check, source: move.source, destination: move.destination,
        reason: hidden ? 'filename contains hidden characters; move it by hand'
          : move.blocked === 'inbox' ? 'inbox content typically wants merge, not rename; review and move by hand'
          : 'destination ambiguous; review and move by hand' });
    } else if (move.destination !== null) records.push(move);
    else refusals.push(new Refusal('bad_operand', move.source, 'unblocked record has no destination'));
  }
  const result = preflight(root, records, fs, git, options.scaffoldOnly);
  const plan: Plan = { ...result, root, scaffoldOnly: options.scaffoldOnly, blocked, excluded, excludes,
    unreadableDirs: [...new Set(snapshot.unreadableDirs)].sort(), refusals: [...refusals, ...result.refusals], id: '' };
  // Object field order is fixed; every set-like list is sorted or audit-ordered.
  const binding = { schema: 1, root: root.path, mode: root.mode, scaffoldOnly: options.scaffoldOnly,
    directories: result.directories, scaffold: result.directories.filter(dir => !dir.exists), moves: result.moves,
    external: result.external, blocked, excluded, excludes, unreadableDirs: plan.unreadableDirs };
  plan.id = createHash('sha256').update(JSON.stringify(binding)).digest('hex');
  return plan;
}

export function refusalLines(refusals: Refusal[], root: string): string[] {
  return refusals.flatMap(error => [
    `REFUSAL ${error.code}: ${escapeValue(error.message)}`,
    `  Requested: ${escapeValue(error.path)}`,
    ...(error.resolved ? [`  Resolved: ${escapeValue(error.resolved)}`] : []),
    `  Root: ${escapeValue(root)}; nothing was written`,
    `  Next: ${REFUSAL_ACTIONS[error.code]}. See layout-scaffold --help`,
  ]);
}
export function planLines(plan: Plan): string[] {
  const lines: string[] = [];
  const list = (heading: string, items: string[]) => { if (items.length) lines.push(`${heading}:`, ...items.map(item => `- ${item}`)); };
  list('Scaffold', plan.directories.filter(dir => !dir.exists).map(dir => `${escapeValue(dir.requested)} → ${escapeValue(dir.resolved)}`));
  list('Moves', plan.moves.map(move => `${move.tracking === 'tracked' ? 'git mv' : 'move'} ${escapeValue(move.source)} → ${escapeValue(move.destination)}${move.heuristic ? ' — heuristic (mermaid/plantuml fence)' : ''}`));
  list('Blocked', plan.blocked.map(item => `${escapeValue(item.source)}${item.destination ? ` → ${escapeValue(item.destination)}` : ''}: ${escapeValue(item.reason)}`));
  list('Excluded', plan.excluded.map(item => escapeValue(item.source)));
  for (const write of [true, false]) list(write ? 'External (needs --authorize-external)' : 'External (no write)',
    plan.external.filter(item => item.write === write).map(item => `${escapeValue(item.requested)} → ${escapeValue(item.resolved)}`));
  list('Not scanned', plan.unreadableDirs.map(escapeValue));
  if (plan.refusals.length) lines.push('Refusals:', ...refusalLines(plan.refusals, plan.root.path));
  else if (plan.directories.every(dir => dir.exists) && !plan.moves.length && !plan.blocked.length && !plan.excluded.length && !plan.unreadableDirs.length) {
    lines.unshift(plan.scaffoldOnly ? 'canonical directories present, nothing to create (scaffold-only: moves not checked)' : 'already canonical, nothing to do');
  }
  return lines;
}
export function countLines(plan: Plan): string[] { return [`BLOCKED: ${plan.blocked.length}`, `EXCLUDED: ${plan.excluded.length}`]; }
