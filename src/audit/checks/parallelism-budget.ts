/**
 * parallelism-budget.ts — port of check_parallelism_budget (~L3101-3166).
 *
 * Counts in-flight Tracks across all ready Groups. The cap is
 * fillCap(parallelism_cap) — same number the packer fills to.
 * A single Group wider than the cap fails. The *sum* across ready
 * siblings does not: overflow bins are parallel by design.
 * ✓ Complete Tracks aren't load.
 *
 * Output shape:
 *   skip → STATUS first, then IN_FLIGHT_TRACKS/CAP/FINDINGS in body.
 *   pass/fail → IN_FLIGHT_TRACKS/CAP/PER_GROUP[/COMPLETE_TRACKS] in
 *               preamble, STATUS, then FINDINGS in body.
 */

import { computeInFlight } from '../lib/in-flight.ts';
import { fillCap } from '../lib/pack.ts';
import type { AuditCtx, CheckResult } from '../types.ts';

export function runCheckParallelismBudget(ctx: AuditCtx): CheckResult {
  const cap = fillCap(ctx.parallelismCap);
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

  const oversized = perGroup
    .map((entry) => {
      const eq = entry.indexOf('=');
      const g = entry.slice(0, eq);
      const n = Number.parseInt(entry.slice(eq + 1), 10);
      return { g, n };
    })
    .filter((x) => x.n > cap);

  if (oversized.length > 0) {
    return {
      section: 'PARALLELISM_BUDGET',
      preamble,
      status: 'fail',
      body: [
        'FINDINGS:',
        ...oversized.map(
          (x) =>
            `- Group ${x.g}: ${x.n} tracks exceeds fill cap ${cap} — split or raise \`<!-- roadmap:parallelism_cap=N -->\``,
        ),
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
