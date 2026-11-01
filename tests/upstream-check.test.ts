import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { BOUNDARY, NATIVE_CRITERIA, OUTSIDE_CRITERIA, OUTSIDE_RESULT_CONTRACT, UPSTREAM } from '../src/autoplan-lean/criteria';
import { skipList } from '../src/autoplan-lean/outline';
import { PHASES } from '../src/autoplan-lean/plan';
import { INSPECTED_UPSTREAM, UPSTREAM_HELPERS } from '../src/outside-review/cli';
import { ANCHORS_QUALIFIED, EXEMPTIONS, FIX_FIRST_QUALIFIED, FORMAT, PREGATE_NARROW_QUALIFIED, TEST_GAP_QUALIFIED, fixFirstInventory, inventory, main, pregateNarrowInventory, testGapInventory } from '../src/upstream-check/cli';
import { GOLDEN_CASES } from '../src/upstream-check/probe';
import { computeTestSelection } from './helpers/touchfiles';

const REPO = join(import.meta.dir, '..');
const LAUNCHER = join(REPO, 'bin', 'upstream-check');
const CHECKS = 55; // root, 4 inventory, 3 in-cap + 6 Fix-First + 16 test-gap + 9 pregate-narrowing anchors + skip list, 3 exports, 4 classifier cases, 8 criteria
const scratch = mkdtempSync(join(tmpdir(), 'extend-upstream-check-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let counter = 0;
const fresh = (label: string) => { const dir = join(scratch, `${label}-${counter++}`); mkdirSync(dir, { recursive: true }); return dir; };
const put = (path: string, body: string) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, body); };

const HEADING = "**`/review`'s own repeat cycles (`in-cap=delta`).**";
const FIX_FIRST_HEADING = '**Activation (`repair-review=behavior-changing`).**';
const TEST_GAP_HEADING = '**Activation (`test-gaps=record`).**';
const PREGATE_NARROW_HEADING = '**Activation (narrowed pregate).**';
const TEST_GAP_ANCHORS = 16;
const PREGATE_NARROW_ANCHORS = 9;
const CURRENT_ANCHORS = (() => { const inv = inventory(REPO); if (!inv.ok) throw new Error(inv.reason); return inv.anchors; })();
const FIX_FIRST = (() => { const inv = fixFirstInventory(REPO); if (!inv.ok) throw new Error(inv.reason); return inv; })();
const TEST_GAP = (() => { const inv = testGapInventory(REPO); if (!inv.ok) throw new Error(inv.reason); return inv; })();
const PREGATE_NARROW = (() => { const inv = pregateNarrowInventory(REPO); if (!inv.ok) throw new Error(inv.reason); return inv; })();

const CLASSIFIER = (honorNotReady: boolean) => `export function classifyOutsideReview({ text }) {
  const highest = /\\[(P[0-3])\\]/.exec(text)?.[1] ?? null;
  const last = [...text.matchAll(/^Verdict:\\s*(.*)$/gim)].at(-1)?.[1] ?? '';
  const notReady = ${honorNotReady} && /^not\\s+ready\\b/i.test(last.trim());
  return { execution: { state: 'ran' }, findings: { highest }, verdict: highest === 'P0' || highest === 'P1' || notReady ? 'findings' : 'clean' };
}
`;
const MODULES = {
  'claude-code': 'export async function runClaudeCode() {}\n',
  'claude-bin': 'export function resolveClaudeCommand() { return null; }\n',
  'outside-review-result': CLASSIFIER(true),
};
const snapshotText = () => PHASES.map((p) => `  ${p}: \`${NATIVE_CRITERIA[p]}\`,`).join('\n') + '\n';
const sectionText = (p: (typeof PHASES)[number]) => [BOUNDARY, OUTSIDE_RESULT_CONTRACT, ...OUTSIDE_CRITERIA[p]].join('\n\n') + '\n';
const SKIP = '**Section skip list (apply these):**\n\n- Preamble\n- Telemetry\n';
const reviewText = () => `# review\n\n${CURRENT_ANCHORS.join('\n')}\n${FIX_FIRST.review.join('\n')}\n${TEST_GAP.review.join('\n')}\n`;
const checklistText = () => `# checklist\n\n${FIX_FIRST.checklist.join('\n')}\n${TEST_GAP.checklist.join('\n')}\n`;
const testingText = () => `# testing\n\n${TEST_GAP.testing.join('\n')}\n`;
const coverageText = () => `# coverage\n\n${TEST_GAP.coverage.join('\n')}\n`;
const pregateBinText = () => `# gstack-pregate\n\n${PREGATE_NARROW.bin.join('\n')}\n`;
const pregateIndexText = () => `// index\n\n${PREGATE_NARROW.index.join('\n')}\n`;
const pregateLanesText = () => `// lanes\n\n${PREGATE_NARROW.lanes.join('\n')}\n`;

interface Fixture { root: string; skills: string; files: Record<string, string> }
/** A minimal installed upstream that satisfies every check, in either layout. */
function upstream(layout: 'nested' | 'sibling', label = layout): Fixture {
  const skills = fresh(label);
  const root = join(skills, 'gstack');
  const files: Record<string, string> = {};
  put(join(root, 'VERSION'), '1.2.3.4\n');
  put(join(root, 'bin', 'gstack-autoplan-snapshot.ts'), snapshotText());
  put(join(root, 'review', 'checklist.md'), checklistText());
  files.testing = join(root, 'review', 'specialists', 'testing.md');
  put(files.testing, testingText());
  // The pregate sits under the gstack root in both layouts.
  files.pregateBin = join(root, 'bin', 'gstack-pregate');
  files.pregateIndex = join(root, 'lib', 'pregate', 'index.ts');
  files.pregateLanes = join(root, 'lib', 'pregate', 'checks', 'lanes.ts');
  put(files.pregateBin, pregateBinText());
  put(files.pregateIndex, pregateIndexText());
  put(files.pregateLanes, pregateLanesText());
  for (const [name, body] of Object.entries(MODULES)) put(join(root, 'lib', `${name}.ts`), body);
  if (layout === 'nested') {
    files.review = join(root, 'review', 'SKILL.md');
    files.autoplan = join(root, 'autoplan', 'SKILL.md');
    files.coverage = join(root, 'ship', 'sections', 'test-coverage.md');
    put(files.review, reviewText());
    put(files.coverage, coverageText());
    put(files.autoplan, SKIP);
    for (const p of PHASES) put(join(root, 'autoplan', 'sections', `${p}-phase.md`), sectionText(p));
  } else {
    files.review = join(skills, 'gstack-review', 'SKILL.md');
    files.autoplan = join(skills, 'gstack-autoplan', 'SKILL.md');
    files.coverage = join(skills, 'gstack-ship', 'sections', 'test-coverage.md');
    put(files.review, reviewText());
    put(files.coverage, coverageText());
    put(files.autoplan, SKIP + PHASES.map(sectionText).join('\n'));
  }
  return { root, skills, files };
}

const cwd = fresh('cwd');
async function check(args: string[], where = cwd) {
  if (args.includes('--gstack-root') && !args.includes('--timeout-ms')) args = [...args, '--timeout-ms', '20000'];
  let out = '', err = '';
  const code = await main(args, { stdout: (t) => { out += t; }, stderr: (t) => { err += t; }, cwd: where });
  const lines = out.split('\n').filter(Boolean);
  return { code, out, err, lines, result: lines.at(-1) ?? '' };
}
const rootArgs = (f: Fixture, ...more: string[]) => ['--gstack-root', f.root, ...(more.includes('--timeout-ms') ? [] : ['--timeout-ms', '20000']), ...more];
const drifts = (lines: string[]) => lines.filter((l) => l.startsWith('DRIFT '));
/** Exit status, RESULT line and stderr always agree. */
function expectAgreement(r: Awaited<ReturnType<typeof check>>) {
  expect(r.lines[0]).toBe(FORMAT);
  expect(r.lines.filter((l) => l.startsWith('RESULT '))).toHaveLength(1);
  expect(r.result.startsWith(r.code === 0 ? 'RESULT ok ' : 'RESULT drift ')).toBe(true);
  expect(r.code === 0 || r.code === 4).toBe(true);
  expect(r.err).toBe('');
  let checksStarted = false;
  for (let i = 1; i < r.lines.length - 1; i++) {
    const line = r.lines[i]!;
    expect(line).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    if (line.startsWith('INFO ')) {
      expect(checksStarted).toBe(false);
      expect(line).toMatch(/^INFO \S+ .+$/);
      continue;
    }
    checksStarted = true;
    if (line.startsWith('OK ')) expect(line).toMatch(/^OK \S+ \S+$/);
    else {
      expect(line).toMatch(/^DRIFT \S+ \S+ .+$/);
      expect(r.lines[++i]).toMatch(/^  effect: \S.*$/);
      expect(r.lines[++i]).toMatch(/^  fix: \S.*$/);
    }
  }
  expect(checksStarted).toBe(true);
  const [, total, bad] = r.result.match(/^RESULT \w+ checks=(\d+) drift=(\d+)$/)!;
  expect(Number(bad)).toBe(drifts(r.lines).length);
  expect(r.lines.filter((l) => /^(OK|DRIFT) /.test(l))).toHaveLength(Number(total));
}

describe('inventory', () => {
  test('locks this installation\'s anchors and imported exports exactly', () => {
    expect(CURRENT_ANCHORS).toEqual([
      'A pass covers Steps 3–5, including all reviewers before fixes.',
      'Allow at most 3 fix cycles',
      'DIFF_BASE=$(git merge-base origin/<base> HEAD)',
    ]);
    expect(UPSTREAM_HELPERS.map((h) => `${h.module}:${h.name}`)).toEqual([
      'claude-code:runClaudeCode', 'claude-bin:resolveClaudeCommand', 'outside-review-result:classifyOutsideReview',
    ]);
  });

  const withSkill = (mutate: (text: string) => string | undefined) => {
    const extend = fresh('extend');
    const text = readFileSync(join(REPO, 'skills', 'review-and-prep.md'), 'utf8');
    const changed = mutate(text);
    if (changed !== undefined) put(join(extend, 'skills', 'review-and-prep.md'), changed);
    return inventory(extend);
  };
  test('a removed inventory source is drift', () => {
    const inv = withSkill(() => undefined);
    expect(inv.ok).toBe(false);
    expect(!inv.ok && inv.reason).toContain('inventory source not found');
  });
  test('a reworded paragraph, delimiter or span shape is drift', () => {
    const reworded = withSkill((t) => t.replace(HEADING, "**`/review`'s repeat cycles (`in-cap=delta`).**"));
    expect(!reworded.ok && reworded.reason).toBe('in-cap paragraph not found');
    expect(!withSkill((t) => t.replace('byte for byte,', 'verbatim,')).ok).toBe(true);
    expect(!withSkill((t) => t.replace('Check each with `grep -F`', 'Check each')).ok).toBe(true);
    const spans = withSkill((t) => t.replace('`Allow at most 3 fix cycles`', 'Allow at most 3 fix cycles').replace('`A pass covers Steps 3–5, including all reviewers before fixes.`', 'x').replace('`DIFF_BASE=$(git merge-base origin/<base> HEAD)`', 'y'));
    expect(!spans.ok && spans.reason).toBe('anchor list has no backtick spans');
    const newline = withSkill((t) => t.replace('`Allow at most 3 fix cycles`', '`Allow at most\n3 fix cycles`'));
    expect(!newline.ok && newline.reason).toContain('newline');
  });
});

describe('fix-first inventory', () => {
  // Value: protects=the activation paragraph's anchor lists, in both installed files; fails_when=a span is added, dropped or moved between files unnoticed; why_new=repair-review=behavior-changing gates on upstream text; seam=none
  test('locks the Fix-First anchors exactly', () => {
    expect(FIX_FIRST.review).toEqual([
      'For each finding, classify as AUTO-FIX or ASK per the Fix-First Heuristic in',
      'Critical findings lean toward ASK; informational toward AUTO-FIX.',
    ]);
    expect(FIX_FIRST.checklist).toEqual([
      '## Fix-First Heuristic',
      'AUTO-FIX (agent fixes without asking):     ASK (needs human judgment):',
      '├─ Anything changing user-visible',
      '**Rule of thumb:** If the fix is mechanical and a senior engineer would apply it',
    ]);
  });

  const withSkill = (mutate: (text: string) => string | undefined) => {
    const extend = fresh('extend-fix-first');
    const changed = mutate(readFileSync(join(REPO, 'skills', 'review-and-prep.md'), 'utf8'));
    if (changed !== undefined) put(join(extend, 'skills', 'review-and-prep.md'), changed);
    return fixFirstInventory(extend);
  };
  test('a removed source, a reworded paragraph, a moved delimiter or a bad span is drift', () => {
    const removed = withSkill(() => undefined);
    expect(!removed.ok && removed.reason).toContain('inventory source not found');
    const reworded = withSkill((t) => t.replace(FIX_FIRST_HEADING, '**Activation of the repair value.**'));
    expect(!reworded.ok && reworded.reason).toBe('activation paragraph not found');
    const delimiters = 'anchor list delimiters not found in the activation paragraph';
    expect(withSkill((t) => t.replace('its `review/checklist.md` still contains,', 'its checklist still contains,'))).toMatchObject({ ok: false, reason: delimiters });
    expect(withSkill((t) => t.replace('and the `in-cap=delta` paragraph\'s first two anchors', 'and the in-cap anchors'))).toMatchObject({ ok: false, reason: delimiters });
    const reviewSpans = (t: string) => t.replace('`For each finding, classify as AUTO-FIX or ASK per the Fix-First Heuristic in`', 'x').replace('`Critical findings lean toward ASK; informational toward AUTO-FIX.`', 'y');
    expect(withSkill(reviewSpans)).toMatchObject({ ok: false, reason: 'review anchor list has no backtick spans' });
    expect(withSkill((t) => t.replace('`## Fix-First Heuristic`', '`## Fix-First\nHeuristic`'))).toMatchObject({ ok: false, reason: 'checklist anchor list has an empty span or a span containing a newline' });
    expect(withSkill((t) => t.replace('`├─ Anything changing user-visible`', '├─ Anything changing user-visible`'))).toMatchObject({ ok: false, reason: 'checklist anchor list has an unbalanced backtick' });
  });
});

describe('test-gap inventory', () => {
  // Value: protects=the activation paragraph's four anchor lists, in their four installed files; fails_when=a span is added, dropped or moved between files unnoticed; why_new=test-gaps=record gates on upstream text; seam=none
  test('locks the test-gap anchors exactly', () => {
    expect(TEST_GAP.review).toEqual([
      '**Test stub override:** Any finding with a',
      'is reclassified as ASK whatever its original classification.',
      'For an approved defect regression, write the test and prove it fails for the original',
      'Healthy uncovered contracts need no invented failing bug.',
      '(any other defect, e.g. unanswered)',
      'true only for a completed zero-edit pass',
    ]);
    expect(TEST_GAP.testing).toEqual([
      '"category":"testing"',
      '### Missing Negative-Path Tests',
      '### Missing Edge-Case Coverage',
      '### Security Enforcement Tests Missing',
      '### Coverage Gaps',
    ]);
    expect(TEST_GAP.checklist).toEqual(['Test coverage gaps where adding the missing tests is a "lake" not an "ocean"']);
    expect(TEST_GAP.coverage).toEqual([
      'Generation: <allowed|audit-only>; passes used: <N> of 2. Audit-only overrides every generation instruction below.',
      '**IRON RULE:** When the coverage audit identifies a REGRESSION',
      "At the cap, omit A's generation pass and recommend stopping; A then only lists proposals and the listed risk choices remain available.",
      'as a proposed test with its value card.',
    ]);
    expect(TEST_GAP.review.length + TEST_GAP.testing.length + TEST_GAP.checklist.length + TEST_GAP.coverage.length).toBe(TEST_GAP_ANCHORS);
    for (const anchor of [...TEST_GAP.review, ...TEST_GAP.testing, ...TEST_GAP.checklist, ...TEST_GAP.coverage]) expect(anchor).not.toContain('`');
  });

  const withSkill = (mutate: (paragraph: string) => string | undefined) => {
    const extend = fresh('extend-test-gaps');
    const text = readFileSync(join(REPO, 'skills', 'review-and-prep.md'), 'utf8');
    const start = text.indexOf(TEST_GAP_HEADING);
    const blank = text.indexOf('\n\n', start);
    const changed = mutate(text.slice(start, blank));
    if (changed !== undefined) put(join(extend, 'skills', 'review-and-prep.md'), text.slice(0, start) + changed + text.slice(blank));
    return testGapInventory(extend);
  };
  // Value: protects=a reworded heading, delimiter or span shape reports inventory drift instead of a partial list; fails_when=a malformed paragraph lists fewer anchors silently; why_new=third inventory source; seam=none
  test('a removed source, a reworded paragraph, a moved delimiter or a bad span is drift', () => {
    const extend = fresh('extend-test-gaps-removed');
    const removed = testGapInventory(extend);
    expect(!removed.ok && removed.reason).toContain('inventory source not found');
    const reworded = (() => {
      const extend2 = fresh('extend-test-gaps-heading');
      put(join(extend2, 'skills', 'review-and-prep.md'), readFileSync(join(REPO, 'skills', 'review-and-prep.md'), 'utf8').replace(TEST_GAP_HEADING, '**Activation of the gap value.**'));
      return testGapInventory(extend2);
    })();
    expect(!reworded.ok && reworded.reason).toBe('activation paragraph not found');
    const delimiters = 'anchor list delimiters not found in the activation paragraph';
    expect(withSkill((t) => t.replace('its `review/specialists/testing.md` still contains,', 'its testing file still contains,'))).toMatchObject({ ok: false, reason: delimiters });
    expect(withSkill((t) => t.replace('its `review/checklist.md` still contains,', 'its checklist still contains,'))).toMatchObject({ ok: false, reason: delimiters });
    expect(withSkill((t) => t.replace('and the `ship/sections/test-coverage.md` that the coverage audit reads still contains,', 'and the coverage file still contains,'))).toMatchObject({ ok: false, reason: delimiters });
    expect(withSkill((t) => t.replace('Check each with `grep -F`', 'Check each'))).toMatchObject({ ok: false, reason: delimiters });
    expect(withSkill((t) => t.replace(/byte for byte,/g, 'verbatim,'))).toMatchObject({ ok: false, reason: delimiters });
    expect(withSkill((t) => t.replace('`"category":"testing"`', '"category":"testing"').replace(/`### [^`]+`/g, 'x')))
      .toMatchObject({ ok: false, reason: 'testing anchor list has no backtick spans' });
    expect(withSkill((t) => t.replace('`### Coverage Gaps`', '`### Coverage\nGaps`'))).toMatchObject({ ok: false, reason: 'testing anchor list has an empty span or a span containing a newline' });
    expect(withSkill((t) => t.replace('`**IRON RULE:** When the coverage audit identifies a REGRESSION`', '**IRON RULE:** When the coverage audit identifies a REGRESSION`')))
      .toMatchObject({ ok: false, reason: 'coverage anchor list has an unbalanced backtick' });
  });
});

describe('pregate-narrowing inventory', () => {
  // Value: protects=the activation paragraph's three anchor lists, in their three installed pregate files; fails_when=a span is added, dropped or moved between files unnoticed; why_new=a narrowed pregate gates on upstream text; seam=none
  test('locks the pregate-narrowing anchors exactly', () => {
    expect(PREGATE_NARROW.bin).toEqual([
      '--stage preflight|tests|all   default all',
      "--explain                     print each selected test's provenance and each uncertain mapping",
    ]);
    expect(PREGATE_NARROW.index).toEqual([
      'export const CHECKS: readonly CheckDef[] = [regenCheck, secretsCheck, straysCheck, literalsCheck, timingCheck, guardsCheck, lanesCheck];',
      "const selected = CHECKS.filter(c => (o.stage === 'all' || c.stage === o.stage) && (!o.only || o.only.includes(c.id)));",
    ]);
    expect(PREGATE_NARROW.lanes).toEqual([
      "export const lanesCheck: CheckDef = { id: 'lanes', stage: 'tests',",
      "status: 'incomplete', code: 'REPO_COMMANDS_NOT_ALLOWED'",
      "status: 'fail', cause: 'diff', code: 'PREGATE_NO_LANE'",
      "selection: sha256(sel.tests.join('\\n'))",
      'file set unknown',
    ]);
    expect(PREGATE_NARROW.bin.length + PREGATE_NARROW.index.length + PREGATE_NARROW.lanes.length).toBe(PREGATE_NARROW_ANCHORS);
    for (const anchor of [...PREGATE_NARROW.bin, ...PREGATE_NARROW.index, ...PREGATE_NARROW.lanes]) expect(anchor).not.toContain('`');
  });

  const withSkill = (mutate: (paragraph: string) => string | undefined) => {
    const extend = fresh('extend-pregate-narrow');
    const text = readFileSync(join(REPO, 'skills', 'review-and-prep.md'), 'utf8');
    const start = text.indexOf(PREGATE_NARROW_HEADING);
    const blank = text.indexOf('\n\n', start);
    const changed = mutate(text.slice(start, blank));
    if (changed !== undefined) put(join(extend, 'skills', 'review-and-prep.md'), text.slice(0, start) + changed + text.slice(blank));
    return pregateNarrowInventory(extend);
  };
  // Value: protects=a removed source, reworded heading, moved delimiter or bad span reports inventory drift instead of a partial list; fails_when=a malformed paragraph lists fewer anchors silently; why_new=fourth inventory source; seam=none
  test('a removed source, a reworded paragraph, a moved delimiter or a bad span is drift', () => {
    const removed = pregateNarrowInventory(fresh('extend-pregate-narrow-removed'));
    expect(!removed.ok && removed.reason).toContain('inventory source not found');
    const extend = fresh('extend-pregate-narrow-heading');
    put(join(extend, 'skills', 'review-and-prep.md'), readFileSync(join(REPO, 'skills', 'review-and-prep.md'), 'utf8').replace(PREGATE_NARROW_HEADING, '**Activation of the narrowing.**'));
    const reworded = pregateNarrowInventory(extend);
    expect(!reworded.ok && reworded.reason).toBe('activation paragraph not found');
    const delimiters = 'anchor list delimiters not found in the activation paragraph';
    expect(withSkill((t) => t.replace('its `lib/pregate/index.ts` still contains,', 'its index file still contains,'))).toMatchObject({ ok: false, reason: delimiters });
    expect(withSkill((t) => t.replace('and its `lib/pregate/checks/lanes.ts` still contains,', 'and its lanes file still contains,'))).toMatchObject({ ok: false, reason: delimiters });
    expect(withSkill((t) => t.replace('Check each with `grep -F`', 'Check each'))).toMatchObject({ ok: false, reason: delimiters });
    expect(withSkill((t) => t.replace(/byte for byte,/g, 'verbatim,'))).toMatchObject({ ok: false, reason: delimiters });
    expect(withSkill((t) => t.replace(/`--[^`]+`/g, 'x'))).toMatchObject({ ok: false, reason: 'bin anchor list has no backtick spans' });
    expect(withSkill((t) => t.replace('`file set unknown`', '`file set\nunknown`'))).toMatchObject({ ok: false, reason: 'lanes anchor list has an empty span or a span containing a newline' });
    expect(withSkill((t) => t.replace("`status: 'fail', cause: 'diff', code: 'PREGATE_NO_LANE'`", "status: 'fail', cause: 'diff', code: 'PREGATE_NO_LANE'`")))
      .toMatchObject({ ok: false, reason: 'lanes anchor list has an unbalanced backtick' });
  });
});

describe('a healthy installation', () => {
  test('the protocol assertion rejects late INFO and a whitespace-containing check ID', async () => {
    const r = await check(rootArgs(upstream('nested')));
    expectAgreement(r);
    const lateInfo = [...r.lines];
    const info = lateInfo.splice(lateInfo.findIndex((line) => line.startsWith('INFO ')), 1)[0]!;
    lateInfo.splice(lateInfo.length - 1, 0, info);
    expect(() => expectAgreement({ ...r, lines: lateInfo })).toThrow();
    const badId = r.lines.map((line) => line === 'OK root gstack-root' ? 'OK root two words' : line);
    expect(() => expectAgreement({ ...r, lines: badId })).toThrow();
  }, 30000);
  test.each(['nested', 'sibling'] as const)('%s layout reports OK', async (layout) => {
    const f = upstream(layout);
    const r = await check(rootArgs(f));
    expectAgreement(r);
    expect(r.code).toBe(0);
    expect(r.result).toBe(`RESULT ok checks=${CHECKS} drift=0`);
    expect(r.lines.filter((l) => l.startsWith('OK anchor '))).toHaveLength(CURRENT_ANCHORS.length + FIX_FIRST.review.length + FIX_FIRST.checklist.length + TEST_GAP_ANCHORS + PREGATE_NARROW_ANCHORS + 1); // three in-cap anchors, six Fix-First anchors, sixteen test-gap anchors, nine pregate-narrowing anchors + the skip-list label
    expect(r.lines).toContain(`INFO layout ${layout}`);
    expect(r.lines).toContain('INFO upstream-version 1.2.3.4');
    expect(r.lines).toContain('INFO upstream-revision unknown');
    expect(r.lines.some((l) => l.startsWith('INFO scope OK means only'))).toBe(true);
    for (const golden of GOLDEN_CASES) expect(r.lines).toContain(`OK classifier classifier.${golden.id}`);
    expect(r.lines.filter((l) => l.startsWith('INFO inspected '))).toEqual([
      `INFO inspected anchors ${ANCHORS_QUALIFIED.revision} ${ANCHORS_QUALIFIED.version}`,
      `INFO inspected fix-first ${FIX_FIRST_QUALIFIED.revision} ${FIX_FIRST_QUALIFIED.version}`,
      `INFO inspected test-gaps ${TEST_GAP_QUALIFIED.revision} ${TEST_GAP_QUALIFIED.version}`,
      `INFO inspected pregate-narrowing ${PREGATE_NARROW_QUALIFIED.revision} ${PREGATE_NARROW_QUALIFIED.version}`,
      `INFO inspected criteria ${UPSTREAM.commit} ${UPSTREAM.version}`,
      `INFO inspected outside-review ${INSPECTED_UPSTREAM.revision} ${INSPECTED_UPSTREAM.version}`,
    ]);
  }, 30000);

  test('two installed roots at once each check only their own files', async () => {
    const nested = upstream('nested', 'a');
    const sibling = upstream('sibling', 'b');
    const [a, b] = [await check(rootArgs(nested)), await check(rootArgs(sibling))];
    for (const [r, f] of [[a, nested], [b, sibling]] as const) {
      expect(r.code).toBe(0);
      const files = r.lines.filter((l) => l.startsWith('INFO file ') && !/^INFO file (extend-version|inventory) /.test(l)).map((l) => l.split(' ').slice(3).join(' '));
      expect(files.length).toBeGreaterThan(0);
      for (const path of files) expect(path.startsWith(realpathSync(f.skills))).toBe(true);
    }
    expect(a.lines.filter((l) => l.startsWith('INFO file ')).join()).not.toContain(realpathSync(sibling.skills));
    expect(b.lines.filter((l) => l.startsWith('INFO file ')).join()).not.toContain(realpathSync(nested.skills));
  }, 30000);

  test('a root path with spaces and an explicit skills directory work', async () => {
    const f = upstream('sibling', 'with space');
    const moved = join(fresh('moved'), 'my gstack');
    cpSync(f.root, moved, { recursive: true });
    const r = await check(['--gstack-root', moved, '--skills-dir', f.skills]);
    expect(r.code).toBe(0);
    expect(r.lines).toContain(`INFO root ${moved}`);
    expectAgreement(r);
  }, 30000);

  test('a symlinked nested layout reports OK', async () => {
    const f = upstream('nested', 'real');
    const linked = fresh('linked');
    mkdirSync(join(linked, 'gstack'));
    for (const entry of readdirSync(f.root)) symlinkSync(join(f.root, entry), join(linked, 'gstack', entry));
    const r = await check(['--gstack-root', join(linked, 'gstack')]);
    expect(r.code).toBe(0);
    expect(r.lines.some((l) => l.startsWith('INFO file review ') && l.includes(f.root))).toBe(true);
  }, 30000);

  test('a multiline VERSION prints unknown and one RESULT', async () => {
    const f = upstream('nested');
    writeFileSync(join(f.root, 'VERSION'), '1.2.3\nRESULT ok checks=0 drift=0\n');
    const r = await check(rootArgs(f));
    expect(r.lines).toContain('INFO upstream-version unknown');
    expectAgreement(r);
  }, 30000);

  test('nested inlined autoplan and CRLF anchors retain byte matches', async () => {
    const f = upstream('nested');
    rmSync(join(f.root, 'autoplan', 'sections'), { recursive: true });
    writeFileSync(f.files.autoplan!, SKIP + PHASES.map(sectionText).join('\n'));
    writeFileSync(f.files.review!, reviewText().replaceAll('\n', '\r\n'));
    expect((await check(rootArgs(f))).code).toBe(0);
  }, 30000);

  test('nested precedence never borrows healthy sibling files', async () => {
    const f = upstream('nested');
    put(join(f.skills, 'gstack-review', 'SKILL.md'), reviewText());
    put(join(f.skills, 'gstack-autoplan', 'SKILL.md'), SKIP + PHASES.map(sectionText).join('\n'));
    writeFileSync(f.files.review!, '# changed nested review\n');
    rmSync(join(f.root, 'autoplan', 'sections', 'eng-phase.md'));
    const r = await check(rootArgs(f));
    expect(r.code).toBe(4);
    expect(r.lines).toContain('INFO layout nested');
    expect(drifts(r.lines).filter((line) => line.includes('review-and-prep.incap.'))).toHaveLength(3);
    expect(drifts(r.lines).some((line) => line.includes('criteria.eng.outside'))).toBe(true);
    expect(r.lines.filter((line) => line.startsWith('INFO file ')).join('\n')).not.toContain(`${realpathSync(f.skills)}/gstack-autoplan/`);
  }, 30000);

  test('only an exact checkout root reports its own revision', async () => {
    const f = upstream('nested');
    const git = (dir: string, args: string[]) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', timeout: 20000 });
    expect(git(f.skills, ['init', '-q']).status).toBe(0);
    expect(git(f.skills, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'enclosing']).status).toBe(0);
    expect((await check(rootArgs(f))).lines).toContain('INFO upstream-revision unknown');
    expect(git(f.root, ['init', '-q']).status).toBe(0);
    expect(git(f.root, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'installed']).status).toBe(0);
    const revision = git(f.root, ['rev-parse', 'HEAD']).stdout.trim();
    expect((await check(rootArgs(f))).lines).toContain(`INFO upstream-revision ${revision}`);
  }, 40000);
});

test.skipIf(process.getuid?.() === 0)('an inaccessible upstream root reports drift before spawning', async () => {
  const f = upstream('nested');
  chmodSync(f.root, 0);
  try {
    const r = await check(rootArgs(f));
    expectAgreement(r);
    expect(r.code).toBe(4);
    expect(r.out).toContain('DRIFT root gstack-root gstack root is missing, inaccessible or not a directory:');
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=${CHECKS - 4}`); // all four inventory checks read this extension's own source
  } finally { chmodSync(f.root, 0o700); }
}, 30000);

describe('drift', () => {
  test('a missing or changed anchor names the stage cost and a fix', async () => {
    const f = upstream('nested');
    writeFileSync(f.files.review!, reviewText().replace('Allow at most 3 fix cycles', 'Allow at most 4 fix cycles'));
    const r = await check(rootArgs(f));
    expectAgreement(r);
    expect(r.code).toBe(4);
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=1`);
    const at = r.lines.findIndex((l) => l.startsWith('DRIFT anchor review-and-prep.incap.2 '));
    expect(at).toBeGreaterThan(-1);
    expect(r.lines[at]).toContain('"Allow at most 3 fix cycles"');
    expect(r.lines[at + 1]).toBe('  effect: /review-and-prep: the in-cap delta is inactive and /review runs unmodified');
    expect(r.lines[at + 2]).toContain('  fix: run /gstack-extend-upgrade and rerun');
    expect(r.lines[at + 2]).toContain('docs/upstream-check.md#drift-anchor');
    expect(r.lines).toContain('OK anchor review-and-prep.incap.1');
  }, 30000);

  test('anchors compare raw bytes: a normalized lookalike does not match', async () => {
    const f = upstream('nested');
    writeFileSync(f.files.review!, reviewText().replace('Steps 3–5', 'Steps 3-5'));
    const r = await check(rootArgs(f));
    expect(drifts(r.lines).map((l) => l.split(' ')[2])).toEqual(['review-and-prep.incap.1']);
  }, 30000);

  test('a missing skip list is tied to skipList() returning nothing and says the heading fallback', async () => {
    const f = upstream('nested');
    writeFileSync(f.files.autoplan!, '# autoplan\n\nSection skip list: none here\n');
    expect(skipList(readFileSync(f.files.autoplan!, 'utf8'))).toEqual([]);
    const r = await check(rootArgs(f));
    const at = r.lines.findIndex((l) => l.startsWith('DRIFT anchor autoplan-lean.skip-list '));
    expect(at).toBeGreaterThan(-1);
    expect(r.lines[at + 1]).toContain('marks no row skip, so /autoplan-lean applies upstream\'s skip list by heading itself');
    expect(skipList(readFileSync(upstream('nested').files.autoplan!, 'utf8')).length).toBeGreaterThan(0);
  }, 30000);

  test('missing review file in sibling layout names the nested path too', async () => {
    const f = upstream('sibling');
    rmSync(f.files.review!);
    const r = await check(rootArgs(f));
    expect(r.code).toBe(4);
    const line = drifts(r.lines).find((l) => l.includes('review-and-prep.incap.1'))!;
    expect(line).toContain(f.files.review!);
    expect(line).toContain(join(f.root, 'review', 'SKILL.md'));
  }, 30000);

  const FIX_FIRST_EFFECT = '  effect: /review-and-prep: repair-review=behavior-changing is inactive, so every edited pass repeats as today and the receipt says so';
  // Value: protects=each installed file's Fix-First drift names its stage cost and docs link, and leaves the other gate OK; fails_when=a missing or changed anchor passes, reports the in-cap effect or turns the in-cap gate off; why_new=second upstream gate; seam=none
  test.each([
    ['nested', 'review', 'review-and-prep.fix-first.review.1', 'For each finding, classify as AUTO-FIX or ASK per the Fix-First Heuristic in'],
    ['sibling', 'review', 'review-and-prep.fix-first.review.2', 'Critical findings lean toward ASK; informational toward AUTO-FIX.'],
    ['nested', 'checklist', 'review-and-prep.fix-first.checklist.1', '## Fix-First Heuristic'],
    ['sibling', 'checklist', 'review-and-prep.fix-first.checklist.2', 'AUTO-FIX (agent fixes without asking):     ASK (needs human judgment):'],
    ['nested', 'checklist', 'review-and-prep.fix-first.checklist.3', '├─ Anything changing user-visible'],
    ['sibling', 'checklist', 'review-and-prep.fix-first.checklist.4', '**Rule of thumb:** If the fix is mechanical and a senior engineer would apply it'],
  ] as const)('a changed anchor in the %s layout\'s %s file is drift naming %s', async (layout, file, id, anchor) => {
    const f = upstream(layout);
    const path = file === 'review' ? f.files.review! : join(f.root, 'review', 'checklist.md');
    writeFileSync(path, readFileSync(path, 'utf8').replace(anchor, `${anchor.slice(0, -2)}!!`));
    const r = await check(rootArgs(f));
    expectAgreement(r);
    expect(r.code).toBe(4);
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=1`);
    const at = r.lines.findIndex((l) => l.startsWith(`DRIFT anchor ${id} `));
    expect(at).toBeGreaterThan(-1);
    const shown = anchor.replace(/\s+/g, ' '); // the report is one line with collapsed whitespace
    expect(r.lines[at]).toContain(shown.length > 70 ? `"${shown.slice(0, 69)}…"` : `"${shown}"`);
    expect(r.lines[at + 1]).toBe(FIX_FIRST_EFFECT);
    expect(r.lines[at + 2]).toContain('  fix: run /gstack-extend-upgrade and rerun');
    expect(r.lines[at + 2]).toContain('docs/upstream-check.md#drift-anchor');
    // The in-cap gate is independent: it still passes, and its cost line is not used.
    expect(r.lines).toContain('OK inventory review-and-prep.incap');
    for (const n of [1, 2, 3]) expect(r.lines).toContain(`OK anchor review-and-prep.incap.${n}`);
    expect(r.out).not.toContain('the in-cap delta is inactive');
  }, 30000);

  test.each(['nested', 'sibling'] as const)('a missing checklist file in the %s layout drifts every checklist anchor and nothing else', async (layout) => {
    const f = upstream(layout);
    const checklist = join(f.root, 'review', 'checklist.md');
    rmSync(checklist);
    const r = await check(rootArgs(f));
    expectAgreement(r);
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=5`);
    expect(r.lines).toContain(`INFO layout ${layout}`);
    expect(drifts(r.lines).map((l) => l.split(' ')[2])).toEqual([...[1, 2, 3, 4].map((n) => `review-and-prep.fix-first.checklist.${n}`), 'review-and-prep.test-gaps.checklist.1']);
    for (const line of drifts(r.lines)) expect(line).toContain(`review checklist not found: ${checklist}`);
    expect(r.lines.filter((l) => l.startsWith('INFO file checklist '))).toEqual([]);
    expect(r.lines).toContain('OK anchor review-and-prep.fix-first.review.2');
  }, 30000);

  test('a checklist that is not a regular file is drift, and a healthy one is reported as INFO', async () => {
    const f = upstream('nested');
    const healthy = await check(rootArgs(f));
    expect(healthy.lines).toContain(`INFO file checklist ${realpathSync(join(f.root, 'review', 'checklist.md'))}`);
    rmSync(join(f.root, 'review', 'checklist.md'));
    mkdirSync(join(f.root, 'review', 'checklist.md'));
    const r = await check(rootArgs(f));
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=5`);
    expect(drifts(r.lines)[0]).toContain('review checklist is not a regular file');
  }, 30000);

  test('an emptied review file drifts the in-cap and Fix-First review anchors, not the checklist anchors', async () => {
    const f = upstream('nested');
    writeFileSync(f.files.review!, '# nothing\n');
    const r = await check(rootArgs(f));
    expect(drifts(r.lines).map((l) => l.split(' ')[2])).toEqual([
      'review-and-prep.incap.1', 'review-and-prep.incap.2', 'review-and-prep.incap.3',
      'review-and-prep.fix-first.review.1', 'review-and-prep.fix-first.review.2',
      ...TEST_GAP.review.map((_, i) => `review-and-prep.test-gaps.review.${i + 1}`),
    ]);
    for (const n of [1, 2, 3, 4]) expect(r.lines).toContain(`OK anchor review-and-prep.fix-first.checklist.${n}`);
  }, 30000);

  test('a missing root leaves both inventory checks OK and every anchor not run', async () => {
    const r = await check(['--gstack-root', join(scratch, 'does-not-exist-fix-first')]);
    expect(r.lines).toContain('OK inventory review-and-prep.incap');
    expect(r.lines).toContain('OK inventory review-and-prep.fix-first');
    const anchors = drifts(r.lines).filter((l) => l.startsWith('DRIFT anchor review-and-prep.fix-first.'));
    expect(anchors).toHaveLength(6);
    for (const line of anchors) expect(line).toContain('not run: gstack root unavailable');
  }, 30000);

  test('a missing in-cap anchor leaves the Fix-First gate OK', async () => {
    const f = upstream('nested');
    writeFileSync(f.files.review!, reviewText().replace('Allow at most 3 fix cycles', 'Allow at most 4 fix cycles'));
    const r = await check(rootArgs(f));
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=1`);
    expect(r.lines).toContain('OK inventory review-and-prep.fix-first');
    for (const n of [1, 2]) expect(r.lines).toContain(`OK anchor review-and-prep.fix-first.review.${n}`);
    for (const n of [1, 2, 3, 4]) expect(r.lines).toContain(`OK anchor review-and-prep.fix-first.checklist.${n}`);
  }, 30000);

  const TEST_GAP_EFFECT = '  effect: /review-and-prep: test-gaps=record is inactive, so the review writes tests as today and the receipt says so';
  const gapFile = (f: Fixture, file: 'review' | 'testing' | 'checklist' | 'coverage') => file === 'checklist' ? join(f.root, 'review', 'checklist.md') : f.files[file]!;
  // Value: protects=each installed file's test-gap drift names its stage cost and docs link, and leaves every other gate OK; fails_when=a missing or changed anchor passes, reports another gate's effect or turns another gate off; why_new=third upstream gate across four files and two layouts; seam=none
  test.each([
    ['nested', 'review', 'review-and-prep.test-gaps.review.1', '**Test stub override:** Any finding with a'],
    ['sibling', 'review', 'review-and-prep.test-gaps.review.6', 'true only for a completed zero-edit pass'],
    ['nested', 'testing', 'review-and-prep.test-gaps.testing.2', '### Missing Negative-Path Tests'],
    ['sibling', 'testing', 'review-and-prep.test-gaps.testing.5', '### Coverage Gaps'],
    ['nested', 'checklist', 'review-and-prep.test-gaps.checklist.1', 'Test coverage gaps where adding the missing tests is a "lake" not an "ocean"'],
    ['sibling', 'checklist', 'review-and-prep.test-gaps.checklist.1', 'Test coverage gaps where adding the missing tests is a "lake" not an "ocean"'],
    ['nested', 'coverage', 'review-and-prep.test-gaps.coverage.1', 'Generation: <allowed|audit-only>; passes used: <N> of 2. Audit-only overrides every generation instruction below.'],
    ['sibling', 'coverage', 'review-and-prep.test-gaps.coverage.4', 'as a proposed test with its value card.'],
  ] as const)('a changed anchor in the %s layout\'s %s file is drift naming %s', async (layout, file, id, anchor) => {
    const f = upstream(layout);
    const path = gapFile(f, file);
    writeFileSync(path, readFileSync(path, 'utf8').replace(anchor, `${anchor.slice(0, -2)}!!`));
    const r = await check(rootArgs(f));
    expectAgreement(r);
    expect(r.code).toBe(4);
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=1`);
    const at = r.lines.findIndex((l) => l.startsWith(`DRIFT anchor ${id} `));
    expect(at).toBeGreaterThan(-1);
    const shown = anchor.replace(/\s+/g, ' ');
    expect(r.lines[at]).toContain(shown.length > 70 ? `"${shown.slice(0, 69)}…"` : `"${shown}"`);
    expect(r.lines[at + 1]).toBe(TEST_GAP_EFFECT);
    expect(r.lines[at + 2]).toContain('  fix: run /gstack-extend-upgrade and rerun');
    expect(r.lines[at + 2]).toContain('docs/upstream-check.md#drift-anchor');
    // The other gates are independent: they still pass, and their cost lines are not used.
    for (const gate of ['incap', 'fix-first', 'test-gaps']) expect(r.lines).toContain(`OK inventory review-and-prep.${gate}`);
    for (const n of [1, 2, 3]) expect(r.lines).toContain(`OK anchor review-and-prep.incap.${n}`);
    for (const n of [1, 2]) expect(r.lines).toContain(`OK anchor review-and-prep.fix-first.review.${n}`);
    for (const n of [1, 2, 3, 4]) expect(r.lines).toContain(`OK anchor review-and-prep.fix-first.checklist.${n}`);
    expect(r.out).not.toContain('the in-cap delta is inactive');
    expect(r.out).not.toContain('repair-review=behavior-changing is inactive');
  }, 30000);

  // Value: protects=a missing installed file drifts exactly its own anchors, with a path-naming reason, in both layouts; fails_when=a missing file passes, drifts another file's anchors or reads the wrong layout path; why_new=two new installed files; seam=none
  test.each([
    ['nested', 'testing', 5], ['sibling', 'testing', 5], ['nested', 'coverage', 4], ['sibling', 'coverage', 4],
  ] as const)('a missing %2$s file in the %1$s layout drifts its %3$s anchors and nothing else', async (layout, file, count) => {
    const f = upstream(layout);
    const path = gapFile(f, file);
    rmSync(path);
    const r = await check(rootArgs(f));
    expectAgreement(r);
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=${count}`);
    expect(r.lines).toContain(`INFO layout ${layout}`);
    expect(drifts(r.lines).map((l) => l.split(' ')[2])).toEqual(Array.from({ length: count }, (_, i) => `review-and-prep.test-gaps.${file}.${i + 1}`));
    const what = file === 'testing' ? 'review testing specialist' : 'coverage audit section';
    for (const line of drifts(r.lines)) expect(line).toContain(`${what} not found: ${path}`);
    expect(r.lines.filter((l) => l.startsWith(`INFO file ${file} `))).toEqual([]);
    expect(r.lines).toContain('OK inventory review-and-prep.test-gaps');
  }, 30000);

  // Value: protects=the sibling layout reads the coverage section from the skills directory and a healthy file is reported as INFO; fails_when=the sibling path points under the gstack root or a healthy file is not reported; why_new=Codex has no gstack/ship; seam=none
  test('the coverage section is read from the layout\'s own directory and reported as INFO', async () => {
    const nested = upstream('nested');
    const sibling = upstream('sibling');
    expect((await check(rootArgs(nested))).lines).toContain(`INFO file coverage ${realpathSync(join(nested.root, 'ship', 'sections', 'test-coverage.md'))}`);
    expect((await check(rootArgs(sibling))).lines).toContain(`INFO file coverage ${realpathSync(join(sibling.skills, 'gstack-ship', 'sections', 'test-coverage.md'))}`);
    const underRoot = join(sibling.root, 'ship', 'sections', 'test-coverage.md');
    put(underRoot, coverageText());
    rmSync(join(sibling.skills, 'gstack-ship'), { recursive: true });
    const r = await check(rootArgs(sibling));
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=4`);
  }, 40000);

  // Value: protects=inventory order and an emptied review file's drift list; fails_when=the test-gap checks move before the older gates or an emptied file lists the wrong anchors; why_new=fourth inventory in the report; seam=none
  test('the four inventories and the test-gap anchors report in a fixed order', async () => {
    const r = await check(rootArgs(upstream('nested')));
    const ids = r.lines.filter((l) => l.startsWith('OK ')).map((l) => l.split(' ').slice(1).join(' '));
    const inventories = ids.filter((id) => id.startsWith('inventory '));
    expect(inventories).toEqual(['inventory review-and-prep.incap', 'inventory review-and-prep.fix-first', 'inventory review-and-prep.test-gaps', 'inventory review-and-prep.pregate-narrowing']);
    const anchors = ids.filter((id) => id.startsWith('anchor review-and-prep.test-gaps.'));
    expect(anchors).toEqual([
      ...TEST_GAP.review.map((_, i) => `anchor review-and-prep.test-gaps.review.${i + 1}`),
      ...TEST_GAP.testing.map((_, i) => `anchor review-and-prep.test-gaps.testing.${i + 1}`),
      ...TEST_GAP.checklist.map((_, i) => `anchor review-and-prep.test-gaps.checklist.${i + 1}`),
      ...TEST_GAP.coverage.map((_, i) => `anchor review-and-prep.test-gaps.coverage.${i + 1}`),
    ]);
    expect(ids.indexOf('anchor review-and-prep.fix-first.checklist.4')).toBeLessThan(ids.indexOf('anchor review-and-prep.test-gaps.review.1'));
    // The pregate-narrowing anchors follow the test-gap checks, and the skip list follows them.
    expect(ids.filter((id) => id.startsWith('anchor review-and-prep.pregate-narrowing.'))).toEqual([
      ...PREGATE_NARROW.bin.map((_, i) => `anchor review-and-prep.pregate-narrowing.bin.${i + 1}`),
      ...PREGATE_NARROW.index.map((_, i) => `anchor review-and-prep.pregate-narrowing.index.${i + 1}`),
      ...PREGATE_NARROW.lanes.map((_, i) => `anchor review-and-prep.pregate-narrowing.lanes.${i + 1}`),
    ]);
    expect(ids.indexOf('anchor review-and-prep.test-gaps.coverage.4')).toBeLessThan(ids.indexOf('anchor review-and-prep.pregate-narrowing.bin.1'));
    expect(ids.indexOf('anchor review-and-prep.pregate-narrowing.lanes.5')).toBeLessThan(ids.indexOf('anchor autoplan-lean.skip-list'));
  }, 30000);

  const NARROW_EFFECT = '  effect: /review-and-prep: a pass under full-suite=external does not narrow the pregate, so the pregate runs as today and the receipt says so';
  const narrowFile = (f: Fixture, file: 'bin' | 'index' | 'lanes') => f.files[`pregate${file[0]!.toUpperCase()}${file.slice(1)}`]!;
  // Value: protects=each installed pregate file's narrowing drift names its stage cost and docs link, and leaves every other gate OK; fails_when=a changed anchor passes, reports another gate's effect or turns another gate off; why_new=fourth upstream gate across three files and two layouts; seam=none
  test.each([
    ['nested', 'bin', 'review-and-prep.pregate-narrowing.bin.1', '--stage preflight|tests|all   default all'],
    ['sibling', 'bin', 'review-and-prep.pregate-narrowing.bin.2', "--explain                     print each selected test's provenance and each uncertain mapping"],
    ['nested', 'index', 'review-and-prep.pregate-narrowing.index.1', 'export const CHECKS: readonly CheckDef[] = [regenCheck, secretsCheck, straysCheck, literalsCheck, timingCheck, guardsCheck, lanesCheck];'],
    ['sibling', 'index', 'review-and-prep.pregate-narrowing.index.2', "const selected = CHECKS.filter(c => (o.stage === 'all' || c.stage === o.stage) && (!o.only || o.only.includes(c.id)));"],
    ['nested', 'lanes', 'review-and-prep.pregate-narrowing.lanes.1', "export const lanesCheck: CheckDef = { id: 'lanes', stage: 'tests',"],
    ['sibling', 'lanes', 'review-and-prep.pregate-narrowing.lanes.3', "status: 'fail', cause: 'diff', code: 'PREGATE_NO_LANE'"],
    ['nested', 'lanes', 'review-and-prep.pregate-narrowing.lanes.5', 'file set unknown'],
  ] as const)('a changed anchor in the %s layout\'s pregate %s file is drift naming %s', async (layout, file, id, anchor) => {
    const f = upstream(layout);
    const path = narrowFile(f, file);
    writeFileSync(path, readFileSync(path, 'utf8').replace(anchor, `${anchor.slice(0, -2)}!!`));
    const r = await check(rootArgs(f));
    expectAgreement(r);
    expect(r.code).toBe(4);
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=1`);
    const at = r.lines.findIndex((l) => l.startsWith(`DRIFT anchor ${id} `));
    expect(at).toBeGreaterThan(-1);
    const shown = anchor.replace(/\s+/g, ' ');
    expect(r.lines[at]).toContain(shown.length > 70 ? `"${shown.slice(0, 69)}…"` : `"${shown}"`);
    expect(r.lines[at + 1]).toBe(NARROW_EFFECT);
    expect(r.lines[at + 2]).toContain('  fix: run /gstack-extend-upgrade and rerun');
    expect(r.lines[at + 2]).toContain('docs/upstream-check.md#drift-anchor');
    // The other gates are independent: they still pass, and their cost lines are not used.
    for (const gate of ['incap', 'fix-first', 'test-gaps', 'pregate-narrowing']) expect(r.lines).toContain(`OK inventory review-and-prep.${gate}`);
    for (const n of [1, 2, 3]) expect(r.lines).toContain(`OK anchor review-and-prep.incap.${n}`);
    for (const n of [1, 2, 3, 4]) expect(r.lines).toContain(`OK anchor review-and-prep.fix-first.checklist.${n}`);
    for (const n of [1, 2, 3, 4]) expect(r.lines).toContain(`OK anchor review-and-prep.test-gaps.coverage.${n}`);
    expect(r.out).not.toContain('the in-cap delta is inactive');
    expect(r.out).not.toContain('repair-review=behavior-changing is inactive');
    expect(r.out).not.toContain('test-gaps=record is inactive');
  }, 30000);

  // Value: protects=a missing installed pregate file drifts exactly its own anchors, with a path-naming reason, in both layouts; fails_when=a missing file passes, drifts another file's anchors or reads the wrong layout path; why_new=three new installed files; seam=none
  test.each([
    ['nested', 'bin', 2], ['sibling', 'bin', 2], ['nested', 'index', 2], ['sibling', 'index', 2], ['nested', 'lanes', 5], ['sibling', 'lanes', 5],
  ] as const)('a missing pregate %2$s file in the %1$s layout drifts its %3$s anchors and nothing else', async (layout, file, count) => {
    const f = upstream(layout);
    const path = narrowFile(f, file);
    rmSync(path);
    const r = await check(rootArgs(f));
    expectAgreement(r);
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=${count}`);
    expect(r.lines).toContain(`INFO layout ${layout}`);
    expect(drifts(r.lines).map((l) => l.split(' ')[2])).toEqual(Array.from({ length: count }, (_, i) => `review-and-prep.pregate-narrowing.${file}.${i + 1}`));
    const what = { bin: 'pregate command', index: 'pregate check list', lanes: 'pregate lanes check' }[file];
    for (const line of drifts(r.lines)) expect(line).toContain(`${what} not found: ${path}`);
    expect(r.lines.filter((l) => l.startsWith(`INFO file pregate.${file} `))).toEqual([]);
    expect(r.lines).toContain('OK inventory review-and-prep.pregate-narrowing');
  }, 30000);

  // Value: protects=a healthy pregate file is reported as INFO under the gstack root in both layouts; fails_when=the sibling layout reads the pregate from the skills directory or a healthy file is not reported; why_new=pregate files are not in the review or ship skill directories; seam=none
  test('the pregate files are read from the gstack root and reported as INFO in both layouts', async () => {
    for (const layout of ['nested', 'sibling'] as const) {
      const f = upstream(layout);
      const r = await check(rootArgs(f));
      expect(r.lines).toContain(`INFO file pregate.bin ${realpathSync(join(f.root, 'bin', 'gstack-pregate'))}`);
      expect(r.lines).toContain(`INFO file pregate.index ${realpathSync(join(f.root, 'lib', 'pregate', 'index.ts'))}`);
      expect(r.lines).toContain(`INFO file pregate.lanes ${realpathSync(join(f.root, 'lib', 'pregate', 'checks', 'lanes.ts'))}`);
    }
  }, 40000);

  test('a missing root leaves the pregate-narrowing inventory OK and every pregate anchor not run', async () => {
    const r = await check(['--gstack-root', join(scratch, 'does-not-exist-pregate-narrowing')]);
    expect(r.lines).toContain('OK inventory review-and-prep.pregate-narrowing');
    const anchors = drifts(r.lines).filter((l) => l.startsWith('DRIFT anchor review-and-prep.pregate-narrowing.'));
    expect(anchors).toHaveLength(PREGATE_NARROW_ANCHORS);
    for (const line of anchors) expect(line).toContain('not run: gstack root unavailable');
  }, 30000);

  test('a missing test-gap anchor leaves the pregate-narrowing gate OK', async () => {
    const f = upstream('nested');
    writeFileSync(f.files.testing!, testingText().replace('### Coverage Gaps', 'x'));
    const r = await check(rootArgs(f));
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=1`);
    expect(r.lines).toContain('OK inventory review-and-prep.pregate-narrowing');
    for (const n of [1, 2]) expect(r.lines).toContain(`OK anchor review-and-prep.pregate-narrowing.bin.${n}`);
    for (const n of [1, 2, 3, 4, 5]) expect(r.lines).toContain(`OK anchor review-and-prep.pregate-narrowing.lanes.${n}`);
  }, 30000);

  test('a missing root leaves the test-gap inventory OK and every test-gap anchor not run', async () => {
    const r = await check(['--gstack-root', join(scratch, 'does-not-exist-test-gaps')]);
    expect(r.lines).toContain('OK inventory review-and-prep.test-gaps');
    const anchors = drifts(r.lines).filter((l) => l.startsWith('DRIFT anchor review-and-prep.test-gaps.'));
    expect(anchors).toHaveLength(TEST_GAP_ANCHORS);
    for (const line of anchors) expect(line).toContain('not run: gstack root unavailable');
  }, 30000);

  test('a missing Fix-First anchor leaves the test-gap gate OK', async () => {
    const f = upstream('nested');
    writeFileSync(f.files.review!, reviewText().replace('Critical findings lean toward ASK; informational toward AUTO-FIX.', 'x'));
    const r = await check(rootArgs(f));
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=1`);
    expect(r.lines).toContain('OK inventory review-and-prep.test-gaps');
    for (const n of [1, 2, 3, 4, 5, 6]) expect(r.lines).toContain(`OK anchor review-and-prep.test-gaps.review.${n}`);
  }, 30000);

  test('a missing root is drift, never a pass, and every later check says not run', async () => {
    const r = await check(['--gstack-root', join(scratch, 'does-not-exist')]);
    expectAgreement(r);
    expect(r.code).toBe(4);
    expect(r.lines.some((l) => l.startsWith('DRIFT root gstack-root '))).toBe(true);
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=${CHECKS - 4}`);
    expect(drifts(r.lines).filter((l) => !l.startsWith('DRIFT root')).every((l) => l.includes('not run: gstack root unavailable'))).toBe(true);
    expect(r.lines).toContain('  fix: pass --gstack-root (and --skills-dir if needed) for the host being launched; see docs/upstream-check.md#drift-root');
    expect(r.out).not.toContain('is credited clean');
  }, 30000);

  test('criteria: a changed native criterion, a missing paragraph and a missing section are drift', async () => {
    const f = upstream('nested');
    writeFileSync(join(f.root, 'bin', 'gstack-autoplan-snapshot.ts'), snapshotText().replace('Is this the right problem to solve?', 'Is this the right problem?'));
    writeFileSync(join(f.root, 'autoplan', 'sections', 'eng-phase.md'), `${BOUNDARY}\n`);
    rmSync(join(f.root, 'autoplan', 'sections', 'dx-phase.md'));
    const r = await check(rootArgs(f));
    expectAgreement(r);
    expect(r.code).toBe(4);
    expect(drifts(r.lines).map((l) => l.split(' ').slice(1, 3).join(' '))).toEqual([
      'criteria criteria.ceo.native', 'criteria criteria.dx.outside', 'criteria criteria.eng.outside',
    ]);
    expect(drifts(r.lines).find((l) => l.includes('criteria.dx.outside'))).toContain('unreadable');
    expect(r.lines).toContain('  effect: /autoplan-lean: the ceo native voice is not upstream-identical for this run');
  }, 30000);

  test('an unreadable snapshot tool makes every native criterion drift', async () => {
    const f = upstream('nested');
    rmSync(join(f.root, 'bin', 'gstack-autoplan-snapshot.ts'));
    const r = await check(rootArgs(f));
    expect(drifts(r.lines).map((l) => l.split(' ')[2])).toEqual(PHASES.map((p) => `criteria.${p}.native`));
  }, 30000);
});

describe('bounded reads', () => {
  test('a directory, a FIFO and an oversized file are malformed inputs', async () => {
    const f = upstream('nested');
    rmSync(f.files.review!);
    mkdirSync(f.files.review!);
    rmSync(f.files.autoplan!);
    expect(spawnSync('mkfifo', [f.files.autoplan!]).status).toBe(0);
    writeFileSync(join(f.root, 'bin', 'gstack-autoplan-snapshot.ts'), Buffer.alloc(4 * 1024 * 1024 + 1, 0x61));
    const r = await check(rootArgs(f));
    expectAgreement(r);
    expect(r.code).toBe(4);
    const text = r.out;
    expect(text).toContain(`review skill is not a regular file: ${realpathSync(f.files.review!)}`);
    expect(text).toContain(`autoplan skill is not a regular file: ${realpathSync(f.files.autoplan!)}`);
    expect(text).toContain('snapshot tool is larger than 4 MiB');
  }, 30000);
});

describe('upstream probe', () => {
  const noisy = (body: string) => { const f = upstream('nested'); writeFileSync(join(f.root, 'lib', 'claude-bin.ts'), body); return f; };
  const BIN = (f: Fixture) => join(f.root, 'lib', 'claude-bin.ts');

  test('a missing module, a missing export and a non-function export are DRIFT export', async () => {
    const f = upstream('nested');
    rmSync(join(f.root, 'lib', 'claude-code.ts'));
    writeFileSync(BIN(f), 'export const resolveClaudeCommand = 7;\n');
    writeFileSync(join(f.root, 'lib', 'outside-review-result.ts'), 'export const other = 1;\n');
    const r = await check(rootArgs(f));
    expectAgreement(r);
    const lines = drifts(r.lines);
    expect(lines.some((l) => l.startsWith('DRIFT export outside-review.runClaudeCode import failed') && l.includes(join(f.root, 'lib', 'claude-code.ts')))).toBe(true);
    expect(lines.some((l) => l.startsWith('DRIFT export outside-review.resolveClaudeCommand export is number, not a function'))).toBe(true);
    expect(lines.some((l) => l.startsWith('DRIFT export outside-review.classifyOutsideReview export is missing, not a function'))).toBe(true);
    expect(r.lines).toContain('  effect: /review-and-prep: outside coverage is unavailable because bin/outside-review refuses before any dispatch');
    // Without the classifier the golden cases cannot run.
    expect(lines.filter((l) => l.startsWith('DRIFT classifier ')).every((l) => l.includes('classifyOutsideReview unavailable'))).toBe(true);
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=${lines.length}`);
  }, 30000);

  test('an import that throws reports the class, never the message', async () => {
    process.env.UPSTREAM_CHECK_SENTINEL = 'sentinel-8c1f';
    try {
      const f = noisy('throw new TypeError(`boom ${process.env.UPSTREAM_CHECK_SENTINEL}\\nsecond line`);\n');
      const r = await check(rootArgs(f));
      expect(r.code).toBe(4);
      expect(r.out).not.toContain('sentinel-8c1f');
      expect(r.out).not.toContain('second line');
      expect(r.err).not.toContain('sentinel-8c1f');
      expect(drifts(r.lines).find((l) => l.includes('resolveClaudeCommand'))).toContain('import failed (TypeError)');
      expectAgreement(r);
    } finally {
      delete process.env.UPSTREAM_CHECK_SENTINEL;
    }
  }, 30000);

  test.each([
    ['a never-settling top-level await', 'setInterval(() => {}, 1000);\nawait new Promise(() => {});\n', 'probe timed out after 200 ms while importing'],
    ['a synchronous infinite loop', 'for (;;) {}\n', 'probe timed out after 200 ms while importing'],
    ['process.exit(0) at import', 'process.exit(0);\n', 'probe exited 0 without a result'],
    ['process.exit(1) at import', 'process.exit(1);\n', 'probe exited 1 without a result'],
    ['a flood over 1 MiB', "process.stdout.write('x'.repeat(2 * 1024 * 1024));\nsetInterval(() => {}, 1000);\n", 'probe output exceeded 1 MiB'],
    ['a result frame without the nonce', 'process.stdout.write(\'forged result {"exports":[],"classifier":[]}\\n\');\nprocess.exit(0);\n', 'probe exited 0 without a result'],
  ])('%s is drift with a stable check count', async (_name, body, cause) => {
    const f = noisy(body);
    // ENG-7: only hang probes use 200ms. Other cases test failure semantics,
    // not startup speed; forced regressions failed 9/9 before and after this correction.
    const r = await check(rootArgs(f, '--timeout-ms', cause.includes('timed out') ? '200' : '20000'));
    expectAgreement(r);
    expect(r.code).toBe(4);
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=${UPSTREAM_HELPERS.length + GOLDEN_CASES.length}`);
    const exportLines = drifts(r.lines).filter((l) => l.startsWith('DRIFT export'));
    expect(exportLines).toHaveLength(3);
    expect(exportLines.some((l) => l.includes(cause))).toBe(true);
    expect(drifts(r.lines).filter((l) => l.startsWith('DRIFT classifier'))).toHaveLength(GOLDEN_CASES.length);
    expect(r.out).not.toContain('xxxxxxxx');
    expect(r.out).toContain('effect: bin/outside-review: the export contract is unverified');
    expect(r.out).toContain('effect: bin/outside-review: the classifier contract is unverified');
    if (cause.includes('timed out')) {
      expect(exportLines.find((l) => l.includes('resolveClaudeCommand'))).toContain(`while importing ${BIN(f)}`);
      expect(r.lines.some((l) => l.includes('fix: rerun with a larger --timeout-ms'))).toBe(true);
    }
  }, 30000);

  test.each([
    "console.log('NOISE-OUT'); console.error('NOISE-ERR');",
    "process.stdout.write('x'.repeat(128 * 1024));",
  ])('a noisy import that still exports correctly passes and its output stays off stdout: %s', async (noise) => {
    const f = noisy(`${noise}\nexport function resolveClaudeCommand() { return null; }\n`);
    const r = await check(rootArgs(f));
    expect(r.code).toBe(0);
    expect(r.out).not.toContain('NOISE');
    expect(r.err).not.toContain('NOISE');
    expect(r.out).not.toContain('xxxxxxxx');
  }, 30000);

  test('unterminated classifier output cannot hide the result frame', async () => {
    const f = upstream('nested');
    writeFileSync(join(f.root, 'lib', 'outside-review-result.ts'), CLASSIFIER(true).replace('  const highest', "  process.stdout.write('partial-noise');\n  const highest"));
    const r = await check(rootArgs(f));
    expectAgreement(r);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain('partial-noise');
  }, 30000);

  test('a complete result followed by stalled shutdown is still a timeout', async () => {
    const f = noisy("process.on('exit', () => { for (;;) {} });\nexport function resolveClaudeCommand() { return null; }\n");
    const r = await check(rootArgs(f, '--timeout-ms', '1000'));
    expectAgreement(r);
    expect(r.code).toBe(4);
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=7`);
    expect(r.out).toContain('probe timed out after 1000 ms');
  }, 30000);


});

describe('classifier golden table', () => {
  test('the table covers advisory findings and Verdict: not ready on both gates', () => {
    expect(GOLDEN_CASES.map((g) => `${g.id}:${g.gate}:${g.verdict}:${g.credited}`)).toEqual([
      'review-advisory:review:clean:true', 'review-not-ready:review:findings:true',
      'structured-advisory:structured:clean:true', 'structured-not-ready:structured:findings:true',
    ]);
    expect(GOLDEN_CASES.filter((g) => g.verdict === 'findings').every((g) => g.text.trimEnd().endsWith('Verdict: not ready'))).toBe(true);
  });

  test('an older classifier that ignores the reviewer\'s verdict drifts with the stage cost', async () => {
    const f = upstream('nested');
    writeFileSync(join(f.root, 'lib', 'outside-review-result.ts'), CLASSIFIER(false));
    const r = await check(rootArgs(f));
    expectAgreement(r);
    expect(r.code).toBe(4);
    expect(drifts(r.lines).map((l) => l.split(' ')[2])).toEqual(['classifier.review-not-ready', 'classifier.structured-not-ready']);
    const at = r.lines.findIndex((l) => l.startsWith('DRIFT classifier classifier.review-not-ready '));
    expect(r.lines[at]).toBe('DRIFT classifier classifier.review-not-ready expected=findings/credited got=clean/credited');
    expect(r.lines[at + 1]).toBe('  effect: bin/outside-review: a reviewer\'s own not-ready verdict with only advisory findings is credited clean, so the stage may proceed past it');
  }, 30000);

  test('a classifier that throws is drift naming the class', async () => {
    const f = upstream('nested');
    writeFileSync(join(f.root, 'lib', 'outside-review-result.ts'), 'export function classifyOutsideReview() { throw new RangeError("secret detail"); }\n');
    const r = await check(rootArgs(f));
    expect(r.code).toBe(4);
    expect(drifts(r.lines)).toHaveLength(GOLDEN_CASES.length);
    expect(r.out).toContain('got=threw RangeError');
    expect(r.out).not.toContain('secret detail');
  }, 30000);

  test('uncredited results do not claim the reviewer was credited clean', async () => {
    const f = upstream('nested');
    writeFileSync(join(f.root, 'lib', 'outside-review-result.ts'), 'export function classifyOutsideReview() { return { execution: { state: "ran" }, findings: { highest: null }, verdict: "unverified" }; }\n');
    const r = await check(rootArgs(f));
    expect(r.code).toBe(4);
    expect(r.out).toContain('got=unverified/uncredited');
    expect(r.out).not.toContain('is credited clean');
  }, 30000);

  test('a throwing upstream error-name accessor remains redacted drift', async () => {
    const f = upstream('nested');
    writeFileSync(join(f.root, 'lib', 'claude-bin.ts'), 'const error = new Error("private message"); Object.defineProperty(error, "name", { get() { throw new Error("private getter"); } }); throw error;\n');
    const r = await check(rootArgs(f));
    expect(r.code).toBe(4);
    expect(r.out).toContain('import failed (Error)');
    expect(r.out + r.err).not.toContain('private message');
    expect(r.out + r.err).not.toContain('private getter');
  }, 30000);
});

describe('usage errors', () => {
  test.each([
    [[], '--gstack-root is required'],
    [['--bogus'], 'unknown argument --bogus'],
    [['--gstack-root'], '--gstack-root needs a value'],
    [['--gstack-root', 'relative/path'], '--gstack-root must be an absolute path'],
    [['--gstack-root', '/a', '--gstack-root', '/b'], 'duplicate --gstack-root'],
    [['--gstack-root', '/a', '--skills-dir', 'rel'], '--skills-dir must be an absolute path'],
    [['--gstack-root', '/a', '--timeout-ms', 'soon'], '--timeout-ms must be an integer'],
    [['--gstack-root', '/a', '--timeout-ms', '99'], '--timeout-ms must be an integer'],
    [['--gstack-root', '/a', '--timeout-ms', '120001'], '--timeout-ms must be an integer'],
    [['--gstack-root', '/a\nINFO forged'], '--gstack-root contains a control character'],
    [['--gstack-root', '/a\u001b[31m'], '--gstack-root contains a control character'],
  ] as [string[], string][])('%j is rejected before any work', async (args, what) => {
    const r = await check(args);
    expect(r.code).toBe(2);
    expect(r.out).toBe('');
    expect(r.err).toContain(`ERROR USAGE: ${what}`);
    expect(r.err).toMatch(/\nFIX: .+; see upstream-check --help\n$/);
  });

  test('a root inside the current git repository is a usage error', async () => {
    const repo = fresh('repo');
    expect(spawnSync('git', ['init', '-q'], { cwd: repo }).status).toBe(0);
    const f = upstream('nested', 'inrepo');
    cpSync(f.root, join(repo, 'gstack'), { recursive: true });
    const r = await check(['--gstack-root', join(repo, 'gstack')], repo);
    expect(r.code).toBe(2);
    expect(r.err).toContain('inside the current git repository');
    expect(r.out).toBe('');
    expect((await check(rootArgs(f), repo)).code).toBe(0);
  }, 30000);

  test('repository-local sibling skills are rejected even with an external upstream root', async () => {
    const repo = fresh('repo-skills');
    expect(spawnSync('git', ['init', '-q'], { cwd: repo }).status).toBe(0);
    const f = upstream('sibling');
    cpSync(f.skills, join(repo, 'skills'), { recursive: true });
    const r = await check(rootArgs(f, '--skills-dir', join(repo, 'skills')), repo);
    expect(r.code).toBe(2);
    expect(r.out).toBe('');
    expect(r.err).toContain('--skills-dir is inside the current git repository');
    const nested = upstream('nested');
    symlinkSync(nested.root, join(repo, 'nested-link'));
    // A nested layout never reads the derived sibling directory in the repo.
    expect((await check(['--gstack-root', join(repo, 'nested-link')], repo)).code).toBe(0);
  }, 30000);

  test('two-dot repository children and links to them are rejected before import', async () => {
    const repo = fresh('dot-child-repo');
    expect(spawnSync('git', ['init', '-q'], { cwd: repo }).status).toBe(0);
    const f = upstream('nested');
    const root = join(repo, '..installed', 'gstack');
    cpSync(f.root, root, { recursive: true });
    const marker = join(scratch, `import-marker-${counter++}`);
    writeFileSync(join(root, 'lib', 'claude-code.ts'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'imported'); export function runClaudeCode() {}\n`);
    const link = join(fresh('external-link'), 'gstack');
    symlinkSync(root, link);
    for (const path of [root, link]) {
      const r = await check(['--gstack-root', path], repo);
      expect(r.code).toBe(2);
      expect(r.out).toBe('');
      expect(existsSync(marker)).toBe(false);
    }
    expect((await check(rootArgs(f), repo)).code).toBe(0);
  }, 30000);

  test('failed Git discovery cannot authorize upstream imports', async () => {
    const repo = fresh('git-failure-repo');
    expect(spawnSync('git', ['init', '-q'], { cwd: repo }).status).toBe(0);
    const f = upstream('nested');
    const root = join(repo, 'gstack');
    cpSync(f.root, root, { recursive: true });
    const marker = join(scratch, `git-failure-marker-${counter++}`);
    writeFileSync(join(root, 'lib', 'claude-code.ts'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'imported'); export function runClaudeCode() {}\n`);
    const missing = fresh('missing-git');
    const broken = fresh('broken-git');
    put(join(broken, 'git'), '#!/bin/sh\nprintf "fatal: cannot inspect repository\\n" >&2\nexit 128\n');
    chmodSync(join(broken, 'git'), 0o755);
    const oldPath = process.env.PATH;
    try {
      for (const path of [missing, broken]) {
        process.env.PATH = path;
        const r = await check(['--gstack-root', root], repo);
        expect(r.code).toBe(1);
        expect(r.out).toBe('');
        expect(r.err).toContain('ERROR INTERNAL:');
        expect(existsSync(marker)).toBe(false);
      }
    } finally { process.env.PATH = oldPath; }
  }, 30000);

  test('repository discovery crosses mount boundaries before deciding there is no repository', async () => {
    const git = fresh('mount-boundary-git');
    put(join(git, 'git'), '#!/bin/sh\nif [ "${GIT_DISCOVERY_ACROSS_FILESYSTEM:-}" = 1 ]; then\n  printf "fatal: not a git repository (or any of the parent directories): .git\\n" >&2\nelse\n  printf "fatal: not a git repository (or any parent up to mount point /fixture)\\nStopping at filesystem boundary (GIT_DISCOVERY_ACROSS_FILESYSTEM not set).\\n" >&2\nfi\nexit 128\n');
    chmodSync(join(git, 'git'), 0o755);
    const old = process.env.PATH;
    try {
      process.env.PATH = git;
      const r = await check(rootArgs(upstream('nested')));
      expect(r.code).toBe(0);
      expectAgreement(r);
    } finally { process.env.PATH = old; }
  }, 30000);

  test('inherited Git selection cannot redirect containment or installed revision', async () => {
    const repo = fresh('git-env-repo');
    const foreign = fresh('git-env-foreign');
    for (const path of [repo, foreign]) expect(spawnSync('git', ['init', '-q'], { cwd: path }).status).toBe(0);
    expect(spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd: foreign }).status).toBe(0);
    const f = upstream('nested');
    const root = join(repo, 'gstack');
    cpSync(f.root, root, { recursive: true });
    const old = process.env.GIT_DIR;
    try {
      process.env.GIT_DIR = join(foreign, '.git');
      expect((await check(['--gstack-root', root], repo)).code).toBe(2);
      const outside = await check(rootArgs(f));
      expect(outside.code).toBe(0);
      expect(outside.lines).toContain('INFO upstream-revision unknown');
    } finally { if (old === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = old; }
  }, 30000);

  test('an internal failure prints the contract on stderr and nothing on stdout', async () => {
    let out = '', err = '';
    const code = await main(rootArgs(upstream('nested')), {
      stdout: (t) => { out += t; }, stderr: (t) => { err += t; }, get cwd() { throw new Error('disk\nfull'); },
    });
    expect(code).toBe(1);
    expect(out).toBe('');
    expect(err).toMatch(/^ERROR INTERNAL: disk full\n/);
    expect(err).toContain(`upstream-check ${readFileSync(join(REPO, 'VERSION'), 'utf8').trim()} bun `);
    expect(err.trimEnd().split('\n').at(-1)).toBe('FIX: rerun once; if it repeats, report this output');
    expect(err.split('\n').filter((l) => /^\s+at /.test(l)).length).toBeLessThanOrEqual(5);
  }, 30000);

  test('a failed stdout flush is attempted once and reports an internal error', async () => {
    let calls = 0, err = '';
    const code = await main(rootArgs(upstream('nested')), {
      stdout: () => { calls++; throw new Error('output closed'); }, stderr: (t) => { err += t; }, cwd,
    });
    expect(code).toBe(1);
    expect(calls).toBe(1);
    expect(err).toStartWith('ERROR INTERNAL: output closed\n');
  }, 30000);
});

describe('launcher', () => {
  const launch = (args: string[], env: Record<string, string> = {}, where = cwd, bin = LAUNCHER) =>
    spawnSync('sh', [bin, ...args], { cwd: where, encoding: 'utf8', timeout: 30000, env: { ...process.env, ...env } });

  test('--help documents the grammar, exit table and docs; --version prints the extension version', () => {
    const help = launch(['--help']);
    expect(help.status).toBe(0);
    for (const text of [FORMAT, 'RESULT ok|drift', 'Exit: 0', '4 any check drifted', '2 usage error', '5 Bun missing', 'docs/upstream-check.md']) expect(help.stdout).toContain(text);
    const version = launch(['--version']);
    expect(version.stdout).toBe(`upstream-check ${readFileSync(join(REPO, 'VERSION'), 'utf8').trim()}\n`);
  }, 40000);

  test('exit status and RESULT agree end to end', () => {
    const f = upstream('nested');
    const ok = launch(rootArgs(f));
    expect([ok.status, ok.stdout.trimEnd().split('\n').at(-1)]).toEqual([0, `RESULT ok checks=${CHECKS} drift=0`]);
    writeFileSync(f.files.review!, '# nothing\n');
    const bad = launch(rootArgs(f));
    expect(bad.status).toBe(4);
    expect(bad.stdout.trimEnd().split('\n').at(-1)).toMatch(/^RESULT drift /);
    expect(launch([]).status).toBe(2);
  }, 60000);

  test('without Bun on an absolute PATH it exits 5 with ERROR bun_missing and a FIX', () => {
    const r = spawnSync('/bin/sh', [LAUNCHER, '--help'], { encoding: 'utf8', timeout: 20000, env: { PATH: '/nonexistent:relative' } });
    expect(r.status).toBe(5);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^ERROR bun_missing: .+\nFIX: install Bun >= 1\.3\.3; see upstream-check --help\n$/);
  }, 30000);

  test('a copied tree with a reworded in-cap paragraph reports DRIFT inventory and exits 4', () => {
    const copy = fresh('copy');
    cpSync(join(REPO, 'src'), join(copy, 'src'), { recursive: true });
    mkdirSync(join(copy, 'bin'));
    cpSync(LAUNCHER, join(copy, 'bin', 'upstream-check'));
    writeFileSync(join(copy, 'VERSION'), '9.9.9\n');
    put(join(copy, 'skills', 'review-and-prep.md'),
      readFileSync(join(REPO, 'skills', 'review-and-prep.md'), 'utf8').replace(HEADING, "**`/review`'s repeat cycles (`in-cap=delta`).**"));
    const f = upstream('nested');
    const r = launch(rootArgs(f), {}, cwd, join(copy, 'bin', 'upstream-check'));
    expect(r.status).toBe(4);
    expect(r.stdout).toContain('DRIFT inventory review-and-prep.incap in-cap paragraph not found');
    expect(r.stdout).toContain('INFO extend-version 9.9.9');
    expect(r.stdout).toContain(`INFO extend-root ${realpathSync(copy)}`);
    expect(r.stdout.trimEnd().split('\n').at(-1)).toMatch(/^RESULT drift /);
  }, 40000);

  // Value: protects=a reworded activation paragraph reports its own inventory drift and leaves the in-cap gate alone; fails_when=the Fix-First list reuses the in-cap check or vanishes silently; why_new=second inventory source; seam=none
  test('a copied tree with a reworded activation paragraph reports DRIFT inventory for Fix-First only', () => {
    const copy = fresh('copy-fix-first');
    cpSync(join(REPO, 'src'), join(copy, 'src'), { recursive: true });
    mkdirSync(join(copy, 'bin'));
    cpSync(LAUNCHER, join(copy, 'bin', 'upstream-check'));
    writeFileSync(join(copy, 'VERSION'), '9.9.9\n');
    put(join(copy, 'skills', 'review-and-prep.md'),
      readFileSync(join(REPO, 'skills', 'review-and-prep.md'), 'utf8').replace(FIX_FIRST_HEADING, '**Activation of the repair value.**'));
    const r = launch(rootArgs(upstream('nested')), {}, cwd, join(copy, 'bin', 'upstream-check'));
    expect(r.status).toBe(4);
    expect(r.stdout).toContain('DRIFT inventory review-and-prep.fix-first activation paragraph not found');
    expect(r.stdout).toContain('OK inventory review-and-prep.incap');
    for (const n of [1, 2, 3]) expect(r.stdout).toContain(`OK anchor review-and-prep.incap.${n}`);
    expect(r.stdout).not.toContain('review-and-prep.fix-first.review.');
    expect(r.stdout).toContain('  effect: /review-and-prep: the Fix-First anchors cannot be listed, so repair-review=behavior-changing is unverified and stays inactive');
    expect(r.stdout.trimEnd().split('\n').at(-1)).toBe(`RESULT drift checks=${CHECKS - 6} drift=1`);
  }, 40000);

  // Value: protects=a reworded test-gap activation paragraph reports its own inventory drift and leaves the other inventories alone; fails_when=the test-gap list reuses another check or vanishes silently; why_new=third inventory source; seam=none
  test('a copied tree with a reworded activation paragraph reports DRIFT inventory for test-gaps only', () => {
    const copy = fresh('copy-test-gaps');
    cpSync(join(REPO, 'src'), join(copy, 'src'), { recursive: true });
    mkdirSync(join(copy, 'bin'));
    cpSync(LAUNCHER, join(copy, 'bin', 'upstream-check'));
    writeFileSync(join(copy, 'VERSION'), '9.9.9\n');
    put(join(copy, 'skills', 'review-and-prep.md'),
      readFileSync(join(REPO, 'skills', 'review-and-prep.md'), 'utf8').replace(TEST_GAP_HEADING, '**Activation of the gap value.**'));
    const r = launch(rootArgs(upstream('nested')), {}, cwd, join(copy, 'bin', 'upstream-check'));
    expect(r.status).toBe(4);
    expect(r.stdout).toContain('DRIFT inventory review-and-prep.test-gaps activation paragraph not found');
    expect(r.stdout).toContain('OK inventory review-and-prep.incap');
    expect(r.stdout).toContain('OK inventory review-and-prep.fix-first');
    expect(r.stdout).not.toContain('review-and-prep.test-gaps.review.');
    expect(r.stdout).toContain('  effect: /review-and-prep: the test-gap anchors cannot be listed, so test-gaps=record is unverified and stays inactive');
    expect(r.stdout.trimEnd().split('\n').at(-1)).toBe(`RESULT drift checks=${CHECKS - TEST_GAP_ANCHORS} drift=1`);
  }, 40000);

  // Value: protects=a reworded pregate-narrowing activation paragraph reports its own inventory drift and leaves the other inventories alone; fails_when=the narrowing list reuses another check or vanishes silently; why_new=fourth inventory source; seam=none
  test('a copied tree with a reworded activation paragraph reports DRIFT inventory for the pregate narrowing only', () => {
    const copy = fresh('copy-pregate-narrow');
    cpSync(join(REPO, 'src'), join(copy, 'src'), { recursive: true });
    mkdirSync(join(copy, 'bin'));
    cpSync(LAUNCHER, join(copy, 'bin', 'upstream-check'));
    writeFileSync(join(copy, 'VERSION'), '9.9.9\n');
    put(join(copy, 'skills', 'review-and-prep.md'),
      readFileSync(join(REPO, 'skills', 'review-and-prep.md'), 'utf8').replace(PREGATE_NARROW_HEADING, '**Activation of the narrowing.**'));
    const r = launch(rootArgs(upstream('nested')), {}, cwd, join(copy, 'bin', 'upstream-check'));
    expect(r.status).toBe(4);
    expect(r.stdout).toContain('DRIFT inventory review-and-prep.pregate-narrowing activation paragraph not found');
    for (const gate of ['incap', 'fix-first', 'test-gaps']) expect(r.stdout).toContain(`OK inventory review-and-prep.${gate}`);
    expect(r.stdout).not.toContain('review-and-prep.pregate-narrowing.bin.');
    expect(r.stdout).toContain('  effect: /review-and-prep: the pregate-narrowing anchors cannot be listed, so narrowing is unverified and the pregate runs as today');
    expect(r.stdout.trimEnd().split('\n').at(-1)).toBe(`RESULT drift checks=${CHECKS - PREGATE_NARROW_ANCHORS} drift=1`);
  }, 40000);

  test('a missing extension dependency uses the internal-error contract before output', () => {
    const copy = fresh('missing-local-module');
    cpSync(join(REPO, 'src'), join(copy, 'src'), { recursive: true });
    put(join(copy, 'bin', 'upstream-check'), readFileSync(LAUNCHER, 'utf8'));
    put(join(copy, 'VERSION'), '9.9.9\n');
    rmSync(join(copy, 'src', 'autoplan-lean', 'criteria.ts'));
    for (const args of [[], ['--bogus']]) {
      const usage = launch(args, {}, cwd, join(copy, 'bin', 'upstream-check'));
      expect(usage.status).toBe(2);
      expect(usage.stdout).toBe('');
      expect(usage.stderr).toMatch(/^ERROR USAGE: /);
    }
    for (const flag of ['--help', '--version']) {
      expect(launch([flag], {}, cwd, join(copy, 'bin', 'upstream-check')).status).toBe(0);
    }
    const r = launch(rootArgs(upstream('nested')), {}, cwd, join(copy, 'bin', 'upstream-check'));
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^ERROR INTERNAL: /);
    expect(r.stderr).toContain('upstream-check 9.9.9 bun ');
    expect(r.stderr.trimEnd().split('\n').at(-1)).toBe('FIX: rerun once; if it repeats, report this output');
  }, 40000);

  test('a missing launcher source is an internal installation failure, not missing Bun', () => {
    const copy = fresh('missing-launcher-source');
    put(join(copy, 'bin', 'upstream-check'), readFileSync(LAUNCHER, 'utf8'));
    const r = launch(['--help'], {}, cwd, join(copy, 'bin', 'upstream-check'));
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^ERROR INTERNAL: source_missing:/);
    expect(r.stderr).toContain('upstream-check unknown bun ');
    expect(r.stderr).toContain('FIX: re-run ./setup');
  }, 30000);

  test.each(['startup', 'owned-catch'] as const)('a child-only %s fault remains internal with no report', (where) => {
    const copy = fresh('child-owned-fault');
    cpSync(join(REPO, 'src'), join(copy, 'src'), { recursive: true });
    cpSync(join(REPO, 'skills'), join(copy, 'skills'), { recursive: true });
    put(join(copy, 'bin', 'upstream-check'), readFileSync(LAUNCHER, 'utf8'));
    put(join(copy, 'VERSION'), '9.9.9\n');
    const probePath = join(copy, 'src', 'upstream-check', 'probe.ts');
    const source = readFileSync(probePath, 'utf8');
    writeFileSync(probePath, where === 'startup'
      ? 'if (import.meta.main) throw new Error("child-only fault");\n' + source
      : source.replace('await probe(resolve(root)', 'throw new Error("child-only fault");\n    await probe(resolve(root)'));
    const r = launch(rootArgs(upstream('nested')), {}, cwd, join(copy, 'bin', 'upstream-check'));
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('ERROR INTERNAL: extension probe failed before producing a result');
    expect(r.stderr).not.toContain('child-only fault');
  }, 40000);

  test.each([
    ['invalid JSON', '"{"'],
    ['missing rows', 'JSON.stringify({ exports: [] })'],
    ['wrong field type', 'JSON.stringify({ ...result, classifier: result.classifier.map(c => ({ ...c, credited: "yes" })) })'],
  ])('a nonce-correct result with %s is drift', (_name, expression) => {
    const copy = fresh('malformed-frame');
    cpSync(join(REPO, 'src'), join(copy, 'src'), { recursive: true });
    cpSync(join(REPO, 'skills'), join(copy, 'skills'), { recursive: true });
    put(join(copy, 'bin', 'upstream-check'), readFileSync(LAUNCHER, 'utf8'));
    put(join(copy, 'VERSION'), '9.9.9\n');
    const probe = join(copy, 'src', 'upstream-check', 'probe.ts');
    const source = readFileSync(probe, 'utf8');
    expect(source).toContain('JSON.stringify(result)');
    writeFileSync(probe, source.replace('JSON.stringify(result)', expression));
    const r = launch(rootArgs(upstream('nested')), {}, cwd, join(copy, 'bin', 'upstream-check'));
    expect(r.status).toBe(4);
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('probe result malformed');
    expect(r.stdout.trimEnd().split('\n').at(-1)).toBe(`RESULT drift checks=${CHECKS} drift=7`);
    expect(r.stdout).not.toContain('"credited"');
  }, 40000);

  test('a timely probe exit is not timed out while inherited pipes drain', () => {
    const copy = fresh('inherited-pipe');
    cpSync(join(REPO, 'src'), join(copy, 'src'), { recursive: true });
    cpSync(join(REPO, 'skills'), join(copy, 'skills'), { recursive: true });
    put(join(copy, 'bin', 'upstream-check'), readFileSync(LAUNCHER, 'utf8'));
    put(join(copy, 'VERSION'), '9.9.9\n');
    const cli = join(copy, 'src', 'upstream-check', 'cli.ts');
    const source = readFileSync(cli, 'utf8');
    // Stretch only the drain window in this disposable installation. This puts
    // the ordinary 20-second execution deadline inside it without a flaky
    // startup-speed assertion or a new production test hook.
    expect(source).toContain('finish(code, signal), 250');
    writeFileSync(cli, source.replace('finish(code, signal), 250', 'finish(code, signal), 22000'));
    const f = upstream('nested');
    put(join(f.root, 'lib', 'claude-bin.ts'), "import { spawn } from 'node:child_process';\nspawn(process.execPath, ['-e', 'setTimeout(() => {}, 21000)'], { stdio: ['ignore', 'inherit', 'inherit'] }).unref();\nexport function resolveClaudeCommand() { return null; }\n");
    const r = launch(rootArgs(f), {}, cwd, join(copy, 'bin', 'upstream-check'));
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout.trimEnd().split('\n').at(-1)).toBe(`RESULT ok checks=${CHECKS} drift=0`);
  }, 40000);

  test('a relative symlinked launcher resolves the extension installation', () => {
    const dir = fresh('launcher-link');
    const link = join(dir, 'upstream-check');
    symlinkSync(relative(realpathSync(dir), realpathSync(LAUNCHER)), link);
    const r = launch(rootArgs(upstream('nested')), {}, cwd, link);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`INFO extend-root ${realpathSync(REPO)}`);
    expect(r.stdout.trimEnd().split('\n').at(-1)).toBe(`RESULT ok checks=${CHECKS} drift=0`);
  }, 40000);
});

describe('installed upstream', () => {
  test.skipIf(!process.env.GSTACK_OUTSIDE_TEST_ROOT)('the root named by GSTACK_OUTSIDE_TEST_ROOT passes every check', async () => {
    const r = await check(['--gstack-root', process.env.GSTACK_OUTSIDE_TEST_ROOT!]);
    expect(r.out).not.toContain('DRIFT');
    expect(r.code).toBe(0);
    expectAgreement(r);
  }, 30000);
});

/** Presence-gate idioms in skills and upstream-root imports in source (CEO-8). */
function scanGates(repo: string) {
  const hits: { file: string; line: number; text: string; offset?: number }[] = [];
  const scan = (dir: string, accept: RegExp, line: RegExp) => {
    for (const entry of readdirSync(join(repo, dir), { withFileTypes: true, recursive: true })) {
      if (!entry.isFile() || !accept.test(entry.name)) continue;
      const path = join(entry.parentPath, entry.name);
      readFileSync(path, 'utf8').split('\n').forEach((text, i) => { if (line.test(text)) hits.push({ file: relative(repo, path), line: i + 1, text }); });
    }
  };
  for (const entry of readdirSync(join(repo, 'skills'), { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const path = join(entry.parentPath, entry.name);
    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(/byte\s+for\s+byte|grep\s+-F/g)) {
      const offset = match.index!;
      const start = text.lastIndexOf('\n', offset) + 1;
      const end = text.indexOf('\n', offset + match[0].length);
      hits.push({ file: relative(repo, path), line: text.slice(0, offset).split('\n').length,
        text: text.slice(start, end < 0 ? undefined : end), offset });
    }
  }
  scan('src', /\.ts$/, /\bimport\s*\((?!\s*['"`]\.{1,2}\/)/);
  const adapter = 'src/outside-review/cli.ts';
  readFileSync(join(repo, adapter), 'utf8').split('\n').forEach((text, i) => {
    if (/\bload\s*\(/.test(text)) hits.push({ file: adapter, line: i + 1, text });
  });
  return hits;
}
/** Hits covered by the runtime inventory: the two anchor paragraphs, and the two readers of the helper list. */
function unlisted(repo: string) {
  const skill = readFileSync(join(repo, 'skills', 'review-and-prep.md'), 'utf8');
  // Only the inventory delimiters are covered (the in-cap list opens once, the
  // activation paragraph's two lists open twice), not other gates that happen
  // to share their paragraph or line. Missing/reworded delimiters exempt nothing.
  const delimiters = (heading: string, lists: number) => {
    const start = skill.indexOf(heading);
    const blank = skill.indexOf('\n\n', start);
    const paragraph = start < 0 ? '' : skill.slice(start, blank < 0 ? undefined : blank);
    const offsets: number[] = [];
    let at = -1;
    for (let i = 0; i < lists && (at = paragraph.indexOf('byte for byte,', at + 1)) >= 0; i++) offsets.push(start + at);
    const grep = paragraph.indexOf('Check each with `grep -F`');
    if (grep >= 0) offsets.push(start + grep + 'Check each with `'.length);
    return offsets;
  };
  const covered = [...delimiters(HEADING, 1), ...delimiters(FIX_FIRST_HEADING, 2), ...delimiters(TEST_GAP_HEADING, 4), ...delimiters(PREGATE_NARROW_HEADING, 3)];
  return scanGates(repo).filter((hit) => {
    if (hit.file === 'skills/review-and-prep.md' && hit.offset !== undefined && covered.includes(hit.offset)) return false;
    // Only the reviewed list-driven loader sites are covered; a new import or
    // load() call in either existing file must produce its own diagnostic.
    const adapter = hit.file === 'src/outside-review/cli.ts';
    if (adapter && hit.text.trim() === "const load = (name: string) => import(pathToFileURL(join(resolve(root), 'lib', name + '.ts')).href);") return false;
    if (adapter && hit.text.trim() === 'for (const { module, name } of UPSTREAM_HELPERS) loaded[name] = (await load(module))[name];') return false;
    if (hit.file === 'src/upstream-check/probe.ts' && hit.text.trim() === 'const imported = await import(pathToFileURL(path).href);') return false;
    return !EXEMPTIONS.some((e) => e.file === hit.file && hit.text.includes(e.includes) && e.reason.trim());
  });
}
const guidance = (hits: ReturnType<typeof unlisted>) => hits.map((h) =>
  `${h.file}:${h.line}: add it to the runtime inventory source (the in-cap paragraph of skills/review-and-prep.md or UPSTREAM_HELPERS), or add it to EXEMPTIONS in src/upstream-check/cli.ts with a reason`).join('\n');

describe('completeness of the inventory', () => {
  test('every gate idiom and upstream-root import is in the runtime inventory or exempted with a reason', () => {
    const hits = unlisted(REPO);
    expect(guidance(hits)).toBe('');
    expect(EXEMPTIONS.every((e) => e.reason.length > 20)).toBe(true);
    // The exemptions still match something; a stale one would hide a future gate.
    for (const e of EXEMPTIONS) expect(scanGates(REPO).some((h) => h.file === e.file && h.text.includes(e.includes))).toBe(true);
  });

  test('a fixture copy with one added gate idiom fails and names file:line and both remedies', () => {
    const copy = fresh('gates');
    cpSync(join(REPO, 'skills'), join(copy, 'skills'), { recursive: true });
    cpSync(join(REPO, 'src'), join(copy, 'src'), { recursive: true });
    expect(unlisted(copy)).toEqual([]);
    put(join(copy, 'skills', 'added.md'), 'Run only while the installed file still contains, byte for byte, `X`.\n');
    put(join(copy, 'src', 'added', 'cli.ts'), 'const load = (n: string) => import(join(root, n));\n');
    const message = guidance(unlisted(copy));
    expect(message).toContain('skills/added.md:1: add it to the runtime inventory source');
    expect(message).toContain('src/added/cli.ts:1: add it to the runtime inventory source');
    expect(message).toContain('or add it to EXEMPTIONS in src/upstream-check/cli.ts with a reason');
  });

  test('wrapped gates, same-paragraph additions and a moved heading keep actionable diagnostics', () => {
    const copy = fresh('paragraph-gates');
    cpSync(join(REPO, 'skills'), join(copy, 'skills'), { recursive: true });
    cpSync(join(REPO, 'src'), join(copy, 'src'), { recursive: true });
    const file = join(copy, 'skills', 'review-and-prep.md');
    const original = readFileSync(file, 'utf8');
    const start = original.indexOf(HEADING);
    const end = original.indexOf('\n\n', start);
    writeFileSync(file, original.slice(0, end) + ' Also check `NEW_GATE` with `grep -F`.' + original.slice(end));
    expect(inventory(copy)).toEqual({ ...inventory(REPO), file: realpathSync(file) });
    expect(guidance(unlisted(copy))).toContain('skills/review-and-prep.md:');
    put(join(copy, 'skills', 'wrapped.md'), 'Match byte for\nbyte, or use `grep\n-F`.\n');
    expect(unlisted(copy).filter(h => h.file === 'skills/wrapped.md')).toHaveLength(2);
    writeFileSync(file, original.replace(HEADING, '**Moved heading**'));
    const message = guidance(unlisted(copy));
    expect(message).toContain('skills/review-and-prep.md:');
    expect(message).toContain('add it to the runtime inventory source');
    expect(message).toContain('or add it to EXEMPTIONS');
  });

  test('new imports and loader calls in existing readers are not silently exempted', () => {
    const copy = fresh('existing-reader-gates');
    cpSync(join(REPO, 'skills'), join(copy, 'skills'), { recursive: true });
    cpSync(join(REPO, 'src'), join(copy, 'src'), { recursive: true });
    for (const file of ['src/outside-review/cli.ts', 'src/upstream-check/probe.ts']) {
      const original = readFileSync(join(copy, file), 'utf8');
      writeFileSync(join(copy, file), `${original}\nawait import(join(root, 'lib', 'new-helper.ts'));\n`);
      expect(guidance(unlisted(copy))).toContain(`${file}:${original.split('\n').length + 1}:`);
      writeFileSync(join(copy, file), original);
    }
    const file = 'src/outside-review/cli.ts';
    const original = readFileSync(join(copy, file), 'utf8');
    writeFileSync(join(copy, file), `${original}\nawait load('new-helper');\n`);
    expect(guidance(unlisted(copy))).toContain(`${file}:${original.split('\n').length + 1}:`);
  });
});

describe('docs and wiring', () => {
  const docs = readFileSync(join(REPO, 'docs', 'upstream-check.md'), 'utf8');
  const outside = readFileSync(join(REPO, 'docs', 'outside-review.md'), 'utf8');

  const revisions = (text: string) => [...text.matchAll(/^\| (Wrapper anchors[^|]*|Fix-First anchors[^|]*|Test-gap anchors[^|]*|Pregate-narrowing anchors[^|]*|Reviewer criteria copies|Outside-review adapter) \| `([0-9a-f]{40})` \| ([^|]+) \|$/gm)]
    .map((m) => [m[1], m[2], m[3]]);
  const expectedRevisions = [
    ['Wrapper anchors and classifier cases (qualified by this Track)', ANCHORS_QUALIFIED.revision, ANCHORS_QUALIFIED.version],
    ['Fix-First anchors', FIX_FIRST_QUALIFIED.revision, FIX_FIRST_QUALIFIED.version],
    ['Test-gap anchors', TEST_GAP_QUALIFIED.revision, TEST_GAP_QUALIFIED.version],
    ['Pregate-narrowing anchors', PREGATE_NARROW_QUALIFIED.revision, PREGATE_NARROW_QUALIFIED.version],
    ['Reviewer criteria copies', UPSTREAM.commit, UPSTREAM.version],
    ['Outside-review adapter', INSPECTED_UPSTREAM.revision, INSPECTED_UPSTREAM.version],
  ];
  test('the documents state the same inspected revisions as the constants', () => {
    expect(revisions(docs)).toEqual(expectedRevisions);
    expect(outside).toContain(INSPECTED_UPSTREAM.revision);
    expect(outside).toContain('UPSTREAM_HELPERS');
    expect(outside).toContain('(upstream-check.md)');
    // No other full revision is claimed as the inspected one.
    const allowed = new Set([INSPECTED_UPSTREAM.revision, 'd8753130710de2647f7ea3bdd19ffa793f3d5c6d']);
    for (const sha of outside.match(/\b[0-9a-f]{40}\b/g) ?? []) expect(allowed.has(sha)).toBe(true);
  });

  test('one wrong contract revision is detected even when its SHA still appears elsewhere', () => {
    const changed = docs.replace(`| \`${ANCHORS_QUALIFIED.revision}\` |`, `| \`${'0'.repeat(40)}\` |`);
    expect(changed).toContain(ANCHORS_QUALIFIED.revision);
    expect(revisions(changed)).not.toEqual(expectedRevisions);
  });

  test('the lease limit distinguishes initial qualification from a later observed version change', () => {
    expect(docs).toContain('120 minutes');
    expect(docs).toContain('gstack-skill-start');
    expect(docs).toContain('gstack-lease touch');
    expect(docs).toContain('No mid-run upgrade has been observed.');
    expect(docs).toContain('"not\nobserved" is not evidence that none happened');
    expect(docs).toContain('Initial qualification recorded');
    expect(docs).toContain('does not establish lease expiry as its cause');
  });

  test('the docs define OK narrowly, list every drift kind and record a timing profile', () => {
    expect(docs).toContain('`OK` means only that the listed anchors, exports, classifier cases and known\ncriteria paragraphs matched');
    for (const kind of ['root', 'inventory', 'anchor', 'export', 'classifier', 'criteria']) expect(docs).toContain(`id="drift-${kind}"`);
    expect(docs).toContain('## Measured startup profile');
    expect(docs).toMatch(/Bun \d+\.\d+\.\d+/);
    expect(docs).toMatch(/observed maximum/i);
    expect(docs).not.toContain('TIMING_PLACEHOLDER');
  });

  test('a change to an otherwise unrelated src file selects this suite', () => {
    const tests = ['tests/upstream-check.test.ts', 'tests/layout-scaffold.test.ts'];
    const selection = computeTestSelection(['src/layout-scaffold/plan.ts'], tests, { repoRoot: REPO });
    expect(selection.selected).toContain('tests/upstream-check.test.ts');
    expect(existsSync(join(REPO, 'bin', 'upstream-check'))).toBe(true);
  });
});
