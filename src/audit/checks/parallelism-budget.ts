/**
 * parallelism-budget.ts — port of check_parallelism_budget (~L3101-3166).
 *
 * Counts in-flight Tracks across all in-flight Groups; flags when total
 * exceeds the parallelism cap (default 4, override via CLAUDE.md
 * `<!-- roadmap:parallelism_cap=N -->`). ✓ Complete Tracks aren't load.
 *
 * Output shape:
 *   skip → STATUS first, then IN_FLIGHT_TRACKS/CAP/FINDINGS in body.
 *   pass/fail → IN_FLIGHT_TRACKS/CAP/PER_GROUP[/COMPLETE_TRACKS] in
 *               preamble, STATUS, then FINDINGS in body.
 */

import { computeInFlight } from '../lib/in-flight.ts';
import type { AuditCtx, CheckResult } from '../types.ts';

export function runCheckParallelismBudget(ctx: AuditCtx): CheckResult {
  const cap = ctx.parallelismCap;
  const { inFlight } = computeInFlight(ctx.roadmap.value);

  if (inFlight.length === 0) {
    return {
      section: 'PARALLELISM_BUDGET',
      status: 'skip',
      body: [`IN_FLIGHT_TRACKS: 0`, `CAP: ${cap}`, 'FINDINGS:', '- No in-flight Groups'],
    };
  }

  // Per-group track count (✓ Complete Tracks excluded — paperwork shouldn't
  // gate concurrency reduction).
  const groupById = new Map(ctx.roadmap.value.groups.map((g) => [g.num, g]));
  const completeTracks = new Set(ctx.roadmap.value.tracks.filter((t) => t.isComplete).map((t) => t.id));

  let total = 0;
  const perGroup: string[] = [];
  for (const g of inFlight) {
    const info = groupById.get(g);
    let count = 0;
    if (info !== undefined) {
      for (const tid of info.trackIds) {
        if (!completeTracks.has(tid)) count++;
      }
    }
    total += count;
    perGroup.push(`${g}=${count}`);
  }

  // _COMPLETE_TRACKS line — bash emits in doc order via the parser-built
  // `_COMPLETE_TRACKS` string. We mirror by walking the parser's track
  // list and keeping doc order.
  const completeTracksList = ctx.roadmap.value.tracks.filter((t) => t.isComplete).map((t) => t.id);

  const preamble: string[] = [
    `IN_FLIGHT_TRACKS: ${total}`,
    `CAP: ${cap}`,
    `PER_GROUP: ${perGroup.join(' ')}`,
  ];
  if (completeTracksList.length > 0) {
    preamble.push(`COMPLETE_TRACKS: ${completeTracksList.join(' ')}`);
  }

  if (total > cap) {
    return {
      section: 'PARALLELISM_BUDGET',
      preamble,
      status: 'fail',
      body: [
        'FINDINGS:',
        `- ${total} in-flight tracks exceeds parallelism cap of ${cap}. Consider deferring tracks to a future Group, splitting work across more sequential Groups, marking shipped Tracks \`✓ Complete\` (in-place) so they stop counting, or raising the cap via \`<!-- roadmap:parallelism_cap=N -->\` in CLAUDE.md.`,
      ],
    };
  }
  return {
    section: 'PARALLELISM_BUDGET',
    preamble,
    status: 'pass',
    body: ['FINDINGS:', '- (none)'],
  };
}
