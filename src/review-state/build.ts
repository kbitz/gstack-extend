import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { DELEGATE_RUNNER_EXTRA_KEYS, HEX64_RE, isIsoZ, isObj, isStr, SCHEMA_VERSION, STATE_KEYS, toPartLabel, truncate80, validateStoredState, type CommandName, type CorrectionRecord, type DelegationPolicy, type EvidenceRef, type Violation } from './state.ts';
import { checkDirFile, executeCommand, makeEnvelope, readHelperVersion, unlinkQuiet, validateStateDir, writeAll, type StoreResult } from './store.ts';

export const BUILD_COMMANDS = ['start', 'record pass', 'record correction', 'record gate', 'record audit', 'checkpoint', 'finish'] as const satisfies readonly CommandName[];
export const PASS_STATES = ['started', 'attempt', 'voice-complete', 'completed'] as const;
export type PassState = (typeof PASS_STATES)[number];
export type FlagKind = 'string' | 'int' | 'number-or-string' | 'list' | 'presence' | 'file';
export type FlagRow = { flag: string; key: string; kind: FlagKind; required: boolean; repeatable?: boolean };

export const START_FLAGS: readonly FlagRow[] = [
  { flag: '--run-id', key: 'run_id', kind: 'string', required: true },
  { flag: '--base', key: 'base', kind: 'string', required: true },
  { flag: '--wtree', key: 'wtree', kind: 'string', required: false },
  { flag: '--pr-url', key: 'pr.url', kind: 'string', required: false },
  { flag: '--pr-repo', key: 'pr.repo', kind: 'string', required: false },
  { flag: '--pr-number', key: 'pr.number', kind: 'int', required: false },
  { flag: '--pr-head-repo', key: 'pr.head_repo', kind: 'string', required: false },
  { flag: '--pr-head-branch', key: 'pr.head_branch', kind: 'string', required: false },
  { flag: '--pr-base-ref', key: 'pr.base_ref', kind: 'string', required: false },
  { flag: '--gh-login', key: 'gh_login', kind: 'string', required: false },
  { flag: '--plan-ref', key: 'plan.ref', kind: 'string', required: true },
  { flag: '--plan-sha256', key: 'plan.sha256', kind: 'string', required: true },
  { flag: '--policy-value', key: 'policy.value', kind: 'string', required: false },
  { flag: '--policy-source', key: 'policy.source', kind: 'string', required: true },
  { flag: '--delegation-line', key: 'policy.delegation', kind: 'string', required: false },
  { flag: '--prior-stops', key: 'continuation.prior_stops', kind: 'int', required: false },
  { flag: '--max-continuations', key: 'continuation.max', kind: 'int', required: true },
  { flag: '--continues', key: 'continuation.continues', kind: 'string', required: false },
  { flag: '--session-id', key: 'session_id', kind: 'string', required: false },
];

export const PASS_STATE_FLAGS: Record<PassState, readonly FlagRow[]> = {
  started: [
    { flag: '--pass-id', key: 'pass_id', kind: 'string', required: true },
    { flag: '--state', key: 'state', kind: 'string', required: true },
    { flag: '--scope', key: 'scope', kind: 'string', required: true },
    { flag: '--cycle', key: 'cycle', kind: 'int', required: true },
    { flag: '--coverage', key: 'coverage', kind: 'string', required: true },
    { flag: '--delta-from', key: 'delta_from', kind: 'string', required: false },
    { flag: '--commit', key: 'candidate.commit', kind: 'string', required: true },
    { flag: '--base', key: 'candidate.base', kind: 'string', required: false },
    { flag: '--wtree', key: 'candidate.wtree', kind: 'string', required: false },
    { flag: '--voice', key: 'required_voices', kind: 'list', required: true, repeatable: true },
  ],
  attempt: [
    { flag: '--pass-id', key: 'pass_id', kind: 'string', required: true },
    { flag: '--state', key: 'state', kind: 'string', required: true },
    { flag: '--voice-id', key: 'voice_id', kind: 'string', required: true },
    { flag: '--part', key: 'part', kind: 'string', required: false },
    { flag: '--attempt-id', key: 'attempt_id', kind: 'string', required: true },
    { flag: '--outcome', key: 'outcome', kind: 'string', required: false },
    { flag: '--predecessor-attempt-id', key: 'predecessor_attempt_id', kind: 'string', required: false },
    { flag: '--dispatched-at', key: 'dispatched_at', kind: 'string', required: false },
    { flag: '--returned-at', key: 'returned_at', kind: 'string', required: false },
    { flag: '--delegate-file', key: 'delegate', kind: 'file', required: false },
    { flag: '--finding', key: 'findings', kind: 'list', required: false, repeatable: true },
  ],
  'voice-complete': [
    { flag: '--pass-id', key: 'pass_id', kind: 'string', required: true },
    { flag: '--state', key: 'state', kind: 'string', required: true },
    { flag: '--voice-id', key: 'voice_id', kind: 'string', required: true },
    { flag: '--selected-attempt-id', key: 'selected_attempt_id', kind: 'string', required: false },
    { flag: '--not-applicable', key: 'not_applicable', kind: 'string', required: false },
  ],
  completed: [
    { flag: '--pass-id', key: 'pass_id', kind: 'string', required: true },
    { flag: '--state', key: 'state', kind: 'string', required: true },
  ],
};

export const CORRECTION_FLAGS: readonly FlagRow[] = [
  { flag: '--correction-id', key: 'correction_id', kind: 'string', required: true },
  { flag: '--pass-id', key: 'target.pass_id', kind: 'string', required: true },
  { flag: '--voice-id', key: 'target.voice_id', kind: 'string', required: true },
  { flag: '--attempt-id', key: 'target.attempt_id', kind: 'string', required: true },
  { flag: '--finding-id', key: 'target.finding_id', kind: 'string', required: true },
  { flag: '--adjudication', key: 'adjudication', kind: 'string', required: false },
  { flag: '--resolution', key: 'resolution', kind: 'string', required: false },
  { flag: '--receipt-class', key: 'receipt_class', kind: 'string', required: false },
  { flag: '--fixed-in', key: 'fixed_in', kind: 'string', required: false },
  { flag: '--supersedes', key: 'supersedes', kind: 'string', required: false },
];

export const GATE_FLAGS: readonly FlagRow[] = [
  { flag: '--gate-id', key: 'gate_id', kind: 'string', required: true },
  { flag: '--name', key: 'name', kind: 'string', required: true },
  { flag: '--result', key: 'result', kind: 'string', required: true },
  { flag: '--reason', key: 'reason', kind: 'string', required: false },
  { flag: '--commit', key: 'candidate.commit', kind: 'string', required: true },
  { flag: '--base', key: 'candidate.base', kind: 'string', required: false },
  { flag: '--wtree', key: 'candidate.wtree', kind: 'string', required: false },
  { flag: '--greptile-value', key: 'details.value', kind: 'string', required: false },
  { flag: '--greptile-run', key: 'details.run', kind: 'string', required: false },
  { flag: '--pregate-raw-verdict', key: 'details.raw_verdict', kind: 'string', required: false },
  { flag: '--pregate-wrapper-verdict', key: 'details.wrapper_verdict', kind: 'string', required: false },
  { flag: '--pregate-policy', key: 'details.policy', kind: 'string', required: false },
  { flag: '--pregate-record', key: 'details.record_path', kind: 'file', required: false },
  { flag: '--skipped-lane', key: 'details.skipped_lanes', kind: 'list', required: false, repeatable: true },
  { flag: '--evidence', key: 'evidence', kind: 'file', required: false, repeatable: true },
];

export const AUDIT_FLAGS: readonly FlagRow[] = [
  { flag: '--audit-id', key: 'audit_id', kind: 'string', required: true },
  { flag: '--name', key: 'name', kind: 'string', required: true },
  { flag: '--result', key: 'result', kind: 'string', required: true },
  { flag: '--coverage-pct', key: 'details.pct', kind: 'number-or-string', required: false },
  { flag: '--coverage-threshold', key: 'details.threshold', kind: 'number-or-string', required: false },
  { flag: '--report-id', key: 'details.report_id', kind: 'string', required: false },
  { flag: '--section', key: 'details.section_path', kind: 'file', required: false },
  { flag: '--commit', key: 'candidate.commit', kind: 'string', required: true },
  { flag: '--base', key: 'candidate.base', kind: 'string', required: false },
  { flag: '--wtree', key: 'candidate.wtree', kind: 'string', required: false },
  { flag: '--evidence', key: 'evidence', kind: 'file', required: false, repeatable: true },
];

export const CHECKPOINT_FLAGS: readonly FlagRow[] = [
  { flag: '--checkpoint-id', key: 'checkpoint_id', kind: 'string', required: true },
  { flag: '--kind', key: 'kind', kind: 'string', required: true },
  { flag: '--base', key: 'base', kind: 'string', required: false },
  { flag: '--wtree', key: 'wtree', kind: 'string', required: false },
  { flag: '--session-id', key: 'session_id', kind: 'string', required: false },
  { flag: '--evidence', key: 'evidence', kind: 'file', required: false, repeatable: true },
];

export const FINISH_FLAGS: readonly FlagRow[] = [
  { flag: '--outcome', key: 'outcome', kind: 'string', required: true },
  { flag: '--base', key: 'base', kind: 'string', required: true },
  { flag: '--stop-reason', key: 'stop_reason', kind: 'string', required: false },
  { flag: '--delta-base', key: 'delta_base', kind: 'string', required: false },
  { flag: '--stop-count', key: 'stop_count', kind: 'int', required: false },
  { flag: '--wtree', key: 'wtree', kind: 'string', required: false },
  { flag: '--review-restriction-resolved', key: 'review_restriction_resolved', kind: 'presence', required: false },
  { flag: '--readiness-confirmed-at', key: 'readiness_confirmed_at', kind: 'string', required: false },
  { flag: '--full-review-commit', key: 'full_review_evidence.commit', kind: 'string', required: false },
  { flag: '--full-review-tree', key: 'full_review_evidence.tree', kind: 'string', required: false },
  { flag: '--full-review-source', key: 'full_review_evidence.source', kind: 'string', required: false },
  { flag: '--full-review-unavailable', key: 'full_review_evidence.reason', kind: 'string', required: false },
  { flag: '--user-facing-change', key: 'user_facing_changes', kind: 'list', required: false, repeatable: true },
  { flag: '--evidence', key: 'evidence', kind: 'file', required: false, repeatable: true },
];

export const FLAG_TABLES: Record<Exclude<CommandName, 'record pass'>, readonly FlagRow[]> = {
  start: START_FLAGS,
  'record correction': CORRECTION_FLAGS,
  'record gate': GATE_FLAGS,
  'record audit': AUDIT_FLAGS,
  checkpoint: CHECKPOINT_FLAGS,
  finish: FINISH_FLAGS,
};

const ALL_PASS_FLAGS: readonly FlagRow[] = (() => {
  const byFlag = new Map<string, FlagRow>();
  for (const st of PASS_STATES) for (const r of PASS_STATE_FLAGS[st]) if (!byFlag.has(r.flag)) byFlag.set(r.flag, r);
  return [...byFlag.values()];
})();

export const BUILT_KEYS: ReadonlySet<string> = (() => {
  const keys = new Set<string>([
    'status', 'parts', 'config', 'tools', 'reason',
    'finding_id', 'severity_source', 'severity_rubric', 'adjudication', 'resolution', 'found_by', 'attribution_reason',
    'record_sha256', 'section_sha256', 'path', 'sha256',
    ...STATE_KEYS.delegate,
    ...DELEGATE_RUNNER_EXTRA_KEYS,
  ]);
  const allRows = [...Object.values(FLAG_TABLES).flat(), ...Object.values(PASS_STATE_FLAGS).flat()];
  for (const row of allRows) {
    for (const seg of row.key.split('.')) keys.add(seg);
  }
  return keys;
})();

export function rubricForPart(part?: string | null): string {
  if (!part) return 'unknown';
  if (part === 'core') return 'core';
  if (part.startsWith('specialist:') || part === 'red-team') return 'specialist';
  if (part === 'native-adversarial') return 'adversarial';
  if (part === 'greptile') return 'greptile';
  if (part === 'qa' || part === 'outside:challenge' || part === 'outside:structured') return 'other';
  return 'unknown';
}

export function parseDelegationLine(line: string | null | undefined): DelegationPolicy | null {
  if (!line) return null;
  const inactivePrefix = 'delegation: inactive \u2014 ';
  if (line.startsWith(inactivePrefix)) {
    const reason = line.slice(inactivePrefix.length);
    return isStr(reason, 1, 200) ? { status: 'inactive', reason } : null;
  }
  const m = /^delegation: active \(parts=([^;()\s]+); config=([0-9a-f]{64})(?:; tools=([^;()\s]+))?\)$/.exec(line);
  if (!m) return null;
  const rawParts = m[1]!.split(',');
  const parts = rawParts.map(toPartLabel);
  if (!parts.length || parts.some((p) => p === null) || new Set(parts).size !== parts.length) return null;
  const rawTools = m[3] !== undefined ? m[3].split(',') : [];
  const tools = rawTools.map(toPartLabel);
  if (tools.some((t) => t === null || !parts.includes(t)) || new Set(tools).size !== tools.length) return null;
  return { status: 'active', parts: parts as string[], config: m[2]!, tools: tools as string[] };
}

export function buildHelp(): string {
  const fmtRow = (r: FlagRow) => (r.kind === 'presence' ? r.flag : `${r.flag} <${r.key}>${r.repeatable ? '...' : ''}`);
  const fmtTable = (title: string, rows: readonly FlagRow[], extraOpt: string[] = []) => {
    const req = ['--dir DIR', ...rows.filter((r) => r.required).map(fmtRow)].join(', ');
    const optRows = [...rows.filter((r) => !r.required).map(fmtRow), ...extraOpt];
    const opt = optRows.length > 0 ? optRows.join(', ') : 'none';
    return `${title}:\n  required: ${req}\n  optional: ${opt}`;
  };
  const sections = [
    fmtTable('start', START_FLAGS),
    ...PASS_STATES.map((st) => fmtTable(`record pass (--state ${st})`, PASS_STATE_FLAGS[st])),
    fmtTable('record correction', CORRECTION_FLAGS),
    fmtTable('record gate', GATE_FLAGS),
    fmtTable('record audit', AUDIT_FLAGS),
    fmtTable('checkpoint', CHECKPOINT_FLAGS),
    fmtTable('finish', FINISH_FLAGS),
  ].join('\n\n');
  return `review-state build — request builder for /review-and-prep run state (${SCHEMA_VERSION})\nBuilds the canonical JSON request in --dir and records it in one call.\n\nUsage:\n  bin/review-state build <command> --dir DIR [flags]\n\n${sections}\n\nDocs: docs/designs/review-run-state.md\n`;
}

export type BuildOverride = { flag: string; sent: string | string[]; used: string | null; rule: string };
export type BuildRequestResult =
  | { ok: true; request: Record<string, unknown>; overrides: BuildOverride[] }
  | { ok: false; reason: 'usage' | 'invalid-input'; detail: Record<string, unknown> };

const toIntOrString = (v: string): number | string => (/^\d+$/.test(v) && Number.isSafeInteger(Number(v)) ? Number(v) : v);
const toNumberOrString = (v: string): number | string => (v.trim() !== '' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v) && Number.isFinite(Number(v)) ? Number(v) : v);

function failInvalid(path: string, rule: string, expected: string): BuildRequestResult {
  return { ok: false, reason: 'invalid-input', detail: { violations: [{ path, rule, expected }] } };
}

function parseTableArgs(
  args: readonly string[],
  rows: readonly FlagRow[],
): { ok: true; scalars: Map<string, string>; lists: Map<string, string[]>; presences: Set<string> } | { ok: false; message: string } {
  const rowByFlag = new Map(rows.map((r) => [r.flag, r]));
  const scalars = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const presences = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const row = rowByFlag.get(arg);
    if (!row) return { ok: false, message: `unknown argument ${truncate80(arg)}` };
    if (row.kind === 'presence') {
      if (presences.has(arg)) return { ok: false, message: `duplicate ${arg} flag` };
      presences.add(arg);
      continue;
    }
    const val = args[++i];
    if (val === undefined) return { ok: false, message: `${arg} requires a value` };
    if (row.repeatable || row.kind === 'list') {
      const arr = lists.get(arg) ?? [];
      arr.push(val);
      lists.set(arg, arr);
    } else {
      if (scalars.has(arg)) return { ok: false, message: `duplicate ${arg} flag` };
      scalars.set(arg, val);
    }
  }
  return { ok: true, scalars, lists, presences };
}

function hashEvidenceFiles(paths: readonly string[], realDir: string): { ok: true; items: EvidenceRef[] } | BuildRequestResult {
  const items: EvidenceRef[] = [];
  for (const relPath of paths) {
    const check = checkDirFile(realDir, relPath);
    if (!check.ok) return failInvalid('--evidence', check.error, 'valid-evidence-file-in-dir');
    items.push({ path: relPath, sha256: check.sha256 });
  }
  return { ok: true, items };
}

function canOmitRejectedResolution(realDir: string, id: string, target: CorrectionRecord['target']): boolean {
  // Preserve successful legacy requests and each existing correction's replay shape.
  // This is a read-only hint; executeCommand still validates under the state lock.
  let fd: number | undefined;
  try {
    const statePath = join(realDir, 'review-run-state.json');
    fd = openSync(statePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    if (!fstatSync(fd).isFile()) return false;
    const parsed = validateStoredState(JSON.parse(readFileSync(fd, 'utf8')), statePath);
    if (!parsed.ok) return false;
    const state = parsed.state;
    const existing = state.corrections.find((c) => c.correction_id === id);
    if (existing) return existing.resolution === null;
    const matches = (t: CorrectionRecord['target']) => t.pass_id === target.pass_id && t.voice_id === target.voice_id && t.attempt_id === target.attempt_id && t.finding_id === target.finding_id;
    const finding = state.passes.find((p) => p.pass_id === target.pass_id)?.voices.find((v) => v.voice_id === target.voice_id)?.attempts.find((a) => a.attempt_id === target.attempt_id)?.findings?.find((f) => f.finding_id === target.finding_id);
    let resolution = finding?.resolution;
    for (const c of state.corrections) if (matches(c.target) && c.resolution !== null) resolution = c.resolution;
    return resolution === 'unknown';
  } catch {
    return false; // Missing/corrupt state is refused by the recorder, never repaired here.
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function buildRequest(command: CommandName, args: readonly string[], realDir: string): BuildRequestResult {
  const overrides: BuildOverride[] = [];
  const over = (flag: string, sent: string | string[], used: string | null, rule: string) => overrides.push({ flag, sent, used, rule });
  const keep = (map: Map<string, string> | Map<string, string[]>, flag: string, dropCond: boolean, rule: string) => {
    if (!map.has(flag)) return false;
    if (dropCond) { over(flag, map.get(flag)!, null, rule); return false; }
    return true;
  };
  if (command === 'record pass') {
    const pre = parseTableArgs(args, ALL_PASS_FLAGS);
    if (!pre.ok) return { ok: false, reason: 'usage', detail: { message: pre.message } };
    const stateVal = pre.scalars.get('--state');
    if (stateVal === undefined) return failInvalid('--state', 'missing-flag', 'state');
    if (!(PASS_STATES as readonly string[]).includes(stateVal)) return failInvalid('--state', 'invalid-enum', PASS_STATES.join('|'));
    const passState = stateVal as PassState;
    const rows = PASS_STATE_FLAGS[passState];
    const parsed = parseTableArgs(args, rows);
    if (!parsed.ok) return { ok: false, reason: 'usage', detail: { message: parsed.message } };
    const { scalars, lists } = parsed;

    for (const row of rows) {
      if (!row.required) continue;
      const present = row.repeatable || row.kind === 'list' ? (lists.get(row.flag)?.length ?? 0) > 0 : scalars.has(row.flag);
      if (!present) return failInvalid(row.flag, 'missing-flag', row.key);
    }

    if (passState === 'started') {
      const candidate: Record<string, unknown> = { commit: scalars.get('--commit')! };
      if (scalars.has('--base')) candidate.base = scalars.get('--base')!;
      if (scalars.has('--wtree')) candidate.wtree = scalars.get('--wtree')!;
      const req: Record<string, unknown> = {
        pass_id: scalars.get('--pass-id')!,
        state: 'started',
        scope: scalars.get('--scope')!,
        cycle: toIntOrString(scalars.get('--cycle')!),
        coverage: scalars.get('--coverage')!,
      };
      if (keep(scalars, '--delta-from', req.coverage === 'full', 'null-when-full')) req.delta_from = scalars.get('--delta-from')!;
      req.candidate = candidate;
      req.required_voices = lists.get('--voice')!;
      return { ok: true, request: req, overrides };
    }

    if (passState === 'attempt') {
      const partVal = scalars.get('--part');
      let delegateEntry: Record<string, unknown> | undefined;
      if (scalars.has('--delegate-file')) {
        if (partVal === undefined) return failInvalid('--part', 'missing-flag', 'part');
        const check = checkDirFile(realDir, scalars.get('--delegate-file')!);
        if (!check.ok) return failInvalid('--delegate-file', check.error, 'valid-evidence-file-in-dir');
        let rawDoc: unknown;
        try { rawDoc = JSON.parse(check.bytes.toString('utf8')); } catch { return failInvalid('--delegate-file', 'invalid-json', 'valid-json-object'); }
        if (!isObj(rawDoc)) return failInvalid('--delegate-file', 'invalid-json', 'valid-json-object');
        const targetPart = toPartLabel(partVal) ?? partVal;
        const matches = Array.isArray(rawDoc.parts) ? rawDoc.parts.filter((e): e is Record<string, unknown> => isObj(e) && toPartLabel(e.part) === targetPart) : [];
        if (matches.length !== 1) return failInvalid('--delegate-file', 'no-matching-part', `single-parts-entry-for-${partVal}`);
        delegateEntry = matches[0]!;
      }

      const expectedOutcome = delegateEntry?.outcome === 'credited' ? 'completed' : delegateEntry?.outcome === 'fell-back' ? 'failed' : undefined;
      const sentOutcome = scalars.get('--outcome');
      if (expectedOutcome && sentOutcome !== undefined && sentOutcome !== expectedOutcome) {
        over('--outcome', sentOutcome, expectedOutcome, expectedOutcome === 'completed' ? 'credited-requires-completed-and-null-fallback_reason' : 'fell-back-requires-failed-and-fallback_reason');
      }
      const outcome = expectedOutcome ?? sentOutcome;
      if (outcome === undefined) return failInvalid('--outcome', 'missing-flag', 'outcome');

      const pickTime = (flag: '--dispatched-at' | '--returned-at', key: 'dispatched_at' | 'returned_at'): string | undefined => {
        const sent = scalars.get(flag);
        const entryVal = delegateEntry && typeof delegateEntry[key] === 'string' ? (delegateEntry[key] as string) : undefined;
        if (sent !== undefined && isIsoZ(entryVal) && isIsoZ(sent) && entryVal !== sent) {
          over(flag, sent, entryVal, `equal-to-attempt-${key}`);
          return entryVal;
        }
        return sent ?? entryVal;
      };
      const dispatchedAt = pickTime('--dispatched-at', 'dispatched_at');
      const returnedAt = pickTime('--returned-at', 'returned_at');

      const findingSpecs = lists.get('--finding') ?? [];
      if (outcome !== 'completed' && findingSpecs.length > 0) {
        over('--finding', findingSpecs, null, 'null-when-outcome-not-completed');
      }
      let findings: Array<Record<string, unknown>> | undefined;
      if (outcome === 'completed') {
        findings = [];
        const rubric = rubricForPart(partVal);
        for (const spec of findingSpecs) {
          const parts = spec.split(',');
          if (parts.length < 3 || parts.some((p) => p.length === 0)) {
            return failInvalid('--finding', 'invalid-value', '<finding_id>,<severity_source>,<part>[,<part>...]|<finding_id>,<severity_source>,attribution=<reason>');
          }
          const [finding_id, severity_source, ...restParts] = parts as [string, string, ...string[]];
          if (restParts.length === 1 && restParts[0]!.startsWith('attribution=')) {
            const attr = restParts[0]!.slice('attribution='.length);
            if (!attr) return failInvalid('--finding', 'invalid-value', '<finding_id>,<severity_source>,attribution=<reason>');
            findings.push({
              finding_id,
              severity_source,
              severity_rubric: rubric,
              adjudication: 'unclassified',
              resolution: 'open',
              found_by: [],
              attribution_reason: attr,
            });
          } else if (restParts.some((p) => p.startsWith('attribution='))) {
            return failInvalid('--finding', 'invalid-value', '<finding_id>,<severity_source>,<part>[,<part>...]|<finding_id>,<severity_source>,attribution=<reason>');
          } else {
            findings.push({
              finding_id,
              severity_source,
              severity_rubric: rubric,
              adjudication: 'unclassified',
              resolution: 'open',
              found_by: restParts,
            });
          }
        }
      }

      const req: Record<string, unknown> = {
        pass_id: scalars.get('--pass-id')!,
        state: 'attempt',
        voice_id: scalars.get('--voice-id')!,
      };
      if (partVal !== undefined) req.part = partVal;
      req.attempt_id = scalars.get('--attempt-id')!;
      req.outcome = outcome;
      if (scalars.has('--predecessor-attempt-id')) req.predecessor_attempt_id = scalars.get('--predecessor-attempt-id')!;
      if (dispatchedAt !== undefined) req.dispatched_at = dispatchedAt;
      if (returnedAt !== undefined) req.returned_at = returnedAt;
      if (delegateEntry !== undefined) req.delegate = delegateEntry;
      if (findings !== undefined) req.findings = findings;
      return { ok: true, request: req, overrides };
    }

    if (passState === 'voice-complete') {
      if (scalars.has('--selected-attempt-id') && scalars.has('--not-applicable')) {
        return failInvalid('--selected-attempt-id', 'invalid-value', 'exactly-one-of-selected_attempt_id-or-not_applicable');
      }
      const req: Record<string, unknown> = {
        pass_id: scalars.get('--pass-id')!,
        state: 'voice-complete',
        voice_id: scalars.get('--voice-id')!,
      };
      if (scalars.has('--selected-attempt-id')) req.selected_attempt_id = scalars.get('--selected-attempt-id')!;
      if (scalars.has('--not-applicable')) req.not_applicable = scalars.get('--not-applicable')!;
      return { ok: true, request: req, overrides };
    }

    return { ok: true, request: { pass_id: scalars.get('--pass-id')!, state: 'completed' }, overrides };
  }

  const rows = FLAG_TABLES[command];
  const parsed = parseTableArgs(args, rows);
  if (!parsed.ok) return { ok: false, reason: 'usage', detail: { message: parsed.message } };
  const { scalars, lists, presences } = parsed;

  for (const row of rows) {
    if (!row.required) continue;
    const present = row.repeatable || row.kind === 'list' ? (lists.get(row.flag)?.length ?? 0) > 0 : scalars.has(row.flag);
    if (!present) return failInvalid(row.flag, 'missing-flag', row.key);
  }

  if (command === 'start') {
    let delegation: DelegationPolicy | null = null;
    if (scalars.has('--delegation-line')) {
      delegation = parseDelegationLine(scalars.get('--delegation-line')!);
      if (!delegation) {
        return failInvalid('--delegation-line', 'invalid-value', 'delegation: active (parts=...; config=...[; tools=...])|delegation: inactive \u2014 <reason>');
      }
    }
    const prFlags = ['--pr-url', '--pr-repo', '--pr-number', '--pr-head-repo', '--pr-head-branch', '--pr-base-ref'] as const;
    let pr: Record<string, unknown> | undefined;
    if (prFlags.some((f) => scalars.has(f))) {
      pr = {};
      if (scalars.has('--pr-url')) pr.url = scalars.get('--pr-url')!;
      if (scalars.has('--pr-repo')) pr.repo = scalars.get('--pr-repo')!;
      if (scalars.has('--pr-number')) pr.number = toIntOrString(scalars.get('--pr-number')!);
      if (scalars.has('--pr-head-repo')) pr.head_repo = scalars.get('--pr-head-repo')!;
      if (scalars.has('--pr-head-branch')) pr.head_branch = scalars.get('--pr-head-branch')!;
      if (scalars.has('--pr-base-ref')) pr.base_ref = scalars.get('--pr-base-ref')!;
    }
    const req: Record<string, unknown> = {
      run_id: scalars.get('--run-id')!,
      base: scalars.get('--base')!,
    };
    if (scalars.has('--wtree')) req.wtree = scalars.get('--wtree')!;
    if (pr !== undefined) req.pr = pr;
    if (scalars.has('--gh-login')) req.gh_login = scalars.get('--gh-login')!;
    req.plan = { ref: scalars.get('--plan-ref')!, sha256: scalars.get('--plan-sha256')! };
    req.policy = {
      value: scalars.get('--policy-value') ?? null,
      source: scalars.get('--policy-source')!,
      delegation,
    };
    const priorStops = scalars.has('--prior-stops') ? toIntOrString(scalars.get('--prior-stops')!) : 0;
    req.continuation = {
      prior_stops: priorStops,
      max: toIntOrString(scalars.get('--max-continuations')!),
      continues: keep(scalars, '--continues', priorStops === 0, 'null-when-prior_stops===0') ? scalars.get('--continues')! : null,
    };
    if (scalars.has('--session-id')) req.session_id = scalars.get('--session-id')!;
    return { ok: true, request: req, overrides };
  }

  if (command === 'record correction') {
    const target = {
      pass_id: scalars.get('--pass-id')!,
      voice_id: scalars.get('--voice-id')!,
      attempt_id: scalars.get('--attempt-id')!,
      finding_id: scalars.get('--finding-id')!,
    };
    const req: Record<string, unknown> = {
      correction_id: scalars.get('--correction-id')!,
      target,
    };
    if (scalars.has('--adjudication')) req.adjudication = scalars.get('--adjudication')!;
    if (scalars.get('--adjudication') === 'rejected') {
      const sent = scalars.get('--resolution');
      const omit = sent !== 'unknown' && canOmitRejectedResolution(realDir, scalars.get('--correction-id')!, target);
      if (sent !== undefined && sent !== 'unknown') {
        over('--resolution', sent, omit ? null : 'unknown', 'unknown-when-rejected');
      }
      if (!omit) req.resolution = 'unknown';
    } else if (scalars.has('--resolution')) {
      req.resolution = scalars.get('--resolution')!;
    }
    if (scalars.has('--receipt-class')) req.receipt_class = scalars.get('--receipt-class')!;
    if (scalars.has('--fixed-in')) req.fixed_in = scalars.get('--fixed-in')!;
    if (scalars.has('--supersedes')) req.supersedes = scalars.get('--supersedes')!;
    return { ok: true, request: req, overrides };
  }

  if (command === 'record gate') {
    const name = scalars.get('--name')!;
    const candidate: Record<string, unknown> = { commit: scalars.get('--commit')! };
    if (scalars.has('--base')) candidate.base = scalars.get('--base')!;
    if (scalars.has('--wtree')) candidate.wtree = scalars.get('--wtree')!;

    let details: Record<string, unknown> | undefined;
    if (name === 'greptile' || name === 'pregate') details = {};
    if (keep(scalars, '--greptile-value', name !== 'greptile', 'greptile-gate-only')) details!.value = scalars.get('--greptile-value')!;
    if (keep(scalars, '--greptile-run', name !== 'greptile', 'greptile-gate-only')) details!.run = scalars.get('--greptile-run')!;
    if (keep(scalars, '--pregate-raw-verdict', name !== 'pregate', 'pregate-gate-only')) details!.raw_verdict = scalars.get('--pregate-raw-verdict')!;
    if (keep(scalars, '--pregate-wrapper-verdict', name !== 'pregate', 'pregate-gate-only')) details!.wrapper_verdict = scalars.get('--pregate-wrapper-verdict')!;
    if (keep(scalars, '--pregate-policy', name !== 'pregate', 'pregate-gate-only')) details!.policy = scalars.get('--pregate-policy')!;
    if (keep(scalars, '--pregate-record', name !== 'pregate', 'pregate-gate-only')) {
      const recPath = scalars.get('--pregate-record')!;
      const check = checkDirFile(realDir, recPath);
      if (!check.ok) return failInvalid('--pregate-record', check.error, 'valid-evidence-file-in-dir');
      details!.record_path = recPath;
      details!.record_sha256 = check.sha256;
    }
    if (keep(lists, '--skipped-lane', name !== 'pregate', 'pregate-gate-only') || name === 'pregate') {
      details!.skipped_lanes = lists.get('--skipped-lane') ?? [];
    }

    const evRes = hashEvidenceFiles(lists.get('--evidence') ?? [], realDir);
    if (!evRes.ok) return evRes;

    const req: Record<string, unknown> = {
      gate_id: scalars.get('--gate-id')!,
      name,
      result: scalars.get('--result')!,
    };
    if (scalars.has('--reason')) req.reason = scalars.get('--reason')!;
    req.candidate = candidate;
    if (details !== undefined) req.details = details;
    if (evRes.items.length > 0) req.evidence = evRes.items;
    return { ok: true, request: req, overrides };
  }

  if (command === 'record audit') {
    const name = scalars.get('--name')!;
    const details: Record<string, unknown> = {};
    if (keep(scalars, '--coverage-pct', name === 'documentation', 'coverage-audit-only')) {
      const rawPct = scalars.get('--coverage-pct')!;
      details.pct = rawPct === 'null' ? null : toNumberOrString(rawPct);
    } else if (name === 'coverage') {
      details.pct = null;
    }
    if (keep(scalars, '--coverage-threshold', name === 'documentation', 'coverage-audit-only')) {
      details.threshold = toNumberOrString(scalars.get('--coverage-threshold')!);
    }
    if (keep(scalars, '--report-id', name === 'coverage', 'documentation-audit-only')) details.report_id = scalars.get('--report-id')!;
    if (keep(scalars, '--section', name === 'coverage', 'documentation-audit-only')) {
      const secPath = scalars.get('--section')!;
      const check = checkDirFile(realDir, secPath);
      if (!check.ok) return failInvalid('--section', check.error, 'valid-evidence-file-in-dir');
      details.section_path = secPath;
      details.section_sha256 = check.sha256;
    }

    const candidate: Record<string, unknown> = { commit: scalars.get('--commit')! };
    if (scalars.has('--base')) candidate.base = scalars.get('--base')!;
    if (scalars.has('--wtree')) candidate.wtree = scalars.get('--wtree')!;

    const evRes = hashEvidenceFiles(lists.get('--evidence') ?? [], realDir);
    if (!evRes.ok) return evRes;

    const req: Record<string, unknown> = {
      audit_id: scalars.get('--audit-id')!,
      name,
      result: scalars.get('--result')!,
      details,
      candidate,
    };
    if (evRes.items.length > 0) req.evidence = evRes.items;
    return { ok: true, request: req, overrides };
  }

  if (command === 'checkpoint') {
    const evRes = hashEvidenceFiles(lists.get('--evidence') ?? [], realDir);
    if (!evRes.ok) return evRes;
    const req: Record<string, unknown> = {
      checkpoint_id: scalars.get('--checkpoint-id')!,
      kind: scalars.get('--kind')!,
    };
    if (scalars.has('--base')) req.base = scalars.get('--base')!;
    if (scalars.has('--wtree')) req.wtree = scalars.get('--wtree')!;
    if (keep(scalars, '--session-id', req.kind !== 'resume', 'null-when-kind-not-resume')) req.session_id = scalars.get('--session-id')!;
    if (evRes.items.length > 0) req.evidence = evRes.items;
    return { ok: true, request: req, overrides };
  }

  // finish
  const hasAvail = scalars.has('--full-review-commit') || scalars.has('--full-review-tree') || scalars.has('--full-review-source');
  const hasUnavail = scalars.has('--full-review-unavailable');
  if (hasAvail && hasUnavail) {
    return failInvalid('--full-review-unavailable', 'invalid-value', 'mutually-exclusive-with-full-review-commit-tree-source');
  }
  let fullReviewEvidence: Record<string, unknown> | undefined;
  if (hasAvail) {
    fullReviewEvidence = { status: 'available' };
    if (scalars.has('--full-review-commit')) fullReviewEvidence.commit = scalars.get('--full-review-commit')!;
    if (scalars.has('--full-review-tree')) fullReviewEvidence.tree = scalars.get('--full-review-tree')!;
    if (scalars.has('--full-review-source')) fullReviewEvidence.source = scalars.get('--full-review-source')!;
  } else if (hasUnavail) {
    fullReviewEvidence = { status: 'unavailable', reason: scalars.get('--full-review-unavailable')! };
  }

  const evRes = hashEvidenceFiles(lists.get('--evidence') ?? [], realDir);
  if (!evRes.ok) return evRes;

  const req: Record<string, unknown> = {
    outcome: scalars.get('--outcome')!,
    base: scalars.get('--base')!,
  };
  if (keep(scalars, '--stop-reason', req.outcome === 'prepared', 'null-when-prepared')) req.stop_reason = scalars.get('--stop-reason')!;
  if (keep(scalars, '--delta-base', req.outcome !== 'stopped', 'null-when-not-stopped')) req.delta_base = scalars.get('--delta-base')!;
  if (keep(scalars, '--stop-count', req.outcome !== 'stopped', 'null-when-not-stopped')) req.stop_count = toIntOrString(scalars.get('--stop-count')!);
  if (scalars.has('--wtree')) req.wtree = scalars.get('--wtree')!;
  if (presences.has('--review-restriction-resolved')) req.review_restriction_resolved = true;
  if (scalars.has('--readiness-confirmed-at')) req.readiness_confirmed_at = scalars.get('--readiness-confirmed-at')!;
  if (fullReviewEvidence !== undefined) req.full_review_evidence = fullReviewEvidence;
  if (lists.has('--user-facing-change')) req.user_facing_changes = lists.get('--user-facing-change')!;
  if (evRes.items.length > 0) req.evidence = evRes.items;
  return { ok: true, request: req, overrides };
}

export function executeBuild(
  argv: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  versionPath?: string,
  stderr: (text: string) => void = (t) => process.stderr.write(t),
): StoreResult {
  const helperVersion = readHelperVersion(versionPath);
  const rest = argv[0] === 'build' ? argv.slice(1) : argv;
  let commandStr = rest[0] && !rest[0].startsWith('-') ? rest[0] : '';
  let args = commandStr ? rest.slice(1) : rest;
  if (commandStr === 'record' && rest[1] && !rest[1].startsWith('-')) {
    commandStr = `record ${rest[1]}`;
    args = rest.slice(2);
  }

  const validCommand = (BUILD_COMMANDS as readonly string[]).includes(commandStr) ? (commandStr as CommandName) : null;
  const cmdLabel = validCommand ?? (commandStr || 'build');

  let dirArg: string | undefined;
  let dirErr: string | null = null;
  let hasInputFlag = false;
  const flagArgs: string[] = [];
  const commandRows = validCommand === 'record pass' ? ALL_PASS_FLAGS : validCommand ? FLAG_TABLES[validCommand] : [];
  const valueFlags = new Set(commandRows.filter((row) => row.kind !== 'presence').map((row) => row.flag));
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--dir') {
      const val = args[++i];
      if (val === undefined) dirErr ??= '--dir requires a value';
      else if (dirArg !== undefined) dirErr ??= 'duplicate --dir flag';
      else dirArg = val;
    } else if (arg === '--input') {
      hasInputFlag = true;
      if (i + 1 < args.length) i++;
    } else {
      flagArgs.push(arg);
      // Keep each option's value attached before inspecting later directory/input options.
      if (valueFlags.has(arg) && i + 1 < args.length) flagArgs.push(args[++i]!);
    }
  }

  const statePath = dirArg && isAbsolute(dirArg) ? join(dirArg.replace(/\/+$/, '') || '/', 'review-run-state.json') : null;
  if (hasInputFlag) {
    return makeEnvelope(truncate80(cmdLabel), 'usage', { message: 'build does not accept --input' }, statePath, null, undefined, helperVersion);
  }
  if (!validCommand) {
    return makeEnvelope(truncate80(cmdLabel), 'usage', { message: truncate80(`unknown command "${cmdLabel}"`) }, statePath, null, undefined, helperVersion);
  }
  if (dirErr || dirArg === undefined) {
    const msg = dirErr ?? '--dir is required';
    return makeEnvelope(validCommand, 'usage', { message: msg }, statePath, null, undefined, helperVersion);
  }

  const dirCheck = validateStateDir(validCommand, dirArg, cwd, env, helperVersion);
  if (!dirCheck.ok) return dirCheck.result;
  const { realDir } = dirCheck;
  const validStatePath = dirCheck.statePath;

  const built = buildRequest(validCommand, flagArgs, realDir);
  if (!built.ok) {
    return makeEnvelope(validCommand, built.reason, built.detail, validStatePath, null, undefined, helperVersion);
  }

  const bytes = Buffer.from(`${JSON.stringify(built.request)}\n`, 'utf8');
  const hash16 = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const reqName = `request-${validCommand.replace(/ /g, '-')}-${hash16}.json`;
  const reqPath = join(realDir, reqName);
  const withOverrides = (res: StoreResult): StoreResult =>
    built.overrides.length > 0 ? { ...res, detail: { ...res.detail, overrides: built.overrides } } : res;

  let createdRequest = false;
  try {
    const fd = openSync(reqPath, 'wx', 0o600);
    createdRequest = true;
    try {
      writeAll(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'EEXIST') {
      let same = false;
      try {
        const st = lstatSync(reqPath);
        if (!st.isSymbolicLink() && st.isFile()) same = readFileSync(reqPath).equals(bytes);
      } catch {
        same = false;
      }
      if (!same) {
        return withOverrides(makeEnvelope(validCommand, 'unwritable', { errno: 'EEXIST', syscall: 'open', path: truncate80(reqPath) }, validStatePath, null, undefined, helperVersion));
      }
    } else {
      if (createdRequest) unlinkQuiet(reqPath);
      return withOverrides(makeEnvelope(validCommand, 'unwritable', { errno: e.code ?? 'EIO', syscall: e.syscall ?? 'open', path: truncate80(reqPath) }, validStatePath, null, undefined, helperVersion));
    }
  }

  if (built.overrides.length > 0) {
    const logBytes = Buffer.from(`${JSON.stringify({ v: 1, at: new Date().toISOString(), command: validCommand, request: reqName, overrides: built.overrides })}\n`, 'utf8');
    try {
      const fd = openSync(join(realDir, 'build-overrides.jsonl'), constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
      try {
        const st = fstatSync(fd);
        if (!st.isFile() || st.nlink !== 1) throw Object.assign(new Error('unsafe override log target'), { code: 'EINVAL' });
        writeAll(fd, logBytes);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    } catch (err) {
      stderr(`WARNING BUILD_OVERRIDE_LOG: ${(err as NodeJS.ErrnoException).code ?? 'EIO'}\n`);
    }
  }

  return withOverrides(executeCommand(validCommand, dirArg, reqPath, cwd, env, versionPath));
}
