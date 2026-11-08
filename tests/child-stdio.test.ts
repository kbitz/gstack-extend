import { describe, expect, test } from 'bun:test';
import { spawn, spawnSync as nativeSpawnSync } from 'node:child_process';
import {
  closeSync,
  constants,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openChildStdio, openFifoStdin, spawnSync } from './helpers/child-stdio.ts';

describe('child-stdio shared helper', () => {
  // Value: protects=file-backed spawnSync returns a child Bun process's exact stdout, stderr, output tuple, strings when encoding is set, and Buffers when encoding is omitted or 'buffer'; fails_when=stdout or stderr is truncated, swapped, or returned with the wrong type; why_new=pins AC7 string and Buffer overload fidelity for the new shared helper; seam=none
  test('returns a child Bun process stdout and stderr as strings and as Buffers', () => {
    const script = 'process.stdout.write("out-line\\n"); process.stderr.write("err-line\\n");';
    const asString = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    expect(asString.status).toBe(0);
    expect(asString.signal).toBeNull();
    expect(asString.error).toBeUndefined();
    expect(typeof asString.stdout).toBe('string');
    expect(typeof asString.stderr).toBe('string');
    expect(asString.stdout).toBe('out-line\n');
    expect(asString.stderr).toBe('err-line\n');
    expect(asString.output).toEqual([null, 'out-line\n', 'err-line\n']);

    const asBuffer = spawnSync(process.execPath, ['-e', script]);
    expect(asBuffer.status).toBe(0);
    expect(Buffer.isBuffer(asBuffer.stdout)).toBe(true);
    expect(Buffer.isBuffer(asBuffer.stderr)).toBe(true);
    expect(asBuffer.stdout.toString('utf8')).toBe('out-line\n');
    expect(asBuffer.stderr.toString('utf8')).toBe('err-line\n');
    expect(asBuffer.output).toEqual([null, Buffer.from('out-line\n'), Buffer.from('err-line\n')]);

    const explicitBuffer = spawnSync(process.execPath, ['-e', script], { encoding: 'buffer' });
    expect(Buffer.isBuffer(explicitBuffer.stdout)).toBe(true);
    expect(Buffer.isBuffer(explicitBuffer.stderr)).toBe(true);
    expect(explicitBuffer.stdout.toString('utf8')).toBe('out-line\n');
    expect(explicitBuffer.stderr.toString('utf8')).toBe('err-line\n');
  });

  // Value: protects=options.input arrives at child stdin intact while stdout and stderr are file-backed; fails_when=file-backing stdout/stderr drops or corrupts options.input; why_new=pins T2 requirement that input works alongside file-backed outputs; seam=none
  test('delivers input while outputs are file-backed', () => {
    const code = [
      'const fs = require("node:fs");',
      'const data = fs.readFileSync(0, "utf8");',
      'process.stdout.write(`data=${data}\\n`);',
      'process.stderr.write("stdin-ok\\n");',
    ].join(' ');
    const r = spawnSync(process.execPath, ['-e', code], {
      input: 'payload-123',
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('stdin-ok\n');
    expect(r.stdout).toBe('data=payload-123\n');
  });

  // Value: protects=nonzero status, signal termination, and timeout ETIMEDOUT error pass through unchanged; fails_when=the wrapper swallows status, signal, or timeout error; why_new=pins AC7 status, signal, and error fidelity on child-stdio spawnSync; seam=none
  test('passes status, signal, and timeout ETIMEDOUT error through', () => {
    const nonzero = spawnSync(
      process.execPath,
      ['-e', 'process.stdout.write("before-exit"); process.stderr.write("why"); process.exit(17);'],
      { encoding: 'utf8' },
    );
    expect(nonzero.status).toBe(17);
    expect(nonzero.signal).toBeNull();
    expect(nonzero.stdout).toBe('before-exit');
    expect(nonzero.stderr).toBe('why');

    const killed = spawnSync(
      process.execPath,
      ['-e', 'process.kill(process.pid, "SIGTERM");'],
      { encoding: 'utf8' },
    );
    expect(killed.status).toBeNull();
    expect(killed.signal).toBe('SIGTERM');

    const timedOut = spawnSync(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 10_000);'],
      { encoding: 'utf8', timeout: 100 },
    );
    expect(timedOut.signal).toBe('SIGTERM');
    expect((timedOut.error as NodeJS.ErrnoException | undefined)?.code).toBe('ETIMEDOUT');
  });

  // Value: protects='inherit', 'ignore', and caller fd numbers pass through untouched and string stdio forms allocate no temp files; fails_when=the helper replaces non-pipe stdio entries or creates temp directories for 'ignore'/'inherit'; why_new=pins AC7 stdio slot preservation across string and array stdio forms; seam=TMPDIR scoped to a private directory for exact directory-entry inspection
  test('preserves inherit, ignore, and custom fd stdio entries without extra temp files', () => {
    const privTmp = mkdtempSync(join(tmpdir(), 'child-stdio-modes-'));
    const prevTmp = process.env.TMPDIR;
    process.env.TMPDIR = privTmp;
    try {
      const ignored = spawnSync(
        process.execPath,
        ['-e', 'process.stdout.write("hidden"); process.stderr.write("hidden-err");'],
        { stdio: 'ignore', encoding: 'utf8' },
      );
      expect(ignored.status).toBe(0);
      expect(ignored.stdout).toBeNull();
      expect(ignored.stderr).toBeNull();
      expect(readdirSync(privTmp)).toEqual([]);

      // An outer file-backed child makes the inner inherited streams observable.
      const inherited = spawnSync(process.execPath, ['-e', `
        import { spawnSync } from ${JSON.stringify(join(import.meta.dir, 'helpers/child-stdio.ts'))};
        import { readdirSync } from 'node:fs';
        const before = readdirSync(process.env.TMPDIR);
        const result = spawnSync(process.execPath, ['-e', 'process.stdout.write("inherited-out"); process.stderr.write("inherited-err");'], { stdio: 'inherit' });
        if (result.status !== 0 || result.stdout !== null || result.stderr !== null ||
            JSON.stringify(readdirSync(process.env.TMPDIR)) !== JSON.stringify(before)) process.exit(42);
      `], { encoding: 'utf8' });
      expect(inherited.status).toBe(0);
      expect(inherited.stdout).toBe('inherited-out');
      expect(inherited.stderr).toBe('inherited-err');
      expect(readdirSync(privTmp)).toEqual([]);

      const customOutPath = join(privTmp, 'custom-out.txt');
      const customFd = openSync(customOutPath, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC, 0o600);
      try {
        const mixed = spawnSync(
          process.execPath,
          ['-e', 'process.stdout.write("to-custom-fd"); process.stderr.write("to-pipe-file");'],
          { stdio: ['ignore', customFd, 'pipe'], encoding: 'utf8' },
        );
        expect(mixed.status).toBe(0);
        expect(mixed.stdout).toBeNull();
        expect(mixed.stderr).toBe('to-pipe-file');
      } finally {
        closeSync(customFd);
      }
      expect(readFileSync(customOutPath, 'utf8')).toBe('to-custom-fd');
      expect(readdirSync(privTmp)).toEqual(['custom-out.txt']);
    } finally {
      if (prevTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = prevTmp;
      rmSync(privTmp, { recursive: true, force: true });
    }
  });

  // Value: protects=per-call child-stdio temp directories are removed after exit 0, nonzero exit, and failed spawn (ENOENT), whose outputs match native spawnSync; fails_when=temp directories leak or a failed spawn fabricates empty output instead of preserving the native result; why_new=pins AC7 cleanup and failed-spawn output fidelity; seam=TMPDIR scoped to a private directory
  test('removes the per-call io directory after success, nonzero exit, and spawn error', () => {
    const privTmp = mkdtempSync(join(tmpdir(), 'child-stdio-clean-'));
    const prevTmp = process.env.TMPDIR;
    process.env.TMPDIR = privTmp;
    try {
      const ok = spawnSync(process.execPath, ['-e', 'process.stdout.write("ok");'], { encoding: 'utf8' });
      expect(ok.status).toBe(0);
      expect(readdirSync(privTmp)).toEqual([]);

      const fail = spawnSync(process.execPath, ['-e', 'process.stderr.write("bad"); process.exit(3);'], { encoding: 'utf8' });
      expect(fail.status).toBe(3);
      expect(readdirSync(privTmp)).toEqual([]);

      const missing = spawnSync('/nonexistent-binary-child-stdio-test', [], { encoding: 'utf8' });
      const nativeMissing = nativeSpawnSync('/nonexistent-binary-child-stdio-test', [], { encoding: 'utf8' });
      expect((missing.error as NodeJS.ErrnoException | undefined)?.code).toBe('ENOENT');
      expect(missing.stdout).toBe(nativeMissing.stdout);
      expect(missing.stderr).toBe(nativeMissing.stderr);
      expect(missing.output).toEqual(nativeMissing.output);
      expect(readdirSync(privTmp)).toEqual([]);
    } finally {
      if (prevTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = prevTmp;
      rmSync(privTmp, { recursive: true, force: true });
    }
  });

  // Value: protects=maxBuffer is rejected loudly because file-backed stdio cannot enforce a pipe buffer cap; fails_when=spawnSync silently ignores maxBuffer; why_new=pins AC7 maxBuffer throw contract; seam=none
  test('throws when maxBuffer is passed', () => {
    expect(() =>
      spawnSync(process.execPath, ['-e', ''], { maxBuffer: 1024, encoding: 'utf8' }),
    ).toThrow(/maxBuffer/);
  });

  // Value: protects=openChildStdio works with both node:child_process spawn and Bun.spawn and cleans up its directory on dispose(); fails_when=async child stdout or stderr is lost or temp files remain after dispose(); why_new=pins T2 openChildStdio contract for both async spawn APIs; seam=TMPDIR scoped to a private directory
  test('openChildStdio captures stdout and stderr for node spawn and Bun.spawn and cleans up on dispose', async () => {
    const privTmp = mkdtempSync(join(tmpdir(), 'child-stdio-async-'));
    const prevTmp = process.env.TMPDIR;
    process.env.TMPDIR = privTmp;
    try {
      const script = 'process.stdout.write("async-out\\n"); process.stderr.write("async-err\\n");';

      const nodeIo = openChildStdio();
      try {
        const code = await new Promise<number | null>((resolve, reject) => {
          const child = spawn(process.execPath, ['-e', script], {
            stdio: ['ignore', nodeIo.stdoutFd, nodeIo.stderrFd],
          });
          child.on('error', reject);
          child.on('close', exitCode => resolve(exitCode));
        });
        expect(code).toBe(0);
        expect(nodeIo.read()).toEqual({ stdout: 'async-out\n', stderr: 'async-err\n' });
      } finally {
        nodeIo.dispose();
      }
      expect(readdirSync(privTmp)).toEqual([]);

      const bunIo = openChildStdio();
      try {
        const proc = Bun.spawn([process.execPath, '-e', script], {
          stdin: 'ignore',
          stdout: bunIo.stdoutFd,
          stderr: bunIo.stderrFd,
        });
        expect(await proc.exited).toBe(0);
        expect(bunIo.read()).toEqual({ stdout: 'async-out\n', stderr: 'async-err\n' });
      } finally {
        bunIo.dispose();
      }
      expect(readdirSync(privTmp)).toEqual([]);
    } finally {
      if (prevTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = prevTmp;
      rmSync(privTmp, { recursive: true, force: true });
    }
  });

  // Value: protects=openFifoStdin presents a real FIFO on stdin (test -p /dev/stdin), delivers delayed writes, signals EOF on end(), and swallows EPIPE after reader exit; fails_when=stdin is a regular file or socket, open blocks, delayed writes fail with EAGAIN, or post-exit writes throw EPIPE; why_new=pins T2 openFifoStdin contract used by live-pipe tests; seam=TMPDIR scoped to a private directory
  test('openFifoStdin provides a FIFO stdin, delivers delayed writes, gives EOF on end(), and swallows EPIPE', async () => {
    const privTmp = mkdtempSync(join(tmpdir(), 'child-stdio-fifo-'));
    const prevTmp = process.env.TMPDIR;
    process.env.TMPDIR = privTmp;
    try {
      const fifo = openFifoStdin();
      const io = openChildStdio();
      try {
        const childPromise = new Promise<number | null>((resolve, reject) => {
          const child = spawn('sh', ['-c', 'test -p /dev/stdin && cat'], {
            stdio: [fifo.readFd, io.stdoutFd, io.stderrFd],
          });
          child.on('error', reject);
          child.on('close', code => resolve(code));
        });
        await new Promise(r => setTimeout(r, 40));
        fifo.write('delayed-line-1\n');
        fifo.write(Buffer.from('delayed-line-2\n'));
        fifo.end();
        expect(await childPromise).toBe(0);
        expect(io.read()).toEqual({
          stdout: 'delayed-line-1\ndelayed-line-2\n',
          stderr: '',
        });
      } finally {
        fifo.dispose();
        io.dispose();
      }
      expect(readdirSync(privTmp)).toEqual([]);

      // Also verify that writing after all readers have closed swallows EPIPE.
      const epipeFifo = openFifoStdin();
      try {
        closeSync(epipeFifo.readFd);
        expect(() => epipeFifo.write('after-reader-closed\n')).not.toThrow();
        epipeFifo.end();
      } finally {
        epipeFifo.dispose();
      }
      expect(readdirSync(privTmp)).toEqual([]);
    } finally {
      if (prevTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = prevTmp;
      rmSync(privTmp, { recursive: true, force: true });
    }
  });
});
