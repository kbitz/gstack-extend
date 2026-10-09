/**
 * Native multi-host setup: --host claude|codex|opencode|cursor|auto.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';

import { makeBaseTmp } from './helpers/fixture-repo.ts';
import { EXPECTED_SETUP_SKILLS as SKILLS } from './helpers/expected-setup-skills.ts';
import { extractCanonicalSpan, GUARD_LINE, ROOT_RESOLVER_SKILLS } from './helpers/extend-root.ts';
import { assertSkillDescriptionWithinLimit } from './helpers/skill-description.ts';

const ROOT = join(import.meta.dir, '..');
const SETUP = join(ROOT, 'setup');

const baseTmp = makeBaseTmp('setup-hosts-');
afterAll(() => {
  try { rmSync(baseTmp, { recursive: true, force: true }); } catch {}
});

function runSetup(
  args: string[],
  home: string,
  extraPath?: string,
  replacePath = false,
): { stdout: string; stderr: string; exitCode: number | null } {
  const path = extraPath
    ? (replacePath ? extraPath : `${extraPath}:${process.env.PATH ?? '/usr/bin:/bin'}`)
    : (process.env.PATH ?? '/usr/bin:/bin');
  const env: Record<string, string> = { PATH: path, HOME: home };
  if (process.env.TMPDIR !== undefined) env.TMPDIR = process.env.TMPDIR;
  const r = spawnSync(SETUP, args, { encoding: 'utf8', env });
  const stderr = typeof r.stderr === 'string' ? r.stderr : '';
  // Isolated PATHs run setup under /bin/bash, which is 3.2 on macOS; set -u errors there must fail every test.
  expect(stderr).not.toContain('unbound variable');
  return {
    stdout: typeof r.stdout === 'string' ? r.stdout : '',
    stderr,
    exitCode: r.status,
  };
}

function plantFakeBins(dir: string, names: string[]): void {
  mkdirSync(dir, { recursive: true });
  for (const name of names) {
    const p = join(dir, name);
    writeFileSync(p, '#!/bin/sh\nexit 0\n');
    chmodSync(p, 0o755);
  }
}

// Keep the developer's installed agents out of detection tests.
function isolatedPath(names: string[] = []): string {
  const bins = join(baseTmp, `isolated-bins-${names.join('-') || 'none'}`);
  plantFakeBins(bins, names);
  if (!existsSync(join(bins, 'bun'))) symlinkSync(process.execPath, join(bins, 'bun'));
  return `${bins}:/bin:/usr/bin`;
}

function hostDir(home: string, host: 'claude' | 'codex' | 'opencode' | 'cursor'): string {
  if (host === 'claude') return join(home, '.claude', 'skills');
  if (host === 'codex') return join(home, '.codex', 'skills');
  if (host === 'cursor') return join(home, '.cursor', 'skills');
  return join(home, '.config', 'opencode', 'skills');
}

describe('setup --host flags', () => {
  for (const host of ['claude', 'codex', 'opencode', 'cursor'] as const) {
    test(`${host} retirement preserves a plain file at the skill path`, () => {
      const home = join(baseTmp, `retired-plain-file-${host}`);
      const root = hostDir(home, host);
      mkdirSync(root, { recursive: true });
      for (const skill of ['review-apparatus', 'test-plan']) {
        writeFileSync(join(root, skill), 'PERSONAL FILE\n');
      }
      for (const uninstall of [false, true]) {
        const result = runSetup(['--host', host, ...(uninstall ? ['--uninstall'] : [])], home);
        expect(result.exitCode).toBe(0);
        for (const skill of ['review-apparatus', 'test-plan']) {
          expect(result.stdout).toContain(`Skipped ${skill} (target exists but is not a directory)`);
          expect(readFileSync(join(root, skill), 'utf8')).toBe('PERSONAL FILE\n');
        }
      }
    });

    for (const uninstall of [false, true]) {
      test(`${host} ${uninstall ? 'uninstall' : 'upgrade'} removes owned retired skills and preserves notes`, () => {
        const home = join(baseTmp, `retired-${host}-${uninstall}`);
        const root = hostDir(home, host);
        for (const skill of ['review-apparatus', 'test-plan']) {
          const dir = join(root, skill);
          mkdirSync(dir, { recursive: true });
          if (host === 'claude') {
            // Source files have already disappeared in the upgraded checkout.
            symlinkSync(join(realpathSync(ROOT), 'skills', `${skill}.md`), join(dir, 'SKILL.md'));
          } else {
            writeFileSync(join(dir, 'SKILL.md'), `old ${skill}\n`);
          }
          writeFileSync(join(dir, '.extend-root'), `${realpathSync(ROOT)}\n`);
        }
        writeFileSync(join(root, 'review-apparatus', 'notes.md'), 'KEEP\n');
        const args = ['--host', host, '--quiet', ...(uninstall ? ['--uninstall'] : [])];
        expect(runSetup(args, home).exitCode).toBe(0);
        expect(readdirSync(join(root, 'review-apparatus'))).toEqual(['notes.md']);
        expect(readFileSync(join(root, 'review-apparatus', 'notes.md'), 'utf8')).toBe('KEEP\n');
        expect(existsSync(join(root, 'test-plan'))).toBe(false);
        // Repeat to catch cleanup that requires the deleted source or pointer.
        expect(runSetup(args, home).exitCode).toBe(0);
        expect(existsSync(join(root, 'test-plan'))).toBe(false);
      });
    }

    for (const kind of ['regular', 'file-link', 'directory-link', 'foreign-pointer'] as const) {
      test(`${host} retirement preserves personal skills (${kind})`, () => {
        const home = join(baseTmp, `retired-personal-${host}-${kind}`);
        const root = hostDir(home, host);
        for (const skill of ['review-apparatus', 'test-plan']) {
          const dir = join(root, skill);
          const personal = join(home, 'dotfiles', skill);
          mkdirSync(personal, { recursive: true });
          writeFileSync(join(personal, 'SKILL.md'), 'PERSONAL\n');
          mkdirSync(root, { recursive: true });
          if (kind === 'directory-link') {
            symlinkSync(personal, dir);
          } else {
            mkdirSync(dir);
            if (kind === 'file-link') symlinkSync(join(personal, 'SKILL.md'), join(dir, 'SKILL.md'));
            else writeFileSync(join(dir, 'SKILL.md'), 'PERSONAL\n');
            if (kind === 'foreign-pointer') writeFileSync(join(dir, '.extend-root'), '/another/checkout\n');
          }
        }
        expect(runSetup(['--host', host, '--quiet'], home).exitCode).toBe(0);
        expect(runSetup(['--host', host, '--uninstall', '--quiet'], home).exitCode).toBe(0);
        for (const skill of ['review-apparatus', 'test-plan']) {
          const dir = join(root, skill);
          expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe('PERSONAL\n');
          expect(readFileSync(join(home, 'dotfiles', skill, 'SKILL.md'), 'utf8')).toBe('PERSONAL\n');
          if (kind === 'directory-link') expect(lstatSync(dir).isSymbolicLink()).toBe(true);
          if (kind === 'file-link') expect(lstatSync(join(dir, 'SKILL.md')).isSymbolicLink()).toBe(true);
          if (kind === 'foreign-pointer') {
            expect(readFileSync(join(dir, '.extend-root'), 'utf8')).toBe('/another/checkout\n');
          } else {
            expect(existsSync(join(dir, '.extend-root'))).toBe(false);
          }
        }
      });
    }
  }

  test('rejects unknown --host', () => {
    const home = join(baseTmp, 'bad-host');
    mkdirSync(home, { recursive: true });
    const r = runSetup(['--host', 'factory'], home);
    expect(r.exitCode).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('Unknown --host');
  });

  test('rejects --host with missing value', () => {
    const home = join(baseTmp, 'missing-host');
    mkdirSync(home, { recursive: true });
    const r = runSetup(['--host'], home);
    expect(r.exitCode).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('--host requires');
  });

  test('--host claude installs only Claude skill dirs', () => {
    const home = join(baseTmp, 'claude-only');
    mkdirSync(home, { recursive: true });
    const r = runSetup(['--host', 'claude'], home);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`Installed ${SKILLS.length} skills`);
    for (const skill of SKILLS) {
      const skillMd = join(hostDir(home, 'claude'), skill, 'SKILL.md');
      expect(lstatSync(skillMd).isSymbolicLink()).toBe(true);
      // The telemetry blocks fall back to this pointer when the wrapper is not on PATH (e.g. a non-canonical clone).
      expect(readFileSync(join(hostDir(home, 'claude'), skill, '.extend-root'), 'utf8').trim()).toBe(ROOT);
    }
    expect(existsSync(join(hostDir(home, 'codex'), 'pair-review'))).toBe(false);
    expect(existsSync(join(hostDir(home, 'opencode'), 'pair-review'))).toBe(false);
  });

  test('--host codex writes SKILL.md per skill, not package root', () => {
    const home = join(baseTmp, 'codex-only');
    mkdirSync(home, { recursive: true });
    const r = runSetup(['--host', 'codex', '--quiet'], home);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).not.toContain('Installed');
    const root = hostDir(home, 'codex');
    for (const skill of SKILLS) {
      const skillMd = join(root, skill, 'SKILL.md');
      expect(existsSync(skillMd)).toBe(true);
      expect(lstatSync(skillMd).isSymbolicLink()).toBe(false);
      expect(existsSync(join(root, skill, '.extend-root'))).toBe(true);
      expect(readFileSync(join(root, skill, '.extend-root'), 'utf8').trim()).toBe(ROOT);
    }
    expect(existsSync(join(root, 'gstack-extend', 'SKILL.md'))).toBe(false);
    const listed = readdirSync(root);
    expect(listed).not.toContain('SKILL.md');
    if (existsSync(join(root, 'gstack-extend'))) {
      expect(lstatSync(join(root, 'gstack-extend')).isSymbolicLink()).toBe(false);
    }
  });

  test('--host opencode installs each skill with SKILL.md', () => {
    const home = join(baseTmp, 'opencode-only');
    mkdirSync(home, { recursive: true });
    const r = runSetup(['--host', 'opencode'], home);
    expect(r.exitCode).toBe(0);
    const root = hostDir(home, 'opencode');
    for (const skill of SKILLS) {
      expect(existsSync(join(root, skill, 'SKILL.md'))).toBe(true);
    }
    expect(existsSync(join(root, 'gstack-extend', 'SKILL.md'))).toBe(false);
  });

  test('codex copies strip allowed-tools and keep descriptions within the host cap', () => {
    const home = join(baseTmp, 'codex-rewrite');
    mkdirSync(home, { recursive: true });
    runSetup(['--host', 'codex'], home);
    const skillMd = join(hostDir(home, 'codex'), 'pair-review', 'SKILL.md');
    const body = readFileSync(skillMd, 'utf8');
    expect(body).not.toMatch(/^allowed-tools:/m);
    const description = assertSkillDescriptionWithinLimit(body, skillMd);
    expect(description.length).toBeLessThanOrEqual(1024);
  });

  for (const host of ['codex', 'opencode', 'cursor'] as const) {
    test(`${host} copies preserve authored shell paths under a HOME with spaces and metacharacters`, () => {
      const fixture = join(baseTmp, `rewrite-fixture-${host}`);
      const home = join(baseTmp, `home ${host} with spaces $(touch INJECTED) \`touch BACKTICK\``);
      mkdirSync(join(fixture, 'skills'), { recursive: true });
      mkdirSync(join(fixture, 'bin', 'lib'), { recursive: true });
      mkdirSync(home, { recursive: true });
      copyFileSync(SETUP, join(fixture, 'setup'));
      copyFileSync(join(ROOT, 'bin/lib/install-safety.sh'), join(fixture, 'bin/lib/install-safety.sh'));
      for (const skill of SKILLS) {
        writeFileSync(join(fixture, 'skills', `${skill}.md`),
          `---\nname: ${skill}\ndescription: Fixture\n---\n\`\`\`bash\nprintf '%s\\n' ~/.claude/skills/pair-review/SKILL.md\n\`\`\`\n`);
      }
      const result = spawnSync('bash', [join(fixture, 'setup'), '--host', host, '--quiet'], {
        encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home },
      });
      expect(result.status).toBe(0);
      const body = readFileSync(join(hostDir(home, host), 'pair-review', 'SKILL.md'), 'utf8');
      expect(body).toContain('~/.claude/skills/pair-review/SKILL.md');
      expect(body).not.toContain(home);
      const shell = body.split('```bash\n')[1]!.split('```')[0]!;
      const executed = spawnSync('bash', ['-c', shell], {
        cwd: home, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home },
      });
      expect(executed.status).toBe(0);
      expect(executed.stdout).toBe(`${hostDir(home, 'claude')}/pair-review/SKILL.md\n`);
      expect(executed.stderr).toBe('');
      expect(existsSync(join(home, 'INJECTED'))).toBe(false);
      expect(existsSync(join(home, 'BACKTICK'))).toBe(false);
    });

    test(`${host} replaces a generated copy without writing through a hardlink to its source`, () => {
      const fixture = join(baseTmp, `hardlink-fixture-${host}`);
      const home = join(baseTmp, `hardlink-home-${host}`);
      mkdirSync(join(fixture, 'skills'), { recursive: true });
      mkdirSync(join(fixture, 'bin', 'lib'), { recursive: true });
      copyFileSync(SETUP, join(fixture, 'setup'));
      copyFileSync(join(ROOT, 'bin/lib/install-safety.sh'), join(fixture, 'bin/lib/install-safety.sh'));
      const source = (skill: string) => `---\nname: ${skill}\ndescription: Fixture\nallowed-tools:\n  - Bash\n---\nBODY\n`;
      for (const skill of SKILLS) writeFileSync(join(fixture, 'skills', `${skill}.md`), source(skill));
      const dir = join(hostDir(home, host), 'pair-review');
      mkdirSync(dir, { recursive: true });
      linkSync(join(fixture, 'skills', 'pair-review.md'), join(dir, 'SKILL.md'));
      writeFileSync(join(dir, '.extend-root'), `${realpathSync(fixture)}\n`);
      const result = spawnSync('bash', [join(fixture, 'setup'), '--host', host, '--quiet'], {
        encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home },
      });
      expect(result.status).toBe(0);
      expect(readFileSync(join(fixture, 'skills', 'pair-review.md'), 'utf8')).toBe(source('pair-review'));
      expect(statSync(join(dir, 'SKILL.md')).ino).not.toBe(statSync(join(fixture, 'skills', 'pair-review.md')).ino);
      const installed = readFileSync(join(dir, 'SKILL.md'), 'utf8');
      expect(installed).toBe(host === 'opencode'
        ? source('pair-review')
        : '---\nname: pair-review\ndescription: Fixture\n---\nBODY\n');
      expect(readdirSync(dir).sort()).toEqual(['.extend-root', 'SKILL.md']);
    });
  }

  // Generated copies keep source paths verbatim, so a Claude-only sibling path would ship to every host.
  test('skill sources never hardcode a ~/.claude/skills/ path', () => {
    for (const skill of SKILLS) {
      expect(readFileSync(join(ROOT, 'skills', `${skill}.md`), 'utf8')).not.toContain('~/.claude/skills/');
    }
  });

  for (const host of ['codex', 'opencode'] as const) {
    test.skipIf(process.getuid?.() === 0)(`${host} keeps the previous copy and leaves no temp file when a rewrite fails`, () => {
      const fixture = join(baseTmp, `rewrite-fail-fixture-${host}`);
      const home = join(baseTmp, `rewrite-fail-home-${host}`);
      mkdirSync(join(fixture, 'skills'), { recursive: true });
      mkdirSync(join(fixture, 'bin', 'lib'), { recursive: true });
      copyFileSync(SETUP, join(fixture, 'setup'));
      copyFileSync(join(ROOT, 'bin/lib/install-safety.sh'), join(fixture, 'bin/lib/install-safety.sh'));
      for (const skill of SKILLS) writeFileSync(join(fixture, 'skills', `${skill}.md`), `---\nname: ${skill}\ndescription: F\n---\nNEW\n`);
      const dir = join(hostDir(home, host), 'pair-review');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), 'OLD\n');
      writeFileSync(join(dir, '.extend-root'), `${realpathSync(fixture)}\n`);
      const src = join(fixture, 'skills', 'pair-review.md');
      chmodSync(src, 0o000);
      try {
        const r = spawnSync('bash', [join(fixture, 'setup'), '--host', host, '--quiet'], {
          encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home },
        });
        expect(r.status).not.toBe(0);
      } finally {
        chmodSync(src, 0o644);
      }
      expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe('OLD\n');
      expect(readdirSync(dir).sort()).toEqual(['.extend-root', 'SKILL.md']);
    });
  }

  for (const host of ['codex', 'opencode', 'cursor'] as const) {
    test(`${host} copies get the umask default mode, not mktemp's 0600`, () => {
      const home = join(baseTmp, `copy-mode-${host}`);
      mkdirSync(home, { recursive: true });
      const r = spawnSync('bash', ['-c', 'umask 022; exec "$0" "$@"', SETUP, '--host', host, '--quiet'], {
        encoding: 'utf8', env: { PATH: isolatedPath(), HOME: home },
      });
      expect(r.status).toBe(0);
      for (const skill of SKILLS) {
        expect(statSync(join(hostDir(home, host), skill, 'SKILL.md')).mode & 0o777).toBe(0o644);
      }
    });
  }

  for (const host of ['claude', 'codex'] as const) {
    test(`${host} skips a SKILL.md that is a directory without claiming it`, () => {
      const home = join(baseTmp, `skill-md-dir-${host}`);
      const dir = join(hostDir(home, host), 'roadmap', 'SKILL.md');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'notes.txt'), 'KEEP\n');
      const r = runSetup(['--host', host, '--quiet'], home);
      expect(r.exitCode).toBe(0);
      expect(r.stderr).toContain(`${dir} is not a regular file, not overwriting`);
      expect(readdirSync(dir)).toEqual(['notes.txt']);
      expect(existsSync(join(hostDir(home, host), 'roadmap', '.extend-root'))).toBe(false);
      expect(existsSync(join(hostDir(home, host), 'pair-review', 'SKILL.md'))).toBe(true);
    });
  }

  test('--host auto with no binaries defaults to claude', () => {
    const home = join(baseTmp, 'auto-none');
    mkdirSync(home, { recursive: true });
    const r = runSetup(['--host', 'auto'], home, isolatedPath(), true);
    expect(r.exitCode).toBe(0);
    expect(existsSync(join(hostDir(home, 'claude'), 'pair-review', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(hostDir(home, 'codex'), 'pair-review'))).toBe(false);
    expect(existsSync(join(home, '.cursor'))).toBe(false);
  });

  for (const detection of ['directory', 'binary', 'existing-skill'] as const) {
    test(`--host auto --quiet detects Cursor via ${detection}`, () => {
      const home = join(baseTmp, `auto-cursor-${detection}`);
      mkdirSync(home, { recursive: true });
      if (detection === 'directory') mkdirSync(join(home, '.cursor'));
      if (detection === 'existing-skill') {
        const dir = join(hostDir(home, 'cursor'), 'pair-review');
        mkdirSync(dir, { recursive: true });
        symlinkSync(join(ROOT, 'skills/pair-review.md'), join(dir, 'SKILL.md'));
      }
      const path = isolatedPath(detection === 'binary' ? ['cursor'] : []);
      const r = runSetup(['--host', 'auto', '--quiet'], home, path, true);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toBe('');
      for (const skill of SKILLS) {
        const dir = join(hostDir(home, 'cursor'), skill);
        expect(lstatSync(join(dir, 'SKILL.md')).isFile()).toBe(true);
        expect(readFileSync(join(dir, '.extend-root'), 'utf8').trim()).toBe(realpathSync(ROOT));
      }
      expect(existsSync(join(home, '.claude'))).toBe(false);
      expect(existsSync(join(home, '.codex'))).toBe(false);
      expect(existsSync(join(home, '.config', 'opencode'))).toBe(false);
    });
  }

  test('--host cursor preserves skill bodies and strips allowed-tools from all skills', () => {
    const home = join(baseTmp, 'cursor-explicit');
    mkdirSync(home, { recursive: true });
    expect(runSetup(['--host', 'cursor', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    for (const skill of SKILLS) {
      const dir = join(hostDir(home, 'cursor'), skill);
      const skillMd = join(dir, 'SKILL.md');
      const source = readFileSync(join(ROOT, 'skills', `${skill}.md`), 'utf8');
      const body = readFileSync(skillMd, 'utf8');
      expect(lstatSync(skillMd).isFile()).toBe(true);
      expect(readFileSync(join(dir, '.extend-root'), 'utf8').trim()).toBe(realpathSync(ROOT));
      expect(body).toMatch(new RegExp(`^---\nname: ${skill}\ndescription: \\|\n`));
      const frontmatter = body.slice(0, body.indexOf('\n---', 4));
      expect(frontmatter).not.toContain('allowed-tools:');
      expect(frontmatter).not.toMatch(/^  - /m);
      expect(body.slice(body.indexOf('\n---', 4))).toBe(source.slice(source.indexOf('\n---', 4)));
    }
    expect(existsSync(join(home, '.claude'))).toBe(false);
    expect(existsSync(join(hostDir(home, 'cursor'), 'gstack-extend', 'SKILL.md'))).toBe(false);
  });

  test('auto setup and uninstall preserve a user-owned Cursor skill without claiming it', () => {
    const home = join(baseTmp, 'cursor-user-owned');
    const dir = join(hostDir(home, 'cursor'), 'pair-review');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), 'PERSONAL SKILL\n');
    const path = isolatedPath();
    const installed = runSetup(['--host', 'auto', '--quiet'], home, path, true);
    expect(installed.exitCode).toBe(0);
    expect(installed.stderr).toContain('is a regular file, not overwriting');
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe('PERSONAL SKILL\n');
    expect(existsSync(join(dir, '.extend-root'))).toBe(false);
    expect(existsSync(join(hostDir(home, 'cursor'), 'roadmap', '.extend-root'))).toBe(true);
    expect(runSetup(['--host', 'auto', '--uninstall', '--quiet'], home, path, true).exitCode).toBe(0);
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe('PERSONAL SKILL\n');
    expect(existsSync(join(dir, '.extend-root'))).toBe(false);
    for (const skill of SKILLS.filter((name) => name !== 'pair-review')) {
      expect(existsSync(join(hostDir(home, 'cursor'), skill, 'SKILL.md'))).toBe(false);
      expect(existsSync(join(hostDir(home, 'cursor'), skill, '.extend-root'))).toBe(false);
    }
  });

  test('Cursor uninstall leaves other hosts, foreign pointers and unrelated files intact', () => {
    const home = join(baseTmp, 'cursor-uninstall');
    mkdirSync(home, { recursive: true });
    expect(runSetup(['--host', 'claude'], home).exitCode).toBe(0);
    expect(runSetup(['--host=cursor'], home).exitCode).toBe(0);
    const root = hostDir(home, 'cursor');
    writeFileSync(join(root, 'pair-review', 'notes.md'), 'KEEP\n');
    const foreign = join(root, 'roadmap');
    writeFileSync(join(foreign, '.extend-root'), '/another/checkout\n');
    const before = readFileSync(join(foreign, 'SKILL.md'), 'utf8');
    expect(runSetup(['--host', 'cursor', '--uninstall'], home).exitCode).toBe(0);
    expect(readFileSync(join(root, 'pair-review', 'notes.md'), 'utf8')).toBe('KEEP\n');
    expect(readFileSync(join(foreign, '.extend-root'), 'utf8')).toBe('/another/checkout\n');
    expect(readFileSync(join(foreign, 'SKILL.md'), 'utf8')).toBe(before);
    for (const skill of SKILLS) {
      expect(existsSync(join(hostDir(home, 'claude'), skill, 'SKILL.md'))).toBe(true);
      if (skill === 'roadmap') continue;
      expect(existsSync(join(root, skill, 'SKILL.md'))).toBe(false);
      expect(existsSync(join(root, skill, '.extend-root'))).toBe(false);
    }
  });

  for (const host of ['claude', 'cursor'] as const) {
    test(`a personal ${host} SKILL.md symlink is left alone and never claimed`, () => {
      const home = join(baseTmp, `personal-file-link-${host}`);
      const dotfile = join(home, 'dotfiles', 'roadmap.md');
      mkdirSync(join(home, 'dotfiles'), { recursive: true });
      writeFileSync(dotfile, 'MY ROADMAP SKILL\n');
      const dir = join(hostDir(home, host), 'roadmap');
      mkdirSync(dir, { recursive: true });
      symlinkSync(dotfile, join(dir, 'SKILL.md'));
      const r = runSetup(['--host', host, '--quiet'], home);
      expect(r.exitCode).toBe(0);
      expect(r.stderr).toContain('links outside a gstack-extend checkout, not overwriting');
      expect(readlinkSync(join(dir, 'SKILL.md'))).toBe(dotfile);
      expect(readFileSync(dotfile, 'utf8')).toBe('MY ROADMAP SKILL\n');
      expect(existsSync(join(dir, '.extend-root'))).toBe(false);
      expect(existsSync(join(hostDir(home, host), 'pair-review', 'SKILL.md'))).toBe(true);
    });
  }

  test('personal links shaped like skills/<name>.md stay user-owned', () => {
    const home = join(baseTmp, 'personal-skills-shaped');
    const dotSkills = join(home, 'dotfiles', 'skills');
    mkdirSync(dotSkills, { recursive: true });
    const links = {
      roadmap: join(dotSkills, 'roadmap.md'),
      implement: '../../../dotfiles/skills/implement.md',
      'review-and-prep': join(home, 'unmounted-volume', 'dotfiles', 'skills', 'review-and-prep.md'),
    };
    writeFileSync(join(dotSkills, 'roadmap.md'), 'MINE\n');
    writeFileSync(join(dotSkills, 'implement.md'), 'MINE\n');
    for (const [skill, target] of Object.entries(links)) {
      const dir = join(hostDir(home, 'claude'), skill);
      mkdirSync(dir, { recursive: true });
      symlinkSync(target, join(dir, 'SKILL.md'));
    }
    const r = runSetup(['--host', 'claude', '--quiet'], home);
    expect(r.exitCode).toBe(0);
    for (const [skill, target] of Object.entries(links)) {
      const why = skill === 'review-and-prep' ? 'links to a missing file' : 'links outside a gstack-extend checkout';
      expect(r.stderr).toContain(`${skill}/SKILL.md ${why}`);
      expect(readlinkSync(join(hostDir(home, 'claude'), skill, 'SKILL.md'))).toBe(target);
      expect(existsSync(join(hostDir(home, 'claude'), skill, '.extend-root'))).toBe(false);
    }
  });

  test('links into another or a deleted gstack-extend checkout are still repointed', () => {
    const home = join(baseTmp, 'checkout-links');
    const other = join(home, 'other-checkout');
    mkdirSync(join(other, 'skills'), { recursive: true });
    mkdirSync(join(other, 'bin'), { recursive: true });
    writeFileSync(join(other, 'setup'), '');
    writeFileSync(join(other, 'bin', 'update-check'), '');
    writeFileSync(join(other, 'skills', 'roadmap.md'), 'old\n');
    const roadmap = join(hostDir(home, 'claude'), 'roadmap');
    const pairReview = join(hostDir(home, 'claude'), 'pair-review');
    mkdirSync(roadmap, { recursive: true });
    mkdirSync(pairReview, { recursive: true });
    symlinkSync(join(other, 'skills', 'roadmap.md'), join(roadmap, 'SKILL.md'));
    // A deleted checkout is claimed only through the pointer setup wrote beside its link.
    symlinkSync(join(home, 'gone-checkout', 'skills', 'pair-review.md'), join(pairReview, 'SKILL.md'));
    writeFileSync(join(pairReview, '.extend-root'), `${join(home, 'gone-checkout')}\n`);
    expect(runSetup(['--host', 'claude', '--quiet'], home).exitCode).toBe(0);
    expect(readlinkSync(join(roadmap, 'SKILL.md'))).toBe(join(realpathSync(ROOT), 'skills', 'roadmap.md'));
    expect(readlinkSync(join(pairReview, 'SKILL.md'))).toBe(join(realpathSync(ROOT), 'skills', 'pair-review.md'));
  });

  test('a skills-shaped link stays user-owned unless the checkout has both setup and bin/update-check', () => {
    const home = join(baseTmp, 'half-checkout');
    const cases = [
      { skill: 'roadmap', rootName: 'setup-only', setup: true, updateCheck: false },
      { skill: 'implement', rootName: 'update-check-only', setup: false, updateCheck: true },
    ] as const;
    for (const c of cases) {
      const root = join(home, c.rootName);
      mkdirSync(join(root, 'skills'), { recursive: true });
      writeFileSync(join(root, 'skills', `${c.skill}.md`), 'NOT OURS\n');
      if (c.setup) writeFileSync(join(root, 'setup'), '');
      if (c.updateCheck) {
        mkdirSync(join(root, 'bin'), { recursive: true });
        writeFileSync(join(root, 'bin', 'update-check'), '');
      }
      const dir = join(hostDir(home, 'claude'), c.skill);
      mkdirSync(dir, { recursive: true });
      symlinkSync(join(root, 'skills', `${c.skill}.md`), join(dir, 'SKILL.md'));
    }
    const r = runSetup(['--host', 'claude', '--quiet'], home);
    expect(r.exitCode).toBe(0);
    for (const c of cases) {
      const link = join(hostDir(home, 'claude'), c.skill, 'SKILL.md');
      expect(r.stderr).toContain(`${c.skill}/SKILL.md links outside a gstack-extend checkout`);
      expect(readlinkSync(link)).toBe(join(home, c.rootName, 'skills', `${c.skill}.md`));
      expect(readFileSync(join(home, c.rootName, 'skills', `${c.skill}.md`), 'utf8')).toBe('NOT OURS\n');
      expect(existsSync(join(hostDir(home, 'claude'), c.skill, '.extend-root'))).toBe(false);
    }
    expect(existsSync(join(hostDir(home, 'claude'), 'pair-review', 'SKILL.md'))).toBe(true);
  });

  test('a deleted checkout is not repointed when its pointer names a different path', () => {
    const home = join(baseTmp, 'deleted-mismatch');
    const gone = join(home, 'gone-checkout');
    const dir = join(hostDir(home, 'claude'), 'roadmap');
    mkdirSync(dir, { recursive: true });
    const link = join(dir, 'SKILL.md');
    symlinkSync(join(gone, 'skills', 'roadmap.md'), link);
    const pointer = `${join(home, 'somewhere-else')}\n`;
    writeFileSync(join(dir, '.extend-root'), pointer);
    const r = runSetup(['--host', 'claude', '--quiet'], home);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain('roadmap/SKILL.md links to a missing file');
    expect(readlinkSync(link)).toBe(join(gone, 'skills', 'roadmap.md'));
    expect(readFileSync(join(dir, '.extend-root'), 'utf8')).toBe(pointer);
    expect(existsSync(join(hostDir(home, 'claude'), 'pair-review', 'SKILL.md'))).toBe(true);
  });

  test('a relative link into another gstack-extend checkout is repointed', () => {
    const home = join(baseTmp, 'relative-checkout');
    const other = join(home, 'other-checkout');
    mkdirSync(join(other, 'skills'), { recursive: true });
    mkdirSync(join(other, 'bin'), { recursive: true });
    writeFileSync(join(other, 'setup'), '');
    writeFileSync(join(other, 'bin', 'update-check'), '');
    writeFileSync(join(other, 'skills', 'roadmap.md'), 'old\n');
    const dir = join(hostDir(home, 'claude'), 'roadmap');
    mkdirSync(dir, { recursive: true });
    symlinkSync('../../../other-checkout/skills/roadmap.md', join(dir, 'SKILL.md'));
    expect(runSetup(['--host', 'claude', '--quiet'], home).exitCode).toBe(0);
    expect(readlinkSync(join(dir, 'SKILL.md'))).toBe(join(realpathSync(ROOT), 'skills', 'roadmap.md'));
    expect(readFileSync(join(other, 'skills', 'roadmap.md'), 'utf8')).toBe('old\n');
  });

  test('a relative link into a deleted checkout is repointed when the pointer names that checkout', () => {
    mkdirSync(join(baseTmp, 'relative-deleted'), { recursive: true });
    const home = realpathSync(join(baseTmp, 'relative-deleted'));
    const other = join(home, 'other-checkout');
    mkdirSync(join(other, 'skills'), { recursive: true });
    mkdirSync(join(other, 'bin'), { recursive: true });
    writeFileSync(join(other, 'setup'), '');
    writeFileSync(join(other, 'bin', 'update-check'), '');
    writeFileSync(join(other, 'skills', 'roadmap.md'), 'old\n');
    const dir = join(hostDir(home, 'claude'), 'roadmap');
    mkdirSync(dir, { recursive: true });
    symlinkSync('../../../other-checkout/skills/roadmap.md', join(dir, 'SKILL.md'));
    writeFileSync(join(dir, '.extend-root'), `${other}\n`);
    rmSync(other, { recursive: true, force: true });
    expect(runSetup(['--host', 'claude', '--quiet'], home).exitCode).toBe(0);
    expect(readlinkSync(join(dir, 'SKILL.md'))).toBe(join(realpathSync(ROOT), 'skills', 'roadmap.md'));
  });

  test('uninstall removes a relative link that points at this checkout', () => {
    mkdirSync(join(baseTmp, 'relative-uninstall'), { recursive: true });
    const home = realpathSync(join(baseTmp, 'relative-uninstall'));
    const dir = join(hostDir(home, 'claude'), 'roadmap');
    mkdirSync(dir, { recursive: true });
    const rel = relative(realpathSync(dir), join(realpathSync(ROOT), 'skills', 'roadmap.md'));
    symlinkSync(rel, join(dir, 'SKILL.md'));
    writeFileSync(join(dir, '.extend-root'), `${realpathSync(ROOT)}\n`);
    const r = runSetup(['--host', 'claude', '--uninstall', '--quiet'], home);
    expect(r.exitCode).toBe(0);
    expect(existsSync(join(dir, 'SKILL.md'))).toBe(false);
    expect(existsSync(join(dir, '.extend-root'))).toBe(false);
  });

  for (const host of ['codex', 'opencode', 'cursor'] as const) {
    test(`${host} skips a skills dir shared with Claude, on explicit/auto install and uninstall`, () => {
      const home = join(baseTmp, `${host}-alias`);
      mkdirSync(join(hostDir(home, host), '..'), { recursive: true });
      const path = isolatedPath(['claude']);
      expect(runSetup(['--host', 'claude', '--quiet'], home, path, true).exitCode).toBe(0);
      symlinkSync(hostDir(home, 'claude'), hostDir(home, host));
      const custom = join(hostDir(home, 'claude'), 'implement', 'SKILL.md');
      rmSync(custom);
      writeFileSync(custom, 'CUSTOMIZED BY USER\n');
      const explicit = runSetup(['--host', host, '--quiet'], home, path, true);
      expect(explicit.exitCode).toBe(0);
      expect(explicit.stdout).toBe(`SETUP_SKIPPED_HOSTS ${host}\n`);
      const auto = runSetup(['--host', 'auto', '--quiet'], home, path, true);
      expect(auto.exitCode).toBe(0);
      expect(auto.stderr).toContain(`skipping ${host}`);
      // Cursor yields to Claude and reads the install this run refreshed; copy hosts are left stale.
      expect(auto.stdout).toBe(host === 'cursor' ? '' : `SETUP_SKIPPED_HOSTS ${host}\n`);
      if (host === 'cursor') expect(auto.stderr).not.toContain('Shared-directory migration');
      expect(readFileSync(custom, 'utf8')).toBe('CUSTOMIZED BY USER\n');
      expect(lstatSync(join(hostDir(home, 'claude'), 'pair-review', 'SKILL.md')).isSymbolicLink()).toBe(true);
      const removed = runSetup(['--host', host, '--uninstall', '--quiet'], home, path, true);
      expect(removed.exitCode).toBe(0);
      expect(removed.stderr).toContain(`skipping ${host}`);
      expect(removed.stdout).toBe(`SETUP_SKIPPED_HOSTS ${host}\n`);
      expect(readFileSync(custom, 'utf8')).toBe('CUSTOMIZED BY USER\n');
      for (const skill of SKILLS.filter((name) => name !== 'implement')) {
        expect(lstatSync(join(hostDir(home, 'claude'), skill, 'SKILL.md')).isSymbolicLink()).toBe(true);
      }
    });

    test(`${host} skips a parent alias before its shared skills directory exists`, () => {
      const home = join(baseTmp, `${host}-parent-alias`);
      const claude = join(home, '.claude');
      mkdirSync(claude, { recursive: true });
      const hostParent = join(hostDir(home, host), '..');
      mkdirSync(join(hostParent, '..'), { recursive: true });
      symlinkSync(claude, hostParent);
      const r = runSetup(['--host', host, '--quiet'], home, isolatedPath(), true);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toBe(`SETUP_SKIPPED_HOSTS ${host}\n`);
      expect(readdirSync(claude)).toEqual([]);
    });
  }

  test('shared legacy copies and customized Claude files stay untouched until manual migration', () => {
    const home = join(baseTmp, 'shared-legacy');
    const root = hostDir(home, 'claude');
    for (const skill of SKILLS) {
      const dir = join(root, skill);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), `LEGACY OR CUSTOMIZED ${skill}\n`);
      writeFileSync(join(dir, '.extend-root'), `${ROOT}\n`);
    }
    for (const host of ['codex', 'opencode', 'cursor'] as const) {
      mkdirSync(join(hostDir(home, host), '..'), { recursive: true });
      symlinkSync(root, hostDir(home, host));
    }
    const path = isolatedPath(['claude', 'codex', 'opencode', 'cursor']);
    const r = runSetup(['--host', 'auto', '--quiet'], home, path, true);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('SETUP_SKIPPED_HOSTS codex,opencode\n');
    expect(r.stderr).toContain('skipping cursor');
    expect(r.stderr).toContain('Shared-directory migration');
    for (const skill of SKILLS) {
      expect(readFileSync(join(root, skill, 'SKILL.md'), 'utf8')).toBe(`LEGACY OR CUSTOMIZED ${skill}\n`);
      expect(readFileSync(join(root, skill, '.extend-root'), 'utf8')).toBe(`${ROOT}\n`);
    }
  });

  // Value: protects=Documented migration replaces a backed-up legacy copy with Claude's source link; fails_when=setup leaves SKILL.md absent or changes the backup; why_new=legacy preservation and orphan-pointer uninstall are tested separately; seam=none
  test('Claude setup recreates a source link after a legacy copy is moved aside', () => {
    const home = join(baseTmp, 'shared-legacy-migration');
    const skillDir = join(hostDir(home, 'claude'), 'pair-review');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), 'LEGACY GENERATED COPY\n');
    writeFileSync(join(skillDir, '.extend-root'), `${realpathSync(ROOT)}\n`);
    renameSync(join(skillDir, 'SKILL.md'), join(skillDir, 'SKILL.md.backup'));

    const result = runSetup(['--host', 'claude', '--quiet'], home);

    expect(result.exitCode).toBe(0);
    expect(lstatSync(join(skillDir, 'SKILL.md')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(skillDir, 'SKILL.md'))).toBe(join(realpathSync(ROOT), 'skills', 'pair-review.md'));
    expect(readFileSync(join(skillDir, 'SKILL.md.backup'), 'utf8')).toBe('LEGACY GENERATED COPY\n');
  });

  test('Codex and OpenCode sharing a directory both skip, even without Claude detection', () => {
    const home = join(baseTmp, 'copy-hosts-alias');
    const root = hostDir(home, 'opencode');
    mkdirSync(root, { recursive: true });
    mkdirSync(join(home, '.codex'));
    writeFileSync(join(root, 'personal.md'), 'KEEP\n');
    symlinkSync(root, hostDir(home, 'codex'));
    const path = isolatedPath(['codex', 'opencode']);
    const r = runSetup(['--host', 'auto', '--quiet'], home, path, true);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe('SETUP_SKIPPED_HOSTS codex,opencode\n');
    expect(readdirSync(root)).toEqual(['personal.md']);
    expect(existsSync(join(home, '.claude'))).toBe(false);
  });

  for (const owner of ['codex', 'opencode'] as const) {
    test(`Cursor pointed at the ${owner} dir leaves ${owner} as its owner`, () => {
      const home = join(baseTmp, `cursor-into-${owner}`);
      mkdirSync(hostDir(home, owner), { recursive: true });
      mkdirSync(join(home, '.cursor'));
      symlinkSync(hostDir(home, owner), hostDir(home, 'cursor'));
      const r = runSetup(['--host', 'auto', '--quiet'], home, isolatedPath([owner, 'cursor']), true);
      expect(r.exitCode).toBe(0);
      expect(r.stderr).toContain(`is the ${owner} skills directory; skipping cursor`);
      expect(r.stdout).toBe('');
      for (const skill of SKILLS) {
        const path = join(hostDir(home, owner), skill, 'SKILL.md');
        expect(lstatSync(path).isFile()).toBe(true);
      }
    });
  }

  test('--host auto --uninstall falls back to Claude when the only detected host is an aliased Cursor', () => {
    const home = join(baseTmp, 'cursor-only-alias-uninstall');
    const skill = join(hostDir(home, 'claude'), 'implement');
    mkdirSync(skill, { recursive: true });
    mkdirSync(join(home, '.cursor'));
    symlinkSync(join(realpathSync(ROOT), 'skills', 'implement.md'), join(skill, 'SKILL.md'));
    writeFileSync(join(skill, '.extend-root'), `${realpathSync(ROOT)}\n`);
    symlinkSync(hostDir(home, 'claude'), hostDir(home, 'cursor'));
    const r = runSetup(['--host', 'auto', '--uninstall', '--quiet'], home, isolatedPath(), true);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain('skipping cursor');
    expect(r.stdout).toBe('');
    expect(existsSync(skill)).toBe(false);
  });

  for (const host of ['codex', 'opencode', 'cursor'] as const) {
    test(`a skipped --host ${host} install leaves the CLI links and registry alone`, () => {
      const home = join(baseTmp, `skipped-${host}-no-global`);
      const bin = join(home, '.local', 'bin');
      mkdirSync(hostDir(home, 'claude'), { recursive: true });
      mkdirSync(join(hostDir(home, host), '..'), { recursive: true });
      mkdirSync(bin, { recursive: true });
      symlinkSync(hostDir(home, 'claude'), hostDir(home, host));
      const foreign = join(home, 'other-checkout', 'bin', 'gstack-extend');
      symlinkSync(foreign, join(bin, 'gstack-extend'));
      const r = runSetup(['--host', host], home);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain(`Nothing installed: skipped ${host}.`);
      expect(r.stdout.endsWith(`SETUP_SKIPPED_HOSTS ${host}\n`)).toBe(true);
      expect(readlinkSync(join(bin, 'gstack-extend'))).toBe(foreign);
      expect(existsSync(join(bin, 'gstack-extend-telemetry'))).toBe(false);
      // The skip is recorded. Registry registration still does not run.
      expect(existsSync(join(home, '.gstack-extend', 'projects.json'))).toBe(false);
      expect(existsSync(join(home, '.gstack-extend', 'install-status'))).toBe(true);
      expect(readdirSync(hostDir(home, 'claude'))).toEqual([]);
    });
  }

  for (const owner of ['codex', 'opencode'] as const) {
    test(`a Cursor yielding to an unprocessed ${owner} dir is reported`, () => {
      const home = join(baseTmp, `cursor-unserved-${owner}`);
      mkdirSync(hostDir(home, owner), { recursive: true });
      mkdirSync(join(home, '.cursor'));
      symlinkSync(hostDir(home, owner), hostDir(home, 'cursor'));
      const explicit = runSetup(['--host', 'cursor', '--quiet'], home, isolatedPath(), true);
      expect(explicit.exitCode).toBe(0);
      expect(explicit.stdout).toBe('SETUP_SKIPPED_HOSTS cursor\n');
      expect(readdirSync(hostDir(home, owner))).toEqual([]);
      // The owner turns unsafe after Cursor yielded to it, so neither host is refreshed.
      chmodSync(hostDir(home, owner), 0o777);
      const auto = runSetup(['--host', 'auto', '--quiet'], home, isolatedPath(['claude', owner, 'cursor']), true);
      expect(auto.exitCode).toBe(0);
      expect(auto.stdout).toBe(`SETUP_SKIPPED_HOSTS ${owner},cursor\n`);
      expect(readdirSync(hostDir(home, owner))).toEqual([]);
      expect(lstatSync(join(hostDir(home, 'claude'), 'pair-review', 'SKILL.md')).isSymbolicLink()).toBe(true);
    });
  }

  for (const host of ['codex', 'opencode', 'cursor'] as const) {
    test(`${host} skips its not-yet-created dir when Claude's skills dir is a dangling link into it`, () => {
      const home = join(baseTmp, `${host}-dangling-claude`);
      mkdirSync(join(home, '.claude'), { recursive: true });
      mkdirSync(join(hostDir(home, host), '..'), { recursive: true });
      symlinkSync(hostDir(home, host), hostDir(home, 'claude'));
      const r = runSetup(['--host', host, '--quiet'], home, isolatedPath(), true);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toBe(`SETUP_SKIPPED_HOSTS ${host}\n`);
      expect(existsSync(hostDir(home, host))).toBe(false);
    });
  }

  // The share check is host-agnostic; exercise the link spellings once, through Codex.
  for (const [name, target] of [
    ['relative', '../.codex/skills'],
    ['dot-component', '/HOME/.codex/skills/.'],
    ['case-variant', '/HOME/.codex/Skills'],
  ] as const) {
    test(`codex skips when Claude's skills dir is a ${name} dangling link into its dir`, () => {
      const home = join(baseTmp, `codex-dangling-${name}`);
      mkdirSync(join(home, '.claude'), { recursive: true });
      mkdirSync(join(home, '.codex'), { recursive: true });
      symlinkSync(target.replace('/HOME', home), hostDir(home, 'claude'));
      const r = runSetup(['--host', 'codex', '--quiet'], home, isolatedPath(), true);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toBe('SETUP_SKIPPED_HOSTS codex\n');
      expect(readdirSync(join(home, '.codex'))).toEqual([]);
    });
  }

  test('a self-referencing host skills link ends setup instead of hanging', () => {
    const home = join(baseTmp, 'codex-link-loop');
    mkdirSync(join(home, '.codex'), { recursive: true });
    symlinkSync('skills', hostDir(home, 'codex'));
    const env: Record<string, string> = { PATH: isolatedPath(), HOME: home };
    const r = spawnSync(SETUP, ['--host', 'codex', '--quiet'], { encoding: 'utf8', env, timeout: 20000 });
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Error: cannot resolve');
    expect(r.stderr).not.toContain('unbound variable');
  });

  test('an interrupted copy leaves no temp file behind', () => {
    const home = join(baseTmp, 'interrupted-copy');
    const bins = join(baseTmp, 'interrupting-awk-bins');
    mkdirSync(home, { recursive: true });
    plantFakeBins(bins, []);
    if (!existsSync(join(bins, 'bun'))) symlinkSync(process.execPath, join(bins, 'bun'));
    // awk runs only for a Codex copy, after the temp file exists; it signals setup mid-write.
    writeFileSync(join(bins, 'awk'), '#!/bin/sh\nkill -TERM "$PPID"\nexit 1\n');
    chmodSync(join(bins, 'awk'), 0o755);
    const r = spawnSync(SETUP, ['--host', 'codex', '--quiet'], {
      encoding: 'utf8', env: { PATH: `${bins}:/bin:/usr/bin`, HOME: home }, timeout: 20000,
    });
    expect(r.status).not.toBe(0);
    const dirs = existsSync(hostDir(home, 'codex')) ? readdirSync(hostDir(home, 'codex')) : [];
    expect(dirs.length).toBeGreaterThan(0);
    for (const dir of dirs) {
      expect(readdirSync(join(hostDir(home, 'codex'), dir)).filter((name) => name.startsWith('.SKILL.md.'))).toEqual([]);
    }
  });

  test('an uninstall whose every host is skipped removes nothing and keeps the CLI links', () => {
    const home = join(baseTmp, 'uninstall-all-skipped');
    const bin = join(home, '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    expect(runSetup(['--host', 'opencode', '--quiet'], home).exitCode).toBe(0);
    mkdirSync(join(home, '.codex'));
    symlinkSync(hostDir(home, 'opencode'), hostDir(home, 'codex'));
    const r = runSetup(['--host', 'auto', '--uninstall'], home, isolatedPath(['codex', 'opencode']), true);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Nothing uninstalled: skipped codex,opencode.');
    expect(r.stdout).not.toContain('Uninstall complete.');
    expect(r.stdout.endsWith('SETUP_SKIPPED_HOSTS codex,opencode\n')).toBe(true);
    for (const skill of SKILLS) {
      expect(lstatSync(join(hostDir(home, 'opencode'), skill, 'SKILL.md')).isFile()).toBe(true);
    }
    for (const name of ['gstack-extend', 'gstack-extend-telemetry']) {
      expect(readlinkSync(join(bin, name))).toBe(join(ROOT, 'bin', name));
    }
  });

  test('a Claude install without pointers keeps the CLI links on a Codex uninstall', () => {
    const home = join(baseTmp, 'pointerless-claude-links');
    const bin = join(home, '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    expect(runSetup(['--host', 'claude', '--quiet'], home).exitCode).toBe(0);
    for (const skill of SKILLS) rmSync(join(hostDir(home, 'claude'), skill, '.extend-root'));
    const r = runSetup(['--host', 'codex', '--uninstall'], home);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`  Kept for: ${hostDir(home, 'claude')}/`);
    for (const name of ['gstack-extend', 'gstack-extend-telemetry']) {
      expect(readlinkSync(join(bin, name))).toBe(join(ROOT, 'bin', name));
    }
  });

  test('a pointerless Claude link into another checkout does not keep the CLI links', () => {
    const home = join(baseTmp, 'pointerless-foreign-links');
    const bin = join(home, '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    expect(runSetup(['--host', 'codex', '--quiet'], home).exitCode).toBe(0);
    const skill = join(hostDir(home, 'claude'), 'roadmap');
    mkdirSync(skill, { recursive: true });
    symlinkSync(join(home, 'other-checkout', 'skills', 'roadmap.md'), join(skill, 'SKILL.md'));
    const r = runSetup(['--host', 'codex', '--uninstall'], home);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).not.toContain('Kept for:');
    for (const name of ['gstack-extend', 'gstack-extend-telemetry']) {
      expect(existsSync(join(bin, name))).toBe(false);
    }
  });

  test('uninstall skips a skill whose .extend-root is a directory and finishes the rest', () => {
    const home = join(baseTmp, 'extend-root-dir-uninstall');
    const bin = join(home, '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    expect(runSetup(['--host', 'claude', '--quiet'], home).exitCode).toBe(0);
    const pointer = join(hostDir(home, 'claude'), 'roadmap', '.extend-root');
    rmSync(pointer);
    mkdirSync(pointer);
    const r = runSetup(['--host', 'claude', '--uninstall'], home);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Skipped roadmap (.extend-root is not a regular file)');
    expect(readdirSync(hostDir(home, 'claude'))).toEqual(['roadmap']);
    expect(lstatSync(join(hostDir(home, 'claude'), 'roadmap', 'SKILL.md')).isSymbolicLink()).toBe(true);
  });

  test('codex skips a skill whose .extend-root is a directory', () => {
    const home = join(baseTmp, 'extend-root-dir');
    const pointer = join(hostDir(home, 'codex'), 'roadmap', '.extend-root');
    mkdirSync(pointer, { recursive: true });
    const r = runSetup(['--host', 'codex', '--quiet'], home);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain(`${pointer} is not a regular file, not overwriting`);
    expect(readdirSync(join(hostDir(home, 'codex'), 'roadmap'))).toEqual(['.extend-root']);
    expect(existsSync(join(hostDir(home, 'codex'), 'pair-review', 'SKILL.md'))).toBe(true);
  });

  test('a pointer left without a SKILL.md does not keep the CLI links', () => {
    const home = join(baseTmp, 'orphan-pointer-links');
    const bin = join(home, '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    expect(runSetup(['--host', 'claude', '--quiet'], home).exitCode).toBe(0);
    const skill = join(hostDir(home, 'claude'), 'implement');
    rmSync(join(skill, 'SKILL.md'));
    writeFileSync(join(skill, 'SKILL.md.backup'), 'MOVED ASIDE\n');
    expect(runSetup(['--host', 'claude', '--uninstall', '--quiet'], home).exitCode).toBe(0);
    for (const name of ['gstack-extend', 'gstack-extend-telemetry']) {
      expect(existsSync(join(bin, name))).toBe(false);
    }
    expect(readFileSync(join(skill, 'SKILL.md.backup'), 'utf8')).toBe('MOVED ASIDE\n');
  });

  test('--host auto skips a detected host with an unsafe skills dir; --host stops', () => {
    const home = join(baseTmp, 'cursor-outside-home');
    const outside = join(baseTmp, 'cursor-data-outside-home');
    mkdirSync(home, { recursive: true });
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(home, '.cursor'));
    const path = isolatedPath(['claude']);
    const auto = runSetup(['--host', 'auto', '--quiet'], home, path, true);
    expect(auto.exitCode).toBe(0);
    expect(auto.stderr).toContain('Warning: skipping cursor:');
    expect(auto.stdout).toBe('SETUP_SKIPPED_HOSTS cursor\n');
    expect(auto.stderr).toContain('outside resolved $HOME');
    expect(lstatSync(join(hostDir(home, 'claude'), 'pair-review', 'SKILL.md')).isSymbolicLink()).toBe(true);
    expect(readdirSync(outside)).toEqual([]);
    const explicit = runSetup(['--host', 'cursor', '--quiet'], home, path, true);
    expect(explicit.exitCode).toBe(1);
    expect(readdirSync(outside)).toEqual([]);
  });

  test('--host auto falls back to Claude when Cursor is the only detected host and is skipped', () => {
    for (const layout of ['alias', 'unsafe'] as const) {
      const home = join(baseTmp, `cursor-only-${layout}`);
      mkdirSync(join(home, '.claude', 'skills'), { recursive: true });
      if (layout === 'alias') {
        mkdirSync(join(home, '.cursor'), { recursive: true });
        symlinkSync(hostDir(home, 'claude'), hostDir(home, 'cursor'));
      } else {
        const outside = join(baseTmp, 'cursor-only-outside');
        mkdirSync(outside, { recursive: true });
        symlinkSync(outside, join(home, '.cursor'));
      }
      const r = runSetup(['--host', 'auto', '--quiet'], home, isolatedPath(), true);
      expect([layout, r.exitCode]).toEqual([layout, 0]);
      expect(r.stderr).toContain(layout === 'alias' ? 'skipping cursor' : 'Warning: skipping cursor:');
      // An aliased Cursor reads the Claude install this run refreshed; an unsafe one is left stale.
      expect(r.stdout).toBe(layout === 'alias' ? '' : 'SETUP_SKIPPED_HOSTS cursor\n');
      for (const skill of SKILLS) {
        expect(lstatSync(join(hostDir(home, 'claude'), skill, 'SKILL.md')).isSymbolicLink()).toBe(true);
      }
    }
  });

  // Only meaningful on a case-insensitive disk (the macOS default).
  mkdirSync(join(baseTmp, 'case-probe'), { recursive: true });
  const caseInsensitive = existsSync(join(baseTmp, 'CASE-PROBE'));
  test.skipIf(!caseInsensitive)('a case-variant Cursor alias is still the Claude skills dir', () => {
    const home = join(baseTmp, 'cursor-alias-case');
    mkdirSync(join(home, '.claude', 'skills'), { recursive: true });
    mkdirSync(join(home, '.cursor'), { recursive: true });
    symlinkSync(join(home, '.CLAUDE', 'skills'), hostDir(home, 'cursor'));
    const path = isolatedPath(['claude']);
    expect(runSetup(['--host', 'claude', '--quiet'], home, path, true).exitCode).toBe(0);
    const r = runSetup(['--host', 'cursor', '--uninstall', '--quiet'], home, path, true);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain('skipping cursor');
    for (const skill of SKILLS) {
      expect(lstatSync(join(hostDir(home, 'claude'), skill, 'SKILL.md')).isSymbolicLink()).toBe(true);
    }
  });

  test('--host auto fails when a skipped non-Cursor host was the only one detected', () => {
    const home = join(baseTmp, 'codex-only-unsafe');
    const outside = join(baseTmp, 'codex-data-outside-home');
    mkdirSync(home, { recursive: true });
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(home, '.codex'));
    const r = runSetup(['--host', 'auto', '--quiet'], home, isolatedPath(['codex']), true);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Warning: skipping codex:');
    expect(r.stdout).toBe('SETUP_SKIPPED_HOSTS codex\n');
    expect(r.stderr).toContain('no detected host has a usable skills directory (unsafe, or shared with another host)');
    expect(existsSync(join(home, '.claude'))).toBe(false);
    expect(readdirSync(outside)).toEqual([]);
  });

  test('--host auto fails when every detected host is unsafe', () => {
    const home = join(baseTmp, 'auto-all-unsafe');
    const outside = join(baseTmp, 'claude-data-outside-home');
    mkdirSync(home, { recursive: true });
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(home, '.claude'));
    const r = runSetup(['--host', 'auto', '--quiet'], home, isolatedPath(['claude']), true);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('no detected host has a usable skills directory (unsafe, or shared with another host)');
    expect(readdirSync(outside)).toEqual([]);
  });

  test('--host auto detects all four binaries', () => {
    const home = join(baseTmp, 'auto-all');
    const bins = join(baseTmp, 'all-bins');
    mkdirSync(home, { recursive: true });
    plantFakeBins(bins, ['claude', 'codex', 'opencode', 'cursor']);
    const r = runSetup(['--host', 'auto'], home, bins);
    expect(r.exitCode).toBe(0);
    expect(existsSync(join(hostDir(home, 'claude'), 'pair-review', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(hostDir(home, 'codex'), 'pair-review', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(hostDir(home, 'opencode'), 'pair-review', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(hostDir(home, 'cursor'), 'pair-review', 'SKILL.md'))).toBe(true);
  });

  test('--uninstall --host codex does not touch Claude', () => {
    const home = join(baseTmp, 'uninstall-codex');
    mkdirSync(home, { recursive: true });
    runSetup(['--host', 'claude'], home);
    runSetup(['--host', 'codex'], home);
    const r = runSetup(['--host', 'codex', '--uninstall'], home);
    expect(r.exitCode).toBe(0);
    for (const skill of SKILLS) {
      expect(existsSync(join(hostDir(home, 'codex'), skill, 'SKILL.md'))).toBe(false);
      expect(existsSync(join(hostDir(home, 'claude'), skill, 'SKILL.md'))).toBe(true);
    }
  });

  for (const host of ['claude', 'codex', 'opencode', 'cursor'] as const) {
    test(`the last ${host} uninstall removes both owned CLI links and preserves a foreign link`, () => {
      const home = join(baseTmp, `last-uninstall-${host}`);
      const bin = join(home, '.local', 'bin');
      mkdirSync(bin, { recursive: true });
      expect(runSetup(['--host', host, '--quiet'], home).exitCode).toBe(0);
      for (const name of ['gstack-extend', 'gstack-extend-telemetry']) {
        expect(readlinkSync(join(bin, name))).toBe(join(ROOT, 'bin', name));
      }
      const removed = runSetup(['--host', host, '--uninstall'], home);
      expect(removed.exitCode).toBe(0);
      for (const name of ['gstack-extend', 'gstack-extend-telemetry']) {
        expect(existsSync(join(bin, name))).toBe(false);
        expect(removed.stdout).toContain(`Removed ${name === 'gstack-extend' ? 'gstack-extend CLI' : name} symlink`);
      }
      // A missing foreign target must still keep its link intact.
      const foreign = join(home, 'other-checkout', 'bin', 'gstack-extend');
      symlinkSync(foreign, join(bin, 'gstack-extend'));
      expect(runSetup(['--host', host, '--uninstall', '--quiet'], home).exitCode).toBe(0);
      expect(readlinkSync(join(bin, 'gstack-extend'))).toBe(foreign);
    });
  }

  // The pointer scan covers all four host dirs; plant the surviving pointer instead of running a second install.
  for (const remaining of ['claude', 'codex', 'opencode', 'cursor'] as const) {
    test(`uninstall keeps CLI links while a ${remaining} pointer still names this checkout`, () => {
      const home = join(baseTmp, `remaining-uninstall-${remaining}`);
      const host = remaining === 'claude' ? 'codex' : 'claude';
      const bin = join(home, '.local', 'bin');
      mkdirSync(bin, { recursive: true });
      expect(runSetup(['--host', host, '--quiet'], home).exitCode).toBe(0);
      const kept = join(hostDir(home, remaining), 'retired-skill');
      mkdirSync(kept, { recursive: true });
      writeFileSync(join(kept, 'SKILL.md'), 'CUSTOMIZED\n');
      writeFileSync(join(kept, '.extend-root'), `${realpathSync(ROOT)}\n`);
      const removed = runSetup(['--host', host, '--uninstall'], home);
      expect(removed.exitCode).toBe(0);
      expect(removed.stdout).toContain('this checkout still has a host install');
      expect(removed.stdout).toContain(`  Kept for: ${join(kept, '.extend-root')}\n`);
      for (const name of ['gstack-extend', 'gstack-extend-telemetry']) {
        expect(readlinkSync(join(bin, name))).toBe(join(ROOT, 'bin', name));
      }
      rmSync(kept, { recursive: true });
      expect(runSetup(['--host', host, '--uninstall', '--quiet'], home).exitCode).toBe(0);
      for (const name of ['gstack-extend', 'gstack-extend-telemetry']) {
        expect(existsSync(join(bin, name))).toBe(false);
      }
    });
  }

  test('a preserved customized Claude file keeps CLI links; foreign pointers do not', () => {
    const home = join(baseTmp, 'custom-uninstall-links');
    const bin = join(home, '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    expect(runSetup(['--host', 'claude', '--quiet'], home).exitCode).toBe(0);
    const skill = join(hostDir(home, 'claude'), 'implement');
    rmSync(join(skill, 'SKILL.md'));
    writeFileSync(join(skill, 'SKILL.md'), 'CUSTOMIZED\n');
    expect(runSetup(['--host', 'claude', '--uninstall', '--quiet'], home).exitCode).toBe(0);
    expect(readlinkSync(join(bin, 'gstack-extend'))).toBe(join(ROOT, 'bin', 'gstack-extend'));
    writeFileSync(join(skill, '.extend-root'), '/another/checkout\n');
    expect(runSetup(['--host', 'claude', '--uninstall', '--quiet'], home).exitCode).toBe(0);
    expect(readFileSync(join(skill, 'SKILL.md'), 'utf8')).toBe('CUSTOMIZED\n');
    expect(existsSync(join(bin, 'gstack-extend'))).toBe(false);
    expect(existsSync(join(bin, 'gstack-extend-telemetry'))).toBe(false);
  });

  test('generated host copies carry the extend-root resolver', () => {
    for (const host of ['codex', 'opencode', 'cursor'] as const) {
      const home = join(baseTmp, `resolver-copy-${host}`);
      mkdirSync(home, { recursive: true });
      const r = runSetup(['--host', host], home);
      expect(r.exitCode).toBe(0);
      for (const skill of ROOT_RESOLVER_SKILLS) {
        const source = readFileSync(join(ROOT, 'skills', `${skill}.md`), 'utf8');
        const copy = readFileSync(join(hostDir(home, host), skill, 'SKILL.md'), 'utf8');
        expect(copy).toContain(`_ER_SKILL=${skill}`);
        expect(extractCanonicalSpan(copy)).toBe(extractCanonicalSpan(source));
        expect(copy.split(GUARD_LINE).length - 1).toBe(source.split(GUARD_LINE).length - 1);
      }
    }
  });

  test('codex rewrite unlinks leftover SKILL.md symlink before write', () => {
    const home = join(baseTmp, 'codex-unlink');
    mkdirSync(home, { recursive: true });
    const destDir = join(hostDir(home, 'codex'), 'pair-review');
    mkdirSync(destDir, { recursive: true });
    const source = join(ROOT, 'skills', 'pair-review.md');
    const before = readFileSync(source, 'utf8');
    symlinkSync(source, join(destDir, 'SKILL.md'));
    expect(runSetup(['--host', 'codex'], home).exitCode).toBe(0);
    expect(readFileSync(source, 'utf8')).toBe(before);
    expect(lstatSync(join(destDir, 'SKILL.md')).isSymbolicLink()).toBe(false);
  });

  test('a Claude install leaves the pointer beside each symlink and uninstall removes it', () => {
    const home = join(baseTmp, 'claude-pointer-uninstall');
    mkdirSync(home, { recursive: true });
    expect(runSetup(['--host', 'claude', '--quiet'], home).exitCode).toBe(0);
    for (const skill of SKILLS) expect(existsSync(join(hostDir(home, 'claude'), skill, '.extend-root'))).toBe(true);
    expect(runSetup(['--host', 'claude', '--uninstall', '--quiet'], home).exitCode).toBe(0);
    for (const skill of SKILLS) {
      expect(existsSync(join(hostDir(home, 'claude'), skill, 'SKILL.md'))).toBe(false);
      expect(existsSync(join(hostDir(home, 'claude'), skill, '.extend-root'))).toBe(false);
    }
  });

  test('a detached, customized Claude SKILL.md stays protected even though a pointer sits beside it', () => {
    const home = join(baseTmp, 'claude-customized');
    mkdirSync(home, { recursive: true });
    expect(runSetup(['--host', 'claude', '--quiet'], home).exitCode).toBe(0);
    const skillMd = join(hostDir(home, 'claude'), 'implement', 'SKILL.md');
    rmSync(skillMd);
    writeFileSync(skillMd, 'CUSTOMIZED BY USER\n');
    const again = runSetup(['--host', 'claude', '--quiet'], home);
    expect(again.exitCode).toBe(0);
    expect(again.stderr).toContain('is a regular file, not overwriting');
    expect(lstatSync(skillMd).isSymbolicLink()).toBe(false);
    expect(readFileSync(skillMd, 'utf8')).toBe('CUSTOMIZED BY USER\n');
    expect(runSetup(['--host', 'claude', '--uninstall', '--quiet'], home).exitCode).toBe(0);
    expect(readFileSync(skillMd, 'utf8')).toBe('CUSTOMIZED BY USER\n');
  });

  for (const host of ['codex', 'opencode', 'cursor'] as const) {
    test(`a stale ${host} generated copy is refreshed on reinstall and removed on uninstall`, () => {
      const home = join(baseTmp, `generated-copy-${host}`);
      mkdirSync(home, { recursive: true });
      expect(runSetup(['--host', host, '--quiet'], home).exitCode).toBe(0);
      const skillMd = join(hostDir(home, host), 'implement', 'SKILL.md');
      writeFileSync(skillMd, 'STALE GENERATED COPY\n');
      const again = runSetup(['--host', host, '--quiet'], home);
      expect(again.exitCode).toBe(0);
      expect(again.stderr).not.toContain('not overwriting');
      expect(readFileSync(skillMd, 'utf8')).not.toContain('STALE GENERATED COPY');
      expect(runSetup(['--host', host, '--uninstall', '--quiet'], home).exitCode).toBe(0);
      expect(existsSync(skillMd)).toBe(false);
      expect(existsSync(join(hostDir(home, host), 'implement', '.extend-root'))).toBe(false);
    });
  }

  test('--skills-dir uninstall (no host) never removes a regular-file SKILL.md, even beside a matching pointer', () => {
    const home = join(baseTmp, 'skills-dir-uninstall');
    const dir = join(home, 'legacy-skills');
    const skillDir = join(dir, 'roadmap');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), 'CUSTOMIZED BY USER\n');
    writeFileSync(join(skillDir, '.extend-root'), ROOT + '\n');
    const r = runSetup(['--skills-dir', dir, '--uninstall', '--quiet'], home);
    expect(r.exitCode).toBe(0);
    expect(readFileSync(join(skillDir, 'SKILL.md'), 'utf8')).toBe('CUSTOMIZED BY USER\n');
    expect(existsSync(join(skillDir, '.extend-root'))).toBe(true);
  });

  test('setup never writes through a symlinked .extend-root', () => {
    const home = join(baseTmp, 'pointer-symlink');
    const dir = join(hostDir(home, 'claude'), 'roadmap');
    const victim = join(home, 'victim.txt');
    mkdirSync(dir, { recursive: true });
    writeFileSync(victim, 'ORIGINAL\n');
    symlinkSync(victim, join(dir, '.extend-root'));
    expect(runSetup(['--host', 'claude', '--quiet'], home).exitCode).toBe(0);
    expect(readFileSync(victim, 'utf8')).toBe('ORIGINAL\n');
    expect(readFileSync(join(dir, '.extend-root'), 'utf8').trim()).toBe(ROOT);
  });

  test('idempotent second install', () => {
    const home = join(baseTmp, 'idempotent');
    mkdirSync(home, { recursive: true });
    expect(runSetup(['--host', 'codex'], home).exitCode).toBe(0);
    expect(runSetup(['--host', 'codex'], home).exitCode).toBe(0);
    expect(realpathSync(join(hostDir(home, 'codex'), 'pair-review', '.extend-root'))).toBeTruthy();
  });

  for (const host of ['claude', 'codex', 'opencode', 'cursor', 'auto'] as const) {
    test(`--host ${host} preserves a personal skill symlink and installs nothing`, () => {
      const home = join(baseTmp, `personal-collision-${host}`);
      const bins = join(baseTmp, `personal-collision-${host}-bins`);
      plantFakeBins(bins, ['claude', 'codex', 'opencode', 'cursor']);
      // Last host and last registered skill: catches writes before all preflights finish.
      const collisionHost = host === 'auto' ? 'cursor' : host;
      const collisionSkill = SKILLS[SKILLS.length - 1]!;
      const personal = join(home, 'dotfiles', 'skills', collisionSkill);
      const root = hostDir(home, collisionHost);
      const target = join(root, collisionSkill);
      mkdirSync(personal, { recursive: true });
      mkdirSync(root, { recursive: true });
      writeFileSync(join(personal, 'SKILL.md'), 'personal skill, keep me\n');
      symlinkSync(personal, target);

      const r = runSetup(['--host', host, '--quiet'], home, bins);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain(`${target} is a symlink`);
      expect(readlinkSync(target)).toBe(personal);
      expect(readFileSync(join(personal, 'SKILL.md'), 'utf8')).toBe('personal skill, keep me\n');
      expect(readdirSync(personal)).toEqual(['SKILL.md']);
      for (const checkedHost of ['claude', 'codex', 'opencode', 'cursor'] as const) {
        const checkedRoot = hostDir(home, checkedHost);
        const entries = existsSync(checkedRoot) ? readdirSync(checkedRoot) : [];
        expect(entries).toEqual(checkedHost === collisionHost ? [collisionSkill] : []);
      }
      expect(existsSync(join(home, '.gstack-extend', 'projects.json'))).toBe(false);
    });
  }
});

const VERSION_TEXT = readFileSync(join(ROOT, 'VERSION'), 'utf8').trim();
const REMOTE_VERSION = join(baseTmp, 'track23c-remote-version');
writeFileSync(REMOTE_VERSION, `${VERSION_TEXT}\n`);

function statusPath(home: string): string {
  return join(home, '.gstack-extend', 'install-status');
}

function checkFacts(home: string, state = join(home, '.gstack-extend')): { stdout: string; exitCode: number | null } {
  const r = spawnSync(join(ROOT, 'bin', 'update-check'), [], {
    encoding: 'utf8',
    env: {
      PATH: '/bin:/usr/bin',
      HOME: home,
      GSTACK_EXTEND_DIR: realpathSync(ROOT),
      GSTACK_EXTEND_STATE_DIR: state,
      GSTACK_EXTEND_REMOTE_URL: `file://${REMOTE_VERSION}`,
    },
    // A FIFO or lock regression must fail the test, not hang the suite.
    timeout: 10000,
  });
  expect(r.error).toBeUndefined();
  return { stdout: r.stdout ?? '', exitCode: r.status };
}

function plantRegularSkill(home: string, skill: string, body: string, origin = realpathSync(ROOT)): string {
  const dir = join(hostDir(home, 'claude'), skill);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), body);
  writeFileSync(join(dir, '.extend-root'), `${origin}\n`);
  return dir;
}

function recoveryBody(id: string): string {
  const docs = readFileSync(join(ROOT, 'docs/installation.md'), 'utf8');
  const start = `<!-- recovery-example:${id} -->`;
  const end = `<!-- /recovery-example:${id} -->`;
  const at = docs.indexOf(start);
  const to = docs.indexOf(end);
  expect(at).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(at);
  const fence = docs.slice(at + start.length, to).match(/```bash\n([\s\S]*?)```/);
  expect(fence).not.toBeNull();
  return fence![1]!;
}

function runRecovery(
  id: string,
  home: string,
  extra: Record<string, string> = {},
  pathPrefix?: string,
): { stdout: string; stderr: string; exitCode: number | null } {
  const r = spawnSync('/bin/bash', ['-c', recoveryBody(id)], {
    encoding: 'utf8',
    env: {
      PATH: pathPrefix ? `${pathPrefix}:/bin:/usr/bin` : (process.env.PATH ?? '/usr/bin:/bin'),
      HOME: home,
      GSTACK_EXTEND_RECOVERY_CHECKOUT: realpathSync(ROOT),
      ...extra,
    },
    timeout: 60000,
  });
  expect(r.error).toBeUndefined();
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', exitCode: r.status };
}

function waitUntil(pred: () => boolean, ms: number): boolean {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (pred()) return true;
    spawnSync('/bin/sleep', ['0.05']);
  }
  return pred();
}

function sha256(file: string): string {
  const r = spawnSync('shasum', ['-a', '256', file], { encoding: 'utf8' });
  return (r.stdout ?? '').split(' ')[0] ?? '';
}

// The device:inode pair exactly as setup's BSD stat records it.
function statId(path: string): string {
  const r = spawnSync('/usr/bin/stat', ['-f', '%d:%i', realpathSync(path)], { encoding: 'utf8' });
  return (r.stdout ?? '').trim();
}

function dirId(dir: string): string {
  const st = statSync(realpathSync(dir));
  return `${st.dev}:${st.ino}`;
}

describe('track 23C preserved skill copies', () => {
  test('O1 shared-directory skip stays visible on a later check', () => {
    const home = join(baseTmp, 'o1-shared');
    mkdirSync(hostDir(home, 'claude'), { recursive: true });
    mkdirSync(dirnameOf(hostDir(home, 'codex')), { recursive: true });
    symlinkSync(hostDir(home, 'claude'), hostDir(home, 'codex'));
    const r = runSetup(['--host', 'codex', '--quiet'], home, isolatedPath(), true);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('SETUP_SKIPPED_HOSTS codex\n');
    expect(r.stdout).not.toContain('INSTALL_WARN');
    const first = checkFacts(home);
    const second = checkFacts(home);
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain('reason=shared_directory');
    expect(first.stdout).toContain('cause=shared_with_claude');
    expect(first.stdout).toContain('detection=explicit_host');
    expect(first.stdout).toContain('#shared-directory-migration');
    expect(second.stdout).toBe(first.stdout);
  });

  test('O2 unsafe auto and explicit hosts keep a cause and do not rewrite files', () => {
    const home = join(baseTmp, 'o2-unsafe');
    const skills = hostDir(home, 'claude');
    mkdirSync(skills, { recursive: true });
    writeFileSync(join(skills, 'keep.txt'), 'untouched\n');
    chmodSync(skills, 0o777);
    const auto = runSetup(['--host', 'auto', '--quiet'], home, isolatedPath(['claude']), true);
    expect(auto.exitCode).toBe(1);
    expect(auto.stdout).not.toContain('INSTALL_WARN');
    expect(readFileSync(join(skills, 'keep.txt'), 'utf8')).toBe('untouched\n');
    const warned = checkFacts(home);
    expect(warned.stdout).toContain('host=claude');
    expect(warned.stdout).toContain('reason=unsafe_directory');
    expect(warned.stdout).toContain('cause=world_writable');
    expect(warned.stdout).toContain('#unsafe-skills-directory');
    expect(readFileSync(join(ROOT, 'docs/installation.md'), 'utf8')).toContain('### Unsafe skills directory');
    chmodSync(skills, 0o755);
    // The documented fix: correct the directory, then rerun that host's setup.
    expect(runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    expect(checkFacts(home).stdout).not.toContain('reason=unsafe_directory');

    const explicitHome = join(baseTmp, 'o2-explicit');
    const codex = hostDir(explicitHome, 'codex');
    mkdirSync(codex, { recursive: true });
    writeFileSync(join(codex, 'keep.txt'), 'explicit\n');
    chmodSync(codex, 0o777);
    const explicit = runSetup(['--host', 'codex', '--quiet'], explicitHome, isolatedPath(), true);
    expect(explicit.exitCode).toBe(1);
    expect(explicit.stderr).toContain('world-writable');
    expect(readFileSync(join(codex, 'keep.txt'), 'utf8')).toBe('explicit\n');
    expect(checkFacts(explicitHome).stdout).toContain('cause=world_writable');
  }, 30000);

  test('O2 an unsafe Claude directory clears after repair even while Cursor reads it', () => {
    const home = join(baseTmp, 'o2-cursor-shares');
    const skills = hostDir(home, 'claude');
    mkdirSync(skills, { recursive: true });
    mkdirSync(join(home, '.cursor'), { recursive: true });
    symlinkSync(skills, hostDir(home, 'cursor'));
    chmodSync(skills, 0o777);
    runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true);
    expect(checkFacts(home).stdout).toContain('reason=unsafe_directory');
    chmodSync(skills, 0o755);
    expect(runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    expect(checkFacts(home).stdout).not.toContain('reason=unsafe_directory');
  }, 30000);

  test('O2 a skills directory outside HOME records cause=outside_home', () => {
    const home = join(baseTmp, 'o2-outside');
    const outside = join(baseTmp, 'o2-outside-target');
    mkdirSync(outside, { recursive: true });
    mkdirSync(join(home, '.codex'), { recursive: true });
    symlinkSync(outside, hostDir(home, 'codex'));
    runSetup(['--host', 'auto', '--quiet'], home, isolatedPath(['claude', 'codex']), true);
    const warned = checkFacts(home).stdout;
    expect(warned).toContain('host=codex');
    expect(warned).toContain('cause=outside_home');
    expect(readdirSync(outside)).toEqual([]);
  }, 30000);

  test('O1 separating a shared directory clears only that host fact', () => {
    const home = join(baseTmp, 'o1-clear');
    plantRegularSkill(home, 'implement', 'KEEP\n');
    mkdirSync(dirnameOf(hostDir(home, 'codex')), { recursive: true });
    symlinkSync(hostDir(home, 'claude'), hostDir(home, 'codex'));
    runSetup(['--host', 'codex', '--quiet'], home, isolatedPath(), true);
    const before = checkFacts(home).stdout;
    expect(before).toContain('reason=shared_directory');
    expect(before).toContain('skill=implement');
    rmSync(hostDir(home, 'codex'));
    mkdirSync(hostDir(home, 'codex'));
    expect(runSetup(['--host', 'codex', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    const after = checkFacts(home).stdout;
    expect(after).not.toContain('reason=shared_directory');
    expect(after).toContain('skill=implement');
  }, 30000);

  test('O3 served Cursor stays quiet while a preserved owner copy still warns', () => {
    const home = join(baseTmp, 'o3-served');
    plantRegularSkill(home, 'implement', 'OWNER COPY\n');
    mkdirSync(hostDir(home, 'cursor'), { recursive: true });
    const r = runSetup(['--host', 'auto', '--quiet'], home, isolatedPath(['claude', 'cursor']), true);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('');
    const warned = checkFacts(home);
    expect(warned.stdout).toContain('skill=implement');
    expect(warned.stdout).toContain('reason=preserved_regular');
    expect(warned.stdout).not.toContain('reason=cursor_unserved');
    expect(readFileSync(join(hostDir(home, 'claude'), 'implement', 'SKILL.md'), 'utf8')).toBe('OWNER COPY\n');
  });

  test('O3 unserved Cursor warns and does not hide the owner copy', () => {
    const home = join(baseTmp, 'o3-unserved');
    plantRegularSkill(home, 'implement', 'STILL HERE\n');
    mkdirSync(join(home, '.cursor'));
    symlinkSync(hostDir(home, 'claude'), hostDir(home, 'cursor'));
    const r = runSetup(['--host', 'cursor', '--quiet'], home, isolatedPath(), true);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('SETUP_SKIPPED_HOSTS cursor\n');
    const warned = checkFacts(home);
    expect(warned.stdout).toContain('reason=cursor_unserved');
    expect(warned.stdout).toContain('cause=owner_not_selected');
    expect(warned.stdout).toContain('skill=implement');
    expect(readFileSync(join(hostDir(home, 'claude'), 'implement', 'SKILL.md'), 'utf8')).toBe('STILL HERE\n');
  });

  test('O4 raw-equal and stripped-variant copies stay observations', () => {
    const home = join(baseTmp, 'o4-compare');
    const raw = readFileSync(join(ROOT, 'skills', 'roadmap.md'));
    plantRegularSkill(home, 'roadmap', raw.toString());
    const strippedRun = spawnSync('/bin/bash', ['-c', `awk '
      BEGIN { fm=0; skip=0 }
      /^---[[:space:]]*$/ {
        if (fm==0) { fm=1; print; next }
        skip=0; print; next
      }
      fm==1 && /^allowed-tools:[[:space:]]*$/ { skip=1; next }
      skip==1 && /^[[:space:]]+-[[:space:]]/ { next }
      skip==1 { skip=0 }
      { print }
    ' "$1"`, 'bash', join(ROOT, 'skills', 'roadmap.md')], { encoding: 'utf8' });
    expect(strippedRun.status).toBe(0);
    expect(strippedRun.stdout).not.toBe(raw.toString());
    const variantHome = join(baseTmp, 'o4-variant');
    plantRegularSkill(variantHome, 'roadmap', strippedRun.stdout);
    runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true);
    runSetup(['--host', 'claude', '--quiet'], variantHome, isolatedPath(), true);
    const rawWarn = checkFacts(home).stdout;
    const variantWarn = checkFacts(variantHome).stdout;
    expect(rawWarn).toContain('skill=roadmap');
    expect(rawWarn).toContain('compare=matches_canonical');
    expect(rawWarn).toContain(`observed=${VERSION_TEXT}`);
    expect(rawWarn).toContain('freshness=unverified');
    expect(rawWarn).not.toContain('customized');
    expect(rawWarn).not.toContain('disposable');
    expect(variantWarn).toContain('compare=differs_canonical');
    expect(variantWarn).toContain('variant=matches_stripped');
    expect(readFileSync(join(hostDir(home, 'claude'), 'roadmap', 'SKILL.md'))).toEqual(raw);
    expect(readFileSync(join(hostDir(variantHome, 'claude'), 'roadmap', 'SKILL.md'), 'utf8')).toBe(strippedRun.stdout);
  });

  test('O5 a retired regular copy is kept and reported source-unavailable', () => {
    const home = join(baseTmp, 'o5-retired');
    const body = 'RETIRED COPY\n';
    const dir = plantRegularSkill(home, 'review-apparatus', body);
    const r = runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true);
    expect(r.exitCode).toBe(0);
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe(body);
    const warned = checkFacts(home).stdout;
    expect(warned).toContain('skill=review-apparatus');
    expect(warned).toContain('reason=preserved_regular');
    expect(warned).toContain('compare=source_unavailable');
    expect(warned).toContain('variant=not_applicable');
  });

  test('O6 foreign, marker-only and non-regular files are not claimed or changed', () => {
    const home = join(baseTmp, 'o6-foreign');
    const foreignDir = join(baseTmp, 'o6-not-a-checkout');
    mkdirSync(foreignDir, { recursive: true });
    const foreign = plantRegularSkill(home, 'implement', 'FOREIGN\n', foreignDir);
    const marker = join(hostDir(home, 'claude'), 'pair-review');
    mkdirSync(marker, { recursive: true });
    writeFileSync(join(marker, '.extend-root'), `${realpathSync(ROOT)}\n`);
    writeFileSync(join(marker, 'notes.md'), 'marker only\n');
    const odd = join(hostDir(home, 'claude'), 'roadmap');
    mkdirSync(odd, { recursive: true });
    mkdirSync(join(odd, 'SKILL.md'));
    writeFileSync(join(odd, '.extend-root'), `${realpathSync(ROOT)}\n`);
    const r = runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true);
    expect(r.exitCode).toBe(0);
    expect(readFileSync(join(foreign, 'SKILL.md'), 'utf8')).toBe('FOREIGN\n');
    expect(lstatSync(join(marker, 'SKILL.md')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(marker, 'notes.md'), 'utf8')).toBe('marker only\n');
    expect(lstatSync(join(odd, 'SKILL.md')).isDirectory()).toBe(true);
    const warned = checkFacts(home).stdout;
    expect(warned).not.toContain('skill=implement');
    expect(warned).not.toContain('skill=pair-review');
    expect(warned).not.toContain('skill=roadmap');
  });

  test('O7 another HOME and an unrepaired origin do not clear this install', () => {
    const home = join(baseTmp, 'o7-home');
    const otherHome = join(baseTmp, 'o7-other-home');
    mkdirSync(otherHome, { recursive: true });
    plantRegularSkill(home, 'implement', 'KEEP ORIGIN\n');
    const other = join(baseTmp, 'o7-other-checkout');
    mkdirSync(join(other, 'bin'), { recursive: true });
    mkdirSync(join(other, 'skills'), { recursive: true });
    copyFileSync(SETUP, join(other, 'setup'));
    chmodSync(join(other, 'setup'), 0o755);
    mkdirSync(join(other, 'bin', 'lib'), { recursive: true });
    copyFileSync(join(ROOT, 'bin', 'lib', 'install-safety.sh'), join(other, 'bin', 'lib', 'install-safety.sh'));
    copyFileSync(join(ROOT, 'bin', 'update-check'), join(other, 'bin', 'update-check'));
    chmodSync(join(other, 'bin', 'update-check'), 0o755);
    writeFileSync(join(other, 'skills', 'implement.md'), 'other source\n');
    writeFileSync(join(other, 'VERSION'), '9.9.9\n');
    const otherSkill = plantRegularSkill(home, 'pair-review', 'OTHER ORIGIN\n', realpathSync(other));
    runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true);
    const before = readFileSync(statusPath(home));
    const elsewhere = spawnSync(join(other, 'setup'), ['--host', 'claude', '--quiet'], {
      encoding: 'utf8',
      env: { PATH: isolatedPath(), HOME: home },
    });
    expect(elsewhere.status).toBe(0);
    expect(readFileSync(join(otherSkill, 'SKILL.md'), 'utf8')).toBe('OTHER ORIGIN\n');
    expect(checkFacts(home).stdout).toContain('skill=pair-review');
    expect(checkFacts(home).stdout).toContain('skill=implement');
    // Another HOME reading the same state skips these facts; it does not call
    // the file malformed.
    const moved = checkFacts(otherHome, join(home, '.gstack-extend'));
    expect(moved.stdout).toBe('');
    // A setup under the other HOME keeps this HOME's facts and adds its own.
    mkdirSync(join(otherHome, '.codex'), { recursive: true });
    symlinkSync(join(otherHome, '.claude', 'skills'), join(otherHome, '.codex', 'skills'));
    mkdirSync(join(otherHome, '.claude', 'skills'), { recursive: true });
    const shared = spawnSync(SETUP, ['--host', 'codex', '--quiet'], {
      encoding: 'utf8',
      env: { PATH: isolatedPath(), HOME: otherHome, GSTACK_EXTEND_STATE_DIR: join(home, '.gstack-extend') },
    });
    expect(shared.status).toBe(0);
    expect(shared.stdout).not.toContain('INSTALL_WARN');
    expect(checkFacts(otherHome, join(home, '.gstack-extend')).stdout).toContain('reason=shared_directory');
    const mine = checkFacts(home).stdout;
    expect(mine).toContain('skill=implement');
    expect(mine).toContain('skill=pair-review');
    expect(mine).not.toContain('reason=shared_directory');
    expect(readFileSync(statusPath(home))).not.toEqual(before);
  }, 30000);

  test('O6 a first-seen pointer to a missing checkout is not claimed', () => {
    const home = join(baseTmp, 'o6-missing');
    const dir = plantRegularSkill(home, 'implement', 'ORPHAN\n', '/missing/never-a-checkout');
    expect(runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    expect(checkFacts(home).stdout).not.toContain('skill=implement');
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe('ORPHAN\n');
  });

  test('a usage error exits before install status and prints no shell errors', () => {
    const home = join(baseTmp, 'usage-error');
    mkdirSync(home, { recursive: true });
    for (const args of [['--bogus'], ['--host', 'nope'], ['--skills-dir', join(home, 'x')]]) {
      const r = runSetup(args, home, isolatedPath(), true);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).not.toContain('command not found');
      expect(existsSync(statusPath(home))).toBe(false);
    }
  });

  test('O8 preflight failure and all-skipped setup keep prior facts', () => {
    const home = join(baseTmp, 'o8-keep');
    const dir = plantRegularSkill(home, 'implement', 'PRIOR\n');
    const first = runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true);
    expect(first.exitCode).toBe(0);
    expect(checkFacts(home).stdout).toContain('skill=implement');
    chmodSync(hostDir(home, 'claude'), 0o777);
    const failed = runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true);
    expect(failed.exitCode).toBe(1);
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe('PRIOR\n');
    const after = checkFacts(home).stdout;
    expect(after).toContain('skill=implement');
    expect(after).toContain('reason=unsafe_directory');
    expect(after).toContain('cause=world_writable');
  });

  test('W1 a clean install publishes an empty snapshot and stays quiet', () => {
    const home = join(baseTmp, 'w1-clean');
    mkdirSync(home, { recursive: true });
    const absent = checkFacts(home);
    expect(absent.exitCode).toBe(0);
    expect(absent.stdout).toBe('');
    const r = runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('');
    expect((statSync(statusPath(home)).mode & 0o777)).toBe(0o600);
    expect(lstatSync(statusPath(home)).isSymbolicLink()).toBe(false);
    expect(checkFacts(home).stdout).toBe('');
    expect(checkFacts(home).stdout).toBe('');
  });

  test('W4 symlink, directory and fifo status are not followed or replaced', () => {
    const home = join(baseTmp, 'w4-types');
    mkdirSync(join(home, '.gstack-extend'), { recursive: true });
    const victim = join(home, 'victim');
    writeFileSync(victim, 'SECRET-VICTIM\n');
    symlinkSync(victim, statusPath(home));
    plantRegularSkill(home, 'implement', 'STAY\n');
    const linked = runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true);
    expect(linked.exitCode).toBe(0);
    expect(linked.stdout).toContain('cause=predecessor_symlink');
    expect(readFileSync(victim, 'utf8')).toBe('SECRET-VICTIM\n');
    expect(lstatSync(statusPath(home)).isSymbolicLink()).toBe(true);
    const read = checkFacts(home);
    expect(read.stdout).toContain('reason=status_unreadable');
    expect(read.stdout).toContain('cause=symlink');
    expect(read.stdout).not.toContain('SECRET-VICTIM');
    rmSync(statusPath(home));

    mkdirSync(statusPath(home));
    const asDir = runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true);
    expect(asDir.stdout).toContain('cause=predecessor_directory');
    expect(lstatSync(statusPath(home)).isDirectory()).toBe(true);
    rmSync(statusPath(home), { recursive: true });

    spawnSync('mkfifo', [statusPath(home)]);
    const started = Date.now();
    const fifoRead = checkFacts(home);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(fifoRead.stdout).toContain('cause=fifo');
    const fifoWrite = runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true);
    expect(fifoWrite.stdout).toContain('predecessor_fifo');
    expect(lstatSync(statusPath(home)).isFIFO()).toBe(true);
    expect(readFileSync(join(hostDir(home, 'claude'), 'implement', 'SKILL.md'), 'utf8')).toBe('STAY\n');
  }, 30000);

  test('W3 setup keeps an unknown, damaged or unreadable snapshot byte for byte', () => {
    const home = join(baseTmp, 'w3-writer');
    plantRegularSkill(home, 'implement', 'KEEP STATUS\n');
    mkdirSync(join(home, '.gstack-extend'), { recursive: true });
    const nul = (fields: string[]) => Buffer.from(fields.map((f) => `${f}\0`).join(''), 'utf8');
    const cases: Array<[string, Buffer]> = [
      ['unknown_schema', nul(['gstack-extend-install-status', '2', 'END', '0'])],
      ['truncated', nul(['gstack-extend-install-status', '1', 'fact'])],
      ['extra_data', nul(['gstack-extend-install-status', '1', 'END', '0', 'extra'])],
      ['count_mismatch', nul(['gstack-extend-install-status', '1', 'END', '1'])],
      ['malformed', nul(['not-the-magic', '1', 'END', '0'])],
      ['unknown_record', nul(['gstack-extend-install-status', '1', 'note', ...Array(15).fill('x'), 'END', '1'])],
      ['oversized', Buffer.alloc(1048577, 0x61)],
    ];
    // A record for this HOME that names a directory outside its host
    // directories is malformed for the writer too, not silently dropped.
    const unbound = [
      'fact', statId(home), '/origin/checkout', 'this_checkout', 'claude', join(home, 'Documents'), '', '', '',
      'shared_directory', 'shared_with_codex', 'not_applicable', 'not_applicable', '1.0.0', '', 'explicit_host',
    ];
    mkdirSync(home, { recursive: true });
    cases.push(['malformed', nul(['gstack-extend-install-status', '1', ...unbound, 'END', '1'])]);
    for (const [cause, body] of cases) {
      writeFileSync(statusPath(home), body);
      const r = runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true);
      expect(r.exitCode, cause).toBe(0);
      expect(r.stdout, cause).toContain(`cause=predecessor_${cause}`);
      expect(readFileSync(statusPath(home)), cause).toEqual(body);
    }
    const body = nul(['gstack-extend-install-status', '1', 'END', '0']);
    writeFileSync(statusPath(home), body);
    chmodSync(statusPath(home), 0o000);
    const unreadable = runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true);
    chmodSync(statusPath(home), 0o600);
    expect(unreadable.stdout).toContain('cause=predecessor_not_readable');
    expect(readFileSync(statusPath(home))).toEqual(body);
  }, 40000);

  test('W5 a state directory that refuses the lock fails at once with lock_failed', () => {
    const home = join(baseTmp, 'w5-lock-failed');
    plantRegularSkill(home, 'implement', 'NO LOCK\n');
    expect(runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    const prior = readFileSync(statusPath(home));
    const state = join(home, '.gstack-extend');
    chmodSync(state, 0o555);
    const r = runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true);
    chmodSync(state, 0o755);
    expect(r.exitCode).toBe(0);
    // A contended lock would report lock_timeout after the five-second wait.
    expect(r.stdout).toContain('cause=lock_failed');
    expect(r.stdout).not.toContain('cause=lock_timeout');
    expect(existsSync(join(state, 'install-status.lock'))).toBe(false);
    expect(readFileSync(statusPath(home))).toEqual(prior);
  }, 30000);

  test('W5 a record the readers would reject is not published', () => {
    const home = join(baseTmp, 'w5-invalid');
    mkdirSync(hostDir(home, 'claude'), { recursive: true });
    expect(runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    const prior = readFileSync(statusPath(home));
    const other = join(baseTmp, 'w5-invalid-checkout');
    mkdirSync(join(other, 'bin', 'lib'), { recursive: true });
    mkdirSync(join(other, 'skills'), { recursive: true });
    copyFileSync(SETUP, join(other, 'setup'));
    chmodSync(join(other, 'setup'), 0o755);
    copyFileSync(join(ROOT, 'bin', 'lib', 'install-safety.sh'), join(other, 'bin', 'lib', 'install-safety.sh'));
    writeFileSync(join(other, 'VERSION'), '1.0.0~dev\n');
    mkdirSync(dirnameOf(hostDir(home, 'codex')), { recursive: true });
    symlinkSync(hostDir(home, 'claude'), hostDir(home, 'codex'));
    const r = spawnSync(join(other, 'setup'), ['--host', 'codex', '--quiet'], {
      encoding: 'utf8',
      env: { PATH: isolatedPath(), HOME: home },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('cause=invalid_record');
    expect(readFileSync(statusPath(home))).toEqual(prior);
    expect(existsSync(join(home, '.gstack-extend', 'install-status.lock'))).toBe(false);
  }, 30000);

  test('W2 hostile HOME and pointer bytes pass through the record arrays inert', () => {
    const pwned = join(baseTmp, 'w2-writer-pwned');
    const home = join(baseTmp, `w2-writer $(touch ${pwned}) 'q`);
    plantRegularSkill(home, 'implement', 'HOSTILE\n');
    plantRegularSkill(home, 'pair-review', 'P\n', `/missing/$(touch ${pwned})`);
    for (let i = 0; i < 2; i++) {
      const r = runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).not.toContain('INSTALL_WARN');
    }
    expect(existsSync(pwned)).toBe(false);
    const out = checkFacts(home).stdout;
    expect(out).toContain('skill=implement');
    expect(out).not.toContain('status_unverified');
    expect(existsSync(pwned)).toBe(false);
  }, 30000);

  test('W2 a trailing slash on HOME names the same facts and still clears them', () => {
    const home = join(baseTmp, 'w2-slash');
    plantRegularSkill(home, 'implement', 'SLASH\n');
    mkdirSync(dirnameOf(hostDir(home, 'codex')), { recursive: true });
    symlinkSync(hostDir(home, 'claude'), hostDir(home, 'codex'));
    for (const args of [['--host', 'claude', '--quiet'], ['--host', 'codex', '--quiet']]) {
      const r = runSetup(args, `${home}/`, isolatedPath(), true);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).not.toContain('INSTALL_WARN');
    }
    const before = checkFacts(home).stdout;
    expect(before.split('\n').filter((l) => l.includes('skill=implement'))).toHaveLength(1);
    expect(before).toContain('reason=shared_directory');
    // A Claude scan under the other spelling still names one fact.
    expect(runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    expect(checkFacts(home).stdout.split('\n').filter((l) => l.includes('skill=implement'))).toHaveLength(1);
    rmSync(hostDir(home, 'codex'));
    mkdirSync(hostDir(home, 'codex'));
    expect(runSetup(['--host', 'codex', '--quiet'], `${home}/`, isolatedPath(), true).exitCode).toBe(0);
    const after = checkFacts(home).stdout;
    expect(after).not.toContain('reason=shared_directory');
    expect(after.split('\n').filter((l) => l.includes('skill=implement'))).toHaveLength(1);
    const repaired = runRecovery('per-file', `${home}/`, { GSTACK_EXTEND_RECOVERY_SKILL: 'implement' });
    expect(repaired.exitCode).toBe(0);
    expect(repaired.stdout).toContain('RECOVERY_MIGRATED');
    expect(checkFacts(home).stdout).not.toContain('skill=implement');
  }, 90000);

  test('W2 setup and update-check agree on HOME identity with GNU-style stat first', () => {
    const home = join(baseTmp, 'w2-gnu-shim');
    plantRegularSkill(home, 'implement', 'GNU\n');
    const bins = join(baseTmp, 'w2-gnu-shim-bins');
    mkdirSync(bins, { recursive: true });
    // GNU stat ahead of /usr/bin: -f prints file-system details instead of the
    // requested format, and -c is the working form.
    writeFileSync(join(bins, 'stat'), `#!/bin/bash
case "$*" in
  *'-f %d:%i'*) printf '  File: x\\n    ID: 7fa3\\n'; exit 0 ;;
  *'-f %z'*) printf 'Blocks: 7fa3\\n'; exit 0 ;;
esac
out=()
for a in "$@"; do
  case "$a" in
    -c) out[\${#out[@]}]=-f ;;
    %s) out[\${#out[@]}]=%z ;;
    *) out[\${#out[@]}]=$a ;;
  esac
done
exec /usr/bin/stat "\${out[@]}"
`);
    chmodSync(join(bins, 'stat'), 0o755);
    // The second run reads the first run's snapshot through the same stat.
    for (let i = 0; i < 2; i++) {
      const r = runSetup(['--host', 'claude', '--quiet'], home, `${bins}:${isolatedPath()}`, true);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).not.toContain('INSTALL_WARN');
    }
    const seen = spawnSync(join(ROOT, 'bin', 'update-check'), [], {
      encoding: 'utf8',
      env: {
        PATH: `${bins}:/bin:/usr/bin`,
        HOME: home,
        GSTACK_EXTEND_DIR: realpathSync(ROOT),
        GSTACK_EXTEND_STATE_DIR: join(home, '.gstack-extend'),
        GSTACK_EXTEND_REMOTE_URL: `file://${REMOTE_VERSION}`,
      },
      timeout: 10000,
    });
    expect(seen.stdout).toContain('skill=implement');
    expect(seen.stdout).not.toContain('status_unreadable');
    expect(seen.stdout).not.toContain('status_unverified');
    expect(checkFacts(home).stdout).toContain('skill=implement');
  }, 30000);

  test('O8 an auto run that skips every host still records preserved Claude copies', () => {
    const home = join(baseTmp, 'o8-all-skipped');
    plantRegularSkill(home, 'implement', 'FIRST RUN\n');
    mkdirSync(dirnameOf(hostDir(home, 'codex')), { recursive: true });
    symlinkSync(hostDir(home, 'claude'), hostDir(home, 'codex'));
    rmSync(join(hostDir(home, 'claude'), 'pair-review'), { recursive: true, force: true });
    const r = runSetup(['--host', 'auto', '--quiet'], home, isolatedPath(['codex']), true);
    expect(r.exitCode).toBe(1);
    const warned = checkFacts(home).stdout;
    expect(warned).toContain('reason=shared_directory');
    expect(warned).toContain('skill=implement');
  }, 30000);

  test('W7 a writer that observed before the lock does not bring back a recovered copy', async () => {
    const home = join(baseTmp, 'w7-stale');
    const dir = plantRegularSkill(home, 'implement', 'OBSERVED FIRST\n');
    expect(runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    mkdirSync(dirnameOf(hostDir(home, 'codex')), { recursive: true });
    symlinkSync(hostDir(home, 'claude'), hostDir(home, 'codex'));
    const coord = join(baseTmp, 'w7-stale-coord');
    const bins = join(baseTmp, 'w7-stale-bins');
    mkdirSync(coord, { recursive: true });
    mkdirSync(bins, { recursive: true });
    const release = join(coord, 'release');
    const waiting = join(coord, 'waiting');
    spawnSync('mkfifo', [release]);
    writeFileSync(join(bins, 'sleep'), `#!/bin/bash
if [ ! -f ${JSON.stringify(waiting)} ]; then
  : > ${JSON.stringify(waiting)}
  cat ${JSON.stringify(release)} >/dev/null
fi
exec /bin/sleep "$@"
`);
    chmodSync(join(bins, 'sleep'), 0o755);
    const lock = join(home, '.gstack-extend', 'install-status.lock');
    mkdirSync(lock);
    writeFileSync(join(lock, 'owner'), '999999 heldnonce\n');
    // The late writer scans the copy, then waits on the lock inside its sleep.
    const late = spawn(SETUP, ['--host', 'codex', '--quiet'], {
      env: { PATH: `${bins}:${isolatedPath()}`, HOME: home, TMPDIR: process.env.TMPDIR ?? '/tmp' },
    });
    expect(waitUntil(() => existsSync(waiting), 15000)).toBe(true);
    rmSync(lock, { recursive: true });
    // Meanwhile the user edits the copy and recovers it with the documented example.
    writeFileSync(join(dir, 'SKILL.md'), 'EDITED THEN RECOVERED\n');
    const recovered = runRecovery('per-file', home, { GSTACK_EXTEND_RECOVERY_SKILL: 'implement' });
    expect(recovered.stdout).toContain('RECOVERY_MIGRATED');
    expect(checkFacts(home).stdout).not.toContain('skill=implement');
    const releaser = spawn('/bin/sh', ['-c', `printf go > ${JSON.stringify(release)}`]);
    const done = await waitChild(late, 20000);
    releaser.kill();
    expect(done.code).toBe(0);
    const out = checkFacts(home).stdout;
    expect(out).toContain('reason=shared_directory');
    expect(out).not.toContain('skill=implement');
  }, 60000);

  test('O3 a Cursor unsafe fact clears once Cursor reads a served host directory', () => {
    const home = join(baseTmp, 'o3-cursor-unsafe');
    mkdirSync(hostDir(home, 'claude'), { recursive: true });
    mkdirSync(hostDir(home, 'cursor'), { recursive: true });
    chmodSync(hostDir(home, 'cursor'), 0o777);
    runSetup(['--host', 'cursor', '--quiet'], home, isolatedPath(), true);
    expect(checkFacts(home).stdout).toContain('host=cursor');
    chmodSync(hostDir(home, 'cursor'), 0o755);
    rmSync(hostDir(home, 'cursor'), { recursive: true });
    symlinkSync(hostDir(home, 'claude'), hostDir(home, 'cursor'));
    expect(runSetup(['--host', 'auto', '--quiet'], home, isolatedPath(['claude', 'cursor']), true).exitCode).toBe(0);
    expect(checkFacts(home).stdout).not.toContain('host=cursor');
  }, 30000);

  test('O1 a separated Codex clears its shared fact while Cursor reads its directory', () => {
    const home = join(baseTmp, 'o1-cursor-reads-codex');
    mkdirSync(hostDir(home, 'claude'), { recursive: true });
    mkdirSync(dirnameOf(hostDir(home, 'codex')), { recursive: true });
    symlinkSync(hostDir(home, 'claude'), hostDir(home, 'codex'));
    runSetup(['--host', 'codex', '--quiet'], home, isolatedPath(), true);
    expect(checkFacts(home).stdout).toContain('reason=shared_directory');
    rmSync(hostDir(home, 'codex'));
    mkdirSync(hostDir(home, 'codex'));
    mkdirSync(join(home, '.cursor'), { recursive: true });
    symlinkSync(hostDir(home, 'codex'), hostDir(home, 'cursor'));
    expect(runSetup(['--host', 'codex', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    expect(checkFacts(home).stdout).not.toContain('reason=shared_directory');
  }, 30000);

  test('O2 the lone-Cursor Claude fallback also records detection=not_applicable', () => {
    const home = join(baseTmp, 'o2-fallback-cursor');
    mkdirSync(hostDir(home, 'claude'), { recursive: true });
    mkdirSync(hostDir(home, 'cursor'), { recursive: true });
    chmodSync(hostDir(home, 'claude'), 0o777);
    chmodSync(hostDir(home, 'cursor'), 0o777);
    const r = runSetup(['--host', 'auto', '--quiet'], home, isolatedPath(), true);
    chmodSync(hostDir(home, 'claude'), 0o755);
    chmodSync(hostDir(home, 'cursor'), 0o755);
    expect(r.exitCode).toBe(1);
    const claude = checkFacts(home).stdout.split('\n').find((l) => l.includes('host=claude') && l.includes('reason=unsafe_directory'));
    expect(claude).toBeDefined();
    expect(claude).toContain('detection=not_applicable');
  }, 30000);

  test('O2 an auto-mode Claude fallback records detection=not_applicable', () => {
    const home = join(baseTmp, 'o2-fallback');
    const skills = hostDir(home, 'claude');
    mkdirSync(skills, { recursive: true });
    chmodSync(skills, 0o777);
    const r = runSetup(['--host', 'auto', '--quiet'], home, isolatedPath(), true);
    chmodSync(skills, 0o755);
    expect(r.exitCode).toBe(1);
    const warned = checkFacts(home).stdout;
    expect(warned).toContain('reason=unsafe_directory');
    expect(warned).toContain('detection=not_applicable');
  }, 30000);

  test('W5 temp, chmod, write and rename failures keep the previous snapshot', () => {
    const home = join(baseTmp, 'w5-fail');
    plantRegularSkill(home, 'implement', 'PRIOR BYTE\n');
    expect(runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    const prior = readFileSync(statusPath(home));
    const bins = join(baseTmp, 'w5-bins');
    mkdirSync(bins, { recursive: true });
    const cases: Array<[string, string, string]> = [
      ['mktemp', 'temp_failed', `#!/bin/bash
for a in "$@"; do case "$a" in *install-status*) echo no >&2; exit 1 ;; esac; done
exec /usr/bin/mktemp "$@"
`],
      ['chmod', 'chmod_failed', `#!/bin/bash
case "$2" in */install-status.*) echo no >&2; exit 1 ;; esac
exec /bin/chmod "$@"
`],
      ['mktemp', 'write_failed', `#!/bin/bash
out=$(/usr/bin/mktemp "$@") || exit $?
case "$out" in */install-status.*) chmod 000 "$out" ;; esac
printf '%s\\n' "$out"
`],
      ['mv', 'rename_failed', `#!/bin/bash
dest=""
for a in "$@"; do dest=$a; done
case "$dest" in */install-status) echo no >&2; exit 1 ;; esac
exec /bin/mv "$@"
`],
    ];
    for (const [bin, cause, body] of cases) {
      writeFileSync(join(bins, bin), body);
      chmodSync(join(bins, bin), 0o755);
      const r = runSetup(['--host', 'claude', '--quiet'], home, `${bins}:${isolatedPath()}`, true);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain(`cause=${cause}`);
      expect(r.stdout).toContain('saved=no');
      expect(readFileSync(statusPath(home))).toEqual(prior);
      expect(readFileSync(join(hostDir(home, 'claude'), 'implement', 'SKILL.md'), 'utf8')).toBe('PRIOR BYTE\n');
      rmSync(join(bins, bin));
    }
  }, 30000);

  test('W7 two writers keep a disjoint add and a resolve-plus-add', async () => {
    // The holder blocks in its rename while it owns the lock. The second writer
    // is released only after it has reached the lock-wait loop (the sleep
    // wrapper), so an unlocked or read-before-lock merge would lose a fact.
    const home = join(baseTmp, 'w7-race');
    const kept = plantRegularSkill(home, 'implement', 'WRITER A\n');
    const coord = join(baseTmp, 'w7-coord');
    const bins = join(baseTmp, 'w7-bins');
    mkdirSync(coord, { recursive: true });
    mkdirSync(bins, { recursive: true });
    const release = join(coord, 'release');
    const seen = join(coord, 'seen');
    const waiting = join(coord, 'waiting');
    spawnSync('mkfifo', [release]);
    writeFileSync(join(bins, 'mv'), `#!/bin/bash
dest=""
for a in "$@"; do dest=$a; done
case "$dest" in
  */install-status)
    if [ ! -f ${JSON.stringify(seen)} ]; then
      : > ${JSON.stringify(seen)}
      cat ${JSON.stringify(release)} >/dev/null
    fi
    ;;
esac
exec /bin/mv "$@"
`);
    writeFileSync(join(bins, 'sleep'), `#!/bin/bash
: > ${JSON.stringify(waiting)}
exec /bin/sleep "$@"
`);
    chmodSync(join(bins, 'mv'), 0o755);
    chmodSync(join(bins, 'sleep'), 0o755);
    const env = { PATH: `${bins}:${isolatedPath()}`, HOME: home, TMPDIR: process.env.TMPDIR ?? '/tmp' };
    const hostFact = (out: string, host: string, reason: string) =>
      out.split('\n').some((line) => line.includes(`host=${host} skill=- `) && line.includes(`reason=${reason}`));
    const race = async (holderArgs: string[], waiterArgs: string[]) => {
      rmSync(seen, { force: true });
      rmSync(waiting, { force: true });
      const holder = spawn(SETUP, holderArgs, { env });
      expect(waitUntil(() => existsSync(seen), 15000)).toBe(true);
      const waiter = spawn(SETUP, waiterArgs, { env });
      expect(waitUntil(() => existsSync(waiting), 15000)).toBe(true);
      const releaser = spawn('/bin/sh', ['-c', `printf go > ${JSON.stringify(release)}`]);
      const [a, b] = await Promise.all([waitChild(holder, 20000), waitChild(waiter, 20000)]);
      releaser.kill();
      return [a, b];
    };

    // Disjoint additions: the holder records Codex's shared directory, the
    // waiter records Cursor's unserved fact. Neither run can see the other's.
    mkdirSync(dirnameOf(hostDir(home, 'codex')), { recursive: true });
    symlinkSync(hostDir(home, 'claude'), hostDir(home, 'codex'));
    mkdirSync(join(home, '.cursor'), { recursive: true });
    symlinkSync(hostDir(home, 'claude'), hostDir(home, 'cursor'));
    const [a, b] = await race(['--host', 'codex', '--quiet'], ['--host', 'cursor', '--quiet']);
    expect(a.code).toBe(0);
    expect(b.code).toBe(0);
    const added = checkFacts(home).stdout;
    expect(hostFact(added, 'codex', 'shared_directory')).toBe(true);
    expect(hostFact(added, 'cursor', 'cursor_unserved')).toBe(true);
    expect(added).toContain('skill=implement');

    // Resolve plus add: the holder separates Codex and clears its fact; the
    // waiter adds OpenCode's shared directory and cannot resolve Codex itself.
    rmSync(hostDir(home, 'codex'));
    mkdirSync(hostDir(home, 'codex'));
    mkdirSync(dirnameOf(hostDir(home, 'opencode')), { recursive: true });
    symlinkSync(hostDir(home, 'claude'), hostDir(home, 'opencode'));
    const [c, d] = await race(['--host', 'codex', '--quiet'], ['--host', 'opencode', '--quiet']);
    expect(c.code).toBe(0);
    expect(d.code).toBe(0);
    const resolved = checkFacts(home).stdout;
    expect(hostFact(resolved, 'codex', 'shared_directory')).toBe(false);
    expect(hostFact(resolved, 'opencode', 'shared_directory')).toBe(true);
    expect(hostFact(resolved, 'cursor', 'cursor_unserved')).toBe(true);
    expect(resolved).toContain('skill=implement');
    expect(readFileSync(join(kept, 'SKILL.md'), 'utf8')).toBe('WRITER A\n');
  }, 60000);

  test('W8 an abandoned lock is not stolen and this invocation releases its own', async () => {
    const home = join(baseTmp, 'w8-lock');
    plantRegularSkill(home, 'implement', 'LOCKED\n');
    expect(runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    const prior = readFileSync(statusPath(home));
    const lock = join(home, '.gstack-extend', 'install-status.lock');
    mkdirSync(lock);
    writeFileSync(join(lock, 'owner'), '999999 deadnonce\n');
    const started = Date.now();
    const blocked = runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true);
    // The wait counts whole seconds, so it ends between four and five seconds in.
    expect(Date.now() - started).toBeGreaterThanOrEqual(4000);
    expect(blocked.exitCode).toBe(0);
    expect(blocked.stdout).toContain('cause=lock_timeout');
    expect(readFileSync(join(lock, 'owner'), 'utf8')).toBe('999999 deadnonce\n');
    expect(readFileSync(statusPath(home))).toEqual(prior);
    expect(checkFacts(home).stdout).toContain('reason=status_pending');
    rmSync(lock, { recursive: true });

    const coord = join(baseTmp, 'w8-coord');
    const bins = join(baseTmp, 'w8-bins');
    mkdirSync(coord, { recursive: true });
    mkdirSync(bins, { recursive: true });
    const release = join(coord, 'release');
    const seen = join(coord, 'seen');
    spawnSync('mkfifo', [release]);
    writeFileSync(join(bins, 'mv'), `#!/bin/bash
dest=""
for a in "$@"; do dest=$a; done
case "$dest" in
  */install-status)
    : > ${JSON.stringify(seen)}
    cat ${JSON.stringify(release)} >/dev/null
    ;;
esac
exec /bin/mv "$@"
`);
    chmodSync(join(bins, 'mv'), 0o755);
    const child = spawn(SETUP, ['--host', 'claude', '--quiet'], {
      env: { PATH: `${bins}:${isolatedPath()}`, HOME: home, TMPDIR: process.env.TMPDIR ?? '/tmp' },
      detached: true,
    });
    expect(waitUntil(() => existsSync(seen), 15000)).toBe(true);
    const pending = waitChild(child, 5000);
    // Signal the whole group so the blocked mv wrapper does not outlive the test.
    process.kill(-child.pid!, 'SIGTERM');
    const stopped = await pending;
    expect(stopped.code !== null || stopped.signal !== null).toBe(true);
    expect(existsSync(lock)).toBe(false);
    expect(readFileSync(statusPath(home))).toEqual(prior);
  }, 20000);

  test('M1 partial migration clears only the repaired copy', () => {
    const home = join(baseTmp, 'm1-partial');
    const keep = plantRegularSkill(home, 'implement', 'KEEP ME\n');
    const fix = plantRegularSkill(home, 'pair-review', 'FIX ME\n');
    expect(runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    const backupBody = readFileSync(join(fix, 'SKILL.md'));
    writeFileSync(join(fix, 'SKILL.md.backup'), backupBody);
    rmSync(join(fix, 'SKILL.md'));
    symlinkSync(join(realpathSync(ROOT), 'skills', 'pair-review.md'), join(fix, 'SKILL.md'));
    expect(runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    const warned = checkFacts(home).stdout;
    expect(warned).toContain('skill=implement');
    expect(warned).not.toContain('skill=pair-review');
    expect(readFileSync(join(keep, 'SKILL.md'), 'utf8')).toBe('KEEP ME\n');
    expect(readFileSync(join(fix, 'SKILL.md.backup'))).toEqual(backupBody);
    expect(lstatSync(join(fix, 'SKILL.md')).isSymbolicLink()).toBe(true);
  });

  test('M2 a retired copy clears only with the same directory and matching backup', () => {
    const home = join(baseTmp, 'm2-retired');
    const dir = plantRegularSkill(home, 'review-apparatus', 'OLD RETIRED\n');
    expect(runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    expect(checkFacts(home).stdout).toContain('skill=review-apparatus');
    const inode = dirId(dir);
    writeFileSync(join(dir, 'SKILL.md.backup'), 'NOT THE ORIGINAL\n');
    rmSync(join(dir, 'SKILL.md'));
    expect(runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    expect(checkFacts(home).stdout).toContain('skill=review-apparatus');
    writeFileSync(join(dir, 'SKILL.md.backup'), 'OLD RETIRED\n');
    expect(dirId(dir)).toBe(inode);
    expect(runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    expect(checkFacts(home).stdout).not.toContain('skill=review-apparatus');
    expect(readFileSync(join(dir, 'SKILL.md.backup'), 'utf8')).toBe('OLD RETIRED\n');
    expect(existsSync(join(dir, 'SKILL.md'))).toBe(false);
  }, 30000);

  test('M2 a recreated directory with a matching backup does not clear the fact', () => {
    const home = join(baseTmp, 'm2-recreated');
    const dir = plantRegularSkill(home, 'review-apparatus', 'OLD RETIRED\n');
    expect(runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    const inode = dirId(dir);
    // Move the old directory aside rather than deleting it, so its inode stays
    // in use and the new directory cannot reuse it.
    renameSync(dir, `${dir}-moved-aside`);
    mkdirSync(dir);
    writeFileSync(join(dir, 'SKILL.md.backup'), 'OLD RETIRED\n');
    writeFileSync(join(dir, '.extend-root'), `${realpathSync(ROOT)}\n`);
    expect(dirId(dir)).not.toBe(inode);
    expect(runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    expect(checkFacts(home).stdout).toContain('skill=review-apparatus');
    expect(readFileSync(join(dir, 'SKILL.md.backup'), 'utf8')).toBe('OLD RETIRED\n');
  }, 30000);

  test('M3 a missing backup or empty digest does not resolve the fact', () => {
    const home = join(baseTmp, 'm3-digest');
    const dir = plantRegularSkill(home, 'implement', 'DIGEST ME\n');
    expect(runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    rmSync(join(dir, 'SKILL.md'));
    expect(runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    expect(checkFacts(home).stdout).toContain('skill=implement');
    writeFileSync(join(dir, 'SKILL.md.backup'), 'DIGEST ME\n');
    const frame = readFileSync(statusPath(home));
    const text = frame.toString('utf8');
    const sha = sha256(join(dir, 'SKILL.md.backup'));
    expect(text.includes(sha)).toBe(true);
    writeFileSync(statusPath(home), frame.toString('utf8').replace(sha, '').split('\0').join('\0'));
    // Restoring the NUL frame with an empty digest field: rewrite the sha field only.
    const fields = frame.toString('utf8').split('\0');
    const shaAt = fields.indexOf(sha);
    expect(shaAt).toBeGreaterThan(0);
    fields[shaAt] = '';
    writeFileSync(statusPath(home), Buffer.from(fields.join('\0')));
    expect(runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    expect(checkFacts(home).stdout).toContain('skill=implement');
    expect(readFileSync(join(dir, 'SKILL.md.backup'), 'utf8')).toBe('DIGEST ME\n');
  }, 30000);

  test('M4 deleting an origin or retargeting one pointer does not clear the other path', () => {
    const home = join(baseTmp, 'm4-origin');
    const keep = plantRegularSkill(home, 'implement', 'STAY PUT\n');
    const repair = plantRegularSkill(home, 'roadmap', readFileSync(join(ROOT, 'skills', 'roadmap.md'), 'utf8'));
    expect(runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    writeFileSync(join(keep, '.extend-root'), '/missing/deleted-checkout\n');
    const backup = readFileSync(join(repair, 'SKILL.md'));
    writeFileSync(join(repair, 'SKILL.md.backup'), backup);
    rmSync(join(repair, 'SKILL.md'));
    symlinkSync(join(realpathSync(ROOT), 'skills', 'roadmap.md'), join(repair, 'SKILL.md'));
    expect(runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    const warned = checkFacts(home).stdout;
    expect(warned).toContain('skill=implement');
    expect(warned).not.toContain('skill=roadmap');
    expect(readFileSync(join(keep, 'SKILL.md'), 'utf8')).toBe('STAY PUT\n');
    expect(readFileSync(join(repair, 'SKILL.md.backup'))).toEqual(backup);
  });

  test('M5 the documented example refuses collisions, failed moves and repeat moves', () => {
    const home = join(baseTmp, 'm5-example');
    const dir = plantRegularSkill(home, 'implement', 'MOVE ME\n');
    writeFileSync(join(dir, 'SKILL.md.backup'), 'ALREADY BACKED UP\n');
    const collision = runRecovery('per-file', home, { GSTACK_EXTEND_RECOVERY_SKILL: 'implement' });
    expect(collision.exitCode).toBe(3);
    expect(collision.stdout).toContain('RECOVERY_COLLISION');
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe('MOVE ME\n');
    expect(readFileSync(join(dir, 'SKILL.md.backup'), 'utf8')).toBe('ALREADY BACKED UP\n');
    rmSync(join(dir, 'SKILL.md.backup'));

    const bins = join(baseTmp, 'm5-bins');
    mkdirSync(bins, { recursive: true });
    // An ln that reports success without linking: the example must notice.
    writeFileSync(join(bins, 'ln'), `#!/bin/bash
for a in "$@"; do case "$a" in */SKILL.md.backup) exit 0 ;; esac; done
exec /bin/ln "$@"
`);
    chmodSync(join(bins, 'ln'), 0o755);
    const failed = runRecovery('per-file', home, { GSTACK_EXTEND_RECOVERY_SKILL: 'implement' }, `${bins}:${dirnameOf(process.execPath)}`);
    expect(failed.exitCode).toBe(4);
    expect(failed.stdout).toContain('RECOVERY_MOVE_FAILED');
    expect(failed.stdout).not.toContain('RECOVERY_MIGRATED');
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe('MOVE ME\n');
    expect(existsSync(join(dir, 'SKILL.md.backup'))).toBe(false);

    const migrated = runRecovery('per-file', home, { GSTACK_EXTEND_RECOVERY_SKILL: 'implement' });
    expect(migrated.exitCode).toBe(0);
    expect(migrated.stdout).toContain('RECOVERY_MIGRATED');
    expect(readFileSync(join(dir, 'SKILL.md.backup'), 'utf8')).toBe('MOVE ME\n');
    expect(readlinkSync(join(dir, 'SKILL.md'))).toBe(join(realpathSync(ROOT), 'skills', 'implement.md'));
    const again = runRecovery('per-file', home, { GSTACK_EXTEND_RECOVERY_SKILL: 'implement' });
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toContain('RECOVERY_ALREADY_REPAIRED');
    expect(again.stdout).not.toContain('RECOVERY_MIGRATED');
    expect(readFileSync(join(dir, 'SKILL.md.backup'), 'utf8')).toBe('MOVE ME\n');
    expect(readlinkSync(join(dir, 'SKILL.md'))).toBe(join(realpathSync(ROOT), 'skills', 'implement.md'));
  }, 60000);

  test('M6 an interrupted example resumes without moving the backup again', () => {
    const home = join(baseTmp, 'm6-resume');
    const dir = plantRegularSkill(home, 'implement', 'INTERRUPTED\n');
    renameSync(join(dir, 'SKILL.md'), join(dir, 'SKILL.md.backup'));
    const resumed = runRecovery('per-file', home, { GSTACK_EXTEND_RECOVERY_SKILL: 'implement' });
    expect(resumed.exitCode).toBe(0);
    expect(resumed.stdout).toContain('RECOVERY_RESUME');
    expect(resumed.stdout).toContain('RECOVERY_MIGRATED');
    expect(readFileSync(join(dir, 'SKILL.md.backup'), 'utf8')).toBe('INTERRUPTED\n');
    expect(readlinkSync(join(dir, 'SKILL.md'))).toBe(join(realpathSync(ROOT), 'skills', 'implement.md'));
  }, 30000);

  test('M5 missing and foreign links do not move a repaired or unrelated file', () => {
    const home = join(baseTmp, 'm5-branches');
    mkdirSync(hostDir(home, 'claude'), { recursive: true });
    const missing = runRecovery('per-file', home, { GSTACK_EXTEND_RECOVERY_SKILL: 'implement' });
    expect(missing.exitCode).toBe(0);
    expect(missing.stdout).toContain('RECOVERY_MISSING');
    const foreignDir = join(hostDir(home, 'claude'), 'implement');
    mkdirSync(foreignDir, { recursive: true });
    symlinkSync('/usr/bin/true', join(foreignDir, 'SKILL.md'));
    const foreign = runRecovery('per-file', home, { GSTACK_EXTEND_RECOVERY_SKILL: 'implement' });
    expect(foreign.exitCode).toBe(0);
    expect(foreign.stdout).toContain('RECOVERY_FOREIGN_LINK');
    expect(readlinkSync(join(foreignDir, 'SKILL.md'))).toBe('/usr/bin/true');
  });

  test('M7 custom retain and retired-source examples do not replace bytes', () => {
    const home = join(baseTmp, 'm7-custom');
    const dir = plantRegularSkill(home, 'implement', 'CUSTOM INTENT\n');
    expect(runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    const state = { GSTACK_EXTEND_STATE_DIR: join(home, '.gstack-extend') };
    const off = runRecovery('custom-retain', home, { ...state, GSTACK_EXTEND_RECOVERY_UPDATE_CHECK: 'false' });
    expect(off.exitCode).toBe(0);
    expect(off.stdout).toContain('RECOVERY_UPDATE_CHECK_false');
    expect(checkFacts(home).stdout).toBe('');
    const on = runRecovery('custom-retain', home, { ...state, GSTACK_EXTEND_RECOVERY_UPDATE_CHECK: 'true' });
    expect(on.exitCode).toBe(0);
    expect(on.stdout).toContain('RECOVERY_UPDATE_CHECK_true');
    const refused = runRecovery('custom-retain', home, { ...state, GSTACK_EXTEND_RECOVERY_UPDATE_CHECK: 'maybe' });
    expect(refused.exitCode).toBe(2);
    expect(refused.stdout).toContain('RECOVERY_VALUE_REFUSED');
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe('CUSTOM INTENT\n');
    expect(checkFacts(home).stdout).toContain('skill=implement');
    const docs = readFileSync(join(ROOT, 'docs/installation.md'), 'utf8');
    expect(docs).toContain('update_check false');
    expect(docs).toContain('update_check true');
    expect(docs).toContain('Tracks 27A and 27B');
    expect(docs).toContain('Do not delete `.extend-root` or `install-status`');
    expect(docs).not.toContain('rm install-status');
    const skill = readFileSync(join(ROOT, 'skills', 'gstack-extend-upgrade.md'), 'utf8');
    const shared = skill.split('<!-- SHARED:upgrade-flow -->')[1]!.split('<!-- /SHARED:upgrade-flow -->')[0]!;
    expect(shared).not.toContain('INSTALL_WARN');
    expect(skill).toContain('INSTALL_WARN');
    expect(skill).toContain('Tracks 27A and 27B');

    const retiredHome = join(baseTmp, 'm7-retired');
    const retired = plantRegularSkill(retiredHome, 'review-apparatus', 'RETIRED KEEP\n');
    const manual = runRecovery('per-file', retiredHome, { GSTACK_EXTEND_RECOVERY_SKILL: 'review-apparatus' });
    expect(manual.exitCode).toBe(0);
    expect(manual.stdout).toContain('RECOVERY_RETIRED_MANUAL');
    expect(readFileSync(join(retired, 'SKILL.md'), 'utf8')).toBe('RETIRED KEEP\n');
    expect(existsSync(join(retired, 'SKILL.md.backup'))).toBe(false);
  }, 30000);

  test('M1 the per-file example clears a copy edited after setup recorded it', () => {
    const home = join(baseTmp, 'm1-edited');
    const dir = plantRegularSkill(home, 'implement', 'OLD GENERATED COPY\n');
    expect(runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    writeFileSync(join(dir, 'SKILL.md'), 'EDITED AFTER SETUP\n');
    const r = runRecovery('per-file', home, { GSTACK_EXTEND_RECOVERY_SKILL: 'implement' });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('RECOVERY_MIGRATED');
    expect(readFileSync(join(dir, 'SKILL.md.backup'), 'utf8')).toBe('EDITED AFTER SETUP\n');
    expect(checkFacts(home).stdout).not.toContain('skill=implement');
  }, 60000);

  test('M6 a setup failure after the move is reported and the rerun resumes', () => {
    const home = join(baseTmp, 'm6-setup-fails');
    const dir = plantRegularSkill(home, 'implement', 'MOVE ME\n');
    expect(runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    // Make the skills directory unsafe as soon as the original name is removed,
    // so the setup that follows the move fails.
    const bins = join(baseTmp, 'm6-fail-bins');
    mkdirSync(bins, { recursive: true });
    writeFileSync(join(bins, 'rm'), `#!/bin/bash
/bin/rm "$@"
status=$?
for a in "$@"; do
  [ "$a" = ${JSON.stringify(join(dir, 'SKILL.md'))} ] && /bin/chmod 777 ${JSON.stringify(hostDir(home, 'claude'))}
done
exit $status
`);
    chmodSync(join(bins, 'rm'), 0o755);
    const failed = runRecovery('per-file', home, { GSTACK_EXTEND_RECOVERY_SKILL: 'implement' }, `${bins}:${dirnameOf(process.execPath)}`);
    chmodSync(hostDir(home, 'claude'), 0o755);
    expect(failed.exitCode).toBe(5);
    expect(failed.stdout).toContain('RECOVERY_SETUP_FAILED');
    expect(failed.stdout).not.toContain('RECOVERY_MIGRATED');
    expect(existsSync(join(dir, 'SKILL.md'))).toBe(false);
    expect(readFileSync(join(dir, 'SKILL.md.backup'), 'utf8')).toBe('MOVE ME\n');
    const resumed = runRecovery('per-file', home, { GSTACK_EXTEND_RECOVERY_SKILL: 'implement' });
    expect(resumed.exitCode).toBe(0);
    expect(resumed.stdout).toContain('RECOVERY_RESUME');
    expect(resumed.stdout).toContain('RECOVERY_MIGRATED');
    expect(readFileSync(join(dir, 'SKILL.md.backup'), 'utf8')).toBe('MOVE ME\n');
    expect(checkFacts(home).stdout).not.toContain('skill=implement');
  }, 60000);

  test('M5 the per-file example stops before moving when setup cannot save', () => {
    const home = join(baseTmp, 'm5-unsaved');
    const dir = plantRegularSkill(home, 'implement', 'EDITED LATER\n');
    expect(runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    writeFileSync(join(dir, 'SKILL.md'), 'EDITED AFTER THE LAST SAVE\n');
    const lock = join(home, '.gstack-extend', 'install-status.lock');
    mkdirSync(lock);
    writeFileSync(join(lock, 'owner'), '999999 heldnonce\n');
    const blocked = runRecovery('per-file', home, { GSTACK_EXTEND_RECOVERY_SKILL: 'implement' });
    expect(blocked.exitCode).toBe(7);
    expect(blocked.stdout).toContain('cause=lock_timeout');
    expect(blocked.stdout).toContain('RECOVERY_STATUS_UNSAVED');
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe('EDITED AFTER THE LAST SAVE\n');
    expect(existsSync(join(dir, 'SKILL.md.backup'))).toBe(false);
    rmSync(lock, { recursive: true });
    const migrated = runRecovery('per-file', home, { GSTACK_EXTEND_RECOVERY_SKILL: 'implement' });
    expect(migrated.exitCode).toBe(0);
    expect(migrated.stdout).toContain('RECOVERY_MIGRATED');
    expect(checkFacts(home).stdout).not.toContain('skill=implement');
  }, 60000);

  test('M6 an interruption between ln and rm resumes instead of colliding', () => {
    const home = join(baseTmp, 'm6-hardlink');
    const dir = plantRegularSkill(home, 'implement', 'LINKED TWICE\n');
    expect(runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    linkSync(join(dir, 'SKILL.md'), join(dir, 'SKILL.md.backup'));
    const r = runRecovery('per-file', home, { GSTACK_EXTEND_RECOVERY_SKILL: 'implement' });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('RECOVERY_RESUME');
    expect(r.stdout).toContain('RECOVERY_MIGRATED');
    expect(readFileSync(join(dir, 'SKILL.md.backup'), 'utf8')).toBe('LINKED TWICE\n');
    expect(checkFacts(home).stdout).not.toContain('skill=implement');
  }, 60000);

  test('M6 an unsaved record after the move stops with exit 7 and the rerun catches up', () => {
    const home = join(baseTmp, 'm6-unsaved-after');
    const dir = plantRegularSkill(home, 'implement', 'MOVE THEN HOLD\n');
    expect(runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    const lock = join(home, '.gstack-extend', 'install-status.lock');
    // Hold the lock as soon as the original name is removed, so the setup after
    // the move cannot save.
    const bins = join(baseTmp, 'm6-unsaved-bins');
    mkdirSync(bins, { recursive: true });
    writeFileSync(join(bins, 'rm'), `#!/bin/bash
/bin/rm "$@"
status=$?
for a in "$@"; do
  if [ "$a" = ${JSON.stringify(join(dir, 'SKILL.md'))} ]; then
    /bin/mkdir ${JSON.stringify(lock)} && printf '999999 heldnonce\\n' > ${JSON.stringify(join(lock, 'owner'))}
  fi
done
exit $status
`);
    chmodSync(join(bins, 'rm'), 0o755);
    const held = runRecovery('per-file', home, { GSTACK_EXTEND_RECOVERY_SKILL: 'implement' }, `${bins}:${dirnameOf(process.execPath)}`);
    expect(held.exitCode).toBe(7);
    expect(held.stdout).toContain('RECOVERY_STATUS_UNSAVED');
    expect(lstatSync(join(dir, 'SKILL.md')).isSymbolicLink()).toBe(true);
    expect(checkFacts(home).stdout).toContain('skill=implement');
    rmSync(lock, { recursive: true });
    const again = runRecovery('per-file', home, { GSTACK_EXTEND_RECOVERY_SKILL: 'implement' });
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toContain('RECOVERY_ALREADY_REPAIRED');
    expect(checkFacts(home).stdout).not.toContain('skill=implement');
  }, 60000);

  test('separate-host example stops with exit 7 when setup cannot save', () => {
    const home = join(baseTmp, 'm7-separate-unsaved');
    mkdirSync(hostDir(home, 'claude'), { recursive: true });
    mkdirSync(hostDir(home, 'codex'), { recursive: true });
    const lock = join(home, '.gstack-extend', 'install-status.lock');
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, 'owner'), '999999 heldnonce\n');
    const r = runRecovery('separate-host', home, { GSTACK_EXTEND_RECOVERY_HOST: 'codex' });
    rmSync(lock, { recursive: true });
    expect(r.exitCode).toBe(7);
    expect(r.stdout).toContain('cause=lock_timeout');
    expect(r.stdout).toContain('RECOVERY_STATUS_UNSAVED');
    expect(r.stdout).not.toContain('RECOVERY_HOST_SETUP');
  }, 30000);

  test('M5 a repeat through a symlinked checkout path still reports already repaired', () => {
    const home = join(baseTmp, 'm5-alias');
    const dir = plantRegularSkill(home, 'implement', 'ALIAS\n');
    expect(runRecovery('per-file', home, { GSTACK_EXTEND_RECOVERY_SKILL: 'implement' }).exitCode).toBe(0);
    const alias = join(baseTmp, 'm5-checkout-alias');
    symlinkSync(realpathSync(ROOT), alias);
    const again = runRecovery('per-file', home, {
      GSTACK_EXTEND_RECOVERY_SKILL: 'implement',
      GSTACK_EXTEND_RECOVERY_CHECKOUT: `${alias}/`,
    });
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toContain('RECOVERY_ALREADY_REPAIRED');
    expect(readFileSync(join(dir, 'SKILL.md.backup'), 'utf8')).toBe('ALIAS\n');
  }, 60000);

  test('M7 the retired example sets a reviewed copy aside and clears its warning', () => {
    const home = join(baseTmp, 'm7-retired-example');
    const dir = plantRegularSkill(home, 'review-apparatus', 'RETIRED REVIEWED\n');
    expect(runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    expect(checkFacts(home).stdout).toContain('skill=review-apparatus');
    const notRetired = runRecovery('retired', home, { GSTACK_EXTEND_RECOVERY_SKILL: 'implement' });
    expect(notRetired.exitCode).toBe(2);
    expect(notRetired.stdout).toContain('RECOVERY_NOT_RETIRED');
    const r = runRecovery('retired', home, { GSTACK_EXTEND_RECOVERY_SKILL: 'review-apparatus' });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('RECOVERY_RETIRED_SET_ASIDE');
    expect(existsSync(join(dir, 'SKILL.md'))).toBe(false);
    expect(readFileSync(join(dir, 'SKILL.md.backup'), 'utf8')).toBe('RETIRED REVIEWED\n');
    expect(checkFacts(home).stdout).not.toContain('skill=review-apparatus');
    const again = runRecovery('retired', home, { GSTACK_EXTEND_RECOVERY_SKILL: 'review-apparatus' });
    expect(again.exitCode).toBe(0);
    expect(readFileSync(join(dir, 'SKILL.md.backup'), 'utf8')).toBe('RETIRED REVIEWED\n');
  }, 60000);

  test('separate-host example reports a host that setup still skipped', () => {
    const home = join(baseTmp, 'm7-separate-skipped');
    mkdirSync(hostDir(home, 'claude'), { recursive: true });
    mkdirSync(dirnameOf(hostDir(home, 'codex')), { recursive: true });
    symlinkSync(hostDir(home, 'claude'), hostDir(home, 'codex'));
    const r = runRecovery('separate-host', home, { GSTACK_EXTEND_RECOVERY_HOST: 'codex' });
    expect(r.exitCode).toBe(6);
    expect(r.stdout).toContain('SETUP_SKIPPED_HOSTS codex');
    expect(r.stdout).toContain('RECOVERY_HOST_SKIPPED');
    expect(r.stdout).not.toContain('RECOVERY_HOST_SETUP');
    const refused = runRecovery('separate-host', home, { GSTACK_EXTEND_RECOVERY_HOST: 'claude' });
    expect(refused.exitCode).toBe(2);
    expect(refused.stdout).toContain('RECOVERY_HOST_REFUSED');
  }, 30000);

  test('F1 strict bash 3.2 records a preserved copy without an unbound variable', () => {
    const home = join(baseTmp, 'f1-bash');
    plantRegularSkill(home, 'implement', 'BASH32\n');
    const version = spawnSync('/bin/bash', ['-c', 'printf %s "$BASH_VERSION"'], { encoding: 'utf8' });
    expect(version.stdout.startsWith('3.2')).toBe(true);
    const r = runSetup(['--host', 'claude', '--quiet'], home, isolatedPath(), true);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toContain('unbound variable');
    expect(checkFacts(home).stdout).toContain('skill=implement');
  });

  test('F2 status uses the state override and registration still uses HOME', () => {
    const home = join(baseTmp, 'f2-home');
    const state = join(baseTmp, 'f2-state');
    mkdirSync(state, { recursive: true });
    const sentinel = '{"projects":[{"slug":"override-sentinel"}]}\n';
    writeFileSync(join(state, 'projects.json'), sentinel);
    plantRegularSkill(home, 'implement', 'OVERRIDE\n');
    mkdirSync(join(home, '.local', 'bin'), { recursive: true });
    const r = spawnSync(SETUP, ['--host', 'claude', '--quiet'], {
      encoding: 'utf8',
      env: {
        PATH: isolatedPath(),
        HOME: home,
        GSTACK_EXTEND_STATE_DIR: state,
      },
    });
    expect(r.status).toBe(0);
    expect(readFileSync(join(state, 'projects.json'), 'utf8')).toBe(sentinel);
    expect(existsSync(join(state, 'install-status'))).toBe(true);
    expect(existsSync(join(home, '.gstack-extend', 'install-status'))).toBe(false);
    expect(existsSync(join(home, '.gstack-extend', 'projects.json'))).toBe(true);
    const live = process.env.HOME ? join(process.env.HOME, '.gstack-extend', 'install-status') : '';
    if (live && existsSync(live)) {
      expect(readFileSync(live).includes(home)).toBe(false);
    }
    expect(checkFacts(home, state).stdout).toContain('skill=implement');
  });

  test('separate-host example refreshes that host and leaves the Claude copy', () => {
    const home = join(baseTmp, 'm7-separate');
    const dir = plantRegularSkill(home, 'implement', 'CLAUDE COPY\n');
    mkdirSync(hostDir(home, 'codex'), { recursive: true });
    const r = runRecovery('separate-host', home, { GSTACK_EXTEND_RECOVERY_HOST: 'codex' });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('RECOVERY_HOST_SETUP');
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe('CLAUDE COPY\n');
    expect(lstatSync(join(hostDir(home, 'codex'), 'implement', 'SKILL.md')).isFile()).toBe(true);
  }, 30000);
});

function dirnameOf(path: string): string {
  return join(path, '..');
}

function waitChild(child: ChildProcess, ms: number): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { process.kill(child.pid!, 'SIGTERM'); } catch { /* already gone */ }
      resolve({ code: null, signal: null });
    }, ms);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

describe('source skill descriptions fit Codex limit', () => {
  for (const skill of SKILLS) {
    test(`${skill} description ≤ 1024`, () => {
      const path = join(ROOT, 'skills', `${skill}.md`);
      const src = readFileSync(path, 'utf8');
      const description = assertSkillDescriptionWithinLimit(src, relative(ROOT, path));
      expect(description.length).toBeLessThanOrEqual(1024);
    });
  }
});
