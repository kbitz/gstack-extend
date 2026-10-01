import { basename, dirname, join, relative, resolve } from 'node:path';
import type { DocMoveRecord } from '../audit/checks/doc-location.ts';
import { inventory, type GitGateway } from './git.ts';
import { contains, entry, errno, fold, Refusal, sameSpelling, type FileSystem, type Root, type RefusalCode } from './root.ts';

export const CANONICAL_DIRS = ['docs', 'docs/designs', 'docs/archive'] as const;
export type Directory = { requested: string; resolved: string; exists: boolean };
export type Move = DocMoveRecord & { destination: string; tracking: 'tracked' | 'untracked' | 'plain'; resolvedParent: string | null };
export type External = { requested: string; resolved: string; write: boolean };
export type Preflight = { directories: Directory[]; moves: Move[]; external: External[]; refusals: Refusal[] };
type ResolverFs = Pick<FileSystem, 'lstatSync' | 'statSync' | 'realpathSync'>;

/** Climb only on lstat ENOENT; a dangling link is an entry, never absence. */
export function resolveTarget(root: string, path: string, fs: ResolverFs): { resolved: string; ancestor: string; dev: number } {
  const suffix: string[] = [];
  let current = resolve(root, path);
  for (;;) {
    let st;
    try { st = fs.lstatSync(current); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Refusal('resolve_error', path, errno(error));
      if (dirname(current) === current) throw new Refusal('resolve_error', path, errno(error));
      suffix.unshift(basename(current)); current = dirname(current); continue;
    }
    let actual: string;
    try {
      actual = fs.realpathSync(current);
      if (suffix.length && !fs.statSync(current).isDirectory()) throw Object.assign(new Error('ancestor is not a directory'), { code: 'ENOTDIR' });
    } catch (error) {
      const code = st.isSymbolicLink() && suffix.length && (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? 'beneath_dangling_link' : 'resolve_error';
      throw new Refusal(code, path, errno(error));
    }
    return { resolved: resolve(actual, ...suffix), ancestor: actual, dev: fs.statSync(current).dev };
  }
}

/** Exact directory-entry spelling, with only Git's precomposeUnicode exception. */
export function probeSpelling(root: string, path: string, precompose: boolean, fs: Pick<FileSystem, 'lstatSync' | 'readdirSync'>): void {
  let parent = root;
  for (const component of path.split('/')) {
    if (component === '.' || !component) continue;
    const full = join(parent, component);
    if (!entry(full, fs)) return;
    const names = fs.readdirSync(parent);
    if (!names.some(name => sameSpelling(name, component, precompose))) {
      const actual = names.find(name => fold(name) === fold(component)) ?? '(no matching directory entry)';
      throw new Refusal('source_spelling', path, `on-disk spelling is ${actual}; requested ${component}`);
    }
    parent = full;
  }
}

export function checkSource(root: Root, source: string, fs: FileSystem): void {
  const st = entry(join(root.path, source), fs);
  if (!st) throw new Refusal('resolve_error', source, 'ENOENT: source disappeared');
  if (st.isSymbolicLink()) throw new Refusal('source_symlink', source, 'source is a symlink');
  if (!st.isFile()) throw new Refusal('preflight_type', source, 'source is not a regular file');
  let component = root.path;
  for (const name of source.split('/').slice(0, -1)) {
    component = join(component, name);
    const parent = fs.lstatSync(component);
    if (parent.isSymbolicLink() || !parent.isDirectory()) throw new Refusal('source_component', source, `source component ${component} is not a real directory`);
    if (entry(join(component, '.git'), fs)) throw new Refusal('source_component', source, `source component ${component} contains a .git entry`);
  }
  probeSpelling(root.path, source, root.precompose, fs);
}

function checkResolved(root: Root, path: string, actual: string, fs: FileSystem): void {
  if (root.gitDirs.some(dir => contains(dir, actual))) throw new Refusal('git_dir_target', path, 'target is inside a Git or common directory', actual);
  if (!contains(root.path, actual)) return;
  let current = root.path;
  for (const component of relative(root.path, actual).split('/').filter(Boolean)) {
    current = join(current, component);
    if (entry(join(current, '.git'), fs)) throw new Refusal('nested_repo', path, `resolved component ${current} contains a .git entry`, actual);
  }
}

export function preflight(root: Root, records: DocMoveRecord[], fs: FileSystem, git: GitGateway, scaffoldOnly: boolean): Preflight {
  const refusals: Refusal[] = [];
  const failed = new Set<string>();
  const failedAt = (path: string) => [...failed].some(parent => parent === path || path.startsWith(`${parent}/`));
  const add = (error: Refusal) => {
    if (!failedAt(error.path)) { failed.add(error.path); refusals.push(error); }
  };
  const check = (path: string, code: RefusalCode, work: () => void) => {
    if (failedAt(path)) return false;
    try { work(); return true; }
    catch (error) { add(error instanceof Refusal ? error : new Refusal(code, path, errno(error))); return false; }
  };
  const moves: Move[] = records.map(move => ({ ...move, destination: move.destination!, tracking: root.mode === 'plain' ? 'plain' : 'untracked', resolvedParent: null }));
  const paths = new Set<string>(CANONICAL_DIRS);
  for (const move of moves) {
    for (const path of [dirname(move.destination), move.missingParent]) {
      if (!path || path === '.') continue;
      const parts = path.split('/');
      for (let n = 1; n <= parts.length; n++) paths.add(parts.slice(0, n).join('/'));
    }
  }
  const orderedPaths = [...paths].sort((a, b) => a.split('/').length - b.split('/').length || (a < b ? -1 : a > b ? 1 : 0));
  const existing = new Map<string, boolean>();
  // Step 2: type check the whole directory set before any item checks.
  for (const path of orderedPaths) check(path, 'preflight_type', () => {
    const st = entry(join(root.path, path), fs);
    if (st && !fs.statSync(join(root.path, path)).isDirectory()) throw new Refusal('preflight_type', path, 'preflight target is not a directory');
    existing.set(path, st !== null);
    probeSpelling(root.path, path, root.precompose, fs);
  });
  // Step 3: sources, then destinations. First failing check per path wins.
  for (const move of moves) check(move.source, 'resolve_error', () => checkSource(root, move.source, fs));
  const destinations = new Map<string, Move>();
  for (const move of moves) {
    if (failedAt(move.source)) continue;
    check(move.destination, 'resolve_error', () => {
      if (entry(join(root.path, move.destination), fs)) throw new Refusal('dest_exists', move.destination, `destination already exists for ${move.source}`);
      const key = fold(move.destination);
      const duplicate = destinations.get(key);
      if (duplicate) throw new Refusal('dest_duplicate', move.destination, `duplicate destinations for ${duplicate.source} and ${move.source}`);
      destinations.set(key, move);
      if (move.destination.split('/').includes('.git')) throw new Refusal('dest_git', move.destination, 'destination includes a .git component');
      probeSpelling(root.path, move.destination, root.precompose, fs);
    });
  }
  // Step 4: bind resolved targets, including internal links, to the plan id.
  const directories: Directory[] = [];
  const resolvedDirs = new Map<string, ReturnType<typeof resolveTarget>>();
  for (const path of orderedPaths) check(path, 'resolve_error', () => {
    const target = resolveTarget(root.path, path, fs);
    checkResolved(root, path, target.resolved, fs);
    resolvedDirs.set(path, target);
    directories.push({ requested: path, resolved: target.resolved, exists: existing.get(path)! });
  });
  resolvedDirs.set('.', { resolved: root.path, ancestor: root.path, dev: fs.statSync(root.path).dev });
  for (const move of moves) {
    if (!failedAt(move.destination)) move.resolvedParent = resolvedDirs.get(dirname(move.destination))?.resolved ?? null;
  }
  // Step 5: one NUL-delimited inventory controls all tracking decisions.
  if (root.mode === 'git') {
    try {
      const index = inventory(git, root.path);
      const writes = [...CANONICAL_DIRS, ...moves.map(move => move.destination)];
      for (const item of index.filter(item => item.mode === '160000')) {
        for (const path of writes) if (path === item.path || path.startsWith(`${item.path}/`)) {
          check(path, 'gitlink', () => { throw new Refusal('gitlink', path, `gitlink at ${item.path}`); });
        }
      }
      for (const move of moves) {
        const items = index.filter(item => sameSpelling(item.path, move.source, root.precompose));
        move.tracking = items.length ? 'tracked' : 'untracked';
        if (failedAt(move.source) || failedAt(move.destination)) continue;
        check(move.source, 'tracking_probe', () => {
          const variant = index.find(item => fold(item.path) === fold(move.source) && !sameSpelling(item.path, move.source, root.precompose));
          if (variant) throw new Refusal('source_spelling', move.source, `index spelling is ${variant.path}`);
          if (items.some(item => item.stage !== 0)) throw new Refusal('unmerged_source', move.source, 'source has unmerged index stages');
          if (items.some(item => item.tag === 'S')) throw new Refusal('skip_worktree', move.source, 'source has the skip-worktree bit');
        });
        if (failedAt(move.source)) continue;
        check(move.destination, 'tracking_probe', () => {
          const variant = index.find(item => fold(item.path) === fold(move.destination) && !sameSpelling(item.path, move.destination, root.precompose));
          if (variant) throw new Refusal('source_spelling', move.destination, `index spelling is ${variant.path}`);
          const key = fold(move.destination);
          const conflict = index.find(item => key === fold(item.path) || key.startsWith(`${fold(item.path)}/`) || fold(item.path).startsWith(`${key}/`));
          if (conflict) throw new Refusal('dest_in_index', move.destination, `destination conflicts with index entry ${conflict.path}`);
          if (move.tracking !== 'tracked') return;
          let current = root.path;
          for (const component of move.destination.split('/').slice(0, -1)) {
            current = join(current, component);
            if (entry(current, fs)?.isSymbolicLink()) throw new Refusal('tracked_through_link', move.destination, `tracked move through link ${current}`);
          }
          const ancestor = resolvedDirs.get(dirname(move.destination));
          if (ancestor && fs.statSync(join(root.path, move.source)).dev !== ancestor.dev) throw new Refusal('cross_device', move.destination, `tracked move crosses devices from ${move.source}`, move.resolvedParent ?? undefined);
        });
      }
      if (moves.some(move => move.tracking === 'tracked')) {
        const lock = git.run(['rev-parse', '--git-path', 'index.lock'], root.path);
        if (lock.status !== 0) throw new Refusal('tracking_probe', root.path, lock.stderr);
        const lockPath = resolve(root.path, lock.stdout.replace(/\n$/, ''));
        if (entry(lockPath, fs)) add(new Refusal('index_locked', lockPath, 'index lock exists while a tracked move is planned'));
        const sparse = git.run(['config', '--bool', '--get', 'core.sparseCheckout'], root.path);
        if (sparse.status !== 0 && sparse.status !== 1) throw new Refusal('tracking_probe', root.path, sparse.stderr);
        if (sparse.stdout.trim() === 'true') add(new Refusal('sparse_checkout', root.path, 'tracked moves in a sparse checkout require manual work'));
      }
    } catch (error) { add(error instanceof Refusal ? error : new Refusal('tracking_probe', root.path, errno(error))); }
  }
  const external = directories.filter(dir => !contains(root.path, dir.resolved)).map(dir => ({
    requested: dir.requested, resolved: dir.resolved,
    write: !dir.exists || (scaffoldOnly && CANONICAL_DIRS.includes(dir.requested as typeof CANONICAL_DIRS[number]))
      || moves.some(move => move.destination.startsWith(`${dir.requested}/`)),
  }));
  return { directories, moves, external, refusals };
}
