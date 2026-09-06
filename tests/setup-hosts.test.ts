/**
 * Native multi-host setup: --host claude|codex|opencode|auto.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { makeBaseTmp } from './helpers/fixture-repo.ts';

const ROOT = join(import.meta.dir, '..');
const SETUP = join(ROOT, 'setup');

const SKILLS = [
  'pair-review',
  'roadmap',
  'full-review',
  'review-apparatus',
  'test-plan',
  'gstack-extend-upgrade',
  'gstack-extend-init',
  'review-and-prep',
] as const;

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

function hostDir(home: string, host: 'claude' | 'codex' | 'opencode'): string {
  if (host === 'claude') return join(home, '.claude', 'skills');
  if (host === 'codex') return join(home, '.codex', 'skills');
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
    expect(body).toContain(`${home}/.codex/skills/pair-review/SKILL.md`);
    expect(body).not.toMatch(/readlink ~\/\.claude\/skills\/pair-review/);
    expect(body).not.toMatch(/^allowed-tools:/m);
    expect(descriptionLen(body)).toBeLessThanOrEqual(1024);
  });

  test('--host auto with no binaries defaults to claude', () => {
    const home = join(baseTmp, 'auto-none');
    const bins = join(baseTmp, 'empty-bins');
    mkdirSync(home, { recursive: true });
    mkdirSync(bins, { recursive: true });
    const bunDir = process.execPath.includes('/')
      ? process.execPath.replace(/\/[^/]+$/, '')
      : '/usr/bin';
    const r = runSetup(['--host', 'auto'], home, `${bins}:${bunDir}:/bin:/usr/bin`, true);
    expect(r.exitCode).toBe(0);
    expect(existsSync(join(hostDir(home, 'claude'), 'pair-review', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(hostDir(home, 'codex'), 'pair-review'))).toBe(false);
  });

  test('--host auto detects all three binaries', () => {
    const home = join(baseTmp, 'auto-all');
    const bins = join(baseTmp, 'all-bins');
    mkdirSync(home, { recursive: true });
    plantFakeBins(bins, ['claude', 'codex', 'opencode']);
    const r = runSetup(['--host', 'auto'], home, bins);
    expect(r.exitCode).toBe(0);
    expect(existsSync(join(hostDir(home, 'claude'), 'pair-review', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(hostDir(home, 'codex'), 'pair-review', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(hostDir(home, 'opencode'), 'pair-review', 'SKILL.md'))).toBe(true);
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

  test('idempotent second install', () => {
    const home = join(baseTmp, 'idempotent');
    mkdirSync(home, { recursive: true });
    expect(runSetup(['--host', 'codex'], home).exitCode).toBe(0);
    expect(runSetup(['--host', 'codex'], home).exitCode).toBe(0);
    expect(realpathSync(join(hostDir(home, 'codex'), 'pair-review', '.extend-root'))).toBeTruthy();
  });
});

describe('source skill descriptions fit Codex limit', () => {
  for (const skill of SKILLS) {
    test(`${skill} description ≤ 1024`, () => {
      const src = readFileSync(join(ROOT, 'skills', `${skill}.md`), 'utf8');
      expect(descriptionLen(src)).toBeLessThanOrEqual(1024);
    });
  }
});
