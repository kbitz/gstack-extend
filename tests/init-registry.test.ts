/**
 * init-registry.test.ts — unit tests for bin/lib/projects-registry.sh.
 *
 * Exercises registry_path, registry_init, registry_validate,
 * registry_upsert, registry_has_slug, registry_get, registry_list.
 *
 * Atomic-write invariant: registry_upsert writes via temp+rename and
 * leaves valid JSON on the file at every observable moment. Last-write-
 * wins on concurrent invocations (documented limitation).
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeBaseTmp } from './helpers/fixture-repo.ts';

const ROOT = join(import.meta.dir, '..');
const LIB = join(ROOT, 'bin', 'lib', 'projects-registry.sh');

const baseTmp = makeBaseTmp('init-registry-');
afterAll(() => {
  try { rmSync(baseTmp, { recursive: true, force: true }); } catch {}
});

function scope(name: string) {
  const state = join(baseTmp, name);
  mkdirSync(state, { recursive: true });
  return state;
}

// Source the lib and run a snippet of bash. Returns exit + stdout + stderr.
function shell(state: string, snippet: string): { exitCode: number; stdout: string; stderr: string } {
  const r = spawnSync('bash', ['-c', `source "$0"; ${snippet}`, LIB], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: state, // any HOME — registry path is overridden below
      GSTACK_EXTEND_STATE_DIR: state,
    },
  });
  return {
    exitCode: r.status ?? -1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

describe('registry_path', () => {
  test('honors GSTACK_EXTEND_STATE_DIR', () => {
    const s = scope('path');
    const r = shell(s, 'registry_path');
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(join(s, 'projects.json'));
  });
});

describe('registry_init', () => {
  test('creates empty {projects: []} when missing', () => {
    const s = scope('init-empty');
    const r = shell(s, 'registry_init');
    expect(r.exitCode).toBe(0);
    const content = JSON.parse(readFileSync(join(s, 'projects.json'), 'utf8'));
    expect(content).toEqual({ projects: [] });
  });

  test('is a no-op when registry already exists', () => {
    const s = scope('init-noop');
    const path = join(s, 'projects.json');
    writeFileSync(path, '{"projects":[{"slug":"existing","name":"x"}]}');
    const r = shell(s, 'registry_init');
    expect(r.exitCode).toBe(0);
    const content = JSON.parse(readFileSync(path, 'utf8'));
    expect(content.projects).toHaveLength(1);
    expect(content.projects[0].slug).toBe('existing');
  });
});

describe('registry_validate', () => {
  test('rejects corrupt JSON with stderr path hint', () => {
    const s = scope('validate-corrupt');
    writeFileSync(join(s, 'projects.json'), '{not valid json');
    const r = shell(s, 'registry_validate');
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('not valid JSON');
    expect(r.stderr).toContain(join(s, 'projects.json'));
  });

  test('rejects missing .projects array', () => {
    const s = scope('validate-shape');
    writeFileSync(join(s, 'projects.json'), '{"foo": 1}');
    const r = shell(s, 'registry_validate');
    expect(r.exitCode).not.toBe(0);
  });

  test('accepts a well-formed empty registry', () => {
    const s = scope('validate-ok');
    writeFileSync(join(s, 'projects.json'), '{"projects":[]}');
    const r = shell(s, 'registry_validate');
    expect(r.exitCode).toBe(0);
  });
});

describe('registry_upsert', () => {
  test('appends a new entry with all v1 fields', () => {
    const s = scope('upsert-new');
    const r = shell(
      s,
      `registry_upsert myproj "My Project" /path/to/myproj https://example.com/myproj.git main 4-digit 2026-05-16T12:00:00Z`,
    );
    expect(r.exitCode).toBe(0);
    const reg = JSON.parse(readFileSync(join(s, 'projects.json'), 'utf8'));
    expect(reg.projects).toHaveLength(1);
    expect(reg.projects[0]).toEqual({
      slug: 'myproj',
      name: 'My Project',
      path: '/path/to/myproj',
      remote_url: 'https://example.com/myproj.git',
      base_branch: 'main',
      version_scheme: '4-digit',
      created_at: '2026-05-16T12:00:00Z',
    });
  });

  test('empty remote_url becomes JSON null', () => {
    const s = scope('upsert-null-remote');
    const r = shell(s, `registry_upsert p n /tmp/p "" main 4-digit 2026-05-16T12:00:00Z`);
    expect(r.exitCode).toBe(0);
    const reg = JSON.parse(readFileSync(join(s, 'projects.json'), 'utf8'));
    expect(reg.projects[0].remote_url).toBeNull();
  });

  test('upsert on existing slug replaces in place (idempotent)', () => {
    const s = scope('upsert-replace');
    shell(s, `registry_upsert p1 N1 /p1 "" main 4-digit 2026-05-16T12:00:00Z`);
    shell(s, `registry_upsert p2 N2 /p2 "" main 4-digit 2026-05-16T12:00:00Z`);
    shell(s, `registry_upsert p1 N1-updated /p1-new "" main 4-digit 2026-05-17T12:00:00Z`);
    const reg = JSON.parse(readFileSync(join(s, 'projects.json'), 'utf8'));
    expect(reg.projects).toHaveLength(2);
    const p1 = reg.projects.find((p: { slug: string }) => p.slug === 'p1');
    expect(p1.name).toBe('N1-updated');
    expect(p1.path).toBe('/p1-new');
    expect(p1.created_at).toBe('2026-05-17T12:00:00Z');
  });

  test('missing required argument fails with stderr', () => {
    const s = scope('upsert-missing');
    const r = shell(s, `registry_upsert p1 "" /p1 "" main 4-digit 2026-05-16T12:00:00Z`);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('missing required argument');
  });

  test('refuses to overwrite a corrupt registry', () => {
    const s = scope('upsert-corrupt');
    writeFileSync(join(s, 'projects.json'), '{not json');
    const r = shell(s, `registry_upsert p1 N1 /p1 "" main 4-digit 2026-05-16T12:00:00Z`);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('not valid JSON');
    // Original corrupt content is left as-is for the user to inspect.
    expect(readFileSync(join(s, 'projects.json'), 'utf8')).toBe('{not json');
  });
});

describe('registry_has_slug / registry_get / registry_list', () => {
  test('has_slug exits 0 for present, 1 for absent', () => {
    const s = scope('has-slug');
    shell(s, `registry_upsert p1 N /p1 "" main 4-digit 2026-05-16T12:00:00Z`);
    expect(shell(s, 'registry_has_slug p1').exitCode).toBe(0);
    expect(shell(s, 'registry_has_slug p2').exitCode).toBe(1);
  });

  test('get prints the entry JSON; exits 1 if not found', () => {
    const s = scope('get');
    shell(s, `registry_upsert p1 N1 /p1 "" main 4-digit 2026-05-16T12:00:00Z`);
    const got = shell(s, 'registry_get p1');
    expect(got.exitCode).toBe(0);
    expect(JSON.parse(got.stdout.trim())).toMatchObject({ slug: 'p1', name: 'N1' });

    const miss = shell(s, 'registry_get nope');
    expect(miss.exitCode).toBe(1);
  });

  test('list prints all slugs sorted, one per line', () => {
    const s = scope('list');
    shell(s, `registry_upsert zeta z /z "" main 4-digit 2026-05-16T12:00:00Z`);
    shell(s, `registry_upsert alpha a /a "" main 4-digit 2026-05-16T12:00:00Z`);
    shell(s, `registry_upsert mike m /m "" main 4-digit 2026-05-16T12:00:00Z`);
    const r = shell(s, 'registry_list');
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim().split('\n')).toEqual(['alpha', 'mike', 'zeta']);
  });
});

describe('atomic write invariant', () => {
  test('repeated upserts always leave valid JSON (no torn writes observable in sequential calls)', () => {
    const s = scope('atomic');
    for (let i = 0; i < 25; i++) {
      shell(s, `registry_upsert proj${i} N /p "" main 4-digit 2026-05-16T12:00:00Z`);
      // After each upsert, the file MUST be valid JSON. mv is the atomic
      // step; a partial write would surface as a JSON.parse exception here.
      const reg = JSON.parse(readFileSync(join(s, 'projects.json'), 'utf8'));
      expect(reg.projects.length).toBe(i + 1);
    }
  });
});
