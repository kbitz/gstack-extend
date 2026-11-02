/**
 * skill-content.test.ts — rules that read the real skill sources, kept apart from the installer and telemetry
 * mechanics suites so that editing one skill does not select those suites.
 *
 * Moved from tests/setup-hosts.test.ts and tests/telemetry.test.ts with their assertions unchanged. Each test is
 * keyed to a skill's own text: hardcoded install paths, the cursor and extend-root resolver copies, the
 * INSTALL_WARN line, the description limit, the telemetry blocks and the documented resume commands.
 * tests/helpers/touchfiles.ts declares `skills/**` for this file, so pregate's literal scan and diff selection map
 * any skill edit here. Skills are read through a computed name; the installer and telemetry suites run on `setup`,
 * their declared `bin/` inputs and full runs instead.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { makeBaseTmp } from './helpers/fixture-repo.ts';
import { EXPECTED_SETUP_SKILLS as SKILLS } from './helpers/expected-setup-skills.ts';
import { extractCanonicalSpan, GUARD_LINE, ROOT_RESOLVER_SKILLS } from './helpers/extend-root.ts';
import { assertSkillDescriptionWithinLimit } from './helpers/skill-description.ts';
import { systemPath } from './helpers/system-path.ts';
import { REAL_GSTACK_ROOT, cleanupTelemetryFixtures, executeSkillBlock, makeTelemetryFixture } from './helpers/telemetry-env.ts';

const ROOT = join(import.meta.dir, '..');
const SETUP = join(ROOT, 'setup');
const HAS_GSTACK = existsSync(REAL_GSTACK_ROOT);

// Hundreds of fixture homes are removed here; the default 5 s hook limit is too tight on a loaded machine.
// docs/telemetry.md requires this hook of every test file that makes a telemetry fixture.
afterAll(cleanupTelemetryFixtures, 60_000);

const baseTmp = makeBaseTmp('skill-content-');
afterAll(() => {
  try { rmSync(baseTmp, { recursive: true, force: true }); } catch {}
});

const skillPath = (name: string): string => join(ROOT, 'skills', `${name}.md`);

// Local copies of the helpers in tests/setup-hosts.test.ts: a test file cannot import another test file without
// running its tests.
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
  return `${bins}:${systemPath(baseTmp)}`;
}

function hostDir(home: string, host: 'claude' | 'codex' | 'opencode' | 'cursor'): string {
  if (host === 'claude') return join(home, '.claude', 'skills');
  if (host === 'codex') return join(home, '.codex', 'skills');
  if (host === 'cursor') return join(home, '.cursor', 'skills');
  return join(home, '.config', 'opencode', 'skills');
}

describe('skill sources', () => {
  // Generated copies keep source paths verbatim, so a Claude-only sibling path would ship to every host.
  test('skill sources never hardcode a ~/.claude/skills/ path', () => {
    for (const skill of SKILLS) {
      expect(readFileSync(skillPath(skill), 'utf8')).not.toContain('~/.claude/skills/');
    }
  });

  test('--host cursor preserves skill bodies and strips allowed-tools from all skills', () => {
    const home = join(baseTmp, 'cursor-explicit');
    mkdirSync(home, { recursive: true });
    expect(runSetup(['--host', 'cursor', '--quiet'], home, isolatedPath(), true).exitCode).toBe(0);
    for (const skill of SKILLS) {
      const dir = join(hostDir(home, 'cursor'), skill);
      const skillMd = join(dir, 'SKILL.md');
      const source = readFileSync(skillPath(skill), 'utf8');
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

  test('generated host copies carry the extend-root resolver', () => {
    for (const host of ['codex', 'opencode', 'cursor'] as const) {
      const home = join(baseTmp, `resolver-copy-${host}`);
      mkdirSync(home, { recursive: true });
      const r = runSetup(['--host', host], home);
      expect(r.exitCode).toBe(0);
      for (const skill of ROOT_RESOLVER_SKILLS) {
        const source = readFileSync(skillPath(skill), 'utf8');
        const copy = readFileSync(join(hostDir(home, host), skill, 'SKILL.md'), 'utf8');
        expect(copy).toContain(`_ER_SKILL=${skill}`);
        expect(extractCanonicalSpan(copy)).toBe(extractCanonicalSpan(source));
        expect(copy.split(GUARD_LINE).length - 1).toBe(source.split(GUARD_LINE).length - 1);
      }
    }
  });

  // Split out of the M7 recovery test in tests/setup-hosts.test.ts, which keeps its docs assertions.
  test('gstack-extend-upgrade keeps INSTALL_WARN outside its shared upgrade-flow block', () => {
    const skill = readFileSync(skillPath('gstack-extend-upgrade'), 'utf8');
    const shared = skill.split('<!-- SHARED:upgrade-flow -->')[1]!.split('<!-- /SHARED:upgrade-flow -->')[0]!;
    expect(shared).not.toContain('INSTALL_WARN');
    expect(skill).toContain('INSTALL_WARN');
    expect(skill).toContain('Tracks 27A and 27B');
  });
});

describe('source skill descriptions fit Codex limit', () => {
  for (const skill of SKILLS) {
    test(`${skill} description ≤ 1024`, () => {
      const path = skillPath(skill);
      const src = readFileSync(path, 'utf8');
      const description = assertSkillDescriptionWithinLimit(src, relative(ROOT, path));
      expect(description.length).toBeLessThanOrEqual(1024);
    });
  }
});

describe('writer and reader agree for every installed skill', () => {
  for (const mode of ['stub', 'real'] as const) {
    test.if(mode === 'stub' || HAS_GSTACK)("each skill's own blocks produce a v1 start/finish pair the doctor counts as paired (" + mode + ')', () => {
      const fix = makeTelemetryFixture('community', mode);
      for (const skill of SKILLS) {
        const path = skillPath(skill);
        expect(executeSkillBlock(fix.env, 'start', path).status).toBe(0);
        expect(executeSkillBlock(fix.env, 'finish', path).status).toBe(0);
      }
      const rows = fix.readJsonl();
      expect(rows).toHaveLength(SKILLS.length * 2);
      const doctor = spawnSync(join(ROOT, 'bin/gstack-extend'), ['doctor', 'telemetry', '--json'], { env: fix.env, encoding: 'utf8', timeout: 20_000 });
      expect(doctor.status).toBe(0);
      const report = JSON.parse(doctor.stdout);
      for (const skill of SKILLS) {
        const own = rows.filter(row => row.skill === 'extend:' + skill);
        expect(own.map(row => row.event_type)).toEqual(['skill_start', 'skill_run']);
        expect(own[1].session_id).toBe(own[0].session_id);
        expect(report.skills.find((entry: { skill: string }) => entry.skill === skill)).toMatchObject({
          activations: 1, completions: 1, paired: 1, denominator: 1, pairing_percent: 100, status: 'paired',
          unpaired_start: 0, unpaired_finish: 0, deferred_finish: 0, legacy: 0,
        });
      }
      // The same blocks leave one provenance row per run, named by the bare skill.
      expect(fix.readLedger().map(row => row.stage)).toEqual([...SKILLS]);
    }, 60_000);
  }
});

describe('handoff adoption', () => {
  test('RESUMABLE is exactly the skills that document their own resume command', () => {
    const source = readFileSync(join(ROOT, 'bin/lib/telemetry.py'), 'utf8');
    const body = source.match(/RESUMABLE = \{([^}]+)\}/)?.[1] ?? '';
    const names = [...body.matchAll(/"([a-z0-9-]+)"/g)].map(match => match[1]);
    expect([...names].sort()).toEqual(['full-review', 'pair-review', 'review-and-prep']);
    for (const name of names) expect([...SKILLS]).toContain(name);
    for (const file of readdirSync(join(ROOT, 'skills'))) {
      if (!file.endsWith('.md')) continue;
      const name = file.slice(0, -'.md'.length);
      const documentsResume = readFileSync(skillPath(name), 'utf8').includes('`/' + name + ' resume`');
      expect(names.includes(name)).toBe(documentsResume);
    }
  });
});
