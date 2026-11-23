# /review-and-prep reference: Opt-in choices for full-suite, reviewer selection and repair

## From Read an optional review policy

- `in-cap` and `continuation` choose between Step 2 procedures.
  `documentation-audit=final` runs the documentation audit's remaining
  re-audit once, after the last fix batch and before Step 6, never after each
  batch and never a third attempt. `full-suite=final` runs targeted lanes
  between fix batches and the pregate and main suite once on the final content.
  That main-suite run may be a diff selection, which is not the full suite:
  under this policy `/ship-and-land` runs the full suite once on the final head
  before merge.
- `full-suite=external` is an opt-in value of the same key, so one key holds one
  value: `final` and `external` exclude each other, and naming both is the
  repeated key that reads as `none supplied`. Targeted lanes run between fix
  batches, as under `final`. After the last fix batch and the documentation
  audit, the skill freezes the final content and ends its turn at **Pause for
  an external full-suite gate**, leaving the PR unready, so the caller can run
  the full suite on that head and tree outside this session. The pregate still
  runs on an accepted pass, and an attested pass never becomes a `tests` ledger
  record. `/ship-and-land` is unchanged and never pauses; a recorded
  `full-suite=final` keeps its own full run. When the attested command covers
  every test the diff selects, the pregate narrows to its preflight stage as
  **Narrow the pregate after an accepted pass** sets out; any other case runs
  the pregate as today. Capability check:
  `grep -F 'full-suite=external' "<installed skill dir>/SKILL.md"`; to see
  whether the loaded copy narrows, run
  `grep -F 'Narrow the pregate after an accepted pass' "<installed skill dir>/SKILL.md"`
  (exit 1 means an older installation runs the pregate as today, and the policy
  line stays unchanged).
- `documentation-scope=contracts` (its only value) bounds the documentation
  audit's read list and its one re-audit as **Bound the documentation audit**
  defines, keeping the audit's attempt bound. Capability check:
  `grep -F 'documentation-scope=contracts' "<installed skill dir>/SKILL.md"`.
- `post-audit=classify` (its only value) runs **Classify changes after the
  documentation audit's last attempt** on a change made after the audit's last
  attempt before the owner is asked, keeping upstream's attempt bound (never a
  third audit attempt) and never upgrading a blocked audit. Capability check:
  `grep -F 'post-audit=classify' "<installed skill dir>/SKILL.md"`.
- `doc-audit-gap=auto` (its only value) is opt-in and runs **Under
  `doc-audit-gap=auto`** inside **Classify changes after the documentation
  audit's last attempt** when the same line also carries `full-suite=external`
  and `post-audit=classify`, and is otherwise independent. It stays opt-in
  behind this value rather than becoming the default for runs with no policy
  line, light-default runs, or `post-audit=classify`-only runs. The light review
  default never sets it. `auto` turns on all
  three additions together (the `undocumented-internal` class, qualifying base
  merges where Git 2.36 or later supports `--remerge-diff`, and one extra
  documentation audit attempt per review when the pull request edits no SPEC),
  and later values may narrow them, so a caller matches the exact value, not the
  key. When a freshness check would spend a re-audit attempt after an accepted
  (`current` or `updated`) documentation audit in this invocation, active
  `doc-audit-gap=auto` runs the
  single classification rule in **Under `doc-audit-gap=auto`** *before*
  spending a re-audit attempt — taking precedence over
  `documentation-audit=final`'s re-audit dispatch and item 3's later-edit
  re-audit rule when the classification permits reuse — and
  falls back to that same classification rule after a blocked or failed
  re-audit. Its one extra attempt takes precedence over the "never a third attempt"
  wording in the `documentation-audit=final` and `post-audit=classify` bullets.
  Without `full-suite=external` or `post-audit=classify` on the same line, print
  the phase-status warning in **Read an optional review policy** and include one line when assembling the full
  receipt, even when classify never runs:
  `doc-audit-gap: not applied — <full-suite-absent|post-audit-absent> <context>; evidence=<evidence locator>`
  Use `full-suite-absent` if the line lacks `full-suite=external` (including
  `full-suite=final`) and `post-audit-absent` otherwise. Name every missing
  companion in `<context>` and leave the workflow unchanged. On an older
  installation without the value, every key on the line is lost (standard
  defaults, reason recorded, so the gap is asked
  about as before), and an older H-E parser holds a returned policy carrying it
  as `policy-malformed`. It waives no other gate, never narrows or replaces the
  external full suite and never authorizes a continuation. Capability check:
  `grep -F 'doc-audit-gap=auto' "<installed skill dir>/SKILL.md"`.
- `parent-io=lean` (its only value) makes the parent wait in blocking calls,
  each up to the host's cap, with no status or log reads of its own while a
  local command or subagent this invocation started is live (a test lane, the
  pregate, an audit or a reviewer). A wait that returns at the cap with the run
  still live is followed by another blocking wait, never a read. The parent
  reads several files or diffs in one call. A host with no blocking wait keeps
  today's reads. It changes no outcome, gate or bound, and carves out **Bound
  Claude Code outside calls** (that rule's owned session is still polled rather
  than killed at a short shell-tool timeout, and still runs at least 1,100
  seconds), Step 4's Greptile status reads, Step 6's `mergeable` poll and the
  **Hosts with bounded subagent waits**, which keep their own bounds. Capability check:
  `grep -F 'parent-io=lean' "<installed skill dir>/SKILL.md"`.
- `delegate=<part>[,<part>...]` (`testing`, `maintainability`, `performance`,
  `simplification`, `adversarial` and `red-team`, comma-separated, each at most
  once) sends those parts to a provider the caller configured, as **Delegate
  named specialist parts** defines (`adversarial` is the native adversarial pass
  and `red-team` is the Red Team), and a part whose delegate fails runs on the
  host model instead. Security, state-machines, the outside voices and the
  documentation and coverage audits always stay on the host model: a value
  naming any other part (`native-adversarial` and every other name) is an
  unknown value, so the line reads `none supplied` with the reason
  `delegate: <name> is not delegable`. It needs a `Review delegates: <absolute
  path>` line and matching upstream anchors; otherwise every part runs on the
  host as today and the receipt says so. The `Review delegates:` line is one
  invocation-prompt line, read from the same sources as the policy; it names a
  `review-delegates/v1` file, its path is printed in chat and never written to a
  receipt (the receipt records the file's SHA-256 and the provider labels), and
  it is not part of a relayed prompt, so a caller supplies it again beside one.
  Capability check:
  `grep -F 'delegate=<part>' "<installed skill dir>/SKILL.md"`; a caller that
  names `adversarial` or `red-team` also checks
  `grep -F 'delegate=adversarial,red-team' "<installed skill dir>/SKILL.md"`
  (exit 0 means the loaded copy accepts both attacker parts) and drops them from
  the value otherwise, keeping its other parts and keys.
- `red-team=ensure` (its only value) runs **Run a red team where /review has
  none** when the review text the host will execute contains neither `Red Team`
  nor `red-team` and that section's upstream anchors still match; otherwise the
  review runs as today and the receipt says so. Capability check:
  `grep -F 'red-team=ensure' "<installed skill dir>/SKILL.md"`.
- `final-gate-repair=tests-docs` (its only value) lets Step 2's **Repair a
  test-only final-gate failure** run, once per invocation, swapping a review
  cycle for one recorded repair chain that readiness still checks. On an older
  installation without the key, every key on the line is lost (standard
  defaults, reason recorded). Capability check:
  `grep -F 'final-gate-repair=tests-docs' "<installed skill dir>/SKILL.md"`.
- `first-cycle=overlap` (its only value) runs the original invocation's
  full-scope cycle 1 selected specialists, native adversarial pass and outside
  pair at the same time on one frozen snapshot, as **Overlap independent
  first-cycle reviewers** defines, while that section's anchors match and the
  host can run those parts at once; otherwise cycle 1 runs in today's order and
  the receipt says so. With `specialists=fold` or `delegate=` on the same line
  the line still parses and cycle 1 runs in today's order, so each measured arm
  stays separate. `/ship-and-land` is unchanged. Capability check:
  `grep -F 'first-cycle=overlap' "<installed skill dir>/SKILL.md"`.
- `specialists=fold` (its only value) folds the original invocation's
  full-scope cycle 1 so the main review pass reads the selected specialists'
  checklists itself and no specialist subagent is dispatched, as **Fold
  specialist checklists into cycle 1** defines, while that section's upstream
  anchors still match; otherwise cycle 1 dispatches specialists as today and the
  receipt says so. It and `delegate=` exclude each other: a line carrying both
  reads `Review policy: none supplied` with the reason `specialists=fold
  excludes delegate=`, so no part is reviewed twice or not at all. Capability
  check:
  `grep -F 'specialists=fold' "<installed skill dir>/SKILL.md"`.
- `test-gaps=record` (its only value) is opt-in. It records a test-gap finding
  with no demonstrated defect for the next Track that touches its files instead
  of writing a test in this invocation, as **Record unproven test gaps**
  defines, while that section's upstream anchors still match; otherwise today's
  behavior runs and the receipt says so. Capability check:
  `grep -F 'test-gaps=record' "<installed skill dir>/SKILL.md"`.
- `blocking=shown` (its only value) is opt-in. It makes a finding block
  readiness only when shown, as **Block readiness only on shown findings**
  defines, while that section's anchors still match; otherwise today's behavior
  runs and the receipt says so. With `test-gaps=record` a recordable gap still
  takes **Record unproven test gaps**. Capability check:
  `grep -F 'blocking=shown' "<installed skill dir>/SKILL.md"`.
- `repair-review=behavior-changing` (its only value) is opt-in. It opens no
  further review cycle for a repair that changes no behavior (targeted lanes
  and the single final suite cover it, and only behavior-changing repairs feed
  the next `in-cap=delta` cycle), as **Reopen review only for
  behavior-changing repairs** defines, while that section's upstream anchors
  still match; otherwise today's behavior runs and the receipt says so.
  Capability check:
  `grep -F 'repair-review=behavior-changing' "<installed skill dir>/SKILL.md"`.
- `repair-cycles=light` (its only value) is opt-in, needs no `review_default`
  config and makes this invocation take the repair-cycle skips that **Use the
  light review default** states. Without `in-cap` it runs cycles 2–3 through
  the `in-cap=delta` procedure, including its anchor check and full-scope
  fallbacks; an explicit `in-cap=full` wins, so nothing is skipped and the
  receipt says so. A continuation's first pass counts as that invocation's
  cycle 1, and Step 5's delta re-review is its own cycle 1, so neither takes
  the skips. Record each skip as `skipped — light default repair cycle; source:
  repair-cycles=light`, and when `in-cap=full` wins, record
  `repair-cycles=light: nothing skipped — in-cap=full`. It sets no other key.
  Capability check:
  `grep -F 'repair-cycles=light' "<installed skill dir>/SKILL.md"`.

<!-- end of skills/references/review-and-prep/conditional-policy-values.md -->
