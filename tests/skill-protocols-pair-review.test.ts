/**
 * skill-protocols-pair-review.test.ts — drift-locks for skills/pair-review.md.
 *
 * Split from tests/skill-protocols.test.ts, which keeps the cross-skill rules.
 * tests/helpers/touchfiles.ts declares every skill file this suite reads, and
 * tests/touchfiles.test.ts checks that declaration against the paths named here.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateTagExpression } from '../src/audit/lib/source-tag.ts';
import {
  agentShells,
  extractFences,
  runShell,
  scopedEnv,
  writeUpdateCheck,
} from './helpers/extend-root.ts';
import { makeBaseTmp } from './helpers/fixture-repo.ts';
import {
  skillSection,
  flatProse,
  type Clause,
  missingClauses,
  stateBashFences,
  guardOrdered,
  PAUSE_MARKERS,
} from './helpers/skill-protocols.ts';

const ROOT = join(import.meta.dir, '..');

describe('pair-review multi-table templates', () => {
  const file = join(ROOT, 'skills', 'pair-review.md');
  const content = readFileSync(file, 'utf8');

  test('contains per-group mini-table template', () => {
    expect(content).toContain('GSTACK REVIEW REPORT — <group-name> group');
  });

  test('contains session-done rollup template', () => {
    expect(content).toContain('GSTACK REVIEW REPORT — session rollup');
  });
});

// ─── Per-branch session-path drift-lock ─────────────────────────────
//
// pair-review sessions are now keyed by branch: SESSION_DIR resolves to
// `<PR_PROJECT_DIR>/branches/<sanitized-branch>/`. The old stale-branch
// guard (which auto-archived sessions on branch mismatch) is no longer
// needed — different branches simply live at different paths. Lock the
// new shape so a future edit can't silently regress to the single-slot
// design.
describe('pair-review per-branch session paths', () => {
  const file = join(ROOT, 'skills', 'pair-review.md');
  const content = readFileSync(file, 'utf8');

  test('preamble resolves SESSION_DIR with branch arg', () => {
    expect(content).toContain('session_dir pair-review "$BRANCH"');
  });

  test('preamble resolves PROJECT_DIR (no branch)', () => {
    // The branchless call still exists for project-level resources (deploy.md).
    expect(content).toMatch(/PROJECT_DIR=\$\(session_dir pair-review\)/);
  });

  test('Active Session Guard does not contain the legacy stale-branch awk', () => {
    // The auto-archive-on-mismatch logic is dead code now; if a future edit
    // re-introduces the awk parse it likely means we regressed to one-slot.
    expect(content).not.toContain(`awk -F': *' '$1=="branch" {print $2; exit}'`);
  });

  test('Active Session Guard archives with per-branch arg', () => {
    const idx = content.indexOf('## Active Session Guard');
    expect(idx).toBeGreaterThan(-1);
    const next = content.indexOf('## ', idx + 3);
    const section = content.slice(idx, next === -1 ? undefined : next);
    expect(section).toContain('session_archive_dir pair-review "$TS" "$BRANCH"');
  });
});

// ─── Smart-batching coverage feature drift-locks ─────────────────────
//
// /pair-review smart-batching adds plan-time coverage hints, a post-PASS
// bundle prompt, a PASSED_BY_COVERAGE terminal status, FAIL-time E3
// demotion of bundled items, a Phase 3 COVERAGE dashboard sub-block, and
// Phase 4 report savings/acceptance/warnings lines. The skill is a markdown
// prompt file (not executable code), so these invariants lock the prose
// patterns that the agent reads at runtime. If a future edit silently
// strips one of these load-bearing constructs, the feature degrades to
// the pre-coverage behavior without any code-level signal.

describe('pair-review smart-batching: coverage feature drift-locks', () => {
  const file = join(ROOT, 'skills', 'pair-review.md');
  const content = readFileSync(file, 'utf8');

  test('canonical "terminal-passed statuses" definition exists', () => {
    // F1 prose-as-code: the named-reference pattern that filter sites
    // throughout the skill use instead of inline-enumerating PASSED +
    // PASSED_BY_COVERAGE. Drift here means filter sites diverge.
    expect(content).toContain('**Terminal-passed statuses**: PASSED or PASSED_BY_COVERAGE');
  });

  test('terminal-passed statuses referenced at known filter sites', () => {
    // The phrase must appear at multiple filter sites — not just the
    // definition. If a site falls back to inline-PASSED, this fails.
    const occurrences = content.match(/terminal-passed statuses/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(4);
  });

  test('PASSED_BY_COVERAGE status enum value present', () => {
    expect(content).toContain('PASSED_BY_COVERAGE');
  });

  test('Covers field in item-format spec block', () => {
    expect(content).toContain('- Covers: [<item-indices>]');
  });

  test('CoverageNote field in item-format spec block', () => {
    expect(content).toContain('- CoverageNote: <text>');
  });

  test('session.yaml summary includes coverage counters', () => {
    expect(content).toContain('passed_by_coverage:');
    expect(content).toContain('bundles_offered:');
    expect(content).toContain('bundles_accepted:');
    expect(content).toContain('bundles_rejected:');
  });

  test('coverage_warnings is a single list with phase tag (ER2)', () => {
    // F3 DRY win: one list + phase tag, not two parallel lists.
    expect(content).toContain('coverage_warnings:');
    expect(content).not.toContain('coverage_inference_warnings');
    // phase tag must be referenced near the schema definition
    const idx = content.indexOf('coverage_warnings:');
    expect(content.slice(idx, idx + 200)).toMatch(/phase:\s*inference\s*\|\s*resume/);
  });

  test('transitive coverage explicit non-support note exists', () => {
    expect(content).toMatch(
      /Transitive coverage is explicitly NOT supported/,
    );
  });

  test('inference heuristic names present (3 heuristics)', () => {
    expect(content).toContain('Same-prerequisite-action');
    expect(content).toContain('Strict subset');
    expect(content).toContain('Same observation, different framing');
  });

  test('validation rules (4) named in skill prose', () => {
    expect(content).toContain('No self-reference');
    expect(content).toContain('No cycles');
    expect(content).toContain('Existence');
    expect(content).toContain('Intra-group');
  });

  test('cycle-handling rule names SCC and highest-index tiebreak', () => {
    // Determinism is testable. The prose must lock the policy so a future
    // edit doesn't reduce it to a vague "drop one edge."
    expect(content).toContain('strongly connected component');
    expect(content).toMatch(/highest item index/i);
  });

  test('F2: load-bearing E3 re-read sentence exists', () => {
    // Without this sentence, lookahead-invalidation degrades silently:
    // the next prompt may use stale N+1 description from before the FAIL,
    // skipping past a newly-demoted UNTESTED item. Match the load-bearing
    // fragments rather than the exact wrapped-prose layout (whitespace can
    // legitimately shift with future markdown edits).
    const normalized = content.replace(/\s+/g, ' ');
    expect(normalized).toContain(
      'the next prompt MUST do a full group re-read',
    );
    expect(normalized).toContain(
      'demotion changed the UNTESTED set behind lookahead\'s back',
    );
  });

  test('multi-cover demotion rule: only when ALL covers non-PASSED', () => {
    // Codex T4 catch: single-cover demotion would silently destroy signal
    // when an item has multiple backings. The plan locks the safer rule.
    expect(content).toMatch(
      /demotes from `PASSED_BY_COVERAGE` to `UNTESTED`.+only when every item/,
    );
  });

  test('directly-PASSED items NEVER demote on covering-item FAIL', () => {
    // Integrity invariant: direct evidence is independent. If a future edit
    // tries to "simplify" by demoting all items in the Covers list, this
    // fails.
    expect(content).toContain('Direct `PASSED` items NEVER demote');
  });

  test('E3 demotion applies to ALL FAIL paths (not just Fix Now)', () => {
    expect(content).toMatch(
      /E3 demotion \(always — applies to ALL FAIL paths, not just Fix Now\)/,
    );
  });

  test('trust-posture language: verified by action vs observed property', () => {
    // Codex T2 catch: "covered" ≠ "observed". The bundle prompt and the
    // skill prose must explicitly calibrate trust.
    expect(content).toContain('verified by action');
    expect(content).toContain('observed property');
  });

  test('Phase 3 dashboard COVERAGE sub-block template tokens', () => {
    // ER3 dashboard render: the template must include the literal tokens
    // an agent will pattern-match against. Skip-condition language must
    // also be present (otherwise the block renders unconditionally).
    expect(content).toContain('COVERAGE: 3 bundles in plan');
    expect(content).toContain('Omit the COVERAGE block ENTIRELY if no item');
  });

  test('Phase 4 report Coverage savings line template', () => {
    expect(content).toContain('Coverage savings: K items confirmed by coverage');
    expect(content).toContain('Bundles accepted: B/O');
  });

  test('Phase 4 report Coverage warnings line omit-when-empty rule', () => {
    expect(content).toContain('Omit this line entirely if `coverage_warnings` is empty');
  });

  test('BATCH out-of-batch post-batch-walk explicit (ER4)', () => {
    // The non-trivial BATCH-coverage interaction Codex flagged: out-of-batch
    // covers must spawn post-batch bundle prompts. Locking the prose
    // prevents a future "simplification" from silently dropping the walk.
    expect(content).toContain('Out-of-batch covers');
    // Multi-line prose: scan for the load-bearing fragment without anchoring
    // on whitespace shape (the surrounding markdown wraps mid-sentence).
    const normalized = content.replace(/\s+/g, ' ');
    expect(normalized).toMatch(
      /after the batch resolves to disk, fire the standard post-PASS bundle prompt/,
    );
  });

  test('BATCH keeps index-ordered selection (no leapfrogging)', () => {
    expect(content).toContain('BATCH keeps **index-ordered** selection');
  });

  test('fix-commit-message COVERS_SUFFIX variable referenced', () => {
    // Locks the in-paren commit-message format. A future edit that drops
    // the suffix variable would silently lose coverage provenance in the
    // git log.
    expect(content).toContain('COVERS_SUFFIX');
    expect(content).toContain('pair-review item <N>$COVERS_SUFFIX');
  });
});

// ─── Smart-batching prompt-options table (T12) ───────────────────────
//
// Every new AskUserQuestion site introduced by smart-batching must use
// exact, agreed option strings. Capitalization drift (e.g., "All Pass" vs
// "All pass") or reordering would silently confuse the agent at runtime
// since prose-driven skills rely on string-matching for prompt detection.
// Single table, iterated below; one row = one site = one assertion.

const SMART_BATCHING_PROMPT_OPTIONS: Array<{ site: string; needle: string }> = [
  // Post-PASS coverage bundle prompt — options match the existing BATCH
  // mode capitalization convention ("All pass" not "All Pass").
  {
    site: 'post-PASS coverage bundle',
    needle: 'Options: ["All pass", "Mark individually", "Park a bug"]',
  },
  // Phase 1 Step 4.5 coverage graph review (top-level prompt).
  {
    site: 'coverage graph review (top-level)',
    needle: 'Options: ["Approve as-is", "Edit", "Strip all coverage"]',
  },
  // Phase 1 Step 4.5 edit-loop menu.
  {
    site: 'coverage edit menu',
    needle: 'Options: ["Drop an edge", "Add an edge", "Strip all coverage", "Done editing"]',
  },
  // Phase 1 Step 4.5 bail-out (after 3 consecutive invalid edits).
  {
    site: 'coverage edit bail-out',
    needle: 'Options: ["Strip all coverage", "Keep editing"]',
  },
  // Add Item Phase 2 — covers picker first question.
  {
    site: 'add-item covers picker',
    needle: 'Options: ["No", "Yes — pick targets"]',
  },
];

describe('pair-review smart-batching: prompt-options table (T12)', () => {
  const file = join(ROOT, 'skills', 'pair-review.md');
  const content = readFileSync(file, 'utf8');

  for (const { site, needle } of SMART_BATCHING_PROMPT_OPTIONS) {
    test(`${site}: options array matches exactly`, () => {
      if (!content.includes(needle)) {
        throw new Error(
          `Prompt-options drift at "${site}". Expected verbatim: ${needle}`,
        );
      }
    });
  }
});

// ─── Item-shape + merge-gate drift-locks ─────────────────────────────
//
// Two session-speed regressions the skill previously allowed:
//
//   1. Over-splitting — two items describing one glance, each asking its
//      own question (or worse, linked by a Covers edge that costs an extra
//      bundle prompt to resolve). Fixed by the Step 3.2 merge gate, which
//      runs BEFORE coverage inference and claims co-observable pairs first.
//   2. Muddy prompts — background, rationale, and file references inlined
//      into the item, burying the instruction. Fixed by the mandatory
//      three-line item shape (action / PASS / FAIL) plus a Context: field
//      that lives on disk and is never rendered in a prompt.
//
// Both fixes are prose the agent reads at runtime, so lock the load-bearing
// phrasing. Silent removal degrades straight back to the old behavior with
// no code-level signal.

describe('pair-review item shape: three-line contract', () => {
  const content = readFileSync(join(ROOT, 'skills', 'pair-review.md'), 'utf8');
  const normalized = content.replace(/\s+/g, ' ');

  test('Pass/Fail/Context fields exist in the item-format spec block', () => {
    expect(content).toContain('- Pass: <observable state that means it worked>');
    expect(content).toContain('- Fail: <the concrete wrong behavior to watch for>');
    expect(content).toContain(
      '- Context: <background — written to disk, NEVER rendered in a prompt>',
    );
  });

  test('sizing rule is a ceiling, not a target', () => {
    // The old "Each group has 3-7 items" read as a quota and pressured
    // splitting to fill it. If a future edit reintroduces a count target,
    // over-splitting comes back.
    expect(content).not.toContain('Each group has 3-7 items');
    expect(normalized).toContain('7 items per group is a **ceiling, not a target**');
  });

  test('FAIL-is-not-negation-of-PASS rule present', () => {
    // Without this, FAIL lines collapse to "not the above", which tells the
    // human nothing about what to watch for.
    expect(content).toContain('**FAIL is not the negation of PASS.**');
  });

  test('no-background-in-item rule present', () => {
    expect(content).toContain('**No background in the item.**');
    expect(normalized).toContain('never rendered in a prompt');
  });

  test('unwritable-PASS forcing function present', () => {
    // The rule that converts vague items into either a dropped item or a
    // rewritten one, instead of shipping them and hoping.
    expect(normalized).toContain(
      'if you cannot write a one-line observable PASS, it is not a manual test item',
    );
  });

  test('Phase 2 prompt template renders action + PASS + FAIL, lookahead action-only', () => {
    expect(content).toContain(
      '**[Group] [N]/[Total]:** [Action line]\\n\\nPASS: [item\'s Pass field]\\nFAIL: [item\'s Fail field]',
    );
    expect(content).toContain("_Next up: [N+1]. [Next item's action line only]_");
  });

  test('Phase 2 prompt has an explicit nothing-else clause', () => {
    // Load-bearing: this is the sentence that stops rationale and diff
    // summaries from leaking back into the question the human answers.
    expect(content).toContain('**Nothing else goes in the prompt.**');
    expect(normalized).toContain(
      'The prompt is exactly: receipt, action, PASS, FAIL, lookahead',
    );
  });

  test('plan review renders action lines only', () => {
    expect(normalized).toContain('Show each group with its items — **action lines only**');
  });

  test('legacy items without Pass/Fail render heading-only on resume', () => {
    // Sessions started before the three-line shape have items with no Pass:/
    // Fail: fields. Without this fallback the Phase 2 template renders bare
    // "PASS:" / "FAIL:" labels with nothing after them.
    expect(content).toContain('**Legacy items (sessions started before the three-line shape).**');
    expect(normalized).toContain('do NOT emit empty `PASS:` / `FAIL:` labels');
  });

  // Every other site that renders an item to the user. Each one previously
  // interpolated a single opaque `[Item description]`; reverting any of them
  // reintroduces the muddiness the three-line shape exists to prevent.

  test('retest-after-fix prompt renders action + PASS + FAIL', () => {
    expect(content).toContain(
      "**[Group] [N]/[Total]:** [Action line]\\n\\nPASS: [item's Pass field]\\nFAIL: [item's Fail field]",
    );
    expect(normalized).toContain(
      'Do not append an explanation of the fix to this prompt',
    );
  });

  test('BATCH prompt renders action + PASS per item, Fail omitted on purpose', () => {
    expect(content).toContain('[N]. [Action line]\\n    PASS: [Pass field]');
    expect(content).toContain('_Next up: [N+3]. [Post-batch action line]_');
    // The omission must stay documented as deliberate, or a future reader
    // "fixes" it by re-adding FAIL and the batch block stops being scannable.
    expect(normalized).toContain(
      'Batch mode renders **action + PASS only** — the `Fail:` field is omitted on purpose',
    );
  });

  test('bundle prompt lists covered items as action + PASS', () => {
    expect(content).toContain('[N]. <Item N action line> — PASS: <Item N Pass field>');
    expect(content).toContain('[M]. <Item M action line> — PASS: <Item M Pass field>');
  });

  test('no item-render site still uses the opaque [Item description] token', () => {
    // Catch-all: the old placeholder must not survive at any render site.
    // Prose references to "item description" (e.g. the FAIL-handler lookahead
    // sentence) are fine — only the bracketed template token is banned.
    expect(content).not.toContain('[Item description]');
  });
});

describe('pair-review merge gate (Step 3.2)', () => {
  const content = readFileSync(join(ROOT, 'skills', 'pair-review.md'), 'utf8');
  const normalized = content.replace(/\s+/g, ' ');

  test('merge step exists and is ordered before coverage inference', () => {
    expect(content).toContain('### Step 3.2: Merge co-observable items (run BEFORE coverage inference)');
    const mergeIdx = content.indexOf('### Step 3.2: Merge co-observable items');
    const coversIdx = content.indexOf('### Step 3.5: Infer coverage hints');
    expect(mergeIdx).toBeGreaterThan(-1);
    expect(coversIdx).toBeGreaterThan(mergeIdx);
  });

  test('merge test names the no-additional-action condition', () => {
    expect(normalized).toContain(
      'A single user action puts both properties on screen at the same moment',
    );
    expect(normalized).toContain('no navigation, no click, no scroll, no opening a panel');
  });

  test('merged-item ceiling is judged (FAIL ambiguity), not counted', () => {
    // Learning [qualitative-judgment-not-numeric-thresholds]: a hard "max 4"
    // encodes a programmatic decision where judgment belongs. The rule must
    // stay framed on whether a FAIL would be ambiguous; the count is a guide.
    expect(content).toContain('**Ceiling — judged, not counted**');
    expect(normalized).toContain('Judge the ambiguity, not the count');
  });

  test('merge-vs-Covers boundary stated in both directions', () => {
    // The boundary has to be stated at the merge step AND re-asserted in
    // the Covers heuristics, or inference drifts back to linking pairs that
    // should have been merged.
    expect(normalized).toContain(
      '**Never emit a `Covers:` link between two items visible on the same screen at the same time.**',
    );
    expect(content).toContain('Also disqualifying: **co-visibility**.');
  });

  test('Covers inference declares the merge precondition', () => {
    expect(normalized).toContain(
      'Run this **after** the Step 3.2 merge pass, on the surviving items only',
    );
  });

  test('ADD ITEM applies the merge test to new items', () => {
    expect(normalized).toContain('apply the Step 3.2 merge test against the group\'s existing UNTESTED items');
  });
});

describe('pair-review ordering (Step 3.4)', () => {
  const content = readFileSync(join(ROOT, 'skills', 'pair-review.md'), 'utf8');
  const normalized = content.replace(/\s+/g, ' ');

  test('ordering step exists between merge and coverage inference', () => {
    expect(content).toContain('### Step 3.4: Order for one pass through the app');
    const orderIdx = content.indexOf('### Step 3.4: Order for one pass');
    expect(content.indexOf('### Step 3.2: Merge co-observable items')).toBeLessThan(orderIdx);
    expect(content.indexOf('### Step 3.5: Infer coverage hints')).toBeGreaterThan(orderIdx);
  });

  test('three ordering rules named', () => {
    expect(content).toContain('**State locality first**');
    expect(content).toContain('**Risk breaks ties**');
    expect(content).toContain('**Destructive last**');
  });

  test('ordering precedes index assignment, orphans deferred to Existence rule', () => {
    // Reordering after Covers inference would silently repoint every edge.
    // The claim must stay honest: Step 4 approval can still delete items, so
    // "immutable thereafter" would be false — orphaned edges are the Step 4.5
    // Existence rule's job, not a reason to re-run ordering.
    expect(normalized).toContain('Item indices are assigned **after** this ordering');
    expect(normalized).toContain('caught by the existing **Existence** validation rule');
  });

  test('destructive-last takes precedence over risk-first', () => {
    expect(content).toContain('Rule 3 wins over rule 2.');
  });
});

const initStateTmp = makeBaseTmp('skill-protocols-22d-init-');

const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;

afterAll(() => {
  try {
    rmSync(initStateTmp, { recursive: true, force: true });
  } catch {
    /* a mode-0555 fixture is restored in the test */
  }
});

function initFixture(name: string) {
  const base = join(initStateTmp, name);
  rmSync(base, { recursive: true, force: true });
  const home = join(base, 'home');
  const state = join(base, 'state');
  const cwd = join(base, 'fr22d');
  const checkout = join(base, 'checkout');
  writeUpdateCheck(checkout);
  mkdirSync(join(checkout, 'bin', 'lib'), { recursive: true });
  copyFileSync(join(ROOT, 'bin', 'lib', 'session-paths.sh'), join(checkout, 'bin', 'lib', 'session-paths.sh'));
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  const slugDir = join(state, 'projects', 'fr22d');
  const session = join(slugDir, 'full-review');
  return { home, state, cwd, checkout, slugDir, session };
}

// Track 23D: executable fences and consumer routing contracts.
const PAUSED_CHECK = [
  "PR_CLASS=lookup-failure",
  "PR_REASON=",
  "if [ -z \"$(git remote)\" ]; then",
  "  PR_CLASS=no-github",
  "elif ! command -v gh >/dev/null 2>&1; then",
  "  PR_REASON=gh-missing",
  "elif [ -z \"$(git branch --show-current)\" ]; then",
  "  PR_REASON=detached",
  "else",
  "  _PR_ERR=$(mktemp) || { printf 'PR_CLASS=lookup-failure\\nPR_REASON=api\\n'; exit 0; }",
  "  trap 'rm -f \"$_PR_ERR\" \"${_PR_OUT:-}\"' EXIT",
  "  _PR_OUT=$(mktemp) || { printf 'PR_CLASS=lookup-failure\\nPR_REASON=api\\n'; exit 0; }",
  "  gh pr view --json state,isDraft,url,body,comments --jq '",
  "(.comments // [] | map(select(.viewerDidAuthor == true and",
  "  (.body | contains(\"<!-- review-and-prep:paused:\") or contains(\"<!-- review-and-prep:receipt:\"))))",
  "  | sort_by(.createdAt)) as $markers",
  "| ($markers | map(select(.body | contains(\"<!-- review-and-prep:paused:\"))) | last) as $pause",
  "| (($markers | last | .body // \"\" | contains(\"<!-- review-and-prep:paused:\"))",
  "   or (.isDraft == true and $pause != null)) as $comment_paused",
  "| (.body // \"\" | split(\"\\n\") | map(rtrimstr(\"\\r\"))",
  "   | reduce .[] as $line ({active: false, paused: false};",
  "     if $line == \"## Review and prep\" then .active = true",
  "     else if ($line | startswith(\"## \")) then .active = false",
  "     else if .active and ($line | contains(\"PAUSED\") and contains(\"manual testing required\"))",
  "       then .paused = true else . end end end)) as $section",
  "| ($pause.body // \"\" | split(\"<!-- review-and-prep:paused:\")[1] // \"\"",
  "   | split(\" \")[0] // \"\" | split(\"\\n\")[0] // \"\" | split(\"-->\")[0] // \"\") as $candidate",
  "| (if ($candidate | length) == 40 and",
  "       ($candidate | explode | all((. >= 48 and . <= 57) or (. >= 97 and . <= 102)))",
  "   then $candidate else \"\" end) as $sha",
  "| \"PR_STATE=\\(.state)\", \"PR_DRAFT=\\(.isDraft == true)\", \"PR_URL=\\(.url)\",",
  "  \"BODY_PAUSED=\\($section.paused == true)\", \"COMMENT_PAUSED=\\($comment_paused == true)\", \"PAUSE_SHA=\\($sha)\"",
  "' >\"$_PR_OUT\" 2>\"$_PR_ERR\"",
  "  PR_VIEW_RC=$?",
  "  cat \"$_PR_ERR\" >&2",
  "  printf 'PR_VIEW_RC=%s\\n' \"$PR_VIEW_RC\"",
  "  if [ \"$PR_VIEW_RC\" -ne 0 ]; then",
  "    _PR_ERROR=$(LC_ALL=C tr '[:upper:]' '[:lower:]' < \"$_PR_ERR\")",
  "    case \"$_PR_ERROR\" in",
  "      *'of the git remotes configured for this repository point to a known github host'*|*'no git remotes found'*) PR_CLASS=no-github ;;",
  "      *'no pull requests found for branch'*) PR_CLASS=no-pr ;;",
  "      *) if [ \"$PR_VIEW_RC\" -eq 4 ] || case \"$_PR_ERROR\" in *'gh auth login'*) true ;; *) false ;; esac; then PR_REASON=auth; else PR_REASON=api; fi ;;",
  "    esac",
  "  elif LC_ALL=C awk '",
  "    NR == 1 && /^PR_STATE=(OPEN|CLOSED|MERGED)$/ {next}",
  "    NR == 2 && /^PR_DRAFT=(true|false)$/ {next}",
  "    NR == 3 && /^PR_URL=https?:\\/\\/[^[:space:]]+$/ {next}",
  "    NR == 4 && /^BODY_PAUSED=(true|false)$/ {next}",
  "    NR == 5 && /^COMMENT_PAUSED=(true|false)$/ {next}",
  "    NR == 6 && (/^PAUSE_SHA=$/ || (/^PAUSE_SHA=[0-9a-fA-F]+$/ && length($(0)) == 50)) {next}",
  "    {bad = 1}",
  "    END {exit (bad || NR != 6)}' \"$_PR_OUT\"; then",
  "    awk '{print}' \"$_PR_OUT\"",
  "    if grep -Eq '^(BODY_PAUSED|COMMENT_PAUSED)=true$' \"$_PR_OUT\"; then",
  "      if grep -qx 'PR_STATE=OPEN' \"$_PR_OUT\"; then PR_CLASS=paused; else PR_CLASS=closed-paused; fi",
  "    else",
  "      PR_CLASS=no-pause",
  "    fi",
  "  else",
  "    PR_REASON=unreadable",
  "  fi",
  "fi",
  "printf 'PR_CLASS=%s\\n' \"$PR_CLASS\"",
  "if [ -n \"$PR_REASON\" ]; then printf 'PR_REASON=%s\\n' \"$PR_REASON\"; fi",
].join('\n');

const pairSkill = readFileSync(join(ROOT, 'skills', 'pair-review.md'), 'utf8');

const pairNext = skillSection(skillSection(pairSkill, '## Phase 4: Completion'), '### Step 3: Offer next steps');

const pausedFence = extractFences(pairNext).find(f => f.body.includes('PR_CLASS=lookup-failure'))!.body.trimEnd();

const pauseProgram = /--jq '([\s\S]*?)' >/.exec(pausedFence)![1]!;

const pairGuard = skillSection(pairSkill, '## Active Session Guard');

const pairArchive = extractFences(pairGuard).find(f => f.body.includes('session_archive_dir pair-review'))!.body.trimEnd();

const PAUSE_SHA = 'abcde01234'.repeat(4);

const PR_URL = 'https://github.com/example/project/pull/7';

const STAMP = '20261009-120000';

const jqBin = Bun.which('jq');

const TIMEOUT_23D = 30_000;

const pauseComment = (body = `<!-- review-and-prep:paused:${PAUSE_SHA} -->`, viewerDidAuthor = true, createdAt = '2026-10-09T10:00:00Z') => ({ body, viewerDidAuthor, createdAt });

const receiptComment = (viewerDidAuthor = true, createdAt = '2026-10-09T11:00:00Z') => pauseComment('<!-- review-and-prep:receipt:ready -->', viewerDidAuthor, createdAt);

const prJson = (patch: Record<string, unknown> = {}) => ({ state: 'OPEN', isDraft: false, url: PR_URL, body: '', comments: [], ...patch });

const prLines = (state = 'OPEN', draft = false, body = false, comment = false, sha = '') =>
  `PR_STATE=${state}\nPR_DRAFT=${draft}\nPR_URL=${PR_URL}\nBODY_PAUSED=${body}\nCOMMENT_PAUSED=${comment}\nPAUSE_SHA=${sha}\n`;

type PairFixture = ReturnType<typeof pairFixture>;

function pairGit(cwd: string, home: string, args: string[]): string {
  const r = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd, env: scopedEnv(home, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }), encoding: 'utf8', timeout: 15_000,
  });
  if (r.status !== 0) throw new Error(`fixture git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function pairFixture(name: string) {
  const fx = initFixture(`23d-${name}`);
  pairGit(fx.cwd, fx.home, ['init', '--quiet', '--initial-branch=feature/session']);
  pairGit(fx.cwd, fx.home, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'fixture']);
  const project = join(fx.slugDir, 'pair-review');
  const session = join(project, 'branches', 'feature--session');
  const archive = join(project, 'archives', `feature--session-${STAMP}`);
  const shim = join(fx.home, 'shim');
  const temp = join(fx.home, 'temp');
  mkdirSync(shim, { recursive: true });
  mkdirSync(temp, { recursive: true });
  writeFileSync(join(shim, 'date'), `#!/bin/sh\nprintf '%s\\n' '${STAMP}'\n`, { mode: 0o755 });
  return { ...fx, project, session, archive, shim, temp };
}

function pairRun(fx: PairFixture, block: string, shell: ReturnType<typeof agentShells>[number], extra: Record<string, string> = {}, root = true) {
  return runShell(shell.shell, shell.args, `${root ? '_EXTEND_ROOT="$CHECKOUT"\n' : ''}${block}\n`, scopedEnv(fx.home, {
    CHECKOUT: fx.checkout, GSTACK_STATE_ROOT: fx.state, TMPDIR: fx.temp,
    PATH: `${fx.shim}:/usr/bin:/bin`, ...extra,
  }), fx.cwd);
}

function treeBytes(dir: string): Record<string, string> {
  const entries: Record<string, string> = {};
  if (!existsSync(dir)) return entries;
  const walk = (path: string, relative: string) => {
    const st = lstatSync(path);
    if (st.isSymbolicLink()) entries[relative] = `link:${readlinkSync(path)}`;
    else if (st.isDirectory()) {
      entries[`${relative}/`] = 'directory';
      for (const name of readdirSync(path).sort()) walk(join(path, name), `${relative}/${name}`);
    } else entries[relative] = readFileSync(path).toString('base64');
  };
  walk(dir, '');
  return entries;
}

// Value: protects=failed lookups never become no-pause, and gh/gojq consumes the same program as jq;
// fails_when=validation, remote/auth ordering, or the draft-receipt rule changes;
// why_new=earlier routing did not read the PR; seam=PATH gh shim.
// Live read-only check: extract PAUSED_CHECK and run its unchanged fence in this repo,
// changing only `gh pr view` to `gh pr view 126` (also 130 and 136).
// For the 126/130 body checks, prefix its --jq program with exactly:
// .body = ([.comments[] | select(.body | contains("review-and-prep:paused:"))][0].body) |
// Expect 126/130 PR_STATE=MERGED, COMMENT_PAUSED=false; body-prefix BODY_PAUSED=true;
// 136 BODY_PAUSED=false. Recheck this Track's PR once it exists.
describe('Track 23D paused-check fence', () => {
  test('the complete read-only fence and jq program are locked literally', () => {
    expect(pausedFence).toBe(PAUSED_CHECK);
    expect(stateBashFences(pairSkill).some(f => f.body.includes('PR_CLASS='))).toBe(false);
    expect(pairNext.indexOf(pausedFence)).toBeLessThan(pairNext.indexOf('gstack-review-read'));
    expect(pauseProgram).not.toContain("'");
    const allow = new Set('split rtrimstr contains startswith map select sort_by last any length explode all ascii_downcase join if then else end and or not true false null def as reduce foreach'.split(' '));
    const code = pauseProgram.replace(/"(?:\\.|[^"\\])*"/g, '')
      .replace(/[.$][A-Za-z_][A-Za-z_0-9]*/g, '').replace(/\b[A-Za-z_][A-Za-z_0-9]*\s*:/g, '');
    const identifiers = code.match(/\b[A-Za-z_][A-Za-z_0-9]*\b/g) ?? [];
    expect(identifiers.filter(id => !allow.has(id))).toEqual([]);
    // tests/skill-protocols-review-and-prep.test.ts checks that the producer writes them.
    for (const marker of PAUSE_MARKERS) expect(pauseProgram).toContain(marker);
  }, TIMEOUT_23D);

  const cases: Array<{ name: string; cls: string; reason?: string; rc?: number; error?: string; raw?: string; json?: Record<string, unknown>; noRemote?: boolean; noGh?: boolean; detached?: boolean }> = [
    { name: 'no remote', cls: 'no-github', noRemote: true },
    { name: 'remote without gh', cls: 'lookup-failure', reason: 'gh-missing', noGh: true },
    { name: 'detached HEAD', cls: 'lookup-failure', reason: 'detached', detached: true },
    ...['none of the git remotes configured for this repository point to a known GitHub host. Use gh auth login', 'None of the Git Remotes Configured for this repository point to a known GitHub host. Use gh auth login', 'no git remotes found'].map((error, n) => ({ name: `non-GitHub message ${n}`, cls: 'no-github', rc: 1, error })),
    { name: 'no PR', cls: 'no-pr', rc: 1, error: 'no pull requests found for branch "feature/session"' },
    { name: 'exit 4', cls: 'lookup-failure', reason: 'auth', rc: 4, error: 'not logged in' },
    { name: 'bad token', cls: 'lookup-failure', reason: 'auth', rc: 1, error: 'Try gh auth login' },
    { name: 'API error', cls: 'lookup-failure', reason: 'api', rc: 1, error: 'network unavailable' },
    { name: 'empty success', cls: 'lookup-failure', reason: 'unreadable', raw: '' },
    { name: 'missing field', cls: 'lookup-failure', reason: 'unreadable', raw: prLines().replace('COMMENT_PAUSED=false\n', '') },
    ...[
      prLines().replace('PR_STATE=OPEN', 'PR_STATE=unknown'),
      prLines().replace('PR_DRAFT=false', 'PR_DRAFT=null'),
      prLines().replace(PR_URL, 'null'),
      prLines().replace('BODY_PAUSED=false', 'BODY_PAUSED=maybe'),
      prLines().replace('COMMENT_PAUSED=false', 'COMMENT_PAUSED=1'),
      prLines().replace('PAUSE_SHA=', 'PAUSE_SHA=xyz'),
      prLines() + '\n',
      prLines() + 'EXTRA=private body text\n',
    ].map((raw, n) => ({ name: `invalid success ${n}`, cls: 'lookup-failure', reason: 'unreadable', raw })),
    { name: 'open paused', cls: 'paused', json: prJson({ isDraft: true, comments: [pauseComment()] }) },
    { name: 'closed paused', cls: 'closed-paused', json: prJson({ state: 'CLOSED', comments: [pauseComment()] }) },
    { name: 'merged body paused', cls: 'closed-paused', json: prJson({ state: 'MERGED', body: '## Review and prep\n**PAUSED — manual testing required**' }) },
    { name: 'merged cleared', cls: 'no-pause', json: prJson({ state: 'MERGED', comments: [pauseComment(), receiptComment()] }) },
    { name: 'open no pause', cls: 'no-pause', json: prJson() },
  ];
  for (const shell of agentShells()) for (const c of cases) {
    // Only JSON cases reach the shim's jq; the rest still run without jq.
    test.skipIf((c.json !== undefined && !jqBin) || (c.noGh === true && existsSync('/usr/bin/gh')))(`${shell.shell}: ${c.name}`, () => {
      const fx = pairFixture(`check-${shell.shell}-${c.name.replace(/[^a-z0-9]/gi, '-')}`);
      if (!c.noRemote) pairGit(fx.cwd, fx.home, ['remote', 'add', 'origin', 'https://github.com/example/project.git']);
      if (c.detached) pairGit(fx.cwd, fx.home, ['checkout', '--quiet', '--detach']);
      const calls = join(fx.home, 'gh-called');
      const data = join(fx.home, 'pr.json');
      const err = join(fx.home, 'gh-stderr');
      const raw = join(fx.home, 'gh-stdout');
      writeFileSync(data, JSON.stringify(c.json ?? prJson()));
      writeFileSync(err, c.error ? `${c.error}\n` : '');
      writeFileSync(raw, c.raw ?? '');
      if (!c.noGh) writeFileSync(join(fx.shim, 'gh'), `#!/bin/sh
printf 'called\\n' > "$PR_CALLS"
cat "$PR_ERROR" >&2
[ "$PR_RC" -eq 0 ] || exit "$PR_RC"
if [ "$PR_RAW" = 1 ]; then cat "$PR_OUTPUT"; exit 0; fi
while [ "$#" -gt 0 ]; do
  if [ "$1" = --jq ]; then shift; exec "$PR_JQ" -r "$1" "$PR_JSON"; fi
  shift
done
exit 2
`, { mode: 0o755 });
      const result = pairRun(fx, pausedFence, shell, {
        PR_CALLS: calls, PR_ERROR: err, PR_RC: String(c.rc ?? 0), PR_RAW: String(c.raw === undefined ? 0 : 1),
        PR_OUTPUT: raw, PR_JSON: data, PR_JQ: jqBin ?? '/nonexistent/jq',
      });
      expect(result.status).toBe(0);
      const tokens = (result.stdout ?? '').trimEnd().split('\n');
      expect(tokens.slice(c.reason ? -2 : -1)).toEqual([`PR_CLASS=${c.cls}`, ...(c.reason ? [`PR_REASON=${c.reason}`] : [])]);
      expect(result.stderr ?? '').toBe(c.error ? `${c.error}\n` : '');
      const called = !c.noRemote && !c.noGh && !c.detached;
      expect(existsSync(calls)).toBe(called);
      if (called) expect(tokens[0]).toBe(`PR_VIEW_RC=${c.rc ?? 0}`);
      if (c.raw !== undefined || c.rc) expect(result.stdout).not.toContain('PR_STATE=');
      // /usr/bin/git may initialize macOS's xcrun cache in this isolated TMPDIR.
      expect(readdirSync(fx.temp).filter(name => name !== 'xcrun_db')).toEqual([]);
    }, TIMEOUT_23D);
  }
});

describe('Track 23D jq projection', () => {
  const cases: Array<{ name: string; json: Record<string, unknown>; expected: string }> = [
    { name: 'pause then receipt, ready', json: prJson({ comments: [pauseComment(), receiptComment()] }), expected: prLines('OPEN', false, false, false, PAUSE_SHA) },
    { name: 'pause then receipt, still draft', json: prJson({ isDraft: true, comments: [pauseComment(), receiptComment()] }), expected: prLines('OPEN', true, false, true, PAUSE_SHA) },
    { name: 'receipt then pause', json: prJson({ comments: [receiptComment(true, '2026-10-09T09:00:00Z'), pauseComment()] }), expected: prLines('OPEN', false, false, true, PAUSE_SHA) },
    { name: 'other viewer receipt', json: prJson({ comments: [pauseComment(), receiptComment(false)] }), expected: prLines('OPEN', false, false, true, PAUSE_SHA) },
    { name: 'both markers', json: prJson({ comments: [pauseComment(`<!-- review-and-prep:receipt:ready -->\n<!-- review-and-prep:paused:${PAUSE_SHA} -->`)] }), expected: prLines('OPEN', false, false, true, PAUSE_SHA) },
    ...[
      `<!-- review-and-prep:paused:${PAUSE_SHA} -->\nprivate comment`,
      `private comment\n<!-- review-and-prep:paused:${PAUSE_SHA} -->\nend`,
      `a—b <!-- review-and-prep:paused:${PAUSE_SHA}-->`,
      `<!-- review-and-prep:paused:${PAUSE_SHA}\n-->`,
    ].map((body, n) => ({ name: `marker position ${n}`, json: prJson({ comments: [pauseComment(body)] }), expected: prLines('OPEN', false, false, true, PAUSE_SHA) })),
    ...['g'.repeat(40), 'abc123', PAUSE_SHA.toUpperCase()].map(sha => ({ name: `invalid SHA ${sha}`, json: prJson({ comments: [pauseComment(`<!-- review-and-prep:paused:${sha} -->`)] }), expected: prLines('OPEN', false, false, true) })),
    ...['**PAUSED — manual testing required.**', '**PAUSED — manual testing required**', '**Status: PAUSED — manual testing required.**', '**PAUSED – manual testing required.**'].map((line, n) => ({ name: `body shape ${n}`, json: prJson({ body: `## Review and prep\n${line}\n## Next\nprivate body` }), expected: prLines('OPEN', false, true) })),
    { name: 'CRLF body', json: prJson({ body: '## Review and prep\r\n**Status: PAUSED — manual testing required**\r\n## Next\r\n' }), expected: prLines('OPEN', false, true) },
    ...['## Review and prep\n**Status: prepared.**', '## Review and prep\nready\n## Other\nPAUSED — manual testing required', '## Review and prep\n**Status:** unrelated', '## Other\nPAUSED — manual testing required'].map((body, n) => ({ name: `no body pause ${n}`, json: prJson({ body }), expected: prLines() })),
    { name: 'other viewer pause only', json: prJson({ comments: [pauseComment(undefined, false)] }), expected: prLines() },
    // Value: protects=an ordinary draft PR with no viewer pause marker is not paused, so /ship routing stays;
    // fails_when=the `$pause != null` guard on the draft rule is dropped or inverted;
    // why_new=every existing draft row carries a viewer pause marker; seam=none
    { name: 'draft without pause marker', json: prJson({ isDraft: true }), expected: prLines('OPEN', true) },
  ];
  for (const c of cases) test.skipIf(!jqBin)(c.name, () => {
    const fx = initFixture(`23d-jq-${c.name.replace(/[^a-z0-9]/gi, '-')}`);
    const result = spawnSync(jqBin!, ['-r', pauseProgram], { input: JSON.stringify(c.json), encoding: 'utf8', timeout: 15_000, cwd: fx.cwd, env: scopedEnv(fx.home, { GSTACK_STATE_ROOT: fx.state }) });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(c.expected);
    expect(result.stdout).not.toMatch(/private (body|comment)|<!--/);
  }, TIMEOUT_23D);
});

// Value: protects=old sessions and other branches survive every fresh-start path;
// fails_when=the archive block loses resolution, collision checks, error stops or nesting postcondition;
// why_new=the old archive fence could not run in a fresh shell; seam=PATH date/mv shims.
describe('Track 23D Archive block', () => {
  const cases = ['success', 'missing', 'empty', 'collision', 'symlink', 'dangling symlink', 'read-only archives', 'uncreatable parent', 'unreadable session', 'no root', 'empty session path', 'detached', 'mid-move destination', 'ls function', 'cross-volume move', 'inode unavailable'] as const;
  // Agent shells may alias or wrap ls (eza-style: no inode outside long view).
  const nameOnlyLs = 'ls() { for a; do case $a in -*) ;; *) printf "%s\\n" "$a" ;; esac; done; }';
  const moved = ['success', 'ls function', 'cross-volume move'];
  for (const shell of agentShells()) for (const name of cases) {
    test.skipIf(runningAsRoot && ['read-only archives', 'uncreatable parent', 'unreadable session'].includes(name))(`${shell.shell}: ${name}`, () => {
      const fx = pairFixture(`archive-${shell.shell}-${name.replaceAll(' ', '-')}`);
      const other = join(fx.project, 'branches', 'other', 'report.md');
      mkdirSync(join(fx.project, 'branches', 'other'), { recursive: true });
      writeFileSync(other, 'other branch\n');
      writeFileSync(join(fx.project, 'deploy.md'), 'deploy recipe\n');
      if (name !== 'missing') mkdirSync(fx.session, { recursive: true });
      if (!['missing', 'empty'].includes(name)) {
        mkdirSync(join(fx.session, 'groups'), { recursive: true });
        writeFileSync(join(fx.session, 'session.yaml'), 'branch: feature/session\n');
        writeFileSync(join(fx.session, 'groups', 'auth.md'), 'test results\n');
      }
      if (name === 'collision') {
        mkdirSync(fx.archive, { recursive: true });
        writeFileSync(join(fx.archive, 'kept'), 'destination\n');
      }
      if (name.includes('symlink')) {
        mkdirSync(join(fx.project, 'archives'), { recursive: true });
        symlinkSync(name === 'symlink' ? fx.session : join(fx.project, 'absent'), fx.archive);
      }
      if (name === 'detached') pairGit(fx.cwd, fx.home, ['checkout', '--quiet', '--detach']);
      if (name === 'empty session path') writeFileSync(join(fx.checkout, 'bin', 'lib', 'session-paths.sh'), 'session_dir() { :; }\n');
      if (name === 'mid-move destination') writeFileSync(join(fx.shim, 'mv'), '#!/bin/sh\nmkdir -p "$2"\nexec /bin/mv "$@"\n', { mode: 0o755 });
      // A move across volumes copies, so the archive gets a new inode.
      if (name === 'cross-volume move') writeFileSync(join(fx.shim, 'mv'), `#!/bin/sh\n/bin/cp -R "$1" "$2" && /bin/mv "$1" '${join(fx.home, 'moved-aside')}'\n`, { mode: 0o755 });
      if (name === 'inode unavailable') writeFileSync(join(fx.shim, 'ls'), '#!/bin/sh\n[ "$1" = -di ] && exit 1\nexec /bin/ls "$@"\n', { mode: 0o755 });
      const before = treeBytes(fx.project);
      const sessionBefore = treeBytes(fx.session);
      const restricted = name === 'read-only archives' ? join(fx.project, 'archives') : name === 'uncreatable parent' ? fx.project : name === 'unreadable session' ? fx.session : '';
      if (restricted) { mkdirSync(restricted, { recursive: true }); chmodSync(restricted, name === 'unreadable session' ? 0o300 : 0o555); }
      let result: ReturnType<typeof pairRun>;
      try { result = pairRun(fx, name === 'ls function' ? `${nameOnlyLs}\n${pairArchive}` : pairArchive, shell, {}, name !== 'no root'); }
      finally { if (restricted) chmodSync(restricted, 0o755); }
      const errors: Record<string, string> = {
        collision: `ERROR: ${fx.archive} already exists; run /pair-review again in a few seconds. The old session is unchanged.`,
        symlink: `ERROR: ${fx.archive} is a symlink; inspect or remove it. The old session is unchanged.`,
        'dangling symlink': `ERROR: ${fx.archive} is a symlink; inspect or remove it. The old session is unchanged.`,
        'read-only archives': `ERROR: could not move ${fx.session} to ${fx.archive}; check permissions on its parent directory. The old session is unchanged.`,
        'uncreatable parent': `ERROR: could not create ${join(fx.project, 'archives')}; check permissions on ${fx.project}. The old session is unchanged.`,
        'unreadable session': `ERROR: cannot list ${fx.session}; check its permissions. Nothing was moved.`,
        'no root': 'ERROR: no verified gstack-extend root. Re-run this skill\'s preamble, or run setup --host auto from your gstack-extend checkout',
        'empty session path': 'ERROR: could not resolve the /pair-review session directory. Re-run setup --host auto from your gstack-extend checkout. Nothing was moved.',
        detached: "ERROR: this checkout is on a detached HEAD, so the session branch is unknown. Check out the session's branch, then run /pair-review again. Nothing was moved.",
        'mid-move destination': `ERROR: ${fx.archive} appeared during the move; the old session is now at ${join(fx.archive, 'feature--session')}.`,
        'inode unavailable': `ERROR: cannot list ${fx.session}; check its permissions. Nothing was moved.`,
      };
      expect(result!.status).toBe(errors[name] ? 1 : 0);
      if (errors[name]) {
        expect(result!.stderr).toContain(`${errors[name]}\n`);
        expect(result!.stdout).toBe('');
      } else expect(result!.stderr).toBe('');
      if (moved.includes(name)) {
        expect(result!.stdout).toBe(`ARCHIVED=${fx.archive}\n`);
        expect(treeBytes(fx.archive)).toEqual(sessionBefore);
        expect(existsSync(fx.session)).toBe(false);
      } else if (name === 'mid-move destination') {
        expect(treeBytes(join(fx.archive, 'feature--session'))).toEqual(sessionBefore);
      } else {
        expect(treeBytes(fx.session)).toEqual(sessionBefore);
        if (['detached', 'collision', 'symlink', 'dangling symlink', 'missing', 'empty', 'no root', 'empty session path', 'inode unavailable'].includes(name)) expect(treeBytes(fx.project)).toEqual(before);
      }
      expect(readFileSync(other, 'utf8')).toBe('other branch\n');
      expect(readFileSync(join(fx.project, 'deploy.md'), 'utf8')).toBe('deploy recipe\n');
    }, TIMEOUT_23D);
  }
  // A branch whose slug matches a session entry (groups/) must not look nested.
  for (const shell of agentShells()) {
    test(`${shell.shell}: branch named like a session entry`, () => {
      const fx = pairFixture(`archive-${shell.shell}-groups-branch`);
      pairGit(fx.cwd, fx.home, ['checkout', '--quiet', '-b', 'groups']);
      const session = join(fx.project, 'branches', 'groups');
      const archive = join(fx.project, 'archives', `groups-${STAMP}`);
      mkdirSync(join(session, 'groups'), { recursive: true });
      writeFileSync(join(session, 'session.yaml'), 'branch: groups\n');
      writeFileSync(join(session, 'groups', 'auth.md'), 'test results\n');
      const sessionBefore = treeBytes(session);
      const result = pairRun(fx, pairArchive, shell);
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toBe(`ARCHIVED=${archive}\n`);
      expect(treeBytes(archive)).toEqual(sessionBefore);
      expect(existsSync(session)).toBe(false);
    }, TIMEOUT_23D);
  }
});

const ORDINARY_PAIR_ROUTING = [
  "Before presenting options, determine the recommended next step:",
  "",
  "1. Run `gstack-review-read` and check its output.",
  "2. If the output is **not** \"NO_REVIEWS\", a review exists for this branch — recommend `/ship`.",
  "3. If the output **is** \"NO_REVIEWS\", check the diff size: run `git diff --stat main...HEAD` and count changed lines (insertions + deletions).",
  "   - **≤ 30 lines changed** (trivial): recommend `/ship` — the changes are minor enough to skip review.",
  "   - **> 30 lines changed**: recommend `/review` first.",
  "",
  "Present via AskUserQuestion:",
  "",
  "**If recommending `/review`:**",
  "- Question: \"**Test session complete.** [N] items tested, [M] fixes applied, [K] bugs parked.\\n\\n[One-line summary of parked bug outcomes if any]\\n\\nYou haven't run `/review` on this branch yet and there are meaningful code changes — worth a quick review before shipping.\"",
  "- Options: [\"Continue to /review\", \"Skip review, continue to /ship\", \"Commit the report to the repo\", \"Done for now\"]",
  "",
  "**If recommending `/ship`:**",
  "- Question: \"**Test session complete.** [N] items tested, [M] fixes applied, [K] bugs parked.\\n\\n[One-line summary of parked bug outcomes if any]\"",
  "- Options: [\"Continue to /ship\", \"Commit the report to the repo\", \"Done for now\"]",
].join('\n');

describe('Track 23D routing, archive callers and tag clauses', () => {
  test('ordinary no-github/no-pr/no-pause routing is byte-preserved', () => {
    expect(pairNext.slice(pairNext.indexOf('Before presenting options')).split('\n---\n')[0]!.trimEnd()).toBe(ORDINARY_PAIR_ROUTING);
    expect(flatProse(pairNext)).toContain('**`no-github`, `no-pr`, `no-pause`:** use the ordinary routing below unchanged.'.replaceAll('**', ''));
  }, TIMEOUT_23D);

  test('paused handoff carries identity, build, counts, omissions and cross-machine evidence', () => {
    const handoff = /  ```text\n([\s\S]*?)  ```/.exec(pairNext)![1]!.split('\n').filter(Boolean).map(l => l.trimStart());
    expect(handoff).toEqual([
      'Run /review-and-prep resume for PR <URL> on <owner/repo>, branch <branch>.',
      'Paused at: <PAUSE_SHA>',
      'Keep the PR draft.',
      'Session started at build <build_commit>; current HEAD <full git rev-parse HEAD>.',
      'Results: <N> items, <P> passed (<C> by coverage), <F> fixed, <S> skipped, <K> parked bugs.',
      'Not passed: <titles of FAILED-unfixed and SKIPPED items and PARKED/DEFERRED bugs, or none>.',
      'Local report (this machine only): <SESSION_DIR>/report.md. On another machine, paste its contents into the resumed session.',
      'Do not run /ship on this PR.',
    ]);
    expect(flatProse(pairNext)).toContain('Omit `Paused at:` when `PAUSE_SHA` is empty; include `Keep the PR draft.` only when `PR_DRAFT=true`.');
    expect(handoff.filter(l => !l.startsWith('Paused at:') && l !== 'Keep the PR draft.')).toHaveLength(6);
    expect(flatProse(pairNext)).toContain('Continue to /review-and-prep resume runs it in this session; the fenced handoff is for a fresh session.');
    expect(flatProse(pairNext)).toContain('Track 24B owns the future canonical hold/resume detector and may replace this check.');
  }, TIMEOUT_23D);

  test('all hold routes keep their exact questions, reason fixes and permitted labels', () => {
    const routes = pairNext.split(/\n- \*\*`/).slice(1, 4);
    const expectedOptions = [
      ['Continue to /review-and-prep resume', 'Commit the report to the repo', 'Done for now'],
      ['Commit the report to the repo', 'Done for now'],
      ['Retry the check', 'Continue to /review-and-prep resume', 'Commit the report to the repo', 'Done for now'],
    ];
    for (let i = 0; i < routes.length; i++) {
      const optionRow = routes[i]!.split('\n').find(l => l.trimStart().startsWith('- Options:'))!;
      const labels = [...optionRow.matchAll(/"([^"]+)"/g)].map(m => m[1]!);
      expect(labels).toEqual(expectedOptions[i]!);
      expect(labels).not.toContain('Continue to /ship');
      expect(labels).not.toContain('Continue to /review');
    }
    expect(routes).toHaveLength(3);
    expect(routes[0]).toContain('"Continue to /review-and-prep resume" (recommended)');
    expect(routes[1]).toContain('"Done for now" (recommended)');
    expect(routes[1]).toContain('PR <URL> is <state> while its /review-and-prep preparation was paused. Do not run /ship; a replacement PR needs a new /review-and-prep decision.');
    expect(routes[2]).toContain("Could not check this branch's PR for a paused /review-and-prep (<reason>). <fix>. The test report is saved at <SESSION_DIR>/report.md. If /review-and-prep sent you here, return to it and do not run /ship until this check passes.");
    for (const row of [
      '| `gh-missing` | install the GitHub CLI and run `gh auth login` | Done for now |',
      '| `auth` | run `gh auth status`, then `gh auth login` | Done for now |',
      "| `detached` | check out the PR's branch | Done for now |",
      '| `api` | retry | Retry the check |',
      '| `unreadable` | retry, and report `PR_VIEW_RC` | Retry the check |',
    ]) expect(routes[2]).toContain(row);
    expect(flatProse(routes[2]!)).toContain('"Retry the check" reruns the fence.');
  }, TIMEOUT_23D);

  test('every fresh-start caller uses the guarded Archive block and relays its receipt', () => {
    const clauses: Clause[] = [
      { id: 'stop', heading: '## Active Session Guard', text: 'On any non-zero exit or `ERROR:` line from the Archive block, stop and relay the output. Never write session state over an unarchived session.' },
      { id: 'receipt', heading: '## Active Session Guard', text: 'Whenever the block prints `ARCHIVED=<path>`, tell the user "Archived the previous test session to <path>." and name that path in the next question\'s action receipt.' },
      { id: 'archive-results', heading: '## Active Session Guard', text: '`/review-and-prep resume` reads only the current session, so give it this archive path if those results are still needed.' },
      { id: 'leftovers', heading: '## Active Session Guard', text: 'When `<SESSION_DIR>` has files but no `session.yaml`, run the **Archive block** before Phase 0, with no question.' },
      { id: 'start-new', heading: '## Active Session Guard', text: 'If the user chooses "Start a new session (archives the old one)", run the **Archive block** before Phase 0.' },
      { id: 'resume-fresh', heading: '## Phase 3: Resume', text: 'If "Start fresh", run the **Archive block** under the Active Session Guard\'s stop-and-relay and `ARCHIVED=` receipt rules before Init.' },
      { id: 'corrupt-fresh', heading: '### State file corrupt', text: 'On "Start fresh", run the **Archive block** under the Active Session Guard\'s stop-and-relay and `ARCHIVED=` receipt rules before Init.' },
    ];
    expect(missingClauses(pairSkill, clauses)).toEqual([]);
    expect(pairGuard).toContain('**Archive block**');
    expect(guardOrdered(pairArchive)).toBe(true);
    expect(extractFences(pairSkill).find(f => f.body.includes('session_dir pair-review "$BRANCH"'))!.body).not.toContain('session_archive_dir');
  }, TIMEOUT_23D);

  const tagRule = '`[`, `]`, `,`, `;`, `|`, a backtick or `$(`';
  for (const heading of ['### Group completion triage', '## Phase 2.5: Post-Testing Fix Queue']) {
    test(`tag values are safe and self-contained: ${heading}`, () => {
      const section = skillSection(pairSkill, heading);
      expect(section).toContain(tagRule);
      expect(flatProse(section)).toContain("Take `group=` and `item=` values from the bug's own parked-bugs.md `Noticed during:` field.");
      expect(flatProse(section)).toContain('Tags carry no `files=` key; file paths stay in the entry body.');
      expect(flatProse(section)).toContain('with no `item=` key.');
      expect(flatProse(section)).toContain('keep the group name in Noticed during:');
      const forms = ['[pair-review:group=<group-slug>,item=<item-index>]', '[pair-review:group=pre-test]', '[pair-review:item=<item-index>]'];
      for (const form of forms) {
        expect(section).toContain(`### ${form} <Bug title>`);
        expect(validateTagExpression(form.replace('<group-slug>', 'auth').replace('<item-index>', '2')).ok).toBe(true);
      }
    }, TIMEOUT_23D);
  }
  test('contract references and both false routing claims are removed', () => {
    expect(pairSkill).not.toContain('docs/source-tag-contract.md');
    expect(flatProse(pairSkill)).not.toContain('lets /roadmap route the bug back to the Group');
    expect(flatProse(pairSkill)).not.toContain('route to PRIMARY in-flight');
    expect(flatProse(pairSkill)).toContain('`group=` names the test group that surfaced the bug; `pre-test` records that it was parked before testing.');
  }, TIMEOUT_23D);
});
