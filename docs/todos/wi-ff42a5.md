### [review:files=skills/references/review-and-prep/resume-review-records.md|tests/handoff-contract.test.ts] Test gap: Full review after local refresh escalation
- **ID:** wi-ff42a5
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** The classifier confirms the handoff outcome but does not exercise the receiving workflow against a stale ready receipt.
- **Hypothesis (untested):** Use a PR history fixture with a draft and a newer local escalated candidate. Assert an ordinary invocation takes full review.
- **Upstream severity:** INFORMATIONAL
- **Found in:** skills/references/review-and-prep/resume-review-records.md
- **Evidence:** The existing H-D oracle checks the received message only.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/318 at df592af (2026-11-27).
- **Effort:** ? (user triages in /roadmap)
