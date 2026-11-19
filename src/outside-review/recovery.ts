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
// A nothing-missing explanation may only affirm supplied context: any negation, absence, inability, request or hedge
// names missing context, except a statement that the change does not touch, change, edit, modify, affect or depend on
// something. Read lowercased, with code-span text kept and typographic apostrophes normalized.
const CONTEXT_ALLOWED_NEGATION = /\b(?:does|do|did)(?: not|n't) (?:touch|change|edit|modify|affect|depend)\b/g;
const CONTEXT_DENY = /\b(?:no|not|nothing|none|never|nor|neither|[a-z]+n't|cannot|without|unable|lack[a-z]*|missing|need(?:s|ed|ing)?|requir[a-z]*|unavailable|truncat[a-z]*|absent|omit[a-z]*|unknown|insufficient|incomplete|partial[a-z]*|only|except[a-z]*|but|however|although|though|unless|please|provide|supply|include|send|share|attach|paste|assum[a-z]*|guess[a-z]*|unclear|uncertain|unsure|hidden|invisible|unseen|elided|redacted|beyond|outside|elsewhere|cut[ -]?off|would|could|should|might|may|maybe|perhaps|probably|likely|seem[a-z]*|appear[a-z]*)\b/;
// Another marker, a severity label, a review marker or a `path:line` glued onto the line is never an explanation.
// The `path:line` check reads back a bounded extension from each `:digit`, so a long dotted token stays linear.
const CONTEXT_GLUED = /needscontext|nofindings|\[p[0-3]\]|\brecommendation\b|\bverdict\b|(?<=\.[a-z0-9]{1,10}):\d/;
const APOSTROPHES = /[‘’ʼ]/g;
const NONE_PHRASE = /^none(?: of the above depends? on missing context)?/;
// `none` (optionally the observed phrase), then the end, a sentence break or one parenthetical (one nested pair allowed)
// that itself ends the value or is followed by a sentence break.
const NONE_VALUE = /^none(?: of the above depends? on missing context)?(?:$|[.;](?:\s.*|$)| \((?:[^()]|\([^()]*\))+\)(?:$|[.;](?:\s.*|$)))/;
// The one sentence a met line may add after `Met.`: that the change does not touch, change, edit, modify or affect
// something. Anything else leaves the line unrewritten. A dot inside a file name does not end the sentence.
const MET_NOTE = /^(?:the |this )?(?:diff|change|changes|branch|patch|commit|pr|pull request) (?:does|do|did)(?: not|n't) (?:touch|change|edit|modify|affect)\b(?:[^.;!?]|\.(?=\S))*\.?$/;
// An unwrapped criterion statement carrying a contrast, failure, obligation or negation is a caveat, not a criterion.
const STATEMENT_CAVEAT = /\b(?:however|but|except[a-z]*|although|though|yet|unless|whereas|fail[a-z]*|drop[a-z]*|lose|loses|losing|lost|loss|leak[a-z]*|crash[a-z]*|break[a-z]*|broke[a-z]*|bug[a-z]*|defect[a-z]*|error[a-z]*|wrong|incorrect[a-z]*|regress[a-z]*|must|should|todo|fixme|issue[a-z]*|problem[a-z]*|partial[a-z]*|unmet|missing|untested|unverified|not|no|never|[a-z]+n't|cannot|only)\b/;
// Between a bold criterion title and its status: whitespace and at most one delimiter.
const TITLE_GAP = /(?:[\t ]*(?::|[—–]|[\t ]-))?[\t ]+/y;
const flatten = (text: string) => text.replace(/[`*_]/g, '').replace(APOSTROPHES, "'").toLowerCase().replace(/\s+/g, ' ');
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
  // The whole line is read with code-span text kept, so a code span cannot hide a deny word before or after the marker.
  const kept = flatten(line);
  const marker = /needscontext\s*[:—–-]/.exec(kept);
  if (!marker) return 'missing';
  const value = kept.slice(marker.index + marker[0].length).trim();
  if (!NONE_VALUE.test(value)) return 'missing';
  const explanation = value.replace(NONE_PHRASE, '');
  if (CONTEXT_GLUED.test(explanation) || CONTEXT_DENY.test(kept.slice(0, marker.index))
    || CONTEXT_DENY.test(explanation.replace(CONTEXT_ALLOWED_NEGATION, ''))) return 'missing';
  return 'none';
}

/** Whether `text` holds a Met status at `at`: undefined when it does not, false when it adds a sentence MET_NOTE refuses. */
function metTail(text: string, at: number): boolean | undefined {
  MET_TAIL.lastIndex = at;
  const tail = MET_TAIL.exec(text);
  if (!tail) return undefined;
  const note = tail[1] ?? tail[2];
  return note === undefined || MET_NOTE.test(flatten(note).trim());
}

function rewriteMetCriterion(line: string): string {
  const body = line.trimEnd();
  // Emphasis never hides a severity token or a negated status.
  const guard = body.replace(/[*_`]/g, '');
  if (/\b(?:P[0-3]|critical|high|medium|low)\b/i.test(guard) || /\b(?:not|partially)\s+met\b|\bunmet\b/i.test(guard)) return line;
  const match = /^(\*\*|__)?(?:\((\d{1,3})\)|(\d{1,3})[.)])[\t ]+(\S.*)$/.exec(body);
  if (!match) return line;
  const lead = match[1] ?? '';
  const num = (match[2] ?? match[3])!;
  const rest = match[4]!;
  const rewrite = (met: boolean | undefined) => met ? `${lead}Criterion ${num}: ${rest}` : line;
  // A bold criterion title is followed only by whitespace, at most one delimiter, then the status.
  const closeAt = lead ? rest.indexOf(lead) : -1;
  const title = lead ? (closeAt > 0 ? closeAt + lead.length : 0) : /^(\*\*|__)\S.*?\1/.exec(rest)?.[0].length ?? 0;
  if (title > 0) {
    TITLE_GAP.lastIndex = title;
    return rewrite(TITLE_GAP.test(rest) ? metTail(rest, TITLE_GAP.lastIndex) : undefined);
  }
  // An unwrapped statement ends at the first delimiter followed by a Met status and carries no caveat.
  for (const split of rest.matchAll(MET_SPLIT)) {
    if (!split.index) continue;
    const met = metTail(rest, split.index + split[0].length);
    if (met === undefined) continue;
    return rewrite(met && !STATEMENT_CAVEAT.test(flatten(rest.slice(0, split.index))));
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
      // A numbered nothing-missing context line is not a criterion: drop its number so it is not an unlabeled item.
      if (contextLine(line) === 'none') return line.replace(/^((?:\*\*|__)?)(?:\(\d{1,3}\)|\d{1,3}[.)])[\t ]+/, '$1');
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
