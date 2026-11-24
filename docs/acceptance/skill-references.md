# Skill references acceptance record (Track 94I)

Records Task 1 harness measurements, the duplication check, the reader map,
preregistered behavior probes, base-versus-candidate probe results, and
per-harness load checks for slimming gstack-extend skills with zero loss of
function.

## Task 1: Harness measurements and budgets

Measured on `mmm/c69c8c30` at base `6293d8c3d27cb8ef25cce6ba52b60e14adad4011`
(2026-11-23).

| Harness | Installed version | Hard `SKILL.md` size limit | Per-call command output cap / truncation shape | Reference serving mechanism |
|---|---|---|---|---|
| Claude Code | 2.1.330 | No hard rejection observed for the 366,223-byte base | Five markers visible in one 28,990-byte synthetic result | Existing preamble allow rule |
| Codex | 0.171.0 | No hard rejection observed for the base | Five markers visible in an initial 28,990-byte result. A replay at that size elided two markers. | Rendered copy and shared preamble |
| Muse Code | 1.4.25 (1.4.25-R9361.1) | 262,144 bytes. The skill validator accepts this size and rejects 262,145 bytes. | Five markers visible in one 28,990-byte synthetic result | Codex-format copy and shared preamble |
| Grok | 1.0.92 (b06756fd6256), alpha | No hard rejection measured | Five markers at 18,000 bytes and 340 lines. Middle marker omitted at 22,000 and 24,100 bytes with the same line count. | Numbered preamble output with range retry |

The output tests sent synthetic numbered text and asked for markers from a
single shell call. These observations bound the tested output shape. The
reference reader still checks contiguity and retries a truncated read in ranges.

### Reference and core caps

- **Core cap.** `196,608` bytes (75% of Muse Code's 262,144-byte limit).
- **Per-reference caps.** `16,384` file bytes, `340` lines, and at most
  `2,000` characters per line. The numbered response and trailer must fit
  `17,000` bytes, with a 1,000-byte margin below the measured Grok result.
  The final 29 references top out at 15,513 file bytes,
  231 lines and 16,540 output bytes.
- **Budgets:** enforced in `tests/helpers/skill-budgets.ts` and `tests/skill-references.test.ts` for all 11 skills in `setup`'s `SKILLS` list.
- **Root-read proof:** `setup` is unchanged; references live at `skills/references/<skill>/<prefix>-<topic>.md` under the gstack-extend checkout and are served through `~/.gstack-extend/bin/preamble <skill> --ref <file> --expect <digest>`, which resolves the same verified checkout root as the start command and binds the loaded core to the checkout via a 16-hex SHA-256 content digest.

### Duplication check (Criteria 1 & 2, User Challenge uc1)

- Within `skills/review-and-prep.md` at `6293d8c`: `1,327` repeated bytes in lines ≥ 60 bytes (no repeated multi-paragraph passages serving the same function).
- Across all 11 `skills/*.md` outside `<!-- SHARED:... -->` blocks: ~24 KB, consisting of the protocol-locked start-command recovery paragraph and short shared lines. Under settled decision `uc1a`, cross-skill deduplication is not performed in this Track; single ownership per reference is preserved.

## Reader map for `skills/review-and-prep.md` (PR A)

The initial reader map was committed before the first move. The revision below records the paths split during review.

| Section | Reader class | Disposition | Target reference | Notes |
|---|---|---|---|---|
| `## Preamble (run first)` + `### Inline upgrade flow` | Primary (every run) | Core-only | — | Contains `SHARED:upgrade-flow`, root rules, and new `### Reference files and mid-run upgrades` |
| `### Workflow metrics (optional, local)` | Primary (conditional: metrics capture) | Split | `conditional-workflow-metrics.md` | Legacy boundary, `GX_CAPTURE=0` degraded fallback, and overview/Draft-once/Greptile-once/Manual-testing rules stay in core |
| `## Boundaries` (incl. 3 subsections) | Primary (every run) | Core-only | — | Stop rules, fix-scope auto-choice, provider-failure stop, subagent wait bounds |
| `## 1. Establish the branch, PR, and review inputs` + `### Evidence directory` + `### Establish the approved implementation scope` + `### Read an optional review policy` + `### Use the light review default` | Primary (every run) | Core-only | — | Holds all 25 capability-check literals, no-root/helper-missing fallbacks, and `#use-the-light-review-default` anchor |
| `### Detect whether marking ready would start a second run` | Primary (conditional: Greptile applies) | Split | `conditional-greptile-recovery.md` | Gate trigger + source-branch rule stay in core |
| `### Merge the latest base before review` | Primary (every run) | Core-only | — | Mandatory Step 2 entry |
| `### Bound Claude Code outside calls` | Delegate / Claude Code conditional | Split | `delegate-specialist-parts.md` | Wrapper-override gate stays in core |
| `### Scope a re-review to its delta` | Primary (re-review) | Core-only | — | Holds machine-read `in-cap=delta` paragraph (`src/upstream-check/cli.ts`) |
| `### Delegate named specialist parts` | Delegate (conditional: `delegate=<part>`) | Split | `delegate-specialist-parts.md` | Holds machine-read `Activation (delegate)` and `Activation (attacker parts)` paragraphs in core |
| `### Run a red team where /review has none` | Delegate (conditional: `red-team=ensure`) | Split | `delegate-red-team-and-fold.md` | Activation + Gate stay in core |
| `### Fold specialist checklists into cycle 1` | Delegate (conditional: `specialists=fold`) | Split | `delegate-red-team-and-fold.md` | Machine-read `Activation (specialists=fold)` stays in core |
| `### Overlap independent first-cycle reviewers` | Delegate (conditional: `first-cycle=overlap`) | Split | `delegate-red-team-and-fold.md` | Machine-read `Activation (first-cycle=overlap)` stays in core |
| `### Reopen review only for behavior-changing repairs` | Primary (conditional: `repair-review=behavior-changing`) | Split | `conditional-repair-and-gaps.md` | Machine-read `Activation (repair-review=behavior-changing)` + `repair-review: active` gate stay in core |
| `### Record unproven test gaps` | Primary (conditional: `test-gaps=record`) | Split | `conditional-repair-and-gaps.md` | Machine-read `Activation (test-gaps=record)` + `test-gaps: active` gate stay in core |
| `### Give review parts the settled decisions` | Primary (every run) | Core-only | — | Every review part receives settled decisions |
| `### Block readiness only on shown findings` | Primary (conditional: `blocking=shown`) | Split | `conditional-repair-and-gaps.md` | `Activation (blocking=shown)` gate stays in core |
| `### Record cycle 1's full-review baseline` | Primary (conditional: full-scope cycle 1) | Split | `conditional-cycle-baseline.md` | Inbound `#record-cycle-1s-full-review-baseline` heading + overview stay in core |
| `### When /review stops at its cycle cap` | Primary (conditional: 3-cycle cap) | Split | `conditional-cycle-cap.md` | Inbound `#when-review-stops-at-its-cycle-cap` heading + entry gate stay in core |
| `### Verify agent-checkable items before any pause` + `### Enforce completion, beyond /review's informational audit` + `### Prove /ship's release gates on this head` + `### Capture evidence and commit` | Primary (every run) | Core-only | — | Always-run verification and commit gates |
| `### Classify changes after the documentation audit's last attempt` | Primary (conditional: `post-audit=classify`) | Split (2 refs) | `conditional-post-audit-classification.md`, `conditional-post-audit-reaudit.md` | Inbound `#classify-changes-after-the-documentation-audits-last-attempt` heading + `When it applies` gate stay in core |
| `### Bound the documentation audit` | Primary (conditional: `documentation-scope=contracts`) | Split | `conditional-doc-audit-and-gates.md` | Activation gate stays in core |
| `### Pause for an external full-suite gate` | Primary (conditional: `full-suite=external`) | Split | `conditional-doc-audit-and-gates.md` | Gate slot + policy guard stay in core |
| `### Narrow the pregate after an accepted pass` | Primary (conditional: `full-suite=external`) | Split | `conditional-pregate-and-final-repair.md` | Capability-literal heading + machine-read `Activation (narrowed pregate)` stay in core |
| `### Repair a test-only final-gate failure` | Primary (conditional: `final-gate-repair=tests-docs`) | Split | `conditional-pregate-and-final-repair.md` | `Today's rule` + `When it applies` gate stay in core |
| `## 3. Push and create or update the draft` | Primary (every run) | Core-only | — | Draft-once push procedure |
| `### Manual testing checkpoint and resume` | Resume entry point | Split | `resume-manual-testing.md` | Pause gate, `PAUSE_MARKERS`, and `--outcome blocked` stay in core; resume reconciliation moves |
| `## 4. Trigger once and await Greptile` | Primary (every run) | Core-only | — | Greptile-once trigger and polling |
| `### Greptile exits that need a user decision` + `### Configuration repair` | Primary (conditional: Greptile exit/conflict) | Split | `conditional-greptile-recovery.md` | Stop/pause gate + `--outcome blocked` rule stay in core |
| `## 5. Triage, fix, and verify locally` + `## 6. Final readiness gate and handoff` + `## 7. Emit the copyable prompt for a new session` + `### Telemetry finish` | Primary (every run) | Core-only | — | Readiness gates, receipt/handoff contract, and `SHARED:telemetry-finish` |

### Reader-map revision after cycle 1

The first draft moved parts of the stop and degraded-install procedures with
their reference text. Before regenerating the core, the review mapped the
affected paths again. The core keeps the trigger and outcome. The named
references carry the procedure used after that decision.

| Entry | Core decision | Reference reader |
|---|---|---|
| Step 1 resume | A recorded pause, stop or ready state keeps its restriction until corroborated. External-gate checkpoints are checked before review. | Primary, only when reusing an earlier run or checkpoint |
| Policy parsing | Invocation provenance, parsed policy and option precedence stay inline. | Primary, when a valid line opts into a conditional procedure |
| CLI and baseline startup | Missing helpers use their existing degraded path. A present baseline fence must retain its write-point evidence. | Primary, during baseline collection, then a separate read for a later-cycle recovery |
| Cycle stop and continuation | Keep the draft unready. A continuation needs the live stopped record, policy, allowance and verified claim. | Primary, when publishing a new cycle-stop receipt |
| Manual testing | Pending user checks pause the draft. A failed comment post preserves the hold. | Primary, only for the pause receipt or a manual-testing resume |
| External suite | A clean, committed tree, passing preflight and persisted checkpoint precede the final pause line. Only a valid, current attestation can advance the gate. | Primary, when freezing, resuming or applying the result |
| Docs and coverage | Required audits still run. Reuse and recorded gaps apply only under their established gates. | Primary, when a bounded documentation audit, audit reuse or recorded-gap policy applies |
| Greptile | The core keeps duplicate prevention, evidence requirements and the decision to hold or advance. | Primary, only where Step 1 applies Greptile |
| Delta and fix choices | Re-review needs a valid delta and every auto-choice or veto keeps its original effect. | Primary, when a delta or auto-choice is actually used |
| Metrics and outside voices | The no-capture metrics receipt stays inline. An unavailable outside adapter is missing coverage. | Separate primary reads for span mechanics, finding attribution, and the selected Claude Code adapter |

### Current read points

The final map below names the reference stems used at each core heading.
Conditional readers enter only at the stated policy or workflow gate.
Delegate-prefixed files serve the parts selected at dispatch. Resume-prefixed
files serve only resumed or repeat invocations. The core retains the manual
hold and persists the cycle-cap hold before reading its continuation procedure.

| Core heading | Reference stems |
|---|---|
| Workflow metrics (optional, local) | `conditional-workflow-metrics`, `conditional-metrics-findings` |
| Detect whether marking ready would start a second run | `conditional-greptile-recovery` |
| Bound Claude Code outside calls | `conditional-outside-review`, `conditional-outside-recovery` |
| Delegate named specialist parts | `delegate-specialist-parts` |
| Run a red team where /review has none | `delegate-red-team-and-fold` |
| Fold specialist checklists into cycle 1 | `delegate-red-team-and-fold` |
| Overlap independent first-cycle reviewers | `delegate-red-team-and-fold` |
| Reopen review only for behavior-changing repairs | `conditional-behavior-repairs` |
| Record unproven test gaps | `conditional-repair-and-gaps` |
| Block readiness only on shown findings | `conditional-repair-and-gaps` |
| Record cycle 1's full-review baseline | `conditional-cycle-baseline`, `conditional-cycle-followup` |
| When /review stops at its cycle cap | `conditional-cycle-cap` |
| Classify changes after the documentation audit's last attempt | `conditional-post-audit-classification`, `conditional-post-audit-reuse`, `conditional-post-audit-reaudit` |
| Bound the documentation audit | `conditional-doc-audit-and-gates` |
| Pause for an external full-suite gate | `conditional-doc-audit-and-gates`, `conditional-external-resume` |
| Narrow the pregate after an accepted pass | `conditional-pregate-and-final-repair` |
| Repair a test-only final-gate failure | `conditional-pregate-and-final-repair` |
| Manual testing checkpoint and resume | `resume-manual-testing` |
| Greptile exits that need a user decision | `conditional-greptile-recovery` |
| Configuration repair | `conditional-greptile-recovery` |
| 4. Trigger once and await Greptile | `conditional-greptile-run` |
| 5. Triage, fix, and verify locally | `conditional-greptile-run` |
| Scope a re-review to its delta | `conditional-delta-selection` |
| Read an optional review policy | `conditional-policy-values` |
| Readiness | `conditional-receipt-policy-rows` |
| 1. Establish the branch, PR, and review inputs | `resume-review-records` |
| Prove /ship's release gates on this head | `conditional-coverage-gap-audit`, `conditional-doc-gate-reuse` |
| Take recommended fix-scope options without asking | `conditional-auto-choice-receipts` |
| Hosts with bounded subagent waits | `conditional-bounded-reviewer-waits` |
| Verify agent-checkable items before any pause | `conditional-agent-qa` |

## Preregistered behavior probes (PR A)

Each probe runs in a scratch repository with no remote, given only scenario
inputs and a printed `EXTEND_ROOT:` transcript, stopping at a named gate. The
grading key below is never shown to the probed agent.

| Probe ID | Scenario | Expected reference (grading key) | Expected gate outcome (grading key) |
|---|---|---|---|
| P1 | Default by-hand run on a clean feature branch (no optional `Review policy:`) stopping before `/review` | None required | Proceeds to Step 2 with default policy, no reference stop |
| P2 | Invoked with `Review policy: full-suite=external` stopping at the external full-suite gate | `conditional-doc-audit-and-gates` | Freezes commit, runs preflight, emits `External gate: external-gate/v1;` pause line |
| P3 | Invoked with `Review policy: final-gate-repair=tests-docs` after a test-only final-gate failure | `conditional-pregate-and-final-repair` | Enters bounded test-only repair loop (snapshot B, classify, diagnose) |
| P4 | Invoked with `Review policy: post-audit=classify` after a post-audit change | `conditional-post-audit-classification` | Computes delta and classifies post-audit change against closed list |
| P5 | Invoked with `Review policy: blocking=shown` with an unshown finding | `conditional-repair-and-gaps` | Probes before writing `Finding not blocking:` and does not block readiness on unshown non-safety finding |
| P6 | Invoked at a verified three-cycle cap stop | `conditional-cycle-cap` | Stops with `Full-review evidence:` line and continuation handoff |
| P7 | Resumed session (`/review-and-prep resume`) after manual testing pause | `resume-manual-testing` | Re-fetches `resume-manual-testing` on step entry and reconciles item-level results |
| P8 | Missing reference (`preamble --ref` returns `SKILL_REFERENCE_MISSING` exit 1) | `conditional-doc-audit-and-gates` (absent) | Relays `SKILL_REFERENCE_MISSING`, stops with blocked stage line, runs telemetry finish `--outcome error`, never continues from memory |

## Before / after sizes (PR A)

The original core is from `6293d8c`. The review incorporated base `39c2b0c`
without changes to that original core. Sizes use the final candidate
reference set in this update.

| Skill | Before core (B) | After core (B) | Core budget (B) | Total references (B, files) | Default by-hand path (B) | Orchestrated path (B) |
|---|---:|---:|---:|---:|---:|---:|
| `review-and-prep` | 366,223 | 168,484 | 184,320 | 225,197 (29) | 196,546 | 222,856 |

The by-hand budget counts unique bytes for a successful first cycle on Codex
with metrics active, the selected Claude Code outside pass, no findings to
handle and no Greptile.
It includes the workflow metrics, outside adapter and cycle-baseline references.
An outside reply that needs the recovery or annotation procedure adds 1,629 bytes.
The span guide is read once per initialized segment. A later resume or
compaction can require another read. The first finding-attribution path adds
2,627 bytes. A fix-scope auto-choice adds another 1,602 bytes when taken.
The orchestrated row adds policy values and the external-gate procedure.
These are path budgets from the reader map. Per-run usage and the complete
by-hand read sequence remain to be measured.

The Codex rendering is 168,332 bytes, 93,812 bytes below the verified Muse
limit. `bun scripts/skill-references.ts check --base 39c2b0c --skill review-and-prep`
returned `ok=true blocks=42 dropped=0 base=366223B core=168484B`.

### Navigation edits in moved text

The move manifest declares and checks these replacements. They direct readers
to the named core step after the move.

| Reference | Original direction | Destination |
|---|---|---|
| Workflow metrics | Literal status line below | Core metrics status line |
| Greptile recovery | Resume rule above | Establish the branch, PR, and review inputs |
| Outside review and cycle baseline | Delta procedure above or below | Scope a re-review to its delta |
| Cycle cap | Next-cycle late write above | Record cycle 1's full-review baseline |
| Delta selection | Full-review baseline below | Record cycle 1's full-review baseline |
| Optional policy values | Phase-status warning and bounded-wait rules above | Read an optional review policy and Hosts with bounded subagent waits |
| Optional policy values | Inline capability commands | Published capability commands in the core. The reference keeps the exit meanings beside their policy values. |
| Documentation-gate reuse | Verified-base cap check below | Classify changes after the documentation audit's last attempt |
| Bounded reviewer waits | Provider-failure rule above | Report elapsed time and stop on provider failures |

The review split repair-only classification from test gaps and shown findings.
It also separated ordinary post-audit classification from the additional
reuse and re-audit rules gated by `doc-audit-gap=auto`.

## Pre-merge scratch load and reference checks

The fixture placed five hidden markers across each scratch skill. It used an
isolated installation for root resolution and left the installed copies alone.

| Exercised combination | Harness version | Result |
|---|---|---|
| Claude-format scratch skill | Claude Code 2.1.330 | 5/5 load markers |
| Codex-format scratch skill | Codex 0.171.0 | 5/5 load markers |
| Codex-format scratch skill | Muse Code 1.4.25 | 5/5 load markers on the preceding scratch copy. The validator accepted the 168,332-byte package. |
| Scratch skill package | Grok 1.0.92 alpha | 5/5 markers from a paged read. `grok inspect` listed that identical marker package and the current core as invocable skills in disposable homes. Workspace discovery was unavailable in the untrusted scratch project. |

Claude Code, Codex and Muse fetched the commanded reference and saw its digest
trailer in the applicable gate probes. The disposable-home install tests also
verify each installed pointer on Claude Code and Codex. The Grok file read
measures complete visibility in a scratch session.

## Base-versus-candidate behavior probe results (PR A)

The fixtures provide synthetic state at each gate. The agents ran the real
reference fetch in the scratch checkout. The remaining Git, telemetry, suite
and service operations were described as a dry run. After the output cap split,
P4 and P5 were repeated with the final reference digests.

| Probe | Claude Code 2.1.330 and Codex 0.171.0 | Muse Code 1.4.25 |
|---|---|---|
| P1 | Both versions proceeded to Step 2 without a reference at this entry. | Outside the preregistered subset |
| P2 | Both versions paused for the external suite. The candidate fetched the checkpoint reference. | Outside the preregistered subset |
| P3 | Both versions entered test-only repair on the scoped failure. The candidate fetched the final-repair reference. | Outside the preregistered subset |
| P4 | Both versions carried the accepted audit for the tests-only change. The candidate fetched classification without the reuse opt-in. | Same outcome and classification fetch |
| P5 | Both versions recorded the unshown finding as non-blocking. The candidate fetched the shown-finding rules. | Outside the preregistered subset |
| P6 | Both versions reached the cycle-cap stop with full-review evidence and the repair-only continuation. The candidate fetched the stop procedure. | Outside the preregistered subset |
| P7 | Both versions carried the first passing check and kept the second pending. The candidate fetched resume reconciliation. | Outside the preregistered subset |
| P8 | The base used inline checkpoint instructions. The candidate relayed the missing-file error, preserved the hold and emitted the blocked stage trailer after the stage-token repair. | Same outcome with the coded error and blocked trailer |

Claude Code and Codex also exercised two omitted-line cases while keeping the
digest trailer intact. Both fetched bounded ranges and reached the checkpoint
when the missing line was available on retry. Both reported
`SKILL_REFERENCE_INCOMPLETE` and emitted the blocked stage trailer when the
same line was missing from every read. A separate cycle-cap probe withheld
the stop procedure. Both harnesses relayed the missing-reference error, kept
the stopped marker in the dry-run disposition and emitted a blocked trailer
without a continuation prompt.

### Optional metrics reference failure

On Codex, the original core reached Step 2 and the stopped candidate at
`21cf38e` blocked when the metrics reference was missing. After the repair,
Claude Code ran the same fixture on the original and repaired cores. Both
proceeded to Step 2. The repaired core relayed `SKILL_REFERENCE_MISSING`
and recorded `capture=partial (reference-unavailable)`. The P8 missing-file
and persistent line-elision replays still blocked on the required reference.

### Review-order repairs

Claude Code compared the base, the first continuation candidate and the repaired
core at three additional dry-run boundaries. The repaired core captured and
hashed documentation roots and the initial snapshot before dispatch, used the
verified base policy for documentation caps, retried an ordinary missing
cycle-one baseline from the same collection before fixes, and sent
`Generation: audit-only` on the initial recorded-gap coverage pass. The
first continuation candidate found the documentation and coverage instructions
by following later sections. Its baseline replay treated an ordinary missing
record as an I/O failure. The repaired core directs each action at its entry
point.

On the repaired core, a repeated middle-line elision probe fetched the
missing line and reached the external checkpoint. With persistent elision it
still blocked. With the cycle-cap reference absent, a successful simulated
stop-comment post preserved the hold and took the reference-failure telemetry
exit. The optional metrics probe again reached Step 2.

## PR B: `/roadmap`, `/ship-and-land`, and `/pair-review`

Measured on `mmm/f0a413c8` against base `ce16f48524d6d41ab812157125aa0f5971fc32db`
(2026-11-23).

### Duplication check (PR B)

- Within `skills/roadmap.md` at `ce16f48`: `818` repeated bytes in lines ≥ 60 bytes (no repeated multi-paragraph passages serving the same function).
- Within `skills/ship-and-land.md` at `ce16f48`: `0` repeated bytes in lines ≥ 60 bytes.
- Within `skills/pair-review.md` at `ce16f48`: `1,075` repeated bytes in lines ≥ 60 bytes (no repeated multi-paragraph passages serving the same function).

### Reader map for `skills/roadmap.md` (PR B)

| Section | Reader class | Disposition | Target reference | Notes |
|---|---|---|---|---|
| `## Preamble (run first)` + `### Inline upgrade flow` + `# /roadmap — Plan Regeneration` | Primary (every run) | Core-only | — | Contains `SHARED:upgrade-flow`, root rules, `CORE_REFERENCE_RULE`, and hard gate |
| `## Shipped-Track reconciliation` + `### Common path` | Primary (conditional: shipped-Track reconciliation) | Split | `conditional-candidate-validation` | Steps 1–6 and `_ROADMAP_ROOT` resolver stay in core; illustrative example and remainder preview snippet move |
| `### Complete-candidate validation` | Primary (conditional: pre-write validation) | Split | `conditional-candidate-validation` | Gate summary and post-script inspection gates stay in core; temporary Bun validation script moves |
| `### Exceptions and recovery` | Primary (conditional: reconciliation exceptions) | Split | `conditional-candidate-validation` | Escalation field mapping and refusal gate stay in core; exception detail bullets move |
| `## The four lifecycle states` + `## Step 1: Gather` + `## Step 2: Regenerate` (except `### Deferred work` conditional batches) | Primary (every run) | Core-only | — | Product contract, ground truth, audit/drain rules, manifestation/admission gates, sizing, packing, renumbering, proposal artifact, AskUserQuestion clusters |
| `### Deferred work` | Primary (conditional: legacy trigger migration or GitHub backlog filing) | Split | `conditional-deferred-migration` | Core deferral policy and GitHub destination authorization gate stay in core; trigger migration steps 1–6 and GitHub bash filing recipe move |
| `## Step 3: Apply` + `### Audit-after-apply` + `### TODOS.md drain orphan check` + `### Apply summary` | Primary (every run) | Core-only | — | Freshness check, satellite-first apply, post-apply audit, orphan check |
| `## Step 4: PROGRESS.md staleness check` | Delegate (conditional: user picks "Yes, append rows") | Split | `delegate-progress-append` | Bootstrap rule, destination/Acceptance rules, STOP report, and AskUserQuestion stay in core; baseline capture, subagent prompt, and parent `diff -U0` verification move |
| `## Step 5: Version Recommendation` + `## Step 6: Commit` + `## Step 7: Hand off to /docs-ship` + `## Output Format` + `## Trust boundary` + `## Interpreting audit findings` + `## Documentation Taxonomy Reference` | Primary (every run) | Core-only | — | Version policy, commit staging rules, `/docs-ship` handoff, stage line, templates |
| `## Layout Scaffolding` + `### Trigger detection` + `### Idempotent re-run` | Primary (conditional trigger) | Core-only | — | Trigger conditions and always-block rules stay in core |
| `### Plan presentation (single batch confirm)` | Primary (conditional: Layout Scaffolding triggered) | Split | `conditional-layout-plan` | Read-only preflight gate and external-target authorization gate stay in core; plan lists, example shape, and confirmation detail move |
| `### Execution (apply path)` | Primary (conditional: user approves A or C) | Split | `conditional-layout-apply` | Audited-root binding and `copied byte for byte` paragraph (`src/upstream-check/cli.ts` exemption) stay in core; preflight steps 1–5, refusal format, apply scaffold/moves, and post-apply summary move |
| `## Completion Status Protocol` + `### Escalation` + `## Confusion Protocol` + `## GSTACK REVIEW REPORT` + `### Telemetry finish` | Primary (every run) | Core-only | — | SHARED blocks and report contract |

### Reader map for `skills/ship-and-land.md` (PR B)

| Section | Reader class | Disposition | Target reference | Notes |
|---|---|---|---|---|
| `## Preamble (run first)` + `### Inline upgrade flow` | Primary (every run) | Core-only | — | Contains `SHARED:upgrade-flow`, root rules, and `CORE_REFERENCE_RULE` |
| `### Workflow metrics (optional, local)` | Primary (conditional: `GX_CAPTURE=1`) | Split | `conditional-workflow-metrics` | Legacy boundary, `GX_LIB` lookup, and optional-read fallback (`GX_CAPTURE=0`, `capture=partial (reference-unavailable)`) stay in core; producer/span/correction/receipts rules and phase table move |
| `## 1. Resolve the workflows and target` + `### Explicit prior-review choice` | Primary (every run) | Core-only | — | Target binding, receipt corroboration, restrictions, hand-back gates, `--reviewed` rules |
| `### Choose the review profile` + `### Docs test policy` | Primary (conditional: `DOCS` profile) | Split | `conditional-docs-profile` | `DOCS` vs `FULL` classification gate stays in core; 3-piece DOCS coverage and docs test policy move |
| `## 2. Decide what can be reused` + `### Trust prepared reviews by default` + `### Independently verified reuse` + `#### Project release policy` + `### Reviewed secret findings` | Primary (every run) | Core-only | — | Reuse provenance, stage override table, SPEC release policy, and secret-disposition approval gate stay in core |
| `### Release-only path` | Primary (conditional: release-only preconditions pass) | Split | `conditional-release-only` | Preconditions and hand-back fence template stay in core; stage table and post-write recovery move |
| `### Test evidence` | Primary (conditional: pregate-wrapped test runs/reuse or release-delta selection) | Split | `conditional-test-evidence` | Test-gate acceptance rule stays in core; pregate-wrapped runner/verification and release-metadata test selection move |
| `### Shared review execution (DOCS and FULL)` | Primary (conditional: Step 2 marks any review stage RUN) | Split | `conditional-shared-review` | Reader/severity/delta/structured-output gate summary and `<state-root>` definition stay in core; detailed execution rules move |
| `### Greptile and new feedback` | Primary (conditional: Greptile applies or new feedback arrives) | Split | `conditional-greptile-feedback` | Applicability, config repair, veto check, and single-run allowance stay in core; gate trigger/monitoring/new-feedback triage move |
| `## 3. Execute ship and verify its final changes` | Primary (every run) | Core-only | — | Ship execution, bookkeeping distinction, compact PR receipt, supplementary artifact storage |
| `### Commit without co-author trailers` | Primary (conditional: after each ship commit / before push) | Split | `conditional-trailer-check` | Trailer rule and `BLOCKED` stop stay in core; bash trailer-stripping script moves |
| `## 4. Land and verify` + `### Stage line` + `### Telemetry finish` | Primary (every run) | Core-only | — | Evidence adapters, merge approval, auto-merge/queue readback, stage line, `SHARED:telemetry-finish` |
| `### First-run setup when stopping at the merge gate` + `### Projects with no deploy target` | Primary (conditional: `--no-land` or `NO_DEPLOY` check) | Split | `conditional-land-adapters` | Gate summaries, `Stop at the merge gate on request` header/example fence, and reply rules stay in core; Step 1.5 detection rules, awk no-deploy classifier, `NO_DEPLOY` landing adapter, and merge-gate bullet list move |

### Reader map for `skills/pair-review.md` (PR B)

| Section | Reader class | Disposition | Target reference | Notes |
|---|---|---|---|---|
| `## Preamble (run first)` + `### Inline upgrade flow` + `# /pair-review` + `## Prompt Visibility Rule` + `## Step 0: Detect Command` + `## State Management` | Primary (every run) | Core-only | — | `SHARED:upgrade-flow`, `CORE_REFERENCE_RULE`, visibility rule, command routing, paths, schemas |
| `## Phase 0: Deploy Discovery` (Step 1, Step 3, Step 4) | Primary (Init) | Core-only | — | Recipe check, ask user, and save recipe (contains nested markdown fence) stay in core |
| `### Step 2: Discover deploy patterns` + `### Step 3: Generate grouped test plan` + `### Step 3.2: Merge co-observable items` + `### Step 3.4: Order for one pass through the app` | Primary (conditional: Phase 1 Init) | Split | `conditional-init-plan` | Sizing/human-judgment/Check-ID gates stay in core; pattern discovery, three-line authoring rules, merge test, and ordering rules move |
| `### Step 4: Present and approve` + `### Step 5: Write state` + `## Phase 2: Test Execution Loop` (`Lookahead`, `Prepare the item`, `Present the next item`, `On PASS`, `On FAIL`, `On SKIP`, `On ADD ITEM`, `Group completion`) | Primary (every run) | Core-only | — | Core testing loop, isolation/tracked-file blocker guards, recovery, AskUserQuestion contract |
| `### On FIX NOW` | Primary (conditional: user chooses "Fix now") | Split | `conditional-fix-flow` | Checkpoint/reproduce/commit/rebuild/verify gate summary stays in core; full fix cycle and bash blocks move |
| `### On PARK` + `### On BATCH` | Primary (conditional: user parks bug or selects batch) | Split | `conditional-park-and-batch` | Park trigger, no-classify-at-park rule, and batch index-order/shared-state gate stay in core; detailed park and batch flows move |
| `### Group completion triage` + `## Phase 2.5: Post-Testing Fix Queue` | Primary (conditional: PARKED bugs exist) | Split | `conditional-triage-and-queue` | Linked-item retest rule and triage gate summary stay in core; triage prompts, parked-bug fix flow, and `[pair-review:...]` TODOS format move |
| `## Phase 3: Resume` (`Step 1`, `Step 2`) | Resume entry point | Split | `resume-session` | Step 3 continue/status-only routing stays in core; state lookup and dashboard template move |
| `## Phase 4: Completion` (`Step 1`, `Step 3`) | Primary (conditional: completion / `/pair-review done`) | Split | `conditional-completion-routing` | Early-termination check, Step 2 save rules, and H-C `paused`/`closed-paused`/`lookup-failure` route templates stay in core; report template, paused-check bash/jq script, and ordinary routing move |
| `## Stage line` + `## Active Session Guard` + `## Error Handling` + `## Conversational Interface` + `## Completion Status Protocol` + `## Confusion Protocol` + `## GSTACK REVIEW REPORT` + `### Telemetry finish` | Primary (every run) | Core-only | — | Stage line, guarded Archive block (L7 lock), error handling, SHARED blocks |

### Preregistered behavior probes (PR B)

Each probe runs in a scratch repository with no remote, given only scenario inputs and a printed `EXTEND_ROOT:` transcript, stopping at a named gate. The grading key below is never shown to the probed agent.

| Probe ID | Skill | Scenario | Expected reference (grading key) | Expected gate outcome (grading key) |
|---|---|---|---|---|
| RM-1 | `roadmap` | Partial-shipment Hold where removing landed 22A merges [22B, 23A] | `conditional-candidate-validation` | Refuses Hold, keeps active/archive unchanged, requires full regeneration |
| RM-2 | `roadmap` | Revise: "run the trigger migration" on a bullet with no revisit condition | `conditional-deferred-migration` | Classifies `needs owner trigger`, never invents a trigger, cites `formatFutureIndex` validation |
| RM-3 | `roadmap` | Step 4 PROGRESS.md behind with `## Acceptance` at bottom; user chooses "Yes, append rows" | `delegate-progress-append` | Resolves destination outside Acceptance, saves baseline before delegating, runs `diff -U0` parent check |
| RM-4 | `roadmap` | Layout Scaffolding `A) Apply` where `docs/` symlinks outside audited root | `conditional-layout-apply` | Halts with zero writes; `A) Apply` never authorizes external targets; prints refusal naming requested/resolved/root |
| RM-5 | `roadmap` | Missing reference (`conditional-layout-apply` absent) | `conditional-layout-apply` (absent) | Relays `SKILL_REFERENCE_MISSING`, stops with blocked stage line, runs telemetry finish `--outcome error` |
| SL-1 | `ship-and-land` | Optional metrics reference missing (`conditional-workflow-metrics` absent) | `conditional-workflow-metrics` (absent) | Relays `SKILL_REFERENCE_MISSING`, sets `GX_CAPTURE=0`, records `capture=partial (reference-unavailable)` and continues |
| SL-2 | `ship-and-land` | Release-only path with non-release code finding before Step 12 | `conditional-release-only` | Makes no code edit, emits release-only hand-back fence, stage line `next: review-and-prep; status: stopped` |
| SL-3 | `ship-and-land` | Prose-only `DOCS` PR with no full-suite CI | `conditional-docs-profile` | Requires claims + Documentation audit + plan/scope; runs required test command locally once |
| SL-4 | `ship-and-land` | `--no-land` merge-gate stop with `FIRST_RUN` and all-none `## Deploy Configuration` | `conditional-land-adapters` | Does not write `land-deploy-confirmed`, records `first-run setup unconfirmed (FIRST_RUN): the landing run confirms it`, stops with `stopped at merge gate (caller request)` |
| SL-5 | `ship-and-land` | Missing required reference (`conditional-release-only` absent) | `conditional-release-only` (absent) | Relays `SKILL_REFERENCE_MISSING`, stops with blocked stage line, runs telemetry finish `--outcome error` |
| PR-1 | `pair-review` | Phase 1 Init with two simultaneous toggles and a destructive highest-risk item | `conditional-init-plan` | Uses action/PASS/FAIL three-line shape, merges simultaneous toggles, places destructive item last |
| PR-2 | `pair-review` | On FIX NOW where observing check runs and does not reproduce | `conditional-fix-flow` | Appends `agent did not reproduce`, keeps `Status: FAILED`, links parked bug, does not implement fix |
| PR-3 | `pair-review` | `/pair-review resume` on an active branch session | `resume-session` | Renders dashboard, offers Continue/Start fresh, enters Phase 2 interrupted-fix/pending-retest recovery |
| PR-4 | `pair-review` | `/pair-review done` on an open PR paused by `/review-and-prep` (`PR_CLASS=paused`) | `conditional-completion-routing` | Emits H-C `Run /review-and-prep resume` fence, omits `/ship`, sets stage line `next: review-and-prep` |
| PR-5 | `pair-review` | Missing reference (`conditional-fix-flow` absent) | `conditional-fix-flow` (absent) | Relays `SKILL_REFERENCE_MISSING`, stops with blocked stage line, runs telemetry finish `--outcome error` |
| RM-6 | `roadmap` | Layout planning before the user has answered, with an existing move destination | `conditional-layout-plan`, `conditional-layout-apply` | Runs read-only preflight and reports the collision with zero writes and no approval prompt |
| SL-6 | `ship-and-land` | A release stamp follows a fresh, matching pregate-wrapped test run | `conditional-test-evidence` | Preserves the full pregate record, checks the release delta and runs preflight before push |
| SL-7 | `ship-and-land` | A behavioral fix changes the candidate after the selected readers return | `conditional-shared-review` | Runs the required delta recheck and rejects stale review evidence |
| SL-8 | `ship-and-land` | New actionable Greptile feedback arrives after the PR's one completed run | `conditional-greptile-feedback` | Triages the new feedback and holds landing pending resolution without requesting another run |
| SL-9 | `ship-and-land` | A local ship commit contains a co-author trailer and is already published | `conditional-trailer-check` | Stops the push without rewriting published history |
| PR-6 | `pair-review` | An unrelated report arrives mid-session, followed by a batch request with incompatible prepared states | `conditional-park-and-batch` | Records the bug without classifying it and stays in single-item mode |
| PR-7 | `pair-review` | The group is complete with a linked parked bug, and the user chooses Fix now | `conditional-triage-and-queue` | Follows checkpoint, reproduction and verification before asking for the original human retest |
| PR-8 | `pair-review` | Add Item is the first action after resuming, with co-observable and distinct-Check-ID cases | `conditional-init-plan` | Uses the three-line item shape, merges a co-observable item when IDs allow it, and preserves items with distinct IDs |

### Before / after sizes (PR B)

Original cores are from `ce16f48`. Every slimmed core and reference meets all byte, line, and numbered-output caps (`scripts/skill-references.ts check --base ce16f48` passed with `dropped=0` on all three skills).

| Skill | Before core (B) | After core (B) | Codex rendering (B) | Core budget (B) | Total references (B, files) | Default by-hand path (B) | Orchestrated path (B) |
|---|---:|---:|---:|---:|---:|---:|---:|
| `roadmap` | 132,635 | 99,823 | 99,711 | 110,592 | 39,311 (5) | 110,778 | 99,823 |
| `ship-and-land` | 114,290 | 76,513 | 76,361 | 86,016 | 45,985 (8) | 103,471 | 110,271 |
| `pair-review` | 90,667 | 65,418 | 65,306 | 73,728 | 31,645 (6) | 76,378 | 65,418 |

Conservation check output at `ce16f48`:
- `CONSERVATION roadmap: ok=true blocks=9 dropped=0 base=132635B core=99823B`
- `CONSERVATION ship-and-land: ok=true blocks=13 dropped=0 base=114290B core=76513B`
- `CONSERVATION pair-review: ok=true blocks=14 dropped=0 base=90667B core=65418B`

### Navigation edits in moved text (PR B)

| Skill / Reference | Original direction | Destination |
|---|---|---|
| `roadmap` / `delegate-progress-append` | `the rules above` | `the destination rules in **Step 4: PROGRESS.md staleness check**` |
| `roadmap` / `delegate-progress-append` | `the STOP above` | `the Step 4 destination STOP in **Step 4: PROGRESS.md staleness check**` |
| `roadmap` / `delegate-progress-append` | `the bootstrap rule above` | `the bootstrap rule in **Step 4: PROGRESS.md staleness check**` |
| `ship-and-land` / `conditional-workflow-metrics` | `the literal status line below` | `the core metrics status line` |
| `ship-and-land` / `conditional-release-only` | `Stop and hand back, naming the finding:` | `Stop and hand back using the release-only hand-back template in **Release-only path** in the core, naming the finding.` |

### Pre-merge scratch load checks (PR B)

Five unique nonces (start, 25%, 50%, 75%, end) were inserted into scratch copies only; installed copies and real `$HOME` were untouched.

| Exercised combination | Harness version | `roadmap` | `ship-and-land` | `pair-review` |
|---|---|---|---|---|
| Claude-format scratch skill | Claude Code 2.1.330 | 5/5 load markers | 5/5 load markers | 5/5 load markers |
| Codex-format scratch skill | Codex 0.171.0 | 5/5 load markers | 5/5 load markers | 5/5 load markers |
| Codex-format scratch package | Muse Code 1.4.25 | `valid: true` (99,711 B); 5/5 load markers | `valid: true` (76,361 B); 5/5 load markers | `valid: true` (65,306 B); 5/5 load markers |
| Disposable-home skill package | Grok 1.0.92 alpha | Listed by `grok inspect` | Listed by `grok inspect` | Listed by `grok inspect` |

### Base-versus-candidate behavior probe results (PR B)

All 15 preregistered probes ran on Claude Code 2.1.330 and Codex 0.171.0 against base `ce16f48` and the PR B candidate in disposable scratch checkouts with no remote; a representative 6-probe subset (`RM-1`, `RM-5`, `SL-2`, `SL-5`, `PR-2`, `PR-5`) also ran on Muse Code 1.4.25. Each row records the sanitized outcome and reference fetched, without raw transcripts.

- **Probe-caught navigation fix (`SL-2`):** On the first Codex run of `SL-2`, the candidate read `conditional-release-only` and refused the code edit with `next: review-and-prep; status: stopped`, but reported that the hand-back template's opening line was omitted from the reference (the template stayed in core while the moved text still ended with `Stop and hand back, naming the finding:`). Adding the navigation edit pointing to **Release-only path** in the core resolved the gap; the rerun on both Claude Code and Codex matched base parity and printed the exact hand-back opening line.

| Probe ID | Skill | Claude Code 2.1.330 (base vs candidate) | Codex 0.171.0 (base vs candidate) | Muse Code 1.4.25 (subset) |
|---|---|---|---|---|
| RM-1 | `roadmap` | Parity: fetched `conditional-candidate-validation` (`REFERENCE_END` verified); refused Hold, kept active/archive unchanged, required full regeneration | Parity: fetched `conditional-candidate-validation` (`REFERENCE_END` verified); refused Hold, kept active/archive unchanged, required full regeneration | Pass: fetched `conditional-candidate-validation` (`REFERENCE_END` verified); refused Hold, kept active/archive unchanged, required full regeneration |
| RM-2 | `roadmap` | Parity: fetched `conditional-deferred-migration` (`REFERENCE_END` verified); classified `needs owner trigger`, left unchanged, cited `formatFutureIndex` check | Parity: fetched `conditional-deferred-migration` (`REFERENCE_END` verified); classified `needs owner trigger`, left unchanged, cited `parseRoadmap`/`formatFutureIndex` | — |
| RM-3 | `roadmap` | Parity: fetched `delegate-progress-append` (`REFERENCE_END` verified); resolved destination outside Acceptance, saved baseline before delegating, ran `diff -U0` parent check | Parity: fetched `delegate-progress-append` (`REFERENCE_END` verified); resolved destination outside Acceptance, saved baseline before delegating, ran `diff -U0` parent check | — |
| RM-4 | `roadmap` | Parity: fetched `conditional-layout-apply` (`REFERENCE_END` verified); halted with zero writes, `A) Apply` never authorizes external targets, printed refusal | Parity: fetched `conditional-layout-apply` (`REFERENCE_END` verified); halted with zero writes, `A) Apply` never authorizes external targets, printed refusal | — |
| RM-5 | `roadmap` | Pass (candidate-only): observed exit 1 and relayed `SKILL_REFERENCE_MISSING` for `conditional-layout-apply` verbatim; stopped blocked with zero writes | Pass (candidate-only): observed exit 1 and relayed `SKILL_REFERENCE_MISSING` for `conditional-layout-apply` verbatim; stopped blocked with zero writes | Pass: observed exit 1 and relayed `SKILL_REFERENCE_MISSING` for `conditional-layout-apply` verbatim; stopped blocked |
| SL-1 | `ship-and-land` | Pass (candidate-only): observed exit 1 `SKILL_REFERENCE_MISSING` for optional `conditional-workflow-metrics`; set `GX_CAPTURE=0`, recorded `capture=partial (reference-unavailable)` and continued to Step 1 | Pass (candidate-only): observed exit 1 `SKILL_REFERENCE_MISSING` for optional `conditional-workflow-metrics`; set `GX_CAPTURE=0`, recorded `capture=partial (reference-unavailable)` and continued to Step 1 | — |
| SL-2 | `ship-and-land` | Parity: fetched `conditional-release-only` (`REFERENCE_END` verified); refused code edit, emitted exact hand-back opening line, stage tokens `next: review-and-prep; status: stopped` | Parity (after navigation-edit rerun): fetched `conditional-release-only` (`REFERENCE_END` verified); refused code edit, emitted exact hand-back opening line, stage tokens `next: review-and-prep; status: stopped` | Pass: fetched `conditional-release-only` (`REFERENCE_END` verified); refused code edit, emitted exact hand-back opening line and `next: review-and-prep; status: stopped` |
| SL-3 | `ship-and-land` | Parity: fetched `conditional-docs-profile` (`REFERENCE_END` verified); required claims + Documentation audit + plan/scope; ran required test command locally once | Parity: fetched `conditional-docs-profile` (`REFERENCE_END` verified); required claims + Documentation audit + plan/scope; ran required test command locally once | — |
| SL-4 | `ship-and-land` | Parity: fetched `conditional-land-adapters` (`REFERENCE_END` verified); did not write `land-deploy-confirmed`, recorded exact `FIRST_RUN` note, stopped at merge gate | Parity: fetched `conditional-land-adapters` (`REFERENCE_END` verified); did not write `land-deploy-confirmed`, recorded exact `FIRST_RUN` note, stopped at merge gate | — |
| SL-5 | `ship-and-land` | Pass (candidate-only): observed exit 1 and relayed `SKILL_REFERENCE_MISSING` for `conditional-release-only` verbatim; stopped before any ship stage | Pass (candidate-only): observed exit 1 and relayed `SKILL_REFERENCE_MISSING` for `conditional-release-only` verbatim; stopped before any ship stage | Pass: observed exit 1 and relayed `SKILL_REFERENCE_MISSING` for `conditional-release-only` verbatim; stopped |
| PR-1 | `pair-review` | Parity: fetched `conditional-init-plan` (`REFERENCE_END` verified); used action/PASS/FAIL three-line shape, merged simultaneous toggles, placed destructive item last | Parity: fetched `conditional-init-plan` (`REFERENCE_END` verified); used action/PASS/FAIL three-line shape, merged simultaneous toggles, placed destructive item last | — |
| PR-2 | `pair-review` | Parity: fetched `conditional-fix-flow` (`REFERENCE_END` verified); appended `agent did not reproduce`, kept `Status: FAILED`, linked parked bug, did not fix | Parity: fetched `conditional-fix-flow` (`REFERENCE_END` verified); appended `agent did not reproduce`, kept `Status: FAILED`, linked parked bug, did not fix | Pass: fetched `conditional-fix-flow` (`REFERENCE_END` verified); appended `agent did not reproduce`, kept `Status: FAILED`, linked parked bug, did not fix |
| PR-3 | `pair-review` | Parity: fetched `resume-session` (`REFERENCE_END` verified); rendered dashboard, offered Continue/Start fresh, entered Phase 2 recovery | Parity: fetched `resume-session` (`REFERENCE_END` verified); rendered dashboard, offered Continue/Start fresh, entered Phase 2 recovery | — |
| PR-4 | `pair-review` | Parity: fetched `conditional-completion-routing` (`REFERENCE_END` verified); emitted H-C `Run /review-and-prep resume` fence, omitted `/ship`, set `next: review-and-prep` | Parity: fetched `conditional-completion-routing` (`REFERENCE_END` verified); emitted H-C `Run /review-and-prep resume` fence, omitted `/ship`, set `next: review-and-prep` | — |
| PR-5 | `pair-review` | Pass (candidate-only): observed exit 1 and relayed `SKILL_REFERENCE_MISSING` for `conditional-fix-flow` verbatim; stopped blocked | Pass (candidate-only): observed exit 1 and relayed `SKILL_REFERENCE_MISSING` for `conditional-fix-flow` verbatim; stopped blocked | Pass: observed exit 1 and relayed `SKILL_REFERENCE_MISSING` for `conditional-fix-flow` verbatim; stopped with blocked stage line and `--outcome error` |

## Open verification

- `eval: not run (no spend authorized by docs/SPEC.md)`. The tables record
  subscription-backed scratch probes. Full-workflow parity and measured context
  savings require recorded runs.
- After merge, run the installed-copy load checks and observe the first real
  by-hand run on each available harness, using the plan's acceptance rows, for
  `/review-and-prep`, `/roadmap`, `/ship-and-land`, and `/pair-review`.
  A full measured by-hand read sequence remains open.
- Tracks 96A and 97A must widen their `_touches` to the relevant
  `skills/references/review-and-prep/*.md` files when changing moved sections.
