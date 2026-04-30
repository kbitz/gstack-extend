/**
 * parsers-pair-review-session.test.ts — unit tests for scanPairReviewSession().
 *
 * Codex #7: awk-to-TS state-machine ports drift silently. These tests
 * fixture multiple variations of pair-review session shape (what the
 * e2e harness used to fixture in bash) so the parser can be debugged
 * in isolation when it breaks.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeBaseTmp } from './helpers/fixture-repo.ts';
import { scanPairReviewSession } from '../src/test-plan/parsers.ts';

const baseTmp = makeBaseTmp('parsers-pair-review-');
afterAll(() => {
  try { rmSync(baseTmp, { recursive: true, force: true }); } catch {}
});

function buildSession(opts: {
  branch: string;
  groupsFiles?: Record<string, string>;
  parkedBugs?: string;
}): string {
  const dir = join(baseTmp, `sess-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'session.yaml'),
    `branch: ${opts.branch}\nproject: test\n`,
  );
  if (opts.groupsFiles !== undefined) {
    const groupsDir = join(dir, 'groups');
    mkdirSync(groupsDir, { recursive: true });
    for (const [name, body] of Object.entries(opts.groupsFiles)) {
      writeFileSync(join(groupsDir, name), body);
    }
  }
  if (opts.parkedBugs !== undefined) {
    writeFileSync(join(dir, 'parked-bugs.md'), opts.parkedBugs);
  }
  return dir;
}

describe('scanPairReviewSession', () => {
  test('happy path: groups + parked bugs, all categories', () => {
    const dir = buildSession({
      branch: 'kbitz/widget',
      groupsFiles: {
        'widget-core.md': [
          '# Test Group: Widget Core',
          '## Items',
          '### 1. Verify list loads under 100ms',
          '- Status: PASSED',
          '### 2. Verify creation returns 50ms',
          '- Status: FAILED',
          '### 3. Verify long names',
          '- Status: SKIPPED',
        ].join('\n'),
      },
      parkedBugs: [
        '# Parked Bugs',
        '## 1. Icon flickers',
        '- Status: PARKED',
        '## 2. Typo',
        '- Status: DEFERRED_TO_TODOS',
      ].join('\n'),
    });
    const items = scanPairReviewSession(dir, 'kbitz/widget');
    expect(items).toHaveLength(5);
    expect(items.map((i) => i.status).sort()).toEqual([
      'DEFERRED_TO_TODOS',
      'FAILED',
      'PARKED',
      'PASSED',
      'SKIPPED',
    ]);
    expect(items.find((i) => i.status === 'PASSED')?.description).toBe(
      'Verify list loads under 100ms',
    );
  });

  test('branch mismatch returns empty list', () => {
    const dir = buildSession({
      branch: 'kbitz/widget',
      groupsFiles: {
        'g.md': '### 1. anything\n- Status: PASSED\n',
      },
    });
    expect(scanPairReviewSession(dir, 'kbitz/different-branch')).toEqual([]);
  });

  test('missing session.yaml returns empty list', () => {
    const dir = join(baseTmp, `nosess-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    expect(scanPairReviewSession(dir, 'any')).toEqual([]);
  });

  test('item without Status line is dropped', () => {
    const dir = buildSession({
      branch: 'main',
      groupsFiles: {
        'g.md': [
          '### 1. Has status',
          '- Status: PASSED',
          '### 2. No status, just prose',
          'Some commentary.',
          '### 3. Has status again',
          '- Status: FAILED',
        ].join('\n'),
      },
    });
    const items = scanPairReviewSession(dir, 'main');
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.description)).toEqual([
      'Has status',
      'Has status again',
    ]);
  });

  test('multiple groups files: alphabetical order', () => {
    const dir = buildSession({
      branch: 'main',
      groupsFiles: {
        'zebra.md': '### 1. From zebra\n- Status: A\n',
        'alpha.md': '### 1. From alpha\n- Status: B\n',
      },
    });
    const items = scanPairReviewSession(dir, 'main');
    // alpha.md comes first; both have one item each.
    expect(items[0]!.description).toBe('From alpha');
    expect(items[1]!.description).toBe('From zebra');
  });

  test('parked-bugs.md uses ## (depth 2); depth-3 headings ignored', () => {
    // Matches bash awk semantics: a depth-3 heading does NOT register as a
    // new parked-bug item (different regex), but does NOT reset the current
    // description either. The next `- Status:` line still carries the most
    // recent depth-2 description. Two distinct depth-2 items separate cleanly.
    const dir = buildSession({
      branch: 'main',
      parkedBugs: [
        '## 1. Real parked bug A',
        '- Status: PARKED',
        '### 2. Sub-section heading at depth 3 — not a new bug',
        '## 3. Real parked bug B',
        '- Status: DEFERRED_TO_TODOS',
      ].join('\n'),
    });
    const items = scanPairReviewSession(dir, 'main');
    expect(items).toHaveLength(2);
    expect(items[0]!.description).toBe('Real parked bug A');
    expect(items[0]!.status).toBe('PARKED');
    expect(items[1]!.description).toBe('Real parked bug B');
    expect(items[1]!.status).toBe('DEFERRED_TO_TODOS');
  });

  test('groups dir absent: gracefully degrades to parked-only', () => {
    const dir = buildSession({
      branch: 'main',
      parkedBugs: '## 1. Solo parked\n- Status: PARKED\n',
    });
    const items = scanPairReviewSession(dir, 'main');
    expect(items).toHaveLength(1);
    expect(items[0]!.description).toBe('Solo parked');
  });

  test('Unicode and special characters in descriptions preserved', () => {
    const dir = buildSession({
      branch: 'main',
      groupsFiles: {
        'g.md': '### 1. Vérify Lögin → behaves\n- Status: PASSED\n',
      },
    });
    const items = scanPairReviewSession(dir, 'main');
    expect(items[0]!.description).toBe('Vérify Lögin → behaves');
  });
});
