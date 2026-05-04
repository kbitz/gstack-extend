/**
 * touchfiles.test.ts — units, structural invariants, and wrapper E2E for
 * diff-based test selection (Track 4A).
 *
 * Three structural invariants guard against silent drift when tests are
 * added or removed:
 *
 *   1. every glob in MANUAL_TOUCHFILES + GLOBAL_TOUCHFILES matches ≥1 file
 *      → catches dangling globs left behind after a refactor.
 *   2. every tests/*.test.ts is reachable via import graph or MANUAL
 *      → catches a new test that nothing in src/ can trigger (would only
 *      run when the test FILE itself changes, which is a sign of a
 *      missing manual entry).
 *      Exempts tests/touchfiles.test.ts itself — its dep is touchfiles.ts,
 *      which is already a GLOBAL, so all-runs catch it anyway.
 *   3. every MANUAL_TOUCHFILES key resolves to an existing test file
 *      → catches a renamed/deleted test that left its manual entry
 *      orphaned.
 *
 * Wrapper E2E scenarios drive `planWrapperAction` against fixture-repo
 * builds, exercising each of the four fallbacks and the three bypasses
 * (argv passthrough, EVALS_ALL=1, rename pair).
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';

import {
  GLOBAL_TOUCHFILES,
  MANUAL_TOUCHFILES,
  analyzeTestImports,
  computeTestSelection,
  detectBaseBranch,
  getChangedFiles,
  listTestFiles,
  matchGlob,
  parseDiffNameStatus,
} from './helpers/touchfiles.ts';
import { makeBaseTmp, makeEmptyRepo } from './helpers/fixture-repo.ts';
import { planWrapperAction } from '../scripts/select-tests.ts';

const REPO_ROOT = join(import.meta.dir, '..');

// ─── matchGlob ──────────────────────────────────────────────────────────

describe('matchGlob', () => {
  test('exact match', () => {
    expect(matchGlob('package.json', 'package.json')).toBe(true);
    expect(matchGlob('package.json', 'package-lock.json')).toBe(false);
  });

  test('* matches within a single segment', () => {
    expect(matchGlob('skills/roadmap.md', 'skills/*.md')).toBe(true);
    expect(matchGlob('skills/sub/roadmap.md', 'skills/*.md')).toBe(false);
  });

  test('** matches any number of segments', () => {
    expect(matchGlob('src/audit/lib/git.ts', 'src/audit/**')).toBe(true);
    expect(matchGlob('src/audit/checks/version.ts', 'src/audit/**')).toBe(true);
    expect(matchGlob('src/test-plan/parsers.ts', 'src/audit/**')).toBe(false);
  });

  test('** matches zero segments', () => {
    expect(matchGlob('src/audit', 'src/audit/**')).toBe(false);
    expect(matchGlob('src/audit/x', 'src/audit/**')).toBe(true);
  });

  test('escaped dots in patterns', () => {
    expect(matchGlob('package.json', '*.json')).toBe(true);
    expect(matchGlob('packagexjson', '*.json')).toBe(false);
  });

  test('directory globs without trailing slash', () => {
    expect(matchGlob('bin/lib/source-tag.sh', 'bin/lib/**')).toBe(true);
    expect(matchGlob('bin/roadmap-audit', 'bin/lib/**')).toBe(false);
  });
});

// ─── parseDiffNameStatus ────────────────────────────────────────────────

describe('parseDiffNameStatus', () => {
  test('modify / add / delete', () => {
    const out = parseDiffNameStatus('M\tsrc/a.ts\nA\tsrc/b.ts\nD\tsrc/c.ts\n');
    expect(out).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  test('rename returns BOTH paths', () => {
    const out = parseDiffNameStatus('R100\tsrc/old.ts\tsrc/new.ts\n');
    expect(out).toEqual(['src/old.ts', 'src/new.ts']);
  });

  test('rename with similarity score < 100', () => {
    const out = parseDiffNameStatus('R087\tsrc/foo.ts\tsrc/bar.ts\n');
    expect(out).toEqual(['src/foo.ts', 'src/bar.ts']);
  });

  test('copy returns BOTH paths', () => {
    const out = parseDiffNameStatus('C100\tsrc/a.ts\tsrc/b.ts\n');
    expect(out).toEqual(['src/a.ts', 'src/b.ts']);
  });

  test('mixed statuses', () => {
    const stdout = 'M\tsrc/a.ts\nR090\tsrc/old.ts\tsrc/new.ts\nA\tdocs/x.md\n';
    expect(parseDiffNameStatus(stdout)).toEqual([
      'src/a.ts', 'src/old.ts', 'src/new.ts', 'docs/x.md',
    ]);
  });

  test('empty input', () => {
    expect(parseDiffNameStatus('')).toEqual([]);
    expect(parseDiffNameStatus('\n\n\n')).toEqual([]);
  });
});

// ─── analyzeTestImports ─────────────────────────────────────────────────

describe('analyzeTestImports', () => {
  const baseTmp = makeBaseTmp('analyze-imports-');
  afterAll(() => {
    try { rmSync(baseTmp, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function seedRepo(name: string): string {
    const root = join(baseTmp, name);
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'tests'), { recursive: true });
    return root;
  }

  test('value imports', () => {
    const root = seedRepo('value');
    writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(root, 'src', 'b.ts'), 'export const b = 2;\n');
    writeFileSync(
      join(root, 'tests', 'foo.test.ts'),
      "import { a } from '../src/a.ts';\nimport { b } from '../src/b.ts';\n",
    );
    const deps = analyzeTestImports('tests/foo.test.ts', root);
    expect(deps).toContain('src/a.ts');
    expect(deps).toContain('src/b.ts');
  });

  test('type-only imports counted (over-conservative is OK)', () => {
    const root = seedRepo('type-only');
    writeFileSync(join(root, 'src', 't.ts'), 'export type T = number;\n');
    writeFileSync(
      join(root, 'tests', 'foo.test.ts'),
      "import type { T } from '../src/t.ts';\n",
    );
    expect(analyzeTestImports('tests/foo.test.ts', root)).toContain('src/t.ts');
  });

  test('transitively follows re-exports', () => {
    const root = seedRepo('re-export');
    writeFileSync(join(root, 'src', 'inner.ts'), 'export const x = 1;\n');
    writeFileSync(join(root, 'src', 'index.ts'), "export { x } from './inner.ts';\n");
    writeFileSync(
      join(root, 'tests', 'foo.test.ts'),
      "import { x } from '../src/index.ts';\n",
    );
    const deps = analyzeTestImports('tests/foo.test.ts', root);
    expect(deps).toContain('src/index.ts');
    expect(deps).toContain('src/inner.ts');
  });

  test('dynamic import() is captured', () => {
    const root = seedRepo('dynamic');
    writeFileSync(join(root, 'src', 'dyn.ts'), 'export const d = 1;\n');
    writeFileSync(
      join(root, 'tests', 'foo.test.ts'),
      "const m = await import('../src/dyn.ts');\n",
    );
    expect(analyzeTestImports('tests/foo.test.ts', root)).toContain('src/dyn.ts');
  });

  test('node:/bun:/npm specifiers ignored', () => {
    const root = seedRepo('externals');
    writeFileSync(
      join(root, 'tests', 'foo.test.ts'),
      "import { test } from 'bun:test';\nimport { join } from 'node:path';\nimport pkg from 'some-pkg';\n",
    );
    expect(analyzeTestImports('tests/foo.test.ts', root)).toEqual([]);
  });
});

// ─── computeTestSelection ───────────────────────────────────────────────

describe('computeTestSelection', () => {
  const tests = ['tests/a.test.ts', 'tests/b.test.ts'];
  const opts = {
    repoRoot: '/dev/null',
    manual: {
      'tests/a.test.ts': ['src/a.ts'],
      'tests/b.test.ts': ['src/b.ts', 'docs/**'],
    },
    globals: ['package.json'],
  };

  test('fallback 1: empty diff → run all', () => {
    const sel = computeTestSelection([], tests, opts);
    expect(sel.reason).toBe('empty-diff');
    expect(sel.selected).toEqual(tests);
  });

  test('fallback 3: global hit → run all', () => {
    const sel = computeTestSelection(['package.json'], tests, opts);
    expect(sel.reason).toContain('global');
    expect(sel.selected).toEqual(tests);
  });

  test('fallback 4: non-empty diff but zero matches → run all', () => {
    const sel = computeTestSelection(['unmapped/path.txt'], tests, opts);
    expect(sel.reason).toBe('no-match-fallback');
    expect(sel.selected).toEqual(tests);
  });

  test('per-test manual hit', () => {
    const sel = computeTestSelection(['src/a.ts'], tests, opts);
    expect(sel.selected).toEqual(['tests/a.test.ts']);
    expect(sel.skipped).toEqual(['tests/b.test.ts']);
    expect(sel.reason).toBe('diff');
  });

  test('per-test glob hit', () => {
    const sel = computeTestSelection(['docs/x.md'], tests, opts);
    expect(sel.selected).toEqual(['tests/b.test.ts']);
  });

  test('multiple test hits', () => {
    const sel = computeTestSelection(['src/a.ts', 'src/b.ts'], tests, opts);
    expect(sel.selected).toEqual(tests);
  });

  test('self-trigger: changing the test file itself', () => {
    const sel = computeTestSelection(['tests/a.test.ts'], tests, opts);
    expect(sel.selected).toEqual(['tests/a.test.ts']);
  });

  test('order independence: globals checked before per-test', () => {
    const sel = computeTestSelection(['src/a.ts', 'package.json'], tests, opts);
    expect(sel.reason).toContain('global');
    expect(sel.selected).toEqual(tests);
  });
});

// ─── detectBaseBranch ───────────────────────────────────────────────────

describe('detectBaseBranch', () => {
  const baseTmp = makeBaseTmp('detect-base-');
  afterAll(() => {
    try { rmSync(baseTmp, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('no-base: empty repo with no usable refs returns null', () => {
    const repo = makeEmptyRepo(baseTmp);
    spawnSync('git', ['-C', repo, 'branch', '-m', 'main', 'feature'], { encoding: 'utf8' });
    expect(detectBaseBranch(repo)).toBe(null);
  });

  test('probe order: prefers main when present', () => {
    const repo = makeEmptyRepo(baseTmp); // makeEmptyRepo defaults to main
    expect(detectBaseBranch(repo)).toBe('main');
  });

  test('TOUCHFILES_BASE env override (valid ref)', () => {
    const repo = makeEmptyRepo(baseTmp);
    spawnSync('git', ['-C', repo, 'checkout', '-b', 'feature'], { encoding: 'utf8' });
    expect(detectBaseBranch(repo, { TOUCHFILES_BASE: 'main' })).toBe('main');
  });

  test('TOUCHFILES_BASE env override (invalid ref) returns null', () => {
    const repo = makeEmptyRepo(baseTmp);
    expect(detectBaseBranch(repo, { TOUCHFILES_BASE: 'no-such-ref' })).toBe(null);
  });

  test('TOUCHFILES_BASE empty string falls through to probe order', () => {
    const repo = makeEmptyRepo(baseTmp);
    expect(detectBaseBranch(repo, { TOUCHFILES_BASE: '' })).toBe('main');
  });
});

// ─── getChangedFiles ────────────────────────────────────────────────────

describe('getChangedFiles', () => {
  const baseTmp = makeBaseTmp('changed-files-');
  afterAll(() => {
    try { rmSync(baseTmp, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('empty diff between same commits', () => {
    const repo = makeEmptyRepo(baseTmp);
    expect(getChangedFiles('main', repo)).toEqual([]);
  });

  test('captures additions on a feature branch', () => {
    const repo = makeEmptyRepo(baseTmp);
    spawnSync('git', ['-C', repo, 'checkout', '-b', 'feature'], { encoding: 'utf8' });
    writeFileSync(join(repo, 'foo.txt'), 'hi\n');
    spawnSync('git', ['-C', repo, 'add', '-A'], { encoding: 'utf8' });
    spawnSync('git', ['-C', repo, 'commit', '-m', 'add foo', '--quiet'], { encoding: 'utf8' });
    const changed = getChangedFiles('main', repo);
    expect(changed).toContain('foo.txt');
  });

  test('rename surfaces both old and new paths', () => {
    const repo = makeEmptyRepo(baseTmp);
    writeFileSync(join(repo, 'old.txt'), 'a\n'.repeat(50));
    spawnSync('git', ['-C', repo, 'add', '-A'], { encoding: 'utf8' });
    spawnSync('git', ['-C', repo, 'commit', '-m', 'seed', '--quiet'], { encoding: 'utf8' });
    spawnSync('git', ['-C', repo, 'checkout', '-b', 'feature'], { encoding: 'utf8' });
    spawnSync('git', ['-C', repo, 'mv', 'old.txt', 'new.txt'], { encoding: 'utf8' });
    spawnSync('git', ['-C', repo, 'commit', '-m', 'rename', '--quiet'], { encoding: 'utf8' });
    const changed = getChangedFiles('main', repo);
    expect(changed).toContain('old.txt');
    expect(changed).toContain('new.txt');
  });

  test('returns [] when base ref does not exist', () => {
    const repo = makeEmptyRepo(baseTmp);
    expect(getChangedFiles('no-such-ref', repo)).toEqual([]);
  });
});

// ─── Structural invariants (real repo) ──────────────────────────────────

describe('structural invariants', () => {
  test('I1: every glob in MANUAL/GLOBAL touchfiles matches ≥1 file', () => {
    const allFiles = collectFiles(REPO_ROOT);
    const dangling: string[] = [];
    for (const [testName, globs] of Object.entries(MANUAL_TOUCHFILES)) {
      for (const g of globs) {
        if (!allFiles.some(f => matchGlob(f, g))) {
          dangling.push(`${testName} → ${g}`);
        }
      }
    }
    for (const g of GLOBAL_TOUCHFILES) {
      if (!allFiles.some(f => matchGlob(f, g))) {
        dangling.push(`GLOBAL → ${g}`);
      }
    }
    expect(dangling).toEqual([]);
  });

  test('I2: every tests/*.test.ts (except touchfiles.test.ts) reachable via import graph or MANUAL', () => {
    const tests = listTestFiles(REPO_ROOT);
    const unreachable: string[] = [];
    for (const t of tests) {
      if (t === 'tests/touchfiles.test.ts') continue;
      const tsDeps = analyzeTestImports(t, REPO_ROOT);
      const manualDeps = MANUAL_TOUCHFILES[t] ?? [];
      if (tsDeps.length === 0 && manualDeps.length === 0) {
        unreachable.push(t);
      }
    }
    expect(unreachable).toEqual([]);
  });

  test('I3: every MANUAL_TOUCHFILES key resolves to an existing test file', () => {
    const orphaned: string[] = [];
    for (const key of Object.keys(MANUAL_TOUCHFILES)) {
      const path = join(REPO_ROOT, key);
      if (!existsSync(path)) orphaned.push(key);
    }
    expect(orphaned).toEqual([]);
  });
});

// ─── Wrapper E2E (planWrapperAction in fixture repos) ───────────────────

describe('wrapper E2E', () => {
  const baseTmp = makeBaseTmp('wrapper-e2e-');
  afterAll(() => {
    try { rmSync(baseTmp, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('S1 happy: changed src file selects only its dependent test', () => {
    const repo = makeEmptyRepo(baseTmp);
    seedMinimalProject(repo);
    spawnSync('git', ['-C', repo, 'add', '-A'], { encoding: 'utf8' });
    spawnSync('git', ['-C', repo, 'commit', '-m', 'seed', '--quiet'], { encoding: 'utf8' });
    spawnSync('git', ['-C', repo, 'checkout', '-b', 'feature'], { encoding: 'utf8' });
    writeFileSync(join(repo, 'src/a.ts'), 'export const a = 99;\n');
    spawnSync('git', ['-C', repo, 'commit', '-am', 'edit a', '--quiet'], { encoding: 'utf8' });
    const action = planWrapperAction({ argv: [], env: {}, cwd: repo });
    expect(action.kind).toBe('select');
    if (action.kind === 'select') {
      expect(action.selected).toEqual(['tests/a.test.ts']);
    }
  });

  test('S2 EVALS_ALL=1 bypass: returns all', () => {
    const repo = makeEmptyRepo(baseTmp);
    seedMinimalProject(repo);
    const action = planWrapperAction({ argv: [], env: { EVALS_ALL: '1' }, cwd: repo });
    expect(action.kind).toBe('all');
    if (action.kind === 'all') expect(action.reason).toBe('evals_all');
  });

  test('S3 empty-diff: HEAD == base → fallback 1', () => {
    const repo = makeEmptyRepo(baseTmp);
    seedMinimalProject(repo);
    spawnSync('git', ['-C', repo, 'add', '-A'], { encoding: 'utf8' });
    spawnSync('git', ['-C', repo, 'commit', '--amend', '--no-edit', '--quiet'], { encoding: 'utf8' });
    const action = planWrapperAction({ argv: [], env: {}, cwd: repo });
    expect(action.kind).toBe('all');
    if (action.kind === 'all') expect(action.reason).toBe('empty-diff');
  });

  test('S4 no-base: no main/master ref → fallback 2', () => {
    const repo = makeEmptyRepo(baseTmp);
    spawnSync('git', ['-C', repo, 'branch', '-m', 'main', 'feature'], { encoding: 'utf8' });
    seedMinimalProject(repo);
    const action = planWrapperAction({ argv: [], env: {}, cwd: repo });
    expect(action.kind).toBe('all');
    if (action.kind === 'all') expect(action.reason).toBe('no-base');
  });

  test('S5 global: changed file matches GLOBAL → fallback 3', () => {
    const repo = makeEmptyRepo(baseTmp);
    seedMinimalProject(repo);
    spawnSync('git', ['-C', repo, 'add', '-A'], { encoding: 'utf8' });
    spawnSync('git', ['-C', repo, 'commit', '-m', 'seed', '--quiet'], { encoding: 'utf8' });
    spawnSync('git', ['-C', repo, 'checkout', '-b', 'feature'], { encoding: 'utf8' });
    writeFileSync(join(repo, 'package.json'), '{"version":"9"}\n');
    spawnSync('git', ['-C', repo, 'commit', '-am', 'bump', '--quiet'], { encoding: 'utf8' });
    const action = planWrapperAction({ argv: [], env: {}, cwd: repo });
    expect(action.kind).toBe('all');
    if (action.kind === 'all') expect(action.reason).toBe('global');
  });

  test('S6 args-passthrough: argv > 0 → bypass selection', () => {
    const repo = makeEmptyRepo(baseTmp);
    const action = planWrapperAction({ argv: ['--watch', 'foo.test.ts'], env: {}, cwd: repo });
    expect(action.kind).toBe('argv');
    if (action.kind === 'argv') expect(action.args).toEqual(['--watch', 'foo.test.ts']);
  });

  test('S7 rename: src file renamed → both old/new in change set, dependent test selected', () => {
    const repo = makeEmptyRepo(baseTmp);
    seedMinimalProject(repo);
    spawnSync('git', ['-C', repo, 'add', '-A'], { encoding: 'utf8' });
    spawnSync('git', ['-C', repo, 'commit', '-m', 'seed', '--quiet'], { encoding: 'utf8' });
    spawnSync('git', ['-C', repo, 'checkout', '-b', 'feature'], { encoding: 'utf8' });
    spawnSync('git', ['-C', repo, 'mv', 'src/a.ts', 'src/renamed.ts'], { encoding: 'utf8' });
    // The test follows the rename — same realistic refactor pattern.
    writeFileSync(join(repo, 'tests/a.test.ts'), "import { a } from '../src/renamed.ts';\n");
    spawnSync('git', ['-C', repo, 'add', '-A'], { encoding: 'utf8' });
    spawnSync('git', ['-C', repo, 'commit', '-m', 'rename', '--quiet'], { encoding: 'utf8' });
    const changed = getChangedFiles('main', repo);
    expect(changed).toContain('src/a.ts');
    expect(changed).toContain('src/renamed.ts');
    const action = planWrapperAction({ argv: [], env: {}, cwd: repo });
    expect(action.kind).toBe('select');
    if (action.kind === 'select') {
      expect(action.selected).toContain('tests/a.test.ts');
    }
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Recursively enumerate files under `root`, returning paths relative to it.
 * Skips `.git`, `node_modules`, and `dist`/`build` artefact dirs.
 */
function collectFiles(root: string): string[] {
  const out: string[] = [];
  const SKIP = new Set(['.git', 'node_modules', 'dist', 'build', '.bun', '.cache']);
  function walk(dir: string): void {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) out.push(relative(root, full));
    }
  }
  walk(root);
  return out;
}

/**
 * Seed a tmp git repo with a minimal layout the wrapper can analyze:
 *   src/a.ts, src/b.ts (independent units)
 *   tests/a.test.ts (imports src/a.ts), tests/b.test.ts (imports src/b.ts)
 *   tests/helpers/touchfiles.ts (the actual selection helper, copied so
 *     analyzeTestImports works in the fixture repo too)
 *   package.json (a GLOBAL touchfile)
 *
 * Files are written but NOT committed by this helper — the caller chooses
 * the commit/branch shape per scenario.
 */
function seedMinimalProject(repo: string): void {
  mkdirSync(join(repo, 'src'), { recursive: true });
  mkdirSync(join(repo, 'tests'), { recursive: true });
  writeFileSync(join(repo, 'src/a.ts'), 'export const a = 1;\n');
  writeFileSync(join(repo, 'src/b.ts'), 'export const b = 2;\n');
  writeFileSync(
    join(repo, 'tests/a.test.ts'),
    "import { a } from '../src/a.ts';\n",
  );
  writeFileSync(
    join(repo, 'tests/b.test.ts'),
    "import { b } from '../src/b.ts';\n",
  );
  writeFileSync(join(repo, 'package.json'), '{"name":"fixture","version":"0"}\n');
}
