import { lstatSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { BodyError, bodyHash, upsert } from './body.ts';
import { check } from './check.ts';
import { classify } from './classify.ts';
import { CONFIG_FILES, describeConfig, readConfig } from './config.ts';
import { changes, commitOf, gitIn, mergeBase, readAt, Refusal, topLevel, worktreeClean } from './git.ts';
import { expandCommand, selectTests } from './pinning.ts';

// All three launcher flags first coexist in Bun 1.3.3's src/cli/Arguments.zig.
export const BUN_FLOOR = '1.3.3';
export const EXIT = { ok: 0, failed: 1, usage: 2, refused: 3 } as const;

export type CliIo = { stdout(text: string): void; stderr(text: string): void; cwd: string };

export function help(): string {
  return `docs-ship — mechanics for /docs-ship: classify a docs-only PR, check its links and claims, find doc-pinning tests, bind the receipt
Requires Bun >= ${BUN_FLOOR} (--no-env-file --no-install --config=/dev/null).

Usage:
  docs-ship classify --base REF [--head REF]
  docs-ship check --base REF [--head REF] [--brief FILE]...
  docs-ship tests --base REF [--head REF]
  docs-ship hash --body FILE
  docs-ship receipt --body FILE --receipt FILE --out FILE
  docs-ship --help | -h | --version

REF is the PR's base branch tip (for example origin/main). Every command reads
the PR's own changes, merge-base(REF, head) to head (default HEAD), from git
objects; run it inside the PR checkout.

classify  Apply the shared docs-only classification (docs/docs-ship.md) to
          every changed file, with the project's docs-ship markers read from
          REF's AGENTS.md and CLAUDE.md. FILE lines say docs or stop with a
          reason; FINDING lines report CHANGELOG edits inside an
          already-released version section. RULES names the rules file
          (docs-ship:rules, else AGENTS.md, else CLAUDE.md).
          STATUS: docs | stop | empty.
check     For added lines in changed Markdown: every relative link and #anchor
          must resolve at head; claims (SHA, hash, PR/issue, ID, version, date,
          numbers, quotations) are listed as CLAIM lines. A SHA that names no
          commit here and a quotation that nearly matches a --brief passage
          are FINDING lines. STATUS: ok | findings.
tests     List the test files that name a changed path or file name, plus the
          docs-ship:tests marker's files. COMMAND is the docs-ship:test-command
          template with {tests} filled in, when the project sets one.
hash      Print the SHA-256 of FILE's PR body without the receipt block.
receipt   Insert or replace the receipt block from --receipt in the body and
          write the result to --out. Refuses a receipt whose "Body SHA-256"
          is not the body's hash.

Output is KEY: value lines; list fields are separated by " | ". Errors print
"ERROR <CODE>: ..." and "FIX: ..." on stderr. Exit codes: 0 ok · 1 stop or
findings · 2 usage · 3 refused.
`;
}

function version(): string {
  try {
    return readFileSync(join(import.meta.dir, '..', '..', 'VERSION'), 'utf8').trim();
  } catch {
    return 'unknown';
  }
}

type Args = Record<string, string[]>;

function parse(argv: string[], spec: Record<string, 'value' | 'multi'>): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const kind = spec[arg];
    if (!kind) throw new Refusal('USAGE', `unknown argument ${arg}`, 'see docs-ship --help', EXIT.usage);
    const value = argv[++i];
    if (value === undefined) throw new Refusal('USAGE', `${arg} requires a value`, 'see docs-ship --help', EXIT.usage);
    if (kind === 'value' && out[arg]) throw new Refusal('USAGE', `duplicate ${arg}`, 'pass it once', EXIT.usage);
    (out[arg] ??= []).push(value);
  }
  return out;
}

function need(args: Args, key: string): string {
  const value = args[key]?.[0];
  if (value === undefined) throw new Refusal('USAGE', `${key} is required`, 'see docs-ship --help', EXIT.usage);
  return value;
}

const abs = (cwd: string, p: string) => (isAbsolute(p) ? p : resolve(cwd, p));

function readFile(path: string, label: string): string {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    throw new Refusal('FILE_MISSING', `${label} ${path} does not exist`, 'pass an existing file');
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Refusal('UNSAFE_PATH', `${label} ${path} is not a regular file`, 'pass a regular file, not a symlink or directory');
  return readFileSync(path, 'utf8');
}

const show = (s: string) => (/[|\n\r]/.test(s) ? JSON.stringify(s) : s);
const flat = (s: string) => s.replace(/[\r\n]+/g, ' ');

type Range = { git: ReturnType<typeof gitIn>; baseRef: string; base: string; head: string; from: string; headIsHEAD: boolean };

function range(args: Args, cwd: string): Range {
  const git = gitIn(topLevel(cwd));
  const baseRef = need(args, '--base');
  const headRef = args['--head']?.[0] ?? 'HEAD';
  const base = commitOf(git, baseRef, '--base');
  const head = commitOf(git, headRef, '--head');
  return { git, baseRef, base, head, from: mergeBase(git, base, head), headIsHEAD: args['--head'] === undefined };
}

function header(r: Range): string {
  return `BASE: ${r.base} (${r.baseRef})\nHEAD: ${r.head}\nMERGE_BASE: ${r.from}\n`;
}

function classifyCmd(argv: string[], io: CliIo): number {
  const r = range(parse(argv, { '--base': 'value', '--head': 'value' }), io.cwd);
  const config = readConfig(r.git, r.base);
  const list = changes(r.git, r.from, r.head);
  const result = classify(r.git, r.from, r.head, list, config);
  let out = header(r);
  out += `CONFIG: ${describeConfig(config)}\n`;
  out += `RULES: ${config.rules ?? CONFIG_FILES.find((f) => readAt(r.git, r.base, f) !== undefined) ?? 'none'}\n`;
  out += `WORKTREE: ${r.headIsHEAD ? (worktreeClean(r.git) ? 'clean' : 'dirty') : 'not checked (--head given)'}\n`;
  for (const f of result.files) {
    out += f.kind === 'docs'
      ? `FILE: docs | ${f.status} | ${show(f.path)} | ${f.why}\n`
      : `FILE: stop | ${f.status} | ${show(f.path)} | ${f.reason} | ${f.why}\n`;
  }
  for (const f of result.findings) out += `FINDING: ${show(f.file)}:${f.line} | release-policy | ${f.message} | fix: ${f.fix}\n`;
  const stops = result.files.filter((f) => f.kind === 'stop');
  out += `FILES: ${result.files.length} (docs ${result.files.length - stops.length}, stop ${stops.length})\n`;
  out += `RELEASE_FINDINGS: ${result.findings.length}\n`;
  const status = result.files.length === 0 ? 'empty' : stops.length ? 'stop' : 'docs';
  out += `STATUS: ${status}\n`;
  io.stdout(out);
  return status === 'docs' ? EXIT.ok : EXIT.failed;
}

function checkCmd(argv: string[], io: CliIo): number {
  const args = parse(argv, { '--base': 'value', '--head': 'value', '--brief': 'multi' });
  const r = range(args, io.cwd);
  const briefs = (args['--brief'] ?? []).map((p) => readFile(abs(io.cwd, p), 'brief'));
  const result = check(r.git, r.from, r.head, changes(r.git, r.from, r.head), briefs);
  let out = header(r);
  out += `BRIEFS: ${briefs.length}\n`;
  for (const f of result.findings) out += `FINDING: ${show(f.file)}:${f.line} | ${f.kind} | ${flat(f.message)} | fix: ${flat(f.fix)}\n`;
  for (const c of result.claims) out += `CLAIM: ${show(c.file)}:${c.line} | ${c.kind} | ${flat(c.value)} | ${c.status}${c.detail ? ` | ${flat(c.detail)}` : ''}\n`;
  const counts = new Map<string, number>();
  for (const c of result.claims) counts.set(c.status, (counts.get(c.status) ?? 0) + 1);
  out += `LINKS: ${result.links}\n`;
  out += `CLAIMS: ${result.claims.length}${counts.size ? ` (${[...counts].map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}\n`;
  out += `FINDINGS: ${result.findings.length}\n`;
  out += `STATUS: ${result.findings.length ? 'findings' : 'ok'}\n`;
  io.stdout(out);
  return result.findings.length ? EXIT.failed : EXIT.ok;
}

function testsCmd(argv: string[], io: CliIo): number {
  const r = range(parse(argv, { '--base': 'value', '--head': 'value' }), io.cwd);
  const config = readConfig(r.git, r.base);
  const changed = changes(r.git, r.from, r.head).map((c) => c.path);
  const selected = selectTests(r.git, r.head, changed, config.tests);
  let out = `HEAD: ${r.head}\nMERGE_BASE: ${r.from}\nCHANGED: ${changed.length}\n`;
  for (const s of selected) out += `TEST: ${show(s.test)} | ${s.reasons.join('; ')}\n`;
  out += `TESTS: ${selected.length}\n`;
  if (config.testCommand && selected.length) out += `COMMAND: ${expandCommand(config.testCommand, selected.map((s) => s.test))}\n`;
  out += `STATUS: ${selected.length ? 'selected' : 'none'}\n`;
  io.stdout(out);
  return EXIT.ok;
}

function hashCmd(argv: string[], io: CliIo): number {
  const args = parse(argv, { '--body': 'value' });
  io.stdout(`BODY_SHA256: ${bodyHash(readFile(abs(io.cwd, need(args, '--body')), 'body'))}\n`);
  return EXIT.ok;
}

function receiptCmd(argv: string[], io: CliIo): number {
  const args = parse(argv, { '--body': 'value', '--receipt': 'value', '--out': 'value' });
  const body = readFile(abs(io.cwd, need(args, '--body')), 'body');
  const receipt = readFile(abs(io.cwd, need(args, '--receipt')), 'receipt');
  const out = abs(io.cwd, need(args, '--out'));
  try {
    const existing = lstatSync(out);
    if (existing.isSymbolicLink() || !existing.isFile()) throw new Refusal('UNSAFE_PATH', `--out ${out} is not a regular file`, 'pass a new or regular file path');
  } catch (error) {
    if (error instanceof Refusal) throw error;
  }
  const result = upsert(body, receipt);
  const tmp = join(dirname(out), `.${basename(out)}.${randomBytes(6).toString('hex')}.tmp`);
  writeFileSync(tmp, result.body, { flag: 'wx', mode: 0o600 });
  renameSync(tmp, out);
  io.stdout(`BODY_SHA256: ${result.hash}\nOUT: ${out}\n`);
  return EXIT.ok;
}

export function main(argv: string[], io: CliIo): number {
  const [command, ...rest] = argv;
  try {
    if (command === undefined || command === '--help' || command === '-h') { io.stdout(help()); return command === undefined ? EXIT.usage : EXIT.ok; }
    if (command === '--version') { io.stdout(`docs-ship ${version()}\n`); return EXIT.ok; }
    if (command === 'classify') return classifyCmd(rest, io);
    if (command === 'check') return checkCmd(rest, io);
    if (command === 'tests') return testsCmd(rest, io);
    if (command === 'hash') return hashCmd(rest, io);
    if (command === 'receipt') return receiptCmd(rest, io);
    throw new Refusal('USAGE', `unknown command ${command}`, 'see docs-ship --help', EXIT.usage);
  } catch (error) {
    if (error instanceof Refusal || error instanceof BodyError) {
      io.stderr(`ERROR ${error.code}: ${error.message}\nFIX: ${error.fix}\n`);
      return error instanceof Refusal ? error.exit : EXIT.refused;
    }
    io.stderr(`ERROR INTERNAL: ${(error as Error).message}\nFIX: report this with the command you ran\n`);
    return EXIT.failed;
  }
}

if (import.meta.main) {
  const code = main(process.argv.slice(2), {
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
    cwd: process.cwd(),
  });
  process.exitCode = code;
}
