import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { INSPECTED_UPSTREAM, UPSTREAM_HELPERS } from '../src/outside-review/cli';
import { UPSTREAM_FINDING_ANCHORS } from '../src/secret-dispositions/evaluate';
import { ANCHORS_QUALIFIED, ATTACKER_QUALIFIED, DELEGATE_QUALIFIED, EXEMPTIONS, FINDING_LOCATION_QUALIFIED, FIX_FIRST_QUALIFIED, FOLD_CHECKLISTS, FOLD_QUALIFIED, FORMAT, OVERLAP_QUALIFIED, PREGATE_NARROW_QUALIFIED, TEST_GAP_QUALIFIED, attackerInventory, delegateInventory, fixFirstInventory, foldInventory, inventory, main, overlapInventory, pregateNarrowInventory, testGapInventory } from '../src/upstream-check/cli';
import { GOLDEN_CASES } from '../src/upstream-check/probe';
import { computeTestSelection } from './helpers/touchfiles';

const REPO = join(import.meta.dir, '..');
const LAUNCHER = join(REPO, 'bin', 'upstream-check');
const CHECKS = 108; // root, 8 inventory, 3 in-cap + 6 Fix-First + 16 test-gap + 9 pregate-narrowing + 21 delegate + 18 fold + 8 overlap + 9 attacker + 2 finding-location anchors, 3 exports, 4 classifier cases
const scratch = mkdtempSync(join(tmpdir(), 'extend-upstream-check-'));
// Each check builds a fixture tree under `scratch`; cleanup took 17.4 s under load, so allow 30 s for removal.
afterAll(() => rmSync(scratch, { recursive: true, force: true }), 30000);
let counter = 0;
const fresh = (label: string) => { const dir = join(scratch, `${label}-${counter++}`); mkdirSync(dir, { recursive: true }); return dir; };
const put = (path: string, body: string) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, body); };

const HEADING = "**`/review`'s own repeat cycles (`in-cap=delta`).**";
const FIX_FIRST_HEADING = '**Activation (`repair-review=behavior-changing`).**';
const TEST_GAP_HEADING = '**Activation (`test-gaps=record`).**';
const PREGATE_NARROW_HEADING = '**Activation (narrowed pregate).**';
const DELEGATE_HEADING = '**Activation (`delegate`).**';
const FOLD_HEADING = '**Activation (`specialists=fold`).**';
const OVERLAP_HEADING = '**Activation (`first-cycle=overlap`).**';
const ATTACKER_HEADING = '**Activation (attacker parts).**';
const TEST_GAP_ANCHORS = 16;
const PREGATE_NARROW_ANCHORS = 9;
const DELEGATE_ANCHORS = 21;
const FOLD_ANCHORS = 18;
const OVERLAP_ANCHORS = 8;
const ATTACKER_ANCHORS = 9;
const FOLD_NAMES = FOLD_CHECKLISTS.map((c) => c.name);
const DELEGATE_PARTS = ['testing', 'maintainability', 'performance', 'simplification'] as const;
const CURRENT_ANCHORS = (() => { const inv = inventory(REPO); if (!inv.ok) throw new Error(inv.reason); return inv.anchors; })();
const FIX_FIRST = (() => { const inv = fixFirstInventory(REPO); if (!inv.ok) throw new Error(inv.reason); return inv; })();
const TEST_GAP = (() => { const inv = testGapInventory(REPO); if (!inv.ok) throw new Error(inv.reason); return inv; })();
const PREGATE_NARROW = (() => { const inv = pregateNarrowInventory(REPO); if (!inv.ok) throw new Error(inv.reason); return inv; })();
const DELEGATE = (() => { const inv = delegateInventory(REPO); if (!inv.ok) throw new Error(inv.reason); return inv; })();
const FOLD = (() => { const inv = foldInventory(REPO); if (!inv.ok) throw new Error(inv.reason); return inv; })();
const OVERLAP = (() => { const inv = overlapInventory(REPO); if (!inv.ok) throw new Error(inv.reason); return inv; })();
const ATTACKER = (() => { const inv = attackerInventory(REPO); if (!inv.ok) throw new Error(inv.reason); return inv; })();

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
const reviewText = () => `# review\n\n${CURRENT_ANCHORS.join('\n')}\n${FIX_FIRST.review.join('\n')}\n${TEST_GAP.review.join('\n')}\n${DELEGATE.review.join('\n')}\n${DELEGATE.dispatchItem.join('\n')}\n${FOLD.review.join('\n')}\n${OVERLAP.review.join('\n')}\n${ATTACKER['adversarial-item'].join('\n')}\n`;
const adversarialText = () => `# adversarial\n\n${OVERLAP.adversarial.join('\n')}\n${ATTACKER.adversarial.join('\n')}\n`;
const redTeamText = () => `# red-team\n\n${ATTACKER['red-team'].join('\n')}\n`;
const checklistText = () => `# checklist\n\n${FIX_FIRST.checklist.join('\n')}\n${TEST_GAP.checklist.join('\n')}\n`;
const testingText = () => `# testing\n\n${TEST_GAP.testing.join('\n')}\n${DELEGATE.testing.join('\n')}\n${FOLD.checklists.testing.join('\n')}\n`;
const specialistText = (part: Exclude<(typeof DELEGATE_PARTS)[number], 'testing'>) => `# ${part}\n\n${DELEGATE[part].join('\n')}\n${FOLD.checklists[part].join('\n')}\n`;
const FOLD_ONLY = ['security', 'data-migration', 'api-contract', 'state-machines', 'design'] as const;
const foldOnlyPath = (root: string, name: (typeof FOLD_ONLY)[number]) => name === 'design' ? join(root, 'review', 'design-checklist.md') : join(root, 'review', 'specialists', `${name}.md`);
const foldOnlyText = (name: (typeof FOLD_ONLY)[number]) => `# ${name}\n\n${FOLD.checklists[name].join('\n')}\n`;
const coverageText = () => `# coverage\n\n${TEST_GAP.coverage.join('\n')}\n`;
const pregateBinText = () => `# gstack-pregate\n\n${PREGATE_NARROW.bin.join('\n')}\n`;
const pregateIndexText = () => `// index\n\n${PREGATE_NARROW.index.join('\n')}\n`;
const pregateLanesText = () => `// lanes\n\n${PREGATE_NARROW.lanes.join('\n')}\n`;
const pregateSecretsText = () => `// secrets\n\n${UPSTREAM_FINDING_ANCHORS.join('\n')}\n`;

interface Fixture { root: string; skills: string; files: Record<string, string> }
/** A minimal installed upstream that satisfies every check, in either layout. */
function upstream(layout: 'nested' | 'sibling', label = layout): Fixture {
  const skills = fresh(label);
  const root = join(skills, 'gstack');
  const files: Record<string, string> = {};
  put(join(root, 'VERSION'), '1.2.3.4\n');
  files.checklist = join(root, 'review', 'checklist.md');
  put(files.checklist, checklistText());
  files.testing = join(root, 'review', 'specialists', 'testing.md');
  put(files.testing, testingText());
  files['red-team'] = join(root, 'review', 'specialists', 'red-team.md');
  put(files['red-team'], redTeamText());
  for (const part of DELEGATE_PARTS.filter((p) => p !== 'testing')) {
    files[part] = join(root, 'review', 'specialists', `${part}.md`);
    put(files[part]!, specialistText(part as Exclude<(typeof DELEGATE_PARTS)[number], 'testing'>));
  }
  // The fold's other checklists sit under the gstack root in both layouts.
  for (const name of FOLD_ONLY) {
    files[name] = foldOnlyPath(root, name);
    put(files[name]!, foldOnlyText(name));
  }
  // The pregate sits under the gstack root in both layouts.
  files.pregateBin = join(root, 'bin', 'gstack-pregate');
  files.pregateIndex = join(root, 'lib', 'pregate', 'index.ts');
  files.pregateLanes = join(root, 'lib', 'pregate', 'checks', 'lanes.ts');
  files.pregateSecrets = join(root, 'lib', 'pregate', 'checks', 'secrets.ts');
  put(files.pregateBin, pregateBinText());
  put(files.pregateIndex, pregateIndexText());
  put(files.pregateLanes, pregateLanesText());
  put(files.pregateSecrets, pregateSecretsText());
  for (const [name, body] of Object.entries(MODULES)) put(join(root, 'lib', `${name}.ts`), body);
  if (layout === 'nested') {
    files.review = join(root, 'review', 'SKILL.md');
    files.adversarial = join(root, 'review', 'sections', 'adversarial.md');
    files.coverage = join(root, 'ship', 'sections', 'test-coverage.md');
    put(files.review, reviewText());
    put(files.adversarial, adversarialText());
    put(files.coverage, coverageText());
  } else {
    files.review = join(skills, 'gstack-review', 'SKILL.md');
    files.adversarial = files.review;
    files.coverage = join(skills, 'gstack-ship', 'sections', 'test-coverage.md');
    put(files.review, reviewText() + adversarialText());
    put(files.coverage, coverageText());
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
      '--stage preflight|tests|guards|all   default all',
      "--explain                     print each selected test's provenance and each uncertain mapping",
    ]);
    expect(PREGATE_NARROW.index).toEqual([
      'export const CHECKS: readonly CheckDef[] = [regenCheck, secretsCheck, straysCheck, literalsCheck, timingCheck, guardsCheck, lanesCheck];',
      "const selected = o.stage === 'guards' ? CHECKS.filter(c => (PREPUSH_CHECK_IDS as readonly string[]).includes(c.id)) : CHECKS.filter(c => (o.stage === 'all' || c.stage === o.stage) && (!o.only || o.only.includes(c.id)));",
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
    expect(r.lines.filter((l) => l.startsWith('OK anchor '))).toHaveLength(CURRENT_ANCHORS.length + FIX_FIRST.review.length + FIX_FIRST.checklist.length + TEST_GAP_ANCHORS + PREGATE_NARROW_ANCHORS + DELEGATE_ANCHORS + FOLD_ANCHORS + OVERLAP_ANCHORS + ATTACKER_ANCHORS + UPSTREAM_FINDING_ANCHORS.length); // three in-cap anchors, six Fix-First anchors, sixteen test-gap anchors, nine pregate-narrowing anchors, twenty-one delegate anchors, eighteen fold anchors, eight overlap anchors, nine attacker anchors, two finding-location anchors
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
      `INFO inspected finding-location ${FINDING_LOCATION_QUALIFIED.revision} ${FINDING_LOCATION_QUALIFIED.version}`,
      `INFO inspected delegate ${DELEGATE_QUALIFIED.revision} ${DELEGATE_QUALIFIED.version}`,
      `INFO inspected fold ${FOLD_QUALIFIED.revision} ${FOLD_QUALIFIED.version}`,
      `INFO inspected overlap ${OVERLAP_QUALIFIED.revision} ${OVERLAP_QUALIFIED.version}`,
      `INFO inspected attacker ${ATTACKER_QUALIFIED.revision} ${ATTACKER_QUALIFIED.version}`,
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
    writeFileSync(f.files.review!, reviewText().replaceAll('\n', '\r\n'));
    expect((await check(rootArgs(f))).code).toBe(0);
  }, 30000);

  test('nested precedence never borrows healthy sibling files', async () => {
    const f = upstream('nested');
    put(join(f.skills, 'gstack-review', 'SKILL.md'), reviewText());
    put(join(f.skills, 'gstack-ship', 'sections', 'test-coverage.md'), coverageText());
    writeFileSync(f.files.review!, '# changed nested review\n');
    rmSync(f.files.coverage!);
    const r = await check(rootArgs(f));
    expect(r.code).toBe(4);
    expect(r.lines).toContain('INFO layout nested');
    expect(drifts(r.lines).filter((line) => line.includes('review-and-prep.incap.'))).toHaveLength(3);
    expect(drifts(r.lines).some((line) => line.includes('review-and-prep.test-gaps.coverage.1'))).toBe(true);
    expect(r.lines.filter((line) => line.startsWith('INFO file ')).join('\n')).not.toContain(`${realpathSync(f.skills)}/gstack-ship/`);
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
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=${CHECKS - 8}`); // all eight inventory checks read this extension's own source
  } finally { chmodSync(f.root, 0o700); }
}, 30000);

describe('drift', () => {
  const INCAP_REPAIR_EFFECT = '  effect: /review-and-prep: the in-cap delta is inactive and /review runs unmodified; repair-review=behavior-changing is also inactive, so every edited pass repeats as today and the receipt says so';
  const INCAP_ONLY_EFFECT = '  effect: /review-and-prep: the in-cap delta is inactive and /review runs unmodified';
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
    expect(r.lines[at + 1]).toBe(INCAP_REPAIR_EFFECT);
    expect(r.lines[at + 2]).toContain('  fix: run /gstack-extend-upgrade and rerun');
    expect(r.lines[at + 2]).toContain('docs/upstream-check.md#drift-anchor');
    expect(r.lines).toContain('OK anchor review-and-prep.incap.1');
  }, 30000);

  test('incap.1 names both in-cap and repair-review effects, while incap.3 names only the in-cap effect', async () => {
    const f1 = upstream('nested');
    writeFileSync(f1.files.review!, reviewText().replace('A pass covers Steps 3–5, including all reviewers before fixes.', 'A pass covers Steps 3–5.'));
    const r1 = await check(rootArgs(f1));
    expectAgreement(r1);
    const at1 = r1.lines.findIndex((l) => l.startsWith('DRIFT anchor review-and-prep.incap.1 '));
    expect(at1).toBeGreaterThan(-1);
    expect(r1.lines[at1 + 1]).toBe(INCAP_REPAIR_EFFECT);

    const f3 = upstream('nested');
    writeFileSync(f3.files.review!, reviewText().replace('DIFF_BASE=$(git merge-base origin/<base> HEAD)', 'DIFF_BASE=$(git merge-base main HEAD)'));
    const r3 = await check(rootArgs(f3));
    expectAgreement(r3);
    const at3 = r3.lines.findIndex((l) => l.startsWith('DRIFT anchor review-and-prep.incap.3 '));
    expect(at3).toBeGreaterThan(-1);
    expect(r3.lines[at3 + 1]).toBe(INCAP_ONLY_EFFECT);
  }, 30000);

  test('anchors compare raw bytes: a normalized lookalike does not match', async () => {
    const f = upstream('nested');
    writeFileSync(f.files.review!, reviewText().replace('Steps 3–5', 'Steps 3-5'));
    const r = await check(rootArgs(f));
    expect(drifts(r.lines).map((l) => l.split(' ')[2])).toEqual(['review-and-prep.incap.1']);
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

  test('an emptied review file drifts the in-cap and Fix-First review anchors, leaves the all-or-none item lists OK, and leaves the checklist anchors OK', async () => {
    const f = upstream('nested');
    writeFileSync(f.files.review!, '# nothing\n');
    const r = await check(rootArgs(f));
    expect(drifts(r.lines).map((l) => l.split(' ')[2])).toEqual([
      'review-and-prep.incap.1', 'review-and-prep.incap.2', 'review-and-prep.incap.3',
      'review-and-prep.fix-first.review.1', 'review-and-prep.fix-first.review.2',
      ...TEST_GAP.review.map((_, i) => `review-and-prep.test-gaps.review.${i + 1}`),
      ...DELEGATE.review.map((_, i) => `review-and-prep.delegate.review.${i + 1}`),
      ...FOLD.review.map((_, i) => `review-and-prep.fold.review.${i + 1}`),
      ...OVERLAP.review.map((_, i) => `review-and-prep.overlap.review.${i + 1}`),
    ]);
    for (const n of [1, 2, 3]) {
      expect(r.lines).toContain(`OK anchor review-and-prep.delegate.dispatch-item.${n}`);
      expect(r.lines).toContain(`OK anchor review-and-prep.fold.dispatch-item.${n}`);
    }
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
    // The testing specialist file also holds the three testing delegation anchors.
    const delegated = file === 'testing' ? DELEGATE.testing.map((_, i) => `review-and-prep.delegate.testing.${i + 1}`) : [];
    // ... and the testing checklist's fold heading.
    const folded = file === 'testing' ? ['review-and-prep.fold.testing.1'] : [];
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=${count + delegated.length + folded.length}`);
    expect(r.lines).toContain(`INFO layout ${layout}`);
    expect(drifts(r.lines).map((l) => l.split(' ')[2])).toEqual([...Array.from({ length: count }, (_, i) => `review-and-prep.test-gaps.${file}.${i + 1}`), ...delegated, ...folded]);
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
  test('the six inventories and the test-gap anchors report in a fixed order', async () => {
    const r = await check(rootArgs(upstream('nested')));
    const ids = r.lines.filter((l) => l.startsWith('OK ')).map((l) => l.split(' ').slice(1).join(' '));
    const inventories = ids.filter((id) => id.startsWith('inventory '));
    expect(inventories).toEqual(['inventory review-and-prep.incap', 'inventory review-and-prep.fix-first', 'inventory review-and-prep.test-gaps', 'inventory review-and-prep.pregate-narrowing', 'inventory review-and-prep.delegate', 'inventory review-and-prep.fold', 'inventory review-and-prep.overlap', 'inventory review-and-prep.attacker']);
    const anchors = ids.filter((id) => id.startsWith('anchor review-and-prep.test-gaps.'));
    expect(anchors).toEqual([
      ...TEST_GAP.review.map((_, i) => `anchor review-and-prep.test-gaps.review.${i + 1}`),
      ...TEST_GAP.testing.map((_, i) => `anchor review-and-prep.test-gaps.testing.${i + 1}`),
      ...TEST_GAP.checklist.map((_, i) => `anchor review-and-prep.test-gaps.checklist.${i + 1}`),
      ...TEST_GAP.coverage.map((_, i) => `anchor review-and-prep.test-gaps.coverage.${i + 1}`),
    ]);
    expect(ids.indexOf('anchor review-and-prep.fix-first.checklist.4')).toBeLessThan(ids.indexOf('anchor review-and-prep.test-gaps.review.1'));
    // The pregate-narrowing anchors follow the test-gap checks, and the export checks follow the anchors.
    expect(ids.filter((id) => id.startsWith('anchor review-and-prep.pregate-narrowing.'))).toEqual([
      ...PREGATE_NARROW.bin.map((_, i) => `anchor review-and-prep.pregate-narrowing.bin.${i + 1}`),
      ...PREGATE_NARROW.index.map((_, i) => `anchor review-and-prep.pregate-narrowing.index.${i + 1}`),
      ...PREGATE_NARROW.lanes.map((_, i) => `anchor review-and-prep.pregate-narrowing.lanes.${i + 1}`),
    ]);
    expect(ids.indexOf('anchor review-and-prep.test-gaps.coverage.4')).toBeLessThan(ids.indexOf('anchor review-and-prep.pregate-narrowing.bin.1'));
    expect(ids.indexOf('anchor review-and-prep.pregate-narrowing.lanes.5')).toBeLessThan(ids.indexOf('export outside-review.runClaudeCode'));
    expect(ids.filter((id) => id.startsWith('anchor review-and-prep.delegate.'))).toEqual([
      ...DELEGATE.review.map((_, i) => `anchor review-and-prep.delegate.review.${i + 1}`),
      ...DELEGATE.dispatchItem.map((_, i) => `anchor review-and-prep.delegate.dispatch-item.${i + 1}`),
      ...DELEGATE_PARTS.flatMap((part) => DELEGATE[part].map((_, i) => `anchor review-and-prep.delegate.${part}.${i + 1}`)),
    ]);
  }, 30000);

  // Value: protects=the delegate activation paragraph lists the six review anchors, the three all-or-none item anchors, and the twelve specialist anchors across six lists; fails_when=a list is dropped, merged or gains a backtick; why_new=fifth activation paragraph; seam=none
  test('the delegation inventory parses six lists of 6, 3, 3, 3, 3 and 3 anchors', () => {
    expect([DELEGATE.review.length, DELEGATE.dispatchItem.length, DELEGATE.testing.length, DELEGATE.maintainability.length, DELEGATE.performance.length, DELEGATE.simplification.length]).toEqual([6, 3, 3, 3, 3, 3]);
    expect(DELEGATE.review.length + DELEGATE.dispatchItem.length + DELEGATE.testing.length + DELEGATE.maintainability.length + DELEGATE.performance.length + DELEGATE.simplification.length).toBe(DELEGATE_ANCHORS);
    expect(DELEGATE.review).toEqual([
      'Combine core, specialist, Step 4.7 QA, Step 4.8 adversarial and VALID & ACTIONABLE review bot findings.',
      'For every combined finding, including core, specialist, exploratory QA, adversarial and valid actionable Greptile findings, check:',
      'If this host omits Review Army, use',
      'without claiming specialist coverage.',
      'For an item that truly does not apply, run',
      '(this session only; it counts as a miss).',
    ]);
    expect(DELEGATE.dispatchItem).toEqual([
      'specialists-dispatched',
      'Dispatching N specialists:',
      'then one Agent dispatch per specialist it names (none when a small diff skips them).',
    ]);
    for (const part of DELEGATE_PARTS) {
      expect(DELEGATE[part]).toEqual([`# ${part[0]!.toUpperCase()}${part.slice(1)} Specialist Review Checklist`, 'Output: JSON objects, one finding per line. Schema:', `"specialist":"${part}"`]);
    }
    for (const anchor of [...DELEGATE.review, ...DELEGATE.dispatchItem, ...DELEGATE.testing, ...DELEGATE.maintainability, ...DELEGATE.performance, ...DELEGATE.simplification]) expect(anchor).not.toContain('`');
    expect(delegateInventory(join(scratch, 'no-such-extension')).ok).toBe(false);
  });

  const DELEGATE_EFFECT = '  effect: /review-and-prep: delegate=<parts> is inactive, so every specialist runs on the host model as today and the receipt says so';
  type DelegateList = 'review' | 'dispatch-item' | (typeof DELEGATE_PARTS)[number];
  const delegateList = (list: DelegateList) => list === 'dispatch-item' ? DELEGATE.dispatchItem : DELEGATE[list];
  const delegateFile = (f: Fixture, list: DelegateList) => (list === 'review' || list === 'dispatch-item' ? f.files.review : f.files[list])!;
  const DELEGATE_PICKS = (['review', 'dispatch-item', ...DELEGATE_PARTS] as const).flatMap((list) =>
    ([['nested', 0], ['nested', delegateList(list).length - 1], ['sibling', 0], ['sibling', delegateList(list).length - 1]] as const).map(([layout, at]) => [layout, list, at] as const));
  // Value: protects=a changed delegation anchor in either layout is drift naming its own ID and the delegate effect, and no unrelated gate turns off; fails_when=a changed anchor passes, reports an unrelated gate's effect or drifts an unshared neighbor; why_new=fifth upstream gate across five files and two layouts; seam=none
  test.each(DELEGATE_PICKS)('a changed anchor in the %s layout\'s %s list (anchor %#) is drift with the delegate effect', async (layout, list, at) => {
    const f = upstream(layout);
    const path = delegateFile(f, list);
    const anchor = delegateList(list)[at]!;
    // The simplification tag is used five times upstream; replace every copy, as a reworded file would.
    writeFileSync(path, readFileSync(path, 'utf8').split(anchor).join(`${anchor.slice(0, -2)}!!`));
    const r = await check(rootArgs(f));
    expectAgreement(r);
    expect(r.code).toBe(4);
    // Anchors that fold or overlap also list drift their IDs too, in report order: delegate → fold → overlap.
    const folded = (list === 'review' ? FOLD.review : list === 'dispatch-item' ? FOLD.dispatchItem : FOLD.checklists[list]).indexOf(anchor);
    const foldId = folded < 0 ? [] : [`review-and-prep.fold.${list}.${folded + 1}`];
    const overlapped = list === 'review' ? OVERLAP.review.indexOf(anchor) : -1;
    const overlapId = overlapped < 0 ? [] : [`review-and-prep.overlap.review.${overlapped + 1}`];
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=${1 + foldId.length + overlapId.length}`);
    expect(drifts(r.lines).map((l) => l.split(' ')[2])).toEqual([`review-and-prep.delegate.${list}.${at + 1}`, ...foldId, ...overlapId]);
    const id = `review-and-prep.delegate.${list}.${at + 1}`;
    const line = r.lines.findIndex((l) => l.startsWith(`DRIFT anchor ${id} `));
    expect(line).toBeGreaterThan(-1);
    expect(r.lines[line + 1]).toBe(DELEGATE_EFFECT);
    expect(r.lines[line + 2]).toContain('  fix: run /gstack-extend-upgrade and rerun');
    expect(r.lines[line + 2]).toContain('docs/upstream-check.md#drift-anchor');
    for (const gate of ['incap', 'fix-first', 'test-gaps', 'pregate-narrowing', 'delegate', 'fold', 'overlap']) expect(r.lines).toContain(`OK inventory review-and-prep.${gate}`);
    expect(r.out).not.toContain('the in-cap delta is inactive');
    expect(r.out).not.toContain('test-gaps=record is inactive');
    if (!foldId.length) expect(r.out).not.toContain('specialists=fold is inactive');
    if (!overlapId.length) expect(r.out).not.toContain('first-cycle=overlap is inactive');
  }, 30000);

  // Value: protects=a missing specialist file drifts exactly its three anchors, in both layouts, with a path-naming reason; fails_when=a missing file passes or drifts another file's anchors; why_new=three specialist files read from the root in both layouts; seam=none
  test.each(['nested', 'sibling'].flatMap((layout) => ['maintainability', 'performance', 'simplification'].map((part) => [layout, part] as const)))(
    'a missing %2$s specialist file in the %1$s layout drifts its three delegation anchors and its fold heading and nothing else', async (layout, part) => {
    const f = upstream(layout as 'nested' | 'sibling');
    const path = f.files[part]!;
    expect(path).toBe(join(f.root, 'review', 'specialists', `${part}.md`)); // the root, never the skills directory
    rmSync(path);
    const r = await check(rootArgs(f));
    expectAgreement(r);
    // The same file also holds the part's fold heading.
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=4`);
    expect(drifts(r.lines).map((l) => l.split(' ')[2])).toEqual([...[1, 2, 3].map((n) => `review-and-prep.delegate.${part}.${n}`), `review-and-prep.fold.${part}.1`]);
    for (const line of drifts(r.lines)) expect(line).toContain(`review ${part} specialist not found: ${path}`);
    expect(r.lines.filter((l) => l.startsWith(`INFO file ${part} `))).toEqual([]);
    expect(r.lines).toContain('OK inventory review-and-prep.delegate');
  }, 30000);

  // Value: protects=the three new specialist files are reported as INFO from the root in both layouts; fails_when=a healthy file is unreported or read from the skills directory; why_new=new installed files; seam=none
  test.each(['nested', 'sibling'] as const)('the delegated specialist files are reported as INFO in the %s layout', async (layout) => {
    const f = upstream(layout);
    const r = await check(rootArgs(f));
    expectAgreement(r);
    for (const part of ['testing', 'maintainability', 'performance', 'simplification']) {
      expect(r.lines).toContain(`INFO file ${part} ${realpathSync(join(f.root, 'review', 'specialists', `${part}.md`))}`);
    }
    expect(r.lines).toContain(`INFO inspected delegate ${DELEGATE_QUALIFIED.revision} ${DELEGATE_QUALIFIED.version}`);
  }, 30000);

  // Value: protects=the fold activation paragraph lists the six review anchors, the three all-or-none item anchors, and one heading per checklist across eleven lists; fails_when=a list is dropped, merged or gains a backtick; why_new=sixth activation paragraph; seam=none
  test('the fold inventory parses eleven lists of 6 review anchors, 3 item anchors and one heading per checklist', () => {
    expect(FOLD.review).toEqual([
      'Combine core, specialist, Step 4.7 QA, Step 4.8 adversarial and VALID & ACTIONABLE review bot findings.',
      'Core findings use the confidence gates below; Step 4.6 applies its specialist gates.',
      'If this host omits Review Army, use',
      'without claiming specialist coverage.',
      'For an item that truly does not apply, run',
      '(this session only; it counts as a miss).',
    ]);
    expect(FOLD.dispatchItem).toEqual(DELEGATE.dispatchItem);
    expect(FOLD.checklists).toEqual({
      testing: ['# Testing Specialist Review Checklist'],
      maintainability: ['# Maintainability Specialist Review Checklist'],
      security: ['# Security Specialist Review Checklist'],
      performance: ['# Performance Specialist Review Checklist'],
      'data-migration': ['# Data Migration Specialist Review Checklist'],
      'api-contract': ['# API Contract Specialist Review Checklist'],
      simplification: ['# Simplification Specialist Review Checklist'],
      'state-machines': ['# State Machine Round-Trip Specialist Review Checklist'],
      design: ['# Design Review Checklist (Lite)'],
    });
    expect(FOLD_NAMES).toEqual(Object.keys(FOLD.checklists));
    expect(FOLD.review.length + FOLD.dispatchItem.length + FOLD_NAMES.reduce((n, name) => n + FOLD.checklists[name].length, 0)).toBe(FOLD_ANCHORS);
    for (const anchor of [...FOLD.review, ...FOLD.dispatchItem, ...FOLD_NAMES.flatMap((name) => FOLD.checklists[name])]) expect(anchor).not.toContain('`');
    expect(foldInventory(join(scratch, 'no-such-extension')).ok).toBe(false);
  });

  const FOLD_EFFECT = '  effect: /review-and-prep: specialists=fold is inactive, so cycle 1 dispatches specialists as today and the receipt says so';
  type FoldList = 'review' | 'dispatch-item' | (typeof FOLD_NAMES)[number];
  const foldList = (list: FoldList) => list === 'review' ? FOLD.review : list === 'dispatch-item' ? FOLD.dispatchItem : FOLD.checklists[list];
  const foldFile = (f: Fixture, list: FoldList) => (list === 'review' || list === 'dispatch-item' ? f.files.review : f.files[list])!;
  // Review lines 1, 2, 4 and 6, the first and last dispatch-item lines, and every checklist's heading.
  const FOLD_PICKS = (['nested', 'sibling'] as const).flatMap((layout) => [
    ...[0, 1, 3, 5].map((at) => [layout, 'review', at] as const),
    ...[0, 2].map((at) => [layout, 'dispatch-item', at] as const),
    ...FOLD_NAMES.map((name) => [layout, name, 0] as const),
  ]);
  // Value: protects=a changed fold anchor in either layout is drift naming its own ID and the fold effect, with every inventory still OK; fails_when=a changed anchor passes, reports an unrelated gate's effect or drifts an unshared neighbor; why_new=sixth upstream gate across ten files and two layouts; seam=none
  test.each(FOLD_PICKS)('a changed anchor in the %s layout\'s fold %s list (zero-based anchor %i) is drift with the fold effect', async (layout, list, at) => {
    const f = upstream(layout);
    const path = foldFile(f, list);
    const anchor = foldList(list)[at]!;
    writeFileSync(path, readFileSync(path, 'utf8').split(anchor).join(`${anchor.slice(0, -2)}!!`));
    const r = await check(rootArgs(f));
    expectAgreement(r);
    expect(r.code).toBe(4);
    // Anchors that delegation or overlap list too drift their IDs as well, in report order: delegation → fold → overlap.
    const delegated = list === 'review' ? DELEGATE.review.indexOf(anchor) : list === 'dispatch-item' ? DELEGATE.dispatchItem.indexOf(anchor) : (DELEGATE_PARTS as readonly string[]).includes(list) ? DELEGATE[list as (typeof DELEGATE_PARTS)[number]].indexOf(anchor) : -1;
    const delegateId = delegated < 0 ? [] : [`review-and-prep.delegate.${list}.${delegated + 1}`];
    const overlapped = list === 'review' ? OVERLAP.review.indexOf(anchor) : -1;
    const overlapId = overlapped < 0 ? [] : [`review-and-prep.overlap.review.${overlapped + 1}`];
    const foldId = `review-and-prep.fold.${list}.${at + 1}`;
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=${1 + delegateId.length + overlapId.length}`);
    expect(drifts(r.lines).map((l) => l.split(' ')[2])).toEqual([...delegateId, foldId, ...overlapId]);
    const line = r.lines.findIndex((l) => l.startsWith(`DRIFT anchor ${foldId} `));
    expect(line).toBeGreaterThan(-1);
    expect(r.lines[line]).toContain(`anchor not found byte for byte in ${realpathSync(path)}`);
    expect(r.lines[line + 1]).toBe(FOLD_EFFECT);
    expect(r.lines[line + 2]).toContain('  fix: run /gstack-extend-upgrade and rerun');
    expect(r.lines[line + 2]).toContain('docs/upstream-check.md#drift-anchor');
    for (const gate of ['incap', 'fix-first', 'test-gaps', 'pregate-narrowing', 'delegate', 'fold', 'overlap']) expect(r.lines).toContain(`OK inventory review-and-prep.${gate}`);
    expect(r.out).not.toContain('the in-cap delta is inactive');
    expect(r.out).not.toContain('test-gaps=record is inactive');
    if (!delegateId.length) expect(r.out).not.toContain('delegate=<parts> is inactive');
    if (!overlapId.length) expect(r.out).not.toContain('first-cycle=overlap is inactive');
  }, 30000);

  // Value: protects=all-or-none item lists pass with INFO not-declared when none of the three lines is in the review file, drift when any subset is missing, and drift when the review file cannot be read; fails_when=Codex's item-free copy drifts or a partial/unreadable review file passes; why_new=criterion 1, 4, 7; seam=none
  test.each(['nested', 'sibling'] as const)('all-or-none dispatch-item anchors in the %s layout report OK + INFO not-declared when absent, and drift when partial or unreadable', async (layout) => {
    const withoutItem = upstream(layout);
    let body = readFileSync(withoutItem.files.review!, 'utf8');
    for (const line of DELEGATE.dispatchItem) body = body.split(line).join('');
    writeFileSync(withoutItem.files.review!, body);
    const ok = await check(rootArgs(withoutItem));
    expectAgreement(ok);
    expect(ok.code).toBe(0);
    expect(ok.result).toBe(`RESULT ok checks=${CHECKS} drift=0`);
    const real = realpathSync(withoutItem.files.review!);
    expect(ok.lines.filter((l) => l.startsWith('INFO not-declared '))).toEqual([
      `INFO not-declared review-and-prep.delegate.dispatch-item ${real}`,
      `INFO not-declared review-and-prep.fold.dispatch-item ${real}`,
    ]);
    for (const n of [1, 2, 3]) {
      expect(ok.lines).toContain(`OK anchor review-and-prep.delegate.dispatch-item.${n}`);
      expect(ok.lines).toContain(`OK anchor review-and-prep.fold.dispatch-item.${n}`);
    }

    // Only `specialists-dispatched` removed (the other two present) drifts .1 in both lists.
    const partial = upstream(layout);
    writeFileSync(partial.files.review!, readFileSync(partial.files.review!, 'utf8').split('specialists-dispatched').join(''));
    const rPartial = await check(rootArgs(partial));
    expectAgreement(rPartial);
    expect(rPartial.code).toBe(4);
    expect(rPartial.lines.filter((l) => l.startsWith('INFO not-declared '))).toEqual([]);
    expect(drifts(rPartial.lines).map((l) => l.split(' ')[2])).toEqual([
      'review-and-prep.delegate.dispatch-item.1',
      'review-and-prep.fold.dispatch-item.1',
    ]);
    const dLine = rPartial.lines.findIndex((l) => l.startsWith('DRIFT anchor review-and-prep.delegate.dispatch-item.1 '));
    expect(rPartial.lines[dLine + 1]).toBe(DELEGATE_EFFECT);
    const fLine = rPartial.lines.findIndex((l) => l.startsWith('DRIFT anchor review-and-prep.fold.dispatch-item.1 '));
    expect(rPartial.lines[fLine + 1]).toBe(FOLD_EFFECT);

    // Reworded third item line drifts .3 in both lists.
    const third = upstream(layout);
    writeFileSync(third.files.review!, readFileSync(third.files.review!, 'utf8').split(DELEGATE.dispatchItem[2]!).join('then one Agent dispatch per specialist.'));
    const rThird = await check(rootArgs(third));
    expectAgreement(rThird);
    expect(drifts(rThird.lines).map((l) => l.split(' ')[2])).toEqual([
      'review-and-prep.delegate.dispatch-item.3',
      'review-and-prep.fold.dispatch-item.3',
    ]);

    // Missing review file drifts all six item IDs (read failure is never not-declared).
    const missing = upstream(layout);
    rmSync(missing.files.review!);
    const rMissing = await check(rootArgs(missing));
    expectAgreement(rMissing);
    expect(rMissing.lines.filter((l) => l.startsWith('INFO not-declared '))).toEqual([]);
    const driftedIds = drifts(rMissing.lines).map((l) => l.split(' ')[2]);
    for (const n of [1, 2, 3]) {
      expect(driftedIds).toContain(`review-and-prep.delegate.dispatch-item.${n}`);
      expect(driftedIds).toContain(`review-and-prep.fold.dispatch-item.${n}`);
    }
  }, 30000);

  // Value: protects=a missing checklist only the fold reads drifts exactly its own heading, in both layouts, with a path-naming reason and no INFO file; fails_when=a missing file passes, drifts another file's anchors or reads the wrong layout path; why_new=five new installed files read from the root in both layouts; seam=none
  test.each((['nested', 'sibling'] as const).flatMap((layout) => FOLD_ONLY.map((name) => [layout, name] as const)))(
    'a missing %2$s checklist in the %1$s layout drifts only its fold heading', async (layout, name) => {
    const f = upstream(layout);
    const path = f.files[name]!;
    expect(path).toBe(foldOnlyPath(f.root, name)); // the root, never the skills directory
    rmSync(path);
    const r = await check(rootArgs(f));
    expectAgreement(r);
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=1`);
    expect(r.lines).toContain(`INFO layout ${layout}`);
    expect(drifts(r.lines).map((l) => l.split(' ')[2])).toEqual([`review-and-prep.fold.${name}.1`]);
    expect(drifts(r.lines)[0]).toContain(`review ${name} checklist not found: ${path}`);
    expect(r.lines.filter((l) => l.startsWith(`INFO file ${name} `))).toEqual([]);
    expect(r.lines).toContain('OK inventory review-and-prep.fold');
  }, 30000);

  // Value: protects=the five fold-only checklists are reported as INFO from the root in both layouts; fails_when=a healthy file is unreported or read from the skills directory; why_new=new installed files; seam=none
  test.each(['nested', 'sibling'] as const)('the fold\'s checklists are reported as INFO in the %s layout', async (layout) => {
    const f = upstream(layout);
    const r = await check(rootArgs(f));
    expectAgreement(r);
    for (const name of FOLD_NAMES) {
      const path = name === 'design' ? join(f.root, 'review', 'design-checklist.md') : join(f.root, 'review', 'specialists', `${name}.md`);
      expect(r.lines).toContain(`INFO file ${name} ${realpathSync(path)}`);
    }
    expect(r.lines).toContain(`INFO inspected fold ${FOLD_QUALIFIED.revision} ${FOLD_QUALIFIED.version}`);
    expect(r.lines.filter((l) => l.startsWith('OK anchor review-and-prep.fold.'))).toHaveLength(FOLD_ANCHORS);
  }, 30000);

  // Value: protects=missing roots never pass fold anchors while the local inventory remains readable; fails_when=unavailable upstream files receive OK; why_new=fold root-failure contract; seam=none
  test('a missing root leaves the fold inventory OK and every fold anchor not run', async () => {
    const r = await check(['--gstack-root', join(scratch, 'does-not-exist-fold')]);
    expect(r.lines).toContain('OK inventory review-and-prep.fold');
    const anchors = drifts(r.lines).filter((l) => l.startsWith('DRIFT anchor review-and-prep.fold.'));
    expect(anchors).toHaveLength(FOLD_ANCHORS);
    for (const line of anchors) expect(line).toContain('not run: gstack root unavailable');
  }, 30000);

  // Value: protects=the fold anchors report after the delegation anchors and before the finding-location anchors, and no earlier check moves; fails_when=a gate moves in the report; why_new=sixth anchor group; seam=none
  test('the fold anchors report after the delegation anchors and before the finding-location anchors', async () => {
    const r = await check(rootArgs(upstream('nested')));
    const ids = r.lines.filter((l) => l.startsWith('OK ')).map((l) => l.split(' ').slice(1).join(' '));
    expect(ids.filter((id) => id.startsWith('anchor review-and-prep.fold.'))).toEqual([
      ...FOLD.review.map((_, i) => `anchor review-and-prep.fold.review.${i + 1}`),
      ...FOLD.dispatchItem.map((_, i) => `anchor review-and-prep.fold.dispatch-item.${i + 1}`),
      ...FOLD_NAMES.map((name) => `anchor review-and-prep.fold.${name}.1`),
    ]);
    expect(ids.indexOf('anchor review-and-prep.delegate.simplification.3')).toBeLessThan(ids.indexOf('anchor review-and-prep.fold.review.1'));
    expect(ids.indexOf('anchor review-and-prep.fold.design.1')).toBeLessThan(ids.indexOf('anchor secret-dispositions.location.1'));
  }, 30000);

  // Value: protects=the overlap activation paragraph lists five review anchors and three adversarial anchors with no backticks; fails_when=a list is dropped, merged or gains a backtick; why_new=seventh activation paragraph; seam=none
  test('the overlap inventory parses two lists of 5 review anchors and 3 adversarial anchors', () => {
    expect(OVERLAP.review).toEqual([
      'All readers examine the same candidate.',
      'Do not edit reviewed source until Step 5.',
      'Before edits, every dispatched reader/writer must have returned or be confirmed',
      'Combine core, specialist, Step 4.7 QA, Step 4.8 adversarial and VALID & ACTIONABLE review bot findings.',
      'an Agent dispatch for the adversarial pass, its prompt including',
    ]);
    expect(OVERLAP.adversarial).toEqual([
      'Read the diff for this branch. First list changed files:',
      'Wait until every started task has finished or is confirmed stopped.',
      'After all passes complete, synthesize findings across all sources:',
    ]);
    expect(OVERLAP.review.length + OVERLAP.adversarial.length).toBe(OVERLAP_ANCHORS);
    for (const anchor of [...OVERLAP.review, ...OVERLAP.adversarial]) expect(anchor).not.toContain('`');
    expect(overlapInventory(join(scratch, 'no-such-extension')).ok).toBe(false);
  });

  const OVERLAP_EFFECT = '  effect: /review-and-prep: first-cycle=overlap is inactive, so cycle 1 runs in today\'s order and the receipt says so';
  const overlapFile = (f: Fixture, list: 'review' | 'adversarial') => (list === 'review' ? f.files.review : f.files.adversarial)!;
  const OVERLAP_PICKS = (['nested', 'sibling'] as const).flatMap((layout) => [
    ...OVERLAP.review.map((_, at) => [layout, 'review', at] as const),
    ...OVERLAP.adversarial.map((_, at) => [layout, 'adversarial', at] as const),
  ]);
  // Value: protects=a changed overlap anchor in either layout drifts only its own overlap ID with the overlap effect, and every inventory stays OK; fails_when=a changed anchor passes, reports another gate's effect or drifts an unrelated neighbor; why_new=seventh upstream gate across two lists and two layouts; seam=none
  test.each(OVERLAP_PICKS)('a changed anchor in the %s layout\'s overlap %s list (zero-based anchor %i) is drift with the overlap effect', async (layout, list, at) => {
    const f = upstream(layout);
    const path = overlapFile(f, list);
    const anchor = OVERLAP[list][at]!;
    writeFileSync(path, readFileSync(path, 'utf8').split(anchor).join(`${anchor.slice(0, -2)}!!`));
    const r = await check(rootArgs(f));
    expectAgreement(r);
    expect(r.code).toBe(4);
    const delegated = list === 'review' ? DELEGATE.review.indexOf(anchor) : -1;
    const delegateId = delegated < 0 ? [] : [`review-and-prep.delegate.review.${delegated + 1}`];
    const folded = list === 'review' ? FOLD.review.indexOf(anchor) : -1;
    const foldId = folded < 0 ? [] : [`review-and-prep.fold.review.${folded + 1}`];
    const attacker = list === 'review' ? ATTACKER['adversarial-item'].indexOf(anchor) : -1;
    const attackerId = attacker < 0 ? [] : [`review-and-prep.attacker.adversarial-item.${attacker + 1}`];
    const overlapId = `review-and-prep.overlap.${list}.${at + 1}`;
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=${1 + delegateId.length + foldId.length + attackerId.length}`);
    expect(drifts(r.lines).map((l) => l.split(' ')[2])).toEqual([...delegateId, ...foldId, overlapId, ...attackerId]);
    const line = r.lines.findIndex((l) => l.startsWith(`DRIFT anchor ${overlapId} `));
    expect(line).toBeGreaterThan(-1);
    expect(r.lines[line]).toContain(`anchor not found byte for byte in ${realpathSync(path)}`);
    expect(r.lines[line + 1]).toBe(OVERLAP_EFFECT);
    expect(r.lines[line + 2]).toContain('  fix: run /gstack-extend-upgrade and rerun');
    expect(r.lines[line + 2]).toContain('docs/upstream-check.md#drift-anchor');
    for (const gate of ['incap', 'fix-first', 'test-gaps', 'pregate-narrowing', 'delegate', 'fold', 'overlap', 'attacker']) expect(r.lines).toContain(`OK inventory review-and-prep.${gate}`);
    expect(r.out).not.toContain('the in-cap delta is inactive');
    if (!delegateId.length) expect(r.out).not.toContain('delegate=<parts> is inactive');
    if (!foldId.length) expect(r.out).not.toContain('specialists=fold is inactive');
    if (!attackerId.length) expect(r.out).not.toContain('delegate=adversarial|red-team are inactive');
  }, 30000);

  // Value: protects=a missing adversarial section drifts the overlap and attacker adversarial IDs in each layout; fails_when=missing adversarial instructions pass or drift another file's anchors; why_new=adversarial instructions live in review/sections/adversarial.md in nested and in the review file in sibling; seam=none
  test.each(['nested', 'sibling'] as const)('missing adversarial instructions in the %s layout drift only the overlap and attacker adversarial anchors', async (layout) => {
    const f = upstream(layout);
    if (layout === 'nested') rmSync(f.files.adversarial!);
    else writeFileSync(f.files.review!, reviewText());
    const r = await check(rootArgs(f));
    expectAgreement(r);
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=${OVERLAP.adversarial.length + ATTACKER.adversarial.length}`);
    expect(r.lines).toContain(`INFO layout ${layout}`);
    expect(drifts(r.lines).map((l) => l.split(' ')[2])).toEqual([
      'review-and-prep.overlap.adversarial.1',
      'review-and-prep.overlap.adversarial.2',
      'review-and-prep.overlap.adversarial.3',
      'review-and-prep.attacker.adversarial.1',
      'review-and-prep.attacker.adversarial.2',
      'review-and-prep.attacker.adversarial.3',
      'review-and-prep.attacker.adversarial.4',
    ]);
    for (const line of drifts(r.lines)) {
      if (layout === 'nested') expect(line).toContain(`review adversarial section not found: ${f.files.adversarial!}`);
      else expect(line).toContain(`anchor not found byte for byte in ${realpathSync(f.files.review!)}`);
    }
    expect(r.lines).toContain('OK inventory review-and-prep.overlap');
    expect(r.lines).toContain('OK inventory review-and-prep.attacker');
    for (const n of [1, 2, 3, 4, 5]) expect(r.lines).toContain(`OK anchor review-and-prep.overlap.review.${n}`);
  }, 30000);

  // Value: protects=missing roots never pass overlap anchors while the local inventory remains readable, and the overlap anchors report in order; fails_when=unavailable upstream files receive OK or the overlap group moves; why_new=overlap root-failure and report-order contract; seam=none
  test('a missing root leaves the overlap inventory OK and every overlap anchor not run, and the overlap anchors report after fold and before finding-location', async () => {
    const r = await check(['--gstack-root', join(scratch, 'does-not-exist-overlap')]);
    expect(r.lines).toContain('OK inventory review-and-prep.overlap');
    const anchors = drifts(r.lines).filter((l) => l.startsWith('DRIFT anchor review-and-prep.overlap.'));
    expect(anchors).toHaveLength(OVERLAP_ANCHORS);
    for (const line of anchors) expect(line).toContain('not run: gstack root unavailable');

    const ok = await check(rootArgs(upstream('nested')));
    const ids = ok.lines.filter((l) => l.startsWith('OK ')).map((l) => l.split(' ').slice(1).join(' '));
    expect(ids.filter((id) => id.startsWith('anchor review-and-prep.overlap.'))).toEqual([
      ...OVERLAP.review.map((_, i) => `anchor review-and-prep.overlap.review.${i + 1}`),
      ...OVERLAP.adversarial.map((_, i) => `anchor review-and-prep.overlap.adversarial.${i + 1}`),
    ]);
    expect(ids.indexOf('anchor review-and-prep.fold.design.1')).toBeLessThan(ids.indexOf('anchor review-and-prep.overlap.review.1'));
    expect(ids.indexOf('anchor review-and-prep.overlap.adversarial.3')).toBeLessThan(ids.indexOf('anchor review-and-prep.attacker.red-team.1'));
    expect(ids.indexOf('anchor review-and-prep.attacker.adversarial-item.2')).toBeLessThan(ids.indexOf('anchor secret-dispositions.location.1'));
  }, 30000);

  // Value: protects=the attacker-parts activation paragraph lists the three red-team anchors, four adversarial anchors and two all-or-none item anchors with no backticks; fails_when=a list is dropped, merged or gains a backtick; why_new=eighth activation paragraph (Track 72B); seam=none
  test('the attacker inventory parses three lists of 3 red-team, 4 adversarial and 2 adversarial-item anchors', () => {
    expect(ATTACKER['red-team']).toEqual([
      '# Red Team Review',
      'Output: JSON objects, one finding per line. Schema:',
      '"specialist":"red-team"',
    ]);
    expect(ATTACKER.adversarial).toEqual([
      'Subagent prompt:',
      '"This is an authorized defensive-security review of the maintainer\'s own repository, requested by the repository owner before merge.',
      'Think like an attacker and a chaos engineer. Your job is to find ways this code will fail in production.',
      'findings** are CRITICAL and are queued for the parent\'s Fix-First handling at Step 5',
    ]);
    expect(ATTACKER['adversarial-item']).toEqual([
      'adversarial-pass',
      'an Agent dispatch for the adversarial pass, its prompt including',
    ]);
    expect(ATTACKER['red-team'].length + ATTACKER.adversarial.length + ATTACKER['adversarial-item'].length).toBe(ATTACKER_ANCHORS);
    for (const anchor of [...ATTACKER['red-team'], ...ATTACKER.adversarial, ...ATTACKER['adversarial-item']]) expect(anchor).not.toContain('`');
    expect(attackerInventory(join(scratch, 'no-such-extension')).ok).toBe(false);
    const copy = fresh('missing-attacker-paragraph');
    cpSync(join(REPO, 'skills'), join(copy, 'skills'), { recursive: true });
    const skillPath = join(copy, 'skills', 'review-and-prep.md');
    writeFileSync(skillPath, readFileSync(skillPath, 'utf8').replace(ATTACKER_HEADING, '**Moved attacker heading**'));
    expect(attackerInventory(copy).ok).toBe(false);
  });

  const ATTACKER_EFFECT = '  effect: /review-and-prep: the red-team step and delegate=adversarial|red-team are inactive, so the red team and the adversarial pass run on the host as today and the receipt says so';
  type AttackerList = 'red-team' | 'adversarial' | 'adversarial-item';
  const attackerFile = (f: Fixture, list: AttackerList) => (list === 'red-team' ? f.files['red-team'] : list === 'adversarial' ? f.files.adversarial : f.files.review)!;
  const ATTACKER_PICKS = (['nested', 'sibling'] as const).flatMap((layout) => [
    ...ATTACKER['red-team'].map((_, at) => [layout, 'red-team', at] as const),
    ...ATTACKER.adversarial.map((_, at) => [layout, 'adversarial', at] as const),
    ...ATTACKER['adversarial-item'].map((_, at) => [layout, 'adversarial-item', at] as const),
  ]);
  // Value: protects=a changed attacker-part anchor in either layout drifts its own attacker ID with the attacker effect, and no unrelated gate turns off; fails_when=a changed anchor passes, reports another gate's effect or drifts an unshared neighbor; why_new=eighth upstream gate across three lists and two layouts; seam=none
  test.each(ATTACKER_PICKS)('a changed anchor in the %s layout\'s attacker %s list (zero-based anchor %i) is drift with the attacker effect', async (layout, list, at) => {
    const f = upstream(layout);
    const path = attackerFile(f, list);
    const anchor = ATTACKER[list][at]!;
    writeFileSync(path, readFileSync(path, 'utf8').split(anchor).join(`${anchor.slice(0, -2)}!!`));
    const r = await check(rootArgs(f));
    expectAgreement(r);
    expect(r.code).toBe(4);
    const overlapped = list === 'adversarial-item' ? OVERLAP.review.indexOf(anchor) : -1;
    const overlapId = overlapped < 0 ? [] : [`review-and-prep.overlap.review.${overlapped + 1}`];
    const attackerId = `review-and-prep.attacker.${list}.${at + 1}`;
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=${1 + overlapId.length}`);
    expect(drifts(r.lines).map((l) => l.split(' ')[2])).toEqual([...overlapId, attackerId]);
    const line = r.lines.findIndex((l) => l.startsWith(`DRIFT anchor ${attackerId} `));
    expect(line).toBeGreaterThan(-1);
    expect(r.lines[line]).toContain(`anchor not found byte for byte in ${realpathSync(path)}`);
    expect(r.lines[line + 1]).toBe(ATTACKER_EFFECT);
    expect(r.lines[line + 2]).toContain('  fix: run /gstack-extend-upgrade and rerun');
    expect(r.lines[line + 2]).toContain('docs/upstream-check.md#drift-anchor');
    for (const gate of ['incap', 'fix-first', 'test-gaps', 'pregate-narrowing', 'delegate', 'fold', 'overlap', 'attacker']) expect(r.lines).toContain(`OK inventory review-and-prep.${gate}`);
    expect(r.out).not.toContain('the in-cap delta is inactive');
    expect(r.out).not.toContain('delegate=<parts> is inactive');
    expect(r.out).not.toContain('specialists=fold is inactive');
    if (!overlapId.length) expect(r.out).not.toContain('first-cycle=overlap is inactive');
  }, 30000);

  // Value: protects=all-or-none adversarial-item anchors report OK + INFO not-declared when both lines are absent from the review file, and drift when partial; fails_when=an item-free review file drifts adversarial-item or a partial item passes; why_new=Track 72B list (c) all-or-none contract; seam=none
  test.each(['nested', 'sibling'] as const)('all-or-none adversarial-item anchors in the %s layout report OK + INFO not-declared when absent, and drift when partial', async (layout) => {
    const withoutItem = upstream(layout);
    let body = readFileSync(withoutItem.files.review!, 'utf8');
    for (const line of ATTACKER['adversarial-item']) body = body.split(line).join('');
    writeFileSync(withoutItem.files.review!, body);
    const r = await check(rootArgs(withoutItem));
    expectAgreement(r);
    // Removing the shared second line drifts overlap.review.5 while attacker.adversarial-item is not-declared and OK.
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=1`);
    expect(drifts(r.lines).map((l) => l.split(' ')[2])).toEqual(['review-and-prep.overlap.review.5']);
    const real = realpathSync(withoutItem.files.review!);
    expect(r.lines).toContain(`INFO not-declared review-and-prep.attacker.adversarial-item ${real}`);
    for (const n of [1, 2]) expect(r.lines).toContain(`OK anchor review-and-prep.attacker.adversarial-item.${n}`);
    expect(r.lines).toContain(`INFO inspected attacker ${ATTACKER_QUALIFIED.revision} ${ATTACKER_QUALIFIED.version}`);
    expect(r.lines).toContain(`INFO file red-team ${realpathSync(withoutItem.files['red-team']!)}`);
  }, 30000);

  const NARROW_EFFECT = '  effect: /review-and-prep: a pass under full-suite=external does not narrow the pregate, so the pregate runs as today and the receipt says so';
  const narrowFile = (f: Fixture, file: 'bin' | 'index' | 'lanes') => f.files[`pregate${file[0]!.toUpperCase()}${file.slice(1)}`]!;
  // Value: protects=each installed pregate file's narrowing drift names its stage cost and docs link, and leaves every other gate OK; fails_when=a changed anchor passes, reports another gate's effect or turns another gate off; why_new=fourth upstream gate across three files and two layouts; seam=none
  test.each([
    ['nested', 'bin', 'review-and-prep.pregate-narrowing.bin.1', '--stage preflight|tests|guards|all   default all'],
    ['sibling', 'bin', 'review-and-prep.pregate-narrowing.bin.2', "--explain                     print each selected test's provenance and each uncertain mapping"],
    ['nested', 'index', 'review-and-prep.pregate-narrowing.index.1', 'export const CHECKS: readonly CheckDef[] = [regenCheck, secretsCheck, straysCheck, literalsCheck, timingCheck, guardsCheck, lanesCheck];'],
    ['sibling', 'index', 'review-and-prep.pregate-narrowing.index.2', "const selected = o.stage === 'guards' ? CHECKS.filter(c => (PREPUSH_CHECK_IDS as readonly string[]).includes(c.id)) : CHECKS.filter(c => (o.stage === 'all' || c.stage === o.stage) && (!o.only || o.only.includes(c.id)));"],
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

  const OLD_PREGATE_NARROW = {
    'review-and-prep.pregate-narrowing.bin.1': '--stage preflight|tests|all   default all',
    'review-and-prep.pregate-narrowing.index.2': "const selected = CHECKS.filter(c => (o.stage === 'all' || c.stage === o.stage) && (!o.only || o.only.includes(c.id)));",
  } as const;
  // Value: protects=the requalified pregate anchors (the guards stage) report OK on the installed text and DRIFT on the 1.91.367.0 text, in both layouts, as longer spans that do not contain the old ones; fails_when=an anchor is re-loosened to a shorter or contained match, or the old text still passes; why_new=upstream added a guards stage in 1.94.27.0; seam=none
  test.each([
    ['nested', 'bin', 'review-and-prep.pregate-narrowing.bin.1'],
    ['sibling', 'bin', 'review-and-prep.pregate-narrowing.bin.1'],
    ['nested', 'index', 'review-and-prep.pregate-narrowing.index.2'],
    ['sibling', 'index', 'review-and-prep.pregate-narrowing.index.2'],
  ] as const)('requalified anchor in the %s layout\'s pregate %s file: OK on the new text, DRIFT on the old (%s)', async (layout, file, id) => {
    const old = OLD_PREGATE_NARROW[id];
    const current = file === 'bin' ? PREGATE_NARROW.bin[0]! : PREGATE_NARROW.index[1]!;
    expect(current.length).toBeGreaterThan(old.length);
    expect(current.includes(old)).toBe(false);
    const ok = await check(rootArgs(upstream(layout)));
    expect(ok.lines).toContain(`OK anchor ${id}`);
    const f = upstream(layout);
    const path = narrowFile(f, file);
    const before = readFileSync(path, 'utf8');
    expect(before.split(current)).toHaveLength(2);
    writeFileSync(path, before.replace(current, old));
    const r = await check(rootArgs(f));
    expectAgreement(r);
    expect(r.code).toBe(4);
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=1`);
    const at = r.lines.findIndex((l) => l.startsWith(`DRIFT anchor ${id} `));
    expect(at).toBeGreaterThan(-1);
    expect(r.lines[at + 1]).toBe(NARROW_EFFECT);
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

  const LOCATION_EFFECT = '  effect: bin/secret-dispositions: a reviewed MEDIUM secret finding may be refused as unrecognized, so the pregate gate stays blocked';
  // Value: protects=the two spans of installed secrets.ts that produce the finding location the evaluator reads; fails_when=a span is edited, dropped or reordered without the drift check following; why_new=bin/secret-dispositions reads upstream's rendered location grammar; seam=none
  test('locks the finding-location anchors exactly', () => {
    expect(UPSTREAM_FINDING_ANCHORS).toEqual([
      "`${f.severity} ${f.id} [${f.category}]: ${f.description ?? ''}${f.line ? ` (${f.file ? `${f.file}, ` : ''}${f.fileLine ? 'line' : 'added line'} ${f.line})` : ''}`",
      'fileLine: !!part.keep',
    ]);
  });

  // Value: protects=a changed finding-location span drifts exactly its own anchor, names its stage cost and docs link, and leaves every other gate OK; fails_when=a changed span passes, reports another gate's effect or turns another gate off; why_new=fifth upstream gate, one installed file in two layouts; seam=none
  test.each([
    ['nested', 1], ['nested', 2], ['sibling', 1], ['sibling', 2],
  ] as const)('a changed finding-location span in the %s layout is drift naming secret-dispositions.location.%d', async (layout, n) => {
    const f = upstream(layout);
    const path = f.files.pregateSecrets!, anchor = UPSTREAM_FINDING_ANCHORS[n - 1]!, changed = `${anchor.slice(0, -2)}!!`;
    writeFileSync(path, readFileSync(path, 'utf8').replace(anchor, () => changed));
    const r = await check(rootArgs(f));
    expectAgreement(r);
    expect(r.code).toBe(4);
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=1`);
    const at = r.lines.findIndex((l) => l.startsWith(`DRIFT anchor secret-dispositions.location.${n} `));
    expect(at).toBeGreaterThan(-1);
    const shown = anchor.replace(/\s+/g, ' ');
    expect(r.lines[at]).toContain(shown.length > 70 ? `"${shown.slice(0, 69)}…"` : `"${shown}"`);
    expect(r.lines[at + 1]).toBe(LOCATION_EFFECT);
    expect(r.lines[at + 2]).toContain('  fix: run /gstack-extend-upgrade and rerun');
    expect(r.lines[at + 2]).toContain('docs/upstream-check.md#drift-anchor');
    // The other gates, and the other location anchor, are independent.
    expect(r.lines).toContain(`OK anchor secret-dispositions.location.${3 - n}`);
    for (const gate of ['incap', 'fix-first', 'test-gaps', 'pregate-narrowing']) expect(r.lines).toContain(`OK inventory review-and-prep.${gate}`);
    for (const m of [1, 2, 3]) expect(r.lines).toContain(`OK anchor review-and-prep.incap.${m}`);
    for (const m of [1, 2, 3, 4, 5]) expect(r.lines).toContain(`OK anchor review-and-prep.pregate-narrowing.lanes.${m}`);
    expect(r.out).not.toContain('the in-cap delta is inactive');
    expect(r.out).not.toContain('a pass under full-suite=external does not narrow the pregate');
  }, 30000);

  // Value: protects=a missing installed secrets.ts drifts exactly the two location anchors with a path-naming reason, in both layouts; fails_when=a missing file passes, drifts another file's anchors or reads the wrong layout path; why_new=one new installed file; seam=none
  test.each(['nested', 'sibling'] as const)('a missing pregate secrets file in the %s layout drifts the two location anchors and nothing else', async (layout) => {
    const f = upstream(layout);
    const path = f.files.pregateSecrets!;
    rmSync(path);
    const r = await check(rootArgs(f));
    expectAgreement(r);
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=2`);
    expect(drifts(r.lines).map((l) => l.split(' ')[2])).toEqual(['secret-dispositions.location.1', 'secret-dispositions.location.2']);
    for (const line of drifts(r.lines)) expect(line).toContain(`pregate secrets check not found: ${path}`);
    expect(r.lines.filter((l) => l.startsWith('INFO file pregate.secrets '))).toEqual([]);
  }, 30000);

  // Value: protects=a healthy secrets.ts is reported as INFO under the gstack root in both layouts; fails_when=the sibling layout reads it from the skills directory or a healthy file is not reported; why_new=secrets.ts is not in the review or ship skill directories; seam=none
  test('the pregate secrets file is read from the gstack root and reported as INFO in both layouts', async () => {
    for (const layout of ['nested', 'sibling'] as const) {
      const f = upstream(layout);
      const r = await check(rootArgs(f));
      expect(r.lines).toContain(`INFO file pregate.secrets ${realpathSync(join(f.root, 'lib', 'pregate', 'checks', 'secrets.ts'))}`);
      for (const n of [1, 2]) expect(r.lines).toContain(`OK anchor secret-dispositions.location.${n}`);
    }
  }, 40000);

  test('a missing root leaves both finding-location anchors not run', async () => {
    const r = await check(['--gstack-root', join(scratch, 'does-not-exist-finding-location')]);
    const anchors = drifts(r.lines).filter((l) => l.startsWith('DRIFT anchor secret-dispositions.location.'));
    expect(anchors).toHaveLength(UPSTREAM_FINDING_ANCHORS.length);
    for (const line of anchors) expect(line).toContain('not run: gstack root unavailable');
  }, 30000);

  // Value: protects=the finding-location anchors report after the pregate-narrowing anchors and before the export checks; fails_when=a gate moves in the report; why_new=fifth anchor group; seam=none
  test('the finding-location anchors report after the pregate-narrowing anchors and before the export checks', async () => {
    const r = await check(rootArgs(upstream('nested')));
    const ids = r.lines.filter((l) => l.startsWith('OK ')).map((l) => l.split(' ').slice(1).join(' '));
    expect(ids.filter((id) => id.startsWith('anchor secret-dispositions.'))).toEqual(UPSTREAM_FINDING_ANCHORS.map((_, i) => `anchor secret-dispositions.location.${i + 1}`));
    expect(ids.indexOf('anchor review-and-prep.pregate-narrowing.lanes.5')).toBeLessThan(ids.indexOf('anchor secret-dispositions.location.1'));
    expect(ids.indexOf('anchor secret-dispositions.location.2')).toBeLessThan(ids.indexOf('export outside-review.runClaudeCode'));
  }, 30000);

  // Value: protects=the check stays read-only on a healthy and on a drifted secrets.ts; fails_when=a run adds, removes or rewrites a file under the root; why_new=the check reads one more installed file; seam=none
  test('a healthy and a drifted run leave the root\'s file list and secrets.ts bytes unchanged', async () => {
    const f = upstream('nested');
    const path = f.files.pregateSecrets!;
    const listing = () => readdirSync(f.root, { recursive: true }).map(String).sort();
    for (const drifted of [false, true]) {
      if (drifted) writeFileSync(path, readFileSync(path, 'utf8').replace('fileLine: !!part.keep', () => 'fileLine: false'));
      const files = listing(), bytes = readFileSync(path);
      const r = await check(rootArgs(f));
      expect(r.result).toBe(drifted ? `RESULT drift checks=${CHECKS} drift=1` : `RESULT ok checks=${CHECKS} drift=0`);
      expect(listing()).toEqual(files);
      expect(readFileSync(path).equals(bytes)).toBe(true);
    }
  }, 40000);

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
    expect(r.result).toBe(`RESULT drift checks=${CHECKS} drift=${CHECKS - 8}`);
    expect(drifts(r.lines).filter((l) => !l.startsWith('DRIFT root')).every((l) => l.includes('not run: gstack root unavailable'))).toBe(true);
    expect(r.lines).toContain('  fix: pass --gstack-root (and --skills-dir if needed) for the host being launched; see docs/upstream-check.md#drift-root');
    expect(r.out).not.toContain('is credited clean');
  }, 30000);
});

describe('bounded reads', () => {
  test('a directory, a FIFO and an oversized file are malformed inputs', async () => {
    const f = upstream('nested');
    rmSync(f.files.review!);
    mkdirSync(f.files.review!);
    rmSync(f.files.checklist!);
    expect(spawnSync('mkfifo', [f.files.checklist!]).status).toBe(0);
    writeFileSync(f.files.coverage!, Buffer.alloc(4 * 1024 * 1024 + 1, 0x61));
    const r = await check(rootArgs(f));
    expectAgreement(r);
    expect(r.code).toBe(4);
    const text = r.out;
    expect(text).toContain(`review skill is not a regular file: ${realpathSync(f.files.review!)}`);
    expect(text).toContain(`review checklist is not a regular file: ${realpathSync(f.files.checklist!)}`);
    expect(text).toContain('coverage audit section is larger than 4 MiB');
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

  // Value: protects=a reworded delegate activation paragraph reports its own inventory drift and leaves the other inventories alone; fails_when=the delegate list reuses another check or vanishes silently; why_new=fifth inventory source; seam=none
  test('a copied tree with a reworded activation paragraph reports DRIFT inventory for delegation only', () => {
    const copy = fresh('copy-delegate');
    cpSync(join(REPO, 'src'), join(copy, 'src'), { recursive: true });
    mkdirSync(join(copy, 'bin'));
    cpSync(LAUNCHER, join(copy, 'bin', 'upstream-check'));
    writeFileSync(join(copy, 'VERSION'), '9.9.9\n');
    put(join(copy, 'skills', 'review-and-prep.md'),
      readFileSync(join(REPO, 'skills', 'review-and-prep.md'), 'utf8').replace(DELEGATE_HEADING, '**Activation of delegation.**'));
    const r = launch(rootArgs(upstream('nested')), {}, cwd, join(copy, 'bin', 'upstream-check'));
    expect(r.status).toBe(4);
    expect(drifts(r.stdout.split('\n')).map((l) => l.split(' ').slice(1, 3).join(' '))).toEqual(['inventory review-and-prep.delegate']);
    expect(r.stdout).toContain('DRIFT inventory review-and-prep.delegate activation paragraph not found');
    for (const gate of ['incap', 'fix-first', 'test-gaps', 'pregate-narrowing']) expect(r.stdout).toContain(`OK inventory review-and-prep.${gate}`);
    expect(r.stdout).not.toContain('review-and-prep.delegate.review.');
    expect(r.stdout).toContain('  effect: /review-and-prep: the delegation anchors cannot be listed, so delegate=<part> is unverified and stays inactive');
    expect(r.stdout.trimEnd().split('\n').at(-1)).toBe(`RESULT drift checks=${CHECKS - DELEGATE_ANCHORS} drift=1`);
  }, 40000);

  // Value: protects=a reworded fold activation paragraph reports its own inventory drift and leaves the other inventories alone; fails_when=the fold list reuses another check or vanishes silently; why_new=sixth inventory source; seam=none
  test('a copied tree with a reworded activation paragraph reports DRIFT inventory for the fold only', () => {
    const copy = fresh('copy-fold');
    cpSync(join(REPO, 'src'), join(copy, 'src'), { recursive: true });
    mkdirSync(join(copy, 'bin'));
    cpSync(LAUNCHER, join(copy, 'bin', 'upstream-check'));
    writeFileSync(join(copy, 'VERSION'), '9.9.9\n');
    put(join(copy, 'skills', 'review-and-prep.md'),
      readFileSync(join(REPO, 'skills', 'review-and-prep.md'), 'utf8').replace(FOLD_HEADING, '**Activation of the fold.**'));
    const r = launch(rootArgs(upstream('nested')), {}, cwd, join(copy, 'bin', 'upstream-check'));
    expect(r.status).toBe(4);
    expect(drifts(r.stdout.split('\n')).map((l) => l.split(' ').slice(1, 3).join(' '))).toEqual(['inventory review-and-prep.fold']);
    expect(r.stdout).toContain('DRIFT inventory review-and-prep.fold activation paragraph not found');
    for (const gate of ['incap', 'fix-first', 'test-gaps', 'pregate-narrowing', 'delegate']) expect(r.stdout).toContain(`OK inventory review-and-prep.${gate}`);
    expect(r.stdout).not.toContain('review-and-prep.fold.review.');
    expect(r.stdout).toContain('  effect: /review-and-prep: the fold anchors cannot be listed, so specialists=fold is unverified and stays inactive');
    expect(r.stdout.trimEnd().split('\n').at(-1)).toBe(`RESULT drift checks=${CHECKS - FOLD_ANCHORS} drift=1`);
  }, 40000);

  // Value: protects=a reworded overlap activation paragraph reports its own inventory drift and leaves the other inventories alone; fails_when=the overlap list reuses another check or vanishes silently; why_new=seventh inventory source; seam=none
  test('a copied tree with a reworded activation paragraph reports DRIFT inventory for overlap only', () => {
    const copy = fresh('copy-overlap');
    cpSync(join(REPO, 'src'), join(copy, 'src'), { recursive: true });
    mkdirSync(join(copy, 'bin'));
    cpSync(LAUNCHER, join(copy, 'bin', 'upstream-check'));
    writeFileSync(join(copy, 'VERSION'), '9.9.9\n');
    put(join(copy, 'skills', 'review-and-prep.md'),
      readFileSync(join(REPO, 'skills', 'review-and-prep.md'), 'utf8').replace(OVERLAP_HEADING, '**Activation of overlap.**'));
    const r = launch(rootArgs(upstream('nested')), {}, cwd, join(copy, 'bin', 'upstream-check'));
    expect(r.status).toBe(4);
    expect(drifts(r.stdout.split('\n')).map((l) => l.split(' ').slice(1, 3).join(' '))).toEqual(['inventory review-and-prep.overlap']);
    expect(r.stdout).toContain('DRIFT inventory review-and-prep.overlap activation paragraph not found');
    for (const gate of ['incap', 'fix-first', 'test-gaps', 'pregate-narrowing', 'delegate', 'fold']) expect(r.stdout).toContain(`OK inventory review-and-prep.${gate}`);
    expect(r.stdout).not.toContain('review-and-prep.overlap.review.');
    expect(r.stdout).toContain('  effect: /review-and-prep: the overlap anchors cannot be listed, so first-cycle=overlap is unverified and stays inactive');
    expect(r.stdout.trimEnd().split('\n').at(-1)).toBe(`RESULT drift checks=${CHECKS - OVERLAP_ANCHORS} drift=1`);
  }, 40000);

  test('a missing extension dependency uses the internal-error contract before output', () => {
    const copy = fresh('missing-local-module');
    cpSync(join(REPO, 'src'), join(copy, 'src'), { recursive: true });
    put(join(copy, 'bin', 'upstream-check'), readFileSync(LAUNCHER, 'utf8'));
    put(join(copy, 'VERSION'), '9.9.9\n');
    rmSync(join(copy, 'src', 'secret-dispositions', 'evaluate.ts'));
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
  test.skipIf(!process.env.GSTACK_OUTSIDE_TEST_ROOT)('the finding-location anchors match the root named by GSTACK_OUTSIDE_TEST_ROOT, whatever else drifts', async () => {
    const r = await check(['--gstack-root', process.env.GSTACK_OUTSIDE_TEST_ROOT!]);
    for (const n of [1, 2]) expect(r.lines).toContain(`OK anchor secret-dispositions.location.${n}`);
  }, 30000);

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
  const covered = [...delimiters(HEADING, 1), ...delimiters(FIX_FIRST_HEADING, 2), ...delimiters(TEST_GAP_HEADING, 4), ...delimiters(PREGATE_NARROW_HEADING, 3), ...delimiters(DELEGATE_HEADING, 6), ...delimiters(FOLD_HEADING, 11), ...delimiters(OVERLAP_HEADING, 2), ...delimiters(ATTACKER_HEADING, 3)];
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

  const revisions = (text: string) => [...text.matchAll(/^\| (Wrapper anchors[^|]*|Fix-First anchors[^|]*|Test-gap anchors[^|]*|Pregate-narrowing anchors[^|]*|Secret-finding location anchors[^|]*|Delegation anchors|Fold anchors|Overlap anchors|Attacker-part anchors|Outside-review adapter) \| `([0-9a-f]{40})` \| ([^|]+) \|$/gm)]
    .map((m) => [m[1], m[2], m[3]]);
  const expectedRevisions = [
    ['Wrapper anchors and classifier cases (qualified by this Track)', ANCHORS_QUALIFIED.revision, ANCHORS_QUALIFIED.version],
    ['Fix-First anchors', FIX_FIRST_QUALIFIED.revision, FIX_FIRST_QUALIFIED.version],
    ['Test-gap anchors', TEST_GAP_QUALIFIED.revision, TEST_GAP_QUALIFIED.version],
    ['Pregate-narrowing anchors', PREGATE_NARROW_QUALIFIED.revision, PREGATE_NARROW_QUALIFIED.version],
    ['Secret-finding location anchors', FINDING_LOCATION_QUALIFIED.revision, FINDING_LOCATION_QUALIFIED.version],
    ['Delegation anchors', DELEGATE_QUALIFIED.revision, DELEGATE_QUALIFIED.version],
    ['Fold anchors', FOLD_QUALIFIED.revision, FOLD_QUALIFIED.version],
    ['Overlap anchors', OVERLAP_QUALIFIED.revision, OVERLAP_QUALIFIED.version],
    ['Attacker-part anchors', ATTACKER_QUALIFIED.revision, ATTACKER_QUALIFIED.version],
    ['Outside-review adapter', INSPECTED_UPSTREAM.revision, INSPECTED_UPSTREAM.version],
  ];
  // Value: protects=the documents no longer leave the delegation and fold review anchors unqualified, and state the specialist-dispatch settlement; fails_when=the old unqualified section returns or the settlement subsection drops its core terms; why_new=criterion 5; seam=none
  test('the documents replace the unqualified-anchors section with the specialist-dispatch settlement', () => {
    const oldAt = docs.indexOf('### Anchors left unqualified');
    if (oldAt >= 0) {
      const oldSection = docs.slice(oldAt, docs.indexOf('\n## ', oldAt));
      expect(oldSection).not.toContain('review-and-prep.delegate.review.1');
      expect(oldSection).not.toContain('review-and-prep.fold.review.1');
    } else {
      expect(oldAt).toBe(-1);
    }
    const at = docs.indexOf("### Upstream's specialist-dispatch item");
    expect(at).toBeGreaterThan(-1);
    const section = docs.slice(at, docs.indexOf('\n## ', at));
    expect(section).toContain('specialists-dispatched');
    expect(section).toContain('waive');
    expect(section).toContain('not-declared');
  });

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
    expect(docs).toContain('`OK` means only that the listed anchors, exports and classifier cases matched');
    for (const kind of ['root', 'inventory', 'anchor', 'export', 'classifier']) expect(docs).toContain(`id="drift-${kind}"`);
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
