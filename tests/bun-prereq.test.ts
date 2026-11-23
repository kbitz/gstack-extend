import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { BUN_FLOOR as LAYOUT_FLOOR, help as layoutHelp } from '../src/layout-scaffold/cli.ts';
import { BUN_FLOOR as DOCS_SHIP_FLOOR, help as docsShipHelp } from '../src/docs-ship/cli.ts';
import { ERROR_CODES as MERGE_GATE_ERROR_CODES } from '../src/merge-gate/registry.ts';

const REPO_ROOT = resolve(import.meta.dir, '..');
const HELPER = join(REPO_ROOT, 'bin/lib/bun-prereq.sh');
const REAL_BUN = process.execPath;
const BASE_TMP = mkdtempSync(join(tmpdir(), 'bun-prereq-test-'));

// Build a clean PATH directory containing standard POSIX tools (jq, git, dirname, etc.)
// but NEVER `bun`, so missing-Bun tests work even when `bun` lives in `/usr/bin/bun`.
const NO_BUN_PATH = mkdtempSync(join(BASE_TMP, 'no-bun-path-'));
for (const tool of [
  'dirname', 'basename', 'mktemp', 'jq', 'git', 'cat', 'mv', 'rm', 'cp', 'mkdir',
  'chmod', 'date', 'uname', 'env', 'awk', 'sed', 'grep', 'head', 'tail', 'tr',
  'wc', 'sort', 'cut', 'readlink', 'sh', 'bash', 'id', 'ln', 'touch', 'sleep', 'test', 'printf',
]) {
  const found = spawnSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' });
  const target = found.stdout.trim();
  if (found.status === 0 && target.startsWith('/') && !existsSync(join(NO_BUN_PATH, tool))) {
    symlinkSync(target, join(NO_BUN_PATH, tool));
  }
}

afterAll(() => {
  rmSync(BASE_TMP, { recursive: true, force: true });
});

function freshDir(prefix: string): string {
  return mkdtempSync(join(BASE_TMP, `${prefix}-`));
}

function makeShim(dir: string, script: string): string {
  const path = join(dir, 'bun');
  writeFileSync(path, script, { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}

function makeDelegatingShim(dir: string, reportedVersion: string): string {
  return makeShim(
    dir,
    `#!/bin/sh\nif [ "$#" -eq 1 ] && [ "$1" = "--version" ]; then\n  printf '%s\\n' '${reportedVersion}'\n  exit 0\nfi\nexec '${REAL_BUN}' "$@"\n`,
  );
}

function snapshotTree(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      out.push(`${entry.isDirectory() ? 'd' : entry.isSymbolicLink() ? 'l' : 'f'}:${nextRel}`);
      if (entry.isDirectory()) walk(join(dir, entry.name), nextRel);
    }
  };
  walk(root, '');
  return out.sort();
}

function runProbe(shell: string, env: Record<string, string | undefined>, probeArg?: string) {
  const script = `
set -eu
_bun='sentinel-bun'
IFS=':'
. "$1"
if bun_prereq_probe ${probeArg ? '"$2"' : ''}; then
  rc=0
else
  rc=$?
fi
printf 'RC=%s\\nCLASS=%s\\nTOKEN=%s\\nCODE=%s\\nFOUND=%s\\nPATH=%s\\nIFS_OK=%s\\nBUN_OK=%s\\n' \
  "$rc" "$BUN_PREREQ_CLASS" "$BUN_PREREQ_TOKEN" "$BUN_PREREQ_ERROR_CODE" "$BUN_PREREQ_FOUND" "$BUN_PREREQ_PATH" \
  "$([ "$IFS" = ":" ] && echo yes || echo no)" \
  "$([ "$_bun" = "sentinel-bun" ] && echo yes || echo no)"
`;
  const args = ['-c', script, 'probe', HELPER, ...(probeArg ? [probeArg] : [])];
  const r = spawnSync(shell, args, { env, encoding: 'utf8', timeout: 15_000 });
  const map: Record<string, string> = {};
  for (const line of r.stdout.trim().split('\n')) {
    const idx = line.indexOf('=');
    if (idx > 0) map[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return { status: r.status, stderr: r.stderr, stdout: r.stdout, map };
}

const SHELLS = ['/bin/sh'];
const dashCheck = spawnSync('/bin/sh', ['-c', 'command -v dash'], { encoding: 'utf8' });
if (dashCheck.status === 0 && dashCheck.stdout.trim()) {
  SHELLS.push(dashCheck.stdout.trim());
}

describe('bin/lib/bun-prereq.sh probe unit matrix', () => {
  for (const shell of SHELLS) {
    test(`(${shell}) missing PATH (empty, unset, nonexistent) returns missing and preserves IFS/_bun`, () => {
      for (const env of [{ PATH: '' }, { PATH: '/nonexistent-dir-94h' }]) {
        const r = runProbe(shell, env);
        expect(r.status).toBe(0);
        expect(r.stderr).toBe('');
        expect(r.map.RC).toBe('1');
        expect(r.map.CLASS).toBe('missing');
        expect(r.map.TOKEN).toBe('PREREQ_BUN_MISSING');
        expect(r.map.CODE).toBe('bun_missing');
        expect(r.map.PATH).toBe('not on PATH');
        expect(r.map.IFS_OK).toBe('yes');
        expect(r.map.BUN_OK).toBe('yes');
      }
      // Explicitly unset PATH inside the shell so /bin/sh does not seed a default PATH.
      const unsetRun = spawnSync(
        shell,
        ['-c', 'set -eu; unset PATH; . "$1"; if bun_prereq_probe; then echo OK; else printf "CLASS=%s TOKEN=%s\\n" "$BUN_PREREQ_CLASS" "$BUN_PREREQ_TOKEN"; fi', 'unset-probe', HELPER],
        { env: { PATH: '' }, encoding: 'utf8', timeout: 15_000 },
      );
      expect(unsetRun.status).toBe(0);
      expect(unsetRun.stderr).toBe('');
      expect(unsetRun.stdout.trim()).toBe('CLASS=missing TOKEN=PREREQ_BUN_MISSING');
    });

    test(`(${shell}) version boundary matrix (too_old, at-floor, newer, suffixed, unknown)`, () => {
      const cases: Array<{ label: string; script: string; expectedClass: string; expectedToken: string }> = [
        { label: '1.2.0', script: '#!/bin/sh\necho 1.2.0\n', expectedClass: 'too_old', expectedToken: 'PREREQ_BUN_TOO_OLD' },
        { label: '1.3.2', script: '#!/bin/sh\necho 1.3.2\n', expectedClass: 'too_old', expectedToken: 'PREREQ_BUN_TOO_OLD' },
        { label: '1.3.2-canary.1', script: '#!/bin/sh\necho 1.3.2-canary.1\n', expectedClass: 'too_old', expectedToken: 'PREREQ_BUN_TOO_OLD' },
        { label: '01.03.02', script: '#!/bin/sh\necho 01.03.02\n', expectedClass: 'too_old', expectedToken: 'PREREQ_BUN_TOO_OLD' },
        { label: '1.3', script: '#!/bin/sh\necho 1.3\n', expectedClass: 'too_old', expectedToken: 'PREREQ_BUN_TOO_OLD' },
        { label: '1.3.3', script: '#!/bin/sh\ncase "$1" in --help) echo "  --no-env-file  Disable automatic loading";; *) echo 1.3.3;; esac\n', expectedClass: 'ok', expectedToken: '' },
        { label: 'v1.3.3', script: '#!/bin/sh\ncase "$1" in --help) echo "  --no-env-file  Disable automatic loading";; *) echo v1.3.3;; esac\n', expectedClass: 'ok', expectedToken: '' },
        { label: '1.3.3-canary.1', script: '#!/bin/sh\ncase "$1" in --help) echo "  --no-env-file  Disable automatic loading";; *) echo 1.3.3-canary.1;; esac\n', expectedClass: 'ok', expectedToken: '' },
        { label: '1.3.3+build.9', script: '#!/bin/sh\ncase "$1" in --help) echo "  --no-env-file  Disable automatic loading";; *) echo 1.3.3+build.9;; esac\n', expectedClass: 'ok', expectedToken: '' },
        { label: '01.03.03', script: '#!/bin/sh\ncase "$1" in --help) echo "  --no-env-file  Disable automatic loading";; *) echo 01.03.03;; esac\n', expectedClass: 'ok', expectedToken: '' },
        { label: '1.3.3.0', script: '#!/bin/sh\ncase "$1" in --help) echo "  --no-env-file  Disable automatic loading";; *) echo 1.3.3.0;; esac\n', expectedClass: 'ok', expectedToken: '' },
        { label: 'floor-missing-flag', script: '#!/bin/sh\ncase "$1" in --help) echo "  --env-file  See --no-env-file";; *) echo 1.3.3;; esac\n', expectedClass: 'too_old', expectedToken: 'PREREQ_BUN_TOO_OLD' },
        { label: 'floor-help-fails', script: '#!/bin/sh\ncase "$1" in --help) echo "  --no-env-file"; exit 1;; *) echo 1.3.3;; esac\n', expectedClass: 'too_old', expectedToken: 'PREREQ_BUN_TOO_OLD' },
        { label: '1.4.3', script: '#!/bin/sh\necho 1.4.3\n', expectedClass: 'ok', expectedToken: '' },
        { label: '2.0', script: '#!/bin/sh\necho 2.0\n', expectedClass: 'ok', expectedToken: '' },
        { label: 'exit-nonzero', script: '#!/bin/sh\nexit 42\n', expectedClass: 'unknown', expectedToken: 'PREREQ_BUN_VERSION_UNKNOWN' },
        { label: 'empty-output', script: '#!/bin/sh\nexit 0\n', expectedClass: 'unknown', expectedToken: 'PREREQ_BUN_VERSION_UNKNOWN' },
        { label: 'single-component', script: '#!/bin/sh\necho 1\n', expectedClass: 'unknown', expectedToken: 'PREREQ_BUN_VERSION_UNKNOWN' },
        { label: 'five-components', script: '#!/bin/sh\necho 1.2.3.4.5\n', expectedClass: 'unknown', expectedToken: 'PREREQ_BUN_VERSION_UNKNOWN' },
        { label: 'ten-digit-component', script: '#!/bin/sh\necho 1.1234567890.0\n', expectedClass: 'unknown', expectedToken: 'PREREQ_BUN_VERSION_UNKNOWN' },
        { label: 'non-numeric', script: '#!/bin/sh\necho bogus-version\n', expectedClass: 'unknown', expectedToken: 'PREREQ_BUN_VERSION_UNKNOWN' },
      ];
      for (const c of cases) {
        const dir = freshDir('shim');
        const shim = makeShim(dir, c.script);
        const r = runProbe(shell, { PATH: `${dir}:/usr/bin:/bin` }, shim);
        expect(r.status).toBe(0);
        expect(r.stderr).toBe('');
        expect(r.map.CLASS).toBe(c.expectedClass);
        expect(r.map.TOKEN).toBe(c.expectedToken);
        expect(r.map.IFS_OK).toBe('yes');
        expect(r.map.BUN_OK).toBe('yes');
      }
    });

    test(`(${shell}) hostile probe output is sanitized to [0-9A-Za-z.+/_-] truncated at 64 chars`, () => {
      const dir = freshDir('hostile');
      const longJunk = `bad"quote\\slash$env\`cmd\`${'A'.repeat(100)}\nSECOND_LINE`;
      const shim = makeShim(dir, `#!/bin/sh\nprintf '%s' '${longJunk.replace(/'/g, "'\\''")}'\n`);
      const r = runProbe(shell, { PATH: `${dir}:/usr/bin:/bin` }, shim);
      expect(r.map.CLASS).toBe('unknown');
      expect(r.map.FOUND.length).toBeLessThanOrEqual(64);
      expect(r.map.FOUND).toMatch(/^[0-9A-Za-z.+/_-]+$/);
      expect(r.map.FOUND).not.toContain('SECOND_LINE');
    });
  }
});

type LauncherSpec = {
  name: string;
  family: 'bare' | 'hardened' | 'merge-gate' | 'review-state';
  srcRel: string;
  okArgs: string[];
};

const ALL_LAUNCHERS: LauncherSpec[] = [
  { name: 'roadmap-audit', family: 'bare', srcRel: 'src/audit/cli.ts', okArgs: ['--help'] },
  { name: 'roadmap-pack', family: 'bare', srcRel: 'src/audit/pack-cli.ts', okArgs: ['--help'] },
  { name: 'roadmap-touches', family: 'bare', srcRel: 'src/audit/touches-cli.ts', okArgs: [] },
  { name: 'roadmap-renumber', family: 'bare', srcRel: 'src/audit/renumber-cli.ts', okArgs: [] },
  { name: 'outside-review', family: 'bare', srcRel: 'src/outside-review/cli.ts', okArgs: ['--help'] },
  { name: 'secret-dispositions', family: 'bare', srcRel: 'src/secret-dispositions/cli.ts', okArgs: ['--help'] },
  { name: 'pregate-deps', family: 'bare', srcRel: 'src/pregate-deps/cli.ts', okArgs: ['--help'] },
  { name: 'review-delegate', family: 'bare', srcRel: 'src/review-delegate/cli.ts', okArgs: ['--help'] },
  { name: 'layout-scaffold', family: 'hardened', srcRel: 'src/layout-scaffold/cli.ts', okArgs: ['--help'] },
  { name: 'docs-ship', family: 'hardened', srcRel: 'src/docs-ship/cli.ts', okArgs: ['--help'] },
  { name: 'upstream-check', family: 'hardened', srcRel: 'src/upstream-check/cli.ts', okArgs: ['--help'] },
  { name: 'merge-gate', family: 'merge-gate', srcRel: 'src/merge-gate/cli.ts', okArgs: ['--version', '--json'] },
  { name: 'review-state', family: 'review-state', srcRel: 'src/review-state/cli.ts', okArgs: ['--help'] },
];

describe('all 13 gated bin/ launchers', () => {
  const oldBunDir = freshDir('old-bun');
  makeDelegatingShim(oldBunDir, '1.2.0');
  const badBunDir = freshDir('bad-bun');
  makeShim(badBunDir, `#!/bin/sh
if [ "$#" -eq 1 ] && [ "$1" = "--version" ]; then
  printf 'hostile"\\000\\n\\toutput'
  exit 0
fi
exec '${REAL_BUN}' "$@"
`);
  const floorBunDir = freshDir('floor-bun');
  makeDelegatingShim(floorBunDir, '1.3.3');

  for (const spec of ALL_LAUNCHERS) {
    test(`${spec.name}: missing, too_old, unknown, helper-missing refuse without executing TS; at-floor passes`, () => {
      // Build a scratch mirror of bin/<name> + sentinel TS target to prove TS never runs on refusal.
      const mirror = freshDir(`mirror-${spec.name}`);
      const mirrorBin = join(mirror, 'bin');
      const mirrorLib = join(mirrorBin, 'lib');
      const sentinelSrc = join(mirror, spec.srcRel);
      const sentinelHit = join(mirror, 'ts-ran.marker');
      mkdirSync(mirrorLib, { recursive: true });
      mkdirSync(dirname(sentinelSrc), { recursive: true });
      copyFileSync(join(REPO_ROOT, 'bin', spec.name), join(mirrorBin, spec.name));
      chmodSync(join(mirrorBin, spec.name), 0o755);
      const helper = join(mirrorLib, 'bun-prereq.sh');
      copyFileSync(HELPER, helper);
      writeFileSync(sentinelSrc, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(sentinelHit)}, 'ran');\n`);

      const launcher = join(mirrorBin, spec.name);
      const args = spec.family === 'merge-gate' ? ['--version', '--json'] : ['--help'];

      const checkRefusal = (
        pathEnv: string,
        expectedToken: string,
        expectedCode: string,
        expectedCause: string,
        fragments: string[],
      ) => {
        const r = spawnSync('/bin/sh', [launcher, ...args], { env: { PATH: pathEnv }, encoding: 'utf8', timeout: 15_000 });
        expect(existsSync(sentinelHit)).toBe(false);
        let diagnostic = r.stderr;
        if (spec.family === 'bare') {
          expect(r.status).toBe(1);
          expect(r.stdout).toBe('');
          expect(r.stderr.trim().split('\n')).toHaveLength(1);
          expect(r.stderr).toContain(`${spec.name}: ${expectedToken}`);
        } else if (spec.family === 'hardened') {
          expect(r.status).toBe(5);
          expect(r.stdout).toBe('');
          expect(r.stderr.trim().split('\n')).toHaveLength(2);
          expect(r.stderr).toContain(`ERROR ${expectedCode}: ${expectedToken}`);
          expect(r.stderr).toContain('FIX:');
        } else if (spec.family === 'merge-gate') {
          expect(r.status).toBe(1);
          expect(r.stderr).toBe('');
          const parsed = JSON.parse(r.stdout.trim());
          expect(parsed.error.code).toBe(expectedCode);
          expect(parsed.error.message).toContain(expectedToken);
          diagnostic = parsed.error.message + '\n' + parsed.error.fix;
        } else {
          expect(r.status).toBe(5);
          const parsed = JSON.parse(r.stdout.trim());
          expect(parsed.reason).toBe('internal-error');
          expect(parsed.detail.cause).toBe(expectedCause);
          expect(parsed.detail.message).toContain(expectedToken);
          expect(r.stderr).toContain(`ERROR INTERNAL_ERROR: ${expectedToken}`);
          expect(r.stderr.trim().split('\n')).toHaveLength(2);
          diagnostic = parsed.detail.message + '\n' + parsed.fix;
        }
        expect(diagnostic).toContain(spec.name);
        expect(diagnostic).toContain('1.3.3');
        expect(diagnostic).toContain('No changes were made.');
        expect(diagnostic).toContain('docs/installation.md#requirements');
        expect(diagnostic).toContain(spec.family === 'review-state'
          ? 'then rerun the identical command once'
          : 'then rerun the same command once');
        expect(diagnostic).toContain('if it still refuses, report this line verbatim');
        for (const fragment of fragments) expect(diagnostic).toContain(fragment);
      };

      checkRefusal(NO_BUN_PATH, 'PREREQ_BUN_MISSING', 'bun_missing', 'runtime-missing', [
        'not on', 'curl -fsSL https://bun.sh/install | bash', 'reload your shell or add ~/.bun/bin to PATH',
      ]);
      checkRefusal(`${oldBunDir}:${NO_BUN_PATH}`, 'PREREQ_BUN_TOO_OLD', 'bun_too_old', 'runtime-too-old', [
        'found 1.2.0 at ', 'bun upgrade', 'upgrade via your package manager',
      ]);
      checkRefusal(`${badBunDir}:${NO_BUN_PATH}`, 'PREREQ_BUN_VERSION_UNKNOWN', 'bun_version_unknown', 'runtime-version-unknown', [
        'could not determine version at ', 'saw hostile', 'upgrade or reinstall Bun',
      ]);

      const checkUnavailableHelper = () => {
        const result = spawnSync('/bin/sh', [launcher, ...args], {
          env: { PATH: `${badBunDir}:${NO_BUN_PATH}` },
          encoding: 'utf8',
          timeout: 15_000,
        });
        expect(existsSync(sentinelHit)).toBe(false);
        if (spec.family === 'merge-gate') {
          expect(result.status).toBe(1);
          expect(result.stderr).toBe('');
          const response = JSON.parse(result.stdout.trim());
          expect(response.error.code).toBe('internal_error');
          expect(response.error.message).toContain('PREREQ_HELPER_MISSING');
          expect(response.error.fix).toContain('./setup');
          expect(response.error.fix).toContain('No changes were made.');
        } else {
          expect(result.stderr).toContain('PREREQ_HELPER_MISSING');
          expect(result.stderr).toContain('./setup');
          expect(result.stderr).toContain('No changes were made.');
          expect(result.stderr).not.toContain('hostile');
          if (spec.family === 'review-state') {
            expect(result.status).toBe(5);
            expect(JSON.parse(result.stdout.trim()).detail.message).toContain('PREREQ_HELPER_MISSING');
            expect(result.stderr.trim().split('\n')).toHaveLength(2);
          } else if (spec.family === 'hardened') {
            const upstream = spec.name === 'upstream-check';
            expect(result.status).toBe(upstream ? 1 : 5);
            expect(result.stdout).toBe('');
            expect(result.stderr.trim().split('\n')).toHaveLength(upstream ? 3 : 2);
            expect(result.stderr).toContain('source_missing: PREREQ_HELPER_MISSING');
          } else {
            expect(result.status).toBe(1);
            expect(result.stdout).toBe('');
            expect(result.stderr.trim().split('\n')).toHaveLength(1);
          }
        }
      };
      // Root can still read a file whose mode is 000.
      if (process.geteuid?.() !== 0) {
        chmodSync(helper, 0o000);
        checkUnavailableHelper();
      }
      rmSync(helper);
      checkUnavailableHelper();

      // At-floor delegating shim passes the gate on the real launcher
      const okRun = spawnSync('/bin/sh', [join(REPO_ROOT, 'bin', spec.name), ...spec.okArgs], {
        env: { PATH: `${floorBunDir}:${NO_BUN_PATH}`, HOME: freshDir(`ok-home-${spec.name}`) },
        encoding: 'utf8',
        timeout: 15_000,
      });
      // roadmap-touches / roadmap-renumber exit 1 on empty args with usage text (confirming TS ran, not prereq gate)
      expect(okRun.stderr).not.toContain('PREREQ_BUN_');
      if (spec.okArgs.length > 0) {
        expect(okRun.status).toBe(0);
      } else {
        expect(okRun.stdout + okRun.stderr).toContain('usage:');
      }
    });
  }
});

test('roadmap-pack --stdin passes its draft through the version and floor help probes', () => {
  const repo = freshDir('pack-stdin');
  const shimDir = freshDir('stdin-shim');
  makeShim(shimDir, [
    '#!/bin/sh',
    'case "$1" in',
    '  --version|--help) if IFS= read -r line; then exit 99; fi ;;',
    'esac',
    'case "$1" in',
    '  --version) printf "%s\\n" 1.3.3 ;;',
    '  --help) printf "%s\\n" "  --no-env-file  Disable automatic loading" ;;',
    '  *) exec "$TEST_REAL_BUN" "$@" ;;',
    'esac',
    '',
  ].join('\n'));
  const result = spawnSync('/bin/sh', [join(REPO_ROOT, 'bin/roadmap-pack'), '--stdin', repo], {
    env: { PATH: `${shimDir}:${NO_BUN_PATH}`, TEST_REAL_BUN: REAL_BUN },
    input: '## Current Plan\n##### Track 1A: Draft from stdin\n_touches: src/a.ts_\n- **Do a** -- body (S)\n',
    encoding: 'utf8',
    timeout: 15_000,
  });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('CRITICAL_PATH: 1 waves through 1A');
});

describe('setup prerequisite gate and install hint', () => {
  test('missing Bun prints checksum hint that passes bun-v<ver> as first argument to installer', () => {
    const home = freshDir('setup-missing-home');
    const before = snapshotTree(home);
    const r = spawnSync('/bin/bash', [join(REPO_ROOT, 'setup'), '--host', 'claude'], {
      env: { HOME: home, PATH: NO_BUN_PATH },
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('setup: PREREQ_BUN_MISSING');
    expect(r.stderr).toContain('shasum -a 256');
    expect(snapshotTree(home)).toEqual(before);

    // Execute the printed hint offline against a mock curl that writes a mock installer recording its argv.
    const versionMatch = r.stderr.match(/BUN_VERSION="([0-9]+\.[0-9]+\.[0-9]+)"/);
    expect(versionMatch).not.toBeNull();
    const hintVersion = versionMatch![1]!;
    const [maj, min, pat] = hintVersion.split('.').map(Number);
    expect(maj! > 1 || (maj === 1 && (min! > 3 || (min === 3 && pat! >= 3)))).toBe(true);

    const mockBin = freshDir('mock-curl-bin');
    const recordedArgv = join(mockBin, 'installer-argv.txt');
    writeFileSync(
      join(mockBin, 'curl'),
      `#!/bin/sh\nout=''\nwhile [ $# -gt 0 ]; do\n  if [ "$1" = "-o" ]; then out="$2"; shift 2; else shift; fi\ndone\ncat > "$out" <<'EOF'\n#!/bin/sh\nprintf '%s\\n' "$@" > '${recordedArgv}'\nEOF\n`,
      { mode: 0o755 },
    );
    chmodSync(join(mockBin, 'curl'), 0o755);

    const hintLines = r.stderr
      .split('\n')
      .filter((l) => l.startsWith('  '))
      .map((l) => l.trim())
      .join('\n');
    const execHint = spawnSync('/bin/bash', ['-euo', 'pipefail', '-c', hintLines], {
      env: { HOME: home, PATH: `${mockBin}:/usr/bin:/bin`, TMPDIR: home },
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(execHint.stderr).toBe('');
    expect(execHint.status).toBe(0);
    expect(readFileSync(recordedArgv, 'utf8').trim()).toBe(`bun-v${hintVersion}`);
  });

  test('old Bun refuses cleanly with PREREQ_BUN_TOO_OLD, no stack trace, and zero filesystem writes', () => {
    const home = freshDir('setup-old-home');
    const before = snapshotTree(home);
    const oldBun = freshDir('setup-old-bun');
    makeShim(oldBun, '#!/bin/sh\necho 1.2.0\n');
    const r = spawnSync('/bin/bash', [join(REPO_ROOT, 'setup'), '--host', 'claude'], {
      env: { HOME: home, PATH: `${oldBun}:/usr/bin:/bin` },
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('setup: PREREQ_BUN_TOO_OLD');
    expect(r.stderr).toContain('found 1.2.0');
    expect(r.stderr).not.toContain('correct the path or permissions');
    expect(r.stderr).not.toContain('SyntaxError');
    expect(snapshotTree(home)).toEqual(before);
  });
});

describe('gstack-extend init prerequisite gate, dry-run, --help, and self-registration scheme', () => {
  test('mutating init refuses on missing or old Bun without creating target dir or registry', () => {
    const oldBun = freshDir('init-old-bun');
    makeShim(oldBun, '#!/bin/sh\necho 1.2.0\n');

    for (const [label, pathEnv, token] of [
      ['missing', NO_BUN_PATH, 'PREREQ_BUN_MISSING'],
      ['too_old', `${oldBun}:${NO_BUN_PATH}`, 'PREREQ_BUN_TOO_OLD'],
    ] as const) {
      const state = freshDir(`init-state-${label}`);
      const parent = freshDir(`init-parent-${label}`);
      const target = join(parent, 'brand-new-project');
      const r = spawnSync('/bin/bash', [join(REPO_ROOT, 'bin/gstack-extend'), 'init', '--no-prompt', target], {
        env: { HOME: state, GSTACK_EXTEND_STATE_DIR: state, PATH: pathEnv },
        encoding: 'utf8',
        timeout: 15_000,
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(`gstack-extend init: ${token}`);
      expect(existsSync(target)).toBe(false);
      expect(existsSync(join(state, 'projects.json'))).toBe(false);
    }
  });

  // Value: protects=init can audit using the Bun it checked before writing; fails_when=the audit resolves a different Bun after changing directory; why_new=absolute PATH fixtures cannot catch a relative PATH disappearing across chdir; seam=none
  test('init keeps a relative PATH Bun available to the post-render audit', () => {
    const caller = freshDir('init-caller');
    const relativeBin = join(caller, 'tools');
    mkdirSync(relativeBin);
    symlinkSync(REAL_BUN, join(relativeBin, 'bun'));
    const state = freshDir('init-relative-state');
    const target = join(freshDir('init-relative-parent'), 'consumer');
    const result = spawnSync('/bin/bash', [join(REPO_ROOT, 'bin/gstack-extend'), 'init', '--no-prompt', target], {
      cwd: caller,
      env: { HOME: state, GSTACK_EXTEND_STATE_DIR: state, PATH: `tools:${NO_BUN_PATH}` },
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(result.stderr).not.toContain('PREREQ_BUN_MISSING');
    expect(result.status).toBe(0);
    expect(existsSync(join(target, 'CLAUDE.md'))).toBe(true);
    expect(JSON.parse(readFileSync(join(state, 'projects.json'), 'utf8')).projects).toHaveLength(1);
  });

  // Value: protects=init refuses before writing if the audit directory selects an older Bun; fails_when=the Bun check runs only in the caller directory; why_new=relative PATH coverage does not exercise a directory-aware launcher; seam=none
  for (const pinLocation of ['target', 'parent'] as const) {
    test(`init detects an old Bun selected by the audit directory (${pinLocation} pin) before writes`, () => {
      const caller = freshDir('init-pin-caller');
      const home = freshDir('init-pin-home');
      const parent = freshDir('init-pin-parent');
      const target = join(parent, 'consumer');
      if (pinLocation === 'target') mkdirSync(target);
      writeFileSync(join(pinLocation === 'target' ? target : parent, 'bun-runtime-pin'), '1.2.0\n');
      const before = snapshotTree(parent);

      const runtime = freshDir('init-pin-runtime');
      makeShim(runtime, [
        '#!/bin/sh',
        'if [ "$1" = --version ] && { [ -f "$PWD/bun-runtime-pin" ] || [ -f "$PWD/../bun-runtime-pin" ]; }; then',
        '  echo 1.2.0',
        '  exit 0',
        'fi',
        'exec "$TEST_REAL_BUN" "$@"',
        '',
      ].join('\n'));
      const env = {
        HOME: home,
        GSTACK_EXTEND_STATE_DIR: join(home, 'state'),
        PATH: `${runtime}:${NO_BUN_PATH}`,
        TEST_REAL_BUN: REAL_BUN,
      };
      const options = { cwd: caller, env, encoding: 'utf8' as const, timeout: 15_000 };
      const args = [join(REPO_ROOT, 'bin/gstack-extend'), 'init', target, '--no-prompt'];
      const preview = spawnSync('/bin/bash', [...args, '--dry-run'], options);
      expect(preview.status).toBe(0);
      expect(preview.stderr).toContain('init: warning: PREREQ_BUN_TOO_OLD');
      expect(snapshotTree(parent)).toEqual(before);
      expect(snapshotTree(home)).toEqual([]);

      const result = spawnSync('/bin/bash', args, options);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('init: PREREQ_BUN_TOO_OLD');
      expect(snapshotTree(parent)).toEqual(before);
      expect(snapshotTree(home)).toEqual([]);
    });
  }

  // Value: protects=init audits with the Bun it checked when /bin/sh resolves bun differently from bash; fails_when=the audit's PATH repair compares bash's lookup only; why_new=a relative PATH entry changes the lookup in both shells, a literal ~ entry only in /bin/sh; seam=none
  test('init audits with the checked Bun when /bin/sh skips a literal ~ PATH entry', () => {
    const caller = freshDir('init-tilde-caller');
    const home = freshDir('init-tilde-home');
    mkdirSync(join(home, 'bin'));
    symlinkSync(REAL_BUN, join(home, 'bin', 'bun'));
    const oldBun = freshDir('init-tilde-old');
    makeShim(oldBun, '#!/bin/sh\necho 1.2.0\n');
    const target = join(freshDir('init-tilde-parent'), 'consumer');
    const result = spawnSync('/bin/bash', [join(REPO_ROOT, 'bin/gstack-extend'), 'init', '--no-prompt', target], {
      cwd: caller,
      env: { HOME: home, GSTACK_EXTEND_STATE_DIR: join(home, 'state'), PATH: `~/bin:${oldBun}:${NO_BUN_PATH}` },
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(result.stderr).not.toContain('PREREQ_BUN');
    expect(result.status).toBe(0);
    expect(existsSync(join(target, 'CLAUDE.md'))).toBe(true);
    expect(JSON.parse(readFileSync(join(home, 'state', 'projects.json'), 'utf8')).projects).toHaveLength(1);
  });

  test('init warns in preview and refuses mutation when the Bun path cannot survive chdir', () => {
    const home = freshDir('init-unusable-bun-home');
    const parent = freshDir('init-unusable-bun');
    const caller = join(parent, 'caller:project');
    const runtime = join(caller, 'relative-bin');
    const target = join(parent, 'consumer');
    mkdirSync(runtime, { recursive: true });
    makeDelegatingShim(runtime, '1.3.3');
    const env = {
      HOME: home,
      PATH: `relative-bin:${NO_BUN_PATH}`,
      GSTACK_EXTEND_STATE_DIR: join(home, 'state'),
    };
    const args = [join(REPO_ROOT, 'bin/gstack-extend'), 'init', target, '--no-prompt'];
    const options = { cwd: caller, env, encoding: 'utf8' as const, timeout: 15_000 };
    const preview = spawnSync('/bin/bash', [...args, '--dry-run'], options);
    expect(preview.status).toBe(0);
    expect(preview.stdout).toContain('DRY RUN');
    expect(preview.stderr).toContain('warning: PREREQ_BUN_MISSING');
    expect(preview.stderr).toContain('add an absolute PATH entry without a colon and rerun');
    expect(snapshotTree(home)).toEqual([]);
    expect(existsSync(target)).toBe(false);

    const result = spawnSync('/bin/bash', args, options);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('init: PREREQ_BUN_MISSING');
    expect(result.stderr).toContain('add an absolute PATH entry without a colon and rerun');
    expect(snapshotTree(home)).toEqual([]);
    expect(existsSync(target)).toBe(false);
  });

  test('init preserves Git selection when Bun already resolves in the audit directory', () => {
    const home = freshDir('init-git-home');
    const target = freshDir('init-git-repo');
    const preferred = freshDir('init-preferred-tools');
    const runtime = freshDir('init-runtime-bin');
    const alternateGitMarker = join(home, 'runtime-git-was-used');
    const git = join(NO_BUN_PATH, 'git');
    symlinkSync(git, join(preferred, 'git'));
    makeDelegatingShim(runtime, '1.3.3');
    writeFileSync(join(runtime, 'git'), [
      '#!/bin/sh',
      ': > "$TEST_ALTERNATE_GIT_MARKER"',
      'exec "$TEST_REAL_GIT" "$@"',
      '',
    ].join('\n'), { mode: 0o755 });
    const env = {
      HOME: home,
      PATH: `${preferred}:${runtime}:${NO_BUN_PATH}`,
      GSTACK_EXTEND_STATE_DIR: join(home, 'state'),
      TEST_ALTERNATE_GIT_MARKER: alternateGitMarker,
      TEST_REAL_GIT: git,
    };
    const initialized = spawnSync(git, ['init', '--quiet', target], { env, encoding: 'utf8', timeout: 15_000 });
    expect(initialized.status).toBe(0);
    const r = spawnSync('/bin/bash', [join(REPO_ROOT, 'bin/gstack-extend'), 'init', target, '--no-prompt'], {
      env,
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Running post-render audit');
    expect(existsSync(alternateGitMarker)).toBe(false);
  });

  test('init --dry-run warns on stderr under missing/old Bun and writes nothing; init --help exits 0', () => {
    const state = freshDir('init-dry-state');
    const parent = freshDir('init-dry-parent');
    const target = join(parent, 'dry-proj');

    const help = spawnSync('/bin/bash', [join(REPO_ROOT, 'bin/gstack-extend'), 'init', '--help'], {
      env: { HOME: state, GSTACK_EXTEND_STATE_DIR: state, PATH: NO_BUN_PATH },
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('Usage:');

    const dry = spawnSync('/bin/bash', [join(REPO_ROOT, 'bin/gstack-extend'), 'init', '--dry-run', target], {
      env: { HOME: state, GSTACK_EXTEND_STATE_DIR: state, PATH: NO_BUN_PATH },
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(dry.status).toBe(0);
    expect(dry.stderr).toContain('PREREQ_BUN_MISSING');
    expect(dry.stderr).toContain('Dry-run writes nothing');
    expect(existsSync(target)).toBe(false);
    expect(existsSync(join(state, 'projects.json'))).toBe(false);
  });

  // Value: protects=criterion 6 when init reaches its own checkout through an equivalent path spelling; fails_when=the scheme check compares path strings built by different pwd implementations; why_new=the existing case invokes init through the canonical path only; seam=none
  test('self-registration stores 3-digit when init is invoked through an equivalent path spelling', () => {
    const state = freshDir('scheme-alias-state');
    const gstackState = freshDir('scheme-alias-gstack');
    const install = freshDir('scheme-alias-install');
    mkdirSync(join(install, 'bin', 'lib'), { recursive: true });
    for (const path of ['bin/gstack-extend', 'bin/lib/bun-prereq.sh', 'bin/lib/install-safety.sh', 'bin/lib/projects-registry.sh']) {
      copyFileSync(join(REPO_ROOT, path), join(install, path));
    }
    cpSync(join(REPO_ROOT, 'scripts', 'init-templates'), join(install, 'scripts', 'init-templates'), { recursive: true });
    // Registration is the behavior under test. Audit runs separately against real source in the other init cases.
    writeFileSync(join(install, 'bin', 'roadmap-audit'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    // A leading // names the same directory, but bash's pwd keeps it while /bin/pwd -P drops it.
    const aliasedInit = `/${join(install, 'bin', 'gstack-extend')}`;
    const result = spawnSync(
      '/bin/bash',
      [aliasedInit, 'init', '--migrate', '--no-prompt', '--name', 'gstack-extend', install],
      {
        env: { HOME: state, GSTACK_EXTEND_STATE_DIR: state, GSTACK_STATE_ROOT: gstackState, PATH: `${dirname(REAL_BUN)}:${NO_BUN_PATH}` },
        encoding: 'utf8',
        timeout: 30_000,
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('version_scheme: 3-digit');
    const registry = JSON.parse(readFileSync(join(state, 'projects.json'), 'utf8'));
    expect(registry.projects.find((p: { name: string }) => p.name === 'gstack-extend')?.version_scheme).toBe('3-digit');
  });

  test('self-registration prints and stores 3-digit while consumer projects keep 4-digit', () => {
    const state = freshDir('scheme-state');
    const gstackState = freshDir('scheme-gstack');
    const install = freshDir('scheme-install');
    mkdirSync(join(install, 'bin', 'lib'), { recursive: true });
    for (const path of ['bin/gstack-extend', 'bin/lib/bun-prereq.sh', 'bin/lib/install-safety.sh', 'bin/lib/projects-registry.sh']) {
      copyFileSync(join(REPO_ROOT, path), join(install, path));
    }
    cpSync(join(REPO_ROOT, 'scripts', 'init-templates'), join(install, 'scripts', 'init-templates'), { recursive: true });
    // Registration is the behavior under test. Audit runs separately against real source in the other init cases.
    writeFileSync(join(install, 'bin', 'roadmap-audit'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const installedInit = join(install, 'bin', 'gstack-extend');
    const selfRun = spawnSync(
      '/bin/bash',
      [installedInit, 'init', '--migrate', '--no-prompt', '--name', 'gstack-extend', install],
      {
        env: { HOME: state, GSTACK_EXTEND_STATE_DIR: state, GSTACK_STATE_ROOT: gstackState, PATH: `${dirname(REAL_BUN)}:${NO_BUN_PATH}` },
        encoding: 'utf8',
        timeout: 30_000,
      },
    );
    expect(selfRun.status).toBe(0);
    expect(selfRun.stdout).toContain('version_scheme: 3-digit');
    const reg1 = JSON.parse(readFileSync(join(state, 'projects.json'), 'utf8'));
    const selfEntry = reg1.projects.find((p: { name: string }) => p.name === 'gstack-extend');
    expect(selfEntry?.version_scheme).toBe('3-digit');

    const consumerDir = freshDir('consumer-proj');
    const consumerRun = spawnSync(
      '/bin/bash',
      [installedInit, 'init', '--no-prompt', '--name', 'demo-consumer', consumerDir],
      {
        env: { HOME: state, GSTACK_EXTEND_STATE_DIR: state, GSTACK_STATE_ROOT: gstackState, PATH: `${dirname(REAL_BUN)}:${NO_BUN_PATH}` },
        encoding: 'utf8',
        timeout: 30_000,
      },
    );
    expect(consumerRun.status).toBe(0);
    expect(consumerRun.stdout).toContain('version_scheme: 4-digit');
    const reg2 = JSON.parse(readFileSync(join(state, 'projects.json'), 'utf8'));
    const consumerEntry = reg2.projects.find((p: { name: string }) => p.name === 'demo-consumer');
    expect(consumerEntry?.version_scheme).toBe('4-digit');
  });
});

describe('--help and -h for roadmap-audit, roadmap-pack, and outside-review', () => {
  for (const binName of ['roadmap-audit', 'roadmap-pack', 'outside-review']) {
    for (const flag of ['--help', '-h']) {
      test(`${binName} ${flag} prints usage on stdout, exits 0, and writes nothing`, () => {
        const scratch = freshDir(`help-${binName}`);
        const helpHome = freshDir(`help-home-${binName}`);
        const before = snapshotTree(scratch);
        const r = spawnSync('/bin/sh', [join(REPO_ROOT, 'bin', binName), flag], {
          cwd: scratch,
          env: { PATH: `${dirname(REAL_BUN)}:${NO_BUN_PATH}`, HOME: helpHome },
          encoding: 'utf8',
          timeout: 15_000,
        });
        expect(r.status).toBe(0);
        expect(r.stderr).toBe('');
        expect(r.stdout).toContain(`Usage: ${binName}`);
        expect(snapshotTree(scratch)).toEqual(before);
      });
    }
  }
});

describe('floor agreement and launcher code registration', () => {
  test('finds Bun launchers and live floor declarations in the checkout', () => {
    const helperText = readFileSync(HELPER, 'utf8');
    const floor = helperText.match(/^BUN_PREREQ_MIN='([0-9]+\.[0-9]+\.[0-9]+)'$/m)?.[1] ?? '';
    expect(floor).toMatch(/^\d+\.\d+\.\d+$/);

    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
    expect(pkg.engines.bun).toBe(`>=${floor}`);
    expect(LAYOUT_FLOOR).toBe(floor);
    expect(DOCS_SHIP_FLOOR).toBe(floor);

    const docs = ['README.md', 'docs/installation.md', 'CLAUDE.md'];
    const glob = new Bun.Glob('**/*');
    const sourcePaths = ['bin', 'src'].flatMap((dir) =>
      [...glob.scanSync({ cwd: join(REPO_ROOT, dir), onlyFiles: true })].map((file) => `${dir}/${file}`),
    );
    // Feature-introduction versions and failing examples are outside the supported floor.
    const alternateVersions: Record<string, string[]> = {
      'CLAUDE.md': ['0.3.0', '1.0.0', '1.2.0', '1.3.2'],
      'docs/installation.md': ['1.2.0', '1.3.2'],
    };
    const mismatches: string[] = [];
    const bunLaunchers: string[] = [];
    const foundFloor = new Set<string>();
    for (const file of [...sourcePaths, ...docs]) {
      const body = readFileSync(join(REPO_ROOT, file), 'utf8');
      if (file.startsWith('bin/') && /^\s*exec\s+(?:bun\s|"\$BUN_PREREQ_RAW_PATH")/m.test(body)) {
        bunLaunchers.push(file);
      }
      for (const line of body.split('\n')) {
        if (!/\bBun\b|\bBUN_(FLOOR|PREREQ_MIN)\b/i.test(line)) continue;
        for (const [, version] of line.matchAll(/(?<![.\d])(\d+\.\d+\.\d+)(?![.\d])/g)) {
          if (version === floor) foundFloor.add(file);
          else if (!alternateVersions[file]?.includes(version!)) mismatches.push(`${file}: ${version}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
    expect(docs.every((file) => foundFloor.has(file))).toBe(true);
    expect(bunLaunchers.sort()).toEqual(ALL_LAUNCHERS.map(({ name }) => `bin/${name}`).sort());
  });

  test('registers all Bun runtime errors in the merge-gate registry and hardened CLI help', () => {
    for (const code of ['bun_missing', 'bun_too_old', 'bun_version_unknown'] as const) {
      expect(MERGE_GATE_ERROR_CODES).toContain(code);
      expect(layoutHelp()).toContain(code);
      expect(docsShipHelp()).toContain(code);
    }
  });
});
