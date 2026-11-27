### [review:files=src/audit/parsers/roadmap.ts|tests/parsers-roadmap.test.ts] Test gap: Keep active Future source lines when both copies have bullets
- **ID:** wi-5ca8fe
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The dual-presence fixture checks that the active Future bullet wins. Its archive bullet starts on the same line, and the fixture does not check the retained source line.
- **Hypothesis (untested):** Place active and archive bullets on different lines, merge both, and assert that the active bullet keeps its own line number.
- **Upstream severity:** INFORMATIONAL
- **Found in:** tests/parsers-roadmap.test.ts:898
- **Evidence:** The continuation review read the passing fixture and owning code. No product failure was reproduced.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/319 at 31f406a (2026-11-26).
- **Effort:** ? (user triages in /roadmap)
