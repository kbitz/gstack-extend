### [review:files=bin/update-check|tests/update.test.ts] Test gap: Exercise stable checker behavior when origin or Git is unavailable
- **ID:** wi-fbc0fe
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The tagless and archive cases exercise different guards. No permanent test distinguishes a missing origin or Git executable from a failing origin query.
- **Hypothesis (untested):** Add controlled rows for an absent origin, Git off PATH, and another remote lookup error. Verify fallback for the first two and a quiet result for the error.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `bin/update-check:506`
- **Evidence:** coverage-audit and testing specialist checked the changed contract and adjacent fixture assertions. Review produced no failing run for this gap.
- **Context:** Filed by /review-and-prep for Track 102B at `bcfd3ea` (2026-11-27). Revisit when a Track touches these paths.
- **Effort:** ?
