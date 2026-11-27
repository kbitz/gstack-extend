# /review-and-prep reference: Review host wait and dispatch details

## From Hosts with bounded subagent waits

Some hosts return a subagent wait at a fixed timeout and cannot stop a running
subagent, and start each subagent with a large context. Muse, for example,
returns waits after 300 seconds, answers cancel with `rejected: not_stoppable`,
and starts each subagent at about 134k input tokens. On a host that documents or
shows this behavior:

- A wait that times out means the subagent is still running, not failed. Do
  other ready work and wait again; never re-dispatch a reviewer that may still
  be running. Once the 15 minutes of provider-failure budget expire, stop
  waiting on still-running subagents and count them as stalled under the
  **Report elapsed time and stop on provider failures**.
- Dispatch a pass's selected reviewers together when the pass starts. Spawn no
  late or speculative reviewer: no replacement while the original may still be
  running, no duplicate voice, and none in case another fails. Cycle 1's
  conditional Red Team dispatch after a specialist CRITICAL finding is an
  activated pass stage, not a speculative replacement.
- Run `/review`'s Red Team on cycle 1 only. Record later cycles' Red Team as
  `skipped — bounded-wait host, cycle 1 only`.

<!-- end of skills/references/review-and-prep/conditional-bounded-reviewer-waits.md -->
