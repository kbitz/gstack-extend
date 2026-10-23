/**
 * Section outlines of installed upstream skill files, so the parent loads a
 * phase skill's methodology by line range when a step needs it instead of
 * reading the whole file.
 *
 * Every unfenced H1–H3 heading starts a row whose span runs to the next such
 * heading. Body text before the first heading (after any YAML frontmatter) is
 * a row of its own, so a file with no headings still has a readable range. A
 * row is:
 *   - `skip`        when it is an H2 or H3 whose own heading is on upstream
 *                   autoplan's Phase 0 Step 3 **Section skip list** (read
 *                   from the base file); H1 rows are never skipped;
 *   - `skip-parent` when it is an H3 under a skipped H2 and its own heading is
 *                   not listed. Upstream sometimes nests unrelated methodology
 *                   under a skipped heading, so the parent decides from the
 *                   heading whether it belongs to the skipped topic;
 *   - `shared`      when its span is identical, ignoring whitespace, to a span
 *                   in the base file (the generic gstack preamble every skill
 *                   repeats);
 *   - `read`        otherwise.
 * Spans do not overlap and end at the file's last line, so their byte totals
 * add up to the file minus its frontmatter and leading blank lines.
 */
import { scanLines } from './plan.ts';

export type OutlineStatus = 'read' | 'shared' | 'skip' | 'skip-parent';
export type OutlineRow = { start: number; end: number; bytes: number; level: number; heading: string; status: OutlineStatus };

type Span = { start: number; end: number; level: number; heading: string; text: string; bytes: number };

const HEADING = /^(#{1,3})\s+\S/;
export const PREAMBLE_HEADING = '(before first heading)';

/** Index just past a leading YAML frontmatter block, or 0 when there is none. */
function bodyStart(raw: string[]): number {
  if (raw[0]?.trim() !== '---') return 0;
  const close = raw.findIndex((l, i) => i > 0 && l.trim() === '---');
  return close < 0 ? 0 : close + 1;
}

function spans(text: string): Span[] {
  const lines = scanLines(text);
  const raw = text.split('\n');
  // A final newline leaves an empty element that is not a line of the file.
  const count = text.endsWith('\n') ? raw.length - 1 : raw.length;
  const span = (start: number, endExclusive: number, level: number, heading: string): Span => {
    const body = raw.slice(start, endExclusive).join('\n');
    const newline = endExclusive < count || text.endsWith('\n') ? 1 : 0;
    return { start: start + 1, end: endExclusive, level, heading, text: body, bytes: Buffer.byteLength(body) + newline };
  };
  const starts = lines.flatMap((l, i) => (i < count && !l.fenced && HEADING.test(l.text) ? [i] : []));
  const out: Span[] = [];
  let first = bodyStart(raw);
  while (first < (starts[0] ?? count) && !raw[first]!.trim()) first++;
  if (first < (starts[0] ?? count)) out.push(span(first, starts[0] ?? count, 0, PREAMBLE_HEADING));
  starts.forEach((start, k) => out.push(span(start, starts[k + 1] ?? count, HEADING.exec(raw[start]!)![1]!.length, raw[start]!.trim())));
  return out;
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
/** Heading or skip-list name without markup, parentheticals or the `#` prefix. */
const normName = (text: string) =>
  text.replace(/^#+\s*/, '').replace(/\([^)]*\)/g, '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Names on upstream autoplan's Section skip list: the bullets after its bold label. */
export function skipList(baseText: string): string[] {
  const lines = scanLines(baseText);
  const at = lines.findIndex((l) => !l.fenced && /^\*\*Section skip list\b/i.test(l.text));
  if (at < 0) return [];
  const names: string[] = [];
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i]!;
    const bullet = /^\s*[-*+]\s+(\S.*)$/.exec(line.text);
    if (!line.fenced && bullet) { names.push(normName(bullet[1]!)); continue; }
    if (names.length || (line.text.trim() && !/\*\*\s*$/.test(line.text))) break;
  }
  return names.filter(Boolean);
}

export function outline(text: string, baseText?: string): { rows: OutlineRow[]; skip: string[] } {
  const skip = baseText === undefined ? [] : skipList(baseText);
  const shared = new Set((baseText === undefined ? [] : spans(baseText)).map((s) => squash(s.text)));
  const onSkipList = (heading: string) => skip.some((name) => normName(heading).startsWith(name));
  let parentSkipped = false;
  const rows = spans(text).map((s): OutlineRow => {
    let status: OutlineStatus;
    if (s.level === 1 || s.level === 2) parentSkipped = s.level === 2 && onSkipList(s.heading);
    if (s.level >= 2 && onSkipList(s.heading)) status = 'skip';
    else if (s.level === 3 && parentSkipped) status = 'skip-parent';
    else if (shared.has(squash(s.text))) status = 'shared';
    else status = 'read';
    return { start: s.start, end: s.end, bytes: s.bytes, level: s.level, heading: s.heading, status };
  });
  return { rows, skip };
}
