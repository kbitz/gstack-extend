/**
 * collisions.ts — port of check_collisions (~L2533-2660).
 *
 * For each Group, computes the pairwise intersection of every modern
 * Track's `_touches:_` set. Non-empty intersection = audit blocker.
 * Pairs where one Track depends on the other (direct or transitive)
 * skip the check — the dep edge IS the serialization signal.
 *
 * Each collision is classified:
 *   - SHARED_INFRA when ANY overlapping path is in the loaded
 *     docs/shared-infra.txt set (fix: promote to Pre-flight).
 *   - PARALLEL otherwise (fix: merge tracks or split into next Group).
 *
 * Side outputs:
 *   - GROUP_SIZE_WARNINGS: Group has more modern tracks than the cap
 *     (regardless of serialization — a 7-track serialized Group is still
 *     unwieldy).
 *   - SERIALIZED_GROUPS: surfaced for humans; the per-pair dep-skip is
 *     where the actual serialization is honored.
 *
 * Output shape:
 *   STATUS: pass | fail | skip
 *   FINDINGS: per-collision (or "- (none)")
 *   [GROUP_SIZE_WARNINGS:]
 *   [SERIALIZED_GROUPS:]
 *   MAX_TRACKS_PER_GROUP: N
 *   SHARED_INFRA_STATUS: missing | loaded
 */

import { ceiling } from '../lib/effort.ts';
import { trackDependsOn } from '../parsers/roadmap.ts';
import type { AuditCtx, CheckResult } from '../types.ts';

export function runCheckCollisions(ctx: AuditCtx): CheckResult {
  if (ctx.roadmap.value.groups.length === 0) {
    return {
      section: 'COLLISIONS',
      status: 'skip',
      body: ['FINDINGS:', '- No Groups found'],
    };
  }

  const maxTracksPerGroup = ceiling('max_tracks_per_group');
  const sharedSet = ctx.sharedInfra.status === 'loaded' ? ctx.sharedInfra.files : new Set<string>();
  const trackById = new Map(ctx.roadmap.value.tracks.map((t) => [t.id, t]));
  const completeTracks = new Set(ctx.roadmap.value.tracks.filter((t) => t.isComplete).map((t) => t.id));

  const findings: string[] = [];
  const groupSizeWarnings: string[] = [];
  const serializedNotes: string[] = [];

  for (const g of ctx.roadmap.value.groups) {
    // Modern + non-complete Tracks only (legacy excluded from pairing).
    const tracks: string[] = [];
    for (const tid of g.trackIds) {
      if (completeTracks.has(tid)) continue;
      const t = trackById.get(tid);
      if (t === undefined) continue;
      if (t.legacy) continue;
      tracks.push(tid);
    }

    if (tracks.length > maxTracksPerGroup) {
      groupSizeWarnings.push(
        `- Group ${g.num}: ${tracks.length} modern tracks exceeds max_tracks_per_group=${maxTracksPerGroup}`,
      );
    }
    if (g.serialize && tracks.length >= 2) {
      serializedNotes.push(
        `- Group ${g.num}: ${tracks.length} tracks declared serial (\`_serialize: true_\`)`,
      );
    }

    for (let i = 0; i < tracks.length; i++) {
      for (let j = i + 1; j < tracks.length; j++) {
        const a = tracks[i]!;
        const b = tracks[j]!;
        if (
          trackDependsOn(ctx.roadmap.value, a, b) ||
          trackDependsOn(ctx.roadmap.value, b, a)
        ) {
          continue;
        }
        const aT = trackById.get(a);
        const bT = trackById.get(b);
        if (aT === undefined || bT === undefined) continue;
        if (aT.touches.length === 0 || bT.touches.length === 0) continue;

        // Compute sorted-deduped intersection.
        // LC_ALL=C: byte-wise sort via < comparator.
        const aSorted = [...new Set(aT.touches)].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
        const bSet = new Set(bT.touches);
        const intersection: string[] = [];
        for (const x of aSorted) {
          if (bSet.has(x)) intersection.push(x);
        }
        if (intersection.length === 0) continue;

        let classification: 'SHARED_INFRA' | 'PARALLEL' = 'PARALLEL';
        for (const f of intersection) {
          if (sharedSet.has(f)) {
            classification = 'SHARED_INFRA';
            break;
          }
        }
        findings.push(`- ${a}-${b}: [${intersection.join(',')}] [${classification}]`);
      }
    }
  }

  // Bash sets `found=1` on either findings OR group_size_warnings; both
  // route to STATUS: fail. The FINDINGS body itself only contains per-pair
  // lines (warnings render as their own block below).
  const failed = findings.length > 0 || groupSizeWarnings.length > 0;

  const body: string[] = [];
  if (!failed) {
    body.push('FINDINGS:', '- (none)');
  } else if (findings.length === 0) {
    // Bash `echo -e ""` emits a blank line where per-pair findings would go.
    body.push('FINDINGS:', '');
  } else {
    body.push('FINDINGS:', ...findings, '');
  }
  if (groupSizeWarnings.length > 0) {
    body.push('GROUP_SIZE_WARNINGS:', ...groupSizeWarnings, '');
  }
  if (serializedNotes.length > 0) {
    body.push('SERIALIZED_GROUPS:', ...serializedNotes, '');
  }
  body.push(`MAX_TRACKS_PER_GROUP: ${maxTracksPerGroup}`);
  body.push(`SHARED_INFRA_STATUS: ${ctx.sharedInfra.status}`);

  return {
    section: 'COLLISIONS',
    status: failed ? 'fail' : 'pass',
    body,
  };
}
