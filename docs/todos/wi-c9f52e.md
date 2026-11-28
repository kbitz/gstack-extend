### [review:files=src/review-state/build.ts|tests/review-state.test.ts] Test gap: Narrowed pregate accepts alternate passing spellings
- **ID:** wi-c9f52e
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** C24 verifies raw `pass` with wrapper `passed`. The other supported passing spellings and letter case have no permanent positive fixture.
- **Hypothesis (untested):** Extend C24 with raw `PASSED` and wrapper `PASS`. Confirm that the gate records and preserves the supplied evidence text.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-state/build.ts:604`
- **Evidence:** Track 106A coverage audit traced the CLI and existing C24/C25 tests. The integrated two-file rerun passed. No failure was demonstrated for this remaining case.
- **Context:** Filed by /review-and-prep for Track 106A on branch `mmm/99b8654b` at `a035aae` (2026-11-28).
- **Effort:** ? (user triages in /roadmap)
