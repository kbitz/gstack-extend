/**
 * Tests for bin/lib/preamble.sh (Track 92A start command).
 *
 * Covers:
 * - Frozen-block differential output identity across all 4 variants and all resolver outcomes
 *   on Claude Code and Codex (plus mixed-host precedence E7).
 * - Explicit expected-output assertions for verified root, unverified pointer, and no install.
 * - --help / -h, coded PREAMBLE_USAGE exit-2 errors, --root and --resume telemetry call counts.
 * - Stderr diagnostics (update-check non-zero exit, no install).
 * - Exit-status branches mapped to skill failure messages (127 missing, 126 non-exec, 2 usage,
 *   2 without usage prefix, signal exit).
 * - Shell paste compatibility (bash, and zsh when installed).
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  DOCS_SHIP_TAIL,
  hasZsh,
  hostDir,
  INIT_TAIL,
  MARKER_LINE,
  ROOT_RESOLVER_SKILLS,
  runShell,
  scopedEnv,
  skillPreamble,
  UPGRADE_TAIL,
  WORKFLOW_TAIL,
  writePointer,
  writeUpdateCheck,
  expectedPreambleLine,
} from './helpers/extend-root.ts';

const REPO_ROOT = resolve(import.meta.dir, '..');
const PREAMBLE_SRC = join(REPO_ROOT, 'bin', 'lib', 'preamble.sh');
const baseTmp = mkdtempSync(join(tmpdir(), 'gx-preamble-'));

afterAll(() => {
  rmSync(baseTmp, { recursive: true, force: true });
});

function installPreamble(home: string): string {
  const binDir = join(home, '.gstack-extend', 'bin');
  mkdirSync(binDir, { recursive: true });
  const dst = join(binDir, 'preamble');
  copyFileSync(PREAMBLE_SRC, dst);
  chmodSync(dst, 0o755);
  return dst;
}

function writeHelper(root: string, name: string, executable = true): void {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const p = join(bin, name);
  writeFileSync(p, '#!/bin/sh\nexit 0\n');
  chmodSync(p, executable ? 0o755 : 0o644);
}

function writeUpdateCheckWithOutput(root: string, opts: { stdout?: string; exitCode?: number; echoArgs?: boolean } = {}): void {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const lines = ['#!/bin/sh', MARKER_LINE];
  if (opts.echoArgs) lines.push('printf "ARGS:%s\\n" "$*"');
  if (opts.stdout) lines.push(`printf '%s\\n' ${JSON.stringify(opts.stdout)}`);
  lines.push(`exit ${opts.exitCode ?? 0}`);
  const p = join(bin, 'update-check');
  writeFileSync(p, lines.join('\n') + '\n');
  chmodSync(p, 0o755);
}

function writeTelemetryStub(home: string, logFile: string): string {
  const binDir = join(home, '.gstack-extend', 'bin');
  mkdirSync(binDir, { recursive: true });
  const dst = join(binDir, 'telemetry-call');
  writeFileSync(
    dst,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(logFile)}\necho "GE_TELEMETRY: session=extend-test-stub start=123"\n`,
  );
  chmodSync(dst, 0o755);
  return dst;
}

type Variant = {
  name: string;
  skill: string;
  args: string[];
  frozenTail: string;
  helper?: string;
};

const VARIANTS: Variant[] = [
  { name: 'workflow', skill: 'implement', args: ['implement'], frozenTail: WORKFLOW_TAIL },
  { name: 'upgrade (--force)', skill: 'gstack-extend-upgrade', args: ['gstack-extend-upgrade', '--force'], frozenTail: UPGRADE_TAIL },
  { name: 'init (--require gstack-extend)', skill: 'gstack-extend-init', args: ['gstack-extend-init', '--require', 'gstack-extend'], frozenTail: INIT_TAIL, helper: 'gstack-extend' },
  { name: 'docs-ship (--require docs-ship)', skill: 'docs-ship', args: ['docs-ship', '--require', 'docs-ship'], frozenTail: DOCS_SHIP_TAIL, helper: 'docs-ship' },
];

/** Normalize the only allowed diff: four-host wording in frozen block vs two-host wording in preamble.sh. */
function normalizeFourToTwoHosts(text: string): string {
  return text.replace(
    'under ~/.claude, ~/.codex, ~/.config/opencode or ~/.cursor.',
    'under ~/.claude or ~/.codex.',
  );
}

describe('bin/lib/preamble.sh — differential output identity vs frozen inline block', () => {
  for (const host of ['claude', 'codex'] as const) {
    for (const variant of VARIANTS) {
      const scenarios = [
        'verified-link',
        'verified-pointer',
        'empty-pointer',
        'missing-update-check',
        'non-exec-update-check',
        'markerless-update-check',
        'relative-pointer',
        'special-chars-root',
        'no-install',
      ] as const;

      for (const scenario of scenarios) {
        test(`${host} / ${variant.name} / ${scenario}`, () => {
          const home = mkdtempSync(join(baseTmp, `diff-${host}-${scenario}-`));
          const root = scenario === 'special-chars-root'
            ? join(home, "checkout with space & it's quote")
            : join(home, 'checkout');
          mkdirSync(join(root, 'skills'), { recursive: true });
          const skillFile = join(root, 'skills', `${variant.skill}.md`);
          writeFileSync(skillFile, '# stub\n');

          if (scenario === 'verified-link' || scenario === 'special-chars-root') {
            writeUpdateCheckWithOutput(root, { echoArgs: true });
            if (variant.helper) writeHelper(root, variant.helper, true);
            const dir = hostDir(home, host, variant.skill);
            mkdirSync(dir, { recursive: true });
            symlinkSync(skillFile, join(dir, 'SKILL.md'));
          } else if (scenario === 'verified-pointer') {
            writeUpdateCheckWithOutput(root, { echoArgs: true });
            if (variant.helper) writeHelper(root, variant.helper, true);
            writePointer(home, host, variant.skill, root);
          } else if (scenario === 'empty-pointer') {
            writePointer(home, host, variant.skill, '', false);
          } else if (scenario === 'missing-update-check') {
            writePointer(home, host, variant.skill, root);
          } else if (scenario === 'non-exec-update-check') {
            writeUpdateCheck(root, { executable: false });
            writePointer(home, host, variant.skill, root);
          } else if (scenario === 'markerless-update-check') {
            writeUpdateCheck(root, { marker: false });
            writePointer(home, host, variant.skill, root);
          } else if (scenario === 'relative-pointer') {
            writePointer(home, host, variant.skill, 'relative/checkout');
          }

          const env = scopedEnv(home);
          const frozenScript = skillPreamble(variant.skill, variant.frozenTail);
          const frozen = runShell('bash', ['-c'], frozenScript, env);
          const actual = spawnSync(PREAMBLE_SRC, variant.args, { env, encoding: 'utf8', timeout: 10_000 });

          expect(actual.status).toBe(frozen.status);
          expect(actual.stdout).toBe(normalizeFourToTwoHosts(frozen.stdout));
        });
      }
    }
  }

  test('--require helper missing or non-executable matches frozen block', () => {
    for (const helper of ['gstack-extend', 'docs-ship'] as const) {
      const skill = helper === 'gstack-extend' ? 'gstack-extend-init' : 'docs-ship';
      const tail = helper === 'gstack-extend' ? INIT_TAIL : DOCS_SHIP_TAIL;
      const home = mkdtempSync(join(baseTmp, `req-missing-${helper}-`));
      const root = join(home, 'checkout');
      writeUpdateCheck(root);
      writePointer(home, 'claude', skill, root);

      const env = scopedEnv(home);
      const frozen = runShell('bash', ['-c'], skillPreamble(skill, tail), env);
      const actual = spawnSync(PREAMBLE_SRC, [skill, '--require', helper], { env, encoding: 'utf8', timeout: 10_000 });
      expect(actual.status).toBe(1);
      expect(actual.status).toBe(frozen.status);
      expect(actual.stdout).toBe(frozen.stdout);
      expect(actual.stdout).toContain(`ERROR: ${root}/bin/${helper} is missing or not executable.`);
    }
  });
});

describe('bin/lib/preamble.sh — explicit resolver outcomes & mixed-host precedence (E7)', () => {
  test('explicit assertions: verified root, unverified pointer with fix, and no install', () => {
    // 1. Verified root
    const home1 = mkdtempSync(join(baseTmp, 'exp-verified-'));
    const root1 = join(home1, 'checkout');
    writeUpdateCheck(root1);
    writePointer(home1, 'claude', 'roadmap', root1);
    const r1 = spawnSync(PREAMBLE_SRC, ['roadmap'], { env: scopedEnv(home1), encoding: 'utf8' });
    expect(r1.status).toBe(0);
    expect(r1.stdout).toBe(`EXTEND_ROOT: ${root1}\n_EXTEND_ROOT=${root1}\n`);
    expect(r1.stderr).toBe('');

    // 2. Unverified pointer with fix
    const home2 = mkdtempSync(join(baseTmp, 'exp-unverified-'));
    const root2 = join(home2, 'missing-checkout');
    writePointer(home2, 'codex', 'roadmap', root2);
    const r2 = spawnSync(PREAMBLE_SRC, ['roadmap'], { env: scopedEnv(home2), encoding: 'utf8' });
    expect(r2.status).toBe(0);
    expect(r2.stdout).toBe(
      `EXTEND_ROOT_UNVERIFIED: ${root2} has no bin/update-check (checkout moved or deleted). Fix: re-clone gstack-extend (README: Installation), then run its setup --host auto\n`,
    );

    // 3. No install (also checks DX-5 stderr diagnostic and two-host-only probing)
    const home3 = mkdtempSync(join(baseTmp, 'exp-no-install-'));
    const cursorRoot = join(home3, 'cursor-only');
    writeUpdateCheck(cursorRoot);
    writePointer(home3, 'cursor', 'roadmap', cursorRoot);
    writePointer(home3, 'opencode', 'roadmap', cursorRoot);
    const r3 = spawnSync(PREAMBLE_SRC, ['roadmap'], { env: scopedEnv(home3), encoding: 'utf8' });
    expect(r3.status).toBe(0);
    expect(r3.stdout).toBe('');
    expect(r3.stderr).toContain('preamble: no gstack-extend install under ~/.claude/skills/roadmap or ~/.codex/skills/roadmap');
  });

  test('E7 mixed-host: unverified Claude link + verified Codex pointer -> Codex pointer wins', () => {
    const home = mkdtempSync(join(baseTmp, 'mixed-1-'));
    const badRoot = join(home, 'bad');
    mkdirSync(join(badRoot, 'skills'), { recursive: true });
    writeFileSync(join(badRoot, 'skills', 'implement.md'), '# bad\n');
    const claudeDir = hostDir(home, 'claude', 'implement');
    mkdirSync(claudeDir, { recursive: true });
    symlinkSync(join(badRoot, 'skills', 'implement.md'), join(claudeDir, 'SKILL.md'));

    const goodRoot = join(home, 'good');
    writeUpdateCheck(goodRoot);
    writePointer(home, 'codex', 'implement', goodRoot);

    const r = spawnSync(PREAMBLE_SRC, ['implement', '--root'], { env: scopedEnv(home), encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`EXTEND_ROOT: ${goodRoot}\n_EXTEND_ROOT=${goodRoot}\n`);
  });

  test('E7 mixed-host: empty Claude pointer + verified Codex pointer -> Codex wins with no unverified line', () => {
    const home = mkdtempSync(join(baseTmp, 'mixed-2-'));
    writePointer(home, 'claude', 'implement', '', false);
    const goodRoot = join(home, 'good');
    writeUpdateCheck(goodRoot);
    writePointer(home, 'codex', 'implement', goodRoot);

    const r = spawnSync(PREAMBLE_SRC, ['implement', '--root'], { env: scopedEnv(home), encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`EXTEND_ROOT: ${goodRoot}\n_EXTEND_ROOT=${goodRoot}\n`);
    expect(r.stdout).not.toContain('EXTEND_ROOT_UNVERIFIED');
  });

  test('E7 mixed-host: verified Claude pointer + verified Codex link -> Codex link wins (links before pointers)', () => {
    const home = mkdtempSync(join(baseTmp, 'mixed-3-'));
    const pointerRoot = join(home, 'from-pointer');
    writeUpdateCheck(pointerRoot);
    writePointer(home, 'claude', 'implement', pointerRoot);

    const linkRoot = join(home, 'from-link');
    writeUpdateCheck(linkRoot);
    mkdirSync(join(linkRoot, 'skills'), { recursive: true });
    writeFileSync(join(linkRoot, 'skills', 'implement.md'), '# good\n');
    const codexDir = hostDir(home, 'codex', 'implement');
    mkdirSync(codexDir, { recursive: true });
    symlinkSync(join(linkRoot, 'skills', 'implement.md'), join(codexDir, 'SKILL.md'));

    const r = spawnSync(PREAMBLE_SRC, ['implement', '--root'], { env: scopedEnv(home), encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`EXTEND_ROOT: ${linkRoot}\n_EXTEND_ROOT=${linkRoot}\n`);
  });
});

describe('bin/lib/preamble.sh — flags, usage errors, modes, and diagnostics', () => {
  test('--help and -h print synopsis and flag descriptions to stdout and exit 0', () => {
    for (const flag of ['--help', '-h']) {
      const r = spawnSync(PREAMBLE_SRC, [flag], { env: scopedEnv(baseTmp), encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stderr).toBe('');
      expect(r.stdout).toContain('Usage: preamble <skill> [--force] [--require <helper>] [--root | --resume]');
      expect(r.stdout).toContain('print only the root lines');
      expect(r.stdout).toContain('start a new telemetry segment');
    }
  });

  test('rejected invocations print PREAMBLE_USAGE + usage to stderr, nothing to stdout, exit 2', () => {
    const badCases = [
      [],
      ['implement', '--unknown'],
      ['implement', '--require'],
      ['implement', '--require', 'BAD_NAME'],
      ['implement', '--root', '--resume'],
      ['BAD_SKILL'],
      ['-bad'],
      ['implement', '--help'],
    ];
    const home = mkdtempSync(join(baseTmp, 'usage-err-'));
    const logFile = join(home, 'tel.log');
    writeTelemetryStub(home, logFile);

    for (const args of badCases) {
      const r = spawnSync(PREAMBLE_SRC, args, { env: scopedEnv(home), encoding: 'utf8' });
      expect(r.status, `args=${JSON.stringify(args)}`).toBe(2);
      expect(r.stdout).toBe('');
      const lines = r.stderr.trim().split('\n');
      expect(lines.length).toBe(2);
      expect(lines[0]).toMatch(/^preamble: PREAMBLE_USAGE: /);
      expect(lines[1]).toBe('preamble: usage: preamble <skill> [--force] [--require <helper>] [--root | --resume]');
    }
  });

  test('telemetry start counts: --root runs 0, default runs 1, --resume runs 1', () => {
    const home = mkdtempSync(join(baseTmp, 'tel-counts-'));
    const root = join(home, 'checkout');
    writeUpdateCheck(root);
    writePointer(home, 'claude', 'pair-review', root);
    const logFile = join(home, 'tel.log');
    writeTelemetryStub(home, logFile);
    const env = scopedEnv(home);

    const rRoot = spawnSync(PREAMBLE_SRC, ['pair-review', '--root'], { env, encoding: 'utf8' });
    expect(rRoot.status).toBe(0);
    expect(rRoot.stdout).not.toContain('GE_TELEMETRY:');

    const rDef = spawnSync(PREAMBLE_SRC, ['pair-review'], { env, encoding: 'utf8' });
    expect(rDef.status).toBe(0);
    expect(rDef.stdout).toContain('GE_TELEMETRY: session=extend-test-stub');

    const rRes = spawnSync(PREAMBLE_SRC, ['pair-review', '--resume'], { env, encoding: 'utf8' });
    expect(rRes.status).toBe(0);
    expect(rRes.stdout).toBe('GE_TELEMETRY: session=extend-test-stub start=123\n');

    const calls = readFileSync(logFile, 'utf8').trim().split('\n');
    expect(calls).toEqual([
      'start --skill extend:pair-review',
      'start --skill extend:pair-review',
    ]);
  });

  test('non-zero update-check exit prints stderr diagnostic while keeping stdout and exit 0', () => {
    const home = mkdtempSync(join(baseTmp, 'uc-nonzero-'));
    const root = join(home, 'checkout');
    writeUpdateCheckWithOutput(root, { stdout: 'UPGRADE_AVAILABLE 0.1.0 0.2.0', exitCode: 7 });
    writePointer(home, 'claude', 'roadmap', root);

    const r = spawnSync(PREAMBLE_SRC, ['roadmap'], { env: scopedEnv(home), encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`EXTEND_ROOT: ${root}`);
    expect(r.stdout).toContain('UPGRADE_AVAILABLE 0.1.0 0.2.0');
    expect(r.stderr).toContain(`preamble: update-check exited 7; run ${root}/bin/update-check directly to see why`);
  });

  test('exit-status branches for missing (127), non-exec (126), corrupt exit 2, and signal exit', () => {
    // 127: missing file for every skill's line
    const emptyHome = mkdtempSync(join(baseTmp, 'missing-'));
    for (const skill of ROOT_RESOLVER_SKILLS) {
      const r = runShell('bash', ['-c'], expectedPreambleLine(skill), scopedEnv(emptyHome));
      expect(r.status).toBe(127);
      expect(r.stdout).toBe('');
    }

    // 126: non-executable file
    const nonExecHome = mkdtempSync(join(baseTmp, 'nonexec-'));
    const p = installPreamble(nonExecHome);
    chmodSync(p, 0o644);
    const r126 = runShell('bash', ['-c'], expectedPreambleLine('roadmap'), scopedEnv(nonExecHome));
    expect(r126.status).toBe(126);
    expect(r126.stdout).toBe('');

    // 2 without PREAMBLE_USAGE prefix (corrupt copy) -> maps to PREAMBLE_FAILED, not PREAMBLE_ARGS
    const corruptHome = mkdtempSync(join(baseTmp, 'corrupt-'));
    const cp = installPreamble(corruptHome);
    writeFileSync(cp, '#!/usr/bin/env bash\necho "syntax broken" >&2\nexit 2\n');
    chmodSync(cp, 0o755);
    const rCorrupt = runShell('bash', ['-c'], expectedPreambleLine('roadmap'), scopedEnv(corruptHome));
    expect(rCorrupt.status).toBe(2);
    expect(rCorrupt.stderr.startsWith('preamble: PREAMBLE_USAGE:')).toBe(false);

    // Signal exit (>128) -> maps to PREAMBLE_FAILED
    const sigHome = mkdtempSync(join(baseTmp, 'signal-'));
    const sp = installPreamble(sigHome);
    writeFileSync(sp, '#!/usr/bin/env bash\nkill -TERM $$\n');
    chmodSync(sp, 0o755);
    const rSig = runShell('bash', ['-c'], expectedPreambleLine('roadmap'), scopedEnv(sigHome));
    expect(rSig.status !== 0 && rSig.status !== 126 && rSig.status !== 127 && rSig.status !== 2).toBe(true);
  });

  test('pasted _EXTEND_ROOT= line is valid in bash (and zsh when installed) for special-char root', () => {
    const home = mkdtempSync(join(baseTmp, 'paste-'));
    const root = join(home, "dir with spaces & it's quote");
    writeUpdateCheck(root);
    writePointer(home, 'claude', 'implement', root);

    const r = spawnSync(PREAMBLE_SRC, ['implement', '--root'], { env: scopedEnv(home), encoding: 'utf8' });
    expect(r.status).toBe(0);
    const assignLine = r.stdout.split('\n').find((l) => l.startsWith('_EXTEND_ROOT='))!;
    expect(assignLine).toBeTruthy();

    const bashCheck = runShell('bash', ['-c'], `${assignLine}\nprintf '%s' "$_EXTEND_ROOT"`, scopedEnv(home));
    expect(bashCheck.status).toBe(0);
    expect(bashCheck.stdout).toBe(root);

    if (hasZsh()) {
      const zshCheck = runShell('zsh', ['-fc'], `${assignLine}\nprintf '%s' "$_EXTEND_ROOT"`, scopedEnv(home));
      expect(zshCheck.status).toBe(0);
      expect(zshCheck.stdout).toBe(root);
    }
  });
});
