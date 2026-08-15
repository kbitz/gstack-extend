/**
 * lib-in-flight.test.ts — frontier computation used by IN_FLIGHT_GROUPS,
 * PARALLELISM_BUDGET, and PARALLELIZABLE_FUTURE.
 *
 * Bash's _compute_in_flight_groups + check_in_flight_groups share the
 * same logic; this suite covers the precedence rules:
 *   - Numeric sort, not doc order.
 *   - Unspecified and `_Depends on: none_` → no deps (ready).
 *   - Explicit list → those Groups must be complete.
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
    state: 'current-plan',
    isComplete: false,
    isHotfix: false,
    deps: { kind: 'unspecified' },
    depsRaw: null,
    depAnchors: [],
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

  test('unspecified: Group 2 is ready alongside Group 1', () => {
    const r = computeInFlight(parsed([group('1'), group('2')]));
    expect(r.inFlight).toEqual(['1', '2']);
  });

  test('explicit dep: Group 1 complete unblocks Group 2', () => {
    const r = computeInFlight(
      parsed([
        group('1', { isComplete: true }),
        group('2', { deps: { kind: 'list', depNums: ['1'] } }),
      ]),
    );
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

  test('live Hotfix blocks every non-hotfix Group', () => {
    const r = computeInFlight(
      parsed([
        group('1', { isHotfix: true, name: 'Hotfix: login' }),
        group('2'),
        group('3', { deps: { kind: 'none' } }),
      ]),
    );
    expect(r.inFlight).toEqual(['1']);
  });

  test('after Hotfix ships, unspecified Groups are ready again', () => {
    const r = computeInFlight(
      parsed([
        group('1', { isHotfix: true, name: 'Hotfix: login', isComplete: true, state: 'shipped' }),
        group('2'),
      ]),
    );
    expect(r.inFlight).toEqual(['2']);
  });

  test('numeric sort, not doc order — all unspecified are ready', () => {
    const r = computeInFlight(parsed([group('10'), group('2'), group('1')]));
    expect(r.inFlight).toEqual(['1', '2', '10']);
  });
});
