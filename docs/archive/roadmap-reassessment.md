# `/roadmap` reassessment redesign

**Status:** Reviewed via `/plan-eng-review` — ready to implement
**Author:** kb
**Date:** 2026-04-28
**Supersedes:** `docs/archive/roadmap-revamp-smart-dispatcher.md` (v0.17.0 design — kept the helpers, replaces the skill orchestration on top)

## Problem

The v0.17.0 redesign extracted feature-engineering into helpers (`bin/roadmap-audit --scan-state`, `bin/roadmap-route`, `bin/roadmap-place`, `bin/roadmap-revise`) on the principle "helpers do feature engineering, prose owns judgment." The helpers landed correctly. The skill prose did not — it kept a four-op precedence chain (REVISE → FRESHNESS → CLOSURE → TRIAGE) that runs each op in isolation with narrow scope.

Two failure modes from that frame:

1. **Per-item placement without batch-level structural authority.** TRIAGE's loop drains the inbox one item at a time. `bin/roadmap-place` for no-origin items emits one candidate (`primary Pre-flight`) with `needs_judgment=1`. The prose's only judgment surface is "is this on-topic?" — never "should this set of items reshape the structure?" Dogfood evidence (2026-04-28, bolt session, `git diff a5089a2 5ef5003 -- docs/ROADMAP.md`): 11 inbox items got dumped into Pre-flight as a 6-item serial chain mixing 3 distinct themes. The user had to manually restructure into 3 thematic Tracks.

2. **CLOSURE can mark a Group ✓ Complete while inbox items prove it isn't.** CLOSURE fires on "zero open Tracks" but doesn't consult `## Unprocessed` for items tagged `[pair-review:group=N]` or referencing the Group's files. A Group can be marked done with lingering bugs visible in TODOS.md. Real closure means resolving those first — by extending an existing Track, adding a closing Track, or appending to Hotfix — not by ignoring them.

The deeper issue: **the skill treats the plan as fixed and asks "where do these items go?" The user's intent is the opposite — the plan is the deliverable, and every run should ask "given everything I now know, what should the plan be?"**

## The reframe

`/roadmap` is plan reassessment, not inbox drainage. One activity, not four ops.

Inputs to a reassessment:
- Current `ROADMAP.md` (Groups, Tracks, Pre-flight, Future, Completed markers).
- Current `TODOS.md ## Unprocessed` (new items since last run).
- Audit signals from `bin/roadmap-audit --scan-state` (closure debt, freshness, structural fitness, source tags).
- Recent git log (commits since last `/roadmap` run touching ROADMAP-referenced files).
- User prompt (intents: closure, split, structural, track-ref, minimal-cue).

Activity: **the LLM holds all of this in mind at once and proposes a plan diff.** The diff can include any combination of:
- Add / extend / split / merge / reorder Tracks within a Group.
- Add / split / reorder Groups (subject to stable-ID rules).
- Re-scope a Track (add tasks, mark done, remove shipped tasks).
- Move tasks between Tracks / Pre-flight / Future.
- Place inbox items into existing Tracks, new Tracks, Future, or kill them.
- Mark Tracks / Groups ✓ Complete (in place or collapsed-italic) when their work has shipped.
- Append items to a ✓ Complete Group's `**Hotfix**` subsection (post-ship fixes don't reopen).
- Defer items to `## Future`.

The four ops (REVISE / FRESHNESS / CLOSURE / TRIAGE) become *kinds of changes* the reassessment can propose, not separate code paths.

## Architecture comparison

### Current (v0.17.x)

```
Step 1: --scan-state → JSON signals
Step 2: Compose ops list from precedence table
Step 3: Run ops in fixed order
        ├── REVISE   (intents.split == 1)
        ├── FRESHNESS (staleness_fail OR git_inferred_freshness ≥ 1)
        ├── CLOSURE   (has_zero_open_group == 1 OR intents.closure == 1)
        └── TRIAGE    (unprocessed_count > 0)
              ├── dedup
              ├── route per-item (KEEP/KILL/PROMPT)
              ├── place per-item (rank candidates from helper)
              └── apply
Step 4: PROGRESS / VERSION / commit
```

Each op has narrow scope. None is allowed to say "the plan itself is wrong."

### Proposed

```
Step 1: Gather state
        ├── --scan-state JSON (signals only)
        ├── audit STRUCTURAL_FITNESS / IN_FLIGHT_GROUPS / FRESHNESS / TASK_LIST
        ├── TODOS.md ## Unprocessed (with source-tag pre-classification)
        ├── ROADMAP.md current structure
        └── recent git log (relevant files only; null-safe path handling)
Step 2: Fast-path
        if all conditions met (see Fast-path section):
            print "Plan looks current. No changes."
            exit
Step 3: REASSESS (large input → hierarchical: themes pass → placement pass)
        ├── LLM reads all inputs holistically
        ├── identifies what's off about the current plan
        ├── proposes plan diff
        ├── writes structured proposal artifact to .context/roadmap/proposal-{ts}.md
        └── presents diff via AskUserQuestion (clustered, not per-item)
Step 4: Apply approved edits
        ├── ROADMAP.md edits (direct, with audit-after backstop)
        ├── TODOS.md drains (with orphan check)
        └── bin/roadmap-revise split-track (only retained helper operation)
Step 5: PROGRESS / VERSION / commit
```

The skill prose collapses four sections into one reassessment section. Two helpers are retired.

## Helper changes

| Helper | Status (post-redesign) | Role in new flow |
|---|---|---|
| `bin/roadmap-audit --scan-state` | unchanged | Emits state signals; reassessment consumes them |
| `bin/roadmap-audit` (full run) | unchanged | Emits STRUCTURAL_FITNESS, IN_FLIGHT_GROUPS, ORIGIN_STATS, FRESHNESS, TASK_LIST as structured data the reassessment reads |
| `bin/roadmap-route` | unchanged | Pre-classifies inbox items into KEEP/KILL/PROMPT before reassessment sees them |
| `bin/roadmap-place` | **DELETED** (D2) | Per-item ranking is no longer on the critical path; reassessment owns placement holistically. Tests removed. |
| `bin/roadmap-revise` | **slimmed** (D3) | `split-track` retained (genuinely complex helper logic). `defer-task` removed (one-line direct edit). |
| `bin/lib/source-tag.sh` | unchanged | Source-tag parsing + dedup hashing; reassessment uses `compute_dedup_hash` and `route_source_tag` |

The signal-vs-verdict boundary is preserved. Helpers still emit feature-engineered data; the reassessment is the verdict.

## What the LLM is responsible for

The reassessment's job is to make the kinds of judgment calls that bash thresholds can't:

1. **Read everything before proposing anything.** Don't iterate item-by-item; hold the full picture in working memory.
2. **Identify themes across inbox items using qualitative judgment, not numeric rules.** A new Track makes sense when the work is cohesive enough to ship in one plan+implement session, has a coherent file footprint, and has a bounded estimate. Examples of what this looks like in practice:
   - **10 tiny bugs in the same area** can collectively be one Track (cohesive theme; small individual scope; bounded as a sweep).
   - **1 large-scope task** can be its own Track (large enough to deserve dedicated focus; coherent files; estimate-bounded).
   - **3 unrelated items in different areas** are not one Track even if they all share a source tag (incoherent files; no shared estimate).
   The LLM judges "is this scope cohesive enough?" — not "are there ≥N items?"
3. **Connect inbox items back to active work.** An item tagged `[pair-review:group=2]` whose files overlap Track 2A's `_touches:_` is closure debt for 2A — propose extending the Track, not folding it into Pre-flight or deferring.
4. **Distinguish cosmetic edits from real closure.** Marking a stale Track ✓ Complete (its work shipped) is different from extending an in-flight Track to absorb new bugs. Reassessment handles both, but they're different proposals.
5. **Adversarial-flagged items drive structural decisions, not just exempt batch.** Items from `[full-review:severity=critical|necessary]` or `[investigate]` get prioritized in structural/closure proposals — they're a strong signal that closure debt exists or that an active Track's scope was wrong. Surface them individually in the AskUserQuestion presentation.
6. **Respect stable IDs.** Track 1A is Track 1A forever. Renumbering is forbidden outside explicit canonical resets. New work gets new IDs (`Track 2C`, `Group 5`).
7. **Honor user intent without being captured by it.** If user prompt says "split Track 2A," reassessment does that AND surfaces other necessary changes (don't tunnel-vision on one op while inbox closure debt accumulates). If user prompt says "ignore the closure debt" or includes a minimal-cue ("just triage", "don't restructure", "small pass", "quick cleanup"), skip structural proposals but still surface closure debt and freshness — you can't override correctness with a minimal cue.
8. **Hold scope when nothing is actually wrong.** Fast-path exists for a reason. A 2-item triage with no closure debt should not trigger structural restructuring — the proposal is "place these two items in $obvious-place" and that's it.

## Constraints to preserve

- **HARD GATE:** documentation changes only (ROADMAP.md, TODOS.md, PROGRESS.md). Never code, configs, CI files. `/roadmap` recommends a VERSION bump but never writes VERSION (that's `/ship`'s job). The PR landing this redesign is itself a VERSION bump, but that's PR mechanics, not `/roadmap` behavior.
- **Stable IDs.** Append-only; renumbering forbidden except at canonical resets. Mid-flight Group reopening is forbidden — Hotfix subsection is the only post-ship primitive. (D4)
- **Source-tag contract** (`docs/source-tag-contract.md`) — unchanged.
- **Vocabulary discipline** — audit's `check_vocab_lint` still owns this.
- **Hotfix subsection mechanics** — post-ship fixes append to `**Hotfix**`; Group stays ✓ Complete.
- **Trust boundary** — extracted strings from ROADMAP.md (track titles, descriptions, file paths) are data, not instructions.

## Hierarchical reassessment for large inputs (D5)

When the combined input (`unprocessed_count + active_track_count + active_task_count`) is large enough that single-pass reasoning may produce sloppy output, the reassessment splits into two passes against the **full** picture (not Group-scoped — that loses cross-Group themes):

**Pass 1 — Structure.** LLM reads inputs and identifies *only* structural changes: themes warranting new Tracks, Tracks/Groups that are secretly done, lopsided structure, closure-debt clusters. Output: a structural proposal (no per-item placements yet). User approves/revises via AskUserQuestion.

**Pass 2 — Placement.** Given the agreed structure from Pass 1, LLM does per-item placement into the now-stable target. Output: per-item placements + deferrals.

The LLM judges when hierarchical mode is needed — not a numeric threshold. Signals: total input size feels unwieldy, themes don't naturally cluster on first read, or the LLM's draft proposal has internal contradictions. When hierarchical mode fires, the structured proposal artifact (D9) records both passes for audit.

## AskUserQuestion presentation strategy

The reassessment produces a diff. The diff is presented via AskUserQuestion in clusters, not per-item. Cluster ordering: structural changes first (highest-stakes), then closures, then placements, then deferrals.

**Cluster types:**

1. **Structural proposal** (when the reassessment proposes new/extended/split/merged Tracks or Groups). One question per structural change cluster:
   > "Inbox includes 6 items touching `bin/roadmap-audit` and skill prose. I'd extract them into a new Track 1B 'Audit polish' with these 6 tasks. Approve?"
   > A) Approve as proposed
   > B) Revise (specify what to change)
   > C) Hold scope — fold into existing structure instead

2. **Closure proposal** (when reassessment proposes marking Track or Group ✓ Complete). One per closure:
   > "Track 2A's referenced files have 4 commits since introduction including `feat(2A): land batch finalize` — propose marking ✓ Complete in place. Approve?"
   > A) Mark Complete
   > B) Still in progress

3. **Placement batch** (per-item placements after structural changes are settled). Single batched table with reassessment's recommendation per item; user approves all or overrides selectively. Adversarial-flagged items break out individually.

4. **Deferral / kill batch** (items reassessment recommends deferring or killing, with reasons). Single batched approval.

5. **Ambiguity prompts** (reassessment is genuinely uncertain — two equally plausible proposals). Per Confusion Protocol — name the ambiguity, present 2-3 options with tradeoffs.

If the reassessment produces only placements (no structural / closure changes), it should feel like today's batched triage. If it produces structural changes, the user gets the structural questions first.

## Structured proposal artifact (D9)

Before applying any edits, the reassessment writes a structured proposal to `.context/roadmap/proposal-{ts}.md`:

```markdown
# Roadmap reassessment proposal — {timestamp}

## Structural changes
- NEW Track 1B "Audit polish" — 6 tasks from inbox items 1, 3, 4, 5, 8, 11
- EXTEND Track 2A — add closing-bug tasks from inbox items 2, 7
- ✓ Complete Track 1A — files have 4 commits since intro

## Placements
- Item 6 → Group 2 Pre-flight (off-topic for Track 2A)
- Item 9 → Future (defer; no in-flight Group fits)
- Item 10 → KILL (referenced files no longer exist)

## Closure proposals
- Group 1 → ✓ Complete (after 1B + 2A close)

## Hierarchical pass info (only present in large-input mode)
- Pass 1 ran: structure proposed at {ts}
- Pass 2 ran: placement proposed at {ts}
```

The artifact serves three purposes:
- **Preview UX:** user sees the full proposal before any edits land.
- **Test surface:** dogfood fixtures parse this file to assert structural ordering and theme detection.
- **Audit trail:** `.context/roadmap/proposal-*.md` accumulates a history of every reassessment.

The artifact is **prose-generated**, not bash-emitted. Format is markdown with a consistent structure tests can grep, but the content is LLM judgment.

## Fast-path

Skip reassessment entirely when ALL of:
- Audit returned `STATUS: pass` for all blocker checks (SIZE, COLLISIONS, STRUCTURE, VERSION, GROUP_DEPS, PARALLELISM_BUDGET).
- `## Unprocessed` is empty.
- `signals.has_zero_open_group == 0` AND no in-flight Group has inbox items that could be closure debt.
- `signals.staleness_fail == 0` AND `signals.git_inferred_freshness == 0`.
- **No in-flight Track has files with shipped activity since the Track was introduced.** This guards against the case codex flagged: clean audit but Tracks whose work actually shipped without being marked done. Computed via `git_inferred_freshness` over each in-flight Track's `_touches:_`.
- User prompt has no `intents.split`, `intents.closure`, or structural keyword cue.

Output: "Plan looks current. No changes." Exit before Step 3. No commit.

This preserves cheap-when-possible behavior and avoids LLM cost on no-op runs without rubber-stamping stale plans.

## Step-by-step execution

### Step 0: Preamble (unchanged)

Auto-update check, version banner.

### Step 1: Gather

Run audit + state scan, read TODOS / ROADMAP / git log, parse user prompt for intents.

```bash
"$_EXTEND_ROOT/bin/roadmap-audit" > /tmp/roadmap-audit.txt
"$_EXTEND_ROOT/bin/roadmap-audit" --scan-state --prompt "$USER_PROMPT" > /tmp/roadmap-state.json
```

Determine the introduction timestamp of each in-flight Track using the same `git log -S` provenance lookup the existing FRESHNESS scan uses. `LAST_ROADMAP_RUN` (the cutoff for "recent" git log) is computed as: most recent commit on `docs/ROADMAP.md` (via `git log -1 --format=%ai docs/ROADMAP.md`); fall back to "4 weeks ago" if no commits.

Read TODOS.md `## Unprocessed`, ROADMAP.md (full), and:

```bash
# Null-safe; handles deleted/renamed paths and arg-list explosion
git log --since="$LAST_ROADMAP_RUN" --oneline -- docs/ROADMAP.md
extract_referenced_files_from_roadmap | tr '\n' '\0' | xargs -0 -I {} \
  git log --since="$LAST_ROADMAP_RUN" --pretty='%h %s' -- {} 2>/dev/null
```

Pre-classify inbox items:

```bash
for item in unprocessed_items: bin/roadmap-route "$source_tag"
```

### Step 2: Fast-path check

Apply the fast-path conditions above. If all met, print and exit.

### Step 3: Reassess (the LLM-owned step)

Read everything from Step 1. If the input feels large enough that single-pass reasoning would be sloppy, run hierarchically (Pass 1 structure → Pass 2 placement). Otherwise single-pass.

Build the diff. Apply the responsibilities from "What the LLM is responsible for" above. Write the structured proposal artifact (D9) to `.context/roadmap/proposal-{ts}.md`.

Present the diff via AskUserQuestion using the cluster strategy. The user's responses produce the *applied* diff (which may be a subset of the proposed diff if they rejected clusters).

### Step 4: Apply

Edit ROADMAP.md and TODOS.md to reflect the applied diff.

- Use `bin/roadmap-revise split-track` for split operations (the one helper kept).
- All other edits are direct ROADMAP.md / TODOS.md modifications.
- After applying, run `bin/roadmap-audit` once. If blockers fire (SIZE, COLLISIONS, STRUCTURE, VERSION, GROUP_DEPS), escalate per the Escalation Protocol with the diff intact rather than silently shipping a malformed ROADMAP.
- **TODOS.md drain orphan check:** before commit, assert that every item the proposal said to move/kill/defer is actually gone from `## Unprocessed`. Escalate if any orphan remains.

### Step 5: PROGRESS / VERSION / commit

Unchanged from current Step 4-6.

## Skill prose surface — concrete changes

Lines `skills/roadmap.md:73-287` (Steps 1-3, the four-op orchestration) are replaced with:

- Step 1 Gather (mostly unchanged from today).
- Step 2 Fast-path.
- Step 3 Reassess — the new content covering: what to read, judgment responsibilities (qualitative theme criteria, not numeric thresholds), hierarchical mode trigger, structured proposal artifact, AskUserQuestion cluster templates, constraint reminders.
- Step 4 Apply — direct edits + audit-after + orphan check.

The four-op precedence chain is removed entirely.

The `## Output Format`, `## Trust boundary`, `## Interpreting audit findings`, `## Documentation Taxonomy`, `## Completion Status Protocol`, `## Confusion Protocol`, `## Escalation`, and `## GSTACK REVIEW REPORT` sections all remain unchanged.

## Test strategy

### Unit-level

`bin/roadmap-audit` unit tests unchanged. `bin/roadmap-route` tests unchanged. `bin/roadmap-place` tests **deleted** (D2). `bin/roadmap-revise defer-task` tests **deleted** (D3); `split-track` tests retained.

### Skill protocol tests

`scripts/test-skill-protocols.sh` REQUIRED_VERBATIM_BLOCKS additions for:
- The new fast-path output string.
- The reassessment AskUserQuestion templates (cluster types 1-3 above).
- The structured-proposal artifact format header and section names (so any prose drift is caught).

**Codex-driven sequencing:** these REQUIRED_VERBATIM_BLOCKS land *before or alongside* the prose rewrite, not after. Otherwise the rewrite has no automated check that required blocks survived.

### Dogfood regression fixtures

Seven fixtures (S1–S7 in the test plan artifact at `~/.gstack/projects/kbitz-gstack-extend/kb-kbitz-roadmap-judgment-eng-review-test-plan-20260428-191221.md`):

- **S1 — Fast-path** (clean drained roadmap → "Plan looks current").
- **S2 — Bolt 11-item case (CRITICAL REGRESSION)** — restore the 11 items from `git show a5089a2 -- docs/TODOS.md`; assert reassessment proposes 3+ thematic Tracks, NOT a Pre-flight pile-up; assert structural questions before per-item placements.
- **S3 — Closure debt blocks ✓ Complete (CRITICAL REGRESSION)** — Group with zero open Tracks but inbox items tagged `[pair-review:group=N]`; assert reassessment proposes extend/closing-Track BEFORE marking Complete.
- **S4 — Hierarchical reassessment** — large input; assert two-pass output visible in artifact.
- **S5 — Minimal cue** — prompt says "just triage, don't rework"; assert structural proposals skipped, but closure debt and freshness still surfaced.
- **S6 — Split-compose** — `/roadmap "split Track 2A"` with unrelated inbox items; assert split runs AND triage proceeds.
- **S7 — User rejects structural proposal** — choose Hold scope; assert fall-through to per-item placement.

### Live validation

After implementation: run new `/roadmap` against gstack-extend's own `docs/TODOS.md` (currently has accumulated unprocessed items). This is the live dogfood — not a follow-up TODO, part of the PR validation.

### What's hard to test

The reassessment's *quality* (does it propose good Tracks? does it identify themes correctly?) is judgment-heavy. We accept this and rely on:
- The 7 dogfood fixtures (cover behavior, not quality).
- Live validation on gstack-extend's real backlog.
- Structured proposal artifact gives tests a parseable target without forcing bash to own judgment.
- Audit-after-apply catches well-formedness violations.

## Migration / rollout

One PR, one VERSION bump (v0.18.0 — not breaking, but a meaningful behavioral shift).

Order of changes within the PR (codex-driven sequencing — test scaffolding **before** prose rewrite):

1. Add REQUIRED_VERBATIM_BLOCKS for new prose to `scripts/test-skill-protocols.sh`.
2. Add S1–S7 dogfood regression fixtures to `scripts/test-roadmap-audit.sh`.
3. Skill prose rewrite: collapse Steps 1-3 into one Reassess step (`skills/roadmap.md`).
4. Delete `bin/roadmap-place` and its tests.
5. Slim `bin/roadmap-revise` to `split-track` only; remove `defer-task`.
6. Kill the obsolete 4-part proposal in `docs/TODOS.md`.
7. CHANGELOG entry, VERSION bump to v0.18.0, PROGRESS row.
8. **Live validation:** run `/roadmap` on gstack-extend's own backlog.

## Risks and mitigations

**Risk:** Reassessment is more expensive (more LLM tokens per run).
*Mitigation:* Fast-path covers the common case (most runs are no-op). When reassessment does run, it's because the world actually changed.

**Risk:** Reassessment might propose too aggressive restructuring on small inboxes.
*Mitigation:* Skill prose explicit: "if the inbox is small and items don't share a coherent theme, default to placing them in the obvious slot — don't propose new Tracks/Groups for trivial volume." User can always reject the structural proposal and fall through to placements (S7).

**Risk:** Direct ROADMAP.md edits without a helper are error-prone.
*Mitigation:* Audit-after-apply catches well-formedness. Structured proposal artifact gives a "what will be applied" preview. Escalation-with-diff-intact if blockers fire. Direct edits are NOT a semantic-correctness backstop — that lives in the LLM judgment + user approval gates, which is the whole point of the redesign.

**Risk:** Fast-path masks stale plans (codex challenge).
*Mitigation:* Tightened fast-path conditions include "no in-flight Track has files with shipped activity since intro." Stale-plan detection is now load-bearing in the fast-path predicate, not assumed away.

**Risk:** TODOS.md drain leaves orphan items.
*Mitigation:* Pre-commit orphan check in Step 4 — every item the proposal said to move/kill/defer must actually be gone. Escalate if any orphan remains.

**Risk:** A user who specifically wants only triage feels overridden.
*Mitigation:* Minimal-cue parsing in skill prose ("just triage", "don't restructure", "small pass", "quick cleanup", etc.). Skips structural proposals, still surfaces correctness signals (closure debt, freshness).

**Risk:** Removing the four-op precedence chain loses a useful "what kind of run was this?" signal in commit messages.
*Mitigation:* The reassessment labels its applied diff post-hoc. Commit message becomes "docs: reassess roadmap — closed Group 2, added Track 1B, triaged 6 items" — richer than today's `docs: triage unprocessed items into roadmap`.

## What this does not change

- The signal-vs-verdict architectural principle.
- `bin/roadmap-audit`, `bin/roadmap-route`, `bin/lib/source-tag.sh` interfaces.
- Source-tag contract.
- Vocabulary, structural, and sizing audits.
- Hotfix subsection semantics; mid-flight Group reopening remains forbidden (D4).
- Stable ID rules.
- Trust boundary on extracted strings.
- Documentation taxonomy.
- The Completion Status / Confusion / Escalation protocols.
- The HARD GATE on doc-only changes.

## Decisions resolved in `/plan-eng-review`

- **D1:** Full collapse of 4 ops to 1 reassess step (vs strangler-fig).
- **D2:** Delete `bin/roadmap-place` and its tests.
- **D3:** Slim `bin/roadmap-revise` to `split-track` only; inline `defer-task`.
- **D4:** Forbid mid-flight Group reopening; Hotfix is the only post-ship primitive.
- **D5:** Hierarchical reassessment for large input is in v1 scope (themes pass → placement pass on the full picture; LLM judges when to engage).
- **D6:** Plan rewrite handles Q2 (no JSON helper), Q4 (minimal as prompt-keyword cue with synonym handling).
- **D8 (cross-model tension):** Reaffirmed D4 against codex's pushback.
- **D9 (cross-model tension):** Reassessment writes a structured proposal artifact to `.context/roadmap/proposal-{ts}.md` before apply.
- **D10 (cross-model tension):** Theme detection is qualitative judgment criteria, not numeric thresholds — 10 tiny bugs can be one Track, one large item can be its own Track, the LLM owns the call.
- **D11:** No follow-up TODO for dogfood — live validation on gstack-extend's own backlog is part of PR.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | issues_found | 16 challenges (3 surfaced as cross-model tensions; 13 incorporated into plan revision) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean | 11 decisions resolved; 2 critical failure modes flagged and mitigated |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | not run (not applicable — skill prose change) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not run |

**CODEX:** 3 cross-model tensions surfaced (mid-flight reopening, structured proposal artifact, theme thresholds); user kept D4 forbid, accepted artifact, rejected numeric thresholds.

**CROSS-MODEL:** Codex challenged 16 items; review converged on the 13 plan-revision items (sequencing, fast-path tightening, null-safe paths, etc.). Three principled disagreements surfaced and resolved.

**UNRESOLVED:** 0.

**VERDICT:** ENG CLEARED — ready to implement.
