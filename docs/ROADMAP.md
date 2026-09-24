# Roadmap

Organized by lifecycle state: **In Progress** (active Tracks), **Current
Plan** (next-up work), **Future** (`docs/roadmap-future.md`), **Shipped**
(`docs/roadmap-shipped.md`). A Track is one PR; Groups are equivalence
classes of "can run in parallel" — Tracks within a Group must have
set-disjoint `_touches:_` footprints. Execution order follows the
adjacency list in the Execution Map under Current Plan.

---

## In Progress

_(no Tracks currently mid-flight)_

---

## Current Plan

### Group 16: Contract Revalidation ∥ Review Independence ∥ Merge Gate ∥ Preamble Hardening ∥ Init Polish ∥ Audit Gate

_Depends on: none_

Packer layer 0. Six file-disjoint Tracks (cap 6). The three P0 external-consumer dependencies lead.

##### Track 16A: Revalidate the telemetry and execution-provenance contracts
_1 task . ~120 LOC . low risk . [telemetry doc + contract test]_
_touches: docs/telemetry.md, tests/telemetry-contract.test.ts_
_out: 16B, 17B_
_produces: an observed-coverage record for `skill-usage.jsonl` and `stage-runs.jsonl` that an external consumer can join against, with the live schema reconciled to the doc_
- **Revalidate against emitted rows** -- v0.27.2.0 and v0.28.0.0 shipped skill telemetry and local execution provenance. Verify against actual emitted data: rows for every run, producer identifiable per row, live schema matching `docs/telemetry.md`, and which join keys are stable. Record observed coverage, gaps, and join evidence in the doc; lock any schema correction in the contract test. Release claims are not acceptance evidence. _Source: TODOS `[manual]` P0 revalidation._ _docs/telemetry.md, tests/telemetry-contract.test.ts, ~120 lines._ (M)

##### Track 16B: Re-scope review independence for the Cursor harness
_1 task . ~100 lines . low risk . [design doc]_
_touches: docs/designs/review-independence.md (new)_
_read-first: 16A_
_produces: a measured voice composition for the current Cursor review route and a go/no-go on a fix, with acceptance defined on recorded execution provenance_
- **Probe and document** -- the measured Grok Build composition (Grok structured, Grok adversarial, Astra author, no Claude) is historical; Grok now runs through Cursor. Probe the Cursor route in use and document the actual voice composition. Acceptance for any fix: every review carries at least one voice from a vendor that neither wrote the code nor ran the primary review, provable from recorded execution provenance rather than assignment. If a fix is needed, file it to TODOS with the measured shape. _Source: TODOS `[manual]` P0 re-scope._ _docs/designs/review-independence.md (new), ~100 lines._ (M)

##### Track 16C: Shadow merge gate + complexity budget
_1 task . ~600 LOC . medium risk . [new CLI + lib + tests + doc]_
_touches: bin/merge-gate (new), src/merge-gate/ (new), tests/merge-gate.test.ts (new), tests/helpers/touchfiles.ts, docs/merge-gate.md (new)_
_out: 19B_
_produces: `bin/merge-gate` answers "would merge: yes/no, and why" for any PR in shadow mode only, with versioned verdicts and preserved decision-time evidence_
- **Shadow-mode merge gate** -- standalone `bin/merge-gate` that reports would-merge yes/no with raw reasons, including whether the PR exceeds a complexity budget (net lines, new files, new dependencies, new public API). Acceptance: versioned verdicts, decision-time evidence preserved so later backtests cannot use hindsight, and a demonstrable inability to perform a merge. A consumer's backtest against its own defect set is downstream, not in scope. Register the bin in `MANUAL_TOUCHFILES`. _Source: TODOS `[manual]` P0 shadow merge gate._ _bin/merge-gate (new), src/merge-gate/ (new), tests/merge-gate.test.ts (new), tests/helpers/touchfiles.ts, docs/merge-gate.md (new), ~600 lines._ (L)

##### Track 16D: Harden the upgrade preambles + move test cleanup to `afterAll`
_2 tasks . ~90 LOC . low risk . [7 skill preambles + 4 test files]_
_touches: skills/pair-review.md, skills/full-review.md, skills/review-apparatus.md, skills/test-plan.md, skills/roadmap.md, skills/gstack-extend-upgrade.md, skills/gstack-extend-init.md, tests/skill-protocols.test.ts, tests/audit-snapshots.test.ts, tests/audit-cli-contract.test.ts, tests/parsers-roadmap.test.ts_
_out: 17A, 17C, 17D, 17E, 17F, 18A_
_produces: upgrade preambles that resolve only an absolute, verified extend root; test temp dirs actually cleaned under bun test_
- **Harden the upgrade preambles** -- six preamble skills still probe the cwd-relative `.claude/skills/<skill>/.extend-root` and exec `$_EXTEND_ROOT/bin/update-check` unverified. `gstack-extend-init` is the seventh preamble: it uses the same relative `.extend-root` probe, then execs `bin/gstack-extend` rather than `update-check`. Resolve all seven the way the telemetry blocks do (absolute paths only, real executable, protocol marker) and update the preamble drift-lock. _Source: TODOS `[ship]` telemetry coverage follow-ups (4)._ _skills/{pair-review,full-review,review-apparatus,test-plan,roadmap,gstack-extend-upgrade,gstack-extend-init}.md, tests/skill-protocols.test.ts, ~60 lines._ (S)
- **`afterAll` cleanup** -- `audit-snapshots`, `audit-cli-contract`, and `parsers-roadmap` register `process.on('exit')` cleanup, which never fires under `bun test`; move them to `afterAll` (the telemetry helper already did). _Source: TODOS `[ship]` telemetry coverage follow-ups (5)._ _tests/audit-snapshots.test.ts, tests/audit-cli-contract.test.ts, tests/parsers-roadmap.test.ts, ~30 lines._ (S)

##### Track 16E: 12A init-surface polish + test coverage
_2 tasks . ~200 LOC . low risk . [init bin + setup + init tests]_
_touches: tests/init-bin.test.ts, tests/init-registry.test.ts, tests/init-templates.test.ts, tests/setup-init-wire.test.ts, tests/helpers/init-scope.ts (new), bin/gstack-extend, setup_
_out: 17B, 19A_
_produces: init test coverage, DRY CANONICAL_FILES, and a fail-soft setup self-register guard_
- **Init test coverage + mkScope helper** -- (a) audit-failure path (PATH-shim non-zero `roadmap-audit` → exit 1 + "audit FAILED" + "--migrate" + files on disk); (b) 5–10 parallel `registry_upsert` stay valid JSON; (c) `validate_name` edges (`..`, `.`, leading-dash, empty, Unicode); (d) `lang_detect` precedence; (e) setup self-register fail-soft on corrupt `projects.json`; (g) extract `mkScope` (defined only in `tests/init-bin.test.ts` today) to `tests/helpers/init-scope.ts` so the registry and wire tests share it. _tests/init-*.test.ts, tests/helpers/init-scope.ts (new), ~120 lines._ (M)
- **Init code polish** -- (f) `render_all` carries its own file→template map beside `CANONICAL_FILES`; derive one from the other; (h) `env -u GSTACK_EXTEND_STATE_DIR` guard on setup self-register; (j) trim fresh-init audit output to non-pass sections. _bin/gstack-extend, setup, ~80 lines._ (M)

##### Track 16F: Narrow the `docs/`-absent gate + fix archive-path string
_1 task . ~35 LOC . low risk . [doc-location + state-sections]_
_touches: src/audit/checks/doc-location.ts, tests/checks-doc-location.test.ts, src/audit/checks/state-sections.ts_
_produces: DOC_LOCATION docs/-absent only fires on a gstack-extend signal; MIGRATION_NEEDED points at the archived spec_
- **Tighten docs/-absent gate + fix archive path** -- replace the `hasClaude` gate in `doc-location.ts` with a gstack-extend signal (roadmap-audit shim, projects registry entry, or `docs/ROADMAP.md`). Fixture: CLAUDE.md-only repo must NOT fire. Same PR: point the `state-sections.ts` MIGRATION_NEEDED hint at `docs/archive/roadmap-v2-state-model.md` (it still names `docs/designs/`; no snapshot fixture exercises it). _src/audit/checks/doc-location.ts, tests/checks-doc-location.test.ts, src/audit/checks/state-sections.ts, ~35 lines._ (S)

### Group 17: Review-and-Prep Hardening ∥ Telemetry Follow-ups ∥ Skill-File Trims

_Depends on: Group 16_

Packer layer 1. Serialized behind 16D (preamble edits in the same skill files), 16A (`docs/telemetry.md`), and 16E (`setup`).

##### Track 17A: Harden `/review-and-prep` Greptile-once and pause/resume edge cases
_1 task . ~120 LOC . medium risk . [review-and-prep skill + drift-locks + README]_
_touches: skills/review-and-prep.md, tests/skill-protocols.test.ts, README.md_
_blocked-by: Track 16D_
_out: 19C_
_read-first: 16D_
_produces: bounded exits for every Greptile-once and pause/resume edge the PR #102 adversarial pass found; each is a user decision, not a silent block_
- **Close the seven gaps** -- (1) default auto-trigger can start a forbidden second run on ready; (2) a failed/cancelled run consumes the allowance with no path to ready; (3) the PAUSED receipt lives only in the regenerated PR body and /pair-review's completion path recommends /ship directly; (4) an ambiguous MCP trigger with no visible run has no bounded exit; (5) a session dying between MCP trigger and first receipt write loses the reservation; (6) post-fallback rules disagree when a run turns queued/running before ready; (7) a reviewed SHA no longer an ancestor of HEAD still satisfies the gate. Each changes behavior the user specified for PR #102, so /autoplan gets a decision per gap before writing prose. Update drift-locks and the README rules. _Source: TODOS `[review:severity=necessary]`; finding list in the PR #102 body under Adversarial Review._ _skills/review-and-prep.md, tests/skill-protocols.test.ts, README.md, ~120 lines._ (M)

##### Track 17B: Telemetry wrapper follow-ups
_3 tasks . ~180 LOC . medium risk . [telemetry.py + setup + doctor tests]_
_touches: bin/lib/telemetry.py, setup, tests/telemetry.test.ts, tests/telemetry-doctor.test.ts, tests/setup-hosts.test.ts, docs/telemetry.md_
_blocked-by: Track 16A, Track 16E_
_read-first: 16A_
_produces: the wrapper records on Codex-only and OpenCode-only machines, uninstall is symmetric, and cross-repo finish has a defined rule_
- **Probe host runtime roots** -- `telemetry.py` finds gstack's helpers only under `~/.claude/skills/gstack/bin`; a Codex-only or OpenCode-only machine records nothing. Probe the host roots too and have the doctor warn when neither helper resolves. _Source: TODOS `[ship]` telemetry coverage follow-ups (1)._ _bin/lib/telemetry.py, tests/telemetry.test.ts, tests/telemetry-doctor.test.ts, ~60 lines._ (S)
- **Symmetric uninstall** -- `setup --uninstall` removes `~/.local/bin/gstack-extend` but not the `gstack-extend-telemetry` link it also wired. _Source: TODOS `[ship]` telemetry coverage follow-ups (2)._ _setup, tests/setup-hosts.test.ts, ~20 lines._ (S)
- **Cross-repo finish + orphan adoption** -- `finish` run from a different repository root than `start` silently drops the completion, and a `finish` whose start was skipped adopts an abandoned earlier handoff with no age bound. Resumable skills legitimately span days, so the bound is a product call; document the chosen rule in `docs/telemetry.md`. _Source: TODOS `[ship]` telemetry coverage follow-ups (3)._ _bin/lib/telemetry.py, tests/telemetry.test.ts, docs/telemetry.md, ~100 lines._ (M)

##### Track 17C: Trim `pair-review.md`
_1 task . ~100 lines (del) . low risk . [pair-review skill file]_
_touches: skills/pair-review.md_
_blocked-by: Track 16D_
_out: 19B_
_read-first: 16D_
_produces: pair-review.md with only unique prose; locked fragments untouched_
- **Duplication-only trim per scope discipline** -- remove literal duplication, word-level redundancy, stale refs, and dead cross-references. Do not touch `SHARED:` blocks, the preamble, or the telemetry blocks. Gate on `tests/skill-protocols.test.ts` still passing. _skills/pair-review.md, ~100 lines (del)._ (S)

##### Track 17D: Trim `full-review.md`
_1 task . ~80 lines (del) . low risk . [full-review skill file]_
_touches: skills/full-review.md_
_blocked-by: Track 16D_
_out: 19B_
_read-first: 16D_
_produces: full-review.md with only unique prose; locked fragments untouched_
- **Duplication-only trim per scope discipline** -- same rules as 17C. _skills/full-review.md, ~80 lines (del)._ (S)

##### Track 17E: Trim `review-apparatus.md`
_1 task . ~50 lines (del) . low risk . [review-apparatus skill file]_
_touches: skills/review-apparatus.md_
_blocked-by: Track 16D_
_out: 19B_
_read-first: 16D_
_produces: review-apparatus.md with only unique prose; locked fragments untouched_
- **Duplication-only trim per scope discipline** -- same rules as 17C. _skills/review-apparatus.md, ~50 lines (del)._ (S)

##### Track 17F: Trim `test-plan.md` + fit its description under the Codex cap
_2 tasks . ~80 lines (del) + ~20 LOC . low risk . [test-plan skill file + compliance test]_
_touches: skills/test-plan.md, tests/audit-compliance.test.ts_
_blocked-by: Track 16D_
_out: 19B_
_read-first: 16D_
_produces: test-plan.md with only unique prose and a frontmatter description ≤ 1024 chars; the cap is locked in audit-compliance_
- **Duplication-only trim per scope discipline** -- same rules as 17C. _skills/test-plan.md, ~80 lines (del)._ (S)
- **Frontmatter description ≤ 1024** -- `skills/test-plan.md`'s `description:` measures 1018 chars at a646c94 via `descriptionLen` in `tests/setup-hosts.test.ts`, which already enforces ≤1024. No shorten is required. Add the same cap to audit-compliance describe (A) so no skill regresses. _Source: docs/roadmap-future.md "Frontmatter description ≤ 1024 for Codex" (promoted 2026-09-24)._ _skills/test-plan.md, tests/audit-compliance.test.ts, ~20 lines._ (S)

### Group 18: Layout Scaffolding Preflight

_Depends on: Group 16_

Packer layer 1, leftover singleton: Group 17 is at the fill cap and this Track shares `skills/roadmap.md` with 16D.

##### Track 18A: Add realpath preflight to Layout Scaffolding skill prose
_1 task . ~30 LOC . low risk . [skills/roadmap.md]_
_touches: skills/roadmap.md_
_blocked-by: Track 16D_
_out: 19A_
_read-first: 16D_
_produces: Layout Scaffolding refuses scaffold dirs whose realpath is outside the repo_
- **Realpath preflight for Layout Scaffolding skill prose** -- after the exists-or-is-directory check, resolve each scaffold dir and halt if the target is outside the repo root. Name the resolved path. Document the chezmoi/stow exception. _skills/roadmap.md, ~30 lines._ (S)

### Group 19: Layout Scaffold Extract ∥ Skill Template ∥ Capability Table

_Depends on: Group 16, Group 17, Group 18_

Packer layer 2. Consumes the trimmed skill files, the hardened preambles, the polished init binary, and the settled drift-lock file.

##### Track 19A: Extract Layout Scaffolding into shared helper
_1 task . ~120 LOC . low risk . [shared lib extraction]_
_touches: skills/roadmap.md, bin/lib/layout-scaffold.sh (new), bin/gstack-extend_
_blocked-by: Track 18A, Track 16E_
_out: 20A_
_read-first: 18A, 16E_
_produces: one layout-scaffold helper consumed by /roadmap and `gstack-extend init`_
- **Layout Scaffolding shared helper** -- pull the inline Layout Scaffolding logic out of `skills/roadmap.md` into `bin/lib/layout-scaffold.sh`. Replace init's inline mkdir+refusal in `bin/gstack-extend` with a call to the same helper. _skills/roadmap.md, bin/lib/layout-scaffold.sh (new), bin/gstack-extend, ~120 lines._ (S)

##### Track 19B: Promote canonical fragments into a shared skill template
_1 task . ~150 LOC . low risk . [template + drift-lock]_
_touches: skills/SKILL.md.tmpl (new), tests/skill-template.test.ts (new), tests/helpers/touchfiles.ts_
_blocked-by: Track 17C, Track 17D, Track 17E, Track 17F, Track 16C_
_read-first: 16D, 17C, 17D, 17E, 17F_
_produces: a SKILL.md.tmpl carrying every canonical fragment, drift-locked to the live copies so new skills start correct_
- **Template + drift-lock** -- write `skills/SKILL.md.tmpl` from the fragments 15A locked and the trims left intact (upgrade preamble, SHARED blocks, telemetry start/finish, completion-status, escalation). Add a test that every SHARED block in the template is byte-identical to its canonical copy. No install wiring: `setup` installs from an explicit `SKILLS=( … )` array, so the template is an authoring source, not an install input. Register the `.tmpl` in `MANUAL_TOUCHFILES`. _skills/SKILL.md.tmpl (new), tests/skill-template.test.ts (new), tests/helpers/touchfiles.ts, ~150 lines._ (M)

##### Track 19C: Replace the SHARED-block cohorts with a per-skill capability table
_1 task . ~150 LOC . medium risk . [skill-protocols test refactor]_
_touches: tests/skill-protocols.test.ts, tests/helpers/expected-setup-skills.ts, tests/helpers/skill-capabilities.ts (new)_
_blocked-by: Track 17A_
_read-first: 17A_
_produces: one declarative table (row per skill, column per SHARED block) driving every cohort assertion_
- **Capability table** -- `tests/skill-protocols.test.ts` keeps PROTOCOL, PREAMBLE, NON_PREAMBLE_SETUP, CONDUCTOR, and TELEMETRY cohorts plus the independently hardcoded expected list. Replace them with one table; adding a SHARED block becomes a column, not a cohort plus three invariants. Keep the exact comparison against `setup`. _Source: TODOS `[plan-eng-review:defer=true]` FINDING 10.1._ _tests/skill-protocols.test.ts, tests/helpers/expected-setup-skills.ts, tests/helpers/skill-capabilities.ts (new), ~150 lines._ (M)

### Group 20: Roadmap Lifecycle Consistency

_Depends on: Group 19_

Packer layer 3. Waits for the last `skills/roadmap.md` editor (19A).

##### Track 20A: Reconcile In Progress co-location with PACKING
_1 task . ~40 LOC . low risk . [roadmap skill prose + archived spec, or the packing check]_
_touches: skills/roadmap.md, docs/archive/roadmap-v2-state-model.md, src/audit/checks/packing.ts, tests/check-packing.test.ts_
_blocked-by: Track 19A_
_read-first: 19A_
_produces: the lifecycle prose and the PACKING check agree on what happens to a partially shipped Group at regen_
- **Pick one rule and make both sides say it** -- the model says a Group with shipped Tracks stays in `## In Progress` with `✓` markers until it lands, and that idle Tracks "recycle with the Current Plan"; PACKING packs every unshipped Track and requires each written Group to equal a bin, so marking 15A/15B shipped moved the trims to layer 0 and left {15C, 15D, 15E} matching no bin. Default: drop the co-location prose (skill + archived spec) and state that a partially shipped Group ships its done Tracks and recycles the rest. Alternative: exempt In Progress Groups from PACKING and pin their idle Tracks (stale partition until the Group lands). Either way, the skill's "Hold — trivial closures" option must describe something reachable. _Source: TODOS `[manual]`, found 2026-09-24 closing Group 15._ _skills/roadmap.md, docs/archive/roadmap-v2-state-model.md, src/audit/checks/packing.ts, tests/check-packing.test.ts, ~40 lines._ (S)

### Execution Map

A Group may launch when every Group in its ← set has landed, regardless
of document order; document order is priority, not gating.

Adjacency list (from `bin/roadmap-pack`):
```
- Group 16 ← {}
- Group 17 ← {16}
- Group 18 ← {16}
- Group 19 ← {16, 17, 18}
- Group 20 ← {19}
```

Track detail per group:
```
Group 16: Contract Revalidation ∥ Review Independence ∥ Merge Gate ∥ Preamble Hardening ∥ Init Polish ∥ Audit Gate
  +-- Track 16A .......... ~M . 1 task (revalidate telemetry + provenance contracts)
  +-- Track 16B .......... ~M . 1 task (review independence probe)
  +-- Track 16C .......... ~L . 1 task (shadow merge gate)
  +-- Track 16D .......... ~S . 2 tasks (preamble hardening + afterAll)
  +-- Track 16E .......... ~M . 2 tasks (init tests + init code polish)
  +-- Track 16F .......... ~S . 1 task (docs/-absent gate + archive path)

Group 17: Review-and-Prep Hardening ∥ Telemetry Follow-ups ∥ Skill-File Trims
  +-- Track 17A .......... ~M . 1 task (review-and-prep seven gaps)
  +-- Track 17B .......... ~L . 3 tasks (host roots + uninstall + cross-repo finish)
  +-- Track 17C .......... ~S . 1 task (trim pair-review)
  +-- Track 17D .......... ~S . 1 task (trim full-review)
  +-- Track 17E .......... ~S . 1 task (trim review-apparatus)
  +-- Track 17F .......... ~S . 2 tasks (trim test-plan + description cap)

Group 18: Layout Scaffolding Preflight
  +-- Track 18A .......... ~S . 1 task (realpath preflight)

Group 19: Layout Scaffold Extract ∥ Skill Template ∥ Capability Table
  +-- Track 19A .......... ~S . 1 task (layout-scaffold helper)
  +-- Track 19B .......... ~M . 1 task (SKILL.md.tmpl + drift-lock)
  +-- Track 19C .......... ~M . 1 task (capability table)

Group 20: Roadmap Lifecycle Consistency
  +-- Track 20A .......... ~S . 1 task (co-location prose vs PACKING)
```

**Total: 0 phases . 5 groups . 17 tracks remaining.**

---

## Future

Deferred: docs/roadmap-future.md (14 items)

## Shipped

History: docs/roadmap-shipped.md
