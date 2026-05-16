/**
 * telemetry.test.ts — unit + integration tests for bin/gstack-extend-telemetry
 * and the inline preamble/epilogue shell snippets in the 5 extend skill files.
 *
 * Coverage:
 *   - Unit (wrapper): tier=community writes, tier=off skips, missing-gstack
 *     no-ops silently, --source gstack-extend always prepended.
 *   - Integration (preamble+epilogue): bash subshell sources the inline
 *     snippet text, simulates a full skill activation, asserts the jsonl
 *     ends up with start+end lines marked with the right skill name and
 *     source field.
 *
 * Isolation: every test uses makeTelemetryFixture which sets HOME=$tmpdir.
 * No test ever writes to the developer's real ~/.gstack/analytics/.
 */

import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { HELPER_BIN, REAL_GSTACK_ROOT, makeTelemetryFixture } from './helpers/telemetry-env';

const HAS_GSTACK = existsSync(REAL_GSTACK_ROOT);

function runHelper(env: Record<string, string>, args: string[]) {
  return spawnSync(HELPER_BIN, args, { env, encoding: 'utf8', timeout: 10_000 });
}

describe('bin/gstack-extend-telemetry (unit)', () => {
  test('absent gstack-telemetry-log → silent exit 0', () => {
    const fix = makeTelemetryFixture('community', 'absent');
    const r = runHelper(fix.env, ['--skill', 'extend:test', '--duration', '5', '--outcome', 'success', '--session-id', 'sid-abs']);
    expect(r.status).toBe(0);
    expect(r.stdout ?? '').toBe('');
    expect(r.stderr ?? '').toBe('');
    expect(fix.readJsonl().length).toBe(0);
  });

  test('stub mode: --source gstack-extend prepended; flags pass through', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const r = runHelper(fix.env, ['--skill', 'extend:test', '--duration', '5', '--outcome', 'success', '--session-id', 'sid-stub']);
    expect(r.status).toBe(0);
    const captured = fix.readStubArgs();
    expect(captured.length).toBe(1);
    expect(captured[0]).toMatch(/^--source gstack-extend /);
    expect(captured[0]).toContain('--skill extend:test');
    expect(captured[0]).toContain('--duration 5');
    expect(captured[0]).toContain('--outcome success');
    expect(captured[0]).toContain('--session-id sid-stub');
  });

  test.if(HAS_GSTACK)('real mode + tier=community: writes one jsonl row with source:gstack-extend', () => {
    const fix = makeTelemetryFixture('community', 'real');
    const r = runHelper(fix.env, ['--skill', 'extend:test', '--duration', '5', '--outcome', 'success', '--session-id', 'sid-real-c']);
    expect(r.status).toBe(0);
    const rows = fix.readJsonl();
    expect(rows.length).toBe(1);
    expect(rows[0].source).toBe('gstack-extend');
    expect(rows[0].skill).toBe('extend:test');
    expect(rows[0].outcome).toBe('success');
    expect(rows[0].duration_s).toBe(5);
    expect(rows[0].session_id).toBe('sid-real-c');
  });

  test.if(HAS_GSTACK)('real mode + tier=off: no jsonl write', () => {
    const fix = makeTelemetryFixture('off', 'real');
    const r = runHelper(fix.env, ['--skill', 'extend:test', '--duration', '5', '--outcome', 'success', '--session-id', 'sid-real-off']);
    expect(r.status).toBe(0);
    expect(fix.readJsonl().length).toBe(0);
  });
});

// ─── Integration: preamble + epilogue end-to-end ──────────────────────
//
// Mimics what the skill prose instructs the agent to do: run the preamble
// snippet (extracted from the canonical SHARED:telemetry-preamble block),
// sleep briefly, then run the epilogue snippet (canonical SHARED:telemetry-epilogue)
// with the start_time/session_id substituted from the preamble's GE_TELEMETRY
// echo line — exactly the workflow contract.

const PREAMBLE_TEMPLATE = (skill: string) => `
set -uo pipefail
_GE_SKILL="extend:${skill}"
_GE_TEL=$(~/.claude/skills/gstack/bin/gstack-config get telemetry 2>/dev/null || true)
_GE_TEL_START=$(date +%s)
_GE_SESSION_ID="$$-$_GE_TEL_START"
if [ "\${_GE_TEL:-off}" != "off" ]; then
  mkdir -p ~/.gstack/analytics
  _GE_REPO=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "unknown")
  _GE_GVER=$(cat ~/.claude/skills/gstack/VERSION 2>/dev/null | tr -d '[:space:]' || echo "unknown")
  _GE_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf '%s\\n' '{"skill":"'"$_GE_SKILL"'","ts":"'"$_GE_TS"'","repo":"'"$_GE_REPO"'","source":"gstack-extend"}' >> ~/.gstack/analytics/skill-usage.jsonl 2>/dev/null || true
  printf '%s\\n' '{"skill":"'"$_GE_SKILL"'","ts":"'"$_GE_TS"'","session_id":"'"$_GE_SESSION_ID"'","gstack_version":"'"$_GE_GVER"'"}' > ~/.gstack/analytics/.pending-"$_GE_SESSION_ID" 2>/dev/null || true
  echo "GE_TELEMETRY: session=$_GE_SESSION_ID start=$_GE_TEL_START"
fi
`;

const EPILOGUE_TEMPLATE = (skill: string, outcome: string) => `
_GE_SKILL="extend:${skill}"
_GE_OUTCOME="${outcome}"
_GE_TEL=$(~/.claude/skills/gstack/bin/gstack-config get telemetry 2>/dev/null || true)
_GE_TEL_END=$(date +%s)
_GE_TEL_DUR=$(( _GE_TEL_END - _GE_TEL_START ))
rm -f ~/.gstack/analytics/.pending-"$_GE_SESSION_ID" 2>/dev/null || true
if [ "\${_GE_TEL:-off}" != "off" ]; then
  _GE_BIN=""
  if command -v gstack-extend-telemetry >/dev/null 2>&1; then
    _GE_BIN="gstack-extend-telemetry"
  elif [ -x "$HOME/.claude/skills/gstack-extend/bin/gstack-extend-telemetry" ]; then
    _GE_BIN="$HOME/.claude/skills/gstack-extend/bin/gstack-extend-telemetry"
  fi
  [ -n "$_GE_BIN" ] && "$_GE_BIN" --skill "$_GE_SKILL" --duration "$_GE_TEL_DUR" --outcome "$_GE_OUTCOME" --session-id "$_GE_SESSION_ID" 2>/dev/null || true
fi
`;

function runSkillSimulation(env: Record<string, string>, skill: string, tier: 'off' | 'community', outcome: string) {
  // Combined script: preamble + 1s wait + epilogue, all in one bash so vars persist
  const script = PREAMBLE_TEMPLATE(skill) + '\nsleep 1\n' + EPILOGUE_TEMPLATE(skill, outcome);
  return spawnSync('bash', ['-c', script], { env, encoding: 'utf8', timeout: 30_000 });
}

describe('skill preamble + epilogue integration', () => {
  test.if(HAS_GSTACK)('tier=community: writes 1 start line + 1 end line, both marked source:gstack-extend', () => {
    const fix = makeTelemetryFixture('community', 'real');
    const r = runSkillSimulation(fix.env, 'roadmap', 'community', 'success');
    expect(r.status).toBe(0);
    const rows = fix.readJsonl();
    expect(rows.length).toBe(2);
    // Start line: schema {skill, ts, repo, source}
    expect(rows[0].skill).toBe('extend:roadmap');
    expect(rows[0].source).toBe('gstack-extend');
    expect(typeof rows[0].ts).toBe('string');
    // End line: gstack-telemetry-log's full schema {skill, source, outcome, ...}
    expect(rows[1].skill).toBe('extend:roadmap');
    expect(rows[1].source).toBe('gstack-extend');
    expect(rows[1].outcome).toBe('success');
    expect(typeof rows[1].duration_s).toBe('number');
    expect((rows[1].duration_s as number) >= 1).toBe(true);
  });

  test.if(HAS_GSTACK)('tier=off: no jsonl lines written', () => {
    const fix = makeTelemetryFixture('off', 'real');
    const r = runSkillSimulation(fix.env, 'roadmap', 'off', 'success');
    expect(r.status).toBe(0);
    expect(fix.readJsonl().length).toBe(0);
  });

  test('gstack absent + tier=community: skill completes with no error, no jsonl', () => {
    const fix = makeTelemetryFixture('community', 'absent');
    const r = runSkillSimulation(fix.env, 'roadmap', 'community', 'success');
    // The preamble's gstack-config call fails silently (|| true), so _GE_TEL stays
    // empty → "off" branch → no writes. The epilogue's wrapper-lookup also fails
    // silently. Skill exits 0.
    expect(r.status).toBe(0);
    expect(fix.readJsonl().length).toBe(0);
  });
});
