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

**Order.** Since the 2026-11-25 regeneration (`586dbaa`, PR #312), three Tracks
shipped: Track 97A (`wi-2cf4fb`, PR #313, `11327a0`, `v0.118.0`, item `8b742bc1`,
replacing hand-written fence scanning in the six planning-file block-structure
readers with pinned `marked@18.1.3`), Track 100A (`wi-84aea9`, PR #314,
`465e989`, `v0.119.0`, item `42dede8a`, adding `/full-review`'s
implicit-state-machine lens and `bin/full-review-state-machines` pre-scanner,
which landed ahead of 98A and 99A) and Track 98A (`wi-4149dd`, PR #315,
`3f8c1e3`, `v0.120.0`, item `d2eb8431`, writing machine-generated review intake
to per-record files under `docs/todos/<wi-id>.md` alongside `docs/TODOS.md`).
On 2026-11-26 the developer requested a full regeneration ("Please regen the
roadmap once this merges, before you hibernate."; "Don't hibernate until I merge
the roadmap regen, I'll do it in the am"; "Let's do the full regen and make sure
we have a solid plan.") and set the priority rules for this plan (verbatim,
2026-11-26): "Anything purely for 1.0 spec reqs and no other benefit should be
last."; "That's not what I said. I said the tracks that are purely qualification
for 1.0 are last. If I have to test something for a track that otherwise does
something useful, that's OK."; "101B-D don't make sense to me as to why we want
to do them? Have we prioritized work that gives us the best bang for buck on
efficiency and helping the process run smoothly? 101a seems obvious to me that
it's next but the rest I'm not sure"; "Did you ensure that the roadmap worker
did a good job coalescing things together into single tracks where it makes
sense and has optimized for parallelization?"; and, approving the four
review-throughput cards, "Your proposal re 100 PRs article sounds good to me."

Under those rules, nothing is declared in flight (`## In Progress` is empty),
and Current Plan orders efficiency and workflow-smoothness work ahead of
purely-1.0 qualification while maximizing disjoint parallelism:
- **Group 101** runs three disjoint Tracks in parallel: Track 101A (`wi-9cfa44`,
  merge-only refresh for moved-base reviewed PRs, with the developer-approved
  defensive-context paragraph folded in as criterion 6) goes first; beside it
  run Track 101B (`wi-5dc2f5`, `/roadmap` one-task Track splits for smaller,
  faster-reviewing PRs) and Track 101C (`wi-553a78`, former 99A, bulk work-item
  ID migration and Git-history ID retirement, which removes noisy `WORK_ITEM_IDS`
  warnings, prevents retired-ID reuse in per-record intake and unblocks the
  stable channel).
- **Group 102** runs two disjoint Tracks in parallel: Track 102A (`wi-c6b6bd`,
  stable cross-cycle finding identity to cut long review tails) follows 101A,
  and Track 102B (`wi-b9f147`, former 100B, stable update channel and
  non-interactive bootstrap auto-upgrade — useful operational work that needs
  one owner channel-upgrade check) follows 101C on `docs/compatibility.md`.
- **Group 103** runs Track 103A (`wi-a257f8`, blocking-only fix cycles for
  delegated passes and Greptile), kept as a separate, sequenced novel-tier PR
  from 102A because both decide what a review gate credits.
- **Group 104** runs Track 104A (`wi-6743bd`, `/implement` handoff
  `Verification:` block so review cycle 1 starts from what could not be
  verified), sequenced after 103A on `skills/review-and-prep.md` and
  `docs/workflow-handoffs.md`.
- **Group 105** runs Track 105A (`wi-2633cf`, former 101A, upstream-aligned
  install/upgrade flow with grouped What's-new and per-host summaries), sequenced
  after all skill-editing Tracks and 102B, and right before install/upgrade
  qualification so the final UX is qualified once.
- **Groups 106 and 107** place the four purely-1.0-qualification Tracks last:
  three disjoint owner-run acceptance Tracks run in parallel in Group 106 —
  install/upgrade qualification gaps U1–U3 (106A, `wi-4732d3`, former 97B),
  remaining real review records and by-hand run-mode readbacks (106B,
  `wi-8b4a30`, former 97C) and two-driver workflow qualification (106C,
  `wi-9d6cf2`, former 97D) — followed by the offline O6 stage-cost study and
  optimization decisions in Group 107 (107A, `wi-b1f0bd`, former 98B), which
  changes no review gate, model choice or default and consumes 106C's runs.
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
reconciliation. Track 92A's plan follow-up 92E (name its release in the
compatibility catalog's retired-surface entry) is carried by Track 102B (former
100B), because this skill does not edit the catalog. The Cursor by-hand readback
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

**Labels.** This regeneration (2026-11-26) recorded Track 97A (`wi-2cf4fb`,
PR #313 `11327a0` `v0.118.0`, item `8b742bc1`), Track 100A (`wi-84aea9`,
PR #314 `465e989` `v0.119.0`, item `42dede8a`) and Track 98A (`wi-4149dd`,
PR #315 `3f8c1e3` `v0.120.0`, item `d2eb8431`), retiring Groups 97, 98 and 100
by tombstones (Group 99 had no shipped Track). `## In Progress` is empty. Five
developer-approved cards were placed with newly minted immutable IDs: Track 101A
(`wi-9cfa44`), Track 101B (`wi-5dc2f5`), Track 102A (`wi-c6b6bd`), Track 103A
(`wi-a257f8`) and Track 104A (`wi-6743bd`). Remaining unshipped Tracks recycled
from 101 in packer order: former 99A became 101C (`wi-553a78`); former 100B
became 102B (`wi-b9f147`); former 101A became 105A (`wi-2633cf`); former 97B
became 106A (`wi-4732d3`); former 97C became 106B (`wi-8b4a30`); former 97D
became 106C (`wi-9d6cf2`); former 98B became 107A (`wi-b1f0bd`). The renames
are in this regeneration's commit message. Shipped numbers through 98 and 100
are reserved by tombstones; 64 was never a roadmap Group.

Target: [SPEC](SPEC.md) O1–O6, 1.0.0 as the owner's own real use by hand and
through an orchestrator; audience ceiling potentially-public. No workspace host
or orchestrator is required; support claims name only exercised combinations.
Implementation, installed/operator evidence and owner acceptance remain
distinct. No new spend or unattended merge is authorized.


## In Progress


## Current Plan

_tombstone: 17, 19, 20, 22, 23, 24, 25, 26, 28, 29, 30, 31, 32, 33, 47, 48, 49, 50, 51, 52, 57, 58, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 100_

### Group 101: Merge-only refresh after base move ∥ one-task roadmap splits ∥ work-item ID migration and Git-history retirement

_Depends on: none_

**This group delivers:** A merge-only `/review-and-prep` refresh mode for moved-base reviewed PRs plus host-session defensive context framing (Track 101A, first); qualitative one-task splitting for existing-code-path cards in `/roadmap` so PRs stay smaller and review faster (Track 101B, disjoint); and one-time idempotent work-item ID migration, Git-history ID retirement and strict `WORK_ITEM_IDS` enforcement across all planning documents (Track 101C, disjoint).

##### Track 101A: Refresh a reviewed PR after a base move without a new review
_2 tasks . ~300 LOC incl. tests . medium risk_
_id: wi-9cfa44_
**Outcome:** A PR that `/review-and-prep` already prepared or marked ready, and whose base then moved, can be brought current by a merge-only refresh: merge the base, resolve the conflict, review only what the merge changed, rerun the final gate and mark the PR ready again. It runs no new review cycles, delegated parts, coverage or documentation audits, or Greptile, and escalates to a full review only when the merge changes code the earlier review passed. A docs-only conflict (most often `docs/TODOS.md`) then costs minutes instead of a whole review session.
**Supports:** [SPEC](SPEC.md) review contracts and the orchestration contract. Fixes an encountered defect.
**Done when:** (1) `/review-and-prep` accepts a refresh invocation for a PR that holds this skill's prepared or ready receipt for an earlier head, with a stated cause of a moved base (for example `/review-and-prep refresh` with `Cause: base_moved`). Without such a receipt, or with any other cause, it refuses with a clear message and changes nothing. (2) The refresh merges the current base through the skill's existing merge step, resolves the conflicts, and classifies the merge's own delta against the reviewed head: files changed only by the base, conflict resolutions in prose, TODOS or generated files, and code hunks the earlier review covered. (3) When the merge changed no code the earlier review passed (base-only changes and prose, TODOS or generated-file resolutions), the refresh reviews only that delta, reruns the final gate (the external full-suite gate when the caller supplies it, under the same policy line), pushes, and marks the PR ready with a refresh receipt naming the reviewed head, the new head, the merge's delta classification and the gate result. It runs no new review cycle, delegated part, coverage audit, documentation audit or Greptile run. (4) When the merge changes reviewed code (a conflict resolved inside reviewed code, or a base change that alters its behaviour), the refresh stops with a fixed escalation line naming the files and the reason, leaves the PR draft, and ends with the normal `/review-and-prep` handoff, so the caller runs a full review. (5) The invocation, the refresh receipt's lines and the escalation line are documented in `docs/workflow-handoffs.md` as a compatibility surface for orchestrators, with a fixture-tested example of each outcome. (6) (Folded fix.) Near the start of `/review-and-prep`, read by the review's own host session (not only the outside-voice and red-team delegate prompts, which already carry one), one short paragraph states the defensive context: this is the repository owner's own project, reviewed at the owner's request before merge; every probe of file handling, paths or inputs is a defensive correctness check of this repository's code; no exploit code, attack technique or reproduction against other systems is wanted; and probes and findings are described in correctness terms (expected input accepted, unexpected input refused with a clear message). A skill-protocol test locks the paragraph's presence in the core skill, and skill budgets and reference digests stay valid.
_touches: skills/review-and-prep.md, skills/references/review-and-prep/, src/review-state/, bin/review-state, docs/workflow-handoffs.md, tests/review-state.test.ts, tests/handoff-contract.test.ts, tests/fixtures/handoffs/, tests/skill-protocols-review-and-prep.test.ts_
**Scheduling:** First in Current Plan on the developer's explicit priority order ("101a seems obvious to me that it's next"). Efficiency/smoothness payoff: eliminates full ~2-hour review reruns on docs-only base moves (minutes instead of a whole review session), and the folded criterion-6 defensive-context paragraph coalesces a small same-file `skills/review-and-prep.md` fix (approved 2026-11-26) to cut provider cybersecurity-filter interruptions on review host sessions without spending a separate pipeline run. Pairs with Track 98A (shipped, `v0.120.0`), which removed the most common `docs/TODOS.md` conflict; this Track covers every docs-only base move. Narrowed from the card's `tests/**` glob to the concrete review-state, handoff and review-and-prep protocol suites so disjoint Tracks can run in parallel in Group 101.
_Source: external orchestrator's manager, store message `49e60fa0` (2026-11-25), quoting the developer (verbatim): "it is a MASSIVE waste of resources to run full review passes again, just because of a docs conflict"; then "card both parts and prioritize them". Encountered case: a consumer PR passed review (final gate 4807/0), then another PR merged and it conflicted only in `docs/TODOS.md`; the release script refused the carry and a full new review session cost about two hours. Criterion 6 folded in on the developer's word, 2026-11-26 03:14Z (the developer (verbatim): "Ok - let's do this, seems like there's no downside"; touchpoint `dfe2ff88`): Codex's cybersecurity content filter stopped review host sessions on 2026-11-08, 2026-11-19 and repeatedly since 2026-11-23 (Track 98A's review twice on 2026-11-26, once on the host's own path-safety probes and once while composing the outside-voice request); the host session has no defensive framing today. Measure by filter stops per review before and after; the filter is the provider's, so the paragraph reduces rather than guarantees._
_read-first: skills/review-and-prep.md (Step 2 base merge, the readiness gate's moved-base rule, receipts), skills/ship-and-land.md (its verified-delta reuse after base integration), docs/workflow-handoffs.md_
- **Implement merge-only refresh mode, delta classification, escalation and handoff docs** -- Add `/review-and-prep refresh` (`Cause: base_moved`) receipt validation, base merge and delta classification, docs-only fast path (review merge delta, rerun final gate, push, mark ready with refresh receipt) and reviewed-code escalation (fixed line, stay draft, normal handoff), plus `src/review-state/` / `bin/review-state` support, `docs/workflow-handoffs.md` contract entries and fixture tests for every outcome. _~255 lines incl. tests._ (M)
- **Add host-session defensive context paragraph to `/review-and-prep` (criterion 6)** -- Add the short defensive-context paragraph near the start of `skills/review-and-prep.md`, lock its presence in `tests/skill-protocols-review-and-prep.test.ts` and keep skill budgets and reference digests valid. _~45 lines incl. tests._ (S)

##### Track 101B: Have /roadmap split cards that change existing code paths into one-task Tracks
_1 task . ~120 LOC incl. tests . low risk_
_id: wi-5dc2f5_
**Outcome:** `/roadmap` places a card that changes existing code paths as one-task Tracks (one PR each) instead of one multi-task Track, while a new module's first version may still land whole; the rule stays qualitative judgment in skill prose, not a numeric trigger, under this project's Design rule.
**Supports:** [SPEC](SPEC.md) roadmap contracts; process efficiency (smaller PRs review faster and come back clean more often).
**Done when:** (1) `skills/roadmap.md` states the rule and its exception (0-to-1 work, the developer's caveat) in qualitative terms, with the existing same-files exception still honoured. (2) The proposal Summary names each card it split and each it kept whole, with the reason. (3) A skill-protocol test locks the rule's presence; skill budgets and reference digests stay valid.
_touches: skills/roadmap.md, skills/references/roadmap/, tests/skill-protocols-roadmap.test.ts_
**Scheduling:** High-leverage, low-cost efficiency work (~120 LOC, 1 task) that runs in parallel in Group 101 because its file footprint is completely disjoint from Tracks 101A and 101C. Efficiency payoff: reviewed throughput data shows median review time drops from 2.74 h above 1,000 changed lines to 1.05 h under 200 lines, and half of merged PRs currently exceed 1,000 lines; landing this early makes every subsequent regeneration produce smaller, cleaner PRs. Narrowed from the card's `tests/**` glob to `tests/skill-protocols-roadmap.test.ts` so it packs beside 101A and 101C.
_Source: external orchestrator's manager, store message `8e358b39` (2026-11-26), approved by the developer (verbatim): "Your proposal re 100 PRs article sounds good to me." Data: median review 1.05 h under 200 changed lines vs 2.74 h over 1,000, and half of merged PRs are over 1,000 lines (2026-11-26 review-throughput analysis)._
_read-first: skills/roadmap.md (card sizing, same-files exception), CLAUDE.md (Design: judgment stays qualitative)_
- **Add qualitative one-task splitting rule, proposal reporting and protocol lock to `/roadmap`** -- Update `skills/roadmap.md` with the qualitative one-task rule for existing code paths, its 0-to-1 exception and the retained same-files exception, require the proposal Summary to name each split or kept-whole card with its reason, add the lock in `tests/skill-protocols-roadmap.test.ts` and keep skill budgets and reference digests valid. _~120 lines incl. tests._ (S)

##### Track 101C: Migrate existing planning records to work-item IDs and retire IDs across Git history
_2 tasks . ~400 LOC incl. tests . medium risk_
_id: wi-553a78_
**Outcome:** Every existing `TODOS.md` entry, Future bullet, active Track and shipped-history record gets a work-item ID by a one-time, idempotent migration, and a killed, shipped or merged ID is never reused even after its record leaves the files, so the ID format added by Track 96D covers old records as well as new ones.
**Supports:** [SPEC](SPEC.md) O2 (roadmap contracts). Completes the stable work-item IDs commitment (`wi-914dff`), split out of PR #311's review by the developer's SPLIT decision (`1f5f60a3-9712-4b45-9d8b-0912e761fe7f`).
**Done when:** (1) A one-time migration assigns IDs to existing entries and cards across `docs/TODOS.md`, `docs/roadmap-future.md`, `docs/ROADMAP.md` and `docs/roadmap-shipped.md` (about 290 records in this repository) without changing any other text, and is idempotent. (2) ID minting checks uniqueness against IDs that appear anywhere in the project's Git history, not only the current files, so an ID is never reused after its record is killed, shipped or merged into another. (3) The migration and the history scan handle the record shapes PR #311's review found: legacy Group 1–21 Track bullets, `## Completed` headings and their neighbouring records, inline code spans that look like ID fields, descriptive Future headings, and paths reached through alternate checkout spellings, aliases or an inherited Git pathspec setting; each has a fixture. (4) Once this repository is migrated, a missing ID becomes an audit failure again (Track 96D made it advisory), and `docs/source-tag-contract.md`, `docs/compatibility.md` and release notes say so.
_touches: src/audit/lib/work-item-id.ts, src/audit/id-cli.ts, bin/roadmap-id, src/audit/lib/git.ts, src/audit/checks/work-item-ids.ts, docs/TODOS.md, docs/roadmap-future.md, docs/ROADMAP.md, docs/roadmap-shipped.md, docs/source-tag-contract.md, docs/compatibility.md, tests/roadmap-id.test.ts, tests/check-work-item-ids.test.ts, tests/audit-snapshots.test.ts, tests/roadmap-audit/_
_blocked-by: wi-914dff, wi-2cf4fb, wi-4149dd_
**Scheduling:** Operational workflow smoothness, not 1.0-only qualification: completes Track 96D (`v0.117.0`), eliminates ~272 noisy `WORK_ITEM_IDS` audit warnings on every `/roadmap` run, prevents retired ID reuse across Git history in per-record intake (`docs/todos/<wi-id>.md`) and orchestrator tracking, and unblocks Track 102B (`wi-b9f147`, sharing `docs/compatibility.md`). All three technical prerequisites (`wi-914dff` Track 96D, `wi-2cf4fb` Track 97A, `wi-4149dd` Track 98A) have shipped, and its file footprint is completely disjoint from Tracks 101A and 101B so it runs in parallel in Group 101 at zero latency cost to the review-efficiency chain. Kept as one card above ~300 lines under the card-size rule's same-files exception (owner direction, 2026-10-26): the migration command, Git-history retirement scan and strict `WORK_ITEM_IDS` flip edit the same `work-item-id.ts`, `id-cli.ts`, `git.ts` and `work-item-ids.ts` files and ship together as the split half of PR #311. Plan as a parser of free-form Markdown: prefer an exact, enumerated set of record shapes with a fixture for each over interpreting variants, and say at planning which shapes are refused rather than guessed; PR #311's stop receipts (continuations 1–3) list every edge case found so far.
_Source: the developer's SPLIT decision (`1f5f60a3-9712-4b45-9d8b-0912e761fe7f`, 2026-11-25) on item `6c091012`'s third review-cap stop at `058a6cf`; the half moved out of PR #311._
_read-first: src/audit/lib/work-item-id.ts, src/audit/id-cli.ts, src/audit/lib/git.ts, docs/source-tag-contract.md_
- **Implement idempotent bulk migration and Git-history ID retirement** -- Add the one-time idempotent migration across all four planning documents plus Git-history ID retirement in `bin/roadmap-id` / `src/audit/lib/git.ts`, with fixtures for legacy Group 1–21 bullets, `## Completed` headings, inline code spans, descriptive Future headings, and alternate checkout spellings/pathspecs. _~220 lines incl. tests._ (M)
- **Migrate this repository's planning records and enforce missing IDs as audit failures** -- Run the migration across this repository's planning files, flip `WORK_ITEM_IDS` missing-ID findings from warn to fail, update `docs/source-tag-contract.md`, `docs/compatibility.md` and snapshots, and disclose the enforcement change for release notes. _~180 lines incl. tests._ (M)

### Group 102: Stable cross-cycle finding identity ∥ stable update channel

_Depends on: Group 101_

**This group delivers:** Stable cross-cycle finding identities and premise/class counts in `/review-and-prep` so orchestrators can stop repeated-premise review tails and reserve continuations for shrinking tails (Track 102A, following 101A); and upgrades that follow a stable release channel with offered-equals-installed identity, non-interactive bootstrap auto-upgrade and missing-`gstack` reporting (Track 102B, disjoint, following 101C).

##### Track 102A: Give review findings a stable identity across cycles so a review can tell new defects from carried ones
_2 tasks . ~300 LOC incl. tests . medium risk_
_id: wi-c6b6bd_
**Outcome:** Every finding `/review-and-prep` records carries a stable identity that survives from one review cycle to the next (and into a continuation), plus a short premise or defect-class tag, so the run state and receipts can say which findings are new, which are carried and which share a premise with earlier ones. Orchestrators can then return a review whose new findings keep repeating one premise to planning or to the developer at the cycle cap, and keep the repair-only continuation for a genuinely shrinking tail.
**Supports:** [SPEC](SPEC.md) review contracts and the orchestration contract; process efficiency (fewer long review tails).
**Done when:** (1) Each finding in the review run state (`src/review-state/**`) carries an identity key derived from stable inputs (file, a normalized anchor, the finding's class), not from cycle-local numbering; the same defect found again in a later cycle or a continuation gets the same key, and a different defect at the same line gets a different one. Fixture tests cover a carried finding, a re-anchored finding after an unrelated edit above it, and two distinct findings on one line. (2) Each finding carries a premise or class tag from a closed, documented set; the stop receipt and the run state report, per cycle, counts of new, carried and repeated-premise findings. (3) The finding ledger no longer reports `cross_cycle_identity: no_cross_cycle_key`; existing ledgers without keys still load. (4) The identity, tag set and per-cycle counts are documented in `docs/workflow-handoffs.md` as a compatibility surface for orchestrators, with fixture-tested examples.
_touches: src/review-state/, bin/review-state, skills/review-and-prep.md, skills/references/review-and-prep/, docs/workflow-handoffs.md, tests/review-state.test.ts, tests/handoff-contract.test.ts, tests/fixtures/handoffs/, tests/skill-protocols-review-and-prep.test.ts_
_blocked-by: wi-9cfa44_
**Scheduling:** Efficiency work ranked immediately after merge-only refresh (Track 101A, `wi-9cfa44`, sharing `skills/review-and-prep.md`, `src/review-state/` and `docs/workflow-handoffs.md`). Efficiency payoff: targets the 12–16% of reviews that currently need three or more continuations and whose findings-per-cycle curve falls 16 -> 4 -> 2 then rises again in the long tail, giving orchestrators structured per-cycle new/carried/repeated-premise counts instead of `no_cross_cycle_key`. Kept as a separate, sequenced PR from Track 103A (`wi-a257f8`, blocking-only fix cycles): both decide what a review gate credits (a trust boundary in this project, planned at novel tier), combined size would exceed the ~300-line card threshold (~500 lines), and any decision about whether a finding counts as resolved is made from an exact key or schema the gate checks, never from free-form model prose. Narrowed from the card's `tests/**` glob to the concrete review-state, handoff and review-and-prep protocol suites so Track 102B can run in parallel.
_Source: external orchestrator's manager, store message `8e358b39` (2026-11-26), approved by the developer (verbatim): "Your proposal re 100 PRs article sounds good to me." Data: all 131 finding ledgers read so far report `cross_cycle_identity: no_cross_cycle_key`; 12–16% of reviews need three or more continuations, and findings per cycle fall 16 -> 4 -> 2 and then rise again in the long tail (2026-11-26 review-throughput analysis)._
_read-first: src/review-state/ (the ledger and render), skills/review-and-prep.md (cycles, stop receipt), docs/workflow-handoffs.md_
- **Add stable finding identity keys, closed premise/class tags and per-cycle counts in `src/review-state/`** -- Derive stable finding identity keys from file, normalized anchor and finding class (preserving load compatibility for existing keyless ledgers), add the closed documented premise/class tag set and per-cycle new/carried/repeated-premise counts in run state and stop receipts, and cover carried, re-anchored and same-line distinct findings in `tests/review-state.test.ts`. _~190 lines incl. tests._ (M)
- **Wire skill instructions, handoff contract and fixture tests for cross-cycle finding identity** -- Update `skills/review-and-prep.md`, `skills/references/review-and-prep/`, `bin/review-state` and `docs/workflow-handoffs.md` with the identity key, tag set and per-cycle count surface, plus fixture tests in `tests/handoff-contract.test.ts` and `tests/skill-protocols-review-and-prep.test.ts`. _~110 lines incl. tests._ (M)

##### Track 102B: Follow a stable release channel and let a bootstrap turn on auto-upgrade
_5 tasks . ~290 LOC incl. tests . medium risk_
_id: wi-b9f147_
**Outcome:** gstack-extend upgrades follow a stable release channel rather than main, each upgrade installs the release it offered, and a bootstrap script can turn on auto-upgrade on that channel without a prompt, mirroring gstack's `auto_upgrade` and `update_channel` settings.
**Supports:** [SPEC](SPEC.md) O1 (install, update and recover) and O5 (release promise). Required before 1.0. Owner, 2026-11-07: "Another we need here for 1.0 (if not already done) - on install, we should check for gstack and extend and install them if missing + turn on auto upgrade on stable for both — they are dependencies" and "This can be deferred to be done right before 1.0".
**Done when:** An `update_channel` setting selects a stable channel (release tags, or a stable branch the release step advances, chosen in the plan) and keeps today's main-tracking behavior available, with existing main-tracking installs and the rollback recipe documented in `docs/installation.md`; `bin/update-check` offers and `bin/update-run` installs the same release identity, or reports the mismatch; a documented non-interactive command enables auto-upgrade on the channel; `setup` reports a missing gstack install actionably (installing it stays the bootstrap's job unless the plan shows otherwise); retrying an update after a Bun prerequisite refusal with a supported Bun version is covered by an update test; `bin/update-check`'s published output and install-safety stay compatible; the compatibility catalog lists the setting, and its Cursor and OpenCode retired-surface entry names Track 92A's release (`0.109.0`; Track 92A's plan follow-up 92E); a dated upgrade through the stable channel on the owner's machine is added to `docs/acceptance/install-upgrade.md`.
_touches: bin/update-check, bin/update-run, bin/config, setup, docs/installation.md, docs/compatibility.md, tests/update.test.ts, docs/acceptance/install-upgrade.md_
_blocked-by: Track 77A, wi-553a78_
**Scheduling:** Operational smoothness, not 1.0-only qualification: stops `bin/update-run` from pulling untagged `main` commits, binds offered-to-installed release identity, provides a non-interactive bootstrap auto-upgrade command and flags missing `gstack` at setup. Although task 5 includes an owner channel-upgrade check in `docs/acceptance/install-upgrade.md`, the developer clarified (2026-11-26) that only purely-1.0-qualification Tracks go last ("If I have to test something for a track that otherwise does something useful, that's OK"). Completely disjoint from Track 102A, so it runs in parallel in Group 102 with zero delay to the review-efficiency chain; its technical edges are on Track 77A (shipped) and Track 101C (`wi-553a78`, sharing `docs/compatibility.md`). Prior priority edges on the purely-1.0 qualification Tracks (`wi-4732d3`, `wi-9d6cf2`) were removed under the 2026-11-26 ordering rule so Track 106A (`wi-4732d3`) now runs after this Track and qualifies the final stable-channel upgrade once. Kept separate from Track 105A (`wi-2633cf`) because combining them would exceed both the 5-task and ~300-line caps (8 tasks, ~580 lines) and would block this Track from running in parallel with 102A. Facts rechecked 2026-11-26 at `3f8c1e3`: `bin/update-run` still fast-forwards `origin main`; there is no channel setting; `setup` enforces Bun >= 1.3.3 via `bin/lib/bun-prereq.sh` (Track 94H, `v0.112.2`) and still checks no installed gstack; `bin/config set auto_upgrade true` is honored only by interactive upgrade flows, and spawned sessions never upgrade. Carries Track 94H's recorded test gap `[review:files=bin/update-run|setup|tests/update.test.ts]` ("Cover retrying an update after a Bun refusal", PR #300 coverage audit at `aaf05a0`), within 5 tasks and session weight 6. An orchestrator's bootstrap does its own install-if-missing; this repository owes the channel, the setting and the non-interactive enable path.
_Source: owner-approved card (2026-11-07); Track 92A's plan follow-up 92E (PR #290's approved plan); merges the Future entry "Bind upgrade offers to the installed release identity" (raised during Track 28A planning, 2026-10-23); inbox `[review:files=bin/update-run|setup|tests/update.test.ts]` from PR #300 (`aaf05a0`, 2026-11-23)._
_read-first: docs/installation.md, docs/acceptance/release-compatibility.md, docs/acceptance/install-upgrade.md_
- **Stable channel and offered-equals-installed identity** -- The `update_channel` key and its values, the channel mechanism, and binding the installed release to the offered one, with update tests. _~170 lines incl. tests._ (M)
- **Non-interactive enable and rollback** -- Document and test the bootstrap command and the return to main tracking. _~50 lines incl. tests._ (S)
- **Report a missing gstack at setup** -- An actionable result when installed gstack is absent. _~20 lines incl. tests._ (S)
- **Cover retrying an update after a Bun refusal** -- Add a disposable-remote fixture with two local Bun binaries to `tests/update.test.ts` verifying that retrying after a Bun prerequisite refusal completes pending migrations once. _~25 lines._ (S)
- **Record a real channel upgrade** -- Upgrade the owner's install through the stable channel and record offered and installed identity in `docs/acceptance/install-upgrade.md`; list the setting in the catalog and name release `0.109.0` in its Cursor and OpenCode retired-surface entry. _~30 lines._ (S)

### Group 103: Blocking-only fix cycles for delegated passes and Greptile

_Depends on: Group 102_

**This group delivers:** A review-gate rule so delegated passes and Greptile trigger a fix cycle only on blocking-severity findings backed by file-and-line evidence, keeping non-blocking noise in receipts and intake instead of burning extra commits and review rounds.

##### Track 103A: Start a review fix cycle only for blocking findings from delegated passes and Greptile
_2 tasks . ~200 LOC incl. tests . medium risk_
_id: wi-a257f8_
**Outcome:** In `/review-and-prep`, findings from the delegated parts (maintainability, adversarial, red team) and from Greptile start a fix cycle only when they are blocking severity under the existing severity taxonomy; non-blocking findings go to the receipt (and to intake where the skill already records them) instead of triggering another commit and another review round. Each finding that does start a cycle names file and line evidence.
**Supports:** [SPEC](SPEC.md) review contracts; process efficiency (fewer fix rounds per review).
**Done when:** (1) A delegated or Greptile finding below blocking severity never starts a fix cycle on its own; it is listed in the receipt with its severity and, where `test-gaps=record` or `blocking=shown` already applies, recorded as today. (2) A blocking finding without file-and-line evidence is not credited as blocking; the receipt says why. (3) The core review's own blocking findings, the external full-suite gate and every existing hold are unchanged. (4) Receipt lines and the rule are documented for orchestrators in `docs/workflow-handoffs.md`, with fixture tests for a non-blocking delegate finding, a blocking one with evidence and a blocking one without.
_touches: skills/review-and-prep.md, skills/references/review-and-prep/, src/review-state/, docs/workflow-handoffs.md, tests/review-state.test.ts, tests/handoff-contract.test.ts, tests/fixtures/handoffs/, tests/skill-protocols-review-and-prep.test.ts_
_blocked-by: wi-c6b6bd_
**Scheduling:** High-payoff efficiency work sequenced directly after Track 102A (`wi-c6b6bd`, sharing `skills/review-and-prep.md`, `skills/references/review-and-prep/`, `src/review-state/` and `docs/workflow-handoffs.md`). Efficiency payoff: stops non-blocking delegated and Greptile findings from triggering extra commits and review rounds while keeping core blocking findings, external full-suite gates and holds intact. Kept as a separate, sequenced PR from Track 102A (and from Track 104A): it decides what a review gate credits (a trust boundary in this project, planned at novel tier), reads the existing structured severity field (never free-form prose), and keeping each trust-boundary change in its own PR (~200 LOC here, ~300 LOC in 102A) keeps both reviews small and auditable. Narrowed from the card's `tests/**` glob to the concrete review-state, handoff and review-and-prep protocol suites.
_Source: external orchestrator's manager, store message `8e358b39` (2026-11-26), approved by the developer (verbatim): "Your proposal re 100 PRs article sounds good to me." Idea 4 of the 2026-11-26 PR-throughput brief (Anthropic's review post: "Noise costs more when the author is an agent... another commit and another round of review.")._
_read-first: skills/review-and-prep.md (delegated parts, Greptile, fix cycles), skills/full-review.md and docs/source-tag-contract.md (severity taxonomy)_
- **Enforce blocking-only fix-cycle credit and file-and-line evidence in `/review-and-prep` and `src/review-state/`** -- Restrict delegated-pass and Greptile fix-cycle triggers to structured blocking-severity findings with file-and-line evidence, route non-blocking and unverified-evidence findings to the receipt (and existing `test-gaps=record` / `blocking=shown` intake) with reasons, and leave core blocking findings, external full-suite gates and holds unchanged. _~120 lines incl. tests._ (S)
- **Document receipt contract and add fixture tests for delegated and Greptile severity gating** -- Update `docs/workflow-handoffs.md` and add fixture tests covering a non-blocking delegate finding, a blocking finding with file-and-line evidence and a blocking finding without evidence across `tests/review-state.test.ts`, `tests/handoff-contract.test.ts` and `tests/skill-protocols-review-and-prep.test.ts`. _~80 lines incl. tests._ (S)

### Group 104: Verification block in /implement handoff

_Depends on: Group 103_

**This group delivers:** A fixed `Verification:` block (`Ran:` and `Could not verify:`) on every `/implement` handoff that `/review-and-prep` targets first in cycle 1, catching unverified gaps early before review rounds accumulate.

##### Track 104A: Add a Verification block to /implement's handoff so review starts from what could not be verified
_2 tasks . ~150 LOC incl. tests . low risk_
_id: wi-6743bd_
**Outcome:** `/implement`'s handoff carries a fixed `Verification:` block listing what ran (commands and results) and what could not be verified (with the reason), so an orchestrator can check that the block exists, as it already checks the count line, and `/review-and-prep`'s first cycle targets the could-not-verify list first.
**Supports:** [SPEC](SPEC.md) O2/O3 handoff contracts; process efficiency (catch problems before review).
**Done when:** (1) Every `/implement` handoff includes a `Verification:` block with two fixed sub-lists, `Ran:` and `Could not verify:` (each may be `none`), in a documented exact shape. (2) `/review-and-prep` reads the block when present and names each could-not-verify entry in its first cycle's scope; a handoff without the block still works as today. (3) The block's shape is documented in `docs/workflow-handoffs.md` as a compatibility surface, with fixture handoffs (both lists filled, both `none`, block absent) checked by the handoff-contract tests.
_touches: skills/implement.md, skills/review-and-prep.md, docs/workflow-handoffs.md, tests/handoff-contract.test.ts, tests/fixtures/handoffs/, tests/skill-protocols-implement.test.ts, tests/skill-protocols-review-and-prep.test.ts_
_blocked-by: wi-a257f8_
**Scheduling:** Efficiency work sequenced right after Track 103A (`wi-a257f8`) because it edits `skills/review-and-prep.md`, `docs/workflow-handoffs.md` and the handoff/protocol test suites. Efficiency payoff: surfaces unverified areas before review starts and focuses cycle 1 on them first, reducing avoidable back-and-forth across review rounds. Kept separate from Track 103A so the novel-tier trust-boundary gate change in 103A stays single-concern and low-risk `/implement` handoff formatting does not widen it (combined size would also exceed ~300 lines). Narrowed from the card's `tests/**` glob to the concrete handoff and skill-protocol suites.
_Source: external orchestrator's manager, store message `8e358b39` (2026-11-26), approved by the developer (verbatim): "Your proposal re 100 PRs article sounds good to me." Idea 5 of the 2026-11-26 PR-throughput brief (Larson: "the bottleneck wasn't pull request approval, but instead generating approvable pull requests"); external orchestrators can add a transport check that the block exists._
_read-first: skills/implement.md (handoff shape), docs/workflow-handoffs.md, tests/handoff-contract.test.ts_
- **Emit the fixed `Verification:` block in `/implement` and target `Could not verify:` in `/review-and-prep` cycle 1** -- Add the exact `Verification:` (`Ran:` / `Could not verify:`) block to `skills/implement.md`, teach `skills/review-and-prep.md` to read it when present and name each could-not-verify entry in cycle 1's scope while preserving absent-block compatibility, and lock both in `tests/skill-protocols-implement.test.ts` and `tests/skill-protocols-review-and-prep.test.ts`. _~85 lines incl. tests._ (S)
- **Document the `Verification:` compatibility surface and add fixture handoff tests** -- Document the exact shape in `docs/workflow-handoffs.md` and add fixture handoffs (both lists filled, both `none`, block absent) under `tests/fixtures/handoffs/` checked by `tests/handoff-contract.test.ts`. _~65 lines incl. tests._ (S)

### Group 105: Install and upgrade aligned with upstream gstack

_Depends on: Group 101, Group 102, Group 104_

**This group delivers:** An install and upgrade flow that looks and behaves like upstream gstack's, with a grouped What's-new summary and per-host upgrade status printed after every upgrade.

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

### Group 106: 1.0 qualification — install/upgrade gaps ∥ remaining real review and run-mode records ∥ two-driver workflow qualification

_Depends on: Group 102, Group 105_

**This group delivers:** Purely 1.0 SPEC acceptance evidence run in parallel after all efficiency and product-improvement Tracks have landed: closure of the open U1–U3 install/upgrade qualification gaps (106A), the remaining real review records and non-Claude by-hand run-mode readbacks (106B), and real by-hand and orchestrated workflow evidence on the holds-first matrix PR #291 added (106C).

##### Track 106A: Qualify install, upgrade and recovery on the owner's machines
_2 tasks . ~100 LOC . medium risk_
_id: wi-4732d3_
**Outcome:** The owner can install, onboard, upgrade and recover a working skill set on a fresh machine from the published instructions, with end-to-end evidence of loaded skill identity and a real legacy four-part upgrade through the default remote.
**Supports:** [SPEC](SPEC.md) O1 (all three criteria) and O5.2; the preserved published three-part upgrade obligation from Track 28A planning (2026-10-23), whose trigger was met by `v0.48.0`.
**Done when:** `docs/acceptance/install-upgrade.md` closes the three open checks left after PR #303 (`5da0ec8`): (1) **U1** — authenticated onboarding and loaded skill identity verified on the exercised Claude Code and Codex profiles after install/upgrade; (2) **U2** — a real legacy four-part install (`v0.47.0.0`) upgraded through the default remote (`https://github.com/kbitz/gstack-extend.git`) following the Task 2 owner runbook, with offered and installed commit/tag identity, v2/v4 reader compatibility, working recovery and unchanged user state (or an explicit recorded owner waiver); and (3) **U3** — disposition of open defects 7 (same-version `JUST_UPGRADED`) and 9 (duplicate `~/.local/bin` tip) and owner confirmation before O1 counts in `docs/PROGRESS.md`.
_touches: docs/acceptance/install-upgrade.md_
_blocked-by: Track 70A, Track 28A, wi-b9f147, wi-2633cf_
**Status (2026-11-26):** Not done; gaps U1–U3 stay open (unchanged since PR #303, `5da0ec8`). PR #303 (`5da0ec8`, merged 2026-11-23, docs-only, no release) created `docs/acceptance/install-upgrade.md` covering isolated scratch-HOME fresh install and onboarding (`v0.111.0`, `54fd6df`), the live `v0.112.2` (`39c2b0c`, PR #300) Bun prerequisite re-check, one-release upgrade preservation (`v0.110.1` → `v0.111.0`), per-file recovery and rollback/resume. On the developer's "SHIP WITH GAPS OPEN" decision (PR #303, touchpoint `1777c7d5`, bound to `51813798`), U1, U2 (Task 2 published legacy upgrade — open failure) and U3 (owner confirmation of O1) were deferred as PR #303 readiness gates and remain open acceptance obligations here.
**Scheduling:** Placed in the final qualification wave (Group 106) under the developer's 2026-11-26 rule ("Anything purely for 1.0 spec reqs and no other benefit should be last"; "the tracks that are purely qualification for 1.0 are last"): this Track changes no code or workflow efficiency and exists solely for SPEC O1/O5.2 acceptance evidence. Its edge on Track 102B (`wi-b9f147`) is technical (both append to `docs/acceptance/install-upgrade.md`); its edge on Track 105A (`wi-2633cf`) carries both the 1.0-only priority order and the practical benefit of qualifying the final upstream-aligned, stable-channel install/upgrade UX once. Technical edges on Tracks 70A (`v0.72.0`) and 28A (`v0.47.0.0`) are already satisfied. Candidate or `file://`-remote proof does not satisfy U2. Kept separate from 106B and 106C because their acceptance files are disjoint, so all three can run in parallel.
_read-first: docs/acceptance/install-upgrade.md, docs/installation.md, docs/acceptance/release-compatibility.md_
- **Close U1 authenticated onboarding and loaded-skill identity** -- Run a first skill invocation in authenticated Claude Code and Codex sessions after install/upgrade and record loaded revision parity and any open gaps. _~35 lines._ (S)
- **Close U2 published legacy four-part upgrade and U3 owner confirmation** -- Run the Task 2 owner runbook in `docs/acceptance/install-upgrade.md` against the default remote (or record an explicit owner waiver), disposition open defects 7 and 9, and capture owner O1 confirmation for PROGRESS. _~65 lines._ (M)

##### Track 106B: Record the owner's remaining real review runs and by-hand run-mode readbacks
_3 tasks . ~120 LOC . low risk_
_id: wi-8b4a30_
**Outcome:** The owner can see from dated records that a by-hand review with no caller lines still runs as before, that the attacker parts run with per-part models when an orchestrator delegates them, that tools-mode delegation works on an installed release, and that a stage run by hand in Codex, Muse, Grok Build or Antigravity reads back with the run mode the shared rule promises.
**Supports:** [SPEC](SPEC.md) O6 and P1, O6.1, O3.3 (the by-hand driver's evidence) and O4.4. The remainder of the earlier Track 80D (PR #256, `v0.94.2`), which left attacker-parts PM1 and PM2 and tools-mode PM1 pending; the open acceptance of Track 72B (PR #221) and the post-release PM1 of the owner-approved tools-mode plan (PR #229); and the post-merge by-hand readbacks left pending by Track 90B (PR #283; Cursor discharged on 2026-11-21), Track 94J (PR #305, `v0.115.0`, qualifying Grok Build as `user-directed`/`terminal-session`) and Track 95B (PR #308, `v0.116.0`, qualifying Antigravity as `user-directed`/`terminal-session`).
**Done when:** (1) `docs/acceptance/attacker-parts.md` records PM1 (one real by-hand `/review-and-prep` with no `Review policy:` or `Review delegates:` line, read back as unchanged, with its invocation and receipt retained) and PM2 (one orchestrated run with `delegate=adversarial,red-team` mapping the two parts to different providers or models, with its `Delegated part:` lines, v3 attempts, `found_by` labels and any fallbacks), each with date, revision, host and harness versions and PR. (2) `docs/acceptance/delegate-tools-mode.md` records its PM1 installed paired run and names the exact reviewed content its earlier dry-run evidence covers. (3) Each pending non-Claude row in `docs/acceptance/hand-use-telemetry.md`'s "Pending post-merge by-hand readbacks" (Codex, Muse, Grok Build — updated from its pre-94J `harness-unqualified` expectation to `user-directed`/`terminal-session` per Track 94J — plus Antigravity per Track 95B; the Cursor row stays discharged with "Cursor support dropped 2026-11-21") is run by hand and read back through `gstack-extend-telemetry report --by-host` and the ledger's `agent`, `run_mode` and `run_mode_source`, or stays pending with the reason. (4) A failed, unavailable or wrongly read-back run stays recorded as open, never as passed, and a wrong read-back is filed as a defect.
_touches: docs/acceptance/attacker-parts.md, docs/acceptance/delegate-tools-mode.md, docs/acceptance/hand-use-telemetry.md_
_blocked-by: Track 94J, Track 95B, wi-2633cf_
**Scheduling:** Placed in the final qualification wave (Group 106) under the developer's 2026-11-26 rule ("the tracks that are purely qualification for 1.0 are last"): this Track changes no code or workflow efficiency and exists solely to close SPEC O6.1/O3.3/O4.4 acceptance records. Its edge on Track 105A (`wi-2633cf`) is a priority-ordering edge only (no shared files); its technical edges on Track 94J (`v0.115.0`, PR #305) and Track 95B (`v0.116.0`, PR #308, item `d574f7e2`) are already satisfied. It gates no other Track. PM2 already has partial observations (PRs #250 and #253 and a consumer repository's review) and waits only on harness CLI version provenance, which the run's operator can record from the harness at run time; tools-mode PM1 waits on the orchestrator's paired tools-mode run, requested on 2026-11-15. By-hand runs recorded here can also supply rows harvested by Track 106C (`wi-9d6cf2`), and keeping 106B separate from 106A and 106C lets all three disjoint acceptance Tracks run in parallel.
_Source: PR #256's receipt (2026-11-15: "attacker PM1/PM2 and paired tools-mode qualification remain pending"); `docs/acceptance/attacker-parts.md` and `docs/acceptance/delegate-tools-mode.md` (PM rows pending); PR #283's receipt ("post-merge hand-run readbacks PM1–PM4 in Codex, Muse, Grok and Cursor") and `docs/acceptance/hand-use-telemetry.md` (pending Codex, Muse and Grok rows; Cursor discharged 2026-11-21); PR #305's receipt ("Live by-hand readbacks are tracked in Track 94E"); and Track 95B (PR #308, item `d574f7e2`)._
_read-first: docs/delegated-review.md, docs/acceptance/hand-use-telemetry.md, docs/telemetry.md_
- **Attacker parts PM1 and PM2** -- Run and read back one by-hand review with no caller lines, and finish PM2's harness version provenance. _~50 lines._ (S)
- **Tools-mode PM1 and provenance** -- Record the installed paired run and name the content the dry-run record covers. _~40 lines._ (S)
- **By-hand run-mode readbacks** -- Run one stage by hand in each installed non-Claude harness (Codex, Muse, Grok Build, Antigravity) as its row describes and record the readback or the reason it stays pending. _~30 lines._ (S)

##### Track 106C: Qualify the workflow with two real drivers
_2 tasks . ~240 LOC . medium risk_
_id: wi-9d6cf2_
**Outcome:** The owner can carry real work through every stage both by hand and through a real external orchestrator, and the evidence shows what the documented contract actually supports.
**Supports:** [SPEC](SPEC.md) O3.3 and O4.5 (reshaped from the Paseo host Track by the owner, 2026-11-07: "72c ok").
**Done when:** A dated record names host, harness and versions for real runs by both drivers (the owner by hand, and one real external orchestrator), each run read back in telemetry with the correct run mode, covering, between them, a complete plan-to-authorized-release workflow, interrupted resume, manual-testing pause/resume, `/full-review` finish/restart, an explicit negative hold, an external-consumer handoff consumed from artifacts, a cross-session handoff and stale/partial/held handoffs; it counts operator interventions and keeps pending approvals or failures as holds; it includes the installed `/docs-ship` acceptance below; no unexercised combination is claimed.
_touches: docs/acceptance/workflow-drivers.md_
_blocked-by: Track 70A, Track 72C, Track 71E, Track 74A, Track 76A, Track 75A, Track 26A, Track 23I, Track 23A, Track 26B, Track 65A, Track 66A, Track 66B, Track 72A, Track 79A, Track 80B, Track 87A, Track 89A, Track 90A, Track 91A, Track 90B, Track 91B, Track 92A, Track 94J, Track 95B, wi-2633cf_
**Status (2026-11-26):** Not done; holds stay open (unchanged since PR #291, `bbcdd0a`). PR #291 (`bbcdd0a`, merged 2026-11-22, documentation only, no release) added `docs/acceptance/workflow-drivers.md` as a holds-first matrix of 23 rows (14 `WD-*` and 9 `DS-*`; 0 pass, 23 hold at `8077fa2`), the runbooks for both drivers and seven post-92A telemetry observations. Criteria 1–2 still need the owner's real by-hand runs and one real external orchestrator's runs, each read back in telemetry; no row passes without its own live evidence on `producer_version >= 0.109.0`, and pending approvals or failures stay holds.
**Scheduling:** Placed in the final qualification wave (Group 106) under the developer's 2026-11-26 rule ("the tracks that are purely qualification for 1.0 are last"): this Track changes no code or workflow efficiency and exists solely for SPEC O3.3/O4.5 acceptance evidence. Its edge on Track 105A (`wi-2633cf`) is a priority-ordering edge only (no shared files); all technical blockers through Track 95B (`v0.116.0`, PR #308) are already satisfied. **Report-only harvest available:** once installed, this Track's by-hand rows can be harvested from the developer's real by-hand runs across Claude, Codex, Muse, Grok Build and Antigravity as a report-only readback step, alongside orchestrated runs. The other developer-run record Tracks (106A, 106B) do not gate this one and run in parallel in Group 106; a run here can supply their rows, and this Track's real runs feed Track 107A (`wi-b1f0bd`). The external orchestrator may stop at a ready PR; a separate authorized run by hand proves landing. No consumer-repo edits, new spend, unattended release or acceptance-by-idle-status. The independently followed onboarding attempt moved to the public-release stage (Future).
- **Exercise both drivers** -- Run or harvest the matrix's rows (the record exists; this task fills it). Use real host-managed workspaces and approved accounts with the harnesses the owner uses for each stage; retain the bound PR and workspace, test stale/partial/held handoffs, confirm next-stage consumption from artifacts across sessions, include the host-attribution check deferred from Track 26A, and count operator interventions. _~200 documentation lines._ (L)
- **Include installed `/docs-ship` acceptance** -- Run a real docs-only PR through classification, a no-write classification hand-back, selected tests once, same-tree test-record reuse, final receipt hash, policy bump and `docs-ship/v1` without merging, and its interactive merge question; include one Sonnet-class run and one `/roadmap` handoff, and compare work/wait wall time with a recent docs PR shipped through the ordinary path. _~40 lines._ (S)

### Group 107: 1.0 qualification — measured stage cost and optimization decisions

_Depends on: Group 106_

**This group delivers:** Expected cost per stage with an adopt, reject or insufficient-evidence decision for every candidate optimization and the opted-in policy records' after fields filled, completing the final 1.0 SPEC O6 acceptance evidence.

##### Track 107A: Measure each stage's cost and decide each optimization
_4 tasks . ~500 LOC incl. tests . medium risk_
_id: wi-b1f0bd_
**Outcome:** The owner can reproduce an offline report of each stage's measured cost (model work, tool/CI/human waits, reuse and rework), read a documented expected cost per stage, and see an adopt, reject or insufficient-evidence decision for every candidate optimization.
**Supports:** [SPEC](SPEC.md) O6.1–O6.3 (owner, 2026-11-07: P1 joins the 1.0 outcomes with this finish line, and this Track gains the expected stage cost).
**Done when:** A reproducible offline report from sanitized projections separates DOCS/FULL/release-only paths, diff/task size, repo/host, run mode, skill version, waits and fresh versus resumed runs, and reports sample size and missingness; fixtures cover each split. A documented expected cost per stage (wall time and model usage, with sample size and unknowns) is published. Each efficiency-program candidate, including first-cycle overlap (69A), fold, delegation, the docs-only selection and the review run-state redesign (E15, whose adopt decision is Track 86A's record and whose post-default `insufficient-evidence` remeasurement and bounded next measurement are Track 94F's record in `docs/acceptance/review-run-state.md` §5), has measured evidence or a named evidence gap and an adopt, reject or insufficient-evidence decision with its follow-up mapped to existing Future items. The after fields that opted-in review-policy records still hold as unknown are filled from real opted-in runs where they exist, or named as evidence gaps: `docs/acceptance/review-fix-policy.md` for Tracks 33A, 51A and 75A (including whether an installed agent judged 75A's shown evidence and post-audit change classes as the skill asks) and the three after wall times in `docs/acceptance/external-gate.md`. No review gate, model choice or default changes through the study itself.
_touches: scripts/workflow-efficiency-report.py (new), tests/workflow-efficiency-report.test.ts (new), tests/fixtures/workflow-efficiency/ (new), tests/helpers/touchfiles.ts, docs/acceptance/workflow-efficiency.md (new), docs/acceptance/review-fix-policy.md, docs/acceptance/external-gate.md_
_blocked-by: Track 67A, Track 52A, Track 77A, Track 75A, Track 75B, Track 86A, Track 94F, wi-9d6cf2_
**Scheduling:** Placed last (Group 107) under both the developer's 2026-11-26 rule ("Anything purely for 1.0 spec reqs and no other benefit should be last") and its technical prerequisite on Track 106C (`wi-9d6cf2`): by design, this study changes no review gate, model choice or default itself — it delivers the SPEC O6.1–O6.3 offline cost report and formal adopt/reject/insufficient-evidence decisions from real runs supplied by Track 106C (and reads Tracks 86A and 94F instead of repeating them). Kept as one card above ~300 lines under the card-size rule's same-files exception (owner direction, 2026-10-26): the evaluation edits the same script, test and fixture files and reads the report the baseline builds. Its edge on Track 94F is satisfied (PR #299, `f6b4267`, docs-only: verdict `insufficient-evidence` with a bounded next measurement). Session weight 6.
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
waits on a blocker's siblings. In particular, Group 101 launches three disjoint
Tracks in parallel (`101A` merge-only refresh, `101B` one-task roadmap splits
and `101C` work-item ID migration); `102A` launches as soon as `101A` lands and
`102B` as soon as `101C` lands; `103A` and `104A` advance the review-efficiency
chain without waiting on `102B`; `105A` waits on `101B`, `102B` and `104A`
(plus the shared `skills/review-and-prep.md` chain); and the four purely-1.0
qualification Tracks run last in Groups 106–107. Document order is priority,
not a gate. The cards label priority choices separately from technical
prerequisites.

```
- Group 101 ← {}
- Group 102 ← {101}: Tracks 101A, 101C
- Group 103 ← {102}: Track 102A
- Group 104 ← {103}: Track 103A
- Group 105 ← {101, 102, 104}: Tracks 101B, 102B, 104A
- Group 106 ← {102, 105}: Tracks 102B, 105A
- Group 107 ← {106}: Track 106C
```

Track detail per group:
```
Group 101: Merge-only refresh after base move ∥ one-task roadmap splits ∥ work-item ID migration and Git-history retirement
  +-- Track 101A .......... ~M . 2 tasks   (first; docs-only base-move refresh + defensive context)
  +-- Track 101B .......... ~S . 1 task    (disjoint; qualitative one-task splitting in /roadmap)
  +-- Track 101C .......... ~M . 2 tasks   (disjoint; ID migration + Git-history retirement)
Group 102: Stable cross-cycle finding identity ∥ stable update channel
  +-- Track 102A .......... ~M . 2 tasks   (follows 101A; novel-tier trust boundary)
  +-- Track 102B .......... ~M . 5 tasks   (disjoint; follows 101C; stable channel + bootstrap auto-upgrade)
Group 103: Blocking-only fix cycles for delegated passes and Greptile
  +-- Track 103A .......... ~S . 2 tasks   (follows 102A; separate novel-tier trust-boundary PR)
Group 104: Verification block in /implement handoff
  +-- Track 104A .......... ~S . 2 tasks   (follows 103A; targets could-not-verify in review cycle 1)
Group 105: Install and upgrade aligned with upstream gstack
  +-- Track 105A .......... ~M . 3 tasks   (follows 101B, 102B, 104A; What's-new + upstream UX)
Group 106: 1.0 qualification — install/upgrade gaps ∥ remaining real review and run-mode records ∥ two-driver workflow qualification
  +-- Track 106A .......... ~M . 2 tasks   (1.0-only; U1–U3 open, follows 102B + 105A)
  +-- Track 106B .......... ~S . 3 tasks   (1.0-only; remaining review runs + by-hand readbacks)
  +-- Track 106C .......... ~L . 2 tasks   (1.0-only; holds open, two-driver matrix)
Group 107: 1.0 qualification — measured stage cost and optimization decisions
  +-- Track 107A .......... ~L . 4 tasks   (1.0-only; offline O6 cost study, follows 106C)
```

**7 Groups / 12 Tracks remaining**, 0 declared in progress.

Only owner-confirmed acceptance in PROGRESS can satisfy a stage/checkpoint.

## Future

Deferred: docs/roadmap-future.md (140 items)

## Shipped

History: docs/roadmap-shipped.md
