# Group 4 re-plan — eliminating the parallel-session workarounds

Status: design (2026-05-03). Author: kb. Supersedes nothing in `docs/ROADMAP.md`
yet — proposes targeted edits to Group 4 once approved.

## Why

Four `/plan-eng-review` sessions ran in parallel (one per Track 4A–4D). Each
session conducted its review in isolation, so when a decision touched another
Track's territory, the response was always one of:

1. **Defer to a hypothetical sibling Track** that turned out not to exist.
2. **Reduce scope** because a peer Track's interface "hadn't been decided yet."
3. **Propose a new Track** that collides on naming with a Track already in flight.
4. **Flag a parallel-safety violation** that doesn't exist when you look at the
   actual file footprints.

The result: a coherent Group split into four good plans with a layer of
defensive workarounds bolted on. None of the workarounds reflect real
constraints — they reflect the parallel-review topology.

This doc audits the four plans, identifies which workarounds are
phantom / premature / mis-named, and re-divides Group 4 with the workarounds
removed. The goal is a re-plan that ships more, sooner, without losing any of
the actual decisions the reviews locked in.

## Inventory of the four plans

### 4A: Touchfiles diff selection (workspace: bogota)

- **Original ROADMAP:** M, ~150 LOC. Manual touchfiles map + bun test selection.
- **Final plan:** L, ~630 LOC. Codex flipped the approach to a hybrid (static
  TS import graph + small manual map for non-TS deps). 4-fallback safety
  (empty diff / no base / global hit / non-empty-but-zero-selected). Argv
  passthrough + signal forwarding. Task 0 timing audit as kill-cheap.
- **Cross-Track effects:**
  - Pre-task: harden `tests/helpers/fixture-repo.ts` `makeEmptyRepo` with
    spawn exit-code checks (codex C3).
  - Deferred TODO: TEST_TIERS for paid evals after Track 4C lands.
  - Edits `package.json scripts.test` and `CLAUDE.md ## Testing`.

### 4B: Eval persistence + budget regression (workspace: dalat-v1)

- **Original ROADMAP:** M, ~300 LOC. Port `eval-store.ts` + activate
  `skill-budget-regression.test.ts`.
- **Final plan:** S, ~160 LOC. **Scope reduced twice** — first to
  regression-only slice, then to types + `getProjectEvalDir` + a
  `test.skip` stub. The reader/comparator/regression body all deferred to a
  proposed "**Track 4D**" (collides on name with the existing Track 4D
  audit-compliance).
- **Stated reason for reduction:** "reader should align with whatever schema
  4C settles on" + codex's "scaffolding pretending to be a gate."
- **Cross-Track effects:**
  - Proposes new "Track 4D" (reader) — name collision.
  - Proposes new "Track 4E" (gbrain-sync allowlist for evals dir).
  - Proposes new TODO for retention policy.
  - Flags 4B/4C as **NOT parallel-safe** because both "edit `eval-store.ts`."

### 4C: LLM-as-judge for skill prose (workspace: valletta)

- **Original ROADMAP:** M, ~250 LOC.
- **Final plan:** M, ~370 LOC. `tests/helpers/llm-judge.ts` + unit tests +
  `tests/skill-llm-eval.test.ts` + 4 captured-prose fixtures (3 positive +
  1 negative control). Sequential `test.each`, EVALS=1 self-gated, tool-use
  migration deferred as a TODO.
- **Cross-Track effects:**
  - Edits `package.json` (devDependencies) and `CLAUDE.md ## Testing` —
    collides additively with 4A's edits to the same files.
  - Deferred TODO: migrate to Anthropic tool-use forced JSON on second
    consumer or first regex-related bug.
  - Deferred TODO: raise judge floor 3 → 4 after 5–10 EVALS runs.
  - **Does not** edit `tests/helpers/eval-store.ts`.

### 4D: Audit-compliance test (workspace: richmond)

- **Original ROADMAP:** M, ~150 LOC.
- **Final plan:** M, ~150 LOC. Original scope held after a brief reframe-then-
  un-reframe. Three describes: frontmatter sanity, setup ↔ skills/*.md
  symmetric, source-tag registry consistency. Adds `discovered` to grammar
  list in `docs/source-tag-contract.md`. Retags one `[design]` TODO entry.
- **Cross-Track effects:**
  - Adds `REGISTERED_SOURCES` export to `src/audit/lib/source-tag.ts`
    (one-line change; does not collide with anything else).
  - Two deferred TODOs (audit fail-taxonomy calibration; SKILLS list
    dedup helper).

## Diagnosing the workarounds

### 1. The phantom 4B/4C `eval-store.ts` collision

4B's plan claims 4B and 4C **both edit `tests/helpers/eval-store.ts`** and
flags them NOT parallel-safe. 4C's plan does not edit `eval-store.ts` — its
file list is `llm-judge.ts`, `llm-judge.test.ts`, `skill-llm-eval.test.ts`,
`skill-prose-corpus/`, `package.json`, `CLAUDE.md`, `docs/PROGRESS.md`. The
collision is a hypothesis 4B's review made about a 4C integration that 4C's
review never built.

**Action:** drop the parallel-safety warning. 4B and 4C are file-disjoint.

### 2. The "Track 4D for the reader" name collision

4B's reduction proposes a follow-on "Track 4D" containing the deferred
reader/comparator. There is already a Track 4D (audit-compliance), in flight
in the richmond workspace, with a complete plan. Two Tracks cannot share
the same name in the same Group.

**Action:** the deferred reader work is not a Track 4-anything. It belongs in
`Future` (Phase 1.x+) until a producer of eval data exists in the codebase.

### 3. The reader-needs-a-producer trap

4B's narrow scope (types + dir resolver + skipped test) is "scaffolding
pretending to be a gate" because **no other Track in Group 4 produces eval
data**. 4C scores skill prose quality, but its plan does not write results to
`~/.gstack/projects/<slug>/evals/`. So even if we restored 4B to its
original full scope (reader + comparator + active regression gate), the gate
would have nothing to regress against.

The eng-review correctly caught that the reader is premature. The wrong
conclusion was "defer the reader to a follow-on Track 4D right after this
Group" — the right conclusion is "the reader unblocks the day a producer
exists, which is not today." Promote the reader to `Future`.

**Action:** keep 4B narrow as the eng-review specced. Do not chase a sibling
Track 4D for the reader. Move the reader to `Future` with explicit dependency
on a producer Track that does not yet exist.

### 4. The TEST_TIERS deferral

4A's plan defers `TEST_TIERS` (gate vs paid) to a future Track that lands
"after 4C introduces the first paid test." But 4C's plan **already
self-gates** via `process.env.EVALS === '1'`. The wrapper from 4A doesn't
need to know about tiers — `bun run test` (default mode) sees the EVALS test,
sees its `if (process.env.EVALS !== '1') return`, and skips it cheaply. The
TEST_TIERS layer would be a second line of defense that adds no value v1.

**Action:** drop the TEST_TIERS TODO. If a future paid test is too expensive
to even *enter*, revisit then.

### 5. The makeEmptyRepo pre-task

4A flags a pre-task to harden `tests/helpers/fixture-repo.ts`
`makeEmptyRepo` with spawn-exit-code checks. The change is ~15 lines, only
4A consumes it (for E2E scenarios), and no other Track touches
`fixture-repo.ts`.

**Action:** inline the hardening into Track 4A's first task. No pre-flight
needed.

### 6. The package.json + CLAUDE.md additive collisions

4A and 4C both edit `package.json` (4A: `scripts.test` rewrite; 4C: add
`@anthropic-ai/sdk` to `devDependencies`) and `CLAUDE.md ## Testing` (both
add a paragraph). These are additive, distinct sections. A trivial merge
conflict at PR-land time. Group 4's "parallel within" rule has always
absorbed this kind of conflict.

**Action:** acknowledge and accept. Whichever PR lands second resolves a
4-line conflict in 30 seconds.

### 7. The deferred follow-ons (4E, retention, fail-taxonomy, SKILLS dedup)

4B proposes a Track 4E (gbrain-sync allowlist) and a retention-policy TODO.
4D proposes audit fail-taxonomy calibration and SKILLS-list dedup. None of
these are Group-4 scope. None block Group 4 from shipping. They are normal
post-Group TODOs.

**Action:** drop them from the Group 4 conversation entirely. /roadmap will
triage them into the right place at the right time.

## Re-divided plan

### Group 4 Pre-flight (1 item, no code)

- **[Pre-flight 4A-audit]** Timing + dependency audit for Track 4A.
  Run the (paper-design) selection against 3 recent merged PRs; for each,
  compute `selected_files / total_files` and estimate saved wall-clock as
  `(1 - selected_ratio) × 117s − 5s wrapper overhead` (current suite
  measured at 117s as of 2026-05-03). Median across the 3 PRs is the
  metric. ~30 min, no code.
  - **Greenlight:** median ≥40% saved (≥45s on the 117s baseline). Pays
    back the half-day CC in ~1–2 months at typical /ship cadence; sub-
    minute waits feel meaningfully different from 2-minute waits.
  - **Judgment call:** median 25–40%. Lean kill unless one PR was
    atypically broad (e.g., touched a top-level config), in which case
    re-run with a different PR sample.
  - **Kill:** median <25%. Wide change patterns mean import-graph
    fan-out isn't narrowing anything; selection's complexity doesn't
    match its benefit. Half-day stays in the bank.

### Group 4 Tracks (3 parallel, file-disjoint)

| Track | Scope | Effort | Files |
|---|---|---|---|
| **4A** Touchfiles diff selection | unchanged from eng-review (hybrid import graph + 4 fallbacks + argv passthrough + signal forwarding + makeEmptyRepo hardening inlined + invariants test). **TEST_TIERS deferral dropped.** | L (~630 LOC, ~half-day CC). **Gated on Pre-flight `4A-audit` greenlight.** | `tests/helpers/touchfiles.ts`, `tests/helpers/fixture-repo.ts` (hardening), `scripts/select-tests.ts`, `tests/touchfiles.test.ts`, `package.json`, `CLAUDE.md`, `README.md` |
| **4C** LLM-as-judge for skill prose | unchanged from eng-review (callJudge + unit tests + 3+1 fixtures + sequential test.each + EVALS=1 self-gate). | M (~370 LOC, ~3 hr CC) | `tests/helpers/llm-judge.ts`, `tests/helpers/llm-judge.test.ts`, `tests/skill-llm-eval.test.ts`, `tests/fixtures/skill-prose-corpus/`, `package.json`, `CLAUDE.md`, `docs/PROGRESS.md` |
| **4D** Audit-compliance test | unchanged from eng-review (3 describes + grammar fix + TODO retag + `REGISTERED_SOURCES` export). | M (~150 LOC, ~2 hr CC) | `tests/audit-compliance.test.ts`, `docs/source-tag-contract.md`, `docs/TODOS.md`, `src/audit/lib/source-tag.ts` |

**Track 4B dropped from Group 4.** The narrow scope (types + dir resolver +
skipped stub) is infrastructure for a producer that doesn't exist in this
codebase yet. Shipping it as part of Group 4 just buries useful types under
a skipped test that nobody will revisit. Move the whole eval-store concern
to `Future` and ship it on the day a producer Track is identified.

**Real merge conflicts (additive, trivial):**

- `package.json`: 4A rewrites `scripts.test`, 4C adds one line under
  `devDependencies`. Resolution: ~30 sec, second-merger.
- `CLAUDE.md ## Testing`: 4A adds touchfiles paragraph, 4C adds EVALS=1
  paragraph. Resolution: ~30 sec, second-merger.

The audit's COLLISIONS check correctly flagged this overlap as `[PARALLEL]`
(not `SHARED_INFRA`), but it still emits `STATUS: fail` on any non-shared-
infra file overlap. To clear the audit gate without inventing a Pre-flight
just for two trivial conflicts, **Track 4C declares `_Depends on: Track 4A_`**
in ROADMAP.md. This serializes the merge order, not the work — implementers
can still develop in parallel; whichever lands second rebases on the first.
**If Pre-flight `4A-audit` kills Track 4A, drop this dependency line —
the collision goes away when 4A's `_touches:_` set vanishes.**

The original ROADMAP's "parallel-safe within Group" claim holds at the
implementation level; the dep declaration is purely an audit-satisfaction
mechanism for the trivial merge case.

### Future (Phase 1.x+) — promoted out of Group 4

- **Eval persistence + reader + comparator + regression gate (full Track 4B
  scope).** Both halves of the original 4B: types + `getProjectEvalDir` +
  the writer; AND the reader (findPreviousRun, compareEvalResults,
  extractToolSummary, totalToolCount, findBudgetRegressions,
  assertNoBudgetRegression, runBudgetCheck) + activated
  `skill-budget-regression.test.ts`. Lift the locked review decisions
  D3/D6/D7/D8/D9/D10/D11/D14 from the 4B eng-review.
  _Deferred because: no Track in this codebase currently produces eval-store
  data. Shipping types + a skipped test now would just bury infrastructure
  under a permanently-skipped test. The whole port unblocks once a Track
  that captures skill transcripts exists. M effort (~400–500 LOC including
  active tests)._
- **gbrain-sync allowlist for `~/.gstack/projects/*/evals/`.** Add the evals
  dir to gbrain-sync's allowlist (or denylist) in gstack proper.
  _Deferred because: requires an actual transcript producer to land first
  so the privacy surface is observable. Cross-repo (gstack proper, not
  gstack-extend). S effort (~30 min)._
- **Eval dir retention / pruning policy.** Time-based, count-based, or
  scenario-indexed pruning of `~/.gstack/projects/<slug>/evals/`.
  _Deferred because: no write rate exists yet to design against. Pairs with
  the reader Track. S–M effort._
- **Audit fail-taxonomy calibration.** Review `bin/roadmap-audit` STATUS
  emit decisions; downgrade `ARCHIVE_CANDIDATES` to warn; design narrow
  waiver mechanism for `SIZE`. From Track 4D eng-review.
  _Deferred because: it's a separate /plan-eng-review on the audit's
  policy surface, not Group 4 scope. M effort._
- **Deduplicate SKILLS list across `setup` + `tests/skill-protocols.test.ts`.**
  Once Track 4D's `setup`-parser ships, extract to
  `tests/helpers/parse-setup-skills.ts`. From Track 4D eng-review.
  _Deferred because: depends on Track 4D landing first. S effort._
- **Migrate `callJudge` from regex+validator to Anthropic tool-use forced
  JSON.** From Track 4C eng-review. Trigger: 2nd consumer of `callJudge`
  lands, or the regex-extract path produces a real bug.
  _Deferred because: not time-bound; v1 hadn't earned the migration cost. S effort._
- **Raise the Track 4C judge floor from `>=3` to `>=4` once 5–10 EVALS
  runs accumulate.** From Track 4C eng-review.
  _Deferred because: needs data. S effort (~30 min)._

## What changes vs the existing ROADMAP

| Section | Edit |
|---|---|
| Group 4 preamble | Add one sentence: "Group 4 has a Pre-flight timing audit (`4A-audit`) — kill-cheap option for Track 4A. Track 4B was dropped to `Future` per `docs/designs/group-4-replan.md`." Renumber tracks if desired (4A/4C/4D → 4A/4B/4C); the doc keeps the original IDs for traceability with the eng-review session artifacts. |
| Group 4 Track 4A entry | Bump effort marker M → L and LOC ~150 → ~630. Add `_Depends on:_` "Pre-flight `4A-audit` greenlight." Update `_touches:_` to include `tests/helpers/fixture-repo.ts` and `scripts/select-tests.ts`. Drop the TEST_TIERS deferral note (was never written, but the eng-review's TODO would have introduced it). |
| Group 4 Track 4B entry | **Delete entirely.** Move the full original scope (eval persistence + reader + regression gate) to `Future` with the deferral reason (no producer Track exists yet). |
| Group 4 Track 4C entry | Bump LOC ~250 → ~370. No effort-marker change (still M). Add a note: "EVALS=1 self-gates; no TEST_TIERS dependency on Track 4A." |
| Group 4 Track 4D entry | No scope change. Add `_touches:_` line including `src/audit/lib/source-tag.ts` (the `REGISTERED_SOURCES` export). |
| Group 4 task count footer | Update from "4 tracks" to "3 tracks + 1 Pre-flight." |
| Execution Map | Update Group 4's track-detail block to reflect the 3-track shape. |
| Future section | Add the items listed above with their deferral reasons. |
| TODOS.md `[plan-eng-review]` entries from dalat-v1 and valletta | Drop or rewrite. The four Track-4D-rename / Track-4E / retention / ROADMAP-update entries from dalat-v1 are wrong (Track 4D collision) or premature (depend on a producer). The two from valletta (tool-use migration / floor>=4) belong in `Future` per above. |

## Failure modes of this re-plan

| Concern | Mitigation |
|---|---|
| Pre-flight audit greenlights 4A but real-world drift makes the import-graph stale within 6 months. | The eng-review's three invariants (every glob matches ≥1 file, every test reachable, every manual key resolves) catch this in CI. |
| 4B's narrow scope ships and someone forgets the `Future` reader is still un-built. | The skipped test stub carries an inline comment pointing at the `Future` entry. /roadmap's freshness scan eventually surfaces "this skipped test has been skipped for N months — kill or build." |
| 4A and 4C trivially conflict on `package.json` and `CLAUDE.md` and the second-merger ships a sloppy resolution. | The merge is mechanical and visible in the PR diff — reviewer catches anything weird. If this becomes a recurring annoyance, batch the `CLAUDE.md ## Testing` skeleton into a tiny prefix PR before either lands. Not worth doing pre-emptively. |
| Codex changes its mind on 4A's import-graph approach later (e.g., a future Track wants different selection semantics). | The wrapper has argv passthrough — direct `bun test foo.test.ts` always works regardless of selection logic. The selection layer is replaceable without touching test files. |
| The "no producer exists" claim about eval-store is wrong — there IS a producer somewhere I missed. | Verifiable in ~5 min: grep the codebase for any test or script that writes to `~/.gstack/projects/*/evals/`. If a producer exists, restore 4B's full scope; if not, the narrow scope stands. |

## Open questions for the user

1. **Track ID renumbering.** With 4B dropped, the remaining Tracks are
   4A / 4C / 4D. Three options:
   - Keep IDs (4A / 4C / 4D — gap visible) for traceability with the
     existing eng-review session artifacts.
   - Renumber to 4A / 4B / 4C (gap closed) for cosmetic tidiness.
   - Renumber and re-letter the whole Group (skip-tier).
   This doc assumes option 1 (keep IDs).

(The earlier "should we ship a prefix PR for the package.json + CLAUDE.md
overlap?" question is resolved: the audit forced our hand. Track 4C declares
`_Depends on: Track 4A_` in ROADMAP.md, serializing the merge but not the
work. If 4A is killed by Pre-flight, drop the dep.)

## Next steps

If this re-plan is accepted:

1. Edit `docs/ROADMAP.md` per the table above (Pre-flight + 4 Track entries +
   `Future` section additions).
2. Drop or rewrite the `[plan-eng-review]` TODOS.md entries currently sitting
   uncommitted in the dalat-v1 and valletta worktrees (do not merge them
   as-is).
3. Run Pre-flight `4A-audit` in any workspace.
4. Greenlight or kill Track 4A based on the audit number.
5. Implement 4A / 4B / 4C / 4D in any order, in any number of parallel
   workspaces. The eng-review plans for each Track stand as written —
   implementers consume them directly. No re-review needed.
