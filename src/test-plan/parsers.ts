/**
 * test-plan/parsers.ts — pure-function ports of two awk pipelines from
 * scripts/test-test-plan-e2e.sh.
 *
 * These power tests/test-plan-e2e.test.ts (which migrates the e2e bash
 * test). They live as a separate module so they can be unit-tested
 * directly with ugly-input fixtures (codex's #7 mitigation), not just
 * exercised transitively through e2e.
 *
 * Port targets:
 *
 *  1. parseGroupTracks(roadmap) — replaces the awk range pattern
 *     `/^## Group N:/,/^## [^G]/ { if ($0 ~ /^### Track .../) print }`.
 *     Returns every Group with its Tracks, parsed top-to-bottom.
 *
 *  2. scanPairReviewSession(dir, branch) — replaces the awk
 *     state-machine in `scan_pair_review`. Walks `<dir>/groups/*.md` and
 *     `<dir>/parked-bugs.md`, emitting (status, description) pairs.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ─── parseGroupTracks ────────────────────────────────────────────────

export type Track = {
  /** `1A` / `2C.1` etc. */
  id: string;
  /** Track title after the colon, trimmed. */
  title: string;
};

export type Group = {
  /** Group title after `## Group N:`, trimmed. */
  title: string;
  tracks: Track[];
};

const GROUP_HEADING_RE = /^## Group (\d+):\s*(.+?)\s*$/;
const TRACK_HEADING_RE = /^### Track (\d+[A-Z](?:\.\d+)?):\s*(.+?)\s*$/;

/**
 * Parse a ROADMAP-shape markdown into Groups + Tracks. Tracks are
 * collected per-group. A group's tracks include every `### Track ...:`
 * heading appearing AFTER the group's `## Group N:` line and BEFORE the
 * next `## ` heading at the same level (Group, end-of-section, etc.).
 *
 * Tolerates: trailing whitespace, completion suffixes (e.g.
 * `## Group 1: Foo ✓ Complete`), tracks with sub-IDs (`### Track 2A.1:`).
 *
 * Ignores everything that isn't a Group or Track heading at depth 2/3.
 * Code fences, prose, lists are passed over unchanged.
 *
 * Out of band: malformed group/track headings (missing colon, wrong
 * level) are silently skipped — the parser is forgiving by design,
 * matching bash awk behavior.
 */
export function parseGroupTracks(roadmap: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;

  for (const rawLine of roadmap.split('\n')) {
    const line = rawLine; // keep trailing whitespace handling in regex

    // A new top-level `## ` heading closes the current group's track
    // collection. If it's a Group heading, open a new group; otherwise
    // we drop into a no-current state until the next group starts.
    if (line.startsWith('## ')) {
      const gm = GROUP_HEADING_RE.exec(line);
      if (gm !== null) {
        // Strip the trailing " ✓ Complete" or similar markers from title.
        const titleRaw = gm[2]!;
        const title = titleRaw.replace(/\s+[✓✗].*$/, '').trim();
        current = { title, tracks: [] };
        groups.push(current);
      } else {
        current = null;
      }
      continue;
    }

    if (current !== null && line.startsWith('### Track ')) {
      const tm = TRACK_HEADING_RE.exec(line);
      if (tm !== null) {
        const titleRaw = tm[2]!;
        const title = titleRaw.replace(/\s+[✓✗].*$/, '').trim();
        current.tracks.push({ id: tm[1]!, title });
      }
    }
  }

  return groups;
}

// ─── scanPairReviewSession ───────────────────────────────────────────

export type PairReviewItem = {
  status: string;
  description: string;
};

const SESSION_BRANCH_RE = /^branch:\s*(.+?)\s*$/m;
const ITEM_HEADING_3_RE = /^###\s+\d+\.\s+(.+?)\s*$/; // "### 1. desc"
const ITEM_HEADING_2_RE = /^##\s+\d+\.\s+(.+?)\s*$/; // "## 1. desc"
const STATUS_LINE_RE = /^-\s*Status:\s*(.+?)\s*$/;

/**
 * Scan a `.context/pair-review[-archived-*]` directory. Returns the
 * `(status, description)` pairs from `groups/*.md` and `parked-bugs.md`,
 * but ONLY if the session.yaml `branch:` field matches the requested
 * branch. Mismatch → empty list (deliberate: branch filtering keeps
 * cross-branch sessions from leaking into the current report).
 *
 * Markdown shape (matches scripts/test-test-plan-e2e.sh fixtures):
 *
 *   groups/<g>.md:
 *     ### N. <description>
 *     - Status: PASSED|FAILED|SKIPPED|UNTESTED|...
 *
 *   parked-bugs.md:
 *     ## N. <description>
 *     - Status: PARKED|DEFERRED_TO_TODOS|FIXED|...
 *
 * State machine: the most recent matching item-heading sets the current
 * description; the next `- Status: X` line emits one record. Items
 * without a Status line are dropped (matches awk).
 *
 * Returns items in markdown-encounter order across all files (groups
 * walked alphabetically, then parked-bugs).
 */
export function scanPairReviewSession(dir: string, branch: string): PairReviewItem[] {
  // Branch gate: read session.yaml, bail if branch mismatch.
  const sessionPath = join(dir, 'session.yaml');
  if (!fileExists(sessionPath)) return [];
  let sessionYaml: string;
  try {
    sessionYaml = readFileSync(sessionPath, 'utf8');
  } catch {
    return [];
  }
  const bm = SESSION_BRANCH_RE.exec(sessionYaml);
  if (bm === null || bm[1] !== branch) return [];

  const out: PairReviewItem[] = [];

  // groups/*.md (markdown encounter order, sorted).
  const groupsDir = join(dir, 'groups');
  if (statSync(groupsDir, { throwIfNoEntry: false })?.isDirectory()) {
    const files = readdirSync(groupsDir).filter((n) => n.endsWith('.md')).sort();
    for (const f of files) {
      collectItems(join(groupsDir, f), ITEM_HEADING_3_RE, out);
    }
  }

  // parked-bugs.md (one less # per heading).
  const parkedPath = join(dir, 'parked-bugs.md');
  if (fileExists(parkedPath)) {
    collectItems(parkedPath, ITEM_HEADING_2_RE, out);
  }

  return out;
}

function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function collectItems(
  filePath: string,
  headingRe: RegExp,
  out: PairReviewItem[],
): void {
  const text = readFileSync(filePath, 'utf8');
  let currentDesc: string | null = null;
  for (const line of text.split('\n')) {
    const hm = headingRe.exec(line);
    if (hm !== null) {
      currentDesc = hm[1]!;
      continue;
    }
    const sm = STATUS_LINE_RE.exec(line);
    if (sm !== null && currentDesc !== null) {
      out.push({ status: sm[1]!, description: currentDesc });
    }
  }
}
