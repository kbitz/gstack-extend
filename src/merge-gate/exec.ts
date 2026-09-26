import { spawnSync } from 'node:child_process';
import { GateError } from './errors.ts';
import { EMPTY_TREE, GH_FIELDS, GIT_FLOOR, GIT_PINNED_CONFIG, PARTIAL_CLONE_KEYS, RENAME_LIMIT } from './registry.ts';
import { firstLine, redact } from './redact.ts';

const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const ATTR = `--attr-source=${EMPTY_TREE}`;
const INSTALL_GIT = `install git ${GIT_FLOOR.full.major}.${GIT_FLOOR.full.minor} or newer`;
const SAFE_DIRECTORY_READS = [
  [ATTR, 'config', '--global', '--includes', '--get-all', 'safe.directory'],
  [ATTR, 'config', '--system', '--includes', '--get-all', 'safe.directory'],
];

/** `status` is -1 when the child did not exit normally (signal, spawn error). */
export type SpawnOutcome = {
  status: number;
  stdout: Buffer;
  stderr: Buffer;
  timedOut: boolean;
  missing: boolean;
  overflow: boolean;
};

export type GatewayOpts = {
  cwd: string;
  parentEnv: NodeJS.ProcessEnv;
  gitTimeoutMs: number;
  ghTimeoutMs: number;
  debug: boolean;
  /** `safe.directory` values from the user's global and system config, from `safeDirectories()`. */
  safeDirectories?: string[];
};

export type GitResult = { stdout: Buffer; stderr: string; status: number; overflow: boolean };

export type Gateway = {
  version(): string;
  safeDirectories(): string[];
  partialCloneConfig(): string;
  gitPath(name: 'info/attributes'): string;
  toplevel(): string;
  verifyCommit(ref: string): string | null;
  isShallow(): boolean;
  mergeBase(a: string, b: string): string | null;
  remoteUrl(name: string): string | null;
  diffRaw(base: string, head: string): GitResult;
  diffPatch(base: string, head: string, paths: string[]): GitResult;
  catFileBatch(oids: string[]): Buffer;
  catFileBatchCheck(oids: string[]): Buffer;
  ghPrView(number: string, repoSpec: string): { stdout: Buffer; stderr: string; status: number };
};

export function buildChildEnv(parent: NodeJS.ProcessEnv, safeDirectories: string[] = []): NodeJS.ProcessEnv {
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
  env.GIT_ATTR_NOSYSTEM = '1';
  env.GIT_NO_REPLACE_OBJECTS = '1';
  env.GIT_LITERAL_PATHSPECS = '1';
  // Command-line config is protected configuration, so git honors safe.directory
  // from it; the user's own list survives the empty global config above.
  const config: [string, string][] = [...GIT_PINNED_CONFIG, ...safeDirectories.map((d): [string, string] => ['safe.directory', d])];
  env.GIT_CONFIG_COUNT = String(config.length);
  config.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = key;
    env[`GIT_CONFIG_VALUE_${i}`] = value;
  });
  return env;
}

/**
 * The environment for reading the user's own `safe.directory` list: the
 * parent's global and system config locations are kept, everything else
 * matches `buildChildEnv`.
 */
function configReadEnv(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = buildChildEnv(parent);
  delete env.GIT_CONFIG_GLOBAL;
  delete env.GIT_CONFIG_NOSYSTEM;
  for (const key of ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM']) {
    if (parent[key] !== undefined) env[key] = parent[key];
  }
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
  let stderr = Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr ?? '');
  if (err && stderr.length === 0) stderr = Buffer.from(`${cmd}: ${err.code ?? err.message}`);
  return {
    status: typeof result.status === 'number' ? result.status : -1,
    stdout,
    stderr,
    timedOut: err?.code === 'ETIMEDOUT',
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
  // `git version` runs first and without --attr-source, which older git rejects.
  if (args.length === 1 && args[0] === 'version') return true;
  if (args[0] !== ATTR) return false;
  const rest = args.slice(1);
  const head = rest[0];
  if (head === 'config' && rest.length === 3 && rest[1] === '--get-regexp' && rest[2] === PARTIAL_CLONE_KEYS) {
    return true;
  }
  if (SAFE_DIRECTORY_READS.some(t => t.length === args.length && t.every((a, i) => args[i] === a))) return true;
  if (head === 'rev-parse' && rest.length === 3 && rest[1] === '--git-path' && rest[2] === 'info/attributes') return true;
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

const DIFF_RAW = [
  'diff', '--raw', '--numstat', '-z', '-M', `-l${RENAME_LIMIT}`,
  '--diff-algorithm=myers', '--submodule=short', '--no-relative', '--no-color',
  '--no-ext-diff', '--no-textconv', '--no-abbrev',
];
const DIFF_PATCH = [
  'diff', '-U0', '-M', `-l${RENAME_LIMIT}`,
  '--diff-algorithm=myers', '--submodule=short', '--no-relative', '--no-color',
  '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/', '--no-abbrev',
];

function matchDiff(rest: string[]): boolean {
  if (startsWith(rest, DIFF_RAW) && rest.length === DIFF_RAW.length + 2) {
    const a = rest[DIFF_RAW.length];
    const b = rest[DIFF_RAW.length + 1];
    return typeof a === 'string' && typeof b === 'string' && SHA_RE.test(a) && SHA_RE.test(b);
  }
  if (!startsWith(rest, DIFF_PATCH)) return false;
  const after = rest.slice(DIFF_PATCH.length);
  if (after.length < 4 || after[2] !== '--') return false;
  const a = after[0];
  const b = after[1];
  if (typeof a !== 'string' || typeof b !== 'string' || !SHA_RE.test(a) || !SHA_RE.test(b)) return false;
  // Paths follow `--` and GIT_LITERAL_PATHSPECS=1, so a leading dash is a file name, not an option.
  return after.slice(3).every(p => typeof p === 'string' && p.length > 0);
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
  const env = buildChildEnv(opts.parentEnv, opts.safeDirectories);

  const run = (cmd: string, args: string[], timeoutMs: number, input?: Buffer, childEnv = env): SpawnOutcome => {
    assertArgvAllowed(cmd, args);
    const started = Date.now();
    const outcome = defaultSpawn(cmd, args, { cwd: opts.cwd, env: childEnv, input, timeoutMs });
    if (opts.debug) {
      const argv = redact([cmd, ...args].join(' '));
      process.stderr.write(`debug argv=${argv} status=${outcome.status} duration_ms=${Date.now() - started}\n`);
    }
    if (outcome.missing) {
      throw new GateError(
        cmd === 'git' ? 'git_missing' : 'gh_missing',
        `${cmd} is not on PATH`,
        cmd === 'git' ? INSTALL_GIT : 'install GitHub CLI (gh) and authenticate',
      );
    }
    if (outcome.timedOut) {
      throw new GateError(
        'spawn_timeout',
        `${cmd} ${args.find(a => !a.startsWith('-')) ?? ''} exceeded ${timeoutMs}ms`,
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

  const gitResult = (args: string[]): GitResult => {
    const outcome = run('git', args, opts.gitTimeoutMs);
    return { stdout: outcome.stdout, stderr: outcome.stderr.toString('utf8'), status: outcome.status, overflow: outcome.overflow };
  };

  const batch = (flag: '--batch' | '--batch-check', oids: string[]): Buffer => {
    for (const oid of oids) assertSha(oid);
    if (oids.length === 0) return Buffer.alloc(0);
    const outcome = gitOk([ATTR, 'cat-file', flag], Buffer.from(oids.map(o => `${o}\n`).join('')));
    if (outcome.status !== 0) {
      throw new GateError('git_failed', firstLine(outcome.stderr.toString('utf8')) || 'cat-file failed', 'fetch the missing objects and retry');
    }
    return outcome.stdout;
  };

  return {
    version() {
      const outcome = gitOk(['version']);
      if (outcome.status !== 0) {
        throw new GateError('git_failed', firstLine(outcome.stderr.toString('utf8')) || 'git version failed', INSTALL_GIT);
      }
      return outcome.stdout.toString('utf8');
    },
    safeDirectories() {
      // A missing key (exit 1) or an unreadable config yields no entries; git then applies its own ownership check.
      const readEnv = configReadEnv(opts.parentEnv);
      return SAFE_DIRECTORY_READS.flatMap(args => {
        const outcome = run('git', args, opts.gitTimeoutMs, undefined, readEnv);
        if (outcome.status !== 0 || outcome.overflow) return [];
        // An empty value resets git's list, so empty lines are kept in order.
        const text = outcome.stdout.toString('utf8').replace(/\n$/, '');
        return text === '' ? [] : text.split('\n');
      });
    },
    partialCloneConfig() {
      const outcome = gitOk([ATTR, 'config', '--get-regexp', PARTIAL_CLONE_KEYS]);
      // Exit 1 means no key matched.
      if (outcome.status === 1) return '';
      if (outcome.status !== 0) {
        throw new GateError('git_failed', firstLine(outcome.stderr.toString('utf8')) || 'git config failed', 'confirm the repository config is readable and retry');
      }
      return outcome.stdout.toString('utf8');
    },
    gitPath(name: 'info/attributes') {
      const outcome = gitOk([ATTR, 'rev-parse', '--git-path', name]);
      if (outcome.status !== 0) {
        throw new GateError('git_failed', firstLine(outcome.stderr.toString('utf8')) || 'git rev-parse failed', 'confirm the repository is readable and retry');
      }
      return outcome.stdout.toString('utf8').replace(/\n$/, '');
    },
    toplevel() {
      const outcome = gitOk([ATTR, 'rev-parse', '--show-toplevel']);
      if (outcome.status !== 0) {
        throw new GateError('not_a_repo', 'the working directory is not a git repository', 'run from a clone, or pass --repo-root');
      }
      return outcome.stdout.toString('utf8').replace(/\n$/, '');
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
      return gitResult([ATTR, ...DIFF_RAW, base, head]);
    },
    diffPatch(base: string, head: string, paths: string[]) {
      assertSha(base);
      assertSha(head);
      return gitResult([ATTR, ...DIFF_PATCH, base, head, '--', ...paths]);
    },
    catFileBatch(oids: string[]) {
      return batch('--batch', oids);
    },
    catFileBatchCheck(oids: string[]) {
      return batch('--batch-check', oids);
    },
    ghPrView(number: string, repoSpec: string) {
      const outcome = run('gh', ['pr', 'view', number, '-R', repoSpec, '--json', GH_FIELDS], opts.ghTimeoutMs);
      return { stdout: outcome.stdout, stderr: outcome.stderr.toString('utf8'), status: outcome.status };
    },
  };
}

export function parseGitVersion(text: string): { major: number; minor: number } | null {
  const m = /git version (\d+)\.(\d+)/.exec(text);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]) };
}

export function versionAtLeast(text: string, floor: { major: number; minor: number }): boolean {
  const v = parseGitVersion(text);
  if (!v) return false;
  if (v.major !== floor.major) return v.major > floor.major;
  return v.minor >= floor.minor;
}
