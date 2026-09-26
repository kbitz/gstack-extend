import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, sha256Hex } from './canon.ts';
import { GateError } from './errors.ts';
import { VERDICT_V } from './registry.ts';
import type { Verdict } from './decide.ts';

export type StorePaths = { root: string; evidence: string; decisions: string; log: string };

const STORE_FIX = 'pass --no-record, or set GSTACK_EXTEND_STATE_DIR to a writable local directory';
const DECISION_KEY_VERSION = 'merge-gate-decision/1';

export function stateRoot(env: NodeJS.ProcessEnv): string {
  const explicit = env.GSTACK_EXTEND_STATE_DIR;
  if (explicit !== undefined && explicit !== '') return explicit;
  return join(homedir(), '.gstack-extend');
}

export function mergeGateDir(env: NodeJS.ProcessEnv): string {
  return join(stateRoot(env), 'merge-gate');
}

function storePaths(env: NodeJS.ProcessEnv): StorePaths {
  const root = mergeGateDir(env);
  return { root, evidence: join(root, 'evidence'), decisions: join(root, 'decisions'), log: join(root, 'verdicts.jsonl') };
}

export function evidencePath(env: NodeJS.ProcessEnv, id: string): string {
  return join(storePaths(env).evidence, `${id}.json`);
}

/**
 * The key hashes the lowercased `owner/name`, not a remote URL, so the https,
 * ssh, and PR-URL spellings of one repository share decisions.
 */
export function decisionKey(repo: { owner: string; name: string }, prNumber: number, decisionId: string): string {
  const id = `${repo.owner}/${repo.name}`.toLowerCase();
  return sha256Hex(`${DECISION_KEY_VERSION}\0${id}\0${String(prNumber)}\0${decisionId}`);
}

/** Run a filesystem step; any non-gate error becomes `store_error` naming the step. */
function fsStep<T>(what: string, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof GateError) throw err;
    const code = (err as NodeJS.ErrnoException).code ?? 'error';
    throw new GateError('store_error', `could not ${what} (${code})`, STORE_FIX);
  }
}

/** Refuse symlinks, other owners, and directories that are not 0700. A missing path passes. */
function assertStorePath(path: string, kind: 'dir' | 'file'): void {
  let st;
  try {
    st = lstatSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw new GateError('store_error', `could not stat ${path}`, STORE_FIX);
  }
  if (st.isSymbolicLink()) {
    throw new GateError('store_refused', `${path} is a symlink`, 'point GSTACK_EXTEND_STATE_DIR at a local directory that is not a symlink');
  }
  const uid = process.getuid?.();
  if (uid !== undefined && st.uid !== uid) {
    throw new GateError('store_refused', `${path} is owned by another user`, 'use a GSTACK_EXTEND_STATE_DIR that you own');
  }
  if (kind === 'dir' && (!st.isDirectory() || (st.mode & 0o777) !== 0o700)) {
    throw new GateError('store_refused', `${path} is not a mode 0700 directory`, 'chmod 0700 the merge-gate store directories, or use a fresh GSTACK_EXTEND_STATE_DIR');
  }
}

/** Check an existing store before reading it; nothing is created. */
export function checkStore(env: NodeJS.ProcessEnv): StorePaths {
  const paths = storePaths(env);
  for (const dir of [paths.root, paths.evidence, paths.decisions]) assertStorePath(dir, 'dir');
  assertStorePath(paths.log, 'file');
  return paths;
}

export function ensureStore(env: NodeJS.ProcessEnv): StorePaths {
  const paths = storePaths(env);
  fsStep('create the state directory', () => mkdirSync(stateRoot(env), { recursive: true }));
  for (const dir of [paths.root, paths.evidence, paths.decisions]) {
    assertStorePath(dir, 'dir');
    fsStep('create the store directory', () => {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      chmodSync(dir, 0o700);
    });
    assertStorePath(dir, 'dir');
  }
  assertStorePath(paths.log, 'file');
  return paths;
}

function writeAll(fd: number, bytes: Buffer): void {
  let off = 0;
  while (off < bytes.length) off += writeSync(fd, bytes, off, bytes.length - off);
}

function unlinkQuiet(path: string): void {
  try { unlinkSync(path); } catch { /* a leftover temp file is harmless */ }
}

function fsyncDir(dir: string): void {
  const fd = openSync(dir, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

/**
 * Write `bytes` to `dir/name` at most once: a temp file, fsync, then `link()`,
 * which fails with EEXIST instead of replacing an existing file.
 */
function publishOnce(dir: string, name: string, bytes: Buffer): 'created' | 'same' | 'different' {
  const dest = join(dir, name);
  assertStorePath(dest, 'file');
  const tmp = join(dir, `.tmp-${process.pid}-${randomBytes(6).toString('hex')}`);
  return fsStep(`write ${name}`, () => {
    const fd = openSync(tmp, 'wx', 0o600);
    try {
      writeAll(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      linkSync(tmp, dest);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      assertStorePath(dest, 'file');
      return readFileSync(dest).equals(bytes) ? 'same' : 'different';
    } finally {
      unlinkQuiet(tmp);
    }
    fsyncDir(dir);
    return 'created';
  });
}

export function writeEvidence(env: NodeJS.ProcessEnv, bytes: Buffer, id: string): string {
  const { evidence } = ensureStore(env);
  if (publishOnce(evidence, `${id}.json`, bytes) === 'different') {
    throw new GateError('evidence_corrupt', `evidence ${id} already exists with different bytes`, 'do not rewrite an evidence file; collect a new observation');
  }
  return join(evidence, `${id}.json`);
}

/** Append one verdict line (ENG-2): repair a torn tail and write the line in one `write()`, then fsync. */
export function appendVerdict(env: NodeJS.ProcessEnv, verdict: Verdict): void {
  const { log } = ensureStore(env);
  const line = Buffer.from(canonicalJson(stripStdoutOnly(verdict)) + '\n');
  fsStep('append to verdicts.jsonl', () => {
    const fd = openSync(log, 'a+', 0o600);
    try {
      const size = fstatSync(fd).size;
      const last = Buffer.alloc(1);
      const torn = size > 0 && readSync(fd, last, 0, 1, size - 1) === 1 && last[0] !== 0x0a;
      writeAll(fd, torn ? Buffer.concat([Buffer.from('\n'), line]) : line);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  });
}

function stripStdoutOnly(verdict: Verdict): Verdict {
  const copy = { ...verdict } as Verdict & { evidence_path?: unknown; idempotent?: unknown };
  delete copy.evidence_path;
  delete copy.idempotent;
  return copy;
}

/** ENG-4: the first decision file for a key is authoritative. */
export function publishDecision(env: NodeJS.ProcessEnv, key: string, verdict: Verdict): 'created' | 'exists' {
  const { decisions } = ensureStore(env);
  const bytes = Buffer.from(canonicalJson(stripStdoutOnly(verdict)));
  return publishOnce(decisions, `${key}.json`, bytes) === 'created' ? 'created' : 'exists';
}

/**
 * Append a decision's verdict line exactly once. Whoever creates the
 * `<key>.logged` marker appends; the marker is removed if the append fails, so
 * a later retry repairs the log instead of returning an unlogged decision.
 */
export function ensureLogged(env: NodeJS.ProcessEnv, key: string, verdict: Verdict): void {
  const { decisions } = ensureStore(env);
  const marker = join(decisions, `${key}.logged`);
  assertStorePath(marker, 'file');
  const claimed = fsStep('claim the decision log marker', () => {
    try {
      closeSync(openSync(marker, 'wx', 0o600));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw err;
    }
  });
  if (!claimed) return;
  try {
    appendVerdict(env, verdict);
  } catch (err) {
    unlinkQuiet(marker);
    throw err;
  }
}

export function readDecision(env: NodeJS.ProcessEnv, key: string): Verdict | null {
  const { decisions } = checkStore(env);
  const path = join(decisions, `${key}.json`);
  assertStorePath(path, 'file');
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new GateError('store_error', `could not read decision ${key}`, STORE_FIX);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = null;
  }
  const v = value as { v?: unknown; evidence_id?: unknown } | null;
  if (v === null || typeof v !== 'object' || v.v !== VERDICT_V || typeof v.evidence_id !== 'string' || !/^[0-9a-f]{64}$/.test(v.evidence_id)) {
    throw new GateError('store_error', `decision ${key} is not a v${VERDICT_V} verdict`, `remove ${path} to record a new decision`);
  }
  return value as Verdict;
}

export function listEvidence(env: NodeJS.ProcessEnv): string[] {
  const { evidence } = checkStore(env);
  let names: string[];
  try {
    names = readdirSync(evidence);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new GateError('store_error', 'could not read the evidence directory', STORE_FIX);
  }
  return names.filter(n => /^[0-9a-f]{64}\.json$/.test(n)).sort().map(n => join(evidence, n));
}

export function readEvidenceFile(path: string): { id: string; bytes: Buffer; value: unknown } {
  let bytes: Buffer;
  try {
    if (lstatSync(path).isSymbolicLink()) {
      throw new GateError('store_refused', `${path} is a symlink`, 'pass an evidence file that is not a symlink');
    }
    bytes = readFileSync(path);
  } catch (err) {
    if (err instanceof GateError) throw err;
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new GateError('evidence_not_found', `no evidence file at ${path}`, 'pass an evidence id from verdicts.jsonl, or a path to an evidence JSON file');
    }
    throw new GateError('store_error', `could not read evidence at ${path}`, STORE_FIX);
  }
  const id = sha256Hex(bytes);
  const stem = path.split('/').pop()?.replace(/\.json$/, '') ?? '';
  if (/^[0-9a-f]{64}$/.test(stem) && stem !== id) {
    throw new GateError('evidence_corrupt', 'evidence filename does not match its sha256', 'restore the original evidence file');
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new GateError('evidence_corrupt', 'evidence file is not JSON', 'restore the original evidence file');
  }
  return { id, bytes, value };
}

export type VerdictLog = { verdicts: unknown[]; skipped_lines: number };

/** ENG-2 reader: malformed lines are skipped and counted. */
export function readVerdictLog(path: string): VerdictLog {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { verdicts: [], skipped_lines: 0 };
    throw new GateError('store_error', 'could not read verdicts.jsonl', STORE_FIX);
  }
  const verdicts: unknown[] = [];
  let skipped = 0;
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) verdicts.push(parsed);
      else skipped++;
    } catch {
      skipped++;
    }
  }
  return { verdicts, skipped_lines: skipped };
}
