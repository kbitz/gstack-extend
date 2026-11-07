# First-Cycle Review Overlap (`first-cycle=overlap`)

Track 69A (`b4af8ce2-d8d3-4f37-ae8f-b6162cd0b6dd`). Recorded `2026-11-06`.

## 1. Verdict

No saving or quality result is established, no checkpoint is awarded and the default is unchanged.

## 2. The value

`first-cycle=overlap` is an opt-in `Review policy:` value (`review-and-prep-policy/v1`, key `first-cycle`, only value `overlap`).

- **Scope:** Applies only to the original invocation's full-scope cycle 1 (`Scope: full`, `cycle=1`). It never applies to repair cycles (`cycle >= 2`, `Scope: repair`), to a `/review-and-prep continue` invocation, to docs-only PRs (`/docs-ship`), or to `light` unless explicitly named in `Review policy:`.
- **Light default:** The light default (`bin/config set review_default light`; see [the skill](../../skills/review-and-prep.md#use-the-light-review-default)) never sets `first-cycle=overlap`; overlapping independent cycle-1 reviewers remains opt-in until paired runs establish its wall-time, token and finding-quality trade-off across hosts.
- **Activation check:** Before cycle 1 starts, the agent checks eight exact `grep -F` spans in the active `/review` skill and its adversarial instructions (`review/sections/adversarial.md` in the nested layout, the review file itself in the sibling layout); `bin/upstream-check` verifies the same eight spans plus the `### Overlap independent first-cycle reviewers` inventory heading under `review-and-prep.overlap` (`97` total checks at upstream `1.96.0.0`).
- **Gate posture:** It waives no gate, drops no required reviewer, never replaces missing outside coverage with a local pass, and never authorizes a stage or merge.
- **Receipt line:** Published in the `/review-and-prep` receipt (`STOPPED`, `PAUSED`, and Step 6 body) as `Review overlap: overlapped (cycle 1; parts=<comma-separated parts>; window=<UTC dispatch>–<UTC last return>)`, `Review overlap: sequential — <reason>`, or `Review overlap: stopped — work tree changed during the window` only when `first-cycle=overlap` is in `Review policy:`. The `Review overlap:` line is `receipt-present` in `docs/workflow-handoffs.md` and never authorizes a stage or merge.

## 3. Independence table at `1.96.0.0`

Inspected at upstream revision `9ceec3f05e4a960d023b3140d6f7a28ed06662d5` (`1.96.0.0`) across `~/.claude/skills/gstack/review/SKILL.md`, `~/.claude/skills/gstack/review/sections/adversarial.md`, `~/.codex/skills/gstack-review/SKILL.md`, and `~/.cursor/skills/gstack-review/SKILL.md`.

| Cycle-1 part | Input | Depends on | Placement relative to the overlap window |
| --- | --- | --- | --- |
| Step 4 Core two-pass review (Pass 1 critical + Pass 2 informational) | `git diff <base> S`, `review/checklist.md`, grepped symbol callers, changed files | Step 1–3 diff, scope, and candidate snapshot `S` | Runs **before** the window (`Window` opens after Step 4's core pass and Review Army's printed selection `Dispatching N specialists: …`); core findings are never passed into any window part |
| Step 4.5 Selected specialist subagents (`testing`, `maintainability`, `security`, `performance`, `data-migration`, `api-contract`, `design`, `simplification`, `state-machines`) | `git diff "<merge base>" "S"`, domain checklist file (`review/specialists/<name>.md`), read-only repo access | Scope selection and `specialists.json` history from Step 4.5 | Runs **inside** the window (`3`); dispatched in one message alongside the native adversarial subagent and the outside pair background command |
| Step 4.8 Always-on native adversarial subagent | `git diff "<merge base>" "S"` (reads the diff and finds ways the code will fail in production; fresh context) | Diff, repository context, and `S` only; no dependency on core pass or specialist findings | Runs **inside** the window (`3`); dispatched in the same message as the selected specialist subagents |
| Step 4.8 Outside challenge call (`codex exec` or `claude -p`) | `git diff "<merge base>" "S"`, plan, spec, acceptance obligations, and repository context fixed before the pass started | Diff, `S`, and selected outside voice (never includes a finding from this pass) | Runs **inside** the window (`3`); starts as the first subshell in the single owned background command for the outside pair |
| Step 4.8 Outside structured review (`codex review --base <base>` or `claude -p`) | `git diff "<merge base>" "S"` (`--base <base>`) | Diff, line count (`DIFF_INS + DIFF_DEL >= 200` or override gate), and completion of the outside challenge block in the same background command | Runs **inside** the window (`3`) when selected; runs sequentially after the outside challenge block inside the single owned background command |
| Step 4.6 Red Team subagent | Merged specialist findings from Step 4.6 and `git diff "<merge base>" "S"` (`DIFF_LINES > 200` or any specialist `CRITICAL` finding) | Merged specialist findings (Step 4.6) | Runs **after** the specialist subagents settle and Step 4.6 merges their outputs (`Collection`); never in the window's initial dispatch, though it may overlap with an still-running outside pair command |
| Step 4.7 Exploratory QA & Test-Driven Review | Live execution, stack detection, and work tree at `S` | Completion (or confirmed stop) of every reader, including the Red Team and the outside pair | Runs **after** the window (`Collection`); starts only after every reader has returned or is confirmed stopped so the work tree stays at `S` while any reader runs, followed by the `S^{tree}` work-tree check |
| Step 5 Combine, Step 5.0 deduplicate, and Fix-First | Core pass findings, specialist + Red Team findings, native adversarial findings, outside challenge + structured outputs, and Step 4.7 QA findings | Collection of all cycle-1 review parts and passing `S^{tree}` work-tree verification | Runs **after** collection and the `S^{tree}` check, before any repair edit |

## 4. The fold and delegate settlement

- **Co-occurrence rule:** `specialists=fold` folds the selected cycle-1 specialist checklists into the single-agent core pass; `delegate=` delegates selected cycle-1 work to a worker. Either option changes which cycle-1 parts exist as separate subagent dispatches. When `first-cycle=overlap` is combined with `specialists=fold` or `delegate=` in `Review policy:`, `first-cycle=overlap` stands down to today's sequential order without voiding the `Review policy:` line and records `Review overlap: sequential — specialists=fold set` (or `Review overlap: sequential — delegate= set`).
- **Upstream `1.96.0.0` anchor state:** At upstream `1.96.0.0` (`9ceec3f05e4a960d023b3140d6f7a28ed06662d5`), both `specialists=fold` and `delegate=` are inactive because their combine anchor expects `Combine core, specialist, Step 4.7 QA, Step 4.8 adversarial and VALID & ACTIONABLE Greptile findings.` while the installed upstream text reads `Combine core, specialist, Step 4.7 QA, Step 4.8 adversarial and VALID & ACTIONABLE review bot findings.`. Because their activation checks fail on current upstream, their measured arms cannot run without an anchor update. _Note (2026-11-06):_ On 2026-11-06 the Track "Reconcile `delegate=` and `specialists=fold` with upstream /review's specialist-dispatch contract" re-anchored the combine line and settled the item, so both activate at `1.96.0.0`; see [`docs/upstream-check.md`](../upstream-check.md).
- **Residual value:** Whether `specialists=fold` or `delegate=` leaves `first-cycle=overlap` worth enabling by default is `unknown` until measured, but `first-cycle=overlap` still overlaps the always-on native adversarial subagent and the outside CLI challenge/structured calls that a specialist fold keeps separate.

## 5. Hosts and layouts

- **Inspected layouts (`1.96.0.0`):**
  - Nested layout: `~/.claude/skills/gstack/review/SKILL.md` (5 review spans) and `~/.claude/skills/gstack/review/sections/adversarial.md` (3 adversarial spans).
  - Sibling layout: `~/.codex/skills/gstack-review/SKILL.md` (all 8 spans in one file) and `~/.cursor/skills/gstack-review/SKILL.md` (byte-identical to `.codex` for `gstack-review/SKILL.md`).
  - `bin/upstream-check` inspects both layouts (`Layout.review` and `Layout.adversarial`) and reports `OK inventory review-and-prep.overlap` plus `OK anchor review-and-prep.overlap.review.1..5` and `OK anchor review-and-prep.overlap.adversarial.1..3`.
- **Host-cap rule:** When a host cannot send several reviewer subagent dispatches in one message and run them at once, cannot keep one long command running in an owned background session while they run and report its completion, states a concurrent-subagent limit below the window's part count, or cannot tell, the precondition fails with `Review overlap: sequential — host cap (<which>)` and cycle 1 runs in today's sequential order.
- **Installed-agent runs:**
  - Paseo workspace-host runs: 0, pending.

## 6. E1 baseline, today's order

Retained-receipt backtest over merged PRs `#196–#207` on `main` (`2026-11-01` through `2026-11-06`).

- **Selection rule:** Merged PRs in `#196–#207` whose `/review-and-prep` receipt includes a per-cycle or per-stage reviewer breakdown for a full-scope cycle (`n = 6`: `#198`, `#199`, `#200`, `#202`, `#206`, `#207`).
- **Exclusions (`6` of `12`):**
  - `#197`, `#205`: `/roadmap` regenerations with no `/review-and-prep` receipt.
  - `#203`: docs-only PR (`/docs-ship`) with no `/review-and-prep` receipt.
  - `#196`, `#201`, `#204`: `/review-and-prep` receipts summarize cycle-1 coverage in prose rather than a per-cycle or per-stage reviewer table (`#196` is a timeout-repair continuation receipt referencing an earlier comment; `#201` and `#204` summarize full-scope review in prose).
- **Local ledger availability:** Local `workflow-metrics` ledgers (`~/.gstack-extend/analytics/workflow-metrics/`) are not present on this machine (checked `2026-11-06`), so per-part wall time and voice interval overlap for `#196–#207` are `unknown` except where timestamps appear directly in the PR receipt. This Track's own `/review-and-prep` run, in today's sequential order, is the next sample.

| PR | Commit (Track) | Cycle-1 wall time | Cycle-1 findings by part | Host / harness | Unavailable sources |
| --- | --- | --- | --- | --- | --- |
| `#198` | `9b4a3ab` (Track 65C) | Final full review `2026-11-03T22:37:10.787Z`–`22:39:48.534217Z` (`157.7s`); per-part wall time `unknown` | Core `0`, Testing `0`, Maintainability `0`, Security `0`, Performance `0`, Simplification `0`, Native adversarial `0`, Claude Code outside challenge `0` (`NO_FINDINGS`, `claude-opus-5-5`); State machines, API contract, migration, design skipped by scope; Red Team adaptive skip (`< 201` lines, no CRITICAL); Structured outside adaptive skip (`< 200` lines) | macOS (`~/.claude/...`, `~/.codex/...`); Claude Code outside challenge | Local `workflow-metrics` ledger (`analytics/workflow-metrics/<sha256(session_id)>.jsonl`) and the separate reviewer join file (`voices.jsonl`) |
| `#199` | `5e6441b` (Track 65A) | `unknown` (first invocation `00:22:36Z` to `~04:55Z` cap stop; continuation `04:59:33Z` to `~06:50Z` external-gate pause; cycle-1 span not isolated) | Continuation full pass `C1` (`469` lines): 5 specialists (`testing`, `maintainability`, `security`, `performance`, `simplification`) `0` (`NO FINDINGS ×5`), Red Team `2`, Native adversarial `3`, Codex challenge `1` (`P2`), Codex structured `unverified` (`untagged_review`, missing coverage). `Repair classification:` `cycle=1` lines across both invocations total `10` (`5` CRITICAL, `5` INFORMATIONAL) | Codex outside voice (`Codex challenge`, `Codex structured`); OS/harness not named in receipt | Per-cycle timestamps; local `workflow-metrics` ledger |
| `#200` | `a479b0b` (Track 65D) | `unknown` (receipt gives a final native review binding interval of `2026-11-04T13:11:56Z`–`13:26:38Z`, but no isolated cycle-1 span) | Final full-scope review (`50` added lines): Core `0` unresolved, Testing `0`, Maintainability `0`, Native adversarial `0` (`NO FINDINGS`), Outside Claude Code challenge `0` actionable (suggestions dismissed in dispositions); Security, performance, migration, API contract, design, simplification skipped by scope; State machines `false`; Red Team not activated (`50` lines, no CRITICAL); Structured outside size-gated (`< 200` lines) | Paseo-managed worktree; Claude Code outside challenge | Cycle-1 start/end timestamps; local `workflow-metrics` ledger |
| `#202` | `634c05e` (Track 66A) | Receipt elapsed timeline: `2026-11-04T19:30Z`–`20:48Z` (approximately `4,680s`, minute resolution); per-part wall time `unknown` | Cycle 1 full on `5642fad`: Core + 5 specialists (`testing`, `maintainability`, `security`, `performance`, `simplification`; 4 skipped by scope) + Red Team + Native adversarial + Codex challenge + Codex structured (`missing coverage`, `OUTSIDE_STATUS unverified`) reported `7` fixed (`1` CRITICAL from Codex challenge, `6` INFORMATIONAL: `2` Red Team, `1` native adversarial, `3` core/specialist) and `9` dropped/noted | macOS (`~/.mmm/...`); Codex outside voice | Per-part timestamps; local `workflow-metrics` ledger |
| `#206` | `269d411` (Track 67A) | `unknown` (continuation started `2026-11-05T16:49:39.579382+00:00`, cycle-1 baseline written before first source repair at `18:06:28.380767+00:00`, `4,608.8s`; the recorded cycle-1 review/fix window `16:52:27Z`–`18:21:26Z` includes repairs; receipt `Workflow metrics` line covers final resumed segment only with `local_passes=0`) | Cycle 1 full source reports before consolidation: Core `findings repaired`, `testing` `2`, `maintainability` `0`, `security` `0`, `performance` `0`, `simplification` `1`, `state-machines` `0` (`data-migration`, `api-contract`, `design` skipped by scope), `red-team` `1`, Native adversarial `findings repaired`, Claude outside challenge `completed (adjudicated)`, Claude outside structured `completed (adjudicated)` | macOS (`~/.gstack/...`); Claude outside challenge and structured voices | First-segment `workflow-metrics` ledger |
| `#207` | `aa82da2` (Track 68A) | `unknown` (first invocation `23:43:59Z`–`01:02Z` across 3 passes; continuation `01:32Z`–`03:20Z` including owner pause; receipt `Workflow metrics` line covers final resumed segment only with `local_passes=0; union_wall_ms=1803`) | Pass 1 (full): Core, 5 specialists (`testing`, `maintainability`, `security`, `performance`, `simplification`; 4 skipped by scope), Red Team, Native adversarial, Codex challenge (`completed`, `P1`), Codex structured (`unavailable: two attempts, both unverified`), Exploratory QA (`4` probes passed) → `9` fixed, `1` advisory not applied, `1` note (`26` `cycle=1` `Repair classification:` lines across both invocations: `12` CRITICAL, `14` INFORMATIONAL). Pass 4 (continuation full start): 5 specialists `0`, Red Team `1`, Native adversarial `2`, Codex challenge `1` (`P2`), Codex structured `unavailable, unverified` (`4` deferred by owner) | macOS (`~/.mmm/...`, `~/.gstack/...`); Codex outside voice | First-segment `workflow-metrics` ledger |

## 7. After

`0` overlap runs have been executed. Wall time, token usage, and finding quality under `first-cycle=overlap` are `unknown`.

## 8. E5 record fields and the paired-run protocol for activation

To evaluate `first-cycle=overlap` for post-merge verification or future default promotion, run paired full-scope cycle-1 passes on the same frozen candidate heads in both orders — today's sequential order (no `first-cycle=overlap`) and `Review policy: review-and-prep-policy/v1; first-cycle=overlap` — on the Paseo workspace host.

For each paired run, record:

1. **Frozen candidate head and scope:** Repository, branch/worktree, frozen commit SHA, `git diff <base>` line counts (`DIFF_INS`, `DIFF_DEL`), and selected specialists.
2. **Metrics summary (`metrics read` and `metrics read --usage`):**
   - `observed_wall_duration_ms` and `union_observed_wall_ms` (which already unions begin/end `captured_at_ms` boundaries in `analytics/workflow-metrics/<sha256(session_id)>.jsonl`; the separate `voices.jsonl` join file does not feed this union).
   - Sequential sum of observed part waits versus interval-union wall duration for cycle 1. Outside spans are parent-observed bounds: the structured span includes its wait for the challenge. Use the adapter's separate `dispatched_at`/`returned_at` timestamps for outside-call durations; never label the synthetic fixture's ideal intervals as observed runtime.
   - `usage` token totals and availability (`capture`, `reasons`, and `totals` separated into `direct`, `correlated`, and `unknown` evidence, with `input`, `cache_read`, `cache_write`, `output`, and `reasoning` counts when exposed by the harness). Keep `cli_reported` totals separate from harness totals.
3. **Findings by part (`findings.by_part`):** Per-part finding counts (`core`, `specialist:<name>`, `red-team`, `native-adversarial`, `outside:challenge`, `outside:structured`, `qa`) before and after Step 5 deduplication.
4. **Accepted versus missed findings:** Which actionable defects (`CRITICAL` and accepted `INFORMATIONAL`) each order found, whether the overlapped run missed any defect the sequential run caught (or vice versa), and whether Step 5 deduplication produced the same repair set.
5. **Dispatch and return overlap:** The `Review overlap:` receipt line (`Review overlap: overlapped (cycle 1; parts=<comma-separated parts>; window=<UTC dispatch>–<UTC last return>)`), plus the reviewer join file's `dispatched_at`/`returned_at` and `time_basis: parent-observed`, the metrics boundary records, and the outside adapter's per-call timestamps. Parent-observed intervals establish dispatch/wait overlap, not simultaneous model execution; unknown execution overlap stays unknown. Verify Red Team dispatch followed all specialist returns.
6. **Host-cap fallbacks and orchestration overhead:** Any `Review overlap: sequential — <reason>` or `Review overlap: stopped — work tree changed during the window` outcome, subagent/background-command contention, timeout rate, or extra coordination turns.

**Activation rule (`docs/SPEC.md` P1):** Promoting `first-cycle=overlap` into the default or into the configured light review default requires a qualitative judgment on the recorded paired runs showing that overlapping independent cycle-1 parts lowers cycle-1 wall time without degrading accepted finding quality, missing coverage, or increasing orchestration failures on Paseo. No arbitrary numeric percentage threshold is set.

## 9. Older producers

`Review policy:` uses the fixed-key `review-and-prep-policy/v1` grammar (`docs/workflow-handoffs.md` H-E), where unknown keys are non-conformant.

- **Installed-skill capability check:** Before a caller emits `first-cycle=overlap` in `Review policy:`, it checks whether the installed `/review-and-prep` skill supports the key:
  ```bash
  grep -F 'first-cycle=overlap' "<installed skill dir>/SKILL.md"
  ```
- **Failure behavior:**
  - If a caller emits `first-cycle=overlap` to an older installed `/review-and-prep` skill that predates Track 69A, the older skill's fixed-key parser rejects the unknown `first-cycle` key and treats the entire `Review policy:` line as `none supplied` (falling back to the skill's unconfigured default and dropping sibling keys on that line), while an older H-E validator holds the line as `policy-malformed`.
  - When the `grep -F 'first-cycle=overlap'` check fails, the caller omits `first-cycle=overlap` from `Review policy:` and keeps the remaining keys on the line intact.

## 10. Limits and what this Track does not claim

### Limits

- **Prose-level concurrency instruction:** `first-cycle=overlap` is a skill-protocol instruction in `skills/review-and-prep.md`, not a custom process scheduler; actual parallelism depends on the host harness's subagent and background-command execution tools.
- **Unanchored Review Army prose:** While `bin/upstream-check` anchors the 5 review spans and 3 adversarial spans across both layouts, the sibling review copy omits Review Army. The wrapper's Step 1 recovers that section from the same source installation or blocks if it is unavailable. Its Red Team wording and dispatch mechanics are not separately anchored line-by-line; the runtime independence rule (`Preconditions: inputs not independent (<part>)`) governs if upstream rewrites a part to consume another part's output.
- **Background outside-call lifecycle on host-cap hosts:** Hosts that cannot run several reviewer subagent dispatches in one message and keep one owned background command running alongside them fall back via the `Review overlap: sequential — host cap (<which>)` rule rather than running the overlap window.
- **Historical receipts without local ledgers:** Historical PR receipts `#196–#207` on `main` lack local `workflow-metrics` JSONL ledgers on this machine, so historical per-part wall durations and interval overlap are `unknown` until new runs record them.

### What this Track does not claim

- No wall-time saving is claimed.
- No finding-quality equivalence or improvement is claimed.
- No token-spend reduction or overhead figure is claimed.
- No change to the default `/review-and-prep` behavior or to the configured light review default is made.
- No installed-agent Paseo workspace-host run is claimed in this Track (`Paseo workspace-host runs: 0, pending`).
