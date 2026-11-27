### [review:files=skills/roadmap.md] Test gap: Evaluate proposal Summary sizing decisions
- **ID:** wi-c1ba69
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The protocol test checks the template bullet. No sampled proposal verifies the emitted split and keep reasons or the empty case.
- **Hypothesis (untested):** Compare a generated Summary from a disposable input with its draft Tracks. Run an empty sizing-decision input and inspect the Summary before Apply.
- **Upstream severity:** INFORMATIONAL
- **Found in:** skills/roadmap.md:816–821
- **Evidence:** Read-only Step 7 coverage audit and the passing static Track 101B QA checks. No product failure was reproduced.
- **Context:** Filed by /review-and-prep for Track 101B (wi-5dc2f5), on reviewed commit 5fb644f55386 on 2026-11-26.
- **Effort:** ? (user triages in /roadmap)
