/**
 * sections.ts — canonical contract for the audit's output section order.
 *
 * Side-effect-free spec module. Owns the ordered list of section names
 * emitted by `bin/roadmap-audit` (and its TS port). Both the runtime
 * dispatcher (`cli.ts ALL_CHECKS`) and the structural-invariants test
 * (`tests/audit-invariants.test.ts`) read from here.
 *
 * Why a separate file: importing constants from `cli.ts` risks pulling in
 * argv parsing / process.exit at module load if the entry-point ever drifts
 * past its `import.meta.main` guard. This file has no I/O, no imports.
 *
 * Drift is locked by the fixture-lock invariant: the audit-invariants test
 * walks every `tests/roadmap-audit/<fixture>/expected.txt`, extracts the
 * section header order, and asserts it matches CANONICAL_SECTIONS. Adding
 * a new section requires editing this file AND regenerating fixtures.
 */

export const CANONICAL_SECTIONS = [
  'VOCAB_LINT',
  'STRUCTURE',
  'STATE_SECTIONS',
  'PHASES',
  'PHASE_INVARIANTS',
  'VERSION_TAG_STALENESS',
  'VERSION',
  'TAXONOMY',
  'DOC_LOCATION',
  'DOC_TYPE_MISMATCH',
  'ARCHIVE_CANDIDATES',
  'DEPENDENCIES',
  'GROUP_DEPS',
  'TASK_LIST',
  'STRUCTURAL_FITNESS',
  'IN_FLIGHT_GROUPS',
  'ORIGIN_STATS',
  'SIZE',
  'COLLISIONS',
  'PARALLELISM_BUDGET',
  'FUTURE',
  'STYLE_LINT',
  'DOC_INVENTORY',
  'SCATTERED_TODOS',
  'UNPROCESSED',
  'TODO_FORMAT',
  'MODE',
] as const;

/**
 * Sections emitted only under specific conditions. Not part of the canonical
 * order — appear after MODE when present.
 *
 * - PARSE_ERRORS: emitted only when parsers report non-empty errors (T1
 *   contract).
 */
export const OPTIONAL_SECTIONS = ['PARSE_ERRORS'] as const;

/**
 * STATUS values that may appear after `STATUS:` in any section. The
 * invariants test asserts every emitted STATUS is in this set.
 *
 * - pass: no findings
 * - fail: blocking findings
 * - warn: non-blocking findings
 * - info: advisory output (no pass/fail semantics)
 * - skip: section not applicable for this repo
 * - found: discovery result (e.g., archive candidates)
 * - none: nothing to report (used by some sections instead of pass)
 * - empty: section ran but found nothing (emitted by Unprocessed when zero
 *   items present — distinct semantically from `pass`/`none`)
 */
export const CANONICAL_STATUSES = ['pass', 'fail', 'warn', 'info', 'skip', 'found', 'none', 'empty'] as const;

export type CanonicalSection = (typeof CANONICAL_SECTIONS)[number];
export type OptionalSection = (typeof OPTIONAL_SECTIONS)[number];
export type CanonicalStatus = (typeof CANONICAL_STATUSES)[number];

/**
 * Audit output section header regex — matches `## SECTION_NAME` where the
 * name is upper-snake. Shared between audit-shadow.test.ts (engine parity)
 * and audit-invariants.test.ts (fixture-lock invariants) so both consumers
 * agree on what counts as a section header.
 */
export const SECTION_HEADING_RE = /^## ([A-Z_]+)\r?$/;

/**
 * Parse an audit output string into ordered sections. Each section's body
 * is the lines BETWEEN its `## NAME` header and the next header (or EOF).
 *
 * Used by the snapshot-style tests (audit-shadow, audit-invariants) to
 * extract sections without re-implementing the regex/state-machine in
 * each test file.
 */
export function parseAuditSections(output: string): Array<{ name: string; body: string[] }> {
  const sections: Array<{ name: string; body: string[] }> = [];
  let current: { name: string; body: string[] } | null = null;
  for (const line of output.split('\n')) {
    const m = SECTION_HEADING_RE.exec(line);
    if (m !== null) {
      if (current !== null) sections.push(current);
      current = { name: m[1]!, body: [] };
      continue;
    }
    if (current !== null) current.body.push(line);
  }
  if (current !== null) sections.push(current);
  return sections;
}
