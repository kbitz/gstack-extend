# TODOS

## Unprocessed

### [manual] Measure /autoplan-lean's first real run against upstream /autoplan baselines

- **Why:** `/autoplan-lean` claims no saving until a real run is measured. The baselines are from upstream `/autoplan` runs launched by an external transport. One plan reached 129KB and 676 lines, about 600 of them review record. Its per-phase reviewer prompts were 22–26KB each. Another run used 73.0M cached input tokens and 168K output tokens over 2 h 15 min.
- **Effort:** S
- **Priority:** P2
- **Context:** Owner request, 2026-10-21. Compare the plan proper's bytes, the sidecar's `Reviewer prompt sizes` table, the parent's cached input and output tokens, wall time, and the downstream `/implement` stage's plan reads. Use the same model and effort as the baseline. Also confirm that review depth held: the same phases ran, mandatory outputs were present, and decision counts are comparable. No host run had happened when it shipped (owner decision at /ship, 2026-10-21): run it once each on Claude Code, Codex and Muse, confirm each finds the skill and the upstream phase skills and ends with `autoplan-lean check` reporting `CHECK: ok`, and force one subagent failure to confirm the voice is recorded unavailable.
- **Revisit when:** The first real `/autoplan-lean` run completes, or a caller switches its autoplan stage to it.

### [manual] Decide whether delta-scoped review becomes the wrapper default

- **Why:** The completed repeated-review item keeps delta-scoped wrapper re-reviews and delta-scoped in-cap cycles opt-in. Rerunning every reviewer on unchanged code is a second sample that can catch what the first pass missed, so making the delta the default needs evidence that it loses no accepted finding.
- **Effort:** S
- **Priority:** P3
- **Depends on:** Cut repeated review work in /review-and-prep without changing gstack
- **Context:** Owner request, 2026-10-20. Measure first on retained review logs: were later-pass accepted findings inside the preceding repair delta? Then run a read-only shadow full re-review (or full cycle 2) on the same head for the first three delta re-reviews and delta cycles, with spend approved in advance, and compare accepted findings by severity and tokens. Proposed bar, set finally by the owner: no accepted critical or high finding missed, at most one medium across the sample. Keep an ongoing escape check: a later accepted finding (Greptile, `/ship-and-land`, post-merge) outside a delta-scoped review's delta.
- **Revisit when:** Three paired comparisons are recorded, or an accepted finding lands outside a delta-scoped review's delta.
- **Update 2026-10-22:** The owner opted their own hand-launched runs into delta repair cycles through `review_default=light` (no outside call or Red Team on delta cycles). That is a per-user opt-in, not this wrapper-wide default; use those runs' later accepted findings as the escape check.

### [manual] Load /review-and-prep's rarely used sections on demand

- **Why:** The host loads the whole 121 KB `skills/review-and-prep.md` at invocation, and each parent turn resends it. Measured hand-launched runs read 325–550 KB of skill docs per parent, and a cache-miss turn at 200k–320k tokens took 2–3 minutes. Most runs never reach the Greptile exits and configuration repair, the cycle-cap stop and continuation, or the manual-testing resume.
- **Effort:** M
- **Priority:** P3
- **Context:** Owner request, 2026-10-22, split from the lighter-ceremony change, which only stopped whole-file reads of `docs/telemetry.md` and `docs/workflow-handoffs.md`. Move those procedures into section files read when their situation applies, as upstream `/review` does with `sections/`. Keep every handoff label and marker byte-stable. `setup` must install the section files for every host copy, and the `skill-protocols`, `handoff-contract` and `workflow-metrics` locks that slice this file must follow the sections.
- **Revisit when:** Track 31A measures parent context per review run, or a host's skill size limit or cache-miss latency blocks a run.

### [manual] File upstream: gstack-owned review cost levers

- **Why:** The largest remaining review costs sit in gstack code this repository must not change. The owner wants them handed upstream rather than overridden from the wrapper.
- **Effort:** S
- **Priority:** P3
- **Context:** Owner request, 2026-10-20; detailed note `plans/2026-10-20-upstream-gstack-review-cost-handoff.md` in the project's gstack notes. (1) `/review` Step 5.8 reruns every reviewer on the full diff in cycles 2–3; run its scope gates on the repair delta inside the cap. (2) Reviewer prompts share no identical leading block, so parallel reviewers cannot reuse one cached prefix. (3) The two outside calls per pass send the whole plan (with substantial repeated prompt context) and share no prefix. (4) Completed outside calls were sometimes discarded for missing markers. (5) The documentation-audit subagent gets full plan context for a code-validated, mechanical check. (6) The review log does not record each reviewer's host subagent identifier. `/ship-and-land`'s "Delta rechecks" already applies pattern (1) to `/ship` from the wrapper, and the completed repeated-review item adds an opt-in wrapper version for the nested `/review` because no upstream change is expected; an upstream fix would let that override retire.
- **Revisit when:** A gstack release changes `/review`'s re-review loop, reviewer dispatch or outside-voice prompt, or the wrapper change above ships and its remaining cost is measured.

### [review] Workflow-metrics reader cardinality edges

- **Description:** Low-severity counting edges in `bin/lib/workflow_metrics.py`'s read projection, left after Track 24A's two review rounds. (1) A duplicate identical pass `completed` record is tolerated while a duplicate identical `voice-complete` is a conflict; pick one rule for repeated identical terminals. (2) An empty or unbound ledger reads `ok` with zero counts; consider `capture-missing`-style unknowns. (3) The "unknown, never zero" rule only checks whether any pass or fix record exists, so a run missing its second pass still undercounts. (4) A `fix-cycle` correction's `fix_step_id` may name a step that is not `kind:"fix"`. (5) A supersession chain across different findings is not rejected. None changes a gate or a recorded event; each can misstate a count in a receipt's optional metrics line.
- **Effort:** S
- **Context:** Pass-2 adversarial review of Track 24A on 2026-10-19. The owner chose a bounded fix batch with a stop rule; these were routed here instead of a third fix cycle.
- **Priority:** P3
- **Revisit when:** Track 31A's efficiency study or the installed two-wrapper smoke finds a miscounted run, or before a workflow-metrics v2 schema.

### [review] Slim the workflow-metrics helper without dropping requirements

- **Description:** The simplification review proposed nine behavior-preserving shrinks to `bin/lib/workflow_metrics.py` (about 80 lines): one regex-or-null validator instead of about 13 copies, a hoisted context-override check, one bounded reader for stdin and the ledger, one private no-follow open helper for the lock/ledger paths, a shared candidate-key tuple, and removing the dead `overflow` parameter after the partial-tail fold. Also consider moving the one-off overhead figures from `docs/telemetry.md` into PROGRESS evidence.
- **Effort:** S
- **Context:** Advisory findings from Track 24A's review on 2026-10-19; the owner kept the freshly tested module as is (no churn before first use) and routed these here.
- **Priority:** P3
- **Revisit when:** The next substantive change to `bin/lib/workflow_metrics.py`, or when Track 31A needs new reader features.

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
