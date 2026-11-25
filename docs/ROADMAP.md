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

**Order.** Since the 2026-11-24 regeneration (`982a49e`, PR #306), Track 96A
shipped across PR #309 (`638e2b5`, `v0.116.1`, pregate narrowing on gstack
`1.103.0.0` and the seven Track 93C `upstream-check` test gaps) and PR #310
(`beb8956`, `v0.116.2`, `secret-dispositions` quoted finding paths, the
`display-path` anchor and the promoted part-type-guard tests; live
`bin/upstream-check` exits `0` with `checks=109 drift=0` on both installed
hosts). The work-item IDs Track shipped as canonical Track 96D (`wi-914dff`,
PR #311, `d71d363`, `v0.117.0`, item `6c091012`), with bulk migration of
existing records and Git-history ID retirement split into a follow-up Track on
the developer's SPLIT decision (`1f5f60a3-9712-4b45-9d8b-0912e761fe7f`).

In flight now in Group 97 (`## In Progress`) is Track 97A (`wi-2cf4fb`, item
`8b742bc1`), replacing hand-written fence scanning in the six block-structure
planning-file readers with `marked` (upstream gstack's Markdown lexer). Group
97 also carries the three disjoint owner-run acceptance Tracks: install/upgrade
qualification gaps U1–U3 (97B, former 95C), remaining real review records and
by-hand run-mode readbacks (97C, former 96B), and two-driver workflow
qualification (97D, former 96C, whose by-hand rows can be harvested from real
runs). Queued behind 97A in developer-requested order are one-file-per-record
machine intake (Track 98A in Group 98, beside the O6 cost measurement and
decisions Track 98B, former 97A), then bulk work-item ID migration and
Git-history retirement (Track 99A in Group 99), then implicit state-machine
detection in `/full-review` (Track 100A in Group 100, behind 99A and not ahead
of 98A, beside the stable update channel Track 100B, former 97B, which the
owner placed "right before 1.0"), and finally aligning install and upgrade with
upstream gstack (Track 101A in Group 101, former 98A). Only 97A, 97B, 97D, 98A,
99A, 100A and 100B gate later Groups. Owner, 2026-11-08: "A but keep 72c and
78a for 1.0", approving a proposal that moved the review-finding records to
Future and kept docs-only test selection (since shipped) and the gstack
alignment (now Track 101A) as 1.0 work.

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
compatibility catalog's retired-surface entry) is carried by Track 100B (former
97B), because this skill does not edit the catalog. The Cursor by-hand readback
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

**Labels.** This regeneration (2026-11-25) recorded Track 96A (`wi-27630b`,
PR #309 `638e2b5` `v0.116.1` and PR #310 `beb8956` `v0.116.2`) and assigned
canonical shipped ID Track 96D (`wi-914dff`, PR #311 `d71d363` `v0.117.0`, item
`6c091012`) to the work-item IDs Track, retiring Groups 95 and 96 by
tombstones. Every emitted Track carries an immutable `_id: wi-<hex>_` minted
with `bin/roadmap-id mint`. Track 97A (`wi-2cf4fb`, item `8b742bc1`) is
declared in flight in Group 97; new Tracks 98A (`wi-4149dd`), 99A (`wi-553a78`)
and 100A (`wi-84aea9`) are queued behind it in developer-requested order.
Remaining unshipped Tracks recycled from 97 in packer order: former 95C became
97B (`wi-4732d3`); former 96B became 97C (`wi-8b4a30`); former 96C became 97D
(`wi-9d6cf2`); former 97A became 98B (`wi-b1f0bd`); former 97B became 100B
(`wi-b9f147`); former 98A became 101A (`wi-2633cf`). The renames are in this
regeneration's commit message. Shipped numbers through 96 are reserved by
tombstones; 64 was never a roadmap Group.

Target: [SPEC](SPEC.md) O1–O6, 1.0.0 as the owner's own real use by hand and
through an orchestrator; audience ceiling potentially-public. No workspace host
or orchestrator is required; support claims name only exercised combinations.
Implementation, installed/operator evidence and owner acceptance remain
distinct. No new spend or unattended merge is authorized.


## In Progress

### Group 97: Markdown lexer for planning files ∥ install/upgrade qualification gaps ∥ remaining real review and run-mode records ∥ two-driver workflow qualification

_Depends on: none_

**This group delivers:** Block-structure lexing for the six planning-file readers via `marked` (Track 97A, in flight now as item `8b742bc1`); and, whenever the owner runs them, closure of the open U1–U3 install/upgrade qualification gaps (97B), the remaining real review records and non-Claude by-hand run-mode readbacks (97C), and real by-hand and orchestrated workflow evidence on the holds-first matrix PR #291 added (97D).

##### Track 97A: Read planning files' block structure with a real Markdown lexer, as upstream gstack does
_2 tasks . ~250 LOC incl. tests . medium risk_
_id: wi-2cf4fb_
**Outcome:** `bin/roadmap-audit`, `bin/roadmap-pack` and the other planning-file readers find headings, fenced code, HTML blocks and lists through `marked`'s CommonMark/GFM lexer (the parser upstream gstack already ships as a runtime dependency) instead of hand-written line patterns, so a fenced or commented example in `ROADMAP.md`, `TODOS.md` or the roadmap side files is never read as a planning record and the hand-rolled fence logic goes away.
**Supports:** [SPEC](SPEC.md) O2 (roadmap and audit contracts). Fixes an encountered defect class.
**Done when:** (1) One shared helper under `src/audit/lib/` lexes a planning file with `marked` and yields the top-level lines the record parsers read, with their original line numbers; the six block-structure readers — ROADMAP state-region detection (`src/audit/lib/state.ts`), the roadmap and TODOS parsers (`src/audit/parsers/roadmap.ts`, `src/audit/parsers/todos.ts`), and the mode, state-section and structure checks (`src/audit/checks/mode.ts`, `src/audit/checks/state-sections.ts`, `src/audit/checks/structure.ts`) — use it, and no hand-written fence scanner remains in those paths. (2) A fence marker inside an HTML comment, a fenced example inside a list, indented and tilde fences, and a closing fence followed by a non-ASCII space each leave the records after them visible: regression fixtures, including the HTML-comment and list-example probes from Track 96D's review (PR #311, continuation 5), pass. (3) Every existing `tests/roadmap-audit/*/expected.txt` snapshot is unchanged, or each change is listed in the PR and justified as a fix. (4) `marked` is pinned to an exact version as a runtime dependency; `setup`, `gstack-extend init`, the update path and every Bun launcher (which pass `--no-install`) install or find it without a network fetch at run time, and `docs/installation.md` says so; a fresh install and an upgrade from the previous release both pass on the documented Bun minimum. (5) Release notes disclose the new runtime dependency.
_touches: src/audit/lib/state.ts, src/audit/lib/ (new), src/audit/parsers/roadmap.ts, src/audit/parsers/todos.ts, src/audit/checks/mode.ts, src/audit/checks/state-sections.ts, src/audit/checks/structure.ts, package.json, bun.lock, setup, bin/lib/bun-prereq.sh, bin/gstack-extend, bin/update-run, docs/installation.md, tests/parsers-roadmap.test.ts, tests/parsers-todos.test.ts, tests/pack-cli.test.ts, tests/check-structure-tombstone.test.ts, tests/roadmap-audit/, tests/setup-hosts.test.ts, tests/update.test.ts_
_blocked-by: wi-914dff_
**Status (2026-11-25):** Declared in flight (in planning as the orchestrator's item `8b742bc1`). Approved plan scope is strictly the six block-structure readers above; nested bold in Future titles (`wi-b43f6a`, deferred to Future alongside `vocab-lint.ts`/`cli.ts` lexer boundaries and heading test gaps) and the scattered-TODO scanner in `todo-patterns.ts` (`wi-331497`, killed as an unobserved defect) stay outside this Track.
**Scheduling:** Its prerequisite on Track 96D (`wi-914dff`, PR #311, `v0.117.0`) is satisfied. Queued ahead of Track 98A (one-file-per-record intake) and Track 99A (ID migration), which both read planning files. A new runtime dependency is an install-contract change: planned at standard tier or higher.
_Source: the developer (verbatim, 2026-11-25 13:24:59Z, in the orchestrator manager's chat, after Track 96D's review stopped a fifth time on hand-written fence-parsing defects and the manager reported that upstream gstack uses `marked` where it needs Markdown structure): "I think we should mirror what gstack does, so your proposal sounds good to me"; decision `0dd7578f-ee90-4590-b0e9-1ee598240375`._
_read-first: src/audit/lib/state.ts, src/audit/parsers/roadmap.ts, src/audit/parsers/todos.ts, docs/installation.md_
- **Replace hand-rolled fence scanning in the six readers with a shared `marked` helper** -- Add one shared helper under `src/audit/lib/` that lexes planning files with `marked` and yields top-level lines with original line numbers, wire the six block-structure readers (`state.ts`, `roadmap.ts`, `todos.ts`, `mode.ts`, `state-sections.ts`, `structure.ts`), and add regression fixtures covering HTML comments, list-nested fences, indented/tilde fences and non-ASCII space closers while keeping snapshots clean. _~140 lines incl. tests._ (M)
- **Pin `marked` as a runtime dependency across install, init, update and launchers** -- Pin `marked` to an exact version in `package.json` and `bun.lock`, ensure `setup`, `gstack-extend init`, `bin/update-run` and all `--no-install` Bun launchers resolve it offline at runtime, update `docs/installation.md` and lock fresh-install and upgrade tests on the Bun 1.3.3 floor. _~110 lines incl. tests._ (M)

##### Track 97B: Qualify install, upgrade and recovery on the owner's machines
_2 tasks . ~100 LOC . medium risk_
_id: wi-4732d3_
**Outcome:** The owner can install, onboard, upgrade and recover a working skill set on a fresh machine from the published instructions, with end-to-end evidence of loaded skill identity and a real legacy four-part upgrade through the default remote.
**Supports:** [SPEC](SPEC.md) O1 (all three criteria) and O5.2; the preserved published three-part upgrade obligation from Track 28A planning (2026-10-23), whose trigger was met by `v0.48.0`.
**Done when:** `docs/acceptance/install-upgrade.md` closes the three open checks left after PR #303 (`5da0ec8`): (1) **U1** — authenticated onboarding and loaded skill identity verified on the exercised Claude Code and Codex profiles after install/upgrade; (2) **U2** — a real legacy four-part install (`v0.47.0.0`) upgraded through the default remote (`https://github.com/kbitz/gstack-extend.git`) following the Task 2 owner runbook, with offered and installed commit/tag identity, v2/v4 reader compatibility, working recovery and unchanged user state (or an explicit recorded owner waiver); and (3) **U3** — disposition of open defects 7 (same-version `JUST_UPGRADED`) and 9 (duplicate `~/.local/bin` tip) and owner confirmation before O1 counts in `docs/PROGRESS.md`.
_touches: docs/acceptance/install-upgrade.md_
_blocked-by: Track 70A, Track 28A_
**Status (2026-11-25):** Not done; gaps U1–U3 stay open (unchanged since PR #303, `5da0ec8`). PR #303 (`5da0ec8`, merged 2026-11-23, docs-only, no release) created `docs/acceptance/install-upgrade.md` covering isolated scratch-HOME fresh install and onboarding (`v0.111.0`, `54fd6df`), the live `v0.112.2` (`39c2b0c`, PR #300) Bun prerequisite re-check, one-release upgrade preservation (`v0.110.1` → `v0.111.0`), per-file recovery and rollback/resume. On the developer's "SHIP WITH GAPS OPEN" decision (PR #303, touchpoint `1777c7d5`, bound to `51813798`), U1, U2 (Task 2 published legacy upgrade — open failure) and U3 (owner confirmation of O1) were deferred as PR #303 readiness gates and remain open acceptance obligations here.
**Scheduling:** Not declared in flight; lives in Group 97 only because its file footprint is disjoint and its technical edges on Tracks 70A (`v0.72.0`) and 28A (`v0.47.0.0`) are already satisfied. Candidate or `file://`-remote proof does not satisfy U2. It waits on the owner's time and gates only the stable-channel Track 100B (former 97B), which appends stable-channel upgrade evidence to `docs/acceptance/install-upgrade.md`.
_read-first: docs/acceptance/install-upgrade.md, docs/installation.md, docs/acceptance/release-compatibility.md_
- **Close U1 authenticated onboarding and loaded-skill identity** -- Run a first skill invocation in authenticated Claude Code and Codex sessions after install/upgrade and record loaded revision parity and any open gaps. _~35 lines._ (S)
- **Close U2 published legacy four-part upgrade and U3 owner confirmation** -- Run the Task 2 owner runbook in `docs/acceptance/install-upgrade.md` against the default remote (or record an explicit owner waiver), disposition open defects 7 and 9, and capture owner O1 confirmation for PROGRESS. _~65 lines._ (M)

##### Track 97C: Record the owner's remaining real review runs and by-hand run-mode readbacks
_3 tasks . ~120 LOC . low risk_
_id: wi-8b4a30_
**Outcome:** The owner can see from dated records that a by-hand review with no caller lines still runs as before, that the attacker parts run with per-part models when an orchestrator delegates them, that tools-mode delegation works on an installed release, and that a stage run by hand in Codex, Muse, Grok Build or Antigravity reads back with the run mode the shared rule promises.
**Supports:** [SPEC](SPEC.md) O6 and P1, O6.1, O3.3 (the by-hand driver's evidence) and O4.4. The remainder of the earlier Track 80D (PR #256, `v0.94.2`), which left attacker-parts PM1 and PM2 and tools-mode PM1 pending; the open acceptance of Track 72B (PR #221) and the post-release PM1 of the owner-approved tools-mode plan (PR #229); and the post-merge by-hand readbacks left pending by Track 90B (PR #283; Cursor discharged on 2026-11-21), Track 94J (PR #305, `v0.115.0`, qualifying Grok Build as `user-directed`/`terminal-session`) and Track 95B (PR #308, `v0.116.0`, qualifying Antigravity as `user-directed`/`terminal-session`).
**Done when:** (1) `docs/acceptance/attacker-parts.md` records PM1 (one real by-hand `/review-and-prep` with no `Review policy:` or `Review delegates:` line, read back as unchanged, with its invocation and receipt retained) and PM2 (one orchestrated run with `delegate=adversarial,red-team` mapping the two parts to different providers or models, with its `Delegated part:` lines, v3 attempts, `found_by` labels and any fallbacks), each with date, revision, host and harness versions and PR. (2) `docs/acceptance/delegate-tools-mode.md` records its PM1 installed paired run and names the exact reviewed content its earlier dry-run evidence covers. (3) Each pending non-Claude row in `docs/acceptance/hand-use-telemetry.md`'s "Pending post-merge by-hand readbacks" (Codex, Muse, Grok Build — updated from its pre-94J `harness-unqualified` expectation to `user-directed`/`terminal-session` per Track 94J — plus Antigravity per Track 95B; the Cursor row stays discharged with "Cursor support dropped 2026-11-21") is run by hand and read back through `gstack-extend-telemetry report --by-host` and the ledger's `agent`, `run_mode` and `run_mode_source`, or stays pending with the reason. (4) A failed, unavailable or wrongly read-back run stays recorded as open, never as passed, and a wrong read-back is filed as a defect.
_touches: docs/acceptance/attacker-parts.md, docs/acceptance/delegate-tools-mode.md, docs/acceptance/hand-use-telemetry.md_
_blocked-by: Track 94J, Track 95B_
**Scheduling:** Not declared in flight; lives in Group 97 only because its file footprint is disjoint and its technical edges on Track 94J (shipped, `v0.115.0`, PR #305) and Track 95B (shipped, `v0.116.0`, PR #308, item `d574f7e2`) are already satisfied. It gates no other Track. PM2 already has partial observations (PRs #250 and #253 and a consumer repository's review) and waits only on harness CLI version provenance, which the run's operator can record from the harness at run time; tools-mode PM1 waits on the orchestrator's paired tools-mode run, requested on 2026-11-15. By-hand runs recorded here can also supply rows harvested by Track 97D (former 96C).
_Source: PR #256's receipt (2026-11-15: "attacker PM1/PM2 and paired tools-mode qualification remain pending"); `docs/acceptance/attacker-parts.md` and `docs/acceptance/delegate-tools-mode.md` (PM rows pending); PR #283's receipt ("post-merge hand-run readbacks PM1–PM4 in Codex, Muse, Grok and Cursor") and `docs/acceptance/hand-use-telemetry.md` (pending Codex, Muse and Grok rows; Cursor discharged 2026-11-21); PR #305's receipt ("Live by-hand readbacks are tracked in Track 94E"); and Track 95B (PR #308, item `d574f7e2`)._
_read-first: docs/delegated-review.md, docs/acceptance/hand-use-telemetry.md, docs/telemetry.md_
- **Attacker parts PM1 and PM2** -- Run and read back one by-hand review with no caller lines, and finish PM2's harness version provenance. _~50 lines._ (S)
- **Tools-mode PM1 and provenance** -- Record the installed paired run and name the content the dry-run record covers. _~40 lines._ (S)
- **By-hand run-mode readbacks** -- Run one stage by hand in each installed non-Claude harness (Codex, Muse, Grok Build, Antigravity) as its row describes and record the readback or the reason it stays pending. _~30 lines._ (S)

##### Track 97D: Qualify the workflow with two real drivers
_2 tasks . ~240 LOC . medium risk_
_id: wi-9d6cf2_
**Outcome:** The owner can carry real work through every stage both by hand and through a real external orchestrator, and the evidence shows what the documented contract actually supports.
**Supports:** [SPEC](SPEC.md) O3.3 and O4.5 (reshaped from the Paseo host Track by the owner, 2026-11-07: "72c ok").
**Done when:** A dated record names host, harness and versions for real runs by both drivers (the owner by hand, and one real external orchestrator), each run read back in telemetry with the correct run mode, covering, between them, a complete plan-to-authorized-release workflow, interrupted resume, manual-testing pause/resume, `/full-review` finish/restart, an explicit negative hold, an external-consumer handoff consumed from artifacts, a cross-session handoff and stale/partial/held handoffs; it counts operator interventions and keeps pending approvals or failures as holds; it includes the installed `/docs-ship` acceptance below; no unexercised combination is claimed.
_touches: docs/acceptance/workflow-drivers.md_
_blocked-by: Track 70A, Track 72C, Track 71E, Track 74A, Track 76A, Track 75A, Track 26A, Track 23I, Track 23A, Track 26B, Track 65A, Track 66A, Track 66B, Track 72A, Track 79A, Track 80B, Track 87A, Track 89A, Track 90A, Track 91A, Track 90B, Track 91B, Track 92A, Track 94J, Track 95B_
**Status (2026-11-25):** Not done; holds stay open (unchanged since PR #291, `bbcdd0a`). PR #291 (`bbcdd0a`, merged 2026-11-22, documentation only, no release) added `docs/acceptance/workflow-drivers.md` as a holds-first matrix of 23 rows (14 `WD-*` and 9 `DS-*`; 0 pass, 23 hold at `8077fa2`), the runbooks for both drivers and seven post-92A telemetry observations. Criteria 1–2 still need the owner's real by-hand runs and one real external orchestrator's runs, each read back in telemetry; no row passes without its own live evidence on `producer_version >= 0.109.0`, and pending approvals or failures stay holds.
**Scheduling:** Not declared in flight; lives in Group 97 only because its file footprint is disjoint and its blockers through Track 92A (`v0.109.0`), Track 94J (`v0.115.0`, PR #305) and Track 95B (`v0.116.0`, PR #308) are all satisfied (Track 96A has also shipped in PRs #309 and #310). **Report-only harvest available:** now that Tracks 94J and 95B have merged, once installed this Track's by-hand rows can be harvested from the developer's real by-hand runs across Claude, Codex, Muse, Grok Build and Antigravity as a report-only readback step, alongside orchestrated runs. The other developer-run record Tracks (97B, 97C) do not gate this one; a run here can supply their rows. The external orchestrator may stop at a ready PR; a separate authorized run by hand proves landing. No consumer-repo edits, new spend, unattended release or acceptance-by-idle-status. The independently followed onboarding attempt moved to the public-release stage (Future).
- **Exercise both drivers** -- Run or harvest the matrix's rows (the record exists; this task fills it). Use real host-managed workspaces and approved accounts with the harnesses the owner uses for each stage; retain the bound PR and workspace, test stale/partial/held handoffs, confirm next-stage consumption from artifacts across sessions, include the host-attribution check deferred from Track 26A, and count operator interventions. _~200 documentation lines._ (L)
- **Include installed `/docs-ship` acceptance** -- Run a real docs-only PR through classification, a no-write classification hand-back, selected tests once, same-tree test-record reuse, final receipt hash, policy bump and `docs-ship/v1` without merging, and its interactive merge question; include one Sonnet-class run and one `/roadmap` handoff, and compare work/wait wall time with a recent docs PR shipped through the ordinary path. _~40 lines._ (S)

## Current Plan

_tombstone: 17, 19, 20, 22, 23, 24, 25, 26, 28, 29, 30, 31, 32, 33, 47, 48, 49, 50, 51, 52, 57, 58, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96_

### Group 98: One-file-per-record intake ∥ measured stage cost

_Depends on: Group 97_

**This group delivers:** Machine-generated review intake written as one file per record named by its immutable work-item ID so concurrent PRs merge without `docs/TODOS.md` conflicts, plus the recorded `bin/roadmap-id` and Track 94B `/roadmap` test gaps (Track 98A, ready as soon as Track 97A lands); and expected cost per stage with an adopt, reject or insufficient-evidence decision for every candidate optimization and the opted-in policy records' after fields filled (Track 98B, following Track 97D).

##### Track 98A: Write machine-generated intake as one file per record so concurrent PRs stop conflicting
_4 tasks . ~300 LOC incl. tests . medium risk_
_id: wi-4149dd_
**Outcome:** `/review-and-prep`'s machine-written intake (test-gap notes under `test-gaps=record`, and other review-filed follow-ups) goes into one small file per record instead of appending to `docs/TODOS.md`, so two branches that each file notes merge cleanly, and `/roadmap` reads and drains those files like the inbox.
**Supports:** [SPEC](SPEC.md) O2 and O3 (review and roadmap contracts). Fixes an encountered defect (concurrent review-filed `docs/TODOS.md` edits conflicted twice on PR #306 in this repository on 2026-11-24 and repeatedly in an external orchestrator's PRs).
**Done when:** (1) `/review-and-prep` writes each machine-generated intake record to its own file under one intake directory in git (for example `docs/todos/<record-id>.md`), named by the record's never-reused `wi-` ID, and no longer appends those records to `docs/TODOS.md`; hand-written `TODOS.md` entries keep working as today. (2) `/roadmap` reads the intake directory as part of the inbox, reports each record's priority and landing as it does for `TODOS.md` entries, and on drain removes or moves the record files in the same commit that places them. (3) `bin/roadmap-audit` counts and validates intake files (shape, ID, no duplicate IDs across files and `TODOS.md`), `bin/roadmap-id mint` reserves IDs across the intake directory too, and existing `TODOS.md` checks still pass on a repository with no intake directory. (4) A fixture test with two branches that each add intake records from the same base merges without a conflict. (5) The intake file shape and directory are documented in `docs/source-tag-contract.md` and `docs/compatibility.md` as a compatibility surface for consumers, and release notes disclose the change. (6) The two placed recorded test gaps (`wi-9b214e` for `bin/roadmap-id` mint path/reservation coverage and Track 94B's `/roadmap` scratch-path protocol locks) are covered by tests.
_touches: skills/review-and-prep.md, skills/references/review-and-prep/conditional-repair-and-gaps.md, skills/references/review-and-prep/conditional-post-audit-classification.md, skills/roadmap.md, src/audit/parsers/todos.ts, src/audit/checks/todo-format.ts, src/audit/checks/unprocessed.ts, src/audit/checks/work-item-ids.ts, src/audit/cli.ts, src/audit/id-cli.ts, bin/roadmap-audit, docs/source-tag-contract.md, docs/compatibility.md, docs/TODOS.md, tests/parsers-todos.test.ts, tests/check-work-item-ids.test.ts, tests/roadmap-id.test.ts, tests/skill-protocols-roadmap.test.ts, tests/skill-protocols-review-and-prep.test.ts, tests/audit-compliance.test.ts_
_blocked-by: wi-914dff, wi-2cf4fb_
**Scheduling:** Encountered defect queued immediately after Track 97A (`wi-2cf4fb`, In Progress) on the developer's priority order, ahead of Track 99A (ID migration) and Track 100A (`/full-review` implicit state machines). Its technical prerequisite on Track 96D (`wi-914dff`, PR #311, `v0.117.0`) is satisfied; its edge on Track 97A (`wi-2cf4fb`) keeps both planning-file parser edits ordered cleanly. Keeping intake in git rather than an external store is this Track's default; moving intake out of git is the developer's call and out of scope here. Places recorded test gap `wi-9b214e` (`[review:files=src/audit/id-cli.ts|tests/roadmap-id.test.ts]`, PR #311 coverage audit at `d7d8e67`) and promoted Future entry `Recorded test gaps: Track 94B /roadmap scratch-path protocol locks` (PR #296, `193eb39`, trigger met here); session weight 6 (within cap).
_Source: external orchestrator handoff (2026-11-24) and encountered `docs/TODOS.md` merge conflicts on PR #306 (2026-11-24, when PRs #307 and #308 appended review follow-ups); inbox `[review:files=src/audit/id-cli.ts|tests/roadmap-id.test.ts]` (`wi-9b214e`); Future entry "Recorded test gaps: Track 94B `/roadmap` scratch-path protocol locks"._
_read-first: skills/review-and-prep.md, skills/references/review-and-prep/conditional-repair-and-gaps.md, skills/roadmap.md, docs/source-tag-contract.md_
- **Write and drain per-record intake files in `/review-and-prep` and `/roadmap`** -- Update `/review-and-prep` (and its repair/gaps and post-audit references) to emit one file per machine-generated intake record under the intake directory named by its `wi-` ID, update `/roadmap` to read, report and drain those files alongside `TODOS.md`, and document the compatibility surface in `docs/source-tag-contract.md` and `docs/compatibility.md`. _~125 lines incl. tests._ (M)
- **Parse, audit, reserve and test conflict-free merges for per-record intake** -- Extend `src/audit/parsers/todos.ts`, the TODOS/ID checks, `src/audit/cli.ts` and `src/audit/id-cli.ts` to read, validate and reserve IDs across the intake directory while passing when it is absent, and add a two-branch git merge fixture proving concurrent intake additions merge without conflict. _~125 lines incl. tests._ (M)
- **Strengthen `roadmap-id` mint path and reservation tests (`wi-9b214e`)** -- Exercise omitted-path project lookup, read-error exit/output, and deterministic reservation across root and `docs/` planning locations in `tests/roadmap-id.test.ts`. _~30 lines._ (S)
- **Cover Track 94B `/roadmap` scratch-path protocol locks** -- Extend `tests/skill-protocols-roadmap.test.ts` to require checking that a `--from` draft exists and is nonempty before packing and to pin the prohibition on host-private scratch paths in Step 1b. _~25 lines._ (S)

##### Track 98B: Measure each stage's cost and decide each optimization
_4 tasks . ~500 LOC incl. tests . medium risk_
_id: wi-b1f0bd_
**Outcome:** The owner can reproduce an offline report of each stage's measured cost (model work, tool/CI/human waits, reuse and rework), read a documented expected cost per stage, and see an adopt, reject or insufficient-evidence decision for every candidate optimization.
**Supports:** [SPEC](SPEC.md) O6.1–O6.3 (owner, 2026-11-07: P1 joins the 1.0 outcomes with this finish line, and this Track gains the expected stage cost).
**Done when:** A reproducible offline report from sanitized projections separates DOCS/FULL/release-only paths, diff/task size, repo/host, run mode, skill version, waits and fresh versus resumed runs, and reports sample size and missingness; fixtures cover each split. A documented expected cost per stage (wall time and model usage, with sample size and unknowns) is published. Each efficiency-program candidate, including first-cycle overlap (69A), fold, delegation, the docs-only selection and the review run-state redesign (E15, whose adopt decision is Track 86A's record and whose post-default `insufficient-evidence` remeasurement and bounded next measurement are Track 94F's record in `docs/acceptance/review-run-state.md` §5), has measured evidence or a named evidence gap and an adopt, reject or insufficient-evidence decision with its follow-up mapped to existing Future items. The after fields that opted-in review-policy records still hold as unknown are filled from real opted-in runs where they exist, or named as evidence gaps: `docs/acceptance/review-fix-policy.md` for Tracks 33A, 51A and 75A (including whether an installed agent judged 75A's shown evidence and post-audit change classes as the skill asks) and the three after wall times in `docs/acceptance/external-gate.md`. No review gate, model choice or default changes through the study itself.
_touches: scripts/workflow-efficiency-report.py (new), tests/workflow-efficiency-report.test.ts (new), tests/fixtures/workflow-efficiency/ (new), tests/helpers/touchfiles.ts, docs/acceptance/workflow-efficiency.md (new), docs/acceptance/review-fix-policy.md, docs/acceptance/external-gate.md_
_blocked-by: Track 67A, Track 52A, Track 77A, Track 75A, Track 75B, Track 86A, Track 94F, wi-9d6cf2_
**Scheduling:** Kept as one card above ~300 lines under the card-size rule's same-files exception (owner direction, 2026-10-26): the evaluation edits the same script, test and fixture files and reads the report the baseline builds. Its edge on Track 94F is satisfied (PR #299, `f6b4267`, docs-only: verdict `insufficient-evidence` with a bounded next measurement); it follows the workflow qualification (Track 97D, `wi-9d6cf2`, former 96C), whose real runs supply most of its rows, and reads Tracks 86A and 94F instead of repeating them. Session weight 6.
_Source: the Future entries "Fill the external-gate record's three "after" wall times from a real opted-in run", "Fill Track 51A's criterion-7 "after" count at the first opted-in run after a release" and "Fill Track 33A's "after" measurement and pair it with a run without the values"; PR #234's receipt (Track 75A: installed-agent judgment unmeasured, "after" unknown), 2026-11-10._
_read-first: docs/telemetry.md, docs/quota-ledger.md, docs/designs/review-independence.md, docs/acceptance/review-run-state.md_
- **Build a comparable baseline and expected stage costs** -- Produce the offline report and the per-stage expected cost from it; reuse eligible release-only receipts and preserve the first-installed-no-CI timing obligation and 15-minute target; report time to push and merge gate separately from human approval. Observational differences are not causal model comparisons. _~200 lines._ (M)
- **Assess the uncertain efficiency choices** -- Compare smaller models and lower effort for bounded drafting/extraction versus the main runner, including launch/context-transfer and parent-correction costs; investigate repeated plan extraction, evidence reads, long-suite reruns, section loading, parallel scheduling and each reviewer voice's unique accepted findings. Define corpus, quality bars, fixed budgets and stop rules before any model trial; offline analysis only, and any paid trial needs a separately approved pilot and spend bound. _~180 lines._ (M)
- **Publish decisions and follow-up ownership** -- Adopt/reject/insufficient-evidence per candidate with expected benefit, observed limitations and the smallest follow-up, mapped to existing Future items; an insufficient-evidence result names missing data and a bounded next measurement and never silently removes a review or acceptance gate. _~80 lines._ (S)
- **Fill the opted-in policy records' after fields** -- From the receipts and ledger records of real opted-in runs (PRs #233 and #234 already carry `test-gaps=record`; record which values each run carried), fill or name as gaps the after fields of the 33A, 51A and 75A sections and the external-gate record, pairing with runs without the values where the records ask. _~40 lines._ (S)

### Group 99: Work-item ID migration and Git-history retirement

_Depends on: Group 97, Group 98_

**This group delivers:** One-time idempotent work-item ID migration across all existing planning records, Git-history ID retirement so retired IDs are never reused, and strict `WORK_ITEM_IDS` missing-ID enforcement once migrated.

##### Track 99A: Migrate existing planning records to work-item IDs and retire IDs across Git history
_2 tasks . ~400 LOC incl. tests . medium risk_
_id: wi-553a78_
**Outcome:** Every existing `TODOS.md` entry, Future bullet, active Track and shipped-history record gets a work-item ID by a one-time, idempotent migration, and a killed, shipped or merged ID is never reused even after its record leaves the files, so the ID format added by Track 96D covers old records as well as new ones.
**Supports:** [SPEC](SPEC.md) O2 (roadmap contracts). Completes the stable work-item IDs commitment (`wi-914dff`), split out of PR #311's review by the developer's SPLIT decision (`1f5f60a3-9712-4b45-9d8b-0912e761fe7f`).
**Done when:** (1) A one-time migration assigns IDs to existing entries and cards across `docs/TODOS.md`, `docs/roadmap-future.md`, `docs/ROADMAP.md` and `docs/roadmap-shipped.md` (about 290 records in this repository) without changing any other text, and is idempotent. (2) ID minting checks uniqueness against IDs that appear anywhere in the project's Git history, not only the current files, so an ID is never reused after its record is killed, shipped or merged into another. (3) The migration and the history scan handle the record shapes PR #311's review found: legacy Group 1–21 Track bullets, `## Completed` headings and their neighbouring records, inline code spans that look like ID fields, descriptive Future headings, and paths reached through alternate checkout spellings, aliases or an inherited Git pathspec setting; each has a fixture. (4) Once this repository is migrated, a missing ID becomes an audit failure again (Track 96D made it advisory), and `docs/source-tag-contract.md`, `docs/compatibility.md` and release notes say so.
_touches: src/audit/lib/work-item-id.ts, src/audit/id-cli.ts, bin/roadmap-id, src/audit/lib/git.ts, src/audit/checks/work-item-ids.ts, docs/TODOS.md, docs/roadmap-future.md, docs/ROADMAP.md, docs/roadmap-shipped.md, docs/source-tag-contract.md, docs/compatibility.md, tests/roadmap-id.test.ts, tests/check-work-item-ids.test.ts, tests/audit-snapshots.test.ts, tests/roadmap-audit/_
_blocked-by: wi-914dff, wi-2cf4fb, wi-4149dd_
**Scheduling:** Kept as one card above ~300 lines under the card-size rule's same-files exception (owner direction, 2026-10-26): the migration command, Git-history retirement scan and strict `WORK_ITEM_IDS` flip edit the same `work-item-id.ts`, `id-cli.ts`, `git.ts` and `work-item-ids.ts` files and ship together as the split half of PR #311. Its prerequisite on Track 96D (`wi-914dff`, PR #311, `v0.117.0`) is satisfied; its edges on Track 97A (`wi-2cf4fb`, Markdown lexer) and Track 98A (`wi-4149dd`, one-file-per-record intake) carry the developer's priority order and serialize shared planning-file/ID-helper edits. Plan as a parser of free-form Markdown: prefer an exact, enumerated set of record shapes with a fixture for each over interpreting variants, and say at planning which shapes are refused rather than guessed; PR #311's stop receipts (continuations 1–3) list every edge case found so far.
_Source: the developer's SPLIT decision (`1f5f60a3-9712-4b45-9d8b-0912e761fe7f`, 2026-11-25) on item `6c091012`'s third review-cap stop at `058a6cf`; the half moved out of PR #311._
_read-first: src/audit/lib/work-item-id.ts, src/audit/id-cli.ts, src/audit/lib/git.ts, docs/source-tag-contract.md_
- **Implement idempotent bulk migration and Git-history ID retirement** -- Add the one-time idempotent migration across all four planning documents plus Git-history ID retirement in `bin/roadmap-id` / `src/audit/lib/git.ts`, with fixtures for legacy Group 1–21 bullets, `## Completed` headings, inline code spans, descriptive Future headings, and alternate checkout spellings/pathspecs. _~220 lines incl. tests._ (M)
- **Migrate this repository's planning records and enforce missing IDs as audit failures** -- Run the migration across this repository's planning files, flip `WORK_ITEM_IDS` missing-ID findings from warn to fail, update `docs/source-tag-contract.md`, `docs/compatibility.md` and snapshots, and disclose the enforcement change for release notes. _~180 lines incl. tests._ (M)

### Group 100: Implicit state machines in /full-review ∥ stable update channel

_Depends on: Group 97, Group 99_

**This group delivers:** An implicit-state-machine review lens in `/full-review` that ranks lifecycle state as make explicit now, make explicit later, or plain check (Track 100A, ready as soon as Track 99A lands); and upgrades that follow a stable release channel with a non-interactive auto-upgrade switch (Track 100B, following Tracks 97B, 97D and 99A).

##### Track 100A: Teach /full-review to find implicit state machines and say whether each needs making explicit or only a plain check
_3 tasks . ~300 LOC incl. tests . medium risk_
_id: wi-84aea9_
**Outcome:** A `/full-review` run surfaces lifecycle state that a codebase manages implicitly (status strings compared in many places, bags of coupled booleans, state writes scattered across functions, persisted fields its loader never checks) and, for each one, says whether it should become an explicit state type with a transition table now, later, or only needs a plain check, so the developer gets a short ranked list rather than a proposal to add machinery everywhere.
**Supports:** [SPEC](SPEC.md) O3 (the `/full-review` periodic whole-codebase review workflow feeding `TODOS.md`). Requested on the developer's word (2026-11-24).
**Done when:** (1) `/full-review` gains an implicit-state-machine lens — either an added focus in an existing agent's prompt (`reviewer` or `consistency-auditor`) or a mechanical pre-pass whose output those agents read (the planner's choice) — keeping `tests/audit-compliance.test.ts` group D (byte-identical agent-prompt heads and tails, severity names, finding fields) passing and updating `docs/source-tag-contract.md` alongside any shared text it touches. (2) If a pre-scan helper is added, it does mechanics only (`CLAUDE.md` Design rule): it reports candidate sites generalized across languages (supporting at least Python and TypeScript/JavaScript and skipping cleanly on other languages) for string-compared state fields without an enum/union, coupled lifecycle booleans/nullables, scattered state writes, unchecked persisted keys, multi-file derived status, threshold-branched counters, and cross-language vocabularies lacking parity tests, with configured mechanical limits rather than judgment. (3) The agent-side rubric stays qualitative judgment in prose with no numeric triggers (`CLAUDE.md` Design rule): before filing, the agent judges whether the candidate is genuinely cyclic or multi-path, names a concrete reachable impossible state combination today (from code or interrupted/corrupt persisted state; none named, nothing filed), checks whether it sits on a persisted, concurrent or authority boundary, and recommends a plain check whenever one or two assertions remove the risk. (4) Each finding is classified as make explicit now, make explicit later, or plain check mapped onto `/full-review`'s existing severities and finding fields (no new severity names), while pure derivations, linear pipelines and one-time migration flags are skipped or logged only. (5) A fixture-backed test shows the lens finding a seeded implicit state machine and recommending only a plain check for a seeded case that one assertion fixes, and nothing in shipped code, skills, docs or fixtures names or requires any particular consumer project (`CLAUDE.md` Consumer independence).
_touches: skills/full-review.md, docs/source-tag-contract.md, bin/full-review-state-machines (new), src/full-review/ (new), tests/audit-compliance.test.ts, tests/skill-protocols-full-review.test.ts, tests/full-review-state-machines.test.ts (new), tests/fixtures/full-review-state-machines/ (new)_
_blocked-by: wi-553a78_
**Scheduling:** No technical dependency on the intake-ID or per-record intake Tracks; its edge on Track 99A (`wi-553a78`) carries the developer's priority order (not ahead of Track 98A or Track 99A) and serializes shared edits to `docs/source-tag-contract.md`. Ready to launch as soon as Track 99A lands without waiting on owner-run acceptance Tracks; landing it before this project's next `/full-review` run lets that run use the lens. If the planner chooses a prompt-only lens or another path for an optional pre-scan helper, narrow or update `_touches:` in planning accordingly.
_Source: the developer (verbatim, 2026-11-24): "Find all implicit or ad hoc state machines in the codebase. Once found, determine what it takes to make them explicit and present to me as a plan.", agreeing to codify the check in `/full-review`; numeric thresholds and High/Medium labels from an earlier consumer design brief are deliberately omitted per criteria 3 and 4._
_read-first: skills/full-review.md, docs/source-tag-contract.md, tests/audit-compliance.test.ts, CLAUDE.md_
- **Add the qualitative implicit-state-machine lens and rubric to `/full-review`** -- Update `skills/full-review.md` (and `docs/source-tag-contract.md` for any shared contract wording) with the qualitative rubric, reachability bar and three-way classification mapped onto existing severities while keeping `tests/audit-compliance.test.ts` group D green. _~120 lines incl. tests._ (M)
- **Build the optional mechanical candidate pre-scanner (if chosen in planning)** -- Implement the language-general mechanical candidate scanner for Python and TypeScript/JavaScript with clean skip on other languages and configured mechanical limits, or document the prompt-only choice if skipped. _~110 lines._ (M)
- **Add seeded fixture tests for explicit-state-machine and plain-check cases** -- Add consumer-independent fixtures and tests locking both a seeded implicit state machine and a seeded plain-check case, plus protocol/compliance checks. _~70 lines._ (S)

##### Track 100B: Follow a stable release channel and let a bootstrap turn on auto-upgrade
_5 tasks . ~290 LOC incl. tests . medium risk_
_id: wi-b9f147_
**Outcome:** gstack-extend upgrades follow a stable release channel rather than main, each upgrade installs the release it offered, and a bootstrap script can turn on auto-upgrade on that channel without a prompt, mirroring gstack's `auto_upgrade` and `update_channel` settings.
**Supports:** [SPEC](SPEC.md) O1 (install, update and recover) and O5 (release promise). Required before 1.0. Owner, 2026-11-07: "Another we need here for 1.0 (if not already done) - on install, we should check for gstack and extend and install them if missing + turn on auto upgrade on stable for both — they are dependencies" and "This can be deferred to be done right before 1.0".
**Done when:** An `update_channel` setting selects a stable channel (release tags, or a stable branch the release step advances, chosen in the plan) and keeps today's main-tracking behavior available, with existing main-tracking installs and the rollback recipe documented in `docs/installation.md`; `bin/update-check` offers and `bin/update-run` installs the same release identity, or reports the mismatch; a documented non-interactive command enables auto-upgrade on the channel; `setup` reports a missing gstack install actionably (installing it stays the bootstrap's job unless the plan shows otherwise); retrying an update after a Bun prerequisite refusal with a supported Bun version is covered by an update test; `bin/update-check`'s published output and install-safety stay compatible; the compatibility catalog lists the setting, and its Cursor and OpenCode retired-surface entry names Track 92A's release (`0.109.0`; Track 92A's plan follow-up 92E); a dated upgrade through the stable channel on the owner's machine is added to `docs/acceptance/install-upgrade.md`.
_touches: bin/update-check, bin/update-run, bin/config, setup, docs/installation.md, docs/compatibility.md, tests/update.test.ts, docs/acceptance/install-upgrade.md_
_blocked-by: Track 77A, wi-4732d3, wi-9d6cf2, wi-553a78_
**Scheduling:** Placed "right before 1.0" (owner): the edge on the workflow qualification (Track 97D, `wi-9d6cf2`, former 96C) is a priority choice; the edges on the catalog (Track 77A, shipped), install qualification (Track 97B, `wi-4732d3`, former 95C) and ID migration (Track 99A, `wi-553a78`) are technical (it appends to `docs/acceptance/install-upgrade.md`, edits `docs/compatibility.md` after 99A, and edits `setup`, `bin/update-run`, `docs/installation.md` and `tests/update.test.ts` after Track 97A). Facts rechecked 2026-11-25 at `d71d363`: `bin/update-run` still fast-forwards `origin main`; there is no channel setting; `setup` enforces Bun >= 1.3.3 via `bin/lib/bun-prereq.sh` (Track 94H, `v0.112.2`) and still checks no installed gstack; `bin/config set auto_upgrade true` is honored only by interactive upgrade flows, and spawned sessions never upgrade. Carries Track 94H's recorded test gap `[review:files=bin/update-run|setup|tests/update.test.ts]` ("Cover retrying an update after a Bun refusal", PR #300 coverage audit at `aaf05a0`), within 5 tasks and session weight 6. An orchestrator's bootstrap does its own install-if-missing; this repository owes the channel, the setting and the non-interactive enable path.
_Source: owner-approved card (2026-11-07); Track 92A's plan follow-up 92E (PR #290's approved plan); merges the Future entry "Bind upgrade offers to the installed release identity" (raised during Track 28A planning, 2026-10-23); inbox `[review:files=bin/update-run|setup|tests/update.test.ts]` from PR #300 (`aaf05a0`, 2026-11-23)._
_read-first: docs/installation.md, docs/acceptance/release-compatibility.md, docs/acceptance/install-upgrade.md_
- **Stable channel and offered-equals-installed identity** -- The `update_channel` key and its values, the channel mechanism, and binding the installed release to the offered one, with update tests. _~170 lines incl. tests._ (M)
- **Non-interactive enable and rollback** -- Document and test the bootstrap command and the return to main tracking. _~50 lines incl. tests._ (S)
- **Report a missing gstack at setup** -- An actionable result when installed gstack is absent. _~20 lines incl. tests._ (S)
- **Cover retrying an update after a Bun refusal** -- Add a disposable-remote fixture with two local Bun binaries to `tests/update.test.ts` verifying that retrying after a Bun prerequisite refusal completes pending migrations once. _~25 lines._ (S)
- **Record a real channel upgrade** -- Upgrade the owner's install through the stable channel and record offered and installed identity in `docs/acceptance/install-upgrade.md`; list the setting in the catalog and name release `0.109.0` in its Cursor and OpenCode retired-surface entry. _~30 lines._ (S)

### Group 101: Install and upgrade aligned with upstream gstack

_Depends on: Group 100_

**This group delivers:** An install and upgrade flow that looks and behaves like upstream gstack's, with a What's-new summary after every upgrade.

##### Track 101A: Align install and upgrade with upstream gstack
_3 tasks . ~290 LOC incl. tests, plus byte-copied shared blocks . medium risk_
_id: wi-2633cf_
**Outcome:** Installing and upgrading gstack-extend looks and behaves like upgrading upstream gstack: the same flow shape and output style, and a "What's new" summary shown after every upgrade.
**Supports:** [SPEC](SPEC.md) O1 (install, update and recover a working skill set). Included in 1.0 by the owner on 2026-11-08: "A but keep 72c and 78a for 1.0". Owner, 2026-11-07: "One thing I want to do at some point is re-align our install and upgrade process with gstack. Both visually and functionally, including the nice release notes presented to the user".
**Done when:** The upgrade flow's steps, prompts and output match upstream `/gstack-upgrade`'s shape, including snooze, auto-upgrade and just-upgraded handling; after every upgrade the user sees a What's-new summary drawn from `CHANGELOG.md` between the old and new versions (or the commit log on a main-tracking install) and a per-host upgrade summary; fresh-install onboarding is compared with gstack's and any gap recorded; install-safety rules, the `UPGRADE_OK`, `UPGRADE_FAILED`, `MIGRATION_WARN` and `INSTALL_WARN` tokens and `bin/update-check`'s published output stay compatible or migrate explicitly with disclosure; the recorded update-check and removed-host detector test gaps have tests.
_touches: skills/gstack-extend-upgrade.md, skills/gstack-extend-init.md, skills/full-review.md, skills/implement.md, skills/plan-track.md, skills/project-spec.md, skills/pair-review.md, skills/ship-and-land.md, skills/roadmap.md, skills/review-and-prep.md, skills/docs-ship.md, bin/update-run, setup, docs/installation.md, tests/skill-protocols.test.ts, tests/update.test.ts, tests/setup-hosts.test.ts_
_blocked-by: wi-b9f147, wi-84aea9_
**Scheduling:** The owner first said "at some point" (2026-11-07), then included it in 1.0 (2026-11-08). The edges on the stable-channel Track (100B, `wi-b9f147`, former 97B) and the `/full-review` implicit-state-machines Track (100A, `wi-84aea9`) order edits to shared upgrade and skill files behind them. It lists every skill file because the shared `SHARED:upgrade-flow` block is byte-copied into each of them (all eleven skills kept `SHARED:upgrade-flow` in their core `skills/*.md` after Track 94I, verified 2026-11-25 at `d71d363`); those copies do not count toward the card size. Facts rechecked 2026-11-25 at `d71d363`: `skills/gstack-extend-upgrade.md` still only points the user at `CHANGELOG.md` and shows no summary, while upstream `/gstack-upgrade` shows a grouped What's-new summary; release text from 0.68.0 to 0.72.0 is thin, so the summary is only as good as the CHANGELOG.
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
waits on a blocker's siblings. In particular, Track 97A (`wi-2cf4fb`, item
`8b742bc1`) is in flight now; Track 98A (`wi-4149dd`) launches as soon as 97A
lands, followed by Track 99A (`wi-553a78`), then Track 100A (`wi-84aea9`),
none of which wait on the owner-run acceptance Tracks (97B, 97C, 97D). Document
order is priority, not a gate. The cards label priority choices separately from
technical prerequisites.

```
- Group 97 ← {}
- Group 98 ← {97}: Tracks 97A, 97D
- Group 99 ← {97, 98}: Tracks 97A, 98A
- Group 100 ← {97, 99}: Tracks 97B, 97D, 99A
- Group 101 ← {100}: Tracks 100A, 100B
```

Track detail per group:
```
Group 97: Markdown lexer for planning files ∥ install/upgrade qualification gaps ∥ remaining real review and run-mode records ∥ two-driver workflow qualification (in progress)
  +-- Track 97A ........... ~M . 2 tasks   (in flight: item 8b742bc1; six block-structure readers)
  +-- Track 97B ........... ~M . 2 tasks   (U1–U3 open, owner's runs)
  +-- Track 97C ........... ~S . 3 tasks   (developer's runs; 94J + 95B shipped)
  +-- Track 97D ........... ~L . 2 tasks   (holds open; harvestable from real runs)
Group 98: One-file-per-record intake ∥ measured stage cost
  +-- Track 98A ........... ~M . 4 tasks   (next after 97A)
  +-- Track 98B ........... ~L . 4 tasks   (follows 97D)
Group 99: Work-item ID migration and Git-history retirement
  +-- Track 99A ........... ~M . 2 tasks   (follows 97A, 98A)
Group 100: Implicit state machines in /full-review ∥ stable update channel
  +-- Track 100A .......... ~M . 3 tasks   (follows 99A; ready ahead of 100B)
  +-- Track 100B .......... ~M . 5 tasks   (right before 1.0; follows 97B, 97D, 99A)
Group 101: Install and upgrade aligned with upstream gstack
  +-- Track 101A .......... ~M . 3 tasks   (follows 100A, 100B)
```

**5 Groups / 10 Tracks remaining**, 1 declared in progress (Track 97A).

Only owner-confirmed acceptance in PROGRESS can satisfy a stage/checkpoint.

## Future

Deferred: docs/roadmap-future.md (129 items)

## Shipped

History: docs/roadmap-shipped.md
