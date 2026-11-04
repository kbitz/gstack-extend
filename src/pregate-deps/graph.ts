import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

export const PY_TEST_FILE_RE = /(?:^|\/)test_[^/]*\.py$|_test\.py$/;
const TEST_TREE_RE = /(?:^|\/)(?:test|tests|spec|__tests__)\//;
const QUOTED_RE = /['"`]((?:\.\.?\/)*[A-Za-z0-9_@][A-Za-z0-9_./@()[\]+-]*)['"`]/g;
const PY_IMPORT_RE = /(?:^|[;:])[ \t\f]*(?:from[ \t]+(\.+(?:\w[\w.]*)?|\w[\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n;]+)|import[ \t]+([^\n;]+))/gm;
const PY_DOTTED_RE = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$/;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

export function isPyTestFile(rel: string): boolean {
  return PY_TEST_FILE_RE.test(rel);
}

export function scansLiterals(rel: string): boolean {
  return TEST_TREE_RE.test(rel) || isPyTestFile(rel) || rel.startsWith('bin/');
}

/**
 * Python source with every string literal blanked to `''` and every comment
 * dropped in one linear pass, honouring backslash escapes and triple quotes.
 */
export function pythonCode(source: string): string {
  const parts: string[] = [];
  let from = 0;
  for (let i = 0; i < source.length;) {
    const c = source[i]!;
    if (c === '#') {
      parts.push(source.slice(from, i));
      const end = source.indexOf('\n', i);
      i = from = end < 0 ? source.length : end;
      continue;
    }
    if (c !== '"' && c !== "'") {
      i++;
      continue;
    }
    parts.push(source.slice(from, i), "''");
    const close = source.startsWith(c + c + c, i) ? c + c + c : c;
    let j = i + close.length;
    while (j < source.length && !source.startsWith(close, j) && (close.length === 3 || source[j] !== '\n')) {
      j += source[j] === '\\' ? 2 : 1;
    }
    i = from = Math.min(source.length, source.startsWith(close, j) ? j + close.length : j);
  }
  parts.push(source.slice(from));
  return parts.join('');
}

function pyNames(list: string): string[] {
  return list
    .replace(/[()]/g, '')
    .split(',')
    .map(p => p.trim().split(/\s+/)[0]!)
    .filter(n => n && n !== '*');
}

function pyFromBase(rel: string, spec: string): string | null {
  const dots = /^\.*/.exec(spec)![0].length;
  const rest = spec.slice(dots);
  if (!dots) return rest;
  const pkg = posix.dirname(rel).split('/').filter(s => s !== '.');
  if (dots - 1 > pkg.length) return null;
  return [...pkg.slice(0, pkg.length - (dots - 1)), ...(rest ? [rest] : [])].join('.');
}

export interface PyImportSpec {
  mod: string;
  relative: boolean;
}

export function pythonImports(rel: string, source: string): PyImportSpec[] {
  const code = pythonCode(source).replace(/\\\r?\n/g, ' ');
  const out: PyImportSpec[] = [];
  for (const m of code.matchAll(PY_IMPORT_RE)) {
    if (m[3]) {
      for (const name of pyNames(m[3])) out.push({ mod: name, relative: false });
      continue;
    }
    const spec = m[1]!;
    const relative = spec.startsWith('.');
    const base = pyFromBase(rel, spec);
    if (base === null) continue;
    if (base) out.push({ mod: base, relative });
    for (const name of pyNames(m[2]!)) {
      out.push({ mod: base ? `${base}.${name}` : name, relative });
    }
  }
  return out;
}

function pythonModuleFilesInBase(files: Set<string>, base: string, dotted: string, maxDepth: number): string[] {
  const parts = dotted.split('.');
  if (parts.length > maxDepth || parts.some(p => !p)) return [];
  const prefix = base ? `${base}/` : '';
  const p = `${prefix}${parts.join('/')}`;
  const found = [`${p}/__init__.py`, `${p}.py`].filter(f => files.has(f));
  if (!found.length) return [];
  const inits = parts
    .slice(0, -1)
    .map((_, i) => `${prefix}${parts.slice(0, i + 1).join('/')}/__init__.py`)
    .filter(f => files.has(f));
  return [...found, ...inits];
}

function pythonPatchTargetInBase(files: Set<string>, base: string, ref: string, maxDepth: number): string[] {
  const parts = ref.split('.').slice(0, maxDepth);
  for (let n = parts.length; n >= 1; n--) {
    const hit = pythonModuleFilesInBase(files, base, parts.slice(0, n).join('.'), maxDepth);
    if (hit.length) return hit;
  }
  return [];
}

/**
 * Pure import-graph closure for Python modules under declared source roots.
 * Maps each non-test `.py` module under a declared root to the sorted list of
 * Python test files that depend on it directly or transitively through
 * non-test Python files.
 */
export function generate(sources: Map<string, string>, roots: string[] = ['src']): Record<string, string[]> {
  const normRoots = [...new Set(roots.map(r => r.replace(/\/+$/, '')).filter(Boolean))];
  const bases = ['', ...normRoots];
  const files = new Set([...sources.keys()].filter(f => f.endsWith('.py')));
  const tests = new Set([...files].filter(isPyTestFile));
  let maxDepth = 0;
  for (const f of files) maxDepth = Math.max(maxDepth, f.split('/').length);

  const reverse = new Map<string, Set<string>>();
  const addEdge = (dependency: string, dependent: string) => {
    if (dependency === dependent) return;
    let set = reverse.get(dependency);
    if (!set) {
      set = new Set<string>();
      reverse.set(dependency, set);
    }
    set.add(dependent);
  };

  for (const [rel, source] of sources) {
    if (!files.has(rel)) continue;
    for (const { mod, relative } of pythonImports(rel, source)) {
      if (relative) {
        for (const target of pythonModuleFilesInBase(files, '', mod, maxDepth)) addEdge(target, rel);
      } else {
        for (const base of bases) {
          for (const target of pythonModuleFilesInBase(files, base, mod, maxDepth)) addEdge(target, rel);
        }
      }
    }
    if (scansLiterals(rel)) {
      for (const m of source.matchAll(QUOTED_RE)) {
        const lit = m[1]!;
        if (!PY_DOTTED_RE.test(lit)) continue;
        for (const base of bases) {
          for (const target of pythonPatchTargetInBase(files, base, lit, maxDepth)) addEdge(target, rel);
        }
      }
    }
  }

  const out: Record<string, string[]> = {};
  for (const file of [...files].sort()) {
    if (tests.has(file)) continue;
    if (!normRoots.some(r => file.startsWith(`${r}/`))) continue;
    const reachedTests = new Set<string>();
    const seen = new Set<string>([file]);
    const queue: string[] = [file];
    while (queue.length > 0) {
      const node = queue.shift()!;
      for (const dep of reverse.get(node) ?? []) {
        if (seen.has(dep)) continue;
        seen.add(dep);
        if (tests.has(dep)) reachedTests.add(dep);
        else queue.push(dep);
      }
    }
    if (reachedTests.size > 0) {
      out[file] = [...reachedTests].sort();
    }
  }
  return out;
}

export function cleanGitEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const cleaned = Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('GIT_')));
  return { ...cleaned, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
}

/**
 * Read tracked and untracked-unignored `.py` files from a Git work tree,
 * dropping `node_modules/`, non-regular files, symlinks escaping the work tree,
 * and files over 2 MiB.
 */
export function readPythonSources(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  maxBytes: number = DEFAULT_MAX_BYTES,
): Map<string, string> {
  const res = spawnSync('git', ['-C', repoRoot, 'ls-files', '-co', '--exclude-standard', '-z'], {
    encoding: 'utf8',
    env: cleanGitEnv(env),
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(`git ls-files failed (exit ${res.status ?? 'null'})`);
  }
  const sources = new Map<string, string>();
  let realTop: string | undefined;
  const paths = (res.stdout ?? '').split('\0').filter(p => p && !p.startsWith('node_modules/') && p.endsWith('.py'));
  for (const rel of paths) {
    const abs = join(repoRoot, rel);
    try {
      const lst = lstatSync(abs);
      if (lst.isSymbolicLink()) {
        realTop ??= realpathSync(repoRoot);
        const real = realpathSync(abs);
        if (real !== realTop && !real.startsWith(`${realTop}/`)) continue;
      }
      const st = statSync(abs);
      if (!st.isFile() || st.size > maxBytes) continue;
      sources.set(rel, readFileSync(abs, 'utf8'));
    } catch {
      continue;
    }
  }
  return sources;
}
