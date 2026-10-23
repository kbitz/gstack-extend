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
/**
 * Longest settlement decision text after its ID. A settlement states only the
 * decision (and its condition); rationale and evidence stay in the sidecar.
 */
const SETTLEMENT_CHARS = 200;
/**
 * Plan-proper budget: 1.5 × the source card's bytes plus 4 KiB for
 * settlements, tasks and Tier/verify lines. Reviewer prompts and the sealed
 * plan both stay inside it, so neither grows phase by phase.
 */
export const BUDGET_SOURCE_FACTOR = 1.5;
export const BUDGET_ALLOWANCE_BYTES = 4096;

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

export type Settlement = { phase: Phase; id: string; text: string };

export class PlanError extends Error {
  constructor(public code: string, message: string, public fix: string) {
    super(message);
  }
}

/**
 * Parse `## Accepted decisions`: a bullet list whose bullets start with a
 * `[ceo]`, `[design]`, `[dx]` or `[eng]` tag and a `d<N>:` ID, where N is the
 * decision's row in the run's decision audit trail. A decision split across
 * bullets repeats its ID. Indented lines continue the previous bullet.
 * Anything else (tables, headings, fences, prose) is raw review material and
 * belongs in the sidecar.
 */
export function parseSettlements(proper: string): Settlement[] {
  const lines = scanLines(proper);
  // check counts any heading naming implementation tasks; a variant heading
  // would hide its section from these exact-heading parsers.
  for (const [i, line] of lines.entries()) {
    if (line.fenced || !/^\s*#{1,6}\s+.*(accepted decisions|implementation tasks)/i.test(line.text)) continue;
    if (!isH2(line, DECISIONS_HEADING) && !isH2(line, TASKS_HEADING)) {
      throw new PlanError('SECTION_HEADING_INVALID', `line ${i + 1} of the plan is a variant section heading: ${JSON.stringify(line.text.slice(0, 80))}`,
        `use exactly "${DECISIONS_HEADING}" or "${TASKS_HEADING}"; do not add a second decisions or task section`);
    }
  }
  const range = sectionRange(lines, DECISIONS_HEADING);
  if (!range) return [];
  const out: Settlement[] = [];
  for (let i = range[0] + 1; i < range[1]; i++) {
    const line = lines[i]!;
    if (line.fenced) throw new PlanError('SETTLEMENTS_INVALID', `fenced block in ${DECISIONS_HEADING}`, 'keep only short tagged bullets there; move reviewer material to the sidecar');
    if (!line.text.trim()) continue;
    const bullet = /^[-*+]\s+\[(ceo|design|dx|eng)\]\s+(\S.*)$/i.exec(line.text);
    if (bullet) {
      const id = /^(d\d+):\s+(\S.*)$/.exec(bullet[2]!.trim());
      if (!id) {
        throw new PlanError('SETTLEMENTS_INVALID', `line ${i + 1} of the plan is a settlement without a d<N>: ID: ${JSON.stringify(line.text.slice(0, 80))}`,
          'write each settlement as "- [ceo|design|dx|eng] d<N>: <decision>", N being its row in <run>/decisions.md');
      }
      out.push({ phase: bullet[1]!.toLowerCase() as Phase, id: id[1]!, text: id[2]! });
      continue;
    }
    if (/^\s+\S/.test(line.text) && out.length && !/^\s*([-*+]|\d+[.)]|\|)\s/.test(line.text)) {
      out[out.length - 1]!.text += ` ${line.text.trim()}`;
      continue;
    }
    throw new PlanError('SETTLEMENTS_INVALID', `line ${i + 1} of the plan is not a tagged settlement bullet: ${JSON.stringify(line.text.slice(0, 80))}`,
      'write each settlement as "- [ceo|design|dx|eng] d<N>: <decision>"; move reviewer material to the sidecar');
  }
  const tags = new Map<string, Phase>();
  for (const s of out) {
    const tag = tags.get(s.id);
    if (tag !== undefined && tag !== s.phase) {
      throw new PlanError('SETTLEMENTS_INVALID', `${s.id} is tagged both [${tag}] and [${s.phase}]`,
        'give each decision its own d<N>; a split decision repeats its ID under the same phase tag');
    }
    tags.set(s.id, s.phase);
    if (s.text.length > SETTLEMENT_CHARS) {
      throw new PlanError('SETTLEMENTS_INVALID', `settlement [${s.phase}] ${s.id} is ${s.text.length} characters (limit ${SETTLEMENT_CHARS})`,
        'state only the decision and its condition; keep its rationale and evidence in the phase review');
    }
  }
  return out;
}

/**
 * `d<N>` IDs cited in `## Implementation tasks`, in order, outside fences and
 * inline code. A token that is part of a path or word (`src/d3.ts`, `odd3`) is
 * not an ID.
 */
export function taskRefs(proper: string): string[] {
  const lines = scanLines(proper);
  const range = sectionRange(lines, TASKS_HEADING);
  if (!range) return [];
  const out: string[] = [];
  for (let i = range[0] + 1; i < range[1]; i++) {
    const line = lines[i]!;
    if (line.fenced) continue;
    // Inline code names tools and packages (`d2`), not decisions.
    for (const m of line.text.replace(/`[^`]*`/g, ' ').matchAll(/(?<![\w./-])(d\d+)(?![\w/-]|\.\w)/g)) out.push(m[1]!);
  }
  return out;
}

/** The `## Accepted decisions` section text (heading included), or '' when absent. */
export function settlementsSection(proper: string): string {
  const range = sectionRange(scanLines(proper), DECISIONS_HEADING);
  return range ? proper.split('\n').slice(range[0], range[1]).join('\n') : '';
}

/** The plan proper exactly as a reviewer prompt carries it, and as budgets measure it. */
export function properForReview(proper: string): string {
  return proper.replace(/\n+$/, '\n');
}

export function planBudget(sourceBytes: number): number {
  return Math.floor(BUDGET_SOURCE_FACTOR * sourceBytes) + BUDGET_ALLOWANCE_BYTES;
}

/**
 * Lines added plus lines removed between two texts, compared as multisets:
 * zero means the same lines, whatever their order.
 */
export function changedLines(previous: string, next: string): number {
  const counts = new Map<string, number>();
  for (const line of previous.split('\n')) counts.set(line, (counts.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of next.split('\n')) {
    const n = counts.get(line) ?? 0;
    if (n > 0) counts.set(line, n - 1);
    else added++;
  }
  let removed = 0;
  for (const n of counts.values()) removed += n;
  return added + removed;
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
