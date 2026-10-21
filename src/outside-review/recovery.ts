export interface Classification {
  execution: { state: string };
  findings: { highest: string | null };
  verdict: 'clean' | 'findings' | 'unverified' | 'unavailable';
  reason?: string;
  [key: string]: unknown;
}
export type Classifier = (input: { text: string; gate: 'review' | 'structured'; exit: number; stderr: string }) => Classification;

/** Recover formatting only. The upstream validator still owns execution and severity. */
export function recover(text: string, gate: 'review' | 'structured', exit: number, stderr: string, classify: Classifier) {
  const original = classify({ text, gate, exit, stderr });
  const credited = (r: Classification) => r.verdict === 'clean' || r.verdict === 'findings';
  if (exit !== 0 || original.execution.state !== 'ran') return { classification: original, parse: 'not-applicable', credited: false };
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
      .replace(/`[^`]*`|(\|\s*(?:\*\*|__|`)?\[?)p([0-3])(?=\]?(?:\*\*|__|`)?\s*\|)/gi,
        (span, before: string | undefined, priority: string) => before === undefined ? span : `${before}P${priority}`);
  }).join('\n').replace(/^(\s*(?:[-*] |#{1,6} )?)(?:\*\*|__)?(Recommendation|Verdict)(?:\*\*|__)?\s*:\s*\n\s*/gim, '$1$2: ');
  let checked = classify({ text: normalized, gate, exit, stderr });
  if (needsContext || fence) return { classification: { ...checked, verdict: 'unverified' as const }, parse: 'failed', credited: false };
  if (!credited(checked) && gate === 'review' && checked.reason === 'missing_markers') {
    // Completion recommendation is presentation, not a second review. Only recover
    // when the stricter structured gate already establishes findings/no-findings.
    const structured = classify({ text: normalized, gate: 'structured', exit, stderr });
    if (credited(structured)) checked = structured;
  }
  return { classification: credited(checked) ? checked : { ...checked, verdict: 'unverified' as const },
    parse: credited(checked) ? (normalized === text && credited(original) ? 'valid' : 'recovered') : 'failed', credited: credited(checked) };
}
