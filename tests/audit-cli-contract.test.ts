/**
 * audit-cli-contract.test.ts — explicit CLI contract for bin/roadmap-audit.
 *
 * D13 + TODO 2/C scope expansion: codex (#5) flagged that "full parity"
 * for a CLI tool means more than stdout — exit codes, stderr, malformed
 * input behavior, env handling. The snapshot suite covers stdout only;
 * this file pins the rest.
 *
 * Locked contract (verified by probing the bash binary 2026-04-30):
 *   - exit code is ALWAYS 0 (audit is lenient — no fatal modes)
 *   - stderr is ALWAYS empty
 *   - bogus flags pass through silently (no validation)
 *   - missing/invalid repo path → "No ROADMAP.md found" skip path
 *   - malformed ROADMAP.md → graceful per-section STATUS (fail/warn)
 *   - --scan-state emits JSON for any repo, including empty
 *
 * Why lock these: a future refactor may legitimately change exit code
 * semantics (e.g., exit 1 on missing ROADMAP). That's a contract change
 * skill consumers (`/roadmap`, `/test-plan`) need to know about. This
 * file makes those changes deliberate, not silent.
 *
 * NEW in Track 3A — no equivalent in scripts/test-*.sh.
 */

import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { makeBaseTmp, makeEmptyRepo } from './helpers/fixture-repo.ts';
import { runBin } from './helpers/run-bin.ts';

const ROOT = join(import.meta.dir, '..');
const AUDIT = join(ROOT, 'bin', 'roadmap-audit');

const baseTmp = makeBaseTmp('audit-cli-contract-');
const stateDir = join(baseTmp, 'state');
const homeDir = join(baseTmp, 'home');
mkdirSync(stateDir, { recursive: true });
mkdirSync(homeDir, { recursive: true });

process.on('exit', () => {
  try { rmSync(baseTmp, { recursive: true, force: true }); } catch {}
});

function run(args: string[]) {
  return runBin(AUDIT, args, {
    home: homeDir,
    gstackExtendDir: ROOT,
    gstackExtendStateDir: stateDir,
    // Run from a non-repo cwd so audit's no-args / no-repo-arg paths
    // don't accidentally pick up the gstack-extend repo itself.
    cwd: baseTmp,
    // Tighter timeout — these tests run fast paths (no ROADMAP).
    timeout: 10_000,
  });
}

// Plant a malformed-shape ROADMAP.md and commit it. Used by three
// graceful-degradation tests below.
function seedRoadmap(repo: string, content: string): void {
  mkdirSync(join(repo, 'docs'), { recursive: true });
  writeFileSync(join(repo, 'docs', 'ROADMAP.md'), content);
  spawnSync('git', ['-C', repo, 'add', '-A'], { encoding: 'utf8' });
  spawnSync('git', ['-C', repo, 'commit', '-m', 'seed', '--quiet'], { encoding: 'utf8' });
}

describe('audit CLI contract: exit code is always 0', () => {
  test('no args', () => {
    expect(run([]).exitCode).toBe(0);
  });

  test('valid empty repo', () => {
    const repo = makeEmptyRepo(baseTmp);
    expect(run([repo]).exitCode).toBe(0);
  });

  test('nonexistent repo path', () => {
    expect(run(['/tmp/this-path-does-not-exist-zzz']).exitCode).toBe(0);
  });

  test('file (not directory) as repo path', () => {
    expect(run(['/etc/hosts']).exitCode).toBe(0);
  });

  test('bogus flag', () => {
    const repo = makeEmptyRepo(baseTmp);
    expect(run(['--bogus-flag-not-real', repo]).exitCode).toBe(0);
  });

  test('--scan-state on empty repo', () => {
    const repo = makeEmptyRepo(baseTmp);
    expect(run(['--scan-state', repo]).exitCode).toBe(0);
  });

  test('malformed ROADMAP.md', () => {
    const repo = makeEmptyRepo(baseTmp);
    seedRoadmap(repo, 'completely\nbroken\nnot a roadmap\n');
    expect(run([repo]).exitCode).toBe(0);
  });
});

describe('audit CLI contract: stderr is always empty', () => {
  // Mirrors D13 stderr-empty assertion in audit-snapshots.test.ts, but
  // covers the error-paths the snapshot suite doesn't exercise.
  test('no args', () => {
    expect(run([]).stderr).toBe('');
  });

  test('nonexistent repo', () => {
    expect(run(['/tmp/this-path-does-not-exist-zzz']).stderr).toBe('');
  });

  test('bogus flag', () => {
    const repo = makeEmptyRepo(baseTmp);
    expect(run(['--bogus-flag-not-real', repo]).stderr).toBe('');
  });

  test('malformed ROADMAP.md', () => {
    const repo = makeEmptyRepo(baseTmp);
    seedRoadmap(repo, '## Group 1\nNo colon.\n');
    expect(run([repo]).stderr).toBe('');
  });
});

describe('audit CLI contract: graceful handling of bad input', () => {
  test('missing ROADMAP.md → skip via "No ROADMAP.md found"', () => {
    const repo = makeEmptyRepo(baseTmp);
    const r = run([repo]);
    expect(r.stdout).toContain('No ROADMAP.md found');
  });

  test('--scan-state always emits valid JSON', () => {
    const repo = makeEmptyRepo(baseTmp);
    const r = run(['--scan-state', repo]);
    // Should parse without error.
    const parsed = JSON.parse(r.stdout);
    expect(typeof parsed).toBe('object');
    expect(parsed).toHaveProperty('signals');
    expect(parsed).toHaveProperty('intents');
  });

  test('--scan-state signals schema is pinned (regression guard for renames)', () => {
    // Track 6A renamed the section STALENESS → VERSION_TAG_STALENESS and the
    // JSON key staleness_fail → version_tag_staleness_fail. Assert every
    // dispatcher-consumed key explicitly. Adding a new signal here is
    // intentional friction — skills/roadmap.md consumes this contract.
    // Note: empty repo emits `signals: null` (GREENFIELD path) — must seed a
    // ROADMAP.md to reach the keyed-signals branch.
    const repo = makeEmptyRepo(baseTmp);
    seedRoadmap(repo, '## Group 1: Foo\n#### Track 1A: Bar\n_touches: a.ts_\n- thing\n');
    const r = run(['--scan-state', repo]);
    const parsed = JSON.parse(r.stdout) as { signals: Record<string, unknown> };
    const signalKeys = Object.keys(parsed.signals).sort();
    expect(signalKeys).toEqual([
      'git_inferred_freshness',
      'has_zero_open_group',
      'in_flight_groups',
      'origin_total',
      'unprocessed_count',
      'version_tag_staleness_fail',
    ]);
    // Old key must NOT come back — explicit guard against revert.
    expect(parsed.signals).not.toHaveProperty('staleness_fail');
  });

  test('malformed ROADMAP produces at least one fail/warn STATUS', () => {
    const repo = makeEmptyRepo(baseTmp);
    seedRoadmap(repo, '## Group 1: Foo\n\nNo Tracks.\n');
    const r = run([repo]);
    // At least one section reports fail or warn — the audit detected SOMETHING wrong.
    expect(/^STATUS: (fail|warn)$/m.test(r.stdout)).toBe(true);
  });
});

// Codex-flagged: the prior 'GSTACK_EXTEND_STATE_DIR is honored' test
// asserted exitCode + empty stderr only — both of which would pass even if
// the override were silently ignored. Removed rather than left as a false-
// negative test. The override IS exercised by audit-shadow / audit-snapshots
// (per-test stateDir), and bin/roadmap-audit doesn't write any state today
// (verified during Track 3A). Reintroduce when the audit gains state-write
// behavior with an actual marker file to assert.
