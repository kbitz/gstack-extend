#!/usr/bin/env bun
/**
 * score-extractor.ts — manual harness for scoring /test-plan extractor
 * output against vendored golden fixtures.
 *
 * The extractor runs inside a live Claude session (Agent subagent or
 * inline LLM reasoning), not as a standalone binary — so it can't be
 * invoked from `bun test` directly. Workflow:
 *
 *   1. Pick a corpus fixture: tests/fixtures/extractor-corpus/{1,2}-*.md
 *   2. Paste the extractor prompt + fixture content into a Claude session.
 *   3. Capture the JSON array output to a file (e.g. /tmp/1-actual.json).
 *   4. Score: bun scripts/score-extractor.ts --score /tmp/1-actual.json
 *
 * Pass criterion: >= THRESHOLD% tolerant match (>=50% of an expected
 * item's keywords appear in some actual item's description).
 *
 * Exit codes:
 *   0  — score >= threshold (PASS)
 *   1  — score below threshold (FAIL — tune the prompt)
 *   2  — usage error or parse error (BAD ARGS / BAD JSON)
 *
 * Migrated from scripts/test-test-plan-extractor.sh --score (deleted in
 * Track 3A). Issue 1B / D2 chose to extract scoring from the bun test
 * suite into this standalone harness.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

// Resolve corpus paths relative to this script — works from any cwd.
const SCRIPT_DIR = new URL('.', import.meta.url).pathname;
const CORPUS_DIR = join(SCRIPT_DIR, '..', 'tests', 'fixtures', 'extractor-corpus');

const THRESHOLD_PERCENT = 70;

// Expected keyword sets per fixture. Lifted from the bash original
// (FIXTURE_EXPECTED). Each line: <fixture-num>|<comma-separated keywords>.
// An expected item "matches" when at least 50% of its keywords appear in
// the concatenated description blob of the actual extractor output.
const EXPECTED_KEYWORD_SETS: Record<number, string[][]> = {
  1: [
    ['root-cause', 'cluster', 'synthesis'],
    ['triage', 'askuserquestion', 'approve'],
    ['agent', 'dispatch', 'parallel'],
    ['dedup', 'roadmap', 'existing'],
    ['state', 'resume', 'phase'],
  ],
  2: [
    ['overhaul', 'triage', 'mode'],
    ['audit', 'vocabulary', 'check'],
    ['groups', 'tracks', 'tasks'],
    ['freshness', 'scan', 'completed'],
    ['version', 'bump', 'recommend'],
  ],
};

const HELP = `score-extractor — score /test-plan extractor output against vendored fixtures

Usage:
  bun scripts/score-extractor.ts --score <path-to-extractor-output.json>
  bun scripts/score-extractor.ts --list-fixtures
  bun scripts/score-extractor.ts --help

Score mode:
  Loads the JSON file (must be an array of {description: string, ...}),
  matches each expected keyword set against the union of all descriptions,
  reports a percentage and exits 0 (>=${THRESHOLD_PERCENT}%) or 1.

  Fixture inferred from filename:
    1-*.json or fixture1.json or 1.json → fixture 1
    2-*.json or fixture2.json or 2.json → fixture 2

List mode:
  Prints corpus paths under tests/fixtures/extractor-corpus/ and the
  expected keyword sets per fixture.

Exit codes:
  0  PASS — score >= ${THRESHOLD_PERCENT}%
  1  FAIL — score below threshold (tune the prompt)
  2  BAD ARGS or BAD JSON
`;

type ActualItem = { description?: unknown };
type Mode = { kind: 'help' } | { kind: 'list' } | { kind: 'score'; input: string };

function parseArgs(argv: readonly string[]): Mode | null {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { kind: 'help' };
  }
  if (argv.length === 0) return null; // No mode given — caller writes usage to stderr.
  if (argv.includes('--list-fixtures')) {
    return { kind: 'list' };
  }
  const scoreIdx = argv.indexOf('--score');
  if (scoreIdx === -1) return null;
  const input = argv[scoreIdx + 1];
  if (input === undefined || input.startsWith('--')) return null;
  return { kind: 'score', input };
}

function inferFixtureNum(filename: string): number | null {
  const b = basename(filename);
  if (/^1[-.]/.test(b) || /^fixture1/.test(b)) return 1;
  if (/^2[-.]/.test(b) || /^fixture2/.test(b)) return 2;
  return null;
}

export function scoreActualAgainstFixture(
  actual: ActualItem[],
  fixtureNum: number,
): { matched: number; total: number; unmatched: string[][] } {
  const expected = EXPECTED_KEYWORD_SETS[fixtureNum];
  if (expected === undefined) {
    throw new Error(`No expected keywords for fixture ${fixtureNum}`);
  }

  const blob = actual
    .map((item) => (typeof item.description === 'string' ? item.description : ''))
    .join('\n')
    .toLowerCase();

  let matched = 0;
  const unmatched: string[][] = [];
  for (const keywords of expected) {
    const total = keywords.length;
    let hits = 0;
    for (const kw of keywords) {
      if (blob.includes(kw.toLowerCase())) hits++;
    }
    const threshold = Math.ceil(total / 2); // >= 50% (matches bash `(total + 1) / 2`)
    if (hits >= threshold) {
      matched++;
    } else {
      unmatched.push(keywords);
    }
  }
  return { matched, total: expected.length, unmatched };
}

function runScore(inputPath: string): number {
  if (!existsSync(inputPath)) {
    process.stderr.write(`Error: file not found: ${inputPath}\n`);
    return 2;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(inputPath, 'utf8'));
  } catch (e) {
    process.stderr.write(`Error: ${inputPath} is not valid JSON: ${(e as Error).message}\n`);
    return 2;
  }

  if (!Array.isArray(parsed)) {
    process.stderr.write(
      `Error: ${inputPath} must be a JSON array of {description, ...} objects\n`,
    );
    return 2;
  }

  const fnum = inferFixtureNum(inputPath);
  if (fnum === null) {
    process.stderr.write(
      `Error: couldn't infer fixture number from filename '${basename(inputPath)}'.\n` +
        `Rename the file to '1-*.json'/'fixture1*.json' for fixture 1, or '2-*.json'/'fixture2*.json' for fixture 2.\n`,
    );
    return 2;
  }

  console.log(`Scoring against fixture ${fnum} expectations...`);
  const { matched, total, unmatched } = scoreActualAgainstFixture(parsed as ActualItem[], fnum);
  const pct = total === 0 ? 0 : Math.floor((matched * 100) / total);

  console.log('');
  console.log('─────────────────────────────────────');
  console.log(`Score: ${matched} / ${total} expected items matched (${pct}%)`);
  console.log(`Threshold: ${THRESHOLD_PERCENT}% tolerant match`);
  console.log('─────────────────────────────────────');

  if (unmatched.length > 0) {
    console.log('');
    console.log('Unmatched expected items:');
    for (const u of unmatched) {
      console.log(`  - ${u.join(',')}`);
    }
  }

  if (pct >= THRESHOLD_PERCENT) {
    console.log('');
    console.log(`✓ PASS — extractor output clears the ${THRESHOLD_PERCENT}% threshold.`);
    return 0;
  }
  console.log('');
  console.log(`✗ FAIL — extractor output below ${THRESHOLD_PERCENT}% threshold. Tune the prompt.`);
  return 1;
}

function runList(): number {
  const corpus = [
    join(CORPUS_DIR, '1-full-review-design.md'),
    join(CORPUS_DIR, '2-roadmap-skill-design.md'),
  ];
  console.log('Corpus fixtures:');
  for (const path of corpus) {
    console.log(`  ${path}${existsSync(path) ? '' : '  [MISSING]'}`);
  }
  console.log('');
  console.log('Expected keyword sets:');
  for (const [fnum, sets] of Object.entries(EXPECTED_KEYWORD_SETS)) {
    console.log(`  Fixture ${fnum}:`);
    for (const kws of sets) console.log(`    - ${kws.join(', ')}`);
  }
  return 0;
}

if (import.meta.main) {
  const mode = parseArgs(process.argv.slice(2));
  if (mode === null) {
    process.stderr.write(HELP);
    process.exit(2);
  }
  switch (mode.kind) {
    case 'help':
      process.stdout.write(HELP);
      process.exit(0);
    case 'list':
      process.exit(runList());
    case 'score':
      process.exit(runScore(mode.input));
  }
}
