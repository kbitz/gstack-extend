# Skill-edit test selection: before and after

Track 52A, measured against source revision `a8791e8` (before) and that
revision plus this Track's implementation (after). This record measures which
test files a one-line edit to a skill selects and how long the selected runs
take. It awards no checkpoint ([SPEC](../SPEC.md) selected target acceptance),
establishes no typical cost or saving, and is point-in-time: a later change to
the test map or the skills makes its lists and numbers stale without making this
record wrong. Only its statement below is locked by a test
(`tests/touchfiles.test.ts`).

## What this record does not claim

Unchanged by this Track: the review's external full-suite run, the narrowed
pregate's preflight-only run and the release stage's single
`EVALS_ALL=1 bun run test`. The Track narrows what a skill-only edit selects, so
it claims no end-to-end pipeline saving: the wall times below are four pairs of
single runs of the selected tests, not a measure of a whole review or release.

## What changed

Two mechanics suites, `tests/setup-hosts.test.ts` (the installer) and
`tests/telemetry.test.ts` (the telemetry wrapper), declared `skills/**` and so
ran on every skill edit, though most of what they check does not depend on a
skill's text. The rules that do read the real skill sources moved into
`tests/skill-content.test.ts`, which keeps the `skills/**` declaration; the two
mechanics suites no longer declare it and no longer name a repo skill path that
pregate's literal scan could read. One exception remains by design:
`skills/full-review.md` still selects `tests/telemetry.test.ts`, because that
file is the canonical source of the telemetry blocks the suite executes.

## Environment

| Item | Value |
|---|---|
| OS | macOS 27.2 (26B123) |
| CPU | Apple M2 Max, 12 cores, 64 GiB |
| Bun | 1.3.10 |
| Installed gstack | 1.91.367.0 |
| Harness | Claude Code 2.1.316 (commands were run from a shell; the harness did not take part in a run) |
| Before | revision `a8791e8`, tree `2d28254dd162` |
| After | the implemented tree committed on `a8791e8` in a disposable clone, tree `84c8bab8477c`; `origin/main` of that clone pointed at it, so pregate read the new map from its base as it will after merge |
| Probe | one line (`<!-- probe -->`) appended to the skill and committed in the clone; the clone was reset to its base between probes |
| Sample size | 1 per cell; a failed run was rerun once and both results are reported |

Both clones were made with `git clone --no-hardlinks --no-checkout` from the
working tree, then `bun install --frozen-lockfile`. Runs were serial, with no
other suite started from the measuring session. The machine was shared and not
quiet (below). Raw logs stay outside the repository.

## Commands

For each skill, in each clone:

- `TEST_SELECTION_OUT=<file>.json bun run test`: a direct run, which reads the map
  from the working tree.
- `gstack-pregate --allow-repo-commands --explain --base main --timeout 3000 --stall-timeout 1500 --out <file>.json`:
  a pregate run that cannot narrow. One command stands for both paths the card
  names, the default full-suite path and `full-suite=external` when its narrowing
  declines, because a declined narrowing runs the same pregate as the default
  path (see **Narrow the pregate after an accepted pass** in `/review-and-prep`).
  Pregate reads the map from the base branch, so only the after clone's base
  holds the new map.

The selected lists come from the selection report and from pregate's
`--explain` output (a non-executing probe in each clone confirmed them before the
timed runs). Pregate adds `tests/touchfiles.test.ts` for a `skills/roadmap.md`
edit because that suite's `matchGlob` unit test names the path in a literal.

## Selection

Skipped is every other `tests/*.test.ts` file: 78 files before, 79 after.

### `skills/roadmap.md`

| Test file | Before `bun run test` | Before pregate | After `bun run test` | After pregate |
|---|---|---|---|---|
| `tests/audit-compliance.test.ts` | ran | ran | ran | ran |
| `tests/docs-ship.test.ts` | ran | ran | ran | ran |
| `tests/setup-hosts.test.ts` | ran | ran | skipped | skipped |
| `tests/skill-content.test.ts` | skipped | skipped | ran | ran |
| `tests/skill-protocols-project-spec.test.ts` | ran | ran | ran | ran |
| `tests/skill-protocols-roadmap.test.ts` | ran | ran | ran | ran |
| `tests/skill-protocols.test.ts` | ran | ran | ran | ran |
| `tests/telemetry-doctor.test.ts` | ran | ran | ran | ran |
| `tests/telemetry.test.ts` | ran | ran | skipped | skipped |
| `tests/touchfiles.test.ts` | skipped | ran | skipped | ran |
| `tests/update.test.ts` | ran | ran | ran | ran |
| `tests/upstream-check.test.ts` | ran | ran | ran | ran |

| Count | Before `bun run test` | Before pregate | After `bun run test` | After pregate |
|---|---|---|---|---|
| Test files selected | 10 of 78 | 11 of 78 | 9 of 79 | 10 of 79 |
| Test files skipped | 68 | 67 | 70 | 69 |

Skipped in all four cells (67 files, every other `tests/*.test.ts` file): `audit-cli-contract`, `audit-invariants`, `audit-locale-safety`, `audit-no-stray-shellouts`, `audit-snapshots`, `autoplan-lean-history`, `autoplan-lean`, `check-future-split`, `check-group-deps`, `check-packing`, `check-parallelism-budget`, `check-phase-invariants`, `check-phases`, `check-size-caps`, `check-structure-tombstone`, `check-version-tag-staleness`, `check-vocab-lint`, `checks-doc-location`, `checks-doc-type`, `checks-version`, `greptile-lifecycle`, `handoff-contract`, `init-bin`, `init-distribution`, `init-registry`, `init-templates`, `layout-scaffold`, `lib-effort`, `lib-git`, `lib-in-flight`, `lib-install-safety`, `lib-pack`, `lib-parallelism-cap`, `lib-renames-diff`, `lib-renumber`, `lib-semver`, `lib-session-paths`, `lib-task-line`, `lib-todo-patterns`, `merge-gate-api-adversarial`, `merge-gate-collection-adversarial`, `merge-gate-coverage-audit`, `merge-gate-plan-contract`, `merge-gate-remote-adversarial`, `merge-gate-review-regressions`, `merge-gate`, `outside-review`, `pack-cli`, `parsers-phases`, `parsers-progress`, `parsers-roadmap`, `parsers-todos`, `quota`, `release-manifest`, `renumber-cli`, `secret-dispositions`, `setup-init-wire`, `skill-protocols-full-review`, `skill-protocols-implement`, `skill-protocols-pair-review`, `skill-protocols-plan-track`, `skill-protocols-review-and-prep`, `skill-protocols-ship-and-land`, `source-tag`, `telemetry-contract`, `touches-cli`, `workflow-metrics`.

### `skills/review-and-prep.md`

| Test file | Before `bun run test` | Before pregate | After `bun run test` | After pregate |
|---|---|---|---|---|
| `tests/audit-compliance.test.ts` | ran | ran | ran | ran |
| `tests/handoff-contract.test.ts` | ran | ran | ran | ran |
| `tests/outside-review.test.ts` | ran | ran | ran | ran |
| `tests/secret-dispositions.test.ts` | ran | ran | ran | ran |
| `tests/setup-hosts.test.ts` | ran | ran | skipped | skipped |
| `tests/skill-content.test.ts` | skipped | skipped | ran | ran |
| `tests/skill-protocols-project-spec.test.ts` | ran | ran | ran | ran |
| `tests/skill-protocols-review-and-prep.test.ts` | ran | ran | ran | ran |
| `tests/skill-protocols.test.ts` | ran | ran | ran | ran |
| `tests/telemetry-doctor.test.ts` | ran | ran | ran | ran |
| `tests/telemetry.test.ts` | ran | ran | skipped | skipped |
| `tests/upstream-check.test.ts` | ran | ran | ran | ran |
| `tests/workflow-metrics.test.ts` | ran | ran | ran | ran |

| Count | Before `bun run test` | Before pregate | After `bun run test` | After pregate |
|---|---|---|---|---|
| Test files selected | 12 of 78 | 12 of 78 | 11 of 79 | 11 of 79 |
| Test files skipped | 66 | 66 | 68 | 68 |

Skipped in all four cells (66 files, every other `tests/*.test.ts` file): `audit-cli-contract`, `audit-invariants`, `audit-locale-safety`, `audit-no-stray-shellouts`, `audit-snapshots`, `autoplan-lean-history`, `autoplan-lean`, `check-future-split`, `check-group-deps`, `check-packing`, `check-parallelism-budget`, `check-phase-invariants`, `check-phases`, `check-size-caps`, `check-structure-tombstone`, `check-version-tag-staleness`, `check-vocab-lint`, `checks-doc-location`, `checks-doc-type`, `checks-version`, `docs-ship`, `greptile-lifecycle`, `init-bin`, `init-distribution`, `init-registry`, `init-templates`, `layout-scaffold`, `lib-effort`, `lib-git`, `lib-in-flight`, `lib-install-safety`, `lib-pack`, `lib-parallelism-cap`, `lib-renames-diff`, `lib-renumber`, `lib-semver`, `lib-session-paths`, `lib-task-line`, `lib-todo-patterns`, `merge-gate-api-adversarial`, `merge-gate-collection-adversarial`, `merge-gate-coverage-audit`, `merge-gate-plan-contract`, `merge-gate-remote-adversarial`, `merge-gate-review-regressions`, `merge-gate`, `pack-cli`, `parsers-phases`, `parsers-progress`, `parsers-roadmap`, `parsers-todos`, `quota`, `release-manifest`, `renumber-cli`, `setup-init-wire`, `skill-protocols-full-review`, `skill-protocols-implement`, `skill-protocols-pair-review`, `skill-protocols-plan-track`, `skill-protocols-roadmap`, `skill-protocols-ship-and-land`, `source-tag`, `telemetry-contract`, `touches-cli`, `touchfiles`, `update`.


## Timing

Wall time is bash `time` around the whole command. Load is the one-minute load
average from `uptime` immediately before and after the run. Test counts are
bun's, over the selected files.

### `skills/roadmap.md`

| Run | Files | Tests | Wall time | Load start / end | Exit |
|---|---|---|---|---|---|
| Before, `bun run test` | 10 | 1395 | 583.6 s | 4.49 / 4.37 | 0 |
| Before, pregate | 11 | 1465 | 601.9 s | 3.40 / 3.48 | 0 |
| After, `bun run test`, run 1 | 9 | 966 | 146.4 s | 4.38 / 5.50 | 1 |
| After, `bun run test`, run 2 | 9 | 966 | 143.7 s | 3.97 / 3.96 | 0 |
| After, pregate, run 1 | 10 | 1041 | 166.8 s | 4.16 / 3.45 | 1 |
| After, pregate, run 2 | 10 | 1041 | 156.1 s | 2.97 / 3.67 | 0 |

Both after run 1 failures are one test in `tests/docs-ship.test.ts`, `links,
anchors and claims > a wrong SHA, a misquoted user line and a broken anchor are
three findings`, and both reruns passed. It is a flake that predates this Track
and is in the selection before and after: the test builds a fixture repository
and expects a claim for the first ten characters of its commit SHA, and the
checker (`src/docs-ship/check.ts`) skips a candidate with no letter `a` to `f`,
which a ten-character all-digit prefix is (about 0.9% of commits). The two
failing runs printed all-digit prefixes, and repeating the test 300 times failed
3 times. No test was edited to obtain a number.

### `skills/review-and-prep.md`

| Run | Files | Tests | Wall time | Load start / end | Exit |
|---|---|---|---|---|---|
| Before, `bun run test` | 12 | 1784 | 561.8 s | 3.89 / 2.73 | 0 |
| Before, pregate | 12 | 1784 | 547.4 s | 3.81 / 4.47 | 0 |
| After, `bun run test` | 11 | 1356 | 126.1 s | 2.53 / 3.44 | 0 |
| After, pregate | 11 | 1356 | 119.0 s | 4.35 / 6.17 | 0 |

### Observed difference, passing runs only

| Cell | Before | After | Difference |
|---|---|---|---|
| `skills/roadmap.md`, `bun run test` | 583.6 s | 143.7 s | 439.9 s less |
| `skills/roadmap.md`, pregate | 601.9 s | 156.1 s | 445.8 s less |
| `skills/review-and-prep.md`, `bun run test` | 561.8 s | 126.1 s | 435.7 s less |
| `skills/review-and-prep.md`, pregate | 547.4 s | 119.0 s | 428.4 s less |

Each is one unpaired sample under a load between 2.5 and 6.2 on a shared
machine, so the differences carry that noise. The card's earlier 929 s baseline
was a different, unpaired sample and is not compared here. Wall time is the
machine's, not model or token time, and none of it is a pipeline saving (see
**What this record does not claim**).

## Moved rules and their mutation result

These rules read real skill text and run in `tests/skill-content.test.ts` with
their assertions unchanged (19 tests, about 17 s on its own). Each mutation was
applied to the after clone's working tree only, the suite was run, and the file
was restored. Every mutation failed the rule it names.

| Rule | Moved from | Tests | Mutation | Failed test |
|---|---|---|---|---|
| Skill sources never hardcode `~/.claude/skills/` | installer suite | 1 | added the path to `skills/roadmap.md` | the hardcode rule |
| `--host cursor` preserves bodies and strips `allowed-tools` | installer suite | 1 | made `description: |` plain in `skills/roadmap.md` | the cursor rule (and `roadmap description ≤ 1024`) |
| Generated host copies carry the extend-root resolver | installer suite | 1 | removed the `_ER_SKILL=roadmap` line | the resolver rule |
| `gstack-extend-upgrade` keeps `INSTALL_WARN` outside its shared flow | installer suite (split from its recovery test) | 1 | renamed every `INSTALL_WARN` in that skill | the upgrade rule |
| Source descriptions fit the 1024-unit limit | installer suite | 12 | added 1,100 characters to the `review-and-prep` description | `review-and-prep description ≤ 1024` (and the cursor rule) |
| Each skill's own telemetry blocks pair and the doctor counts them (stub, real) | telemetry suite | 2 | broke the `SHARED:telemetry-start` marker in `skills/roadmap.md` | both the stub and the real test |
| `RESUMABLE` is exactly the skills that document their resume command | telemetry suite | 1 | replaced the `/review-and-prep resume` text in `skills/review-and-prep.md` | the `RESUMABLE` rule |

The known exception: `skills/full-review.md` still selects
`tests/telemetry.test.ts`.

## Reach, as verified

- A direct `bun run test` narrows at once: the after runs above used the working
  tree's map.
- Pregate narrows only after this change merges, because it reads the map from
  the base branch; the after pregate runs used a clone whose base held the
  implemented tree.
- `/implement` writes its own targeted command, so the Track only gives it a
  cheaper file to name for real-skill content rules (`tests/skill-content.test.ts`).
- `/docs-ship` is not claimed. It selects tests by their text and not by this
  map (`src/docs-ship/pinning.ts`), and it stops on paths under `skills/` unless
  a project opts them in (`src/docs-ship/classify.ts`).

## Limits

- One sample per cell, unpaired in time, on a shared machine whose load was not
  controlled. No typical cost or saving is established.
- Wall time is not model time.
- A test in either mechanics suite that uses a real skill as fixture input now
  runs only on `setup`, `bin/**` and full runs, so a defect there appears at
  the release stage's full run and not on the skill edit. The frontmatter rules
  those tests rely on stay covered by `tests/audit-compliance.test.ts` and
  `tests/skill-content.test.ts`.
- The lint that keeps pregate's literal scan clear of the mechanics suites mirrors
  the scan's two readings (a quoted path and a `join()` of quoted segments); it
  does not import them. The real pregate runs above prove the state at this
  release; a later upstream change would show as a wider selection, not a missed
  test.
- Selection and timings are not locked; rerun the probes if the map or a moved
  test changes before release.
