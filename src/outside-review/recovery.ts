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
// attributes, then a noun, place or code name, optionally after one modifier (`the parse() helper`, `any package file`).
const words = (list: string) => new Set(list.split(' '));
// Not `this`, `all`, `each` or another word that can stand alone as a subject.
const DETERMINERS = words('the a an any its their');
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
// The letters with every other mark dropped, so punctuation or markup inside a word (`n*o*t`, `[n](#)ot`) cannot split it.
const joined = (text: string) => text.toLowerCase().replace(/[^a-z\s]+/g, '').replace(/\s+/g, ' ');
// The letters with every mark but an apostrophe dropped and the apostrophes read as spaces (`is**n**`t` reads `isn t`).
const marked = (text: string) => letters(text.replace(/[^a-z\s'‘’ʼ`]+/gi, ''));
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
const NEW_BLOCK = /^[\t ]*$|^ {0,3}(?:[-+*][\t ]+\S|1[.)][\t ]+\S|>|#{1,6}(?:[\t ]|$)|`{3,}[^`]*$|~{3,}|(?:\*\*|__)?(?:NO_FINDINGS|NEEDS_CONTEXT|Recommendation|Verdict)(?:\*\*|__)?[\t ]*(?::|$))/i;
// A CommonMark list item after at most three spaces, its text one to four spaces after the bullet or number; the match
// ends where its text starts. A parenthesized or emphasized number is paragraph text, not an item.
const ITEM = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?: {1,4}(?! )|$)/;
// Container markup (spaces, tabs, quote marks, list bullets or numbers) at the start of a line, then a fence marker that
// CommonMark could read as one, or the `<` that may start an HTML block.
const NESTED_FENCE = /^(?:[\t >]|[-+*](?=[\t ])|\d{1,9}[.)](?=[\t ]))*(?:`{3,}(?!`)(?=[^`]*$)|~{3})/;
// A quote mark or list item right after a list item's marker: markup inside the item.
const NESTED = /^ {0,3}(?:>|[-+*](?:[\t ]|$)|\d{1,9}[.)](?:[\t ]|$))/;
const HTML_START = /^(?:[\t >]|[-+*](?=[\t ])|\d{1,9}[.)](?=[\t ]))*</;
// A met-criterion line is read only as printable ASCII text with typographic apostrophes, quotes and dashes, and without
// any `&`, `<` or backslash (entities, HTML), so no invisible or encoded character can split or hide a word.
const MET_TEXT = /^[\x20-\x7e\t‘’ʼ“”—–]*$/;
const MET_HIDDEN = /[&<\\]/;
// A quote mark after at most three spaces.
const QUOTE = / {0,3}>/y;

/** The index after at most `depth` quote marks at the start of `text`, and how many it read. */
function quotes(text: string, depth: number): { at: number; count: number } {
  let at = 0;
  let count = 0;
  while (count < depth) {
    QUOTE.lastIndex = at;
    if (!QUOTE.test(text)) break;
    at = QUOTE.lastIndex;
    count += 1;
  }
  return { at, count };
}

/**
 * For each line, the most quote marks on the lines before it since the last line that is blank within its quotes: a line
 * may lazily carry on a quoted paragraph that deep.
 */
function paragraphQuotes(lines: string[]): number[] {
  let deepest = 0;
  return lines.map(line => {
    const before = deepest;
    const own = quotes(line, Infinity);
    deepest = /^[\t ]*$/.test(line.slice(own.at)) ? 0 : Math.max(deepest, own.count);
    return before;
  });
}

/** The columns of the spaces and tabs that start `line`, a tab advancing to the next multiple of four. */
function columns(line: string): number {
  let column = 0;
  for (const char of line) {
    if (char === ' ') column += 1;
    else if (char === '\t') column += 4 - (column % 4);
    else break;
  }
  return column;
}

/** Whether `next` carries on the text of `line`, which may lazily carry on a paragraph `outer` quotes deep. */
function continues(line: string, next: string | undefined, outer: number): boolean {
  if (next === undefined) return false;
  // A continuation repeats the quote marks of the paragraph it carries on, so the next line is read within them, and a
  // line blank within them ends it.
  const own = quotes(line, Infinity);
  const rest = next.slice(quotes(next, Math.max(own.count, outer)).at);
  if (/^[\t ]*$/.test(rest)) return false;
  const body = line.slice(own.at);
  const item = ITEM.exec(body);
  // A quote or list item inside the line's list item is not read: any next line that is not blank carries the text on.
  if (item && NESTED.test(body.slice(item[0].length))) return true;
  if (NEW_BLOCK.test(rest)) return false;
  // After a list item, a line indented to the item's text is read from there, and a list item left of it starts the
  // next item. A tab in the indentation is not read: the line carries on.
  if (!item || /^ *\t/.test(rest)) return true;
  const column = item[0].length;
  return columns(rest) >= column ? !NEW_BLOCK.test(rest.slice(column)) : !ITEM.test(rest);
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

/**
 * Determiners, then attributes, then a noun, place or code name, in one pass. A modifier before it is a code name, a
 * possessive or a vocabulary noun without a final `s`, and then the head is a vocabulary noun, so no verb such as
 * `exports` can carry an object (`the handler exports secrets.json`).
 */
function nounPhrase(phrase: string): boolean {
  const tokens = phrase.split(' ');
  let i = 0;
  while (i < tokens.length && DETERMINERS.has(tokens[i]!)) i += 1;
  while (i < tokens.length && ATTRIBUTES.has(tokens[i]!)) i += 1;
  const rest = tokens.slice(i);
  if (rest.length === 1) return nominal(rest[0]);
  if (rest.length !== 2) return false;
  const [modifier, head] = rest as [string, string];
  const vocabulary = (token: string) => { const stem = token.endsWith("'s") ? token.slice(0, -2) : token; return NOUNS.has(stem) || PLACES.has(stem); };
  return vocabulary(head) && (CODE_NAME.test(modifier) || (modifier.endsWith("'s") && nominal(modifier)) || (vocabulary(modifier) && !modifier.endsWith('s')));
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
  // Marks never hide a severity token or a negated status: the line is read with them as spaces and as nothing.
  const guard = body.replace(/[*_`]/g, '');
  if (!MET_TEXT.test(body) || MET_HIDDEN.test(body) || /\b(?:P[0-3]|critical|high|medium|low)\b/i.test(guard)
    || [letters(body), joined(body), marked(body)].some(text => NEGATED_STATUS.test(text))) return line;
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
    return met === undefined ? line : rewrite(met && !STATEMENT_CAVEAT.test(flatten(statement)) && !STATEMENT_CAVEAT.test(joined(statement))
      && ![letters(statement), marked(statement)].some(text => CONTRACTION.test(text)));
  }
  return line;
}

/** Recover formatting only. The upstream validator still owns execution and severity. */
export function recover(text: string, gate: 'review' | 'structured', exit: number, stderr: string, classify: Classifier) {
  const original = classify({ text, gate, exit, stderr });
  const credited = (r: Classification) => r.verdict === 'clean' || r.verdict === 'findings';
  if (exit !== 0 || original.execution.state !== 'ran') return { classification: original, parse: 'not-applicable', credited: false, needs_context: false };
  // Fences as the installed classifier reads them: a marker after spaces or tabs only, closed by any later marker of its
  // kind at least as long.
  let fence: string | undefined;
  // And as CommonMark reads them, while that reading is certain: it opens on a marker after at most three spaces (no
  // backtick after a backtick marker) and closes on a line that holds just such a marker, after at most three spaces. A
  // line left of the opening marker (its list item may have ended), another possible closing marker, a marker after list
  // or quote markup, after a tab or at four or more columns, or a line that may start an HTML block ends that certainty,
  // and every later line is read as text.
  let open: { marker: string; column: number } | undefined;
  let certain = true;
  // And as the merge base read them, for its end-of-reply check: a classifier marker opens a fence that only a line
  // holding just a marker of its kind, at least as long, closes. A reply that ends inside one fails closed.
  let bare: string | undefined;
  const shown = (line: string): boolean => {
    if (!certain) return true;
    if (open) {
      if (/^[\t ]*$/.test(line)) return false;
      const closing = /^[\t ]*(`{3,}|~{3,})[\t ]*$/.exec(line)?.[1];
      const closes = closing !== undefined && closing[0] === open.marker[0] && closing.length >= open.marker.length;
      if (columns(line) >= open.column && (!closes || /^ {0,3}[`~]/.test(line))) {
        if (closes) open = undefined;
        return false;
      }
      open = undefined;
      certain = false;
      return true;
    }
    const opening = /^ {0,3}(`{3,}(?!`)(?=[^`]*$)|~{3,})/.exec(line)?.[1];
    if (opening) {
      open = { marker: opening, column: columns(line) };
      return false;
    }
    if (NESTED_FENCE.test(line) || HTML_START.test(line)) certain = false;
    return true;
  };
  let needsContext = false;
  const raw = text.replace(/\r\n/g, '\n').split('\n');
  const rawQuotes = paragraphQuotes(raw);
  const normalized = raw.map((line, i) => {
    const marker = /^[\t ]*(`{3,}|~{3,})/.exec(line)?.[1];
    const fenced = fence !== undefined;
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      if (!bare) bare = marker;
      else if (marker[0] === bare[0] && marker.length >= bare.length && /^[\t ]*(?:`+|~+)[\t ]*$/.test(line)) bare = undefined;
    }
    // A context line is read wherever either reading shows it as text, and a nothing-missing context line whose text
    // carries on to the next line is none of the allowed forms.
    if (shown(line) || (!marker && !fenced)) {
      const context = contextLine(line);
      if (context === 'missing' || (context === 'none' && continues(line, raw[i + 1], rawQuotes[i]!))) needsContext = true;
    }
    if (marker || fenced) return line;
    // Only label positions, never identifiers or quoted examples in finding prose.
    return line.replace(/^(\s*(?:>\s*)?(?:#{1,6}\s+|[-+*]\s+|\(?\d{1,3}[.)]\s+)?(?:\*\*|__|`)?\[?)p([0-3])\b/i, '$1P$2')
      .replace(QUALIFIED_LABEL, (label, prefix: string, qualifier: string) =>
        /(?<![a-z]-|[a-z])(?:critical|high|medium|low)(?![a-z]|-[a-z])/i.test(qualifier)
          ? label : `${prefix}] (${qualifier})`)
      .replace(/`[^`]*`|(\|\s*(?:\*\*|__|`)?\[?)p([0-3])(?=\]?(?:\*\*|__|`)?\s*\|)/gi,
        (span, before: string | undefined, priority: string) => before === undefined ? span : `${before}P${priority}`);
  }).join('\n').replace(/^(\s*(?:[-*] |#{1,6} )?)(?:\*\*|__)?(Recommendation|Verdict)(?:\*\*|__)?\s*:\s*\n\s*/gim, '$1$2: ');
  let checked = classify({ text: normalized, gate, exit, stderr });
  if (needsContext || fence || bare) return { classification: { ...checked, verdict: 'unverified' as const }, parse: 'failed', credited: false, needs_context: needsContext };
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
    const lineQuotes = paragraphQuotes(lines);
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
      return continues(line, lines[i + 1], lineQuotes[i]!) ? line : rewriteMetCriterion(line);
    }).join('\n');
    if (rewritten !== normalized) {
      const metChecked = classify({ text: rewritten, gate, exit, stderr });
      if (credited(metChecked)) { checked = metChecked; metRecovered = true; }
    }
  }
  return { classification: credited(checked) ? checked : { ...checked, verdict: 'unverified' as const },
    parse: credited(checked) ? (!metRecovered && normalized === text && credited(original) ? 'valid' : 'recovered') : 'failed', credited: credited(checked), needs_context: false };
}
