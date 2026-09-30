/**
 * Bounded description reader for skill frontmatter.
 *
 * This is not a YAML parser. It accepts the two forms used in this
 * repository and rejects everything else with a file-specific error.
 * Its scope is accidental mistakes. The bounded grammar below may also
 * reject deliberately crafted YAML, but it is not a security boundary;
 * a determined author could as easily edit this test.
 */

const HELPER_DOC = 'tests/helpers/skill-description.ts';
const DESCRIPTION_LIMIT = 1024;
const ECHO_LIMIT = 60;
const ADD_DESCRIPTION =
  'Add non-empty text using plain inline (`description: ...`) or a literal block (`description: |`)';
const BOM = String.fromCodePoint(0xfeff);
// Spellings of the description key that get a precise duplicate or spelling
// error. Every other column-0 line must be a plain field or a comment, so an
// escaped, tagged, or anchored key cannot hide a second value.
const DESCRIPTION_KEY = /^(?:description|"description"|'description')[ \t]*:/;
const CANONICAL_KEY = /^description:(?:[ \t]|$)/;
const PLAIN_KEY = /^[A-Za-z0-9_][\w.-]*[ \t]*:(?:[ \t]|$)/;
// Valid YAML the reader rejects, such as `argument hint:`; named for the error.
const SPACED_KEY = /^[A-Za-z0-9_][\w.-]*(?:[ \t]+[\w.-]+)+[ \t]*:(?:[ \t]|$)/;
const LITERAL_HEADER = /^description:[ \t]+\|[ \t]*$/;
const YAML_NULLS = new Set(['~', 'null', 'Null', 'NULL']);

/**
 * Read the description scalar from a complete skill file.
 *
 * Parsing runs on the full SKILL.md text and stops at the frontmatter
 * fence. Pass a source filename or path as `sourceLabel` so failures name
 * the file.
 *
 * Supported plain-inline form:
 *
 * ```md
 * ---
 * name: example
 * description: Route design reviews and return a written verdict.
 * ---
 *
 * # Body
 * ```
 *
 * Supported literal-block form:
 *
 * ```md
 * ---
 * name: example
 * description: |
 *   Route design reviews
 *   and return a written verdict.
 * ---
 *
 * # Body
 * ```
 *
 * CRLF is normalized to LF before fence checks. A lone CR, any other C0
 * control except tab, DEL, C1 controls, and U+2028/U+2029 in the
 * frontmatter are errors, because YAML parsers reject them or disagree on
 * whether they break lines. A frontmatter line that starts with a tab is an
 * error. An indented `---` in the frontmatter is also an error, because
 * some hosts end frontmatter at any line that trims to `---`. Literal
 * common indentation is the number of leading spaces on the first nonblank
 * content line. That prefix is removed from every content line, including
 * whitespace-only lines, so spaces past the indent still count. Extra
 * spaces remain, internal blank lines remain, and a later nonblank line
 * with fewer spaces is an error. Tab indentation is an error. The indent
 * is not recomputed as a minimum across the block.
 *
 * The first frontmatter line that is not blank or a comment must start at
 * column 0. Every column-0 frontmatter line must be a plain unquoted `key:`
 * field whose inline value, if any, does not start with a quote, flow
 * collection, tag, or anchor (`"`, `'`, `[`, `{`, `!`, `&`), or a `#`
 * comment. Anything else (stray text, `...`, a column-0 list item, a
 * quoted, escaped, tagged, or anchored key, or a value that could span
 * lines and swallow the description) is an error. The
 * description ends at the next column-0 line or the closing fence. After
 * it, blank lines and comments at any indent are skipped; an indented
 * non-comment line after a column-0 comment is an error rather than a
 * silent boundary. A leading blank literal line with more spaces than the
 * first content line is an error, as in YAML.
 *
 * Only the scalar's outer YAML whitespace (spaces, tabs, newlines) is
 * trimmed before measuring, so NBSP and other Unicode spaces count toward
 * the length. That removes the trailing newline YAML `|` clip chomping
 * would keep. A value of only whitespace, including Unicode spaces, is
 * empty, and so is a plain value YAML reads as null: a `#` comment, or a
 * core-schema null token (`~`, `null`, `Null`, `NULL`) with or without a
 * trailing comment. Any other `#` comment on a plain value is an error,
 * because YAML would silently drop that text; inside a literal block `#`
 * is text. This preserves the repository's normalized description
 * contract; it is not byte-for-byte YAML or host validation. It does not
 * reject non-string plain values such as `true` or `42`, or check that
 * plain text is otherwise legal YAML (for example an interior `: `).
 *
 * {@link assertSkillDescriptionWithinLimit} measures the trimmed value with
 * JavaScript UTF-16 code units (`String.prototype.length`). A supplementary
 * Unicode character counts as two units, which is conservative relative to
 * Unicode code points. It is not a UTF-8 byte cap and not a claim about
 * host Unicode semantics.
 *
 * Quoted, folded, collection, block-sequence (`-`), complex-key (`?`),
 * mapping-indicator (`:`), tag, anchor, alias, reserved-indicator (`@`,
 * backtick), directive-indicator (`%`), flow-indicator (`]`, `}`, `,`), and
 * modified literal headers (`|-`, `|+`, `|2`, `| # comment`) throw. So do
 * duplicate top-level description fields (including `description :` and
 * quoted-key spellings), any key spelling other than `description:` plus a
 * space or tab, indented continuations of a plain-inline scalar (including
 * after blank lines or comments), and fences that are not exact standalone
 * `---` lines. An indented `description:` inside literal text or the
 * Markdown body is not a second field.
 */
export function readSkillDescription(fullText: string, sourceLabel: string): string {
  const lines = fullText.replace(/\r\n/g, '\n').split('\n');
  const close = closingFence(lines, sourceLabel);
  const fields: number[] = [];
  let stray: string | undefined;
  let seenField = false;
  for (let i = 1; i < close; i++) {
    const line = lines[i] ?? '';
    const control = forbiddenChar(line);
    if (control !== undefined) {
      fail(
        sourceLabel,
        'frontmatter contains a control or line-separator character',
        `line ${i + 1} has U+${control}; YAML parsers reject these characters or disagree on whether they break lines, so the reader cannot trust line boundaries`,
        'Remove the character, or use an ordinary space or newline',
      );
    }
    if (line.startsWith('\t')) {
      fail(
        sourceLabel,
        'frontmatter line uses tab indentation',
        `line ${i + 1} starts with a tab; YAML indentation must be spaces`,
        'Replace leading tabs with spaces',
      );
    }
    // An indented first line can turn the whole frontmatter into another value.
    if (!seenField && !isBlankLine(line) && !/^[ \t]*#/.test(line)) {
      if (!startsAtColumnZero(line)) {
        fail(
          sourceLabel,
          'frontmatter starts with an indented line',
          `line ${i + 1} (${quoted(line)}) is indented before any top-level field, so YAML may read the whole frontmatter as a different value`,
          'Start the frontmatter with a column-0 `key: value` field such as `name:`',
        );
      }
      seenField = true;
    }
    if (DESCRIPTION_KEY.test(line)) fields.push(i);
    else if (stray === undefined && startsAtColumnZero(line) && !line.startsWith('#') && !isPlainField(line)) {
      stray = line;
    }
  }
  if (fields.length > 1) {
    fail(
      sourceLabel,
      'duplicate top-level description field',
      `found ${fields.length} top-level description keys, counting spellings such as \`description :\` and \`"description":\`; an indented description line inside literal text is not a second field`,
      'Keep a single plain-inline or literal | description',
    );
  }

  const index = fields[0];
  const header = index === undefined ? '' : (lines[index] ?? '');
  if (index !== undefined && !CANONICAL_KEY.test(header)) {
    fail(
      sourceLabel,
      'unsupported description key spelling',
      `the key in \`${excerpt(header)}\` is not the plain \`description:\` key the reader measures`,
      'Write the key as `description:` followed by a space, then plain inline text or `|`',
    );
  }
  if (stray !== undefined) failTopLevel(sourceLabel, stray);
  if (index === undefined) {
    const indented = lines.slice(1, close).findIndex((line) => /^ +description[ \t]*:/.test(line));
    const hint =
      indented < 0
        ? ''
        : `; line ${indented + 2} has an indented \`description:\`; if that was intended as the field rather than literal content, move it to column 0`;
    fail(
      sourceLabel,
      'description is missing',
      `no top-level description field exists in the frontmatter, and a following field is not treated as the description${hint}`,
      ADD_DESCRIPTION,
    );
  }
  if (LITERAL_HEADER.test(header)) return readLiteral(lines, index, close, sourceLabel);
  return readPlain(lines, index, close, sourceLabel, header);
}

/**
 * Require the trimmed description to be at most 1024 JavaScript UTF-16 code
 * units. Returns the description from {@link readSkillDescription}. An
 * over-limit error names `sourceLabel`, the measured count, the 1024 limit,
 * and how many units to remove.
 */
export function assertSkillDescriptionWithinLimit(fullText: string, sourceLabel: string): string {
  const value = readSkillDescription(fullText, sourceLabel);
  const measured = value.length;
  if (measured > DESCRIPTION_LIMIT) {
    const over = measured - DESCRIPTION_LIMIT;
    throw new Error(
      `${sourceLabel}: description is ${measured} UTF-16 code units; maximum ${DESCRIPTION_LIMIT}. The trimmed description exceeds the host cap. Shorten by at least ${over}. See ${HELPER_DOC}.`,
    );
  }
  return value;
}

function closingFence(lines: string[], sourceLabel: string): number {
  const opening = lines[0] ?? '';
  if (opening.startsWith(BOM)) {
    fail(
      sourceLabel,
      'malformed frontmatter fence',
      opening.slice(BOM.length) === '---'
        ? 'the file starts with a UTF-8 byte-order mark before the --- fence'
        : 'the file starts with a UTF-8 byte-order mark, and its first line must be exactly ---',
      'Remove the byte-order mark and save the file as UTF-8 without one',
    );
  }
  if (opening !== '---') {
    const problem = opening.startsWith('---')
      ? `found ${quoted(opening)} where the opening fence must be exactly ---; prefixes such as ---x or ---- are not fences`
      : 'the file does not start with a standalone --- fence';
    fail(sourceLabel, 'malformed frontmatter fence', problem, 'Use exact standalone --- lines to open and close frontmatter');
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line === '---') return i;
    if (line.startsWith('---')) {
      fail(
        sourceLabel,
        'malformed frontmatter fence',
        `found ${quoted(line)} where a standalone --- fence was expected; prefixes such as ---x or ---- are not fences, and the closing fence may be missing`,
        'Use exact standalone --- lines to open and close frontmatter',
      );
    }
    if (line.trim() === '---') {
      fail(
        sourceLabel,
        'malformed frontmatter fence',
        `found ${quoted(line)}, which some hosts treat as the closing fence because it trims to ---`,
        'If this line is the closing fence, remove its indentation; if it is text, reword it so it is not a lone ---, because removing the indentation would end the frontmatter there',
      );
    }
  }

  fail(
    sourceLabel,
    'malformed frontmatter fence',
    'no standalone --- closing fence was found, so following body text is not read as the description',
    'Close the frontmatter with a line that is exactly ---',
  );
}

function readPlain(
  lines: string[],
  index: number,
  close: number,
  sourceLabel: string,
  header: string,
): string {
  const payload = trimYaml(header.slice('description:'.length));
  const shape = unsupportedShape(payload);
  if (shape) {
    fail(
      sourceLabel,
      `unsupported description syntax (${shape})`,
      `the header \`${excerpt(trimYaml(header))}\` is not a plain single-line description or a literal block (\`description: |\`)`,
      'Rewrite the description as plain inline text (`description: ...`) or a literal block (`description: |`)',
    );
  }
  if (indentedFollower(lines, index + 1, close) !== undefined) {
    fail(
      sourceLabel,
      'plain-inline description has an indented continuation',
      'a plain-inline description is only the text on its own line; indented lines after it, including after blank lines or comments, are not part of a supported scalar',
      'Put the full text on one line or use a literal block (`description: |`)',
    );
  }
  // YAML drops a comment that starts at the value or after whitespace.
  const comment = payload.search(/(?:^|[ \t])#/);
  const uncommented = trimYaml(comment < 0 ? payload : payload.slice(0, comment));
  if (isEmptyValue(uncommented) || YAML_NULLS.has(uncommented)) {
    const cause = YAML_NULLS.has(uncommented)
      ? `the value \`${uncommented}\` is a YAML null token (\`~\`, \`null\`, \`Null\`, \`NULL\`), which YAML reads as no value`
      : comment >= 0
        ? 'the value is only a `#` comment, which YAML drops, so the field has no text'
        : 'the field has no text after trimming whitespace, including Unicode spaces';
    fail(sourceLabel, 'description is empty', `${cause}, and a following field is not used as the description`, ADD_DESCRIPTION);
  }
  if (comment >= 0) {
    fail(
      sourceLabel,
      'plain-inline description contains a YAML comment',
      'YAML drops everything from a `#` that follows whitespace, so the host would not see that text',
      'Use a literal block (`description: |`), where `#` is text, or remove the comment',
    );
  }
  return payload;
}

function readLiteral(lines: string[], index: number, close: number, sourceLabel: string): string {
  // The block runs until the first nonblank column-0 line or the fence.
  let end = index + 1;
  while (end < close && !startsAtColumnZero(lines[end] ?? '')) end++;
  const block = lines.slice(index + 1, end);

  // Report tabs before any indent-derived error, since they skew the indent.
  if (block.some(hasTabIndent)) {
    fail(
      sourceLabel,
      'literal description uses tab indentation',
      'literal block indentation must be spaces; a tab in the leading whitespace is not indentation',
      'Replace leading tabs with spaces. The first nonblank content line sets how many spaces to strip',
    );
  }
  const first = block.find((line) => !isBlankLine(line));
  // First nonblank line fixes the indent. Do not repair a later shorter line.
  const indent = first === undefined ? 0 : leadingSpaces(first);
  const parts: string[] = [];
  let seenContent = false;
  for (const line of block) {
    if (!isBlankLine(line)) {
      seenContent = true;
      if (leadingSpaces(line) < indent) {
        fail(
          sourceLabel,
          'literal description line is less indented than the first content line',
          `the first nonblank content line fixes the common indentation at ${indent} spaces, and a later nonblank line dedents partway`,
          `Indent every nonblank content line by at least ${indent} spaces`,
        );
      }
    } else if (first !== undefined && !seenContent && line.length > indent) {
      fail(
        sourceLabel,
        'literal description has a leading blank line indented deeper than its first content line',
        `YAML allows leading blank lines in a literal block no more than the ${indent} spaces of the first content line`,
        'Remove the extra spaces from the leading blank line',
      );
    }
    parts.push(line.slice(indent));
  }
  // Only a column-0 comment can end the block and leave an indented line after it.
  const follower = indentedFollower(lines, end, close);
  if (follower !== undefined) {
    fail(
      sourceLabel,
      'literal description is split by a column-0 comment',
      `a column-0 \`#\` line ends the literal block, so the indented line ${quoted(follower)} after it is not part of the description`,
      'Indent the comment to the block level or remove it',
    );
  }

  const value = trimYaml(parts.join('\n'));
  if (isEmptyValue(value)) {
    fail(
      sourceLabel,
      'description is empty',
      'the literal block has no text after trimming whitespace, including Unicode spaces, and a following field is not used as the description',
      ADD_DESCRIPTION,
    );
  }
  return value;
}

function unsupportedShape(payload: string): string | null {
  if (payload.startsWith('|')) return `modified literal header \`${excerpt(payload)}\``;
  if (payload.startsWith('>')) return 'folded scalar (`>`)';
  if (payload.startsWith('"') || payload.startsWith("'")) return 'quoted scalar';
  if (payload.startsWith('[') || payload.startsWith('{')) return 'collection';
  if (payload.startsWith('!')) return 'tag (`!`)';
  if (payload.startsWith('&')) return 'anchor (`&`)';
  if (payload.startsWith('*')) return 'alias (`*`)';
  if (/^-(?:[ \t]|$)/.test(payload)) return 'block sequence (`-`)';
  if (/^\?(?:[ \t]|$)/.test(payload)) return 'complex key (`?`)';
  if (/^:(?:[ \t]|$)/.test(payload)) return 'mapping indicator (`:`)';
  if (payload.startsWith('@')) return 'reserved indicator (`@`)';
  if (payload.startsWith('`')) return 'reserved indicator (`` ` ``)';
  if (payload.startsWith('%')) return 'directive indicator (`%`)';
  const flow = /^[\]},]/.exec(payload)?.[0];
  if (flow) return `flow indicator (\`${flow}\`)`;
  return null;
}

// Skip blank lines and comments at any indent; return the next line if indented.
function indentedFollower(lines: string[], start: number, close: number): string | undefined {
  for (let i = start; i < close; i++) {
    const line = lines[i] ?? '';
    if (isBlankLine(line) || /^[ \t]*#/.test(line)) continue;
    return startsAtColumnZero(line) ? undefined : line;
  }
  return undefined;
}

// A plain unquoted key whose inline value, if any, does not start with a
// quote, flow collection, tag, or anchor.
function isPlainField(line: string): boolean {
  const key = PLAIN_KEY.exec(line);
  return key !== null && !/^[ \t]*["'[{!&]/.test(line.slice(key[0].length));
}

function failTopLevel(sourceLabel: string, line: string): never {
  if (PLAIN_KEY.test(line)) {
    fail(
      sourceLabel,
      'frontmatter field value starts with a quote, flow collection, tag, or anchor',
      `found ${quoted(line)}; such a value can span lines and swallow the description, so the reader does not accept it on top-level fields`,
      'Write the value as plain text that does not start with `"`, `\'`, `[`, `{`, `!`, or `&`, or put it in an indented list or a literal block (`key: |`)',
    );
  }
  if (SPACED_KEY.test(line)) {
    fail(
      sourceLabel,
      'frontmatter key contains a space',
      `found ${quoted(line)}; YAML allows spaces in plain keys, but this reader accepts only keys made of letters, digits, \`_\`, \`.\`, and \`-\`. If this is Markdown body text, the closing --- fence may be missing`,
      'Replace the spaces in the key with `-` or `_`, or restore the closing --- fence',
    );
  }
  fail(
    sourceLabel,
    'frontmatter has a line that is not a top-level field',
    `found ${quoted(line)}; every column-0 frontmatter line must be a plain unquoted \`key:\` field or a \`#\` comment, because a quoted, escaped, tagged, or anchored key can spell description. If this is Markdown body text, the closing --- fence may be missing`,
    'Indent it inside a literal block (`description: |`), write it as a plain `key: value` field with list items indented under it, or restore the closing --- fence',
  );
}

// Echo helpers keep errors short and make Unicode spaces and format
// characters (NBSP, zero-width, bidi marks, soft hyphen) visible.
function excerpt(text: string): string {
  return showInvisible(truncate(text));
}

function quoted(text: string): string {
  return showInvisible(JSON.stringify(truncate(text)));
}

function truncate(text: string): string {
  if (text.length <= ECHO_LIMIT) return text;
  const before = text.charCodeAt(ECHO_LIMIT - 1);
  const after = text.charCodeAt(ECHO_LIMIT);
  const splitPair = before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
  return `${text.slice(0, splitPair ? ECHO_LIMIT - 1 : ECHO_LIMIT)}...`;
}

function showInvisible(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const hex = cp.toString(16).toUpperCase();
    if (ch === ' ' || !/[\p{Zs}\p{Cf}]/u.test(ch)) out += ch;
    else out += cp > 0xffff ? `\\u{${hex}}` : `\\u${hex.padStart(4, '0')}`;
  }
  return out;
}

// C0 controls other than tab, DEL, C1 controls, and U+2028/U+2029. Returns
// the first one as a hex code point.
function forbiddenChar(line: string): string | undefined {
  for (const ch of line) {
    const cp = ch.codePointAt(0) ?? 0;
    if ((cp < 0x20 && cp !== 0x09) || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029) {
      return cp.toString(16).toUpperCase().padStart(4, '0');
    }
  }
  return undefined;
}

// Linear outer trim of YAML whitespace only; NBSP and other Unicode spaces stay.
function trimYaml(text: string): string {
  const isYamlSpace = (ch: string | undefined) => ch === ' ' || ch === '\t' || ch === '\n';
  let start = 0;
  let end = text.length;
  while (start < end && isYamlSpace(text[start])) start++;
  while (end > start && isYamlSpace(text[end - 1])) end--;
  return text.slice(start, end);
}

// JS trim covers NBSP, ideographic space, BOM, and similar. NEL cannot reach
// here: the frontmatter scan rejects it.
function isEmptyValue(text: string): boolean {
  return text.trim() === '';
}

function isBlankLine(line: string): boolean {
  return /^[ \t]*$/.test(line);
}

function startsAtColumnZero(line: string): boolean {
  return line !== '' && line[0] !== ' ' && line[0] !== '\t';
}

function hasTabIndent(line: string): boolean {
  for (const ch of line) {
    if (ch === ' ') continue;
    return ch === '\t';
  }
  return false;
}

function leadingSpaces(line: string): number {
  let count = 0;
  while (line[count] === ' ') count++;
  return count;
}

function fail(sourceLabel: string, problem: string, cause: string, correction: string): never {
  throw new Error(`${sourceLabel}: ${problem}. ${cause}. ${correction}. See ${HELPER_DOC}.`);
}
