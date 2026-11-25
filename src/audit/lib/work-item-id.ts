/**
 * work-item-id.ts — pure, locale-safe, subprocess-free work-item ID library.
 *
 * Contract: `work-item-id/v1` (documented in `docs/source-tag-contract.md` and
 * `docs/compatibility.md`).
 *
 * Producers assign immutable `wi-<4..8 lowercase hex>` IDs to new planning
 * records. Existing records can still lack an ID.
 */

import { randomBytes } from 'node:crypto';

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
// Field labels can occur inside a title. A third closing star can end italic emphasis.
const BOLD_BULLET_RE = /^(- \*\*((?:\*\*(?:ID:|Revisit when:)\*\*|(?!\*\*(?!\*)).)+)\*\*[ \t]*[—–-]+[ \t]*)(.*)$/;
const PLAIN_BULLET_RE = /^((?:- )?(.*?)\s+[—–-]+\s+)(.*)$/;
const REVISIT_MARKER = '**Revisit when:**';
const LEGACY_SHIPPED_TRACK_BULLET_RE = /^(- Track ([0-9]+[A-Z](?:\.[0-9]+)?)[ \t]*[—–-]+[ \t]*)(.*)$/;

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
  const titlePrefix = BOLD_BULLET_RE.exec(visible)?.[1]
    ?? LEGACY_SHIPPED_TRACK_BULLET_RE.exec(visible)?.[1]
    ?? PLAIN_BULLET_RE.exec(visible)?.[1];
  const marker = visible.lastIndexOf(REVISIT_MARKER);
  if (titlePrefix === undefined || marker < titlePrefix.length) {
    return { head: line, visible, trigger: null };
  }
  return {
    head: line.slice(0, marker),
    visible: visible.slice(0, marker),
    trigger: line.slice(marker + REVISIT_MARKER.length),
  };
}

function locateInlineId(head: string, visible: string) {
  const boldPrefix = BOLD_BULLET_RE.exec(visible)?.[1];
  const explicitPrefix = boldPrefix ?? LEGACY_SHIPPED_TRACK_BULLET_RE.exec(visible)?.[1];
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
  const trailing = boldPrefix === undefined ? trailingInlineId(head, visible) : null;
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

/** Read display text and fields using the same boundaries as the ID check. */
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
  return [...found].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
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
