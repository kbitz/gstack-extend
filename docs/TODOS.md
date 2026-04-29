# TODOS

## Unprocessed

### [manual] FRESHNESS skipped because prose conflated `STALENESS: pass` with "no recency check needed"
Dogfooding `/roadmap` on bolt: I read v0.16.2's `STALENESS: pass` and prematurely concluded "skip FRESHNESS." That was the bigger error than the 2-commit threshold — even with the threshold raised, FRESHNESS would still surface candidates if the op actually ran. `STALENESS` only fires on items with explicit `(shipped vN.N.N)`-style version-tag annotations; it cannot pass-or-fail the broader "is this still active?" question. The skill prose at `skills/roadmap.md:105` lists `staleness_fail OR git_inferred_freshness >= 1` as the FRESHNESS trigger — correct on paper, but the names are close enough that prose readers (including me) confuse them.
- **Why:** the gap is less helper logic, more naming + reader-orientation. STALENESS reads like a superset of FRESHNESS. A model reading "STALENESS: pass" naturally infers the freshness question is settled.
- **Proposed fix:** two complementary moves. (1) Rename `STALENESS` audit check to `VERSION_TAG_STALENESS` (or similar) so the scope is explicit in the section name itself. (2) Add a one-line clarifier in `skills/roadmap.md` Interpreting Audit Findings: "`STALENESS: pass` only means no version-tag-annotated items are stale. It does not mean the roadmap is fresh — that's `FRESHNESS`'s job."
- **Effort:** S (human: ~30 min / CC: ~10 min) — mechanical rename in `bin/roadmap-audit` + tests + skill prose blurb.
- **Depends on:** nothing.

### [manual] FRESHNESS scan never looks at TODOS.md — shipped items rot indefinitely
Dogfooding `/roadmap` on bolt: the JMAP destroy-notFound TODO shipped in `v0.11.1.0` (commit `c5bd72a`, PR #168) but stayed in TODOS.md unmarked because (a) the freshness scan only walks ROADMAP.md, (b) the item's title doesn't include the shipped version, and (c) nobody added a `(shipped v0.11.1.0)` annotation to the TODO when the work landed. TRIAGE's auto-suggest-kill checks STALENESS findings + missing-file references; neither fires on a TODO whose referenced files still exist and have no version tag.
- **Why:** TODOS.md is the inbox for everything that's not yet promoted to a Track — long-tail items live there for months. Nothing prevents them from rotting after they ship.
- **Proposed fix:** extend the freshness scan to walk TODOS.md items in `## Unprocessed` using the same heuristic (extract referenced file paths from `Proposed fix` / prose, run the per-file commit-since-introduction lookup). Apply the same Track-ID-or-title-fuzzy-match rule from the bundled-PR fix. Surface candidates in the same FRESHNESS AskUserQuestion flow with options "Mark shipped (remove)" / "Still relevant".
- **Effort:** M (human: ~3 hrs / CC: ~45 min) — new `_inferred_freshness_for_todo` function in `bin/roadmap-audit`, fixture tests, prose update in `skills/roadmap.md` Op: FRESHNESS to mention TODOS.md sweeping.
- **Depends on:** Track-ID-match relaxation (✓ shipped in v0.17.1) so single-bundled-PR TODOs also fire, not just 2+-commit churn.

### [review] Harden setup against attacker-controlled symlink components at the install target
`setup` install/uninstall paths do not check whether `$SKILLS_DIR/{skill}` is itself a symlink before `ln -snf` / `rm -f` / `rmdir` touch `$SKILLS_DIR/{skill}/SKILL.md`. If a user (or attacker with write access to their home dir) has created a symlink at that path pointing elsewhere, install writes into / uninstall removes from the pointed-to directory, outside the intended skills tree. Raised by codex adversarial review of Pre-flight 1 (branch `kbitz/eng-review-g1`, 2026-04-24).
- **Why:** defense-in-depth against symlink-component trust boundary violations. Unusual in practice (users don't normally create symlinks at those exact paths), but the fix is small and closes a real-if-narrow attack surface. Becomes more relevant once `--skills-dir` is used in shared / semi-trusted directories.
- **Proposed fix:** before `ln -snf` in the install loop, assert `[ ! -L "$target" ]` (the directory itself, not `$target/SKILL.md`) — fail with a clear error if the path component is a symlink. Same check in the uninstall loop before `readlink`/`rm`. Add targeted tests that create a symlink at `$CUSTOM_DIR/pair-review` pointing elsewhere and assert install/uninstall refuse with a clean message.
- **Effort:** S (human: ~30 min / CC: ~10 min) — mechanical, two sites, ~15 lines plus tests.
- **Depends on:** nothing.

### [ship] Validate /test-plan v1 on first real Group post-v0.15.0
Step 14 of the v0.15.0 /test-plan design plan ("run on one real Group before declaring v1 shipped") was deferred to post-merge — gstack-extend didn't have a fresh in-flight Group to test against pre-ship. On the next real Group (Group 3+), run `/test-plan run <group>` end-to-end, capture the extractor's JSON output against at least one review doc, and run `scripts/test-test-plan-extractor.sh --score <output.json>` to confirm the >=70% tolerant-match threshold holds on real prose. If below threshold, iterate the extractor prompt at `skills/test-plan.md:378`.
- **Why:** close the v0.15.0 completeness loop. The 122-assertion test suite covers the deterministic surface; extractor output quality on real prose is the one thing we couldn't validate pre-merge.
- **Depends on:** gstack-extend running a new Group with >=2 Tracks that have CEO/eng/design review docs generated. Not blocking v0.15.0 itself — this is verification work that retires the deferred plan item.
- **Priority:** P1
- **Effort:** S (human: ~30 min / CC: ~5 min)

### Follow-up perf audit of remaining per-line bash loops
`count_todo_patterns` was rewritten single-pass awk in v0.9.0 (45s → 4s on the
gstack-extend repo). Remaining per-line bash loops in `bin/roadmap-audit` may
still dominate on larger projects: the state-machine parse in `_parse_roadmap`
for each ROADMAP.md line forks multiple `grep`s, and `check_vocab_lint` /
`check_structure` / `check_staleness` each do per-line scans. On repos with
ROADMAP.md >500 lines this matters.
- **Why:** keep audit interactive (<1s) even as projects scale.
- **Effort:** M (human: ~2 days / CC: ~30 min).

### [manual] Port `bin/roadmap-audit` out of bash
The script is 3,495 lines of bash doing markdown parsing, ROADMAP topology
analysis, and JSON emission. A single audit run on this repo's own ROADMAP.md
takes ~70s; on a tiny fixture, ~2s. Profile shows ~272 command substitutions
per run plus an `O(active_tasks × git_history)` `git log -S` loop in the
freshness scan.
- **Why:** the language is wrong for the job. Audit is the brain of `/roadmap`
  — slow audit = sluggish skill. A real language with real string/JSON
  primitives would cut runtime by an order of magnitude. Subsumes the
  per-line bash-loop perf TODO above. The test pain that originally
  motivated this TODO has been mitigated by the snapshot redesign at
  `tests/roadmap-audit/` (~25s for full coverage), so this is a pure
  binary-perf improvement now, not a test fix.
- **Proposed approach:** Python (no new deps in gstack context) or pure-stdlib
  Node. Port behavior-preserving against the snapshot suite — every existing
  `expected.txt` becomes a golden file the new binary must reproduce
  byte-for-byte. Once green, retire the bash impl. The snapshot harness
  itself (`scripts/test-roadmap-audit.sh`) doesn't change; it shells out to
  whatever `bin/roadmap-audit` is.
- **Targets after port:** real-repo audit <5s (vs 70s now), audit binary
  <800 lines (vs 3,495), snapshot suite <5s (vs 25s now).
- **Risk:** the freshness `git log -S` scan is the one place where shelling
  out is genuinely the right call — port should keep that pattern, just stop
  paying it 272× per run for unrelated string ops.
- **Depends on:** nothing.
- **Effort:** L (human: ~3-5 days / CC: ~half-day session). Big diff but
  bounded — the snapshot suite is the test oracle.

### CLAUDE.md cleanup skill
New skill (`/claude-md-cleanup` or similar) that audits a project's CLAUDE.md for
bloat: duplicated info that already exists in README or other docs, stale references
to files or features that no longer exist, sections that should be pointers instead
of inline content. Produces a streamlined CLAUDE.md with cross-references.
- **Why:** CLAUDE.md files accumulate cruft over time. Manual cleanup is tedious and
  easy to forget. A skill can detect duplication against README, TESTING.md, etc.
  and suggest consolidation automatically.
- **Effort:** M (human: ~2 days / CC: ~30 min)

### Evaluate SKILL.md.tmpl shared template (Approach A) once patterns 1-3 have lived
The v0.10-v0.12 plan grafts three patterns (Completion Status Protocol, Confusion
Protocol, GSTACK REVIEW REPORT table) into each of the three skills as appended
sections. If the same cross-cutting edits start getting duplicated across skills,
that is the signal to promote them into a shared template.
- **Why:** single source of truth for cross-cutting protocol additions; new skills
  inherit automatically; matches gstack's own generated-SKILL.md pattern. Defer
  until the pain is real — template + conditional logic can get ugly if pattern
  variations emerge per-skill.
- **Depends on:** v0.10.0–v0.12.0 shipped; at least one cross-skill protocol edit
  that felt painful to do three times.
- **Effort:** L (human: ~3 days / CC: ~1 hour)
- **Context:** deferred from /plan-eng-review on kbitz/gstack-patterns (see
  `~/.gstack/projects/kbitz-gstack-extend/kb-kbitz-gstack-patterns-design-20260418-105937.md`).

### Tighten `git commit` failure handling across skills (full-review, pair-review, review-apparatus)
All three skills currently treat any non-zero exit from `git commit` as "nothing to
commit, that's fine — continue." Affected lines: `skills/full-review.md:498`,
`skills/pair-review.md` (parked-bug and fix-flow commits), `skills/review-apparatus.md:346`.
The pattern silently swallows pre-commit hook rejections, missing `user.email`
config, detached-HEAD refusal, and other failure modes that are NOT "clean tree."
Result: the skill reports a commit that didn't land, and the user thinks their
work is safe when it isn't.
- **Why:** data loss risk. If a user's pre-commit hook rejects the change and the
  skill moves on, the approved TODOs / group summary / apparatus proposals exist
  only as unstaged working-tree edits. Next operation that touches those files
  can lose them silently.
- **Proposed fix:** before committing, snapshot staged state via
  `git diff --cached --quiet; _HAS_STAGED=$?`. Run `git commit` only if
  `_HAS_STAGED` is 1 (something staged). On non-zero `git commit` with staged
  content present, escalate as BLOCKED with the stderr tail rather than
  swallowing silently. Apply identically to all three skills to preserve parity.
- **Effort:** S (human: ~2 hours / CC: ~20 min) — small, mechanical, three skills
  to touch but each edit is one code block.
- **Context:** Flagged by Claude adversarial subagent during /review on
  kbitz/pair-review-assist (2026-04-18). Not fixed in that PR because the pattern
  is inherited from full-review.md and fixing only review-apparatus would create
  inconsistency. Worth a dedicated cleanup PR. Source: `[review]`.

### Skill-file simplification pass (v0.10–v0.15 accrual)
Five releases (v0.10.0 → v0.15.0) added cross-cutting protocol grafts
(Completion Status, Confusion Protocol, GSTACK REVIEW REPORT table, Group-level
deps, test-plan composition) into the skill files. The grafts were appended
rather than woven in, so skills have grown noticeably. Do a deliberate
simplification pass across `skills/pair-review.md` (970 lines),
`skills/roadmap.md` (1253 lines), `skills/full-review.md` (775 lines),
`skills/review-apparatus.md` (478 lines), `skills/test-plan.md` (850 lines) —
collapse duplicated guidance, consolidate repeated JSON schemas / output
contracts, and identify any section that's gone stale since its graft. Must
not drop functionality — gate on `scripts/test-skill-protocols.sh` passing
unchanged.
- **Why:** skill files are the user-facing instruction surface; bloat degrades
  routing accuracy and makes each new graft harder. Also the natural precursor
  to the deferred `SKILL.md.tmpl` work above — can't promote shared patterns
  into a template until we see which patterns actually rhyme across skills.
- **Scope discipline (enforced via review, added via /plan-eng-review 2026-04-24):**
  Only remove content that is (a) literally duplicated within a single skill,
  (b) word-level redundancy ("X is important because Y, so we must do X"
  → collapse to one statement), (c) obviously stale (refs to removed
  features like `/browse-native`, refs to versions/sections that no longer
  exist), (d) dead cross-references. OUT of scope: prose rewrites for style
  on non-duplicated content, consolidation of distinct-but-similar sections
  with subtle differences, section reordering within skills.
- **Shared graft handling (locked 2026-04-24):** The 3 graft sections
  (`## Completion Status Protocol`, `## Confusion Protocol`,
  `## GSTACK REVIEW REPORT`) have shared fragments (verbatim-identical across
  skills) and per-skill fragments (legitimate customization — rollup rules
  map unique phases per skill). The shared fragments are promoted to
  canonical text and copied verbatim into all 5 skills. Mark with
  `<!-- SHARED: <block-name> -->` HTML comments (invisible to agents reading
  prose) to signal shared-ness for future `SKILL.md.tmpl` extraction. Per-skill
  fragments stay free-form.
  - Shared fragments to lock verbatim: (1) the 4-bullet DONE/DONE_WITH_CONCERNS/
    BLOCKED/NEEDS_CONTEXT enum, (2) "It is always OK to stop..." paragraph
    under `### Escalation`, (3) the Escalation format code block, (4) equivalent
    shared fragments under `## Confusion Protocol` (inspect during implementation),
    (5) GSTACK REVIEW REPORT table header structure (already asserted).
  - Canonical source: read all 5 skills' variants of each shared fragment,
    pick the tightest, promote — don't rewrite from scratch. Earns "best of 5"
    without introducing untested new prose.
- **Test harness extension (locked 2026-04-24):** Add a `REQUIRED_VERBATIM_BLOCKS`
  assertion block to `scripts/test-skill-protocols.sh`. Each block is the
  canonical shared-fragment text, inlined as a bash heredoc in the test script.
  Harness asserts every skill contains the exact fragment byte-for-byte. Updates
  to shared fragments become a deliberate two-step (edit fixture → run tests
  fail → propagate to all 5) instead of silent drift.
- **Execution order:**
  - Lane A (serial, first): inspect 5 skills, extract canonical shared fragments,
    add `REQUIRED_VERBATIM_BLOCKS` assertions to `scripts/test-skill-protocols.sh`.
  - Lanes B-F (parallel, after A): trim one skill each. If running serial,
    start with `review-apparatus.md` (smallest, 478 lines) to calibrate the
    discipline before tackling `roadmap.md` (largest, 1253 lines).
- **Regression surface explicitly accepted:** Prose edits to live skills can
  silently change agent behavior in ways the test harness won't catch. Mitigation
  is strict scope discipline (above), not post-hoc behavioral testing —
  evaluated at /plan-eng-review and accepted as the right trade.
- **Depends on:** stable skill surface (no planned grafts in flight) — met
  as of v0.15.1.
- **Effort:** L (human: ~1 day / CC: ~1 hour) — mostly reading + careful
  trimming; risk is regressions in protocol assertions, which the test suite
  catches.

### Codex host support in `setup`
gstack core's `setup` script supports `--host codex` to install skills where the
Codex CLI can discover them. gstack-extend's `setup` currently targets only
Claude Code's `~/.claude/skills/` tree, so Codex users can't consume
`/pair-review`, `/roadmap`, `/full-review`, `/review-apparatus`, or `/test-plan`.
Add a `--host claude|codex|auto` flag (and matching uninstall path) that
mirrors gstack's layout, then regression-test via `scripts/test-update.sh`
parameterized by host.
- **Why:** parity with gstack for Codex users. Extend's skills are supposed to
  compose with the same agents gstack already supports; Codex-only users
  currently see a cliff where core works but extend doesn't. Not chasing full
  host-matrix parity (Kiro/Factory/OpenCode) — Codex only.
- **Depends on:** nothing hard — can be worked at any time. But running the
  Skill-file simplification pass above first is recommended: it tends to trim
  descriptions naturally, and whatever gates still need explicit action will
  be measurable rather than speculative.
- **Scope:**
  - `--host claude|codex|auto` flag parsing (`auto` = install into every
    detected host via `command -v claude` / `command -v codex`).
  - Codex install layout: `~/.codex/skills/{skill-name}/SKILL.md` (flat names,
    not `gstack-` prefixed — extend's skills aren't gstack's). Symlink target
    is `$REPO/skills/{skill-name}.md`, same as Claude.
  - Uninstall path updated to handle both `~/.claude/skills/` and
    `~/.codex/skills/` trees.
  - `scripts/test-update.sh` parameterized by host: happy-path install +
    uninstall + re-install + flag-rejection for each.
- **Codex-specific gates to evaluate post-simplification:**
  1. **Frontmatter `description:` ≤ 1024 chars (Codex `descriptionLimit` hard
     error).** Measurements taken 2026-04-24 pre-simplification: pair-review
     1010 (barely under), roadmap 1295, full-review 1030, review-apparatus
     1183, test-plan 1342 — 4 of 5 fail today. Re-measure after simplification
     lands. If any still > 1024, trim descriptions as a small follow-up.
     Either way, add a description-length assertion to
     `scripts/test-skill-protocols.sh` (or `test-update.sh` — whichever owns
     the Codex install gate) so future grafts can't regress.
  2. **Preamble path resolution — RESOLVED by Group 1 Pre-flight 2 (probe
     pattern + rc-file fallback).** Previous TODO proposed env-var injection
     via install-time sed. Rejected after /plan-eng-review + codex outside
     voice (2026-04-24): generated-copy deploy is a maintenance trap (loses
     symlink live-edit, weak sentinel ownership). Probe pattern matches
     gstack core exactly (`~/.claude/skills/{name}/SKILL.md || .claude/skills/{name}/SKILL.md`)
     and keeps symlinks. Truly-custom `--skills-dir` paths rely on
     `$GSTACK_EXTEND_ROOT` env var + `$HOME/.gstack-extend-rc` fallback
     written by setup.
     **Codex-side work remaining:** Codex's install layout
     (`~/.codex/skills/{name}/SKILL.md`) adds a third probe fallthrough
     in the preambles. One extra `||` clause per preamble, ~5 lines × 5 skills.
  3. **Cross-skill references in `skills/test-plan.md:232` (`gstack-slug`
     under `~/.claude/skills/gstack/bin/`) and `skills/test-plan.md:632`
     (Reads `~/.claude/skills/pair-review/SKILL.md`)** — line 632 fixed by
     Group 1 Pre-flight 2 (points at `$_EXTEND_ROOT/skills/pair-review.md`,
     the source, bypassing the deployed path). Line 232 depends on upstream
     gstack's own install layout — if Codex-side gstack install is at
     `~/.codex/skills/gstack/bin/gstack-slug`, this line needs the same
     probe fallthrough treatment.
- **Effort:** S-M (human: ~3-5 hours / CC: ~30-45 min) depending on how much
  description trimming is needed post-simplification. Mechanical core (flag
  handling + path table + test parameterization) is ~30 min CC.
- **Context:** Evaluated via /plan-ceo-review on 2026-04-24 (branch
  `kbitz/codex-host-todo`). Strategic framing: upstreaming the 5 skills into
  gstack core would have been the 10-star move (zero ongoing host-matrix tax),
  but upstream isn't accepting. Bash-only Codex-specific support is the
  right-sized choice given "Codex only" scope + extend's bash ethos.

### `/full-review` pass on `scripts/`
The test harnesses under `scripts/` (test-roadmap-audit, test-update,
test-skill-protocols, test-test-plan*, test-test-plan-extractor,
test-test-plan-e2e) have grown to hundreds of assertions each, mostly by
accretion during skill development. Run `/full-review` scoped to `scripts/`
only — reviewer/hygiene/consistency-auditor agents against the bash suites —
to surface dead fixtures, DRY violations across the five test files, and
inconsistent assertion patterns (some use `grep -q`, some use counted matches,
some use fixture-diffing).
- **Why:** the test suites are the safety net for every other simplification
  we're planning (skill file trim, codex host support). If the net has holes
  or drift, downstream refactors land blind.
- **Depends on:** nothing — `/full-review` already supports path-scoped runs.
- **Effort:** S to kick off (~10 min); M to action findings (human: ~half day /
  CC: ~30 min) depending on cluster count.

