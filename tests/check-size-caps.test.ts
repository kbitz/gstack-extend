import { describe, expect, test } from 'bun:test';

import { runCheckSizeCaps } from '../src/audit/checks/size-caps.ts';
import type { TrackInfo } from '../src/audit/parsers/roadmap.ts';
import { makeCtx } from './helpers/audit-ctx.ts';

function track(over: Partial<TrackInfo> = {}): TrackInfo {
  return {
    id: '1A',
    groupNum: '1',
    state: 'current-plan',
    isComplete: false,
    touches: ['src/a.ts'],
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

describe('runCheckSizeCaps', () => {
  test('untagged write-tasks fail SIZE', () => {
    const r = runCheckSizeCaps(
      makeCtx({ parsedRoadmap: { tracks: [track({ untaggedWriteTasks: 2, sessionWeight: 0 })] } }),
    );
    expect(r.status).toBe('fail');
    expect(r.body.join('\n')).toContain('missing (S|M|L) effort tag');
  });

  test('weight 5 warns, does not fail SIZE', () => {
    const r = runCheckSizeCaps(
      makeCtx({ parsedRoadmap: { tracks: [track({ sessionWeight: 5 })] } }),
    );
    expect(r.status).toBe('pass');
    expect(r.body.join('\n')).toContain('WEIGHT_WARN');
    expect(r.body.join('\n')).toContain('session_weight=5');
  });

  test('weight 6 still fails SIZE', () => {
    const r = runCheckSizeCaps(
      makeCtx({ parsedRoadmap: { tracks: [track({ sessionWeight: 6 })] } }),
    );
    expect(r.status).toBe('fail');
    expect(r.body.join('\n')).toContain('session_weight=6');
  });

  test('tagged write-task does not trip the untagged gate', () => {
    const r = runCheckSizeCaps(makeCtx({ parsedRoadmap: { tracks: [track()] } }));
    expect(r.status).toBe('pass');
  });
});
