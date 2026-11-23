# TODOS

## Unprocessed

### [review:files=setup|bin/gstack-extend|tests/bun-prereq.test.ts] Test gap: Cover additional setup and init refusals

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The launcher matrix covers an unavailable helper and an unparseable Bun. Setup and init have their own refusal paths.
- **Hypothesis (untested):** Extend disposable setup, uninstall, mutating init, and preview fixtures to cover an unavailable helper and an unparseable Bun version.
- **Upstream severity:** INFORMATIONAL (coverage audit); P1 (outside structured review, review cycles 2 and 3, on PR #300)
- **Found in:** setup and bin/gstack-extend.
- **Evidence:** Disposable setup, uninstall, and mutating init refused before writes in both cases. Preview still succeeded with a warning when the helper was unreadable.
- **Context:** Track 94H coverage audit at `aaf05a0` (2026-11-23). Revisit when a Track next touches these files.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=bin/docs-ship|bin/merge-gate|tests/docs-ship.test.ts|tests/merge-gate.test.ts] Test gap: Cover missing CLI after Bun passes preflight

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The launcher suite covers a missing prerequisite helper. The docs-ship and merge-gate guards for missing CLI source can take different branches when the helper is present.
- **Hypothesis (untested):** Copy the launcher and real helper into the existing installation fixture and omit only the CLI source.
- **Upstream severity:** INFORMATIONAL
- **Found in:** bin/docs-ship and bin/merge-gate.
- **Evidence:** Layout-scaffold and upstream-check exercise this distinction. The equivalent guards were verified by source inspection.
- **Context:** Track 94H coverage audit at `aaf05a0` (2026-11-23). Revisit when a Track next touches these files.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=bin/update-run|setup|tests/update.test.ts] Test gap: Cover retrying an update after a Bun refusal

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The updater test suite covers generic setup failure and same-version retry. It lacks a combined run with the new Bun prerequisite check and real setup.
- **Hypothesis (untested):** Use a disposable remote and two local Bun fixtures to verify that retry with a supported version completes pending migrations once.
- **Upstream severity:** INFORMATIONAL
- **Found in:** bin/update-run.
- **Evidence:** Setup refused old Bun before its own writes, and the existing updater recovery tests passed.
- **Context:** Track 94H coverage audit at `aaf05a0` (2026-11-23). Revisit when a Track next touches these files.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=bin/merge-gate|tests/merge-gate.test.ts] Test gap: Pin merge-gate prerequisite output modes

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The runtime error table locks the JSON error object. It lacks equivalent Bun refusal assertions in the text and JSONL modes.
- **Hypothesis (untested):** Extend one table row to check the two-line stderr format and the canonical single-record JSONL output.
- **Upstream severity:** INFORMATIONAL
- **Found in:** bin/merge-gate.
- **Evidence:** Scratch smoke checks verified text stderr, JSONL stdout, and exit 1.
- **Context:** Track 94H coverage audit at `aaf05a0` (2026-11-23). Revisit when a Track next touches these files.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=src/review-state/render.ts|tests/handoff-contract.test.ts] Test gap: Reject an overlong completed Greptile SHA

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The malformed-input cases cover short SHAs. They leave removal of the right-hand SHA boundary untested.
- **Hypothesis (untested):** Add a completed value with 41 contiguous lowercase hex digits and assert refusal. Check the actual accepted boundary first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-state/render.ts:102`
- **Evidence:** The Track 94G coverage audit found the boundary in the renderer and the short-SHA case in the passing targeted suite.
- **Context:** Track 94G review at `bc7ed59` (2026-11-23).
- **Revisit when:** A Track changes Greptile value parsing or its handoff tests.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=src/review-state/render.ts|tests/review-state.test.ts] Test gap: Replay paused Greptile receipt recovery in the CLI suite

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The suite tests the refusal and lifecycle commands separately. The full corrected-gate sequence was verified with an isolated CLI replay during review.
- **Hypothesis (untested):** Extend the refusal case to resume, record a corrected gate, checkpoint the pause again, and assert that the paused receipt uses the new gate.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `tests/review-state.test.ts:1925`
- **Evidence:** The complete pause recovery replay passed at `bc7ed59`.
- **Context:** Track 94G review at `bc7ed59` (2026-11-23).
- **Revisit when:** A Track changes paused receipt rendering or review-state recovery.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=docs/review-run-state-calls.md|tests/skill-protocols-review-and-prep.test.ts] Test gap: Pin the pre-ready Greptile receipt reuse check

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The final renderer's receipt mismatch test protects the byte check after finish. No test pins the caller's check for changed Greptile wording before reusing an older posted receipt.
- **Hypothesis (untested):** Extend the resume protocol test to assert the current-renderer check before comment reuse.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `docs/review-run-state-calls.md:102`
- **Evidence:** The coverage audit confirmed the caller instruction and the existing renderer guard.
- **Context:** Track 94G review at `bc7ed59` (2026-11-23).
- **Revisit when:** A Track changes ready-resume receipt reuse or its protocol tests.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=skills/roadmap.md|tests/skill-protocols-roadmap.test.ts] Test gap: Require a nonempty draft before packing

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The roadmap protocol test pins the `--from` arguments. It does not assert the instruction to check that the draft exists and is nonempty before packing.
- **Hypothesis (untested):** Extend the grouping assertion to cover the draft check. Re-verify the packer's behavior for a missing or empty draft first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `skills/roadmap.md:890`
- **Evidence:** The coverage audit found the instruction in the skill and populated drafts in the passing protocol and CLI checks.
- **Context:** Track 94B review of `193eb39` (2026-11-22). Revisit when a Track next changes draft packing or its protocol tests.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=skills/roadmap.md|tests/skill-protocols-roadmap.test.ts] Test gap: Pin the prohibition on host-private roadmap scratch paths

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The Step 1b assertion checks for the phrase `host-private directory`. Reversing the instruction could leave the phrase intact.
- **Hypothesis (untested):** Strengthen the Step 1b assertion to check the prohibition. Re-verify the shared workspace-agnostic checks first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `tests/skill-protocols-roadmap.test.ts:504`
- **Evidence:** The coverage audit confirmed the current skill prohibits host-private scratch paths and the current test checks phrase presence.
- **Context:** Track 94B review of `193eb39` (2026-11-22). Revisit when a Track next changes roadmap storage or its protocol tests.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=skills/plan-track.md|tests/skill-protocols-plan-track.test.ts] Test gap: Pin selector placement and case normalization

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The protocol tests pin whole-ID matching and field-value exclusion. The exact standalone argument forms and case normalization can drift independently.
- **Hypothesis (untested):** Extend the selector assertions to pin the supported positions and folding of the ID letter.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `skills/plan-track.md:131` and `skills/plan-track.md:151`
- **Evidence:** Track 94C coverage audit at `86aa4fe`. The protocol and shell checks passed.
- **Context:** Filed by /review-and-prep for Track 94C at `86aa4fe` (2026-11-22).
- **Revisit when:** A Track changes the selector grammar or its tests.
- **Effort:** ? (user triages in /roadmap)

### [review:files=skills/plan-track.md|tests/skill-protocols-plan-track.test.ts] Test gap: Pin the end of active roadmap sections

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The tests pin the active section names and the card extraction boundary. They do not pin the scan's stop at the next level-two heading.
- **Hypothesis (untested):** Lock the scan boundary alongside the active-section names.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `skills/plan-track.md:164`
- **Evidence:** Track 94C coverage audit at `86aa4fe`. The active-section assertions passed.
- **Context:** Filed by /review-and-prep for Track 94C at `86aa4fe` (2026-11-22).
- **Revisit when:** A Track changes roadmap section handling in `/plan-track`.
- **Effort:** ? (user triages in /roadmap)

### [review:files=skills/plan-track.md|tests/skill-protocols-plan-track.test.ts] Test gap: Pin direct card-file selection rules

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Tests pin card selection before path choice. They leave room for drift in supplied-file scope, heading-only uniqueness and matching an accompanying selector to a single card.
- **Hypothesis (untested):** Add checks for these direct-file rules to the existing selector contract test.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `skills/plan-track.md:159`
- **Evidence:** Track 94C coverage audit at `86aa4fe`. The direct-file path-order check passed.
- **Context:** Filed by /review-and-prep for Track 94C at `86aa4fe` (2026-11-22).
- **Revisit when:** A Track changes explicit `CARD_FILE` selection or its tests.
- **Effort:** ? (user triages in /roadmap)

### [review:files=skills/plan-track.md|tests/skill-protocols-plan-track.test.ts] Test gap: Pin selector provenance fields

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The test pins the Auto-decisions section for a resolved selector. It does not check that the row names the selector, file, active roadmap section and matched heading.
- **Hypothesis (untested):** Extend the existing section assertion to cover the recorded fields.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `skills/plan-track.md:178`
- **Evidence:** Track 94C coverage audit at `86aa4fe`. The Auto-decisions assertion passed.
- **Context:** Filed by /review-and-prep for Track 94C at `86aa4fe` (2026-11-22).
- **Revisit when:** A Track changes the plan's selector provenance or its tests.
- **Effort:** ? (user triages in /roadmap)

### [review:files=skills/plan-track.md|tests/skill-protocols-plan-track.test.ts] Test gap: Pin Track title punctuation handling

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Naming tests pin the ASCII rule, slug cap and fallback. The punctuation-run and pre-cap trimming rules can drift without tripping those assertions.
- **Hypothesis (untested):** Extend the naming assertion to cover the hyphen mapping and trim order.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `skills/plan-track.md:199`
- **Evidence:** Track 94C coverage audit at `86aa4fe`. The default-naming tests passed.
- **Context:** Filed by /review-and-prep for Track 94C at `86aa4fe` (2026-11-22).
- **Revisit when:** A Track changes default naming or its tests.
- **Effort:** ? (user triages in /roadmap)

### [review:files=skills/plan-track.md|tests/skill-protocols-plan-track.test.ts] Test gap: Exercise Track selection with an installed agent

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The protocol checks read the skill and execute the session-kind fence. They leave card extraction, generated plans and stop behavior untested in actual agent invocations.
- **Hypothesis (untested):** Use isolated roadmap fixtures to exercise interactive resolution and ambiguous or ineligible input, strict named-field calls and rejected selectors, and distinct outputs and collision preservation.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `skills/plan-track.md:131`
- **Evidence:** Track 94C coverage audit at `86aa4fe`. Static and shell checks passed. The approved plan records the live-agent limit.
- **Context:** Filed by /review-and-prep for Track 94C at `86aa4fe` (2026-11-22).
- **Revisit when:** A Track qualifies installed-agent planning with suitable fixtures.
- **Effort:** ? (user triages in /roadmap)

### [review:files=bin/gstack-extend|docs/installation.md] Follow-up: Give an unusable Bun PATH entry its own refusal wording

- **Follow-up:** Non-blocking review finding (P3, not shown), recorded under the developer's continuation rule for lesser findings.
- **Description:** `check_bun_audit_path` refuses with the `PREREQ_BUN_MISSING` token after a supported Bun was found and passed the version probe. That happens only when its PATH entry cannot be used from the audit directory (a colon in the path). The documented `PREREQ_BUN_MISSING` line says "not on PATH" and gives an install fix, so a caller that keys on the token may reinstall Bun instead of fixing PATH. The message also lacks the shared "rerun the same command once" recovery text.
- **Hypothesis (untested):** Use a distinct cause in the same family, or document this variant in the Requirements templates with the standard recovery suffix.
- **Upstream severity:** P3
- **Found in:** `bin/gstack-extend:654` (`check_bun_audit_path`)
- **Revisit when:** a Track next changes init's Bun gate or the refusal templates in `docs/installation.md`.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/300 at b31397b (2026-11-23).
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=bin/upstream-check|docs/upstream-check.md] Follow-up: Keep the raw Bun version in upstream-check's internal-error context

- **Follow-up:** Non-blocking review finding (P3, not shown), recorded under the developer's continuation rule for lesser findings.
- **Description:** The `ERROR INTERNAL` version context now prints the probe's numeric core. Before this change it printed the raw `bun --version` output, so diagnostics from a canary or build-tagged Bun lose the prerelease identifier.
- **Hypothesis (untested):** Print the sanitized raw first line alongside the numeric core.
- **Upstream severity:** P3
- **Found in:** `bin/upstream-check:55`
- **Revisit when:** a Track next changes upstream-check's launcher or its error contract.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/300 at b31397b (2026-11-23).
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=setup|tests/bun-prereq.test.ts] Test gap: Check that setup's Bun install hint names a published release

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The install-hint test checks that the pinned `BUN_VERSION` is at least the floor and reaches the installer as its first argument. Nothing checks that the pinned release exists.
- **Hypothesis (untested):** Add an opt-in network check, or a release-time check, that resolves the pinned tag. Re-verify the plan's choice not to freeze a version string first.
- **Upstream severity:** P3
- **Found in:** `setup:26`
- **Evidence:** The pinned 1.4.3 build was installed and exercised during the floor qualification. No failing case was reproduced.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/300 at b31397b (2026-11-23).
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=skills/roadmap.md|skills/review-and-prep.md] Base issue: Skills run Bun snippets without the launcher prerequisite and .env guard

- **Base issue:** present at merge base `6293d8c`; the review flagged it as a trust-boundary gap, and the developer chose to file and defer it (decision 7699a731)
- **Description:** `skills/roadmap.md` runs plain `bun -e` snippets with no `--no-env-file`, so Bun loads the working directory's `.env` into a snippet that spawns git. `skills/review-and-prep.md` passes `--no-env-file` directly, which Bun older than 1.3.3 silently ignores, and nothing checks the Bun version before those snippets run.
- **Evidence:** In a scratch directory with a `.env` marker, `bun -e` printed the marker and `bun --no-env-file -e` did not (Bun 1.4.3). Neither skill file differs from the merge base.
- **Upstream severity:** Medium (adversarial)
- **Found in:** `skills/roadmap.md:248` (also `:260`, `:763`, `:945`, `:1130`); `skills/review-and-prep.md` (inline `bun --no-env-file` snippets)
- **Revisit when:** a Track next edits either skill's inline Bun snippets.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/300 at b31397b (2026-11-23).
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=bin/lib/bun-prereq.sh|tests/bun-prereq.test.ts] Follow-up: Find the Bun executable when a shell function named bun is exported

- **Follow-up:** Non-blocking review finding (Low, not rerun), recorded under the developer's continuation rule for lesser findings.
- **Description:** The probe resolves Bun with `command -v bun` and requires a path. When a `bun` shell function is exported into the launcher's shell, the lookup returns the function name and the launcher refuses with `PREREQ_BUN_MISSING`, while the old `exec bun` skipped the function and ran the binary.
- **Hypothesis (untested):** Walk PATH for an executable file named `bun` when the lookup returns no path. Re-verify which `/bin/sh` implementations import exported functions first.
- **Upstream severity:** Low (adversarial)
- **Found in:** `bin/lib/bun-prereq.sh:133` (`bun_prereq_probe` lookup)
- **Revisit when:** a Track next changes the helper's lookup.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/300 at b31397b (2026-11-23).
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=setup|bin/lib/bun-prereq.sh] Follow-up: Setup can accept a Bun that the installed launchers will not find

- **Follow-up:** Non-blocking review finding (Medium, not rerun), recorded under the developer's continuation rule for lesser findings.
- **Description:** Setup checks the Bun that bash resolves. The installed launchers run under `/bin/sh`, which skips a literal `~` PATH entry that bash expands. With such an entry, setup can succeed while each launcher later refuses, with an actionable message, for an older Bun later on PATH.
- **Hypothesis (untested):** Probe under `/bin/sh` in setup as init's audit check now does, or warn when the two shells resolve different Bun paths.
- **Upstream severity:** Medium (adversarial)
- **Found in:** `setup:22` (Bun prerequisite block)
- **Revisit when:** a Track next changes setup's Bun check.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/300 at b31397b (2026-11-23).
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=bin/gstack-extend] Follow-up: Check init's Bun only where the audit runs it

- **Follow-up:** Non-blocking review finding (red team, not rerun), recorded under the developer's continuation rule for lesser findings.
- **Description:** Init still probes Bun from the directory it was started in before probing from the project directory. Started from a directory whose version manager pins an older Bun, init refuses before writing even when the project directory selects a supported Bun.
- **Hypothesis (untested):** Look Bun up in the starting directory but check its version only from the project directory. Keep the missing-Bun refusal and the relative-PATH audit behavior.
- **Upstream severity:** INFORMATIONAL (red team)
- **Found in:** `bin/gstack-extend:695` (`require_bun`)
- **Revisit when:** a Track next changes init's Bun gate.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/300 at b31397b (2026-11-23).
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=bin/lib/bun-prereq.sh] Follow-up: Keep the tail of a long Bun path in refusal messages

- **Follow-up:** Non-blocking review finding (red team, not rerun), recorded under the developer's continuation rule for lesser findings.
- **Description:** Refusals keep the first 64 sanitized characters of the Bun path, as the approved helper safety contract requires. A long path then prints only a parent-directory prefix and drops the binary that failed, which is what a user needs when a launcher resolves a different Bun than their shell.
- **Hypothesis (untested):** Keep the last characters instead of the first, within the same character set and length cap. This changes the approved contract, so it needs an owner decision.
- **Upstream severity:** INFORMATIONAL (red team)
- **Found in:** `bin/lib/bun-prereq.sh:23` (path sanitizer)
- **Revisit when:** a Track next changes the helper's message format.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/300 at b31397b (2026-11-23).
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=bin/lib/bun-prereq.sh|tests/bun-prereq.test.ts] Test gap: Cover help-text variants at the exact Bun floor

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** A build that reports exactly the floor version passes only when its help lists `--no-env-file`. The recorded smoke used the official 1.3.3 build. Wrapped or reformatted help output is not covered.
- **Hypothesis (untested):** Add fixtures for a wrapper that colors or reflows help text, and re-verify the check's pattern against them.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `bin/lib/bun-prereq.sh:89` (exact-floor help check)
- **Evidence:** The core pass recorded this as follow-up coverage. No failing case was reproduced.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/300 at b31397b (2026-11-23).
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=bin/lib/bun-prereq.sh|tests/bun-prereq.test.ts] Follow-up: Avoid a here-document in the exact-floor help check

- **Follow-up:** Non-blocking review finding (CRITICAL label from the delegated adversarial pass, not reproduced), recorded under the developer's continuation rule for lesser findings and the developer's decision 7699a731.
- **Description:** `_bun_prereq_floor_has_flag` reads Bun's help text through a here-document. Bash older than 5.1, such as macOS `/bin/sh`, writes each here-document to a temporary file. If neither `TMPDIR` nor `/tmp` is writable, a build reporting exactly 1.3.3 could be refused as too old and the shell error would reach stderr.
- **Hypothesis (untested):** Split the help text with parameter expansion instead of a here-document. Re-verify on bash 3.2 with an unwritable temporary directory first.
- **Upstream severity:** CRITICAL (adversarial delegate)
- **Found in:** `bin/lib/bun-prereq.sh:98` (`_bun_prereq_floor_has_flag`)
- **Evidence:** With Bun 1.3.3 and a nonexistent `TMPDIR`, `/bin/sh` and bash 5.3 on Linux classified the build as supported. Bash 3.2 was not available.
- **Revisit when:** a Track next changes the exact-floor check, or macOS support is exercised.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/300 at 59cb251 (2026-11-23).
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=bin/lib/bun-prereq.sh|tests/bun-prereq.test.ts] Follow-up: Confirm the refusal sanitizer on bash 4.2 and older

- **Follow-up:** Non-blocking review finding (red team, not rerun), recorded under the developer's continuation rule for lesser findings.
- **Description:** The sanitizer appends each kept character through a quoted pattern removal nested inside an outer double-quoted assignment. The delegated red team says bash 4.2 and older, including macOS's bash 3.2 `/bin/sh`, treat that inner pattern as an unquoted glob, so a Bun path or version string containing glob characters could pass `"`, `\` or `*` into refusal text and break the JSON that review-state and merge-gate print.
- **Hypothesis (untested):** Assign the extracted character without outer quotes first, then append it, as the helper's other pattern removals already do. Re-verify on bash 3.2 first; no bash older than 5.3 was available here.
- **Upstream severity:** INFORMATIONAL (red team)
- **Found in:** `bin/lib/bun-prereq.sh:29`
- **Revisit when:** a Track next changes the helper's sanitizer, or macOS support is exercised.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/300 at 2b90a30 (2026-11-23).
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=tests/workflow-metrics.test.ts] Base issue: The parallel metrics writer test fails under Bun 1.3.3

- **Base issue:** present at merge base `6293d8c`; filed under `blocking=shown`
- **Description:** The "parallel writers and readers" case expects at least one recorded envelope. Under Bun 1.3.3 every writer reports `unavailable`, so the case fails, while Bun 1.4.3 passes. The project states 1.3.3 as its development floor.
- **Evidence:** `bun test tests/workflow-metrics.test.ts -t 'parallel writers and readers'` with Bun 1.3.3 failed twice at the merge base and on this branch (recorded 0, expected at least 1). The same case passed with Bun 1.4.3.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `tests/workflow-metrics.test.ts:672`
- **Revisit when:** a Track next changes the metrics writer lock or the development floor.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/300 at 2b90a30 (2026-11-23).
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=tests/touchfiles.test.ts] Base issue: detectBaseBranch tests read an inherited TOUCHFILES_BASE

- **Base issue:** present at merge base `6293d8c`; filed under `blocking=shown`
- **Description:** Two `detectBaseBranch` cases fail when the caller's environment sets `TOUCHFILES_BASE`, which CLAUDE.md recommends for running a release-metadata delta. The cases do not clear the variable before probing.
- **Evidence:** `TOUCHFILES_BASE=HEAD bun test tests/touchfiles.test.ts -t detectBaseBranch` failed both cases at the merge base, and the same command without the variable passed.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `tests/touchfiles.test.ts:281`
- **Revisit when:** a Track next changes the test selector or its tests.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/300 at 2b90a30 (2026-11-23).
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=bin/lib/preamble.sh|tests/preamble.test.ts] Test gap: Verify digest provider fallbacks

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The shell selects between sha256sum, shasum and openssl. The existing fixtures inherit the host hash programs.
- **Hypothesis (untested):** Run the launcher with each fallback exposed in turn and verify the same digest. Then remove all providers and check the missing-reference result without body bytes.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `bin/lib/preamble.sh`.
- **Evidence:** The normal SHA-256 path and stale digest fixtures passed. The audit reproduced no failure.
- **Context:** Track 94I PR A coverage audit at `56fc549` (2026-11-23).
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=scripts/skill-references.ts|tests/skill-references.test.ts] Test gap: Reject ambiguous manifest move entries

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** Conservation fixtures cover missing navigation text and reordered blocks. They lack overlapping ranges, repeated navigation text and a heading lookalike inside a fence.
- **Hypothesis (untested):** Add those manifest inputs to the existing fixture and verify that invalid moves never produce a changed core.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `scripts/skill-references.ts`.
- **Evidence:** The manifest checks and conservation cases were inspected. The audit reproduced no failure.
- **Context:** Track 94I PR A coverage audit at `56fc549` (2026-11-23).
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=scripts/skill-references.ts|tests/skill-references.test.ts] Test gap: Exercise the maintainer reference CLI in a fixture

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The reviewed branch ran apply, check and digests in place. Automated coverage exercises the exported transformation rather than the CLI selection and write gates.
- **Hypothesis (untested):** Use a small fixture repository to show that digests defaults to a read-only check and that --write refreshes only the selected pointers.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `scripts/skill-references.ts`.
- **Evidence:** The real apply, check and digest commands returned exit 0 on the current candidate. The audit reproduced no failure.
- **Context:** Track 94I PR A coverage audit at `56fc549` (2026-11-23).
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=skills/review-and-prep.md|tests/helpers/skill-budgets.ts] Test gap: Measure the complete default review read sequence

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The cumulative budget uses references selected by the reader map. The default scratch probe stops at Step 2 before review and receipt assembly.
- **Hypothesis (untested):** Compare the fetched reference set from a complete successful by-hand run with the representative budget after rollout.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `skills/review-and-prep.md`.
- **Evidence:** The early default gate passed and the static path budget is 196,467 bytes. The audit reproduced no failure.
- **Context:** Track 94I PR A coverage audit at `56fc549` (2026-11-23).
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=skills/review-and-prep.md|skills/references/review-and-prep/conditional-greptile-run.md|tests/skill-protocols-review-and-prep.test.ts] Test gap: Exercise the Greptile once hold through resume

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The protocol locks cover the reservation, statuses and fallback. The scratch gate set does not walk a consumed request that remains incomplete across resume.
- **Hypothesis (untested):** Use a disposable scenario with a recorded request and unverifiable completion. Check that resume holds the draft and submits no new request.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `skills/review-and-prep.md`.
- **Evidence:** The applicable guard and published shapes were inspected. The item repository has no root Greptile configuration. The audit reproduced no failure.
- **Context:** Track 94I PR A coverage audit at `56fc549` (2026-11-23).
- **Effort:** ? (user triages in `/roadmap`)

## Completed

### [manual] Cut repeated review work in /review-and-prep without changing gstack

- **Why:** Repeated reviewer fan-out on the whole branch diff is most of a review's usage. Private review observations found repeated whole-branch sweeps, lower usage in a repair-only continuation, and later full sweeps whose specialists returned no findings. The defects came from the native adversarial pass and the outside voices. When `/review` stops at its three-cycle cap (`converged:false`), `/review-and-prep` has no instruction at all, so a person decides each continuation ad hoc.
- **Effort:** M (~560 lines incl. tests)
- **Priority:** P2
- **Context:** Owner request, 2026-10-20; plan `plans/2026-10-20-review-and-prep-repeat-work.md` in the project's gstack notes. Scope, wrapper-only: (1) a cycle-stop exit that commits and pushes the draft, writes a STOPPED receipt, never runs a fourth pass or a new `/review` in that invocation, and prints a continuation prompt for a fresh session; an optional, versioned caller policy line (`Review policy: review-and-prep-policy/v1; in-cap=delta|full; continuation=repair-only|full|stop; documentation-audit=final; full-suite=final; max-continuations=<n>`) that the prompt carries verbatim, which hand runs omit (they get a three-option question instead), and which never waives a gate; documented as the additive H-E continuation shape in `docs/workflow-handoffs.md`. (2) Delta-scoped wrapper re-reviews, opt-in through that policy or a direct request: substitute the last reviewed commit for every diff and scope command of the nested `/review` so gstack's own gates pick reviewers for the delta, record each skip with gstack's reason, keep the native adversarial pass and the outside challenge, and use full scope for conflicted base merges, scope changes, rewritten history and unknown dependencies. (3) Final messages restate no receipt or matrix; long evidence goes to files; independent Step 1 reads run in parallel. (4) A local-only `voices.jsonl` naming each reviewer subagent's host identifier and parent-observed dispatch/return times, never in the PR body. (5) With `in-cap=delta` and a passing drift check (the installed `/review` still carries the exact Step 5.8 text it narrows), `/review`'s own cycles 2–3 review only the previous cycle's fixes: a dangling snapshot commit built through a temporary index marks each cycle's candidate, gstack's gates pick reviewers for the delta, specialists whose findings were fixed are force-included, the native adversarial pass and the outside challenge run every cycle, and the receipt records each delta cycle as a partial pass. A failed drift check runs `/review` unmodified. Upstream will not change Step 5.8, so the wrapper carries this opt-in. Apply (3) and (4) to `/ship-and-land`'s own readers. No gstack file changes; gstack's cycle cap and stop, specialist prompts, outside voice, parser and documentation-audit bound stay as they are. MINOR under the 0.x policy. Proposed `_touches:` `skills/review-and-prep.md`, `skills/ship-and-land.md`, `docs/workflow-handoffs.md`, `docs/telemetry.md`, `tests/skill-protocols.test.ts`, `tests/handoff-contract.test.ts`, `tests/fixtures/handoffs/`, `tests/workflow-metrics.test.ts`, `tests/helpers/touchfiles.ts` (collides with Tracks 26A and 27A). Track 30A can consume the join file; Track 31A keeps its section-loading and voice-yield questions. Changes no review gate by default.
- **Completed:** v0.38.0.0 (2026-10-21). The stop, continuation prompt, opt-in delta review, and local reviewer join are in the wrapper skills, the handoff contract, and the tests. Installed-agent proof of a real continuation stays on the first post-release run. The separate default-flip comparison stays open.

### [review] install-safety.sh reads ownership through GNU stat's -f output

- **Description:** `bin/lib/install-safety.sh:_path_owner_uid` runs `stat -f '%u' path || stat -c '%u' path`. With GNU coreutils ahead of `/usr/bin` in PATH, GNU `stat -f` prints file-system details and fails, the fallback appends the uid, and the captured value no longer equals `id -u`. Every host directory then fails the ownership check, so setup skips all hosts. Track 23C's own stat calls try BSD `-f` first and keep the output only when it has the expected shape, otherwise use `-c` (`setup:_is_stat_id`, `_is_stat_size`); reuse that pattern here. This pre-existing helper sits outside that track's files.
- **Effort:** S (human: ~30min / CC: ~10min)
- **Context:** Found during Track 23C review and prep on 2026-10-09 while confirming the same ordering bug in the new install-status code. A probe with `/opt/homebrew/bin/gstat` first in PATH showed the multi-line capture.
- **Priority:** P2
- **Revisit when:** The next change to `bin/lib/install-safety.sh`, or a report of setup skipping every host on a machine with GNU coreutils on PATH.
- **Completed:** v0.36.5.0 (2026-10-09). The impact was wider than described: every stock GNU/Linux host has refused every skills directory since v0.18.14.0. `_path_owner_uid` now asks GNU `stat -c` first and falls back to BSD `stat -f`. That needs no shape check, because BSD `stat -c` fails with empty stdout. Stat-shim unit tests cover both flavors, foreign-uid refusal and unreadable ownership.

### [investigate] The Cursor and quota sentence overstates what the store reader can read

- **Symptom:** `docs/telemetry.md` section "Cursor and quota" says local native SDK runs supply model and effort when readable, otherwise null. The live Conductor store shape is never readable by `cursor_turns()`, so the null is structural, not an occasional miss. A reader can think a null model means the run did not name one.
- **Repro:** Read the "Cursor and quota" paragraph, then run the repro on `cursor_turns() cannot read the Conductor store shape`. The store record's `model.id` is `grok-4.7` while the reader returns no turn. Update the sentence, and link `docs/designs/review-independence.md` from that section. Track 16B does not edit `docs/telemetry.md`.
- **Effort:** S (human: ~1h / CC: ~15min)
- **Priority:** P2
- **Depends on:** The reader fix above, or a doc change that describes the current failure without waiting for it. Owner of `docs/telemetry.md`. Track 16A had not corrected this sentence as of 2026-09-25.
- **Context:** `docs/designs/review-independence.md` section 8.
- **Completed:** v0.32.1.0 (2026-09-28). The Cursor section now says the current reader cannot parse numeric timestamps and list-valued model parameters, so model and effort stay null even when the store names a model, and it links the review-independence evidence. The separate `cursor_turns()` reader TODO stays open.

### [manual] Native Cursor host installation
- **Description:** Add `setup --host cursor` and auto-detection through the Cursor command or home directory. Generate native skill copies with ownership-safe refresh and uninstall, verified home-root probes, and telemetry pointer discovery.
- **Scope:** Included in Track 16D's PR #113 on 2026-09-25. This explicitly expands its original fence to `setup`, the two additional telemetry-only skills, `tests/telemetry.test.ts`, and the canonical blocks in `docs/telemetry.md`; coordinate the setup overlap with Track 16E during review and prep.
- **Decision:** When `cursor` is on PATH but `~/.cursor` is absent, create the skill directory. When Cursor is absent, leave it absent. Strip `allowed-tools` as Codex does.
- **Review decisions (2026-09-26):** Setup preserves a `SKILL.md` symlink that points outside a gstack-extend checkout on every host, skips Cursor when `~/.cursor/skills` is another host's skills directory, and in `--host auto` skips a detected host whose skills directory fails the install-path check. Track 16D's `_touches:` now lists the Cursor files. Track 16E shipped first (#110), so `setup` merged cleanly. The resulting Group 16 COLLISIONS and PACKING failures (shared `docs/telemetry.md` with 16A, and 16E still listed in Current Plan) are deferred by the user to the next `/roadmap` run.
- **Completed:** v0.29.4.0 (2026-09-26)

### [manual] Keep gstack-extend independent of the maintainer's personal tooling
- **Description:** gstack-extend should stand on its own. Its features must be usable by any caller, and no shipped artifact (code, docs, tests, TODOS entries, CHANGELOG, commit or PR text) should require or name the maintainer's private orchestrator or personal cross-machine tooling. Reword references generically and add a consumer-agnostic rule to `CLAUDE.md`.
- **Effort:** S (human: ~2h / CC: ~15min)
- **Priority:** P2
- **Context:** Raised by the maintainer on 2026-09-23 during /autoplan of the quota ledger (plan requirements G-01 and G-02).
- **Completed:** v0.29.0.0 (2026-09-24). Discharged at /roadmap@a646c94: no live `*.md`/`*.py`/`*.ts`/`*.sh`/`setup` artifact names the tooling, `CLAUDE.md` carries the "Consumer independence" section, and the P0 inbox entries already read "an external consumer". A local-only regression check is by design never committed. Release history in CHANGELOG, PROGRESS, and roadmap-shipped was left as-is at discharge, then reworded to generic cross-machine wording on this branch.

### [manual] Quota ledger, with Cursor capacity as an open question

- **Description:** Nothing measures quota spent per stage per configuration; all current figures are wall-clock. Codex and Claude expose readable remaining-capacity endpoints. The Grok Build endpoint is unusable for this purpose because Grok now runs through Cursor (`cursor-agent` or natively in Conductor). Whether Cursor capacity is readable, and whether the CLI and Conductor routes share a pool, are open questions. Acceptance requires evidence of consumption attributable to stage and configuration, documented capacity-read results and pool relationships, and distinct model-vendor and capacity-pool fields: review independence follows the vendor, while capacity follows the pool, which may serve several vendors. A failed capacity read must degrade to a local consumption ledger and must never be interpreted as "no quota."
- **Effort:** L (human: ~3d / CC: ~1.5h; provisional pending planning)
- **Priority:** P0
- **Depends on:** None
- **Context:** Unblocks 4 downstream tracks for an external consumer, making this the most blocking of the four P0 dependencies. A separate planning session is underway; this entry records the problem and required acceptance evidence, leaving the design to that session.
- **Completed:** v0.29.0.0 (2026-09-24)

### Failed-ledger retry with non-semver NEW aborts the helper

**What:** Do not call `version_gt` / `semver_lte` unless NEW is semver. If NEW is `unknown` (or any letter-bearing string), skip the compare and either retry every failed name or leave them queued.

**Why:** After 15B, the window skip refuses non-semver OLD/NEW, then the failed-ledger path still calls `semver_lte VER unknown`. Under `set -u`, `(( 1 > unknown ))` is unbound and the EXIT trap kills the helper before the retry runs.

**Context:** Red-team finding after v0.24.5.0 landed (PR #96). Reproduced: `bash -c 'set -u; bi=unknown; (( 1 > bi ))'`. File: `bin/lib/run-migrations.sh` failed-path `semver_lte`. No production `migrations/v*.sh` yet — fix before the first real script.

**Effort:** S
**Priority:** P1
**Depends on:** None
**Completed:** v0.24.6.0 (2026-08-15)

### Setup-fail after pull drops in-window migrations forever

**What:** Persist the pre-pull version (or pre-register in-window names into `migrations-failed`) before `./setup`. A later `update-run` must still see those names when OLD==NEW.

**Why:** Pull advances VERSION, then setup can exit 1 (`no bun`, install-safety). The helper never runs. Next hop reads OLD==NEW, so unstarted in-window scripts are not in the failed ledger and never execute. Same hole if the helper aborts mid-scan.

**Context:** Red-team finding after v0.24.5.0. Not the deferred first-hop chicken-and-egg (old binary missing the call site). This is every post-15B hop whose helper does not finish after VERSION already moved. `bin/update-run` setup is ~line 122; helper only runs if setup returned.

**Effort:** S
**Priority:** P1
**Depends on:** None
**Completed:** v0.24.6.0 (2026-08-15)

### Helper-path tests before the first real `v*.sh`

**What:** Add fixtures for: helper missing-args / missing semver.sh / bad-version; empty `migrations/` (`.gitkeep` only); symlink and non-semver name skip; fail-then-succeed clears `migrations-failed`; unexpected helper abort emits `MIGRATION_WARN helper`.

**Why:** Post-ship coverage audit scored 69% on the 15B hook. Those branches are how the two P1 holes hide. Tests should exist before any install-mutating script ships.

**Context:** Coverage audit after PR #96. Do not file each gap as its own item. Bundle lives here; implement with the P1 fixes.

**Effort:** S
**Priority:** P2
**Depends on:** The two P1 upgrade items above (same PR is fine)
**Completed:** v0.24.6.0 (2026-08-15)
