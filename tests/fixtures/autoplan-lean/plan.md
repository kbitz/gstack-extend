# Plan: Export widgets as CSV

Card: add `widget export --csv` so operators can pull every widget into a
spreadsheet without a database client.

## Acceptance criteria

1. `widget export --csv` writes a header row and one row per widget to stdout.
2. A write failure exits non-zero and prints a `FIX:` line on stderr.
3. Existing `widget list` output is unchanged.

Tier: standard
Verify command: `bun run test`

## Accepted decisions

- [ceo] d1: HOLD SCOPE: CSV only; JSON export stays out of scope and is deferred.
- [ceo] d2: Keep the command under `widget`, not a new top-level verb.
- [dx] d3: The error message names the failing path and the retry command.
- [eng] d4: Stream rows as they are read instead of buffering the whole table,
  so memory stays flat for large stores.

## Implementation tasks

- [ ] Add the `export` subcommand with a `--csv` flag (src/cli/widget.ts; AC1, d2; surfaced by ceo).
- [ ] Stream rows through the CSV writer (src/export/csv.ts; AC1, d4; surfaced by eng).
- [ ] Add tests for header, rows, quoting and the write-failure path (tests/export.test.ts; AC1–3, d3; surfaced by eng).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAR | mode: HOLD_SCOPE, 0 critical gaps |
| Outside Review | codex | Independent 2nd opinion | 2 | completed | 4 findings; 4 resolved; 0 unresolved |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 3 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | skipped | no UI scope |
| DX Review | `/plan-devex-review` | Developer experience gaps | 1 | CLEAR | score: 6/10 → 8/10, TTHW: 3 min → 2 min |

- **VERDICT:** CEO + DX + ENG CLEARED — ready to implement.

NO UNRESOLVED DECISIONS
