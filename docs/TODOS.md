# TODOS

## Unprocessed

### [plan-ceo-review:track=23H,defer=true] Doctor visibility into open handoffs, completion markers and unconfirmed deliveries

- **Description:** `gstack-extend doctor telemetry` reads the JSONL sinks only. It never reads `telemetry/<hash>/*.json` handoffs, `telemetry-completed/` markers or `usage_uncertain` flags, so an abandoned start, a held unconfirmed delivery or a suppressed retry shows only in debug mode or through the interim listing snippet in `docs/telemetry.md` ("Work item and launcher quick-start"). Report open handoffs per root and skill (count, age, work item, whether a logger run is unconfirmed) and marker counts, then retire the snippet. This overlaps the Future card "Doctor coverage report over stage-runs and leftover handoffs"; fold it into that card if it is still open.
- **Effort:** M
- **Context:** CEO cherry-pick E1 from Track 23H's approved autoplan on 2026-10-16. Deferred because `bin/lib/telemetry-doctor.py` and its tests sit outside the Track's `_touches:` and a doctor-coverage item already exists.
- **Priority:** P2
- **Revisit when:** The doctor coverage report is next planned, or a reported missing or wrong row cannot be diagnosed from the ledger and debug lines alone.

### [plan-ceo-review:track=23H,defer=true] Retention for abandoned open handoffs

- **Description:** Every start that never finishes leaves a handoff in `telemetry/<hash>/`, and nothing removes it (25 leftovers measured locally on 2026-10-16, 6 of them `review-and-prep`). Enumeration is linear in the open handoffs of one root and skill. Resumable finishes pair newest first only outside an exact fingerprint match; exact matches pair oldest first, so an abandoned matching start can still capture a later finish. Decide a retention policy (age, a root that no longer exists, a cap) that keeps old handoffs usable for explicit recovery and does not delete the evidence a doctor report would show first.
- **Effort:** S
- **Context:** CEO cherry-pick E3 from Track 23H's approved autoplan on 2026-10-16. Deleting user state needs its own policy. Related Future card: "Bounded handoff cleanup and a tier-independent marker trigger".
- **Priority:** P3
- **Revisit when:** Any root and skill exceeds about 100 open handoffs, or the doctor report in the previous item shows accumulation.

### [plan-ceo-review:track=23E] Add trigger-migration scenarios to the attended planning matrix

- **Description:** Track 23E adds a legacy trigger migration to `/roadmap` (`skills/roadmap.md`, Deferred work). Its string locks prove the instruction exists, not that an agent follows it. Add scenarios to the attended planning matrix: preservation of every existing character, Approve, Revise and Hold behavior, duplicate or missing titles (`not located`), a title-only bullet, a repeat run, a realistically sized backlog, and the owner's review effort for a batch.
- **Effort:** M (human: ~1 day / CC: ~1 hour)
- **Context:** Raised by Track 23E's /autoplan (CEO and DX voices). The Track's executable proof is the `--future-index` unit and CLI tests plus a test that runs the Validate snippet from the skill; the migration's agent behavior is prose only. Placement belongs in Track 25B (installed-skill planning acceptance), so the next `/roadmap` run decides it.
- **Priority:** P3
- **Revisit when:** `/roadmap` plans Track 25B, or the first trigger-migration batch is run against a real Future file.

### [ship] init guesses project identity from the slug and the exact path

- **Description:** `registry_upsert` treats an entry with the same slug or the same exact path as the same project. That guess fails five ways. (1) A different project with the same basename slug and no remote silently replaces the other entry. (2) Projects nested inside one git repo all get the parent repo's remote slug (`detect_slug` reads the enclosing repo's `remote.origin.url`) and evict each other. (3) Path matching compares strings, so a hand-edited trailing slash, or an entry an older version recorded in the typed case (paths now resolve to the on-disk case), adds a duplicate entry. (4) `--migrate` without `--name` resets a custom display name to the basename. (5) A different project cloned into a path whose old project was deleted is "already onboarded", so `--migrate` gives it the dead project's `created_at`. Decide a real identity key (for example the remote URL plus the path relative to the git toplevel) and preview every entry an upsert will drop.
- **Effort:** M
- **Context:** Found by the pre-landing and adversarial reviews of the `init --migrate` registry fix on 2026-10-18. All five predate that fix or follow from the slug-or-path contract the bug report specified; the owner chose to backlog them rather than widen the fix.
- **Priority:** P3
- **Revisit when:** `gstack-extend list` or `status` starts reading the registry, or a user reports a lost or merged registry entry.

### [ship] A project onboarded next to a root ROADMAP.md stays partial

- **Description:** When a ROADMAP already exists, init deliberately skips `docs/roadmap-future.md` and `docs/roadmap-shipped.md` so `/roadmap` can migrate the live tail. `detect_state` still requires both satellites, so plain init keeps reporting "partially onboarded" and `--migrate` cannot clear it. `/roadmap` writes `roadmap-future.md` only when Future has entries. Treat the satellites as optional when a ROADMAP exists, or name the missing files in the partial message.
- **Effort:** S
- **Context:** Red Team finding during the same 2026-10-18 review. The behavior predates that fix.
- **Priority:** P3
- **Revisit when:** The next change to `detect_state` or satellite handling, or a user reports a project stuck as partial.

### [ship] Init skill preview sequencing around --name

- **Description:** In `skills/gstack-extend-init.md`, the Step 2 "invalid characters" branch asks for a valid name but never re-runs the dry-run, so a `--migrate` decision can be skipped. Step 4's option B and the name-change re-preview are both described relative to a command whose final flags are only settled after the confirmation. Settle the final command (with `--migrate` and `--name`) and its preview before the single confirmation.
- **Effort:** S
- **Context:** Raised in the last review pass of the 2026-10-18 init fix, after the owner set a stop rule that routed remaining prose findings to the backlog.
- **Priority:** P4
- **Revisit when:** The init skill flow is next edited, or the optional eval for the skill's `--migrate` preview step is built.

### [ship] init containment polish

- **Description:** Leftovers from the 0.36.12.0 review of init's write containment. None can be triggered by a repository's own content. (1) The refusal hint and the init skill say init never writes "through a link", but a link that stays inside the project is followed; say "outside the project or through a dangling link". (2) A project argument that ends in a newline loses it in `dirname`/`basename`, so a same-named symlink without the newline is followed; reject a newline in `<project>`. (3) A dangling canonical-file link is skipped, but `--migrate` still prints SUCCESS while plain init keeps calling the project partial; name the link in the summary or refuse it like a dangling directory link. (4) `layout_preflight` checks once, so another process that swaps `docs/` for an outside link before the writes can redirect them; re-check each parent right before its mkdir or write. (5) `problem=$(write_problem …)` treats a failed substitution as "no problem"; fail closed. (6) The keep policy checks the timestamp's punctuation but not its digits. (7) `setup` resolves its own directory with `cd` and does not unset `CDPATH`. (8) Tests: isolate `layout_preflight`'s per-file loop (an outside `docs/` that already has designs/ and archive/), and correct the dangling-link test's stated failure reason.
- **Effort:** S
- **Context:** Routed to the backlog by the owner's stop rule during the 0.36.12.0 /ship review, after three review passes. QA confirmed the per-file loop refuses correctly on the shipped tree.
- **Priority:** P3
- **Revisit when:** The next change to `bin/gstack-extend` init or `setup`, or a report of a misleading init refusal or SUCCESS.

### [plan-ceo-review:track=23I,defer=true] Machine-readable schema for the stage handoffs

- **Description:** `docs/workflow-handoffs.md` publishes the stage handoffs as a prose grammar with a test-only classifier. A caller that wants to validate a handoff mechanically must write its own parser from the label tables. Add a schema (for example `docs/workflow-handoffs.schema.json`, versioned beside the contract) only for a named consumer, and keep the doc as the oracle so the two cannot drift.
- **Effort:** M
- **Context:** CEO deferral E3 from Track 23I's approved autoplan on 2026-10-18. Deferred because no in-repo consumer reads a schema, and the Track's gate decision (2026-10-19) chose a doc plus fixture-consumer tests with no parser binary.
- **Priority:** P3
- **Revisit when:** A named external consumer asks for a machine-readable schema, or the live external-handoff acceptance Tracks (28A/28B when written) show a consumer misparsing the prose grammar.

### [review] Stage-handoff contract: residual parser gaps and pair-review pause-detector parity

- **Description:** Track 23I's review left four items that need producer changes or live evidence. (1) BLOCKED rows that exist only in a Coverage checklist file are invisible to a caller that does not read the file; require the disposition counts line in `Coverage:` or define how a caller reads the file. (2) Parsers can still diverge on `Pending verification: none, except ...`, on branch names containing `;` or `,`, and on very long label qualifiers. (3) `/pair-review`'s pause detector reads only the viewer's comments, orders them by `createdAt` alone and treats any pause on a draft as active, while `docs/workflow-handoffs.md` orders by `created_at` then `id` and lets a later running-account receipt clear a pause; `skills/pair-review.md` also names a Track as owner of a future canonical hold/resume detector, which should be checked against the roadmap. (4) A resume prompt printed after `DONE_WITH_CONCERNS` holds by design; confirm that against real resumes. (5) Review cycle 3 added fail-safe or availability residuals: confine the plan fallback path to the bound checkout with the same regular-file and size rule; flag stray marker tokens in outside text; use a per-invocation base-tip ref and correct the "only write" wording; widen the token shapes toward `gstack-redact`'s set and stop echoing free text in diagnostics; token-scan H-D text; accept more zero-count spellings and the bare word `PAUSED` only in the documented phrase; read the indented `/pair-review` resume fence; route Greptile exit-question pauses to `/review-and-prep resume`; compare the receipt pointer's PR with the bound PR; align the B-TREE-ABSENT row with the missing-object rule; ask `/implement` to start each Coverage row with its ID and disposition.
- **Effort:** M
- **Context:** Deferred on 2026-10-19 under the stop rule the user set for Track 23I's review (cycle 2 of 3). None is a trust bypass or a contradiction with the contract's current producer text.
- **Priority:** P3
- **Revisit when:** The live external-handoff acceptance Tracks (28A/28B) record a real handoff, or the next change to `/pair-review`'s pause detector.

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
