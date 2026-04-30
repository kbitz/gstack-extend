/**
 * score-extractor.test.ts — unit tests for scripts/score-extractor.ts.
 *
 * Codex #11 mitigation: the scorer is new production-ish surface area;
 * test the parse-error path, scoring math, and threshold-edge cases
 * directly instead of treating it as untested plumbing.
 *
 * The CLI itself is exercised via spawn for argument-parsing + exit-code
 * coverage. The pure scoring logic (`scoreActualAgainstFixture`) is
 * imported and tested directly.
 */

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { scoreActualAgainstFixture } from '../scripts/score-extractor.ts';

const ROOT = join(import.meta.dir, '..');
const SCORE = join(ROOT, 'scripts', 'score-extractor.ts');

function runCli(args: string[], opts?: { stdin?: string }) {
  const r = spawnSync('bun', [SCORE, ...args], {
    encoding: 'utf8',
    input: opts?.stdin,
  });
  return {
    stdout: typeof r.stdout === 'string' ? r.stdout : '',
    stderr: typeof r.stderr === 'string' ? r.stderr : '',
    exitCode: r.status,
  };
}

describe('scoreActualAgainstFixture (pure scoring math)', () => {
  test('all keywords present → all items match', () => {
    const actual = [
      { description: 'root-cause clustering with synthesis pass' },
      { description: 'triage uses AskUserQuestion to approve' },
      { description: 'agents dispatch in parallel' },
      { description: 'dedup against existing roadmap items' },
      { description: 'state-machine resumes the right phase' },
    ];
    const r = scoreActualAgainstFixture(actual, 1);
    expect(r.matched).toBe(5);
    expect(r.total).toBe(5);
    expect(r.unmatched).toEqual([]);
  });

  test('zero keywords → no matches', () => {
    const actual = [{ description: 'completely unrelated content here' }];
    const r = scoreActualAgainstFixture(actual, 1);
    expect(r.matched).toBe(0);
    expect(r.total).toBe(5);
    expect(r.unmatched).toHaveLength(5);
  });

  test('majority threshold (>=50%) — 2/3 keywords matches', () => {
    // For a 3-keyword set, threshold = ceil(3/2) = 2. So 2 hits should match.
    const actual = [{ description: 'root-cause cluster found' }]; // 2 of 3 (root-cause, cluster); missing 'synthesis'
    const r = scoreActualAgainstFixture(actual, 1);
    // First set = ['root-cause', 'cluster', 'synthesis'] → 2/3 hits → matches
    expect(r.matched).toBeGreaterThanOrEqual(1);
  });

  test('minority threshold (1/3) — does NOT match', () => {
    // 1 hit out of 3 < ceil(3/2) = 2 → doesn't match
    const actual = [{ description: 'just root-cause alone' }];
    const r = scoreActualAgainstFixture(actual, 1);
    // First set: 1/3 hits → no match
    const firstSetUnmatched = r.unmatched.find((u) => u[0] === 'root-cause');
    expect(firstSetUnmatched).toBeDefined();
  });

  test('case-insensitive matching', () => {
    const actual = [{ description: 'ROOT-CAUSE Cluster With SYNTHESIS' }];
    const r = scoreActualAgainstFixture(actual, 1);
    expect(r.matched).toBeGreaterThanOrEqual(1);
  });

  test('items without description string are tolerated', () => {
    const actual = [
      { description: 'root-cause cluster synthesis' },
      { description: undefined },
      {},
      { description: 12345 as unknown as string }, // non-string
    ];
    expect(() => scoreActualAgainstFixture(actual, 1)).not.toThrow();
  });

  test('throws on unknown fixture number', () => {
    expect(() => scoreActualAgainstFixture([], 999)).toThrow();
  });
});

describe('CLI behavior', () => {
  test('--help exits 0 with usage on stdout', () => {
    const r = runCli(['--help']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Usage:');
    expect(r.stdout).toContain('Exit codes:');
  });

  test('no args exits 2 with usage on stderr', () => {
    const r = runCli([]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('Usage:');
  });

  test('--list-fixtures exits 0', () => {
    const r = runCli(['--list-fixtures']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Corpus fixtures');
    expect(r.stdout).toContain('Expected keyword sets');
  });

  test('--score with missing file exits 2', () => {
    const r = runCli(['--score', '/tmp/this-does-not-exist-xyz.json']);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('file not found');
  });

  test('--score with malformed JSON exits 2', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'score-test-'));
    const path = join(tmp, 'bad.json');
    writeFileSync(path, 'not json at all {[');
    const r = runCli(['--score', path]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('not valid JSON');
  });

  test('--score with non-array JSON exits 2', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'score-test-'));
    const path = join(tmp, 'object.json');
    writeFileSync(path, '{"description": "single object"}');
    const r = runCli(['--score', path]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('must be a JSON array');
  });

  test('--score with passing fixture exits 0', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'score-test-'));
    const path = join(tmp, '1-perfect.json');
    writeFileSync(
      path,
      JSON.stringify([
        { description: 'root-cause clustering with synthesis pass' },
        { description: 'triage uses AskUserQuestion to approve' },
        { description: 'agents dispatch in parallel' },
        { description: 'dedup against existing roadmap items' },
        { description: 'state-machine resumes the right phase' },
      ]),
    );
    const r = runCli(['--score', path]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('PASS');
  });

  test('--score with failing fixture exits 1', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'score-test-'));
    const path = join(tmp, '1-fail.json');
    writeFileSync(path, JSON.stringify([{ description: 'completely unrelated content' }]));
    const r = runCli(['--score', path]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain('FAIL');
  });
});
