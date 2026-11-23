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
| Claude Code | 2.1.330 | No hard rejection up to 366,223 B (loads installed `/review-and-prep` daily) | ~30,000 chars (~30 KiB) per Bash tool output; tail/middle persisted to file on overflow | `~/.gstack-extend/bin/preamble <skill> --ref <file> --expect <digest> [--lines <a>-<b>]` (already covered by `Bash(~/.gstack-extend/bin/preamble:*)`) |
| Codex | codex-cli 0.171.0 | No hard rejection documented or observed | ~10 KiB–32 KiB depending on config; middle elision on long command output | Same `preamble --ref` command; numbered lines + `REFERENCE_END lines=N` + `--lines <a>-<b>` contiguity check handles middle elision |
| Muse | Muse Code 1.4.25 (1.4.25-R9361.1) | **262,144 bytes** (measured via `muse skills validate --json`: 262,144 B `valid: true`, 262,145 B `SKILL.md exceeds 262144 byte limit`) | Same command-output contiguity rule | Loads the Codex install (`~/.codex/skills/<skill>/SKILL.md`), which shares the `preamble --ref` command |
| Grok | grok 1.0.92 (b06756fd6256) [alpha] | No hard rejection observed | Same command-output contiguity rule | Same `preamble --ref` command |

### Reference and core caps

- **Core cap:** `196,608` bytes (75% of Muse Code 1.4.25's measured `262,144`-byte limit).
- **Per-reference cap:** `24,576` bytes (24 KiB) and `400` lines, with every line ≤ `2,000` characters (longest line across all 11 skills at `6293d8c` is `1,791` chars in `docs-ship.md`, `1,654` chars in `review-and-prep.md`).
- **Budgets:** enforced in `tests/helpers/skill-budgets.ts` and `tests/skill-references.test.ts` for all 11 skills in `setup`'s `SKILLS` list.
- **Root-read proof:** `setup` is unchanged; references live at `skills/references/<skill>/<prefix>-<topic>.md` under the gstack-extend checkout and are served through `~/.gstack-extend/bin/preamble <skill> --ref <file> --expect <digest>`, which resolves the same verified checkout root as the start command and binds the loaded core to the checkout via a 16-hex SHA-256 content digest.

### Duplication check (Criteria 1 & 2, User Challenge uc1)

- Within `skills/review-and-prep.md` at `6293d8c`: `1,327` repeated bytes in lines ≥ 60 bytes (no repeated multi-paragraph passages serving the same function).
- Across all 11 `skills/*.md` outside `<!-- SHARED:... -->` blocks: ~24 KB, consisting of the protocol-locked start-command recovery paragraph and short shared lines. Under settled decision `uc1a`, cross-skill deduplication is not performed in this Track; single ownership per reference is preserved.

## Reader map for `skills/review-and-prep.md` (PR A)

Every section of `skills/review-and-prep.md` mapped before moving any text:

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
