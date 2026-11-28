### [review:files=src/audit/todo-file-cli.ts|tests/todo-file.test.ts] Test gap: Filing from a Git subdirectory without a path lacks a launcher test
- **ID:** wi-1cee3a
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Successful launcher calls pass a repository path explicitly, leaving implicit Git toplevel selection untested at the filer boundary.
- **Hypothesis (untested):** Invoke the launcher from a nested directory in an isolated Git fixture. Assert that only the worktree root gains the record.
- **Upstream severity:** INFORMATIONAL
- **Found in:** src/audit/todo-file-cli.ts:227
- **Evidence:** The shared resolver has its own repository discovery tests. The filer integration does not cover omitted path from a subdirectory and no failure was reproduced.
- **Context:** Filed by /review-and-prep on feature branch mmm/17662936 at 53d7c17 (2026-11-28). Revisit when the filer or its tests change.
- **Effort:** ? (user triages in /roadmap)
