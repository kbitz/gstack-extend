### [review:files=docs/workflow-handoffs.md|tests/handoff-contract.test.ts] Test gap: Legacy classifier with full H-G escalation summary
- **ID:** wi-d637ac
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** Existing contract tests check the bare escalation line; they do not pass the full message through the legacy classifier.
- **Hypothesis (untested):** Include prose, H-G escalation and the stopped stage line in a fixture. Verify the legacy consumer holds instead of treating it as H-E.
- **Upstream severity:** P3
- **Found in:** docs/workflow-handoffs.md
- **Evidence:** Existing tests verify the unwrapped line and stopped grammar in isolation.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/318 at df592af (2026-11-27).
- **Effort:** ? (user triages in /roadmap)
