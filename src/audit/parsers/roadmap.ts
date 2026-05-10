/**
 * roadmap.ts — parser for ROADMAP.md, v2 state-section grammar.
 *
 * The document is organized by lifecycle state at the top level:
 *
 *   ## Shipped         — completed work, IDs frozen
 *   ## In Progress     — Groups/Phases mid-flight (some shipped Tracks, some not)
 *   ## Current Plan    — definitely doing this
 *   ## Future          — flat bullets only, no Phase/Group/Track structure
 *
 * Inside Shipped / In Progress / Current Plan, the structure is:
 *
 *   ### Phase N: Title    (optional outer envelope)
 *   ### Group N: Title    (work primitive)
 *   #### Track NA: Title  (one PR)
 *
 * v1 fallback: when no state sections are present, the parser accepts the
 * v1 grammar where Groups are at H2 (`## Group N`) and Tracks at H3
 * (`### Track NA`). Lifecycle state is then derived from inline markers:
 *   - Group with `✓ Complete` suffix → shipped
 *   - Group with any shipped Tracks but not `✓ Complete` → in-progress
 *   - Otherwise → current-plan
 *
 * Heading levels for Phase/Group/Track are detected by leading `#+ ` rather
 * than fixed depth — simplifies mixed-grammar docs and v1↔v2 transitions.
 *
 * Parser is pure: takes content string, returns a value-only result.
 */

import { effortToLoc, type ConfigDeps } from '../lib/effort.ts';
import { detectStateRegions, stateAtLine, type LifecycleState } from '../lib/state.ts';
import type { ParseError, ParserResult } from '../types.ts';

// ─── Public types ─────────────────────────────────────────────────────

export type GroupDeps =
  | { kind: 'unspecified' }
  | { kind: 'none' }
  | { kind: 'list'; depNums: string[] };

export type GroupDepAnchor = {
  depNum: string;
  name: string;
};

export type GroupInfo = {
  num: string;
  name: string;
  state: LifecycleState; // 'shipped' | 'in-progress' | 'current-plan'
  isComplete: boolean; // back-compat alias for state === 'shipped'
  isHotfix: boolean; // title starts with "Hotfix:"
  deps: GroupDeps;
  depsRaw: string | null;
  depAnchors: GroupDepAnchor[];
  serialize: boolean; // v1 `_serialize: true_` escape hatch
  hasPreflight: boolean; // v1 `**Pre-flight**` subsection
  trackIds: string[];
};

export type TrackInfo = {
  id: string;
  groupNum: string;
  state: LifecycleState; // shipped | in-progress | current-plan (inherited from Group, unless Track is inline ✓ Shipped)
  isComplete: boolean; // back-compat alias for state === 'shipped'
  touches: string[];
  filesCount: number;
  tasksCount: number;
  loc: number;
  legacy: boolean;
  deps: string[];
  depsFreetext: boolean;
  bannedPrSplit: boolean; // body contained "N PRs"/"two PRs"/"PR1"/"PR2"/etc.
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
  hasV2Grammar: boolean; // true when at least one ## Shipped/In Progress/Current Plan/Future seen
  futureBullets: string[]; // raw bullet lines from ## Future (when v2)
  futureMalformed: string[]; // non-bullet content seen inside ## Future (validation hint)
};

// ─── Helpers (bash parity) ────────────────────────────────────────────

const WS = '[ \\t\\v\\f\\r]';
const COMPLETE_SUFFIX_RE = new RegExp(`${WS}+✓${WS}(Complete|Shipped)(${WS}+\\(v[^)]+\\))?${WS}*$`);
const HOTFIX_PREFIX_RE = /^Hotfix:/i;
const PR_SPLIT_RE = /\b(PR1|PR2|PR-1|PR-2|[2-9] PRs|two PRs|three PRs|multiple PRs|several PRs)\b/i;

function trim(s: string): string {
  return s.replace(new RegExp(`^${WS}+|${WS}+$`, 'g'), '');
}

function extractLinesHint(line: string): number | null {
  const m = line.match(new RegExp(`~([0-9]+)${WS}*lines?`));
  if (!m) return null;
  return Number.parseInt(m[1]!, 10);
}

// Heading depth-agnostic patterns. v1 uses ##, v2 uses ### or ####.
const PHASE_HEADING_RE = /^#{2,4} Phase ([0-9]+):(.*)$/;
const GROUP_HEADING_RE = /^#{2,4} Group ([0-9]+):(.*)$/;
const TRACK_HEADING_RE = /^#{3,5} Track ([0-9]+[A-Z](?:\.[0-9]+)?):/;
const STATE_HEADING_RE = /^## (Shipped|In Progress|Current Plan|Future)/;

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
  return `${out.join(' → ')} → ${nodes[minIdx]!}`;
}

function detectTrackDepCycles(trackDeps: Map<string, string[]>): string[] {
  const cycles = new Set<string>();
  function walk(node: string, stack: string[]) {
    const deps = trackDeps.get(node) ?? [];
    for (const dep of deps) {
      const depIdx = stack.indexOf(dep);
      if (depIdx >= 0) {
        cycles.add(canonicalizeCycle(stack.slice(depIdx)));
        continue;
      }
      walk(dep, [...stack, dep]);
    }
  }
  for (const root of trackDeps.keys()) walk(root, [root]);
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

  if (content === '') {
    return {
      value: {
        groups: [],
        tracks: [],
        styleLintWarnings: [],
        sizeLabelMismatches: [],
        trackDepCycles: [],
        hasV2Grammar: false,
        futureBullets: [],
        futureMalformed: [],
      },
      errors,
    };
  }

  const regions = detectStateRegions(content);
  const hasV2Grammar = regions.kind === 'v2';

  // Group state.
  const groupOrder: string[] = [];
  const groupNames = new Map<string, string>();
  const groupHeadingLine = new Map<string, number>();
  const groupInlineComplete = new Set<string>(); // ✓ Complete inline marker
  const groupHotfix = new Set<string>();
  const groupSerialize = new Set<string>(); // v1 `_serialize: true_`
  const groupHasPreflight = new Set<string>(); // v1 `**Pre-flight**`
  const groupDepsRaw = new Map<string, string>();
  const groupDeps = new Map<string, GroupDeps>();
  const groupDepAnchors = new Map<string, GroupDepAnchor[]>();
  const groupTracks = new Map<string, string[]>();

  // Track state.
  const trackOrder: string[] = [];
  const trackHeadingLine = new Map<string, number>();
  const trackInlineComplete = new Set<string>();
  const trackGroup = new Map<string, string>();
  const trackTouches = new Map<string, string[]>();
  const trackFilesCount = new Map<string, number>();
  const trackTasks = new Map<string, number>();
  const trackLoc = new Map<string, number>();
  const trackLegacy = new Map<string, boolean>();
  const trackDeps = new Map<string, string[]>();
  const trackDepsFreetext = new Set<string>();
  const trackBannedPrSplit = new Set<string>();

  // Future bullets and validation hints.
  const futureBullets: string[] = [];
  const futureMalformed: string[] = [];

  type Section = 'none' | 'skip' | 'group' | 'preflight' | 'track' | 'future';
  let section: Section = 'none';
  let groupNum = '';
  let trackId = '';

  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNo = i + 1;
    const enclosingState = stateAtLine(regions, lineNo);

    // Top-level state section detection.
    const stateMatch = line.match(STATE_HEADING_RE);
    if (stateMatch !== null) {
      section = stateMatch[1] === 'Future' ? 'future' : 'none';
      trackId = '';
      groupNum = '';
      continue;
    }

    // Top-level v1 skip sections (Unprocessed, Execution Map) — only when no state grammar.
    if (!hasV2Grammar && /^## (Unprocessed|Execution Map)/i.test(line)) {
      section = 'skip';
      trackId = '';
      continue;
    }

    // Phase heading — recorded but not separately tracked at parser level
    // (parsers/phases.ts handles Phase parsing). Just don't let them confuse
    // Group state.
    if (PHASE_HEADING_RE.test(line)) {
      section = 'none';
      trackId = '';
      groupNum = '';
      continue;
    }

    // Group heading.
    const groupHeading = line.match(GROUP_HEADING_RE);
    if (groupHeading) {
      groupNum = groupHeading[1]!;
      let groupName = trim(groupHeading[2]!);
      let inlineComplete = false;
      if (COMPLETE_SUFFIX_RE.test(groupName)) {
        inlineComplete = true;
        groupName = groupName.replace(COMPLETE_SUFFIX_RE, '');
        groupName = trim(groupName);
      }
      if (!groupOrder.includes(groupNum)) {
        groupOrder.push(groupNum);
        groupNames.set(groupNum, groupName);
        groupHeadingLine.set(groupNum, lineNo);
        if (inlineComplete) groupInlineComplete.add(groupNum);
        if (HOTFIX_PREFIX_RE.test(groupName)) groupHotfix.add(groupNum);
      }
      section = 'group';
      trackId = '';
      continue;
    }

    // Any other H2 heading — reset group context (closes track/group block).
    if (/^## /.test(line)) {
      section = 'none';
      trackId = '';
      groupNum = '';
      continue;
    }

    // Group-level _Depends on:_ line.
    if (
      section === 'group' &&
      trackId === '' &&
      /^_Depends on:/i.test(line)
    ) {
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
          styleLintWarnings.push(
            `Group ${groupNum}: _Depends on:_ annotation was unparseable ("${rawTrim}") — expected "none" or "Group N[, Group M]"`,
          );
        }
      }
      continue;
    }

    // Group-level `_serialize: true_` escape hatch (v1 only — v2 forbids
    // intra-Group serialization via the structure check).
    if (
      section === 'group' &&
      trackId === '' &&
      /^_serialize:[ \t\v\f\r]*true_[ \t\v\f\r]*$/i.test(line)
    ) {
      if (groupNum !== '') groupSerialize.add(groupNum);
      continue;
    }

    // `**Pre-flight**` subsection marker (v1 only).
    if (/^\*\*Pre-flight\*\*/i.test(line)) {
      section = 'preflight';
      trackId = '';
      if (groupNum !== '') groupHasPreflight.add(groupNum);
      continue;
    }

    // Track heading.
    const trackHeading = line.match(TRACK_HEADING_RE);
    if (trackHeading) {
      trackId = trackHeading[1]!;
      if (COMPLETE_SUFFIX_RE.test(line)) {
        trackInlineComplete.add(trackId);
      }
      if (trackOrder.includes(trackId)) {
        styleLintWarnings.push(
          `${trackId}: duplicate track ID (another track earlier in ROADMAP.md also uses '${trackId}') — rename one; track IDs must be globally unique`,
        );
      } else {
        trackOrder.push(trackId);
        trackHeadingLine.set(trackId, lineNo);
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

      // _Depends on:_ track-scoped line (intra-Group dep — banned in v2).
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
          trackDepsFreetext.add(trackId);
        }
      }

      // PR-split language ban — flag any line in the Track body containing it.
      if (PR_SPLIT_RE.test(line)) {
        trackBannedPrSplit.add(trackId);
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

    // Future-section bullet capture (v2 only — flat bullets, nothing else).
    if (section === 'future') {
      const stripped = trim(line);
      if (stripped === '') continue;
      if (/^- /.test(stripped)) {
        futureBullets.push(stripped);
        continue;
      }
      // Anything inside ## Future that isn't a bullet is malformed.
      futureMalformed.push(stripped);
    }
  }

  // Post-parse: expand `_serialize: true_` into intra-group track edges (v1 compat).
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

  // Resolve lifecycle state per Group.
  const trackInlineCompleteSet = trackInlineComplete;
  const trackGroupForResolve = trackGroup;
  const groupTracksForResolve = groupTracks;

  const groupState = new Map<string, LifecycleState>();
  for (const num of groupOrder) {
    const headingLine = groupHeadingLine.get(num) ?? 1;
    const enclosing = stateAtLine(regions, headingLine);
    if (enclosing !== null && enclosing !== 'future') {
      groupState.set(num, enclosing);
      continue;
    }
    // v1 fallback: derive from inline markers.
    if (groupInlineComplete.has(num)) {
      groupState.set(num, 'shipped');
      continue;
    }
    const tids = groupTracksForResolve.get(num) ?? [];
    let anyShipped = false;
    let allShipped = tids.length > 0;
    for (const tid of tids) {
      if (trackInlineCompleteSet.has(tid)) anyShipped = true;
      else allShipped = false;
    }
    if (allShipped && tids.length > 0) {
      groupState.set(num, 'shipped');
    } else if (anyShipped) {
      groupState.set(num, 'in-progress');
    } else {
      groupState.set(num, 'current-plan');
    }
  }

  // Resolve lifecycle state per Track. Inherits Group state, with shipped
  // overriding when the Track's inline ✓ marker is present (in-progress
  // Group with mix of shipped and unshipped Tracks).
  const trackState = new Map<string, LifecycleState>();
  for (const tid of trackOrder) {
    const gnum = trackGroupForResolve.get(tid) ?? '';
    const gState = groupState.get(gnum) ?? 'current-plan';
    if (trackInlineCompleteSet.has(tid)) {
      trackState.set(tid, 'shipped');
    } else if (gState === 'shipped') {
      // Group is shipped → all Tracks shipped, even without inline marker.
      trackState.set(tid, 'shipped');
    } else {
      trackState.set(tid, gState);
    }
  }

  // Assemble final shape.
  const groups: GroupInfo[] = groupOrder.map((num) => {
    const state = groupState.get(num) ?? 'current-plan';
    return {
      num,
      name: groupNames.get(num) ?? '',
      state,
      isComplete: state === 'shipped',
      isHotfix: groupHotfix.has(num),
      deps: groupDeps.get(num) ?? { kind: 'unspecified' },
      depsRaw: groupDepsRaw.get(num) ?? null,
      depAnchors: groupDepAnchors.get(num) ?? [],
      serialize: groupSerialize.has(num),
      hasPreflight: groupHasPreflight.has(num),
      trackIds: groupTracks.get(num) ?? [],
    };
  });

  const tracks: TrackInfo[] = trackOrder.map((id) => {
    const state = trackState.get(id) ?? 'current-plan';
    return {
      id,
      groupNum: trackGroup.get(id) ?? '0',
      state,
      isComplete: state === 'shipped',
      touches: trackTouches.get(id) ?? [],
      filesCount: trackFilesCount.get(id) ?? 0,
      tasksCount: trackTasks.get(id) ?? 0,
      loc: trackLoc.get(id) ?? 0,
      legacy: trackLegacy.get(id) ?? true,
      deps: trackDeps.get(id) ?? [],
      depsFreetext: trackDepsFreetext.has(id),
      bannedPrSplit: trackBannedPrSplit.has(id),
    };
  });

  return {
    value: {
      groups,
      tracks,
      styleLintWarnings,
      sizeLabelMismatches,
      trackDepCycles,
      hasV2Grammar,
      futureBullets,
      futureMalformed,
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
