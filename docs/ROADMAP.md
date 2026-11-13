# Roadmap

Organized by lifecycle state: **In Progress**, **Current Plan**, **Future** and
**Shipped**. A Track is one PR/session. The packer assigns Groups of disjoint
file footprints and their launch dependencies. Explicit scheduling edges carry
the owner's priority order, and each card's **Scheduling:** line separates its
priority choices from technical prerequisites.

**Spec revision, 2026-11-07.** The owner revised [SPEC](SPEC.md): 1.0.0 is the
owner's own real use, by hand and through an orchestrator, and the public
release (the owner's "2.0") is the next stage; no single workspace host is
required, because a published orchestration contract (O4) says what a host or
orchestrator must provide, and O3 is evidenced by two real drivers; bounded,
measured stage effort is outcome O6. The owner's answers that shaped this plan
(2026-11-07): "1 - a", "2 yes", "3 yes", "70b yes future", "71a yes kill",
"70a ok", "72c ok", "72a confirm" and "72d confirmed as well", using that day's
labels. The pair-review redesign ("pair-review design: yes"), the Codex sandbox
fix ("let's do everything under our control though to resolve this") and the
retirement of `/autoplan-lean` ("yes, kill autoplan-lean") were approved the
same day, as were capturing the owner's hand use in telemetry ("we need to make
sure telemetry captures my use by hand") and labelled release-note disclosures
in plans and review handoffs ("sure if necessary").

**Order.** The owner's first priorities (2026-11-08: "contract gaps and
attacker parts is first priorities") have shipped, and so has most of the review
run-state redesign (owner, 2026-11-10: "2 sure", then "yes re: card rewrite"):
the workspace signal (Track 76A, v0.84.0), the compatibility catalog (77A,
v0.85.0), the run-state design and helper (76B, v0.86.0), its skill wiring and
derived telemetry (77B, v0.87.0–v0.89.0), rendering (78A, v0.90.0–v0.92.0) and
resume (79A part 1, v0.93.0). The owner split Track 79A on 2026-11-13 ("1 -
approved", "2 - sounds good"); its part 2 is now four Tracks: helper hardening
(81A), the measurement and default decision on real runs (81B), and, only if
that decision adopts the recorded path, the default-promotion items (82A) and
the default with the slimmer skill (83A). Track 80A comes first because three of
the first five real opted-in reviews lost their run state, so the runs 81B
waits for cannot be recorded until it lands. The two-driver workflow
qualification (Track 84A) stays behind the run-state Tracks, as the owner chose
("Wait for run-state"), then the O6 measurement and decisions (Track 85A) beside
the stable update channel the owner placed "right before 1.0" (Track 85B), then
aligning install and upgrade with gstack (Track 86A). Secret-disposition
requalification (Track 80B) can start now. The owner-run records (Tracks 80C
and 80D) can run whenever the owner has time; only 80C gates anything (Track
85B, which appends to its record). Owner, 2026-11-08: "A but keep 72c and 78a
for 1.0", approving a proposal that moved the review-finding records to Future
and kept docs-only test selection (since shipped) and the gstack alignment (now
Track 86A) as 1.0 work.

**Keep moving; park only what we should not do.** Owner rule (2026-11-05): "we
never want to 'park' something -- we always want to find a way to keep moving
forward". A stalled or blocked Track is unblocked, split or rerouted, not set
aside. "parking is an option when it turns out we shouldn't even do a track,
because it's counter to our objectives, then it would make sense to park and
re-evaluate".

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

**Labels.** This regeneration (2026-11-13) recorded Tracks 76A, 76B, 77A,
77B, 78A and 79A (part 1), numbered six merged changes that carried no Track ID
as 77C–77H, retired Groups 76–79 by tombstone and relabelled the remaining work
from Group 80 in packer order; the renames are in its commit message. Shipped
numbers through 79 are reserved by tombstones; 64 was never a roadmap Group.

Target: [SPEC](SPEC.md) O1–O6, 1.0.0 as the owner's own real use by hand and
through an orchestrator; audience ceiling potentially-public. No workspace host
or orchestrator is required; support claims name only exercised combinations.
Implementation, installed/operator evidence and owner acceptance remain
distinct. No new spend or unattended merge is authorized.

## In Progress

No Track is in flight and none is declared active. Tracks 76A, 76B, 77A, 77B, 78A and 79A (part 1), and six merged changes without a Track ID (now 77C–77H), shipped since the last regeneration and are recorded in shipped history. O1 and O3–O6 remain pending; O2 was accepted on 2026-10-23.

## Current Plan

_tombstone: 17, 19, 20, 22, 23, 24, 25, 26, 28, 29, 30, 31, 32, 33, 47, 48, 49, 50, 51, 52, 57, 58, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79_

### Group 80: Run-state recording fix ∥ secret-disposition requalification ∥ owner-run records

_Depends on: none_

**This group delivers:** Opted-in reviews with delegated parts that keep their run state; secret dispositions that work against the installed upstream scanner, with no consumer project named in the shipped fixture; and, whenever the owner runs them, the install/upgrade/recovery qualification and the dated records of real review runs and hand-use telemetry.

##### Track 80A: Let opted-in reviews with delegated parts record their run state
_3 tasks . ~170 LOC incl. tests . medium risk_
**Outcome:** An orchestrated `/review-and-prep` run that sends both `run-state=record` and a `delegate=` value records its run state instead of falling back inline, so the real opted-in runs that the default decision (Track 81B) measures can exist.
**Supports:** [SPEC](SPEC.md) O6.1 (complete stage records, unavailable values explicit) and P1 (before and after on real runs); the owner's 79A split ("1 - approved") makes those runs the gate for Track 81B. Manifested: three of the five opted-in invocations recorded since v0.89.0 (the reviews of PRs #248, #249 and #250) report `Run state: unavailable (invalid-input…)`, PR #249's naming `start policy.delegation.parts`. Their `start` passed the policy line's part names (`maintainability,adversarial,red-team`, or the receipt's `delegation: active (…)` text) where the helper accepts only its attribution labels (`specialist:maintainability`, `native-adversarial`, `red-team`: `PART_RE` in `src/review-state/state.ts`); PR #247's review, which passed those labels, recorded.
**Done when:** (1) A `start` built from the policy line an orchestrator actually sends (`delegate=maintainability,adversarial,red-team` with `run-state=record`) records, and delegated attempts, `found_by` and the rendered `delegation: active (…)` and `Delegated part:` lines stay byte-compatible; the mapping from policy-line part names to the helper's labels is done in the helper or stated exactly in `docs/review-run-state-calls.md` (the plan chooses, under CLAUDE.md's mechanics-in-helpers rule), with a refusal case for an unknown part. (2) The recorded test gaps in its tasks have tests. (3) The release notes disclose the fix.
_touches: src/review-state/state.ts, tests/review-state.test.ts, docs/review-run-state-calls.md, tests/skill-protocols-review-and-prep.test.ts_
_blocked-by: Track 79A_
**Scheduling:** Startable now (its edge is on shipped part 1). First in the run-state chain because the after-runs Track 81B counts cannot be recorded while orchestrated reviews delegate parts. Shares `src/review-state/state.ts` and `tests/review-state.test.ts` with Track 81A, which follows it.
_Source: this regeneration's read of the opted-in full receipts (2026-11-12 and 2026-11-13; `Run state:` lines) and of `PART_RE`, verified@31f59ad; recorded test gaps `[review:files=src/review-state/state.ts|tests/review-state.test.ts]` (PR #238's review, 2026-11-10, and PR #250's, 2026-11-13)._
_read-first: docs/review-run-state-calls.md, docs/designs/review-run-state.md_
- **Map delegated parts at start** -- Accept the orchestrator's policy line under `run-state=record`, with a fixture of the real line and a refusal case. _~90 lines incl. tests._ (M)
- **State-validator refusal test gaps** -- Attempt and finding semantic refusals, voice-selection refusals and correction-chain refusals, each breaking one relationship while shapes stay valid; re-verify each contract first. _~40 lines._ (S)
- **Resume and finish test gaps** -- Finish ancestry and checkpoint-field refusals, and the interrupted end timestamp across helper record kinds with its segment-start fallback; re-verify each contract first. _~40 lines._ (S)

##### Track 80B: Requalify secret dispositions on the installed upstream and retire the consumer-named draft
_4 tasks . ~200 LOC incl. tests, plus ~60 deleted lines . medium risk_
**Outcome:** A pregate secrets failure on the installed upstream can again be checked against the reviewed dispositions instead of returning unavailable evidence, and the shipped fixture and design folder no longer name a private consumer project.
**Supports:** [SPEC](SPEC.md) O3.1–O3.2 (the review stage completes without a needless owner stop; approval rules unchanged) and the `CLAUDE.md` consumer-independence rule, owed before 1.0. Manifested: with installed gstack 1.99.2.0 the evaluator reads added-line `text` where upstream now returns `texts`, so a failing secrets record exits 2 with unavailable evidence (PR #248's continuation preflight and earlier opt-in pregate cases); the opt-in installed-scanner fixture expects three matches and gets two.
**Done when:** (1) `bin/secret-dispositions` reads the installed upstream's added-line shape (and the earlier shape, or refuses it with a named reason), keeps fail-closed behavior, and has a fixture of each shape; the opt-in installed-scanner fixture passes against the installed scanner or records the version it is qualified on. (2) The recorded secret-dispositions test gaps in its tasks have tests. (3) `docs/designs/secret-scanner-upstream-issue.md` is deleted (the owner files no upstream requests) with its pointer in `docs/secret-dispositions.md`, and the consumer project's file path and code line in `tests/secret-dispositions.test.ts` are reworded generically, keeping the fixture's shape; the CHANGELOG mention stays with its Future entry.
_touches: src/secret-dispositions/evaluate.ts, src/secret-dispositions/cli.ts, src/secret-dispositions/scan-text.ts, tests/secret-dispositions.test.ts, docs/secret-dispositions.md, docs/designs/secret-scanner-upstream-issue.md_
**Scheduling:** No edges; startable now. Combines the inbox requalification item with three Future entries on the same files.
_Source: inbox `[review:files=src/secret-dispositions/cli.ts|src/secret-dispositions/evaluate.ts|tests/secret-dispositions.test.ts]` (PR #248, 2026-11-13, owner "2 yes"); the Future entries "Requalify the opt-in installed-scanner fixture count", "Retire the draft upstream secret-scanner issue" and the fixture and draft parts of "Remove a consumer project's name from release text and fixtures" (owner brief, 2026-11-01), promoted because this Track's `_touches:` meet their triggers; recorded test gaps from PR #248's review._
_read-first: docs/secret-dispositions.md_
- **Read the installed added-line shape** -- Requalify evaluation against installed gstack's pregate record, keeping fail-closed results. _~90 lines incl. tests._ (M)
- **Requalify the installed-scanner fixture count** -- Rerun the opt-in fixture against the installed scanner and update or version-qualify its expectation. _~20 lines._ (S)
- **Secret-dispositions test gaps** -- Filesystem and scanner refusal paths, the scratch-root rule with an existing directory, repeated finding keys in the multiset comparison, installed-scanner offsets after astral and punctuation prefixes, and the masked scan file's modes and basename; re-verify each contract first. _~70 lines._ (S)
- **Retire the draft and the consumer name** -- Delete the draft and its pointer, and reword the fixture's file path and code line. _~60 lines (del)._ (S)

##### Track 80C: Qualify install, upgrade and recovery on the owner's machines
_2 tasks . ~160 LOC . medium risk_
**Outcome:** The owner can install, onboard, upgrade and recover a working skill set on a fresh machine from the published instructions, with evidence of what was actually installed.
**Supports:** [SPEC](SPEC.md) O1 (all three criteria) and O5.2; the preserved published three-part upgrade obligation from Track 28A planning (2026-10-23), whose trigger was met by v0.48.0.
**Done when:** A dated record names the OS, host, harnesses and versions of a fresh install and project onboarding on the owner's machine, actionable failures for a missing prerequisite, an upgrade with user-owned files preserved and stale copies reported, a working recovery path, and a real legacy four-part install upgraded through the default remote with offered and installed commit/tag identity, reader compatibility and unchanged user state; it records the actual installed commit and discloses that upgrade offers follow main rather than a release identity; failures stay open; the owner confirms before O1 counts.
_touches: docs/acceptance/install-upgrade.md (new)_
_blocked-by: Track 70A, Track 28A_
**Scheduling:** Technical edge on Track 70A (shipped, v0.72.0): the qualified upgrade includes removing the retired skill. Candidate or file-remote proof does not satisfy the published-upgrade obligation. It waits on the owner's time and gates only the stable-channel Track 85B, which appends to its record.
_read-first: docs/installation.md, docs/acceptance/release-compatibility.md_
- **Fresh install, onboarding, upgrade and recovery** -- Run them on the owner's machine from the published instructions and record each step, intervention and result. _~90 lines._ (M)
- **Published three-part upgrade from a legacy install** -- Upgrade a real four-part install through the default remote and record offered and installed identity, reader compatibility, recovery and unchanged state beside `docs/acceptance/release-compatibility.md`. _~70 lines._ (M)

##### Track 80D: Record the owner's real review runs and hand use
_4 tasks . ~140 LOC . low risk_
**Outcome:** The owner can see from dated records that a by-hand review with no caller lines still runs as before, that the attacker parts run with per-part models when an orchestrator delegates them, that tools-mode delegation works on an installed release, and that telemetry counts the stages run by hand on each machine as `user-directed` and an orchestrated run as `orchestrated`.
**Supports:** [SPEC](SPEC.md) O6 and the optimization evidence rules (P1), O6.1 and O3.3 (the by-hand driver's evidence) and O4.4. The open acceptance of Track 72B (code merged in PR #221, v0.75.0; its receipt verified the dated-record criterion only within the PR, with PM1 and PM2 "post-merge"), the post-release run (PM1) of the owner-approved tools-mode plan (PR #229, v0.81.0), and the open acceptance of Track 73A (code merged in PR #226, v0.77.0; real runs PM1–PM4 "explicitly post-release"). Owner, 2026-11-07: "we need to make sure telemetry captures my use by hand".
**Done when:** (1) `docs/acceptance/attacker-parts.md` records PM1 (one real by-hand `/review-and-prep` with no `Review policy:` or `Review delegates:` line, read back as unchanged) and PM2 (one orchestrated run with `delegate=adversarial,red-team` mapping the two parts to different providers or models, with its `Delegated part:` lines, v3 attempts, `found_by` labels and any fallbacks), each with date, revision, host and harness versions and PR. (2) `docs/acceptance/delegate-tools-mode.md` records its PM1 installed run and names the exact reviewed content its earlier dry-run evidence covers. (3) `docs/acceptance/hand-use-telemetry.md` records real by-hand runs on each of the owner's machines read back as `user-directed` (the Paseo entrypoint, and `cli` where the owner uses it) and one orchestrated interactive run read back as `orchestrated`, through `gstack-extend-telemetry report --by-host`, without session ids, paths or repository names; its `Status:` line and the pending notice in `docs/telemetry.md` change only when every required row is recorded. (4) A failed, unavailable or wrongly read-back run stays recorded as open, never as passed, and a wrong read-back is filed as a defect.
_touches: docs/acceptance/attacker-parts.md, docs/acceptance/delegate-tools-mode.md, docs/acceptance/hand-use-telemetry.md, docs/telemetry.md_
**Scheduling:** No edges; it gates no other Track. One set of runs feeds every record: the by-hand review for attacker-parts PM1 is also a by-hand stage for the hand-use record, and the orchestrated PM2 review is also its orchestrated interactive row. The orchestrator sets `GSTACK_EXTEND_RUN_MODE=orchestrated` on every stage it launches (cutover about 2026-11-09 15:58Z, as recorded in the hand-use acceptance record). PR #250's receipt (2026-11-13) delegated red-team and adversarial to different providers and models (`gemini-4-carbon-high` and `claude-opus-5-5`), so that orchestrated review may supply PM2's row; PRs #231 and #234 did not meet that condition.
_Source: Track 72B's preparation receipt (PR #221) and `docs/acceptance/attacker-parts.md` (PM1 and PM2 pending); PR #229's user-deferred criterion AC7 and the inbox item "Delegate tools: Refresh visible qualification provenance and finish PM1 after release" (`[review:files=docs/acceptance/delegate-tools-mode.md]`, 2026-11-09); Track 73A's preparation receipt (PR #226) and `docs/acceptance/hand-use-telemetry.md` (status pending, no rows)._
_read-first: docs/delegated-review.md, docs/telemetry.md_
- **Attacker parts PM1 and PM2** -- Run and read back one by-hand review with no caller lines and one orchestrated review with per-part models; record each row. _~50 lines._ (S)
- **Tools-mode PM1 and provenance** -- Run tools mode on the installed release, record the result and name the content the committed dry-run record covers. _~40 lines._ (S)
- **By-hand runs on each machine** -- Read back what the report shows for the owner's by-hand stages on each machine, reusing the PM1 review where it applies. _~30 lines._ (S)
- **One orchestrated interactive run** -- Read back one post-cutover orchestrated interactive stage (the PM2 review can serve), record it and update the status and pending notice once every row exists. _~20 lines._ (S)

### Group 81: Review-state helper hardening ∥ run-state measurement and default decision

_Depends on: Group 80_

**This group delivers:** A review-state helper hardened for unattended use with an example in every command's help, and a measured adopt, reject or insufficient-evidence decision on making the recorded run state the review default.

##### Track 81A: Harden the review-state helper and show an example in each command's help
_5 tasks . ~280 LOC incl. tests . medium risk_
**Outcome:** The review-state helper removes leftover temporary files, syncs its directory after each write, refuses a write whose evidence file changed while it waited for its lock, and shows an example request in each command's help, so a skill pointed at `--help` contracts can rely on it.
**Supports:** [SPEC](SPEC.md) O3.2 (no lost records) and P1 (necessary safety prerequisites kept before any default change); the owner-approved 79A part 2, 2026-11-13 ("2 - sounds good", which moved this hardening there), and design D14.
**Done when:** (1) Item 4 of the owner-approved part-2 card holds: a temp-file sweep under the lock after a recorded command (replayed and refused commands sweep nothing), a directory fsync after rename (a failure is a warning), an evidence size and mtime recheck under the lock that refuses `invalid-input` with rule `evidence-changed`, and an `Example:` line for every `REQUEST_SHAPES` and `RENDER_SHAPES` key plus one example command for `export --help` and `show --help`, each example parsing as JSON with only allowed keys; interrupted-start recovery, concurrent-writer serialization, lock-init cleanup and the D3 commit point are unchanged, with the card's proving tests. (2) The recorded test gaps in its tasks have tests. (3) `docs/designs/review-run-state.md` marks these D14 items done and replaces D9's stale locator (`docs/workflow-handoffs.md` `### PR body status vocabulary`, a heading that no longer exists) with the current one. No default changes.
_touches: src/review-state/store.ts, src/review-state/state.ts, src/review-state/render.ts, src/review-state/cli.ts, src/review-state/show.ts, tests/review-state.test.ts, docs/designs/review-run-state.md_
_blocked-by: Track 80A_
**Scheduling:** Technical edge on Track 80A, which edits `src/review-state/state.ts` and `tests/review-state.test.ts` first. It needs no real runs, so it lands while Track 81B's evidence accumulates; Track 83A's slimming needs its help examples.
_Source: owner-approved card "Track 79A (part 2)", item 4 (2026-11-13); inbox doc-audit note on D9 (PR #238, 2026-11-11); recorded test gaps `[review:files=src/review-state/…]` from the reviews of PRs #238, #242, #247 and #250._
_read-first: docs/designs/review-run-state.md_
- **Sweep, sync and recheck under the lock** -- The three `executeCommand` changes in `src/review-state/store.ts` with their proving tests. _~120 lines incl. tests._ (M)
- **Per-command help examples** -- `REQUEST_EXAMPLES` beside `REQUEST_SHAPES`, render examples beside `RENDER_SHAPES`, the `Example:` lines and the D9 locator fix. _~50 lines._ (S)
- **Store fault and VERSION-guard test gaps** -- Temporary write, fsync and rename failures and post-commit lock-removal failure; nonregular and oversized VERSION files. _~40 lines._ (S)
- **Flag-refusal test gaps** -- Duplicate, missing-value and unknown flags with exact error envelopes across `start`, `render` and `show` (including `--base` and `--wtree`). _~30 lines._ (S)
- **Show test gaps** -- An applicable unselected voice reads `open`, repeated gate and audit names keep the latest value in first-seen order, tampered implicit evidence reads `evidence_ok: false`, corrected dispositions are suppressed, and rendered discovery handles excluded entries, several prefixes and an enumeration failure. _~50 lines._ (S)

##### Track 81B: Measure the recorded run-state path on real runs and decide its default
_2 tasks . ~120 LOC . low risk_
**Outcome:** The owner can read, from real opted-in runs, whether recording the review run state cut bookkeeping cost while keeping every output and finding, and see an adopt, reject or insufficient-evidence decision on making it the default.
**Supports:** [SPEC](SPEC.md) O6.2–O6.3 and P1 (a default changes only on measured evidence; individual optimizations do not gate 1.0); efficiency-program candidate E15; the owner-approved 79A part 2, 2026-11-13 ("1 - approved").
**Done when:** (1) `docs/acceptance/review-run-state.md` records E15's before figures and after figures from real opted-in runs within E15's bound (at least four, two by hand by the owner and two orchestrated, within six weeks of Track 78A's release in v0.92.0, so by about 2026-12-25), measured with the same caller-owned scripts identified by digest, with sample size, unknowns, each segment's record completeness and the adoption threshold the owner set before the after-runs started; it also reports what the opted-in reviews asked to measure: capture lost when the first derive cannot bind, whether a helper-missing activation suppresses Step 1's spans, the always-loaded pointer and fence overhead, and the installed caller journey (activation, start and derive, voice and probe records, pause and resume, degraded capture, finish) with unchanged outward lines. (2) The record states adopt (the recorded path becomes the default through Tracks 82A and 83A), reject, or insufficient evidence naming the missing data and a bounded next measurement, and decides whether a default needs per-record `seq` and `input_sha256` or records them as dropped with the reason. No default changes in this Track.
_touches: docs/acceptance/review-run-state.md (new), docs/designs/workflow-efficiency-program.md_
_blocked-by: Track 80A, Track 79A_
**Scheduling:** Technical edge on Track 80A: until it lands, orchestrated reviews that delegate parts lose their state. It also waits on real runs, which no Track supplies: the orchestrator's opted-in reviews and the owner's by-hand ones. If the window closes short of the bound, the record says insufficient evidence. It shares no file with Track 81A and runs beside it.
_Source: owner-approved card "Track 79A (part 2)", items 1, 2 and 5 (2026-11-13); E15 in `docs/designs/workflow-efficiency-program.md`; the opted-in reviews' measurement requests `[review:files=docs/review-run-state-calls.md|skills/review-and-prep.md]` and `[review:files=skills/review-and-prep.md|docs/designs/review-run-state.md]` (PR #244, owner "accept the reviews", 2026-11-12)._
_read-first: docs/designs/workflow-efficiency-program.md, docs/designs/review-run-state.md_
- **Record before and after on real runs** -- The acceptance record with every figure, unknown and requested measurement. _~90 lines._ (M)
- **Decide the default** -- The adopt, reject or insufficient-evidence decision with its evidence, and the `seq` and `input_sha256` decision. _~30 lines._ (S)

### Group 82: Default-promotion prerequisites in the review-state helper

_Depends on: Group 81_

**This group delivers:** If the measured decision adopts the recorded path, a helper that can run unattended by default.

##### Track 82A: Finish the review-state helper's default-promotion items
_2 tasks . ~320 LOC incl. tests . medium risk_
**Outcome:** If Track 81B adopts the recorded path as the default, the helper can run unattended by default: it reclaims stale locks, refuses cross-host state, moves a corrupt state aside, reports internal errors in their own result, and stamps records with `seq` and `input_sha256` if 81B requires them.
**Supports:** [SPEC](SPEC.md) O3.2 (no lost records or work on resume) and P1 (safety prerequisites before a public default); design D14's default-only items, each "required before any default promotion" (owner-approved 79A part 2, 2026-11-13).
**Done when:** Track 81B recorded adopt, and: (1) stale locks are reclaimed automatically; (2) cross-host access is detected and refused, or documented as supported; (3) a corrupt state is moved aside with a result naming it; (4) an internal-error result (exit 5, a trace file, a guarded launcher line) separates Git execution failures (timeout, spawn, signal) from invalid commit input; (5) `seq` and `input_sha256` are added or dropped as 81B decided; (6) the recorded version-ordering test gaps have tests; older helpers' behavior is disclosed in the release notes. If 81B recorded reject or insufficient evidence, this Track does not run, and the regeneration that records 81B moves it to Future with that record as its trigger.
_touches: src/review-state/store.ts, src/review-state/state.ts, src/review-state/cli.ts, tests/review-state.test.ts, docs/designs/review-run-state.md_
_blocked-by: Track 81B, Track 81A_
**Scheduling:** Technical edges: it runs only on 81B's adopt decision, and it edits the files Track 81A hardens. Building these items before the decision would be wasted if 81B rejects the default.
_Source: owner-approved card "Track 79A (part 2)", item 3 (2026-11-13); inbox `[review:files=src/review-state/store.ts]` "Distinguish Git execution failures from invalid commit input at adoption" (PR #238, 2026-11-11); recorded test gaps `[review:files=src/review-state/state.ts|tests/review-state.test.ts]` (PR #242, 2026-11-11)._
_read-first: docs/designs/review-run-state.md_
- **Default-only D14 items** -- Stale-lock reclamation, cross-host refusal, corrupt-state move-aside, the internal-error result and the `seq`/`input_sha256` decision, each with tests. _~290 lines incl. tests._ (L)
- **Version-ordering test gaps** -- Incompatible state when the local helper version is unavailable, and a writer version component above `Number.MAX_SAFE_INTEGER`; re-verify the documented refusal first. _~30 lines._ (S)

### Group 83: The recorded path as the review default

_Depends on: Group 82_

**This group delivers:** If adopted, a judgment-only `/review-and-prep` whose mechanics sit behind helper `--help` contracts, with every published output unchanged.

##### Track 83A: Make the recorded path the default and slim /review-and-prep
_4 tasks . ~210 LOC incl. tests, plus ~600 deleted lines . medium risk_
**Outcome:** With the recorded path as the default, the review skill a reviewer loads holds only judgment, with the mechanics behind helper `--help` contracts, and resumed or degraded runs keep every output.
**Supports:** [SPEC](SPEC.md) O6 and P1 (a public default changes only on measured evidence, keeping published handoffs and receipt formats compatible); the owner-approved 79A part 2 (2026-11-13), which carries the promoted Future entry "Load /review-and-prep's rarely used sections on demand".
**Done when:** Track 81B recorded adopt and Track 82A landed, and: (1) the recorded path is the default and the inline receipt, publication and metrics procedures leave `skills/review-and-prep.md` for helper calls and `--help` references, keeping every handoff label and marker byte-compatible; (2) the caller procedure states the recovery for refusals that carry no ID (an unreadable run state, a cycle-1 pass refusal) and the fallback when the calls document or the derive helper is missing under version skew; (3) the recorded fence and render test gaps have tests; (4) the release notes disclose the default change under the 0.x policy. If 81B did not adopt, this Track does not run and moves to Future with Track 82A.
_touches: skills/review-and-prep.md, tests/skill-protocols-review-and-prep.test.ts, docs/review-run-state-calls.md, src/review-state/render.ts, tests/review-state.test.ts_
_blocked-by: Track 82A_
**Scheduling:** Technical edge on Track 82A: removing the inline mechanics needs the corrupt-state and internal-error recovery D14 requires once they are gone. The deletions are cheap (weight S); session weight 5.
_Source: owner-approved card "Track 79A (part 2)", item 2 (2026-11-13); inbox wording items `[review:files=docs/review-run-state-calls.md|skills/review-and-prep.md]` (PR #244, 2026-11-12); recorded test gaps `[review:files=tests/skill-protocols-review-and-prep.test.ts|skills/review-and-prep.md]` (PR #244) and `[review:files=src/review-state/render.ts|tests/review-state.test.ts]` (PR #247, 2026-11-12)._
_read-first: docs/designs/review-run-state.md, docs/review-run-state-calls.md_
- **Remove the inline mechanics** -- Delete the receipt, publication and metrics procedures the helpers now own. _~600 lines (del)._ (S)
- **Point the skill at the helper contracts** -- Replace each removed procedure with its helper call and `--help` reference, and state the no-ID refusal recovery and the version-skew fallback. _~110 lines incl. tests._ (M)
- **Fence test gaps** -- Malformed fence inputs, the first full cycle-one pass in record order, failed-attempt and not-applicable voice results, and a same-name probe gate on another candidate; re-verify each contract first. _~40 lines._ (S)
- **Render test gaps** -- Remaining field and exit combinations, stale audit and latest-evidence selection, delegated fallback selection, correction folding, formatter refusal envelopes, summary rejection and CRLF normalization, output-name collisions and owned-write failures, and UTF-8 metadata and home-prefix display paths; re-verify each contract first. _~60 lines._ (S)

### Group 84: Two-driver workflow qualification

_Depends on: Group 80, Group 83_

**This group delivers:** Real by-hand and orchestrated workflow evidence on the final stage behavior.

##### Track 84A: Qualify the workflow with two real drivers
_2 tasks . ~240 LOC . medium risk_
**Outcome:** The owner can carry real work through every stage both by hand and through a real external orchestrator, and the evidence shows what the documented contract actually supports.
**Supports:** [SPEC](SPEC.md) O3.3 and O4.5 (reshaped from the Paseo host Track by the owner, 2026-11-07: "72c ok").
**Done when:** A dated record names host, harness and versions for real runs by both drivers (the owner by hand, and one real external orchestrator), each run read back in telemetry with the correct run mode, covering, between them, a complete plan-to-authorized-release workflow, interrupted resume, manual-testing pause/resume, `/full-review` finish/restart, an explicit negative hold, an external-consumer handoff consumed from artifacts, a cross-session handoff and stale/partial/held handoffs; it counts operator interventions and keeps pending approvals or failures as holds; it includes the installed `/docs-ship` acceptance below; no unexercised combination is claimed.
_touches: docs/acceptance/workflow-drivers.md (new)_
_blocked-by: Track 70A, Track 72C, Track 71E, Track 74A, Track 76A, Track 75A, Track 26A, Track 23I, Track 23A, Track 26B, Track 65A, Track 66A, Track 66B, Track 72A, Track 79A, Track 80B, Track 83A_
**Scheduling:** Runs on the final behavior of the stages it qualifies, so it follows every Track that changes them, including the run-state Tracks (80A–83A), whose last one may change `/review-and-prep`'s default, and the secret-disposition requalification (80B); qualifying before them would spend the owner's by-hand runs on behavior about to change (owner, 2026-11-10: wait for the run-state Tracks). If Track 81B does not adopt the default, the regeneration that records it moves Tracks 82A and 83A to Future and this Track follows 81B. The Tracks that only record real runs of shipped code (80C, 80D) do not gate this one; a run here can supply their rows. The external orchestrator may stop at a ready PR; a separate authorized run by hand proves landing. No consumer-repo edits, new spend, unattended release or acceptance-by-idle-status. The independently followed onboarding attempt moved to the public-release stage (Future).
- **Exercise both drivers** -- Use real host-managed workspaces and approved accounts with the harnesses the owner uses for each stage; retain the bound PR and workspace, test stale/partial/held handoffs, confirm next-stage consumption from artifacts across sessions, include the host-attribution check deferred from Track 26A, and count operator interventions. _~200 documentation lines._ (L)
- **Include installed `/docs-ship` acceptance** -- Run a real docs-only PR through classification, a no-write classification hand-back, selected tests once, same-tree test-record reuse, final receipt hash, policy bump and `docs-ship/v1` without merging, and its interactive merge question; include one Sonnet-class run and one `/roadmap` handoff, and compare work/wait wall time with a recent docs PR shipped through the ordinary path. _~40 lines._ (S)

### Group 85: Measured stage cost ∥ stable update channel

_Depends on: Group 80, Group 81, Group 84_

**This group delivers:** Expected cost per stage with an adopt, reject or insufficient-evidence decision for every candidate optimization, the opted-in policy records' after fields filled, and upgrades that follow a stable release channel with a non-interactive auto-upgrade switch.

##### Track 85A: Measure each stage's cost and decide each optimization
_4 tasks . ~500 LOC incl. tests . medium risk_
**Outcome:** The owner can reproduce an offline report of each stage's measured cost (model work, tool/CI/human waits, reuse and rework), read a documented expected cost per stage, and see an adopt, reject or insufficient-evidence decision for every candidate optimization.
**Supports:** [SPEC](SPEC.md) O6.1–O6.3 (owner, 2026-11-07: P1 joins the 1.0 outcomes with this finish line, and this Track gains the expected stage cost).
**Done when:** A reproducible offline report from sanitized projections separates DOCS/FULL/release-only paths, diff/task size, repo/host, run mode, skill version, waits and fresh versus resumed runs, and reports sample size and missingness; fixtures cover each split. A documented expected cost per stage (wall time and model usage, with sample size and unknowns) is published. Each efficiency-program candidate, including first-cycle overlap (69A), fold, delegation, the docs-only selection and the review run-state redesign (E15, whose decision is Track 81B's record), has measured evidence or a named evidence gap and an adopt, reject or insufficient-evidence decision with its follow-up mapped to existing Future items. The after fields that opted-in review-policy records still hold as unknown are filled from real opted-in runs where they exist, or named as evidence gaps: `docs/acceptance/review-fix-policy.md` for Tracks 33A, 51A and 75A (including whether an installed agent judged 75A's shown evidence and post-audit change classes as the skill asks) and the three after wall times in `docs/acceptance/external-gate.md`. No review gate, model choice or default changes through the study itself.
_touches: scripts/workflow-efficiency-report.py (new), tests/workflow-efficiency-report.test.ts (new), tests/fixtures/workflow-efficiency/ (new), tests/helpers/touchfiles.ts, docs/acceptance/workflow-efficiency.md (new), docs/acceptance/review-fix-policy.md, docs/acceptance/external-gate.md_
_blocked-by: Track 67A, Track 52A, Track 77A, Track 75A, Track 75B, Track 81B, Track 84A_
**Scheduling:** Kept as one card above ~300 lines under the card-size rule's same-files exception (owner direction, 2026-10-26): the evaluation edits the same script, test and fixture files and reads the report the baseline builds. It follows the workflow qualification, whose real runs supply most of its rows, and reads Track 81B's run-state decision instead of repeating it. Session weight 6.
_Source: the Future entries "Fill the external-gate record's three "after" wall times from a real opted-in run", "Fill Track 51A's criterion-7 "after" count at the first opted-in run after a release" and "Fill Track 33A's "after" measurement and pair it with a run without the values"; PR #234's receipt (Track 75A: installed-agent judgment unmeasured, "after" unknown), 2026-11-10._
_read-first: docs/telemetry.md, docs/quota-ledger.md, docs/designs/review-independence.md_
- **Build a comparable baseline and expected stage costs** -- Produce the offline report and the per-stage expected cost from it; reuse eligible release-only receipts and preserve the first-installed-no-CI timing obligation and 15-minute target; report time to push and merge gate separately from human approval. Observational differences are not causal model comparisons. _~200 lines._ (M)
- **Assess the uncertain efficiency choices** -- Compare smaller models and lower effort for bounded drafting/extraction versus the main runner, including launch/context-transfer and parent-correction costs; investigate repeated plan extraction, evidence reads, long-suite reruns, section loading, parallel scheduling and each reviewer voice's unique accepted findings. Define corpus, quality bars, fixed budgets and stop rules before any model trial; offline analysis only, and any paid trial needs a separately approved pilot and spend bound. _~180 lines._ (M)
- **Publish decisions and follow-up ownership** -- Adopt/reject/insufficient-evidence per candidate with expected benefit, observed limitations and the smallest follow-up, mapped to existing Future items; an insufficient-evidence result names missing data and a bounded next measurement and never silently removes a review or acceptance gate. _~80 lines._ (S)
- **Fill the opted-in policy records' after fields** -- From the receipts and ledger records of real opted-in runs (PRs #233 and #234 already carry `test-gaps=record`; record which values each run carried), fill or name as gaps the after fields of the 33A, 51A and 75A sections and the external-gate record, pairing with runs without the values where the records ask. _~40 lines._ (S)

##### Track 85B: Follow a stable release channel and let a bootstrap turn on auto-upgrade
_4 tasks . ~280 LOC incl. tests . medium risk_
**Outcome:** gstack-extend upgrades follow a stable release channel rather than main, each upgrade installs the release it offered, and a bootstrap script can turn on auto-upgrade on that channel without a prompt, mirroring gstack's `auto_upgrade` and `update_channel` settings.
**Supports:** [SPEC](SPEC.md) O1 (install, update and recover) and O5 (release promise). Required before 1.0. Owner, 2026-11-07: "Another we need here for 1.0 (if not already done) - on install, we should check for gstack and extend and install them if missing + turn on auto upgrade on stable for both — they are dependencies" and "This can be deferred to be done right before 1.0".
**Done when:** An `update_channel` setting selects a stable channel (release tags, or a stable branch the release step advances, chosen in the plan) and keeps today's main-tracking behavior available, with existing main-tracking installs and the rollback recipe documented in `docs/installation.md`; `bin/update-check` offers and `bin/update-run` installs the same release identity, or reports the mismatch; a documented non-interactive command enables auto-upgrade on the channel; `setup` reports a missing gstack install actionably (installing it stays the bootstrap's job unless the plan shows otherwise); the Bun 1.3.3 launcher lists in `docs/installation.md` and `CLAUDE.md` name every launcher that needs it (both omit `bin/review-state`, and the installation guide also `bin/review-delegate` and `bin/upstream-check`; verified 2026-11-13); `bin/update-check`'s published output and install-safety stay compatible; the compatibility catalog lists the setting; a dated upgrade through the stable channel on the owner's machine is added to the install qualification record.
_touches: bin/update-check, bin/update-run, bin/config, setup, docs/installation.md, docs/compatibility.md, tests/update.test.ts, docs/acceptance/install-upgrade.md, CLAUDE.md_
_blocked-by: Track 84A, Track 77A, Track 80C_
**Scheduling:** Placed "right before 1.0" (owner): the edge on the workflow qualification is a priority choice; the edges on the catalog (shipped) and install qualification Tracks are technical (it adds the setting to the catalog and appends to the install record). Facts rechecked 2026-11-13: `bin/update-run` fast-forwards `origin main`; there is no channel setting; `setup` checks only that `bun` exists; `bin/config set auto_upgrade true` is honored only by interactive upgrade flows, and spawned sessions never upgrade. An orchestrator's bootstrap does its own install-if-missing; this repository owes the channel, the setting and the non-interactive enable path.
_Source: owner-approved card (2026-11-07); merges the Future entry "Bind upgrade offers to the installed release identity" (raised during Track 28A planning, 2026-10-23), which the owner's word pulls into 1.0._
_read-first: docs/installation.md, docs/acceptance/release-compatibility.md_
- **Stable channel and offered-equals-installed identity** -- The `update_channel` key and its values, the channel mechanism, and binding the installed release to the offered one, with update tests. _~170 lines incl. tests._ (M)
- **Non-interactive enable and rollback** -- Document and test the bootstrap command and the return to main tracking. _~50 lines incl. tests._ (S)
- **Report a missing gstack at setup** -- An actionable result when installed gstack is absent, and complete the Bun 1.3.3 launcher lists in `docs/installation.md` and `CLAUDE.md`. _~35 lines incl. tests._ (S)
- **Record a real channel upgrade** -- Upgrade the owner's install through the stable channel and record offered and installed identity in the install qualification record; list the setting in the catalog. _~30 lines._ (S)

### Group 86: Install and upgrade aligned with upstream gstack

_Depends on: Group 85_

**This group delivers:** An install and upgrade flow that looks and behaves like upstream gstack's, with a What's-new summary after every upgrade.

##### Track 86A: Align install and upgrade with upstream gstack
_3 tasks . ~290 LOC incl. tests, plus byte-copied shared blocks . medium risk_
**Outcome:** Installing and upgrading gstack-extend looks and behaves like upgrading upstream gstack: the same flow shape and output style, and a "What's new" summary shown after every upgrade.
**Supports:** [SPEC](SPEC.md) O1 (install, update and recover a working skill set). Included in 1.0 by the owner on 2026-11-08: "A but keep 72c and 78a for 1.0". Owner, 2026-11-07: "One thing I want to do at some point is re-align our install and upgrade process with gstack. Both visually and functionally, including the nice release notes presented to the user".
**Done when:** The upgrade flow's steps, prompts and output match upstream `/gstack-upgrade`'s shape, including snooze, auto-upgrade and just-upgraded handling; after every upgrade the user sees a What's-new summary drawn from `CHANGELOG.md` between the old and new versions (or the commit log on a main-tracking install) and a per-host upgrade summary; fresh-install onboarding is compared with gstack's and any gap recorded; install-safety rules, the `UPGRADE_OK`, `UPGRADE_FAILED`, `MIGRATION_WARN` and `INSTALL_WARN` tokens and `bin/update-check`'s published output stay compatible or migrate explicitly with disclosure; the recorded update-check and removed-host detector test gaps have tests.
_touches: skills/gstack-extend-upgrade.md, skills/gstack-extend-init.md, skills/full-review.md, skills/implement.md, skills/plan-track.md, skills/project-spec.md, skills/pair-review.md, skills/ship-and-land.md, skills/roadmap.md, skills/review-and-prep.md, skills/docs-ship.md, bin/update-run, setup, docs/installation.md, tests/skill-protocols.test.ts, tests/update.test.ts, tests/setup-hosts.test.ts_
_blocked-by: Track 85B_
**Scheduling:** The owner first said "at some point" (2026-11-07), then included it in 1.0 (2026-11-08). The edge on the stable-channel Track orders edits to the same upgrade files behind it. It lists every skill file because the shared upgrade-flow block is byte-copied into each of them; those copies do not count toward the card size. Facts rechecked 2026-11-13: `skills/gstack-extend-upgrade.md` only points the user at `CHANGELOG.md` and shows no summary, while upstream `/gstack-upgrade` shows a grouped What's-new summary; release text from 0.68.0 to 0.72.0 is thin, so the summary is only as good as the CHANGELOG.
_Source: owner-approved card (2026-11-07); Future entry "Recorded test gaps: update-check wording, trigger lines and notice placement" (its trigger, a Track whose `_touches:` cover `tests/skill-protocols.test.ts` and `tests/update.test.ts`, is met here); recorded test gap `[review:files=tests/skill-protocols.test.ts]` "Exercise the remaining removed-host detector branches" (PR #236, 2026-11-10)._
_read-first: skills/gstack-extend-upgrade.md, docs/installation.md_
- **Match upstream's upgrade flow and output** -- Steps, prompts and output format across the shared upgrade flow and `/gstack-extend-upgrade`, keeping the result tokens and install-safety rules. _~150 lines incl. tests, plus shared copies._ (M)
- **What's-new and per-host upgrade summaries** -- Summarize `CHANGELOG.md` (or the commit log) between versions and print one row per host install. _~100 lines incl. tests._ (M)
- **Cover the recorded skill-protocol test gaps** -- Pin the `UPGRADE_SKIPPED spawned-session` sentence and the installation guide's just-upgraded clauses, assert the per-skill `UPGRADE_AVAILABLE` and `JUST_UPGRADED` lines and the spawned branch's placement, and show `bin/update-check` output reaching stdout (`[review:files=tests/skill-protocols.test.ts|tests/update.test.ts]` and `[review:files=tests/skill-protocols.test.ts]`, Track 66A, 2026-11-04); add negative cases for an unguarded Paseo mention and the removed Conductor marker in the removed-host detector. _~45 lines._ (S)

### Execution Map

Launch is decided per Track: a Track may start once every Track in its
`_blocked-by:` has landed. Tracks in one Group share no files, and wherever a
Track shares a file with a Track in an earlier Group, the packer has already
turned that into an edge here. The adjacency below is the packer's DEPENDS
output with bin numbers replaced by Group numbers; the Track IDs after each set
are the packer's own list of the Tracks that cause the edge, so a Group never
waits on a blocker's siblings. In particular, the owner-run Tracks 80C and 80D
gate only Track 85B (through Track 80C), and Tracks 82A and 83A run only if
Track 81B adopts the default. Document order is priority, not a gate. The cards
label priority choices separately from technical prerequisites.

```
- Group 80 ← {}
- Group 81 ← {80}: Track 80A
- Group 82 ← {81}: Tracks 81A, 81B
- Group 83 ← {82}: Track 82A
- Group 84 ← {80, 83}: Tracks 80B, 83A
- Group 85 ← {80, 81, 84}: Tracks 80C, 81B, 84A
- Group 86 ← {85}: Track 85B
```

Track detail per group:
```
Group 80: Run-state recording fix ∥ secret dispositions ∥ owner-run records
  +-- Track 80A ........... ~L . 3 tasks   (startable now)
  +-- Track 80B ........... ~L . 4 tasks   (startable now)
  +-- Track 80C ........... ~M . 2 tasks   (owner's runs)
  +-- Track 80D ........... ~M . 4 tasks   (owner's runs)
Group 81: Helper hardening ∥ run-state measurement and default decision
  +-- Track 81A ........... ~L . 5 tasks
  +-- Track 81B ........... ~M . 2 tasks   (waits on real runs)
Group 82: Default-promotion prerequisites (only on adopt)
  +-- Track 82A ........... ~L . 2 tasks
Group 83: The recorded path as the review default (only on adopt)
  +-- Track 83A ........... ~L . 4 tasks
Group 84: Two-driver workflow qualification
  +-- Track 84A ........... ~L . 2 tasks
Group 85: Measured stage cost ∥ stable update channel
  +-- Track 85A ........... ~L . 4 tasks
  +-- Track 85B ........... ~M . 4 tasks
Group 86: Install and upgrade aligned with upstream gstack
  +-- Track 86A ........... ~M . 3 tasks
```

**7 Groups / 12 Tracks remaining**, all in the Current Plan; Tracks 82A and 83A are conditional on Track 81B.

Only owner-confirmed acceptance in PROGRESS can satisfy a stage/checkpoint.


## Future

Deferred: docs/roadmap-future.md (81 items)

## Shipped

History: docs/roadmap-shipped.md
