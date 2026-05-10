/**
 * check-phases.test.ts — direct unit coverage for `runCheckPhases`.
 *
 * Snapshot fixtures (tests/roadmap-audit/phase-*) exercise this through the
 * full audit pipeline. These unit tests pinpoint the state-derivation logic
 * (complete vs in_flight, currentGroup election, empty-groups fallback)
 * without cascading across 8 fixtures when one rule shifts.
 */

import { describe, expect, test } from 'bun:test';

import { runCheckPhases } from '../src/audit/checks/phases.ts';
import type { PhaseInfo } from '../src/audit/parsers/phases.ts';
import type { GroupInfo } from '../src/audit/parsers/roadmap.ts';
import { makeCtx } from './helpers/audit-ctx.ts';

function phase(overrides: Partial<PhaseInfo> = {}): PhaseInfo {
  return {
    num: '1',
    title: 'Test phase',
    headLine: 1,
    hasEndState: true,
    hasGroups: true,
    groupNums: ['1', '2'],
    scaffoldPaths: [],
    ...overrides,
  };
}

function group(num: string, isComplete: boolean): GroupInfo {
  return {
    num,
    name: `Group ${num}`,
    state: isComplete ? 'shipped' : 'current-plan',
    isComplete,
    isHotfix: false,
    deps: { kind: 'unspecified' },
    depsRaw: null,
    depAnchors: [],
    serialize: false,
    hasPreflight: false,
    trackIds: [],
  };
}

describe('check_phases', () => {
  test('skip when no ROADMAP.md', () => {
    const ctx = makeCtx();
    ctx.paths.roadmap = null;
    const r = runCheckPhases(ctx);
    expect(r.section).toBe('PHASES');
    expect(r.status).toBe('skip');
    expect(r.body).toContain('- No ROADMAP.md found');
  });

  test('skip when no phases declared (emits "(none declared)")', () => {
    const r = runCheckPhases(makeCtx({ roadmap: '# stub\n', parsedPhases: [] }));
    expect(r.status).toBe('skip');
    expect(r.body).toEqual(['PHASES:', '- (none declared)']);
  });

  test('state=complete when every listed group is shipped', () => {
    const r = runCheckPhases(
      makeCtx({
        roadmap: '# stub\n',
        parsedPhases: [phase({ groupNums: ['1', '2'], scaffoldPaths: ['a', 'b'] })],
        parsedRoadmap: { groups: [group('1', true), group('2', true)] },
      }),
    );
    expect(r.status).toBe('pass');
    const row = r.body.find((l) => l.startsWith('- phase=1 '));
    expect(row).toBeDefined();
    expect(row).toContain('state=complete');
    expect(row).toContain('scaffolding_decls=2');
    // current_group omitted when complete.
    expect(row).not.toContain('current_group');
  });

  test('state=in_flight + currentGroup = first incomplete group', () => {
    const r = runCheckPhases(
      makeCtx({
        roadmap: '# stub\n',
        parsedPhases: [phase({ groupNums: ['1', '2', '3'] })],
        parsedRoadmap: {
          groups: [group('1', true), group('2', false), group('3', false)],
        },
      }),
    );
    expect(r.status).toBe('pass');
    const row = r.body.find((l) => l.startsWith('- phase=1 '));
    expect(row).toContain('state=in_flight');
    expect(row).toContain('current_group=2');
  });

  test('empty groups list → currentGroup="?"', () => {
    const r = runCheckPhases(
      makeCtx({
        roadmap: '# stub\n',
        parsedPhases: [phase({ groupNums: [] })],
        parsedRoadmap: { groups: [] },
      }),
    );
    expect(r.status).toBe('pass');
    const row = r.body.find((l) => l.startsWith('- phase=1 '));
    expect(row).toContain('groups=[]');
    expect(row).toContain('state=in_flight');
    expect(row).toContain('current_group=?');
  });

  test('scaffolding_decls reflects scaffoldPaths length', () => {
    const r = runCheckPhases(
      makeCtx({
        roadmap: '# stub\n',
        parsedPhases: [
          phase({ num: '1', groupNums: ['1'], scaffoldPaths: [] }),
          phase({ num: '2', groupNums: ['2'], scaffoldPaths: ['a', 'b', 'c'] }),
        ],
        parsedRoadmap: { groups: [group('1', true), group('2', true)] },
      }),
    );
    expect(r.body.find((l) => l.startsWith('- phase=1 '))).toContain('scaffolding_decls=0');
    expect(r.body.find((l) => l.startsWith('- phase=2 '))).toContain('scaffolding_decls=3');
  });

  test('multiple phases emit in declaration order', () => {
    const r = runCheckPhases(
      makeCtx({
        roadmap: '# stub\n',
        parsedPhases: [phase({ num: '1', title: 'Alpha' }), phase({ num: '2', title: 'Beta' })],
        parsedRoadmap: { groups: [group('1', false), group('2', false)] },
      }),
    );
    const rows = r.body.filter((l) => l.startsWith('- phase='));
    expect(rows[0]).toContain('phase=1');
    expect(rows[0]).toContain('title="Alpha"');
    expect(rows[1]).toContain('phase=2');
    expect(rows[1]).toContain('title="Beta"');
  });
});
