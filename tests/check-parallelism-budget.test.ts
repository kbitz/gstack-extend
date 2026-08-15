import { describe, expect, test } from 'bun:test';

import { runCheckParallelismBudget } from '../src/audit/checks/parallelism-budget.ts';
import type { GroupInfo, TrackInfo } from '../src/audit/parsers/roadmap.ts';
import { makeCtx } from './helpers/audit-ctx.ts';

function track(id: string, groupNum: string, over: Partial<TrackInfo> = {}): TrackInfo {
  return {
    id,
    groupNum,
    state: 'current-plan',
    isComplete: false,
    title: '',
    touches: [`src/${id}.ts`],
    filesCount: 1,
    tasksCount: 1,
    loc: 50,
    sessionWeight: 1,
    deleteOnly: false,
    markdownOnly: false,
    out: [],
    readFirst: [],
    produces: null,
    blockedBy: [],
    legacy: false,
    deps: [],
    depsFreetext: false,
    bannedPrSplit: false,
    untaggedWriteTasks: 0,
    ...over,
  };
}

function group(num: string, name: string, trackIds: string[], over: Partial<GroupInfo> = {}): GroupInfo {
  return {
    num,
    name,
    state: 'current-plan',
    isComplete: false,
    isHotfix: name.startsWith('Hotfix:'),
    deps: { kind: 'none' },
    depsRaw: 'none',
    depAnchors: [],
    trackIds,
    ...over,
  };
}

describe('runCheckParallelismBudget', () => {
  test('ready siblings that sum over the cap still pass', () => {
    const g1 = ['1A', '1B', '1C', '1D', '1E', '1F'];
    const g2 = ['2A', '2B', '2C', '2D'];
    const ctx = makeCtx({
      parallelismCap: 6,
      parsedRoadmap: {
        groups: [group('1', 'A', g1), group('2', 'B', g2)],
        tracks: [...g1.map((id) => track(id, '1')), ...g2.map((id) => track(id, '2'))],
      },
    });
    const r = runCheckParallelismBudget(ctx);
    expect(r.status).toBe('pass');
    expect(r.preamble?.join('\n') ?? '').toContain('IN_FLIGHT_TRACKS: 10');
  });

  test('one Group wider than the cap fails', () => {
    const ids = ['1A', '1B', '1C', '1D', '1E', '1F', '1G'];
    const ctx = makeCtx({
      parallelismCap: 6,
      parsedRoadmap: {
        groups: [group('1', 'Wide', ids)],
        tracks: ids.map((id) => track(id, '1')),
      },
    });
    const r = runCheckParallelismBudget(ctx);
    expect(r.status).toBe('fail');
    expect(r.body.join('\n')).toContain('fill cap 6');
  });
});
