/**
 * audit-compliance.test.ts — structural invariants for gstack-extend.
 *
 * Four describes:
 *   (A) Frontmatter sanity — every skills/*.md has --- fence, matching
 *       name:, a non-empty description of at most 1024 UTF-16 code units,
 *       and allowed-tools:. In-memory fixtures lock the shared description
 *       reader in tests/helpers/skill-description.ts.
 *   (B) setup ↔ skills/*.md symmetric — every name in setup's SKILLS array
 *       has a skills/*.md, and every skills/*.md is in SKILLS.
 *   (C) Source-tag registry consistency — REGISTERED_SOURCES from
 *       src/audit/lib/source-tag.ts matches the grammar list in
 *       docs/source-tag-contract.md exactly.
 *   (D) /full-review vocabulary matches the source-tag contract — severities,
 *       the three agent prompt copies, finding fields, and the tag-value rule.
 *
 * While editing a skill description, re-run this suite directly:
 *   bun test tests/audit-compliance.test.ts
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REGISTERED_SOURCES, validateTagExpression } from '../src/audit/lib/source-tag.ts';
import { parseSetupSkills } from './helpers/parse-setup-skills.ts';
import {
  assertSkillDescriptionWithinLimit,
  readSkillDescription,
} from './helpers/skill-description.ts';

const ROOT = join(import.meta.dir, '..');
const SKILLS_DIR = join(ROOT, 'skills');
const SETUP_FILE = join(ROOT, 'setup');
const CONTRACT_FILE = join(ROOT, 'docs', 'source-tag-contract.md');

function fenced(frontmatter: string, body = 'Body'): string {
  return `---\n${frontmatter}\n---\n${body}\n`;
}

// Written by code point so an editor cannot normalize it into a space.
const NBSP = String.fromCodePoint(0x00a0);

function thrownMessage(run: () => void): string {
  let message: string | undefined;
  try {
    run();
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  expect(message).toBeDefined();
  return message ?? '';
}

// ─── (A) Frontmatter sanity ──────────────────────────────────────────

const SKILL_FILES = readdirSync(SKILLS_DIR)
  .filter((f) => f.endsWith('.md'))
  .sort();

describe('(A) frontmatter sanity', () => {
  for (const file of SKILL_FILES) {
    const path = join(SKILLS_DIR, file);
    const content = readFileSync(path, 'utf8');
    const skillName = file.replace(/\.md$/, '');

    test(`${file} starts with --- fence`, () => {
      expect(content.startsWith('---\n')).toBe(true);
    });

    // The name and allowed-tools checks use this slice, which ends at the
    // first line starting with `---`. It is LF-only, like the opening check
    // above. Both description checks read the full file through
    // tests/helpers/skill-description.ts, which requires exact standalone
    // `---` fences and normalizes CRLF.
    const closeIdx = content.indexOf('\n---', 4);
    if (closeIdx < 0) {
      test(`${file} has closing --- fence`, () => {
        throw new Error(`No closing --- fence in ${file}`);
      });
      continue;
    }
    const frontmatter = content.slice(4, closeIdx);

    test(`${file} name: equals filename (without .md)`, () => {
      const m = /^name:\s*(\S+)\s*$/m.exec(frontmatter);
      if (!m) throw new Error(`No name: field in ${file} frontmatter`);
      expect(m[1]).toBe(skillName);
    });

    test(`${file} has non-empty description:`, () => {
      const value = readSkillDescription(content, `skills/${file}`);
      expect(value.length).toBeGreaterThan(0);
    });

    test(`${file} description length <=1024`, () => {
      const value = assertSkillDescriptionWithinLimit(content, `skills/${file}`);
      expect(value.length).toBeLessThanOrEqual(1024);
    });

    test(`${file} has allowed-tools: field`, () => {
      expect(/^allowed-tools:/m.test(frontmatter)).toBe(true);
    });
  }

  // In-memory skill text for the shared reader. Parsing stays inside the
  // test callbacks and uses the same validator as the real skill checks.
  describe('description reader fixtures', () => {
    test('plain-inline 1024 UTF-16 units pass <=1024', () => {
      const prose = 'a'.repeat(1024);
      const text = fenced(`name: example\ndescription:  ${prose}  \nallowed-tools: ${'Z'.repeat(80)}`);
      expect(assertSkillDescriptionWithinLimit(text, 'inline-1024.md')).toBe(prose);
    });

    test('plain-inline 1025 UTF-16 units fail <=1024', () => {
      const text = fenced(`name: example\ndescription: ${'a'.repeat(1025)}`);
      const message = thrownMessage(() => assertSkillDescriptionWithinLimit(text, 'inline-1025.md'));
      expect(message).toContain('inline-1025.md');
      expect(message).toContain('1025 UTF-16 code units');
      expect(message).toContain('maximum 1024');
      expect(message).toContain('exceeds the host cap');
      expect(message).toContain('Shorten by at least 1');
      expect(message).toContain('tests/helpers/skill-description.ts');
    });

    test('plain-inline single character passes <=1024', () => {
      const text = fenced('name: example\ndescription:   x  ');
      expect(assertSkillDescriptionWithinLimit(text, 'inline-one.md')).toBe('x');
    });

    test('literal-block 1024 UTF-16 units pass and are not the pipe marker', () => {
      const prose = 'b'.repeat(1024);
      const text = fenced(
        `name: example\ndescription: |\n  ${prose}\nallowed-tools: Read`,
        'Z'.repeat(3000),
      );
      const value = assertSkillDescriptionWithinLimit(text, 'literal-1024.md');
      expect(value).toBe(prose);
      expect(value).not.toBe('|');
    });

    test('literal-block 1025 UTF-16 units fail <=1024', () => {
      const text = fenced(`name: example\ndescription: |\n  ${'b'.repeat(1025)}`);
      const message = thrownMessage(() => assertSkillDescriptionWithinLimit(text, 'literal-1025.md'));
      expect(message).toContain('literal-1025.md');
      expect(message).toContain('1025 UTF-16 code units');
      expect(message).toContain('maximum 1024');
      expect(message).toContain('exceeds the host cap');
      expect(message).toContain('Shorten by at least 1');
      expect(message).toContain('tests/helpers/skill-description.ts');
    });

    test('missing description does not borrow the following field', () => {
      const text = fenced('name: example\nallowed-tools: Read');
      const message = thrownMessage(() => assertSkillDescriptionWithinLimit(text, 'missing.md'));
      expect(message).toContain('missing.md');
      expect(message).toContain('description is missing');
      expect(message).toContain('following field is not treated as the description');
      expect(message).toContain('plain inline');
      expect(message).toContain('description: |');
      expect(message).toContain('tests/helpers/skill-description.ts');
      expect(message).not.toContain('allowed-tools');
    });

    test('empty inline description does not borrow the following field', () => {
      const text = fenced('name: example\ndescription:\n\nallowed-tools: Read');
      const message = thrownMessage(() => assertSkillDescriptionWithinLimit(text, 'empty-inline.md'));
      expect(message).toContain('empty-inline.md');
      expect(message).toContain('description is empty');
      expect(message).toContain('following field is not used as the description');
      expect(message).toContain('plain inline');
      expect(message).toContain('description: |');
      expect(message).toContain('tests/helpers/skill-description.ts');
      expect(message).not.toContain('allowed-tools');
    });

    test.each([
      ['empty literal block', 'empty-literal.md', 'name: example\ndescription: |'],
      ['whitespace-only literal block', 'ws-literal.md', 'name: example\ndescription: |\n  \n   '],
    ])('%s fails', (_name, label, frontmatter) => {
      const message = thrownMessage(() => assertSkillDescriptionWithinLimit(fenced(frontmatter), label));
      expect(message).toContain(label);
      expect(message).toContain('description is empty');
      expect(message).toContain('plain inline');
      expect(message).toContain('description: |');
      expect(message).toContain('tests/helpers/skill-description.ts');
    });

    test('literal text after a blank line counts toward <=1024', () => {
      const prefix = 'p'.repeat(100);
      const tail = 't'.repeat(923);
      const text = fenced(`name: example\ndescription: |\n  ${prefix}\n\n  ${tail}`);
      const value = readSkillDescription(text, 'blank-overflow.md');
      expect(value).toBe(`${prefix}\n\n${tail}`);
      expect(value.length).toBe(1025);
      const message = thrownMessage(() => assertSkillDescriptionWithinLimit(text, 'blank-overflow.md'));
      expect(message).toContain('blank-overflow.md');
      expect(message).toContain('1025 UTF-16 code units');
      expect(message).toContain('Shorten by at least 1');
      expect(message).toContain('tests/helpers/skill-description.ts');
    });

    test('following fields and the markdown body are excluded', () => {
      const huge = 'Z'.repeat(2000);
      const text = fenced(
        [
          'name: example',
          'description: |',
          '  actual prose',
          'notes: |',
          '  description: |',
          `  ${huge}`,
        ].join('\n'),
        `description: ${huge}\n${huge}`,
      );
      expect(assertSkillDescriptionWithinLimit(text, 'isolation.md')).toBe('actual prose');
    });

    test.each([
      ['missing opening fence', 'missing-open.md', 'name: example\ndescription: hi\n---\n'],
      ['opening lookalike ---x', 'open-x.md', '---x\nname: example\ndescription: hi\n---\n'],
      ['opening lookalike ----', 'open-long.md', '----\nname: example\ndescription: hi\n---\n'],
      [
        'missing closing fence',
        'missing-close.md',
        `---\nname: example\ndescription: hi\n${'Z'.repeat(2000)}\n`,
      ],
      ['closing lookalike ---x', 'close-x.md', '---\nname: example\ndescription: hi\n---x\n'],
      ['closing lookalike ----', 'close-long.md', '---\nname: example\ndescription: hi\n----\n'],
    ])('%s fails with a file-specific fence error', (_name, label, text) => {
      const message = thrownMessage(() => assertSkillDescriptionWithinLimit(text, label));
      expect(message).toContain(label);
      expect(message).toContain('malformed frontmatter fence');
      expect(message).toContain('---');
      expect(message).toContain('tests/helpers/skill-description.ts');
      expect(message).not.toContain('UTF-16 code units');
    });

    test.each([
      ['folded >', 'description: >\n  hidden', 'folded scalar (`>`)'],
      ['double-quoted', 'description: "quoted"', 'quoted scalar'],
      ['single-quoted', "description: 'quoted'", 'quoted scalar'],
      ['flow sequence', 'description: [a, b]', 'collection'],
      ['flow mapping', 'description: {a: b}', 'collection'],
      ['tag', 'description: !tag value', 'tag (`!`)'],
      ['anchor', 'description: &anchor value', 'anchor (`&`)'],
      ['alias', 'description: *alias', 'alias (`*`)'],
      ['strip chomp |-', 'description: |-\n  hidden', 'modified literal header `|-`'],
      ['keep chomp |+', 'description: |+\n  hidden', 'modified literal header `|+`'],
      ['explicit indent |2', 'description: |2\n  hidden', 'modified literal header `|2`'],
      ['literal header comment', 'description: | # comment\n  hidden', 'modified literal header `| # comment`'],
      ['block sequence', 'description: - item', 'block sequence (`-`)'],
      ['complex key', 'description: ? key', 'complex key (`?`)'],
      ['reserved @', 'description: @mention', 'reserved indicator (`@`)'],
      ['reserved backtick', 'description: `code` first', 'reserved indicator (`` ` ``)'],
      ['directive %', 'description: %TAG', 'directive indicator (`%`)'],
      ['flow closer ]', 'description: ]foo', 'flow indicator (`]`)'],
      ['flow closer }', 'description: }foo', 'flow indicator (`}`)'],
      ['flow separator ,', 'description: ,foo', 'flow indicator (`,`)'],
      ['mapping indicator', 'description: : value', 'mapping indicator (`:`)'],
    ])('%s is rejected', (name, header, shape) => {
      const label = `${name}.md`;
      const message = thrownMessage(() =>
        assertSkillDescriptionWithinLimit(fenced(`name: example\n${header}`), label),
      );
      expect(message).toContain(label);
      expect(message).toContain(shape);
      expect(message).toContain('plain inline');
      expect(message).toContain('description: |');
      expect(message).toContain('tests/helpers/skill-description.ts');
      expect(message).not.toContain('hidden');
    });

    test('duplicate top-level description rejects a short first value plus an oversized second', () => {
      const text = fenced(`name: example\ndescription: short\ndescription: ${'Z'.repeat(2000)}`);
      const message = thrownMessage(() => assertSkillDescriptionWithinLimit(text, 'dup.md'));
      expect(message).toContain('dup.md');
      expect(message).toContain('duplicate top-level description field');
      expect(message).toContain('tests/helpers/skill-description.ts');
      expect(message).not.toContain('UTF-16 code units');
    });

    test.each([
      ['spaced key', `description : ${'Z'.repeat(2000)}`],
      ['double-quoted key', `"description": ${'Z'.repeat(2000)}`],
      ['single-quoted key', `'description': ${'Z'.repeat(2000)}`],
    ])('duplicate via %s rejects a short first value plus an oversized second', (_name, second) => {
      const text = fenced(`name: example\ndescription: short\n${second}`);
      const message = thrownMessage(() => assertSkillDescriptionWithinLimit(text, 'dup-spelling.md'));
      expect(message).toContain('dup-spelling.md');
      expect(message).toContain('duplicate top-level description field');
      expect(message).not.toContain('UTF-16 code units');
    });

    test.each([
      ['spaced key', 'description : hello'],
      ['double-quoted key', '"description": hello'],
      ['no space after colon', 'description:hello'],
    ])('a single %s is rejected, not read as the description', (_name, line) => {
      const message = thrownMessage(() =>
        assertSkillDescriptionWithinLimit(fenced(`name: example\n${line}`), 'spelling.md'),
      );
      expect(message).toContain('spelling.md');
      expect(message).toContain('unsupported description key spelling');
      expect(message).toContain('`description:` followed by a space');
      expect(message).toContain('tests/helpers/skill-description.ts');
    });

    test.each([
      ['comment only', 'description: # TODO', 'only a `#` comment'],
      ['tilde', 'description: ~', 'value `~` is a YAML null token'],
      ['null', 'description: null', 'value `null` is a YAML null token'],
      ['Null', 'description: Null', 'value `Null` is a YAML null token'],
      ['NULL', 'description: NULL', 'value `NULL` is a YAML null token'],
      ['tilde plus comment', 'description: ~ # TODO', 'value `~` is a YAML null token'],
      ['null plus comment', 'description: null  # fill in', 'value `null` is a YAML null token'],
      ['NULL plus tab comment', 'description: NULL\t#x', 'value `NULL` is a YAML null token'],
    ])('%s value that YAML reads as null is empty', (_name, line, cause) => {
      const message = thrownMessage(() =>
        assertSkillDescriptionWithinLimit(fenced(`name: example\n${line}\nallowed-tools: Read`), 'empty-token.md'),
      );
      expect(message).toContain('empty-token.md');
      expect(message).toContain('description is empty');
      expect(message).toContain(cause);
      expect(message).not.toContain('has no text after trimming whitespace');
      expect(message).toContain('tests/helpers/skill-description.ts');
    });

    test.each([
      ['plain NBSP', `description: ${NBSP}`],
      ['plain ideographic spaces', `description: ${String.fromCodePoint(0x3000).repeat(2)}`],
      ['plain byte-order mark', `description: ${String.fromCodePoint(0xfeff)}`],
      ['literal em space', `description: |\n  ${String.fromCodePoint(0x2003)}`],
    ])('%s is empty, not a one-unit description', (_name, frontmatter) => {
      const message = thrownMessage(() =>
        assertSkillDescriptionWithinLimit(fenced(`name: example\n${frontmatter}`), 'unicode-space.md'),
      );
      expect(message).toContain('unicode-space.md');
      expect(message).toContain('description is empty');
    });

    test.each([
      ['stray text after a literal block', `description: |\n  short\nunindented ${'Z'.repeat(2000)}`],
      ['stray text after a plain value', `description: short\nunindented ${'Z'.repeat(2000)}`],
      ['stray text before the description', 'garbage line\ndescription: short'],
      ['a YAML document-end marker', '...\ndescription: short'],
      ['a column-0 list item', 'description: short\nallowed-tools:\n- Read'],
      ['an escaped key after another field', `description: short\nallowed-tools: Read\n"descrip\\u0074ion": ${'Z'.repeat(2000)}`],
      ['a tagged key after another field', `description: short\nallowed-tools: Read\n!!str description: ${'Z'.repeat(2000)}`],
      ['an anchored key after another field', `description: short\nallowed-tools: Read\n&a description: ${'Z'.repeat(2000)}`],
    ])('%s is rejected', (_name, frontmatter) => {
      const message = thrownMessage(() =>
        assertSkillDescriptionWithinLimit(fenced(`name: example\n${frontmatter}`), 'stray.md'),
      );
      expect(message).toContain('stray.md');
      expect(message).toContain('not a top-level field');
      expect(message).toContain('description: |');
      expect(message).toContain('tests/helpers/skill-description.ts');
      expect(message).not.toContain('UTF-16 code units');
    });

    test('a missing closing fence is reported even when the body has a later --- rule', () => {
      const text = `---\nname: example\ndescription: short\nallowed-tools: Read\n\n# Title\n\nProse line.\n\n---\nmore\n`;
      const message = thrownMessage(() => assertSkillDescriptionWithinLimit(text, 'late-rule.md'));
      expect(message).toContain('late-rule.md');
      expect(message).toContain('Prose line.');
      expect(message).toContain('closing --- fence may be missing');
      expect(message).not.toContain('UTF-16 code units');
    });

    test('an indented line after a column-0 comment that ends a literal block is rejected', () => {
      const text = fenced(`name: example\ndescription: |\n  short\n# note\n  ${'Z'.repeat(2000)}`);
      const message = thrownMessage(() => assertSkillDescriptionWithinLimit(text, 'split.md'));
      expect(message).toContain('split.md');
      expect(message).toContain('literal description is split by a column-0 comment');
      expect(message).not.toContain('UTF-16 code units');
    });

    test('an indented comment after a plain value is a comment, not a continuation', () => {
      const text = fenced('name: example\ndescription: hello\n  # note\nallowed-tools: Read');
      expect(assertSkillDescriptionWithinLimit(text, 'indented-comment.md')).toBe('hello');
    });

    test('a # after whitespace inside literal text stays text', () => {
      const text = fenced('name: example\ndescription: |\n  plan (## In Progress / ## Shipped)\nallowed-tools: Read');
      expect(readSkillDescription(text, 'literal-hash.md')).toBe('plan (## In Progress / ## Shipped)');
    });

    test.each([
      ['a trailing comment', `description: ${'a'.repeat(1000)} # ${'n'.repeat(40)}`],
      ['an issue reference YAML reads as a comment', 'description: Fix issue #12'],
    ])('a plain value with %s is rejected, not measured', (_name, line) => {
      const message = thrownMessage(() =>
        assertSkillDescriptionWithinLimit(fenced(`name: example\n${line}`), 'plain-comment.md'),
      );
      expect(message).toContain('plain-comment.md');
      expect(message).toContain('plain-inline description contains a YAML comment');
      expect(message).toContain('description: |');
      expect(message).not.toContain('UTF-16 code units');
    });

    test.each([
      ['a comment containing LS', `description: # TODO${String.fromCodePoint(0x2028)}`, '2028'],
      ['a null plus comment containing PS', `description: ~ # fill${String.fromCodePoint(0x2029)}in`, '2029'],
      ['NEL', `description: x${String.fromCodePoint(0x85)}`, '0085'],
      ['NUL', `description: ${String.fromCodePoint(0)}Z`, '0000'],
      ['a lone CR', `description: short\rx: ${'Z'.repeat(2000)}`, '000D'],
      ['LS in another field', `description: short\nallowed-tools: Read${String.fromCodePoint(0x2028)}`, '2028'],
    ])('%s in the frontmatter is rejected', (_name, frontmatter, hex) => {
      const message = thrownMessage(() =>
        assertSkillDescriptionWithinLimit(fenced(`name: example\n${frontmatter}`), 'control.md'),
      );
      expect(message).toContain('control.md');
      expect(message).toContain('control or line-separator character');
      expect(message).toContain(`U+${hex}`);
      expect(message).not.toContain('UTF-16 code units');
    });

    test.each([
      ['an indented rule opening the literal', 'description: |\n  ---\n  Real prose.\nallowed-tools: Read'],
      ['an indented rule in an earlier field', 'notes: |\n  ---\ndescription: short'],
      ['a tab-indented rule', 'description: short\nnotes: |\n\t---'],
    ])('%s is rejected as a fence lookalike', (_name, frontmatter) => {
      const message = thrownMessage(() =>
        assertSkillDescriptionWithinLimit(fenced(`name: example\n${frontmatter}`), 'rule.md'),
      );
      expect(message).toContain('rule.md');
      expect(message).toContain('malformed frontmatter fence');
      expect(message).toContain('trims to ---');
    });

    test.each([
      ['a leading indented literal indicator', '  |\ndescription: short\nname: example'],
      ['a leading indented flow sequence', '  [a,\ndescription: short]'],
      ['an indented line after a leading comment', '# c\n  "x\ndescription: short"'],
      [
        'an indented root map hiding a quoted decoy',
        `  notes: "\nname: example\ndescription: short\nallowed-tools: Read\ntail: end"\n  description: ${'Z'.repeat(2000)}\n  name: example`,
      ],
    ])('%s is rejected', (_name, frontmatter) => {
      const message = thrownMessage(() => assertSkillDescriptionWithinLimit(fenced(frontmatter), 'lead.md'));
      expect(message).toContain('lead.md');
      expect(message).toContain('frontmatter starts with an indented line');
      expect(message).toContain('tests/helpers/skill-description.ts');
      expect(message).not.toContain('UTF-16 code units');
    });

    test('a tab-indented description after another field is rejected', () => {
      const text = fenced(`name: example\ndescription: short\nallowed-tools:\n  - Read\n\tdescription: ${'Z'.repeat(2000)}`);
      const message = thrownMessage(() => assertSkillDescriptionWithinLimit(text, 'tab-dup.md'));
      expect(message).toContain('tab-dup.md');
      expect(message).toContain('tab indentation');
      expect(message).not.toContain('UTF-16 code units');
    });

    test('tab indentation is reported before a leading blank line problem', () => {
      const text = fenced('name: example\ndescription: |\n   \n  \thello');
      const message = thrownMessage(() => assertSkillDescriptionWithinLimit(text, 'tab-order.md'));
      expect(message).toContain('tab indentation');
      expect(message).not.toContain('leading blank line');
    });

    test.each([
      ['a quoted value on another field that spans lines', 'allowed-tools: "Read\ndescription: short\nnotes: x"'],
      ['a flow value on another field that spans lines', 'allowed-tools: [Read,\ndescription: short]'],
      ['an anchored flow value that spans lines', 'allowed-tools: &a [Read,\ndescription: short]'],
      ['a tagged quoted value that spans lines', 'allowed-tools: !t "Read\ndescription: short\nnotes: x"'],
      ['a properties-only value before the description', 'k: &a\ndescription: short'],
      ['a single-line quoted value on another field', 'argument-hint: "[id]"\ndescription: short'],
    ])('%s is rejected as an unsupported field value', (_name, frontmatter) => {
      const message = thrownMessage(() =>
        assertSkillDescriptionWithinLimit(fenced(`name: example\n${frontmatter}`), 'field-value.md'),
      );
      expect(message).toContain('field-value.md');
      expect(message).toContain('frontmatter field value starts with a quote, flow collection, tag, or anchor');
      expect(message).toContain('tests/helpers/skill-description.ts');
      expect(message).not.toContain('UTF-16 code units');
    });

    test('a key with a space is named as such, not as a non-field line', () => {
      const text = fenced('name: example\ndescription: short\nargument hint: [id]');
      const message = thrownMessage(() => assertSkillDescriptionWithinLimit(text, 'spaced-key.md'));
      expect(message).toContain('spaced-key.md');
      expect(message).toContain('frontmatter key contains a space');
      expect(message).toContain('"argument hint: [id]"');
      expect(message).not.toContain('not a top-level field');
      expect(message).not.toContain('UTF-16 code units');
    });

    test('an accidentally indented description names the indentation', () => {
      const text = fenced('name: example\n  description: Route reviews.\nallowed-tools: Read');
      const message = thrownMessage(() => assertSkillDescriptionWithinLimit(text, 'indented-desc.md'));
      expect(message).toContain('indented-desc.md');
      expect(message).toContain('description is missing');
      expect(message).toContain('line 3');
      expect(message).toContain('column 0');
    });

    test.each([
      ['NBSP in the literal header', `description: |${NBSP}`, 'modified literal header `|\\u00A0`'],
      ['NBSP in the key separator', `description:${NBSP}hello`, '`description:\\u00A0hello`'],
      ['NBSP in another field', `name2:${NBSP}x\ndescription: hi`, '"name2:\\u00A0x"'],
      ['left-to-right mark in the key separator', `description:${String.fromCodePoint(0x200e)}hello`, '`description:\\u200Ehello`'],
      ['soft hyphen in another field key', `na${String.fromCodePoint(0xad)}me2: x\ndescription: hi`, '"na\\u00ADme2: x"'],
    ])('an invisible %s is shown escaped', (_name, frontmatter, shown) => {
      const message = thrownMessage(() =>
        assertSkillDescriptionWithinLimit(fenced(`name: example\n${frontmatter}`), 'nbsp-echo.md'),
      );
      expect(message).toContain(shown);
    });

    test('an indented --- inside literal text explains both corrections', () => {
      const text = fenced('name: example\ndescription: |\n  Intro text.\n  ---\n  More.');
      const message = thrownMessage(() => assertSkillDescriptionWithinLimit(text, 'rule-text.md'));
      expect(message).toContain('if it is text, reword it');
    });

    test('a byte-order mark before the opening fence is named', () => {
      const text = `${String.fromCodePoint(0xfeff)}---\nname: example\ndescription: hi\n---\n`;
      const message = thrownMessage(() => assertSkillDescriptionWithinLimit(text, 'bom.md'));
      expect(message).toContain('bom.md');
      expect(message).toContain('byte-order mark before the --- fence');
      const noFence = `${String.fromCodePoint(0xfeff)}name: example\n`;
      const noFenceMessage = thrownMessage(() => assertSkillDescriptionWithinLimit(noFence, 'bom-body.md'));
      expect(noFenceMessage).toContain('byte-order mark');
      expect(noFenceMessage).toContain('first line must be exactly ---');
    });

    test('a column-0 comment does not hide a plain-inline continuation', () => {
      const text = fenced(`name: example\ndescription: short\n#\n  ${'Z'.repeat(2000)}`);
      const message = thrownMessage(() => assertSkillDescriptionWithinLimit(text, 'comment-cont.md'));
      expect(message).toContain('comment-cont.md');
      expect(message).toContain('indented continuation');
      expect(message).not.toContain('UTF-16 code units');
    });

    test.each([
      ['literal', 'description: |\n  hello\n# note\nallowed-tools: Read'],
      ['plain', 'description: hello\n# note\n\nallowed-tools: Read'],
    ])('a column-0 comment before the next field is allowed after a %s value', (_name, frontmatter) => {
      expect(assertSkillDescriptionWithinLimit(fenced(`name: example\n${frontmatter}`), 'comment.md')).toBe('hello');
    });

    test('an indented description line inside literal text stays text', () => {
      const text = fenced('name: example\ndescription: |\n  keep this\n  description: still the description');
      expect(readSkillDescription(text, 'nested-desc.md')).toBe('keep this\ndescription: still the description');
    });

    test('plain-inline indented continuation is rejected', () => {
      const text = fenced('name: example\ndescription: hello\n  world');
      const message = thrownMessage(() => assertSkillDescriptionWithinLimit(text, 'cont.md'));
      expect(message).toContain('cont.md');
      expect(message).toContain('indented continuation');
      expect(message).toContain('description: |');
      expect(message).toContain('tests/helpers/skill-description.ts');
    });

    test('plain-inline continuation after blank lines is rejected', () => {
      const text = fenced(`name: example\ndescription: short\n\n  ${'Z'.repeat(2000)}`);
      const message = thrownMessage(() => assertSkillDescriptionWithinLimit(text, 'cont-blank.md'));
      expect(message).toContain('cont-blank.md');
      expect(message).toContain('indented continuation');
      expect(message).toContain('blank lines');
      expect(message).toContain('tests/helpers/skill-description.ts');
      expect(message).not.toContain('UTF-16 code units');
    });

    test('plain-inline may be followed by a top-level field', () => {
      const text = fenced('name: example\ndescription: hello\n\nallowed-tools: Read');
      expect(assertSkillDescriptionWithinLimit(text, 'next-field.md')).toBe('hello');
    });

    test('literal indent follows the first nonblank line and keeps extra spaces', () => {
      const text = fenced('name: example\ndescription: |\n\n    hello\n      world\n\n    tail\n');
      expect(readSkillDescription(text, 'indent.md')).toBe('hello\n  world\n\ntail');
    });

    test('whitespace-only literal lines keep whitespace past the indent', () => {
      const text = fenced(`name: example\ndescription: |\n  a\n${' '.repeat(1025)}\n\n  b`);
      const value = readSkillDescription(text, 'ws-line.md');
      expect(value).toBe(`a\n${' '.repeat(1023)}\n\nb`);
      expect(value.length).toBe(1028);
      const message = thrownMessage(() => assertSkillDescriptionWithinLimit(text, 'ws-line.md'));
      expect(message).toContain('1028 UTF-16 code units');
      expect(message).toContain('Shorten by at least 4');
    });

    test('a leading blank literal line deeper than the first content line is rejected', () => {
      const text = fenced('name: example\ndescription: |\n      \n  hello');
      const message = thrownMessage(() => assertSkillDescriptionWithinLimit(text, 'lead-ws.md'));
      expect(message).toContain('lead-ws.md');
      expect(message).toContain('leading blank line');
      expect(message).toContain('2 spaces');
    });

    test('a tab in a whitespace-only literal line is rejected', () => {
      const text = fenced('name: example\ndescription: |\n  hello\n  \t\n  world');
      const message = thrownMessage(() => assertSkillDescriptionWithinLimit(text, 'tab-blank.md'));
      expect(message).toContain('tab-blank.md');
      expect(message).toContain('literal description uses tab indentation');
    });

    test('outer trim removes only YAML whitespace, so NBSP still counts', () => {
      const text = fenced(`name: example\ndescription: x${NBSP.repeat(1024)}`);
      const message = thrownMessage(() => assertSkillDescriptionWithinLimit(text, 'nbsp.md'));
      expect(message).toContain('nbsp.md');
      expect(message).toContain('1025 UTF-16 code units');
      const literal = fenced(`name: example\ndescription: |\n  x\n  ${NBSP.repeat(1024)}`);
      expect(readSkillDescription(literal, 'nbsp-literal.md').length).toBe(1026);
    });

    test('literal partial dedent is rejected', () => {
      const text = fenced('name: example\ndescription: |\n    hello\n   world');
      const message = thrownMessage(() => assertSkillDescriptionWithinLimit(text, 'dedent.md'));
      expect(message).toContain('dedent.md');
      expect(message).toContain('less indented than the first content line');
      expect(message).toContain('4 spaces');
      expect(message).toContain('tests/helpers/skill-description.ts');
    });

    test('literal tab indentation is rejected', () => {
      const text = fenced('name: example\ndescription: |\n  \thello');
      const message = thrownMessage(() => assertSkillDescriptionWithinLimit(text, 'tab.md'));
      expect(message).toContain('tab.md');
      expect(message).toContain('literal description uses tab indentation');
      expect(message).toContain('spaces');
      expect(message).toContain('tests/helpers/skill-description.ts');
      const later = fenced('name: example\ndescription: |\n  hello\n  \tworld');
      const laterMessage = thrownMessage(() => assertSkillDescriptionWithinLimit(later, 'tab-later.md'));
      expect(laterMessage).toContain('tab-later.md');
      expect(laterMessage).toContain('literal description uses tab indentation');
    });

    test('a column-0 tab inside a literal block is a tab-indented frontmatter line', () => {
      const text = fenced('name: example\ndescription: |\n  hello\n\tworld');
      const message = thrownMessage(() => assertSkillDescriptionWithinLimit(text, 'tab-col0.md'));
      expect(message).toContain('tab-col0.md');
      expect(message).toContain('frontmatter line uses tab indentation');
    });

    test('CRLF skill text matches LF after normalization', () => {
      const lf = fenced('name: example\ndescription: |\n  hello\n\n  world');
      const crlf = lf.replace(/\n/g, '\r\n');
      expect(assertSkillDescriptionWithinLimit(crlf, 'crlf.md')).toBe('hello\n\nworld');
      expect(assertSkillDescriptionWithinLimit(crlf, 'crlf.md')).toBe(
        assertSkillDescriptionWithinLimit(lf, 'lf.md'),
      );
    });

    test('a supplementary Unicode character counts as two UTF-16 code units', () => {
      const astral = '\u{1F642}';
      expect(astral.length).toBe(2);
      const within = astral.repeat(512);
      expect(within.length).toBe(1024);
      const pass = fenced(`name: example\ndescription: ${within}`);
      expect(assertSkillDescriptionWithinLimit(pass, 'unicode.md')).toBe(within);
      const over = fenced(`name: example\ndescription: ${within}x`);
      const message = thrownMessage(() => assertSkillDescriptionWithinLimit(over, 'unicode-over.md'));
      expect(message).toContain('unicode-over.md');
      expect(message).toContain('1025 UTF-16 code units');
      expect(message).toContain('maximum 1024');
      expect(message).toContain('Shorten by at least 1');
    });
  });
});

// ─── (B) setup ↔ skills/*.md symmetric ───────────────────────────────

describe('(B) setup ↔ skills/*.md symmetric', () => {
  const setupText = readFileSync(SETUP_FILE, 'utf8');
  const setupSkills = parseSetupSkills(setupText);
  const fileSkills = SKILL_FILES.map((f) => f.replace(/\.md$/, ''));

  test('every skill in setup SKILLS array has a corresponding skills/*.md', () => {
    const orphans = setupSkills.filter((s) => !fileSkills.includes(s));
    if (orphans.length > 0) {
      throw new Error(
        `setup SKILLS array references skill(s) with no skills/*.md file: ${orphans.join(', ')}`,
      );
    }
  });

  test('every skills/*.md is listed in setup SKILLS array', () => {
    const orphans = fileSkills.filter((s) => !setupSkills.includes(s));
    if (orphans.length > 0) {
      throw new Error(
        `skills/*.md file(s) not registered in setup SKILLS array: ${orphans.join(', ')}`,
      );
    }
  });
});

// ─── (C) Source-tag registry consistency ─────────────────────────────

function parseContractSources(contractText: string): string[] {
  // The grammar bullet looks like:
  //   - `<source>` is the originating skill: `pair-review`, `full-review`,
  //     `review`, ..., `discovered`.
  // Capture everything from that bullet until the next blank line, then
  // extract backtick-quoted lowercase identifiers (which excludes the
  // `<source>` placeholder — angle brackets won't match [a-z-]+).
  const m = /^- `<source>` is the originating skill:([\s\S]*?)(?:\n\n|\n- )/m.exec(contractText);
  if (!m || !m[1]) {
    throw new Error('source grammar bullet not found in docs/source-tag-contract.md');
  }
  const tokens = m[1].match(/`([a-z][a-z-]*)`/g) ?? [];
  return tokens.map((t) => t.replace(/`/g, ''));
}

describe('(C) source-tag registry consistency', () => {
  const contractText = readFileSync(CONTRACT_FILE, 'utf8');
  const contractSources = new Set(parseContractSources(contractText));
  const codeSources = REGISTERED_SOURCES;

  test('docs/source-tag-contract.md grammar list matches REGISTERED_SOURCES', () => {
    const inDocsNotCode = [...contractSources].filter((s) => !codeSources.has(s)).sort();
    const inCodeNotDocs = [...codeSources].filter((s) => !contractSources.has(s)).sort();
    if (inDocsNotCode.length > 0 || inCodeNotDocs.length > 0) {
      const lines: string[] = [];
      if (inCodeNotDocs.length > 0) {
        lines.push(`In code, missing from docs/source-tag-contract.md: ${inCodeNotDocs.join(', ')}`);
      }
      if (inDocsNotCode.length > 0) {
        lines.push(`In docs/source-tag-contract.md, missing from code: ${inDocsNotCode.join(', ')}`);
      }
      throw new Error(lines.join('\n'));
    }
    expect(contractSources.size).toBe(codeSources.size);
  });
});

const TAXONOMY_HEADING = '### Severity taxonomy (full-review)';
const GRAMMAR_HEADING = '## Item grammar';
const KEYS_HEADING = '### Defined keys';
const FORMAT_FIELDS = ['FILE', 'LINE', 'SEVERITY', 'DESCRIPTION', 'HYPOTHESIS'];
const FINDING_NAMES = new Set(['file', 'line', 'severity', 'description', 'hypothesis']);

function vocabError(skill: string, index: number, matched: string, expected: string, source: string): string {
  const line = skill.slice(0, Math.max(0, index)).split('\n').length;
  const shown = matched.replace(/\s+/g, ' ').trim().slice(0, 160);
  return `skills/full-review.md:${line}: matched ${JSON.stringify(shown)}; expected ${expected}; source: ${source}`;
}

function sectionFrom(text: string, heading: string, next: RegExp): string {
  const start = text.indexOf(heading);
  if (start < 0) return '';
  const rest = text.slice(start + heading.length);
  const end = next.exec(rest);
  return text.slice(start, start + heading.length + (end?.index ?? rest.length));
}

function contractSeverities(contract: string): string[] {
  const section = sectionFrom(contract, TAXONOMY_HEADING, /\n## /);
  return [...section.matchAll(/^- \*\*([a-z-]+)\*\*/gm)].map((match) => match[1]!);
}

function grammarFields(contract: string): Array<{ name: string; scopes: string[] | null }> {
  const start = contract.indexOf(GRAMMAR_HEADING);
  const fence = /```[^\n]*\n([\s\S]*?)```/.exec(contract.slice(start));
  const fields: Array<{ name: string; scopes: string[] | null }> = [];
  if (!fence) return fields;
  for (const line of (fence[1] ?? '').split('\n')) {
    const bullet = /^- \*\*(.+?):\*\*(.*)$/.exec(line);
    if (!bullet) continue;
    const paren = /\(([^()]*)\)\s*$/.exec(bullet[2] ?? '');
    let scopes: string[] | null = null;
    if (paren) {
      const items = paren[1]!.split(',').map((item) => item.trim()).filter(Boolean);
      if (items.length > 0 && items.every((item) => REGISTERED_SOURCES.has(item))) scopes = items;
    }
    fields.push({ name: bullet[1]!, scopes });
  }
  return fields;
}

function throughLine(text: string, start: string, endPrefix: string): string | null {
  const at = text.indexOf(start);
  if (at < 0) return null;
  const lines = text.slice(at).split('\n');
  const end = lines.findIndex((line) => line.startsWith(endPrefix));
  if (end < 0) return null;
  return lines.slice(0, end + 1).join('\n');
}

function agentPrompts(skill: string): Array<{ index: number; body: string }> {
  const marks = [...skill.matchAll(/^#### Agent \d+:.*$/gm)];
  const step3 = skill.indexOf('\n### Step 3: Validate agent outputs');
  return marks.map((mark, i) => {
    const start = mark.index ?? 0;
    const next = i + 1 < marks.length ? (marks[i + 1]!.index ?? skill.length) : skill.length;
    const end = step3 > start && step3 < next ? step3 : next;
    return { index: start, body: skill.slice(start, end) };
  });
}

function templateFields(skill: string): Array<{ name: string; index: number }> {
  const re = /```markdown\n([\s\S]*?)```/g;
  let fence: RegExpExecArray | null;
  while ((fence = re.exec(skill))) {
    const body = fence[1] ?? '';
    if (!body.includes('- **Hypothesis (untested):**')) continue;
    const base = fence.index + '```markdown\n'.length;
    const fields: Array<{ name: string; index: number }> = [];
    for (const bullet of body.matchAll(/^- \*\*(.+?):\*\*/gm)) {
      fields.push({ name: bullet[1]!, index: base + (bullet.index ?? 0) });
    }
    return fields;
  }
  return [];
}

function filesRuleParagraph(skill: string): { text: string; index: number } | null {
  const at = skill.indexOf('files=<path>');
  if (at < 0) return null;
  const close = skill.indexOf('\n```', at);
  if (close < 0) return null;
  const after = skill.indexOf('\n', close + 1);
  if (after < 0) return null;
  const lines = skill.slice(after + 1).split('\n');
  let skip = 0;
  while (skip < lines.length && lines[skip]!.trim() === '') skip++;
  const para: string[] = [];
  for (let i = skip; i < lines.length; i++) {
    if (lines[i]!.trim() === '') break;
    para.push(lines[i]!);
  }
  const text = para.join('\n');
  if (!text) return null;
  return { text, index: skill.indexOf(text, after) };
}

function severityLists(skill: string, severities: string[]): {
  slash: number;
  gt: number;
  order: number;
  errors: string[];
} {
  const expected = severities.filter((name) => name !== 'edge-case');
  const errors: string[] = [];
  let slash = 0;
  let gt = 0;
  let order = 0;
  const keep = (items: string[]) =>
    items.every((item) => /^[a-z-]+$/.test(item)) && items.some((item) => severities.includes(item));
  for (const match of skill.matchAll(/\(([^()\n]+)\)/g)) {
    const inner = match[1] ?? '';
    const kind = inner.includes('/') ? 'slash' : inner.includes('>') ? 'gt' : '';
    if (!kind) continue;
    const items = inner.split(kind === 'slash' ? '/' : '>').map((item) => item.trim());
    if (!keep(items)) continue;
    if (kind === 'slash') slash++;
    else gt++;
    if (items.join('\0') !== expected.join('\0')) {
      errors.push(
        vocabError(skill, match.index ?? 0, inner, expected.join(', '), TAXONOMY_HEADING),
      );
    }
  }
  const orderRe =
    /\b([a-z-]+)(?:[ \t]+[a-z-]+)?[ \t\n]+first,[ \t\n]+then[ \t\n]+([a-z-]+),[ \t\n]+then[ \t\n]+([a-z-]+)\b/g;
  for (const match of skill.matchAll(orderRe)) {
    const items = [match[1]!, match[2]!, match[3]!];
    if (!keep(items)) continue;
    order++;
    if (items.join('\0') !== expected.join('\0')) {
      errors.push(vocabError(skill, match.index ?? 0, match[0], expected.join(', '), TAXONOMY_HEADING));
    }
  }
  if (slash < 1) {
    errors.push(vocabError(skill, 0, '(none)', 'at least one parenthesized / severity list', TAXONOMY_HEADING));
  }
  if (gt < 1) {
    errors.push(vocabError(skill, 0, '(none)', 'at least one parenthesized > severity list', TAXONOMY_HEADING));
  }
  if (order < 1) {
    errors.push(vocabError(skill, 0, '(none)', 'at least one "first, then, then" severity list', TAXONOMY_HEADING));
  }
  return { slash, gt, order, errors };
}

function fullReviewVocabErrors(skill: string, contract: string): string[] {
  const errors: string[] = [];
  const severities = contractSeverities(contract);
  const prompts = agentPrompts(skill);
  if (prompts.length !== 3) {
    errors.push(vocabError(skill, prompts[3]?.index ?? 0, `${prompts.length} agent prompts`, 'exactly 3', 'test-owned'));
  }
  const heads: string[] = [];
  const tails: string[] = [];
  for (const prompt of prompts) {
    const head = throughLine(prompt.body, '> Shell Rules:', '> Hot areas');
    const tail = throughLine(
      prompt.body,
      '> Your hypothesis is a starting point',
      '> If you find no issues, output: NO_FINDINGS',
    );
    if (head === null || tail === null) {
      errors.push(vocabError(skill, prompt.index, prompt.body.slice(0, 80), 'prompt head and tail', 'test-owned'));
      continue;
    }
    heads.push(head);
    tails.push(tail);
    const alternatives = /SEVERITY: <([^>\n]+)>/.exec(prompt.body);
    const altNames = alternatives?.[1]?.split('|').map((name) => name.trim()) ?? [];
    if (altNames.join('\0') !== severities.join('\0')) {
      const at = prompt.body.indexOf('SEVERITY: <');
      errors.push(
        vocabError(skill, prompt.index + Math.max(0, at), altNames.join('|'), severities.join(', '), TAXONOMY_HEADING),
      );
    }
    const semantics = [...prompt.body.matchAll(/^>\s+([a-z-]+)\s+\u2014/gm)].map((match) => match[1]!);
    if (semantics.join('\0') !== severities.join('\0')) {
      errors.push(
        vocabError(skill, prompt.index, semantics.join(', '), severities.join(', '), TAXONOMY_HEADING),
      );
    }
    const formatLine = prompt.body.split('\n').find((line) => line.includes('FILE:') && line.includes('HYPOTHESIS:'));
    const fields = formatLine ? [...formatLine.matchAll(/\b([A-Z]+):/g)].map((match) => match[1]!) : [];
    if (fields.join('\0') !== FORMAT_FIELDS.join('\0')) {
      errors.push(
        vocabError(skill, prompt.index, fields.join(', '), FORMAT_FIELDS.join(', '), 'test-owned'),
      );
    }
  }
  if (heads.length === prompts.length && heads.some((head) => head !== heads[0])) {
    errors.push(vocabError(skill, prompts[1]?.index ?? 0, 'agent prompt heads', 'byte-identical heads', 'test-owned'));
  }
  if (tails.length === prompts.length && tails.some((tail) => tail !== tails[0])) {
    errors.push(vocabError(skill, prompts[1]?.index ?? 0, 'agent prompt tails', 'byte-identical tails', 'test-owned'));
  }

  errors.push(...severityLists(skill, severities).errors);

  const grammar = grammarFields(contract);
  const required = grammar.filter((field) => field.scopes?.includes('full-review')).map((field) => field.name);
  const forbidden = new Set(
    grammar.filter((field) => field.scopes !== null && !field.scopes.includes('full-review')).map((field) => field.name),
  );
  const template = templateFields(skill);
  const templateNames = new Set(template.map((field) => field.name));
  const templateAt = template[0]?.index ?? skill.indexOf('```markdown');
  for (const name of required) {
    if (!templateNames.has(name)) {
      errors.push(vocabError(skill, templateAt, template.map((field) => field.name).join(', '), name, GRAMMAR_HEADING));
    }
  }
  for (const field of template) {
    if (forbidden.has(field.name)) {
      errors.push(
        vocabError(skill, field.index, field.name, 'no field scoped only to other sources', GRAMMAR_HEADING),
      );
    }
  }
  if (!required.includes('Description') || !required.includes('Hypothesis (untested)')) {
    const formatAt = skill.indexOf('DESCRIPTION:');
    errors.push(
      vocabError(skill, Math.max(0, formatAt), 'DESCRIPTION / HYPOTHESIS', 'Description and Hypothesis (untested)', GRAMMAR_HEADING),
    );
  }
  const keys = sectionFrom(contract, KEYS_HEADING, /\n### /);
  if (!keys.split('\n').some((line) => line.includes('`severity`') && line.includes('full-review'))) {
    errors.push(vocabError(skill, Math.max(0, skill.indexOf('SEVERITY:')), 'SEVERITY', 'severity key', KEYS_HEADING));
  }

  for (const match of skill.matchAll(/findings with ([^.\n]+)/gi)) {
    const items = (match[1] ?? '').split(',').map((item) => item.trim()).filter(Boolean);
    if (items.length < 3) continue;
    const bad = items.filter((item) => !FINDING_NAMES.has(item.toLowerCase()));
    if (bad.length > 0) {
      errors.push(
        vocabError(skill, match.index ?? 0, items.join(', '), FORMAT_FIELDS.join(', '), 'test-owned'),
      );
    }
  }

  const paragraph = filesRuleParagraph(skill);
  const tokens = ['`[`', '`]`', '`,`', '`;`', '`|`', 'a backtick', '`$(`'];
  if (!paragraph) {
    errors.push(vocabError(skill, 0, '(none)', tokens.join(' '), 'test-owned'));
  } else {
    const missing = tokens.filter((token) => !paragraph.text.includes(token));
    if (missing.length > 0) {
      errors.push(vocabError(skill, paragraph.index, paragraph.text, missing.join(' '), 'test-owned'));
    }
  }

  const headings = [
    '### [full-review:<severity>] <finding title>',
    '### [full-review:<severity>,files=<path>] <finding title>',
  ];
  for (const heading of headings) {
    const at = skill.indexOf(heading);
    if (at < 0) {
      errors.push(vocabError(skill, 0, '(none)', heading, 'test-owned'));
      continue;
    }
    const substituted = heading.replaceAll('<severity>', 'critical').replaceAll('<path>', 'src/a.ts');
    const tag = /\[[^\[\]]+\]/.exec(substituted)?.[0] ?? '';
    const result = validateTagExpression(tag);
    if (!result.ok) {
      errors.push(vocabError(skill, at, tag, 'validateTagExpression ok', 'test-owned'));
    }
  }
  return errors;
}

function replaceNth(haystack: string, needle: string, replacement: string, nth: number): string {
  let from = 0;
  for (let seen = 1; seen <= nth; seen++) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) throw new Error(`missing occurrence ${seen} of ${needle}`);
    if (seen === nth) return haystack.slice(0, at) + replacement + haystack.slice(at + needle.length);
    from = at + needle.length;
  }
  return haystack;
}

describe('(D) /full-review vocabulary matches the source-tag contract', () => {
  const skill = readFileSync(join(SKILLS_DIR, 'full-review.md'), 'utf8');
  const contract = readFileSync(CONTRACT_FILE, 'utf8');

  test('the real skill has no vocabulary errors', () => {
    expect(fullReviewVocabErrors(skill, contract)).toEqual([]);
  });

  test.each(['`[`', '`]`', '`,`', '`;`', '`|`', 'a backtick', '`$(`'])(
    'requires every named unsafe character: %s',
    (token) => {
      const paragraph = filesRuleParagraph(skill)!;
      expect(paragraph.text).toContain(token);
      const mutated = skill.replace(paragraph.text, paragraph.text.replaceAll(token, ''));
      expect(mutated).not.toBe(skill);
      expect(fullReviewVocabErrors(mutated, contract).length).toBeGreaterThan(0);
    },
  );

  test('mutations fail and one error names a line and its source', () => {
    const rows = [
      {
        target: 'then necessary, then nice-to-have',
        apply: (text: string) => text.replace('then necessary, then nice-to-have', 'then important, then minor'),
      },
      {
        target: '> Frame it as one possible direction; the implementer will re-verify the',
        apply: (text: string) =>
          replaceNth(
            text,
            '> Frame it as one possible direction; the implementer will re-verify the',
            '> Frame it as one possible direction; the implementer will re-verify the changed',
            2,
          ),
      },
      {
        target: '- **Description:**',
        apply: (text: string) => text.replace('- **Description:**', '- **Why:**'),
      },
    ];
    let namedSource = false;
    for (const row of rows) {
      expect(skill).toContain(row.target);
      const errors = fullReviewVocabErrors(row.apply(skill), contract);
      expect(errors.length).toBeGreaterThan(0);
      if (errors.some((error) => /:\d+:/.test(error) && error.includes('source: ## Item grammar'))) {
        namedSource = true;
      }
    }
    expect(namedSource).toBe(true);
  });

  test('order sentences and durations that are not severities stay quiet', () => {
    const reviewer = `${skill}\nrun the reviewer first, then hygiene, then consistency\n`;
    const duration = `${skill}\n(24h/48h/1 week)\n`;
    const owner = skill.replace(
      '- **Effort:** ? (user triages in /roadmap)',
      '- **Effort:** ? (user triages in /roadmap)\n- **Owner:** someone',
    );
    expect(fullReviewVocabErrors(reviewer, contract)).toEqual([]);
    expect(fullReviewVocabErrors(duration, contract)).toEqual([]);
    expect(owner).not.toBe(skill);
    expect(fullReviewVocabErrors(owner, contract)).toEqual([]);
  });

  test('validateTagExpression accepts the template shapes and rejects unsafe paths', () => {
    expect(validateTagExpression('[full-review:critical]').ok).toBe(true);
    expect(validateTagExpression('[full-review:critical,files=src/a.ts]').ok).toBe(true);
    expect(validateTagExpression('[full-review:critical,files=app/[id]/page.tsx]').ok).toBe(false);
    expect(validateTagExpression('[full-review:critical,files=src/`id`.ts]').ok).toBe(false);
    expect(validateTagExpression('[full-review:critical,files=src/$(id).ts]').ok).toBe(false);
  });
});
