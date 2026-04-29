/**
 * lib-in-flight.test.ts — frontier computation used by IN_FLIGHT_GROUPS,
 * PARALLELISM_BUDGET, and PARALLELIZABLE_FUTURE.
 *
 * Bash's _compute_in_flight_groups + check_in_flight_groups share the
 * same logic; this suite covers the precedence rules:
 *   - Numeric sort, not doc order.
 *   - Default-prev rule: empty deps → previous Group in numeric order.
 *   - `_Depends on: none_` → no deps (empty list).
 *   - Unknown dep references disqualify the Group from the frontier.
 *   - Group whose deps are all Complete enters the frontier.
 */

import { describe, expect, test } from 'bun:test';

import { computeInFlight } from '../src/audit/lib/in-flight.ts';
import type { GroupInfo, ParsedRoadmap } from '../src/audit/parsers/roadmap.ts';

function group(num: string, opts: Partial<GroupInfo> = {}): GroupInfo {
  return {
    num,
    name: `G${num}`,
    isComplete: false,
    deps: { kind: 'unspecified' },
    depsRaw: null,
    depAnchors: [],
    serialize: false,
    hasPreflight: false,
    trackIds: [],
    ...opts,
  };
}

function parsed(groups: GroupInfo[]): ParsedRoadmap {
  return { groups, tracks: [], styleLintWarnings: [], sizeLabelMismatches: [], trackDepCycles: [] };
}

describe('computeInFlight', () => {
  test('first Group with default deps is always in_flight', () => {
    const r = computeInFlight(parsed([group('1')]));
    expect(r.inFlight).toEqual(['1']);
    expect(r.unknownDeps).toEqual([]);
  });

  test('default-prev: Group 2 needs Group 1 complete', () => {
    const r = computeInFlight(parsed([group('1'), group('2')]));
    // Group 1 in-flight (no deps), Group 2 blocked by incomplete Group 1.
    expect(r.inFlight).toEqual(['1']);
  });

  test('Group 1 complete unblocks Group 2', () => {
    const r = computeInFlight(parsed([group('1', { isComplete: true }), group('2')]));
    expect(r.inFlight).toEqual(['2']);
  });

  test('explicit none deps frees Group from default-prev', () => {
    const r = computeInFlight(
      parsed([
        group('1'),
        group('2', { deps: { kind: 'none' } }),
      ]),
    );
    expect(r.inFlight).toEqual(['1', '2']);
  });

  test('unknown dep disqualifies Group + records via unknownDeps', () => {
    const r = computeInFlight(
      parsed([
        group('1'),
        group('2', { deps: { kind: 'list', depNums: ['9'] } }),
      ]),
    );
    expect(r.inFlight).toEqual(['1']);
    expect(r.unknownDeps).toEqual(['2→9']);
  });

  test('numeric sort, not doc order', () => {
    // Doc order: 10, 2, 1. Numeric: 1, 2, 10. Group 1 has no prev (it's
    // first). Group 2's prev is 1. Group 10's prev is 2. None complete.
    const r = computeInFlight(parsed([group('10'), group('2'), group('1')]));
    expect(r.inFlight).toEqual(['1']);
  });
});
