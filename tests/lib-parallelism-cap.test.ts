/**
 * lib-parallelism-cap.test.ts — CLAUDE.md override parsing for the
 * parallelism budget cap.
 *
 * Default 4 unless `<!-- roadmap:parallelism_cap=N -->` is present
 * with a positive integer N. Non-positive or non-numeric values fall
 * back to the default — preserves bash's `[ -n "$cap" ] && [ "$cap"
 * -gt 0 ]` guard.
 */

import { describe, expect, test } from 'bun:test';

import { DEFAULT_PARALLELISM_CAP, parallelismCap } from '../src/audit/lib/parallelism-cap.ts';

describe('parallelismCap', () => {
  test('default when CLAUDE.md is empty', () => {
    expect(parallelismCap('')).toBe(DEFAULT_PARALLELISM_CAP);
    expect(parallelismCap('# Hello world')).toBe(DEFAULT_PARALLELISM_CAP);
  });

  test('extracts cap from comment', () => {
    expect(parallelismCap('<!-- roadmap:parallelism_cap=8 -->')).toBe(8);
    expect(parallelismCap('Some prose\n<!-- roadmap:parallelism_cap=2 -->\nMore prose')).toBe(2);
  });

  test('first match wins on multiple', () => {
    const md = '<!-- roadmap:parallelism_cap=6 -->\n<!-- roadmap:parallelism_cap=12 -->';
    expect(parallelismCap(md)).toBe(6);
  });

  test('falls back to default on cap=0 or negative-shaped inputs', () => {
    expect(parallelismCap('<!-- roadmap:parallelism_cap=0 -->')).toBe(DEFAULT_PARALLELISM_CAP);
  });

  test('ignores cap with non-numeric value (regex doesn\'t match)', () => {
    expect(parallelismCap('<!-- roadmap:parallelism_cap=eight -->')).toBe(DEFAULT_PARALLELISM_CAP);
  });
});
