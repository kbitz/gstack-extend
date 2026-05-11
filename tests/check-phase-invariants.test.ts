/**
 * check-phase-invariants.test.ts — direct unit coverage for
 * `runCheckPhaseInvariants` (~9 invariants).
 *
 * Snapshot fixtures cover end-to-end audit emit; this file targets each
 * invariant in isolation so a state-machine regression pinpoints a single
 * rule instead of cascading across 8 fixtures.
 */

import { describe, expect, test } from 'bun:test';

import { runCheckPhaseInvariants } from '../src/audit/checks/phase-invariants.ts';
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

function group(num: string): GroupInfo {
  return {
    num,
    name: `Group ${num}`,
    state: 'current-plan',
    isComplete: false,
    isHotfix: false,
    deps: { kind: 'unspecified' },
    depsRaw: null,
    depAnchors: [],
    trackIds: [],
  };
}

describe('check_phase_invariants', () => {
  test('skip when no ROADMAP.md', () => {
    const ctx = makeCtx();
    ctx.paths.roadmap = null;
    const r = runCheckPhaseInvariants(ctx);
    expect(r.section).toBe('PHASE_INVARIANTS');
    expect(r.status).toBe('skip');
  });

  test('skip when no phases declared', () => {
    const r = runCheckPhaseInvariants(makeCtx({ roadmap: '# stub\n', parsedPhases: [] }));
    expect(r.status).toBe('skip');
    expect(r.body).toContain('- (none declared)');
  });

  test('all-pass → STATUS pass with no findings', () => {
    const r = runCheckPhaseInvariants(
      makeCtx({
        roadmap: '# stub\n',
        parsedPhases: [phase({ groupNums: ['1', '2'] })],
        parsedRoadmap: { groups: [group('1'), group('2')] },
      }),
    );
    expect(r.status).toBe('pass');
    expect(r.body).toEqual(['FINDINGS:', '- (none)']);
  });

  test('missing **End-state:** field → warn', () => {
    const r = runCheckPhaseInvariants(
      makeCtx({
        roadmap: '# stub\n',
        parsedPhases: [phase({ hasEndState: false })],
        parsedRoadmap: { groups: [group('1'), group('2')] },
      }),
    );
    expect(r.status).toBe('warn');
    expect(r.body.some((l) => l.includes('missing **End-state:** field'))).toBe(true);
  });

  test('missing **Groups:** field → warn AND skips remaining checks for that phase', () => {
    // Phase 1 has no Groups field. The < 2 groups, missing-group, sequentiality,
    // and scaffolding checks must NOT fire for it (continue;).
    const r = runCheckPhaseInvariants(
      makeCtx({
        roadmap: '# stub\n',
        parsedPhases: [
          phase({ hasGroups: false, groupNums: [], scaffoldPaths: ['nonexistent.txt'] }),
        ],
        parsedRoadmap: { groups: [] },
      }),
    );
    expect(r.status).toBe('warn');
    expect(r.body.some((l) => l.includes('missing **Groups:** field'))).toBe(true);
    // Should NOT have fired the < 2 groups check, missing-group check, or
    // scaffolding-path check for this phase.
    expect(r.body.some((l) => l.includes('declares 0 group(s)'))).toBe(false);
    expect(r.body.some((l) => l.includes('scaffolding path'))).toBe(false);
  });

  test('< 2 groups → warn (Phases coordinate ≥2 groups by design)', () => {
    const r = runCheckPhaseInvariants(
      makeCtx({
        roadmap: '# stub\n',
        parsedPhases: [phase({ groupNums: ['1'] })],
        parsedRoadmap: { groups: [group('1')] },
      }),
    );
    expect(r.status).toBe('warn');
    expect(r.body.some((l) => l.includes('declares 1 group(s)') && l.includes('≥2'))).toBe(true);
  });

  test('listed group missing ## Group N heading', () => {
    const r = runCheckPhaseInvariants(
      makeCtx({
        roadmap: '# stub\n',
        parsedPhases: [phase({ groupNums: ['1', '5'] })],
        parsedRoadmap: { groups: [group('1')] },
      }),
    );
    expect(r.status).toBe('warn');
    expect(r.body.some((l) => l.includes('listed Group 5 has no `## Group 5` heading'))).toBe(true);
  });

  test('non-sequential groups → warn', () => {
    const r = runCheckPhaseInvariants(
      makeCtx({
        roadmap: '# stub\n',
        parsedPhases: [phase({ groupNums: ['1', '3'] })],
        parsedRoadmap: { groups: [group('1'), group('3')] },
      }),
    );
    expect(r.status).toBe('warn');
    expect(r.body.some((l) => l.includes('not sequential') && l.includes('1,3'))).toBe(true);
  });

  test('scaffolding path missing → file vs glob distinction in wording', () => {
    const r = runCheckPhaseInvariants(
      makeCtx({
        roadmap: '# stub\n',
        parsedPhases: [phase({ scaffoldPaths: ['plain/file.txt', 'glob/**/*.ts'] })],
        parsedRoadmap: { groups: [group('1'), group('2')] },
        scaffoldExists: new Map([
          ['1|plain/file.txt', false],
          ['1|glob/**/*.ts', false],
        ]),
      }),
    );
    expect(r.status).toBe('warn');
    expect(r.body.some((l) => l.includes('`plain/file.txt` does not exist'))).toBe(true);
    expect(r.body.some((l) => l.includes('`glob/**/*.ts` matches no files'))).toBe(true);
  });

  test('cross-phase double-claim → emitted in numeric sort order', () => {
    const r = runCheckPhaseInvariants(
      makeCtx({
        roadmap: '# stub\n',
        parsedPhases: [
          phase({ num: '2', groupNums: ['10', '11'] }),
          phase({ num: '1', groupNums: ['11', '12'] }),
        ],
        parsedRoadmap: {
          groups: [group('10'), group('11'), group('12')],
        },
      }),
    );
    expect(r.status).toBe('warn');
    // Group 11 is double-claimed. Owners listed numerically: 1, 2.
    expect(r.body.some((l) => l.includes('Group 11: claimed by multiple Phases (1,2)'))).toBe(true);
  });
});
