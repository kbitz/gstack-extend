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
Telemetry provider parity for Claude, Codex and Muse (89B, v0.102.0; 90B,
v0.104.0), the orchestrator consumer's documentation-audit gap value (91A,
v0.106.0) and exact-token reply credit (91B, v0.107.0), the fixed preamble and
install-host removal (92A, v0.108.0 and v0.109.0), the quota and telemetry
removal (93B, v0.110.0) and the gstack 1.102.2.0 review-dispatch fix (93C,
v0.109.1) have shipped. Group 94's completed Tracks have now shipped too:
`/roadmap` scratch paths (94B, v0.110.1), `/plan-track` Track selectors (94C,
v0.111.0), pre-attempt documentation-audit reuse (94A, v0.112.0), the
post-default remeasurement record (94F, PR #299, docs-only, verdict
`insufficient-evidence`), fixed Greptile receipt wording (94G, v0.112.1),
actionable Bun prerequisite failures (94H, v0.112.2), digest-bound skill
reference slimming (94I, PR #302 v0.113.0 and PR #304 v0.114.0) and Grok Build
interactive telemetry qualification (94J, v0.115.0). Two Tracks are in flight in
Group 95: restoring `/review-and-prep`'s `delegate=<part>` part-list clause to
the core skill (95A, fixing a v0.113.0 regression from 94I) and detecting
Antigravity and reading its by-hand runs back as `user-directed` (95B). Group
95 also holds the remaining open install/upgrade qualification obligations
(95C, former 94D, where PR #303 landed the scratch record and left U1–U3 open
on the developer's "SHIP WITH GAPS OPEN" decision). Next in Group 96 come
re-anchoring pregate narrowing and `secret-dispositions` location to installed
gstack 1.103.0.0 (96A, which launches as soon as 95A lands, ahead of the
developer-run Tracks), the remaining real review records and by-hand run-mode
readbacks (96B, former 94E), and the two-driver workflow qualification (96C,
former 95A, whose rows can be harvested from real by-hand runs once 94J and 95B
merge). Behind them come the O6 measurement and decisions (97A, former 96B)
beside the stable update channel the owner placed "right before 1.0" (97B,
former 96C), then aligning install and upgrade with gstack (98A, former 97A).
Only 95C and 96C gate later Groups (97B appends to 95C's record; 97A and 97B
follow 96C). Owner, 2026-11-08: "A but keep 72c and 78a for 1.0", approving a
proposal that moved the review-finding records to Future and kept docs-only test
selection (since shipped) and the gstack alignment (now Track 98A) as 1.0 work.

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
compatibility catalog's retired-surface entry) is carried by Track 97B (former
96C), because this skill does not edit the catalog. The Cursor by-hand readback
was discharged with the reason "Cursor support dropped 2026-11-21".

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



**Labels.** This regeneration (2026-11-24) recorded Tracks 94A, 94B, 94C, 94F
and assigned canonical IDs 94G, 94H, 94I and 94J to the placeholder Tracks
shipped since `81e36f3`, retiring Group 94 by tombstone. Two new Tracks are
declared in flight in Group 95: 95A (restore `/review-and-prep`'s delegate
part-list clause to the core skill; item `93449c95`) and 95B (detect
Antigravity and read its by-hand runs back as `user-directed`; item
`d574f7e2`). Remaining unshipped Tracks recycled from 95 in packer order:
former 94D (U1–U3 open after PR #303) became 95C; 96A kept its ID 96A (widened
for installed gstack `1.103.0.0`'s `secret-dispositions.location.1` drift and
its promoted Future test gap); former 94E became 96B; former 95A became 96C;
former 96B became 97A; former 96C became 97B (with its Bun-launcher-list
sub-item discharged@`39c2b0c` and PR #300's Bun-refusal update-retry test gap
placed); former 97A became 98A. The renames are in this regeneration's commit
message. Shipped numbers through 94 are reserved by tombstones; 64 was never a
roadmap Group.

Target: [SPEC](SPEC.md) O1–O6, 1.0.0 as the owner's own real use by hand and
through an orchestrator; audience ceiling potentially-public. No workspace host
or orchestrator is required; support claims name only exercised combinations.
Implementation, installed/operator evidence and owner acceptance remain
distinct. No new spend or unattended merge is authorized.


## In Progress

Two Tracks are declared in flight at this regeneration (2026-11-24): Track 95A (item `93449c95`, restoring `/review-and-prep`'s `delegate=<part>` part-list clause to the core skill after the v0.113.0 regression) and Track 95B (item `d574f7e2`, detecting Antigravity and reading its by-hand runs back as `user-directed`). Track 95C (former 94D; PR #303 landed the scratch record and left U1–U3 open) shares Group 95's packer bin because its file footprint is disjoint and unblocked, and is not declared in flight. Tracks 94A, 94B, 94C, 94F, 94G, 94H, 94I and 94J shipped since `81e36f3` and are recorded in shipped history. O1 and O3–O6 remain pending; O2 was accepted on 2026-10-23.

### Group 95: Restore delegate part-list clause ∥ Antigravity run-mode telemetry ∥ install/upgrade qualification gaps

_Depends on: none_

**This group delivers:** Core `/review-and-prep` again carrying the `delegate=<part>` part-list clause so transport reviews stop dropping `adversarial` and `red-team`; Antigravity (`agy`) harness detection and by-hand `user-directed` telemetry readback so everyday Antigravity runs count toward O3.3 and O6.1; and, whenever the owner runs them, closure of the open U1–U3 install/upgrade qualification gaps in `docs/acceptance/install-upgrade.md`.

##### Track 95A: Restore review-and-prep's delegate part-list clause to the core skill
_1 task . ~30 LOC incl. tests . low risk_
**Outcome:** The core `skills/review-and-prep.md` again carries the review-policy grammar's delegate part-list clause, so a caller that reads only the loaded `SKILL.md` to learn which parts the skill can delegate (the attacker parts `adversarial` and `red-team` included) sees them again, and reviews launched with `delegate=adversarial` or `delegate=red-team` stop dropping those parts.
**Supports:** [SPEC](SPEC.md) review-policy contract and O3.1; repairs a defect from Track 94I (`v0.113.0`, `ce16f48`, PR #302), whose own rule keeps machine-read text in the core skill.
**Done when:** (1) The core `skills/review-and-prep.md` contains the clause beginning `` `delegate=<part>[,<part>...]` ( `` through its closing `)` (the part list `testing`, `maintainability`, `performance`, `simplification`, `adversarial` and `red-team`, comma-separated, each at most once), byte-identical to its text before `ce16f48`. (2) The reference-split tooling (`scripts/skill-references.ts` `MOVE_MANIFEST`, conservation `dropped=0`, the duplication checks and `tests/helpers/skill-budgets.ts`) stays green: the plan decides whether the clause moves back from `skills/references/review-and-prep/conditional-policy-values.md` or the reference keeps a pointer, with no duplicated rule text. (3) A test pins the clause in the core skill as machine-read text (the same way the other caller-parsed fragments Track 94I kept inline are pinned), so a later slimming cannot move it again. (4) The generated host copies carry the change.
_touches: skills/review-and-prep.md, skills/references/review-and-prep/conditional-policy-values.md, scripts/skill-references.ts, tests/helpers/skill-budgets.ts, tests/skill-references.test.ts, tests/skill-protocols-review-and-prep.test.ts_
_blocked-by: Track 94I_
**Scheduling:** Declared in flight (2026-11-24, item `93449c95`; the developer, 2026-11-24: "do it"). Priority regression fix running alongside Track 95B and ordered ahead of Track 96A, which also edits `skills/review-and-prep.md` and `tests/skill-protocols-review-and-prep.test.ts`. Verified at `5128dce`: the part-list clause currently lives only in `skills/references/review-and-prep/conditional-policy-values.md` (line 86), matching `ce16f48~1:skills/review-and-prep.md` (line 980).
_Source: the manager's note (2026-11-24; item `93449c95`): the orchestrator consumer's transport checks only the loaded `SKILL.md` for the part-list clause, so since v0.113.0 launches warn that the loaded review skill does not carry `delegate=adversarial` or `delegate=red-team` and omit them._
_read-first: scripts/skill-references.ts, docs/acceptance/skill-references.md_
- **Restore the clause, pin it, and refresh generated copies** -- Return the exact `delegate=<part>[,<part>...]` part-list clause from `ce16f48~1` to `skills/review-and-prep.md` with no duplicated rule text against `conditional-policy-values.md`, keep conservation and budget checks green, pin the clause as machine-read core text in tests, and refresh generated host copies. _~30 lines incl. tests._ (S)

##### Track 95B: Detect Antigravity and read its by-hand runs back as user-directed
_2 tasks . ~180 LOC incl. tests . medium risk_
**Outcome:** A stage the developer runs by hand in Antigravity (`agy`), from a terminal or launched through a host app, is recorded with its harness and `run_mode: "user-directed"`, and an orchestrated Antigravity run still reads `orchestrated`, so everyday Antigravity work counts toward Track 96C (former 95A) and Track 96B (former 94E) like Claude, Codex, Muse and Grok work.
**Supports:** [SPEC](SPEC.md) O6.1 (run-mode readback) and O3.3; completes Track 94J (`v0.115.0`, PR #305, item `a4f956d6`), which left Antigravity unsupported.
**Done when:** (1) Antigravity is a detected harness: its session markers are identified from real local sessions (named in the plan with evidence), `agent` records it, and model and effort are read where Antigravity's session store exposes them (absent fields stay null with a reason). (2) A launch-surface reader maps a by-hand Antigravity stage, terminal or host-app launched, to `user-directed` with a qualified source; print-mode stream-JSON launches are classified from evidence, never from `PASEO_AGENT_ID` alone, and fail closed to an explicit non-`user-directed` source when evidence is missing. (3) No orchestrated run reads `user-directed`: `GSTACK_SESSION_KIND` and the run-mode environment keep precedence, with tests for Antigravity's orchestrated and by-hand paths. (4) `docs/stage-runs.schema.json`'s `agent` enum and `docs/telemetry.md`'s harness and run-mode tables add Antigravity; the schema change is disclosed in the release notes as a compatible addition; existing rows are not rewritten.
_touches: bin/lib/telemetry.py, docs/telemetry.md, docs/stage-runs.schema.json, tests/telemetry.test.ts, tests/telemetry-contract.test.ts, tests/helpers/telemetry-env.ts_
_blocked-by: Track 94J_
**Scheduling:** Declared in flight (2026-11-24, item `d574f7e2`). Technical edge on Track 94J (shipped, `v0.115.0`, PR #305), which edited the same telemetry files; runs beside Track 95A on disjoint files. Never read Antigravity credential or config files beyond its session logs; telemetry changes run the full telemetry suite list in `CLAUDE.md`'s Testing section. Tracks 96B and 96C follow this Track so by-hand Antigravity runs count in their readbacks and harvest.
_Source: the developer (2026-11-23): "I run agy by hand all the time, you can tell from all the manual runs" (item `d574f7e2`, after Track 94J's plan left Antigravity as `unknown`/`no-harness` to avoid a schema change outside its card; developer approved adding Antigravity to the published `agent` enum as a compatible schema addition). Verified at `5128dce`: `docs/stage-runs.schema.json` `agent` enum lists `claude`, `codex`, `grok`, `cursor`, `muse`, `null` and `docs/telemetry.md` documents Antigravity/`agy` as `unknown`/`no-harness`._
_read-first: docs/telemetry.md, docs/stage-runs.schema.json_
- **Detect Antigravity sessions and classify launch surfaces** -- Identify Antigravity session markers from local session logs, read available model and effort fields, map terminal and host-app by-hand runs to `user-directed` from positive evidence (failing closed when missing), and keep `GSTACK_SESSION_KIND` and run-mode env precedence for orchestrated runs. _~120 lines incl. tests._ (M)
- **Extend the schema, docs and telemetry suites** -- Add Antigravity to `docs/stage-runs.schema.json`'s `agent` enum (compatible addition, existing rows unchanged) and `docs/telemetry.md`'s harness and run-mode tables, and cover orchestrated and by-hand paths across the telemetry suites. _~60 lines incl. tests._ (S)

##### Track 95C: Qualify install, upgrade and recovery on the owner's machines
_2 tasks . ~100 LOC . medium risk_
**Outcome:** The owner can install, onboard, upgrade and recover a working skill set on a fresh machine from the published instructions, with end-to-end evidence of loaded skill identity and a real legacy four-part upgrade through the default remote.
**Supports:** [SPEC](SPEC.md) O1 (all three criteria) and O5.2; the preserved published three-part upgrade obligation from Track 28A planning (2026-10-23), whose trigger was met by `v0.48.0`.
**Done when:** `docs/acceptance/install-upgrade.md` closes the three open checks left after PR #303 (`5da0ec8`): (1) **U1** — authenticated onboarding and loaded skill identity verified on the exercised Claude Code and Codex profiles after install/upgrade; (2) **U2** — a real legacy four-part install (`v0.47.0.0`) upgraded through the default remote (`https://github.com/kbitz/gstack-extend.git`) following the Task 2 owner runbook, with offered and installed commit/tag identity, v2/v4 reader compatibility, working recovery and unchanged user state (or an explicit recorded owner waiver); and (3) **U3** — disposition of open defects 7 (same-version `JUST_UPGRADED`) and 9 (duplicate `~/.local/bin` tip) and owner confirmation before O1 counts in `docs/PROGRESS.md`.
_touches: docs/acceptance/install-upgrade.md_
_blocked-by: Track 70A, Track 28A_
**Status (2026-11-24):** Not done; gaps U1–U3 stay open. PR #303 (`5da0ec8`, merged 2026-11-23, docs-only, no release) created `docs/acceptance/install-upgrade.md` covering isolated scratch-HOME fresh install and onboarding (`v0.111.0`, `54fd6df`), the live `v0.112.2` (`39c2b0c`, PR #300) Bun prerequisite re-check, one-release upgrade preservation (`v0.110.1` → `v0.111.0`), per-file recovery and rollback/resume. On the developer's "SHIP WITH GAPS OPEN" decision (PR #303, touchpoint `1777c7d5`, bound to `51813798`), U1, U2 (Task 2 published legacy upgrade — open failure) and U3 (owner confirmation of O1) were deferred as PR #303 readiness gates and remain open acceptance obligations here.
**Scheduling:** Not declared in flight; lives in Group 95 only because its file footprint is disjoint and its technical edges on Tracks 70A (`v0.72.0`) and 28A (`v0.47.0.0`) are already satisfied. Candidate or `file://`-remote proof does not satisfy U2. It waits on the owner's time and gates only the stable-channel Track 97B (former 96C), which appends stable-channel upgrade evidence to `docs/acceptance/install-upgrade.md`.
_read-first: docs/acceptance/install-upgrade.md, docs/installation.md, docs/acceptance/release-compatibility.md_
- **Close U1 authenticated onboarding and loaded-skill identity** -- Run a first skill invocation in authenticated Claude Code and Codex sessions after install/upgrade and record loaded revision parity and any open gaps. _~35 lines._ (S)
- **Close U2 published legacy four-part upgrade and U3 owner confirmation** -- Run the Task 2 owner runbook in `docs/acceptance/install-upgrade.md` against the default remote (or record an explicit owner waiver), disposition open defects 7 and 9, and capture owner O1 confirmation for PROGRESS. _~65 lines._ (M)

## Current Plan

_tombstone: 17, 19, 20, 22, 23, 24, 25, 26, 28, 29, 30, 31, 32, 33, 47, 48, 49, 50, 51, 52, 57, 58, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94_

### Group 96: Upstream 1.103.0.0 re-anchor ∥ remaining real review and run-mode records ∥ two-driver workflow qualification

_Depends on: Group 95_

**This group delivers:** Pregate narrowing and `secret-dispositions` location re-anchored to installed upstream gstack `1.103.0.0` with clean `bin/upstream-check` on both hosts and the recorded anchor-inventory and secret-dispositions test gaps covered (ready to start as soon as Track 95A lands, ahead of the developer-run Tracks); the remaining real review records and non-Claude by-hand run-mode readbacks; and real by-hand and orchestrated workflow evidence on the holds-first matrix PR #291 added, harvestable from real by-hand runs once Tracks 94J and 95B have merged.

##### Track 96A: Re-anchor pregate narrowing and secret-dispositions location to installed gstack 1.103.0.0 and cover the recorded test gaps
_4 tasks . ~290 LOC incl. tests . medium risk_
**Outcome:** `/review-and-prep` can narrow the pregate after an accepted full-suite pass again on installed upstream gstack `1.103.0.0`, `bin/secret-dispositions` stays qualified against upstream's `displayPath` finding-location template, `bin/upstream-check` exits clean (`drift=0`) on both hosts, and the recorded anchor-inventory and secret-dispositions test gaps are covered.
**Supports:** [SPEC](SPEC.md) O6 and P1 (inactive narrowing repeats pregate lanes an accepted pass already covered) and O3.1 (two standing `bin/upstream-check` drifts on every launch check on installed gstack `1.103.0.0`). Deferred from Track 93C's plan (d2) with the developer's agreement, updated at this regeneration for installed gstack `1.103.0.0`.
**Done when:** (1) `bin/upstream-check --gstack-root <root>` on both hosts' installed gstack (`1.103.0.0`, revision `0d6cc1be56136706854e40dccf417e008e5c69ab`) exits `0` (`checks=108 drift=0` unless an anchor is added or removed): `review-and-prep.pregate-narrowing.index.1` is re-anchored for `policyFloorCheck` in `lib/pregate/index.ts`, and `secret-dispositions.location.1` is re-anchored for `displayPath(f.file)` in `lib/pregate/checks/secrets.ts`; the plan verifies whether `policyFloorCheck` changes any narrowing coverage assumption (widening `skills/references/review-and-prep/conditional-pregate-and-final-repair.md` if coverage prose changes) and whether `displayPath(f.file)` changes any location-matching assumption in `src/secret-dispositions/evaluate.ts`. (2) The anchor text in `skills/review-and-prep.md` and `src/secret-dispositions/evaluate.ts`, the qualified-revision table in `docs/upstream-check.md`, `PREGATE_NARROW_QUALIFIED`, `FINDING_LOCATION_QUALIFIED` and the protocol, secret-dispositions and CLI tests agree. (3) The seven recorded test gaps from Track 93C's coverage audit (mixed-width delimiters, a leading dangling `or`, repeated dispatch alternatives, keeping alternatives in the final slot, a malformed local adversarial list through the CLI, both dispatch forms and Codex wording in the nested layout, and unreadable upstream review with both attacker items drifting) and the promoted Future test gap for `secret-dispositions` added-line part type guards each have a test, or the plan records why one cannot. (4) The fallback on a missing anchor (pregate runs unmodified with `inactive`; `secret-dispositions` fails closed) is unchanged.
_touches: skills/review-and-prep.md, skills/references/review-and-prep/conditional-pregate-and-final-repair.md, src/upstream-check/cli.ts, src/secret-dispositions/evaluate.ts, docs/upstream-check.md, tests/upstream-check.test.ts, tests/secret-dispositions.test.ts, tests/skill-protocols-review-and-prep.test.ts_
_blocked-by: Track 94A, Track 95A_
**Scheduling:** Ordering edge on Track 95A (in flight, item `93449c95`; both edit `skills/review-and-prep.md` and `tests/skill-protocols-review-and-prep.test.ts`); its edge on Track 94A is satisfied (`v0.112.0`). **Starts ahead of Track 96C (former 95A):** Track 96A has no dependency on two-driver qualification — in the 2026-11-22 plan it sat behind old Group 95 only because its Group 96 siblings waited on old 95A — whereas Track 96C waits on the developer's runs and binds each matrix row to the `producer_version` it ran on so landing 96A does not invalidate runs of other stages; launching 96A as soon as 95A merges eliminates both active `upstream-check` drifts immediately. Both drifts verified 2026-11-24 at `5128dce` with `bin/upstream-check --gstack-root` on `~/.claude/skills/gstack` and `~/.codex/skills/gstack` (`1.103.0.0`, `checks=108 drift=2`): `lib/pregate/index.ts:39` adds `policyFloorCheck` after `literalsCheck`, and `lib/pregate/checks/secrets.ts:248` wraps `${f.file}` in `${displayPath(f.file)}`. Widens `_touches:` to `skills/references/review-and-prep/conditional-pregate-and-final-repair.md` per Track 94I's open-verification note in `docs/acceptance/skill-references.md`. Absorbs the superseded Future entry "Requalify the pregate-narrowing registry anchor on installed gstack 1.97" and places the promoted Future test gap "Recorded test gap: secret-dispositions added-line part type guards" (its trigger is met here).
_Source: the manager's note (2026-11-22), `docs/acceptance/release-compatibility.md` (Track 93C's "Remaining unrelated drift disclosure"), live `bin/upstream-check` verification on installed gstack `1.103.0.0` (2026-11-24), inbox `[review:files=src/upstream-check/cli.ts|tests/upstream-check.test.ts]` items from PR #293 (`ff5473c3`), and Future entries "Requalify the pregate-narrowing registry anchor on installed gstack 1.97" and "Recorded test gap: secret-dispositions added-line part type guards"._
_read-first: docs/upstream-check.md, docs/acceptance/release-compatibility.md, docs/secret-dispositions.md_
- **Re-anchor the `CHECKS` and finding-location anchors on 1.103.0.0** -- Update `review-and-prep.pregate-narrowing.index.1` (`policyFloorCheck`) and `secret-dispositions.location.1` (`displayPath(f.file)`), verify narrowing and location-matching assumptions, and update `PREGATE_NARROW_QUALIFIED`, `FINDING_LOCATION_QUALIFIED`, `docs/upstream-check.md` and tests. _~80 lines incl. tests._ (M)
- **Cover the parser-shape gaps** -- Four fixtures for the dispatch-alternative inventory: a mixed-width delimiter span, a leading `or`, a repeated alternative and an earlier-slot join paired with a later split. _~80 lines._ (S)
- **Cover the CLI-level gaps** -- Three fixtures through `bin/upstream-check`: a malformed local adversarial list, Codex wording in the nested layout with both exact forms together, and an unreadable upstream review. _~90 lines._ (S)
- **Cover the secret-dispositions added-line part type guards** -- Extend the malformed-part table in `tests/secret-dispositions.test.ts` to independently pin null, primitive and array parts, missing or non-string `file`, non-string legacy `text`, non-array `texts` or `keep`, and a non-array collection passed to `evaluate()`. _~40 lines._ (S)

##### Track 96B: Record the owner's remaining real review runs and by-hand run-mode readbacks
_3 tasks . ~120 LOC . low risk_
**Outcome:** The owner can see from dated records that a by-hand review with no caller lines still runs as before, that the attacker parts run with per-part models when an orchestrator delegates them, that tools-mode delegation works on an installed release, and that a stage run by hand in Codex, Muse, Grok Build or Antigravity reads back with the run mode the shared rule promises.
**Supports:** [SPEC](SPEC.md) O6 and P1, O6.1, O3.3 (the by-hand driver's evidence) and O4.4. The remainder of the earlier Track 80D (PR #256, `v0.94.2`), which left attacker-parts PM1 and PM2 and tools-mode PM1 pending; the open acceptance of Track 72B (PR #221) and the post-release PM1 of the owner-approved tools-mode plan (PR #229); and the post-merge by-hand readbacks left pending by Track 90B (PR #283; Cursor discharged on 2026-11-21), Track 94J (PR #305, `v0.115.0`, qualifying Grok Build as `user-directed`/`terminal-session`) and Track 95B (in flight, Antigravity).
**Done when:** (1) `docs/acceptance/attacker-parts.md` records PM1 (one real by-hand `/review-and-prep` with no `Review policy:` or `Review delegates:` line, read back as unchanged, with its invocation and receipt retained) and PM2 (one orchestrated run with `delegate=adversarial,red-team` mapping the two parts to different providers or models, with its `Delegated part:` lines, v3 attempts, `found_by` labels and any fallbacks), each with date, revision, host and harness versions and PR. (2) `docs/acceptance/delegate-tools-mode.md` records its PM1 installed paired run and names the exact reviewed content its earlier dry-run evidence covers. (3) Each pending non-Claude row in `docs/acceptance/hand-use-telemetry.md`'s "Pending post-merge by-hand readbacks" (Codex, Muse, Grok Build — updated from its pre-94J `harness-unqualified` expectation to `user-directed`/`terminal-session` per Track 94J — plus Antigravity once Track 95B merges; the Cursor row stays discharged with "Cursor support dropped 2026-11-21") is run by hand and read back through `gstack-extend-telemetry report --by-host` and the ledger's `agent`, `run_mode` and `run_mode_source`, or stays pending with the reason. (4) A failed, unavailable or wrongly read-back run stays recorded as open, never as passed, and a wrong read-back is filed as a defect.
_touches: docs/acceptance/attacker-parts.md, docs/acceptance/delegate-tools-mode.md, docs/acceptance/hand-use-telemetry.md_
_blocked-by: Track 94J, Track 95B_
**Scheduling:** Technical edges on Track 94J (shipped, `v0.115.0`, PR #305) and Track 95B (in flight, item `d574f7e2`) so the by-hand readback table covers Grok Build and Antigravity alongside Codex and Muse; it gates no other Track. PM2 already has partial observations (PRs #250 and #253 and a consumer repository's review) and waits only on harness CLI version provenance, which the run's operator can record from the harness at run time; tools-mode PM1 waits on the orchestrator's paired tools-mode run, requested on 2026-11-15. By-hand runs recorded here can also supply rows harvested by Track 96C (former 95A).
_Source: PR #256's receipt (2026-11-15: "attacker PM1/PM2 and paired tools-mode qualification remain pending"); `docs/acceptance/attacker-parts.md` and `docs/acceptance/delegate-tools-mode.md` (PM rows pending); PR #283's receipt ("post-merge hand-run readbacks PM1–PM4 in Codex, Muse, Grok and Cursor") and `docs/acceptance/hand-use-telemetry.md` (pending Codex, Muse and Grok rows; Cursor discharged 2026-11-21); PR #305's receipt ("Live by-hand readbacks are tracked in Track 94E"); and Track 95B's card (item `d574f7e2`)._
_read-first: docs/delegated-review.md, docs/acceptance/hand-use-telemetry.md, docs/telemetry.md_
- **Attacker parts PM1 and PM2** -- Run and read back one by-hand review with no caller lines, and finish PM2's harness version provenance. _~50 lines._ (S)
- **Tools-mode PM1 and provenance** -- Record the installed paired run and name the content the dry-run record covers. _~40 lines._ (S)
- **By-hand run-mode readbacks** -- Run one stage by hand in each installed non-Claude harness (Codex, Muse, Grok Build, Antigravity) as its row describes and record the readback or the reason it stays pending. _~30 lines._ (S)

##### Track 96C: Qualify the workflow with two real drivers
_2 tasks . ~240 LOC . medium risk_
**Outcome:** The owner can carry real work through every stage both by hand and through a real external orchestrator, and the evidence shows what the documented contract actually supports.
**Supports:** [SPEC](SPEC.md) O3.3 and O4.5 (reshaped from the Paseo host Track by the owner, 2026-11-07: "72c ok").
**Done when:** A dated record names host, harness and versions for real runs by both drivers (the owner by hand, and one real external orchestrator), each run read back in telemetry with the correct run mode, covering, between them, a complete plan-to-authorized-release workflow, interrupted resume, manual-testing pause/resume, `/full-review` finish/restart, an explicit negative hold, an external-consumer handoff consumed from artifacts, a cross-session handoff and stale/partial/held handoffs; it counts operator interventions and keeps pending approvals or failures as holds; it includes the installed `/docs-ship` acceptance below; no unexercised combination is claimed.
_touches: docs/acceptance/workflow-drivers.md_
_blocked-by: Track 70A, Track 72C, Track 71E, Track 74A, Track 76A, Track 75A, Track 26A, Track 23I, Track 23A, Track 26B, Track 65A, Track 66A, Track 66B, Track 72A, Track 79A, Track 80B, Track 87A, Track 89A, Track 90A, Track 91A, Track 90B, Track 91B, Track 92A, Track 94J, Track 95B_
**Status (2026-11-24):** Not done; holds stay open. PR #291 (`bbcdd0a`, merged 2026-11-22, documentation only, no release) added `docs/acceptance/workflow-drivers.md` as a holds-first matrix of 23 rows (14 `WD-*` and 9 `DS-*`; 0 pass, 23 hold at `8077fa2`), the runbooks for both drivers and seven post-92A telemetry observations. Criteria 1–2 still need the owner's real by-hand runs and one real external orchestrator's runs, each read back in telemetry; no row passes without its own live evidence on `producer_version >= 0.109.0`, and pending approvals or failures stay holds.
**Scheduling:** Runs on the final behavior of the stages it qualifies, so it follows every Track that changed them through Track 92A (`v0.109.0`, shipped), plus Track 94J (`v0.115.0`, shipped, PR #305) and Track 95B (in flight, item `d574f7e2`). **Report-only harvest after 94J and 95B merge:** once Track 94J (Grok Build run-mode) and Track 95B (Antigravity run-mode) are both merged and installed, this Track's by-hand rows can be harvested from the developer's real by-hand runs across Claude, Codex, Muse, Grok Build and Antigravity as a report-only readback step, alongside orchestrated runs. **Track 96A starts ahead of this Track:** Track 96A does not wait on these developer runs, because this record binds each row to the `producer_version` it ran on and re-anchoring `upstream-check` does not invalidate runs of other stages. The other developer-run record Tracks (95C, 96B) do not gate this one; a run here can supply their rows. The external orchestrator may stop at a ready PR; a separate authorized run by hand proves landing. No consumer-repo edits, new spend, unattended release or acceptance-by-idle-status. The independently followed onboarding attempt moved to the public-release stage (Future).
- **Exercise both drivers** -- Run or harvest the matrix's rows (the record exists; this task fills it). Use real host-managed workspaces and approved accounts with the harnesses the owner uses for each stage; retain the bound PR and workspace, test stale/partial/held handoffs, confirm next-stage consumption from artifacts across sessions, include the host-attribution check deferred from Track 26A, and count operator interventions. _~200 documentation lines._ (L)
- **Include installed `/docs-ship` acceptance** -- Run a real docs-only PR through classification, a no-write classification hand-back, selected tests once, same-tree test-record reuse, final receipt hash, policy bump and `docs-ship/v1` without merging, and its interactive merge question; include one Sonnet-class run and one `/roadmap` handoff, and compare work/wait wall time with a recent docs PR shipped through the ordinary path. _~40 lines._ (S)

### Group 97: Measured stage cost ∥ stable update channel

_Depends on: Group 95, Group 96_

**This group delivers:** Expected cost per stage with an adopt, reject or insufficient-evidence decision for every candidate optimization and the opted-in policy records' after fields filled; and upgrades that follow a stable release channel with a non-interactive auto-upgrade switch.

##### Track 97A: Measure each stage's cost and decide each optimization
_4 tasks . ~500 LOC incl. tests . medium risk_
**Outcome:** The owner can reproduce an offline report of each stage's measured cost (model work, tool/CI/human waits, reuse and rework), read a documented expected cost per stage, and see an adopt, reject or insufficient-evidence decision for every candidate optimization.
**Supports:** [SPEC](SPEC.md) O6.1–O6.3 (owner, 2026-11-07: P1 joins the 1.0 outcomes with this finish line, and this Track gains the expected stage cost).
**Done when:** A reproducible offline report from sanitized projections separates DOCS/FULL/release-only paths, diff/task size, repo/host, run mode, skill version, waits and fresh versus resumed runs, and reports sample size and missingness; fixtures cover each split. A documented expected cost per stage (wall time and model usage, with sample size and unknowns) is published. Each efficiency-program candidate, including first-cycle overlap (69A), fold, delegation, the docs-only selection and the review run-state redesign (E15, whose adopt decision is Track 86A's record and whose post-default `insufficient-evidence` remeasurement and bounded next measurement are Track 94F's record in `docs/acceptance/review-run-state.md` §5), has measured evidence or a named evidence gap and an adopt, reject or insufficient-evidence decision with its follow-up mapped to existing Future items. The after fields that opted-in review-policy records still hold as unknown are filled from real opted-in runs where they exist, or named as evidence gaps: `docs/acceptance/review-fix-policy.md` for Tracks 33A, 51A and 75A (including whether an installed agent judged 75A's shown evidence and post-audit change classes as the skill asks) and the three after wall times in `docs/acceptance/external-gate.md`. No review gate, model choice or default changes through the study itself.
_touches: scripts/workflow-efficiency-report.py (new), tests/workflow-efficiency-report.test.ts (new), tests/fixtures/workflow-efficiency/ (new), tests/helpers/touchfiles.ts, docs/acceptance/workflow-efficiency.md (new), docs/acceptance/review-fix-policy.md, docs/acceptance/external-gate.md_
_blocked-by: Track 67A, Track 52A, Track 77A, Track 75A, Track 75B, Track 86A, Track 94F, Track 96C_
**Scheduling:** Kept as one card above ~300 lines under the card-size rule's same-files exception (owner direction, 2026-10-26): the evaluation edits the same script, test and fixture files and reads the report the baseline builds. Its edge on Track 94F is satisfied (PR #299, `f6b4267`, docs-only: verdict `insufficient-evidence` with a bounded next measurement); it follows the workflow qualification (Track 96C, former 95A), whose real runs supply most of its rows, and reads Tracks 86A and 94F instead of repeating them. Session weight 6.
_Source: the Future entries "Fill the external-gate record's three "after" wall times from a real opted-in run", "Fill Track 51A's criterion-7 "after" count at the first opted-in run after a release" and "Fill Track 33A's "after" measurement and pair it with a run without the values"; PR #234's receipt (Track 75A: installed-agent judgment unmeasured, "after" unknown), 2026-11-10._
_read-first: docs/telemetry.md, docs/quota-ledger.md, docs/designs/review-independence.md, docs/acceptance/review-run-state.md_
- **Build a comparable baseline and expected stage costs** -- Produce the offline report and the per-stage expected cost from it; reuse eligible release-only receipts and preserve the first-installed-no-CI timing obligation and 15-minute target; report time to push and merge gate separately from human approval. Observational differences are not causal model comparisons. _~200 lines._ (M)
- **Assess the uncertain efficiency choices** -- Compare smaller models and lower effort for bounded drafting/extraction versus the main runner, including launch/context-transfer and parent-correction costs; investigate repeated plan extraction, evidence reads, long-suite reruns, section loading, parallel scheduling and each reviewer voice's unique accepted findings. Define corpus, quality bars, fixed budgets and stop rules before any model trial; offline analysis only, and any paid trial needs a separately approved pilot and spend bound. _~180 lines._ (M)
- **Publish decisions and follow-up ownership** -- Adopt/reject/insufficient-evidence per candidate with expected benefit, observed limitations and the smallest follow-up, mapped to existing Future items; an insufficient-evidence result names missing data and a bounded next measurement and never silently removes a review or acceptance gate. _~80 lines._ (S)
- **Fill the opted-in policy records' after fields** -- From the receipts and ledger records of real opted-in runs (PRs #233 and #234 already carry `test-gaps=record`; record which values each run carried), fill or name as gaps the after fields of the 33A, 51A and 75A sections and the external-gate record, pairing with runs without the values where the records ask. _~40 lines._ (S)

##### Track 97B: Follow a stable release channel and let a bootstrap turn on auto-upgrade
_5 tasks . ~290 LOC incl. tests . medium risk_
**Outcome:** gstack-extend upgrades follow a stable release channel rather than main, each upgrade installs the release it offered, and a bootstrap script can turn on auto-upgrade on that channel without a prompt, mirroring gstack's `auto_upgrade` and `update_channel` settings.
**Supports:** [SPEC](SPEC.md) O1 (install, update and recover) and O5 (release promise). Required before 1.0. Owner, 2026-11-07: "Another we need here for 1.0 (if not already done) - on install, we should check for gstack and extend and install them if missing + turn on auto upgrade on stable for both — they are dependencies" and "This can be deferred to be done right before 1.0".
**Done when:** An `update_channel` setting selects a stable channel (release tags, or a stable branch the release step advances, chosen in the plan) and keeps today's main-tracking behavior available, with existing main-tracking installs and the rollback recipe documented in `docs/installation.md`; `bin/update-check` offers and `bin/update-run` installs the same release identity, or reports the mismatch; a documented non-interactive command enables auto-upgrade on the channel; `setup` reports a missing gstack install actionably (installing it stays the bootstrap's job unless the plan shows otherwise); retrying an update after a Bun prerequisite refusal with a supported Bun version is covered by an update test; `bin/update-check`'s published output and install-safety stay compatible; the compatibility catalog lists the setting, and its Cursor and OpenCode retired-surface entry names Track 92A's release (`0.109.0`; Track 92A's plan follow-up 92E); a dated upgrade through the stable channel on the owner's machine is added to `docs/acceptance/install-upgrade.md`.
_touches: bin/update-check, bin/update-run, bin/config, setup, docs/installation.md, docs/compatibility.md, tests/update.test.ts, docs/acceptance/install-upgrade.md_
_blocked-by: Track 77A, Track 95C, Track 96C_
**Scheduling:** Placed "right before 1.0" (owner): the edge on the workflow qualification (Track 96C, former 95A) is a priority choice; the edges on the catalog (Track 77A, shipped) and install qualification (Track 95C, former 94D) are technical (it adds the setting to the catalog and appends to `docs/acceptance/install-upgrade.md`). Facts rechecked 2026-11-24 at `5128dce`: `bin/update-run` still fast-forwards `origin main`; there is no channel setting; `setup` enforces Bun >= 1.3.3 via `bin/lib/bun-prereq.sh` (Track 94H, `v0.112.2`) and still checks no installed gstack; `bin/config set auto_upgrade true` is honored only by interactive upgrade flows, and spawned sessions never upgrade; the earlier sub-item to complete the Bun 1.3.3 launcher lists in `docs/installation.md` and `CLAUDE.md` was discharged@`39c2b0c` (Track 94H, PR #300, so `CLAUDE.md` drops from `_touches:`). Places Track 94H's recorded test gap `[review:files=bin/update-run|setup|tests/update.test.ts]` ("Cover retrying an update after a Bun refusal", PR #300 coverage audit at `aaf05a0`), whose files are covered here and which fits within 5 tasks and session weight 6. An orchestrator's bootstrap does its own install-if-missing; this repository owes the channel, the setting and the non-interactive enable path.
_Source: owner-approved card (2026-11-07); Track 92A's plan follow-up 92E (PR #290's approved plan); merges the Future entry "Bind upgrade offers to the installed release identity" (raised during Track 28A planning, 2026-10-23); inbox `[review:files=bin/update-run|setup|tests/update.test.ts]` from PR #300 (`aaf05a0`, 2026-11-23)._
_read-first: docs/installation.md, docs/acceptance/release-compatibility.md, docs/acceptance/install-upgrade.md_
- **Stable channel and offered-equals-installed identity** -- The `update_channel` key and its values, the channel mechanism, and binding the installed release to the offered one, with update tests. _~170 lines incl. tests._ (M)
- **Non-interactive enable and rollback** -- Document and test the bootstrap command and the return to main tracking. _~50 lines incl. tests._ (S)
- **Report a missing gstack at setup** -- An actionable result when installed gstack is absent. _~20 lines incl. tests._ (S)
- **Cover retrying an update after a Bun refusal** -- Add a disposable-remote fixture with two local Bun binaries to `tests/update.test.ts` verifying that retrying after a Bun prerequisite refusal completes pending migrations once. _~25 lines._ (S)
- **Record a real channel upgrade** -- Upgrade the owner's install through the stable channel and record offered and installed identity in `docs/acceptance/install-upgrade.md`; list the setting in the catalog and name release `0.109.0` in its Cursor and OpenCode retired-surface entry. _~30 lines._ (S)

### Group 98: Install and upgrade aligned with upstream gstack

_Depends on: Group 97_

**This group delivers:** An install and upgrade flow that looks and behaves like upstream gstack's, with a What's-new summary after every upgrade.

##### Track 98A: Align install and upgrade with upstream gstack
_3 tasks . ~290 LOC incl. tests, plus byte-copied shared blocks . medium risk_
**Outcome:** Installing and upgrading gstack-extend looks and behaves like upgrading upstream gstack: the same flow shape and output style, and a "What's new" summary shown after every upgrade.
**Supports:** [SPEC](SPEC.md) O1 (install, update and recover a working skill set). Included in 1.0 by the owner on 2026-11-08: "A but keep 72c and 78a for 1.0". Owner, 2026-11-07: "One thing I want to do at some point is re-align our install and upgrade process with gstack. Both visually and functionally, including the nice release notes presented to the user".
**Done when:** The upgrade flow's steps, prompts and output match upstream `/gstack-upgrade`'s shape, including snooze, auto-upgrade and just-upgraded handling; after every upgrade the user sees a What's-new summary drawn from `CHANGELOG.md` between the old and new versions (or the commit log on a main-tracking install) and a per-host upgrade summary; fresh-install onboarding is compared with gstack's and any gap recorded; install-safety rules, the `UPGRADE_OK`, `UPGRADE_FAILED`, `MIGRATION_WARN` and `INSTALL_WARN` tokens and `bin/update-check`'s published output stay compatible or migrate explicitly with disclosure; the recorded update-check and removed-host detector test gaps have tests.
_touches: skills/gstack-extend-upgrade.md, skills/gstack-extend-init.md, skills/full-review.md, skills/implement.md, skills/plan-track.md, skills/project-spec.md, skills/pair-review.md, skills/ship-and-land.md, skills/roadmap.md, skills/review-and-prep.md, skills/docs-ship.md, bin/update-run, setup, docs/installation.md, tests/skill-protocols.test.ts, tests/update.test.ts, tests/setup-hosts.test.ts_
_blocked-by: Track 97B_
**Scheduling:** The owner first said "at some point" (2026-11-07), then included it in 1.0 (2026-11-08). The edge on the stable-channel Track (97B, former 96C) orders edits to the same upgrade files behind it. It lists every skill file because the shared `SHARED:upgrade-flow` block is byte-copied into each of them (all eleven skills kept `SHARED:upgrade-flow` in their core `skills/*.md` after Track 94I, verified 2026-11-24 at `5128dce`); those copies do not count toward the card size. Facts rechecked 2026-11-24: `skills/gstack-extend-upgrade.md` still only points the user at `CHANGELOG.md` and shows no summary, while upstream `/gstack-upgrade` shows a grouped What's-new summary; release text from 0.68.0 to 0.72.0 is thin, so the summary is only as good as the CHANGELOG.
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
waits on a blocker's siblings. In particular, Track 96A waits only on in-flight
Track 95A (not on Track 95C or Track 96C), Tracks 96B and 96C wait on Track 95B
(and once 94J and 95B merge, Track 96C's by-hand rows can be harvested as a
report-only step), and Track 95C gates only Track 97B. Document order is
priority, not a gate. The cards label priority choices separately from
technical prerequisites.

```
- Group 95 ← {}
- Group 96 ← {95}: Tracks 95A, 95B
- Group 97 ← {95, 96}: Tracks 95C, 96C
- Group 98 ← {97}: Track 97B
```

Track detail per group:
```
Group 95: Restore delegate part-list clause ∥ Antigravity run-mode telemetry ∥ install/upgrade qualification gaps (in progress: 95A, 95B)
  +-- Track 95A ........... ~S . 1 task    (in flight: item 93449c95)
  +-- Track 95B ........... ~M . 2 tasks   (in flight: item d574f7e2)
  +-- Track 95C ........... ~M . 2 tasks   (not in flight: U1–U3 open, owner's runs)
Group 96: Upstream 1.103.0.0 re-anchor ∥ remaining real review and run-mode records ∥ two-driver workflow qualification
  +-- Track 96A ........... ~M . 4 tasks   (starts after 95A, ahead of 96C)
  +-- Track 96B ........... ~S . 3 tasks   (developer's runs)
  +-- Track 96C ........... ~L . 2 tasks   (holds open: harvestable after 94J + 95B)
Group 97: Measured stage cost ∥ stable update channel
  +-- Track 97A ........... ~L . 4 tasks
  +-- Track 97B ........... ~M . 5 tasks
Group 98: Install and upgrade aligned with upstream gstack
  +-- Track 98A ........... ~M . 3 tasks
```

**4 Groups / 9 Tracks remaining**, 2 in progress (Tracks 95A and 95B).

Only owner-confirmed acceptance in PROGRESS can satisfy a stage/checkpoint.

## Future

Deferred: docs/roadmap-future.md (111 items)

## Shipped

History: docs/roadmap-shipped.md
