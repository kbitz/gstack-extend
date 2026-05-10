/**
 * mode.ts — port of detect_mode (~L1173-1205).
 *
 * Routes the /roadmap skill into one of three modes:
 *   - greenfield (no ROADMAP.md) → `overhaul`
 *   - has Groups OR has Future-only → `triage`
 *   - else (ROADMAP.md exists but no structure) → `overhaul`
 *
 * MODE is special: it has no STATUS line — bash emits only DETECTED + REASON.
 * cli.ts renders this via `renderMode(...)` rather than the standard
 * CheckResult path so the section format matches bash byte-for-byte.
 */

import type { AuditCtx } from '../types.ts';

export type ModeResult = {
  detected: 'overhaul' | 'triage';
  reason: string;
};

export function detectMode(ctx: AuditCtx): ModeResult {
  if (ctx.paths.roadmap === null) {
    return { detected: 'overhaul', reason: 'No ROADMAP.md found' };
  }

  let groupCount = 0;
  let hasFuture = false;
  for (const line of ctx.files.roadmap.split('\n')) {
    if (/^#{2,4} Group/.test(line)) groupCount++;
    if (/^## Future($| \()/i.test(line)) hasFuture = true;
  }

  if (groupCount > 0) {
    return {
      detected: 'triage',
      reason: `Valid Groups > Tracks structure found (${groupCount} groups)`,
    };
  }
  if (hasFuture) {
    return {
      detected: 'triage',
      reason: 'Future-only roadmap found (all items deferred to future phase)',
    };
  }
  return { detected: 'overhaul', reason: 'No Groups > Tracks structure found' };
}
