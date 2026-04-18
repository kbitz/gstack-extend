# TODOS

## Unprocessed

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

