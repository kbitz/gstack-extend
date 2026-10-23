# Plan: Export widgets as CSV

Card: add `widget export --csv` so operators can pull every widget into a
spreadsheet without a database client.

**Acceptance:**

1. `widget export --csv` writes a header row and one row per widget to stdout.
2. A write failure exits non-zero and prints a `FIX:` line on stderr.
3. Existing `widget list` output is unchanged.

Verify: `bun run test`
