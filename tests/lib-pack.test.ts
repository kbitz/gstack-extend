import { describe, expect, test } from 'bun:test';
import {
  packTracks,
  packingDrift,
  touchesIntersect,
  type PackTrack,
} from '../src/audit/lib/pack.ts';

function t(id: string, touches: string[], blockedBy: string[] = []): PackTrack {
  return { id, touches, blockedBy };
}

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

  test('colliding tracks spill to the next bin in the same layer', () => {
    const r = packTracks([t('1A', ['shared.ts']), t('1B', ['shared.ts']), t('1C', ['other.ts'])]);
    expect(r.bins).toHaveLength(2);
    expect(r.bins.every((b) => b.layer === 0)).toBe(true);
    const ids = r.bins.map((b) => b.trackIds.join(','));
    expect(ids).toContain('1A,1C');
    expect(ids).toContain('1B');
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
    expect(r.bins.find((b) => b.trackIds.includes('1B'))!.trackIds).toEqual(['1B']);
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
