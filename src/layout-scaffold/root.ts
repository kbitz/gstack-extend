/**
 * Layout scaffolding defends against hostile repository content and mistakes by
 * a well-meaning caller: filenames, links, nested repositories, submodules,
 * Bun configuration, inherited GIT_* and stale confirmations. A compromised
 * agent and concurrent filesystem changes after preflight are outside the
 * threat model. This is check-then-act, not an atomic transaction.
 * REFUSAL_ACTIONS is the single refusal-code table, also rendered by --help.
 */
import * as fs from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import type { GitGateway } from './git.ts';

export const REFUSAL_ACTIONS = {
  root_invalid: 'choose an existing project directory and pass --root',
  git_unusable: 'repair Git access or repository metadata, then run plan again',
  bad_operand: 'report the invalid audit record; move it by hand',
  preflight_type: 'choose a directory target or reconcile the entry by hand',
  source_symlink: 'review the source link and move it by hand',
  source_component: 'review the source directory and move the item by hand',
  source_spelling: 'use the on-disk spelling and run plan again',
  dest_exists: 'reconcile the destination by hand or exclude the source',
  dest_duplicate: 'exclude one source or choose distinct names by hand',
  dest_git: 'choose a destination outside Git metadata',
  resolve_error: 'repair path access and run plan again',
  beneath_dangling_link: 'review the dangling directory link by hand',
  nested_repo: 'choose a target outside the nested repository',
  tracking_probe: 'repair index access and run plan again',
  gitlink: 'choose a target outside the submodule',
  tracked_through_link: 'move the tracked item by hand outside directory links',
  cross_device: 'move the tracked item across devices by hand',
  authorize_without_external: 'omit --authorize-external and run plan again',
  plan_id_stale: 'run plan again and get a new confirmation',
  internal_error: 'report the failure and run plan again',
  unmerged_source: 'resolve the source conflict or exclude it',
  dest_in_index: 'reconcile the indexed destination or exclude the source',
  index_locked: 'finish the Git operation holding the index lock',
  sparse_checkout: 'move the tracked item by hand in the sparse checkout',
  git_dir_target: 'use paths outside the Git and common directories, or exclude the source',
  exclude_unmatched: 'pass the exact source from the current plan',
  audit_failed: 'repair access to the reported audit path and run plan again',
  index_too_large: 'reduce the index inventory or move the items by hand',
  skip_worktree: 'review the skip-worktree source and move it by hand',
} as const;
export type RefusalCode = keyof typeof REFUSAL_ACTIONS;

export class Refusal extends Error {
  constructor(public code: RefusalCode, public path: string, message: string, public resolved?: string) {
    super(message);
  }
}

export type FileSystem = {
  lstatSync(path: string): fs.Stats;
  statSync(path: string): fs.Stats;
  realpathSync(path: string): string;
  readdirSync(path: string): string[];
  readFileSync(path: string): Buffer;
  accessSync(path: string, mode: number): void;
  mkdirSync(path: string): void;
  linkSync(source: string, destination: string): void;
  unlinkSync(path: string): void;
  copyFileSync(source: string, destination: string, flags: number): void;
  utimesSync(path: string, atime: Date, mtime: Date): void;
};
export const defaultFs: FileSystem = {
  lstatSync: path => fs.lstatSync(path), statSync: path => fs.statSync(path),
  realpathSync: path => fs.realpathSync(path), readdirSync: path => fs.readdirSync(path),
  readFileSync: path => fs.readFileSync(path), accessSync: fs.accessSync,
  mkdirSync: path => { fs.mkdirSync(path); }, linkSync: fs.linkSync, unlinkSync: fs.unlinkSync,
  copyFileSync: fs.copyFileSync, utimesSync: fs.utimesSync,
};

export function errno(error: unknown): string {
  const e = error as NodeJS.ErrnoException;
  return `${e?.code ?? 'ERROR'}: ${e?.message ?? String(error)}${e?.path ? ` (path ${e.path})` : ''}`;
}
export function entry(path: string, lookups: Pick<FileSystem, 'lstatSync'>): fs.Stats | null {
  try { return lookups.lstatSync(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
export const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u034F\uFE00-\uFE0F\u{E0100}-\u{E01EF}\uFFFD]/u;
export function escapeValue(value: string): string {
  return Array.from(value, char => {
    if (char === '\\') return '\\\\';
    if (!HIDDEN.test(char)) return char;
    const point = char.codePointAt(0)!;
    return point <= 0xff ? `\\x${point.toString(16).toUpperCase().padStart(2, '0')}` : `\\u{${point.toString(16).toUpperCase()}}`;
  }).join('');
}
export function contains(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}
export function fold(path: string): string {
  // Per-code-point casing avoids contextual sigma; default folding keeps dotless i distinct.
  return Array.from(path.normalize('NFC'), char =>
    char === '\u0131' ? char : char.toLowerCase().toUpperCase().toLowerCase(),
  ).join('').normalize('NFC');
}
export function sameSpelling(a: string, b: string, precompose: boolean): boolean {
  return precompose ? a.normalize('NFC') === b.normalize('NFC') : a === b;
}
export function checkOperand(path: string): void {
  if (!path || isAbsolute(path) || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Refusal('bad_operand', path, 'audit operand must be a nonempty relative path without . or .. components');
  }
}

export type Root = { path: string; mode: 'git' | 'plain'; gitDirs: string[]; gitTop?: string; precompose: boolean };
export function bindRoot(requested: string | undefined, cwd: string, env: NodeJS.ProcessEnv, fs: FileSystem, git: GitGateway): Root {
  let candidate = requested;
  if (candidate === undefined) {
    const top = git.run(['rev-parse', '--show-toplevel'], cwd);
    candidate = top.status === 0 ? top.stdout.replace(/\n$/, '') : cwd;
  }
  let root: string;
  try {
    if (!candidate) throw new Error('empty root');
    root = fs.realpathSync(resolve(cwd, candidate));
    if (!fs.statSync(root).isDirectory()) throw new Error('root is not a directory');
    if (root === parse(root).root) throw new Error('filesystem root is not a project root');
    if (env.HOME) {
      let home: string | undefined;
      try { home = fs.realpathSync(env.HOME); } catch {}
      if (root === home) throw new Error('home directory is not a project root');
    }
  } catch (error) { throw new Refusal('root_invalid', candidate ?? cwd, errno(error)); }
  const probe = git.run(['rev-parse', '--is-inside-work-tree'], root);
  if (probe.status === 0 && probe.stdout.trim() === 'true') {
    const top = git.run(['rev-parse', '--show-toplevel'], root);
    if (top.status !== 0) throw new Refusal('git_unusable', root, top.stderr);
    let gitTop: string;
    try {
      gitTop = fs.realpathSync(resolve(root, top.stdout.replace(/\n$/, '')));
      if (!fs.statSync(gitTop).isDirectory() || !contains(gitTop, root)) throw new Error('root is outside its Git worktree');
    } catch (error) { throw new Refusal('git_unusable', root, errno(error)); }
    const gitDirs = ['--absolute-git-dir', '--git-common-dir'].map(flag => {
      const result = git.run(['rev-parse', flag], root);
      if (result.status !== 0) throw new Refusal('git_unusable', root, result.stderr);
      try { return fs.realpathSync(resolve(root, result.stdout.replace(/\n$/, ''))); }
      catch (error) { throw new Refusal('git_unusable', root, errno(error)); }
    });
    const config = git.run(['config', '--bool', '--get', 'core.precomposeUnicode'], root);
    if (config.status !== 0 && config.status !== 1) throw new Refusal('git_unusable', root, config.stderr);
    return { path: root, mode: 'git', gitDirs, gitTop, precompose: config.stdout.trim() === 'true' };
  }
  const notRepo = /not a git repository \(or any of the parent directories\)|not a git repository \(or any parent up to mount point /.test(probe.stderr);
  if (probe.status === 128 && notRepo) {
    for (let current = root; ; current = dirname(current)) {
      try {
        if (entry(join(current, '.git'), fs)) throw new Refusal('git_unusable', join(current, '.git'), 'Git failed despite a .git entry in an ancestor');
      } catch (error) {
        if (error instanceof Refusal) throw error;
        throw new Refusal('git_unusable', current, errno(error));
      }
      if (current === dirname(current)) break;
    }
    if (requested === undefined) throw new Refusal('root_invalid', root, 'not a git repository; pass --root');
    return { path: root, mode: 'plain', gitDirs: [], precompose: false };
  }
  throw new Refusal('git_unusable', root, probe.stderr || `Git returned ${probe.status}: ${probe.stdout}`);
}
