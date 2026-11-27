### [review:files=docs/designs/review-run-state.md|tests/review-state.test.ts] Test gap: Older helper reading escalation state
- **ID:** wi-ed9a93
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** Tests read a pre-refresh stored record with the current helper. The opposite version direction lacks a permanent test.
- **Hypothesis (untested):** Use a released pre-refresh helper with a valid newer escalated record and verify its version-refusal category.
- **Upstream severity:** P3
- **Found in:** docs/designs/review-run-state.md
- **Evidence:** The compatibility fixture exercises the newer reader, and release versioning belongs to the later stage.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/318 at df592af (2026-11-27).
- **Effort:** ? (user triages in /roadmap)
