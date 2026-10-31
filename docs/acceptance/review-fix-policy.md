# Review repair policy: acceptance record

Track 33A, recorded against source revision `778a265` plus this Track's
implementation. This record covers prose, fixtures and tests of two optional
`Review policy:` values, `repair-review=behavior-changing` and
`repair-cycles=light` (see [the policy grammar](../workflow-handoffs.md#grammar-h-e-continue)),
and of the `bin/upstream-check` anchors behind the first. No installed-agent
run backs it: a static prose test is not installed-agent acceptance
([SPEC](../SPEC.md)). It establishes no saving and awards no checkpoint
([SPEC](../SPEC.md) selected target acceptance and P1).

## The two values

- `repair-review=behavior-changing` lets a repair that changes no behavior open
  no further review cycle. Targeted lanes and the single final suite cover it,
  and only behavior-changing repairs feed the next `in-cap=delta` cycle. A
  repair that cannot be classified counts as behavior-changing. It applies only
  while the installed `/review` Fix-First text matches byte for byte; the
  anchors are in `bin/upstream-check`'s inventory (`review-and-prep.fix-first`).
  On drift the review runs today's behavior and the receipt says
  `repair-review: inactive`.
- `repair-cycles=light` applies the light review default's repair-cycle skips to
  one invocation without any `review_default` config. A delta repair cycle makes
  no outside call and skips the Red Team; the native adversarial pass and
  force-included specialists still run. Cycle 1 and every full-scope or inactive
  cycle run as today.

Omitted, every default is unchanged. Neither value waives a gate or authorizes a
continuation.

## Before: what recorded runs show

Read on 2026-10-31 with `bin/gstack-extend-telemetry metrics read --session-id
<id>` for every `review-and-prep` session in
`~/.gstack-extend/analytics/stage-runs.jsonl` (115 sessions; 102 had no metrics
file). Aggregates only: no session ID or repository name is published.

| Field | Value |
|---|---|
| Sample size | 13 runs with a metrics summary |
| Status | 10 `ok`, 3 `partial` |
| `data.local_passes` | 0 to 3, median 2 (9 of 13 runs report it) |
| `data.fix_cycles` | 0 to 3, median 1 (11 of 13 runs report it) |
| `local-pass` phase `observed_wall_duration_ms` | 9 runs: 9.0 to 51.3 minutes, median 24.7 minutes; 3 further runs list the phase with an unknown duration |
| `fix` phase `observed_wall_duration_ms` | 8 runs: 0.005 to 31.0 minutes, median 4.8 minutes; 1 further run lists the phase with an unknown duration |
| `data.union_observed_wall_ms` | 13 runs: 36.0 minutes to 19.2 hours, median 116.6 minutes |

The sample is unpaired: the runs differ in size, host and policy, none ran with
either value, and no run was repeated with and without a change. It shows how
long review work took, not what a value would save, and a median over a few runs
is not a rate.

## After: to be measured

The same fields, plus the two counts below, read `unknown` until a real run with
the value on its policy line records them.

| Field | Value |
|---|---|
| Sample size, status, `local_passes`, `fix_cycles` | unknown |
| `local-pass` and `fix` phase wall time | unknown |
| `data.union_observed_wall_ms` | unknown |
| Count of `Repair without review cycle:` lines in the receipt | unknown |
| Count of `skipped — light default repair cycle; source: repair-cycles=light` records | unknown |

To fill them: after a release that carries these values is installed, run a
review with `repair-review=behavior-changing`, `repair-cycles=light` or both on
its policy line; read its metrics with the command above; count the receipt's
`Repair without review cycle:` lines and the recorded skips; compare against a
run of similar size without the values, and record that pairing here. Until then
the criterion's "after" side is not measured, and the owner decides whether to
accept it on the first opted-in run after a release installs.

## Release notes

For `/ship` to copy verbatim into the CHANGELOG entry of the version that adds
the values. A test cannot pin text `/ship` has not written, so the
`/ship-and-land` review checks the entry against this block.

```text
`/review-and-prep` accepts two new optional `Review policy:` values.

- `repair-review=behavior-changing`: a repair that changes no behavior (a docstring or comment, a rename of a name nothing outside the change reads, unreachable code, a redundant handler) opens no further review cycle. Targeted lanes and the single final suite cover it, and only behavior-changing repairs feed the next `in-cap=delta` cycle. A repair that cannot be classified counts as behavior-changing. It applies only while the installed `/review` Fix-First text matches byte for byte; otherwise the review runs today's behavior and the receipt records `repair-review: inactive`. Before sending it, check the loaded copy: `grep -F 'repair-review=behavior-changing' "<installed skill dir>/SKILL.md"` (exit 0 means supported).
- `repair-cycles=light`: a delta repair cycle makes no outside call and skips the Red Team; the native adversarial pass and force-included specialists still run, and cycle 1 and every full-scope or inactive cycle run as today. It needs no `review_default` config and is independent of the first value. Before sending it, check the loaded copy: `grep -F 'repair-cycles=light' "<installed skill dir>/SKILL.md"` (exit 0 means supported).

Older installations: an installation without a value reads the whole line as `none supplied`, and an older handoff parser holds a returned policy that carries it as `policy-malformed`. A caller omits a value whose check fails and keeps its other keys. Omitted, every default is unchanged. Neither value waives a gate or authorizes a continuation.
```

## Limits

Prose, fixtures and tests only. No installed-agent run backs it, so whether an
agent classifies a repair as the text asks is unproven. No saving is
established: the "before" sample is unpaired and the "after" side is unknown.
No checkpoint is awarded. Revisit when an opted-in run has recorded the fields
above and a similar run without the values can be set beside it.
