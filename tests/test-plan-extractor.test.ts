/**
 * test-plan-extractor.test.ts — contract-only validation of the
 * /test-plan item-extractor prompt in skills/test-plan.md.
 *
 * The extractor runs inside a live Claude session (Agent subagent or
 * inline LLM reasoning), not as a standalone binary. So this file does
 * one CI-tractable thing: verify the skill file's extractor prompt
 * contract is intact (required output fields, required rules, JSON shape).
 *
 * Output-quality validation (the `--score` mode of the bash original) is
 * a developer harness, not a CI test. It moved to `scripts/score-extractor.ts`
 * per D2 / Issue 1B. Run that against a captured extractor JSON output
 * to check >=70% tolerant match against vendored fixtures.
 *
 * Migrated from scripts/test-test-plan-extractor.sh (deleted in Track 3A).
 */

import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const SKILL_FILE = join(ROOT, 'skills', 'test-plan.md');

describe('extractor prompt contract', () => {
  let content: string;

  test('skills/test-plan.md exists', () => {
    expect(existsSync(SKILL_FILE)).toBe(true);
    content = readFileSync(SKILL_FILE, 'utf8');
    expect(content.length).toBeGreaterThan(0);
  });

  // The extractor prompt must document every required output field. If
  // any drift, downstream code (dedup by ID, classification, provenance
  // index) breaks.

  const REQUIRED_FIELDS = [
    'description: string',
    'imperative verb',
    'source_type',
    'rationale_quote',
    'section_heading',
    'classification_signal',
  ];

  for (const fld of REQUIRED_FIELDS) {
    test(`prompt documents field: ${fld}`, () => {
      const c = readFileSync(SKILL_FILE, 'utf8');
      expect(c).toContain(fld);
    });
  }

  const REQUIRED_SOURCE_TYPES = [
    '"ceo-review"',
    '"eng-review"',
    '"design-review"',
    '"design-doc"',
  ];

  for (const st of REQUIRED_SOURCE_TYPES) {
    test(`prompt declares source_type: ${st}`, () => {
      const c = readFileSync(SKILL_FILE, 'utf8');
      expect(c).toContain(st);
    });
  }

  const REQUIRED_RULES = [
    'Extract EVERY claim',
    'testable',
    'rationale_quote MUST be a real snippet',
    'No duplicates within a single doc',
    'Output ONLY the JSON array',
  ];

  for (const rule of REQUIRED_RULES) {
    test(`prompt asserts rule: ${rule}`, () => {
      const c = readFileSync(SKILL_FILE, 'utf8');
      expect(c).toContain(rule);
    });
  }

  test('retry-on-invalid-JSON behavior documented', () => {
    const c = readFileSync(SKILL_FILE, 'utf8');
    expect(/retry once|Previous response was not valid JSON/.test(c)).toBe(true);
  });

  test('prompt includes worked example (Input excerpt + Output)', () => {
    const c = readFileSync(SKILL_FILE, 'utf8');
    expect(c).toContain('Example:');
    expect(c).toContain('Input excerpt:');
    expect(c).toContain('Output:');
  });
});

describe('vendored extractor corpus (post-D6 / Issue 2A)', () => {
  // The bash version referenced $HOME-relative fixture paths that only
  // existed on kb's machine. D6 chose to vendor the docs into
  // tests/fixtures/extractor-corpus/. Verify they exist (the actual
  // scoring lives in scripts/score-extractor.ts).
  const corpusDir = join(ROOT, 'tests', 'fixtures', 'extractor-corpus');

  test('corpus directory exists', () => {
    expect(existsSync(corpusDir)).toBe(true);
  });

  test('at least 2 fixture markdown files present', () => {
    let entries: string[];
    try {
      entries = readdirSync(corpusDir);
    } catch {
      entries = [];
    }
    const mds = entries.filter((n) => n.endsWith('.md'));
    expect(mds.length).toBeGreaterThanOrEqual(2);
  });
});
