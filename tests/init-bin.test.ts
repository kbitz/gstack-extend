/**
 * init-bin.test.ts — functional tests for bin/gstack-extend.
 *
 * Covers the dispatch surface, --help, --name validation, the flag matrix
 * (empty / partial / onboarded × default / --migrate / --dry-run /
 * --no-prompt), and the post-render audit gate.
 *
 * Uses runBin (tests/helpers/run-bin.ts) for env isolation:
 *   - HOME isolated per test (mkdtemp)
 *   - GSTACK_EXTEND_STATE_DIR scoped to the tmp dir (registry isolation)
 *   - GSTACK_STATE_ROOT scoped too (audit + session-paths isolation)
 *
 * Audit pollution defense: the audit runs `bin/roadmap-audit` against the
 * just-rendered project tree, which (under bun) imports skill modules.
 * Both env vars MUST be set on every spawn or the user's real
 * ~/.gstack-extend/projects.json and ~/.gstack/projects/<slug>/ pick up
 * test garbage.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeBaseTmp } from './helpers/fixture-repo.ts';
import { runBin } from './helpers/run-bin.ts';

const ROOT = join(import.meta.dir, '..');
const BIN = join(ROOT, 'bin', 'gstack-extend');

const baseTmp = makeBaseTmp('init-bin-');
afterAll(() => {
  try { rmSync(baseTmp, { recursive: true, force: true }); } catch {}
});

function mkScope(name: string) {
  const home = join(baseTmp, name, 'home');
  const state = join(baseTmp, name, 'state');
  const groot = join(baseTmp, name, 'gstack');
  const target = join(baseTmp, name, 'target');
  mkdirSync(home, { recursive: true });
  mkdirSync(state, { recursive: true });
  mkdirSync(groot, { recursive: true });
  return { home, state, groot, target };
}

function run(args: string[], scope: ReturnType<typeof mkScope>) {
  return runBin(BIN, args, {
    home: scope.home,
    gstackExtendDir: ROOT,
    gstackExtendStateDir: scope.state,
    extraEnv: { GSTACK_STATE_ROOT: scope.groot },
  });
}

describe('dispatcher', () => {
  test('--help prints usage and exits 0', () => {
    const s = mkScope('help');
    const r = run(['--help'], s);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Usage: gstack-extend');
    expect(r.stdout).toContain('init <project>');
  });

  test('no args prints usage and exits 0', () => {
    const s = mkScope('noargs');
    const r = run([], s);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Usage: gstack-extend');
  });

  test('unknown subcommand exits 2 with usage on stderr', () => {
    const s = mkScope('unknown');
    const r = run(['frobnosticate'], s);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('unknown subcommand');
    expect(r.stderr).toContain('Usage: gstack-extend');
  });

  test.each(['list', 'status', 'doctor', 'migrate'])(
    '%s subcommand prints reserved-namespace message and exits 0',
    (sub) => {
      const s = mkScope(`stub-${sub}`);
      const r = run([sub], s);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('reserved namespace');
    },
  );
});

describe('init argument validation', () => {
  test('missing <project> exits 2 with init usage on stderr', () => {
    const s = mkScope('missing-project');
    const r = run(['init'], s);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('argument required');
    expect(r.stderr).toContain('Usage: gstack-extend init');
  });

  test('--help prints init usage and exits 0', () => {
    const s = mkScope('init-help');
    const r = run(['init', '--help'], s);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Usage: gstack-extend init');
    expect(r.stdout).toContain('--migrate');
    expect(r.stdout).toContain('--dry-run');
  });

  test('--name with invalid chars exits 1 with hint', () => {
    const s = mkScope('bad-name');
    const r = run(['init', s.target, '--name', 'bad;name', '--no-prompt'], s);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("contains invalid characters");
    expect(r.stderr).toContain('letters, digits, dot, underscore, hyphen');
  });

  test('unknown flag exits 2', () => {
    const s = mkScope('bad-flag');
    const r = run(['init', s.target, '--no-such-flag'], s);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('unknown flag');
  });

  test('--name without value exits 2', () => {
    const s = mkScope('name-no-val');
    const r = run(['init', s.target, '--name'], s);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('--name requires an argument');
  });
});

describe('init flag matrix', () => {
  test('empty dir + default: renders, registers, audit clean, exit 0', () => {
    const s = mkScope('empty-default');
    const r = run(['init', s.target, '--no-prompt'], s);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('+ wrote CLAUDE.md');
    expect(r.stdout).toContain('+ wrote CHANGELOG.md');
    expect(r.stdout).toContain('+ wrote VERSION');
    expect(r.stdout).toContain('+ wrote docs/ROADMAP.md');
    expect(r.stdout).toContain('+ wrote docs/TODOS.md');
    expect(r.stdout).toContain('+ wrote docs/PROGRESS.md');
    expect(r.stdout).toContain('+ registered');
    expect(r.stdout).toContain('SUCCESS');

    expect(existsSync(join(s.target, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(s.target, 'CHANGELOG.md'))).toBe(true);
    expect(existsSync(join(s.target, 'VERSION'))).toBe(true);
    expect(existsSync(join(s.target, 'docs', 'ROADMAP.md'))).toBe(true);
    expect(existsSync(join(s.target, 'docs', 'TODOS.md'))).toBe(true);
    expect(existsSync(join(s.target, 'docs', 'PROGRESS.md'))).toBe(true);
    expect(existsSync(join(s.target, 'docs', 'designs'))).toBe(true);
    expect(existsSync(join(s.target, 'docs', 'archive'))).toBe(true);

    const registry = JSON.parse(readFileSync(join(s.state, 'projects.json'), 'utf8'));
    expect(registry.projects).toHaveLength(1);
    // The bin resolves through cd -P; on macOS /var is a symlink to /private/var.
    // Compare via realpath so the test is platform-portable.
    expect(realpathSync(registry.projects[0].path)).toBe(realpathSync(s.target));
    expect(registry.projects[0].version_scheme).toBe('4-digit');
  });

  test('empty dir + --dry-run: prints would-write, no filesystem changes', () => {
    const s = mkScope('empty-dryrun');
    const r = run(['init', s.target, '--dry-run', '--no-prompt'], s);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('DRY RUN');
    expect(r.stdout).toContain('+ would create');
    expect(r.stdout).toContain('dry-run complete');

    expect(existsSync(s.target)).toBe(false);
    expect(existsSync(join(s.state, 'projects.json'))).toBe(false);
  });

  test('partial dir + default: refuses with --migrate hint, exits 1', () => {
    const s = mkScope('partial-default');
    mkdirSync(s.target, { recursive: true });
    writeFileSync(join(s.target, 'CLAUDE.md'), '# user content\n');
    const r = run(['init', s.target, '--no-prompt'], s);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('partially onboarded');
    expect(r.stderr).toContain('--migrate');
    // User content untouched
    expect(readFileSync(join(s.target, 'CLAUDE.md'), 'utf8')).toBe('# user content\n');
  });

  test('partial dir + --migrate: backfills missing, leaves user-edited file alone', () => {
    const s = mkScope('partial-migrate');
    mkdirSync(s.target, { recursive: true });
    writeFileSync(join(s.target, 'CLAUDE.md'), '# user content\n');
    const r = run(['init', s.target, '--migrate', '--no-prompt'], s);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('~ skipped CLAUDE.md');
    expect(r.stdout).toContain('+ wrote CHANGELOG.md');
    expect(r.stdout).toContain('+ wrote docs/ROADMAP.md');
    expect(readFileSync(join(s.target, 'CLAUDE.md'), 'utf8')).toBe('# user content\n');
  });

  test('onboarded dir + default: refuses with doctor hint, exits 1', () => {
    const s = mkScope('onboarded-default');
    // First init populates everything.
    const r1 = run(['init', s.target, '--no-prompt'], s);
    expect(r1.exitCode).toBe(0);
    // Second init without --migrate must refuse.
    const r2 = run(['init', s.target, '--no-prompt'], s);
    expect(r2.exitCode).toBe(1);
    expect(r2.stderr).toContain('already onboarded');
    expect(r2.stderr).toContain('doctor');
  });

  test('onboarded dir + --migrate: re-registers (idempotent)', () => {
    const s = mkScope('onboarded-migrate');
    const r1 = run(['init', s.target, '--no-prompt'], s);
    expect(r1.exitCode).toBe(0);
    const r2 = run(['init', s.target, '--migrate', '--no-prompt'], s);
    expect(r2.exitCode).toBe(0);
    expect(r2.stdout).toContain('+ registered');
    // Registry still has exactly one entry for this slug.
    const reg = JSON.parse(readFileSync(join(s.state, 'projects.json'), 'utf8'));
    expect(reg.projects).toHaveLength(1);
  });
});

describe('init parent-dir handling', () => {
  test('parent dir missing exits 1 with clear error', () => {
    const s = mkScope('no-parent');
    const r = run(['init', join(baseTmp, 'no-parent', 'nonexistent-deep', 'proj'), '--no-prompt'], s);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('parent dir');
  });
});
