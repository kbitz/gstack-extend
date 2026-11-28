### [review:files=skills/gstack-extend-upgrade.md|tests/skill-protocols.test.ts] Test gap: Exercise the installed What’s New sources
- **ID:** wi-f9b0bc
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Skill tests check headings and required keywords. They do not evaluate which changelog entries or main commits an agent actually summarizes.
- **Hypothesis (untested):** Use tagged and main fixtures with distinct restored-branch text and assert the selected version window, upgrade notes and host rows.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `skills/gstack-extend-upgrade.md:123`
- **Evidence:** Read-only coverage audit of Track 105A at `988d907`; the targeted run passed and no failure was reproduced for this case.
- **Context:** Filed by /review-and-prep before the Track 105A PR. Revisit when the owning paths change.
- **Effort:** ?
