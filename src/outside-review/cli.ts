import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { snapshotDiff, type Request } from './prompt';
import { run, measurement } from './run';

/** Adapter, not a fork: preserve upstream supervision, transport and validator. */
export function restrictedArgs(args: string[], prefixFile: string) {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--append-system-prompt') { i++; continue; }
    if (args[i] === '--settings') {
      result.push('--settings', JSON.stringify({ ...JSON.parse(args[++i]!),
        disableAllHooks: true, claudeMdExcludes: ['**'], autoMemoryEnabled: false }));
    } else result.push(args[i]!);
  }
  return [...result, '--system-prompt-file', prefixFile, '--no-session-persistence'];
}

async function main(args: string[]) {
  if (args[0] === 'exec') {
    const config = JSON.parse(readFileSync(args[1]!, 'utf8'));
    const child = spawn(config.command, [...config.argsPrefix, ...restrictedArgs(args.slice(2), config.prefixFile)], { stdio: 'inherit' });
    child.on('error', () => process.exit(1));
    child.on('exit', (code) => process.exit(code ?? 1));
    return;
  }
  if (args.length !== 3) throw new Error('Usage: outside-review <request.json> <gstack-root> <private-call-directory>');
  const [requestFile, root, directory] = args as [string, string, string];
  const request: Request = JSON.parse(readFileSync(requestFile, 'utf8'));
  const load = (name: string) => import(pathToFileURL(join(resolve(root), 'lib', name + '.ts')).href);
  const { runClaudeCode } = await load('claude-code');
  const { resolveClaudeCommand } = await load('claude-bin');
  const { classifyOutsideReview } = await load('outside-review-result');
  if ([runClaudeCode, resolveClaudeCommand, classifyOutsideReview].some(helper => typeof helper !== 'function')) {
    throw new Error('Incompatible installed helpers; no outside call made');
  }
  const command = resolveClaudeCommand(process.env);
  if (!command) throw new Error('Claude Code unavailable; no outside call made');
  const diff = snapshotDiff(request);
  const scratch = mkdtempSync(join(tmpdir(), 'extend-outside-'));
  try {
    const prefixFile = join(scratch, 'prefix');
    const config = join(scratch, 'command.json');
    writeFileSync(config, JSON.stringify({ ...command, prefixFile }), { mode: 0o600 });
    const identity = JSON.stringify([command, process.env.GSTACK_CLAUDE_MODEL ?? null, process.env.ANTHROPIC_MODEL ?? null]);
    const results = await run(request, diff, resolve(directory), identity, async (prefix, task) => {
      writeFileSync(prefixFile, prefix, { mode: 0o600 });
      return runClaudeCode({ cwd: request.repo, access: 'none', timeoutMs: 540000, prompt: task,
        env: { ...process.env, GSTACK_CLAUDE_BIN: process.execPath,
          GSTACK_CLAUDE_BIN_ARGS: JSON.stringify(['--no-env-file', '--no-install', '--config=/dev/null', import.meta.filename, 'exec', config]) } });
    }, classifyOutsideReview);
    // Output contains review results for consumption, but prompt content is never returned.
    console.log(JSON.stringify({ results, measurements: results.map(measurement) }));
    process.exitCode = results.some(r => r.state_error) ? 1 : results.some(r => !r.credited) ? 4 : results.some(r => r.classification.verdict === 'findings') ? 3 : 0;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main) main(process.argv.slice(2)).catch(() => {
  console.error('Outside review incomplete: check input, installed helpers and private call state. Never retry an unresolved claim.');
  process.exitCode = 1;
});
