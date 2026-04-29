/**
 * in-flight.ts — compute the in-flight Group frontier from a parsed
 * ParsedRoadmap. Used by check_in_flight_groups, check_parallelism_budget,
 * and check_parallelizable_future.
 *
 * Mirrors bash `_compute_in_flight_groups` semantics:
 *   - Groups iterated in NUMERIC sort order.
 *   - Effective deps: explicit if set; otherwise the immediately-preceding
 *     Group in numeric order; `_Depends on: none_` → no deps.
 *   - A Group is in-flight iff it isn't itself ✓ Complete AND every effective
 *     dep is in COMPLETE_GROUPS (and references an existing Group — unknown
 *     deps disqualify the Group from the frontier).
 *
 * Returns the in-flight list AND any `${g}→${dep}` entries where a dep
 * references a nonexistent Group (used by check_in_flight_groups for the
 * UNKNOWN_DEPS field).
 */

import type { GroupInfo, ParsedRoadmap } from '../parsers/roadmap.ts';

export type InFlightResult = {
  inFlight: string[];
  unknownDeps: string[]; // each entry is "<group>→<dep>"
};

function compareGroupNum(a: string, b: string): number {
  return Number.parseInt(a, 10) - Number.parseInt(b, 10);
}

function effectiveDepsFor(g: GroupInfo, prev: string | null): string[] {
  switch (g.deps.kind) {
    case 'unspecified':
      return prev === null ? [] : [prev];
    case 'none':
      return [];
    case 'list':
      return g.deps.depNums;
  }
}

export function computeInFlight(parsed: ParsedRoadmap): InFlightResult {
  const groups = [...parsed.groups].sort((a, b) => compareGroupNum(a.num, b.num));
  const groupSet = new Set(groups.map((g) => g.num));
  const completeSet = new Set(groups.filter((g) => g.isComplete).map((g) => g.num));

  const inFlight: string[] = [];
  const unknownDeps: string[] = [];

  let prev: string | null = null;
  for (const g of groups) {
    if (completeSet.has(g.num)) {
      prev = g.num;
      continue;
    }
    const deps = effectiveDepsFor(g, prev);
    let depOk = true;
    for (const d of deps) {
      if (!groupSet.has(d)) {
        unknownDeps.push(`${g.num}→${d}`);
        depOk = false;
        break;
      }
      if (!completeSet.has(d)) {
        depOk = false;
        break;
      }
    }
    if (depOk) inFlight.push(g.num);
    prev = g.num;
  }
  return { inFlight, unknownDeps };
}
