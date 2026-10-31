# External full-suite gate: cost record

Track 48A, recorded against source revision `769d306` plus this Track's
implementation. This record covers prose, fixtures and a test-only model of the
`full-suite=external` pause and resume (see [Grammar H-F](../workflow-handoffs.md#grammar-h-f-external-gate)),
and of `parent-io=lean`. No installed-agent run backs it: a static prose test is
not installed-agent acceptance ([SPEC](../SPEC.md)). It establishes no saving and
awards no checkpoint ([SPEC](../SPEC.md) selected target acceptance and P1).

## Waits it replaces

Without the pause, the parent waits on the final full run itself. Source figures
come from the [efficiency program](../designs/workflow-efficiency-program.md):

- A full suite of 30 to 70 minutes against a 10 minutes in Claude Code foreground
  cap (E6): at least 3 to 7 blocking calls by that arithmetic, each returning at
  the cap with the run still live.
- One final full run of about 2,500 tests, about 75 minutes, that failed once on a
  test-only defect: at least 8 blocking calls by the same arithmetic.
- A 249-minute review with 89 minutes in tests (private research observation,
  with the attribution limits the program names; not repeated here).

Parent status and log reads per wait are unknown. `parent-io=lean` removes them
by rule, and the count it removes is unknown until a real run records it.

## Costs it adds

- One turn end and one resume message for each pause.
- A colder resume. Cached and uncached input tokens on the resumed turn are
  unknown, and so is the caller's queue time before it resumes.
- One more full run for each head move after a pass is accepted: a base merge, a
  Greptile fix, a secret-disposition commit or a pregate fix. A base that advances
  during a 30-to-70-minute run moves the head at readiness.
- The pregate's preflight stage before the pause (no test lanes). Its wall time
  is unknown.
- A pass is caller-attested, so `/ship-and-land` still runs its own test gate, and
  a repository whose main command is the whole suite runs it again there. The
  single full run holds at review only.

## Measurement fields

The efficiency program's measurement record (repo, host, harness and installed
revisions, input tree and scope, sample size, phase work and wait wall time,
parent and child token classes when available, unavailable sources, accepted and
missed findings, added orchestration overhead), plus the fields below. Every
value reads unknown until a real run records it.

| Field | Value |
|---|---|
| Pauses per preparation | unknown |
| Resumes per preparation | unknown |
| First-turn cache read tokens after a resume | unknown |
| First-turn cache write tokens after a resume | unknown |
| Parent status reads per run | unknown |
| Parent log reads per run | unknown |
| Head moves after an accepted pass | unknown |
| Wall time replaced by the pause | unknown |

## Limits

No saving is established. Wall time is not model time, and an estimate is not a
measured saving. Revisit when an installed agent has paused and resumed on a
named profile and the fields above can be filled from its record.
