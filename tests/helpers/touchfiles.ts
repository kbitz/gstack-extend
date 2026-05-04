/**
 * touchfiles.ts — diff-based test selection.
 *
 * Hybrid model: a static TS import graph for `tests/*.test.ts` →
 * `src/**`/`scripts/**` edges, plus a small manual map for non-TS deps
 * (shell binaries, fixture trees, skill files, the `setup` script).
 *
 * The wrapper at `scripts/select-tests.ts` consumes this module:
 *
 *   1. Detect base branch (TOUCHFILES_BASE > origin/main > origin/master > main > master).
 *   2. `git diff base...HEAD --name-status` → changed files (renames keep both sides).
 *   3. computeTestSelection() returns {selected, skipped, reason}.
 *   4. Wrapper spawns `bun test ${selected}` and propagates exit + signals.
 *
 * Four safety fallbacks force run-all:
 *   1. empty diff (no commits ahead of base)        → reason: 'empty-diff'
 *   2. base branch missing                          → wrapper-side
 *   3. any changed file matches GLOBAL_TOUCHFILES   → reason: 'global: ...'
 *   4. non-empty diff but zero tests selected       → reason: 'no-match-fallback'
 *
 * EVALS_ALL=1 env bypasses selection entirely (also wrapper-side).
 *
 * Selection wrongness manifests as a green run that should have been red.
 * Three invariants in `tests/touchfiles.test.ts` defend against silent drift:
 *   - every glob in MANUAL_TOUCHFILES + GLOBAL_TOUCHFILES matches ≥1 file
 *   - every test reachable via import graph or manual map (or by changing
 *     the test file itself, which we treat as trivially reachable)
 *   - every MANUAL_TOUCHFILES key resolves to an existing test file path
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const REPO_ROOT_DEFAULT = resolve(import.meta.dir, '..', '..');

// ─── Glob matching ──────────────────────────────────────────────────────

/**
 * Match a POSIX-style file path against a glob pattern.
 *
 *   `*`  matches any sequence within a single segment (no `/`).
 *   `**` matches any number of segments (including zero).
 *
 * No brace expansion, no character classes. Patterns are anchored on both
 * ends. The implementation rewrites globs into a regex; ordering of the
 * substitutions matters (`**` first, then `*`).
 */
export function matchGlob(file: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');
  return new RegExp(`^${regexStr}$`).test(file);
}

// ─── Touchfile maps ─────────────────────────────────────────────────────

/**
 * Manual non-TS dependencies — keyed by test path (relative to repo root).
 *
 * Only entries that the static import-graph cannot capture belong here:
 *   - shell binaries the test invokes (`bin/roadmap-audit`, `bin/update-*`)
 *   - fixture trees the test reads at runtime (`tests/roadmap-audit/**`)
 *   - markdown the test loads (`skills/*.md`, `setup`)
 *   - directory-walk lints with no static imports
 *     (audit-locale-safety, audit-no-stray-shellouts walk `src/audit/**`)
 *
 * The TS import graph already covers everything `import`-able. Keep this
 * list small — every entry is hand-maintained drift surface.
 */
export const MANUAL_TOUCHFILES: Record<string, string[]> = {
  'tests/audit-snapshots.test.ts': [
    'bin/roadmap-audit',
    'src/audit/**',
    'tests/roadmap-audit/**',
  ],
  'tests/audit-cli-contract.test.ts': [
    'bin/roadmap-audit',
    'src/audit/**',
  ],
  'tests/audit-invariants.test.ts': [
    'tests/roadmap-audit/**',
  ],
  'tests/audit-locale-safety.test.ts': [
    'src/audit/**',
  ],
  'tests/audit-no-stray-shellouts.test.ts': [
    'src/audit/**',
  ],
  'tests/source-tag.test.ts': [
    'tests/fixtures/source-tag-hash-corpus.json',
  ],
  'tests/skill-protocols.test.ts': [
    'skills/**',
    'setup',
  ],
  'tests/test-plan.test.ts': [
    'skills/test-plan.md',
  ],
  'tests/test-plan-extractor.test.ts': [
    'skills/test-plan.md',
    'tests/fixtures/extractor-corpus/**',
  ],
  'tests/test-plan-e2e.test.ts': [
    'skills/test-plan.md',
    'skills/pair-review.md',
  ],
  'tests/score-extractor.test.ts': [
    'tests/fixtures/extractor-corpus/**',
  ],
  'tests/update.test.ts': [
    'bin/update-check',
    'bin/update-run',
    'setup',
  ],
  'tests/skill-llm-eval.test.ts': [
    'tests/fixtures/skill-prose-corpus/**',
  ],
};

/**
 * GLOBAL_TOUCHFILES — when any of these match a changed file, run the
 * entire suite. Reserve for things every test indirectly depends on.
 *
 * Self-reference (`touchfiles.ts`) is intentional: misclassifying changes
 * to the selection logic as "narrow" is the failure mode that defeats the
 * whole feature.
 */
export const GLOBAL_TOUCHFILES: string[] = [
  'tests/helpers/touchfiles.ts',
  'tests/helpers/fixture-repo.ts',
  'tests/helpers/run-bin.ts',
  'package.json',
  'tsconfig.json',
];

// ─── Static TS import graph ─────────────────────────────────────────────

/**
 * Match `import type` lines that Bun.Transpiler.scanImports erases (because
 * they vanish at runtime). We still want to count them as deps — a test
 * that consumes a type from `src/foo.ts` should re-run when the type
 * shape changes.
 *
 * Patterns covered (from `tsc` grammar):
 *   import type X from '...'
 *   import type { X, Y } from '...'
 *   import type * as X from '...'
 *
 * Mixed forms (`import { x, type Y } from '...'`) are picked up by
 * scanImports — only fully type-only lines need this regex.
 */
const TYPE_IMPORT_RE = /^[ \t]*import[ \t]+type[ \t]+(?:\{[^}]*\}|\*[ \t]+as[ \t]+\w+|\w+)[ \t]+from[ \t]+['"]([^'"]+)['"]/gm;

function scanTypeOnlyImports(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(TYPE_IMPORT_RE)) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

/**
 * Walk the static TypeScript import graph from `testFile` and return every
 * reachable file (relative to `repoRoot`, excluding the test file itself).
 *
 * Uses Bun.Transpiler.scanImports for value + dynamic imports, plus a
 * regex supplement for type-only imports (which Bun erases). Specifiers
 * that don't start with `.` (node:, bun:, npm packages) are ignored.
 * Extensionless specifiers fall back to probing `.ts` then `/index.ts`;
 * this codebase always uses explicit `.ts` so the fallback is mostly
 * defensive.
 */
export function analyzeTestImports(testFile: string, repoRoot: string = REPO_ROOT_DEFAULT): string[] {
  const visited = new Set<string>();
  const out = new Set<string>();
  const root = resolve(testFile)
    .startsWith(resolve(repoRoot))
    ? resolve(testFile)
    : resolve(repoRoot, testFile);
  const queue: string[] = [root];
  const transpiler = new Bun.Transpiler({ loader: 'ts' });

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);

    let src: string;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    const rel = relative(repoRoot, file);
    if (file !== root) out.add(rel);

    const specs: string[] = [];
    try {
      for (const imp of transpiler.scanImports(src)) specs.push(imp.path);
    } catch {
      // Transpiler can throw on malformed syntax — fall through to the regex
      // supplement, which is more permissive.
    }
    for (const s of scanTypeOnlyImports(src)) specs.push(s);

    for (const spec of specs) {
      if (!spec.startsWith('.')) continue;
      const candidate = resolve(dirname(file), spec);
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        queue.push(candidate);
        continue;
      }
      // Defensive fallback for extensionless or directory-style imports.
      const tsAlt = candidate.endsWith('.ts') ? null : `${candidate}.ts`;
      if (tsAlt && existsSync(tsAlt)) {
        queue.push(tsAlt);
        continue;
      }
      const indexAlt = join(candidate, 'index.ts');
      if (existsSync(indexAlt)) {
        queue.push(indexAlt);
      }
    }
  }

  return [...out].sort();
}

// ─── Selection ──────────────────────────────────────────────────────────

/**
 * Enumerate `tests/*.test.ts` (top-level only — nested helpers don't run
 * as tests). Returns paths relative to `repoRoot`, sorted lexicographically.
 */
export function listTestFiles(repoRoot: string = REPO_ROOT_DEFAULT): string[] {
  const dir = join(repoRoot, 'tests');
  return readdirSync(dir)
    .filter(n => n.endsWith('.test.ts'))
    .map(n => `tests/${n}`)
    .sort();
}

export type Selection = {
  selected: string[];
  skipped: string[];
  reason: string;
};

export type SelectionOptions = {
  repoRoot?: string;
  manual?: Record<string, string[]>;
  globals?: string[];
};

/**
 * Compute which tests to run given a list of changed files.
 *
 * Order of fallbacks matches the contract documented at the top of this
 * file. Selection is conservative: anything ambiguous → run.
 */
export function computeTestSelection(
  changedFiles: string[],
  testFiles: string[],
  options: SelectionOptions = {},
): Selection {
  const repoRoot = options.repoRoot ?? REPO_ROOT_DEFAULT;
  const manual = options.manual ?? MANUAL_TOUCHFILES;
  const globals = options.globals ?? GLOBAL_TOUCHFILES;

  if (changedFiles.length === 0) {
    return { selected: [...testFiles], skipped: [], reason: 'empty-diff' };
  }

  for (const f of changedFiles) {
    const hit = globals.find(g => matchGlob(f, g));
    if (hit) {
      return { selected: [...testFiles], skipped: [], reason: `global: ${f} matches ${hit}` };
    }
  }

  const selected: string[] = [];
  const skipped: string[] = [];
  for (const t of testFiles) {
    const tsDeps = analyzeTestImports(t, repoRoot);
    const manualDeps = manual[t] ?? [];
    const selfHit = changedFiles.includes(t);
    const tsHit = changedFiles.some(f => tsDeps.includes(f));
    const manualHit = changedFiles.some(f => manualDeps.some(g => matchGlob(f, g)));
    if (selfHit || tsHit || manualHit) {
      selected.push(t);
    } else {
      skipped.push(t);
    }
  }

  if (selected.length === 0) {
    return { selected: [...testFiles], skipped: [], reason: 'no-match-fallback' };
  }

  return { selected, skipped, reason: 'diff' };
}

// ─── Base branch + diff ─────────────────────────────────────────────────

/**
 * Detect the base branch the current HEAD diverged from.
 *
 * Precedence: TOUCHFILES_BASE env (any ref, including stacked-branch
 * names) → origin/main → origin/master → main → master. Returns null
 * when none of those refs resolve — wrapper interprets as fallback 2
 * (run-all + log).
 */
export function detectBaseBranch(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const override = env.TOUCHFILES_BASE;
  if (override && override.trim() !== '') {
    const r = spawnSync('git', ['-C', cwd, 'rev-parse', '--verify', override], {
      stdio: 'pipe',
      timeout: 3000,
    });
    if (r.status === 0) return override;
    return null;
  }
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
    const r = spawnSync('git', ['-C', cwd, 'rev-parse', '--verify', ref], {
      stdio: 'pipe',
      timeout: 3000,
    });
    if (r.status === 0) return ref;
  }
  return null;
}

/**
 * `git diff base...HEAD --name-status` → list of changed paths. For
 * renames (R<percent>) and copies (C<percent>), BOTH the old and new path
 * are returned so a refactored file matches touchfile globs on either
 * side. Returns [] on git failure.
 */
export function getChangedFiles(baseBranch: string, cwd: string): string[] {
  const r = spawnSync(
    'git',
    ['-C', cwd, 'diff', '--name-status', `${baseBranch}...HEAD`],
    { stdio: 'pipe', timeout: 5000, encoding: 'utf8' },
  );
  if (r.status !== 0) return [];
  return parseDiffNameStatus(r.stdout);
}

/**
 * Parse `git diff --name-status` output. Tab-separated lines:
 *   M\tpath              — modify
 *   A\tpath              — add
 *   D\tpath              — delete
 *   T\tpath              — type change
 *   R<percent>\told\tnew — rename (returns BOTH paths)
 *   C<percent>\told\tnew — copy   (returns BOTH paths)
 */
export function parseDiffNameStatus(stdout: string): string[] {
  const out: string[] = [];
  for (const raw of stdout.split('\n')) {
    if (!raw) continue;
    const parts = raw.split('\t');
    const status = parts[0] ?? '';
    if ((status.startsWith('R') || status.startsWith('C')) && parts.length >= 3) {
      const oldPath = parts[1];
      const newPath = parts[2];
      if (oldPath) out.push(oldPath);
      if (newPath) out.push(newPath);
    } else if (parts.length >= 2 && parts[1]) {
      out.push(parts[1]);
    }
  }
  return out;
}
