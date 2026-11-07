# TODOS

## Unprocessed

### [review:files=bin/lib/telemetry.py] Test gap: structured transcript resume forms
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Structured text/image, empty, mixed tool and isMeta user records lack dedicated resume-count assertions.
- **Hypothesis (untested):** Extend the existing synthetic transcript fixture and independently assert counts for each form.
- **Upstream severity:** INFORMATIONAL
- **Found in:** bin/lib/telemetry.py
- **Evidence:** Read-only coverage audit of d6163e2; existing assertions inspected; no failure reproduced for this gap.
- **Context:** Filed by /review-and-prep on branch mmm/471c8d3a (PR not yet created), 2026-11-07.
- **Effort:** ? (user triages in /roadmap)

### [review:files=bin/lib/telemetry.py] Test gap: signal-reader exception isolation
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The signal reader exception fallback has no direct test; missing and FIFO fixtures return normally.
- **Hypothesis (untested):** Inject a reader exception at the existing callable boundary and assert a complete row with unavailable signals.
- **Upstream severity:** INFORMATIONAL
- **Found in:** bin/lib/telemetry.py
- **Evidence:** Read-only coverage audit of d6163e2; existing assertions inspected; no failure reproduced for this gap.
- **Context:** Filed by /review-and-prep on branch mmm/471c8d3a (PR not yet created), 2026-11-07.
- **Effort:** ? (user triages in /roadmap)

### [review:files=bin/lib/telemetry.py] Test gap: missing installed skill metadata
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Report behavior when the installation skills directory is absent or unreadable lacks a dedicated test.
- **Hypothesis (untested):** Use an isolated installation and assert installed_skills null with observed stages retained.
- **Upstream severity:** INFORMATIONAL
- **Found in:** bin/lib/telemetry.py
- **Evidence:** Read-only coverage audit of d6163e2; existing assertions inspected; no failure reproduced for this gap.
- **Context:** Filed by /review-and-prep on branch mmm/471c8d3a (PR not yet created), 2026-11-07.
- **Effort:** ? (user triages in /roadmap)

### [review:files=bin/lib/telemetry.py] Test gap: report filesystem error diagnostics
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** OS enumeration, open and mid-read exceptions lack direct diagnostic assertions.
- **Hypothesis (untested):** Inject isolated filesystem failures and assert unreadable diagnostics while other ledgers remain counted.
- **Upstream severity:** INFORMATIONAL
- **Found in:** bin/lib/telemetry.py
- **Evidence:** Read-only coverage audit of d6163e2; existing assertions inspected; no failure reproduced for this gap.
- **Context:** Filed by /review-and-prep on branch mmm/471c8d3a (PR not yet created), 2026-11-07.
- **Effort:** ? (user triages in /roadmap)

### [review:files=skills/review-and-prep.md] Test gap: installed-agent specialist waiver and receipt history
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Static prompt locks and CLI probes do not execute the new delegate/fold waiver and mixed-cycle receipt instructions.
- **Hypothesis (untested):** Exercise active delegation and folding with declared and absent dispatch items, successful and failed waiver calls, and later fully dispatched cycles; inspect actual dispatches, waiver commands and retained receipt history.
- **Upstream severity:** INFORMATIONAL
- **Found in:** skills/review-and-prep.md:1446
- **Evidence:** The coverage audit traced 17 of 18 paths to valuable tests. The remaining path is installed-agent behavior; no failure was reproduced, and the acceptance record claims no live-agent proof.
- **Context:** Filed by /review-and-prep on branch `mmm/c424e0f7` at `b52ad298` (2026-11-06), before PR creation.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The next Track touches these waiver or receipt instructions.

### [review:files=src/audit/lib/pack.ts|tests/lib-pack.test.ts] Test gap: collision-contract rule edges without vectors
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Four collision-contract/v1 edges have no test: `docs/CLAUDE.md` stays a collision when listed in `shared_docs` (only root `CLAUDE.md` has a vector); an uppercase `(NEW)` marker still exempts a new file under a bare folder; `folderOnlyCollisions` honors the `shared_docs` rules; `identCollisions` and `packIdent` drop a marker-listed doc.
- **Hypothesis (untested):** Add vector rows to `tests/fixtures/collision-vectors.json` for the first two and assertions in `tests/lib-pack.test.ts` for the rules arguments; re-verify the behavior first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** src/audit/lib/pack.ts:104
- **Evidence:** The /ship coverage audit traced 16 of 20 changed paths to star-2 or star-3 tests (80% value-weighted, gate PASS); these four had none. No failure was reproduced.
- **Context:** Filed by /review-and-prep on branch `mmm/4b0e03c5` at `fe91171` (2026-11-06), before PR creation.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The next Track touches the collision contract or its vectors.

### [review:files=skills/roadmap.md|tests/skill-protocols-roadmap.test.ts] Test gap: drift lock for the CLAUDE.md never-shared sentence
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The /roadmap sentence that `CLAUDE.md` is never shared and only one Track per Group may declare it has no drift lock, while the sentence before it (which points at it) is locked.
- **Hypothesis (untested):** Add one `toContain` assertion to the collision-driven grouping describe in `tests/skill-protocols-roadmap.test.ts`.
- **Upstream severity:** CRITICAL (native adversarial FIXABLE classification; Low impact, does not block)
- **Found in:** skills/roadmap.md:958
- **Evidence:** Cycle 3 delta review of the reworded sentence; all existing locks still match. No failure was reproduced.
- **Context:** Filed by /review-and-prep on branch `mmm/4b0e03c5` at `fe91171` (2026-11-06), before PR creation.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The next Track edits Collision-driven grouping in skills/roadmap.md.

### [review:files=src/audit/lib/pack.ts|src/audit/touches-cli.ts] Flag a (new) marker on a path that already exists
- **Description:** collision-contract/v1 trusts the `(new)` marker: a `(new)` entry on an existing file removes its collision with another Track's folder entry, and `roadmap-touches drift` accepts it. The approved plan accepted this risk; nothing checks it mechanically.
- **Proposal:** Report a declared `(new)` path that exists at the merge base (drift) or in the base tree for unshipped Current Plan Tracks (audit), not the Track's own branch.
- **Evidence:** Red Team and native adversarial review of PR branch `mmm/4b0e03c5`; `collisionKind(['src/audit/'], ['src/audit/index.ts (new)'])` returns `none`.
- **Context:** Filed by /review-and-prep on branch `mmm/4b0e03c5` at `fe91171` (2026-11-06), before PR creation.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** A merge conflict appears between Tracks the packer ran in parallel because of a `(new)` marker.

### [review:files=src/audit/touches-cli.ts] roadmap-touches does not apply the shared_docs marker or the (new) rule
- **Description:** `drift` and `report-cross-group` call `isSharedDoc` and `schedulingTouches` without rules, so an undeclared edit to a marker-listed doc fails drift and cross-group reports still list pairs the packer treats as disjoint. The plan declined this scope.
- **Proposal:** Read the marker with the same CLAUDE.md resolver and pass the rules, or document that listed shared docs must still be declared in `_touches:`.
- **Evidence:** Red Team and native adversarial review of PR branch `mmm/4b0e03c5`.
- **Context:** Filed by /review-and-prep on branch `mmm/4b0e03c5` at `fe91171` (2026-11-06), before PR creation.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** A user or orchestrator reports the cross-group report or drift disagreeing with the packer.

### [review:files=src/audit/lib/pack.ts|src/audit/lib/parallelism-cap.ts|docs/collision-contract.md] Tighten roadmap marker recognition
- **Description:** A partial `<!-- roadmap:shared_docs=` opener in prose, or a full-form example in a code span or fenced block, still counts as the marker and hides the real one below it (fails safe: listed docs stay serialized). The contract states the code-span case but not the partial opener; the `sharedDocsMarker` JSDoc and one lib-pack test title still say only an HTML comment counts. `parallelism_cap` matches plain prose, unlike docs-ship markers, which skip fences and inline code.
- **Proposal:** Reuse docs-ship's fenced-line and inline-code masking for roadmap markers, or state each limit precisely and fix the stale comment and test title.
- **Evidence:** Cycle 3 native adversarial probes against `sharedDocsMarker` and `parallelismCap`.
- **Context:** Filed by /review-and-prep on branch `mmm/4b0e03c5` at `fe91171` (2026-11-06), before PR creation.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** A project reports a marker read from an example or a prose mention.

### [review:files=src/audit/lib/pack.ts|src/audit/checks/collisions.ts|src/audit/pack-cli.ts] Protect the project instructions file by identity, not literal name
- **Description:** The shared_docs guard and the COLLISIONS one-owner rule compare literal `CLAUDE.md` and `docs/CLAUDE.md`. Listing the target of a symlinked `CLAUDE.md` (the documented example uses `AGENTS.md`) makes the instructions file shared; the one-owner rule treats `CLAUDE.md` and `docs/CLAUDE.md` as one claim while the packer treats them as unrelated paths (pre-existing on main), so a project with both files can get a Group that COLLISIONS fails.
- **Proposal:** Resolve the instructions file's repository-relative target in the CLI layer and pass it as a protected path; give `CLAUDE.md` and `docs/CLAUDE.md` one rule; consider a neutral marker example.
- **Evidence:** Red Team and native adversarial review of PR branch `mmm/4b0e03c5`; documented as a caveat in docs/collision-contract.md for now.
- **Context:** Filed by /review-and-prep on branch `mmm/4b0e03c5` at `fe91171` (2026-11-06), before PR creation.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** A project uses the shared_docs marker with a symlinked or docs/ CLAUDE.md.

## Completed

### [manual] Cut repeated review work in /review-and-prep without changing gstack

- **Why:** Repeated reviewer fan-out on the whole branch diff is most of a review's usage. Private review observations found repeated whole-branch sweeps, lower usage in a repair-only continuation, and later full sweeps whose specialists returned no findings. The defects came from the native adversarial pass and the outside voices. When `/review` stops at its three-cycle cap (`converged:false`), `/review-and-prep` has no instruction at all, so a person decides each continuation ad hoc.
- **Effort:** M (~560 lines incl. tests)
- **Priority:** P2
- **Context:** Owner request, 2026-10-20; plan `plans/2026-10-20-review-and-prep-repeat-work.md` in the project's gstack notes. Scope, wrapper-only: (1) a cycle-stop exit that commits and pushes the draft, writes a STOPPED receipt, never runs a fourth pass or a new `/review` in that invocation, and prints a continuation prompt for a fresh session; an optional, versioned caller policy line (`Review policy: review-and-prep-policy/v1; in-cap=delta|full; continuation=repair-only|full|stop; documentation-audit=final; full-suite=final; max-continuations=<n>`) that the prompt carries verbatim, which hand runs omit (they get a three-option question instead), and which never waives a gate; documented as the additive H-E continuation shape in `docs/workflow-handoffs.md`. (2) Delta-scoped wrapper re-reviews, opt-in through that policy or a direct request: substitute the last reviewed commit for every diff and scope command of the nested `/review` so gstack's own gates pick reviewers for the delta, record each skip with gstack's reason, keep the native adversarial pass and the outside challenge, and use full scope for conflicted base merges, scope changes, rewritten history and unknown dependencies. (3) Final messages restate no receipt or matrix; long evidence goes to files; independent Step 1 reads run in parallel. (4) A local-only `voices.jsonl` naming each reviewer subagent's host identifier and parent-observed dispatch/return times, never in the PR body. (5) With `in-cap=delta` and a passing drift check (the installed `/review` still carries the exact Step 5.8 text it narrows), `/review`'s own cycles 2–3 review only the previous cycle's fixes: a dangling snapshot commit built through a temporary index marks each cycle's candidate, gstack's gates pick reviewers for the delta, specialists whose findings were fixed are force-included, the native adversarial pass and the outside challenge run every cycle, and the receipt records each delta cycle as a partial pass. A failed drift check runs `/review` unmodified. Upstream will not change Step 5.8, so the wrapper carries this opt-in. Apply (3) and (4) to `/ship-and-land`'s own readers. No gstack file changes; gstack's cycle cap and stop, specialist prompts, outside voice, parser and documentation-audit bound stay as they are. MINOR under the 0.x policy. Proposed `_touches:` `skills/review-and-prep.md`, `skills/ship-and-land.md`, `docs/workflow-handoffs.md`, `docs/telemetry.md`, `tests/skill-protocols.test.ts`, `tests/handoff-contract.test.ts`, `tests/fixtures/handoffs/`, `tests/workflow-metrics.test.ts`, `tests/helpers/touchfiles.ts` (collides with Tracks 26A and 27A). Track 30A can consume the join file; Track 31A keeps its section-loading and voice-yield questions. Changes no review gate by default.
- **Completed:** v0.38.0.0 (2026-10-21). The stop, continuation prompt, opt-in delta review, and local reviewer join are in the wrapper skills, the handoff contract, and the tests. Installed-agent proof of a real continuation stays on the first post-release run. The separate default-flip comparison stays open.

### [review] install-safety.sh reads ownership through GNU stat's -f output

- **Description:** `bin/lib/install-safety.sh:_path_owner_uid` runs `stat -f '%u' path || stat -c '%u' path`. With GNU coreutils ahead of `/usr/bin` in PATH, GNU `stat -f` prints file-system details and fails, the fallback appends the uid, and the captured value no longer equals `id -u`. Every host directory then fails the ownership check, so setup skips all hosts. Track 23C's own stat calls try BSD `-f` first and keep the output only when it has the expected shape, otherwise use `-c` (`setup:_is_stat_id`, `_is_stat_size`); reuse that pattern here. This pre-existing helper sits outside that track's files.
- **Effort:** S (human: ~30min / CC: ~10min)
- **Context:** Found during Track 23C review and prep on 2026-10-09 while confirming the same ordering bug in the new install-status code. A probe with `/opt/homebrew/bin/gstat` first in PATH showed the multi-line capture.
- **Priority:** P2
- **Revisit when:** The next change to `bin/lib/install-safety.sh`, or a report of setup skipping every host on a machine with GNU coreutils on PATH.
- **Completed:** v0.36.5.0 (2026-10-09). The impact was wider than described: every stock GNU/Linux host has refused every skills directory since v0.18.14.0. `_path_owner_uid` now asks GNU `stat -c` first and falls back to BSD `stat -f`. That needs no shape check, because BSD `stat -c` fails with empty stdout. Stat-shim unit tests cover both flavors, foreign-uid refusal and unreadable ownership.

### [investigate] The Cursor and quota sentence overstates what the store reader can read

- **Symptom:** `docs/telemetry.md` section "Cursor and quota" says local native SDK runs supply model and effort when readable, otherwise null. The live Conductor store shape is never readable by `cursor_turns()`, so the null is structural, not an occasional miss. A reader can think a null model means the run did not name one.
- **Repro:** Read the "Cursor and quota" paragraph, then run the repro on `cursor_turns() cannot read the Conductor store shape`. The store record's `model.id` is `grok-4.7` while the reader returns no turn. Update the sentence, and link `docs/designs/review-independence.md` from that section. Track 16B does not edit `docs/telemetry.md`.
- **Effort:** S (human: ~1h / CC: ~15min)
- **Priority:** P2
- **Depends on:** The reader fix above, or a doc change that describes the current failure without waiting for it. Owner of `docs/telemetry.md`. Track 16A had not corrected this sentence as of 2026-09-25.
- **Context:** `docs/designs/review-independence.md` section 8.
- **Completed:** v0.32.1.0 (2026-09-28). The Cursor section now says the current reader cannot parse numeric timestamps and list-valued model parameters, so model and effort stay null even when the store names a model, and it links the review-independence evidence. The separate `cursor_turns()` reader TODO stays open.

### [manual] Native Cursor host installation
- **Description:** Add `setup --host cursor` and auto-detection through the Cursor command or home directory. Generate native skill copies with ownership-safe refresh and uninstall, verified home-root probes, and telemetry pointer discovery.
- **Scope:** Included in Track 16D's PR #113 on 2026-09-25. This explicitly expands its original fence to `setup`, the two additional telemetry-only skills, `tests/telemetry.test.ts`, and the canonical blocks in `docs/telemetry.md`; coordinate the setup overlap with Track 16E during review and prep.
- **Decision:** When `cursor` is on PATH but `~/.cursor` is absent, create the skill directory. When Cursor is absent, leave it absent. Strip `allowed-tools` as Codex does.
- **Review decisions (2026-09-26):** Setup preserves a `SKILL.md` symlink that points outside a gstack-extend checkout on every host, skips Cursor when `~/.cursor/skills` is another host's skills directory, and in `--host auto` skips a detected host whose skills directory fails the install-path check. Track 16D's `_touches:` now lists the Cursor files. Track 16E shipped first (#110), so `setup` merged cleanly. The resulting Group 16 COLLISIONS and PACKING failures (shared `docs/telemetry.md` with 16A, and 16E still listed in Current Plan) are deferred by the user to the next `/roadmap` run.
- **Completed:** v0.29.4.0 (2026-09-26)

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
