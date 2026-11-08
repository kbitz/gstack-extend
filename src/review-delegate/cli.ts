/**
 * review-delegate: runs named `/review-and-prep` specialist parts through the
 * provider commands a caller configures. `check` validates without any call;
 * `run` makes one bounded, read-only call per part and reports which parts the
 * host must run itself. Contract and recovery: docs/delegated-review.md.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { UPSTREAM_HELPERS } from '../outside-review/cli';
import { snapshotDiff, type Request } from '../outside-review/prompt';
import type { Classifier } from '../outside-review/recovery';
import { attackerInventory, delegateInventory, extendRoot, readTrusted } from '../upstream-check/cli';
import {
  ATTACKER_PARTS, CONFIG_LIMIT, PARTS, RED_TEAM_FRAMING, SPECIALIST_PARTS, STDERR_LIMIT, STDOUT_LIMIT, TIMEOUT_EXIT, buildPrompt, callId, claimBody, decide, extractAdversarialChecklist, validateConfig,
  type DelegateConfig, type Part, type PartResult, type RefusalReason, type SpecialistPart, type Spawned,
} from './delegate';

export const EXIT = { ok: 0, refused: 1, usage: 2, fellBack: 4 } as const;
const CHILD_ENV = ['HOME', 'PATH', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ'] as const;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

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
    tail.push(head.slice(parent.length + 1));
    head = parent;
  }
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
    if (CONTROL.test(value)) throw new UsageError(`${flag} contains a control character`, `pass a plain value for ${flag}`);
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
  const repo = seen.get('--repo');
  const calls = seen.get('--calls');
  const caught = seen.get('--caught');
  if (repo !== undefined) {
    // A claim or caught-findings file inside the work tree would read as a write by the delegate or mix with reviewed files.
    let top = resolve(repo);
    try { top = realpathSync(top); } catch { /* reported as repo-unreadable */ }
    for (const [flag, target, label] of [['--calls', calls, 'calls directory'], ['--caught', caught, 'caught file']] as const) {
      if (target === undefined) continue;
      const rel = relative(top, realpathBelow(resolve(target)));
      if (!rel || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) {
        throw new UsageError(`${flag} is inside --repo`, `pass a ${label} outside the repository under review`);
      }
    }
  }
  return { command, config: resolve(seen.get('--config')!), root: resolve(seen.get('--gstack-root')!), parts: parts as Part[],
    repo: repo ?? '', base: seen.get('--base') ?? '', candidate: seen.get('--candidate') ?? '', calls: calls ?? '',
    adversarial: seen.get('--adversarial') ? resolve(seen.get('--adversarial')!) : '',
    caught: caught ? resolve(caught) : '' };
}

interface Prepared {
  config: DelegateConfig; sha: string; classify: Classifier; checklists: Record<string, string>; caught?: string;
}
type Preparation = { ok: true; prepared: Prepared } | { ok: false; reason: RefusalReason };

/** Everything `check` establishes, in refusal order, with no model call. */
async function prepare(options: Options): Promise<Preparation> {
  const { root } = options;
  const refuse = (reason: RefusalReason): Preparation => ({ ok: false, reason });
  const read = readTrusted(options.config, 'configuration');
  if (!read.ok) return refuse(/not found/.test(read.reason) ? 'config-missing' : 'config-malformed');
  if (read.bytes.length > CONFIG_LIMIT) return refuse('config-malformed');
  const parsed = validateConfig(read.bytes.toString('utf8'));
  if (!parsed.ok) return refuse(parsed.reason);
  for (const part of options.parts) if (!parsed.config.parts[part]) return refuse('part-unmapped');

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
  let caught: string | undefined;
  if (options.command === 'run' && options.parts.includes('red-team')) {
    const caughtRead = readTrusted(options.caught, 'caught findings');
    if (!caughtRead.ok || caughtRead.bytes.length > CONFIG_LIMIT) return refuse('caught-unreadable');
    caught = caughtRead.bytes.toString('utf8');
  }
  return { ok: true, prepared: { config: parsed.config, sha: createHash('sha256').update(read.bytes).digest('hex'), classify: classify as Classifier, checklists, ...(caught !== undefined ? { caught } : {}) } };
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

/** One process in its own group, an empty private cwd, an allowlisted env and bounded output. */
function spawnProvider(argv: string[], prompt: string, timeoutS: number): Promise<Spawned> {
  return new Promise((settle) => {
    const started = Date.now();
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
    let grace: ReturnType<typeof setTimeout> | undefined;
    let child: ReturnType<typeof spawn>;
    const killGroup = () => { try { if (child?.pid) process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } };
    const finish = (code: number | null, signal: string | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      clearTimeout(grace);
      child?.stdout?.destroy();
      child?.stderr?.destroy();
      try { rmSync(cwd, { recursive: true, force: true }); } catch { spawnError = true; }
      settle({ exit_code: timedOut ? TIMEOUT_EXIT : code, signal: timedOut ? null : signal, timed_out: timedOut, overflow, spawn_error: spawnError,
        stdout: Buffer.concat(out, outSize).toString('utf8'), stderr: Buffer.concat(err, errSize).toString('utf8'), wall_ms: Date.now() - started });
    };
    const deadline = setTimeout(() => { timedOut = true; killGroup(); }, timeoutS * 1000);
    try {
      child = spawn(argv[0]!, argv.slice(1), { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
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
  const prompt = buildPrompt(part, options.base, options.candidate, diff, prepared.checklists[part]!, part === 'red-team' ? prepared.caught : undefined);
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
    spawned = await spawnProvider(provider.argv, prompt, provider.timeout_s);
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
  --gstack-root DIR   absolute path of the installed gstack root the review uses (its review/specialists and lib are read)
  --repo DIR          absolute path of the repository under review (run only)
  --base, --candidate full SHAs of the frozen scope's endpoints (run only)
  --calls DIR         absolute private directory for call claims and saved results, outside --repo (run only)
  --adversarial FILE  absolute path of the adversarial instructions file (required when --parts includes adversarial)
  --caught FILE       absolute path of the already-caught findings file outside --repo, at most 64 KiB (run only; required when --parts includes red-team)

Output (stdout, one JSON line):
  check: {"v":1,"status":"ok","config_sha256":...,"parts":[{"part","provider","model"}]}
         {"v":1,"status":"refused","reason":"config-missing|config-malformed|part-unmapped|helper-missing|checklist-anchor"}
  run:   {"v":1,"status":"ran","config_sha256":...,"parts":[...]} or the same refused form (also reasons caught-unreadable and repo-unreadable)
Exit: 0 every part credited; 4 a part fell back to the host; 1 refused before any call, or the work tree changed
      during the calls; 2 usage error (stdout empty; "ERROR USAGE: ..." and "FIX: ..." on stderr).
Docs: docs/delegated-review.md
`;
}

export async function main(argv: string[], io: CliIo): Promise<number> {
  let options: ReturnType<typeof parseArgs>;
  try { options = parseArgs(argv); } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    io.stderr(`ERROR USAGE: ${error.message}\nFIX: ${error.fix}; see review-delegate --help\n`);
    return EXIT.usage;
  }
  if (options === 'help') { io.stdout(help()); return EXIT.ok; }
  const print = (value: object) => io.stdout(`${JSON.stringify({ v: 1, ...value })}\n`);
  const prepared = await prepare(options);
  if (!prepared.ok) { print({ status: 'refused', reason: prepared.reason }); return EXIT.refused; }
  const { config, sha } = prepared.prepared;
  if (options.command === 'check') {
    print({ status: 'ok', config_sha256: sha, parts: options.parts.map((part) => ({ part, provider: config.parts[part]!, model: config.providers[config.parts[part]!]!.model })) });
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
  process.exitCode = await main(process.argv.slice(2), { stdout: (t) => process.stdout.write(t), stderr: (t) => process.stderr.write(t) })
    .catch(() => {
      console.error('review-delegate failed internally: rerun check, and never retry an unresolved claim.');
      return 1;
    });
}
