/**
 * id-cli.ts — `bin/roadmap-id` entry point.
 */

import { lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { createGitGateway } from './lib/git.ts';
import { inspectIntakeDirectory } from './lib/intake-files.ts';
import {
  isValidWorkItemId,
  mintRandomId,
  scanAllWorkItemIds,
  WORK_ITEM_ID_DEFAULT_HEX,
  WORK_ITEM_ID_MAX_HEX,
} from './lib/work-item-id.ts';

export const USAGE = `Usage: roadmap-id mint [repo-path] [--count N]
       roadmap-id --help | -h

Mint unique immutable work-item IDs (wi-<hex>) for new planning records.

Subcommands:
  mint      Mint N unique IDs (default 1) unused in current planning files and docs/todos/

Options:
  [repo-path]           Repository root (defaults to Git toplevel or cwd)
  --count N             Number of IDs to mint (positive integer, default 1)
  -h, --help            Show this help and exit 0
`;

const DOC_NAMES = ['roadmap-shipped.md', 'ROADMAP.md', 'roadmap-future.md', 'TODOS.md'] as const;
const DOC_PATHS = DOC_NAMES.flatMap(name => [name, `docs/${name}`]);
const MINT_ID_SPACE = 16 ** WORK_ITEM_ID_DEFAULT_HEX + 16 ** (WORK_ITEM_ID_MAX_HEX - 1) + 16 ** WORK_ITEM_ID_MAX_HEX;

function resolveRepoRoot(positional: string | undefined): string {
  if (positional !== undefined) return resolve(positional);
  const cwd = process.cwd();
  return resolve(createGitGateway({ cwd }).toplevel() ?? cwd);
}

export function collectTakenIds(repoRoot: string): Set<string> {
  if (!statSync(repoRoot).isDirectory()) throw new Error('project path is not a directory');
  const taken = new Set<string>();
  for (const name of DOC_PATHS) {
    const path = join(repoRoot, name);
    const stat = statSync(path, { throwIfNoEntry: false });
    if (stat === undefined) continue;
    if (!stat.isFile()) throw new Error(`refusing non-regular planning document ${name}`);
    for (const id of scanAllWorkItemIds(readFileSync(path, 'utf8'))) taken.add(id);
  }
  const intakeDir = join(repoRoot, 'docs', 'todos');
  const { kind: intakeKind } = inspectIntakeDirectory(intakeDir);
  if (intakeKind === 'absent') return taken;
  if (intakeKind === 'invalid') throw new Error('refusing non-directory intake path docs/todos');
  const names = readdirSync(intakeDir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    const path = join(intakeDir, name);
    if (!lstatSync(path).isFile()) {
      throw new Error(`refusing non-regular intake document docs/todos/${name}`);
    }
    const stem = name.slice(0, -3);
    if (isValidWorkItemId(stem)) taken.add(stem);
    for (const id of scanAllWorkItemIds(readFileSync(path, 'utf8'))) taken.add(id);
  }
  return taken;
}

export type CliResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export function runIdCli(argv: string[]): CliResult {
  try {
    return execute(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { stdout: '', stderr: `roadmap-id: ${message}\n`, exitCode: 1 };
  }
}

function execute(argv: string[]): CliResult {
  const [subcommand, ...args] = argv;
  if (subcommand === undefined) {
    return { stdout: '', stderr: USAGE, exitCode: 2 };
  }
  if (subcommand === '--help' || subcommand === '-h') {
    return { stdout: USAGE, stderr: '', exitCode: 0 };
  }
  if (subcommand !== 'mint') {
    return { stdout: '', stderr: `roadmap-id: unknown subcommand '${subcommand}'\n${USAGE}`, exitCode: 2 };
  }

  let count = 1;
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--help' || arg === '-h') {
      return { stdout: USAGE, stderr: '', exitCode: 0 };
    }
    if (arg === '--count') {
      const value = args[++i];
      const candidate = Number(value);
      if (value === undefined || !/^[1-9][0-9]*$/.test(value) ||
          !Number.isSafeInteger(candidate) || candidate > MINT_ID_SPACE) {
        return { stdout: '', stderr: `roadmap-id mint: invalid --count value\n${USAGE}`, exitCode: 2 };
      }
      count = candidate;
      continue;
    }
    if (arg.startsWith('-')) {
      return { stdout: '', stderr: `roadmap-id mint: unknown option '${arg}'\n${USAGE}`, exitCode: 2 };
    }
    positionals.push(arg);
  }
  if (positionals.length > 1) {
    return { stdout: '', stderr: `roadmap-id mint: too many arguments\n${USAGE}`, exitCode: 2 };
  }

  const taken = collectTakenIds(resolveRepoRoot(positionals[0]));
  const minted: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = mintRandomId(taken);
    taken.add(id);
    minted.push(id);
  }
  return { stdout: minted.join('\n') + '\n', stderr: '', exitCode: 0 };
}

if (import.meta.main) {
  const result = runIdCli(process.argv.slice(2));
  if (result.stdout !== '') process.stdout.write(result.stdout);
  if (result.stderr !== '') process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}
