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

**Order.** Since the 2026-11-26 regeneration (`771f880`, PR #316), six Tracks
shipped: Track 101B (`wi-5dc2f5`, PR #317, `6cd4603`, `v0.121.0`, item
`929de338`, qualitative one-task splitting for existing-code-path cards in
`/roadmap`), Track 101C (`wi-553a78`, PR #319, `b561d76`, `v0.122.0`, item
`bf0129b1`, bulk work-item ID migration, Git-history ID retirement and strict
`WORK_ITEM_IDS` enforcement), Track 101A (`wi-9cfa44`, PR #318, `ac3c4ae`,
`v0.123.0`, item `53915c14`, merge-only refresh for moved-base reviewed PRs
plus host-session defensive-context framing), Track 102B (`wi-b9f147`, PR #321,
`273dd1a`, `v0.124.0`, item `5dc1771b`, stable release-tag update channel,
non-interactive bootstrap auto-upgrade and missing-`gstack` setup warning),
Track 102A (`wi-c6b6bd`, PR #320, `7f37ed8`, `v0.125.0`, item `aa5cff6a`,
stable cross-cycle finding identities and per-cycle counts in `src/review-state/`,
with the workflow-metrics consumer half of criterion 3 split off on the
developer's word, "approve per your rec", touchpoint `b1db1a82`, 2026-11-27)
and Track 104A (`wi-6743bd`, PR #322, `8367bcd`, `v0.126.0`, item `6d6dc150`,
`Verification:` block on `/implement` handoffs targeted first in review cycle 1).
Track 103A (`wi-a257f8`, blocking-only fix cycles for delegated passes and
Greptile) was killed on the developer's word on 2026-11-27 ("Retire is fine"):
its plan's user challenge showed `blocking=shown` already covers most of it.

On 2026-11-28 the developer approved running this regeneration in parallel with
in-flight Track 105A (verbatim: "Sure now is fine"). The developer's standing
priority rules (verbatim) continue to govern ordering: "Anything purely for 1.0
spec reqs and no other benefit should be last." and "I said the tracks that are
purely qualification for 1.0 are last. If I have to test something for a track
that otherwise does something useful, that's OK." Under those rules and Track
101B's one-task Track policy for existing code paths:
- **Group 105** (in progress) holds pinned Track 105A (`wi-2633cf`, in flight in
  planning as the orchestrator's item `a52fc49e`, card text kept unchanged)
  alongside two disjoint Layer-0 efficiency Tracks ready to launch immediately
  in parallel: Track 105B (`wi-3f28d1`, carrying Track 102A's finding identities
  and per-cycle counts in a new workflow-metrics record version) and Track 105C
  (`wi-19e153`, adding `bin/todo-file` with provenance and `roadmap-audit`
  format acceptance — split 1 of 3 from the TODO-filer card).
- **Group 106** runs two disjoint efficiency/defect-repair Tracks in parallel:
  Track 106A (`wi-0f466e`, hardening `bin/review-state` against the three
  observed inline-fallback refusals from PRs #317, #318 and #322 — launches as
  soon as 105B lands without waiting on 105A) and Track 106B (`wi-cf1ea6`,
  sparing `Deferred by: developer` entries in `/roadmap`'s manifestation gate
  and listing killed entries in regeneration PR bodies — split 2 of 3 from the
  TODO-filer card).
- **Group 107** runs Track 107A (`wi-09020e`, accepting a bound external
  full-suite pass for the pregate full-suite sentinel under
  `full-suite=external` — split 1 of 2 from the external-gate/doc-audit reuse
  card; separate novel-tier review-gate trust boundary).
- **Group 108** runs Track 108A (`wi-0e205d`, reusing an accepted documentation
  audit across a mechanical late base merge under `doc-audit-gap=auto` — split
  2 of 2 from the external-gate/doc-audit reuse card; separate novel-tier
  review-gate trust boundary).
- **Group 109** runs Track 109A (`wi-3a82ed`, wiring `/review-and-prep`,
  `/pair-review` and `/full-review` intake filing through `bin/todo-file`,
  plus optional `/file-todo` — split 3 of 3 from the TODO-filer card, placed
  after the review-efficiency chain per the card's scheduling note).
- **Groups 110 and 111** place the four purely-1.0-qualification Tracks last:
  three disjoint owner-run acceptance Tracks run in parallel in Group 110 —
  install/upgrade qualification gaps U1–U3 (110A, `wi-4732d3`, former 106A),
  remaining real review records and by-hand run-mode readbacks (110B,
  `wi-8b4a30`, former 106B) and two-driver workflow qualification (110C,
  `wi-9d6cf2`, former 106C) — followed by the offline O6 stage-cost study and
  optimization decisions in Group 111 (111A, `wi-b1f0bd`, former 107A).
Owner, 2026-11-08: "A but keep 72c and 78a for 1.0", approving a proposal that
moved the review-finding records to Future and kept docs-only test selection
(since shipped) and the gstack alignment (now Track 105A) as 1.0 work.

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
reconciliation. Track 92A's plan follow-up 92E (name its release `0.109.0` in
the compatibility catalog's retired-surface entry) shipped in Track 102B
(`v0.124.0`, PR #321). The Cursor by-hand readback was discharged with the
reason "Cursor support dropped 2026-11-21".

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

**Dropped: Track 35B and Track 103A.**
- Track 35B (`full-suite=before-audit`) was dropped rather than renumbered
  (2026-10-31): under `full-suite=final` and `full-suite=external` the full
  suite already runs once on the final content, after the documentation audit
  (`skills/review-and-prep.md`, Review policy section and the external gate's
  slot), so that value has no second full suite to avoid, and no caller has
  asked for it. Under `full-suite=external` the pregate's selected test lanes
  ran a second time after the caller's accepted full-suite pass (corrected
  2026-11-01); the v0.60.0 pregate narrowing skips that repeat when the
  attested command covers every selected test. That is a different repetition
  from the one 35B targeted, so 35B stays dropped and its design item E3 stays
  marked dropped in the [efficiency program](designs/workflow-efficiency-program.md);
  reinstating it is the owner's decision.
- Track 103A (`wi-a257f8`, blocking-only fix cycles for delegated passes and
  Greptile) was killed on 2026-11-27 on the developer's word ("Retire is fine"):
  its plan's user challenge showed `blocking=shown` already covers most of it.

**Card size.** A Track estimated above about 300 authored lines, counting its
tests, is split into separate Tracks unless splitting would leave a Track that
cannot ship alone. Byte-copied shared blocks and generated text do not count
toward that threshold. Do not split when the resulting Tracks would edit the
same files and must run one after another anyway, because each Track costs a
full pipeline run. A card kept above the threshold says why on its
**Scheduling:** line, and a card with copied or generated lines states them
separately from authored ones (owner rule, 2026-10-26). Track 101B
(`v0.121.0`, PR #317) adds the qualitative default to split cards changing
existing code paths into one-task Tracks unless the 0-to-1 or same-files
exception applies (and separate concerns or trust boundaries still split).

**Labels.** This regeneration (2026-11-28) recorded six shipped Tracks — 101B
(`wi-5dc2f5`, PR #317 `6cd4603` `v0.121.0`, item `929de338`), 101C
(`wi-553a78`, PR #319 `b561d76` `v0.122.0`, item `bf0129b1`), 101A
(`wi-9cfa44`, PR #318 `ac3c4ae` `v0.123.0`, item `53915c14`), 102B
(`wi-b9f147`, PR #321 `273dd1a` `v0.124.0`, item `5dc1771b`), 102A
(`wi-c6b6bd`, PR #320 `7f37ed8` `v0.125.0`, item `aa5cff6a`) and 104A
(`wi-6743bd`, PR #322 `8367bcd` `v0.126.0`, item `6d6dc150`) — retiring
Groups 101, 102 and 104 by tombstones (Group 103 had no shipped Track; Track
103A `wi-a257f8` was killed). Track 105A (`wi-2633cf`, item `a52fc49e`) is
declared pinned in `## In Progress` with its card text unchanged, and Group
105 backfills disjoint Layer-0 Tracks 105B (`wi-3f28d1`) and 105C
(`wi-19e153`). Seven new Tracks were minted from the three approved waiting
cards and one observed `bin/review-state` defect: 105B (`wi-3f28d1`), 105C
(`wi-19e153`), 106A (`wi-0f466e`), 106B (`wi-cf1ea6`), 107A (`wi-09020e`),
108A (`wi-0e205d`) and 109A (`wi-3a82ed`). Remaining unshipped qualification
Tracks recycled after Group 109: former 106A became 110A (`wi-4732d3`);
former 106B became 110B (`wi-8b4a30`); former 106C became 110C (`wi-9d6cf2`);
former 107A became 111A (`wi-b1f0bd`). The renames are in this regeneration's
commit message. Shipped numbers through 102 and 104 are reserved by tombstones;
64 was never a roadmap Group.

Target: [SPEC](SPEC.md) O1–O6, 1.0.0 as the owner's own real use by hand and
through an orchestrator; audience ceiling potentially-public. No workspace host
or orchestrator is required; support claims name only exercised combinations.
Implementation, installed/operator evidence and owner acceptance remain
distinct. No new spend or unattended merge is authorized.


## In Progress

### Group 105: Upstream-aligned install/upgrade ∥ finding identities in workflow metrics ∥ provenance TODO filer

_Depends on: none_

**This group delivers:** Upstream-aligned install and upgrade flow with grouped What's-new and per-host summaries (Track 105A, in flight now as the orchestrator's item `a52fc49e`); finding identity keys, classes and per-cycle counts exported in a new workflow-metrics record version so orchestrators can clear `cross_cycle_identity: no_cross_cycle_key` (Track 105B, disjoint); and the canonical `bin/todo-file` provenance filer plus `roadmap-audit` format acceptance (Track 105C, disjoint).

##### Track 105A: Align install and upgrade with upstream gstack
_3 tasks . ~290 LOC incl. tests, plus byte-copied shared blocks . medium risk_
_id: wi-2633cf_
**Outcome:** Installing and upgrading gstack-extend looks and behaves like upgrading upstream gstack: the same flow shape and output style, and a "What's new" summary shown after every upgrade.
**Supports:** [SPEC](SPEC.md) O1 (install, update and recover a working skill set). Included in 1.0 by the owner on 2026-11-08: "A but keep 72c and 78a for 1.0". Owner, 2026-11-07: "One thing I want to do at some point is re-align our install and upgrade process with gstack. Both visually and functionally, including the nice release notes presented to the user".
**Done when:** The upgrade flow's steps, prompts and output match upstream `/gstack-upgrade`'s shape, including snooze, auto-upgrade and just-upgraded handling; after every upgrade the user sees a What's-new summary drawn from `CHANGELOG.md` between the old and new versions (or the commit log on a main-tracking install) and a per-host upgrade summary; fresh-install onboarding is compared with gstack's and any gap recorded; install-safety rules, the `UPGRADE_OK`, `UPGRADE_FAILED`, `MIGRATION_WARN` and `INSTALL_WARN` tokens and `bin/update-check`'s published output stay compatible or migrate explicitly with disclosure; the recorded update-check and removed-host detector test gaps have tests.
_touches: skills/gstack-extend-upgrade.md, skills/gstack-extend-init.md, skills/full-review.md, skills/implement.md, skills/plan-track.md, skills/project-spec.md, skills/pair-review.md, skills/ship-and-land.md, skills/roadmap.md, skills/review-and-prep.md, skills/docs-ship.md, bin/update-run, setup, docs/installation.md, tests/skill-protocols.test.ts, tests/update.test.ts, tests/setup-hosts.test.ts_
_blocked-by: wi-84aea9, wi-5dc2f5, wi-b9f147, wi-6743bd_
**Scheduling:** Concrete upgrade-UX smoothness, not 1.0-only qualification: gives the owner a grouped What's-new summary from `CHANGELOG.md` and a per-host summary after every upgrade matching upstream `/gstack-upgrade`, instead of pointing at `CHANGELOG.md` manually. Placed after the efficiency Tracks (101A–104A) and the stable-channel Track (102B, `wi-b9f147`), and directly before the purely-1.0 qualification wave (Group 106), so install/upgrade qualification (106A) exercises the final upgrade flow once. The edges on Track 101B (`wi-5dc2f5`), Track 102B (`wi-b9f147`) and Track 104A (`wi-6743bd`) are technical: this Track edits `bin/update-run`, `setup`, `docs/installation.md`, `tests/update.test.ts` and copies `SHARED:upgrade-flow` across all eleven core `skills/*.md` files (its edge on Track 100A, `wi-84aea9`, is satisfied). Kept separate from Track 102B because combining them would violate both the 5-task and ~300-line caps and serialize 102B behind the review-efficiency chain. Copied `SHARED:upgrade-flow` blocks do not count toward the card size. Facts rechecked 2026-11-26 at `3f8c1e3`: `skills/gstack-extend-upgrade.md` still only points the user at `CHANGELOG.md` and shows no summary, while upstream `/gstack-upgrade` shows a grouped What's-new summary; release text from 0.68.0 to 0.72.0 is thin, so the summary is only as good as the CHANGELOG.
_Source: owner-approved card (2026-11-07); Future entry "Recorded test gaps: update-check wording, trigger lines and notice placement" (its trigger, a Track whose `_touches:` cover `tests/skill-protocols.test.ts` and `tests/update.test.ts`, is met here); recorded test gap `[review:files=tests/skill-protocols.test.ts]` "Exercise the remaining removed-host detector branches" (PR #236, 2026-11-10)._
_read-first: skills/gstack-extend-upgrade.md, docs/installation.md_
- **Match upstream's upgrade flow and output** -- Steps, prompts and output format across the shared upgrade flow and `/gstack-extend-upgrade`, keeping the result tokens and install-safety rules. _~150 lines incl. tests, plus shared copies._ (M)
- **What's-new and per-host upgrade summaries** -- Summarize `CHANGELOG.md` (or the commit log) between versions and print one row per host install. _~100 lines incl. tests._ (M)
- **Cover the recorded skill-protocol test gaps** -- Pin the `UPGRADE_SKIPPED spawned-session` sentence and the installation guide's just-upgraded clauses, assert the per-skill `UPGRADE_AVAILABLE` and `JUST_UPGRADED` lines and the spawned branch's placement, and show `bin/update-check` output reaching stdout (`[review:files=tests/skill-protocols.test.ts|tests/update.test.ts]` and `[review:files=tests/skill-protocols.test.ts]`, Track 66A, 2026-11-04); add negative cases for an unguarded Paseo mention and the removed Conductor marker in the removed-host detector. _~45 lines._ (S)

##### Track 105B: Carry finding identities in the workflow-metrics record so orchestrators can clear no_cross_cycle_key
_1 task . ~150 LOC incl. tests . low risk_
_id: wi-3f28d1_
**Outcome:** The workflow-metrics ledger a review exports carries each finding's stable identity key and class and the per-cycle new, carried and repeated-premise counts that Track 102A added to the review run state, under a new record version, so an orchestrator's run-record reader can stop reporting `cross_cycle_identity: no_cross_cycle_key`.
**Supports:** [SPEC](SPEC.md) O4/O6 orchestration and telemetry contracts; completes Track 102A's criterion 3 (consumer half), split off on the developer's word.
**Done when:** (1) The workflow-metrics export writes a new record version that includes each finding's identity key and class and the per-cycle counts, while existing record versions stay readable and the current version's other fields are unchanged. (2) The new version and its fields are documented in `docs/workflow-handoffs.md` (and the workflow-metrics contract doc `docs/telemetry.md` and `docs/workflow-metrics.schema.json` it points to) as a compatibility surface, with a fixture-tested example and a pre-change ledger that still loads. (3) The external orchestrator's manager is told the version and fields so its reader can adopt them; clearing the string on their side is theirs, not this Track's.
_touches: src/review-state/export.ts, bin/lib/workflow_metrics.py, docs/workflow-handoffs.md, docs/telemetry.md, docs/workflow-metrics.schema.json, tests/workflow-metrics.test.ts, tests/review-state.test.ts_
_blocked-by: wi-c6b6bd_
**Scheduling:** Efficiency and orchestration, not 1.0-only. Follows Track 102A (`wi-c6b6bd`, shipped `v0.125.0`). Already a one-task card (~150 LOC incl. tests), kept whole under Track 101B. Completely disjoint from in-flight Track 105A (`wi-2633cf`) and Track 105C (`wi-19e153`), so it packs into Group 105 and can launch immediately in parallel with 105A. Narrowed from the card's `src/review-state/` and `tests/` folder globs to `src/review-state/export.ts`, `tests/workflow-metrics.test.ts` and `tests/review-state.test.ts`, and added `docs/telemetry.md` and `docs/workflow-metrics.schema.json` where the workflow-metrics record schema lives.
_Source: developer-approved card (`track-finding-identity-metrics-record.md`). The developer approved Track 102A with the plan's D17 split ("approve per your rec", touchpoint `b1db1a82`, 2026-11-27): criterion 3 verified on the producer side at merge, with clearing the consumer's `cross_cycle_identity: no_cross_cycle_key` string left to a separately owned consumer-migration card. 102A's plan amendment A8 notes the string is written by the orchestrator's reader from gstack-extend's workflow-metrics ledger, outside 102A's files._
_read-first: src/review-state/export.ts, src/review-state/finding-identity.ts, src/review-state/finding-cycles.ts, bin/lib/workflow_metrics.py, docs/workflow-handoffs.md, docs/telemetry.md, docs/workflow-metrics.schema.json_
- **Export finding identity keys, classes and per-cycle counts in a new workflow-metrics record version** -- Extend `src/review-state/export.ts`, `bin/lib/workflow_metrics.py`, `docs/workflow-metrics.schema.json`, `docs/telemetry.md` and `docs/workflow-handoffs.md` with a new workflow-metrics record version carrying each finding's stable identity key, class and per-cycle new/carried/repeated-premise counts while keeping pre-change ledgers readable and existing version fields unchanged, with fixture tests in `tests/workflow-metrics.test.ts` and `tests/review-state.test.ts`. _~150 lines incl. tests._ (M)

##### Track 105C: Add a canonical TODO filer with provenance and accept provenance lines in roadmap-audit
_1 task . ~140 LOC incl. tests . medium risk_
_id: wi-19e153_
**Outcome:** A single CLI helper beside `bin/roadmap-id` (for example `bin/todo-file`) mints the work-item ID and writes canonical per-record intake entries under `docs/todos/` with explicit provenance (`Deferred by: developer, <UTC date>: "<words>"` or `Filed by: worker`), refusing entries missing Why or Evidence, and `roadmap-audit` accepts both provenance lines.
**Supports:** [SPEC](SPEC.md) O2 planning contracts. Fixes an encountered defect (split 1 of 3 from the TODO-filer provenance card under Track 101B).
**Done when:** (1) One helper beside `bin/roadmap-id` (for example `bin/todo-file`, enforcing Bun >= 1.3.3 through `bin/lib/bun-prereq.sh` like the other Bun launchers) mints the ID and writes an entry in Track 98A's canonical per-record intake format (`docs/todos/<wi-id>.md`), refusing an entry missing Why or Evidence, recording `Deferred by: developer, <UTC date>: "<words>"` when the filer passes the developer's words and `Filed by: worker` otherwise, and keeping the `test-gaps=record` kind working as today. (2) `src/audit/checks/todo-format.ts` and `docs/source-tag-contract.md` accept both provenance lines, and fixtures in `tests/todo-file.test.ts`, `tests/audit-cli-contract.test.ts` and `tests/roadmap-audit/` cover valid developer-deferred and worker-filed records plus the helper's refusals.
_touches: bin/todo-file (new), src/audit/todo-file-cli.ts (new), src/audit/checks/todo-format.ts, docs/source-tag-contract.md, tests/todo-file.test.ts (new), tests/audit-cli-contract.test.ts, tests/roadmap-audit/, tests/helpers/touchfiles.ts, .gstack/pregate.json_
_blocked-by: wi-4149dd, wi-553a78_
**Scheduling:** Operational defect fix, not 1.0-only qualification. Split from the 3-task TODO-filer card (`track-todo-filer-provenance.md`) into three one-task Tracks under Track 101B (existing code paths split): this Track builds the new helper and audit-format support with zero skill edits, Track 106B (`wi-cf1ea6`) updates `/roadmap`'s manifestation gate and PR body killed-entry list, and Track 109A (`wi-3a82ed`) wires `/review-and-prep`, `/pair-review` and `/full-review` after the review-efficiency chain. Because this Track is completely disjoint from in-flight Track 105A (`wi-2633cf`) and Track 105B (`wi-3f28d1`), it packs into Group 105 and launches in parallel at zero latency cost to the review-efficiency chain (its prerequisites `wi-4149dd` Track 98A and `wi-553a78` Track 101C have shipped). Narrowed from the card's `bin/`, `src/audit/` and `tests/**` globs to concrete files.
_Source: developer-approved card (`track-todo-filer-provenance.md`), from an external orchestrator's manager, store messages `bd38bdb1`, `6caf1123` and `276b3ed4` (2026-11-26). Encountered case: a consumer's roadmap regeneration drained its TODOS and killed 17 review follow-ups "under the manifestation gate" that the developer had explicitly deferred on that review ("1 - fix, file the rest, finish"). The developer (verbatim), 2026-11-26: "roadmap should only do that for “auto-filed” todos, eg if I explicitly say we want to do it, it shouldn’t be killed by mechanical rules. But if it’s generated in a review step by a worker, than the mechanical rules apply." Carded on the developer's word, 2026-11-26 ("Latter then former")._
_read-first: bin/roadmap-id, src/audit/checks/todo-format.ts, docs/source-tag-contract.md_
- **Add `bin/todo-file` provenance filer and accept provenance lines in `roadmap-audit`** -- Add `bin/todo-file` and `src/audit/todo-file-cli.ts` minting `wi-` IDs and writing Track 98A per-record intake files with `Deferred by: developer, <UTC date>: "<words>"` or `Filed by: worker` provenance (refusing missing Why or Evidence while keeping `test-gaps=record`), update `src/audit/checks/todo-format.ts` and `docs/source-tag-contract.md`, register touchfiles/pregate deps and add CLI and audit-fixture tests. _~140 lines incl. tests._ (M)


## Current Plan

_tombstone: 17, 19, 20, 22, 23, 24, 25, 26, 28, 29, 30, 31, 32, 33, 47, 48, 49, 50, 51, 52, 57, 58, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 100, 101, 102, 104_

### Group 106: Harden review-state inline-fallback refusals ∥ /roadmap developer-deferred provenance gate

_Depends on: Group 105_

**This group delivers:** Hardening `bin/review-state` against the three observed refusal classes that forced inline receipt fallbacks across PRs #317, #318 and #322 (Track 106A, launching as soon as 105B lands); and updating `/roadmap`'s manifestation gate to spare `Deferred by: developer` entries and list every killed entry by ID and source in regeneration PR bodies (Track 106B, disjoint).

##### Track 106A: Harden bin/review-state against the three observed inline-fallback refusals
_4 tasks . ~210 LOC incl. tests . medium risk_
_id: wi-0f466e_
**Outcome:** `bin/review-state` stops forcing `/review-and-prep` into its inline receipt fallback on the three failure classes observed this week (rejected severity labels as in PR #317, rejected unsupported enum/builder values as in PR #318, and refusing to close a run while cycle 1's pass is still open as in PR #322), so recorded run state and workflow metrics survive real reviews.
**Supports:** [SPEC](SPEC.md) O3 (default recorded review workflow) and O6.1 (measured stage effort / workflow metrics). Fixes a manifested defect from intake (three of the six merged pull requests since `771f880` hit inline fallback).
**Done when:** (1) `src/review-state/state.ts` and `src/review-state/build.ts` accept or normalize the severity label variants and caller-passed values that triggered the PR #317 and PR #318 refusals (verified against the recorded evidence at planning time without silently dropping safety or binding invariants), and `bin/review-state` plus `docs/review-run-state-calls.md` handle closing a run when a pass is still open (as observed in PR #322) cleanly or give an explicit, recoverable close path instead of dropping to inline fallback. (2) Regression fixtures in `tests/review-state.test.ts` cover each of the three observed refusal classes. (3) The three placed Track 102A `src/review-state/{state,build}.ts` recorded test gaps (`wi-452bd5`, `wi-f81004`, `wi-7f98bd`) have passing tests.
_touches: src/review-state/state.ts, src/review-state/build.ts, docs/review-run-state-calls.md, tests/review-state.test.ts_
_blocked-by: wi-3f28d1_
**Scheduling:** Manifested operational-smoothness defect admitted from intake (no pre-approved external card yet; placed as its own focused Track rather than folded into Track 105B or 107A/108A to avoid mixing separate concerns per Track 101B). Technical prerequisite only on Track 105B (`wi-3f28d1`, sharing `tests/review-state.test.ts`): launches as soon as 105B lands without waiting on Track 105A, so `bin/review-state` is hardened before Tracks 107A–109A run. Carries three directly matching PR #320 `test-gaps=record` items (`wi-452bd5`, `wi-f81004`, `wi-7f98bd`) as S tasks within `max_tasks_per_track=5` and `max_session_weight=6` (session weight 5).
_Source: observed defect intake from an external orchestrator's manager (2026-11-28): `bin/review-state` / `src/review-state/` repeatedly forced `/review-and-prep`'s inline receipt fallback this week — rejected a severity label (PR #317), rejected an unsupported value (PR #318), and refused to close a run while cycle 1's pass was still open (PR #322). Verified at `8367bcd`: `src/review-state/state.ts:218` `UPSTREAM_SEVERITY_LABELS` maps only `CRITICAL` and `INFORMATIONAL`, and `state.ts:895` refuses `finish` with `outcome === 'prepared'` when any pass remains `open`. Also carries PR #320 `test-gaps=record` inbox files `wi-452bd5`, `wi-f81004` and `wi-7f98bd`._
_read-first: src/review-state/state.ts, src/review-state/build.ts, docs/review-run-state-calls.md, tests/review-state.test.ts_
- **Normalize observed severity and value refusals and handle open passes before finish** -- Inspect the PR #317, PR #318 and PR #322 refusal classes, harden `src/review-state/state.ts`, `src/review-state/build.ts` and `docs/review-run-state-calls.md` against rejected severity labels, unsupported values and closing a run with an open pass while preserving binding invariants, and add regression fixtures in `tests/review-state.test.ts`. _~150 lines incl. tests._ (M)
- **Cover discarded provisional voice reports (`wi-452bd5`)** -- Add a synthetic multi-voice pass in `tests/review-state.test.ts` completing the selected set with a second provisional voice discarded, asserting the selected observations (`[review:files=src/review-state/state.ts]`, PR #320). _~20 lines._ (S)
- **Cover invalid stored finding metadata (`wi-f81004`)** -- Add a shallow malformed stored-state fixture in `tests/review-state.test.ts` covering persisted invalid key/class pairs and invalid prior entries returning a clear corrupt result (`[review:files=src/review-state/state.ts]`, PR #320). _~20 lines._ (S)
- **Cover digest flag without its copy (`wi-7f98bd`)** -- Add a fixture in `tests/review-state.test.ts` passing a prior-state digest without the copy flag to a start request and asserting the usage diagnostic and empty state directory (`[review:files=src/review-state/build.ts]`, PR #320). _~20 lines._ (S)

##### Track 106B: Spare developer-deferred entries in /roadmap's manifestation gate and list killed entries in PR bodies
_4 tasks . ~140 LOC incl. tests . low risk_
_id: wi-cf1ea6_
**Outcome:** `/roadmap`'s manifestation gate kills only unmarked or `Filed by: worker` entries while sparing `Deferred by: developer` entries for normal triage (fold, place or Future, requiring the developer's word to drop), and every regeneration PR body lists each killed entry by ID and source instead of only a count.
**Supports:** [SPEC](SPEC.md) O2 planning contracts. Fixes an encountered defect (split 2 of 3 from the TODO-filer provenance card under Track 101B).
**Done when:** (1) `skills/roadmap.md` updates **Unobserved defects wait for manifestation** so entries marked `Deferred by: developer` are skipped by the manifestation kill (triaged to fold, place or Future; dropping one requires the developer's word), while unmarked and `Filed by: worker` entries remain under the gate as today and `test-gaps=record` rows stay unaffected. (2) `skills/roadmap.md` requires a regeneration's PR body (and handoff brief/summary) to list every killed entry by ID and source, not only a count. (3) Protocol tests and fixtures in `tests/skill-protocols-roadmap.test.ts` cover a developer-deferred entry surviving the gate, a worker-filed entry killed by it, and the three placed PR #317 static protocol test gaps (`wi-3490bd`, `wi-d9974c`, `wi-efe191`); skill budgets and reference digests stay valid.
_touches: skills/roadmap.md, tests/skill-protocols-roadmap.test.ts_
_blocked-by: wi-19e153, wi-2633cf_
**Scheduling:** Operational defect fix, not 1.0-only qualification. Split 2 of 3 from `track-todo-filer-provenance.md` under Track 101B (existing code paths split): depends on Track 105C (`wi-19e153`, which defines the provenance format) and Track 105A (`wi-2633cf`, which edits `skills/roadmap.md`). Completely disjoint from Track 106A (`wi-0f466e`), so both run in parallel in Group 106. Carries three directly matching PR #317 static unit-test gaps (`wi-3490bd`, `wi-d9974c`, `wi-efe191`) as S tasks (4 tasks, session weight 4); PR #317's five sampled-agent evaluation gaps went to Future because placing them would exceed `max_tasks_per_track=5`.
_Source: developer-approved card (`track-todo-filer-provenance.md`), criteria 3, 4 and the roadmap-gate half of criterion 5 (see Track 105C for the developer's 2026-11-26 verbatim quote and encountered case). Also carries PR #317 `test-gaps=record` inbox files `wi-3490bd`, `wi-d9974c` and `wi-efe191`._
_read-first: skills/roadmap.md (Unobserved defects wait for manifestation), docs/source-tag-contract.md, tests/skill-protocols-roadmap.test.ts_
- **Update `/roadmap` manifestation gate for developer-deferred provenance and PR body killed-entry list** -- Update `skills/roadmap.md` to spare `Deferred by: developer` entries from mechanical manifestation kills (keeping unmarked and `Filed by: worker` under the gate and `test-gaps=record` unchanged) and require listing every killed entry by ID and source in regeneration PR bodies, with fixtures and protocol locks in `tests/skill-protocols-roadmap.test.ts`. _~80 lines incl. tests._ (S)
- **Cover static guards for exception limits (`wi-3490bd`)** -- Extend `tests/skill-protocols-roadmap.test.ts` to mutate the exception cap condition and distinct-concerns direction while keeping its nouns and assert rejection (`[review:files=skills/roadmap.md|tests/skill-protocols-roadmap.test.ts]`, PR #317). _~20 lines._ (S)
- **Cover static guard for serial edges on one-task splits (`wi-d9974c`)** -- Extend `tests/skill-protocols-roadmap.test.ts` to remove the split-specific serialized dependency phrase in a synthetic slice and require the guard to reject it (`[review:files=skills/roadmap.md|tests/skill-protocols-roadmap.test.ts]`, PR #317). _~20 lines._ (S)
- **Cover static guards for alternate numeric split wording (`wi-efe191`)** -- Extend `tests/skill-protocols-roadmap.test.ts` with bounded spelled-out, hyphenated and plus-suffixed count mutations (upstream P3; `[review:files=skills/roadmap.md|tests/skill-protocols-roadmap.test.ts]`, PR #317). _~20 lines._ (S)

### Group 107: Accept bound external full-suite pass for the pregate sentinel

_Depends on: Group 105, Group 106_

**This group delivers:** Crediting a bound external full-suite pass under `full-suite=external` to satisfy the pregate full-suite sentinel when a PR edits `.gstack/pregate.json`, plus four matching `tests/handoff-contract.test.ts` recorded test gaps.

##### Track 107A: Accept a bound external full-suite pass for the pregate full-suite sentinel under full-suite=external
_5 tasks . ~180 LOC incl. tests . medium risk_
_id: wi-09020e_
**Outcome:** Under `full-suite=external`, when a PR changes `.gstack/pregate.json` so the final pregate selects the full-suite sentinel, a recorded external full-suite pass bound to the same head and tree satisfies the sentinel and the pregate runs only its remaining lanes, eliminating avoidable full-suite reruns and developer holds.
**Supports:** [SPEC](SPEC.md) review contracts and the orchestration contract. Fixes an encountered defect (split 1 of 2 from the external-gate/doc-audit reuse card under Track 101B).
**Done when:** (1) Under `full-suite=external`, when a PR changes `.gstack/pregate.json` so the final pregate selects the full-suite sentinel, a recorded external full-suite pass bound to the same head and tree satisfies the sentinel and the pregate runs its remaining lanes; with no such bound pass it runs the sentinel as today. (2) The rule and its receipt lines are documented in `docs/workflow-handoffs.md` with a fixture-tested receipt example, every other gate is unchanged, and skill budgets and reference digests stay valid. (3) The four placed `tests/handoff-contract.test.ts` recorded test gaps (`wi-d637ac`, `wi-164c0b`, `wi-2cf373`, `wi-6a4355`) have passing tests.
_touches: skills/review-and-prep.md, skills/references/review-and-prep/conditional-pregate-and-final-repair.md, src/review-state/render.ts, docs/workflow-handoffs.md, tests/handoff-contract.test.ts, tests/fixtures/handoffs/, tests/review-state.test.ts, tests/skill-protocols-review-and-prep.test.ts_
_blocked-by: wi-2633cf, wi-3f28d1, wi-0f466e_
**Scheduling:** Efficiency (review tails), not 1.0-only. Split from `track-review-external-gate-reuse.md` into two one-task Tracks (107A and 108A) under Track 101B and the 2026-11-20 review-gate credit rule: crediting an external pass for the pregate sentinel (107A) and reusing an accepted doc audit across a mechanical late base merge (108A) are two separate review-gate trust boundaries (each planned at novel tier) that ship cleanly on their own. Technical blockers on Track 105A (`wi-2633cf`, sharing `skills/review-and-prep.md`), Track 105B (`wi-3f28d1`, sharing `docs/workflow-handoffs.md` and `tests/review-state.test.ts`) and Track 106A (`wi-0f466e`, sharing `tests/review-state.test.ts`). Carries four directly matching recorded test gaps (`wi-d637ac` P3 from PR #318; `wi-164c0b`, `wi-2cf373`, `wi-6a4355` from PR #322) within `max_tasks_per_track=5` and `max_session_weight=6` (session weight 6). Narrowed from the card's `skills/references/review-and-prep/`, `src/review-state/` and `tests/` folder globs to concrete files.
_Source: developer-approved card (`track-review-external-gate-reuse.md`), from an external orchestrator's manager, store message `4569c0fb` (2026-11-27). Encountered case: on a consumer repository's PR, the external gate passed 5,003 tests, but the PR changed the lane map so the final pregate insisted on running the full suite itself and held for the developer. Also carries PR #318 `wi-d637ac` and PR #322 `wi-164c0b`, `wi-2cf373`, `wi-6a4355` `test-gaps=record` inbox files._
_read-first: skills/review-and-prep.md (final pregate, external gate), skills/references/review-and-prep/conditional-pregate-and-final-repair.md, src/review-state/render.ts, docs/workflow-handoffs.md_
- **Satisfy the pregate full-suite sentinel with a bound external pass under `full-suite=external`** -- Update `skills/review-and-prep.md`, `skills/references/review-and-prep/conditional-pregate-and-final-repair.md`, `src/review-state/render.ts` and `docs/workflow-handoffs.md` so a recorded external full-suite pass bound to the same head and tree satisfies the pregate full-suite sentinel when `.gstack/pregate.json` changes (running remaining lanes, or running the sentinel as today when no bound pass exists), with fixture tests in `tests/handoff-contract.test.ts`, `tests/review-state.test.ts` and `tests/skill-protocols-review-and-prep.test.ts`. _~100 lines incl. tests._ (M)
- **Cover legacy classifier with full H-G escalation summary (`wi-d637ac`)** -- Add a fixture in `tests/handoff-contract.test.ts` passing prose, H-G escalation and stopped stage line through the legacy classifier and asserting hold rather than H-E (upstream P3; `[review:files=docs/workflow-handoffs.md|tests/handoff-contract.test.ts]`, PR #318). _~20 lines._ (S)
- **Cover H-A verification redaction on the Ran side (`wi-164c0b`)** -- Add a fixture in `tests/handoff-contract.test.ts` placing a synthetic token in `Ran` and asserting HOLD and withholding from the verdict (`[review:files=tests/handoff-contract.test.ts]`, PR #322). _~20 lines._ (S)
- **Cover H-A empty could-not-verify list (`wi-2cf373`)** -- Add a fixture in `tests/handoff-contract.test.ts` with a present `Could not verify:` heading and no bullets (`[review:files=tests/handoff-contract.test.ts]`, PR #322). _~20 lines._ (S)
- **Cover H-A invalid verification bullet syntax (`wi-6a4355`)** -- Add a fixture in `tests/handoff-contract.test.ts` isolating wrong bullet indentation or wrapped continuation lines and asserting malformed with no targets (`[review:files=tests/handoff-contract.test.ts]`, PR #322). _~20 lines._ (S)

### Group 108: Reuse accepted documentation audit across a mechanical late base merge

_Depends on: Group 107_

**This group delivers:** Reusing an accepted documentation audit under `doc-audit-gap=auto` across a mechanical late base merge with an unchanged PR delta and no SPEC paths, recording the named risk instead of escalating to the developer, plus the remaining three PR #322 `tests/handoff-contract.test.ts` recorded test gaps.

##### Track 108A: Reuse an accepted documentation audit across a mechanical late base merge under doc-audit-gap=auto
_4 tasks . ~160 LOC incl. tests . medium risk_
_id: wi-0e205d_
**Outcome:** Under `doc-audit-gap=auto`, a mechanical late base merge with an unchanged PR delta and no SPEC paths reuses the accepted documentation audit and records the named risk in the receipt instead of escalating to the developer, eliminating repetitive developer re-asks while keeping today's guard for every other base change.
**Supports:** [SPEC](SPEC.md) review contracts and the orchestration contract. Fixes an encountered defect (split 2 of 2 from the external-gate/doc-audit reuse card under Track 101B).
**Done when:** (1) Under `doc-audit-gap=auto`, a late base merge recorded as mechanical with an unchanged PR delta and no SPEC paths reuses the accepted documentation audit and records the named risk in the receipt instead of escalating to the developer; any other base change keeps today's guard. (2) The rule and its receipt example are documented in `docs/workflow-handoffs.md` with fixture tests, every other gate is unchanged, and skill budgets and reference digests stay valid. (3) The three placed PR #322 `tests/handoff-contract.test.ts` / `tests/fixtures/handoffs/cases.json` recorded test gaps (`wi-d363bd`, `wi-697149`, `wi-e3e13e`) have passing tests.
_touches: skills/review-and-prep.md, skills/references/review-and-prep/conditional-post-audit-reuse.md, skills/references/review-and-prep/conditional-post-audit-reaudit.md, src/review-state/render.ts, docs/workflow-handoffs.md, tests/handoff-contract.test.ts, tests/fixtures/handoffs/, tests/review-state.test.ts, tests/skill-protocols-review-and-prep.test.ts_
_blocked-by: wi-09020e_
**Scheduling:** Efficiency (developer re-asks), not 1.0-only. Split 2 of 2 from `track-review-external-gate-reuse.md` under Track 101B and the 2026-11-20 review-gate credit rule: sequenced directly after Track 107A (`wi-09020e`, sharing `skills/review-and-prep.md`, `src/review-state/render.ts`, `docs/workflow-handoffs.md` and the handoff/review-state/protocol suites) so each novel-tier review-gate trust boundary ships in its own small, auditable PR. Carries the remaining three PR #322 `tests/handoff-contract.test.ts` / `cases.json` recorded test gaps (`wi-d363bd`, `wi-697149`, `wi-e3e13e`) within `max_tasks_per_track=5` and `max_session_weight=6` (session weight 5). Narrowed from the card's folder globs to concrete files.
_Source: developer-approved card (`track-review-external-gate-reuse.md`), from an external orchestrator's manager, store message `bc16e685` (2026-11-27). Encountered case: on a consumer repository's PR, a mechanical late base merge (`pr_delta_equal: true`, no SPEC paths) recorded `reuse: merge-guard-failed` and blocked for a fresh audit; the developer (verbatim): "accept - this is not something I need to confirm everytime, it happens a lot". Also carries PR #322 `wi-d363bd`, `wi-697149` and `wi-e3e13e` `test-gaps=record` inbox files._
_read-first: skills/review-and-prep.md (late-base doc guard), skills/references/review-and-prep/conditional-post-audit-reuse.md, skills/references/review-and-prep/conditional-post-audit-reaudit.md, docs/workflow-handoffs.md_
- **Reuse accepted doc audit across a mechanical late base merge under `doc-audit-gap=auto`** -- Update `skills/review-and-prep.md`, `skills/references/review-and-prep/conditional-post-audit-reuse.md`, `conditional-post-audit-reaudit.md`, `src/review-state/render.ts` and `docs/workflow-handoffs.md` so a mechanical late base merge with unchanged PR delta and no SPEC paths reuses the accepted documentation audit and records the named risk in the receipt while preserving today's guard for every other base change, with fixture tests in `tests/handoff-contract.test.ts`, `tests/review-state.test.ts` and `tests/skill-protocols-review-and-prep.test.ts`. _~100 lines incl. tests._ (M)
- **Cover H-A duplicate verification headers (`wi-d363bd`)** -- Add duplicate top-level and repeated indented Verification-heading fixtures in `tests/handoff-contract.test.ts` asserting malformed with null targets (`[review:files=tests/handoff-contract.test.ts]`, PR #322). _~20 lines._ (S)
- **Cover H-A targets with no targeted checks run (`wi-697149`)** -- Add a fixture case in `tests/fixtures/handoffs/cases.json` and `tests/handoff-contract.test.ts` with `Ran: none` alongside populated `Could not verify:` entries (`[review:files=tests/handoff-contract.test.ts|tests/fixtures/handoffs/cases.json]`, PR #322). _~20 lines._ (S)
- **Cover H-A pending checks beside populated verification (`wi-e3e13e`)** -- Assert in `tests/handoff-contract.test.ts` and `tests/fixtures/handoffs/cases.json` that the filled fixture's pending item stays independent of verification entries (`[review:files=tests/handoff-contract.test.ts|tests/fixtures/handoffs/cases.json]`, PR #322). _~20 lines._ (S)

### Group 109: Route review skills' intake filing through bin/todo-file

_Depends on: Group 105, Group 108_

**This group delivers:** Single-owner intake filing across `/review-and-prep`, `/pair-review` and `/full-review` through `bin/todo-file` so those skills drop their duplicated inline entry templates (and an optional planner decision on a thin `/file-todo` skill).

##### Track 109A: Route /review-and-prep, /pair-review and /full-review intake filing through bin/todo-file
_1 task . ~100 LOC incl. tests . medium risk_
_id: wi-3a82ed_
**Outcome:** `/review-and-prep`, `/pair-review` and `/full-review` file every TODO or intake entry through `bin/todo-file` with explicit provenance instead of carrying their own inline template copies (with an optional planner's call for a thin user-invocable `/file-todo` skill over the helper).
**Supports:** [SPEC](SPEC.md) O2/O3 planning and review contracts. Fixes an encountered defect (split 3 of 3 from the TODO-filer provenance card under Track 101B).
**Done when:** (1) `/review-and-prep`, `/pair-review` and `/full-review` (and their intake-writing references) file entries through `bin/todo-file` instead of inline template copies, passing the developer's words when the developer explicitly deferred the item and recording `Filed by: worker` otherwise, while keeping `test-gaps=record` working as today. (2) Optional, planner's call: add a thin user-invocable `/file-todo` skill over the helper (registered in `setup` and `tests/helpers/expected-setup-skills.ts`) for managers and hand runs, or explicitly decline it in the plan. (3) Protocol tests across the updated skills stay green and skill budgets and reference digests stay valid.
_touches: skills/review-and-prep.md, skills/references/review-and-prep/conditional-repair-and-gaps.md, skills/pair-review.md, skills/references/pair-review/conditional-triage-and-queue.md, skills/full-review.md, setup, tests/helpers/expected-setup-skills.ts, tests/skill-protocols-review-and-prep.test.ts, tests/skill-protocols-pair-review.test.ts, tests/skill-protocols-full-review.test.ts, tests/skill-protocols.test.ts_
_blocked-by: wi-19e153, wi-2633cf, wi-0e205d_
**Scheduling:** Operational defect fix, not 1.0-only qualification. Split 3 of 3 from `track-todo-filer-provenance.md` under Track 101B (existing code paths split): depends on Track 105C (`wi-19e153`, the `bin/todo-file` helper), Track 105A (`wi-2633cf`, sharing the three skill files and `setup`) and Track 108A (`wi-0e205d`, sharing `skills/review-and-prep.md` and `tests/skill-protocols-review-and-prep.test.ts`, which also honors the card's scheduling note to rank after the review-efficiency chain). Kept as one mechanical caller-adoption task across the three skills rather than splitting per skill because it is a uniform template-to-helper swap (~100 LOC total). Narrowed from the card's folder globs to concrete files.
_Source: developer-approved card (`track-todo-filer-provenance.md`), criteria 2 and optional criterion 6 (see Track 105C for the developer's 2026-11-26 verbatim quote and encountered case)._
_read-first: bin/todo-file, skills/review-and-prep.md, skills/references/review-and-prep/conditional-repair-and-gaps.md, skills/pair-review.md, skills/references/pair-review/conditional-triage-and-queue.md, skills/full-review.md_
- **Wire `/review-and-prep`, `/pair-review` and `/full-review` to file entries through `bin/todo-file`** -- Replace inline intake-entry templates in `skills/review-and-prep.md`, `skills/references/review-and-prep/conditional-repair-and-gaps.md`, `skills/pair-review.md`, `skills/references/pair-review/conditional-triage-and-queue.md` and `skills/full-review.md` with `bin/todo-file` calls passing provenance (plus the optional planner's call for `/file-todo` in `setup` and `tests/helpers/expected-setup-skills.ts`), and update the skill-protocol tests while keeping skill budgets and reference digests valid. _~100 lines incl. tests._ (M)

### Group 110: 1.0 qualification — install/upgrade gaps ∥ remaining real review and run-mode records ∥ two-driver workflow qualification

_Depends on: Group 105, Group 106, Group 109_

**This group delivers:** Purely 1.0 SPEC acceptance evidence run in parallel after all efficiency and product-improvement Tracks have landed: closure of the open U1–U3 install/upgrade qualification gaps (110A), the remaining real review records and non-Claude by-hand run-mode readbacks (110B), and real by-hand and orchestrated workflow evidence on the holds-first matrix PR #291 added (110C).

##### Track 110A: Qualify install, upgrade and recovery on the owner's machines
_2 tasks . ~100 LOC . medium risk_
_id: wi-4732d3_
**Outcome:** The owner can install, onboard, upgrade and recover a working skill set on a fresh machine from the published instructions, with end-to-end evidence of loaded skill identity and a real legacy four-part upgrade through the default remote.
**Supports:** [SPEC](SPEC.md) O1 (all three criteria) and O5.2; the preserved published three-part upgrade obligation from Track 28A planning (2026-10-23), whose trigger was met by `v0.48.0`.
**Done when:** `docs/acceptance/install-upgrade.md` closes the three open checks left after PR #303 (`5da0ec8`) and PR #321 (`273dd1a`): (1) **U1** — authenticated onboarding and loaded skill identity verified on the exercised Claude Code and Codex profiles after install/upgrade; (2) **U2** — a real legacy four-part install (`v0.47.0.0`) upgraded through the default remote (`https://github.com/kbitz/gstack-extend.git`) following the Task 2 owner runbook, plus released-updater stable-channel qualification, with offered and installed commit/tag identity, v2/v4 reader compatibility, working recovery and unchanged user state (or an explicit recorded owner waiver); and (3) **U3** — disposition of open defects 7 (same-version `JUST_UPGRADED`) and 9 (duplicate `~/.local/bin` tip) and owner confirmation before O1 counts in `docs/PROGRESS.md`.
_touches: docs/acceptance/install-upgrade.md_
_blocked-by: Track 70A, Track 28A, wi-b9f147, wi-2633cf, wi-cf1ea6, wi-3a82ed_
**Status (2026-11-28):** Not done; gaps U1–U3 and released-updater qualification stay open. PR #303 (`5da0ec8`, merged 2026-11-23, docs-only, no release) created `docs/acceptance/install-upgrade.md` covering isolated scratch-HOME fresh install and onboarding (`v0.111.0`, `54fd6df`), the live `v0.112.2` (`39c2b0c`, PR #300) Bun prerequisite re-check, one-release upgrade preservation (`v0.110.1` → `v0.111.0`), per-file recovery and rollback/resume; PR #321 (`273dd1a`, `v0.124.0`, Track 102B) added a candidate-driven stable-channel upgrade check against the public remote while keeping released-updater qualification and U1–U3 open. On the developer's "SHIP WITH GAPS OPEN" decision (PR #303, touchpoint `1777c7d5`, bound to `51813798`), U1, U2 (Task 2 published legacy upgrade — open failure) and U3 (owner confirmation of O1) were deferred as PR #303 readiness gates and remain open acceptance obligations here.
**Scheduling:** Placed in the final qualification wave (Group 110) under the developer's standing rule ("Anything purely for 1.0 spec reqs and no other benefit should be last."; "I said the tracks that are purely qualification for 1.0 are last. If I have to test something for a track that otherwise does something useful, that's OK."): this Track changes no code or workflow efficiency and exists solely for SPEC O1/O5.2 acceptance evidence. Its technical edges on Track 70A (`v0.72.0`), Track 28A (`v0.47.0.0`) and Track 102B (`wi-b9f147`, `v0.124.0`) are satisfied; its edge on Track 105A (`wi-2633cf`) carries both the 1.0-only priority order and the practical benefit of qualifying the final upstream-aligned, stable-channel install/upgrade UX once; its edges on Tracks 106B (`wi-cf1ea6`) and 109A (`wi-3a82ed`) are priority-ordering edges only (no shared files) keeping purely-1.0 qualification after all efficiency and defect-repair Tracks. Kept whole as a 2-task owner-acceptance documentation card under Track 101B's same-files exception (both tasks update `docs/acceptance/install-upgrade.md` during one owner install/upgrade qualification session). Candidate or `file://`-remote proof does not satisfy U2. Kept separate from 110B and 110C because their acceptance files are disjoint, so all three run in parallel.
_read-first: docs/acceptance/install-upgrade.md, docs/installation.md, docs/acceptance/release-compatibility.md_
- **Close U1 authenticated onboarding and loaded-skill identity** -- Run a first skill invocation in authenticated Claude Code and Codex sessions after install/upgrade and record loaded revision parity and any open gaps. _~35 lines._ (S)
- **Close U2 published legacy four-part upgrade and U3 owner confirmation** -- Run the Task 2 owner runbook in `docs/acceptance/install-upgrade.md` against the default remote (or record an explicit owner waiver), disposition open defects 7 and 9, and capture owner O1 confirmation for PROGRESS. _~65 lines._ (M)

##### Track 110B: Record the owner's remaining real review runs and by-hand run-mode readbacks
_3 tasks . ~120 LOC . low risk_
_id: wi-8b4a30_
**Outcome:** The owner can see from dated records that a by-hand review with no caller lines still runs as before, that the attacker parts run with per-part models when an orchestrator delegates them, that tools-mode delegation works on an installed release, and that a stage run by hand in Codex, Muse, Grok Build or Antigravity reads back with the run mode the shared rule promises.
**Supports:** [SPEC](SPEC.md) O6 and P1, O6.1, O3.3 (the by-hand driver's evidence) and O4.4. The remainder of the earlier Track 80D (PR #256, `v0.94.2`), which left attacker-parts PM1 and PM2 and tools-mode PM1 pending; the open acceptance of Track 72B (PR #221) and the post-release PM1 of the owner-approved tools-mode plan (PR #229); and the post-merge by-hand readbacks left pending by Track 90B (PR #283; Cursor discharged on 2026-11-21), Track 94J (PR #305, `v0.115.0`, qualifying Grok Build as `user-directed`/`terminal-session`) and Track 95B (PR #308, `v0.116.0`, qualifying Antigravity as `user-directed`/`terminal-session`).
**Done when:** (1) `docs/acceptance/attacker-parts.md` records PM1 (one real by-hand `/review-and-prep` with no `Review policy:` or `Review delegates:` line, read back as unchanged, with its invocation and receipt retained) and PM2 (one orchestrated run with `delegate=adversarial,red-team` mapping the two parts to different providers or models, with its `Delegated part:` lines, v3 attempts, `found_by` labels and any fallbacks), each with date, revision, host and harness versions and PR. (2) `docs/acceptance/delegate-tools-mode.md` records its PM1 installed paired run and names the exact reviewed content its earlier dry-run evidence covers. (3) Each pending non-Claude row in `docs/acceptance/hand-use-telemetry.md`'s "Pending post-merge by-hand readbacks" (Codex, Muse, Grok Build — updated from its pre-94J `harness-unqualified` expectation to `user-directed`/`terminal-session` per Track 94J — plus Antigravity per Track 95B; the Cursor row stays discharged with "Cursor support dropped 2026-11-21") is run by hand and read back through `gstack-extend-telemetry report --by-host` and the ledger's `agent`, `run_mode` and `run_mode_source`, or stays pending with the reason. (4) A failed, unavailable or wrongly read-back run stays recorded as open, never as passed, and a wrong read-back is filed as a defect.
_touches: docs/acceptance/attacker-parts.md, docs/acceptance/delegate-tools-mode.md, docs/acceptance/hand-use-telemetry.md_
_blocked-by: Track 94J, Track 95B, wi-2633cf, wi-cf1ea6, wi-3a82ed_
**Scheduling:** Placed in the final qualification wave (Group 110) under the developer's standing rule ("the tracks that are purely qualification for 1.0 are last"): this Track changes no code or workflow efficiency and exists solely to close SPEC O6.1/O3.3/O4.4 acceptance records. Its edges on Track 105A (`wi-2633cf`), Track 106B (`wi-cf1ea6`) and Track 109A (`wi-3a82ed`) are priority-ordering edges only (no shared files); its technical edges on Track 94J (`v0.115.0`, PR #305) and Track 95B (`v0.116.0`, PR #308, item `d574f7e2`) are already satisfied. Kept whole as a 3-task owner-acceptance documentation card under Track 101B (purely documentation evidence records, not changes to existing code paths). It gates no other Track. PM2 already has partial observations (PRs #250 and #253 and a consumer repository's review) and waits only on harness CLI version provenance, which the run's operator can record from the harness at run time; tools-mode PM1 waits on the orchestrator's paired tools-mode run, requested on 2026-11-15. By-hand runs recorded here can also supply rows harvested by Track 110C (`wi-9d6cf2`), and keeping 110B separate from 110A and 110C lets all three disjoint acceptance Tracks run in parallel.
_Source: PR #256's receipt (2026-11-15: "attacker PM1/PM2 and paired tools-mode qualification remain pending"); `docs/acceptance/attacker-parts.md` and `docs/acceptance/delegate-tools-mode.md` (PM rows pending); PR #283's receipt ("post-merge hand-run readbacks PM1–PM4 in Codex, Muse, Grok and Cursor") and `docs/acceptance/hand-use-telemetry.md` (pending Codex, Muse and Grok rows; Cursor discharged 2026-11-21); PR #305's receipt ("Live by-hand readbacks are tracked in Track 94E"); and Track 95B (PR #308, item `d574f7e2`)._
_read-first: docs/delegated-review.md, docs/acceptance/hand-use-telemetry.md, docs/telemetry.md_
- **Attacker parts PM1 and PM2** -- Run and read back one by-hand review with no caller lines, and finish PM2's harness version provenance. _~50 lines._ (S)
- **Tools-mode PM1 and provenance** -- Record the installed paired run and name the content the dry-run record covers. _~40 lines._ (S)
- **By-hand run-mode readbacks** -- Run one stage by hand in each installed non-Claude harness (Codex, Muse, Grok Build, Antigravity) as its row describes and record the readback or the reason it stays pending. _~30 lines._ (S)

##### Track 110C: Qualify the workflow with two real drivers
_2 tasks . ~240 LOC . medium risk_
_id: wi-9d6cf2_
**Outcome:** The owner can carry real work through every stage both by hand and through a real external orchestrator, and the evidence shows what the documented contract actually supports.
**Supports:** [SPEC](SPEC.md) O3.3 and O4.5 (reshaped from the Paseo host Track by the owner, 2026-11-07: "72c ok").
**Done when:** A dated record names host, harness and versions for real runs by both drivers (the owner by hand, and one real external orchestrator), each run read back in telemetry with the correct run mode, covering, between them, a complete plan-to-authorized-release workflow, interrupted resume, manual-testing pause/resume, `/full-review` finish/restart, an explicit negative hold, an external-consumer handoff consumed from artifacts, a cross-session handoff and stale/partial/held handoffs; it counts operator interventions and keeps pending approvals or failures as holds; it includes the installed `/docs-ship` acceptance below; no unexercised combination is claimed.
_touches: docs/acceptance/workflow-drivers.md_
_blocked-by: Track 70A, Track 72C, Track 71E, Track 74A, Track 76A, Track 75A, Track 26A, Track 23I, Track 23A, Track 26B, Track 65A, Track 66A, Track 66B, Track 72A, Track 79A, Track 80B, Track 87A, Track 89A, Track 90A, Track 91A, Track 90B, Track 91B, Track 92A, Track 94J, Track 95B, wi-2633cf, wi-cf1ea6, wi-3a82ed_
**Status (2026-11-28):** Not done; holds stay open (unchanged since PR #291, `bbcdd0a`). PR #291 (`bbcdd0a`, merged 2026-11-22, documentation only, no release) added `docs/acceptance/workflow-drivers.md` as a holds-first matrix of 23 rows (14 `WD-*` and 9 `DS-*`; 0 pass, 23 hold at `8077fa2`), the runbooks for both drivers and seven post-92A telemetry observations. Criteria 1–2 still need the owner's real by-hand runs and one real external orchestrator's runs, each read back in telemetry; no row passes without its own live evidence on `producer_version >= 0.109.0`, and pending approvals or failures stay holds.
**Scheduling:** Placed in the final qualification wave (Group 110) under the developer's standing rule ("the tracks that are purely qualification for 1.0 are last"): this Track changes no code or workflow efficiency and exists solely for SPEC O3.3/O4.5 acceptance evidence. Its edges on Track 105A (`wi-2633cf`), Track 106B (`wi-cf1ea6`) and Track 109A (`wi-3a82ed`) are priority-ordering edges only (no shared files); all technical blockers through Track 95B (`v0.116.0`, PR #308) are already satisfied. Kept whole as a 2-task owner-acceptance documentation card under Track 101B's same-files exception (both tasks fill the same `docs/acceptance/workflow-drivers.md` matrix). **Report-only harvest available:** once installed, this Track's by-hand rows can be harvested from the developer's real by-hand runs across Claude, Codex, Muse, Grok Build and Antigravity as a report-only readback step, alongside orchestrated runs. The other developer-run record Tracks (110A, 110B) do not gate this one and run in parallel in Group 110; a run here can supply their rows, and this Track's real runs feed Track 111A (`wi-b1f0bd`). The external orchestrator may stop at a ready PR; a separate authorized run by hand proves landing. No consumer-repo edits, new spend, unattended release or acceptance-by-idle-status. The independently followed onboarding attempt moved to the public-release stage (Future).
- **Exercise both drivers** -- Run or harvest the matrix's rows (the record exists; this task fills it). Use real host-managed workspaces and approved accounts with the harnesses the owner uses for each stage; retain the bound PR and workspace, test stale/partial/held handoffs, confirm next-stage consumption from artifacts across sessions, include the host-attribution check deferred from Track 26A, and count operator interventions. _~200 documentation lines._ (L)
- **Include installed `/docs-ship` acceptance** -- Run a real docs-only PR through classification, a no-write classification hand-back, selected tests once, same-tree test-record reuse, final receipt hash, policy bump and `docs-ship/v1` without merging, and its interactive merge question; include one Sonnet-class run and one `/roadmap` handoff, and compare work/wait wall time with a recent docs PR shipped through the ordinary path. _~40 lines._ (S)

### Group 111: 1.0 qualification — measured stage cost and optimization decisions

_Depends on: Group 110_

**This group delivers:** Expected cost per stage with an adopt, reject or insufficient-evidence decision for every candidate optimization and the opted-in policy records' after fields filled, completing the final 1.0 SPEC O6 acceptance evidence.

##### Track 111A: Measure each stage's cost and decide each optimization
_4 tasks . ~500 LOC incl. tests . medium risk_
_id: wi-b1f0bd_
**Outcome:** The owner can reproduce an offline report of each stage's measured cost (model work, tool/CI/human waits, reuse and rework), read a documented expected cost per stage, and see an adopt, reject or insufficient-evidence decision for every candidate optimization.
**Supports:** [SPEC](SPEC.md) O6.1–O6.3 (owner, 2026-11-07: P1 joins the 1.0 outcomes with this finish line, and this Track gains the expected stage cost).
**Done when:** A reproducible offline report from sanitized projections separates DOCS/FULL/release-only paths, diff/task size, repo/host, run mode, skill version, waits and fresh versus resumed runs, and reports sample size and missingness; fixtures cover each split. A documented expected cost per stage (wall time and model usage, with sample size and unknowns) is published. Each efficiency-program candidate, including first-cycle overlap (69A), fold, delegation, the docs-only selection and the review run-state redesign (E15, whose adopt decision is Track 86A's record and whose post-default `insufficient-evidence` remeasurement and bounded next measurement are Track 94F's record in `docs/acceptance/review-run-state.md` §5), has measured evidence or a named evidence gap and an adopt, reject or insufficient-evidence decision with its follow-up mapped to existing Future items. The after fields that opted-in review-policy records still hold as unknown are filled from real opted-in runs where they exist, or named as evidence gaps: `docs/acceptance/review-fix-policy.md` for Tracks 33A, 51A and 75A (including whether an installed agent judged 75A's shown evidence and post-audit change classes as the skill asks) and the three after wall times in `docs/acceptance/external-gate.md`. No review gate, model choice or default changes through the study itself.
_touches: scripts/workflow-efficiency-report.py (new), tests/workflow-efficiency-report.test.ts (new), tests/fixtures/workflow-efficiency/ (new), tests/helpers/touchfiles.ts, docs/acceptance/workflow-efficiency.md (new), docs/acceptance/review-fix-policy.md, docs/acceptance/external-gate.md_
_blocked-by: Track 67A, Track 52A, Track 77A, Track 75A, Track 75B, Track 86A, Track 94F, wi-9d6cf2_
**Scheduling:** Placed last (Group 111) under both the developer's standing rule ("Anything purely for 1.0 spec reqs and no other benefit should be last.") and its technical prerequisite on Track 110C (`wi-9d6cf2`): by design, this study changes no review gate, model choice or default itself — it delivers the SPEC O6.1–O6.3 offline cost report and formal adopt/reject/insufficient-evidence decisions from real runs supplied by Track 110C (and reads Tracks 86A and 94F instead of repeating them). Kept whole as one 4-task card under Track 101B's 0-to-1 and same-files exceptions (and the 2026-10-26 card-size rule): it stands up a greenfield offline report script, test and fixture set and reads the report the baseline builds. Its edge on Track 94F is satisfied (PR #299, `f6b4267`, docs-only: verdict `insufficient-evidence` with a bounded next measurement). Session weight 6.
_Source: the Future entries "Fill the external-gate record's three "after" wall times from a real opted-in run", "Fill Track 51A's criterion-7 "after" count at the first opted-in run after a release" and "Fill Track 33A's "after" measurement and pair it with a run without the values"; PR #234's receipt (Track 75A: installed-agent judgment unmeasured, "after" unknown), 2026-11-10._
_read-first: docs/telemetry.md, docs/quota-ledger.md, docs/designs/review-independence.md, docs/acceptance/review-run-state.md_
- **Build a comparable baseline and expected stage costs** -- Produce the offline report and the per-stage expected cost from it; reuse eligible release-only receipts and preserve the first-installed-no-CI timing obligation and 15-minute target; report time to push and merge gate separately from human approval. Observational differences are not causal model comparisons. _~200 lines._ (M)
- **Assess the uncertain efficiency choices** -- Compare smaller models and lower effort for bounded drafting/extraction versus the main runner, including launch/context-transfer and parent-correction costs; investigate repeated plan extraction, evidence reads, long-suite reruns, section loading, parallel scheduling and each reviewer voice's unique accepted findings. Define corpus, quality bars, fixed budgets and stop rules before any model trial; offline analysis only, and any paid trial needs a separately approved pilot and spend bound. _~180 lines._ (M)
- **Publish decisions and follow-up ownership** -- Adopt/reject/insufficient-evidence per candidate with expected benefit, observed limitations and the smallest follow-up, mapped to existing Future items; an insufficient-evidence result names missing data and a bounded next measurement and never silently removes a review or acceptance gate. _~80 lines._ (S)
- **Fill the opted-in policy records' after fields** -- From the receipts and ledger records of real opted-in runs (PRs #233 and #234 already carry `test-gaps=record`; record which values each run carried), fill or name as gaps the after fields of the 33A, 51A and 75A sections and the external-gate record, pairing with runs without the values where the records ask. _~40 lines._ (S)

### Execution Map

Launch is decided per Track: a Track may start once every Track in its
`_blocked-by:` has landed. Tracks in one Group share no files, and wherever a
Track shares a file with a Track in an earlier Group, the packer has already
turned that into an edge here. The adjacency below is the packer's DEPENDS
output with bin numbers replaced by Group numbers; the Track IDs after each set
are the packer's own list of the Tracks that cause the edge, so a Group never
waits on a blocker's siblings. In particular, Track 105A (`wi-2633cf`, item
`a52fc49e`) is in flight now in Group 105 alongside two disjoint Layer-0 Tracks
ready to launch immediately (`105B` finding-identity workflow-metrics record and
`105C` `bin/todo-file` provenance filer); `106A` (`bin/review-state` fallback
hardening) launches as soon as `105B` lands without waiting on `105A`; `106B`
(`/roadmap` developer-deferred manifestation gate) launches once `105A` and
`105C` land; `107A` and `108A` advance the two novel-tier review-gate reuse
Tracks in sequence once `105A`, `105B` and `106A` land; `109A` wires the
review skills to `bin/todo-file` after the review-efficiency chain; and the
four purely-1.0 qualification Tracks run last in Groups 110–111. Document order
is priority, not a gate. The cards label priority choices separately from
technical prerequisites.

```
- Group 105 ← {}
- Group 106 ← {105}: Tracks 105A, 105B, 105C
- Group 107 ← {105, 106}: Tracks 105A, 105B, 106A
- Group 108 ← {107}: Track 107A
- Group 109 ← {105, 108}: Tracks 105A, 105C, 108A
- Group 110 ← {105, 106, 109}: Tracks 105A, 106B, 109A
- Group 111 ← {110}: Track 110C
```

Track detail per group:
```
Group 105: Upstream-aligned install/upgrade ∥ finding identities in workflow metrics ∥ provenance TODO filer (in progress)
  +-- Track 105A .......... ~M . 3 tasks   (in flight: item a52fc49e; upstream-aligned install/upgrade)
  +-- Track 105B .......... ~M . 1 task    (disjoint; finding identities in workflow-metrics record)
  +-- Track 105C .......... ~M . 1 task    (disjoint; bin/todo-file helper + roadmap-audit format check)
Group 106: Harden review-state inline-fallback refusals ∥ /roadmap developer-deferred provenance gate
  +-- Track 106A .......... ~M . 4 tasks   (follows 105B; 3 observed fallback classes + 3 PR #320 test gaps)
  +-- Track 106B .......... ~S . 4 tasks   (follows 105A, 105C; /roadmap gate + PR body list + 3 PR #317 gaps)
Group 107: Accept bound external full-suite pass for the pregate sentinel
  +-- Track 107A .......... ~M . 5 tasks   (follows 105A, 105B, 106A; novel-tier pregate sentinel credit + 4 gaps)
Group 108: Reuse accepted documentation audit across a mechanical late base merge
  +-- Track 108A .......... ~M . 4 tasks   (follows 107A; novel-tier doc-audit-gap=auto reuse + 3 PR #322 gaps)
Group 109: Route review skills' intake filing through bin/todo-file
  +-- Track 109A .......... ~M . 1 task    (follows 105A, 105C, 108A; wire 3 skills + optional /file-todo)
Group 110: 1.0 qualification — install/upgrade gaps ∥ remaining real review and run-mode records ∥ two-driver workflow qualification
  +-- Track 110A .......... ~M . 2 tasks   (1.0-only; U1–U3 open, follows 105A + efficiency chain)
  +-- Track 110B .......... ~S . 3 tasks   (1.0-only; remaining review runs + by-hand readbacks)
  +-- Track 110C .......... ~L . 2 tasks   (1.0-only; holds open, two-driver matrix)
Group 111: 1.0 qualification — measured stage cost and optimization decisions
  +-- Track 111A .......... ~L . 4 tasks   (1.0-only; offline O6 cost study, follows 110C)
```

**7 Groups / 12 Tracks remaining**, 1 declared in progress (Track 105A).

Only owner-confirmed acceptance in PROGRESS can satisfy a stage/checkpoint.

## Future

Deferred: docs/roadmap-future.md (181 items)

## Shipped

History: docs/roadmap-shipped.md
