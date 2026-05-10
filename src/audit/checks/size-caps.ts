/**
 * size-caps.ts — per-track size cap enforcement.
 *
 * Enforces caps on active (non-shipped, non-legacy) Tracks. Legacy Tracks
 * with no `_touches:_` are skipped with a banner. Shipped Tracks are
 * skipped silently (caps are advice for in-flight/planned work).
 *
 * Caps come from lib/effort.ts ceilings. The v2 rule is hard: if a Track
 * exceeds the LOC cap, it isn't a Track — it's multiple Tracks. The skill's
 * regenerate step is responsible for splitting; the audit just fails so
 * oversized Tracks don't survive a /roadmap run.
 *
 * SIZE_LABEL_MISMATCH (informational): per-task `~N lines` vs effort tier
 * LOC mapping divergence >3x. Always emitted (independent of cap status)
 * when any are present.
 *
 * Output shape:
 *   STATUS: pass | fail | skip | skip-legacy-all
 *   FINDINGS: per-finding lines (or "- (none)")
 *   [SIZE_LABEL_MISMATCH:]   (only when present)
 *   MAX_TASKS_PER_TRACK / MAX_LOC_PER_TRACK / MAX_FILES_PER_TRACK
 *   [LEGACY_TRACKS:]         (only when any legacy tracks remain)
 */

import { ceiling } from '../lib/effort.ts';
import type { AuditCtx, CheckResult } from '../types.ts';

export function runCheckSizeCaps(ctx: AuditCtx): CheckResult {
  const tracks = ctx.roadmap.value.tracks;
  if (tracks.length === 0) {
    return {
      section: 'SIZE',
      status: 'skip',
      body: ['FINDINGS:', '- No tracks found'],
    };
  }

  const maxTasks = ceiling('max_tasks_per_track');
  const maxLoc = ceiling('max_loc_per_track');
  const maxFiles = ceiling('max_files_per_track');

  const findings: string[] = [];
  let modernCount = 0;
  const legacyTracks: string[] = [];

  for (const t of tracks) {
    if (t.state === 'shipped') continue;
    if (t.legacy) {
      legacyTracks.push(t.id);
      continue;
    }
    modernCount++;
    if (t.tasksCount > maxTasks) {
      findings.push(`- ${t.id}: tasks=${t.tasksCount} exceeds max_tasks_per_track=${maxTasks}`);
    }
    if (t.loc > maxLoc) {
      findings.push(`- ${t.id}: loc=${t.loc} exceeds max_loc_per_track=${maxLoc} — split into multiple Tracks`);
    }
    if (t.filesCount > maxFiles) {
      findings.push(`- ${t.id}: files=${t.filesCount} exceeds max_files_per_track=${maxFiles}`);
    }
  }

  let status: 'pass' | 'fail' | 'skip-legacy-all';
  const body: string[] = [];
  if (findings.length === 0 && modernCount === 0) {
    status = 'skip-legacy-all';
    body.push('FINDINGS:');
    body.push('- All tracks are legacy (no _touches:_ metadata) — run /roadmap to migrate');
  } else if (findings.length === 0) {
    status = 'pass';
    body.push('FINDINGS:');
    body.push('- (none)');
  } else {
    status = 'fail';
    body.push('FINDINGS:');
    body.push(...findings);
    body.push('');
  }

  const mismatches = ctx.roadmap.value.sizeLabelMismatches;
  if (mismatches.length > 0) {
    body.push('SIZE_LABEL_MISMATCH:');
    for (const m of mismatches) {
      body.push(
        `- ${m.trackId} "${m.title}": effort=(${m.effort}) implies ~${m.expectedLoc} LOC, declared ~${m.declaredLines} lines (>3x divergence)`,
      );
    }
  }

  body.push(`MAX_TASKS_PER_TRACK: ${maxTasks}`);
  body.push(`MAX_LOC_PER_TRACK: ${maxLoc}`);
  body.push(`MAX_FILES_PER_TRACK: ${maxFiles}`);

  if (legacyTracks.length > 0) {
    body.push(`LEGACY_TRACKS: ${legacyTracks.join(',')}`);
  }

  return { section: 'SIZE', status, body };
}
