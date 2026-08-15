/**
 * roadmap.ts — parser for ROADMAP.md.
 *
 * The document is organized by lifecycle state at the top level (active plan
 * first, shipped history last):
 *
 *   ## In Progress     — Groups/Phases mid-flight (some shipped Tracks, some not)
 *   ## Current Plan    — definitely doing this
 *   ## Future          — flat bullets only, no Phase/Group/Track structure
 *   ## Shipped         — completed work, IDs frozen
 *
 * Inside Shipped / In Progress / Current Plan, the structure is:
 *
 *   ### Phase N: Title    (optional outer envelope)
 *   ### Group N: Title    (work primitive)
 *   #### Track NA: Title  (one PR)
 *
 * Heading levels for Phase/Group/Track are detected by leading `#+ ` rather
 * than fixed depth.
 *
 * When no state sections are present, the document is in v1 grammar — the
 * parser still extracts Groups/Tracks (so the audit can read them) but the
 * STATE_SECTIONS check fails the run with MIGRATION_NEEDED. Inline `✓
 * Complete` markers on Group headings still mark Groups shipped in that
 * mode so the failure output is informative.
 *
 * Parser is pure: takes content string, returns a value-only result.
 */

import { effortToLoc, isMarkdownOnlyTouches, sessionWeight, type ConfigDeps } from '../lib/effort.ts';
import {
  effortFinding,
  isDoneMarkerTitle,
  parseEffortTag,
  parseTaskTitle,
} from '../lib/task-line.ts';
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
  sessionWeight: number;
  deleteOnly: boolean;
  markdownOnly: boolean;
  out: string[];
  readFirst: string[];
  produces: string | null;
  blockedBy: string[];
  legacy: boolean;
  deps: string[];
  depsFreetext: boolean;
  bannedPrSplit: boolean; // body contained "N PRs"/"two PRs"/"PR1"/"PR2"/etc.
  untaggedWriteTasks: number;
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
  hasV2Grammar: boolean; // true when at least one ## In Progress/Current Plan/Future/Shipped seen
  futureBullets: string[]; // raw bullet lines from ## Future (when v2)
  futureMalformed: string[]; // non-bullet content seen inside ## Future (validation hint)
  effortTagFindings: string[]; // named bad/aliased/done-marker effort tags
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

function stripItalic(line: string, prefix: RegExp): string {
  let raw = line.replace(prefix, '');
  raw = raw.replace(/_[ \t\v\f\r]*$/, '');
  return trim(raw);
}

function parseCommaList(line: string, prefix: RegExp): string[] {
  const raw = stripItalic(line, prefix);
  if (raw === '') return [];
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const p = trim(part);
    if (p !== '') out.push(p);
  }
  return out;
}

function parseCommaIds(line: string, prefix: RegExp): string[] {
  return parseCommaList(line, prefix);
}

function canonicalizeTrackId(raw: string): string {
  return raw.replace(/^([0-9]+)([A-Za-z])((?:\.[0-9]+)?)$/, (_m, n: string, letter: string, rest: string) => {
    return `${n}${letter.toUpperCase()}${rest}`;
  });
}

function parseTrackRefs(line: string): string[] {
  const ids: string[] = [];
  const push = (raw: string) => {
    const id = canonicalizeTrackId(raw);
    if (id !== '' && !ids.includes(id)) ids.push(id);
  };
  const re = /Track[ \t]+([0-9]+[A-Za-z](?:\.[0-9]+)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    push(m[1]!);
  }
  for (const part of parseCommaList(line, /^_blocked-by:/)) {
    const bare = part.replace(/^Track[ \t]+/i, '');
    if (/^[0-9]+[A-Za-z](?:\.[0-9]+)?$/.test(bare)) push(bare);
  }
  return ids;
}

const DELETE_HINT_RE = /\(del(?:etions?)?\)/i;

function isDeleteTask(line: string): boolean {
  return DELETE_HINT_RE.test(line);
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
        effortTagFindings: [],
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
  const trackWeight = new Map<string, number>();
  const trackDeleteTasks = new Map<string, number>();
  const trackUntaggedWrites = new Map<string, number>();
  const trackOut = new Map<string, string[]>();
  const trackReadFirst = new Map<string, string[]>();
  const trackProduces = new Map<string, string>();
  const trackBlockedBy = new Map<string, string[]>();
  const trackLegacy = new Map<string, boolean>();
  const trackDeps = new Map<string, string[]>();
  const trackDepsFreetext = new Set<string>();
  const trackBannedPrSplit = new Set<string>();

  // Future bullets and validation hints.
  const futureBullets: string[] = [];
  const futureMalformed: string[] = [];
  const effortTagFindings: string[] = [];

  type Section = 'none' | 'skip' | 'group' | 'track' | 'future';
  let section: Section = 'none';
  let groupNum = '';
  let trackId = '';

  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNo = i + 1;

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
      trackWeight.set(trackId, 0);
      trackDeleteTasks.set(trackId, 0);
      trackOut.set(trackId, []);
      trackReadFirst.set(trackId, []);
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
          const pathPart = ft.replace(/[ \t\v\f\r]*\(new\)[ \t\v\f\r]*$/i, '');
          if (pathPart === '' || /[ \t\v\f\r=]/.test(pathPart)) {
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

      // Card-contract fields (optional; /roadmap writes them on regen).
      if (/^_out:/.test(line)) {
        trackOut.set(trackId, parseCommaIds(line, /^_out:/));
        continue;
      }
      if (/^_read-first:/.test(line)) {
        trackReadFirst.set(trackId, parseCommaList(line, /^_read-first:/));
        continue;
      }
      if (/^_produces:/.test(line)) {
        let raw = line.replace(/^_produces:[ \t\v\f\r]*/, '');
        raw = raw.replace(/_[ \t\v\f\r]*$/, '');
        const p = trim(raw);
        if (p !== '') trackProduces.set(trackId, p);
        continue;
      }
      if (/^_blocked-by:/.test(line)) {
        trackBlockedBy.set(trackId, parseTrackRefs(line));
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
      const title = parseTaskTitle(line);
      if (title === null) continue;
      const parsed = parseEffortTag(line);
      const note = effortFinding(trackId, title, parsed);
      if (note !== null) effortTagFindings.push(note);

      if (isDoneMarkerTitle(title)) {
        continue;
      }

      const effort = parsed.kind === 'ok' || parsed.kind === 'alias' ? parsed.effort : null;
      const declaredLines = extractLinesHint(line);

      trackTasks.set(trackId, (trackTasks.get(trackId) ?? 0) + 1);

      const deleted = isDeleteTask(line);
      if (deleted) {
        trackDeleteTasks.set(trackId, (trackDeleteTasks.get(trackId) ?? 0) + 1);
      }

      if (effort !== null) {
        const expectedLoc = effortToLoc(effort, deps);
        trackLoc.set(trackId, (trackLoc.get(trackId) ?? 0) + expectedLoc);
        const weight = deleted ? sessionWeight('S') : sessionWeight(effort);
        trackWeight.set(trackId, (trackWeight.get(trackId) ?? 0) + weight);

        if (!deleted && declaredLines !== null && declaredLines > 0 && expectedLoc > 0) {
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
      } else if (deleted) {
        trackWeight.set(trackId, (trackWeight.get(trackId) ?? 0) + sessionWeight('S'));
      } else {
        trackUntaggedWrites.set(trackId, (trackUntaggedWrites.get(trackId) ?? 0) + 1);
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
      trackIds: groupTracks.get(num) ?? [],
    };
  });

  const tracks: TrackInfo[] = trackOrder.map((id) => {
    const state = trackState.get(id) ?? 'current-plan';
    const touches = trackTouches.get(id) ?? [];
    const tasksCount = trackTasks.get(id) ?? 0;
    const deleteTasks = trackDeleteTasks.get(id) ?? 0;
    return {
      id,
      groupNum: trackGroup.get(id) ?? '0',
      state,
      isComplete: state === 'shipped',
      touches,
      filesCount: trackFilesCount.get(id) ?? 0,
      tasksCount,
      loc: trackLoc.get(id) ?? 0,
      sessionWeight: trackWeight.get(id) ?? 0,
      deleteOnly: tasksCount > 0 && deleteTasks === tasksCount,
      markdownOnly: isMarkdownOnlyTouches(touches),
      out: trackOut.get(id) ?? [],
      readFirst: trackReadFirst.get(id) ?? [],
      produces: trackProduces.get(id) ?? null,
      blockedBy: trackBlockedBy.get(id) ?? [],
      legacy: trackLegacy.get(id) ?? true,
      deps: trackDeps.get(id) ?? [],
      depsFreetext: trackDepsFreetext.has(id),
      bannedPrSplit: trackBannedPrSplit.has(id),
      untaggedWriteTasks: trackUntaggedWrites.get(id) ?? 0,
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
      effortTagFindings,
    },
    errors,
  };
}

/** Merge a shipped-archive parse into the active roadmap parse (IDs from
 *  the archive fill gaps; active file wins on collision). */
export function mergeShippedArchive(
  active: ParserResult<ParsedRoadmap>,
  archive: ParserResult<ParsedRoadmap>,
): ParserResult<ParsedRoadmap> {
  const seenGroups = new Set(active.value.groups.map((g) => g.num));
  const seenTracks = new Set(active.value.tracks.map((t) => t.id));
  const groups = [...active.value.groups];
  const tracks = [...active.value.tracks];
  const collisionWarnings: string[] = [];
  for (const g of archive.value.groups) {
    if (seenGroups.has(g.num)) {
      collisionWarnings.push(
        `archive Group ${g.num} collides with active ROADMAP — active wins, archive copy dropped`,
      );
      continue;
    }
    groups.push({ ...g, state: 'shipped', isComplete: true });
  }
  for (const t of archive.value.tracks) {
    if (seenTracks.has(t.id)) {
      collisionWarnings.push(
        `archive Track ${t.id} collides with active ROADMAP — active wins, archive copy dropped`,
      );
      continue;
    }
    tracks.push({ ...t, state: 'shipped', isComplete: true });
  }
  return {
    value: {
      ...active.value,
      groups,
      tracks,
      styleLintWarnings: [...active.value.styleLintWarnings, ...collisionWarnings],
      sizeLabelMismatches: [...active.value.sizeLabelMismatches],
    },
    errors: [...active.errors],
  };
}

