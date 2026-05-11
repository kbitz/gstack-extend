/**
 * collisions.ts — Track-pair touches collision check.
 *
 * For each Group, computes the pairwise intersection of every active
 * (non-shipped, non-legacy) Track's `_touches:_` set. Non-empty
 * intersection = audit blocker. Tracks within a Group must be fully
 * parallel-safe; intra-Group `_Depends on:_` is itself a STRUCTURE: fail.
 *
 * Each collision is classified:
 *   - SHARED_INFRA when ANY overlapping path is in the loaded
 *     docs/shared-infra.txt set.
 *   - PARALLEL otherwise.
 *
 * Side outputs:
 *   - GROUP_SIZE_WARNINGS: Group has more active Tracks than the cap.
 *
 * Output shape:
 *   STATUS: pass | fail | skip
 *   FINDINGS: per-collision (or "- (none)")
 *   [GROUP_SIZE_WARNINGS:]
 *   MAX_TRACKS_PER_GROUP: N
 *   SHARED_INFRA_STATUS: missing | loaded
 */

import { ceiling } from '../lib/effort.ts';
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

  const findings: string[] = [];
  const groupSizeWarnings: string[] = [];

  for (const g of ctx.roadmap.value.groups) {
    // Active (non-shipped, non-legacy) Tracks only.
    const tracks: string[] = [];
    for (const tid of g.trackIds) {
      const t = trackById.get(tid);
      if (t === undefined) continue;
      if (t.state === 'shipped') continue;
      if (t.legacy) continue;
      tracks.push(tid);
    }

    if (tracks.length > maxTracksPerGroup) {
      groupSizeWarnings.push(
        `- Group ${g.num}: ${tracks.length} active tracks exceeds max_tracks_per_group=${maxTracksPerGroup}`,
      );
    }

    for (let i = 0; i < tracks.length; i++) {
      for (let j = i + 1; j < tracks.length; j++) {
        const a = tracks[i]!;
        const b = tracks[j]!;
        const aT = trackById.get(a);
        const bT = trackById.get(b);
        if (aT === undefined || bT === undefined) continue;
        if (aT.touches.length === 0 || bT.touches.length === 0) continue;

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

  const failed = findings.length > 0 || groupSizeWarnings.length > 0;

  const body: string[] = [];
  if (!failed) {
    body.push('FINDINGS:', '- (none)');
  } else if (findings.length === 0) {
    body.push('FINDINGS:', '');
  } else {
    body.push('FINDINGS:', ...findings, '');
  }
  if (groupSizeWarnings.length > 0) {
    body.push('GROUP_SIZE_WARNINGS:', ...groupSizeWarnings, '');
  }
  body.push(`MAX_TRACKS_PER_GROUP: ${maxTracksPerGroup}`);
  body.push(`SHARED_INFRA_STATUS: ${ctx.sharedInfra.status}`);

  return {
    section: 'COLLISIONS',
    status: failed ? 'fail' : 'pass',
    body,
  };
}
