# gstack-extend

Extension skills for [gstack](https://github.com/anthropics/gstack).

| Skill | What it does | Works with | Status |
|-------|-------------|------------|--------|
| `/pair-review` | Pair testing session manager | Any project (web, native, CLI) | Stable |
| `/roadmap` | Documentation restructuring | Any project | Stable |
| `/full-review` | Weekly codebase review pipeline | Any project | Stable |
| `/review-apparatus` | Project testing/debugging apparatus audit | Any project | Stable |
| `/test-plan` | Group-scoped batched test plan (composes with /pair-review) | Any project | New |
| `/gstack-extend-upgrade` | Upgrade gstack-extend to the latest version | gstack-extend itself | New |

## Installation

**Requirements:** [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Git](https://git-scm.com/), [Bun](https://bun.sh/) v1.0+. `setup` checks for `bun` and fails fast with install instructions if it's missing.

Clone and run setup:

```bash
git clone https://github.com/kbitz/gstack-extend.git ~/.claude/skills/gstack-extend
~/.claude/skills/gstack-extend/setup
```

Equivalently, if you prefer driving install through bun:

```bash
git clone https://github.com/kbitz/gstack-extend.git ~/.claude/skills/gstack-extend
bun --cwd ~/.claude/skills/gstack-extend run setup
```

This installs all skills into `~/.claude/skills/`.
To uninstall: `~/.claude/skills/gstack-extend/setup --uninstall`

---

## /pair-review — Pair Testing Session Manager

Manages the test-fix-retest loop for manual testing. The agent generates grouped
test plans from diffs, tracks pass/fail, checkpoints before fixes, rebuilds/redeploys,
and supports resume. Works for any project type.

- **Persistent state** — test progress survives context compaction
- **Deploy discovery** — finds your build/run process and reuses it across sessions
- **Group-level checkpoints** — auto-commits before fix attempts for clean reverts
- **Resume** — pick up exactly where you left off
- **Smart batching** — agent infers `Covers:` links between items; one bundled "All pass" prompt confirms N covered items at once instead of N individual clicks. Integrity-preserving: `PASSED_BY_COVERAGE` items demote back to `UNTESTED` if the covering item later fails. Transparent: review and edit the coverage graph at plan time, strip all coverage to revert to today's behavior.

```
/pair-review          # Start a new test session
/pair-review resume   # Resume where you left off
/pair-review status   # See the dashboard
/pair-review done     # Complete and generate report
```

---

## /roadmap — Documentation Restructuring

Restructures TODOS.md into a clean execution plan (ROADMAP.md) with consistent
vocabulary, dependency ordering, and file-ownership grouping for parallel agent
execution. Audits versioning, validates doc taxonomy, and recommends version bumps.

- **Two files, one flow** — TODOS.md is the inbox (other skills write here), ROADMAP.md is the structured execution plan
- **Two modes** — Overhaul (first run: full restructure) and Triage (subsequent runs: process only new items)
- **Deterministic audit** — 20 automated checks (vocabulary, structure, version-tag staleness, versioning, taxonomy, doc location, archive candidates, dependencies, unprocessed, task list, structural fitness, doc inventory, scattered TODOs, size caps, collisions, style lint, group deps, in-flight groups, origin stats, TODO format)
- **Size caps + collision detection** — Tracks have explicit `_touches:_` file sets. The audit blocks any Track over per-track caps (5 tasks, 300 LOC, 8 files — tunable via `bin/config`) and flags intra-Group collisions, classified `SHARED_INFRA` (fix: promote to Pre-flight) or `PARALLEL` (fix: merge tracks or move one to next Group). Edit `docs/shared-infra.txt` to tune which files are always considered shared.
- **Group-level deps (DAG)** — Groups default to a linear chain (depends on the preceding Group), but projects with parallel workstreams can opt into a DAG via `_Depends on: Group N (Name), Group M_` on the italic line after a Group heading. `_Depends on: none_` marks a Group as having no deps. The audit parses annotations, detects cycles + forward refs, warns on drifted name anchors (`STALE_DEPS`), and always emits a topologically-ordered adjacency list in the Execution Map.
- **Scrutiny + closure culture** — TODOS.md entries follow a canonical rich format (`### [source:key=val] Title` + child bullets), spec'd in `docs/source-tag-contract.md` and validated by the `TODO_FORMAT` audit check. Source tags drive per-source scrutiny defaults in triage (`full-review:edge-case → SUGGEST KILL`, observed bugs → KEEP) so the default stops being "add to backlog." Origin tags like `[pair-review:group=N]` route bugs back to the Group that surfaced them (closure bias), and Groups keep stable numeric IDs forever — completed Groups stay in place marked `✓ Complete` so origin refs never rot. A closure debt dashboard (`IN_FLIGHT_GROUPS` + `ORIGIN_STATS`) renders at the top of every `/roadmap` run.
- **Layout Scaffolding** — When the audit reports misplaced project docs (DOC_LOCATION non-pass), design-mismatch findings outside `docs/designs/` (DOC_TYPE_MISMATCH), or a `docs/ directory absent` finding on a CLAUDE.md-onboarded project with no `docs/` yet, `/roadmap` offers a single batch confirm to scaffold the canonical layout (`docs/`, `docs/designs/`, `docs/archive/`) and execute the audit's pre-quoted `git mv` suggestions. Per-file preflight via `git ls-files --error-unmatch --` chooses `mv` vs `git mv`; collisions on the plain-mv branch HALT with a summary. Idempotent re-run.
- **Parallel-agent friendly** — Groups > Tracks > Tasks organized by file ownership to minimize merge conflicts

```
/roadmap              # Audit + restructure (auto-detects overhaul vs triage mode)
/roadmap update       # Incremental refresh (freshness scan + triage, never exits early)
```

### How It Works

1. **Audit** — Runs `bin/roadmap-audit` against repo docs. Reports vocabulary drift, structural violations, stale items, version mismatches, and taxonomy issues.
2. **Build/Update ROADMAP.md** — In overhaul mode, reorganizes everything from scratch. In triage mode, classifies unprocessed items from TODOS.md into existing Groups/Tracks.
3. **Update PROGRESS.md** — Appends version history rows, verifies phase status.
4. **Version recommendation** — Suggests a bump based on changes since last tag (does not write VERSION).

### Documentation Taxonomy

| Doc | Purpose | Written by |
|-----|---------|------------|
| TODOS.md | Inbox — unprocessed items | /pair-review, /full-review, /investigate, /review-apparatus, manual |
| ROADMAP.md | Execution plan — Groups > Tracks > Tasks | /roadmap |
| PROGRESS.md | Version history + phase status | /roadmap, /document-release |
| CHANGELOG.md | User-facing release notes | /document-release |
| VERSION | SemVer source of truth | /ship |

---

## /full-review — Weekly Codebase Review Pipeline

Dispatches 3 specialized review agents (reviewer, hygiene, consistency-auditor) in
parallel, synthesizes findings into root-cause clusters, guides you through triage,
and writes approved findings to TODOS.md for /roadmap to organize.

- **3 specialized agents** — implementation gaps, code waste, and pattern drift reviewed simultaneously
- **Root-cause clustering** — findings grouped by theme for efficient triage (approve/reject/defer per cluster)
- **TODOS.md integration** — approved items tagged `[full-review]` under `## Unprocessed` for /roadmap
- **ROADMAP.md dedup** — skips findings already tracked in the roadmap
- **Resume support** — state checkpointed after each phase, pick up where you left off

```
/full-review          # Start a fresh codebase review
/full-review resume   # Resume where you left off
/full-review status   # See the session dashboard
```

### How It Works

1. **Scoping** — Identifies hot areas from recent git history to help agents prioritize
2. **Agent dispatch** — 3 agents review the codebase in parallel with different lenses
3. **Synthesis** — Findings merged, deduped, and clustered by root cause (target: 3-8 clusters)
4. **Dedup** — Clusters matched against ROADMAP.md tracks to skip already-tracked issues
5. **Triage** — You approve, reject, or defer each cluster via AskUserQuestion
6. **Persist** — Approved findings written to TODOS.md, summary report saved to `${GSTACK_STATE_ROOT:-$HOME/.gstack}/projects/<slug>/full-review/`

### Documentation Taxonomy Update

| Doc | Purpose | Written by |
|-----|---------|------------|
| TODOS.md | Inbox | /pair-review, /full-review, /investigate, /review-apparatus, manual |
| ROADMAP.md | Execution plan | /roadmap |

---

## /review-apparatus — Project Testing & Debugging Apparatus Audit

Reads a project, inventories existing testing/debugging apparatus (scripts, bin/ tools,
Makefile targets, dev endpoints, logging, staging configs, existing test infra), and
proposes lightweight bolt-on additions where a small helper would simplify CC-assisted
verification or debugging. Approved proposals land in TODOS.md as `[review-apparatus]`
items for /roadmap to organize.

- **Judgment-driven** — reads the project with CC's reasoning, not regex over manifests. Proposals reflect the project's actual shape.
- **Bolt-on bar** — only proposes additions that are lightweight, unlikely to cause new bugs, and don't require refactors
- **Project-agnostic** — no enumerated stack list. Rails, Next.js, Go services, native apps, Python/FastAPI all work
- **Non-invasive** — doesn't modify any existing code. Writes TODOs; the helpers get built later through the /roadmap → implementation pipeline

```
/review-apparatus        # Audit the project, produce proposals, write approved to TODOS.md
/review-apparatus status # Show what the last run produced (if anything)
```

Consumer skills (/pair-review, /qa, /investigate) pick up new apparatus organically
once the helpers exist in the project. How they discover and invoke apparatus is a
future, separate design.

---

## /test-plan — Group-Scoped Batched Test Plan

Generates ONE coherent batched test plan for a whole roadmap Group (1-4 Tracks
landing together), then hands off to /pair-review's Phase 2 execution loop. Harvests
any CEO/eng/design review docs for every Track branch in the Group and turns their
decisions into test items tagged with source — "verify the things we explicitly
cared about" instead of "click around on the diff." Also auto-detects prior per-Track
/pair-review sessions and carries forward their findings (skip PASSED, surface
SKIPPED/DEFERRED/regression candidates, carry PARKED) so you don't re-test what
you already tested.

- **Batched, not per-PR** — one session covers a whole Group, eliminating duplicate testing across Tracks
- **Review-doc harvesting** — /plan-ceo-review, /plan-eng-review, /plan-design-review outputs become test items automatically, with provenance
- **Single integrated build** — /pair-review runs against ONE branch (main post-merge, preview deploy, integration branch); Track branches are provenance only
- **Explicit Group→branch manifest** — `~/.gstack/projects/<slug>/groups/<group>/manifest.yaml` maps Tracks to branches; the skill prompts once, reuses thereafter
- **Automated/manual split** — conservative heuristic classifier; ambiguous items default to manual. Automated items surface in the plan for a separate `/qa-only` pass (per-item execution is v2 work)
- **Stable item IDs** — deterministic sha256 of `branch|doc|section|description` for cross-session dedup and future retro
- **Soft-warn on incomplete Groups** — surfaces "<N> of <M> Tracks not DONE" so you don't accidentally bug-bash a half-shipped Group, but lets you proceed
- **Passive /qa-only integration** — writes `-test-plan-batch-*.md` files to the project path that `/qa-only` auto-picks-up as test-plan context

```
/test-plan run <group>    # Build plan, write state, drop into /pair-review Phase 2
/test-plan status <group> # Read-only dashboard of manifest + latest plan + pair-review state
```

### File format

The artifact contract is owned by /test-plan and documented at
`docs/designs/test-plan-artifact-contract.md`. Upstream consumers (/qa-only, /pair-review,
/plan-eng-review) follow this contract. Breaking format changes bump the `schema` integer.

### Documentation Taxonomy Update

| Doc | Purpose | Written by |
|-----|---------|------------|
| TODOS.md | Inbox | /pair-review, /full-review, /investigate, /review-apparatus, /test-plan (via /pair-review handoff), manual |
| ROADMAP.md | Execution plan | /roadmap |
| `~/.gstack/projects/<slug>/groups/<group>/manifest.yaml` | Track→branch→review-doc mapping | /test-plan |
| `~/.gstack/projects/<slug>/<user>-<branch>-test-plan-batch-*.md` | Batched test plan artifact | /test-plan |

---

## /gstack-extend-upgrade — Upgrade gstack-extend

A first-class upgrade path for gstack-extend itself, mirroring gstack's own
`/gstack-upgrade`. The same flow runs automatically inside every gstack-extend skill's
preamble when a periodic check detects a new version — this skill is the standalone
entry point for checking or upgrading on demand.

- **One canonical flow** — the upgrade procedure is a single drift-locked block shared by all skill preambles and this skill; no more divergent copies
- **Fast-forward only** — `bin/update-run` pulls with `--ff-only`; a diverged local `main` fails safely instead of destroying work, and the branch + stash are restored on any mid-run failure
- **Honest reporting** — every run emits exactly one `UPGRADE_OK` / `UPGRADE_FAILED` line; the skill never claims success without `UPGRADE_OK`
- **Disambiguated checks** — a direct check distinguishes "up to date", "checks disabled", and "couldn't reach GitHub" instead of collapsing them to a vague "no update"
- **Auto-upgrade, snooze, never-ask** — same opt-in UX as gstack core; auto-upgrade is only armed after a confirmed successful run

```
/gstack-extend-upgrade   # Force a fresh check; upgrade if a newer version exists
```

---

## Versioning

4-digit SemVer: `MAJOR.MINOR.PATCH.MICRO`

| Segment | Meaning | Example |
|---------|---------|---------|
| MAJOR   | Breaking changes | 1.0.0 |
| MINOR   | New features, new skills | 0.9.0 |
| PATCH   | Bug fixes, behavior changes | 0.8.10 |
| MICRO   | Doc-only, config-only, no behavior change | 0.8.9.0 |

Source of truth: `VERSION` file. Tags created automatically on merge to main.

## Testing

```bash
bun run test        # diff-narrowed: only runs tests whose deps changed vs origin/main
bun run test:full   # everything (use when something feels off, or for /ship)
EVALS_ALL=1 bun test tests/   # bypass selection inline
TOUCHFILES_BASE=feature bun run test   # base override for stacked branches
```

The wrapper at `scripts/select-tests.ts` builds a static TS import graph for every
`tests/*.test.ts`, supplemented by a small manual map for non-TS deps (shell binaries,
fixture trees, skill files). It falls back to running the full suite on empty diff,
missing base ref, any global touchfile hit, or any non-empty diff that selects zero
tests. User-supplied argv (`bun test --watch foo`) bypasses selection entirely.

When adding a new test that consumes a non-TS file, register it in
`tests/helpers/touchfiles.ts` `MANUAL_TOUCHFILES` — `tests/touchfiles.test.ts`
invariants will fail otherwise.

## Acknowledgments

Built by [@kbitz](https://github.com/kbitz) with assistance from [Claude Code](https://claude.com/claude-code) (Anthropic).

## License

[MIT](LICENSE)
