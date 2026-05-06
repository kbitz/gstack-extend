# Roadmap Phases

Status: design (2026-04-29). Author: kb.

## Why

The roadmap currently has two structural levels (Group, Track) but real work
sometimes spans more. Groups 1–4 of the current ROADMAP.md are sequential
Groups that together deliver one feature ("retire bash; bun is the test
runner"). Each individual Group is shippable in isolation, but no single
Group ships the feature.

Two concrete pains fall out of this:

1. **Reviewers (human and LLM) over-index on dead-code between PRs across
   Groups.** Group 1 lands `tests/helpers/run-bin.ts` with one caller; the
   second caller arrives in Group 3. Today `/plan-eng-review`, `/review`,
   and `/codex challenge` all flag this as "why are we adding this if
   nothing uses it" because they can't see Group 3 from the Group 1 PR.
   The roadmap *knows* the scaffolding is intentional; the review tools
   don't.
2. **Versioning has no semantic hook for "feature complete."** `/ship`
   bumps PATCH per PR and the human decides when something is a MINOR.
   When a multi-Group feature lands, the MINOR bump is a vibes call. A
   formal Phase boundary gives `/roadmap` and `/ship` a default
   recommendation ("phase-closing → MINOR") that the human confirms or
   overrides — better than vibes, not blindly mechanical.

The original `bun-test-architecture.md` design called these "Phase 1–4"
explicitly. The roadmap restructure flattened them into Groups and lost
the higher-level grouping. This design restores it.

## What

A **Phase** is an optional outer envelope around 2+ sequential Groups
that together deliver one named end-state.

**Required for a Phase:**

- 2+ Groups, sequential dependency chain.
- A named end-state deliverable that no single Group ships
  (e.g. "all bash test scripts deleted; bun is sole runner").
- Listed scaffolding contract: which forward-references each Group is
  allowed to introduce that won't have callers until a later Group in
  the same Phase.

**A Phase is NOT required when:**

- A single Group fully delivers a feature.
- Two Groups are sequential but each is independently meaningful (e.g.
  Group 5 "install pipeline" → Group 6 "distribution infra" — sequential
  due to file collision, not toward a shared end-state).

The bar for declaring a Phase: *can you write the end-state in one
sentence that no individual Group would satisfy?* If not, it's just
sequential Groups.

## Goal state

ROADMAP.md gains an optional `## Phase N: <Title>` H2 marker block
above the first Group in the phase. **All Groups stay at `## Group N`
(H2)**, whether in-Phase or standalone — existing audit checks that
grep `^## Group` are unaffected. Group bodies are unchanged from today.

```markdown
## Phase 1: Bun Test Migration

**End-state:** all `scripts/test-*.sh` deleted; `bun test` is the sole
test entry point; `bin/roadmap-audit` is a compiled bun binary.

**Groups:** 1, 2, 3, 4 (sequential).

**Scaffolding contract:**
- Group 1 lands `tests/helpers/run-bin.ts` (consumed in full from Group 3).
- Group 2 lands `src/audit/lib/*.ts` modules; some helpers (e.g.
  `parseEffort`) are unit-tested but not yet wired into checks until
  Group 3.

---

## Group 1: Bun Test Toolchain

[existing Group 1 body, unchanged]

### Track 1A: ...
```

Affiliation is single-sourced: the Phase H2 block's `Groups: ...` line
is the only source of truth. The audit reads the Phase block,
enumerates its declared Groups, and renders Phase membership from there.
Groups themselves carry no Phase marker — Phase metadata lives only in
the Phase block.

## Versioning rules

LLM-judged scale, not hard-coded.

| Event | Bump | Notes |
|---|---|---|
| Phase exit | recommends MINOR | `/roadmap` freshness scan surfaces a confirmation prompt; human confirms or overrides. The default is MINOR because closing a named multi-Group end-state usually warrants it, but a phase that ends in cleanup/migration can be PATCH. |
| Group inside Phase ships | recommends PATCH | `/roadmap` hint says "mid-Phase, default PATCH"; human can pick MINOR if this Group ships independent user-visible value (Codex-flagged: Groups remain independently shippable, so the rule is a recommendation, not a mandate). |
| Standalone Group ships | LLM-judged | Existing `/ship` Step 12 logic — diff scale + feature signals → PATCH or MINOR. No new rule. |
| Hotfix or polish | PATCH or MICRO | LLM judges scale: trivial → MICRO; meaningful → PATCH. |
| 1.0 / breaking API | MAJOR | Always manual. |

No bump rule is fully mechanical. Phase metadata gives the *default*
recommendation; the human confirms at `/ship` time. This preserves
"version bump follows user value, not roadmap taxonomy" while still
making phase boundaries the obvious place to bump MINOR.

`/ship`'s auto-decide already prompts the human when MINOR is on the
table (Step 12 of `gstack/ship/SKILL.md.tmpl` — feature signals or
500+ lines triggers a question). `/roadmap`'s freshness scan tells the
human in advance: "current Group is the last in Phase 1; next ship is
phase-closing — pick MINOR." Mechanical bump decisions in `/ship`
itself are deferred (see Non-goals).

The 4-digit `MAJOR.MINOR.PATCH.MICRO` scheme stays. MICRO remains for
the smallest fixes; the MICRO-vs-PATCH decision is LLM-judged at ship
time on actual diff scale, not pre-decided by classification.

## Audit changes (`bin/roadmap-audit`)

### Vocab-lint: lift the "phase" ban, replace with structured allowance

Today `bin/roadmap-audit` bans the word "phase" everywhere except the
`## Future` section and the file-title line, via a TOPLEVEL/GROUP/FUTURE
state machine (`bin/roadmap-audit:179`).

One change: **add a fourth state: `PHASE`.** Entered by `^## Phase \d+:`
headings. Inside PHASE state, "phase" is allowed in the heading and the
Phase block. Exited by the next `^## ` heading.

The original ban elsewhere stays — Phase still has to be a deliberate,
structural declaration, not a synonym for "stage" sprinkled through
prose. The Pre-1.0 banned-elsewhere check is the *whole point* —
without it, "phase" creeps back in as project-management noise.

### New section: PHASES

A new `## PHASES` audit section emits one row per declared Phase:

```
## PHASES
STATUS: pass
PHASES:
- phase=1 title="Bun Test Migration" groups=[1,2,3,4] state=in_flight
  current_group=2 scaffolding_decls=2
```

Phase `state` is derived from Group statuses in ROADMAP.md:
- `in_flight` — at least one Group in the Phase is not yet Complete.
- `complete` — every Group in the Phase is marked Complete.

No other states. If we ever need a "paused / abandoned mid-Phase"
concept, it's a future addition with its own design.

When no Phases are declared (the common case for most projects), the
section still emits with `STATUS: skip` and `PHASES: - (none declared)`
to keep section order canonical and let the post-port
`audit-invariants.test.ts` continue to assert "every section has a
STATUS line."

Used by:

- `/roadmap` to render Phase progress and surface bump-level hints
  (this repo, in scope).
- *(out of scope)* `/ship`, `/review`, `/plan-eng-review` could read
  PHASES directly. Those skills live in gstack proper. Until they
  opt in, the data path is: `bin/roadmap-audit` emits PHASES → `/roadmap`
  surfaces "next ship is phase-closing, recommend MINOR" in the freshness
  scan → human picks MINOR at `/ship`'s prompt → reviewers reading the
  PR see the Phase block in ROADMAP.md and apply scaffolding tolerance
  manually. This works because `/ship` already asks the human before
  bumping MINOR (Step 12 of `gstack/ship/SKILL.md.tmpl`), and `/review`
  / `/plan-eng-review` already read ROADMAP.md when the PR description
  points there.

### New check: PHASE_INVARIANTS

- A Phase declares ≥2 Groups in its `Groups: ...` line.
- Listed Group numbers exist as `## Group N` headings in the same file.
- Listed Group numbers are sequential by Execution Map (no gaps,
  no out-of-order entries).
- A Group number appears in at most one Phase's `Groups:` list
  (no Group can be claimed by two Phases).
- Scaffolding contract: each declared scaffolding entry names a file
  that exists in the current branch state (lightweight — just
  `test -f`, no callgraph).
- Malformed Phase block (missing `End-state:` or `Groups:`) → emit
  one `warn` finding per missing field, do not crash the audit.

Not in scope: the audit doesn't enforce that scaffolding is *actually*
consumed by the named later Group. That's a review-time check, not an
audit-time one.

## Skill changes

Only `skills/roadmap.md` (this repo) is modified. `/ship`, `/review`,
`/plan-eng-review` are owned by gstack proper and left untouched —
see Non-goals.

### `skills/roadmap.md`

- Add Phase to the structural vocabulary alongside Group/Track.
- The init/restructure flow asks: "do these Groups deliver one feature
  no single Group ships?" — proposes a Phase if yes. Default: no Phase.
- Phase boundary detection in the freshness scan: if all Groups in a
  Phase are Complete, propose closing the Phase and tell the human:
  "next `/ship` is phase-closing; pick MINOR when prompted."
- Output a one-line phase-context hint at the top of every `/roadmap`
  run when the current branch is mid-Phase, so the human carries that
  context into PR descriptions and review.

### Reviewer-facing legibility (no skill changes)

The dead-code review pain is solved by the ROADMAP.md format itself:
the Phase block declares scaffolding contracts in plain markdown.
Anyone reviewing a Group's PR (human, `/review`, `/plan-eng-review`,
`/codex challenge`) reads ROADMAP.md to understand context — they
already do, when the PR description references a Group. The Phase
block makes scaffolding intentional and visible without modifying any
review tool.

## Test plan

Audit changes flow through `tests/roadmap-audit/` snapshot fixtures
(14 existing) and unit tests on the two new checks once the bun port
lands.

**New fixtures** (~8 dirs under `tests/roadmap-audit/`):
- `phase-happy/` — one well-formed Phase, four Groups.
- `phase-no-phases/` — roadmap without any Phase block; verifies
  `## PHASES STATUS: skip` row.
- `phase-malformed-missing-endstate/` — Phase block lacks
  `End-state:` line; expects `STATUS: warn`.
- `phase-malformed-missing-groups/` — same for `Groups:` line.
- `phase-listed-group-missing/` — Phase `Groups: 1, 2, 3` but no
  `## Group 3` heading exists; expects `STATUS: warn`.
- `phase-double-claimed-group/` — two Phases both list Group 3 in
  their `Groups:` lines; expects `STATUS: warn`.
- `phase-scaffolding-missing-file/` — contract names a file absent
  on the current branch.
- `vocab-phase-banned/` — regression: "phase" outside the PHASE
  state still triggers vocab-lint.

**Mass snapshot update** — all 14 existing `expected.txt` files gain
the new `## PHASES STATUS: skip` section via `UPDATE_SNAPSHOTS=1`. Diff
should be a constant ~5 lines per fixture (the new section block).

**Unit tests deferred until bun port.** State-machine logic
(`check_phases`, `check_phase_invariants`) ships covered by snapshot
fixtures only — no bash-level unit tests. Once the bun port lands
(Phase 1 of `bun-test-architecture.md`), `tests/audit-checks/phases.test.ts`
adds direct assertions on the state machine. Tracked as a TODO; see
"Migration" below.

**Skill-level test** — `tests/skill-protocols.test.ts` (post-port)
gains an assertion that `/roadmap` emits the phase-closing MINOR hint
when the audit's PHASES row reports `state=complete` for a Phase whose
final Group is Complete.

## Migration

1. Land the audit + skill changes behind a flag-free, additive path:
   ROADMAP.md without any `## Phase` headings audits and ships exactly
   as today. Phases are pure opt-in.
2. Update current ROADMAP.md to declare Phase 1 around Groups 1–4
   (Bun Test Migration). Groups 5–6 stay standalone (no shared
   end-state).
3. First Phase exit happens organically when Group 4 ships — that PR
   gets the recommend-MINOR hint at `/ship` time, human confirms.

No backfill of past Phases needed; existing Groups are all closed and
their version history is set. Groups 1–4 of the Bun Test Migration
haven't started yet (current branch is at v0.18.2; bun work starts
fresh) — no partially-completed-Group tagging issue.

**Follow-up TODO** (capture in `docs/TODOS.md`, source-tag `[design]`):
after the bun port (Phase 1 of `bun-test-architecture.md`) lands, add
`tests/audit-checks/phases.test.ts` with direct state-machine
assertions for `check_phases` and `check_phase_invariants`. Until
then, snapshot fixtures are the only coverage for these checks.

## Open questions

1. **Scaffolding contract enforcement.** Audit-time `test -f` only.
   Anything stricter (callgraph, "this scaffold is never consumed by
   the named Group") is a review-time judgment call — same call we're
   already asking reviewers to make, just now with phase context to
   inform it.

2. **Phase-of-Phases.** No. Hard cap at one Phase level. If something
   is genuinely "two Phases worth of work," it's two sequential Phases,
   each with its own end-state.

## Non-goals

- **Not modifying gstack-proper skills.** `/ship`, `/review`,
  `/plan-eng-review`, `/codex` stay untouched. Phase awareness reaches
  them through ROADMAP.md content (which they already read) and through
  human-in-the-loop bump decisions at `/ship` time, not through code
  changes in the gstack-proper repo. Cross-repo coupling is deferred
  until at least one Phase has shipped end-to-end and the value is
  proven.
- **Not changing Group/Track semantics.** Group is still a wave of PRs;
  Track is still a parallel-safe execution slot. Phase only adds an
  outer envelope.
- **Not auto-detecting Phases from Group dependency chains.** Some
  sequential Groups aren't a Phase (5 → 6). Detection is human/LLM
  judgment in `/roadmap`, not a programmatic rule.
- **Not changing the 4-digit version scheme.** MICRO stays. The only
  versioning change is a new *recommendation* surface — "phase-closing
  → suggest MINOR; mid-Phase → suggest PATCH" — that the human confirms
  at `/ship` time. No bump rule becomes purely mechanical. Standalone
  Group bumps remain LLM-judged via existing `/ship` Step 12.
- **Not retrofitting "phase" into other vocabulary.** "Phase" remains
  rare and structural. The vocab-lint stays strict — it's just the PHASE
  state that becomes a fourth allowed location.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES_RESOLVED | 4 architecture/CQ findings (A1, A2, PHASES-no-phases-row, versioning rule cleanup) — all applied |
| Outside Voice | codex via `/plan-eng-review` | Independent 2nd opinion | 1 | ISSUES_RESOLVED | 12 raised; 4 real cross-model tensions (T1–T4) decided; doc updated |

- **CROSS-MODEL:** 12 codex findings; 4 led to design changes (versioning softened to recommendations; affiliation single-sourced; parked state removed; bash unit tests deferred to TODO post-bun-port). 8 already addressed or restating known limits.
- **UNRESOLVED:** 0
- **VERDICT:** ENG CLEARED + OUTSIDE VOICE CLEARED — design ready to implement once a roadmap Track is opened for it.
