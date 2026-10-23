import { createHash } from 'node:crypto';

export const DISPOSITIONS = '.gstack/secret-dispositions.json';
export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
export type Entry = { path: string; rule: string; line_sha256: string; reason: string; approved_by: string; approved_at: string };
export type Part = { file: string; text: string };
export type Check = { id: string; status: string; code?: string; detail?: string; lines?: string[]; inputs?: Record<string, string> };
export type Finding = { path: string; rule: string; severity: string; category: string; added_line: number; line_sha256: string; text: string };

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

/** No writes or approval inference. Source texts include unchanged lines for stale detection. */
export function evaluate(check: Check, parts: Part[], entries: Entry[], sources: Map<string, string>) {
  const stale = entries.flatMap((e, index) => sources.get(e.path)?.split('\n').some(line => sha256(line) === e.line_sha256)
    ? [] : [{ entry: `${DISPOSITIONS}#/entries/${index}`, ...e }]);
  const matched: Array<{ entry: string; finding: Finding; approval: Entry }> = [];
  const unmatched: Finding[] = [];
  const errors: string[] = [];
  if (check.status === 'pass' || check.status === 'warn') return { satisfied: true, matched, unmatched, stale, errors };
  if (check.status !== 'fail' || check.code !== 'PREGATE_SECRETS') errors.push('secrets scan is not a completed credential-finding failure');
  if (check.inputs?.added_lines !== sha256(JSON.stringify(parts))) errors.push('added-line input hash differs from the raw pregate record');
  const count = /^(\d+) credential finding\(s\) in added lines \(([^)]*)\)$/.exec(check.detail ?? '');
  if (!count || Number(count[1]) < 1 || !Array.isArray(check.lines)) errors.push('unrecognized or incomplete upstream finding report');
  const blockers: Finding[] = [];
  for (const line of check.lines ?? []) {
    // This is upstream's rendered finding grammar. Unknown output fails closed.
    const m = /^(HIGH|MEDIUM) ([a-zA-Z0-9_.-]+) \[([^\]]+)\]: /.exec(line);
    const location = /, added line ([1-9][0-9]*)\)$/.exec(line);
    if (!m || !location) { errors.push('unrecognized upstream finding line'); continue; }
    const [, severity, rule, category] = m as [string, string, string, string];
    const number = location[1]!;
    // Descriptions and filenames may contain parentheses. Never guess a path
    // from a greedy regex: a suffix collision must not borrow another approval.
    const candidates = parts.filter(p => line.endsWith(` (${p.file}, added line ${number})`));
    if (candidates.length !== 1) { errors.push('finding path is missing or ambiguous'); continue; }
    const part = candidates[0]!, file = part.file;
    const text = part?.text.split('\n')[Number(number) - 1];
    if (!safePath(file) || text === undefined || !sources.get(file)?.split('\n').includes(text)) {
      errors.push('finding does not resolve to an exact current source line'); continue;
    }
    if (severity !== 'HIGH' && category !== 'secret') continue;
    blockers.push({ path: file, rule, severity, category, added_line: Number(number), line_sha256: sha256(text), text });
  }
  if (count && (Number(count[1]) !== blockers.length || count[2] !== blockers.map(f => f.rule).join(', '))) errors.push('blocking finding count or rules differ from upstream summary');
  for (const finding of blockers) {
    const index = entries.findIndex(e => e.path === finding.path && e.rule === finding.rule && e.line_sha256 === finding.line_sha256);
    if (finding.severity === 'HIGH' || index < 0) unmatched.push(finding);
    else matched.push({ entry: `${DISPOSITIONS}#/entries/${index}`, finding, approval: entries[index]! });
  }
  return { satisfied: errors.length === 0 && unmatched.length === 0 && blockers.length > 0, matched, unmatched, stale, errors };
}
