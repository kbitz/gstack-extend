/**
 * work-item-id.ts — pure, locale-safe, subprocess-free work-item ID library.
 *
 * Contract: `work-item-id/v1` (documented in `docs/source-tag-contract.md` and
 * `docs/compatibility.md`).
 *
 * Every TODOS entry, Future bullet, active ROADMAP Track card, and shipped
 * Track record carries an immutable `wi-<4..8 lowercase hex>` work-item ID
 * assigned at creation and never reused after kill, ship, or merge.
 */

import { createHash, randomBytes } from 'node:crypto';
import { FUTURE_HEADING_RE, planningLines } from './state.ts';

// ─── Contract constants ───────────────────────────────────────────────

export const WORK_ITEM_ID_CONTRACT = 'work-item-id/v1';
export const WORK_ITEM_ID_PREFIX = 'wi-';
export const WORK_ITEM_ID_RE = /^wi-[0-9a-f]{4,8}$/;
export const WORK_ITEM_ID_DEFAULT_HEX = 6;
export const WORK_ITEM_ID_MAX_HEX = 8;

// Markdown's closing underscore is a delimiter even though it is a regex word character.
const SCAN_WORK_ITEM_ID_RE = /\bwi-[0-9a-f]{4,8}(?![0-9A-Za-z])/g;
const TODO_ID_BULLET_RE = /^- \*\*ID:\*\*[ \t]*(.*)$/;
const TRACK_ID_LINE_RE = /^_id:[ \t\v\f\r]*(.*)$/i;
const INLINE_ID_RE = /^\*\*ID:\*\*[ \t]*([^\s—–]*)[ \t]*/;
const TRAILING_INLINE_ID_RE = /[ \t]+[—–-]+[ \t]+\*\*ID:\*\*[ \t]*([^\s—–]*)[ \t]*(?:[—–-]+[ \t]*)?$/;
// Extra closing stars can end nested emphasis before the outer bold title.
const BOLD_BULLET_RE = /^(- \*\*((?:(?!\*\*(?!\*)).)+)\*\*[ \t]*[—–-]+[ \t]*)(.*)$/;
const PLAIN_BULLET_RE = /^((?:- )?(.*?)\s+[—–-]+\s+)(.*)$/;
const REVISIT_MARKER = '**Revisit when:**';
const TRACK_HEADING_RE = /^#{3,5} Track ([0-9]+[A-Z](?:\.[0-9]+)?):(.*)$/;
const GROUP_HEADING_RE = /^#{2,4} Group ([0-9]+):/;
const SHIPPED_SUFFIX_RE = /[ \t]+✓[ \t]+(?:Complete|Shipped)(?:[ \t]+\(v[^)]+\))?[ \t]*$/;
const LEGACY_SHIPPED_TRACK_BULLET_RE = /^(- Track ([0-9]+[A-Z](?:\.[0-9]+)?)[ \t]*[—–-]+[ \t]*)(.*)$/;

function lineEnding(rawLine: string): string {
  return rawLine.endsWith('\r') ? '\r' : '';
}

function byteCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function normalizeTitle(title: string): string {
  return title.trim().replace(/[ \t\v\f\r\n]+/g, ' ').toLowerCase();
}

// ─── Validation and parsing ───────────────────────────────────────────

export function isValidWorkItemId(raw: string): boolean {
  return WORK_ITEM_ID_RE.test(raw);
}

export type ParsedIdField = {
  raw: string;
  id: string | null;
  duplicate?: true;
};

/**
 * Parse a TODOS attribute bullet `- **ID:** <val>`.
 * Returns null if the line is not an ID bullet.
 * Returns `{ raw, id }` where `id` is null if `<val>` is malformed.
 */
export function parseTodoIdBullet(line: string): ParsedIdField | null {
  const m = TODO_ID_BULLET_RE.exec(line.replace(/\r$/, ''));
  if (m === null) return null;
  const raw = m[1]!.trim();
  return { raw, id: isValidWorkItemId(raw) ? raw : null };
}

/** Identify entry bullets while keeping checklist and link bullets with their heading. */
export function legacyTodoBulletKind(line: string, withinHeading = true): 'compactBullet' | 'legacyBullet' | null {
  const opener = /^- (\*\*)?\[/.exec(line);
  if (opener === null) return null;
  const label = line.slice(opener[0].length - 1);
  if (withinHeading && /^\[[ xX]\](?:[ \t]|$)|^\[[^\]]+\](?:\(|\[)/.test(label)) return null;
  return opener[1] === undefined ? 'legacyBullet' : 'compactBullet';
}

/**
 * Parse a ROADMAP Track line `_id: <val>_`.
 * Returns null if the line is not an `_id:` line.
 * Returns `{ raw, id }` where `id` is null if `<val>` is malformed.
 */
export function parseTrackIdLine(line: string): ParsedIdField | null {
  const m = TRACK_ID_LINE_RE.exec(line.replace(/\r$/, ''));
  if (m === null) return null;
  const value = m[1]!.trim();
  const closed = value.endsWith('_');
  const raw = closed ? value.slice(0, -1).trim() : value;
  return { raw, id: closed && isValidWorkItemId(raw) ? raw : null };
}

/** Mask closed inline code spans while retaining the original offsets. */
function maskInlineCode(line: string): string {
  const runs = [...line.matchAll(/`+/g)];
  if (runs.length < 2) return line;
  const nextOfLength = new Map<number, number>();
  const closers: Array<number | undefined> = [];
  for (let i = runs.length - 1; i >= 0; i--) {
    const width = runs[i]![0].length;
    closers[i] = nextOfLength.get(width);
    nextOfLength.set(width, i);
  }

  const pieces: string[] = [];
  let offset = 0;
  for (let i = 0; i < runs.length; i++) {
    const closing = closers[i];
    if (closing === undefined) continue;
    const start = runs[i]!.index;
    let escape = start;
    while (escape > 0 && line[escape - 1] === '\\') escape--;
    if ((start - escape) % 2 !== 0) continue;
    const end = runs[closing]!.index + runs[closing]![0].length;
    pieces.push(line.slice(offset, start), 'x'.repeat(end - start));
    offset = end;
    i = closing;
  }
  return pieces.join('') + line.slice(offset);
}

function splitInlineBullet(bullet: string) {
  const line = bullet.replace(/\r$/, '').trimStart();
  const visible = maskInlineCode(line);
  const marker = visible.lastIndexOf(REVISIT_MARKER);
  if (marker === -1) return { head: line, visible, trigger: null };
  return {
    head: line.slice(0, marker),
    visible: visible.slice(0, marker),
    trigger: line.slice(marker + REVISIT_MARKER.length),
  };
}

function locateInlineId(head: string, visible: string) {
  const explicitPrefix = BOLD_BULLET_RE.exec(visible)?.[1] ?? LEGACY_SHIPPED_TRACK_BULLET_RE.exec(visible)?.[1];
  const prefix = explicitPrefix ?? PLAIN_BULLET_RE.exec(visible)?.[1];
  const body = prefix === undefined ? undefined : head.slice(prefix.length);
  let leading = body !== undefined && visible.startsWith('**ID:**', prefix!.length)
    ? INLINE_ID_RE.exec(body) : null;
  let remainder = leading ? body!.slice(leading[0].length) : '';
  const separator = /^[—–-]+[ \t]*/.exec(remainder);
  // A plain title can also have a leading field with a clearly delimited body.
  if (explicitPrefix === undefined && remainder !== '' && separator === null) {
    leading = null;
    remainder = '';
  }
  const trailing = trailingInlineId(head, visible);
  const raw = leading?.[1] ?? trailing?.[1];
  if (raw === undefined) return null;
  const field: ParsedIdField = { raw, id: isValidWorkItemId(raw) ? raw : null };
  const secondLeadingField = /^(?:[—–-]+[ \t]*)?\*\*ID:\*\*/.test(remainder);
  const secondTrailingField = trailing !== null && (
    trailingInlineId(head.slice(0, trailing.index), visible.slice(0, trailing.index)) !== null ||
    (leading !== null && trailing.index >= head.length - remainder.length)
  );
  if (secondLeadingField || secondTrailingField) field.duplicate = true;
  if (leading && remainder !== '' && separator === null) field.id = null;
  return leading === null
    ? { field, start: trailing!.index, end: head.length }
    : { field, start: prefix!.length, end: head.length - remainder.length + (separator?.[0].length ?? 0) };
}

function trailingInlineId(head: string, visible: string): RegExpExecArray | null {
  const match = TRAILING_INLINE_ID_RE.exec(head);
  if (match === null) return null;
  const marker = match.index + match[0].indexOf('**ID:**');
  return visible.startsWith('**ID:**', marker) ? match : null;
}

/**
 * Extract an inline `**ID:** <val>` token from a `## Future` bullet or legacy
 * shipped `- Track <label> —` bullet, ignoring anything inside `**Revisit when:**`.
 * Recognizes the field after the title dash, or at the end of a legacy
 * bullet's prose. An ID mentioned elsewhere in prose is not a field.
 */
export function extractInlineBulletId(bullet: string): ParsedIdField | null {
  const { head, visible } = splitInlineBullet(bullet);
  return locateInlineId(head, visible)?.field ?? null;
}

/** Read display text and fields using the same boundaries as migration. */
export function futureBulletParts(bullet: string) {
  const { head, visible, trigger } = splitInlineBullet(bullet);
  const location = locateInlineId(head, visible);
  const prose = location === null ? head : head.slice(0, location.start) + head.slice(location.end);
  const layout = location === null ? visible : visible.slice(0, location.start) + visible.slice(location.end);
  const id = location?.field.id ?? null;
  const bold = BOLD_BULLET_RE.exec(layout);
  if (bold !== null) {
    return { id, title: prose.slice(4, 4 + bold[2]!.length), body: prose.slice(bold[1]!.length), trigger };
  }
  const separator = PLAIN_BULLET_RE.exec(layout);
  if (separator !== null) {
    const start = prose.startsWith('- ') ? 2 : 0;
    return {
      id, title: prose.slice(start, start + separator[2]!.length).replace(/^\*\*|\*\*$/g, ''),
      body: prose.slice(separator[1]!.length), trigger,
    };
  }
  const line = prose.replace(/^- /, '');
  return { id, title: line.trim().replace(/^\*\*|\*\*$/g, ''), body: '', trigger };
}

/**
 * Scan raw text for all valid `wi-[0-9a-f]{4,8}` work-item IDs.
 * Returns a deduplicated bytewise-sorted list.
 */
export function scanAllWorkItemIds(text: string): string[] {
  if (text === '') return [];
  const found = new Set<string>();
  const re = new RegExp(SCAN_WORK_ITEM_ID_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    found.add(m[0]!);
  }
  return [...found].sort(byteCompare);
}

// ─── Generation ───────────────────────────────────────────────────────

function pickFreePrefix(hex: string, taken: ReadonlySet<string>): string | null {
  const lower = hex.toLowerCase();
  for (let len = WORK_ITEM_ID_DEFAULT_HEX; len <= WORK_ITEM_ID_MAX_HEX; len++) {
    if (lower.length < len) break;
    const candidate = `${WORK_ITEM_ID_PREFIX}${lower.slice(0, len)}`;
    if (!taken.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Deterministically derive a work-item ID from `seed` via SHA-256, trying
 * 6, 7, and 8 hex characters before re-hashing `${seed}\0${attempt}`.
 */
export function deriveDeterministicId(seed: string, taken: ReadonlySet<string>): string {
  for (let attempt = 0; ; attempt++) {
    const input = attempt === 0 ? seed : `${seed}\0${attempt}`;
    const digest = createHash('sha256').update(Buffer.from(input, 'utf8')).digest('hex');
    const candidate = pickFreePrefix(digest, taken);
    if (candidate !== null) return candidate;
  }
}

/**
 * Mint a random work-item ID using CSPRNG entropy (or `entropyHex` on the
 * first attempt for deterministic unit tests), trying 6, 7, and 8 hex
 * characters before drawing fresh entropy.
 */
export function mintRandomId(taken: ReadonlySet<string>, entropyHex?: string): string {
  if (entropyHex !== undefined) {
    const first = pickFreePrefix(entropyHex, taken);
    if (first !== null) return first;
  }
  for (;;) {
    const hex = randomBytes(8).toString('hex');
    const candidate = pickFreePrefix(hex, taken);
    if (candidate !== null) return candidate;
  }
}

// ─── Idempotent migrators ─────────────────────────────────────────────

export type MigrateResult = {
  text: string;
  added: number;
  ids: string[];
};

/**
 * Assign deterministic work-item IDs to `### ` entries under `## Unprocessed`
 * and `## Completed` in `TODOS.md` that lack a `- **ID:**` bullet.
 */
export function migrateTodosText(content: string, taken: Set<string>): MigrateResult {
  if (content === '') return { text: '', added: 0, ids: [] };

  const lines = content.split('\n');
  // First pass: identify headings in ## Unprocessed and ## Completed and their body ranges.
  type EntrySpan = {
    headingIdx: number;
    endIdx: number; // exclusive
    section: 'unprocessed' | 'completed';
    title: string;
  };
  const spans: EntrySpan[] = [];
  let section: 'unprocessed' | 'completed' | null = null;
  let current: EntrySpan | null = null;

  for (const [i, line] of planningLines(lines)) {
    if (/^## Unprocessed\b/.test(line)) {
      if (current !== null) {
        current.endIdx = i;
        spans.push(current);
        current = null;
      }
      section = 'unprocessed';
      continue;
    }
    if (/^## Completed\b/.test(line)) {
      if (current !== null) {
        current.endIdx = i;
        spans.push(current);
        current = null;
      }
      section = 'completed';
      continue;
    }
    if (/^## /.test(line)) {
      if (current !== null) {
        current.endIdx = i;
        spans.push(current);
        current = null;
      }
      section = null;
      continue;
    }
    if (current !== null && legacyTodoBulletKind(line) !== null) {
      current.endIdx = i;
      spans.push(current);
      current = null;
    }
    if (section !== null && /^### /.test(line)) {
      if (current !== null) {
        current.endIdx = i;
        spans.push(current);
      }
      const rawTitle = line.replace(/^### /, '').replace(/^\[[^\]]+\][ \t]*/, '').trim();
      current = { headingIdx: i, endIdx: lines.length, section, title: rawTitle };
    }
  }
  if (current !== null) {
    current.endIdx = lines.length;
    spans.push(current);
  }

  // Track occurrence per (section, normalized title) for deterministic seeding.
  const occ = new Map<string, number>();
  // Insertions: map line index -> line to insert BEFORE that index.
  const insertBefore = new Map<number, string>();
  const addedIds: string[] = [];

  for (const span of spans) {
    const normKey = `${span.section}\0${normalizeTitle(span.title)}`;
    const occurrence = occ.get(normKey) ?? 0;
    occ.set(normKey, occurrence + 1);

    let hasId = false;
    let firstAttrBulletIdx = -1;
    for (const [j, l] of planningLines(lines, span.headingIdx + 1, span.endIdx)) {
      if (parseTodoIdBullet(l) !== null) {
        hasId = true;
        break;
      }
      if (firstAttrBulletIdx === -1 && /^- \*\*[^*]+\*\*/.test(l)) {
        firstAttrBulletIdx = j;
      }
    }
    if (hasId) continue;

    const seed = `todo\0${span.section}\0${normalizeTitle(span.title)}\0${occurrence}`;
    const id = deriveDeterministicId(seed, taken);
    taken.add(id);
    addedIds.push(id);

    // Insert before the first `- **...**` bullet when a blank line separates
    // heading and bullets; otherwise directly below the heading.
    let targetIdx = span.headingIdx + 1;
    if (
      firstAttrBulletIdx > span.headingIdx + 1 &&
      lines[span.headingIdx + 1]!.trim() === ''
    ) {
      let onlyBlankBefore = true;
      for (let k = span.headingIdx + 1; k < firstAttrBulletIdx; k++) {
        if (lines[k]!.trim() !== '') {
          onlyBlankBefore = false;
          break;
        }
      }
      if (onlyBlankBefore) {
        targetIdx = firstAttrBulletIdx;
      }
    }
    insertBefore.set(targetIdx, `- **ID:** ${id}${lineEnding(lines[span.headingIdx]!)}`);
  }

  if (addedIds.length === 0) {
    return { text: content, added: 0, ids: [] };
  }

  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const ins = insertBefore.get(i);
    if (ins !== undefined) out.push(ins);
    out.push(lines[i]!);
  }
  const tailIns = insertBefore.get(lines.length);
  if (tailIns !== undefined) out.push(tailIns);

  return { text: out.join('\n'), added: addedIds.length, ids: addedIds };
}

/**
 * Assign deterministic work-item IDs to `## Future` `- ` bullets that lack
 * an inline `**ID:**` marker.
 */
export function migrateFutureText(content: string, taken: Set<string>): MigrateResult {
  if (content === '') return { text: '', added: 0, ids: [] };

  const lines = content.split('\n');
  let inFuture = false;
  const occ = new Map<string, number>();
  const addedIds: string[] = [];
  const out = [...lines];

  for (const [i, line] of planningLines(lines)) {
    if (FUTURE_HEADING_RE.test(line)) {
      inFuture = true;
      continue;
    }
    if (inFuture && /^## /.test(line)) {
      inFuture = false;
      continue;
    }
    if (!inFuture) continue;
    const bullet = line.trimStart();
    if (!/^- /.test(bullet)) continue;

    // Extract title for deterministic seeding regardless of whether ID exists.
    const indent = line.slice(0, line.length - bullet.length);
    const visibleLine = maskInlineCode(line);
    const revisitIdx = visibleLine.lastIndexOf(REVISIT_MARKER);
    const proseEnd = revisitIdx >= 0 ? revisitIdx : line.length;
    const prose = line.slice(indent.length, proseEnd);
    const rest = prose.slice(2);
    const boldDash = BOLD_BULLET_RE.exec(visibleLine.slice(indent.length, proseEnd));
    const title = boldDash !== null ? prose.slice(4, 4 + boldDash[2]!.length)
      : rest.split(/[—–-]/)[0]!.replace(/^\*\*|\*\*$/g, '').trim();
    const normTitle = normalizeTitle(title);
    const occurrence = occ.get(normTitle) ?? 0;
    occ.set(normTitle, occurrence + 1);

    if (extractInlineBulletId(line) !== null) continue;

    const seed = `future\0${normTitle}\0${occurrence}`;
    const id = deriveDeterministicId(seed, taken);
    taken.add(id);
    addedIds.push(id);

    const ending = lineEnding(lines[i]!);
    if (boldDash !== null) {
      // `- **<Title>** — <body>` → `- **<Title>** — **ID:** <id> — <body>`
      const prefix = prose.slice(0, boldDash[1]!.length);
      const gap = /[ \t]$/.test(prefix) ? '' : ' ';
      out[i] = `${indent}${prefix}${gap}**ID:** ${id} — ${line.slice(indent.length + prefix.length)}${ending}`;
    } else {
      if (revisitIdx >= 0) {
        const insertion = line.slice(0, revisitIdx).search(/[ \t]*$/);
        const gap = insertion === revisitIdx ? ' ' : '';
        out[i] = `${line.slice(0, insertion)} — **ID:** ${id}${gap}${line.slice(insertion)}${ending}`;
      } else {
        out[i] = `${line} — **ID:** ${id}${ending}`;
      }
    }
  }

  if (addedIds.length === 0) {
    return { text: content, added: 0, ids: [] };
  }
  return { text: out.join('\n'), added: addedIds.length, ids: addedIds };
}

export type MigrateRoadmapOpts = {
  rewriteBlockedBy?: boolean;
  labelToId?: ReadonlyMap<string, string | null>;
  workItemIdCounts?: ReadonlyMap<string, number>;
  fromShippedArchive?: boolean;
};

type MigrateRoadmapResult = MigrateResult & {
  labelToId: ReadonlyMap<string, string | null>;
  workItemIdCounts: ReadonlyMap<string, number>;
};

function recordLabel(labels: Map<string, string | null>, label: string, id: string | null): void {
  labels.set(label, labels.has(label) ? null : id);
}

function canonicalizeTrackLabel(raw: string): string {
  return raw.replace(/^([0-9]+)([A-Za-z])((?:\.[0-9]+)?)$/, (_m, n: string, letter: string, rest: string) => {
    return `${n}${letter.toUpperCase()}${rest}`;
  });
}

export function splitBlockerReferences(body: string): string[] {
  const refs: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '(') {
      depth++;
    } else if (body[i] === ')' && depth > 0) {
      depth--;
    } else if (body[i] === ',' && depth === 0) {
      refs.push(body.slice(start, i));
      start = i + 1;
    }
  }
  refs.push(body.slice(start));
  return refs;
}

function rewriteBlockedByLine(line: string, labelToId: ReadonlyMap<string, string | null>): string {
  const m = /^(_blocked-by:[ \t\v\f\r]*)(.*?)(_[ \t\v\f\r]*)$/i.exec(line);
  if (m === null) return line;
  const prefix = m[1]!;
  const body = m[2]!;
  const suffix = m[3]!;
  if (body.trim() === '') return line;

  let changed = false;
  const parts = splitBlockerReferences(body).map((rawPart) => {
    const trimmed = rawPart.trim();
    // Only whole labels can become canonical ID tokens without losing notes.
    const bare = trimmed.replace(/^Track[ \t]+/i, '');
    if (/^[0-9]+[A-Za-z](?:\.[0-9]+)?$/.test(bare)) {
      const canon = canonicalizeTrackLabel(bare);
      const mapped = labelToId.get(canon);
      if (typeof mapped === 'string') {
        changed = true;
        return rawPart.replace(trimmed, mapped);
      }
    }
    return rawPart;
  });

  if (!changed) return line;
  return `${prefix}${parts.join(',')}${suffix}`;
}

/**
 * Assign deterministic work-item IDs to `#{3,5} Track <label>: <title>` headings
 * and legacy shipped `- Track <label> — ` bullets under `#### Group N:` in
 * `ROADMAP.md` or `docs/roadmap-shipped.md`.
 *
 * When `opts?.rewriteBlockedBy === true`, rewrites resolvable Track label refs
 * on `_blocked-by:` lines using `opts.labelToId` (augmented with any IDs
 * present or assigned in this file).
 */
export function migrateRoadmapText(
  content: string,
  taken: Set<string>,
  opts: MigrateRoadmapOpts = {},
): MigrateRoadmapResult {
  const lines = content.split('\n');
  const addedIds: string[] = [];
  const shippedLabels = new Map(opts.labelToId);
  const liveLabels = new Map<string, string | null>();
  const workItemIdCounts = new Map(opts.workItemIdCounts);
  const countId = (id: string | null) => {
    if (id !== null) workItemIdCounts.set(id, (workItemIdCounts.get(id) ?? 0) + 1);
  };
  if (opts.workItemIdCounts === undefined) {
    for (const id of shippedLabels.values()) countId(id);
  }

  // Track spans for `#{3,5} Track <label>: <title>` headings.
  type TrackSpan = {
    headingIdx: number;
    endIdx: number;
    label: string;
    title: string;
    shipped: boolean;
  };
  const spans: TrackSpan[] = [];
  let inGroup = false;
  let inFuture = false;
  let inShipped = opts.fromShippedArchive === true;
  let groupShipped = false;
  let current: TrackSpan | null = null;
  const legacyBulletIndices: Array<{ idx: number; label: string; prefix: string; rest: string }> = [];

  for (const [i, line] of planningLines(lines)) {
    const topLevel = line.startsWith('## ');
    const groupHeading = GROUP_HEADING_RE.test(line) && (!inFuture || topLevel);
    if (topLevel || groupHeading) {
      if (current !== null) {
        current.endIdx = i;
        spans.push(current);
        current = null;
      }
      if (topLevel && !groupHeading) {
        inShipped = opts.fromShippedArchive === true || /^## Shipped\b/.test(line);
      }
      inFuture = FUTURE_HEADING_RE.test(line);
      inGroup = groupHeading;
      groupShipped = groupHeading && SHIPPED_SUFFIX_RE.test(line);
      continue;
    }
    if (inFuture) continue;

    const tm = TRACK_HEADING_RE.exec(line);
    if (tm !== null) {
      if (current !== null) {
        current.endIdx = i;
        spans.push(current);
      }
      const label = tm[1]!;
      const shipped = inShipped || groupShipped || SHIPPED_SUFFIX_RE.test(tm[2]!);
      const title = tm[2]!.replace(SHIPPED_SUFFIX_RE, '').trim();
      current = { headingIdx: i, endIdx: lines.length, label, title, shipped };
      continue;
    }

    // Legacy shipped `- Track <label> — ...` bullets under `#### Group N:` (not inside a Track heading body).
    if (inGroup && (inShipped || groupShipped) && current === null) {
      const lm = LEGACY_SHIPPED_TRACK_BULLET_RE.exec(line);
      if (lm !== null) {
        legacyBulletIndices.push({
          idx: i,
          label: lm[2]!,
          prefix: lm[1]!,
          rest: lm[3]!,
        });
      }
    }
  }
  if (current !== null) {
    current.endIdx = lines.length;
    spans.push(current);
  }

  const outLines = [...lines];
  const occ = new Map<string, number>();

  // Handle legacy shipped bullets first.
  for (const b of legacyBulletIndices) {
    const key = `legacy\0${b.label}`;
    const occurrence = occ.get(key) ?? 0;
    occ.set(key, occurrence + 1);

    const existing = extractInlineBulletId(outLines[b.idx]!);
    if (existing !== null) {
      countId(existing.id);
      recordLabel(shippedLabels, b.label, existing.duplicate ? null : existing.id);
      continue;
    }
    const seed = `roadmap-legacy\0${b.label}\0${occurrence}`;
    const id = deriveDeterministicId(seed, taken);
    taken.add(id);
    addedIds.push(id);
    countId(id);
    recordLabel(shippedLabels, b.label, id);
    outLines[b.idx] = `${b.prefix}**ID:** ${id} — ${b.rest}${lineEnding(lines[b.idx]!)}`;
  }

  // Handle `#{3,5} Track` headings.
  const insertAfter = new Map<number, string>();
  for (const span of spans) {
    const normKey = `track\0${span.label}\0${normalizeTitle(span.title)}`;
    const occurrence = occ.get(normKey) ?? 0;
    occ.set(normKey, occurrence + 1);

    let existingId: string | null = null;
    let hasIdLine = false;
    let metaLineIdx = -1;
    let firstBodyLine = true;
    for (const [j, l] of planningLines(lines, span.headingIdx + 1, span.endIdx)) {
      const parsedId = parseTrackIdLine(l);
      if (parsedId !== null) {
        countId(parsedId.id);
        existingId = hasIdLine ? null : parsedId.id;
        hasIdLine = true;
        firstBodyLine = false;
        continue;
      }
      const body = l.trim();
      if (!opts.fromShippedArchive && firstBodyLine && /^_.*_$/.test(body) &&
          (/risk|low|medium|high/i.test(body) || (!span.shipped && /^_\d+[ \t]+tasks?\b/i.test(body)))) {
        metaLineIdx = j;
      }
      if (body !== '') firstBodyLine = false;
    }

    const labels = span.shipped ? shippedLabels : liveLabels;
    if (hasIdLine) {
      recordLabel(labels, span.label, existingId);
      continue;
    }

    const seed = `track\0${span.label}\0${normalizeTitle(span.title)}\0${occurrence}`;
    const id = deriveDeterministicId(seed, taken);
    taken.add(id);
    addedIds.push(id);
    countId(id);
    recordLabel(labels, span.label, id);

    // Archived receipts place the field under the heading. Active cards
    // with recognized metadata place it directly below that metadata.
    const anchor = metaLineIdx >= 0 ? metaLineIdx : span.headingIdx;
    insertAfter.set(anchor, `_id: ${id}_${lineEnding(lines[anchor]!)}`);
  }

  // A live record takes precedence over shipped history. An ambiguous or
  // malformed live record still prevents accidentally targeting history.
  const labelMap = new Map(shippedLabels);
  for (const [label, id] of liveLabels) labelMap.set(label, id);
  for (const [label, id] of labelMap) {
    if (id !== null && workItemIdCounts.get(id) !== 1) labelMap.set(label, null);
  }

  // Optionally rewrite `_blocked-by:` lines inside Track bodies.
  let blockedByChanged = false;
  if (opts.rewriteBlockedBy === true) {
    for (const span of spans) {
      if (span.shipped) continue;
      for (const [j, l] of planningLines(lines, span.headingIdx + 1, span.endIdx)) {
        if (/^_blocked-by:/i.test(l)) {
          const rewritten = rewriteBlockedByLine(l, labelMap);
          if (rewritten !== l) {
            outLines[j] = rewritten + lineEnding(lines[j]!);
            blockedByChanged = true;
          }
        }
      }
    }
  }

  if (addedIds.length === 0 && !blockedByChanged) {
    return { text: content, added: 0, ids: [], labelToId: labelMap, workItemIdCounts };
  }

  const finalLines: string[] = [];
  for (let i = 0; i < outLines.length; i++) {
    finalLines.push(outLines[i]!);
    const ins = insertAfter.get(i);
    if (ins !== undefined) finalLines.push(ins);
  }

  return { text: finalLines.join('\n'), added: addedIds.length, ids: addedIds, labelToId: labelMap, workItemIdCounts };
}
