import { describe, expect, test } from 'bun:test';
import {
  effortFinding,
  isDoneMarkerTitle,
  parseEffortTag,
  parseTaskTitle,
} from '../src/audit/lib/task-line.ts';

describe('parseTaskTitle', () => {
  test('plain bold title', () => {
    expect(parseTaskTitle('- **Implement foo** -- body (S)')).toBe('Implement foo');
  });

  test('title with inline italics', () => {
    expect(parseTaskTitle('- **~~X~~ -- the richest *raw* yield** -- body (M)')).toBe(
      '~~X~~ -- the richest *raw* yield',
    );
  });

  test('rejects non-task lines', () => {
    expect(parseTaskTitle('- not bold')).toBeNull();
  });
});

describe('parseEffortTag', () => {
  test('accepts trailing _Source: after (S)', () => {
    expect(parseEffortTag('- **Foo** -- body (S) _Source: [ship:track=13A]._')).toEqual({
      kind: 'ok',
      effort: 'S',
    });
  });

  test('aliases XS to S', () => {
    expect(parseEffortTag('- **Foo** -- (XS)')).toEqual({
      kind: 'alias',
      effort: 'S',
      found: 'XS',
    });
  });

  test('names compound tags', () => {
    expect(parseEffortTag('- **Foo** -- (S-M)')).toEqual({ kind: 'bad', found: 'S-M' });
  });

  test('missing', () => {
    expect(parseEffortTag('- **Foo** -- no tag')).toEqual({ kind: 'missing' });
  });
});

describe('isDoneMarkerTitle', () => {
  test('checkmark run line', () => {
    expect(isDoneMarkerTitle('G0 ✓ RUN 2026-08-14')).toBe(true);
  });

  test('ordinary title', () => {
    expect(isDoneMarkerTitle('Implement foo')).toBe(false);
  });

  // Value: protects=ordinary words and identifiers that contain a marker substring stay weighted tasks;
  //   fails_when=matching reverts to substrings, ignores case, or the boundary class drops `_` or the backtick;
  //   why_new=no boundary cases existed; seam=none; no_claim=none beyond protects
  test.each([
    'Executable overlay validator',
    'EXECUTABLE',
    'Cut the legacy fallback',
    'Reconcile shipped receipts',
    'Retired ID reservation',
    'Spike a gstack-extend-shipped hook',
    'Record discharged items',
    'Emit RECOVERY_RETIRED_MANUAL on drift',
    'Rename SHIPPED_POINTER_MISSING',
    'Rename `SHIPPED` state',
  ])('ordinary title is not a marker: %s', (title) => {
    expect(isDoneMarkerTitle(title)).toBe(false);
  });

  // Value: protects=genuine completion stamps keep their treatment; fails_when=a stamp form stops matching
  //   (checkmark anywhere, uppercase token bounded by punctuation or whitespace); why_new=only the checkmark
  //   fixture existed; seam=none; no_claim=none beyond protects
  test.each([
    'G0 ✓ RUN 2026-08-14',
    'Old reader ✓',
    'Old reader — SHIPPED',
    'Old reader (CUT)',
    'RETIRED: legacy path',
    '[DISCHARGED] cleanup',
    'Track 9A ✓ Shipped (v1.2.3.0)',
  ])('genuine stamp is a marker: %s', (title) => {
    expect(isDoneMarkerTitle(title)).toBe(true);
  });

  test('a hyphen is a token boundary, so SHIPPED-STATE is a marker (documented as intended)', () => {
    expect(isDoneMarkerTitle('SHIPPED-STATE')).toBe(true);
  });
});

describe('effortFinding — marker titles', () => {
  const ok = (tier: 'S' | 'M' | 'L' | 'XL') => ({ kind: 'ok', effort: tier }) as const;

  // Value: protects=a tagged title that the parser excludes from weight is never excluded silently;
  //   fails_when=the not-weighted note is dropped, loses the token or tag, or names the wrong remedy;
  //   why_new=new branch; seam=none; no_claim=none beyond protects
  test('uppercase word with a tag: names the token and the backtick remedy', () => {
    const title = 'Validate SHIPPED receipts';
    const note = effortFinding('9A', title, parseEffortTag(`- **${title}** -- body (S)`));
    expect(note).toBe(
      '9A: task "Validate SHIPPED receipts" has (S) but marker SHIPPED marks it done — not weighted; '
        + 'if done, convert the line to prose; if not, remove or backtick SHIPPED and keep the tag',
    );
  });

  test('checkmark with a tag: remedy is to remove the checkmark', () => {
    const title = 'Old reader ✓';
    const note = effortFinding('9A', title, parseEffortTag(`- **${title}** -- body (M)`));
    expect(note).toContain('has (M) but marker ✓ marks it done — not weighted');
    expect(note).toContain('if not, remove ✓ and keep the tag');
  });

  // Value: protects=no excluded title shows a misleading alias weight; fails_when=the alias check precedes
  //   the marker check; why_new=alias plus marker was untested; seam=none; no_claim=none beyond protects
  test('alias tag on a marker title gets the not-weighted note, not the alias note', () => {
    const title = 'Old reader ✓';
    const note = effortFinding('9A', title, parseEffortTag(`- **${title}** -- body (XS)`));
    expect(note).toContain('has (XS) but marker ✓ marks it done — not weighted');
    expect(note).not.toContain('treated as');
  });

  test('alias tag on an ordinary title keeps the alias note', () => {
    const title = 'Old reader';
    const note = effortFinding('9A', title, parseEffortTag(`- **${title}** -- body (XS)`));
    expect(note).toBe('9A: found (XS) — treated as S');
  });

  test('the first marker in the title is named', () => {
    const title = 'Old reader ✓ SHIPPED';
    const note = effortFinding('9A', title, parseEffortTag(`- **${title}** -- body (S)`));
    expect(note).toContain('marker ✓ marks it done');
  });

  test('a bad tag keeps its own note even on a marker title', () => {
    const title = 'Old reader — SHIPPED';
    const note = effortFinding('9A', title, parseEffortTag(`- **${title}** -- body (S-M)`));
    expect(note).toBe('9A: found (S-M) — not a tier; use S or M');
  });

  test('an untagged marker title still reads looks done', () => {
    const note = effortFinding('9A', 'G0 ✓ RUN', { kind: 'missing' });
    expect(note).toBe('9A: task "G0 ✓ RUN" looks done — convert to prose, not a weighted task');
  });

  test('an ordinary tagged or untagged title has no note', () => {
    expect(effortFinding('9A', 'Executable overlay validator', ok('M'))).toBeNull();
    expect(effortFinding('9A', 'Executable overlay validator', { kind: 'missing' })).toBeNull();
  });

  // Value: protects=both advertised remedies actually restore weight; fails_when=the remedy text stops
  //   matching what the marker rule accepts; why_new=new remedy contract; seam=none; no_claim=none beyond protects
  test('following each remedy makes the title an ordinary task again', () => {
    expect(isDoneMarkerTitle('Validate SHIPPED receipts')).toBe(true);
    expect(isDoneMarkerTitle('Validate `SHIPPED` receipts')).toBe(false);
    expect(isDoneMarkerTitle('Old reader ✓')).toBe(true);
    expect(isDoneMarkerTitle('Old reader')).toBe(false);
  });
});
