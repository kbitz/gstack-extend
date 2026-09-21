/**
 * Optional real-upstream schema/flag contract. The deterministic telemetry tests
 * run without gstack. Real logger/config copies omit the network sync helper;
 * HOME and all inherited state overrides are isolated by telemetry-env.
 */

import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REAL_GSTACK_ROOT, REAL_GSTACK_BIN, makeTelemetryFixture } from './helpers/telemetry-env';

const GSTACK_TELEMETRY_LOG = join(REAL_GSTACK_BIN, 'gstack-telemetry-log');
const HAS_GSTACK = existsSync(GSTACK_TELEMETRY_LOG);

// Flags our wrapper depends on. If gstack renames any of these, downstream
// extend telemetry breaks silently.
const REQUIRED_FLAGS = ['--source', '--skill', '--duration', '--outcome', '--session-id', '--event-type', '--no-sweep'] as const;

describe('gstack-telemetry-log contract (opportunistic)', () => {
  test.if(!HAS_GSTACK)('SKIPPED — gstack not installed at ~/.claude/skills/gstack/', () => {
    // This test exists so the suite reports the skip reason explicitly when
    // gstack is absent (CI / fresh devbox) instead of silently passing zero
    // contract checks. Documents the contract's enforcement gap.
    expect(HAS_GSTACK).toBe(false);
  });

  test.if(HAS_GSTACK)('gstack-telemetry-log is executable', () => {
    expect(HAS_GSTACK).toBe(true);
  });

  // For each flag we depend on, send a minimal valid invocation that uses
  // that flag and assert exit 0 + no flag-error on stderr. gstack-telemetry-log
  // uses a case-based arg parser with `*) shift ;;` default — unknown flags
  // are silently dropped (so we can't detect rename via parser errors), but
  // we CAN assert the helper exits 0 and writes nothing (when tier=off) or a
  // single row (when tier=community).
  test.if(HAS_GSTACK)('all 7 required flags accepted in a single invocation', () => {
    const fix = makeTelemetryFixture('community', 'real');
    const r = spawnSync(
      join(fix.home, '.claude/skills/gstack/bin/gstack-telemetry-log'),
      [
        '--no-sweep',
        '--source', 'gstack-extend',
        '--skill', 'extend:contract-test',
        '--duration', '7',
        '--outcome', 'success',
        '--session-id', 'sid-contract',
        '--event-type', 'skill_run',
      ],
      { env: fix.env, encoding: 'utf8', timeout: 10_000 },
    );
    expect(r.status).toBe(0);
    const rows = fix.readJsonl();
    expect(rows.length).toBe(1);
    // Confirm each flag's value actually landed in the schema — if gstack
    // renames a flag and silently drops the value, this row would have null
    // or default for that field.
    expect(rows[0].source).toBe('gstack-extend');         // --source
    expect(rows[0].skill).toBe('extend:contract-test');   // --skill
    expect(rows[0].duration_s).toBe(7);                   // --duration
    expect(rows[0].outcome).toBe('success');              // --outcome
    expect(rows[0].session_id).toBe('sid-contract');      // --session-id
    expect(rows[0].event_type).toBe('skill_run');         // --event-type
  });

  // Individual-flag round-trip: catches the case where a future gstack version
  // renames one flag but still parses the rest. gstack-telemetry-log's arg
  // parser silently drops unknown flags (`*) shift ;;`) so a row still appears
  // — but the renamed field would land as null / default. Each per-flag test
  // asserts the corresponding field appears with the supplied value in the
  // resulting jsonl row, so a silent rename trips the test.
  const PER_FLAG_CASES: Record<Exclude<typeof REQUIRED_FLAGS[number], '--no-sweep'>, { value: string; field: string; expected: string | number }> = {
    '--source':     { value: 'gstack-extend',       field: 'source',     expected: 'gstack-extend' },
    '--skill':      { value: 'extend:contract-flag', field: 'skill',      expected: 'extend:contract-flag' },
    '--duration':   { value: '42',                   field: 'duration_s', expected: 42 },
    '--outcome':    { value: 'success',              field: 'outcome',    expected: 'success' },
    '--session-id': { value: 'sid-roundtrip',        field: 'session_id', expected: 'sid-roundtrip' },
    '--event-type': { value: 'skill_run',            field: 'event_type', expected: 'skill_run' },
  };
  for (const flag of REQUIRED_FLAGS) {
    if (flag === '--no-sweep') continue;
    test.if(HAS_GSTACK)(`single-flag round-trip: ${flag} → ${PER_FLAG_CASES[flag].field}`, () => {
      const fix = makeTelemetryFixture('community', 'real');
      // Every invocation needs --skill (required for record-keeping); add the
      // flag under test on top of that (skipping the duplicate when testing --skill).
      const args = ['--skill', 'extend:contract-test', '--session-id', `sid-${flag.replace(/-/g, '')}`];
      if (flag !== '--skill' && flag !== '--session-id') {
        args.push(flag, PER_FLAG_CASES[flag].value);
      } else if (flag === '--skill') {
        // Override the placeholder skill with the test's expected value
        args[1] = PER_FLAG_CASES[flag].value;
      } else {
        // --session-id: override the auto-generated tag
        args[3] = PER_FLAG_CASES[flag].value;
      }
      const r = spawnSync(join(fix.home, '.claude/skills/gstack/bin/gstack-telemetry-log'), args, {
        env: fix.env, encoding: 'utf8', timeout: 10_000,
      });
      expect(r.status).toBe(0);
      const rows = fix.readJsonl();
      expect(rows.length).toBe(1);
      // Assert the flag's value actually landed in the schema. If gstack
      // renames the flag, the value silently drops and this assertion fails.
      expect(rows[0][PER_FLAG_CASES[flag].field]).toBe(PER_FLAG_CASES[flag].expected);
    });
  }
});


describe('foreign pending marker regression', () => {
  test.if(HAS_GSTACK)('--no-sweep preserves another session and emits no phantom row', () => {
    const fix = makeTelemetryFixture('community', 'real');
    const dir = join(fix.home, '.gstack', 'analytics');
    mkdirSync(dir, { recursive: true });
    const marker = join(dir, '.pending-OTHER');
    writeFileSync(marker, JSON.stringify({ skill: 'qa', session_id: 'OTHER', ts: '2026-09-20T00:00:00Z' }));
    const wrapper = join(import.meta.dir, '../bin/gstack-extend-telemetry');
    const start = spawnSync(wrapper, ['start', '--skill', 'extend:contract-test'], { env: fix.env, encoding: 'utf8' });
    expect(start.status).toBe(0);
    expect(existsSync(marker)).toBe(true);
    const result = spawnSync(wrapper, ['finish', '--skill', 'extend:contract-test', '--outcome', 'success'],
      { env: fix.env, encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(existsSync(marker)).toBe(true);
    expect(fix.readJsonl()).toHaveLength(2);
    expect(fix.readJsonl().some(row => row.outcome === 'unknown')).toBe(false);
  });
});
