import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { hostname } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { applyCommand, collectEvidenceItems, isVersion, REASONS, serializeState, truncate80, validateStoredState, type CommandName, type EnvChecker, type GitInfo, type ReasonCode, type RetryHint, type ReviewRunState, type SideEffects, type StatusCode } from './state.ts';

export const DEFAULT_VERSION_PATH = resolve(import.meta.dir, '..', '..', 'VERSION');

export function readHelperVersion(env: NodeJS.ProcessEnv = process.env, versionPath?: string): string | null {
  const target = versionPath ?? env.GSTACK_EXTEND_REVIEW_STATE_VERSION_PATH ?? DEFAULT_VERSION_PATH;
  try {
    const st = lstatSync(target);
    if (st.isSymbolicLink() || !st.isFile() || st.size > 128) return null;
    const raw = readFileSync(target, 'utf8').trim();
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
  exitCode: 0 | 1 | 2 | 3 | 4;
};

export function cleanGitEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('GIT_')));
  out.GIT_CONFIG_GLOBAL = '/dev/null';
  out.GIT_CONFIG_NOSYSTEM = '1';
  return out;
}

function runGit(cwd: string, args: string[], env: NodeJS.ProcessEnv): { ok: boolean; stdout: string } {
  const r = spawnSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8', stdio: 'pipe', timeout: 5000 });
  return { ok: r.status === 0, stdout: (r.stdout ?? '').replace(/\r?\n$/, '') };
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

function writeAll(fd: number, buf: Buffer): void {
  let off = 0;
  while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off);
}

const unlinkQuiet = (p: string) => { try { unlinkSync(p); } catch { /* ignore */ } };

function parseLockHolder(lockPath: string): { pid: number | null; host: string | null; started_at: string | null; unknown: boolean } {
  try {
    const raw = JSON.parse(readFileSync(lockPath, 'utf8'));
    if (typeof raw === 'object' && raw !== null && typeof raw.pid === 'number' && Number.isInteger(raw.pid) && typeof raw.host === 'string' && raw.host.length > 0 && typeof raw.started_at === 'string' && raw.started_at.length > 0) {
      return { pid: raw.pid, host: truncate80(raw.host), started_at: truncate80(raw.started_at), unknown: false };
    }
  } catch { /* empty or unparseable */ }
  return { pid: null, host: null, started_at: null, unknown: true };
}

export function executeCommand(command: CommandName, dirArg: string, inputArg: string, cwd: string, env: NodeJS.ProcessEnv = process.env): StoreResult {
  const helperVersion = readHelperVersion(env);
  const reply = (reason: ReasonCode, detail: Record<string, unknown>, sPath: string | null, rev: number | null, customFix?: string, retryAfterMs: number | null = null) =>
    makeEnvelope(command, reason, detail, sPath, rev, customFix, helperVersion, retryAfterMs);

  if (isAbsolute(dirArg)) dirArg = dirArg.replace(/\/+$/, '') || '/'; // lstat must inspect the final component itself.
  let statePath = isAbsolute(dirArg) ? join(dirArg, 'review-run-state.json') : null;
  const waitRaw = env.GSTACK_EXTEND_REVIEW_STATE_LOCK_WAIT_MS ?? '5000';
  if (!/^\d+$/.test(waitRaw) || Number(waitRaw) < 0 || Number(waitRaw) > 60000) {
    return reply('usage', { message: truncate80(`invalid GSTACK_EXTEND_REVIEW_STATE_LOCK_WAIT_MS "${waitRaw}"; expected integer in 0..60000`) }, statePath, null);
  }
  const lockWaitMs = Number(waitRaw);

  const gitEnv = cleanGitEnv(env);
  const topRes = runGit(cwd, ['rev-parse', '--show-toplevel'], gitEnv);
  if (!topRes.ok || !topRes.stdout) return reply('not-in-worktree', { cwd: truncate80(cwd) }, statePath, null);
  const realTop = realpathSync(topRes.stdout);

  if (!isAbsolute(dirArg)) {
    return reply('bad-dir', { condition: 'relative', resolved_path: truncate80(resolve(cwd, dirArg)), toplevel: truncate80(realTop) }, null, null, 'Pass an absolute --dir path outside the Git work tree, or continue inline (D1).');
  }

  let dirStat;
  try {
    dirStat = lstatSync(dirArg);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') {
      return reply('bad-dir', { condition: 'missing', resolved_path: truncate80(dirArg), toplevel: truncate80(realTop) }, statePath, null, 'Create the directory supplied in --dir with mkdir -p outside the work tree, or continue inline (D1).');
    }
    return reply('unwritable', { errno: e.code ?? 'EIO', syscall: e.syscall ?? 'lstat', path: truncate80(dirArg) }, statePath, null);
  }
  if (dirStat.isSymbolicLink()) return reply('bad-dir', { condition: 'symlink', resolved_path: truncate80(dirArg), toplevel: truncate80(realTop) }, statePath, null, 'Pass a real directory path for --dir (final component must not be a symlink), or continue inline (D1).');
  if (!dirStat.isDirectory()) return reply('bad-dir', { condition: 'not-directory', resolved_path: truncate80(dirArg), toplevel: truncate80(realTop) }, statePath, null, 'Pass an existing directory path for --dir, or continue inline (D1).');

  const realDir = realpathSync(dirArg);
  statePath = join(realDir, 'review-run-state.json');
  if (realDir === realTop || realDir.startsWith(`${realTop}/`)) {
    return reply('bad-dir', { condition: 'in-worktree', resolved_path: truncate80(realDir), toplevel: truncate80(realTop) }, statePath, null, 'Place --dir outside the Git work tree, or continue inline (D1).');
  }

  if (!isAbsolute(inputArg)) return reply('usage', { message: '--input must be an absolute path inside --dir' }, statePath, null);
  let inStat;
  try { inStat = lstatSync(inputArg); } catch { return reply('usage', { message: '--input file does not exist' }, statePath, null); }
  if (inStat.isSymbolicLink() || !inStat.isFile()) return reply('usage', { message: '--input must be a regular file, not a symlink or directory' }, statePath, null);
  if (inStat.size > 1048576) return reply('usage', { message: '--input file exceeds 1 MiB limit (1048576 bytes)' }, statePath, null);
  let realInput: string;
  try { realInput = realpathSync(inputArg); } catch { return reply('usage', { message: '--input path could not be resolved' }, statePath, null); }
  if (!realInput.startsWith(`${realDir}/`)) return reply('usage', { message: '--input file must reside inside --dir' }, statePath, null);

  let rawInput: unknown;
  try { rawInput = JSON.parse(readFileSync(realInput, 'utf8')); } catch { return reply('invalid-input', { violations: [{ path: '$', rule: 'invalid-json', expected: 'valid-json-object' }] }, statePath, null); }

  const evidenceErrors = new Map<string, string>();
  for (const item of collectEvidenceItems(command, rawInput)) {
    const key = `${item.path}:${item.sha256}`;
    const candidatePath = resolve(realDir, item.path);
    if (!candidatePath.startsWith(`${realDir}/`)) { evidenceErrors.set(key, 'evidence-outside-dir'); continue; }
    try {
      const lst = lstatSync(candidatePath);
      const realEv = realpathSync(candidatePath);
      if (!realEv.startsWith(`${realDir}/`)) { evidenceErrors.set(key, 'evidence-outside-dir'); continue; }
      if (!(lst.isSymbolicLink() ? statSync(realEv) : lst).isFile()) { evidenceErrors.set(key, 'evidence-not-regular-file'); continue; }
      if (createHash('sha256').update(readFileSync(realEv)).digest('hex') !== item.sha256) evidenceErrors.set(key, 'evidence-digest-mismatch');
    } catch { evidenceErrors.set(key, 'evidence-missing'); }
  }

  const envChecker: EnvChecker = {
    commitExists: (sha) => runGit(cwd, ['cat-file', '-e', `${sha}^{commit}`], gitEnv).ok,
    commitTree: (sha) => runGit(cwd, ['cat-file', '-e', `${sha}^{commit}`], gitEnv).ok ? (runGit(cwd, ['rev-parse', `${sha}^{tree}`], gitEnv).stdout || null) : null,
    isAncestor: (anc, desc) => runGit(cwd, ['merge-base', '--is-ancestor', anc, desc], gitEnv).ok,
    checkEvidence: (p, sha256) => evidenceErrors.get(`${p}:${sha256}`) ?? null,
  };

  const lockPath = join(realDir, 'review-run-state.json.lock');
  const startMs = Date.now();
  while (true) {
    let created = false;
    try {
      const fd = openSync(lockPath, 'wx', 0o600);
      created = true;
      try { writeAll(fd, Buffer.from(`${JSON.stringify({ pid: process.pid, host: hostname(), started_at: new Date().toISOString() })}\n`, 'utf8')); fsyncSync(fd); } finally { closeSync(fd); }
      break;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (created) unlinkQuiet(lockPath);
      if (!created && e.code === 'EEXIST') {
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
    try {
      const rawBytes = readFileSync(statePath!, 'utf8');
      let parsedState: unknown;
      try { parsedState = JSON.parse(rawBytes); } catch (err) { return reply('corrupt', { path: truncate80(statePath!), message: truncate80((err as Error).message) }, statePath, null); }
      const validated = validateStoredState(parsedState, statePath!, helperVersion);
      if (!validated.ok) return reply(validated.reason, validated.detail, statePath, null);
      storedState = validated.state;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== 'ENOENT') return reply('corrupt', { path: truncate80(statePath!), message: truncate80(e.message) }, statePath, null);
    }

    if (storedState !== null && (storedState.run.repo !== gitInfo.repo || storedState.run.branch !== gitInfo.branch)) {
      return reply('worktree-mismatch', { expected_repo: truncate80(storedState.run.repo), actual_repo: truncate80(gitInfo.repo), expected_branch: truncate80(storedState.run.branch), actual_branch: truncate80(gitInfo.branch) }, statePath, storedState.rev);
    }

    const outcome = applyCommand(storedState, command, rawInput, gitInfo, envChecker, new Date().toISOString(), helperVersion);
    if (outcome.reason !== 'recorded') return reply(outcome.reason, outcome.detail, statePath, outcome.rev, outcome.fix);

    const serialized = Buffer.from(serializeState(outcome.state), 'utf8');
    tmpPath = join(realDir, `review-run-state.json.tmp-${process.pid}-${randomBytes(4).toString('hex')}`);
    try {
      const fd = openSync(tmpPath, 'wx', 0o600);
      try { writeAll(fd, serialized); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(tmpPath, statePath!);
      committed = true;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (tmpPath) unlinkQuiet(tmpPath);
      return reply('unwritable', { errno: e.code ?? 'EIO', syscall: e.syscall ?? 'write', path: truncate80(tmpPath) }, statePath, storedState?.rev ?? null);
    }

    const detail = { ...outcome.detail };
    try { unlinkSync(lockPath); } catch (err) { detail.warnings = [`failed to remove lock: ${(err as NodeJS.ErrnoException).code ?? 'error'}`]; }
    return reply('recorded', detail, statePath, outcome.state.rev);
  } finally {
    if (!committed) { if (tmpPath) unlinkQuiet(tmpPath); unlinkQuiet(lockPath); }
  }
}
