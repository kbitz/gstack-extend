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
 *   MAX_TRACKS_PER_GROUP: N   (fillCap(parallelism_cap) — not a separate ceiling)
 *   SHARED_INFRA_STATUS: missing | loaded
 */

import { fillCap, isSharedDoc, normalizeTouch, touchesIntersect } from '../lib/pack.ts';
import type { AuditCtx, CheckResult } from '../types.ts';

export function runCheckCollisions(ctx: AuditCtx): CheckResult {
  if (ctx.roadmap.value.groups.length === 0) {
    return {
      section: 'COLLISIONS',
      status: 'skip',
      body: ['FINDINGS:', '- No Groups found'],
    };
  }

  const maxTracksPerGroup = fillCap(ctx.parallelismCap);
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
        `- Group ${g.num}: ${tracks.length} active tracks exceeds fill cap ${maxTracksPerGroup} (parallelism_cap)`,
      );
    }

    const claudeOwners: string[] = [];
    for (const tid of tracks) {
      const t = trackById.get(tid);
      if (t === undefined) continue;
      for (const raw of t.touches) {
        const n = normalizeTouch(raw);
        if (n.path === 'CLAUDE.md' || n.path === 'docs/CLAUDE.md') {
          claudeOwners.push(tid);
          break;
        }
      }
    }
    if (claudeOwners.length > 1) {
      findings.push(
        `- Group ${g.num}: CLAUDE.md claimed by ${claudeOwners.join(',')} — only one Track per Group may declare it`,
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
        if (!touchesIntersect(aT.touches, bT.touches)) continue;

        const aNorm = aT.touches.map((t) => normalizeTouch(t).path);
        const bNorm = new Set(bT.touches.map((t) => normalizeTouch(t).path));
        const intersection: string[] = [];
        for (const x of [...new Set(aNorm)].sort((p, q) => (p < q ? -1 : p > q ? 1 : 0))) {
          if (isSharedDoc(x)) continue;
          if (bNorm.has(x)) intersection.push(x);
        }
        // Directory-prefix hits may not share an identical token.
        if (intersection.length === 0) {
          intersection.push('(prefix)');
        }

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
