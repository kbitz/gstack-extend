import { describe, expect, test } from 'bun:test';
import {
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
});
