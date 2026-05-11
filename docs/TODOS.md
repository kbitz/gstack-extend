# TODOS

## Unprocessed

### [plan-eng-review:track-6a] Drift test: skill prose section-name lists vs CANONICAL_SECTIONS

**What:** Add a test that asserts every `## SECTION_NAME` referenced in the advisory-sections lists in `skills/roadmap.md` matches `CANONICAL_SECTIONS` from `src/audit/sections.ts`.

**Why:** The skill file hand-lists audit section names. If a future Track adds, renames, or removes a section and forgets to sync the skill file, drift goes uncaught until a user hits a missing-section lookup. The Track 6A STALENESS → VERSION_TAG_STALENESS rename surfaced the gap; the v0.19.0.0 cutover collapsed `skills/roadmap-new.md` into `skills/roadmap.md`, so the test scope is now a single file.

**Pros:**
- One-shot ~30 LOC test pins the drift channel forever.
- Pairs with existing `tests/audit-invariants.test.ts` (fixture-lock) and `tests/audit-compliance.test.ts` (skill registry) — same family of structural-invariants tests.
- Catches the bug class before it ships, not after.

**Cons:**
- Slightly brittle if a future skill intentionally references a deprecated section name in prose (e.g., "STALENESS used to be called…"). Mitigation: strikethrough-aware parsing or a whitelist file.

**Context:** Pre-existing gap. Surfaced during /plan-eng-review of Track 6A (kbitz/audit-polish-freshness, 2026-05-10) when grepping for STALENESS revealed advisory-list refs the plan didn't account for. Test walks `skills/roadmap.md`, extracts `## [A-Z_]+` tokens from advisory-list paragraphs, asserts each is in `CANONICAL_SECTIONS`.

**Depends on / blocked by:** None — both blockers (Track 6A rename and the v0.19.0.0 cutover) have shipped.

_(empty — all entries drained into ROADMAP.md by /roadmap on 2026-05-10)_
