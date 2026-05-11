# Roadmap v2 — State-Section Model

Status: APPROVED (this session). Replaces the surgical-reassessment model with
a regenerate-the-plan model organized by lifecycle state.

## Why

The v1 skill optimized for incremental reassessment of an upcoming plan (extend
this Track, add that Track, renumber upstream, preserve cross-refs, split-track
helper). In practice this produced four recurring failure modes:

1. **Defer-by-default → one-by-one fallback.** When inbox items didn't fit
   in-flight Groups, the skill recommended deferring all of them; the user
   typically rejected, and the skill fell back to asking placement per item
   instead of re-thinking the upcoming plan as a whole.
2. **Hotfix subsection misuse.** Inbox items source-tagged to a `✓ Complete`
   Group were mass-routed to that Group's `**Hotfix**` subsection, regardless
   of whether they were actual regressions or just deferred scope.
3. **Sizing failure.** Tracks routinely declared "Ship as N PRs" inline (Track
   10A: ~3000 LOC across 2 PRs), which the audit's 300-LOC cap was supposed to
   prevent. The escape valve normalized oversized Tracks; CEO review then
   "discovered" what the audit already knew.
4. **Illusory parallelization.** The audit's collision check skipped pairs
   joined by `_Depends on:_`. A Group with 5 Tracks where 4 of them shared
   sync-engine files and chained sequentially looked parallel-safe in metadata.

These all stem from the same root: the upcoming plan is treated as stable, so
mistakes accumulate via incremental edits rather than getting flushed by
re-thinking. The user has explicitly opted into "throw out the entire plan
every time we update it." This document defines the new model.

## Objectives

1. When the user sits down, the plan tells them what to work on next.
2. Anything parallelizable is organized to be parallelized.
3. Tracks are sized to be a single PR — always.
4. Inbox capture (TODOs.md) drains into the plan holistically, not item-by-item.
5. Only completed work is sacred; the rest of the plan is volatile.
6. Plan distinguishes "definitely doing this" from "not sure yet."

## Lifecycle states

The top-level structure of `ROADMAP.md` is organized by lifecycle state. There
are four states, listed here in document order — the active plan sits at the
top of ROADMAP.md, shipped history sinks to the tail so readers don't scroll
past completed work to see what's happening now and next:

| State            | Section heading              | Granularity          |
|------------------|------------------------------|----------------------|
| In Progress      | `## In Progress`             | Phase / Group         |
| Current Plan     | `## Current Plan`            | Phase / Group / Track |
| Deferred Future  | `## Future`                  | Flat bullets only     |
| Shipped          | `## Shipped`                 | Phase / Group / Track |

State applies to **discrete units**:

- A **Track** is `shipped` (in `## Shipped` at the document tail) or unshipped
  (in `## Current Plan`, inside its parent Group). Tracks have no separate
  "in progress" state — they are 1 PR; the window between branch-open and
  PR-merge is short, and ID stability over that window is handled as an
  implementation rule, not a state.
- A **Group** is `shipped` (all its Tracks have shipped), `in progress` (≥1
  shipped Track and ≥1 unshipped), or `current plan` (no shipped Tracks yet).
  Shipped Tracks within an in-progress Group stay co-located with their Group
  in `## In Progress` (with `✓` markers); they only relocate to `## Shipped`
  when the whole Group lands.
- A **Phase** mirrors Group rules: `shipped` (all Groups shipped), `in
  progress` (≥1 shipped Group and ≥1 unshipped), or `current plan`.

This means a Group/Phase appears in exactly one state-section at a time. There
is no fragmentation of a unit across sections. The shipped/unshipped boundary
within an in-progress Group is shown by inline `✓` markers on individual Tracks.

## Document grammar

```
# Roadmap

(optional preamble paragraph)

---

## In Progress

(at most one Phase or one Group active at a time; Tracks with PRs open get a
`(PR #NNN)` annotation but otherwise look like Current Plan Tracks)

### Phase 3: <Title>

**End-state:** <one sentence>
**Groups:** 5, 6, 7

#### Group 5: <Title> _(in progress)_

##### Track 5A: <Title> ✓ Shipped (v0.18.14.0)
##### Track 5B: <Title>
_<N tasks . ~LOC . risk . files>_
_touches: a, b, c_
- **<task>** -- description. _path, ~N lines._ (S/M/L/XL)

#### Group 6: <Title>

(unshipped Tracks listed normally; the Group is "in progress" because Group 5
has shipped Tracks but isn't fully done yet; or because work is actively
underway across multiple Groups in the Phase)

---

## Current Plan

(definitely doing this; full structure)

### Phase 4: <Title>

**End-state:** <one sentence>
**Groups:** 8, 9

#### Group 8: <Title>

##### Track 8A: <Title>
_<N tasks . ~LOC . risk . files>_
_touches: a, b, c_
- **<task>** -- description. _path, ~N lines._ (S/M/L/XL)

##### Track 8B: <Title>
...

#### Group 9: <Title>

##### Track 9A: <Title>
...

---

### Execution Map

Adjacency list:
```
- Group 5 ← {}
- Group 6 ← {5}
- Group 8 ← {6}
- Group 9 ← {8}
```

Track detail per group:
```
Group 5: <Title>          (in progress)
  +-- Track 5A ........... ✓ shipped
  +-- Track 5B ........... ~M . 3 tasks

Group 6: <Title>
  +-- Track 6A ........... ~S . 1 task
  +-- Track 6B ........... ~M . 2 tasks
```

**Total: <N> phases . <M> groups . <P> tracks remaining.**

---

## Future

Items we might do but aren't committed to. Plain bullets. No phase/group/track
structure, no `_touches:_`, no sizing, no IDs.

- **<Item title>** — description. _Source: <where it came from>._
- **<Item title>** — description.

---

## Shipped

(append-only history, IDs frozen, byte-stable across regenerations. Lives at
the document tail so the active plan above stays visible without scrolling.)

### Phase 1: <Title> ✓ Shipped (vX.Y.Z.W)
<one-line summary>

#### Group 1: <Title> ✓ Shipped (vX.Y.Z.W)
- Track 1A — _shipped (vX.Y.Z.W)_
- Track 1B — _shipped (vX.Y.Z.W)_

#### Group 2: <Title> ✓ Shipped (vX.Y.Z.W)
- Track 2A — _shipped (vX.Y.Z.W)_

### Phase 2: <Title> ✓ Shipped (vX.Y.Z.W)
...

(loose Groups not in a Phase are listed at the same H3 level under `## Shipped`
without a Phase wrapper)
```

## Primitives

Three structural primitives. State is the outer envelope; primitives sit
inside state sections.

### Phase (optional)

A named end-state spanning multiple Groups. Required when ≥2 sequential Groups
together deliver a deliverable no single Group ships. Otherwise omit — single
Groups stand alone.

- **Heading:** `### Phase N: <Title>` (in shipped/in-progress/current-plan
  state sections; H3 because the state section is H2).
- **Required fields:** `**End-state:**` (one sentence), `**Groups:**` (≥2 Group
  numbers).
- **Optional:** `**Scaffolding contract:**` block listing forward-references.
- **State:** shipped when all Groups shipped; in-progress when partial; current
  plan otherwise.

### Group

A wave of Tracks that ship together. Within a Group, Tracks are **fully
parallel-safe** — no exceptions, no `_Depends on:_` between Tracks in the same
Group, no shared file footprint.

- **Heading:** `#### Group N: <Title>` (H4, nested under Phase H3 or directly
  under state H2 when no Phase wrapper).
- **Optional fields:** `_Depends on: Group M (Title)_` for inter-Group
  ordering. Default is "depends on the immediately preceding Group" (single
  linear chain) when no annotation.
- **Hard rule:** every pair of Tracks within a Group must have set-disjoint
  `_touches:_` footprints. The audit enforces this without escape hatch.
- **State:** shipped when all Tracks shipped; in-progress when partial;
  current plan otherwise.
- **Pre-flight is gone.** What used to be a `**Pre-flight**` subsection is
  just a small earlier Group with a single Track, which the next Group depends
  on.

### Track

Exactly one PR. No exceptions, no "ship as N PRs," no PR1/PR2 sub-blocks.

- **Heading:** `##### Track NX: <Title>` (H5, nested under Group H4).
  - Suffix `✓ Shipped (vX.Y.Z.W)` to mark a shipped Track inline (used in
    `## In Progress` Groups for the shipped Tracks).
  - Suffix ` (PR #NNN)` to mark an open-PR Track inline.
- **Required metadata** (immediately after heading):
  - `_<N tasks> . ~<LOC> . <risk> . <files summary>_`
  - `_touches: file1, file2_` (set-disjoint with sibling Tracks in the same Group)
- **Body:** task bullets `- **<title>** -- description. _<files>, ~<lines>._
  (S/M/L/XL)`.
- **Sizing rule:** the audit computes total LOC from task effort tiers; if
  total exceeds `max_loc_per_track` (default 300), the Track fails SIZE.
  No exceptions.

### Hotfix

A hotfix is **not** a special primitive. It is a `## In Progress` (or `## Current
Plan`) Group with a single Track, sitting at the head of the queue (no
`_Depends on:_`, or depending only on `## Shipped` Groups). The Group title
typically starts with `Hotfix: ` for clarity, and the audit recognizes that
prefix to enforce single-Track shape.

- **Definition:** breaking regression on shipped behavior, requiring priority
  over current plan work.
- **Not a hotfix:** deferred scope from a shipped Group, polish on shipped
  surface area, new feature on shipped files. Those go in normal Current Plan
  Groups.
- **Audit rule:** a Group whose title matches `^Hotfix:` must have exactly one
  Track and zero Group-level `_Depends on:_` (or only Shipped-Group deps).

## Reassessment is regeneration

Every `/roadmap` run that does anything substantive treats the upcoming plan
(`## In Progress` + `## Current Plan` + `## Future`) as **volatile**. It does
not surgically extend Tracks or renumber upstream. It reads:

- `## Shipped` (frozen — never modified except to append a newly-shipped item)
- The current `## In Progress` and `## Current Plan` (used as input, not
  preserved)
- `## Future` (used as input)
- `TODOS.md` `## Unprocessed` inbox
- Recent git activity since last `/roadmap` commit

…then proposes a complete new `## In Progress` + `## Current Plan` + `## Future`
as a single document. The user reviews the whole proposal, approves or
revises, and the skill writes it.

There is no item-by-item placement loop. There is no defer-or-keep ladder.
The proposal is whole-document — clusters 3 (placement batch) and 4
(deferral/kill batch) of the v1 skill cease to exist by construction.

## ID stability

- **Shipped Track and Group IDs are frozen forever.** They appear in
  CHANGELOG, PROGRESS, commit messages, downstream skills.
- **Everything else is volatile.** In-progress and Current-Plan Tracks can be
  renumbered, re-grouped, or deleted on every regen. The Track-with-open-PR
  case is rare enough in practice that we don't add machinery to detect it; if
  the user has an open PR they want preserved, they can call it out during
  the regen review.

The next available numeric ID after a regeneration is `max(shipped_group_num,
in_progress_group_num) + 1`. Letters cycle A, B, C… within each Group.

## Audit changes from v1

Drops:

- Collision-skip-on-`_Depends on:_` (`src/audit/checks/collisions.ts:78-82`).
  Intra-Group `_Depends on:_` between Tracks is now a `STRUCTURE: fail`.
- `**Pre-flight**` subsection parsing and `_serialize: true_` escape hatch.
  Both vocabulary primitives are gone.
- `**Hotfix**` subsection parsing. Hotfixes are now Groups with a Hotfix:
  prefix and single Track.
- Split-track machinery (`bin/roadmap-revise`, `splitSuggestion` in
  size-caps.ts). Regeneration replaces the helper.
- `## Future` parallelizable-upgrade primitive (`### Track FX:` shape inside
  Future). Future is plain bullets only.

Adds:

- `STATE_SECTIONS` check: validates the four top-level sections appear in
  the correct order (`## In Progress`, `## Current Plan`, `## Future`,
  `## Shipped`). All four are optional individually but must appear in this
  order when present.
- SIZE check rule: any Track body containing literal `N PRs`, `two PRs`,
  `multiple PRs`, `PR1`, `PR2` is `STRUCTURE: fail` (regex
  `\b(PR1|PR2|[0-9]+ PRs|two PRs|multiple PRs)\b`).
- COLLISIONS check: no escape hatch — any non-empty intersection between two
  Tracks in the same Group fails.
- HOTFIX check (folded into STRUCTURE): a Group titled `^Hotfix:` must have
  exactly one Track and only Shipped-Group deps.
- FUTURE check: `## Future` body must contain only `^- ` bullets (no `###`,
  no `_touches:_`, no metadata italic lines).

Changes:

- The parser produces a new top-level `state` field per Group / Track:
  `'shipped' | 'in-progress' | 'current-plan'`. Most checks then filter to
  `state !== 'shipped'` (active work only) instead of the v1
  `!isComplete && !legacy` filter.
- `## Execution Map` adjacency list and ASCII tree are emitted by the audit
  inside `## Current Plan` (and `## In Progress` when multiple Groups active).
  Generation moves from skill prose into a new audit section that produces
  copy-paste-ready text the skill drops into the regenerated plan.

## Skill prose changes from v1

Steps 1-2 (Gather, Fast-path) stay structurally similar — read inputs, decide
whether to skip. Fast-path conditions get a fifth: "no inbox items
source-tagged to in-progress Group's footprint" (closure-debt scan).

Step 3 (Reassess) rewrites entirely:

- Drops the holistic-reading checklist's surgical bias ("extend this Track",
  "add Track NB", "mark Group N ✓").
- Replaces with: "Generate a complete `## In Progress` + `## Current Plan` +
  `## Future` from inputs. Holistically classify every active item +
  every inbox item into one of: hotfix Group, current plan Group, deferred
  Future, kill."
- Adversarial items (`severity=critical`, `[investigate]`) are surfaced
  individually for review but their structural placement is part of the same
  proposal.
- Hierarchical reassessment (Pass 1 structure, Pass 2 placement) collapses to
  a single pass — there's no per-item placement step to separate from
  structure.

Step 4 (Apply) drops:

- `bin/roadmap-revise split-track` invocation (helper deleted).
- All renumbering / cross-reference preservation logic for upcoming work
  (regeneration replaces it).
- Hotfix subsection format and append rules.
- Pre-flight format.

Step 4 adds:

- Whole-document regeneration: the proposal artifact (`<PROPOSAL_DIR>/
  proposal-{ts}.md`) becomes the entire `## In Progress` + `## Current
  Plan` + `## Future` block ready to swap in.
- Single AskUserQuestion cluster: "Approve regenerated plan?" with options
  Approve / Revise (specify what to change) / Hold (keep current plan, only
  apply trivial closures). Per-item placement and deferral clusters are gone.

Output Format template moves to the state-section grammar above.

## bin/* changes

- `bin/roadmap-audit` (wrapper): no change to CLI surface.
- `bin/roadmap-route` (source-tag classifier): no change.
- `bin/roadmap-revise` (split-track helper): **deleted**. Regeneration
  replaces the only use case.

## Migration

Migration happens organically on the first `/roadmap` run after this lands —
no special migration code path. The skill's normal regeneration step:

1. Reads the existing roadmap. Recognizes shipped work via the `✓ Complete`
   marker on Groups and Tracks (v1 grammar) — these populate the new
   `## Shipped` section with frozen IDs.
2. Regenerates `## In Progress` + `## Current Plan` + `## Future` in v2
   grammar from inboxes + git activity + leftover non-shipped Groups/Tracks.

The parser accepts both v1 and v2 grammar for the shipped region (so existing
`✓ Complete` headings parse correctly). The non-shipped region is fully
regenerated, so v1 vocabulary (Pre-flight, Hotfix subsections,
`_serialize: true_`, intra-Group `_Depends on:_`, Track-shaped Future
entries) simply doesn't survive the next run — there's nothing for the audit
to migrate after the regen lands.

The audit enforces v2 grammar; a v1-shaped roadmap audited before the user
has run `/roadmap` emits `MIGRATION_NEEDED: fail` pointing at this design
doc. Run `/roadmap` to regenerate into v2 grammar before any other audit
work proceeds.

## Test fixtures

`tests/roadmap-audit/<fixture>/` fixtures all need new `files/docs/ROADMAP.md`
content matching the v2 grammar. Fixtures cover (at minimum):

- All four state sections present (happy path).
- Empty Current Plan (just shipped + future).
- Empty Shipped (greenfield).
- Hotfix Group at head of Current Plan.
- Multiple Phases across states.
- v1 grammar input → MIGRATION_NEEDED finding.
- Intra-Group `_Depends on:_` between Tracks → STRUCTURE fail.
- Track body containing "Ship as 2 PRs" → STRUCTURE fail.
- Future containing `### Track FX:` shape → FUTURE fail.

Snapshot regeneration (`UPDATE_SNAPSHOTS=1 bun test
tests/audit-snapshots.test.ts`) and structural-invariants tests
(`tests/audit-invariants.test.ts`) both update to reflect the new section
order.

## Deferral protocol (CEO/eng review handoff)

When `/plan-ceo-review` or `/plan-eng-review` runs on a Track and the user
agrees to **defer** in-scope work (cut it from the Track to keep the PR
sized correctly, etc.), the deferred items must land somewhere the next
`/roadmap` run will pick up. The protocol:

- **Where they go.** `TODOS.md ## Unprocessed`, in canonical
  `### [tag] Title` heading-form per `docs/source-tag-contract.md`. Not a
  Group-level subsection — the v2 model regenerates the upcoming plan
  whole, and a Group-scoped inbox conflicts with that rule (the Group
  itself is volatile across regens).
- **Source tag grammar.** Existing review tags add a `defer=true` flag:
  - `[plan-ceo-review:track=<id>,defer=true]`
  - `[plan-eng-review:track=<id>,defer=true]`
  The `track=` field anchors the deferral to its origin so the regenerator
  has context. The `defer=true` flag distinguishes "in-scope work cut from
  this Track" from a normal review finding (which already routes via
  severity / standard-tag conventions). The grammar requires `key=value`
  (no bare flags), so `defer=true` is the canonical form; the source-tag
  validator rejects bare `defer`.
- **Where the rationale lives.** The CEO/eng plan doc (the artifact the
  review skill writes) records *why* the work was deferred. The TODOS.md
  entry is the actionable inbox item — it doesn't need to repeat the
  rationale, just the deferred task description.
- **What the regenerator does.** On the next `/roadmap` run, deferred
  inbox items are part of the holistic regeneration. They might land in
  a new Track (Current Plan), as Future bullets, or be killed. The
  regenerator decides; no special path for `defer` tags vs other inbox
  items.

The two review skills' prose needs a small update to follow this protocol
(write to TODOS.md with the `defer` flag, not into the Track itself).
Tracked separately from this design — search the codebase for the inbox
write step in each review skill's prose.

## Out of scope (future work)

- Velocity / actuals tracking (estimate vs actual LOC, time to ship).
- Auto-classifying inbox items into hotfix vs deferred-scope without LLM
  judgment.
- A `roadmap-state` JSON export contract for downstream skills.

These are all reasonable extensions but don't gate v2 shipping.
