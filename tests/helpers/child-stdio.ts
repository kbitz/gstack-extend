// Bun uses AF_UNIX socketpairs for spawn pipes on Linux. A child Bun process's
// process.stdout.write then issues sendto(2), which Codex's seccomp filter refuses
// with EPERM (Track 71E; see the comment at tests/layout-scaffold.test.ts:50-53).
// Tests that spawn a Bun process go through this helper.

import {
  spawnSync as nodeSpawnSync,
  type SpawnSyncOptions,
  type SpawnSyncOptionsWithBufferEncoding,
  type SpawnSyncOptionsWithStringEncoding,
  type SpawnSyncReturns,
  type StdioNull,
  type StdioPipe,
} from 'node:child_process';
import {
  chmodSync,
  closeSync,
  constants,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Stream } from 'node:stream';

type StdioSlot = StdioNull | StdioPipe | number | Stream | null | undefined;

function isPipeSlot(slot: StdioSlot): boolean {
  return slot === undefined || slot === null || slot === 'pipe';
}

export function spawnSync(command: string): SpawnSyncReturns<Buffer>;
export function spawnSync(
  command: string,
  options: SpawnSyncOptionsWithStringEncoding,
): SpawnSyncReturns<string>;
export function spawnSync(
  command: string,
  options: SpawnSyncOptionsWithBufferEncoding,
): SpawnSyncReturns<Buffer>;
export function spawnSync(
  command: string,
  options?: SpawnSyncOptions,
): SpawnSyncReturns<string | Buffer>;
export function spawnSync(
  command: string,
  args: readonly string[],
  options: SpawnSyncOptionsWithStringEncoding,
): SpawnSyncReturns<string>;
export function spawnSync(
  command: string,
  args: readonly string[],
  options: SpawnSyncOptionsWithBufferEncoding,
): SpawnSyncReturns<Buffer>;
export function spawnSync(
  command: string,
  args?: readonly string[],
  options?: SpawnSyncOptions,
): SpawnSyncReturns<string | Buffer>;
export function spawnSync(
  command: string,
  argsOrOptions?: readonly string[] | SpawnSyncOptions,
  maybeOptions?: SpawnSyncOptions,
): SpawnSyncReturns<string | Buffer> {
  const args: readonly string[] = Array.isArray(argsOrOptions) ? argsOrOptions : [];
  const options: SpawnSyncOptions = Array.isArray(argsOrOptions)
    ? (maybeOptions ?? {})
    : ((argsOrOptions as SpawnSyncOptions | undefined) ?? {});

  if (options.maxBuffer !== undefined) {
    throw new Error('child-stdio spawnSync does not support maxBuffer with file-backed stdio');
  }

  if (options.stdio === 'inherit' || options.stdio === 'ignore') {
    return nodeSpawnSync(command, args, options);
  }

  let stdinSlot: StdioSlot = 'pipe';
  let stdoutSlot: StdioSlot = 'pipe';
  let stderrSlot: StdioSlot = 'pipe';
  let extraSlots: StdioSlot[] = [];

  if (Array.isArray(options.stdio)) {
    stdinSlot = options.stdio[0] ?? 'pipe';
    stdoutSlot = options.stdio[1];
    stderrSlot = options.stdio[2];
    extraSlots = options.stdio.slice(3);
  } else if (options.stdio !== undefined && options.stdio !== 'pipe') {
    return nodeSpawnSync(command, args, options);
  }

  const useOutFile = isPipeSlot(stdoutSlot);
  const useErrFile = isPipeSlot(stderrSlot);

  if (!useOutFile && !useErrFile) {
    return nodeSpawnSync(command, args, options);
  }

  const ioDir = mkdtempSync(join(tmpdir(), 'child-stdio-'));
  chmodSync(ioDir, 0o700);
  const outPath = join(ioDir, 'stdout');
  const errPath = join(ioDir, 'stderr');
  let outFd: number | null = null;
  let errFd: number | null = null;

  try {
    if (useOutFile) {
      outFd = openSync(outPath, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC, 0o600);
    }
    if (useErrFile) {
      errFd = openSync(errPath, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC, 0o600);
    }

    const stdio = [
      stdinSlot,
      useOutFile ? outFd! : stdoutSlot,
      useErrFile ? errFd! : stderrSlot,
      ...extraSlots,
    ];

    const result = nodeSpawnSync(command, args, { ...options, stdio: stdio as SpawnSyncOptions['stdio'] });

    // No child started, so preserve the native absent-output shape as well as
    // its error. The pre-created capture files are not child output.
    if (result.error && !result.pid) return result;

    if (outFd !== null) {
      try { closeSync(outFd); } catch {}
      outFd = null;
    }
    if (errFd !== null) {
      try { closeSync(errFd); } catch {}
      errFd = null;
    }

    const enc =
      typeof options.encoding === 'string' && options.encoding !== 'buffer'
        ? (options.encoding as BufferEncoding)
        : null;

    const stdout = useOutFile
      ? (enc ? readFileSync(outPath, enc) : readFileSync(outPath))
      : result.stdout;
    const stderr = useErrFile
      ? (enc ? readFileSync(errPath, enc) : readFileSync(errPath))
      : result.stderr;

    return {
      pid: result.pid,
      output: [null, stdout, stderr],
      stdout,
      stderr,
      status: result.status,
      signal: result.signal,
      error: result.error,
    } as SpawnSyncReturns<string | Buffer>;
  } finally {
    if (outFd !== null) {
      try { closeSync(outFd); } catch {}
    }
    if (errFd !== null) {
      try { closeSync(errFd); } catch {}
    }
    rmSync(ioDir, { recursive: true, force: true });
  }
}

export interface ChildStdioFiles {
  stdoutFd: number;
  stderrFd: number;
  read(): { stdout: string; stderr: string };
  dispose(): void;
}

export function openChildStdio(): ChildStdioFiles {
  const ioDir = mkdtempSync(join(tmpdir(), 'child-stdio-'));
  chmodSync(ioDir, 0o700);
  const outPath = join(ioDir, 'stdout');
  const errPath = join(ioDir, 'stderr');
  let stdoutFd: number | null = null;
  let stderrFd: number | null = null;
  try {
    stdoutFd = openSync(outPath, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC, 0o600);
    stderrFd = openSync(errPath, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC, 0o600);
  } catch (err) {
    if (stdoutFd !== null) {
      try { closeSync(stdoutFd); } catch {}
    }
    if (stderrFd !== null) {
      try { closeSync(stderrFd); } catch {}
    }
    rmSync(ioDir, { recursive: true, force: true });
    throw err;
  }

  let disposed = false;
  return {
    stdoutFd,
    stderrFd,
    read(): { stdout: string; stderr: string } {
      return {
        stdout: readFileSync(outPath, 'utf8'),
        stderr: readFileSync(errPath, 'utf8'),
      };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (stdoutFd !== null) {
        try { closeSync(stdoutFd); } catch {}
        stdoutFd = null;
      }
      if (stderrFd !== null) {
        try { closeSync(stderrFd); } catch {}
        stderrFd = null;
      }
      rmSync(ioDir, { recursive: true, force: true });
    },
  };
}

export interface FifoStdin {
  readFd: number;
  write(data: string | Uint8Array): void;
  end(): void;
  dispose(): void;
}

export function openFifoStdin(): FifoStdin {
  const ioDir = mkdtempSync(join(tmpdir(), 'child-fifo-'));
  chmodSync(ioDir, 0o700);
  const fifoPath = join(ioDir, 'stdin.fifo');
  let nonblockReadFd: number | null = null;
  let readFd: number | null = null;
  let writeFd: number | null = null;

  try {
    const mk = nodeSpawnSync('mkfifo', ['-m', '0600', fifoPath], { stdio: 'ignore' });
    if (mk.status !== 0) {
      throw mk.error ?? new Error(`mkfifo failed with status ${String(mk.status)}`);
    }
    nonblockReadFd = openSync(fifoPath, constants.O_RDONLY | constants.O_NONBLOCK);
    writeFd = openSync(fifoPath, constants.O_WRONLY);
    readFd = openSync(fifoPath, constants.O_RDONLY);
    closeSync(nonblockReadFd);
    nonblockReadFd = null;
  } catch (err) {
    if (nonblockReadFd !== null) {
      try { closeSync(nonblockReadFd); } catch {}
    }
    if (readFd !== null) {
      try { closeSync(readFd); } catch {}
    }
    if (writeFd !== null) {
      try { closeSync(writeFd); } catch {}
    }
    rmSync(ioDir, { recursive: true, force: true });
    throw err;
  }

  let ended = false;
  let disposed = false;

  return {
    readFd,
    write(data: string | Uint8Array): void {
      if (ended || disposed || writeFd === null) return;
      const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      let offset = 0;
      try {
        while (offset < buf.length) {
          offset += writeSync(writeFd, buf, offset, buf.length - offset);
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === 'EPIPE') return;
        throw err;
      }
    },
    end(): void {
      if (ended) return;
      ended = true;
      if (writeFd !== null) {
        try { closeSync(writeFd); } catch {}
        writeFd = null;
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (writeFd !== null) {
        try { closeSync(writeFd); } catch {}
        writeFd = null;
      }
      if (readFd !== null) {
        try { closeSync(readFd); } catch {}
        readFd = null;
      }
      rmSync(ioDir, { recursive: true, force: true });
    },
  };
}
