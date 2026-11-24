/**
 * work-item-ids.ts — validates immutable work-item IDs across TODOS, Future,
 * active ROADMAP Tracks, and shipped Track history.
 *
 * Emits canonical section `WORK_ITEM_IDS`.
 *   - `STATUS: skip` when zero inspectable records exist across all four docs.
 *   - `STATUS: pass` when every record has a valid globally unique `wi-` ID.
 *   - `STATUS: fail` on any `MISSING_ID`, `MALFORMED_ID`, or `DUPLICATE_ID`.
 */

import { extractInlineBulletId } from '../lib/work-item-id.ts';
import type { AuditCtx, CheckResult } from '../types.ts';

type WorkItemFields = {
  workItemId?: string | null;
  workItemIdRaw?: string | null;
  workItemIdError?: 'duplicate' | 'malformed' | null;
};

const TODO_FIELD = '- **ID:** wi-<hex> bullet';
const TRACK_FIELD = '_id: wi-<hex>_';
const INLINE_FIELD = '**ID:** wi-<hex>';

function shortFutureLabel(bullet: string): string {
  const m = bullet.match(/^- \*\*(.+?)\*\*/);
  if (m !== null) return m[1]!.trim();
  const stripped = bullet.replace(/^- /, '').trim();
  return stripped.length > 60 ? `${stripped.slice(0, 57)}...` : stripped;
}

export function runCheckWorkItemIds(ctx: AuditCtx): CheckResult {
  const findings: string[] = [];
  const seen = new Map<string, string>(); // id -> first location
  let inspectableCount = 0;
  let hasMissing = false;

  const registerValidId = (id: string, location: string) => {
    const first = seen.get(id);
    if (first !== undefined) {
      findings.push(
        `- DUPLICATE_ID: ${location} — duplicate work-item ID "${id}" (first seen at ${first})`,
      );
    } else {
      seen.set(id, location);
    }
  };

  function inspect(
    location: string, field: string, record: WorkItemFields, register = true,
  ): void {
    inspectableCount++;
    const { workItemId: id, workItemIdRaw: raw, workItemIdError: error } = record;
    if (error === 'duplicate') {
      findings.push(`- DUPLICATE_ID: ${location} — multiple ID fields on one record`);
    } else if (error === 'malformed') {
      findings.push(`- MALFORMED_ID: ${location} — malformed work-item ID "${raw ?? ''}" (expected wi-<4-8 lowercase hex>)`);
    } else if (!id) {
      hasMissing = true;
      findings.push(`- MISSING_ID: ${location} — missing ${field}`);
    }
    if (id && register) registerValidId(id, location);
  }

  // Reserve all valid Completed IDs, including legacy attributes that have
  // no heading. Audit the structured entries separately without double-counting.
  for (const completedId of ctx.todos.value.completedIds ?? []) {
    inspectableCount++;
    registerValidId(completedId, 'TODOS.md ## Completed');
  }
  for (const entry of ctx.todos.value.completedEntries ?? []) {
    inspect(`TODOS.md ## Completed:${entry.line} (${entry.title})`, TODO_FIELD, entry, false);
  }
  for (const entry of ctx.todos.value.entries) {
    if (entry.kind !== 'heading') continue;
    const label = entry.title || entry.raw.replace(/^### /, '').trim();
    inspect(`TODOS.md:${entry.line} (${label})`, TODO_FIELD, entry);
  }

  const roadmap = ctx.roadmap.value;
  const archiveSource = 'docs/roadmap-future.md';
  const futureSources = [
    { source: roadmap.futureFromArchive ? archiveSource : 'ROADMAP.md ## Future', bullets: roadmap.futureBullets },
    { source: archiveSource, bullets: roadmap.unmergedFutureArchive ?? [] },
  ];
  for (const { source, bullets } of futureSources) {
    for (const bullet of bullets) {
      const parsed = extractInlineBulletId(bullet);
      inspect(`${source} (${shortFutureLabel(bullet)})`, INLINE_FIELD, {
        workItemId: parsed?.id,
        workItemIdRaw: parsed?.raw,
        workItemIdError: parsed?.duplicate ? 'duplicate' : parsed?.id === null ? 'malformed' : null,
      });
    }
  }

  for (const track of roadmap.tracks) {
    const file = track.fromShippedArchive ? 'docs/roadmap-shipped.md' : 'ROADMAP.md';
    inspect(`${file} Track ${track.id}`, TRACK_FIELD, track);
  }
  for (const track of roadmap.archiveCollisionTracks ?? []) {
    inspect(`docs/roadmap-shipped.md Track ${track.label}`, TRACK_FIELD, track);
  }
  for (const track of roadmap.legacyShippedTracks ?? []) {
    inspect(`shipped Track ${track.label} (line ${track.line})`, INLINE_FIELD, track);
  }

  if (inspectableCount === 0) {
    return {
      section: 'WORK_ITEM_IDS',
      status: 'skip',
      body: ['FINDINGS:', '- No inspectable planning records found'],
    };
  }

  if (findings.length === 0) {
    return {
      section: 'WORK_ITEM_IDS',
      status: 'pass',
      body: ['FINDINGS:', '- (none)'],
    };
  }

  if (hasMissing) {
    findings.push(
      '- Hint: run `bin/roadmap-id migrate` to assign deterministic work-item IDs to existing records.',
    );
  }

  return {
    section: 'WORK_ITEM_IDS',
    status: 'fail',
    body: ['FINDINGS:', ...findings, ''],
  };
}
