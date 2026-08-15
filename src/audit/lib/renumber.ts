/**
 * renumber.ts — atomic ID rewrite for /roadmap regeneration.
 *
 * Current-plan Group/Track numbers are ephemeral. A regen remaps them
 * in one pass so overlapping old/new sets (101A → 91A while 91A → 92A)
 * cannot collide. `\b` is wrong: markdown italics `_Group 147_` have
 * no word boundary before `_`. Use digit/letter lookarounds.
 *
 * Dated-historical mentions (absorption notes, "split from", "retired")
 * stay put so lineage does not point at a live ID.
 */

export type RenameMap = Map<string, string>;

const ID_RE = /^[0-9]+(?:[A-Z](?:\.[0-9]+)?)?$/;
const HIST_RE =
  /\d{4}-\d{2}-\d{2}|retired|split from|absorbed|formerly|tombstoned?|the retired/i;

export function parseMapArg(raw: string): RenameMap {
  const map: RenameMap = new Map();
  const parts = raw.split(',').map((s) => s.replace(/^[ \t]+|[ \t]+$/g, '')).filter((s) => s !== '');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq <= 0 || eq === part.length - 1) {
      throw new Error(`bad map entry: ${part} (want old=new)`);
    }
    const oldId = part.slice(0, eq);
    const newId = part.slice(eq + 1);
    if (!ID_RE.test(oldId) || !ID_RE.test(newId)) {
      throw new Error(`bad map ids: ${oldId}=${newId}`);
    }
    if (map.has(oldId)) throw new Error(`duplicate old id: ${oldId}`);
    map.set(oldId, newId);
  }
  if (map.size === 0) throw new Error('empty map');
  return map;
}

export function parseMapFile(text: string): RenameMap {
  const lines: string[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.replace(/^[ \t]+|[ \t]+$/g, '');
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    lines.push(trimmed);
  }
  return parseMapArg(lines.join(','));
}

export function isHistoricalContext(text: string, index: number, len: number): boolean {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  const nl = text.indexOf('\n', index);
  const lineEnd = nl < 0 ? text.length : nl;
  const line = text.slice(lineStart, lineEnd);
  const trimmed = line.replace(/^[ \t]+/, '');
  if (/^#{1,6}[ \t]/.test(trimmed)) return false;
  if (/^_tombstone:/i.test(trimmed)) return true;
  if (/^_(?:blocked-by|out|read-first|Depends on|touches):/i.test(trimmed)) return false;
  const before = text.slice(Math.max(lineStart, index - 60), index);
  if (HIST_RE.test(before)) return true;
  const after = text.slice(index + len, Math.min(lineEnd, index + len + 24));
  return /\([^)]*(?:retired|absorbed|formerly|tombstone)/i.test(after);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type ApplyResult = {
  text: string;
  replaced: number;
  skippedHistorical: { id: string; snippet: string }[];
};

export function applyRenames(text: string, map: RenameMap): ApplyResult {
  if (map.size === 0) return { text, replaced: 0, skippedHistorical: [] };
  const olds = [...map.keys()].sort((a, b) => b.length - a.length);
  // `.` is sentence punctuation (`Track 101A.`) unless a digit follows (`101A.1`).
  const re = new RegExp(
    `(?<![0-9A-Za-z])(${olds.map(escapeRe).join('|')})(?![0-9A-Za-z])(?!\\.[0-9])`,
    'g',
  );
  const skippedHistorical: { id: string; snippet: string }[] = [];
  let replaced = 0;
  const parts: string[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const match = m[0];
    const offset = m.index ?? 0;
    parts.push(text.slice(last, offset));
    if (isHistoricalContext(text, offset, match.length)) {
      const snippet = text
        .slice(Math.max(0, offset - 24), offset + match.length + 16)
        .replace(/\n/g, ' ');
      skippedHistorical.push({ id: match, snippet });
      parts.push(match);
    } else {
      const dest = map.get(match);
      if (dest === undefined) {
        parts.push(match);
      } else {
        replaced++;
        parts.push(dest);
      }
    }
    last = offset + match.length;
  }
  parts.push(text.slice(last));
  return { text: parts.join(''), replaced, skippedHistorical };
}

export function formatRenamesList(map: RenameMap): string {
  const lines = ['RENAMES:'];
  for (const [oldId, newId] of map) {
    const kind = /^[0-9]+$/.test(oldId) ? 'Group' : 'Track';
    lines.push(`- ${kind} ${oldId} → ${kind} ${newId}`);
  }
  return lines.join('\n');
}
