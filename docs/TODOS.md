# TODOS

## Unprocessed

### [review:files=src/review-state/cli.ts|src/review-state/show.ts|tests/review-state.test.ts] Test gap: Show duplicate and valueless option refusals
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** The show boundary lacks explicit duplicate/missing --base and --wtree assertions.
- **Hypothesis (untested):** Extend the existing show invalid-option table with otherwise-valid requests that violate one option rule. Re-verify the contract before writing the test.
- **Upstream severity:** INFORMATIONAL.
- **Found in:** src/review-state/cli.ts (coverage audit G04).
- **Evidence:** Read-only coverage trace at `13592e3`; no failure reproduced for this gap. Existing plan and handoff checks passed (1465 pass, 3 skip); this entry records uncovered assertions, not a failing product case.
- **Context:** Filed by /review-and-prep on branch `mmm/288aaf53` at `13592e3` (2026-11-13); PR not created yet.
- **Revisit when:** the next Track touches the tagged source paths.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-state/show.ts|tests/review-state.test.ts] Test gap: Show applicable open reviewer status
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** Show tests assert selected and not-applicable voices, but not an applicable unselected voice.
- **Hypothesis (untested):** Add an applicable unselected reviewer and assert status open at the CLI boundary. Re-verify the contract before writing the test.
- **Upstream severity:** INFORMATIONAL.
- **Found in:** src/review-state/show.ts (coverage audit G11).
- **Evidence:** Read-only coverage trace at `13592e3`; no failure reproduced for this gap. Existing plan and handoff checks passed (1465 pass, 3 skip); this entry records uncovered assertions, not a failing product case.
- **Context:** Filed by /review-and-prep on branch `mmm/288aaf53` at `13592e3` (2026-11-13); PR not created yet.
- **Revisit when:** the next Track touches the tagged source paths.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-state/show.ts|tests/review-state.test.ts] Test gap: Show repeated gate and audit ordering
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** Current show fixtures use unique gate/audit names; overwrite and first-seen ordering are not asserted.
- **Hypothesis (untested):** Interleave repeated names and verify the latest value wins while first-seen name order remains. Re-verify the contract before writing the test.
- **Upstream severity:** INFORMATIONAL.
- **Found in:** src/review-state/show.ts (coverage audit G14).
- **Evidence:** Read-only coverage trace at `13592e3`; no failure reproduced for this gap. Existing plan and handoff checks passed (1465 pass, 3 skip); this entry records uncovered assertions, not a failing product case.
- **Context:** Filed by /review-and-prep on branch `mmm/288aaf53` at `13592e3` (2026-11-13); PR not created yet.
- **Revisit when:** the next Track touches the tagged source paths.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-state/show.ts|tests/review-state.test.ts] Test gap: Show implicit evidence digest integrity
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** Show evidence tests delete explicit evidence but do not tamper pregate record_path or documentation section_path.
- **Hypothesis (untested):** Tamper each implicit reference independently and require evidence_ok false. Re-verify the contract before writing the test.
- **Upstream severity:** INFORMATIONAL.
- **Found in:** src/review-state/show.ts (coverage audit G16).
- **Evidence:** Read-only coverage trace at `13592e3`; no failure reproduced for this gap. Existing plan and handoff checks passed (1465 pass, 3 skip); this entry records uncovered assertions, not a failing product case.
- **Context:** Filed by /review-and-prep on branch `mmm/288aaf53` at `13592e3` (2026-11-13); PR not created yet.
- **Revisit when:** the next Track touches the tagged source paths.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-state/render.ts|src/review-state/show.ts|tests/review-state.test.ts] Test gap: Show corrected unresolved dispositions
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** Show/renderer parity uses one uncorrected open finding; correction suppression at the show boundary lacks direct assertions.
- **Hypothesis (untested):** Exercise corrected adjudication, resolution and receipt-class suppression with independent expected blocker lists. Re-verify the contract before writing the test.
- **Upstream severity:** INFORMATIONAL.
- **Found in:** src/review-state/render.ts (coverage audit G18).
- **Evidence:** Read-only coverage trace at `13592e3`; no failure reproduced for this gap. Existing plan and handoff checks passed (1465 pass, 3 skip); this entry records uncovered assertions, not a failing product case.
- **Context:** Filed by /review-and-prep on branch `mmm/288aaf53` at `13592e3` (2026-11-13); PR not created yet.
- **Revisit when:** the next Track touches the tagged source paths.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-state/show.ts|tests/review-state.test.ts] Test gap: Show rendered discovery exclusions and failures
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** The rendered listing test covers ordinary files and one prefix, not unsafe/nonregular exclusions, multiple prefixes or enumeration failure.
- **Hypothesis (untested):** Extend the existing fixture with mixed prefixes and excluded entries; verify declared behavior under a directory enumeration failure. Re-verify the contract before writing the test.
- **Upstream severity:** INFORMATIONAL.
- **Found in:** src/review-state/show.ts (coverage audit G20).
- **Evidence:** Read-only coverage trace at `13592e3`; no failure reproduced for this gap. Existing plan and handoff checks passed (1465 pass, 3 skip); this entry records uncovered assertions, not a failing product case.
- **Context:** Filed by /review-and-prep on branch `mmm/288aaf53` at `13592e3` (2026-11-13); PR not created yet.
- **Revisit when:** the next Track touches the tagged source paths.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-state/state.ts|tests/review-state.test.ts] Test gap: Interrupted end timestamp across helper record kinds
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** The winning helper timestamp in the current resume test is a gate; the other stamped collections and fallback lack independent winners.
- **Hypothesis (untested):** Vary the latest helper-stamped collection and timestamp precision, ignoring caller timestamps, and verify fallback to segment start when no record is newer. Re-verify the contract before writing the test.
- **Upstream severity:** INFORMATIONAL.
- **Found in:** src/review-state/state.ts (coverage audit G27).
- **Evidence:** Read-only coverage trace at `13592e3`; no failure reproduced for this gap. Existing plan and handoff checks passed (1465 pass, 3 skip); this entry records uncovered assertions, not a failing product case.
- **Context:** Filed by /review-and-prep on branch `mmm/288aaf53` at `13592e3` (2026-11-13); PR not created yet.
- **Revisit when:** the next Track touches the tagged source paths.
- **Effort:** ? (user triages in /roadmap)


### [review:files=src/secret-dispositions/cli.ts|src/secret-dispositions/evaluate.ts|tests/secret-dispositions.test.ts] Requalify failed-pregate evaluation after upstream added-line API drift

- **Classification:** non-blocking and filed; owner quote: "2 yes".
- **Description:** Installed gstack 1.99.2.0 returns added-line parts with `texts`, while the existing evaluator expects `text`. A raw failing secrets record therefore exits 2 with unavailable evidence. This preserves fail-closed behavior; clean records do not collect added lines. No compatibility change is included in this scan-text task.
- **Evidence:** The continuation's first preflight found a synthetic basic-auth URL in a rejection test; its untouched evaluator returned an unavailable-evidence error. Earlier opt-in pregate cases also reported this pre-existing API drift. Raw results are retained privately.
- **Revisit when:** the next Track changes pregate evaluation or requalifies it against the installed upstream API.

### [review:files=src/secret-dispositions/cli.ts|tests/secret-dispositions.test.ts] Test gap: Exercise remaining filesystem and scanner refusal paths

- **Test gap:** non-blocking and filed; owner quote: "2 yes"; source: coverage-audit.
- **Description:** Missing/nonexecutable/symlinked scanners, missing/directory/symlinked inputs and non-root cwd have no dedicated boundary assertions. The audit found no failing behavior; preserve this as informational coverage depth.
- **Upstream severity:** INFORMATIONAL; no demonstrated regression.
- **Context:** PR https://github.com/kbitz/gstack-extend/pull/248, full continuation coverage audit, 2026-11-13.
- **Revisit when:** the next Track changes filesystem or scanner validation.

### [review:files=skills/review-and-prep.md|tests/skill-protocols-review-and-prep.test.ts] Test gap: Exercise attended PR-text routing and scanner fallback

- **Test gap:** non-blocking and filed; owner quote: "2 yes"; source: coverage-audit.
- **Description:** CLI and content tests do not prove an agent applies verified invocation context, records scanner JSON and uses the exit-1 fallback for every public write. Use an attended synthetic flow when evaluating these instructions.
- **Upstream severity:** INFORMATIONAL; no demonstrated regression.
- **Context:** PR https://github.com/kbitz/gstack-extend/pull/248, full continuation coverage audit, 2026-11-13.
- **Revisit when:** the PR-text routing instructions or the attended workflow evaluation harness is changed.

### [review:files=src/secret-dispositions/scan-text.ts|skills/review-and-prep.md] Review follow-up: Review comment-number binding in copied PR text

- **Classification:** non-blocking and filed; owner quote: "2 yes".
- **Description:** The approved grammar accepts any ASCII digit run after a verified current-PR comment prefix. Reviewers propose tighter identity or length binding for copied text; no leak outside the documented context was demonstrated.
- **Source:** full re-review of PR https://github.com/kbitz/gstack-extend/pull/248, 2026-11-13.
- **Action:** backlog only; no implementation or informational correction.
- **Revisit when:** PR-text provenance or the supported GitHub comment-ID binding changes.

### [review:files=src/secret-dispositions/cli.ts|tests/secret-dispositions.test.ts] Review follow-up: Exercise scratch-root rejection with an existing directory

- **Classification:** non-blocking and filed; owner quote: "2 yes".
- **Description:** The scratch-root negative fixture is absent, so it reaches the missing-directory refusal rather than isolating strict-below validation. The implementation rejects the root correctly and no required test fails; this is coverage depth only.
- **Source:** full re-review of PR https://github.com/kbitz/gstack-extend/pull/248, 2026-11-13.
- **Action:** backlog only; no implementation or informational correction.
- **Revisit when:** the next Track touches validation tests or the scratch-root rule.

### [review:files=docs/TODOS.md] Review follow-up: Clarify the origin of recorded backlog whitespace

- **Classification:** non-blocking and filed; owner quote: "2 yes".
- **Description:** A reviewer reads the prior spacing note’s word existing as relative to the PR base, while it was recorded during this continuation. Track that provenance wording for a later editorial pass; the existing note and spacing are not corrected here.
- **Source:** full re-review of PR https://github.com/kbitz/gstack-extend/pull/248, 2026-11-13.
- **Action:** backlog only; no implementation or informational correction.
- **Revisit when:** a dedicated backlog-formatting or review-note editing pass is requested.

### [review:files=src/secret-dispositions/cli.ts|docs/secret-dispositions.md] Review follow-up: Clarify the scanner binary symlink requirement

- **Classification:** non-blocking and filed; owner quote: "2 yes".
- **Description:** The CLI rejects a symlink in the scanner binary leaf. The documented regular-executable requirement can be made more explicit in a future docs change. Current installed binaries work and unsupported layouts fail closed.
- **Source:** full re-review of PR https://github.com/kbitz/gstack-extend/pull/248, 2026-11-13.
- **Action:** backlog only; no implementation or informational correction.
- **Revisit when:** scanner installation ownership or this CLI documentation is next revised.

### [review:files=src/secret-dispositions/scan-text.ts|tests/secret-dispositions.test.ts] Review follow-up: Recheck scan-text boundaries when upstream separator patterns change

- **Classification:** non-blocking and filed; owner quote: "2 yes".
- **Description:** Current installed patterns use single explicit ASCII separators; whitespace/runs hypothesis is not demonstrated. No current blocker.
- **Source:** carried /review-and-prep findings, PR https://github.com/kbitz/gstack-extend/pull/248; full continuation 2026-11-13.
- **Action:** backlog only; no implementation change under the owner’s convergence rule.
- **Revisit when:** upstream pii.cc or pii.phone.e164 patterns or normalization change.

- **Additional filed hypotheses:** an upstream normalizer that strips more Cf characters, or a phone pattern that combines adjacent closing/opening parentheses. The installed normalization list omits the proposed Cf removal; all four combined-parenthesis examples produce no direct finding (repair-proof capture011). Keep these for the same upstream-change revisit trigger.

### [review:files=src/secret-dispositions/cli.ts|skills/review-and-prep.md] Review follow-up: Review immutable PR-text input assumptions

- **Classification:** non-blocking and filed; owner quote: "2 yes".
- **Description:** A concurrent private-body writer was not identified; no dropped finding reproduced. Preserve as a contract question.
- **Source:** carried /review-and-prep findings, PR https://github.com/kbitz/gstack-extend/pull/248; full continuation 2026-11-13.
- **Action:** backlog only; no implementation change under the owner’s convergence rule.
- **Revisit when:** caller permits shared/mutable PR-text files or adds concurrent writers.

### [review:files=src/secret-dispositions/cli.ts|skills/review-and-prep.md] Review follow-up: Revisit masked-copy cleanup on hard termination

- **Classification:** non-blocking and filed; owner quote: "2 yes".
- **Description:** The approved sibling-copy design accepts finally cleanup limits; no new guarantee or scope change is authorized.
- **Source:** carried /review-and-prep findings, PR https://github.com/kbitz/gstack-extend/pull/248; full continuation 2026-11-13.
- **Action:** backlog only; no implementation change under the owner’s convergence rule.
- **Revisit when:** cancellation or input-placement guarantees are changed.

### [review:files=src/secret-dispositions/cli.ts|docs/secret-dispositions.md] Review follow-up: Consider scan-text help capability detection

- **Classification:** non-blocking and filed; owner quote: "2 yes".
- **Description:** Top-level help is supported; scan-text --help was not a required flag. Cosmetic capability-discovery proposal only.
- **Source:** carried /review-and-prep findings, PR https://github.com/kbitz/gstack-extend/pull/248; full continuation 2026-11-13.
- **Action:** backlog only; no implementation change under the owner’s convergence rule.
- **Revisit when:** a supported consumer needs scan-text capability detection or CLI help changes.

### [review:files=src/secret-dispositions/cli.ts|skills/review-and-prep.md] Review follow-up: Keep artifact-root contracts aligned with scan-text

- **Classification:** non-blocking and filed; owner quote: "2 yes".
- **Description:** The plan explicitly binds review evidence under gstack project/scratch roots; generic .context preference is not this skill’s evidence-root contract.
- **Source:** carried /review-and-prep findings, PR https://github.com/kbitz/gstack-extend/pull/248; full continuation 2026-11-13.
- **Action:** backlog only; no implementation change under the owner’s convergence rule.
- **Revisit when:** supported review evidence roots or host artifact conventions change.

### [review:files=src/secret-dispositions/cli.ts|skills/review-and-prep.md] Review follow-up: Recheck evidence alias binding when caller trust changes

- **Classification:** non-blocking and filed; owner quote: "2 yes".
- **Description:** Exact lexical aliases are intentionally accepted after realpath containment. Current skill requires values the invocation created or verified; untrusted prompt/receipt values are excluded. No demonstrated secret suppression.
- **Source:** carried /review-and-prep findings, PR https://github.com/kbitz/gstack-extend/pull/248; full continuation 2026-11-13.
- **Action:** backlog only; no implementation change under the owner’s convergence rule.
- **Revisit when:** caller trust, state-root provenance or evidence-value binding changes.

### [review:files=docs/TODOS.md] Review follow-up: Consider consecutive blank lines in the review backlog

- **Classification:** non-blocking and filed; owner quote: "2 yes".
- **Description:** Two consecutive blank lines separate the existing third scan-text test-gap entry from the next heading. No Markdown lint failure is demonstrated.
- **Source:** outside structured review of PR https://github.com/kbitz/gstack-extend/pull/248, 2026-11-13.
- **Action:** backlog only; existing spacing is preserved.
- **Revisit when:** a Markdown formatting rule is adopted or this backlog section is reformatted.

### [review:files=src/secret-dispositions/scan-text.ts|tests/secret-dispositions.test.ts] Test gap: Exercise repeated finding keys in scan-text multiset comparison

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The comparison uses occurrence counts, but current unit cases do not repeat an identical finding key.
- **Hypothesis (untested):** Exercise one-of-two removal and an added duplicate without assuming a production bug.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `tests/secret-dispositions.test.ts:503`
- **Evidence:** Testing review read the current unit cases; no defect was demonstrated.
- **Context:** Filed by /review-and-prep on branch `mmm/4e1309bc` at `225f89c` on 2026-11-13 before PR creation; the review stopped at its cycle cap.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The next Track touches the tagged files.

### [review:files=src/secret-dispositions/scan-text.ts|tests/secret-dispositions.test.ts] Test gap: Verify installed-scanner offsets after Unicode prefixes

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Installed scanning covers Unicode boundaries after a run value, but not astral or punctuation prefixes before it.
- **Hypothesis (untested):** Place an astral character and an em dash before a bound path and check the documented UTF-16 mapping against the installed scanner.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/secret-dispositions/scan-text.ts:63`
- **Evidence:** Adversarial review identified missing coverage; installed lineColAt uses UTF-16 offsets and no defect was reproduced.
- **Context:** Filed by /review-and-prep on branch `mmm/4e1309bc` at `225f89c` on 2026-11-13 before PR creation; the review stopped at its cycle cap.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The next Track touches the tagged files.

### [review:files=src/secret-dispositions/cli.ts|tests/secret-dispositions.test.ts] Test gap: Observe masked scan file permissions and basename

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Cleanup is tested, but the double does not observe the directory mode, file mode or basename during the second scan.
- **Hypothesis (untested):** Record metadata on the second scanner call and verify 0700, 0600 and the original basename alongside cleanup.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `tests/secret-dispositions.test.ts:695`
- **Evidence:** Testing review read the explicit chmod/write/basename code; no product defect was demonstrated.
- **Context:** Filed by /review-and-prep on branch `mmm/4e1309bc` at `225f89c` on 2026-11-13 before PR creation; the review stopped at its cycle cap.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The next Track touches the tagged files.


### [review:files=src/outside-review/prompt.ts|tests/outside-review.test.ts] Test gap: Observe the corrected outside prompt on a real authorized review

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** Unit and installed-classifier cases prove the requested reply order and parsing, but not that a real model follows the candidate prompt. The saved reviews used the installed pre-fix prompt and were accepted by the owner as this PR's coverage exception.
- **Hypothesis (untested):** On the next authorized review using the updated installation, retain both actual reply endings and credited status without a formatting retry.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/outside-review/prompt.ts:16`
- **Evidence:** Read-only coverage audit: 12 of 14 named paths covered; this is an unmeasured live-compliance path, not a failed candidate run. The user forbids new outside calls in this continuation.
- **Context:** Filed by /review-and-prep on 2026-11-12 before PR creation; approved plan already identifies next-real-run observation as a limitation.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The next real outside review runs after this prompt is installed.

### [review:files=src/review-delegate/delegate.ts|tests/review-delegate.test.ts] Test gap: Observe the corrected delegate prompt on a real authorized review

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** Parser and installed-classifier tests preserve every finding for corrected replies, but no real delegate has run this candidate's shared closing instructions. Prior delegate fallback evidence used the older installed prompt.
- **Hypothesis (untested):** On the next authorized delegated review using the updated installation, retain a compliant final verdict, credited outcome and all returned findings without resending a malformed reply.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-delegate/delegate.ts:178`
- **Evidence:** Read-only coverage audit: the live-compliance path is unmeasured; no new code defect was reproduced. The user forbids new outside calls in this continuation.
- **Context:** Filed by /review-and-prep on 2026-11-12 before PR creation; this follow-up does not expand this PR's approved test obligations.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The next real delegated review runs after the shared closing instructions are installed.

### [review:files=src/review-delegate/delegate.ts|docs/delegated-review.md] Revisit delegate verdict and finding consistency

- **Description:** The parser accepts either exact final verdict token while preserving every finding. Consider checking token/content consistency or explicitly documenting that upstream owns the verdict. This is the approved optional-token contract, not a demonstrated lost-finding defect.
- **Classification:** Non-blocking observation under `blocking=shown`; filed at the owner's direction after accepting the saved outside coverage.
- **Source severity:** P3 (both outside voices); INFORMATIONAL (adversarial and red-team).
- **Evidence:** Saved outside reviews of `f669f5c`, the optional-token parser cases, and host preservation probe. Artifact digests are retained in the private owner coverage exception; no response was reformatted or resent.
- **Context:** Owner quote: "Yes to all"; user directed filing remaining observations on 2026-11-12. Changing the current parser contract needs a separate decision.
- **Revisit when:** The next Track changes delegate reply validation or verdict semantics.

### [review:files=src/review-delegate/delegate.ts|docs/delegated-review.md] Revisit formatted final verdict acceptance

- **Description:** Upstream can credit a decorated verdict that the delegate parser rejects, such as a bold verdict line. The current strict parser deliberately falls back on the whole reply rather than losing findings. Reassess that formatting boundary with retained model outputs before loosening it.
- **Classification:** Non-blocking observation under `blocking=shown`; an explicitly accepted limitation of this plan.
- **Source severity:** P3 (outside challenge).
- **Evidence:** Saved outside challenge of `f669f5c`; current parser and rejection test enforce exact trimmed tokens.
- **Context:** Filed at the user's direction after the owner's "Yes to all" coverage exception; this PR preserves the strict parser.
- **Revisit when:** A real delegated reply falls back solely because its final verdict is decorated, or the next Track changes format recovery.

### [review:files=tests/outside-review.test.ts|tests/review-delegate.test.ts] Reassess the shared last-line classifier fixture

- **Description:** Both suites contain an inline subset of the upstream last-line classifier. Consider a shared TypeScript fixture if a later classifier change must update both, preserving their adapter and parser assertions. Inline fixtures were explicitly required by this plan; no current drift was demonstrated.
- **Classification:** Non-blocking maintenance observation under `blocking=shown`.
- **Source severity:** P3 (both outside voices).
- **Evidence:** Saved outside reviews of `f669f5c`; both inline fixtures and installed-classifier cases were inspected and the selected suite passed.
- **Context:** Filed at the user's direction after the owner's "Yes to all" coverage exception; no helper extraction in this PR.
- **Revisit when:** The next Track changes either mirrored classifier rule.

### [review:files=tests/outside-review.test.ts|tests/review-delegate.test.ts] Version-qualify optional installed-classifier expectations

- **Description:** The legacy rejected shape accepts either pre-1.99 or 1.99 reason codes, while the new installed assertions document 1.99+ behavior. Consider making each optional installed check's supported version explicit without treating a fixture as live provider acceptance.
- **Classification:** Non-blocking observation under `blocking=shown`; broader installed-version requalification remains outside this plan.
- **Source severity:** P3 (both outside voices); CRITICAL (adversarial claim, retained without downgrade).
- **Evidence:** Current installed 1.99.1.0 run fixes the two owned failures and retains only five baseline failures. Host probes credit corrected clean/advisory/blocking replies on pinned `e2fffee3`; no production compatibility defect was shown.
- **Context:** Filed at the user's direction after the owner's "Yes to all" coverage exception. Reading new non-TypeScript inputs in tests still requires the normal touchfile-map audit.
- **Revisit when:** The next Track requalifies the adapter against another installed gstack version.

### [review:files=src/outside-review/prompt.ts|src/outside-review/recovery.ts] Clarify closing instructions for missing-context replies

- **Description:** Consider stating explicitly whether a `NEEDS_CONTEXT` reply should omit a verdict, since the normal closing instructions precede the missing-context instruction. Current recovery rejects missing-context and refusal replies even with a final clean token; no false credit was reproduced.
- **Classification:** Non-blocking wording observation under `blocking=shown`; preserve the current recovery guard.
- **Source severity:** P3 (outside challenge); INFORMATIONAL (red-team); CRITICAL (adversarial claim disproved by the host probe).
- **Evidence:** Host probe rejects six missing-context/refusal shapes across both installed gates; saved outside challenge acknowledges that guard. Artifact digests remain in the private coverage exception.
- **Context:** Filed at the user's direction after the owner's "Yes to all" coverage exception; no new outside model call or local reformat.
- **Revisit when:** The next Track revises closing prompt instructions or missing-context handling.

### [review:files=docs/review-run-state-calls.md|skills/review-and-prep.md] Clarify non-ID run-state fence refusal recovery

- **Description:** The saved outside reviews request explicit recovery instructions for run-state unreadable and cycle-1-pass refusals, plus disambiguation of voice and probe identifiers. No stalled run or fabricated state was demonstrated; existing D1 fallback remains the current rule.
- **Classification:** Non-blocking observation under `blocking=shown`; filed at the owner's direction after accepting the saved outside coverage.
- **Source severity:** P2 (structured), P3 (challenge); retained without downgrade.
- **Evidence:** Saved challenge/structured reviews of `69540ab`; provider artifacts and their SHA-256 digests are bound in the private owner-accepted coverage exception. No new outside call or reply reformat.
- **Context:** Owner quote: "accept the reviews"; review-and-prep resumed on 2026-11-12 before PR creation.
- **Revisit when:** Re-evaluate this wording when the next Track edits the caller procedure or Track 79A evaluates degraded runs.

### [review:files=docs/review-run-state-calls.md|skills/review-and-prep.md] Clarify unavailable caller-document activation under version skew

- **Description:** The saved outside reviews note no explicit fallback for a missing or unreadable calls document or missing derive helper while the loaded skill is newer. No supported installation failure was demonstrated. Preserve the current activation contract until the follow-up validates the skew case.
- **Classification:** Non-blocking observation under `blocking=shown`; filed at the owner's direction after accepting the saved outside coverage.
- **Source severity:** P3 (both outside voices); retained without downgrade.
- **Evidence:** Saved challenge/structured reviews of `69540ab`; provider artifacts and their SHA-256 digests are bound in the private owner-accepted coverage exception. No new outside call or reply reformat.
- **Context:** Owner quote: "accept the reviews"; review-and-prep resumed on 2026-11-12 before PR creation.
- **Revisit when:** Revisit when installation/version-skew support or run-state activation changes.

### [review:files=docs/review-run-state-calls.md|skills/review-and-prep.md] Verify activation timing before suppressing Step 1 spans

- **Description:** The challenge asks whether helper-missing activation can suppress Step 1 evidence/scope spans before falling back to the inline path. This is an unproven measurement edge; d8 intentionally omits those spans on the recorded path. No live failure or review-output defect was shown.
- **Classification:** Non-blocking observation under `blocking=shown`; filed at the owner's direction after accepting the saved outside coverage.
- **Source severity:** P3 (challenge); retained without downgrade.
- **Evidence:** Saved challenge/structured reviews of `69540ab`; provider artifacts and their SHA-256 digests are bound in the private owner-accepted coverage exception. No new outside call or reply reformat.
- **Context:** Owner quote: "accept the reviews"; review-and-prep resumed on 2026-11-12 before PR creation.
- **Revisit when:** Revisit when Track 79A measures activation failures or the next Track edits Step 1 capture.

### [review:files=docs/review-run-state-calls.md|skills/review-and-prep.md] Measure capture loss when the first derive cannot bind

- **Description:** The structured voice notes that start/first-derive failure leaves no metrics run. The approved plan explicitly accepts this loss and capture=partial rather than mixing inline and derived writers. Retain it as a measurement limitation, not an approval to change fallback in this PR.
- **Classification:** Non-blocking observation under `blocking=shown`; filed at the owner's direction after accepting the saved outside coverage.
- **Source severity:** P3 (structured); retained without downgrade.
- **Evidence:** Saved challenge/structured reviews of `69540ab`; provider artifacts and their SHA-256 digests are bound in the private owner-accepted coverage exception. No new outside call or reply reformat.
- **Context:** Owner quote: "accept the reviews"; review-and-prep resumed on 2026-11-12 before PR creation.
- **Revisit when:** Revisit at Track 79A degraded-path measurement or a caller-fallback redesign.

### [review:files=skills/review-and-prep.md|docs/designs/review-run-state.md] Measure the always-loaded run-state pointer and fence overhead

- **Description:** The structured voice observes that the new opt-in pointer, policy bullet and fence grow loaded skill text. These additions are the approved T1-T3 approach; record their size and real-run cost alongside the on-demand procedure in the existing Track 79A comparison. No default behavior or correctness defect is shown.
- **Classification:** Non-blocking observation under `blocking=shown`; filed at the owner's direction after accepting the saved outside coverage.
- **Source severity:** P3 (structured); retained without downgrade.
- **Evidence:** Saved challenge/structured reviews of `69540ab`; provider artifacts and their SHA-256 digests are bound in the private owner-accepted coverage exception. No new outside call or reply reformat.
- **Context:** Owner quote: "accept the reviews"; review-and-prep resumed on 2026-11-12 before PR creation.
- **Revisit when:** Revisit when Track 79A measures the default/record arms or changes the loading strategy.


### [review:files=skills/review-and-prep.md|docs/review-run-state-calls.md] Test gap: Installed opt-in run-state caller journey
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Static locks and native helper fixtures do not establish installed-agent adherence to the opted-in lifecycle. This is the existing Track 79A measurement follow-on, not a new release requirement.
- **Hypothesis (untested):** At Track 79A, retain real opted-in activation, start/derive, voice/probe recording, pause/resume, failure retry/degraded capture and finish evidence with unchanged outward lines.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `docs/review-run-state-calls.md:17`
- **Evidence:** Read-only coverage audit on `69540ab`; no failed installed-agent run demonstrated and no fixture result is claimed as live acceptance.
- **Context:** Filed by /review-and-prep on 2026-11-12 before PR creation; accepted follow-on remains Track 79A.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** Track 79A measures the first installed opted-in caller run or the next Track touches these files.

### [review:files=tests/skill-protocols-review-and-prep.test.ts|skills/review-and-prep.md] Test gap: Malformed run-state fence inputs
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Structurally invalid parsed state/pass objects are not directly exercised by the new fence integration case.
- **Hypothesis (untested):** Extend existing fence fixture with one invalid-shape input per guard, retaining refusal exit and no-write assertions. Re-verify the current contract first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `tests/skill-protocols-review-and-prep.test.ts:1`
- **Evidence:** Read-only coverage audit on `69540ab`; no failure reproduced. The existing 21 targeted suites passed.
- **Context:** Filed by /review-and-prep on 2026-11-12 before PR creation; outside structured coverage is unverified.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The next Track touches these files.

### [review:files=tests/skill-protocols-review-and-prep.test.ts|skills/review-and-prep.md] Test gap: First full cycle-one pass selection
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The required first-in-record-order selection has no multiple-pass fixture.
- **Hypothesis (untested):** Add two matching full cycle-one passes with different prerequisites and require the first to govern. Re-verify the current contract first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `tests/skill-protocols-review-and-prep.test.ts:1`
- **Evidence:** Read-only coverage audit on `69540ab`; no failure reproduced. The existing 21 targeted suites passed.
- **Context:** Filed by /review-and-prep on 2026-11-12 before PR creation; outside structured coverage is unverified.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The next Track touches these files.

### [review:files=tests/skill-protocols-review-and-prep.test.ts|skills/review-and-prep.md] Test gap: Failed-attempt voice result
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The approved any-attempt result branch is not exercised independently of selection.
- **Hypothesis (untested):** Record a failed attempt without voice-complete and verify that it counts as a result without claiming successful review. Re-verify the current contract first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `tests/skill-protocols-review-and-prep.test.ts:1`
- **Evidence:** Read-only coverage audit on `69540ab`; no failure reproduced. The existing 21 targeted suites passed.
- **Context:** Filed by /review-and-prep on 2026-11-12 before PR creation; outside structured coverage is unverified.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The next Track touches these files.

### [review:files=tests/skill-protocols-review-and-prep.test.ts|skills/review-and-prep.md] Test gap: Not-applicable voice result
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The explicit not-applicable result branch has no direct fence case.
- **Hypothesis (untested):** Record a not-applicable voice and verify that no attempt is required for that prerequisite. Re-verify the current contract first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `tests/skill-protocols-review-and-prep.test.ts:1`
- **Evidence:** Read-only coverage audit on `69540ab`; no failure reproduced. The existing 21 targeted suites passed.
- **Context:** Filed by /review-and-prep on 2026-11-12 before PR creation; outside structured coverage is unverified.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The next Track touches these files.

### [review:files=tests/skill-protocols-review-and-prep.test.ts|skills/review-and-prep.md] Test gap: Probe gate candidate binding
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** A same-name probe gate on a different candidate has no negative test.
- **Hypothesis (untested):** Extend the real fixture with a different candidate and require the original baseline write to refuse. Re-verify the current contract first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `tests/skill-protocols-review-and-prep.test.ts:1`
- **Evidence:** Read-only coverage audit on `69540ab`; no failure reproduced. The existing 21 targeted suites passed.
- **Context:** Filed by /review-and-prep on 2026-11-12 before PR creation; outside structured coverage is unverified.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The next Track touches these files.

### [review:files=bin/lib/telemetry.py|tests/telemetry.test.ts] Test gap: Opt-in derive help statement
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The changed derive help statement has live QA evidence but no permanent assertion.
- **Hypothesis (untested):** Extend the existing help checks to require the experimental opt-in caller statement and exit zero. Re-verify the current contract first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `bin/lib/telemetry.py:1`
- **Evidence:** Read-only coverage audit on `69540ab`; no failure reproduced. The existing 21 targeted suites passed.
- **Context:** Filed by /review-and-prep on 2026-11-12 before PR creation; outside structured coverage is unverified.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The next Track touches these files.


### [review:files=docs/designs/review-run-state.md] File the review-run-state SPEC anchor correction for the next design edit

- **Description:** The documentation audit found the opening link targets the prior O6 heading anchor. The current SPEC heading is O6: Bounded, measured stage effort. This source-pointer issue does not alter the documented helper behavior or D9 wire derivations.
- **Classification:** non-blocking and filed; owner convergence approval "Approved". Leave the design unchanged in this continuation.
- **Source severity:** Low / documentation audit.
- **Context:** PR #238, initial documentation audit on cb15aff.
- **Revisit when:** The next edit to docs/designs/review-run-state.md, or Track 77B adoption.

### [review:files=docs/designs/review-run-state.md] File the D9 status-vocabulary source-heading correction

- **Description:** D9 cites a PR body status vocabulary heading that no longer exists. The vocabulary currently lives under Receipt layout and kept marker set in docs/workflow-handoffs.md. The derivation bytes were verified; only the source locator is stale.
- **Classification:** non-blocking and filed; owner convergence approval "Approved". Leave the design unchanged in this continuation.
- **Source severity:** Low / documentation audit.
- **Context:** PR #238, initial documentation audit on cb15aff.
- **Revisit when:** Track 78A consumes D9, or that producer section is renamed.


### [review:files=src/review-state/state.ts] Pass completion remains a recording fact until renderers enforce review coverage

- **Description:** Carried review suggested refusing incomplete required-voice closure. D1/D5 assign workflow judgment to skill prose and D13 deliberately allows recording completed passes without voice selection; no current recorder contract is broken.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** INFORMATIONAL (original red-team and native adversarial notes)
- **Context:** PR #238 repair-only continuation; carried: incomplete pass closure / explicit N-A selection.
- **Revisit when:** Track 78A starts rendering readiness or a skill begins treating a completed recorded pass as sufficient review coverage.

### [review:files=src/review-state/state.ts] Clarify composite replay identity and global attempt-ID uniqueness before export

- **Description:** Carried review contrasted composite pass/voice/attempt replay keys with global uniqueness refusal. Different composite keys are distinct requests; no immutable replay defect remains. Keep the distinction explicit when a caller is written.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** Original label not present in the compact carried disposition; original review artifacts retained; no severity inferred
- **Context:** PR #238 repair-only continuation; carried: reused attempt ID under another voice/pass.
- **Revisit when:** Track 77B projects attempts to workflow metrics or a real caller needs to reuse an attempt UUID across voices.

### [review:files=docs/designs/review-run-state.md] Define rendered-line handling for Unicode separators

- **Description:** Carried review raised C1/Unicode line separators. D7 currently forbids C0 and DEL, and this Track ships no receipt renderer; no forged output is produced by this helper.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** INFORMATIONAL (original red-team note)
- **Context:** PR #238 repair-only continuation; carried: C1 / Unicode line separators.
- **Revisit when:** Track 78A writes the first receipt/handoff renderer.

### [review:files=src/review-state/store.ts] Revisit evidence-root exclusions when a skill chooses directories

- **Description:** Carried review proposed excluding ancestor and sibling worktree roots in addition to D2's current-worktree exclusion. The skill currently owns selecting a dedicated per-invocation directory; stricter exclusions change that location contract.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** INFORMATIONAL (original red-team note)
- **Context:** PR #238 repair-only continuation; carried: ancestor/sibling evidence directory.
- **Revisit when:** Track 77B selects the first live run directory, or a real run places state in an ancestor or sibling checkout.

### [review:files=src/review-state/store.ts] Revisit isolated Git account configuration for trusted repositories

- **Description:** Carried review noted global/system Git configuration is disabled. D2 now discloses this experimental limitation; no supported local-owner run requiring safe.directory was demonstrated.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** INFORMATIONAL (original red-team and native adversarial notes)
- **Context:** PR #238 repair-only continuation; carried: global Git config.
- **Revisit when:** A real intended-user repository requires account-level safe.directory configuration, or helper adoption in Track 77B expands that support contract.

### [review:files=src/review-state/store.ts] Distinguish Git execution failures from invalid commit input at adoption

- **Description:** The carried red-team note concerns existing timeout, spawn and signal failures being reported as commit-not-found or not-ancestor, plus inaccessible-input diagnostics. Git calls already have a five-second timeout; D14 defers an internal-error envelope. No incorrect successful record or data loss was demonstrated.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** INFORMATIONAL (original red-team note)
- **Context:** PR #238 repair-only continuation; carried: Git timeouts and input diagnostics.
- **Revisit when:** Track 77B writes a caller that must distinguish transient Git execution errors from invalid input, or a real run needs structured internal-error recovery.

### [review:files=src/review-state/store.ts] Define dot-suffixed directory symlink policy

- **Description:** Outside challenge P2/Low and structured P3/Low noted --dir /link/. resolves through link. D2 permits symlinked ancestors and the literal final component here is dot; realpath confinement remains enforced. Clarify the intended normalization boundary before changing accepted paths.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** P2/Low (outside challenge); P3/Low (outside structured); INFORMATIONAL confidence5 (red-team); CRITICAL confidence7 (native-adversarial)
- **Context:** PR #238 repair-only continuation; outside:challenge / outside:structured; red-team INFORMATIONAL confidence5; native-adversarial CRITICAL confidence7.
- **Revisit when:** Track 77B adopts the helper, or a real caller supplies dot-suffixed evidence paths.

### [review:files=src/review-state/store.ts] Choose stable supplied-versus-resolved state-path spelling for callers

- **Description:** Outside challenge P3/Low noted early refusals use the supplied state path and later outcomes use the real path. No existing caller or D8 requirement compares these spellings; rendering/adoption is deferred.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** P3/Low (outside challenge); INFORMATIONAL confidence3 (native-adversarial)
- **Context:** PR #238 repair-only continuation; outside:challenge; native-adversarial INFORMATIONAL confidence3.
- **Revisit when:** Track 77B writes a caller that consumes state_path, especially with a symlinked home or ancestor directory.

### [review:files=src/review-state/state.ts] Extend stored-state lifecycle consistency checks before foreign-state support

- **Description:** Outside challenge P3/Low noted manually inconsistent pass state and completion timestamps can satisfy independent field types. D3 currently promises keys, types and internal references; no helper-produced inconsistent state was demonstrated.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** P3/Low (outside challenge); INFORMATIONAL confidence6 (red-team); CRITICAL confidence5 (native-adversarial)
- **Context:** PR #238 repair-only continuation; outside:challenge; red-team INFORMATIONAL confidence6; native-adversarial CRITICAL confidence5.
- **Revisit when:** Track 77B adds compatibility or another writer, or Track 79A supports recovering edited/corrupt state.

### [review:files=tests/review-state.test.ts] Strengthen explicit correction replay binding assertions when fixtures change

- **Description:** Outside challenge P3/Low flagged nullish fallbacks in the correction head/tree assertion. Existing tests change Git binding and the reader requires these fields; no missed current defect or unmet plan-required test was demonstrated.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** P3/Low (outside challenge)
- **Context:** PR #238 repair-only continuation; outside:challenge.
- **Revisit when:** The correction fixture or replay binding changes next, or a demonstrated regression survives the current test.

### [review:files=tests/review-state.test.ts] Exercise writer-to-reader boundary parity beyond current cases

- **Description:** Outside structured P3/Low could not demonstrate a writer/reader mismatch at PR strings, required voices, attribution, coverage thresholds or Greptile values. Challenge also suggested string thresholds, nonempty skipped lanes and model-label edges; keep these as unproven coverage work.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** P3/Low (outside structured); INFORMATIONAL confidence6 (red-team); CRITICAL confidence5 (native-adversarial)
- **Context:** PR #238 repair-only continuation; outside:structured / outside:challenge residual coverage note; red-team INFORMATIONAL confidence6; native-adversarial CRITICAL confidence5.
- **Revisit when:** Track 77B adds a caller or schema compatibility, or a real boundary input produces an unreadable helper-written state.

### [review:files=tests/review-state.test.ts] Keep Git-binding test fixtures independent of account identity

- **Description:** Outside structured P3/Low questioned whether makeEmptyRepo configures repository-local identity; tests/helpers/fixture-repo.ts does so. No current fixture failure is demonstrated. Retain the concern only for future fixture-helper changes.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** P3/Low (outside structured)
- **Context:** PR #238 repair-only continuation; outside:structured.
- **Revisit when:** makeEmptyRepo or Git-binding subprocess setup stops providing repository-local user.name/user.email.

### [review:files=src/review-state/store.ts] Make evidence-cache misses explicit when collectors evolve

- **Description:** The red team raised a fail-open cache-miss hypothesis. Current request validators and collectors use relative paths and exact hashes consistently; no unverified current record was demonstrated.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** red-team INFORMATIONAL confidence4; native-adversarial INFORMATIONAL confidence3
- **Context:** PR #238 repair-only continuation; red-team INFORMATIONAL confidence4; native-adversarial INFORMATIONAL confidence3.
- **Revisit when:** Track 77B changes canonicalization/evidence collection, or a real accepted record lacks a verified evidence pair.

### [review:files=src/review-state/state.ts] Preserve source JSON-path diagnostics for merged detail evidence

- **Description:** The red team inferred that merging detail references with the evidence array can produce synthetic indexes in a refusal. Current refusals still reject invalid evidence and preserve bytes; no incorrect successful record was demonstrated.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** red-team INFORMATIONAL confidence5
- **Context:** PR #238 repair-only continuation; red-team INFORMATIONAL confidence5.
- **Revisit when:** Pinned evidence diagnostics or the details collector changes next, or a real caller cannot identify a failed detail pin.

### [review:files=tests/review-state.test.ts] Assert that the pinned-tree fixture actually advances HEAD

- **Description:** The red team noted the no-wait fixture does not separately assert advance() ran. Current code does execute the injected advance; this is a future regression-detection weakness, not a demonstrated current defect or a missing plan-required test.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** red-team INFORMATIONAL confidence7
- **Context:** PR #238 repair-only continuation; red-team INFORMATIONAL confidence7.
- **Revisit when:** runGit changes process API/argv shape or the Git binding fixture is edited.

### [review:files=src/review-state/state.ts] Check stored-reader narrowing when adding a TypeScript compile gate

- **Description:** The adversarial voice reported a possible strict TypeScript closure-narrowing error at d.parts.includes. Bun runs this code, the repo has no typecheck script/dependency/gate, and the approved plan requires Bun tests; no currently required check fails.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** native-adversarial CRITICAL confidence4 (fixability label; owner non-blocking)
- **Context:** PR #238 repair-only continuation; native-adversarial CRITICAL confidence4 (fixability label; owner non-blocking).
- **Revisit when:** Track 77B imports this reader into compiled TypeScript, or the project adopts a strict typecheck gate.

### [review:files=src/review-state/store.ts] Revisit branch and commit sampling under concurrent checkout changes

- **Description:** The adversarial voice raised a branch-switch race between symbolic-ref and HEAD reads. The repaired contract pins a captured commit/tree after lock wait; no intended-use failure under concurrent workspace branch switching was demonstrated.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** native-adversarial CRITICAL confidence3 (unshown race hypothesis)
- **Context:** PR #238 repair-only continuation; native-adversarial CRITICAL confidence3 (unshown race hypothesis).
- **Revisit when:** A live caller permits concurrent checkout/branch changes, or a real run records mismatched branch/head.

### [review:files=src/review-state/state.ts] Define schema compatibility before the first skill adopts the helper

- **Description:** The adversarial voice noted required additive fields retain the v1 schema name. This helper is new on an unreleased feature branch and no skill calls it; D14 explicitly assigns cross-version compatibility to Track 77B. Do not add a migration in Track 76B.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** native-adversarial INFORMATIONAL confidence5
- **Context:** PR #238 repair-only continuation; native-adversarial INFORMATIONAL confidence5.
- **Revisit when:** Track 77B ships the first caller or a subsequent release must read state from an earlier adopted helper.


### [review:files=src/review-state/cli.ts|tests/review-state.test.ts] Test gap: CLI flag refusals and error envelopes
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Duplicate and missing-value flags, plus exact one-line JSON, two-line stderr and exit-code agreement.
- **Hypothesis (untested):** Extend existing CLI rejection cases using otherwise valid input and exact stream/exit assertions. Re-verify the current contract first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-state/cli.ts:57`
- **Evidence:** Read-only coverage audit on `cecc16b`; no failure reproduced for this gap. The six gaps are separate from the repaired, demonstrated canonicalization defect.
- **Context:** Filed by `/review-and-prep` on 2026-11-10 at `cecc16b`, before the draft's cycle-cap receipt.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** CLI parsing or error-envelope behavior changes, or Track 77B begins calling the helper.


### [review:files=src/review-state/state.ts|tests/review-state.test.ts] Test gap: Attempt and finding semantic refusals
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Validly typed but inconsistent predecessor, duplicate finding/attempt, part, delegate outcome and attribution combinations.
- **Hypothesis (untested):** Add table rows that break one relationship guard while every shape and parent reference remains valid. Re-verify the current contract first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-state/state.ts:407`
- **Evidence:** Read-only coverage audit on `cecc16b`; no failure reproduced for this gap. The six gaps are separate from the repaired, demonstrated canonicalization defect.
- **Context:** Filed by `/review-and-prep` on 2026-11-10 at `cecc16b`, before the draft's cycle-cap receipt.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** Attempt schemas, attribution or delegation wiring changes.


### [review:files=src/review-state/state.ts|tests/review-state.test.ts] Test gap: Voice selection semantic refusals
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Both/neither completion selectors and selection of a missing or failed attempt.
- **Hypothesis (untested):** Extend the existing voice fixture with one invalid selector/reference per row. Re-verify the current contract first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-state/state.ts:485`
- **Evidence:** Read-only coverage audit on `cecc16b`; no failure reproduced for this gap. The six gaps are separate from the repaired, demonstrated canonicalization defect.
- **Context:** Filed by `/review-and-prep` on 2026-11-10 at `cecc16b`, before the draft's cycle-cap receipt.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** Voice completion or selected-attempt handling changes.


### [review:files=src/review-state/state.ts|tests/review-state.test.ts] Test gap: Correction chain semantic refusals
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Missing finding targets, stale supersedes, invalid effective adjudication/resolution and a missing fixed_in commit.
- **Hypothesis (untested):** Reuse the populated correction fixture and assert caller refusal plus unchanged bytes for each case. Re-verify the current contract first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-state/state.ts:522`
- **Evidence:** Read-only coverage audit on `cecc16b`; no failure reproduced for this gap. The six gaps are separate from the repaired, demonstrated canonicalization defect.
- **Context:** Filed by `/review-and-prep` on 2026-11-10 at `cecc16b`, before the draft's cycle-cap receipt.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** Correction targeting, supersedes or effective-state handling changes.


### [review:files=src/review-state/state.ts|tests/review-state.test.ts] Test gap: Finish ancestry and checkpoint field refusals
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Nonancestor finish base, missing delta/full-review commit, resume on an open run and a non-resume checkpoint carrying session_id.
- **Hypothesis (untested):** Use isolated Git histories and table-driven checkpoint/finish requests, asserting the specific violation. Re-verify the current contract first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-state/state.ts:623`
- **Evidence:** Read-only coverage audit on `cecc16b`; no failure reproduced for this gap. The six gaps are separate from the repaired, demonstrated canonicalization defect.
- **Context:** Filed by `/review-and-prep` on 2026-11-10 at `cecc16b`, before the draft's cycle-cap receipt.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** Track 79A resume/finish integration begins, or checkpoint/finish validation changes.


### [review:files=src/review-state/store.ts|tests/review-state.test.ts] Test gap: Temporary-state and postcommit failure handling
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Temporary write/fsync/rename failures and lock-removal failure after the rename commit point; existing tests inject lock initialization failure only.
- **Hypothesis (untested):** Extend isolated subprocess fault injection: precommit failures preserve old bytes and clean owned files; postcommit unlink failure reports recorded with warnings. Re-verify the current contract first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-state/store.ts:150`
- **Evidence:** Read-only coverage audit on `cecc16b`; no failure reproduced for this gap. The six gaps are separate from the repaired, demonstrated canonicalization defect.
- **Context:** Filed by `/review-and-prep` on 2026-11-10 at `cecc16b`, before the draft's cycle-cap receipt.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** A live caller depends on recorder recovery, or temporary commit/cleanup handling changes.

### [review:files=tests/quota_cases.py|bin/lib/quota/index.py|bin/lib/quota/cli.py] Test gap: Exercise a complete pre-upgrade native SDK store
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The legacy route test seeds native source and usage facts and finishes with the current code. It does not seed a fully persisted historical run, receipt and file checkpoint with the old source key and root metadata.
- **Hypothesis (untested):** Prepare a finished store using the old reader, then query it after upgrade with the retired files unreadable. Compare the route and token totals and verify no retired-file rescan. Re-verify the contract first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `tests/quota_cases.py:1291`
- **Evidence:** Outside reviews and coverage audit source reads; the current legacy-readback test and selected suites pass, and no product defect was reproduced. The approved T2 fixture is complete; this is additional hardening.
- **Context:** Filed by `/review-and-prep` on 2026-11-10 at `088b064`, before draft creation at the external full-suite gate.
- **Effort:** ? (user triages in /roadmap)

### [review:files=bin/lib/quota/index.py|tests/quota_cases.py] Test gap: Ignore retired NDJSON filenames inside active roots
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The retirement test plants the old SDK directory outside supported roots. It does not separately put a `runs.ndjson` file beside a supported JSONL log inside an active root.
- **Hypothesis (untested):** Extend the existing fixture with both files and assert that only the supported log is indexed. Re-verify the discovery contract first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `bin/lib/quota/index.py:54`
- **Evidence:** Coverage audit path 05; source inspection confirms the filename clause was removed, existing discovery tests pass, and no failure was reproduced.
- **Context:** Filed by `/review-and-prep` on 2026-11-10 at `088b064`, before draft creation at the external full-suite gate.
- **Effort:** ? (user triages in /roadmap)

### [review:files=tests/skill-protocols.test.ts] Test gap: Exercise the remaining removed-host detector branches
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The removal lock has synthetic Conductor and `.context/` cases, while an unguarded Paseo mention and the removed marker lack dedicated negative inputs.
- **Hypothesis (untested):** Add cases to the existing detector test that splice each remaining forbidden form into a skill and verify its reported violation. Re-verify the matcher first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `tests/skill-protocols.test.ts:1047`
- **Evidence:** Outside challenge and coverage audit source reads; the current tests pass and no detector defect was reproduced.
- **Context:** Filed by `/review-and-prep` on 2026-11-10 at `107b814`, before draft creation at the external full-suite gate.
- **Effort:** ? (user triages in /roadmap)

### [review:files=tests/handoff-contract.test.ts] Test gap: Lock the contract's optional Paseo provider paragraph
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The contract test locks the honored ownership row and its three skill sections; it does not separately pin the paragraph retaining Paseo as an optional provider.
- **Hypothesis (untested):** Extend the existing contract test with a provider-paragraph assertion and a deletion case. Re-verify the documented provider contract first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `tests/handoff-contract.test.ts:2295`
- **Evidence:** Outside challenge and coverage audit source reads; the paragraph is present, the contract suite passes, and no product failure was reproduced.
- **Context:** Filed by `/review-and-prep` on 2026-11-10 at `107b814`, before draft creation at the external full-suite gate.
- **Effort:** ? (user triages in /roadmap)

### [review:files=tests/skill-protocols-roadmap.test.ts] Test gap: Exercise contradictory shared-document inputs
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The never-shared test rejects deletion of the required sentence, but does not separately mutate the default shared-docs list or insert a contradictory sharing sentence.
- **Hypothesis (untested):** Add those synthetic inputs to the existing never-shared matcher test, checking each rejection independently. Re-verify the grouping rule first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `tests/skill-protocols-roadmap.test.ts:388`
- **Evidence:** Outside challenge and coverage audit source reads; the current rule and its deletion case pass, and no grouping defect was reproduced.
- **Context:** Filed by `/review-and-prep` on 2026-11-10 at `107b814`, before draft creation at the external full-suite gate.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-state/store.ts|tests/review-state.test.ts] Test gap: Reject nonregular and oversized VERSION files
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Existing VERSION fixtures cover missing, symlinked and malformed files, but do not separately exercise the nonregular-file and 128-byte size guards.
- **Hypothesis (untested):** Extend the existing version fixture with a directory and oversized padded-valid release text, asserting unknown/null fallback. Re-verify the current boundary first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-state/store.ts:13`
- **Evidence:** Read-only coverage audit traced path 07 on `43e5c71`; current targeted tests pass and no failure was reproduced. These cases add hardening beyond the approved T1–T3 required tests.
- **Context:** Filed by `/review-and-prep` on 2026-11-11 at `43e5c71`, before draft creation at the external full-suite gate.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-state/state.ts|tests/review-state.test.ts] Test gap: Classify incompatible state without a local helper version
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The compatibility table supplies a valid local VERSION; it does not combine unavailable local version identity with invalid v1 state naming a newer writer.
- **Hypothesis (untested):** Add that combination to the compatibility fixture and assert that unknown local identity cannot establish writer ordering. Re-verify the documented refusal first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-state/state.ts:908`
- **Evidence:** Read-only coverage audit traced path 15 on `43e5c71`; current compatibility tests pass and no failure was reproduced. This is additional hardening beyond the approved T1–T3 required tests.
- **Context:** Filed by `/review-and-prep` on 2026-11-11 at `43e5c71`, before draft creation at the external full-suite gate.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-state/state.ts|tests/review-state.test.ts] Test gap: Ignore unsafe numeric version ordering
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Current compatibility fixtures use small version components and do not exercise the safe-integer guard during writer-version comparison.
- **Hypothesis (untested):** Extend the existing table with a writer component above Number.MAX_SAFE_INTEGER and verify that it cannot establish version ordering. Re-verify the current contract first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-state/state.ts:165`
- **Evidence:** Read-only coverage audit traced path 16 on `43e5c71`; current version tests pass and no failure was reproduced. This is additional hardening beyond the approved T1–T3 required tests.
- **Context:** Filed by `/review-and-prep` on 2026-11-11 at `43e5c71`, before draft creation at the external full-suite gate.
- **Effort:** ? (user triages in /roadmap)

### [review:files=bin/lib/telemetry.py|tests/workflow-metrics.test.ts] Test gap: Exercise export subprocess failure envelopes
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Derive's export boundary handles launch failure, timeout, malformed JSON and an incompatible export schema; existing tests cover a valid export refusal rather than these subprocess faults.
- **Hypothesis (untested):** Extend the derive boundary fixture with those faults and assert one unavailable response and recovery diagnostic. Re-verify the current boundary first; this would not prove real Bun absence or timing on every host.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `bin/lib/telemetry.py:1966`
- **Evidence:** Read-only coverage audit traced path 16 at `c5c311d`; current targeted checks pass and no failure was reproduced. This is additional fault coverage beyond the approved plan's required tests.
- **Context:** Filed by `/review-and-prep` on 2026-11-11 at `c5c311d`, before draft creation at the external full-suite gate.
- **Effort:** ? (user triages in /roadmap)

### [review:files=bin/lib/telemetry.py|tests/workflow-metrics.test.ts] Test gap: Exercise derived stage-run lock failures
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The blocked completion-marker fixture does not exercise opening or locking an unsafe or unwritable telemetry lock directory.
- **Hypothesis (untested):** Extend the derive fixture with a blocked lock store and verify the lock-failure response without a stage row or escaped error. Re-verify the current boundary first; this would not cover every operating system's locking implementation.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `bin/lib/telemetry.py:2164`
- **Evidence:** Read-only coverage audit traced path 23 at `c5c311d`; current targeted checks pass and no failure was reproduced. This is additional fault coverage beyond the approved plan's required tests.
- **Context:** Filed by `/review-and-prep` on 2026-11-11 at `c5c311d`, before draft creation at the external full-suite gate.
- **Effort:** ? (user triages in /roadmap)

### [review:files=bin/lib/telemetry.py|tests/workflow-metrics.test.ts] Test gap: Exercise post-append provenance marker failures
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Current coverage rejects an unusable completion-marker store before appending; it does not inject an append failure or a marker-save failure after an append succeeds.
- **Hypothesis (untested):** Extend the derive fixture with those faults, checking partial responses and the documented retry side effects. Re-verify the current boundary first; this would not establish crash atomicity between the row and marker files.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `bin/lib/telemetry.py:2159`
- **Evidence:** Read-only coverage audit traced path 24 at `c5c311d`; current targeted checks pass and no failure was reproduced. This is additional fault coverage beyond the approved plan's required tests.
- **Context:** Filed by `/review-and-prep` on 2026-11-11 at `c5c311d`, before draft creation at the external full-suite gate.
- **Effort:** ? (user triages in /roadmap)

### [review:files=bin/lib/telemetry.py|tests/telemetry.test.ts] Test gap: Exercise concurrent derive and finish deduplication
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Sequential derive retries and finish ordering pass, but the suite does not launch simultaneous derive processes or a derive/finish race.
- **Hypothesis (untested):** Add parallel real-CLI launches to the existing isolated telemetry fixture and verify readable metrics and one stage row. Re-verify the locking contract first; this would not establish cross-host filesystem or crash-recovery guarantees.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `bin/lib/telemetry.py:2114`
- **Evidence:** Read-only coverage audit traced user-flow path 30 at `c5c311d`; current targeted checks pass and no race was reproduced. This is additional concurrency coverage beyond the approved plan's required tests.
- **Context:** Filed by `/review-and-prep` on 2026-11-11 at `c5c311d`, before draft creation at the external full-suite gate.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-state/cli.ts|tests/review-state.test.ts] Test gap: Render-specific flag refusals
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Duplicate, missing and unknown render CLI flags.
- **Hypothesis (untested):** Extend the current CLI or fixture tables for this behavior; re-verify first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** src/review-state/cli.ts:1
- **Evidence:** coverage-result.json P02; source/test audit only, no failure reproduced for this gap.
- **Context:** Filed by /review-and-prep for branch `mmm/04e5f191` at `b21bf71` (2026-11-12); PR not created at the external gate.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-state/render.ts|tests/review-state.test.ts] Test gap: Remaining render field and exit combinations
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Remaining field bounds, wrong types and exit-specific final combinations.
- **Hypothesis (untested):** Extend the current CLI or fixture tables for this behavior; re-verify first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** src/review-state/render.ts:1
- **Evidence:** coverage-result.json P06; source/test audit only, no failure reproduced for this gap.
- **Context:** Filed by /review-and-prep for branch `mmm/04e5f191` at `b21bf71` (2026-11-12); PR not created at the external gate.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-state/render.ts|tests/review-state.test.ts] Test gap: Stale audit and latest evidence selection
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Stale coverage/documentation, duplicate-name latest wins and wtree mismatch.
- **Hypothesis (untested):** Extend the current CLI or fixture tables for this behavior; re-verify first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** src/review-state/render.ts:1
- **Evidence:** coverage-result.json P14; source/test audit only, no failure reproduced for this gap.
- **Context:** Filed by /review-and-prep for branch `mmm/04e5f191` at `b21bf71` (2026-11-12); PR not created at the external gate.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-state/render.ts|tests/review-state.test.ts] Test gap: Delegated fallback receipt selection
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Selected versus latest fallback attempt and fallback metadata.
- **Hypothesis (untested):** Extend the current CLI or fixture tables for this behavior; re-verify first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** src/review-state/render.ts:1
- **Evidence:** coverage-result.json P16; source/test audit only, no failure reproduced for this gap.
- **Context:** Filed by /review-and-prep for branch `mmm/04e5f191` at `b21bf71` (2026-11-12); PR not created at the external gate.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-state/render.ts|tests/review-state.test.ts] Test gap: Renderer correction folding
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Correction chains, unrelated targets and rejected/duplicate/classified finding exclusion.
- **Hypothesis (untested):** Extend the current CLI or fixture tables for this behavior; re-verify first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** src/review-state/render.ts:1
- **Evidence:** coverage-result.json P18; source/test audit only, no failure reproduced for this gap.
- **Context:** Filed by /review-and-prep for branch `mmm/04e5f191` at `b21bf71` (2026-11-12); PR not created at the external gate.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-state/render.ts|tests/review-state.test.ts] Test gap: Renderer formatter refusal envelopes
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Missing Greptile and overlong skipped-lane errors.
- **Hypothesis (untested):** Extend the current CLI or fixture tables for this behavior; re-verify first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** src/review-state/render.ts:1
- **Evidence:** coverage-result.json P20; source/test audit only, no failure reproduced for this gap.
- **Context:** Filed by /review-and-prep for branch `mmm/04e5f191` at `b21bf71` (2026-11-12); PR not created at the external gate.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-state/render.ts|tests/review-state.test.ts] Test gap: Renderer summary rejection and normalization
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Empty, marker and paused-phrase summaries plus CRLF normalization.
- **Hypothesis (untested):** Extend the current CLI or fixture tables for this behavior; re-verify first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** src/review-state/render.ts:1
- **Evidence:** coverage-result.json P22; source/test audit only, no failure reproduced for this gap.
- **Context:** Filed by /review-and-prep for branch `mmm/04e5f191` at `b21bf71` (2026-11-12); PR not created at the external gate.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-state/render.ts|tests/review-state.test.ts] Test gap: Renderer collision and owned write failures
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** EEXIST retry/exhaustion and own-file write/fsync failure cleanup.
- **Hypothesis (untested):** Extend the current CLI or fixture tables for this behavior; re-verify first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** src/review-state/render.ts:1
- **Evidence:** coverage-result.json P28; source/test audit only, no failure reproduced for this gap.
- **Context:** Filed by /review-and-prep for branch `mmm/04e5f191` at `b21bf71` (2026-11-12); PR not created at the external gate.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-state/render.ts|tests/review-state.test.ts] Test gap: Renderer Unicode metadata and display paths
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** UTF-8 byte/character counts and home-prefix display boundaries.
- **Hypothesis (untested):** Extend the current CLI or fixture tables for this behavior; re-verify first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** src/review-state/render.ts:1
- **Evidence:** coverage-result.json P29; source/test audit only, no failure reproduced for this gap.
- **Context:** Filed by /review-and-prep for branch `mmm/04e5f191` at `b21bf71` (2026-11-12); PR not created at the external gate.
- **Effort:** ? (user triages in /roadmap)

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
