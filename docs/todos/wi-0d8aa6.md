### [review:files=skills/references/review-and-prep/conditional-base-move-refresh.md|tests/skill-protocols-review-and-prep.test.ts] Test gap: Refresh candidate moves during delta inventory
- **ID:** wi-0d8aa6
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The Git fixture checks a stale candidate before inventory and a pinned candidate on success. It leaves movement after the first HEAD read unexercised.
- **Hypothesis (untested):** Advance HEAD in a disposable fixture while the fence reads the delta. Verify that it fails without a completion record.
- **Upstream severity:** INFORMATIONAL
- **Found in:** skills/references/review-and-prep/conditional-base-move-refresh.md:115
- **Evidence:** Audit of the final reread and existing Git fixture. The focused suite passed and reproduced no defect.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/318 at `0b7b0b6` (2026-11-27).
- **Effort:** ? (user triages in /roadmap)
