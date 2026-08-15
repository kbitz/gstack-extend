import { describe, expect, test } from 'bun:test';

import {
  runCheckPacking,
  tracksForPacker,
  writtenUnshippedGroups,
} from '../src/audit/checks/packing.ts';
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

describe('packing hotfix contract', () => {
  test('hotfix + regular group: packer input and written sets agree', () => {
    const ctx = makeCtx({
      parsedRoadmap: {
        groups: [
          group('1', 'Hotfix: login', ['1A']),
          group('2', 'Regular', ['2A']),
        ],
        tracks: [track('1A', '1'), track('2A', '2')],
      },
    });
    const packed = tracksForPacker(ctx).map((t) => t.id).sort();
    const written = writtenUnshippedGroups(ctx).flat().sort();
    expect(packed).toEqual(['2A']);
    expect(written).toEqual(packed);
    expect(runCheckPacking(ctx).status).toBe('pass');
  });

  test('same-file Groups without _Depends on: fail PACKING', () => {
    const ctx = makeCtx({
      parsedRoadmap: {
        groups: [
          group('1', 'First', ['1A']),
          group('2', 'Second', ['2A']),
        ],
        tracks: [
          track('1A', '1', { touches: ['src/shared.ts'] }),
          track('2A', '2', { touches: ['src/shared.ts'] }),
        ],
      },
    });
    const r = runCheckPacking(ctx);
    expect(r.status).toBe('fail');
    expect(r.body.join('\n')).toContain('_Depends on: Group 1_');
  });

  test('same-file Groups with packer edge written pass PACKING', () => {
    const ctx = makeCtx({
      parsedRoadmap: {
        groups: [
          group('1', 'First', ['1A']),
          group('2', 'Second', ['2A'], { deps: { kind: 'list', depNums: ['1'] }, depsRaw: 'Group 1' }),
        ],
        tracks: [
          track('1A', '1', { touches: ['src/shared.ts'] }),
          track('2A', '2', { touches: ['src/shared.ts'], blockedBy: ['1A'] }),
        ],
      },
    });
    expect(runCheckPacking(ctx).status).toBe('pass');
  });

  test('group _Depends on does not inflate packer blocked-by', () => {
    const ctx = makeCtx({
      parsedRoadmap: {
        groups: [
          group('1', 'First', ['1A', '1B']),
          group('2', 'Second', ['2A'], { deps: { kind: 'list', depNums: ['1'] }, depsRaw: 'Group 1' }),
        ],
        tracks: [
          track('1A', '1', { touches: ['src/a.ts'] }),
          track('1B', '1', { touches: ['src/b.ts'] }),
          track('2A', '2', { touches: ['src/c.ts'], blockedBy: ['1A'] }),
        ],
      },
    });
    const packed = tracksForPacker(ctx);
    const two = packed.find((t) => t.id === '2A')!;
    expect(two.blockedBy).toEqual(['1A']);
    expect(two.blockedBy).not.toContain('1B');
  });

  test('n track-level edges collapse to one group-pair finding', () => {
    const ctx = makeCtx({
      parsedRoadmap: {
        groups: [
          group('1', 'First', ['1A', '1B']),
          group('2', 'Second', ['2A', '2B']),
        ],
        tracks: [
          track('1A', '1', { touches: ['src/a.ts'] }),
          track('1B', '1', { touches: ['src/b.ts'] }),
          track('2A', '2', { touches: ['src/c.ts'], blockedBy: ['1A'] }),
          track('2B', '2', { touches: ['src/d.ts'], blockedBy: ['1B'] }),
        ],
      },
    });
    const r = runCheckPacking(ctx);
    expect(r.status).toBe('fail');
    const lines = r.body.filter((l) => l.includes('Group 2 ← Group 1'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('2 track-level edges');
  });

  test('seven disjoint tracks at cap 6 are two bins, not one of 7', () => {
    const ids = ['1A', '1B', '1C', '1D', '1E', '1F', '1G'];
    const ctx = makeCtx({
      parallelismCap: 6,
      parsedRoadmap: {
        groups: [group('1', 'Wide', ids)],
        tracks: ids.map((id) => track(id, '1', { touches: [`src/${id}.ts`] })),
      },
    });
    const r = runCheckPacking(ctx);
    expect(r.status).toBe('fail');
    expect(r.body.join('\n')).toContain('packer bins');
    expect(r.body.join('\n')).not.toMatch(/packer bins\s+\[[^\]]*1A,1B,1C,1D,1E,1F,1G\]/);
  });

  test('hotfix-only plan skips PACKING', () => {
    const ctx = makeCtx({
      parsedRoadmap: {
        groups: [group('1', 'Hotfix: login', ['1A'])],
        tracks: [track('1A', '1')],
      },
    });
    expect(tracksForPacker(ctx)).toEqual([]);
    expect(writtenUnshippedGroups(ctx)).toEqual([]);
    expect(runCheckPacking(ctx).status).toBe('skip');
  });
});
