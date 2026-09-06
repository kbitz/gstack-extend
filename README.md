# gstack-extend

Extension skills for [gstack](https://github.com/anthropics/gstack).

| Skill | What it does | Works with | Status |
|-------|-------------|------------|--------|
| `/pair-review` | Pair testing session manager | Any project (web, native, CLI) | Stable |
| `/roadmap` | Plan regeneration — packer assigns Groups | Any project | Stable |
| `/full-review` | Weekly codebase review pipeline | Any project | Stable |
| `/review-and-prep` | Local review/tests → draft PR → optional Greptile → mark ready, without versioning | GitHub projects with gstack `/review` | New |
| `/review-apparatus` | Project testing/debugging apparatus audit | Any project | Beta |
| `/test-plan` | Group-scoped batched test plan (composes with /pair-review) | Any project | Beta |
| `/gstack-extend-upgrade` | Upgrade gstack-extend to the latest version | gstack-extend itself | New |
| `/gstack-extend-init`    | Bootstrap a new project (canonical scaffold + registry) | Any greenfield or partially-onboarded project | Beta |

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

Default install is Claude (`~/.claude/skills/<name>/SKILL.md`). For every
detected agent (Claude, Codex, OpenCode):

```bash
~/.claude/skills/gstack-extend/setup --host auto
```

| Host | Path |
|------|------|
| Claude | `~/.claude/skills/<name>/` |
| Codex | `~/.codex/skills/<name>/` |
| OpenCode | `~/.config/opencode/skills/<name>/` |

Each skill is its own directory with `SKILL.md`. The package checkout is never linked as a skill.

If a skill directory is already a personal symlink (for example, linked from
dotfiles), setup stops before installing anything on any selected host. It
preserves the link and its contents, reports the colliding path even with
`--quiet`, and exits unsuccessfully. Choose which skill should own that name,
move the personal link if replacing it, then rerun setup. A symlink collision
remains an error even when other skill names could be installed.

To uninstall: `~/.claude/skills/gstack-extend/setup --host auto --uninstall`

---

## /pair-review — Pair Testing Session Manager

Manages the test-fix-retest loop for manual testing. The agent generates grouped
test plans from diffs, tracks pass/fail, checkpoints before fixes, rebuilds/redeploys,
and supports resume. Works for any project type.

- **Persistent state** — test progress survives context compaction
- **Deploy discovery** — finds your build/run process and reuses it across sessions
- **Group-level checkpoints** — auto-commits before fix attempts for clean reverts
- **Resume** — pick up exactly where you left off
- **One glance, one question** — items a single action verifies at the same moment are merged into one item at plan time, before any coverage inference runs. Two properties on the same screen never cost two prompts.
- **Executable items** — every item is an imperative action plus observable `PASS:` / `FAIL:` criteria. Background lives in a `Context:` field that never reaches the prompt, so the question you're asked is just the question.
- **Ordered for one walk** — items are sequenced by state locality (consecutive items share a screen), then risk, with destructive items last.
- **Smart batching** — for properties that are *implied* rather than co-visible (a cookie, a log line, a DB row), the agent infers `Covers:` links; one bundled "All pass" prompt confirms N covered items at once instead of N individual clicks. Integrity-preserving: `PASSED_BY_COVERAGE` items demote back to `UNTESTED` if the covering item later fails. Transparent: review and edit the coverage graph at plan time, strip all coverage to revert to today's behavior.

```
/pair-review          # Start a new test session
/pair-review resume   # Resume where you left off
/pair-review status   # See the dashboard
/pair-review done     # Complete and generate report
```

---

## /roadmap — Plan Regeneration

Maintains ROADMAP.md as a state-organized execution plan. The LLM drafts
Tracks (one PR / one session). `bin/roadmap-pack` assigns Groups. Theme is
a name, not a partition. Audits the docs, drains TODOS.md, and recommends
a VERSION bump (`/ship` writes it).

- **Inbox + live plan + two tails** — TODOS.md is the inbox, ROADMAP.md is the live plan. `docs/roadmap-shipped.md` is frozen history. `docs/roadmap-future.md` is deferred work (keeps review context). ROADMAP always points at both.
- **Regenerate, don't patch** — every substantive run rewrites `## In Progress` / `## Current Plan`. Future membership is re-derived; staying-deferred text is kept. Only shipped IDs are frozen.
- **Deterministic audit** — automated checks (vocabulary, structure, version-tag staleness, versioning, taxonomy, doc location, archive candidates, dependencies, unprocessed, task list, structural fitness, doc inventory, scattered TODOs, session-weight size caps, collisions, packing, style lint, group deps, in-flight groups, origin stats, TODO format)
- **Session-weight size + collision + packing** — Tracks have explicit `_touches:_` file sets. Size is session weight (S=1, M=2, L=4, XL=5), not line counts. Weight 5 warns (`WEIGHT_WARN`); ≥6 fails. Raise `roadmap_max_session_weight` if this repo ships weight-5 as one PR. Tag deletes `~N lines (del)` — title verbs are not enough. The packer (`bin/roadmap-pack`) is the scheduler: it fills bins from track `_blocked-by:` and `_touches:` only. `PACKING` fails when written Groups disagree. Two tracks that share a file with no path in the closed `_blocked-by` / bin / Group DAG get a STYLE_LINT `unordered collision` warn. Collision-split bins are serial. Shared docs are not collisions. `CLAUDE.md` is one-per-Group. Edit `docs/shared-infra.txt` to tune always-shared files. Design: `docs/designs/roadmap-v3-packing.md`.
- **Group-level deps (DAG)** — Group `_Depends on:` is packer **output**, not input. Paste the packer's `DEPENDS` lines after you name the bins; writing them does not change the schedule. Unspecified means none (ready). First regen after upgrade: `bin/roadmap-pack --materialize` and write any implicit previous-Group edges you still want. The audit parses annotations, detects cycles + forward refs, warns on drifted name anchors (`STALE_DEPS`), and always emits a topologically-ordered adjacency list.
- **Ship gate** — `bin/roadmap-touches drift --track <id>` hard-fails undeclared committed/staged/unstaged/untracked paths. `report-cross-group` prints soft overlaps across Groups. Created files are `path (new)`.
- **Scrutiny + closure culture** — TODOS.md entries follow a canonical rich format (`### [source:key=val] Title` + child bullets), spec'd in `docs/source-tag-contract.md` and validated by the `TODO_FORMAT` audit check. Source tags drive per-source scrutiny defaults (`full-review:edge-case → SUGGEST KILL`, observed bugs → KEEP) so the default stops being "add to backlog." Origin tags like `[pair-review:group=N]` route bugs back to the Group that surfaced them (closure bias). Drain dispositions are place / defer / kill / **discharge** (`discharged@<sha>` — already done, not a judgment). Shipped and In Progress IDs stay frozen; Current Plan IDs recycle. A current-plan origin tag resolves by title at inbox drain, not by number. Completed Groups stay in place marked `✓ Complete`. A closure debt dashboard (`IN_FLIGHT_GROUPS` + `ORIGIN_STATS`) renders at the top of every `/roadmap` run. Live `Hotfix:` Groups jump the in-flight queue.
- **Layout Scaffolding** — When the audit reports misplaced project docs (DOC_LOCATION non-pass), design-mismatch findings outside `docs/designs/` (DOC_TYPE_MISMATCH), or a `docs/ directory absent` finding on a CLAUDE.md-onboarded project with no `docs/` yet, `/roadmap` offers a single batch confirm to scaffold the canonical layout (`docs/`, `docs/designs/`, `docs/archive/`) and execute the audit's pre-quoted `git mv` suggestions. Per-file preflight via `git ls-files --error-unmatch --` chooses `mv` vs `git mv`; collisions on the plain-mv branch HALT with a summary. Idempotent re-run.
- **Launch batches, not file-ownership themes** — Groups fill to `parallelism_cap` (default 6, hard max 8). Same files → different Groups. Unrelated files → same Group.

```
/roadmap              # Audit + regenerate the upcoming plan
/roadmap update       # Same path; never exits early on a "clean" inbox
bin/roadmap-pack                         # print packer bins (live ROADMAP.md)
bin/roadmap-pack --from /tmp/draft-tracks.md  # pack a draft (or --stdin)
bin/roadmap-pack --materialize           # old implicit previous-Group edges
bin/roadmap-touches drift --track 15A    # fail undeclared paths
bin/roadmap-touches report-cross-group   # soft overlaps across Groups
bin/roadmap-renumber --map 101A=91A,101=91   # atomic Current Plan ID rewrite
# BINS: EMPTY = no unshipped Tracks (read the hint). BINS: CYCLE = _blocked-by loop.
```

### How It Works

1. **Audit** — Runs `bin/roadmap-audit` against repo docs. Reports vocabulary, structure, size, collisions, packing, group deps, and the rest of the section list.
2. **Draft Tracks, then pack** — 1 Track = 1 PR = 1 session. Each card has `_touches:_` plus `_out:` / `_read-first:` / `_produces:` / `_blocked-by:`. `/roadmap` Step 2 runs `bin/roadmap-pack --from /tmp/draft-tracks.md` (or `--stdin`). Output includes `CRITICAL_PATH` and ready-to-paste `DEPENDS` lines. Do not re-partition the bins.
3. **Apply** — Replace `## In Progress` / `## Current Plan`. Surgically update `docs/roadmap-future.md`. Drain TODOS.md. Re-audit. `PACKING` must match the packer.
4. **PROGRESS + version** — `/roadmap` flags a stale PROGRESS.md and recommends a VERSION bump. It does not write VERSION (`/ship` does).

### Documentation Taxonomy

| Doc | Purpose | Written by |
|-----|---------|------------|
| TODOS.md | Inbox — unprocessed items | /pair-review, /full-review, /investigate, /review-apparatus, manual |
| ROADMAP.md | Execution plan — state sections, Groups are packer bins | /roadmap |
| roadmap-shipped.md | Frozen shipped history | /roadmap |
| roadmap-future.md | Deferred bullets | /roadmap |
| PROGRESS.md | Version history + phase status | /roadmap, /document-release |
| CHANGELOG.md | User-facing release notes | /document-release |
| VERSION | SemVer source of truth | /ship |

---

## /review-and-prep — Prepare a Reviewed PR for /ship

Runs `/review` and the project's required local checks, then commits and pushes
to a draft PR. If required user testing is still pending — app interactions,
visual inspection, device checks, or other human acceptance — it stops here,
records the remaining checks in the PR, and recommends `/pair-review` before
Greptile. After testing and fixes, `/review-and-prep resume` continues on the
same draft using the recorded results and refreshing affected checks. Already
recorded user results can satisfy this gate when they cover the current changes.
This pause also applies when Greptile is skipped; required testing still gates
readiness. A pair-review report marked done does not waive skipped checks or
unverified fixes.

Once required user testing is satisfied, when a root `greptile.json` file, `.greptile.json` file, or
`.greptile/` directory exists at the reviewed base tip or in the intended head
and the full PR is not docs-only, it triggers Greptile through MCP or `@greptileai review this
draft`, waits for completion, and fixes sensible findings. **Greptile runs at
most once per PR**, across commits, sessions, and the `/ship` handoff. Existing
automatic/manual runs count; failed runs are not retried. Before the first run,
the agent fetches and merges the latest `main` (or the PR's target base) into
the feature branch when it is behind or diverged, then reviews, tests, and
pushes the integrated result. Greptile fixes and later changes are reviewed
and tested locally, without requesting another Greptile run. If 10 minutes of
monitoring yields no response, MCP cannot verify a review, and the trigger
comment was posted correctly, preparation proceeds using local review/tests
and records Greptile as unverified. Known queued/running reviews keep waiting;
explicit failures remain blockers.
Without any root marker at either tip, or for docs-only PRs, every Greptile component is
skipped, including inside `/review`. Readiness then depends on local
review/testing and the remaining gates.

Adding, removing, or renaming a marker requires an explicit user policy decision,
even when another marker remains; additions/removals of configuration files
inside the root `.greptile/` also require that decision. The recorded decision
overrides the default of requiring review, including explicitly disabling it
for this PR. A directory marker needs a file intended for the commit; an empty
or ignored working-tree directory does not count. Greptile's documented formats are
[`greptile.json`](https://www.greptile.com/docs/code-review/greptile-json-reference)
and [`.greptile/`](https://www.greptile.com/docs/code-review/greptile-config-reference),
with the directory taking precedence. The dotted JSON file remains a local
enablement signal for existing repos. If effective settings cannot be verified,
the workflow records that uncertainty, applies declared labels, and requests
review explicitly. Readiness requires the single run's completion or the
documented 10-minute no-response fallback, with local verification covering
subsequent changes.
Nested-only config does not enable this
workflow's root gate.

Readiness also requires a complete audit of the approved plan (including
autoplan), or the agreed task requirements when no plan was created. Every
in-scope item must have implementation/verification evidence or an explicit
user-approved deferral. Missing plan context and unverified items block
readiness; long plans are audited in full. The PR receipt preserves the scope,
plan fingerprint, complete item matrix, and deferral decisions across sessions.

The PR stays draft throughout preparation and is marked ready **once**, at the
end. The skill never toggles a ready PR back to draft. Reinvoking it resumes the
same draft and uses a PR-body receipt to track verification across workspaces.
On completion, it outputs a copyable prompt for a new session to run `/ship`
and then `/land-and-deploy` on the same PR. The prompt carries the prepared
commit/tree and base, timestamped review/test evidence, Greptile results or skip
reason, settled decisions, and remaining release/deploy work. Native evidence
logs support reuse on the same machine; inline evidence and the PR receipt
preserve context elsewhere. Freshness and required checks still apply.
Review evidence identifies each specialist and adversarial pass separately.
The handoff explicitly tells `/ship` to reuse completed, current checks even
when its default invocation would rerun them; missing or stale checks still
run. A generic "review clean" does not stand in for a missing specialist review.
It checks the repository's existing CI triggers before pushing; draft gating is
a workflow configuration, not a GitHub-wide guarantee.

```
/review-and-prep      # Review, test, draft PR, Greptile when applicable, mark ready
/ship                # Reuse the PR; assign version and finish release work
/land-and-deploy     # Land the shipped PR and verify deployment when applicable
```

When the draft needs your testing, the middle of that workflow becomes:

```text
/review-and-prep         # Review, local checks, commit/push draft; pause
/pair-review             # Test with you, fix issues, retest
/review-and-prep resume  # Reuse results; Greptile when applicable, then ready
```

`/review-and-prep` does not assign a version, prefix the PR title with a version,
write release changelog entries, merge the PR, or deploy. `/ship` keeps its own checks
and version/documentation work; its later pushes can trigger another CI run.

### First run

1. Start on your feature branch with the implementation and its agreed task
   requirements or approved plan available. Install gstack's `/review` with its
   referenced checklist and Greptile triage instructions when applicable.
   Authenticate `gh` with feature-branch push and PR-create access (a fork is fine).
2. Run `/review-and-prep`. The agent checks the base/head, existing PR, CI
   triggers, and Greptile policy, then audits every requirement and runs the
   full local review and required tests. Resolve any scope or policy decisions
   it identifies.
3. The agent commits and pushes the work and creates an unversioned draft PR,
   or resumes the matching draft. If required user testing remains, it saves a
   **PAUSED — manual testing required** receipt and stops with a `/pair-review`
   handoff. Complete the listed checks and return with `/review-and-prep resume`;
   Greptile stays postponed and the PR stays draft during testing and fixes.
   Otherwise, if Greptile applies, it reuses an existing run
   or requests the PR's only draft review, then fixes actionable findings and
   verifies new commits locally. Around 10 minutes, an unfinished review prompts
   an MCP status check; queued/running reviews keep waiting. Without MCP, the
   agent verifies the trigger comment was actually posted and checks bot
   acknowledgment/reviews/checks. A missing trigger gets the first request;
   elapsed time alone never justifies a retry. After 10 minutes with a correct
   posted comment, no verifiable MCP status, and still no response, preparation
   moves on with local checks and an explicit unverified Greptile outcome.
4. Inspect the PR's `## Review and prep` receipt for the scope matrix, review
   stages, test results, and Greptile outcome. When all gates pass, the agent
   marks the PR ready once and returns the PR link plus a continuation prompt.
5. Paste that prompt into a new session to run `/ship`, followed by
   `/land-and-deploy`. `/ship` assigns the version and completes release work;
   deployment verification belongs to `/land-and-deploy`.

An already-ready PR is checked without changing its draft state. A rejected
push caused by rewritten/divergent history stops for user or Conductor
reconciliation; the workflow does not merge old commits back in or force-push.

### Receipt and request markers

This abbreviated receipt shows the shape; real receipts include every scope
item and a separate evidence row for each applicable review stage and check.
Angle-bracket values below are placeholders, not verified results:

```markdown
## Review and prep

Status: **prepared** (written while draft; readiness is checked separately).
Repository: <owner/repo>; PR: <url>; head: <owner:branch>; base: <owner/repo:main>
Prepared at: <UTC>; HEAD: <full-sha>; Git tree: <tree-sha>; base tip: <base-sha>
Scope source: <approved plan link or agreed-task snapshot>; SHA-256: <scope-hash>

| Item | Requirement / acceptance | Disposition | Evidence |
|------|--------------------------|-------------|----------|
| R1 | <requirement and acceptance criterion> | VERIFIED | <source/test link> |
| R2 | <deferred requirement, if any> | DEFERRED BY USER | <explicit decision, rationale, follow-up> |

Scope reconciliation: <total> items; <verified> VERIFIED; <deferred> DEFERRED BY USER;
<partial> PARTIAL; <missing> MISSING; <unverifiable> UNVERIFIABLE.
Readiness requires zero PARTIAL, MISSING, and UNVERIFIABLE items.
Review: <core and per-specialist/adversarial scope, outcome, UTC, content ID>
Tests: <exact command>; cwd: .; <UTC>; exit 0; <counts and output excerpt>
Tested content: <commit/tree>; gstack wtree: <fingerprint, if available>
User testing: <required items, results, tested builds, fix/retest evidence;
OR not required with rationale>
Greptile: <single run URL/ID, trigger time, reviewed SHA/base, findings and fixes,
local verification of later changes; OR unverified — no response after 10 minutes,
trigger-comment URL/time and monitoring evidence; OR explicit skip reason>
Decisions: <policy changes, findings dispositions, user-approved deferrals>
Remaining: /ship version/title/changelog and unperformed audits; merge/deploy.
Deployment context: not inspected.
```

At the manual-testing pause, status is **PAUSED — manual testing required**,
the matrix retains its pending items and concrete test actions, and applicable
Greptile is **postponed — awaiting manual testing**. Resume validates results
against those items and the tested build. The portable receipt carries the
results so a local `/pair-review` state path is not the only evidence.

Before marking ready, the agent mirrors the final receipt in a PR comment with
`<!-- review-and-prep:receipt:<full-sha> -->`. This preserves evidence if `/ship`
later regenerates the body. The comment's author and content fingerprints must
be verified before reusing it.

When no run or submitted request exists and MCP cannot trigger an applicable
Greptile review, the request comment is:

```text
@greptileai review this draft

Please review the current head commit: <full-sha>.
<!-- review-and-prep:greptile:<full-sha> -->
```

Honor either marker only when its author is the authenticated account running
the workflow; ignore markers from anyone else. The request marker prevents
duplicate triggers across the entire PR, even after its head changes. It proves
a request, not a completed review; completion must match the run's recorded
SHA/base. Read the posted comment back to confirm the actual bot call was sent.

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

## /gstack-extend-init — Bootstrap a new project

`gstack-extend init <project>` scaffolds the canonical layout (CLAUDE.md, ROADMAP.md, TODOS.md, PROGRESS.md, CHANGELOG.md, VERSION, docs/), registers the project in `~/.gstack-extend/projects.json`, and runs the post-render audit. Detects per-language test command (bun/cargo/go/python) and seeds CLAUDE.md accordingly.

```bash
gstack-extend init ~/dev/my-new-project           # full bootstrap (interactive)
gstack-extend init ./existing --migrate           # backfill missing canonical files (leaves user-edited alone)
gstack-extend init ./somewhere --dry-run          # preview; no filesystem changes
gstack-extend init ./headless --no-prompt         # headless mode for scripts/CI
```

The CLI is wired into `~/.local/bin/gstack-extend` by `setup` (PATH-permitting); invoke directly via `~/.claude/skills/gstack-extend/bin/gstack-extend init ...` if `~/.local/bin` isn't in your PATH. The `/gstack-extend-init` slash skill wraps the same CLI with conversational UX for Claude Code sessions.

Reserved subcommands (stubs today): `list`, `status`, `doctor`, `migrate`. Each prints `coming in a future Group — reserving namespace`.

---

## /gstack-extend-upgrade — Upgrade gstack-extend

A first-class upgrade path for gstack-extend itself, mirroring gstack's own
`/gstack-upgrade`. The same flow runs automatically inside every gstack-extend skill's
preamble when a periodic check detects a new version — this skill is the standalone
entry point for checking or upgrading on demand.

- **One canonical flow** — the upgrade procedure is a single drift-locked block shared by all skill preambles and this skill; no more divergent copies
- **Fast-forward only** — `bin/update-run` pulls with `--ff-only`; a diverged local `main` fails safely instead of destroying work, and the branch + stash are restored on any mid-run failure
- **Honest reporting** — every run emits exactly one `UPGRADE_OK` / `UPGRADE_FAILED` line; the skill never claims success without `UPGRADE_OK`
- **Install migrations** — after setup, `migrations/v*.sh` in the version window run once via an applied/failed ledger. A failed script prints `MIGRATION_WARN` and still reports `UPGRADE_OK`; retry with `bin/update-run`
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
