/**
 * roadmap.ts — port of _parse_roadmap from bin/roadmap-audit.
 *
 * Single-pass scan of ROADMAP.md content. Produces:
 *   - groups: top-level Groups with deps, serialize flag, ✓ Complete state
 *   - tracks: Tracks with touches/deps/size accumulators
 *   - styleLintWarnings: parser-emitted style hints
 *   - sizeLabelMismatches: per-task effort-vs-declared-LOC divergence
 *   - trackDepCycles: canonicalized intra-group dep cycles
 *
 * Parser is pure: takes content string, returns a value-only result. cli.ts
 * resolves the file path, reads the file, and calls parseRoadmap(content).
 *
 * LC_ALL=C parity contract:
 *   - Whitespace classes use [ \t\v\f\r] (ASCII), not \s (Unicode-broader).
 *   - String comparisons (lex-min in cycle canonicalization) are byte-wise
 *     via JS `<` on plain strings, which is UTF-16-code-unit order; on
 *     ASCII track IDs this matches bash byte-order.
 *   - parseInt(x, 10) only after explicit /^[0-9]+$/ validation.
 *
 * Source-of-truth for the grammar is docs/source-tag-contract.md and the
 * inline comments in bin/roadmap-audit (see _parse_roadmap, lines 1677-2014).
 */

import { effortToLoc, type ConfigDeps } from '../lib/effort.ts';
import type { ParseError, ParserResult } from '../types.ts';

// ─── Public types ─────────────────────────────────────────────────────

export type GroupDeps =
  | { kind: 'unspecified' } // no _Depends on:_ line
  | { kind: 'none' } // explicit "none" / "—" / "-"
  | { kind: 'list'; depNums: string[] };

export type GroupDepAnchor = {
  depNum: string;
  name: string;
};

export type GroupInfo = {
  num: string;
  name: string;
  isComplete: boolean;
  deps: GroupDeps;
  depsRaw: string | null;
  depAnchors: GroupDepAnchor[];
  serialize: boolean;
  hasPreflight: boolean;
  trackIds: string[];
};

export type TrackInfo = {
  id: string;
  groupNum: string;
  isComplete: boolean;
  touches: string[];
  filesCount: number;
  tasksCount: number;
  loc: number;
  legacy: boolean;
  deps: string[];
  depsFreetext: boolean;
};

export type SizeLabelMismatch = {
  trackId: string;
  title: string;
  effort: 'S' | 'M' | 'L' | 'XL';
  declaredLines: number;
  expectedLoc: number;
};

export type ParsedRoadmap = {
  groups: GroupInfo[];
  tracks: TrackInfo[];
  styleLintWarnings: string[];
  sizeLabelMismatches: SizeLabelMismatch[];
  trackDepCycles: string[];
};

// ─── Helpers (bash parity) ────────────────────────────────────────────

const WS = '[ \\t\\v\\f\\r]';
const COMPLETE_SUFFIX_RE = new RegExp(`${WS}+✓${WS}Complete${WS}*$`);

function trim(s: string): string {
  // Bash _trim: sed 's/^[[:space:]]*//; s/[[:space:]]*$//'
  return s.replace(new RegExp(`^${WS}+|${WS}+$`, 'g'), '');
}

function extractLinesHint(line: string): number | null {
  // Bash: grep -oE '~[0-9]+[[:space:]]*lines?' | head -1 | grep -oE '[0-9]+'
  const m = line.match(new RegExp(`~([0-9]+)${WS}*lines?`));
  if (!m) return null;
  return Number.parseInt(m[1]!, 10);
}

// ─── Cycle detection ──────────────────────────────────────────────────

function canonicalizeCycle(nodes: string[]): string {
  if (nodes.length === 0) return '';
  let minIdx = 0;
  for (let i = 1; i < nodes.length; i++) {
    if (nodes[i]! < nodes[minIdx]!) minIdx = i;
  }
  const out: string[] = [];
  for (let i = 0; i < nodes.length; i++) {
    out.push(nodes[(minIdx + i) % nodes.length]!);
  }
  // Append closing edge back to anchor — matches bash "${out} → ${nodes[$min_idx]}".
  return `${out.join(' → ')} → ${nodes[minIdx]!}`;
}

function detectTrackDepCycles(trackDeps: Map<string, string[]>): string[] {
  const cycles = new Set<string>();

  function walk(node: string, stack: string[]) {
    const deps = trackDeps.get(node) ?? [];
    for (const dep of deps) {
      const depIdx = stack.indexOf(dep);
      if (depIdx >= 0) {
        // Cycle: extract path from dep to tip.
        const cycleNodes = stack.slice(depIdx);
        const rendered = canonicalizeCycle(cycleNodes);
        cycles.add(rendered);
        continue;
      }
      walk(dep, [...stack, dep]);
    }
  }

  for (const root of trackDeps.keys()) {
    walk(root, [root]);
  }

  return [...cycles];
}

// ─── Main parser ──────────────────────────────────────────────────────

export type ParseRoadmapDeps = ConfigDeps;

export function parseRoadmap(
  content: string,
  deps: ParseRoadmapDeps = {},
): ParserResult<ParsedRoadmap> {
  const errors: ParseError[] = [];
  const styleLintWarnings: string[] = [];
  const sizeLabelMismatches: SizeLabelMismatch[] = [];

  // Group state.
  const groupOrder: string[] = [];
  const groupNames = new Map<string, string>();
  const completeGroups = new Set<string>();
  const groupDepsRaw = new Map<string, string>();
  const groupDeps = new Map<string, GroupDeps>();
  const groupDepAnchors = new Map<string, GroupDepAnchor[]>();
  const groupSerialize = new Set<string>();
  const groupHasPreflight = new Set<string>();
  const groupTracks = new Map<string, string[]>();

  // Track state.
  const trackOrder: string[] = [];
  const completeTracks = new Set<string>();
  const trackGroup = new Map<string, string>();
  const trackTouches = new Map<string, string[]>();
  const trackFilesCount = new Map<string, number>();
  const trackTasks = new Map<string, number>();
  const trackLoc = new Map<string, number>();
  const trackLegacy = new Map<string, boolean>();
  const trackDeps = new Map<string, string[]>();
  const trackDepsFreetext = new Set<string>();

  // Walk lines.
  type Section = 'none' | 'skip' | 'group' | 'preflight' | 'track';
  let section: Section = 'none';
  let groupNum = '';
  let trackId = '';

  if (content === '') {
    return {
      value: {
        groups: [],
        tracks: [],
        styleLintWarnings: [],
        sizeLabelMismatches: [],
        trackDepCycles: [],
      },
      errors,
    };
  }

  const lines = content.split('\n');

  for (const line of lines) {
    // Top-level skip sections.
    if (/^## (Future|Unprocessed|Execution Map)/i.test(line)) {
      section = 'skip';
      trackId = '';
      continue;
    }

    // Group heading.
    const groupHeading = line.match(/^## Group ([0-9]+):(.*)$/);
    if (groupHeading) {
      groupNum = groupHeading[1]!;
      let groupName = trim(groupHeading[2]!);
      let isComplete = false;
      if (COMPLETE_SUFFIX_RE.test(groupName)) {
        isComplete = true;
        groupName = groupName.replace(COMPLETE_SUFFIX_RE, '');
        groupName = trim(groupName);
      }
      if (!groupOrder.includes(groupNum)) {
        groupOrder.push(groupNum);
        groupNames.set(groupNum, groupName);
        if (isComplete) completeGroups.add(groupNum);
      }
      section = 'group';
      trackId = '';
      continue;
    }

    // Any other H2 heading — reset.
    if (/^## /.test(line)) {
      section = 'none';
      trackId = '';
      continue;
    }

    // Group-level _Depends on:_ line.
    if (
      section === 'group' &&
      trackId === '' &&
      /^_Depends on:/i.test(line)
    ) {
      // sed -E 's/^_Depends on:[[:space:]]*//; s/_[[:space:]]*$//'
      let raw = line.replace(/^_Depends on:[ \t\v\f\r]*/i, '');
      raw = raw.replace(/_[ \t\v\f\r]*$/, '');
      const rawTrim = trim(raw);
      groupDepsRaw.set(groupNum, rawTrim);

      if (/^(none|—|-+)$/i.test(rawTrim)) {
        groupDeps.set(groupNum, { kind: 'none' });
      } else {
        const depNums: string[] = [];
        const anchors: GroupDepAnchor[] = [];
        for (const entry of rawTrim.split(',')) {
          const entryTrim = trim(entry);
          // Group N | Group N (Name) | either with trailing prose
          if (/^Group [0-9]+([ \t\v\f\r]*\([^)]*\))?([ \t\v\f\r].*)?$/i.test(entryTrim)) {
            const numMatch = entryTrim.match(/^Group ([0-9]+)/i);
            if (numMatch) {
              const depNum = numMatch[1]!;
              depNums.push(depNum);
              const parenMatch = entryTrim.match(/^Group [0-9]+[ \t\v\f\r]*\(([^)]*)\)/i);
              if (parenMatch) {
                anchors.push({ depNum, name: trim(parenMatch[1]!) });
              }
            }
          }
        }
        if (depNums.length > 0) {
          groupDeps.set(groupNum, { kind: 'list', depNums });
          if (anchors.length > 0) {
            groupDepAnchors.set(groupNum, [
              ...(groupDepAnchors.get(groupNum) ?? []),
              ...anchors,
            ]);
          }
        } else {
          // Non-empty annotation with zero valid refs — warn.
          styleLintWarnings.push(
            `Group ${groupNum}: _Depends on:_ annotation was unparseable ("${rawTrim}") — expected "none" or "Group N[, Group M]"`,
          );
        }
      }
      continue;
    }

    // Group-level _serialize: true_ escape hatch.
    if (
      section === 'group' &&
      trackId === '' &&
      /^_serialize:[ \t\v\f\r]*true_[ \t\v\f\r]*$/i.test(line)
    ) {
      if (groupNum !== '') groupSerialize.add(groupNum);
      continue;
    }

    // Pre-flight marker.
    if (/^\*\*Pre-flight\*\*/i.test(line)) {
      section = 'preflight';
      trackId = '';
      if (groupNum !== '') groupHasPreflight.add(groupNum);
      continue;
    }

    // Track heading.
    const trackHeading = line.match(/^### Track ([0-9]+[A-Z](?:\.[0-9]+)?):/);
    if (trackHeading) {
      trackId = trackHeading[1]!;
      if (COMPLETE_SUFFIX_RE.test(line)) {
        completeTracks.add(trackId);
      }
      if (trackOrder.includes(trackId)) {
        styleLintWarnings.push(
          `${trackId}: duplicate track ID (another track earlier in ROADMAP.md also uses '${trackId}') — rename one; track IDs must be globally unique`,
        );
      } else {
        trackOrder.push(trackId);
      }
      trackGroup.set(trackId, groupNum || '0');
      trackTouches.set(trackId, []);
      trackTasks.set(trackId, 0);
      trackLoc.set(trackId, 0);
      trackFilesCount.set(trackId, 0);
      trackLegacy.set(trackId, true);
      if (groupNum !== '') {
        const cur = groupTracks.get(groupNum) ?? [];
        cur.push(trackId);
        groupTracks.set(groupNum, cur);
      }
      section = 'track';
      continue;
    }

    if (trackId !== '' && section === 'track') {
      // _touches:_ line.
      if (/^_touches:/.test(line)) {
        let raw = line.replace(/^_touches:[ \t\v\f\r]*/, '');
        raw = raw.replace(/_[ \t\v\f\r]*$/, '');
        const touchesList: string[] = [];
        let malformed = false;
        for (const f of raw.split(',')) {
          const ft = trim(f);
          if (ft === '') continue;
          // Reject internal whitespace or `=` (kv-store separators).
          if (/[ \t\v\f\r=]/.test(ft)) {
            malformed = true;
            continue;
          }
          touchesList.push(ft);
        }
        if (touchesList.length === 0) {
          styleLintWarnings.push(
            `${trackId}: _touches:_ line is empty or whitespace-only — track remains legacy (add file paths to opt into SIZE/COLLISIONS checks)`,
          );
          continue;
        }
        if (malformed) {
          styleLintWarnings.push(
            `${trackId}: _touches:_ contained tokens with whitespace or '=' — those entries were dropped (kv-store limitation)`,
          );
        }
        trackTouches.set(trackId, touchesList);
        trackFilesCount.set(trackId, touchesList.length);
        trackLegacy.set(trackId, false);
        continue;
      }

      // _Depends on:_ track-scoped line.
      if (/^_?Depends on:/i.test(line)) {
        const trackRefRe = /Depends on:[ \t\v\f\r]*Track [0-9]+[A-Z](?:\.[0-9]+)?/i;
        if (trackRefRe.test(line)) {
          const m = line.match(/Track ([0-9]+[A-Z](?:\.[0-9]+)?)/i);
          if (m) {
            const depId = m[1]!;
            if (depId === trackId) {
              styleLintWarnings.push(
                `${trackId}: Depends on itself (Track ${depId}) — typo or stale reference?`,
              );
            } else {
              const depGroupMatch = depId.match(/^([0-9]+)/);
              const trackGroupMatch = trackId.match(/^([0-9]+)/);
              if (
                depGroupMatch &&
                trackGroupMatch &&
                depGroupMatch[1] === trackGroupMatch[1]
              ) {
                const existing = trackDeps.get(trackId) ?? [];
                if (!existing.includes(depId)) {
                  existing.push(depId);
                  trackDeps.set(trackId, existing);
                }
              }
            }
          }
        } else {
          // _Depends on:_ but no Track ID — record exclusion flag.
          trackDepsFreetext.add(trackId);
        }
      }
    }

    // Task line within a track.
    if (
      trackId !== '' &&
      section === 'track' &&
      /^- \*\*/.test(line)
    ) {
      const titleMatch = line.match(/^- \*\*([^*]+)\*\*/);
      if (!titleMatch) continue;
      const title = titleMatch[1]!;
      const effortMatch = line.match(/\((S|M|L|XL)\)[ \t\v\f\r]*$/);
      const effort = effortMatch ? (effortMatch[1] as 'S' | 'M' | 'L' | 'XL') : null;
      const declaredLines = extractLinesHint(line);

      trackTasks.set(trackId, (trackTasks.get(trackId) ?? 0) + 1);

      if (effort !== null) {
        const expectedLoc = effortToLoc(effort, deps);
        trackLoc.set(trackId, (trackLoc.get(trackId) ?? 0) + expectedLoc);

        // Label mismatch: declared "~N lines" vs effort tier divergence >3x.
        if (declaredLines !== null && declaredLines > 0 && expectedLoc > 0) {
          const ratioNum = Math.max(declaredLines, expectedLoc);
          const ratioDen = Math.min(declaredLines, expectedLoc);
          if (ratioNum > ratioDen * 3) {
            sizeLabelMismatches.push({
              trackId,
              title,
              effort,
              declaredLines,
              expectedLoc,
            });
          }
        }
      }
    }
  }

  // Post-parse: expand `_serialize: true_` into intra-group track edges.
  for (const g of groupSerialize) {
    const gTracks = groupTracks.get(g);
    if (!gTracks || gTracks.length === 0) continue;
    let prev = '';
    for (const t of gTracks) {
      if (prev !== '') {
        const existing = trackDeps.get(t) ?? [];
        if (!existing.includes(prev)) {
          existing.push(prev);
          trackDeps.set(t, existing);
        }
      }
      prev = t;
    }
  }

  // Post-parse: cycle detection on intra-group dep DAG.
  const trackDepCycles = detectTrackDepCycles(trackDeps);

  // Assemble final shape.
  const groups: GroupInfo[] = groupOrder.map((num) => ({
    num,
    name: groupNames.get(num) ?? '',
    isComplete: completeGroups.has(num),
    deps: groupDeps.get(num) ?? { kind: 'unspecified' },
    depsRaw: groupDepsRaw.get(num) ?? null,
    depAnchors: groupDepAnchors.get(num) ?? [],
    serialize: groupSerialize.has(num),
    hasPreflight: groupHasPreflight.has(num),
    trackIds: groupTracks.get(num) ?? [],
  }));

  const tracks: TrackInfo[] = trackOrder.map((id) => ({
    id,
    groupNum: trackGroup.get(id) ?? '0',
    isComplete: completeTracks.has(id),
    touches: trackTouches.get(id) ?? [],
    filesCount: trackFilesCount.get(id) ?? 0,
    tasksCount: trackTasks.get(id) ?? 0,
    loc: trackLoc.get(id) ?? 0,
    legacy: trackLegacy.get(id) ?? true,
    deps: trackDeps.get(id) ?? [],
    depsFreetext: trackDepsFreetext.has(id),
  }));

  return {
    value: {
      groups,
      tracks,
      styleLintWarnings,
      sizeLabelMismatches,
      trackDepCycles,
    },
    errors,
  };
}

// ─── Transitive dep helper (used by checks/collisions) ────────────────

export function trackDependsOn(
  parsed: ParsedRoadmap,
  from: string,
  to: string,
): boolean {
  const adj = new Map<string, string[]>();
  for (const t of parsed.tracks) adj.set(t.id, t.deps);
  const visited = new Set<string>();
  const queue: string[] = [from];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const dep of adj.get(node) ?? []) {
      if (dep === to) return true;
      queue.push(dep);
    }
  }
  return false;
}
