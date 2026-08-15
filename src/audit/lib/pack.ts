/**
 * pack.ts — theme-blind Track packer and scheduler.
 *
 * Input: unshipped Tracks with `_touches:_` and `_blocked-by:`.
 * Output: layers × bins. A bin is a launch Group (target = parallelism_cap,
 * hard max 8). Objective: minimize dependency layers, fill bins up to cap.
 *
 * Layers are serial (explicit blocked-by, plus collision spill).
 * Capacity overflow stays in the same layer (parallel ready).
 * File-collision spill is a later layer — never two ready bins on one path.
 * Thin waves are usually group-dep inheritance (removed); the packer
 * fills to cap and reports CRITICAL_PATH so a human can see the cost.
 *
 * Shared docs are excluded from collision. A path ending in `/` is a
 * directory prefix. `path (new)` is the same path without the marker.
 *
 * Group-level `_Depends on:` is NOT packer input — only track `_blocked-by:`
 * and file collisions. Group deps are derived output.
 */

export const PACK_TARGET = 6;

export const SHARED_DOC_PATHS = new Set([
  'docs/ROADMAP.md',
  'docs/TODOS.md',
  'docs/PROGRESS.md',
  'docs/roadmap-shipped.md',
  'ROADMAP.md',
  'TODOS.md',
  'PROGRESS.md',
  'CHANGELOG.md',
  'VERSION',
]);

export type PackTrack = {
  id: string;
  touches: string[];
  /** Track IDs that must ship before this one (track-level `_blocked-by:` only). */
  blockedBy: string[];
  isHotfix?: boolean;
};

export type PackedBin = {
  layer: number;
  trackIds: string[];
  /** Track IDs in earlier layers that block any member of this bin. */
  blockedByTracks: string[];
};

export type PackResult = {
  bins: PackedBin[];
  /** Longest bin-chain by blocked-by / collision edges (track ids). */
  criticalPath: string[];
  /** blocked-by cycles (each entry is "A → B → A"). */
  cycles: string[];
};

export type TouchNorm = {
  path: string;
  dir: boolean;
};

export function normalizeTouch(raw: string): TouchNorm {
  let s = raw.replace(/^[ \t\v\f\r]+|[ \t\v\f\r]+$/g, '');
  s = s.replace(/[ \t\v\f\r]*\(new\)[ \t\v\f\r]*$/i, '');
  s = s.replace(/^[ \t\v\f\r]+|[ \t\v\f\r]+$/g, '');
  const dir = s.endsWith('/');
  if (dir) s = s.replace(/\/+$/, '') + '/';
  return { path: s, dir };
}

export function isSharedDoc(path: string): boolean {
  const stripped = path.replace(/\/+$/, '');
  return SHARED_DOC_PATHS.has(path) || SHARED_DOC_PATHS.has(stripped);
}

export function schedulingTouches(touches: string[]): TouchNorm[] {
  const out: TouchNorm[] = [];
  for (const raw of touches) {
    const n = normalizeTouch(raw);
    if (n.path === '' || isSharedDoc(n.path)) continue;
    out.push(n);
  }
  return out;
}

export function touchesIntersect(a: string[], b: string[]): boolean {
  const na = schedulingTouches(a);
  const nb = schedulingTouches(b);
  for (const x of na) {
    for (const y of nb) {
      if (x.path === y.path) return true;
      if (x.dir && y.path.startsWith(x.path)) return true;
      if (y.dir && x.path.startsWith(y.path)) return true;
    }
  }
  return false;
}

function longestPathLayer(
  tracks: PackTrack[],
): { layers: Map<string, number>; cycles: string[] } {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const memo = new Map<string, number>();
  const walking = new Set<string>();
  const stack: string[] = [];
  const cycles: string[] = [];
  const seenCycle = new Set<string>();

  function layerOf(id: string): number {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (walking.has(id)) {
      const start = stack.indexOf(id);
      const loop = start >= 0 ? [...stack.slice(start), id] : [id, id];
      const key = loop.join('→');
      if (!seenCycle.has(key)) {
        seenCycle.add(key);
        cycles.push(loop.join(' → '));
      }
      return 0;
    }
    walking.add(id);
    stack.push(id);
    const t = byId.get(id);
    let maxDep = -1;
    if (t !== undefined) {
      for (const d of t.blockedBy) {
        if (!byId.has(d)) continue;
        maxDep = Math.max(maxDep, layerOf(d));
      }
    }
    stack.pop();
    walking.delete(id);
    const layer = maxDep + 1;
    memo.set(id, layer);
    return layer;
  }

  for (const t of tracks) layerOf(t.id);
  return { layers: memo, cycles };
}

function computeCriticalPath(bins: PackedBin[]): string[] {
  if (bins.length === 0) return [];
  const idx = new Map<string, number>();
  for (let i = 0; i < bins.length; i++) {
    for (const id of bins[i]!.trackIds) idx.set(id, i);
  }
  const succ: number[][] = bins.map(() => []);
  for (let j = 0; j < bins.length; j++) {
    for (const b of bins[j]!.blockedByTracks) {
      const i = idx.get(b);
      if (i !== undefined && i !== j && !succ[i]!.includes(j)) succ[i]!.push(j);
    }
  }
  const memo = new Map<number, number[]>();
  const walking = new Set<number>();
  function pathFrom(i: number): number[] {
    const cached = memo.get(i);
    if (cached !== undefined) return cached;
    if (walking.has(i)) return [i];
    walking.add(i);
    let best: number[] = [i];
    for (const j of succ[i]!) {
      const p = pathFrom(j);
      if (p.length + 1 > best.length) best = [i, ...p];
    }
    walking.delete(i);
    memo.set(i, best);
    return best;
  }
  let bestPath: number[] = [0];
  for (let i = 0; i < bins.length; i++) {
    const p = pathFrom(i);
    if (p.length > bestPath.length) bestPath = p;
  }
  return bestPath.map((i) => bins[i]!.trackIds[0]!);
}

function binCollides(bin: PackTrack[], candidate: PackTrack): boolean {
  for (const existing of bin) {
    if (touchesIntersect(existing.touches, candidate.touches)) return true;
  }
  return false;
}

type LayerBin = {
  tracks: PackTrack[];
  layerOffset: number;
  collisionBlockedBy: string[];
};

function absorbTails(bins: LayerBin[], maxPerBin: number): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = bins.length - 1; i >= 1; i--) {
      const last = bins[i]!;
      const prev = bins[i - 1]!;
      if (last.layerOffset !== prev.layerOffset) continue;
      if (prev.tracks.some((x) => x.isHotfix) || last.tracks.some((x) => x.isHotfix)) continue;
      if (prev.tracks.length + last.tracks.length > maxPerBin) continue;
      if (last.tracks.some((t) => binCollides(prev.tracks, t))) continue;
      prev.tracks.push(...last.tracks);
      bins.splice(i, 1);
      changed = true;
      break;
    }
  }
}

function collidingIds(bin: PackTrack[], candidate: PackTrack): string[] {
  const ids: string[] = [];
  for (const existing of bin) {
    if (touchesIntersect(existing.touches, candidate.touches)) ids.push(existing.id);
  }
  return ids;
}

export function packTracks(
  tracks: PackTrack[],
  opts: { target?: number; maxPerBin?: number } = {},
): PackResult {
  const target = opts.target ?? PACK_TARGET;
  const maxPerBin = opts.maxPerBin ?? 8;
  const capacity = Math.min(target, maxPerBin);

  const live = tracks.filter((t) => t.id !== '');
  if (live.length === 0) return { bins: [], criticalPath: [], cycles: [] };

  const { layers, cycles } = longestPathLayer(live);
  const byLayer = new Map<number, PackTrack[]>();
  for (const t of live) {
    const L = layers.get(t.id) ?? 0;
    const arr = byLayer.get(L) ?? [];
    arr.push(t);
    byLayer.set(L, arr);
  }

  const bins: PackedBin[] = [];
  const layerNums = [...byLayer.keys()].sort((a, b) => a - b);

  for (const L of layerNums) {
    const members = byLayer.get(L) ?? [];
    const ordered = [...members].sort((a, b) => {
      const da = schedulingTouches(a.touches).length;
      const db = schedulingTouches(b.touches).length;
      if (db !== da) return db - da;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    const layerBins: LayerBin[] = [];
    for (const t of ordered) {
      if (t.isHotfix) {
        layerBins.push({ tracks: [t], layerOffset: 0, collisionBlockedBy: [] });
        continue;
      }
      const fitOrder = [...layerBins].sort((a, b) => a.layerOffset - b.layerOffset);
      let placed = false;
      for (const bin of fitOrder) {
        if (bin.tracks.length >= capacity) continue;
        if (bin.tracks.some((x) => x.isHotfix)) continue;
        if (binCollides(bin.tracks, t)) continue;
        bin.tracks.push(t);
        placed = true;
        break;
      }
      if (!placed) {
        let collideOffset = -1;
        const collided: string[] = [];
        for (const bin of layerBins) {
          const hits = collidingIds(bin.tracks, t);
          if (hits.length === 0) continue;
          collideOffset = Math.max(collideOffset, bin.layerOffset);
          for (const id of hits) {
            if (!collided.includes(id)) collided.push(id);
          }
        }
        layerBins.push({
          tracks: [t],
          layerOffset: collideOffset >= 0 ? collideOffset + 1 : 0,
          collisionBlockedBy: collided,
        });
      }
    }

    absorbTails(layerBins, maxPerBin);

    for (const bin of layerBins) {
      const blocked = new Set<string>();
      for (const t of bin.tracks) {
        for (const d of t.blockedBy) {
          if (live.some((x) => x.id === d)) blocked.add(d);
        }
      }
      for (const d of bin.collisionBlockedBy) blocked.add(d);
      bins.push({
        layer: L + bin.layerOffset,
        trackIds: bin.tracks.map((t) => t.id).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
        blockedByTracks: [...blocked].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      });
    }
  }

  return {
    bins,
    criticalPath: cycles.length > 0 ? [] : computeCriticalPath(bins),
    cycles,
  };
}

/**
 * Compare a written Group partition against the packer.
 * Returns findings (empty = match).
 */
/** Colliding tracks with no `_blocked-by` path either way. */
export function unorderedCollisions(tracks: PackTrack[]): string[] {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const reach = new Map<string, Set<string>>();
  function reachable(from: string): Set<string> {
    const cached = reach.get(from);
    if (cached !== undefined) return cached;
    const seen = new Set<string>();
    const stack = [...(byId.get(from)?.blockedBy ?? [])];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const d of byId.get(id)?.blockedBy ?? []) stack.push(d);
    }
    reach.set(from, seen);
    return seen;
  }
  const findings: string[] = [];
  for (let i = 0; i < tracks.length; i++) {
    for (let j = i + 1; j < tracks.length; j++) {
      const a = tracks[i]!;
      const b = tracks[j]!;
      if (!touchesIntersect(a.touches, b.touches)) continue;
      if (reachable(a.id).has(b.id) || reachable(b.id).has(a.id)) continue;
      const [x, y] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
      findings.push(
        `unordered collision ${x} ∥ ${y} — declare _blocked-by or accept arbitrary order`,
      );
    }
  }
  return findings;
}

export function packingDrift(written: string[][], packed: PackResult): string[] {
  const normalize = (sets: string[][]) =>
    sets
      .map((s) => [...s].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(','))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const want = normalize(packed.bins.map((b) => b.trackIds));
  const got = normalize(written.filter((s) => s.length > 0));
  if (want.length === got.length && want.every((w, i) => w === got[i])) return [];

  return [
    `- written groups [${got.join(' | ') || '(none)'}]`,
    `- packer bins    [${want.join(' | ') || '(none)'}]`,
  ];
}

export function formatPackOutput(packed: PackResult, opts: { emptyHint?: string } = {}): string {
  if (packed.cycles.length > 0) {
    return `BINS: CYCLE\n${packed.cycles.map((c) => `- ${c}`).join('\n')}\n`;
  }
  if (packed.bins.length === 0) {
    return `BINS: EMPTY (${opts.emptyHint ?? 'no unshipped Tracks'})\n`;
  }
  const lines: string[] = ['BINS:'];
  const ordered = [...packed.bins].sort((a, b) => a.layer - b.layer);
  for (let i = 0; i < ordered.length; i++) {
    const b = ordered[i]!;
    const deps = b.blockedByTracks.length === 0 ? '{}' : `{${b.blockedByTracks.join(',')}}`;
    lines.push(`- bin ${i + 1} layer=${b.layer} ← ${deps} : ${b.trackIds.join(' ')}`);
  }
  if (packed.criticalPath.length > 0) {
    lines.push(
      `CRITICAL_PATH: ${packed.criticalPath.length} waves through ${packed.criticalPath.join(' → ')}`,
    );
  }
  lines.push('DEPENDS (write on the later Group after you name the bins):');
  let any = false;
  for (let i = 0; i < ordered.length; i++) {
    const b = ordered[i]!;
    if (b.blockedByTracks.length === 0) continue;
    const fromBins = new Set<number>();
    for (const tid of b.blockedByTracks) {
      const src = ordered.findIndex((x) => x.trackIds.includes(tid));
      if (src >= 0) fromBins.add(src + 1);
    }
    if (fromBins.size === 0) continue;
    any = true;
    const nums = [...fromBins].sort((a, b) => a - b);
    lines.push(
      `- bin ${i + 1}: \`_Depends on: ${nums.map((n) => `Group <bin ${n}>`).join(', ')}_\``,
    );
  }
  if (!any) lines.push('- (none — every bin is ready)');
  return lines.join('\n') + '\n';
}
