/**
 * packing.ts — written Groups must match the packer's bins.
 *
 * Builds PackTracks from unshipped, non-legacy, non-hotfix-group Tracks.
 * Group-level `_Depends on: Group N` (explicit list) inherits as
 * blocked-by every live Track in those Groups. Unspecified group deps
 * are none (v3) and do not create edges.
 */

import { packingDrift, packTracks, type PackTrack } from '../lib/pack.ts';
import type { AuditCtx, CheckResult } from '../types.ts';

export function tracksForPacker(ctx: AuditCtx): PackTrack[] {
  const groups = ctx.roadmap.value.groups;
  const tracks = ctx.roadmap.value.tracks;
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const liveIds = new Set(
    tracks.filter((t) => t.state !== 'shipped' && !t.legacy).map((t) => t.id),
  );
  const groupByNum = new Map(groups.map((g) => [g.num, g]));

  const out: PackTrack[] = [];
  for (const t of tracks) {
    if (t.state === 'shipped' || t.legacy) continue;
    const g = groupByNum.get(t.groupNum);
    if (g?.isHotfix) {
      out.push({
        id: t.id,
        touches: t.touches,
        blockedBy: [],
        isHotfix: true,
      });
      continue;
    }
    const blocked = new Set(t.blockedBy.filter((id) => liveIds.has(id)));
    if (g !== undefined && g.deps.kind === 'list') {
      for (const depNum of g.deps.depNums) {
        const depG = groupByNum.get(depNum);
        if (depG === undefined) continue;
        for (const tid of depG.trackIds) {
          const depT = byId.get(tid);
          if (depT === undefined) continue;
          if (depT.state === 'shipped' || depT.legacy) continue;
          if (tid !== t.id) blocked.add(tid);
        }
      }
    }
    out.push({
      id: t.id,
      touches: t.touches,
      blockedBy: [...blocked],
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

export function runCheckPacking(ctx: AuditCtx): CheckResult {
  const input = tracksForPacker(ctx);
  if (input.length === 0) {
    return {
      section: 'PACKING',
      status: 'skip',
      body: ['FINDINGS:', '- No unshipped Tracks to pack'],
    };
  }

  const packed = packTracks(input);
  const written = writtenUnshippedGroups(ctx);
  const drift = packingDrift(written, packed);

  const body: string[] = [];
  if (drift.length === 0) {
    body.push('FINDINGS:', '- (none)');
    body.push(`BINS: ${packed.bins.length}`);
    return { section: 'PACKING', status: 'pass', body };
  }

  body.push('FINDINGS:');
  body.push('- written Groups do not match packer bins — re-run /roadmap Step 2 (draft Tracks, then bin/roadmap-pack)');
  body.push(...drift);
  body.push('');
  body.push(`BINS: ${packed.bins.length}`);
  return { section: 'PACKING', status: 'fail', body };
}
