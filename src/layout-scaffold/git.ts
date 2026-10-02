import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { defaultFs, errno, Refusal, type FileSystem } from './root.ts';

export const INDEX_MAX_BUFFER = 512 * 1024 * 1024;
export const PINNED_CONFIG = [['core.fsmonitor', 'false'], ['core.hooksPath', '/dev/null'], ['core.quotePath', 'false']] as const;
const CONFIG_READ_ENV = new Set(['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM']);
export type GitResult = { status: number; stdout: string; stderr: string; error?: NodeJS.ErrnoException };
export type GitOptions = { cwd: string; env: NodeJS.ProcessEnv; executable: string; maxBuffer: number };
export type GitSpawn = (args: string[], options: GitOptions) => GitResult;
export type GitGateway = { run(args: string[], cwd: string, write?: boolean): GitResult };

export function childEnv(parent: NodeJS.ProcessEnv, write = false): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(parent)) {
    if (!key.startsWith('GIT_') || CONFIG_READ_ENV.has(key)) env[key] = value;
  }
  env.PATH = (parent.PATH ?? '').split(':').filter(isAbsolute).join(':');
  env.LC_ALL = 'C'; env.GIT_PAGER = 'cat'; env.GIT_LITERAL_PATHSPECS = '1';
  if (!write) env.GIT_OPTIONAL_LOCKS = '0';
  env.GIT_CONFIG_COUNT = String(PINNED_CONFIG.length);
  PINNED_CONFIG.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = key; env[`GIT_CONFIG_VALUE_${i}`] = value;
  });
  return env;
}

export const defaultGitSpawn: GitSpawn = (args, opts) => {
  const result = spawnSync(opts.executable, args, {
    cwd: opts.cwd, env: opts.env, maxBuffer: opts.maxBuffer, timeout: 30_000, encoding: 'utf8', input: '',
  });
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error };
};
export function createGit(parent: NodeJS.ProcessEnv, spawn: GitSpawn = defaultGitSpawn, fs: FileSystem = defaultFs): GitGateway {
  let executable: string | undefined;
  for (const dir of (parent.PATH ?? '').split(':').filter(isAbsolute)) {
    const candidate = join(dir, 'git');
    try { fs.accessSync(candidate, constants.X_OK); if (fs.statSync(candidate).isFile()) { executable = candidate; break; } }
    catch {}
  }
  if (!executable) throw new Refusal('git_unusable', 'git', 'Git executable missing from absolute PATH entries');
  const resolved = executable;
  return { run(args, cwd, write = false) {
    const result = spawn([...PINNED_CONFIG.flatMap(([key, value]) => ['-c', `${key}=${value}`]), ...args],
      { cwd, executable: resolved, env: childEnv(parent, write), maxBuffer: INDEX_MAX_BUFFER });
    if (result.error && result.error.code !== 'ENOBUFS') result.stderr ||= errno(result.error);
    return result;
  } };
}

export type IndexEntry = { path: string; mode: string; stage: number; tag: string };
export function inventory(git: GitGateway, root: string): IndexEntry[] {
  const result = git.run(['ls-files', '-t', '-z', '--stage'], root);
  if (result.error?.code === 'ENOBUFS') throw new Refusal('index_too_large', root, 'Git index inventory exceeds 512 MiB');
  if (result.status !== 0) throw new Refusal('tracking_probe', root, result.stderr || `index probe exit ${result.status}`);
  return result.stdout.split('\0').filter(Boolean).map(line => {
    const match = /^(\S) ([0-7]{6}) [0-9a-f]+ ([0-3])\t([\s\S]*)$/.exec(line);
    if (!match) throw new Refusal('tracking_probe', root, 'malformed Git index inventory');
    return { tag: match[1]!, mode: match[2]!, stage: Number(match[3]), path: match[4]! };
  });
}
