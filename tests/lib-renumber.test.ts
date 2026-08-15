import { describe, expect, test } from 'bun:test';

import {
  applyRenames,
  isHistoricalContext,
  parseMapArg,
  parseMapFile,
} from '../src/audit/lib/renumber.ts';

describe('parseMapArg', () => {
  test('parses comma pairs', () => {
    const m = parseMapArg('101A=91A, 101B=91B, 101=91');
    expect(m.get('101A')).toBe('91A');
    expect(m.get('101B')).toBe('91B');
    expect(m.get('101')).toBe('91');
  });

  test('rejects empty and junk', () => {
    expect(() => parseMapArg('')).toThrow('empty map');
    expect(() => parseMapArg('foo')).toThrow('bad map entry');
    expect(() => parseMapArg('101A=')).toThrow('bad map entry');
  });

  test('rejects kind flip and duplicate dest', () => {
    expect(() => parseMapArg('101=91A')).toThrow('kind flip');
    expect(() => parseMapArg('101A=91A,101B=91A')).toThrow('duplicate new id');
  });
});

describe('parseMapFile', () => {
  test('skips comments and blanks', () => {
    const m = parseMapFile('# header\n101A=91A\n\n101B=91B\n');
    expect([...m.entries()]).toEqual([
      ['101A', '91A'],
      ['101B', '91B'],
    ]);
  });
});

describe('applyRenames', () => {
  test('single atomic pass survives old/new overlap', () => {
    const map = parseMapArg('101A=91A,91A=92A');
    const src = 'Track 101A and Track 91A';
    const r = applyRenames(src, map);
    expect(r.text).toBe('Track 91A and Track 92A');
    expect(r.replaced).toBe(2);
  });

  test('does not rematch replacements', () => {
    const map = parseMapArg('101A=91A,91A=92A,92A=93A');
    const r = applyRenames('101A', map);
    expect(r.text).toBe('91A');
  });

  test('lookaround matches Group 147_ italics', () => {
    const map = parseMapArg('147=91');
    const r = applyRenames('see Group 147_ next', map);
    expect(r.text).toBe('see Group 91_ next');
    expect(r.replaced).toBe(1);
  });

  test('does not eat 101A when replacing Group 101', () => {
    const map = parseMapArg('101=91');
    const r = applyRenames('Group 101 and Track 101A', map);
    expect(r.text).toBe('Group 91 and Track 101A');
  });

  test('does not eat 101.1 when replacing 101', () => {
    const map = parseMapArg('101=91');
    expect(applyRenames('Track 101.1', map).text).toBe('Track 101.1');
  });

  test('rewrites sentence-final Track 101A.', () => {
    const map = parseMapArg('101A=91A');
    expect(applyRenames('See Track 101A.', map).text).toBe('See Track 91A.');
  });

  test('does not rewrite IDs inside filenames', () => {
    const map = parseMapArg('101A=91A');
    const src = '_touches: tests/track-101A.test.ts_\n_read-first: docs/designs/track-101A.md_';
    expect(applyRenames(src, map).text).toBe(src);
    expect(applyRenames(src, map).replaced).toBe(0);
  });

  test('does not rewrite item= or version tails', () => {
    const map = parseMapArg('101=91,14=80,1=2');
    const src = '[pair-review:group=101,item=101] shipped (v0.18.14.1)';
    const r = applyRenames(src, map);
    expect(r.text).toBe('[pair-review:group=91,item=101] shipped (v0.18.14.1)');
    expect(r.replaced).toBe(1);
  });

  test('bare group numbers in prose are not IDs', () => {
    const map = parseMapArg('6=7');
    const src = 'Target capacity is 6 tracks.\n#### Group 6: Live';
    const r = applyRenames(src, map);
    expect(r.text).toBe('Target capacity is 6 tracks.\n#### Group 7: Live');
    expect(r.replaced).toBe(1);
  });

  test('skips ids on a _tombstone: line', () => {
    const map = parseMapArg('84=91,86=92,84A=91A');
    const r = applyRenames(
      '_tombstone: 84, 86, 90_\n#### Group 84: Live\n##### Track 84A: Card',
      map,
    );
    expect(r.text).toContain('_tombstone: 84, 86, 90_');
    expect(r.text).toContain('Group 91: Live');
    expect(r.text).toContain('Track 91A: Card');
    expect(r.skippedHistorical).toEqual([]);
  });

  test('longest token wins: 101A.1 before 101A', () => {
    const map = parseMapArg('101A.1=91B,101A=91A');
    const r = applyRenames('Track 101A.1 and Track 101A', map);
    expect(r.text).toBe('Track 91B and Track 91A');
  });

  test('rewrites a live id even when a historical note follows on the same line', () => {
    const map = parseMapArg('101A=91A,101B=91B');
    const r = applyRenames('See Track 101A. split from the 2026-08-14 101B.', map);
    expect(r.text).toBe('See Track 91A. split from the 2026-08-14 101B.');
    expect(r.replaced).toBe(1);
  });

  test('skips dated-historical mentions', () => {
    const map = parseMapArg('104C=91C,103A=91A');
    const src = [
      '##### Track 104C: Live',
      'split from the 2026-08-14 103A',
      'the retired 104C stays in the note',
    ].join('\n');
    const r = applyRenames(src, map);
    expect(r.text).toContain('Track 91C: Live');
    expect(r.text).toContain('split from the 2026-08-14 103A');
    expect(r.text).toContain('the retired 104C stays in the note');
    expect(r.replaced).toBe(1);
    expect(r.skippedHistorical.length).toBe(2);
  });
});

describe('isHistoricalContext', () => {
  test('date window on the same line', () => {
    const s = 'split from the 2026-08-14 103A leftover';
    const i = s.indexOf('103A');
    expect(isHistoricalContext(s, i, 4)).toBe(true);
  });

  test('live id on a line before a historical note is not historical', () => {
    const s = 'See Track 101A. split from the 2026-08-14 101B.';
    expect(isHistoricalContext(s, s.indexOf('101A'), 4)).toBe(false);
    expect(isHistoricalContext(s, s.indexOf('101B'), 4)).toBe(true);
  });

  test('live heading is not historical', () => {
    const s = '##### Track 104C: Live card';
    const i = s.indexOf('104C');
    expect(isHistoricalContext(s, i, 4)).toBe(false);
  });
});
