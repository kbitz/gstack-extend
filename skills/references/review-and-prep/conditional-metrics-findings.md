# /review-and-prep reference: Review finding attribution and correction metrics

## From Workflow metrics (optional, local)

- A fix batch is a `kind:"fix"` step, counted separately from passes. Greptile is
  `scope:"greptile"` with its own count and its existing once-per-PR rule
  above unchanged; metrics never triggers, retries or waives it.
- Finding attribution (`v:2`): for each `record pass`
  `--finding <finding_id>,<severity_source>,<part>[,<part>...]` or
  `attribution=<reason>` value, which `derive` writes as `v:2` `found_by` and
  `attribution_reason`, take each part from
  that part's own record, never from the finding's text, file or category:
  `specialist:<name>` from the `specialist` field of a specialist's finding,
  `red-team` for a finding tagged `"specialist":"red-team"`,
  `native-adversarial` for a finding from `/review`'s in-host adversarial pass,
  `core` for a finding the core checklist reported, `qa` for a finding an
  exploratory QA probe reported, `greptile` for a finding Greptile's own review
  reported, and `outside:challenge` or `outside:structured` for an outside
  voice's finding, by its phase. A delegated part's finding takes `found_by`
  from the runner's part row: `specialist:<part>` for the four specialists,
  `red-team` for `red-team`, and `native-adversarial` for `adversarial`. A
  finding several parts reported keeps every
  part: the finding you keep lists every source upstream's merge names, and a
  `duplicate_of` row keeps its own part. Under `specialists=fold`, a finding the
  main pass recorded while applying a folded checklist names
  `specialist:<name>` of that checklist, taken from the main pass's own record,
  and a folded finding recorded with no checklist is `core`; neither is ever
  inferred later from text, file or category, and no voice is declared for a
  folded specialist. With no part to name, send `attribution=<reason>`
  (`found_by: []` and an `attribution_reason`): `unlisted-part` for a part
  outside that list, `unsupported` for a name outside the grammar,
  `not-reported` when the part's record does not say. Never guess a part. Read
  upstream's records and `gstack-review-read`; never write, append to or edit
  upstream's review log for attribution.
- A finding's later adjudication or resolution change is a `record correction`,
  which `derive` writes as `correction_kind:"finding"`; retry and fallback
  corrections come from `--predecessor-attempt-id`; fix-cycle corrections are
  not derived (calls doc `## Derive and spans`, decision d8).

<!-- end of skills/references/review-and-prep/conditional-metrics-findings.md -->
