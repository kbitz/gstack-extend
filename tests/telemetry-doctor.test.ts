import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTelemetryFixture } from './helpers/telemetry-env';
import { EXPECTED_SETUP_SKILLS } from './helpers/expected-setup-skills';

const CLI = join(import.meta.dir, '../bin/gstack-extend');
function run(env: Record<string, string>, args = ['--json']) {
  return spawnSync(CLI, ['doctor', 'telemetry', ...args], { env, encoding: 'utf8', timeout: 10_000 });
}
function seed(home: string, rows: unknown[]) {
  const dir = join(home, '.gstack/analytics');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'skill-usage.jsonl'), rows.map(row => typeof row === 'string' ? row : JSON.stringify(row)).join('\n') + '\n');
}
const ts = (days = 1) => new Date(Date.now() - days * 86400_000).toISOString();
const row = (skill: string, session_id: string, event_type = 'skill_start', days = 1) =>
  ({ v: 1, source: 'gstack-extend', skill: 'extend:' + skill, session_id, event_type, ts: ts(days) });

describe('doctor telemetry', () => {
  for (const data of [null, '', '{"duration_s":unknown}', '{"skill":', '[]', '{"source":"gstack-extend","skill":[]}', '{"v":1,"source":"gstack-extend","skill":"extend:roadmap","ts":null}']) {
    test('always exits zero for missing/empty/malformed data ' + String(data), () => {
      const fix = makeTelemetryFixture('community', 'stub');
      if (data !== null) seed(fix.home, [data]);
      const result = run(fix.env);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout).skills.map((s: { skill: string }) => s.skill))
        .toEqual([...EXPECTED_SETUP_SKILLS]);
    });
  }
  test('joins before filtering and deduplicates regardless of file order', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    seed(fix.home, [
      row('roadmap', 'one', 'skill_run'), row('roadmap', 'one'), row('roadmap', 'one'),
      row('roadmap', 'one', 'skill_run'), row('roadmap', 'unfinished'),
      row('roadmap', 'orphan', 'skill_run'), row('roadmap', 'old', 'skill_start', 40),
      row('roadmap', 'old', 'skill_run'), row('roadmap', 'future', 'skill_start', -2),
      { ...row('roadmap', 'legacy'), v: undefined },
      { source: 'gstack-extend', skill: 'extend:roadmap', session: 'old-alias', ts: ts(), duration_s: 2 },
      { source: 'gstack-extend', skill: 'extend:roadmap', event: 'prepared-not-started', ts: ts() },
      { source: 'gstack-extend', skill: '', session_id: '', ts: ts() },
      '{"duration_s":unknown}',
      '{"partial":',
    ]);
    const result = run(fix.env);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    const skill = report.skills.find((s: any) => s.skill === 'roadmap');
    expect(skill).toMatchObject({ paired: 1, denominator: 2, pairing_percent: 50, duplicate_starts: 1,
      retried_finishes: 1, unpaired_start: 1, unpaired_finish: 1, crossing_window: 1, legacy: 3 });
    expect(report.issues).toMatchObject({ malformed_lines: 2, nameless_rows: 1 });
    for (const stat of report.skills) expect(stat.paired).toBeLessThanOrEqual(stat.denominator);
  });
  test('resumable deferred finishes do not count as fidelity defects', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    seed(fix.home, ['pair-review', 'review-and-prep', 'test-plan'].map(name => row(name, name)));
    const report = JSON.parse(run(fix.env).stdout);
    for (const name of ['pair-review', 'review-and-prep', 'test-plan']) {
      expect(report.skills.find((s: any) => s.skill === name)).toMatchObject({
        deferred_finish: 1, unpaired_start: 0, denominator: 0, pairing_percent: null, status: 'insufficient evidence',
      });
    }
  });
  test('nested Claude transcripts are advisory, de-duplicated, with host/retention caveats', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    seed(fix.home, [row('roadmap', 'missing')]);
    const folder = join(fix.home, '.claude/projects/repo/session/subagents');
    mkdirSync(folder, { recursive: true });
    const invocation = { timestamp: ts(), message: { content: [{ type: 'tool_use', name: 'Skill', id: 'unique', input: { skill: 'roadmap' } }] } };
    writeFileSync(join(folder, 'agent.jsonl'), JSON.stringify(invocation) + '\n' + JSON.stringify(invocation));
    const report = JSON.parse(run(fix.env).stdout);
    expect(report.skills.find((s: any) => s.skill === 'roadmap')).toMatchObject({
      transcripts: 1, denominator: 1, pairing_percent: 0, schedule_marker_work: true,
    });
    const text = run(fix.env, []).stdout;
    for (const caveat of ['Claude-only', 'local-only', 'retention-deleted', 'subagents/', 'not model/token spend']) expect(text).toContain(caveat);
  });
  test('schedule_marker_work is only for the 30-day decision window', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    seed(fix.home, [row('roadmap', 'missing')]);
    const folder = join(fix.home, '.claude/projects/repo/session/subagents');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'agent.jsonl'), JSON.stringify({
      timestamp: ts(),
      message: { content: [{ type: 'tool_use', name: 'Skill', id: 'unique', input: { skill: 'roadmap' } }] },
    }) + '\n');
    const skill = JSON.parse(run(fix.env, ['--days', '7', '--json']).stdout)
      .skills.find((s: { skill: string }) => s.skill === 'roadmap');
    expect(skill).toMatchObject({ pairing_percent: 0, transcripts: 1, schedule_marker_work: false });
  });
  test('--days filters starts, missing transcripts stay unavailable, unwired binary is diagnosed', () => {
    const fix = makeTelemetryFixture('community', 'absent');
    seed(fix.home, [row('roadmap', 'recent', 'skill_start', 1), row('roadmap', 'old', 'skill_start', 20)]);
    const report = JSON.parse(run(fix.env, ['--days', '7', '--json']).stdout);
    expect(report.days).toBe(7);
    expect(report.diagnostic).toContain('unresolvable');
    expect(report.skills.find((s: any) => s.skill === 'roadmap')).toMatchObject({ denominator: 1, transcripts: null });
  });
  for (const args of [['--days'], ['--days', 'abc'], ['--days', '0'], ['--days', '-1'], ['--unknown']]) {
    test('bad CLI input returns diagnostic, not ERR trap ' + args.join(' '), () => {
      const result = run(makeTelemetryFixture('off', 'absent').env, [...args, '--json']);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout).error).toContain('Invalid arguments');
    });
  }
});
