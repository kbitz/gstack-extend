/**
 * shared-infra.ts — load `docs/shared-infra.txt` patterns and resolve them
 * to a sorted, deduplicated list of relative file paths.
 *
 * docs/shared-infra.txt syntax:
 *   - One pattern per line.
 *   - `#` starts a comment (rest of line ignored).
 *   - Blank lines ignored.
 *   - `*` matches any chars including `/`. `**` is no different (treated as `*`).
 *   - `{a,b}` brace-expands to `a` and `b`.
 *
 * Bash uses `eval` for brace expansion + `find -path` for matching.
 * Here brace expansion is implemented inline (no eval, no shell-out) and
 * matching is done by walking the repo file list once via `Bun.Glob`.
 *
 * Security caps (mirror bash):
 *   - Reject patterns with characters outside `[a-zA-Z0-9/._{}*,+-]`.
 *   - Reject patterns containing `..`.
 *   - Cap brace expansion at 1000 entries per pattern.
 *
 * Returns `{ status: 'missing' }` when docs/shared-infra.txt does not
 * exist; `{ status: 'loaded', files: Set<relpath> }` otherwise.
 */

import { Glob } from 'bun';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type SharedInfra =
  | { status: 'missing' }
  | { status: 'loaded'; files: Set<string> };

export type LoadDeps = {
  warn?: (msg: string) => void;
};

const SAFE_PATTERN = /^[a-zA-Z0-9/._{}*,+-]+$/;
const EXPAND_CAP = 1000;

// Hand-rolled brace expansion. Handles nested + multiple groups; rejects
// numeric ranges (`{1..N}`) since they're caught by the `..` filter above.
function expandBraces(pat: string): string[] {
  const open = pat.indexOf('{');
  if (open < 0) return [pat];
  // Find matching close, respecting nesting.
  let depth = 1;
  let close = -1;
  for (let i = open + 1; i < pat.length; i++) {
    const c = pat[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) return [pat]; // Unbalanced — emit as-is.
  const before = pat.slice(0, open);
  const inner = pat.slice(open + 1, close);
  const after = pat.slice(close + 1);
  // Split inner on commas at depth 0.
  const parts: string[] = [];
  {
    let d = 0;
    let start = 0;
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i];
      if (c === '{') d++;
      else if (c === '}') d--;
      else if (c === ',' && d === 0) {
        parts.push(inner.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(inner.slice(start));
  }
  const out: string[] = [];
  for (const p of parts) {
    for (const e of expandBraces(before + p + after)) {
      out.push(e);
    }
  }
  return out;
}

export function loadSharedInfra(repoRoot: string, deps: LoadDeps = {}): SharedInfra {
  const path = join(repoRoot, 'docs', 'shared-infra.txt');
  if (!existsSync(path)) return { status: 'missing' };
  const warn = deps.warn ?? ((msg: string) => process.stderr.write(msg + '\n'));

  const content = readFileSync(path, 'utf8');
  const all = new Set<string>();
  for (const rawLine of content.split('\n')) {
    const noComment = rawLine.replace(/#.*/, '');
    const pat = noComment.replace(/^[ \t\v\f\r]+|[ \t\v\f\r]+$/g, '');
    if (pat === '') continue;
    if (!SAFE_PATTERN.test(pat)) {
      warn(`SHARED_INFRA_WARN: skipping pattern with unsafe characters: '${pat}'`);
      continue;
    }
    if (pat.includes('..')) {
      warn(`SHARED_INFRA_WARN: skipping pattern containing '..': '${pat}'`);
      continue;
    }
    const expanded = expandBraces(pat);
    if (expanded.length > EXPAND_CAP) {
      warn(`SHARED_INFRA_WARN: pattern '${pat}' expanded past ${EXPAND_CAP} entries — truncating`);
    }
    let count = 0;
    for (const sub of expanded) {
      if (count >= EXPAND_CAP) break;
      count++;
      // Bash's `find -path` matches against absolute paths, but we walk
      // relative paths via Bun.Glob — strip a leading "./" if present and
      // rely on Glob's relative-path semantics. Bash's `*` matches
      // including slashes (`-path` semantics), so we use `**` glob style
      // for parity: any literal `*` becomes `**` so subdir traversal works.
      const globPat = sub.replace(/\*+/g, '**');
      const glob = new Glob(globPat);
      for (const match of glob.scanSync({ cwd: repoRoot, onlyFiles: true })) {
        all.add(match);
      }
    }
  }
  return { status: 'loaded', files: all };
}
