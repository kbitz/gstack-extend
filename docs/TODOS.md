# TODOS

## Unprocessed

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

### Codex host support in `setup`
gstack core's `setup` script supports `--host codex` to install skills where the
Codex CLI can discover them. gstack-extend's `setup` currently targets only
Claude Code's `~/.claude/skills/` tree, so Codex users can't consume
`/pair-review`, `/roadmap`, `/full-review`, `/review-apparatus`, or `/test-plan`.
Add a `--host codex` flag (and matching uninstall path) that mirrors gstack's
layout, then regression-test via `scripts/test-update.sh` with both hosts.
- **Why:** parity with gstack. Extend's skills are supposed to compose with the
  same agents gstack already supports; Codex-only users currently see a cliff
  where core works but extend doesn't.
- **Depends on:** nothing — current install logic is small enough to fork.
  Confirm gstack's codex path layout before coding so the two stay in sync.
- **Effort:** M (human: ~half day / CC: ~45 min) — setup script changes, new
  test fixtures in `scripts/test-update.sh`, README install matrix update.

### Skill-file simplification pass (v0.10–v0.15 accrual)
Five releases (v0.10.0 → v0.15.0) added cross-cutting protocol grafts
(Completion Status, Confusion Protocol, GSTACK REVIEW REPORT table, Group-level
deps, test-plan composition) into the skill files. The grafts were appended
rather than woven in, so skills have grown noticeably. Do a deliberate
simplification pass across `skills/pair-review.md`, `skills/roadmap.md`,
`skills/full-review.md`, `skills/review-apparatus.md`, `skills/test-plan.md` —
collapse duplicated guidance, consolidate repeated JSON schemas / output
contracts, and identify any section that's gone stale since its graft. Must
not drop functionality — gate on `scripts/test-skill-protocols.sh` passing
unchanged (currently 5-skill coverage).
- **Why:** skill files are the user-facing instruction surface; bloat degrades
  routing accuracy and makes each new graft harder. Also the natural precursor
  to the deferred `SKILL.md.tmpl` work above — can't promote shared patterns
  into a template until we see which patterns actually rhyme across skills.
- **Depends on:** stable skill surface (no planned grafts in flight).
- **Effort:** L (human: ~1 day / CC: ~1 hour) — mostly reading + careful
  trimming; risk is regressions in protocol assertions, which the test suite
  catches.

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

