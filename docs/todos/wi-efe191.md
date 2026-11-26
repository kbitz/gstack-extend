### [review:files=skills/roadmap.md|tests/skill-protocols-roadmap.test.ts] Test gap: Static guards for alternate numeric split wording
- **ID:** wi-efe191
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The sizing test catches digit-and-unit cutoffs and misses spelled-out, hyphenated and plus-suffixed counts.
- **Hypothesis (untested):** Try bounded mutations such as “more than five tasks”, “a 300-line diff” and “200+ lines” alongside the existing examples. Keep the test focused on credible wording changes.
- **Upstream severity:** P3
- **Found in:** tests/skill-protocols-roadmap.test.ts:749–767
- **Evidence:** Read-only Step 7 coverage audit and the passing static Track 101B QA checks. No product failure was reproduced.
- **Context:** Filed by /review-and-prep for Track 101B (wi-5dc2f5), on reviewed commit 5fb644f55386 on 2026-11-26.
- **Effort:** ? (user triages in /roadmap)
