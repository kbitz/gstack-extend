/**
 * md-walk.ts — walk the repo for `.md` files at maxdepth 2 (mirrors
 * bash `find -maxdepth 2 -name '*.md' -type f`).
 *
 * Excludes: node_modules, .git, vendor, docs/archive, .context.
 * Returns absolute paths and the relative path from repoRoot for each
 * hit. Caller (cli.ts) reads contents into AuditCtx so checks stay pure.
 *
 * Bash sort behavior: `find ... | sort` under LC_ALL=C → byte-wise
 * lexicographic. JS `<` on plain ASCII matches that. Output is sorted by
 * relative path ascending.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export type MdFile = {
  abs: string;
  rel: string;
};

const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'vendor', '.context']);
const EXCLUDED_PATH_FRAGMENTS = ['/docs/archive/'];

function isExcludedPath(rel: string): boolean {
  for (const frag of EXCLUDED_PATH_FRAGMENTS) {
    if (`/${rel}/`.includes(frag)) return true;
  }
  return false;
}

export function walkMdFiles(repoRoot: string, maxDepth = 2): MdFile[] {
  const out: MdFile[] = [];
  if (!existsSync(repoRoot)) return out;

  function walk(dir: string, depth: number) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (EXCLUDED_DIRS.has(name)) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (depth >= maxDepth) continue;
        walk(full, depth + 1);
        continue;
      }
      if (!st.isFile()) continue;
      if (!name.endsWith('.md')) continue;
      const rel = relative(repoRoot, full);
      if (isExcludedPath(rel)) continue;
      out.push({ abs: full, rel });
    }
  }

  walk(repoRoot, 0);
  out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return out;
}
