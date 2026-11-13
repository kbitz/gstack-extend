export type ComponentContext = 'evidence-dir' | 'pr-comment';
export type Component = { start: number; end: number; context: ComponentContext };
export type ScanFinding = { id: string; severity: string; category: string; line: number; col: number; preview: string; [key: string]: unknown };
export type KnownSafeFinding = { id: string; line: number; col: number; context: ComponentContext };
export type DecisionStatus = 'none' | 'applied' | 'inconclusive';
export type Decision<F extends ScanFinding = ScanFinding> = { status: DecisionStatus; reason?: string; findings: F[]; known_safe: KnownSafeFinding[] };

const ELIGIBLE_IDS = new Set(['pii.cc', 'pii.phone.e164']);

function unstableBoundary(text: string, offset: number): boolean {
  const point = text.codePointAt(offset);
  if (point === undefined) return false;
  const char = String.fromCodePoint(point);
  return char.normalize('NFKC') !== char || /\p{Default_Ignorable_Code_Point}/u.test(char);
}

export function isDelimitedAfter(text: string, end: number): boolean {
  if (end >= text.length) return true;
  const next = text[end]!;
  if (/[A-Za-z0-9_]/.test(next)) return false;
  // Folding or deleting a boundary must not join outside digits to this run.
  if (unstableBoundary(text, end)) return false;
  const separator = next === ' ' || next === '.' || next === '-';
  if (separator && (/[0-9]/.test(text[end + 1] ?? '') || unstableBoundary(text, end + 1))) return false;
  // The phone rule also joins digit groups through parentheses.
  let afterParenthesis = -1;
  if (next === '(') afterParenthesis = end + 1;
  else if (separator && text[end + 1] === '(') afterParenthesis = end + 2;
  else if (next === ')') {
    afterParenthesis = end + 1;
    if ([' ', '.', '-'].includes(text[afterParenthesis] ?? '')) afterParenthesis++;
  }
  if (afterParenthesis !== -1 && (/[0-9]/.test(text[afterParenthesis] ?? '') || unstableBoundary(text, afterParenthesis))) return false;
  return true;
}

export function knownComponents(text: string, opts: { evidenceDirs?: readonly string[]; prUrl?: string } = {}): Component[] {
  const components: Component[] = [];
  for (const dir of new Set(opts.evidenceDirs ?? [])) {
    if (!dir) continue;
    for (let at = text.indexOf(dir); at !== -1; at = text.indexOf(dir, at + 1)) {
      if (!isDelimitedAfter(text, at + dir.length)) continue;
      for (const m of dir.matchAll(/[0-9]+/g)) {
        components.push({ start: at + m.index!, end: at + m.index! + m[0].length, context: 'evidence-dir' });
      }
    }
  }
  if (opts.prUrl) {
    const prefix = `${opts.prUrl}#issuecomment-`;
    for (let at = text.indexOf(prefix); at !== -1; at = text.indexOf(prefix, at + 1)) {
      const start = at + prefix.length;
      let end = start;
      while (end < text.length && text.charCodeAt(end) >= 48 && text.charCodeAt(end) <= 57) end++;
      if (end > start && isDelimitedAfter(text, end)) components.push({ start, end, context: 'pr-comment' });
    }
  }
  return components.sort((a, b) => a.start - b.start || a.end - b.end);
}

export function maskComponents(text: string, components: readonly Component[]): string {
  if (components.length === 0) return text;
  const chars = text.split('');
  for (const { start, end } of components) {
    for (let i = Math.max(0, start), to = Math.min(text.length, end); i < to; i++) {
      const code = text.charCodeAt(i);
      if (code >= 48 && code <= 57) chars[i] = 'x';
    }
  }
  return chars.join('');
}

export function offsetOf(text: string, line: number, col: number): number {
  if (!Number.isInteger(line) || !Number.isInteger(col) || line < 1 || col < 1) return -1;
  let lineStart = 0;
  for (let current = 1; current < line; current++) {
    const nl = text.indexOf('\n', lineStart);
    if (nl === -1) return -1;
    lineStart = nl + 1;
  }
  const nextNl = text.indexOf('\n', lineStart);
  const lineEnd = nextNl === -1 ? text.length : nextNl;
  const offset = lineStart + col - 1;
  return offset < lineStart || offset > lineEnd || offset >= text.length ? -1 : offset;
}

export function eligibleComponent(text: string, components: readonly Component[], finding: ScanFinding): Component | undefined {
  if (!ELIGIBLE_IDS.has(finding.id) || finding.severity !== 'MEDIUM' || finding.category !== 'pii') return undefined;
  const offset = offsetOf(text, finding.line, finding.col);
  if (offset < 0) return undefined;
  const comp = components.find(c => offset >= c.start && offset < c.end);
  if (!comp || typeof finding.preview !== 'string' || finding.preview.length < 4) return undefined;
  const slice = text.slice(offset, offset + 4);
  return slice.length === 4 && slice === finding.preview.slice(0, 4) ? comp : undefined;
}

const keyOf = (f: ScanFinding) => `${f.id}|${f.severity}|${f.category}|${f.line}|${f.col}`;

export function decide<F extends ScanFinding>(
  text: string,
  components: readonly Component[],
  first: { findings: F[]; oversize?: boolean },
  second?: { findings: F[]; oversize?: boolean } | null,
): Decision<F> {
  if (first.oversize) return { status: 'none', findings: first.findings, known_safe: [] };
  const matched = first.findings.map(f => ({ finding: f, key: keyOf(f), comp: eligibleComponent(text, components, f) }));
  if (!matched.some(m => m.comp !== undefined)) return { status: 'none', findings: first.findings, known_safe: [] };
  if (!second || second.oversize || !Array.isArray(second.findings)) {
    return { status: 'inconclusive', reason: 'second scan unavailable', findings: first.findings, known_safe: [] };
  }
  const firstTotal = new Map<string, number>(), firstIneligible = new Map<string, number>();
  for (const m of matched) {
    firstTotal.set(m.key, (firstTotal.get(m.key) ?? 0) + 1);
    if (!m.comp) firstIneligible.set(m.key, (firstIneligible.get(m.key) ?? 0) + 1);
  }
  const secondCounts = new Map<string, number>();
  for (const f of second.findings) secondCounts.set(keyOf(f), (secondCounts.get(keyOf(f)) ?? 0) + 1);
  for (const [key, count] of secondCounts) {
    if (count > (firstTotal.get(key) ?? 0)) return { status: 'inconclusive', reason: 'second scan added a finding', findings: first.findings, known_safe: [] };
  }
  for (const [key, needed] of firstIneligible) {
    if ((secondCounts.get(key) ?? 0) < needed) return { status: 'inconclusive', reason: 'non-eligible finding changed in second scan', findings: first.findings, known_safe: [] };
  }
  const remaining = new Map<string, number>();
  for (const [key, total] of firstTotal) {
    const inelig = firstIneligible.get(key) ?? 0, sec = secondCounts.get(key) ?? 0;
    remaining.set(key, Math.min(total - inelig, Math.max(0, sec - inelig)));
  }
  const findings: F[] = [], known_safe: KnownSafeFinding[] = [];
  for (const m of matched) {
    if (!m.comp) { findings.push(m.finding); continue; }
    const stay = remaining.get(m.key) ?? 0;
    if (stay > 0) { remaining.set(m.key, stay - 1); findings.push(m.finding); }
    else known_safe.push({ id: m.finding.id, line: m.finding.line, col: m.finding.col, context: m.comp.context });
  }
  return known_safe.length === 0 ? { status: 'none', findings: first.findings, known_safe: [] } : { status: 'applied', findings, known_safe };
}

export function exitFor(findings: readonly { severity: string }[]): 0 | 2 | 3 {
  if (findings.some(f => f.severity === 'HIGH')) return 3;
  if (findings.some(f => f.severity === 'MEDIUM')) return 2;
  return 0;
}

export function countsFor(findings: readonly { severity: string }[]): { HIGH: number; MEDIUM: number; LOW: number; WARN: number } {
  const counts = { HIGH: 0, MEDIUM: 0, LOW: 0, WARN: 0 };
  for (const f of findings) if (Object.hasOwn(counts, f.severity)) counts[f.severity as keyof typeof counts] += 1;
  return counts;
}
