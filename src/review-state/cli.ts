import { isAbsolute, join } from 'node:path';
import { buildHelp, executeBuild, type BuildOverride } from './build.ts';
import { executeExport, EXPORT_SCHEMA } from './export.ts';
import { FULL_REVIEW_RECORD_PREFIX, fullReviewRecordHelp, runFullReviewRecord } from './fence.ts';
import { executeRender, RENDER_EXAMPLES, RENDER_SCHEMA, RENDER_SHAPES } from './render.ts';
import { executeShow, SHOW_SCHEMA } from './show.ts';
import { REASON_TABLE, REQUEST_EXAMPLES, REQUEST_SHAPES, SCHEMA_VERSION, truncate80, type CommandName } from './state.ts';
import { executeCommand, getLastValidatedCommand, internalErrorResult, makeEnvelope, readHelperVersion, resetValidatedStateDir, type StoreResult } from './store.ts';

export type CliIo = { stdout(text: string): void; stderr(text: string): void; cwd: string; env?: NodeJS.ProcessEnv; versionPath?: string };

export function renderMainHelp(): string {
  const reasons = REASON_TABLE.map((r) => `  ${r.reason} (status=${r.status}, exit=${r.exit}, side_effects=${r.side_effects}, retry=${r.retry})`).join('\n');
  return `review-state — experimental recorder for /review-and-prep run state (${SCHEMA_VERSION})
Experimental internal helper; /review-and-prep records its run state by default.

Usage:
  bin/review-state build <command> --dir DIR [flags]
  bin/review-state start --dir DIR --input FILE
  bin/review-state record pass|correction|gate|audit --dir DIR --input FILE
  bin/review-state checkpoint --dir DIR --input FILE
  bin/review-state finish --dir DIR --input FILE
  bin/review-state show --dir DIR [--base SHA] [--wtree TOKEN]
  bin/review-state export --dir DIR
  bin/review-state render --dir DIR --input FILE
  bin/review-state full-review-record WORKSPACE DIR write|check KIND FILE|BOUNDARY
  bin/review-state --version
  bin/review-state --help | -h | build --help | <command> --help

show and export are read-only: no --input, no lock, and no state writes.
render reads review-run-state.json without locking or modifying it and writes output files in --dir.
full-review-record prints one FULL_REVIEW_RECORD: line with its own exit codes (full-review-record --help), and every /review-and-prep invocation calls it, including when state recording is unavailable.

Environment:
  GSTACK_EXTEND_REVIEW_STATE_LOCK_WAIT_MS  Lock wait in ms (integer 0..60000, default 5000)

Envelope:
  {v:1, command, status, reason, detail, fix, state_path, rev, helper_version, side_effects, retry, retry_after_ms}

Reasons:
${reasons}

Lock recovery:
  A same-host lock whose process has exited is reclaimed automatically; this holder is alive, on another host, or unverifiable. Confirm no review-state process runs as the recorded pid on the recorded host, delete review-run-state.json.lock, and rerun the identical command.

Exit codes: 0 recorded/replayed · 1 refused/conflict/unreadable · 2 usage · 3 unwritable · 4 busy · 5 internal-error
Docs: docs/designs/review-run-state.md
`;
}

export function renderCommandHelp(cmd: string): string | null {
  if (cmd === 'show') {
    return `review-state show — experimental read-only resume inspection (${SHOW_SCHEMA})\nNo lock or state writes.\n\nUsage:\n  bin/review-state show --dir DIR [--base SHA] [--wtree TOKEN]\n\nshow:\n  required: --dir DIR\n  optional: --base SHA, --wtree TOKEN\n  Example: bin/review-state show --dir /abs/path/to/evidence-dir --base 89abcdef0123456789abcdef0123456789abcdef --wtree wt:clean\n\nDocs: docs/designs/review-run-state.md\n`;
  }
  if (cmd === 'export') {
    return `review-state export — experimental read-only projection (${EXPORT_SCHEMA})\nNo lock or state writes.\n\nUsage:\n  bin/review-state export --dir DIR\n\nexport:\n  required: --dir DIR\n  optional: none\n  Example: bin/review-state export --dir /abs/path/to/evidence-dir\n\nDocs: docs/designs/review-run-state.md\n`;
  }
  if (cmd === 'render') {
    const sections = Object.entries(RENDER_SHAPES).map(([name, shape]) => {
      const req = shape.required.join(', ');
      const opt = Object.entries(shape.optional).map(([k, d]) => `${k}=${JSON.stringify(d)}`).join(', ') || 'none';
      const ex = JSON.stringify(RENDER_EXAMPLES[name as keyof typeof RENDER_SHAPES]);
      return `${name}:\n  required: ${req}\n  optional: ${opt}\n  Example: ${ex}`;
    }).join('\n\n');
    return `review-state render — experimental state renderer (${RENDER_SCHEMA})\nReads review-run-state.json without locking or modifying it and writes full-receipt, comment, body, or final files inside --dir.\n\nUsage:\n  bin/review-state render --dir DIR --input FILE\n\n${sections}\n\nDocs: docs/designs/review-run-state.md\n`;
  }
  const matching = Object.entries(REQUEST_SHAPES).filter(([k]) => k === cmd || k.startsWith(`${cmd} (`) || (cmd === 'record' && k.startsWith('record ')));
  if (matching.length === 0) return null;
  const sections = matching.map(([name, shape]) => {
    const req = shape.required.join(', ');
    const opt = Object.entries(shape.optional).map(([k, d]) => `${k}=${JSON.stringify(d)}`).join(', ') || 'none';
    const ex = JSON.stringify(REQUEST_EXAMPLES[name as keyof typeof REQUEST_SHAPES]);
    return `${name}:\n  required: ${req}\n  optional: ${opt}\n  Example: ${ex}`;
  }).join('\n\n');
  return `review-state ${cmd} — experimental request shape (${SCHEMA_VERSION})\n\nUsage:\n  bin/review-state ${cmd} --dir DIR --input FILE\n\n${sections}\n\nDocs: docs/designs/review-run-state.md\n`;
}

function emitResult(res: StoreResult, io: CliIo, err?: unknown): number {
  const { exitCode, ...envelope } = res;
  io.stdout(`${JSON.stringify(envelope)}\n`);
  if (res.status !== 'recorded' && res.status !== 'replayed') {
    const code = res.reason.toUpperCase().replace(/-/g, '_');
    const summary = typeof res.detail.message === 'string' ? res.detail.message : `${res.command} ${res.status} (${res.reason})`;
    let extra = '';
    if (res.status === 'error' && err instanceof Error && typeof err.stack === 'string') {
      const frames = err.stack.split('\n').filter((l) => /^\s*at\s/.test(l)).slice(0, 3);
      if (frames.length > 0) extra = `${frames.join('\n')}\n`;
    }
    io.stderr(`ERROR ${code}: ${summary}\nFIX: ${res.fix ?? ''}\n${extra}`);
  }
  return exitCode;
}

export function main(argv: string[], io: CliIo): number {
  const env = io.env ?? process.env;
  resetValidatedStateDir();
  if (argv[0] === 'full-review-record') {
    const restArgs = argv.slice(1);
    if (restArgs.includes('--help') || restArgs.includes('-h')) {
      io.stdout(fullReviewRecordHelp());
      return 0;
    }
    const res = runFullReviewRecord(restArgs, env);
    io.stdout(`${FULL_REVIEW_RECORD_PREFIX}${res.message}\n`);
    return res.exitCode;
  }
  let commandStr = argv[0] ?? '';
  let statePath: string | null = null;
  try {
    if (argv[0] === 'build') {
      if (argv.includes('--help') || argv.includes('-h')) {
        io.stdout(buildHelp());
        return 0;
      }
      const res = executeBuild(argv, io.cwd, env, io.versionPath, io.stderr);
      for (const ov of (res.detail.overrides as BuildOverride[] | undefined) ?? []) {
        io.stderr(`WARNING BUILD_OVERRIDE: ${res.command} ${ov.flag} sent ${JSON.stringify(ov.sent)}; used ${JSON.stringify(ov.used)}; rule ${ov.rule}\n`);
      }
      return emitResult(res, io);
    }
    if (argv.length === 1 && argv[0] === '--version') {
      io.stdout(`review-state ${readHelperVersion(io.versionPath) ?? 'unknown'}\n`);
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

    let rest = argv.slice(1);
    if (commandStr === 'record' && argv[1] && !argv[1].startsWith('-')) {
      commandStr = `record ${argv[1]}`;
      rest = argv.slice(2);
    }

    let dirArg: string | undefined;
    let inputArg: string | undefined;
    let baseArg: string | undefined;
    let wtreeArg: string | undefined;
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
      } else if (arg === '--base') {
        const val = rest[++i];
        if (val === undefined) flagErr ??= '--base requires a value';
        else if (baseArg !== undefined) flagErr ??= 'duplicate --base flag';
        else baseArg = val;
      } else if (arg === '--wtree') {
        const val = rest[++i];
        if (val === undefined) flagErr ??= '--wtree requires a value';
        else if (wtreeArg !== undefined) flagErr ??= 'duplicate --wtree flag';
        else wtreeArg = val;
      } else flagErr ??= `unknown argument ${truncate80(arg)}`;
    }

    statePath = dirArg && isAbsolute(dirArg) ? join(dirArg, 'review-run-state.json') : null;
    if (commandStr === 'show') {
      if (flagErr || dirArg === undefined || inputArg !== undefined) {
        const msg = flagErr ?? (inputArg !== undefined ? 'show does not accept --input' : '--dir is required');
        return emitResult(makeEnvelope('show', 'usage', { message: msg }, statePath, null, undefined, readHelperVersion(io.versionPath)), io);
      }
      const res = executeShow(dirArg, io.cwd, env, io.versionPath, baseArg, wtreeArg);
      if (!res.ok) return emitResult(res.envelope, io);
      io.stdout(`${JSON.stringify(res.showDoc)}\n`);
      return 0;
    }
    if (baseArg !== undefined || wtreeArg !== undefined) {
      const badFlag = baseArg !== undefined ? '--base' : '--wtree';
      flagErr ??= `${commandStr || 'unknown'} does not accept ${badFlag}`;
    }
    if (commandStr === 'export') {
      if (flagErr || dirArg === undefined || inputArg !== undefined) {
        const msg = flagErr ?? (inputArg !== undefined ? 'export does not accept --input' : '--dir is required');
        return emitResult(makeEnvelope('export', 'usage', { message: msg }, statePath, null, undefined, readHelperVersion(io.versionPath)), io);
      }
      const res = executeExport(dirArg, io.cwd, env, io.versionPath);
      if (!res.ok) return emitResult(res.envelope, io);
      io.stdout(`${JSON.stringify(res.exportDoc)}\n`);
      return 0;
    }
    if (commandStr === 'render') {
      if (flagErr || dirArg === undefined || inputArg === undefined) {
        const msg = flagErr ?? (dirArg === undefined ? '--dir is required' : '--input is required');
        return emitResult(makeEnvelope('render', 'usage', { message: msg }, statePath, null, undefined, readHelperVersion(io.versionPath)), io);
      }
      const res = executeRender(dirArg, inputArg, io.cwd, env, io.versionPath);
      if (!res.ok) return emitResult(res.envelope, io);
      io.stdout(`${JSON.stringify(res.renderDoc)}\n`);
      return 0;
    }
    const validCommands: readonly CommandName[] = ['start', 'record pass', 'record correction', 'record gate', 'record audit', 'checkpoint', 'finish'];
    if (!(validCommands as readonly string[]).includes(commandStr)) {
      const label = commandStr || 'unknown';
      return emitResult(makeEnvelope(truncate80(label), 'usage', { message: truncate80(`unknown command "${label}"`) }, statePath, null, undefined, readHelperVersion(io.versionPath)), io);
    }
    if (flagErr || dirArg === undefined || inputArg === undefined) {
      const msg = flagErr ?? (dirArg === undefined ? '--dir is required' : '--input is required');
      return emitResult(makeEnvelope(commandStr, 'usage', { message: msg }, statePath, null, undefined, readHelperVersion(io.versionPath)), io);
    }
    return emitResult(executeCommand(commandStr as CommandName, dirArg, inputArg, io.cwd, env, io.versionPath), io);
  } catch (err) {
    const cmdLabel = getLastValidatedCommand() ?? (commandStr || 'unknown');
    return emitResult(internalErrorResult(truncate80(cmdLabel), err, statePath, readHelperVersion(io.versionPath)), io, err);
  }
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2), { stdout: (t) => process.stdout.write(t), stderr: (t) => process.stderr.write(t), cwd: process.cwd(), env: process.env });
}
