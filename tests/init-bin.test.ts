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
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { renderCheckResult } from '../src/audit/cli.ts';
import { CANONICAL_SECTIONS, OPTIONAL_SECTIONS, SECTION_HEADING_RE, parseAuditSections } from '../src/audit/sections.ts';
import initSkill from '../skills/gstack-extend-init.md' with { type: 'text' };
import { makeBaseTmp } from './helpers/fixture-repo.ts';
import { mkScope } from './helpers/init-scope.ts';
import { runBin } from './helpers/run-bin.ts';

const ROOT = join(import.meta.dir, '..');
const BIN = join(ROOT, 'bin', 'gstack-extend');

const baseTmp = makeBaseTmp('init-bin-');
afterAll(() => {
  try { rmSync(baseTmp, { recursive: true, force: true }); } catch {}
});

function scope(name: string) {
  return mkScope(baseTmp, name);
}

function run(args: string[], scoped: ReturnType<typeof scope>, extraEnv?: Record<string, string>) {
  return runBin(BIN, args, {
    home: scoped.home,
    gstackExtendDir: ROOT,
    gstackExtendStateDir: scoped.state,
    extraEnv: { GSTACK_STATE_ROOT: scoped.groot, ...extraEnv },
  });
}

describe('dispatcher', () => {
  test('--help prints usage and exits 0', () => {
    const s = scope('help');
    const r = run(['--help'], s);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Usage: gstack-extend');
    expect(r.stdout).toContain('init <project>');
  });

  test('no args prints usage and exits 0', () => {
    const s = scope('noargs');
    const r = run([], s);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Usage: gstack-extend');
  });

  test('unknown subcommand exits 2 with usage on stderr', () => {
    const s = scope('unknown');
    const r = run(['frobnosticate'], s);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('unknown subcommand');
    expect(r.stderr).toContain('Usage: gstack-extend');
  });

  test.each(['list', 'status', 'migrate'])(
    '%s subcommand prints reserved-namespace message and exits 0',
    (sub) => {
      const s = scope(`stub-${sub}`);
      const r = run([sub], s);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('reserved namespace');
    },
  );

  test('doctor with no subcommand prints telemetry usage and exits 0', () => {
    const r = run(['doctor'], scope('doctor-bare'));
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Usage: gstack-extend doctor telemetry');
  });

  test('doctor with unknown subcommand prints telemetry usage and exits 0', () => {
    const r = run(['doctor', 'nope'], scope('doctor-nope'));
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Usage: gstack-extend doctor telemetry');
  });
});

describe('init argument validation', () => {
  test('missing <project> exits 2 with init usage on stderr', () => {
    const s = scope('missing-project');
    const r = run(['init'], s);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('argument required');
    expect(r.stderr).toContain('Usage: gstack-extend init');
  });

  test('--help prints init usage and exits 0', () => {
    const s = scope('init-help');
    const r = run(['init', '--help'], s);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Usage: gstack-extend init');
    expect(r.stdout).toContain('--migrate');
    expect(r.stdout).toContain('--dry-run');
  });

  test('--name with invalid chars exits 1 with hint', () => {
    const s = scope('bad-name');
    const r = run(['init', s.target, '--name', 'bad;name', '--no-prompt'], s);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("contains invalid characters");
    expect(r.stderr).toContain('letters, digits, dot, underscore, hyphen');
  });

  test('unknown flag exits 2', () => {
    const s = scope('bad-flag');
    const r = run(['init', s.target, '--no-such-flag'], s);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('unknown flag');
  });

  test('--name without value exits 2', () => {
    const s = scope('name-no-val');
    const r = run(['init', s.target, '--name'], s);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('--name requires an argument');
  });
});

describe('init flag matrix', () => {
  test('empty untagged repo + default: renders, registers, audit warns without blocking, exit 0', () => {
    const s = scope('empty-default');
    const init = spawnSync('git', ['init', '--quiet', '--initial-branch=main', s.target], { encoding: 'utf8' });
    expect(init.status).toBe(0);
    const r = run(['init', s.target, '--no-prompt'], s);
    expect(r.exitCode).toBe(0);
    const written = r.stdout.split('\n').filter((line) => line.startsWith('  + wrote '))
      .map((line) => line.slice('  + wrote '.length));
    expect(written).toEqual(EXPECTED_FILES);
    expect(r.stdout).toContain('+ wrote CLAUDE.md');
    expect(r.stdout).toContain('+ wrote CHANGELOG.md');
    expect(r.stdout).toContain('+ wrote VERSION');
    expect(r.stdout).toContain('+ wrote docs/ROADMAP.md');
    expect(r.stdout).toContain('+ wrote docs/TODOS.md');
    expect(r.stdout).toContain('+ wrote docs/PROGRESS.md');
    expect(r.stdout).toContain('+ wrote docs/roadmap-future.md');
    expect(r.stdout).toContain('+ wrote docs/roadmap-shipped.md');
    expect(r.stdout).toContain('+ registered');
    expect(r.stdout).toContain('SUCCESS');

    // This uses the real post-render auditor, including fresh-init output filtering.
    const sections = parseAuditSections(r.stdout);
    const version = sections.find((section) => section.name === 'VERSION');
    expect(version?.body).toContain('STATUS: warn');
    expect(version?.body).toContain('LATEST_TAG: (none)');
    expect(version?.body).toContain('RECOMMEND: none');
    expect(version?.body).toContain('- No local git tags found — consider tagging releases (git tag v0.0.0.0)');
    expect(sections.filter((section) => section.body.includes('STATUS: fail')).map((section) => section.name)).toEqual([]);

    expect(existsSync(join(s.target, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(s.target, 'CHANGELOG.md'))).toBe(true);
    expect(existsSync(join(s.target, 'VERSION'))).toBe(true);
    expect(existsSync(join(s.target, 'docs', 'ROADMAP.md'))).toBe(true);
    expect(existsSync(join(s.target, 'docs', 'TODOS.md'))).toBe(true);
    expect(existsSync(join(s.target, 'docs', 'PROGRESS.md'))).toBe(true);
    expect(existsSync(join(s.target, 'docs', 'roadmap-future.md'))).toBe(true);
    expect(existsSync(join(s.target, 'docs', 'roadmap-shipped.md'))).toBe(true);
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
    const s = scope('empty-dryrun');
    const r = run(['init', s.target, '--dry-run', '--no-prompt'], s);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('DRY RUN');
    expect(r.stdout).toContain('+ would create');
    expect(r.stdout).toContain('dry-run complete');
    expect(r.stderr).not.toContain('gstack-extend init: warning:');

    expect(existsSync(s.target)).toBe(false);
    expect(existsSync(join(s.state, 'projects.json'))).toBe(false);
  });

  test('partial dir + default: refuses with --migrate hint, exits 1', () => {
    const s = scope('partial-default');
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
    const s = scope('partial-migrate');
    mkdirSync(s.target, { recursive: true });
    writeFileSync(join(s.target, 'CLAUDE.md'), '# user content\n');
    const r = run(['init', s.target, '--migrate', '--no-prompt'], s);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('~ skipped CLAUDE.md');
    expect(r.stdout).toContain('+ wrote CHANGELOG.md');
    expect(r.stdout).toContain('+ wrote docs/ROADMAP.md');
    expect(readFileSync(join(s.target, 'CLAUDE.md'), 'utf8')).toBe('# user content\n');
  });

  test('partial dir + --migrate: does not plant empty satellites next to an existing ROADMAP', () => {
    const s = scope('partial-migrate-existing-roadmap');
    mkdirSync(join(s.target, 'docs'), { recursive: true });
    writeFileSync(
      join(s.target, 'docs', 'ROADMAP.md'),
      '# Roadmap\n\n## Future\n\n- **Keep me** — live essay.\n',
    );
    const r = run(['init', s.target, '--migrate', '--no-prompt'], s);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('~ skipped docs/roadmap-future.md');
    expect(r.stdout).toContain('~ skipped docs/roadmap-shipped.md');
    expect(existsSync(join(s.target, 'docs', 'roadmap-future.md'))).toBe(false);
    expect(existsSync(join(s.target, 'docs', 'roadmap-shipped.md'))).toBe(false);
    expect(readFileSync(join(s.target, 'docs', 'ROADMAP.md'), 'utf8')).toContain('**Keep me**');
  });

  test('onboarded dir + default: refuses with a --migrate hint, exits 1', () => {
    const s = scope('onboarded-default');
    // First init populates everything.
    const r1 = run(['init', s.target, '--no-prompt'], s);
    expect(r1.exitCode).toBe(0);
    // Second init without --migrate must refuse.
    const r2 = run(['init', s.target, '--no-prompt'], s);
    expect(r2.exitCode).toBe(1);
    expect(r2.stderr).toContain('already onboarded');
    // `doctor` now only reports telemetry, so the hint must not send users there for drift checks.
    expect(r2.stderr).toContain('drift checks are not implemented yet');
    expect(r2.stderr).toContain('--migrate');
    expect(r2.stderr).not.toContain('gstack-extend doctor');
  });

  test('onboarded dir + --migrate: re-registers (idempotent)', () => {
    const s = scope('onboarded-migrate');
    const r1 = run(['init', s.target, '--no-prompt'], s);
    expect(r1.exitCode).toBe(0);
    const r2 = run(['init', s.target, '--migrate', '--no-prompt'], s);
    expect(r2.exitCode).toBe(0);
    expect(r2.stdout).toContain('+ registered');
    // Registry still has exactly one entry for this slug.
    const reg = JSON.parse(readFileSync(join(s.state, 'projects.json'), 'utf8'));
    expect(reg.projects).toHaveLength(1);
    // Value: protects=a re-migrate whose slug did not change prints no "(was: ...)" label;
    //   fails_when=the slug-change label stops excluding the current slug (prints "x (was: x)");
    //   why_new=only slug-change and unregistered runs assert the label; seam=none;
    //   no_claim=registry contents beyond the one-entry count (real bin, real audit).
    expect(r2.stdout).toContain(`slug:           ${reg.projects[0].slug}\n`);
    expect(r2.stdout).not.toContain('(was:');
  });
});

describe('init parent-dir handling', () => {
  test('parent dir missing exits 1 with clear error', () => {
    const s = scope('no-parent');
    const r = run(['init', join(baseTmp, 'no-parent', 'nonexistent-deep', 'proj'), '--no-prompt'], s);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('parent dir');
  });
});

const EXPECTED_FILES = [
  'CLAUDE.md',
  'CHANGELOG.md',
  'VERSION',
  'docs/ROADMAP.md',
  'docs/TODOS.md',
  'docs/PROGRESS.md',
  'docs/roadmap-future.md',
  'docs/roadmap-shipped.md',
];

function retryCommand(text: string): string {
  const line = text.split('\n').find((entry) => entry.includes('Retry:'));
  if (!line) throw new Error(`no retry command in:\n${text}`);
  return line.replace(/^.*Retry:\s*/, '');
}

function runShell(command: string, s: ReturnType<typeof scope>, extraEnv: Record<string, string> = {}, interactive = false) {
  return spawnSync('bash', interactive ? ['--noprofile', '--norc', '-i'] : ['-c', command], {
    encoding: 'utf8',
    input: interactive ? `${command}\nexit $?\n` : undefined,
    env: {
      PATH: extraEnv.PATH ?? process.env.PATH ?? '/usr/bin:/bin',
      HOME: s.home,
      GSTACK_EXTEND_STATE_DIR: s.state,
      GSTACK_STATE_ROOT: s.groot,
      HISTFILE: join(s.home, '.bash_history'),
      ...extraEnv,
    },
    timeout: 30_000,
  });
}

function disposableInstall(name: string) {
  const s = scope(name);
  const install = join(baseTmp, name, 'install');
  mkdirSync(join(install, 'bin', 'lib'), { recursive: true });
  mkdirSync(join(install, 'scripts', 'init-templates'), { recursive: true });
  for (const rel of ['bin/gstack-extend', 'bin/lib/install-safety.sh', 'bin/lib/projects-registry.sh']) {
    copyFileSync(join(ROOT, rel), join(install, rel));
  }
  chmodSync(join(install, 'bin', 'gstack-extend'), 0o755);
  for (const tmpl of readdirSync(join(ROOT, 'scripts', 'init-templates'))) {
    copyFileSync(join(ROOT, 'scripts', 'init-templates', tmpl), join(install, 'scripts', 'init-templates', tmpl));
  }
  const record = join(baseTmp, name, 'audit-record');
  mkdirSync(record, { recursive: true });
  const stub = join(install, 'bin', 'roadmap-audit');
  writeFileSync(
    stub,
    `#!/bin/sh
printf '%s\\n' "$(pwd)" > "$AUDIT_RECORD/cwd"
printf '%s\\n' "\${1-}" > "$AUDIT_RECORD/argv"
if [ -f "$AUDIT_RECORD/stdout" ]; then cat "$AUDIT_RECORD/stdout"; fi
if [ -f "$AUDIT_RECORD/stderr" ]; then cat "$AUDIT_RECORD/stderr" >&2; fi
exit "$(cat "$AUDIT_RECORD/exit" 2>/dev/null || echo 0)"
`,
  );
  chmodSync(stub, 0o755);
  return { ...s, install, bin: join(install, 'bin', 'gstack-extend'), record };
}

function runInstalled(
  inst: ReturnType<typeof disposableInstall>,
  args: string[],
  extraEnv: Record<string, string> = {},
) {
  return runBin(inst.bin, args, {
    home: inst.home,
    gstackExtendDir: ROOT,
    gstackExtendStateDir: inst.state,
    extraEnv: { GSTACK_STATE_ROOT: inst.groot, AUDIT_RECORD: inst.record, ...extraEnv },
  });
}

function pathWithout(names: string[]) {
  const dir = mkdtempSync(join(baseTmp, 'path-'));
  const skip = new Set(names);
  const commands = ['bash', 'dirname', 'readlink', 'basename', 'cat', 'grep', 'sort', 'wc', 'tr',
    'uname', 'git', 'date', 'mkdir', 'mktemp', 'mv', 'chmod', 'rm', 'awk', 'jq'];
  for (const command of commands) {
    if (skip.has(command)) continue;
    const resolved = spawnSync('bash', ['-c', 'command -v "$1"', 'lookup', command], { encoding: 'utf8' });
    if (resolved.status !== 0) throw new Error(`fixture command unavailable: ${command}`);
    symlinkSync(resolved.stdout.trim(), join(dir, command));
  }
  return dir;
}

describe('init help and display names', () => {
  test('help describes preview, pass filtering, and the full audit command', () => {
    const s = scope('help-claims');
    const r = run(['init', '--help'], s);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('does not run the audit');
    expect(r.stdout).toContain('exactly pass');
    expect(r.stdout).toContain('does not promise');
    expect(r.stdout).toContain(`"${join(ROOT, 'bin', 'roadmap-audit')}" "<absolute-project-path>"`);
    expect(r.stdout).not.toContain('audit-clean');
    expect(r.stdout).toContain('Never overwrites an existing file.');
    expect(r.stdout).toContain('same path or slug');
  });

  test('explicit empty --name is usage exit 2, distinct from a missing project', () => {
    const s = scope('empty-name');
    const r = run(['init', s.target, '--name', ''], s);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('--name requires an argument');
    expect(r.stderr).not.toContain('<project> argument required');
    expect(existsSync(s.target)).toBe(false);
    expect(existsSync(join(s.state, 'projects.json'))).toBe(false);
  });

  test.each(['.', '..', '-leading', '--flag-shaped'])(
    'dry-run accepts display name %s without selecting a path',
    (name) => {
      const s = scope(`name-${name.replace(/[^a-z0-9]+/gi, '') || 'dots'}`);
      const r = run(['init', s.target, '--name', name, '--dry-run', '--no-prompt'], s);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain(`name:           ${name}`);
      expect(r.stdout).toContain(s.target);
      expect(existsSync(s.target)).toBe(false);
      expect(existsSync(join(s.state, 'projects.json'))).toBe(false);
    },
  );

  test('unicode and shell-special names exit 1 with a --name hint and write nothing', () => {
    for (const name of ['café', 'bad;name', 'a b']) {
      const s = scope(`bad-${name.length}-${name.codePointAt(0)}`);
      const r = run(['init', s.target, '--name', name, '--no-prompt'], s);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain('Allowed: letters, digits, dot, underscore, hyphen.');
      expect(r.stderr).toContain('--name <valid-name>');
      expect(existsSync(s.target)).toBe(false);
      expect(existsSync(join(s.state, 'projects.json'))).toBe(false);
    }
  });
});

describe('jq preflight and explicit write failures', () => {
  test('mutating init without jq exits 1 before any write; help and dry-run still work', () => {
    const s = scope('no-jq');
    const path = pathWithout(['jq']);
    const env = { PATH: path };
    const mutated = run(['init', s.target, '--no-prompt'], s, env);
    expect(mutated.exitCode).toBe(1);
    expect(mutated.stderr).toContain('missing dependency: jq');
    expect(mutated.stderr).toContain('init --help');
    expect(existsSync(s.target)).toBe(false);
    expect(existsSync(join(s.state, 'projects.json'))).toBe(false);

    const help = run(['init', '--help'], s, env);
    expect(help.exitCode).toBe(0);
    const preview = run(['init', s.target, '--dry-run', '--no-prompt'], s, env);
    expect(preview.exitCode).toBe(0);
    expect(preview.stderr).toContain('detection is unavailable');
    expect(preview.stderr).toContain('jq is not installed');
    expect(preview.stdout).toContain('would create');
    expect(existsSync(s.target)).toBe(false);
  });

  test.each([
    ['Darwin', 'printf \'%s\\n\' Darwin\nexit 0\n', 'brew install jq'],
    ['Linux', 'printf \'%s\\n\' Linux\nexit 0\n', 'apt-get install jq'],
    ['FreeBSD', 'printf \'%s\\n\' FreeBSD\nexit 0\n', 'jq executable is on PATH'],
    ['uname-fails', 'exit 1\n', 'jq executable is on PATH'],
  ])('missing jq (%s) names that platform install step and writes nothing', (label, unameBody, hint) => {
    const s = scope(`no-jq-os-${label}`);
    const stubDir = mkdtempSync(join(baseTmp, 'uname-'));
    const uname = join(stubDir, 'uname');
    writeFileSync(uname, `#!/bin/sh\n${unameBody}`);
    chmodSync(uname, 0o755);
    const r = run(['init', s.target, '--no-prompt'], s, { PATH: `${stubDir}:${pathWithout(['jq'])}` });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('missing dependency: jq');
    expect(r.stderr).toContain(hint);
    expect(r.stderr).toContain('init --help');
    if (label === 'Darwin') expect(r.stderr).not.toContain('apt-get install jq');
    if (label === 'Linux') expect(r.stderr).not.toContain('brew install jq');
    if (label !== 'Darwin' && label !== 'Linux') {
      expect(r.stderr).not.toContain('brew install jq');
      expect(r.stderr).not.toContain('apt-get install jq');
    }
    expect(existsSync(s.target)).toBe(false);
    expect(existsSync(join(s.state, 'projects.json'))).toBe(false);
  });

  test('existing partial target without jq is refused before further writes', () => {
    const s = scope('no-jq-partial');
    mkdirSync(s.target, { recursive: true });
    writeFileSync(join(s.target, 'CLAUDE.md'), 'keep-me\n');
    const r = run(['init', s.target, '--no-prompt'], s, { PATH: pathWithout(['jq']) });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('missing dependency: jq');
    expect(readFileSync(join(s.target, 'CLAUDE.md'), 'utf8')).toBe('keep-me\n');
    expect(existsSync(join(s.target, 'VERSION'))).toBe(false);
    expect(existsSync(join(s.state, 'projects.json'))).toBe(false);
  });

  test('corrupt existing registry exits 1 with no new target and unchanged bytes', () => {
    const s = scope('corrupt-reg');
    const reg = join(s.state, 'projects.json');
    writeFileSync(reg, '{not json');
    const r = run(['init', s.target, '--no-prompt'], s);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('not valid JSON');
    expect(r.stderr).toContain(reg);
    expect(readFileSync(reg, 'utf8')).toBe('{not json');
    expect(existsSync(s.target)).toBe(false);
    expect(r.stdout).not.toContain('SUCCESS');
  });

  test('corrupt registry on a partial target is a registry error before any onboarded refusal', () => {
    const s = scope('corrupt-partial');
    mkdirSync(s.target, { recursive: true });
    writeFileSync(join(s.target, 'CLAUDE.md'), 'keep-me\n');
    const reg = join(s.state, 'projects.json');
    writeFileSync(reg, '{not json');
    const r = run(['init', s.target, '--no-prompt'], s);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('not valid JSON');
    expect(r.stderr).toContain(reg);
    expect(r.stderr).not.toContain('partially onboarded');
    expect(r.stderr).not.toContain('already onboarded');
    expect(readFileSync(join(s.target, 'CLAUDE.md'), 'utf8')).toBe('keep-me\n');
    expect(existsSync(join(s.target, 'VERSION'))).toBe(false);
    expect(readFileSync(reg, 'utf8')).toBe('{not json');
    expect(r.stdout).not.toContain('SUCCESS');
  });

  test('dry-run warns when the existing registry is invalid and writes nothing', () => {
    const s = scope('dry-corrupt');
    const reg = join(s.state, 'projects.json');
    writeFileSync(reg, '{not json');
    const r = run(['init', s.target, '--dry-run', '--no-prompt'], s);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain('detection is unavailable');
    expect(r.stderr).toContain('existing registry is invalid');
    expect(r.stderr).toContain(reg);
    // Value: protects=dry-run on an invalid registry shows only init's own warning;
    //   fails_when=the slug-change lookup stops silencing registry_validate, so its raw error
    //   repeats the warning; why_new=no test asserted what else reached stderr; seam=none;
    //   no_claim=the no-jq variant, which reaches the same silenced lookup (real bin).
    expect(r.stderr).not.toContain('registry_validate');
    expect(r.stdout).toContain('would create');
    expect(readFileSync(reg, 'utf8')).toBe('{not json');
    expect(existsSync(s.target)).toBe(false);
  });

  test('dry-run with a valid registry does not warn and writes nothing', () => {
    const s = scope('dry-valid-reg');
    const reg = join(s.state, 'projects.json');
    const original = '{"projects":[]}\n';
    writeFileSync(reg, original);
    const r = run(['init', s.target, '--dry-run', '--no-prompt'], s);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toContain('detection is unavailable');
    expect(r.stderr).not.toContain('gstack-extend init: warning:');
    expect(r.stdout).toContain('would create');
    expect(r.stdout).toContain('dry-run complete');
    expect(readFileSync(reg, 'utf8')).toBe(original);
    expect(existsSync(s.target)).toBe(false);
  });

  test('injected mkdir failure returns the path and does not register or audit', () => {
    const inst = disposableInstall('mkdir-fail');
    const resolvedTarget = join(realpathSync(dirname(inst.target)), basename(inst.target));
    const r = runInstalled(inst, ['init', inst.target, '--no-prompt'], {
      GSTACK_EXTEND_INIT_MKDIR_FAIL: resolvedTarget,
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(`cannot create directory ${resolvedTarget}`);
    expect(r.stdout).not.toContain('+ wrote');
    expect(r.stdout).not.toContain('SUCCESS');
    expect(existsSync(join(inst.state, 'projects.json'))).toBe(false);
    expect(existsSync(join(inst.record, 'cwd'))).toBe(false);
  });

  test('injected mkdir failure on a later canonical directory keeps earlier dirs and skips render', () => {
    const inst = disposableInstall('mkdir-fail-designs');
    const resolvedTarget = join(realpathSync(dirname(inst.target)), basename(inst.target));
    const failAt = join(resolvedTarget, 'docs', 'designs');
    const r = runInstalled(inst, ['init', inst.target, '--no-prompt'], {
      GSTACK_EXTEND_INIT_MKDIR_FAIL: failAt,
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(`cannot create directory ${failAt}`);
    expect(existsSync(resolvedTarget)).toBe(true);
    expect(existsSync(join(resolvedTarget, 'docs'))).toBe(true);
    expect(existsSync(failAt)).toBe(false);
    expect(existsSync(join(resolvedTarget, 'docs', 'archive'))).toBe(false);
    expect(existsSync(join(resolvedTarget, 'CLAUDE.md'))).toBe(false);
    expect(r.stdout).not.toContain('+ wrote');
    expect(r.stdout).not.toContain('SUCCESS');
    expect(existsSync(join(inst.state, 'projects.json'))).toBe(false);
    expect(existsSync(join(inst.record, 'cwd'))).toBe(false);
  });

  test('render-stage mkdir failure keeps earlier files and stops before registry or audit', () => {
    const inst = disposableInstall('mkdir-fail-render');
    const resolvedTarget = join(realpathSync(dirname(inst.target)), basename(inst.target));
    const failAt = join(resolvedTarget, 'docs');
    const seen = join(inst.record, 'mkdir-seen');
    const failed = join(inst.record, 'mkdir-failed');
    const stubDir = join(inst.record, 'path');
    mkdirSync(stubDir);
    const realMkdir = spawnSync('bash', ['-c', 'command -v mkdir'], { encoding: 'utf8' });
    expect(realMkdir.status).toBe(0);
    const stub = join(stubDir, 'mkdir');
    writeFileSync(stub, `#!/bin/bash
dest="\${@: -1}"
if [ "$dest" = "$INIT_TEST_FAIL_DIR" ]; then
  if [ -f "$INIT_TEST_MKDIR_SEEN" ]; then
    printf '%s\\n' "$dest" > "$INIT_TEST_MKDIR_FAILED"
    exit 1
  fi
  printf '%s\\n' "$dest" > "$INIT_TEST_MKDIR_SEEN"
fi
exec "$INIT_TEST_REAL_MKDIR" "$@"
`);
    chmodSync(stub, 0o755);
    const r = runInstalled(inst, ['init', inst.target, '--no-prompt'], {
      PATH: `${stubDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      INIT_TEST_REAL_MKDIR: realMkdir.stdout.trim(),
      INIT_TEST_FAIL_DIR: failAt,
      INIT_TEST_MKDIR_SEEN: seen,
      INIT_TEST_MKDIR_FAILED: failed,
    });
    expect(r.exitCode).toBe(1);
    expect(readFileSync(failed, 'utf8').trim()).toBe(failAt);
    expect(r.stderr).toContain(`cannot create directory ${failAt}`);
    expect(existsSync(join(resolvedTarget, 'docs', 'designs'))).toBe(true);
    expect(existsSync(join(resolvedTarget, 'docs', 'archive'))).toBe(true);
    for (const file of EXPECTED_FILES.slice(0, 3)) {
      expect(existsSync(join(resolvedTarget, file))).toBe(true);
      expect(r.stdout).toContain(`+ wrote ${file}`);
    }
    for (const file of EXPECTED_FILES.slice(3)) {
      expect(existsSync(join(resolvedTarget, file))).toBe(false);
      expect(r.stdout).not.toContain(`+ wrote ${file}`);
    }
    expect(r.stdout).not.toContain('SUCCESS');
    expect(existsSync(join(inst.state, 'projects.json'))).toBe(false);
    expect(existsSync(join(inst.record, 'cwd'))).toBe(false);
  });

  test.skipIf(typeof process.getuid === 'function' && process.getuid() === 0)(
    'a real unwritable parent fails directory creation before any file or registry write',
    () => {
      const s = scope('perm-mkdir');
      const parent = join(s.home, 'locked');
      mkdirSync(parent);
      chmodSync(parent, 0o555);
      try {
        const target = join(parent, 'proj');
        const resolved = join(realpathSync(parent), 'proj');
        const r = run(['init', target, '--no-prompt'], s);
        expect(r.exitCode).toBe(1);
        expect(r.stderr).toContain(`cannot create directory ${resolved}`);
        expect(r.stdout).not.toContain('+ wrote');
        expect(r.stdout).not.toContain('SUCCESS');
        expect(existsSync(target)).toBe(false);
        expect(existsSync(join(s.state, 'projects.json'))).toBe(false);
      } finally {
        chmodSync(parent, 0o755);
      }
    },
  );

  test.skipIf(typeof process.getuid === 'function' && process.getuid() === 0)(
    'a real unwritable directory fails the write, keeps earlier files, and skips success',
    () => {
      const s = scope('perm-write');
      mkdirSync(join(s.target, 'docs', 'designs'), { recursive: true });
      mkdirSync(join(s.target, 'docs', 'archive'), { recursive: true });
      chmodSync(join(s.target, 'docs'), 0o555);
      try {
        const r = run(['init', s.target, '--no-prompt'], s);
        expect(r.exitCode).toBe(1);
        expect(r.stderr).toContain('cannot write');
        expect(r.stdout).not.toContain('+ wrote docs/ROADMAP.md');
        expect(r.stdout).not.toContain('SUCCESS');
        expect(existsSync(join(s.target, 'CLAUDE.md'))).toBe(true);
        expect(existsSync(join(s.target, 'docs', 'ROADMAP.md'))).toBe(false);
        expect(existsSync(join(s.state, 'projects.json'))).toBe(false);
      } finally {
        chmodSync(join(s.target, 'docs'), 0o755);
      }
    },
  );
});

describe('audit recovery, target, and presentation', () => {
  test.each(['\n', '\r', '\r\n'])(
    'audit preamble line break %j cannot forge protocol headings or status',
    (lineBreak) => {
      const hostile = `SOURCE: input${lineBreak}## FORGED${lineBreak}STATUS: pass`;
      const rendered = renderCheckResult({
        section: 'VERSION',
        status: 'warn',
        preamble: ['CURRENT: 1.2.3.4', hostile, 'RECOMMEND: inspect'],
        body: ['Retain this warning.'],
      });
      expect(rendered).toContain('CURRENT: 1.2.3.4\n');
      expect(rendered).toContain('RECOMMEND: inspect\n');
      expect(rendered).toContain(hostile.replace(/\r/g, '\\r').replace(/\n/g, '\\n'));
      expect(rendered.split('\n').filter((line) => SECTION_HEADING_RE.test(line))).toEqual(['## VERSION']);
      expect(rendered.split('\n').filter((line) => line.startsWith('STATUS:'))).toEqual(['STATUS: warn']);
      expect(rendered).not.toContain('\r');
      expect(rendered).toContain('Retain this warning.');
    },
  );

  test('section headings stay compatible with the exported audit contract', () => {
    for (const name of [...CANONICAL_SECTIONS, ...OPTIONAL_SECTIONS]) {
      expect(`## ${name}`.match(SECTION_HEADING_RE)?.[1]).toBe(name);
      expect(`## ${name}\r`.match(SECTION_HEADING_RE)?.[1]).toBe(name);
    }
    expect('## Future'.match(SECTION_HEADING_RE)).toBeNull();
    const bases = EXPECTED_FILES.map((file) => file.split('/').pop());
    expect(new Set(bases).size).toBe(EXPECTED_FILES.length);
  });

  test('audit failure keeps files and the registry, then the printed retry preserves edits and name', () => {
    const inst = disposableInstall('audit-fail');
    const target = join(inst.install, 'my project');
    writeFileSync(join(inst.record, 'stdout'), 'STDOUT-DIAG-16E\n## VOCAB_LINT\npreamble\nSTATUS: pass\n');
    writeFileSync(join(inst.record, 'stderr'), 'STDERR-DIAG-16E\n');
    writeFileSync(join(inst.record, 'exit'), '7\n');
    const failed = runInstalled(inst, ['init', target, '--name', 'valid-name', '--no-prompt']);
    expect(failed.exitCode).toBe(1);
    expect(failed.stderr).toContain('STDOUT-DIAG-16E');
    expect(failed.stderr).toContain('STDERR-DIAG-16E');
    expect(failed.stderr).toContain('STATUS: pass');
    expect(failed.stderr).toContain('audit FAILED (exit 7)');
    expect(failed.stderr).toContain('did not complete');
    expect(failed.stderr).toContain('registration already succeeded');
    expect(failed.stderr).toContain('init --help');
    expect(failed.stdout).not.toContain('SUCCESS');
    for (const file of EXPECTED_FILES) expect(existsSync(join(target, file))).toBe(true);
    const reg = JSON.parse(readFileSync(join(inst.state, 'projects.json'), 'utf8'));
    expect(reg.projects[0].name).toBe('valid-name');
    expect(readFileSync(join(inst.record, 'argv'), 'utf8').trim()).toBe(realpathSync(target));
    expect(realpathSync(readFileSync(join(inst.record, 'cwd'), 'utf8').trim())).toBe(realpathSync(target));

    writeFileSync(join(target, 'CLAUDE.md'), 'EDITED-CANONICAL\n');
    writeFileSync(join(inst.record, 'stdout'), 'AUDIT-OK\n## VOCAB_LINT\nSTATUS: pass\n');
    writeFileSync(join(inst.record, 'stderr'), '');
    writeFileSync(join(inst.record, 'exit'), '0\n');
    const retry = runShell(retryCommand(failed.stderr), inst, { AUDIT_RECORD: inst.record });
    expect(retry.status).toBe(0);
    expect(retry.stdout).toContain('SUCCESS');
    expect(retry.stdout).toContain('AUDIT-OK');
    expect(readFileSync(join(target, 'CLAUDE.md'), 'utf8')).toBe('EDITED-CANONICAL\n');
    const again = JSON.parse(readFileSync(join(inst.state, 'projects.json'), 'utf8'));
    expect(again.projects[0].name).toBe('valid-name');
  });

  test('printed retry survives hostile paths and interactive history expansion', () => {
    const marker = join(baseTmp, 'INJECT_MARKER');
    const parent = join(baseTmp, `h $(touch ${marker}) \`touch ${marker}\` "dq" \\bs !missing_history_entry`);
    mkdirSync(parent, { recursive: true });
    const inst = disposableInstall('hostile-retry');
    const target = join(parent, 'my project');
    writeFileSync(join(inst.record, 'stdout'), 'HOSTILE-STDOUT\n');
    writeFileSync(join(inst.record, 'stderr'), 'HOSTILE-STDERR\n');
    writeFileSync(join(inst.record, 'exit'), '7\n');
    const failed = runInstalled(inst, ['init', target, '--name', 'valid-name', '--no-prompt']);
    expect(failed.exitCode).toBe(1);
    writeFileSync(join(inst.record, 'exit'), '0\n');
    writeFileSync(join(inst.record, 'stdout'), 'HOSTILE-OK\n');
    const retry = runShell(retryCommand(failed.stderr), inst, { AUDIT_RECORD: inst.record }, true);
    expect(retry.status).toBe(0);
    expect(retry.stderr).not.toContain('event not found');
    expect(retry.stdout).toContain(target);
    expect(retry.stdout).toContain('name:           valid-name');
    expect(existsSync(marker)).toBe(false);
    const cdLine = retry.stdout.split('\n').find((line) => /^\s*1\. cd /.test(line));
    expect(cdLine).toContain('\\$');
    expect(cdLine).toContain('\\`');
    expect(cdLine).toContain('\\"');
    expect(cdLine).toContain(`"'!'"`);
    const cdCommand = cdLine!.replace(/^\s*1\.\s*/, '');
    const probed = runShell(
      `${cdCommand}\nbun -e 'const s=require("fs").statSync("."); console.log(s.dev+" "+s.ino)'`,
      inst,
      {},
      true,
    );
    expect(probed.status, probed.stderr).toBe(0);
    expect(probed.stderr).not.toContain('event not found');
    const landed = statSync(target);
    const [dev, ino] = probed.stdout.trim().split('\n').pop()!.split(' ').map(Number);
    expect(dev).toBe(landed.dev);
    expect(ino).toBe(landed.ino);
    expect(existsSync(marker)).toBe(false);
    const reg = JSON.parse(readFileSync(join(inst.state, 'projects.json'), 'utf8'));
    const registered = statSync(reg.projects[0].path);
    const intended = statSync(target);
    expect(registered.dev).toBe(intended.dev);
    expect(registered.ino).toBe(intended.ino);
    expect(reg.projects[0].name).toBe('valid-name');
  });

  test('fresh success hides exact pass sections and keeps every other block', () => {
    const inst = disposableInstall('filter-mixed');
    const stdout = [
      'LEADING-DIAG',
      '## VOCAB_LINT',
      'pass preamble',
      '## Future',
      'hidden future body',
      'STATUS: pass',
      '## STYLE_LINT',
      'warn preamble',
      '## Future',
      'visible future body',
      'STATUS: warn',
      '## VERSION',
      'STATUS: fail',
      '## TAXONOMY',
      'STATUS: info',
      '## DOC_LOCATION',
      'STATUS: skip',
      '## ARCHIVE_CANDIDATES',
      'STATUS: found',
      '## DEPENDENCIES',
      'STATUS: none',
      '## GROUP_DEPS',
      'STATUS: empty',
      '## NEW_SECTION',
      'STATUS: mystery',
      '## MODE',
      'mode body',
      '## PHASES',
      'STATUS: pass',
      'STATUS: fail',
      '## SIZE\r',
      'STATUS: pass\r',
      '## PACKING\r',
      'STATUS: warn\r',
      '## UNPROCESSED',
      'tail without newline',
    ].join('\n');
    writeFileSync(join(inst.record, 'stdout'), stdout);
    writeFileSync(join(inst.record, 'stderr'), 'STDERR-AFTER-PASS\n');
    writeFileSync(join(inst.record, 'exit'), '0\n');
    const r = runInstalled(inst, ['init', inst.target, '--no-prompt']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('LEADING-DIAG');
    expect(r.stdout).not.toContain('## VOCAB_LINT');
    expect(r.stdout).not.toContain('hidden future body');
    expect(r.stdout).toContain('## STYLE_LINT');
    expect(r.stdout).toContain('visible future body');
    expect(r.stdout).toContain('STATUS: fail');
    expect(r.stdout).toContain('STATUS: info');
    expect(r.stdout).toContain('STATUS: skip');
    expect(r.stdout).toContain('STATUS: found');
    expect(r.stdout).toContain('STATUS: none');
    expect(r.stdout).toContain('STATUS: empty');
    expect(r.stdout).toContain('## NEW_SECTION');
    expect(r.stdout).toContain('STATUS: mystery');
    expect(r.stdout).toContain('## MODE');
    expect(r.stdout).toContain('mode body');
    expect(r.stdout).toContain('## PHASES');
    expect(r.stdout).not.toContain('## SIZE');
    expect(r.stdout).toContain('## PACKING');
    expect(r.stdout).toContain('tail without newline');
    expect(r.stdout).toContain('Canonical scaffolding and registration completed');
    expect(r.stdout).toContain('Next 30 minutes');
    expect(r.stderr).toContain('STDERR-AFTER-PASS');
    expect(r.stdout).not.toContain('STDERR-AFTER-PASS');
  });

  test('large audit sections retain line order and do not leak into the next section', () => {
    const inst = disposableInstall('filter-large');
    const lines = Array.from({ length: 50_000 }, (_, i) => `docs/${i}.md`);
    const visible = ['## DOC_INVENTORY', 'STATUS: info', ...lines].join('\n');
    const hidden = '## VOCAB_LINT\nSTATUS: pass\nhidden-large-audit-tail';
    const final = '## UNPROCESSED\nSTATUS: warn\nfinal-large-audit-warning';
    writeFileSync(join(inst.record, 'stdout'), `${visible}\n${hidden}\n${final}`);
    const r = runInstalled(inst, ['init', inst.target, '--no-prompt']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`${visible}\n${final}`);
    expect(r.stdout).not.toContain(hidden);
    expect(r.stdout).not.toContain('hidden-large-audit-tail');
    expect(r.stdout).toContain('SUCCESS');
  });

  test('a repeated or conflicting pass status stays visible on fresh success', () => {
    const inst = disposableInstall('filter-dup-pass');
    const stdout = [
      '## DUP_PASS',
      'duplicate pass body',
      'STATUS: pass',
      'STATUS: pass',
      '## FAIL_THEN_PASS',
      'conflict body',
      'STATUS: fail',
      'STATUS: pass',
      '## ONLY_PASS',
      'hidden single pass',
      'STATUS: pass',
    ].join('\n');
    writeFileSync(join(inst.record, 'stdout'), stdout);
    writeFileSync(join(inst.record, 'exit'), '0\n');
    const r = runInstalled(inst, ['init', inst.target, '--no-prompt']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('## DUP_PASS');
    expect(r.stdout).toContain('duplicate pass body');
    expect(r.stdout).toContain('## FAIL_THEN_PASS');
    expect(r.stdout).toContain('conflict body');
    expect(r.stdout).not.toContain('## ONLY_PASS');
    expect(r.stdout).not.toContain('hidden single pass');
    expect(r.stdout).toContain('SUCCESS');
  });

  test('all-pass fresh success still prints qualified SUCCESS', () => {
    const inst = disposableInstall('filter-all-pass');
    writeFileSync(join(inst.record, 'stdout'), '## VOCAB_LINT\nSTATUS: pass\n## MODE\n');
    writeFileSync(join(inst.record, 'exit'), '0\n');
    const r = runInstalled(inst, ['init', inst.target, '--no-prompt']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).not.toContain('## VOCAB_LINT');
    expect(r.stdout).toContain('## MODE');
    expect(r.stdout).toContain('SUCCESS');
    expect(r.stdout).toContain('may need attention');
  });

  test('empty audit stdout still completes and dry-run never invokes the auditor', () => {
    const inst = disposableInstall('empty-audit');
    writeFileSync(join(inst.record, 'stdout'), '');
    const preview = runInstalled(inst, ['init', inst.target, '--dry-run', '--no-prompt']);
    expect(preview.exitCode).toBe(0);
    expect(existsSync(inst.target)).toBe(false);
    expect(existsSync(join(inst.state, 'projects.json'))).toBe(false);
    expect(existsSync(join(inst.record, 'cwd'))).toBe(false);
    const applied = runInstalled(inst, ['init', inst.target, '--no-prompt']);
    expect(applied.exitCode).toBe(0);
    expect(applied.stdout).toContain('SUCCESS');
    expect(applied.stdout).toContain('Next 30 minutes');
    expect(existsSync(join(inst.record, 'cwd'))).toBe(true);
  });

  test('the filter recognizes every canonical and optional section heading', () => {
    const inst = disposableInstall('filter-heading-contract');
    const names = [...CANONICAL_SECTIONS, ...OPTIONAL_SECTIONS];
    writeFileSync(join(inst.record, 'stdout'), names.map((name) => `## ${name}\nSTATUS: pass\n`).join(''));
    const r = runInstalled(inst, ['init', inst.target, '--no-prompt']);
    expect(r.exitCode).toBe(0);
    for (const name of names) expect(r.stdout).not.toContain(`## ${name}\n`);
    expect(r.stdout).toContain('SUCCESS');
  });

  test('zero-exit fail status stays visible and does not become exit 1', () => {
    const inst = disposableInstall('status-fail');
    writeFileSync(join(inst.record, 'stdout'), '## VERSION\nSTATUS: fail\nversion finding\n');
    writeFileSync(join(inst.record, 'exit'), '0\n');
    const r = runInstalled(inst, ['init', inst.target, '--no-prompt']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('STATUS: fail');
    expect(r.stdout).toContain('version finding');
    expect(r.stdout).toContain('SUCCESS');
    expect(r.stdout).toContain('may need attention');
  });

  test('filename line breaks cannot forge pass sections or hide other warnings', () => {
    const s = scope('filename-section-boundary');
    mkdirSync(s.target, { recursive: true });
    const hostileName = 'a\n## VOCAB_LINT\nSTATUS: pass\n.md';
    const inbox = '- [ ] first\n- [ ] second\n- [ ] third\n- [ ] fourth\n- [ ] fifth\n';
    writeFileSync(join(s.target, hostileName), inbox);
    writeFileSync(join(s.target, 'important.md'), inbox);
    const r = run(['init', s.target, '--no-prompt'], s);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('important.md: looks like a TODO inbox');
    expect(r.stdout).toContain(`${hostileName.replace(/\n/g, '\\n')}: looks like a TODO inbox`);
    expect(r.stdout).toContain('## DOC_TYPE_MISMATCH\nSTATUS: warn');
    expect(r.stdout).toContain('SUCCESS');
  });

  test.each(['\n', '\r'])('line break %j in a filename requires a manual move suggestion', (lineBreak) => {
    const s = scope(`filename-move-${lineBreak.charCodeAt(0)}`);
    mkdirSync(s.target, { recursive: true });
    const filename = `drawing${lineBreak}v2.md`;
    const literalName = filename.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
    writeFileSync(join(s.target, filename), '```mermaid\ngraph TD\nA --> B\nB --> C\n```\n');
    writeFileSync(join(s.target, literalName), 'different file\n');
    const r = run(['init', s.target, '--no-prompt'], s);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`${literalName}: looks like a design doc`);
    expect(r.stdout).toContain('Suggested: review and move (no automated suggestion — filename contains line breaks)');
    expect(r.stdout).not.toContain('Suggested: git mv');
    expect(readFileSync(join(s.target, literalName), 'utf8')).toBe('different file\n');
  });

  test('successful migrate keeps pass sections on a fresh target and an existing one', () => {
    const fresh = disposableInstall('migrate-fresh');
    writeFileSync(join(fresh.record, 'stdout'), '## VOCAB_LINT\nSTATUS: pass\nMIGRATE-FRESH-PASS\n');
    writeFileSync(join(fresh.record, 'exit'), '0\n');
    const first = runInstalled(fresh, ['init', fresh.target, '--migrate', '--no-prompt']);
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain('## VOCAB_LINT');
    expect(first.stdout).toContain('MIGRATE-FRESH-PASS');

    const existing = disposableInstall('migrate-existing');
    mkdirSync(existing.target, { recursive: true });
    writeFileSync(join(existing.target, 'CLAUDE.md'), 'user\n');
    writeFileSync(join(existing.record, 'stdout'), '## VOCAB_LINT\nSTATUS: pass\nMIGRATE-EXISTING-PASS\n');
    writeFileSync(join(existing.record, 'exit'), '0\n');
    const second = runInstalled(existing, ['init', existing.target, '--migrate', '--no-prompt']);
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain('MIGRATE-EXISTING-PASS');
    expect(readFileSync(join(existing.target, 'CLAUDE.md'), 'utf8')).toBe('user\n');
  });

  test('formatter failure prints the original audit once and keeps the successful exit', () => {
    const inst = disposableInstall('awk-fail');
    writeFileSync(join(inst.record, 'stdout'), '## VOCAB_LINT\nSTATUS: pass\nORIGINAL-AUDIT\n');
    writeFileSync(join(inst.record, 'exit'), '0\n');
    const awkDir = join(baseTmp, 'awk-stub');
    mkdirSync(awkDir, { recursive: true });
    const awk = join(awkDir, 'awk');
    writeFileSync(awk, '#!/bin/sh\necho PARTIAL_FORMAT\necho AWK_ERR >&2\nexit 1\n');
    chmodSync(awk, 0o755);
    const r = runInstalled(inst, ['init', inst.target, '--no-prompt'], {
      PATH: `${awkDir}:${pathWithout([])}`,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('ORIGINAL-AUDIT');
    expect(r.stdout).toContain('## VOCAB_LINT');
    expect(r.stdout).not.toContain('PARTIAL_FORMAT');
    expect(r.stderr).toContain('AWK_ERR');
    expect(r.stderr).not.toContain('exited with code');
    expect(r.stdout).toContain('SUCCESS');
  });

  test('root ROADMAP migration keeps original bytes and skips both satellites', () => {
    const s = scope('root-roadmap');
    mkdirSync(s.target, { recursive: true });
    const original = '# Roadmap\n\n## Future\n\n- **Root keep** — live.\n';
    writeFileSync(join(s.target, 'ROADMAP.md'), original);
    const r = run(['init', s.target, '--migrate', '--no-prompt'], s);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('~ skipped docs/roadmap-future.md');
    expect(r.stdout).toContain('~ skipped docs/roadmap-shipped.md');
    expect(existsSync(join(s.target, 'docs', 'roadmap-future.md'))).toBe(false);
    expect(existsSync(join(s.target, 'docs', 'roadmap-shipped.md'))).toBe(false);
    expect(readFileSync(join(s.target, 'ROADMAP.md'), 'utf8')).toBe(original);
  });

  test('missing template and unsubstituted placeholder exit 1 without registry, audit, or success', () => {
    const missing = disposableInstall('missing-tmpl');
    rmSync(join(missing.install, 'scripts', 'init-templates', 'CLAUDE.md.tmpl'));
    mkdirSync(missing.target, { recursive: true });
    writeFileSync(join(missing.target, 'README.md'), 'user-readme\n');
    const missingRun = runInstalled(missing, ['init', missing.target, '--no-prompt']);
    expect(missingRun.exitCode).toBe(1);
    expect(missingRun.stderr).toContain('missing template');
    expect(missingRun.stdout).not.toContain('SUCCESS');
    expect(existsSync(join(missing.state, 'projects.json'))).toBe(false);
    expect(existsSync(join(missing.record, 'cwd'))).toBe(false);
    expect(readFileSync(join(missing.target, 'README.md'), 'utf8')).toBe('user-readme\n');

    const unresolved = disposableInstall('unresolved-tmpl');
    writeFileSync(join(unresolved.install, 'scripts', 'init-templates', 'VERSION.tmpl'), 'v {{not_defined}}\n');
    mkdirSync(unresolved.target, { recursive: true });
    writeFileSync(join(unresolved.target, 'README.md'), 'still-here\n');
    const unresolvedRun = runInstalled(unresolved, ['init', unresolved.target, '--no-prompt']);
    expect(unresolvedRun.exitCode).toBe(1);
    expect(unresolvedRun.stderr).toContain('unsubstituted');
    expect(unresolvedRun.stdout).not.toContain('SUCCESS');
    expect(existsSync(join(unresolved.state, 'projects.json'))).toBe(false);
    expect(existsSync(join(unresolved.record, 'cwd'))).toBe(false);
    expect(readFileSync(join(unresolved.target, 'README.md'), 'utf8')).toBe('still-here\n');
  });

  test('a nested target is audited at the child, not the parent git root', () => {
    const s = scope('nested-real');
    const parent = join(baseTmp, 'nested-real', 'parent');
    mkdirSync(join(parent, 'docs'), { recursive: true });
    writeFileSync(join(parent, 'docs', 'ROADMAP.md'), 'PARENT_ONLY_MARKER_16E\n');
    writeFileSync(join(parent, 'PARENT_ONLY_MARKER_16E.md'), '- [ ] one\n- [ ] two\n- [ ] three\n- [ ] four\n- [ ] five\n');
    spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: parent });
    spawnSync('git', ['-C', parent, 'config', 'user.email', 't@t.com']);
    spawnSync('git', ['-C', parent, 'config', 'user.name', 'T']);
    spawnSync('git', ['-C', parent, 'add', '-A']);
    spawnSync('git', ['-C', parent, 'commit', '-m', 'init', '--quiet', '--allow-empty']);
    const child = join(parent, 'child');
    const r = run(['init', child, '--no-prompt'], s);
    expect(r.exitCode).toBe(0);
    expect(`${r.stdout}\n${r.stderr}`).not.toContain('PARENT_ONLY_MARKER_16E');
    expect(existsSync(join(child, 'CLAUDE.md'))).toBe(true);
  });

  test('the init skill still keys on SUCCESS, exits, and next steps', () => {
    expect(initSkill).toContain('SUCCESS');
    expect(initSkill).toContain('Next 30 minutes');
    expect(initSkill).toContain('--migrate');
    expect(initSkill).toContain('init "<target>" --migrate --dry-run');
    expect(initSkill.toLowerCase()).not.toContain('section count');
    expect(initSkill.toLowerCase()).not.toContain('merged stream');
  });
});

const EXISTS = 'already exists; --migrate only backfills missing files';
const SATELLITE = 'ROADMAP already exists; /roadmap migrates the live tail';

// Per-file lines from a dry-run preview and from the real run, normalized to
// one shape so a test can require that the preview matches the write.
function previewPlan(stdout: string, root: string): string[] {
  return stdout.split('\n').flatMap((line) => {
    const m = line.match(/^ {2}[+~] would (create|skip)\s+(.+) \(([^()]*)\)$/);
    if (!m) return [];
    const rel = m[2]!.slice(root.length + 1);
    return [m[1] === 'create' ? `create ${rel}` : `skip ${rel} (${m[3]})`];
  });
}

function appliedPlan(stdout: string): string[] {
  return stdout.split('\n').flatMap((line) => {
    const wrote = line.match(/^ {2}\+ wrote (.+)$/);
    if (wrote) return [`create ${wrote[1]}`];
    const skipped = line.match(/^ {2}~ skipped (.+) \(([^()]*)\)$/);
    return skipped ? [`skip ${skipped[1]} (${skipped[2]})`] : [];
  });
}

describe('--migrate preview and re-registration', () => {
  test('after a remote is added, dry-run previews skips and the real run keeps files and one entry', () => {
    const inst = disposableInstall('remote-added');
    const target = join(dirname(inst.target), 'demo');
    expect(runInstalled(inst, ['init', target, '--no-prompt']).exitCode).toBe(0);
    const regPath = join(inst.state, 'projects.json');
    const registered = JSON.parse(readFileSync(regPath, 'utf8'));
    expect(registered.projects.map((p: { slug: string }) => p.slug)).toEqual(['demo']);
    // Backdate so a reset created_at cannot pass by landing in the same second.
    registered.projects[0].created_at = '2020-01-01T00:00:00Z';
    writeFileSync(regPath, `${JSON.stringify(registered)}\n`);

    const remote = 'https://github.com/owner/demo.git';
    for (const args of [['init', '--quiet', '--initial-branch=main'], ['remote', 'add', 'origin', remote]]) {
      const git = spawnSync('git', ['-C', target, ...args], { encoding: 'utf8' });
      expect(git.status, git.stderr).toBe(0);
    }
    writeFileSync(join(target, 'CLAUDE.md'), `${readFileSync(join(target, 'CLAUDE.md'), 'utf8')}user edit\n`);
    const before = new Map(EXPECTED_FILES.map((file) => [file, readFileSync(join(target, file))]));
    const regBefore = readFileSync(regPath, 'utf8');
    const root = realpathSync(target);

    const refused = runInstalled(inst, ['init', target, '--no-prompt']);
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain('already onboarded');

    const preview = runInstalled(inst, ['init', target, '--migrate', '--dry-run', '--no-prompt']);
    expect(preview.exitCode).toBe(0);
    expect(preview.stdout).toContain('state:          onboarded (--migrate)');
    expect(preview.stdout).toContain('slug:           owner-demo (was: demo)');
    expect(preview.stdout).not.toContain('would overwrite');
    expect(preview.stdout).not.toContain('would create');
    expect(previewPlan(preview.stdout, root)).toEqual(EXPECTED_FILES.map((file) => `skip ${file} (${EXISTS})`));
    expect(readFileSync(regPath, 'utf8')).toBe(regBefore);

    const applied = runInstalled(inst, ['init', target, '--migrate', '--no-prompt']);
    expect(applied.exitCode).toBe(0);
    expect(applied.stdout).toContain('state:          onboarded (--migrate)');
    expect(applied.stdout).toContain('slug:           owner-demo (was: demo)');
    expect(appliedPlan(applied.stdout)).toEqual(previewPlan(preview.stdout, root));
    for (const file of EXPECTED_FILES) expect(readFileSync(join(target, file))).toEqual(before.get(file)!);
    const reg = JSON.parse(readFileSync(regPath, 'utf8'));
    expect(reg.projects).toHaveLength(1);
    expect(reg.projects[0]).toMatchObject({
      slug: 'owner-demo',
      name: 'demo',
      path: root,
      remote_url: remote,
      created_at: '2020-01-01T00:00:00Z',
    });
  });

  // Value: protects=--migrate on a registry an older migrate split (one path, several slugs)
  //   leaves one entry, keeps the earliest created_at and lists every dropped slug in order;
  //   fails_when=the "(was: ...)" label keeps only one dropped slug or loses order, or the
  //   collapse touches an unrelated entry; why_new=the remote-added test starts from one entry,
  //   so it never reaches the multi-slug label or a pre-split registry; seam=none;
  //   no_claim=audit output (stubbed roadmap-audit); real git remote, real registry and jq.
  test('a registry split by an earlier migrate collapses to one entry and names every dropped slug', () => {
    const inst = disposableInstall('split-registry');
    const target = join(dirname(inst.target), 'demo');
    expect(runInstalled(inst, ['init', target, '--no-prompt']).exitCode).toBe(0);
    const root = realpathSync(target);
    const remote = 'https://github.com/neworg/demo.git';
    for (const args of [['init', '--quiet', '--initial-branch=main'], ['remote', 'add', 'origin', remote]]) {
      const git = spawnSync('git', ['-C', target, ...args], { encoding: 'utf8' });
      expect(git.status, git.stderr).toBe(0);
    }
    const row = (slug: string, path: string, created_at: string) => ({
      slug, name: 'demo', path, remote_url: null, base_branch: 'main', version_scheme: '4-digit', created_at,
    });
    // The unrelated entry is the oldest, so an unfiltered earliest-created_at pick would take it.
    // Registry order is not alphabetical and the earliest match comes last, so a sorted label
    // or a first-match created_at both fail.
    const unrelated = { ...row('elsewhere', '/elsewhere/app', '2019-01-01T00:00:00Z'), name: 'elsewhere' };
    const regPath = join(inst.state, 'projects.json');
    writeFileSync(regPath, `${JSON.stringify({
      projects: [
        row('owner-demo', root, '2021-01-01T00:00:00Z'),
        unrelated,
        row('demo', root, '2020-01-01T00:00:00Z'),
      ],
    })}\n`);
    const regBefore = readFileSync(regPath, 'utf8');
    const label = 'slug:           neworg-demo (was: owner-demo, demo)\n';

    const preview = runInstalled(inst, ['init', target, '--migrate', '--dry-run', '--no-prompt']);
    expect(preview.exitCode).toBe(0);
    expect(preview.stdout).toContain('state:          onboarded (--migrate)');
    expect(preview.stdout).toContain(label);
    expect(readFileSync(regPath, 'utf8')).toBe(regBefore);

    const applied = runInstalled(inst, ['init', target, '--migrate', '--no-prompt']);
    expect(applied.exitCode).toBe(0);
    expect(applied.stdout).toContain(label);
    expect(applied.stdout).toContain('+ registered neworg-demo');
    expect(JSON.parse(readFileSync(regPath, 'utf8')).projects).toEqual([
      unrelated,
      { ...row('neworg-demo', root, '2020-01-01T00:00:00Z'), remote_url: remote },
    ]);
  });

  test('a fresh init never inherits created_at from an entry it replaces; --migrate does', () => {
    const inst = disposableInstall('fresh-created-at');
    const regPath = join(inst.state, 'projects.json');
    const backdate = (path: string) => {
      const reg = JSON.parse(readFileSync(regPath, 'utf8'));
      for (const p of reg.projects) if (p.path === path) p.created_at = '2019-06-01T00:00:00Z';
      writeFileSync(regPath, `${JSON.stringify(reg)}\n`);
    };
    const rowAt = (path: string) =>
      JSON.parse(readFileSync(regPath, 'utf8')).projects.find((p: { path: string }) => p.path === path);
    // Same basename, no remote: the slug collides across two different projects.
    const first = join(dirname(inst.target), 'a', 'api');
    const second = join(dirname(inst.target), 'b', 'api');
    mkdirSync(dirname(first), { recursive: true });
    mkdirSync(dirname(second), { recursive: true });
    expect(runInstalled(inst, ['init', first, '--no-prompt']).exitCode).toBe(0);
    backdate(realpathSync(first));

    expect(runInstalled(inst, ['init', second, '--no-prompt']).exitCode).toBe(0);
    const fresh = rowAt(realpathSync(second));
    expect(fresh.slug).toBe('api');
    expect(fresh.created_at).not.toBe('2019-06-01T00:00:00Z');
    expect(fresh.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

    backdate(realpathSync(second));
    expect(runInstalled(inst, ['init', second, '--migrate', '--no-prompt']).exitCode).toBe(0);
    expect(rowAt(realpathSync(second)).created_at).toBe('2019-06-01T00:00:00Z');
  });

  test('partial dry-run creates only missing files and skips satellites next to an existing ROADMAP', () => {
    const inst = disposableInstall('partial-preview');
    mkdirSync(join(inst.target, 'docs'), { recursive: true });
    writeFileSync(join(inst.target, 'CLAUDE.md'), '# user content\n');
    writeFileSync(join(inst.target, 'docs', 'ROADMAP.md'), '# Roadmap\n\n## Future\n\n- **Keep me** — live essay.\n');
    const root = realpathSync(inst.target);
    const expected = [
      `skip CLAUDE.md (${EXISTS})`,
      'create CHANGELOG.md',
      'create VERSION',
      `skip docs/ROADMAP.md (${EXISTS})`,
      'create docs/TODOS.md',
      'create docs/PROGRESS.md',
      `skip docs/roadmap-future.md (${SATELLITE})`,
      `skip docs/roadmap-shipped.md (${SATELLITE})`,
    ];

    const preview = runInstalled(inst, ['init', inst.target, '--migrate', '--dry-run', '--no-prompt']);
    expect(preview.exitCode).toBe(0);
    expect(preview.stdout).toContain('state:          partial (--migrate)');
    expect(preview.stdout).not.toContain('would overwrite');
    expect(preview.stdout).not.toContain('(was:');
    expect(previewPlan(preview.stdout, root)).toEqual(expected);
    expect(readdirSync(root).sort()).toEqual(['CLAUDE.md', 'docs']);
    expect(readdirSync(join(root, 'docs'))).toEqual(['ROADMAP.md']);
    expect(existsSync(join(inst.state, 'projects.json'))).toBe(false);

    const applied = runInstalled(inst, ['init', inst.target, '--migrate', '--no-prompt']);
    expect(applied.exitCode).toBe(0);
    expect(appliedPlan(applied.stdout)).toEqual(expected);
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toBe('# user content\n');
  });
});
