/**
 * Native multi-host setup: --host claude|codex|opencode|cursor|auto.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
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
      expect(existsSync(join(home, '.gstack-extend'))).toBe(false);
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
    expect(r.status).not.toBe(0);
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
    expect(r.stdout).toContain(`  Install pointer: ${hostDir(home, 'claude')}/`);
    for (const name of ['gstack-extend', 'gstack-extend-telemetry']) {
      expect(readlinkSync(join(bin, name))).toBe(join(ROOT, 'bin', name));
    }
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
      expect(removed.stdout).toContain(`  Install pointer: ${join(kept, '.extend-root')}\n`);
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
