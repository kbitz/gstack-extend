### [review:files=bin/update-run|tests/update.test.ts] Test gap: Check main mismatch output against stale or stable cache records
- **ID:** wi-794ebc
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Main-channel mismatch tests use fresh current or legacy main cache records.
- **Hypothesis (untested):** Run with stale-local and stable-channel cache records while main moves. Assert UPGRADE_OK with no mismatch line for those records.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `bin/update-run:155`
- **Evidence:** coverage-audit checked the changed contract and adjacent fixture assertions. Review produced no failing run for this gap.
- **Context:** Filed by /review-and-prep for Track 102B at `bcfd3ea` (2026-11-27). Revisit when a Track touches these paths.
- **Effort:** ?
