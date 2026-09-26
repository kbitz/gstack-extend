# TODOS

## In Progress

### [manual] Native Cursor host installation
- **Description:** Add `setup --host cursor` and auto-detection through the Cursor command or home directory. Generate native skill copies with ownership-safe refresh and uninstall, verified home-root probes, and telemetry pointer discovery.
- **Scope:** Included in Track 16D's PR #113 on 2026-09-25. This explicitly expands its original fence to `setup`, the two additional telemetry-only skills, `tests/telemetry.test.ts`, and the canonical blocks in `docs/telemetry.md`; coordinate the setup overlap with Track 16E during review and prep.
- **Decision:** When `cursor` is on PATH but `~/.cursor` is absent, create the skill directory. When Cursor is absent, leave it absent. Strip `allowed-tools` as Codex does.
- **Status:** Implementation on the PR branch; review, version assignment, and release bookkeeping remain with the normal review and ship stages.

## Unprocessed

### [plan-ceo-review:track=16D,defer=true] Decide whether PATH is inside the trust boundary for the telemetry wrapper lookup
- **Description:** `SHARED:telemetry-start` and `SHARED:telemetry-finish` look up `gstack-extend-telemetry` on PATH first. They accept any absolute PATH entry that holds a file with the protocol marker, so an agent environment whose PATH a repository can shape (a direnv `PATH_add`, say) could run a planted wrapper. Track 16D treats the process environment as trusted and pins only `GSTACK_EXTEND_DIR` for `bin/update-check`. Decide whether the telemetry lookup should also prefer home-anchored pointers over PATH, or whether a trusted environment is the documented contract.
- **Hypothesis (untested):** Agent harness Bash tools run non-interactive shells that do not fire direnv hooks, so the exposure may be theoretical. Measure before changing lookup order.
- **Effort:** S (human: ~2h / CC: ~15min)
- **Priority:** P3
- **Depends on:** Track 16D (its threat-model statement is the baseline)
- **Context:** Deferred at /autoplan on 2026-09-25 (CEO native voice finding 5, reframed by the Eng dual voices). Plan and review record: `~/.gstack/projects/kbitz-gstack-extend/kbitz-harden-upgrade-preambles-plan.md` (CEO-A19, CEO-A23, ENG-A1).

### [plan-ceo-review:track=16D,defer=true] Stop `setup` injecting an unescaped HOME into generated skill bodies
- **Description:** `rewrite_skill_body` (`setup:144-179`) rewrites every `~/.claude/skills/<name>` in a skill into a literal `${HOME}/.codex/skills/<name>` (or the OpenCode path) with sed, unquoted. A HOME containing spaces or shell metacharacters then changes how the generated bash parses. Track 16D moved the resolver loops to quoted `"$HOME"` paths so they are never rewritten. Other rewritten occurrences, such as the test-plan Phase 8 path and prose, still receive the literal.
- **Hypothesis (untested):** Rewriting to a quoted `"$HOME"/.codex/skills/<name>` form, or leaving `~` for the host to expand, removes the injection without changing any resolved path.
- **Effort:** S (human: ~2h / CC: ~15min)
- **Priority:** P3
- **Depends on:** None. `setup` belongs to Tracks 16E and 17B, so schedule after them or fold into 17B.
- **Context:** Deferred at /autoplan on 2026-09-25 (CEO dual voices: Codex finding 3, native finding 4). Plan: `~/.gstack/projects/kbitz-gstack-extend/kbitz-harden-upgrade-preambles-plan.md` (CEO-A18, CEO-A23).

### [plan-ceo-review:track=16D,defer=true] Prefer the invoking host's install when Claude and Codex point at different checkouts
- **Description:** The Track 16D resolver probes Claude, then Codex, then OpenCode. On a machine where the Claude install points at checkout A and the Codex install at checkout B, a Codex session resolves A, so `/gstack-extend-upgrade` updates A while the Codex copies generated from B stay stale. Reorder the probes by host, using the harness env markers (`CODEX_THREAD_ID`, `CODEX_SANDBOX`, `CLAUDECODE`), which only reorder home-anchored candidates. When two distinct verified roots exist, print one ambiguity line naming both.
- **Hypothesis (untested):** Split checkouts are rare because `setup --host auto` installs every host from one checkout. The README split-checkout note may be enough; count real reports before building.
- **Effort:** S (human: ~3h / CC: ~20min)
- **Priority:** P3
- **Depends on:** Track 16D (canonical resolver span)
- **Context:** Deferred at /autoplan on 2026-09-25. The DX Codex voice rated this High; the CEO native voice called it harmless. Decision DX-A15 in `~/.gstack/projects/kbitz-gstack-extend/kbitz-harden-upgrade-preambles-plan.md`.

## Completed

### [manual] Keep gstack-extend independent of the maintainer's personal tooling
- **Description:** gstack-extend should stand on its own. Its features must be usable by any caller, and no shipped artifact (code, docs, tests, TODOS entries, CHANGELOG, commit or PR text) should require or name the maintainer's private orchestrator or personal cross-machine tooling. Reword references generically and add a consumer-agnostic rule to `CLAUDE.md`.
- **Effort:** S (human: ~2h / CC: ~15min)
- **Priority:** P2
- **Context:** Raised by the maintainer on 2026-09-23 during /autoplan of the quota ledger (plan requirements G-01 and G-02).
- **Completed:** v0.29.0.0 (2026-09-24). Discharged at /roadmap@a646c94: no live `*.md`/`*.py`/`*.ts`/`*.sh`/`setup` artifact names the tooling, `CLAUDE.md` carries the "Consumer independence" section, and the P0 inbox entries already read "an external consumer". A local-only regression check is by design never committed. Release history in CHANGELOG, PROGRESS, and roadmap-shipped was left as-is at discharge, then reworded to generic cross-machine wording on this branch.

### [manual] Quota ledger, with Cursor capacity as an open question

- **Description:** Nothing measures quota spent per stage per configuration; all current figures are wall-clock. Codex and Claude expose readable remaining-capacity endpoints. The Grok Build endpoint is unusable for this purpose because Grok now runs through Cursor (`cursor-agent` or natively in Conductor). Whether Cursor capacity is readable, and whether the CLI and Conductor routes share a pool, are open questions. Acceptance requires evidence of consumption attributable to stage and configuration, documented capacity-read results and pool relationships, and distinct model-vendor and capacity-pool fields: review independence follows the vendor, while capacity follows the pool, which may serve several vendors. A failed capacity read must degrade to a local consumption ledger and must never be interpreted as "no quota."
- **Effort:** L (human: ~3d / CC: ~1.5h; provisional pending planning)
- **Priority:** P0
- **Depends on:** None
- **Context:** Unblocks 4 downstream tracks for an external consumer, making this the most blocking of the four P0 dependencies. A separate planning session is underway; this entry records the problem and required acceptance evidence, leaving the design to that session.
- **Completed:** v0.29.0.0 (2026-09-24)

### Failed-ledger retry with non-semver NEW aborts the helper

**What:** Do not call `version_gt` / `semver_lte` unless NEW is semver. If NEW is `unknown` (or any letter-bearing string), skip the compare and either retry every failed name or leave them queued.

**Why:** After 15B, the window skip refuses non-semver OLD/NEW, then the failed-ledger path still calls `semver_lte VER unknown`. Under `set -u`, `(( 1 > unknown ))` is unbound and the EXIT trap kills the helper before the retry runs.

**Context:** Red-team finding after v0.24.5.0 landed (PR #96). Reproduced: `bash -c 'set -u; bi=unknown; (( 1 > bi ))'`. File: `bin/lib/run-migrations.sh` failed-path `semver_lte`. No production `migrations/v*.sh` yet — fix before the first real script.

**Effort:** S
**Priority:** P1
**Depends on:** None
**Completed:** v0.24.6.0 (2026-08-15)

### Setup-fail after pull drops in-window migrations forever

**What:** Persist the pre-pull version (or pre-register in-window names into `migrations-failed`) before `./setup`. A later `update-run` must still see those names when OLD==NEW.

**Why:** Pull advances VERSION, then setup can exit 1 (`no bun`, install-safety). The helper never runs. Next hop reads OLD==NEW, so unstarted in-window scripts are not in the failed ledger and never execute. Same hole if the helper aborts mid-scan.

**Context:** Red-team finding after v0.24.5.0. Not the deferred first-hop chicken-and-egg (old binary missing the call site). This is every post-15B hop whose helper does not finish after VERSION already moved. `bin/update-run` setup is ~line 122; helper only runs if setup returned.

**Effort:** S
**Priority:** P1
**Depends on:** None
**Completed:** v0.24.6.0 (2026-08-15)

### Helper-path tests before the first real `v*.sh`

**What:** Add fixtures for: helper missing-args / missing semver.sh / bad-version; empty `migrations/` (`.gitkeep` only); symlink and non-semver name skip; fail-then-succeed clears `migrations-failed`; unexpected helper abort emits `MIGRATION_WARN helper`.

**Why:** Post-ship coverage audit scored 69% on the 15B hook. Those branches are how the two P1 holes hide. Tests should exist before any install-mutating script ships.

**Context:** Coverage audit after PR #96. Do not file each gap as its own item. Bundle lives here; implement with the P1 fixes.

**Effort:** S
**Priority:** P2
**Depends on:** The two P1 upgrade items above (same PR is fine)
**Completed:** v0.24.6.0 (2026-08-15)
