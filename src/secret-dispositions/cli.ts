import { spawnSync } from 'node:child_process';
import { accessSync, chmodSync, constants, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DISPOSITIONS, evaluate, parseEntries, safePath, sha256, type Check, type Part } from './evaluate';
import { countsFor, decide, eligibleComponent, exitFor, knownComponents, maskComponents, type ScanFinding } from './scan-text';

const HELP = 'Usage: secret-dispositions --gstack-root <trusted-installed-gstack> --pregate <raw-pregate.json> [--stage all|preflight]\n'
  + '       secret-dispositions scan-text --gstack-root <trusted-installed-gstack> --from-file <file> [--evidence-dir <dir>] [--pr-url <url>]\n'
  + 'Read-only JSON evaluator; exit 0 satisfied, 1 blocked, 2 usage/incompatible evidence. Never writes approvals or pregate records.\n'
  + 'scan-text exit: 0 clean, 1 usage/scanner error, 2 MEDIUM present, 3 HIGH present.';
const PR_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+\/pull\/[1-9][0-9]*$/;

type RedactJson = { findings: ScanFinding[]; counts: { HIGH: number; MEDIUM: number; LOW: number; WARN: number }; repoVisibility: string; oversize: boolean };

function git(...argv: string[]): string {
  const r = spawnSync('git', argv, { encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${argv[0]} failed; evidence unavailable`);
  return r.stdout.replace(/\n$/, '');
}

function trustedRoot(gstackRootFlag: string): { repo: string; root: string } {
  const repo = realpathSync(git('rev-parse', '--show-toplevel'));
  if (realpathSync(process.cwd()) !== repo) throw new Error('run from the repository root');
  const root = realpathSync(resolve(gstackRootFlag));
  const rel = relative(repo, root);
  if (!rel || (!rel.startsWith('../') && !isAbsolute(rel))) throw new Error('gstack root must be a trusted installation outside the project');
  return { repo, root };
}

function runUpstreamRedact(redactBin: string, targetFile: string): { exit: 0 | 2 | 3; data: RedactJson } | null {
  const r = spawnSync(redactBin, ['--from-file', targetFile, '--json'], { encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error || (r.status !== 0 && r.status !== 2 && r.status !== 3)) return null;
  try {
    const p = JSON.parse(r.stdout) as Partial<RedactJson>;
    if (!p || typeof p !== 'object' || !Array.isArray(p.findings) || !p.counts || typeof p.counts !== 'object' || typeof p.repoVisibility !== 'string' || typeof p.oversize !== 'boolean') return null;
    return { exit: r.status, data: p as RedactJson };
  } catch { return null; }
}

function validateEvidenceDir(dir: string): string[] {
  if (!dir.startsWith('/') || dir.endsWith('/') || dir.slice(1).split('/').some(s => !s || s === '.' || s === '..' || /[\x00-\x1f\x7f]/.test(s))) {
    throw new Error('invalid evidence-dir path');
  }
  let stat;
  try { stat = lstatSync(dir); } catch { throw new Error('evidence-dir does not exist'); }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('evidence-dir must be a directory and not a symlink');
  const realDir = realpathSync(dir);
  const absEnv = (v: string | undefined) => (v && isAbsolute(v) ? v : undefined);
  const homeRaw = absEnv(process.env.HOME)?.replace(/\/+$/, '');
  const stateRoot = absEnv(process.env.GSTACK_STATE_ROOT) || absEnv(process.env.GSTACK_HOME) || (homeRaw ? join(homeRaw, '.gstack') : undefined);
  const strictlyBelow = (base: string, target: string) => {
    const sub = relative(base, target);
    return Boolean(sub && sub !== '..' && !sub.startsWith('../') && !isAbsolute(sub));
  };
  let allowed = false;
  if (stateRoot) {
    try {
      const projectsReal = realpathSync(join(stateRoot, 'projects'));
      const parts = relative(projectsReal, realDir).split('/');
      if (parts.length >= 3 && parts[0] && parts[0] !== '.' && parts[0] !== '..' && parts[1] === 'review-and-prep') {
        allowed = strictlyBelow(realpathSync(join(projectsReal, parts[0], 'review-and-prep')), realDir);
      }
    } catch {}
  }
  if (!allowed && homeRaw) {
    try { allowed = strictlyBelow(realpathSync(join(homeRaw, 'scratch', 'review-and-prep')), realDir); } catch {}
  }
  if (!allowed) throw new Error('evidence-dir must lie below a documented review-and-prep root');
  const spellings = [dir];
  if (homeRaw && dir.startsWith(`${homeRaw}/`)) spellings.push(`~/${dir.slice(homeRaw.length + 1)}`);
  return spellings;
}

function scanText(args: string[]): number {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!, value = args[i + 1];
    if (!['--gstack-root', '--from-file', '--evidence-dir', '--pr-url'].includes(key) || !value || value.startsWith('--') || flags.has(key)) throw new Error(HELP);
    flags.set(key, value);
  }
  if (!flags.has('--gstack-root') || !flags.has('--from-file')) throw new Error(HELP);
  const { repo, root } = trustedRoot(flags.get('--gstack-root')!);
  let redactBin = join(root, 'bin', 'gstack-redact');
  try {
    const st = lstatSync(redactBin);
    if (st.isSymbolicLink() || !st.isFile()) throw new Error('not regular');
    accessSync(redactBin, constants.X_OK);
    const realBin = realpathSync(redactBin), rel = relative(repo, realBin);
    if (!rel || (!rel.startsWith('../') && !isAbsolute(rel))) throw new Error('in-project scanner');
    redactBin = realBin;
  } catch { throw new Error('gstack-redact must be a regular executable file outside the project'); }
  const file = resolve(flags.get('--from-file')!);
  let fileStat;
  try { fileStat = lstatSync(file); } catch { throw new Error('from-file does not exist'); }
  if (fileStat.isSymbolicLink() || !fileStat.isFile()) throw new Error('from-file must be a regular file and not a symlink');
  const evidenceDirs = flags.has('--evidence-dir') ? validateEvidenceDir(flags.get('--evidence-dir')!) : [];
  const prUrl = flags.get('--pr-url');
  if (prUrl !== undefined && !PR_URL_RE.test(prUrl)) throw new Error('invalid pr-url');
  const text = readFileSync(file, 'utf8');
  const firstRun = runUpstreamRedact(redactBin, file);
  if (!firstRun) throw new Error('upstream gstack-redact scan failed');
  const components = knownComponents(text, { evidenceDirs, prUrl });
  let secondData: RedactJson | undefined;
  if (!firstRun.data.oversize && firstRun.data.findings.some(f => eligibleComponent(text, components, f) !== undefined)) {
    let tmpDir: string | undefined;
    try {
      tmpDir = mkdtempSync(join(dirname(file), '.scan-text-'));
      chmodSync(tmpDir, 0o700);
      const maskedPath = join(tmpDir, basename(file));
      writeFileSync(maskedPath, maskComponents(text, components), { mode: 0o600 });
      chmodSync(maskedPath, 0o600);
      secondData = runUpstreamRedact(redactBin, maskedPath)?.data;
    } catch { secondData = undefined; }
    finally { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }); }
  }
  const decision = decide(text, components, firstRun.data, secondData);
  const counts = decision.status === 'applied' ? countsFor(decision.findings) : firstRun.data.counts;
  const code = decision.status === 'applied' ? exitFor(decision.findings) : firstRun.exit;
  console.log(JSON.stringify({ version: 1, status: decision.status, ...(decision.reason ? { reason: decision.reason } : {}),
    upstream_exit: firstRun.exit, findings: decision.findings, counts, repoVisibility: firstRun.data.repoVisibility,
    oversize: firstRun.data.oversize, known_safe: decision.known_safe }, null, 2));
  return code;
}

export async function main(args: string[]) {
  if (args[0] === 'scan-text') {
    try { return scanText(args.slice(1)); }
    catch (e) { console.log(JSON.stringify({ version: 1, error: (e as Error).message })); return 1; }
  }
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
  const { repo, root } = trustedRoot(flags.get('--gstack-root')!);
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
