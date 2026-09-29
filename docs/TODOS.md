# TODOS

## Unprocessed

### [plan-ceo-review:track=16A,defer=true] Version stage-runs rows and publish their schema
**What:** Add a schema version and a gstack-extend producer version to every stage-runs row, publish a machine-readable schema, and record whether `agent`/`model`/`effort` came from flags or from detection.
**Why:** 8 of 14 rows in the September 25 capture lack `route` and `entrypoint_raw`; readers cannot establish the writer release from key presence alone, and `agent: cursor` arrived without a marker.
**Context:** Found by Track 16A. `route` values are written inline in `route_for` (bin/lib/telemetry.py) with no constant. docs/telemetry.md holds the field and value version notes this would replace.
**Effort:** S
**Priority:** P1
**Depends on:** None

### [plan-ceo-review:track=16A,defer=true] Doctor coverage report over stage-runs and leftover handoffs
**What:** Teach `gstack-extend doctor telemetry` to read stage-runs and leftover handoffs and warn when gstack's tier is off; have the wrapper record the skill in each handoff; give the deferred marker work a tier-independent trigger for periods without eligible observations.
**Why:** Without eligible v1 starts the doctor reports insufficient evidence and the 95% decision rule cannot fire. Turning the tier off stops new evidence but does not prevent evaluation of historical rows; orphaned handoffs name neither skill nor repository.
**Context:** Track 16A's observed-coverage record was captured by a private script; this report would make it re-runnable anywhere. Define the independent invocation evidence a capture-completeness claim needs.
**Effort:** M
**Priority:** P2
**Depends on:** None

### [plan-ceo-review:track=16A,defer=true] Collision-safe and idempotent run identity
**What:** Two starts of one skill in one checkout must produce two correctly attributed rows, and repeating a finish (an explicit retry with the original IDs, or a retry after a logger timeout that already wrote) must not duplicate rows.
**Why:** Today the later start replaces the handoff slot, so the earlier run's finish is recorded under the later run's identity and the later run has no row; a repeated explicit finish appends a second stage-runs row and a second skill_run.
**Context:** Characterized as current behavior by the collision and explicit-retry tests in tests/telemetry-contract.test.ts; acceptance is those sequences producing exactly one correctly attributed row per run.
**Effort:** M
**Priority:** P2
**Depends on:** None

### [plan-ceo-review:track=16A,defer=true] Decide the repository identity in skill_start rows
**What:** Decide whether `skill_start.repo` should carry origin `owner/name` instead of the checkout directory name.
**Why:** The three datasets use three repository identities, so `repo` never joins; under a workspace manager the directory name is the workspace name.
**Context:** gstack's sync strips `repo` before upload on its jq path (its sed fallback mis-strips a value containing an escaped quote), so the decision mainly affects local consumers. Track 16A documents the divergence and locks it as current behavior.
**Effort:** S
**Priority:** P3
**Depends on:** None

### [review] Keep Codex and OpenCode passes out of another host's skills directory
- **Description:** Setup skips Cursor when `~/.cursor/skills` is another host's skills directory. Codex and OpenCode passes still do not. With `~/.codex/skills` (or OpenCode's) symlinked to `~/.claude/skills`, `--host auto` turns the Claude symlinks into copies, overwrites a customized Claude `SKILL.md` that kept its `.extend-root`, and `--host codex --uninstall` removes the Claude install. Skipping them the Cursor way would leave existing shared-directory users with copies the Claude pass never refreshes, so this needs a migration decision.
- **Effort:** S (human: ~3h / CC: ~25min)
- **Priority:** P3
- **Context:** Found by the /review-and-prep adversarial pass on PR #113 (2026-09-26). Predates the PR.

### [review] Surface hosts that setup skipped during update-run
- **Description:** `bin/update-run` prints `UPGRADE_OK` even when `setup --host auto` skipped a host (an unsafe skills directory, or Cursor sharing another host's directory). The warning goes only to stderr and the upgrade flow reports success, so that host's copies stay stale. Consider a machine-readable skipped-hosts line from setup that update-run forwards.
- **Effort:** S (human: ~2h / CC: ~15min)
- **Priority:** P3
- **Context:** Found by the /review-and-prep adversarial pass on PR #113 (2026-09-26).

### [plan-ceo-review:track=16D,defer=true] Decide whether PATH is inside the trust boundary for the telemetry wrapper lookup
- **Description:** `SHARED:telemetry-start` and `SHARED:telemetry-finish` look up `gstack-extend-telemetry` on PATH first. They accept any absolute PATH entry that holds a file with the protocol marker, so an agent environment whose PATH a repository can shape (a direnv `PATH_add`, say) could run a planted wrapper. Track 16D treats the process environment as trusted and pins only `GSTACK_EXTEND_DIR` for `bin/update-check`. Decide whether the telemetry lookup should also prefer home-anchored pointers over PATH, or whether a trusted environment is the documented contract.
- **Hypothesis (untested):** Agent harness Bash tools run non-interactive shells that do not fire direnv hooks, so the exposure may be theoretical. Measure before changing lookup order.
- **Effort:** S (human: ~2h / CC: ~15min)
- **Priority:** P3
- **Depends on:** Track 16D (its threat-model statement is the baseline)
- **Context:** Deferred at /autoplan on 2026-09-25 (CEO native voice finding 5, reframed by the Eng dual voices). Plan and review record: `~/.gstack/projects/kbitz-gstack-extend/kbitz-harden-upgrade-preambles-plan.md` (CEO-A19, CEO-A23, ENG-A1).

### [plan-ceo-review:track=16D,defer=true] Stop `setup` injecting an unescaped HOME into generated skill bodies
- **Description:** `rewrite_skill_body` (`setup:144-179`) rewrites every `~/.claude/skills/<name>` in a skill into a literal `${HOME}/.codex/skills/<name>` (or the OpenCode or Cursor path) with sed, unquoted. A HOME containing spaces or shell metacharacters then changes how the generated bash parses. Track 16D moved the resolver loops to quoted `"$HOME"` paths so they are never rewritten. No current skill needs that rewrite after the unused skills were retired; the adapter still accepts those literals, so future skills could reintroduce the exposure.
- **Hypothesis (untested):** Rewriting to a quoted `"$HOME"/.codex/skills/<name>` form, or leaving `~` for the host to expand, removes the injection without changing any resolved path.
- **Effort:** S (human: ~2h / CC: ~15min)
- **Priority:** P3
- **Depends on:** None. `setup` belongs to Tracks 17A and 18B in the current plan, so schedule after them or fold into 18B.
- **Context:** Deferred at /autoplan on 2026-09-25 (CEO dual voices: Codex finding 3, native finding 4). Plan: `~/.gstack/projects/kbitz-gstack-extend/kbitz-harden-upgrade-preambles-plan.md` (CEO-A18, CEO-A23).

### [plan-ceo-review:track=16D,defer=true] Prefer the invoking host's install when Claude and Codex point at different checkouts
- **Description:** The Track 16D resolver probes Claude, then Codex, then OpenCode, then Cursor. On a machine where the Claude install points at checkout A and the Codex install at checkout B, a Codex session resolves A, so `/gstack-extend-upgrade` updates A while the Codex copies generated from B stay stale. The same applies to Cursor copies. Reorder the probes by host, using the harness env markers (`CODEX_THREAD_ID`, `CODEX_SANDBOX`, `CLAUDECODE`, plus Cursor's once identified), which only reorder home-anchored candidates. When two distinct verified roots exist, print one ambiguity line naming both.
- **Hypothesis (untested):** Split checkouts are rare because `setup --host auto` installs every host from one checkout. The README split-checkout note may be enough; count real reports before building.
- **Effort:** S (human: ~3h / CC: ~20min)
- **Priority:** P3
- **Depends on:** Track 16D (canonical resolver span)
- **Context:** Deferred at /autoplan on 2026-09-25. The DX Codex voice rated this High; the CEO native voice called it harmless. Decision DX-A15 in `~/.gstack/projects/kbitz-gstack-extend/kbitz-harden-upgrade-preambles-plan.md`.

### [manual] Complete the deferred review-independence empirical study

- **Why:** The limited documentation snapshot defines the independence rule and reproduces its static and reference calculations, but cannot establish the original study's measured review composition. The retained reconstruction contains no execution-chain receipts; original author logs and live Cursor SDK/transcript stores are unavailable in the inspected local sources, while the isolated E4 fixture copy is retained. A policy and metadata candidates cannot prove which models authored a change or supplied a consumed review result.
- **Acceptance:** Recover authentic original evidence where available, or explicitly scope a fresh dated snapshot before launching it. Validate direct billing evidence and provider parent/child semantics (S14), measure clock skew (S17), freeze and join the four-host cohort (S21), compute grouped measured composition (S22), and verify a real positive review chain (S23). Capture authoring/setup commands and model/content/commit bindings (S24/S25), exact review runtimes and attributable consumption (S32), and replay from the frozen source projections (S36/S38). Audit historical claim citations against those sources, preserving unsupported observations as reported or withdrawing them (S55). A new snapshot cannot retroactively satisfy an original pre-cutoff capture requirement; record the replacement scope explicitly. Bound new attempts before launch, retain missing proof as a result, and keep the native Conductor probe optional and user-run.
- **Effort:** L (human: ~2d / CC: ~1h plus live-run and settlement waits; source recovery may require another retained copy)
- **Priority:** P2
- **Depends on:** Track 16A's contract revalidation; authentic source access and billing capability for the selected routes. The independent checker, runtime reader fix, and vendor-separation value study remain separate work.
- **Context:** Explicitly deferred by the user on 2026-09-25 when selecting the limited documentation scope for PR #111. Original scope IDs S14, S17, S21, S22, S23, S24, S25, S32, S36, S38 and S55 remain partial in the historical audit; this entry does not mark them verified. Track 16B remains open. See `docs/designs/review-independence.md`, especially sections 3, 7, 9 and 12.

### [plan-ceo-review:track=16B,defer=true] Review-independence checker CLI

- **Description:** A reusable command that computes the review-independence verdict (PASS or FAIL with closed reason and cause codes) for one review or a set of reviews, from the same records and join rules that `docs/designs/review-independence.md` defines. The design doc's verdict rules, policy defaults, and appendix join spec are its contract; the doc's inline reference evaluator is its starting point.
- **Hypothesis (untested):** One checker serves three consumers from one definition: an external orchestrator gating merges on independent review, the shadow merge gate (roadmap Track 16C) as a would-merge reason, and any later vendor-aware routing.
- **Pros:** Stops each consumer re-implementing the join and the rule; turns the doc's worked example into a tested command.
- **Cons:** New bin, library, and tests. Its inputs are private, unversioned harness stores (Conductor's Cursor SDK store, Cursor transcripts, Codex rollouts), so it inherits their drift.
- **Effort:** L (human: ~3d / CC: ~1.5h)
- **Priority:** P2
- **Depends on:** Track 16B's design doc; Track 16A's revalidated `stage-runs.jsonl` contract
- **Context:** Deferred at /autoplan on 2026-09-24 (CEO cherry-pick X4, reinforced by the CEO native voice: the probe's join plus verdict table is this checker). The contract is now `docs/designs/review-independence.md`: at least one proven independent consumed voice, complete contributing-model coverage, explicit served/requested-only assurance, and the artifact/session/result/gate chain. Its corrected metadata join uses raw branch hashes or collision-checked filename mappings. Workspace and writer candidates alone are not vendor proof. Plan and review record: `~/.gstack/projects/kbitz-gstack-extend/cursor-review-independence-plan.md`.

### [plan-ceo-review:track=16B,defer=true] Measure whether vendor separation catches more real defects

- **Description:** The review-independence rule treats "a voice from a vendor that neither wrote the code nor ran the primary review" as a proxy for independent judgment. Nothing here measures that the proxy pays off. Compare unique valid findings, false positives, cost, and latency between cross-vendor and same-vendor voices on reviews with known defects.
- **Hypothesis (untested):** Cross-vendor voices find more valid issues than a second same-vendor pass; published 2026 comparisons report same-family reviewers passing generated code more often, but not on this repo's review stack.
- **Pros:** Tells an external consumer whether gating merges on vendor separation is worth its cost and latency.
- **Cons:** Needs a labeled defect set; review rows record findings per voice only in free text today.
- **Effort:** M (human: ~2d / CC: ~1h)
- **Priority:** P3
- **Depends on:** A defect set with known outcomes; the shadow merge gate's decision-time evidence (Track 16C) is a candidate harness
- **Context:** Deferred at /autoplan on 2026-09-24; both CEO voices flagged vendor diversity as an unmeasured premise. `docs/designs/review-independence.md` states the proxy and does not measure its defect-finding value. Its corrected satisfiability table and insufficient-evidence calls establish neither a benefit nor a measured independent review.

### [plan-eng-review:track=16B,defer=true] Automated test for the review-independence doc's reference evaluator

- **Description:** `docs/designs/review-independence.md` will carry a reference evaluator as a code block plus sample rows and their expected output. Add a `bun:test` suite that extracts that block, runs it on the sample rows, and asserts the documented output, so the doc's code and its claims cannot drift apart.
- **Hypothesis (untested):** A doc-extraction test is small (one test file plus one `MANUAL_TOUCHFILES` entry for the markdown dependency).
- **Pros:** Catches drift automatically on every doc edit instead of relying on a one-time manual replay.
- **Cons:** Needs a `tests/helpers/touchfiles.ts` entry, a file Track 16C also touches, so it cannot land inside Group 16 without breaking set-disjoint touches.
- **Effort:** S (human: ~2h / CC: ~15min)
- **Priority:** P3
- **Depends on:** Track 16B (the doc and its evaluator); Track 16C landing (shared `tests/helpers/touchfiles.ts`)
- **Context:** Deferred at /autoplan on 2026-09-24 (Eng review). The evaluator, sample rows, and expected output are in `docs/designs/review-independence.md`. Until this test exists, the appendix's manual replay extracts named blocks and compares exact ordered output with the corresponding expected blocks. Regression cases must reject missing/supplied proof, unknown contributing models and invalid authors, preserve requested-only assurance, accept an independent specialist alongside a same-vendor outside voice, and detect a mutated expected verdict.

### [investigate] cursor_turns() cannot read the Conductor store shape

- **Symptom:** `cursor_turns()` in `bin/lib/telemetry.py` returns no model for a Conductor-native Cursor run. On 2026-09-25 an isolated copy of one live `agents.ndjson` record and its matching `runs.ndjson` record, with cwd rewritten to the check directory, `CURSOR_AGENT=1`, and the conversation id set to that agent id, produced zero turns. `parse_ts` returned None for integer `updatedAt`, `startedAt`, and `endedAt`. `model.params` on all 40 store runs was a list of `{id,value}`, which the reader requires to be a dict. The same ISO-only `parse_ts` is applied to `startedAt` and `endedAt` around `bin/lib/telemetry.py:616`, so every run for a cwd passes the window test and a Conductor-native route is detected only when exactly one run exists for that cwd. No fixture covers the SDK store shape.
- **Repro:** Copy one store agent record and its run into an isolated HOME, set the agent cwd to the process cwd, export `CURSOR_AGENT=1` and `CURSOR_CONVERSATION_ID` to the agent id, and call `cursor_turns()`. Expect a turn whose model is `model.id`. Observed: no turns. Reuse `timestamp()` from `bin/lib/quota/common.py:108` for epoch-millisecond times and the quota usage reader's `model.id` path, which does not require dict params.
- **Effort:** M (human: ~1d / CC: ~30min)
- **Priority:** P2
- **Depends on:** Roadmap Track 17B owns `bin/lib/telemetry.py`. Cross-check Track 16A before editing `docs/telemetry.md`.
- **Context:** Measured during Track 16B (`docs/designs/review-independence.md`, evidence E4). 16A had not published a reader entry on 2026-09-25.

### [manual] File upstream: gstack review rows need per-voice observed model and vendor

- **Why:** gstack review rows record host, source, `outside_provider`, and `outside_status`, and do not record the model that ran each voice. `outside_provider` is the selected harness, not observed execution. On Cursor the primary vendor requires evidence from the session's contributing models, the outside voice is Codex, and the log cannot show whether any consumed voice is outside the author set and the primary vendor. gstack-extend `stage-runs.jsonl` does not cover these voices, because `/review` is a gstack skill.
- **Effort:** S (human: ~2h / CC: ~20min)
- **Priority:** P2
- **Context:** Owner is upstream gstack. Ready-to-file text is in `docs/designs/review-independence.md` section 12. The installed CHANGELOG at gstack 1.89.0.0 had no vendor-aware routing and no per-voice model field. Provenance call on 2026-09-25 was insufficient-evidence, which sets this priority to P2. Measured shape: 8 host cursor rows and 10 host grok rows, none with a model field; Conductor store runs requested `grok-4.7`. Corrected branch matching finds workspace candidates for all 8 Cursor rows, but no complete execution/result/consumption chain was frozen. Record those bindings alongside models, keeping requested and served evidence separate.

### [plan-ceo-review:track=18C,defer=true] Give skip-path /full-review runs a finished state, a report and a status
**What:** When `/full-review` skips Phase 5 (zero findings at Phase 2 Step 4, or zero approved clusters after triage), set `phase: complete`, write `report.md` with its GSTACK REVIEW REPORT, and give every run a Completion Status row, including all-rejected runs and runs where one agent failed while two completed.
**Why:** Today a clean or all-rejected run ends in chat as done but leaves `session.yaml` at `clusters_complete` or `triage_complete`, so the next `/full-review` offers to resume a finished session and Resume Flow re-enters Phase 3 or 5. Line 612 promises deferred clusters "remain in the report", which is never written; line 870 prepends to a missing `report.md`; the rollup at 827-830 has no row for all-rejected or partial-success runs.
**Context:** Found by Track 18C (/autoplan, both CEO voices). Related gaps to settle in the same change: the verdict mapping at 890-895 marks any agent failure BLOCKED while the rollup at 829 requires that no fallback succeeded (18C left that mapping in place for this item); the `edge_case_dropped` count lives only in orchestrator context and is lost on resume (persist it in `session.yaml`); the zero-findings branch keys on every agent returning `NO_FINDINGS`, so an all-edge-case run or a one-failed-two-clean run falls through to Phases 3-4 with zero clusters. Line numbers refer to `skills/full-review.md` at 139024e.
**Effort:** S
**Priority:** P2
**Depends on:** Track 18C landing (same file). Schedule ahead of further cosmetic trims of this skill.

### [plan-ceo-review:track=18C,defer=true] Drift-lock /full-review's severity and finding-field vocabulary
**What:** Add a test that fails when `skills/full-review.md` uses a severity name or finding field that `docs/source-tag-contract.md` does not define, and, while the three agent prompts stay self-contained, that their shared Shell Rules/Hot areas head and 16-line output-contract tail stay byte-identical across the Reviewer, Hygiene and Consistency prompts.
**Why:** Two renames left stale words in this skill (FIX -> HYPOTHESIS left "description, fix"; important/minor -> necessary/nice-to-have left "then important, then minor") because no test checks its unlocked prose; three hand-maintained prompt copies can drift the same way.
**Context:** Found by Track 18C (/autoplan). 18C fixes the current stale words without adding tests because `tests/skill-protocols.test.ts` (Track 18A) and `tests/audit-compliance.test.ts` (Track 18F) belong to other Tracks in the same Group. The contract's severity taxonomy and field list are the source of truth.
**Effort:** S
**Priority:** P3
**Depends on:** Tracks 18A and 18F landing.

### [plan-ceo-review:track=18C,defer=true] Resolve SESSION_DIR in /full-review's archive and checkpoint blocks
**What:** Give the Active Session Guard archive block and Phase 1 Step 4's `mkdir -p "$SESSION_DIR"` the same guarded Path Resolution setup the rest of the skill uses, so `session_archive_dir` is defined and `$SESSION_DIR` is set when those blocks run on their own.
**Why:** Line 220 says every state-touching block resolves `SESSION_DIR` first, but those two blocks do not; run alone, `session_archive_dir` is undefined and `$SESSION_DIR` is empty.
**Context:** Found by Track 18C (spec review). Both blocks need the resolver, so `tests/skill-protocols.test.ts` L7's count of 4 guards across the resolver skills becomes 6 unless the two blocks share one guarded setup; the fix and the count change land together. Until then, if the archive block runs on its own, `mv` fails and "Start a fresh review" writes over the old session's triage state.
**Effort:** S
**Priority:** P3
**Depends on:** Track 18A landing (owns `tests/skill-protocols.test.ts`).

### [plan-eng-review:track=18C,defer=true] Inline the tag-value rule in /full-review's and /pair-review's TODO templates
**What:** Add one line to `/full-review` Phase 5's entry template: omit the `files=` attribute when a path contains `[`, `]`, `,` or `;` (join several paths with `|`). Apply the same rule wherever `/pair-review` writes tagged entries.
**Why:** Tag values must not contain those characters (`docs/source-tag-contract.md`, "Values MUST NOT contain"), and a bracketed route path such as `app/[id]/page.tsx` becomes a malformed or injection-flagged tag that `TODO_FORMAT` rejects. The only pointer to that rule was a relative link to the contract, which does not exist in consumer repos; 18C removes the dead link.
**Context:** Found by Track 18C (Eng review, native voice). `skills/pair-review.md` still cites `docs/source-tag-contract.md` at lines 1244 and 1303 (Track 18D's file).
**Effort:** S
**Priority:** P2
**Depends on:** Tracks 18C and 18D landing (they own the two skill files).

## Completed

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
