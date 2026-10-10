# TODOS

## Unprocessed

_(none)_

### [plan-ceo-review:track=23C,defer=true] Investigate ownership receipts for customized generated copies

- **Why:** `setup:generated_copy` treats a regular `SKILL.md` beside an `.extend-root` pointer as generated on Codex, OpenCode and Cursor. Claude preserves regular files. An intentional edit to a managed copy may therefore be replaced on refresh. Verify whether copy-host refresh should distinguish edited generated skill bodies from untouched ones before proposing an ownership receipt.
- **Effort:** M (human: ~1 day / CC: ~1 hour)
- **Depends on:** A named supported-host reproduction or an explicit owner decision about protecting edits to managed copies.
- **Context:** Deferred from Track 23C's planning review. Begin with `setup:generated_copy`, `host_skill_body`, the generated-copy refresh tests in `tests/setup-hosts.test.ts`, and `docs/installation.md`'s ownership contract. Track 23C preserves that existing refresh policy while repairing warning visibility and recovery; this investigation is not a new release gate. Pros: clarifies user intent and could protect intentional edits to managed copies. Cons: receipt migration and changed refresh semantics would need separate compatibility decisions and host qualification.
- **Priority:** P3
- **Revisit when:** O1 qualification reproduces loss of an intentional generated-copy edit, or the owner explicitly requests protection for edits to those managed copies.

### [review] Refuse install-status writes in a state directory other users can write

- **Description:** `setup` publishes `install-status` through a `mktemp` file it reopens by path. If another account can write to the state directory, it can swap that temporary file for a symlink and truncate a file the user owns. The default `~/.gstack-extend` belongs to the user, and Track 23C's threat model is same-user. Refusing group-writable directories would turn the feature off for anyone with umask 002, because the macOS `staff` group contains every local user.
- **Effort:** S (human: ~2h / CC: ~20min)
- **Context:** Raised by the Codex adversarial pass during Track 23C review and prep on 2026-10-09. The owner chose to backlog it. Candidate fix: refuse to publish when the state directory is not owned by the user or is world-writable without the sticky bit, and report a `status_unsaved` cause.
- **Priority:** P3
- **Revisit when:** A supported setup or documented recipe places `GSTACK_EXTEND_STATE_DIR` in a shared location, or a report shows install-status written by another account.

### [review] Tune install-status read bounds against bash 3.2 parse time

- **Description:** Both readers accept up to 1 MiB and 4096 records, the bounds the Track 23C plan set. Under `/bin/bash` 3.2, reading near those bounds takes seconds to minutes, and `bin/update-check` runs on every skill invocation. Setup itself writes about 25 records per HOME, so only a damaged, foreign or long-accumulated file gets near the cap.
- **Effort:** S (human: ~2h / CC: ~20min)
- **Context:** Measured by the performance specialist during Track 23C review and prep on 2026-10-09: 1,000 records for this HOME took about 10 s in the checker. Setup's load also checks every record for a duplicate key after a HOME-spelling rebind, which is quadratic and runs under the lock. Lower the caps, stream records instead of indexing one large array, and cap emitted lines with one summary line.
- **Priority:** P3
- **Revisit when:** A real install-status file passes a few hundred records, or a skill preamble is reported slow because of update-check.

### [review] Check that the install-status HOME id survives volume changes

- **Description:** Records are keyed on the HOME directory's `st_dev:st_ino`. If macOS renumbers the device (for example a home on an external volume), every record silently becomes another HOME's: `bin/update-check` prints nothing for them, and a fact whose pointer names a deleted checkout is not recorded again. Live copies are recorded again by the next setup under the new id.
- **Effort:** S (human: ~2h / CC: ~20min)
- **Context:** Raised by the adversarial pass during Track 23C review and prep on 2026-10-09. Stability of `st_dev` for the Data volume on the declared macOS profile was not verified. Candidate fixes: key on the physical path plus inode, or print a status line when only other-HOME records exist.
- **Priority:** P3
- **Revisit when:** A report of install warnings disappearing after a reboot, migration or volume change, or Track 27A qualification on a home outside the boot volume.

### [review] Map unsafe-directory causes from a code, not install-safety's message text

- **Description:** `setup:install_status_note_unsafe` derives `cause=` by matching the wording of `is_safe_install_path`'s stderr (`outside resolved`, `owned by uid`, `world-writable`, ...). Rewording a message silently downgrades its cause to the generic `unsafe_directory`, and the Unsafe skills directory table then cannot point at the specific fix. Tests pin `world_writable` and `outside_home` only.
- **Effort:** S (human: ~1h / CC: ~15min)
- **Context:** Raised by the maintainability passes during Track 23C review and prep on 2026-10-09. Have `is_safe_install_path` set a machine-readable cause, or add tests for the remaining causes.
- **Priority:** P3
- **Revisit when:** The next change to `bin/lib/install-safety.sh` messages.

### [review] Keep install-status digests current through interrupted and concurrent recovery

- **Description:** Two narrow paths can leave a recorded digest stale, so a correctly recovered copy keeps warning forever. (1) The per-file and retired examples' hard-link resume branch (`docs/installation.md`) skips the pre-move `run_setup`; an in-place edit during the interruption changes both names, and the backup no longer matches. (2) A setup that observed a copy before taking the lock can overwrite a newer record with older bytes when it lands between the example's pre-move setup and its `rm` (`setup:_is_merge` checks only that `SKILL.md` is still regular).
- **Effort:** S (human: ~1h / CC: ~15min)
- **Context:** Raised by five reviewers (including both Codex passes) in the scoped review of Track 23C's pass-3 delta on 2026-10-09 and backlogged under the owner's stop rule. Fixes: call `run_setup` in both hard-link resume branches before `rm`; in `_is_merge`, skip a `preserved_regular` observation whose current digest differs from the observed one. Add a retired-example resume test and a W7 variant where the late merge lands before the move.
- **Priority:** P2
- **Revisit when:** The next change to the recovery examples or `setup:_is_merge`, or a report of a warning that survives a completed recovery.

### [review] Align host-fact clearing docs and diagnostics with Track 23C's final rules

- **Description:** After the last review batch, the docs lag the code in small ways. Preserved installs and Unsafe skills directory still say a host fact clears only through that host's own setup, but a Cursor pointed at a served host's directory clears through that host's run (`--host auto` or `--host claude`, not `--host cursor`), and copy hosts ignore Cursor when checking separation. `setup` reports an unsearchable state directory as `lock_failed`, while `bin/update-check` says `not_searchable`, and `update-check --force` exits before diagnosing it because `rm -f` of the cache fails. The separate-host example's exit 7 takes precedence over exit 6 without saying so. The `mark_resolutions` header comment and an unused `host` local in `_is_reverify` are stale.
- **Effort:** S (human: ~1h / CC: ~15min)
- **Context:** Raised by the maintainability, API-contract and simplification passes in the scoped review of Track 23C's pass-3 delta on 2026-10-09; backlogged under the owner's stop rule.
- **Priority:** P3
- **Revisit when:** The next edit to `docs/installation.md` install recovery sections, or Track 27A qualification of Cursor recovery.

### [review] Strengthen Track 23C writer regressions the scoped review flagged

- **Description:** Some tests pass for the wrong reason or leave a branch uncovered: the trailing-slash test never produces a different normalized HOME spelling, so it cannot catch a regression in the rebind dedup; the retired example's hard-link resume and the merge drop for a removed legacy `SKILL.md` have no test; the stale-writer W7 test can orphan its blocked child if an earlier assertion fails.
- **Effort:** S (human: ~2h / CC: ~20min)
- **Context:** Raised by the testing pass in the scoped review of Track 23C's pass-3 delta on 2026-10-09. Use a symlinked alias of the fixture HOME for a real rebind, add a retired resume row, and wrap the W7 child in try/finally.
- **Priority:** P3
- **Revisit when:** The next change to `setup`'s install-status writer or `tests/setup-hosts.test.ts`'s Track 23C block.

### [review] Decide how far install-status should trust unusual inputs

- **Description:** Three low-likelihood inputs remain open. An all-skipped auto run scans a Claude directory the same run rejected as unsafe, so another account that can write there could get a pointer recorded as `verified_checkout` (the `--host` path already did this). A hand-edited file with exact duplicate keys keeps both copies because setup now dedups only after a rebind. A state directory under an unsearchable parent still looks absent to the checker.
- **Effort:** S (human: ~1h / CC: ~15min)
- **Context:** Raised by the security, adversarial and red-team passes in the scoped review of Track 23C's pass-3 delta on 2026-10-09. Each needs another account's write access or a hand-made file on the target profile.
- **Priority:** P3
- **Revisit when:** Together with the state-directory trust item above, or a report involving a shared or hand-edited state directory.

### [review] Check that install-safety's owner uid is numeric before comparing it

- **Description:** `bin/lib/install-safety.sh:_path_owner_uid` returns whatever `stat -c '%u'` prints, or the `stat -f '%u'` fallback when that fails. If GNU `stat -c` fails on a directory `cd -P` just resolved (a dropped FUSE mount, an LSM denying getattr, the directory vanishing), the GNU `-f` fallback prints file-system details, which pass the empty check. The guard still refuses, but `setup:install_status_note_unsafe` records `cause=not_owned` instead of `stat_failed`, and the message shows a multi-line "uid".
- **Effort:** S (human: ~30min / CC: ~10min)
- **Context:** Raised by the adversarial pass in v0.36.5.0 ship review on 2026-10-09; the owner chose to backlog it. Fix: keep each probe's output only when it is all digits, as `setup:_is_stat_size` and `bin/update-check:_uc_size` do, otherwise treat the uid as unreadable. Add a shim test where `stat -c` fails and `stat -f` prints text with exit 0.
- **Priority:** P3
- **Revisit when:** The next change to `bin/lib/install-safety.sh`, or a report of an unsafe-directory warning with cause `not_owned` on a directory the user owns.

## Completed

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
