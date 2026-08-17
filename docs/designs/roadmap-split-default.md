<!-- /autoplan restore point: /Users/kb/.gstack/projects/kbitz-gstack-extend/kbitz-hangzhou-v2-autoplan-restore-20260817-154958.md -->
# Roadmap split-default — Future file + shipped-default + preamble diet

**Status:** draft, under /autoplan
**Branch:** `kbitz/hangzhou-v2`
**Date:** 2026-08-17
**Track shape:** 1 PR / 1 session. Markdown + audit TS + init templates + fixtures.

Bolt already split `docs/roadmap-shipped.md` (~71 KB). The live ROADMAP is still
311 KB. Current Plan is 168 KB. Future is 138 KB / 285 essay-bullets. Conductor
preview cannot open it. Regen that reads the whole file pays the same tax.

Locked with the owner 2026-08-17:

- Shipped split becomes the default. First `/roadmap` on a project that still
  has an inline `## Shipped` body migrates it.
- Future gets the same treatment: `docs/roadmap-future.md`.
- Future split + preamble diet is enough. No live-file size warn this Track.
- OBE cleanup is cheap drain, not a new scanner.
- No third "constraints" file. Standing constraints stay in the ROADMAP head.

## Problem

`ROADMAP.md` is the file Conductor previews and the file `/roadmap` / `/autoplan`
load. Two tails have grown into essays:

1. `## Shipped` — already optional-split. Bolt used it. Not enough.
2. `## Future` — still inline. Bolt's is 285 review-excerpt bullets.
3. Current Plan preamble — regen diaries (~160 lines on bolt before Group 92).

The skill already says Future is flat one-liners and cards are lean. The model
does not comply because nothing mechanical refuses the essays, and Step 1 still
says "read `## Future`."

## Non-goals

- Live-file byte cap / warn on Current Plan size.
- Re-grep every Future premise every regen.
- A `docs/roadmap-constraints.md` file.
- Running `/roadmap` against bolt from this workspace.
- Changing packer bin logic, Track grammar, or ID rules.

## Approach

Reuse the shipped-archive pattern. Do not invent a second parser.

```
ROADMAP.md                         docs/roadmap-future.md
─────────                          ──────────────────────
# Roadmap                          # Future
<≤20-line head: how-to-read        Flat bullets. One sentence + source.
 + standing constraints            Regenerated each run.
 + pointers>                       Declined records do not live here.

## In Progress
## Current Plan                    docs/roadmap-shipped.md
## Future                          ──────────────────────
Deferred: docs/roadmap-future.md   Frozen Groups/Tracks. Append-only.
(N items)
## Shipped
History: docs/roadmap-shipped.md
(+ in-progress Group sibling Tracks only)
```

### File names

`docs/roadmap-future.md` — matches `docs/roadmap-shipped.md`.
Not `ROADMAP-FUTURE.md`.

### Pointer grammar

Active ROADMAP:

```
## Future

Deferred: docs/roadmap-future.md (N items)

## Shipped

History: docs/roadmap-shipped.md
```

`N` is the bullet count from the Future file. Optional parenthetical.

Parser today treats any non-bullet inside `## Future` as `futureMalformed`,
so FUTURE fails. Whitelist:

- `Deferred: docs/roadmap-future.md` with optional `(N items)`
- italic/empty placeholder lines already used (`_(none)_`, blank)

`History: docs/roadmap-shipped.md` already sits in `## Shipped` and is ignored
by the Group parser. Keep that line as-is.

### Gather (skill Step 1)

- Read ROADMAP **active sections only**: `## In Progress`, `## Current Plan`.
  Do **not** read Future essay bodies. Do **not** read Shipped essays.
- If `docs/roadmap-future.md` exists, load an **index**: title + source tag +
  first sentence. Full body only when promoting, or when the source Track
  shipped since `LAST_ROADMAP_RUN`.
- If `docs/roadmap-shipped.md` exists, load **ID+title index** (already the
  rule). Same after we make the split default.

### Apply (skill Step 3)

- Write `## Future` as the pointer + count.
- Write `docs/roadmap-future.md` as the regenerated flat list.
- Write `## Shipped` as the pointer + any in-progress sibling Tracks.
- Append newly-fully-shipped Groups to `docs/roadmap-shipped.md`.

### First-run migration

No extra AskUserQuestion. Part of apply.

**Shipped.** If `## Shipped` contains Group/Phase/Track headings (not just
the pointer + sibling Tracks), move that body to `docs/roadmap-shipped.md`
(create or append, newest first). Leave the pointer. Keep in-progress
Groups' shipped sibling Tracks inline.

**Future.** If `## Future` contains bullets and `docs/roadmap-future.md` is
missing, move the bullets verbatim to the new file. Do not rewrite 285
essays during the migration hop. Diet happens on the next regen of those
items.

Greenfield / `gstack-extend init`: templates start split. Empty future file.
Empty shipped file. Pointers in ROADMAP.

### Audit

`findDoc(repoRoot, 'roadmap-future.md')` next to the existing shipped lookup
in `cli.ts`, `pack-cli.ts`, `touches-cli.ts`.

`mergeFutureArchive(active, archive)`:

- Future bullets live in the archive file when present.
- Pointer-only active + archive bullets → archive wins (the happy path).
- Inline bullets + no file → keep inline (pre-migration). Audit **warn**
  `FUTURE_SPLIT_NEEDED`, do not fail. `/roadmap` migrates.
- Inline bullets + file both non-empty → FUTURE **fail**
  `SPLIT_INCOMPLETE`. Migration did not finish.
- Empty Future + no file → pass (greenfield before init templates land,
  and tiny projects with nothing deferred).

Same warn for inline shipped Groups when the archive is missing:
`SHIPPED_SPLIT_NEEDED`. Do not fail existing projects on the first audit
after upgrade. `/roadmap` migrates.

`runCheckFuture` reads merged bullets. Pointer lines are not malformed.

Length: FUTURE **warn** (not fail) if any bullet is longer than 400
characters. Migration copies verbatim, so the first post-split audit on
bolt will warn. Regen is what shortens them.

`SHARED_DOC_PATHS` in `src/audit/lib/pack.ts` gains
`docs/roadmap-future.md`. Not a collision.

TAXONOMY / DOC_LOCATION: these files are optional satellites of ROADMAP.
Do not require them. Do not flag them as misplaced if they live in `docs/`.

STATE_SECTIONS: all four H2s still required in order. Pointer-only Future
and Shipped still count as present.

VOCAB_LINT: `## Future` whitelist still applies to the H2 in ROADMAP. The
split file is all Future; vocab scan of that file is out of scope this
Track (optional follow-up).

### Skill prose — preamble diet

Skill prose stays qualitative (prior learning: no count-based rules in
skill text). The head is: one short how-to-read paragraph, standing
constraints that can refuse a Track, and pointers. If you need a
generation essay, you are writing the proposal, not ROADMAP.

Ban generation diaries in ROADMAP: drain counts, authored-false rates,
numbering-policy novels, restated Execution Maps, CLI-merge archaeology.
Those belong in `proposal-{ts}.md` and the commit message.

Standing constraints are **not** regenerated. Treat them like Shipped:
leave them unless the user edits them.

### Skill prose — Future drain (cheap OBE)

No new scanner. Same four dispositions.

- Re-emit Future as **one sentence + source**. Paragraphs go to a design
  doc or become Current Plan.
- **Declined / do-not-re-propose** records leave Future. Move them to
  `docs/roadmap-shipped.md` under a `## Declined` heading, or to the
  proposal's killed list. They are decisions, not backlog.
- Deep-check only items whose source Track shipped since
  `LAST_ROADMAP_RUN`, or whose title collides with the inbox.
- Discharge when the premise file/symbol is gone. Kill duplicates of
  live cards.
- Source Track shipped ≠ OBE. Leftovers filed *after* a Track are still
  open unless the premise is gone.

### Init + dogfood

- `scripts/init-templates/ROADMAP.md.tmpl` — pointer Future + pointer Shipped.
- New `scripts/init-templates/roadmap-future.md.tmpl` and
  `roadmap-shipped.md.tmpl` (short headers, empty lists).
- `CANONICAL_FILES` in `bin/gstack-extend` adds the two satellites.
- Init tests assert the files exist and ROADMAP still has the four H2s.
- This repo: migrate `docs/ROADMAP.md` shipped tail and Future bullets
  so gstack-extend itself is on the default layout.

### Tests

New fixtures (snapshot + unit):

- `future-split-ok` — pointer in ROADMAP, bullets in `roadmap-future.md`,
  FUTURE pass, count from the file.
- `future-split-incomplete` — bullets in both places, FUTURE fail.
- `future-split-needed` — inline bullets, no file, FUTURE warn (status
  stays pass or warn; do not fail).
- `shipped-split-needed` — inline Groups, no archive, warn.
- Existing `packing-ok` already has `History: docs/roadmap-shipped.md`.
  Keep it. Add a sibling future pointer so the fixture matches default.
- Parser unit: pointer lines are not `futureMalformed`.
- `mergeFutureArchive` unit next to `mergeShippedArchive`.
- Init template tests for the two new files.
- `tests/helpers/touchfiles.ts` MANUAL map if any new non-TS fixture
  tree is only consumed by a test that would otherwise miss it.

`UPDATE_SNAPSHOTS=1` only for fixtures whose expected output changes
for a documented reason. `tests/audit-invariants.test.ts` still gates
section order.

## Implementation sequence

1. Parser + `mergeFutureArchive` + pointer whitelist + tests.
2. `cli.ts` / pack-cli / touches-cli / `SHARED_DOC_PATHS` wire-up.
3. FUTURE check: merged bullets, split-needed warn, incomplete fail,
   400-char warn.
4. Skill Step 1 / 3 / template / taxonomy table.
5. Init templates + `CANONICAL_FILES` + init tests.
6. Dogfood this repo's ROADMAP.
7. Snapshot fixtures. Run `bun run test`.

## Files

| File | Change |
|------|--------|
| `src/audit/parsers/roadmap.ts` | pointer whitelist; export `mergeFutureArchive` |
| `src/audit/cli.ts` | find + merge future archive |
| `src/audit/pack-cli.ts` | find future archive if packer ever needs bullets (IDs only today — add only if parse path already loads shipped) |
| `src/audit/touches-cli.ts` | same as pack-cli if it parses Future |
| `src/audit/lib/pack.ts` | `SHARED_DOC_PATHS` += `docs/roadmap-future.md` |
| `src/audit/checks/future.ts` | merged source; split states; length warn |
| `src/audit/checks/state-sections.ts` | no order change; maybe mention pointer-only is valid |
| `skills/roadmap.md` | default split, gather index, apply writes, diet, drain |
| `scripts/init-templates/*` | default split |
| `bin/gstack-extend` | `CANONICAL_FILES` |
| `docs/ROADMAP.md` | migrate |
| `docs/roadmap-shipped.md` | new, this repo |
| `docs/roadmap-future.md` | new, this repo |
| `README.md` | two-file line becomes three-file |
| `tests/**` | units + fixtures + init |

`pack-cli` / `touches-cli` today merge shipped for frozen IDs. Future has
no IDs. They do not need the Future file unless they parse `futureBullets`.
Skip those two if unused. Do not add dead reads.

## Error / rescue

| Case | What happens |
|------|----------------|
| Missing future file, inline bullets | warn `FUTURE_SPLIT_NEEDED`; audit otherwise pass; `/roadmap` migrates |
| Missing shipped file, inline Groups | warn `SHIPPED_SPLIT_NEEDED`; `/roadmap` migrates |
| Both inline + file have Future bullets | FUTURE fail `SPLIT_INCOMPLETE`; do not guess merge |
| Pointer present, file missing | FUTURE fail `FUTURE_FILE_MISSING` — pointer is a lie |
| Pointer present, file empty | pass, count 0 |
| Future file has headings / `_touches:` | existing FUTURE fail (malformed) |
| Init without writing satellites | init tests fail |
| Regen writes essays into Future file | 400-char warn; skill says one sentence |

## Alternatives considered

**A. Default split + Future file + diet + cheap OBE (this plan).**
Reuses `mergeShippedArchive`. Audit warns until `/roadmap` runs. Completeness
high for the stated pain.

**B. Skill-prose only.** Tell the model to split and diet. Audit still fails
pointer-only Future (`futureMalformed`). Next `/roadmap` on bolt would write
a ROADMAP the audit rejects. Rejected.

**C. A + live-file size fail/warn.** Owner cut this. Current Plan is still
168 KB after the Future split. Deferred.

## NOT in scope

- Live ROADMAP size cap.
- Full OBE archaeology of bolt's 285 bullets from this repo.
- Vocab-lint of `roadmap-future.md`.
- Automatic PR detection for In Progress IDs.
- Card-leanness mechanical fail on Current Plan task length.

## Hour-by-hour (implementer)

- Hour 1: parser whitelist + `mergeFutureArchive` + units.
- Hour 2–3: FUTURE check states + fixtures + cli merge.
- Hour 4: skill prose (gather/apply/diet/drain) + README.
- Hour 5: init templates + this-repo migration.
- Hour 6: snapshots + `bun run test`.

---

## CEO Step 0 (autoplan Phase 1, SELECTIVE EXPANSION)

**UI scope:** no. **DX scope:** yes (skill + audit + init — developers and
agents are the users).

### 0A. Premises (gate — not auto-decided)

1. The problem is file size / context, not missing structure. Bolt is
   already v2 + packer + shipped-split and still unpreviewable.
2. A Future split that Step 1 still fully reads is theater. Gather must
   load an index.
3. First `/roadmap` migrates. Audit warns on old inline tails; it does
   not fail every existing project the day they upgrade gstack-extend.
4. Qualitative skill rules without an audit backstop get ignored. Bolt's
   Future is already supposed to be one-liners.
5. Declined records are decisions, not backlog.
6. Standing constraints belong in the ROADMAP head, frozen, short. A
   fourth file is not worth it.

### 0B. What already exists

| Sub-problem | Existing code |
|-------------|---------------|
| Shipped archive merge | `mergeShippedArchive` in `parsers/roadmap.ts` |
| Optional shipped file | `findDoc(..., 'roadmap-shipped.md')` in cli/pack/touches |
| Pointer line | `History: docs/roadmap-shipped.md` (packing-ok fixture) |
| Future format check | `runCheckFuture` — bullets only, currently treats pointers as malformed |
| Shared-doc exclusion | `SHARED_DOC_PATHS` in `lib/pack.ts` |
| Init scaffold | `scripts/init-templates/ROADMAP.md.tmpl`, `CANONICAL_FILES` |
| Drain dispositions | skill Step 2 (place/defer/kill/discharge) as of v0.24.4.0 |
| Gather "don't read Shipped essays" | already in skill Step 1b |

Do not rebuild the archive merge. Copy it for Future.

### 0C. Dream state

```
CURRENT                         THIS PLAN                      12-MONTH
ROADMAP is the dump             ROADMAP is the live            ROADMAP is a
of plan + future essays         plan. Tails are files.         launch board
+ shipped history +             Regen does not load            an agent can
regen diaries. Conductor        essays. First run              hold. Cards
preview dies. Regen             migrates.                      stay lean
rereads 300KB.                                                 because the
                                                               skill refuses
                                                               diaries.
```

### 0C-bis. Approaches (auto-decided → A)

**A. Default split + Future file + diet + cheap OBE.** Completeness 9/10.
Reuses shipped merge. Audit warn-then-migrate. Skill gather changes.

**B. Skill-prose only.** Completeness 3/10. Audit fails pointer-only
Future today. Next bolt regen would be red.

**C. A + live-file size warn.** Completeness 10/10 for preview. Owner
cut it. Current Plan is still 168 KB after Future moves.

**Recommendation: A.** Owner locked it. B is broken. C is next lake.

### 0E. Temporal

- Hour 1: pointer regex must accept `(N items)` and reject random prose
  so "see the design doc" does not sneak through as a pointer.
- Hour 2: `FUTURE` status for split-needed must be `warn`, not `fail`.
  Snapshot fixtures that today `pass` with inline Future stay pass plus
  a warn line — invariants test will see MODE last and STATUS present.
- Hour 4: skill Step 1 currently says read Future. That line has to go
  or the split does nothing for the LLM.
- Hour 5: this repo's shipped tail is small (~14 Groups). Migrate it
  anyway so dogfood matches default.
- Hour 6: `UPDATE_SNAPSHOTS=1` only on fixtures whose STATUS/FINDINGS
  change for a documented reason. Do not rubber-stamp.

### Mode

SELECTIVE EXPANSION (autoplan override). Baseline is this plan. No
expansions added until cherry-pick after premises.

<!-- AUTONOMOUS DECISION LOG -->
## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|----------|
| 1 | 0 | Mode = SELECTIVE EXPANSION | Mechanical | autoplan override | Feature iteration on existing /roadmap | EXPANSION, HOLD, REDUCTION |
| 2 | 0C-bis | Approach A | Mechanical | P5 + owner lock | Reuse shipped merge; B breaks audit; C cut by owner | B skill-only, C size-cap |
| 3 | 0 | Skip office-hours offer | Mechanical | autoplan skip list | BENEFITS_FROM is skipped under /autoplan | Running /office-hours |
| 4 | 0 | UI scope = no, DX scope = yes | Mechanical | P6 | Skill/audit/init; no screens | Design review |
| 5 | skill | Soften "20-line" cap in skill prose | Mechanical | prior learning | `qualitative-judgment-not-numeric-thresholds` | Hard 20-line skill rule |

