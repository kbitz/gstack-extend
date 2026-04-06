# Roadmap — Pre-1.0 (v0.x)

Organized as **Groups > Tracks > Tasks**. Groups are sequential (complete one before
starting the next). Tracks within a group run in parallel. Each track is one plan +
implement session. Tracks are organized by file ownership to minimize merge conflicts
between parallel agents.

---

## Group 1: Install Pipeline

Make the install system flexible enough for per-project usage. Currently hardcoded
to `~/.claude/skills/`. This unblocks users who want project-scoped skill installs
without polluting their global config.

### Track 1A: Per-Project Install Support
_3 tasks . ~2 hours (human) / ~15 min (CC) . low risk . [setup, bin/update-run, skills/*.md preambles]_

End-to-end support for custom install directories. Partial support was removed in
v0.6.2 to avoid half-baked behavior — this delivers the full pipeline.

- **Setup custom dir flag** -- Add `--skills-dir <path>` flag to `setup` script. Replace hardcoded `SKILLS_DIR="${HOME}/.claude/skills"` with flag-based override, defaulting to the current global path. _[setup], ~20 lines._ (S)
- **Propagate dir to update-run** -- `bin/update-run` calls `setup` on line 58 without passing through any custom dir. Thread the custom dir from config or env so upgrades preserve per-project installs. _[bin/update-run, bin/config], ~15 lines._ (S)
- **Preamble symlink resolution** -- Skill preambles resolve `$_EXTEND_ROOT` via `readlink` on `SKILL.md`. Verify this works when symlinks originate from a non-default directory (e.g., `./project/.claude/skills/`). Fix if broken. _[skills/*.md preambles], ~10 lines._ (S)

---

## Group 2: Distribution Infrastructure

Improvements to how the repo is distributed and how /roadmap handles version
transitions. These are independent of Group 1 but have external blockers (repo
going public, phase completion). Tracks run in parallel.

### Track 2A: Raw GitHub Migration
_1 task . ~30 min (human) / ~5 min (CC) . low risk . [bin/update-check]_

Depends on: repo made public on GitHub.

- **Replace gist URL with raw.githubusercontent.com** -- Swap the gist URL on line 21 of `bin/update-check` with `raw.githubusercontent.com/kbitz/gstack-extend/main/VERSION`. Remove the GitHub Action that syncs VERSION to the gist and the `GIST_TOKEN` secret. _[bin/update-check, .github/workflows/], ~5 lines changed._ (S)

### Track 2B: Phase Transition Detection
_1 task . ~1 day (human) / ~20 min (CC) . medium risk . [bin/roadmap-audit, skills/roadmap.md]_

Depends on: at least one major version bump (0.x -> 1.x) to validate against.

- **Auto-detect major version boundary** -- When VERSION bumps to a new major (e.g., 0.x -> 1.x), /roadmap should detect the phase boundary and offer to promote items from the `## Future` section to the current phase. Add detection logic to `bin/roadmap-audit` and re-triage flow to `skills/roadmap.md`. _[bin/roadmap-audit, skills/roadmap.md], ~80 lines._ (M)

---

## Execution Map

```
Group 1: Install Pipeline
  +-- Track 1A ........... ~2 hours .. 3 tasks

                  |

Group 2: Distribution Infrastructure
  +-- Track 2A ........... ~30 min ... 1 task  (blocked: repo public)
  +-- Track 2B ........... ~1 day .... 1 task  (blocked: phase completion)
```

**Total: 2 groups . 3 tracks . 5 tasks**

---

## Future (Phase 1.x+)

Items triaged but deferred to a future phase. Not organized into Groups/Tracks.
Will be promoted to the current phase and structured when their time comes.

- **Multi-agent test orchestration** — Each test group assigned to a separate Conductor agent. session.yaml as coordination point, groups as independent files so agents don't conflict. Parallel testing for large suites (15-20 items). _Deferred because: depends on /pair-review v1 proven reliable and Conductor agent API maturity. L effort (~2 weeks human / ~2 hours CC)._

---

## Unprocessed

Items awaiting triage by /roadmap. Added by other skills or manually.

