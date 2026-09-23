# TODOS

## Unprocessed

### [review:severity=necessary] Harden /review-and-prep Greptile-once and pause/resume edge cases
- **Description:** The /ship Claude adversarial pass on PR #102 (v0.26.2.0) found workflow-logic gaps in `skills/review-and-prep.md` that the GPT-6 in-host review did not raise. Under Greptile's default trigger settings, marking a draft ready can start a second run that the Greptile-once rule forbids, and the skill offers no resolution beyond "resolve the trigger conflict." A failed or cancelled run consumes the allowance, cannot be retried, and cannot use the no-response fallback, so the PR has no path to ready unless a policy skip is offered. The PAUSED receipt lives only in the PR body, which /ship regenerates, and /pair-review's own completion path recommends /ship directly. An ambiguous MCP trigger with no visible run and no comment has no bounded exit. A session that dies between an MCP trigger and the first receipt write loses the reservation. The post-fallback rules disagree when a run becomes visible as queued/running before ready. A reviewed SHA that is no longer an ancestor of HEAD still satisfies the gate.
- **Hypothesis (untested):** Offer a user decision on failure/cancellation and at the fallback boundary instead of a silent block or pass; post the receipt comment at the PAUSED checkpoint and record trigger comment IDs before calling MCP; bound "uncertain" MCP status with a run-history check; require the reviewed SHA to be an ancestor of HEAD or treat the PR as having no usable run.
- **Effort:** M (human: ~1 day / CC: ~30 min)
- **Priority:** P2
- **Context:** Deferred at /ship on 2026-09-06. Each item changes designed behavior the user specified for PR #102 (Greptile-once, the 10-minute fallback), so it needs a product decision rather than a mechanical fix. The full finding list is in the PR #102 body under Adversarial Review.

### [manual] File upstream: gstack-skill-start accepts --model and drops it

- **Description:** gstack's `gstack-skill-start` parses `--model` into `MODEL_OVERLAY` for the preamble but never persists it, and `gstack-telemetry-log` writes a fixed row with no model or agent field. No row in `~/.gstack/analytics/skill-usage.jsonl` can say which vendor ran a gstack skill. gstack-extend's own skills now record this in the local-only `stage-runs.jsonl` (see docs/telemetry.md, Execution provenance); gstack's skills still cannot.
- **Hypothesis (untested):** Upstream could read the harness session logs the way `bin/lib/telemetry.py` does, rather than trusting a `--model` value the model supplies about itself.
- **Effort:** S (human: ~1h to write the issue / CC: ~10min)
- **Priority:** P2
- **Context:** Found on 2026-09-21 while adding execution provenance to the gstack-extend telemetry wrapper. The fix is upstream and cannot be made here. Hand-run skills keep producing rows through the transition to orchestrated runs, so the gap persists until gstack records it.

### [plan-ceo-review:defer=true] In-flight marker and crash detection for extend telemetry

- **Description:** Persist start state durably so a finish that loses its arguments can still be paired, and so an abandoned session is finalized rather than vanishing. The originally proposed form wrote `~/.gstack/analytics/extend-inflight/<session-id>` and swept stale markers. A narrower form (start/finish state handoff under `~/.gstack-extend/`, no sweep) was accepted into the telemetry track itself; this TODO covers only the remaining crash-detection half.
- **Hypothesis (untested):** With the state handoff landed, pairing is already high enough that crash detection adds little; measure before building.
- **Pros:** Closes the last gap where an abandoned run leaves no honest record.
- **Cons:** Rebuilds the phantom-row failure class that Track 13A finding R2 (commit `bc9f9f9`) deliberately removed. Concurrent same-skill sessions have no defined marker-selection rule. A legitimate 4.6-hour run exists in the live data, so any age bound is a guess. Cannot observe an invocation whose start never ran.
- **Effort:** L (human: ~3d / CC: ~1.5h)
- **Priority:** P3
- **Depends on:** None. The doctor command (`gstack-extend doctor telemetry`) shipped with the telemetry track; its 30-day report after rollout supplies the baseline that decides whether this is needed
- **Context:** Deferred at /autoplan on 2026-09-20. Gate it on measured per-skill pairing. Note that `pair-review`, `review-and-prep` and `test-plan` are resumable by design and legitimately show more starts than finishes, so a low ratio for those is not evidence for this work.

### [plan-ceo-review:defer=true] Spike a gstack-extend-shipped PreToolUse Skill hook

- **Description:** Test whether a hook shipped by gstack-extend's `setup` can capture skill activation deterministically, independent of whether the model executes a bash block. gstack already ships five hooks under `hosts/claude/hooks/`, so the pattern is established in this ecosystem.
- **Hypothesis (untested):** A hook is the only mechanism that fixes "the model skipped the block," which is the one failure mode no in-skill instrumentation can catch.
- **Pros:** Structural fix rather than a shorter instruction. Would also cover gstack's own skills.
- **Cons:** Claude Code only. `hosts/grok/config.toml` sets `hooks = false`, and Codex and OpenCode have no equivalent surface, while `setup` installs to all of them. It would be an additive layer, not a replacement, so total mechanisms increase.
- **Effort:** M (human: ~1d / CC: ~30min)
- **Priority:** P2
- **Depends on:** None
- **Context:** Deferred at /autoplan on 2026-09-20. Verified during that review: `~/.claude/settings.json` already registers `PreToolUse matcher:"Skill"` pointing at the personal config repo's `log-skill-usage`, and that script works when fed a correct event. But its output file has never persisted on this machine even though `full-review` is allowlisted and has run, and its `analytics/` directory is gitignored so there is no history to audit. Prove it fires in situ before designing on it.

### [plan-ceo-review:defer=true] Price the upstream gstack patch before forking telemetry state

- **Description:** Evaluate patching gstack's finalize loop to skip extend-namespaced markers instead of routing extend state around it.
- **Hypothesis (untested):** The upstream change is a one-line `-not -name '.pending-extend-*'`, which would be cheaper than maintaining divergence.
- **Pros:** Keeps extend on gstack's shared state model.
- **Cons:** Cross-repo coordination; needs a gstack release before extend can depend on it.
- **Effort:** S (human: ~4h / CC: ~20min)
- **Priority:** P3
- **Depends on:** the marker TODO above; if that is dropped, this closes with it
- **Context:** Deferred at /autoplan on 2026-09-20. Track 13A R2 explicitly anticipated "a future cross-repo Track that namespaces markers and patches gstack proper to skip them." Both repos have the same owner.

### [plan-eng-review:defer=true] Replace the five SHARED-block cohorts with a per-skill capability table

- **Description:** `tests/skill-protocols.test.ts` maintains PROTOCOL, PREAMBLE, CONDUCTOR and NON_PREAMBLE_SETUP cohorts, plus the TELEMETRY cohort the telemetry track added, plus an independently hardcoded expected list. Replace them with one declarative table: one row per skill, one column per SHARED block.
- **Hypothesis (untested):** One table removes the class of bug where two overlapping cohorts disagree about the same skill.
- **Pros:** Adding a SHARED block becomes a column rather than a cohort plus three invariants.
- **Cons:** Refactors the file that guards every skill contract, and it is the most-churned file in the repo (11 touches in 30 days).
- **Effort:** M (human: ~1d / CC: ~30min)
- **Priority:** P3
- **Depends on:** None (the telemetry cohort has landed)
- **Context:** Deferred at /autoplan on 2026-09-20 as FINDING 10.1. Deliberately out of that track's blast radius. Related trap found in the same review: the exclusion invariant that asserted three skills carry no SHARED marker at all was narrowed rather than deleted when telemetry landed (now the "non-preamble setup skills carry only telemetry SHARED blocks" describe in `tests/skill-protocols.test.ts`).

### [ship] Follow-ups deferred from the telemetry coverage review

- **Description:** Small gaps found while reviewing the telemetry track (PR #105) and deliberately left out. (1) The wrapper finds gstack's helpers only under `~/.claude/skills/gstack/bin`, so a Codex-only or OpenCode-only machine records nothing; probe the host runtime roots too and have the doctor warn when neither helper resolves. (2) `setup --uninstall` removes the `gstack-extend` link from `~/.local/bin` but not the `gstack-extend-telemetry` link it also wired. (3) `finish` run from a different repository root than `start` silently drops the completion, and a `finish` whose start was skipped adopts an abandoned earlier handoff (no age bound; needs a product call because resumable skills legitimately span days). (4) The upgrade preambles in the six preamble skills still probe the cwd-relative `.claude/skills/<skill>/.extend-root` and execute `$_EXTEND_ROOT/bin/update-check`; harden them the way the telemetry blocks now are. (5) The `audit-snapshots`, `audit-cli-contract`, and `parsers-roadmap` tests register `process.on('exit')` cleanup, which never fires under `bun test`; move them to `afterAll` (the telemetry helper already did).
- **Effort:** M (human: ~1d / CC: ~45min)
- **Priority:** P3
- **Context:** Deferred at /ship on 2026-09-21. The concurrent same-skill handoff collision and the unbounded doctor transcript walk are accepted limits documented in `docs/telemetry.md`, so they are not repeated here.


### [manual] Revalidate telemetry and execution-provenance contracts for an external consumer

- **Description:** v0.27.2.0 and v0.28.0.0 shipped skill telemetry and local execution provenance. An external consumer needs to join its own orchestrated run records against these rows. Revalidate the contract against actual emitted data: whether rows appear for every run, whether the producer is identifiable per row, whether the live schema matches `docs/telemetry.md`, and which join keys are stable. Record observed coverage, gaps, and join evidence; this is verification work, not construction, and release claims are not acceptance evidence.
- **Effort:** M (human: ~1d / CC: ~30min)
- **Priority:** P0
- **Depends on:** None
- **Context:** External delivery dependency for an external consumer, an orchestration layer that spawns gstack pipeline stages across vendors. Unblocks 1 downstream track. Across these four P0 items, 7 of its 21 tracks can be built against fixtures but cannot close until the dependencies land; these entries schedule work previously recorded only in the consuming project.

### [manual] Quota ledger, with Cursor capacity as an open question

- **Description:** Nothing measures quota spent per stage per configuration; all current figures are wall-clock. Codex and Claude expose readable remaining-capacity endpoints. The Grok Build endpoint is unusable for this purpose because Grok now runs through Cursor (`cursor-agent` or natively in Conductor). Whether Cursor capacity is readable, and whether the CLI and Conductor routes share a pool, are open questions. Acceptance requires evidence of consumption attributable to stage and configuration, documented capacity-read results and pool relationships, and distinct model-vendor and capacity-pool fields: review independence follows the vendor, while capacity follows the pool, which may serve several vendors. A failed capacity read must degrade to a local consumption ledger and must never be interpreted as "no quota."
- **Effort:** L (human: ~3d / CC: ~1.5h; provisional pending planning)
- **Priority:** P0
- **Depends on:** None
- **Context:** Unblocks 4 downstream tracks for an external consumer, making this the most blocking of the four P0 dependencies. A separate planning session is underway; this entry records the problem and required acceptance evidence, leaving the design to that session.

### [manual] Re-scope review independence for the Cursor harness

- **Description:** The measured Grok Build review composition was Grok structured, Grok adversarial, and Astra as author, with no Claude participating; the planned fix targets that shape. Grok Build is no longer the harness, so that measurement is historical. Probe the Cursor route now in use and document the actual voice composition before deciding whether a fix is needed: the collapse may persist, differ, or have disappeared. Acceptance for any fix is that every review carries at least one voice from a vendor that neither wrote the code nor ran the primary review, provable from recorded execution provenance rather than assignment.
- **Effort:** M (human: ~1d / CC: ~30min; fix scope depends on the probe)
- **Priority:** P0
- **Depends on:** None for the probe; any fix depends on its findings and a verified execution-provenance contract for acceptance
- **Context:** Unblocks 3 downstream tracks for an external consumer. Probe the current route before scheduling the historical fix; coordinate final acceptance with the telemetry and execution-provenance revalidation above so downstream independence claims rest on observed vendor participation.

### [manual] Shadow merge gate and complexity budget

- **Description:** Add a standalone `bin/merge-gate` that answers "would merge: yes/no, and why" for any PR, including whether it exceeds a complexity budget covering net lines, new files, new dependencies, and new public API. It operates only in shadow mode. Acceptance requires versioned verdicts with raw reasons, preserved decision-time evidence so later backtests cannot use hindsight, and demonstrable inability to perform a merge. The consuming project builds and scores the backtest against its own defect set; that backtest is not a dependency of this work.
- **Effort:** L (human: ~3d / CC: ~1.5h)
- **Priority:** P0
- **Depends on:** None; the consuming project's backtest is downstream
- **Context:** Unblocks 1 downstream track for an external consumer by supplying shadow verdicts and the preserved evidence needed for its backtest. This can proceed independently of the quota and review-independence work; merge execution is outside its scope.

### [plan-ceo-review:defer=true] Publish the quota ledger's transcript-parsing corpus for other token readers

- **Description:** The quota ledger adds another parser for Claude JSONL, Codex rollouts and Cursor transcripts beside `bin/lib/telemetry.py`. Other tools that count tokens from the same logs will drift from it on subtle rules: the ledger keeps the highest-`output_tokens` entry per Claude message id because streaming partials carry low counts (121 of 418 split message ids differed in this repo's transcripts), counts Codex increments within counter epochs, and treats a forked rollout's line-2 `session_meta` as a copy. Publish the scrubbed fixtures with their expected token totals as a documented, versioned corpus that any reader can run to check parity. gstack-extend depends on no outside reader.
- **Hypothesis (untested):** A corpus of expected totals, rather than a shared parser module, gives other tools parity with no dependency in either direction.
- **Effort:** M (human: ~1d / CC: ~30min)
- **Priority:** P3
- **Depends on:** The quota ledger track (its fixtures become the corpus)
- **Context:** Deferred at /autoplan on 2026-09-23 (CEO native voice, finding 10). Outside the quota track's blast radius. Plan and review record: `~/.gstack/projects/kbitz-gstack-extend/quota-ledger-plan.md`.

### [plan-eng-review:defer=true] Opt-in per-skill quota hook for hand-run skills

- **Description:** The quota ledger track records quota only through explicit `gstack-extend quota` commands and the `quota sample` start/attach/finish lifecycle. Hand-run gstack-extend skills (roadmap, pair-review, implement, and the rest) record no quota. A follow-up would let telemetry start/finish spawn the quota sampler for the running skill, off by default and enabled per machine.
- **Hypothesis (untested):** Calling `quota sample` from the hook keeps it small; the hard parts are the attribution rules already designed in the quota plan: the quota-only telemetry handoff, retried finishes, pause and resume across harness sessions, nested extend skills, skills run inside Claude subagents, and deduplication against a caller that also brackets the stage.
- **Effort:** M (human: ~1-2d / CC: ~1h)
- **Priority:** P3
- **Depends on:** The quota ledger track
- **Context:** Deferred at /autoplan on 2026-09-23 when the user chose caller-driven sampling first. The hook must ship opt-in: an upgrade alone must never start vendor API calls. The deferred rules are listed in the plan's Review record (`~/.gstack/projects/kbitz-gstack-extend/quota-ledger-plan.md`, requirement U-01).

### [manual] Keep gstack-extend independent of the maintainer's personal tooling

- **Description:** gstack-extend should stand on its own. Its features must be usable by any caller, and no shipped artifact (code, docs, tests, TODOS entries, CHANGELOG, commit or PR text) should require or name the maintainer's private orchestrator or personal cross-machine tooling. Several current references do: (1) `README.md:19` and `CLAUDE.md:39` contrast telemetry rows with a personal tool's transcript counts; (2) `docs/telemetry.md:17-22` explains that difference by name (the quota ledger track rewords this section); (3) the Context lines of the four P0 `[manual]` entries above (telemetry revalidation, quota ledger, review independence, shadow merge gate) name the consuming orchestrator; (4) `CLAUDE.md:42`, `docs/telemetry.md:17-18` and `docs/telemetry.md:102` describe the provenance schema as shared with a specific orchestrator, when it should read as gstack-extend's own documented contract that any consumer can join against. Reword each generically, for example "an external consumer" or "transcript-derived counts from other tools". Historical entries in `CHANGELOG.md`, `docs/PROGRESS.md` and `docs/roadmap-shipped.md` are release history; decide separately whether to leave or reword them. Add a short consumer-agnostic rule to `CLAUDE.md` so new work follows it.
- **Hypothesis (untested):** A local-only check (names supplied by the maintainer's environment, never committed) can flag regressions before review without the repository naming the tools it guards against.
- **Effort:** S (human: ~2h / CC: ~15min)
- **Priority:** P2
- **Depends on:** None
- **Context:** Raised by the maintainer on 2026-09-23 during /autoplan of the quota ledger (plan requirements G-01 and G-02), after reviewers found these references.

## Completed

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
