/**
 * Native multi-host setup: --host claude|codex|opencode|cursor|auto.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { makeBaseTmp } from './helpers/fixture-repo.ts';
import { EXPECTED_SETUP_SKILLS as SKILLS } from './helpers/expected-setup-skills.ts';
import { extractCanonicalSpan, GUARD_LINE, ROOT_RESOLVER_SKILLS } from './helpers/extend-root.ts';

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
  return {
    stdout: typeof r.stdout === 'string' ? r.stdout : '',
    stderr: typeof r.stderr === 'string' ? r.stderr : '',
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

function descriptionLen(src: string): number {
  const closeIdx = src.indexOf('\n---', 4);
  const fm = src.slice(4, closeIdx);
  const inline = /^description:\s*(\S.*)$/m.exec(fm);
  const block = /^description:\s*\|\s*\n((?:[ \t]+\S.*\n?)+)/m.exec(fm);
  const value = inline ? inline[1]?.trim() : block ? block[1]?.trim() : '';
  return (value ?? '').length;
}

describe('setup --host flags', () => {
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

  test('codex copies rewrite sibling skill paths and strip allowed-tools', () => {
    const home = join(baseTmp, 'codex-rewrite');
    mkdirSync(home, { recursive: true });
    runSetup(['--host', 'codex'], home);
    const body = readFileSync(join(hostDir(home, 'codex'), 'pair-review', 'SKILL.md'), 'utf8');
    const testPlan = readFileSync(join(hostDir(home, 'codex'), 'test-plan', 'SKILL.md'), 'utf8');
    expect(testPlan).toContain(`${home}/.codex/skills/pair-review/SKILL.md`);
    expect(testPlan).not.toMatch(/~\/\.claude\/skills\/pair-review/);
    expect(body).not.toMatch(/^allowed-tools:/m);
    expect(descriptionLen(body)).toBeLessThanOrEqual(1024);
  });

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

  test('--host cursor writes native paths and strips allowed-tools from all skills', () => {
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
      for (const name of [...SKILLS, 'gstack-extend']) {
        expect(body).not.toContain(`~/.claude/skills/${name}`);
        if (source.includes(`~/.claude/skills/${name}`)) {
          expect(body).toContain(`${hostDir(home, 'cursor')}/${name}`);
        }
      }
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
    symlinkSync(join(home, 'gone-checkout', 'skills', 'pair-review.md'), join(pairReview, 'SKILL.md'));
    expect(runSetup(['--host', 'claude', '--quiet'], home).exitCode).toBe(0);
    expect(readlinkSync(join(roadmap, 'SKILL.md'))).toBe(join(realpathSync(ROOT), 'skills', 'roadmap.md'));
    expect(readlinkSync(join(pairReview, 'SKILL.md'))).toBe(join(realpathSync(ROOT), 'skills', 'pair-review.md'));
  });

  test('Cursor skips a skills dir shared with Claude, on install and uninstall', () => {
    const home = join(baseTmp, 'cursor-alias');
    mkdirSync(join(home, '.cursor'), { recursive: true });
    const path = isolatedPath(['claude']);
    expect(runSetup(['--host', 'claude', '--quiet'], home, path, true).exitCode).toBe(0);
    symlinkSync(hostDir(home, 'claude'), hostDir(home, 'cursor'));
    const custom = join(hostDir(home, 'claude'), 'implement', 'SKILL.md');
    rmSync(custom);
    writeFileSync(custom, 'CUSTOMIZED BY USER\n');
    const auto = runSetup(['--host', 'auto', '--quiet'], home, path, true);
    expect(auto.exitCode).toBe(0);
    expect(auto.stderr).toContain('skipping cursor');
    expect(readFileSync(custom, 'utf8')).toBe('CUSTOMIZED BY USER\n');
    expect(lstatSync(join(hostDir(home, 'claude'), 'pair-review', 'SKILL.md')).isSymbolicLink()).toBe(true);
    const removed = runSetup(['--host', 'cursor', '--uninstall', '--quiet'], home, path, true);
    expect(removed.exitCode).toBe(0);
    expect(removed.stderr).toContain('skipping cursor');
    expect(readFileSync(custom, 'utf8')).toBe('CUSTOMIZED BY USER\n');
    for (const skill of SKILLS.filter((name) => name !== 'implement')) {
      expect(lstatSync(join(hostDir(home, 'claude'), skill, 'SKILL.md')).isSymbolicLink()).toBe(true);
    }
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
    expect(auto.stderr).toContain('outside resolved $HOME');
    expect(lstatSync(join(hostDir(home, 'claude'), 'pair-review', 'SKILL.md')).isSymbolicLink()).toBe(true);
    expect(readdirSync(outside)).toEqual([]);
    const explicit = runSetup(['--host', 'cursor', '--quiet'], home, path, true);
    expect(explicit.exitCode).toBe(1);
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
    expect(r.stderr).toContain('no detected host has a safe skills directory');
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
      const src = readFileSync(join(ROOT, 'skills', `${skill}.md`), 'utf8');
      expect(descriptionLen(src)).toBeLessThanOrEqual(1024);
    });
  }
});
