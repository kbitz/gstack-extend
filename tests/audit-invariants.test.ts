/**
 * audit-invariants.test.ts — structural-invariants safety net.
 *
 * Walks every `tests/roadmap-audit/<fixture>/expected.txt` and asserts:
 *
 *   1. Every `## SECTION` heading has a `STATUS:` line within its body
 *      (exception: MODE has DETECTED/REASON instead, by contract).
 *   2. Each STATUS value is in the canonical set
 *      (pass/fail/warn/info/skip/found/none — see CANONICAL_STATUSES).
 *   3. MODE is the last canonical section.
 *   4. Section order matches CANONICAL_SECTIONS (fixture-lock invariant).
 *
 * D12 cross-model resolution: the canonical list is owned by
 * src/audit/sections.ts (a side-effect-free spec module). This test
 * imports it AND verifies every fixture's section order matches —
 * closing codex's "test would bless wrong implementation" concern.
 *
 * Why: catches rubber-stamp `UPDATE_SNAPSHOTS=1` runs that pass the
 * snapshot suite but silently drop a section or scramble order. The
 * snapshot suite by itself only diffs against a stale expected.txt;
 * if the dropper also updates snapshots, no test fires.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  CANONICAL_SECTIONS,
  CANONICAL_STATUSES,
  OPTIONAL_SECTIONS,
  parseAuditSections,
} from '../src/audit/sections.ts';

const ROOT = join(import.meta.dir, '..');
const FIXTURES_DIR = join(ROOT, 'tests', 'roadmap-audit');

const STATUS_RE = /^STATUS:\s*([a-z]+)\s*$/;
const CANONICAL_SET = new Set<string>(CANONICAL_SECTIONS);
const OPTIONAL_SET = new Set<string>(OPTIONAL_SECTIONS);
const STATUS_SET = new Set<string>(CANONICAL_STATUSES);

const parseSections = parseAuditSections;

function listFixtures(): string[] {
  return readdirSync(FIXTURES_DIR)
    .filter((n) => statSync(join(FIXTURES_DIR, n)).isDirectory())
    .sort();
}

describe('audit output structural invariants', () => {
  for (const name of listFixtures()) {
    const expectedPath = join(FIXTURES_DIR, name, 'expected.txt');
    let text: string;
    try {
      text = readFileSync(expectedPath, 'utf8');
    } catch {
      // Fixture may not have a snapshot yet (new fixture, pre-seed). Skip.
      continue;
    }
    const sections = parseSections(text);

    test(`${name}: every section has a STATUS line (or is MODE)`, () => {
      for (const s of sections) {
        if (s.name === 'MODE') {
          // MODE is special: emits DETECTED/REASON instead of STATUS.
          expect(s.body.some((l) => l.startsWith('DETECTED:'))).toBe(true);
          continue;
        }
        const hasStatus = s.body.some((l) => STATUS_RE.test(l));
        if (!hasStatus) {
          throw new Error(
            `[${name}] section ${s.name} has no STATUS line`,
          );
        }
      }
    });

    test(`${name}: every STATUS value is in CANONICAL_STATUSES`, () => {
      for (const s of sections) {
        if (s.name === 'MODE') continue;
        for (const line of s.body) {
          const sm = STATUS_RE.exec(line);
          if (sm === null) continue;
          const status = sm[1]!;
          if (!STATUS_SET.has(status)) {
            throw new Error(
              `[${name}] section ${s.name} has non-canonical STATUS: "${status}". ` +
                `Allowed: ${[...CANONICAL_STATUSES].join(', ')}`,
            );
          }
        }
      }
    });

    test(`${name}: every CANONICAL section is emitted in order`, () => {
      // Stronger than ordering-only: the audit must emit EVERY section in
      // CANONICAL_SECTIONS for full-audit fixtures. A snapshot update that
      // silently drops a section (e.g., GROUP_DEPS) would slip through if
      // we only checked ordering of the present sections.
      const required = sections.filter((s) => CANONICAL_SET.has(s.name));
      const observed = required.map((s) => s.name);
      // Full-list contract: observed must equal CANONICAL_SECTIONS exactly.
      if (observed.length !== CANONICAL_SECTIONS.length) {
        const missing = CANONICAL_SECTIONS.filter((s) => !observed.includes(s));
        throw new Error(
          `[${name}] expected ${CANONICAL_SECTIONS.length} canonical sections, got ${observed.length}. ` +
            `Missing: ${missing.join(', ')}`,
        );
      }
      for (let i = 0; i < CANONICAL_SECTIONS.length; i++) {
        if (observed[i] !== CANONICAL_SECTIONS[i]) {
          throw new Error(
            `[${name}] section order drift at index ${i}: expected ` +
              `"${CANONICAL_SECTIONS[i]}", got "${observed[i]}". ` +
              `Observed sequence: ${observed.join(' → ')}`,
          );
        }
      }
    });

    test(`${name}: MODE is last (or trailed only by OPTIONAL sections)`, () => {
      let modeIdx = -1;
      for (let i = 0; i < sections.length; i++) {
        if (sections[i]!.name === 'MODE') {
          modeIdx = i;
          break;
        }
      }
      if (modeIdx === -1) return; // Some fixtures don't render MODE; allow.
      for (let i = modeIdx + 1; i < sections.length; i++) {
        const after = sections[i]!.name;
        if (!OPTIONAL_SET.has(after)) {
          throw new Error(
            `[${name}] section "${after}" appears after MODE; only ` +
              `OPTIONAL_SECTIONS may follow MODE`,
          );
        }
      }
    });
  }
});

describe('CANONICAL_SECTIONS fixture-lock', () => {
  test('every CANONICAL section appears in at least one fixture', () => {
    // Closes codex's "test would bless wrong implementation" concern: the
    // const must be observed in actual fixture output, not just declared.
    const seen = new Set<string>();
    for (const name of listFixtures()) {
      const expectedPath = join(FIXTURES_DIR, name, 'expected.txt');
      let text: string;
      try {
        text = readFileSync(expectedPath, 'utf8');
      } catch {
        continue;
      }
      for (const s of parseSections(text)) seen.add(s.name);
    }
    for (const sec of CANONICAL_SECTIONS) {
      if (!seen.has(sec)) {
        throw new Error(
          `CANONICAL_SECTIONS lists "${sec}" but no fixture's expected.txt ` +
            `emits it. Either the const is wrong or a fixture is missing.`,
        );
      }
    }
  });

  test('no fixture emits a section absent from CANONICAL_SECTIONS', () => {
    // Inverse direction: any unknown section in a fixture is a contract
    // gap — either CANONICAL_SECTIONS missed it or the fixture is wrong.
    for (const name of listFixtures()) {
      const expectedPath = join(FIXTURES_DIR, name, 'expected.txt');
      let text: string;
      try {
        text = readFileSync(expectedPath, 'utf8');
      } catch {
        continue;
      }
      for (const s of parseSections(text)) {
        if (CANONICAL_SET.has(s.name)) continue;
        if (OPTIONAL_SET.has(s.name)) continue;
        throw new Error(
          `[${name}] emits unknown section "${s.name}" — neither in ` +
            `CANONICAL_SECTIONS nor OPTIONAL_SECTIONS`,
        );
      }
    }
  });
});
