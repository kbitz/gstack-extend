/**
 * review-delegate: runs named `/review-and-prep` specialist parts through the
 * provider commands a caller configures. `check` validates without any call;
 * `run` makes one bounded, read-only call per part and reports which parts the
 * host must run itself. Contract and recovery: docs/delegated-review.md.
 */
import { execFile, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { access, copyFile, lstat, realpath, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { UPSTREAM_HELPERS } from '../outside-review/cli';
import { snapshotDiff, type Request } from '../outside-review/prompt';
import type { Classifier } from '../outside-review/recovery';
import { attackerInventory, delegateInventory, extendRoot, readTrusted } from '../upstream-check/cli';
import {
  ATTACKER_PARTS, CONFIG_LIMIT, CONTROL_RE, PARTS, RED_TEAM_FRAMING, SPECIALIST_PARTS, STDERR_LIMIT, STDOUT_LIMIT, TIMEOUT_EXIT, buildPrompt, callId, claimBody, decide, extractAdversarialChecklist, keyringSeccomp, sandboxArgs, validateConfig,
  type DelegateConfig, type Part, type PartResult, type RefusalReason, type SandboxExpose, type SandboxInput, type SpecialistPart, type Spawned,
} from './delegate';

export const EXIT = { ok: 0, refused: 1, usage: 2, fellBack: 4 } as const;
export const BWRAP_PATHS = ['/usr/bin/bwrap', '/bin/bwrap', '/usr/local/bin/bwrap'] as const;
/** Host programs repo mode runs by fixed path, never a PATH lookup: bwrap above, and these two helpers. */
const GETENT_PATHS = ['/usr/bin/getent', '/bin/getent'] as const;
const CHMOD_PATHS = ['/usr/bin/chmod', '/bin/chmod'] as const;
const firstExisting = (paths: readonly string[]) => paths.find((path) => existsSync(path));
/** How long cleanup may hold a part's result: a stalled removal cannot hold the invocation. */
const CLEANUP_LIMIT_MS = 30_000;
/** Test seams for what the sandbox checks read: the platform, bwrap paths, uid, architecture and passwd-home lookup. */
export interface Deps { platform?: string; bwrapPaths?: readonly string[]; uid?: number; arch?: string; accountHome?: () => string }
const CHILD_ENV = ['HOME', 'PATH', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ'] as const;

export interface CliIo { stdout(text: string): void; stderr(text: string): void }

class UsageError extends Error {
  constructor(message: string, readonly fix: string) { super(message); }
}

interface Options {
  command: 'check' | 'run'; config: string; root: string; parts: Part[];
  repo: string; base: string; candidate: string; calls: string;
  adversarial: string; caught: string;
}

const REQUIRED_FLAGS = {
  check: ['--config', '--gstack-root', '--parts'],
  run: ['--config', '--gstack-root', '--parts', '--repo', '--base', '--candidate', '--calls'],
} as const;

const KNOWN_FLAGS = {
  check: [...REQUIRED_FLAGS.check, '--adversarial'],
  run: [...REQUIRED_FLAGS.run, '--adversarial', '--caught'],
} as const;

/** realpath of the nearest existing ancestor plus the not-yet-created tail, so a symlinked temp root cannot hide the repository. */
function realpathBelow(path: string): string {
  let head = path;
  const tail: string[] = [];
  for (;;) {
    try { return join(realpathSync(head), ...tail.reverse()); } catch { /* try the parent */ }
    const parent = resolve(head, '..');
    if (parent === head) return path;
    tail.push(basename(head));
    head = parent;
  }
}

/** True when `child` is `parent` itself or lies inside it. */
function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** A path as written and with its symlinks resolved, so a symlinked ancestor cannot disguise a hidden path. */
const pathForms = (path: string) => [...new Set([path, realpathBelow(path)])];

/** XDG_RUNTIME_DIR resolved when it is usable (absolute, no control characters, not `/`); prepare() and setup must agree on it. */
const runtimeDirFromEnv = (): string | undefined => {
  const raw = process.env.XDG_RUNTIME_DIR;
  return raw && isAbsolute(raw) && !CONTROL_RE.test(raw) && resolve(raw) !== '/' ? resolve(raw) : undefined;
};

/** The account's home from the passwd database: Bun's os.userInfo() reports $HOME instead, so it cannot see a HOME override. */
export function passwdHome(): string {
  const uid = process.getuid?.();
  if (uid === undefined) return '';
  try {
    const getent = firstExisting(GETENT_PATHS);
    const res = getent ? spawnSync(getent, ['passwd', String(uid)], { encoding: 'utf8', timeout: 5000, cwd: '/' }) : undefined;
    const home = res?.status === 0 ? res.stdout.split('\n')[0]?.split(':')[5] : undefined;
    if (home) return home;
  } catch { /* fall back to the file */ }
  try {
    for (const line of readFileSync('/etc/passwd', 'utf8').split('\n')) {
      const fields = line.split(':');
      if (fields[2] === String(uid) && fields[5]) return fields[5];
    }
  } catch { /* no passwd file */ }
  return '';
}

/** A path with its ancestors resolved and its last component as written, which is where bwrap finds a link or mounts an entry. */
const linkLocation = (path: string) => join(realpathBelow(dirname(path)), basename(path));

/**
 * `path` and every link it passes through (at most 16 hops), each as a location, plus each link's target as written: the kernel
 * inside the sandbox follows that spelling, so a symlink in it that a hidden directory removes breaks exec.
 */
function linkChain(path: string): { hops: string[]; targets: string[] } {
  const hops = [linkLocation(path)];
  const targets: string[] = [];
  let current = hops[0]!;
  for (let i = 0; i < 16; i++) {
    let target: string;
    try {
      if (!lstatSync(current).isSymbolicLink()) break;
      target = readlinkSync(current);
    } catch { break; }
    targets.push(resolve(dirname(current), target));
    current = linkLocation(resolve(dirname(current), target));
    hops.push(current);
  }
  return { hops, targets };
}

function parseArgs(argv: string[]): 'help' | Options {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h') return 'help';
  if (command !== 'check' && command !== 'run') throw new UsageError(`unknown command ${JSON.stringify(String(command).slice(0, 40))}`, 'use check or run');
  const known: readonly string[] = KNOWN_FLAGS[command];
  const required: readonly string[] = REQUIRED_FLAGS[command];
  const seen = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]!;
    if (flag === '--help' || flag === '-h') return 'help';
    if (!known.includes(flag)) throw new UsageError(`unknown argument ${JSON.stringify(flag.slice(0, 80))}`, `use only ${known.join(', ')} or --help`);
    if (seen.has(flag)) throw new UsageError(`duplicate ${flag}`, `pass ${flag} once`);
    const value = rest[++i];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} needs a value`, `pass ${flag} <value>`);
    if (CONTROL_RE.test(value)) throw new UsageError(`${flag} contains a control character`, `pass a plain value for ${flag}`);
    seen.set(flag, value);
  }
  for (const flag of required) if (!seen.has(flag)) throw new UsageError(`${flag} is required`, `pass ${flag} <value>`);
  const parts = seen.get('--parts')!.split(',');
  for (const part of parts) {
    if (!(PARTS as readonly string[]).includes(part)) {
      throw new UsageError(`${JSON.stringify(part.slice(0, 40))} cannot be delegated`, `name only ${PARTS.join(', ')}; every other review part stays on the host model`);
    }
  }
  if (new Set(parts).size !== parts.length) throw new UsageError('a part is repeated', 'name each part once');
  if (parts.includes('adversarial') && !seen.has('--adversarial')) {
    throw new UsageError('--adversarial is required when --parts includes adversarial', 'pass --adversarial <file>');
  }
  if (!parts.includes('adversarial') && seen.has('--adversarial')) {
    throw new UsageError('--adversarial is only allowed when --parts includes adversarial', 'omit --adversarial or include adversarial in --parts');
  }
  if (command === 'run') {
    if (parts.includes('red-team') && !seen.has('--caught')) {
      throw new UsageError('--caught is required when --parts includes red-team', 'pass --caught <file>');
    }
    if (!parts.includes('red-team') && seen.has('--caught')) {
      throw new UsageError('--caught is only allowed when --parts includes red-team', 'omit --caught or include red-team in --parts');
    }
  }
  for (const flag of ['--config', '--gstack-root', '--repo', '--calls', '--adversarial', '--caught']) {
    const value = seen.get(flag);
    if (value !== undefined && !isAbsolute(value)) throw new UsageError(`${flag} must be an absolute path`, `pass an absolute path for ${flag}`);
  }
  for (const flag of ['--base', '--candidate']) {
    const value = seen.get(flag);
    if (value !== undefined && !/^[0-9a-f]{40}$/.test(value)) throw new UsageError(`${flag} must be a full 40-character SHA`, `pass a full SHA for ${flag}`);
  }
  const rawRepo = seen.get('--repo');
  // A --repo naming a subdirectory stands for its whole checkout: the inside-repository checks, the work-tree check, the hidden
  // paths and the copy all use the top level.
  const repo = rawRepo !== undefined ? repoTop(rawRepo) : undefined;
  const calls = seen.get('--calls');
  const caught = seen.get('--caught');
  if (repo !== undefined) {
    // A claim or caught-findings file inside the work tree would read as a write by the delegate or mix with reviewed files.
    let top = repo;
    try { top = realpathSync(top); } catch { /* reported as repo-unreadable */ }
    for (const [flag, target, label] of [['--calls', calls, 'calls directory'], ['--caught', caught, 'caught file']] as const) {
      if (target === undefined) continue;
      if (isWithin(top, realpathBelow(resolve(target)))) {
        throw new UsageError(`${flag} is inside --repo`, `pass a ${label} outside the repository under review`);
      }
    }
  }
  return { command, config: resolve(seen.get('--config')!), root: resolve(seen.get('--gstack-root')!), parts: parts as Part[],
    repo: repo ?? '', base: seen.get('--base') ?? '', candidate: seen.get('--candidate') ?? '', calls: calls ?? '',
    adversarial: seen.get('--adversarial') ? resolve(seen.get('--adversarial')!) : '',
    caught: caught ? resolve(caught) : '' };
}

/** The top level of the checkout containing `repo`, or `repo` itself when git cannot name one (reported later as repo-unreadable). */
function repoTop(repo: string): string {
  const dir = resolve(repo);
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
  try {
    const res = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', env, timeout: 10_000 });
    const top = res.status === 0 ? res.stdout.replace(/\n$/, '') : '';
    return top && isAbsolute(top) && !top.includes('\n') ? top : dir;
  } catch {
    return dir;
  }
}

function resolveSandboxBwrap(deps: Deps = {}): string | null {
  const platform = deps.platform ?? process.platform;
  if (platform !== 'linux') return null;
  // As uid 0 the sandbox could read every root-only file, and without a seccomp table the kernel keyrings stay reachable.
  const program = keyringSeccomp(deps.arch ?? process.arch);
  if ((deps.uid ?? process.getuid?.()) === 0 || !program) return null;
  const paths = deps.bwrapPaths ?? BWRAP_PATHS;
  let bwrap: string | null = null;
  for (const candidate of paths) {
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) { bwrap = candidate; break; }
    } catch { /* try next */ }
  }
  if (!bwrap) return null;
  let probeDir: string;
  try {
    try { probeDir = mkdtempSync(join(tmpdir(), 'extend-bwrap-probe-')); }
    catch { probeDir = mkdtempSync('/tmp/extend-bwrap-probe-'); }
  } catch { return null; }
  let seccompFd: number | undefined;
  try {
    // The probe uses the real launch's flags (seccomp on descriptor 3, a new session, the /proc key masks, the /var stack), so a
    // host that refuses one of them refuses here instead of failing every call.
    const programFile = join(probeDir, 'keyring.bpf');
    const emptyFile = join(probeDir, 'empty');
    writeFileSync(programFile, program, { mode: 0o600 });
    writeFileSync(emptyFile, '', { mode: 0o600 });
    seccompFd = openSync(programFile, 'r');
    const masks = ['/proc/keys', '/proc/key-users'].filter((path) => existsSync(path)).flatMap((path) => ['--ro-bind', emptyFile, path]);
    const res = spawnSync(bwrap, [
      '--unshare-all', '--share-net', '--die-with-parent', '--new-session', '--seccomp', '3',
      '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', ...masks,
      '--tmpfs', '/tmp', '--tmpfs', '/var', '--tmpfs', '/var/tmp', '--symlink', '../run', '/var/run', '--tmpfs', '/run',
      '--overlay-src', probeDir, '--tmp-overlay', probeDir,
      '--', '/bin/true',
    ], { stdio: ['ignore', 'ignore', 'ignore', seccompFd], timeout: 10_000 });
    return res.status === 0 && !res.error && !res.signal ? bwrap : null;
  } catch {
    return null;
  } finally {
    if (seccompFd !== undefined) { try { closeSync(seccompFd); } catch { /* already closed */ } }
    try { rmSync(probeDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

export function probeSandbox(deps: Deps = {}): boolean {
  return resolveSandboxBwrap(deps) !== null;
}

interface Prepared {
  config: DelegateConfig; sha: string; classify: Classifier; checklists: Record<string, string>; caught?: string;
  bwrap?: string; home?: string; privateDirs?: string[];
}
type Preparation = { ok: true; prepared: Prepared } | { ok: false; reason: RefusalReason; detail?: string };

/** Everything `check` establishes, in refusal order, with no model call. */
async function prepare(options: Options, deps: Deps = {}): Promise<Preparation> {
  const { root } = options;
  // A detail (which file, key or path is at fault) goes to stderr beside the one JSON line.
  const refuse = (reason: RefusalReason, detail?: string): Preparation => ({ ok: false, reason, ...(detail ? { detail } : {}) });
  const read = readTrusted(options.config, 'configuration');
  if (!read.ok) return /not found/.test(read.reason) ? refuse('config-missing') : refuse('config-malformed', read.reason);
  if (read.bytes.length > CONFIG_LIMIT) return refuse('config-malformed', `configuration is larger than ${CONFIG_LIMIT} bytes`);
  const parsed = validateConfig(read.bytes.toString('utf8'));
  if (!parsed.ok) return { ok: false, reason: parsed.reason, detail: parsed.detail };
  for (const part of options.parts) if (!parsed.config.parts[part]) return refuse('part-unmapped');

  const repoProviders = [...new Set(options.parts.map((part) => parsed.config.parts[part]!))]
    .map((label) => ({ label, provider: parsed.config.providers[label]! }))
    .filter(({ provider }) => provider.access === 'repo');
  let home: string | undefined;
  let privateDirs: string[] = [];
  let accountHomeOk = true;
  let homeOk = true;
  if (repoProviders.length > 0) {
    const rawHome = process.env.HOME;
    // An unusable HOME is a host fault, refused as sandbox-unavailable after the configuration's own checks.
    homeOk = !!rawHome && isAbsolute(rawHome) && !CONTROL_RE.test(rawHome) && !pathForms(resolve(rawHome)).includes('/');
    home = homeOk ? resolve(rawHome!) : undefined;
    const accountHome = (deps.accountHome ?? passwdHome)();
    // Without the account's home from the passwd database, an overridden HOME would leave the real home unhidden: refused below.
    // A passwd home of / (written or through a symlink) would leave every account-readable path under / unhidden.
    accountHomeOk = !!accountHome && isAbsolute(accountHome) && !CONTROL_RE.test(accountHome) && !pathForms(resolve(accountHome)).includes('/');
    const forms = pathForms;
    const homes = [...(home !== undefined ? [home] : []), ...(accountHomeOk ? [resolve(accountHome)] : [])]
      .flatMap(forms).filter((path) => path !== '/');
    const temp = forms(resolve(tmpdir())).filter((path) => path !== '/');
    // Every private directory beyond HOME gets its own tmpfs; one that does not exist holds nothing and could not take a mount point.
    privateDirs = [...new Set([...homes, ...temp])]
      .filter((path) => path !== home && !['/tmp', '/var', '/var/tmp', '/run'].includes(path) && existsSync(path));
    // The account's runtime dirs (session bus, agents): XDG_RUNTIME_DIR when set, and /run/user/<uid> whether or not it is.
    const xdg = runtimeDirFromEnv();
    const uid = process.getuid?.();
    const runtimeDirs = [...(xdg !== undefined ? [xdg] : []), ...(uid !== undefined ? [`/run/user/${uid}`] : [])].flatMap(forms);
    // Every directory the sandbox hides or replaces: the homes, the system roots, the runner's temporary directory and the runtime dirs.
    const hiddenRoots = [...new Set([...homes, ...temp, ...runtimeDirs,
      ...['/tmp', '/var', '/var/tmp', '/run', '/proc', '/dev', '/sys'].flatMap((path) => forms(path))])];
    // The reviewed repository and the calls directory: no listed path may sit at or inside them (that would show the live checkout).
    const repoPaths = [options.repo, options.calls].filter(Boolean).flatMap(forms);
    for (const { label, provider } of repoProviders) {
      const entries = provider.expose ?? [];
      const atOrAbove = (path: string, targets: string[]) => forms(path).some((form) => targets.some((target) => isWithin(form, target)));
      const atOrInside = (path: string, targets: string[]) => forms(path).some((form) => targets.some((target) => isWithin(target, form)));
      // A symlink below the deepest hidden root around a path vanishes with that tmpfs, so bwrap would mount or exec at the written
      // spelling; below a listed directory the overlay keeps it, so the walk starts at the deepest hidden root or listed directory.
      const symlinkVanishes = (path: string, listed: readonly string[]) => {
        const containers = [...hiddenRoots, ...listed].filter((dir) => dir !== path && isWithin(dir, path)).sort((x, y) => y.length - x.length);
        const deepest = containers[0];
        if (deepest === undefined || listed.includes(deepest)) return false;
        const parts = relative(deepest, path).split(sep);
        for (let i = 1; i < parts.length; i++) {
          try { if (lstatSync(join(deepest, ...parts.slice(0, i))).isSymbolicLink()) return true; } catch { return false; }
        }
        return false;
      };
      for (const entry of entries) {
        // A listed path may sit inside a hidden root, never at one or above one: that would show the whole root. Nothing may sit
        // inside a runtime dir (its session bus and agents) or inside the reviewed repository or the calls directory.
        const why = forms(entry).includes('/') || atOrAbove(entry, hiddenRoots) ? 'is at or above a directory the sandbox hides'
          : atOrInside(entry, runtimeDirs) ? 'is inside the account runtime directory'
          : atOrInside(entry, repoPaths) ? 'is at or inside the reviewed repository or the calls directory'
          : symlinkVanishes(entry, entries.filter((other) => other !== entry)) ? 'passes a symlink that a hidden directory would remove'
          : null;
        if (why) return refuse('config-malformed', `provider ${label} expose entry ${JSON.stringify(entry)} ${why}`);
      }
      // Every hop of argv[0]'s link chain that lies under a hidden root needs a listed path around it, with no vanishing symlink.
      const entryPaths = entries.map((entry) => realpathBelow(entry));
      const { hops, targets } = linkChain(provider.argv[0]!);
      // The sandbox hides the reviewed repository and the calls directory, so a command installed there could never start.
      if ([...hops, ...targets].some((hop) => repoPaths.some((path) => isWithin(path, hop)))) {
        return refuse('config-malformed', `provider ${label} argv[0] ${JSON.stringify(provider.argv[0])} lies inside the reviewed repository or `
          + 'the calls directory, which the sandbox hides');
      }
      const uncovered = hops.some((hop) => hiddenRoots.some((root) => isWithin(root, hop)) && !entryPaths.some((entry) => isWithin(entry, hop)));
      if (uncovered || [provider.argv[0]!, ...hops, ...targets].some((path) => symlinkVanishes(path, entries))) {
        return refuse('config-malformed', `provider ${label} argv[0] ${JSON.stringify(provider.argv[0])} needs an expose entry around its `
          + 'install under a hidden directory, reached without a symlink that directory would remove');
      }
    }
  }

  const entry = UPSTREAM_HELPERS.find((helper) => helper.name === 'classifyOutsideReview')!;
  let classify: unknown;
  try { classify = (await import(pathToFileURL(join(root, 'lib', `${entry.module}.ts`)).href))[entry.name]; } catch { classify = undefined; }
  if (typeof classify !== 'function') return refuse('helper-missing');

  // The runner checks its own anchors, so a part never runs partly applied even if the host skipped the check.
  const hasSpecialist = options.parts.some((part) => (SPECIALIST_PARTS as readonly string[]).includes(part));
  const hasAttacker = options.parts.some((part) => (ATTACKER_PARTS as readonly string[]).includes(part));
  const specialistInv = hasSpecialist ? delegateInventory(extendRoot()) : undefined;
  if (specialistInv && !specialistInv.ok) return refuse('checklist-anchor');
  const attackerInv = hasAttacker ? attackerInventory(extendRoot()) : undefined;
  if (attackerInv && !attackerInv.ok) return refuse('checklist-anchor');

  const checklists: Record<string, string> = {};
  for (const part of options.parts) {
    if (part === 'red-team') {
      const file = readTrusted(join(root, 'review', 'specialists', 'red-team.md'), 'red-team checklist');
      if (!file.ok || !attackerInv || !attackerInv.ok || !attackerInv['red-team'].every((anchor) => file.bytes.includes(Buffer.from(anchor, 'utf8')))) {
        return refuse('checklist-anchor');
      }
      checklists[part] = `${RED_TEAM_FRAMING}\n\n${file.bytes.toString('utf8')}`;
    } else if (part === 'adversarial') {
      const file = readTrusted(options.adversarial, 'adversarial instructions');
      if (!file.ok || !attackerInv || !attackerInv.ok || !attackerInv.adversarial.every((anchor) => file.bytes.includes(Buffer.from(anchor, 'utf8')))) {
        return refuse('checklist-anchor');
      }
      // List (b) in the skill's attacker paragraph: the prompt line, the framing line after it, then the criteria line.
      const [promptAnchor, framingAnchor, criteriaAnchor] = attackerInv.adversarial as [string, string, string];
      const extracted = extractAdversarialChecklist(file.bytes.toString('utf8'), promptAnchor, framingAnchor, criteriaAnchor);
      if (!extracted.ok) return refuse('checklist-anchor');
      checklists[part] = extracted.checklist;
    } else {
      const file = readTrusted(join(root, 'review', 'specialists', `${part}.md`), `${part} checklist`);
      if (!file.ok || !specialistInv || !specialistInv.ok || !specialistInv[part as SpecialistPart].every((anchor) => file.bytes.includes(Buffer.from(anchor, 'utf8')))) {
        return refuse('checklist-anchor');
      }
      checklists[part] = file.bytes.toString('utf8');
    }
  }
  let bwrap: string | undefined;
  if (repoProviders.length > 0) {
    // The platform first, so a host without bwrap support is not told its passwd database is at fault.
    if ((deps.platform ?? process.platform) !== 'linux') return refuse('sandbox-unavailable');
    if (!homeOk) return refuse('sandbox-unavailable', 'HOME must be an absolute path other than /, without control characters, for a repo-mode provider');
    if (!accountHomeOk) return refuse('sandbox-unavailable', 'the account home could not be read from the passwd database, or is /, so the sandbox cannot hide it');
    const resolvedBwrap = resolveSandboxBwrap(deps);
    if (!resolvedBwrap) return refuse('sandbox-unavailable');
    bwrap = resolvedBwrap;
  }
  let caught: string | undefined;
  if (options.command === 'run' && options.parts.includes('red-team')) {
    const caughtRead = readTrusted(options.caught, 'caught findings');
    if (!caughtRead.ok || caughtRead.bytes.length > CONFIG_LIMIT) return refuse('caught-unreadable');
    caught = caughtRead.bytes.toString('utf8');
  }
  return {
    ok: true,
    prepared: {
      config: parsed.config, sha: createHash('sha256').update(read.bytes).digest('hex'),
      classify: classify as Classifier, checklists,
      ...(caught !== undefined ? { caught } : {}),
      ...(bwrap !== undefined ? { bwrap } : {}),
      ...(home !== undefined ? { home: existsSync(home) ? home : '', privateDirs } : {}),
    },
  };
}

/** Hash HEAD, status, index entries and nonignored file bytes without following symlinks. */
function worktreeState(repo: string): string | undefined {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
  const git = (args: string[]) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' } });
  const status = git(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const head = git(['rev-parse', 'HEAD']);
  const index = git(['ls-files', '--stage', '-z']);
  const files = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  if ([status, head, index, files].some((result) => result.status !== 0)) return undefined;
  const hash = createHash('sha256');
  const add = (value: string | Buffer) => { hash.update(String(Buffer.byteLength(value))); hash.update(':'); hash.update(value); };
  for (const value of [head.stdout, status.stdout, index.stdout]) add(value);
  try {
    for (const name of [...new Set(files.stdout.split('\0').filter(Boolean))].sort()) {
      add(name);
      const components = name.split('/');
      try {
        // A replaced parent directory must not lead the read outside the repository.
        for (let i = 1; i < components.length; i++) if (lstatSync(join(repo, ...components.slice(0, i))).isSymbolicLink()) return undefined;
        const path = join(repo, name);
        const stat = lstatSync(path);
        add(String(stat.mode));
        if (stat.isSymbolicLink()) { add(readlinkSync(path, { encoding: 'buffer' })); continue; }
        if (!stat.isFile()) return undefined;
        const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          if (!fstatSync(fd).isFile()) return undefined;
          add(readFileSync(fd));
        } finally { closeSync(fd); }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return undefined;
        add('missing');
      }
    }
    return hash.digest('hex');
  } catch { return undefined; }
}

interface RepoSandboxSpec {
  bwrap: string;
  home: string;
  privateDirs: readonly string[];
  repo: string;
  base: string;
  candidate: string;
  calls: string;
  expose: readonly string[];
}

/** A repo-mode setup step that failed before the provider started; `timedOut` when the part's deadline ran out first. */
export class SetupFailure extends Error {
  constructor(readonly step: string, readonly timedOut = false) { super(step); }
}

/** Settle with the operation, or fail the setup step once the part's time runs out, so a stalled filesystem call cannot hold the part. */
export function withinDeadline<T>(start: () => Promise<T>, remainingMs: () => number, step: string): Promise<T> {
  const rem = remainingMs();
  // An expired deadline never starts the operation, so no later rejection of it can go unhandled.
  if (rem <= 0) return Promise.reject(new SetupFailure(step, true));
  const operation = start();
  return new Promise((resolveOp, rejectOp) => {
    const timer = setTimeout(() => rejectOp(new SetupFailure(step, true)), rem);
    operation.then((value) => { clearTimeout(timer); resolveOp(value); }, (error: unknown) => { clearTimeout(timer); rejectOp(error); });
  });
}

/**
 * Setup git runs with no GIT_* from the caller and no global or system configuration, so no host filter, hook or clone setting
 * applies: GIT_CONFIG_GLOBAL and GIT_CONFIG_NOSYSTEM, plus an empty HOME and XDG_CONFIG_HOME for a git older than 2.32.
 */
function setupGitEnv(emptyHome: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) if (value !== undefined && !name.startsWith('GIT_')) env[name] = value;
  // A relative PATH entry would resolve git from the working directory, so setup keeps absolute entries only.
  if (env.PATH !== undefined) env.PATH = env.PATH.split(':').filter((dir) => isAbsolute(dir)).join(':');
  return { ...env, HOME: emptyHome, XDG_CONFIG_HOME: emptyHome, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' };
}

/** One asynchronous git step under the part's remaining time, so a slow setup never stalls another part's deadline or output. */
function runSetupGit(args: string[], step: string, emptyHome: string, remainingMs: () => number, capture = false): Promise<string> {
  return new Promise((resolveGit, rejectGit) => {
    const rem = remainingMs();
    if (rem <= 0) { rejectGit(new SetupFailure(step, true)); return; }
    let proc: ReturnType<typeof spawn>;
    try { proc = spawn('git', args, { env: setupGitEnv(emptyHome), cwd: emptyHome, detached: true, stdio: ['ignore', capture ? 'pipe' : 'ignore', 'ignore'] }); }
    catch { rejectGit(new SetupFailure(step)); return; }
    let output = '';
    let expired = false, tooLong = false;
    const timer = setTimeout(() => { expired = true; try { if (proc.pid) process.kill(-proc.pid, 'SIGKILL'); } catch { /* already gone */ } }, rem);
    proc.stdout?.setEncoding('utf8');
    proc.stdout?.on('data', (chunk: string) => { if (output.length + chunk.length > STDOUT_LIMIT) tooLong = true; else output += chunk; });
    proc.on('error', () => { clearTimeout(timer); rejectGit(new SetupFailure(step)); });
    proc.on('close', (code, signal) => {
      clearTimeout(timer);
      if (expired || remainingMs() <= 0) rejectGit(new SetupFailure(step, true));
      else if (code !== 0 || signal || tooLong) rejectGit(new SetupFailure(step));
      else resolveGit(output);
    });
  });
}

/** Paths from `git worktree list --porcelain -z`: the main checkout and every linked worktree. */
export function parseWorktreeList(output: string): string[] {
  return output.split('\0').filter((field) => field.startsWith('worktree ')).map((field) => field.slice('worktree '.length)).filter(Boolean);
}

/**
 * Hide the real repository, stage the expose paths, and build the disposable copy: an empty repository that fetches only
 * the candidate and the base (frozen snapshot commits no ref reaches included), then checks it out detached with hooks and LFS filters off.
 */
async function prepareRepoCopy(spec: RepoSandboxSpec, cwd: string, remainingMs: () => number): Promise<SandboxInput> {
  const emptyHome = join(cwd, 'git-home');
  try { mkdirSync(emptyHome, { mode: 0o700 }); } catch { throw new SetupFailure('setup'); }
  const git = (args: string[], step: string, capture = false) => runSetupGit(args, step, emptyHome, remainingMs, capture);
  const rev = await git(['-C', spec.repo, 'rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir'], 'rev-parse', true);
  const lines = rev.replace(/\r\n/g, '\n').trimEnd().split('\n');
  if (lines.length !== 3 || lines.some((line) => !line)) throw new SetupFailure('rev-parse');
  const [top, gitDir, commonDir] = lines as [string, string, string];
  // NUL-separated porcelain (git 2.36 or later) is the only form that carries every path unambiguously; an older git fails setup.
  const worktrees = parseWorktreeList(await git(['-C', spec.repo, 'worktree', 'list', '--porcelain', '-z'], 'worktree-list', true));
  const hidden: string[] = [];
  const hide = (path: string) => {
    // A path that does not exist holds nothing to hide, and the read-only root could not take its mount point.
    if (!existsSync(path)) return;
    hidden.push(path);
    const real = realpathBelow(path);
    if (real !== path) hidden.push(real);
  };
  // Repository and worktree paths may sit on a network filesystem: check them asynchronously under the part's deadline, so a
  // stalled mount cannot block the event loop for every part.
  // A path that is absent, or behind an ancestor this account cannot search (so the sandbox cannot reach it either), needs no
  // mount; any other error (EIO, ESTALE, ELOOP) fails setup rather than leave a path the sandbox might still read unhidden.
  const absent = (error: unknown) => ['ENOENT', 'ENOTDIR', 'EACCES'].includes((error as NodeJS.ErrnoException)?.code ?? '');
  const hideRepoPath = async (path: string) => {
    const exists = await withinDeadline(() => access(path).then(() => true, (error: unknown) => {
      if (absent(error)) return false;
      throw new SetupFailure('worktree-list');
    }), remainingMs, 'worktree-list');
    if (!exists) return;
    hidden.push(path);
    const real = await withinDeadline(() => realpath(path).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return path;
      throw new SetupFailure('worktree-list');
    }), remainingMs, 'worktree-list');
    if (real !== path) hidden.push(real);
  };
  for (const path of [resolve(top), resolve(gitDir), resolve(spec.repo, commonDir), resolve(spec.calls), ...worktrees.map((tree) => resolve(tree))]) {
    await hideRepoPath(path);
  }
  // A listed path at or inside a hidden repository path (a linked worktree or the common git dir) would show the live checkout.
  // One above it is fine: the --tmpfs mounts over those paths come after every expose layer.
  const forms = pathForms;
  if (spec.expose.some((entry) => forms(entry).some((form) => hidden.some((path) => isWithin(path, form))))) {
    throw new SetupFailure('expose');
  }
  const xdg = runtimeDirFromEnv();
  const entriesUnderRun = spec.expose.some((path) => pathForms(path).some((form) => isWithin('/run', form)));
  const uid = process.getuid?.();
  if (entriesUnderRun && uid !== undefined) hide(`/run/user/${uid}`);
  if (xdg !== undefined) {
    // The /run tmpfs already hides a runtime dir that resolves under /run, unless an entry (in any spelling) brings part of /run
    // back; otherwise hide it in both spellings (hide() adds the resolved one).
    if (!isWithin('/run', realpathBelow(xdg)) || entriesUnderRun) hide(xdg);
  }
  let resolvDir: string | null = null;
  try {
    // The resolver configuration may live under /run or /var, both behind a tmpfs: bring back the file alone, read-only, since
    // the directories there hold daemons' sockets.
    const realResolv = realpathSync('/etc/resolv.conf');
    if (realResolv.startsWith('/run/') || realResolv.startsWith('/var/')) resolvDir = realResolv;
  } catch { resolvDir = null; }

  const expose: SandboxExpose[] = [];
  const stagedDir = join(cwd, 'staged');
  try {
    for (let i = 0; i < spec.expose.length; i++) {
      const entry = spec.expose[i]!;
      const stat = await withinDeadline(() => lstat(entry), remainingMs, 'expose');
      if (stat.isSymbolicLink()) throw new SetupFailure('expose');
      if (stat.isDirectory()) {
        expose.push({ kind: 'dir', path: entry });
      } else if (stat.isFile()) {
        mkdirSync(stagedDir, { recursive: true, mode: 0o700 });
        const staged = join(stagedDir, String(i));
        await withinDeadline(() => copyFile(entry, staged), remainingMs, 'expose');
        expose.push({ kind: 'file', path: entry, staged });
      } else {
        throw new SetupFailure('expose');
      }
    }
  } catch (error) { throw error instanceof SetupFailure ? error : new SetupFailure('expose'); }

  const copy = join(cwd, 'repo');
  await git(['init', '--quiet', '--template=', copy], 'init');
  // --update-shallow keeps a shallow source's boundary, so history commands work in the copy.
  await git(['-C', copy, '-c', 'core.hooksPath=/dev/null', 'fetch', '--quiet', '--no-tags', '--no-recurse-submodules', '--update-shallow',
    '--upload-pack=git -c uploadpack.allowAnySHA1InWant=true upload-pack', resolve(top), spec.candidate, ...(spec.base !== spec.candidate ? [spec.base] : [])], 'fetch');
  await git(['-C', copy, '-c', 'core.hooksPath=/dev/null', '-c', 'filter.lfs.process=', '-c', 'filter.lfs.smudge=', '-c', 'filter.lfs.required=false',
    'checkout', '--quiet', '--detach', spec.candidate], 'checkout');
  const emptyFile = join(cwd, 'empty');
  try { writeFileSync(emptyFile, '', { mode: 0o600 }); } catch { throw new SetupFailure('setup'); }
  // A kernel without CONFIG_KEYS has neither file, and bwrap cannot create a mount point inside procfs.
  const procMasks = ['/proc/keys', '/proc/key-users'].filter((path) => existsSync(path));
  return { home: spec.home, privateDirs: spec.privateDirs, hidden, resolvDir, expose, copy, emptyFile, procMasks };
}

/** One process in its own group, an empty private cwd (or a bubblewrap-sandboxed copy), an allowlisted env and bounded output. */
function spawnProvider(argv: string[], prompt: string, timeoutS: number, repoSpec?: RepoSandboxSpec): Promise<Spawned> {
  return new Promise((settle) => {
    const started = Date.now();
    const remainingMs = () => timeoutS * 1000 - (Date.now() - started);
    let cwd: string;
    try { cwd = mkdtempSync(join(tmpdir(), 'extend-delegate-')); }
    catch {
      settle({ exit_code: null, signal: null, timed_out: false, overflow: false, spawn_error: true,
        stdout: '', stderr: '', wall_ms: Date.now() - started });
      return;
    }
    const env: Record<string, string> = {};
    for (const key of CHILD_ENV) if (process.env[key] !== undefined) env[key] = process.env[key]!;
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outSize = 0, errSize = 0;
    let timedOut = false, overflow = false, spawnError = false, finished = false;
    let setupNote = '';
    let grace: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let child: ReturnType<typeof spawn> | undefined;
    let seccompFd: number | undefined;
    const killGroup = () => { try { if (child?.pid) process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } };
    const finish = (code: number | null, signal: string | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      clearTimeout(grace);
      child?.stdout?.destroy();
      child?.stderr?.destroy();
      if (seccompFd !== undefined) { try { closeSync(seccompFd); } catch { /* already closed */ } }
      // Asynchronous cleanup, so removing a large copy never delays another part's deadline or output handling.
      const cleanup = async () => {
        try { await rm(cwd, { recursive: true, force: true }); return; } catch { /* make it writable, then retry */ }
        await new Promise<void>((done) => {
          const chmod = firstExisting(CHMOD_PATHS);
          if (!chmod) { done(); return; }
          try { execFile(chmod, ['-R', 'u+rwx', cwd], { timeout: 10_000, killSignal: 'SIGKILL', cwd: '/' }, () => done()); } catch { done(); }
        });
        try { await rm(cwd, { recursive: true, force: true }); } catch { spawnError = true; }
      };
      // A stalled removal (a hung filesystem) is not awaited past the limit: the part settles as failed and the root may remain.
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      const limit = new Promise<void>((done) => { cleanupTimer = setTimeout(() => { spawnError = true; done(); }, CLEANUP_LIMIT_MS); });
      void Promise.race([cleanup(), limit]).then(() => clearTimeout(cleanupTimer)).then(() => settle({ exit_code: timedOut ? TIMEOUT_EXIT : code, signal: timedOut ? null : signal, timed_out: timedOut, overflow,
        spawn_error: spawnError, stdout: Buffer.concat(out, outSize).toString('utf8'), stderr: setupNote + Buffer.concat(err, errSize).toString('utf8'),
        wall_ms: Date.now() - started }));
    };
    const launch = (command: string, args: string[], extraFd?: number) => {
      const rem = remainingMs();
      if (rem <= 0) {
        timedOut = true;
        finish(null, null);
        return;
      }
      deadline = setTimeout(() => { timedOut = true; killGroup(); }, rem);
      try {
        child = spawn(command, args, { cwd, env, detached: true, stdio: extraFd !== undefined ? ['pipe', 'pipe', 'pipe', extraFd] : ['pipe', 'pipe', 'pipe'] });
      } catch {
        spawnError = true;
        finish(null, null);
        return;
      }
      child.stdout!.on('data', (chunk: Buffer) => {
        if (outSize + chunk.length > STDOUT_LIMIT) { overflow = true; killGroup(); return; }
        out.push(chunk);
        outSize += chunk.length;
      });
      child.stderr!.on('data', (chunk: Buffer) => {
        const room = STDERR_LIMIT - errSize;
        if (room <= 0) return;
        err.push(chunk.subarray(0, room));
        errSize += Math.min(room, chunk.length);
      });
      child.stdin!.on('error', () => { /* the delegate may close stdin early */ });
      child.stdin!.end(prompt);
      child.on('error', () => { spawnError = true; finish(null, null); });
      child.on('close', (code, signal) => finish(code, signal));
      child.on('exit', (code, signal) => { grace = setTimeout(() => finish(code, signal), 250); });
    };
    if (!repoSpec) {
      launch(argv[0]!, argv.slice(1));
      return;
    }
    prepareRepoCopy(repoSpec, cwd, remainingMs).then((input) => {
      env.TMPDIR = '/tmp';
      // The working directory is the reviewed copy, so an empty or relative PATH entry would resolve commands from it.
      if (env.PATH !== undefined) env.PATH = env.PATH.split(':').filter((dir) => isAbsolute(dir)).join(':');
      // The keyring seccomp program reaches bwrap as descriptor 3 (prepare() refused an architecture without one).
      const program = keyringSeccomp(process.arch)!;
      try {
        const file = join(cwd, 'keyring.bpf');
        writeFileSync(file, program, { mode: 0o600 });
        seccompFd = openSync(file, 'r');
      } catch {
        spawnError = true;
        setupNote = 'review-delegate: repo-mode setup failed (seccomp)\n';
        finish(null, null);
        return;
      }
      launch(repoSpec.bwrap, [...sandboxArgs({ ...input, seccompFd: 3 }), '--', ...argv], seccompFd);
    }, (error: unknown) => {
      const failure = error instanceof SetupFailure ? error : new SetupFailure('setup');
      if (failure.timedOut) timedOut = true;
      else spawnError = true;
      setupNote = `review-delegate: repo-mode setup failed (${failure.step}${failure.timedOut ? ': timeout' : ''})\n`;
      finish(null, null);
    });
  });
}

const isSpawned = (value: any): value is Spawned =>
  !!value && typeof value === 'object' && typeof value.stdout === 'string' && typeof value.stderr === 'string' && typeof value.wall_ms === 'number'
  && typeof value.timed_out === 'boolean' && typeof value.overflow === 'boolean' && typeof value.spawn_error === 'boolean'
  && (value.exit_code === null || Number.isInteger(value.exit_code)) && (value.signal === null || typeof value.signal === 'string');

interface Saved { v: 1; spawned: Spawned; worktree_changed: boolean }
const isSaved = (value: any): value is Saved => value?.v === 1 && isSpawned(value.spawned) && typeof value.worktree_changed === 'boolean';
interface PendingPart { result: PartResult; save?: { path: string; spawned: Spawned } }

const NO_CALL = { replay: false, dispatched: false, dispatched_at: null, returned_at: null, wall_ms: null,
  input_tokens: null, output_tokens: null, cache_read_input_tokens: null, cache_creation_input_tokens: null,
  parse: 'not-applicable', verdict: 'unavailable' as string, outcome: 'fell-back' as const, findings: [] };

async function runPart(part: Part, prepared: Prepared, options: Options, diff: string): Promise<PendingPart> {
  const label = prepared.config.parts[part]!;
  const provider = prepared.config.providers[label]!;
  const access = provider.access ?? 'diff';
  const prompt = buildPrompt(part, options.base, options.candidate, diff, prepared.checklists[part]!, part === 'red-team' ? prepared.caught : undefined, access);
  const id = callId(prompt, provider, label);
  const identity = { part, provider: label, model: provider.model, call_id: id };
  const saved = join(options.calls, `${id}.json`);
  const claim = join(options.calls, `${id}.claim`);
  const fellBack = (fallback_reason: PartResult['fallback_reason'], replay = false): PendingPart => ({ result: { ...identity, ...NO_CALL, replay, fallback_reason } });
  let spawned: Spawned;
  let replay = false;
  let dispatchedAt: string | null = null;
  let returnedAt: string | null = null;
  let changed = false;
  if (existsSync(saved)) {
    // A saved result replays with no spawn, for credited and fell-back parts alike.
    let value: unknown;
    try { value = JSON.parse(readFileSync(saved, 'utf8')); } catch { value = undefined; }
    if (!isSaved(value)) return fellBack('failed', true);
    spawned = value.spawned;
    changed = value.worktree_changed;
    replay = true;
  } else {
    // The claim is never removed: unknown completion never licenses another call.
    try { writeFileSync(claim, claimBody(id, part, new Date().toISOString(), prompt), { flag: 'wx', mode: 0o600 }); }
    catch (error) { return fellBack((error as NodeJS.ErrnoException).code === 'EEXIST' ? 'unresolved-claim' : 'failed'); }
    dispatchedAt = new Date().toISOString();
    const repoSpec: RepoSandboxSpec | undefined = access === 'repo'
      ? { bwrap: prepared.bwrap!, home: prepared.home!, privateDirs: prepared.privateDirs ?? [], repo: options.repo, base: options.base, candidate: options.candidate, calls: options.calls,
        expose: provider.expose ?? [] }
      : undefined;
    spawned = await spawnProvider(provider.argv, prompt, provider.timeout_s, repoSpec);
    returnedAt = new Date().toISOString();
  }
  const verdict = decide(part, spawned, prepared.classify);
  const result: PartResult = { ...identity, replay, dispatched: !replay, dispatched_at: dispatchedAt, returned_at: returnedAt, wall_ms: spawned.wall_ms,
    ...verdict.tokens, parse: verdict.parse, verdict: verdict.verdict, outcome: verdict.outcome, fallback_reason: verdict.fallback_reason, findings: verdict.findings };
  if (changed) Object.assign(result, { outcome: 'fell-back', fallback_reason: 'worktree-changed', findings: [] });
  // Persist only after all parallel calls have passed the shared mutation check.
  return { result, ...(!replay ? { save: { path: saved, spawned } } : {}) };
}

export function help() {
  return `review-delegate — run named review specialist and attacker parts through caller-configured provider commands

Usage: review-delegate check --config FILE --gstack-root DIR --parts P[,P...] [--adversarial FILE]
       review-delegate run --config FILE --gstack-root DIR --parts P[,P...] --repo DIR --base SHA --candidate SHA --calls DIR [--adversarial FILE] [--caught FILE]
       review-delegate --help

Parts: ${PARTS.join(', ')} (each at most once). Every other review part stays on the host model.
  --config FILE       absolute path of a review-delegates/v1 JSON file (at most 64 KiB)
                      A provider may set "access": "repo" (with optional throwaway "expose" paths) for a bubblewrap-sandboxed clone on Linux; see docs/delegated-review.md.
  --gstack-root DIR   absolute path of the installed gstack root the review uses (its review/specialists and lib are read)
  --repo DIR          absolute path of the repository under review (run only)
  --base, --candidate full SHAs of the frozen scope's endpoints (run only)
  --calls DIR         absolute private directory for call claims and saved results, outside --repo (run only)
  --adversarial FILE  absolute path of the adversarial instructions file (required when --parts includes adversarial)
  --caught FILE       absolute path of the already-caught findings file outside --repo, at most 64 KiB (run only; required when --parts includes red-team)

Output (stdout, one JSON line):
  check: {"v":1,"status":"ok","config_sha256":...,"parts":[{"part","provider","model"}]} (adds "access":"repo" for repo-mode parts)
         {"v":1,"status":"refused","reason":"config-missing|config-malformed|part-unmapped|helper-missing|checklist-anchor|sandbox-unavailable"}
  run:   {"v":1,"status":"ran","config_sha256":...,"parts":[...]} or the same refused form (also reasons caught-unreadable and repo-unreadable)
Exit: 0 every part credited; 4 a part fell back to the host; 1 refused before any call, or the work tree changed
      during the calls; 2 usage error (stdout empty; "ERROR USAGE: ..." and "FIX: ..." on stderr).
Docs: docs/delegated-review.md
`;
}

export async function main(argv: string[], io: CliIo, deps: Deps = {}): Promise<number> {
  let options: ReturnType<typeof parseArgs>;
  try { options = parseArgs(argv); } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    io.stderr(`ERROR USAGE: ${error.message}\nFIX: ${error.fix}; see review-delegate --help\n`);
    return EXIT.usage;
  }
  if (options === 'help') { io.stdout(help()); return EXIT.ok; }
  const print = (value: object) => io.stdout(`${JSON.stringify({ v: 1, ...value })}\n`);
  const prepared = await prepare(options, deps);
  if (!prepared.ok) {
    print({ status: 'refused', reason: prepared.reason });
    // The detail (which file, key, value or path is at fault) goes to stderr; stdout keeps its one JSON line.
    if (prepared.detail) io.stderr(`review-delegate: ${prepared.reason}: ${prepared.detail}\n`);
    return EXIT.refused;
  }
  const { config, sha } = prepared.prepared;
  if (options.command === 'check') {
    print({
      status: 'ok',
      config_sha256: sha,
      parts: options.parts.map((part) => {
        const label = config.parts[part]!;
        const provider = config.providers[label]!;
        return {
          part,
          provider: label,
          model: provider.model,
          ...(provider.access === 'repo' ? { access: 'repo' as const } : {}),
        };
      }),
    });
    return EXIT.ok;
  }

  const before = worktreeState(options.repo);
  let diff: string | undefined;
  try { diff = snapshotDiff({ repo: options.repo, base: options.base, candidate: options.candidate, scope: 'full' } as Request); } catch { diff = undefined; }
  if (before === undefined || diff === undefined) { print({ status: 'refused', reason: 'repo-unreadable' }); return EXIT.refused; }
  mkdirSync(options.calls, { recursive: true, mode: 0o700 });
  const pending = await Promise.all(options.parts.map((part) => runPart(part, prepared.prepared, options, diff)));
  const results = pending.map((part) => part.result);
  const changed = worktreeState(options.repo) !== before;
  if (changed) {
    // Criterion: a delegate writes nothing in the work tree. Discard what this run dispatched; the host decides what next.
    for (const result of results) {
      if (result.dispatched) Object.assign(result, { outcome: 'fell-back', fallback_reason: 'worktree-changed', findings: [] });
    }
  }
  for (const { save } of pending) if (save) {
    const value: Saved = { v: 1, spawned: save.spawned, worktree_changed: changed };
    try { writeFileSync(save.path, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); } catch { /* the claim still blocks a resend */ }
  }
  print({ status: 'ran', config_sha256: sha, parts: results });
  return changed || results.some((result) => result.fallback_reason === 'worktree-changed') ? EXIT.refused
    : results.some((result) => result.outcome === 'fell-back') ? EXIT.fellBack : EXIT.ok;
}

if (import.meta.main) {
  // Each write's own callback marks its bytes handed to the OS. An empty write's callback can fire while earlier output is still
  // queued for a pipe, so exiting after one would cut a result line longer than the pipe buffer.
  let written: Promise<unknown> = Promise.resolve();
  const writer = (stream: NodeJS.WriteStream) => (text: string) => {
    written = Promise.all([written, new Promise<void>((done) => { stream.write(text, () => done()); })]);
  };
  const io = { stdout: writer(process.stdout), stderr: writer(process.stderr) };
  const code = await main(process.argv.slice(2), io).catch(() => {
    io.stderr('review-delegate failed internally: rerun check, and never retry an unresolved claim.\n');
    return 1;
  });
  // A filesystem call still stalled past its limit (cleanup or staging) must not keep the process alive after the result is delivered.
  await written;
  process.exit(code);
}
