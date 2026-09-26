import { afterAll, describe, test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROTOCOL_LINE, cleanupTelemetryFixtures, makeTelemetryFixture } from './helpers/telemetry-env';
import { EXPECTED_SETUP_SKILLS } from './helpers/expected-setup-skills';

afterAll(cleanupTelemetryFixtures);
const ROOT = join(import.meta.dir, '..');
const CLI = join(ROOT, 'bin/gstack-extend');
function run(env: Record<string, string>, args = ['--json'], cwd?: string) {
  return spawnSync(CLI, ['doctor', 'telemetry', ...args], { env, cwd, encoding: 'utf8', timeout: 10_000 });
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

// ─── Decision rule, classification, rendering, degradation ───

const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;
const stat = (report: any, name: string) => report.skills.find((s: { skill: string }) => s.skill === name);
const pairedRows = (skill: string, count: number) =>
  Array.from({ length: count }, (_, i) => [row(skill, 'p' + i), row(skill, 'p' + i, 'skill_run')]).flat();
const skillUse = (skill: unknown, id?: unknown, timestamp: unknown = ts()) => ({
  timestamp,
  message: { content: [{ type: 'tool_use', name: 'Skill', ...(id === undefined ? {} : { id }), input: { skill } }] },
});
function transcript(home: string, lines: unknown[], file = 'session.jsonl') {
  const folder = join(home, '.claude/projects/repo');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, file), lines.map(line => typeof line === 'string' ? line : JSON.stringify(line)).join('\n') + '\n');
  return folder;
}

describe('doctor decision rule', () => {
  const cases = [
    { name: 'exactly 95% is on target', paired: 19, unpaired: 1, transcripts: 'used', expected: { status: 'paired', percent: 95, schedule: false, seen: 1 } },
    { name: 'just under 95% with observed invocations triggers', paired: 18, unpaired: 1, transcripts: 'used', expected: { status: 'below target', percent: 94.74, schedule: true, seen: 1 } },
    { name: '100% is on target', paired: 3, unpaired: 0, transcripts: 'used', expected: { status: 'paired', percent: 100, schedule: false, seen: 1 } },
    { name: 'no transcript folder is insufficient evidence', paired: 0, unpaired: 1, transcripts: 'missing', expected: { status: 'below target', percent: 0, schedule: false, seen: null } },
    { name: 'transcripts with zero invocations are insufficient evidence', paired: 0, unpaired: 1, transcripts: 'empty', expected: { status: 'below target', percent: 0, schedule: false, seen: 0 } },
  ];
  test('marker work needs <95% pairing, the 30-day window and observed transcript invocations', () => {
    for (const c of cases) {
      const fix = makeTelemetryFixture('community', 'stub');
      seed(fix.home, [...pairedRows('roadmap', c.paired), ...Array.from({ length: c.unpaired }, (_, i) => row('roadmap', 'u' + i))]);
      if (c.transcripts === 'used') transcript(fix.home, [skillUse('roadmap', 'invocation')]);
      if (c.transcripts === 'empty') transcript(fix.home, [skillUse('qa', 'someone-else')]);
      const found = stat(JSON.parse(run(fix.env).stdout), 'roadmap');
      // Include the case name in the compared object so a failure identifies the row.
      expect({ name: c.name, status: found.status, percent: found.pairing_percent, schedule: found.schedule_marker_work, seen: found.transcripts })
        .toEqual({ name: c.name, ...c.expected });
    }
  }, 30_000);
});

describe('doctor report contents', () => {
  test('classifies rows: foreign/unknown ignored, bad timestamps counted, legacy shapes visible, activity counts include legacy', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const naive = ts(1).replace(/\.\d+Z$/, '');
    seed(fix.home, [
      row('roadmap', 'ok'), row('roadmap', 'ok', 'skill_run'),
      { ...row('roadmap', 'naive'), ts: naive },                           // no timezone: treated as UTC, in window
      { ...row('roadmap', 'bad-ts'), ts: 'garbage' },                       // unparseable
      { ...row('roadmap', 'num-ts'), ts: 12345 },                           // not a string
      { ...row('roadmap', 'unknown'), skill: 'extend:not-a-skill' },        // not an installed skill
      { skill: 'qa', ts: ts(), outcome: 'success', duration_s: 3 },         // gstack-native row, no source
      { ...row('roadmap', 'foreign'), source: 'gstack' },                   // another source
      { ...row('roadmap', 'v-bool'), v: true },                             // bool is not schema v1
      { ...row('roadmap', 'v-str'), v: '1' },
      { ...row('roadmap', 'v-two'), v: 2 },
      { ...row('roadmap', 'odd-event'), event_type: 'weird' },
      { source: 'gstack-extend', skill: 'extend:implement', ts: ts(), outcome: 'success' },  // legacy completion
    ]);
    const result = run(fix.env);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.issues).toEqual({ malformed_lines: 0, unreadable_files: 0, invalid_timestamps: 2, nameless_rows: 0 });
    // 1 paired start + 1 naive start + 4 legacy shapes = 6 activations; 1 completion.
    expect(stat(report, 'roadmap')).toMatchObject({
      activations: 6, completions: 1, legacy: 4, paired: 1, unpaired_start: 1, denominator: 2, pairing_percent: 50,
    });
    expect(stat(report, 'implement')).toMatchObject({ activations: 0, completions: 1, legacy: 1, denominator: 0, status: 'insufficient evidence' });
    expect(report.skills.map((s: { skill: string }) => s.skill)).toEqual([...EXPECTED_SETUP_SKILLS]);
  });

  test('text report: decision line only when triggered, detail lines, unavailable transcripts, missing sink', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    seed(fix.home, [
      row('roadmap', 'lost'), row('roadmap', 'ok'), row('roadmap', 'ok', 'skill_run'), row('roadmap', 'ok'),
      { ...row('implement', 'legacy'), v: undefined },
    ]);
    transcript(fix.home, [skillUse('roadmap', 'invocation')]);
    const lines = run(fix.env, []).stdout.split('\n');
    expect(lines[0]).toBe('Telemetry fidelity — last 30 days — tier: community');
    expect(lines[1]).toBe('Sink: ' + join(fix.home, '.gstack/analytics/skill-usage.jsonl') + ' (present)');
    const roadmap = lines.findIndex(line => line.startsWith('roadmap '));
    expect(lines[roadmap]).toMatch(/^roadmap\s+3\s+1\s+1\/2\s+0\s+0\s+1\s+50\.0% below target$/);
    expect(lines[roadmap + 1]).toBe('  legacy=0 duplicate-starts=1 retried-finishes=0 crossing-window=0');
    expect(lines[roadmap + 2]).toBe('  Decision rule triggered: schedule the deferred in-flight marker and crash-detection work; diagnose skipped starts separately.');
    const implement = lines.findIndex(line => line.startsWith('implement '));
    expect(lines[implement]).toMatch(/^implement\s+1\s+0\s+0\/0\s+0\s+0\s+0\s+insufficient evidence$/);
    expect(lines[implement + 1]).toBe('  legacy=1 duplicate-starts=0 retried-finishes=0 crossing-window=0');
    expect(lines.filter(line => line.includes('Decision rule triggered'))).toHaveLength(1);
    const diagnostics = lines.find(line => line.startsWith('Diagnostics: '))!;
    expect(JSON.parse(diagnostics.slice('Diagnostics: '.length))).toEqual({ invalid_timestamps: 0, malformed_lines: 0, nameless_rows: 0, unreadable_files: 0 });

    const bare = makeTelemetryFixture('community', 'stub');
    const text = run(bare.env, []).stdout;
    expect(text).toContain('(missing)');
    expect(text.match(/insufficient evidence/g)).toHaveLength(EXPECTED_SETUP_SKILLS.length);
    expect(text.match(/\bunavailable\b/g)).toHaveLength(EXPECTED_SETUP_SKILLS.length);
    expect(text).not.toContain('Decision rule triggered');
  });

  test('transcript scan normalises skill names, de-duplicates by id, and reports malformed/unreadable files separately', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const folder = transcript(fix.home, [
      skillUse('/roadmap', 'r1'), skillUse('gstack-extend:roadmap', 'r2'), skillUse('extend:roadmap', 'r3'), skillUse('roadmap', 'r4'),
      skillUse('roadmap', 'r4'),                                    // same tool_use id twice: one invocation
      skillUse('qa', 'q1'), skillUse('extend:not-a-skill', 'q2'),   // not extend skills
      skillUse('full-review'), skillUse('full-review'),             // no id: distinct positions stay distinct
      skillUse('implement', 9),                                     // non-string id is skipped
      skillUse('roadmap', 'old', ts(40)),                           // outside the window
      skillUse('roadmap', 'no-time', 'garbage'),                    // unparseable timestamp
      { timestamp: ts(), message: { content: 'plain text' } },      // string content
      { timestamp: ts(), message: { content: [{ type: 'tool_use', name: 'Bash', id: 'b', input: { skill: 'roadmap' } }] } },
      { timestamp: ts(), message: { content: [{ type: 'tool_use', name: 'Skill', id: 'nd', input: 'roadmap' }] } },
      '{not json',
    ]);
    mkdirSync(join(folder, 'directory.jsonl'));
    const report = JSON.parse(run(fix.env).stdout);
    expect(stat(report, 'roadmap').transcripts).toBe(4);
    expect(stat(report, 'full-review').transcripts).toBe(2);
    expect(stat(report, 'implement').transcripts).toBe(0);
    expect(report.transcript_issues).toEqual({ malformed_lines: 1, unreadable_files: 1 });
    expect(report.issues).toMatchObject({ malformed_lines: 0, unreadable_files: 0 });
  });
});

describe('doctor environment and arguments', () => {
  test('reports the tier and resolves the telemetry binary with the same ladder as the skill blocks', () => {
    const wired = makeTelemetryFixture('community', 'stub');
    const canonical = join(wired.home, '.claude/skills/gstack-extend/bin/gstack-extend-telemetry');
    expect(JSON.parse(run(wired.env).stdout)).toMatchObject({ tier: 'community', diagnostic: null, telemetry_binary: canonical });

    // PATH wins over the canonical install.
    const shim = join(wired.home, 'shim');
    mkdirSync(shim);
    writeFileSync(join(shim, 'gstack-extend-telemetry'), '#!/bin/sh\n' + PROTOCOL_LINE + 'exit 0\n');
    chmodSync(join(shim, 'gstack-extend-telemetry'), 0o755);
    const viaPath = JSON.parse(run({ ...wired.env, PATH: shim + ':' + wired.env.PATH }).stdout);
    expect(viaPath.telemetry_binary).toBe(join(shim, 'gstack-extend-telemetry'));

    // Disabled telemetry keeps historical rows visible.
    const off = makeTelemetryFixture('off', 'stub');
    seed(off.home, [row('roadmap', 'a'), row('roadmap', 'a', 'skill_run')]);
    const offReport = JSON.parse(run(off.env).stdout);
    expect(offReport.tier).toBe('off');
    expect(stat(offReport, 'roadmap')).toMatchObject({ activations: 1, completions: 1, paired: 1, pairing_percent: 100 });

    // No gstack and no wiring: the tier is unavailable and the binary unresolvable.
    const bare = makeTelemetryFixture('community', 'absent');
    expect(JSON.parse(run(bare.env).stdout)).toMatchObject({ tier: 'unavailable', telemetry_binary: null });

    // setup's .extend-root pointers: relative or dangling ones are ignored...
    const point = (fix: typeof bare, host: string, content: string) => {
      const dir = join(fix.home, host, 'some-skill');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, '.extend-root'), content);
      // Run from the repo root so a relative pointer like "." WOULD resolve to a real wrapper if it were honoured.
      return JSON.parse(run(fix.env, ['--json'], ROOT).stdout);
    };
    const relative = point(bare, '.codex/skills', '.\n');
    expect(relative.telemetry_binary).toBeNull();
    expect(relative.diagnostic).toContain('unresolvable');
    expect(point(bare, '.config/opencode/skills', '/nonexistent/root\n').telemetry_binary).toBeNull();
    // ...while an absolute pointer resolves from every host directory.
    for (const host of ['.claude/skills', '.codex/skills', '.config/opencode/skills', '.cursor/skills']) {
      const resolved = point(makeTelemetryFixture('community', 'absent'), host, ROOT + '\n');
      expect(resolved).toMatchObject({ telemetry_binary: join(ROOT, 'bin/gstack-extend-telemetry'), diagnostic: null });
    }
    // A stale pointer earlier in the ladder must not shadow a valid one later on.
    const stale = makeTelemetryFixture('community', 'absent');
    point(stale, '.claude/skills', '.\n');
    expect(point(stale, '.codex/skills', ROOT + '\n').telemetry_binary).toBe(join(ROOT, 'bin/gstack-extend-telemetry'));
  }, 30_000);

  test('warns about a stale wrapper and a logger without --no-sweep, and never resolves a relative PATH wrapper', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const canonical = join(fix.home, '.claude/skills/gstack-extend/bin/gstack-extend-telemetry');
    const staleDir = join(fix.home, 'stale-bin');
    mkdirSync(staleDir);
    writeFileSync(join(staleDir, 'gstack-extend-telemetry'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(staleDir, 'gstack-extend-telemetry'), 0o755);
    const env = { ...fix.env, PATH: staleDir + ':' + fix.env.PATH };
    // The compatible canonical install wins; the stale wrapper ahead of it on PATH is skipped and reported.
    const report = JSON.parse(run(env).stdout);
    expect(report).toMatchObject({ telemetry_binary: canonical, stale_wrapper: join(staleDir, 'gstack-extend-telemetry'), diagnostic: null, logger_supports_no_sweep: true });
    expect(report.warnings.join('\n')).toContain('predates the start/finish protocol');
    expect(run(env, []).stdout).toContain('Stale gstack-extend-telemetry');

    // With nothing compatible behind it, the stale wrapper is reported and the binary stays unresolvable.
    const alone = makeTelemetryFixture('community', 'absent');
    const aloneDir = join(alone.home, 'stale-bin');
    mkdirSync(aloneDir);
    writeFileSync(join(aloneDir, 'gstack-extend-telemetry'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(aloneDir, 'gstack-extend-telemetry'), 0o755);
    const aloneReport = JSON.parse(run({ ...alone.env, PATH: aloneDir + ':' + alone.env.PATH }).stdout);
    expect(aloneReport).toMatchObject({ telemetry_binary: null, stale_wrapper: join(aloneDir, 'gstack-extend-telemetry') });
    expect(aloneReport.diagnostic).toContain('unresolvable');
    expect(aloneReport.warnings.join('\n')).toContain('predates the start/finish protocol');

    // A logger that ignores --no-sweep is flagged.
    const logger = join(fix.home, '.claude/skills/gstack/bin/gstack-telemetry-log');
    writeFileSync(logger, '#!/bin/sh\nexit 0\n');
    chmodSync(logger, 0o755);
    const old = JSON.parse(run(fix.env).stdout);
    expect(old.logger_supports_no_sweep).toBe(false);
    expect(old.warnings.join('\n')).toContain('lacks --no-sweep');
    expect(run(fix.env, []).stdout).toContain('lacks --no-sweep');

    // A relative PATH entry never resolves the wrapper, even one that carries the protocol line.
    const bare = makeTelemetryFixture('community', 'absent');
    const repo = join(bare.home, 'repo');
    mkdirSync(join(repo, 'node_modules/.bin'), { recursive: true });
    writeFileSync(join(repo, 'node_modules/.bin/gstack-extend-telemetry'), '#!/bin/sh\n' + PROTOCOL_LINE + 'exit 0\n');
    chmodSync(join(repo, 'node_modules/.bin/gstack-extend-telemetry'), 0o755);
    const relative = run({ ...bare.env, PATH: 'node_modules/.bin:' + bare.env.PATH }, ['--json'], repo);
    expect(JSON.parse(relative.stdout)).toMatchObject({ telemetry_binary: null, stale_wrapper: null });
  }, 30_000);

  test('pointer files that are not plain short paths (FIFO, invalid UTF-8, oversized, multi-line) never hang or crash the doctor', () => {
    const fix = makeTelemetryFixture('community', 'absent');
    const pointer = (host: string, name: string) => { const dir = join(fix.home, host, name); mkdirSync(dir, { recursive: true }); return join(dir, '.extend-root'); };
    expect(spawnSync('mkfifo', [pointer('.claude/skills', 'aaa')]).status).toBe(0);
    writeFileSync(pointer('.claude/skills', 'bbb'), Buffer.from([0xff, 0xfe, 0x2f, 0x0a]));
    writeFileSync(pointer('.claude/skills', 'ccc'), '/' + 'x'.repeat(10_000) + '\n');
    // Like the skill block's `read -r`, only the first line counts; a second line is ignored, not appended.
    writeFileSync(pointer('.codex/skills', 'ddd'), ROOT + '\nignored second line\n');
    const r = run(fix.env);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ telemetry_binary: join(ROOT, 'bin/gstack-extend-telemetry'), diagnostic: null });
  }, 30_000);

  test('--days accepts 1..365000 ASCII digits; anything else is a one-line diagnostic; help prints usage', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const message = 'Invalid arguments: use doctor telemetry [--days N] [--json], with N from 1 to 365000.';
    for (const [args, days] of [[['--days', '365000', '--json'], 365000], [['--days', '007', '--json'], 7], [['--json', '--days', '7'], 7]] as const) {
      const result = run(fix.env, [...args]);
      expect([result.status, result.stderr, JSON.parse(result.stdout).days]).toEqual([0, '', days]);
    }
    for (const args of [['--days', '365001'], ['--days', '1234567'], ['--days', '٣'], ['--days', '+5'], ['--days=7']]) {
      const result = run(fix.env, [...args, '--json']);
      expect([result.status, result.stderr, JSON.parse(result.stdout)]).toEqual([0, '', { error: message }]);
    }
    // Text mode reports the same problem as plain text, never JSON.
    const text = run(fix.env, ['--days', '0']);
    expect([text.status, text.stderr, text.stdout]).toEqual([0, '', message + '\n']);
    for (const args of [['--help'], ['-h'], ['--json', '--help']]) {
      const help = run(fix.env, args);
      expect([help.status, help.stderr, help.stdout]).toEqual([0, '', 'Usage: gstack-extend doctor telemetry [--days N] [--json]\n']);
    }
  }, 30_000);
});

describe('doctor degraded environments', () => {
  test('unreadable input and a crashed interpreter degrade to a diagnostic and exit zero', () => {
    // A sink that cannot be read as a file is counted, not fatal.
    const asDirectory = makeTelemetryFixture('community', 'stub');
    mkdirSync(join(asDirectory.home, '.gstack/analytics/skill-usage.jsonl'), { recursive: true });
    const counted = run(asDirectory.env);
    expect([counted.status, counted.stderr]).toEqual([0, '']);
    expect(JSON.parse(counted.stdout).issues.unreadable_files).toBe(1);

    // An analytics directory that cannot be searched: never a traceback, always valid output.
    // (Older Pythons raise PermissionError from Path.exists() and report one line; newer ones treat an
    // unsearchable sink as missing and print a full report. Accept either, on whatever python3 the host has.)
    if (!IS_ROOT) {
      const locked = makeTelemetryFixture('community', 'stub');
      seed(locked.home, [row('roadmap', 'x')]);
      const dir = join(locked.home, '.gstack/analytics');
      chmodSync(dir, 0o000);
      try {
        const json = run(locked.env);
        expect([json.status, json.stderr]).toEqual([0, '']);
        const body = JSON.parse(json.stdout);
        if (body.error !== undefined) expect(body.error).toMatch(/^Telemetry report unavailable: PermissionError/);
        else expect(body.skills).toHaveLength(EXPECTED_SETUP_SKILLS.length);
        const text = run(locked.env, []);
        expect([text.status, text.stderr]).toEqual([0, '']);
        expect(text.stdout).not.toContain('Traceback');
        expect(text.stdout).toMatch(/^(Telemetry report unavailable: PermissionError|Telemetry fidelity)/);
      } finally {
        chmodSync(dir, 0o755);
      }
    }

    // The dispatcher's fallback when python itself fails: one line, exit zero, both output modes.
    const crashed = makeTelemetryFixture('community', 'stub');
    const shim = join(crashed.home, 'shim');
    mkdirSync(shim);
    writeFileSync(join(shim, 'python3'), '#!/bin/sh\nexit 3\n');
    chmodSync(join(shim, 'python3'), 0o755);
    const env = { ...crashed.env, PATH: shim + ':' + crashed.env.PATH };
    for (const args of [['--json'], []]) {
      const result = run(env, args);
      expect([result.status, result.stdout]).toEqual([0, 'Telemetry report unavailable. Check python3 and re-run ./setup. See docs/telemetry.md.\n']);
    }
  }, 30_000);

  test('hostile inputs never hang or discard the report: FIFO sink or transcript, absurdly nested JSON, unrunnable config helper', () => {
    const sinkFifo = makeTelemetryFixture('community', 'stub');
    mkdirSync(join(sinkFifo.home, '.gstack/analytics'), { recursive: true });
    expect(spawnSync('mkfifo', [join(sinkFifo.home, '.gstack/analytics/skill-usage.jsonl')]).status).toBe(0);
    const a = JSON.parse(run(sinkFifo.env).stdout);
    expect(a.issues.unreadable_files).toBe(1);
    expect(a.skills).toHaveLength(EXPECTED_SETUP_SKILLS.length);

    const transcriptFifo = makeTelemetryFixture('community', 'stub');
    mkdirSync(join(transcriptFifo.home, '.claude/projects/repo'), { recursive: true });
    expect(spawnSync('mkfifo', [join(transcriptFifo.home, '.claude/projects/repo/hang.jsonl')]).status).toBe(0);
    expect(JSON.parse(run(transcriptFifo.env).stdout).transcript_issues.unreadable_files).toBe(1);

    // One deeply nested line must count as malformed, not take the pairing stats down with it.
    const nested = makeTelemetryFixture('community', 'stub');
    seed(nested.home, [row('roadmap', 'a'), row('roadmap', 'a', 'skill_run'), '['.repeat(3000) + ']'.repeat(3000)]);
    const c = JSON.parse(run(nested.env).stdout);
    expect(c.error).toBeUndefined();
    expect(c.issues.malformed_lines).toBe(1);
    expect(stat(c, 'roadmap')).toMatchObject({ paired: 1 });

    // A config helper that cannot run leaves the tier unavailable; everything else still prints.
    const broken = makeTelemetryFixture('community', 'stub');
    const config = join(broken.home, '.claude/skills/gstack/bin/gstack-config');
    writeFileSync(config, '#!/nonexistent/interpreter\n');
    chmodSync(config, 0o755);
    const d = JSON.parse(run(broken.env).stdout);
    expect(d.tier).toBe('unavailable');
    expect(d.skills).toHaveLength(EXPECTED_SETUP_SKILLS.length);
  }, 60_000);

  test('warns when the selected wrapper has no lib/telemetry.py beside it', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const copy = join(fix.home, 'copied-bin');
    mkdirSync(copy);
    copyFileSync(join(ROOT, 'bin/gstack-extend-telemetry'), join(copy, 'gstack-extend-telemetry'));
    chmodSync(join(copy, 'gstack-extend-telemetry'), 0o755);
    const report = JSON.parse(run({ ...fix.env, PATH: copy + ':' + fix.env.PATH }).stdout);
    expect(report.telemetry_binary).toBe(join(copy, 'gstack-extend-telemetry'));
    expect(report.warnings.join('\n')).toContain('no lib/telemetry.py beside it');
    // A healthy install carries no such warning.
    expect(JSON.parse(run(fix.env).stdout).warnings).toEqual([]);
  }, 30_000);

  test('a PYTHONPATH pointing at planted modules never reaches the doctor', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const repo = join(fix.home, 'repo');
    mkdirSync(repo);
    // Python never puts the cwd on sys.path for a script run, so only PYTHONPATH can inject: the launcher's -E -s is what
    // ignores it (the wrapper's -I does the same). Without it the planted json.py runs and the report never prints.
    for (const module of ['pathlib.py', 'json.py', 'telemetry.py']) writeFileSync(join(repo, module), 'print("PLANTED")\n');
    const r = run({ ...fix.env, PYTHONPATH: '.' }, ['--json'], repo);
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).not.toContain('PLANTED');
    expect(JSON.parse(r.stdout).skills).toHaveLength(EXPECTED_SETUP_SKILLS.length);
  }, 30_000);
});
