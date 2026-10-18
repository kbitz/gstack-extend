/**
 * init-registry.test.ts — unit tests for bin/lib/projects-registry.sh.
 *
 * Exercises registry_path, registry_init, registry_validate,
 * registry_upsert, registry_has_slug, registry_slugs_for_path,
 * registry_get, registry_list.
 *
 * Atomic-write invariant: registry_upsert writes via temp+rename and
 * leaves valid JSON on the file at every observable moment. Last-write-
 * wins on concurrent invocations (documented limitation).
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeBaseTmp } from './helpers/fixture-repo.ts';
import { mkScope } from './helpers/init-scope.ts';

const ROOT = join(import.meta.dir, '..');
const LIB = join(ROOT, 'bin', 'lib', 'projects-registry.sh');

const baseTmp = makeBaseTmp('init-registry-');
afterAll(() => {
  try { rmSync(baseTmp, { recursive: true, force: true }); } catch {}
});

function scope(name: string) {
  return mkScope(baseTmp, name).state;
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

  test('upsert on existing slug replaces in place and keeps created_at', () => {
    const s = scope('upsert-replace');
    shell(s, `registry_upsert p1 N1 /p1 "" main 4-digit 2026-05-16T12:00:00Z`);
    shell(s, `registry_upsert p2 N2 /p2 "" main 4-digit 2026-05-16T12:00:00Z`);
    shell(s, `registry_upsert p1 N1-updated /p1-new "" main 4-digit 2026-05-17T12:00:00Z`);
    const reg = JSON.parse(readFileSync(join(s, 'projects.json'), 'utf8'));
    expect(reg.projects).toHaveLength(2);
    const p1 = reg.projects.find((p: { slug: string }) => p.slug === 'p1');
    expect(p1.name).toBe('N1-updated');
    expect(p1.path).toBe('/p1-new');
    expect(p1.created_at).toBe('2026-05-16T12:00:00Z');
  });

  test('upsert with a new slug at the same path replaces that entry', () => {
    const s = scope('upsert-slug-change');
    shell(s, `registry_upsert demo demo /x/demo "" main 4-digit 2026-01-01T00:00:00Z`);
    shell(s, `registry_upsert other other /x/other "" main 4-digit 2026-01-02T00:00:00Z`);
    const r = shell(
      s,
      `registry_upsert owner-demo demo-renamed /x/demo https://example.com/owner/demo.git trunk 4-digit 2026-06-01T00:00:00Z`,
    );
    expect(r.exitCode).toBe(0);
    const reg = JSON.parse(readFileSync(join(s, 'projects.json'), 'utf8'));
    expect(reg.projects.map((p: { slug: string }) => p.slug).sort()).toEqual(['other', 'owner-demo']);
    expect(reg.projects.find((p: { slug: string }) => p.slug === 'owner-demo')).toEqual({
      slug: 'owner-demo',
      name: 'demo-renamed',
      path: '/x/demo',
      remote_url: 'https://example.com/owner/demo.git',
      base_branch: 'trunk',
      version_scheme: '4-digit',
      created_at: '2026-01-01T00:00:00Z',
    });
  });

  // Value (legacy-demo and demo-app rows): protects=the kept created_at is the earliest
  //   of the replaced entries, and a nested project path is never replaced;
  //   fails_when=created_at comes from the first or last match, or path matching becomes
  //   prefix/regex and deletes /x/demo/app; why_new=the earliest match was also the first,
  //   and no fixture path nested another; seam=none; no_claim=CLI wiring (unit, real jq).
  test('upsert collapses duplicate entries for one path and keeps the earliest created_at', () => {
    const s = scope('upsert-collapse');
    const row = (slug: string, path: string, created_at: string) => ({
      slug, name: slug, path, remote_url: null, base_branch: 'main', version_scheme: '4-digit', created_at,
    });
    writeFileSync(join(s, 'projects.json'), JSON.stringify({
      projects: [
        row('demo', '/x/demo', '2026-02-01T00:00:00Z'),
        row('other', '/x/other', '2026-01-01T00:00:00Z'),
        row('legacy-demo', '/x/demo', '2026-01-15T00:00:00Z'),
        row('demo-app', '/x/demo/app', '2026-01-10T00:00:00Z'),
        row('owner-demo', '/x/demo', '2026-03-01T00:00:00Z'),
      ],
    }));
    const r = shell(s, `registry_upsert owner-demo demo /x/demo "" main 4-digit 2026-09-01T00:00:00Z`);
    expect(r.exitCode).toBe(0);
    const reg = JSON.parse(readFileSync(join(s, 'projects.json'), 'utf8'));
    expect(reg.projects.filter((p: { path: string }) => p.path === '/x/demo')).toEqual([
      { ...row('owner-demo', '/x/demo', '2026-01-15T00:00:00Z'), name: 'demo' },
    ]);
    expect(reg.projects.map((p: { slug: string }) => p.slug)).toEqual(['other', 'demo-app', 'owner-demo']);
    expect(reg.projects[1]).toEqual(row('demo-app', '/x/demo/app', '2026-01-10T00:00:00Z'));
  });

  // Value: protects=keep never discards a real created_at because another matched row lacks
  //   one, and uses the supplied value when no matched row has a string created_at;
  //   fails_when=`| strings` is dropped (jq min ranks null first, so null // $created replaces
  //   the real date, and a lone numeric value is kept); why_new=every fixture row had a string
  //   created_at; seam=none; no_claim=CLI wiring (unit, real jq).
  test('keep policy skips missing, null and non-string created_at values', () => {
    const s = scope('upsert-keep-nonstring');
    const row = (slug: string, path: string) => ({
      slug, name: slug, path, remote_url: null, base_branch: 'main', version_scheme: '4-digit',
    });
    writeFileSync(join(s, 'projects.json'), JSON.stringify({
      projects: [
        row('demo', '/x/demo'),
        { ...row('legacy-demo', '/x/demo'), created_at: '2026-02-01T00:00:00Z' },
        { ...row('owner-demo', '/x/demo'), created_at: null },
        row('app', '/y/app'),
        { ...row('legacy-app', '/y/app'), created_at: null },
        { ...row('tool', '/z/tool'), created_at: 1700000000 },
      ],
    }));
    for (const call of [
      'registry_upsert owner-demo owner-demo /x/demo "" main 4-digit 2026-09-01T00:00:00Z',
      'registry_upsert app app /y/app "" main 4-digit 2026-09-02T00:00:00Z keep',
      'registry_upsert tool tool /z/tool "" main 4-digit 2026-09-03T00:00:00Z',
    ]) {
      const r = shell(s, call);
      expect(r.exitCode, r.stderr).toBe(0);
    }
    const reg = JSON.parse(readFileSync(join(s, 'projects.json'), 'utf8'));
    expect(reg.projects).toEqual([
      { ...row('owner-demo', '/x/demo'), created_at: '2026-02-01T00:00:00Z' },
      { ...row('app', '/y/app'), created_at: '2026-09-02T00:00:00Z' },
      { ...row('tool', '/z/tool'), created_at: '2026-09-03T00:00:00Z' },
    ]);
  });

  // Value: protects=keep ignores empty and non-UTC created_at strings, so a valid UTC date
  //   wins and a lone empty value falls back to the supplied one; fails_when=the timestamp
  //   format filter is dropped and "" (which sorts first) is kept forever; why_new=the
  //   non-string test had no empty or offset strings; seam=none; no_claim=CLI wiring.
  test('keep policy ignores empty and non-UTC created_at strings', () => {
    const s = scope('upsert-keep-malformed');
    const row = (slug: string, path: string, created_at: string) => ({
      slug, name: slug, path, remote_url: null, base_branch: 'main', version_scheme: '4-digit', created_at,
    });
    writeFileSync(join(s, 'projects.json'), JSON.stringify({
      projects: [
        row('demo', '/x/demo', ''),
        row('legacy-demo', '/x/demo', '2026-01-01T05:00:00+05:00'),
        row('owner-demo', '/x/demo', '2026-03-01T00:00:00Z'),
        // Right length, wrong shape: a space where the T goes. Pins the position checks,
        // since "" and the offset value already fail on length alone.
        row('legacy2-demo', '/x/demo', '2026-01-01 00:00:00Z'),
        row('app', '/y/app', ''),
      ],
    }));
    for (const call of [
      'registry_upsert owner-demo owner-demo /x/demo "" main 4-digit 2026-09-01T00:00:00Z keep',
      'registry_upsert app app /y/app "" main 4-digit 2026-09-02T00:00:00Z keep',
    ]) {
      const r = shell(s, call);
      expect(r.exitCode, r.stderr).toBe(0);
    }
    const reg = JSON.parse(readFileSync(join(s, 'projects.json'), 'utf8'));
    expect(reg.projects).toEqual([
      row('owner-demo', '/x/demo', '2026-03-01T00:00:00Z'),
      row('app', '/y/app', '2026-09-02T00:00:00Z'),
    ]);
  });

  // Value: protects=the registry's jq programs need no regex support, so --migrate and setup's
  //   self-registration work on jq builds without Oniguruma; fails_when=a test()/match()/sub()
  //   style builtin is reintroduced; why_new=CI's jq has regex, so a runtime test cannot catch it;
  //   seam=none; no_claim=the jq programs in other bins.
  test('registry jq programs use no regex builtins', () => {
    const code = readFileSync(LIB, 'utf8').split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
    expect(code).not.toMatch(/\b(test|match|capture|scan|splits|sub|gsub)\(/);
  });

  test('fresh policy replaces matching entries but stamps the supplied created_at', () => {
    const s = scope('upsert-fresh');
    shell(s, `registry_upsert api api /a/api "" main 4-digit 2019-06-01T00:00:00Z`);
    shell(s, `registry_upsert stale stale /b/api "" main 4-digit 2019-07-01T00:00:00Z`);
    const r = shell(s, `registry_upsert api api /b/api "" main 4-digit 2026-10-18T00:00:00Z fresh`);
    expect(r.exitCode).toBe(0);
    const reg = JSON.parse(readFileSync(join(s, 'projects.json'), 'utf8'));
    expect(reg.projects).toHaveLength(1);
    expect(reg.projects[0]).toMatchObject({ slug: 'api', path: '/b/api', created_at: '2026-10-18T00:00:00Z' });

    const bad = shell(s, `registry_upsert api api /b/api "" main 4-digit 2026-10-18T00:00:00Z sometimes`);
    expect(bad.exitCode).not.toBe(0);
    expect(bad.stderr).toContain('created_at policy must be keep or fresh');
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

  test('slugs_for_path prints every slug at a path; exits 1 for none, 2 for corrupt', () => {
    const s = scope('slugs-for-path');
    expect(shell(s, 'registry_slugs_for_path /x/demo').exitCode).toBe(1);
    // Value (demo-app row and /x/dem probe): protects=lookup is an exact path match;
    //   fails_when=matching becomes prefix or regex, so a nested project or a parent path
    //   counts as registered; why_new=no fixture path nested or prefixed another;
    //   seam=none; no_claim=CLI onboarded detection (unit, real jq).
    // Value (null-slug rows): protects=the (was: ...) label and path-based onboarded
    //   detection only see string slugs; fails_when=`| strings` is dropped and "null" is
    //   printed; why_new=every fixture slug was a string; seam=none; no_claim=how upsert
    //   handles non-string rows.
    writeFileSync(join(s, 'projects.json'), JSON.stringify({
      projects: [
        { slug: 'demo', path: '/x/demo' },
        { slug: 'demo-app', path: '/x/demo/app' },
        { slug: null, path: '/x/demo' },
        { slug: 'other', path: '/x/other' },
        { slug: 'owner-demo', path: '/x/demo' },
        { slug: null, path: '/x/unnamed' },
      ],
    }));
    expect(shell(s, 'registry_slugs_for_path /x/dem').exitCode).toBe(1);
    const hit = shell(s, 'registry_slugs_for_path /x/demo');
    expect(hit.exitCode).toBe(0);
    expect(hit.stdout).toBe('demo\nowner-demo\n');
    const nullOnly = shell(s, 'registry_slugs_for_path /x/unnamed');
    expect(nullOnly.exitCode).toBe(1);
    expect(nullOnly.stdout).toBe('');
    expect(shell(s, 'registry_slugs_for_path /x/none').exitCode).toBe(1);
    expect(shell(s, 'registry_slugs_for_path ""').exitCode).toBe(2);
    writeFileSync(join(s, 'projects.json'), '{not json');
    expect(shell(s, 'registry_slugs_for_path /x/demo').exitCode).toBe(2);
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
      // Distinct paths: one path is one project, so a shared path would replace.
      shell(s, `registry_upsert proj${i} N /p${i} "" main 4-digit 2026-05-16T12:00:00Z`);
      // After each upsert, the file MUST be valid JSON. mv is the atomic
      // step; a partial write would surface as a JSON.parse exception here.
      const reg = JSON.parse(readFileSync(join(s, 'projects.json'), 'utf8'));
      expect(reg.projects.length).toBe(i + 1);
    }
  });
});

describe('concurrent registry upserts', () => {
  test('eight async writers leave a committed row while another is pending', async () => {
    const scoped = mkScope(baseTmp, 'concurrent');
    const regPath = join(scoped.state, 'projects.json');
    const sentinel = {
      slug: 'sentinel',
      name: 'Sentinel',
      path: '/sentinel',
      remote_url: null,
      base_branch: 'main',
      version_scheme: '4-digit',
      created_at: '2020-01-01T00:00:00Z',
    };
    writeFileSync(regPath, `${JSON.stringify({ projects: [sentinel] })}\n`);
    const readyDir = join(scoped.home, 'ready');
    const startFile = join(scoped.home, 'start');
    const waveFile = join(scoped.home, 'wave2');
    const releaseFile = join(scoped.home, 'release');
    mkdirSync(readyDir, { recursive: true });

    const writers = [
      { slug: 'shared', name: 'shared-a' },
      { slug: 'shared', name: 'shared-b' },
      { slug: 'w0', name: 'writer-0' },
      { slug: 'w1', name: 'writer-1' },
      { slug: 'w2', name: 'writer-2' },
      { slug: 'w3', name: 'writer-3' },
      { slug: 'w4', name: 'writer-4' },
      { slug: 'w5', name: 'writer-5' },
    ];
    const known = new Map<string, Set<string>>();
    known.set('sentinel', new Set(['Sentinel']));
    for (const writer of writers) {
      const names = known.get(writer.slug) ?? new Set<string>();
      names.add(writer.name);
      known.set(writer.slug, names);
    }

    const children: Array<{
      child: ReturnType<typeof spawn>;
      closed: boolean;
      closedPromise: Promise<void>;
      exitCode: number | null;
      stdout: string;
      stderr: string;
      error?: Error;
    }> = [];
    const cleanupErrors: string[] = [];
    const deadline = Date.now() + 10_000;
    const poll = () => new Promise<void>((resolve) => setTimeout(resolve, 15));

    const script = `
set -euo pipefail
source "$LIB"
touch "$READY/$I"
while [ ! -f "$START" ]; do sleep 0.02; done
if [ "$I" = "7" ]; then
  while [ ! -f "$WAVE" ]; do sleep 0.02; done
fi
registry_upsert "$SLUG" "$NAME" "/p/$NAME" "" main 4-digit 2026-01-01T00:00:00Z
touch "$READY/done-$I"
while [ ! -f "$RELEASE" ]; do sleep 0.02; done
`;

    function assertSnapshot(raw: string, duringOverlap: boolean) {
      const doc = JSON.parse(raw) as { projects: Array<Record<string, string | null>> };
      expect(Array.isArray(doc.projects)).toBe(true);
      const slugs = doc.projects.map((row) => row.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
      expect(slugs).toContain('sentinel');
      let submitted = 0;
      for (const row of doc.projects) {
        const names = known.get(String(row.slug));
        expect(names, `unexpected slug ${row.slug}`).toBeDefined();
        expect(names?.has(String(row.name))).toBe(true);
        expect(row.path).toBe(row.slug === 'sentinel' ? '/sentinel' : `/p/${row.name}`);
        expect(row.base_branch).toBe('main');
        expect(row.version_scheme).toBe('4-digit');
        expect(row.remote_url).toBeNull();
        expect(row.created_at).toBe(row.slug === 'sentinel' ? sentinel.created_at : '2026-01-01T00:00:00Z');
        expect(Object.keys(row).sort()).toEqual(Object.keys(sentinel).sort());
        if (row.slug !== 'sentinel') submitted += 1;
      }
      if (!duringOverlap) expect(submitted).toBeGreaterThanOrEqual(1);
      return submitted;
    }

    function signalGroups(signal: NodeJS.Signals) {
      for (const { child } of children) {
        if (!child.pid) continue;
        try { process.kill(-child.pid, signal); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
            cleanupErrors.push(`${signal} ${child.pid}: ${error}`);
          }
        }
      }
    }

    try {
      for (let i = 0; i < writers.length; i++) {
        const child = spawn('bash', ['-c', script], {
          detached: true,
          env: {
            PATH: process.env.PATH ?? '/usr/bin:/bin',
            HOME: scoped.home,
            GSTACK_EXTEND_STATE_DIR: scoped.state,
            GSTACK_STATE_ROOT: scoped.groot,
            LIB,
            READY: readyDir,
            START: startFile,
            WAVE: waveFile,
            RELEASE: releaseFile,
            I: String(i),
            SLUG: writers[i]!.slug,
            NAME: writers[i]!.name,
          },
        });
        const record = {
          child, closed: false, closedPromise: Promise.resolve(),
          exitCode: null as number | null, stdout: '', stderr: '', error: undefined as Error | undefined,
        };
        record.closedPromise = new Promise<void>((resolve) => {
          child.once('close', (code) => {
            record.closed = true;
            record.exitCode = code;
            resolve();
          });
        });
        child.once('error', (error) => { record.error = error; });
        child.stdout?.on('data', (chunk) => { record.stdout += String(chunk); });
        child.stderr?.on('data', (chunk) => { record.stderr += String(chunk); });
        children.push(record);
      }

      while (readdirSync(readyDir).filter((name) => /^\d+$/.test(name)).length < 8) {
        const failed = children.find((record) => record.error || record.closed);
        if (failed) throw new Error(`writer failed before readiness: ${failed.error ?? failed.stderr}`);
        if (Date.now() > deadline) throw new Error('writers did not become ready within the workload deadline');
        await poll();
      }
      writeFileSync(startFile, 'go\n');

      let sawPending = false;
      let liveSamples = 0;
      while (children.some((record) => !record.closed)) {
        const failed = children.find((record) => record.error || (record.closed && record.exitCode !== 0));
        if (failed) throw new Error(`writer failed: ${failed.error ?? failed.stderr}`);
        if (Date.now() > deadline) throw new Error('writers exceeded the 10s workload deadline');
        // Every observed snapshot must be valid. Never retry a torn write or
        // swallow an assertion, even if a later writer repairs the document.
        const liveSubmitted = assertSnapshot(readFileSync(regPath, 'utf8'), true);
        liveSamples += 1;
        const latePending = !existsSync(join(readyDir, 'done-7'));
        if (!sawPending && liveSubmitted >= 1 && latePending) {
          sawPending = true;
          writeFileSync(waveFile, 'go\n');
          writeFileSync(releaseFile, 'go\n');
        }
        await poll();
      }
      expect(sawPending).toBe(true);
      expect(liveSamples).toBeGreaterThan(0);
      expect(children).toHaveLength(8);
      for (const record of children) {
        expect(record.error).toBeUndefined();
        expect(record.exitCode, record.stderr).toBe(0);
      }
      assertSnapshot(readFileSync(regPath, 'utf8'), false);
      const temps = readdirSync(scoped.state).filter((name) => name.includes('.tmp.'));
      expect(temps).toEqual([]);
      console.info(`registry concurrency: ${liveSamples} valid live snapshots, committed row with writer pending, 8 exits checked`);
    } finally {
      if (children.some((record) => !record.closed)) {
        signalGroups('SIGTERM');
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        signalGroups('SIGKILL');
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const closed = await Promise.race([
          Promise.all(children.map((record) => record.closedPromise)).then(() => true),
          new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), 5_000); }),
        ]);
        if (!closed) cleanupErrors.push('children did not close their stdio within the 5s cleanup deadline');
      } finally {
        clearTimeout(timer);
      }
      if (cleanupErrors.length > 0) throw new Error(cleanupErrors.join('\n'));
    }
  }, 30_000);
});
