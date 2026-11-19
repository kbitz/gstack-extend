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
// Words in a nothing-missing line's remainder that name absent, requested or caveated context, including a negated or
// contracted "not shown/seen/have". Read with code-span text kept and typographic apostrophes normalized.
const CONTEXT_DENY = /\b(?:missing|need(?:s|ed|ing)?|requir[a-z]*|unavailable|truncat[a-z]*|absent|omit[a-z]*|unknown|cannot|can't|couldn't|could not|unable|lack[a-z]*|insufficient|incomplete|partial[a-z]*|without|except[a-z]*|but|however|although|though|unless|please|provide|supply|include|send|share|attach|paste|assum[a-z]*|guess[a-z]*|unclear|uncertain|unsure|hidden|elided|redacted|cut[ -]?off|would (?:help|like|need|want|be (?:useful|helpful|needed))|(?:not|never|[a-z]+n't) (?:be |been )?(?:supplied|provided|shown|included|visible|available|present|given|attached|sent|seen|see|have|had|get|got|find|found|access|read|know|verify|tell|determine|confirm))\b/;
const APOSTROPHES = /[‘’ʼ]/g;
const NONE_PHRASE = /^none(?: of the above depends? on missing context)?/;
// `none` (optionally the observed phrase), then the end, a sentence break or one parenthetical (one nested pair allowed)
// that itself ends the value or is followed by a sentence break.
const NONE_VALUE = /^none(?: of the above depends? on missing context)?(?:$|[.;](?:\s.*|$)| \((?:[^()]|\([^()]*\))+\)(?:$|[.;](?:\s.*|$)))/;
// After `Met.`, a sentence with a contrast, a failure or an obligation is a caveat, not a met criterion. Negation alone
// is not: a met line may add that the change does not touch something.
const MET_CAVEAT = /\b(?:however|but|except[a-z]*|although|though|yet|unless|whereas|caveat[a-z]*|fail[a-z]*|drop[a-z]*|lose|loses|losing|lost|loss|leak[a-z]*|crash[a-z]*|break[a-z]*|broke[a-z]*|bug[a-z]*|defect[a-z]*|error[a-z]*|wrong|incorrect[a-z]*|regress[a-z]*|must|should|todo|fixme|issue[a-z]*|problem[a-z]*|partial[a-z]*|unmet|missing)\b/i;
// A Met status read at a position (sticky): `Met`, `Met, by inspection.` or `Met.` and an optional sentence.
const MET_TAIL = /(?:(?:\*\*|__)?Met(?:\*\*|__)?(?:, by inspection\.?|\.(?:[\t ]+(\S.*))?)?|(?:\*\*|__)Met(?:, by inspection\.?|\.)(?:\*\*|__)(?:[\t ]+(\S.*))?)$/y;
// A delimiter, whitespace, then a Met status. Each start is tried in constant work plus its own whitespace run, so long
// whitespace runs in an untrusted reply stay linear.
const MET_SPLIT = /(?::|[—–]|[\t ]-)[\t ]+(?=(?:\*\*|__)?Met\b)/g;

export function contextLine(line: string): 'none' | 'missing' | null {
  const plain = line.replace(/`([^`]*)`/g, (_span, inner: string) => /^NEEDS_CONTEXT:?$/i.test(inner.trim()) ? inner : '')
    .replace(/[*_]/g, '');
  const body = plain.replace(/^\s*(?:(?:[-+>]|\(?\d{1,3}[.)]|#{1,6}|\|)\s*)*/, '')
    .replace(/^(?:Recommendation|Verdict|Status)\s*(?::|[—–-]|\|)\s*/i, '');
  if (!/^NEEDSCONTEXT(?:\s*(?::|[—–-]|\||$)|\s+because\b)/i.test(body)) return null;
  if (plain.includes('|')) return 'missing';
  if (!/^NEEDSCONTEXT\s*[:—–-]/i.test(body)) return 'missing';
  // The value is read with code-span text kept, so a code span cannot hide a deny word.
  const kept = /NEEDSCONTEXT\s*[:—–-]([\s\S]*)$/i.exec(line.replace(/[`*_]/g, ''))?.[1] ?? '';
  const value = kept.replace(APOSTROPHES, "'").toLowerCase().trim().replace(/\s+/g, ' ');
  if (!NONE_VALUE.test(value) || CONTEXT_DENY.test(value.replace(NONE_PHRASE, ''))) return 'missing';
  return 'none';
}

/** Whether `text` holds a Met status at `at`: undefined when it does not, false when its sentence is a caveat. */
function metTail(text: string, at: number): boolean | undefined {
  MET_TAIL.lastIndex = at;
  const tail = MET_TAIL.exec(text);
  if (!tail) return undefined;
  return !MET_CAVEAT.test((tail[1] ?? tail[2] ?? '').replace(/[*_`]/g, ''));
}

function rewriteMetCriterion(line: string): string {
  // Emphasis never hides a severity token or a negated status.
  const guard = line.replace(/[*_`]/g, '');
  if (/\b(?:P[0-3]|critical|high|medium|low)\b/i.test(guard) || /\b(?:not|partially)\s+met\b|\bunmet\b/i.test(guard)) return line;
  const match = /^(\*\*|__)?(?:\((\d{1,3})\)|(\d{1,3})[.)])[\t ]+(\S.*)$/.exec(line);
  if (!match) return line;
  const lead = match[1] ?? '';
  const num = (match[2] ?? match[3])!;
  const rest = match[4]!;
  const rewrite = (met: boolean) => met ? `${lead}Criterion ${num}: ${rest}` : line;
  if (lead) {
    const closeAt = rest.indexOf(lead);
    const gap = /[\t ]+/y;
    gap.lastIndex = closeAt + lead.length;
    if (closeAt > 0 && gap.test(rest)) {
      const met = metTail(rest, gap.lastIndex);
      if (met !== undefined) return rewrite(met);
    }
  } else {
    const wrapped = /^(\*\*|__)\S.*?\1[\t ]+(?=\S)/.exec(rest);
    if (wrapped) {
      const met = metTail(rest, wrapped[0].length);
      if (met !== undefined) return rewrite(met);
    }
  }
  // The first delimiter that is followed by a Met status, so a statement may hold its own `:` or dash.
  for (const split of rest.matchAll(MET_SPLIT)) {
    if (!split.index) continue;
    const met = metTail(rest, split.index + split[0].length);
    if (met !== undefined) return rewrite(met);
  }
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
