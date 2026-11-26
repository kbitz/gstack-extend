# /review-and-prep reference: Post-audit diff classification and outcomes

## From Classify changes after the documentation audit's last attempt

**The delta.** Compute the delta from the last accepted audit's post-child
snapshot to the current candidate exactly as **Bound the documentation audit**
item 6 defines (cross-referenced; this section does not require
`documentation-scope=contracts`). Each commit after that snapshot's HEAD is one
post-audit change; commit pending work before classifying.

**The bounded re-audit (one per post-audit change).** For each post-audit
change, the parent reads only that change's diff and the docs that **Bound the
documentation audit** item 3 selects from the delta's changed-path references,
contract references and linked authorities (using the same literal-search
method; not the always-read list unless the search selects it). It edits
nothing, dispatches no `/document-release` child, counts as no upstream attempt,
refreshes no audit hash and writes nothing to `.gstack/tmp/docs-audit.json`.
Without active `doc-audit-gap=auto`, a post-audit change already classified in
this invocation keeps its recorded line; a later commit gets its own line.

**Classes (closed list).** Classify each post-audit change into one of:

- `rename`: every reference is updated in the change, and the literal search
  finds no inventoried doc still naming the old name;
  Only names with no documented external contract qualify. Renaming a documented
  command, flag, configuration key, exported API, policy-grammar token or
  receipt/handoff label is `documented-behavior` even when every reference and
  its documentation are updated.
- `tests-only`: only test or fixture paths changed, and no inventoried doc names
  a changed path or a contract it changes;
- `test-tooling`: every changed path is a test, fixture or test-tooling path and
  at least one is a test-tooling path; no inventoried doc names a changed path
  or a contract it changes (the same literal search as `tests-only`); and the
  change adds, removes or renames no command, flag, help line, configuration
  key or environment variable a person uses. Test-tooling paths are a test
  runner (a script whose only role is to select, start or report the project's
  tests, such as a pregate runner script), a pregate map
  (`.gstack/pregate.json`), a test-selection map (a file mapping source paths
  to the tests they select) and a test helper (a module only tests use). A
  package manifest or lockfile, a CI workflow, an install or setup entry point
  and build or docs-build configuration are never test-tooling paths. When the
  search finds a doc naming a changed test-tooling path or a contract it
  changes, the change is `documented-behavior`, or `already-documented` when a
  doc line read here already states its behavior, cited as `path:line`;
- `todos-only`: only TODOS inbox files (`docs/TODOS.md`, `TODOS.md`, or per-record intake files `docs/todos/wi-<hex>.md`) changed;
- `mechanical-correction`: a doc edit correcting a count, a pointer or a link,
  verified by a recorded check (such as a recount command, the target existing
  or the link resolving) and changing no other claim;
- `already-documented`: a fix whose behavior a doc line read here already
  states, cited as `path:line`, with no doc line made false;
- `undocumented-internal` (available only under `doc-audit-gap=auto` with
  `full-suite=external` and `post-audit=classify`; absent without it): a
  first-parent change that fits no no-owner class above and meets the
  protected-path, literal-search and user-visible-surface checks in **Under
  `doc-audit-gap=auto`** below (`owner=not-needed`);
- `base-merge` (available only under `doc-audit-gap=auto` with
  `full-suite=external` and `post-audit=classify`; absent without it): a clean
  two-parent merge of the fetched base that meets the ancestry, empty
  remerge-diff and two-way guard checks in **Under `doc-audit-gap=auto`** below
  (`owner=not-needed`);
- `documented-behavior`: everything else. Any doubt counts as
  `documented-behavior`.

**Outcome.** When **Under `doc-audit-gap=auto`** is active, use that group's
decision table and preconditions.
When every post-audit change after the accepted audit's post-child snapshot is
in a no-documented-behavior class (`rename`, `tests-only`, `test-tooling`,
`todos-only`, `mechanical-correction` or `already-documented`,
so `owner=not-needed`), continue without asking the owner: the documentation
status stays the accepted audit's own status (`current` or `updated`), never
upgraded, and `.gstack/tmp/docs-audit.json` is untouched. `test-tooling` waives
no test gate: the pregate and test lanes rerun on the changed content under
their freshness rule, under `full-suite=external` the external full-suite gate
still runs on the final head (**Pause for an external full-suite gate**), and
under `full-suite=final` `/ship-and-land`'s full run is unchanged. Any
`documented-behavior` change (`owner=needed`) takes the audit's blocked
recovery as today (the owner stop, including its named-risk exception), naming
that change and why it needed the owner.

**Receipt lines.** Without active `doc-audit-gap=auto`, when the policy carries
`post-audit=classify` and a post-audit freshness check with no attempt left is reached, record
`post-audit: active` or `post-audit: not applied — <reason>`, and under
`post-audit: active` record one line per post-audit change naming why it did or
did not need the owner:

`Post-audit change: <full commit SHA>; paths=<n>; class=<rename|tests-only|test-tooling|todos-only|mechanical-correction|already-documented|documented-behavior>; owner=<not-needed|needed>; carried-audit=<audit_id> <section-sha256>; reason=<one line>; evidence=<reference>`

Without active `doc-audit-gap=auto`, when the value is on the policy line but no
exhausted-audit freshness check was reached, record
`post-audit: not applied — no exhausted-audit freshness check reached`.

Write these lines in the receipt and beside the documentation section, never
inside it: the section stays the child's unchanged text, so its SHA-256 still
matches.

<!-- end of skills/references/review-and-prep/conditional-post-audit-classification.md -->
