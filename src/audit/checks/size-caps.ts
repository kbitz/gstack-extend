/**
 * size-caps.ts — port of check_size_caps (~L2417-2525).
 *
 * Enforces per-track size caps on modern (non-legacy) Tracks; legacy
 * Tracks with no `_touches:_` are skipped with a banner. ✓ Complete
 * Tracks are skipped silently (caps are advice for in-flight work).
 *
 * Caps come from lib/effort.ts ceilings. Findings report tasks/loc/files
 * exceedances per track, plus a split suggestion when a track is
 * oversized — clusters its tasks by primary file path and surfaces the
 * clusters when 2+ contain ≥2 tasks.
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
import type { TrackInfo } from '../parsers/roadmap.ts';
import type { AuditCtx, CheckResult } from '../types.ts';

const TRACK_RE = /^### Track ([0-9]+[A-Z](?:\.[0-9]+)?):/;
const ANY_H2_RE = /^## /;

function splitSuggestion(roadmapContent: string, targetTrack: string): string {
  const lines = roadmapContent.split('\n');
  let inTarget = false;
  // path → count, insertion order preserved for stable output.
  const clusters = new Map<string, number>();
  for (const line of lines) {
    const tm = line.match(TRACK_RE);
    if (tm !== null) {
      inTarget = tm[1] === targetTrack;
      continue;
    }
    if (!inTarget) continue;
    if (ANY_H2_RE.test(line)) {
      inTarget = false;
      continue;
    }
    if (!/^- \*\*/.test(line)) continue;
    const btMatch = line.match(/`([^`]+)`/);
    let path = btMatch !== null ? btMatch[1]! : '(misc)';
    let key: string;
    if (path.includes('/')) {
      const parts = path.split('/');
      key = `${parts[0]}/${parts[1] ?? ''}`.replace(/\/$/, '');
    } else {
      key = path;
    }
    clusters.set(key, (clusters.get(key) ?? 0) + 1);
  }
  const big: string[] = [];
  for (const [key, count] of clusters) {
    if (count >= 2) big.push(`${key} (${count})`);
  }
  if (big.length < 2) return '';
  return `  Split suggestion for ${targetTrack}: tasks cluster by file path into ${big.length} groups [${big.join(', ')}]. Consider splitting along these lines.`;
}

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
    if (t.isComplete) continue;
    if (t.legacy) {
      legacyTracks.push(t.id);
      continue;
    }
    modernCount++;
    let oversized = false;
    if (t.tasksCount > maxTasks) {
      findings.push(`- ${t.id}: tasks=${t.tasksCount} exceeds max_tasks_per_track=${maxTasks}`);
      oversized = true;
    }
    if (t.loc > maxLoc) {
      findings.push(`- ${t.id}: loc=${t.loc} exceeds max_loc_per_track=${maxLoc}`);
      oversized = true;
    }
    if (t.filesCount > maxFiles) {
      findings.push(`- ${t.id}: files=${t.filesCount} exceeds max_files_per_track=${maxFiles}`);
      oversized = true;
    }
    if (oversized) {
      const sug = splitSuggestion(ctx.files.roadmap, t.id);
      if (sug !== '') findings.push(sug);
    }
  }

  // Body assembly. Status precedence: skip-legacy-all > pass > fail.
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
    body.push(''); // bash echo -e of \n-terminated $findings artifact
  }

  // SIZE_LABEL_MISMATCH (informational), independent of cap status.
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
