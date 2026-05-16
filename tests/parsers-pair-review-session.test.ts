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

  // ─── Coverage-feature forward compatibility ──────────────────────────
  //
  // The /pair-review smart-batching feature adds two new optional fields to
  // each item (`Covers:`, `CoverageNote:`) and a new status value
  // (`PASSED_BY_COVERAGE`). The parser is the test-plan extractor consuming
  // pair-review state; it must accept the new shape without choking. These
  // tests lock the contract.

  test('forward-compat: PASSED_BY_COVERAGE status accepted verbatim', () => {
    const dir = buildSession({
      branch: 'main',
      groupsFiles: {
        'g.md': [
          '### 1. Sign in',
          '- Status: PASSED',
          '### 2. Session cookie set',
          '- Status: PASSED_BY_COVERAGE',
          '- CoverageNote: covered by items [1]',
          '### 3. Logged-in nav renders',
          '- Status: PASSED_BY_COVERAGE',
        ].join('\n'),
      },
    });
    const items = scanPairReviewSession(dir, 'main');
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.status)).toEqual([
      'PASSED',
      'PASSED_BY_COVERAGE',
      'PASSED_BY_COVERAGE',
    ]);
    // Coverage feature exists for downstream test-plan accounting; descriptions
    // must round-trip cleanly so the test-plan extractor classifies correctly.
    expect(items.map((i) => i.description)).toEqual([
      'Sign in',
      'Session cookie set',
      'Logged-in nav renders',
    ]);
  });

  test('forward-compat: Covers and CoverageNote lines silently ignored', () => {
    // The parser is interested in (status, description). Unknown `-` lines
    // like `Covers:` or `CoverageNote:` are not status lines and must not
    // break item boundaries or stomp the current description.
    const dir = buildSession({
      branch: 'main',
      groupsFiles: {
        'g.md': [
          '### 1. Sign in with valid credentials',
          '- Build: abc123',
          '- Covers: [3, 4]',
          '- CoverageNote: covering item for session validation',
          '- Status: PASSED',
        ].join('\n'),
      },
    });
    const items = scanPairReviewSession(dir, 'main');
    expect(items).toHaveLength(1);
    expect(items[0]!.status).toBe('PASSED');
    expect(items[0]!.description).toBe('Sign in with valid credentials');
  });

  test('backward-compat: pre-coverage items (no Covers line) parse identically', () => {
    // Regression test against the v0.19.x format. A session that pre-dates
    // smart-batching has no Covers/CoverageNote lines at all; the parser
    // must continue returning the same shape it always did.
    const dir = buildSession({
      branch: 'main',
      groupsFiles: {
        'legacy.md': [
          '### 1. Old-style item',
          '- Status: PASSED',
          '- Build: deadbeef',
          '- Tested: 2026-05-01T00:00:00Z',
          '### 2. Another old item',
          '- Status: FAILED',
          '- Evidence: button misaligned',
        ].join('\n'),
      },
    });
    const items = scanPairReviewSession(dir, 'main');
    expect(items).toHaveLength(2);
    expect(items.map((i) => ({ status: i.status, description: i.description })))
      .toEqual([
        { status: 'PASSED', description: 'Old-style item' },
        { status: 'FAILED', description: 'Another old item' },
      ]);
  });

  test('mixed group: PASSED + PASSED_BY_COVERAGE + FAILED counted distinctly', () => {
    // Test-plan extractor downstream may want to filter PASSED vs
    // PASSED_BY_COVERAGE separately (e.g., for the "bundles_accepted"
    // accounting). The parser preserves the distinction.
    const dir = buildSession({
      branch: 'main',
      groupsFiles: {
        'mixed.md': [
          '### 1. Sign in',
          '- Status: PASSED',
          '### 2. Cookie set',
          '- Status: PASSED_BY_COVERAGE',
          '### 3. Logged-in nav',
          '- Status: PASSED_BY_COVERAGE',
          '### 4. Sign out',
          '- Status: FAILED',
        ].join('\n'),
      },
    });
    const items = scanPairReviewSession(dir, 'main');
    const byStatus = items.reduce<Record<string, number>>((acc, i) => {
      acc[i.status] = (acc[i.status] ?? 0) + 1;
      return acc;
    }, {});
    expect(byStatus).toEqual({
      PASSED: 1,
      PASSED_BY_COVERAGE: 2,
      FAILED: 1,
    });
  });
});
