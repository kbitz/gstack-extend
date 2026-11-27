# Source-Tag Contract

Canonical schema for items written by producers
(`/pair-review`, `/full-review`, `/review-and-prep`, `/investigate`, manual).
`/review-and-prep` writes machine-generated intake to one
`docs/todos/wi-<hex>.md` file per record in the same item grammar. Hand-written
entries, entries from other skills, and existing review records can stay in
`TODOS.md`. `/roadmap` parses both sources for scrutiny, admission, and dedup.
`bin/roadmap-audit` reports malformed items as `STATUS: fail`.

## Item grammar

Every item in `## Unprocessed` is a single H3 heading followed by 0 or more
attribute bullets, optionally followed by prose paragraphs.

```
### [source:tag] Title
- **ID:** wi-<4-8 lowercase hex> — immutable work-item ID assigned at creation
- **Why:** problem statement or value (manual, ship)
- **Description:** reviewer's analytical framing of the issue (full-review, review)
- **Symptom:** observed behavior (pair-review, investigate)
- **Repro:** numbered steps to reproduce (pair-review, investigate)
- **Effort:** S (human: ~X / CC: ~Y)
- **Depends on:** optional prerequisite
- **Context:** optional background
- **Priority:** P1 | P2 | P3
- **Hypothesis (untested):** optional reviewer guess at direction (full-review, review)
- **Revisit when:** concrete reassessment trigger (required on deferrals)

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

- `- **ID:**` `wi-<4-8 lowercase hex>` — immutable work-item ID.
  New entries get an ID from `bin/roadmap-id mint` at creation. `TODOS.md`
  entries with no ID produce a `MISSING_ID` failure in `WORK_ITEM_IDS`.
- `- **Why:**` ... — problem statement or value proposition. Shown in triage.
- `- **Effort:**` ... — size estimate. Shown in triage.
- `- **Depends on:**` ... — prerequisites. Flags items that shouldn't be
  scheduled until blockers are resolved.
- `- **Context:**` ... — any provenance, branch reference, or prior decisions
  that explain why this item exists.
- `- **Priority:**` P1 | P2 | P3 — optional priority. Drives display ordering.
- `- **Revisit when:**` ... — the concrete trigger for reassessing deferred
  work. Optional in the inbox; `/roadmap` requires it on every deferral.
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
  `review`, `review-apparatus`, `test-plan`, `investigate`, `ship`, `manual`,
  `discovered`, `plan-ceo-review`, `plan-eng-review`.
- `<key>=<value>` pairs provide structured metadata. Order does not matter.
- Keys MUST be lowercase, `[a-z-]+`.
- Values MUST NOT contain `[]`, `,`, `;`, a backtick, or `$(`. Values containing
  these should be omitted or pipe-separated (for file lists: `files=a.ts|b.ts`).

`review-apparatus` and `test-plan` are retired skills. Their source tags remain
accepted so existing project backlogs still validate and retain their routing.

### Defined keys

| Key | Source scope | Format | Meaning |
|---|---|---|---|
| `group` | pair-review (legacy: test-plan) | integer, or `pre-test` | Roadmap Group that surfaced this item |
| `item` | pair-review (legacy: test-plan) | integer | Test-plan item index within the group |
| `severity` | full-review, review | `critical` \| `necessary` \| `nice-to-have` \| `edge-case` | Reviewer's severity classification |
| `files` | full-review (when single-cluster), review | pipe-separated paths | File paths the finding references |
| `track` | plan-ceo-review, plan-eng-review | track id (e.g. `4A`, `11A.2`) | The Track being reviewed; anchors the deferral to its origin |
| `defer` | plan-ceo-review, plan-eng-review | `true` | Marks an item as deferred-from-scope by the review (in-scope work cut to keep the Track sized correctly), distinct from a normal review finding. Always written as `defer=true` (the grammar requires `key=value`; bare flags are rejected). |

### Source-default routing matrix (used by /roadmap scrutiny gate)

These defaults prioritize evaluation, not execution. KEEP retains an observation;
it does not promise a Track. PROMPT requires a disposition using the selected
target and existing user decisions; it need not ask a redundant question when
those decisions already settle it. Malformed or unknown tags still need the
user's explicit decision. Source/severity alone never admits work. KEEP does
not exempt an unobserved defect from `/roadmap`'s manifestation gate: unless it
risks irreversible, consequential harm (data loss, exposure, an unretractable
outward action), it is killed until it manifests.
For placement, `/roadmap` must explain the concrete impact on SPEC's intended
users, supported conditions and acceptance. A deferral requires why it can wait
and a revisit trigger. Existing explicit commitments require an approved scope
amendment to cut; writing `defer=true` does not supply that approval.

| Source | Default | Notes |
|---|---|---|
| `manual` | KEEP | User wrote it deliberately |
| `ship` | KEEP | Deferred-from-ship context, user decision |
| `pair-review` (any form) | KEEP | Observed bug from manual testing |
| `investigate` | KEEP | Observed bug from debugging |
| `test-plan` (any form) | KEEP | Legacy observed bug from batched testing |
| `review-apparatus` | KEEP | Legacy tooling proposal |
| `full-review:critical` | KEEP | Ship-blocker |
| `full-review:necessary` | KEEP | Real defect |
| `full-review:nice-to-have` | PROMPT | Non-essential improvement |
| `full-review:edge-case` | SUGGEST_KILL | Edge or hypothetical — bias toward drop |
| `full-review` (no severity, legacy) | PROMPT | Legacy tag without taxonomy |
| `review` (any form) | KEEP | Pre-landing `/review` finding — adversarial subagent + codex on a specific PR; defaults align with `full-review:necessary` semantics. Optional `severity=` mirrors the full-review taxonomy. `/review-and-prep` also writes `[review:files=<paths>]` for a recorded test gap (a `**Test gap:** no demonstrated defect` bullet, no `severity=`); it is KEEP like any `review` tag, and `/roadmap` places it by its `files=` instead of by a defect claim. |
| `plan-ceo-review:track=<id>,defer=true` | PROMPT | Review deferral; reassess the selected target before placement, deferral or rejection |
| `plan-eng-review:track=<id>,defer=true` | PROMPT | Same target-based reassessment as plan-ceo-review |
| `plan-ceo-review` / `plan-eng-review` (no `defer=true`) | PROMPT | Review-surfaced finding that wasn't in original scope — ask user whether it's a deferred-scope item or new work |
| `discovered:<path>` | PROMPT | Extracted from scattered doc, may be out of context |
| `<unknown>` / missing | PROMPT | Unrecognized — ask user |

### Severity taxonomy (full-review)

- **critical** — ship-blocker, data loss, security, correctness.
- **necessary** — reported real defect; verify evidence and target impact before scheduling.
- **nice-to-have** — legitimate improvement, OK to defer.
- **edge-case** — hypothetical or extreme-edge scenario. `/full-review` DROPS
  these at source (never written to TODOS.md). Listed here for completeness;
  will not appear in practice.

`/full-review`'s implicit-state-machine lens places its classification (`[make explicit now]`, `[make explicit later]`, `[plain check]`) inside `**Description:**` (with direction in `**Hypothesis (untested):**`) and maps findings onto the existing four severities with no new severity names or fields.

## Examples

```markdown
### [pair-review:group=2,item=5] Arrow key double-move on thread list
- **ID:** wi-a1b2c3
- **Symptom:** user hits Up/Down and selection skips a row intermittently. Makes keyboard navigation unreliable.
- **Repro:** 1. open thread list, 2. press Down arrow rapidly 5x, 3. observe selection jumps 2 rows on the 3rd or 4th press.
- **Effort:** S (human: ~2 hours / CC: ~15 min)
- **Context:** surfaced during Group 2 pair-review on kbitz/threading (2026-04-20). Re-verify per repro steps before fixing.

### [full-review:critical] SQL injection in user lookup
- **ID:** wi-b2c3d4
- **Description:** `User.where("email = '#{params[:email]}'")` is concatenated, not parameterized. Direct exploitation path.
- **Hypothesis (untested):** swap to `User.where(email: params[:email])` — verify the column exists and the param shape matches before applying.
- **Effort:** S (human: ~1 hour / CC: ~10 min)
- **Found in:** app/controllers/users_controller.rb:47

### [full-review:nice-to-have,files=app/services/cache.ts] Cache TTL tunable via config
- **ID:** wi-c3d4e5
- **Description:** hardcoded 60s TTL doesn't fit all query types.
- **Hypothesis (untested):** consider whether the TTL should be removed entirely (cache-busting on write) before adding configurability — adding a config knob is the additive direction.
- **Effort:** M (human: ~1 day / CC: ~30 min)

### [review:files=src/export.ts|src/export-format.ts] Test gap: empty batch is not tested
- **ID:** wi-d4e5f6
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** `exportBatch` has no test for an empty batch; the code path returns early and nothing asserts its output.
- **Hypothesis (untested):** a test that passes an empty batch and expects an empty file; re-verify the early return first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** src/export.ts:41
- **Evidence:** read the function and its existing tests; no failure was reproduced.
- **Context:** Filed by /review-and-prep on https://github.com/example-org/example-repo/pull/42 at a1b2c3d (2026-11-01).
- **Effort:** ? (user triages in /roadmap)

Under `blocking=shown`, `/review-and-prep` writes `### [review:files=<a.ts|b.ts>] Base issue: <short title>` (or `### [review] Base issue: <short title>` when a path cannot form a `files=` value) for a finding already present at the merge base; it routes KEEP with source `review`.

### [review:files=src/export.ts|src/export-format.ts] Base issue: header row lacks newline on empty input
- **ID:** wi-e5f607
- **Base issue:** present at merge base `a0b1c2d`; filed under `blocking=shown`
- **Description:** `formatHeader` omits the trailing newline when the row list is empty, failing the CSV parser check at both the head and the merge base.
- **Evidence:** `bun test tests/export.test.ts` fails at `a1b2c3d` and at merge base `a0b1c2d`.
- **Upstream severity:** CRITICAL
- **Found in:** src/export-format.ts:18
- **Context:** Filed by /review-and-prep on https://github.com/example-org/example-repo/pull/42 at a1b2c3d (2026-11-01).
- **Effort:** ? (user triages in /roadmap)

### [manual] Explore webhook outbound events for v1.1
- **ID:** wi-f60718
- **Why:** customer ask from two accounts.
- **Effort:** L (human: ~1 week / CC: ~1 hr)
- **Priority:** P3

### [plan-ceo-review:track=4A,defer=true] Per-tenant isolation for cache layer
- **ID:** wi-071829
- **Description:** original Track 4A scope included tenant-scoped cache keys. Cut during CEO review to keep PR sized correctly (~600 LOC vs ~250 cap).
- **Hypothesis (untested):** may need tenant-scoped keys; verify that the selected target actually includes multiple tenants before proposing implementation.
- **Revisit when:** the project admits a second tenant, or isolation is shown necessary for the current supported workflow.
- **Effort:** M (human: ~1 day / CC: ~30 min)
- **Found in:** `~/.gstack/projects/<slug>/ceo-plans/2026-05-10-track-4a.md` §"Deferred"
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
recorded in `${GSTACK_STATE_ROOT:-$HOME/.gstack}/projects/<slug>/roadmap/dedupe-log.jsonl`.

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
- `INJECTION_ATTEMPT` — tag contains a nested `[`, a `;`, a backtick, or `$(`.
  A stray `]` or a `,` inside a value is `MALFORMED_TAG` instead.

The skill surfaces validator failures during triage and blocks until resolved.

## Work-item IDs and `_blocked-by:` contract (`work-item-id/v1`)

Every `TODOS.md` entry, per-record intake file, `## Future` bullet, active `ROADMAP.md` Track card, and shipped Track record carries an immutable work-item ID so consumers and planning tools can track items across promotions, deferrals, and Track-label renumbering. Run `bin/roadmap-id migrate` once per project to assign IDs to records created before this contract.

### Format and immutability

- **Regex:** `^wi-[0-9a-f]{4,8}$` (fixed `wi-` prefix followed by 4 to 8 lowercase hex characters; filename-safe and unambiguous against Track labels like `96A` or Group numbers like `96`).
- **Default length and collision growth.** New IDs default to 6 lowercase hex characters (`wi-a1b2c3`). On collision with an ID in the current planning files, `docs/todos/`, the local Git history, or the same mint/migrate batch, the generator tries 7 and then 8 characters before drawing fresh entropy.
- **Immutability.** An assigned ID travels unchanged when an item moves to another planning file, is promoted, or ships. Track labels (`96A`, `97B`) remain recyclable display text.

### Field shapes across planning documents

| Document | Record shape | ID field placement |
|---|---|---|
| `TODOS.md` / `docs/TODOS.md` | `### [source:tag] Title` (under `## Unprocessed` and `## Completed`) | `- **ID:** wi-<hex>` as the first attribute bullet |
| `docs/todos/wi-<hex>.md` | `### [source:tag] Title` | `- **ID:** wi-<hex>` on the next nonblank line, matching the filename stem |
| `docs/roadmap-future.md` (or inline `## Future`) | `- **Title** — body **Revisit when:** ...` | Inline `**ID:** wi-<hex>` immediately after the title dash separator (`- **Title** — **ID:** wi-<hex> — body`). For a plain legacy bullet, place the ID after a dash at the end of the prose, before any `**Revisit when:**` marker. |
| `docs/ROADMAP.md` | `#### Track <label>: Title` | `_id: wi-<hex>_` on the line immediately after the `_...risk..._` metadata line (`_id:` before metadata fails `STRUCTURE`) |
| `docs/roadmap-shipped.md` | `### Track <label>: Title ✓ Shipped ...` | `_id: wi-<hex>_` immediately under the heading |
| `docs/roadmap-shipped.md` (legacy) | `- Track <label> — _shipped ..._` under `#### Group N:` | Inline `**ID:** wi-<hex>` immediately after the dash separator (`- Track <label> — **ID:** wi-<hex> — ...`) |

### `_blocked-by:` grammar

```
_blocked-by: <ref>[, <ref>...]_
```

- **Canonical write form.** `/roadmap` writes work-item IDs (`_blocked-by: wi-a1b2c3, wi-d4e5f6_`). Dependencies on existing predecessors without IDs can still use Track labels.
- **Reader compatibility:** `src/audit/parsers/roadmap.ts`, `bin/roadmap-audit`, and `bin/roadmap-pack` accept both `wi-[0-9a-f]{4,8}` work-item IDs and legacy Track labels (`Track 95C`, `95C`, `11A.2`), resolving live work-item IDs to their current Track labels for packing and filtering satisfied shipped IDs identically to shipped Track labels.
- **Renumber invariance:** `bin/roadmap-renumber` treats `_id:` as immutable and never rewrites `wi-` IDs on `_blocked-by:` lines when renumbering Track or Group labels.
- **Validation:** unrecognized tokens on `_blocked-by:` (such as `wi-12`, `wi-ZZZZ`, or unknown IDs) fail `## STRUCTURE`.

### Audit enforcement (`## WORK_ITEM_IDS`)

`bin/roadmap-audit` emits a canonical `## WORK_ITEM_IDS` section after `TODO_FORMAT` and before `MODE`. It checks TODO headings under `## Unprocessed` and `## Completed`, per-record intake files, Future bullets, active and shipped Track headings, and legacy shipped `- Track` bullets. Fenced examples are outside the record collection.

- `MISSING_ID` — a record lacks its structured ID field.
- `MALFORMED_ID` — an ID field does not match `^wi-[0-9a-f]{4,8}$`.
- `DUPLICATE_ID` — two records share the same ID (within or across documents, including `## Completed` and colliding archive records), or a single record carries multiple ID fields.
- `ID_MISMATCH` — an intake file's filename stem and body carry different IDs.

Missing, malformed, duplicate, or mismatched IDs all produce `STATUS: fail`.
When any `MISSING_ID` finding is present, the section also includes the hint:
``- Hint: run `bin/roadmap-id migrate` to assign work-item IDs to existing records.``

### CLI (`bin/roadmap-id`)

- `bin/roadmap-id mint [repo-path] [--count N]` — prints `N` (default `1`) unique `wi-` IDs to stdout after reserving IDs from the current `TODOS.md`, `ROADMAP.md`, `roadmap-future.md`, and `roadmap-shipped.md` files at the project root and under `docs/`, filename stems and body IDs in `docs/todos/`, and the local Git history. Writes no files.
- `bin/roadmap-id migrate [repo-path] [--dry-run]` — one-time idempotent migration that assigns work-item IDs to existing planning records lacking an ID across `TODOS.md`, `ROADMAP.md`, `roadmap-future.md`, and `roadmap-shipped.md` without changing any other text. Emits `ASSIGNED <relpath>:<line> <id> <kind> <label>` per target followed by `MIGRATED <n>` (or `DRY_RUN <n>` with `--dry-run`, which writes nothing and does not keep the previewed IDs). All-or-nothing: if any record or document is refused, each refusal is printed as `REFUSED <relpath>:<line> <kind> <reason>` followed by `roadmap-id migrate: <n> records refused; no files were written` on stderr and no file is modified.
- `bin/roadmap-id --help | -h` — prints usage to stdout, exits `0`, writes nothing.

**Exit codes:** `0` on success (including `MIGRATED 0`), `1` on a refusal, read/write error, shallow clone, Git history failure, or refused intake path (with empty stdout), and `2` on invalid arguments.

**History scope:** `mint` and `migrate` scan original file contents and paths of commits reachable from any local ref in the current clone. This includes the enclosing repository when a project is nested and IDs recorded only in retired intake filenames. Git replacement objects cannot hide original history. Commit messages, other clones' unpushed refs, and submodule histories are excluded. The CLI exits `1` with shallow history or missing Git objects. Fetch the missing history or objects before retrying. A directory outside any Git repository uses current files only.

Run the launcher from the gstack-extend installation. For a consumer project,
pass its path to `<gstack-extend checkout>/bin/roadmap-id migrate`. Migration
targets the four planning documents above. For a missing intake ID, add the
filename stem as the entry's `- **ID:**` field.

Apply stages all replacements before publishing them. If an interrupted write
leaves a staging directory, check its `original` backup against the current
document before retrying. A failed rollback reports any retained staging paths.
If all documents were updated and only staging cleanup failed, migration emits
the assignments and warns about the retained paths.

**Accepted migration shapes:**

| Kind | Document | Accepted shape | Inserted text |
|---|---|---|---|
| TODO heading (T-a) | `TODOS.md` | `### …` under `## Unprocessed` or `## Completed` whose next nonblank line before the entry boundary starts `- ` | `- **ID:** <id>` immediately before that bullet |
| TODO heading (T-b) | `TODOS.md` | Next nonblank line before the boundary is other text (e.g. a `**What:**` paragraph) | `- **ID:** <id>` plus one blank line immediately before that text |
| TODO heading (T-c) | `TODOS.md` | Only blank lines before the boundary | `- **ID:** <id>` immediately after the heading |
| Future, bold title | `roadmap-future.md`, `ROADMAP.md` inline `## Future` | `- **Title** — body` (code-masked), including titles with code spans and bodies starting with `**Revisit when:**` | `**ID:** <id> — ` immediately after the title dash separator |
| Future, plain title | same | `- Title — body` whose dash separator comes before any `**Revisit when:**` | ` — **ID:** <id>` at the end of trimmed prose before the marker or line end (or `**ID:** <id> — ` when prose after the dash is empty) |
| ROADMAP Track heading | `ROADMAP.md` | First nonblank planning line after the heading is a `_…_` metadata line (not `_id:` or `_touches:`) | `_id: <id>_` immediately after that metadata line |
| Shipped-archive Track heading | `roadmap-shipped.md` | `### Track <label>: …` | `_id: <id>_` immediately after the heading |
| Legacy shipped bullet | `ROADMAP.md`, `roadmap-shipped.md` | `- Track <label> — …` under a shipped `#### Group N:` | `**ID:** <id> — ` immediately after the dash separator |

**Refused migration shapes (no files written):**

- A Future bullet with no title dash separator before `**Revisit when:**`, including a bold title followed by a colon.
- A `ROADMAP.md` Track heading without a metadata line.
- A shipped-archive Track heading at a level other than `###`.
- A legacy shipped Track bullet under a Group heading at a level other than `####`.
- A duplicate-label Track (`extraTrackWorkItems`) that lacks an ID.
- Dual root and `docs/` copies of the same planning document.
- A symlinked or non-regular planning document, or a symlinked/non-directory `docs/`.
- A document that is not valid UTF-8.
- Any insertion that fails read-back verification.

See [Compatibility](compatibility.md#stable-surfaces).

## Per-record intake files (`intake-files/v1`)

- The directory is `docs/todos/`, relative to the repository root. It may be
  absent or empty. Either case preserves the `TODOS.md` inbox behavior.
- Each record is a regular file named `wi-<4-8 lowercase hex>.md`, using the
  `work-item-id/v1` grammar. The `.gitkeep` entry is ignored. A non-directory
  intake path, a symlinked `docs/` parent of existing intake, symlinked records,
  subdirectories, non-Markdown files and other filenames fail validation.
  The exact directory names `docs/` and `todos/` also apply on case-insensitive
  filesystems.
- The first nonblank line is `### [source:tag] Title`, using the source-tag
  grammar above (including source-only tags). The next nonblank line is
  `- **ID:** wi-<hex>` and matches the filename stem. Additional attributes
  and optional prose follow. Each file holds exactly one top-level H3 item without a
  `# TODOS` or `## Unprocessed` wrapper or YAML frontmatter.
- `/review-and-prep` writes recorded test gaps, base-only findings and
  review-filed follow-ups as individual files. Consumers that collect the
  entire inbox read these files alongside `TODOS.md ## Unprocessed`.
- `/roadmap` reports priority and landing across both sources and removes
  drained files in the same commit that places, defers, kills or discharges
  their records. `bin/roadmap-id mint` reserves filename stems and body IDs
  from open intake files in addition to the live planning documents.
- `bin/roadmap-audit` reports `INTAKE_FILES` in `UNPROCESSED` and `TODO_FORMAT`
  when it has intake entries to check. `TODO_FORMAT` and `WORK_ITEM_IDS` check
  shape and unique identity. With a roadmap, `--scan-state` includes the intake
  count in `signals.unprocessed_count`. `DOC_INVENTORY` labels readable intake
  Markdown files `intake doc`. `SCATTERED_TODOS` and `DOC_TYPE_MISMATCH` skip
  those files.
