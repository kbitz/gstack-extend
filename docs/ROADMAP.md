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

### Group 15: Canonical Locks ∥ Migrations ∥ Audit Gate ∥ Scaffold Preflight ∥ Init Polish

_Depends on: none_

Packer layer 0. Five file-disjoint Tracks. In-flight count is 5 (cap 6).

##### Track 15A: Lock SHARED:conductor-visibility-head + section-list drift + SKILLS helper
_3 tasks . ~130 LOC . low risk . [skill-protocols test + SKILLS helper]_
_touches: tests/skill-protocols.test.ts, tests/helpers/parse-setup-skills.ts (new), tests/audit-compliance.test.ts, skills/pair-review.md, skills/full-review.md, skills/review-apparatus.md, skills/test-plan.md_
_out: 16A, 16B, 16C, 16D, 17A_
_produces: locked SHARED:conductor-visibility-head, exact-set section-list drift assertions, and explicit SETUP/PROTOCOL/PREAMBLE/CONDUCTOR cohorts_
- **Lock Conductor visibility head** -- wrap the shared heading+item-1 core in pair-review, full-review, review-apparatus, test-plan; extract-from-canonical with AskUserQuestion / last-message pins. Conductor-only — 17A must not inherit blindly. _skills/{pair-review,full-review,review-apparatus,test-plan}.md, tests/skill-protocols.test.ts, ~40 lines._ (S)
- **Drift test: advisory/fail lists vs CANONICAL_SECTIONS** -- named parser on the two GSTACK REVIEW REPORT comma-lists; exact sets; fail-on-empty; SIZE_LABEL_MISMATCH is a known fossil (SIZE body label), not a section. Do not edit skills/roadmap.md. _tests/skill-protocols.test.ts, ~50 lines._ (S)
- **Shared SKILLS parser + explicit cohorts** -- extract `tests/helpers/parse-setup-skills.ts`; audit-compliance consumes it; protocol membership is an explicit 5/6/4 split (init is install-only). _tests/helpers/parse-setup-skills.ts (new), tests/audit-compliance.test.ts, tests/skill-protocols.test.ts, ~40 lines._ (S)

##### Track 15B: `migrations/v*.sh` runner + applied/failed ledger
_3 tasks . ~M . medium risk . [update-run helper + ledger + upgrade-skill warn]_
_touches: bin/update-run, bin/lib/run-migrations.sh (new), migrations/.gitkeep (new), tests/update.test.ts, tests/helpers/touchfiles.ts, skills/gstack-extend-upgrade.md_
_produces: on-disk migrations helper, STATE_DIR applied/failed ledger, MIGRATION_WARN visible in /gstack-extend-upgrade_
- **On-disk helper + ledger** -- after setup, before checkout-restore, exec pulled `bin/lib/run-migrations.sh`. Version window selects candidates; ledger is the applied-set. Failed scripts retry on the next update-run even when OLD==NEW. `set -e` must not turn a script exit into UPGRADE_FAILED. _bin/update-run, bin/lib/run-migrations.sh (new), ~80 lines._ (M)
- **Fixture tests** -- window filter, fail-soft + same-VERSION retry, version order, absent dir, old-binary chicken-and-egg. `migrations/.gitkeep` satisfies touchfiles I1. _tests/update.test.ts, tests/helpers/touchfiles.ts, migrations/.gitkeep (new), ~120 lines._ (M)
- **Warn visibility** -- on UPGRADE_OK, if stdout has MIGRATION_WARN, name the script and say re-run retries it. Outside SHARED:upgrade-flow. _skills/gstack-extend-upgrade.md, ~8 lines._ (S)

##### Track 15C: Narrow the `docs/`-absent gate + fix archive-path string
_1 task . ~35 LOC . low risk . [doc-location + state-sections]_
_touches: src/audit/checks/doc-location.ts, tests/checks-doc-location.test.ts, src/audit/checks/state-sections.ts_
_produces: DOC_LOCATION docs/-absent only fires on a gstack-extend signal; MIGRATION_NEEDED points at the archived spec_
- **Tighten docs/-absent gate + fix archive path** -- replace the `hasClaude` gate with a gstack-extend signal (roadmap-audit shim, projects registry entry, or `docs/ROADMAP.md`). Fixture: CLAUDE.md-only repo must NOT fire. Same PR: point `state-sections.ts` MIGRATION_NEEDED at `docs/archive/roadmap-v2-state-model.md`. _src/audit/checks/doc-location.ts, tests/checks-doc-location.test.ts, src/audit/checks/state-sections.ts, ~35 lines._ (S)

##### Track 15D: Add realpath preflight to Layout Scaffolding skill prose
_1 task . ~30 LOC . low risk . [skills/roadmap.md]_
_touches: skills/roadmap.md_
_out: 16E_
_produces: Layout Scaffolding refuses scaffold dirs whose realpath is outside the repo_
- **Realpath preflight for Layout Scaffolding skill prose** -- after the exists-or-is-directory check, resolve each scaffold dir and halt if the target is outside the repo root. Name the resolved path. Document the chezmoi/stow exception. _skills/roadmap.md, ~30 lines._ (S)

##### Track 15E: 12A init-surface polish + test coverage
_2 tasks . ~200 LOC . low risk . [init bin + setup + init tests]_
_touches: tests/init-bin.test.ts, tests/init-registry.test.ts, tests/init-templates.test.ts, tests/setup-init-wire.test.ts, tests/helpers/init-scope.ts (new), bin/gstack-extend, setup_
_out: 16E_
_produces: init test coverage, DRY CANONICAL_FILES, and a fail-soft setup self-register guard_
- **Init test coverage + mkScope helper** -- (a) audit-failure path (PATH-shim non-zero `roadmap-audit` → exit 1 + "audit FAILED" + "--migrate" + files on disk); (b) 5–10 parallel `registry_upsert` stay valid JSON; (c) `validate_name` edges (`..`, `.`, leading-dash, empty, Unicode); (d) `lang_detect` precedence; (e) setup self-register fail-soft on corrupt `projects.json`; (g) extract `mkScope` to `tests/helpers/init-scope.ts`. _tests/init-*.test.ts, tests/helpers/init-scope.ts (new), ~120 lines._ (M)
- **Init code polish** -- (f) `render_all` map ↔ `CANONICAL_FILES` DRY; (h) `env -u GSTACK_EXTEND_STATE_DIR` guard on setup self-register; (j) trim fresh-init audit output to non-pass sections. Multi-hop readlink walker (old item i) shipped in v0.22.3.0. _bin/gstack-extend, setup, ~80 lines._ (M)

### Group 16: Skill-File Trims ∥ Layout Scaffold Extract

_Depends on: Group 15_

Packer layer 1. Trims wait on 15A's fragment lock. Layout extract waits on 15D (preflight lands in `skills/roadmap.md`) and 15E (`bin/gstack-extend` polish).

##### Track 16A: Trim `pair-review.md`
_1 task . ~100 lines (del) . low risk . [pair-review skill file]_
_touches: skills/pair-review.md_
_blocked-by: Track 15A_
_out: 17A_
_read-first: 15A_
_produces: pair-review.md with only unique prose; locked fragments untouched_
- **Duplication-only trim per scope discipline** -- remove literal duplication, word-level redundancy, stale refs, and dead cross-references. Do not touch `SHARED:` blocks. Gate on `tests/skill-protocols.test.ts` still passing. _skills/pair-review.md, ~100 lines (del)._ (S)

##### Track 16B: Trim `full-review.md`
_1 task . ~80 lines (del) . low risk . [full-review skill file]_
_touches: skills/full-review.md_
_blocked-by: Track 15A_
_out: 17A_
_read-first: 15A_
_produces: full-review.md with only unique prose; locked fragments untouched_
- **Duplication-only trim per scope discipline** -- same rules as 16A. _skills/full-review.md, ~80 lines (del)._ (S)

##### Track 16C: Trim `review-apparatus.md`
_1 task . ~50 lines (del) . low risk . [review-apparatus skill file]_
_touches: skills/review-apparatus.md_
_blocked-by: Track 15A_
_out: 17A_
_read-first: 15A_
_produces: review-apparatus.md with only unique prose; locked fragments untouched_
- **Duplication-only trim per scope discipline** -- same rules as 16A. _skills/review-apparatus.md, ~50 lines (del)._ (S)

##### Track 16D: Trim `test-plan.md`
_1 task . ~80 lines (del) . low risk . [test-plan skill file]_
_touches: skills/test-plan.md_
_blocked-by: Track 15A_
_out: 17A_
_read-first: 15A_
_produces: test-plan.md with only unique prose; locked fragments untouched_
- **Duplication-only trim per scope discipline** -- same rules as 16A. _skills/test-plan.md, ~80 lines (del)._ (S)

##### Track 16E: Extract Layout Scaffolding into shared helper
_1 task . ~120 LOC . low risk . [shared lib extraction]_
_touches: skills/roadmap.md, bin/lib/layout-scaffold.sh (new), bin/gstack-extend_
_blocked-by: Track 15D, Track 15E_
_read-first: 15D, 15E_
_produces: one layout-scaffold helper consumed by /roadmap and `gstack-extend init`_
- **Layout Scaffolding shared helper** -- pull the inline Layout Scaffolding logic out of `skills/roadmap.md` into `bin/lib/layout-scaffold.sh`. Replace 12A's inline mkdir+refusal in `bin/gstack-extend` with a call to the same helper. _skills/roadmap.md, bin/lib/layout-scaffold.sh (new), bin/gstack-extend, ~120 lines._ (S)

### Group 17: Promote Canonical Fragments to `SKILL.md.tmpl`

_Depends on: Group 15, Group 16_

Packer layer 2. Consumes the locked fragments and the trimmed skill files. Serialized after Group 15 (setup collision with 15E) via the 15 → 16 → 17 chain.

##### Track 17A: Promote canonical fragments into a shared template
_1 task . ~150 LOC . low risk . [shared template + setup integration]_
_touches: .claude/skills/SKILL.md.tmpl (new), setup_
_blocked-by: Track 15A, Track 15E, Track 16A, Track 16B, Track 16C, Track 16D_
_read-first: 15A, 16A, 16B, 16C, 16D_
_produces: SKILL.md.tmpl carrying canonical fragments; new skills inherit them_
- **Promote canonical fragments into a shared template** -- write `.claude/skills/SKILL.md.tmpl` from the fragments 15A locked and 16A–D left intact. Wire `setup` so new skills inherit the template. _.claude/skills/SKILL.md.tmpl (new), setup, ~150 lines._ (M)

### Execution Map

Adjacency list (from `bin/roadmap-pack`):
```
- Group 15 ← {}
- Group 16 ← {15}
- Group 17 ← {15, 16}
```

Track detail per group:
```
Group 15: Canonical Locks ∥ Migrations ∥ Audit Gate ∥ Scaffold Preflight ∥ Init Polish
  +-- Track 15A .......... ~S . 3 tasks (fragments + drift + SKILLS helper)
  +-- Track 15B .......... ~M . helper + ledger + warn visibility
  +-- Track 15C .......... ~S . 1 task (docs/-absent gate + archive path)
  +-- Track 15D .......... ~S . 1 task (realpath preflight)
  +-- Track 15E .......... ~M . 2 tasks (init tests + init code polish)

Group 16: Skill-File Trims ∥ Layout Scaffold Extract
  +-- Track 16A .......... ~S . 1 task (trim pair-review)
  +-- Track 16B .......... ~S . 1 task (trim full-review)
  +-- Track 16C .......... ~S . 1 task (trim review-apparatus)
  +-- Track 16D .......... ~S . 1 task (trim test-plan)
  +-- Track 16E .......... ~S . 1 task (layout-scaffold helper)

Group 17: SKILL.md.tmpl promotion
  +-- Track 17A .......... ~M . 1 task
```

**Total: 0 phases . 3 groups . 11 tracks remaining.**

---

## Future

Deferred: docs/roadmap-future.md (9 items)

## Shipped

History: docs/roadmap-shipped.md
