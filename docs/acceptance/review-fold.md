# Review fold: acceptance record

Track 58A, recorded against source revision `f7f13e7` plus this Track's
implementation. This record covers prose, fixtures and tests of one optional
`Review policy:` value, `specialists=fold` (see
[the policy grammar](../workflow-handoffs.md#grammar-h-e-continue)), and of the
`bin/upstream-check` anchors behind it. No installed-agent run backs it: a static
prose test is not installed-agent acceptance ([SPEC](../SPEC.md)). It establishes
no saving and awards no checkpoint ([SPEC](../SPEC.md) selected target
acceptance and P1).

## The value

`specialists=fold` (its only value) runs the original invocation's full-scope
cycle 1 without dispatching specialist subagents: the main review pass reads the
selected specialists' checklists itself, each loaded when it reaches it. The Red
Team (when its gate fires), the native adversarial pass and the outside voices
run as today, and `/review`'s cycle cap, stop and completion matrix are
unchanged. It applies only while the installed upstream text it relies on
matches byte for byte; the anchors are in `bin/upstream-check`'s inventory
(`review-and-prep.fold`, thirteen anchors) and are text both installed layouts
carry. On drift cycle 1 dispatches specialists as today and the receipt says
`Review arm: dispatch — anchor changed (<which>)`. The receipt records the arm
and one `Folded checklist:` line per checklist the main pass read, with its file
and SHA-256. Omitted, every default is unchanged. The value waives no gate and
never authorizes a continuation, and the light review default never sets it.

It and `delegate=` exclude each other: a line carrying both reads `none supplied`
(an H-E parser holds it as `policy-malformed`), so no part is reviewed twice or
not at all ([delegated review](../delegated-review.md#with-specialistsfold)).

## What a caller measures

This Track runs no comparison. The quality and cost comparison is a
consumer-owned experiment outside this repository, and this Track authorizes no
spend and no default change. A caller that runs it measures, on the same heads
for each arm (the default dispatch arm, the fold arm, and the `delegate=` arm
separately, never combined with the fold):

- Wall time and model usage per arm, with the host, model and effort named.
- Cycle-1 findings per part, from each finding's `found_by`
  (`specialist:<name>` for a folded checklist, `core` where the main pass
  recorded none, `red-team`, `native-adversarial`, `outside:*`), so an arm's
  findings can be compared part by part.
- Accepted versus missed findings: what a later cycle, Greptile, an outside
  voice or a human found on that head that cycle 1 of that arm did not.
- Red Team activation per arm and which arm of its gate fired (the size arm or a
  CRITICAL finding), since a fold has no specialist dispatch to produce one.
- Which specialists each arm ran. The fold arm reads every listed checklist on a
  sibling host and Review Army's selection on a nested one, so the sets differ
  (see the limits below).

## Adaptive gating

Upstream's adaptive gating learns only from specialist dispatches.
`gstack-specialist-stats` counts a specialist only when its log row records it as
dispatched (`if (info.dispatched)`), and tags it `[GATE_CANDIDATE]` at ten or more
dispatches with no findings. A folded review records no folded part as
dispatched, so it adds no sample to any specialist's hit rate. A review-log row
whose `specialists` object is present, even `{}`, still counts toward the
reviewed total, so a folded review adds to that denominator and to nothing else.

## Older producers

The policy grammar is `review-and-prep-policy/v1` with fixed keys. An installation
that does not know the value reads the whole line as `none supplied`: every key on
it is lost and standard defaults apply. A caller therefore runs
`grep -F 'specialists=fold' "<installed skill dir>/SKILL.md"` first (exit 0 means
supported) and omits the value when it fails, keeping its other keys. An older
H-E parser holds a returned policy that carries the value as `policy-malformed`.

## Did folding need upstream text to change?

No. This settles the question the
[efficiency program](../designs/workflow-efficiency-program.md) left open for
E12: a wrapper-side substitution of the dispatch step is enough. The wrapper
changes who applies a specialist checklist in cycle 1, not any gate, checklist
or `/review` text, and no upstream file is edited. Every rule the substitution
relies on is text both layouts carry, and it is anchored: the combine step, the
core confidence-gate line, the host-omits-Review-Army lines, and each
checklist's first-line heading. The Track would have stopped and handed back to
the owner had folding needed an upstream edit; it did not.

## What the Codex-hosted review dispatches today

The plan for this Track said the sibling (Codex) layout's `/review` dispatches no
specialists. A real Astra-hosted `/review-and-prep` run recorded seven
specialists as dispatched, so this record states what the installed text and
that record each show, and where they leave the question open.

**Installed text.** The installed Codex-style review skill
(`gstack-review/SKILL.md`, a generated host copy) has no Review Army section and
no Red Team: it has no Step 4.5 or 4.6 section, no dispatch step and no mention
of `review-army` or Red Team. It names Review Army only to say a host may omit it
(`If this host omits Review Army, use specialists: {} without claiming
specialist coverage.`). The Codex root holds the checklists (its
`review/specialists`, `review/checklist.md` and `review/design-checklist.md`
link to the nested install) but no `review/sections/` directory. Read alone,
that text dispatches no specialist.

**The wrapper's resolve rule.** `/review-and-prep` Step 1 tells the reader that a
generated host copy may omit sections its source installation retains, and to
resolve those sections from the same installation rather than mistake a missing
section for a scope-based skip; if they cannot be recovered, preparation is
blocked. The source installation of the Codex copy is the nested one, which holds `review/sections/review-army.md`
(selection, adaptive gating, parallel dispatch and Red Team).

**The 2026-11-02 record.** The `review-results.json` of that run (an Astra host,
policy `in-cap=delta`, no `delegate=`) lists `testing`, `maintainability`,
`security`, `performance`, `simplification`, `state-machines` and `red-team`
with `"dispatched": true` and no findings, and `data-migration`, `api-contract`
and `design` skipped for scope. Its `core.checklist` is a path under the Codex
root. Its receipt says "Core, six specialists, Red Team and native adversarial"
reviews completed, and the run directory holds a State Machines detector result.
Red Team and the State Machines detector step exist only in Review Army text and
the specialist files, which the Codex copy does not carry.

**Conclusion.** The record is consistent with an Astra-hosted run that resolved
Review Army from the source installation, as Step 1 directs, and dispatched its
selected specialists and a Red Team from that text. It is not consistent with
the installed Codex text alone dispatching them. So do not state that the Codex
host runs no specialists: the installed Codex text carries none, and an
Astra-hosted wrapper run has dispatched them. The record does not show how each
was dispatched (a subagent per specialist, or applied by the main pass): the
run's `voices.jsonl` holds one row, a native adversarial pass from a repair, and
no row or field names a specialist's mechanism. The log's `dispatched: true` is
what that run reported, not proof of a separate subagent.

**What it means for the comparison.** On an Astra host the dispatch arm is
Review Army resolved from the source installation, with scope signals, adaptive
gating, up to nine specialists and a Red Team, not an arm with no specialists.
The fold arm there (the sibling layout) has no selection to apply, so it reads
all nine listed checklists. The two arms therefore differ in the set of
checklists reviewed as well as in who applied them, and the fold arm's Red Team
follows whatever the host's resolved review text does. The approved design is
unchanged either way; a caller records, per arm, the checklists read or
specialists dispatched and whether a Red Team ran (above) so the comparison
states what each arm covered.

## Limits

- Review Army's selection, its State Machines and Design steps and the Red Team
  dispatch mechanics are used as written but are not anchored: only the nested
  layout installs them, and anchoring them would break the both-layout rule. An
  upstream change inside `review/sections/review-army.md` is not detected by
  `upstream-check`.
- Core and specialist findings use different confidence gates. A folded finding
  is a main-pass finding under the core gates, so a part-by-part comparison has
  that gate difference as a confound.
- The sibling fold reads checklists the sibling review never ran (and, per the
  section above, an Astra host may run them through resolved Review Army text).
  It costs more context than a selection and is a measurement arm, not a claimed
  saving.
- The anchors were qualified at upstream `47079fd89fc7fc13c0f06dc7980b682890175a8c`
  (`1.93.3.0`) for the nested checkout; the sibling install's revision is
  unknown, and its anchors are the same text it carries.
- A folded finding recorded with no checklist is attributed to `core`, never
  guessed from its text, file or category.

## What this Track does not claim

- No saving: the fold is not shown to cost less time, tokens or money.
- No quality result: the fold is not shown to find as much as dispatched
  specialists do, or less.
- No spend: nothing here calls a provider or authorizes one.
- No default change: no value, light default or config key turns the fold on.
- No installed-agent run: the evidence is prose, fixtures and tests.
