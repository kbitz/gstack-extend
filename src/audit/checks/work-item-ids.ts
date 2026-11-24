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

  // Register TODOS.md ## Completed IDs first so active entries cannot reuse them.
  for (const completedId of ctx.todos.value.completedIds ?? []) {
    registerValidId(completedId, 'TODOS.md ## Completed');
  }

  // 1. TODOS.md ## Unprocessed heading entries.
  for (const entry of ctx.todos.value.entries) {
    if (entry.kind !== 'heading') continue;
    inspectableCount++;
    const label = entry.title && entry.title !== '' ? entry.title : entry.raw.replace(/^### /, '').trim();
    const location = `TODOS.md:${entry.line} (${label})`;
    if (entry.workItemIdError === 'duplicate') {
      findings.push(`- DUPLICATE_ID: ${location} — multiple - **ID:** bullets on the same entry`);
      if (entry.workItemId) registerValidId(entry.workItemId, location);
    } else if (entry.workItemIdError === 'malformed') {
      findings.push(
        `- MALFORMED_ID: ${location} — malformed work-item ID "${entry.workItemIdRaw ?? ''}" (expected wi-<4-8 lowercase hex>)`,
      );
    } else if (!entry.workItemId) {
      hasMissing = true;
      findings.push(`- MISSING_ID: ${location} — missing - **ID:** wi-<hex> bullet`);
    } else {
      registerValidId(entry.workItemId, location);
    }
  }

  // 2. ## Future bullets (satellite or inline).
  const futureSource = ctx.paths.futureArchive !== null ? 'docs/roadmap-future.md' : 'ROADMAP.md ## Future';
  for (const bullet of ctx.roadmap.value.futureBullets) {
    inspectableCount++;
    const location = `${futureSource} (${shortFutureLabel(bullet)})`;
    const parsed = extractInlineBulletId(bullet);
    if (parsed === null) {
      hasMissing = true;
      findings.push(`- MISSING_ID: ${location} — missing **ID:** wi-<hex>`);
    } else if (parsed.id === null) {
      findings.push(
        `- MALFORMED_ID: ${location} — malformed work-item ID "${parsed.raw}" (expected wi-<4-8 lowercase hex>)`,
      );
    } else {
      registerValidId(parsed.id, location);
    }
  }

  // 3. ROADMAP.md + docs/roadmap-shipped.md Track headings.
  for (const track of ctx.roadmap.value.tracks) {
    inspectableCount++;
    const fileLabel = track.fromShippedArchive ? 'docs/roadmap-shipped.md' : 'ROADMAP.md';
    const location = `${fileLabel} Track ${track.id}`;
    if (track.workItemIdError === 'duplicate') {
      findings.push(`- DUPLICATE_ID: ${location} — multiple _id: lines on the same Track`);
      if (track.workItemId) registerValidId(track.workItemId, location);
    } else if (track.workItemIdError === 'malformed') {
      findings.push(
        `- MALFORMED_ID: ${location} — malformed work-item ID "${track.workItemIdRaw ?? ''}" (expected wi-<4-8 lowercase hex>)`,
      );
    } else if (!track.workItemId) {
      hasMissing = true;
      findings.push(`- MISSING_ID: ${location} — missing _id: wi-<hex>_`);
    } else {
      registerValidId(track.workItemId, location);
    }
  }

  // 3b. Archive Track records dropped on Track-label collision during mergeShippedArchive.
  for (const rec of ctx.roadmap.value.archiveCollisionTracks ?? []) {
    inspectableCount++;
    const location = `docs/roadmap-shipped.md Track ${rec.label}`;
    if (rec.workItemIdError === 'duplicate') {
      findings.push(`- DUPLICATE_ID: ${location} — multiple _id: lines on the same Track`);
      if (rec.workItemId) registerValidId(rec.workItemId, location);
    } else if (rec.workItemIdError === 'malformed') {
      findings.push(
        `- MALFORMED_ID: ${location} — malformed work-item ID "${rec.workItemIdRaw ?? ''}" (expected wi-<4-8 lowercase hex>)`,
      );
    } else if (!rec.workItemId) {
      hasMissing = true;
      findings.push(`- MISSING_ID: ${location} — missing _id: wi-<hex>_`);
    } else {
      registerValidId(rec.workItemId, location);
    }
  }

  // 4. Legacy shipped `- Track <label> — ...` bullets.
  for (const leg of ctx.roadmap.value.legacyShippedTracks ?? []) {
    inspectableCount++;
    const location = `shipped Track ${leg.label} (line ${leg.line})`;
    if (leg.workItemIdError === 'malformed') {
      findings.push(
        `- MALFORMED_ID: ${location} — malformed work-item ID "${leg.workItemIdRaw ?? ''}" (expected wi-<4-8 lowercase hex>)`,
      );
    } else if (!leg.workItemId) {
      hasMissing = true;
      findings.push(`- MISSING_ID: ${location} — missing **ID:** wi-<hex>`);
    } else {
      registerValidId(leg.workItemId, location);
    }
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
