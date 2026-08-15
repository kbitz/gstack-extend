/**
 * packing.ts — written Groups must match the packer's bins.
 *
 * Builds PackTracks from unshipped, non-legacy, non-hotfix-group Tracks.
 * Hotfix Groups are not packer bins — STRUCTURE owns the 1-track rule.
 * Packer input is track-level `_blocked-by:` + `_touches:` only.
 * Group-level `_Depends on:` is derived output / validation, not input.
 */

import { fillCap, packingDrift, packTracks, type PackResult, type PackTrack } from '../lib/pack.ts';
import type { AuditCtx, CheckResult } from '../types.ts';

export function tracksForPacker(ctx: AuditCtx): PackTrack[] {
  const groups = ctx.roadmap.value.groups;
  const tracks = ctx.roadmap.value.tracks;
  const liveIds = new Set(
    tracks.filter((t) => t.state !== 'shipped' && !t.legacy).map((t) => t.id),
  );
  const groupByNum = new Map(groups.map((g) => [g.num, g]));

  const out: PackTrack[] = [];
  for (const t of tracks) {
    if (t.state === 'shipped' || t.legacy) continue;
    const g = groupByNum.get(t.groupNum);
    if (g?.isHotfix) continue;
    out.push({
      id: t.id,
      touches: t.touches,
      blockedBy: t.blockedBy.filter((id) => liveIds.has(id)),
      isHotfix: false,
    });
  }
  return out;
}

export function writtenUnshippedGroups(ctx: AuditCtx): string[][] {
  const byId = new Map(ctx.roadmap.value.tracks.map((t) => [t.id, t]));
  const sets: string[][] = [];
  for (const g of ctx.roadmap.value.groups) {
    if (g.isHotfix) continue;
    if (g.state === 'shipped') continue;
    const ids: string[] = [];
    for (const tid of g.trackIds) {
      const t = byId.get(tid);
      if (t === undefined) continue;
      if (t.state === 'shipped' || t.legacy) continue;
      ids.push(tid);
    }
    if (ids.length > 0) sets.push(ids);
  }
  return sets;
}

function missingCollisionDeps(ctx: AuditCtx, packed: PackResult): string[] {
  const trackGroup = new Map(ctx.roadmap.value.tracks.map((t) => [t.id, t.groupNum]));
  const groupByNum = new Map(ctx.roadmap.value.groups.map((g) => [g.num, g]));
  const counts = new Map<string, number>();
  for (const bin of packed.bins) {
    if (bin.blockedByTracks.length === 0) continue;
    const binGroups = new Set<string>();
    for (const id of bin.trackIds) {
      const gNum = trackGroup.get(id);
      if (gNum !== undefined) binGroups.add(gNum);
    }
    for (const gNum of binGroups) {
      const g = groupByNum.get(gNum);
      if (g === undefined || g.isHotfix) continue;
      for (const blocker of bin.blockedByTracks) {
        const aNum = trackGroup.get(blocker);
        if (aNum === undefined || aNum === gNum) continue;
        const listed = g.deps.kind === 'list' && g.deps.depNums.includes(aNum);
        if (!listed) {
          const key = `${gNum}\t${aNum}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
    }
  }
  const findings: string[] = [];
  for (const [key, n] of [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const [gNum, aNum] = key.split('\t');
    findings.push(
      `- Group ${gNum} ← Group ${aNum} missing \`_Depends on: Group ${aNum}_\` (${n} track-level edge${n === 1 ? '' : 's'})`,
    );
  }
  return findings;
}

export function runCheckPacking(ctx: AuditCtx): CheckResult {
  const input = tracksForPacker(ctx);
  if (input.length === 0) {
    return {
      section: 'PACKING',
      status: 'skip',
      body: ['FINDINGS:', '- No unshipped Tracks to pack'],
    };
  }

  const cap = fillCap(ctx.parallelismCap);
  const packed = packTracks(input, { target: cap, maxPerBin: cap });
  const written = writtenUnshippedGroups(ctx);
  const drift = packingDrift(written, packed);
  const edgeGaps = missingCollisionDeps(ctx, packed);

  const body: string[] = [];
  if (drift.length === 0 && edgeGaps.length === 0) {
    body.push('FINDINGS:', '- (none)');
    body.push(`BINS: ${packed.bins.length}`);
    return { section: 'PACKING', status: 'pass', body };
  }

  body.push('FINDINGS:');
  if (drift.length > 0) {
    body.push('- written Groups do not match packer bins — re-run /roadmap Step 2 (draft Tracks, then bin/roadmap-pack)');
    body.push(...drift);
  }
  body.push(...edgeGaps);
  body.push('');
  body.push(`BINS: ${packed.bins.length}`);
  return { section: 'PACKING', status: 'fail', body };
}
