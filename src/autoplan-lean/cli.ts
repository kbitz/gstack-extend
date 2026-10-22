import { appendFileSync, closeSync, constants, copyFileSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { driftReport, UPSTREAM } from './criteria.ts';
import {
  PHASES, PlanError, VOICES, rawOutputMarkers, readSeal, recordSection, sha256, splitPlan, withRecord,
  type Phase, type Voice,
} from './plan.ts';
import { buildPrompt, parseSizeRecords } from './prompt.ts';
import { assembleSidecar } from './sidecar.ts';
import { PHASE_HISTORY, PHASE_OUTPUTS, parsePhaseHistory, type PhaseAttempt } from './history.ts';
import { checkMessage, checkPlan } from './transport.ts';

// All three launcher flags first coexist in Bun 1.3.3's src/cli/Arguments.zig.
export const BUN_FLOOR = '1.3.3';
export const EXIT = { ok: 0, failed: 1, usage: 2, refused: 3, drift: 4 } as const;

export type CliIo = { stdout(text: string): void; stderr(text: string): void; cwd: string };

class Refusal extends Error {
  constructor(public code: string, message: string, public fix: string, public exit: number = EXIT.refused) {
    super(message);
  }
}

export function help(): string {
  return `autoplan-lean — mechanics for /autoplan-lean: reviewer prompts, sidecar seal, transport checks
Requires Bun >= ${BUN_FLOOR} (--no-env-file --no-install --config=/dev/null).

Usage:
  autoplan-lean prompt --plan PLAN --run DIR --phase ceo|design|dx|eng --voice native|outside
  autoplan-lean archive-phase --run DIR --phase ceo|design|dx|eng
  autoplan-lean proper --plan PLAN --out FILE [--upstream-layout]
  autoplan-lean seal --plan PLAN --run DIR [--replace]
  autoplan-lean check --plan PLAN [--message FILE]
  autoplan-lean drift --snapshot-tool FILE --section PHASE=FILE... [--phases LIST]
  autoplan-lean --help | -h | --version

prompt   Build one reviewer prompt from the phase's upstream criteria, earlier
         phases' accepted settlements and the plan proper. Writes
         DIR/<phase>-<voice>-prompt.md and appends its size (bytes, SHA-256,
         never content) to DIR/prompt-sizes.jsonl. Refuses a plan proper that
         carries raw review output (RAW_OUTPUT_IN_PLAN) or malformed
         settlements (SETTLEMENTS_INVALID).
proper   Write the plan proper to FILE; --upstream-layout wraps it in
         "## Implementation plan" / "## Review record" for upstream scope tools.
archive-phase
         Preserve the phase's current review/native/outside outputs in
         DIR/phase-attempts.jsonl, then clear them for a rerun. An empty phase
         is a no-op. Invalid history refuses before changing current files.
seal     Assemble DIR's review files into the sidecar <plan-stem>.review-record.md
         beside PLAN, then write PLAN's "## Review record" section with the
         sidecar's path, SHA-256 and size. A sidecar already sealed by PLAN is
         kept as <plan-stem>.review-record.<sha12>.md; any other existing
         sidecar refuses unless --replace. Validation errors leave the sealed
         pair unchanged; publication failures restore it or report the
         retained recovery file. New review-record copies are owner-only;
         PLAN uses its existing permission mode, restricted by the process umask.
check    Check the transport shape of PLAN (and the copyable /implement prompt in FILE).
drift    Compare native criteria exactly and check known outside paragraphs
         in installed upstream text. Added outside requirements are not detected.

Output is KEY: value lines. Errors print "ERROR <CODE>: ..." and "FIX: ..." on
stderr. Exit codes: 0 ok · 1 check failed · 2 usage · 3 refused · 4 drift or
unreadable upstream text.
Upstream criteria source: ${UPSTREAM.repository}@${UPSTREAM.commit.slice(0, 12)} (${UPSTREAM.version}).
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

function parse(argv: string[], spec: Record<string, 'value' | 'flag' | 'multi'>): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const kind = spec[arg];
    if (!kind) throw new Refusal('USAGE', `unknown argument ${arg}`, 'see autoplan-lean --help', EXIT.usage);
    if (kind === 'flag') { out[arg] = ['1']; continue; }
    const value = argv[++i];
    if (value === undefined) throw new Refusal('USAGE', `${arg} requires a value`, 'see autoplan-lean --help', EXIT.usage);
    if (kind === 'value' && out[arg]) throw new Refusal('USAGE', `duplicate ${arg}`, 'pass it once', EXIT.usage);
    (out[arg] ??= []).push(value);
  }
  return out;
}

function need(args: Args, key: string): string {
  const value = args[key]?.[0];
  if (value === undefined) throw new Refusal('USAGE', `${key} is required`, 'see autoplan-lean --help', EXIT.usage);
  return value;
}

/** Regular, non-symlink file contents, or undefined when absent. */
function readRegular(path: string, label: string): Buffer | undefined {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return undefined;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Refusal('UNSAFE_PATH', `${label} ${path} is not a regular file`, 'pass a regular file, not a symlink or directory');
  return readFileSync(path);
}

function requireDir(path: string): void {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    throw new Refusal('RUN_DIR_MISSING', `run directory ${path} does not exist`, 'create it first (mkdir -p) outside the repository');
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Refusal('UNSAFE_PATH', `run directory ${path} is not a directory`, 'pass a real directory, not a symlink');
}

/** Finish a complete, flushed file beside its target before publishing it. */
function stageAtomic(path: string, text: string | Buffer, mode?: number): string {
  const existing = (() => { try { return lstatSync(path); } catch { return undefined; } })();
  if (existing && (existing.isSymbolicLink() || !existing.isFile())) throw new Refusal('UNSAFE_PATH', `${path} is not a regular file`, 'remove the symlink or directory first');
  const tmp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    const fd = openSync(tmp, 'wx', mode ?? (existing ? existing.mode & 0o777 : 0o644));
    try {
      writeFileSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
  return tmp;
}

/** Write beside the target, then rename over it. */
function writeAtomic(path: string, text: string): void {
  const tmp = stageAtomic(path, text);
  try {
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
}

const abs = (cwd: string, path: string) => (isAbsolute(path) ? path : resolve(cwd, path));

function readPlan(path: string): string {
  const bytes = readRegular(path, 'plan');
  if (!bytes) throw new Refusal('PLAN_MISSING', `plan ${path} does not exist`, 'pass the active plan path');
  return bytes.toString('utf8');
}

export function sidecarPathFor(planPath: string): string {
  const stem = basename(planPath).replace(/\.md$/i, '');
  return join(dirname(planPath), `${stem}.review-record.md`);
}

function promptCmd(argv: string[], io: CliIo): number {
  const args = parse(argv, { '--plan': 'value', '--run': 'value', '--phase': 'value', '--voice': 'value' });
  const plan = abs(io.cwd, need(args, '--plan'));
  const run = abs(io.cwd, need(args, '--run'));
  const phase = need(args, '--phase') as Phase;
  const voice = need(args, '--voice') as Voice;
  if (!PHASES.includes(phase)) throw new Refusal('USAGE', `--phase must be one of ${PHASES.join(', ')}`, 'see autoplan-lean --help', EXIT.usage);
  if (!VOICES.includes(voice)) throw new Refusal('USAGE', `--voice must be one of ${VOICES.join(', ')}`, 'see autoplan-lean --help', EXIT.usage);
  requireDir(run);
  const built = buildPrompt(readPlan(plan), phase, voice);
  const sizesPath = join(run, 'prompt-sizes.jsonl');
  const prior = readRegular(sizesPath, 'size log');
  const attempt = (prior ? parseSizeRecords(prior.toString('utf8')) : []).filter((r) => r.phase === phase && r.voice === voice).length + 1;
  const out = join(run, `${phase}-${voice}-prompt.md`);
  writeAtomic(out, built.text);
  appendFileSync(sizesPath, `${JSON.stringify({ ...built.record, attempt })}\n`);
  io.stdout(`PROMPT: ${out}\nBYTES: ${built.record.bytes}\nSHA256: ${built.record.sha256}\nPLAN_BYTES: ${built.record.plan_bytes}\nSETTLEMENTS: ${built.record.settlements}\nATTEMPT: ${attempt}\n`);
  return EXIT.ok;
}

function properCmd(argv: string[], io: CliIo): number {
  const args = parse(argv, { '--plan': 'value', '--out': 'value', '--upstream-layout': 'flag' });
  const { proper } = splitPlan(readPlan(abs(io.cwd, need(args, '--plan'))));
  const out = abs(io.cwd, need(args, '--out'));
  const text = args['--upstream-layout'] ? `## Implementation plan\n${proper}## Review record\n` : proper;
  writeAtomic(out, text);
  io.stdout(`PROPER: ${out}\nBYTES: ${Buffer.byteLength(text)}\n`);
  return EXIT.ok;
}

function archivePhaseCmd(argv: string[], io: CliIo): number {
  const args = parse(argv, { '--run': 'value', '--phase': 'value' });
  const run = abs(io.cwd, need(args, '--run'));
  const phase = need(args, '--phase') as Phase;
  if (!PHASES.includes(phase)) throw new Refusal('USAGE', `--phase must be one of ${PHASES.join(', ')}`, 'see autoplan-lean --help', EXIT.usage);
  requireDir(run);
  const historyPath = join(run, PHASE_HISTORY);
  const prior = readRegular(historyPath, 'phase history')?.toString('utf8') ?? '';
  const history = parsePhaseHistory(prior);
  const row: PhaseAttempt = { v: 1, phase, attempt: history.filter((entry) => entry.phase === phase).length + 1 };
  const current: string[] = [];
  for (const key of PHASE_OUTPUTS) {
    const path = join(run, `${phase}-${key}.md`);
    const bytes = readRegular(path, 'phase output');
    if (bytes === undefined) continue;
    row[key] = bytes.toString('utf8');
    current.push(path);
  }
  if (!current.length) {
    io.stdout(`PHASE: ${phase}\nSTATUS: empty\n`);
    return EXIT.ok;
  }
  writeAtomic(historyPath, `${prior}${prior && !prior.endsWith('\n') ? '\n' : ''}${JSON.stringify(row)}\n`);
  // Publish the complete snapshot first. Even a cleanup failure retains every
  // byte in history; callers must stop on failure before writing a new attempt.
  for (const path of current) rmSync(path);
  io.stdout(`HISTORY: ${historyPath}\nPHASE: ${phase}\nATTEMPT: ${row.attempt}\nSTATUS: archived\n`);
  return EXIT.ok;
}

const RUN_FILES = new Set(['intake.md', 'prompt-sizes.jsonl', 'phase-attempts.jsonl', 'decisions.md', 'gate.md',
  ...PHASES.flatMap((p) => [`${p}-review.md`, `${p}-native.md`, `${p}-outside.md`])]);

function sealCmd(argv: string[], io: CliIo): number {
  const args = parse(argv, { '--plan': 'value', '--run': 'value', '--replace': 'flag' });
  const planPath = abs(io.cwd, need(args, '--plan'));
  const run = abs(io.cwd, need(args, '--run'));
  requireDir(run);
  const plan = readPlan(planPath);
  const parts = splitPlan(plan);
  const leaked = rawOutputMarkers(parts.proper);
  if (leaked.length) throw new Refusal('RAW_OUTPUT_IN_PLAN', `the plan proper contains review output (${leaked.join(', ')})`, 'move it to the run directory before sealing');
  const sidecar = sidecarPathFor(planPath);
  let previous: { path: string; sha256: string } | undefined;
  let archiveMissing = false;
  const existing = readRegular(sidecar, 'sidecar');
  if (existing) {
    const seal = readSeal(parts.record);
    const hash = sha256(existing);
    if (seal.path === sidecar && seal.sha256 === hash) {
      const archive = sidecar.replace(/\.review-record\.md$/, `.review-record.${hash.slice(0, 12)}.md`);
      const archived = readRegular(archive, 'archived sidecar');
      if (archived && sha256(archived) !== hash) throw new Refusal('SIDECAR_EXISTS', `${archive} exists with different content`, 'move it aside, then seal again');
      archiveMissing = archived === undefined;
      previous = { path: archive, sha256: hash };
    } else if (!args['--replace']) {
      throw new Refusal('SIDECAR_EXISTS', `${sidecar} exists and is not the record this plan sealed`, 'move it aside, or pass --replace to overwrite it');
    }
  }
  const files = (name: string) => {
    if (!RUN_FILES.has(name)) return undefined;
    return readRegular(join(run, name), 'run file')?.toString('utf8');
  };
  // Read and validate every run input before touching the existing sealed pair.
  const record = assembleSidecar(planPath, run, files, previous);
  const hash = sha256(record);
  const size = Buffer.byteLength(record);
  const nextPlan = withRecord(plan, recordSection(sidecar, hash, size));
  const planHash = sha256(nextPlan);
  const planSize = Buffer.byteLength(nextPlan);
  const staged: string[] = [];
  const stage = (path: string, text: string | Buffer, mode?: number) => {
    const tmp = stageAtomic(path, text, mode);
    staged.push(tmp);
    return tmp;
  };
  let recovery: string | undefined;
  try {
    // Review content stays private from its first write, even when replacing
    // an older permissive sidecar. The process umask can narrow plan permissions.
    const nextSidecarFile = stage(sidecar, record, 0o600);
    const nextPlanFile = stage(planPath, nextPlan);
    const backup = existing === undefined ? undefined : stage(sidecar, existing, 0o600);
    // Copy without removing the active sidecar; never replace an archive that
    // appeared since preflight. The backup contains the exact bytes we sealed.
    if (previous && archiveMissing) copyFileSync(backup!, previous.path, constants.COPYFILE_EXCL);
    renameSync(nextSidecarFile, sidecar);
    try {
      renameSync(nextPlanFile, planPath);
    } catch (publicationError) {
      try {
        if (backup) renameSync(backup, sidecar);
        else rmSync(sidecar);
      } catch (restoreError) {
        // Keep the backup for recovery instead of deleting the only unarchived
        // copy (for example, when --replace was used on a foreign sidecar).
        recovery = backup;
        throw new Refusal('SEAL_RECOVERY_FAILED',
          `plan publication failed (${(publicationError as Error).message}); sidecar restoration also failed (${(restoreError as Error).message}). Plan remains at ${planPath}`,
          backup ? `restore ${sidecar} from ${backup}, then run check --plan ${planPath} before retrying` : `remove the new unsealed sidecar ${sidecar} before retrying`,
          EXIT.failed);
      }
      throw new Refusal('SEAL_WRITE_FAILED',
        `plan publication failed (${(publicationError as Error).message}); the prior plan and sidecar state was restored`,
        'resolve the write error, then seal again', EXIT.failed);
    }
  } finally {
    for (const tmp of staged) {
      if (tmp === recovery) continue;
      try { rmSync(tmp, { force: true }); }
      catch (error) {
        // A second I/O failure must not hide the original failure or its
        // retained recovery path. Report any additional files left to remove.
        io.stderr(`WARNING: could not remove staging file ${tmp}: ${(error as Error).message}\n`);
      }
    }
  }
  io.stdout(`SIDECAR: ${sidecar}\nSHA256: ${hash}\nBYTES: ${size}\nPLAN: ${planPath}\nPLAN_SHA256: ${planHash}\nPLAN_BYTES: ${planSize}\n${previous ? `PREVIOUS: ${previous.path}\n` : ''}STATUS: sealed\n`);
  return EXIT.ok;
}

function checkCmd(argv: string[], io: CliIo): number {
  const args = parse(argv, { '--plan': 'value', '--message': 'value' });
  const planPath = abs(io.cwd, need(args, '--plan'));
  const bytes = readRegular(planPath, 'plan');
  if (!bytes) throw new Refusal('PLAN_MISSING', `plan ${planPath} does not exist`, 'pass the active plan path');
  const problems = checkPlan(bytes, (path) => {
    try {
      return readRegular(path, 'sidecar');
    } catch {
      return undefined;
    }
  });
  const message = args['--message']?.[0];
  if (message !== undefined) {
    const text = readRegular(abs(io.cwd, message), 'message');
    if (!text) throw new Refusal('MESSAGE_MISSING', `message file ${message} does not exist`, 'write the final message to a file first');
    problems.push(...checkMessage(text.toString('utf8')).map((p) => `message: ${p}`));
  }
  const { proper } = splitPlan(bytes.toString('utf8'));
  let out = `PLAN_BYTES: ${bytes.byteLength}\nPROPER_BYTES: ${Buffer.byteLength(proper)}\n`;
  for (const p of problems) out += `PROBLEM: ${p}\n`;
  out += `CHECK: ${problems.length ? 'fail' : 'ok'}\n`;
  io.stdout(out);
  return problems.length ? EXIT.failed : EXIT.ok;
}

function driftCmd(argv: string[], io: CliIo): number {
  const args = parse(argv, { '--snapshot-tool': 'value', '--section': 'multi', '--phases': 'value' });
  const phases = (args['--phases']?.[0] ?? PHASES.join(',')).split(',').map((p) => p.trim()) as Phase[];
  for (const p of phases) if (!PHASES.includes(p)) throw new Refusal('USAGE', `unknown phase ${p}`, `use ${PHASES.join(', ')}`, EXIT.usage);
  const read = (path: string) => {
    try {
      return readRegular(abs(io.cwd, path), 'upstream file')?.toString('utf8');
    } catch {
      return undefined;
    }
  };
  const snapshot = read(need(args, '--snapshot-tool'));
  const sections: Partial<Record<Phase, string>> = {};
  for (const entry of args['--section'] ?? []) {
    const [phase, path] = [entry.slice(0, entry.indexOf('=')), entry.slice(entry.indexOf('=') + 1)];
    if (!PHASES.includes(phase as Phase) || !path) throw new Refusal('USAGE', `--section must be PHASE=FILE, got ${entry}`, 'see autoplan-lean --help', EXIT.usage);
    sections[phase as Phase] = read(path);
  }
  const items = driftReport(snapshot, sections, phases);
  let out = `UPSTREAM_COPY: ${UPSTREAM.repository}@${UPSTREAM.commit} (${UPSTREAM.version})\n`;
  for (const item of items) out += `CRITERIA: ${item.phase} ${item.voice} ${item.status}${item.detail ? ` (${item.detail})` : ''}\n`;
  const bad = items.filter((i) => i.status !== 'match');
  out += `DRIFT: ${bad.some((i) => i.status === 'drift') ? 'found' : bad.length ? 'unknown' : 'none'}\n`;
  io.stdout(out);
  return bad.length ? EXIT.drift : EXIT.ok;
}

export function main(argv: string[], io: CliIo): number {
  const [command, ...rest] = argv;
  try {
    if (command === undefined || command === '--help' || command === '-h') { io.stdout(help()); return command === undefined ? EXIT.usage : EXIT.ok; }
    if (command === '--version') { io.stdout(`autoplan-lean ${version()}\n`); return EXIT.ok; }
    if (command === 'prompt') return promptCmd(rest, io);
    if (command === 'archive-phase') return archivePhaseCmd(rest, io);
    if (command === 'proper') return properCmd(rest, io);
    if (command === 'seal') return sealCmd(rest, io);
    if (command === 'check') return checkCmd(rest, io);
    if (command === 'drift') return driftCmd(rest, io);
    throw new Refusal('USAGE', `unknown command ${command}`, 'see autoplan-lean --help', EXIT.usage);
  } catch (error) {
    if (error instanceof Refusal || error instanceof PlanError) {
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
