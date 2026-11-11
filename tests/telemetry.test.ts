/** Telemetry checks use isolated homes and execute the shipped blocks in separate processes. */

import { afterAll, describe, test, expect } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, chmodSync, utimesSync, linkSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
// Development dependency pinned in bun.lock: run `bun install --frozen-lockfile` before this suite.
import Ajv from 'ajv';
import { HELPER_BIN, HELPER_SOURCE, NO_SWEEP_LINE, PROTOCOL_LINE, REAL_GSTACK_ROOT, cleanupTelemetryFixtures, executeSkillBlock, installCallHelper, makeTelemetryFixture, skillBlock, type TelemetryFixture } from './helpers/telemetry-env';

const HAS_GSTACK = existsSync(REAL_GSTACK_ROOT);
const HAS_STATE_RESOLVER = (() => {
  try {
    return readFileSync(join(REAL_GSTACK_ROOT, 'bin/gstack-telemetry-log'), 'utf8')
      .includes('gstack_state_root_select');
  } catch {
    return false;
  }
})();
// Cleanup scans fixture files, removes hundreds of homes and re-arms the real-store guard.
// Match the initial snapshot's two-minute budget; a full-suite cleanup took 67.6 s.
afterAll(cleanupTelemetryFixtures, 120_000);
const ROOT = join(import.meta.dir, '..');
// The running checkout's release, read only. Tests that need another release build a disposable copy.
const RELEASE = readFileSync(join(ROOT, 'VERSION'), 'utf8').trim();
const validRow = new Ajv({ strict: true, allErrors: true })
  .compile(JSON.parse(readFileSync(join(ROOT, 'docs/stage-runs.schema.json'), 'utf8')));
function executeBlock(env: Record<string, string>, kind: 'start' | 'finish', path = join(ROOT, 'skills/full-review.md'), cwd?: string, helper = true) {
  return executeSkillBlock(env, kind, path, cwd, helper);
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
  for (const host of ['claude', 'codex', 'opencode', 'cursor']) {
    test('setup-generated ' + host + ' install resolves .extend-root without PATH wiring or GSTACK_EXTEND_DIR', () => {
      const fix = makeTelemetryFixture('community');
      rmSync(join(fix.home, '.claude/skills/gstack-extend'), { recursive: true });
      const setupTools = join(fix.home, 'setup-tools');
      mkdirSync(setupTools);
      symlinkSync(process.execPath, join(setupTools, 'bun'));
      const result = spawnSync(join(ROOT, 'setup'), ['--host', host, '--quiet'], { env: { ...fix.env, PATH: setupTools + ':' + fix.env.PATH, ...(process.env.TMPDIR !== undefined ? { TMPDIR: process.env.TMPDIR } : {}) }, encoding: 'utf8', timeout: 20_000 });
      expect(result.status).toBe(0);
      const hostDir = host === 'claude' ? '.claude/skills' : host === 'codex' ? '.codex/skills' : host === 'cursor' ? '.cursor/skills' : '.config/opencode/skills';
      const path = join(fix.home, hostDir, 'full-review/SKILL.md');
      expect(existsSync(join(fix.home, hostDir, 'full-review/.extend-root'))).toBe(true);
      expect(existsSync(join(fix.home, '.local/bin/gstack-extend-telemetry'))).toBe(false);
      // setup, not the harness, put the helper where the blocks call it.
      expect(existsSync(join(fix.home, '.gstack-extend/bin/telemetry-call'))).toBe(true);
      expect(executeBlock(fix.env, 'start', path, undefined, false).status).toBe(0);
      expect(executeBlock(fix.env, 'finish', path, undefined, false).status).toBe(0);
      const rows = fix.readJsonl();
      expect(rows).toHaveLength(2);
      expect(rows[0].session_id).toBe(rows[1].session_id);
      // The installed copy resolves to this checkout, so the provenance row names its release.
      const ledger = fix.readLedger();
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({ stage: 'full-review', session_id: rows[0].session_id, schema_version: 4, producer_version: RELEASE });
      expect(validRow(ledger[0])).toBe(true);
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
    installCallHelper(fix.home);
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
    installCallHelper(fix.home);
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
    const marker = readFileSync(HELPER_SOURCE, 'utf8').match(/grep -q '([^']+)'/)?.[1];
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
    installCallHelper(fix.home);
    const r = spawnSync(Bun.which('zsh')!, ['-fc', skillBlock(join(ROOT, 'skills/full-review.md'), 'start')], { env: fix.env, encoding: 'utf8', timeout: 10_000 });
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain('no matches found');
    expect(r.stdout).toMatch(/^GE_TELEMETRY: session=/);
    expect(fix.readJsonl()).toHaveLength(1);
  }, 30_000);
  for (const helper of [false, true]) {
    test('unwired install is silent by default and diagnosable without exit 127, helper ' + (helper ? 'present with nothing resolvable' : 'absent'), () => {
      const fix = makeTelemetryFixture('community', 'absent');
      for (const kind of ['start', 'finish'] as const) {
        const quiet = executeBlock(fix.env, kind, undefined, undefined, helper);
        expect(quiet.status).toBe(0);
        expect(quiet.stdout).toBe('');
        expect(quiet.stderr).toBe('');
        const debug = executeBlock({ ...fix.env, GSTACK_EXTEND_TELEMETRY_DEBUG: '1' }, kind, undefined, undefined, helper);
        expect(debug.status).toBe(0);
        expect(debug.stderr).toContain('unresolvable');
        expect(debug.stderr).toContain('re-run ./setup');
      }
    });
  }
});

describe('the telemetry-call helper', () => {
  const callPath = (home: string) => join(home, '.gstack-extend/bin/telemetry-call');
  test('--resolve prints the wrapper the blocks would run, and nothing when none is compatible', () => {
    const fix = makeTelemetryFixture('community');
    installCallHelper(fix.home);
    const found = spawnSync(callPath(fix.home), ['--resolve'], { env: fix.env, encoding: 'utf8', timeout: 10_000 });
    expect([found.status, found.stderr]).toEqual([0, '']);
    expect(found.stdout).toBe(join(fix.home, '.claude/skills/gstack-extend/bin/gstack-extend-telemetry') + '\n');

    const bare = makeTelemetryFixture('community', 'absent');
    installCallHelper(bare.home);
    for (const debug of [{}, { GSTACK_EXTEND_TELEMETRY_DEBUG: '1' }]) {
      const none = spawnSync(callPath(bare.home), ['--resolve'], { env: { ...bare.env, ...debug }, encoding: 'utf8', timeout: 10_000 });
      expect([none.status, none.stdout, none.stderr]).toEqual([0, '', '']);
    }
  });
  test('it runs the wrapper in place, so the wrapper\'s parent is the shell that ran the block', () => {
    const fix = makeTelemetryFixture('community');
    installCallHelper(fix.home);
    const bin = join(fix.home, 'ppid-bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'gstack-extend-telemetry'), '#!/bin/bash\n' + PROTOCOL_LINE + 'printf "ppid=%s args=%s\\n" "$PPID" "$*"\n');
    chmodSync(join(bin, 'gstack-extend-telemetry'), 0o755);
    const r = spawnSync('bash', ['-c', '"$HOME/.gstack-extend/bin/telemetry-call" finish --skill extend:roadmap --outcome unknown; echo "shell=$$"'], {
      env: { ...fix.env, PATH: bin + ':' + fix.env.PATH }, encoding: 'utf8', timeout: 10_000,
    });
    expect(r.status).toBe(0);
    const parent = /^ppid=(\d+) args=finish --skill extend:roadmap --outcome unknown$/m.exec(r.stdout)?.[1];
    expect(parent).toBeDefined();
    expect(parent).toBe(/^shell=(\d+)$/m.exec(r.stdout)![1]);
  });
  test('without arguments it runs nothing and exits 0', () => {
    const fix = makeTelemetryFixture('community');
    installCallHelper(fix.home);
    const quiet = spawnSync(callPath(fix.home), [], { env: fix.env, encoding: 'utf8', timeout: 10_000 });
    expect([quiet.status, quiet.stdout, quiet.stderr]).toEqual([0, '', '']);
    expect(fix.readJsonl()).toHaveLength(0);
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
      expect(r.stderr).toContain('gstack helper unresolvable:');
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
    const beforeHandoffs = handoffs(fix).length;
    const stateQuiet = runHelper({ ...fix.env, GSTACK_EXTEND_STATE_DIR: blocked }, args);
    expect(stateQuiet.status).toBe(0);
    expect(stateQuiet.stderr).toBe('');
    expect(stateQuiet.stdout).toBe(
      `GE_TELEMETRY: unavailable reason=state-unwritable dir=${JSON.stringify(blocked)} error=ENOTDIR\n`,
    );
    expect(handoffs(fix)).toHaveLength(beforeHandoffs);
    const state = runHelper({ ...fix.env, GSTACK_EXTEND_STATE_DIR: blocked, GSTACK_EXTEND_TELEMETRY_DEBUG: '1' }, args);
    expect(state.status).toBe(0);
    expect(state.stdout).toBe(
      `GE_TELEMETRY: unavailable reason=state-unwritable dir=${JSON.stringify(blocked)} error=ENOTDIR\n`,
    );
    expect(state.stderr).toContain('state handoff unwritable');
    expect(handoffs(fix)).toHaveLength(beforeHandoffs);
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
        if (mode === 'stub') {
          // A colocated resolver alone must not opt a legacy logger into new sink rules.
          writeFileSync(join(fix.home, '.claude/skills/gstack/bin/gstack-state-root.sh'), 'return 1\n');
        }
        const alternate = join(fix.home, 'alternate');
        mkdirSync(alternate);
        writeFileSync(join(alternate, 'config.yaml'), 'telemetry: community\n');
        const env = { ...fix.env, [override]: alternate };
        runHelper(env, ['start', '--skill', 'extend:roadmap']);
        runHelper(env, ['finish', '--skill', 'extend:roadmap']);
        const alternateSink = override === 'GSTACK_STATE_DIR' || (mode === 'real' && HAS_STATE_RESOLVER);
        const expected = alternateSink ? alternate : join(fix.home, '.gstack');
        const other = alternateSink ? join(fix.home, '.gstack') : alternate;
        const rows = readFileSync(join(expected, 'analytics/skill-usage.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
        expect(rows).toHaveLength(2);
        expect(rows.map(row => row.event_type)).toEqual(['skill_start', 'skill_run']);
        expect(rows[1].session_id).toBe(rows[0].session_id);
        expect(existsSync(join(other, 'analytics/skill-usage.jsonl'))).toBe(false);
      }
    }, 30_000);
    test.if(mode === 'stub' || HAS_GSTACK)('state-root precedence and plugin fallback keep one paired sink (' + mode + ')', () => {
      const cases = [
        { values: { GSTACK_STATE_ROOT: 'root', GSTACK_HOME: 'home', GSTACK_STATE_DIR: 'dir' }, modern: 'root', legacy: 'dir' },
        { values: { GSTACK_STATE_ROOT: '', GSTACK_HOME: 'home', GSTACK_STATE_DIR: 'dir' }, modern: 'home', legacy: 'dir' },
        { values: { GSTACK_STATE_DIR: 'dir', CLAUDE_PLUGIN_DATA: 'plugin', CLAUDE_PLUGIN_ROOT: '/plugins/gstack' }, modern: 'dir', legacy: 'dir' },
        { values: { CLAUDE_PLUGIN_DATA: 'plugin', CLAUDE_PLUGIN_ROOT: '/plugins/GsTaCk' }, modern: 'plugin', legacy: '.gstack' },
        { values: { CLAUDE_PLUGIN_DATA: 'plugin', CLAUDE_PLUGIN_ROOT: '/plugins/other' }, modern: '.gstack', legacy: '.gstack' },
      ];
      for (const item of cases) {
        const fix = makeTelemetryFixture('community', mode);
        const env = { ...fix.env };
        for (const name of ['root', 'home', 'dir', 'plugin']) {
          mkdirSync(join(fix.home, name));
          writeFileSync(join(fix.home, name, 'config.yaml'), 'telemetry: community\n');
        }
        for (const [key, value] of Object.entries(item.values)) {
          env[key] = value && key !== 'CLAUDE_PLUGIN_ROOT' ? join(fix.home, value) : value;
        }
        expect(runHelper(env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
        expect(runHelper(env, ['finish', '--skill', 'extend:roadmap']).status).toBe(0);
        const modern = existsSync(join(fix.home, '.claude/skills/gstack/bin/gstack-state-root.sh'));
        const expected = modern ? item.modern : item.legacy;
        const rows = readFileSync(join(fix.home, expected, 'analytics/skill-usage.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
        expect(rows.map(row => row.event_type)).toEqual(['skill_start', 'skill_run']);
        expect(rows[1].session_id).toBe(rows[0].session_id);
        for (const name of ['root', 'home', 'dir', 'plugin', '.gstack'].filter(name => name !== expected)) {
          expect(existsSync(join(fix.home, name, 'analytics/skill-usage.jsonl'))).toBe(false);
        }
      }
    }, 60_000);
  }
  test('sink follows the selected logger resolver verbatim, including unusual path bytes; doctor reads the pair', () => {
    const fix = makeTelemetryFixture('community');
    const bin = join(fix.home, "logger '$()\n", 'bin');
    mkdirSync(bin, { recursive: true });
    const chosen = join(fix.home, "chosen '$()\r\n");
    // Deliberately use a different root rule so a copied precedence ladder cannot pass.
    writeFileSync(join(bin, 'gstack-state-root.sh'), 'gstack_state_root_select() { _gstack_sr_root="$CHOSEN_SINK"; }\n');
    writeFileSync(join(bin, 'gstack-telemetry-log'), `#!/bin/bash
${NO_SWEEP_LINE}. "$(dirname "$0")/gstack-state-root.sh"
gstack_state_root_select
python3 - "$_gstack_sr_root" "$@" <<'PY'
import json, sys
from pathlib import Path
from datetime import datetime, timezone
sink = Path(sys.argv[1]) / 'analytics/skill-usage.jsonl'
sink.parent.mkdir(parents=True, exist_ok=True)
args = iter(sys.argv[2:])
values = {flag: (True if flag == '--no-sweep' else next(args)) for flag in args}
with sink.open('a') as f:
    f.write(json.dumps(dict(v=1, event_type='skill_run', source=values['--source'],
                           skill=values['--skill'], session_id=values['--session-id'],
                           ts=datetime.now(timezone.utc).isoformat())) + '\\n')
PY
`);
    chmodSync(join(bin, 'gstack-telemetry-log'), 0o755);
    const env = { ...fix.env, PATH: bin + ':' + fix.env.PATH, CHOSEN_SINK: chosen };
    expect(runHelper(env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    expect(runHelper(env, ['finish', '--skill', 'extend:roadmap']).status).toBe(0);
    const rows = readFileSync(join(chosen, 'analytics/skill-usage.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(rows.map(row => row.event_type)).toEqual(['skill_start', 'skill_run']);
    expect(rows[1].session_id).toBe(rows[0].session_id);
    expect(fix.readJsonl()).toHaveLength(0);
    const doctor = spawnSync(join(ROOT, 'bin/gstack-extend'), ['doctor', 'telemetry', '--json'], { env, encoding: 'utf8', timeout: 10_000 });
    expect(doctor.status).toBe(0);
    const report = JSON.parse(doctor.stdout);
    expect(report.sink).toBe(join(chosen, 'analytics/skill-usage.jsonl'));
    expect(report.skills.find((row: any) => row.skill === 'roadmap')).toMatchObject({ paired: 1, denominator: 1 });
  });
  test('a broken modern resolver preserves provenance and an existing handoff without writing a legacy finish', () => {
    const fix = makeModernResolverFixture();
    expect(runHelper(fix.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    writeFileSync(join(fix.home, '.claude/skills/gstack/bin/gstack-state-root.sh'), 'return 1\n');
    const finish = runHelper(fix.env, ['finish', '--skill', 'extend:roadmap']);
    expect(finish.status).toBe(0);
    expect(finish.stderr).toBe('');
    expect(fix.readJsonl()).toHaveLength(1);
    expect(fix.readLedger()).toHaveLength(1);
    expect(handoffs(fix)).toHaveLength(1);
    writeFileSync(join(fix.home, '.claude/skills/gstack/bin/gstack-state-root.sh'), STATE_ROOT_FIXTURE);
    expect(runHelper(fix.env, ['finish', '--skill', 'extend:roadmap']).status).toBe(0);
    const rows = fix.readJsonl();
    expect(rows.map(row => row.event_type)).toEqual(['skill_start', 'skill_run']);
    expect(rows[1].session_id).toBe(rows[0].session_id);
    expect(fix.readLedger()).toHaveLength(1);
    expect(handoffs(fix)).toHaveLength(0);
  });
  // Protect the interpreter boundary itself: existing relative-helper tests never execute this resolver.
  test('the modern resolver ignores a planted bash in a relative PATH entry', () => {
    const fix = makeModernResolverFixture();
    mkdirSync(join(fix.home, 'trap-bin'));
    writeFileSync(join(fix.home, 'trap-bin/bash'), '#!/bin/sh\nprintf owned > "$HOME/planted-bash-ran"\nexec /bin/bash "$@"\n');
    chmodSync(join(fix.home, 'trap-bin/bash'), 0o755);
    const script = `import importlib.util, sys
spec = importlib.util.spec_from_file_location('telemetry', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
print(module.sink_path(sys.argv[2]))
`;
    const run = spawnSync('python3', ['-I', '-c', script, join(ROOT, 'bin/lib/telemetry.py'),
      join(fix.home, '.claude/skills/gstack/bin/gstack-telemetry-log')],
      { cwd: fix.home, env: { ...fix.env, PATH: 'trap-bin:' + fix.env.PATH }, encoding: 'utf8', timeout: 10_000 });
    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
    expect(run.stdout).toBe(join(fix.home, '.gstack/analytics/skill-usage.jsonl') + '\n');
    expect(existsSync(join(fix.home, 'planted-bash-ran'))).toBe(false);
  });
  for (const phase of ['start', 'finish']) {
    for (const failure of ['error', 'timeout']) {
      test('a second resolver ' + failure + ' during ' + phase + ' preserves provenance and retry bookkeeping', () => {
        const fix = makeModernResolverFixture();
        if (phase === 'finish') expect(runHelper(fix.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
        // Fail only the late resolver boundary, after its initial validation succeeded.
        // Inject timeout exceptions without a real wait or a global subprocess stub.
        const script = `import importlib.util, sys
spec = importlib.util.spec_from_file_location('telemetry', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
original = module.subprocess.run
calls = 0
def run(args, **kwargs):
    global calls
    if module.os.path.basename(args[0]) == 'bash' and args[-1].endswith('/gstack-state-root.sh'):
        calls += 1
        if calls == 2:
            if sys.argv[2] == 'timeout':
                raise module.subprocess.TimeoutExpired(args, 10)
            raise OSError('synthetic late resolver failure')
    return original(args, **kwargs)
module.subprocess.run = run
module.main([sys.argv[3], '--skill', 'extend:roadmap'])
`;
        const result = spawnSync('python3', ['-I', '-c', script, join(ROOT, 'bin/lib/telemetry.py'), failure, phase],
          { env: fix.env, encoding: 'utf8', timeout: 10_000 });
        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
        expect(fix.readJsonl()).toHaveLength(phase === 'start' ? 0 : 1);
        expect(fix.readLedger()).toHaveLength(phase === 'start' ? 0 : 1);
        expect(handoffs(fix)).toHaveLength(1);
        expect(runHelper(fix.env, ['finish', '--skill', 'extend:roadmap']).status).toBe(0);
        expect(fix.readLedger()).toHaveLength(1);
        expect(handoffs(fix)).toHaveLength(0);
        const rows = fix.readJsonl();
        if (phase === 'finish') {
          expect(rows.map(row => row.event_type)).toEqual(['skill_start', 'skill_run']);
          expect(rows[1].session_id).toBe(rows[0].session_id);
        } else {
          expect(rows).toHaveLength(0); // An unwritten start must never invent a completion.
        }
      });
    }
  }
  test.if(HAS_STATE_RESOLVER)('modern upstream precedence and raw paths pair in the doctor and logger', () => {
    for (const selected of ['root', 'home', 'dir', 'plugin', 'foreign-plugin', 'default', 'relative']) {
      const fix = makeTelemetryFixture('community', 'real');
      const roots = {
        root: join(fix.home, 'root\r\n雪\n'), home: join(fix.home, 'home'),
        dir: join(fix.home, 'dir'), plugin: join(fix.home, 'plugin'), default: join(fix.home, '.gstack'),
      };
      for (const root of Object.values(roots)) {
        mkdirSync(root, { recursive: true });
        writeFileSync(join(root, 'config.yaml'), 'telemetry: community\n');
      }
      mkdirSync(join(fix.home, 'relative-state'));
      writeFileSync(join(fix.home, 'relative-state/config.yaml'), 'telemetry: community\n');
      const env = { ...fix.env, GSTACK_STATE_ROOT: '', GSTACK_HOME: '', GSTACK_STATE_DIR: '',
        CLAUDE_PLUGIN_ROOT: '/plugins/GsTaCk', CLAUDE_PLUGIN_DATA: roots.plugin };
      let expected = roots.default;
      if (selected === 'root') {
        Object.assign(env, { GSTACK_STATE_ROOT: roots.root, GSTACK_HOME: roots.home, GSTACK_STATE_DIR: roots.dir });
        expected = roots.root;
      } else if (selected === 'home') {
        Object.assign(env, { GSTACK_HOME: roots.home, GSTACK_STATE_DIR: roots.dir });
        expected = roots.home;
      } else if (selected === 'dir') {
        env.GSTACK_STATE_DIR = roots.dir;
        expected = roots.dir;
      } else if (selected === 'plugin') {
        expected = roots.plugin;
      } else if (selected === 'foreign-plugin') {
        env.CLAUDE_PLUGIN_ROOT = '/plugins/another-tool';
      } else if (selected === 'default') {
        env.CLAUDE_PLUGIN_DATA = '';
      } else {
        env.GSTACK_STATE_ROOT = 'relative-state';
        expected = 'relative-state';
      }
      for (const command of ['start', 'finish']) {
        const run = runHelper(env, [command, '--skill', 'extend:roadmap'], fix.home);
        expect([run.status, run.stderr]).toEqual([0, '']);
      }
      const sink = join(expected, 'analytics/skill-usage.jsonl');
      const rows = readFileSync(expected === 'relative-state' ? join(fix.home, sink) : sink, 'utf8')
        .trim().split('\n').map(line => JSON.parse(line));
      expect(rows.map(row => row.event_type)).toEqual(['skill_start', 'skill_run']);
      expect(rows[1].session_id).toBe(rows[0].session_id);
      for (const root of Object.values(roots)) {
        if (root !== expected) expect(existsSync(join(root, 'analytics/skill-usage.jsonl'))).toBe(false);
      }
      const doctor = spawnSync(join(ROOT, 'bin/gstack-extend'), ['doctor', 'telemetry', '--json'],
        { env, cwd: fix.home, encoding: 'utf8', timeout: 10_000 });
      expect([doctor.status, doctor.stderr]).toEqual([0, '']);
      const report = JSON.parse(doctor.stdout);
      expect(report.sink).toBe(sink);
      expect(report.skills.find((row: any) => row.skill === 'roadmap').paired).toBe(1);
    }
  }, 90_000);
  test.if(HAS_STATE_RESOLVER)('modern upstream keeps the most restrictive telemetry tier across roots', () => {
    for (const offRoot of ['default', 'selected']) {
      const fix = makeTelemetryFixture(offRoot === 'default' ? 'off' : 'community', 'real');
      const alternate = join(fix.home, 'alternate');
      mkdirSync(alternate);
      writeFileSync(join(alternate, 'config.yaml'), `telemetry: ${offRoot === 'selected' ? 'off' : 'community'}\n`);
      const env = { ...fix.env, GSTACK_STATE_ROOT: alternate };
      runHelper(env, ['start', '--skill', 'extend:roadmap']);
      runHelper(env, ['finish', '--skill', 'extend:roadmap']);
      expect(fix.readJsonl()).toHaveLength(0);
      expect(existsSync(join(alternate, 'analytics/skill-usage.jsonl'))).toBe(false);
      expect(fix.readLedger()).toHaveLength(1);
    }
  }, 30_000);
  test.if(HAS_STATE_RESOLVER)('missing or failing modern resolver preserves provenance without phantom usage', () => {
    for (const broken of ['missing', 'failing']) {
      const fix = makeTelemetryFixture('community', 'real');
      const resolver = join(fix.home, '.claude/skills/gstack/bin/gstack-state-root.sh');
      if (broken === 'missing') rmSync(resolver);
      else writeFileSync(resolver, 'printf "private-resolver-content" >&2\nreturn 1\n');
      // Keep tier lookup working so start exercises the sink resolver's own failure path.
      writeFileSync(join(fix.home, '.claude/skills/gstack/bin/gstack-config'), '#!/bin/sh\nprintf "community\\n"\n');
      for (const command of ['start', 'finish']) {
        const run = runHelper(fix.env, [command, '--skill', 'extend:roadmap']);
        expect([run.status, run.stderr]).toEqual([0, '']);
      }
      expect(fix.readJsonl()).toHaveLength(0);
      expect(fix.readLedger()).toHaveLength(1);
      // An explicit finish reaches delegation even though the failed start wrote no usage marker.
      const debug = runHelper({ ...fix.env, GSTACK_EXTEND_TELEMETRY_DEBUG: '1' },
        ['--skill', 'extend:roadmap', '--duration', '1', '--session-id', 'resolver-diagnostic']);
      expect([debug.status, debug.stdout]).toEqual([0, '']);
      expect(debug.stderr).toContain('gstack state resolver unavailable');
      expect(debug.stderr).toContain('reinstall gstack');
      expect(debug.stderr).not.toContain('sink unwritable');
      expect(debug.stderr).not.toContain('repair permissions');
      expect(debug.stderr).not.toContain('at None: None');
      expect(debug.stderr).not.toContain('private-resolver-content');
      expect(fix.readJsonl()).toHaveLength(0);
      const doctor = spawnSync(join(ROOT, 'bin/gstack-extend'), ['doctor', 'telemetry', '--json'],
        { env: fix.env, encoding: 'utf8', timeout: 10_000 });
      expect(doctor.status).toBe(0);
      expect(doctor.stdout).not.toContain('private-resolver-content');
      expect(JSON.parse(doctor.stdout).error).toContain('gstack state resolver unavailable');
    }
  }, 30_000);
  test('valid/leading-zero/future start values and session validation are safe', () => {
    const fix = makeTelemetryFixture('community');
    // One session id per start value: a repeated explicit finish of one session is a no-op once it has completed.
    for (const [index, start] of [String(Math.floor(Date.now() / 1000)), '0000000001', '9223372036854775807'].entries()) {
      const r = runHelper(fix.env, ['finish', '--skill', 'extend:roadmap', '--start', start, '--session-id', 'explicit-' + index]);
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


const STATE_ROOT_FIXTURE = 'gstack_state_root_select() { _gstack_sr_root="$HOME/.gstack"; }\n';
function makeModernResolverFixture() {
  const fix = makeTelemetryFixture('community');
  const bin = join(fix.home, '.claude/skills/gstack/bin');
  const legacy = join(bin, 'fixture-legacy-logger');
  writeFileSync(legacy, readFileSync(join(bin, 'gstack-telemetry-log')));
  chmodSync(legacy, 0o755);
  writeFileSync(join(bin, 'gstack-state-root.sh'), STATE_ROOT_FIXTURE);
  // This logger actually consumes the colocated resolver; an unrelated helper is insufficient.
  writeFileSync(join(bin, 'gstack-telemetry-log'), `#!/bin/bash
${NO_SWEEP_LINE}. "$(dirname "$0")/gstack-state-root.sh" || exit 1
gstack_state_root_select || exit 1
export GSTACK_STATE_DIR="$_gstack_sr_root"
exec "$(dirname "$0")/fixture-legacy-logger" "$@"
`);
  chmodSync(join(bin, 'gstack-telemetry-log'), 0o755);
  return fix;
}

function runHelper(env: Record<string, string>, args: string[], cwd?: string) {
  return spawnSync(HELPER_BIN, args, { env, cwd, encoding: 'utf8', timeout: 10_000 });
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
    expect(handoffs(fix)).toHaveLength(0);
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
    expect(handoffs(fix)).toHaveLength(1);
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
    expect(handoffs(fix)).toHaveLength(1);
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

/** Open handoffs, relative to the telemetry state dir: `<key>/<sha256(session)>.json` per invocation, or a legacy `<key>.json`. */
function handoffs(fix: TelemetryFixture) {
  const dir = join(fix.home, '.gstack-extend/telemetry');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? readdirSync(join(dir, entry.name)).filter(name => /^[0-9a-f]{64}\.json$/.test(name)).map(name => join(entry.name, name))
    : entry.name.endsWith('.json') ? [entry.name] : []).sort();
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
  test('a corrupt or hostile handoff never crashes finish; an integer start is honoured; bad state never blocks the next start', () => {
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
    // JSON integers (not just strings) are a valid start; the matching handoff is then consumed. The damaged file
    // beside it is not a candidate and does not block it.
    const legacy = join(dirname(dirname(file)), basename(dirname(file)) + '.json');
    writeFileSync(legacy, JSON.stringify({ session_id: 'from-state', start: Math.floor(Date.now() / 1000) - 20 }));
    expect(runHelper(fix.env, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    expect(fix.readJsonl()[1]).toMatchObject({ session_id: 'from-state', event_type: 'skill_run' });
    expect(fix.readJsonl()[1].duration_s).toBeGreaterThanOrEqual(20);
    expect(existsSync(legacy)).toBe(false);
    // Recovery: bad state left behind stays put, and the next start still pairs normally.
    writeFileSync(file, 'garbage{{');
    expect(runHelper(fix.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    expect(runHelper(fix.env, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    const rows = fix.readJsonl();
    expect(rows.at(-1)!.session_id).toBe(rows.at(-2)!.session_id);
    expect(handoffs(fix)).toHaveLength(1);
    expect(readFileSync(file, 'utf8')).toBe('garbage{{');
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
    expect(absent.stderr).toContain('gstack helper unresolvable:');
    chmodSync(join(canonical, 'gstack-telemetry-log'), 0o755);

    // Empty-string overrides fall back to the defaults under HOME instead of the cwd.
    const rowsBefore = fix.readJsonl().length;
    const blank = runHelper({ ...fix.env, GSTACK_STATE_DIR: '', GSTACK_EXTEND_STATE_DIR: '', GSTACK_DIR: '' },
      ['start', '--skill', 'extend:roadmap']);
    expect(blank.status).toBe(0);
    expect(blank.stderr).toBe('');
    expect(fix.readJsonl()).toHaveLength(rowsBefore + 1);
    // Every start keeps its own handoff: the three logger lookups, the logger-less start and this one.
    expect(handoffs(fix)).toHaveLength(5);

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
    expect(hostile.stderr).toContain('gstack helper unresolvable:');
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
    // Every start keeps its own handoff: 22 open, all whole JSON, no leftover temporary files, each naming a
    // session that was emitted, and the shared root's racers arrived in distinct seq order.
    const names = handoffs(fix);
    expect(names).toHaveLength(22);
    expect(names.every(name => /^[0-9a-f]{64}\/[0-9a-f]{64}\.json$/.test(name))).toBe(true);
    const emitted = new Set(rows.map(row => row.session_id));
    const opened = names.map(name => JSON.parse(readFileSync(join(fix.home, '.gstack-extend/telemetry', name), 'utf8')));
    for (const handoff of opened) {
      expect(emitted.has(handoff.session_id)).toBe(true);
      expect(/^[0-9]+$/.test(handoff.start)).toBe(true);
      expect(/^[0-9]+$/.test(handoff.seq)).toBe(true);
    }
    expect(new Set(opened.map(handoff => handoff.session_id)).size).toBe(22);
    const racers = opened.filter(handoff => handoff.root === realpathSync(shared));
    expect(racers).toHaveLength(10);
    expect(new Set(racers.map(handoff => handoff.seq)).size).toBe(10);
    // Ten parallel start-less finishes in the shared root: ten rows, ten distinct sessions, nothing lost,
    // and the twelve separate roots' handoffs stay untouched.
    const finishes = await Promise.all(Array.from({ length: 10 }, () =>
      runAsync(env, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success'], shared)));
    for (const result of finishes) {
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
    }
    const after = fix.readJsonl();
    expect(after).toHaveLength(32);
    const racerSessions = racers.map(handoff => handoff.session_id).sort();
    expect(after.slice(22).map(row => row.session_id).sort()).toEqual(racerSessions);
    expect(fix.readLedger().map(row => row.session_id).sort()).toEqual(racerSessions);
    expect(handoffs(fix)).toHaveLength(12);
  }, 30_000);
});

// ─── Execution provenance: the local-only stage-runs/<host>.jsonl row ───

const HOST_LEDGER_FILE = ((hostname().split('.')[0] ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63).replace(/-+$/g, '') || 'unknown-host') + '.jsonl';
const SCHEMA = ['stage', 'agent', 'model', 'effort', 'rung', 'outcome', 'started_at', 'duration_s', 'session_id',
  'repo', 'branch', 'work_item', 'source', 'route', 'entrypoint_raw', 'schema_version', 'producer_version',
  'agent_source', 'model_source', 'effort_source', 'workspace_host', 'run_mode', 'run_mode_source',
  'questions', 'user_wait_s', 'resumes', 'user_signals_source', 'blocked_reason', 'blocked_reason_source'];
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
    expect(row).toMatchObject({ agent: 'cursor', route: 'cli', model: null, effort: null,
      agent_source: 'detected', model_source: 'unknown', effort_source: 'unknown' });
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
      session_id: sid, repo: 'acme/widget', branch: 'feature/x', work_item: null, source: 'gstack-extend',
      schema_version: 4, producer_version: RELEASE, agent_source: 'unknown', model_source: 'unknown', effort_source: 'unknown' });
    expect(validRow(row)).toBe(true);
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
    expect(row).toMatchObject({ outcome: 'error', agent: 'claude', model: 'claude-opus-5', effort: 'xhigh', work_item: '4D',
      agent_source: 'flag', model_source: 'flag', effort_source: 'flag' });
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
    expect(row).toMatchObject({ agent: 'claude', model: 'claude-opus-5', effort: 'xhigh',
      agent_source: 'detected', model_source: 'detected', effort_source: 'detected' });
    // A per-turn effort override is the level that turn actually used.
    const perTurn = provenanceRun(fix, env, () =>
      writeJsonl(transcript, [claudeTurn(Date.now() / 1000, 'p1', 'claude-opus-5', 'xhigh', { perTurnEffort: 'max' })])).row;
    expect(perTurn.effort).toBe('max');
    // A skill run by a subagent leaves the parent transcript idle: its earlier turn must not be inherited.
    const idle = provenanceRun(fix, env, start => writeJsonl(transcript, [claudeTurn(start - 5, 'p2', 'claude-opus-5', 'xhigh')])).row;
    expect(idle).toMatchObject({ agent: 'claude', model: null, effort: null,
      agent_source: 'detected', model_source: 'unknown', effort_source: 'unknown' });
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
      .toMatchObject({ agent: 'codex', model: 'gpt-6-astra', effort: 'high', work_item: '4D', outcome: 'abort',
        agent_source: 'flag', model_source: 'flag', effort_source: 'flag' });
    expect(provenanceRun(fix, env, logs, ['--agent', 'codex']).row)
      .toMatchObject({ agent: 'codex', model: null, effort: null, outcome: 'unknown',
        agent_source: 'flag', model_source: 'unknown', effort_source: 'unknown' });
    expect(provenanceRun(fix, env, logs, ['--agent', 'claude', '--effort', 'max']).row)
      .toMatchObject({ agent: 'claude', model: 'claude-opus-5', effort: 'max',
        agent_source: 'flag', model_source: 'detected', effort_source: 'flag' });
    expect(provenanceRun(fix, env, logs, ['--agent', 'gpt', '--model', 'bad\u0007id', '--work-item', ' ', '--outcome', 'exploded']).row)
      .toMatchObject({ agent: 'claude', model: 'claude-opus-5', effort: 'xhigh', work_item: null, outcome: 'unknown',
        agent_source: 'detected', model_source: 'detected', effort_source: 'detected' });
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
    expect(fix.readLedger()[0]).toMatchObject({ agent: 'claude', model: null, session_id: 'sid-fifo',
      agent_source: 'detected', model_source: 'unknown' });
  });

  test('a FIFO at the provenance sink does not block finish', () => {
    const fix = makeTelemetryFixture('off');
    const dir = join(fix.home, '.gstack-extend/analytics/stage-runs');
    mkdirSync(dir, { recursive: true });
    expect(spawnSync('mkfifo', [join(dir, HOST_LEDGER_FILE)]).status).toBe(0);
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
    const ledger = join(linked.home, '.gstack-extend/analytics/stage-runs', HOST_LEDGER_FILE);
    mkdirSync(join(linked.home, '.gstack/analytics'), { recursive: true });
    mkdirSync(join(linked.home, '.gstack-extend/analytics/stage-runs'), { recursive: true });
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
  }, 30_000);

  test('an unreadable provenance config records nothing', () => {
    const fix = makeTelemetryFixture('off');
    mkdirSync(join(fix.home, '.gstack-extend/config'), { recursive: true });
    expect(runHelper(fix.env, ['--skill', 'extend:roadmap', '--duration', '1', '--session-id', 'sid-closed']).status).toBe(0);
    expect(fix.readLedger()).toHaveLength(0);
  });
});




function cursorWork(fix: TelemetryFixture) {
  const work = join(fix.home, 'cursor-work');
  mkdirSync(work, { recursive: true });
  const cwd = realpathSync(work);
  const seen = spawnSync('python3', ['-c', 'import os; print(os.getcwd())'], { env: fix.env, cwd, encoding: 'utf8' });
  expect(seen.status).toBe(0);
  return seen.stdout.trim();
}

function cursorFinish(fix: TelemetryFixture, env: Record<string, string>, plant: (start: number, cwd: string) => void, finishArgs: string[] = []) {
  const cwd = cursorWork(fix);
  const runEnv = { ...fix.env, ...env };
  const start = spawnSync(HELPER_BIN, ['start', '--skill', 'extend:roadmap'], { env: runEnv, cwd, encoding: 'utf8', timeout: 15_000 });
  expect([start.status, start.stderr]).toEqual([0, '']);
  const epoch = Number(start.stdout.match(/start=(\d+)/)![1]);
  plant(epoch, cwd);
  const finish = spawnSync(HELPER_BIN, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success', ...finishArgs], {
    env: runEnv, cwd, encoding: 'utf8', timeout: 15_000,
  });
  return { finish, row: fix.readLedger().at(-1)!, epoch, cwd };
}

describe('Conductor Cursor store retirement (Track 73A)', () => {
  test('finish with CURSOR_AGENT=1 never touches a planted Conductor Cursor store or sqlite3.connect, and leaves model/effort null with route unknown', () => {
    const fix = makeTelemetryFixture('off');
    const cwd = cursorWork(fix);
    const storeShard = join(fix.home, 'Library/Application Support/com.conductor.app/cursor-sdk-store/shard-a');
    mkdirSync(storeShard, { recursive: true });
    writeJsonl(join(storeShard, 'agents.ndjson'), [{ agentId: 'conv-1', cwd }]);
    writeJsonl(join(storeShard, 'runs.ndjson'), [{
      agentId: 'conv-1',
      runId: 'run-1',
      startedAt: (epochNow() - 20) * 1000,
      updatedAt: epochNow() * 1000,
      endedAt: null,
      model: { id: 'grok-4.7', params: [{ id: 'reasoning_effort', value: 'high' }] },
    }]);

    // End-to-end finish via wrapper
    const finished = cursorFinish(fix, { CURSOR_AGENT: '1', CURSOR_CONVERSATION_ID: 'conv-1' }, () => {});
    expect([finished.finish.status, finished.finish.stdout, finished.finish.stderr]).toEqual([0, '', '']);
    expect(finished.row).toMatchObject({
      agent: 'cursor',
      model: null,
      effort: null,
      model_source: 'unknown',
      effort_source: 'unknown',
      route: 'unknown',
      schema_version: 4,
    });
    expect(validRow(finished.row)).toBe(true);

    // Python audit-hook verification: zero filesystem calls under cursor-sdk-store and zero sqlite3.connect calls
    const auditScript = [
      'import contextlib, io, json, os, sys',
      'sys.path.insert(0, sys.argv[1])',
      'import telemetry',
      'bad = []',
      'def hook(event, args):',
      '    if event == "sqlite3.connect":',
      '        bad.append((event, str(args[:1])))',
      '    elif event in ("open", "os.listdir", "os.scandir", "os.stat"):',
      '        target = str(args[0]) if args else ""',
      '        if "cursor-sdk-store" in target or "com.conductor.app" in target:',
      '            bad.append((event, target))',
      'sys.addaudithook(hook)',
      'os.environ["CURSOR_AGENT"] = "1"',
      'os.environ["CURSOR_CONVERSATION_ID"] = "conv-1"',
      'row = telemetry.provenance_row("roadmap", "sid-cursor-audit", 1790000000, 5, {"--outcome": "success"}, None)',
      'os.environ["GSTACK_EXTEND_TELEMETRY_DEBUG"] = "1"',
      'def broken(*a, **k): raise PermissionError(13, "SENTINEL_TRANSCRIPT_ERR")',
      'telemetry.cursor_logs = broken',
      'buf = io.StringIO()',
      'with contextlib.redirect_stderr(buf):',
      '    telemetry.provenance_row("roadmap", "sid-cursor-err", 1790000000, 5, {"--outcome": "success"}, None)',
      'print(json.dumps({"bad": bad, "row": row, "stderr": buf.getvalue()}))',
    ].join('\n');
    const audit = spawnSync('python3', ['-B', '-I', '-c', auditScript, join(ROOT, 'bin/lib')], {
      env: fix.env,
      cwd,
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect([audit.status, audit.stderr]).toEqual([0, '']);
    const parsed = JSON.parse(audit.stdout);
    expect(parsed.bad).toEqual([]);
    expect(parsed.row).toMatchObject({
      agent: 'cursor',
      model: null,
      effort: null,
      model_source: 'unknown',
      effort_source: 'unknown',
      route: 'unknown',
    });
    expect(parsed.stderr).toContain('telemetry: cursor-sdk transcript-unreadable. See docs/telemetry.md#cursor-sdk-transcript-unreadable.');
    expect(parsed.stderr).not.toContain('SENTINEL_TRANSCRIPT_ERR');
  });
});



/** A disposable copy of the wrapper and module with its own VERSION; the real VERSION is never written. */
function copiedInstall(fix: TelemetryFixture, name: string, version: string | null) {
  const root = join(fix.home, name);
  mkdirSync(join(root, 'bin/lib'), { recursive: true });
  copyFileSync(HELPER_BIN, join(root, 'bin/gstack-extend-telemetry'));
  chmodSync(join(root, 'bin/gstack-extend-telemetry'), 0o755);
  copyFileSync(join(ROOT, 'bin/lib/telemetry.py'), join(root, 'bin/lib/telemetry.py'));
  if (version !== null) writeFileSync(join(root, 'VERSION'), version);
  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(join(root, 'bin/gstack-extend-telemetry'), args, { env: { ...fix.env, ...env }, encoding: 'utf8', timeout: 15_000 });
  return { root, versionFile: join(root, 'VERSION'), run };
}

const UNKNOWN_PRODUCER = (reason: string) => `telemetry: PRODUCER_VERSION_UNKNOWN: producer_version unknown (${reason}). `
  + 'Fix: restore or upgrade the gstack-extend installation so its VERSION holds a valid release; only newly constructed rows improve, '
  + 'saved retries retain their original producer. See docs/telemetry.md#producer-version.';

describe('row version, producer and sources', () => {
  test('producer_version names the running installation, never the caller repository, gstack, or an override', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const caller = gitRepo(fix, 'caller-repo');
    writeFileSync(join(caller, 'VERSION'), '9.9.9.9\n');
    writeFileSync(join(fix.home, '.claude/skills/gstack/VERSION'), '8.8.8.8\n');
    const decoy = join(fix.home, 'decoy');
    mkdirSync(decoy);
    writeFileSync(join(decoy, 'VERSION'), '7.7.7.7\n');
    // The fixture install links bin/ into this checkout; its unresolved parent has no VERSION to read.
    const installed = join(fix.home, '.claude/skills/gstack-extend');
    expect(existsSync(join(installed, 'VERSION'))).toBe(false);
    const env = { ...fix.env, GSTACK_DIR: decoy, GSTACK_EXTEND_DIR: decoy };
    const options = { env, cwd: caller, encoding: 'utf8' as const, timeout: 15_000 };
    expect(spawnSync(join(installed, 'bin/gstack-extend-telemetry'), ['start', '--skill', 'extend:roadmap'], options).status).toBe(0);
    const finish = spawnSync(join(installed, 'bin/gstack-extend-telemetry'), ['finish', '--skill', 'extend:roadmap', '--outcome', 'success'], options);
    expect([finish.status, finish.stdout, finish.stderr]).toEqual([0, '', '']);
    expect(fix.readLedger()).toHaveLength(1);
    expect(fix.readLedger()[0]).toMatchObject({ schema_version: 4, producer_version: RELEASE });
    // Release and sources stay local: the completion the logger receives carries none of them.
    const forwarded = fix.readStubArgs().join('\n') + JSON.stringify(fix.readJsonl());
    for (const text of [RELEASE, 'schema', 'producer', '_source']) expect(forwarded).not.toContain(text);
  }, 30_000);

  test('an unusable installation VERSION leaves producer_version null, quietly, and the row still records', () => {
    const fix = makeTelemetryFixture('off');
    const unreadable = 'VERSION is unreadable, oversized, or not a private regular file';
    const malformed = 'VERSION is not a three- or four-part numeric release';
    const cases: Array<[string, (file: string) => void, string | null, string | null]> = [
      ['plain', file => writeFileSync(file, '0.40.1.2\n'), '0.40.1.2', null],
      ['CRLF and spaces', file => writeFileSync(file, ' 0.40.1.2\r\n'), '0.40.1.2', null],
      ['vertical-tab and form-feed', file => writeFileSync(file, '\v0.40.1.2\f\n'), '0.40.1.2', null],
      ['Unicode surrounding whitespace', file => writeFileSync(file, '\u00a00.40.1.2\u2003\n'), '0.40.1.2', null],
      ['exactly the cap', file => writeFileSync(file, '0.40.1.2' + ' '.repeat(119) + '\n'), '0.40.1.2', null],
      ['missing', () => {}, null, 'VERSION is missing'],
      ['one byte over the cap', file => writeFileSync(file, '0.40.1.2' + ' '.repeat(120) + '\n'), null, unreadable],
      ['symlink', file => { writeFileSync(file + '.real', '0.40.1.2\n'); symlinkSync(file + '.real', file); }, null, unreadable],
      ['hard link', file => { writeFileSync(file, '0.40.1.2\n'); linkSync(file, file + '.second'); }, null, unreadable],
      ['FIFO', file => expect(spawnSync('mkfifo', [file]).status).toBe(0), null, unreadable],
      ['directory', file => mkdirSync(file), null, unreadable],
      ['invalid UTF-8', file => writeFileSync(file, Buffer.from([0x30, 0x2e, 0xff, 0xfe, 0x0a])), null, 'VERSION is not UTF-8'],
      ['Unicode digits', file => writeFileSync(file, '٠.40.1.2\n'), null, malformed],
      ['three parts', file => writeFileSync(file, ' 1.0.0\r\n'), '1.0.0', null],
      ['two parts', file => writeFileSync(file, '0.40\n'), null, malformed],
      ['five parts', file => writeFileSync(file, '0.40.1.2.3\n'), null, malformed],
      ['prefix', file => writeFileSync(file, 'v1.0.0\n'), null, malformed],
      ['suffix', file => writeFileSync(file, '1.0.0-rc1\n'), null, malformed],
      ['internal space', file => writeFileSync(file, '0.40. 1.2\n'), null, malformed],
      ['private contents', file => writeFileSync(file, 'SENTINEL-RELEASE-TEXT\n'), null, malformed],
    ];
    cases.forEach(([name, plant, producer, reason], index) => {
      const install = copiedInstall(fix, 'install-' + index, null);
      plant(install.versionFile);
      const args = ['finish', '--skill', 'extend:roadmap', '--start', String(epochNow() - 1), '--outcome', 'success'];
      const quiet = install.run([...args, '--session-id', 'sid-quiet-' + index]);
      expect([name, quiet.status, quiet.stdout, quiet.stderr]).toEqual([name, 0, '', '']);
      const row = fix.readLedger().find(entry => entry.session_id === 'sid-quiet-' + index)!;
      expect([name, row.producer_version, validRow(row)]).toEqual([name, producer, true]);
      const debug = install.run([...args, '--session-id', 'sid-debug-' + index], DEBUG);
      const lines = debug.stderr.split('\n').filter(line => line.includes('producer_version'));
      expect([name, lines]).toEqual([name, reason ? [UNKNOWN_PRODUCER(reason)] : []]);
      expect(debug.stderr).not.toContain('SENTINEL-RELEASE-TEXT');
      expect(fix.readLedger().filter(entry => entry.session_id === 'sid-debug-' + index)).toHaveLength(1);
    });
    // Delegated completion proceeds without a release.
    const usage = makeTelemetryFixture('community', 'stub');
    const install = copiedInstall(usage, 'install-missing', null);
    expect(install.run(['start', '--skill', 'extend:roadmap']).status).toBe(0);
    expect(install.run(['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    expect(usage.readLedger()).toMatchObject([{ producer_version: null, schema_version: 4 }]);
    expect(usage.readJsonl().map(entry => entry.event_type)).toEqual(['skill_start', 'skill_run']);
  }, 60_000);

  test('the source matrix labels the value each constructed row holds', () => {
    // detect() and route_for() are stubbed in-process, so every case runs the real constructor without detector waits.
    const harness = [
      'import contextlib, io, json, os, sys',
      'from unittest import mock',
      'sys.path.insert(0, sys.argv[1])',
      'import telemetry',
      'real_open = os.open',
      'def denied(path, *args, **kwargs):',
      '    if str(path) == str(telemetry.VERSION_FILE):',
      '        raise PermissionError(13, "Permission denied")',
      '    return real_open(path, *args, **kwargs)',
      'results = []',
      'for case in json.load(sys.stdin):',
      '    os.environ.pop("GSTACK_EXTEND_TELEMETRY_DEBUG", None)',
      '    if case.get("debug"):',
      '        os.environ["GSTACK_EXTEND_TELEMETRY_DEBUG"] = "1"',
      '    stderr = io.StringIO()',
      '    with contextlib.ExitStack() as stack:',
      '        stack.enter_context(contextlib.redirect_stderr(stderr))',
      '        stack.enter_context(mock.patch.object(telemetry, "detect", return_value=tuple(case["detected"])))',
      '        stack.enter_context(mock.patch.object(telemetry, "route_for", return_value=(telemetry.ROUTE_UNKNOWN, None)))',
      '        if case.get("deny"):',
      '            stack.enter_context(mock.patch.object(telemetry.os, "open", side_effect=denied))',
      '        row = telemetry.provenance_row("roadmap", "sid-matrix", 1790000000, 5, case["flags"], None)',
      '    results.append({"row": row, "stderr": stderr.getvalue()})',
      'print(json.dumps(results))',
    ].join('\n');
    type Value = string | null;
    const D: [Value, Value, Value] = ['claude', 'claude-opus-5', 'xhigh'];
    const NONE: [Value, Value, Value] = [null, null, null];
    const LONG = 'm'.repeat(200);
    const cases: Array<[string, [Value, Value, Value], Record<string, string>, [Value, Value, Value, string, string, string]]> = [
      ['no markers', NONE, {}, [null, null, null, 'unknown', 'unknown', 'unknown']],
      ['marked harness with an unreadable log', ['claude', null, null], {}, ['claude', null, null, 'detected', 'unknown', 'unknown']],
      ['full detection', D, {}, [...D, 'detected', 'detected', 'detected']],
      ['same agent flag', D, { '--agent': 'claude' }, [...D, 'flag', 'detected', 'detected']],
      ['same agent flag, nothing else detected', ['claude', null, null], { '--agent': 'claude' }, ['claude', null, null, 'flag', 'unknown', 'unknown']],
      ['changed agent drops detected values', D, { '--agent': 'codex' }, ['codex', null, null, 'flag', 'unknown', 'unknown']],
      ['changed agent, partial override', D, { '--agent': 'codex', '--model': 'gpt-6-astra' }, ['codex', 'gpt-6-astra', null, 'flag', 'flag', 'unknown']],
      ['agent flag over nothing', NONE, { '--agent': 'cursor' }, ['cursor', null, null, 'flag', 'unknown', 'unknown']],
      ['equal-value model flag', D, { '--model': 'claude-opus-5' }, [...D, 'detected', 'flag', 'detected']],
      ['effort-only flag', D, { '--effort': 'max' }, ['claude', 'claude-opus-5', 'max', 'detected', 'detected', 'flag']],
      ['model flag without an agent', NONE, { '--model': 'gpt-6-astra' }, [null, 'gpt-6-astra', null, 'unknown', 'flag', 'unknown']],
      ['200-character model flag', D, { '--model': LONG }, ['claude', LONG, 'xhigh', 'detected', 'flag', 'detected']],
      ['invalid agent flag', D, { '--agent': 'gpt' }, [...D, 'detected', 'detected', 'detected']],
      ['invalid agent flag over nothing', NONE, { '--agent': 'Claude' }, [null, null, null, 'unknown', 'unknown', 'unknown']],
      ['invalid agent beside a valid model', ['codex', 'gpt-6-astra', 'high'], { '--agent': 'gpt', '--model': 'o4' }, ['codex', 'o4', 'high', 'detected', 'flag', 'detected']],
      ['blank model flag', D, { '--model': '  ' }, [...D, 'detected', 'detected', 'detected']],
      ['control-character model flag', D, { '--model': 'bad\u0007id' }, [...D, 'detected', 'detected', 'detected']],
      ['201-character effort flag', D, { '--effort': LONG + 'm' }, [...D, 'detected', 'detected', 'detected']],
      ['empty effort flag over nothing', NONE, { '--effort': '' }, [null, null, null, 'unknown', 'unknown', 'unknown']],
      ['newline effort flag over a marked harness', ['codex', null, null], { '--effort': 'hi\nlo' }, ['codex', null, null, 'detected', 'unknown', 'unknown']],
    ];
    const input = [...cases.map(([, detected, flags]) => ({ detected, flags })), { detected: D, flags: {}, deny: true, debug: true }];
    const fix = makeTelemetryFixture('off');
    const result = spawnSync('python3', ['-B', '-I', '-c', harness, join(ROOT, 'bin/lib')],
      { env: fix.env, input: JSON.stringify(input), encoding: 'utf8', timeout: 15_000 });
    expect([result.status, result.stderr]).toEqual([0, '']);
    const rows = JSON.parse(result.stdout) as Array<{ row: Record<string, unknown>; stderr: string }>;
    cases.forEach(([name, , , expected], index) => {
      const { row, stderr } = rows[index];
      expect([name, Object.keys(row), stderr]).toEqual([name, SCHEMA, '']);
      expect([name, row.agent, row.model, row.effort, row.agent_source, row.model_source, row.effort_source])
        .toEqual([name, ...expected]);
      expect([name, row.schema_version, row.producer_version, validRow(row)]).toEqual([name, 4, RELEASE, true]);
    });
    // A read the operating system refuses (no portable chmod needed) costs only the release.
    const denied = rows.at(-1)!;
    expect(denied.row).toMatchObject({ agent: 'claude', model_source: 'detected', producer_version: null });
    expect(validRow(denied.row)).toBe(true);
    expect(denied.stderr.trim()).toBe(UNKNOWN_PRODUCER('VERSION is unreadable, oversized, or not a private regular file'));
  });

  test('a retried row keeps its construction metadata across an upgrade; a saved legacy row stays legacy', () => {
    const fix = makeTelemetryFixture('off');
    const older = copiedInstall(fix, 'install-older', '0.40.0.0\n');
    const newer = copiedInstall(fix, 'install-newer', '0.41.0.0\n');
    const start = ['start', '--skill', 'extend:roadmap'];
    const finish = ['finish', '--skill', 'extend:roadmap', '--outcome', 'success'];
    const lines = () => {
      const files = fix.ledgerFiles();
      return files.length ? readFileSync(files[0]!, 'utf8').split('\n').filter(Boolean) : [];
    };
    // A plain file where analytics/ belongs makes the first append fail, so the handoff saves the row.
    const blocker = join(fix.home, '.gstack-extend/analytics');
    const failFirstAppend = (install: ReturnType<typeof copiedInstall>, env: Record<string, string> = {}) => {
      expect(install.run(start).status).toBe(0);
      const kept = existsSync(blocker);
      if (kept) renameSync(blocker, blocker + '.kept');
      writeFileSync(blocker, '');
      expect(install.run(finish, env).status).toBe(0);
      rmSync(blocker);
      if (kept) renameSync(blocker + '.kept', blocker);
      return readHandoff(fix).row as Record<string, unknown>;
    };

    // A current v4 row built by the older installation is appended by the newer one exactly as built, whatever the retry passes.
    const saved = failFirstAppend(older, { CLAUDECODE: '1', GSTACK_EXTEND_WORKSPACE_OWNER: 'original-owner' });
    expect(saved).toMatchObject({ agent: 'claude', schema_version: 4, producer_version: '0.40.0.0',
      agent_source: 'detected', model_source: 'unknown', effort_source: 'unknown', workspace_host: 'original-owner' });
    expect(saved).not.toHaveProperty('host_agent_id');
    expect(newer.run([...finish, '--agent', 'codex', '--model', 'gpt-6-astra'], { CODEX_THREAD_ID: 'later-thread', GSTACK_EXTEND_WORKSPACE_OWNER: 'later-owner' }).status).toBe(0);
    expect(lines()).toEqual([JSON.stringify(saved)]);
    expect(handoffs(fix)).toHaveLength(0);

    // A null producer cached before the installation was repaired stays null.
    const broken = copiedInstall(fix, 'install-broken', '0.41\n');
    const cached = failFirstAppend(broken);
    expect(cached.producer_version).toBeNull();
    writeFileSync(broken.versionFile, '0.41.0.1\n');
    expect(broken.run(finish).status).toBe(0);
    expect(lines().at(-1)).toBe(JSON.stringify(cached));
    expect(validRow(cached)).toBe(true);

    // A v3 row saved before upgrading to v4 is appended byte-for-byte unchanged on retry.
    expect(newer.run(start).status).toBe(0);
    const sidV3 = readHandoff(fix).session_id as string;
    const savedV3 = {
      stage: 'roadmap', agent: 'claude', model: 'claude-opus-5', effort: 'high',
      rung: 0, outcome: 'success', started_at: '2026-09-22T14:50:06Z', duration_s: 42, session_id: sidV3, repo: 'acme/widget',
      branch: 'main', work_item: null, source: 'gstack-extend', route: 'conductor', entrypoint_raw: 'Paseo',
      schema_version: 3, producer_version: '0.43.0.0', agent_source: 'detected', model_source: 'detected', effort_source: 'detected',
      workspace_host: 'paseo', host_agent_id: 'original-agent',
      run_mode: 'user-directed', run_mode_source: 'Paseo',
      questions: 1, user_wait_s: 10, resumes: 0, user_signals_source: 'session-log',
      blocked_reason: null, blocked_reason_source: 'not-blocked',
    };
    rewriteHandoff(fix, { row: savedV3, done: [] });
    expect(newer.run(finish).status).toBe(0);
    expect(lines().at(-1)).toBe(JSON.stringify(savedV3));
    expect(validRow(savedV3)).toBe(true);
    expect(handoffs(fix)).toHaveLength(0);

    // Rows a pre-version writer saved are appended as those legacy rows; no version, producer or source is invented.
    for (const keep of [15, 13]) {
      expect(newer.run(start).status).toBe(0);
      const sid = readHandoff(fix).session_id as string;
      const legacy = Object.fromEntries(Object.entries({ stage: 'roadmap', agent: 'codex', model: 'gpt-5-codex', effort: 'high',
        rung: 0, outcome: 'success', started_at: '2026-09-22T14:50:06Z', duration_s: 42, session_id: sid, repo: 'acme/widget',
        branch: 'main', work_item: null, source: 'gstack-extend', route: 'conductor', entrypoint_raw: null }).slice(0, keep));
      rewriteHandoff(fix, { row: legacy, done: [] });
      expect(newer.run(finish).status).toBe(0);
      expect(lines().at(-1)).toBe(JSON.stringify(legacy));
      expect(validRow(legacy)).toBe(true);
      expect(handoffs(fix)).toHaveLength(0);
    }
  }, 30_000);
});

const BOUND_S = 86400;
const epochNow = () => Math.floor(Date.now() / 1000);
const insideBound = () => epochNow() - BOUND_S + 60;
const outsideBound = () => epochNow() - BOUND_S - 60;

function plantHelpers(dir: string, source: string) {
  mkdirSync(dir, { recursive: true });
  for (const name of ['gstack-config', 'gstack-telemetry-log']) {
    copyFileSync(join(source, name), join(dir, name));
    chmodSync(join(dir, name), 0o755);
  }
  return dir;
}

function relocateHelpers(fix: TelemetryFixture, relativeBin: string) {
  const source = join(fix.home, '.claude/skills/gstack/bin');
  const dir = plantHelpers(join(fix.home, relativeBin), source);
  rmSync(source, { recursive: true });
  return dir;
}

function loggedHelpers(env: Record<string, string>) {
  const r = runHelper({ ...env, ...DEBUG }, ['start', '--skill', 'extend:roadmap']);
  expect(r.status).toBe(0);
  return r.stderr.match(/logger=(\S+) config=(\S+)/)!.slice(1);
}

function handoffPath(fix: TelemetryFixture) {
  const names = handoffs(fix);
  expect(names).toHaveLength(1);
  return join(fix.home, '.gstack-extend/telemetry', names[0]);
}

function readHandoff(fix: TelemetryFixture) {
  return JSON.parse(readFileSync(handoffPath(fix), 'utf8')) as Record<string, unknown>;
}

/** A per-invocation handoff lives under the name its own session id hashes to; any other name is not a candidate. */
function handoffName(sessionId: string) {
  return createHash('sha256').update(sessionId).digest('hex') + '.json';
}

function rewriteHandoffAt(file: string, patch: Record<string, unknown>) {
  const next = { ...JSON.parse(readFileSync(file, 'utf8')), ...patch };
  const perInvocation = /^[0-9a-f]{64}$/.test(basename(dirname(file)));
  const target = perInvocation && typeof next.session_id === 'string' ? join(dirname(file), handoffName(next.session_id)) : file;
  writeFileSync(target, JSON.stringify(next));
  if (target !== file) rmSync(file);
  return target;
}

function rewriteHandoff(fix: TelemetryFixture, patch: Record<string, unknown>) {
  return rewriteHandoffAt(handoffPath(fix), patch);
}

/** Replace the one open handoff with a single-slot file as the previous release wrote it (no skill/root/harness needed). */
function plantLegacy(fix: TelemetryFixture, state: Record<string, unknown>) {
  const file = handoffPath(fix);
  const legacy = join(dirname(dirname(file)), basename(dirname(file)) + '.json');
  rmSync(file);
  writeFileSync(legacy, JSON.stringify(state));
  return legacy;
}

function skillRuns(fix: TelemetryFixture) {
  return fix.readJsonl().filter(row => row.event_type === 'skill_run');
}

function expectNoExceptionSkip(stderr: string) {
  expect(stderr).not.toContain('Traceback');
  expect(stderr).not.toMatch(/telemetry skipped: [A-Za-z]+(?:Error|Exception):/);
}

function refusalLines(stderr: string) {
  return stderr.split('\n').filter(line => line.includes('missing or malformed start/session state'));
}

function expectRefusal(stderr: string, reason: string) {
  const lines = refusalLines(stderr);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain(reason);
  expect(lines[0]).toContain('root=');
  expect(lines[0]).toContain('handoff=');
  expect(stderr).toContain('GE_TELEMETRY');
}

function sessionFingerprint(pairs: Array<[string, string]>) {
  const sorted = [...pairs].sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0);
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

function gitRepo(fix: TelemetryFixture, name: string) {
  const cwd = join(fix.home, name);
  mkdirSync(cwd, { recursive: true });
  expect(spawnSync('git', ['init', '-q', cwd], { env: fix.env }).status).toBe(0);
  return cwd;
}

describe('gstack helper roots', () => {
  test('helpers under each host root pair, and closer roots win', () => {
    for (const relativeBin of ['.codex/skills/gstack/bin', '.config/opencode/skills/gstack/bin', '.cursor/skills/gstack/bin']) {
      const fix = makeTelemetryFixture('community', 'stub');
      relocateHelpers(fix, relativeBin);
      expect(runHelper(fix.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
      expect(runHelper(fix.env, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
      const rows = fix.readJsonl();
      expect(rows.map(row => row.event_type)).toEqual(['skill_start', 'skill_run']);
      expect(rows[1].session_id).toBe(rows[0].session_id);
    }

    const ranked = makeTelemetryFixture('community', 'stub');
    const source = join(ranked.home, '.claude/skills/gstack/bin');
    const codex = plantHelpers(join(ranked.home, '.codex/skills/gstack/bin'), source);
    const opencode = plantHelpers(join(ranked.home, '.config/opencode/skills/gstack/bin'), source);
    const cursor = plantHelpers(join(ranked.home, '.cursor/skills/gstack/bin'), source);
    rmSync(source, { recursive: true });
    expect(loggedHelpers(ranked.env)).toEqual([join(codex, 'gstack-telemetry-log'), join(codex, 'gstack-config')]);
    rmSync(codex, { recursive: true });
    expect(loggedHelpers(ranked.env)).toEqual([join(opencode, 'gstack-telemetry-log'), join(opencode, 'gstack-config')]);
    rmSync(opencode, { recursive: true });
    expect(loggedHelpers(ranked.env)).toEqual([join(cursor, 'gstack-telemetry-log'), join(cursor, 'gstack-config')]);

    const claude = makeTelemetryFixture('community', 'stub');
    const claudeBin = join(claude.home, '.claude/skills/gstack/bin');
    plantHelpers(join(claude.home, '.codex/skills/gstack/bin'), claudeBin);
    expect(loggedHelpers(claude.env)).toEqual([join(claudeBin, 'gstack-telemetry-log'), join(claudeBin, 'gstack-config')]);
  }, 30_000);

  test('absolute CLAUDE_CONFIG_DIR and CODEX_HOME resolve; relative values are ignored', () => {
    const claude = makeTelemetryFixture('community', 'stub');
    const source = join(claude.home, '.claude/skills/gstack/bin');
    const custom = plantHelpers(join(claude.home, 'custom-claude/skills/gstack/bin'), source);
    expect(loggedHelpers({ ...claude.env, CLAUDE_CONFIG_DIR: join(claude.home, 'custom-claude') }))
      .toEqual([join(custom, 'gstack-telemetry-log'), join(custom, 'gstack-config')]);
    const ran = join(claude.home, 'relative-config-ran');
    const hostile = join(claude.home, 'rel-claude/skills/gstack/bin');
    mkdirSync(hostile, { recursive: true });
    for (const name of ['gstack-config', 'gstack-telemetry-log']) {
      writeFileSync(join(hostile, name), `#!/bin/sh\n: > "${ran}"\necho community\n`);
      chmodSync(join(hostile, name), 0o755);
    }
    const relativeClaude = spawnSync(HELPER_BIN, ['start', '--skill', 'extend:roadmap'], {
      env: { ...claude.env, ...DEBUG, CLAUDE_CONFIG_DIR: 'rel-claude' }, cwd: claude.home,
      encoding: 'utf8', timeout: 10_000,
    });
    expect(relativeClaude.status).toBe(0);
    expect(relativeClaude.stderr.match(/logger=(\S+) config=(\S+)/)?.slice(1))
      .toEqual([join(source, 'gstack-telemetry-log'), join(source, 'gstack-config')]);
    expect(existsSync(ran)).toBe(false);

    const codex = makeTelemetryFixture('community', 'stub');
    const codexSource = join(codex.home, '.claude/skills/gstack/bin');
    const customCodex = plantHelpers(join(codex.home, 'custom-codex/skills/gstack/bin'), codexSource);
    rmSync(codexSource, { recursive: true });
    expect(loggedHelpers({ ...codex.env, CODEX_HOME: join(codex.home, 'custom-codex') }))
      .toEqual([join(customCodex, 'gstack-telemetry-log'), join(customCodex, 'gstack-config')]);

    const fallback = makeTelemetryFixture('community', 'stub');
    const homeCodex = relocateHelpers(fallback, '.codex/skills/gstack/bin');
    const planted = join(fallback.home, 'work');
    mkdirSync(join(planted, 'rel-codex/skills/gstack/bin'), { recursive: true });
    for (const name of ['gstack-config', 'gstack-telemetry-log']) {
      writeFileSync(join(planted, 'rel-codex/skills/gstack/bin', name), `#!/bin/sh\n: > "${join(fallback.home, 'codex-ran')}"\necho community\n`);
      chmodSync(join(planted, 'rel-codex/skills/gstack/bin', name), 0o755);
    }
    const relative = spawnSync(HELPER_BIN, ['start', '--skill', 'extend:roadmap'], {
      env: { ...fallback.env, ...DEBUG, CODEX_HOME: 'rel-codex' }, cwd: planted, encoding: 'utf8', timeout: 10_000,
    });
    expect(relative.status).toBe(0);
    expect(relative.stderr.match(/logger=(\S+)/)?.[1]).toBe(join(homeCodex, 'gstack-telemetry-log'));
    expect(existsSync(join(fallback.home, 'codex-ran'))).toBe(false);
  }, 30_000);

  test('a debug start with no helpers names the missing helpers and the Codex root', () => {
    const fix = makeTelemetryFixture('community', 'absent');
    const r = runHelper({ ...fix.env, ...DEBUG }, ['start', '--skill', 'extend:roadmap']);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('gstack helper unresolvable:');
    expect(r.stderr).toContain('gstack-telemetry-log');
    expect(r.stderr).toContain('gstack-config');
    expect(r.stderr).toContain(join(fix.home, '.codex/skills/gstack/bin'));
    expect(r.stderr).toContain('PATH (absolute entries)');
    expect(r.stderr).toContain('./setup --host <host>');
  });

  test('a relative GSTACK_EXTEND_STATE_DIR is ignored', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const r = spawnSync(HELPER_BIN, ['start', '--skill', 'extend:roadmap'], {
      env: { ...fix.env, GSTACK_EXTEND_STATE_DIR: 'relative-state' }, cwd: fix.home, encoding: 'utf8', timeout: 10_000,
    });
    expect(r.status).toBe(0);
    expect(existsSync(join(fix.home, 'relative-state'))).toBe(false);
    expect(handoffs(fix)).toHaveLength(1);
  });

  test('provenance opt-out uses the same state root as telemetry for relative overrides', () => {
    const fix = makeTelemetryFixture('off', 'absent');
    const env = { ...fix.env, GSTACK_EXTEND_STATE_DIR: 'relative-state' };
    const config = spawnSync(join(ROOT, 'bin/config'), ['set', 'provenance', 'false'], {
      env, cwd: fix.home, encoding: 'utf8', timeout: 10_000,
    });
    expect(config.status).toBe(0);
    for (const command of ['start', 'finish']) {
      expect(spawnSync(HELPER_BIN, [command, '--skill', 'extend:roadmap'], {
        env, cwd: fix.home, encoding: 'utf8', timeout: 10_000,
      }).status).toBe(0);
    }
    expect(fix.readLedger()).toHaveLength(0);
    expect(fix.readJsonl()).toHaveLength(0);
    expect(handoffs(fix)).toHaveLength(0);
    expect(existsSync(join(fix.home, 'relative-state'))).toBe(false);
    expect(readFileSync(join(fix.home, '.gstack-extend/config'), 'utf8')).toContain('provenance=false');
  });

  test('other config keys preserve relative state roots used by quota', () => {
    const fix = makeTelemetryFixture('off', 'absent');
    const env = { ...fix.env, GSTACK_EXTEND_STATE_DIR: 'relative-state' };
    const config = spawnSync(join(ROOT, 'bin/config'), ['set', 'quota', 'off'], {
      env, cwd: fix.home, encoding: 'utf8', timeout: 10_000,
    });
    expect(config.status).toBe(0);
    const consumer = spawnSync('python3', ['-I', '-c',
      `import sys; sys.path.insert(0, ${JSON.stringify(join(ROOT, 'bin/lib'))}); from quota.common import state_root, config_enabled; print(config_enabled(state_root(), 'quota'))`,
    ], { env, cwd: fix.home, encoding: 'utf8', timeout: 10_000 });
    expect(consumer.status).toBe(0);
    expect(consumer.stdout.trim()).toBe('False');
    expect(readFileSync(join(fix.home, 'relative-state/config'), 'utf8')).toContain('quota=off');
    expect(existsSync(join(fix.home, '.gstack-extend/config'))).toBe(false);
  });

  test('missing-helper diagnostics quote searched paths containing newlines', () => {
    const fix = makeTelemetryFixture('community', 'absent');
    const root = join(fix.home, 'config\nroot');
    const r = runHelper({ ...fix.env, ...DEBUG, CODEX_HOME: root }, ['start', '--skill', 'extend:roadmap']);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain(root);
    expect(r.stderr).toContain(JSON.stringify(join(root, 'skills/gstack/bin')));
    expect(r.stderr.split('\n').filter(line => line.includes('gstack helper unresolvable:'))).toHaveLength(1);
  });

  test('a helper appearing during lookup never discards local provenance', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const script = `import sys\nsys.path.insert(0, ${JSON.stringify(join(ROOT, 'bin/lib'))})\nimport telemetry\noriginal = telemetry.resolve\nlookups = 0\ndef changing(name):\n    global lookups\n    if name == "gstack-config":\n        lookups += 1\n        if lookups == 1:\n            return None\n    return original(name)\ntelemetry.resolve = changing\ntelemetry.main([sys.argv[1], "--skill", "extend:roadmap"])\n`;
    for (const command of ['start', 'finish']) {
      const result = spawnSync('python3', ['-I', '-c', script, command], {
        env: { ...fix.env, ...DEBUG }, cwd: ROOT, encoding: 'utf8', timeout: 10_000,
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toContain('gstack helper unresolvable: gstack-config');
      expect(result.stderr).not.toContain('Traceback');
    }
    expect(fix.readLedger()).toHaveLength(1);
    expect(fix.readJsonl()).toHaveLength(0);
    expect(handoffs(fix)).toHaveLength(0);
  });

  test('a logger resolved directly under slash finishes without losing handoff progress', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    expect(runHelper(fix.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    const script = `import sys\nsys.path.insert(0, ${JSON.stringify(join(ROOT, 'bin/lib'))})\nimport telemetry\noriginal = telemetry.os.path.realpath\nlogger = telemetry.resolve("gstack-telemetry-log")\ntelemetry.os.path.realpath = lambda path: "/gstack-telemetry-log" if path == logger else original(path)\ntelemetry.main(["finish", "--skill", "extend:roadmap"])\n`;
    const result = spawnSync('python3', ['-I', '-c', script], {
      env: fix.env, cwd: ROOT, encoding: 'utf8', timeout: 10_000,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('Traceback');
    expect(fix.readLedger()).toHaveLength(1);
    expect(fix.readJsonl().filter(row => row.event_type === 'skill_run')).toHaveLength(1);
    expect(handoffs(fix)).toHaveLength(0);
  });

  test('an unset GSTACK_DIR makes the logger see its real checkout; an explicit value is passed through', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const logger = join(fix.home, '.claude/skills/gstack/bin/gstack-telemetry-log');
    const record = (file: string) => `#!/usr/bin/env python3\n# --no-sweep\nimport os\nfrom pathlib import Path\nPath.home().joinpath(${JSON.stringify(file)}).write_text(os.environ.get("GSTACK_DIR", ""))\n`;
    writeFileSync(logger, record('gstack-dir-seen'));
    chmodSync(logger, 0o755);
    expect(runHelper(fix.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    expect(runHelper(fix.env, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    expect(readFileSync(join(fix.home, 'gstack-dir-seen'), 'utf8')).toBe(dirname(dirname(realpathSync(logger))));

    const explicit = makeTelemetryFixture('community', 'stub');
    const pathBin = join(explicit.home, 'path-bin');
    mkdirSync(pathBin);
    copyFileSync(join(explicit.home, '.claude/skills/gstack/bin/gstack-config'), join(pathBin, 'gstack-config'));
    chmodSync(join(pathBin, 'gstack-config'), 0o755);
    writeFileSync(join(pathBin, 'gstack-telemetry-log'), record('gstack-dir-explicit'));
    chmodSync(join(pathBin, 'gstack-telemetry-log'), 0o755);
    const checkout = join(explicit.home, 'explicit-gstack');
    mkdirSync(checkout);
    const env = { ...explicit.env, PATH: pathBin + ':' + explicit.env.PATH, GSTACK_DIR: checkout };
    expect(runHelper(env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    expect(runHelper(env, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    expect(readFileSync(join(explicit.home, 'gstack-dir-explicit'), 'utf8')).toBe(checkout);
  }, 30_000);

  test('duplicate GSTACK_DIR and Claude helper roots are searched once', () => {
    const fix = makeTelemetryFixture('community', 'absent');
    const gstack = join(fix.home, '.claude/skills/gstack');
    const bin = join(gstack, 'bin');
    mkdirSync(bin, { recursive: true });
    const r = runHelper({ ...fix.env, ...DEBUG, GSTACK_DIR: gstack }, ['start', '--skill', 'extend:roadmap']);
    expect(r.status).toBe(0);
    const line = r.stderr.split('\n').find(item => item.includes('gstack helper unresolvable:'));
    expect(line).toBeDefined();
    expect(line!.split(JSON.stringify(bin)).length - 1).toBe(1);
  });

  test('GSTACK_DIR outranks CLAUDE_CONFIG_DIR, Claude outranks CODEX_HOME, and CODEX_HOME outranks .codex', () => {
    const gstack = makeTelemetryFixture('community', 'stub');
    const gstackSource = join(gstack.home, '.claude/skills/gstack/bin');
    const viaGstack = plantHelpers(join(gstack.home, 'gstack-checkout/bin'), gstackSource);
    plantHelpers(join(gstack.home, 'claude-config/skills/gstack/bin'), gstackSource);
    expect(loggedHelpers({
      ...gstack.env,
      GSTACK_DIR: join(gstack.home, 'gstack-checkout'),
      CLAUDE_CONFIG_DIR: join(gstack.home, 'claude-config'),
    })).toEqual([join(viaGstack, 'gstack-telemetry-log'), join(viaGstack, 'gstack-config')]);

    const claude = makeTelemetryFixture('community', 'stub');
    const claudeBin = join(claude.home, '.claude/skills/gstack/bin');
    plantHelpers(join(claude.home, 'codex-home/skills/gstack/bin'), claudeBin);
    expect(loggedHelpers({ ...claude.env, CODEX_HOME: join(claude.home, 'codex-home') }))
      .toEqual([join(claudeBin, 'gstack-telemetry-log'), join(claudeBin, 'gstack-config')]);

    const codex = makeTelemetryFixture('community', 'stub');
    const codexSource = join(codex.home, '.claude/skills/gstack/bin');
    plantHelpers(join(codex.home, '.codex/skills/gstack/bin'), codexSource);
    const viaCodexHome = plantHelpers(join(codex.home, 'custom-codex/skills/gstack/bin'), codexSource);
    rmSync(codexSource, { recursive: true });
    expect(loggedHelpers({ ...codex.env, CODEX_HOME: join(codex.home, 'custom-codex') }))
      .toEqual([join(viaCodexHome, 'gstack-telemetry-log'), join(viaCodexHome, 'gstack-config')]);
  }, 30_000);

  test('absolute GSTACK_EXTEND_STATE_DIR stores provenance config on that directory', () => {
    const fix = makeTelemetryFixture('off', 'absent');
    const abs = join(fix.home, 'absolute-state');
    const env = { ...fix.env, GSTACK_EXTEND_STATE_DIR: abs };
    const set = spawnSync(join(ROOT, 'bin/config'), ['set', 'provenance', 'false'], {
      env, encoding: 'utf8', timeout: 10_000,
    });
    expect(set.status).toBe(0);
    expect(readFileSync(join(abs, 'config'), 'utf8')).toContain('provenance=false');
    expect(existsSync(join(fix.home, '.gstack-extend/config'))).toBe(false);
    const get = spawnSync(join(ROOT, 'bin/config'), ['get', 'provenance'], {
      env, encoding: 'utf8', timeout: 10_000,
    });
    expect(get.status).toBe(0);
    expect(get.stdout.trim()).toBe('false');
  });
});

describe('handoff adoption', () => {
  test('start records skill, root and a harness fingerprint, and traces marker names only', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const secret = 'secret-thread-value';
    const traced = runHelper({ ...fix.env, ...DEBUG, CODEX_THREAD_ID: secret }, ['start', '--skill', 'extend:roadmap']);
    expect(traced.stderr).toContain('harness markers: CODEX_THREAD_ID');
    expect(traced.stderr).not.toContain(secret);
    const handoff = readHandoff(fix);
    expect(handoff.skill).toBe('extend:roadmap');
    expect(handoff.root).toBe(process.cwd());
    expect(handoff.harness).toBe(sessionFingerprint([['CODEX_THREAD_ID', secret]]));
    expect(sessionFingerprint([['CODEX_THREAD_ID', 'same-id']])).not.toBe(sessionFingerprint([['CURSOR_CONVERSATION_ID', 'same-id']]));

    const quiet = makeTelemetryFixture('community', 'stub');
    const none = runHelper({ ...quiet.env, ...DEBUG }, ['start', '--skill', 'extend:roadmap']);
    expect(readHandoff(quiet).harness).toBeNull();
    expect(none.stderr).toContain('harness markers: none');

    const grok = makeTelemetryFixture('community', 'stub');
    runHelper({ ...grok.env, GROK_SESSION_ID: 'grok-session-1' }, ['start', '--skill', 'extend:roadmap']);
    expect(readHandoff(grok).harness).toBeNull();
    const counted = makeTelemetryFixture('community', 'stub');
    runHelper({ ...counted.env, GROK_AGENT: '1', GROK_SESSION_ID: 'grok-session-1' }, ['start', '--skill', 'extend:roadmap']);
    expect(readHandoff(counted).harness).toBe(sessionFingerprint([['GROK_SESSION_ID', 'grok-session-1']]));
  });

  test('--help names the adoption rule', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const help = runHelper(fix.env, ['--help']);
    expect(help.stdout).toContain('24 hours');
    expect(help.stdout).toContain('never reads another root');
    expect(help.stdout).toContain('full-review');
    expect(help.stdout).toContain('--start alone does not bypass adoption');
  });

  test('a finish from a different repository root writes nothing', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const origin = gitRepo(fix, 'root-a');
    const other = gitRepo(fix, 'root-b');
    expect(spawnSync(HELPER_BIN, ['start', '--skill', 'extend:roadmap'], { env: fix.env, cwd: origin, encoding: 'utf8' }).status).toBe(0);
    const before = readFileSync(handoffPath(fix));
    const finish = spawnSync(HELPER_BIN, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success'], {
      env: { ...fix.env, ...DEBUG }, cwd: other, encoding: 'utf8', timeout: 10_000,
    });
    expect(finish.status).toBe(0);
    expectRefusal(finish.stderr, 'no handoff for this repository root');
    expect(finish.stderr).toContain('start never ran in this root');
    expect(skillRuns(fix)).toHaveLength(0);
    expect(readFileSync(handoffPath(fix))).toEqual(before);
  });

  test('a cross-root finish into an occupied destination slot is judged by the rule', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const origin = gitRepo(fix, 'origin-root');
    const destination = gitRepo(fix, 'destination-root');
    expect(spawnSync(HELPER_BIN, ['start', '--skill', 'extend:roadmap'], {
      env: { ...fix.env, CODEX_THREAD_ID: 'thread-origin' }, cwd: origin, encoding: 'utf8',
    }).status).toBe(0);
    const originBytes = readFileSync(handoffPath(fix));
    expect(spawnSync(HELPER_BIN, ['start', '--skill', 'extend:roadmap'], {
      env: { ...fix.env, CODEX_THREAD_ID: 'thread-destination' }, cwd: destination, encoding: 'utf8',
    }).status).toBe(0);
    const refused = spawnSync(HELPER_BIN, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success'], {
      env: { ...fix.env, ...DEBUG, CODEX_THREAD_ID: 'thread-origin' }, cwd: destination, encoding: 'utf8', timeout: 10_000,
    });
    expectRefusal(refused.stderr, 'handoff from another session');
    expect(skillRuns(fix)).toHaveLength(0);
    expect(handoffs(fix)).toHaveLength(2);

    const destinationFile = handoffs(fix).map(name => join(fix.home, '.gstack-extend/telemetry', name))
      .find(file => !readFileSync(file).equals(originBytes))!;
    const destinationState = JSON.parse(readFileSync(destinationFile, 'utf8'));
    rewriteHandoffAt(destinationFile, { ...destinationState, harness: null, start: String(insideBound()), session_id: 'dest-unknown' });
    const adopted = spawnSync(HELPER_BIN, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success'], {
      env: { ...fix.env, CODEX_THREAD_ID: 'thread-origin' }, cwd: destination, encoding: 'utf8', timeout: 10_000,
    });
    expect(adopted.status).toBe(0);
    expect(skillRuns(fix).map(row => row.session_id)).toEqual(['dest-unknown']);
    expect(readFileSync(handoffs(fix).map(name => join(fix.home, '.gstack-extend/telemetry', name))[0])).toEqual(originBytes);
  }, 30_000);

  test('non-resumable adoption follows the session and the 24-hour bound', () => {
    const same = makeTelemetryFixture('community', 'stub');
    const sameEnv = { ...same.env, CODEX_THREAD_ID: 'thread-same' };
    expect(runHelper(sameEnv, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    rewriteHandoff(same, { start: String(outsideBound()) });
    expect(runHelper(sameEnv, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    expect(skillRuns(same)).toHaveLength(1);

    const other = makeTelemetryFixture('community', 'stub');
    expect(runHelper({ ...other.env, CODEX_THREAD_ID: 'thread-a' }, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    rewriteHandoff(other, { start: String(epochNow() - 60) });
    const refused = runHelper({ ...other.env, ...DEBUG, CODEX_THREAD_ID: 'thread-b' }, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']);
    expect(refused.status).toBe(0);
    expectRefusal(refused.stderr, 'handoff from another session');
    expect(skillRuns(other)).toHaveLength(0);
    expect(handoffs(other)).toHaveLength(1);

    const attempted = makeTelemetryFixture('community', 'stub');
    expect(runHelper({ ...attempted.env, CODEX_THREAD_ID: 'thread-a' }, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    rewriteHandoff(attempted, { done: ['provenance'] });
    const attemptedFinish = runHelper({ ...attempted.env, ...DEBUG, CODEX_THREAD_ID: 'thread-b' }, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']);
    expectRefusal(attemptedFinish.stderr, 'handoff from another session');
    expect(readHandoff(attempted).done).toEqual(['provenance']);
    expect(attempted.readLedger()).toHaveLength(0);
    expect(skillRuns(attempted)).toHaveLength(0);

    const recent = makeTelemetryFixture('community', 'stub');
    expect(runHelper(recent.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    plantLegacy(recent, { session_id: 'pre-change', start: String(insideBound()) });
    expect(runHelper({ ...recent.env, CODEX_THREAD_ID: 'thread-now' }, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    expect(skillRuns(recent)[0].session_id).toBe('pre-change');

    const unmarked = makeTelemetryFixture('community', 'stub');
    expect(runHelper({ ...unmarked.env, CODEX_THREAD_ID: 'thread-a' }, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    expect(runHelper(unmarked.env, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    expect(skillRuns(unmarked)).toHaveLength(1);

    const stale = makeTelemetryFixture('community', 'stub');
    expect(runHelper(stale.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    rewriteHandoff(stale, { start: String(outsideBound()), harness: null });
    const tooOld = runHelper({ ...stale.env, ...DEBUG }, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']);
    expectRefusal(tooOld.stderr, 'handoff too old');
    expect(tooOld.stderr).toContain('age=');
    expect(tooOld.stderr).toContain('bound=86400');
    expect(skillRuns(stale)).toHaveLength(0);
    expect(handoffs(stale)).toHaveLength(1);

    const future = makeTelemetryFixture('community', 'stub');
    expect(runHelper(future.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    rewriteHandoff(future, { start: String(epochNow() + 50_000), harness: null });
    expect(runHelper(future.env, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    expect(skillRuns(future)[0].duration_s).toBe(0);

    const extra = makeTelemetryFixture('community', 'stub');
    expect(runHelper({ ...extra.env, CODEX_THREAD_ID: 'thread-a' }, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    const extraFinish = runHelper({ ...extra.env, ...DEBUG, CODEX_THREAD_ID: 'thread-a', CURSOR_CONVERSATION_ID: 'conv-b' },
      ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']);
    expectRefusal(extraFinish.stderr, 'handoff from another session');
    expect(skillRuns(extra)).toHaveLength(0);
  }, 30_000);

  test('malformed harness and start stay quiet and follow start-validity order', () => {
    const fresh = makeTelemetryFixture('community', 'stub');
    expect(runHelper(fresh.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    rewriteHandoff(fresh, { harness: 12, start: String(epochNow() - 10) });
    const adopted = runHelper({ ...fresh.env, ...DEBUG }, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']);
    expect(adopted.status).toBe(0);
    expectNoExceptionSkip(adopted.stderr);
    expect(skillRuns(fresh)).toHaveLength(1);

    const aged = makeTelemetryFixture('community', 'stub');
    expect(runHelper(aged.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    rewriteHandoff(aged, { harness: true, start: String(outsideBound()) });
    const refused = runHelper({ ...aged.env, ...DEBUG }, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']);
    expect(refused.status).toBe(0);
    expectNoExceptionSkip(refused.stderr);
    expectRefusal(refused.stderr, 'handoff too old');
    expect(skillRuns(aged)).toHaveLength(0);

    const badStart = makeTelemetryFixture('community', 'stub');
    expect(runHelper(badStart.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    rewriteHandoff(badStart, { start: true });
    const malformed = runHelper({ ...badStart.env, ...DEBUG }, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']);
    expect(malformed.status).toBe(0);
    expectNoExceptionSkip(malformed.stderr);
    expect(malformed.stderr).toContain('missing or malformed start/session state');
    expect(malformed.stderr).not.toContain('handoff too old');
    expect(malformed.stderr).not.toContain('root=');
    expect(skillRuns(badStart)).toHaveLength(0);
    expect(badStart.readLedger()).toHaveLength(0);

    const numeric = makeTelemetryFixture('community', 'stub');
    expect(runHelper(numeric.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    rewriteHandoff(numeric, { start: String(epochNow() - 25), harness: null });
    expect(runHelper(numeric.env, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    expect(skillRuns(numeric)[0].duration_s).toBeGreaterThanOrEqual(25);
  }, 30_000);

  test('explicit --start without --session-id does not bypass a refusable handoff', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    expect(runHelper({ ...fix.env, CODEX_THREAD_ID: 'thread-a' }, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    const r = runHelper({ ...fix.env, ...DEBUG, CODEX_THREAD_ID: 'thread-b' },
      ['finish', '--skill', 'extend:roadmap', '--start', String(epochNow() - 5), '--outcome', 'success']);
    expectRefusal(r.stderr, 'handoff from another session');
    expect(skillRuns(fix)).toHaveLength(0);
    expect(handoffs(fix)).toHaveLength(1);
  });

  test('a legacy duration finish with an implicit session follows the rule', () => {
    const refused = makeTelemetryFixture('community', 'stub');
    expect(runHelper({ ...refused.env, CODEX_THREAD_ID: 'thread-a' }, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    const blocked = runHelper({ ...refused.env, CODEX_THREAD_ID: 'thread-b' },
      ['--skill', 'extend:roadmap', '--duration', '42', '--outcome', 'success']);
    expect(blocked.status).toBe(0);
    expect(skillRuns(refused)).toHaveLength(0);
    expect(handoffs(refused)).toHaveLength(1);

    const adopted = makeTelemetryFixture('community', 'stub');
    expect(runHelper({ ...adopted.env, CODEX_THREAD_ID: 'thread-a' }, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    expect(runHelper({ ...adopted.env, CODEX_THREAD_ID: 'thread-a' },
      ['--skill', 'extend:roadmap', '--duration', '42', '--outcome', 'success']).status).toBe(0);
    expect(skillRuns(adopted)[0].duration_s).toBe(42);
  });

  test('a refused handoff keeps its keys and gains one capped refusals entry', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    expect(runHelper({ ...fix.env, CODEX_THREAD_ID: 'thread-a' }, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    const before = readHandoff(fix);
    const refused = runHelper({ ...fix.env, ...DEBUG, CODEX_THREAD_ID: 'thread-b' }, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']);
    expectRefusal(refused.stderr, 'handoff from another session');
    const after = readHandoff(fix);
    for (const key of Object.keys(before)) expect(after[key]).toEqual(before[key]);
    expect(after.refusals).toEqual([expect.objectContaining({ reason: 'handoff from another session' })]);
    expect(typeof (after.refusals as Array<{ at: number }>)[0].at).toBe('number');
    expect(fix.readLedger()).toHaveLength(0);
    expect(skillRuns(fix)).toHaveLength(0);
    for (let attempt = 0; attempt < 11; attempt += 1) {
      expect(runHelper({ ...fix.env, CODEX_THREAD_ID: 'thread-b' }, ['finish', '--skill', 'extend:roadmap']).status).toBe(0);
    }
    expect((readHandoff(fix).refusals as unknown[])).toHaveLength(10);
  }, 30_000); // thirteen sequential helper runs: slow on a loaded machine

  test('a failed refusal write preserves the handoff and still explains the refusal', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    expect(runHelper({ ...fix.env, CODEX_THREAD_ID: 'thread-a' }, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    const file = handoffPath(fix);
    const before = readFileSync(file, 'utf8');
    // Inject the write error at save_state; chmod is ineffective for root test runners.
    const script = `import sys\nsys.path.insert(0, ${JSON.stringify(join(ROOT, 'bin/lib'))})\nimport telemetry\ndef fail(*args):\n    raise OSError("fixture refusal write denied")\ntelemetry.save_state = fail\ntelemetry.main(["finish", "--skill", "extend:roadmap"])\n`;
    const refused = spawnSync('python3', ['-I', '-c', script], {
      env: { ...fix.env, ...DEBUG, CODEX_THREAD_ID: 'thread-b' }, encoding: 'utf8', timeout: 10_000,
    });
    expect(refused.status).toBe(0);
    expectRefusal(refused.stderr, 'handoff from another session');
    expectNoExceptionSkip(refused.stderr);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(fix.readLedger()).toHaveLength(0);
    expect(skillRuns(fix)).toHaveLength(0);
    expect(runHelper({ ...fix.env, CODEX_THREAD_ID: 'thread-a' }, ['finish', '--skill', 'extend:roadmap']).status).toBe(0);
    expect(fix.readLedger()).toHaveLength(1);
    expect(skillRuns(fix)).toHaveLength(1);
    expect(handoffs(fix)).toHaveLength(0);
  });

  test('an existing malformed handoff keeps the generic diagnostic', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    expect(runHelper(fix.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    const file = handoffPath(fix);
    for (const content of ['garbage{{', '[]', '"string"', '', '{}']) {
      writeFileSync(file, content);
      const r = runHelper({ ...fix.env, ...DEBUG }, ['finish', '--skill', 'extend:roadmap']);
      expect(r.status).toBe(0);
      expect(refusalLines(r.stderr)).toHaveLength(1);
      expect(r.stderr).not.toContain('no handoff for this repository root');
      expect(r.stderr).not.toContain('root=');
      expectNoExceptionSkip(r.stderr);
      expect(fix.readLedger()).toHaveLength(0);
      expect(skillRuns(fix)).toHaveLength(0);
    }
  });

  test('a fingerprinted same-root collision pairs each session with its own start; a third session is refused', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const repo = gitRepo(fix, 'one-checkout');
    const as = (thread: string, args: string[], extra: Record<string, string> = {}) => spawnSync(HELPER_BIN, args, {
      env: { ...fix.env, CODEX_THREAD_ID: thread, ...extra }, cwd: repo, encoding: 'utf8', timeout: 10_000,
    });
    const first = as('thread-a', ['start', '--skill', 'extend:roadmap']);
    const second = as('thread-b', ['start', '--skill', 'extend:roadmap']);
    const firstSid = first.stdout.match(/session=(\S+)/)?.[1];
    const secondSid = second.stdout.match(/session=(\S+)/)?.[1];
    expect(firstSid).not.toBe(secondSid);
    expect(handoffs(fix)).toHaveLength(2);
    // The old single slot lost the earlier start; a third session's finish is refused and both handoffs stay.
    const third = as('thread-c', ['finish', '--skill', 'extend:roadmap', '--outcome', 'error'], DEBUG);
    expect(third.status).toBe(0);
    expectRefusal(third.stderr, 'handoff from another session');
    expect(third.stderr).toContain('candidates=2');
    expect(skillRuns(fix)).toHaveLength(0);
    expect(handoffs(fix)).toHaveLength(2);
    // Each session's finish pairs its own start, whichever finishes first.
    expect(as('thread-b', ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    expect(skillRuns(fix).map(row => row.session_id)).toEqual([secondSid]);
    expect(handoffs(fix)).toHaveLength(1);
    expect(as('thread-a', ['finish', '--skill', 'extend:roadmap', '--outcome', 'error']).status).toBe(0);
    expect(skillRuns(fix).map(row => [row.session_id, row.outcome])).toEqual([[secondSid, 'success'], [firstSid, 'error']]);
    expect(fix.readLedger().map(row => [row.session_id, row.outcome])).toEqual([[secondSid, 'success'], [firstSid, 'error']]);
    expect(handoffs(fix)).toHaveLength(0);
  }, 30_000);

  test('a root containing a newline keeps the refusal on one quoted line', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const cwd = join(fix.home, 'repo\nname');
    mkdirSync(cwd);
    expect(spawnSync('git', ['init', '-q', cwd], { env: fix.env }).status).toBe(0);
    const r = spawnSync(HELPER_BIN, ['finish', '--skill', 'extend:roadmap'], {
      env: { ...fix.env, ...DEBUG }, cwd, encoding: 'utf8', timeout: 10_000,
    });
    expect(r.status).toBe(0);
    const lines = refusalLines(r.stderr);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('no handoff for this repository root');
    expect(lines[0]).toContain('\\n');
    expect(lines[0]).toMatch(/root=".*\\n.*"/);
    expect(lines[0]).toMatch(/handoff=".*"/);
  });

  test('a resumable skill adopts another session 30 days later', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    expect(runHelper({ ...fix.env, CODEX_THREAD_ID: 'thread-a' }, ['start', '--skill', 'extend:pair-review']).status).toBe(0);
    rewriteHandoff(fix, { start: String(epochNow() - 30 * BOUND_S) });
    expect(runHelper({ ...fix.env, CODEX_THREAD_ID: 'thread-b' }, ['finish', '--skill', 'extend:pair-review', '--outcome', 'success']).status).toBe(0);
    expect(skillRuns(fix)).toHaveLength(1);
  });

  test('an explicit session id still supplies start from another session older than 24 hours', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const started = runHelper({ ...fix.env, CODEX_THREAD_ID: 'thread-a' }, ['start', '--skill', 'extend:roadmap']);
    const sid = started.stdout.match(/session=(\S+)/)?.[1];
    rewriteHandoff(fix, { start: String(outsideBound()) });
    expect(runHelper({ ...fix.env, CODEX_THREAD_ID: 'thread-b' },
      ['finish', '--skill', 'extend:roadmap', '--session-id', sid!, '--outcome', 'success']).status).toBe(0);
    expect(fix.readLedger()[0]).toMatchObject({ session_id: sid });
    expect(fix.readLedger()[0].duration_s).toBeGreaterThan(BOUND_S);
    expect(skillRuns(fix)).toHaveLength(1);
  });

  test('tier turned off before finish consumes the handoff and leaves that skill_start unpaired', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    expect(runHelper(fix.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    writeFileSync(join(fix.home, '.gstack/config.yaml'), 'telemetry: off\n');
    expect(runHelper(fix.env, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    expect(fix.readJsonl().map(row => row.event_type)).toEqual(['skill_start']);
    expect(handoffs(fix)).toHaveLength(0);
    expect(fix.readLedger()).toHaveLength(1);
  });

  test('an unknown-fingerprint handoff within 24 hours is adopted and a join is not proof', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    expect(runHelper(fix.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    plantLegacy(fix, { session_id: 'pre-change', start: String(insideBound()) });
    expect(runHelper(fix.env, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    expect(skillRuns(fix)[0].session_id).toBe('pre-change');
    expect(fix.readLedger()[0].session_id).toBe('pre-change');
  });

  test('exact 86400 second non-resumable handoff is adopted and 86401 seconds is refused', () => {
    // The inclusive bound is judged with a fixed clock. A live finish cannot hit age 86400
    // exactly, because time.time() runs after the process starts.
    const now = 1_700_000_000;
    const script = `import sys\nsys.path.insert(0, ${JSON.stringify(join(ROOT, 'bin/lib'))})\nimport telemetry\nnow = ${now}\nadopt = telemetry.consider_adoption({"start": now - 86400, "harness": None}, "extend:roadmap", now, None)\nrefuse = telemetry.consider_adoption({"start": str(now - 86401), "harness": ""}, "extend:roadmap", now, None)\nprint(adopt[0], adopt[1], refuse[0])\n`;
    const judged = spawnSync('python3', ['-I', '-c', script], { encoding: 'utf8', timeout: 10_000 });
    expect(judged.status).toBe(0);
    expect(judged.stderr).not.toContain('Traceback');
    expect(judged.stdout.trim()).toBe(`adopt ${now - BOUND_S} refuse`);

    const refused = makeTelemetryFixture('community', 'stub');
    expect(runHelper(refused.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    rewriteHandoff(refused, { start: String(epochNow() - BOUND_S - 1), harness: null });
    const tooOld = runHelper({ ...refused.env, ...DEBUG }, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']);
    expect(tooOld.status).toBe(0);
    expectRefusal(tooOld.stderr, 'handoff too old');
    expect(skillRuns(refused)).toHaveLength(0);
  }, 30_000);

  test('an empty harness string adopts when recent and refuses when older than 86400 seconds', () => {
    const recent = makeTelemetryFixture('community', 'stub');
    expect(runHelper(recent.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    rewriteHandoff(recent, { harness: '' });
    expect(runHelper(recent.env, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    expect(skillRuns(recent)).toHaveLength(1);

    const aged = makeTelemetryFixture('community', 'stub');
    expect(runHelper(aged.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    rewriteHandoff(aged, { harness: '', start: String(outsideBound()) });
    const tooOld = runHelper({ ...aged.env, ...DEBUG }, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']);
    expect(tooOld.status).toBe(0);
    expectRefusal(tooOld.stderr, 'handoff too old');
    expect(skillRuns(aged)).toHaveLength(0);
  }, 30_000);

  test('a resumable skill rejects a malformed start before the adoption branch', () => {
    for (const start of [true, 'abc']) {
      const fix = makeTelemetryFixture('community', 'stub');
      expect(runHelper(fix.env, ['start', '--skill', 'extend:pair-review']).status).toBe(0);
      rewriteHandoff(fix, { start });
      const r = runHelper({ ...fix.env, ...DEBUG }, ['finish', '--skill', 'extend:pair-review', '--outcome', 'success']);
      expect(r.status).toBe(0);
      expect(r.stderr).toContain('missing or malformed start/session state');
      expect(r.stderr).not.toContain('handoff too old');
      expect(fix.readLedger()).toHaveLength(0);
      expect(skillRuns(fix)).toHaveLength(0);
    }
  }, 30_000);

  test('explicit --start without --session-id dates an adoptable handoff', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    expect(runHelper(fix.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    const original = epochNow() - 400;
    const explicit = epochNow() - 12;
    rewriteHandoff(fix, { start: String(original), harness: null });
    const r = runHelper(fix.env, ['finish', '--skill', 'extend:roadmap', '--start', String(explicit), '--outcome', 'success']);
    expect(r.status).toBe(0);
    const duration = skillRuns(fix)[0].duration_s as number;
    expect(duration).toBeGreaterThanOrEqual(12);
    expect(duration).toBeLessThanOrEqual(40);
    expect(Math.abs(duration - (epochNow() - original))).toBeGreaterThan(200);
  });

  test('a too-old refusal stores the reason handoff too old without age or bound', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    expect(runHelper(fix.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    rewriteHandoff(fix, { start: String(epochNow() - BOUND_S - 1), harness: null });
    const refused = runHelper({ ...fix.env, ...DEBUG }, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']);
    expect(refused.status).toBe(0);
    expect(refused.stderr).toContain('age=');
    expect(refused.stderr).toContain('bound=');
    const reason = (readHandoff(fix).refusals as Array<{ reason: string }>)[0].reason;
    expect(reason).toBe('handoff too old');
    expect(reason.includes('age=')).toBe(false);
    expect(reason.includes('bound=')).toBe(false);
  });

  test('a non-list refusals value is reset to the new refusal dict', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    expect(runHelper({ ...fix.env, CODEX_THREAD_ID: 'thread-a' }, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    rewriteHandoff(fix, { refusals: 'nope' });
    const refused = runHelper({ ...fix.env, ...DEBUG, CODEX_THREAD_ID: 'thread-b' }, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']);
    expectRefusal(refused.stderr, 'handoff from another session');
    const entries = readHandoff(fix).refusals as Array<{ reason: string }>;
    expect(entries).toEqual([expect.objectContaining({ reason: 'handoff from another session' })]);
    expect(entries.every(item => item !== null && typeof item === 'object')).toBe(true);
    expect(JSON.stringify(entries).includes('nope')).toBe(false);
  });

  test('non-dict refusal entries are dropped while dict entries stay', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    expect(runHelper({ ...fix.env, CODEX_THREAD_ID: 'thread-a' }, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    rewriteHandoff(fix, { refusals: [{ reason: 'keep' }, 'drop', 3] });
    expect(runHelper({ ...fix.env, CODEX_THREAD_ID: 'thread-b' }, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    const entries = readHandoff(fix).refusals as Array<{ reason: string }>;
    expect(entries.map(item => item.reason)).toEqual(['keep', 'handoff from another session']);
    expect(entries.every(item => item !== null && typeof item === 'object' && typeof item.reason === 'string')).toBe(true);
  });

  test('the refusal cap drops the oldest planted reason and keeps the newest', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    expect(runHelper({ ...fix.env, CODEX_THREAD_ID: 'thread-a' }, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    rewriteHandoff(fix, {
      refusals: Array.from({ length: 10 }, (_, index) => ({ reason: `reason-${index}`, at: index })),
    });
    expect(runHelper({ ...fix.env, CODEX_THREAD_ID: 'thread-b' }, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    const reasons = (readHandoff(fix).refusals as Array<{ reason: string }>).map(item => item.reason);
    expect(reasons).toHaveLength(10);
    expect(reasons.includes('reason-0')).toBe(false);
    expect(reasons[0]).toBe('reason-1');
    expect(reasons[8]).toBe('reason-9');
    expect(reasons[9]).toBe('handoff from another session');
  });

  test('invalid session markers are omitted and a valid sibling is fingerprinted', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const traced = runHelper({
      ...fix.env,
      ...DEBUG,
      CODEX_THREAD_ID: '-bad',
      CURSOR_CONVERSATION_ID: 'thread-ok',
    }, ['start', '--skill', 'extend:roadmap']);
    expect(traced.status).toBe(0);
    const line = traced.stderr.split('\n').find(item => item.includes('harness markers:'));
    expect(line).toBe('telemetry: harness markers: CURSOR_CONVERSATION_ID');
    expect(traced.stderr.includes('-bad')).toBe(false);
    expect(traced.stderr.includes('thread-ok')).toBe(false);
    expect(readHandoff(fix).harness).toBe(sessionFingerprint([['CURSOR_CONVERSATION_ID', 'thread-ok']]));
  });
});

// ─── Track 23H: one durable handoff per invocation, paired deterministically ───

const telemetryDir = (fix: TelemetryFixture) => join(fix.home, '.gstack-extend/telemetry');
const openHandoffs = (fix: TelemetryFixture) => handoffs(fix).map(name => ({
  name,
  path: join(telemetryDir(fix), name),
  state: JSON.parse(readFileSync(join(telemetryDir(fix), name), 'utf8')) as Record<string, any>,
}));
const startRun = (fix: TelemetryFixture, skill = 'extend:roadmap', env: Record<string, string> = {}) => {
  const result = runHelper({ ...fix.env, ...env }, ['start', '--skill', skill]);
  expect(result.status).toBe(0);
  return result.stdout.match(/session=(\S+)/)![1];
};
const finishRun = (fix: TelemetryFixture, outcome = 'success', skill = 'extend:roadmap', env: Record<string, string> = {}) =>
  runHelper({ ...fix.env, ...env }, ['finish', '--skill', skill, '--outcome', outcome]);
const keyDir = (fix: TelemetryFixture) => {
  const dirs = readdirSync(telemetryDir(fix), { withFileTypes: true }).filter(entry => entry.isDirectory());
  expect(dirs).toHaveLength(1);
  return join(telemetryDir(fix), dirs[0].name);
};
/** Hand-built per-invocation handoff under the name its session id hashes to, beside an existing start's. */
const plantInvocation = (fix: TelemetryFixture, state: Record<string, unknown>) => {
  const file = join(keyDir(fix), handoffName(state.session_id as string));
  writeFileSync(file, JSON.stringify(state));
  return file;
};
const runSessions = (fix: TelemetryFixture) => skillRuns(fix).map(row => row.session_id);
const adoptionLine = (stderr: string) => stderr.split('\n').find(line => line.includes('adopted handoff'));

describe('per-invocation handoffs and pairing', () => {
  // Value: protects=malformed JSON cannot block a different invocation; fails_when=decoder recursion errors escape enumeration;
  // why_new=existing malformed cases stop before the decoder's nesting limit; seam=none;
  // no_claim=installed acceptance (owned synthetic handoff files).
  test('deeply nested malformed handoffs cannot block a new start or a valid finish', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const first = startRun(fix);
    const bad = join(keyDir(fix), handoffName('bad-json'));
    const content = '['.repeat(2000) + '0' + ']'.repeat(2000);
    writeFileSync(bad, content);
    const next = runHelper({ ...fix.env, ...DEBUG }, ['start', '--skill', 'extend:roadmap']);
    expect(next.stdout).toMatch(/^GE_TELEMETRY: session=/);
    expectNoExceptionSkip(next.stderr);
    const second = next.stdout.match(/session=(\S+)/)![1];
    expect(finishRun(fix).status).toBe(0);
    expect(finishRun(fix).status).toBe(0);
    expect(runSessions(fix)).toEqual([first, second]);
    expect(fix.readLedger().map(row => row.session_id)).toEqual([first, second]);
    expect(readFileSync(bad, 'utf8')).toBe(content);
  }, 30_000);

  test('indistinguishable starts pair oldest first, and out-of-order finishes keep that documented limit', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const first = startRun(fix);
    const second = startRun(fix);
    expect(first).not.toBe(second);
    expect(handoffs(fix)).toHaveLength(2);
    // The run that started second finished first, but nothing in the call identifies it: its outcome lands on the
    // oldest open start. This is the bound docs/telemetry.md states; the order is deterministic.
    expect(finishRun(fix, 'error').status).toBe(0);
    expect(fix.readLedger().map(row => [row.session_id, row.outcome])).toEqual([[first, 'error']]);
    expect(finishRun(fix, 'success').status).toBe(0);
    expect(runSessions(fix)).toEqual([first, second]);
    expect(fix.readLedger().map(row => row.session_id)).toEqual([first, second]);
    expect(handoffs(fix)).toHaveLength(0);
  }, 30_000);

  test('starts that share an epoch second pair in arrival order via seq, never by session id', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    startRun(fix);
    const [seed] = openHandoffs(fix);
    rmSync(seed.path);
    const start = String(epochNow() - 10);
    // The arrival order is the reverse of the session ids' sort order, with identical start seconds.
    const arrived = ['sid-z-arrived-first', 'sid-m-arrived-second', 'sid-a-arrived-third'];
    arrived.forEach((session_id, index) => plantInvocation(fix, {
      ...seed.state, session_id, start, seq: String(1_000_000 + index), harness: null,
    }));
    for (let index = 0; index < arrived.length; index += 1) expect(finishRun(fix).status).toBe(0);
    expect(runSessions(fix)).toEqual(arrived);
  }, 30_000);

  test('seq stays monotonic when the wall clock repeats or runs backward', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const script = `import sys
sys.path.insert(0, ${JSON.stringify(join(ROOT, 'bin/lib'))})
import telemetry
telemetry.time.time_ns = lambda: int(sys.argv[1])
telemetry.main(["start", "--skill", "extend:roadmap"])
`;
    const sessions = ['5000', '5000', '100'].map(tick => {
      const run = spawnSync('python3', ['-I', '-c', script, tick], { env: fix.env, encoding: 'utf8', timeout: 10_000 });
      expect(run.status).toBe(0);
      return run.stdout.match(/session=(\S+)/)![1];
    });
    const seqs = new Map(openHandoffs(fix).map(item => [item.state.session_id as string, BigInt(item.state.seq)]));
    expect(sessions.map(session => seqs.get(session))).toEqual([5000n, 5001n, 5002n]);
    for (const session of sessions) expect(finishRun(fix).status).toBe(0);
    expect(runSessions(fix)).toEqual(sessions);
  }, 30_000);

  // Value: protects=resumable exact matches pair newest first before pooled candidates; fails_when=rank zero selects oldest;
  // why_new=one exact candidate could only prove class priority; seam=none;
  // no_claim=live harness attribution (synthetic session markers).
  test('resumable skills pair exact fingerprints first, then everything else newest first', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const skill = 'extend:pair-review';
    const old = startRun(fix, skill, { CODEX_THREAD_ID: 'thread-a' });
    const laterExact = startRun(fix, skill, { CODEX_THREAD_ID: 'thread-a' });
    const middle = startRun(fix, skill);
    const newest = startRun(fix, skill, { CODEX_THREAD_ID: 'thread-b' });
    // A distinct known session and an unknown fingerprint share one pooled subclass: newest first.
    const pooled = finishRun(fix, 'success', skill, { ...DEBUG, CODEX_THREAD_ID: 'thread-c' });
    expect(adoptionLine(pooled.stderr)).toContain(`session=${newest}`);
    expect(adoptionLine(pooled.stderr)).toContain('pairing=resumable (newest)');
    expect(adoptionLine(pooled.stderr)).toContain('candidates=4');
    // An exact fingerprint beats the newer pooled start even though the other start is older.
    const exact = finishRun(fix, 'success', skill, { ...DEBUG, CODEX_THREAD_ID: 'thread-a' });
    expect(adoptionLine(exact.stderr)).toContain(`session=${laterExact}`);
    expect(adoptionLine(exact.stderr)).toContain('pairing=resumable (exact)');
    expect(adoptionLine(exact.stderr)).toContain('candidates=3');
    const secondExact = finishRun(fix, 'error', skill, { ...DEBUG, CODEX_THREAD_ID: 'thread-a' });
    expect(adoptionLine(secondExact.stderr)).toContain(`session=${old}`);
    expect(adoptionLine(secondExact.stderr)).toContain('pairing=resumable (exact)');
    expect(finishRun(fix, 'success', skill).status).toBe(0);
    expect(runSessions(fix)).toEqual([newest, laterExact, old, middle]);
    expect(fix.readLedger().map(row => [row.session_id, row.outcome])).toEqual([
      [newest, 'success'], [laterExact, 'success'], [old, 'error'], [middle, 'success'],
    ]);
    expect(handoffs(fix)).toHaveLength(0);
  }, 30_000);

  test('the adoption debug line names the session, subclass and count, and never a harness marker value', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const mine = startRun(fix, 'extend:roadmap', { CODEX_THREAD_ID: 'secret-thread-value' });
    startRun(fix, 'extend:roadmap', { CODEX_THREAD_ID: 'other-thread-value' });
    const exact = finishRun(fix, 'success', 'extend:roadmap', { ...DEBUG, CODEX_THREAD_ID: 'secret-thread-value' });
    expect(adoptionLine(exact.stderr)).toContain(`session=${mine}`);
    expect(adoptionLine(exact.stderr)).toContain('pairing=exact fingerprint');
    expect(adoptionLine(exact.stderr)).toContain('candidates=2');
    expect(exact.stderr).not.toContain('secret-thread-value');
    expect(exact.stderr).not.toContain('other-thread-value');
    startRun(fix);
    const guess = finishRun(fix, 'success', 'extend:roadmap', DEBUG);
    expect(adoptionLine(guess.stderr)).toContain('pairing=unknown fingerprint');
  }, 30_000);

  test('a too-old unknown-fingerprint candidate is refused while a younger one pairs, and the refusal lands on the newest', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const old = startRun(fix);
    rewriteHandoff(fix, { start: String(outsideBound()), harness: null });
    const young = startRun(fix);
    expect(finishRun(fix).status).toBe(0);
    expect(runSessions(fix)).toEqual([young]);
    const refused = finishRun(fix, 'success', 'extend:roadmap', DEBUG);
    expectRefusal(refused.stderr, 'handoff too old');
    expect(refused.stderr).toContain('candidates=1');
    expect(openHandoffs(fix).map(item => item.state.session_id)).toEqual([old]);
    expect(openHandoffs(fix)[0].state.refusals).toEqual([expect.objectContaining({ reason: 'handoff too old' })]);
  }, 30_000);

  test('a refusal is recorded on the newest valid-start candidate and names that file', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const older = startRun(fix, 'extend:roadmap', { CODEX_THREAD_ID: 'thread-a' });
    const newer = startRun(fix, 'extend:roadmap', { CODEX_THREAD_ID: 'thread-b' });
    const refused = finishRun(fix, 'success', 'extend:roadmap', { ...DEBUG, CODEX_THREAD_ID: 'thread-c' });
    expectRefusal(refused.stderr, 'handoff from another session');
    const byId = new Map(openHandoffs(fix).map(item => [item.state.session_id as string, item]));
    expect(refused.stderr).toContain(handoffName(newer));
    expect(byId.get(newer)!.state.refusals).toHaveLength(1);
    expect(byId.get(older)!.state).not.toHaveProperty('refusals');
  }, 30_000);

  test('an invalid-start candidate is never adopted and never the refusal target', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const valid = startRun(fix, 'extend:roadmap', { CODEX_THREAD_ID: 'thread-a' });
    const [seed] = openHandoffs(fix);
    // Newest by arrival, but without a usable start: it sorts last and cannot take the refusal.
    plantInvocation(fix, { ...seed.state, session_id: 'sid-bad-start', start: 'bogus', seq: '9'.repeat(18) });
    const refused = finishRun(fix, 'success', 'extend:roadmap', { ...DEBUG, CODEX_THREAD_ID: 'thread-c' });
    expectRefusal(refused.stderr, 'handoff from another session');
    expect(refused.stderr).toContain(handoffName(valid));
    const byId = new Map(openHandoffs(fix).map(item => [item.state.session_id as string, item]));
    expect(byId.get(valid)!.state.refusals).toHaveLength(1);
    expect(byId.get('sid-bad-start')!.state).not.toHaveProperty('refusals');
    // With only the invalid-start candidate left, the malformed path holds: no reason, no root, nothing recorded.
    rmSync(byId.get(valid)!.path);
    const malformed = finishRun(fix, 'success', 'extend:roadmap', DEBUG);
    expect(malformed.stderr).toContain('missing or malformed start/session state');
    expect(malformed.stderr).not.toContain('root=');
    expect(skillRuns(fix)).toHaveLength(0);
    expect(openHandoffs(fix)[0].state).not.toHaveProperty('refusals');
  }, 30_000);

  test('an explicit finish for the second start leaves the first handoff untouched and finishable', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    startRun(fix);
    const second = runHelper(fix.env, ['start', '--skill', 'extend:roadmap']);
    const secondSid = second.stdout.match(/session=(\S+)/)![1];
    const secondStart = second.stdout.match(/start=(\S+)/)![1];
    const [firstHandoff] = openHandoffs(fix).filter(item => item.state.session_id !== secondSid);
    const before = readFileSync(firstHandoff.path);
    expect(runHelper(fix.env, ['finish', '--skill', 'extend:roadmap', '--session-id', secondSid, '--start', secondStart,
      '--outcome', 'error']).status).toBe(0);
    expect(runSessions(fix)).toEqual([secondSid]);
    expect(readFileSync(firstHandoff.path)).toEqual(before);
    expect(finishRun(fix).status).toBe(0);
    expect(runSessions(fix)).toEqual([secondSid, firstHandoff.state.session_id]);
    expect(handoffs(fix)).toHaveLength(0);
  }, 30_000);

  test('a legacy single-slot handoff, even one from before skill/root/harness, is adopted and consumed', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    startRun(fix);
    const legacy = plantLegacy(fix, { session_id: 'legacy-slot', start: String(insideBound()) });
    const dir = keyDir(fix);
    // A malformed sibling and a leftover temp file beside it must not block the legacy candidate.
    writeFileSync(join(dir, 'f'.repeat(64) + '.json'), 'garbage{{');
    writeFileSync(join(dir, '.handoff-leftover'), '{}');
    const result = finishRun(fix, 'success', 'extend:roadmap', DEBUG);
    expect(result.status).toBe(0);
    expect(runSessions(fix)).toEqual(['legacy-slot']);
    expect(existsSync(legacy)).toBe(false);
    expect(readFileSync(join(dir, 'f'.repeat(64) + '.json'), 'utf8')).toBe('garbage{{');
    expect(adoptionLine(result.stderr)).toContain('session=legacy-slot');
  }, 30_000);

  test('a new start never replaces a legacy slot, and the older of the two pairs first', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    startRun(fix);
    const legacy = plantLegacy(fix, { session_id: 'legacy-slot', start: String(epochNow() - 60) });
    const fresh = startRun(fix);
    expect(existsSync(legacy)).toBe(true);
    expect(handoffs(fix)).toHaveLength(2);
    expect(finishRun(fix).status).toBe(0);
    expect(finishRun(fix).status).toBe(0);
    expect(runSessions(fix)).toEqual(['legacy-slot', fresh]);
    expect(handoffs(fix)).toHaveLength(0);
  }, 30_000);

  test('a legacy candidate finishing partially is saved to its own file only, then completes without a duplicate', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    startRun(fix);
    const legacy = plantLegacy(fix, { session_id: 'legacy-partial', start: String(epochNow() - 30), usage: true });
    const logger = join(fix.home, '.claude/skills/gstack/bin/gstack-telemetry-log');
    const working = readFileSync(logger, 'utf8');
    writeFileSync(logger, '#!/bin/bash\n' + NO_SWEEP_LINE + 'exit 1\n');
    chmodSync(logger, 0o755);
    expect(finishRun(fix).status).toBe(0);
    expect(fix.readLedger().map(row => row.session_id)).toEqual(['legacy-partial']);
    expect(handoffs(fix)).toEqual([basename(legacy)]);
    expect(JSON.parse(readFileSync(legacy, 'utf8')).done).toEqual(['provenance']);
    expect(readdirSync(keyDir(fix))).toEqual([]);
    writeFileSync(logger, working);
    chmodSync(logger, 0o755);
    expect(finishRun(fix).status).toBe(0);
    expect(fix.readLedger()).toHaveLength(1);
    expect(runSessions(fix)).toEqual(['legacy-partial']);
    expect(handoffs(fix)).toHaveLength(0);
  }, 30_000);

  test('a legacy duplicate of a consumed session is unlinked with it and cannot resurrect the run', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const sid = startRun(fix);
    const [open] = openHandoffs(fix);
    const legacy = join(telemetryDir(fix), basename(dirname(open.path)) + '.json');
    writeFileSync(legacy, JSON.stringify(open.state));
    expect(finishRun(fix).status).toBe(0);
    expect(runSessions(fix)).toEqual([sid]);
    expect(handoffs(fix)).toHaveLength(0);
    expect(finishRun(fix).status).toBe(0);
    expect(runSessions(fix)).toEqual([sid]);
    expect(fix.readLedger()).toHaveLength(1);
  }, 30_000);

  test('enumeration ignores temp files and foreign names, and a copied handoff under a wrong name is not a candidate', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const sid = startRun(fix);
    const [open] = openHandoffs(fix);
    const dir = dirname(open.path);
    const copy = join(dir, 'a'.repeat(64) + '.json');
    writeFileSync(copy, JSON.stringify({ ...open.state, session_id: 'copied-session' }));
    writeFileSync(join(dir, 'notes.json'), JSON.stringify({ ...open.state, session_id: 'foreign-name' }));
    writeFileSync(join(dir, '.handoff-temp'), JSON.stringify({ ...open.state, session_id: 'temp-file' }));
    expect(finishRun(fix).status).toBe(0);
    expect(runSessions(fix)).toEqual([sid]);
    // Only the copy is handoff-shaped but unauthoritative: it stays, and with nothing else left it is malformed.
    expect(existsSync(copy)).toBe(true);
    const again = finishRun(fix, 'success', 'extend:roadmap', DEBUG);
    expect(again.stderr).toContain('missing or malformed start/session state');
    expect(again.stderr).not.toContain('root=');
    expect(runSessions(fix)).toEqual([sid]);
    expect(readdirSync(dir).sort()).toEqual([copy, join(dir, '.handoff-temp'), join(dir, 'notes.json')].map(file => basename(file)).sort());
  }, 30_000);

  test('a file or link in place of the per-key directory is a malformed store: finish explains, start still prints', () => {
    for (const kind of ['file', 'link'] as const) {
      const fix = makeTelemetryFixture('community', 'stub');
      startRun(fix);
      const [open] = openHandoffs(fix);
      const dir = dirname(open.path);
      const elsewhere = join(fix.home, 'elsewhere');
      mkdirSync(elsewhere);
      writeFileSync(join(elsewhere, basename(open.path)), JSON.stringify(open.state));
      rmSync(dir, { recursive: true });
      if (kind === 'file') writeFileSync(dir, 'not a directory');
      else symlinkSync(elsewhere, dir);
      const finish = finishRun(fix, 'success', 'extend:roadmap', DEBUG);
      expect(finish.status).toBe(0);
      expect(finish.stderr).toContain('handoff store is not a readable directory');
      expect(skillRuns(fix)).toHaveLength(0);
      const restart = runHelper({ ...fix.env, ...DEBUG }, ['start', '--skill', 'extend:roadmap']);
      expect(restart.status).toBe(0);
      expect(restart.stdout).toMatch(/^GE_TELEMETRY: session=\S+ start=\d+/);
      expect(restart.stderr).toContain('state handoff unwritable');
      const explicit = runHelper({ ...fix.env, ...DEBUG }, explicitArgs(open.state.session_id, open.state.start));
      expect(explicit.status).toBe(0);
      expect(explicit.stderr).toContain('handoff store is not a readable directory');
    }
  }, 30_000);

  // Value: protects=starts never save a fabricated arrival order; fails_when=unreadable enumeration is ignored or seq clamps;
  // why_new=existing store checks cover only file/link shapes; seam=none;
  // no_claim=installed acceptance (owned fixtures and an injected listdir failure or hand-edited extreme seq).
  for (const mode of ['unlistable-store', 'exhausted-sequence']) {
    test(`a start with ${mode} preserves existing handoffs and provides explicit recovery ids`, () => {
      const fix = makeTelemetryFixture('community', 'stub');
      const first = startRun(fix);
      const [open] = openHandoffs(fix);
      if (mode === 'exhausted-sequence') {
        writeFileSync(open.path, JSON.stringify({ ...open.state, seq: '9223372036854775807' }));
      }
      const before = readFileSync(open.path);
      const started = runPatched(fix, mode, ['start', '--skill', 'extend:roadmap'], {
        ...DEBUG, GSTACK_EXTEND_WORK_ITEM: 'unsaved-launch-key',
      });
      expect(started.status).toBe(0);
      const startedLines = started.stdout.trimEnd().split('\n');
      expect(startedLines).toHaveLength(2);
      expect(startedLines[0]).toMatch(/^GE_TELEMETRY: session=\S+ start=\d+$/);
      expect(startedLines[1]).toBe(
        `GE_TELEMETRY: unavailable reason=handoff-unwritable dir=${JSON.stringify(dirname(open.path))} error=${mode === 'unlistable-store' ? 'ENOTDIR' : 'ERANGE'}`,
      );
      expect(started.stderr).toContain('state handoff unwritable');
      expect(started.stdout).not.toContain('work_item=');
      if (mode === 'unlistable-store') expect(started.stderr).toContain('injected listdir failure');
      else expect(started.stderr).toContain('inspect handoff seq/start values');
      if (mode === 'unlistable-store') {
        const refused = runPatched(fix, mode, ['finish', '--skill', 'extend:roadmap'], DEBUG);
        expect(refused.stderr).toContain('repair the directory shape and permissions');
        expect(refused.stderr).not.toContain('remove the file or link');
      }
      expect(openHandoffs(fix).map(item => item.state.session_id)).toEqual([first]);
      expect(readFileSync(open.path)).toEqual(before);
      const sid = started.stdout.match(/session=(\S+)/)![1];
      const epoch = started.stdout.match(/start=(\d+)/)![1];
      expect(runHelper(fix.env, explicitArgs(sid, epoch)).status).toBe(0);
      expect(finishRun(fix).status).toBe(0);
      expect(fix.readLedger().map(row => row.session_id)).toEqual([sid, first]);
      expect(runSessions(fix)).toEqual([sid, first]);
      expect(handoffs(fix)).toHaveLength(0);
    }, 30_000);
  }

  test('classification: None is never an exact fingerprint, in any class', () => {
    const script = `import json, sys
sys.path.insert(0, ${JSON.stringify(join(ROOT, 'bin/lib'))})
import telemetry
now = 1_700_000_000
def judge(skill, harness, current, age):
    item = telemetry.Candidate({"session_id": "sid", "start": str(now - age), "harness": harness}, "p", False)
    telemetry.classify(item, skill, now, current)
    return list(item.classification)
print(json.dumps([
    judge("extend:roadmap", None, None, 86401),
    judge("extend:roadmap", None, None, 10),
    judge("extend:roadmap", "h", None, 10),
    judge("extend:roadmap", None, "h", 10),
    judge("extend:roadmap", "h", "h", 10 * 86400),
    judge("extend:roadmap", "h", "x", 10),
    judge("extend:pair-review", None, None, 10 * 86400),
    judge("extend:pair-review", "", "h", 10 * 86400),
    judge("extend:pair-review", "h", "h", 10 * 86400),
    judge("extend:pair-review", "h", "x", 10 * 86400),
]))
`;
    const run = spawnSync('python3', ['-I', '-c', script], { encoding: 'utf8', timeout: 10_000 });
    expect(run.status).toBe(0);
    const verdicts = (JSON.parse(run.stdout) as unknown[][]).map(item => [item[0], item[2], item[3]]);
    expect(verdicts).toEqual([
      ['refuse', null, null],
      ['adopt', 3, 'unknown fingerprint'],
      ['adopt', 3, 'unknown fingerprint'],
      ['adopt', 3, 'unknown fingerprint'],
      ['adopt', 2, 'exact fingerprint'],
      ['refuse', null, null],
      ['adopt', 1, 'resumable (newest)'],
      ['adopt', 1, 'resumable (newest)'],
      ['adopt', 0, 'resumable (exact)'],
      ['adopt', 1, 'resumable (newest)'],
    ]);
  }, 30_000);
});

// ─── Track 23H: idempotent finishes, unconfirmed deliveries, and the launcher's work item ───

const LIB_DIR = join(ROOT, 'bin/lib');
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function startFull(fix: TelemetryFixture, skill = 'extend:roadmap', env: Record<string, string> = {}, cwd?: string) {
  const result = runHelper({ ...fix.env, ...env }, ['start', '--skill', skill], cwd);
  expect(result.status).toBe(0);
  return { sid: result.stdout.match(/session=(\S+)/)![1], epoch: result.stdout.match(/start=(\d+)/)![1], stdout: result.stdout, stderr: result.stderr };
}

const explicitArgs = (sid: string, epoch: string, outcome = 'success', skill = 'extend:roadmap') =>
  ['finish', '--skill', skill, '--session-id', sid, '--start', epoch, '--outcome', outcome];

/** Every completion marker as `<key>/<sha256(session)>.json`, with its parsed content. */
function markers(fix: TelemetryFixture) {
  const dir = join(fix.home, '.gstack-extend/telemetry-completed');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).flatMap(entry =>
    readdirSync(join(dir, entry.name)).filter(name => /^[0-9a-f]{64}\.json$/.test(name)).map(name => {
      const path = join(dir, entry.name, name);
      let data: any = null;
      try { data = JSON.parse(readFileSync(path, 'utf8')); } catch { /* damaged on purpose */ }
      return { path, data };
    }));
}

const markerFor = (fix: TelemetryFixture, sid: string) =>
  markers(fix).find(item => item.path.endsWith(handoffName(sid)))!;

const ago = (seconds: number) => new Date(Date.now() - seconds * 1000);

/**
 * Runs the real wrapper in-process with the delegated logger call altered, so no 15-second wait is needed.
 * write-then-* modes let the real logger append first: the case a timeout or crash leaves uncertain.
 */
function runPatched(fix: TelemetryFixture, mode: string, args: string[], extraEnv: Record<string, string> = {}) {
  const script = `import os, sys, types
sys.path.insert(0, ${JSON.stringify(LIB_DIR)})
import telemetry
mode = sys.argv[1]
real = telemetry.subprocess.run
def run(args, **kwargs):
    if str(args[0]).endswith('gstack-telemetry-log'):
        if mode == 'stop-before-delegate':
            os._exit(23)
        if mode == 'timeout-after-write':
            real(args, **kwargs)
            raise telemetry.subprocess.TimeoutExpired(args, 15)
        if mode == 'timeout-no-write':
            raise telemetry.subprocess.TimeoutExpired(args, 15)
        if mode == 'nonzero-after-write':
            real(args, **kwargs)
            return types.SimpleNamespace(returncode=1)
        if mode == 'subprocess-error':
            raise telemetry.subprocess.SubprocessError('synthetic')
        if mode == 'permission-error':
            raise PermissionError('synthetic')
    return real(args, **kwargs)
telemetry.subprocess.run = run
save = telemetry.save_state
def guarded(path, state):
    if mode == 'marker-write-fails' and 'telemetry-completed' in str(path):
        raise OSError('synthetic marker write failure')
    if mode == 'handoff-save-fails' and '/telemetry-completed/' not in str(path) and '/telemetry/' in str(path):
        raise OSError('synthetic handoff save failure')
    return save(path, state)
telemetry.save_state = guarded
unlink = telemetry.Path.unlink
def guarded_unlink(path, *args, **kwargs):
    if mode == 'legacy-unlink-fails' and path.parent.name == 'telemetry' and path.suffix == '.json':
        raise OSError('synthetic legacy cleanup failure')
    return unlink(path, *args, **kwargs)
telemetry.Path.unlink = guarded_unlink
listdir = telemetry.os.listdir
def guarded_listdir(path):
    if mode == 'unlistable-store' and '/telemetry/' in str(path):
        print('injected listdir failure', file=sys.stderr)
        raise PermissionError('synthetic directory read failure')
    return listdir(path)
telemetry.os.listdir = guarded_listdir
telemetry.main(sys.argv[2:])
`;
  return spawnSync('python3', ['-I', '-c', script, mode, ...args], { env: { ...fix.env, ...extraEnv }, encoding: 'utf8', timeout: 20_000 });
}

describe('completion markers make explicit retries idempotent', () => {
  // Value: protects=unreadable marker lookup is diagnosed before recovery; fails_when=lexists silently masks EACCES;
  // why_new=linked-directory cases do not exercise a child lookup error; seam=none;
  // no_claim=filesystem permission repair (an injected metadata read error).
  test('an unreadable marker lookup is diagnosed rather than silently treated as absent', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const { sid, epoch } = startFull(fix);
    expect(runHelper(fix.env, explicitArgs(sid, epoch)).status).toBe(0);
    const marker = markerFor(fix, sid);
    const script = `import sys
sys.path.insert(0, ${JSON.stringify(LIB_DIR)})
import telemetry
real = telemetry.os.lstat
def lstat(path, *args, **kwargs):
    if str(path) == sys.argv[1]:
        raise PermissionError('synthetic marker lookup failure')
    return real(path, *args, **kwargs)
telemetry.os.lstat = lstat
assert telemetry.read_marker(telemetry.Path(sys.argv[1]), sys.argv[2], 'extend:roadmap', sys.argv[3]) is None
`;
    const run = spawnSync('python3', ['-I', '-c', script, marker.path, sid, marker.data.root], {
      env: { ...fix.env, ...DEBUG }, encoding: 'utf8', timeout: 10_000,
    });
    expect(run.status).toBe(0);
    expect(run.stderr).toContain('completion marker store is not a readable directory');
    expect(run.stderr).toContain('this finish proceeds without a completion marker');
    expect(markerFor(fix, sid).data).toEqual(marker.data);
  }, 30_000);
  // Value: protects=marker maintenance cannot mutate a linked directory; fails_when=prune or completion follows a per-key symlink;
  // why_new=existing unsafe-store cases cover only open handoffs; seam=none;
  // no_claim=ancestor-directory race protection (static synthetic per-key symlink).
  test('a linked marker directory is neither pruned nor written through', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const { sid, epoch } = startFull(fix);
    expect(runHelper(fix.env, explicitArgs(sid, epoch)).status).toBe(0);
    const marker = markerFor(fix, sid);
    const elsewhere = join(fix.home, 'marker-backup');
    renameSync(dirname(marker.path), elsewhere);
    symlinkSync(elsewhere, dirname(marker.path));
    const saved = join(elsewhere, basename(marker.path));
    writeFileSync(saved, JSON.stringify({ ...marker.data, completed_at: epochNow() - 45 * 86400 }));
    utimesSync(saved, ago(45 * 86400), ago(45 * 86400));
    const before = readFileSync(saved);
    const second = startFull(fix);
    expect(existsSync(saved)).toBe(true);
    expect(readFileSync(saved)).toEqual(before);
    const finished = runHelper({ ...fix.env, ...DEBUG }, explicitArgs(second.sid, second.epoch));
    expect(finished.status).toBe(0);
    expect(finished.stderr).toContain('completion marker store is not a readable directory');
    expect(readdirSync(elsewhere)).toEqual([basename(saved)]);
    expect(openHandoffs(fix)[0].state.done).toEqual(['provenance', 'usage']);
  }, 30_000);

  // Value: protects=completed legacy twins cannot resurrect a run; fails_when=cleanup deletes authoritative progress first;
  // why_new=the existing twin test covers successful cleanup only; seam=none;
  // no_claim=installed acceptance (synthetic state and injected unlink failure).
  test('a failed legacy-twin cleanup preserves completed progress for a start-less retry', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const { sid } = startFull(fix);
    const [open] = openHandoffs(fix);
    const legacy = join(telemetryDir(fix), basename(dirname(open.path)) + '.json');
    writeFileSync(legacy, JSON.stringify(open.state));
    expect(runPatched(fix, 'legacy-unlink-fails', ['finish', '--skill', 'extend:roadmap']).status).toBe(0);
    expect(existsSync(open.path)).toBe(true);
    expect(existsSync(legacy)).toBe(true);
    expect(JSON.parse(readFileSync(open.path, 'utf8')).done).toEqual(['provenance', 'usage']);
    expect(finishRun(fix).status).toBe(0);
    expect(fix.readLedger().map(row => row.session_id)).toEqual([sid]);
    expect(runSessions(fix)).toEqual([sid]);
    expect(handoffs(fix)).toHaveLength(0);
  }, 30_000);

  test('an explicit retry appends nothing, whether the first finish was explicit or adopted, and the run leaves a valid marker', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const { sid, epoch } = startFull(fix);
    expect(runHelper(fix.env, explicitArgs(sid, epoch)).status).toBe(0);
    expect(markerFor(fix, sid).data).toMatchObject({ session_id: sid, skill: 'extend:roadmap', done: ['provenance', 'usage'] });
    expect(Number.isInteger(markerFor(fix, sid).data.completed_at)).toBe(true);
    expect(statSync(markerFor(fix, sid).path).mode & 0o777).toBe(0o600);
    expect(handoffs(fix)).toHaveLength(0);
    for (let attempt = 0; attempt < 2; attempt += 1) expect(runHelper(fix.env, explicitArgs(sid, epoch, 'error')).status).toBe(0);
    expect(fix.readLedger()).toHaveLength(1);
    expect(runSessions(fix)).toEqual([sid]);
    // Adopted (start-less) first finish, explicit retry afterwards.
    const second = startFull(fix);
    expect(finishRun(fix).status).toBe(0);
    expect(runHelper(fix.env, explicitArgs(second.sid, second.epoch)).status).toBe(0);
    expect(fix.readLedger().map(row => row.session_id)).toEqual([sid, second.sid]);
    expect(runSessions(fix)).toEqual([sid, second.sid]);
  }, 30_000);

  test('N parallel explicit retries of one finish write exactly one row of each kind', async () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const { sid, epoch } = startFull(fix);
    const results = await Promise.all(Array.from({ length: 6 }, () => runAsync(fix.env, explicitArgs(sid, epoch))));
    for (const result of results) {
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
    }
    expect(fix.readLedger().filter(row => row.session_id === sid)).toHaveLength(1);
    expect(runSessions(fix)).toEqual([sid]);
    expect(handoffs(fix)).toHaveLength(0);
  }, 30_000);

  // Value: protects=the root-skill lock stays held through delegation; fails_when=finish releases its lock before the logger returns;
  // why_new=a pending child alone may just be scheduled late; seam=none;
  // no_claim=installed acceptance (a nonblocking lock probe and sentinel-controlled logger).
  test('a second same-key finish waits on the lock held through the delegate, then sees the first one\'s marker', async () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const logger = join(fix.home, '.claude/skills/gstack/bin/gstack-telemetry-log');
    writeFileSync(logger, `#!/usr/bin/env python3
# --no-sweep
import json, os, sys, time
from pathlib import Path
home = Path.home()
with (home / 'logger-calls.txt').open('a') as calls:
    calls.write('call' + chr(10))
if (home / 'block').exists():
    (home / 'entered').write_text('1')
    deadline = time.time() + 30
    while not (home / 'release').exists() and time.time() < deadline:
        time.sleep(0.05)
args = sys.argv[1:]
values = {args[i]: args[i + 1] for i in range(len(args) - 1) if args[i].startswith('--')}
sink = home / '.gstack' / 'analytics'
sink.mkdir(parents=True, exist_ok=True)
with (sink / 'skill-usage.jsonl').open('a') as stream:
    stream.write(json.dumps(dict(v=1, event_type='skill_run', skill=values.get('--skill'), session_id=values.get('--session-id'))) + chr(10))
`);
    chmodSync(logger, 0o755);
    const { sid, epoch } = startFull(fix);
    writeFileSync(join(fix.home, 'block'), '1');
    const first = runAsync(fix.env, explicitArgs(sid, epoch));
    let second: ReturnType<typeof runAsync> | undefined;
    try {
      for (let waited = 0; !existsSync(join(fix.home, 'entered')); waited += 50) {
        expect(waited).toBeLessThan(20_000);
        await sleep(50);
      }
      // The output already landed while the logger is blocked: progress must be durable before it returns.
      const [open] = openHandoffs(fix);
      expect(open.state.done).toEqual(['provenance']);
      const lockPath = join(fix.home, '.gstack-extend/telemetry-locks', basename(dirname(open.path)) + '.lock');
      const probe = spawnSync('python3', ['-I', '-c', `import fcntl, sys
with open(sys.argv[1], 'r+') as lock:
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print('held')
    else:
        raise AssertionError('finish released its lock early')
`, lockPath], { env: fix.env, encoding: 'utf8', timeout: 10_000 });
      expect(probe.status).toBe(0);
      expect(probe.stdout.trim()).toBe('held');
      let secondDone = false;
      second = runAsync({ ...fix.env, ...DEBUG }, explicitArgs(sid, epoch)).then(result => { secondDone = true; return result; });
      await sleep(600);
      expect(secondDone).toBe(false);
      expect(readFileSync(join(fix.home, 'logger-calls.txt'), 'utf8')).toBe('call\n');
    } finally {
      writeFileSync(join(fix.home, 'release'), '1');
      await Promise.all([first, ...(second ? [second] : [])]);
    }
    const [firstResult, secondResult] = await Promise.all([first, second!]);
    expect(firstResult.status).toBe(0);
    expect(secondResult.status).toBe(0);
    expect(secondResult.stderr).toContain('this run already finished');
    expect(readFileSync(join(fix.home, 'logger-calls.txt'), 'utf8')).toBe('call\n');
    expect(fix.readLedger()).toHaveLength(1);
    expect(runSessions(fix)).toEqual([sid]);
  }, 40_000);

  test('markers are pruned by the next same-key start, only for that key, and a post-prune retry writes again', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const [rootA, rootB] = ['root-a', 'root-b'].map(name => gitRepo(fix, name));
    const runIn = (cwd: string) => {
      const run = startFull(fix, 'extend:roadmap', {}, cwd);
      expect(runHelper(fix.env, explicitArgs(run.sid, run.epoch), cwd).status).toBe(0);
      return run;
    };
    const a = runIn(rootA);
    const b = runIn(rootB);
    const age = (sid: string, days: number, completedAt?: unknown) => {
      const found = markerFor(fix, sid);
      writeFileSync(found.path, completedAt === undefined ? JSON.stringify(found.data) : JSON.stringify({ ...found.data, completed_at: completedAt }));
      utimesSync(found.path, ago(days * 86400), ago(days * 86400));
      return found.path;
    };
    // Inside retention: a start keeps it.
    age(a.sid, 29, epochNow() - 29 * 86400);
    startFull(fix, 'extend:roadmap', {}, rootA);
    expect(existsSync(markerFor(fix, a.sid).path)).toBe(true);
    // Past retention in both keys: only the starting key is pruned.
    const pathA = age(a.sid, 31, epochNow() - 31 * 86400);
    const pathB = age(b.sid, 31, epochNow() - 31 * 86400);
    startFull(fix, 'extend:roadmap', {}, rootA);
    expect(existsSync(pathA)).toBe(false);
    expect(existsSync(pathB)).toBe(true);
    // The documented bound: an explicit retry after pruning writes again.
    expect(runHelper(fix.env, explicitArgs(a.sid, a.epoch), rootA).status).toBe(0);
    expect(fix.readLedger().filter(row => row.session_id === a.sid)).toHaveLength(2);
    expect(runSessions(fix).filter(session => session === a.sid)).toHaveLength(2);
    // A future or missing completed_at falls back to the file's mtime; a recent mtime keeps an old completed_at.
    const futurePath = age(a.sid, 40, epochNow() + 10 * 86400);
    startFull(fix, 'extend:roadmap', {}, rootA);
    expect(existsSync(futurePath)).toBe(false);
    expect(runHelper(fix.env, explicitArgs(a.sid, a.epoch), rootA).status).toBe(0);
    const keptPath = markerFor(fix, a.sid).path;
    writeFileSync(keptPath, JSON.stringify({ ...markerFor(fix, a.sid).data, completed_at: epochNow() - 90 * 86400 }));
    startFull(fix, 'extend:roadmap', {}, rootA);
    expect(existsSync(keptPath)).toBe(true);
    writeFileSync(keptPath, 'garbage{{');
    utimesSync(keptPath, ago(45 * 86400), ago(45 * 86400));
    startFull(fix, 'extend:roadmap', {}, rootA);
    expect(existsSync(keptPath)).toBe(false);
  }, 60_000);

  // Value: protects=retention keeps a marker without readable timestamp evidence; fails_when=metadata errors delete it or abort start;
  // why_new=the retention matrix only damages content with readable mtime; seam=none;
  // no_claim=filesystem-wide permission recovery (one synthetic lstat error).
  test('marker pruning retains unreadable timestamp evidence and still allows a same-key start', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const { sid, epoch } = startFull(fix);
    expect(runHelper(fix.env, explicitArgs(sid, epoch)).status).toBe(0);
    const marker = markerFor(fix, sid);
    writeFileSync(marker.path, 'garbage{{');
    utimesSync(marker.path, ago(45 * 86400), ago(45 * 86400));
    const before = readFileSync(marker.path);
    const script = `import sys
sys.path.insert(0, ${JSON.stringify(LIB_DIR)})
import telemetry
real = telemetry.os.lstat
injected = []
def lstat(path, *args, **kwargs):
    if str(path) == sys.argv[1]:
        injected.append(True)
        raise OSError('synthetic unreadable marker metadata')
    return real(path, *args, **kwargs)
telemetry.os.lstat = lstat
telemetry.main(['start', '--skill', 'extend:roadmap'])
assert injected, 'marker metadata injection was not reached'
`;
    const run = spawnSync('python3', ['-I', '-c', script, marker.path], { env: fix.env, encoding: 'utf8', timeout: 10_000 });
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/^GE_TELEMETRY: session=/);
    expect(readFileSync(marker.path)).toEqual(before);
    expect(openHandoffs(fix)).toHaveLength(1);
  }, 30_000);

  test('a marker that does not describe this finish is ignored and the explicit finish proceeds', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const { sid, epoch } = startFull(fix);
    expect(runHelper(fix.env, explicitArgs(sid, epoch)).status).toBe(0);
    const valid = markerFor(fix, sid);
    const variants: Array<[string, string]> = [
      ['unknown output name', JSON.stringify({ ...valid.data, done: ['bogus'] })],
      ['done not a list', JSON.stringify({ ...valid.data, done: 'provenance' })],
      ['another skill', JSON.stringify({ ...valid.data, skill: 'extend:qa' })],
      ['another root', JSON.stringify({ ...valid.data, root: '/elsewhere' })],
      ['another session', JSON.stringify({ ...valid.data, session_id: 'someone-else' })],
      ['negative completed_at', JSON.stringify({ ...valid.data, completed_at: -5 })],
      ['non-integer completed_at', JSON.stringify({ ...valid.data, completed_at: 'soon' })],
      ['boolean completed_at', JSON.stringify({ ...valid.data, completed_at: true })],
      ['not JSON', 'garbage{{'],
      ['not an object', '[]'],
    ];
    let rows = 1;
    for (const [label, content] of variants) {
      writeFileSync(valid.path, content);
      const retry = runHelper({ ...fix.env, ...DEBUG }, explicitArgs(sid, epoch));
      expect(retry.status).toBe(0);
      expect(retry.stderr).toContain('malformed or describes another run');
      rows += 1;
      expect([label, fix.readLedger().length]).toEqual([label, rows]); // proceeds: a damaged marker never suppresses rows
    }
  }, 60_000);

  test('a valid marker is a pure no-op even for an output enabled only afterwards, and says so in debug mode', () => {
    const fix = makeTelemetryFixture('off', 'stub');
    const { sid, epoch } = startFull(fix);
    expect(runHelper(fix.env, explicitArgs(sid, epoch)).status).toBe(0);
    expect(fix.readLedger()).toHaveLength(1);
    expect(markerFor(fix, sid).data.done).toEqual(['provenance']);
    writeFileSync(join(fix.home, '.gstack/config.yaml'), 'telemetry: community\n');
    const retry = runHelper({ ...fix.env, ...DEBUG }, explicitArgs(sid, epoch));
    expect(retry.status).toBe(0);
    expect(retry.stderr).toContain('this run already finished');
    expect(retry.stderr).toContain('not written: usage');
    expect(fix.readLedger()).toHaveLength(1);
    expect(skillRuns(fix)).toHaveLength(0);
    // Silent without debug.
    expect(runHelper(fix.env, explicitArgs(sid, epoch)).stderr).toBe('');
  }, 30_000);

  test('an empty-done marker (nothing was owed) is valid and suppresses a retry', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const { sid, epoch } = startFull(fix);
    const [open] = openHandoffs(fix);
    rmSync(open.path);
    const dir = join(fix.home, '.gstack-extend/telemetry-completed', basename(dirname(open.path)));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, handoffName('planted-run')), JSON.stringify({
      session_id: 'planted-run', skill: 'extend:roadmap', root: open.state.root, done: [], completed_at: epochNow(),
    }));
    expect(runHelper(fix.env, explicitArgs('planted-run', epoch)).status).toBe(0);
    expect(fix.readLedger()).toHaveLength(0);
    expect(skillRuns(fix)).toHaveLength(0);
    expect(sid).toBeTruthy();
  }, 30_000);

  test('a marker beside a surviving handoff wins: no rows, and the handoff is removed', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const { sid, epoch } = startFull(fix);
    const [open] = openHandoffs(fix);
    const saved = readFileSync(open.path);
    expect(runHelper(fix.env, explicitArgs(sid, epoch)).status).toBe(0);
    writeFileSync(open.path, saved); // the crash window between the marker write and the unlink
    expect(runHelper(fix.env, explicitArgs(sid, epoch)).status).toBe(0);
    expect(fix.readLedger()).toHaveLength(1);
    expect(runSessions(fix)).toEqual([sid]);
    expect(existsSync(open.path)).toBe(false);
  }, 30_000);

  test('the no-handoff escape hatch completes once, leaves a marker, and its retry is a no-op', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const epoch = String(epochNow() - 30);
    expect(runHelper(fix.env, explicitArgs('manual-1', epoch, 'success')).status).toBe(0);
    expect(runHelper(fix.env, explicitArgs('manual-1', epoch, 'success')).status).toBe(0);
    expect(fix.readLedger().map(row => row.session_id)).toEqual(['manual-1']);
    expect(runSessions(fix)).toEqual(['manual-1']);
    expect(markers(fix)).toHaveLength(1);
  }, 30_000);

  test('when the lock cannot be taken, an explicit finish still consults the marker before delegating', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const { sid, epoch } = startFull(fix);
    expect(runHelper(fix.env, explicitArgs(sid, epoch)).status).toBe(0);
    const locks = join(fix.home, '.gstack-extend/telemetry-locks');
    rmSync(locks, { recursive: true });
    writeFileSync(locks, 'not a directory');
    const calls = () => fix.readStubArgs().length;
    const before = calls();
    const retry = runHelper({ ...fix.env, ...DEBUG }, explicitArgs(sid, epoch));
    expect(retry.status).toBe(0);
    expect(retry.stderr).toContain('state handoff unwritable');
    expect(retry.stderr).toContain('this run already finished');
    expect(calls()).toBe(before);
    // Without the marker the same path delegates, as it did before markers existed.
    rmSync(markerFor(fix, sid).path);
    expect(runHelper(fix.env, explicitArgs(sid, epoch)).status).toBe(0);
    expect(calls()).toBe(before + 1);
  }, 30_000);

  test('a marker that cannot be written keeps the handoff with its progress, and the retry completes without duplicating', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const { sid } = startFull(fix);
    const failed = runPatched(fix, 'marker-write-fails', ['finish', '--skill', 'extend:roadmap'], DEBUG);
    expect(failed.status).toBe(0);
    expect(failed.stderr).toContain('could not write the completion marker');
    expect(markers(fix)).toHaveLength(0);
    expect(openHandoffs(fix).map(item => [item.state.session_id, item.state.done])).toEqual([[sid, ['provenance', 'usage']]]);
    expect(finishRun(fix).status).toBe(0);
    expect(fix.readLedger()).toHaveLength(1);
    expect(runSessions(fix)).toEqual([sid]);
    expect(handoffs(fix)).toHaveLength(0);
    expect(markers(fix)).toHaveLength(1);
  }, 30_000);

  test('a failing incremental save never skips the delegate for that attempt', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const { sid } = startFull(fix);
    const run = runPatched(fix, 'handoff-save-fails', ['finish', '--skill', 'extend:roadmap'], DEBUG);
    expect(run.status).toBe(0);
    expect(run.stderr).toContain('could not update the handoff');
    expect(fix.readLedger().map(row => row.session_id)).toEqual([sid]);
    expect(runSessions(fix)).toEqual([sid]);
    expect(fix.readStubArgs()).toHaveLength(1);
  }, 30_000);

  // Value: protects=provenance is not duplicated after process interruption; fails_when=the pre-delegate progress save is removed;
  // why_new=ordinary logger failure reaches later saves; seam=none;
  // no_claim=installed acceptance (the child exits at an injected boundary).
  test('done is saved as each output lands, so an interrupted finish leaves accurate retry metadata', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const { sid } = startFull(fix);
    expect(runPatched(fix, 'stop-before-delegate', ['finish', '--skill', 'extend:roadmap']).status).toBe(23);
    expect(openHandoffs(fix)[0].state.done).toEqual(['provenance']);
    expect(skillRuns(fix)).toHaveLength(0);
    expect(finishRun(fix).status).toBe(0);
    expect(fix.readLedger().map(row => row.session_id)).toEqual([sid]);
    expect(runSessions(fix)).toEqual([sid]);
    expect(handoffs(fix)).toHaveLength(0);
  }, 30_000);
});

describe('unconfirmed logger deliveries are verified before a retry delegates again', () => {
  for (const mode of ['timeout-after-write', 'nonzero-after-write']) {
    test(`${mode}: the retry finds the row in the sink and delegates nothing`, () => {
      const fix = makeTelemetryFixture('community', 'stub');
      const { sid } = startFull(fix);
      const first = runPatched(fix, mode, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']);
      expect(first.status).toBe(0);
      expect(runSessions(fix)).toEqual([sid]);
      expect(openHandoffs(fix)[0].state).toMatchObject({ usage_uncertain: true, done: ['provenance'] });
      expect(finishRun(fix).status).toBe(0);
      expect(runSessions(fix)).toEqual([sid]); // no second skill_run
      expect(fix.readStubArgs()).toHaveLength(1);
      expect(fix.readLedger().map(row => row.session_id)).toEqual([sid]);
      expect(handoffs(fix)).toHaveLength(0);
      expect(markers(fix)[0].data.done).toEqual(['provenance', 'usage']);
    }, 30_000);
  }

  for (const mode of ['timeout-no-write', 'subprocess-error']) {
    test(`${mode}: nothing was written, so the retry delegates and exactly one skill_run exists (a skill_start never satisfies the scan)`, () => {
      const fix = makeTelemetryFixture('community', 'stub');
      const { sid } = startFull(fix);
      const first = runPatched(fix, mode, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']);
      expect(first.status).toBe(0);
      expect(skillRuns(fix)).toHaveLength(0);
      expect(fix.readJsonl().filter(row => row.event_type === 'skill_start' && row.session_id === sid)).toHaveLength(1);
      expect(openHandoffs(fix)[0].state.usage_uncertain).toBe(true);
      expect(finishRun(fix).status).toBe(0);
      expect(runSessions(fix)).toEqual([sid]);
      expect(fix.readLedger().map(row => row.session_id)).toEqual([sid]);
      expect(handoffs(fix)).toHaveLength(0);
    }, 30_000);
  }

  test('an exec failure happened before the logger ran: failed, no uncertain flag, the retry just delegates', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    startFull(fix);
    expect(runPatched(fix, 'permission-error', ['finish', '--skill', 'extend:roadmap']).status).toBe(0);
    expect(skillRuns(fix)).toHaveLength(0);
    expect(openHandoffs(fix)[0].state).not.toHaveProperty('usage_uncertain');
    expect(finishRun(fix).status).toBe(0);
    expect(skillRuns(fix)).toHaveLength(1);
  }, 30_000);

  test('delegate classifies every branch: pre-launch failed, exit 0 done, anything after launch uncertain', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const logger = join(fix.home, '.claude/skills/gstack/bin/gstack-telemetry-log');
    const script = `import json, sys, types
sys.path.insert(0, ${JSON.stringify(LIB_DIR)})
import telemetry
real = telemetry.subprocess.run
outcomes = {}
def attempt(name, behaviour):
    def run(args, **kwargs):
        if str(args[0]).endswith('gstack-telemetry-log'):
            return behaviour()
        return real(args, **kwargs)
    telemetry.subprocess.run = run
    outcomes[name] = telemetry.delegate(sys.argv[1], 'extend:roadmap', 'sid', 5, {})
def raises(error):
    def inner():
        raise error
    return inner
attempt('exit0', lambda: types.SimpleNamespace(returncode=0))
attempt('exit1', lambda: types.SimpleNamespace(returncode=1))
attempt('timeout', raises(telemetry.subprocess.TimeoutExpired(['x'], 15)))
attempt('called', raises(telemetry.subprocess.CalledProcessError(2, ['x'])))
attempt('generic', raises(telemetry.subprocess.SubprocessError('x')))
attempt('permission', raises(PermissionError('x')))
attempt('missing', raises(FileNotFoundError('x')))
print(json.dumps(outcomes))
`;
    const run = spawnSync('python3', ['-I', '-c', script, logger], { env: fix.env, encoding: 'utf8', timeout: 10_000 });
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({
      exit0: 'done', exit1: 'uncertain', timeout: 'uncertain', called: 'uncertain', generic: 'uncertain',
      permission: 'failed', missing: 'failed',
    });
  }, 30_000);

  // Value: protects=bad sink records do not hide a later matching completion; fails_when=decoder recursion errors abort scanning;
  // why_new=the malformed-line table previously omitted nesting-limit failures; seam=none;
  // no_claim=installed acceptance (synthetic JSONL sink).
  test('the sink scan matches only a skill_run for this skill and session, in the tail, and refuses unsafe sinks', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const script = `import json, os, sys, tempfile
sys.path.insert(0, ${JSON.stringify(LIB_DIR)})
import telemetry
directory = tempfile.mkdtemp(dir=sys.argv[1])
cap = telemetry.LOG_TAIL_BYTES
def line(**fields):
    base = dict(event_type='skill_run', skill='extend:roadmap', session_id='sid-1')
    base.update(fields)
    return (json.dumps(base) + chr(10)).encode()
def pad(size):
    return b'{"pad":"' + b'x' * (size - 11) + b'"}' + chr(10).encode()
def write(name, data):
    path = os.path.join(directory, name)
    with open(path, 'wb') as stream:
        stream.write(data)
    return path
def scan(path, skill='extend:roadmap', sid='sid-1'):
    return telemetry.scan_sink_tail(path, skill, sid)
results = {}
results['match'] = scan(write('match', line()))
results['start-only'] = scan(write('start', line(event_type='skill_start')))
results['other-skill'] = scan(write('skill', line(skill='extend:qa')))
results['other-session'] = scan(write('session', line(session_id='sid-2')))
results['malformed-lines'] = scan(write('bad', b'garbage' + chr(10).encode() + b'[]' + chr(10).encode() + b'{' + chr(10).encode() + line()))
results['deeply-nested'] = scan(write('deep', b'[' * 2000 + b'0' + b']' * 2000 + chr(10).encode() + line()))
results['absent'] = scan(os.path.join(directory, 'nothing'))
results['symlink'] = scan((os.symlink(os.path.join(directory, 'match'), os.path.join(directory, 'link')), os.path.join(directory, 'link'))[1])
os.mkfifo(os.path.join(directory, 'fifo'))
results['fifo'] = scan(os.path.join(directory, 'fifo'))
os.link(os.path.join(directory, 'match'), os.path.join(directory, 'second-link'))
results['hardlink'] = scan(os.path.join(directory, 'match'))
results['directory'] = scan(directory)
early, late = line(session_id='sid-early'), line(session_id='sid-late')
big = early + pad(1 << 20) * 8 + late
results['big-size-over-cap'] = len(big) > cap
big_path = write('big', big)
results['beyond-tail'] = scan(big_path, sid='sid-early')
results['in-tail'] = scan(big_path, sid='sid-late')
# The seek lands inside the leading blanks of a line that would otherwise match: a torn first line is dropped.
torn = b' ' * 300 + line(session_id='sid-torn').rstrip() + chr(10).encode()
prefix = pad(1000)
suffix_size = cap + 100 - len(torn)
results['torn-first-line'] = scan(write('torn', prefix + torn + pad(suffix_size)), sid='sid-torn')
print(json.dumps(results))
`;
    const run = spawnSync('python3', ['-I', '-c', script, fix.home], { env: fix.env, encoding: 'utf8', timeout: 30_000 });
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({
      match: true, 'start-only': false, 'other-skill': false, 'other-session': false, 'malformed-lines': true, 'deeply-nested': true,
      absent: false, symlink: null, fifo: null, hardlink: null, directory: null,
      'big-size-over-cap': true, 'beyond-tail': false, 'in-tail': true, 'torn-first-line': false,
    });
  }, 40_000);

  test('an unreadable sink holds: nothing is delegated and the flag stays; a later no-logger attempt completes the handoff', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const { sid } = startFull(fix);
    expect(runPatched(fix, 'timeout-after-write', ['finish', '--skill', 'extend:roadmap']).status).toBe(0);
    const sink = join(fix.home, '.gstack/analytics/skill-usage.jsonl');
    rmSync(sink);
    symlinkSync(join(fix.home, 'elsewhere.jsonl'), sink); // O_NOFOLLOW makes it unreadable, as root or not
    const held = finishRun(fix, 'success', 'extend:roadmap', DEBUG);
    expect(held.status).toBe(0);
    expect(held.stderr).toContain('skill-usage sink is unreadable');
    expect(fix.readStubArgs()).toHaveLength(1); // no second delegate call
    expect(openHandoffs(fix)[0].state).toMatchObject({ usage_uncertain: true, done: ['provenance'] });
    expect(markers(fix)).toHaveLength(0);
    // Gstack becomes unavailable (tier off): the scan is bypassed and today's completion logic ends the handoff.
    writeFileSync(join(fix.home, '.gstack/config.yaml'), 'telemetry: off\n');
    expect(finishRun(fix).status).toBe(0);
    expect(handoffs(fix)).toHaveLength(0);
    expect(fix.readLedger().map(row => row.session_id)).toEqual([sid]);
    expect(markers(fix)[0].data.done).toEqual(['provenance']);
  }, 30_000);

  // Value: protects=an uncertain retry cannot duplicate usage when its late state-root lookup fails;
  // fails_when=resolver errors clear uncertainty, create a marker, or delegate before verifying the sink;
  // why_new=existing late-resolver cases have no uncertain delivery and config-failure cases stop before sink lookup; seam=none;
  // no_claim=installed resolver behavior (owned fixture state and injected boundary errors).
  test('a late resolver failure holds an uncertain retry until the sink can be checked', () => {
    for (const failure of ['error', 'timeout']) {
      const fix = makeTelemetryFixture('community', 'stub');
      const { sid } = startFull(fix);
      expect(runPatched(fix, 'timeout-after-write', ['finish', '--skill', 'extend:roadmap']).status).toBe(0);
      const script = `import sys
sys.path.insert(0, ${JSON.stringify(LIB_DIR)})
import telemetry
original = telemetry.sink_path
calls = 0
def resolve(logger):
    global calls
    calls += 1
    if calls == 2:
        if sys.argv[1] == 'timeout':
            raise telemetry.subprocess.TimeoutExpired(['resolver'], 10)
        raise OSError('synthetic late resolver failure')
    return original(logger)
telemetry.sink_path = resolve
telemetry.main(['finish', '--skill', 'extend:roadmap'])
assert calls == 2, calls
`;
      const held = spawnSync('python3', ['-I', '-c', script, failure], {
        env: { ...fix.env, ...DEBUG }, encoding: 'utf8', timeout: 10_000,
      });
      expect(held.status).toBe(0);
      expect(held.stderr).toContain('gstack state-root resolver failed');
      expect(openHandoffs(fix)[0].state).toMatchObject({ usage_uncertain: true, done: ['provenance'] });
      expect(markers(fix)).toHaveLength(0);
      expect(fix.readStubArgs()).toHaveLength(1);
      expect(finishRun(fix).status).toBe(0);
      expect(runSessions(fix)).toEqual([sid]);
      expect(fix.readLedger().map(row => row.session_id)).toEqual([sid]);
      expect(fix.readStubArgs()).toHaveLength(1);
      expect(handoffs(fix)).toHaveLength(0);
      expect(markers(fix)[0].data.done).toEqual(['provenance', 'usage']);
    }
  }, 30_000);

  test('a transient gstack-config failure retains the handoff and the flag, writes no marker, and recovers', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const { sid } = startFull(fix);
    expect(runPatched(fix, 'timeout-after-write', ['finish', '--skill', 'extend:roadmap']).status).toBe(0);
    const config = join(fix.home, '.claude/skills/gstack/bin/gstack-config');
    const working = readFileSync(config);
    writeFileSync(config, '#!/bin/sh\nexit 1\n');
    chmodSync(config, 0o755);
    expect(finishRun(fix).status).toBe(0);
    expect(openHandoffs(fix)[0].state).toMatchObject({ usage_uncertain: true, done: ['provenance'] });
    expect(markers(fix)).toHaveLength(0);
    expect(fix.readStubArgs()).toHaveLength(1);
    writeFileSync(config, working);
    chmodSync(config, 0o755);
    expect(finishRun(fix).status).toBe(0);
    expect(handoffs(fix)).toHaveLength(0);
    expect(runSessions(fix)).toEqual([sid]);
    expect(fix.readStubArgs()).toHaveLength(1);
  }, 30_000);
});

describe('the launcher\'s work item', () => {
  const ITEM = 'GSTACK_EXTEND_WORK_ITEM';
  const items = (fix: TelemetryFixture) => fix.readLedger().map(row => row.work_item);

  test('GE_TELEMETRY is byte-identical without a work item and carries it as a JSON string with one', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    expect(startFull(fix).stdout).toMatch(/^GE_TELEMETRY: session=extend-[0-9a-f-]+ start=\d+\n$/);
    const cases: Array<[string, string]> = [
      ['a b=c', '"a b=c"'],
      ['a"b\\c', '"a\\"b\\\\c"'],
      ['Ünï雪', '"\\u00dcn\\u00ef\\u96ea"'],
      ['task 42', '"task 42"'],
    ];
    for (const [value, quoted] of cases) {
      const run = startFull(fix, 'extend:roadmap', { [ITEM]: value });
      expect(run.stdout).toBe(`GE_TELEMETRY: session=${run.sid} start=${run.epoch} work_item=${quoted}\n`);
      expect(JSON.parse(run.stdout.split(' work_item=')[1])).toBe(value);
    }
  }, 30_000);

  test('a start-time value survives a finish in a later session, explicit or resumable, and hand-run rows stay null', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const run = startFull(fix, 'extend:roadmap', { [ITEM]: 'wi-explicit' });
    expect(runHelper(fix.env, explicitArgs(run.sid, run.epoch)).status).toBe(0);
    const resumable = startFull(fix, 'extend:pair-review', { [ITEM]: 'wi-resume', CODEX_THREAD_ID: 'thread-a' });
    expect(finishRun(fix, 'success', 'extend:pair-review', { CODEX_THREAD_ID: 'thread-b' }).status).toBe(0);
    startFull(fix);
    expect(finishRun(fix).status).toBe(0);
    expect(items(fix)).toEqual(['wi-explicit', 'wi-resume', null]);
    expect(fix.readLedger()[1].session_id).toBe(resumable.sid);
  }, 30_000);

  test('precedence: the flag, then the value saved at start, then the finish environment, else null', () => {
    const run = (startEnv: Record<string, string>, finishEnv: Record<string, string>, flag?: string) => {
      const fix = makeTelemetryFixture('community', 'stub');
      startFull(fix, 'extend:roadmap', startEnv);
      const args = ['finish', '--skill', 'extend:roadmap', ...(flag === undefined ? [] : ['--work-item', flag])];
      expect(runHelper({ ...fix.env, ...finishEnv }, args).status).toBe(0);
      return items(fix)[0];
    };
    expect(run({ [ITEM]: 'saved' }, { [ITEM]: 'finish-env' }, 'flag')).toBe('flag');
    expect(run({ [ITEM]: 'saved' }, { [ITEM]: 'finish-env' })).toBe('saved');
    expect(run({}, { [ITEM]: 'finish-env' })).toBe('finish-env');
    expect(run({}, {})).toBeNull();
    expect(run({ [ITEM]: 'saved' }, {}, 'x'.repeat(201))).toBe('saved'); // an invalid flag falls through
    expect(run({ [ITEM]: 'saved' }, {}, '   ')).toBe('saved');
    expect(run({}, {}, 'flag-only')).toBe('flag-only');
  }, 60_000);

  test('newline, blank and 201-character values are null, at start and at finish', () => {
    for (const bad of ['line\nbreak', '   ', 'x'.repeat(201), '']) {
      const fix = makeTelemetryFixture('community', 'stub');
      const run = startFull(fix, 'extend:roadmap', { [ITEM]: bad });
      expect(run.stdout).not.toContain('work_item');
      expect(openHandoffs(fix)[0].state).not.toHaveProperty('work_item');
      expect(finishRun(fix, 'success', 'extend:roadmap', { [ITEM]: bad }).status).toBe(0);
      expect(items(fix)).toEqual([null]);
    }
    const fix = makeTelemetryFixture('community', 'stub');
    startFull(fix, 'extend:roadmap', { [ITEM]: 'x'.repeat(200) });
    expect(finishRun(fix).status).toBe(0);
    expect(items(fix)).toEqual(['x'.repeat(200)]); // the bound is inclusive
  }, 60_000);

  test('a legacy handoff with no saved value takes the finish environment; an unclean saved value falls through to it', () => {
    const legacy = makeTelemetryFixture('community', 'stub');
    startFull(legacy);
    plantLegacy(legacy, { session_id: 'legacy-wi', start: String(epochNow() - 20) });
    expect(finishRun(legacy, 'success', 'extend:roadmap', { [ITEM]: 'finish-env' }).status).toBe(0);
    expect(items(legacy)).toEqual(['finish-env']);
    for (const unclean of [12, 'x'.repeat(201), ['list']]) {
      const fix = makeTelemetryFixture('community', 'stub');
      startFull(fix, 'extend:roadmap', { [ITEM]: 'saved' });
      rewriteHandoff(fix, { work_item: unclean });
      const run = finishRun(fix, 'success', 'extend:roadmap', { ...DEBUG, [ITEM]: 'finish-env' });
      expect(run.status).toBe(0);
      expect(run.stderr).toContain('ignored saved start work item');
      expect(items(fix)).toEqual(['finish-env']);
    }
  }, 60_000);

  test('a saved retry row keeps its first construction\'s work item after the environment changes', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    startFull(fix);
    const stageRunsDir = join(fix.home, '.gstack-extend/analytics/stage-runs');
    mkdirSync(dirname(stageRunsDir), { recursive: true });
    writeFileSync(stageRunsDir, 'block'); // an unwritable ledger directory: the row is built, not appended
    expect(finishRun(fix, 'success', 'extend:roadmap', { [ITEM]: 'first' }).status).toBe(0);
    expect(openHandoffs(fix)[0].state.row.work_item).toBe('first');
    rmSync(stageRunsDir, { force: true });
    expect(finishRun(fix, 'success', 'extend:roadmap', { [ITEM]: 'second' }).status).toBe(0);
    expect(items(fix)).toEqual(['first']);
  }, 30_000);

  test('a rejected value names its source and the bound in debug mode only', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const quiet = startFull(fix, 'extend:roadmap', { [ITEM]: 'x'.repeat(201) });
    expect(quiet.stderr).toBe('');
    const start = runHelper({ ...fix.env, ...DEBUG, [ITEM]: 'x'.repeat(201) }, ['start', '--skill', 'extend:roadmap']);
    expect(start.stderr).toContain('ignored start environment work item (over 200 characters');
    const flagged = runHelper({ ...fix.env, ...DEBUG }, ['finish', '--skill', 'extend:roadmap', '--work-item', 'a\nb']);
    expect(flagged.stderr).toContain('ignored --work-item flag work item (contains non-printable characters');
    const blank = makeTelemetryFixture('community', 'stub');
    startFull(blank);
    expect(runHelper({ ...blank.env, ...DEBUG }, ['finish', '--skill', 'extend:roadmap', '--work-item', '  ']).stderr)
      .toContain('ignored --work-item flag work item (blank');
    const finishEnv = makeTelemetryFixture('community', 'stub');
    startFull(finishEnv);
    expect(runHelper({ ...finishEnv.env, ...DEBUG, [ITEM]: 'x'.repeat(201) }, ['finish', '--skill', 'extend:roadmap']).stderr)
      .toContain('ignored finish environment work item (over 200 characters');
  }, 30_000);

  test('the value reaches neither the delegated logger\'s arguments nor its environment', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const logger = join(fix.home, '.claude/skills/gstack/bin/gstack-telemetry-log');
    writeFileSync(logger, `#!/usr/bin/env python3
# --no-sweep
import json, os, sys
from pathlib import Path
Path.home().joinpath('logger-saw.json').write_text(json.dumps({'item': os.environ.get('GSTACK_EXTEND_WORK_ITEM'), 'args': sys.argv[1:]}))
`);
    chmodSync(logger, 0o755);
    startFull(fix, 'extend:roadmap', { [ITEM]: 'private-key' });
    expect(runHelper({ ...fix.env, [ITEM]: 'private-key' }, ['finish', '--skill', 'extend:roadmap', '--work-item', 'private-key']).status).toBe(0);
    const saw = JSON.parse(readFileSync(join(fix.home, 'logger-saw.json'), 'utf8'));
    expect(saw.item).toBeNull();
    expect(JSON.stringify(saw.args)).not.toContain('private-key');
    expect(saw.args).not.toContain('--work-item');
    expect(items(fix)).toEqual(['private-key']);
  }, 30_000);

  test('--help carries the work_item contract at the flag', () => {
    const help = runHelper(makeTelemetryFixture('off').env, ['--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('GSTACK_EXTEND_WORK_ITEM');
    expect(help.stdout).toMatch(/--work-item, else the value start saved .* else that variable at finish/);
    expect(help.stdout).toContain('at most 200 printable characters, otherwise null');
  }, 30_000);
});


describe('Track 26A construction/replay and safe diagnostics G6–G8', () => {
  test('host attribution is sampled at first finish, then retained through failed and completed explicit retries', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const install = copiedInstall(fix, 'construction-time', '1.0.0\n');
    const start = install.run(['start', '--skill', 'extend:roadmap'], { GSTACK_EXTEND_WORKSPACE_OWNER: 'start-owner', PASEO_AGENT_ID: 'start-agent' });
    expect([start.status, start.stderr]).toEqual([0, '']);
    expect(start.stdout).toMatch(/^GE_TELEMETRY: session=\S+ start=\d+\n$/);
    expect(start.stdout).not.toContain('start-owner');
    expect(start.stdout).not.toContain('start-agent');
    const initial = readHandoff(fix);
    expect(initial).not.toHaveProperty('row');
    expect(JSON.stringify(initial)).not.toContain('start-owner');
    const args = ['finish', '--skill', 'extend:roadmap', '--session-id', String(initial.session_id),
      '--start', String(initial.start), '--outcome', 'success', '--work-item', 'original-work'];
    const blocker = join(fix.home, '.gstack-extend/analytics');
    writeFileSync(blocker, '');
    const failed = install.run(args, { GSTACK_EXTEND_WORKSPACE_OWNER: 'first-finish-owner', CLAUDECODE: '1' });
    expect([failed.status, failed.stdout, failed.stderr]).toEqual([0, '', '']);
    const saved = readHandoff(fix).row as Record<string, unknown>;
    expect(saved).toMatchObject({ schema_version: 4, producer_version: '1.0.0', workspace_host: 'first-finish-owner',
      work_item: 'original-work', agent: 'claude' });
    expect(saved).not.toHaveProperty('host_agent_id');
    expect(Object.keys(saved)).toEqual(SCHEMA);
    rmSync(blocker);
    writeFileSync(install.versionFile, '1.0.1\n');
    const changed = { GSTACK_EXTEND_WORKSPACE_OWNER: 'retry-SENTINEL', PASEO_AGENT_ID: 'retry-SENTINEL', CONDUCTOR_SESSION_ID: 'conflict-SENTINEL',
      CODEX_THREAD_ID: 'different-harness', ...DEBUG };
    const retry = install.run([...args, '--agent', 'codex', '--model', 'later-model', '--work-item', 'later-work'], changed);
    expect([retry.status, retry.stdout]).toEqual([0, '']);
    expect(retry.stderr).not.toMatch(/HOST_|PRODUCER_VERSION_UNKNOWN|SENTINEL/);
    const ledger = fix.ledgerFiles()[0]!;
    const exact = JSON.stringify(saved) + '\n';
    expect(readFileSync(ledger, 'utf8')).toBe(exact);
    const usageCount = fix.readJsonl().length;
    expect(install.run(args, changed).status).toBe(0);
    expect(readFileSync(ledger, 'utf8')).toBe(exact);
    expect(fix.readJsonl()).toHaveLength(usageCount);
    const usage = JSON.stringify(fix.readJsonl()) + fix.readStubArgs().join('\n');
    for (const secret of ['first-finish-owner', 'start-owner', 'start-agent', 'workspace_host', 'host_agent_id', 'schema_version', 'producer_version']) {
      expect(usage).not.toContain(secret);
    }
  }, 30_000);

  test('immutable v1/v2/v3 and legacy rows replay in exact original field order under new host/version context', () => {
    const fix = makeTelemetryFixture('off');
    const install = copiedInstall(fix, 'historical-replay', '1.0.0\n');
    // Value: protects=historical rows retain their exact bytes under the v4 writer; fails_when=retry reconstructs version, host or source fields; why_new=T3 explicitly requires saved v3 replay; seam=none
    for (const version of ['legacy-13', 'legacy-15', 'v1', 'v2', 'v3']) {
      expect(install.run(['start', '--skill', 'extend:roadmap']).status).toBe(0);
      const state = readHandoff(fix);
      const historical = { stage: 'roadmap', agent: 'codex', model: 'gpt-5-codex', effort: 'high', rung: 0,
        outcome: 'success', started_at: '2026-09-22T14:50:06Z', duration_s: 42, session_id: state.session_id,
        repo: 'acme/widget', branch: 'main', work_item: 'historical-work', source: 'gstack-extend', route: 'conductor',
        entrypoint_raw: null, schema_version: 1, producer_version: '0.33.1.0', agent_source: 'detected',
        model_source: 'flag', effort_source: 'detected' };
      const row = Object.fromEntries(Object.entries(historical).slice(0, version.startsWith('v') ? 20 : version === 'legacy-13' ? 13 : 15));
      if (version === 'v2' || version === 'v3') {
        Object.assign(row, { schema_version: Number(version.slice(1)), workspace_host: 'paseo', host_agent_id: 'original-host' });
      }
      if (version === 'v3') {
        Object.assign(row, { run_mode: 'user-directed', run_mode_source: 'Paseo', questions: null, user_wait_s: null,
          resumes: null, user_signals_source: 'harness-unsupported', blocked_reason: null, blocked_reason_source: 'not-blocked' });
      }
      const exact = JSON.stringify(row);
      rewriteHandoff(fix, { row, done: [] });
      const args = ['finish', '--skill', 'extend:roadmap', '--session-id', String(state.session_id), '--start', String(state.start)];
      const changed = { PASEO_AGENT_ID: 'new-host', CONDUCTOR_SESSION_ID: 'conflict', ...DEBUG };
      const result = install.run([...args, '--model', 'later-model', '--work-item', 'later-work'], changed);
      expect(result.status).toBe(0);
      expect(result.stderr).not.toMatch(/HOST_|PRODUCER_VERSION_UNKNOWN/);
      const file = fix.ledgerFiles()[0]!;
      const bytes = readFileSync(file, 'utf8');
      expect(bytes.trimEnd().split('\n').at(-1)).toBe(exact);
      expect(validRow(row)).toBe(true);
      expect(install.run(args, changed).status).toBe(0);
      expect(readFileSync(file, 'utf8')).toBe(bytes);
    }
  }, 30_000);

  describe('Track 66B: requested model and effort fill only null values', () => {
    // Value: protects=launcher-requested GSTACK_EXTEND_MODEL/GSTACK_EXTEND_EFFORT fill only null model/effort with source requested while detection, flags and the CLI store-skip win;
    // fails_when=requested values overwrite detected/flag values, label as detected, read the Conductor store on cursor-agent, or leak rejected values;
    // why_new=Track 26A reserved the requested label without a producer; seam=none; no_claim=live cursor-agent invocation.
    test('cursor-agent route fills null model and effort from the launcher variables without reading the Conductor store, and finish flags win', () => {
      const env = {
        CURSOR_AGENT: '1', CURSOR_CONVERSATION_ID: 'conv-1', CURSOR_INVOKED_AS: 'cursor-agent',
        GSTACK_EXTEND_MODEL: 'requested-model', GSTACK_EXTEND_EFFORT: 'high',
      };
      const plant = (fix: TelemetryFixture) => (start: number, cwd: string) => {
        writeJsonl(join(fix.home, '.cursor/projects/project/agent-transcripts/conv-1/transcript.jsonl'),
          [{ role: 'assistant', message: 'fixture' }]);
        const root = join(fix.home, 'Library/Application Support/com.conductor.app/cursor-sdk-store/shard-a');
        writeJsonl(join(root, 'agents.ndjson'), [{ agentId: 'conv-1', cwd }]);
        writeJsonl(join(root, 'runs.ndjson'), [{
          agentId: 'conv-1', runId: 'run-1', startedAt: (start - 20) * 1000, updatedAt: start * 1000,
          endedAt: (start + 20) * 1000, model: { id: 'store-model', params: { effort: 'low' } },
        }]);
      };
      const first = makeTelemetryFixture('off');
      const { row } = cursorFinish(first, env, plant(first));
      expect(row).toMatchObject({
        agent: 'cursor', route: 'cli', model: 'requested-model', effort: 'high',
        agent_source: 'detected', model_source: 'requested', effort_source: 'requested',
      });
      expect(Object.keys(row)).toEqual(SCHEMA);
      expect(validRow(row)).toBe(true);
      expect(JSON.stringify(row)).not.toContain('store-model');

      const second = makeTelemetryFixture('off');
      const flagged = cursorFinish(second, env, plant(second), ['--model', 'flag-model']);
      expect(flagged.row).toMatchObject({
        agent: 'cursor', route: 'cli', model: 'flag-model', effort: 'high',
        agent_source: 'detected', model_source: 'flag', effort_source: 'requested',
      });
    });

    test('detection and finish flags win per field over the requested variables', () => {
      const fix = makeTelemetryFixture('off');
      const sid = '0c7f2e29-0000-4000-8000-000000000066';
      const env = {
        CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: sid,
        GSTACK_EXTEND_MODEL: 'requested-model', GSTACK_EXTEND_EFFORT: 'high',
      };
      const log = (start: number) => {
        writeJsonl(join(fix.home, '.claude/projects/-w', sid + '.jsonl'),
          [claudeTurn(start, 'c1', 'claude-fixture', null)]);
      };
      const detected = provenanceRun(fix, env, log);
      expect(detected.row).toMatchObject({
        agent: 'claude', model: 'claude-fixture', effort: 'high',
        agent_source: 'detected', model_source: 'detected', effort_source: 'requested',
      });
      const flagged = provenanceRun(fix, env, log, ['--model', 'flag-model', '--effort', 'max']);
      expect(flagged.row).toMatchObject({
        agent: 'claude', model: 'flag-model', effort: 'max',
        agent_source: 'detected', model_source: 'flag', effort_source: 'flag',
      });
    });

    test('rejected blank, non-printable and over-200-character values stay null/unknown and debug mode names only the variable and bound', () => {
      const fix = makeTelemetryFixture('off');
      const cwd = cursorWork(fix);
      const blankModel = '   \t  ';
      const longEffort = 'E'.repeat(201);
      const env = { ...fix.env, ...DEBUG, GSTACK_EXTEND_MODEL: blankModel, GSTACK_EXTEND_EFFORT: longEffort };
      const start = spawnSync(HELPER_BIN, ['start', '--skill', 'extend:roadmap'], { env, cwd, encoding: 'utf8', timeout: 15_000 });
      expect(start.status).toBe(0);
      const finish = spawnSync(HELPER_BIN, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success'], { env, cwd, encoding: 'utf8', timeout: 15_000 });
      expect([finish.status, finish.stdout]).toEqual([0, '']);
      const row = fix.readLedger().at(-1)!;
      expect(row).toMatchObject({ model: null, effort: null, model_source: 'unknown', effort_source: 'unknown' });
      expect(finish.stderr).toContain('ignored GSTACK_EXTEND_MODEL (blank; expected 1 to 200 printable characters)');
      expect(finish.stderr).toContain('ignored GSTACK_EXTEND_EFFORT (over 200 characters; expected 1 to 200 printable characters)');
      expect(finish.stderr).not.toContain(blankModel);
      expect(finish.stderr).not.toContain(longEffort);

      const controlVal = 'SECRET-MODEL\nBAD';
      const env2 = { ...fix.env, ...DEBUG, GSTACK_EXTEND_MODEL: controlVal };
      expect(spawnSync(HELPER_BIN, ['start', '--skill', 'extend:roadmap'], { env: env2, cwd, encoding: 'utf8', timeout: 15_000 }).status).toBe(0);
      const finish2 = spawnSync(HELPER_BIN, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success'], { env: env2, cwd, encoding: 'utf8', timeout: 15_000 });
      expect([finish2.status, finish2.stdout]).toEqual([0, '']);
      expect(fix.readLedger().at(-1)!).toMatchObject({ model: null, effort: null, model_source: 'unknown', effort_source: 'unknown' });
      expect(finish2.stderr).toContain('ignored GSTACK_EXTEND_MODEL (contains non-printable characters; expected 1 to 200 printable characters)');
      expect(finish2.stderr).not.toContain('SECRET-MODEL');
    });

    test('lifecycle variants: start vs finish env differences, saved-row retry byte identity, --agent override with requested values, and independent effort detection/flagging', () => {
      // (a) GSTACK_EXTEND_MODEL/EFFORT differ between start and first finish, and are unset at finish.
      const fixA = makeTelemetryFixture('off');
      const cwdA = cursorWork(fixA);
      const startEnvA1 = { ...fixA.env, GSTACK_EXTEND_MODEL: 'start-model', GSTACK_EXTEND_EFFORT: 'low' };
      const finEnvA1 = { ...fixA.env, GSTACK_EXTEND_MODEL: 'finish-model', GSTACK_EXTEND_EFFORT: 'high' };
      expect(spawnSync(HELPER_BIN, ['start', '--skill', 'extend:roadmap'], { env: startEnvA1, cwd: cwdA, encoding: 'utf8', timeout: 15_000 }).status).toBe(0);
      expect(spawnSync(HELPER_BIN, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success'], { env: finEnvA1, cwd: cwdA, encoding: 'utf8', timeout: 15_000 }).status).toBe(0);
      expect(fixA.readLedger().at(-1)!).toMatchObject({
        model: 'finish-model', effort: 'high', model_source: 'requested', effort_source: 'requested',
      });

      // Unset at finish -> null/unknown even though set at start.
      expect(spawnSync(HELPER_BIN, ['start', '--skill', 'extend:roadmap'], { env: startEnvA1, cwd: cwdA, encoding: 'utf8', timeout: 15_000 }).status).toBe(0);
      expect(spawnSync(HELPER_BIN, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success'], { env: fixA.env, cwd: cwdA, encoding: 'utf8', timeout: 15_000 }).status).toBe(0);
      expect(fixA.readLedger().at(-1)!).toMatchObject({
        model: null, effort: null, model_source: 'unknown', effort_source: 'unknown',
      });

      // (b) A saved failed finish, then a retry with different requested values: appended row equals saved row byte-for-byte.
      const fixB = makeTelemetryFixture('off');
      const cwdB = cursorWork(fixB);
      const envB1 = { ...fixB.env, GSTACK_EXTEND_MODEL: 'first-req-model', GSTACK_EXTEND_EFFORT: 'medium' };
      expect(spawnSync(HELPER_BIN, ['start', '--skill', 'extend:roadmap'], { env: envB1, cwd: cwdB, encoding: 'utf8', timeout: 15_000 }).status).toBe(0);
      const stageRunsDirB = join(fixB.home, '.gstack-extend/analytics/stage-runs');
      mkdirSync(dirname(stageRunsDirB), { recursive: true });
      writeFileSync(stageRunsDirB, 'block'); // block append so first finish saves the constructed row
      expect(spawnSync(HELPER_BIN, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success'], { env: envB1, cwd: cwdB, encoding: 'utf8', timeout: 15_000 }).status).toBe(0);
      const savedHandoffs = openHandoffs(fixB);
      expect(savedHandoffs).toHaveLength(1);
      const savedLine = JSON.stringify(savedHandoffs[0]!.state.row) + '\n';
      rmSync(stageRunsDirB, { force: true });
      const envB2 = { ...fixB.env, GSTACK_EXTEND_MODEL: 'retry-req-model', GSTACK_EXTEND_EFFORT: 'max' };
      expect(spawnSync(HELPER_BIN, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success'], { env: envB2, cwd: cwdB, encoding: 'utf8', timeout: 15_000 }).status).toBe(0);
      expect(readFileSync(fixB.ledgerFiles()[0]!, 'utf8')).toBe(savedLine);

      // (c) A valid --agent that differs from the detected agent, with requests set: agent flag, model and effort requested.
      const fixC = makeTelemetryFixture('off');
      const envC = {
        CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: '0c7f2e29-0000-4000-8000-000000000067',
        GSTACK_EXTEND_MODEL: 'req-model-c', GSTACK_EXTEND_EFFORT: 'high',
      };
      const resC = provenanceRun(fixC, envC, () => {}, ['--agent', 'codex']);
      expect(resC.row).toMatchObject({
        agent: 'codex', agent_source: 'flag',
        model: 'req-model-c', model_source: 'requested',
        effort: 'high', effort_source: 'requested',
      });

      // (d) Requested model with effort detected independently (detect() returning null model and non-null effort),
      // plus requested model with flagged --effort and no detection.
      const fixD1 = makeTelemetryFixture('off');
      const d1Script = [
        'import json, sys',
        'from unittest import mock',
        'sys.path.insert(0, sys.argv[1])',
        'import telemetry',
        'with mock.patch.object(telemetry, "detect", return_value=("claude", None, "xhigh")):',
        '    row = telemetry.provenance_row("roadmap", "sid-d1", 1790000000, 5, {"--outcome": "success"}, None)',
        'print(json.dumps(row))',
      ].join('\n');
      const runD1 = spawnSync('python3', ['-B', '-I', '-c', d1Script, join(ROOT, 'bin/lib')], {
        env: { ...fixD1.env, GSTACK_EXTEND_MODEL: 'req-claude-model', GSTACK_EXTEND_EFFORT: 'low' },
        encoding: 'utf8',
        timeout: 10_000,
      });
      expect([runD1.status, runD1.stderr]).toEqual([0, '']);
      expect(JSON.parse(runD1.stdout)).toMatchObject({
        agent: 'claude',
        model: 'req-claude-model', model_source: 'requested',
        effort: 'xhigh', effort_source: 'detected',
      });

      const fixD2 = makeTelemetryFixture('off');
      const resD2 = provenanceRun(fixD2, { GSTACK_EXTEND_MODEL: 'req-only-model' }, () => {}, ['--effort', 'flagged-effort']);
      expect(resD2.row).toMatchObject({
        model: 'req-only-model', model_source: 'requested',
        effort: 'flagged-effort', effort_source: 'flag',
      });
    }, 30_000);
  });

  test('host and producer faults give fixed next-invocation advice without values, paths or premature success', () => {
    const fix = makeTelemetryFixture('off');
    const install = copiedInstall(fix, 'PRIVATE-INSTALL-PATH', 'PRIVATE-VERSION-TEXT\n');
    const cases: Array<Record<string, string>> = [
      { GSTACK_EXTEND_WORKSPACE_OWNER: '   ' },
      { GSTACK_EXTEND_WORKSPACE_OWNER: 'PRIVATE-OWNER\nBAD' },
      { GSTACK_EXTEND_WORKSPACE_OWNER: 'PRIVATE-OWNER-' + 'x'.repeat(201) },
    ];
    for (const [index, env] of cases.entries()) {
      const args = ['finish', '--skill', 'extend:roadmap', '--start', String(epochNow() - 1), '--outcome', 'success'];
      const quiet = install.run([...args, '--session-id', 'quiet-' + index], env);
      expect([quiet.status, quiet.stdout, quiet.stderr]).toEqual([0, '', '']);
      const debug = install.run([...args, '--session-id', 'debug-' + index], { ...env, ...DEBUG });
      expect([debug.status, debug.stdout]).toEqual([0, '']);
      const diagnosis = debug.stderr.split('\n').find(line => line.includes('HOST_LABEL_INVALID'))!;
      expect(diagnosis).toContain('GSTACK_EXTEND_WORKSPACE_OWNER is not a valid host label');
      expect(diagnosis).toContain('1–200 printable Unicode code points and not blank');
      expect(diagnosis).toContain('recording workspace_host=null');
      expect(diagnosis).toContain('Saved replay cannot repair attribution');
      expect(diagnosis).toContain('set GSTACK_EXTEND_WORKSPACE_OWNER to a clean label');
      expect(diagnosis).toContain('next new invocation');
      expect(diagnosis).toContain('never invent a label or rewrite this row');
      expect(diagnosis).toContain('docs/telemetry.md#host-attribution');
      expect(debug.stderr).toContain(UNKNOWN_PRODUCER('VERSION is not a three- or four-part numeric release'));
      for (const secret of ['PRIVATE-OWNER', 'PRIVATE-VERSION-TEXT', 'PRIVATE-INSTALL-PATH']) {
        expect(debug.stderr + debug.stdout).not.toContain(secret);
      }
      // Existing debug output names its sink. The new metadata diagnostics must never name a private path.
      const metadataDiagnostics = debug.stderr.split('\n').filter(line => /HOST_|PRODUCER_VERSION_UNKNOWN/.test(line)).join('\n');
      expect(metadataDiagnostics).not.toContain(fix.home);
      expect(debug.stderr).not.toMatch(/row still records|append succeeded/);
    }
    // Retired PASEO_AGENT_ID and CONDUCTOR_SESSION_ID markers never trigger HOST_* diagnostics.
    const retiredEnv = { PASEO_AGENT_ID: 'PRIVATE-PASEO\nBAD', CONDUCTOR_SESSION_ID: 'PRIVATE-CONDUCTOR\nBAD', ...DEBUG };
    const retiredRes = install.run(['finish', '--skill', 'extend:roadmap', '--session-id', 'retired-markers', '--start', String(epochNow() - 1)], retiredEnv);
    expect(retiredRes.status).toBe(0);
    expect(retiredRes.stderr).not.toContain('HOST_');
    expect(retiredRes.stderr).not.toContain('PRIVATE-PASEO');
    expect(retiredRes.stderr).not.toContain('PRIVATE-CONDUCTOR');

    // Both diagnostics are also safe when append fails after construction.
    const blocker = join(fix.home, '.gstack-extend/analytics');
    renameSync(blocker, blocker + '.kept');
    writeFileSync(blocker, '');
    const failed = install.run(['finish', '--skill', 'extend:roadmap', '--session-id', 'failed-advice',
      '--start', String(epochNow() - 1)], { ...cases[1], ...DEBUG });
    expect(failed.status).toBe(0);
    expect(failed.stderr).toContain('HOST_LABEL_INVALID');
    expect(failed.stderr).not.toMatch(/row still records|append succeeded/);
  }, 30_000);
});

// ─── Track 53A: paused and resumed runs are segments ───

describe('deliberate pauses finish as blocked, and each resume is its own segment', () => {
  // Value: protects=a deliberate pause leaves one blocked row per resumable skill; fails_when=OUTCOMES drops blocked or
  // the logger sees another value; why_new=the contract reserved blocked but nothing emitted it; seam=none;
  // no_claim=live harness attribution.
  test('a blocked finish records blocked in the ledger and the logger for every resumable skill', () => {
    for (const name of ['review-and-prep', 'pair-review', 'full-review']) {
      const fix = makeTelemetryFixture('community', 'stub');
      const skill = `extend:${name}`;
      const sid = startRun(fix, skill);
      expect(finishRun(fix, 'blocked', skill).status).toBe(0);
      const rows = fix.readLedger();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ stage: name, outcome: 'blocked', schema_version: 4, session_id: sid });
      expect(fix.readStubArgs().some(line => line.split('\t').join(' ').includes('--outcome blocked'))).toBe(true);
      const runs = skillRuns(fix);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ outcome: 'blocked', session_id: sid });
      expect(handoffs(fix)).toHaveLength(0);
    }
  }, 30_000);

  test('an outcome outside the vocabulary still records unknown', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    startRun(fix, 'extend:pair-review');
    expect(finishRun(fix, 'paused', 'extend:pair-review').status).toBe(0);
    expect(fix.readLedger().map(row => row.outcome)).toEqual(['unknown']);
  }, 30_000);

  test('a start-less finish of a resumable skill adopts the newest exact segment and leaves the older start open', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const skill = 'extend:pair-review';
    const older = startRun(fix, skill, { CODEX_THREAD_ID: 'thread-a' });
    const newer = startRun(fix, skill, { CODEX_THREAD_ID: 'thread-a' });
    const done = finishRun(fix, 'success', skill, { ...DEBUG, CODEX_THREAD_ID: 'thread-a' });
    expect(done.status).toBe(0);
    expect(adoptionLine(done.stderr)).toContain(`session=${newer}`);
    expect(adoptionLine(done.stderr)).toContain('pairing=resumable (exact)');
    expect(runSessions(fix)).toEqual([newer]);
    expect(openHandoffs(fix).map(item => item.state.session_id)).toEqual([older]);
  }, 30_000);

  test('a paused run resumed in another checkout records each segment, and each start pairs with exactly one finish', () => {
    for (const withItem of [true, false]) {
      const fix = makeTelemetryFixture('community', 'stub');
      const rootA = gitRepo(fix, 'root-a');
      const rootB = gitRepo(fix, 'root-b');
      const skill = 'extend:review-and-prep';
      const item = withItem ? { GSTACK_EXTEND_WORK_ITEM: 'W-53A' } : {};
      const call = (cwd: string, args: string[], env: Record<string, string>) =>
        runHelper({ ...fix.env, ...item, ...env }, args, cwd);
      expect(call(rootA, ['start', '--skill', skill], { CODEX_THREAD_ID: 'thread-a' }).status).toBe(0);
      expect(call(rootA, ['finish', '--skill', skill, '--outcome', 'blocked'], { CODEX_THREAD_ID: 'thread-a' }).status).toBe(0);
      expect(call(rootB, ['start', '--skill', skill], { CODEX_THREAD_ID: 'thread-b' }).status).toBe(0);
      expect(call(rootB, ['finish', '--skill', skill, '--outcome', 'success'], { CODEX_THREAD_ID: 'thread-b' }).status).toBe(0);
      const rows = fix.readJsonl();
      const starts = rows.filter(row => row.event_type === 'skill_start');
      const runs = rows.filter(row => row.event_type === 'skill_run');
      expect(starts).toHaveLength(2);
      expect(runs).toHaveLength(2);
      expect(runs.map(row => row.outcome)).toEqual(['blocked', 'success']);
      expect(new Set(starts.map(row => row.session_id)).size).toBe(2);
      expect(runs.map(row => row.session_id)).toEqual(starts.map(row => row.session_id));
      const ledger = fix.readLedger();
      expect(ledger.map(row => row.outcome)).toEqual(['blocked', 'success']);
      expect(ledger.map(row => row.work_item)).toEqual(withItem ? ['W-53A', 'W-53A'] : [null, null]);
      expect(handoffs(fix)).toHaveLength(0);
      const doctor = spawnSync(join(ROOT, 'bin/gstack-extend'), ['doctor', 'telemetry', '--json'], { env: fix.env, encoding: 'utf8', timeout: 20_000 });
      expect(doctor.status).toBe(0);
      const entry = JSON.parse(doctor.stdout).skills.find((skillEntry: { skill: string }) => skillEntry.skill === 'review-and-prep');
      expect(entry).toMatchObject({
        activations: 2, completions: 2, paired: 2, deferred_finish: 0, unpaired_start: 0, unpaired_finish: 0,
      });
    }
  }, 60_000);
});

describe('stage-runs v3: run_mode, Claude usability signals, blocked_reason, per-host files, and report', () => {
  test('run_mode and run_mode_source cover every amended branch without reading credential sentinels or spawning process-inspection utilities', () => {
    const fix = makeTelemetryFixture('off');
    const customGstackHome = join(fix.home, 'custom-gstack-root');
    mkdirSync(customGstackHome, { recursive: true });

    const cases: Array<{
      name: string;
      startEnv?: Record<string, string>;
      finishEnv?: Record<string, string>;
      finishArgs?: string[];
      mode: string;
      source: string;
    }> = [
      {
        name: 'GSTACK_EXTEND_RUN_MODE=orchestrated',
        finishEnv: { GSTACK_EXTEND_RUN_MODE: 'orchestrated', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
        mode: 'orchestrated',
        source: 'run-mode-env',
      },
      {
        name: 'GSTACK_EXTEND_RUN_MODE unrecognized value',
        finishEnv: { GSTACK_EXTEND_RUN_MODE: 'user-directed', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
        mode: 'unknown',
        source: 'unrecognized-run-mode-env',
      },
      {
        name: 'GSTACK_SESSION_KIND=spawned primary signal',
        finishEnv: { GSTACK_SESSION_KIND: 'spawned', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
        mode: 'orchestrated',
        source: 'session-kind',
      },
      {
        name: 'GSTACK_SESSION_KIND=unattended primary signal',
        finishEnv: { GSTACK_SESSION_KIND: 'unattended', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
        mode: 'orchestrated',
        source: 'session-kind',
      },
      {
        name: 'GSTACK_EXTEND_WORK_ITEM at start primary signal',
        startEnv: { GSTACK_EXTEND_WORK_ITEM: 'item-from-start' },
        finishEnv: { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
        mode: 'orchestrated',
        source: 'work-item',
      },
      {
        name: 'GSTACK_EXTEND_WORK_ITEM at finish primary signal',
        finishEnv: { GSTACK_EXTEND_WORK_ITEM: 'item-from-finish', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
        mode: 'orchestrated',
        source: 'work-item',
      },
      {
        name: 'precedence: session-kind beats work-item and run-mode-env',
        finishEnv: {
          GSTACK_SESSION_KIND: 'spawned',
          GSTACK_EXTEND_WORK_ITEM: 'item-both',
          GSTACK_EXTEND_RUN_MODE: 'orchestrated',
        },
        mode: 'orchestrated',
        source: 'session-kind',
      },
      {
        name: 'precedence: work-item beats run-mode-env',
        finishEnv: {
          GSTACK_EXTEND_WORK_ITEM: 'item-wins',
          GSTACK_EXTEND_RUN_MODE: 'orchestrated',
        },
        mode: 'orchestrated',
        source: 'work-item',
      },
      {
        name: '--work-item CLI flag alone does not set orchestrated',
        finishEnv: { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
        finishArgs: ['--work-item', 'manual-item'],
        mode: 'user-directed',
        source: 'cli',
      },
      {
        name: 'non-default GSTACK_HOME blocks user-directed',
        finishEnv: { GSTACK_HOME: customGstackHome, CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
        mode: 'unknown',
        source: 'launcher-state-root',
      },
      {
        name: 'spawned signal remains orchestrated with relocated GSTACK_HOME',
        finishEnv: { GSTACK_SESSION_KIND: 'spawned', GSTACK_HOME: customGstackHome, CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
        mode: 'orchestrated',
        source: 'session-kind',
      },
      {
        name: 'default ~/.gstack GSTACK_HOME allows user-directed',
        finishEnv: { GSTACK_HOME: join(fix.home, '.gstack') + '/', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
        mode: 'user-directed',
        source: 'cli',
      },
      {
        name: 'malformed GSTACK_SESSION_KIND blocks user-directed with malformed-signal',
        finishEnv: { GSTACK_SESSION_KIND: 'bogus', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
        mode: 'unknown',
        source: 'malformed-signal',
      },
      {
        name: 'malformed GSTACK_EXTEND_WORK_ITEM blocks user-directed with malformed-signal',
        finishEnv: { GSTACK_EXTEND_WORK_ITEM: '   ', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
        mode: 'unknown',
        source: 'malformed-signal',
      },
      {
        name: 'GSTACK_EXTEND_WORKSPACE_OWNER valid label gives host-managed-workspace',
        finishEnv: { GSTACK_EXTEND_WORKSPACE_OWNER: 'paseo', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
        mode: 'unknown',
        source: 'host-managed-workspace',
      },
      {
        name: 'GSTACK_EXTEND_WORKSPACE_OWNER empty string is treated as unset and allows user-directed',
        finishEnv: { GSTACK_EXTEND_WORKSPACE_OWNER: '', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
        mode: 'user-directed',
        source: 'cli',
      },
      {
        name: 'GSTACK_EXTEND_WORKSPACE_OWNER whitespace-only gives host-managed-workspace',
        finishEnv: { GSTACK_EXTEND_WORKSPACE_OWNER: '   ', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
        mode: 'unknown',
        source: 'host-managed-workspace',
      },
      {
        name: 'GSTACK_EXTEND_WORKSPACE_OWNER non-printable gives host-managed-workspace',
        finishEnv: { GSTACK_EXTEND_WORKSPACE_OWNER: 'owner\nbad', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
        mode: 'unknown',
        source: 'host-managed-workspace',
      },
      {
        name: 'GSTACK_EXTEND_WORKSPACE_OWNER over 200 chars gives host-managed-workspace',
        finishEnv: { GSTACK_EXTEND_WORKSPACE_OWNER: 'x'.repeat(201), CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
        mode: 'unknown',
        source: 'host-managed-workspace',
      },
      {
        name: 'Claude cli entrypoint gives user-directed / cli',
        finishEnv: { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
        mode: 'user-directed',
        source: 'cli',
      },
      {
        name: 'Claude Paseo entrypoint gives user-directed / paseo-entrypoint (PASEO_AGENT_ID ignored)',
        finishEnv: { PASEO_AGENT_ID: 'p-1', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'Paseo' },
        mode: 'user-directed',
        source: 'paseo-entrypoint',
      },
      {
        name: 'Claude sdk-cli entrypoint gives entrypoint-unqualified even with PASEO_AGENT_ID set',
        finishEnv: { PASEO_AGENT_ID: 'p-2', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' },
        mode: 'unknown',
        source: 'entrypoint-unqualified',
      },
      {
        name: 'Claude sdk-ts entrypoint gives entrypoint-unqualified even with PASEO_AGENT_ID set',
        finishEnv: { PASEO_AGENT_ID: 'p-3', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' },
        mode: 'unknown',
        source: 'entrypoint-unqualified',
      },
      {
        name: 'Claude acp entrypoint gives entrypoint-unqualified even with PASEO_AGENT_ID set',
        finishEnv: { PASEO_AGENT_ID: 'p-4', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'acp' },
        mode: 'unknown',
        source: 'entrypoint-unqualified',
      },
      {
        name: 'Claude claude-desktop entrypoint gives entrypoint-unqualified',
        finishEnv: { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' },
        mode: 'unknown',
        source: 'entrypoint-unqualified',
      },
      {
        name: 'Claude remote-daemon entrypoint gives entrypoint-unqualified',
        finishEnv: { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'remote-daemon' },
        mode: 'unknown',
        source: 'entrypoint-unqualified',
      },
      {
        name: 'Claude missing entrypoint gives entrypoint-unavailable',
        finishEnv: { CLAUDECODE: '1' },
        mode: 'unknown',
        source: 'entrypoint-unavailable',
      },
      {
        name: 'Claude empty entrypoint gives entrypoint-unavailable',
        finishEnv: { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: '' },
        mode: 'unknown',
        source: 'entrypoint-unavailable',
      },
      {
        name: 'Claude whitespace-only entrypoint gives entrypoint-unavailable',
        finishEnv: { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: '   ' },
        mode: 'unknown',
        source: 'entrypoint-unavailable',
      },
      {
        name: 'Claude non-printable entrypoint gives entrypoint-unavailable',
        finishEnv: { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli\nbad' },
        mode: 'unknown',
        source: 'entrypoint-unavailable',
      },
      {
        name: 'codex markers only gives harness-unqualified',
        finishEnv: { CODEX_THREAD_ID: '01a0c487-19ac-7903-89d9-d1642a113349' },
        mode: 'unknown',
        source: 'harness-unqualified',
      },
      {
        name: 'cursor markers only gives harness-unqualified',
        finishEnv: { CURSOR_AGENT: '1', CURSOR_CONVERSATION_ID: 'conv-rm-1', CURSOR_INVOKED_AS: 'cursor-agent' },
        mode: 'unknown',
        source: 'harness-unqualified',
      },
      {
        name: 'grok markers only gives harness-unqualified',
        finishEnv: { GROK_AGENT: '1', GROK_SESSION_ID: 'grok-rm-1' },
        mode: 'unknown',
        source: 'harness-unqualified',
      },
      {
        name: '--agent codex override on Claude cli gives harness-unqualified',
        finishEnv: { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
        finishArgs: ['--agent', 'codex'],
        mode: 'unknown',
        source: 'harness-unqualified',
      },
      {
        name: 'no markers at all gives no-harness',
        finishEnv: {},
        mode: 'unknown',
        source: 'no-harness',
      },
    ];

    // Value: protects=explicit orchestration wins for all harness/owner combinations; fails_when=host or harness qualification runs before override; why_new=T5 requires the ten-case cross product; seam=none
    for (const [name, harness] of [
      ['Claude cli', { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' }],
      ['Claude Paseo', { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'Paseo' }],
      ['Codex', { CODEX_THREAD_ID: 'synthetic-codex' }],
      ['Cursor', { CURSOR_AGENT: '1' }],
      ['Grok', { GROK_AGENT: '1', GROK_SESSION_ID: 'synthetic-grok' }],
    ] as Array<[string, Record<string, string>]>) {
      for (const owner of ['', 'fixture-owner']) {
        cases.push({ name: `${name} orchestration override owner=${owner || 'unset'}`,
          finishEnv: { ...harness, GSTACK_EXTEND_RUN_MODE: 'orchestrated', GSTACK_EXTEND_WORKSPACE_OWNER: owner },
          mode: 'orchestrated', source: 'run-mode-env' });
      }
    }
    cases.push({ name: 'relative GSTACK_HOME is malformed supporting evidence',
      finishEnv: { GSTACK_HOME: 'relative-root', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
      mode: 'unknown', source: 'malformed-signal' });

    for (const tc of cases) {
      const start = runHelper({ ...fix.env, ...(tc.startEnv ?? tc.finishEnv ?? {}) }, ['start', '--skill', 'extend:roadmap']);
      expect(start.status, tc.name).toBe(0);
      const finish = runHelper(
        { ...fix.env, ...(tc.finishEnv ?? {}) },
        ['finish', '--skill', 'extend:roadmap', '--outcome', 'success', ...(tc.finishArgs ?? [])],
      );
      expect(finish.status, tc.name).toBe(0);
      const row = fix.readLedger().at(-1)!;
      expect(row.run_mode, tc.name).toBe(tc.mode);
      expect(row.run_mode_source, tc.name).toBe(tc.source);
      expect(validRow(row), tc.name).toBe(true);
    }

    // Plant only synthetic credentials under the fixture HOME; the audit must never open them.
    const credentialSentinels = join(fix.home, 'credential-sentinels');
    mkdirSync(credentialSentinels);
    for (const name of ['credentials.json', 'token-store.json', 'cli-auth.json']) {
      writeFileSync(join(credentialSentinels, name), 'SYNTHETIC_CREDENTIAL_CANARY');
    }
    const auditSid = '0c7f2e29-0000-4000-8000-000000000093';
    writeJsonl(join(fix.home, '.claude/projects/audit', `${auditSid}.jsonl`), [
      {
        type: 'assistant', timestamp: iso(1790000001),
        message: {
          id: 'audit-assistant', role: 'assistant', model: 'claude-opus-4-6', stop_reason: 'tool_use',
          content: [{ type: 'tool_use', id: 'audit-question', name: 'AskUserQuestion', input: { question: 'AUDIT_QUESTION_CANARY' } }],
        },
      },
      {
        type: 'user', timestamp: iso(1790000004),
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'audit-question', content: 'AUDIT_ANSWER_CANARY' }] },
      },
    ]);

    // Criterion 6: Verify via Python sys.addaudithook and inspect.getsource that run_mode,
    // claude_user_signals, host_file_name, stage_run_files, and run_report never use network,
    // subprocess, sqlite3, or credential paths.
    const auditScript = [
      'import inspect, io, json, pathlib, sys',
      'from unittest import mock',
      'sys.path.insert(0, sys.argv[1])',
      'import telemetry',
      'for fn in (telemetry.run_mode, telemetry.claude_user_signals, telemetry.host_file_name, telemetry.stage_run_files, telemetry.run_report):',
      '    src = inspect.getsource(fn)',
      '    for forbidden in ("socket", "subprocess", "urllib.request", "http", "ssl"):',
      '        assert forbidden not in src, f"{fn.__name__} references {forbidden}"',
      'bad = []',
      'def hook(event, args):',
      '    if event.startswith("socket.") or event in ("subprocess.Popen", "os.system", "sqlite3.connect"):',
      '        bad.append((event, str(args[:1])))',
      '    elif event in ("os.listdir", "os.scandir", "open", "os.stat"):',
      '        target = str(args[0]) if args else ""',
      '        if "credential-sentinels" in target:',
      '            bad.append((event, target))',
      'sys.addaudithook(hook)',
      'state = pathlib.Path(sys.argv[2])',
      'telemetry.run_mode("claude", "claude", None)',
      'with mock.patch.dict(telemetry.os.environ, {}, clear=True):',
      '    assert telemetry.run_mode("claude", "claude", "bad\\nitem") == ("unknown", "malformed-signal")',
      'signals = telemetry.claude_user_signals("0c7f2e29-0000-4000-8000-000000000093", 1790000000, 1790000010)',
      'telemetry.host_file_name(state, "My.Host_01.local")',
      'telemetry.stage_run_files(state)',
      'buf = io.StringIO()',
      'old_stdout = sys.stdout',
      'sys.stdout = buf',
      'try:',
      '    rc = telemetry.run_report(["--json"])',
      'finally:',
      '    sys.stdout = old_stdout',
      'row = telemetry.provenance_row("roadmap", "sid-audit", 1790000000, 1, {"--outcome": "success"}, None)',
      'print(json.dumps({"bad": bad, "rc": rc, "ok": row["schema_version"] == 4, "signals": signals}))',
    ].join('\n');
    const audit = spawnSync('python3', ['-B', '-I', '-c', auditScript, join(ROOT, 'bin/lib'), join(fix.home, '.gstack-extend')], {
      env: { ...fix.env, CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect([audit.status, audit.stderr]).toEqual([0, '']);
    expect(JSON.parse(audit.stdout)).toEqual({ bad: [], rc: 0, ok: true, signals: [1, 3, 0] });
  }, 60_000);

  test('claude_user_signals extracts questions, user_wait_s, and resumes without leaking prompt or answer text, and records null reasons', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const sid = '0c7f2e29-0000-4000-8000-000000000099';
    const env = { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CODE_SESSION_ID: sid };
    const transcript = join(fix.home, '.claude/projects/project', `${sid}.jsonl`);

    // Case 1: 2 AskUserQuestion blocks (one split across 2 entries with the same id), their tool_result waits,
    // an end_turn followed by a human prompt, a sidechain ask ignored, records outside window ignored,
    // and canary strings in question input, answer, toolUseResult, and prompt never appearing anywhere.
    const begin1 = epochNow() - 60;
    const debugEnv = { ...fix.env, ...env, ...DEBUG };
    const start = runHelper(debugEnv, ['start', '--skill', 'extend:roadmap']);
    expect(start.status).toBe(0);
    writeJsonl(transcript, [
      // Outside window (before begin1 - 5) -> ignored
      {
        type: 'assistant',
        timestamp: iso(begin1 - 20),
        effort: 'high',
        message: {
          id: 'msg-early',
          model: 'claude-opus-4-6',
          role: 'assistant',
          stop_reason: 'end_turn',
          content: [
            { type: 'tool_use', id: 'toolu_early', name: 'AskUserQuestion', input: { question: 'EARLY_CANARY' } },
          ],
        },
      },
      {
        type: 'user',
        timestamp: iso(begin1 - 15),
        message: { role: 'user', content: 'EARLY_PROMPT_CANARY' },
      },
      {
        type: 'assistant',
        timestamp: iso(begin1 + 1),
        effort: 'high',
        message: {
          id: 'msg-turn-1',
          model: 'claude-opus-4-6',
          role: 'assistant',
          stop_reason: 'tool_use',
          content: [
            { type: 'tool_use', id: 'toolu_q1', name: 'AskUserQuestion', input: { question: 'QUESTION_CANARY_SECRET_1' } },
          ],
        },
      },
      // Duplicate streaming record for the same assistant message.id and tool_use.id
      {
        type: 'assistant',
        timestamp: iso(begin1 + 2),
        effort: 'high',
        message: {
          id: 'msg-turn-1',
          model: 'claude-opus-4-6',
          role: 'assistant',
          stop_reason: 'tool_use',
          content: [
            { type: 'tool_use', id: 'toolu_q1', name: 'AskUserQuestion', input: { question: 'QUESTION_CANARY_SECRET_1' } },
          ],
        },
      },
      // Sidechain AskUserQuestion must be ignored
      {
        type: 'assistant',
        isSidechain: true,
        timestamp: iso(begin1 + 3),
        message: {
          id: 'msg-sidechain',
          model: 'claude-opus-4-6',
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_side', name: 'AskUserQuestion', input: { question: 'SIDECHAIN_QUESTION' } },
          ],
        },
      },
      {
        type: 'user',
        timestamp: iso(begin1 + 16),
        toolUseResult: { answers: { q: 'TOOL_USE_RESULT_CANARY_SECRET' } },
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_q1', content: 'ANSWER_CANARY_SECRET_1' },
          ],
        },
      },
      {
        type: 'assistant',
        timestamp: iso(begin1 + 20),
        effort: 'high',
        message: {
          id: 'msg-turn-2',
          model: 'claude-opus-4-6',
          role: 'assistant',
          stop_reason: 'tool_use',
          content: [
            { type: 'tool_use', id: 'toolu_q2', name: 'AskUserQuestion', input: { question: 'QUESTION_CANARY_SECRET_2' } },
          ],
        },
      },
      {
        type: 'user',
        timestamp: iso(begin1 + 40),
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_q2', content: 'ANSWER_CANARY_SECRET_2' },
          ],
        },
      },
      // Assistant finishes turn with end_turn at begin1 + 42, then human prompt restarts at begin1 + 47 -> 1 resume (+5s wait)
      {
        type: 'assistant',
        timestamp: iso(begin1 + 42),
        effort: 'high',
        message: {
          id: 'msg-turn-3',
          model: 'claude-opus-4-6',
          role: 'assistant',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'Done with phase 1.' }],
        },
      },
      {
        type: 'user',
        timestamp: iso(begin1 + 47),
        message: { role: 'user', content: 'USER_PROMPT_CANARY_SECRET' },
      },
    ]);

    // Force a saved-row retry so the privacy assertions cover the actual handoff and marker bytes.
    const ledgerDir = join(fix.home, '.gstack-extend/analytics/stage-runs');
    mkdirSync(dirname(ledgerDir), { recursive: true });
    writeFileSync(ledgerDir, 'synthetic sink blocker');
    const finishArgs = ['finish', '--skill', 'extend:roadmap', '--start', String(begin1), '--outcome', 'success'];
    const blockedFinish = runHelper(debugEnv, finishArgs);
    expect(blockedFinish.status).toBe(0);
    expect(handoffs(fix)).toHaveLength(1);
    const handoffBytes = readFileSync(join(fix.home, '.gstack-extend/telemetry', handoffs(fix)[0]!), 'utf8');
    expect(JSON.parse(handoffBytes).row.questions).toBe(2);
    rmSync(ledgerDir);
    const retriedFinish = runHelper(debugEnv, finishArgs);
    expect(retriedFinish.status).toBe(0);
    expect(handoffs(fix)).toHaveLength(0);
    const completionMarkers = markers(fix);
    expect(completionMarkers).toHaveLength(1);
    expect(fix.readStubArgs()).toHaveLength(1);
    const res1 = { row: fix.readLedger().at(-1)! };

    expect(res1.row).toMatchObject({
      agent: 'claude',
      model: 'claude-opus-4-6',
      effort: 'high',
      run_mode: 'user-directed',
      run_mode_source: 'cli',
      questions: 2,
      user_wait_s: 40, // (16 - 1) + (40 - 20) + (47 - 42)
      resumes: 1, // 1 human prompt after end_turn
      user_signals_source: 'session-log',
    });
    expect(validRow(res1.row)).toBe(true);
    const leakedCorpus = JSON.stringify({
      row: res1.row,
      usage: fix.readJsonl(),
      ledger: readFileSync(join(ledgerDir, HOST_LEDGER_FILE), 'utf8'),
      handoff: handoffBytes,
      markers: completionMarkers.map(marker => readFileSync(marker.path, 'utf8')),
      stubArgs: fix.readStubArgs(),
      output: [start, blockedFinish, retriedFinish].map(result => ({ stdout: result.stdout, stderr: result.stderr })),
    });
    for (const secret of [
      'USER_PROMPT_CANARY_SECRET',
      'QUESTION_CANARY_SECRET_1',
      'QUESTION_CANARY_SECRET_2',
      'ANSWER_CANARY_SECRET_1',
      'ANSWER_CANARY_SECRET_2',
      'TOOL_USE_RESULT_CANARY_SECRET',
    ]) {
      expect(leakedCorpus).not.toContain(secret);
    }

    // Null reason: orchestrated
    const orch = provenanceRun(fix, { ...env, GSTACK_SESSION_KIND: 'spawned' }, () => {}, ['--outcome', 'success']);
    expect(orch.row).toMatchObject({
      run_mode: 'orchestrated',
      run_mode_source: 'session-kind',
      questions: null,
      user_wait_s: null,
      resumes: null,
      user_signals_source: 'orchestrated',
    });
    expect(validRow(orch.row)).toBe(true);

    // Null reason: no-harness
    const noHarness = provenanceRun(fix, {}, () => {}, ['--outcome', 'success']);
    expect(noHarness.row).toMatchObject({
      agent: null,
      questions: null,
      user_wait_s: null,
      resumes: null,
      user_signals_source: 'no-harness',
    });
    expect(validRow(noHarness.row)).toBe(true);

    // Null reason: harness-unsupported (codex detected, and --agent override on claude)
    const codexUnsupported = provenanceRun(fix, { CODEX_THREAD_ID: '01a0c487-19ac-7903-89d9-d1642a113349' }, () => {}, ['--outcome', 'success']);
    expect(codexUnsupported.row).toMatchObject({
      agent: 'codex',
      questions: null,
      user_wait_s: null,
      resumes: null,
      user_signals_source: 'harness-unsupported',
    });
    for (const [agent, unsupportedEnv] of [
      ['grok', { GROK_AGENT: '1', GROK_SESSION_ID: 'synthetic-grok-session' }],
      ['cursor', { CURSOR_AGENT: '1', CURSOR_INVOKED_AS: 'cursor-agent', CURSOR_CONVERSATION_ID: 'synthetic-cursor-session' }],
    ] as Array<[string, Record<string, string>]>) {
      const unsupported = provenanceRun(fix, unsupportedEnv, () => {}, ['--outcome', 'success']);
      expect(unsupported.row).toMatchObject({
        agent,
        questions: null,
        user_wait_s: null,
        resumes: null,
        user_signals_source: 'harness-unsupported',
      });
      expect(validRow(unsupported.row)).toBe(true);
    }
    const flagOverride = provenanceRun(fix, env, () => {}, ['--outcome', 'success', '--agent', 'codex']);
    expect(flagOverride.row).toMatchObject({
      agent: 'codex',
      questions: null,
      user_wait_s: null,
      resumes: null,
      user_signals_source: 'harness-unsupported',
    });

    // Null reason: session-log-unavailable (missing/FIFO log, idle window, clipped tail)
    const sidMissing = '0c7f2e29-0000-4000-8000-000000000097';
    const resMissing = provenanceRun(fix, { ...env, CLAUDE_CODE_SESSION_ID: sidMissing }, () => {}, ['--outcome', 'success']);
    expect(resMissing.row).toMatchObject({
      questions: null,
      user_wait_s: null,
      resumes: null,
      user_signals_source: 'session-log-unavailable',
    });
    expect(validRow(resMissing.row)).toBe(true);

    const sidFifo = '0c7f2e29-0000-4000-8000-000000000094';
    const transcriptFifo = join(fix.home, '.claude/projects/project', `${sidFifo}.jsonl`);
    const fifo = spawnSync('mkfifo', [transcriptFifo], { encoding: 'utf8', timeout: 5_000 });
    expect([fifo.status, fifo.stderr]).toEqual([0, '']);
    const resFifo = provenanceRun(fix, { ...env, CLAUDE_CODE_SESSION_ID: sidFifo }, () => {}, ['--outcome', 'success']);
    expect(resFifo.row).toMatchObject({
      agent: 'claude',
      questions: null,
      user_wait_s: null,
      resumes: null,
      user_signals_source: 'session-log-unavailable',
    });
    expect(validRow(resFifo.row)).toBe(true);

    const sidIdle = '0c7f2e29-0000-4000-8000-000000000096';
    const transcriptIdle = join(fix.home, '.claude/projects/project', `${sidIdle}.jsonl`);
    const resIdle = provenanceRun(fix, { ...env, CLAUDE_CODE_SESSION_ID: sidIdle }, start => {
      writeJsonl(transcriptIdle, [claudeTurn(start - 60, 'old-msg', 'claude-opus-4-6', 'high')]);
    }, ['--outcome', 'success']);
    expect(resIdle.row).toMatchObject({
      questions: null,
      user_wait_s: null,
      resumes: null,
      user_signals_source: 'session-log-unavailable',
    });

    const sidBig = '0c7f2e29-0000-4000-8000-000000000095';
    const transcriptBig = join(fix.home, '.claude/projects/project', `${sidBig}.jsonl`);
    const resBig = provenanceRun(fix, { ...env, CLAUDE_CODE_SESSION_ID: sidBig }, start => {
      mkdirSync(dirname(transcriptBig), { recursive: true });
      const line = JSON.stringify(claudeTurn(start + 10, 'late-msg', 'claude-opus-4-6', 'high', { pad: 'x'.repeat(4096) })) + '\n';
      const count = Math.ceil((8 * 1024 * 1024 + 65536) / line.length);
      writeFileSync(transcriptBig, line.repeat(count));
    }, ['--outcome', 'success']);
    expect(resBig.row).toMatchObject({
      questions: null,
      user_wait_s: null,
      resumes: null,
      user_signals_source: 'session-log-unavailable',
    });
  }, 60_000);

  test('--blocked-reason covers all four sources, validates token format without echoing bad input, and never forwards to gstack logger', () => {
    const fix = makeTelemetryFixture('community', 'stub');
    const cliEnv = { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' };

    // 1. flag source
    const okBlocked = provenanceRun(fix, cliEnv, undefined, ['--outcome', 'blocked', '--blocked-reason', 'missing-deploy-creds']);
    expect(okBlocked.row).toMatchObject({
      outcome: 'blocked',
      blocked_reason: 'missing-deploy-creds',
      blocked_reason_source: 'flag',
    });
    expect(validRow(okBlocked.row)).toBe(true);
    const forwarded = fix.readStubArgs().join('\n');
    expect(forwarded).not.toContain('--blocked-reason');
    expect(forwarded).not.toContain('missing-deploy-creds');

    // 2. not-supplied source
    const noFlagBlocked = provenanceRun(fix, cliEnv, undefined, ['--outcome', 'blocked']);
    expect(noFlagBlocked.row).toMatchObject({
      outcome: 'blocked',
      blocked_reason: null,
      blocked_reason_source: 'not-supplied',
    });
    expect(validRow(noFlagBlocked.row)).toBe(true);

    // 3. orchestrated source (even when outcome is blocked and flag is supplied)
    const orchBlocked = provenanceRun(
      fix,
      { ...cliEnv, GSTACK_SESSION_KIND: 'spawned' },
      undefined,
      ['--outcome', 'blocked', '--blocked-reason', 'missing-deploy-creds'],
    );
    expect(orchBlocked.row).toMatchObject({
      run_mode: 'orchestrated',
      outcome: 'blocked',
      blocked_reason: null,
      blocked_reason_source: 'orchestrated',
    });
    expect(validRow(orchBlocked.row)).toBe(true);

    // 4. not-blocked source
    const onSuccess = runHelper({ ...fix.env, ...cliEnv, ...DEBUG }, [
      'finish', '--skill', 'extend:roadmap', '--start', String(epochNow() - 2), '--session-id', 'sid-br-1',
      '--outcome', 'success', '--blocked-reason', 'NON_BLOCKED_SECRET_REASON',
    ]);
    expect(onSuccess.status).toBe(0);
    expect(onSuccess.stderr).toContain('ignored --blocked-reason flag (outcome is not blocked');
    expect(onSuccess.stderr).not.toContain('NON_BLOCKED_SECRET_REASON');
    expect(fix.readLedger().find(r => r.session_id === 'sid-br-1')).toMatchObject({
      outcome: 'success',
      blocked_reason: null,
      blocked_reason_source: 'not-blocked',
    });

    // Invalid token on blocked outcome -> null + not-supplied, value never echoed in debug
    const badToken = runHelper({ ...fix.env, ...cliEnv, ...DEBUG }, [
      'finish', '--skill', 'extend:roadmap', '--start', String(epochNow() - 2), '--session-id', 'sid-br-2',
      '--outcome', 'blocked', '--blocked-reason', 'BAD TOKEN WITH SPACES SECRET',
    ]);
    expect(badToken.status).toBe(0);
    expect(badToken.stderr).toContain('ignored --blocked-reason flag (invalid token');
    expect(badToken.stderr).not.toContain('BAD TOKEN WITH SPACES SECRET');
    expect(fix.readLedger().find(r => r.session_id === 'sid-br-2')).toMatchObject({
      outcome: 'blocked',
      blocked_reason: null,
      blocked_reason_source: 'not-supplied',
    });
  }, 30_000);

  test('per-host files: host_id config override, nodename sanitization, symlink refusal + handoff retry, v2 retry, and byte-identical legacy file', () => {
    const fix = makeTelemetryFixture('off');
    mkdirSync(join(fix.home, '.gstack-extend'), { recursive: true });

    // 1. Valid host_id config override writes to analytics/stage-runs/<host_id>.jsonl
    writeFileSync(join(fix.home, '.gstack-extend/config'), 'host_id=desk-01\n');
    const r1 = provenanceRun(fix, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' }, undefined, ['--outcome', 'success']);
    expect(r1.row.session_id).toBeDefined();
    expect(existsSync(join(fix.home, '.gstack-extend/analytics/stage-runs/desk-01.jsonl'))).toBe(true);

    // 2. Invalid host_id config value is ignored with value-free debug trace and falls back to sanitized hostname
    writeFileSync(join(fix.home, '.gstack-extend/config'), 'host_id=BAD_HOST_SECRET!\n');
    const r2 = runHelper({ ...fix.env, ...DEBUG }, [
      'finish', '--skill', 'extend:roadmap', '--start', String(epochNow() - 2), '--session-id', 'sid-fallback-host', '--outcome', 'success',
    ]);
    expect(r2.status).toBe(0);
    expect(r2.stderr).toContain('ignored invalid host_id config value');
    expect(r2.stderr).not.toContain('BAD_HOST_SECRET!');
    expect(existsSync(join(fix.home, '.gstack-extend/analytics/stage-runs', HOST_LEDGER_FILE))).toBe(true);

    // 3. In-process nodename sanitization checks
    const sanitizeCheck = spawnSync('python3', [
      '-B', '-I', '-c',
      'import sys; sys.path.insert(0, sys.argv[1]); import telemetry; print(telemetry.host_file_name(None, "My_Host_01.local"), telemetry.host_file_name(None, "---"), len(telemetry.host_file_name(None, "a" * 70)))',
      join(ROOT, 'bin/lib'),
    ], { env: fix.env, encoding: 'utf8' });
    expect([sanitizeCheck.status, sanitizeCheck.stderr]).toEqual([0, '']);
    expect(sanitizeCheck.stdout.trim()).toBe('my-host-01 unknown-host 63');

    // 4. Symlinked analytics/stage-runs directory is refused, row is saved in handoff, and retried cleanly when repaired;
    //    also a saved v2 row in a handoff lands unchanged in the per-host file when retried after upgrade;
    //    and legacy analytics/stage-runs.jsonl stays byte-identical.
    const fix2 = makeTelemetryFixture('off');
    const legacyPath = join(fix2.home, '.gstack-extend/analytics/stage-runs.jsonl');
    mkdirSync(dirname(legacyPath), { recursive: true });
    const legacyContent = JSON.stringify({
      stage: 'roadmap', agent: 'claude', model: 'claude-opus-4-6', effort: 'high', rung: 0,
      outcome: 'success', started_at: '2026-11-01T00:00:00Z', duration_s: 12, session_id: 'sid-legacy-v2',
      repo: 'acme/widget', branch: 'main', work_item: null, source: 'gstack-extend',
      route: 'cli', entrypoint_raw: 'cli', schema_version: 2, producer_version: '0.2.0.0',
      agent_source: 'detected', model_source: 'detected', effort_source: 'detected',
      workspace_host: null, host_agent_id: null,
    }) + '\n';
    writeFileSync(legacyPath, legacyContent);

    const targetDir = join(fix2.home, 'elsewhere-runs');
    mkdirSync(targetDir, { recursive: true });
    const stageRunsDir = join(fix2.home, '.gstack-extend/analytics/stage-runs');
    symlinkSync(targetDir, stageRunsDir);

    expect(runHelper(fix2.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    const blockedFinish = runHelper({ ...fix2.env, ...DEBUG }, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']);
    expect(blockedFinish.status).toBe(0);
    expect(blockedFinish.stderr).toContain('provenance sink directory is a symlink');
    expect(handoffs(fix2)).toHaveLength(1);

    // Repair symlinked directory and retry finish -> saved row lands in per-host file
    rmSync(stageRunsDir, { recursive: true, force: true });
    expect(runHelper(fix2.env, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    expect(handoffs(fix2)).toHaveLength(0);

    // Also plant a handoff carrying a pre-built v2 row (state["row"]) and verify retry writes it unchanged to per-host file
    expect(runHelper(fix2.env, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    expect(handoffs(fix2)).toHaveLength(1);
    const handoffFile = join(fix2.home, '.gstack-extend/telemetry', handoffs(fix2)[0]!);
    const handoffState = JSON.parse(readFileSync(handoffFile, 'utf8'));
    const v2Row = JSON.parse(legacyContent.trim());
    v2Row.session_id = handoffState.session_id;
    handoffState.row = v2Row;
    handoffState.done = [];
    writeFileSync(handoffFile, JSON.stringify(handoffState));
    expect(runHelper(fix2.env, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    expect(handoffs(fix2)).toHaveLength(0);

    // Legacy file stayed byte-identical!
    expect(readFileSync(legacyPath, 'utf8')).toBe(legacyContent);
    // Per-host file has both rows (the v4 retried row and the v2 retried row unchanged)
    const hostRows = readFileSync(join(stageRunsDir, HOST_LEDGER_FILE), 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    expect(hostRows).toHaveLength(2);
    expect(hostRows[0].schema_version).toBe(4);
    expect(hostRows[1]).toEqual(v2Row);
  }, 30_000);

  test('report multi-root aggregation, --state-dir, --by-host, inode deduplication, and duplicate host label warning', () => {
    const fix = makeTelemetryFixture('off');
    const rootA = join(fix.home, 'root-a');
    const rootB = join(fix.home, 'root-b');
    mkdirSync(join(rootA, 'analytics/stage-runs'), { recursive: true });
    mkdirSync(join(rootB, 'analytics/stage-runs'), { recursive: true });

    const makeV4Row = (sid: string, stage: string, runMode: string, runModeSource: string, outcome: string, durationS: number, extra: Record<string, unknown> = {}) => ({
      stage,
      agent: 'claude',
      model: 'claude-opus-4-6',
      effort: 'high',
      rung: 0,
      outcome,
      started_at: '2026-11-08T12:00:00Z',
      duration_s: durationS,
      session_id: sid,
      repo: 'acme/widget',
      branch: 'main',
      work_item: runMode === 'orchestrated' ? 'wi-1' : null,
      source: 'gstack-extend',
      route: 'cli',
      entrypoint_raw: runModeSource === 'paseo-entrypoint' ? 'Paseo' : 'cli',
      schema_version: 4,
      producer_version: RELEASE,
      agent_source: 'detected',
      model_source: 'detected',
      effort_source: 'detected',
      workspace_host: null,
      run_mode: runMode,
      run_mode_source: runModeSource,
      questions: runMode === 'orchestrated' ? null : 1,
      user_wait_s: runMode === 'orchestrated' ? null : 10,
      resumes: runMode === 'orchestrated' ? null : 0,
      user_signals_source: runMode === 'orchestrated' ? 'orchestrated' : 'session-log',
      blocked_reason: outcome === 'blocked' && runMode !== 'orchestrated' ? 'waiting-on-user' : null,
      blocked_reason_source: runMode === 'orchestrated' ? 'orchestrated' : outcome === 'blocked' ? 'flag' : 'not-blocked',
      ...extra,
    });

    const row1 = makeV4Row('sid-1', 'roadmap', 'user-directed', 'cli', 'success', 20);
    const row2 = makeV4Row('sid-2', 'implement', 'user-directed', 'paseo-entrypoint', 'blocked', 30);
    const row3 = makeV4Row('sid-3', 'implement', 'orchestrated', 'work-item', 'success', 40);
    const legacyRow = makeV4Row('sid-legacy', 'roadmap', 'unknown', 'entrypoint-unavailable', 'success', 15, { entrypoint_raw: null });

    const defaultLedger = join(fix.home, '.gstack-extend/analytics/stage-runs.jsonl');
    mkdirSync(dirname(defaultLedger), { recursive: true });
    writeFileSync(defaultLedger, JSON.stringify(makeV4Row('default-only', 'roadmap', 'user-directed', 'cli', 'success', 1)) + '\n');
    writeFileSync(join(rootA, 'analytics/stage-runs/macbook.jsonl'), JSON.stringify(row1) + '\n' + JSON.stringify(row2) + '\n');
    writeFileSync(join(rootA, 'analytics/stage-runs.jsonl'), JSON.stringify(legacyRow) + '\n');
    writeFileSync(join(rootB, 'analytics/stage-runs/omarchy.jsonl'), JSON.stringify(row3) + '\n');

    // Repeatable --state-dir (with rootA passed twice to verify same-inode deduplication) and --by-host --json
    const res = spawnSync(HELPER_BIN, [
      'report', '--json', '--by-host',
      '--state-dir', rootA,
      '--state-dir', rootB,
      '--state-dir', rootA,
    ], { env: fix.env, encoding: 'utf8', timeout: 15_000 });
    expect([res.status, res.stderr]).toEqual([0, '']);
    const report = JSON.parse(res.stdout);
    expect(report.rows).toEqual({
      counted: 4,
      routed: 0,
      malformed: 0,
      invalid: 0,
      unsupported: 0,
    });
    const roadmapSkill = report.skills.find((s: { skill: string }) => s.skill === 'roadmap');
    const implementSkill = report.skills.find((s: { skill: string }) => s.skill === 'implement');
    expect(roadmapSkill.cells['user-directed'].runs).toBe(1);
    expect(roadmapSkill.cells.unknown.runs).toBe(1);
    expect(implementSkill.cells['user-directed'].runs).toBe(1);
    expect(implementSkill.cells.orchestrated.runs).toBe(1);
    expect(report.hosts.map((h: { host: string }) => h.host)).toEqual(['macbook', 'omarchy', '(legacy)']);
    // Value: protects=host cells aggregate all stages with exact mode/outcome counts; fails_when=host aggregation loses or duplicates a ledger; why_new=the original assertion only checked labels; seam=none
    expect(report.hosts[0].cells['user-directed']).toEqual({
      runs: 2, outcomes: { success: 1, error: 0, abort: 0, blocked: 1, unknown: 0 }, last_seen: row1.started_at,
    });
    expect(report.hosts[1].cells.orchestrated).toEqual({
      runs: 1, outcomes: { success: 1, error: 0, abort: 0, blocked: 0, unknown: 0 }, last_seen: row3.started_at,
    });
    expect(report.hosts[2].cells.unknown.runs).toBe(1);
    for (const privateValue of [rootA, rootB, 'sid-1', 'acme/widget', 'wi-1']) expect(res.stdout).not.toContain(privateValue);

    // Without --by-host, hosts is omitted from JSON
    const resNoByHost = spawnSync(HELPER_BIN, [
      'report', '--json', '--state-dir', rootA, '--state-dir', rootB,
    ], { env: fix.env, encoding: 'utf8', timeout: 15_000 });
    expect([resNoByHost.status, resNoByHost.stderr]).toEqual([0, '']);
    expect(JSON.parse(resNoByHost.stdout)).not.toHaveProperty('hosts');

    // Relative --state-dir is rejected as invalid arguments
    const resRel = spawnSync(HELPER_BIN, ['report', '--state-dir', 'relative/ignored'], {
      env: fix.env, encoding: 'utf8', timeout: 15_000,
    });
    expect(resRel.status).toBe(0);
    expect(resRel.stderr).toContain('telemetry report: invalid arguments');
    const alias = join(fix.home, 'root-alias');
    symlinkSync(rootA, alias);
    const aliased = spawnSync(HELPER_BIN, ['report', '--json', '--by-host', '--state-dir', rootA, '--state-dir', alias], {
      env: fix.env, encoding: 'utf8', timeout: 15_000,
    });
    expect([aliased.status, aliased.stderr]).toEqual([0, '']);
    expect(JSON.parse(aliased.stdout).rows.counted).toBe(3);
    expect(JSON.parse(aliased.stdout).files.read).toBe(2);
    for (const args of [['--state-dir'], ['--json', '--json'], ['--by-host', '--by-host']]) {
      const rejected = spawnSync(HELPER_BIN, ['report', ...args], { env: fix.env, encoding: 'utf8', timeout: 15_000 });
      expect([rejected.status, rejected.stdout]).toEqual([0, '']);
      expect(rejected.stderr).toContain('telemetry report: invalid arguments');
    }
    for (const flags of [[], ['--json']]) {
      const implicit = spawnSync(HELPER_BIN, ['report', ...flags], { env: fix.env, encoding: 'utf8' });
      const explicit = spawnSync(HELPER_BIN, ['report', ...flags, '--state-dir', join(fix.home, '.gstack-extend')], { env: fix.env, encoding: 'utf8' });
      expect([implicit.status, implicit.stdout, implicit.stderr]).toEqual([explicit.status, explicit.stdout, explicit.stderr]);
    }

    // Value: protects=migrated and conflict-copy filenames group by validated prefix; fails_when=suffixes become hosts or invalid names leak; why_new=T6 requires migrated files and fallback labels; seam=none
    const { host_agent_id: _oldId, ...v3Base } = row1;
    const historical = { ...v3Base, schema_version: 3, workspace_host: 'paseo', host_agent_id: 'original-host', run_mode_source: 'Paseo' };
    expect(validRow(historical)).toBe(true);
    writeFileSync(join(rootA, 'analytics/stage-runs/macbook.legacy.jsonl'), JSON.stringify(historical) + '\n');
    writeFileSync(join(rootA, 'analytics/stage-runs/INVALID.jsonl'), JSON.stringify(row3) + '\n');
    const labeled = spawnSync(HELPER_BIN, ['report', '--json', '--by-host', '--state-dir', rootA, '--state-dir', rootB], {
      env: fix.env, encoding: 'utf8', timeout: 15_000,
    });
    expect([labeled.status, labeled.stderr]).toEqual([0, '']);
    const labels = JSON.parse(labeled.stdout);
    expect(labels.rows.counted).toBe(6);
    expect(labels.hosts.map((h: { host: string }) => h.host)).toEqual(['macbook', 'omarchy', '(legacy)', '(unattributed)']);
    expect(labels.hosts[0].cells['user-directed'].runs).toBe(3);
    expect(labels.hosts[3].cells.orchestrated.runs).toBe(1);

    // Human --by-host output and duplicate host label across distinct state directories
    writeFileSync(join(rootB, 'analytics/stage-runs/macbook.jsonl'), JSON.stringify(row1) + '\n');
    const resHuman = spawnSync(HELPER_BIN, ['report', '--by-host', '--state-dir', rootA, '--state-dir', rootB], {
      env: fix.env,
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(resHuman.status).toBe(0);
    expect(resHuman.stderr).toContain('1 host label(s) appeared in more than one state directory');
    expect(resHuman.stdout).toContain('Host                    Mode           Runs');
    expect(resHuman.stdout).toContain('macbook');
    expect(resHuman.stdout).toContain('omarchy');
    expect(resHuman.stdout).toContain('(legacy)');
    // Exact numeric host rows, independent of the implementation's column widths.
    const hostLines = resHuman.stdout.split('Host                    Mode           Runs')[1]!.trim().split('\n').slice(1)
      .map(line => line.trim().split(/\s+/).join(' '));
    expect(hostLines).toEqual([
      'macbook orchestrated 0 0 0 0 0 0 -',
      'macbook user-directed 4 3 1 0 0 0 2026-11-08T12:00:00Z',
      'macbook unknown 0 0 0 0 0 0 -', 'macbook unrecorded 0 0 0 0 0 0 -',
      'omarchy orchestrated 1 1 0 0 0 0 2026-11-08T12:00:00Z',
      'omarchy user-directed 0 0 0 0 0 0 -', 'omarchy unknown 0 0 0 0 0 0 -', 'omarchy unrecorded 0 0 0 0 0 0 -',
      '(legacy) orchestrated 0 0 0 0 0 0 -', '(legacy) user-directed 0 0 0 0 0 0 -',
      '(legacy) unknown 1 1 0 0 0 0 2026-11-08T12:00:00Z', '(legacy) unrecorded 0 0 0 0 0 0 -',
      '(unattributed) orchestrated 1 1 0 0 0 0 2026-11-08T12:00:00Z',
      '(unattributed) user-directed 0 0 0 0 0 0 -', '(unattributed) unknown 0 0 0 0 0 0 -', '(unattributed) unrecorded 0 0 0 0 0 0 -',
    ]);
  }, 30_000);

  test('Track 73A T7: structured transcript resume forms, signal-reader exception isolation, missing skill metadata, and report filesystem error diagnostics', () => {
    const fix = makeTelemetryFixture('off');
    const sid = '0c7f2e29-0000-4000-8000-000000000077';
    const env = { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CODE_SESSION_ID: sid };
    const transcript = join(fix.home, '.claude/projects/project', `${sid}.jsonl`);

    // Value: protects=each documented resume form and its independent wait; fails_when=human prompt detection accepts tool/meta/blank records or rejects image/text prompts; why_new=T7 requires each form in its own window; seam=none
    const begin = 1790000100;
    for (const [name, content, meta, counted] of [
      ['text blocks', [{ type: 'text', text: 'PROMPT_ARRAY_CANARY' }], false, true],
      ['image', [{ type: 'image', source: { type: 'base64', data: 'IMAGE_CANARY' } }], false, true],
      ['empty list', [], false, false],
      ['tool result with text', [{ type: 'tool_result', tool_use_id: 'u1' }, { type: 'text', text: 'MIXED_CANARY' }], false, false],
      ['meta string', 'META_CANARY', true, false],
      ['blank string', '   ', false, false],
      ['blank text blocks', [{ type: 'text', text: '   ' }], false, false],
      ['unsupported content', 12345, false, false],
    ] as const) {
      writeJsonl(transcript, [
        { type: 'assistant', timestamp: iso(begin + 1), message: {
          id: 'assistant', role: 'assistant', model: 'claude-opus-4-6', stop_reason: 'end_turn', content: [],
        } },
        { type: 'user', timestamp: iso(begin + 6), isMeta: meta, message: { role: 'user', content } },
      ]);
      const result = provenanceRun(fix, env, undefined, ['--outcome', 'success', '--start', String(begin)]);
      expect(result.row, name).toMatchObject({
        questions: 0, user_wait_s: counted ? 5 : 0, resumes: counted ? 1 : 0, user_signals_source: 'session-log',
      });
      expect(validRow(result.row), name).toBe(true);
      expect(JSON.stringify(result.row)).not.toContain('CANARY');
    }

    // 2. Signal-reader exception isolation: patching claude_user_signals to raise RuntimeError("SECRET_BOOM_VALUE")
    //    leaves the constructed row valid with null counts, user_signals_source: 'session-log-unavailable',
    //    and never leaks the exception message.
    const isolationScript = [
      'import contextlib, io, json, os, sys',
      'from unittest import mock',
      'sys.path.insert(0, sys.argv[1])',
      'import telemetry',
      'os.environ["GSTACK_EXTEND_TELEMETRY_DEBUG"] = "1"',
      'stderr = io.StringIO()',
      'with contextlib.redirect_stderr(stderr):',
      '    with mock.patch.object(telemetry, "claude_user_signals", side_effect=RuntimeError("SECRET_BOOM_VALUE")):',
      '        row = telemetry.provenance_row("roadmap", "sid-isolation", 1790000000, 5, {"--outcome": "success"}, None)',
      'print(json.dumps({"row": row, "stderr": stderr.getvalue()}))',
    ].join('\n');
    const isoRun = spawnSync('python3', ['-B', '-I', '-c', isolationScript, join(ROOT, 'bin/lib')], {
      env: { ...fix.env, ...env },
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect([isoRun.status, isoRun.stderr]).toEqual([0, '']);
    const isoOut = JSON.parse(isoRun.stdout);
    expect(isoOut.row).toMatchObject({
      questions: null,
      user_wait_s: null,
      resumes: null,
      user_signals_source: 'session-log-unavailable',
    });
    expect(validRow(isoOut.row)).toBe(true);
    expect(isoOut.stderr).not.toContain('SECRET_BOOM_VALUE');
    expect(isoOut.stderr).not.toContain('Traceback');

    // Value: protects=real absent/non-directory install metadata retains observed stages without inventing empty cells; fails_when=metadata discovery defaults to an empty known install or loses rows; why_new=T7 previously mocked the result instead of discovery; seam=none
    for (const shape of ['missing', 'file']) {
      const install = copiedInstall(fix, `no-skills-${shape}`, RELEASE);
      if (shape === 'file') writeFileSync(join(install.root, 'skills'), 'not a directory');
      const report = install.run(['report', '--json']);
      expect([report.status, report.stderr]).toEqual([0, '']);
      const data = JSON.parse(report.stdout);
      expect(data.installed_skills).toBeNull();
      expect(data.empty_cells).toEqual([]);
      expect(data.skills.some((s: { skill: string; installed: boolean }) => s.skill === 'roadmap' && s.installed === false)).toBe(true);
    }

    // 4. Report filesystem error diagnostics: symlinked .jsonl file and unreadable stage-runs directory increment files.unreadable
    const fsErrRoot = join(fix.home, 'fs-err-state');
    const fsErrRuns = join(fsErrRoot, 'analytics/stage-runs');
    mkdirSync(fsErrRuns, { recursive: true });
    writeFileSync(join(fsErrRoot, 'real.jsonl'), '');
    symlinkSync(join(fsErrRoot, 'real.jsonl'), join(fsErrRuns, 'symlinked-host.jsonl'));

    const fsSymRes = spawnSync(HELPER_BIN, ['report', '--json', '--state-dir', fsErrRoot], {
      env: fix.env,
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect([fsSymRes.status, fsSymRes.stderr]).toEqual([0, '']);
    expect(JSON.parse(fsSymRes.stdout).files).toEqual({ read: 0, unreadable: 1 });

    // Value: protects=per-file partial results survive directory, open, and iteration failures; fails_when=one unreadable input discards sibling or already-counted rows; why_new=T7 requires all three error boundaries; seam=none
    const sample = { source: 'gstack-extend', schema_version: 4, stage: 'roadmap',
      run_mode: 'user-directed', outcome: 'success', started_at: '2026-11-08T12:00:00Z' };
    writeFileSync(join(fsErrRoot, 'analytics/stage-runs.jsonl'), JSON.stringify(sample) + '\n');
    writeFileSync(join(fsErrRuns, 'host-a.jsonl'), JSON.stringify(sample) + '\n' + JSON.stringify(sample) + '\n');
    writeFileSync(join(fsErrRuns, 'host-b.jsonl'), JSON.stringify(sample) + '\n');
    rmSync(join(fsErrRuns, 'symlinked-host.jsonl'));
    const fsErrorScript = [
      'import io, json, os, sys',
      'from unittest import mock',
      'sys.path.insert(0, sys.argv[1])',
      'import telemetry',
      'root, kind = sys.argv[2:4]',
      'runs = os.path.join(root, "analytics/stage-runs")',
      'bad_file = os.path.join(runs, "host-a.jsonl")',
      'real_listdir, real_open, real_fdopen = os.listdir, os.open, os.fdopen',
      'bad_fds = set()',
      'def listdir(path):',
      '    if kind == "listdir" and str(path) == runs: raise OSError("synthetic listdir failure")',
      '    return real_listdir(path)',
      'def open_file(path, flags, *args, **kwargs):',
      '    if str(path) == bad_file and kind == "open": raise OSError("synthetic open failure")',
      '    fd = real_open(path, flags, *args, **kwargs)',
      '    if str(path) == bad_file: bad_fds.add(fd)',
      '    return fd',
      'class FailingStream:',
      '    def __init__(self, stream): self.stream = stream',
      '    def __enter__(self): return self',
      '    def __exit__(self, *args): self.stream.close()',
      '    def __iter__(self):',
      '        yield next(self.stream)',
      '        raise OSError("synthetic iteration failure")',
      'def fdopen(fd, *args, **kwargs):',
      '    fail = fd in bad_fds and kind == "iterate"',
      '    bad_fds.discard(fd)',
      '    stream = real_fdopen(fd, *args, **kwargs)',
      '    return FailingStream(stream) if fail else stream',
      'buf = io.StringIO()',
      'with mock.patch.object(telemetry.os, "listdir", listdir), mock.patch.object(telemetry.os, "open", open_file), mock.patch.object(telemetry.os, "fdopen", fdopen), mock.patch.object(sys, "stdout", buf):',
      '    rc = telemetry.run_report(["--json", "--state-dir", root])',
      'print(json.dumps({"rc": rc, "data": json.loads(buf.getvalue())}))',
    ].join('\n');
    for (const [kind, read, counted] of [['listdir', 1, 1], ['open', 2, 2], ['iterate', 3, 3]] as const) {
      const result = spawnSync('python3', ['-B', '-I', '-c', fsErrorScript, join(ROOT, 'bin/lib'), fsErrRoot, kind], {
        env: fix.env, encoding: 'utf8', timeout: 10_000,
      });
      expect([result.status, result.stderr], kind).toEqual([0, '']);
      const output = JSON.parse(result.stdout);
      expect(output.rc).toBe(0);
      expect(output.data.files, kind).toEqual({ read, unreadable: 1 });
      expect(output.data.rows.counted, kind).toBe(counted);
    }

  }, 30_000);
});
