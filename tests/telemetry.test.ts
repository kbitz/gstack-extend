/** Telemetry checks use isolated homes and execute the shipped blocks in separate processes. */

import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { HELPER_BIN, REAL_GSTACK_ROOT, makeTelemetryFixture } from './helpers/telemetry-env';

const HAS_GSTACK = existsSync(REAL_GSTACK_ROOT);
const ROOT = join(import.meta.dir, '..');
function skillBlock(path: string, kind: 'start' | 'finish') {
  const text = readFileSync(path, 'utf8');
  const marker = new RegExp('<!-- SHARED:telemetry-' + kind + ' -->[\\s\\S]*?<!-- /SHARED:telemetry-' + kind + ' -->');
  const block = text.match(marker)?.[0];
  if (!block) throw new Error('Missing telemetry block in ' + path);
  const code = block.match(/```bash\n([\s\S]*?)```/)?.[1];
  if (!code) throw new Error('Missing executable block in ' + path);
  return code;
}
function executeBlock(env: Record<string, string>, kind: 'start' | 'finish', path = join(ROOT, 'skills/full-review.md')) {
  return spawnSync('bash', ['-euc', skillBlock(path, kind)], { env, encoding: 'utf8', timeout: 10_000 });
}

describe('shipped blocks and installation lookup', () => {
  test('canonical blocks pair in independent shells through the canonical install', () => {
    const fix = makeTelemetryFixture('community');
    const start = executeBlock(fix.env, 'start');
    const finish = executeBlock(fix.env, 'finish');
    expect(start.status).toBe(0);
    expect(finish.status).toBe(0);
    const rows = fix.readJsonl();
    expect(rows).toHaveLength(2);
    expect(rows[1].session_id).toBe(rows[0].session_id);
    expect(rows[1].duration_s).toBeGreaterThanOrEqual(0);
  });
  test('PATH has precedence over the canonical installation', () => {
    const fix = makeTelemetryFixture('community');
    const bin = join(fix.home, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'gstack-extend-telemetry'), '#!/bin/bash\nprintf "path-resolved\\n"\n');
    chmodSync(join(bin, 'gstack-extend-telemetry'), 0o755);
    const r = executeBlock({ ...fix.env, PATH: bin + ':' + fix.env.PATH }, 'start');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('path-resolved\n');
    expect(fix.readJsonl()).toHaveLength(0);
  });
  for (const host of ['codex', 'opencode']) {
    test('setup-generated ' + host + ' copy resolves .extend-root without PATH wiring or GSTACK_EXTEND_DIR', () => {
      const fix = makeTelemetryFixture('community');
      rmSync(join(fix.home, '.claude/skills/gstack-extend'), { recursive: true });
      const setupTools = join(fix.home, 'setup-tools');
      mkdirSync(setupTools);
      symlinkSync(process.execPath, join(setupTools, 'bun'));
      const result = spawnSync(join(ROOT, 'setup'), ['--host', host, '--quiet'], { env: { ...fix.env, PATH: setupTools + ':' + fix.env.PATH }, encoding: 'utf8', timeout: 20_000 });
      expect(result.status).toBe(0);
      const hostDir = host === 'codex' ? '.codex/skills' : '.config/opencode/skills';
      const path = join(fix.home, hostDir, 'full-review/SKILL.md');
      expect(existsSync(join(fix.home, hostDir, 'full-review/.extend-root'))).toBe(true);
      expect(existsSync(join(fix.home, '.local/bin/gstack-extend-telemetry'))).toBe(false);
      expect(executeBlock(fix.env, 'start', path).status).toBe(0);
      expect(executeBlock(fix.env, 'finish', path).status).toBe(0);
      const rows = fix.readJsonl();
      expect(rows).toHaveLength(2);
      expect(rows[0].session_id).toBe(rows[1].session_id);
    });
  }
  test('missing python3 is a silent no-op and diagnosable without failing the skill', () => {
    const fix = makeTelemetryFixture('community');
    const args = ['start', '--skill', 'extend:roadmap'];
    const env = { ...fix.env, PATH: '/bin' };
    const quiet = spawnSync(HELPER_BIN, args, { env, encoding: 'utf8', timeout: 10_000 });
    expect(quiet.status).toBe(0);
    expect(quiet.stdout).toBe('');
    expect(quiet.stderr).toBe('');
    const debug = spawnSync(HELPER_BIN, args, {
      env: { ...env, GSTACK_EXTEND_TELEMETRY_DEBUG: '1' },
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(debug.status).toBe(0);
    expect(debug.stderr).toContain('python3 unavailable');
    expect(fix.readJsonl()).toHaveLength(0);
  });
  test('cwd pathlib.py is not imported by gstack-extend-telemetry', () => {
    const fix = makeTelemetryFixture('community');
    const repo = join(fix.home, 'repo');
    mkdirSync(repo);
    writeFileSync(join(repo, 'pathlib.py'), 'print("PLANTED")\n');
    const r = spawnSync(HELPER_BIN, ['start', '--skill', 'extend:roadmap'], {
      env: fix.env,
      cwd: repo,
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).not.toContain('PLANTED');
  });
  test('HOME .extend-root with relative content does not execute a cwd binary', () => {
    const fix = makeTelemetryFixture('community', 'absent');
    const repo = join(fix.home, 'repo');
    mkdirSync(join(repo, 'bin'), { recursive: true });
    writeFileSync(join(repo, 'bin/gstack-extend-telemetry'), '#!/bin/bash\nprintf "PLANTED_RELATIVE_POINTER\\n"\n');
    chmodSync(join(repo, 'bin/gstack-extend-telemetry'), 0o755);
    const pointerDir = join(fix.home, '.claude/skills/aaa');
    mkdirSync(pointerDir, { recursive: true });
    writeFileSync(join(pointerDir, '.extend-root'), '.\n');
    const r = spawnSync('bash', ['-euc', skillBlock(join(ROOT, 'skills/full-review.md'), 'start')], {
      env: { ...fix.env, PATH: '/bin', GSTACK_EXTEND_TELEMETRY_DEBUG: '1' },
      cwd: repo,
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('PLANTED_RELATIVE_POINTER');
    expect(r.stderr).toContain('unresolvable');
  });
  test('cwd-relative .extend-root pointers are ignored', () => {
    const fix = makeTelemetryFixture('community', 'absent');
    const repo = join(fix.home, 'repo');
    const planted = join(repo, '.claude/skills/aaa');
    mkdirSync(planted, { recursive: true });
    const evilRoot = join(fix.home, 'evil');
    mkdirSync(join(evilRoot, 'bin'), { recursive: true });
    writeFileSync(join(evilRoot, 'bin/gstack-extend-telemetry'), '#!/bin/bash\nprintf "planted\\n"\n');
    chmodSync(join(evilRoot, 'bin/gstack-extend-telemetry'), 0o755);
    writeFileSync(join(planted, '.extend-root'), evilRoot + '\n');
    const r = spawnSync('bash', ['-euc', skillBlock(join(ROOT, 'skills/full-review.md'), 'start')], {
      env: { ...fix.env, PATH: '/bin', GSTACK_EXTEND_TELEMETRY_DEBUG: '1' },
      cwd: repo,
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('unresolvable');
  });
  test('unwired install is silent by default and diagnosable without exit 127', () => {
    const fix = makeTelemetryFixture('community', 'absent');
    for (const kind of ['start', 'finish'] as const) {
      const quiet = executeBlock(fix.env, kind);
      expect(quiet.status).toBe(0);
      expect(quiet.stdout).toBe('');
      expect(quiet.stderr).toBe('');
      const debug = executeBlock({ ...fix.env, GSTACK_EXTEND_TELEMETRY_DEBUG: '1' }, kind);
      expect(debug.status).toBe(0);
      expect(debug.stderr).toContain('unresolvable');
      expect(debug.stderr).toContain('re-run ./setup');
    }
  });
});

describe('tier gates, escaping, sink resolution and diagnostics', () => {
  for (const tier of ['off', 'invalid', '']) {
    test('tier ' + JSON.stringify(tier) + ' writes nothing and explains the skip only in debug mode', () => {
      const fix = makeTelemetryFixture('off');
      writeFileSync(join(fix.home, '.gstack/config.yaml'), 'telemetry: ' + tier + '\n');
      const args = ['start', '--skill', 'extend:roadmap'];
      const quiet = runHelper(fix.env, args);
      expect(quiet.status).toBe(0);
      expect(quiet.stdout).toBe('');
      expect(quiet.stderr).toBe('');
      const debug = runHelper({ ...fix.env, GSTACK_EXTEND_TELEMETRY_DEBUG: '1' }, args);
      expect(debug.stderr).toContain('tier off, missing, or invalid');
      expect(debug.stderr).toContain('gstack-config set telemetry community');
      expect(fix.readJsonl()).toHaveLength(0);
    });
  }
  test('missing config and missing gstack are silent no-ops with corrective diagnostics', () => {
    for (const mode of ['stub', 'absent'] as const) {
      const fix = makeTelemetryFixture('community', mode);
      if (mode === 'stub') rmSync(join(fix.home, '.claude/skills/gstack/bin/gstack-config'));
      const args = ['start', '--skill', 'extend:roadmap'];
      expect(runHelper(fix.env, args).stderr).toBe('');
      const r = runHelper({ ...fix.env, GSTACK_EXTEND_TELEMETRY_DEBUG: '1' }, args);
      expect(r.status).toBe(0);
      expect(r.stderr).toContain('gstack absent or gstack-config unavailable');
      expect(r.stderr).toContain('setup');
    }
  });
  for (const skill of ['', 'roadmap', 'extend:with"quote', 'extend:UPPER', 'extend:line\nbreak']) {
    test('invalid skill ' + JSON.stringify(skill) + ' emits no row', () => {
      const fix = makeTelemetryFixture('community');
      const args = ['start', '--skill', skill];
      expect(runHelper(fix.env, args).stderr).toBe('');
      const r = runHelper({ ...fix.env, GSTACK_EXTEND_TELEMETRY_DEBUG: '1' }, args);
      expect(r.status).toBe(0);
      expect(r.stderr).toContain('invalid --skill');
      expect(fix.readJsonl()).toHaveLength(0);
    });
  }
  test('unwritable sink and handoff never fail a skill', () => {
    const fix = makeTelemetryFixture('community');
    const blocked = join(fix.home, 'not-a-directory');
    writeFileSync(blocked, '');
    const env = { ...fix.env, GSTACK_STATE_DIR: blocked, GSTACK_HOME: join(fix.home, '.gstack') };
    const args = ['start', '--skill', 'extend:roadmap'];
    const quiet = runHelper(env, args);
    expect(quiet.status).toBe(0);
    expect(quiet.stderr).toBe('');
    const debug = runHelper({ ...env, GSTACK_EXTEND_TELEMETRY_DEBUG: '1' }, args);
    expect(debug.stderr).toContain('sink unwritable');
    expect(debug.stderr).toContain('repair permissions');
    const state = runHelper({ ...fix.env, GSTACK_EXTEND_STATE_DIR: blocked, GSTACK_EXTEND_TELEMETRY_DEBUG: '1' }, args);
    expect(state.status).toBe(0);
    expect(state.stderr).toContain('state handoff unwritable');
  });
  for (const name of ['repo"quote', 'repo\\backslash', 'repo\nnewline', 'repo-雪', 'r'.repeat(200)]) {
    test('filesystem name is escaped, never rejected: ' + JSON.stringify(name), () => {
      const fix = makeTelemetryFixture('anonymous');
      const cwd = join(fix.home, name);
      mkdirSync(cwd);
      expect(spawnSync('git', ['init', '-q', cwd], { env: fix.env }).status).toBe(0);
      const r = spawnSync(HELPER_BIN, ['start', '--skill', 'extend:roadmap'], { env: fix.env, cwd, encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stderr).toBe('');
      expect(fix.readJsonl()[0].repo).toBe(name);
    });
  }
  for (const mode of ['stub', 'real'] as const) {
    test.if(mode === 'stub' || HAS_GSTACK)('sink agreement for HOME/STATE_ROOT/STATE_DIR overrides (' + mode + ')', () => {
      for (const override of ['GSTACK_HOME', 'GSTACK_STATE_ROOT', 'GSTACK_STATE_DIR']) {
        const fix = makeTelemetryFixture('community', mode);
        const alternate = join(fix.home, 'alternate');
        mkdirSync(alternate);
        writeFileSync(join(alternate, 'config.yaml'), 'telemetry: community\n');
        const env = { ...fix.env, [override]: alternate };
        runHelper(env, ['start', '--skill', 'extend:roadmap']);
        runHelper(env, ['finish', '--skill', 'extend:roadmap']);
        const expected = override === 'GSTACK_STATE_DIR' ? alternate : join(fix.home, '.gstack');
        const other = override === 'GSTACK_STATE_DIR' ? join(fix.home, '.gstack') : alternate;
        const rows = readFileSync(join(expected, 'analytics/skill-usage.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
        expect(rows).toHaveLength(2);
        expect(rows[1].session_id).toBe(rows[0].session_id);
        expect(existsSync(join(other, 'analytics/skill-usage.jsonl'))).toBe(false);
      }
    });
  }
  test('valid/leading-zero/future start values and session validation are safe', () => {
    const fix = makeTelemetryFixture('community');
    for (const start of [String(Math.floor(Date.now() / 1000)), '0000000001', '9223372036854775807']) {
      const r = runHelper(fix.env, ['finish', '--skill', 'extend:roadmap', '--start', start, '--session-id', 'explicit']);
      expect(r.status).toBe(0);
      expect(r.stderr).toBe('');
    }
    expect(fix.readJsonl()).toHaveLength(3);
    for (const sid of ['', '../bad', 'quoted"id', 'x'.repeat(201)]) {
      expect(runHelper(fix.env, ['finish', '--skill', 'extend:roadmap', '--start', '1', '--session-id', sid]).stderr).toBe('');
    }
    expect(fix.readJsonl()).toHaveLength(3);
  });
});


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
    // Stub captures args tab-separated to preserve arg boundaries
    const args = captured[0].split('\t').filter((a) => a !== '');
    expect(args[0]).toBe('--source');
    expect(args[1]).toBe('gstack-extend');
    // Confirm each flag-value pair is intact (boundary-aware, not substring search)
    expect(args).toContain('--skill');
    expect(args[args.indexOf('--skill') + 1]).toBe('extend:test');
    expect(args).toContain('--duration');
    expect(args[args.indexOf('--duration') + 1]).toBe('5');
    expect(args).toContain('--outcome');
    expect(args[args.indexOf('--outcome') + 1]).toBe('success');
    expect(args).toContain('--session-id');
    expect(args[args.indexOf('--session-id') + 1]).toBe('sid-stub');
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

describe('telemetry argument validation', () => {
  for (const start of ['abc', '12a', '', '-1', '9223372036854775808']) {
    test(`invalid start ${JSON.stringify(start)} stays silent`, () => {
      const fix = makeTelemetryFixture('community', 'stub');
      const r = runHelper(fix.env, ['finish', '--skill', 'extend:test', '--session-id', 'sid', '--start', start]);
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('');
      expect(r.stderr).toBe('');
      expect(fix.readStubArgs()).toHaveLength(0);
    });
  }
  for (const flag of ['--start', '--session-id', '--skill', '--duration']) {
    test(`missing value for ${flag} stays silent`, () => {
      const fix = makeTelemetryFixture('community', 'stub');
      const r = runHelper(fix.env, [flag]);
      expect(r.status).toBe(0);
      expect(r.stderr).toBe('');
      expect(fix.readStubArgs()).toHaveLength(0);
    });
  }
});


describe('repository + skill state handoff', () => {
  test('independent start/finish processes pair without copied flags and preserve foreign markers', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const analytics = join(fix.home, '.gstack/analytics');
    mkdirSync(analytics, { recursive: true });
    const marker = join(analytics, '.pending-OTHER');
    writeFileSync(marker, '{"skill":"qa","session_id":"OTHER"}');
    expect(runHelper(fix.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    expect(runHelper(fix.env, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    const rows = fix.readJsonl();
    expect(rows).toHaveLength(2);
    expect(rows[0].event_type).toBe('skill_start');
    expect(rows[0].v).toBe(1);
    expect(rows[0]).not.toHaveProperty('event');
    expect(rows[1].session_id).toBe(rows[0].session_id);
    expect(Number.isInteger(rows[1].duration_s)).toBe(true);
    expect(rows[1].duration_s).toBeGreaterThanOrEqual(0);
    expect(rows.some(row => row.outcome === 'unknown')).toBe(false);
    expect(existsSync(marker)).toBe(true);
    expect(readdirSync(analytics).sort()).toEqual(['.pending-OTHER', 'skill-usage.jsonl']);
    expect(readdirSync(join(fix.home, '.gstack-extend/telemetry'))).toHaveLength(0);
    expect(fix.readStubArgs()[0]).toContain('--no-sweep');
  });
  test('malformed values recover from state; explicit valid values win', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    runHelper(fix.env, ['start', '--skill', 'extend:roadmap']);
    runHelper(fix.env, ['finish', '--skill', 'extend:roadmap', '--start', 'abc', '--session-id', '../bad']);
    let rows = fix.readJsonl();
    expect(rows[1].session_id).toBe(rows[0].session_id);
    runHelper(fix.env, ['finish', '--skill', 'extend:roadmap', '--start', String(Math.floor(Date.now() / 1000)), '--session-id', 'explicit']);
    rows = fix.readJsonl();
    expect(rows[2].session_id).toBe('explicit');
  });
  test('without state finish writes nothing', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    expect(runHelper(fix.env, ['finish', '--skill', 'extend:roadmap']).status).toBe(0);
    expect(fix.readJsonl()).toHaveLength(0);
  });
  test('logger failure stays silent and keeps the matching handoff', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    writeFileSync(join(fix.home, '.claude/skills/gstack/bin/gstack-telemetry-log'), '#!/bin/bash\nexit 1\n');
    chmodSync(join(fix.home, '.claude/skills/gstack/bin/gstack-telemetry-log'), 0o755);
    expect(runHelper(fix.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    const quiet = runHelper(fix.env, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']);
    expect(quiet.status).toBe(0);
    expect(quiet.stderr).toBe('');
    const debug = runHelper({ ...fix.env, GSTACK_EXTEND_TELEMETRY_DEBUG: '1' }, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']);
    expect(debug.stderr).toContain('gstack-telemetry-log failed');
    expect(readdirSync(join(fix.home, '.gstack-extend/telemetry'))).toHaveLength(1);
    expect(fix.readJsonl()).toHaveLength(1);
  });
  test('explicit finish of an older session does not consume a later same-skill handoff', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const first = runHelper(fix.env, ['start', '--skill', 'extend:roadmap']);
    const sid = first.stdout.match(/session=(\S+)/)?.[1];
    const start = first.stdout.match(/start=(\S+)/)?.[1];
    expect(sid).toBeTruthy();
    expect(start).toBeTruthy();
    expect(runHelper(fix.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    expect(runHelper(fix.env, ['finish', '--skill', 'extend:roadmap', '--session-id', sid!, '--start', start!, '--outcome', 'success']).status).toBe(0);
    expect(readdirSync(join(fix.home, '.gstack-extend/telemetry'))).toHaveLength(1);
    expect(runHelper(fix.env, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    const rows = fix.readJsonl();
    expect(rows).toHaveLength(4);
    expect(rows[2].session_id).toBe(sid);
    expect(rows[3].session_id).toBe(rows[1].session_id);
  });
  test('same skill in separate repository roots keeps separate handoffs', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const repos = ['workspace-a', 'workspace-b'].map(name => join(fix.home, name));
    for (const cwd of repos) {
      mkdirSync(cwd);
      expect(spawnSync('git', ['init', '-q', cwd], { env: fix.env }).status).toBe(0);
      expect(spawnSync(HELPER_BIN, ['start', '--skill', 'extend:roadmap'], { env: fix.env, cwd }).status).toBe(0);
    }
    for (const cwd of repos) {
      expect(spawnSync(HELPER_BIN, ['finish', '--skill', 'extend:roadmap'], { env: fix.env, cwd }).status).toBe(0);
    }
    const rows = fix.readJsonl();
    expect(rows).toHaveLength(4);
    expect(rows[0].session_id).not.toBe(rows[1].session_id);
    expect(rows[2].session_id).toBe(rows[0].session_id);
    expect(rows[3].session_id).toBe(rows[1].session_id);
  });
});
