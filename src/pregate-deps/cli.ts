#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cleanGitEnv, generate, isPyTestFile, readPythonSources } from './graph.ts';

export const PREGATE_CONFIG_REL = '.gstack/pregate.json';
export const MAX_DEPENDENCIES_ENTRIES = 256;
export const MAX_PATH_LENGTH = 256;
const LANE_KEYS = ['dependencies', 'empty_lanes', 'selection', 'local'] as const;
const INIT_CMD = `${['gstack', 'pregate'].join('-')} init`;

export interface CliIo {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export interface ParsedArgs {
  check: boolean;
  prune: boolean;
  roots: string[];
  help: boolean;
}

function escapeOneLine(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim();
}

export function help(): string {
  return `Usage: pregate-deps [--check] [--prune] [--root DIR]...

Scan a Git repository's Python imports and map each non-test .py module under
a declared source root to the Python test files that depend on it, writing the
entries into .gstack/pregate.json dependencies while preserving unowned entries
and every other top-level key. This helper never runs pregate.

Options:
  --check       Compare .gstack/pregate.json against derived edges without writing
  --prune       Allow write mode to remove stale or unreferenced owned entries/values
  --root DIR    Source root directory relative to the repo root (repeatable; default: src)
  --help, -h    Show this help message

Ownership rule:
  A dependencies key is owned when it has no * or ?, ends in .py, lies under a
  declared root, is not a Python test file (test_*.py or *_test.py), and holds a
  non-empty array. Unowned keys (globs, keys outside declared roots, non-.py
  paths, test files, and [] declarations) are kept unchanged. Without --prune, a
  write may only add keys and values; any write that would remove an existing
  owned key or value refuses with exit 2 and writes nothing.

Output lines:
  Check mode:   MISSING <key> -> <test>, STALE <key> -> <test>,
                ENTRIES: <n> generated, <m> kept, STATUS: current | stale
  Write mode:   ADDED <key> -> <test>, REMOVED <key> -> <test>,
                NOTE: ..., STATUS: written | unchanged
  Refusals:     ERROR <code>: <detail> and FIX: <action> on stderr

Exit codes:
  0  Written, unchanged, or current (--check)
  1  Stale map (--check only)
  2  Usage error or refusal (nothing written)
`;
}

function normalizeRoot(raw: string): string {
  if (!raw || raw.startsWith('/') || /^[A-Za-z]:[\\/]/.test(raw) || raw.includes('\\')) {
    throw new Error(`invalid --root value ${JSON.stringify(raw)}: must be a relative directory inside the repository`);
  }
  const clean = raw.replace(/\/+$/, '');
  if (!clean || clean === '.') {
    throw new Error(`invalid --root value ${JSON.stringify(raw)}: cannot be empty or '.'`);
  }
  const segments = clean.split('/');
  if (segments.some(seg => !seg || seg === '.' || seg === '..')) {
    throw new Error(`invalid --root value ${JSON.stringify(raw)}: cannot contain '.' or '..' segments`);
  }
  return clean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  let check = false;
  let prune = false;
  let helpFlag = false;
  const roots: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--help' || arg === '-h') {
      helpFlag = true;
    } else if (arg === '--check') {
      check = true;
    } else if (arg === '--prune') {
      prune = true;
    } else if (arg === '--root') {
      if (i + 1 >= argv.length) throw new Error('--root requires a DIR argument');
      roots.push(normalizeRoot(argv[++i]!));
    } else if (arg.startsWith('--root=')) {
      roots.push(normalizeRoot(arg.slice('--root='.length)));
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return {
    check,
    prune,
    roots: roots.length > 0 ? [...new Set(roots)] : ['src'],
    help: helpFlag,
  };
}

export function isOwnedKey(key: string, value: readonly string[], roots: readonly string[]): boolean {
  if (key.includes('*') || key.includes('?')) return false;
  if (!key.endsWith('.py')) return false;
  if (!roots.some(r => key.startsWith(`${r}/`))) return false;
  if (isPyTestFile(key)) return false;
  return value.length > 0;
}

function refuse(io: CliIo, code: string, detail: string, fix: string): number {
  io.stderr(`ERROR ${code}: ${escapeOneLine(detail)}\nFIX: ${escapeOneLine(fix)}\n`);
  return 2;
}

function resolveGitTopLevel(cwd: string, env: NodeJS.ProcessEnv): string | null {
  const res = spawnSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    env: cleanGitEnv(env),
    timeout: 15_000,
  });
  if (res.status !== 0) return null;
  const out = (res.stdout ?? '').trim();
  return out || null;
}

export function main(argv: string[], overrides: Partial<CliIo> = {}): number {
  const io: CliIo = {
    cwd: process.cwd(),
    env: process.env,
    stdout: text => { process.stdout.write(text); },
    stderr: text => { process.stderr.write(text); },
    ...overrides,
  };

  let parsedArgs: ParsedArgs;
  try {
    parsedArgs = parseArgs(argv);
  } catch (err) {
    return refuse(io, 'usage', (err as Error).message, 'see pregate-deps --help');
  }

  if (parsedArgs.help) {
    io.stdout(help());
    return 0;
  }

  try {
    const repoRoot = resolveGitTopLevel(io.cwd, io.env);
    if (!repoRoot) {
      return refuse(io, 'not_git_repo', `${io.cwd} is not inside a Git work tree`, 'run pregate-deps from inside a Git repository');
    }

    const realTop = realpathSync(repoRoot);
    for (const root of parsedArgs.roots) {
      const absRoot = join(repoRoot, root);
      if (!existsSync(absRoot)) {
        return refuse(io, 'missing_root', `source root directory does not exist: ${root}`, 'pass an existing directory relative to the repository root with --root DIR');
      }
      const lst = lstatSync(absRoot);
      if (lst.isSymbolicLink()) {
        const real = realpathSync(absRoot);
        if (real !== realTop && !real.startsWith(`${realTop}/`)) {
          return refuse(io, 'missing_root', `source root resolves outside repository: ${root}`, 'use a directory inside the repository');
        }
      }
      if (!statSync(absRoot).isDirectory()) {
        return refuse(io, 'missing_root', `source root is not a directory: ${root}`, 'pass a directory path to --root DIR');
      }
    }

    const configPath = join(repoRoot, PREGATE_CONFIG_REL);
    if (!existsSync(configPath) || !statSync(configPath).isFile()) {
      return refuse(io, 'missing_config', `${PREGATE_CONFIG_REL} does not exist`, `run ${INIT_CMD} to create ${PREGATE_CONFIG_REL} first`);
    }
    const realConfigPath = realpathSync(configPath);
    if (!realConfigPath.startsWith(`${realTop}/`)) {
      return refuse(io, 'invalid_config', `${PREGATE_CONFIG_REL} resolves outside repository`, 'use a policy file inside the repository');
    }

    const rawConfig = readFileSync(configPath, 'utf8');
    let configObj: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawConfig) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return refuse(io, 'invalid_config', `${PREGATE_CONFIG_REL} must contain a top-level JSON object`, `fix ${PREGATE_CONFIG_REL} to be a JSON object`);
      }
      configObj = parsed as Record<string, unknown>;
    } catch (err) {
      return refuse(io, 'invalid_config', `${PREGATE_CONFIG_REL} is not valid JSON: ${(err as Error).message}`, `fix JSON syntax in ${PREGATE_CONFIG_REL}`);
    }

    const prevDeps: Record<string, string[]> = Object.create(null);
    if ('dependencies' in configObj && configObj.dependencies !== undefined) {
      const rawDeps = configObj.dependencies;
      if (!rawDeps || typeof rawDeps !== 'object' || Array.isArray(rawDeps)) {
        return refuse(io, 'invalid_dependencies', `${PREGATE_CONFIG_REL} dependencies must be an object`, `set dependencies to an object mapping paths to test arrays in ${PREGATE_CONFIG_REL}`);
      }
      for (const [k, v] of Object.entries(rawDeps as Record<string, unknown>)) {
        if (!Array.isArray(v) || v.some(item => typeof item !== 'string')) {
          return refuse(
            io,
            'invalid_dependencies',
            `${PREGATE_CONFIG_REL} dependencies[${JSON.stringify(k)}] must be an array of strings`,
            `fix dependencies[${JSON.stringify(k)}] in ${PREGATE_CONFIG_REL} to hold only string paths`,
          );
        }
        prevDeps[k] = v as string[];
      }
    }

    const sources = readPythonSources(repoRoot, io.env);
    const generatedRaw = generate(sources, parsedArgs.roots);
    for (const key of Object.keys(generatedRaw)) {
      if (key.includes('*') || key.includes('?')) {
        return refuse(io, 'unsupported_path', `module path contains glob characters: ${key}`, 'rename the source path to avoid * and ? before generating literal dependency keys');
      }
    }

    const owned: Record<string, string[]> = Object.create(null);
    const kept: Record<string, string[]> = Object.create(null);
    for (const [k, v] of Object.entries(prevDeps)) {
      if (isOwnedKey(k, v, parsedArgs.roots)) {
        owned[k] = v;
      } else {
        kept[k] = v;
      }
    }

    const generated: Record<string, string[]> = Object.create(null);
    for (const [k, v] of Object.entries(generatedRaw)) {
      if (!(k in kept)) generated[k] = v;
    }

    const merged: Record<string, string[]> = { ...kept, ...generated };
    const mergedKeys = Object.keys(merged).sort();
    if (mergedKeys.length > MAX_DEPENDENCIES_ENTRIES) {
      return refuse(
        io,
        'limit_exceeded',
        `merged dependencies has ${mergedKeys.length} entries (maximum ${MAX_DEPENDENCIES_ENTRIES})`,
        `reduce dependencies entries to at most ${MAX_DEPENDENCIES_ENTRIES}`,
      );
    }
    for (const k of mergedKeys) {
      if (k.length > MAX_PATH_LENGTH) {
        return refuse(
          io,
          'limit_exceeded',
          `dependency key exceeds ${MAX_PATH_LENGTH} characters: ${k}`,
          `shorten dependency key paths to at most ${MAX_PATH_LENGTH} characters`,
        );
      }
      for (const t of merged[k]!) {
        if (t.length > MAX_PATH_LENGTH) {
          return refuse(
            io,
            'limit_exceeded',
            `test path under ${k} exceeds ${MAX_PATH_LENGTH} characters: ${t}`,
            `shorten test paths in dependencies to at most ${MAX_PATH_LENGTH} characters`,
          );
        }
      }
    }

    const missing: string[] = [];
    for (const k of Object.keys(generated).sort()) {
      const prevSet = new Set(owned[k] ?? []);
      for (const t of generated[k]!) {
        if (!prevSet.has(t)) missing.push(`${k} -> ${t}`);
      }
    }

    const stale: string[] = [];
    for (const k of Object.keys(owned).sort()) {
      const genSet = new Set(generated[k] ?? []);
      for (const t of [...new Set(owned[k]!)].sort()) {
        if (!genSet.has(t)) stale.push(`${k} -> ${t}`);
      }
    }

    if (parsedArgs.check) {
      const lines: string[] = [
        ...missing.map(m => `MISSING ${m}`),
        ...stale.map(s => `STALE ${s}`),
        `ENTRIES: ${Object.keys(generated).length} generated, ${Object.keys(kept).length} kept`,
        `STATUS: ${missing.length === 0 && stale.length === 0 ? 'current' : 'stale'}`,
      ];
      io.stdout(`${lines.join('\n')}\n`);
      return missing.length === 0 && stale.length === 0 ? 0 : 1;
    }

    if (stale.length > 0 && !parsedArgs.prune) {
      return refuse(
        io,
        'stale_entries',
        `write would remove existing entries without --prune: ${stale.join(', ')}`,
        're-run with --prune to remove stale owned entries, or move hand-written edges to a glob pattern key',
      );
    }

    if (missing.length === 0 && stale.length === 0) {
      io.stdout('STATUS: unchanged\n');
      return 0;
    }

    const hadLaneKey = LANE_KEYS.some(k => k in configObj);
    const sortedDependencies = Object.fromEntries(mergedKeys.map(k => [k, merged[k]!]));
    const nextConfig: Record<string, unknown> = {
      ...configObj,
      dependencies: sortedDependencies,
    };
    const scratch = mkdtempSync(join(dirname(realConfigPath), '.pregate-deps-'));
    try {
      const replacement = join(scratch, 'pregate.json');
      writeFileSync(replacement, `${JSON.stringify(nextConfig, null, 2)}\n`, { mode: statSync(realConfigPath).mode & 0o777 });
      renameSync(replacement, realConfigPath);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }

    const lines: string[] = [
      ...missing.map(m => `ADDED ${m}`),
      ...stale.map(s => `REMOVED ${s}`),
    ];
    if (!hadLaneKey) {
      lines.push('NOTE: .gstack/pregate.json now declares lanes; pregate will fail a touched file with no lane.');
    }
    lines.push('STATUS: written');
    io.stdout(`${lines.join('\n')}\n`);
    return 0;
  } catch (err) {
    return refuse(io, 'internal', (err as Error).message, 'inspect the repository state and try again');
  }
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
