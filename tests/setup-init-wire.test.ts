/**
 * setup-init-wire.test.ts — end-to-end tests for the CLI symlink wiring
 * and self-registration that Track 12A added to `setup`.
 *
 * Coverage:
 *   - `setup` (install) wires ~/.local/bin/gstack-extend → bin/gstack-extend
 *   - Self-registration writes the gstack-extend repo's entry into
 *     projects.json (D4.A, with || true fail-soft semantics)
 *   - `setup` is idempotent: re-running doesn't break symlink or registry
 *   - `setup --uninstall` removes ONLY symlinks pointing at our bin,
 *     never touching unrelated symlinks at the same name
 *   - Missing ~/.local/bin/ falls back to a tip, doesn't fail setup
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeBaseTmp } from './helpers/fixture-repo.ts';
import { mkScope } from './helpers/init-scope.ts';

const ROOT = join(import.meta.dir, '..');
const SETUP = join(ROOT, 'setup');

const baseTmp = makeBaseTmp('setup-wire-');
afterAll(() => {
  try { rmSync(baseTmp, { recursive: true, force: true }); } catch {}
});

function scope(name: string, withLocalBin = true) {
  const scoped = mkScope(baseTmp, name);
  const localBin = join(scoped.home, '.local', 'bin');
  if (withLocalBin) mkdirSync(localBin, { recursive: true });
  return { ...scoped, localBin };
}

function homeRegistry(home: string) {
  return join(home, '.gstack-extend', 'projects.json');
}

function runSetup(s: ReturnType<typeof scope>, extraArgs: string[] = []) {
  const r = spawnSync(SETUP, extraArgs, {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: s.home,
      GSTACK_EXTEND_STATE_DIR: s.state,
      GSTACK_STATE_ROOT: s.groot,
    },
    timeout: 60_000,
  });
  return {
    exitCode: r.status ?? -1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

describe('CLI symlink wiring', () => {
  test('install wires the symlink to bin/gstack-extend', () => {
    const s = scope('install');
    const r = runSetup(s);
    expect(r.exitCode).toBe(0);
    // Track 13A refactor: setup now wires multiple bins via wire_bin(); the
    // message format dropped "CLI" since gstack-extend-telemetry isn't a CLI
    // in the user-facing sense. Both wires should appear.
    expect(r.stdout).toContain('Wired gstack-extend →');
    expect(r.stdout).toContain('Wired gstack-extend-telemetry →');
    const symlink = join(s.localBin, 'gstack-extend');
    expect(existsSync(symlink)).toBe(true);
    expect(readlinkSync(symlink)).toBe(join(ROOT, 'bin', 'gstack-extend'));
    // Track 13A: telemetry wrapper symlink also wired
    const telSymlink = join(s.localBin, 'gstack-extend-telemetry');
    expect(existsSync(telSymlink)).toBe(true);
    expect(readlinkSync(telSymlink)).toBe(join(ROOT, 'bin', 'gstack-extend-telemetry'));
  });

  test('install is idempotent: re-run produces the same symlink', () => {
    const s = scope('install-idem');
    runSetup(s);
    const r2 = runSetup(s);
    expect(r2.exitCode).toBe(0);
    const symlink = join(s.localBin, 'gstack-extend');
    expect(readlinkSync(symlink)).toBe(join(ROOT, 'bin', 'gstack-extend'));
  });

  test('install warns + skips when a non-symlink file already sits at the destination', () => {
    const s = scope('install-blocked');
    writeFileSync(join(s.localBin, 'gstack-extend'), '#!/bin/sh\necho user-script\n');
    const r = runSetup(s);
    // Setup must not crash even though our wire is blocked.
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain('exists and is not a symlink');
    // User script untouched.
    expect(readFileSync(join(s.localBin, 'gstack-extend'), 'utf8')).toContain('user-script');
  });

  test('install prints tip when ~/.local/bin/ is missing (no failure)', () => {
    const s = scope('install-no-localbin', /* withLocalBin */ false);
    const r = runSetup(s);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("~/.local/bin doesn't exist");
    // No symlink and no crash.
    expect(existsSync(join(s.localBin, 'gstack-extend'))).toBe(false);
  });
});

describe('self-registration (D4.A)', () => {
  test('install writes gstack-extend entry to projects.json', () => {
    const s = scope('self-register');
    const r = runSetup(s);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Self-registered gstack-extend');
    expect(r.stdout).toContain(homeRegistry(s.home));

    const reg = JSON.parse(readFileSync(homeRegistry(s.home), 'utf8'));
    expect(reg.projects.length).toBeGreaterThanOrEqual(1);
    const entry = reg.projects.find((p: { slug: string }) =>
      typeof p.slug === 'string' && p.slug.includes('gstack-extend')
    );
    expect(entry).toBeDefined();
    expect(entry.name).toBe('gstack-extend');
    expect(entry.version_scheme).toBe('4-digit');
    expect(existsSync(join(s.state, 'projects.json'))).toBe(false);
  });

  test('install is idempotent on registry: re-run does not duplicate', () => {
    const s = scope('self-register-idem');
    runSetup(s);
    runSetup(s);
    const reg = JSON.parse(readFileSync(homeRegistry(s.home), 'utf8'));
    const matches = reg.projects.filter((p: { slug: string }) =>
      typeof p.slug === 'string' && p.slug.includes('gstack-extend')
    );
    expect(matches).toHaveLength(1);
  });
});

describe('uninstall', () => {
  test('removes the symlink we created', () => {
    const s = scope('uninstall');
    runSetup(s);
    const r = runSetup(s, ['--uninstall']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Removed gstack-extend CLI symlink');
    expect(existsSync(join(s.localBin, 'gstack-extend'))).toBe(false);
  });

  test('refuses to remove a symlink that points elsewhere', () => {
    const s = scope('uninstall-foreign');
    const foreign = join(s.localBin, 'gstack-extend');
    // Create a symlink pointing at /usr/bin/true (or any other arbitrary
    // existing file) — must NOT be removed by uninstall.
    symlinkSync('/usr/bin/true', foreign);
    const r = runSetup(s, ['--uninstall']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Skipped gstack-extend CLI symlink (points elsewhere');
    expect(existsSync(foreign)).toBe(true);
    expect(readlinkSync(foreign)).toBe('/usr/bin/true');
  });

  test('handles missing symlink silently (no error)', () => {
    const s = scope('uninstall-noop');
    const r = runSetup(s, ['--uninstall']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Uninstall complete');
  });
});

function copyInstall(dest: string) {
  mkdirSync(join(dest, 'bin', 'lib'), { recursive: true });
  mkdirSync(join(dest, 'scripts', 'init-templates'), { recursive: true });
  mkdirSync(join(dest, 'skills'), { recursive: true });
  for (const rel of [
    'setup',
    'bin/gstack-extend',
    'bin/gstack-extend-telemetry',
    'bin/lib/install-safety.sh',
    'bin/lib/projects-registry.sh',
  ]) {
    copyFileSync(join(ROOT, rel), join(dest, rel));
  }
  chmodSync(join(dest, 'setup'), 0o755);
  chmodSync(join(dest, 'bin', 'gstack-extend'), 0o755);
  chmodSync(join(dest, 'bin', 'gstack-extend-telemetry'), 0o755);
  for (const tmpl of readdirSync(join(ROOT, 'scripts', 'init-templates'))) {
    copyFileSync(join(ROOT, 'scripts', 'init-templates', tmpl), join(dest, 'scripts', 'init-templates', tmpl));
  }
  for (const skill of readdirSync(join(ROOT, 'skills'))) {
    if (!skill.endsWith('.md')) continue;
    copyFileSync(join(ROOT, 'skills', skill), join(dest, 'skills', skill));
  }
}

function pathWithoutJq() {
  const dir = mkdtempSync(join(baseTmp, 'path-no-jq-'));
  const commands = ['bash', 'bun', 'dirname', 'readlink', 'basename', 'cat', 'grep', 'sort', 'wc', 'tr',
    'uname', 'git', 'date', 'mkdir', 'mktemp', 'mv', 'chmod', 'rm', 'awk', 'ln', 'env', 'sed', 'rmdir',
    'stat', 'id', 'find'];
  for (const command of commands) {
    const resolved = spawnSync('bash', ['-c', 'command -v "$1"', 'lookup', command], { encoding: 'utf8' });
    if (resolved.status !== 0) throw new Error(`fixture command unavailable: ${command}`);
    symlinkSync(resolved.stdout.trim(), join(dir, command));
  }
  return dir;
}

function runCopied(
  setupPath: string,
  s: ReturnType<typeof scope>,
  args: string[] = [],
  extraEnv: Record<string, string> = {},
) {
  const r = spawnSync(setupPath, args, {
    encoding: 'utf8',
    env: {
      PATH: extraEnv.PATH ?? process.env.PATH ?? '/usr/bin:/bin',
      HOME: s.home,
      GSTACK_EXTEND_STATE_DIR: s.state,
      GSTACK_STATE_ROOT: s.groot,
      ...extraEnv,
    },
    timeout: 60_000,
  });
  return { exitCode: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('setup registration failures', () => {
  test('corrupt HOME registry stays byte-for-byte and the printed retry targets HOME', () => {
    const marker = join(baseTmp, 'SETUP_INJECT_MARKER');
    const parent = join(baseTmp, `setup $(touch ${marker}) \`touch ${marker}\` "q" \\x !missing_history_entry`);
    const install = join(parent, 'tool leaf');
    mkdirSync(parent, { recursive: true });
    copyInstall(install);
    const record = join(baseTmp, 'setup-audit-record');
    mkdirSync(record, { recursive: true });
    writeFileSync(join(record, 'stdout'), 'SETUP-STUB-OK\n');
    writeFileSync(join(record, 'stderr'), 'SETUP-STUB-ERR\n');
    writeFileSync(join(record, 'exit'), '0\n');
    writeFileSync(
      join(install, 'bin', 'roadmap-audit'),
      `#!/bin/sh
printf '%s\\n' "$(pwd)" > "$AUDIT_RECORD/cwd"
printf '%s\\n' "\${1-}" > "$AUDIT_RECORD/argv"
[ -f "$AUDIT_RECORD/stdout" ] && cat "$AUDIT_RECORD/stdout"
[ -f "$AUDIT_RECORD/stderr" ] && cat "$AUDIT_RECORD/stderr" >&2
exit "$(cat "$AUDIT_RECORD/exit" 2>/dev/null || echo 0)"
`,
    );
    chmodSync(join(install, 'bin', 'roadmap-audit'), 0o755);

    const s = scope('setup-corrupt');
    const sentinel = '{"projects":[{"slug":"override-sentinel"}]}\n';
    writeFileSync(join(s.state, 'projects.json'), sentinel);
    const corrupt = '{not json';
    mkdirSync(join(s.home, '.gstack-extend'), { recursive: true });
    const homeReg = homeRegistry(s.home);
    writeFileSync(homeReg, corrupt);

    const failed = runCopied(join(install, 'setup'), s, [], { AUDIT_RECORD: record });
    expect(failed.exitCode).toBe(0);
    expect(failed.stdout).not.toContain('Self-registered');
    expect(failed.stderr).toContain('did not complete');
    expect(failed.stderr).toContain('may already exist');
    expect(failed.stderr).toContain(homeReg);
    expect(failed.stderr).toContain('repair');
    expect(failed.stderr).toContain('init --help');
    expect(failed.stderr).toContain('env -u GSTACK_EXTEND_STATE_DIR');
    expect(failed.stderr).toContain('--name gstack-extend');
    expect(failed.stderr).not.toContain('self-registration skipped');
    expect(readFileSync(homeReg, 'utf8')).toBe(corrupt);
    expect(readFileSync(join(s.state, 'projects.json'), 'utf8')).toBe(sentinel);
    expect(existsSync(join(s.localBin, 'gstack-extend'))).toBe(true);

    const retry = failed.stderr.split('\n').find((line) => line.includes('Retry:'));
    expect(retry).toBeDefined();
    const command = retry!.replace(/^.*Retry:\s*/, '');
    const shellEnv = {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: s.home,
      GSTACK_EXTEND_STATE_DIR: s.state,
      GSTACK_STATE_ROOT: s.groot,
      AUDIT_RECORD: record,
    };
    const beforeRepair = spawnSync('bash', ['-c', command], { encoding: 'utf8', env: shellEnv });
    expect(beforeRepair.status).not.toBe(0);
    expect(readFileSync(homeReg, 'utf8')).toBe(corrupt);
    expect(existsSync(marker)).toBe(false);

    writeFileSync(homeReg, '{"projects":[]}\n');
    const repaired = spawnSync('bash', ['--noprofile', '--norc', '-i'], {
      encoding: 'utf8', input: `${command}\nexit $?\n`,
      env: { ...shellEnv, HISTFILE: join(s.home, '.bash_history') }, timeout: 30_000,
    });
    expect(repaired.status).toBe(0);
    expect(repaired.stderr).not.toContain('event not found');
    expect(existsSync(marker)).toBe(false);
    expect(readFileSync(join(s.state, 'projects.json'), 'utf8')).toBe(sentinel);
    const reg = JSON.parse(readFileSync(homeReg, 'utf8'));
    expect(reg.projects).toHaveLength(1);
    expect(reg.projects[0].name).toBe('gstack-extend');
    const registered = statSync(reg.projects[0].path);
    const intended = statSync(install);
    expect(registered.dev).toBe(intended.dev);
    expect(registered.ino).toBe(intended.ino);
    expect(reg.projects[0].slug).toBe('toolleaf');
  });

  test('audit failure after registration keeps the entry and the full stderr under --quiet', () => {
    const install = join(baseTmp, 'audit-after', 'install');
    copyInstall(install);
    const record = join(baseTmp, 'audit-after', 'record');
    mkdirSync(record, { recursive: true });
    writeFileSync(join(record, 'stdout'), 'AUDIT-STDOUT-AFTER\n');
    writeFileSync(join(record, 'stderr'), 'AUDIT-STDERR-AFTER\nsecond line\n');
    writeFileSync(join(record, 'exit'), '7\n');
    writeFileSync(
      join(install, 'bin', 'roadmap-audit'),
      `#!/bin/sh
[ -f "$AUDIT_RECORD/stdout" ] && cat "$AUDIT_RECORD/stdout"
[ -f "$AUDIT_RECORD/stderr" ] && cat "$AUDIT_RECORD/stderr" >&2
exit "$(cat "$AUDIT_RECORD/exit")"
`,
    );
    chmodSync(join(install, 'bin', 'roadmap-audit'), 0o755);
    const s = scope('audit-after-reg');
    const sentinel = '{"projects":[{"slug":"override-sentinel"}]}\n';
    writeFileSync(join(s.state, 'projects.json'), sentinel);
    const r = runCopied(join(install, 'setup'), s, ['--quiet'], { AUDIT_RECORD: record });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).not.toContain('Self-registered');
    expect(r.stderr).toContain('did not complete');
    expect(r.stderr).toContain('may already exist');
    expect(r.stderr).toContain('AUDIT-STDOUT-AFTER');
    expect(r.stderr).toContain('AUDIT-STDERR-AFTER');
    expect(r.stderr).toContain('second line');
    expect(r.stderr).toContain('audit FAILED');
    const reg = JSON.parse(readFileSync(homeRegistry(s.home), 'utf8'));
    expect(reg.projects[0].name).toBe('gstack-extend');
    const retries = r.stderr.split('\n').filter((line) => /^  Retry: /.test(line));
    expect(retries).toHaveLength(1);
    expect(retries[0]).toContain('env -u GSTACK_EXTEND_STATE_DIR');
    writeFileSync(join(record, 'exit'), '0\n');
    const retry = spawnSync('bash', ['-c', retries[0]!.replace(/^  Retry: /, '')], {
      encoding: 'utf8', timeout: 30_000,
      env: { PATH: process.env.PATH, HOME: s.home, GSTACK_EXTEND_STATE_DIR: s.state,
        GSTACK_STATE_ROOT: s.groot, AUDIT_RECORD: record },
    });
    expect(retry.status, retry.stderr).toBe(0);
    expect(readFileSync(join(s.state, 'projects.json'), 'utf8')).toBe(sentinel);
    const repeated = runCopied(join(install, 'setup'), s, [], { AUDIT_RECORD: record });
    expect(repeated.exitCode).toBe(0);
    expect(repeated.stdout).toContain(`Self-registered gstack-extend in ${homeRegistry(s.home)}`);
    expect(readFileSync(join(s.state, 'projects.json'), 'utf8')).toBe(sentinel);
  });

  test('setup without jq still installs links and warns about the dependency', () => {
    const s = scope('setup-no-jq');
    const install = join(baseTmp, 'setup-no-jq', 'install');
    copyInstall(install);
    const r = runCopied(join(install, 'setup'), s, [], { PATH: pathWithoutJq() });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stderr).toContain('missing dependency: jq');
    expect(r.stdout).not.toContain('Self-registered');
    expect(existsSync(join(s.localBin, 'gstack-extend'))).toBe(true);
    expect(realpathSync(join(s.localBin, 'gstack-extend'))).toBe(realpathSync(join(install, 'bin', 'gstack-extend')));
  });
});
