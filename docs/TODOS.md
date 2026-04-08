# TODOS

## Unprocessed

### Layout scaffolding for new projects
A `/roadmap --init` or first-run mode that creates the correct directory structure
(`docs/`, `docs/designs/`, `docs/archive/`) and moves misplaced docs to their
canonical locations automatically.
- **Why:** The audit now flags misplaced docs but users must move them manually.
  Auto-scaffolding makes first-run onboarding smoother.
- **Effort:** S (human: ~1 day / CC: ~15 min)
- **Depends on:** Doc location opinions shipping (this PR)

### Doc type detection heuristics in audit script
Teach `bin/roadmap-audit` to classify .md files by content patterns: has
requirements/acceptance criteria -> spec, has timeline/phases -> plan, has TODO
markers -> inbox, has architecture diagrams -> design doc. Report mismatches
(e.g., file named plan.md but content looks like a spec).
- **Why:** Currently Step 1.5e relies on LLM judgment for doc type classification.
  Bash heuristics would make the audit output more actionable and reduce LLM load.
  Makes reclassification offers smarter and more consistent.
- **Effort:** M (human: ~2 days / CC: ~20 min)
- **Priority:** P2
- **Depends on:** Doc discovery shipping (v0.9.0)
