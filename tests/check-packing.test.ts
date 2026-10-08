import { describe, expect, test } from 'bun:test';

import {
  runCheckPacking,
  tracksForPacker,
  writtenUnshippedGroups,
} from '../src/audit/checks/packing.ts';
import { runCheckStructure } from '../src/audit/checks/structure.ts';
import { packTracks } from '../src/audit/lib/pack.ts';
import {
  mergeShippedArchive,
  parseRoadmap,
  type GroupInfo,
  type TrackInfo,
} from '../src/audit/parsers/roadmap.ts';
import { makeCtx } from './helpers/audit-ctx.ts';

// Literal Track 22B plan receipt; the H2 resets the preceding archived Group.
const INDIVIDUAL_RECEIPT = `## Individual Track history

### Track 22A: Record landed work ✓ Shipped (v1.2.3.0)
- 2026-10-01: merged PR #109 (commit abc1234); verified land-time Track 22A, original Group 22.
`;
const PRIOR_ARCHIVE = `## Shipped
### Group 11: Earlier work ✓ Shipped (v1.0.0.0)
#### Track 11A: Earlier task ✓ Shipped (v1.0.0.0)
`;
const PINNED_REMAINDER = `## In Progress
### Group 22: Active remainder
_Depends on: none_
#### Track 22B: Second remaining
_1 task . ~50 LOC . low risk_
_touches: src/b.ts_
- Finish the second task (~50 lines).
`;

function parsedCtx(active: string, archive = '') {
  const merged = mergeShippedArchive(parseRoadmap(active), parseRoadmap(archive));
  const ctx = makeCtx({ roadmap: active, parsedRoadmap: merged.value, parallelismCap: 2 });
  ctx.roadmap = merged; // Preserve errors/diagnostics and the real raw active path for STRUCTURE.
  return ctx;
}

function card(id: string, title: string, touches: string, suffix = '', blocker = '') {
  return `#### Track ${id}: ${title}${suffix}
_1 task . ~50 LOC . low risk_
${touches ? `_touches: ${touches}_\n` : ''}${blocker ? `_blocked-by: Track ${blocker}_\n` : ''}- Finish the task (~50 lines).
`;
}

const REPACKED_REMAINDER = `## Current Plan
### Group 23: Repacked remainder
_Depends on: none_
#### Track 23A: Second remaining
_1 task . ~50 LOC . low risk_
_touches: src/b.ts_
- Finish the second task (~50 lines).
#### Track 23B: Third remaining
_1 task . ~50 LOC . low risk_
_touches: src/c.ts_
- Finish the third task (~50 lines).
`;

test('plain-language outcomes preserve Track tasks, dependencies and packer bins', () => {
  const plain = REPACKED_REMAINDER
    .replace('- Finish the second task (~50 lines).', '- **Search local notes** — Return matching files. (S)')
    .replace('- Finish the third task (~50 lines).', '- **Identify results** — Show each source path. (S)');
  const enriched = plain
    .replace('_Depends on: none_', '_Depends on: none_\n\n**This group delivers:** Local search and readable results.')
    .replace('#### Track 23A: Second remaining\n_1 task . ~50 LOC . low risk_', `#### Track 23A: Second remaining
_1 task . ~50 LOC . low risk_
**Outcome:** The owner can search local notes.
**Supports:** MVP-1; SPEC O1.
**Done when:** Search returns a known note from the fixture vault.`)
    .replace('#### Track 23B: Third remaining\n_1 task . ~50 LOC . low risk_', `#### Track 23B: Third remaining
_1 task . ~50 LOC . low risk_
**Outcome:** Results identify the correct file.
**Supports:** MVP-1; SPEC O2.
**Done when:** Duplicate filenames remain distinguishable.
**Release checkpoint:** C1 (O1 + O2); acceptance still required.`);
  expect(enriched).not.toBe(plain);
  expect(enriched.match(/^\*\*Outcome:\*\*/gm)?.length).toBe(2);
  expect(enriched).toContain('**This group delivers:**');
  const baseline = parsedCtx(plain);
  const candidate = parsedCtx(enriched);
  expect(candidate.roadmap.errors).toEqual([]);
  expect(candidate.roadmap.value.styleLintWarnings).toEqual([]);
  expect(candidate.roadmap.value.tracks.map((track) => track.tasksCount)).toEqual([1, 1]);
  expect(tracksForPacker(candidate)).toEqual(tracksForPacker(baseline));
  expect(packTracks(tracksForPacker(candidate), { target: 2, maxPerBin: 2 }))
    .toEqual(packTracks(tracksForPacker(baseline), { target: 2, maxPerBin: 2 }));
  expect(runCheckStructure(candidate).status).toBe('pass');
  expect(runCheckPacking(candidate).status).toBe('pass');
});

describe('parsed individual shipment contract', () => {
  test('exact receipt after Group 11 ships only 22A while pinned Group 22 remains active', () => {
    const archive = parseRoadmap(PRIOR_ARCHIVE + INDIVIDUAL_RECEIPT);
    expect(archive.errors).toEqual([]);
    expect(archive.value.styleLintWarnings).toEqual([]);
    expect(archive.value.groups.map((g) => g.num)).toEqual(['11']);
    expect(archive.value.groups[0]!.trackIds).toEqual(['11A']);
    expect(archive.value.tracks.find((t) => t.id === '22A')!.groupNum).toBe('0');
    expect(archive.value.tombstones).toEqual([]); // Prefix 22 still owns pinned active work.

    const ctx = parsedCtx(PINNED_REMAINDER, PRIOR_ARCHIVE + INDIVIDUAL_RECEIPT);
    expect(ctx.roadmap.errors).toEqual([]);
    expect(ctx.roadmap.value.styleLintWarnings).toEqual([]);
    expect(ctx.roadmap.value.tracks.find((t) => t.id === '22A')!.state).toBe('shipped');
    expect(ctx.roadmap.value.tracks.find((t) => t.id === '22B')!.state).toBe('in-progress');
    expect(ctx.roadmap.value.groups.map((g) => g.num)).toEqual(['22', '11']);
    expect(ctx.roadmap.value.groups.find((g) => g.num === '22')!.trackIds).toEqual(['22B']);
    expect(tracksForPacker(ctx).map((t) => t.id)).toEqual(['22B']);
    expect(writtenUnshippedGroups(ctx)).toEqual([['22B']]);
    expect(runCheckStructure(ctx).status).toBe('pass');
    expect(runCheckPacking(ctx).status).toBe('pass');
  });

  for (const [heading, state] of [['Current Plan', 'current-plan'], ['In Progress', 'in-progress']] as const) {
    test(`${heading}: inline shipment removes 22A from both sets and exposes partial drift`, () => {
      const active = `## ${heading}
### Group 22: Partial shipment
_Depends on: none_
${card('22A', 'Record landed work', 'src/a.ts', ' ✓ Shipped (v1.2.3.0)')}${card('22B', 'Second remaining', 'src/b.ts')}${card('22C', 'Legacy card', '')}### Group 23: Third work
_Depends on: none_
${card('23A', 'Third remaining', 'src/c.ts')}`;
      const ctx = parsedCtx(active);
      expect(ctx.roadmap.errors).toEqual([]);
      expect(ctx.roadmap.value.tracks.find((t) => t.id === '22A')!.state).toBe('shipped');
      expect(ctx.roadmap.value.tracks.find((t) => t.id === '22B')!.state).toBe(state);
      expect(ctx.roadmap.value.tracks.find((t) => t.id === '22C')!.legacy).toBe(true);
      expect(tracksForPacker(ctx).map((t) => t.id)).toEqual(['22B', '23A']);
      expect(writtenUnshippedGroups(ctx)).toEqual([['22B'], ['23A']]);
      expect(packTracks(tracksForPacker(ctx), { target: 2, maxPerBin: 2 }).bins.map((b) => b.trackIds))
        .toEqual([['22B', '23A']]);
      const result = runCheckPacking(ctx);
      expect(result.status).toBe('fail');
      expect(result.body).toContain('- written Groups do not match packer bins — re-run /roadmap Step 2 (draft Tracks, then bin/roadmap-pack)');
    });

    test(`${heading}: independently archived shipment and repacked remainder pass`, () => {
      const ctx = parsedCtx(REPACKED_REMAINDER.replace('## Current Plan', `## ${heading}`), INDIVIDUAL_RECEIPT);
      expect(ctx.roadmap.errors).toEqual([]);
      expect(tracksForPacker(ctx).map((t) => t.id)).toEqual(['23A', '23B']);
      expect(writtenUnshippedGroups(ctx)).toEqual([['23A', '23B']]);
      expect(ctx.roadmap.value.tracks.find((t) => t.id === '22A')!.state).toBe('shipped');
      expect(ctx.roadmap.value.tracks.find((t) => t.id === '23A')!.state).toBe(state);
      expect(runCheckStructure(ctx).status).toBe('pass');
      expect(runCheckPacking(ctx)).toEqual({ section: 'PACKING', status: 'pass', body: ['FINDINGS:', '- (none)', 'BINS: 1'] });
    });
  }

  for (const [name, active] of [
    ['empty', ''],
    ['empty Group', '## Current Plan\n### Group 22: Empty\n_Depends on: none_\n'],
    ['legacy-only', '## Current Plan\n### Group 22: Legacy\n' + card('22A', 'Legacy', '')],
    ['v1 shipped fallback', '### Group 22: Old ✓ Complete\n' + card('22A', 'Old', 'src/a.ts')],
    ...['Current Plan', 'In Progress'].map((heading) => [
      `all-shipped ${heading}`,
      `## ${heading}\n### Group 22: Finished\n` + card('22A', 'Finished', 'src/a.ts', ' ✓ Shipped'),
    ]),
  ]) {
    test(`${name} has empty eligible/written sets and skips PACKING`, () => {
      const ctx = parsedCtx(active!);
      expect(ctx.roadmap.errors).toEqual([]);
      expect(tracksForPacker(ctx)).toEqual([]);
      expect(writtenUnshippedGroups(ctx)).toEqual([]);
      expect(runCheckPacking(ctx)).toEqual({ section: 'PACKING', status: 'skip', body: ['FINDINGS:', '- No unshipped Tracks to pack'] });
    });
  }

  test('retirement tombstone merges outside Track bodies and rejects active prefix reuse', () => {
    const archive = PRIOR_ARCHIVE + INDIVIDUAL_RECEIPT + '\n## Individual Track history\n_tombstone: 22_\n';
    const parsed = parseRoadmap(archive);
    expect(parsed.value.tombstones).toEqual(['22']);
    expect(parsed.value.groups.some((g) => g.num === '22' || g.num === '0')).toBe(false);
    const retired = parsedCtx(REPACKED_REMAINDER, archive);
    expect(retired.roadmap.value.tombstones).toEqual(['22']);
    expect(runCheckStructure(retired).status).toBe('pass');
    expect(runCheckPacking(retired).status).toBe('pass');
    const reused = parsedCtx(PINNED_REMAINDER, archive);
    expect(runCheckStructure(reused).status).toBe('fail');
    expect(runCheckStructure(reused).body).toContain('- Group 22 uses a tombstoned number — pick the next free ID after shipped history');
    // A reservation appended inside the receipt body would silently be ignored.
    expect(parseRoadmap(PRIOR_ARCHIVE + INDIVIDUAL_RECEIPT + '_tombstone: 22_\n').value.tombstones).toEqual([]);
  });

  test('canonical archived prerequisite remains known to STRUCTURE but stops blocking packing', () => {
    const active = PINNED_REMAINDER.replace('_touches: src/b.ts_', '_touches: src/b.ts_\n_blocked-by: Track 22A_');
    expect(runCheckStructure(parsedCtx(active)).status).toBe('fail');
    const ctx = parsedCtx(active, INDIVIDUAL_RECEIPT);
    expect(ctx.roadmap.value.tracks.find((t) => t.id === '22B')!.blockedBy).toEqual(['22A']);
    expect(runCheckStructure(ctx).status).toBe('pass');
    expect(tracksForPacker(ctx).map((t) => [t.id, t.blockedBy])).toEqual([['22B', []]]);
    expect(runCheckPacking(ctx).status).toBe('pass');
  });

  test('compatible pinned Group backfill preserves 22B, skips archived 22A, and passes both checks', () => {
    const ctx = parsedCtx(PINNED_REMAINDER + card('22C', 'Third remaining', 'src/c.ts'), INDIVIDUAL_RECEIPT);
    expect(ctx.roadmap.value.groups.find((g) => g.num === '22')!.trackIds).toEqual(['22B', '22C']);
    expect(tracksForPacker(ctx).map((t) => t.id)).toEqual(['22B', '22C']);
    expect(writtenUnshippedGroups(ctx)).toEqual([['22B', '22C']]);
    expect(ctx.roadmap.value.tombstones).toEqual([]);
    expect(runCheckStructure(ctx).status).toBe('pass');
    expect(runCheckPacking(ctx).status).toBe('pass');
  });

  test('bare unknown-version receipt is shipped without inventing a version or Group', () => {
    const receipt = INDIVIDUAL_RECEIPT.replace(' (v1.2.3.0)', '').replace('original Group 22.', 'original Group 22; release version unknown.');
    const archive = parseRoadmap(PRIOR_ARCHIVE + receipt);
    expect(archive.errors).toEqual([]);
    expect(archive.value.tracks.find((t) => t.id === '22A')!.state).toBe('shipped');
    expect(archive.value.groups.map((g) => g.num)).toEqual(['11']);
    const ctx = parsedCtx(PINNED_REMAINDER, PRIOR_ARCHIVE + receipt);
    expect(ctx.roadmap.value.tracks.find((t) => t.id === '22A')!.state).toBe('shipped');
    expect(runCheckPacking(ctx).status).toBe('pass');
  });

  test('unrelated active reuse wins merge with an exact collision warning for the recorder to refuse', () => {
    const active = PINNED_REMAINDER + card('22A', 'Unrelated new task', 'src/unrelated.ts');
    const ctx = parsedCtx(active, PRIOR_ARCHIVE + INDIVIDUAL_RECEIPT);
    expect(ctx.roadmap.value.tracks.find((t) => t.id === '22A')!.state).toBe('in-progress');
    expect(ctx.roadmap.value.tracks.find((t) => t.id === '22A')!.title).toBe('Unrelated new task');
    expect(ctx.roadmap.value.styleLintWarnings).toEqual(['archive Track 22A collides with active ROADMAP — active wins, archive copy dropped']);
    expect(tracksForPacker(ctx).map((t) => t.id)).toEqual(['22B', '22A']);
  });

  test('raw duplicate receipts expose diagnostics that archive merge does not propagate', () => {
    const contradictory = INDIVIDUAL_RECEIPT.replace('PR #109 (commit abc1234)', 'PR #999 (commit def5678)');
    const archive = parseRoadmap(PRIOR_ARCHIVE + INDIVIDUAL_RECEIPT + contradictory);
    expect(archive.errors).toEqual([]);
    expect(archive.value.styleLintWarnings).toEqual(["22A: duplicate track ID (another track earlier in ROADMAP.md also uses '22A') — rename one; track IDs must be globally unique"]);
    const merged = mergeShippedArchive(parseRoadmap(PINNED_REMAINDER), archive);
    expect(merged.value.styleLintWarnings).toEqual([]); // Raw history inspection is a separate mandatory gate.
    expect(merged.value.tracks.filter((t) => t.id === '22A')).toHaveLength(1);
  });
});

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
