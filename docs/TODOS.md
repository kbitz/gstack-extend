# TODOS

## Unprocessed

### [ship:track=13A] Pre-existing parsers-roadmap.test.ts Group 6 completeness failure (P1)
- **What:** `tests/parsers-roadmap.test.ts:484` asserts `Group 6` in `docs/ROADMAP.md` is NOT complete, but the parser marks it complete. Confirmed pre-existing — fails on clean `origin/main`, NOT caused by Track 13A's ROADMAP edits.
- **Why:** Breaks the green `bun run test` baseline. /ship has to triage and skip it on every run until fixed.
- **How:** Read the test assertion (line 479-485) and the parser logic in `src/parsers/roadmap.ts`. The parser's `isComplete` heuristic for Group 6 has likely been broken by a recent ROADMAP.md restructure (the `## Shipped` section currently has Group 6 under "Phase 1 Group 4 Bun Test Migration ✓ Shipped" lineage and the parser may be inferring completion from the surrounding context). Either fix the parser to match current `## Shipped` semantics OR update the test's expected value if the parser is correct and ROADMAP intent changed.
- **Priority:** P1
- **Source:** Found by /ship Step 5 on branch `kbitz/skill-telemetry` (Track 13A). Surfaced earlier during the same branch's /review run.

### [review:track=12A] Track 12A follow-ups (low-priority polish surfaced by /review)
- **What:** Polish items from pre-landing review on Track 12A. None blocking; bundle into a future Group.
  - **Multi-worktree slug collision in registry**: `detect_slug` returns same slug for two checkouts sharing `remote.origin.url`, so the second `init --migrate` silently overwrites the first entry's `path`. Decide: slug-only key (current) vs `slug+realpath` composite vs warn-on-conflict.
  - **Remote-URL change orphans entries**: re-forked/renamed projects get a new slug and a duplicate registry entry; old entry leaks forever. Mitigate via `doctor` reaper (already a reserved subcommand stub) or by passing an "old slug" arg to `registry_upsert` when state detection sees a path match under a different slug.
  - **Audit-failure path test (D3.A)**: write a tests/init-bin.test.ts case that PATH-shims a non-zero `roadmap-audit` and asserts: exit 1, stderr contains "audit FAILED", stderr contains "--migrate" hint, rendered files still on disk. Without this, a regression that swallowed audit failures would pass CI silently.
  - **Concurrent registry write test**: spawn 5-10 parallel `registry_upsert` invocations and assert the final file parses as JSON. The lib docstring claims last-write-wins; test it.
  - **validate_name edge cases**: add tests for `--name ..`, `--name .`, `--name -leading-dash`, `--name ''`, `--name café` (Unicode). Today the regex blocks all of these but no test locks the behavior.
  - **lang_detect precedence**: add tests for ambiguous targets (package.json + pyproject.toml → bun wins; pyproject + requirements → pyproject wins). Locks the ordering against accidental refactor.
  - **setup self-register fail-soft test**: pre-create `~/.gstack-extend/projects.json` as corrupt JSON before running setup; assert exit 0, stderr "Note: ... self-registration skipped" + diagnostic line, skill install still completes.
  - **render_all map ↔ CANONICAL_FILES DRY**: both arrays encode the canonical paths separately; adding a 7th canonical file requires updating both. Refactor to derive map from CANONICAL_FILES.
  - **Shared test helper `mkScope`**: 4 init test files duplicate the home/state/groot/target tmpdir setup. Extract to `tests/helpers/init-scope.ts`.
  - **setup env inheritance**: setup self-register call inherits `GSTACK_EXTEND_STATE_DIR` from the user's environment. If set for a test run, setup silently registers into the test registry. Either `env -u GSTACK_EXTEND_STATE_DIR` before the call, or document.
  - **Skill preamble single-hop readlink**: `skills/gstack-extend-init.md` uses single-level readlink; `bin/gstack-extend` uses multi-hop walker. Mirror the walker in the skill preamble for symmetry.
  - **Fresh-init audit output is alarming**: a fresh `init` prints the full audit body including `## VERSION ... STATUS: fail (No git tags found)` immediately before printing `SUCCESS`. Trim to non-pass-only sections, or downgrade VERSION-no-tags to `info` for fresh projects.
- **Why:** Each item is a small ship-grade polish that would distract from Track 12A's landing. Surfaced by /review 2026-05-16 specialist sweep (testing/maintainability/security) + adversarial subagent.
- **Pros:** Closes obvious gaps; locks in current behavior; reduces drift surface; improves the fresh-init UX.
- **Cons:** Pure polish — none of these block users; the existing code is correct and shipping.
- **Context:** Each item is independently small (S effort). Could fit into one consolidated "12A polish" Track or split across natural homes (registry items → near 12B/Group 21; doctor-related items → future `doctor` subcommand Track).
- **Effort estimate:** Human ~half day total / CC ~30 min.
- **Priority:** P2 / P3 (polish, not blocking)
- **Depends on / blocked by:** Track 12A merged.
