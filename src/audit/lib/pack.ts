/**
 * pack.ts — theme-blind Track packer and scheduler.
 *
 * Input: unshipped Tracks with `_touches:_` and `_blocked-by:`.
 * Output: layers × bins. A bin is a launch Group. Fill width is one number
 * (`fillCap` = min(parallelism_cap, hard max 8)). FFD and tail-absorb
 * both use it — a leftover over the cap stays a ready sibling, never a
 * bin of 7 when the ceiling is 6.
 *
 * Layers are serial (explicit blocked-by, plus collision spill). After
 * packing, layers are recomputed from the bin DAG so a displaced blocker
 * sits before its dependents. Bins are returned in topological order so
 * DEPENDS `Group <bin N>` is paste-ready.
 * Capacity overflow stays in the same layer (parallel ready).
 * File-collision spill is a later layer — never two ready bins on one path.
 *
 * Shared docs (fixed set plus `roadmap:shared_docs=` from CLAUDE.md) are
 * excluded from collision. A path ending in `/` is a directory prefix.
 * `path (new)` collides only with the same path or a folder entry also
 * marked `(new)` (see docs/collision-contract.md).
 *
 * Group-level `_Depends on:` is NOT packer input — only track `_blocked-by:`
 * and file collisions. Group deps are derived output.
 *
 * IDs and live document order are display labels. FFD's last tie-break is
 * packIdent (scheduling touches + normalized title) so write-then-renumber
 * is a fixpoint.
 */

import { normalizeTitle } from './renames-diff.ts';

export const PACK_TARGET = 6;
export const PACK_HARD_MAX = 8;
export const COLLISION_CONTRACT = 'collision-contract/v1';

export type CollisionRules = {
  sharedDocs?: readonly string[];
};

export type PackOpts = {
  target?: number;
  maxPerBin?: number;
} & CollisionRules;

/** Single fill width for FFD and tail-absorb. */
export function fillCap(target = PACK_TARGET, hardMax = PACK_HARD_MAX): number {
  const t = target > 0 ? target : PACK_TARGET;
  const h = hardMax > 0 ? hardMax : PACK_HARD_MAX;
  return Math.min(t, h);
}

export const SHARED_DOC_PATHS = new Set([
  'docs/ROADMAP.md',
  'docs/TODOS.md',
  'docs/PROGRESS.md',
  'docs/roadmap-shipped.md',
  'docs/roadmap-future.md',
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
  /** Card title. Feeds packIdent; not an ID. */
  title?: string;
  /** Document/parse index. Last-resort only (identical packIdent). */
  ord?: number;
};

export type PackedBin = {
  layer: number;
  trackIds: string[];
  /** Track IDs in earlier layers that block any member of this bin. */
  blockedByTracks: string[];
  /** Min packIdent of members — same-layer tie-break. */
  ident: string;
  /** Min parse index of members — last resort after ident. */
  ord: number;
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
  isNew: boolean;
};

const NEW_MARKER_RE = /[ \t\v\f\r]*\(new\)[ \t\v\f\r]*$/i;
const SHARED_DOCS_MARKER_RE = /<!--\s*roadmap:shared_docs=([^\s]*?)(?=\s|-->|$)/;
const PROTECTED_CLAUDE_DOCS = new Set(['CLAUDE.md', 'docs/CLAUDE.md']);
const sharedDocCache = new WeakMap<readonly string[], Set<string>>();

export function normalizeTouch(raw: string): TouchNorm {
  let s = raw.replace(/^[ \t\v\f\r]+|[ \t\v\f\r]+$/g, '');
  const isNew = NEW_MARKER_RE.test(s);
  if (isNew) s = s.replace(NEW_MARKER_RE, '');
  s = s.replace(/^[ \t\v\f\r]+|[ \t\v\f\r]+$/g, '');
  const dir = s.endsWith('/');
  if (dir) s = s.replace(/\/+$/, '') + '/';
  return { path: s, dir, isNew };
}

/**
 * Parse `<!-- roadmap:shared_docs=a.md,b.md -->` from CLAUDE.md content.
 * Only an HTML comment is a marker, so a prose or inline-code mention is not.
 * First marker wins; value runs to whitespace or `-->` and splits on `,`.
 */
export function sharedDocsMarker(instructions: string): string[] {
  if (!instructions) return [];
  const m = SHARED_DOCS_MARKER_RE.exec(instructions);
  if (!m || !m[1]) return [];
  const out: string[] = [];
  for (const part of m[1].split(',')) {
    const trimmed = part.replace(/^[ \t\v\f\r]+|[ \t\v\f\r]+$/g, '');
    if (trimmed !== '') out.push(trimmed);
  }
  return out;
}

function extraSharedDocSet(rules?: CollisionRules): Set<string> {
  const list = rules?.sharedDocs;
  if (!list || list.length === 0) return new Set();
  const cached = sharedDocCache.get(list);
  if (cached !== undefined) return cached;
  const set = new Set<string>();
  for (const raw of list) {
    const n = normalizeTouch(raw);
    if (n.path === '' || n.dir || PROTECTED_CLAUDE_DOCS.has(n.path)) continue;
    set.add(n.path);
  }
  sharedDocCache.set(list, set);
  return set;
}

export function isSharedDoc(path: string, rules: CollisionRules = {}): boolean {
  const stripped = path.replace(/\/+$/, '');
  if (SHARED_DOC_PATHS.has(path) || SHARED_DOC_PATHS.has(stripped)) return true;
  const n = normalizeTouch(path);
  if (SHARED_DOC_PATHS.has(n.path)) return true;
  if (n.dir || n.path === '') return false;
  return extraSharedDocSet(rules).has(n.path);
}

/** IDs are paint — strip Group/Track tokens so remapping a title does not change FFD. */
const PAINT_ID_RE = /(?:^|\s)[0-9]+(?:[a-z](?:\.[0-9]+)?)?(?=\s|$)/g;

function titleKey(title: string): string {
  return normalizeTitle(title)
    .replace(PAINT_ID_RE, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/^[ \t]+|[ \t]+$/g, '');
}

/** Rename- and regroup-stable FFD key. Touches + title; never ID or file position. */
export function packIdent(
  t: Pick<PackTrack, 'touches' | 'title'>,
  rules: CollisionRules = {},
): string {
  const paths = schedulingTouches(t.touches, rules)
    .map((n) => n.path)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `${paths.join('\n')}\0${titleKey(t.title ?? '')}`;
}

export function schedulingTouches(touches: string[], rules: CollisionRules = {}): TouchNorm[] {
  const extra = extraSharedDocSet(rules);
  const out: TouchNorm[] = [];
  for (const raw of touches) {
    const n = normalizeTouch(raw);
    if (n.path === '') continue;
    const stripped = n.path.replace(/\/+$/, '');
    if (SHARED_DOC_PATHS.has(n.path) || SHARED_DOC_PATHS.has(stripped)) continue;
    if (!n.dir && extra.has(n.path)) continue;
    out.push(n);
  }
  return out;
}

export type CollisionMatch = {
  kind: 'file' | 'folder';
  a: string;
  b: string;
  /** Folder entry when kind === 'folder'. */
  folder?: string;
  /** Covered path when kind === 'folder'. */
  path?: string;
};

function matchTouchPair(x: TouchNorm, y: TouchNorm): CollisionMatch | null {
  if (x.path === y.path) {
    if (!x.dir && !y.dir) {
      return { kind: 'file', a: x.path, b: y.path };
    }
    return { kind: 'folder', a: x.path, b: y.path, folder: x.path, path: y.path };
  }
  if (x.dir && y.path.startsWith(x.path)) {
    if (y.isNew && !x.isNew) return null;
    return { kind: 'folder', a: x.path, b: y.path, folder: x.path, path: y.path };
  }
  if (y.dir && x.path.startsWith(y.path)) {
    if (x.isNew && !y.isNew) return null;
    return { kind: 'folder', a: x.path, b: y.path, folder: y.path, path: x.path };
  }
  return null;
}

/** Scheduling touches with repeated entries dropped; `(new)` stays part of the identity. */
function distinctSchedulingTouches(touches: string[], rules: CollisionRules): TouchNorm[] {
  const seen = new Set<string>();
  const out: TouchNorm[] = [];
  for (const n of schedulingTouches(touches, rules)) {
    const key = `${n.isNew ? '+' : '-'}${n.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

export function collisionMatches(
  a: string[],
  b: string[],
  rules: CollisionRules = {},
): CollisionMatch[] {
  const na = distinctSchedulingTouches(a, rules);
  const nb = distinctSchedulingTouches(b, rules);
  const out: CollisionMatch[] = [];
  for (const x of na) {
    for (const y of nb) {
      const m = matchTouchPair(x, y);
      if (m !== null) out.push(m);
    }
  }
  return out;
}

export function collisionKind(
  a: string[],
  b: string[],
  rules: CollisionRules = {},
): 'none' | 'file' | 'folder-only' {
  const na = distinctSchedulingTouches(a, rules);
  const nb = distinctSchedulingTouches(b, rules);
  let folder = false;
  for (const x of na) {
    for (const y of nb) {
      const m = matchTouchPair(x, y);
      if (m === null) continue;
      if (m.kind === 'file') return 'file';
      folder = true;
    }
  }
  return folder ? 'folder-only' : 'none';
}

export function touchesIntersect(
  a: string[],
  b: string[],
  rules: CollisionRules = {},
): boolean {
  return collisionKind(a, b, rules) !== 'none';
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

function binCollides(bin: PackTrack[], candidate: PackTrack, rules: CollisionRules): boolean {
  for (const existing of bin) {
    if (touchesIntersect(existing.touches, candidate.touches, rules)) return true;
  }
  return false;
}

type LayerBin = {
  tracks: PackTrack[];
  layerOffset: number;
  collisionBlockedBy: string[];
};

function absorbTails(bins: LayerBin[], maxPerBin: number, rules: CollisionRules): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = bins.length - 1; i >= 1; i--) {
      const last = bins[i]!;
      const prev = bins[i - 1]!;
      if (last.layerOffset !== prev.layerOffset) continue;
      if (prev.tracks.some((x) => x.isHotfix) || last.tracks.some((x) => x.isHotfix)) continue;
      if (prev.tracks.length + last.tracks.length > maxPerBin) continue;
      if (last.tracks.some((t) => binCollides(prev.tracks, t, rules))) continue;
      prev.tracks.push(...last.tracks);
      bins.splice(i, 1);
      changed = true;
      break;
    }
  }
}

function collidingIds(bin: PackTrack[], candidate: PackTrack, rules: CollisionRules): string[] {
  const ids: string[] = [];
  for (const existing of bin) {
    if (touchesIntersect(existing.touches, candidate.touches, rules)) ids.push(existing.id);
  }
  return ids;
}

export function packTracks(
  tracks: PackTrack[],
  opts: PackOpts = {},
): PackResult {
  const target = opts.target ?? PACK_TARGET;
  const maxPerBin = opts.maxPerBin ?? PACK_HARD_MAX;
  const capacity = fillCap(target, maxPerBin);

  const live = tracks
    .filter((t) => t.id !== '')
    .map((t, i) => ({ ...t, ord: t.ord ?? i }));
  if (live.length === 0) return { bins: [], criticalPath: [], cycles: [] };

  const byId = new Map(live.map((t) => [t.id, t]));
  const identOf = (id: string): string => {
    const t = byId.get(id);
    return t === undefined ? id : packIdent(t, opts);
  };
  const ordOf = (id: string): number => byId.get(id)?.ord ?? 0;
  const cmpIdent = (a: string, b: string): number => {
    const ia = identOf(a);
    const ib = identOf(b);
    if (ia < ib) return -1;
    if (ia > ib) return 1;
    return ordOf(a) - ordOf(b);
  };

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
      const da = schedulingTouches(a.touches, opts).length;
      const db = schedulingTouches(b.touches, opts).length;
      if (db !== da) return db - da;
      return cmpIdent(a.id, b.id);
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
        if (binCollides(bin.tracks, t, opts)) continue;
        bin.tracks.push(t);
        placed = true;
        break;
      }
      if (!placed) {
        let collideOffset = -1;
        const collided: string[] = [];
        for (const bin of layerBins) {
          const hits = collidingIds(bin.tracks, t, opts);
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

    absorbTails(layerBins, capacity, opts);

    for (const bin of layerBins) {
      const blocked = new Set<string>();
      for (const t of bin.tracks) {
        for (const d of t.blockedBy) {
          if (live.some((x) => x.id === d)) blocked.add(d);
        }
      }
      for (const d of bin.collisionBlockedBy) blocked.add(d);
      const trackIds = bin.tracks.map((t) => t.id).sort(cmpIdent);
      const idents = bin.tracks.map((t) => packIdent(t, opts)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      bins.push({
        layer: L + bin.layerOffset,
        trackIds,
        blockedByTracks: [...blocked].sort(cmpIdent),
        ident: idents[0] ?? '',
        ord: Math.min(...bin.tracks.map((t) => t.ord ?? 0)),
      });
    }
  }

  const ordered = relayerAndSort(bins);
  return {
    bins: ordered,
    criticalPath: cycles.length > 0 ? [] : computeCriticalPath(ordered),
    cycles,
  };
}

/** Recompute layers from the bin DAG, then sort so bin index = paste order. */
export function relayerAndSort(bins: PackedBin[]): PackedBin[] {
  if (bins.length === 0) return bins;
  const idx = new Map<string, number>();
  for (let i = 0; i < bins.length; i++) {
    for (const id of bins[i]!.trackIds) idx.set(id, i);
  }
  const memo = new Map<number, number>();
  const walking = new Set<number>();
  function layerOf(i: number): number {
    const cached = memo.get(i);
    if (cached !== undefined) return cached;
    if (walking.has(i)) return 0;
    walking.add(i);
    let maxDep = -1;
    for (const b of bins[i]!.blockedByTracks) {
      const j = idx.get(b);
      if (j === undefined || j === i) continue;
      maxDep = Math.max(maxDep, layerOf(j));
    }
    walking.delete(i);
    const layer = maxDep + 1;
    memo.set(i, layer);
    return layer;
  }
  const relayered = bins.map((b, i) => ({ ...b, layer: layerOf(i) }));
  return relayered.sort((a, b) => {
    if (a.layer !== b.layer) return a.layer - b.layer;
    if (a.ident < b.ident) return -1;
    if (a.ident > b.ident) return 1;
    return a.ord - b.ord;
  });
}

/** Two live tracks with the same packIdent — last-resort FFD order is arbitrary. */
export function identCollisions(tracks: PackTrack[], rules: CollisionRules = {}): string[] {
  const byKey = new Map<string, string[]>();
  for (const t of tracks) {
    if (t.id === '') continue;
    const k = packIdent(t, rules);
    const arr = byKey.get(k) ?? [];
    arr.push(t.id);
    byKey.set(k, arr);
  }
  const out: string[] = [];
  for (const ids of byKey.values()) {
    if (ids.length < 2) continue;
    const listed = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    out.push(
      `identical pack identity ${listed.join(' ∥ ')} — same touches and title; FFD order is arbitrary`,
    );
  }
  return out;
}

/** Optional written Group DAG — STYLE_LINT closes this with the packer bin DAG. */
export type CollisionContext = {
  trackGroup?: Map<string, string>;
  groupDeps?: Map<string, readonly string[]>;
  /** Must match PACKING's fillCap. Default packTracks cap invents a different bin DAG. */
  packOpts?: PackOpts;
};

function closedReach(ids: Iterable<string>, preds: (id: string) => readonly string[]): Map<string, Set<string>> {
  const reach = new Map<string, Set<string>>();
  function of(from: string): Set<string> {
    const cached = reach.get(from);
    if (cached !== undefined) return cached;
    const seen = new Set<string>();
    const stack = [...preds(from)];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const d of preds(id)) stack.push(d);
    }
    reach.set(from, seen);
    return seen;
  }
  for (const id of ids) of(id);
  return reach;
}

function orderedBy(reach: Map<string, Set<string>>, a: string, b: string): boolean {
  return (reach.get(a)?.has(b) ?? false) || (reach.get(b)?.has(a) ?? false);
}

/**
 * Colliding tracks whose order is genuinely undetermined.
 * Suppress when a track `_blocked-by` path, the packer bin DAG, or the
 * written Group `_Depends on:` DAG already orders the pair.
 */
export function unorderedCollisions(tracks: PackTrack[], ctx: CollisionContext = {}): string[] {
  const live = tracks.filter((t) => t.id !== '');
  const byId = new Map(live.map((t) => [t.id, t]));
  const trackReach = closedReach(byId.keys(), (id) => byId.get(id)?.blockedBy ?? []);

  const packed = packTracks(live, ctx.packOpts);
  const trackBin = new Map<string, string>();
  const binPreds = new Map<string, string[]>();
  for (let i = 0; i < packed.bins.length; i++) {
    const key = String(i);
    const bin = packed.bins[i]!;
    for (const id of bin.trackIds) trackBin.set(id, key);
    binPreds.set(key, []);
  }
  for (let i = 0; i < packed.bins.length; i++) {
    const key = String(i);
    const preds: string[] = [];
    for (const tid of packed.bins[i]!.blockedByTracks) {
      const src = trackBin.get(tid);
      if (src !== undefined && src !== key && !preds.includes(src)) preds.push(src);
    }
    binPreds.set(key, preds);
  }
  const binReach = closedReach(binPreds.keys(), (id) => binPreds.get(id) ?? []);

  const groupDeps = ctx.groupDeps ?? new Map<string, readonly string[]>();
  const groupReach = closedReach(groupDeps.keys(), (id) => groupDeps.get(id) ?? []);
  const trackGroup = ctx.trackGroup;

  const findings: string[] = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]!;
      const b = live[j]!;
      if (!touchesIntersect(a.touches, b.touches, ctx.packOpts)) continue;
      if (orderedBy(trackReach, a.id, b.id)) continue;
      const ba = trackBin.get(a.id);
      const bb = trackBin.get(b.id);
      if (ba !== undefined && bb !== undefined && orderedBy(binReach, ba, bb)) continue;
      const ga = trackGroup?.get(a.id);
      const gb = trackGroup?.get(b.id);
      if (ga !== undefined && gb !== undefined) {
        if (ga === gb) continue;
        if (orderedBy(groupReach, ga, gb)) continue;
      }
      const ao = a.ord ?? i;
      const bo = b.ord ?? j;
      const [x, y] = ao <= bo ? [a.id, b.id] : [b.id, a.id];
      findings.push(
        `unordered collision ${x} ∥ ${y} — declare _blocked-by or accept arbitrary order`,
      );
    }
  }
  return findings;
}

/** Compare a written Group partition against the packer. Empty = match. */
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

/**
 * Pairs of live tracks that collide only through a folder entry, including
 * pairs already ordered by `_blocked-by`. Sorted by packIdent (ties by ord).
 */
export function folderOnlyCollisions(
  tracks: PackTrack[],
  rules: CollisionRules = {},
): string[] {
  const live = tracks
    .filter((t) => t.id !== '')
    .map((t, i) => ({
      track: t,
      ident: packIdent(t, rules),
      ord: t.ord ?? i,
    }))
    .sort((a, b) => {
      if (a.ident < b.ident) return -1;
      if (a.ident > b.ident) return 1;
      return a.ord - b.ord;
    });

  const out: string[] = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]!.track;
      const b = live[j]!.track;
      const matches = collisionMatches(a.touches, b.touches, rules);
      if (matches.length === 0 || matches.some((m) => m.kind === 'file')) continue;
      const pairs = [...new Set(matches.map((m) => `${m.folder} ⊇ ${m.path}`))].sort((x, y) =>
        x < y ? -1 : x > y ? 1 : 0,
      );
      out.push(`- ${a.id} ∥ ${b.id}: ${pairs.join(', ')}`);
    }
  }
  return out;
}

export function formatPackOutput(
  packed: PackResult,
  opts: { emptyHint?: string; folderOnly?: string[] } = {},
): string {
  if (packed.cycles.length > 0) {
    return `BINS: CYCLE\n${packed.cycles.map((c) => `- ${c}`).join('\n')}\n`;
  }
  if (packed.bins.length === 0) {
    return `BINS: EMPTY (${opts.emptyHint ?? 'no unshipped Tracks'})\n`;
  }
  const lines: string[] = ['BINS:'];
  const ordered = relayerAndSort(packed.bins);
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
  if (opts.folderOnly !== undefined) {
    lines.push(
      'FOLDER_ONLY (collide only through a folder entry; name files where the code shows them, then re-pack):',
    );
    if (opts.folderOnly.length === 0) {
      lines.push('- (none)');
    } else {
      lines.push(...opts.folderOnly);
    }
  }
  return lines.join('\n') + '\n';
}
