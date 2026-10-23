import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DISPOSITIONS, evaluate, parseEntries, safePath, sha256, type Check, type Part } from './evaluate';

const HELP = 'Usage: secret-dispositions --gstack-root <trusted-installed-gstack> --pregate <raw-pregate.json> [--stage all|preflight]\nRead-only JSON evaluator; exit 0 satisfied, 1 blocked, 2 usage/incompatible evidence. Never writes approvals or pregate records.';

export async function main(args: string[]) {
  if (args.length === 1 && args[0] === '--help') { console.log(HELP); return 0; }
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!, value = args[i + 1];
    if (!['--gstack-root', '--pregate', '--stage'].includes(key) || !value || value.startsWith('--') || flags.has(key)) throw new Error(HELP);
    flags.set(key, value);
  }
  if (!flags.has('--gstack-root') || !flags.has('--pregate')) throw new Error(HELP);
  const stage = flags.get('--stage') ?? 'all';
  if (!['all', 'preflight'].includes(stage)) throw new Error(HELP);
  const git = (...argv: string[]) => {
    const r = spawnSync('git', argv, { encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`git ${argv[0]} failed; evidence unavailable`);
    return r.stdout.replace(/\n$/, '');
  };
  const repo = realpathSync(git('rev-parse', '--show-toplevel'));
  if (realpathSync(process.cwd()) !== repo) throw new Error('run from the repository root');
  const root = realpathSync(resolve(flags.get('--gstack-root')!));
  const rel = relative(repo, root);
  if (!rel || (!rel.startsWith('../') && !isAbsolute(rel))) throw new Error('gstack root must be a trusted installation outside the project');
  // Reuse installed upstream readers, registry and fingerprinting, as outside-review does.
  // These private exports are capability-checked; incompatible versions block, never downgrade.
  const load = (name: string) => import(pathToFileURL(join(root, 'lib', `${name}.ts`)).href);
  const { readPregateFile, verifyPregate, verdictOf, CHECKS } = await load('pregate/index');
  const { touchedFiles } = await load('pregate/context');
  const { addedLines } = await load('pregate/checks/secrets');
  if (![readPregateFile, verifyPregate, verdictOf, touchedFiles, addedLines].every(f => typeof f === 'function') || !Array.isArray(CHECKS)) throw new Error('incompatible installed pregate helpers');
  const rawPath = resolve(flags.get('--pregate')!);
  const rawBytes = readFileSync(rawPath, 'utf8');
  const { file: raw } = readPregateFile(rawPath);
  if (!raw) throw new Error('invalid raw pregate schema');
  const errors: string[] = [];
  const verified = verifyPregate(repo, raw);
  if (!verified.current) errors.push('raw pregate tree is stale or unavailable');
  const expected = CHECKS.filter((c: { stage: string }) => stage === 'all' || c.stage === stage).map((c: Check) => c.id).sort();
  const actual = raw.checks.map((c: Check) => c.id).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) errors.push('raw pregate does not contain exactly the required checks');
  if (raw.verdict !== verdictOf(raw)) errors.push('raw pregate verdict is inconsistent');
  const base = /^origin\/(.+)@([a-f0-9]{12})$/.exec(raw.base ?? '');
  if (!base || git('rev-parse', `refs/remotes/origin/${base[1]}`).slice(0, 12) !== base[2]) throw new Error('raw pregate base is stale or unavailable');
  if (raw.head !== git('rev-parse', 'HEAD')) errors.push('raw pregate head is stale');
  if ((raw.requires_remote ?? []).some((r: { receipt?: unknown }) => typeof r.receipt !== 'string' || !r.receipt.trim())) errors.push('remote obligations remain uncleared');
  for (const c of raw.checks as Check[]) {
    if (c.id !== 'secrets' && !['pass', 'warn', 'requires-remote'].includes(c.status)) errors.push(`${c.id}: raw ${c.status}`);
  }
  const readSource = (file: string, approvalFile = false): string | undefined => {
    if (!safePath(file)) throw new Error('unsafe source path');
    const abs = join(repo, file);
    try {
      if (!lstatSync(abs).isFile() || realpathSync(abs) !== abs) {
        if (approvalFile) throw new Error('symlink or non-regular disposition file');
        return undefined; // No exact regular source line: entries are stale; findings cannot match.
      }
      return readFileSync(abs, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new Error(`cannot safely read ${file}`);
    }
  };
  const dispositionText = readSource(DISPOSITIONS, true);
  const entries = dispositionText === undefined ? [] : parseEntries(JSON.parse(dispositionText));
  if (dispositionText !== undefined) {
    // An entry becomes reusable only after an approved edit is committed, not merely staged.
    const committed = spawnSync('git', ['show', `HEAD:${DISPOSITIONS}`], { encoding: 'utf8', timeout: 15_000 });
    if (committed.status !== 0 || committed.stdout !== dispositionText) errors.push('dispositions must be committed and unchanged from HEAD');
  }
  const secrets = raw.checks.find((c: Check) => c.id === 'secrets');
  if (!secrets) throw new Error('raw secrets check is missing');
  const mergeBase = git('merge-base', `refs/remotes/origin/${base[1]}`, 'HEAD');
  const parts: Part[] = secrets.status === 'fail'
    ? addedLines({ repoRoot: repo, mergeBase, touched: touchedFiles(repo, mergeBase), env: process.env }) : [];
  const sources = new Map<string, string>();
  for (const file of new Set([...entries.map(e => e.path), ...parts.map(p => p.file)])) {
    const text = readSource(file);
    if (text !== undefined) sources.set(file, text);
  }
  const result = evaluate(secrets, parts, entries, sources);
  errors.push(...result.errors);
  // Recheck after collection so an edit during evaluation cannot produce a passing receipt.
  if (!verifyPregate(repo, raw).current || readFileSync(rawPath, 'utf8') !== rawBytes) errors.push('evidence changed during evaluation');
  const satisfied = errors.length === 0 && result.satisfied;
  const ids = result.matched.map(m => m.entry);
  console.log(JSON.stringify({ version: 1, satisfied, raw_verdict: raw.verdict, raw_secrets: secrets.status,
    tree: raw.tree, head: raw.head, base: raw.base, raw_sha256: sha256(rawBytes),
    dispositions_sha256: dispositionText === undefined ? null : sha256(dispositionText),
    receipt: `secrets: raw ${secrets.status}; ${ids.length} findings dispositioned (entries ${ids.join(', ') || 'none'})`,
    matched: result.matched, unmatched: result.unmatched, stale: result.stale, errors }, null, 2));
  return satisfied ? 0 : 1;
}

if (import.meta.main) main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch((e: Error) => {
  console.log(JSON.stringify({ version: 1, satisfied: false, error: e.message }));
  process.exitCode = 2;
});
