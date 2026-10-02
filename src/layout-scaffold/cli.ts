import { join, resolve } from 'node:path';
import { apply } from './apply.ts';
import { childEnv, createGit, defaultGitSpawn, type GitSpawn } from './git.ts';
import { buildPlan, countLines, defaultAudit, planLines, refusalLines, type Audit, type Options, type Plan } from './plan.ts';
import { bindRoot, defaultFs, escapeValue, Refusal, REFUSAL_ACTIONS, type FileSystem } from './root.ts';

// All three launcher flags first coexist in Bun 1.3.3's src/cli/Arguments.zig.
// https://github.com/oven-sh/bun/blob/bun-v1.3.3/src/cli/Arguments.zig
export const BUN_FLOOR = '1.3.3';
export const EXIT_CODES = [0, 1, 2, 3, 4, 5] as const;
export type CliIo = {
  stdout(text: string): void;
  stderr(text: string): void;
  cwd: string;
  env: NodeJS.ProcessEnv;
  fs: FileSystem;
  git: GitSpawn;
  audit: Audit;
};
export function parseArgs(argv: string[]): Options {
  if (argv[0] !== 'plan' && argv[0] !== 'apply') throw new Error('expected plan or apply');
  const options: Options = { command: argv[0], scaffoldOnly: false, excludes: [], authorize: false };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--scaffold-only') options.scaffoldOnly = true;
    else if (arg === '--authorize-external') options.authorize = true;
    else if (arg === '--root' || arg === '--plan-id' || arg === '--exclude') {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      if (arg === '--root') { if (options.root !== undefined) throw new Error('duplicate --root'); options.root = value; }
      else if (arg === '--plan-id') { if (options.planId !== undefined) throw new Error('duplicate --plan-id'); options.planId = value; }
      else options.excludes.push(value);
    } else throw new Error(`unknown argument ${arg}`);
  }
  if (options.planId !== undefined && !/^[0-9a-f]{64}$/.test(options.planId)) throw new Error('--plan-id must be 64 lowercase hex characters');
  if (options.command === 'plan' && (options.authorize || options.planId !== undefined)) throw new Error('--authorize-external and --plan-id belong to apply');
  if (options.scaffoldOnly && options.excludes.length) throw new Error('--scaffold-only cannot be combined with --exclude');
  if (options.command === 'apply' && !options.planId && (!options.scaffoldOnly || options.authorize)) throw new Error('apply requires --plan-id (except scaffold-only without authorization)');
  return options;
}

export function help(): string {
  return `layout-scaffold — plan, preflight and apply canonical documentation layout
Requires Bun >= ${BUN_FLOOR} (--no-env-file --no-install --config=/dev/null).

Usage:
  layout-scaffold plan [--root DIR] [--scaffold-only] [--exclude SRC]...
  layout-scaffold apply [--root DIR] [--scaffold-only] [--exclude SRC]... --plan-id HEX [--authorize-external]
  layout-scaffold --help | -h | --version

Quick start from a checkout:
  bin/layout-scaffold plan --root /path/to/project
  bin/layout-scaffold apply --root /path/to/project --plan-id <PLAN_ID>
Installed helper (set _EXTEND_ROOT to the installation path):
  "$_EXTEND_ROOT/bin/layout-scaffold" plan --root /path/to/project
  "$_EXTEND_ROOT/bin/layout-scaffold" apply --root /path/to/project --plan-id <PLAN_ID>

Four-step caller flow: plan, show the plan to the user, confirm, apply with
that id. Apply recomputes the plan and refuses drift as STATUS: stale.
There is no --json output and no caller-supplied move list.
--root binds one existing project root (defaults to Git toplevel); plain
directories require explicit --root. The filesystem root and HOME refuse.
--exclude SRC is repeatable and matches an exact audit source. Exclusions
are part of the id; pass the same exclusions to apply. They escape item
refusals and are listed under Excluded; unmatched sources refuse.
Values after --root and --exclude are literal, including names beginning with --.
--scaffold-only creates docs/, docs/designs/ and docs/archive/ without
checking moves. One-shot caller: layout-scaffold apply --root DIR --scaffold-only
may omit --plan-id; a supplied id is always checked. Excludes are unsupported.

Authorized scaffold-only sequence:
  layout-scaffold plan --root DIR --scaffold-only
  layout-scaffold apply --root DIR --scaffold-only --plan-id <PLAN_ID> --authorize-external
  layout-scaffold plan --root DIR --scaffold-only
The last plan still needs authorization for external canonical directories,
because the caller writes beneath them next. In full mode, an existing
external directory with no planned write is listed as External (no write).
--authorize-external is argv-only and always requires --plan-id. It authorizes
exactly the requested → resolved pairs shown for that plan and never waives
another refusal. The helper cannot verify that a human wrote the authorization;
the calling skill must ask the user. Env, files and stdin cannot authorize.

Contract (first match): usage, stale, refused, needs-authorization, ok/applied.
Exactly one STATUS line follows parsed runs. Plan prints PLAN_ID only if a
plan computed. Apply never prints PLAN_ID. BLOCKED and EXCLUDED appear together
only with a computed plan, except stale (which has neither). STATUS: applied
with BLOCKED: 0 and EXCLUDED: 0 means every item in view is done. Not scanned
directories remain outside that view. Post-apply findings use no audit STATUS lines.
Plan, refusals and summaries go to stdout; usage and shim errors go to stderr.

Exit codes:
  0: plan ok, apply applied, help or version
  1: refused before writes, or stale (run plan again and get a new confirmation)
  2: usage error (ERROR usage: / FIX:, no STATUS)
  3: needs-authorization, nothing written (plan or apply)
  4: partial after a mutation attempt, or incomplete after the post-apply check
  5: launcher error (ERROR bun_missing|bun_not_absolute|source_missing|symlink_loop: / FIX:)
A run with no STATUS line (launcher error, Bun crash or signal) leaves the tree
in an unknown state: run plan before anything else.

Moves: git mv stages tracked items; move leaves untracked/plain items unstaged.
Cross-device untracked moves copy exclusively and preserve mtime when possible.
Blocked items include inbox imports, collisions, half-finished moves and names
with control/format characters, line separators, CGJ, variation selectors or
U+FFFD. This also blocks legitimate ZWNJ, ZWJ and emoji variation selectors:
move those names by hand. Display escapes hidden characters and backslashes.
Design-doc moves are heuristic (mermaid/plantuml fence); relative links and
image references are not checked. Use --exclude to leave a move for manual work.

Threat model: hostile repository content (filenames, symlinks, nested repos,
submodules, bunfig.toml, .env, inherited GIT_*) and mistakes by a well-meaning
agent. A compromised agent and concurrent filesystem changes are outside it.
Preflight is check-then-act, not atomic: a concurrent change after the last
check can still alter a path. Writes are not a transaction; there is no rollback.
partial: run plan for remaining work; rmdir empty directories to undo.
incomplete: review unexpected findings and run plan again.

Refusal codes and next actions:
${Object.entries(REFUSAL_ACTIONS).map(([code, action]) => `  ${code}: ${action}`).join('\n')}
`;
}

export function main(argv: string[], overrides: Partial<CliIo> = {}): number {
  const io: CliIo = { stdout: text => { process.stdout.write(text); }, stderr: text => { process.stderr.write(text); },
    cwd: process.cwd(), env: process.env, fs: defaultFs, git: defaultGitSpawn, audit: defaultAudit, ...overrides };
  const print = (lines: string[]) => io.stdout(`${lines.join('\n')}\n`);
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0]!)) { io.stdout(help()); return 0; }
  if (argv.length === 1 && argv[0] === '--version') {
    print([`layout-scaffold ${escapeValue(io.fs.readFileSync(join(import.meta.dir, '../../VERSION')).toString('utf8').trim())}`]); return 0;
  }
  let options: Options;
  try { options = parseArgs(argv); }
  catch (error) {
    io.stderr(`ERROR usage: ${escapeValue((error as Error).message)}\nFIX: see layout-scaffold --help\n`); return 2;
  }
  let plan: Plan | undefined;
  let root = options.root ?? io.cwd;
  let mutationPhase = false;
  try {
    const git = createGit(io.env, io.git, io.fs);
    const bound = bindRoot(options.root, io.cwd, io.env, io.fs, git);
    root = bound.path;
    plan = buildPlan(bound, options, io.audit, io.fs, git);
    if (options.command === 'apply' && options.planId && options.planId !== plan.id) {
      print([...refusalLines([new Refusal('plan_id_stale', root, 'plan changed since confirmation')], root), 'STATUS: stale']); return 1;
    }
    const externalWrite = plan.external.some(pair => pair.write);
    if (options.authorize && !externalWrite) plan.refusals.push(new Refusal('authorize_without_external', root, 'plan has no external write target'));
    print(planLines(plan));
    if (plan.refusals.length) {
      print([...countLines(plan), ...(options.command === 'plan' ? [`PLAN_ID: ${plan.id}`] : []), 'STATUS: refused']); return 1;
    }
    if (externalWrite && !options.authorize) {
      print([`Helper: ${escapeValue(resolve(import.meta.dir, '../../bin/layout-scaffold'))}`,
        'Next: show the external pairs to the user; confirmation requires --authorize-external with the matching --plan-id',
        ...countLines(plan), ...(options.command === 'plan' ? [`PLAN_ID: ${plan.id}`] : []), 'STATUS: needs-authorization']); return 3;
    }
    if (options.command === 'plan') {
      print(['Next: show the plan to the user and get confirmation before apply', ...countLines(plan), `PLAN_ID: ${plan.id}`, 'STATUS: ok']); return 0;
    }
    const result = apply(plan, io.fs, git, io.audit, () => { mutationPhase = true; });
    print([...result.lines, ...countLines(plan), `STATUS: ${result.status}`]); return result.exitCode;
  } catch (error) {
    if (mutationPhase) {
      print(['Apply summary:', `Failed: ${escapeValue(errnoFor(error))}`, 'Next: run plan for the remaining work; rmdir empty directories to undo',
        ...(plan ? countLines(plan) : []), 'STATUS: partial']); return 4;
    }
    const refusal = error instanceof Refusal ? error : new Refusal('internal_error', root, errnoFor(error));
    if (!(error instanceof Refusal)) io.stderr(`${escapeValue((error as Error).stack ?? String(error))}\n`);
    print([...refusalLines([refusal], root), ...(plan ? countLines(plan) : []),
      ...(plan && options.command === 'plan' ? [`PLAN_ID: ${plan.id}`] : []), 'STATUS: refused']); return 1;
  }
}
function errnoFor(error: unknown): string { return (error as Error)?.message ?? String(error); }

if (import.meta.main) {
  // Sanitize inherited Git overrides at this entry point; imported
  // main(argv, io) never mutates the process env.
  const clean = childEnv(process.env);
  for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key];
  Object.assign(process.env, clean);
  process.exitCode = main(process.argv.slice(2));
}
