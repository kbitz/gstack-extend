/**
 * task-list.ts — port of check_task_list (~L1214-1361).
 *
 * Single-pass scan of ROADMAP.md emitting one TASK row per discovered task.
 * Output is consumed by /roadmap during reorg, so the row format is the
 * structural contract:
 *
 *   TASK: group=<num>|track=<id>|title=<...>|effort=<S|M|L|XL|?>|files=<csv>|complete=<0|1>
 *
 * Rules:
 *   - Group heading sets `group_num`; section transitions reset state.
 *   - `**Pre-flight**` opens a pseudo-track named `preflight`; bullet lines
 *     inside it (no `**`) are emitted as `effort=S|files=|track=preflight`.
 *   - `### Track NA[.M]:` opens a real track.
 *   - `## Future` switches to `group=future|track=none`. `## Unprocessed`
 *     stops the scan. `## Execution Map` and any other `## ` reset section
 *     to `none` so subsequent bullets are skipped.
 *   - Task lines (`- **Title**`) parse the title before the closing `**`,
 *     a trailing `(S|M|L|XL)` for effort (else `?`), and an italic
 *     `_[a, b, c]_` files block. `complete=1` iff the enclosing Group is
 *     marked ✓ Complete in its heading (track-level complete is ignored
 *     here — bash matches that exactly).
 *   - Pre-flight bullets (`- ` + non-`*`) → `effort=S, files=`,
 *     track=preflight.
 */

import type { AuditCtx, CheckResult } from '../types.ts';

type Section = 'none' | 'skip' | 'group' | 'preflight' | 'track' | 'future';

// Heading-depth-agnostic: v1 uses ## Group / ### Track, v2 uses
// ### Group / #### Track inside state H2 sections.
const GROUP_RE = /^#{2,4} Group ([0-9]+):/;
const PREFLIGHT_RE = /^\*\*Pre-flight\*\*/i;
const TRACK_RE = /^#{3,5} Track ([0-9]+[A-Z](?:\.[0-9]+)?):/;
const FUTURE_RE = /^## Future/i;
const UNPROCESSED_RE = /^## Unprocessed/i;
const EXEC_MAP_RE = /^## Execution Map/i;
const STATE_SECTION_RE = /^## (Shipped|In Progress|Current Plan)/;
const TASK_BOLD_RE = /^- \*\*([^*]+)\*\*/;
const TASK_EFFORT_RE = /\((S|M|L|XL)\)$/;
const TASK_FILES_RE = /_\[([^\]]+)\]/;
const PREFLIGHT_TASK_RE = /^- [^*]/;

export function runCheckTaskList(ctx: AuditCtx): CheckResult {
  if (ctx.paths.roadmap === null) {
    return {
      section: 'TASK_LIST',
      status: 'skip',
      body: ['TOTAL_TASKS: 0', 'TOTAL_CURRENT: 0', 'TOTAL_FUTURE: 0'],
    };
  }

  const completeGroups = new Set<string>();
  for (const g of ctx.roadmap.value.groups) {
    if (g.isComplete) completeGroups.add(g.num);
  }

  let section: Section = 'none';
  let groupNum = '';
  let trackId = '';
  let inPreflight = false;
  let totalTasks = 0;
  let totalCurrent = 0;
  let totalFuture = 0;
  const taskLines: string[] = [];

  const emitTask = (
    g: string,
    t: string,
    title: string,
    effort: string,
    files: string,
    complete: boolean,
  ) => {
    taskLines.push(
      `TASK: group=${g}|track=${t}|title=${title}|effort=${effort}|files=${files}|complete=${complete ? 1 : 0}`,
    );
  };

  const lines = ctx.files.roadmap.split('\n');
  for (const line of lines) {
    const groupMatch = line.match(GROUP_RE);
    if (groupMatch !== null) {
      groupNum = groupMatch[1]!;
      section = 'group';
      inPreflight = false;
      trackId = '';
      continue;
    }

    if (PREFLIGHT_RE.test(line)) {
      inPreflight = true;
      trackId = 'preflight';
      section = 'preflight';
      continue;
    }

    const trackMatch = line.match(TRACK_RE);
    if (trackMatch !== null) {
      trackId = trackMatch[1]!;
      section = 'track';
      inPreflight = false;
      continue;
    }

    if (FUTURE_RE.test(line)) {
      section = 'future';
      groupNum = 'future';
      trackId = 'none';
      inPreflight = false;
      continue;
    }
    if (UNPROCESSED_RE.test(line)) break;
    if (EXEC_MAP_RE.test(line)) {
      section = 'skip';
      continue;
    }
    if (/^## /.test(line)) {
      section = 'none';
      continue;
    }
    if (section === 'none' || section === 'skip') continue;

    // Bold task line.
    const taskMatch = line.match(TASK_BOLD_RE);
    if (taskMatch !== null) {
      const title = taskMatch[1]!;
      const effortMatch = line.match(TASK_EFFORT_RE);
      const effort = effortMatch !== null ? effortMatch[1]! : '?';
      const filesMatch = line.match(TASK_FILES_RE);
      const files = filesMatch !== null ? filesMatch[1]! : '';
      const g = groupNum === '' ? '0' : groupNum;
      const t = trackId === '' ? 'none' : trackId;
      const complete = completeGroups.has(g);
      emitTask(g, t, title, effort, files, complete);
      totalTasks++;
      if (section === 'future') totalFuture++;
      else totalCurrent++;
      continue;
    }

    // Pre-flight bullet (no bold).
    if (inPreflight && PREFLIGHT_TASK_RE.test(line)) {
      const title = line.replace(/^- /, '');
      const g = groupNum === '' ? '0' : groupNum;
      const complete = completeGroups.has(g);
      emitTask(g, 'preflight', title, 'S', '', complete);
      totalTasks++;
      totalCurrent++;
      continue;
    }
  }

  const body: string[] = [
    ...taskLines,
    `TOTAL_TASKS: ${totalTasks}`,
    `TOTAL_CURRENT: ${totalCurrent}`,
    `TOTAL_FUTURE: ${totalFuture}`,
  ];

  return { section: 'TASK_LIST', status: 'info', body };
}
