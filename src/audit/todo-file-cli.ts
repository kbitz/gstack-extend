/**
 * todo-file-cli.ts — `bin/todo-file` entry point.
 *
 * Files one canonical per-record intake entry (`intake-files/v1`) under
 * `docs/todos/<id>.md` with a freshly minted work-item ID and filer provenance.
 */

import { lstatSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { collectTakenIds, resolveRepoRoot, type CliResult } from './id-cli.ts';
import { inspectIntakeDirectory } from './lib/intake-files.ts';
import { validateTagExpression } from './lib/source-tag.ts';
import { mintRandomId } from './lib/work-item-id.ts';
import { parseIntakeFile } from './parsers/todos.ts';

export const USAGE = `Usage: todo-file [repo-path] --tag <[source:tag]> --title <title> --field '<Key>: <value>'... [--developer-words <words>]
       todo-file --help | -h

File one per-record intake entry (intake-files/v1) at docs/todos/<id>.md with a
fresh work-item ID and a filer provenance line.

Options:
  [repo-path]               Repository root (defaults to Git toplevel or cwd)
  --tag <[source:tag]>      Source-tag expression in brackets, e.g. [review:files=a.ts|b.ts]
  --title <title>           Record title, one line
  --field '<Key>: <value>'  Attribute bullet, repeatable; written in order as - **<Key>:** <value>.
                            Requires one of Why, Description or Symptom, and Evidence.
  --developer-words <words> The developer's own words deferring the item; records
                            Deferred by: developer, <UTC date>: "<words>". Without it: Filed by: worker.
  -h, --help                Show this help and exit 0

Output: FILED <id> docs/todos/<id>.md
Exit: 0 filed; 1 entry or repository refused, or read/write error (no file written); 2 invalid arguments
`;

const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F\u0085\u2028\u2029]/;
const FIELD_KEY_RE = /^[A-Z](?:[A-Za-z0-9 ()-]*[A-Za-z0-9)])?$/;
const RESERVED_KEYS = new Set(['id', 'deferred by', 'filed by']);
const LEAD_KEYS = new Set(['Why', 'Description', 'Symptom']);

type ParsedField = {
  key: string;
  value: string;
};

function usageError(message: string): CliResult {
  return { stdout: '', stderr: `todo-file: ${message}\n${USAGE}`, exitCode: 2 };
}

function refused(reason: string, detail: string): CliResult {
  return {
    stdout: '',
    stderr: `todo-file: REFUSED ${reason}: ${detail}; no file was written\n`,
    exitCode: 1,
  };
}

function failure(message: string): CliResult {
  return { stdout: '', stderr: `todo-file: ${message}; no file was written\n`, exitCode: 1 };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function execute(argv: string[]): CliResult {
  // A. Arguments.
  if (argv.includes('--help') || argv.includes('-h')) {
    return { stdout: USAGE, stderr: '', exitCode: 0 };
  }

  let tag: string | undefined;
  let title: string | undefined;
  let developerWords: string | undefined;
  const rawFields: string[] = [];
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--tag') {
      if (tag !== undefined) return usageError('duplicate --tag option');
      const value = argv[++i];
      if (value === undefined) return usageError('missing value for --tag');
      tag = value;
      continue;
    }
    if (arg === '--title') {
      if (title !== undefined) return usageError('duplicate --title option');
      const value = argv[++i];
      if (value === undefined) return usageError('missing value for --title');
      title = value;
      continue;
    }
    if (arg === '--field') {
      const value = argv[++i];
      if (value === undefined) return usageError('missing value for --field');
      rawFields.push(value);
      continue;
    }
    if (arg === '--developer-words') {
      if (developerWords !== undefined) return usageError('duplicate --developer-words option');
      const value = argv[++i];
      if (value === undefined) return usageError('missing value for --developer-words');
      developerWords = value;
      continue;
    }
    if (arg.startsWith('-')) {
      return usageError(`unknown option '${arg}'`);
    }
    if (arg === '') {
      return usageError('empty repository path');
    }
    positionals.push(arg);
  }

  if (positionals.length > 1) return usageError('too many positional arguments');
  if (tag === undefined) return usageError('missing required --tag option');
  if (title === undefined) return usageError('missing required --title option');

  // B. Content checks, before any filesystem access.
  if (CONTROL_CHAR_RE.test(tag)) {
    return refused('control-character', 'tag contains a control character');
  }
  if (CONTROL_CHAR_RE.test(title)) {
    return refused('control-character', 'title contains a control character');
  }
  for (const raw of rawFields) {
    if (CONTROL_CHAR_RE.test(raw)) {
      return refused('control-character', 'field contains a control character');
    }
  }
  if (developerWords !== undefined && CONTROL_CHAR_RE.test(developerWords)) {
    return refused('control-character', 'developer words contain a control character');
  }

  const tagCheck = validateTagExpression(tag);
  if (!tagCheck.ok) {
    return refused('invalid-tag', `${tagCheck.reason}`);
  }

  const trimmedTitle = title.trim();
  if (trimmedTitle === '') {
    return refused('empty-title', 'title is empty');
  }

  const fields: ParsedField[] = [];
  const seenKeysLower = new Set<string>();
  const seenKeysExact = new Set<string>();
  for (const raw of rawFields) {
    const colon = raw.indexOf(':');
    if (colon < 0) {
      return refused('invalid-field', `expected '<Key>: <value>'`);
    }
    const key = raw.slice(0, colon);
    const afterColon = raw.slice(colon + 1);
    if (!afterColon.startsWith(' ')) {
      return refused('invalid-field', `invalid field syntax for '${key}'`);
    }
    const lowerKey = key.toLowerCase();
    if (RESERVED_KEYS.has(lowerKey)) {
      return refused('reserved-field', `field '${key}' is reserved`);
    }
    if (!FIELD_KEY_RE.test(key)) {
      return refused('invalid-field', `invalid field syntax for '${key}'`);
    }
    const value = afterColon.trim();
    if (value === '') {
      return refused('empty-value', `field '${key}' has an empty value`);
    }
    if (seenKeysLower.has(lowerKey)) {
      return refused('duplicate-field', `duplicate field '${key}'`);
    }
    seenKeysLower.add(lowerKey);
    seenKeysExact.add(key);
    fields.push({ key, value });
  }

  let hasLead = false;
  for (const lead of LEAD_KEYS) {
    if (seenKeysExact.has(lead)) {
      hasLead = true;
      break;
    }
  }
  if (!hasLead) {
    return refused('missing-why', 'requires one of Why, Description, or Symptom');
  }
  if (!seenKeysExact.has('Evidence')) {
    return refused('missing-evidence', 'requires an Evidence field');
  }
  if (developerWords !== undefined && developerWords.trim() === '') {
    return refused('empty-developer-words', '--developer-words is empty');
  }

  // C. Resolve repository root.
  let root: string;
  try {
    root = resolveRepoRoot(positionals[0]);
  } catch (error) {
    return failure(errorMessage(error));
  }

  // D. Repository checks, still writing nothing.
  const docsPath = join(root, 'docs');
  const docsStat = lstatSync(docsPath, { throwIfNoEntry: false });
  if (docsStat !== undefined) {
    if (!docsStat.isDirectory() || !readdirSync(root).includes('docs')) {
      return failure('docs/ is a symbolic link or not a directory');
    }
  }

  const intakeDir = join(docsPath, 'todos');
  const intakeCheck = inspectIntakeDirectory(intakeDir);
  if (intakeCheck.kind === 'invalid') {
    return failure('refusing non-directory intake path docs/todos');
  }

  // E. Collect taken IDs across planning docs, intake dir, and Git history.
  let taken: Set<string>;
  try {
    taken = collectTakenIds(root);
  } catch (error) {
    return failure(errorMessage(error));
  }

  // F. Mint ID, compose canonical record, and verify via read-back parse.
  const id = mintRandomId(taken);
  const provenanceLine = developerWords !== undefined
    ? `- **Deferred by:** developer, ${new Date().toISOString().slice(0, 10)}: "${developerWords.trim()}"`
    : '- **Filed by:** worker';

  const lines = [
    `### ${tag} ${trimmedTitle}`,
    `- **ID:** ${id}`,
    provenanceLine,
    ...fields.map(f => `- **${f.key}:** ${f.value}`),
  ];
  const content = lines.join('\n') + '\n';

  const relPath = `docs/todos/${id}.md`;
  const parsed = parseIntakeFile(relPath, `${id}.md`, 'file', content);
  const heading = parsed.headings[0];
  const canonical =
    parsed.headings.length === 1 &&
    parsed.headingIsFirst &&
    parsed.unexpectedHeadings.length === 0 &&
    parsed.legacyBullets.length === 0 &&
    parsed.compactBullets.length === 0 &&
    !parsed.hasFrontmatter &&
    parsed.idIsFirst &&
    parsed.workItemId === id &&
    parsed.workItemIdError === null &&
    heading?.tag === tag &&
    heading?.title === trimmedTitle;

  if (!canonical) {
    return refused('noncanonical-record', 'composed record failed canonical intake read-back');
  }

  // G. Create missing directories only now.
  if (docsStat === undefined) {
    mkdirSync(docsPath);
  }
  if (intakeCheck.kind === 'absent') {
    mkdirSync(intakeDir);
  }
  if (inspectIntakeDirectory(intakeDir).kind !== 'directory') {
    return failure('refusing non-directory intake path docs/todos');
  }

  // H. Exclusive write (never overwrite).
  try {
    writeFileSync(join(intakeDir, `${id}.md`), content, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') {
      return refused('record-exists', `${relPath} already exists`);
    }
    return failure(errorMessage(error));
  }

  // I. Report filed record.
  return { stdout: `FILED ${id} ${relPath}\n`, stderr: '', exitCode: 0 };
}

export function runTodoFileCli(argv: string[]): CliResult {
  try {
    return execute(argv);
  } catch (error) {
    return failure(errorMessage(error));
  }
}

if (import.meta.main) {
  const result = runTodoFileCli(process.argv.slice(2));
  if (result.stdout !== '') process.stdout.write(result.stdout);
  if (result.stderr !== '') process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}
