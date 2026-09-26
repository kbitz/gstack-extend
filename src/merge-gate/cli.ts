import { existsSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { canonicalJson, sha256Hex } from './canon.ts';
import { collect, installVersion, type CollectInput } from './collect.ts';
import { decide, normalizePolicy, validateEvidence, type Verdict } from './decide.ts';
import { GateError, isGateError } from './errors.ts';
import { createGateway } from './exec.ts';
import { assertGlob } from './glob.ts';
import { parseRemote } from './redact.ts';
import {
  COLLECTOR_VERSION,
  DEFAULT_POLICY,
  EVIDENCE_V,
  GATE_VERSION,
  POLICY_KEYS,
  VERDICT_V,
  type Policy,
} from './registry.ts';
import {
  appendVerdict,
  checkStore,
  decisionKey,
  ensureLogged,
  evidencePath,
  listEvidence,
  publishDecision,
  readDecision,
  readEvidenceFile,
  writeEvidence,
} from './store.ts';

export type CliIo = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  env: NodeJS.ProcessEnv;
  cwd: string;
  now: () => Date;
  fail?: () => void;
  readStdin: () => string;
};

const OVERRIDE_KEYS = [
  'GSTACK_EXTEND_MERGE_GATE_NOW',
  'GSTACK_EXTEND_MERGE_GATE_TIMEOUT_MS',
  'GSTACK_EXTEND_MERGE_GATE_RETRY_MS',
] as const;

const PR_URL_RE = /^https:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/([1-9][0-9]*)\/?(?:(?:files|commits|checks)\/?)?(?:\?[^#]*)?(?:#.*)?$/;
const REMOTE_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

const BUDGET_FLAGS: Record<string, Exclude<keyof Policy, 'exclude'>> = {
  '--max-net-lines': 'max_net_lines',
  '--max-new-files': 'max_new_files',
  '--max-new-deps': 'max_new_deps',
  '--max-new-public-api': 'max_new_public_api',
  '--max-churn': 'max_churn',
};
const CHECK_ONLY = ['--base', '--head', '--pr', '--decision-id', '--no-record', '--repo-root', '--remote', '--timeout'];
const REPLAY_ONLY = ['--evidence', '--all', '--jsonl'];

export async function main(argv: string[], partial?: Partial<CliIo>): Promise<number> {
  const io = finishIo(partial);
  const jsonish = argv.includes('--json') || argv.includes('--jsonl');
  try {
    io.fail?.();
    if (argv.some(a => a === '-h' || a === '--help')) {
      io.stdout(helpText(argv) + '\n');
      return 0;
    }
    if (argv.includes('--version')) {
      overrides(io.env, false);
      printVersion(io, argv.includes('--json'));
      return 0;
    }
    const cmd = argv[0];
    if (cmd === 'check') return runCheck(argv.slice(1), io);
    if (cmd === 'replay') return runReplay(argv.slice(1), io);
    throw new GateError('usage', `unknown command '${cmd ?? ''}'`, 'pass check, replay, --help, or --version');
  } catch (err) {
    return report(err, io, jsonish);
  }
}

function finishIo(partial?: Partial<CliIo>): CliIo {
  return {
    stdout: partial?.stdout ?? (s => process.stdout.write(s)),
    stderr: partial?.stderr ?? (s => process.stderr.write(s)),
    env: partial?.env ?? process.env,
    cwd: partial?.cwd ?? process.cwd(),
    now: partial?.now ?? (() => new Date()),
    ...(partial?.fail ? { fail: partial.fail } : {}),
    readStdin: partial?.readStdin ?? (() => readFileSync(0, 'utf8')),
  };
}

function errorBody(code: string, message: string, fix: string, doc: string): { code: string; message: string; fix: string; doc: string } {
  return { code, message, fix, doc };
}

function report(err: unknown, io: CliIo, json: boolean): number {
  const gate = isGateError(err);
  if (!gate) {
    const message = err instanceof Error ? err.message : String(err);
    io.stderr(`${err instanceof Error ? err.stack ?? message : message}\n`);
  }
  const body = gate
    ? errorBody(err.code, err.message, err.fix, err.doc)
    : errorBody('internal_error', err instanceof Error ? err.message : String(err), 'report this as a gate bug', 'docs/merge-gate.md#errors');
  if (json) io.stdout(canonicalJson({ v: 1, error: body }) + '\n');
  else io.stderr(`ERROR ${body.code}: ${stripCtl(body.message)}\nFIX: ${stripCtl(body.fix)}\n`);
  return body.code === 'usage' ? 2 : 1;
}

type Parsed = {
  json: boolean;
  jsonl: boolean;
  noRecord: boolean;
  repoRoot: string | null;
  remote: string;
  policyPath: string | null;
  exclude: string[];
  budget: Partial<Policy>;
  timeoutSec: number | null;
  decisionId: string | null;
  base: string | null;
  head: string | null;
  pr: string | null;
  evidence: string | null;
  all: boolean;
};

function usage(message: string, fix: string): GateError {
  return new GateError('usage', message, fix);
}

function parseFlags(argv: string[], mode: 'check' | 'replay'): Parsed {
  const out: Parsed = {
    json: false, jsonl: false, noRecord: false, repoRoot: null, remote: 'origin',
    policyPath: null, exclude: [], budget: {}, timeoutSec: null, decisionId: null,
    base: null, head: null, pr: null, evidence: null, all: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    const other = mode === 'check' ? REPLAY_ONLY : CHECK_ONLY;
    if (other.includes(a)) throw usage(`${a} is not a ${mode} flag`, `see merge-gate ${mode} --help`);
    const take = (opts: { signed?: boolean; stdin?: boolean } = {}): string => {
      const next = argv[i + 1];
      if (next === undefined) throw usage(`${a} requires a value`, `pass a value after ${a}`);
      if (next.startsWith('-') && !opts.signed && !(opts.stdin && next === '-')) {
        throw usage(`${a}: '${next}' starts with -, which is not a valid value`, `pass a value after ${a}`);
      }
      i++;
      return next;
    };
    if (a === '--json') out.json = true;
    else if (a === '--jsonl') out.jsonl = true;
    else if (a === '--no-record') out.noRecord = true;
    else if (a === '--all') out.all = true;
    else if (a === '--repo-root') out.repoRoot = take();
    else if (a === '--remote') out.remote = take();
    else if (a === '--policy') out.policyPath = take({ stdin: true });
    else if (a === '--exclude') {
      const glob = take();
      assertGlob(glob);
      out.exclude.push(glob);
    } else if (a === '--decision-id') out.decisionId = take();
    else if (a === '--timeout') out.timeoutSec = parseTimeout(take());
    else if (a === '--base') out.base = take();
    else if (a === '--head') out.head = take();
    else if (a === '--pr') out.pr = take();
    else if (a === '--evidence') out.evidence = take();
    else if (Object.hasOwn(BUDGET_FLAGS, a)) {
      const key = BUDGET_FLAGS[a];
      if (key) out.budget[key] = parseBudget(a, take({ signed: true }));
    } else throw usage(`unknown flag ${a}`, `see merge-gate ${mode} --help`);
  }
  if (!REMOTE_RE.test(out.remote)) {
    throw usage(`--remote: '${out.remote}' is not a remote name`, 'pass the name of a configured git remote, such as origin or upstream');
  }
  if (out.repoRoot !== null && /^[^/]+\/[^/]+$/.test(out.repoRoot) && !existsSync(out.repoRoot)) {
    throw usage(`--repo-root: '${out.repoRoot}' looks like owner/name and is not a directory`, 'pass the PR URL instead');
  }
  if (mode === 'check') validateCheck(out);
  else validateReplay(out);
  return out;
}

function validateCheck(out: Parsed): void {
  if (out.pr && (out.base || out.head)) throw usage('--pr cannot be combined with --base or --head', 'pass either --pr or --base');
  if (!out.pr && !out.base) throw usage('missing --base or --pr', 'pass --base <ref> or --pr <number|url>');
  if (out.decisionId !== null && !out.pr) throw usage('--decision-id is only valid with --pr', 'pass --pr, or omit --decision-id');
  if (out.decisionId !== null && out.noRecord) throw usage('--decision-id cannot be combined with --no-record', 'drop one of the two flags');
  if (out.decisionId !== null && !/^[A-Za-z0-9._:-]{1,128}$/.test(out.decisionId)) {
    throw usage(`--decision-id: '${out.decisionId}' is not 1-128 characters of [A-Za-z0-9._:-]`, 'use letters, digits, and . _ : -');
  }
}

function validateReplay(out: Parsed): void {
  if (out.all && out.json) throw usage('replay --all --json is not valid', 'pass --jsonl with --all');
  if (out.jsonl && !out.all) throw usage('--jsonl is only valid with replay --all', 'pass --json for a single replay');
  if (out.all && out.evidence) throw usage('replay --all cannot be combined with --evidence', 'pass only one of them');
  if (!out.all && !out.evidence) throw usage('replay requires --evidence or --all', 'pass --evidence <id|path> or --all --jsonl');
}

function parseBudget(flag: string, value: string): number | null {
  if (value === 'none') return null;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw usage(`${flag}: '${value}' is not a non-negative integer or none`, 'pass a non-negative integer or none');
  }
  return Number(value);
}

function parseTimeout(value: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) throw usage(`--timeout: '${value}' is not a positive integer`, 'pass --timeout in seconds');
  return Number(value);
}

function overrides(env: NodeJS.ProcessEnv, noRecord: boolean): string[] {
  const set = OVERRIDE_KEYS.filter(k => env[k] !== undefined && env[k] !== '');
  if (set.length === 0) return [];
  const test = env.GSTACK_EXTEND_MERGE_GATE_TEST === '1';
  const explicit = env.GSTACK_EXTEND_STATE_DIR !== undefined && env.GSTACK_EXTEND_STATE_DIR !== '';
  if (test && (explicit || noRecord)) return [...set];
  throw new GateError(
    'test_env_refused',
    `refusing ${set.join(', ')} outside an explicit test store`,
    'set GSTACK_EXTEND_MERGE_GATE_TEST=1 and GSTACK_EXTEND_STATE_DIR, or pass --no-record',
  );
}

function clock(io: CliIo, honored: string[]): Date {
  if (!honored.includes('GSTACK_EXTEND_MERGE_GATE_NOW')) return io.now();
  const raw = io.env.GSTACK_EXTEND_MERGE_GATE_NOW ?? '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw usage(`GSTACK_EXTEND_MERGE_GATE_NOW: '${raw}' is not a time`, 'pass an ISO-8601 timestamp');
  }
  return date;
}

function timeouts(io: CliIo, parsed: Parsed, honored: string[]): { git: number; gh: number } {
  if (parsed.timeoutSec !== null) return { git: parsed.timeoutSec * 1000, gh: parsed.timeoutSec * 1000 };
  if (honored.includes('GSTACK_EXTEND_MERGE_GATE_TIMEOUT_MS')) {
    const n = Number(io.env.GSTACK_EXTEND_MERGE_GATE_TIMEOUT_MS);
    if (!Number.isFinite(n) || n <= 0) throw usage('GSTACK_EXTEND_MERGE_GATE_TIMEOUT_MS is not a positive number', 'pass milliseconds');
    return { git: n, gh: n };
  }
  return { git: 60_000, gh: 30_000 };
}

function retryMs(io: CliIo, honored: string[]): number {
  if (!honored.includes('GSTACK_EXTEND_MERGE_GATE_RETRY_MS')) return 3000;
  const n = Number(io.env.GSTACK_EXTEND_MERGE_GATE_RETRY_MS);
  if (!Number.isFinite(n) || n < 0) throw usage('GSTACK_EXTEND_MERGE_GATE_RETRY_MS is not a non-negative number', 'pass milliseconds');
  return n;
}

function loadPolicy(parsed: Parsed, io: CliIo): Policy {
  let policy: Policy = { ...DEFAULT_POLICY, exclude: [] };
  if (parsed.policyPath !== null) {
    const source = parsed.policyPath;
    let text: string;
    try {
      text = source === '-' ? io.readStdin() : readFileSync(source, 'utf8');
    } catch (err) {
      throw usage(`--policy: could not read '${source}' (${(err as NodeJS.ErrnoException).code ?? 'error'})`, 'pass a readable JSON file, or - for stdin');
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw usage(`--policy: '${source}' is not JSON`, 'pass a JSON object with the verdict.policy shape');
    }
    if (json === null || typeof json !== 'object' || Array.isArray(json)) {
      throw usage(`--policy: '${source}' is not a JSON object`, 'pass the verdict.policy object');
    }
    const obj = json as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (!POLICY_KEYS.includes(key as typeof POLICY_KEYS[number])) {
        throw usage(`--policy: unknown key '${key}'`, `use only ${POLICY_KEYS.join(', ')}`);
      }
    }
    policy = {
      max_net_lines: policyNum(obj.max_net_lines),
      max_new_files: policyNum(obj.max_new_files),
      max_new_deps: policyNum(obj.max_new_deps),
      max_new_public_api: policyNum(obj.max_new_public_api),
      max_churn: policyNum(obj.max_churn),
      exclude: policyExclude(obj.exclude),
    };
  }
  policy = { ...policy, ...parsed.budget, exclude: [...policy.exclude, ...parsed.exclude] };
  for (const g of policy.exclude) assertGlob(g);
  return normalizePolicy(policy);
}

function policyNum(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  throw usage(`--policy: '${String(value)}' is not a non-negative integer or null`, 'use integers or null');
}

function policyExclude(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) {
    throw usage('--policy: exclude must be an array of globs', 'pass a string array');
  }
  return value as string[];
}

function runCheck(argv: string[], io: CliIo): number {
  const parsed = parseFlags(argv, 'check');
  const honored = overrides(io.env, parsed.noRecord);
  const now = () => clock(io, honored);
  const policy = loadPolicy(parsed, io);
  const cwd = parsed.repoRoot ? resolve(io.cwd, parsed.repoRoot) : io.cwd;
  if (parsed.repoRoot && !existsSync(cwd)) {
    throw usage(`--repo-root: '${parsed.repoRoot}' is not a directory`, 'pass a checkout path');
  }
  let prNumber: string | undefined;
  let prUrl: CollectInput['prUrl'];
  if (parsed.pr) {
    if (/^[1-9][0-9]*$/.test(parsed.pr)) prNumber = parsed.pr;
    else {
      const m = PR_URL_RE.exec(parsed.pr);
      if (!m) throw usage(`--pr: '${parsed.pr}' is not a positive number or an https pull URL`, 'pass 123 or https://host/owner/repo/pull/123');
      prUrl = { host: m[1] ?? '', owner: m[2] ?? '', name: m[3] ?? '', number: m[4] ?? '' };
    }
  }
  const limits = timeouts(io, parsed, honored);
  if (parsed.decisionId) {
    const repo = prUrl ?? remoteRepo(io, parsed, cwd, limits);
    const number = Number(prNumber ?? prUrl?.number);
    if (repo) {
      const key = decisionKey(repo, number, parsed.decisionId);
      const recorded = readDecision(io.env, key);
      if (recorded) {
        ensureLogged(io.env, key, recorded);
        emitVerdict(io, parsed, recorded, evidencePath(io.env, recorded.evidence_id), true);
        return 0;
      }
    }
  }
  const { evidence, canonical } = collect({
    cwd,
    env: io.env,
    mode: parsed.pr ? 'pr' : 'git',
    ...(parsed.base ? { baseRef: parsed.base } : {}),
    headRef: parsed.head ?? 'HEAD',
    ...(prNumber ? { prNumber } : {}),
    ...(prUrl ? { prUrl } : {}),
    remote: parsed.remote,
    decisionId: parsed.decisionId,
    gitTimeoutMs: limits.git,
    ghTimeoutMs: limits.gh,
    retryMs: retryMs(io, honored),
    now,
    clockOverridden: honored.includes('GSTACK_EXTEND_MERGE_GATE_NOW'),
    testOverrides: honored,
    debug: io.env.GSTACK_EXTEND_MERGE_GATE_DEBUG === '1',
  });
  const id = sha256Hex(canonical);
  const verdict = decide(evidence, policy, now(), { evidenceId: id, replay: false, gstackVersion: installVersion() });
  if (parsed.noRecord) {
    emitVerdict(io, parsed, verdict, null, false);
    return 0;
  }
  const path = writeEvidence(io.env, Buffer.from(canonical), id);
  if (parsed.decisionId && evidence.pr) {
    const key = decisionKey(evidence.pr.repo, evidence.pr.number, parsed.decisionId);
    const created = publishDecision(io.env, key, verdict) === 'created';
    const winner = created ? verdict : readDecision(io.env, key) ?? verdict;
    ensureLogged(io.env, key, winner);
    emitVerdict(io, parsed, winner, created ? path : evidencePath(io.env, winner.evidence_id), !created);
    return 0;
  }
  appendVerdict(io.env, verdict);
  emitVerdict(io, parsed, verdict, path, false);
  return 0;
}

/** owner/name of the selected remote, for a number-form decision lookup; null when it cannot be read. */
function remoteRepo(io: CliIo, parsed: Parsed, cwd: string, limits: { git: number; gh: number }): { owner: string; name: string } | null {
  const base = { parentEnv: io.env, gitTimeoutMs: limits.git, ghTimeoutMs: limits.gh, debug: false };
  let top: string;
  let opts: typeof base & { safeDirectories: string[] };
  try {
    opts = { ...base, safeDirectories: createGateway({ ...base, cwd }).safeDirectories() };
    top = createGateway({ ...opts, cwd }).toplevel();
  } catch {
    return null;
  }
  const url = createGateway({ ...opts, cwd: top }).remoteUrl(parsed.remote);
  return url ? parseRemote(url) : null;
}

function emitVerdict(io: CliIo, parsed: Parsed, verdict: Verdict, path: string | null, idempotentHit: boolean): void {
  const printed = { ...verdict, evidence_path: path, ...(idempotentHit ? { idempotent: true } : {}) };
  if (parsed.json || parsed.jsonl) io.stdout(canonicalJson(printed) + '\n');
  else io.stdout(human(verdict, path) + '\n');
}

function human(verdict: Verdict, path: string | null): string {
  const yn = (b: boolean) => (b ? 'yes' : 'no');
  const ready = verdict.ready === null ? 'not checked' : yn(verdict.ready);
  const m = verdict.metrics;
  const p = verdict.policy;
  const lim = (n: number | null) => (n === null ? 'off' : String(n));
  const top = m.top_churn_files.map(f => `${f.path} (${f.churn})`).join(', ');
  const lines = [
    `WOULD_MERGE: ${yn(verdict.would_merge)}`,
    'MODE: shadow',
    `GATE: v${verdict.gate_version}`,
    `TIMING: ${verdict.timing}`,
    `SUBJECT: ${subjectLine(verdict)}`,
    `VERDICTS: within_budget=${yn(verdict.within_budget)} ready=${ready} evidence_complete=${yn(verdict.evidence_complete)}`,
    `METRICS: net_lines=${m.net_lines}/${lim(p.max_net_lines)} churn=${m.churn}/${lim(p.max_churn)} new_files=${m.new_files}/${lim(p.max_new_files)} new_deps=${m.new_deps}/${lim(p.max_new_deps)} new_public_api=${m.new_public_api}/${lim(p.max_new_public_api)}`,
    `TOP_CHURN: ${top}`,
    'REASONS:',
    ...verdict.reasons.map(r => `- ${r.code}: ${r.detail} (${r.blocking ? 'blocking' : 'info'})`),
    'DOCS: docs/merge-gate.md#reasons',
    path ? `EVIDENCE: ${verdict.evidence_id}` : 'EVIDENCE: not recorded (--no-record)',
  ];
  return lines.map(stripCtl).join('\n');
}

function subjectLine(verdict: Verdict): string {
  const head = verdict.subject.head_sha.slice(0, 7);
  const base = verdict.subject.base_sha.slice(0, 7);
  if (verdict.timing === 'unanchored') return `${verdict.subject.origin ?? 'local'} ${base}..${head}`;
  return `${shortRepo(verdict.subject.origin ?? '', verdict.subject.pr_url)}#${verdict.subject.pr_number ?? ''} @ ${head}`;
}

function shortRepo(origin: string, prUrl: string | null): string {
  const m = prUrl ? /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\//.exec(prUrl) : null;
  return m ? `${m[1]}/${m[2]}/${m[3]}` : origin || 'local';
}

/** Human output drops C0, DEL, C1, and bidi controls from repository-supplied text (CEO-R3). */
function stripCtl(s: string): string {
  return s.replace(/[\u0000-\u001F\u007F-\u009F؜‎‏‪-‮⁦-⁩]/g, '');
}

function runReplay(argv: string[], io: CliIo): number {
  const parsed = parseFlags(argv, 'replay');
  const honored = overrides(io.env, true);
  const now = () => clock(io, honored);
  const policy = loadPolicy(parsed, io);
  if (parsed.all) return replayAll(io, parsed, policy, now);
  const target = parsed.evidence ?? '';
  let path: string;
  if (/^[0-9a-f]{64}$/.test(target)) {
    checkStore(io.env);
    path = evidencePath(io.env, target);
  } else {
    path = isAbsolute(target) ? target : resolve(io.cwd, target);
  }
  const loaded = readEvidenceFile(path);
  emitVerdict(io, parsed, replayOne(loaded.value, loaded.id, policy, now()), path, false);
  return 0;
}

/**
 * CEO-S6 and DX-12: every stored evidence file, ordered by `observed_at` then id.
 * The first pass keeps only the sort key, so files are decided one at a time.
 */
function replayAll(io: CliIo, parsed: Parsed, policy: Policy, now: () => Date): number {
  const index = listEvidence(io.env).map(path => {
    let at = '';
    try {
      const value = readEvidenceFile(path).value as { observed_at?: unknown } | null;
      if (value && typeof value.observed_at === 'string') at = value.observed_at;
    } catch {
      // Reported with its code in the second pass.
    }
    return { id: basename(path, '.json'), at, path };
  });
  index.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let failed = false;
  for (const row of index) {
    try {
      const loaded = readEvidenceFile(row.path);
      const verdict = replayOne(loaded.value, loaded.id, policy, now());
      if (parsed.jsonl) emitVerdict(io, parsed, verdict, row.path, false);
      else {
        const blocking = verdict.reasons.filter(r => r.blocking).map(r => r.code).join(',') || '-';
        io.stdout(stripCtl(`${verdict.would_merge ? 'yes' : 'no'} ${verdict.evidence_id} ${subjectLine(verdict)} ${blocking}`) + '\n');
      }
    } catch (err) {
      if (!isGateError(err)) throw err;
      failed = true;
      if (parsed.jsonl) io.stdout(canonicalJson({ v: 1, evidence_id: row.id, error: errorBody(err.code, err.message, err.fix, err.doc) }) + '\n');
      else io.stdout(`error ${row.id} ${err.code}\n`);
    }
  }
  return failed ? 1 : 0;
}

function replayOne(value: unknown, id: string, policy: Policy, now: Date): Verdict {
  if (value === null || typeof value !== 'object') {
    throw new GateError('evidence_corrupt', 'evidence is not an object', 'restore the original evidence file');
  }
  const { v, collector_version: collector } = value as { v?: unknown; collector_version?: unknown };
  if (v !== EVIDENCE_V) {
    throw new GateError('evidence_unsupported_version', `evidence v is ${String(v)}`, `this gate reads evidence v${EVIDENCE_V} only`);
  }
  if (typeof collector === 'number' && collector > COLLECTOR_VERSION) {
    throw new GateError(
      'evidence_unsupported_version',
      `evidence collector_version ${collector} is newer than this gate's ${COLLECTOR_VERSION}`,
      'upgrade gstack-extend to replay this evidence',
    );
  }
  if (!validateEvidence(value)) {
    throw new GateError('evidence_corrupt', 'evidence is missing required fields or has mistyped ones', 'restore the original evidence file');
  }
  return decide(value, policy, now, { evidenceId: id, replay: true, gstackVersion: installVersion() });
}

function printVersion(io: CliIo, json: boolean): void {
  const body = {
    gate_version: GATE_VERSION,
    collector_version: COLLECTOR_VERSION,
    gstack_extend_version: installVersion(),
    evidence_v: EVIDENCE_V,
    verdict_v: VERDICT_V,
  };
  if (json) io.stdout(canonicalJson(body) + '\n');
  else io.stdout(Object.entries(body).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n');
}

const BUDGET_HELP = [
  'Budget flags (a number, or none to turn a limit off):',
  '  --max-net-lines N      default 500',
  '  --max-new-files N      default 10',
  '  --max-new-deps N       default 0',
  '  --max-new-public-api N default 10',
  '  --max-churn N          default none',
  '  --exclude <glob>       repeatable; * within a segment, ** across segments',
  '  --policy <path|->      a verdict.policy JSON object; flags override it',
];

function helpText(argv: string[]): string {
  const sub = argv.find(a => a === 'check' || a === 'replay') ?? '';
  const check = [
    'merge-gate check --base <ref> [--head <ref>] [--repo-root <path>] [budget flags] [--json] [--no-record]',
    'merge-gate check --pr <number|url> [--repo-root <path>] [--remote <name>] [--decision-id <id>] [--timeout <s>] [budget flags] [--json] [--no-record]',
  ];
  const replay = ['merge-gate replay (--evidence <id|path> [--json] | --all [--jsonl]) [budget flags]'];
  const lines = sub === 'check' ? check : sub === 'replay' ? replay : [...check, ...replay, 'merge-gate --version [--json]'];
  return [
    ...lines,
    '',
    'merge-gate answers would-merge in shadow mode only. It cannot merge.',
    '',
    ...BUDGET_HELP,
    '',
    'Examples:',
    '  merge-gate check --base main --no-record',
    '  merge-gate check --pr 123 --json',
    '  merge-gate replay --evidence <id> --json',
  ].join('\n');
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(code => process.exit(code));
}
