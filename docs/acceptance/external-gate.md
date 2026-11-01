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
  omitted main-command fallback is a preparation-only change; pregate can still
  select the whole suite.
- A pregate narrowed after a pass leaves no full pregate record and no
  pregate-wrapped `tests` entry. `/ship-and-land` then takes its `FULL` path and
  runs its own test gate for that head, where a head with preparation's full
  pregate record could take its release-only path. Total test time is not reduced
  for a caller that lands through `/ship-and-land`; the saving is real only for a
  caller that lands by its own gate.

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

## Pregate narrowing after an accepted pass

After an accepted `full-suite=external` pass whose attested command covers every
test the diff selects, `/review-and-prep` runs the pregate's preflight stage
alone (see [Grammar H-F](../workflow-handoffs.md#grammar-h-f-external-gate) and
the skill's **Narrow the pregate after an accepted pass**). Partial or unknown
coverage runs the pregate as today. This section records the wall time of the
review loop it targets.

### Before

One consumer's review, measured by that consumer and described here without
naming it: the caller's own full-suite gate, then the pregate that followed the
accepted pass, inside the whole review loop.

| Field | Before | After |
|---|---|---|
| Caller's own gate | 1,228.7 s | unknown |
| Pregate after the accepted pass | 1,358.2 s | unknown |
| Whole review loop | 5,109.9 s | unknown |

The before figures are one unpaired sample, so they establish neither a typical
cost nor a saving.

### After

Every "after" value reads unknown until a real opted-in run records it: a run
whose receipt carries `pregate-narrowing: active` and a `pregate-preflight`
ledger record. Fill the table from that record after the first such run.

## Limits

No saving is established. Wall time is not model time, and an estimate is not a
measured saving. Revisit when an installed agent has paused and resumed on a
named profile and the fields above can be filled from its record.
