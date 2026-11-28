/**
 * id-cli.ts — `bin/roadmap-id` entry point.
 */

import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { basename, dirname, join, parse, relative, sep } from 'node:path';

import { createGitGateway } from './lib/git.ts';
import { inspectIntakeDirectory } from './lib/intake-files.ts';
import { findDoc } from './lib/planning-docs.ts';
import {
  isValidWorkItemId,
  mintRandomId,
  scanAllWorkItemIds,
  WORK_ITEM_ID_DEFAULT_HEX,
  WORK_ITEM_ID_MAX_HEX,
} from './lib/work-item-id.ts';
import {
  planWorkItemMigration,
  type MigrateDocInput,
  type MigrateDocKind,
  type MigrateFileOutput,
  type MigrateRefusal,
} from './lib/work-item-migrate.ts';

export const USAGE = `Usage: roadmap-id mint [repo-path] [--count N]
       roadmap-id migrate [repo-path] [--dry-run]
       roadmap-id --help | -h

Mint unique immutable work-item IDs (wi-<hex>) and migrate existing planning records.

Subcommands:
  mint      Mint N unique IDs (default 1) unused in current planning files, docs/todos/ and local Git history
  migrate   Assign work-item IDs to existing planning records without changing other text

Options:
  [repo-path]           Repository root (defaults to Git toplevel or cwd)
  --count N             Number of IDs to mint (positive integer, default 1)
  --dry-run             Preview migrate assignments without modifying any files
  -h, --help            Show this help and exit 0
`;

const DOC_NAMES = ['roadmap-shipped.md', 'ROADMAP.md', 'roadmap-future.md', 'TODOS.md'] as const;
const DOC_PATHS = DOC_NAMES.flatMap(name => [name, `docs/${name}`]);
const MIGRATE_DOCS: ReadonlyArray<{ name: string; kind: MigrateDocKind }> = [
  { name: 'TODOS.md', kind: 'todos' },
  { name: 'ROADMAP.md', kind: 'roadmap' },
  { name: 'roadmap-future.md', kind: 'future' },
  { name: 'roadmap-shipped.md', kind: 'shipped' },
];
const MINT_ID_SPACE = 16 ** WORK_ITEM_ID_DEFAULT_HEX + 16 ** (WORK_ITEM_ID_MAX_HEX - 1) + 16 ** WORK_ITEM_ID_MAX_HEX;

export function resolveRepoRoot(positional: string | undefined): string {
  const cwd = process.cwd();
  if (positional === undefined) {
    const result = createGitGateway({ cwd, isolateEnv: true }).projectToplevel();
    if (result.kind === 'error') throw new Error(`could not resolve project root: ${result.detail}`);
    return result.kind === 'root' ? result.path : cwd;
  }

  // Resolve symlinks before applying each parent segment. Path normalization
  // (including Bun's realpath) can otherwise select the lexical parent.
  const { root } = parse(positional);
  let directory = root || cwd;
  const components: string[] = [];
  for (const part of positional.slice(root.length).split(sep)) {
    if (part === '..') {
      const ancestor = realpathSync(join(directory, ...components));
      if (!statSync(ancestor).isDirectory()) throw new Error('project path is not a directory');
      directory = dirname(ancestor);
      components.length = 0;
    } else if (part !== '' && part !== '.') {
      components.push(part);
    }
  }
  return realpathSync(join(directory, ...components));
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
  if (intakeKind === 'invalid') throw new Error('refusing non-directory intake path docs/todos');
  if (intakeKind !== 'absent') {
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
  }

  const history = createGitGateway({ cwd: repoRoot, isolateEnv: true }).historyWorkItemIds();
  if (history.kind === 'shallow') {
    throw new Error('shallow clone: Git history is incomplete; fetch the full history and retry');
  }
  if (history.kind === 'error') {
    throw new Error(`could not read Git history for work-item IDs: ${history.detail}`);
  }
  if (history.kind === 'ids') {
    for (const id of history.ids) taken.add(id);
  }
  return taken;
}

export type CliResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function runIdCli(argv: string[]): CliResult {
  try {
    return execute(argv);
  } catch (error) {
    const message = errorMessage(error);
    if (argv[0] === 'migrate') {
      const summary = error instanceof MigrationRecoveryError ? '' : formatRefusals([]);
      return { stdout: '', stderr: `roadmap-id migrate: ${message}\n${summary}`, exitCode: 1 };
    }
    return { stdout: '', stderr: `roadmap-id: ${message}\n`, exitCode: 1 };
  }
}

function formatRefusals(refusals: MigrateRefusal[]): string {
  const lines = refusals.map(r => `REFUSED ${r.relPath}:${r.line} ${r.kind} ${r.reason}`);
  lines.push(`roadmap-id migrate: ${refusals.length} records refused; no files were written`);
  return lines.join('\n') + '\n';
}

type LoadedMigrationDoc = MigrateDocInput & { absPath: string; rawBytes: Buffer; original: Stats };

type StagedMigrationDoc = {
  doc: LoadedMigrationDoc;
  staging: string;
  replacement: string;
  backup: string;
  updated: Buffer;
  published: Stats | null;
};

class MigrationRecoveryError extends Error {}

function assertMigrationSnapshot(doc: LoadedMigrationDoc, expected: Stats, bytes: Buffer): void {
  const current = lstatSync(doc.absPath);
  if (
    !current.isFile() || current.dev !== expected.dev || current.ino !== expected.ino
    || current.mode !== expected.mode || !readFileSync(doc.absPath).equals(bytes)
  ) {
    throw new Error(`file changed during migration: ${doc.relPath}`);
  }
}

function writeMigration(loaded: LoadedMigrationDoc[], files: MigrateFileOutput[]): string[] {
  const byRel = new Map(loaded.map(doc => [doc.relPath, doc]));
  const staged: StagedMigrationDoc[] = [];
  const rollbackFailures = new Map<string, string>();
  const cleanupFailures: string[] = [];
  let failure: unknown;
  try {
    // Reserve each changed path and stage all writes before replacing any file.
    for (const file of files) {
      if (!file.changed) continue;
      const doc = byRel.get(file.relPath)!;
      assertMigrationSnapshot(doc, doc.original, doc.rawBytes);
      const staging = join(dirname(doc.absPath), `.${basename(doc.absPath)}.roadmap-id`);
      mkdirSync(staging, { mode: 0o700 });
      const replacement = join(staging, 'replacement');
      const backup = join(staging, 'original');
      const updated = Buffer.from(file.content, 'utf8');
      staged.push({ doc, staging, replacement, backup, updated, published: null });
      const mode = doc.original.mode & 0o7777;
      writeFileSync(replacement, updated, { flag: 'wx', mode: 0o600 });
      writeFileSync(backup, doc.rawBytes, { flag: 'wx', mode: 0o600 });
      chmodSync(replacement, mode);
      chmodSync(backup, mode);
    }
    for (const item of staged) {
      const { doc, replacement } = item;
      const next = statSync(replacement);
      assertMigrationSnapshot(doc, doc.original, doc.rawBytes);
      renameSync(replacement, doc.absPath);
      item.published = next;
    }
  } catch (error) {
    failure = error;
    for (const item of [...staged].reverse()) {
      const { doc, backup, published, staging, updated } = item;
      if (published === null) continue;
      try {
        assertMigrationSnapshot(doc, published, updated);
        renameSync(backup, doc.absPath);
      } catch (error) {
        rollbackFailures.set(staging, errorMessage(error));
      }
    }
  }
  for (const { staging } of staged) {
    if (rollbackFailures.has(staging)) continue;
    try {
      rmSync(staging, { recursive: true });
    } catch (error) {
      cleanupFailures.push(`${staging}: ${errorMessage(error)}`);
    }
  }
  if (failure !== undefined) {
    const unresolved = [
      ...[...rollbackFailures].map(([path, message]) => `rollback failed at ${path}: ${message}`),
      ...cleanupFailures.map(detail => `staging cleanup failed at ${detail}`),
    ];
    if (unresolved.length === 0) throw failure;
    throw new MigrationRecoveryError([errorMessage(failure), ...unresolved].join('\n'));
  }
  return cleanupFailures;
}

function executeMigrate(args: string[]): CliResult {
  let dryRun = false;
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--help' || arg === '-h') {
      return { stdout: USAGE, stderr: '', exitCode: 0 };
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg.startsWith('-')) {
      return { stdout: '', stderr: `roadmap-id migrate: unknown option '${arg}'\n${USAGE}`, exitCode: 2 };
    }
    positionals.push(arg);
  }
  if (positionals.length > 1) {
    return { stdout: '', stderr: `roadmap-id migrate: too many arguments\n${USAGE}`, exitCode: 2 };
  }
  if (positionals[0] === '') {
    return { stdout: '', stderr: `roadmap-id migrate: project path is empty\n${USAGE}`, exitCode: 2 };
  }

  const repoRoot = resolveRepoRoot(positionals[0]);
  if (!statSync(repoRoot).isDirectory()) throw new Error('project path is not a directory');

  const refusals: MigrateRefusal[] = [];
  const docsStat = lstatSync(join(repoRoot, 'docs'), { throwIfNoEntry: false });
  const docsValid = docsStat === undefined || (!docsStat.isSymbolicLink() && docsStat.isDirectory());
  if (docsStat !== undefined && !docsValid) {
    refusals.push({
      relPath: 'docs',
      line: 1,
      kind: 'document',
      reason: 'docs/ is a symbolic link or not a directory',
    });
  }

  const loaded: LoadedMigrationDoc[] = [];
  const utf8Decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

  for (const { name, kind } of MIGRATE_DOCS) {
    const rootPath = join(repoRoot, name);
    const docsPath = join(repoRoot, 'docs', name);
    const rootStat = lstatSync(rootPath, { throwIfNoEntry: false });
    const docsFileStat = docsValid ? lstatSync(docsPath, { throwIfNoEntry: false }) : undefined;

    let docBad = false;
    if (rootStat !== undefined && (rootStat.isSymbolicLink() || !rootStat.isFile())) {
      refusals.push({
        relPath: name,
        line: 1,
        kind: 'document',
        reason: 'symbolic link or non-regular file',
      });
      docBad = true;
    }
    if (docsFileStat !== undefined && (docsFileStat.isSymbolicLink() || !docsFileStat.isFile())) {
      refusals.push({
        relPath: `docs/${name}`,
        line: 1,
        kind: 'document',
        reason: 'symbolic link or non-regular file',
      });
      docBad = true;
    }
    if (rootStat !== undefined && docsFileStat !== undefined) {
      refusals.push({
        relPath: name,
        line: 1,
        kind: 'document',
        reason: `both ${name} and docs/${name} exist`,
      });
      docBad = true;
    }
    if (docBad || !docsValid) continue;

    const absPath = findDoc(repoRoot, name);
    if (absPath === null) continue;
    const relPath = relative(repoRoot, absPath).replace(/\\/g, '/');
    const original = lstatSync(absPath);
    if (!original.isFile()) throw new Error(`file changed during migration: ${relPath}`);
    const rawBytes = readFileSync(absPath);
    let content: string;
    try {
      content = utf8Decoder.decode(rawBytes);
    } catch {
      refusals.push({
        relPath,
        line: 1,
        kind: 'document',
        reason: 'file is not valid UTF-8',
      });
      continue;
    }
    loaded.push({ kind, relPath, content, absPath, rawBytes, original });
  }

  if (refusals.length > 0) {
    return { stdout: '', stderr: formatRefusals(refusals), exitCode: 1 };
  }

  const taken = collectTakenIds(repoRoot);
  const plan = planWorkItemMigration(loaded, taken);

  if (plan.refusals.length > 0) {
    return { stdout: '', stderr: formatRefusals(plan.refusals), exitCode: 1 };
  }

  const retainedStaging = dryRun ? [] : writeMigration(loaded, plan.files);

  const outLines = plan.assignments.map(
    a => `ASSIGNED ${a.relPath}:${a.line} ${a.id} ${a.kind} ${a.label}`,
  );
  outLines.push(`${dryRun ? 'DRY_RUN' : 'MIGRATED'} ${plan.assignments.length}`);
  const stderr = retainedStaging.length === 0
    ? ''
    : `roadmap-id migrate: assignments saved; could not remove staging paths ${retainedStaging.join(', ')}\n`;
  return { stdout: outLines.join('\n') + '\n', stderr, exitCode: 0 };
}

function execute(argv: string[]): CliResult {
  const [subcommand, ...args] = argv;
  if (subcommand === undefined) {
    return { stdout: '', stderr: USAGE, exitCode: 2 };
  }
  if (subcommand === '--help' || subcommand === '-h') {
    return { stdout: USAGE, stderr: '', exitCode: 0 };
  }
  if (subcommand === 'migrate') {
    return executeMigrate(args);
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
