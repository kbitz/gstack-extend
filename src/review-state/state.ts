export const SCHEMA_VERSION = 'review-run-state/v1' as const;

export type ReasonCode =
  | 'recorded' | 'replayed' | 'invalid-input' | 'bad-dir' | 'not-in-worktree'
  | 'worktree-mismatch' | 'not-started' | 'paused' | 'finished' | 'exists'
  | 'conflict' | 'corrupt' | 'newer-schema' | 'usage' | 'unwritable' | 'busy';
export type StatusCode = 'recorded' | 'replayed' | 'refused' | 'conflict' | 'unreadable' | 'usage' | 'unwritable' | 'busy';
export type SideEffects = 'committed' | 'none';
export type RetryHint = 'no' | 'same-input' | 'after-fix' | 'never';
export type CommandName = 'start' | 'record pass' | 'record correction' | 'record gate' | 'record audit' | 'checkpoint' | 'finish';
export type ReasonEntry = { reason: ReasonCode; status: StatusCode; exit: 0 | 1 | 2 | 3 | 4; side_effects: SideEffects; retry: RetryHint; fix: string };

export const REASON_TABLE: readonly ReasonEntry[] = [
  { reason: 'recorded', status: 'recorded', exit: 0, side_effects: 'committed', retry: 'no', fix: '' },
  { reason: 'replayed', status: 'replayed', exit: 0, side_effects: 'none', retry: 'no', fix: '' },
  { reason: 'invalid-input', status: 'refused', exit: 1, side_effects: 'none', retry: 'after-fix', fix: 'Fix the payload violations and rerun with a new or corrected --input file.' },
  { reason: 'bad-dir', status: 'refused', exit: 1, side_effects: 'none', retry: 'after-fix', fix: 'Create --dir with mkdir -p outside the work tree, or continue inline (D1).' },
  { reason: 'not-in-worktree', status: 'refused', exit: 1, side_effects: 'none', retry: 'after-fix', fix: 'Run bin/review-state from inside the target Git work tree.' },
  { reason: 'worktree-mismatch', status: 'refused', exit: 1, side_effects: 'none', retry: 'never', fix: 'Run on the bound repository and branch, or start a new run in a new --dir.' },
  { reason: 'not-started', status: 'refused', exit: 1, side_effects: 'none', retry: 'after-fix', fix: 'Run bin/review-state start first.' },
  { reason: 'paused', status: 'refused', exit: 1, side_effects: 'none', retry: 'after-fix', fix: 'Run bin/review-state checkpoint with kind "resume" before recording or finishing.' },
  { reason: 'finished', status: 'refused', exit: 1, side_effects: 'none', retry: 'never', fix: 'Run is already closed; start a new run in a new --dir for a continuation.' },
  { reason: 'exists', status: 'refused', exit: 1, side_effects: 'none', retry: 'never', fix: 'Resend the existing run_id for replay, or use a new --dir for a new run.' },
  { reason: 'conflict', status: 'conflict', exit: 1, side_effects: 'none', retry: 'after-fix', fix: 'For a retry, resend the original payload file unchanged; for new content, use a new record ID.' },
  { reason: 'corrupt', status: 'unreadable', exit: 1, side_effects: 'none', retry: 'never', fix: 'Do not overwrite the corrupt state file; continue this review run inline (D1).' },
  { reason: 'newer-schema', status: 'unreadable', exit: 1, side_effects: 'none', retry: 'never', fix: 'Upgrade gstack-extend on this machine, or continue this review run inline (D1).' },
  { reason: 'usage', status: 'usage', exit: 2, side_effects: 'none', retry: 'after-fix', fix: 'Pass valid CLI flags, an absolute regular --input file (<=1 MiB) inside --dir, and GSTACK_EXTEND_REVIEW_STATE_LOCK_WAIT_MS in 0..60000.' },
  { reason: 'unwritable', status: 'unwritable', exit: 3, side_effects: 'none', retry: 'same-input', fix: 'Grant write permissions or free disk space on --dir, or continue inline (D1).' },
  { reason: 'busy', status: 'busy', exit: 4, side_effects: 'none', retry: 'same-input', fix: 'Confirm no review-state process runs as the recorded pid on the recorded host, delete review-run-state.json.lock, and rerun the identical command.' },
] as const;

export const REASONS = Object.fromEntries(REASON_TABLE.map((e) => [e.reason, e])) as Record<ReasonCode, ReasonEntry>;

export const REQUEST_SHAPES = {
  start: { required: ['run_id', 'base', 'plan', 'policy', 'continuation'], optional: { wtree: null, pr: null, gh_login: null, session_id: null } },
  'record pass (started)': { required: ['pass_id', 'state', 'scope', 'cycle', 'coverage', 'candidate', 'required_voices', 'started_at'], optional: { delta_from: null } },
  'record pass (attempt)': { required: ['pass_id', 'state', 'voice_id', 'attempt_id', 'outcome'], optional: { part: null, predecessor_attempt_id: null, dispatched_at: null, returned_at: null, delegate: null, findings: null } },
  'record pass (voice-complete)': { required: ['pass_id', 'state', 'voice_id'], optional: { selected_attempt_id: null, not_applicable: null } },
  'record pass (completed)': { required: ['pass_id', 'state', 'completed_at'], optional: {} },
  'record correction': { required: ['correction_id', 'target'], optional: { adjudication: null, resolution: null, receipt_class: null, fixed_in: null, supersedes: null } },
  'record gate': { required: ['gate_id', 'name', 'result', 'candidate'], optional: { reason: null, details: {}, evidence: [] } },
  'record audit': { required: ['audit_id', 'name', 'result', 'details', 'candidate'], optional: { evidence: [] } },
  checkpoint: { required: ['checkpoint_id', 'kind'], optional: { base: null, wtree: null, session_id: null, evidence: [] } },
  finish: { required: ['outcome', 'base'], optional: { stop_reason: null, delta_base: null, stop_count: null, wtree: null, review_restriction_resolved: false, readiness_confirmed_at: null, full_review_evidence: null, user_facing_changes: [], evidence: [] } },
} as const satisfies Record<string, { required: readonly string[]; optional: Record<string, unknown> }>;

export const STATE_KEYS = {
  root: ['schema', 'rev', 'writer', 'run', 'binding', 'plan', 'policy', 'continuation', 'segments', 'passes', 'corrections', 'gates', 'audits', 'checkpoints', 'finish'],
  run: ['run_id', 'skill', 'repo', 'branch', 'pr', 'gh_login', 'started_at'],
  pr: ['url', 'repo', 'number', 'head_repo', 'head_branch', 'base_ref'],
  binding: ['head', 'tree', 'base', 'wtree'],
  plan: ['ref', 'sha256'],
  policy: ['value', 'source', 'delegation'],
  continuation: ['prior_stops', 'max', 'continues'],
  segment: ['segment', 'started_at', 'ended_at', 'end', 'session_id', 'toplevel'],
  pass: ['pass_id', 'segment', 'scope', 'cycle', 'coverage', 'delta_from', 'candidate', 'required_voices', 'started_at', 'completed_at', 'state', 'voices', 'recorded_at', 'completed_recorded_at'],
  candidate: ['commit', 'tree', 'base', 'wtree'],
  voice: ['voice_id', 'part', 'required', 'not_applicable', 'selected_attempt_id', 'attempts', 'recorded_at'],
  attempt: ['attempt_id', 'part', 'outcome', 'predecessor_attempt_id', 'dispatched_at', 'returned_at', 'delegate', 'findings', 'recorded_at'],
  delegate: ['provider', 'model', 'outcome', 'fallback_reason', 'replay', 'wall_ms', 'input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'call_id'],
  finding: ['finding_id', 'severity_source', 'severity_rubric', 'adjudication', 'resolution', 'duplicate_of', 'found_by', 'attribution_reason', 'receipt_class'],
  correction: ['correction_id', 'segment', 'target', 'adjudication', 'resolution', 'receipt_class', 'fixed_in', 'supersedes', 'head', 'tree', 'recorded_at'],
  target: ['pass_id', 'voice_id', 'attempt_id', 'finding_id'],
  gate: ['gate_id', 'segment', 'name', 'result', 'reason', 'candidate', 'details', 'evidence', 'recorded_at'],
  audit: ['audit_id', 'segment', 'name', 'result', 'details', 'candidate', 'evidence', 'recorded_at'],
  checkpoint: ['checkpoint_id', 'segment', 'kind', 'head', 'tree', 'base', 'wtree', 'session_id', 'evidence', 'recorded_at'],
  finish: ['outcome', 'stop_reason', 'head', 'tree', 'base', 'delta_base', 'stop_count', 'wtree', 'review_restriction_resolved', 'readiness_confirmed_at', 'full_review_evidence', 'user_facing_changes', 'evidence', 'finished_at'],
  evidence: ['path', 'sha256'],
} as const;

export const ADDITIVE_V1_DEFAULTS = {
  root: { writer: null },
  passes: { segment: null },
  corrections: { segment: null },
  gates: { segment: null },
  audits: { segment: null },
  checkpoints: { segment: null },
} as const;

export const VERSION_RE = /^[0-9]+(?:\.[0-9]+){2,3}$/;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SESSION_RE = /^extend-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const VOICE_RE = /^(?:[a-z][a-z0-9-]{0,63}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
export const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const WTREE_RE = /^[A-Za-z0-9:._-]{1,128}$/;
export const HEX40_RE = /^[0-9a-f]{40}$/;
export const HEX64_RE = /^[0-9a-f]{64}$/;
export const PART_RE = /^(?:specialist:[a-z][a-z0-9-]{0,63}|red-team|native-adversarial|core|qa|greptile|outside:(?:challenge|structured))$/;
export const DELEGATE_LABEL_RE = /^[a-z][a-z0-9-]{0,31}$/;
export const ISO_Z_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const CTRL_RE = /[\u0000-\u001f\u007f]/;

const ENUMS = {
  policySource: ['caller prompt', 'user decision', 'none supplied'],
  passState: ['started', 'attempt', 'voice-complete', 'completed'],
  passScope: ['local', 'greptile'],
  passCoverage: ['full', 'delta'],
  attemptOutcome: ['completed', 'failed', 'partial'],
  delegateOutcome: ['credited', 'fell-back'],
  fallbackReason: ['unresolved-claim', 'timeout', 'failed', 'refused', 'needs-context', 'uncredited', 'unparsed-finding', 'worktree-changed'],
  severity: ['P0', 'P1', 'P2', 'P3', 'critical', 'high', 'medium', 'low', 'info', 'unknown'],
  rubric: ['core', 'specialist', 'adversarial', 'greptile', 'gstack-review', 'other', 'unknown'],
  adjudication: ['accepted', 'rejected', 'deferred', 'duplicate', 'unclassified'],
  correctionAdjudication: ['accepted', 'rejected', 'deferred', 'unclassified'],
  resolution: ['open', 'fixed', 'unknown'],
  receiptClass: ['non-blocking', 'test-gap-recorded'],
  attrReason: ['not-reported', 'unlisted-part', 'unsupported'],
  naReason: ['not-applicable', 'user-deferred'],
  gateResult: ['passed', 'failed', 'blocked', 'not-run', 'attested'],
  pregatePolicy: ['base', 'head'],
  auditName: ['coverage', 'documentation'],
  checkpointKind: ['before-fix', 'next-cycle', 'stop', 'pause', 'resume', 'external-gate', 'ready'],
  finishOutcome: ['prepared', 'stopped', 'blocked', 'needs-context'],
} as const;

export type EvidenceRef = { path: string; sha256: string };
export type CandidateBinding = { commit: string; tree: string; base: string | null; wtree: string | null };
export type PrInfo = { url: string; repo: string; number: number; head_repo: string; head_branch: string; base_ref: string };
export type DelegationPolicy = { status: 'active'; parts: string[]; config: string; tools: string[] } | { status: 'inactive'; reason: string };
export type FindingRecord = { finding_id: string; severity_source: string; severity_rubric: string; adjudication: string; resolution: string; duplicate_of: string | null; found_by: string[]; attribution_reason: string | null; receipt_class: string | null };
export type DelegateRecord = { provider: string; model: string; outcome: string; fallback_reason: string | null; replay: boolean; wall_ms: number; input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number | null; call_id: string };
export type AttemptRecord = { attempt_id: string; part: string | null; outcome: string; predecessor_attempt_id: string | null; dispatched_at: string | null; returned_at: string | null; delegate: DelegateRecord | null; findings: FindingRecord[] | null; recorded_at: string };
export type VoiceRecord = { voice_id: string; part: string | null; required: boolean; not_applicable: string | null; selected_attempt_id: string | null; attempts: AttemptRecord[]; recorded_at: string | null };
export type PassRecord = { pass_id: string; segment: number | null; scope: string; cycle: number; coverage: string; delta_from: string | null; candidate: CandidateBinding; required_voices: string[]; started_at: string; completed_at: string | null; state: 'open' | 'completed'; voices: VoiceRecord[]; recorded_at: string; completed_recorded_at: string | null };
export type CorrectionRecord = { correction_id: string; segment: number | null; target: { pass_id: string; voice_id: string; attempt_id: string; finding_id: string }; adjudication: string | null; resolution: string | null; receipt_class: string | null; fixed_in: string | null; supersedes: string | null; head: string; tree: string; recorded_at: string };
export type GateRecord = { gate_id: string; segment: number | null; name: string; result: string; reason: string | null; candidate: CandidateBinding; details: Record<string, unknown>; evidence: EvidenceRef[]; recorded_at: string };
export type AuditRecord = { audit_id: string; segment: number | null; name: string; result: string; details: Record<string, unknown>; candidate: CandidateBinding; evidence: EvidenceRef[]; recorded_at: string };
export type CheckpointRecord = { checkpoint_id: string; segment: number | null; kind: string; head: string; tree: string; base: string | null; wtree: string | null; session_id: string | null; evidence: EvidenceRef[]; recorded_at: string };
export type FullReviewEvidence = { status: 'available'; commit: string; tree: string; source: string } | { status: 'unavailable'; reason: string };
export type FinishRecord = { outcome: string; stop_reason: string | null; head: string; tree: string; base: string; delta_base: string | null; stop_count: number | null; wtree: string | null; review_restriction_resolved: boolean; readiness_confirmed_at: string | null; full_review_evidence: FullReviewEvidence | null; user_facing_changes: string[]; evidence: EvidenceRef[]; finished_at: string };
export type SegmentRecord = { segment: number; started_at: string; ended_at: string | null; end: 'paused' | 'finished' | 'interrupted' | null; session_id: string | null; toplevel: string };
export type ReviewRunState = {
  schema: typeof SCHEMA_VERSION; rev: number; writer: string | null;
  run: { run_id: string; skill: 'review-and-prep'; repo: string; branch: string; pr: PrInfo | null; gh_login: string | null; started_at: string };
  binding: { head: string; tree: string; base: string; wtree: string | null };
  plan: { ref: string; sha256: string };
  policy: { value: string | null; source: string; delegation: DelegationPolicy | null };
  continuation: { prior_stops: number; max: number; continues: string | null };
  segments: SegmentRecord[]; passes: PassRecord[]; corrections: CorrectionRecord[];
  gates: GateRecord[]; audits: AuditRecord[]; checkpoints: CheckpointRecord[]; finish: FinishRecord | null;
};

export type Violation = { path: string; rule: string; expected: string };
export type GitInfo = { toplevel: string; repo: string; branch: string; head: string; tree: string };
export type EnvChecker = { commitExists(sha: string): boolean; commitTree(sha: string): string | null; isAncestor(anc: string, desc: string): boolean; checkEvidence(path: string, sha256: string): string | null };
export type ApplyOutcome =
  | { reason: 'recorded'; state: ReviewRunState; detail: Record<string, unknown> }
  | { reason: 'replayed'; rev: number; detail: Record<string, unknown> }
  | { reason: Exclude<ReasonCode, 'recorded' | 'replayed'>; rev: number | null; detail: Record<string, unknown>; fix?: string };

export const truncate80 = (s: string): string => (s.length > 80 ? s.slice(0, 80) : s);
export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const isNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v < 9007199254740992;
export const isPosInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
export const isIsoZ = (v: unknown): v is string => typeof v === 'string' && ISO_Z_RE.test(v) && Number.isFinite(Date.parse(v));
export const isPart = (v: unknown): v is string => typeof v === 'string' && PART_RE.test(v) && v !== 'specialist:red-team';
// Keys mirror PARTS in src/review-delegate/delegate.ts (lines 10–12).
const DELEGATE_PART_LABELS: ReadonlyMap<string, string> = new Map([
  ['testing', 'specialist:testing'],
  ['maintainability', 'specialist:maintainability'],
  ['performance', 'specialist:performance'],
  ['simplification', 'specialist:simplification'],
  ['adversarial', 'native-adversarial'],
  ['red-team', 'red-team'],
]);
const toPartLabel = (v: unknown): string | null =>
  typeof v === 'string' ? (DELEGATE_PART_LABELS.get(v) ?? (isPart(v) ? v : null)) : null;
export const isStr = (v: unknown, min: number, max: number, noWs = false): v is string =>
  typeof v === 'string' && v.length >= min && v.length <= max && !CTRL_RE.test(v) && (!noWs || !/\s/.test(v));
export const isVersion = (v: unknown): v is string => isStr(v, 5, 64, true) && VERSION_RE.test(v);

export function parseVersionTuple(v: unknown): [number, number, number, number] | null {
  if (!isVersion(v)) return null;
  const parts = v.split('.').map((n) => Number(n));
  if (parts.some((n) => !Number.isSafeInteger(n))) return null;
  return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 0];
}

export function isVersionNewer(candidate: unknown, baseline: unknown): boolean {
  const c = parseVersionTuple(candidate);
  const b = parseVersionTuple(baseline);
  if (!c || !b) return false;
  for (let i = 0; i < 4; i++) {
    if (c[i]! !== b[i]!) return c[i]! > b[i]!;
  }
  return false;
}
export const isRelPath = (v: unknown): v is string =>
  isStr(v, 1, 500) && !v.startsWith('/') && !v.includes('\\') && v.split('/').every((p) => p !== '' && p !== '.' && p !== '..');
export const isHttpUrl = (v: unknown): v is string => {
  if (!isStr(v, 8, 500, true) || (!v.startsWith('https://') && !v.startsWith('http://')) || v.includes('?')) return false;
  const auth = v.slice(v.indexOf('://') + 3).split('/')[0] ?? '';
  if (!auth || auth.includes('@')) return false;
  try { const u = new URL(v); return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password && !u.search; } catch { return false; }
};
const isSourceRef = (v: unknown): v is string => {
  if (!isStr(v, 1, 500, true)) return false;
  if (!v.includes('://')) return !/^[^/]+@/.test(v);
  const auth = v.slice(v.indexOf('://') + 3).split('/')[0] ?? '';
  return Boolean(auth && !auth.includes('@'));
};
const reCheck = (re: RegExp) => (v: unknown): v is string => typeof v === 'string' && re.test(v);
const inEnum = (arr: readonly string[]) => (v: unknown): v is string => typeof v === 'string' && arr.includes(v);
const nullable = <T>(fn: (v: unknown) => v is T) => (v: unknown): v is T | null => v === null || fn(v);

export type FieldRule = { check: (v: unknown) => boolean; expected: string; rule?: string };
export const R = {
  uuid: { check: reCheck(UUID_RE), expected: 'uuid' },
  uuidN: { check: nullable(reCheck(UUID_RE)), expected: 'uuid|null' },
  sessionN: { check: nullable(reCheck(SESSION_RE)), expected: 'extend-<uuid>|null' },
  versionN: { check: nullable(isVersion), expected: 'version|null' },
  voice: { check: reCheck(VOICE_RE), expected: 'voice-id' },
  safeId: { check: reCheck(SAFE_ID_RE), expected: 'safe-id' },
  safeIdN: { check: nullable(reCheck(SAFE_ID_RE)), expected: 'safe-id|null' },
  wtreeN: { check: nullable(reCheck(WTREE_RE)), expected: 'wtree-token|null' },
  hex40: { check: reCheck(HEX40_RE), expected: 'hex40' },
  hex40N: { check: nullable(reCheck(HEX40_RE)), expected: 'hex40|null' },
  hex64: { check: reCheck(HEX64_RE), expected: 'hex64' },
  isoZ: { check: isIsoZ, expected: 'iso8601-utc-z' },
  isoZN: { check: nullable(isIsoZ), expected: 'iso8601-utc-z|null' },
  partN: { check: nullable(isPart), expected: 'part-label|null' },
  provider: { check: reCheck(DELEGATE_LABEL_RE), expected: 'provider-label' },
  bool: { check: (v: unknown): v is boolean => typeof v === 'boolean', expected: 'boolean', rule: 'invalid-type' },
  nonNegInt: { check: isNonNegInt, expected: 'non-negative-integer' },
  nonNegIntN: { check: nullable(isNonNegInt), expected: 'non-negative-integer|null' },
  posInt: { check: isPosInt, expected: 'positive-integer' },
  posIntN: { check: nullable(isPosInt), expected: 'positive-integer|null' },
  url: { check: isHttpUrl, expected: 'http-or-https-url' },
  urlN: { check: nullable(isHttpUrl), expected: 'http-or-https-url|null' },
  sourceRef: { check: isSourceRef, expected: 'whitespace-free-reference-1..500' },
  relPath: { check: isRelPath, expected: 'relative-path' },
  str: (min: number, max: number, noWs = false): FieldRule => ({ check: (v) => isStr(v, min, max, noWs), expected: `string-${min}..${max}` }),
  strN: (min: number, max: number, noWs = false): FieldRule => ({ check: (v) => v === null || isStr(v, min, max, noWs), expected: `string-${min}..${max}|null` }),
  enum: (arr: readonly string[]): FieldRule => ({ check: inEnum(arr), expected: arr.join('|'), rule: 'invalid-enum' }),
  enumN: (arr: readonly string[]): FieldRule => ({ check: nullable(inEnum(arr)), expected: `${arr.join('|')}|null`, rule: 'invalid-enum' }),
};

const joinPath = (base: string, k: string) => (base ? `${base}.${k}` : k);

export function checkKeys(obj: Record<string, unknown>, req: readonly string[], opt: readonly string[], base: string, v: Violation[]): void {
  const allowed = new Set([...req, ...opt]);
  for (const k of req) if (!(k in obj)) v.push({ path: joinPath(base, k), rule: 'missing-key', expected: k });
  for (const k of Object.keys(obj)) if (!allowed.has(k)) v.push({ path: joinPath(base, k), rule: 'unknown-key', expected: 'no unknown keys' });
}

export function validateFields(obj: Record<string, unknown>, req: readonly string[], opt: Record<string, unknown>, rules: Record<string, FieldRule>, base: string, v: Violation[]): Record<string, unknown> {
  checkKeys(obj, req, Object.keys(opt), base, v);
  const out: Record<string, unknown> = {};
  for (const k of [...req, ...Object.keys(opt)]) {
    const val = k in obj ? obj[k] : structuredClone(opt[k]);
    out[k] = val;
    if (k in obj && rules[k] && !rules[k]!.check(val)) v.push({ path: joinPath(base, k), rule: rules[k]!.rule ?? 'invalid-value', expected: rules[k]!.expected });
  }
  return out;
}

function checkShape(obj: Record<string, unknown>, name: keyof typeof REQUEST_SHAPES, rules: Record<string, FieldRule>, v: Violation[], extraReq: readonly string[] = []): Record<string, unknown> {
  const s = REQUEST_SHAPES[name];
  return validateFields(obj, [...s.required, ...extraReq], s.optional, rules, '', v);
}

function validateEvidenceList(raw: unknown, base: string, v: Violation[]): EvidenceRef[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) { v.push({ path: base, rule: 'invalid-type', expected: 'array' }); return []; }
  return raw.map((item, i) => {
    const p = `${base}[${i}]`;
    if (!isObj(item)) { v.push({ path: p, rule: 'invalid-type', expected: 'object' }); return { path: '', sha256: '' }; }
    const c = validateFields(item, ['path', 'sha256'], {}, { path: R.relPath, sha256: R.hex64 }, p, v);
    return { path: String(c.path ?? ''), sha256: String(c.sha256 ?? '') };
  });
}

function validateCandidateInput(raw: unknown, base: string, v: Violation[]): { commit: string; base: string | null; wtree: string | null } {
  if (!isObj(raw)) { v.push({ path: base, rule: 'invalid-type', expected: 'object' }); return { commit: '', base: null, wtree: null }; }
  const c = validateFields(raw, ['commit'], { base: null, wtree: null }, { commit: R.hex40, base: R.hex40N, wtree: R.wtreeN }, base, v);
  return { commit: String(c.commit ?? ''), base: (c.base as string | null) ?? null, wtree: (c.wtree as string | null) ?? null };
}

export function collectEvidenceItems(command: CommandName, raw: unknown): EvidenceRef[] {
  if (!isObj(raw)) return [];
  if (command !== 'record gate' && command !== 'record audit' && command !== 'checkpoint' && command !== 'finish') return [];
  const items: unknown[] = Array.isArray(raw.evidence) ? [...raw.evidence] : [];
  if (isObj(raw.details)) {
    if (command === 'record gate' && raw.name === 'pregate') items.push({ path: raw.details.record_path, sha256: raw.details.record_sha256 });
    if (command === 'record audit' && raw.name === 'documentation') items.push({ path: raw.details.section_path, sha256: raw.details.section_sha256 });
  }
  return items.filter((e): e is EvidenceRef => isObj(e) && isRelPath(e.path) && reCheck(HEX64_RE)(e.sha256));
}

function firstDiff(stored: unknown, sent: unknown, path = ''): { path: string; stored: string; sent: string } | null {
  if (stored === sent) return null; // JSON serializes both numeric zero signs as 0.
  if (Array.isArray(stored) && Array.isArray(sent)) {
    for (let i = 0; i < Math.max(stored.length, sent.length); i++) {
      const d = firstDiff(stored[i], sent[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (isObj(stored) && isObj(sent)) {
    for (const k of new Set([...Object.keys(stored), ...Object.keys(sent)])) {
      const d = firstDiff(stored[k], sent[k], path ? `${path}.${k}` : k);
      if (d) return d;
    }
    return null;
  }
  const fmt = (val: unknown) => (typeof val === 'string' ? val : JSON.stringify(val) ?? 'undefined');
  return { path: path || '$', stored: truncate80(fmt(stored)), sent: truncate80(fmt(sent)) };
}

const CONTINUATION_SHAPE_MESSAGE =
  'continuation must be {prior_stops, max, continues} (40-hex iff prior_stops>=1)';
const CONTINUATION_SHAPE_FIX =
  'Pass continuation as {"prior_stops": 0, "max": <int>, "continues": null} on an initial run, or {"prior_stops": <k>, "max": <int>, "continues": "<40-hex Stopped at SHA>"} when prior_stops >= 1 (never {"count", "max"} or prior_stops >= 1 without continues).';

const invalid = (rev: number | null, v: Violation[]): ApplyOutcome => {
  const hasContinuationViolation = v.some((x) => x.path === 'continuation' || x.path.startsWith('continuation.'));
  return {
    reason: 'invalid-input',
    rev,
    detail: {
      violations: v.slice(0, 20),
      ...(hasContinuationViolation ? { message: CONTINUATION_SHAPE_MESSAGE } : {}),
    },
    ...(hasContinuationViolation ? { fix: CONTINUATION_SHAPE_FIX } : {}),
  };
};

function replayOrConflict(rev: number, id: string, stored: unknown, canon: unknown, head: string, tree: string, recorded_at: string): ApplyOutcome {
  const diff = firstDiff(stored, canon);
  return diff ? { reason: 'conflict', rev, detail: { id, ...diff } } : { reason: 'replayed', rev, detail: { head, tree, recorded_at } };
}

function checkCandAndEv(cand: { commit: string; base: string | null }, evs: EvidenceRef[], env: EnvChecker, v: Violation[]): string | null {
  const cTree = env.commitTree(cand.commit);
  if (!cTree) v.push({ path: 'candidate.commit', rule: 'commit-not-found', expected: 'existing-git-commit' });
  if (cand.base !== null && !env.commitExists(cand.base)) v.push({ path: 'candidate.base', rule: 'commit-not-found', expected: 'existing-git-commit' });
  evs.forEach((ev, i) => { const err = env.checkEvidence(ev.path, ev.sha256); if (err) v.push({ path: `evidence[${i}]`, rule: err, expected: 'valid-evidence-file-in-dir' }); });
  return cTree;
}

export function applyCommand(state: ReviewRunState | null, command: CommandName, rawInput: unknown, git: GitInfo, env: EnvChecker, nowIso: string, helperVersion: string | null = null): ApplyOutcome {
  const rev = state?.rev ?? null;
  if (!isObj(rawInput)) return invalid(rev, [{ path: '$', rule: 'invalid-type', expected: 'object' }]);
  const v: Violation[] = [];
  const activeSegment = state ? state.segments[state.segments.length - 1]!.segment : 1;
  const recorded = (next: ReviewRunState, detail: Record<string, unknown>): ApplyOutcome => ({
    reason: 'recorded',
    state: { ...next, writer: helperVersion },
    detail,
  });

  if (command === 'start') {
    const top = checkShape(rawInput, 'start', { run_id: R.uuid, base: R.hex40, wtree: R.wtreeN, gh_login: R.strN(1, 128, true), session_id: R.sessionN }, v);
    let pr: PrInfo | null = null;
    if (rawInput.pr !== undefined && rawInput.pr !== null) {
      if (!isObj(rawInput.pr)) v.push({ path: 'pr', rule: 'invalid-type', expected: 'object|null' });
      else pr = validateFields(rawInput.pr, STATE_KEYS.pr, {}, { url: R.url, repo: R.str(1, 200, true), number: R.posInt, head_repo: R.str(1, 200, true), head_branch: R.str(1, 200, true), base_ref: R.str(1, 200, true) }, 'pr', v) as unknown as PrInfo;
    }
    let plan = { ref: '', sha256: '' };
    if ('plan' in rawInput) {
      if (!isObj(rawInput.plan)) v.push({ path: 'plan', rule: 'invalid-type', expected: 'object' });
      else plan = validateFields(rawInput.plan, STATE_KEYS.plan, {}, { ref: R.str(1, 500), sha256: R.hex64 }, 'plan', v) as unknown as typeof plan;
    }
    let policy: ReviewRunState['policy'] = { value: null, source: '', delegation: null };
    if ('policy' in rawInput) {
      if (!isObj(rawInput.policy)) v.push({ path: 'policy', rule: 'invalid-type', expected: 'object' });
      else {
        const pol = validateFields(rawInput.policy, ['value', 'source'], { delegation: null }, { value: R.strN(1, 500), source: R.enum(ENUMS.policySource) }, 'policy', v);
        let delegation: DelegationPolicy | null = null;
        if (pol.delegation !== null) {
          if (!isObj(pol.delegation)) v.push({ path: 'policy.delegation', rule: 'invalid-type', expected: 'object|null' });
          else if (pol.delegation.status === 'active') {
            const d = validateFields(pol.delegation, ['status', 'parts', 'config'], { tools: [] }, { config: R.hex64 }, 'policy.delegation', v);
            const parts = Array.isArray(d.parts) ? d.parts.map(toPartLabel) : null;
            if (!parts || !parts.length || new Set(parts).size !== parts.length || !parts.every((p): p is string => p !== null)) v.push({ path: 'policy.delegation.parts', rule: 'invalid-value', expected: 'nonempty-unique-part-array' });
            const tools = Array.isArray(d.tools) ? d.tools.map(toPartLabel) : null;
            if (!tools || new Set(tools).size !== tools.length || !tools.every((t): t is string => t !== null && (parts ?? []).includes(t))) v.push({ path: 'policy.delegation.tools', rule: 'invalid-value', expected: 'subset-of-parts' });
            if (parts && tools) delegation = { status: 'active', parts: parts as string[], config: String(d.config ?? ''), tools: tools as string[] };
          } else if (pol.delegation.status === 'inactive') {
            const d = validateFields(pol.delegation, ['status', 'reason'], {}, { reason: R.str(1, 200) }, 'policy.delegation', v);
            delegation = { status: 'inactive', reason: String(d.reason ?? '') };
          } else v.push({ path: 'policy.delegation.status', rule: 'invalid-enum', expected: 'active|inactive' });
        }
        policy = { value: (pol.value as string | null) ?? null, source: String(pol.source ?? ''), delegation };
      }
    }
    let continuation = { prior_stops: 0, max: 0, continues: null as string | null };
    if ('continuation' in rawInput) {
      if (!isObj(rawInput.continuation)) v.push({ path: 'continuation', rule: 'invalid-type', expected: 'object' });
      else {
        const c = validateFields(rawInput.continuation, ['prior_stops', 'max'], { continues: null }, { prior_stops: R.nonNegInt, max: R.nonNegInt, continues: R.hex40N }, 'continuation', v);
        if (isNonNegInt(c.prior_stops) && ((c.prior_stops >= 1 && c.continues === null) || (c.prior_stops === 0 && c.continues !== null))) {
          v.push({ path: 'continuation.continues', rule: 'invalid-value', expected: c.prior_stops >= 1 ? 'required-when-prior_stops>=1' : 'null-when-prior_stops===0' });
        }
        continuation = { prior_stops: Number(c.prior_stops ?? 0), max: Number(c.max ?? 0), continues: (c.continues as string | null) ?? null };
      }
    }
    if (v.length > 0) return invalid(rev, v);

    const canon = { run_id: top.run_id as string, base: top.base as string, wtree: top.wtree as string | null, pr, gh_login: top.gh_login as string | null, plan, policy, continuation, session_id: top.session_id as string | null };
    if (state !== null) {
      if (state.run.run_id !== canon.run_id) return { reason: 'exists', rev: state.rev, detail: { existing_run_id: state.run.run_id, sent_run_id: canon.run_id } };
      const stored = { run_id: state.run.run_id, base: state.binding.base, wtree: state.binding.wtree, pr: state.run.pr, gh_login: state.run.gh_login, plan: state.plan, policy: state.policy, continuation: state.continuation, session_id: state.segments[0]?.session_id ?? null };
      return replayOrConflict(state.rev, canon.run_id, stored, canon, state.binding.head, state.binding.tree, state.run.started_at);
    }
    if (!env.commitExists(canon.base)) v.push({ path: 'base', rule: 'commit-not-found', expected: 'existing-git-commit' });
    if (canon.continuation.continues !== null && !env.commitExists(canon.continuation.continues)) v.push({ path: 'continuation.continues', rule: 'commit-not-found', expected: 'existing-git-commit' });
    if (v.length > 0) return invalid(rev, v);

    const next: ReviewRunState = {
      schema: SCHEMA_VERSION, rev: 1, writer: helperVersion,
      run: { run_id: canon.run_id, skill: 'review-and-prep', repo: git.repo, branch: git.branch, pr: canon.pr, gh_login: canon.gh_login, started_at: nowIso },
      binding: { head: git.head, tree: git.tree, base: canon.base, wtree: canon.wtree },
      plan: canon.plan, policy: canon.policy, continuation: canon.continuation,
      segments: [{ segment: 1, started_at: nowIso, ended_at: null, end: null, session_id: canon.session_id, toplevel: git.toplevel }],
      passes: [], corrections: [], gates: [], audits: [], checkpoints: [], finish: null,
    };
    return recorded(next, { head: git.head, tree: git.tree, recorded_at: nowIso });
  }

  const checkLifecycle = (): ApplyOutcome | null => {
    if (state === null) return { reason: 'not-started', rev: null, detail: {} };
    if (state.finish !== null) return { reason: 'finished', rev: state.rev, detail: { outcome: state.finish.outcome } };
    const lastSeg = state.segments[state.segments.length - 1]!;
    if (lastSeg.end === 'paused' && !(command === 'checkpoint' && rawInput.kind === 'resume')) return { reason: 'paused', rev: state.rev, detail: { segment: lastSeg.segment } };
    return null;
  };

  if (command === 'record pass') {
    const pState = rawInput.state;
    if (!inEnum(ENUMS.passState)(pState)) {
      if (!('pass_id' in rawInput)) v.push({ path: 'pass_id', rule: 'missing-key', expected: 'pass_id' });
      else if (!R.uuid.check(rawInput.pass_id)) v.push({ path: 'pass_id', rule: 'invalid-value', expected: 'uuid' });
      v.push({ path: 'state', rule: 'state' in rawInput ? 'invalid-enum' : 'missing-key', expected: ENUMS.passState.join('|') });
      return invalid(rev, v);
    }

    if (pState === 'started') {
      const c = checkShape(rawInput, 'record pass (started)', { pass_id: R.uuid, scope: R.enum(ENUMS.passScope), cycle: R.posInt, coverage: R.enum(ENUMS.passCoverage), delta_from: R.hex40N, started_at: R.isoZ }, v);
      if ((c.coverage === 'delta' && c.delta_from === null) || (c.coverage === 'full' && c.delta_from !== null)) {
        v.push({ path: 'delta_from', rule: 'invalid-value', expected: c.coverage === 'delta' ? 'required-when-delta' : 'null-when-full' });
      }
      const cand = 'candidate' in rawInput ? validateCandidateInput(rawInput.candidate, 'candidate', v) : { commit: '', base: null, wtree: null };
      if ('required_voices' in rawInput && (!Array.isArray(rawInput.required_voices) || !rawInput.required_voices.length || new Set(rawInput.required_voices).size !== rawInput.required_voices.length || !rawInput.required_voices.every(R.voice.check))) {
        v.push({ path: 'required_voices', rule: 'invalid-value', expected: 'nonempty-unique-voice-id-array' });
      }
      if (v.length > 0) return invalid(rev, v);

      const canon = { pass_id: c.pass_id as string, state: 'started' as const, scope: c.scope as string, cycle: c.cycle as number, coverage: c.coverage as string, delta_from: c.delta_from as string | null, candidate: cand, required_voices: rawInput.required_voices as string[], started_at: c.started_at as string };
      const existing = state?.passes.find((p) => p.pass_id === canon.pass_id);
      if (existing && state) {
        const stored = { pass_id: existing.pass_id, state: 'started' as const, scope: existing.scope, cycle: existing.cycle, coverage: existing.coverage, delta_from: existing.delta_from, candidate: { commit: existing.candidate.commit, base: existing.candidate.base, wtree: existing.candidate.wtree }, required_voices: existing.required_voices, started_at: existing.started_at };
        return replayOrConflict(state.rev, canon.pass_id, stored, canon, existing.candidate.commit, existing.candidate.tree, existing.recorded_at);
      }
      const life = checkLifecycle();
      if (life) return life;
      const cTree = checkCandAndEv(canon.candidate, [], env, v);
      if (canon.delta_from !== null && !env.commitExists(canon.delta_from)) v.push({ path: 'delta_from', rule: 'commit-not-found', expected: 'existing-git-commit' });
      if (v.length > 0) return invalid(rev, v);

      const pass: PassRecord = {
        pass_id: canon.pass_id, segment: activeSegment, scope: canon.scope, cycle: canon.cycle, coverage: canon.coverage, delta_from: canon.delta_from,
        candidate: { commit: canon.candidate.commit, tree: cTree!, base: canon.candidate.base, wtree: canon.candidate.wtree },
        required_voices: canon.required_voices, started_at: canon.started_at, completed_at: null, state: 'open',
        voices: canon.required_voices.map((vid) => ({ voice_id: vid, part: null, required: true, not_applicable: null, selected_attempt_id: null, attempts: [], recorded_at: null })),
        recorded_at: nowIso, completed_recorded_at: null,
      };
      return recorded({ ...state!, rev: state!.rev + 1, passes: [...state!.passes, pass] }, { head: pass.candidate.commit, tree: pass.candidate.tree, recorded_at: nowIso });
    }

    if (pState === 'attempt') {
      const c = checkShape(rawInput, 'record pass (attempt)', { pass_id: R.uuid, voice_id: R.voice, attempt_id: R.uuid, outcome: R.enum(ENUMS.attemptOutcome), part: R.partN, predecessor_attempt_id: R.uuidN, dispatched_at: R.isoZN, returned_at: R.isoZN }, v, rawInput.outcome === 'completed' ? ['findings'] : []);
      let delegate: DelegateRecord | null = null;
      if (rawInput.delegate !== undefined && rawInput.delegate !== null) {
        if (!isObj(rawInput.delegate)) v.push({ path: 'delegate', rule: 'invalid-type', expected: 'object|null' });
        else {
          const d = validateFields(rawInput.delegate, STATE_KEYS.delegate, {}, {
            provider: R.provider, model: R.safeId, outcome: R.enum(ENUMS.delegateOutcome), fallback_reason: R.enumN(ENUMS.fallbackReason),
            replay: R.bool, wall_ms: R.nonNegInt, input_tokens: R.nonNegInt, output_tokens: R.nonNegInt, cache_read_input_tokens: R.nonNegInt,
            cache_creation_input_tokens: R.nonNegIntN, call_id: R.hex64,
          }, 'delegate', v);
          if (d.outcome === 'credited' && (c.outcome !== 'completed' || d.fallback_reason !== null)) v.push({ path: 'delegate.outcome', rule: 'invalid-value', expected: 'credited-requires-completed-and-null-fallback_reason' });
          if (d.outcome === 'fell-back' && (c.outcome !== 'failed' || d.fallback_reason === null)) v.push({ path: 'delegate.outcome', rule: 'invalid-value', expected: 'fell-back-requires-failed-and-fallback_reason' });
          if (!isPart(c.part)) v.push({ path: 'part', rule: 'invalid-value', expected: 'part-label-required-for-delegated-attempt' });
          delegate = d as unknown as DelegateRecord;
        }
      }
      let findings: FindingRecord[] | null = null;
      if (c.outcome === 'completed' && 'findings' in rawInput) {
        if (!Array.isArray(rawInput.findings)) v.push({ path: 'findings', rule: 'invalid-type', expected: 'array' });
        else {
          findings = [];
          const seenIds = new Set<string>();
          rawInput.findings.forEach((f, idx) => {
            const fp = `findings[${idx}]`;
            if (!isObj(f)) { v.push({ path: fp, rule: 'invalid-type', expected: 'object' }); return; }
            const fc = validateFields(f, ['finding_id', 'severity_source', 'severity_rubric', 'adjudication', 'resolution', 'found_by'], { duplicate_of: null, attribution_reason: null, receipt_class: null }, {
              finding_id: R.safeId, severity_source: R.enum(ENUMS.severity), severity_rubric: R.enum(ENUMS.rubric),
              adjudication: R.enum(ENUMS.adjudication), resolution: R.enum(ENUMS.resolution), duplicate_of: R.safeIdN,
              attribution_reason: R.enumN(ENUMS.attrReason), receipt_class: R.enumN(ENUMS.receiptClass),
            }, fp, v);
            if (typeof fc.finding_id === 'string') {
              if (seenIds.has(fc.finding_id)) v.push({ path: `${fp}.finding_id`, rule: 'duplicate-value', expected: 'unique-within-attempt' });
              seenIds.add(fc.finding_id);
            }
            if ((fc.adjudication === 'rejected' || fc.adjudication === 'duplicate') && fc.resolution !== 'unknown') v.push({ path: `${fp}.resolution`, rule: 'invalid-value', expected: 'unknown-for-rejected-or-duplicate' });
            if (fc.adjudication === 'duplicate' && fc.duplicate_of === null) v.push({ path: `${fp}.duplicate_of`, rule: 'invalid-value', expected: 'required-for-duplicate' });
            if (fc.duplicate_of !== null && fc.duplicate_of === fc.finding_id) v.push({ path: `${fp}.duplicate_of`, rule: 'invalid-value', expected: 'another-finding' });
            const fb = fc.found_by;
            if (!Array.isArray(fb) || fb.length > 8 || new Set(fb).size !== fb.length || !fb.every(isPart)) v.push({ path: `${fp}.found_by`, rule: 'invalid-value', expected: 'unique-part-array-0..8' });
            else if (fb.length > 0 && fc.attribution_reason !== null) v.push({ path: `${fp}.attribution_reason`, rule: 'invalid-value', expected: 'null-when-found_by-nonempty' });
            else if (fb.length === 0 && !inEnum(ENUMS.attrReason)(fc.attribution_reason)) v.push({ path: `${fp}.attribution_reason`, rule: 'invalid-enum', expected: ENUMS.attrReason.join('|') });
            findings!.push(fc as unknown as FindingRecord);
          });
        }
      } else if (c.outcome !== 'completed' && rawInput.findings !== undefined && rawInput.findings !== null) {
        v.push({ path: 'findings', rule: 'invalid-value', expected: 'null-when-outcome-not-completed' });
      }
      if (v.length > 0) return invalid(rev, v);

      const canon = { pass_id: c.pass_id as string, state: 'attempt' as const, voice_id: c.voice_id as string, part: c.part as string | null, attempt_id: c.attempt_id as string, outcome: c.outcome as string, predecessor_attempt_id: c.predecessor_attempt_id as string | null, dispatched_at: c.dispatched_at as string | null, returned_at: c.returned_at as string | null, delegate, findings };
      const pass = state?.passes.find((p) => p.pass_id === canon.pass_id);
      const voice = pass?.voices.find((vo) => vo.voice_id === canon.voice_id);
      const existingAtt = voice?.attempts.find((a) => a.attempt_id === canon.attempt_id);
      if (existingAtt && pass && voice && state) {
        const stored = { pass_id: pass.pass_id, state: 'attempt' as const, voice_id: voice.voice_id, part: existingAtt.part, attempt_id: existingAtt.attempt_id, outcome: existingAtt.outcome, predecessor_attempt_id: existingAtt.predecessor_attempt_id, dispatched_at: existingAtt.dispatched_at, returned_at: existingAtt.returned_at, delegate: existingAtt.delegate, findings: existingAtt.findings };
        return replayOrConflict(state.rev, canon.attempt_id, stored, canon, pass.candidate.commit, pass.candidate.tree, existingAtt.recorded_at);
      }
      const life = checkLifecycle();
      if (life) return life;
      if (!pass || pass.state !== 'open') return invalid(state!.rev, [{ path: 'pass_id', rule: 'invalid-reference', expected: 'open-pass' }]);
      if (voice && (voice.selected_attempt_id !== null || voice.not_applicable !== null)) return invalid(state!.rev, [{ path: 'voice_id', rule: 'voice-completed', expected: 'open-voice' }]);
      if (voice?.part !== null && voice?.part !== undefined && canon.part !== null && canon.part !== voice.part) return invalid(state!.rev, [{ path: 'part', rule: 'invalid-value', expected: `matching-voice-part:${voice.part}` }]);
      if (canon.predecessor_attempt_id !== null && !voice?.attempts.some((a) => a.attempt_id === canon.predecessor_attempt_id)) return invalid(state!.rev, [{ path: 'predecessor_attempt_id', rule: 'invalid-reference', expected: 'prior-attempt-on-voice' }]);
      if (state!.passes.some((p) => p.voices.some((vo) => vo.attempts.some((a) => a.attempt_id === canon.attempt_id)))) return invalid(state!.rev, [{ path: 'attempt_id', rule: 'duplicate-value', expected: 'unique-attempt-id' }]);
      if (canon.findings) {
        const existingFindingIds = new Set<string>();
        for (const p of state!.passes) for (const vo of p.voices) for (const a of vo.attempts) for (const f of a.findings ?? []) existingFindingIds.add(f.finding_id);
        canon.findings.forEach((f, i) => { if (existingFindingIds.has(f.finding_id)) v.push({ path: `findings[${i}].finding_id`, rule: 'duplicate-value', expected: 'unique-finding-id-in-run' }); });
        if (v.length > 0) return invalid(state!.rev, v);
      }

      const attRecord: AttemptRecord = { attempt_id: canon.attempt_id, part: canon.part, outcome: canon.outcome, predecessor_attempt_id: canon.predecessor_attempt_id, dispatched_at: canon.dispatched_at, returned_at: canon.returned_at, delegate: canon.delegate, findings: canon.findings, recorded_at: nowIso };
      const nextVoices = voice
        ? pass.voices.map((vo) => vo.voice_id === canon.voice_id ? { ...vo, part: canon.part ?? vo.part, attempts: [...vo.attempts, attRecord] } : vo)
        : [...pass.voices, { voice_id: canon.voice_id, part: canon.part, required: false, not_applicable: null, selected_attempt_id: null, attempts: [attRecord], recorded_at: null }];
      return recorded({ ...state!, rev: state!.rev + 1, passes: state!.passes.map((p) => p.pass_id === pass.pass_id ? { ...p, voices: nextVoices } : p) }, { head: pass.candidate.commit, tree: pass.candidate.tree, recorded_at: nowIso });
    }

    if (pState === 'voice-complete') {
      const c = checkShape(rawInput, 'record pass (voice-complete)', { pass_id: R.uuid, voice_id: R.voice, selected_attempt_id: R.uuidN, not_applicable: R.enumN(ENUMS.naReason) }, v);
      if ((c.selected_attempt_id === null) === (c.not_applicable === null)) v.push({ path: 'selected_attempt_id', rule: 'invalid-value', expected: 'exactly-one-of-selected_attempt_id-or-not_applicable' });
      if (v.length > 0) return invalid(rev, v);

      const canon = { pass_id: c.pass_id as string, state: 'voice-complete' as const, voice_id: c.voice_id as string, selected_attempt_id: c.selected_attempt_id as string | null, not_applicable: c.not_applicable as string | null };
      const pass = state?.passes.find((p) => p.pass_id === canon.pass_id);
      const voice = pass?.voices.find((vo) => vo.voice_id === canon.voice_id);
      if (voice && (voice.selected_attempt_id !== null || voice.not_applicable !== null) && pass && state) {
        const stored = { pass_id: pass.pass_id, state: 'voice-complete' as const, voice_id: voice.voice_id, selected_attempt_id: voice.selected_attempt_id, not_applicable: voice.not_applicable };
        return replayOrConflict(state.rev, `${canon.pass_id}:${canon.voice_id}`, stored, canon, pass.candidate.commit, pass.candidate.tree, voice.recorded_at ?? pass.recorded_at);
      }
      const life = checkLifecycle();
      if (life) return life;
      if (!pass || pass.state !== 'open') return invalid(state!.rev, [{ path: 'pass_id', rule: 'invalid-reference', expected: 'open-pass' }]);
      if (canon.selected_attempt_id !== null && voice?.attempts.find((a) => a.attempt_id === canon.selected_attempt_id)?.outcome !== 'completed') {
        return invalid(state!.rev, [{ path: 'selected_attempt_id', rule: 'invalid-reference', expected: 'completed-attempt-on-voice' }]);
      }
      const nextVoices = voice
        ? pass.voices.map((vo) => vo.voice_id === canon.voice_id ? { ...vo, selected_attempt_id: canon.selected_attempt_id, not_applicable: canon.not_applicable, recorded_at: nowIso } : vo)
        : [...pass.voices, { voice_id: canon.voice_id, part: null, required: false, not_applicable: canon.not_applicable, selected_attempt_id: canon.selected_attempt_id, attempts: [], recorded_at: nowIso }];
      return recorded({ ...state!, rev: state!.rev + 1, passes: state!.passes.map((p) => p.pass_id === pass.pass_id ? { ...p, voices: nextVoices } : p) }, { head: pass.candidate.commit, tree: pass.candidate.tree, recorded_at: nowIso });
    }

    const c = checkShape(rawInput, 'record pass (completed)', { pass_id: R.uuid, completed_at: R.isoZ }, v);
    if (v.length > 0) return invalid(rev, v);
    const canon = { pass_id: c.pass_id as string, state: 'completed' as const, completed_at: c.completed_at as string };
    const pass = state?.passes.find((p) => p.pass_id === canon.pass_id);
    if (pass && pass.state === 'completed' && state) {
      return replayOrConflict(state.rev, canon.pass_id, { pass_id: pass.pass_id, state: 'completed' as const, completed_at: pass.completed_at }, canon, pass.candidate.commit, pass.candidate.tree, pass.completed_recorded_at!);
    }
    const life = checkLifecycle();
    if (life) return life;
    if (!pass) return invalid(state!.rev, [{ path: 'pass_id', rule: 'invalid-reference', expected: 'existing-pass' }]);
    return recorded({ ...state!, rev: state!.rev + 1, passes: state!.passes.map((p) => p.pass_id === pass.pass_id ? { ...p, completed_at: canon.completed_at, state: 'completed' as const, completed_recorded_at: nowIso } : p) }, { head: pass.candidate.commit, tree: pass.candidate.tree, recorded_at: nowIso });
  }

  if (command === 'record correction') {
    const c = checkShape(rawInput, 'record correction', { correction_id: R.uuid, adjudication: R.enumN(ENUMS.correctionAdjudication), resolution: R.enumN(ENUMS.resolution), receipt_class: R.enumN(ENUMS.receiptClass), fixed_in: R.hex40N, supersedes: R.uuidN }, v);
    let target = { pass_id: '', voice_id: '', attempt_id: '', finding_id: '' };
    if ('target' in rawInput) {
      if (!isObj(rawInput.target)) v.push({ path: 'target', rule: 'invalid-type', expected: 'object' });
      else target = validateFields(rawInput.target, STATE_KEYS.target, {}, { pass_id: R.uuid, voice_id: R.voice, attempt_id: R.uuid, finding_id: R.safeId }, 'target', v) as unknown as typeof target;
    }
    if (c.adjudication === null && c.resolution === null && c.receipt_class === null && c.fixed_in === null) v.push({ path: 'correction_id', rule: 'invalid-value', expected: 'at-least-one-change-field-required' });
    if (c.adjudication === 'rejected' && c.resolution !== null && c.resolution !== 'unknown') v.push({ path: 'resolution', rule: 'invalid-value', expected: 'unknown-when-rejected' });
    if (v.length > 0) return invalid(rev, v);

    const canon = { correction_id: c.correction_id as string, target, adjudication: c.adjudication as string | null, resolution: c.resolution as string | null, receipt_class: c.receipt_class as string | null, fixed_in: c.fixed_in as string | null, supersedes: c.supersedes as string | null };
    const existing = state?.corrections.find((x) => x.correction_id === canon.correction_id);
    if (existing && state) {
      const { recorded_at: _, segment: _seg, head, tree, ...stored } = existing;
      return replayOrConflict(state.rev, canon.correction_id, stored, canon, head, tree, existing.recorded_at);
    }
    const life = checkLifecycle();
    if (life) return life;
    const finding = state!.passes.find((p) => p.pass_id === target.pass_id)?.voices.find((vo) => vo.voice_id === target.voice_id)?.attempts.find((a) => a.attempt_id === target.attempt_id)?.findings?.find((f) => f.finding_id === target.finding_id);
    if (!finding) return invalid(state!.rev, [{ path: 'target', rule: 'invalid-reference', expected: 'existing-finding' }]);

    const prior = state!.corrections.filter((x) => x.target.pass_id === target.pass_id && x.target.voice_id === target.voice_id && x.target.attempt_id === target.attempt_id && x.target.finding_id === target.finding_id);
    const expectedSup = prior.length > 0 ? prior[prior.length - 1]!.correction_id : null;
    if (canon.supersedes !== expectedSup) return invalid(state!.rev, [{ path: 'supersedes', rule: 'invalid-reference', expected: expectedSup ?? 'null' }]);
    let effAdj = finding.adjudication, effRes = finding.resolution;
    for (const x of [...prior, canon]) { if (x.adjudication !== null) effAdj = x.adjudication; if (x.resolution !== null) effRes = x.resolution; }
    if ((effAdj === 'rejected' || effAdj === 'duplicate') && effRes !== 'unknown') return invalid(state!.rev, [{ path: 'resolution', rule: 'invalid-value', expected: 'unknown-for-rejected-or-duplicate' }]);
    if (canon.fixed_in !== null && !env.commitExists(canon.fixed_in)) return invalid(state!.rev, [{ path: 'fixed_in', rule: 'commit-not-found', expected: 'existing-git-commit' }]);

    return recorded({ ...state!, rev: state!.rev + 1, corrections: [...state!.corrections, { ...canon, segment: activeSegment, head: git.head, tree: git.tree, recorded_at: nowIso }] }, { head: git.head, tree: git.tree, recorded_at: nowIso });
  }

  if (command === 'record gate') {
    const gName = rawInput.name;
    const c = checkShape(rawInput, 'record gate', { gate_id: R.uuid, name: R.safeId, result: R.enum(ENUMS.gateResult), reason: R.strN(1, 500) }, v, gName === 'pregate' || gName === 'greptile' ? ['details'] : []);
    const cand = 'candidate' in rawInput ? validateCandidateInput(rawInput.candidate, 'candidate', v) : { commit: '', base: null, wtree: null };
    const evidence = validateEvidenceList(rawInput.evidence, 'evidence', v);
    let details: Record<string, unknown> = {};
    if (c.details !== undefined) {
      if (!isObj(c.details)) v.push({ path: 'details', rule: 'invalid-type', expected: 'object' });
      else if (gName === 'pregate') {
        details = validateFields(c.details, ['raw_verdict', 'wrapper_verdict', 'policy', 'record_path', 'record_sha256', 'skipped_lanes'], {}, {
          raw_verdict: R.str(1, 64), wrapper_verdict: R.str(1, 64), policy: R.enum(ENUMS.pregatePolicy), record_path: R.relPath, record_sha256: R.hex64,
          skipped_lanes: { check: (x): x is string[] => Array.isArray(x) && x.every(R.safeId.check), expected: 'safe-id-array' },
        }, 'details', v);
      } else if (gName === 'greptile') {
        details = validateFields(c.details, ['value'], { run: null }, { value: R.str(1, 200), run: R.urlN }, 'details', v);
      } else checkKeys(c.details, [], [], 'details', v);
    }
    if (v.length > 0) return invalid(rev, v);

    const canon = { gate_id: c.gate_id as string, name: c.name as string, result: c.result as string, reason: c.reason as string | null, candidate: cand, details, evidence };
    const existing = state?.gates.find((g) => g.gate_id === canon.gate_id);
    if (existing && state) {
      const stored = { gate_id: existing.gate_id, name: existing.name, result: existing.result, reason: existing.reason, candidate: { commit: existing.candidate.commit, base: existing.candidate.base, wtree: existing.candidate.wtree }, details: existing.details, evidence: existing.evidence };
      return replayOrConflict(state.rev, canon.gate_id, stored, canon, existing.candidate.commit, existing.candidate.tree, existing.recorded_at);
    }
    const life = checkLifecycle();
    if (life) return life;
    const cTree = checkCandAndEv(canon.candidate, collectEvidenceItems(command, canon), env, v);
    if (v.length > 0) return invalid(state!.rev, v);

    const gateRecord: GateRecord = { ...canon, segment: activeSegment, candidate: { commit: canon.candidate.commit, tree: cTree!, base: canon.candidate.base, wtree: canon.candidate.wtree }, recorded_at: nowIso };
    return recorded({ ...state!, rev: state!.rev + 1, gates: [...state!.gates, gateRecord] }, { head: gateRecord.candidate.commit, tree: gateRecord.candidate.tree, recorded_at: nowIso });
  }

  if (command === 'record audit') {
    const c = checkShape(rawInput, 'record audit', { audit_id: R.uuid, name: R.enum(ENUMS.auditName), result: R.str(1, 200) }, v);
    const cand = 'candidate' in rawInput ? validateCandidateInput(rawInput.candidate, 'candidate', v) : { commit: '', base: null, wtree: null };
    const evidence = validateEvidenceList(rawInput.evidence, 'evidence', v);
    let details: Record<string, unknown> = {};
    if ('details' in rawInput) {
      if (!isObj(rawInput.details)) v.push({ path: 'details', rule: 'invalid-type', expected: 'object' });
      else if (c.name === 'coverage') {
        const isPct = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 100;
        details = validateFields(rawInput.details, ['threshold'], { pct: null }, {
          pct: { check: nullable(isPct), expected: 'number-0..100|null' },
          threshold: { check: (x): x is number | string => isPct(x) || isStr(x, 1, 64), expected: 'number-0..100|string-1..64' },
        }, 'details', v);
      } else if (c.name === 'documentation') {
        details = validateFields(rawInput.details, ['report_id', 'section_path', 'section_sha256'], {}, { report_id: R.safeId, section_path: R.relPath, section_sha256: R.hex64 }, 'details', v);
      }
    }
    if (v.length > 0) return invalid(rev, v);

    const canon = { audit_id: c.audit_id as string, name: c.name as string, result: c.result as string, details, candidate: cand, evidence };
    const existing = state?.audits.find((a) => a.audit_id === canon.audit_id);
    if (existing && state) {
      const stored = { audit_id: existing.audit_id, name: existing.name, result: existing.result, details: existing.details, candidate: { commit: existing.candidate.commit, base: existing.candidate.base, wtree: existing.candidate.wtree }, evidence: existing.evidence };
      return replayOrConflict(state.rev, canon.audit_id, stored, canon, existing.candidate.commit, existing.candidate.tree, existing.recorded_at);
    }
    const life = checkLifecycle();
    if (life) return life;
    const cTree = checkCandAndEv(canon.candidate, collectEvidenceItems(command, canon), env, v);
    if (v.length > 0) return invalid(state!.rev, v);

    const auditRecord: AuditRecord = { ...canon, segment: activeSegment, candidate: { commit: canon.candidate.commit, tree: cTree!, base: canon.candidate.base, wtree: canon.candidate.wtree }, recorded_at: nowIso };
    return recorded({ ...state!, rev: state!.rev + 1, audits: [...state!.audits, auditRecord] }, { head: auditRecord.candidate.commit, tree: auditRecord.candidate.tree, recorded_at: nowIso });
  }

  if (command === 'checkpoint') {
    const c = checkShape(rawInput, 'checkpoint', { checkpoint_id: R.uuid, kind: R.enum(ENUMS.checkpointKind), base: R.hex40N, wtree: R.wtreeN, session_id: R.sessionN }, v);
    if ((c.kind === 'external-gate' || c.kind === 'pause') && c.base === null) v.push({ path: 'base', rule: 'invalid-value', expected: 'required-hex40-for-external-gate-and-pause' });
    if (c.kind === 'ready' && c.base === null) v.push({ path: 'base', rule: 'invalid-value', expected: 'required-hex40-for-ready' });
    if (c.kind !== 'resume' && c.session_id !== null) v.push({ path: 'session_id', rule: 'invalid-value', expected: 'null-when-kind-not-resume' });
    const evidence = validateEvidenceList(rawInput.evidence, 'evidence', v);
    if (v.length > 0) return invalid(rev, v);

    const canon = { checkpoint_id: c.checkpoint_id as string, kind: c.kind as string, base: c.base as string | null, wtree: c.wtree as string | null, session_id: c.session_id as string | null, evidence };
    const existing = state?.checkpoints.find((x) => x.checkpoint_id === canon.checkpoint_id);
    if (existing && state) {
      const stored = { checkpoint_id: existing.checkpoint_id, kind: existing.kind, base: existing.base, wtree: existing.wtree, session_id: existing.session_id, evidence: existing.evidence };
      return replayOrConflict(state.rev, canon.checkpoint_id, stored, canon, existing.head, existing.tree, existing.recorded_at);
    }
    const life = checkLifecycle();
    if (life) return life;
    const lastSeg = state!.segments[state!.segments.length - 1]!;
    if (canon.kind === 'resume' && lastSeg.end !== 'paused' && lastSeg.end !== null) {
      return invalid(state!.rev, [{ path: 'kind', rule: 'invalid-lifecycle', expected: 'paused-or-open-run-required-for-resume' }]);
    }
    if (canon.kind === 'resume' && lastSeg.end === null && canon.session_id !== null && canon.session_id === lastSeg.session_id) {
      return invalid(state!.rev, [{ path: 'session_id', rule: 'same-session-resume', expected: 'different-session-id-or-null-when-resuming-open-run' }]);
    }
    if (canon.base !== null && !env.commitExists(canon.base)) v.push({ path: 'base', rule: 'commit-not-found', expected: 'existing-git-commit' });
    else if (canon.kind === 'ready' && canon.base !== null && !env.isAncestor(canon.base, git.head)) v.push({ path: 'base', rule: 'not-ancestor', expected: 'ancestor-of-head' });
    canon.evidence.forEach((ev, i) => { const err = env.checkEvidence(ev.path, ev.sha256); if (err) v.push({ path: `evidence[${i}]`, rule: err, expected: 'valid-evidence-file-in-dir' }); });
    if (v.length > 0) return invalid(state!.rev, v);

    const nextSegments = canon.kind === 'pause'
      ? state!.segments.map((s, i) => i === state!.segments.length - 1 ? { ...s, ended_at: nowIso, end: 'paused' as const } : s)
      : canon.kind === 'resume'
        ? [
            ...state!.segments.map((s, i) =>
              i === state!.segments.length - 1 && s.end === null
                ? { ...s, ended_at: latestHelperTimestamp(state!, s.started_at), end: 'interrupted' as const }
                : s,
            ),
            { segment: state!.segments.length + 1, started_at: nowIso, ended_at: null, end: null, session_id: canon.session_id, toplevel: git.toplevel },
          ]
        : state!.segments;
    const cpSegment = nextSegments[nextSegments.length - 1]!.segment;
    const cpRecord: CheckpointRecord = { ...canon, segment: cpSegment, head: git.head, tree: git.tree, recorded_at: nowIso };
    return recorded({ ...state!, rev: state!.rev + 1, segments: nextSegments, checkpoints: [...state!.checkpoints, cpRecord] }, { head: git.head, tree: git.tree, recorded_at: nowIso });
  }

  // finish
  const c = checkShape(rawInput, 'finish', {
    outcome: R.enum(ENUMS.finishOutcome), base: R.hex40, stop_reason: R.strN(1, 500), delta_base: R.hex40N,
    stop_count: R.posIntN, wtree: R.wtreeN, review_restriction_resolved: R.bool, readiness_confirmed_at: R.isoZN,
    user_facing_changes: { check: (x): x is string[] => Array.isArray(x) && x.every((s) => isStr(s, 1, 500)), expected: 'string-array' },
  }, v);
  if (c.outcome === 'prepared' && c.stop_reason !== null) v.push({ path: 'stop_reason', rule: 'invalid-value', expected: 'null-when-prepared' });
  if (inEnum(ENUMS.finishOutcome)(c.outcome) && c.outcome !== 'prepared' && c.stop_reason === null) v.push({ path: 'stop_reason', rule: 'invalid-value', expected: 'required-when-not-prepared' });
  if ((c.outcome === 'stopped') !== (c.delta_base !== null)) v.push({ path: 'delta_base', rule: 'invalid-value', expected: c.outcome === 'stopped' ? 'required-when-stopped' : 'null-when-not-stopped' });
  if ((c.outcome === 'stopped') !== (c.stop_count !== null)) v.push({ path: 'stop_count', rule: 'invalid-value', expected: c.outcome === 'stopped' ? 'required-when-stopped' : 'null-when-not-stopped' });

  let fullRev: FullReviewEvidence | null = null;
  if (c.full_review_evidence !== null) {
    if (!isObj(c.full_review_evidence)) v.push({ path: 'full_review_evidence', rule: 'invalid-type', expected: 'object|null' });
    else if (c.full_review_evidence.status === 'available') {
      fullRev = validateFields(c.full_review_evidence, ['status', 'commit', 'tree', 'source'], {}, { commit: R.hex40, tree: R.hex40, source: R.sourceRef }, 'full_review_evidence', v) as unknown as FullReviewEvidence;
    } else if (c.full_review_evidence.status === 'unavailable') {
      fullRev = validateFields(c.full_review_evidence, ['status', 'reason'], {}, { reason: R.str(1, 200) }, 'full_review_evidence', v) as unknown as FullReviewEvidence;
    } else v.push({ path: 'full_review_evidence.status', rule: 'invalid-enum', expected: 'available|unavailable' });
  }
  const evidence = validateEvidenceList(rawInput.evidence, 'evidence', v);
  if (v.length > 0) return invalid(rev, v);

  const canon = {
    outcome: c.outcome as string, stop_reason: c.stop_reason as string | null, base: c.base as string,
    delta_base: c.delta_base as string | null, stop_count: c.stop_count as number | null, wtree: c.wtree as string | null,
    review_restriction_resolved: c.review_restriction_resolved as boolean, readiness_confirmed_at: c.readiness_confirmed_at as string | null,
    full_review_evidence: fullRev, user_facing_changes: c.user_facing_changes as string[], evidence,
  };
  if (state?.finish) {
    const { head: _h, tree: _t, finished_at: _f, ...stored } = state.finish;
    if (!firstDiff(stored, canon)) {
      return { reason: 'replayed', rev: state.rev, detail: { head: state.finish.head, tree: state.finish.tree, recorded_at: state.finish.finished_at, ...(state.finish.head !== git.head ? { head_moved: true } : {}) } };
    }
    return { reason: 'finished', rev: state.rev, detail: { outcome: state.finish.outcome } };
  }
  const life = checkLifecycle();
  if (life) return life;
  if (canon.outcome === 'prepared' && state!.passes.some((p) => p.state === 'open')) return invalid(state!.rev, [{ path: 'outcome', rule: 'open-pass', expected: 'all-passes-completed-when-prepared' }]);
  if (!env.commitExists(canon.base)) v.push({ path: 'base', rule: 'commit-not-found', expected: 'existing-git-commit' });
  else if (!env.isAncestor(canon.base, git.head)) v.push({ path: 'base', rule: 'not-ancestor', expected: 'ancestor-of-head' });
  if (canon.delta_base !== null && !env.commitExists(canon.delta_base)) v.push({ path: 'delta_base', rule: 'commit-not-found', expected: 'existing-git-commit' });
  if (canon.full_review_evidence?.status === 'available' && !env.commitExists(canon.full_review_evidence.commit)) v.push({ path: 'full_review_evidence.commit', rule: 'commit-not-found', expected: 'existing-git-commit' });
  canon.evidence.forEach((ev, i) => { const err = env.checkEvidence(ev.path, ev.sha256); if (err) v.push({ path: `evidence[${i}]`, rule: err, expected: 'valid-evidence-file-in-dir' }); });
  if (v.length > 0) return invalid(state!.rev, v);

  const nextSegments = state!.segments.map((s, i) => i === state!.segments.length - 1 ? { ...s, ended_at: nowIso, end: 'finished' as const } : s);
  return recorded({ ...state!, rev: state!.rev + 1, segments: nextSegments, finish: { ...canon, head: git.head, tree: git.tree, finished_at: nowIso } }, { head: git.head, tree: git.tree, recorded_at: nowIso });
}

function latestHelperTimestamp(state: ReviewRunState, fallback: string): string {
  let best = fallback;
  let bestMs = Date.parse(fallback);
  const consider = (ts: string | null) => {
    if (ts === null) return;
    const ms = Date.parse(ts);
    if (ms > bestMs) {
      best = ts;
      bestMs = ms;
    }
  };
  for (const p of state.passes) {
    consider(p.recorded_at);
    consider(p.completed_recorded_at);
    for (const vo of p.voices) {
      consider(vo.recorded_at);
      for (const a of vo.attempts) consider(a.recorded_at);
    }
  }
  for (const c of state.corrections) consider(c.recorded_at);
  for (const g of state.gates) consider(g.recorded_at);
  for (const a of state.audits) consider(a.recorded_at);
  for (const cp of state.checkpoints) consider(cp.recorded_at);
  return best;
}

function applyAdditiveV1Defaults(raw: Record<string, unknown>): void {
  for (const [k, def] of Object.entries(ADDITIVE_V1_DEFAULTS.root)) {
    if (!(k in raw)) raw[k] = def;
  }
  for (const coll of ['passes', 'corrections', 'gates', 'audits', 'checkpoints'] as const) {
    const arr = raw[coll];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (!isObj(item)) continue;
      for (const [k, def] of Object.entries(ADDITIVE_V1_DEFAULTS[coll])) {
        if (!(k in item)) item[k] = def;
      }
    }
  }
}

export type StoredValidationResult =
  | { ok: true; state: ReviewRunState }
  | { ok: false; reason: 'corrupt' | 'newer-schema'; detail: Record<string, unknown> };

export function validateStoredState(raw: unknown, statePath: string, helperVersion: string | null = null): StoredValidationResult {
  if (isObj(raw) && typeof raw.schema === 'string') {
    const m = /^review-run-state\/v([1-9]\d*)$/.exec(raw.schema);
    if (m && Number(m[1]) > 1) {
      return {
        ok: false,
        reason: 'newer-schema',
        detail: {
          path: truncate80(statePath),
          schema: truncate80(raw.schema),
          writer: isVersion(raw.writer) ? raw.writer : null,
          message: truncate80(`unsupported schema ${raw.schema}`),
        },
      };
    }
    if (raw.schema === SCHEMA_VERSION) applyAdditiveV1Defaults(raw);
  }
  const v: Violation[] = [];
  const object = (value: unknown, keys: readonly string[], rules: Record<string, FieldRule>, path: string): Record<string, unknown> | null => {
    if (!isObj(value)) { v.push({ path, rule: 'invalid-type', expected: 'object' }); return null; }
    validateFields(value, keys, {}, rules, path, v);
    return value;
  };
  const array = (value: unknown, path: string, visit: (value: unknown, path: string) => void) => {
    if (!Array.isArray(value)) { v.push({ path, rule: 'invalid-type', expected: 'array' }); return; }
    value.forEach((x, i) => visit(x, `${path}[${i}]`));
  };
  const strings = (check: (x: unknown) => boolean, nonempty = false): FieldRule => ({
    check: (x) => Array.isArray(x) && (!nonempty || x.length > 0) && new Set(x).size === x.length && x.every(check), expected: 'unique-string-array',
  });
  const unique = (set: Set<string>, id: unknown, path: string) => {
    if (typeof id !== 'string') return;
    if (set.has(id)) v.push({ path, rule: 'duplicate-value', expected: 'unique-id' });
    set.add(id);
  };
  const reference = (ok: boolean, path: string) => { if (!ok) v.push({ path, rule: 'invalid-reference', expected: 'existing-record' }); };
  const candidate = (x: unknown, path: string) => object(x, STATE_KEYS.candidate, { commit: R.hex40, tree: R.hex40, base: R.hex40N, wtree: R.wtreeN }, path);
  const evidence = (x: unknown, path: string) => array(x, path, (e, p) => { object(e, STATE_KEYS.evidence, { path: R.relPath, sha256: R.hex64 }, p); });
  const root = object(raw, STATE_KEYS.root, { schema: R.enum([SCHEMA_VERSION]), rev: R.posInt, writer: R.versionN }, '');
  if (root) {
    const run = object(root.run, STATE_KEYS.run, { run_id: R.uuid, skill: R.enum(['review-and-prep']), repo: R.str(1, 500), branch: R.str(1, 200), gh_login: R.strN(1, 128, true), started_at: R.isoZ }, 'run');
    if (run && run.pr !== null) object(run.pr, STATE_KEYS.pr, { url: R.url, repo: R.str(1, 200, true), number: R.posInt, head_repo: R.str(1, 200, true), head_branch: R.str(1, 200, true), base_ref: R.str(1, 200, true) }, 'run.pr');
    object(root.binding, STATE_KEYS.binding, { head: R.hex40, tree: R.hex40, base: R.hex40, wtree: R.wtreeN }, 'binding');
    object(root.plan, STATE_KEYS.plan, { ref: R.str(1, 500), sha256: R.hex64 }, 'plan');
    const policy = object(root.policy, STATE_KEYS.policy, { value: R.strN(1, 500), source: R.enum(ENUMS.policySource) }, 'policy');
    if (policy && policy.delegation !== null) {
      const d = policy.delegation;
      if (isObj(d) && d.status === 'active') {
        object(d, ['status', 'parts', 'config', 'tools'], { status: R.enum(['active']), config: R.hex64, parts: strings(isPart, true), tools: strings(isPart) }, 'policy.delegation');
        if (Array.isArray(d.parts) && Array.isArray(d.tools)) reference(d.tools.every((x) => d.parts.includes(x)), 'policy.delegation.tools');
      } else object(d, ['status', 'reason'], { status: R.enum(['inactive']), reason: R.str(1, 200) }, 'policy.delegation');
    }
    object(root.continuation, STATE_KEYS.continuation, { prior_stops: R.nonNegInt, max: R.nonNegInt, continues: R.hex40N }, 'continuation');
    array(root.segments, 'segments', (x, path) => {
      object(x, STATE_KEYS.segment, { segment: R.posInt, started_at: R.isoZ, ended_at: R.isoZN, end: R.enumN(['paused', 'finished', 'interrupted']), session_id: R.sessionN, toplevel: R.str(1, 500) }, path);
    });
    if (Array.isArray(root.segments)) {
      if (!root.segments.length) v.push({ path: 'segments', rule: 'missing-segment', expected: 'nonempty-array' });
      root.segments.forEach((s, i) => reference(isObj(s) && s.segment === i + 1, `segments[${i}].segment`));
    }
    const segCount = Array.isArray(root.segments) ? root.segments.length : 0;
    const segRule: FieldRule = {
      check: nullable((x): x is number => isPosInt(x) && x <= segCount),
      expected: `int-1..${segCount}|null`,
    };
    const passIds = new Set<string>(), attemptIds = new Set<string>(), findingIds = new Set<string>();
    const findingTargets = new Set<string>();
    array(root.passes, 'passes', (x, path) => {
      const p = object(x, STATE_KEYS.pass, { pass_id: R.uuid, segment: segRule, scope: R.enum(ENUMS.passScope), cycle: R.posInt, coverage: R.enum(ENUMS.passCoverage), delta_from: R.hex40N, required_voices: strings(R.voice.check, true), started_at: R.isoZ, completed_at: R.isoZN, state: R.enum(['open', 'completed']), recorded_at: R.isoZ, completed_recorded_at: R.isoZN }, path);
      if (!p) return;
      unique(passIds, p.pass_id, `${path}.pass_id`); candidate(p.candidate, `${path}.candidate`);
      const voiceIds = new Set<string>();
      array(p.voices, `${path}.voices`, (x, vp) => {
        const vo = object(x, STATE_KEYS.voice, { voice_id: R.voice, part: R.partN, required: R.bool, not_applicable: R.enumN(ENUMS.naReason), selected_attempt_id: R.uuidN, recorded_at: R.isoZN }, vp);
        if (!vo) return;
        unique(voiceIds, vo.voice_id, `${vp}.voice_id`);
        const prior = new Set<string>();
        array(vo.attempts, `${vp}.attempts`, (x, ap) => {
          const a = object(x, STATE_KEYS.attempt, { attempt_id: R.uuid, part: R.partN, outcome: R.enum(ENUMS.attemptOutcome), predecessor_attempt_id: R.uuidN, dispatched_at: R.isoZN, returned_at: R.isoZN, recorded_at: R.isoZ }, ap);
          if (!a) return;
          if (a.predecessor_attempt_id !== null) reference(prior.has(a.predecessor_attempt_id as string), `${ap}.predecessor_attempt_id`);
          unique(attemptIds, a.attempt_id, `${ap}.attempt_id`); prior.add(a.attempt_id as string);
          if (a.delegate !== null) object(a.delegate, STATE_KEYS.delegate, { provider: R.provider, model: R.safeId, outcome: R.enum(ENUMS.delegateOutcome), fallback_reason: R.enumN(ENUMS.fallbackReason), replay: R.bool, wall_ms: R.nonNegInt, input_tokens: R.nonNegInt, output_tokens: R.nonNegInt, cache_read_input_tokens: R.nonNegInt, cache_creation_input_tokens: R.nonNegIntN, call_id: R.hex64 }, `${ap}.delegate`);
          if (a.findings === null) {
            if (a.outcome === 'completed') v.push({ path: `${ap}.findings`, rule: 'invalid-type', expected: 'array' });
          } else array(a.findings, `${ap}.findings`, (x, fp) => {
            const f = object(x, STATE_KEYS.finding, { finding_id: R.safeId, severity_source: R.enum(ENUMS.severity), severity_rubric: R.enum(ENUMS.rubric), adjudication: R.enum(ENUMS.adjudication), resolution: R.enum(ENUMS.resolution), duplicate_of: R.safeIdN, found_by: strings(isPart), attribution_reason: R.enumN(ENUMS.attrReason), receipt_class: R.enumN(ENUMS.receiptClass) }, fp);
            if (!f) return;
            unique(findingIds, f.finding_id, `${fp}.finding_id`);
            findingTargets.add(JSON.stringify([p.pass_id, vo.voice_id, a.attempt_id, f.finding_id]));
          });
        });
        if (vo.selected_attempt_id !== null) reference(Array.isArray(vo.attempts) && vo.attempts.some((a) => isObj(a) && a.attempt_id === vo.selected_attempt_id && a.outcome === 'completed'), `${vp}.selected_attempt_id`);
        if (Array.isArray(p.required_voices)) reference(vo.required === p.required_voices.includes(vo.voice_id), `${vp}.required`);
      });
      if (Array.isArray(p.required_voices)) for (const id of p.required_voices) reference(voiceIds.has(id), `${path}.required_voices`);
    });
    const correctionIds = new Set<string>(), chains = new Map<string, unknown>();
    array(root.corrections, 'corrections', (x, path) => {
      const c = object(x, STATE_KEYS.correction, { correction_id: R.uuid, segment: segRule, adjudication: R.enumN(ENUMS.correctionAdjudication), resolution: R.enumN(ENUMS.resolution), receipt_class: R.enumN(ENUMS.receiptClass), fixed_in: R.hex40N, supersedes: R.uuidN, head: R.hex40, tree: R.hex40, recorded_at: R.isoZ }, path);
      if (!c) return;
      unique(correctionIds, c.correction_id, `${path}.correction_id`);
      const t = object(c.target, STATE_KEYS.target, { pass_id: R.uuid, voice_id: R.voice, attempt_id: R.uuid, finding_id: R.safeId }, `${path}.target`);
      if (t) {
        const key = JSON.stringify([t.pass_id, t.voice_id, t.attempt_id, t.finding_id]);
        reference(findingTargets.has(key), `${path}.target`); reference(c.supersedes === (chains.get(key) ?? null), `${path}.supersedes`); chains.set(key, c.correction_id);
      }
    });
    const gateIds = new Set<string>(), auditIds = new Set<string>(), checkpointIds = new Set<string>();
    array(root.gates, 'gates', (x, path) => {
      const g = object(x, STATE_KEYS.gate, { gate_id: R.uuid, segment: segRule, name: R.safeId, result: R.enum(ENUMS.gateResult), reason: R.strN(1, 500), recorded_at: R.isoZ }, path);
      if (!g) return;
      unique(gateIds, g.gate_id, `${path}.gate_id`); candidate(g.candidate, `${path}.candidate`); evidence(g.evidence, `${path}.evidence`);
      if (g.name === 'pregate') object(g.details, ['raw_verdict', 'wrapper_verdict', 'policy', 'record_path', 'record_sha256', 'skipped_lanes'], { raw_verdict: R.str(1, 64), wrapper_verdict: R.str(1, 64), policy: R.enum(ENUMS.pregatePolicy), record_path: R.relPath, record_sha256: R.hex64, skipped_lanes: { check: (x) => Array.isArray(x) && x.every(R.safeId.check), expected: 'safe-id-array' } }, `${path}.details`);
      else if (g.name === 'greptile') object(g.details, ['value', 'run'], { value: R.str(1, 200), run: R.urlN }, `${path}.details`);
      else object(g.details, [], {}, `${path}.details`);
    });
    array(root.audits, 'audits', (x, path) => {
      const a = object(x, STATE_KEYS.audit, { audit_id: R.uuid, segment: segRule, name: R.enum(ENUMS.auditName), result: R.str(1, 200), recorded_at: R.isoZ }, path);
      if (!a) return;
      unique(auditIds, a.audit_id, `${path}.audit_id`); candidate(a.candidate, `${path}.candidate`); evidence(a.evidence, `${path}.evidence`);
      if (a.name === 'documentation') object(a.details, ['report_id', 'section_path', 'section_sha256'], { report_id: R.safeId, section_path: R.relPath, section_sha256: R.hex64 }, `${path}.details`);
      else {
        const pct = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 100;
        object(a.details, ['pct', 'threshold'], { pct: { check: (x) => x === null || pct(x), expected: 'number-0..100|null' }, threshold: { check: (x) => pct(x) || isStr(x, 1, 64), expected: 'number-0..100|string-1..64' } }, `${path}.details`);
      }
    });
    array(root.checkpoints, 'checkpoints', (x, path) => {
      const c = object(x, STATE_KEYS.checkpoint, { checkpoint_id: R.uuid, segment: segRule, kind: R.enum(ENUMS.checkpointKind), head: R.hex40, tree: R.hex40, base: R.hex40N, wtree: R.wtreeN, session_id: R.sessionN, recorded_at: R.isoZ }, path);
      if (c) { unique(checkpointIds, c.checkpoint_id, `${path}.checkpoint_id`); evidence(c.evidence, `${path}.evidence`); }
    });
    if (root.finish !== null) {
      const f = object(root.finish, STATE_KEYS.finish, { outcome: R.enum(ENUMS.finishOutcome), stop_reason: R.strN(1, 500), head: R.hex40, tree: R.hex40, base: R.hex40, delta_base: R.hex40N, stop_count: R.posIntN, wtree: R.wtreeN, review_restriction_resolved: R.bool, readiness_confirmed_at: R.isoZN, user_facing_changes: { check: (x) => Array.isArray(x) && x.every((s) => isStr(s, 1, 500)), expected: 'string-array' }, finished_at: R.isoZ }, 'finish');
      if (f) {
        evidence(f.evidence, 'finish.evidence');
        if (f.full_review_evidence !== null) {
          const e = f.full_review_evidence;
          if (isObj(e) && e.status === 'available') object(e, ['status', 'commit', 'tree', 'source'], { status: R.enum(['available']), commit: R.hex40, tree: R.hex40, source: R.sourceRef }, 'finish.full_review_evidence');
          else object(e, ['status', 'reason'], { status: R.enum(['unavailable']), reason: R.str(1, 200) }, 'finish.full_review_evidence');
        }
      }
    }
  }
  if (v.length) {
    const msg = truncate80(`${v[0]!.rule} at ${v[0]!.path}`);
    if (isObj(raw) && raw.schema === SCHEMA_VERSION && isVersionNewer(raw.writer, helperVersion)) {
      return {
        ok: false,
        reason: 'newer-schema',
        detail: { path: truncate80(statePath), schema: SCHEMA_VERSION, writer: raw.writer as string, message: msg },
      };
    }
    return { ok: false, reason: 'corrupt', detail: { path: truncate80(statePath), message: msg } };
  }
  return { ok: true, state: raw as ReviewRunState };
}

const pick = <T extends Record<string, unknown>>(obj: T, keys: readonly string[]): T =>
  Object.fromEntries(keys.map((k) => [k, obj[k]])) as T;

export function serializeState(s: ReviewRunState): string {
  const ordCand = (c: CandidateBinding) => pick(c, STATE_KEYS.candidate);
  const ordEv = (e: EvidenceRef[]) => e.map((x) => pick(x, STATE_KEYS.evidence));
  const ordered = pick({
    ...s,
    run: pick({ ...s.run, pr: s.run.pr ? pick(s.run.pr, STATE_KEYS.pr) : null }, STATE_KEYS.run),
    binding: pick(s.binding, STATE_KEYS.binding),
    plan: pick(s.plan, STATE_KEYS.plan),
    policy: pick({
      ...s.policy,
      delegation: s.policy.delegation
        ? s.policy.delegation.status === 'active'
          ? { status: 'active', parts: [...s.policy.delegation.parts], config: s.policy.delegation.config, tools: [...s.policy.delegation.tools] }
          : { status: 'inactive', reason: s.policy.delegation.reason }
        : null,
    }, STATE_KEYS.policy),
    continuation: pick(s.continuation, STATE_KEYS.continuation),
    segments: s.segments.map((seg) => pick(seg, STATE_KEYS.segment)),
    passes: s.passes.map((p) => pick({
      ...p, candidate: ordCand(p.candidate), required_voices: [...p.required_voices],
      voices: p.voices.map((vo) => pick({
        ...vo,
        attempts: vo.attempts.map((a) => pick({
          ...a,
          delegate: a.delegate ? pick(a.delegate, STATE_KEYS.delegate) : null,
          findings: a.findings ? a.findings.map((f) => pick({ ...f, found_by: [...f.found_by] }, STATE_KEYS.finding)) : null,
        }, STATE_KEYS.attempt)),
      }, STATE_KEYS.voice)),
    }, STATE_KEYS.pass)),
    corrections: s.corrections.map((c) => pick({ ...c, target: pick(c.target, STATE_KEYS.target) }, STATE_KEYS.correction)),
    gates: s.gates.map((g) => pick({
      ...g, candidate: ordCand(g.candidate), evidence: ordEv(g.evidence),
      details: pick(g.details, g.name === 'pregate'
        ? ['raw_verdict', 'wrapper_verdict', 'policy', 'record_path', 'record_sha256', 'skipped_lanes']
        : g.name === 'greptile' ? ['value', 'run'] : []),
    }, STATE_KEYS.gate)),
    audits: s.audits.map((a) => pick({
      ...a, candidate: ordCand(a.candidate), evidence: ordEv(a.evidence),
      details: pick(a.details, a.name === 'coverage' ? ['pct', 'threshold'] : ['report_id', 'section_path', 'section_sha256']),
    }, STATE_KEYS.audit)),
    checkpoints: s.checkpoints.map((cp) => pick({ ...cp, evidence: ordEv(cp.evidence) }, STATE_KEYS.checkpoint)),
    finish: s.finish ? pick({
      ...s.finish, user_facing_changes: [...s.finish.user_facing_changes], evidence: ordEv(s.finish.evidence),
      full_review_evidence: s.finish.full_review_evidence
        ? pick(s.finish.full_review_evidence, s.finish.full_review_evidence.status === 'available' ? ['status', 'commit', 'tree', 'source'] : ['status', 'reason']) : null,
    }, STATE_KEYS.finish) : null,
  }, STATE_KEYS.root);
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
