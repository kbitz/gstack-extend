### [review:files=bin/update-run|tests/update.test.ts] Test gap: Keep pending range state isolated by checkout
- **ID:** wi-0f6c9a
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Current fixtures use separate state directories. They do not exercise two checkouts sharing one state directory.
- **Hypothesis (untested):** Interleave two failed then successful upgrades against local remotes in a shared scratch state directory and verify each range endpoint.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `bin/update-run:219`
- **Evidence:** Read-only coverage audit of Track 105A at `988d907`; the targeted run passed and no failure was reproduced for this case.
- **Context:** Filed by /review-and-prep before the Track 105A PR. Revisit when the owning paths change.
- **Effort:** ?
