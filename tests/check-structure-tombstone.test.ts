import { describe, expect, test } from 'bun:test';

import { runCheckStructure } from '../src/audit/checks/structure.ts';
import type { GroupInfo, TrackInfo } from '../src/audit/parsers/roadmap.ts';
import { makeCtx } from './helpers/audit-ctx.ts';

function group(num: string, state: GroupInfo['state']): GroupInfo {
  return {
    num,
    name: `G${num}`,
    state,
    isComplete: state === 'shipped',
    isHotfix: false,
    deps: { kind: 'none' },
    depsRaw: 'none',
    depAnchors: [],
    trackIds: [],
  };
}

const CARD = [
  '## Current Plan',
  '#### Group 84: Reserved',
  '##### Track 84A: Card',
  '_1 task . S . low risk . [a.ts]_',
  '_touches: a.ts_',
  '',
].join('\n');

describe('STRUCTURE tombstones', () => {
  test('unshipped Group on a tombstoned number fails', () => {
    const ctx = makeCtx({
      roadmap: CARD,
      parsedRoadmap: {
        groups: [group('84', 'current-plan'), group('91', 'current-plan')],
        tombstones: ['84', '86', '90'],
      },
    });
    const r = runCheckStructure(ctx);
    expect(r.status).toBe('fail');
    expect(r.body.some((l) => l.includes('Group 84') && l.includes('tombstoned'))).toBe(true);
    expect(r.body.some((l) => l.includes('Group 91'))).toBe(false);
  });

  test('shipped Group may keep a tombstoned number', () => {
    const ctx = makeCtx({
      roadmap: CARD,
      parsedRoadmap: {
        groups: [group('84', 'shipped')],
        tombstones: ['84'],
      },
    });
    const r = runCheckStructure(ctx);
    expect(r.status).toBe('pass');
  });

  test('unshipped Track letter must match its Group', () => {
    const wrong: TrackInfo = {
      id: '92A',
      groupNum: '91',
      state: 'current-plan',
      isComplete: false,
      title: 'Wrong letter',
      touches: ['a.ts'],
      filesCount: 1,
      tasksCount: 1,
      loc: 0,
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
    };
    const ctx = makeCtx({
      roadmap: CARD,
      parsedRoadmap: {
        groups: [group('91', 'current-plan')],
        tracks: [wrong],
      },
    });
    const r = runCheckStructure(ctx);
    expect(r.status).toBe('fail');
    expect(r.body.some((l) => l.includes('92A') && l.includes('Group 91'))).toBe(true);
  });

  test('rejects _id: placed before metadata line', () => {
    const badCard = [
      '## Current Plan',
      '### Group 91: Live',
      '#### Track 91A: Bad order',
      '_id: wi-a1b2c3_',
      '_1 task · ~40 LOC · low risk_',
      '_touches: a.ts_',
      '- **Do** -- x (S)',
    ].join('\n');
    const ctx = makeCtx({ roadmap: badCard });
    const r = runCheckStructure(ctx);
    expect(r.status).toBe('fail');
    expect(r.body.some((l) => l.includes('_id:_ line appears before metadata'))).toBe(true);
  });

  test('accepts known work-item IDs on _blocked-by: and rejects unknown or malformed tokens', () => {
    const base: TrackInfo = {
      id: '91A',
      groupNum: '91',
      state: 'current-plan',
      isComplete: false,
      title: 'First',
      touches: ['a.ts'],
      filesCount: 1,
      tasksCount: 1,
      loc: 0,
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
      workItemId: 'wi-910001',
    };
    const okCtx = makeCtx({
      roadmap: CARD,
      parsedRoadmap: {
        groups: [group('91', 'current-plan')],
        tracks: [
          base,
          { ...base, id: '91B', touches: ['b.ts'], workItemId: 'wi-910002', blockedBy: ['wi-910001'] },
        ],
      },
    });
    expect(runCheckStructure(okCtx).status).toBe('pass');

    const badCtx = makeCtx({
      roadmap: CARD,
      parsedRoadmap: {
        groups: [group('91', 'current-plan')],
        tracks: [
          {
            ...base,
            blockedBy: ['wi-999999'],
            blockedByMalformed: ['wi-12', 'wi-ZZZZ'],
          },
        ],
      },
    });
    const badRes = runCheckStructure(badCtx);
    expect(badRes.status).toBe('fail');
    expect(badRes.body.some((l) => l.includes('wi-999999') && l.includes('not a known Track ID'))).toBe(true);
    expect(badRes.body.some((l) => l.includes('wi-12') && l.includes('malformed'))).toBe(true);
    expect(badRes.body.some((l) => l.includes('wi-ZZZZ') && l.includes('malformed'))).toBe(true);
  });
});
