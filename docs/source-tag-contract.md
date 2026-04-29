# Source-Tag Contract

Canonical schema for items written to `TODOS.md` by skills. All producer skills
(`/pair-review`, `/full-review`, `/review-apparatus`, `/test-plan`,
`/investigate`, manual) emit entries that match this contract. `/roadmap`'s
scrutiny gate, closure-bias placement, and dedup pipeline parse entries against
this contract. `bin/roadmap-audit` validates entries and emits `STATUS: fail`
on malformed ones.

## Item grammar

Every item in `## Unprocessed` is a single H3 heading followed by 0 or more
attribute bullets, optionally followed by prose paragraphs.

```
### [source:tag] Title
- **Why:** problem statement or value (manual, ship)
- **Description:** reviewer's analytical framing of the issue (full-review, review)
- **Symptom:** observed behavior (pair-review, investigate)
- **Repro:** numbered steps to reproduce (pair-review, investigate)
- **Effort:** S (human: ~X / CC: ~Y)
- **Depends on:** optional prerequisite
- **Context:** optional background
- **Priority:** P1 | P2 | P3
- **Hypothesis (untested):** optional reviewer guess at direction (full-review, review)

Optional free-form prose paragraphs here.
```

The lead field varies by source so the framing matches the writer's epistemic
posture:
- **manual** / **ship**: `**Why:**` — the user authored this and stands behind it.
- **pair-review** / **investigate** (observation-source): `**Symptom:**` +
  `**Repro:**` — what was seen, with steps to re-verify before fixing.
- **full-review** / **review** (reviewer-source): `**Description:**` — the
  reviewer agent's framing of the issue, neither verified causation nor direct
  observation. Pairs with `**Hypothesis (untested):**` for the suggested fix
  direction. See *Speculation framing* below.

### Speculation framing

Three field names are intentionally hedged to prevent tunnel vision when the
item is fixed later:

- `**Symptom:**` — what was observed, not what's wrong. The item may turn
  out to be a misread of the user's environment, a flake, or already-fixed.
  The implementer should re-verify per `**Repro:**` before fixing. If it
  doesn't reproduce, close as resolved instead of guessing at a fix.
- `**Description:**` — the reviewer agent's framing of the issue, neither
  verified causation nor direct observation. The implementer should read it
  as "here's what the reviewer thinks is wrong" and re-verify before acting.
  Avoids the trap of `**Why:**`, which reads as a verified problem statement.
- `**Hypothesis (untested):**` — a direction to investigate, not a fix to
  apply. Reviewer agents (full-review, review) emit one-sentence hypotheses
  that were not verified against the running code. The implementer should
  treat them as starting points for investigation, expect to discard or
  refine them, and prefer subtraction over addition where both work.

These fields replace earlier framings:
- Observation-source skills (pair-review, investigate) used `**Why:**`; now
  use `**Symptom:**` + `**Repro:**`.
- Reviewer-source skills (full-review, review) used `**Why:**` +
  `**Proposed fix:**`; now use `**Description:**` + `**Hypothesis (untested):**`.

Legacy entries using the old field names remain valid — no parser inspects
field names, so the values pass through verbatim — but new writes from
updated skills use the hedged framing.

### Heading anatomy

`### [source:tag] Title`

- The `###` prefix is the item delimiter. Parsers SHOULD treat `###` inside
  `## Unprocessed` as "start of a new item."
- `[source:tag]` is the source-tag expression (grammar below). If present, the
  parser reads provenance from it. If absent, the parser treats the item as
  `[manual]` for routing defaults.
- `Title` is the human-readable summary. Should be a short phrase, not a
  paragraph. Used as the dedup normalization input.

### Attribute bullets (recommended, not required)

Parsers tolerate their absence. Recommended fields:

- `- **Why:**` ... — problem statement or value proposition. Shown in triage.
- `- **Effort:**` ... — size estimate. Shown in triage.
- `- **Depends on:**` ... — prerequisites. Flags items that shouldn't be
  scheduled until blockers are resolved.
- `- **Context:**` ... — any provenance, branch reference, or prior decisions
  that explain why this item exists.
- `- **Priority:**` P1 | P2 | P3 — optional priority. Drives display ordering.
- `- **Symptom:**` ... — observed behavior (used by pair-review, investigate).
  Pairs with `**Repro:**`. Replaces the older `Why:` framing for
  observation-source items.
- `- **Repro:**` ... — numbered steps to reproduce. Used by observation-source
  skills so the implementer can re-verify the bug before fixing.
- `- **Description:**` ... — reviewer's analytical framing of the issue (used
  by full-review, review). Replaces the older `Why:` framing for reviewer-
  source items so the implementer reads it as "what the reviewer thinks is
  wrong" rather than as verified causation.
- `- **Hypothesis (untested):**` ... — reviewer's guess at a direction to
  investigate. Used by full-review and review. Framed as untested to prevent
  the implementer from treating it as a prescription.
- `- **Proposed fix:**` ... — legacy field, equivalent to "Hypothesis
  (untested)". Field names are not parsed — values pass through verbatim
  — so legacy entries remain valid and renderable. New writes from
  updated skills should use "Hypothesis (untested)" so the speculative
  framing is preserved.

Skills MAY add additional `- **Key:** value` bullets. Unknown keys are
preserved by the parser but not acted on.

### Free-form prose

Anything after the attribute bullets (before the next `###` heading) is
free-form prose — stack traces, ASCII diagrams, snippets. Preserved verbatim
on triage; not parsed.

## Source-tag expression grammar

```
[<source>(:<key>=<value>(,<key>=<value>)*)?]
```

- `<source>` is the originating skill: `pair-review`, `full-review`,
  `review`, `review-apparatus`, `test-plan`, `investigate`, `ship`, `manual`.
- `<key>=<value>` pairs provide structured metadata. Order does not matter.
- Keys MUST be lowercase, `[a-z-]+`.
- Values MUST NOT contain `[]`, `,`, or `;`. Values containing these should be
  omitted or pipe-separated (for file lists: `files=a.ts|b.ts`).

### Defined keys

| Key | Source scope | Format | Meaning |
|---|---|---|---|
| `group` | pair-review, test-plan | integer, or `pre-test` | Roadmap Group that surfaced this item |
| `item` | pair-review, test-plan | integer | Test-plan item index within the group |
| `severity` | full-review, review | `critical` \| `necessary` \| `nice-to-have` \| `edge-case` | Reviewer's severity classification |
| `files` | full-review (when single-cluster) | pipe-separated paths | File paths the finding references |

### Source-default routing matrix (used by /roadmap scrutiny gate)

| Source | Default | Notes |
|---|---|---|
| `manual` | KEEP | User wrote it deliberately |
| `ship` | KEEP | Deferred-from-ship context, user decision |
| `pair-review` (any form) | KEEP | Observed bug from manual testing |
| `investigate` | KEEP | Observed bug from debugging |
| `test-plan` (any form) | KEEP | Observed bug from batched testing |
| `review-apparatus` | KEEP | Tooling proposal, usually real need |
| `full-review:critical` | KEEP | Ship-blocker |
| `full-review:necessary` | KEEP | Real defect |
| `full-review:nice-to-have` | PROMPT | Non-essential improvement |
| `full-review:edge-case` | SUGGEST_KILL | Edge or hypothetical — bias toward drop |
| `full-review` (no severity, legacy) | PROMPT | Legacy tag without taxonomy |
| `review` (any form) | KEEP | Pre-landing `/review` finding — adversarial subagent + codex on a specific PR; defaults align with `full-review:necessary` semantics. Optional `severity=` mirrors the full-review taxonomy. |
| `discovered:<path>` | PROMPT | Extracted from scattered doc, may be out of context |
| `<unknown>` / missing | PROMPT | Unrecognized — ask user |

### Severity taxonomy (full-review)

- **critical** — ship-blocker, data loss, security, correctness.
- **necessary** — real defect, should fix in current or next Group.
- **nice-to-have** — legitimate improvement, OK to defer.
- **edge-case** — hypothetical or extreme-edge scenario. `/full-review` DROPS
  these at source (never written to TODOS.md). Listed here for completeness;
  will not appear in practice.

## Examples

```markdown
### [pair-review:group=2,item=5] Arrow key double-move on thread list
- **Symptom:** user hits Up/Down and selection skips a row intermittently. Makes keyboard navigation unreliable.
- **Repro:** 1. open thread list, 2. press Down arrow rapidly 5x, 3. observe selection jumps 2 rows on the 3rd or 4th press.
- **Effort:** S (human: ~2 hours / CC: ~15 min)
- **Context:** surfaced during Group 2 pair-review on kbitz/threading (2026-04-20). Re-verify per repro steps before fixing.

### [full-review:critical] SQL injection in user lookup
- **Description:** `User.where("email = '#{params[:email]}'")` is concatenated, not parameterized. Direct exploitation path.
- **Hypothesis (untested):** swap to `User.where(email: params[:email])` — verify the column exists and the param shape matches before applying.
- **Effort:** S (human: ~1 hour / CC: ~10 min)
- **Found in:** app/controllers/users_controller.rb:47

### [full-review:nice-to-have,files=app/services/cache.ts] Cache TTL tunable via config
- **Description:** hardcoded 60s TTL doesn't fit all query types.
- **Hypothesis (untested):** consider whether the TTL should be removed entirely (cache-busting on write) before adding configurability — adding a config knob is the additive direction.
- **Effort:** M (human: ~1 day / CC: ~30 min)

### [manual] Explore webhook outbound events for v1.1
- **Why:** customer ask from two accounts.
- **Effort:** L (human: ~1 week / CC: ~1 hr)
- **Priority:** P3
```

## Dedup semantics

`/roadmap` dedup key = `hash(normalize_title(title))`.

Normalization:
1. Lowercase.
2. Strip punctuation except spaces.
3. Collapse whitespace to a single space.
4. Trim leading/trailing whitespace.
5. Strip trailing metadata after any of these sentinels: `— found on branch`,
   ` found on branch`, `(20`, `(v0.`, `(v1.`, `(v2.`, ` source: [`.

Dedup collapses across sources intentionally. If `/pair-review` and
`/full-review` both surface the same bug, they merge into one item; the first
writer's source tag is preserved on the kept entry; the dropped source is
recorded in `.context/roadmap/dedupe-log.jsonl`.

Collision safety: the hash-input is raw normalized title. Two distinct titles
that normalize identically WILL collide — this is the tradeoff for catching
near-duplicates. The dedup log makes every decision traceable.

## Validator behavior

`bin/roadmap-audit` emits a `## TODO_FORMAT` section that validates every item
in `## Unprocessed` against this contract. Failures emit `STATUS: fail` with
per-entry findings:

- `MALFORMED_HEADING` — entry doesn't match `^### ` or is a bare bullet
  `- [source] ...` (legacy format dropped in v0.15.1).
- `UNKNOWN_SOURCE_TAG` — tag source is not in the registered list above.
- `MALFORMED_TAG` — `[source:key=value]` expression failed the grammar.
- `INJECTION_ATTEMPT` — tag value contains `[`, `]`, `;`, or newlines.

The skill surfaces validator failures during triage and blocks until resolved.
