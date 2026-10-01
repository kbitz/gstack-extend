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

_tombstone: 17, 19, 20_

### Group 22: Row Versioning ∥ Roadmap Closure ∥ Scaffold Helper ∥ Full-Review Fixes ∥ Greptile Lifecycle Core ∥ Setup Safety

_Depends on: none_

Packer layer 0.

##### Track 22A: Version stage-runs rows and publish their schema
_2 tasks . ~150 LOC incl. tests . low risk . [telemetry.py + schema file + contract tests + doc]_
_touches: bin/lib/telemetry.py, docs/telemetry.md, docs/stage-runs.schema.json (new), tests/telemetry-contract.test.ts, tests/telemetry.test.ts_
_out: 24A_
_produces: every stage-runs row names its schema version, the gstack-extend release that wrote it, and whether agent, model and effort came from flags or detection; a published schema readers can validate against_
- **Version and source-mark every row** -- add a schema version and a producer version to each `stage-runs.jsonl` row, and record whether `agent`/`model`/`effort` came from flags or from detection. Give the `route` values written inline in `route_for` a named constant. `docs/telemetry.md` states "Rows carry no schema or producer version", and its observed-coverage record counts 8 of 14 rows without `route` and `entrypoint_raw`, so a reader cannot tell the writer release from key presence. _Source: TODOS `[plan-ceo-review:track=16A,defer=true]`, P1._ _bin/lib/telemetry.py, tests/telemetry.test.ts, ~70 lines._ (S)
- **Publish the schema** -- one machine-readable schema for the row, replacing the per-field and per-value version notes in `docs/telemetry.md`; the contract test asserts an emitted row validates against it. Rows written before this Track stay valid as "version absent". How to validate is an /autoplan decision: `package.json` has no dependencies today and is a global touchfile. _docs/stage-runs.schema.json (new), docs/telemetry.md, tests/telemetry-contract.test.ts, ~80 lines._ (S)

##### Track 22B: Reconcile shipped-Track closure with PACKING
_1 task . ~80 LOC . low risk . [roadmap skill prose + archived spec + packing check]_
_touches: skills/roadmap.md, docs/archive/roadmap-v2-state-model.md, src/audit/checks/packing.ts, tests/check-packing.test.ts_
_out: 25A_
_produces: one written rule for what happens to a shipped Track before its Group lands, and who records it, that the lifecycle prose and the PACKING check both follow_
- **Pick one rule and make both sides say it** -- the skill says a Group with shipped Tracks stays in `## In Progress` with `✓` markers until it lands ("stay co-located"); PACKING packs every unshipped Track and requires each written Group to equal a bin, so marking one Track shipped moves the bins under its siblings. Nothing says who records a shipped Track at land time. Measured at the 2026-09-30 regen: eleven Tracks merged in PRs #109–#121 were still listed as unshipped; the 2026-09-26 re-pack (#115) relabeled nine of them, three after they had shipped; PR #122 wrote its Track into `docs/roadmap-shipped.md` as a lone `### Track` heading outside any Group. Default: drop the co-location prose (skill + archived spec), state that a shipped Track leaves the plan alone and the rest of its Group recycles, and name the recorder (shipping session or next regen) and the archive line for a Track whose Group has not landed. Alternative: exempt In Progress Groups from PACKING and pin their idle Tracks (stale partition until the Group lands). Either way, the skill's Hold option ("only apply trivial closures") must describe something reachable. _Source: TODOS `[manual]`, found 2026-09-24 closing Group 15; evidence re-measured at 2b86716._ _skills/roadmap.md, docs/archive/roadmap-v2-state-model.md, src/audit/checks/packing.ts, tests/check-packing.test.ts, ~80 lines._ (M)

##### Track 22C: Layout Scaffolding executable helper
_1 task . ~500 LOC incl. tests . medium risk . [new bin + TS module + tests]_
_touches: bin/layout-scaffold (new), src/layout-scaffold/ (new), tests/layout-scaffold.test.ts (new), tests/helpers/touchfiles.ts_
_out: 24B, 25A_
_produces: a command that plans, preflights and applies Layout Scaffolding under one audited root, with every refusal reproduced by a test_
- **Helper with the preflight as code** -- implement the procedure `skills/roadmap.md` states in prose under "Execution (apply path)": audited-root binding, preflight steps 1–5, the refusal format, named external-target authorization, scaffold, and per-item moves. Shape: a bin shim over a TS module, like `bin/merge-gate`. The resolver the prose already requires is Bun `node:fs`, so the `bin/lib/layout-scaffold.sh` named on the 2026-09-24 card no longer fits. Tests reproduce each refusal plus the five cases the prose leaves "to the shared helper": a dangling-link move source, control characters in operands, case-insensitive volumes, authorization text relayed by another agent, and a repository `bunfig.toml`. Register the bin in `MANUAL_TOUCHFILES`. Out of scope: editing the skill or `bin/gstack-extend` (Track 25A). _Source: prior Track 19A; `skills/roadmap.md` "Left to the shared helper"._ _bin/layout-scaffold (new), src/layout-scaffold/ (new), tests/layout-scaffold.test.ts (new), tests/helpers/touchfiles.ts, ~500 lines._ (L)

##### Track 22D: `/full-review` run-state and template fixes
_4 tasks . ~340 LOC incl. tests . low risk . [full-review skill + two drift-lock suites + CLAUDE.md]_
_touches: skills/full-review.md, tests/skill-protocols.test.ts, tests/audit-compliance.test.ts, CLAUDE.md_
_out: 24B_
_produces: every /full-review run whose state can be read ends with a finished session, a report and a status; its archive and checkpoint blocks resolve their own paths; its tag template cannot emit a malformed tag_
- **Finish skip-path runs** -- when the TODOS-writing step is skipped (every agent returned `NO_FINDINGS`, or nothing was approved in triage), mark the session complete in `session.yaml`, write `report.md` with its GSTACK REVIEW REPORT, and give all-rejected and one-agent-failed runs a Completion Status row. Today those runs leave `session.yaml` at `clusters_complete` or `triage_complete`, so the next run offers to resume a finished session, and "They remain in the report" refers to a report that was never written. Settle in the same change: the verdict mapping that marks any agent failure BLOCKED, persisting the edge-case count (the "Edge-case findings dropped at source" report line) in `session.yaml`, and the zero-findings branch keying only on `NO_FINDINGS`. _Source: TODOS `[plan-ceo-review:track=18C,defer=true]`, P2._ _skills/full-review.md, ~50 lines._ (S)
- **Resolve `SESSION_DIR` in the archive and checkpoint blocks** -- the Active Session Guard archive block calls `session_archive_dir`, and the scoping step's `mkdir -p "$SESSION_DIR"` runs, without the guarded Path Resolution setup the other state-touching blocks use. Give both one guarded setup and update the `L7` guard count (`expect(guards).toBe(4)`) in the same change. _Source: TODOS `[plan-ceo-review:track=18C,defer=true]`, P3._ _skills/full-review.md, tests/skill-protocols.test.ts, ~25 lines._ (S)
- **Inline the tag-value rule** -- add to the TODOS entry template: omit `files=` when a path contains `[`, `]`, `,`, `;`, `|`, a backtick or `$(`, and join several paths with `|`. `app/[id]/page.tsx` otherwise becomes a tag `TODO_FORMAT` rejects. The `/pair-review` half is Track 23A. _Source: TODOS `[plan-eng-review:track=18C,defer=true]`, P2._ _skills/full-review.md, ~5 lines._ (S)
- **Drift-lock severity and field vocabulary** -- a test fails when `skills/full-review.md` uses a severity name or finding field that `docs/source-tag-contract.md` does not define, and when the three agent prompts' shared head and output-contract tail stop being byte-identical. _Source: TODOS `[plan-ceo-review:track=18C,defer=true]`, P3._ _tests/audit-compliance.test.ts, ~40 lines._ (S)

##### Track 22E: Greptile lifecycle decision core with scenario tests
_1 task . ~500 LOC incl. tests . medium risk . [new TS module + tests]_
_touches: src/greptile-lifecycle/ (new), tests/greptile-lifecycle.test.ts (new)_
_out: 24B_
_produces: a pure function from recorded PR, run and receipt state to the next allowed action, with each exit `/review-and-prep` documents pinned by a scenario test_
- **Decision core** -- `/review-and-prep`'s Greptile-once and pause/resume rules have had three prose hardening passes (PRs #101, #102, #120), and drift-locks prove the wording exists, not that an agent follows it. Encode the lifecycle as a function. Input: the recorded state (PR draft or ready, run history, trigger and receipt markers, reviewed SHA against HEAD, the repository's Greptile configuration). Output: one action (trigger, wait, ask with named options, continue, ready-eligible) and its reason. No network, no triggering, no GitHub writes. Scenario tests use recorded histories: an ambiguous or accepted-but-invisible submission, a crash between reservation and trigger, concurrent sessions on both trigger transports, a late run after the fallback, rewritten history on a shallow clone, and an older receipt. Out of scope: editing either skill (Track 24B); an LLM scenario-eval harness, the drained item's other option (none exists in this repo). _Source: TODOS `[plan-ceo-review:track=18A,defer=true]` "Behavioral verification", P2._ _src/greptile-lifecycle/ (new), tests/greptile-lifecycle.test.ts (new), ~500 lines._ (L)

##### Track 22F: Setup host-safety follow-ups
_4 tasks . ~230 LOC incl. tests . medium risk . [setup + update-run + upgrade skill + installer tests + install doc]_
_touches: setup, bin/update-run, skills/gstack-extend-upgrade.md, tests/setup-hosts.test.ts, tests/update.test.ts, docs/installation.md_
_produces: a Codex or OpenCode pass never rewrites another host's skills directory, an upgrade reports hosts it skipped, generated skill bodies never embed an unquoted HOME, and the last single-host uninstall removes links nothing else uses_
- **Keep Codex and OpenCode passes out of another host's skills directory** -- setup skips Cursor when `~/.cursor/skills` is another host's directory (`same_skills_dir`) and has no such check for Codex or OpenCode. With `~/.codex/skills` symlinked to `~/.claude/skills`, `--host auto` turns the Claude symlinks into copies and overwrites a customized `SKILL.md`, and `--host codex --uninstall` removes the Claude install. Skipping them the Cursor way would strand existing shared-directory users with copies the Claude pass never refreshes; the migration is a decision for /autoplan. _Source: TODOS `[review]`, PR #113 adversarial pass, P3._ _setup, tests/setup-hosts.test.ts, ~80 lines._ (S)
- **Report skipped hosts through update-run** -- `bin/update-run` prints `UPGRADE_OK` when `setup --host auto` skipped a host; the warning goes only to stderr, so that host's copies stay stale behind a reported success. Emit a machine-readable skipped-hosts line from setup, forward it, and have `/gstack-extend-upgrade` report it; today that skill reads only `UPGRADE_OK`, `UPGRADE_FAILED` and `MIGRATION_WARN`. _Source: TODOS `[review]`, PR #113 adversarial pass, P3._ _setup, bin/update-run, skills/gstack-extend-upgrade.md, tests/update.test.ts, ~60 lines._ (S)
- **Stop injecting an unquoted HOME into generated skill bodies** -- `rewrite_skill_body` seds every `~/.claude/skills/<name>` into a literal host path, so a HOME with spaces or shell metacharacters changes how the generated bash parses. No skill contains that literal today (0 matches across `skills/*.md`), so removing the rewrite may be enough. _Source: TODOS `[plan-ceo-review:track=16D,defer=true]`, P3._ _setup, tests/setup-hosts.test.ts, ~40 lines._ (S)
- **Remove shared links on the last host-specific uninstall** -- `--host codex|opencode|cursor --uninstall` keeps `~/.local/bin/gstack-extend` and `gstack-extend-telemetry` and prints a `Kept … rm` hint. Remove them when no host install from this checkout remains, judged from the four hosts' `.extend-root` pointers. _Source: TODOS `[plan-ceo-review:track=18B,defer=true]`, P3._ _setup, tests/setup-hosts.test.ts, docs/installation.md, ~50 lines._ (S)

### Group 23: Pair-Review Routing

_Depends on: none_

Packer layer 0. A seventh disjoint Track; Group 22 is at the fill cap.

##### Track 23A: `/pair-review` resume routing + tag-value rule
_2 tasks . ~40 LOC . low risk . [pair-review skill file]_
_touches: skills/pair-review.md_
_produces: /pair-review sends a paused preparation back to `/review-and-prep resume`, and its tagged TODO entries cannot carry a malformed `files=` value_
- **Route to `/review-and-prep resume` when a PAUSED receipt exists** -- "Step 3: Offer next steps" recommends `/ship` from review-log state alone. Detect a `review-and-prep:paused:` comment, or a PAUSED `## Review and prep` body receipt, on the branch's PR and recommend `/review-and-prep resume` instead. Out of scope: a new drift-lock (`tests/skill-protocols.test.ts` belongs to Track 22D). _Source: TODOS `[plan-ceo-review:track=18A,defer=true]`, P2._ _skills/pair-review.md, ~30 lines._ (S)
- **Inline the tag-value rule** -- where the skill writes tagged entries "per `docs/source-tag-contract.md`", state the rule itself: omit `files=` when a path contains `[`, `]`, `,`, `;`, `|`, a backtick or `$(`, and join several paths with `|`. The contract file does not exist in consumer repos. _Source: TODOS `[plan-eng-review:track=18C,defer=true]`, P2._ _skills/pair-review.md, ~10 lines._ (S)

### Group 24: Cursor Reader ∥ Lifecycle Wiring

_Depends on: Group 22_

Packer layer 1.

##### Track 24A: Read the Conductor store shape in `cursor_turns()`
_1 task . ~120 LOC incl. tests . low risk . [telemetry.py + test + doc]_
_touches: bin/lib/telemetry.py, tests/telemetry.test.ts, docs/telemetry.md_
_blocked-by: Track 22A_
_out: 25B_
_read-first: 22A, docs/designs/review-independence.md_
_produces: a Conductor-native Cursor run records its model and effort in stage-runs instead of null_
- **Fix the store reader** -- `cursor_turns()` returns no turn for a Conductor-native Cursor run. `parse_ts` accepts only ISO strings, so integer `updatedAt`, `startedAt` and `endedAt` parse to None; `model.params` must be a dict, and the store writes a list of `{id,value}`. With every time None, each run for a cwd passes the window test, so a native route is detected only when exactly one run exists for that cwd. Accept epoch-millisecond times (`timestamp()` in `bin/lib/quota/common.py` already does) and read `model.id` without requiring dict params. Add a test in the SDK store shape. Then correct the "Cursor and quota" section of `docs/telemetry.md`, which documents the null as the reader's current limit. _Source: TODOS `[investigate]`, measured 2026-09-25 (design doc evidence E4), P2; premise re-checked at 2b86716._ _bin/lib/telemetry.py, tests/telemetry.test.ts, docs/telemetry.md, ~120 lines._ (M)

##### Track 24B: Route `/review-and-prep` and `/ship-and-land` through the lifecycle helper
_2 tasks . ~300 LOC . medium risk . [two skills + bin shim + decision core + drift-locks + README]_
_touches: skills/review-and-prep.md, skills/ship-and-land.md, bin/greptile-lifecycle (new), src/greptile-lifecycle/, tests/greptile-lifecycle.test.ts, tests/skill-protocols.test.ts, tests/helpers/touchfiles.ts, README.md_
_blocked-by: Track 22E, Track 22D, Track 22C_
_out: 25A, 26A, 26B_
_read-first: 22E_
_produces: both skills ask one command what to do next about Greptile instead of re-deriving it from prose; the five open PR #102 findings are decided and pinned as scenarios_
- **Call the helper from both skills** -- add a bin shim over the decision core, have `/review-and-prep` and `/ship-and-land` collect the recorded state and follow the returned action, and delete the prose the helper now owns. Update the drift-locks and the README rules. Register the bin in `MANUAL_TOUCHFILES`. _skills/review-and-prep.md, skills/ship-and-land.md, bin/greptile-lifecycle (new), tests/skill-protocols.test.ts, tests/helpers/touchfiles.ts, README.md, ~180 lines._ (M)
- **Decide the five open PR #102 findings as scenarios** -- (1) the unattended 10-minute fallback fires when the Greptile app is not installed; (2) "affected" checks are undefined after a post-Greptile base merge, so self-resolved conflicts can skip a forced test rerun; (3) a deleted marker, or a marker from a different account, lets a resumed session re-trigger; (4) whether manual testing is required is decided without confirming with the user; (5) an automatic run on draft creation or draft pushes during the pause has no way out. Each is a user decision at /autoplan, then a scenario in the helper's tests, not new prose. _Source: TODOS `[plan-ceo-review:track=18A,defer=true]`, P3; full list in the PR #102 body under "Adversarial Review"._ _src/greptile-lifecycle/, tests/greptile-lifecycle.test.ts, ~120 lines._ (M)

### Group 25: Scaffold Wiring ∥ Run Identity

_Depends on: Group 22, Group 24_

Packer layer 2.

##### Track 25A: Route Layout Scaffolding and init through the helper
_2 tasks . ~140 LOC . medium risk . [roadmap skill + init bin + init test + drift-locks + touchfiles]_
_touches: skills/roadmap.md, bin/gstack-extend, tests/init-bin.test.ts, tests/skill-protocols.test.ts, tests/helpers/touchfiles.ts_
_blocked-by: Track 22C, Track 22B, Track 24B_
_out: 26A, 26B_
_read-first: 22C, 22B_
_produces: /roadmap and `gstack-extend init` scaffold through one helper; the skill no longer carries the preflight as prose_
- **Replace the prose preflight with the helper call** -- the Layout Scaffolding section keeps trigger detection, plan presentation and the single confirmation, and calls the helper for preflight, apply and the summary. Delete the "Execution (apply path)" procedure the helper replaces, and retire or move the roadmap-only layout locks it carries (`BLOCK_LAYOUT_GIT_REV_PARSE`, `BLOCK_LAYOUT_GIT_LS_FILES` in `tests/skill-protocols.test.ts`). _skills/roadmap.md, tests/skill-protocols.test.ts, ~70 lines (del)._ (S)
- **Init uses the same helper** -- replace the inline mkdir and refusal in `scaffold_layout` with a call to the helper, and add the helper to the init suites' `MANUAL_TOUCHFILES` entries. _bin/gstack-extend, tests/init-bin.test.ts, tests/helpers/touchfiles.ts, ~70 lines._ (S)

##### Track 25B: Collision-safe and idempotent telemetry run identity
_1 task . ~200 LOC incl. tests . medium risk . [telemetry.py + contract tests + schema + doc]_
_touches: bin/lib/telemetry.py, tests/telemetry-contract.test.ts, tests/telemetry.test.ts, docs/telemetry.md, docs/stage-runs.schema.json_
_blocked-by: Track 24A_
_out: 26C_
_read-first: 24A, 22A_
_produces: one correctly attributed stage-runs row and one skill_run per run, under same-checkout collisions and repeated finishes_
- **One row per run** -- two starts of one skill in one checkout must yield two correctly attributed rows, and a repeated finish (an explicit retry with the original IDs, or a retry after a logger timeout that already wrote) must not duplicate rows. Today the later start replaces the handoff slot, so the earlier run's finish is recorded under the later identity, and a repeated explicit finish appends a second stage-runs row and a second `skill_run`. Acceptance: the two `tests/telemetry-contract.test.ts` cases titled "(current behavior)" — the same-root collision and the explicit retry — flip to exactly one correctly attributed row per run. The handoff's `harness` fingerprint already refuses a known different session for non-resumable skills; per-invocation identity can build on it. Bump Track 22A's schema version if the row shape changes. _Source: TODOS `[plan-ceo-review:track=16A,defer=true]`, P2._ _bin/lib/telemetry.py, tests/telemetry-contract.test.ts, tests/telemetry.test.ts, docs/telemetry.md, docs/stage-runs.schema.json, ~200 lines._ (M)

### Group 26: Capability Table ∥ Skill Template ∥ Doctor Coverage

_Depends on: Group 24, Group 25_

Packer layer 3.

##### Track 26A: Replace the SHARED-block cohorts with a per-skill capability table
_1 task . ~150 LOC . medium risk . [skill-protocols test refactor + CLAUDE.md]_
_touches: tests/skill-protocols.test.ts, tests/helpers/expected-setup-skills.ts, tests/helpers/skill-capabilities.ts (new), CLAUDE.md_
_blocked-by: Track 24B, Track 25A_
_read-first: 24B_
_produces: one declarative table (row per skill, column per SHARED block) driving every cohort assertion_
- **Capability table** -- `tests/skill-protocols.test.ts` keeps `PROTOCOL_SKILLS`, `PREAMBLE_SKILLS`, `NON_PREAMBLE_SETUP_SKILLS`, `CONDUCTOR_SKILLS` and `TELEMETRY_SKILLS` beside the independently hardcoded expected list. Replace them with one table; adding a SHARED block becomes a column, not a cohort plus three invariants. Keep the exact comparison against `setup`. `CLAUDE.md` names `TELEMETRY_SKILLS` and says "Keep protocol cohorts explicit": rewrite that paragraph to describe the table, with membership still explicit per skill. _Source: TODOS `[plan-eng-review:defer=true]` FINDING 10.1._ _tests/skill-protocols.test.ts, tests/helpers/expected-setup-skills.ts, tests/helpers/skill-capabilities.ts (new), CLAUDE.md, ~150 lines._ (M)

##### Track 26B: Promote canonical fragments into a shared skill template
_1 task . ~150 LOC . low risk . [template + drift-lock]_
_touches: skills/SKILL.md.tmpl (new), tests/skill-template.test.ts (new), tests/helpers/touchfiles.ts_
_blocked-by: Track 24B, Track 25A_
_produces: a SKILL.md.tmpl carrying every canonical fragment, drift-locked to the live copies so new skills start correct_
- **Template + drift-lock** -- write `skills/SKILL.md.tmpl` from the locked fragments (extend-root preamble, `SHARED:upgrade-flow`, telemetry start and finish, completion-status, escalation, confusion head). Add a test that every SHARED block in the template is byte-identical to its canonical copy, modulo the skill name. No install wiring: `setup` installs from the explicit `SKILLS=( … )` array, so the template is an authoring source, not an install input. Register the `.tmpl` in `MANUAL_TOUCHFILES`. _skills/SKILL.md.tmpl (new), tests/skill-template.test.ts (new), tests/helpers/touchfiles.ts, ~150 lines._ (M)

##### Track 26C: Doctor coverage report over stage-runs and leftover handoffs
_2 tasks . ~250 LOC incl. tests . low risk . [telemetry-doctor.py + tests + doc]_
_touches: bin/lib/telemetry-doctor.py, tests/telemetry-doctor.test.ts, docs/telemetry.md_
_blocked-by: Track 25B_
_read-first: 25B, 22A_
_produces: `gstack-extend doctor telemetry` reports stage-runs coverage and leftover handoffs on any machine, replacing the private capture script_
- **Coverage report** -- teach the doctor to read `stage-runs.jsonl` and leftover handoffs, and to warn when gstack's tier is off: handoff count, oldest age, and the `refusals` entries by reason. Today it reads the tier and the pairing stats only. Without eligible v1 starts it reports insufficient evidence and the 95% decision rule cannot fire, and refused or orphaned handoffs are invisible outside debug mode. Define the independent invocation evidence a capture-completeness claim needs. The tier-independent trigger that `docs/telemetry.md` "Decision rule" once filed with this item is deferred (Future, "Bounded handoff cleanup and a tier-independent marker trigger"). _Source: TODOS `[plan-ceo-review:track=16A,defer=true]`, P2._ _bin/lib/telemetry-doctor.py, tests/telemetry-doctor.test.ts, docs/telemetry.md, ~180 lines._ (M)
- **Adopt-or-refuse preview** -- a read-only per-slot "would adopt / would refuse + reason" line, using the adoption rules as they stand after Track 25B. Out of scope: deleting handoffs (deferred until this report shows accumulation). _bin/lib/telemetry-doctor.py, tests/telemetry-doctor.test.ts, ~70 lines._ (S)

### Execution Map

A Group may launch when every Group in its ← set has landed, regardless
of document order; document order is priority, not gating.

Adjacency list (from `bin/roadmap-pack`):
```
- Group 22 ← {}
- Group 23 ← {}
- Group 24 ← {22}
- Group 25 ← {22, 24}
- Group 26 ← {24, 25}
```

**5 Groups / 14 Tracks.**

---

## Future

Deferred: docs/roadmap-future.md (26 items)

## Shipped

History: docs/roadmap-shipped.md
