/**
 * pack.ts — theme-blind Track packer.
 *
 * Input: unshipped Tracks with `_touches:_` and optional `_blocked-by:`.
 * Output: layers × bins. A bin is a launch Group (target 4–6, max 8).
 * Layers are serial (explicit blocked-by, plus collision spill).
 * Capacity overflow stays in the same layer (parallel ready).
 * File-collision spill is a later layer — never two ready bins on one path.
 *
 * Shared docs are excluded from collision. A path ending in `/` is a
 * directory prefix. `path (new)` is the same path without the marker.
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
  /** Track IDs that must ship before this one (semantic + inherited group deps). */
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

function longestPathLayer(tracks: PackTrack[]): Map<string, number> {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const memo = new Map<string, number>();
  const walking = new Set<string>();

  function layerOf(id: string): number {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (walking.has(id)) return 0;
    walking.add(id);
    const t = byId.get(id);
    let maxDep = -1;
    if (t !== undefined) {
      for (const d of t.blockedBy) {
        if (!byId.has(d)) continue;
        maxDep = Math.max(maxDep, layerOf(d));
      }
    }
    walking.delete(id);
    const layer = maxDep + 1;
    memo.set(id, layer);
    return layer;
  }

  for (const t of tracks) layerOf(t.id);
  return memo;
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
  if (live.length === 0) return { bins: [] };

  const layers = longestPathLayer(live);
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

  return { bins };
}

/**
 * Compare a written Group partition against the packer.
 * Returns findings (empty = match).
 */
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

export function formatPackOutput(packed: PackResult): string {
  if (packed.bins.length === 0) return 'BINS: (none)\n';
  const lines: string[] = ['BINS:'];
  for (let i = 0; i < packed.bins.length; i++) {
    const b = packed.bins[i]!;
    const deps = b.blockedByTracks.length === 0 ? '{}' : `{${b.blockedByTracks.join(',')}}`;
    lines.push(`- bin ${i + 1} layer=${b.layer} ← ${deps} : ${b.trackIds.join(' ')}`);
  }
  return lines.join('\n') + '\n';
}
