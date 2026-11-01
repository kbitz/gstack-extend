# Workflow efficiency program

## Role and constraints

Supporting scope and evidence for SPEC P1, selected by the owner on 2026-10-25
and extended the same day with E12–E14. SPEC owns product scope and release
policy; ROADMAP owns scheduling. This program
does not add a 1.0 gate. O1–O5, public-release 1.0.0, potentially-public users,
equal Paseo/Conductor priority and explicit merge authorization remain binding.

Wrap upstream gstack; do not edit or pin it. Record the source revision of copied
contracts. No new spend, direct model APIs or unattended merge. Consumer-owned
transport settings, ship policies and experiment runs are outside this repository.
Keep `Run /review-and-prep`, `Run /ship-and-land`, `review-and-prep/v1` and existing
receipts compatible. New policy values must be documented for callers, including
older producers' refusal/fallback behavior; unknown values never waive a gate.

## Selected work

| Item | Result and acceptance boundary |
|---|---|
| E1 / R3 | Record event timestamps at dispatch/return, with begin/end spans for completion, pregate, tests, coverage audit, documentation audit and Greptile work/waits. Trace fixture-shaped real-store rows to their writer and prevent test pollution. Preserve historical rows; do not erase real state to make a metric look clean. |
| E2 / R5 | `bin/upstream-check` checks every wrapper text anchor, every outside-review imported export and `autoplan-lean drift`, locally in under one second on a named profile. Print `OK`/`DRIFT <what>` lines and a documented exit status. Warn and report; do not hold, pin, upgrade or start a model. Cover the classifier's advisory findings plus `Verdict: not ready`. State the lease limitation. |
| E3 | Opt-in `full-suite=before-audit`: run the full suite once on the reviewed tree before the documentation audit. If the entire later delta consists only of that audit's documentation edits, run the pregate-selected lanes for that exact delta. Any other edit, including a later reviewer fix or unmatched release/config/code change, reruns the full suite. Preserve `full-suite=final` and existing defaults; carry the new value through preparation, continuations and shipping. |
| E4 / R4 | Limit documentation reads using changed paths and affected contracts, including linked authoritative docs that describe a contract without naming a source file. Re-audit only a fix's delta plus the necessary contract context. Preserve honest current/updated/blocked outcomes and the existing audit-attempt bound. |
| E5 / R2 | After E1 supplies timing and E13 supplies per-part finding quality, overlap cycle 1's specialists, independent native adversarial pass and outside pair on one immutable diff. Keep the two outside calls sequential for cache reuse. Red Team waits for merged specialist findings. Preserve host limits, all required coverage, result collection, deduplication, cap/stop and missing-voice holds. E12 sits beside this as an alternative. |
| E6 | Every successful `/implement` handoff includes `DEFERRED BY USER <n>, BLOCKED <n>`, including zeros. Keep the blocked-refusal rule. An implementer waiting on its own long test stays inside the active turn, follows that run to completion and does not emit a partial handoff. The wait must outlast the host's foreground command cap (10 minutes in Claude Code, against a full suite of 30 to 70); three observed incidents had an implementer start the suite in the background and end its turn waiting. |
| E7 / R7 | With a reviewed ship policy, `/ship-and-land` uses upstream `gstack-tree-receipt` for hunk-level stamp proof and per-lane reuse. Require its eligible result plus the existing evidence checks. A failed proof invalidates reuse; a missing policy retains the existing documented path. |
| E8 / R8 | With a usable pregate policy, `/docs-ship` obtains selected tests from nonexecuting `gstack-pregate --stage tests --explain`, bound to the verified base policy and exact delta. Define compatibility for existing markers and policy-less repositories without silently dropping tests. Explain the reported 211-minute run versus 34.5 minutes by separating work and waits, or record the precise missing evidence and instrument the next run. |
| E9 / R10 | `/autoplan-lean` emits `decisions.jsonl` and `findings.jsonl` beside its sidecar, validates them with upstream `gstack-artifact validate`, and retains auto/approval/user_challenge decisions, finding provenance and sealing/retry semantics. Existing handoff and sidecar consumers remain valid. |
| E10 / R11 | Design the pending review-evidence envelope as review facts plus a reference to upstream's portable evidence bundle. Evaluate upstream review-log fields and binding rules for a completed full-review baseline; do not infer that a completed delta or a nonconverged pass supplies it. This is design input, not authorization to build another envelope format. The producer-side record of cycle 1's completed baseline belongs to E14; E10 specifies and checks it. |
| E11 | Document the supported path from a capped STOPPED review: run its exact repair-only continuation when authorized, resolve the stop and reach prepared readiness, then `/ship-and-land`. Preserve continuation count, PR identity, `Full-review evidence: unavailable` and all remaining holds. A ship invocation cannot clear a stop. Owner decision, 2026-10-25: `/ship-and-land` keeps refusing a stopped draft, including one whose receipt records `Unresolved: none recorded`; once E14 exists, a capped pull request's path is its repair-only continuation. |
| E12 | Opt-in fold mode. A `/review-and-prep` cycle-1 mode, a `Review policy:` value or a flag, runs cycle 1 without dispatching the specialist subagents; the main review pass reads the selected specialists' checklists itself, as reference loaded on demand. Red Team when its gate fires, the native adversarial pass and the outside voices stay. Installed upstream triggers Red Team on a diff over 200 lines or on a specialist CRITICAL finding; with no specialist dispatches, restate that as the size arm or a CRITICAL finding from the folded pass. Gate the mode on byte-for-byte installed `/review` text, as `in-cap=delta` does, and edit no upstream file; if folding needs upstream text to change, record that and stop. Its anchors join `bin/upstream-check`'s inventory once the E2 checker has shipped. Today's default stays and the receipt records which arm ran. The `Review policy:` grammar is v1 with fixed keys, so document an older producer's fallback (an unknown key or value reads as `none supplied`). Upstream's adaptive gating statistics learn from specialist dispatches only, so a folded review adds no sample. The evidence is observed incidents, not repeated measurements: two first review invocations in which all seven specialists returned no findings (two specialists reported one finding each in a later repair pass of one of them), and one 249-minute review that spent 51 minutes in first-cycle specialists. The quality comparison is an external backtest the caller runs on retained reviews; this program authorizes no spend and no default change. |
| E13 | Per-finding attribution. Every logged review finding names the part that found it: a named specialist, Red Team, the native adversarial pass or an outside voice. A finding several parts reported keeps every part, and an unattributable one reads unknown with its reason. Upstream's specialist and Red Team findings already carry a name, but the wrapper's closed metrics finding record carries only a severity class, so a new schema version branch is needed and earlier rows stay readable. It supplies the per-part finding quality E5's activation evidence and E12's comparison need. Observed: in one review invocation the 16 logged findings carried no per-part attribution. |
| E14 | Review-cap repair. (a) When `/review-and-prep`'s final full test run fails and the repair changes no source file (tests or docs only), the skill repairs it, reruns the failed tests and then the full gate once, and continues to readiness; that repair does not count against `/review`'s three-cycle cap and needs no further review cycle. A repair that changes a source file keeps today's rule. Because a test-only repair can make a real failure pass by weakening a test, the repair diff gets at least a native adversarial pass, and the receipt records the repair, its rerun and that no full review cycle covered it. (b) Cycle 1 records its completed full-review baseline in the form the repair-only continuation guard reads; today the guard refuses with no completed original full-review record, so `continuation=repair-only` cannot run after a cap. Include a regression where a cap after a completed cycle 1 continues. Anything that changes a default for other users needs the evidence a public change needs; otherwise it sits behind the `Review policy:` line callers already send. Observed: four capped reviews, each followed by a manual ship and hours of extra suite runs; in one, the final full run (about 2,500 tests, about 75 minutes) failed once on a test-only defect and its repair became the third repair batch. |

## Delivery priority

Owner-selected order, 2026-10-25: favor usage efficiency and speed, with
telemetry immediately after test savings. Rank work by recurring avoidable
work, evidence strength, implementation cost and prerequisite value. Do not
invent numeric savings or treat deterministic packing as benefit ranking.

Owner priority, 2026-10-25 (later that day): E14, the review-cap repair, is the
next work after the E2 drift check and ahead of E1, by an explicit scheduling
edge. That edge is a priority choice, not a technical prerequisite of E1.

1. **Enable trustworthy optimization:** E1 timing/isolation and E2 upstream
   drift checks provide prerequisite evidence and regression protection.
2. **Remove repeated test work:** E3 full-suite-before-audit and the broad
   skill-test split. Preserve required coverage and current defaults unless
   explicitly opted in; measure both time and retained coverage.
3. **Complete telemetry:** paused/blocked/resumed segments, then requested-model
   provenance, then parent/child usage attribution. Their existing dependencies
   require sequential batches. This puts attributable usage evidence ahead of
   the remaining audit and review optimizations, as selected by the owner.
4. **Reduce audit work and handoff stalls:** E4 bounded documentation reads,
   with E6's count/wait repair alongside it. Measure read/token volume and
   retained finding quality; fewer reads alone do not establish improvement.
5. **Shorten or lighten the main review cycle:** E13 per-finding attribution
   first, because E5's activation evidence needs per-part finding quality, then
   E5 independent first-cycle overlap after trustworthy timing and upstream
   independence checks. E5 primarily targets wall time rather than fewer model
   tokens. E12 sits beside E5 as an alternative; E1's timings decide their order,
   and if folding wins, overlapping the specialists matters less. The ROADMAP
   packer's order between them is a placeholder, not that decision.
6. **Optimize the remaining paths:** E8 docs-only selection/investigation and
   E7 mechanical release-only reuse, then E9 machine planning artifacts.
7. **Complete supporting contracts and acceptance:** E10/E11 evidence/recovery
   documentation, the stable catalog, both-host acceptance and the final
   cross-run efficiency assessment. Retain every existing obligation.

The final assessment does not delay the per-change measurements required
before activating E4/E5. The runner and tier experiments stay deferred until
their quality evidence exists; potential savings alone do not authorize less
review coverage or spend.

ROADMAP labels priority choices separately from technical prerequisites,
then uses the unchanged packer to form safe batches. No footprint is narrowed
or obligation removed to force an earlier batch. Revisit the order when
trustworthy measurements show another dominant cost or a supported workflow
has a blocking defect.

## Measurement and activation

E1 precedes claims of savings for E3–E5. E4 and E5 each retain a before/after
record: repo/host/harness and installed revisions, input tree and scope, sample
size, phase work/wait wall time, parent/child token classes when available,
unavailable sources, accepted/missed findings and added orchestration overhead.
For E4 also record docs inventoried/read, bytes and current/updated/blocked
outcomes. For E5 record dispatch/return overlap and host-cap waits. E12 never
changes today's default; any comparison it reports here uses E5's record fields
plus accepted findings per part from E13. An estimate is not a measured saving;
account-wide quota movement is not attributable usage.

Do not invent a universal numeric stage deadline from the current observations.
Use named workflow bounds and report their values and unknown intervals. If
benefit or quality is unproved, retain the old default and use an explicit option
for the experiment. P1 does not permit silently skipping an audit or reviewer.
The existing usage-attribution and efficiency-report commitments remain owners of
cross-run analysis; use their projections instead of creating another parser.

## Verified planning snapshot (2026-10-25)

Repository HEAD and fetched main: `36546193f1957bd4c58e563ad09f607b3b154e35`,
release `0.47.0.0`; installed extend `0.46.0.0`; installed upstream `1.91.208.0`.
Recheck these inputs during implementation; upstream may advance during a run.

- `skills/review-and-prep.md` still gates in-cap delta on three literal anchors
  in upstream review. Missing anchors record inactive and run unmodified review.
  The current optional policy accepts only `full-suite=final`; its main-suite
  preparation run may be selected and its final full run belongs to shipping.
  E3 therefore needs a cross-stage contract, not only a documentation-audit edit.
- The eight native/outside criteria comparisons in `autoplan-lean drift` match
  installed upstream. This checks known paragraphs, not newly added requirements.
- `tests/outside-review.test.ts`'s installed-upstream fake-process conformance
  case passed (1 test, 40 assertions, no paid calls). It predates the explicit
  advisory/not-ready golden case. Upstream `classifyOutsideReview` treats the
  last explicit not-ready verdict as findings even with advisory severities.
- Real local metrics contain 107 rows with the reported fixture-shaped UUID
  prefix. The current metrics suite uses isolated HOME fixtures and strips
  inherited state overrides. The responsible writer is unproven: the identifier
  shape alone does not prove that this test suite wrote those rows.
- `gstack-skill-start` touches an install lease; `gstack-lease` treats an
  unrefreshed lease as stale at 120 minutes. A one-time start does not protect a
  3–4 hour stage throughout. No mid-stage upgrade incident was observed here.
- Upstream documentation discovery inventories broadly and reads relevant docs
  in full. The review's Red Team consumes merged specialist findings; the other
  E5 inputs must be rechecked for independence at implementation time.
- `src/docs-ship/pinning.ts` uses path/name scans and explicit markers; upstream
  pregate has the policy-based selection surface. `/review` has no `--fix-range`
  integration in this snapshot; `/ship` does.
- `gstack-tree-receipt` reports gate reuse per policy and returns distinct
  not-eligible and unreadable-policy failures. The portable bundle separates
  verified from imported lanes. `reviewFreshness` rejects fix-range scope and
  nonconverged rows and requires matching verified start/end bindings. The bare
  tuple commit/tree/scope/completed/converged/cycles is insufficient by itself.
- `/ship-and-land` already sends a stopped review back to its continuation.
  E11 documents that workflow; it does not weaken the existing check.
- Rechecked later on 2026-10-25 against installed upstream `1.91.216.0` (the
  originating notes cited `1.91.208.0`). The three `in-cap=delta` anchors still
  match. Upstream review triggers Red Team on a diff over 200 lines or any
  specialist CRITICAL finding, and passes it the merged specialist findings. Its
  specialist controls are scope gates, a small-diff skip, `--<specialist>` and
  `--all-specialists` force flags and adaptive gating from specialist hit-rate
  statistics, which only conditional specialists are subject to. None of them
  turns specialist dispatch off, and there is no per-specialist model or effort
  control; E12 must show that a wrapper-side substitution of the dispatch step
  is enough or record that upstream text would have to change.
- The `Review policy:` grammar is `review-and-prep-policy/v1` with fixed keys; an
  unknown key or value reads as `none supplied`. The wrapper's metrics finding
  record is closed to unknown keys and has a severity class but no named part.
  `skills/review-and-prep.md` refuses a repair-only continuation when no
  completed original full-review record exists, and its cycle stop forbids a
  fourth pass.

The originating private research reported a 249-minute review with 89 minutes
in tests and 32 in audits, batch-written pass timestamps, and two docs-only runs
of 34.5 and 211 minutes. These are source observations with attribution limits,
not measurements repeated by this planning run. No saving has been established.

## A planning skill that works alone

`/plan-card` turns one approved card into a plan in a single session with no
subagents, outside voices or other model or agent CLI. It drops the review
pipeline instead of trimming it, so it is an addition beside `/autoplan-lean`,
which keeps its pipeline, its description and its routing. `/autoplan-lean`
stays the default, and no default changes.

The reason is recorded here because a Track card does not outlast its merge. The
originating private review reported two blind judgments of the two approaches,
30 vs 31 and 31 vs 32 of 50 overall, with risk handling scored 5 vs 6 and 5 vs 7.
Risk handling is what a skipped review would miss. These are source observations
with attribution limits, not measurements repeated here, and the source does not
say outright which approach each overall score belongs to. Retiring
`/autoplan-lean` would be a separate owner decision that waits for data.

## Deferred experiments

The unattended autoplan runner waits for a blind comparison on real cards with
quality and resource measures. Tier-scaled review depth waits for that result.
Upstream `--fix-range` adoption waits for support in `/review` itself. These
triggers live in Future; the experiments and caller model-setting changes are
consumer-owned and receive no spend authorization from this program.
