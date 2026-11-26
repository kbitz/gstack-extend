### [review:files=skills/roadmap.md] Test gap: Evaluate recorded gap placement after one-task splitting
- **ID:** wi-d26e7f
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The drain and sizing rules have static coverage. The agent interaction between matching Track placement, task caps and the one-task default lacks a sampled run.
- **Hypothesis (untested):** Include a recorded gap that matches a split Track and a gap that cannot fit. Check placement and deferral in the proposal.
- **Upstream severity:** INFORMATIONAL
- **Found in:** skills/roadmap.md:505–514 and skills/roadmap.md:690
- **Evidence:** Read-only Step 7 coverage audit and the passing static Track 101B QA checks. No product failure was reproduced.
- **Context:** Filed by /review-and-prep for Track 101B (wi-5dc2f5), on reviewed commit 5fb644f55386 on 2026-11-26.
- **Effort:** ? (user triages in /roadmap)
