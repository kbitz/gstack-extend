/**
 * todo-patterns.ts — port of count_todo_patterns (~bin/roadmap-audit L96-128).
 *
 * Counts TODO-like patterns in a markdown file's content, ignoring fenced
 * code blocks. Patterns counted (one per line max — the bash uses `next`
 * after each match):
 *   1. Checkboxes: `- [ ]` / `- [x]` / `- [X]`
 *   2. Inline markers: `(TODO|FIXME|HACK|XXX):` (word-boundary approximated
 *      via "start of line OR non-alnum/_ char before").
 *   3. Section headings: `## TODO`, `## Tasks`, `## Action Items`,
 *      `## Backlog` (case-insensitive, allow 1-3 # marks).
 *   4. Bold task + effort tier: `- **...** ... (S|M|L|XL)` with optional
 *      trailing whitespace.
 *
 * Fence handling: matches `^[ \t]*` ` ` ` (or `~~~`) of length ≥3. Closing
 * fence must match opening char and length ≥ opening — preserves bash
 * awk's run-length semantics. Lines inside fences contribute zero counts.
 *
 * Pure: takes the file content string, returns the count.
 */

const FENCE_RE = /^[ \t]*(`{3,}|~{3,})/;
const CHECKBOX_RE = /^[ \t\v\f\r ]*- \[[ xX]\]/;
const INLINE_MARKER_RE = /(^|[^a-zA-Z0-9_])(TODO|FIXME|HACK|XXX):/;
const SECTION_HEADING_RE = /^#{1,3} (todo|tasks|action items|backlog)/;
const BOLD_TASK_RE = /^[ \t\v\f\r ]*- \*\*.*\*\*.*\((?:S|M|L|XL)\)[ \t\v\f\r ]*$/;

export function countTodoPatterns(content: string): number {
  if (content === '') return 0;
  let count = 0;
  let inCode = false;
  let fenceLen = 0;
  let fenceChar = '';

  for (const line of content.split('\n')) {
    const fenceMatch = FENCE_RE.exec(line);
    if (fenceMatch !== null) {
      const raw = fenceMatch[1]!;
      const fl = raw.length;
      const fc = raw[0]!;
      if (!inCode) {
        inCode = true;
        fenceLen = fl;
        fenceChar = fc;
      } else if (fc === fenceChar && fl >= fenceLen) {
        inCode = false;
        fenceLen = 0;
        fenceChar = '';
      }
      continue;
    }
    if (inCode) continue;

    if (CHECKBOX_RE.test(line)) {
      count++;
      continue;
    }
    if (INLINE_MARKER_RE.test(line)) {
      count++;
      continue;
    }
    // Lowercase ASCII for section heading match (matches bash `tolower`).
    const lower = line.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) | 0x20));
    if (SECTION_HEADING_RE.test(lower)) {
      count++;
      continue;
    }
    if (BOLD_TASK_RE.test(line)) {
      count++;
      continue;
    }
  }
  return count;
}
