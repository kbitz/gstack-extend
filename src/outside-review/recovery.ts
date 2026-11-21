import { NOTHING_MISSING } from './prompt';

export interface Classification {
  execution: { state: string };
  findings: { highest: string | null };
  verdict: 'clean' | 'findings' | 'unverified' | 'unavailable';
  reason?: string;
  [key: string]: unknown;
}
export type Classifier = (input: { text: string; gate: 'review' | 'structured'; exit: number; stderr: string }) => Classification;
export type ExactForm = 'nothing-missing' | 'met' | null;

const BLANK_LINE = /^[ \t]*$/;
const CLOSING_LINE = /^(?:NO_FINDINGS: none[ \t]*|Recommendation:.*|VERDICT: (?:CLEAN|FINDINGS)[ \t]*)$/;
const CRITERION_LINE = /^[1-9]\d{0,2}\. MET[ \t]*$/;
const isToken = (line: string) => line.startsWith(NOTHING_MISSING) && BLANK_LINE.test(line.slice(NOTHING_MISSING.length));

/** Mark counted exact-form lines in linear time (one backward pass, one forward pass). */
export function exactForms(lines: readonly string[]): ExactForm[] {
  const n = lines.length;
  const laterAllBlankOrClosing = new Array<boolean>(n);
  const closingLater = new Array<boolean>(n);
  let allBlankOrClosing = true;
  let seenClosing = false;
  for (let i = n - 1; i >= 0; i--) {
    laterAllBlankOrClosing[i] = allBlankOrClosing;
    closingLater[i] = seenClosing;
    const line = lines[i]!;
    if (CLOSING_LINE.test(line)) seenClosing = true;
    else if (!BLANK_LINE.test(line)) allBlankOrClosing = false;
  }
  const marks = new Array<ExactForm>(n).fill(null);
  for (let i = 0; i < n; i++) {
    const aboveBlankOrStart = i === 0 || BLANK_LINE.test(lines[i - 1]!);
    if (isToken(lines[i]!)) {
      if (aboveBlankOrStart && laterAllBlankOrClosing[i] && closingLater[i]) marks[i] = 'nothing-missing';
      continue;
    }
    if (CRITERION_LINE.test(lines[i]!)) {
      let end = i;
      while (end + 1 < n && CRITERION_LINE.test(lines[end + 1]!)) end++;
      const belowBlankOrClosing = end + 1 < n && (BLANK_LINE.test(lines[end + 1]!) || CLOSING_LINE.test(lines[end + 1]!));
      if (aboveBlankOrStart && belowBlankOrClosing && closingLater[end]) {
        for (let k = i; k <= end; k++) marks[k] = 'met';
      }
      i = end;
    }
  }
  return marks;
}

// One severity plus a qualifier is formatting. Never quotes (`>`, code spans) or a second severity, token or word.
const QUALIFIED_LABEL = /^(\s*(?:#{1,6}\s+|[-+*]\s+|\(?\d{1,3}[.)]\s+)?(?:\*\*|__)?\[P[0-3])(?:\s*[,;:/—–-]\s*|\s+)([a-z][a-z -]*)\]/i;

/** Recover formatting only; recover() also blanks counted exact-form lines before classification, so a counted met-criterion line never reaches the installed untagged-item rule. The upstream validator still owns execution and severity. */
export function recover(text: string, gate: 'review' | 'structured', exit: number, stderr: string, classify: Classifier) {
  const normalizedLines = text.replace(/\r\n/g, '\n').split('\n');
  const marks = exactForms(normalizedLines);
  if (marks.some(Boolean) && normalizedLines.some((line, i) => !marks[i] && !BLANK_LINE.test(line))) {
    text = text.split('\n').map((line, i) => marks[i] ? (line.endsWith('\r') ? '\r' : '') : line).join('\n');
  }
  const original = classify({ text, gate, exit, stderr });
  const credited = (r: Classification) => r.verdict === 'clean' || r.verdict === 'findings';
  if (exit !== 0 || original.execution.state !== 'ran') return { classification: original, parse: 'not-applicable', credited: false, needs_context: false };
  let fence: string | undefined;
  let needsContext = false;
  const normalized = text.replace(/\r\n/g, '\n').split('\n').map(line => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = undefined;
      return line;
    }
    if (marker) { fence = marker; return line; }
    const plain = line.replace(/`([^`]*)`/g, (_span, inner: string) => /^NEEDS_CONTEXT:?$/i.test(inner.trim()) ? inner : '')
      .replace(/[*_]/g, '');
    const body = plain.replace(/^\s*(?:(?:[-+>]|\(?\d{1,3}[.)]|#{1,6}|\|)\s*)*/, '')
      .replace(/^(?:Recommendation|Verdict|Status)\s*(?::|[—–-]|\|)\s*/i, '');
    if (/^NEEDSCONTEXT(?:\s*(?::|[—–-]|\||$)|\s+because\b)/i.test(body)) needsContext = true;
    // Only label positions, never identifiers or quoted examples in finding prose.
    return line.replace(/^(\s*(?:>\s*)?(?:#{1,6}\s+|[-+*]\s+|\(?\d{1,3}[.)]\s+)?(?:\*\*|__|`)?\[?)p([0-3])\b/i, '$1P$2')
      .replace(QUALIFIED_LABEL, (label, prefix: string, qualifier: string) =>
        /(?<![a-z]-|[a-z])(?:critical|high|medium|low)(?![a-z]|-[a-z])/i.test(qualifier)
          ? label : `${prefix}] (${qualifier})`)
      .replace(/`[^`]*`|(\|\s*(?:\*\*|__|`)?\[?)p([0-3])(?=\]?(?:\*\*|__|`)?\s*\|)/gi,
        (span, before: string | undefined, priority: string) => before === undefined ? span : `${before}P${priority}`);
  }).join('\n').replace(/^(\s*(?:[-*] |#{1,6} )?)(?:\*\*|__)?(Recommendation|Verdict)(?:\*\*|__)?\s*:\s*\n\s*/gim, '$1$2: ');
  let checked = classify({ text: normalized, gate, exit, stderr });
  if (needsContext || fence) return { classification: { ...checked, verdict: 'unverified' as const }, parse: 'failed', credited: false, needs_context: needsContext };
  if (!credited(checked) && gate === 'review' && checked.reason === 'missing_markers') {
    // Completion recommendation is presentation, not a second review. Only recover
    // when the stricter structured gate already establishes findings/no-findings.
    const structured = classify({ text: normalized, gate: 'structured', exit, stderr });
    if (credited(structured)) checked = structured;
  }
  return { classification: credited(checked) ? checked : { ...checked, verdict: 'unverified' as const },
    parse: credited(checked) ? (normalized === text && credited(original) ? 'valid' : 'recovered') : 'failed', credited: credited(checked), needs_context: false };
}
