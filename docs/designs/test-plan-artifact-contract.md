# test-plan Artifact Contract (v1)

This is the owned file-format specification for `/test-plan run` artifacts. Upstream
skills that consume these files (`/qa-only`, `/qa`, a future `/test-plan retro`,
`/pair-review`) follow this contract. The contract is versioned via the `schema`
front-matter field. Breaking changes bump the schema integer.

## File 1: Batch test plan

### Path

`~/.gstack/projects/<slug>/<user>-<branch>-test-plan-batch-<YYYYMMDD-HHMMSS>.md`

- `<slug>` is the project slug (from `gstack-slug` or basename of repo root).
- `<branch>` is the current git branch with `/` replaced by `-`.
- `<user>` is `whoami`.
- Timestamp is UTC.

Why this path: `/qa-only` globs `~/.gstack/projects/<slug>/*-test-plan-*.md` for
test-plan context. The `-test-plan-batch-` token distinguishes `/test-plan` output
from `/plan-eng-review` output (which uses `-eng-review-test-plan-`).

### Front-matter schema

```yaml
---
schema: 1
name: test-plan-batch
group: <group-slug>
group_title: <human Group title from ROADMAP.md>
generated: <ISO 8601 UTC>
generated_by: /test-plan run
build_branch: <branch the bug-bash runs against>
build_commit: <short hash of build_branch's HEAD at generation time>
manifest: <absolute path to the Group's manifest.yaml>
stats:
  review_docs_harvested: <int>
  items_total: <int>
  items_automated: <int>
  items_manual: <int>
  items_deferred: <int>
  items_carried_from_prior: <int>
---
```

All fields required. Consumers must reject files missing any required field.

### Section order (required)

```
# Test Plan: <group_title>

## Affected Pages/Routes
## Key Interactions to Verify
## Edge Cases
## Critical Paths
## Known Deferred
## Automated (v2, not yet executed)
## Manual (for /pair-review)
## Items Surfaced From Prior Sessions (user decision required)
## Provenance Index
```

Empty sections retain their heading with `_none_` as the body. This makes consumer
parsing deterministic.

### Item entry format

Inside any of the content sections (not Provenance Index), each item is:

```markdown
- [`<item-id>`] [<tag1>] [<tag2>] <description>
```

- `<item-id>` is the 8-char sha256 stable ID.
- Tags use the curly-brace bullet style: `[from ceo-review: <filename>]`, `[from diff]`, `[retest-after-fix]`, `[from parked-bug: <branch>]`.
- `<description>` is imperative, 1-2 sentences, testable in 1-2 minutes.

### Provenance Index format

Markdown table:

```
| ID | Source | Rationale |
|----|--------|-----------|
| `<item-id>` | `<source_doc_path>` §<section_heading> | "<rationale_quote>" |
```

Rationale quotes MUST be verbatim from the source doc. Truncate with `…` if longer than ~200 chars, but always start the quote at the first meaningful word.

## File 2: Group manifest

### Path

`~/.gstack/projects/<slug>/groups/<group-slug>/manifest.yaml`

Directory is created on first `/test-plan run` invocation for a Group.

### Schema

```yaml
schema: 1
group: <group-slug>
group_title: <Group title from ROADMAP.md>
created: <ISO 8601 UTC>
tracks:
  - id: 1A
    name: <Track name from ROADMAP.md>
    branch: <git branch name>
    review_docs:
      - <absolute or project-relative path>
      - ...
  - id: 1B
    ...
```

- `review_docs` can be empty (no reviews yet). Consumers MUST handle empty lists.
- `branch` may be `main` if the Track merged and the branch was deleted.
- Track `id` matches the `\d+[A-Z]` regex (roadmap-audit enforces this upstream).

Manifest is re-creatable. Re-running `/test-plan run` with the "Recreate" option
builds it fresh (archiving the old file is not required — the file is always
regenerated deterministically from ROADMAP.md + user branch-name answers).

## Stable item ID scheme

```
id_input = <branch> + "|" + <source_doc_path> + "|" + <section_heading> + "|" + <normalized_description>
item_id  = first 8 hex chars of sha256(id_input)
```

Where:
- `<branch>` is the Track branch the doc belongs to (for review-derived items) or `"diff"` for diff-derived items.
- `<source_doc_path>` is the absolute path to the source document, or `"diff"` for diff-derived items.
- `<section_heading>` is the Markdown heading text (no `#` prefix) the rationale sits under, or the changed file path for diff-derived items.
- `<normalized_description>` is the description lowercased, whitespace-collapsed to single spaces, trimmed.

IDs are deterministic: the same inputs always produce the same ID. Consumers can
use IDs for cross-session dedup, retro-style diffing, and cache keys.

## Provenance tag taxonomy

The canonical set of tag patterns:

- `[from diff]` — derived from file changes in the integrated build
- `[from ceo-review: <file>]` — derived from a CEO plan doc
- `[from eng-review: <file>]` — derived from an eng review
- `[from design-review: <file>]` — derived from a design review
- `[from design-doc: <file>]` — derived from an in-repo `docs/designs/*.md`
- `[from parked-bug: <branch>]` — carried forward from a prior pair-review session on a Track branch
- `[retest-after-fix]` — a FAILED item that was fixed in a prior session, re-queued because the integrated build differs from the verified build
- `[regression-candidate]` — same as retest-after-fix but explicitly flagged as potential regression because other Track branches modified overlapping files

Items may carry multiple tags (e.g., an item derived from both an eng review and a
CEO review gets two `[from …]` tags). Always list provenance tags before the
description.

## Consumer contracts

### /qa-only (passive consumer)

- Globs `~/.gstack/projects/<slug>/*-test-plan-*.md` for context.
- Must NOT parse item IDs or provenance tags for functional behavior — those are
  /test-plan's internal identity/provenance, not qa-only's concern.
- Should prefer the most recent `-test-plan-batch-*.md` file for the current branch.

### /pair-review (active consumer)

- Reads `.context/pair-review/groups/<group-slug>.md` (not the
  `-test-plan-batch-*.md` file — that's project-scoped and shared; the groups file
  is session-scoped).
- Honors `plan_source: test-plan` in `session.yaml` (skips its own Phase 1 Test
  Plan Generation when set).
- Surfaces item IDs in its group-file format as comments:
  `<!-- test-plan-id: <id> -->` under each item's metadata block. This lets a
  future retro subcommand diff pair-review's outcomes against /test-plan's
  original plan.

### /test-plan retro (v2, future consumer)

- Reads both the batch plan file and pair-review's session report.
- Diffs items by ID.
- Outputs "what would you change?" recommendations + writes a retro note back
  into the batch plan's front-matter (`retro_notes: [...]` field).

## Versioning

- `schema: 1` is the v1 contract (this document).
- Breaking changes bump `schema`. Consumers must check and reject unknown schemas
  rather than silently mis-parsing.
- Non-breaking additions (new optional front-matter fields, new optional section)
  do NOT bump schema — consumers must tolerate unknown fields/sections.

Current version: **schema 1** (2026-04-21, introduced with `/test-plan` v1).
