# TODOS

## Unprocessed

### [plan-eng-review:track-6a] Drift test: skill prose section-name lists vs CANONICAL_SECTIONS

**What:** Add a test that asserts every `## SECTION_NAME` referenced in the advisory-sections lists in `skills/roadmap.md` (lines 489, 544) and `skills/roadmap-new.md` (lines 549, 604) matches `CANONICAL_SECTIONS` from `src/audit/sections.ts`.

**Why:** Both skill files hand-list audit section names. If a future Track adds, renames, or removes a section and forgets to sync either skill file, drift goes uncaught until a user hits a missing-section lookup. The Track 6A STALENESS → VERSION_TAG_STALENESS rename surfaced the gap because the plan's `_touches:_` list originally omitted `roadmap-new.md`.

**Pros:**
- One-shot ~30 LOC test pins the drift channel forever.
- Pairs with existing `tests/audit-invariants.test.ts` (fixture-lock) and `tests/audit-compliance.test.ts` (skill registry) — same family of structural-invariants tests.
- Catches the bug class before it ships, not after.

**Cons:**
- Slightly brittle if a future skill intentionally references a deprecated section name in prose (e.g., "STALENESS used to be called…"). Mitigation: strikethrough-aware parsing or a whitelist file.

**Context:** Pre-existing gap. Surfaced during /plan-eng-review of Track 6A (kbitz/audit-polish-freshness, 2026-05-10) when grepping for STALENESS revealed `roadmap-new.md` had advisory-list refs the plan didn't account for. Test would walk both skills/*.md files, extract `## [A-Z_]+` tokens from advisory-list paragraphs, assert each is in `CANONICAL_SECTIONS`.

**Depends on / blocked by:** Group 6 ships (this exists as a clean Track only after the 6A rename lands; otherwise the test would currently flag the in-progress drift between STALENESS and VERSION_TAG_STALENESS as a finding).

_(empty — all entries drained into ROADMAP.md by /roadmap-new on 2026-05-10)_
