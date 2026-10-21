/**
 * Plan-proper parsing for /autoplan-lean.
 *
 * A lean plan has two parts. The plan proper is everything before the first
 * unfenced `## Review record` heading: card text, acceptance criteria, the
 * `Tier:` and verify lines, `## Accepted decisions` and one consolidated
 * `## Implementation tasks` list. `## Review record` names the sidecar file
 * (path and SHA-256) that holds the full review record, and the file ends
 * with `## GSTACK REVIEW REPORT`.
 *
 * Fence handling matches common Markdown consumers: an opening fence of three
 * or more backticks or tildes may be indented; its closing fence uses the same
 * character, is at least as long and holds nothing else.
 */
import { createHash } from 'node:crypto';

export const PHASES = ['ceo', 'design', 'dx', 'eng'] as const;
export type Phase = (typeof PHASES)[number];
export const VOICES = ['native', 'outside'] as const;
export type Voice = (typeof VOICES)[number];

export const REVIEW_RECORD_HEADING = '## Review record';
export const REPORT_HEADING = '## GSTACK REVIEW REPORT';
export const DECISIONS_HEADING = '## Accepted decisions';
export const TASKS_HEADING = '## Implementation tasks';
/** Longest accepted settlement bullet, matching common transport decision limits. */
export const SETTLEMENT_CHARS = 500;

export type Line = { text: string; fenced: boolean };

const FENCE_OPEN = /^\s*(`{3,}|~{3,})/;

export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Split into lines, marking fence markers and fenced content as fenced. */
export function scanLines(text: string): Line[] {
  const out: Line[] = [];
  let fence: { char: string; length: number } | undefined;
  for (const text_ of text.split('\n')) {
    const line = text_.replace(/\r$/, '');
    if (fence) {
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1]![0] === fence.char && close[1]!.length >= fence.length) fence = undefined;
      out.push({ text: line, fenced: true });
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      fence = { char: open[1]![0]!, length: open[1]!.length };
      out.push({ text: line, fenced: true });
      continue;
    }
    out.push({ text: line, fenced: false });
  }
  return out;
}

const isH2 = (line: Line, heading: string) =>
  !line.fenced && new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i').test(line.text);
const anyH2 = (line: Line) => !line.fenced && /^##\s+\S/.test(line.text) && !/^###/.test(line.text);

export type PlanParts = {
  /** Text before the first unfenced `## Review record` (or report) heading. */
  proper: string;
  /** The `## Review record` section text, if present. */
  record?: string;
  /** Text from the last `## GSTACK REVIEW REPORT` heading to EOF, if present after the record. */
  report?: string;
};

export function splitPlan(text: string): PlanParts {
  const lines = scanLines(text);
  const raw = text.split('\n');
  const recordAt = lines.findIndex((l) => isH2(l, REVIEW_RECORD_HEADING));
  const reportAt = lines.findIndex((l) => isH2(l, REPORT_HEADING));
  const properEnd = [recordAt, reportAt].filter((i) => i >= 0).reduce((a, b) => Math.min(a, b), lines.length);
  const proper = raw.slice(0, properEnd).join('\n');
  let record: string | undefined;
  if (recordAt >= 0) {
    let end = lines.findIndex((l, i) => i > recordAt && anyH2(l));
    if (end < 0) end = lines.length;
    record = raw.slice(recordAt, end).join('\n');
  }
  const report = reportAt >= 0 ? raw.slice(reportAt).join('\n') : undefined;
  return { proper: proper.endsWith('\n') || !proper ? proper : `${proper}\n`, record, report };
}

/** Line range [start, end) of an H2 section within `text`, outside fences. */
function sectionRange(lines: Line[], heading: string): [number, number] | undefined {
  const start = lines.findIndex((l) => isH2(l, heading));
  if (start < 0) return undefined;
  let end = lines.findIndex((l, i) => i > start && anyH2(l));
  if (end < 0) end = lines.length;
  return [start, end];
}

export type Settlement = { phase: Phase; text: string };

export class PlanError extends Error {
  constructor(public code: string, message: string, public fix: string) {
    super(message);
  }
}

/**
 * Parse `## Accepted decisions`: a bullet list whose bullets start with a
 * `[ceo]`, `[design]`, `[dx]` or `[eng]` tag. Indented lines continue the
 * previous bullet. Anything else (tables, headings, fences, prose) is raw
 * review material and belongs in the sidecar.
 */
export function parseSettlements(proper: string): Settlement[] {
  const lines = scanLines(proper);
  const range = sectionRange(lines, DECISIONS_HEADING);
  if (!range) return [];
  const out: Settlement[] = [];
  for (let i = range[0] + 1; i < range[1]; i++) {
    const line = lines[i]!;
    if (line.fenced) throw new PlanError('SETTLEMENTS_INVALID', `fenced block in ${DECISIONS_HEADING}`, 'keep only short tagged bullets there; move reviewer material to the sidecar');
    if (!line.text.trim()) continue;
    const bullet = /^[-*+]\s+\[(ceo|design|dx|eng)\]\s+(\S.*)$/i.exec(line.text);
    if (bullet) {
      out.push({ phase: bullet[1]!.toLowerCase() as Phase, text: bullet[2]!.trim() });
      continue;
    }
    if (/^\s+\S/.test(line.text) && out.length && !/^\s*([-*+]|\d+[.)]|\|)\s/.test(line.text)) {
      out[out.length - 1]!.text += ` ${line.text.trim()}`;
      continue;
    }
    throw new PlanError('SETTLEMENTS_INVALID', `line ${i + 1} of the plan is not a tagged settlement bullet: ${JSON.stringify(line.text.slice(0, 80))}`,
      'write each settlement as "- [ceo|design|dx|eng] <decision>"; move reviewer material to the sidecar');
  }
  for (const s of out) {
    if (s.text.length > SETTLEMENT_CHARS) {
      throw new PlanError('SETTLEMENTS_INVALID', `a [${s.phase}] settlement is ${s.text.length} characters (limit ${SETTLEMENT_CHARS})`,
        'state the decision and its condition in one short sentence; keep its analysis in the sidecar');
    }
  }
  return out;
}

/** Plan proper without its `## Accepted decisions` section (settlements are passed separately). */
export function properWithoutSettlements(proper: string): string {
  const lines = scanLines(proper);
  const range = sectionRange(lines, DECISIONS_HEADING);
  if (!range) return proper;
  const raw = proper.split('\n');
  return [...raw.slice(0, range[0]), ...raw.slice(range[1])].join('\n');
}

/**
 * Markers of raw review output. None of them belongs in the plan proper; their
 * presence means voice output or decision tables leaked into the plan.
 */
export const RAW_OUTPUT_MARKERS: Array<{ name: string; re: RegExp }> = [
  { name: 'native voice INPUT line', re: /^INPUT: (?:ceo|design|dx|eng) [0-9a-f]{64}\b/m },
  { name: 'outside voice status line', re: /^OUTSIDE_STATUS:/m },
  { name: 'consensus table', re: /DUAL VOICES\s+—\s+CONSENSUS TABLE/i },
  { name: 'decision audit trail', re: /^#{1,6}\s+Decision Audit Trail\b/im },
  { name: 'sidecar raw-output marker', re: /^<!-- autoplan-lean:raw /m },
  { name: 'per-phase task list', re: /^#{1,6}\s+Implementation Tasks \(aggregated/im },
];

export function rawOutputMarkers(proper: string): string[] {
  const unfenced = scanLines(proper).filter((l) => !l.fenced).map((l) => l.text).join('\n');
  return RAW_OUTPUT_MARKERS.filter((m) => m.re.test(unfenced)).map((m) => m.name);
}

export function phaseIndex(phase: Phase): number {
  return PHASES.indexOf(phase);
}

/** Path and hash named by a `## Review record` section. */
export function readSeal(record: string | undefined): { path?: string; sha256?: string; bytes?: number } {
  if (!record) return {};
  const path = /^- Sidecar: `([^`]+)`\s*$/m.exec(record)?.[1];
  const hash = /^- SHA-256: `([0-9a-f]{64})`\s*$/m.exec(record)?.[1];
  const bytes = /^- Bytes: (\d+)\s*$/m.exec(record)?.[1];
  return { path, sha256: hash, bytes: bytes === undefined ? undefined : Number(bytes) };
}

export function recordSection(path: string, hash: string, bytes: number): string {
  return [
    REVIEW_RECORD_HEADING,
    '',
    'The full review record (reviewer outputs, consensus tables, decision audit trail and prompt sizes) is in the sidecar below. Implementation needs only this plan.',
    '',
    `- Sidecar: \`${path}\``,
    `- SHA-256: \`${hash}\``,
    `- Bytes: ${bytes}`,
    '',
  ].join('\n');
}

/** Replace (or insert, before the report) the plan's `## Review record` section. */
export function withRecord(plan: string, section: string): string {
  const lines = scanLines(plan);
  const raw = plan.split('\n');
  const range = sectionRange(lines, REVIEW_RECORD_HEADING);
  if (range) {
    const after = raw.slice(range[1]);
    return [...raw.slice(0, range[0]), ...section.replace(/\n$/, '').split('\n'), ...(after.length && after[0] !== '' ? [''] : []), ...after].join('\n');
  }
  const reportAt = lines.findIndex((l) => isH2(l, REPORT_HEADING));
  if (reportAt >= 0) {
    return [...raw.slice(0, reportAt), ...section.split('\n'), ...raw.slice(reportAt)].join('\n');
  }
  const base = plan.endsWith('\n') ? plan : `${plan}\n`;
  return `${base}${base.endsWith('\n\n') ? '' : '\n'}${section}`;
}
