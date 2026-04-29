/**
 * progress.ts — parses PROGRESS.md.
 *
 * PROGRESS.md is a markdown table of releases. The audit needs:
 *   - latestVersion: highest version by semver across all table cells
 *   - rawTableLines: lines starting with `|` (used by check_taxonomy to
 *     detect identical-line overlap with CHANGELOG.md)
 *
 * Bash extracts versions via `grep -oE '\| [0-9]+\.[0-9]+(\.[0-9]+)*(\.[0-9]+)* \|'`
 * (note the leading + trailing pipe-space requirement). We mirror that.
 *
 * The version extraction regex is intentionally permissive on segment count
 * (`(\.[0-9]+)*` repeats) — it accepts 2, 3, 4, or more dot-separated
 * components. parseRoadmapVersion's caller (semver.versionGt) handles
 * canonicalization.
 */

import { versionGt } from '../lib/semver.ts';
import type { ParseError, ParserResult } from '../types.ts';

export type ParsedProgress = {
  versions: string[];
  latestVersion: string | null;
  rawTableLines: string[];
};

const VERSION_CELL_RE = /\| ([0-9]+\.[0-9]+(?:\.[0-9]+)*) \|/g;

export function parseProgress(content: string): ParserResult<ParsedProgress> {
  const errors: ParseError[] = [];

  if (content === '') {
    return {
      value: { versions: [], latestVersion: null, rawTableLines: [] },
      errors,
    };
  }

  const versions: string[] = [];
  const rawTableLines: string[] = [];

  for (const line of content.split('\n')) {
    if (line.startsWith('|')) {
      rawTableLines.push(line);
    }
    // Bash uses grep -oE with global match — collect every cell on every line.
    let m: RegExpExecArray | null;
    const re = new RegExp(VERSION_CELL_RE.source, 'g');
    while ((m = re.exec(line)) !== null) {
      versions.push(m[1]!);
    }
  }

  let latestVersion: string | null = null;
  for (const v of versions) {
    if (latestVersion === null || versionGt(v, latestVersion)) {
      latestVersion = v;
    }
  }

  return { value: { versions, latestVersion, rawTableLines }, errors };
}
