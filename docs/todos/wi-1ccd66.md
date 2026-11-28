### [review:files=bin/update-run|tests/update.test.ts] Test gap: Ignore an invalid pending upgrade start
- **ID:** wi-1ccd66
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The retry fixtures cover reuse and cleanup of a valid commit. A malformed or unrelated previously recorded start is untested.
- **Hypothesis (untested):** Provide each invalid kind in a scratch checkout and assert the range uses the pre-pull current commit.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `bin/update-run:221`
- **Evidence:** Read-only coverage audit of Track 105A at `988d907`; the targeted run passed and no failure was reproduced for this case.
- **Context:** Filed by /review-and-prep before the Track 105A PR. Revisit when the owning paths change.
- **Effort:** ?
