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
| Codex | 0.171.0 | No hard rejection observed for the base | Five markers visible in one 28,990-byte synthetic result | Rendered copy and shared preamble |
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
  The final 30 references top out at 15,513 file bytes,
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
| `review-and-prep` | 366,223 | 167,650 | 184,320 | 226,963 (30) | 196,467 | 221,552 |

The by-hand budget counts unique bytes for a successful first cycle on Codex
with metrics active, the selected Claude Code outside pass and no Greptile.
It includes the workflow metrics, outside adapter and cycle-baseline references.
The orchestrated row adds policy values and the external-gate procedure.
These are path budgets from the reader map. Per-run usage and the complete
by-hand read sequence remain to be measured.

The Codex rendering is 167,498 bytes, 94,646 bytes below the verified Muse
limit. `bun scripts/skill-references.ts check --base 39c2b0c --skill review-and-prep`
returned `ok=true blocks=42 dropped=0 base=366223B core=167650B`.

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
| Codex-format scratch skill | Muse Code 1.4.25 | 5/5 load markers. The validator accepted the 167,498-byte package with no diagnostics. |
| Codex-format scratch file | Grok 1.0.92 alpha | 5/5 load markers from a paged file read. Workspace skill discovery was unavailable in this scratch configuration. |

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
same line was missing from every read.

## Open verification

- `eval: not run (no spend authorized by docs/SPEC.md)`. The table records the
  subscription-backed scratch probes. Full-workflow parity and measured context
  savings require recorded runs.
- After merge, run the installed-copy load checks and observe the first real
  by-hand run on each available harness, using the plan's acceptance rows.
- Tracks 96A and 97A must widen their `_touches` to the relevant
  `skills/references/review-and-prep/*.md` files when changing moved sections.
- Track 94I PR B starts from a fresh base after PR A merges. Its scope is
  slimming `skills/roadmap.md`, `skills/ship-and-land.md`, and
  `skills/pair-review.md` with their own budgets and verification.
