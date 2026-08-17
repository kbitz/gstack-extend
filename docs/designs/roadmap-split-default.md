<!-- /autoplan restore point: /Users/kb/.gstack/projects/kbitz-gstack-extend/kbitz-hangzhou-v2-autoplan-restore-20260817-154958.md -->
# Roadmap split-default — Future file + shipped-default + preamble diet

**Status:** implemented (D2-A: Current Plan stays in ROADMAP)
**Branch:** `kbitz/hangzhou-v2`
**Date:** 2026-08-17
**Track shape:** 1 PR / 1 session. Markdown + audit TS + init templates + fixtures.

Bolt already split `docs/roadmap-shipped.md` (~71 KB). The live ROADMAP is still
311 KB. Current Plan is 168 KB. Future is 138 KB / 285 essay-bullets. Conductor
preview cannot open it. Regen that reads the whole file pays the same tax.

Locked with the owner 2026-08-17; amended after D1-A:

- Shipped split becomes the default. First `/roadmap` on a project that still
  has an inline `## Shipped` body migrates it.
- Future gets the same treatment: `docs/roadmap-future.md`.
- **ROADMAP always carries both pointers.** Empty files still get
  `Deferred: docs/roadmap-future.md (0 items)` and
  `History: docs/roadmap-shipped.md`. Apply never omits them.
- Future split + preamble diet is enough. No live-file size warn this Track.
- **Do not strip Future items to one line.** The live file is skinny because
  it holds a pointer. The Future file keeps the review context that was
  being lost (symptom, source, why deferred, load-bearing facts). Gather
  still loads an index so regen does not eat the archive.
- OBE cleanup is cheap drain, not a new scanner. Staying-deferred items
  keep their text; we do not rewrite them shorter.
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
<head: how-to-read                 Flat bullets. Keep the filed
 + standing constraints            review context (symptom, source,
 + both pointers, always>          why deferred, load-bearing facts).
                                   Declined records do not live here.

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

### Pointer grammar (mandatory)

Active ROADMAP always has both pointers, including greenfield and
after a regen that deferred zero items or shipped nothing new:

```
## Future

Deferred: docs/roadmap-future.md (N items)

## Shipped

History: docs/roadmap-shipped.md
```

`N` is the bullet count from the Future file. Required parenthetical,
including `(0 items)`.

Missing pointer after the project is on the default layout is a **fail**
(`FUTURE_POINTER_MISSING` / `SHIPPED_POINTER_MISSING`). Unmigrated
projects that still have an inline body and no file **warn**
`SPLIT_NEEDED` until the first `/roadmap` writes the pointers.

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

Future is **not** whole-block regenerated. That cannot keep unread
bodies. Apply is surgical:

- **Delete** bullets whose titles were killed, discharged, or promoted.
- **Append** newly deferred inbox items (full richness).
- **Leave** every other line in `docs/roadmap-future.md` untouched.
- Rewrite ROADMAP `## Future` as the pointer + audited count.

Shipped stays append-only:

- Write `## Shipped` as the pointer + any in-progress sibling Tracks.
- Append newly-fully-shipped Groups to `docs/roadmap-shipped.md`.

Write satellites first, then ROADMAP.

The skill table row "Future is fully volatile — regenerated each run"
changes: Future *membership* is re-derived (place / defer / kill /
discharge). Future *text* of staying-deferred items is preserved.

### Parser

Do not call `parseRoadmap` on a heading-less bullet list and expect
`futureBullets` to fill. That only happens inside a `## Future` region.

Satellite file shape:

```markdown
# Future

## Future

- **title** — body
```

`## Future` is required so the existing state machine populates
`futureBullets`. Missing H2 → FUTURE fail `FUTURE_FILE_MALFORMED`.

`mergeFutureArchive` is not a clone of `mergeShippedArchive`. It is:
if the archive has bullets and the active file is pointer-only, use
the archive bullets; if both have bullets, fail; if only active has
bullets, keep them and warn.

### Gather index (mechanical)

A tiny helper (bun one-liner over `parseRoadmap`, or
`roadmap-audit --future-index`) prints one line per bullet:
title, source tag, first sentence. Skill Step 1 runs that and Reads
the output. It does **not** Read `docs/roadmap-future.md` unless
promoting or the source Track shipped.

### Declined

Killed / declined items go in the proposal's killed list (already
required). They do **not** go into `docs/roadmap-shipped.md`. Shipped
is frozen delivered IDs.

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

No character-count lint. Structure still fails (headings, `_touches:`).
The 400-char warn from the draft is **cut** — owner: reviews were being
pared to one line and context was lost; the split is what keeps the live
file small.

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

### Skill prose — Future drain (cheap OBE, keep context)

No new scanner. Same four dispositions.

- Items that stay deferred **keep their text**. Regen does not rewrite
  them shorter. The one-line diet is what lost review context.
- New Future items copy the inbox richness (Symptom / Repro / source /
  why deferred / load-bearing file or symbol). Do not collapse a
  pair-review finding to a title.
- Do not paste a whole review or design doc. If it needs headings, it
  is a `docs/designs/` file and Future holds a pointer + one paragraph.
- **Declined / do-not-re-propose** records leave Future. They go in
  the proposal's killed list. They do not go in `roadmap-shipped.md`.
- Deep-check only items whose source Track shipped since
  `LAST_ROADMAP_RUN`, or whose title collides with the inbox.
- Discharge when the premise file/symbol is gone. Kill duplicates of
  live cards.
- Source Track shipped ≠ OBE. Leftovers filed *after* a Track are still
  open unless the premise is gone.

Filing skills (`pair-review`, `full-review`) already write rich TODOS.
This Track does not change those writers. The strip was happening at
`/roadmap` drain. Fix it there.

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
   mandatory pointers. No length warn.
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
| Regen writes a whole design doc into Future | FUTURE fail if it grows headings / `_touches:`; otherwise allowed |

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
| 6 | D1 | Premises accepted with two amendments | User | owner | Always-on pointers; keep Future review context | Reject premises |
| 7 | D1 | Drop 400-char Future warn | User | owner + prior learning | Split is the size fix; one-line diet was losing context | Length lint |
| 8 | 0D | Defer vocab-lint of future file | Mechanical | P3 | Not needed for preview or gather | Lint the archive this Track |
| 9 | 0D | Defer live-file size warn | User | owner lock | Current Plan still 168KB; next lake | Size cap |
| 10 | 0D | Do not change pair-review/full-review writers | Mechanical | P3 | Strip is at drain, not at file | Touch those skills |
| 11 | 0D | Accept always-on pointers + rich Future bodies | User | owner D1 | Live file skinny; archive keeps context | One-line Future diet |
| 12 | 1 | Pointer regex is exact path, not free text | Mechanical | P5 | `Deferred: docs/roadmap-future.md (N items)` only | Fuzzy "see future file" |
| 13 | 2 | Unmigrated = warn, missing pointer after split = fail | Mechanical | P1 | Matches premise 3 + D1 always-pointers | Fail every upgrade day-one |
| 14 | 6 | Fixture quartet is the ship test | Mechanical | P1 | split-ok / incomplete / needed / pointer-missing | Snapshot-only hope |
| 15 | CEO voices | Future apply is surgical, not whole-file regen | Mechanical | P5 + both voices | Keep-text and regen-from-scratch cannot both be true | Whole-block Future replace |
| 16 | CEO voices | Parse satellite as a Future section, not mergeShippedArchive cosplay | Mechanical | P5 + Claude A | `# Future` + `## Future` + bullets so `futureBullets` populate | Silent empty merge |
| 17 | CEO voices | Declined stays in the proposal killed list, not shipped | Mechanical | P5 + both voices | Shipped is frozen IDs; declined is the opposite | `## Declined` in roadmap-shipped.md |
| 18 | CEO voices | Audit `(N items)` against file count | Mechanical | P1 + both voices | Required count that is never checked is a lie | Cosmetic N |
| 19 | CEO voices | Gather index is printed by a helper, not invented by the model | Mechanical | P4 + premise 4 | Skill etiquette already failed on one-liners | "Please Read an index" |
| 20 | CEO voices | Do not claim preview is fixed | Mechanical | honesty | After this Track bolt is still ~170KB Current Plan | "Conductor preview dies → fixed" |
| 21 | D2 | Keep Current Plan in ROADMAP | User | owner | Windowing is a different Track; preview unmeasured | B window / C measure |

## 0D. Cherry-picks (SELECTIVE EXPANSION, auto-decided)

Hold-scope complexity: ~12 production files + fixtures. Smells large but
it is one pattern copied twice (shipped already exists). Minimum set is
parser + FUTURE + skill gather/apply + init + dogfood.

| # | Opportunity | Effort | Decision | Why |
|---|-------------|--------|----------|-----|
| 1 | Always-on pointers | S | ACCEPTED | Owner D1 |
| 2 | Keep Future review context | S | ACCEPTED | Owner D1 — the one-line diet was the bug |
| 3 | Live ROADMAP size warn | M | DEFERRED | Owner cut; Current Plan still 168KB |
| 4 | Vocab-lint `roadmap-future.md` | S | SKIPPED | Archive is not the preview file |
| 5 | `bin/roadmap-split` helper | M | SKIPPED | Skill apply is enough; no second migrator |
| 6 | Change pair-review writers | M | SKIPPED | Strip is at drain |
| 7 | Card-leanness fail on Current Plan | L | DEFERRED | Next lake after Future moves |

Accepted additions are already in the Approach section above.

## CEO Section 1 — Architecture

```
                    /roadmap apply
                          |
          +---------------+---------------+
          |               |               |
          v               v               v
     ROADMAP.md    roadmap-future.md  roadmap-shipped.md
     (live plan    (deferred          (frozen IDs,
      + pointers)   bullets, rich)     append-only)
          |               |               |
          +-------+-------+-------+-------+
                  |
                  v
           parseRoadmap(active)
                  |
                  +-- mergeShippedArchive (IDs)
                  +-- mergeFutureArchive  (bullets)
                  |
                  v
              AuditCtx.roadmap
                  |
                  v
           runCheckFuture / STATE_SECTIONS / PACKING
```

New component: `mergeFutureArchive`. Same shape as `mergeShippedArchive`
but operates on `futureBullets` / `futureMalformed`, not Group/Track IDs.

```
HAPPY:  ROADMAP pointer + future file bullets
        → parse active (0 bullets, pointer whitelisted)
        → merge archive bullets
        → FUTURE pass, count = archive.length

NIL:    no ROADMAP
        → FUTURE skip (existing)

EMPTY:  pointer + empty future file
        → pass, count 0

ERROR:  pointer, file missing
        → FUTURE fail FUTURE_FILE_MISSING

INLINE: bullets in ROADMAP, no file
        → warn FUTURE_SPLIT_NEEDED, still pass
        → /roadmap migrates

BOTH:   bullets in ROADMAP and file
        → fail SPLIT_INCOMPLETE
```

Coupling: `cli.ts` already couples to shipped archive. Future is a second
optional `findDoc`. Justified — same satellite pattern.

10x load: 285 rich Future bullets in the archive. Audit parses them
(cheap). Regen loads an index (title + source + first sentence). Promote
reads one full body. That is the scaling story. What breaks first is
still Current Plan card bloat (out of scope).

Rollback: git revert. No DB. Init templates on already-inited projects
are not retroactive — `/roadmap` is the migrator.

**No issues beyond what the plan already specifies. Moving on.**

## CEO Section 2 — Error & Rescue

```
CODEPATH                         | WHAT CAN GO WRONG              | CLASS
---------------------------------|-------------------------------|------------------
parseRoadmap Future region       | pointer treated as malformed  | futureMalformed
mergeFutureArchive               | both sides have bullets       | SPLIT_INCOMPLETE
findDoc('roadmap-future.md')     | pointer, file absent          | FUTURE_FILE_MISSING
findDoc                          | file present, no pointer      | FUTURE_POINTER_MISSING
/roadmap apply migration         | half-write (file yes, ROADMAP still inline) | SPLIT_INCOMPLETE next audit
init CANONICAL_FILES             | new files collide --migrate   | existing init refusal
init without new templates       | ROADMAP pointers, no files    | FUTURE_FILE_MISSING
```

Rescue: all of these are audit STATUS, not thrown exceptions. The
"user" is the agent running `/roadmap`. Fail = do not ship the apply.
Warn = migrate this run.

No catch-all. Named findings only. **0 GAPS.**

## CEO Section 3 — Security

Attack surface: new markdown files in `docs/`. Audit already treats
ROADMAP extracted strings as untrusted (skill trust-boundary section).
Same rule applies to `roadmap-future.md` titles.

Injection: pointer regex must be literal `docs/roadmap-future.md`, not
an arbitrary path, so a bullet cannot smuggle `Deferred: ../../../etc/passwd`.

No new endpoints, secrets, or deps.

Threat: malicious Future title with "ignore prior instructions" —
already documented for ROADMAP. Likelihood Low, impact Low, mitigated
by existing trust-boundary prose. Auto-decided: copy one sentence into
the skill gather rule naming the Future file. P5.

## CEO Section 4 — Data / interaction

```
INPUT (## Future body) → VALIDATE (bullet | pointer | empty) → MERGE → CHECK → APPLY
  nil ROADMAP     → skip
  empty Future    → pass 0
  pointer only    → load file
  inline bullets  → warn + migrate
  both            → fail
  headings        → fail malformed
```

Interaction: `/roadmap` apply is the only writer. Double-apply is
idempotent (pointer stays, file replaced with regenerated list).
Navigate-away mid-apply: next audit sees SPLIT_INCOMPLETE if half-done;
skill must write file then ROADMAP (file first, then pointer) so a crash
after the file still has inline bullets + file → fail, which is loud.
**Auto-decided: apply writes the satellite files first, then ROADMAP.**
P1 silent-failure rule.

## CEO Section 5 — Quality

Reuse `mergeShippedArchive` shape. Name `mergeFutureArchive`. Do not
genericize `mergeArchive` this Track (P5, one use).

DRY: three `findDoc` copies in cli/pack/touches. Pre-existing. Do not
extract this Track (P3, not in blast for Future — pack/touches skip
Future). Auto-decided: skip.

## CEO Section 6 — Tests

```
NEW DATA FLOWS:
  pointer + file bullets          unit + fixture future-split-ok
  inline, no file                 fixture future-split-needed (warn)
  both non-empty                  fixture future-split-incomplete (fail)
  pointer, no file                fixture future-pointer-missing (fail)
  missing pointer, file exists    fixture future-no-pointer (fail)
  empty file + pointer (0 items)  fixture or unit
  pointer whitelist               parsers-roadmap unit
  mergeFutureArchive              parsers-roadmap unit
  SHARED_DOC_PATHS includes file  lib-pack unit
  init writes both files          init-templates
  this-repo dogfood               live ROADMAP after apply

NEW ERROR PATHS: all named findings above have a fixture.
```

2am Friday test: `future-split-ok` + `future-split-incomplete` + init
template. Hostile QA: pointer with a different path; Future file with
`### Group`. Both must fail.

No LLM evals. Prompt change is skill prose; corpus judge is opportunistic
per CLAUDE.md, not a gate.

## CEO Section 7 — Performance

Parsing 300 KB of Future markdown is fine (already parses 311 KB
ROADMAP). Regen context is the real cost — index-only gather is the
fix. No N+1, no cache.

## CEO Section 8 — Observability

Audit FINDINGS lines are the logs. `FUTURE_BULLET_COUNT` already exists.
Add `FUTURE_SOURCE: inline | file | merged` so a warn/fail is greppable.
Auto-decided: include. S, P2.

No dashboards. Debuggability: the pointer path is in ROADMAP; if audit
says FILE_MISSING the agent knows where to look.

## CEO Section 9 — Deploy

No migration of user DBs. Skill install is a git pull + setup symlink.
Old skill + new audit: audit warns SPLIT_NEEDED, does not fail.
New skill + old audit: skill writes pointers; old FUTURE treats pointer
as malformed → **fail**.

That's a one-hop compatibility hole. Auto-decided: ship audit + skill
in the **same PR** (already the Track). Users on old skill until they
upgrade get the new audit which warns, not fails. Users who pull only
skill prose without the binary cannot happen — setup symlinks the
repo. **OK.**

Rollback: revert the PR. Inited projects keep the two new files; they
are harmless.

## CEO Section 10 — Trajectory

Reversibility: 4/5. Pointers + files can be concatenated back.
Debt: Current Plan still 168 KB on bolt. Named, deferred.
6-month regret: if gather still says "read ## Future" the split is
theater. The skill line change is load-bearing.

Platform: satellite-doc pattern is now the default. Next lake (size
warn, or packing Current Plan cards into a third file) can copy it.

## NOT in scope

- Live ROADMAP byte cap
- Full OBE archaeology of bolt's 285 bullets from this workspace
- Vocab-lint of `roadmap-future.md`
- pair-review / full-review writer changes
- `bin/roadmap-split` standalone helper
- Generic `mergeArchive`

## Dream state delta

This plan gets us to "live ROADMAP is the launch board + pointers."
It does not get us to lean Current Plan cards. That is the remaining
gap vs the 12-month ideal.

## Error & Rescue Registry

See Section 2. Methods: parse + merge + findDoc + apply. CRITICAL GAPS: 0.

## Failure Modes Registry

```
CODEPATH        | FAILURE            | RESCUED | TEST | USER SEES        | LOGGED
parse pointer   | treated malformed  | Y       | Y    | FUTURE fail      | FINDINGS
merge both      | split incomplete   | Y       | Y    | FUTURE fail      | FINDINGS
missing file    | pointer is a lie   | Y       | Y    | FUTURE fail      | FINDINGS
missing pointer | default violated   | Y       | Y    | FUTURE fail      | FINDINGS
unmigrated      | inline only        | Y       | Y    | FUTURE warn      | FINDINGS
apply crash     | file then ROADMAP  | Y       | note | SPLIT_INCOMPLETE | FINDINGS
old audit+new   | cannot happen      | Y       | —    | same PR          | —
```

CRITICAL GAPS: 0.

## Diagrams

Architecture, data-flow (Section 1/4), apply order (file then ROADMAP),
rollback = git revert. No deploy sequence beyond "one PR".

Stale diagrams: none in files we touch except the skill's ROADMAP
template, which this Track rewrites.

## Implementation Tasks (CEO)

- [ ] **T1 (P1, human: ~2h / CC: ~20min)** — parser — pointer whitelist + mergeFutureArchive
  - Surfaced by: Section 1
  - Files: src/audit/parsers/roadmap.ts, tests/parsers-roadmap.test.ts
  - Verify: bun test tests/parsers-roadmap.test.ts
- [ ] **T2 (P1, human: ~2h / CC: ~20min)** — future check — split states + mandatory pointers
  - Surfaced by: Sections 2, 6
  - Files: src/audit/checks/future.ts, src/audit/cli.ts, tests/roadmap-audit/*
  - Verify: bun test tests/audit-snapshots.test.ts tests/audit-invariants.test.ts
- [ ] **T3 (P1, human: ~1h / CC: ~15min)** — skill — gather index, apply files-first, keep Future text, always write pointers
  - Surfaced by: D1 + Section 4 apply order
  - Files: skills/roadmap.md, README.md
  - Verify: skill-protocols still pass
## CEO DUAL VOICES

CODEX SAYS (CEO — strategy challenge): preview claim fails its own
math (~170KB remains). Gather-index is retrieval, not a slogan.
Volatile-regen vs keep-text is a contradiction. mergeShippedArchive
is the wrong Future model. Declined-in-shipped corrupts IDs. `(N)`
must be audited. Empty satellites are ceremony. Real product is a
bounded working set.

CLAUDE SUBAGENT (CEO — strategic independence): same three holes
plus a silent-empty parser bug (no `## Future` H2 → `futureBullets=[]`).
Apply cannot keep unread bodies. Declined-in-shipped can mint fake
Groups. Preview positioning is dishonest. Recommends surgical Future
+ mechanical index; Current Plan windowing as a different Track.

```
CEO DUAL VOICES — CONSENSUS TABLE:
  Dimension                            Claude  Codex  Consensus
  1. Premises valid?                   MIXED   MIXED  DISAGREE on preview
  2. Right problem to solve?           NO*     NO*    CONFIRMED: split is
                                                      real, preview claim
                                                      is not
  3. Scope calibration correct?        MIXED   MIXED  DISAGREE: both want
                                                      Current Plan window
  4. Alternatives explored?            NO      NO     CONFIRMED gap; E
                                                      (surgical) now locked
  5. Competitive/market risks covered? MED     MED    CONFIRMED: markdown-
                                                      as-db is temporary
  6. 6-month trajectory sound?         NO as   NO as  CONFIRMED if we
                                       written written keep preview claim;
                                                      OK if we strike it
```

*Both say the *stated* preview problem is Current Plan. Owner already
cut that lake. That is a User Challenge, not an auto-decide.

Locked from voices (mechanical, now in Approach): surgical apply,
`## Future` in the satellite, no Declined-in-shipped, audit N,
mechanical index helper.

### User Challenge (not auto-decided)

Both models want to add Current Plan windowing / measure Conductor
and refuse the "preview is fixed" story. Owner said Future split +
preamble diet is enough. Default: owner's scope. See D2.

- [ ] **T4 (P1, human: ~45min / CC: ~10min)** — init + dogfood
  - Surfaced by: Section 9
  - Files: scripts/init-templates/*, bin/gstack-extend, docs/ROADMAP.md, docs/roadmap-*.md
  - Verify: bun test tests/init-templates.test.ts


