import { createHash } from 'node:crypto';
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
  readdirSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, sha256Hex } from './canon.ts';
import { GateError } from './errors.ts';
import type { Verdict } from './decide.ts';

export function stateRoot(env: NodeJS.ProcessEnv): string {
  const explicit = env.GSTACK_EXTEND_STATE_DIR;
  if (explicit !== undefined && explicit !== '') return explicit;
  return join(homedir(), '.gstack-extend');
}

export function mergeGateDir(env: NodeJS.ProcessEnv): string {
  return join(stateRoot(env), 'merge-gate');
}

export type VerdictLog = { verdicts: unknown[]; skipped_lines: number };

export function readVerdictLog(path: string): VerdictLog {
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { verdicts: [], skipped_lines: 0 };
    throw err;
  }
  const verdicts: unknown[] = [];
  let skipped = 0;
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  for (const line of lines) {
    if (line === '') { skipped++; continue; }
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) skipped++;
      else verdicts.push(parsed);
    } catch {
      skipped++;
    }
  }
  return { verdicts, skipped_lines: skipped };
}

export function evidencePath(env: NodeJS.ProcessEnv, id: string): string {
  return join(mergeGateDir(env), 'evidence', `${id}.json`);
}

export function decisionKey(origin: string, prNumber: number, decisionId: string): string {
  return createHash('sha256').update(`${origin}\0${String(prNumber)}\0${decisionId}`).digest('hex');
}

export function decisionPath(env: NodeJS.ProcessEnv, key: string): string {
  return join(mergeGateDir(env), 'decisions', `${key}.json`);
}

function assertStorePath(path: string, kind: 'dir' | 'file'): void {
  let st;
  try {
    st = lstatSync(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    throw new GateError('store_error', 'could not stat the store', storeFix());
  }
  if (st.isSymbolicLink()) {
    throw new GateError('store_refused', `${path} is a symlink`, 'point GSTACK_EXTEND_STATE_DIR at a local directory that is not a symlink');
  }
  if (kind === 'dir' && st.isDirectory() && (st.mode & 0o777) !== 0o700) {
    throw new GateError('store_refused', `${path} is not mode 0700`, 'chmod 0700 the merge-gate store directories, or use a fresh GSTACK_EXTEND_STATE_DIR');
  }
  if (kind === 'file' && st.isSymbolicLink()) {
    throw new GateError('store_refused', `${path} is a symlink`, 'remove the symlink and retry');
  }
}

function storeFix(): string {
  return 'pass --no-record, or set GSTACK_EXTEND_STATE_DIR to a writable local directory';
}

export function ensureStore(env: NodeJS.ProcessEnv): { root: string; evidence: string; decisions: string; log: string } {
  const root = mergeGateDir(env);
  const parent = stateRoot(env);
  mkdirSync(parent, { recursive: true });
  for (const dir of [root, join(root, 'evidence'), join(root, 'decisions')]) {
    assertStorePath(dir, 'dir');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      const fd = openSync(dir, 'r');
      try { /* chmod via mkdir mode; fsync below */ } finally {
        closeSync(fd);
      }
    } catch {
      // directory exists
    }
    chmodDir(dir);
    assertStorePath(dir, 'dir');
  }
  const log = join(root, 'verdicts.jsonl');
  assertStorePath(log, 'file');
  return { root, evidence: join(root, 'evidence'), decisions: join(root, 'decisions'), log };
}

function chmodDir(dir: string): void {
  chmodSync(dir, 0o700);
}

export function writeEvidence(env: NodeJS.ProcessEnv, bytes: Buffer, id: string): string {
  const { evidence } = ensureStore(env);
  const dest = join(evidence, `${id}.json`);
  assertStorePath(dest, 'file');
  try {
    const existing = readFileSync(dest);
    if (existing.equals(bytes)) return dest;
    throw new GateError('evidence_corrupt', `evidence ${id} already exists with different bytes`, 'do not rewrite an evidence file; collect a new observation');
  } catch (err) {
    if (err instanceof GateError) throw err;
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw new GateError('store_error', 'could not read the evidence directory', storeFix());
    }
  }
  const tmp = join(evidence, `.tmp-${process.pid}-${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}`);
  const fd = openSync(tmp, 'w', 0o600);
  try {
    writeSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(tmp, 0o600);
  try {
    linkSync(tmp, dest);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      const existing = readFileSync(dest);
      unlinkQuiet(tmp);
      if (existing.equals(bytes)) return dest;
      throw new GateError('evidence_corrupt', `evidence ${id} already exists with different bytes`, 'do not rewrite an evidence file; collect a new observation');
    }
    unlinkQuiet(tmp);
    throw new GateError('store_error', 'could not link the evidence file', storeFix());
  }
  unlinkQuiet(tmp);
  fsyncDir(evidence);
  chmodSync(dest, 0o600);
  return dest;
}

export function appendVerdict(env: NodeJS.ProcessEnv, verdict: Verdict): void {
  const { log } = ensureStore(env);
  const line = canonicalJson(stripStdoutOnly(verdict)) + '\n';
  let flags = 'a';
  try {
    lstatSync(log);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw new GateError('store_error', 'could not stat verdicts.jsonl', storeFix());
    flags = 'ax';
  }
  const fd = openSync(log, flags, 0o600);
  try {
    const st = fstatSync(fd);
    if (st.size > 0) {
      // Repair a torn trailing line before the single verdict write.
      const prior = readFileSync(log);
      if (prior.length > 0 && prior[prior.length - 1] !== 0x0a) {
        writeSync(fd, '\n');
      }
    }
    writeSync(fd, line);
    fsyncSync(fd);
  } catch (err) {
    if (err instanceof GateError) throw err;
    throw new GateError('store_error', 'could not append the verdict', storeFix());
  } finally {
    closeSync(fd);
  }
  chmodSync(log, 0o600);
}

function stripStdoutOnly(verdict: Verdict): Verdict {
  const copy = { ...verdict } as Verdict & { evidence_path?: unknown; idempotent?: unknown };
  delete copy.evidence_path;
  delete copy.idempotent;
  return copy;
}

export function writeDecision(env: NodeJS.ProcessEnv, key: string, verdict: Verdict): 'created' | 'exists' {
  const { decisions } = ensureStore(env);
  const dest = join(decisions, `${key}.json`);
  assertStorePath(dest, 'file');
  const bytes = Buffer.from(canonicalJson(stripStdoutOnly(verdict)));
  try {
    lstatSync(dest);
    return 'exists';
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw new GateError('store_error', 'could not stat the decision file', storeFix());
  }
  const tmp = join(decisions, `.tmp-${process.pid}-${key.slice(0, 8)}`);
  const fd = openSync(tmp, 'w', 0o600);
  try {
    writeSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    linkSync(tmp, dest);
  } catch (err) {
    unlinkQuiet(tmp);
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') return 'exists';
    throw new GateError('store_error', 'could not link the decision file', storeFix());
  }
  unlinkQuiet(tmp);
  fsyncDir(decisions);
  chmodSync(dest, 0o600);
  return 'created';
}

export function readDecision(env: NodeJS.ProcessEnv, key: string): Verdict | null {
  try {
    const text = readFileSync(decisionPath(env, key), 'utf8');
    return JSON.parse(text) as Verdict;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    throw new GateError('store_error', 'could not read the decision file', storeFix());
  }
}

export function listEvidence(env: NodeJS.ProcessEnv): string[] {
  const dir = join(mergeGateDir(env), 'evidence');
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return [];
    throw new GateError('store_error', 'could not read the evidence directory', storeFix());
  }
  return names.filter(n => /^[0-9a-f]{64}\.json$/.test(n)).map(n => join(dir, n));
}

export function readEvidenceFile(path: string): { id: string; bytes: Buffer; value: unknown } {
  let bytes: Buffer;
  try {
    const st = lstatSync(path);
    if (st.isSymbolicLink()) {
      throw new GateError('store_refused', `${path} is a symlink`, 'pass an evidence file that is not a symlink');
    }
    bytes = readFileSync(path);
  } catch (err) {
    if (err instanceof GateError) throw err;
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new GateError('evidence_not_found', `no evidence file at ${path}`, 'pass an evidence id from verdicts.jsonl, or a path to an evidence JSON file');
    }
    throw new GateError('store_error', 'could not read evidence', storeFix());
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

function unlinkQuiet(path: string): void {
  try { unlinkSync(path); } catch { /* leftover temp is harmless */ }
}

function fsyncDir(dir: string): void {
  const fd = openSync(dir, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
