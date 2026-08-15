import { describe, expect, test } from 'bun:test';
import {
  fillCap,
  formatPackOutput,
  packTracks,
  packingDrift,
  touchesIntersect,
  unorderedCollisions,
  type PackTrack,
} from '../src/audit/lib/pack.ts';

function t(id: string, touches: string[], blockedBy: string[] = []): PackTrack {
  return { id, touches, blockedBy };
}

describe('fillCap', () => {
  test('default is 6, never above hard max 8', () => {
    expect(fillCap()).toBe(6);
    expect(fillCap(6, 8)).toBe(6);
    expect(fillCap(8, 8)).toBe(8);
    expect(fillCap(10, 8)).toBe(8);
    expect(fillCap(4, 8)).toBe(4);
  });
});

describe('touchesIntersect', () => {
  test('disjoint files', () => {
    expect(touchesIntersect(['src/a.ts'], ['src/b.ts'])).toBe(false);
  });

  test('same file', () => {
    expect(touchesIntersect(['src/a.ts'], ['src/a.ts'])).toBe(true);
  });

  test('shared docs do not collide', () => {
    expect(touchesIntersect(['docs/ROADMAP.md', 'src/a.ts'], ['docs/ROADMAP.md', 'src/b.ts'])).toBe(
      false,
    );
  });

  test('directory prefix', () => {
    expect(touchesIntersect(['src/'], ['src/audit/cli.ts'])).toBe(true);
    expect(touchesIntersect(['src/audit/cli.ts'], ['src/'])).toBe(true);
    expect(touchesIntersect(['src/'], ['tests/foo.ts'])).toBe(false);
  });

  test('(new) marker is ignored', () => {
    expect(touchesIntersect(['src/a.ts (new)'], ['src/a.ts'])).toBe(true);
  });
});

describe('packTracks', () => {
  test('disjoint tracks pack into one bin', () => {
    const r = packTracks([t('1A', ['a.ts']), t('1B', ['b.ts']), t('1C', ['c.ts'])]);
    expect(r.bins).toHaveLength(1);
    expect(r.bins[0]!.trackIds).toEqual(['1A', '1B', '1C']);
    expect(r.bins[0]!.layer).toBe(0);
  });

  test('colliding tracks spill to a later layer, not a ready sibling', () => {
    const r = packTracks([t('1A', ['shared.ts']), t('1B', ['shared.ts']), t('1C', ['other.ts'])]);
    expect(r.bins).toHaveLength(2);
    const ready = r.bins.find((b) => b.trackIds.includes('1A'))!;
    const later = r.bins.find((b) => b.trackIds.includes('1B'))!;
    expect(ready.trackIds).toEqual(['1A', '1C']);
    expect(ready.layer).toBe(0);
    expect(later.trackIds).toEqual(['1B']);
    expect(later.layer).toBe(1);
    expect(later.blockedByTracks).toEqual(['1A']);
  });

  test('blocked-by creates a later layer', () => {
    const r = packTracks([t('2A', ['b.ts'], ['1A']), t('1A', ['a.ts'])]);
    expect(r.bins).toHaveLength(2);
    const l0 = r.bins.find((b) => b.layer === 0)!;
    const l1 = r.bins.find((b) => b.layer === 1)!;
    expect(l0.trackIds).toEqual(['1A']);
    expect(l1.trackIds).toEqual(['2A']);
    expect(l1.blockedByTracks).toEqual(['1A']);
  });

  test('scan-scope directory cannot room with anything under it', () => {
    const r = packTracks([
      t('1A', ['src/']),
      t('1B', ['src/audit/cli.ts']),
      t('1C', ['docs/foo.md']),
    ]);
    const withScan = r.bins.find((b) => b.trackIds.includes('1A'))!;
    expect(withScan.trackIds).not.toContain('1B');
    expect(withScan.trackIds).toContain('1A');
    expect(withScan.trackIds).toContain('1C');
    const later = r.bins.find((b) => b.trackIds.includes('1B'))!;
    expect(later.trackIds).toEqual(['1B']);
    expect(later.layer).toBeGreaterThan(withScan.layer);
    expect(later.blockedByTracks).toContain('1A');
  });

  test('seven disjoint tracks stay [6,1] — fill cap is one number, not absorb-to-8', () => {
    const tracks = Array.from({ length: 7 }, (_, i) => t(`${i}A`, [`f${i}.ts`]));
    const r = packTracks(tracks, { target: 6, maxPerBin: 8 });
    expect(r.bins).toHaveLength(2);
    expect(r.bins.every((b) => b.layer === 0)).toBe(true);
    const sizes = r.bins.map((b) => b.trackIds.length).sort((a, b) => b - a);
    expect(sizes).toEqual([6, 1]);
  });

  test('collision displacement re-layers dependents', () => {
    const r = packTracks([
      t('102A', ['sparkle.ts']),
      t('102B', ['sparkle.ts']),
      t('103A.1', ['dmg.ts'], ['102B']),
    ]);
    const blocker = r.bins.find((b) => b.trackIds.includes('102B'))!;
    const child = r.bins.find((b) => b.trackIds.includes('103A.1'))!;
    expect(blocker.layer).toBeLessThan(child.layer);
    expect(child.blockedByTracks).toContain('102B');
    const out = formatPackOutput(r);
    expect(out.indexOf('102B')).toBeLessThan(out.indexOf('103A.1'));
    expect(out).toMatch(/bin 3:.*_Depends on: Group <bin 2>_/);
  });

  test('overflow of 10 disjoint tracks yields two ready bins, not a chain', () => {
    const tracks = Array.from({ length: 10 }, (_, i) => t(`${i}A`, [`f${i}.ts`]));
    const r = packTracks(tracks, { target: 6, maxPerBin: 8 });
    expect(r.bins).toHaveLength(2);
    expect(r.bins.every((b) => b.layer === 0)).toBe(true);
    expect(r.bins.every((b) => b.blockedByTracks.length === 0)).toBe(true);
    const sizes = r.bins.map((b) => b.trackIds.length).sort((a, b) => b - a);
    expect(sizes).toEqual([6, 4]);
  });

  test('three-way same-file chain is layers 0, 1, 2', () => {
    const r = packTracks([
      t('1A', ['shared.ts']),
      t('1B', ['shared.ts']),
      t('1C', ['shared.ts']),
    ]);
    expect(r.bins).toHaveLength(3);
    const a = r.bins.find((b) => b.trackIds.includes('1A'))!;
    const b = r.bins.find((b) => b.trackIds.includes('1B'))!;
    const c = r.bins.find((b) => b.trackIds.includes('1C'))!;
    expect(a.layer).toBe(0);
    expect(b.layer).toBe(1);
    expect(c.layer).toBe(2);
    expect(b.blockedByTracks).toEqual(['1A']);
    expect(c.blockedByTracks).toEqual(['1A', '1B']);
  });

  test('critical path follows the longest blocked-by chain', () => {
    const r = packTracks([
      t('1A', ['a.ts']),
      t('2A', ['b.ts'], ['1A']),
      t('3A', ['c.ts'], ['2A']),
    ]);
    expect(r.criticalPath).toEqual(['1A', '2A', '3A']);
    expect(formatPackOutput(r)).toContain('CRITICAL_PATH: 3 waves through 1A → 2A → 3A');
  });

  test('empty pack is EMPTY not (none)', () => {
    const r = packTracks([]);
    expect(formatPackOutput(r)).toContain('BINS: EMPTY');
  });

  test('blocked-by loop is BINS: CYCLE, not a schedule', () => {
    const r = packTracks([t('1A', ['a.ts'], ['1B']), t('1B', ['b.ts'], ['1A'])]);
    expect(r.cycles.length).toBeGreaterThan(0);
    const out = formatPackOutput(r);
    expect(out).toContain('BINS: CYCLE');
    expect(out).toMatch(/1A.*1B|1B.*1A/);
    expect(out).not.toContain('bin 1');
  });

  test('DEPENDS paste line names the earlier bin', () => {
    const r = packTracks([t('1A', ['a.ts']), t('2A', ['b.ts'], ['1A'])]);
    const out = formatPackOutput(r);
    expect(out).toContain('_Depends on: Group <bin 1>_');
    expect(out).toContain('bin 2:');
  });

  test('packer collision-spill orders a same-file pair — no STYLE_LINT', () => {
    const colliding = [t('1A', ['shared.ts']), t('1B', ['shared.ts'])];
    expect(unorderedCollisions(colliding)).toEqual([]);
    const ordered = [t('1A', ['shared.ts']), t('1B', ['shared.ts'], ['1A'])];
    expect(unorderedCollisions(ordered)).toEqual([]);
  });

  test('unordered collision warns only when no track, bin, or group path', () => {
    // Fill the first layer-0 bin (cap 6) so 8A is a ready sibling of 1A,
    // not a roommate. 9A chains off 8A and also touches 1A's file — the
    // packer never sees them in the same layer, so only a Group DAG
    // (or an explicit _blocked-by) can order the pair.
    const tracks = [
      t('1A', ['shared.ts']),
      t('0A', ['a.ts']),
      t('0B', ['b.ts']),
      t('0C', ['c.ts']),
      t('0D', ['d.ts']),
      t('0E', ['e.ts']),
      t('8A', ['f.ts']),
      t('8B', ['g.ts'], ['8A']),
      t('9A', ['shared.ts'], ['8B']),
    ];
    expect(unorderedCollisions(tracks)).toEqual([
      'unordered collision 1A ∥ 9A — declare _blocked-by or accept arbitrary order',
    ]);
    const groupDeps = new Map<string, string[]>([
      ['1', []],
      ['8', []],
      ['9', ['1']],
    ]);
    const trackGroup = new Map([
      ['1A', '1'],
      ['0A', '1'],
      ['0B', '1'],
      ['0C', '1'],
      ['0D', '1'],
      ['0E', '1'],
      ['8A', '8'],
      ['8B', '8'],
      ['9A', '9'],
    ]);
    expect(unorderedCollisions(tracks, { trackGroup, groupDeps })).toEqual([]);
  });

  test('packing is invariant under bijective ID rename', () => {
    const tracks = [
      t('95A', ['a.ts']),
      t('93A', ['b.ts']),
      t('95B', ['c.ts']),
      t('93B', ['d.ts']),
      t('95C', ['e.ts']),
      t('93C', ['f.ts']),
    ];
    tracks.forEach((x, i) => {
      x.ord = i;
    });
    const map: Record<string, string> = {
      '95A': 'A1',
      '93A': 'Z9',
      '95B': 'A2',
      '93B': 'Z8',
      '95C': 'A3',
      '93C': 'Z7',
    };
    const renamed = tracks.map((x) => ({
      ...x,
      id: map[x.id]!,
      blockedBy: x.blockedBy.map((id) => map[id] ?? id),
    }));
    const opts = { target: 4, maxPerBin: 4 };
    const before = packTracks(tracks, opts);
    const after = packTracks(renamed, opts);
    const norm = (bins: { trackIds: string[] }[], remap?: Record<string, string>) =>
      bins
        .map((bin) =>
          bin.trackIds
            .map((id) => remap?.[id] ?? id)
            .sort()
            .join(','),
        )
        .sort();
    expect(norm(after.bins)).toEqual(norm(before.bins, map));
  });

  test('FFD tie-breaks by document order, not ID', () => {
    const tracks = [t('95A', ['a.ts']), t('93A', ['b.ts']), t('95B', ['c.ts']), t('93B', ['d.ts'])];
    tracks.forEach((x, i) => {
      x.ord = i;
    });
    const r = packTracks(tracks, { target: 2, maxPerBin: 2 });
    expect(r.bins).toHaveLength(2);
    expect(r.bins[0]!.trackIds).toEqual(['95A', '93A']);
    expect(r.bins[1]!.trackIds).toEqual(['95B', '93B']);
  });

  test('hotfix sits alone', () => {
    const r = packTracks([
      { id: '1A', touches: ['a.ts'], blockedBy: [], isHotfix: true },
      t('1B', ['b.ts']),
    ]);
    expect(r.bins.find((b) => b.trackIds.includes('1A'))!.trackIds).toEqual(['1A']);
  });
});

describe('packingDrift', () => {
  test('match is empty findings', () => {
    const packed = packTracks([t('1A', ['a.ts']), t('1B', ['b.ts'])]);
    expect(packingDrift([['1A', '1B']], packed)).toEqual([]);
  });

  test('split singletons drift', () => {
    const packed = packTracks([t('1A', ['a.ts']), t('1B', ['b.ts'])]);
    const drift = packingDrift([['1A'], ['1B']], packed);
    expect(drift.length).toBeGreaterThan(0);
  });
});
