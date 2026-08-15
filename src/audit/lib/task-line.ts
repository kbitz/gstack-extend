/**
 * task-line.ts — parse a ROADMAP task bullet (`- **Title** -- body`).
 *
 * Shared by the roadmap parser (SIZE / weight) and TASK_LIST so both
 * agree on title extraction and effort tags.
 */

export type EffortTier = 'S' | 'M' | 'L' | 'XL';

export type EffortParse =
  | { kind: 'ok'; effort: EffortTier }
  | { kind: 'alias'; effort: EffortTier; found: string }
  | { kind: 'bad'; found: string }
  | { kind: 'missing' };

const TASK_PREFIX = /^- \*\*/;
const DONE_TITLE_RE = /✓|SHIPPED|RETIRED|CUT|DISCHARGED/i;
const TIER_RE = /\((S|M|L|XL)\)(?![\w-])/;
const PAREN_TAG_RE = /\(([^)]+)\)/g;
const KNOWN_TIERS = new Set(['S', 'M', 'L', 'XL']);

/** Closing `**` that is not a single italic asterisk inside the title. */
export function parseTaskTitle(line: string): string | null {
  if (!TASK_PREFIX.test(line)) return null;
  const start = 4; // '- **'
  const close = line.indexOf('**', start);
  if (close < 0) return null;
  return line.slice(start, close);
}

export function isDoneMarkerTitle(title: string): boolean {
  return DONE_TITLE_RE.test(title);
}

export function parseEffortTag(line: string): EffortParse {
  const m = TIER_RE.exec(line);
  if (m !== null) return { kind: 'ok', effort: m[1] as EffortTier };

  PAREN_TAG_RE.lastIndex = 0;
  let found: string | null = null;
  let tag: RegExpExecArray | null;
  while ((tag = PAREN_TAG_RE.exec(line)) !== null) {
    const inner = tag[1]!.trim();
    if (inner === '') continue;
    const upper = inner.toUpperCase();
    if (upper === 'XS') return { kind: 'alias', effort: 'S', found: inner };
    if (KNOWN_TIERS.has(upper)) return { kind: 'ok', effort: upper as EffortTier };
    if (/^[SML](?:-[SML])+$/i.test(inner) || /^[SMLX]+(?:\s|$)/i.test(inner)) {
      found = inner;
    }
  }
  if (found !== null) return { kind: 'bad', found };
  return { kind: 'missing' };
}

export function effortFinding(trackId: string, title: string, parsed: EffortParse): string | null {
  if (parsed.kind === 'bad') {
    return `${trackId}: found (${parsed.found}) — not a tier; use S or M`;
  }
  if (parsed.kind === 'alias') {
    return `${trackId}: found (${parsed.found}) — treated as ${parsed.effort}`;
  }
  if (isDoneMarkerTitle(title) && parsed.kind === 'missing') {
    return `${trackId}: task "${title}" looks done — convert to prose, not a weighted task`;
  }
  return null;
}
