# Roadmap

Organized by lifecycle state: **In Progress**, **Current Plan**, **Future** and
**Shipped**. A Track is one PR/session. The packer assigns Groups of disjoint
file footprints and their launch dependencies. Explicit scheduling edges carry
the owner's priority order, and each card's **Scheduling:** line separates its
priority choices from technical prerequisites.

**Owner order.** The owner's 2026-10-30 efficiency-review order has shipped
(Tracks 47A, 48A, 33A, 49A, 50A and 51A, v0.53.0 to v0.59.0). On 2026-11-01 the
owner kept that order with the skill-test narrowing next; it shipped as Track
52A (v0.60.1). On 2026-11-02 the owner approved review-finding attribution
first, then the folded first cycle and caller-configured review delegation as
two measured arms, all ahead of the paused and resumed telemetry Track ("Yes -
your rec sounds good, let's fix" and "1"). That order ran Tracks 64A, 64B, 57A,
64C and 58A (v0.60.2 to v0.63.0). The edges from 57A and 58A to the bounded
documentation-audit Track (then 56A, now 68A) were priority choices, and that
order superseded them. The paused and resumed telemetry Track (then 53A, now
65A) is next again; after it the roadmap's own order resumes: test savings,
telemetry, then audit and review optimizations.

**Labels.** The regeneration of 2026-11-03 relabels the nine remaining Groups
53 to 56 and 59 to 63 as Groups 65 to 73 in packer order, with unchanged
partitions and letters (`53A` became `65A`, `56A` became `68A`, `63A`
became `73A`; the full map is in that commit message). Shipped numbers 33,
47 to 52, 57, 58 and 64 are reserved by tombstones; 64 was never a roadmap
Group, and its three Tracks were numbered when they were launched.

**Dropped: Track 35B.** The `full-suite=before-audit` value was dropped rather
than renumbered (2026-10-31): under `full-suite=final` and
`full-suite=external` the full suite already runs once on the final content,
after the documentation audit (`skills/review-and-prep.md`, Review policy
section and the external gate's slot), so that value has no second full suite
to avoid, and no caller has asked for it. Under `full-suite=external` the
pregate's selected test lanes ran a second time after the caller's accepted
full-suite pass (corrected 2026-11-01); the v0.60.0 pregate narrowing skips
that repeat when the attested command covers every selected test. That is a
different repetition from the one 35B targeted, so 35B stays dropped and its
design item E3 stays marked dropped in the
[efficiency program](designs/workflow-efficiency-program.md); reinstating it is
the owner's decision.

**Card size.** A Track estimated above about 300 authored lines, counting its
tests, is split into separate Tracks unless splitting would leave a Track that
cannot ship alone. Byte-copied shared blocks and generated text do not count
toward that threshold. Do not split when the resulting Tracks would edit the
same files and must run one after another anyway, because each Track costs a
full pipeline run. A card kept above the threshold says why on its
**Scheduling:** line, and a card with copied or generated lines states them
separately from authored ones (owner rule, 2026-10-26). Track 31A was already in
progress when the rule was adopted and has shipped. Applied 2026-10-26 to three
Track pairs that edit the same files and run in sequence: each pair is now one
card, with the reason on its Scheduling line; the review-fix policy pair stayed
split on purpose (both Tracks have shipped, 33A in v0.55.0 and 51A in v0.59.0;
the reason is on 51A's shipped receipt).

Target: [SPEC](SPEC.md) O1–O5, public-release 1.0.0, potentially-public users.
Paseo and Conductor retain equal priority. The owner-selected
[efficiency program](designs/workflow-efficiency-program.md), SPEC P1, is additional
work and does not gate 1.0. Implementation, installed/operator evidence and
owner acceptance remain distinct. No new spend or unattended merge is authorized.

## In Progress

No Group is in progress, and no working branch, session or PR is declared active.
Every shipped Track is recorded independently in shipped history; the latest
are 52A (v0.60.1), 64A (v0.60.2), 64B (v0.60.3), 57A (v0.61.0), 64C (v0.62.0)
and 58A (v0.63.0). Track 28A's required published-release upgrade
acceptance remains in Future; its revisit trigger, the first published
three-part release, was met by v0.48.0 and the item awaits an owner
reassessment. O1 and O3–O5 remain pending.

## Current Plan

_tombstone: 17, 19, 20, 22, 23, 24, 25, 26, 28, 29, 30, 31, 32, 33, 47, 48, 49, 50, 51, 52, 57, 58, 64_

### Group 65: Paused and resumed telemetry ∥ Python source-root test selection

_Depends on: none_

**This group delivers:** Truthful blocked/completed segments with stable run identity across resumes, and generated, checkable pregate dependency maps for Python source-root layouts.

##### Track 65A: Record paused, blocked and resumed runs
_2 tasks . ~300 LOC incl. tests . medium risk_
**Outcome:** An external caller can tell a run that stopped for a person from one that never ran, and a run resumed in another checkout still records its completion.
**Supports:** [SPEC](SPEC.md) O4 criteria 2–3, O3 and O1.2 — blocked work must be explicit and starts and finishes must keep their run identity; today a deliberate pause defers finish, and a resume in a new worktree finds no handoff in its root and writes nothing.
**Done when:** A deliberate pause in `/review-and-prep`, `/pair-review` or `/full-review` writes one row with outcome `blocked`; a resumed run that completes writes its own row, including from a different checkout root; each start pairs with exactly one finish; every installed skill copy carries the same updated start/finish wording; the join contract describes how segments link, and v1, v2 and legacy rows stay readable.
_touches: bin/lib/telemetry.py, docs/telemetry.md, tests/telemetry.test.ts, tests/telemetry-contract.test.ts, tests/skill-protocols.test.ts, skills/_
_blocked-by: Track 23H, Track 23I, Track 26A, Track 31A, Track 52A_
**Scheduling:** Owner order, 2026-11-02 ("Yes - your rec sounds good, let's fix" and "1"): Tracks 64A, 64B, 57A, 64C and 58A ran ahead of this Track; it is next again, and the roadmap's own order resumes after it. Owner-selected order: telemetry follows test savings, which shipped as 52A (v0.60.1). Complete paused/resumed segments before their dependent requested-model and usage work. Split from the former paused/resumed and update-check card under the card-size rule; the update check now has its own Tracks.
_read-first: 23H, 23I, 26A, docs/telemetry.md_
- **Close each paused segment with a blocked row** -- Replace "A deliberate pause defers finish" at the pause points of the three resumable skills with a finish that records `blocked`, the outcome stage-runs schema v2 has reserved since 0.37.0.0. Update the shared start/finish wording in all twelve skill copies (`skills/plan-track.md`, added in 0.57.0, is the twelfth), including `skills/autoplan-lean.md` (added in 0.40.0.0), and the `RESUMABLE` adoption rule with it. Since 0.56.0 each copy is a 12-line block that calls the installed `telemetry-call` helper, so the copied-line share of the estimate below predates the shrink; restate it when the card is planned by counting the lines between each skill's `SHARED:telemetry-start` and `SHARED:telemetry-finish` markers with `awk`. While editing, re-anchor two stale Track references to their current owners in words rather than IDs: `skills/pair-review.md` ("Track 24B owns the future canonical hold/resume detector", written when 24B was the stage-handoff contract Track, since shipped as 23I) and `docs/telemetry.md` (2026-10-25 source text: "receipt 2 or Track 27A evidence", which means the Conductor host qualification). Evidence (2026-10-16): no review-and-prep row for five of seven recent orchestrated PRs, and 5 review-and-prep handoffs among 24 leftover starts. Source: `[manual] Give paused and blocked /review-and-prep runs a stage-runs row`. _~180 lines._ (M)
- **Record a resumed completion in any checkout** -- A resume starts its own segment, linked to the paused one by an identifier settled at planning (run identity or the launcher's work item), so a resume in a new worktree records its completion; use the status words of the stage-handoff contract. Align step/pass boundaries with the companion ledger from Track 24A; interrupted or unobserved intervals stay unknown. Settle at planning how this relates to the Future cards "Recover a telemetry finish run from a different repository root" and "In-flight marker and crash detection for extend telemetry". _~120 lines._ (M)

##### Track 65B: Generate and check pregate dependency maps for Python source-root layouts
_2 tasks . ~380 authored LOC incl. tests . medium risk_
**Outcome:** A repository whose Python code lives under a source root such as `src/<pkg>` gets import-graph test selection from pregate without hand-maintaining its dependency map, and a stale map fails visibly.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25 (test savings); owner-approved addition, 2026-10-26.
**Done when:** An opt-in gstack-extend helper that a consumer runs scans the repository's Python imports, maps each module under a declared source root (`src/` by default, or roots the repository declares) to the test files that import it, and writes those entries into `.gstack/pregate.json` `dependencies` while preserving hand-written entries and every other key. A check mode changes nothing and exits nonzero naming stale or missing entries. A fixture repository with a `src/<pkg>` layout gets import-graph selection for a change to one module through the generated map; hand-written entries survive regeneration; check mode reports a stale map. Nothing runs automatically, upstream pregate's selection is neither forked nor wrapped, and a repository that does not run the helper is unchanged.
_touches: bin/pregate-deps (new), src/pregate-deps/ (new), tests/pregate-deps.test.ts (new), tests/fixtures/pregate-deps/ (new), tests/helpers/touchfiles.ts, .gstack/pregate.json, docs/pregate-deps.md (new), CLAUDE.md_
_blocked-by: Track 31A, Track 52A_
**Scheduling:** Test-savings work, owner-approved 2026-10-26. It followed the skill-test narrowing, shipped as 52A (v0.60.1), because both edit this repository's touchfile map and pregate copy; that edge ordered a collision, was not a prerequisite and is now satisfied. Kept as one Track at ~380 authored lines under the card-size rule: the generator and its check mode edit the same files and would have to run one after another anyway.
_Source: owner-approved 2026-10-26; installed upstream pregate resolves Python imports from the repository root only, and its CHANGELOG documents `dependencies` declarations for `src/` layouts_
_read-first: scripts/sync-pregate-deps.ts_
- **Generate the map from Python imports** -- Read the declared source roots, resolve each test file's imports to modules under a root, emit module-path to test-file entries, and merge them into `.gstack/pregate.json` `dependencies`, keeping hand-written entries and other keys under a documented ownership rule; `scripts/sync-pregate-deps.ts`, this repository's own map sync, is the precedent. Settle at planning whether transitive imports count; the generated map must not select fewer tests than a root-layout import graph would. _~240 lines incl. tests._ (M)
- **Check mode and fixture proof** -- Add a check mode that changes nothing and exits nonzero naming stale or missing entries; build a `src/<pkg>` fixture repository showing selection for a one-module change through the generated map, hand-written entries surviving regeneration and a stale map failing; document the helper and give its launcher the Bun flags every `bin/` launcher passes. _~140 lines incl. tests._ (M)

### Group 66: Update check in every skill ∥ requested-model provenance

_Depends on: Group 65_

**This group delivers:** An update notice in all twelve skills that never upgrades a shared checkout from a spawned session, and requested model values recorded separately from observed ones.

##### Track 66A: Check for gstack-extend updates in every skill, never upgrading from a spawned session
_2 tasks . ~200 authored LOC incl. tests, plus ~640 copied shared-block lines . medium risk_
**Outcome:** Every installed skill reports an available gstack-extend update, and a skill running in a spawned or unattended session never prompts and never upgrades the installed checkout that concurrently running stages share.
**Supports:** [SPEC](SPEC.md) O1.2 and O3.2 (a stage never loses work); owner-approved update check, 2026-10-26 — today only four of the twelve installed skills run it, so a caller that launches only workflow stages never learns of an update.
**Done when:** The shared upgrade flow gains one spawned-session branch: when `GSTACK_SESSION_KIND=spawned` it asks nothing, never runs `bin/update-run` (including under `auto_upgrade=true`) and carries the available version into the receipt or final message; interactive behavior, including `auto_upgrade`, is unchanged; `docs/installation.md` documents it. Every installed skill runs `bin/update-check` at start with that flow byte for byte: the four that run it today (`/pair-review`, `/roadmap`, `/full-review`, `/gstack-extend-upgrade`) take the updated block, the three that already carry the extend-root resolver (`/autoplan-lean`, `/docs-ship`, `/gstack-extend-init`) add the check, and the five that lack it (`/implement`, `/review-and-prep`, `/ship-and-land`, `/project-spec`, `/plan-track`) add the resolver and the check. The upgrade-preamble cohort lock (`PREAMBLE_SKILLS` in `tests/skill-protocols.test.ts`) covers all twelve skills and a spawned-session case.
_touches: skills/pair-review.md, skills/roadmap.md, skills/full-review.md, skills/gstack-extend-upgrade.md, skills/autoplan-lean.md, skills/docs-ship.md, skills/gstack-extend-init.md, skills/implement.md, skills/project-spec.md, skills/review-and-prep.md, skills/ship-and-land.md, skills/plan-track.md, docs/installation.md, tests/skill-protocols.test.ts_
_blocked-by: Track 65A_
**Scheduling:** One Track under the card-size rule: about 200 authored lines, and the ~640 byte-copied shared-block lines do not count (the earlier ~530 was for seven skills; `/plan-track`, added in 0.57.0, adds the roughly 110-line resolver preamble and upgrade flow it lacks, the span `skills/roadmap.md` holds from `## Preamble (run first)` through `<!-- /SHARED:upgrade-flow -->`, 112 lines at this base, counted with `awk`). Splitting it would leave Tracks that edit the same cohort test and skill files and must run one after another anyway. The spawned-session branch lands in the same change as the new update checks, so no workflow stage gains the check without it. The paused/resumed edge orders the shared skill files.
_Source: owner-approved, 2026-10-26_
_read-first: docs/installation.md_
- **Add the spawned-session branch to the shared upgrade flow** -- When `GSTACK_SESSION_KIND=spawned`, ask nothing, never run `bin/update-run` (including under `auto_upgrade=true`) and carry the available version into the receipt or final message; cover a spawned-session case in the cohort lock; document it in `docs/installation.md`. _~120 authored lines incl. tests._ (S)
- **Run the update check in all twelve skills** -- Add the extend-root resolver where it is missing, then the update-check call and the shared upgrade flow to the eight skills outside the cohort, move them into it and assert all twelve are covered. _~80 authored lines plus ~640 copied shared-block lines the protocol tests lock byte for byte._ (M)

##### Track 66B: Record a caller-requested model where detection finds none
_1 task . ~120 LOC incl. tests . low risk_
**Outcome:** A launcher can record the model and effort it requested for a stage whose harness log names none, and readers can tell that value from an observed one.
**Supports:** [SPEC](SPEC.md) O4 criterion 3 — requested-versus-observed model evidence must be distinguishable; every local `cursor-agent` row (29 ship-and-land rows, releases 0.34.2.0 to 0.36.8.0) has model null with source unknown.
**Done when:** `GSTACK_EXTEND_MODEL` and `GSTACK_EXTEND_EFFORT` fill only a null detected value and carry the requested source label, never `detected`; detection and finish flags still win; a `cursor-agent` fixture covers the route; `docs/telemetry.md` documents both variables.
_touches: bin/lib/telemetry.py, tests/telemetry.test.ts, tests/telemetry-contract.test.ts, docs/telemetry.md, docs/stage-runs.schema.json_
_blocked-by: Track 26A, Track 65A_
**Scheduling:** This is the second telemetry step after test savings; preserve the paused-segment prerequisite.
_read-first: 26A, docs/telemetry.md_
- **Record the caller's requested model and effort** -- Stage-runs schema v2 (0.37.0.0) already reserves the `requested` source for non-null model and effort; this Track is its first producer. On Cursor's CLI route (`CURSOR_INVOKED_AS` set) `_observe_cursor_store()` skips the store and `cursor_turns()` returns only a transcript mtime. A local check on 2026-10-16 found no model in `cursor-agent` transcripts or chat-store metadata, and `~/.cursor/cli-config.json` holds only a configured default, which provenance must not record. Check whether `cursor-agent --output-format json` events name the model before relying on the environment alone. Source: `[manual] Accept a caller-supplied model when detection finds none, labeled as requested`. _~120 lines._ (S)

### Group 67: Run and child usage telemetry

_Depends on: Group 65, Group 66_

**This group delivers:** Per-run token usage from the harness's own logs, with child and outside-reviewer usage attributed to it and explicit uncertainty throughout.

##### Track 67A: Record each run's token usage, parent and child, from the harness's own logs
_3 tasks . ~600 LOC incl. tests . medium risk_
**Outcome:** The maintainer can compare each run's total token usage, parent and child together, by workflow, step and recorded model, with explicit uncertainty where a source cannot support it or attribution.
**Supports:** [SPEC](SPEC.md) P1 and owner-selected usage capture, 2026-10-19; promotes the retained run-usage and outside-voice Future commitments without enabling quota routing or vendor usage API calls.
**Done when:** A local report combines step/pass events with disjoint token classes and available plan-window observations; fixtures cover streaming copies and cumulative counter resets; each recorded child or outside-reviewer call joins its invocation and pass, with direct evidence distinguished from time/directory correlation and ambiguous or overlapping usage excluded from exact totals; fixtures cover nested children and concurrent sessions; unknown values remain null with reasons; legacy, v1 and v2 stage rows stay immutable and readable, a closed schema gains a version branch and never a silent field, and capture makes no credential or network calls.
_touches: bin/lib/telemetry.py, bin/lib/workflow_metrics.py, bin/lib/quota/usage.py, docs/workflow-metrics.schema.json, docs/telemetry.md, docs/stage-runs.schema.json, tests/workflow-metrics.test.ts, tests/telemetry.test.ts, tests/telemetry-contract.test.ts, tests/quota.test.ts, tests/fixtures/quota/, tests/helpers/touchfiles.ts_
_blocked-by: Track 24A, Track 26A, Track 65A, Track 66B, Track 31A_
**Scheduling:** The third telemetry step after test savings, before bounded audits and review overlap. Run usage and child and outside-reviewer attribution were two Tracks (~300 lines each) under the card-size rule; the attribution Track edited the same telemetry, metrics and schema files and joined the usage records the first one writes, so the two would have run one after another anyway. Merged into one card under the rule's same-files exception (owner direction, 2026-10-26) and kept at ~600 lines for that reason: splitting it would cost a second full pipeline run for no parallelism.
_Source: absorbs "Record each run's token usage and plan-window readings from the harness's own logs" and "Record outside-voice calls' vendor, model, tokens and window readings"_
_read-first: docs/telemetry.md, docs/quota-ledger.md, docs/designs/review-independence.md_
_produces: comparable per-run and per-voice local usage projections, source/attribution grades and a replayable sanitized fixture corpus_
- **Reuse the local log parser for run usage** -- Absorb "Record each run's token usage and plan-window readings from the harness's own logs". Reuse or isolate the existing quota usage parser rather than introduce a third parser. Record uncached input, cache read/write and output; reasoning is a subset, never added twice. Retain logged start/end rate-limit readings with reset and concurrency caveats; account-wide percentage changes are not attributable stage consumption. Cursor/Grok sources remain unknown until verified. Read only session logs and CLI output: no credentials, identity/capacity readers or vendor usage services. _~240 lines._ (M)
- **Attribute child and outside-reviewer usage** -- Absorb "Record outside-voice calls' vendor, model, tokens and window readings". Join each recorded call to its invocation and pass using direct parent/session evidence when available, including the local `voices.jsonl` reviewer join (host subagent identifier, parent-observed dispatch/return times) that 0.38.0.0 added; mark directory/time matches as correlation and ambiguous shared-worktree matches as unknown. Deduplicate native subagents and cross-harness children, account for children that outlive the step, and preserve every contributing model/source. Do not modify upstream commands or claim observed/billed models from requested labels. _~240 lines._ (M)
- **Preserve schema, parser and child-record compatibility** -- Use the step ledger for detailed usage and retain immutable legacy/v1/v2 stage rows. Coordinate any stage-row reference fields with the stage-runs v2 schema shipped in 0.37.0.0; never add fields silently to a published closed schema. Preserve saved retry bytes and paused-segment linkage, publish only sanitized projections, and prove capture makes no credential or network calls. When editing `bin/lib/workflow_metrics.py`, weigh the Future item "Slim the workflow-metrics helper without dropping requirements"; adopting it is optional. _~120 lines._ (S)

### Group 68: Bound audit effort

_Depends on: Group 66, Group 67_

**This group delivers:** Fewer irrelevant documentation reads with real drift detection retained.

##### Track 68A: Bound documentation audits by changed contracts
_1 tasks . ~220 LOC incl. tests . medium risk_
**Outcome:** Reviews read the documentation relevant to their changed contracts and retain real drift detection.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25
**Done when:** The scope includes changed-path and contract references, linked authorities and safe broad fallback when relevance is uncertain; the one re-audit follows only the fix delta. Before/after time, read volume and retained finding quality are recorded before any default activation.
_touches: skills/review-and-prep.md, skills/ship-and-land.md, tests/skill-protocols-review-and-prep.test.ts, tests/skill-protocols-ship-and-land.test.ts, docs/acceptance/documentation-audit-efficiency.md (new)_
_blocked-by: Track 31A, Track 67A, Track 66A_
**Scheduling:** Owner-selected order places telemetry after test savings, then bounded documentation audits; the usage edge is a priority choice. The update-check edge orders the shared skill files. Tracks 57A and 58A, which the 2026-11-01 plan placed after this Track, ran first under the owner's 2026-11-02 order; their edges to it were priority choices that order superseded.
_Source: program E4 / research R4_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Constrain discovery and re-audit inputs** -- Keep current/updated/blocked truthful and the existing attempt bound; compare the bounded audit against representative known documentation drift. If public-quality evidence is insufficient, expose an explicit option and retain the default. _~220 lines._ (M)

### Group 69: Shorten the first review cycle

_Depends on: Group 68_

**This group delivers:** Measured overlap of independent first-cycle review work without losing finding quality.

##### Track 69A: Overlap independent first-cycle review work
_1 tasks . ~230 LOC incl. tests . medium risk_
**Outcome:** A full first review cycle can finish sooner without losing independent coverage.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25
**Done when:** E1 establishes a baseline; one immutable scope feeds concurrent specialists, native adversarial and outside pair, with the pair internally sequential and Red Team after merged findings. Host-cap fallback and incomplete voices preserve holds. Before/after wall time and finding quality support activation.
_touches: skills/review-and-prep.md, tests/skill-protocols-review-and-prep.test.ts, tests/workflow-metrics.test.ts, docs/acceptance/review-concurrency.md (new)_
_blocked-by: Track 31A, Track 29A, Track 68A, Track 57A_
**Scheduling:** Owner order, 2026-10-25: after the per-finding attribution Track (shipped as 57A, v0.61.0), whose per-part finding quality this Track's activation evidence needs. The folded first cycle shipped first as an opt-in arm (58A, `specialists=fold`, v0.63.0), beside caller-configured delegation (64C, `delegate=`, v0.62.0), the two measured arms of the owner's 2026-11-02 order. Settle at planning how overlap behaves when either value is set, and whether their measured runs still leave overlap worth building.
_Source: program E5 / research R2_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Overlap only verified-independent inputs** -- Recheck upstream dependencies; preserve no-fix-before-collection, deduplication, cycle cap, stop and outside-call policy; qualify both hosts and retain the old default behind an option until public activation evidence exists. _~230 lines._ (M)

### Group 70: Docs-only test selection ∥ release-only proof and full-run credit

_Depends on: Group 69_

**This group delivers:** A shared docs-only test map, an explained elapsed-time outlier, mechanical release-stamp proof and an opt-in credit for a prepared full run across a release-only delta.

##### Track 70A: Use pregate to select docs-only tests and explain long runs
_2 tasks . ~280 LOC incl. tests . medium risk_
**Outcome:** Docs-only shipping has one policy map for selected tests and attributable work/wait timing.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25; O3 documentation workflow.
**Done when:** With a usable base policy the nonexecuting pregate explanation owns selected tests and reasons for the exact delta; missing/invalid policy and legacy marker handling are explicit and conservative. Same-tree evidence reuse survives. The reported 211-minute outlier has an evidenced explanation; any unavailable intervals remain open unless the owner explicitly defers that obligation.
_touches: src/docs-ship/pinning.ts, src/docs-ship/cli.ts, src/docs-ship/config.ts, skills/docs-ship.md, docs/docs-ship.md, tests/docs-ship.test.ts, tests/skill-protocols-docs-ship.test.ts_
_blocked-by: Track 31A, Track 29A, Track 69A_
**Scheduling:** Prioritize the main review savings before the separate docs-only path and its long-run investigation; relative call frequency has not been established.
_Source: program E8 / research R8_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Adopt the policy map compatibly** -- Consume exact-delta/base-policy explanation, preserve no-lane and error semantics, and cover policy-backed, policy-less, configured-marker and bump-delta cases without silently losing coverage. _~210 lines._ (M)
- **Account for long docs-only runs** -- Separate active review/test work, host/tool stalls and human waits using E1; retain bounded evidence and unknowns, and attach installed-host qualification to the two existing host Tracks. _~70 lines._ (S)

##### Track 70B: Prove release-only reuse mechanically and credit a prepared full run across a release-only delta
_3 tasks . ~520 LOC incl. tests . medium risk_
**Outcome:** A policy-equipped repository gets mechanical stamp-hunk proof before release gate reuse, and an opted-in caller whose preparation already ran the full suite on the prepared head does not run it again for a release-only commit.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25 and owner-approved release-only credit, 2026-10-26; O3/O5 release integrity.
**Done when:** The verified base ship policy drives gstack-tree-receipt; eligible per-lane proof and current evidence are required; same-file functional edits, unreadable policy, stale evidence and stamp-sensitive tests cannot reuse improperly; repositories without policy keep the documented existing path. Under an opt-in policy value (named at planning), when `full-suite=final` is recorded `/ship-and-land` credits a verified full run of the prepared head (same tree, the documented full command, exit 0, tests ran, recorded in the ledger) across a release-only delta and runs only what that delta selects, instead of the full form a second time; without the value, `full-suite=final` keeps today's meaning. An opt-in per-repository list of extra release files keeps a release commit that also edits such a file (for example an acceptance record) on the release-only path; omitted, the release files stay VERSION, the CHANGELOG entry and the files `/ship`'s version tool writes. Under the same opt-in and `full-suite=final`, a verified pregate selection may stand as preparation's main-suite run when the main test command does not select from the diff (today `/review-and-prep`'s coverage rule then runs the full main command). Release edits follow one rule: only an opted-in release-only delta over a credited full run skips the full rerun, and any other or unknown change still runs it. Omitted-policy behavior and an older producer's fallback are documented, and before/after test time is measured on a real run.
_touches: skills/ship-and-land.md, skills/review-and-prep.md, tests/skill-protocols-ship-and-land.test.ts, tests/skill-protocols-review-and-prep.test.ts, docs/workflow-handoffs.md, tests/handoff-contract.test.ts, tests/fixtures/handoffs/, CLAUDE.md_
_blocked-by: Track 29A, Track 69A_
**Scheduling:** Land the main review speed improvements before optimizing release-only proof. **Reach, stated for the owner (2026-11-03):** the full-run credit and the pregate-selection allowance apply under `full-suite=final`, while this project's own reviews run under `full-suite=external` (PRs #191 to #196), so as written they would not shorten this project's releases. Whether the opt-in should also cover `full-suite=external` is settled at planning; the card's scope is unchanged. The mechanical proof and the full-run credit were two Tracks under the card-size rule; the credit edited the same ship-and-land and handoff files and consumed the proof's eligibility result, so the two would have run one after another anyway. Merged into one card under the rule's same-files exception (owner direction, 2026-10-26) and kept at ~520 lines for that reason: splitting it would cost a second full pipeline run for no parallelism.
_Source: program E7 / research R7; owner-approved release-only full-run credit, 2026-10-26_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Integrate mechanical eligibility** -- Record the exact upstream source and helper result, retain required checks and receipt compatibility, and demonstrate valid version-only changes versus invalid hunks without authoring any consumer ship policy. _~210 lines._ (M)
- **Credit a prepared full run across a release-only delta** -- Under the opt-in value, accept a verified full run of the prepared head plus the release-delta selection at Verification Gate (16); add the opt-in per-repository release-file list as a documented project setting; state that rule (only an opted-in release-only delta over a credited full run skips the full rerun, and any other or unknown change still runs it); update the handoff grammar and this repository's release-selection note in `CLAUDE.md`. _~230 lines incl. tests._ (M)
- **Let a verified pregate selection stand when the main command does not select** -- Under the same opt-in and `full-suite=final`, let preparation's verified pregate selection (complete selection retained, tests ran) satisfy its main-suite run when the main command is not a selector, instead of the full main command; partial or unknown coverage keeps today's rule. _~80 lines incl. tests._ (S)

### Group 71: Machine-readable planning artifacts

_Depends on: Group 70_

**This group delivers:** Validated upstream-compatible decisions and findings artifacts alongside the current lean sidecar.

##### Track 71A: Publish upstream-schema lean planning artifacts
_1 tasks . ~240 LOC incl. tests . medium risk_
**Outcome:** An orchestrator can inspect decisions and findings without parsing the review prose.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25; O4 compatible artifacts.
**Done when:** decisions.jsonl and findings.jsonl validate with installed upstream schemas, carry auto/approval/user_challenge decisions and attributed findings beside the sidecar, and remain consistent on sealing, retries and phase replacement; existing prompt/handoff consumers are unchanged.
_touches: src/autoplan-lean/sidecar.ts, src/autoplan-lean/cli.ts, src/autoplan-lean/history.ts, skills/autoplan-lean.md, docs/workflow-handoffs.md, tests/autoplan-lean.test.ts, tests/autoplan-lean-history.test.ts, tests/skill-protocols-autoplan-lean.test.ts_
_blocked-by: Track 29A, Track 32B, Track 70B, Track 70A_
**Scheduling:** Land direct test, audit, review and shipping efficiency changes before the planning-artifact producer.
_Source: program E9 / research R10_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Emit and validate machine artifacts** -- Map the current sidecar semantics to upstream schemas; preserve IDs and source provenance and report unknowns; bind records to the sealed plan/review without inventing decisions or adding a parallel format. _~240 lines._ (M)

### Group 72: Supporting contracts and equal host acceptance

_Depends on: Group 65, Group 66, Group 71_

**This group delivers:** A stable-interface catalog, evidence/recovery design and independent qualification on both hosts.

##### Track 72A: Publish the stable compatibility and recovery catalog
_1 tasks . ~180 LOC incl. tests . medium risk_
**Outcome:** Public users can identify stable interfaces, experimental exclusions and recovery obligations.
**Supports:** [SPEC](SPEC.md) O5.1; preserved required inbox obligation, 2026-10-23
**Done when:** A catalog names every promised surface, version/compatibility rules, support conditions and recovery links; stage-runs v2 is one checked example, not the whole catalog. Experimental surfaces stay explicitly excluded; no checkpoint is awarded by documentation alone.
_touches: docs/compatibility.md (new), docs/SPEC.md, README.md, docs/installation.md_
_blocked-by: Track 28A, Track 71A_
**Scheduling:** The stable-interface catalog remains a 1.0 obligation but does not delay the selected efficiency work.
_Source: [plan-ceo-review] stable compatibility surfaces (O5.1)_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Catalog the promised surfaces** -- Trace CLI/config, skills, handoffs, provenance and install ownership against shipped code and public instructions. Carry the existing stable promises and disclose unknown qualification; retain O5 acceptance as an owner gate. _~180 lines._ (M)

##### Track 72B: Qualify the complete Conductor workflow and cross-session handoffs
_1 task . ~200 LOC incl. tests . medium risk_
**Outcome:** Conductor receives the same supported workflow and recovery guarantees as Paseo.
**Supports:** [SPEC](SPEC.md) O1/O3/O4 — equal priority requires current host evidence in addition to legacy usage.
**Done when:** A named release/profile has fresh install, upgrade/recovery, real plan-to-authorized-release, interrupted resume, manual-testing pause, full-review restart and cross-session handoff evidence; unknown model evidence remains unknown.
_touches: docs/acceptance/conductor.md (new)_
_blocked-by: Track 26A, Track 23I, Track 23A, Track 23G, Track 28A, Track 26B, Track 65A, Track 66A, Track 66B, Track 71A_
**Scheduling:** Retain broad host qualification after the direct efficiency changes and planning artifacts; moving telemetry earlier does not move or waive this acceptance gate. The update-check edge keeps the upgrade qualification on the final upgrade behavior.
- **Exercise the supported Conductor profile** -- Run the same outcome matrix as Paseo using actual Conductor workspaces and the supported Codex, Cursor and Claude stage routes. Verify action receipts/final output, preserved work and stable artifact bindings after changing sessions. Include stale/partial/held controls and the SQLite store-reader fix from Track 23G, with its still-open owner gate: T42 native receipt 2 on an installed release and the 2-5 minute row-interpretation check (O4 stays unawarded until the owner confirms), plus the open owner note on receipt 1's expected effort. Include the installed Conductor host-attribution check the user deferred from Track 26A (DFR1). Record versions, operator interventions and sanitized receipts. At least one of the two onboarding attempts must be followed independently of the maintainer; do not claim cross-host or provider support from fixtures alone. _~200 documentation lines._ (L)
**Include installed `/docs-ship` acceptance** -- Run a real docs-only PR on Conductor through classification, a no-write classification hand-back, selected tests once, same-tree test-record reuse, final receipt hash, policy bump and `docs-ship/v1` without merging. Across the two host records include one Sonnet-class run and one `/roadmap` handoff; compare work/wait wall time with a recent docs PR shipped through the ordinary path. Source: `[manual] Qualify /docs-ship on a real docs-only PR on both workspace hosts`, 2026-10-23. This is part of the one host qualification task, not another release authorization.

##### Track 72C: Qualify the complete Paseo workflow and external handoffs
_1 task . ~200 LOC incl. tests . medium risk_
**Outcome:** Paseo users and an external orchestrator can carry real work through the supported stages.
**Supports:** [SPEC](SPEC.md) O1/O3/O4 — workspace guard wording is shipped, but end-to-end host and consumer acceptance is not established.
**Done when:** A named release/profile has fresh install, upgrade/recovery, real plan-to-authorized-release, interrupted resume, manual-testing pause, full-review restart and external-consumer handoff evidence; pending approvals or failures remain holds.
_touches: docs/acceptance/paseo.md (new)_
_blocked-by: Track 26A, Track 23I, Track 23A, Track 28A, Track 26B, Track 65A, Track 66A, Track 66B, Track 71A_
**Scheduling:** Retain broad host qualification after the direct efficiency changes and planning artifacts; moving telemetry earlier does not move or waive this acceptance gate. The update-check edge keeps the upgrade qualification on the final upgrade behavior.
- **Exercise the supported Paseo profile** -- Use the actual host-managed worktree and approved accounts with Codex implementation, Cursor review and Claude planning/release where supported. Retain the bound PR and worktree, test stale/partial/held handoffs, confirm next-stage consumption from artifacts, and count operator interventions. Include the installed Paseo host-attribution check the user deferred from Track 26A (DFR1). The real external consumer may stop at a ready PR; a separate authorized human-driven run proves landing. Confirm independent onboarding across the two host qualification Tracks. No consumer-repo edits, new spend, unattended release or acceptance-by-idle-status. _~200 documentation lines._ (L)
**Include installed `/docs-ship` acceptance** -- Run a real docs-only PR on Paseo through classification, a no-write classification hand-back, selected tests once, same-tree test-record reuse, final receipt hash, policy bump and `docs-ship/v1` without merging. Across the two host records include one Sonnet-class run and one `/roadmap` handoff; compare work/wait wall time with a recent docs PR shipped through the ordinary path. Source: `[manual] Qualify /docs-ship on a real docs-only PR on both workspace hosts`, 2026-10-23. This is part of the one host qualification task, not another release authorization.

##### Track 72D: Specify portable review evidence and capped-review recovery
_2 tasks . ~220 LOC incl. tests . medium risk_
**Outcome:** Callers know what proves a completed full review and how a stopped draft can reach shipping.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25; O4 provenance and O3 stop preservation.
**Done when:** A supporting design maps review facts to a portable evidence-bundle reference and independently checks review-log full-scope/completion/convergence/binding predicates. Documentation walks stopped draft → authorized exact repair-only continuation → prepared readiness → ship with all unavailable evidence and continuation counts preserved, including a stop after a first cycle that reproduced defects; it cites the already recorded rule that `/ship-and-land` keeps refusing a stopped draft, including one whose receipt says `Unresolved: none recorded` (`B-STOPPED-NONE-RECORDED`). No envelope runtime or stop bypass is introduced.
_touches: docs/designs/review-evidence-envelope.md (new), docs/workflow-handoffs.md_
_blocked-by: Track 29A, Track 71A, Track 30A, Track 32A_
**Scheduling:** Preserve the evidence design and capped-review recovery work after the direct savings and artifact producer; the artifact producer edge is priority ordering, not a claimed technical prerequisite. The capped-review repair and baseline-repair edges are technical: the documented recovery path must describe the shipped repair-only continuation, including after a first cycle that reproduced defects. This Track specifies and checks the cycle 1 baseline record and does not write it.
_Source: program E10–E11 / research R11 and observed capped-review stops_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Map the existing upstream proof** -- Compare commit_full/tree/scope/completed/converged/cycles plus review_binding and verified/imported lane semantics; specify missing/stale/unavailable cases and identify gaps without claiming nonconverged full scope is a completed baseline. _~150 lines._ (M)
- **Document the recovery path** -- Use the stop receipt's own repair-only prompt and remaining budget, which the capped-review and baseline repairs make reachable after a completed first cycle, preserve the bound PR, and show why shipping cannot replace the continuation, including for a receipt that says `Unresolved: none recorded`. Keep manual holds and Full-review evidence: unavailable explicit. _~70 lines._ (S)

### Group 73: Workflow efficiency baseline and decisions

_Depends on: Group 67, Group 72_

**This group delivers:** A reproducible cross-run baseline report and an adopt, reject or insufficient-evidence decision for each optimization.

##### Track 73A: Build a comparable workflow-efficiency baseline and evaluate each optimization
_3 tasks . ~440 LOC incl. tests . medium risk_
**Outcome:** The maintainer can reproduce an offline report that separates model work, tool/CI/human waits, reuse and rework across runs, and gets an evidence-backed decision for each proposed optimization, including a valid conclusion that a change is not worthwhile or that evidence is insufficient.
**Supports:** [SPEC](SPEC.md) P1 and owner-selected investigation, 2026-10-19; empirical model comparison and review-policy changes remain outside the 1.0 acceptance gates.
**Done when:** A reproducible offline report from sanitized projections separates DOCS/FULL/release-only paths, diff/task size, repo/host, skill version, waits and fresh versus resumed runs, and reports sample size and missingness; fixtures cover each split. Each candidate has measured evidence or a named evidence gap; comparisons include total parent/child usage, quality and capture overhead; each candidate gets adopt, reject or insufficient evidence with its follow-up mapped to existing Future items. No review gate or model choice changes, and no model downgrade or review gate is changed by the study itself.
_touches: scripts/workflow-efficiency-report.py (new), tests/workflow-efficiency-report.test.ts (new), tests/fixtures/workflow-efficiency/ (new), tests/helpers/touchfiles.ts, docs/acceptance/workflow-efficiency.md (new)_
_blocked-by: Track 67A, Track 52A, Track 72A, Track 72D, Track 72B, Track 72C_
**Scheduling:** Keep the cross-run efficiency assessment after the selected changes and host-qualification work; individual changes still need their own before/after evidence before activation. The baseline report and the evaluation were two Tracks under the card-size rule; the evaluation edited the same script, test and fixture files and read the report the baseline builds, so the two would have run one after another anyway. Merged into one card under the rule's same-files exception (owner direction, 2026-10-26) and kept at ~440 lines for that reason: splitting it would cost a second full pipeline run for no parallelism.
_read-first: docs/telemetry.md, docs/quota-ledger.md, docs/designs/review-independence.md_
- **Build a comparable baseline** -- Produce an offline report from sanitized projections. Separate DOCS/FULL/release-only paths, diff/task size, repo/host, skill version, waits and fresh versus resumed runs; report sample size and missingness. Reuse eligible existing release-only receipts and preserve the separate first-installed-no-CI timing obligation and 15-minute target. Report time to push and merge gate separately from human approval. Observational differences are not causal model comparisons. _~180 lines._ (M)
- **Assess the uncertain efficiency choices** -- Compare smaller models and lower effort for bounded drafting/extraction versus the main runner, including launch/context-transfer and parent-correction costs. Investigate repeated plan extraction, evidence reads, long-suite reruns, section loading, parallel scheduling and each reviewer voice's unique accepted findings. Use the existing eval/benchmark facilities where suitable; define corpus, quality bars, fixed budgets and stop rules before any model trial. Include known-defect controls and false positives; a saved success flag is not quality evidence. This Track authorizes offline analysis; any new paid/API trials need a separately approved concrete pilot and spend bound. _~180 lines._ (M)
- **Publish decisions and follow-up ownership** -- For each candidate give adopt/reject/insufficient-evidence, expected benefit, observed limitations and the smallest follow-up scope. Map recommendations to existing Future items rather than duplicating them: lifecycle helper, eval persistence, vendor diversity, the delta-scoped review default and on-demand `/review-and-prep` section loading. Preserve the independent historical review-independence study and its unfulfilled evidence obligations. An insufficient-evidence result names missing data and a bounded next measurement; it never silently removes a review or acceptance gate. _~80 lines._ (S)


### Execution Map

A Group may launch when every Group in its dependency set has landed;
document order is not an additional gate. The cards label priority choices
separately from technical prerequisites. Adjacency below is the packer's
DEPENDS output with bin numbers replaced by the assigned Group numbers.

```
- Group 65 ← {}
- Group 66 ← {65}
- Group 67 ← {65, 66}
- Group 68 ← {66, 67}
- Group 69 ← {68}
- Group 70 ← {69}
- Group 71 ← {70}
- Group 72 ← {65, 66, 71}
- Group 73 ← {67, 72}
```

**9 Groups / 15 Tracks remaining.** None is In Progress; all 9 Groups are in
the Current Plan.

The published-upgrade obligation remains open and is not waived; its revisit trigger has been met and it awaits owner reassessment. Only owner-confirmed acceptance in PROGRESS can satisfy a stage/checkpoint.


## Future

Deferred: docs/roadmap-future.md (73 items)

## Shipped

History: docs/roadmap-shipped.md
