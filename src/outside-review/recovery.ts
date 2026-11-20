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
// Text after `NEEDS_CONTEXT: none` and after `Met.` is credited only in the forms below (owner decision A); anything
// else fails closed. All of it is read lowercased, with code-span text kept and typographic apostrophes normalized.
// Only list, quote or heading markup may precede the context marker. Each repeat consumes a fixed token, so a long run
// of markup stays linear.
const CONTEXT_PREFIX = /^\s*(?:(?:[-+>]|\(?\d{1,3}[.)]|#{1,6}(?!#))\s*)*$/;
// Another marker, a severity label or word, a review marker, a quote, brace or question, or a `name:line` reference is
// never an explanation.
const CONTEXT_GLUED = /needscontext|nofindings|\[p[0-3]\b|\bp[0-3]\b|\b(?:critical|high|medium|low|severity|recommendation|verdict)\b|["{}?]|:\d/;
// Each part of an explanation (its parenthetical, then each sentence or clause) is the change statement below, or says
// context was supplied: it holds one of the affirming words and uses only the closed vocabulary below, so any other word
// fails closed.
const words = (list: string) => new Set(list.split(' '));
const AFFIRMING = words('supplied provided included present shown given attached available visible covered contained complete sufficient');
// Only these may stand between a copula and its affirming word (`the callers are all present`).
const QUALIFIERS = words('all both each also too');
// A clause's subject: a noun, place or code name, or one of these.
const SUBJECTS = words('it they everything');
const DETERMINERS = words('the a an all every each both its their these those this any');
// Not `be`: here it only forms a command or a wish (`the callers be supplied`).
const COPULAS = words('is are was were been has have had');
// `and` is not a word of a clause: like a comma, it starts the next clause.
const LINKS = words('it they them everything of also too verbatim above below here');
// Review material a voice is given. After the affirming word, `in`, `within` and `by` name only one of these places.
const PLACES = words('prompt diff diffs context material materials excerpt excerpts extension input message review section sections');
const PLACE_LINKS = words('in within by');
const NOUNS = words('caller callers callee callees call calls interface interfaces file files test tests fixture fixtures type types '
  + 'schema schemas contract contracts definition definitions function functions method methods class classes module modules '
  + 'implementation implementations source sources code helper helpers doc docs documentation plan criteria criterion change '
  + 'changes dependency dependencies import imports export exports signature signatures snippet snippets hunk hunks constant '
  + 'constants handler handlers route routes component components template templates model models migration migrations query '
  + 'queries config configuration body bodies script scripts command commands option options flag flags field fields parser '
  + 'parsers library libraries package packages version changelog readme license lockfile manifest release');
// Attributive only: each is followed, within its clause, by more attributes and then a noun, place or code name, so
// `the schema was requested` and `schema requested, callers supplied` are not affirmations.
const ATTRIBUTES = words('requested relevant referenced changed touched modified new existing related surrounding entire whole full same negative positive');
// A count only directly after `all`, so two counts cannot say part of the material was supplied.
const COUNTS = words('two three four five six seven eight nine ten');
// A code name: a call (`name()`), or a file name or path ending in a listed source or document extension. An abbreviation
// or words joined by a slash or dot (`w/o`, `n/a`, `n.a`, `0.5`) are not names. Each path segment ends at a separator,
// so the match stays linear.
const CODE_NAME = /^(?:[a-z0-9$][a-z0-9$.]*\(\)|(?:[a-z0-9.-]+[/\\])*[a-z0-9-][a-z0-9.-]*\.(?:ts|tsx|js|jsx|mjs|cjs|json|jsonl|md|mdx|txt|yaml|yml|toml|lock|sh|bash|zsh|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sql|html|css|scss|xml|ini|cfg|conf|csv|lua|pl|ex|exs|hs|ml|scala|clj|dart|vue|svelte|gradle|mod|sum|nix|tf|proto|graphql))$/;
// The change statement: the change does not touch, change, edit, modify or affect (on a context line also: depend on)
// a list of names. Its names carry no punctuation but commas and the dots inside a file name.
const CHANGE_NOTE = /^(?:the |this )?(?:change|changes|diff|fix|patch|branch|commit|pr|pull request) (?:does|do|did)(?: not|n't) (touch|change|edit|modify|affect|depend on) ((?:[^.;:!?]|\.(?=\S))+)\.?$/;
const APOSTROPHES = /[‘’ʼ]/g;
const NONE_PHRASE = /^none(?: of the above depends? on missing context)?/;
// `none` (optionally the observed phrase), then the end, a sentence break or one parenthetical (one nested pair allowed)
// that itself ends the value or is followed by a sentence break.
const NONE_VALUE = /^none(?: of the above depends? on missing context)?(?:$|[.;](?:\s.*|$)| \((?:[^()]|\([^()]*\))+\)(?:$|[.;](?:\s.*|$)))/;
// An unwrapped criterion statement carrying a contrast, failure, obligation, negation, condition, hedge or exception is a
// caveat, not a criterion.
const STATEMENT_CAVEAT = /\b(?:however|but|except[a-z]*|although|though|yet|unless|whereas|fail[a-z]*|drop[a-z]*|lose|loses|losing|lost|loss|leak[a-z]*|crash[a-z]*|break[a-z]*|broke[a-z]*|bug[a-z]*|defect[a-z]*|error[a-z]*|wrong|incorrect[a-z]*|regress[a-z]*|must|should|todo|fixme|issue[a-z]*|problem[a-z]*|partial[a-z]*|partly|unmet|missing|untested|unverified|not|no|never|[a-z]+n't|cannot|only|if|when|whenever|until|while|whether|provided that|assum[a-z]*|presum[a-z]*|probabl[a-z]*|likely|maybe|perhaps|possibl[a-z]*|apparent[a-z]*|seem[a-z]*|appear[a-z]*|mostly|largely|nearly|almost|mainly|generally|usually|sometimes|typically|apart|aside|besides|exclud[a-z]*|other than|save for|sans|minus|without|lack[a-z]*|skip[a-z]*|pending|incomplet[a-z]*|absent|defer[a-z]*|tbd|wip|n\/a|w\/o)\b/;
// A negated status: a negation (`not`, `never`, `cannot`, an `n't` word, `no longer`, `hardly`, `barely`, `scarcely`,
// `seldom`, `rarely`, `nowhere`, `partially`, `partly`) up to two words before `Met`, read on the line's letters only, so
// emphasis, punctuation or unusual spacing cannot separate them.
const NEGATED_STATUS = /\b(?:not|never|cannot|[a-z]+n t|no longer|hardly|barely|scarcely|seldom|rarely|nowhere|partially|partly)(?: [a-z]+){0,2} met\b|\bunmet\b/;
const letters = (text: string) => text.toLowerCase().replace(/[^a-z]+/g, ' ');
// An `n't` word with any mark for its apostrophe (`isn´t`, `isn&#39;t`), read on a statement's letters.
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
  if (!NONE_VALUE.test(value)) return 'missing';
  const explanation = value.replace(NONE_PHRASE, '');
  return !CONTEXT_GLUED.test(explanation) && contextParts(explanation).every(affirmsContext) ? 'none' : 'missing';
}

/** The parenthetical of a nothing-missing explanation, then each sentence or clause after it. */
function contextParts(explanation: string): string[] {
  const paren = /^ \(((?:[^()]|\([^()]*\))+)\)/.exec(explanation);
  const parts = paren ? [paren[1]!, explanation.slice(paren[0].length)] : [explanation];
  return parts.flatMap(part => part.split(/[.;!](?=\s|$)/)).map(part => part.trim()).filter(Boolean);
}

/** A part's clauses: its words (`as well` read as `too`) split at commas and at `and`. */
function clauses(part: string): string[][] {
  const out: string[][] = [[]];
  for (const raw of part.replace(/\bas well\b/g, 'too').split(' ')) {
    const token = raw.replace(/,$/, '');
    if (token === 'and') out.push([]);
    else if (token) out[out.length - 1]!.push(token);
    if (raw.endsWith(',')) out.push([]);
  }
  return out.filter(clause => clause.length > 0);
}

/**
 * A part is the change statement, or a statement that holds an affirming word and only vocabulary words and names only
 * places after its first affirming word. Each clause names its subject before its first copula and before its first
 * affirming word that is not an attribute, so no clause opens with either; each copula is followed by its affirming word;
 * after the predicate starts, a copula only continues a copula or follows the participle that started it, and any later
 * affirming word follows a copula or is an attribute; and a clause with its own copula, or one after an affirmed clause,
 * holds its own affirming word. So neither a request (`also present the callers`, `supplied present the callers`) nor a
 * condition (`complete given the schema`, `everything provided the callers are supplied`) affirms.
 */
function affirmsContext(part: string): boolean {
  if (CHANGE_NOTE.test(part)) return changeStatement(part, true);
  let seen = false, before = false;
  for (const clause of clauses(part)) {
    // predicate: a copula or an affirming word that is not an attribute has been read; participle: the position of that
    // affirming word when it started the predicate; linked: a copula still waits for its affirming word; prepositional: a
    // preposition came before any subject, so its noun is not the subject.
    let subject = false, prepositional = false, predicate = false, copula = false, affirmed = false, linked = false;
    let participle = -1;
    for (let i = 0; i < clause.length; i += 1) {
      const token = clause[i]!;
      if (COPULAS.has(token)) {
        // After the predicate a copula only continues a copula (`have been`) or directly follows the participle that
        // started it (`the callers present are sufficient`); anywhere else it starts a second clause, such as a condition.
        if (!subject || (predicate && !linked && participle !== i - 1)) return false;
        predicate = copula = linked = true;
      } else if (AFFIRMING.has(token)) {
        if (linked) linked = false;
        else if (!attributive(clause, i)) {
          if (predicate || !subject) return false;
          predicate = true;
          participle = i;
        }
        affirmed = true;
      } else if (linked ? !QUALIFIERS.has(token) : !contextWord(clause, i, seen || affirmed)) return false;
      else if (!predicate) {
        if (PLACE_LINKS.has(token) || (token === 'of' && !DETERMINERS.has(clause[i - 1] ?? ''))) prepositional ||= !subject;
        else if (!prepositional && (SUBJECTS.has(token) || nominal(token))) subject = true;
      }
    }
    if (linked || ((copula || before) && !affirmed)) return false;
    before ||= affirmed;
    seen ||= affirmed;
  }
  return seen;
}

/** A vocabulary word other than a copula or an affirming word, in its place in its clause. */
function contextWord(tokens: string[], i: number, afterAffirming: boolean): boolean {
  const token = tokens[i]!, prev = tokens[i - 1] ?? '';
  if (DETERMINERS.has(token) || LINKS.has(token)) return true;
  if (token === 'full' && prev === 'in' && !nominal(tokens[i + 1])) return true;
  if (ATTRIBUTES.has(token)) return !COPULAS.has(prev) && headNoun(tokens, i + 1);
  if (COUNTS.has(token)) return prev === 'all';
  if (PLACE_LINKS.has(token)) return !afterAffirming || placeAt(tokens, i + 1);
  return nominal(token);
}

/** An affirming word used as an attribute: after a determiner, count or attribute, and before its noun. */
function attributive(tokens: string[], i: number): boolean {
  const prev = tokens[i - 1] ?? '';
  return (DETERMINERS.has(prev) || COUNTS.has(prev) || ATTRIBUTES.has(prev)) && headNoun(tokens, i + 1);
}

/** A noun, place or code name, or one of those with a possessive `'s`. */
function nominal(token: string | undefined): boolean {
  if (token === undefined) return false;
  const stem = token.endsWith("'s") ? token.slice(0, -2) : token;
  return NOUNS.has(stem) || PLACES.has(stem) || CODE_NAME.test(stem);
}

// Each token array's head-noun answers, computed once from its end, so a long attribute run stays linear.
const HEADS = new WeakMap<string[], boolean[]>();

/** Attributes, then a noun, place or code name, from `at` to the end of the clause. */
function headNoun(tokens: string[], at: number): boolean {
  let heads = HEADS.get(tokens);
  if (!heads) {
    heads = Array<boolean>(tokens.length + 1).fill(false);
    for (let i = tokens.length - 1; i >= 0; i -= 1) heads[i] = ATTRIBUTES.has(tokens[i]!) ? heads[i + 1]! : nominal(tokens[i]);
    HEADS.set(tokens, heads);
  }
  return heads[at] ?? false;
}

/** `full` after `in` (as in `in full`), or a place in the review material after determiners, affirming words and attributes. */
function placeAt(tokens: string[], at: number): boolean {
  if (tokens[at] === 'full' && tokens[at - 1] === 'in' && !nominal(tokens[at + 1])) return true;
  let i = at;
  while (i < tokens.length && (DETERMINERS.has(tokens[i]!) || AFFIRMING.has(tokens[i]!) || ATTRIBUTES.has(tokens[i]!))) i += 1;
  return PLACES.has(tokens[i] ?? '');
}

/** Whether `text` is the change statement and each of its names is a code name or vocabulary words. */
function changeStatement(text: string, dependOn: boolean): boolean {
  const note = CHANGE_NOTE.exec(text);
  return !!note && (dependOn || note[1] !== 'depend on') && !CONTEXT_GLUED.test(note[2]!)
    && note[2]!.split(/,\s*(?:(?:and|or)\s+)?|\s+(?:and|or)\s+/).every(name => {
      const tokens = name.trim().split(' ');
      return tokens.every((token, i) => DETERMINERS.has(token) || token === 'of' || token === 'in'
        || (ATTRIBUTES.has(token) ? headNoun(tokens, i + 1) : nominal(token)));
    });
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
  // Emphasis never hides a severity token or a negated status.
  const guard = body.replace(/[*_`]/g, '');
  if (/\b(?:P[0-3]|critical|high|medium|low)\b/i.test(guard) || NEGATED_STATUS.test(letters(guard))) return line;
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
      // A numbered nothing-missing context line is not a criterion: drop its number so it is not an unlabeled item, unless
      // the rest would then open a code fence and hide the lines after it from the classifier.
      if (contextLine(line) === 'none') {
        const dropped = line.replace(/^((?:\*\*|__)?)(?:\(\d{1,3}\)|\d{1,3}[.)])[\t ]+/, '$1');
        return /^\s*(?:`{3,}|~{3,})/.test(dropped) ? line : dropped;
      }
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
