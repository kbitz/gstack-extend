# Changelog

All notable changes to this project will be documented in this file.

## [0.16.0] - 2026-04-24

### Added
- **`setup --skills-dir <path>` flag.** Install skill symlinks into a custom directory instead of the default `~/.claude/skills/`. Enables per-project installs for users who want gstack-extend's skills scoped to a single project rather than globally. `setup --skills-dir ./project/.claude/skills` installs there; `setup --skills-dir ./project/.claude/skills --uninstall` removes from there. Flag order is flexible (`--uninstall --skills-dir` also works).
- **15 new test assertions in `scripts/test-update.sh`** (59 total, was 44): custom-dir install produces correct symlinks (2 asserts), defense-in-depth check that `--skills-dir` does NOT touch the default dir, `--skills-dir` with no value is rejected with non-zero exit (2 asserts), `--skills-dir <flag-like-value>` (e.g. `--skills-dir --uninstall`) is rejected cleanly, `--skills-dir` relative path is rejected, known-limitation warning fires on custom dir and NOT on default (2 asserts), `--skills-dir` + `--uninstall` cleans the custom dir (2 asserts) and removes ALL 5 skills (not just pair-review), reversed flag order works, and `--skills-dir` with a path containing spaces installs correctly (2 asserts).
- **Arg parsing hardening:** `--skills-dir` now rejects (a) missing values, (b) values starting with `-` (catches `setup --skills-dir --uninstall` and similar typos that would otherwise try `mkdir -p --uninstall` and fail noisily), and (c) relative paths (`./foo`, `bar/baz`) because they resolve against the invocation cwd and would make `setup --skills-dir` install-here / uninstall-elsewhere pairs silently diverge. Arg loop uses `while [ $# -gt 0 ]` so an empty-string `$1` doesn't short-circuit parsing. New tests lock these in under a mocked `$HOME` so a parse regression cannot touch the real `~/.claude/skills`.
- **Known-limitation warning.** When `--skills-dir` != default, `setup` prints a stderr warning explaining that skill preambles still hardcode `~/.claude/skills/{name}/SKILL.md` for helper resolution (v0.16.0 scope). The install itself succeeds; the warning tells users that `update-check`, `config`, and `audit` calls in the preambles will silently no-op until Pre-flight 2 lands. Prevents the "I installed but nothing works" silent-success surprise.
- **DRY cleanup in `setup`:** usage string extracted to a single `USAGE` constant, referenced from both error branches.

### Known limitation (addressed in Pre-flight 2, next PR)
Skill preambles still hardcode `readlink ~/.claude/skills/{name}/SKILL.md` to recover `$_EXTEND_ROOT`. Installs to a non-default `--skills-dir` path produce working symlinks but the preamble path-resolution silently fails (`_EXTEND_ROOT` empty, `$_EXTEND_ROOT/bin/...` calls no-op). Pre-flight 2 of Group 1 ships the probe-pattern fix. Until then, `--skills-dir` is the foundation but not the complete per-project install feature.

First PR of Group 1 Install Pipeline per `docs/ROADMAP.md`. Locked order: 1 (this PR) → 2 → Track 1A → 3 → 4.

## [0.15.2] - 2026-04-25

### Added
- **Drift-proof shared graft enforcement.** `scripts/test-skill-protocols.sh` now asserts that four cross-skill protocol fragments (Completion Status Protocol enum, Escalation opener, Escalation format, Confusion Protocol head) are byte-identical across all 5 skills. Edits become a deliberate two-step: change canonical text in the test script, watch tests fail, propagate to all 5. Test suite grows from 102 to 122 assertions. Drift detection verified via manual mutation against one skill.
- **`<!-- SHARED:<block-name> -->` HTML marker system.** 40 marker pairs (4 per skill × 5 skills) bracket the shared graft fragments. Invisible to LLMs reading the prose; explicit signal to humans maintaining shared content. Pre-stages the deferred `SKILL.md.tmpl` TODO for trivial mechanical extraction later.

### Changed
- **`/full-review`: removed redundant `## Error Handling` section** (-36 lines). All 8 sub-entries (agent timeout/failure, malformed agent output, missing TODOS.md, missing ROADMAP.md, session interrupted, empty results, git not available, clean working tree at commit) verified inline-covered in their respective Phases. Summary pointer section wasn't adding signal on sequential read.
- **`/review-apparatus`: removed redundant "Ambiguity rule" subsection.** It was a pointer to the Patterns section immediately below, which already covers the named patterns (Ask-why-on-ambiguity, Duplicate-TODOS handling, Skip-gap-when-no-cheap-answer) with specifics.
- **`/pair-review`: removed redundant State path restatements** in the Paths section (the intro paragraph already states the single source of truth); fixed a duplicate `---` separator before Error Handling.
- **`/roadmap`: removed redundant footer restatement of subcommand auto-detect behavior** (the first bullet of Subcommands already covers it).
- **`/test-plan`: fixed duplicate `groups/` heading** in the workspace-scoped state diagram (was visually confusing as two parallel directories).
- **`docs/TODOS.md`: rebalanced Codex host + Skill-file simplification TODOs** per `/plan-ceo-review` + `/plan-eng-review` decisions (2026-04-24). Codex-specific gates (description ≤ 1024 chars, env-var preamble pattern) moved back to the Codex host TODO where they belong. Simplification TODO codified scope discipline (only obvious dups), shared-fragment canonicalization strategy, execution order (Lane A serial then Lanes B-F parallel), and regression-surface trade explicitly accepted.

Scope discipline per /plan-eng-review: only literally duplicated content removed. Prose rewrites for style/concision on non-duplicated content, consolidation of distinct-but-similar sections, and cross-skill JSON contract consolidation explicitly deferred. Net change -11 lines; real value is the 20 new verbatim-block assertions that make future simplification and the deferred `SKILL.md.tmpl` work mechanical.

## [0.15.1] - 2026-04-24

### Added
- **Source-tag contract.** New `docs/source-tag-contract.md` defines the canonical schema for TODOS.md entries: `### [source:key=val] Title` heading + attribute child bullets. Source-default routing matrix, severity taxonomy, dedup semantics, and validator behavior all specified. Every producer skill references this doc; the audit validates against it.
- **`bin/lib/source-tag.sh`** — shared bash library with `parse_source_tag`, `normalize_title`, `compute_dedup_hash`, `validate_tag_expression`, `extract_tag_from_heading`, `extract_title_from_heading`. Pure string transforms, no side effects. Sourced by `bin/roadmap-audit`.
- **`## IN_FLIGHT_GROUPS` audit section.** Topo-sorts Groups against the DAG: Groups whose deps are all `✓ Complete` AND have at least one incomplete Track are in-flight. Emits the full list plus a PRIMARY (first by doc order — tiebreaker). Replaces the "first incomplete Group in doc order" approximation that was wrong on DAG roadmaps.
- **`## ORIGIN_STATS` audit section.** Per-Group counts of open origin-tagged items in `## Unprocessed` (`[pair-review:group=N,...]`, `[test-plan:group=N,...]`). Feeds the closure debt dashboard in `/roadmap` Step 1.
- **`## TODO_FORMAT` audit section.** Validates every Unprocessed entry against the source-tag contract. Emits `MALFORMED_HEADING` for legacy bullet entries, `UNKNOWN_SOURCE` for unregistered sources, `MALFORMED_TAG` for grammar violations, `INJECTION_ATTEMPT` for dangerous chars. `STATUS: fail` blocks triage.
- **Closure debt dashboard in `/roadmap` Step 1.** Top-of-output rendering of `IN_FLIGHT_GROUPS` + `ORIGIN_STATS` per in-flight Group. Makes deferred bug debt visible every run.
- **Auto-suggest closure walk.** When the dashboard shows 1+ open-origin items on an in-flight Group, `/roadmap` prompts "walk through these first?" before general triage. Integrated into the existing flow — not a subcommand.
- **Source-aware scrutiny gate in `/roadmap` Step 2a.** Now runs in triage/update modes too (previously overhaul-only). Per-source default recommendations drive keep/kill defaults: full-review:edge-case → SUGGEST KILL, full-review:nice-to-have → PROMPT, observed-bug sources → KEEP. Inverts CC's "add to backlog" reflex.
- **Closure bias in Step 3b/3c.** Origin-tagged items route back to the Group that surfaced them (`[pair-review:group=N]` → Group N). File-overlap heuristic is a secondary signal, not primary. Origin tag wins — writer's explicit statement of where the bug belongs.
- **Reopen rule.** Origin-tagged bug arrives for a `✓ Complete` Group: smart-default PROMPT based on severity + file overlap + bug age. IF critical → hotfix-for-Group-N; ELSE IF files overlap active Group's `_touches:_` → fold into active; ELSE → defer to Future.
- **Dedup pre-pass in Step 2a.** `hash(normalize_title(title))` groups identical bugs from different sources. Cross-source duplicates collapse to one item. Source tag preserved on the kept entry; log at `.context/roadmap/dedupe-log.jsonl` captures dropped source for traceability. User confirms every dedup.
- **Severity taxonomy in `/full-review`.** `critical | necessary | nice-to-have | edge-case` replaces `critical | important | minor`. Edge-case findings are DROPPED at source in Phase 2 — never written to TODOS.md. Triage prompt includes "Approve + reclassify severity" option for fine-tuning before persistence.
- **Defer nudge in `/pair-review`.** When a parked bug's "Send to TODOS.md" option fires, the prompt reframes toward closure: "Fix now keeps the Group closure tight. Defer only if it's truly cross-branch." "Fix now" listed first, default tilts toward on-branch resolution.
- **`scripts/test-source-tag.sh`** — 33-assertion unit test suite for the parser library. Grammar, normalization, dedup hash stability, validator reason codes, heading extractors.
- **19 new test cases in `scripts/test-roadmap-audit.sh`** (160 total, was 141): `complete_groups` (heading-embedded `✓ Complete` detection, `_GROUP_NAMES` stripping, TASK_LIST `complete=0|1` flag, chain topology), `in_flight_topo` (DAG runnable Groups, doc-order tiebreaker, blocked-by-incomplete-dep exclusion, empty-roadmap skip), `origin_stats` (numeric-group filter, per-group counts, missing-TODOS skip), `todo_format` (rich-format pass, legacy-bullet fail, unknown-source fail, injection reject, untagged permissiveness).

### Changed
- **Stable Group IDs — no renumbering on completion.** Previously `skills/roadmap.md:797-811` said "remove the Group and renumber subsequent groups." This is REVERSED. Completed Groups stay in place, marked `## Group N: Name ✓ Complete` in the heading (bolt pattern). Renumbering only at explicit canonical reset points (documented in ROADMAP.md header). Load-bearing for origin tags: `[pair-review:group=2,item=5]` must resolve to the same Group forever.
- **Audit excludes `✓ Complete` Groups from active counts.** `STRUCTURAL_FITNESS`, `IN_FLIGHT_GROUPS`, `ORIGIN_STATS` all filter out complete Groups. `TASK_LIST` keeps them as ground truth (for reorg rebuilds) with a new `complete=1` flag on every task; consumers decide whether to filter. Prevents reorg from silently dropping historical Groups.
- **`/roadmap` Execution Order section.** New top-level diagram in `skills/roadmap.md` documenting the step sequence for each mode. Critical triage/update ordering: Step 1 → Step 1.5 → Step 3.5 (freshness scan) → Step 2a (scrutiny) → Step 2b → Step 3 → Step 4. Freshness scan runs BEFORE scrutiny so stale items get cleaned before keep/kill prompts.
- **`check_unprocessed` counts `### ` heading entries, not `- ` bullets.** Previously counted child bullets as items (reporting 16 items in a 5-entry TODOS.md). Legacy bullet entries are now flagged by `TODO_FORMAT` as `MALFORMED_HEADING`; rewrites required. No bullet-format items currently exist in this repo (migrate-now policy).
- **`/pair-review` and `/test-plan` parked-bug writes use rich format with origin metadata.** `### [pair-review:group=<group-slug>,item=<item-index>] Title` + child bullets. The `group=<group-slug>` origin lets `/roadmap`'s closure bias fold bugs back into the Group that surfaced them. `group=pre-test` for bugs parked before testing begins.
- **`/full-review` and `/review-apparatus` writers emit rich format.** Single-line bullet entries replaced with `### [tag] Title` + Why/Effort/Context/Proposed fix child bullets. `/full-review` optionally embeds `files=<path>` in the tag when clustering preserves single-file routing.
- **`bin/roadmap-audit` sources `bin/lib/source-tag.sh`.** Canonical parser available to all checks; DRY'd out 6+ open-coded regex duplications across audit consumers.

### Why

CC-driven roadmapping defaulted to "add to backlog" — full-review findings landed as esoteric TODOs that never got scrutinized, pair-review bugs sent to TODOS.md lost their Group-of-origin context, and in-flight Groups shipped without the bugs they themselves surfaced getting fixed. This release inverts the default: scrutiny is a required gate in every triage, origin metadata preserves Group context across handoffs, the closure dashboard makes deferred debt visible every run, and Group IDs stay stable forever so origin tags don't rot. `/plan-ceo-review` produced 11 baseline + 4 expansion scope items, `/plan-eng-review` + two rounds of Codex outside-voice review surfaced 10 additional architectural gaps (TODOS.md format parser bug, DAG-aware in-flight topology, cross-source dedup, reopen semantics, blast radius spanning review-apparatus + test-plan writers, stale-Group-number hazard) that all folded into scope. 443 test assertions passing across 6 suites (source-tag 33, roadmap-audit 160, test-plan-e2e 43, skill-protocols 102, update 44, test-plan 61). Migration is a no-op on this repo — all 5 existing TODOS.md entries are already in rich format.

## [0.15.0] - 2026-04-21

### Added
- `/test-plan` — new skill. Group-scoped batched test-plan generator that composes with `/pair-review` as the execution engine, not a replacement. When you bug-bash a Group (1-4 Tracks landing together), you type `/test-plan run <group>`, and the skill harvests every CEO/eng/design review doc you ran during Track scoping, auto-detects any per-Track `/pair-review` artifacts (so you don't re-test what you already tested), extracts testable claims via an LLM prompt with a strict JSON contract, classifies automated/manual via a conservative heuristic (ambiguous defaults to manual), writes a `-test-plan-batch-*.md` file to `~/.gstack/projects/<slug>/` that `/qa-only` auto-picks-up as test-plan context, populates `.context/pair-review/session.yaml` with `plan_source: test-plan` and `groups/<group>.md` with curated manual items, archives any prior groups file on re-run (strict handoff, no merge), and drops into `/pair-review`'s Phase 2 execution loop. The bug-bash runs against ONE integrated build — the current branch/commit — not cross-branch; Track branches are provenance-only in the plan. v1 subcommands: `run` and `status`. Deferred to v2: `seed` (forward-plan cache), `retro` (post-bug-bash plan critique), per-item LLM automation.
- **Per-Track pair-review consumption (5 categories).** Phase 4 of `run` scans `.context/pair-review/` and archived `.context/pair-review-archived-*` dirs for any session matching a Track branch in the Group's manifest. **Skip** items marked PASSED (no retest). **Surface for user decision** items marked SKIPPED. **Surface as "Known Deferred"** items with Status: DEFERRED_TO_TODOS (not ignored — bugs already judged important to route). **Carry forward** items with Status: PARKED. **Flag as regression candidate ONLY** FAILED+FIXED items when the integrated build differs from the verified build (integrated build has other Track commits landed after the fix, or overlapping file changes) — not blunt re-addition.
- **Explicit Group→branch manifest.** First `/test-plan run` on a Group prompts the user for each Track's branch name (with best-guess inference from `git branch --all` against Track-name slugs), writes `~/.gstack/projects/<slug>/groups/<group-slug>/manifest.yaml` (schema 1), and reads the manifest on every subsequent invocation. Eliminates the "invented Group-to-branch mapping" issue — mapping is a load-bearing artifact, not guesswork.
- **Stable item IDs.** Deterministic sha256 of `<branch>|<source_doc_path>|<section_heading>|<normalized_description>`, truncated to 8 hex chars. Unblocks v2 retro (diff plan vs outcomes), makes re-run behavior debuggable, enables cross-session dedup. Embedded as `<!-- test-plan-id: <id> -->` comments under each item in `groups/<g>.md` so `/pair-review` preserves them for future retro.
- **Artifact file-format contract.** New `docs/designs/test-plan-artifact-contract.md` owns the spec: path conventions (`<user>-<branch>-test-plan-batch-<ts>.md` for batch plans matching `/qa-only`'s existing discovery glob; distinguished from `-eng-review-test-plan-` artifacts by subtype token), front-matter schema (required fields: schema, name, group, group_title, generated, generated_by, build_branch, build_commit, manifest, stats), 10 required section order, item-entry format (`[id] [tags...] <description>`), provenance tag taxonomy (7 canonical tags: `[from diff]`, `[from ceo-review: <file>]`, `[from eng-review: <file>]`, `[from design-review: <file>]`, `[from design-doc: <file>]`, `[from parked-bug: <branch>]`, `[retest-after-fix]`, `[regression-candidate]`), provenance index table spec, and consumer contracts for `/qa-only` (passive) and `/pair-review` (active). Schema version 1 introduced. Upstream skills follow THIS contract; breaking changes bump schema.
- **`scripts/test-test-plan.sh`** — 58-assertion deterministic bash harness. Tests: slugify pipeline (6 assertions across realistic Group titles), stable item IDs (determinism, case + whitespace normalization, branch-variance, doc-path-variance, diff-item determinism), path construction (batch file matches `/qa-only` glob, manifest canonical shape, disambiguation from eng-review artifacts), archive behavior (preserves old content, fresh file replaces, multiple generations coexist), state-write failure guard (per /plan-eng-review failure mode #4: write to read-only dir fails cleanly + skill documents the guard), classification heuristic table coverage (8 automated signals + 6 manual signals + conservative-default rule), subcommand contract (run + status documented; seed + retro explicitly marked v2), provenance tag taxonomy (contract doc exists and declares all 8 tags), consume-category coverage (all 5 in Phase 4 + refinements), single-deploy-target guard (Phase 0 integrated-build confirmation documented).
- **`scripts/test-test-plan-extractor.sh`** — 21-assertion contract test + golden-set scoring harness. Contract check: required output fields (description, source_type, rationale_quote, section_heading, classification_signal), required source_types (ceo-review, eng-review, design-review, design-doc), required extraction rules (extract-every-claim, testable, rationale-verbatim, no-intra-doc-duplicates, JSON-only output), retry-on-invalid-JSON, worked example. Golden-set: 2 real gstack-extend design docs with 10 hand-labeled expected items (fuzzy keyword sets). Scoring subcommand (`--score <json>`) accepts an actual extractor-output JSON produced in a live Claude session, keyword-matches each expected item at ≥50% keyword presence, passes at ≥70% overall match. `--list-fixtures` subcommand documents the workflow. Non-blocking in contract mode if fixtures are missing (golden-set only needed for `--score`).
- **`scripts/test-test-plan-e2e.sh`** — 43-assertion end-to-end integration test. Stands up a full fixture scenario: git-init'd repo with `docs/ROADMAP.md` containing Group + 3 Tracks (including a bug-bash Track), 3 fixture review docs in a mock `~/.gstack/projects/<slug>/` project store spanning ceo-plan, eng-review, and design-review subtypes, 1 in-repo `docs/designs/widget-api.md`, and a full `.context/pair-review-archived-<ts>/` directory containing a prior session for one Track branch with all 5 status categories represented (PASSED, FAILED, SKIPPED, FAILED+FIXED, PARKED + DEFERRED_TO_TODOS in parked-bugs.md). Exercises: ROADMAP parsing, Group slugification to `widget-pipeline`, review-doc discovery per Track branch with intra-Track dedup, manifest.yaml write + shape, prior-pair-review consumption across all 5 categories with branch-filter correctness (wrong-branch yields zero leakage), Phase 7 archive-then-write with canonical item-ID comment format, Phase 6 batch-plan write with all required front-matter fields + all 9 required sections (one `_none_` variant exercised), `/qa-only` glob compatibility (discovered via `*-test-plan-*.md`), TODOS.md Unprocessed append preserving existing entries, idempotence under re-run with timestamp separation, session.yaml handoff marker.
- **Plumbing.** `setup` registers `test-plan` alongside the other 4 skills. `scripts/test-skill-protocols.sh` extended from 4 to 5 skills (asserts all required protocol sections present: Completion Status Protocol, Escalation format, Confusion Protocol, GSTACK REVIEW REPORT with first-column header). `scripts/test-update.sh` asserts "Installed 5 skills" + a new symlink check for `test-plan`. CLAUDE.md skill routing rule added: "Batch test a Group, 'bug bash', 'test this release', 'plan the bug bash' → invoke test-plan with args 'run &lt;group&gt;'". README gains a table entry ("`/test-plan` — Group-scoped batched test plan (composes with /pair-review) — New") and a full skill section documenting subcommands, file format, and the updated documentation taxonomy row.

### Why
Running `/pair-review` on every single PR is tedious and produces redundant testing — the same flows get walked through on every diff. The user had a productive pair-review session that tested a coherent portion of the app in logical order and surfaced 10-20 bugs and TODOs; the goal of v0.15 is to make that shape a primitive. `/test-plan` is the composition skill that takes Group-level batching (aligns with how work is actually organized in ROADMAP.md) and hands off to the proven `/pair-review` execution engine. The 10x unlock is review-doc harvesting: CEO/eng/design reviews already ran during Track scoping, and turning their decisions into tagged test items means the bug-bash verifies "the things we explicitly cared about" instead of "whatever the human remembers to click." Design doc went through /office-hours (scope, review enrichment, runtime model, hybrid timing) and /plan-eng-review (5 Claude architecture issues, 3 code-quality issues, 28 test gaps → full v1 coverage, 0 perf issues, 11 Codex outside-voice findings with 6 substantive tensions resolved). Codex caught three architectural gaps the Claude review missed: cross-branch execution (pair-review is single-branch; v1 now enforces ONE integrated build), Group→branch mapping was invented (now explicit manifest), item identity was missing (now stable 8-char sha256 IDs). v1 surface cut from 4 subcommands to 2 after Codex flagged `seed` as speculative cache and `retro` as requiring identity work. User-initiated upgrade on test coverage: original recommendation was "defer E2E to v2"; user pushed back, boiled the lake — full v1 coverage (bash + extractor golden-set + E2E, 122 total assertions across three harnesses).

## [0.14.0] - 2026-04-20

### Added
- `/roadmap` supports optional **Group-level `_Depends on:_`** annotations so projects with parallel workstreams can express a DAG instead of a single linear chain. Syntax: `_Depends on: Group 9 (Core App Ready), Group 10_` on the italic line immediately after a Group heading. Default (no annotation) = depends on the immediately preceding Group — backward compatible, every existing roadmap still validates. `_Depends on: none_` (or `—`) marks a Group as parallel-safe with no deps.
- New **`## GROUP_DEPS` audit section** in `bin/roadmap-audit`. Parses annotations, builds the DAG, runs Kahn's cycle detection, validates forward references, and emits **`STALE_DEPS` warn** when a name-anchored ref (`Group N (Name)`) has drifted from the current heading. Always emits a topologically-ordered adjacency list (`- Group 13 ← {9, 12}`) regardless of STATUS — this is the useful artifact.
- New **`STYLE_LINT` rule: redundant backwards-adjacent deps** warns when an explicit `Depends on: Group N` duplicates the implicit default (preceding Group). Keeps annotations semantically meaningful.
- 18 new test cases in `scripts/test-roadmap-audit.sh`: default linear chain, explicit `none`, em-dash as none, single/multi-ref, name-anchor match/drift, cycle detection, forward-ref failure, redundant-backwards-adjacent warn, non-redundant ref, backward compat with no annotations, adjacency list always-emitted, empty roadmap skip, own ROADMAP.md regression, Group 1 alone, implicit-default cycle, name-anchor with spaces. 141 tests total (123 existing + 18 new), 0 failures.

### Changed
- `skills/roadmap.md` **Rule 1 reframed**: "A Group is a wave of PRs that land together — parallel-safe within, **dependency-ordered** between." Default remains single linear chain; the DAG is opt-in via annotation.
- New **Rule 3a** documents Group-level `_Depends on:_` syntax, defaults, name anchoring, and the redundant-annotation lint.
- Output Template updated: Execution Map leads with the **adjacency list** (the always-useful artifact) and keeps the track-detail tree below.
- **Step 3.5d (renumber pass)** extended: when a Group is deleted, all Group-level `_Depends on: Group N_` references must be updated (and name anchors refreshed to the renumbered Group's current heading). Explicitly called out as a "boringly thorough" guarantee — the renumber pass is the structural replacement for a concurrent-edit orchestration guard (single-writer architecture + thorough renumber = downstream readers always see consistent numeric refs).
- `Interpreting audit findings` in `skills/roadmap.md` gains entries for the new `GROUP_DEPS: fail/warn` statuses and the new redundant-backwards-adjacent `STYLE_LINT` warning.

### Why
The design plan assumed a single linear chain of Groups. Real case from Bolt v0.9.22.x: a CLI workstream (MCP server reading read-only SQLite) needs to run parallel with ongoing Swift-side core-app work — the CLI's Layer 1 has zero file overlap with current Groups, and Layers 2-3 depend on a later core-app Group. The only current escape hatch was two ROADMAP files, splitting `/roadmap` drainage and PROGRESS.md tracking. Group-level deps let one ROADMAP.md express the DAG cleanly. Scope converged after a codex outside-voice review: **rejected** Streams as a first-class primitive (premature with sample size of 1 project), **rejected** `/pair-review --stream/--groups` flag (pair-review's "groups" are an unrelated test-session concept — naming collision), **rejected** swim-lane ASCII Execution Map render (the adjacency list carries all the information without the failure surface). **Kept** name-anchored refs (user's explicit judgment: rename safety worth the churn). See `~/.gstack/projects/kbitz-gstack-extend/ceo-plans/2026-04-20-roadmap-group-deps.md` for the full decision trail.

## [0.13.0] - 2026-04-18

### Added
- `/review-apparatus` — new skill that audits a project's testing and debugging apparatus. Reads existing scripts, `bin/` tools, Makefile targets, dev endpoints, logging, staging configs, and test infra. Proposes lightweight bolt-on additions where a small helper would make CC-assisted verification or debugging materially easier. Approved proposals land in `docs/TODOS.md` as `[review-apparatus]` items for `/roadmap` to organize.
- `/roadmap` source-tag signal list now includes `[review-apparatus]` with classification guidance (tooling proposals classify by which code area they support, or form a platform/tooling track when several accumulate). `[review-apparatus]` added to the canonical provenance tag list alongside `[pair-review]`, `[manual]`, `[investigate]`, `[full-review]`, `[discovered:<filepath>]`.
- `scripts/test-skill-protocols.sh` extended to cover the new skill (62 → 82 assertions). Each of the four skills must now contain all three protocol sections plus the REPORT table.
- `scripts/test-update.sh` extended with a symlink check for `review-apparatus` and updated `Installed 3 skills` → `Installed 4 skills` assertion.
- README updated with a `/review-apparatus` table entry and a full skill section describing the audit + proposal flow.

### Why
The concrete itch came from Bolt: during manual testing of email compose/send/store, the user wants CC to verify that the editor HTML, the sent payload, and the stored row all match. That is not work pair-review can do today, because the projects being tested lack the dev-time hooks CC would need (direct DB access, last-sent readers, editor HTML dumps). The load-bearing reframe: most projects don't have the apparatus that would let ANY gstack skill do CC-assisted verification. /review-apparatus fills the producer side of that equation. pair-review, /qa, /investigate, and /full-review will pick up the apparatus organically once it exists in a project. How they discover and invoke it is a future, separate design. Design doc: `~/.gstack/projects/kbitz-gstack-extend/kb-kbitz-pair-review-assist-design-20260418-113742.md`.

## [0.12.0] - 2026-04-18

### Added
- GSTACK REVIEW REPORT table rendering in `/pair-review`, `/roadmap`, and `/full-review`. Each skill now leads its end-of-run output with a dashboard table (Review/Group | Trigger | Why | Runs | Status | Findings) plus a one-line verdict mapped from the Completion Status Protocol enum.
- `/full-review` prepends the table to the top of `.context/full-review/report.md` and emits it in the chat response. Narrative clusters stay below.
- `/roadmap` leads every run's summary with the table, above the deterministic audit sections (`## MODE`, `## VOCAB_LINT`, etc.). Table counts blockers vs advisories from the audit output.
- `/pair-review` emits a per-group mini-table at each group checkpoint (single-row rollup of that group's state) AND a session-done rollup with one row per group. The per-group table keeps the Conductor action-receipt pattern clean; the rollup is the final dashboard.
- `scripts/test-skill-protocols.sh` extended from 36 to 62 assertions: each skill must contain the REPORT table template, column headers (Trigger/Why/Runs/Status/Findings plus either Review or Group as first column), and the VERDICT line. pair-review additionally verified for both per-group and session-done templates.

### Why
Third and final PR in the gstack-parity sequence. Closes the "feels different from gstack" gap: every skill now surfaces a predictable dashboard at its most visible output point, plus a verdict line driven by the same status enum introduced in v0.11. Three PRs, zero behavior change to the skills' main flows, ~600 lines total added across skills + tests. See `~/.gstack/projects/kbitz-gstack-extend/kb-kbitz-gstack-patterns-design-20260418-105937.md`.

## [0.11.0] - 2026-04-18

### Added
- Completion Status Protocol grafted into `/pair-review`, `/roadmap`, and `/full-review`. Every session now rolls up to one of `DONE` / `DONE_WITH_CONCERNS` / `BLOCKED` / `NEEDS_CONTEXT` with per-skill rollup rules (pair-review maps per-item states, roadmap maps audit findings, full-review maps agent outcomes + phase state).
- Escalation format block in each skill. 3-attempt rule, security gate, scope-exceeds-verification gate. Standard STATUS/REASON/ATTEMPTED/RECOMMENDATION shape.
- Confusion Protocol block in each skill. Stop-and-ask gate for high-stakes ambiguity, with per-skill example ambiguities (e.g., pair-review "reset" scope; roadmap PARALLEL collision merge; full-review cluster framing).
- `scripts/test-skill-protocols.sh`: 36 grep-based assertions across the three skills. Verifies each contains Completion Status Protocol, Escalation subsection, Confusion Protocol, all four status tokens, and all four escalation fields.

### Why
Second PR in the gstack-parity sequence. Before this, extend's three skills each used ad-hoc phase vocabulary for session state and had no standard escalation or ambiguity gate. That is the "feels different from gstack" friction. These three sections close most of it in one diff, without touching behavior. Same verbatim pattern as gstack core, adapted per-skill for the rollup rules. See `~/.gstack/projects/kbitz-gstack-extend/kb-kbitz-gstack-patterns-design-20260418-105937.md`.

## [0.10.0] - 2026-04-18

### Removed
- `/browse-native` skill and all supporting infrastructure. The beta never left beta, had zero known active users, and carried ongoing maintenance overhead (22KB implementation guide, inside-out debug pattern, three validation gates) for no shipping value. Deleted `skills/browse-native.md`, `docs/debug-infrastructure-guide.md`, and `scripts/validate.sh` (which only ran the browse-native gates).
- `--with-native` flag from `setup`. Rejected as an unknown option now. `setup --uninstall` still iterates legacy `browse-native` symlinks for a clean upgrade path from pre-0.10.0 installs (removes its own symlinks, preserves foreign ones).

### Changed
- `README.md` skill table shrunk to the three shipping skills (`/pair-review`, `/roadmap`, `/full-review`). Beta skills section and the full `/browse-native` section removed.
- `CLAUDE.md` testing line switched from the now-deleted `validate.sh` to the generic `scripts/test-*.sh` pattern.
- `scripts/test-update.sh` now asserts `browse-native` is NOT installed, `--with-native` is rejected, and uninstall leaves foreign `browse-native` symlinks alone (the cleanup path for legitimate pre-0.10 symlinks is preserved in code but not positively tested, since constructing that state post-deletion would defeat PR 1).

### Why
First step in a three-PR sequence that grafts gstack's consistency patterns (Completion Status Protocol, Confusion Protocol, GSTACK REVIEW REPORT table) into extend's three daily-use skills. Dropping an unused beta keeps the parity work scoped and maintenance-free. See `~/.gstack/projects/kbitz-gstack-extend/kb-kbitz-gstack-patterns-design-20260418-105937.md` for the full design + eng review (7 issues resolved, 3/3 Lake Score).

## [0.9.0] - 2026-04-18

### Added
- `/roadmap` now enforces per-Track size caps (`max_tasks_per_track=5`, `max_loc_per_track=300`, `max_files_per_track=8`, `max_tracks_per_group=8`). Ceilings are tunable via `bin/config`; effort labels `(S/M/L/XL)` map to seed LOC (50/150/300/500). A track exceeding any cap is a `## SIZE` audit blocker.
- Every track gains a dedicated `_touches:_` metadata line enumerating its full file footprint. The audit uses it to compute pairwise `## COLLISIONS` within each Group. Collisions are classified **SHARED_INFRA** (overlap in `docs/shared-infra.txt` — fix: promote to per-Group Pre-flight) or **PARALLEL** (fix: merge tracks or move one to next Group). Legacy tracks without `_touches:_` are tolerated (`LEGACY_TRACKS` banner + `skip-legacy` status) and trigger a migration prompt on next `/roadmap` run.
- `## STYLE_LINT` warns (non-blocking) when a track uses `Depends on: Track NA` to reference another track in the same Group — "blocks → next Group" is a rule, not an annotation.
- `## SIZE_LABEL_MISMATCH` warns when a task's declared `~N lines` hint diverges from its effort tier's LOC mapping by more than 3x.
- New `bin/lib/effort.sh` library: deterministic LOC mapping, ceiling resolution (env var > `bin/config` > default), numeric validation on config overrides (non-numeric values fall through to default with a `CONFIG_INVALID` warning).
- New `docs/shared-infra.txt` (per-project): hand-curated list of files where two parallel tracks overlapping is always a SHARED_INFRA collision. Supports `*` globs, `{a,b}` brace expansion, and `#` comments. Loaded once per audit run via `find -path`.
- 34 new test cases in `scripts/test-roadmap-audit.sh` covering size caps (happy path + every failure axis + env overrides + non-numeric), collisions (disjoint/PARALLEL/SHARED_INFRA/cross-Group-excluded/legacy-excluded), shared-infra glob (literal/`*`/brace/comments), style lint, touches parsing (whitespace/wrong order), max-tracks-per-Group, and a load-bearing regression assertion that the repo's own migrated `docs/ROADMAP.md` passes the full audit.

### Changed
- `skills/roadmap.md` Rule 1 reframed: "A Group is a wave of PRs that land together — parallel-safe within, sequential between. Create a new Group whenever dependency ordering demands it OR parallel tasks would collide on files." Kept the existing "Group" vocabulary (no rename) to preserve freshness-scan provenance lookups and existing user docs.
- `bin/roadmap-audit` `check_structure()` now detects `_touches:_` appearing before the italic metadata line and emits a clear error (previously misreported as "missing risk level").
- `docs/ROADMAP.md` migrated to the new two-line metadata format. Track 1B deleted (all tasks were shared-infra → moved to Group 1 Pre-flight); Track 1A flattened to its only non-shared-infra task.

### Why
Two recurring failure modes of `/roadmap`: tracks too big for a single PR (get split mid-implementation) and "parallel" tracks that actually conflict (shared-infra files not modeled). The skill now enforces size as a hard invariant and computes collisions from explicit `_touches:_` sets instead of relying on informal "primary files" vibes. See `~/.gstack/projects/kbitz-gstack-extend/ceo-plans/2026-04-18-roadmap-track-sizing.md` for the full decision trail (3 adversarial review rounds, score 8.0/10).

## [0.8.11] - 2026-04-16

### Fixed
- Freshness scan in `/roadmap` now only considers commits made AFTER a task was introduced. Previously, `--since="4 weeks ago"` credited old commits as potential fixes for recently-added TODOs, producing false positives. Now uses `git log -S` to find each task's introduction date, then filters with `--after`.
- Step 2a (Keep or Kill) now has an explicit, date-guarded file-activity check instead of relying on ad-hoc LLM behavior.
- Freshness scan display shows "since introduced (date)" instead of "in last N weeks" so you can see the temporal anchor.

## [0.8.10] - 2026-04-15

### Added
- GitHub Action (`auto-tag.yml`) to create git tags automatically when VERSION changes on merge to main. Idempotent: skips if tag already exists.
- Update-check and 4-digit version tests in `test-update.sh`: semver comparisons, regex validation, upgrade detection with MICRO versions.
- Versioning section in README defining MAJOR.MINOR.PATCH.MICRO semantics.

### Changed
- Version validation regex in `bin/update-check` tightened from `^[0-9]+\.[0-9.]+$` to `^[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?$`. Now rejects malformed versions (double dots, trailing dots, 5+ segments) while accepting X.Y.Z and X.Y.Z.W.

### Fixed
- Added gist bridge comment in `bin/update-check` documenting why the old gist URL (pre-0.8.8.1) must be kept alive as a permanent upgrade bridge.
- `bin/roadmap-audit`: replaced bash 4+ associative arrays (`declare -A`, `local -A`) with bash 3-compatible helpers. The old code crashed on stock macOS (bash 3.2), silently skipping `check_unprocessed()` and `check_mode()`. Fixed 3 pre-existing test failures.
- `scripts/test-update.sh`: updated setup test expectations from 2 to 3 default skills (full-review was added in v0.8.0 but test wasn't updated). Fixed 2 pre-existing test failures.

## [0.8.9.0] - 2026-04-14

### Changed
- Roadmap audit now accepts 4-digit versions (`X.Y.Z.W`). The MICRO segment enables finer-grained bumps for doc-only and config changes. Previously, any 4-digit version was flagged as invalid SemVer.

## [0.8.8.1] - 2026-04-14

### Added
- MIT LICENSE file for open source distribution.

### Changed
- Update check now uses `raw.githubusercontent.com` instead of private gist for version lookups.
- README clone URL switched from SSH to HTTPS for public accessibility.
- Anonymized internal project references in design docs and implementation guide.

### Removed
- Gist sync GitHub Action (`.github/workflows/sync-version.yml`) — no longer needed with raw GitHub URL.
- Archived design docs (`docs/archive/`) containing internal project references.

## [0.8.8] - 2026-04-13

### Changed
- /roadmap triage mode now runs the freshness scan (Step 3.5) before classifying items into groups. Previously, triage slotted new items into potentially-complete groups because the freshness scan was gated to `/roadmap update` only. Now stale/completed tasks are always cleaned before new items get placed.
- Triage mode no longer exits early when the Unprocessed section is empty if stale items need cleaning. The freshness scan runs first, then exits if nothing was found.
- Update mode pipeline order corrected: audit → freshness scan → triage (was audit → triage → freshness scan).

## [0.8.7] - 2026-04-12

### Added
- Lookahead display in /pair-review Phase 2: every test item now shows a preview of the next item inline (_Next up: N+1. description_), so the user can start testing it immediately while waiting for the agent to process. Reduces perceived wait time to near zero.
- Batch mode for /pair-review: "Batch: next 3" option presents 3 items at once with "All pass" / "Report results" responses. Cuts round-trips by 3x for rapid testing sessions. Natural language triggers: "batch", "faster", "speed up".
- Fast path optimization for PASS/SKIP: agent uses cached lookahead data and parallelizes state writes (group file + session.yaml in same turn), avoiding unnecessary re-reads between items.

## [0.8.6] - 2026-04-11

### Added
- Structural assessment step (Step 3-pre) for triage and update modes: before classifying new items into existing Groups/Tracks, the skill now steps back and assesses whether the structure still fits. Offers full reorganization when drift is detected.
- Post-freshness-scan structural assessment (Step 3.5f): after removing completed tasks, checks if remaining structure is lopsided or broken.
- Deterministic task extraction (`check_task_list()` in audit script): parses ROADMAP.md into structured TASK lines so reorg uses a reliable task inventory instead of LLM-based extraction.
- Structural fitness metrics (`check_structural_fitness()` in audit script): computes group/track sizes and imbalance ratio as concrete signals for the structural assessment.
- Future item re-triage during reorganization: when structural reorganization is approved, Future items are re-evaluated for current-phase promotion.
- Mode-aware skip instruction after reorg: triage skips to Step 4, update proceeds to freshness scan.
- Reorg-specific commit messages distinguishing structural reorganization from plain triage.
- 15 new audit tests (84 total) covering task list parsing and structural fitness computation.

### Fixed
- Keep/kill step (Step 2a) clarified as overhaul-mode-only. Resolves pre-existing contradiction where triage mode was described as running keep/kill in one place and skipping it in another.

## [0.8.5] - 2026-04-10

### Added
- `/roadmap update` subcommand: incremental refresh mode that processes new unprocessed items, scans ROADMAP.md tasks against git reality for completed and unblocked work, and updates PROGRESS.md. Never exits early when the Unprocessed section is empty.
- Freshness scan (Step 3.5): detects potentially completed tasks via recent git commits on referenced files, detects unblocked tasks when blocker conditions resolve, presents findings for user confirmation before modifying ROADMAP.md.
- Mode-specific commit messages for overhaul, triage, and update modes.
- 4 new tests for PROGRESS_LATEST version parsing (69 total).

### Fixed
- PROGRESS_LATEST parsing bug: was using `head -1` which returned the first table row regardless of order. Now uses semver comparison to find the highest version, independent of table ordering.
- Four-segment versions (invalid SemVer) in PROGRESS.md are now excluded from PROGRESS_LATEST output while still being flagged as lint findings.

## [0.8.4] - 2026-04-07

### Added
- Full doc discovery in `/roadmap`: scans all .md files for scattered TODOs (checkboxes, TODO:/FIXME:/HACK:/XXX: markers, section headings, effort markers), extracts actionable items, deduplicates against existing TODOS.md/ROADMAP.md, and merges confirmed items with `[discovered:<filepath>]` provenance tags.
- Doc reclassification offers: after extracting TODOs from a file like plan.md, offers to rewrite the remaining content as a properly-named spec in docs/designs/, delete just the TODO sections, or leave as-is with drift detection.
- Doc inventory audit check: lists all .md files with TODO-pattern counts and doc type classification.
- Scattered TODOs audit check: flags non-standard .md files containing TODO-like patterns.
- Shared `find_scannable_md_files()` helper with proper exclusion list (known docs, archive, .context, node_modules, vendor).
- `count_todo_patterns()` with fenced code block exclusion supporting both backtick and tilde fences, including nested fence handling.
- 17 new tests for doc discovery checks (65 total).

## [0.8.3] - 2026-04-06

### Added
- Opinionated doc location check in `/roadmap` audit: root docs (README, CHANGELOG, CLAUDE.md, VERSION, LICENSE) stay in root, everything else (TODOS, ROADMAP, PROGRESS, designs, archive) belongs in docs/. Flags misplaced files as advisory findings. Suggests creating docs/ when it doesn't exist.
- Archive candidate detection: flags design docs in `docs/designs/` that reference a shipped version (version <= current VERSION) as candidates for archiving to `docs/archive/`.
- `semver_lte()` function in shared semver library for version comparison.
- 12 new tests for doc location and archive candidate checks (48 total).

### Changed
- Documentation Taxonomy table now includes a Location column showing where each doc should live.
- Duplicate doc detection messages updated from "pick one location" to "should be in docs/ only" for consistency with new location opinions.

## [0.8.2] - 2026-04-06

### Changed
- `/roadmap` triage now presents each TODO one-by-one instead of clustering by area. Each item gets its own AskUserQuestion with full description and git provenance (when introduced, which PR). Removes smart batching logic that forced extra round-trips to drill into clusters.

## [0.8.1] - 2026-04-06

### Changed
- Fixed invalid four-segment version 0.4.1.1 → removed (folded into 0.4.1).

### Added
- Phase-aware triage step in `/roadmap` (new Step 2 between audit and restructuring). Keep/kill decisions with auto-suggest kills (stale file refs, missed DONE markers), smart batching by area, and phase assignment (current vs future) before Group/Track structuring.
- `## Future` section in ROADMAP.md for items deferred to a future phase. Not organized into Groups/Tracks, just a flat list with deferral reasons.
- Phase header on ROADMAP.md title (`# Roadmap — Phase N (vX.x)`).
- Contextual vocabulary lint: "Phase" reclaimed for top-level scoping (title, Future section) while remaining banned inside Group/Track sections. State machine in `check_vocab_lint()` with whitelist approach.
- Future-only roadmap support: `check_structure()` and `detect_mode()` recognize ROADMAP.md with only a `## Future` section as valid (triage mode, not overhaul).
- Triage mode phase integration: new inbox items get phase-assigned before Group/Track placement.
- 9 new tests (37 total): contextual Phase vocab lint (6), Future section structure (2), Future-only mode detection (1).

### Changed
- Tighter `## Future` heading match in audit script (`^## Future($| \()`) to avoid matching `## Futures` or `## Future Work`.
- Triage mode sub-steps renumbered (3a-3f) to reflect new Step 2 insertion.
- Rule 8 updated: Unprocessed items are now drained by triage (Step 2), not preserved during overhaul.

## [0.8.0] - 2026-04-06

### Added
- New `/full-review` skill: weekly codebase review pipeline with 3 specialized agents (reviewer, hygiene, consistency-auditor) dispatched in parallel. Root-cause clustering synthesizes findings into actionable clusters for human triage (approve/reject/defer). Approved findings written to TODOS.md as `[full-review]` source-tagged items. Dedup against ROADMAP.md prevents re-flagging tracked issues. Incremental state checkpointing for resume support. Designed to feed into `/roadmap` for execution topology.

## [0.7.0] - 2026-04-06

### Added
- New `/roadmap` skill for documentation restructuring. Reorganizes project docs into Groups > Tracks > Tasks with dependency-chain ordering and file-ownership grouping for parallel agent execution.
- Deterministic audit script (`bin/roadmap-audit`) with 8 checks: vocabulary lint, structure validation, staleness detection, version audit, taxonomy check, dependency integrity, unprocessed item detection, and mode detection.
- Two-mode behavior: overhaul (first run, full restructure) and triage (process only new items from the inbox).
- TODOS.md/ROADMAP.md split: TODOS.md is now a pure inbox where other skills dump unprocessed items. ROADMAP.md is the structured execution plan owned by `/roadmap`.
- `/pair-review` now writes bugs to TODOS.md's `## Unprocessed` section with `[pair-review]` source tags.
- Shared semver comparison library (`bin/lib/semver.sh`) extracted from `bin/update-check`.
- 28 new tests for the audit script (`scripts/test-roadmap-audit.sh`).

## [0.6.3] - 2026-04-06

### Changed
- `/browse-native` is now opt-in (beta). Default `./setup` only installs `/pair-review`. Use `./setup --with-native` to also install browse-native.
- README updated with skill maturity status table and separate beta install instructions.
- Setup script rejects unknown flags instead of silently falling through to default install.

## [0.6.2] - 2026-04-05

### Fixed
- `bin/update-run` no longer destroys non-main branch work. Replaced `git reset --hard origin/main` with `checkout main` + `pull --ff-only`. Safely switches back to the original branch after upgrade, restores stashed changes on the correct branch, and fails safely if main has diverged locally.
- Skill preamble update-check guard now fires regardless of where the repo is cloned. Replaced `$HOME/.claude/skills/` path prefix check with `[ -x "$_EXTEND_ROOT/bin/update-check" ]`.

### Added
- Smart next-step suggestion at pair-review completion. Checks `gstack-review-read` for existing review logs and diff size against main. If no review has been run and changes exceed 30 lines, nudges toward `/review` before `/ship`. Trivial changes or already-reviewed branches go straight to `/ship`.
- Test suite for update and install pipeline (`scripts/test-update.sh`): 17 tests covering update-run (happy path, non-main branch switch, dirty worktree restore, ff-only failure, missing args) and setup (default install, uninstall).

## [0.6.1] - 2026-04-05

### Fixed
- Standardized /pair-review question presentation: all user-facing prompts now use AskUserQuestion with explicit options instead of free-form text. Eliminates inconsistent question styles across workspaces (yes/no vs pass/fail/skip vs multiple choice).
- Added Conductor visibility awareness: new "action receipt" pattern ensures important status updates (bug parked, fix committed, build succeeded) are included in the visible prompt, not hidden in collapsed intermediate messages.

### Added
- New "Conductor Visibility Rule" section in pair-review skill defining the AskUserQuestion-first and action receipt conventions.

## [0.6.0] - 2026-04-05

### Added
- Auto-update system for all skills. Skills check for new versions on each invocation via `bin/update-check` (private gist VERSION comparison, pure bash semver, 60min/720min cache TTL, escalating snooze backoff). Inline upgrade flow in each skill preamble: auto-upgrade if configured, otherwise AskUserQuestion with 4 options (upgrade now, always auto-upgrade, snooze, disable checks). `bin/update-run` handles the upgrade (git stash + fetch + reset --hard + setup). `bin/config` provides simple key=value config management. GitHub Action syncs VERSION to gist on push to main. Global-install only (per-project installs skip update checks). State stored in `~/.gstack-extend/`.

## [0.5.0] - 2026-04-05

### Added
- Bug parking for /pair-review: note unrelated bugs during testing without interrupting the flow. Bugs are parked to `parked-bugs.md`, triaged at group completion (fix now, defer to TODOS.md, or keep parked), and remaining bugs are processed in a post-testing fix queue (Phase 2.5). Designed to avoid `git add -u` sweeping TODOS.md changes into fix commits by deferring classification to group boundaries.

### Fixed
- Corrected TODOS.md path reference in Phase 1 test plan generation (was `TODOS.md`, now `docs/TODOS.md`).

## [0.4.1] - 2026-04-04

### Added
- Setup script (`setup`) for installing skill symlinks into `~/.claude/skills/`. Handles install and `--uninstall` with ownership verification (only removes symlinks it created).

### Changed
- Updated README installation instructions: two clear paths (global install and per-project install), both using the new setup script. Previously claimed skills were auto-discovered after cloning, which was incorrect.
- Renamed project from gstack-native to gstack-extend across all in-repo references: README, CLAUDE.md, setup script, design docs, and TODOS.

### Fixed
- Renamed pair-review skill's context directory from `.context/test-session/` to `.context/pair-review/` to match the skill name.

## [0.4.0] - 2026-04-04

### Added
- New /pair-review skill (skills/pair-review.md): pair testing session manager that guides humans through manual testing with persistent state. Generates grouped test plans from diffs, manages the test-fix-retest loop with group-level checkpoints, discovers deploy recipes, and supports cross-machine resume. Works for any project type (web, native, CLI).
- Design doc: docs/designs/pair-review.md (approved via /office-hours, reviewed via /plan-ceo-review and /plan-eng-review).
- Skill routing for /pair-review in CLAUDE.md.
- New TODOs: PR comment integration (P1), validation script (P1), multi-agent orchestration (P2), repo rename (P2).

## [0.3.1] - 2026-04-04

### Added
- Implementation guide for adding debug infrastructure to new SwiftUI apps (docs/debug-infrastructure-guide.md). Documents all six components from the reference implementation with code examples, wiring instructions, and a verification checklist.
- Skill now detects missing infrastructure at setup and guides users to add it before falling back to degraded mode. Explains what's lost without instrumentation and offers to help implement it (~400 lines Swift, ~15 min with CC).

### Changed
- Moved skill to `skills/browse-native.md` (preparing for multi-skill layout).
- Moved design docs to `docs/archive/` (historical decision records, not active references).
- Promoted implementation guide to `docs/` root (living reference used by the skill).

## [0.3.0] - 2026-04-04

### Changed
- Replaced Peekaboo CLI with inside-out debug infrastructure. The app now instruments itself (screenshots, layout probes, state dumps) and the agent communicates via filesystem triggers and osascript.
- Rewrote /browse-native skill around the new interaction pattern: trigger snapshot, read structured data + screenshots, act via osascript/keyboard, verify.
- Rewrote validation gates: Gate 1 validates snapshot bundles, Gate 2 tests osascript interaction, Gate 3 measures see-act-see cycle latency (<3000ms).
- Three instrumentation tiers: full (probes + state + screenshots), partial (state + screenshots), and degraded (osascript + screencapture only).
- Updated TODOS.md: obsoleted 5 Peekaboo-era items, added new P1/P2 backlog.
- Updated roadmap: Phase 2 is now UI Truth Layer, Phase 3 is /qa-native redesign.

### Added
- Design doc: docs/archive/inside-out-debugging.md (approved, covers snapshot bundle spec, trigger protocol, osascript primitives, architectural decisions).
- Color and alignment rules: skill instructs the agent to always use probe data for precise comparisons, never rely on screenshot vision alone.
- Degraded mode: skill works with uninstrumented apps via osascript + screencapture.
- Skill routing rules in CLAUDE.md.

### Removed
- Peekaboo CLI dependency. No external tools required.
- scripts/detect-host-app.sh (Peekaboo permission detection).

## [0.2.0] - 2026-03-27

### Changed
- Skill rewrite from hands-on feedback: focused interaction tool, mandatory target, capability probe, keyboard-first mode for sparse AX trees.

## [0.1.0] - 2026-03-24

### Added
- Initial /browse-native skill with Peekaboo CLI, validation gates, design doc.
