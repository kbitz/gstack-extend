/**
 * parallelism-cap.ts — read the `roadmap:parallelism_cap=N` override from
 * CLAUDE.md (root or docs/), defaulting to 4.
 *
 * Bash equivalent: `grep -oE 'roadmap:parallelism_cap=[0-9]+' "$claude_md"
 *                  | head -1 | cut -d= -f2`. Cap must be a positive
 * integer; non-positive or non-numeric values fall through to the default.
 *
 * Pure: takes CLAUDE.md content (or empty string for "no CLAUDE.md") and
 * returns the resolved cap.
 */

export const DEFAULT_PARALLELISM_CAP = 4;

const CAP_RE = /roadmap:parallelism_cap=([0-9]+)/;

export function parallelismCap(claudeMdContent: string): number {
  if (claudeMdContent === '') return DEFAULT_PARALLELISM_CAP;
  const m = CAP_RE.exec(claudeMdContent);
  if (m === null) return DEFAULT_PARALLELISM_CAP;
  const n = Number.parseInt(m[1]!, 10);
  if (Number.isNaN(n) || n <= 0) return DEFAULT_PARALLELISM_CAP;
  return n;
}
