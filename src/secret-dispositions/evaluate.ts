import { createHash } from 'node:crypto';

export const DISPOSITIONS = '.gstack/secret-dispositions.json';
export const PART_SHAPE_ERROR = 'unrecognized upstream added-line part shape';
export const BINARY_PART_ERROR = 'finding is in a binary part and cannot be dispositioned';
const PART_KEYS = new Set(['file', 'text', 'texts', 'keep', 'binary']);
export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
export type Entry = { path: string; rule: string; line_sha256: string; reason: string; approved_by: string; approved_at: string };
/**
 * `keep` is upstream's whole-file marker: the file's added line numbers. Without it, the reading holds only the added lines.
 * Upstream added `binary` at 76e2d3f9 (VERSION 1.98.0.0) on `{ file, text, keep?, binary? }` and replaced `text` with
 * `texts` at ccc3f0fc (VERSION 1.99.0.0; installed 1.99.3.0), where non-binary parts have one reading (`[text]`) and
 * binary parts carry `binary: true` with `scannableReadings(text)`.
 */
export type Part =
  | { file: string; text: string; keep?: number[]; binary?: true }
  | { file: string; texts: string[]; keep?: number[]; binary?: true };
export type Check = { id: string; status: string; code?: string; detail?: string; lines?: string[]; inputs?: Record<string, string> };
export type Finding = { path: string; rule: string; severity: string; category: string; added_line: number; line_sha256: string; text: string };

export function readPart(part: unknown): { file: string; text: string; keep?: number[]; binary: boolean } {
  if (!part || typeof part !== 'object' || Array.isArray(part)) throw new Error(PART_SHAPE_ERROR);
  const record = part as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!PART_KEYS.has(key)) throw new Error(PART_SHAPE_ERROR);
  }
  if (typeof record.file !== 'string') throw new Error(PART_SHAPE_ERROR);
  const hasText = Object.hasOwn(record, 'text');
  const hasTexts = Object.hasOwn(record, 'texts');
  if (hasText === hasTexts) throw new Error(PART_SHAPE_ERROR);
  if (Object.hasOwn(record, 'binary') && record.binary !== true) throw new Error(PART_SHAPE_ERROR);
  const binary = record.binary === true;
  let text: string;
  if (hasText) {
    if (typeof record.text !== 'string') throw new Error(PART_SHAPE_ERROR);
    text = record.text;
  } else {
    if (!Array.isArray(record.texts) || record.texts.length === 0 || !record.texts.every(t => typeof t === 'string')) {
      throw new Error(PART_SHAPE_ERROR);
    }
    if (!binary && record.texts.length !== 1) throw new Error(PART_SHAPE_ERROR);
    text = record.texts[0]!;
  }
  if (Object.hasOwn(record, 'keep')) {
    if (!Array.isArray(record.keep) || !record.keep.every(n => typeof n === 'number' && Number.isInteger(n) && n >= 1)) {
      throw new Error(PART_SHAPE_ERROR);
    }
    return { file: record.file, text, keep: record.keep as number[], binary };
  }
  return { file: record.file, text, binary };
}

export function safePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !/[\\\x00-\x1f\x7f]/.test(value)
    && !value.split('/').some(p => !p || p === '.' || p === '..' || p === '.git') && !/^[A-Za-z]:/.test(value);
}

export function parseEntries(value: unknown): Entry[] {
  const data = value as { version?: unknown; entries?: unknown };
  if (!data || data.version !== 1 || !Array.isArray(data.entries)) throw new Error('invalid disposition file: expected version 1 and entries array');
  const seen = new Set<string>();
  return data.entries.map((entry, i) => {
    const e = entry as Entry;
    const text = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && !/[\x00-\x1f\x7f]/.test(v);
    if (!e || !safePath(e.path) || !text(e.rule) || !/^[a-zA-Z0-9_.-]+$/.test(e.rule)
      || typeof e.line_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(e.line_sha256)
      || !text(e.reason) || !text(e.approved_by) || !text(e.approved_at)
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(e.approved_at)
      || !Number.isFinite(Date.parse(e.approved_at))
      || new Date(e.approved_at).toISOString() !== e.approved_at.replace('Z', '.000Z')) {
      throw new Error(`invalid disposition entry ${i}`);
    }
    const key = JSON.stringify([e.path, e.rule, e.line_sha256]);
    if (seen.has(key)) throw new Error(`duplicate disposition entry ${i}`);
    seen.add(key);
    return e;
  });
}

/**
 * The text in installed `lib/pregate/checks/secrets.ts` that produces the finding location this evaluator
 * reads: the render template (its `line N` and `added line N` forms) and the flag that picks between them.
 * `upstream-check` reports DRIFT when either changes; the evaluator fails closed on any line it cannot read.
 */
export const UPSTREAM_FINDING_ANCHORS: readonly string[] = [
  "`${f.severity} ${f.id} [${f.category}]: ${f.description ?? ''}${f.line ? ` (${f.file ? `${f.file}, ` : ''}${f.fileLine ? 'line' : 'added line'} ${f.line})` : ''}`",
  'fileLine: !!part.keep',
];

/** No writes or approval inference. Source texts include unchanged lines for stale detection. */
export function evaluate(check: Check, parts: Part[], entries: Entry[], sources: Map<string, string>) {
  const stale = entries.flatMap((e, index) => sources.get(e.path)?.split('\n').some(line => sha256(line) === e.line_sha256)
    ? [] : [{ entry: `${DISPOSITIONS}#/entries/${index}`, ...e }]);
  const matched: Array<{ entry: string; finding: Finding; approval: Entry }> = [];
  const unmatched: Finding[] = [];
  const errors: string[] = [];
  if (check.status === 'pass' || check.status === 'warn') return { satisfied: true, matched, unmatched, stale, errors };
  if (!Array.isArray(parts)) throw new Error(PART_SHAPE_ERROR);
  const readParts = parts.map(readPart);
  if (check.status !== 'fail' || check.code !== 'PREGATE_SECRETS') errors.push('secrets scan is not a completed credential-finding failure');
  if (check.inputs?.added_lines !== sha256(JSON.stringify(parts))) errors.push('added-line input hash differs from the raw pregate record');
  const count = /^(\d+) credential finding\(s\) in added lines \(([^)]*)\)$/.exec(check.detail ?? '');
  if (!count || Number(count[1]) < 1 || !Array.isArray(check.lines)) errors.push('unrecognized or incomplete upstream finding report');
  const blockers: Finding[] = [];
  for (const line of check.lines ?? []) {
    // This is upstream's rendered finding grammar. Unknown output fails closed.
    // `line N` is a source line of a whole-file part; `added line N` counts among a part's added lines.
    const m = /^(HIGH|MEDIUM) ([a-zA-Z0-9_.-]+) \[([^\]]+)\]: /.exec(line);
    const location = /, (added line|line) ([1-9][0-9]*)\)$/.exec(line);
    if (!m || !location) { errors.push('unrecognized upstream finding line'); continue; }
    const [, severity, rule, category] = m as [string, string, string, string];
    const kind = location[1]!, number = location[2]!, n = Number(number);
    // Descriptions and filenames may contain parentheses. Never guess a path
    // from a greedy regex: a suffix collision must not borrow another approval.
    // `keep` never breaks a tie: ambiguity is decided before the location form.
    const candidates = readParts.filter(p => line.endsWith(` (${p.file}, ${kind} ${number})`));
    if (candidates.length !== 1) { errors.push('finding path is missing or ambiguous'); continue; }
    const part = candidates[0]!, file = part.file;
    if (part.binary) { errors.push(BINARY_PART_ERROR); continue; }
    // Only an added line can be approved. Upstream's filter lets `engine.` findings through anywhere in the file.
    if (kind === 'line' ? !part.keep?.includes(n) : part.keep !== undefined) {
      errors.push('finding location does not match upstream added-line selection'); continue;
    }
    const text = part.text.split('\n')[n - 1], source = sources.get(file)?.split('\n');
    if (!safePath(file) || text === undefined || !(kind === 'line' ? source?.[n - 1] === text : source?.includes(text))) {
      errors.push('finding does not resolve to an exact current source line'); continue;
    }
    if (severity !== 'HIGH' && category !== 'secret') continue;
    blockers.push({ path: file, rule, severity, category, added_line: n, line_sha256: sha256(text), text });
  }
  if (count && (Number(count[1]) !== blockers.length || count[2] !== blockers.map(f => f.rule).join(', '))) errors.push('blocking finding count or rules differ from upstream summary');
  for (const finding of blockers) {
    const index = entries.findIndex(e => e.path === finding.path && e.rule === finding.rule && e.line_sha256 === finding.line_sha256);
    if (finding.severity === 'HIGH' || index < 0) unmatched.push(finding);
    else matched.push({ entry: `${DISPOSITIONS}#/entries/${index}`, finding, approval: entries[index]! });
  }
  return { satisfied: errors.length === 0 && unmatched.length === 0 && blockers.length > 0, matched, unmatched, stale, errors };
}
