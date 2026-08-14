/**
 * size-caps.ts — per-track size cap enforcement.
 *
 * Session weight is the hard unit (S=1, M=2, L=4, XL=5). A Track that
 * exceeds max_session_weight (default 4) is not a Track. Delete-tagged
 * tasks count as S regardless of declared N. Markdown-only and delete-only
 * Tracks skip the code file-fanout cap.
 *
 * LOC is still summed for SIZE_LABEL_MISMATCH (write-tasks only) and
 * emitted as MAX_LOC_PER_TRACK for back-compat — it is not a fail gate.
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
  const maxWeight = ceiling('max_session_weight');

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
    if (t.sessionWeight > maxWeight) {
      findings.push(
        `- ${t.id}: session_weight=${t.sessionWeight} exceeds max_session_weight=${maxWeight} — split into multiple Tracks`,
      );
    }
    const skipFanout = t.markdownOnly || t.deleteOnly;
    if (!skipFanout && t.filesCount > maxFiles) {
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
  body.push(`MAX_SESSION_WEIGHT: ${maxWeight}`);
  body.push(`MAX_LOC_PER_TRACK: ${maxLoc}`);
  body.push(`MAX_FILES_PER_TRACK: ${maxFiles}`);

  if (legacyTracks.length > 0) {
    body.push(`LEGACY_TRACKS: ${legacyTracks.join(',')}`);
  }

  return { section: 'SIZE', status, body };
}
