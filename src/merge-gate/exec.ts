import { spawnSync } from 'node:child_process';
import { GateError } from './errors.ts';
import { EMPTY_TREE, GH_FIELDS, RENAME_LIMIT } from './registry.ts';
import { firstLine, redact } from './redact.ts';

const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const ATTR = `--attr-source=${EMPTY_TREE}`;

export type SpawnOutcome = {
  status: number | null;
  stdout: Buffer;
  stderr: Buffer;
  timedOut: boolean;
  missing: boolean;
  overflow: boolean;
};

export type SpawnFn = (
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; input?: Buffer; timeoutMs: number },
) => SpawnOutcome;

export type GatewayOpts = {
  cwd: string;
  parentEnv: NodeJS.ProcessEnv;
  gitTimeoutMs: number;
  ghTimeoutMs: number;
  debug: boolean;
  stderr?: (s: string) => void;
  spawn?: SpawnFn;
};

export type Gateway = {
  version(): string;
  partialClone(): boolean;
  toplevel(): string;
  verifyCommit(ref: string): string | null;
  isShallow(): boolean;
  mergeBase(a: string, b: string): string | null;
  remoteUrl(name: string): string | null;
  diffRaw(base: string, head: string): { stdout: Buffer; stderr: string; status: number | null; overflow: boolean };
  diffPatch(base: string, head: string, paths: string[]): { stdout: Buffer; stderr: string; status: number | null; overflow: boolean };
  catFileBatch(oids: string[]): Buffer;
  catFileBatchCheck(oids: string[]): Buffer;
  ghPrView(number: string, repoSpec: string): { stdout: Buffer; stderr: string; status: number };
};

export function buildChildEnv(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(parent)) {
    if (key.startsWith('GIT_')) continue;
    if (key === 'GH_REPO' || key === 'GH_HOST') continue;
    env[key] = value;
  }
  env.LC_ALL = 'C';
  env.GIT_PAGER = 'cat';
  env.GIT_OPTIONAL_LOCKS = '0';
  env.GIT_NO_LAZY_FETCH = '1';
  env.GH_PROMPT_DISABLED = '1';
  env.GH_NO_UPDATE_NOTIFIER = '1';
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  env.GIT_NO_REPLACE_OBJECTS = '1';
  env.GIT_LITERAL_PATHSPECS = '1';
  env.GIT_CONFIG_COUNT = '2';
  env.GIT_CONFIG_KEY_0 = 'core.quotePath';
  env.GIT_CONFIG_VALUE_0 = 'false';
  env.GIT_CONFIG_KEY_1 = 'core.fsmonitor';
  env.GIT_CONFIG_VALUE_1 = 'false';
  return env;
}

function defaultSpawn(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; input?: Buffer; timeoutMs: number },
): SpawnOutcome {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env,
    input: opts.input,
    timeout: opts.timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  const err = result.error as NodeJS.ErrnoException | undefined;
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? '');
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr ?? '');
  return {
    status: result.status,
    stdout,
    stderr,
    timedOut: err?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM',
    missing: err?.code === 'ENOENT',
    overflow: err?.code === 'ENOBUFS' || err?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
  };
}

function assertSha(sha: string): void {
  if (!SHA_RE.test(sha)) {
    throw new GateError('forbidden_command', 'rev is not a full sha', 'report this as a gate bug');
  }
}

/** Throws forbidden_command when argv is outside the typed templates. */
export function assertArgvAllowed(cmd: string, args: string[]): void {
  if (cmd === 'git') {
    if (matchGit(args)) return;
  } else if (cmd === 'gh') {
    if (matchGh(args)) return;
  }
  throw new GateError(
    'forbidden_command',
    'spawn argv is not on the allowlist',
    'report this as a gate bug',
  );
}

function matchGit(args: string[]): boolean {
  if (args[0] !== ATTR) return false;
  const rest = args.slice(1);
  const head = rest[0];
  if (head === 'version' && rest.length === 1) return true;
  if (head === 'config' && rest.length === 3 && rest[1] === '--get' && rest[2] === 'extensions.partialClone') {
    return true;
  }
  if (head === 'rev-parse' && rest.length === 2 && rest[1] === '--show-toplevel') return true;
  if (head === 'rev-parse' && rest.length === 2 && rest[1] === '--is-shallow-repository') return true;
  if (
    head === 'rev-parse' &&
    rest.length === 5 &&
    rest[1] === '--verify' &&
    rest[2] === '--quiet' &&
    rest[3] === '--end-of-options' &&
    typeof rest[4] === 'string' &&
    !rest[4].startsWith('-')
  ) {
    return true;
  }
  if (head === 'merge-base' && rest.length === 3 && rest[1] && rest[2] && SHA_RE.test(rest[1]) && SHA_RE.test(rest[2])) {
    return true;
  }
  if (
    head === 'remote' &&
    rest.length === 3 &&
    rest[1] === 'get-url' &&
    typeof rest[2] === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(rest[2])
  ) {
    return true;
  }
  if (head === 'diff' && matchDiff(rest)) return true;
  if (head === 'cat-file' && rest.length === 2 && (rest[1] === '--batch' || rest[1] === '--batch-check')) {
    return true;
  }
  return false;
}

function matchDiff(rest: string[]): boolean {
  const raw = [
    'diff', '--raw', '--numstat', '-z', '-M', `-l${RENAME_LIMIT}`,
    '--diff-algorithm=myers', '--submodule=short', '--no-relative', '--no-color',
    '--no-ext-diff', '--no-textconv', '--no-abbrev',
  ];
  const patch = [
    'diff', '-U0', '-M', `-l${RENAME_LIMIT}`,
    '--diff-algorithm=myers', '--submodule=short', '--no-relative', '--no-color',
    '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/', '--no-abbrev',
  ];
  if (startsWith(rest, raw) && rest.length === raw.length + 2) {
    const a = rest[raw.length];
    const b = rest[raw.length + 1];
    return typeof a === 'string' && typeof b === 'string' && SHA_RE.test(a) && SHA_RE.test(b);
  }
  if (!startsWith(rest, patch)) return false;
  const after = rest.slice(patch.length);
  if (after.length < 3 || after[2] !== '--') return false;
  const a = after[0];
  const b = after[1];
  if (typeof a !== 'string' || typeof b !== 'string' || !SHA_RE.test(a) || !SHA_RE.test(b)) return false;
  return after.slice(3).every(p => typeof p === 'string' && p.length > 0 && !p.startsWith('-'));
}

function matchGh(args: string[]): boolean {
  if (args.length !== 7) return false;
  if (args[0] !== 'pr' || args[1] !== 'view') return false;
  if (!/^[1-9][0-9]*$/.test(args[2] ?? '')) return false;
  if (args[3] !== '-R') return false;
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)?$/.test(args[4] ?? '')) return false;
  if (args[5] !== '--json') return false;
  return args[6] === GH_FIELDS;
}

function startsWith(args: string[], prefix: string[]): boolean {
  if (args.length < prefix.length) return false;
  return prefix.every((p, i) => args[i] === p);
}

export function createGateway(opts: GatewayOpts): Gateway {
  const env = buildChildEnv(opts.parentEnv);
  const spawn = opts.spawn ?? defaultSpawn;
  const writeErr = opts.stderr ?? ((s: string) => process.stderr.write(s));

  const run = (cmd: string, args: string[], timeoutMs: number, input?: Buffer): SpawnOutcome => {
    assertArgvAllowed(cmd, args);
    const started = Date.now();
    const outcome = spawn(cmd, args, { cwd: opts.cwd, env, input, timeoutMs });
    if (opts.debug) {
      const argv = redact([cmd, ...args].join(' '));
      const ms = Date.now() - started;
      writeErr(`debug argv=${argv} status=${outcome.status ?? 'null'} duration_ms=${ms}\n`);
    }
    if (outcome.missing) {
      throw new GateError(
        cmd === 'git' ? 'git_missing' : 'gh_missing',
        `${cmd} is not on PATH`,
        cmd === 'git' ? 'install git 2.40 or newer' : 'install GitHub CLI (gh) and authenticate',
      );
    }
    if (outcome.timedOut) {
      throw new GateError(
        'spawn_timeout',
        `${cmd} exceeded ${timeoutMs}ms`,
        'retry with a larger --timeout, or narrow the diff',
      );
    }
    return outcome;
  };

  const gitOk = (args: string[], input?: Buffer): SpawnOutcome => {
    const outcome = run('git', args, opts.gitTimeoutMs, input);
    if (outcome.overflow) {
      throw new GateError('git_failed', 'git output exceeded the buffer', 'retry; a file may be too large to diff');
    }
    return outcome;
  };

  return {
    version() {
      const outcome = gitOk([ATTR, 'version']);
      if (outcome.status !== 0) {
        throw new GateError('git_failed', firstLine(outcome.stderr.toString('utf8')) || 'git version failed', 'install git 2.40 or newer');
      }
      return outcome.stdout.toString('utf8');
    },
    partialClone() {
      const outcome = gitOk([ATTR, 'config', '--get', 'extensions.partialClone']);
      if (outcome.status === 0 && outcome.stdout.toString('utf8').trim() !== '') return true;
      return false;
    },
    toplevel() {
      const outcome = gitOk([ATTR, 'rev-parse', '--show-toplevel']);
      if (outcome.status !== 0) {
        throw new GateError('not_a_repo', 'the working directory is not a git repository', 'run from a clone, or pass --repo-root');
      }
      return outcome.stdout.toString('utf8').trim();
    },
    verifyCommit(ref: string) {
      const outcome = gitOk([ATTR, 'rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]);
      if (outcome.status !== 0) return null;
      const sha = outcome.stdout.toString('utf8').trim();
      return SHA_RE.test(sha) ? sha : null;
    },
    isShallow() {
      const outcome = gitOk([ATTR, 'rev-parse', '--is-shallow-repository']);
      return outcome.status === 0 && outcome.stdout.toString('utf8').trim() === 'true';
    },
    mergeBase(a: string, b: string) {
      assertSha(a);
      assertSha(b);
      const outcome = gitOk([ATTR, 'merge-base', a, b]);
      if (outcome.status !== 0) return null;
      const sha = outcome.stdout.toString('utf8').trim();
      return SHA_RE.test(sha) ? sha : null;
    },
    remoteUrl(name: string) {
      const outcome = gitOk([ATTR, 'remote', 'get-url', name]);
      if (outcome.status !== 0) return null;
      const url = outcome.stdout.toString('utf8').trim();
      return url === '' ? null : url;
    },
    diffRaw(base: string, head: string) {
      assertSha(base);
      assertSha(head);
      const outcome = run('git', [
        ATTR, 'diff', '--raw', '--numstat', '-z', '-M', `-l${RENAME_LIMIT}`,
        '--diff-algorithm=myers', '--submodule=short', '--no-relative', '--no-color',
        '--no-ext-diff', '--no-textconv', '--no-abbrev', base, head,
      ], opts.gitTimeoutMs);
      if (outcome.missing) {
        throw new GateError('git_missing', 'git is not on PATH', 'install git 2.40 or newer');
      }
      return { stdout: outcome.stdout, stderr: outcome.stderr.toString('utf8'), status: outcome.status, overflow: outcome.overflow };
    },
    diffPatch(base: string, head: string, paths: string[]) {
      assertSha(base);
      assertSha(head);
      const outcome = run('git', [
        ATTR, 'diff', '-U0', '-M', `-l${RENAME_LIMIT}`,
        '--diff-algorithm=myers', '--submodule=short', '--no-relative', '--no-color',
        '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/', '--no-abbrev',
        base, head, '--', ...paths,
      ], opts.gitTimeoutMs);
      return { stdout: outcome.stdout, stderr: outcome.stderr.toString('utf8'), status: outcome.status, overflow: outcome.overflow };
    },
    catFileBatch(oids: string[]) {
      for (const oid of oids) assertSha(oid);
      const outcome = gitOk([ATTR, 'cat-file', '--batch'], Buffer.from(oids.map(o => `${o}\n`).join('')));
      if (outcome.status !== 0) {
        throw new GateError('git_failed', firstLine(outcome.stderr.toString('utf8')) || 'cat-file failed', 'fetch the missing objects and retry');
      }
      return outcome.stdout;
    },
    catFileBatchCheck(oids: string[]) {
      for (const oid of oids) assertSha(oid);
      if (oids.length === 0) return Buffer.alloc(0);
      const outcome = gitOk([ATTR, 'cat-file', '--batch-check'], Buffer.from(oids.map(o => `${o}\n`).join('')));
      if (outcome.status !== 0) {
        throw new GateError('git_failed', firstLine(outcome.stderr.toString('utf8')) || 'cat-file failed', 'fetch the missing objects and retry');
      }
      return outcome.stdout;
    },
    ghPrView(number: string, repoSpec: string) {
      const outcome = run('gh', ['pr', 'view', number, '-R', repoSpec, '--json', GH_FIELDS], opts.ghTimeoutMs);
      return { stdout: outcome.stdout, stderr: outcome.stderr.toString('utf8'), status: outcome.status ?? 1 };
    },
  };
}

export function parseGitVersion(text: string): { major: number; minor: number } | null {
  const m = /git version (\d+)\.(\d+)/.exec(text);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]) };
}

export function versionAtLeast(text: string, major: number, minor: number): boolean {
  const v = parseGitVersion(text);
  if (!v) return false;
  if (v.major !== major) return v.major > major;
  return v.minor >= minor;
}
