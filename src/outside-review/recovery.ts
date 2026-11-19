export interface Classification {
  execution: { state: string };
  findings: { highest: string | null; unlabeled?: number };
  verdict: 'clean' | 'findings' | 'unverified' | 'unavailable';
  reason?: string;
  [key: string]: unknown;
}
export type Classifier = (input: { text: string; gate: 'review' | 'structured'; exit: number; stderr: string }) => Classification;

// One severity plus a qualifier is formatting. Never quotes (`>`, code spans) or a second severity, token or word.
const QUALIFIED_LABEL = /^(\s*(?:#{1,6}\s+|[-+*]\s+|\(?\d{1,3}[.)]\s+)?(?:\*\*|__)?\[P[0-3])(?:\s*[,;:/—–-]\s*|\s+)([a-z][a-z -]*)\]/i;
const CONTEXT_DENY = /\b(?:missing|need(?:s|ed)?|requir[a-z]*|unavailable|truncat[a-z]*|absent|omit[a-z]*|unknown|cannot|can't|couldn't|could not|not (?:supplied|provided|shown|included|visible|available|present))\b/;
const MET_TAIL = /^(?:(?:\*\*|__)?Met(?:\*\*|__)?(?:, by inspection\.?|\.(?:[\t ]+\S.*)?)?|(?:\*\*|__)Met(?:, by inspection\.?|\.)(?:\*\*|__)(?:[\t ]+\S.*)?)$/;

export function contextLine(line: string): 'none' | 'missing' | null {
  const plain = line.replace(/`([^`]*)`/g, (_span, inner: string) => /^NEEDS_CONTEXT:?$/i.test(inner.trim()) ? inner : '')
    .replace(/[*_]/g, '');
  const body = plain.replace(/^\s*(?:(?:[-+>]|\(?\d{1,3}[.)]|#{1,6}|\|)\s*)*/, '')
    .replace(/^(?:Recommendation|Verdict|Status)\s*(?::|[—–-]|\|)\s*/i, '');
  if (!/^NEEDSCONTEXT(?:\s*(?::|[—–-]|\||$)|\s+because\b)/i.test(body)) return null;
  if (plain.includes('|')) return 'missing';
  const after = /^NEEDSCONTEXT\s*[:—–-]([\s\S]*)$/i.exec(body)?.[1];
  if (after === undefined) return 'missing';
  const value = after.toLowerCase().trim().replace(/\s+/g, ' ');
  const match = /^none(?: of the above depends? on missing context)?($|[.;](?:\s.*|$)| \([^)]+\)(?:[.;]?(?:\s.*|$)))/.exec(value);
  if (!match || CONTEXT_DENY.test(match[1]!)) return 'missing';
  return 'none';
}

function rewriteMetCriterion(line: string): string {
  if (/\b(?:P[0-3]|critical|high|medium|low)\b/i.test(line) || /\b(?:not|partially)\s+met\b|\bunmet\b/i.test(line)) return line;
  const match = /^(\*\*|__)?(?:\((\d{1,3})\)|(\d{1,3})[.)])[\t ]+(\S.*)$/.exec(line);
  if (!match) return line;
  const lead = match[1] ?? '';
  const num = (match[2] ?? match[3])!;
  const rest = match[4]!;
  if (lead) {
    const closeAt = rest.indexOf(lead);
    if (closeAt > 0) {
      const afterClose = rest.slice(closeAt + lead.length);
      if (/^[\t ]+/.test(afterClose) && MET_TAIL.test(afterClose.trimStart())) return `${lead}Criterion ${num}: ${rest}`;
    }
  } else {
    const wrapped = /^(\*\*|__)\S.*?\1[\t ]+([\s\S]+)$/.exec(rest);
    if (wrapped && MET_TAIL.test(wrapped[2]!)) return `Criterion ${num}: ${rest}`;
  }
  const delimited = /^(\S.*?(?::|[\t ]*[—–]|[\t ]+-))[\t ]+([\s\S]+)$/.exec(rest);
  if (delimited && MET_TAIL.test(delimited[2]!)) return `${lead}Criterion ${num}: ${rest}`;
  return line;
}

/** Recover formatting only. The upstream validator still owns execution and severity. */
export function recover(text: string, gate: 'review' | 'structured', exit: number, stderr: string, classify: Classifier) {
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
    if (contextLine(line) === 'missing') needsContext = true;
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
  let metRecovered = false;
  if (!credited(checked) && typeof checked.findings.unlabeled === 'number' && checked.findings.unlabeled > 0) {
    let metFence: string | undefined;
    const rewritten = normalized.split('\n').map(line => {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
      if (metFence) {
        if (marker && marker[0] === metFence[0] && marker.length >= metFence.length && line.trim() === marker) metFence = undefined;
        return line;
      }
      if (marker) { metFence = marker; return line; }
      return rewriteMetCriterion(line);
    }).join('\n');
    if (rewritten !== normalized) {
      const metChecked = classify({ text: rewritten, gate, exit, stderr });
      if (credited(metChecked)) { checked = metChecked; metRecovered = true; }
    }
  }
  return { classification: credited(checked) ? checked : { ...checked, verdict: 'unverified' as const },
    parse: credited(checked) ? (!metRecovered && normalized === text && credited(original) ? 'valid' : 'recovered') : 'failed', credited: credited(checked), needs_context: false };
}
