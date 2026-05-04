# Track 4D — Audit-compliance test (locked plan)

Source: `/plan-eng-review` session in workspace `richmond` (branch
`kbitz/audit-invariants-test` — name is misleading; it's actually 4D
audit-compliance, not 3A invariants), 2026-05-03. Eng review CLEARED.

**Status:** DONE — scope reduced significantly then re-reframed back to
near-original after codex challenged the reframe. Final scope is the original
ROADMAP plan with sharper specs. 0 critical gaps, 0 unresolved decisions.
Codex outside-voice ran (read-only, ~2 min); 12 findings; 7 substantively
right; 2 factually wrong (verified live).

## Final scope (~120–150 LOC, ~2 hr CC, low risk)

**NEW `tests/audit-compliance.test.ts`** with three describe blocks:

### (A) Frontmatter sanity

Codex's 4-check spec applied to all 5 skills (`full-review`, `pair-review`,
`review-apparatus`, `roadmap`, `test-plan`):

1. `---` fence present at top of file
2. `name:` field equals filename (without `.md`)
3. `description:` field present and non-empty
4. `allowed-tools:` field present

### (B) `setup` ↔ `skills/*.md` symmetric

Bidirectional check, parses `setup` script as text via regex:

- **Forward:** every skill in `setup`'s SKILLS array has a corresponding `skills/*.md` file.
- **Reverse:** every `skills/*.md` file is listed in `setup`'s SKILLS array.

Catches the case where someone adds a skill file but forgets to register it
(or vice versa).

### (C) Source-tag registry consistency

- Imports `REGISTERED_SOURCES` from `src/audit/lib/source-tag.ts` (NEW EXPORT — see "EXPORTS" below).
- Asserts `docs/source-tag-contract.md` matches the registry exactly (no diff in either direction).

## Doc fix

`docs/source-tag-contract.md`: add `discovered` to grammar list (codex
finding 10 — the source tag exists in code but isn't documented).

## Data fix

`docs/TODOS.md`: retag the existing `### [design]` TODO entry to `[review]`.
Sub-decision at implementation time:
- **Simplest:** retag to `[review]` per the entry's prose ("Codex outside-voice flagged...").
- **Alternative:** extend the registry to include `[design]` as a valid source tag.

The simplest option is the recommended choice.

## EXPORTS (new)

**`src/audit/lib/source-tag.ts`** — add a `REGISTERED_SOURCES` export. This
is the single source of truth for the source-tag list, replacing the
hard-coded list in `tests/skill-protocols.test.ts:27` (which becomes a
follow-up dedup TODO — see Future in ROADMAP).

If the export already exists under a different name, verify and reuse.

## NOT in scope

- Whole-audit `STATUS: fail` gate as `/ship` invariant — codex flagged that
  this couples /ship to roadmap mood. **Consensus: drop.**
- `_accepted_oversize: true_` waiver mechanism — codex flagged it as sloppy
  (no reason/expiry/review). **Consensus: drop.**
- `setup` bun-require — codex flagged as overengineered for 5 names.
  **Consensus: drop. Parse setup as text via regex.**
- Audit fail-taxonomy calibration (`ARCHIVE_CANDIDATES` warn vs fail, narrow
  `SIZE` waiver) — moved to `## Future` in ROADMAP.
- SKILLS list dedup helper (`tests/helpers/parse-setup-skills.ts`) — moved
  to `## Future` in ROADMAP (extract once 4D's parser ships).
- Malformed `[design]` source-tag detection in real TODOs — lives in
  `bin/roadmap-audit` TODO_FORMAT, not this test.

## Cross-model consensus

| Topic | Verdict |
|---|---|
| Original Track 4D scope (3 targeted assertions) | Both models converged: this is right |
| Whole-audit `STATUS: fail` gate as `/ship` invariant | Codex: wrong; Claude reversed. **Consensus: drop.** |
| `_accepted_oversize: true_` waiver mechanism | Codex: sloppy; Claude reversed. **Consensus: drop.** |
| `setup` bun-require | Codex: overengineered; Claude reversed. **Consensus: drop.** |
| Frontmatter validation drop | Codex correctly named the obvious minimal spec; Claude was too quick to drop. **Consensus: keep with codex's spec.** |
| `discovered:<path>` doc/code inconsistency | Codex caught; Claude missed. **Consensus: fix as part of Track 4D.** |
| Codex's STRUCTURE: fail claim | Verified live — codex was wrong, STRUCTURE passes. **Consensus rejected.** |
| Codex's "Group 2 already landed" claim | Verified live — bin/roadmap-audit is still bash. **Consensus rejected.** *(Note: Group 2 has since shipped in v0.18.6.0, but was not landed at review time.)* |

## Failure modes

| Failure | Test catches? | Error handling? | User sees? |
|---|---|---|---|
| Skill file missing `---` fence | ✓ frontmatter test | n/a | clear test failure naming the file |
| Skill `name:` doesn't match filename | ✓ frontmatter test | n/a | clear test failure with both names |
| Skill missing `description:` or `allowed-tools:` | ✓ frontmatter test | n/a | clear test failure naming the missing field |
| New skill added to `setup` array, no md file | ✓ symmetric test (forward) | n/a | clear test failure naming the orphan |
| New skill md file, not in `setup` array | ✓ symmetric test (reverse) | n/a | clear test failure naming the orphan |
| Source-tag added in code, not in docs | ✓ registry test | n/a | clear test failure listing the diff |
| Source-tag added in docs, not in code | ✓ registry test | n/a | clear test failure listing the diff |
| Malformed `[design]` source-tag in real TODOs | ✗ NOT this test (lives in `bin/roadmap-audit` TODO_FORMAT) | runtime via `/roadmap` | only seen via /roadmap or /ship's own audit run |

**Critical gaps:** 0. All in-scope codepaths have explicit assertions with
actionable error messages.

## Next steps

1. Add `REGISTERED_SOURCES` export to `src/audit/lib/source-tag.ts` (verify
   first whether it exists under a different name).
2. Write `tests/audit-compliance.test.ts` with the three describes.
3. Add `discovered` to grammar list in `docs/source-tag-contract.md`.
4. Retag the `### [design]` TODO entry to `[review]` in `docs/TODOS.md`.
5. Run tests, `/ship` when done.

No UI scope → /plan-design-review N/A. No new product direction → /plan-ceo-review N/A.
**Eng cleared. Implement and ship.**
