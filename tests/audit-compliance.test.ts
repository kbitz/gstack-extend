/**
 * audit-compliance.test.ts — structural invariants for gstack-extend.
 *
 * Three describes:
 *   (A) Frontmatter sanity — every skills/*.md has --- fence, matching
 *       name:, description:, allowed-tools:.
 *   (B) setup ↔ skills/*.md symmetric — every name in setup's SKILLS array
 *       has a skills/*.md, and every skills/*.md is in SKILLS.
 *   (C) Source-tag registry consistency — REGISTERED_SOURCES from
 *       src/audit/lib/source-tag.ts matches the grammar list in
 *       docs/source-tag-contract.md exactly.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REGISTERED_SOURCES } from '../src/audit/lib/source-tag.ts';

const ROOT = join(import.meta.dir, '..');
const SKILLS_DIR = join(ROOT, 'skills');
const SETUP_FILE = join(ROOT, 'setup');
const CONTRACT_FILE = join(ROOT, 'docs', 'source-tag-contract.md');

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

    // Frontmatter is everything between the opening `---` and the next `---`
    // on its own line. Pull it once for the field assertions below.
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
      // description: may be a single-line string OR a YAML literal block
      // (`description: |` followed by indented prose). Both are valid; the
      // assertion is "the field exists and has non-empty content."
      const inline = /^description:\s*(\S.*)$/m.exec(frontmatter);
      const block = /^description:\s*\|\s*\n((?:[ \t]+\S.*\n?)+)/m.exec(frontmatter);
      const value = inline ? inline[1]?.trim() : block ? block[1]?.trim() : undefined;
      if (!value) throw new Error(`Missing or empty description: in ${file}`);
      expect(value.length).toBeGreaterThan(0);
    });

    test(`${file} has allowed-tools: field`, () => {
      expect(/^allowed-tools:/m.test(frontmatter)).toBe(true);
    });
  }
});

// ─── (B) setup ↔ skills/*.md symmetric ───────────────────────────────

function parseSetupSkills(setupText: string): string[] {
  // The SKILLS bash array is declared as:
  //   SKILLS=(
  //     pair-review
  //     roadmap
  //     ...
  //   )
  // Capture the body, then collect non-empty/non-comment whitespace-separated
  // tokens. This is intentionally regex-only (no bash parser): the locked plan
  // calls out "parse setup as text via regex" per codex.
  const m = /^SKILLS=\(\s*\n([\s\S]*?)\n\s*\)\s*$/m.exec(setupText);
  if (!m || !m[1]) throw new Error('SKILLS=( ... ) array not found in setup');
  return m[1]
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter((line) => line.length > 0);
}

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
