/** Telemetry checks use isolated homes and execute the shipped blocks in separate processes. */

import { afterAll, describe, test, expect } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, chmodSync, utimesSync, linkSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { HELPER_BIN, NO_SWEEP_LINE, PROTOCOL_LINE, REAL_GSTACK_ROOT, cleanupTelemetryFixtures, makeTelemetryFixture, type TelemetryFixture } from './helpers/telemetry-env';
import { EXPECTED_SETUP_SKILLS } from './helpers/expected-setup-skills';

const HAS_GSTACK = existsSync(REAL_GSTACK_ROOT);
afterAll(cleanupTelemetryFixtures);
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
function executeBlock(env: Record<string, string>, kind: 'start' | 'finish', path = join(ROOT, 'skills/full-review.md'), cwd?: string) {
  return spawnSync('bash', ['-euc', skillBlock(path, kind)], { env, cwd, encoding: 'utf8', timeout: 10_000 });
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
    writeFileSync(join(bin, 'gstack-extend-telemetry'), '#!/bin/bash\n' + PROTOCOL_LINE + 'printf "path-resolved\\n"\n');
    chmodSync(join(bin, 'gstack-extend-telemetry'), 0o755);
    const r = executeBlock({ ...fix.env, PATH: bin + ':' + fix.env.PATH }, 'start');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('path-resolved\n');
    expect(fix.readJsonl()).toHaveLength(0);
  });
  for (const host of ['claude', 'codex', 'opencode']) {
    test('setup-generated ' + host + ' install resolves .extend-root without PATH wiring or GSTACK_EXTEND_DIR', () => {
      const fix = makeTelemetryFixture('community');
      rmSync(join(fix.home, '.claude/skills/gstack-extend'), { recursive: true });
      const setupTools = join(fix.home, 'setup-tools');
      mkdirSync(setupTools);
      symlinkSync(process.execPath, join(setupTools, 'bun'));
      const result = spawnSync(join(ROOT, 'setup'), ['--host', host, '--quiet'], { env: { ...fix.env, PATH: setupTools + ':' + fix.env.PATH }, encoding: 'utf8', timeout: 20_000 });
      expect(result.status).toBe(0);
      const hostDir = host === 'claude' ? '.claude/skills' : host === 'codex' ? '.codex/skills' : '.config/opencode/skills';
      const path = join(fix.home, hostDir, 'full-review/SKILL.md');
      expect(existsSync(join(fix.home, hostDir, 'full-review/.extend-root'))).toBe(true);
      expect(existsSync(join(fix.home, '.local/bin/gstack-extend-telemetry'))).toBe(false);
      expect(executeBlock(fix.env, 'start', path).status).toBe(0);
      expect(executeBlock(fix.env, 'finish', path).status).toBe(0);
      const rows = fix.readJsonl();
      expect(rows).toHaveLength(2);
      expect(rows[0].session_id).toBe(rows[1].session_id);
    }, 30_000);
  }
  test('missing python3 is a silent no-op and diagnosable without failing the skill', () => {
    const fix = makeTelemetryFixture('community');
    // A PATH holding only bash makes python3 provably absent on every host; a bare /bin still ships python3 on usr-merged Linux.
    const bare = join(fix.home, 'no-python');
    mkdirSync(bare);
    symlinkSync(Bun.which('bash')!, join(bare, 'bash'));
    const args = ['start', '--skill', 'extend:roadmap'];
    const env = { ...fix.env, PATH: bare };
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
  test('a PYTHONPATH pointing at the cwd cannot inject a module into gstack-extend-telemetry', () => {
    const fix = makeTelemetryFixture('community');
    const repo = join(fix.home, 'repo');
    mkdirSync(repo);
    // Python never puts the cwd on sys.path for a script run, so only PYTHONPATH can reach it: the -I in the shim is what
    // ignores it. Plant a module only telemetry.py imports; the python stubs for gstack-config/logger inherit the env and
    // never import uuid, so they are not hijacked.
    writeFileSync(join(repo, 'uuid.py'), 'print("PLANTED")\n');
    const r = spawnSync(HELPER_BIN, ['start', '--skill', 'extend:roadmap'], {
      env: { ...fix.env, PYTHONPATH: '.' },
      cwd: repo,
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).not.toContain('PLANTED');
    // Positive controls: the shim really ran (a hijacked import would have crashed it silently).
    expect(r.stdout).toMatch(/^GE_TELEMETRY: session=/);
    expect(fix.readJsonl()).toHaveLength(1);
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
  test('a relative PATH entry never runs a wrapper planted in the cwd, even one carrying the protocol line', () => {
    const fix = makeTelemetryFixture('community');
    const repo = join(fix.home, 'repo');
    const ran = join(fix.home, 'planted-ran');
    mkdirSync(join(repo, 'node_modules/.bin'), { recursive: true });
    const planted = join(repo, 'node_modules/.bin/gstack-extend-telemetry');
    writeFileSync(planted, `#!/bin/bash\n${PROTOCOL_LINE}: > "${ran}"\n`);
    chmodSync(planted, 0o755);
    const r = executeBlock({ ...fix.env, PATH: 'node_modules/.bin:' + fix.env.PATH }, 'start', undefined, repo);
    expect(r.status).toBe(0);
    expect(existsSync(ran)).toBe(false);
    // The block fell through to the canonical install and still recorded the start.
    expect(fix.readJsonl()).toHaveLength(1);
  });
  test('a stale wrapper without the protocol line is skipped in favor of a compatible install, or explained when none exists', () => {
    const fix = makeTelemetryFixture('community');
    const bin = join(fix.home, 'stale-bin');
    const ran = join(fix.home, 'stale-ran');
    mkdirSync(bin);
    // Shaped like the pre-protocol wrapper, which forwarded every argument (including `start`) to the logger.
    writeFileSync(join(bin, 'gstack-extend-telemetry'), `#!/bin/bash\n: > "${ran}"\n`);
    chmodSync(join(bin, 'gstack-extend-telemetry'), 0o755);
    const env = { ...fix.env, PATH: bin + ':' + fix.env.PATH };
    expect(executeBlock(env, 'start').status).toBe(0);
    expect(executeBlock(env, 'finish').status).toBe(0);
    expect(existsSync(ran)).toBe(false);
    expect(fix.readJsonl().map(row => row.event_type)).toEqual(['skill_start', 'skill_run']);

    // With no compatible install behind it, the stale wrapper is still never run.
    const alone = makeTelemetryFixture('community', 'absent');
    const aloneBin = join(alone.home, 'stale-bin');
    mkdirSync(aloneBin);
    writeFileSync(join(aloneBin, 'gstack-extend-telemetry'), `#!/bin/bash\n: > "${ran}"\n`);
    chmodSync(join(aloneBin, 'gstack-extend-telemetry'), 0o755);
    const r = executeBlock({ ...alone.env, PATH: aloneBin + ':' + alone.env.PATH, GSTACK_EXTEND_TELEMETRY_DEBUG: '1' }, 'start');
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('unresolvable or stale');
    expect(existsSync(ran)).toBe(false);
  });
  test('a FIFO named like the wrapper, or as a pointer, is never read: neither block hangs or runs it', () => {
    for (const kind of ['start', 'finish'] as const) {
      const rows = kind === 'start' ? 1 : 0;
      const fix = makeTelemetryFixture('community');
      const bin = join(fix.home, 'fifo-bin');
      mkdirSync(bin);
      expect(spawnSync('mkfifo', [join(bin, 'gstack-extend-telemetry')]).status).toBe(0);
      chmodSync(join(bin, 'gstack-extend-telemetry'), 0o755);
      // A blocking read would run into the spawn timeout and leave status null.
      expect(executeBlock({ ...fix.env, PATH: bin + ':' + fix.env.PATH }, kind).status).toBe(0);
      expect(fix.readJsonl()).toHaveLength(rows);

      // The same for a FIFO pointer, with no canonical install and a valid pointer behind it.
      const pointers = makeTelemetryFixture('community');
      rmSync(join(pointers.home, '.claude/skills/gstack-extend'), { recursive: true });
      mkdirSync(join(pointers.home, '.claude/skills/aaa'), { recursive: true });
      expect(spawnSync('mkfifo', [join(pointers.home, '.claude/skills/aaa/.extend-root')]).status).toBe(0);
      mkdirSync(join(pointers.home, '.codex/skills/full-review'), { recursive: true });
      writeFileSync(join(pointers.home, '.codex/skills/full-review/.extend-root'), ROOT + '\n');
      expect(executeBlock(pointers.env, kind).status).toBe(0);
      expect(pointers.readJsonl()).toHaveLength(rows);
    }
  }, 30_000);
  test('the protocol line the blocks grep for is the one the wrapper and helper carry', () => {
    const marker = skillBlock(join(ROOT, 'skills/full-review.md'), 'start').match(/grep -q '([^']+)'/)?.[1];
    expect(marker).toBe('telemetry-protocol: start-finish-v1');
    expect(readFileSync(HELPER_BIN, 'utf8')).toContain('# ' + marker);
    expect(readFileSync(join(ROOT, 'bin/lib/telemetry.py'), 'utf8')).toContain('PROTOCOL_MARKER = b"' + marker + '"');
  });
  test.if(Boolean(Bun.which('zsh')))('the ladder survives zsh unmatched-glob errors and finds the .extend-root pointer', () => {
    const fix = makeTelemetryFixture('community');
    // No PATH wrapper and no canonical install: only a Codex-style pointer exists, so two of the three globs match nothing.
    rmSync(join(fix.home, '.claude/skills/gstack-extend'), { recursive: true });
    const pointer = join(fix.home, '.codex/skills/full-review');
    mkdirSync(pointer, { recursive: true });
    writeFileSync(join(pointer, '.extend-root'), ROOT + '\n');
    const r = spawnSync(Bun.which('zsh')!, ['-fc', skillBlock(join(ROOT, 'skills/full-review.md'), 'start')], { env: fix.env, encoding: 'utf8', timeout: 10_000 });
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain('no matches found');
    expect(r.stdout).toMatch(/^GE_TELEMETRY: session=/);
    expect(fix.readJsonl()).toHaveLength(1);
  }, 30_000);
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
    test('tier ' + JSON.stringify(tier) + ' writes no skill-usage rows and explains the skip only in debug mode', () => {
      const fix = makeTelemetryFixture('off');
      writeFileSync(join(fix.home, '.gstack/config.yaml'), 'telemetry: ' + tier + '\n');
      const args = ['start', '--skill', 'extend:roadmap'];
      // Provenance has its own switch, so a disabled tier still hands off to finish for the local-only row.
      const quiet = runHelper(fix.env, args);
      expect([quiet.status, quiet.stderr]).toEqual([0, '']);
      expect(quiet.stdout).toMatch(/^GE_TELEMETRY: session=extend-/);
      const debug = runHelper({ ...fix.env, GSTACK_EXTEND_TELEMETRY_DEBUG: '1' }, args);
      expect(debug.stderr).toContain('tier off, missing, or invalid');
      expect(debug.stderr).toContain('gstack-config set telemetry community');
      expect(runHelper(fix.env, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
      expect(fix.readJsonl()).toHaveLength(0);
      expect(fix.readLedger()).toHaveLength(1);

      // Both switches off: "no new rows or handoffs", and no state beyond the config file itself.
      const off = makeTelemetryFixture('off');
      writeFileSync(join(off.home, '.gstack/config.yaml'), 'telemetry: ' + tier + '\n');
      mkdirSync(join(off.home, '.gstack-extend'));
      writeFileSync(join(off.home, '.gstack-extend/config'), 'provenance=false\n');
      const silent = runHelper(off.env, args);
      expect([silent.status, silent.stdout, silent.stderr]).toEqual([0, '', '']);
      expect(runHelper({ ...off.env, GSTACK_EXTEND_TELEMETRY_DEBUG: '1' }, args).stdout).toBe('');
      expect(runHelper(off.env, ['finish', '--skill', 'extend:roadmap']).status).toBe(0);
      expect(readdirSync(join(off.home, '.gstack-extend'))).toEqual(['config']);
      expect(off.readJsonl()).toHaveLength(0);
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
    }, 30_000);
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
  }, 30_000);
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
    writeFileSync(join(fix.home, '.claude/skills/gstack/bin/gstack-telemetry-log'), '#!/bin/bash\n' + NO_SWEEP_LINE + 'exit 1\n');
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

// ─── Argument contract, robustness, failure boundary, binary resolution, concurrency ───

const DEBUG = { GSTACK_EXTEND_TELEMETRY_DEBUG: '1' };

function handoffs(fix: TelemetryFixture) {
  const dir = join(fix.home, '.gstack-extend/telemetry');
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

function runAsync(env: Record<string, string>, args: string[], cwd?: string) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>(resolve => {
    const child = spawn(HELPER_BIN, args, { env, cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}

describe('completion argument contract', () => {
  test('an explicit --session-id never borrows the start time of a different session\'s handoff', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    expect(runHelper(fix.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    const sid = fix.readJsonl()[0].session_id;
    const other = runHelper({ ...fix.env, ...DEBUG }, ['finish', '--skill', 'extend:roadmap', '--session-id', 'extend-unrelated', '--outcome', 'success']);
    expect(other.status).toBe(0);
    expect(other.stderr).toContain('missing or malformed start/session state');
    expect(fix.readJsonl()).toHaveLength(1);
    expect(handoffs(fix)).toHaveLength(1);
    // The handoff's own session still pairs from an explicit id alone.
    expect(runHelper(fix.env, ['finish', '--skill', 'extend:roadmap', '--session-id', sid, '--outcome', 'success']).status).toBe(0);
    expect(fix.readJsonl().map(row => row.session_id)).toEqual([sid, sid]);
  });

  test('repositories whose paths differ only by CR versus LF keep separate handoffs', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    for (const name of ['repo\rx', 'repo\nx']) {
      const cwd = join(fix.home, name);
      mkdirSync(cwd);
      expect(spawnSync('git', ['init', '-q', cwd], { env: fix.env }).status).toBe(0);
      expect(spawnSync(HELPER_BIN, ['start', '--skill', 'extend:roadmap'], { env: fix.env, cwd, encoding: 'utf8' }).status).toBe(0);
    }
    expect(handoffs(fix)).toHaveLength(2);
  });

  test('python older than 3.9 is a quiet, diagnosable skip instead of an AttributeError in the boundary', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    // Pre-import everything the module needs, then fake the version so only the module's own guard sees 3.8.
    const code = "import sys, runpy, hashlib, json, os, pathlib, re, shutil, subprocess, tempfile, time, uuid, datetime\n" +
      "p = sys.argv[1]; sys.argv = [p] + sys.argv[2:]; sys.version_info = (3, 8, 0, 'final', 0); runpy.run_path(p, run_name='__main__')";
    const run = (env: Record<string, string>) => spawnSync('python3', ['-c', code, join(ROOT, 'bin/lib/telemetry.py'), 'start', '--skill', 'extend:roadmap'], { env, encoding: 'utf8', timeout: 10_000 });
    const quiet = run(fix.env);
    expect([quiet.status, quiet.stdout, quiet.stderr]).toEqual([0, '', '']);
    expect(run({ ...fix.env, ...DEBUG }).stderr).toContain('older than 3.9');
    expect(fix.readJsonl()).toHaveLength(0);
  });
  test('a value that merely starts with -- is forwarded, not mistaken for a missing value', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    expect(runHelper(fix.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    const message = '--dry-run flag rejected by the CLI';
    const r = runHelper(fix.env, ['finish', '--skill', 'extend:roadmap', '--outcome', 'error', '--error-message', message]);
    expect(r.status).toBe(0);
    const args = fix.readStubArgs()[0].split('\t');
    expect(args[args.indexOf('--error-message') + 1]).toBe(message);
    expect(fix.readJsonl()).toHaveLength(2);
    expect(handoffs(fix)).toHaveLength(0);
  });

  test('a logger without --no-sweep support is not delegated to; the handoff is kept and debug explains the upgrade', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const logger = join(fix.home, '.claude/skills/gstack/bin/gstack-telemetry-log');
    // gstack before 1.80.0.0 ignores the flag and would finalize other sessions' markers as phantom rows.
    writeFileSync(logger, '#!/bin/bash\necho "$@" >> "$HOME/logger-called"\n');
    chmodSync(logger, 0o755);
    expect(runHelper(fix.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    const finish = ['finish', '--skill', 'extend:roadmap', '--outcome', 'success'];
    const quiet = runHelper(fix.env, finish);
    expect([quiet.status, quiet.stdout, quiet.stderr]).toEqual([0, '', '']);
    const debug = runHelper({ ...fix.env, ...DEBUG }, finish);
    expect(debug.stderr).toContain('lacks --no-sweep');
    expect(debug.stderr).toContain('gstack-upgrade');
    expect(existsSync(join(fix.home, 'logger-called'))).toBe(false);
    expect(handoffs(fix)).toHaveLength(1);
    expect(fix.readJsonl()).toHaveLength(1);
  });

  test('optional flags reach the logger intact; callers cannot override source/event type or drop --no-sweep', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const pwned = join(fix.home, 'pwned');
    // Shell metacharacters must travel as ONE argv element, never through a shell.
    const message = `bad; $(touch ${pwned}) "double" 'single' \`tick\``;
    expect(runHelper(fix.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    // --no-sweep sits mid-list on purpose: it must not swallow the next flag.
    const r = runHelper(fix.env, ['finish', '--skill', 'extend:roadmap', '--no-sweep', '--outcome', 'error',
      '--used-browse', 'true', '--error-class', 'Boom', '--error-message', message, '--failed-step', 'step one',
      '--source', 'evil', '--event-type', 'attack_attempt']);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    const args = fix.readStubArgs()[0].split('\t');
    for (const [flag, value] of [['--outcome', 'error'], ['--used-browse', 'true'], ['--error-class', 'Boom'],
      ['--error-message', message], ['--failed-step', 'step one']]) {
      expect(args[args.indexOf(flag) + 1]).toBe(value);
    }
    expect(args.filter(a => a === '--source')).toHaveLength(1);
    expect(args[args.indexOf('--source') + 1]).toBe('gstack-extend');
    expect(args).not.toContain('--event-type');
    expect(args).not.toContain('evil');
    expect(args.filter(a => a === '--no-sweep')).toHaveLength(1);
    expect(existsSync(pwned)).toBe(false);
    expect(fix.readJsonl()[1]).toMatchObject({ event_type: 'skill_run', source: 'gstack-extend', outcome: 'error' });
  }, 30_000);

  test('duration is wall-clock seconds since start, clamped at zero; legacy flags keep working', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const now = Math.floor(Date.now() / 1000);
    // Returns the --duration handed to the logger, or null when the call was skipped.
    const forwarded = (args: string[]) => {
      const before = fix.readStubArgs().length;
      expect(runHelper(fix.env, args).status).toBe(0);
      const calls = fix.readStubArgs();
      if (calls.length === before) return null;
      const parts = calls[calls.length - 1].split('\t');
      return Number(parts[parts.indexOf('--duration') + 1]);
    };
    const near = (value: number | null, expected: number) => value !== null && value >= expected && value <= expected + 60;
    expect(near(forwarded(['finish', '--skill', 'extend:roadmap', '--start', String(now - 30), '--session-id', 'sid-a']), 30)).toBe(true);
    expect(forwarded(['finish', '--skill', 'extend:roadmap', '--start', String(now + 500), '--session-id', 'sid-b'])).toBe(0);
    // Legacy bare flags: --duration is honoured verbatim, but a valid --start still wins.
    expect(forwarded(['--skill', 'extend:roadmap', '--duration', '42', '--session-id', 'sid-c'])).toBe(42);
    expect(near(forwarded(['--skill', 'extend:roadmap', '--duration', '5', '--start', String(now - 30), '--session-id', 'sid-d']), 30)).toBe(true);
    // Skipped: explicit finish ignores --duration; legacy still needs a valid duration and session.
    expect(forwarded(['finish', '--skill', 'extend:roadmap', '--duration', '5', '--session-id', 'sid-e'])).toBeNull();
    expect(forwarded(['--skill', 'extend:roadmap', '--duration', 'abc', '--session-id', 'sid-f'])).toBeNull();
    expect(forwarded(['--skill', 'extend:roadmap', '--duration', '5'])).toBeNull();
  }, 30_000);

  test('help goes to stdout; malformed flag arity skips quietly with an actionable debug hint', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    for (const flag of ['--help', '-h']) {
      const r = runHelper(fix.env, [flag]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('Usage: gstack-extend-telemetry start|finish --skill "extend:<name>"');
      expect(r.stdout).toContain('GSTACK_EXTEND_TELEMETRY_DEBUG=1');
      expect(r.stderr).toBe('');
    }
    const cases: Array<[string[], string]> = [
      [['finish', '--skill', '--outcome', 'success'], 'invalid flag or missing value for'],
      [['finish', '--skill', 'extend:roadmap', '--bogus', 'x'], 'invalid flag or missing value for'],
      [['unexpected-word'], 'invalid flag or missing value for'],
      [[], 'invalid --skill'],
    ];
    for (const [args, hint] of cases) {
      const quiet = runHelper(fix.env, args);
      expect([quiet.status, quiet.stdout, quiet.stderr]).toEqual([0, '', '']);
      const debug = runHelper({ ...fix.env, ...DEBUG }, args);
      expect(debug.status).toBe(0);
      expect(debug.stderr).toContain(hint);
      expect(debug.stderr).toContain('docs/telemetry.md');
    }
    expect(fix.readJsonl()).toHaveLength(0);
    expect(handoffs(fix)).toEqual([]);

    // A flag must never be consumed as the previous flag's value: with valid state and "--outcome --used-browse true",
    // swallowing would still look well formed and log outcome "--used-browse".
    expect(runHelper(fix.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    const swallowed = runHelper({ ...fix.env, ...DEBUG }, ['finish', '--skill', 'extend:roadmap', '--outcome', '--used-browse', 'true']);
    expect(swallowed.status).toBe(0);
    expect(swallowed.stderr).toContain("invalid flag or missing value for '--outcome'");
    expect(fix.readStubArgs()).toHaveLength(0);
    expect(fix.readJsonl()).toHaveLength(1);
    expect(handoffs(fix)).toHaveLength(1);
  }, 30_000);
});

describe('handoff robustness', () => {
  test('a corrupt or hostile handoff never crashes finish; an integer start is honoured; the next start replaces bad state', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    expect(runHelper(fix.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    const file = join(fix.home, '.gstack-extend/telemetry', handoffs(fix)[0]);
    const corrupt = ['garbage{{', '[]', '"string"', '', '{"session_id":"abc","start":true}',
      '{"session_id":"abc","start":-5}', '{"session_id":"bad id","start":"5"}', '{"session_id":"abc","start":"not-a-number"}'];
    for (const content of corrupt) {
      writeFileSync(file, content);
      const finish = runHelper(fix.env, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']);
      expect([finish.status, finish.stdout, finish.stderr]).toEqual([0, '', '']);
      expect(fix.readJsonl()).toHaveLength(1);
    }
    const debug = runHelper({ ...fix.env, ...DEBUG }, ['finish', '--skill', 'extend:roadmap']);
    expect(debug.stderr).toContain('missing or malformed start/session state');
    // JSON integers (not just strings) are a valid start; the matching handoff is then consumed.
    writeFileSync(file, JSON.stringify({ session_id: 'from-state', start: Math.floor(Date.now() / 1000) - 20 }));
    expect(runHelper(fix.env, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    expect(fix.readJsonl()[1]).toMatchObject({ session_id: 'from-state', event_type: 'skill_run' });
    expect(fix.readJsonl()[1].duration_s).toBeGreaterThanOrEqual(20);
    expect(existsSync(file)).toBe(false);
    // Recovery: bad state left behind is overwritten by the next start and pairs normally.
    writeFileSync(file, 'garbage{{');
    expect(runHelper(fix.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    expect(runHelper(fix.env, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    const rows = fix.readJsonl();
    expect(rows.at(-1)!.session_id).toBe(rows.at(-2)!.session_id);
    expect(handoffs(fix)).toHaveLength(0);
  }, 30_000);

  test('outside a repository the row says unknown and each directory keeps its own handoff', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    // The ceiling keeps git from discovering a repository above the temporary home.
    const env = { ...fix.env, GIT_CEILING_DIRECTORIES: fix.home };
    const [a, b] = ['plain-a', 'plain-b'].map(name => {
      const dir = join(fix.home, name);
      mkdirSync(dir);
      return dir;
    });
    const start = (cwd: string, extra: Record<string, string> = {}) =>
      spawnSync(HELPER_BIN, ['start', '--skill', 'extend:roadmap'], { env: { ...env, ...extra }, cwd, encoding: 'utf8' });
    const traced = start(a, DEBUG);
    expect(traced.status).toBe(0);
    // Debug trace goes to stderr; stdout carries only the handoff line.
    expect(traced.stdout).toMatch(/^GE_TELEMETRY: session=extend-[0-9a-f-]{36} start=\d+\n$/);
    expect(traced.stderr).toContain('tier=community');
    expect(traced.stderr).toContain('sink=' + join(fix.home, '.gstack/analytics/skill-usage.jsonl'));
    expect(start(b).status).toBe(0);
    expect(handoffs(fix)).toHaveLength(2);
    const finish = spawnSync(HELPER_BIN, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success'], { env, cwd: a });
    expect(finish.status).toBe(0);
    const rows = fix.readJsonl();
    expect(rows.map(row => row.repo ?? null)).toEqual(['unknown', 'unknown', null]);
    expect(rows[2].session_id).toBe(rows[0].session_id);
    expect(handoffs(fix)).toHaveLength(1);
  }, 30_000);

  test('an unwritable sink at finish keeps the handoff, skips the logger, and recovers once repaired', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    expect(runHelper(fix.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    const blocked = join(fix.home, 'not-a-directory');
    writeFileSync(blocked, '');
    const args = ['finish', '--skill', 'extend:roadmap', '--outcome', 'success'];
    // GSTACK_HOME keeps the config lookup working while the sink (STATE_DIR only) is blocked.
    const broken = { ...fix.env, GSTACK_STATE_DIR: blocked, GSTACK_HOME: join(fix.home, '.gstack') };
    const quiet = runHelper(broken, args);
    expect([quiet.status, quiet.stdout, quiet.stderr]).toEqual([0, '', '']);
    const debug = runHelper({ ...broken, ...DEBUG }, args);
    expect(debug.stderr).toContain('sink unwritable');
    expect(debug.stderr).toContain('repair permissions');
    expect(fix.readStubArgs()).toHaveLength(0);
    expect(handoffs(fix)).toHaveLength(1);
    expect(runHelper(fix.env, args).status).toBe(0);
    const rows = fix.readJsonl();
    expect(rows).toHaveLength(2);
    expect(rows[1].session_id).toBe(rows[0].session_id);
    expect(handoffs(fix)).toHaveLength(0);
  }, 30_000);
});

describe('failure boundary', () => {
  test('unexpected runtime failures are contained: exit 0, no stdout, diagnosis only in debug mode', () => {
    const args = ['start', '--skill', 'extend:roadmap'];
    // (1) A config helper that cannot be executed (bad interpreter) fails inside capture(). It costs only the
    // skill-usage rows: provenance does not depend on gstack.
    const brokenConfig = makeTelemetryFixture('community', 'stub');
    const config = join(brokenConfig.home, '.claude/skills/gstack/bin/gstack-config');
    writeFileSync(config, '#!/nonexistent/interpreter\n');
    chmodSync(config, 0o755);
    const provenanceOnly = runHelper(brokenConfig.env, args);
    expect([provenanceOnly.status, provenanceOnly.stderr]).toEqual([0, '']);
    expect(provenanceOnly.stdout).toMatch(/^GE_TELEMETRY: session=/);
    mkdirSync(join(brokenConfig.home, '.gstack-extend'), { recursive: true });
    writeFileSync(join(brokenConfig.home, '.gstack-extend/config'), 'provenance=off\n');
    const quiet = runHelper(brokenConfig.env, args);
    expect([quiet.status, quiet.stdout, quiet.stderr]).toEqual([0, '', '']);
    const debug = runHelper({ ...brokenConfig.env, ...DEBUG }, args);
    expect(debug.status).toBe(0);
    expect(debug.stdout).toBe('');
    expect(debug.stderr).toContain('FileNotFoundError');
    expect(debug.stderr).toContain('gstack-extend doctor telemetry');
    expect(brokenConfig.readJsonl()).toHaveLength(0);

    // (2) A logger that cannot run at finish keeps the handoff, and a retry after repair pairs.
    const fix = makeTelemetryFixture('community', 'stub');
    const logger = join(fix.home, '.claude/skills/gstack/bin/gstack-telemetry-log');
    const original = readFileSync(logger, 'utf8');
    expect(runHelper(fix.env, args).status).toBe(0);
    writeFileSync(logger, '#!/nonexistent/interpreter\n' + NO_SWEEP_LINE);
    chmodSync(logger, 0o755);
    const finish = ['finish', '--skill', 'extend:roadmap', '--outcome', 'success'];
    const quietFinish = runHelper(fix.env, finish);
    expect([quietFinish.status, quietFinish.stdout, quietFinish.stderr]).toEqual([0, '', '']);
    expect(runHelper({ ...fix.env, ...DEBUG }, finish).stderr).toContain('FileNotFoundError');
    expect(fix.readJsonl()).toHaveLength(1);
    expect(handoffs(fix)).toHaveLength(1);
    writeFileSync(logger, original);
    chmodSync(logger, 0o755);
    expect(runHelper(fix.env, finish).status).toBe(0);
    const rows = fix.readJsonl();
    expect(rows).toHaveLength(2);
    expect(rows[1].session_id).toBe(rows[0].session_id);
    expect(handoffs(fix)).toHaveLength(0);

    // (3) No git executable on PATH must never fail or pollute the skill.
    const noGit = makeTelemetryFixture('community', 'stub');
    const shim = join(noGit.home, 'shim');
    mkdirSync(shim);
    for (const tool of ['bash', 'dirname', 'python3']) {
      const found = Bun.which(tool);
      if (found) symlinkSync(found, join(shim, tool));
    }
    const env = { ...noGit.env, PATH: shim };
    const noGitQuiet = runHelper(env, args);
    expect([noGitQuiet.status, noGitQuiet.stdout, noGitQuiet.stderr]).toEqual([0, '', '']);
    const noGitDebug = runHelper({ ...env, ...DEBUG }, args);
    expect(noGitDebug.status).toBe(0);
    expect(noGitDebug.stdout).not.toContain('Traceback');
    expect(noGitDebug.stderr).not.toContain('Traceback');
    expect(noGit.readJsonl()).toHaveLength(0);
    // Positive control: with git added to the same directory the helper runs, so its absence is what silenced it.
    const git = Bun.which('git');
    if (git) {
      symlinkSync(git, join(shim, 'git'));
      expect(runHelper(env, args).stdout).toMatch(/^GE_TELEMETRY: session=/);
      expect(noGit.readJsonl()).toHaveLength(1);
    }
  }, 30_000);

  test('finish does not wait on a process the logger leaves running with inherited stdio', () => {
    // Upstream backgrounds its network sync with inherited stdio. Finish redirects the logger's output to DEVNULL so that
    // it never waits on that sync; capturing the pipes instead would stall every finish until the sync exits.
    const fix = makeTelemetryFixture('community', 'stub');
    const logger = join(fix.home, '.claude/skills/gstack/bin/gstack-telemetry-log');
    writeFileSync(logger, '#!/bin/bash\n' + NO_SWEEP_LINE + '(sleep 8) &\nexit 0\n');
    chmodSync(logger, 0o755);
    expect(runHelper(fix.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    const began = Date.now();
    const r = spawnSync(HELPER_BIN, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success'], { env: fix.env, encoding: 'utf8', timeout: 12_000 });
    expect(r.status).toBe(0);
    expect(Date.now() - began).toBeLessThan(3000);
    expect(handoffs(fix)).toHaveLength(0);
  }, 30_000);
});

describe('binary resolution and invocation forms', () => {
  test('helper lookup order is PATH, then GSTACK_DIR, then the canonical install; non-executable helpers are ignored', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const canonical = join(fix.home, '.claude/skills/gstack/bin');
    const clone = (dir: string) => {
      mkdirSync(dir, { recursive: true });
      for (const name of ['gstack-config', 'gstack-telemetry-log']) {
        writeFileSync(join(dir, name), readFileSync(join(canonical, name)));
        chmodSync(join(dir, name), 0o755);
      }
      return dir;
    };
    const logger = (env: Record<string, string>) => {
      const r = runHelper({ ...env, ...DEBUG }, ['start', '--skill', 'extend:roadmap']);
      expect(r.status).toBe(0);
      return r.stderr.match(/logger=(\S+) config=(\S+)/)!.slice(1);
    };
    expect(logger(fix.env)).toEqual([join(canonical, 'gstack-telemetry-log'), join(canonical, 'gstack-config')]);
    const viaDir = clone(join(fix.home, 'gstack-dir/bin'));
    const gstackDir = { ...fix.env, GSTACK_DIR: join(fix.home, 'gstack-dir') };
    expect(logger(gstackDir)).toEqual([join(viaDir, 'gstack-telemetry-log'), join(viaDir, 'gstack-config')]);
    const viaPath = clone(join(fix.home, 'path-bin'));
    expect(logger({ ...gstackDir, PATH: viaPath + ':' + fix.env.PATH }))
      .toEqual([join(viaPath, 'gstack-telemetry-log'), join(viaPath, 'gstack-config')]);

    // Without the execute bit the logger counts as absent.
    chmodSync(join(canonical, 'gstack-telemetry-log'), 0o644);
    const absent = runHelper({ ...fix.env, ...DEBUG }, ['start', '--skill', 'extend:roadmap']);
    expect(absent.status).toBe(0);
    expect(absent.stderr).toContain('gstack absent or gstack-config unavailable');
    chmodSync(join(canonical, 'gstack-telemetry-log'), 0o755);

    // Empty-string overrides fall back to the defaults under HOME instead of the cwd.
    const rowsBefore = fix.readJsonl().length;
    const blank = runHelper({ ...fix.env, GSTACK_STATE_DIR: '', GSTACK_EXTEND_STATE_DIR: '', GSTACK_DIR: '' },
      ['start', '--skill', 'extend:roadmap']);
    expect(blank.status).toBe(0);
    expect(blank.stderr).toBe('');
    expect(fix.readJsonl()).toHaveLength(rowsBefore + 1);
    expect(handoffs(fix)).toHaveLength(1);

    // An empty GSTACK_DIR must never turn into "./bin": helpers planted in an untrusted cwd stay unexecuted.
    const untrusted = makeTelemetryFixture('community', 'absent');
    const planted = join(untrusted.home, 'planted');
    const ran = join(untrusted.home, 'planted-ran');
    mkdirSync(join(planted, 'bin'), { recursive: true });
    for (const name of ['gstack-config', 'gstack-telemetry-log']) {
      writeFileSync(join(planted, 'bin', name), `#!/bin/sh\ntouch "${ran}"\necho community\n`);
      chmodSync(join(planted, 'bin', name), 0o755);
    }
    const hostile = spawnSync(HELPER_BIN, ['start', '--skill', 'extend:roadmap'],
      { env: { ...untrusted.env, ...DEBUG, GSTACK_DIR: '' }, cwd: planted, encoding: 'utf8' });
    expect(hostile.status).toBe(0);
    expect(hostile.stderr).toContain('gstack absent or gstack-config unavailable');
    expect(existsSync(ran)).toBe(false);
    expect(untrusted.readJsonl()).toHaveLength(0);
  }, 30_000);

  test('a relative symlink chain across directories resolves each hop against its own link; a link loop is a quiet skip', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const [a, b, elsewhere] = ['a', 'b/x/y', 'elsewhere/z/w'].map(name => { const dir = join(fix.home, name); mkdirSync(dir, { recursive: true }); return dir; });
    // b/x/y/tool -> ../../../a/hop -> <relative path to the real script>. The second hop must resolve against a/ (the
    // link's own directory), not b/x/y (the first link's) or the caller's cwd; the directories sit at different depths
    // (a shallowest) so resolving against the wrong one lands somewhere else and lib/telemetry.py is never found.
    symlinkSync(relative(realpathSync(a), HELPER_BIN), join(a, 'hop'));
    symlinkSync('../../../a/hop', join(b, 'tool'));
    const r = spawnSync(join(b, 'tool'), ['start', '--skill', 'extend:roadmap'], { env: fix.env, cwd: elsewhere, encoding: 'utf8', timeout: 10_000 });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^GE_TELEMETRY: session=extend-/);
    expect(fix.readJsonl()).toHaveLength(1);

    // The kernel refuses to exec a looping link, so hand the shim source to bash with a looping $0.
    symlinkSync('loop-b', join(a, 'loop-a'));
    symlinkSync('loop-a', join(a, 'loop-b'));
    const source = readFileSync(HELPER_BIN, 'utf8');
    const args = ['start', '--skill', 'extend:roadmap'];
    const quiet = spawnSync('bash', ['-c', source, join(a, 'loop-a'), ...args], { env: fix.env, encoding: 'utf8', timeout: 10_000 });
    expect([quiet.status, quiet.stdout, quiet.stderr]).toEqual([0, '', '']);
    const debug = spawnSync('bash', ['-c', source, join(a, 'loop-a'), ...args], { env: { ...fix.env, GSTACK_EXTEND_TELEMETRY_DEBUG: '1' }, encoding: 'utf8', timeout: 10_000 });
    expect(debug.status).toBe(0);
    expect(debug.stderr).toContain('symlink loop');
    expect(fix.readJsonl()).toHaveLength(1);
  }, 30_000);

  test('a relative PATH entry does not hide an absolute helper behind it', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const canonical = join(fix.home, '.claude/skills/gstack/bin');
    const pathBin = join(fix.home, 'path-bin');
    mkdirSync(pathBin);
    for (const name of ['gstack-config', 'gstack-telemetry-log']) {
      copyFileSync(join(canonical, name), join(pathBin, name));
      chmodSync(join(pathBin, name), 0o755);
    }
    // Only the PATH copy remains, so the run works only if the search continues past the rejected relative hit.
    rmSync(canonical, { recursive: true });
    const repo = join(fix.home, 'repo');
    const ran = join(fix.home, 'planted-ran');
    mkdirSync(join(repo, 'relbin'), { recursive: true });
    for (const name of ['gstack-config', 'gstack-telemetry-log']) {
      writeFileSync(join(repo, 'relbin', name), `#!/bin/sh\n: > "${ran}"\necho community\n`);
      chmodSync(join(repo, 'relbin', name), 0o755);
    }
    const env = { ...fix.env, PATH: 'relbin:' + pathBin + ':' + fix.env.PATH };
    const r = spawnSync(HELPER_BIN, ['start', '--skill', 'extend:roadmap'], { env, cwd: repo, encoding: 'utf8', timeout: 10_000 });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^GE_TELEMETRY: session=/);
    expect(existsSync(ran)).toBe(false);
    expect(fix.readJsonl()).toHaveLength(1);
  }, 30_000);

  test('relative PATH or GSTACK_DIR entries never resolve gstack helpers from an untrusted cwd', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const repo = join(fix.home, 'repo');
    const ran = join(fix.home, 'planted-ran');
    for (const dir of ['node_modules/.bin', 'planted/bin']) {
      mkdirSync(join(repo, dir), { recursive: true });
      for (const name of ['gstack-config', 'gstack-telemetry-log']) {
        writeFileSync(join(repo, dir, name), `#!/bin/sh\n: > "${ran}"\necho community\n`);
        chmodSync(join(repo, dir, name), 0o755);
      }
    }
    const env = { ...fix.env, PATH: 'node_modules/.bin:' + fix.env.PATH, GSTACK_DIR: 'planted' };
    const options = { env, cwd: repo, encoding: 'utf8' as const, timeout: 10_000 };
    expect(spawnSync(HELPER_BIN, ['start', '--skill', 'extend:roadmap'], options).status).toBe(0);
    expect(spawnSync(HELPER_BIN, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success'], options).status).toBe(0);
    expect(existsSync(ran)).toBe(false);
    // The canonical stubs were used instead.
    expect(fix.readJsonl()).toHaveLength(2);
  }, 30_000);

  test('runs through absolute/relative symlinks, a relative $0 and PATH lookup; a missing lib is a quiet no-op', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const bin = join(fix.home, '.local/bin');
    mkdirSync(bin, { recursive: true });
    // A private install (script + lib/) that only a link-relative "../../tool/..." target can reach:
    // resolving that target against the caller's cwd instead of the link's directory must fail.
    const tool = join(fix.home, 'tool');
    mkdirSync(join(tool, 'lib'), { recursive: true });
    copyFileSync(HELPER_BIN, join(tool, 'gstack-extend-telemetry'));
    chmodSync(join(tool, 'gstack-extend-telemetry'), 0o755);
    copyFileSync(join(ROOT, 'bin/lib/telemetry.py'), join(tool, 'lib/telemetry.py'));
    const elsewhere = join(fix.home, 'elsewhere');
    mkdirSync(elsewhere);
    symlinkSync(HELPER_BIN, join(bin, 'abs-link'));
    symlinkSync(relative(realpathSync(bin), realpathSync(join(tool, 'gstack-extend-telemetry'))), join(bin, 'rel-link'));
    symlinkSync('../../tool/gstack-extend-telemetry', join(bin, 'gstack-extend-telemetry'));
    // A chain of links (chain-2 -> chain-1 -> abs-link -> the script) must resolve like bin/gstack-extend does.
    symlinkSync('abs-link', join(bin, 'chain-1'));
    symlinkSync('chain-1', join(bin, 'chain-2'));
    const args = ['start', '--skill', 'extend:roadmap'];
    const attempts = [
      () => spawnSync(join(bin, 'abs-link'), args, { env: fix.env, cwd: elsewhere, encoding: 'utf8' }),
      () => spawnSync(join(bin, 'rel-link'), args, { env: fix.env, cwd: elsewhere, encoding: 'utf8' }),
      () => spawnSync('gstack-extend-telemetry', args, { env: { ...fix.env, PATH: bin + ':' + fix.env.PATH }, cwd: elsewhere, encoding: 'utf8' }),
      () => spawnSync('./gstack-extend-telemetry', args, { env: fix.env, cwd: join(ROOT, 'bin'), encoding: 'utf8' }),
      () => spawnSync(join(bin, 'chain-2'), args, { env: fix.env, cwd: elsewhere, encoding: 'utf8' }),
    ];
    attempts.forEach((attempt, index) => {
      const r = attempt();
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/^GE_TELEMETRY: session=extend-/);
      expect(fix.readJsonl()).toHaveLength(index + 1);
    });

    // A copy of the script with no lib/ beside it must skip quietly and explain itself in debug mode.
    const lonely = join(fix.home, 'lonely');
    mkdirSync(lonely);
    copyFileSync(HELPER_BIN, join(lonely, 'gstack-extend-telemetry'));
    chmodSync(join(lonely, 'gstack-extend-telemetry'), 0o755);
    const quiet = spawnSync(join(lonely, 'gstack-extend-telemetry'), args, { env: fix.env, encoding: 'utf8' });
    expect([quiet.status, quiet.stdout, quiet.stderr]).toEqual([0, '', '']);
    const debug = spawnSync(join(lonely, 'gstack-extend-telemetry'), args, { env: { ...fix.env, ...DEBUG }, encoding: 'utf8' });
    expect(debug.status).toBe(0);
    expect(debug.stderr).toContain('telemetry.py missing');
    expect(debug.stderr).toContain('re-run ./setup');
    expect(fix.readJsonl()).toHaveLength(attempts.length);

    // Skill-block ladder: relative and dangling .extend-root pointers must not shadow a later valid one.
    const blocks = makeTelemetryFixture('community', 'stub');
    rmSync(join(blocks.home, '.claude/skills/gstack-extend'), { recursive: true });
    for (const [host, name, content] of [['.claude/skills', 'aaa', 'relative/path\n'], ['.claude/skills', 'bbb', '/nonexistent/root\n'], ['.codex/skills', 'ccc', ROOT + '\n']]) {
      mkdirSync(join(blocks.home, host, name), { recursive: true });
      writeFileSync(join(blocks.home, host, name, '.extend-root'), content);
    }
    expect(executeBlock(blocks.env, 'start').status).toBe(0);
    expect(blocks.readJsonl()).toHaveLength(1);
  }, 30_000);
});

describe('concurrent sessions', () => {
  test('parallel starts keep the sink line-intact and the handoffs whole', async () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const env = { ...fix.env, GIT_CEILING_DIRECTORIES: fix.home };
    const dir = (name: string) => {
      const path = join(fix.home, name);
      mkdirSync(path);
      return path;
    };
    const separate = Array.from({ length: 12 }, (_, index) => dir('work-' + index));
    const shared = dir('shared');
    const start = ['start', '--skill', 'extend:roadmap'];
    // 12 independent slots plus 10 racers for a single shared slot.
    const results = await Promise.all([
      ...separate.map(cwd => runAsync(env, start, cwd)),
      ...Array.from({ length: 10 }, () => runAsync(env, start, shared)),
    ]);
    for (const result of results) {
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
    }
    // readJsonl() throws on a torn line; every start must be a complete row with its own session.
    const rows = fix.readJsonl();
    expect(rows).toHaveLength(22);
    expect(new Set(rows.map(row => row.session_id)).size).toBe(22);
    expect(rows.every(row => row.event_type === 'skill_start')).toBe(true);
    // 13 slots, all whole JSON, no leftover temporary files, each naming a session that was emitted.
    const names = handoffs(fix);
    expect(names).toHaveLength(13);
    expect(names.every(name => /^[0-9a-f]{64}\.json$/.test(name))).toBe(true);
    const emitted = new Set(rows.map(row => row.session_id));
    const winners = names.map(name => JSON.parse(readFileSync(join(fix.home, '.gstack-extend/telemetry', name), 'utf8')));
    for (const winner of winners) {
      expect(emitted.has(winner.session_id)).toBe(true);
      expect(/^[0-9]+$/.test(winner.start)).toBe(true);
    }
    // Finishing the raced slot pairs with whichever start won it, then consumes only that slot.
    const finish = await runAsync(env, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success'], shared);
    expect(finish.status).toBe(0);
    const after = fix.readJsonl();
    expect(after).toHaveLength(23);
    expect(winners.map(winner => winner.session_id)).toContain(after[22].session_id);
    expect(handoffs(fix)).toHaveLength(12);
  }, 30_000);
});

describe('writer and reader agree for every installed skill', () => {
  for (const mode of ['stub', 'real'] as const) {
    test.if(mode === 'stub' || HAS_GSTACK)("each skill's own blocks produce a v1 start/finish pair the doctor counts as paired (" + mode + ')', () => {
      const fix = makeTelemetryFixture('community', mode);
      for (const skill of EXPECTED_SETUP_SKILLS) {
        const path = join(ROOT, 'skills', skill + '.md');
        expect(executeBlock(fix.env, 'start', path).status).toBe(0);
        expect(executeBlock(fix.env, 'finish', path).status).toBe(0);
      }
      const rows = fix.readJsonl();
      expect(rows).toHaveLength(EXPECTED_SETUP_SKILLS.length * 2);
      const doctor = spawnSync(join(ROOT, 'bin/gstack-extend'), ['doctor', 'telemetry', '--json'], { env: fix.env, encoding: 'utf8', timeout: 20_000 });
      expect(doctor.status).toBe(0);
      const report = JSON.parse(doctor.stdout);
      for (const skill of EXPECTED_SETUP_SKILLS) {
        const own = rows.filter(row => row.skill === 'extend:' + skill);
        expect(own.map(row => row.event_type)).toEqual(['skill_start', 'skill_run']);
        expect(own[1].session_id).toBe(own[0].session_id);
        expect(report.skills.find((entry: { skill: string }) => entry.skill === skill)).toMatchObject({
          activations: 1, completions: 1, paired: 1, denominator: 1, pairing_percent: 100, status: 'paired',
          unpaired_start: 0, unpaired_finish: 0, deferred_finish: 0, legacy: 0,
        });
      }
      // The same blocks leave one provenance row per run, named by the bare skill.
      expect(fix.readLedger().map(row => row.stage)).toEqual([...EXPECTED_SETUP_SKILLS]);
    }, 60_000);
  }
});

// ─── Execution provenance: the local-only stage-runs.jsonl row ───

const SCHEMA = ['stage', 'agent', 'model', 'effort', 'rung', 'outcome', 'started_at', 'duration_s', 'session_id',
  'repo', 'branch', 'work_item', 'source', 'route', 'entrypoint_raw'];
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
const writeJsonl = (file: string, records: object[]) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, records.map(record => JSON.stringify(record)).join('\n') + '\n');
};
const claudeTurn = (at: number, id: string, model: string, effort: string | null, extra: object = {}) =>
  ({ type: 'assistant', timestamp: iso(at), effort, message: { id, model, role: 'assistant' }, ...extra });
const codexTurn = (at: number, model: string, effort: string) =>
  ({ timestamp: iso(at), type: 'turn_context', payload: { model, effort } });

/** start, then write harness logs (given the start epoch), then finish; returns the newest provenance row. */
function provenanceRun(fix: TelemetryFixture, env: Record<string, string> = {}, logs: (start: number) => void = () => {},
  finishArgs: string[] = [], cwd?: string) {
  const options = { env: { ...fix.env, ...env }, cwd, encoding: 'utf8' as const, timeout: 15_000 };
  const start = spawnSync(HELPER_BIN, ['start', '--skill', 'extend:roadmap'], options);
  expect([start.status, start.stderr]).toEqual([0, '']);
  const epoch = Number(start.stdout.match(/start=(\d+)/)![1]);
  logs(epoch);
  const finish = spawnSync(HELPER_BIN, ['finish', '--skill', 'extend:roadmap', ...finishArgs], options);
  expect([finish.status, finish.stdout, finish.stderr]).toEqual([0, '', '']);
  return { row: fix.readLedger().at(-1)!, epoch, sid: start.stdout.match(/session=(\S+)/)![1] };
}

describe('execution provenance', () => {
  test('Cursor is detected with leaked outer markers and quota enabled never starts a sampler', () => {
    const fix = makeTelemetryFixture('off');
    mkdirSync(join(fix.home, '.gstack-extend'), { recursive: true });
    writeFileSync(join(fix.home, '.gstack-extend/config'), 'quota=on\n');
    const env = { CURSOR_AGENT: '1', CURSOR_CONVERSATION_ID: 'cursor-session', CURSOR_INVOKED_AS: 'cursor-agent', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'outer-session' };
    const { row } = provenanceRun(fix, env, start => {
      writeJsonl(join(fix.home, '.claude/projects/project/outer-session.jsonl'), [claudeTurn(start - 100, 'old', 'claude-fixture', 'high')]);
      writeJsonl(join(fix.home, '.cursor/projects/project/agent-transcripts/cursor-session/transcript.jsonl'), [{ role: 'assistant', message: 'fixture' }]);
    });
    expect(row).toMatchObject({ agent: 'cursor', route: 'cli', model: null, effort: null });
    expect(existsSync(join(fix.home, '.gstack-extend/quota'))).toBe(false);
    expect(fix.readJsonl()).toHaveLength(0);
  });

  test("one row per finished run in exactly the shared schema, whatever gstack's tier", () => {
    const fix = makeTelemetryFixture('off');
    const repo = join(fix.home, 'widget');
    mkdirSync(repo);
    for (const args of [['init', '-q'], ['symbolic-ref', 'HEAD', 'refs/heads/feature/x'], ['remote', 'add', 'origin', 'git@github.com:acme/widget.git']]) {
      expect(spawnSync('git', ['-C', repo, ...args], { env: fix.env }).status).toBe(0);
    }
    const { row, epoch, sid } = provenanceRun(fix, {}, undefined, ['--outcome', 'success'], repo);
    expect(Object.keys(row)).toEqual(SCHEMA);
    expect(row).toMatchObject({ stage: 'roadmap', agent: null, model: null, effort: null, rung: 0, outcome: 'success',
      session_id: sid, repo: 'acme/widget', branch: 'feature/x', work_item: null, source: 'gstack-extend' });
    expect(row.started_at).toBe(iso(epoch).replace(/\.\d{3}Z$/, 'Z'));
    expect(Number.isInteger(row.duration_s) && row.duration_s >= 0).toBe(true);
    expect(fix.readJsonl()).toHaveLength(0);
    expect(handoffs(fix)).toHaveLength(0);
  });

  test('repo is owner/name from origin, never its host or credentials; the root name without origin; null outside git', () => {
    const fix = makeTelemetryFixture('off');
    const cases: Array<[string | null, string]> = [
      ['https://user:s3cret@github.com/acme/widget.git', 'acme/widget'],
      ['https://user:s3cret@github.com/acme/widget.git?access_token=TOKEN', 'acme/widget'],
      ['https://github.com/acme/widget.git#TOKEN', 'acme/widget'],
      ['ssh://git@example.com:2222/acme/widget.git/', 'acme/widget'],
      ['https://github.com/acme/widget', 'acme/widget'],
      [null, 'plain-root'],
    ];
    cases.forEach(([remote, expected], index) => {
      const repo = join(fix.home, remote ? 'case-' + index : 'plain-root');
      mkdirSync(repo);
      expect(spawnSync('git', ['init', '-q', repo], { env: fix.env }).status).toBe(0);
      if (remote) expect(spawnSync('git', ['-C', repo, 'remote', 'add', 'origin', remote], { env: fix.env }).status).toBe(0);
      expect(provenanceRun(fix, {}, undefined, [], repo).row.repo).toBe(expected);
    });
    const ledger = JSON.stringify(fix.readLedger());
    expect(ledger).not.toContain('s3cret');
    expect(ledger).not.toContain('TOKEN');
    const single = join(fix.home, 'single-seg');
    mkdirSync(single);
    expect(spawnSync('git', ['init', '-q', single], { env: fix.env }).status).toBe(0);
    expect(spawnSync('git', ['-C', single, 'remote', 'add', 'origin', 'https://git.internal.example/widget.git'],
      { env: fix.env }).status).toBe(0);
    expect(provenanceRun(fix, {}, undefined, [], single).row.repo).toBe('single-seg');
    expect(JSON.stringify(fix.readLedger())).not.toContain('git.internal.example');
    const outside = join(fix.home, 'outside');
    mkdirSync(outside);
    expect(provenanceRun(fix, { GIT_CEILING_DIRECTORIES: fix.home }, undefined, [], outside).row)
      .toMatchObject({ repo: null, branch: null });
  }, 30_000);

  test('with the tier on both outputs share a session; the provenance switch silences only the local row', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const { row } = provenanceRun(fix, {}, undefined, ['--outcome', 'error', '--agent', 'claude', '--model', 'claude-opus-5',
      '--effort', 'xhigh', '--work-item', '4D']);
    expect(fix.readJsonl().map(usage => usage.session_id)).toEqual([row.session_id, row.session_id]);
    expect(row).toMatchObject({ outcome: 'error', agent: 'claude', model: 'claude-opus-5', effort: 'xhigh', work_item: '4D' });
    // Provenance overrides stay local: gstack's logger never sees them.
    const forwarded = fix.readStubArgs()[0].split('\t');
    for (const flag of ['--agent', '--model', '--effort', '--work-item']) expect(forwarded).not.toContain(flag);
    for (const value of ['false', 'off']) {
      writeFileSync(join(fix.home, '.gstack-extend/config'), 'provenance=' + value + '\n');
      expect(runHelper(fix.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
      expect(runHelper(fix.env, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    }
    expect(fix.readJsonl()).toHaveLength(6);
    expect(fix.readLedger()).toHaveLength(1);
    expect(handoffs(fix)).toHaveLength(0);
    writeFileSync(join(fix.home, '.gstack-extend/config'), 'provenance=true\n');
    provenanceRun(fix);
    expect(fix.readLedger()).toHaveLength(2);
  }, 30_000);

  test('Claude: responses inside the stage name the model and effort; sidechains, synthetic and earlier turns do not', () => {
    const fix = makeTelemetryFixture('off');
    const sid = '0c7f2e29-0000-4000-8000-000000000001';
    const transcript = join(fix.home, '.claude/projects/-some-workspace', sid + '.jsonl');
    const env = { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: sid };
    const { row } = provenanceRun(fix, env, start => {
      const now = Date.now() / 1000;
      writeJsonl(transcript, [
        claudeTurn(start - 60, 'm0', 'claude-fable-5', 'low'),
        claudeTurn(now, 'm1', 'claude-opus-5', 'xhigh'),
        claudeTurn(now, 'm2', 'claude-opus-5', 'xhigh'),
        // One response split across three entries counts once, so it cannot outvote the two above.
        ...[1, 2, 3].map(() => claudeTurn(now, 'm3', 'claude-sonnet-5', 'high')),
        // Subagent (sidechain) and synthetic responses would outvote the stage's own if they were counted.
        ...['s1', 's2', 's3'].map(id => claudeTurn(now, id, 'claude-haiku-4-5', 'low', { isSidechain: true })),
        ...['x1', 'x2', 'x3'].map(id => claudeTurn(now, id, '<synthetic>', null)),
        { type: 'user', timestamp: iso(now), message: { role: 'user', content: 'ok' } },
      ]);
    });
    expect(row).toMatchObject({ agent: 'claude', model: 'claude-opus-5', effort: 'xhigh' });
    // A per-turn effort override is the level that turn actually used.
    const perTurn = provenanceRun(fix, env, () =>
      writeJsonl(transcript, [claudeTurn(Date.now() / 1000, 'p1', 'claude-opus-5', 'xhigh', { perTurnEffort: 'max' })])).row;
    expect(perTurn.effort).toBe('max');
    // A skill run by a subagent leaves the parent transcript idle: its earlier turn must not be inherited.
    const idle = provenanceRun(fix, env, start => writeJsonl(transcript, [claudeTurn(start - 5, 'p2', 'claude-opus-5', 'xhigh')])).row;
    expect(idle).toMatchObject({ agent: 'claude', model: null, effort: null });
  }, 30_000);

  test('Codex: the turn open when the stage began supplies model and effort from the rollout', () => {
    const fix = makeTelemetryFixture('off');
    const tid = '01a0c487-19ac-7903-89d9-d1642a113349';
    const rollout = join(fix.home, '.codex/sessions/2026/09/21', `rollout-2026-09-21T11-13-03-${tid}.jsonl`);
    const { row } = provenanceRun(fix, { CODEX_THREAD_ID: tid }, start => writeJsonl(rollout, [
      { timestamp: iso(start - 900), type: 'session_meta', payload: { id: tid } },
      codexTurn(start - 600, 'gpt-5-codex', 'low'),
      codexTurn(start - 30, 'gpt-6-astra', 'high'),
      { timestamp: iso(start - 29), type: 'event_msg', payload: { type: 'token_count' } },
    ]));
    expect(row).toMatchObject({ agent: 'codex', model: 'gpt-6-astra', effort: 'high' });
  });

  test('nested harness markers resolve to the log with the latest turn; markers without logs stay unverifiable', () => {
    const fix = makeTelemetryFixture('off');
    const sid = '0c7f2e29-0000-4000-8000-000000000002';
    const tid = '01a0c487-0000-7000-8000-000000000002';
    const transcript = join(fix.home, '.claude/projects/-outer', sid + '.jsonl');
    const rollout = join(fix.home, '.codex/sessions/2026/09/21', `rollout-2026-09-21T00-00-00-${tid}.jsonl`);
    const both = { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: sid, CODEX_THREAD_ID: tid };
    // codex exec launched from Claude Code: the outer transcript went quiet when it launched the inner run.
    const inner = provenanceRun(fix, both, start => {
      writeJsonl(transcript, [claudeTurn(start - 20, 'o1', 'claude-opus-5', 'xhigh')]);
      writeJsonl(rollout, [codexTurn(start - 5, 'gpt-6-astra', 'high')]);
    }).row;
    expect(inner).toMatchObject({ agent: 'codex', model: 'gpt-6-astra', effort: 'high' });
    // The reverse nesting: Claude's transcript holds the latest turn.
    const outer = provenanceRun(fix, both, start => {
      writeJsonl(transcript, [claudeTurn(Date.now() / 1000, 'o2', 'claude-opus-5', 'xhigh')]);
      writeJsonl(rollout, [codexTurn(start - 300, 'gpt-6-astra', 'high')]);
    }).row;
    expect(outer).toMatchObject({ agent: 'claude', model: 'claude-opus-5', effort: 'xhigh' });
    // Two markers and no logs to compare: nothing is verifiable. One marker alone still names its harness.
    expect(provenanceRun(fix, { CLAUDECODE: '1', CODEX_THREAD_ID: 'no-such-thread' }).row)
      .toMatchObject({ agent: null, model: null, effort: null });
    expect(provenanceRun(fix, { CLAUDECODE: '1' }).row).toMatchObject({ agent: 'claude', model: null, effort: null });
  }, 30_000);

  test('Grok: exactly one session active in this directory since the stage began is attributed; two are not', () => {
    const fix = makeTelemetryFixture('off');
    const work = join(fix.home, 'grok-work');
    mkdirSync(work);
    const place = join(fix.home, '.grok/sessions', encodeURIComponent(realpathSync(work)));
    const session = (id: string, model: string) => {
      writeJsonl(join(place, id, 'events.jsonl'), [{ ts: iso(Date.now() / 1000 - 40), type: 'turn_started', model_id: model }]);
      writeFileSync(join(place, id, 'summary.json'), JSON.stringify({ current_model_id: model, reasoning_effort: 'high' }));
    };
    expect(provenanceRun(fix, { GROK_AGENT: '1' }, () => session('a', 'grok-4.6'), [], work).row)
      .toMatchObject({ agent: 'grok', model: 'grok-4.6', effort: 'high' });
    expect(provenanceRun(fix, { GROK_AGENT: '1' }, () => { session('a', 'grok-4.6'); session('b', 'grok-4.6-mini'); }, [], work).row)
      .toMatchObject({ agent: 'grok', model: null, effort: null });
    // A profile name in GROK_AGENT is user configuration; Grok's shell sets exactly "1".
    expect(provenanceRun(fix, { GROK_AGENT: 'my-profile' }, undefined, [], work).row.agent).toBeNull();
  }, 30_000);

  test('explicit flags override detection; values from another harness are dropped; bad values are ignored', () => {
    const fix = makeTelemetryFixture('off');
    const sid = '0c7f2e29-0000-4000-8000-000000000003';
    const env = { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: sid };
    const logs = () => writeJsonl(join(fix.home, '.claude/projects/-w', sid + '.jsonl'),
      [claudeTurn(Date.now() / 1000, 'm1', 'claude-opus-5', 'xhigh')]);
    expect(provenanceRun(fix, env, logs, ['--agent', 'codex', '--model', 'gpt-6-astra', '--effort', 'high',
      '--work-item', '4D', '--outcome', 'abort']).row)
      .toMatchObject({ agent: 'codex', model: 'gpt-6-astra', effort: 'high', work_item: '4D', outcome: 'abort' });
    expect(provenanceRun(fix, env, logs, ['--agent', 'codex']).row)
      .toMatchObject({ agent: 'codex', model: null, effort: null, outcome: 'unknown' });
    expect(provenanceRun(fix, env, logs, ['--agent', 'claude', '--effort', 'max']).row)
      .toMatchObject({ agent: 'claude', model: 'claude-opus-5', effort: 'max' });
    expect(provenanceRun(fix, env, logs, ['--agent', 'gpt', '--model', 'bad\u0007id', '--work-item', ' ', '--outcome', 'exploded']).row)
      .toMatchObject({ agent: 'claude', model: 'claude-opus-5', effort: 'xhigh', work_item: null, outcome: 'unknown' });
  }, 30_000);

  test('a finish retried after a partial failure never duplicates either row', () => {
    const finish = ['finish', '--skill', 'extend:roadmap', '--outcome', 'success'];
    // gstack's logger fails first: provenance is recorded once, the skill-usage completion on the repaired retry.
    const fix = makeTelemetryFixture('community', 'stub');
    const logger = join(fix.home, '.claude/skills/gstack/bin/gstack-telemetry-log');
    const original = readFileSync(logger, 'utf8');
    writeFileSync(logger, '#!/bin/bash\n' + NO_SWEEP_LINE + 'exit 1\n');
    chmodSync(logger, 0o755);
    expect(runHelper(fix.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    expect(runHelper(fix.env, finish).status).toBe(0);
    expect(runHelper(fix.env, finish).status).toBe(0);
    expect(fix.readLedger()).toHaveLength(1);
    expect(handoffs(fix)).toHaveLength(1);
    writeFileSync(logger, original);
    chmodSync(logger, 0o755);
    expect(runHelper(fix.env, finish).status).toBe(0);
    expect(fix.readLedger()).toHaveLength(1);
    expect(fix.readJsonl().map(row => row.event_type)).toEqual(['skill_start', 'skill_run']);
    expect(handoffs(fix)).toHaveLength(0);

    // The provenance sink fails first: the delivered completion is not sent again.
    const other = makeTelemetryFixture('community', 'stub');
    expect(runHelper(other.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    const blocker = join(other.home, '.gstack-extend/analytics');
    writeFileSync(blocker, '');
    const quiet = runHelper(other.env, finish);
    expect([quiet.status, quiet.stdout, quiet.stderr]).toEqual([0, '', '']);
    expect(runHelper({ ...other.env, ...DEBUG }, finish).stderr).toContain('provenance sink unwritable');
    expect(other.readJsonl()).toHaveLength(2);
    rmSync(blocker);
    expect(runHelper(other.env, finish).status).toBe(0);
    expect(other.readLedger()).toHaveLength(1);
    expect(other.readJsonl()).toHaveLength(2);
    expect(handoffs(other)).toHaveLength(0);
  }, 30_000);

  test('legacy finishes date the row from their duration; an unrepresentable start is null, never a crash', () => {
    const fix = makeTelemetryFixture('off');
    const before = Math.floor(Date.now() / 1000);
    expect(runHelper(fix.env, ['--skill', 'extend:roadmap', '--duration', '42', '--session-id', 'sid-legacy', '--outcome', 'success']).status).toBe(0);
    const after = Math.ceil(Date.now() / 1000);
    const legacy = fix.readLedger()[0];
    expect(legacy).toMatchObject({ session_id: 'sid-legacy', duration_s: 42, outcome: 'success' });
    const began = Date.parse(legacy.started_at) / 1000;
    expect(began >= before - 42 && began <= after - 42).toBe(true);
    const future = runHelper(fix.env, ['finish', '--skill', 'extend:roadmap', '--start', '9223372036854775807', '--session-id', 'sid-future']);
    expect([future.status, future.stdout, future.stderr]).toEqual([0, '', '']);
    expect(fix.readLedger()[1]).toMatchObject({ session_id: 'sid-future', started_at: null, duration_s: 0 });
  });

  test('provenance duration stays wall-clock past a day while skill-usage nulls it', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const start = String(Math.floor(Date.now() / 1000) - 90000);
    expect(runHelper(fix.env, ['finish', '--skill', 'extend:roadmap', '--start', start, '--session-id', 'sid-long',
      '--outcome', 'success']).status).toBe(0);
    expect(fix.readLedger()[0].duration_s).toBeGreaterThanOrEqual(90000);
    expect(fix.readJsonl().at(-1).duration_s).toBeNull();
  });

  test('a failed skill-usage start does not invent a completion; provenance off writes no handoff', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const blocked = join(fix.home, 'not-a-directory');
    writeFileSync(blocked, '');
    const blockedEnv = { ...fix.env, GSTACK_STATE_DIR: blocked, GSTACK_HOME: join(fix.home, '.gstack') };
    const start = runHelper(blockedEnv, ['start', '--skill', 'extend:roadmap']);
    expect(start.status).toBe(0);
    expect(start.stdout).toMatch(/^GE_TELEMETRY: session=/);
    expect(fix.readJsonl()).toHaveLength(0);
    expect(handoffs(fix)).toHaveLength(1);
    expect(runHelper(fix.env, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    expect(fix.readJsonl()).toHaveLength(0);
    expect(fix.readLedger()).toHaveLength(1);
    expect(handoffs(fix)).toHaveLength(0);
    writeFileSync(join(fix.home, '.gstack-extend/config'), 'provenance=false\n');
    const quiet = runHelper(blockedEnv, ['start', '--skill', 'extend:roadmap']);
    expect([quiet.status, quiet.stdout, quiet.stderr]).toEqual([0, '', '']);
    expect(handoffs(fix)).toHaveLength(0);
  });

  test('equal turn counts resolve to the later model and effort', () => {
    const fix = makeTelemetryFixture('off');
    const sid = '0c7f2e29-0000-4000-8000-000000000004';
    const transcript = join(fix.home, '.claude/projects/-w', sid + '.jsonl');
    const { row } = provenanceRun(fix, { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: sid }, () => {
      const now = Date.now() / 1000;
      writeJsonl(transcript, [
        claudeTurn(now, 'a', 'claude-opus-5', 'xhigh'),
        claudeTurn(now + 0.01, 'b', 'claude-sonnet-5', 'high'),
      ]);
    });
    expect(row).toMatchObject({ model: 'claude-sonnet-5', effort: 'high' });
  });

  test('a session id with a slash or past 128 characters is not used as a glob', () => {
    const fix = makeTelemetryFixture('off');
    const planted = join(fix.home, '.claude/projects/-w', 'secret-model.jsonl');
    writeJsonl(planted, [claudeTurn(Date.now() / 1000, 'm', 'claude-opus-5', 'xhigh')]);
    for (const sid of ['*', '../-w/secret-model', 'a'.repeat(129)]) {
      const row = provenanceRun(fix, { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: sid }).row;
      expect(row).toMatchObject({ agent: 'claude', model: null, effort: null });
    }
  }, 15_000);

  test('a FIFO transcript does not block finish', () => {
    const fix = makeTelemetryFixture('off');
    const sid = 'fifo-session';
    const transcript = join(fix.home, '.claude/projects/-w', sid + '.jsonl');
    mkdirSync(dirname(transcript), { recursive: true });
    expect(spawnSync('mkfifo', [transcript]).status).toBe(0);
    const start = String(Math.floor(Date.now() / 1000) - 1);
    const finish = spawnSync(HELPER_BIN, ['finish', '--skill', 'extend:roadmap', '--start', start, '--session-id', 'sid-fifo',
      '--outcome', 'success'], {
      env: { ...fix.env, CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: sid }, encoding: 'utf8', timeout: 5_000,
    });
    expect([finish.status, finish.stdout, finish.stderr]).toEqual([0, '', '']);
    expect(fix.readLedger()[0]).toMatchObject({ agent: 'claude', model: null, session_id: 'sid-fifo' });
  });

  test('a FIFO at the provenance sink does not block finish', () => {
    const fix = makeTelemetryFixture('off');
    const dir = join(fix.home, '.gstack-extend/analytics');
    mkdirSync(dir, { recursive: true });
    expect(spawnSync('mkfifo', [join(dir, 'stage-runs.jsonl')]).status).toBe(0);
    const finish = spawnSync(HELPER_BIN, ['--skill', 'extend:roadmap', '--duration', '1', '--session-id', 'sid-sinkfifo',
      '--outcome', 'success'], { env: fix.env, encoding: 'utf8', timeout: 5_000 });
    expect([finish.status, finish.stdout]).toEqual([0, '']);
  });

  test('a FIFO config, a FIFO handoff, a FIFO skill-usage sink, and a hard-linked ledger do not block finish', () => {
    const finishOf = (env: Record<string, string>) => spawnSync(HELPER_BIN,
      ['--skill', 'extend:roadmap', '--duration', '1', '--session-id', 'sid-guard', '--outcome', 'success'],
      { env, encoding: 'utf8', timeout: 5_000 });
    const configFifo = makeTelemetryFixture('off');
    const config = join(configFifo.home, '.gstack-extend/config');
    mkdirSync(join(configFifo.home, '.gstack-extend'));
    expect(spawnSync('mkfifo', [config]).status).toBe(0);
    expect(finishOf(configFifo.env).status).toBe(0);

    const handoff = makeTelemetryFixture('off');
    expect(runHelper(handoff.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    const slot = join(handoff.home, '.gstack-extend/telemetry', handoffs(handoff)[0]);
    rmSync(slot);
    expect(spawnSync('mkfifo', [slot]).status).toBe(0);
    expect(spawnSync(HELPER_BIN, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success'],
      { env: handoff.env, encoding: 'utf8', timeout: 5_000 }).status).toBe(0);

    const usage = makeTelemetryFixture('community', 'stub');
    const sink = join(usage.home, '.gstack/analytics/skill-usage.jsonl');
    mkdirSync(join(usage.home, '.gstack/analytics'), { recursive: true });
    expect(spawnSync('mkfifo', [sink]).status).toBe(0);
    expect(finishOf(usage.env).status).toBe(0);

    const linked = makeTelemetryFixture('off');
    const uploaded = join(linked.home, '.gstack/analytics/skill-usage.jsonl');
    const ledger = join(linked.home, '.gstack-extend/analytics/stage-runs.jsonl');
    mkdirSync(join(linked.home, '.gstack/analytics'), { recursive: true });
    mkdirSync(join(linked.home, '.gstack-extend/analytics'), { recursive: true });
    writeFileSync(uploaded, '');
    linkSync(uploaded, ledger);
    expect(finishOf(linked.env).status).toBe(0);
    expect(readFileSync(uploaded, 'utf8')).toBe('');
  }, 30_000);

  test('Grok ignores a stale events log and reads summary.json when the fresh log has no turn', () => {
    const fix = makeTelemetryFixture('off');
    const work = join(fix.home, 'grok-stale');
    mkdirSync(work);
    const place = join(fix.home, '.grok/sessions', encodeURIComponent(realpathSync(work)));
    const stale = provenanceRun(fix, { GROK_AGENT: '1' }, start => {
      const log = join(place, 'old', 'events.jsonl');
      writeJsonl(log, [{ ts: iso(start - 100), type: 'turn_started', model_id: 'grok-old' }]);
      utimesSync(log, start - 50, start - 50);
      writeFileSync(join(place, 'old', 'summary.json'), JSON.stringify({ current_model_id: 'grok-old', reasoning_effort: 'low' }));
    }, [], work).row;
    expect(stale).toMatchObject({ agent: 'grok', model: null, effort: null });
    const fresh = provenanceRun(fix, { GROK_AGENT: '1' }, () => {
      writeJsonl(join(place, 'new', 'events.jsonl'), [{ ts: iso(Date.now() / 1000), type: 'phase_changed' }]);
      writeFileSync(join(place, 'new', 'summary.json'), JSON.stringify({ current_model_id: 'grok-4.7', reasoning_effort: 'high' }));
    }, [], work).row;
    expect(fresh).toMatchObject({ agent: 'grok', model: 'grok-4.7', effort: 'high' });
    // GROK_SESSION_ID names one session even when a sibling log is also fresh.
    const picked = provenanceRun(fix, { GROK_AGENT: '1', GROK_SESSION_ID: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }, () => {
      writeJsonl(join(place, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'events.jsonl'),
        [{ ts: iso(Date.now() / 1000), type: 'turn_started', model_id: 'grok-4.7' }]);
      writeFileSync(join(place, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'summary.json'),
        JSON.stringify({ current_model_id: 'grok-4.7', reasoning_effort: 'high' }));
      writeJsonl(join(place, 'sibling', 'events.jsonl'),
        [{ ts: iso(Date.now() / 1000), type: 'turn_started', model_id: 'grok-other' }]);
    }, [], work).row;
    expect(picked).toMatchObject({ agent: 'grok', model: 'grok-4.7', effort: 'high' });
  });

  test('an unreadable provenance config records nothing', () => {
    const fix = makeTelemetryFixture('off');
    mkdirSync(join(fix.home, '.gstack-extend/config'), { recursive: true });
    expect(runHelper(fix.env, ['--skill', 'extend:roadmap', '--duration', '1', '--session-id', 'sid-closed']).status).toBe(0);
    expect(fix.readLedger()).toHaveLength(0);
  });
});
