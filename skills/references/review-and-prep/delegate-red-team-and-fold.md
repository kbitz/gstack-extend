# /review-and-prep reference: Red-team pass, folded specialist checklists, and overlapped cycle-1 reviewers

## From Run a red team where /review has none

**Place and inputs.** Run the step at most once per cycle, after Step 4's core
pass and any specialist parts and before Step 4.7, and never inside the
`first-cycle=overlap` window. Its inputs are:

- the checklist path `<gstack-root>/review/specialists/red-team.md`;
- the already-caught list: the findings the core pass and the specialist parts
  recorded so far this cycle, one line each, because on a review text without
  Review Army the core pass is the review that precedes it;
- diff commands comparing `"<base>" "S"`.

When `delegate=red-team` is active, run it through the runner as **Delegate
named specialist parts** defines. Otherwise dispatch one host subagent whose
extension-owned prompt follows upstream's Red Team dispatch: state the defensive
framing, instruct it to find what the earlier parts missed, read
`<gstack-root>/review/specialists/red-team.md`, inspect fixtures in summary
mode, and output JSON lines in the checklist's schema tagged
`"specialist":"red-team"` or `NO FINDINGS` alone.

**Results.** Findings join Step 5's combine as specialist findings tagged
`red-team` (`found_by: red-team`). Record `red-team` as dispatched in the
`specialists` object, as the sibling rule does for delegated parts. A failed or
timed-out step records the red-team review as incomplete, which is missing
coverage, as upstream states for its Red Team. Every reviewer `/review` selects,
its order, the cap, the stop, `converged`/`cycles`, the provider-failure rule
and upstream's own Red Team (never doubled) are unchanged, and no upstream file
is edited.

**Receipt line.** When the policy carries `red-team=ensure` or `delegate=` names
`red-team`, record one line at all three receipt sites:
`Red team: wrapper (source=<red-team=ensure|delegate=red-team>; cycles=<n>:<ran|not activated|skipped — <reason>>[,...])`,
`Red team: upstream — installed /review carries one` or
`Red team: inactive — <reason>`. A policy carrying both triggers records
`source=red-team=ensure`.

## From Fold specialist checklists into cycle 1

This is a **wrapper override**, not an upstream fork: it changes who applies a
specialist checklist in cycle 1, never a gate of this skill, a checklist or
`/review`'s own text; the one upstream contract item a folded cycle 1 cannot
meet is waived as **Upstream's dispatch item** states. What a caller measures,
and what this value does not claim, is in
[the fold record](https://github.com/kbitz/gstack-extend/blob/main/docs/acceptance/review-fold.md)
(`docs/acceptance/review-fold.md`). If folding ever needs upstream text to
change, record that there and stop; never edit an upstream file.

- **Applies to** a full-scope cycle 1 of an invocation that is not a
  continuation. A continuation's first pass, Step 5's delta re-review and
  `/review`'s cycles 2–3 run as today. Under `in-cap=delta`, a folded finding is
  a main-pass finding, so the delta procedure force-dispatches no specialist
  for it. A cycle where the fold is not applied records
  `Review arm: dispatch — <reason>`.
- **Nested.** Review Army's selection runs as written: scope signals,
  small-diff skip, adaptive gating and force flags. Wherever it would launch a
  subagent for a selected specialist, dispatch nothing. The main pass applies
  that specialist's instructions itself, including the extra steps Review Army
  gives State Machines and Design, and reads each checklist only when it reaches
  it (loaded on demand, never pasted ahead).
- **Sibling.** The sibling `/review` text carries no selection to apply, so the
  main pass reads every listed checklist and applies it as written, including
  its own `Scope:` or `Trigger:` line. The fold adds no Red Team of its own. A
  sibling host that resolves Review Army from its source installation, as Step 1
  allows for a generated copy that omits sections, runs that selection only in
  the dispatch arm.
- **Findings.** Folded findings are the main pass's own findings: the core
  finding format and the core confidence gates (the second `/review` line
  above), combined at Step 5 as core findings. Record each with the checklist
  the main pass was applying when it found the issue, in the per-review
  evidence.
- **Log and gating.** No folded part is ever recorded as dispatched.
  `/review`'s `specialists` object names only parts actually dispatched (the Red
  Team when it ran) and is `{}` with none, as the host-omits-Review-Army lines
  above state. Folded checklist parts add no dispatch sample to upstream's
  adaptive gating; a dispatched Red Team still adds its own sample.
- **Upstream's dispatch item.** Follow **Upstream's dispatch item** in
  **Delegate named specialist parts** for `specialists-dispatched` in a folded
  cycle 1 that applies at least one checklist (waive once after Review Army's
  selection line where one is printed, with `<why>` naming `specialists=fold`
  and the folded checklists; a zero-specialist selection or a later dispatched
  cycle meets the item as upstream defines it).
- **Red Team, restated.** Where the host's `/review` carries a Red Team (including
  sections resolved from its source installation in Step 1), it runs when DIFF_LINES > 200 or the folded pass reports a CRITICAL finding, since no
  specialist dispatch exists to produce one. It is dispatched as `/review`
  defines it, and the folded findings are the "already caught" list it is given.
  On a bounded-wait host it is an activated pass stage, as **Hosts with bounded
  subagent waits** says of cycle 1's conditional dispatch.
- **Unchanged.** The native adversarial pass, the outside voices (including
  **Bound Claude Code outside calls**), the light-default and bounded-wait
  skips, the cap, the stop, `converged`/`cycles` and the completion matrix all
  stay as they are.
- **Activation check.** At Step 1, check every anchor above against the
  installed files: the review file Step 1 resolved, and checklists under the
  gstack root in both layouts (not the sibling `gstack-review` skill directory).
  A changed anchor
  records `Review arm: dispatch — anchor changed (<which>)`, cycle 1 runs as
  today, and no upstream file is edited.
- **Receipt lines:** record the `Review arm:` line and every
  `Folded checklist: <name>; file=<path under the gstack root>; sha256=<64 hex>; findings=<n>`
  line when the policy carries `specialists=fold`
  (`Review arm: fold (cycle 1; layout=<nested|sibling>; checklists=<n>)` or
  `Review arm: dispatch — <reason>`, plus one `Folded checklist:` line per
  checklist read).
  `<name>` is `testing`, `maintainability`, `security`, `performance`,
  `data-migration`, `api-contract`, `simplification`, `state-machines` or
  `design`; `sha256` is the SHA-256 of the file as read. Also write one
  `specialists-dispatched:` line when the section is active:
  `specialists-dispatched: waived (fold; cycles=1; parts=<checklist>[,<checklist>...])`,
  `specialists-dispatched: met (fold; <reason>)`,
  `specialists-dispatched: not declared (fold)` or
  `specialists-dispatched: unmet (fold; waive failed: <cause>)`.
  Apply the delegation section's current-result and mixed-cycle history rule
  to this line too, preserving the folded checklists as the waiver's parts.

## From Overlap independent first-cycle reviewers

This is a **wrapper override**, not an upstream fork: it changes when parts
start in cycle 1, never who reviews, a gate, a checklist or `/review`'s own
text. What a caller measures, and what this value does not claim, is in
[the concurrency record](https://github.com/kbitz/gstack-extend/blob/main/docs/acceptance/review-concurrency.md)
(`docs/acceptance/review-concurrency.md`). If overlapping ever needs upstream
text to change, record that there and stop; never edit an upstream file.

- **Applies to** the original invocation's full-scope cycle 1 only. A
  continuation's first pass, Step 5's delta re-review and `/review`'s cycles
  2–3 run in today's order and record nothing.
- **Activation check.** At Step 1, check every anchor above against the
  installed files: the review file Step 1 resolved, and its adversarial
  instructions (`review/sections/adversarial.md` under the gstack root in the
  nested layout, the review file itself in the sibling layout). A changed
  anchor records `Review overlap: sequential — anchor changed (<which>)`, cycle
  1 runs in today's order, and no upstream file is edited.
- **Preconditions.** Any failure records `Review overlap: sequential — <reason>`
  and runs today's order: `anchor changed (<which>)`; no cycle 1 candidate
  snapshot S (`snapshot unavailable`; the baseline section already takes S
  whenever its anchor is present); `specialists=fold set` or `delegate= set`;
  `host cap (<which>)`, for a host that cannot send several reviewer subagent
  dispatches in one message and run them at once, cannot keep one long command
  running in an owned background session while they run and report its
  completion, states a concurrent-subagent limit below the window's part count,
  or cannot tell; or `inputs not independent (<part>)`, a judgment made from the
  instructions Step 1 already read: each window part's installed prompt takes
  only the diff, its checklist and repository context, never another part's
  findings (an "already caught" list). The Red Team takes the merged specialist
  findings, so it is never in the window's dispatch.
  For the subagent limit, count selected specialists plus the native adversarial
  subagent; check the outside command's concurrent capacity separately.
- **Window,** after Step 4's core pass and Review Army's printed selection
  (`Dispatching N specialists: …`):
  1. Prepare the outside pair's inputs only from what was fixed before this pass
     started: S, the merge base, plan, spec, acceptance obligations and
     repository context. Never include a finding from this pass, core findings
     included. Run Step 4.8's preflight here. Capture every PASS_START token
     (the native attempt and each outside call) before the dispatch message.
  2. Metrics, under the existing rules: the pass `started`, then every window
     voice's `begin` one after another in one Bash call immediately before the
     dispatch message.
  3. One dispatch message holds every selected specialist's Agent call and the
     native adversarial Agent call. Each uses `/review`'s own prompt, and every
     diff, numstat and name-status command compares `"<merge base>" "S"`, as
     the delta procedure tells nested `/review`. The same message starts the
     outside pair as one owned background command. Where **Bound Claude Code
     outside calls** applies, that is its single helper call, unchanged.
     Otherwise it is upstream's outside challenge block, then the structured
     block when `/review`'s size or override gate selects it. Each block runs in
     its own subshell, with its output and exit status in separate files under
     `<evidence-directory>/outside-calls/`, and the command's limit is at least
     1,100 seconds. The pair stays internally sequential. Nothing in the
     background command calls metrics.
     Outside voice spans bound the parent's dispatch-to-observation wait, not
     each call's runtime: the structured span includes its wait for the challenge.
     Preserve the adapter's separate call timestamps for per-call measurements;
     never backdate a metrics boundary or infer a runtime from a wait span.
- **Collection.** Step 4.6 merges the specialist outputs once they settle. The
  Red Team runs on its own gate after that merge, with exactly the inputs
  `/review` gives it. Each voice ends at its own result. Step 4.7's setup and
  probes start only after every reader, including the Red Team and the outside
  pair, has returned or is confirmed stopped, so the work tree stays at S while
  any reader runs. Then compare the work tree with S (the snapshot procedure on
  a temporary index, compared with `S^{tree}`). On a difference, stop before
  any fix as `worktree-changed` does in **Delegate named specialist parts**
  (report it, revert nothing, coverage incomplete) and record
  `Review overlap: stopped — work tree changed during the window`.
- **Unchanged.** Every reviewer `/review` selects runs once. Step 4.8's persist
  rule, the cross-model synthesis and Step 5's combine, Step 5.0 dedup and
  Fix-First all come after collection. The cap, the stop, `converged`/`cycles`
  and the review-log rows are unchanged. So are the cycle-1 baseline's write
  point and completion values (an overlapped cycle 1 is a full-scope cycle 1),
  Greptile-once, the outside-call policy (same calls, same order, once per
  candidate, same call directory), the provider-failure and bounded-wait host
  rules, and the completion matrix. A failed, timed-out, unavailable or
  unverified part is missing coverage as today. It is never re-dispatched while
  it may still run and never replaced by a sequential rerun.
- **Receipt lines,** written only when the policy carries the value:
  `Review overlap: overlapped (cycle 1; parts=<comma-separated parts>; window=<UTC dispatch>–<UTC last return>)`,
  `Review overlap: sequential — <reason>` or
  `Review overlap: stopped — work tree changed during the window`.
  Receipt sites refer to this original-cycle observation. Later cycles create
  no new line. A continuation preserves a corroborated original line only as
  history labelled with its originating invocation and head; if unavailable,
  omit the line and state that the original overlap observation is unavailable.
  Never present a carried window as the continuation's own observation.

<!-- end of skills/references/review-and-prep/delegate-red-team-and-fold.md -->
