/**
 * renames-diff.ts — detect Group/Track ID renames between two ROADMAP.md
 * snapshots.
 *
 * Used by /roadmap at apply time so the regenerated plan can include an
 * "ID renames" mapping in the apply summary + commit message. The
 * "renumber freely" stance is correct philosophically, but humans still
 * anchor on IDs in conversation/PRs — surfacing the mapping at the regen
 * boundary closes the gap cheaply.
 *
 * Strategy: extract (id, kind, normalizedTitle) tuples from both sides,
 * match by exact normalized title. When old and new disagree on the ID
 * for the same title, emit a Rename. New entries with no old match and
 * old entries with no new match are dropped (they're additions/deletions,
 * not renames).
 *
 * Title normalization:
 * - Strip leading "Hotfix:" prefix
 * - Strip trailing "✓ Shipped (vX.Y.Z.W)" / "✓ Complete (vX.Y.Z.W)" suffix
 * - Collapse whitespace, lowercase
 *
 * Heading depths recognized:
 * - Group: H2..H4 (## | ### | ####) "Group N: Title"
 * - Track: H3..H5 (### | #### | #####) "Track NX: Title"
 */

export type EntityKind = 'group' | 'track';

export type Entity = {
  id: string;
  kind: EntityKind;
  title: string; // normalized
};

export type Rename = {
  kind: EntityKind;
  oldId: string;
  newId: string;
  title: string; // normalized title used for matching
};

const GROUP_HEADING_RE = /^#{2,4} Group ([0-9]+):[ \t]*(.+?)[ \t]*$/;
const TRACK_HEADING_RE = /^#{3,5} Track ([0-9]+[A-Z](?:\.[0-9]+)?):[ \t]*(.+?)[ \t]*$/;
const COMPLETE_SUFFIX_RE = /[ \t]+✓[ \t](Complete|Shipped)(?:[ \t]+\(v[^)]+\))?[ \t]*$/;
const HOTFIX_PREFIX_RE = /^Hotfix:[ \t]*/i;

export function normalizeTitle(raw: string): string {
  let t = raw;
  t = t.replace(COMPLETE_SUFFIX_RE, '');
  t = t.replace(HOTFIX_PREFIX_RE, '');
  t = t.replace(/[ \t\v\f\r\n]+/g, ' ');
  t = t.replace(/^[ \t]+|[ \t]+$/g, '');
  return t.toLowerCase();
}

export function parseEntities(roadmap: string): Entity[] {
  const out: Entity[] = [];
  for (const line of roadmap.split('\n')) {
    let m = GROUP_HEADING_RE.exec(line);
    if (m !== null) {
      out.push({ id: m[1]!, kind: 'group', title: normalizeTitle(m[2]!) });
      continue;
    }
    m = TRACK_HEADING_RE.exec(line);
    if (m !== null) {
      out.push({ id: m[1]!, kind: 'track', title: normalizeTitle(m[2]!) });
    }
  }
  return out;
}

export function computeRenames(oldRoadmap: string, newRoadmap: string): Rename[] {
  const oldEntities = parseEntities(oldRoadmap);
  const newEntities = parseEntities(newRoadmap);

  // title → id, scoped by kind. Last-write-wins on duplicate titles
  // (rare; a duplicate-title regression should be a separate concern).
  const newByTitle: Record<EntityKind, Map<string, string>> = {
    group: new Map(),
    track: new Map(),
  };
  for (const e of newEntities) {
    if (e.title === '') continue;
    newByTitle[e.kind].set(e.title, e.id);
  }

  const renames: Rename[] = [];
  const seenOldTitles: Record<EntityKind, Set<string>> = {
    group: new Set(),
    track: new Set(),
  };
  for (const e of oldEntities) {
    if (e.title === '') continue;
    if (seenOldTitles[e.kind].has(e.title)) continue; // first-occurrence wins
    seenOldTitles[e.kind].add(e.title);
    const newId = newByTitle[e.kind].get(e.title);
    if (newId === undefined) continue;
    if (newId === e.id) continue;
    renames.push({ kind: e.kind, oldId: e.id, newId, title: e.title });
  }
  return renames;
}

export function formatRenamesTable(renames: Rename[]): string {
  if (renames.length === 0) return '';
  const out: string[] = ['ID renames:'];
  for (const r of renames) {
    const kindLabel = r.kind === 'group' ? 'Group' : 'Track';
    out.push(`- ${kindLabel} ${r.oldId} → ${kindLabel} ${r.newId} (${r.title})`);
  }
  return out.join('\n');
}
