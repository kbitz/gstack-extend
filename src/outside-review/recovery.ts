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
// A context line saying nothing is missing is credited only in three forms (owner decision A, continuation 3): `none`,
// the observed sentence `none of the above depends on missing context`, or `none` and one change statement. Text after
// `Met.` is credited only as one change statement. Anything else fails closed. All of it is read lowercased, with
// code-span text kept and typographic apostrophes normalized. Only list, quote or heading markup may precede the context
// marker. Each repeat consumes a fixed token, so a long run of markup stays linear.
const CONTEXT_PREFIX = /^\s*(?:(?:[-+>]|\(?\d{1,3}[.)]|#{1,6}(?!#))\s*)*$/;
// Another marker, a severity label or word, a review marker, a quote, brace or question, or a `name:line` reference is
// never a change-statement name.
const CONTEXT_GLUED = /needscontext|nofindings|\[p[0-3]\b|\bp[0-3]\b|\b(?:critical|high|medium|low|severity|recommendation|verdict)\b|["{}?]|:\d/;
// Each change-statement name is one or more noun phrases joined by `of` or `in`; a noun phrase is determiners, then
// attributes, then one or two nouns, places or code names (`the parse() helper`).
const words = (list: string) => new Set(list.split(' '));
const DETERMINERS = words('the a an all every each both its their these those this any');
// Review material a voice is given.
const PLACES = words('prompt diff diffs context material materials excerpt excerpts extension input message review section sections');
const NOUNS = words('caller callers callee callees call calls interface interfaces file files test tests fixture fixtures type types '
  + 'schema schemas contract contracts definition definitions function functions method methods class classes module modules '
  + 'implementation implementations source sources code helper helpers doc docs documentation plan criteria criterion change '
  + 'changes dependency dependencies import imports export exports signature signatures snippet snippets hunk hunks constant '
  + 'constants handler handlers route routes component components template templates model models migration migrations query '
  + 'queries config configuration body bodies script scripts command commands option options flag flags field fields parser '
  + 'parsers library libraries package packages version changelog readme license lockfile manifest release');
// Attributive only: each is followed, within its noun phrase, by more attributes and then a noun, place or code name.
const ATTRIBUTES = words('requested relevant referenced changed touched modified new existing related surrounding entire whole full same negative positive');
// A code name: a call (`name()`), or a file name or path ending in a listed source or document extension. An abbreviation
// or words joined by a slash or dot (`w/o`, `n/a`, `n.a`, `0.5`) are not names. Each path segment ends at a separator,
// so the match stays linear.
const CODE_NAME = /^(?:[a-z0-9$][a-z0-9$.]*\(\)|(?:[a-z0-9.-]+[/\\])*[a-z0-9-][a-z0-9.-]*\.(?:ts|tsx|js|jsx|mjs|cjs|json|jsonl|md|mdx|txt|yaml|yml|toml|lock|sh|bash|zsh|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sql|html|css|scss|xml|ini|cfg|conf|csv|lua|pl|ex|exs|hs|ml|scala|clj|dart|vue|svelte|gradle|mod|sum|nix|tf|proto|graphql))$/;
// The change statement: the change does not touch, change, edit, modify or affect (on a context line also: depend on)
// a list of names. Its names carry no punctuation but commas and the dots inside a file name.
const CHANGE_NOTE = /^(?:the |this )?(?:change|changes|diff|fix|patch|branch|commit|pr|pull request) (?:does|do|did)(?: not|n't) (touch|change|edit|modify|affect|depend on) ((?:[^.;:!?]|\.(?=\S))+)\.?$/;
const APOSTROPHES = /[‘’ʼ]/g;
// `none`, or the observed sentence (also with `depend`), each with an optional period.
const NONE_VALUE = /^none(?: of the above depends? on missing context)?\.?$/;
// `none`, then one change statement: a sentence after `.` or `;`, or a parenthetical (one nested pair allowed) with an
// optional period after it.
const NONE_STATEMENT = /^none(?:[.;] (.+)| \(((?:[^()]|\([^()]*\))+)\)\.?)$/;
// An unwrapped criterion statement carrying a contrast, failure, obligation, negation, condition, hedge or exception is a
// caveat, not a criterion.
const STATEMENT_CAVEAT = /\b(?:however|but|except[a-z]*|although|though|yet|unless|whereas|fail[a-z]*|drop[a-z]*|lose|loses|losing|lost|loss|leak[a-z]*|crash[a-z]*|break[a-z]*|broke[a-z]*|bug[a-z]*|defect[a-z]*|error[a-z]*|wrong|incorrect[a-z]*|regress[a-z]*|must|should|todo|fixme|issue[a-z]*|problem[a-z]*|partial[a-z]*|partly|unmet|missing|untested|unverified|not|no|never|[a-z]+n't|cannot|only|if|when|whenever|until|while|whether|provided that|assum[a-z]*|presum[a-z]*|probabl[a-z]*|likely|maybe|perhaps|possibl[a-z]*|apparent[a-z]*|seem[a-z]*|appear[a-z]*|mostly|largely|nearly|almost|mainly|generally|usually|sometimes|typically|apart|aside|besides|exclud[a-z]*|other than|save for|sans|minus|without|lack[a-z]*|skip[a-z]*|pending|incomplet[a-z]*|absent|defer[a-z]*|tbd|wip|n\/a|w\/o)\b/;
// A negated status: a negation (`not`, `never`, `cannot`, an `n't` word, `no longer`, `hardly`, `barely`, `scarcely`,
// `seldom`, `rarely`, `nowhere`, `partially`, `partly`) up to two words before `Met`, read on the line's letters only, so
// emphasis, punctuation or unusual spacing cannot separate them.
const NEGATED_STATUS = /\b(?:not|never|cannot|[a-z]+n t|no longer|hardly|barely|scarcely|seldom|rarely|nowhere|partially|partly)(?: [a-z]+){0,2} met\b|\bunmet\b/;
const letters = (text: string) => text.toLowerCase().replace(/[^a-z]+/g, ' ');
// An `n't` word with any mark for its apostrophe (`isn´t`), read on a statement's letters.
const CONTRACTION = /\b[a-z]+n t\b/;
// Between a bold criterion title and its status: whitespace and at most one delimiter.
const TITLE_GAP = /(?:[\t ]*(?::|[—–]|[\t ]-))?[\t ]+/y;
const flatten = (text: string) => text.replace(/[`*_]/g, '').replace(APOSTROPHES, "'").toLowerCase().replace(/\s+/g, ' ');
// A Met status read at a position (sticky): `Met`, `Met, by inspection` (its period optional) or `Met.`, and after `Met.`
// alone an optional sentence.
const MET_TAIL = /(?:(?:\*\*|__)?Met(?:\*\*|__)?(?:, by inspection\.?|\.(?:[\t ]+(\S.*))?)?|(?:\*\*|__)Met, by inspection\.?(?:\*\*|__)|(?:\*\*|__)Met\.(?:\*\*|__)(?:[\t ]+(\S.*))?)$/y;
// A delimiter, whitespace, then a Met status. Each start is tried in constant work plus its own whitespace run, so long
// whitespace runs in an untrusted reply stay linear.
const MET_SPLIT = /(?::|[—–]|[\t ]-)[\t ]+(?=(?:\*\*|__)?Met\b)/g;
// A line that interrupts paragraph text, as CommonMark reads it: blank, or after at most three spaces a bullet item or an
// item numbered 1 with text, a quote, heading or fence, or a marker line (a marker followed by a colon or the line's
// end). Any other line, a table row or an item with another number included, carries on the text of the line above it.
const NEW_BLOCK = /^[\t ]*$|^ {0,3}(?:[-+*][\t ]+\S|1[.)][\t ]+\S|>|#{1,6}(?:[\t ]|$)|`{3,}|~{3,}|(?:\*\*|__)?(?:NO_FINDINGS|NEEDS_CONTEXT|Recommendation|Verdict)(?:\*\*|__)?[\t ]*(?::|$))/i;
// A bullet or numbered item.
const ITEM = /^[\t ]*(?:[-+*][\t ]|(?:\*\*|__)?\(?\d{1,3}[.)](?:[\t ]|$))/;
// A met-criterion line is read only as printable ASCII text with typographic apostrophes, quotes and dashes, and without
// a character entity, HTML tag or comment, or backslash, so no invisible or encoded character can split or hide a word.
const MET_TEXT = /^[\x20-\x7e\t‘’ʼ“”—–]*$/;
const MET_HIDDEN = /&#?[a-z0-9]{1,8};|<[!/a-z]|\\/i;
const QUOTE = /[\t ]*>/y;

/** The index after at most `depth` quote marks at the start of `text`. */
function quotes(text: string, depth: number): number {
  let at = 0;
  for (let n = 0; n < depth; n += 1) {
    QUOTE.lastIndex = at;
    if (!QUOTE.test(text)) break;
    at = QUOTE.lastIndex;
  }
  return at;
}

/** Whether `next` carries on the text of `line`. */
function continues(line: string, next: string | undefined): boolean {
  if (next === undefined) return false;
  // Inside a quote a continuation repeats the quote marks, so the next line is read within as many quotes as the line's
  // markup opens; after a list item, another list item at any indentation is its sibling or sub-item.
  const rest = next.slice(quotes(next, /^[^\p{L}`]*/u.exec(line)![0].split('>').length - 1));
  return !NEW_BLOCK.test(rest) && !(ITEM.test(line.slice(quotes(line, Infinity))) && ITEM.test(rest));
}

export function contextLine(line: string): 'none' | 'missing' | null {
  const plain = line.replace(/`([^`]*)`/g, (_span, inner: string) => /^NEEDS_CONTEXT:?$/i.test(inner.trim()) ? inner : '')
    .replace(/[*_]/g, '');
  const body = plain.replace(/^\s*(?:(?:[-+>]|\(?\d{1,3}[.)]|#{1,6}|\|)\s*)*/, '')
    .replace(/^(?:Recommendation|Verdict|Status)\s*(?::|[—–-]|\|)\s*/i, '');
  if (!/^NEEDSCONTEXT(?:\s*(?::|[—–-]|\||$)|\s+because\b)/i.test(body)) return null;
  if (plain.includes('|')) return 'missing';
  if (!/^NEEDSCONTEXT\s*[:—–-]/i.test(body)) return 'missing';
  // The whole line is read with code-span text kept, so a code span cannot hide text before or after the marker.
  const kept = flatten(line);
  const marker = /needscontext\s*[:—–-]/.exec(kept);
  if (!marker || !CONTEXT_PREFIX.test(kept.slice(0, marker.index))) return 'missing';
  const value = kept.slice(marker.index + marker[0].length).trim();
  if (NONE_VALUE.test(value)) return 'none';
  const statement = NONE_STATEMENT.exec(value);
  return statement && changeStatement((statement[1] ?? statement[2]!).trim(), true) ? 'none' : 'missing';
}

/** A noun, place or code name, or one of those with a possessive `'s`. */
function nominal(token: string | undefined): boolean {
  if (token === undefined) return false;
  const stem = token.endsWith("'s") ? token.slice(0, -2) : token;
  return NOUNS.has(stem) || PLACES.has(stem) || CODE_NAME.test(stem);
}

/** Determiners, then attributes, then one or two nouns, places or code names, in one pass. */
function nounPhrase(phrase: string): boolean {
  const tokens = phrase.split(' ');
  let i = 0;
  while (i < tokens.length && DETERMINERS.has(tokens[i]!)) i += 1;
  while (i < tokens.length && ATTRIBUTES.has(tokens[i]!)) i += 1;
  const nouns = tokens.length - i;
  return nouns >= 1 && nouns <= 2 && tokens.slice(i).every(token => nominal(token));
}

/** Whether `text` is the change statement and each of its names is noun phrases joined by `of` or `in`. */
function changeStatement(text: string, dependOn: boolean): boolean {
  const note = CHANGE_NOTE.exec(text);
  return !!note && (dependOn || note[1] !== 'depend on') && !CONTEXT_GLUED.test(note[2]!)
    && note[2]!.split(/,\s*(?:(?:and|or)\s+)?|\s+(?:and|or)\s+/).every(name => name.trim().split(/ (?:of|in) /).every(nounPhrase));
}

/** Whether `text` holds a Met status at `at`: undefined when it does not, false when it adds a sentence other than the change statement. */
function metTail(text: string, at: number): boolean | undefined {
  MET_TAIL.lastIndex = at;
  const tail = MET_TAIL.exec(text);
  if (!tail) return undefined;
  const note = tail[1] ?? tail[2];
  return note === undefined || changeStatement(flatten(note).trim(), false);
}

function rewriteMetCriterion(line: string): string {
  const body = line.trimEnd();
  // Emphasis and code marks never hide a severity token or a negated status, read with the marks as spaces or as nothing.
  const guard = body.replace(/[*_`]/g, '');
  if (!MET_TEXT.test(body) || MET_HIDDEN.test(body) || /\b(?:P[0-3]|critical|high|medium|low)\b/i.test(guard)
    || NEGATED_STATUS.test(letters(body)) || NEGATED_STATUS.test(letters(guard))) return line;
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
  // An unwrapped statement ends at the first delimiter followed by `Met`, which must start a valid status, and carries no
  // caveat; a first status other than Met is never folded into the statement.
  for (const split of rest.matchAll(MET_SPLIT)) {
    if (!split.index) continue;
    const met = metTail(rest, split.index + split[0].length);
    const statement = rest.slice(0, split.index);
    return met === undefined ? line : rewrite(met && !STATEMENT_CAVEAT.test(flatten(statement)) && !CONTRACTION.test(letters(statement)));
  }
  return line;
}

/** Recover formatting only. The upstream validator still owns execution and severity. */
export function recover(text: string, gate: 'review' | 'structured', exit: number, stderr: string, classify: Classifier) {
  const original = classify({ text, gate, exit, stderr });
  const credited = (r: Classification) => r.verdict === 'clean' || r.verdict === 'findings';
  if (exit !== 0 || original.execution.state !== 'ran') return { classification: original, parse: 'not-applicable', credited: false, needs_context: false };
  // Fences as the installed classifier reads them (a marker after spaces or tabs only, closed by any later marker of its
  // kind at least as long), and as CommonMark reads them (closed only by a line that holds just such a marker).
  let fence: string | undefined;
  let shown: string | undefined;
  let needsContext = false;
  const raw = text.replace(/\r\n/g, '\n').split('\n');
  const normalized = raw.map((line, i) => {
    const marker = /^[\t ]*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      if (!shown) shown = marker;
      else if (marker[0] === shown[0] && marker.length >= shown.length && /^[\t ]*(?:`+|~+)[\t ]*$/.test(line)) shown = undefined;
      return line;
    }
    // A context line is read wherever either reading shows it as text, and a nothing-missing context line whose text
    // carries on to the next line is none of the allowed forms.
    if (!fence || !shown) {
      const context = contextLine(line);
      if (context === 'missing' || (context === 'none' && continues(line, raw[i + 1]))) needsContext = true;
    }
    if (fence) return line;
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
    const lines = normalized.split('\n');
    const rewritten = lines.map((line, i) => {
      const marker = /^[\t ]*(`{3,}|~{3,})/.exec(line)?.[1];
      if (metFence) {
        if (marker && marker[0] === metFence[0] && marker.length >= metFence.length) metFence = undefined;
        return line;
      }
      if (marker) { metFence = marker; return line; }
      // A numbered nothing-missing context line is not a criterion: drop its number so it is not an unlabeled item, unless
      // the rest would then open a code fence and hide the lines after it from the classifier.
      if (contextLine(line) === 'none') {
        const dropped = line.replace(/^((?:\*\*|__)?)(?:\(\d{1,3}\)|\d{1,3}[.)])[\t ]+/, '$1');
        return /^\s*(?:`{3,}|~{3,})/.test(dropped) ? line : dropped;
      }
      // A criterion whose text carries on to the next line is not read whole, so it stays an unlabeled item.
      return continues(line, lines[i + 1]) ? line : rewriteMetCriterion(line);
    }).join('\n');
    if (rewritten !== normalized) {
      const metChecked = classify({ text: rewritten, gate, exit, stderr });
      if (credited(metChecked)) { checked = metChecked; metRecovered = true; }
    }
  }
  return { classification: credited(checked) ? checked : { ...checked, verdict: 'unverified' as const },
    parse: credited(checked) ? (!metRecovered && normalized === text && credited(original) ? 'valid' : 'recovered') : 'failed', credited: credited(checked), needs_context: false };
}
