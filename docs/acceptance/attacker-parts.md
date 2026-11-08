# Attacker parts and red-team step: acceptance record

Track 72B, recorded against source revision `2d1b3e4` plus this Track's
implementation, with upstream gstack qualified at
`297f50c7e1d46aab1404f5f2e8a9584af76ad6b2` (`1.97.0.0`). This record covers
prose, fixtures and tests of two optional `Review policy:` additions —
`red-team=ensure` and the attacker values `adversarial` and `red-team` in
`delegate=` (see
[the policy grammar](../workflow-handoffs.md#grammar-h-e-continue) and
[delegated review](../delegated-review.md)) — and of the `bin/upstream-check`
anchors behind them (`review-and-prep.attacker`). No installed-agent run backs
it yet: a static prose test is not installed-agent acceptance
([SPEC](../SPEC.md)). It establishes no saving and awards no checkpoint
([SPEC](../SPEC.md) selected target acceptance and P1).

## Opt-in decision

Both additions are **opt-in only**:

- `red-team=ensure` (its only value) runs `/review-and-prep`'s red-team step
  when the review text the host will execute contains neither `Red Team` nor
  `red-team`, gated by upstream's Red Team activation (`DIFF_LINES > 200` or any
  specialist produced a `CRITICAL` finding). Naming `red-team` in `delegate=`
  also turns the step on under the same gate when `/review` has none.
- `delegate=` accepts `adversarial` (the native adversarial pass) and `red-team`
  (the Red Team) alongside the four specialist parts, each mapped in the
  caller's `review-delegates/v1` file, with today's fallback to the host model
  when a delegate fails. Findings keep `found_by` `native-adversarial` or
  `red-team` plus the v:3 `delegate` fields, with no new attribution label.
- With no `Review policy:` line, and under the light review default, nothing
  changes and nothing is recorded. Neither addition adds a question or a hold.

## Older producers

Each addition has its own caller-side capability check against
`<installed skill dir>/SKILL.md`, distinct from `delegate=<part>` (which older
installs also match):

- `grep -F 'delegate=adversarial,red-team' "<installed skill dir>/SKILL.md"` for
  the two attacker values in `delegate=`.
- `grep -F 'red-team=ensure' "<installed skill dir>/SKILL.md"` for
  `red-team=ensure`.

An older `/review-and-prep` install reads a policy line carrying either addition
as `none supplied`, and an older H-E parser holds it as `policy-malformed`.

## Pending installed-agent runs

No installed-agent run has been recorded for this Track yet. Criterion 6 tracks
two post-merge runs, to be appended here as dated rows once the release carrying
this Track is installed:

| Row | Status | Date | Scope | What it must show and where its evidence lives |
|---|---|---|---|---|
| `PM1` | pending | — | By-hand `/review-and-prep` run with no `Review policy:` and no `Review delegates:` line | After the release carrying this Track is installed, run one real by-hand `/review-and-prep` with no `Review policy:` and no `Review delegates:` line. Read its receipt back: it has no `Red team:`, `adversarial-pass:` or `delegation:` line, the same gates and stops run, and it passes as before. Record the date, revision, host and harness versions, and the PR in this table through a docs-only change. |
| `PM2` | pending | — | Orchestrated `/review-and-prep` run with `delegate=adversarial,red-team` and per-part models | Run one orchestrated `/review-and-prep` whose caller sends `Review policy: …; delegate=adversarial,red-team` (plus `red-team=ensure` on a host whose `/review` has no Red Team) and a `Review delegates:` file that maps `adversarial` and `red-team` to different providers or models (effort in each provider's `argv`). Record the `Delegated part:` lines, the v3 attempts, the `found_by` labels (`native-adversarial`, `red-team`) and any fallbacks in this table. |

## Release-note input

Release files (`CHANGELOG.md`, `VERSION`, `package.json`, `bun.lock`) are
written at the release step, not on the implementation branch:

- **Level:** `minor` (0.x compatible addition to a stable surface: new opt-in
  `review-and-prep-policy/v1` values, [SPEC](../SPEC.md) Release policy "During
  0.x: compatible additions use MINOR").
- **User-facing change:** `/review-and-prep` accepts two opt-in review-policy
  additions: `red-team=ensure` runs a red team when the installed `/review` has
  none, and `delegate=` now also takes `adversarial` (the native adversarial
  pass) and `red-team`, each sent to the provider and model its
  `review-delegates/v1` file maps; a run with no `Review policy:` line is
  unchanged.
- **Upgrade risk:** an older `/review-and-prep` install reads a policy line
  carrying either addition as `none supplied`, and an older H-E parser holds it
  as `policy-malformed`, so callers first check `grep -F 'red-team=ensure'` and
  `grep -F 'delegate=adversarial,red-team'` against the installed skill;
  `bin/review-delegate` gains `--adversarial` and `--caught` and the refusal
  `caught-unreadable`, while its existing flags, exits and output keys are
  unchanged.

## What this Track does not claim

- No saving or quality result: delegated attacker parts see only the frozen
  diff (with fixture bytes in full), never repository files, and retained
  quality is unmeasured until `PM2`.
- No spend: nothing in the test suite calls a model or provider.
- No default change: no value, light default or config key turns `red-team=ensure`
  or `delegate=` on.
- No installed-agent run yet: `PM1` and `PM2` above remain pending until
  post-merge verification.
