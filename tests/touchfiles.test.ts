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
 * (argv passthrough, EVALS_ALL=1, rename pair), the version-only package.json
 * narrowing, per-skill selection and the selection report.
 *
 * Per-skill and release selection: a change to one skill file selects that
 * skill's suites and the shared-rule suites (those declaring `skills/**`); a
 * version-only release commit selects the release and manifest checks; a
 * package.json dependency or script change still selects everything; and
 * `.gstack/pregate.json` carries the same edges as MANUAL_TOUCHFILES.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
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
  packageJsonChange,
  parseDiffNameStatus,
  pregateDependencies,
} from './helpers/touchfiles.ts';
import { makeBaseTmp, makeEmptyRepo } from './helpers/fixture-repo.ts';
import { EXPECTED_SETUP_SKILLS } from './helpers/expected-setup-skills.ts';
import {
  REPORT_SCHEMA,
  bunTestArgs,
  planWrapperAction,
  reportLines,
  TEST_TIMEOUT_MS,
  writeReport,
} from '../scripts/select-tests.ts';
import { PREGATE_CONFIG, syncedPregateConfig } from '../scripts/sync-pregate-deps.ts';

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
    expect(matchGlob('src/other/parsers.ts', 'src/audit/**')).toBe(false);
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

  // Value: protects=an install-safety.sh edit selects both suites that run it under diff selection;
  //   fails_when=either suite's 'bin/lib/install-safety.sh' manual entry is dropped;
  //   why_new=I1-I3 pass without either entry because both suites stay reachable another way;
  //   seam=none
  test('a bin/lib/install-safety.sh change selects its direct and update suites', () => {
    const sel = computeTestSelection(['bin/lib/install-safety.sh'], listTestFiles(REPO_ROOT));
    expect(sel.reason).toBe('diff');
    expect(sel.selected).toContain('tests/lib-install-safety.test.ts');
    expect(sel.selected).toContain('tests/update.test.ts');
  });

  // Value: protects=a CLAUDE.md release-marker edit runs the release ordering gate, and a docs/installation.md edit
  //   runs update's rollback-guidance lock, under diff selection;
  //   fails_when=release-manifest's 'CLAUDE.md' or update's 'docs/installation.md' manual entry is dropped;
  //   why_new=both suites import helpers, so I1-I3 pass without either entry; release selection covers only VERSION,
  //   CHANGELOG.md and package.json; seam=none; no_claim=selection only; the marker and rollback checks live in those suites
  test('a CLAUDE.md or docs/installation.md change selects the suite that locks it', () => {
    const tests = listTestFiles(REPO_ROOT);
    for (const [file, suite] of [['CLAUDE.md', 'tests/release-manifest.test.ts'], ['docs/installation.md', 'tests/update.test.ts']] as const) {
      const sel = computeTestSelection([file], tests);
      expect([file, sel.reason, sel.selected.includes(suite)]).toEqual([file, 'diff', true]);
    }
  });
});

// ─── Per-skill and release selection (the live map) ─────────────────────

const SPLIT_SUITE_RE = /^tests\/skill-protocols-([a-z-]+)\.test\.ts$/;
const SHARED_SUITE = 'tests/skill-protocols.test.ts';
const RELEASE_INPUTS = ['VERSION', 'CHANGELOG.md', 'package.json'];

/** Tests whose manual deps match `file`. */
function declaredConsumers(file: string): string[] {
  return Object.entries(MANUAL_TOUCHFILES)
    .filter(([, globs]) => globs.some(g => matchGlob(file, g)))
    .map(([t]) => t)
    .sort();
}

/** The skill-path spellings a split suite may use; each names one skill. */
const SKILL_PATH_FORMS = [
  /join\(ROOT, (['"])skills\1, (['"])(?<name>[a-z-]+)\.md\2\)/g,
  /(['"])skills\/(?<name>[a-z-]+)\.md\1/g,
  /resolverSkillText\((['"])(?<name>[a-z-]+)\1\)/g,
];

/** Skill names a split suite reads, from the path forms the suites use. */
function namedSkills(source: string): string[] {
  const names = new Set<string>();
  for (const form of SKILL_PATH_FORMS) for (const m of source.matchAll(form)) names.add(m.groups!.name!);
  return [...names].sort();
}

/**
 * Skill references outside SKILL_PATH_FORMS: a `skills` path segment
 * (`'skills'`, `"skills/" + name`, a template literal, a directory listing) or
 * resolverSkillText with a computed argument. Each can read a skill the
 * suite does not declare.
 */
function computedSkillReads(source: string): string[] {
  let rest = source;
  for (const form of SKILL_PATH_FORMS) rest = rest.replace(form, '');
  const hits = [...rest.matchAll(/(['"`])skills(?:\1|\/)|resolverSkillText\(/g)];
  return hits.map(m => rest.slice(Math.max(0, m.index! - 30), m.index! + 30).replace(/\s+/g, ' '));
}

describe('per-skill selection', () => {
  const tests = listTestFiles(REPO_ROOT);
  const splitSuites = tests.filter(t => SPLIT_SUITE_RE.test(t));
  const sharedRule = declaredConsumers('skills/__any__.md');

  test('the shared-rule suites are the ones that read every skill', () => {
    expect(sharedRule).toContain(SHARED_SUITE);
    expect(MANUAL_TOUCHFILES[SHARED_SUITE]).toContain('skills/**');
    for (const t of splitSuites) expect(sharedRule).not.toContain(t);
  });

  // Value: protects=the split's point — one skill's change runs only its own suites plus the shared rules;
  //   fails_when=a split suite reads (or declares) another skill, or a skill change falls back to the whole suite;
  //   why_new=the monolith selected all 612 protocol tests for any skill edit; seam=none
  test('a change to one skill file selects only that skill\'s suites and the shared-rule suites', () => {
    const importsByTest = new Map(tests.map(t => [t, analyzeTestImports(t, REPO_ROOT)]));
    for (const name of EXPECTED_SETUP_SKILLS) {
      const file = `skills/${name}.md`;
      const sel = computeTestSelection([file], tests);
      expect([name, sel.reason]).toEqual([name, 'diff']);
      // A suite that imports the skill as text (init-bin reads gstack-extend-init.md) is that skill's suite too.
      const importers = tests.filter(t => importsByTest.get(t)!.includes(file));
      expect([name, sel.selected]).toEqual([name, [...new Set([...declaredConsumers(file), ...importers])].sort()]);
      for (const t of sharedRule) expect([name, sel.selected]).toEqual([name, expect.arrayContaining([t])]);
      const otherSkillSuites = sel.selected.filter(t => SPLIT_SUITE_RE.test(t) && !MANUAL_TOUCHFILES[t]!.includes(file));
      expect([name, otherSkillSuites]).toEqual([name, []]);
      const own = `tests/skill-protocols-${name}.test.ts`;
      if (splitSuites.includes(own)) expect([name, sel.selected]).toEqual([name, expect.arrayContaining([own])]);
    }
    // The acceptance case, spelled out.
    const roadmap = computeTestSelection(['skills/roadmap.md'], tests).selected.filter(t => t.startsWith('tests/skill-protocols'));
    expect(roadmap).toEqual(['tests/skill-protocols-project-spec.test.ts', 'tests/skill-protocols-roadmap.test.ts', SHARED_SUITE]);
  });

  test('the read lint names literal skill paths and flags every computed one', () => {
    const literal = [
      "join(ROOT, 'skills', 'roadmap.md')",
      'join(ROOT, "skills", "implement.md")',
      "read('skills/pair-review.md')",
      'read("skills/full-review.md")',
      "resolverSkillText('ship-and-land')",
    ].join(';\n');
    expect(namedSkills(literal)).toEqual(['full-review', 'implement', 'pair-review', 'roadmap', 'ship-and-land']);
    expect(computedSkillReads(literal)).toEqual([]);
    for (const computed of [
      "readdirSync(join(ROOT, 'skills'))",
      'join(ROOT, "skills", file)',
      "join(ROOT, 'skills', `${name}.md`)",
      "'skills/' + name + '.md'",
      'readFileSync(`skills/${name}.md`)',
      'resolverSkillText(name)',
    ]) expect([computed, computedSkillReads(computed).length]).toEqual([computed, 1]);
  });

  test('each split suite declares exactly the skill files it names, and none reads a skill by a computed path', () => {
    const problems: string[] = [];
    for (const t of [...splitSuites, SHARED_SUITE]) {
      const source = readFileSync(join(REPO_ROOT, t), 'utf8');
      const declared = (MANUAL_TOUCHFILES[t] ?? []).filter(g => g.startsWith('skills/'));
      if (t === SHARED_SUITE) {
        if (!declared.includes('skills/**')) problems.push(`${t}: must declare skills/**`);
        continue;
      }
      for (const hit of computedSkillReads(source)) problems.push(`${t}: reads a skill through a computed path (…${hit}…); name the file, or move the test to ${SHARED_SUITE}`);
      const named = namedSkills(source).map(n => `skills/${n}.md`);
      const missing = named.filter(f => !declared.some(g => matchGlob(f, g)));
      const stale = declared.filter(g => !named.some(f => matchGlob(f, g)));
      if (missing.length) problems.push(`${t}: reads ${missing.join(', ')} without declaring it`);
      if (stale.length) problems.push(`${t}: declares ${stale.join(', ')} but never names it`);
    }
    expect(problems).toEqual([]);
  });
});

describe('release selection', () => {
  const tests = listTestFiles(REPO_ROOT);

  // Value: protects=a release commit runs the checks its three files can break, not the whole suite;
  //   fails_when=VERSION, CHANGELOG.md or a version-only package.json change becomes global again, or the release check loses its inputs;
  //   why_new=#162's release commit ran all 3,950 tests because package.json was global; seam=none
  test('a version-only release commit selects only the release and manifest checks', () => {
    const sel = computeTestSelection(RELEASE_INPUTS, tests, { packageJsonVersionOnly: true });
    expect(sel.reason).toBe('diff');
    const releaseChecks = [...new Set(RELEASE_INPUTS.flatMap(declaredConsumers))].sort();
    expect(sel.selected).toEqual(releaseChecks);
    expect(sel.selected).toContain('tests/release-manifest.test.ts');
    expect(sel.selected.filter(t => t.startsWith('tests/skill-protocols'))).toEqual([]);
    expect(sel.skipped.length).toBeGreaterThan(sel.selected.length);
    for (const input of RELEASE_INPUTS) expect(MANUAL_TOUCHFILES['tests/release-manifest.test.ts']).toContain(input);
  });

  test('a package.json dependency or script change still selects everything', () => {
    const sel = computeTestSelection(RELEASE_INPUTS, tests);
    expect(sel.reason).toBe('global: package.json matches package.json');
    expect(sel.selected).toEqual(tests);
    // Only package.json narrows; the lockfile and tsconfig stay global either way.
    expect(computeTestSelection(['bun.lock'], tests, { packageJsonVersionOnly: true }).reason).toStartWith('global');
  });
});

describe('pregate dependencies', () => {
  test('the sync keeps a no-lane-needed [] entry and replaces every other edge from the map', () => {
    const current = JSON.stringify({ runner: 'x {files}', dependencies: { 'docs/notes/**': [], 'stale/glob': ['tests/gone.test.ts'] } });
    const deps = JSON.parse(syncedPregateConfig(current)).dependencies as Record<string, string[]>;
    expect(deps['docs/notes/**']).toEqual([]);
    expect(deps['stale/glob']).toBeUndefined();
    expect(deps['skills/roadmap.md']).toEqual(pregateDependencies()['skills/roadmap.md']);
    expect(Object.keys(deps)).toEqual([...Object.keys(deps)].sort());
  });

  test(`${PREGATE_CONFIG} dependencies are MANUAL_TOUCHFILES inverted`, () => {
    const current = readFileSync(join(REPO_ROOT, PREGATE_CONFIG), 'utf8');
    // Out of date: run `bun scripts/sync-pregate-deps.ts`.
    expect(current).toBe(syncedPregateConfig(current));
    const deps = pregateDependencies();
    for (const [testFile, globs] of Object.entries(MANUAL_TOUCHFILES)) {
      for (const g of globs) expect(deps[g]).toContain(testFile);
    }
    expect(deps['skills/roadmap.md']).toEqual(declaredConsumers('skills/roadmap.md').filter(t => MANUAL_TOUCHFILES[t]!.includes('skills/roadmap.md')));
  });

  // Value: protects=an owned glob listed as [] stays filled from the map; a non-array value and a missing dependencies key are ignored;
  //   fails_when=sync copies [] over a mapped glob, keeps a non-array previous value, or drops the map when dependencies is absent;
  //   why_new=the existing pregate test only keeps an unowned [] and drops a stale non-empty list; seam=none;
  //   no_claim=the CLI exit code and whether the file is written (syncedPregateConfig text only).
  test('an owned empty glob stays filled from the map, and a non-array or missing dependencies key is ignored', () => {
    const owned = 'skills/roadmap.md';
    const kept = 'docs/notes/**';
    const map = pregateDependencies();
    expect(map[owned]!.length).toBeGreaterThan(0);
    const deps: Record<string, string[]> = { ...map, [kept]: [] };
    const sorted = Object.fromEntries(Object.keys(deps).sort().map(glob => [glob, deps[glob]!]));
    const merged = JSON.stringify({ runner: 'x {files}', dependencies: sorted }, null, 2) + '\n';
    const withPrevious = JSON.stringify({
      runner: 'x {files}',
      dependencies: { [owned]: [], [kept]: [], 'not-a-list': 'nope', 'also-bad': { a: 1 }, 'null-bad': null },
    });
    expect(syncedPregateConfig(withPrevious)).toBe(merged);
    const mapOnly = JSON.stringify({ runner: 'x', dependencies: map }, null, 2) + '\n';
    expect(syncedPregateConfig(JSON.stringify({ runner: 'x' }))).toBe(mapOnly);
    expect(syncedPregateConfig(JSON.stringify({ runner: 'x', dependencies: null }))).toBe(mapOnly);
  });

  // Value: protects=--check exits 1 and writes nothing when regenerated text differs, exits 0 when it matches, and a normal run writes only when the text changes;
  //   fails_when=--check rewrites the file or exits 0 while stale, or a normal run writes when the text is already current;
  //   why_new=the unit comparison never spawns the CLI, so the exit status and the write guard stay untested; seam=none;
  //   no_claim=which dependency edges are correct (syncedPregateConfig is the text oracle).
  test('the sync CLI --check exits without writing, and a normal run writes only when the text changes', () => {
    const checkout = join(REPO_ROOT, PREGATE_CONFIG);
    const checkoutBefore = readFileSync(checkout, 'utf8');
    const base = makeBaseTmp('pregate-sync-');
    try {
      // The CLI roots itself at the script file, so the copy's repo is this temp tree.
      const root = join(base, 'repo');
      mkdirSync(join(root, 'scripts'), { recursive: true });
      mkdirSync(join(root, 'tests/helpers'), { recursive: true });
      mkdirSync(join(root, '.gstack'), { recursive: true });
      const script = join(root, 'scripts/sync-pregate-deps.ts');
      copyFileSync(join(REPO_ROOT, 'scripts/sync-pregate-deps.ts'), script);
      copyFileSync(join(REPO_ROOT, 'tests/helpers/touchfiles.ts'), join(root, 'tests/helpers/touchfiles.ts'));
      const config = join(root, PREGATE_CONFIG);
      const stale = JSON.stringify({
        runner: 'keep',
        dependencies: { 'docs/notes/**': [], 'skills/roadmap.md': [], 'stale/glob': ['tests/gone.test.ts'] },
      }, null, 2) + '\n';
      writeFileSync(config, stale);
      const run = (args: string[]) => spawnSync(
        'bun',
        ['--no-env-file', '--no-install', '--config=/dev/null', script, ...args],
        { encoding: 'utf8', cwd: root },
      );

      const check = run(['--check']);
      expect(check.status).toBe(1);
      expect(check.stdout).toBe('');
      expect(check.stderr).toBe(`${PREGATE_CONFIG} is out of date; run: bun scripts/sync-pregate-deps.ts\n`);
      expect(readFileSync(config, 'utf8')).toBe(stale);

      const wrote = run([]);
      const next = syncedPregateConfig(stale);
      expect(wrote.status).toBe(0);
      expect(wrote.stderr).toBe('');
      expect(readFileSync(config, 'utf8')).toBe(next);
      expect(wrote.stdout).toBe(`${PREGATE_CONFIG}: ${Object.keys(JSON.parse(next).dependencies).length} dependency globs\n`);

      const frozen = new Date('2020-01-01T00:00:00.000Z');
      utimesSync(config, frozen, frozen);
      const same = run([]);
      expect(same.status).toBe(0);
      expect(same.stderr).toBe('');
      expect(same.stdout).toBe(wrote.stdout);
      expect(readFileSync(config, 'utf8')).toBe(next);
      expect(statSync(config).mtimeMs).toBe(frozen.getTime());

      const fresh = run(['--check']);
      expect(fresh.status).toBe(0);
      expect(fresh.stdout).toBe('');
      expect(fresh.stderr).toBe('');
      expect(readFileSync(config, 'utf8')).toBe(next);
      expect(statSync(config).mtimeMs).toBe(frozen.getTime());
    } finally {
      if (readFileSync(checkout, 'utf8') !== checkoutBefore) writeFileSync(checkout, checkoutBefore);
      rmSync(base, { recursive: true, force: true });
    }
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

  /** A seeded fixture on a `feature` branch whose last commit writes `files`. */
  function featureRepo(seed: Record<string, string>, files: Record<string, string>): string {
    const repo = makeEmptyRepo(baseTmp);
    seedMinimalProject(repo);
    for (const [path, body] of Object.entries(seed)) {
      mkdirSync(join(repo, path, '..'), { recursive: true });
      writeFileSync(join(repo, path), body);
    }
    spawnSync('git', ['-C', repo, 'add', '-A'], { encoding: 'utf8' });
    spawnSync('git', ['-C', repo, 'commit', '-m', 'seed', '--quiet'], { encoding: 'utf8' });
    spawnSync('git', ['-C', repo, 'checkout', '-q', '-b', 'feature'], { encoding: 'utf8' });
    for (const [path, body] of Object.entries(files)) writeFileSync(join(repo, path), body);
    spawnSync('git', ['-C', repo, 'commit', '-qam', 'change'], { encoding: 'utf8' });
    return repo;
  }
  const RELEASE_SEED = {
    VERSION: '1.2.3.0\n',
    'CHANGELOG.md': '# Changelog\n\n## [1.2.3.0] - 2026-01-01\n\n- old\n',
    'tests/release-manifest.test.ts': '\n',
  };

  test('S8 version-only release commit: selects the release check, not the suite', () => {
    const repo = featureRepo(RELEASE_SEED, {
      VERSION: '1.2.4.0\n',
      'CHANGELOG.md': '# Changelog\n\n## [1.2.4.0] - 2026-01-02\n\n- new\n\n## [1.2.3.0] - 2026-01-01\n\n- old\n',
      'package.json': '{\n  "name": "fixture",\n  "version": "1.2.4"\n}\n',
    });
    const action = planWrapperAction({ argv: [], env: {}, cwd: repo });
    expect(action.kind).toBe('select');
    if (action.kind === 'select') expect(action.selected).toEqual(['tests/release-manifest.test.ts']);
    expect(action.report.notes).toContain('package.json: only its version field changed, so it is not a global input');
    expect(action.report.ran).toEqual([{ file: 'tests/release-manifest.test.ts', why: 'CHANGELOG.md (declared CHANGELOG.md); VERSION (declared VERSION); package.json (declared package.json)' }]);
    expect(action.report.skipped.map(e => e.file)).toEqual(['tests/a.test.ts', 'tests/b.test.ts']);
  });

  test('S9 package.json dependency change: still runs everything', () => {
    const repo = featureRepo(RELEASE_SEED, {
      'package.json': '{"name":"fixture","version":"0","devDependencies":{"left-pad":"1.0.0"}}\n',
    });
    const action = planWrapperAction({ argv: [], env: {}, cwd: repo });
    expect(action.kind).toBe('all');
    if (action.kind === 'all') expect(action.reason).toBe('global');
    expect(action.report.notes).toContain('package.json: more than its version field changed, so it is a global input');
    expect(action.report.ran.map(e => e.file)).toEqual(['tests/a.test.ts', 'tests/b.test.ts', 'tests/release-manifest.test.ts']);
    expect(action.report.skipped).toEqual([]);
  });

  test('S10 one skill file: selects its suite and the shared rules, not another skill\'s suite', () => {
    const repo = featureRepo({
      'skills/roadmap.md': 'roadmap\n',
      'skills/pair-review.md': 'pair\n',
      'tests/skill-protocols.test.ts': '\n',
      'tests/skill-protocols-roadmap.test.ts': '\n',
      'tests/skill-protocols-pair-review.test.ts': '\n',
    }, { 'skills/roadmap.md': 'roadmap, edited\n' });
    const action = planWrapperAction({ argv: [], env: {}, cwd: repo });
    expect(action.kind).toBe('select');
    if (action.kind === 'select') expect(action.selected).toEqual(['tests/skill-protocols-roadmap.test.ts', 'tests/skill-protocols.test.ts']);
    expect(action.report.ran).toEqual([
      { file: 'tests/skill-protocols-roadmap.test.ts', why: 'skills/roadmap.md (declared skills/roadmap.md)' },
      { file: 'tests/skill-protocols.test.ts', why: 'skills/roadmap.md (declared skills/**)' },
    ]);
    expect(action.report.skipped.map(e => e.file)).toContain('tests/skill-protocols-pair-review.test.ts');
  });

  test('S11 a caller-chosen file list is reported against the diff selection', () => {
    const repo = featureRepo({}, { 'src/a.ts': 'export const a = 3;\n', 'src/b.ts': 'export const b = 4;\n' });
    const partial = planWrapperAction({ argv: ['tests/a.test.ts'], env: {}, cwd: repo });
    expect(partial.kind).toBe('argv');
    expect(partial.report.ran).toEqual([{ file: 'tests/a.test.ts', why: 'requested by the caller' }]);
    expect(partial.report.skipped).toEqual([{ file: 'tests/b.test.ts', why: 'not requested by the caller; the diff selects it: src/b.ts (import)' }]);
    expect(partial.report.notes).toContain('1 file(s) the diff selects were not requested');
    const full = planWrapperAction({ argv: ['./tests/a.test.ts', 'tests/b.test.ts'], env: {}, cwd: repo });
    expect(full.report.notes).toContain('the request covers the diff selection');
    // Flags or filters are passed through without a file-by-file report.
    const filtered = planWrapperAction({ argv: ['--bail', 'tests/a.test.ts'], env: {}, cwd: repo });
    expect(filtered.report.ran).toEqual([]);
    expect(filtered.report.notes[0]).toContain('not only test file paths');
  });

  // Value: protects=an unmapped change is reported as mode all with one shared reason, not a select report whose why strings are empty;
  //   fails_when=planWrapperAction treats no-match-fallback as a diff selection and emits blank hit reasons;
  //   why_new=computeTestSelection covers the no-match reason, but not the wrapper report mode or its lines; seam=none;
  //   no_claim=a caller file list on that same diff (bare run only).
  test('S12 an unmapped change runs every test with one reason, not a select report of empty whys', () => {
    const repo = featureRepo({ 'notes/stray.txt': 'old\n' }, { 'notes/stray.txt': 'new\n' });
    const action = planWrapperAction({ argv: [], env: {}, cwd: repo });
    expect(action.kind).toBe('all');
    if (action.kind === 'all') expect(action.reason).toBe('no-match-fallback');
    expect(action.report.mode).toBe('all');
    expect(action.report.skipped).toEqual([]);
    expect(action.report.ran).toEqual([
      { file: 'tests/a.test.ts', why: 'no test depends on the changed files, so every test runs' },
      { file: 'tests/b.test.ts', why: 'no test depends on the changed files, so every test runs' },
    ]);
    expect(reportLines(action.report)).toEqual([
      'base main; 1 changed file(s): notes/stray.txt',
      'ran all 2 test file(s): no test depends on the changed files, so every test runs',
    ]);
  });

  // Value: protects=a partial file list says the diff would run every test for an empty, global, or no-match diff, and does not call omitted files diff hits;
  //   fails_when=those runs drop the run-all note or mark a skipped file as selected by the diff;
  //   why_new=S11 only covers a real diff hit the caller left out; seam=none;
  //   no_claim=the bare-run mode-all report for an unmapped change (caller file list only).
  test('S13 a caller file list says when the diff would run every test, and does not call omitted files diff hits', () => {
    const requested = [{ file: 'tests/a.test.ts', why: 'requested by the caller' }];
    const omitted = { file: 'tests/b.test.ts', why: 'not requested by the caller' };

    const empty = makeEmptyRepo(baseTmp);
    seedMinimalProject(empty);
    spawnSync('git', ['-C', empty, 'add', '-A'], { encoding: 'utf8' });
    spawnSync('git', ['-C', empty, 'commit', '--amend', '--no-edit', '--quiet'], { encoding: 'utf8' });
    const emptyAction = planWrapperAction({ argv: ['tests/a.test.ts'], env: {}, cwd: empty });
    expect(emptyAction.kind).toBe('argv');
    if (emptyAction.kind === 'argv') expect(emptyAction.args).toEqual(['tests/a.test.ts']);
    expect(emptyAction.report.mode).toBe('argv');
    expect(emptyAction.report.ran).toEqual(requested);
    expect(emptyAction.report.skipped).toEqual([omitted]);
    expect(emptyAction.report.notes).toEqual(['the diff selection would run every test file (empty-diff)']);

    const globalRepo = featureRepo(RELEASE_SEED, {
      'package.json': '{"name":"fixture","version":"0","devDependencies":{"left-pad":"1.0.0"}}\n',
    });
    const globalAction = planWrapperAction({ argv: ['tests/a.test.ts'], env: {}, cwd: globalRepo });
    expect(globalAction.kind).toBe('argv');
    expect(globalAction.report.mode).toBe('argv');
    expect(globalAction.report.ran).toEqual(requested);
    expect(globalAction.report.skipped).toEqual([
      omitted,
      { file: 'tests/release-manifest.test.ts', why: 'not requested by the caller' },
    ]);
    expect(globalAction.report.notes).toEqual([
      'package.json: more than its version field changed, so it is a global input',
      'the diff selection would run every test file (global: package.json matches package.json)',
    ]);

    const unmatched = featureRepo({ 'notes/stray.txt': 'old\n' }, { 'notes/stray.txt': 'new\n' });
    const unmatchedAction = planWrapperAction({ argv: ['tests/a.test.ts'], env: {}, cwd: unmatched });
    expect(unmatchedAction.kind).toBe('argv');
    expect(unmatchedAction.report.mode).toBe('argv');
    expect(unmatchedAction.report.ran).toEqual(requested);
    expect(unmatchedAction.report.skipped).toEqual([omitted]);
    expect(unmatchedAction.report.notes).toEqual(['the diff selection would run every test file (no-match-fallback)']);
  });
});

describe('selection report', () => {
  const baseTmp = makeBaseTmp('selection-report-');
  afterAll(() => {
    try { rmSync(baseTmp, { recursive: true, force: true }); } catch { /* ignore */ }
  });
  const sample = {
    schema: REPORT_SCHEMA,
    mode: 'select' as const,
    reason: 'diff',
    base: 'origin/main',
    changed: ['skills/roadmap.md'],
    notes: [],
    total: 3,
    ran: [{ file: 'tests/a.test.ts', why: 'skills/roadmap.md (declared skills/**)' }],
    skipped: [
      { file: 'tests/b.test.ts', why: 'no changed file is a dependency' },
      { file: 'tests/c.test.ts', why: 'no changed file is a dependency' },
    ],
  };

  test('stderr lines name every file that ran and every file skipped, with the reason', () => {
    expect(reportLines(sample)).toEqual([
      'base origin/main; 1 changed file(s): skills/roadmap.md',
      'ran tests/a.test.ts: skills/roadmap.md (declared skills/**)',
      'skipped 2 (no changed file is a dependency): tests/b.test.ts, tests/c.test.ts',
    ]);
  });

  test('TEST_SELECTION_OUT gets the same report as JSON, and a failed write is reported, not thrown', () => {
    const out = join(baseTmp, 'nested', 'selection.json');
    expect(writeReport(sample, out)).toBeNull();
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(sample);
    writeFileSync(join(baseTmp, 'file'), 'x');
    expect(writeReport(sample, join(baseTmp, 'file', 'selection.json'))).toBeString();
    // A failed rename (the target is a directory) leaves no temp file beside it.
    mkdirSync(join(baseTmp, 'taken.json'));
    expect(writeReport(sample, join(baseTmp, 'taken.json'))).toBeString();
    expect(readdirSync(baseTmp).filter(n => n.includes('.tmp-'))).toEqual([]);
  });

  test('ran and skipped partition the test files; nothing skipped is listed as ran', () => {
    const action = planWrapperAction({ argv: [], env: {}, cwd: REPO_ROOT });
    const ran = action.report.ran.map(e => e.file);
    const skipped = action.report.skipped.map(e => e.file);
    expect(ran.filter(f => skipped.includes(f))).toEqual([]);
    expect([...ran, ...skipped].sort()).toEqual(listTestFiles(REPO_ROOT));
  });

  // Value: protects=the process writes TEST_SELECTION_OUT when set, skips a blank value, and logs an unwritable path without failing the run;
  //   fails_when=a blank value is written, a good path is skipped, or an unwritable path makes the process exit non-zero;
  //   why_new=writeReport is unit-tested; the entry env gate and its log-and-continue path are not; seam=none;
  //   no_claim=a diff-selection JSON body (the spawn argv is not a test-file list).
  test('the process writes TEST_SELECTION_OUT, skips a blank value, and logs an unwritable path without failing', () => {
    const script = join(REPO_ROOT, 'scripts/select-tests.ts');
    const cwd = join(baseTmp, 'process-cwd');
    mkdirSync(cwd);
    const spawn = (selectionOut: string) => spawnSync(
      'bun',
      ['--no-env-file', '--no-install', '--config=/dev/null', script, '--help'],
      { encoding: 'utf8', cwd, env: { ...process.env, TEST_SELECTION_OUT: selectionOut } },
    );
    const out = join(baseTmp, 'process-out', 'selection.json');
    const wrote = spawn(out);
    expect(wrote.status).toBe(0);
    expect(wrote.stdout).toContain('Usage: bun test');
    expect(wrote.stderr).toContain(`[select-tests] report: ${out}`);
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual({
      schema: REPORT_SCHEMA,
      mode: 'argv',
      reason: 'argv',
      base: null,
      changed: [],
      notes: ['the arguments are not only test file paths, so the run is not reported file by file'],
      total: listTestFiles(REPO_ROOT).length,
      ran: [],
      skipped: [],
    });

    for (const blank of ['', '   ']) {
      const skippedWrite = spawn(blank);
      expect(skippedWrite.status).toBe(0);
      expect(skippedWrite.stdout).toContain('Usage: bun test');
      expect(skippedWrite.stderr).not.toContain('[select-tests] report:');
      expect(skippedWrite.stderr).not.toContain('report not written');
    }
    expect(existsSync(join(cwd, '   '))).toBe(false);

    const blocked = join(baseTmp, 'process-not-a-dir');
    writeFileSync(blocked, 'x');
    const bad = join(blocked, 'selection.json');
    const failed = spawn(bad);
    expect(failed.status).toBe(0);
    expect(failed.stdout).toContain('Usage: bun test');
    expect(failed.stderr).toContain(`[select-tests] report not written to ${bad}:`);
    expect(existsSync(bad)).toBe(false);
  });
});

describe('packageJsonChange', () => {
  const baseTmp = makeBaseTmp('package-json-change-');
  afterAll(() => {
    try { rmSync(baseTmp, { recursive: true, force: true }); } catch { /* ignore */ }
  });
  const BEFORE = '{\n  "name": "x",\n  "version": "1.0.0",\n  "scripts": { "test": "bun test" },\n  "devDependencies": { "ajv": "8.20.0" }\n}\n';
  const repo = makeEmptyRepo(baseTmp);
  writeFileSync(join(repo, 'other.txt'), 'x\n');
  spawnSync('git', ['-C', repo, 'add', '-A'], { encoding: 'utf8' });
  spawnSync('git', ['-C', repo, 'commit', '-qm', 'no-pkg'], { encoding: 'utf8' });
  spawnSync('git', ['-C', repo, 'branch', 'no-pkg'], { encoding: 'utf8' });
  writeFileSync(join(repo, 'package.json'), BEFORE);
  spawnSync('git', ['-C', repo, 'add', '-A'], { encoding: 'utf8' });
  spawnSync('git', ['-C', repo, 'commit', '-qm', 'base'], { encoding: 'utf8' });

  function classify(after: string | null, before: string | null = BEFORE): string {
    const baseRef = before === null ? 'no-pkg' : 'main';
    spawnSync('git', ['-C', repo, 'checkout', '-q', '-B', 'feature', baseRef], { encoding: 'utf8' });
    if (after === null) rmSync(join(repo, 'package.json'), { force: true });
    else writeFileSync(join(repo, 'package.json'), after);
    spawnSync('git', ['-C', repo, 'add', '-A'], { encoding: 'utf8' });
    spawnSync('git', ['-C', repo, 'commit', '-qm', 'change'], { encoding: 'utf8' });
    return packageJsonChange(baseRef, repo);
  }

  test('a version bump, with or without reformatting, is version-only', () => {
    expect(classify(BEFORE.replace('1.0.0', '1.0.1'))).toBe('version-only');
    expect(classify(JSON.stringify(JSON.parse(BEFORE.replace('1.0.0', '2.0.0'))) + '\n')).toBe('version-only');
  });

  test('dependency, script or other field changes are other', () => {
    expect(classify(BEFORE.replace('8.20.0', '8.21.0'))).toBe('other');
    expect(classify(BEFORE.replace('"bun test"', '"bun test tests/"'))).toBe('other');
    expect(classify(BEFORE.replace('1.0.0', '1.0.1').replace('"x"', '"y"'))).toBe('other');
  });

  test('an added, deleted or unparseable manifest is other', () => {
    expect(classify(BEFORE, null)).toBe('other');
    expect(classify(null)).toBe('other');
    expect(classify('{ not json')).toBe('other');
    expect(packageJsonChange('no-such-ref', repo)).toBe('other');
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Recursively enumerate files under `root`, returning paths relative to it.
 * Skips `.git`, `node_modules`, and `dist`/`build` artefact dirs.
 */
describe('bun test deadline', () => {
  test('the wrapper gives every run 30s unless the caller set a timeout', () => {
    expect(TEST_TIMEOUT_MS).toBe('30000');
    expect(bunTestArgs([])).toEqual(['--timeout', '30000']);
    expect(bunTestArgs(['tests/'])).toEqual(['--timeout', '30000', 'tests/']);
    expect(bunTestArgs(['--watch', 'foo'])).toEqual(['--timeout', '30000', '--watch', 'foo']);
    expect(bunTestArgs(['--timeout', '1000', 'foo'])).toEqual(['--timeout', '1000', 'foo']);
    expect(bunTestArgs(['--timeout=1000'])).toEqual(['--timeout=1000']);
  });
});

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
