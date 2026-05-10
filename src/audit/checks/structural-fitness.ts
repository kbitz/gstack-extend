/**
 * structural-fitness.ts — port of check_structural_fitness (~L1362-1504).
 *
 * Counts active (non-✓ Complete) Groups, their Tracks, and tasks. Emits
 * GROUP_COUNT, TRACK_COUNT, TASK_COUNT plus per-group and per-track
 * task counts when any are present, plus IMBALANCE_RATIO when 2+ groups.
 *
 * Bash uses a fresh line-by-line scan that excludes ✓ Complete Groups
 * entirely (their tasks/tracks aren't active workload). We replicate
 * that exact scan; the parsed roadmap doesn't pre-compute these counts
 * because they vary by the include-complete-groups question.
 *
 * Output shape:
 *   STATUS: info        ← always (skip when no ROADMAP.md)
 *   GROUP_COUNT: N
 *   TRACK_COUNT: N
 *   TASK_COUNT: N
 *   GROUP_SIZES: 1=2,2=3   ← only if group_count > 0
 *   TRACK_SIZES: 1A=1,...  ← only if track_count > 0
 *   IMBALANCE_RATIO: X.YY  ← only if group_count >= 2
 */

import type { AuditCtx, CheckResult } from '../types.ts';

// Heading-depth-agnostic: v1 uses ## Group / ### Track, v2 uses
// ### Group / #### Track inside state H2 sections.
const GROUP_RE = /^#{2,4} Group ([0-9]+):/;
const TRACK_RE = /^#{3,5} Track ([0-9]+[A-Z](?:\.[0-9]+)?):/;
const PREFLIGHT_RE = /^\*\*Pre-flight\*\*/i;
const STOP_RE = /^## (Future|Unprocessed|Execution Map)/i;

export function runCheckStructuralFitness(ctx: AuditCtx): CheckResult {
  if (ctx.paths.roadmap === null) {
    return { section: 'STRUCTURAL_FITNESS', status: 'skip', body: [] };
  }

  const completeGroups = new Set<string>();
  for (const g of ctx.roadmap.value.groups) {
    if (g.isComplete) completeGroups.add(g.num);
  }

  let groupCount = 0;
  let trackCount = 0;
  let taskCount = 0;
  let curGroup = '';
  let curTrack = '';
  let section: 'none' | 'group' | 'track' | 'preflight' = 'none';
  let inPreflight = false;
  let skipGroup = false;
  // Insertion-order maps preserve emission sequence.
  const groupSizes = new Map<string, number>();
  const trackSizes = new Map<string, number>();

  for (const line of ctx.files.roadmap.split('\n')) {
    const gm = line.match(GROUP_RE);
    if (gm !== null) {
      curGroup = gm[1]!;
      if (completeGroups.has(curGroup)) {
        skipGroup = true;
        section = 'none';
        continue;
      }
      skipGroup = false;
      groupCount++;
      groupSizes.set(curGroup, 0);
      section = 'group';
      inPreflight = false;
      curTrack = '';
      continue;
    }
    const tm = line.match(TRACK_RE);
    if (tm !== null) {
      if (skipGroup) continue;
      curTrack = tm[1]!;
      trackCount++;
      trackSizes.set(curTrack, 0);
      section = 'track';
      inPreflight = false;
      continue;
    }
    if (PREFLIGHT_RE.test(line)) {
      if (skipGroup) continue;
      inPreflight = true;
      section = 'preflight';
      continue;
    }
    if (STOP_RE.test(line)) break;

    if (skipGroup || section === 'none') continue;

    if (/^- \*\*/.test(line)) {
      taskCount++;
      if (curGroup !== '') groupSizes.set(curGroup, (groupSizes.get(curGroup) ?? 0) + 1);
      if (!inPreflight && curTrack !== '') {
        trackSizes.set(curTrack, (trackSizes.get(curTrack) ?? 0) + 1);
      }
      continue;
    }
    if (inPreflight && /^- [^*]/.test(line)) {
      taskCount++;
      if (curGroup !== '') groupSizes.set(curGroup, (groupSizes.get(curGroup) ?? 0) + 1);
      continue;
    }
  }

  const body: string[] = [];
  body.push(`GROUP_COUNT: ${groupCount}`);
  body.push(`TRACK_COUNT: ${trackCount}`);
  body.push(`TASK_COUNT: ${taskCount}`);

  if (groupCount > 0) {
    const sizes = [...groupSizes.entries()].map(([k, v]) => `${k}=${v}`).join(',');
    body.push(`GROUP_SIZES: ${sizes}`);
    if (trackCount > 0) {
      const tsizes = [...trackSizes.entries()].map(([k, v]) => `${k}=${v}`).join(',');
      body.push(`TRACK_SIZES: ${tsizes}`);
    }
    if (groupCount >= 2) {
      let max = 0;
      let min = 999999;
      for (const v of groupSizes.values()) {
        if (v > max) max = v;
        if (v < min) min = v;
      }
      if (min > 0) {
        // Bash: printf "%d.%02d" with $((max*100/min/100)) and $((max*100/min%100))
        const ratioInt = Math.floor((max * 100) / min);
        const whole = Math.floor(ratioInt / 100);
        const frac = ratioInt % 100;
        const fracStr = frac < 10 ? `0${frac}` : `${frac}`;
        body.push(`IMBALANCE_RATIO: ${whole}.${fracStr}`);
      } else {
        body.push('IMBALANCE_RATIO: inf');
      }
    }
  }

  return { section: 'STRUCTURAL_FITNESS', status: 'info', body };
}
