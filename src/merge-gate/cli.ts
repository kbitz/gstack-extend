import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { canonicalJson, sha256Hex } from './canon.ts';
import { collect, installVersion, type CollectInput } from './collect.ts';
import { createGateway } from './exec.ts';
import { stripRemoteUrl } from './redact.ts';
import { decide, normalizePolicy, validateEvidence, type Evidence, type Policy, type Verdict } from './decide.ts';
import { GateError, isGateError } from './errors.ts';
import { assertGlob } from './glob.ts';
import {
  COLLECTOR_VERSION,
  DEFAULT_POLICY,
  EVIDENCE_V,
  GATE_VERSION,
  POLICY_KEYS,
  VERDICT_V,
} from './registry.ts';
import {
  appendVerdict,
  decisionKey,
  evidencePath,
  listEvidence,
  readDecision,
  readEvidenceFile,
  readVerdictLog,
  stateRoot,
  writeDecision,
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

function report(err: unknown, io: CliIo, json: boolean): number {
  if (isGateError(err)) {
    const body = { v: 1, error: { code: err.code, message: err.message, fix: err.fix, doc: err.doc } };
    if (json) io.stdout(canonicalJson(body) + '\n');
    else {
      io.stderr(`ERROR ${err.code}: ${err.message}\n`);
      io.stderr(`FIX: ${err.fix}\n`);
    }
    return err.code === 'usage' ? 2 : 1;
  }
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack ?? message : message;
  io.stderr(stack + '\n');
  const body = {
    v: 1,
    error: {
      code: 'internal_error',
      message,
      fix: 'report this as a gate bug',
      doc: 'docs/merge-gate.md#errors',
    },
  };
  if (json) io.stdout(canonicalJson(body) + '\n');
  else {
    io.stderr(`ERROR internal_error: ${message}\n`);
    io.stderr('FIX: report this as a gate bug\n');
  }
  return 1;
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

function parseFlags(argv: string[], mode: 'check' | 'replay'): Parsed {
  const out: Parsed = {
    json: false, jsonl: false, noRecord: false, repoRoot: null, remote: 'origin',
    policyPath: null, exclude: [], budget: {}, timeoutSec: null, decisionId: null,
    base: null, head: null, pr: null, evidence: null, all: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    const take = (flag: string, allowSigned = false): string => {
      const next = argv[i + 1];
      const missing = next === undefined || (!allowSigned && next.startsWith('-'));
      if (missing) {
        throw new GateError('usage', `${flag} requires a value`, `pass a value after ${flag}`);
      }
      i++;
      return next ?? '';
    };
    if (a === '--json') { out.json = true; continue; }
    if (a === '--jsonl') { out.jsonl = true; continue; }
    if (a === '--no-record') { out.noRecord = true; continue; }
    if (a === '--all') { out.all = true; continue; }
    if (a === '--repo-root') {
      const value = take(a);
      if (/^[^/]+\/[^/]+$/.test(value) && !existsSync(value)) {
        throw new GateError('usage', `--repo-root: '${value}' looks like owner/name and is not a directory`, 'pass the PR URL instead');
      }
      out.repoRoot = value;
      continue;
    }
    if (a === '--remote') { out.remote = take(a); continue; }
    if (a === '--policy') { out.policyPath = take(a); continue; }
    if (a === '--exclude') {
      const g = take(a);
      assertGlob(g);
      out.exclude.push(g);
      continue;
    }
    if (a === '--decision-id') { out.decisionId = take(a); continue; }
    if (a === '--timeout') { out.timeoutSec = parseTimeout(take(a)); continue; }
    if (a === '--base') { out.base = take(a); continue; }
    if (a === '--head') { out.head = take(a); continue; }
    if (a === '--pr') { out.pr = take(a); continue; }
    if (a === '--evidence') { out.evidence = take(a); continue; }
    if (a.startsWith('--max-')) {
      const key = budgetKey(a);
      out.budget[key] = parseBudget(a, take(a, true));
      continue;
    }
    throw new GateError('usage', `unknown flag ${a}`, 'see merge-gate --help');
  }
  if (mode === 'check') {
    if (out.pr && (out.base || out.head)) {
      throw new GateError('usage', '--pr cannot be combined with --base or --head', 'pass either --pr or --base');
    }
    if (!out.pr && !out.base) throw new GateError('usage', 'missing --base or --pr', 'pass --base <ref> or --pr <number|url>');
    if (out.base?.startsWith('-') || out.head?.startsWith('-')) {
      throw new GateError('usage', 'a ref starting with - is not allowed', 'pass the ref after --end-of-options style, without a leading dash');
    }
    if (out.decisionId !== null && !out.pr) {
      throw new GateError('usage', '--decision-id is only valid with --pr', 'pass --pr, or omit --decision-id');
    }
    if (out.decisionId !== null && out.noRecord) {
      throw new GateError('usage', '--decision-id cannot be combined with --no-record', 'drop one of the two flags');
    }
    if (out.decisionId !== null && !/^[A-Za-z0-9._:-]{1,128}$/.test(out.decisionId)) {
      throw new GateError('usage', `--decision-id: '${out.decisionId}' is not 1-128 characters of [A-Za-z0-9._:-]`, 'use letters, digits, and . _ : -');
    }
  } else {
    if (out.all && out.json) throw new GateError('usage', 'replay --all --json is not valid', 'pass --jsonl with --all');
    if (!out.all && !out.evidence) {
      throw new GateError('usage', 'replay requires --evidence or --all', 'pass --evidence <id|path> or --all --jsonl');
    }
    if (out.all && out.evidence) {
      throw new GateError('usage', 'replay --all cannot be combined with --evidence', 'pass only one of them');
    }
  }
  return out;
}

function budgetKey(flag: string): keyof Policy {
  const map: Record<string, keyof Policy> = {
    '--max-net-lines': 'max_net_lines',
    '--max-new-files': 'max_new_files',
    '--max-new-deps': 'max_new_deps',
    '--max-new-public-api': 'max_new_public_api',
    '--max-churn': 'max_churn',
  };
  const key = map[flag];
  if (!key) throw new GateError('usage', `unknown flag ${flag}`, 'see merge-gate --help');
  return key;
}

function parseBudget(flag: string, value: string): number | null {
  if (value === 'none') return null;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new GateError('usage', `${flag}: '${value}' is not a non-negative integer or none`, 'pass a non-negative integer or none');
  }
  return Number(value);
}

function parseTimeout(value: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new GateError('usage', `--timeout: '${value}' is not a positive integer`, 'pass --timeout in seconds');
  }
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
  if (honored.includes('GSTACK_EXTEND_MERGE_GATE_NOW')) {
    const raw = io.env.GSTACK_EXTEND_MERGE_GATE_NOW ?? '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      throw new GateError('usage', `GSTACK_EXTEND_MERGE_GATE_NOW: '${raw}' is not a time`, 'pass an ISO-8601 timestamp');
    }
    return date;
  }
  return io.now();
}

function timeouts(io: CliIo, parsed: Parsed, honored: string[]): { git: number; gh: number } {
  if (parsed.timeoutSec !== null) return { git: parsed.timeoutSec * 1000, gh: parsed.timeoutSec * 1000 };
  if (honored.includes('GSTACK_EXTEND_MERGE_GATE_TIMEOUT_MS')) {
    const n = Number(io.env.GSTACK_EXTEND_MERGE_GATE_TIMEOUT_MS);
    if (!Number.isFinite(n) || n <= 0) {
      throw new GateError('usage', 'GSTACK_EXTEND_MERGE_GATE_TIMEOUT_MS is not a positive number', 'pass milliseconds');
    }
    return { git: n, gh: n };
  }
  return { git: 60_000, gh: 30_000 };
}

function retryMs(io: CliIo, honored: string[]): number {
  if (!honored.includes('GSTACK_EXTEND_MERGE_GATE_RETRY_MS')) return 3000;
  const n = Number(io.env.GSTACK_EXTEND_MERGE_GATE_RETRY_MS);
  if (!Number.isFinite(n) || n < 0) {
    throw new GateError('usage', 'GSTACK_EXTEND_MERGE_GATE_RETRY_MS is not a non-negative number', 'pass milliseconds');
  }
  return n;
}

function loadPolicy(parsed: Parsed, io: CliIo): Policy {
  let policy: Policy = { ...DEFAULT_POLICY, exclude: [] };
  if (parsed.policyPath !== null) {
    const text = parsed.policyPath === '-' ? io.readStdin() : readFileSync(parsed.policyPath, 'utf8');
    let json: unknown;
    try { json = JSON.parse(text); } catch {
      throw new GateError('usage', `--policy: '${parsed.policyPath}' is not JSON`, 'pass a JSON object with the verdict.policy shape');
    }
    if (json === null || typeof json !== 'object' || Array.isArray(json)) {
      throw new GateError('usage', '--policy must be a JSON object', 'pass the verdict.policy object');
    }
    const obj = json as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (!POLICY_KEYS.includes(key as typeof POLICY_KEYS[number])) {
        throw new GateError('usage', `--policy: unknown key '${key}'`, `use only ${POLICY_KEYS.join(', ')}`);
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
  throw new GateError('usage', `--policy: '${String(value)}' is not a non-negative integer or null`, 'use integers or null');
}

function policyExclude(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) {
    throw new GateError('usage', '--policy: exclude must be an array of globs', 'pass a string array');
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
    throw new GateError('usage', `--repo-root: '${parsed.repoRoot}' is not a directory`, 'pass a checkout path');
  }
  let prNumber: string | undefined;
  let prUrl: CollectInput['prUrl'];
  if (parsed.pr) {
    if (/^[1-9][0-9]*$/.test(parsed.pr)) prNumber = parsed.pr;
    else {
      const m = PR_URL_RE.exec(parsed.pr);
      if (!m) throw new GateError('usage', `--pr: '${parsed.pr}' is not a positive number or an https pull URL`, 'pass 123 or https://host/owner/repo/pull/123');
      prUrl = { host: m[1] ?? '', owner: m[2] ?? '', name: m[3] ?? '', number: m[4] ?? '' };
    }
  }
  if (parsed.decisionId) {
    const early = lookupDecision(io, parsed, cwd, prNumber ?? prUrl?.number ?? '');
    if (early) {
      emitVerdict(io, parsed, early, evidencePath(io.env, early.evidence_id), true);
      return 0;
    }
  }
  const input: CollectInput = {
    cwd,
    env: io.env,
    mode: parsed.pr ? 'pr' : 'git',
    ...(parsed.base ? { baseRef: parsed.base } : {}),
    headRef: parsed.head ?? 'HEAD',
    ...(prNumber ? { prNumber } : {}),
    ...(prUrl ? { prUrl } : {}),
    remote: parsed.remote,
    decisionId: parsed.decisionId,
    gitTimeoutMs: timeouts(io, parsed, honored).git,
    ghTimeoutMs: timeouts(io, parsed, honored).gh,
    retryMs: retryMs(io, honored),
    now,
    clockOverridden: honored.includes('GSTACK_EXTEND_MERGE_GATE_NOW'),
    testOverrides: honored,
    debug: io.env.GSTACK_EXTEND_MERGE_GATE_DEBUG === '1',
  };
  const { evidence, canonical } = collect(input);
  const id = sha256Hex(canonical);
  const verdict = decide(evidence, policy, now(), { evidenceId: id, replay: false, gstackVersion: installVersion() });
  let path: string | null = null;
  if (!parsed.noRecord) {
    const bytes = Buffer.from(canonical);
    path = writeEvidence(io.env, bytes, id);
    if (parsed.decisionId && verdict.subject.origin && verdict.subject.pr_number !== null) {
      const key = decisionKey(verdict.subject.origin, verdict.subject.pr_number, parsed.decisionId);
      const created = writeDecision(io.env, key, verdict);
      if (created === 'exists') {
        const winner = readDecision(io.env, key);
        if (winner) {
          emitVerdict(io, parsed, winner, evidencePath(io.env, winner.evidence_id), true);
          return 0;
        }
      }
    }
    appendVerdict(io.env, verdict);
  }
  emitVerdict(io, parsed, verdict, path, false);
  return 0;
}

function lookupDecision(io: CliIo, parsed: Parsed, cwd: string, prNumber: string): Verdict | null {
  if (!parsed.decisionId || prNumber === '') return null;
  const limits = timeouts(io, parsed, []);
  const gateway = createGateway({
    cwd,
    parentEnv: io.env,
    gitTimeoutMs: limits.git,
    ghTimeoutMs: limits.gh,
    debug: false,
  });
  let top = cwd;
  try { top = gateway.toplevel(); } catch { return null; }
  const rooted = createGateway({
    cwd: top,
    parentEnv: io.env,
    gitTimeoutMs: limits.git,
    ghTimeoutMs: limits.gh,
    debug: false,
  });
  const url = rooted.remoteUrl(parsed.remote);
  if (!url) return null;
  const origin = stripRemoteUrl(url);
  const key = decisionKey(origin, Number(prNumber), parsed.decisionId);
  return readDecision(io.env, key);
}

function emitVerdict(io: CliIo, parsed: Parsed, verdict: Verdict, path: string | null, idempotentHit: boolean): void {
  const printed = { ...verdict, evidence_path: path, ...(idempotentHit ? { idempotent: true } : {}) };
  if (parsed.json) io.stdout(canonicalJson(printed) + '\n');
  else io.stdout(human(verdict, path) + '\n');
}

function human(verdict: Verdict, path: string | null): string {
  const yn = (b: boolean) => (b ? 'yes' : 'no');
  const ready = verdict.ready === null ? 'not checked' : yn(verdict.ready);
  const lim = (n: number | null) => (n === null ? 'off' : String(n));
  const subject = subjectLine(verdict);
  const top = verdict.metrics.top_churn_files.map(f => `${stripCtl(f.path)} (${f.churn})`).join(', ');
  const lines = [
    `WOULD_MERGE: ${yn(verdict.would_merge)}`,
    'MODE: shadow',
    `GATE: v${verdict.gate_version}`,
    `TIMING: ${verdict.timing}`,
    `SUBJECT: ${subject}`,
    `VERDICTS: within_budget=${yn(verdict.within_budget)} ready=${ready} evidence_complete=${yn(verdict.evidence_complete)}`,
    `METRICS: net_lines=${verdict.metrics.net_lines}/${lim(verdict.policy.max_net_lines)} churn=${verdict.metrics.churn}/${lim(verdict.policy.max_churn)} new_files=${verdict.metrics.new_files}/${lim(verdict.policy.max_new_files)} new_deps=${verdict.metrics.new_deps}/${lim(verdict.policy.max_new_deps)} new_public_api=${verdict.metrics.new_public_api}/${lim(verdict.policy.max_new_public_api)}`,
    `TOP_CHURN: ${top}`,
    'REASONS:',
    ...verdict.reasons.map(r => `- ${r.code}: ${stripCtl(r.detail)} (${r.blocking ? 'blocking' : 'info'})`),
    'DOCS: docs/merge-gate.md#reasons',
    path ? `EVIDENCE: ${verdict.evidence_id}` : 'EVIDENCE: not recorded (--no-record)',
  ];
  return lines.join('\n');
}

function subjectLine(verdict: Verdict): string {
  const head = verdict.subject.head_sha.slice(0, 7);
  const base = verdict.subject.base_sha.slice(0, 7);
  if (verdict.timing === 'unanchored') {
    return `${stripCtl(verdict.subject.origin ?? 'local')} ${base}..${head}`;
  }
  const origin = verdict.subject.origin ?? '';
  const id = parseOriginShort(origin, verdict.subject.pr_url);
  return `${stripCtl(id)}#${verdict.subject.pr_number ?? ''} @ ${head}`;
}

function parseOriginShort(origin: string, prUrl: string | null): string {
  if (prUrl) {
    try {
      const u = new URL(prUrl);
      const parts = u.pathname.split('/').filter(Boolean);
      const pull = parts.indexOf('pull');
      if (pull >= 2) return `${u.host}/${parts[pull - 2]}/${parts[pull - 1]}`;
    } catch { /* fall through */ }
  }
  return origin || 'local';
}

function stripCtl(s: string): string {
  return s.replace(/[\u0000-\u001F\u007F]/g, '');
}

function runReplay(argv: string[], io: CliIo): number {
  const parsed = parseFlags(argv, 'replay');
  const honored = overrides(io.env, true);
  const now = () => clock(io, honored);
  const policy = loadPolicy(parsed, io);
  if (parsed.all) return replayAll(io, parsed, policy, now);
  const target = parsed.evidence ?? '';
  const path = /^[0-9a-f]{64}$/.test(target) ? evidencePath(io.env, target) : (isAbsolute(target) ? target : resolve(io.cwd, target));
  const loaded = readEvidenceFile(path);
  const verdict = replayOne(loaded.value, loaded.id, policy, now(), io);
  emitVerdict(io, parsed, verdict, path, false);
  return 0;
}

function replayAll(io: CliIo, parsed: Parsed, policy: Policy, now: () => Date): number {
  const files = listEvidence(io.env);
  const rows: { id: string; at: string; path: string; value: unknown }[] = [];
  for (const path of files) {
    try {
      const loaded = readEvidenceFile(path);
      const at = loaded.value !== null && typeof loaded.value === 'object' && 'observed_at' in (loaded.value as object)
        ? String((loaded.value as { observed_at?: unknown }).observed_at ?? '')
        : '';
      rows.push({ id: loaded.id, at, path, value: loaded.value });
    } catch (err) {
      rows.push({ id: path, at: '', path, value: err });
    }
  }
  rows.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let failed = false;
  for (const row of rows) {
    if (row.value instanceof GateError || row.value instanceof Error) {
      failed = true;
      const err = row.value instanceof GateError ? row.value : new GateError('evidence_corrupt', 'unreadable evidence', 'restore the file');
      if (parsed.jsonl) {
        io.stdout(canonicalJson({ v: 1, evidence_id: row.id, error: { code: err.code, message: err.message, fix: err.fix, doc: err.doc } }) + '\n');
      } else {
        io.stdout(`no ${row.id} unreadable ${err.code}\n`);
      }
      continue;
    }
    try {
      const verdict = replayOne(row.value, row.id, policy, now(), io);
      if (parsed.jsonl) emitVerdict(io, { ...parsed, json: true }, verdict, row.path, false);
      else {
        const blocking = verdict.reasons.filter(r => r.blocking).map(r => r.code).join(',') || '-';
        io.stdout(`${verdict.would_merge ? 'yes' : 'no'} ${verdict.evidence_id} ${subjectLine(verdict)} ${blocking}\n`);
      }
    } catch (err) {
      failed = true;
      const gate = isGateError(err) ? err : new GateError('evidence_corrupt', 'unreadable evidence', 'restore the file');
      if (parsed.jsonl) {
        io.stdout(canonicalJson({ v: 1, evidence_id: row.id, error: { code: gate.code, message: gate.message, fix: gate.fix, doc: gate.doc } }) + '\n');
      } else io.stdout(`no ${row.id} ${subjectLineSafe()} ${gate.code}\n`);
    }
  }
  void readVerdictLog;
  return failed ? 1 : 0;
}

function subjectLineSafe(): string {
  return '-';
}

function replayOne(value: unknown, id: string, policy: Policy, now: Date, io: CliIo): Verdict {
  if (value === null || typeof value !== 'object') {
    throw new GateError('evidence_corrupt', 'evidence is not an object', 'restore the original evidence file');
  }
  const v = (value as { v?: unknown }).v;
  if (v !== EVIDENCE_V) {
    throw new GateError('evidence_unsupported_version', `evidence v is ${String(v)}`, 'this gate reads evidence v1 only');
  }
  if (!validateEvidence(value)) {
    throw new GateError('evidence_corrupt', 'evidence is missing required fields', 'restore the original evidence file');
  }
  void io;
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
  else {
    io.stdout(`gate_version: ${body.gate_version}\ncollector_version: ${body.collector_version}\ngstack_extend_version: ${body.gstack_extend_version}\nevidence_v: ${body.evidence_v}\nverdict_v: ${body.verdict_v}\n`);
  }
}

function helpText(argv: string[]): string {
  const sub = argv.find(a => a === 'check' || a === 'replay') ?? '';
  const examples = [
    'merge-gate check --base main --no-record',
    'merge-gate check --pr 123 --json',
    'merge-gate replay --evidence <id> --json',
  ];
  const common = [
    'merge-gate answers would-merge in shadow mode only. It cannot merge.',
    '',
    ...examples,
  ];
  if (sub === 'check') {
    return [
      'merge-gate check --base <ref> [--head <ref>] [--repo-root <path>] [budget] [--json] [--no-record]',
      'merge-gate check --pr <number|url> [--repo-root <path>] [--remote <name>] [budget] [--json] [--no-record]',
      '',
      ...common,
    ].join('\n');
  }
  if (sub === 'replay') {
    return [
      'merge-gate replay (--evidence <id|path> [--json] | --all [--jsonl]) [budget]',
      '',
      ...common,
    ].join('\n');
  }
  return [
    'merge-gate check --base <ref> [--head <ref>] [--repo-root <path>] [common] [--json] [--no-record]',
    'merge-gate check --pr <number|url> [--repo-root <path>] [--remote <name>] [common] [--json] [--no-record]',
    'merge-gate replay (--evidence <id|path> [--json] | --all [--jsonl]) [budget flags]',
    'merge-gate --version [--json]',
    '',
    ...common,
  ].join('\n');
}

void readdirSync;
void readVerdictLog;

if (import.meta.main) {
  main(process.argv.slice(2)).then(code => process.exit(code));
}
