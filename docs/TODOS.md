# TODOS

## Unprocessed

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

### [investigate] The Cursor and quota sentence overstates what the store reader can read

- **Symptom:** `docs/telemetry.md` section "Cursor and quota" says local native SDK runs supply model and effort when readable, otherwise null. The live Conductor store shape is never readable by `cursor_turns()`, so the null is structural, not an occasional miss. A reader can think a null model means the run did not name one.
- **Repro:** Read the "Cursor and quota" paragraph, then run the repro on `cursor_turns() cannot read the Conductor store shape`. The store record's `model.id` is `grok-4.7` while the reader returns no turn. Update the sentence, and link `docs/designs/review-independence.md` from that section. Track 16B does not edit `docs/telemetry.md`.
- **Effort:** S (human: ~1h / CC: ~15min)
- **Priority:** P2
- **Depends on:** The reader fix above, or a doc change that describes the current failure without waiting for it. Owner of `docs/telemetry.md`. Track 16A had not corrected this sentence as of 2026-09-25.
- **Context:** `docs/designs/review-independence.md` section 8.

### [manual] File upstream: gstack review rows need per-voice observed model and vendor

- **Why:** gstack review rows record host, source, `outside_provider`, and `outside_status`, and do not record the model that ran each voice. `outside_provider` is the selected harness, not observed execution. On Cursor the primary vendor requires evidence from the session's contributing models, the outside voice is Codex, and the log cannot show whether any consumed voice is outside the author set and the primary vendor. gstack-extend `stage-runs.jsonl` does not cover these voices, because `/review` is a gstack skill.
- **Effort:** S (human: ~2h / CC: ~20min)
- **Priority:** P2
- **Context:** Owner is upstream gstack. Ready-to-file text is in `docs/designs/review-independence.md` section 12. The installed CHANGELOG at gstack 1.89.0.0 had no vendor-aware routing and no per-voice model field. Provenance call on 2026-09-25 was insufficient-evidence, which sets this priority to P2. Measured shape: 8 host cursor rows and 10 host grok rows, none with a model field; Conductor store runs requested `grok-4.7`. Corrected branch matching finds workspace candidates for all 8 Cursor rows, but no complete execution/result/consumption chain was frozen. Record those bindings alongside models, keeping requested and served evidence separate.

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
