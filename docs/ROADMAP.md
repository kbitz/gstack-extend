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





**Order.** The review run-state redesign is done: Track 89A made the recorded
path `/review-and-prep`'s default (v0.103.0), after Track 86A recorded the
developer's adopt decision on reliability grounds (PR #276, 2026-11-18, "2 b").
Telemetry provider parity is done too (Muse detection 89B, v0.102.0; the shared
by-hand run-mode rule 90B, v0.104.0), as are the orchestrator consumer's
documentation-audit gap value (91A, v0.106.0) and exact-token reply credit (91B,
v0.107.0). The fixed preamble and install-host removal (Track 92A, v0.108.0 and
v0.109.0) and the quota and telemetry removal (93B, v0.110.0) have shipped, with
the review-dispatch fix for gstack 1.102.2.0 (93C, v0.109.1). The next work is
the small stage fixes the developer's own runs surfaced (Tracks 94A–94C, then
96A), the developer-run records (94D, 94E) and the two-driver workflow
qualification (95A), whose holds-first record landed in PR #291 and stays open
until the owner's real runs exist. Track 94F remeasures the recorded path's cost
once by-hand Codex or Muse reviews on the default exist, as 86A's record commits.
Behind them come the O6 measurement and decisions (96B) beside the stable update
channel the owner placed "right before 1.0" (96C), then aligning install and
upgrade with gstack (97A). Only 94D gates anything among the developer-run
records (Track 96C appends to its record). Owner, 2026-11-08: "A but keep 72c and
78a for 1.0", approving a proposal that moved the review-finding records to
Future and kept docs-only test selection (since shipped) and the gstack alignment
(now Track 97A) as 1.0 work.

**Cursor and OpenCode dropped.** Developer decision (2026-11-21): "we don't
support cursor anymore? we should have dropped it a long time ago", and "yes,
drop opencode" in answer to whether OpenCode goes in the same change.
[SPEC](SPEC.md) names Claude Code and Codex as the supported install hosts.
Track 92A removed the two hosts' setup and resolver code paths, as Track 76A did
for Conductor, gave an existing install on either host a clear unsupported
message, and, on the developer's word (2026-11-21, "fold it in"), replaced each
skill's inline preamble with one fixed command a single permission rule can
allow. Track 93B removed their quota and telemetry code; the first attempt
(PR #292, closed unmerged) grew by live-reconciling stored Cursor charges, and
the shipped version (PR #294, v0.110.0, developer: "b", then "1") deletes that
reconciliation. Track 92A's plan follow-up 92E (name its release in the
compatibility catalog's retired-surface entry) is carried by Track 96C, because
this skill does not edit the catalog. The Cursor by-hand readback was discharged
with the reason "Cursor support dropped 2026-11-21".

**Review-gate credit (developer-approved practices, 2026-11-20).** A review
gate's credit decision is a trust boundary, so work that changes it is planned
at novel tier. A gate never credits free-form model prose: prefer an exact token
or schema from the producer over interpreting wording variants, and do not
prescribe a Markdown parser as the fix.

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



**Labels.** This regeneration (2026-11-22) recorded Tracks 92A, 93B and 93C and
retired Groups 92 and 93 by tombstone; no Track is declared in flight, so every
remaining label recycled from 94 in packer order. New work this run: 94A
(documentation-audit reuse), 94B (`/roadmap` scratch paths), 94C
(`/plan-track` selector and plan names) and 96A (pregate re-anchor). The
developer-run records and the held remeasurement moved from 92B, 92C and 92D to
94D, 94E and 94F; the two-driver qualification from 93A to 95A; the cost
measurement and stable channel from 94A and 94B to 96B and 96C; the upstream
alignment from 95A to 97A. The renames are in this regeneration's commit message.
Shipped numbers through 93 are reserved by tombstones; 64 was never a roadmap
Group.

Target: [SPEC](SPEC.md) O1–O6, 1.0.0 as the owner's own real use by hand and
through an orchestrator; audience ceiling potentially-public. No workspace host
or orchestrator is required; support claims name only exercised combinations.
Implementation, installed/operator evidence and owner acceptance remain
distinct. No new spend or unattended merge is authorized.


## In Progress

No Track is declared in flight at this regeneration (2026-11-22). Tracks 92A, 93B and 93C shipped since the last regeneration and are recorded in shipped history; Track 93A (now 95A) has its holds-first record from PR #291 but is not done. O1 and O3–O6 remain pending; O2 was accepted on 2026-10-23.

## Current Plan

_tombstone: 17, 19, 20, 22, 23, 24, 25, 26, 28, 29, 30, 31, 32, 33, 47, 48, 49, 50, 51, 52, 57, 58, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93_

### Group 94: Documentation-audit reuse ∥ roadmap and plan-track fixes ∥ developer-run records ∥ recorded-path remeasurement

_Depends on: none_

**This group delivers:** A documentation audit that is reused with no question when nothing documented changed; `/roadmap` that runs past its first audit under a read-only `/tmp`; `/plan-track` that accepts a Track selector in interactive sessions and names each plan for its Track; whenever the developer runs them, the install/upgrade/recovery qualification, the remaining real review records and the by-hand run-mode readbacks; and, once by-hand Codex or Muse reviews exist, the recorded path's cost measured again on the shipped default.

##### Track 94A: Decide documentation-audit reuse before spending an attempt, and never ask the developer when nothing documented changed
_2 tasks . ~220 LOC incl. tests . medium risk_
**Outcome:** A developer or caller running `/review-and-prep` whose later commits change no audited document and no user-visible text gets the earlier documentation audit reused without a question, and a blocked or failed re-audit falls back to that same classification instead of stopping to ask.
**Supports:** [SPEC](SPEC.md) O3.1–O3.2 (a stage never repeats a completed review without cause and finishes without stalling on a question that has a standing answer) and O6 and P1 (no repeated model work or wasted cycles where the earlier audit still holds). The developer's request, 2026-11-22 (relayed): "yes re doc audit -- you don't need to ask me this, and maybe we should mechanize this to stop wasting cycles thinking about it".
**Done when:** (1) Before spending a documentation-audit attempt, the skill classifies the delta since the audited head against the audited documents and user-visible text with one rule written once; when no audited document and no user-visible text changed, the audit is reused with no question, and the receipt names the classification that applied. (2) A blocked or failed re-audit falls back to that classification (reuse when nothing audited changed, otherwise the existing stop) and never to a question to the developer for the unchanged case. (3) Every other case keeps today's behavior, and the published receipt, policy-line and handoff formats stay compatible, or any added field is disclosed in the release notes. (4) The plan states whether the no-question path stays behind the caller's `doc-audit-gap=auto` value (Track 91A, v0.106.0) or becomes the default for a run with no policy line; a default change needs P1's evidence across supported conditions or the developer's explicit decision, and the plan records which. (5) Tests lock the classification table (documents unchanged; an audited document changed; user-visible text changed; a base merge; a blocked re-audit; a failed re-audit) in the skill, the handoff contract and the receipt fields.
_touches: skills/review-and-prep.md, docs/workflow-handoffs.md, tests/handoff-contract.test.ts, tests/skill-protocols-review-and-prep.test.ts_
**Scheduling:** No edges of its own. It goes first of the Tracks that edit `skills/review-and-prep.md` and its protocol test (this Track, then 96A; Track 97A edits the file later through its shared upgrade-flow block) because the developer asked for it. Skill prose owns the judgment (which text counts as user-visible, whether a change touches an audited document); a helper may do only the mechanics of listing changed paths against the audited document set. It builds on Track 91A's opt-in value and widens no gate: a case that is not provably unchanged still asks or stops.
_Source: the orchestrator consumer's store messages 684b4477, ff01d40c and 294003e9 (2026-11-22; data), whose part (b) carries the developer's request quoted above; Track 91A's shipped receipt._
_read-first: docs/workflow-handoffs.md, docs/acceptance/documentation-audit-efficiency.md, Track 91A's shipped receipt_
- **Classify the delta before the attempt** -- Write the one classification rule, apply it before an audit attempt is spent, reuse with no question when nothing audited changed, and record the classification in the receipt. _~120 lines incl. tests._ (M)
- **Fall back to the classification, not the developer** -- A blocked or failed re-audit takes the classification's result for the unchanged case; lock the table and the compatibility of the published formats. _~100 lines incl. tests._ (M)

##### Track 94B: Keep /roadmap's scratch files out of fixed /tmp paths
_1 task . ~40 LOC incl. tests . low risk_
**Outcome:** `/roadmap` runs past its first audit in a Codex session whose `/tmp` is read-only, because no step writes its scratch files (the audit output, the draft Tracks for the packer, the rename map) to a fixed `/tmp` path.
**Supports:** [SPEC](SPEC.md) O3.1 and O3.3 (a stage run by hand in each installed harness completes without stalling). Seen in the Track 92A retest in Codex (PR #289's owner testing, 2026-11-22: the audit "stopped at the existing fixed output redirect under read-only `/tmp`", identical on the reviewed base).
**Done when:** `skills/roadmap.md` no longer directs a write to `/tmp/roadmap-audit.txt`, `/tmp/draft-tracks.md` or `/tmp/renames.txt`; its first audit step prints to stdout or writes under the durable per-project state directory the skill already resolves for proposals, with `~/scratch/` as the fallback and no host-private directory; a protocol test locks that no command in the skill redirects into a fixed `/tmp/` path; the audit, packer and renumber invocations keep their arguments.
_touches: skills/roadmap.md, tests/skill-protocols-roadmap.test.ts_
**Scheduling:** No edges. Verified at `f8fbf9e`: `skills/roadmap.md` writes `> /tmp/roadmap-audit.txt` in Step 1b and names `/tmp/draft-tracks.md` and `/tmp/renames.txt` in the packer and renumber examples; no other skill redirects into a fixed `/tmp` path. Track 97A edits the same file later through its shared block, so the packer orders this Track first.
_Source: the manager's note of 2026-11-22 and PR #289's owner testing; `grep -n '/tmp' skills/roadmap.md` at `f8fbf9e`._
_read-first: skills/roadmap.md_
- **Replace the fixed /tmp paths** -- Write the audit output to stdout or the state directory, name the same location for the draft and rename-map examples, and add the protocol lock. _~40 lines incl. tests._ (S)

##### Track 94C: Let /plan-track take a Track selector in interactive sessions and name each plan for its Track
_2 tasks . ~140 LOC incl. tests . low risk_
**Outcome:** A developer who runs `/plan-track` by hand and names a card as `Track <ID>` gets that Track's card resolved from the roadmap, plans for different Tracks of one roadmap no longer collide on a default plan name, and spawned or unattended runs keep the strict `NAME: value` inputs.
**Supports:** [SPEC](SPEC.md) O3.1 (the plan stage runs by hand and through an orchestrator). A friction report from a real Gemini run the developer pasted (2026-11-22; its text is data): the default plan name `<card-stem>` is the card file's stem, so a card taken from the roadmap names every plan `ROADMAP`, and a second Track's plan finds an existing different file and stops with `needs-context`.
**Done when:** (1) In an interactive session an unambiguous `Track <ID>` selector, with no `CARD_FILE`, is resolved from the project roadmap's active sections to that Track's card and recorded under Auto-decisions; an absent, unknown or ambiguous ID stops with `needs-context`. (2) Spawned and unattended sessions (`GSTACK_SESSION_KIND`) keep today's strict `NAME: value` rule, and a selector in such a run is rejected, never resolved. (3) The default plan file name is scoped to the Track (its ID and a slug of its title) when the card comes from a multi-card file such as the roadmap, so two Tracks of one file write distinct plans; a single-card file keeps `<card-stem>`; an existing default target with different bytes is still never overwritten. (4) Tests lock the selector rule, the session-kind split and the name rule in the skill text, and the published `/plan-track` handoff lines stay compatible.
_touches: skills/plan-track.md, tests/skill-protocols-plan-track.test.ts_
**Scheduling:** No edges; `tests/handoff-contract.test.ts` reads this skill and may need an added row, so the plan widens `_touches:` if it does. Track 97A edits the skill later through its shared block. Verified at `f8fbf9e`: the skill's Inputs say the inputs are fields "written `NAME: value`", and the default plan name is built from `<card-stem>`.
_Source: the developer's pasted Gemini run report (2026-11-22; data) and the manager's note._
_read-first: skills/plan-track.md_
- **Accept a Track selector in interactive sessions** -- Resolve `Track <ID>` from the roadmap, record it under Auto-decisions, keep the strict rule for spawned and unattended runs, and lock both. _~90 lines incl. tests._ (M)
- **Scope the default plan name to the Track** -- Name a plan from a multi-card file by Track ID and title slug, keep single-card behavior, and lock it. _~50 lines incl. tests._ (S)
##### Track 94D: Qualify install, upgrade and recovery on the owner's machines
_2 tasks . ~160 LOC . medium risk_
**Outcome:** The owner can install, onboard, upgrade and recover a working skill set on a fresh machine from the published instructions, with evidence of what was actually installed.
**Supports:** [SPEC](SPEC.md) O1 (all three criteria) and O5.2; the preserved published three-part upgrade obligation from Track 28A planning (2026-10-23), whose trigger was met by v0.48.0.
**Done when:** A dated record names the OS, host, harnesses and versions of a fresh install and project onboarding on the owner's machine, actionable failures for a missing prerequisite, an upgrade with user-owned files preserved and stale copies reported, a working recovery path, and a real legacy four-part install upgraded through the default remote with offered and installed commit/tag identity, reader compatibility and unchanged user state; it records the actual installed commit and discloses that upgrade offers follow main rather than a release identity; failures stay open; the owner confirms before O1 counts.
_touches: docs/acceptance/install-upgrade.md (new)_
_blocked-by: Track 70A, Track 28A_
**Scheduling:** Technical edge on Track 70A (shipped, v0.72.0): the qualified upgrade includes removing the retired skill. Candidate or file-remote proof does not satisfy the published-upgrade obligation. It waits on the owner's time and gates only the stable-channel Track 96C, which appends to its record.
_read-first: docs/installation.md, docs/acceptance/release-compatibility.md_
- **Fresh install, onboarding, upgrade and recovery** -- Run them on the owner's machine from the published instructions and record each step, intervention and result. _~90 lines._ (M)
- **Published three-part upgrade from a legacy install** -- Upgrade a real four-part install through the default remote and record offered and installed identity, reader compatibility, recovery and unchanged state beside `docs/acceptance/release-compatibility.md`. _~70 lines._ (M)

##### Track 94E: Record the owner's remaining real review runs and by-hand run-mode readbacks
_3 tasks . ~120 LOC . low risk_
**Outcome:** The owner can see from dated records that a by-hand review with no caller lines still runs as before, that the attacker parts run with per-part models when an orchestrator delegates them, that tools-mode delegation works on an installed release, and that a stage run by hand in Codex, Muse or Grok reads back with the run mode the shared rule promises.
**Supports:** [SPEC](SPEC.md) O6 and P1, O6.1, O3.3 (the by-hand driver's evidence) and O4.4. The remainder of the earlier Track 80D (PR #256, v0.94.2), which left attacker-parts PM1 and PM2 and tools-mode PM1 pending; the open acceptance of Track 72B (PR #221) and the post-release PM1 of the owner-approved tools-mode plan (PR #229); and the post-merge by-hand readbacks Track 90B left pending (PR #283), whose Cursor row was discharged when Cursor support was dropped (developer, 2026-11-21).
**Done when:** (1) `docs/acceptance/attacker-parts.md` records PM1 (one real by-hand `/review-and-prep` with no `Review policy:` or `Review delegates:` line, read back as unchanged, with its invocation and receipt retained) and PM2 (one orchestrated run with `delegate=adversarial,red-team` mapping the two parts to different providers or models, with its `Delegated part:` lines, v3 attempts, `found_by` labels and any fallbacks), each with date, revision, host and harness versions and PR. (2) `docs/acceptance/delegate-tools-mode.md` records its PM1 installed paired run and names the exact reviewed content its earlier dry-run evidence covers. (3) Each pending row in `docs/acceptance/hand-use-telemetry.md`'s "Pending post-merge by-hand readbacks" (Codex, Muse and Grok; the Cursor row is discharged with the reason "Cursor support dropped 2026-11-21") is run by hand and read back through `gstack-extend-telemetry report --by-host` and the ledger's `agent`, `run_mode` and `run_mode_source`, or stays pending with the reason. (4) A failed, unavailable or wrongly read-back run stays recorded as open, never as passed, and a wrong read-back is filed as a defect.
_touches: docs/acceptance/attacker-parts.md, docs/acceptance/delegate-tools-mode.md, docs/acceptance/hand-use-telemetry.md_
**Scheduling:** No edges; it gates no other Track. PM2 already has partial observations (PRs #250 and #253 and a consumer repository's review) and waits only on harness CLI version provenance, which the run's operator can record from the harness at run time; tools-mode PM1 waits on the orchestrator's paired tools-mode run, requested on 2026-11-15. A by-hand Codex or Muse review run for the readbacks can also count toward Track 94F's sample.
_Source: PR #256's receipt (2026-11-15: "attacker PM1/PM2 and paired tools-mode qualification remain pending"); `docs/acceptance/attacker-parts.md` and `docs/acceptance/delegate-tools-mode.md` (PM rows pending); PR #283's receipt ("post-merge hand-run readbacks PM1–PM4 in Codex, Muse, Grok and Cursor") and the four `pending` rows in `docs/acceptance/hand-use-telemetry.md` (verified@c602252), of which the Cursor row was discharged on 2026-11-21 when Cursor support was dropped._
_read-first: docs/delegated-review.md, docs/acceptance/hand-use-telemetry.md_
- **Attacker parts PM1 and PM2** -- Run and read back one by-hand review with no caller lines, and finish PM2's harness version provenance. _~50 lines._ (S)
- **Tools-mode PM1 and provenance** -- Record the installed paired run and name the content the dry-run record covers. _~40 lines._ (S)
- **By-hand run-mode readbacks** -- Run one stage by hand in each installed non-Claude harness as its row describes and record the readback or the reason it stays pending. _~30 lines._ (S)

##### Track 94F: Remeasure the recorded review path's cost on the shipped default
_1 task . ~60 LOC . low risk_
**Outcome:** The developer can read whether making the recorded run state the default cut bookkeeping and resume cost against the measured baseline, with the same reliability guardrails.
**Supports:** [SPEC](SPEC.md) O6.2–O6.3 and P1; the follow-up Track 86A's record commits to (`docs/acceptance/review-run-state.md` §4.1, item 3: after Track 89A ships, re-run the same four caller-owned scripts unchanged).
**Done when:** The record appends after-default figures from real runs on the shipped default, measured with the same four caller-owned scripts unchanged, compared with the 77,560 mean-token baseline and the published 44.5% E15 share, with sample size, missingness and the three reliability guardrails (complete records in every segment, no lost findings, unchanged review outcomes); too few runs is recorded as insufficient evidence naming the missing data and a bounded next measurement. No default changes in this Track.
_touches: docs/acceptance/review-run-state.md_
_blocked-by: Track 89A_
**Scheduling:** Held. Its edge on Track 89A (shipped, v0.103.0) is satisfied, but its measurement scripts read each review's parent Codex or Muse rollout transcript, so it waits for at least two by-hand reviews on gstack-extend 0.103.0 or later, run on Codex or Muse, whose transcripts can be read. No review run on Claude counts. No Track supplies those reviews; Track 96B's E15 decision reads its result.
_Source: `docs/acceptance/review-run-state.md` §4.1 (Track 86A, PR #276, 2026-11-18); the manager's hold note (2026-11-21)._
_read-first: docs/acceptance/review-run-state.md_
- **Remeasure on the default** -- The after-default figures, guardrails and comparison, or insufficient evidence with its next measurement. _~60 lines._ (M)

### Group 95: Two-driver workflow qualification

_Depends on: none_

**This group delivers:** Real by-hand and orchestrated workflow evidence on the final stage behavior, recorded against the holds-first matrix PR #291 added.

##### Track 95A: Qualify the workflow with two real drivers
_2 tasks . ~240 LOC . medium risk_
**Outcome:** The owner can carry real work through every stage both by hand and through a real external orchestrator, and the evidence shows what the documented contract actually supports.
**Supports:** [SPEC](SPEC.md) O3.3 and O4.5 (reshaped from the Paseo host Track by the owner, 2026-11-07: "72c ok").
**Done when:** A dated record names host, harness and versions for real runs by both drivers (the owner by hand, and one real external orchestrator), each run read back in telemetry with the correct run mode, covering, between them, a complete plan-to-authorized-release workflow, interrupted resume, manual-testing pause/resume, `/full-review` finish/restart, an explicit negative hold, an external-consumer handoff consumed from artifacts, a cross-session handoff and stale/partial/held handoffs; it counts operator interventions and keeps pending approvals or failures as holds; it includes the installed `/docs-ship` acceptance below; no unexercised combination is claimed.
_touches: docs/acceptance/workflow-drivers.md_
_blocked-by: Track 70A, Track 72C, Track 71E, Track 74A, Track 76A, Track 75A, Track 26A, Track 23I, Track 23A, Track 26B, Track 65A, Track 66A, Track 66B, Track 72A, Track 79A, Track 80B, Track 87A, Track 89A, Track 90A, Track 91A, Track 90B, Track 91B, Track 92A_
**Status (2026-11-22):** Not done; holds stay open. PR #291 (merged, documentation only, no release) added `docs/acceptance/workflow-drivers.md` as a holds-first matrix of 23 rows (14 `WD-*` and 9 `DS-*`; 0 pass, 23 hold at `8077fa2`), the runbooks for both drivers and seven post-92A telemetry observations. Criteria 1–2 still need the owner's real by-hand runs and one real external orchestrator's runs, each read back in telemetry; no row passes without its own live evidence on `producer_version >= 0.109.0`, and pending approvals or failures stay holds.
**Scheduling:** Runs on the final behavior of the stages it qualifies, so it follows every Track that changes them: the run-state Tracks through 89A, which made the recorded path `/review-and-prep`'s default (shipped, v0.103.0), the review fixes, the `blocking=shown` probe and the skill diet (Tracks 82A–84D, 85D, 86B and 87A), the secret-disposition requalification (80B), the outside-voice baseline (90A, shipped), run-mode parity (90B, shipped), whose run-mode results this record reads back, the documentation-audit gap value (91A, shipped, v0.106.0), exact-token reply credit (91B, shipped, v0.107.0), and the fixed preamble and install-host removal (92A, shipped, v0.108.0 and v0.109.0), which changed every stage's preamble and the install hosts a driver can use; qualifying before it would spend the developer's by-hand runs on behavior about to change (owner, 2026-11-10: wait for the run-state Tracks). The edge on 92A was technical in that sense, not only priority, and is satisfied. The Tracks that only record real runs of shipped code (94D, 94E) do not gate this one; a run here can supply their rows. The external orchestrator may stop at a ready PR; a separate authorized run by hand proves landing. No consumer-repo edits, new spend, unattended release or acceptance-by-idle-status. The independently followed onboarding attempt moved to the public-release stage (Future). This regeneration (2026-11-22) added small Tracks that change stages this record qualifies (94A, 94B, 94C and 96A). They are deliberately not edges, because the record binds each row to the `producer_version` it ran on and a fix to one stage's prose does not invalidate runs of the others; add the edges if the owner wants those runs to wait.
- **Exercise both drivers** -- Run the matrix's rows (the record exists; this task fills it). Use real host-managed workspaces and approved accounts with the harnesses the owner uses for each stage; retain the bound PR and workspace, test stale/partial/held handoffs, confirm next-stage consumption from artifacts across sessions, include the host-attribution check deferred from Track 26A, and count operator interventions. _~200 documentation lines._ (L)
- **Include installed `/docs-ship` acceptance** -- Run a real docs-only PR through classification, a no-write classification hand-back, selected tests once, same-tree test-record reuse, final receipt hash, policy bump and `docs-ship/v1` without merging, and its interactive merge question; include one Sonnet-class run and one `/roadmap` handoff, and compare work/wait wall time with a recent docs PR shipped through the ordinary path. _~40 lines._ (S)

### Group 96: Pregate-narrowing re-anchor ∥ measured stage cost ∥ stable update channel

_Depends on: Group 94, Group 95_

**This group delivers:** Pregate narrowing that is active again on the installed upstream gstack, with the anchor inventory's recorded test gaps covered; expected cost per stage with an adopt, reject or insufficient-evidence decision for every candidate optimization and the opted-in policy records' after fields filled; and upgrades that follow a stable release channel with a non-interactive auto-upgrade switch.

##### Track 96A: Re-anchor pregate narrowing to the installed gstack and cover the recorded anchor-inventory test gaps
_3 tasks . ~230 LOC incl. tests . medium risk_
**Outcome:** `/review-and-prep` can narrow the pregate after an accepted full-suite pass again on the installed upstream gstack, `bin/upstream-check` exits clean on both hosts, and the anchor inventory's recorded parser and CLI test gaps are covered.
**Supports:** [SPEC](SPEC.md) O6 and P1 (the narrowing skips pregate lanes an accepted pass already covered; inactive narrowing repeats them on every review) and O3.1 (a standing advisory drift on every launch check). Deferred from Track 93C's plan (d2) with the developer's agreement.
**Done when:** (1) `bin/upstream-check --gstack-root <root>` on both hosts' installed gstack (1.102.2.0, where upstream added `policyFloorCheck` to the `CHECKS` list in `lib/pregate/index.ts`) reports no `pregate-narrowing` drift: `review-and-prep.pregate-narrowing.index.1` is re-anchored, and the plan states whether `policyFloorCheck` changes what the narrowing's coverage rules assume (the probe's `lanes` check and its `REPO_COMMANDS_NOT_ALLOWED` result) and records that verification at the installed revision. (2) The anchor text in the skill, the qualified-revision table in `docs/upstream-check.md`, `PREGATE_NARROW_QUALIFIED` and the protocol and CLI tests agree; the check count stays 108 unless an anchor is added or removed. (3) The seven recorded test gaps from Track 93C's coverage audit (mixed-width delimiters, a leading dangling `or`, repeated dispatch alternatives, keeping alternatives in the final slot, a malformed local adversarial list through the CLI, both dispatch forms and Codex wording in the nested layout, and unreadable upstream review with both attacker items drifting) each have a test, or the plan records why one cannot. (4) The fallback on a missing anchor (the pregate runs unmodified and the receipt says `inactive`) is unchanged.
_touches: skills/review-and-prep.md, src/upstream-check/cli.ts, docs/upstream-check.md, tests/upstream-check.test.ts, tests/skill-protocols-review-and-prep.test.ts_
_blocked-by: Track 94A_
**Scheduling:** Ordering edge on Track 94A, not a technical prerequisite: both edit `skills/review-and-prep.md` and its protocol test, and 94A goes first because it is the developer's explicit request (2026-11-22). Drift verified 2026-11-22 with `bin/upstream-check --gstack-root` on `~/.claude/skills/gstack` and `~/.codex/skills/gstack`: `checks=108 drift=1`, anchor `review-and-prep.pregate-narrowing.index.1`. The skill carries ``export const CHECKS: readonly CheckDef[] = [regenCheck, secretsCheck, straysCheck, literalsCheck, timingCheck, guardsCheck, lanesCheck];`` while the installed `lib/pregate/index.ts` lists `policyFloorCheck` after `literalsCheck`. The seven test gaps ride here because this Track's `_touches:` cover `src/upstream-check/cli.ts` and `tests/upstream-check.test.ts` and their own trigger (a Track changes the anchor inventory or its CLI tests) is met; they are two tasks, four parser-shape gaps and three CLI-level gaps, to stay inside the five-task cap.
_Source: the manager's note (2026-11-22) and `docs/acceptance/release-compatibility.md` (Track 93C's "Remaining unrelated drift disclosure"); inbox `[review:files=src/upstream-check/cli.ts|tests/upstream-check.test.ts]` items from PR #293 (Track 93C coverage audit at `ff5473c3`, 2026-11-22)._
_read-first: docs/upstream-check.md, docs/acceptance/release-compatibility.md_
- **Re-anchor the `CHECKS` line and requalify** -- Update the anchor in the skill, the qualified revision and the tests, and verify the narrowing's assumptions against the installed `policyFloorCheck`. _~60 lines incl. tests._ (M)
- **Cover the parser-shape gaps** -- Four fixtures for the dispatch-alternative inventory: a mixed-width delimiter span, a leading `or`, a repeated alternative and an earlier-slot join paired with a later split. _~80 lines._ (S)
- **Cover the CLI-level gaps** -- Three fixtures through `bin/upstream-check`: a malformed local adversarial list, Codex wording in the nested layout with both exact forms together, and an unreadable upstream review. _~90 lines._ (S)
##### Track 96B: Measure each stage's cost and decide each optimization
_4 tasks . ~500 LOC incl. tests . medium risk_
**Outcome:** The owner can reproduce an offline report of each stage's measured cost (model work, tool/CI/human waits, reuse and rework), read a documented expected cost per stage, and see an adopt, reject or insufficient-evidence decision for every candidate optimization.
**Supports:** [SPEC](SPEC.md) O6.1–O6.3 (owner, 2026-11-07: P1 joins the 1.0 outcomes with this finish line, and this Track gains the expected stage cost).
**Done when:** A reproducible offline report from sanitized projections separates DOCS/FULL/release-only paths, diff/task size, repo/host, run mode, skill version, waits and fresh versus resumed runs, and reports sample size and missingness; fixtures cover each split. A documented expected cost per stage (wall time and model usage, with sample size and unknowns) is published. Each efficiency-program candidate, including first-cycle overlap (69A), fold, delegation, the docs-only selection and the review run-state redesign (E15, whose decision is Track 86A's record and whose cost on the shipped default is Track 94F's), has measured evidence or a named evidence gap and an adopt, reject or insufficient-evidence decision with its follow-up mapped to existing Future items. The after fields that opted-in review-policy records still hold as unknown are filled from real opted-in runs where they exist, or named as evidence gaps: `docs/acceptance/review-fix-policy.md` for Tracks 33A, 51A and 75A (including whether an installed agent judged 75A's shown evidence and post-audit change classes as the skill asks) and the three after wall times in `docs/acceptance/external-gate.md`. No review gate, model choice or default changes through the study itself.
_touches: scripts/workflow-efficiency-report.py (new), tests/workflow-efficiency-report.test.ts (new), tests/fixtures/workflow-efficiency/ (new), tests/helpers/touchfiles.ts, docs/acceptance/workflow-efficiency.md (new), docs/acceptance/review-fix-policy.md, docs/acceptance/external-gate.md_
_blocked-by: Track 67A, Track 52A, Track 77A, Track 75A, Track 75B, Track 86A, Track 95A, Track 94F_
**Scheduling:** Kept as one card above ~300 lines under the card-size rule's same-files exception (owner direction, 2026-10-26): the evaluation edits the same script, test and fixture files and reads the report the baseline builds. It follows the workflow qualification, whose real runs supply most of its rows, and reads Track 86A's run-state decision and Track 94F's remeasurement instead of repeating them. Session weight 6.
_Source: the Future entries "Fill the external-gate record's three "after" wall times from a real opted-in run", "Fill Track 51A's criterion-7 "after" count at the first opted-in run after a release" and "Fill Track 33A's "after" measurement and pair it with a run without the values"; PR #234's receipt (Track 75A: installed-agent judgment unmeasured, "after" unknown), 2026-11-10._
_read-first: docs/telemetry.md, docs/quota-ledger.md, docs/designs/review-independence.md_
- **Build a comparable baseline and expected stage costs** -- Produce the offline report and the per-stage expected cost from it; reuse eligible release-only receipts and preserve the first-installed-no-CI timing obligation and 15-minute target; report time to push and merge gate separately from human approval. Observational differences are not causal model comparisons. _~200 lines._ (M)
- **Assess the uncertain efficiency choices** -- Compare smaller models and lower effort for bounded drafting/extraction versus the main runner, including launch/context-transfer and parent-correction costs; investigate repeated plan extraction, evidence reads, long-suite reruns, section loading, parallel scheduling and each reviewer voice's unique accepted findings. Define corpus, quality bars, fixed budgets and stop rules before any model trial; offline analysis only, and any paid trial needs a separately approved pilot and spend bound. _~180 lines._ (M)
- **Publish decisions and follow-up ownership** -- Adopt/reject/insufficient-evidence per candidate with expected benefit, observed limitations and the smallest follow-up, mapped to existing Future items; an insufficient-evidence result names missing data and a bounded next measurement and never silently removes a review or acceptance gate. _~80 lines._ (S)
- **Fill the opted-in policy records' after fields** -- From the receipts and ledger records of real opted-in runs (PRs #233 and #234 already carry `test-gaps=record`; record which values each run carried), fill or name as gaps the after fields of the 33A, 51A and 75A sections and the external-gate record, pairing with runs without the values where the records ask. _~40 lines._ (S)

##### Track 96C: Follow a stable release channel and let a bootstrap turn on auto-upgrade
_4 tasks . ~280 LOC incl. tests . medium risk_
**Outcome:** gstack-extend upgrades follow a stable release channel rather than main, each upgrade installs the release it offered, and a bootstrap script can turn on auto-upgrade on that channel without a prompt, mirroring gstack's `auto_upgrade` and `update_channel` settings.
**Supports:** [SPEC](SPEC.md) O1 (install, update and recover) and O5 (release promise). Required before 1.0. Owner, 2026-11-07: "Another we need here for 1.0 (if not already done) - on install, we should check for gstack and extend and install them if missing + turn on auto upgrade on stable for both — they are dependencies" and "This can be deferred to be done right before 1.0".
**Done when:** An `update_channel` setting selects a stable channel (release tags, or a stable branch the release step advances, chosen in the plan) and keeps today's main-tracking behavior available, with existing main-tracking installs and the rollback recipe documented in `docs/installation.md`; `bin/update-check` offers and `bin/update-run` installs the same release identity, or reports the mismatch; a documented non-interactive command enables auto-upgrade on the channel; `setup` reports a missing gstack install actionably (installing it stays the bootstrap's job unless the plan shows otherwise); the Bun 1.3.3 launcher lists in `docs/installation.md` and `CLAUDE.md` name every launcher that needs it (both omit `bin/review-state`, and the installation guide also `bin/review-delegate` and `bin/upstream-check`; verified 2026-11-13); `bin/update-check`'s published output and install-safety stay compatible; the compatibility catalog lists the setting, and its Cursor and OpenCode retired-surface entry names Track 92A's release (`0.109.0`; Track 92A's plan follow-up 92E); a dated upgrade through the stable channel on the owner's machine is added to the install qualification record.
_touches: bin/update-check, bin/update-run, bin/config, setup, docs/installation.md, docs/compatibility.md, tests/update.test.ts, docs/acceptance/install-upgrade.md, CLAUDE.md_
_blocked-by: Track 95A, Track 77A, Track 94D_
**Scheduling:** Placed "right before 1.0" (owner): the edge on the workflow qualification is a priority choice; the edges on the catalog (shipped) and install qualification Tracks are technical (it adds the setting to the catalog and appends to the install record). Facts rechecked 2026-11-13: `bin/update-run` fast-forwards `origin main`; there is no channel setting; `setup` checks only that `bun` exists; `bin/config set auto_upgrade true` is honored only by interactive upgrade flows, and spawned sessions never upgrade. An orchestrator's bootstrap does its own install-if-missing; this repository owes the channel, the setting and the non-interactive enable path.
_Source: owner-approved card (2026-11-07); Track 92A's plan follow-up 92E (PR #290's approved plan): add the released version to the catalog's retired-surface entry at the next regeneration, which cannot edit `docs/compatibility.md`, so this Track carries it through its own catalog edit; merges the Future entry "Bind upgrade offers to the installed release identity" (raised during Track 28A planning, 2026-10-23), which the owner's word pulls into 1.0._
_read-first: docs/installation.md, docs/acceptance/release-compatibility.md_
- **Stable channel and offered-equals-installed identity** -- The `update_channel` key and its values, the channel mechanism, and binding the installed release to the offered one, with update tests. _~170 lines incl. tests._ (M)
- **Non-interactive enable and rollback** -- Document and test the bootstrap command and the return to main tracking. _~50 lines incl. tests._ (S)
- **Report a missing gstack at setup** -- An actionable result when installed gstack is absent, and complete the Bun 1.3.3 launcher lists in `docs/installation.md` and `CLAUDE.md`. _~35 lines incl. tests._ (S)
- **Record a real channel upgrade** -- Upgrade the owner's install through the stable channel and record offered and installed identity in the install qualification record; list the setting in the catalog and name release `0.109.0` in its Cursor and OpenCode retired-surface entry. _~30 lines._ (S)

### Group 97: Install and upgrade aligned with upstream gstack

_Depends on: Group 96_

**This group delivers:** An install and upgrade flow that looks and behaves like upstream gstack's, with a What's-new summary after every upgrade.

##### Track 97A: Align install and upgrade with upstream gstack
_3 tasks . ~290 LOC incl. tests, plus byte-copied shared blocks . medium risk_
**Outcome:** Installing and upgrading gstack-extend looks and behaves like upgrading upstream gstack: the same flow shape and output style, and a "What's new" summary shown after every upgrade.
**Supports:** [SPEC](SPEC.md) O1 (install, update and recover a working skill set). Included in 1.0 by the owner on 2026-11-08: "A but keep 72c and 78a for 1.0". Owner, 2026-11-07: "One thing I want to do at some point is re-align our install and upgrade process with gstack. Both visually and functionally, including the nice release notes presented to the user".
**Done when:** The upgrade flow's steps, prompts and output match upstream `/gstack-upgrade`'s shape, including snooze, auto-upgrade and just-upgraded handling; after every upgrade the user sees a What's-new summary drawn from `CHANGELOG.md` between the old and new versions (or the commit log on a main-tracking install) and a per-host upgrade summary; fresh-install onboarding is compared with gstack's and any gap recorded; install-safety rules, the `UPGRADE_OK`, `UPGRADE_FAILED`, `MIGRATION_WARN` and `INSTALL_WARN` tokens and `bin/update-check`'s published output stay compatible or migrate explicitly with disclosure; the recorded update-check and removed-host detector test gaps have tests.
_touches: skills/gstack-extend-upgrade.md, skills/gstack-extend-init.md, skills/full-review.md, skills/implement.md, skills/plan-track.md, skills/project-spec.md, skills/pair-review.md, skills/ship-and-land.md, skills/roadmap.md, skills/review-and-prep.md, skills/docs-ship.md, bin/update-run, setup, docs/installation.md, tests/skill-protocols.test.ts, tests/update.test.ts, tests/setup-hosts.test.ts_
_blocked-by: Track 96C_
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
waits on a blocker's siblings. In particular, the developer-run Tracks 94D and
94E gate only Track 96C (through Track 94D), Track 94F waits on by-hand Codex or
Muse reviews on the shipped default, and Track 95A waits on the owner's real
runs. Document order is priority, not a gate. The cards label priority choices
separately from technical prerequisites.

```
- Group 94 ← {}
- Group 95 ← {}
- Group 96 ← {94, 95}: Tracks 94A, 94D, 94F, 95A
- Group 97 ← {96}: Track 96C
```

Track detail per group:
```
Group 94: Documentation-audit reuse ∥ roadmap and plan-track fixes ∥ developer-run records ∥ remeasurement
  +-- Track 94A ........... ~M . 2 tasks
  +-- Track 94B ........... ~S . 1 task
  +-- Track 94C ........... ~M . 2 tasks
  +-- Track 94D ........... ~M . 2 tasks   (developer's runs)
  +-- Track 94E ........... ~S . 3 tasks   (developer's runs)
  +-- Track 94F ........... ~S . 1 task    (held: by-hand Codex or Muse reviews)
Group 95: Two-driver workflow qualification
  +-- Track 95A ........... ~L . 2 tasks   (holds open: owner's real runs)
Group 96: Pregate-narrowing re-anchor ∥ measured stage cost ∥ stable update channel
  +-- Track 96A ........... ~M . 3 tasks
  +-- Track 96B ........... ~L . 4 tasks
  +-- Track 96C ........... ~M . 4 tasks
Group 97: Install and upgrade aligned with upstream gstack
  +-- Track 97A ........... ~M . 3 tasks
```

**4 Groups / 11 Tracks remaining**, none in progress.

Only owner-confirmed acceptance in PROGRESS can satisfy a stage/checkpoint.

## Future

Deferred: docs/roadmap-future.md (102 items)

## Shipped

History: docs/roadmap-shipped.md
