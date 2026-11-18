import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, openSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, statSync, unlinkSync, writeSync, type Stats } from 'node:fs';
import { hostname } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { applyCommand, collectEvidenceItems, CORRUPT_ORDER_FIX, CORRUPT_READ_FIX, isVersion, REASONS, serializeState, truncate80, validateStoredState, type CommandName, type EnvChecker, type GitInfo, type ReasonCode, type RetryHint, type ReviewRunState, type SideEffects, type StatusCode } from './state.ts';

export const DEFAULT_VERSION_PATH = resolve(import.meta.dir, '..', '..', 'VERSION');

let lastValidatedRealDir: string | null = null;
let lastValidatedCommand: string | null = null;

export function resetValidatedStateDir(): void {
  lastValidatedRealDir = null;
  lastValidatedCommand = null;
}

export function getLastValidatedCommand(): string | null {
  return lastValidatedCommand;
}

export class GitExecutionError extends Error {
  readonly git: string;
  readonly errno: string | null;
  readonly signal: string | null;

  constructor(git: string, errno: string | null, signal: string | null, message?: string) {
    const parts = [`git ${git} execution failed`];
    if (errno) parts.push(`(${errno})`);
    if (signal) parts.push(`[${signal}]`);
    super(message && message.trim().length > 0 ? message.trim() : parts.join(' '));
    this.name = 'GitExecutionError';
    this.git = git;
    this.errno = errno;
    this.signal = signal;
  }
}

export function readHelperVersion(versionPath = DEFAULT_VERSION_PATH): string | null {
  try {
    const st = lstatSync(versionPath);
    if (st.isSymbolicLink() || !st.isFile() || st.size > 128) return null;
    const raw = readFileSync(versionPath, 'utf8').trim();
    return isVersion(raw) ? raw : null;
  } catch {
    return null;
  }
}

export type StoreResult = {
  v: 1;
  command: string;
  status: StatusCode;
  reason: ReasonCode;
  detail: Record<string, unknown>;
  fix: string | null;
  state_path: string | null;
  rev: number | null;
  helper_version: string | null;
  side_effects: SideEffects;
  retry: RetryHint;
  retry_after_ms: number | null;
  exitCode: 0 | 1 | 2 | 3 | 4 | 5;
};

export function cleanGitEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('GIT_')));
  out.GIT_CONFIG_GLOBAL = '/dev/null';
  out.GIT_CONFIG_NOSYSTEM = '1';
  return out;
}

export function runGit(cwd: string, args: string[], env: NodeJS.ProcessEnv): { ok: boolean; stdout: string } {
  const r = spawnSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8', stdio: 'pipe', timeout: 5000 });
  if (r.error || r.signal !== null || r.status === null) {
    const errCode = (r.error as NodeJS.ErrnoException | undefined)?.code ?? null;
    throw new GitExecutionError(args[0] ?? 'git', errCode, r.signal ?? null, r.error?.message);
  }
  return { ok: r.status === 0, stdout: (r.stdout ?? '').replace(/\r?\n$/, '') };
}

export type ValidatedStateDir =
  | { ok: true; realTop: string; realDir: string; statePath: string; gitEnv: NodeJS.ProcessEnv }
  | { ok: false; result: StoreResult };

export function validateStateDir(
  command: string,
  dirArg: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  helperVersion: string | null,
): ValidatedStateDir {
  lastValidatedRealDir = null;
  lastValidatedCommand = command;
  const reply = (reason: ReasonCode, detail: Record<string, unknown>, sPath: string | null, customFix?: string): ValidatedStateDir =>
    ({ ok: false, result: makeEnvelope(command, reason, detail, sPath, null, customFix, helperVersion, null) });

  if (isAbsolute(dirArg)) dirArg = dirArg.replace(/\/+$/, '') || '/'; // lstat must inspect the final component itself.
  let statePath = isAbsolute(dirArg) ? join(dirArg, 'review-run-state.json') : null;

  const gitEnv = cleanGitEnv(env);
  const topRes = runGit(cwd, ['rev-parse', '--show-toplevel'], gitEnv);
  if (!topRes.ok || !topRes.stdout) return reply('not-in-worktree', { cwd: truncate80(cwd) }, statePath);
  const realTop = realpathSync(topRes.stdout);

  if (!isAbsolute(dirArg)) {
    return reply('bad-dir', { condition: 'relative', resolved_path: truncate80(resolve(cwd, dirArg)), toplevel: truncate80(realTop) }, null, 'Pass an absolute --dir path outside the Git work tree, or continue inline (D1).');
  }

  let dirStat;
  try {
    dirStat = lstatSync(dirArg);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') {
      return reply('bad-dir', { condition: 'missing', resolved_path: truncate80(dirArg), toplevel: truncate80(realTop) }, statePath, 'Create the directory supplied in --dir with mkdir -p outside the work tree, or continue inline (D1).');
    }
    return reply('unwritable', { errno: e.code ?? 'EIO', syscall: e.syscall ?? 'lstat', path: truncate80(dirArg) }, statePath);
  }
  if (dirStat.isSymbolicLink()) return reply('bad-dir', { condition: 'symlink', resolved_path: truncate80(dirArg), toplevel: truncate80(realTop) }, statePath, 'Pass a real directory path for --dir (final component must not be a symlink), or continue inline (D1).');
  if (!dirStat.isDirectory()) return reply('bad-dir', { condition: 'not-directory', resolved_path: truncate80(dirArg), toplevel: truncate80(realTop) }, statePath, 'Pass an existing directory path for --dir, or continue inline (D1).');

  const realDir = realpathSync(dirArg);
  statePath = join(realDir, 'review-run-state.json');
  if (realDir === realTop || realDir.startsWith(`${realTop}/`)) {
    return reply('bad-dir', { condition: 'in-worktree', resolved_path: truncate80(realDir), toplevel: truncate80(realTop) }, statePath, 'Place --dir outside the Git work tree, or continue inline (D1).');
  }

  lastValidatedRealDir = realDir;
  return { ok: true, realTop, realDir, statePath, gitEnv };
}

const compactUtcTimestamp = (d = new Date()): string =>
  d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

const randomHex = (bytes: number): string => {
  try {
    return randomBytes(bytes).toString('hex');
  } catch {
    let out = '';
    for (let i = 0; i < bytes; i++) out += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
    return out;
  }
};

export function internalErrorResult(
  command: string,
  err: unknown,
  statePath: string | null = null,
  helperVersion: string | null = readHelperVersion(),
): StoreResult {
  const isGit = err instanceof GitExecutionError;
  const cause: 'git-execution' | 'uncaught' = isGit ? 'git-execution' : 'uncaught';
  const errObj = err instanceof Error ? err : new Error(String(err));
  const rawMessage = errObj.message || errObj.name || 'internal error';
  const now = new Date();
  const isoNow = now.toISOString();
  const utcTag = compactUtcTimestamp(now);

  let trace: string | null = null;
  if (lastValidatedRealDir !== null) {
    const traceName = `review-state-error-${utcTag}-${process.pid}-${randomHex(4)}.txt`;
    const tracePath = join(lastValidatedRealDir, traceName);
    const traceLines = [
      `time: ${isoNow}`,
      `command: ${command}`,
      `helper_version: ${helperVersion ?? 'unknown'}`,
      `cause: ${cause}`,
      `name: ${errObj.name || 'Error'}`,
      `message: ${rawMessage}`,
      ...(isGit ? [`git: ${err.git}`, `errno: ${err.errno ?? 'null'}`, `signal: ${err.signal ?? 'null'}`] : []),
      `stack:\n${errObj.stack ?? `${errObj.name}: ${rawMessage}`}`,
    ];
    let created = false;
    try {
      const fd = openSync(tracePath, 'wx', 0o600);
      created = true;
      try {
        writeAll(fd, Buffer.from(`${traceLines.join('\n')}\n`, 'utf8'));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      trace = traceName;
    } catch {
      if (created) unlinkQuiet(tracePath);
      trace = null;
    }
  }

  const detail: Record<string, unknown> = {
    cause,
    message: truncate80(rawMessage),
    trace,
    ...(isGit ? { git: err.git, errno: err.errno, signal: err.signal } : {}),
  };
  const resolvedStatePath = statePath ?? (lastValidatedRealDir ? join(lastValidatedRealDir, 'review-run-state.json') : null);
  return makeEnvelope(command || 'unknown', 'internal-error', detail, resolvedStatePath, null, undefined, helperVersion, null);
}

export function makeEnvelope(
  command: string,
  reason: ReasonCode,
  detail: Record<string, unknown>,
  statePath: string | null,
  rev: number | null,
  customFix?: string,
  helperVersion: string | null = readHelperVersion(),
  retryAfterMs: number | null = reason === 'busy' ? 5000 : null,
): StoreResult {
  const meta = REASONS[reason];
  const isOk = reason === 'recorded' || reason === 'replayed';
  return {
    v: 1,
    command,
    status: meta.status,
    reason,
    detail,
    fix: isOk ? null : (customFix ?? meta.fix),
    state_path: statePath,
    rev,
    helper_version: helperVersion,
    side_effects: meta.side_effects,
    retry: meta.retry,
    retry_after_ms: reason === 'busy' ? retryAfterMs : null,
    exitCode: meta.exit,
  };
}

export function writeAll(fd: number, buf: Buffer): void {
  let off = 0;
  while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off);
}

export const unlinkQuiet = (p: string) => { try { unlinkSync(p); } catch { /* ignore */ } };

export type InputJsonResult =
  | { ok: true; rawInput: unknown; realInput: string }
  | { ok: false; result: StoreResult };

export function readInputJson(
  command: string,
  inputArg: string,
  realDir: string,
  statePath: string | null,
  helperVersion: string | null,
  rev: number | null = null,
): InputJsonResult {
  const reply = (reason: ReasonCode, detail: Record<string, unknown>): InputJsonResult =>
    ({ ok: false, result: makeEnvelope(command, reason, detail, statePath, rev, undefined, helperVersion, null) });

  if (!isAbsolute(inputArg)) return reply('usage', { message: '--input must be an absolute path inside --dir' });
  let inStat;
  try { inStat = lstatSync(inputArg); } catch { return reply('usage', { message: '--input file does not exist' }); }
  if (inStat.isSymbolicLink() || !inStat.isFile()) return reply('usage', { message: '--input must be a regular file, not a symlink or directory' });
  if (inStat.size > 1048576) return reply('usage', { message: '--input file exceeds 1 MiB limit (1048576 bytes)' });
  let realInput: string;
  try { realInput = realpathSync(inputArg); } catch { return reply('usage', { message: '--input path could not be resolved' }); }
  if (!realInput.startsWith(`${realDir}/`)) return reply('usage', { message: '--input file must reside inside --dir' });
  if (TMP_FILE_RE.test(basename(realInput).toLowerCase())) return reply('usage', { message: '--input must not use helper temporary-file names' });

  let rawInput: unknown;
  try { rawInput = JSON.parse(readFileSync(realInput, 'utf8')); } catch { return reply('invalid-input', { violations: [{ path: '$', rule: 'invalid-json', expected: 'valid-json-object' }] }); }
  return { ok: true, rawInput, realInput };
}

const TMP_FILE_RE = /^review-run-state\.json\.tmp-\d+-[0-9a-f]+$/;

export type DirFileError = 'evidence-outside-dir' | 'evidence-not-regular-file' | 'evidence-digest-mismatch' | 'evidence-missing' | 'evidence-changed';

export function checkDirFile(
  realDir: string,
  relPath: string,
  sha256?: string,
): { ok: true; realPath: string; bytes: Buffer; sha256: string; size: number; mtimeMs: number; dev: number; ino: number } | { ok: false; error: DirFileError } {
  const candidatePath = resolve(realDir, relPath);
  if (!candidatePath.startsWith(`${realDir}/`)) return { ok: false, error: 'evidence-outside-dir' };
  try {
    const lst = lstatSync(candidatePath);
    const realEv = realpathSync(candidatePath);
    if (!realEv.startsWith(`${realDir}/`)) return { ok: false, error: 'evidence-outside-dir' };
    const st = lst.isSymbolicLink() ? statSync(realEv) : lst;
    if (!st.isFile()) return { ok: false, error: 'evidence-not-regular-file' };
    const bytes = readFileSync(realEv);
    const actualSha = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== undefined && actualSha !== sha256) return { ok: false, error: 'evidence-digest-mismatch' };
    return { ok: true, realPath: realEv, bytes, sha256: actualSha, size: st.size, mtimeMs: st.mtimeMs, dev: st.dev, ino: st.ino };
  } catch {
    return { ok: false, error: 'evidence-missing' };
  }
}

export type StaleLockReason = 'process-exited' | 'boot-changed' | 'unparseable-aged';
export type LockClassification =
  | { status: 'stale'; reason: StaleLockReason }
  | { status: 'live' | 'other-host' | 'unverifiable' };

export const UNPARSEABLE_LOCK_GRACE_MS = 60_000;
export const MAX_STALE_LOCK_BREAKS = 3;
const MAX_CORRUPT_BACKUP_ATTEMPTS = 8;

export function readLocalBootId(): string | null {
  try {
    const raw = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function readLocalPidNs(): string | null {
  try {
    const raw = readlinkSync('/proc/self/ns/pid').trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function defaultProbePid(pid: number): 'alive' | 'esrch' | 'other' {
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return 'esrch';
    if (code === 'EPERM') return 'alive';
    return 'other';
  }
}

export function classifyLockHolder(
  rawBytes: string,
  mtimeMs: number,
  nowMs: number,
  localHost: string,
  localBootId: string | null,
  localPidNs: string | null,
  probePid: (pid: number) => 'alive' | 'esrch' | 'other' = defaultProbePid,
): LockClassification {
  const rec = parseLock(rawBytes);
  if (typeof rec?.host === 'string' && rec.host !== '' && rec.host !== localHost) return { status: 'other-host' };
  if (
    rec === null ||
    typeof rec.pid !== 'number' ||
    !Number.isSafeInteger(rec.pid) ||
    typeof rec.host !== 'string' ||
    rec.host === '' ||
    typeof rec.started_at !== 'string' ||
    rec.started_at === ''
  ) {
    return nowMs - mtimeMs > UNPARSEABLE_LOCK_GRACE_MS
      ? { status: 'stale', reason: 'unparseable-aged' }
      : { status: 'unverifiable' };
  }
  const lockBootId = typeof rec.boot_id === 'string' && rec.boot_id.length > 0 ? rec.boot_id : null;
  if (lockBootId !== null && localBootId !== null && lockBootId !== localBootId) {
    return { status: 'stale', reason: 'boot-changed' };
  }
  const lockPidNs = typeof rec.pid_ns === 'string' && rec.pid_ns.length > 0 ? rec.pid_ns : null;
  if (lockPidNs !== null && localPidNs !== null && lockPidNs !== localPidNs) {
    return { status: 'unverifiable' };
  }
  if (rec.pid <= 0) return { status: 'unverifiable' };
  const probe = probePid(rec.pid);
  if (probe === 'esrch') return { status: 'stale', reason: 'process-exited' };
  if (probe === 'alive') return { status: 'live' };
  return { status: 'unverifiable' };
}

function parseLock(raw: string): Record<string, unknown> | null {
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data === 'object' && data !== null && !Array.isArray(data)) return data as Record<string, unknown>;
  } catch { /* empty or malformed lock */ }
  return null;
}

type LockSnapshot = { stat: Stats; bytes: Buffer };

function readLockSnapshot(lockPath: string): LockSnapshot | null {
  try {
    // Inspect one inode and avoid following links or waiting on a non-regular lock.
    const fd = openSync(lockPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = fstatSync(fd);
      return stat.isFile() ? { stat, bytes: readFileSync(fd) } : null;
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

const sameFile = (a: Stats, b: Stats): boolean => a.dev === b.dev && a.ino === b.ino;

function reclaimLock(lockPath: string, ownToken: string, before: LockSnapshot): 'retry' | 'reclaimed' | 'wait' {
  const stalePath = `${lockPath}.stale-${ownToken}`;
  try {
    renameSync(lockPath, stalePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'retry';
    throw err;
  }

  const after = readLockSnapshot(stalePath);
  // The filesystem may reuse an inode number after another invocation reclaims the lock.
  const matched = after !== null && sameFile(before.stat, after.stat) &&
    before.stat.mtimeMs === after.stat.mtimeMs && before.bytes.equals(after.bytes);
  if (!matched) {
    try {
      linkSync(stalePath, lockPath);
    } catch (err) {
      // Keep the moved lock available for inspection if restoration fails.
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  unlinkSync(stalePath);
  return matched ? 'reclaimed' : 'wait';
}

function parseLockHolder(lockPath: string): { pid: number | null; host: string | null; started_at: string | null; unknown: boolean } {
  const lock = readLockSnapshot(lockPath);
  const holder = lock && parseLock(lock.bytes.toString('utf8'));
  if (holder && typeof holder.pid === 'number' && Number.isInteger(holder.pid) &&
    typeof holder.host === 'string' && holder.host !== '' &&
    typeof holder.started_at === 'string' && holder.started_at !== '') {
    return { pid: holder.pid, host: truncate80(holder.host), started_at: truncate80(holder.started_at), unknown: false };
  }
  return { pid: null, host: null, started_at: null, unknown: true };
}

function holdsOwnLock(lockPath: string, ownToken: string): boolean {
  const lock = readLockSnapshot(lockPath);
  return lock !== null && parseLock(lock.bytes.toString('utf8'))?.token === ownToken;
}

function linkCorruptBackup(statePath: string): string {
  const utcTag = compactUtcTimestamp();
  for (let attempt = 1; ; attempt++) {
    const backupPath = `${statePath}.corrupt-${utcTag}-${randomHex(4)}`;
    try {
      linkSync(statePath, backupPath);
      return backupPath;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST' || attempt >= MAX_CORRUPT_BACKUP_ATTEMPTS) throw err;
    }
  }
}

function removeRedundantBackup(statePath: string, backupPath: string): boolean {
  try {
    if (!sameFile(lstatSync(statePath), lstatSync(backupPath))) return false;
    unlinkSync(backupPath);
    return true;
  } catch {
    return false;
  }
}

export function executeCommand(command: CommandName, dirArg: string, inputArg: string, cwd: string, env: NodeJS.ProcessEnv = process.env, versionPath?: string): StoreResult {
  const helperVersion = readHelperVersion(versionPath);
  const reply = (reason: ReasonCode, detail: Record<string, unknown>, sPath: string | null, rev: number | null, customFix?: string, retryAfterMs: number | null = null) =>
    makeEnvelope(command, reason, detail, sPath, rev, customFix, helperVersion, retryAfterMs);

  if (isAbsolute(dirArg)) dirArg = dirArg.replace(/\/+$/, '') || '/'; // lstat must inspect the final component itself.
  let statePath = isAbsolute(dirArg) ? join(dirArg, 'review-run-state.json') : null;
  const waitRaw = env.GSTACK_EXTEND_REVIEW_STATE_LOCK_WAIT_MS ?? '5000';
  if (!/^\d+$/.test(waitRaw) || Number(waitRaw) < 0 || Number(waitRaw) > 60000) {
    return reply('usage', { message: truncate80(`invalid GSTACK_EXTEND_REVIEW_STATE_LOCK_WAIT_MS "${waitRaw}"; expected integer in 0..60000`) }, statePath, null);
  }
  const lockWaitMs = Number(waitRaw);

  const dirCheck = validateStateDir(command, dirArg, cwd, env, helperVersion);
  if (!dirCheck.ok) return dirCheck.result;
  const { realTop, realDir, gitEnv } = dirCheck;
  statePath = dirCheck.statePath;

  const inCheck = readInputJson(command, inputArg, realDir, statePath, helperVersion);
  if (!inCheck.ok) return inCheck.result;
  const { rawInput } = inCheck;

  const evidenceErrors = new Map<string, string>();
  const evidenceSnapshots = new Map<string, { relPath: string; realPath: string; size: number; mtimeMs: number; dev: number; ino: number }>();
  for (const item of collectEvidenceItems(command, rawInput)) {
    const key = `${item.path}:${item.sha256}`;
    const check = checkDirFile(realDir, item.path, item.sha256);
    if (!check.ok) evidenceErrors.set(key, check.error);
    else if ([item.path, check.realPath].some((p) => TMP_FILE_RE.test(basename(p).toLowerCase()))) evidenceErrors.set(key, 'evidence-reserved-path');
    else evidenceSnapshots.set(key, { relPath: item.path, realPath: check.realPath, size: check.size, mtimeMs: check.mtimeMs, dev: check.dev, ino: check.ino });
  }

  const envChecker: EnvChecker = {
    commitExists: (sha) => runGit(cwd, ['cat-file', '-e', `${sha}^{commit}`], gitEnv).ok,
    commitTree: (sha) => runGit(cwd, ['cat-file', '-e', `${sha}^{commit}`], gitEnv).ok ? (runGit(cwd, ['rev-parse', `${sha}^{tree}`], gitEnv).stdout || null) : null,
    isAncestor: (anc, desc) => runGit(cwd, ['merge-base', '--is-ancestor', anc, desc], gitEnv).ok,
    checkEvidence: (p, sha256) => evidenceErrors.get(`${p}:${sha256}`) ?? null,
  };

  const lockPath = join(realDir, 'review-run-state.json.lock');
  const localHost = hostname();
  const localBootId = readLocalBootId();
  const localPidNs = readLocalPidNs();
  const ownToken = randomHex(16);
  let staleBreaks = 0;
  let reclaimedReason: StaleLockReason | null = null;
  const startMs = Date.now();
  while (true) {
    let created = false;
    try {
      const fd = openSync(lockPath, 'wx', 0o600);
      created = true;
      try {
        const lockObj = {
          pid: process.pid,
          host: localHost,
          started_at: new Date().toISOString(),
          token: ownToken,
          boot_id: localBootId,
          pid_ns: localPidNs,
        };
        writeAll(fd, Buffer.from(`${JSON.stringify(lockObj)}\n`, 'utf8'));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      break;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (created) unlinkQuiet(lockPath);
      if (!created && e.code === 'EEXIST') {
        if (staleBreaks < MAX_STALE_LOCK_BREAKS) {
          const lock = readLockSnapshot(lockPath);
          if (lock !== null) {
            const classification = classifyLockHolder(lock.bytes.toString('utf8'), lock.stat.mtimeMs, Date.now(), localHost, localBootId, localPidNs);
            if (classification.status === 'stale') {
              staleBreaks++;
              try {
                const reclaim = reclaimLock(lockPath, ownToken, lock);
                if (reclaim === 'reclaimed') reclaimedReason ??= classification.reason;
                if (reclaim !== 'wait') continue;
              } catch (err) {
                const fault = err as NodeJS.ErrnoException;
                return reply('unwritable', { errno: fault.code ?? 'EIO', syscall: fault.syscall ?? 'rename', path: truncate80(fault.path ?? lockPath) }, statePath, null);
              }
            }
          }
        }
        if (Date.now() - startMs >= lockWaitMs) return reply('busy', { holder: parseLockHolder(lockPath) }, statePath, null, undefined, lockWaitMs);
        Bun.sleepSync(Math.min(50, Math.max(1, lockWaitMs - (Date.now() - startMs))));
        continue;
      }
      return reply('unwritable', { errno: e.code ?? 'EIO', syscall: e.syscall ?? 'open', path: truncate80(lockPath) }, statePath, null);
    }
  }

  let tmpPath: string | null = null;
  let committed = false;
  try {
    // Stamp one coherent commit/tree after any lock wait, never two moving HEAD reads.
    const commonDirRes = runGit(cwd, ['rev-parse', '--git-common-dir'], gitEnv);
    const symRefRes = runGit(cwd, ['symbolic-ref', '--short', 'HEAD'], gitEnv);
    const revRefRes = symRefRes.ok ? symRefRes : runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], gitEnv);
    const headRes = runGit(cwd, ['rev-parse', 'HEAD'], gitEnv);
    const treeRes = headRes.ok ? runGit(cwd, ['rev-parse', `${headRes.stdout}^{tree}`], gitEnv) : headRes;
    if (!commonDirRes.ok || !revRefRes.ok || !headRes.ok || !treeRes.ok) return reply('not-in-worktree', { cwd: truncate80(cwd) }, statePath, null);
    const gitInfo: GitInfo = { toplevel: realTop, repo: realpathSync(resolve(cwd, commonDirRes.stdout)), branch: revRefRes.stdout, head: headRes.stdout, tree: treeRes.stdout };
    let storedState: ReviewRunState | null = null;
    let moveCorruptStateAside = false;
    try {
      const rawBytes = readFileSync(statePath!, 'utf8');
      let parsedState: unknown;
      let parseErr: Error | null = null;
      try {
        parsedState = JSON.parse(rawBytes);
      } catch (err) {
        parseErr = err as Error;
      }
      if (parseErr !== null) {
        if (command === 'start') {
          moveCorruptStateAside = true;
        } else {
          return reply('corrupt', { path: truncate80(statePath!), message: truncate80(parseErr.message) }, statePath, null);
        }
      } else {
        const validated = validateStoredState(parsedState, statePath!, helperVersion);
        if (!validated.ok) {
          if (validated.reason === 'corrupt' && command === 'start' && validated.canMoveAside) {
            moveCorruptStateAside = true;
          } else {
            const customFix = validated.reason === 'corrupt' && !validated.canMoveAside ? CORRUPT_ORDER_FIX : undefined;
            return reply(validated.reason, validated.detail, statePath, null, customFix);
          }
        } else {
          storedState = validated.state;
        }
      }
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== 'ENOENT') return reply('corrupt', { path: truncate80(statePath!), message: truncate80(e.message) }, statePath, null, CORRUPT_READ_FIX);
    }

    if (storedState !== null && storedState.host !== null && storedState.host !== localHost) {
      return reply('cross-host', { expected_host: truncate80(storedState.host), actual_host: truncate80(localHost) }, statePath, storedState.rev);
    }

    if (storedState !== null && (storedState.run.repo !== gitInfo.repo || storedState.run.branch !== gitInfo.branch)) {
      return reply('worktree-mismatch', { expected_repo: truncate80(storedState.run.repo), actual_repo: truncate80(gitInfo.repo), expected_branch: truncate80(storedState.run.branch), actual_branch: truncate80(gitInfo.branch) }, statePath, storedState.rev);
    }

    for (const [key, snap] of evidenceSnapshots) {
      try {
        const curReal = realpathSync(resolve(realDir, snap.relPath));
        const curSt = statSync(curReal);
        if (
          curReal !== snap.realPath ||
          !curSt.isFile() ||
          curSt.dev !== snap.dev ||
          curSt.ino !== snap.ino ||
          curSt.size !== snap.size ||
          curSt.mtimeMs !== snap.mtimeMs
        ) {
          evidenceErrors.set(key, 'evidence-changed');
        }
      } catch {
        evidenceErrors.set(key, 'evidence-changed');
      }
    }

    const outcome = applyCommand(storedState, command, rawInput, gitInfo, envChecker, new Date().toISOString(), helperVersion, localHost);
    if (outcome.reason !== 'recorded') return reply(outcome.reason, outcome.detail, statePath, outcome.rev, outcome.fix);

    const protectedFiles = new Set<string>();
    let sweepSafe = !moveCorruptStateAside;
    for (const [cmd, records] of [
      ['record gate', outcome.state.gates], ['record audit', outcome.state.audits],
      ['checkpoint', outcome.state.checkpoints], ['finish', outcome.state.finish ? [outcome.state.finish] : []],
    ] as const) {
      for (const record of records) for (const ev of collectEvidenceItems(cmd, record)) {
        try { const st = statSync(resolve(realDir, ev.path)); protectedFiles.add(`${st.dev}:${st.ino}`); }
        catch (err) { if (!['ENOENT', 'ENOTDIR'].includes((err as NodeJS.ErrnoException).code ?? '')) sweepSafe = false; }
      }
    }

    const warnings: string[] = reclaimedReason ? [`reclaimed stale lock (${reclaimedReason})`] : [];
    let dirNames: string[] | null = null;
    try {
      if (sweepSafe) dirNames = readdirSync(realDir);
      else warnings.push('skipped leftover temporary-file sweep: recorded evidence could not be resolved');
    } catch (err) {
      warnings.push(`failed to list leftover temporary files: ${(err as NodeJS.ErrnoException).code ?? 'error'}`);
    }
    if (dirNames !== null) {
      let removedCount = 0;
      const unlinkWarnings: string[] = [];
      for (const name of dirNames) {
        if (!TMP_FILE_RE.test(name)) continue;
        const candidateTmp = join(realDir, name);
        let st;
        try { st = lstatSync(candidateTmp); } catch { continue; }
        if (st.isSymbolicLink() || !st.isFile()) continue;
        if (protectedFiles.has(`${st.dev}:${st.ino}`)) continue;
        try {
          unlinkSync(candidateTmp);
          removedCount++;
        } catch (err) {
          unlinkWarnings.push(`failed to remove leftover temporary file: ${(err as NodeJS.ErrnoException).code ?? 'error'}`);
        }
      }
      if (removedCount > 0) warnings.push(`removed ${removedCount} leftover temporary file(s)`);
      warnings.push(...unlinkWarnings);
    }

    const serialized = Buffer.from(serializeState(outcome.state), 'utf8');
    tmpPath = join(realDir, `review-run-state.json.tmp-${process.pid}-${randomBytes(4).toString('hex')}`);
    let movedAsidePath: string | null = null;
    try {
      const fd = openSync(tmpPath, 'wx', 0o600);
      try { writeAll(fd, serialized); fsyncSync(fd); } finally { closeSync(fd); }
      const lockHeld = holdsOwnLock(lockPath, ownToken);
      if (lockHeld && moveCorruptStateAside) {
        // Claim the backup name exclusively while the original remains readable at statePath.
        movedAsidePath = linkCorruptBackup(statePath!);
      }
      if (!lockHeld || (movedAsidePath !== null && !holdsOwnLock(lockPath, ownToken))) {
        unlinkQuiet(tmpPath);
        tmpPath = null;
        if (movedAsidePath !== null) removeRedundantBackup(statePath!, movedAsidePath);
        return reply('busy', { holder: parseLockHolder(lockPath) }, statePath, storedState?.rev ?? null, undefined, lockWaitMs);
      }
      renameSync(tmpPath, statePath!);
      committed = true;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (tmpPath) unlinkQuiet(tmpPath);
      if (movedAsidePath !== null && removeRedundantBackup(statePath!, movedAsidePath)) movedAsidePath = null;
      return reply('unwritable', {
        errno: e.code ?? 'EIO', syscall: e.syscall ?? 'write', path: truncate80(e.path ?? tmpPath ?? statePath!),
        ...(movedAsidePath !== null ? { moved_aside: basename(movedAsidePath) } : {}),
      }, statePath, storedState?.rev ?? null);
    }

    try {
      const dirFd = openSync(realDir, 'r');
      try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
    } catch (err) {
      warnings.push(`failed to sync directory: ${(err as NodeJS.ErrnoException).code ?? 'error'}`);
    }

    if (holdsOwnLock(lockPath, ownToken)) {
      try { unlinkSync(lockPath); } catch (err) { warnings.push(`failed to remove lock: ${(err as NodeJS.ErrnoException).code ?? 'error'}`); }
    } else {
      warnings.push('lock no longer held by this writer');
    }
    const detail: Record<string, unknown> = {
      ...outcome.detail,
      ...(movedAsidePath !== null ? { moved_aside: basename(movedAsidePath) } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
    return reply('recorded', detail, statePath, outcome.state.rev);
  } finally {
    if (!committed) {
      if (tmpPath) unlinkQuiet(tmpPath);
      if (holdsOwnLock(lockPath, ownToken)) unlinkQuiet(lockPath);
    }
  }
}
