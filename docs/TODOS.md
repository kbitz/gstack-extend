# TODOS

## Unprocessed

### [review:files=src/upstream-check/probe.ts|tests/upstream-check.test.ts] Test gap: probe typed writes and callbacks

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** Probe fixtures cover ordinary stdout/stderr strings, noise, overflow and abrupt exits, but do not directly assert typed buffers, explicit encodings or write callbacks.
- **Hypothesis (untested):** Extend the subprocess fixtures to assert exact bytes and callback results; re-verify the gap first without adding production exports.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/upstream-check/probe.ts:87`, `src/upstream-check/probe.ts:107`.
- **Evidence:** Coverage audit and full source-context recovery read the writer and owning tests; no failure reproduced for these cases. Track 72D's required overflow, deadline and attribution tests remain intact.
- **Context:** Filed by `/review-and-prep` at `7d7fb5d` on 2026-11-08, before draft PR creation.
- **Revisit when:** The next Track touches either tagged path or changes the probe stream adapter.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=src/upstream-check/probe.ts|tests/upstream-check.test.ts] Test gap: bounded probe write errors

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** Existing large-output and flood fixtures do not deterministically assert recovery, exhaustion and permanent-error branches of the synchronous writer's backoff.
- **Hypothesis (untested):** Exercise the subprocess boundary with test-only write fault injection, checking intact output and bounded completion; re-verify before implementing.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/upstream-check/probe.ts:93`.
- **Evidence:** Audit read the bounded EAGAIN/EWOULDBLOCK loop and current probe fixtures; current integration tests pass, and no write-error defect was reproduced. No production seam is proposed.
- **Context:** Filed by `/review-and-prep` at `7d7fb5d` on 2026-11-08, before draft PR creation.
- **Revisit when:** The next Track touches either tagged path or changes write retry handling.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=tests/helpers/child-stdio.ts|tests/child-stdio.test.ts] Test gap: child stdio creation-failure cleanup

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** Helper tests assert cleanup after success, nonzero exit and failed child launch, but do not directly inject capture-file or FIFO creation failures.
- **Hypothesis (untested):** Extend the lifecycle tests with a failing mkfifo fixture and appropriate file-open failure, asserting no temporary resources remain; re-verify the gap first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `tests/helpers/child-stdio.ts:172`, `tests/helpers/child-stdio.ts:231`.
- **Evidence:** Audit read the creation error handlers and existing unit tests; no creation failure or leak was reproduced. Track 72D's required native failed-spawn and cleanup tests pass.
- **Context:** Filed by `/review-and-prep` at `7d7fb5d` on 2026-11-08, before draft PR creation.
- **Revisit when:** The next Track touches either tagged path or changes helper resource creation.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=skills/pair-review.md|tests/skill-protocols-pair-review.test.ts] Test gap: pair-review stage-line value bindings

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** The template and exit hooks are locked, but the producer mapping clauses that derive status from the session rollup, give a BLOCKED rollup precedence, and bind head to current HEAD are not fully locked in the pair-review protocol suite.
- **Hypothesis (untested):** Extend the existing stage-line test to protect those clauses; re-verify the gap first. Static assertions would protect instructions, not prove installed-agent behavior.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `skills/pair-review.md:1631`, `tests/skill-protocols-pair-review.test.ts:1039`.
- **Evidence:** Coverage audit read the producer mappings, protocol assertions and shared handoff fixtures; no failure was reproduced. The approved Track 72A T8 assertions and AC4 template lock are present.
- **Context:** Filed by `/review-and-prep` at `fed62ef` on 2026-11-08, before draft PR creation.
- **Revisit when:** The next Track touches either tagged path or changes these stage-line bindings.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=src/docs-ship/pregate.ts|tests/docs-ship.test.ts] Test gap: pregate envelope refusal variants

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** Malformed envelope and lane-field variants lack direct CLI fixtures.
- **Hypothesis (untested):** Extend the existing refusal table for invalid schema, SHA, checks cardinality and selection/lines types. Re-verify before implementing.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/docs-ship/pregate.ts`.
- **Evidence:** Coverage audit row 22; source and existing tests read, no failure reproduced. All Track 72C T3 and T4 required cases exist.
- **Context:** Filed by `/review-and-prep` at `97dd3f9` on 2026-11-08, before draft PR creation.
- **Revisit when:** The next Track touches a tagged path.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=src/docs-ship/pregate.ts|tests/docs-ship.test.ts] Test gap: pregate remote and no-policy outcomes

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** Supported requires-remote and warn PREGATE_NO_POLICY outcomes lack focused fixtures.
- **Hypothesis (untested):** Add outcome-table rows proving nonexecuting selection is retained. Re-verify before implementing.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/docs-ship/pregate.ts`.
- **Evidence:** Coverage audit row 23; source and existing tests read, no failure reproduced. All Track 72C T3 and T4 required cases exist.
- **Context:** Filed by `/review-and-prep` at `97dd3f9` on 2026-11-08, before draft PR creation.
- **Revisit when:** The next Track touches a tagged path.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=src/docs-ship/pregate.ts|tests/docs-ship.test.ts] Test gap: pregate full-SHA config binding

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** Bump fixtures pass main rather than a full config SHA.
- **Hypothesis (untested):** Exercise a full-SHA config ref and a stale prefix at the CLI boundary. Re-verify before implementing.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/docs-ship/pregate.ts`.
- **Evidence:** Coverage audit row 24; source and existing tests read, no failure reproduced. All Track 72C T3 and T4 required cases exist.
- **Context:** Filed by `/review-and-prep` at `97dd3f9` on 2026-11-08, before draft PR creation.
- **Revisit when:** The next Track touches a tagged path.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=src/docs-ship/pregate.ts|tests/docs-ship.test.ts] Test gap: pregate alternate provenance and escaping

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** Self-test, multi-hop, repeated reasons and special output characters lack focused fixtures.
- **Hypothesis (untested):** Extend provenance cases to check the authenticated test set and deterministic quoted reasons. Re-verify before implementing.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/docs-ship/pregate.ts`.
- **Evidence:** Coverage audit row 25; source and existing tests read, no failure reproduced. All Track 72C T3 and T4 required cases exist.
- **Context:** Filed by `/review-and-prep` at `97dd3f9` on 2026-11-08, before draft PR creation.
- **Revisit when:** The next Track touches a tagged path.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=src/docs-ship/pregate.ts|tests/docs-ship.test.ts] Test gap: pregate frozen-pin failure paths

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** Frozen-pin regression fixtures cover valid pins, not unreadable or malformed pin metadata.
- **Hypothesis (untested):** Add invalid pin cases proving coverage is never silently dropped. Re-verify before implementing.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/docs-ship/pregate.ts`.
- **Evidence:** Coverage audit row 26; source and existing tests read, no failure reproduced. All Track 72C T3 and T4 required cases exist.
- **Context:** Filed by `/review-and-prep` at `97dd3f9` on 2026-11-08, before draft PR creation.
- **Revisit when:** The next Track touches a tagged path.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=src/docs-ship/pregate.ts|tests/docs-ship.test.ts] Test gap: pregate no-lane delta variants

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** No-policy warning parsing, missing strict FAIL lines and bump no-lane filtering lack focused fixtures.
- **Hypothesis (untested):** Extend no-lane and bump fixtures with relevant and unrelated findings. Re-verify before implementing.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/docs-ship/pregate.ts`.
- **Evidence:** Coverage audit row 27; source and existing tests read, no failure reproduced. All Track 72C T3 and T4 required cases exist.
- **Context:** Filed by `/review-and-prep` at `97dd3f9` on 2026-11-08, before draft PR creation.
- **Revisit when:** The next Track touches a tagged path.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=src/docs-ship/cli.ts|tests/docs-ship.test.ts] Test gap: pregate explanation file boundary

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** The policy-backed --pregate file boundary lacks missing and nonregular-file cases.
- **Hypothesis (untested):** Extend CLI cases for FILE_MISSING and UNSAFE_PATH while preserving the policyless ignore behavior. Re-verify before implementing.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/docs-ship/cli.ts`.
- **Evidence:** Coverage audit row 28; source and existing tests read, no failure reproduced. All Track 72C T3 and T4 required cases exist.
- **Context:** Filed by `/review-and-prep` at `97dd3f9` on 2026-11-08, before draft PR creation.
- **Revisit when:** The next Track touches a tagged path.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=src/docs-ship/pregate.ts|tests/docs-ship.test.ts] Test gap: pregate frozen-pin glob variants

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** Pin fixtures cover ** and ? but not literal brackets/braces and depth/normalization variants.
- **Hypothesis (untested):** Extend the existing pin fixture against the documented upstream glob contract. Re-verify before implementing.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/docs-ship/pregate.ts`.
- **Evidence:** Coverage audit row 29; source and existing tests read, no failure reproduced. All Track 72C T3 and T4 required cases exist.
- **Context:** Filed by `/review-and-prep` at `97dd3f9` on 2026-11-08, before draft PR creation.
- **Revisit when:** The next Track touches a tagged path.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=skills/docs-ship.md|tests/docs-ship.test.ts] Test gap: docs-ship installed selection workflow

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** Helper integration and prompt locks cannot prove installed-agent execution through selection, bump and receipt.
- **Hypothesis (untested):** Use Track 76B installed acceptance for refusal, stale output, fresh bump and no-tests states; report exercised versions only. Re-verify before implementing.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `skills/docs-ship.md`.
- **Evidence:** Coverage audit row 30; source and existing tests read, no failure reproduced. All Track 72C T3 and T4 required cases exist.
- **Context:** Filed by `/review-and-prep` at `97dd3f9` on 2026-11-08, before draft PR creation.
- **Revisit when:** The next Track touches a tagged path (installed acceptance is already assigned to Track 76B).
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=src/review-delegate/delegate.ts] Adversarial criteria line is still found by being unique, not by its place in the prompt block

- **Description:** `extractAdversarialChecklist` now finds the framing line by position (the line after the one `Subagent prompt:` line), but still requires the criteria line (`Think like an attacker and a chaos engineer. ...`) to occur once in the whole file, and drops any line between the framing and criteria lines other than upstream's `Read the diff for this branch` line without notice. A future sibling rendering that repeats the criteria text refuses `checklist-anchor`, which turns off every delegated part for that run; an instruction upstream adds inside the prompt block never reaches the delegate.
- **Why it can wait:** No installed copy triggers it (nested, Codex and Cursor copies of gstack 1.97.0.0 all extract the same checklist), and the refusal fails closed: every part runs on the host.
- **Upstream severity:** CRITICAL by `/review`'s rule that a FIXABLE adversarial finding is critical; the reviewer rated it Low, `Blocks: no`.
- **Found in:** `src/review-delegate/delegate.ts` (`extractAdversarialChecklist`).
- **Context:** Filed by `/review-and-prep` (Track 72B, cycle 2 native adversarial pass) at `bdfbf8d` on 2026-11-08, before draft PR creation; kept as an auto-chosen disposition at `/review`'s cycle cap.
- **Revisit when:** An upstream rendering repeats the criteria line or adds lines inside the adversarial subagent prompt block, or `bin/upstream-check` reports drift on a `review-and-prep.attacker.adversarial` anchor.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=skills/review-and-prep.md|src/review-delegate/cli.ts|docs/delegated-review.md] Delegate runner failure and caught-file edge cases left after Track 72B

- **Description:** Six low-impact gaps a cycle 3 native adversarial pass found in the delegation section's failure and caught-file rules. (1) A runner that dies after dispatch (the internal-failure exit 1 with empty stdout, or a signal exit) is recorded as no delegate attempt, under-counting a paid call, and the host gets no explicit before/after work-tree comparison while detached provider process groups may outlive the runner. (2) An exit 0 or 4 whose `parts` array cannot be parsed (for example a truncated tool capture) has no recovery rule; rerunning the identical command replays saved results with no spawn. (3) Rename-into-place can replace an existing caught file, which works against "never rewrite it" if a resume rebuilds the list. (4) The temp file's mode and an fsync before the rename are unspecified. (5) The receipt note for an exit with no `parts` array has no defined line or receipt site. (6) Recording a credited red-team part in `specialists` on a nested diff under 50 lines departs from upstream step 7's small-diff map.
- **Why it can wait:** Each case falls back to the host model, so coverage is kept; (1) predates this Track (exits other than 0, 1 and 4 were undefined in the Track 64C rules). `docs/delegated-review.md`'s matching caught-file and exit text is left to the documentation audit.
- **Upstream severity:** CRITICAL by `/review`'s rule that a FIXABLE adversarial finding is critical; the reviewer rated (1) Medium and the rest Low, all `Blocks: no`.
- **Found in:** `skills/review-and-prep.md` (`### Delegate named specialist parts`, the Run paragraph and the credited-parts bullet), `src/review-delegate/cli.ts` (`main`, `runPart`, `prepare`).
- **Context:** Filed by `/review-and-prep` (Track 72B, cycle 3 native adversarial pass) at `bdfbf8d` on 2026-11-08, before draft PR creation; kept as auto-chosen dispositions at `/review`'s cycle cap.
- **Revisit when:** The next change to delegation failure handling or the caught file, a `PM2` run in `docs/acceptance/attacker-parts.md` shows a killed runner or a refused red-team call, or a receipt shows a delegate exit other than 0, 1, 2 or 4.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=src/review-delegate/cli.ts|tests/review-delegate.test.ts] Test gap: runner refusal when red-team.md drifts or is missing

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** `prepare()` refuses `checklist-anchor` when `<gstack-root>/review/specialists/red-team.md` is missing or no longer carries the red-team anchors, but no test drives that branch; the existing anchor-drift test covers the specialist checklists and `--adversarial` only.
- **Hypothesis (untested):** Add a red-team row to the anchor-drift test in `tests/review-delegate.test.ts` (rewrite an anchor in the fixture `red-team.md`, and remove the file) for `check` and `run` in both layouts; re-verify the gap first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-delegate/cli.ts` (`prepare`, red-team branch), `tests/review-delegate.test.ts` (anchor-drift test).
- **Evidence:** The `/ship` coverage audit (audit-only) traced the branch and found no test; `bun test tests/review-delegate.test.ts tests/upstream-check.test.ts` passed (383 pass, 0 fail); no failure was reproduced.
- **Context:** Filed by `/review-and-prep` (Track 72B) at `7948a6b` on 2026-11-08, before draft PR creation.
- **Revisit when:** The next Track touches either tagged path or the red-team checklist anchors.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=src/review-delegate/delegate.ts|tests/review-delegate.test.ts] Test gap: adversarial extraction when the prompt line is the file's last line

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** `extractAdversarialChecklist` refuses when no line follows the one `Subagent prompt:` line (the framing line is undefined), but the drift table has no row where the prompt line is last.
- **Hypothesis (untested):** Add that row to the extractor drift table in `tests/review-delegate.test.ts`; re-verify the gap first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-delegate/delegate.ts` (`extractAdversarialChecklist`), `tests/review-delegate.test.ts` (adversarial drift test).
- **Evidence:** The `/ship` coverage audit (audit-only) found every existing row has a line after the prompt line; no failure was reproduced.
- **Context:** Filed by `/review-and-prep` (Track 72B) at `7948a6b` on 2026-11-08, before draft PR creation.
- **Revisit when:** The next Track touches either tagged path or the adversarial extraction rule.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=tests/review-delegate.test.ts|src/review-delegate/cli.ts] Test gap: repo-mode hiding of linked worktrees end to end

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** Repo mode hides every path `git worktree list` names, but only `parseWorktreeList` is unit-tested; nothing runs a sandboxed delegate that checks a linked worktree is empty inside the sandbox.
- **Hypothesis (untested):** Create a linked worktree inside an exposed directory (setup allows an entry above a hidden path, so only the worktree tmpfs can hide it), run the `repo-probe` fake and assert its listing is empty. Re-verify the gap first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `tests/review-delegate.test.ts` (parseWorktreeList test), `src/review-delegate/cli.ts` (`prepareRepoCopy` hide list).
- **Evidence:** Cycle-2 testing specialist of the delegate repo-access review; no failure was reproduced.
- **Context:** Filed by /review-and-prep on branch `mmm/2c6f332d` (delegate repo access) at the cycle-cap stop (2026-11-08).
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-delegate/cli.ts|tests/review-delegate.test.ts] Test gap: repo-mode setup step that times out or fails in git

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** Only the `expose` setup failure is asserted; no test drives a setup `git` step past the part's deadline (`setup failed (<step>: timeout)`, `timeout`) or a failing `git` step (`failed`).
- **Hypothesis (untested):** Reuse the PATH git shim from the slow-setup test so `fetch` sleeps past a short `timeout_s`, then assert `fallback_reason: timeout` and the saved stderr step name. Re-verify the gap first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-delegate/cli.ts` (`runSetupGit`, `prepareRepoCopy`).
- **Evidence:** Cycle-2 testing specialist; no failure was reproduced.
- **Context:** Filed by /review-and-prep on branch `mmm/2c6f332d` (delegate repo access) at the cycle-cap stop (2026-11-08).
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-delegate/cli.ts|tests/review-delegate.test.ts] Test gap: runner temporary directory reaches the sandbox's private tmpfs list

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** `sandboxArgs` is tested to mount the private directories it is given, but no test proves `prepare()` puts a TMPDIR outside `/tmp` into that list.
- **Hypothesis (untested):** Pass `deps.bwrapPaths` a shim that logs its argv and execs the real bwrap, set TMPDIR to a fresh directory, and assert `--tmpfs <TMPDIR>` precedes the expose mounts. Re-verify the gap first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-delegate/cli.ts` (`prepare`, `privateDirs`).
- **Evidence:** Cycle-3 testing specialist; no failure was reproduced.
- **Context:** Filed by /review-and-prep on branch `mmm/2c6f332d` (delegate repo access) at the cycle-cap stop (2026-11-08).
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-delegate/delegate.ts|tests/review-delegate.test.ts] Test gap: keyring seccomp program's compat and x32 entries

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** The keyring seccomp program carries x86_64 (with the x32 mask), i386, aarch64 and arm entries and denies other architectures, but only a native keyctl call under bwrap is tested.
- **Hypothesis (untested):** A small classic-BPF evaluator over `(arch, nr)` pairs would pin every entry's jump offsets and syscall numbers; re-verify the gap first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-delegate/delegate.ts` (`keyringSeccomp`).
- **Evidence:** Continuation cycle-2 testing specialist; the security specialist independently confirmed native and x32 keyctl return EPERM under bwrap. No failure was reproduced.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/224 (2026-11-08).

### [review:files=src/review-delegate/delegate.ts|tests/review-delegate.test.ts] Test gap: /proc/key-users mask in repo mode

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** `sandboxArgs` binds an empty file over both `/proc/keys` and `/proc/key-users`, but the repo-probe test reads back only `/proc/keys`, so dropping the `/proc/key-users` bind would pass.
- **Hypothesis (untested):** Have the repo-probe fake also read `/proc/key-users` and assert it is empty; re-verify the gap first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-delegate/delegate.ts` (`sandboxArgs`).
- **Evidence:** Continuation cycle-3 testing specialist. No failure was reproduced.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/224 (2026-11-08).

### [review:files=src/review-delegate/cli.ts|tests/review-delegate.test.ts] Test gap: repo-mode cleanup chmod fallback

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** When the first removal of a part's disposable root fails, cleanup runs `chmod -R u+rwx` (10 s bound) and retries, marking `spawn_error` if the retry fails too. No test makes the first removal fail, so the fallback and its `spawn_error` marking are unexercised.
- **Hypothesis (untested):** A fake that leaves a read-only directory in the copy would drive the fallback; re-verify the gap first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-delegate/cli.ts` (`spawnProvider` cleanup).
- **Evidence:** Continuation cycle-3 testing specialist. No failure was reproduced.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/224 (2026-11-08).
- **Effort:** ? (user triages in /roadmap)

### [review:files=tests/review-delegate.test.ts|src/review-delegate/cli.ts] Test gap: repo-mode timeout removes the disposable root

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** The repo-mode timeout test's title says it removes the disposable root, but it asserts only the part's outcome row.
- **Hypothesis (untested):** Have the sleep fake report its working directory through stderr, then assert that path no longer exists after the run. Re-verify the gap first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `tests/review-delegate.test.ts` (repo-mode timeout test).
- **Evidence:** Continuation-2 cycle-1 testing specialist and core pass; no failure reproduced.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/224 at c3bb147 (2026-11-09).
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-delegate/cli.ts|tests/review-delegate.test.ts] Test gap: repo-mode setup hardening

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** Setup git's absolute-only `PATH` and working directory, the fixed-path `getent` and `chmod` (including the case where neither exists) and the 30 s cleanup cap have no test.
- **Hypothesis (untested):** Plant a `git` in a relative `PATH` entry inside the reviewed repository and assert it never runs while the part is credited; inject the cleanup limit to exercise the cap. Re-verify the gap first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-delegate/cli.ts` (`setupGitEnv`, `passwdHome`, `spawnProvider` cleanup).
- **Evidence:** Continuation-2 cycle-3 testing specialist and native adversarial pass; no failure reproduced.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/224 at c3bb147 (2026-11-09).
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-delegate/cli.ts|src/review-delegate/delegate.ts] Repo mode: mount layers at their resolved spelling

- **What:** Mount every tmpfs, expose layer and the copy at its resolved spelling, so an `expose` entry, `HOME` or the runner's temporary directory reached through a symlink into a hidden directory (for example `/home` linked to `/var/home`) works instead of failing setup on every call.
- **Why deferred:** It fails closed and is documented; end-to-end tests need fixtures outside every hidden root. Auto-chosen at the continuation-2 cycle-1 stop.
- **Revisit when:** A host with a symlinked home or temporary directory adopts repo mode, or the next Track touches the mount code.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/224 at c3bb147 (2026-11-09).

### [review:files=tests/review-delegate.test.ts] Background-child test relies on fixed timers

- **What:** The test that a background child inside bwrap dies with its parent asserts a negative after a fixed 1.5 s child timer and a 2.5 s wait. Add a heartbeat or a positive control so it cannot pass vacuously under load.
- **Why deferred:** Auto-chosen at the continuation-2 cycle-1 review; no failure observed.
- **Revisit when:** The next Track touches that test or the PID-namespace handling.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/224 at c3bb147 (2026-11-09).

### [review:files=src/review-delegate/cli.ts|src/review-delegate/delegate.ts] Repo mode: retry a setup failure and keep a credited result past slow cleanup

- **What:** A setup failure (the provider never started) is saved like any failed call, so the same frozen scope replays `failed`; and a removal of the disposable root that passes the 30 s cleanup cap turns a credited result into a saved failure. Save a distinct setup status a later run may retry, and settle with the provider's result plus a separate root-remained signal.
- **Why deferred:** The plan keeps claims, replay and `decide` unchanged; both cases are documented. Auto-chosen at the continuation-2 cycle-2 and cycle-3 reviews.
- **Revisit when:** A repo-mode part is seen replaying a setup failure, or cleanup is seen hitting the cap.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/224 at c3bb147 (2026-11-09).

### [review:files=src/review-delegate/delegate.ts|docs/delegated-review.md] Repo mode: network isolation beyond --share-net

- **What:** Repo mode shares the host network, so code from the reviewed head reaches every loopback service on the host. Consider `--unshare-net` with an API-only path (a proxy over a Unix socket, or pasta/slirp4netns with loopback blocked).
- **Why deferred:** The owner accepted the network bound as the provider command's job (plan answer "4 accept"); the loopback exposure is documented. Auto-chosen at the continuation-2 cycle-3 review.
- **Revisit when:** Repo mode is used on a host that runs unauthenticated loopback services, or a provider offers an API-only network mode.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/224 at c3bb147 (2026-11-09).

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
