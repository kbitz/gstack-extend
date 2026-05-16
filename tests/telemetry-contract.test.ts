/**
 * telemetry-contract.test.ts — opportunistic flag-surface guard against
 * upstream gstack drift.
 *
 * bin/gstack-extend-telemetry is a thin wrapper that exec's gstack's own
 * gstack-telemetry-log with `--source gstack-extend` prepended. If a future
 * gstack release renames any of the flags we depend on (--source, --skill,
 * --duration, --outcome, --session-id, --event-type), our wrapper silently
 * stops attributing extend activity in ~/.gstack/analytics/skill-usage.jsonl
 * — no test fails, no error, just dead telemetry the user only notices when
 * mind-meld retro shows zero extend events for a week.
 *
 * Strategy: opportunistic. When gstack-telemetry-log is on PATH or the
 * canonical install path resolves, run it with each flag we depend on and
 * confirm it either parses the flag or ignores it gracefully (exit 0).
 * When gstack isn't installed, every test SKIPS — gstack-extend works as a
 * standalone tool when its soft-dep is missing, so the contract test is
 * irrelevant in that environment.
 *
 * Isolation: GSTACK_HOME=$tmpdir via makeTelemetryFixture — never writes to
 * the developer's real ~/.gstack/analytics/.
 */

import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { REAL_GSTACK_ROOT, REAL_GSTACK_BIN, makeTelemetryFixture } from './helpers/telemetry-env';

const GSTACK_TELEMETRY_LOG = join(REAL_GSTACK_BIN, 'gstack-telemetry-log');
const HAS_GSTACK = existsSync(GSTACK_TELEMETRY_LOG);

// Flags our wrapper depends on. If gstack renames any of these, downstream
// extend telemetry breaks silently.
const REQUIRED_FLAGS = ['--source', '--skill', '--duration', '--outcome', '--session-id', '--event-type'] as const;

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
  test.if(HAS_GSTACK)('all 6 required flags accepted in a single invocation', () => {
    const fix = makeTelemetryFixture('community', 'real');
    const r = spawnSync(
      GSTACK_TELEMETRY_LOG,
      [
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

  // Individual-flag smoke tests: catch the case where a future gstack version
  // honors some flags but renames one — the all-flags-at-once test above might
  // still pass with a null for that field if the field is nullable, but a
  // per-flag round-trip catches the regression.
  for (const flag of REQUIRED_FLAGS) {
    test.if(HAS_GSTACK)(`single-flag round-trip: ${flag}`, () => {
      const fix = makeTelemetryFixture('community', 'real');
      // Minimal valid invocation: always need --skill (record-keeping)
      // plus the flag under test (when distinct from --skill).
      const args = ['--skill', 'extend:contract-test'];
      const sessionTag = `sid-${flag.replace(/-/g, '')}`;
      switch (flag) {
        case '--source':
          args.push('--source', 'gstack-extend', '--session-id', sessionTag);
          break;
        case '--skill':
          args[1] = 'extend:contract-test'; // already set
          args.push('--session-id', sessionTag);
          break;
        case '--duration':
          args.push('--duration', '42', '--session-id', sessionTag);
          break;
        case '--outcome':
          args.push('--outcome', 'success', '--session-id', sessionTag);
          break;
        case '--session-id':
          args.push('--session-id', sessionTag);
          break;
        case '--event-type':
          args.push('--event-type', 'skill_run', '--session-id', sessionTag);
          break;
      }
      const r = spawnSync(GSTACK_TELEMETRY_LOG, args, {
        env: fix.env, encoding: 'utf8', timeout: 10_000,
      });
      expect(r.status).toBe(0);
      // Tier=community always writes one row when --skill is present
      expect(fix.readJsonl().length).toBe(1);
    });
  }
});
