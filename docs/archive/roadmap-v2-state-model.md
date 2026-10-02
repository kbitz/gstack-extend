# Roadmap v2 — State-Section Model

Status: APPROVED (this session). Replaces the surgical-reassessment model with
a regenerate-the-plan model organized by lifecycle state.

**2026-10-01 — Track 22B supersession:** the lifecycle, recording, pin,
reservation and Hold rules below are reconciled with deterministic PACKING.
Verified completed Tracks archive independently; unfinished launch batches
repack. The current authority and complete pre-write/Apply recovery recipe is
`skills/roadmap.md` → Shipped-Track reconciliation. Other v2 design details
remain historical; this is a policy correction, not a scheduler/parser rewrite.

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
| In Progress      | `## In Progress`             | Phase / Group / Track |
| Current Plan     | `## Current Plan`            | Phase / Group / Track |
| Deferred Future  | `## Future`                  | Flat bullets only     |
| Shipped          | `## Shipped`                 | Phase / Group / Track |

State applies to **discrete units**:

- A **Track** ships only with verified merge, land-time identity and complete
  approved scope/acceptance (or attributable user reductions/deferrals).
  It leaves the active plan independently for `docs/roadmap-shipped.md`.
  Unfinished Tracks inherit their Group's active state.
- A **Group** is a computed launch batch. `in progress` means it contains
  user-identified active work: a named branch/session or open PR; `current
  plan` means remaining unstarted work. Shipped siblings alone do not pin it.
  Both active states pack all unfinished non-legacy, non-hotfix Tracks.
  A fully shipped Group can have history only when all its work is proved.
- A **Phase** groups launch batches for a named end-state; declared active
  work determines In Progress. Shipment alone does not freeze remaining bins.

An active Group/Phase appears in one active section. Individual history records
retain original Group lineage without claiming its unfinished siblings shipped.
Legacy inline `✓ Complete` / `✓ Shipped` markers and v1 fallback remain parseable;
new writing uses independent receipts and a repacked remainder.

## Document grammar

```
# Roadmap

(optional preamble paragraph)

---

## In Progress

(Groups containing user-declared active branches/sessions or open PRs;
declared pins preserve IDs only when their owning labels fit computed bins)

### Phase 3: <Title>

**End-state:** <one sentence>
**Groups:** 5, 6, 7

#### Group 5: <Title> _(in progress)_

##### Track 5B: <Title>
_<N tasks . ~LOC . risk . files>_
_touches: a, b, c_
- **<task>** -- description. _path, ~N lines._ (S/M/L/XL)

#### Group 6: <Title>

(unfinished Tracks listed normally; In Progress reflects declared active work,
not earlier shipment; idle work returns to Current Plan after repacking)

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

History: docs/roadmap-shipped.md
```

The current active document carries `Deferred: docs/roadmap-future.md (N items)`
under Future too; flat deferred bullets live in that satellite. Existing shipped
archive bytes are append-only. An individual archive section starts with an H2
context reset even after an archived Group (illustrative evidence only):

```markdown
## Individual Track history

### Track 22A: Record landed work ✓ Shipped (v1.2.3.0)
- 2026-10-01: merged PR #109 (commit abc1234); verified land-time Track 22A, original Group 22.
```

Use a verified historical version, or bare `✓ Shipped` plus dated evidence and
`release version unknown`. Do not duplicate receipts or imply original Group
completion. Once no pinned active Group uses the prefix, append a fresh H2
history section with `_tombstone: 22_` before any Track body. While Group 22 is
pinned, omit that tombstone and reserve prefix/full historical IDs during label
assignment. The parser's orphan `groupNum: 0` is not a real Group.

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
- **State:** In Progress for declared active work; Current Plan for remaining
  unstarted work. Shipped history requires verified end-state completion.

### Group

A computed launch batch; Tracks can ship independently. Within a Group, Tracks are **fully
parallel-safe** — no exceptions, no `_Depends on:_` between Tracks in the same
Group, no shared file footprint.

- **Heading:** `#### Group N: <Title>` (H4, nested under Phase H3 or directly
  under state H2 when no Phase wrapper).
- **Optional fields:** `_Depends on: Group M (Title)_` for inter-Group
  ordering. Default is "depends on the immediately preceding Group" (single
  linear chain) when no annotation.
- **Hard rule:** every pair of Tracks within a Group must have set-disjoint
  `_touches:_` footprints. The audit enforces this without escape hatch.
- **State:** In Progress for declared active work, Current Plan otherwise;
  verified completed Tracks leave independently and the remainder repacks.
- **Pre-flight is gone.** What used to be a `**Pre-flight**` subsection is
  just a small earlier Group with a single Track, which the next Group depends
  on.

### Track

Exactly one PR. No exceptions, no "ship as N PRs," no PR1/PR2 sub-blocks.

- **Heading:** `##### Track NX: <Title>` (H5, nested under Group H4).
  - Shipped Tracks use the independent H2/H3 archive receipt above; inline
    shipped suffixes are compatibility input, not the current convention.
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
- Shared landed-work inventory back to unresolved active Track introductions
  and dated label lineage; recent-run cutoff is only an activity hint

…then proposes a complete new `## In Progress` + `## Current Plan` + `## Future`
as a single document. The user reviews the whole proposal, approves or
revises, and the skill writes it.

The next regeneration is the required closure recorder before ID recycling.
An already-authorized shipping session may record earlier only by validating
the same complete receipt/remainder/dependency/label candidate before either
write; otherwise defer both. Explicit PR/plan identity and merged scope/acceptance
proof are required; historical snapshots corroborate. Missing or shallow history,
unknown introduction or inaccessible proof requires supplied evidence/refusal.
Keep merged-but-incomplete Tracks active with missing obligations named.
Index raw receipt IDs/lineage once, read only candidate bodies, and inspect raw
duplicate diagnostics (not propagated by archive merge). Same inactive work is
no-op; same still-active work after interruption is resume without append;
unrelated reuse or contradictory evidence is refusal. Preserve both pointers.

There is no item-by-item placement loop. There is no defer-or-keep ladder.
The proposal is whole-document — clusters 3 (placement batch) and 4
(deferral/kill batch) of the v1 skill cease to exist by construction.

## ID stability

- **Shipped Track and Group IDs are frozen forever.** They appear in
  CHANGELOG, PROGRESS, commit messages, downstream skills.
- **Declared active work is pinned.** Inventory Track ID, owning Group and
  user-named branch/session or PR in proposal Summary; report none declared or
  clarify uncertainty. No automatic discovery. Idle labels recycle in both states.

New idle Group labels start at the first free integer after shipped Group
numbers and individual shipped Track numeric prefixes, skipping tombstones
and pinned labels. A feasible single pinned owning label stays on its computed
bin; backfill fresh letters, skipping every historical full ID. Two pinned
labels in one bin or one pinned Group spanning bins is deferred reconciliation:
show IDs/bins/named pins, write neither active nor archive, retry after release
or an approved compatible arrangement. Pin preservation never waives PACKING.
After release append missing retirement reservations outside Track bodies.
Apply one simultaneous rename map, including canonical satisfied `_blocked-by`
aliases; retain written historical prerequisites while packing filters them out.

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
  Approve / Revise / Hold. Hold keeps the plan and permits only the presented
  complete closure candidate that preserves unfinished bins and dependency
  output and passes all blocking, identity/history and pin gates. Fully shipped
  or empty Group retirement can qualify; partial shipment needing repack cannot.
  In that case both files remain unchanged and full regeneration is required.
  Per-item placement and deferral clusters are gone.
- Validate complete drafts with the skill's read-only audit API recipe, retaining
  real Git/version/cap/scaffold context and every changed artifact's derived
  context. Packer-only proof or CLI exit zero is insufficient. Before Apply
  recheck approved file fingerprints, evidence HEAD and declared pins; changes
  require renewed proposal/approval. Satellite-first writes are not filesystem
  atomic: stop on failure, report completed/failed/unattempted edits, preserve
  current files, then revalidate before resume. Do not automatically restore.

Output Format template moves to the state-section grammar above.

## bin/* changes

- `bin/roadmap-audit` (wrapper): no change to CLI surface.
- `bin/roadmap-route` (source-tag classifier): no change.
- `bin/roadmap-revise` (split-track helper): **deleted**. Regeneration
  replaces the only use case.

## Migration

Migration happens organically on the first `/roadmap` run after this lands —
no special migration code path. The skill's normal regeneration step:

1. Reads the existing roadmap. Recognizes inline `✓ Complete` / `✓ Shipped`
   compatibility input, verifies identity/full scope and previews a visible count
   of independent receipt conversions with dated evidence and remaining bins.
   Hold/refusal preserves both originals unless the complete no-repack Hold
   candidate qualifies. Required reconciliation precedes idle ID recycling.
2. Regenerates `## In Progress` + `## Current Plan` + `## Future` in v2
   grammar from inboxes + git activity + leftover non-shipped Groups/Tracks.

The parser accepts both v1 and v2 grammar for the shipped region (so existing
`✓ Complete` headings parse correctly). The non-shipped region is fully
regenerated, so v1 vocabulary (Pre-flight, Hotfix subsections,
`_serialize: true_`, intra-Group `_Depends on:_`, Track-shaped Future
entries) simply doesn't survive the next run — there's nothing for the audit
to migrate after the regen lands.

Carry the Track 22B writing-policy change into later shipping release notes;
this specification adds no migration engine, legacy sunset or release-file edit.

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
