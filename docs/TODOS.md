# TODOS

## Unprocessed

### [manual] Qualify /docs-ship on a real docs-only PR on both workspace hosts

- **Why:** `/docs-ship` shipped with helper fixture tests and static skill checks only, and a static prose test is not installed-agent acceptance. `/roadmap` and `/project-spec` now hand their commits to it instead of `/review-and-prep` and `/ship-and-land`, so its first real runs carry that path.
- **Effort:** S
- **Priority:** P2
- **Context:** Owner request, 2026-10-23. Run it once on Paseo and once on Conductor, including one on a Sonnet-class model and one from a `/roadmap` handoff. Confirm that it classifies the PR, that an initial classification hand-back changes nothing, that the pinned tests run once and a same-tree rerun within the invocation reuses the `docs-ship-tests` record, that `docs-ship hash` on the final body prints the receipt's hash, that the bump follows the release policy, and that the run ends with the `docs-ship/v1` result line without merging. Record the wall-clock time against a recent `/ship-and-land` run on a docs PR.
- **Revisit when:** The first docs-only PR after this release, or the next `/roadmap` run that commits.

### [manual] Narrow the two `skills/**` suites that dominate a one-skill test run

- **Description:** After the per-skill split of the protocol suite, a change to one skill file still selects every suite that declares `skills/**`. Two of them carry most of the cost: `tests/telemetry.test.ts` (230 tests, 256 s alone) and `tests/setup-hosts.test.ts` (188 tests, 193 s alone) in the 2026-10-23 serial baseline of 927 s. A measured `skills/roadmap.md` edit ran 8 of 74 files and 1,060 tests in 770 s; the split protocol suites were 244 of those tests. Both suites read every skill for cross-skill rules (the telemetry blocks each skill executes, the installed host copies), so a path-level map cannot tell a telemetry-block edit from a prose edit. Candidate: move the assertions that read real skill content into small per-skill or shared-rule suites, and keep the installer and telemetry mechanics on fixture skills that do not declare `skills/**`.
- **Effort:** M
- **Context:** Measured while splitting `tests/skill-protocols.test.ts` (owner request, 2026-10-23); the receipts' `Test selection:` lines now show which files each run selected and why.
- **Priority:** P3
- **Revisit when:** A skill-only PR's `Test selection:` line shows these two suites above half of its test wall time, or before a Group that edits several skills.

### [ship] Harden /autoplan-lean's plan checks, outline and spec-loop guard after 0.43

- **Description:** Review findings deferred at `/ship`, most important first:
  - **Reordered input counts as unchanged.** `proper --previous` compares lines as an unordered multiset. Moving an unchanged line between sections, such as from a deferred list into the tasks, reports `CHANGED_LINES: 0` and stops the CEO spec loop after a real scope change. Three independent reviewers found it. Use an ordered or section-keyed diff.
  - **The task-reference check misreads IDs.**
    - `taskRefs` ignores inline code and is case-sensitive, so a dangling `` `d9` `` or `D9` seals.
    - A bare tool name such as d3 is refused as a dangling ID.
    - IDs joined as `d4/d9` escape the check.
    - Count IDs only in the task's metadata clause.
  - **Seal's plan pre-checks have gaps.**
    - A second exact `## Accepted decisions` section escapes settlement validation.
    - `check` reruns none of seal's plan pre-checks.
    - A refused `prompt` leaves the previous prompt file in place.
  - **Outline misreads some files.**
    - `#` lines in YAML frontmatter become headings.
    - A skip list with blank lines between bullets is cut off.
    - Skip-list names match any heading with the same prefix.
  - **The budget source and timing are unchecked.** The budget is not checked again after the gate outcome is applied, and `restore.md` is not compared with the SHA-256 recorded at intake.
  - **Settlement IDs can collide.** They can repeat IDs carried by a reviewed source plan, and the gate brief's `d<n>` labels use the same namespace.
  - **Skill prose and docs:**
    - `--over-budget "<reason>"` is double-quoted, so backticks in the reason would be expanded by the shell.
    - `budget` prints "over (no reason given)".
    - `SECTION_HEADING_INVALID` is missing from `--help` and the skill.
    - A variant heading in card text is refused.
    - The `shared` skip rule conflicts with re-reading after a compaction.
    - Concurrent voices could read each other's output files.
    - Only an opt-in test checks `OUTSIDE_OUTPUT_FORMAT` against the installed validator.
- **Effort:** M
- **Context:** From the final pre-landing review passes and the adversarial review of 0.43.0.0 on 2026-10-23. None was rated critical. Under the owner's stop rule for the final pass, only critical findings were fixed before release. The four untested `seal --replace` state cells (code unchanged) were also left.
- **Priority:** P2
- **Revisit when:** The next real `/autoplan-lean` run, or before an external caller relies on the `CHANGED_LINES` guard or the task-reference check.

### [plan-ceo-review] Name the stable compatibility surfaces and experimental exclusions (O5.1)

- **Description:** SPEC O5.1 requires naming the stable compatibility surfaces and experimental exclusions and documenting support and recovery. The only list today is the "Stable surfaces" category bullet in SPEC's Release policy. Track 28A cites stage-runs schema v2 against that bullet as one example but builds no catalog.
- **Why:** This is a required O5.1 acceptance obligation for 1.0. Under SPEC's Deferral policy it remains pending until demonstrated, so it must not read as an optional inbox item.
- **Effort:** M
- **Priority:** P1
- **Depends on:** Track 28A (verified release transition)
- **Context:** Deferred by the Track 28A planning review on 2026-10-23 under HOLD SCOPE. No Current Plan Track owns it; schedule it in the Current Plan ahead of Group 30.
- **Revisit when:** The next `/roadmap` run.

### [plan-ceo-review] Upgrade a real legacy install from the first published three-part release

- **Description:** After the first three-part release merges and is tagged, upgrade a real four-part install from that published tag through the default remote URL, not a `file://` candidate. Record the result beside `docs/acceptance/release-compatibility.md`.
- **Why:** Track 28A proves the transition against a local candidate. SPEC O5.2's evidence is complete only with a real published release, and later acceptance must not count candidate runs as that evidence.
- **Effort:** S
- **Priority:** P1
- **Depends on:** The first three-part release
- **Context:** Deferred by the Track 28A planning review on 2026-10-23: the Track itself ships under the four-part format and publishes no three-part release.
- **Revisit when:** The first three-part release merges.

### [plan-ceo-review] Make upgrade detection and installation resolve to one tagged release

- **Description:** `bin/update-check` reads `main`'s VERSION and `bin/update-run` pulls `main`, while `auto-tag.yml` tags asynchronously and docs-only commits such as `f02bc51` carry no tag. An install can receive an untagged commit, or a newer commit than the version it was offered.
- **Why:** Installing "stable releases" means installing the advertised release. Main-tracking installs prove version compatibility, not release identity.
- **Effort:** M
- **Priority:** P2
- **Context:** Raised by the outside voice in the Track 28A planning review on 2026-10-23. Not a three-part regression. Candidate approaches: install from the latest release tag, or check out the commit the offered VERSION came from.
- **Revisit when:** Tracks 30B/30C qualify install and upgrade recovery, or before the 1.0 release, whichever comes first.

### [plan-eng-review] Give failed install migrations a recovery path

- **Description:** `bin/lib/run-migrations.sh` reports a failed migration only as `MIGRATION_WARN <script> exit=<n>` while `bin/update-run` still prints `UPGRADE_OK`. A `bad-version` helper exit also clears `migrations-hop-from`, despite the script's own comment that contract failures must leave it, so in-window migrations can be lost.
- **Why:** SPEC O1.2 needs a working recovery path after an upgrade. An agent that sees `MIGRATION_WARN` gets no fix, recovery class or retry bound.
- **Effort:** S
- **Priority:** P2
- **Context:** Raised by both developer-experience voices in the Track 28A planning review on 2026-10-23. Outside the format transition; reachable only with a malformed VERSION on `main`. No production `migrations/v*.sh` exists yet.
- **Revisit when:** The first production `migrations/v*.sh` is added, or Tracks 30B/30C exercise upgrade recovery.

### [review] Reject leading-zero versions in the remaining version readers

- **Description:** Track 28A tightened only `bin/update-check`'s remote check and auto-tag. `bin/lib/semver.sh` still compares components with Bash arithmetic, so a leading-zero migration name such as `v0.10.08.sh` raises an octal error and is treated as out of window. `bin/lib/run-migrations.sh`'s name and hop-from checks and the manual remote check in `skills/gstack-extend-upgrade.md` still accept leading zeros, and that skill compares spellings rather than padded versions.
- **Why:** A malformed name would silently skip or misorder an install-state migration. Reach is low: no production migration exists, auto-tag and the release guard reject a leading-zero VERSION, and Track 28A kept the upgrade skill unchanged (d29).
- **Effort:** S
- **Priority:** P3
- **Context:** Raised by the adversarial and red-team passes of Track 28A's `/review-and-prep` on 2026-10-24.
- **Revisit when:** The first production `migrations/v*.sh` is added, or the upgrade skill's version check is next edited.

### [review] Check new migration names against their release's version window

- **Description:** `bin/lib/run-migrations.sh` runs only scripts named in (OLD, NEW]. Release versions are chosen at release time above every fetched tag, so a migration written as `v0.47.0.sh` that ships in `0.48.0` never runs on installs already at 0.47.x, and nothing warns. The release-manifest guards do not compare added migration names with (base VERSION, VERSION].
- **Why:** A silently skipped install-state migration is a hard-to-diagnose upgrade defect once production migrations exist.
- **Effort:** S
- **Priority:** P3
- **Context:** Raised by the red-team pass of Track 28A's `/review-and-prep` on 2026-10-24. No production migration exists yet.
- **Revisit when:** The first production `migrations/v*.sh` is added.

### [review] Check the cutover release notes for the required disclosure

- **Description:** The release-manifest guards force the first three-part release to be the next unused MINOR, but nothing checks that its CHANGELOG section discloses the format switch and padded equality and links `docs/installation.md#version-numbers`, as CLAUDE.md's cutover procedure requires.
- **Why:** The disclosure is the migration guidance SPEC requires for that MINOR. Today only the release owner's review of the notes enforces it.
- **Effort:** S
- **Priority:** P2
- **Context:** Raised by the adversarial pass of Track 28A's `/review-and-prep` on 2026-10-24, after the cutover MINOR guard was added.
- **Revisit when:** Preparing the first three-part (cutover) release.

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
