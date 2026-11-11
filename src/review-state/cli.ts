import { isAbsolute, join } from 'node:path';
import { REASON_TABLE, REQUEST_SHAPES, SCHEMA_VERSION, truncate80, type CommandName } from './state.ts';
import { executeCommand, makeEnvelope, readHelperVersion, type StoreResult } from './store.ts';

export type CliIo = { stdout(text: string): void; stderr(text: string): void; cwd: string; env?: NodeJS.ProcessEnv };

export function renderMainHelp(): string {
  const reasons = REASON_TABLE.map((r) => `  ${r.reason} (status=${r.status}, exit=${r.exit}, side_effects=${r.side_effects}, retry=${r.retry})`).join('\n');
  return `review-state — experimental recorder for /review-and-prep run state (${SCHEMA_VERSION})
Experimental until Track 79A's default decision; internal store only.

Usage:
  bin/review-state start --dir DIR --input FILE
  bin/review-state record pass|correction|gate|audit --dir DIR --input FILE
  bin/review-state checkpoint --dir DIR --input FILE
  bin/review-state finish --dir DIR --input FILE
  bin/review-state --version
  bin/review-state --help | -h | <command> --help

Environment:
  GSTACK_EXTEND_REVIEW_STATE_LOCK_WAIT_MS  Lock wait in ms (integer 0..60000, default 5000)

Envelope:
  {v:1, command, status, reason, detail, fix, state_path, rev, helper_version, side_effects, retry, retry_after_ms}

Reasons:
${reasons}

Lock recovery:
  Confirm no review-state process runs as the recorded pid on the recorded host,
  delete review-run-state.json.lock, and rerun the identical command.

Exit codes: 0 recorded/replayed · 1 refused/conflict/unreadable · 2 usage · 3 unwritable · 4 busy
Docs: docs/designs/review-run-state.md
`;
}

export function renderCommandHelp(cmd: string): string | null {
  const matching = Object.entries(REQUEST_SHAPES).filter(([k]) => k === cmd || k.startsWith(`${cmd} (`) || (cmd === 'record' && k.startsWith('record ')));
  if (matching.length === 0) return null;
  const sections = matching.map(([name, shape]) => {
    const req = shape.required.join(', ');
    const opt = Object.entries(shape.optional).map(([k, d]) => `${k}=${JSON.stringify(d)}`).join(', ') || 'none';
    return `${name}:\n  required: ${req}\n  optional: ${opt}`;
  }).join('\n\n');
  return `review-state ${cmd} — experimental request shape (${SCHEMA_VERSION})\n\nUsage:\n  bin/review-state ${cmd} --dir DIR --input FILE\n\n${sections}\n\nDocs: docs/designs/review-run-state.md\n`;
}

function emitResult(res: StoreResult, io: CliIo): number {
  const { exitCode, ...envelope } = res;
  io.stdout(`${JSON.stringify(envelope)}\n`);
  if (res.status !== 'recorded' && res.status !== 'replayed') {
    const code = res.reason.toUpperCase().replace(/-/g, '_');
    const summary = typeof res.detail.message === 'string' ? res.detail.message : `${res.command} ${res.status} (${res.reason})`;
    io.stderr(`ERROR ${code}: ${summary}\nFIX: ${res.fix ?? ''}\n`);
  }
  return exitCode;
}

export function main(argv: string[], io: CliIo): number {
  const env = io.env ?? process.env;
  if (argv.length === 1 && argv[0] === '--version') {
    io.stdout(`review-state ${readHelperVersion(env) ?? 'unknown'}\n`);
    return 0;
  }
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    io.stdout(renderMainHelp());
    return 0;
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    const nonHelp = argv.filter((a) => a !== '--help' && a !== '-h');
    const cmdKey = nonHelp.length === 2 && nonHelp[0] === 'record' ? `record ${nonHelp[1]}` : nonHelp.length === 1 ? nonHelp[0]! : '';
    const text = cmdKey ? renderCommandHelp(cmdKey) : null;
    if (text && nonHelp.every((a) => !a.startsWith('-'))) {
      io.stdout(text);
      return 0;
    }
  }

  let commandStr = argv[0] ?? '';
  let rest = argv.slice(1);
  if (commandStr === 'record' && argv[1] && !argv[1].startsWith('-')) {
    commandStr = `record ${argv[1]}`;
    rest = argv.slice(2);
  }

  let dirArg: string | undefined;
  let inputArg: string | undefined;
  let flagErr: string | null = null;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === '--dir') {
      const val = rest[++i];
      if (val === undefined) flagErr ??= '--dir requires a value';
      else if (dirArg !== undefined) flagErr ??= 'duplicate --dir flag';
      else dirArg = val;
    } else if (arg === '--input') {
      const val = rest[++i];
      if (val === undefined) flagErr ??= '--input requires a value';
      else if (inputArg !== undefined) flagErr ??= 'duplicate --input flag';
      else inputArg = val;
    } else flagErr ??= `unknown argument ${truncate80(arg)}`;
  }

  const statePath = dirArg && isAbsolute(dirArg) ? join(dirArg, 'review-run-state.json') : null;
  const validCommands: readonly CommandName[] = ['start', 'record pass', 'record correction', 'record gate', 'record audit', 'checkpoint', 'finish'];
  if (!(validCommands as readonly string[]).includes(commandStr)) {
    const label = commandStr || 'unknown';
    return emitResult(makeEnvelope(truncate80(label), 'usage', { message: truncate80(`unknown command "${label}"`) }, statePath, null, undefined, readHelperVersion(env)), io);
  }
  if (flagErr || dirArg === undefined || inputArg === undefined) {
    const msg = flagErr ?? (dirArg === undefined ? '--dir is required' : '--input is required');
    return emitResult(makeEnvelope(commandStr, 'usage', { message: msg }, statePath, null, undefined, readHelperVersion(env)), io);
  }
  return emitResult(executeCommand(commandStr as CommandName, dirArg, inputArg, io.cwd, env), io);
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2), { stdout: (t) => process.stdout.write(t), stderr: (t) => process.stderr.write(t), cwd: process.cwd(), env: process.env });
}
