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
// `✓` anywhere, or an uppercase stamp as a whole token. Explicit lookarounds,
// not `\b`: identifier characters (ASCII letters, digits, `_`, backtick) never
// bound a token, so EXECUTABLE, RECOVERY_RETIRED_MANUAL and `SHIPPED` are not
// markers while (CUT), CUT: and — SHIPPED are. A hyphen is a boundary.
const DONE_TITLE_RE = /✓|(?<![A-Za-z0-9_\x60])(?:SHIPPED|RETIRED|CUT|DISCHARGED)(?![A-Za-z0-9_\x60])/;
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

/** First completion marker in a title (`✓` or an uppercase token), or null. */
function doneMarkerToken(title: string): string | null {
  const m = DONE_TITLE_RE.exec(title);
  return m === null ? null : m[0];
}

export function isDoneMarkerTitle(title: string): boolean {
  return doneMarkerToken(title) !== null;
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
  const token = doneMarkerToken(title);
  if (token !== null && (parsed.kind === 'ok' || parsed.kind === 'alias')) {
    // The parser skips marker titles before weighting, so a valid tag here is
    // silently ignored unless this note says so.
    const tag = parsed.kind === 'ok' ? parsed.effort : parsed.found;
    const remedy = token === '✓' ? 'remove ✓' : `remove or backtick ${token}`;
    return `${trackId}: task "${title}" has (${tag}) but marker ${token} marks it done — not weighted; if done, convert the line to prose; if not, ${remedy} and keep the tag`;
  }
  if (parsed.kind === 'alias') {
    return `${trackId}: found (${parsed.found}) — treated as ${parsed.effort}`;
  }
  if (token !== null && parsed.kind === 'missing') {
    return `${trackId}: task "${title}" looks done — convert to prose, not a weighted task`;
  }
  return null;
}
