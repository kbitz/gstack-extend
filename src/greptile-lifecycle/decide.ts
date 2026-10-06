/**
 * Greptile lifecycle decision core (Track 22E).
 *
 * `decideGreptileLifecycle(observation)` maps one recorded observation of a
 * PR's Greptile state to exactly one next action — `trigger`, `wait`, `ask`
 * (with the documented named options), `continue` (with a closed
 * prerequisite), or `ready-eligible` — plus the firing rule, a reason, the
 * pinned policy source, evidence references, and diagnostics. It is
 * synchronous and pure: no filesystem, environment, clock, network, process,
 * or persistence access, and it never mutates its input. Effects stay with
 * the caller.
 *
 * First use, from an existing checkout with Bun >= 1.3.3:
 *
 *   bun install --frozen-lockfile
 *   bun test tests/greptile-lifecycle.test.ts -t 'crash between reservation'
 *
 * That replays `CRASH_EXAMPLE_INPUT` in tests/greptile-lifecycle.test.ts
 * ("synthetic: crash between reservation and trigger"), a complete
 * observation: a reservation comment posted at 2026-10-03T12:00:00.000Z by a
 * session that crashed before proving the trigger was never attempted,
 * observed by a new session exactly ten minutes later with a complete, empty
 * run list.
 *
 *   decideGreptileLifecycle(CRASH_EXAMPLE_INPUT)
 *   // => { action: 'ask', ruleId: 'R11.E4', policyCode: 'E4',
 *   //      title: 'No observable run after an MCP request.',
 *   //      options: [a 'Proceed as unverified' (recommended), b 'Stay draft'],
 *   //      edgeKey: 'E4|request=comment:1001', evidenceRefs: ['comment:1001'], ... }
 *
 * The reservation consumed the PR's single allowance, so no snapshot of it
 * ever re-triggers. Observed at 599999 ms, the same input waits
 * (R11.monitor-request): timers count evidence collection time, not decision
 * time alone.
 * While edits are uncommitted, run the whole suite directly
 * (`bun test tests/greptile-lifecycle.test.ts`): `bun run test` selects by the
 * committed diff and can miss working-tree changes.
 *
 * Precedence is the numbered table ROWS/RULES in policy.ts (R01–R14). Each
 * result names the single rule that fired; diagnostics give input paths and
 * remediation. There is no skipped-rule trace.
 *
 * Trust and coordination limits. Account and Greptile identities are
 * caller-supplied trust roots. Reservation arbitration orders the running
 * account's markers; it is not an external lock. A `trigger` result is a
 * recommendation valid only for its bound observation and this session's
 * confirmed, unattempted reservation; another account, or a session racing
 * between observation and effect, is outside what pure code can prevent.
 *
 * Adoption contract for Track 24B (not implemented here): call the core at
 * every trigger, pause, resume, and readiness boundary; revalidate the bound
 * subject, configuration, and history immediately before any effect;
 * serialize competing effects; journal `attempted`, with its transport, before
 * a trigger so an ambiguous submission keeps consuming the allowance; and never let skill
 * prose override a blocking result. The input contract is internal version 1;
 * collectors must be reconciled with types.ts before adoption. This Track is
 * complete when its executable decisions are tested, not when live agents
 * are shown to comply.
 */
import {
  ASKED_ONCE_LINE,
  CONTROL_CHARACTER,
  NO_RESPONSE_MS,
  QUESTIONS,
  RULES,
  classifyDiff,
  detectReadyTrigger,
  effectOf,
  hasRootMarker,
  markerChanges,
  optionSpec,
  policyFileChanges,
  remedyFile,
  requiredLabels,
  type Detection,
} from './policy.ts';
import { INPUT_VERSION, POLICY_REVISION, TIME_UNIT } from './types.ts';
import type {
  AncestryCheck,
  AskOption,
  ConfigFacts,
  ConfigRemedy,
  ContinueNext,
  DecisionRow,
  Diagnostic,
  DiagnosticCause,
  Evidence,
  GateSource,
  GreptileBasis,
  InvalidInputResult,
  LifecycleDecision,
  LifecycleInput,
  LifecycleResult,
  LocalGates,
  OptionId,
  OwnerJournalEntry,
  Producer,
  QuestionCode,
  ReceiptRecord,
  Remediation,
  RestrictionRow,
  RuleId,
  RunObservation,
  RunStatus,
  WaiverGrant,
  Sha,
  Subject,
  SubmissionRecord,
  WaitFor,
} from './types.ts';

/**
 * Decide the next Greptile lifecycle action for one recorded observation.
 * Pass a `LifecycleInput`; anything else returns `R01.invalid-input`.
 */
export function decideGreptileLifecycle(observation: unknown): LifecycleDecision {
  const checked = validateObservation(observation);
  if (!checked.ok) return invalidInput(observation, checked.issues);
  const ctx: Ctx = { input: checked.input, notes: [], memo: {} };
  const mismatches = subjectMismatches(ctx.input);
  if (mismatches.length > 0) {
    return finish(ctx, out('R01.subject-mismatch', cont('refresh-evidence'),
      `Evidence in this observation is bound to a different subject (${mismatches.length} binding problems); collect it again for ${subjectLabel(ctx.input.subject)}.`,
      [], mismatches));
  }
  const s = ctx.input.subject;
  if (s.state !== 'OPEN') {
    return finish(ctx, out('R02.terminal-pr', cont('no-op'),
      `PR #${s.prNumber} is ${s.state}; it needs a new work decision and is never reopened or acted on.`, []));
  }
  if (!s.isDraft) return finish(ctx, readOnlyCheck(ctx));
  return finish(ctx, evaluate(ctx, false));
}

// ─── Internal model ───────────────────────────────────────────────────────

type Body =
  | { action: 'continue'; next: ContinueNext }
  | { action: 'wait'; waitFor: WaitFor }
  | {
    action: 'ask'; policyCode: QuestionCode; title: string; edgeKey: string; options: AskOption[];
    recommendedOptionId: OptionId; notes: string[]; remedy: ConfigRemedy | null;
  }
  | {
    action: 'trigger'; transport: 'mcp' | 'comment'; reservationRef: string; requestedHeadSha: Sha;
    validFor: { observationId: string; sessionId: string }; consumesAllowance: true;
    configuration: 'verified-settings' | 'declared-intent-only'; requiredLabels: string[];
  }
  | { action: 'ready-eligible'; greptile: GreptileBasis; satisfiedGates: string[]; authority: 'recommendation-only' };

interface Outcome {
  ruleId: RuleId;
  reason: string;
  refs: string[];
  diagnostics: Diagnostic[];
  body: Body;
}

interface Ctx {
  input: LifecycleInput;
  notes: Diagnostic[];
  memo: {
    records?: Records;
    base?: BaseResult;
    history?: History;
    waiver?: Waiver | null;
    ancestry?: Map<Sha, 'ancestor' | 'stale' | 'unresolved'>;
    historyEdges?: Map<QuestionCode, Set<string> | 'unresolved'>;
    recordedRefs?: string[];
    e1?: E1Edge | null | 'unresolved';
    actors?: Set<string>;
    released?: Set<number>;
    consumption?: Map<boolean, boolean | 'unknown'>;
    skipConsumed?: boolean | 'unknown';
  };
}

function out(ruleId: RuleId, body: Body, reason: string, refs: string[], diagnostics: Diagnostic[] = []): Outcome {
  return { ruleId, body, reason, refs, diagnostics };
}

const cont = (next: ContinueNext): Body => ({ action: 'continue', next });

function diag(path: string, problem: string, cause: DiagnosticCause, remediation: Remediation, ruleId: RuleId): Diagnostic {
  return { path, problem, cause, remediation, policyRef: RULES[ruleId].policyRef };
}

function note(ctx: Ctx, path: string, problem: string, ruleId: RuleId, cause: DiagnosticCause = 'policy'): void {
  ctx.notes.push(diag(path, problem, cause, 'informational', ruleId));
}

function known<T>(e: Evidence<T>): T | null {
  return e.state === 'known' ? e.value : null;
}

function verifiedActors(ctx: Ctx): Set<string> {
  return ctx.memo.actors ??= new Set(ctx.input.caller.greptileActorIds);
}

function familyDiag(family: Family, e: Evidence<unknown>, ruleId: RuleId): Diagnostic {
  const what = e.state === 'incomplete' ? 'incomplete (missing pages or records)' : e.state;
  return diag(family, `${family} evidence is ${what}; this decision needs it complete and current`, 'collection', 'obtain-specific-evidence', ruleId);
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** Total order: digit-only ids first, ordered by magnitude then literal spelling; other ids by code unit. */
const cmpId = (a: string, b: string): number => {
  const na = /^\d+$/.test(a), nb = /^\d+$/.test(b);
  if (na !== nb) return na ? -1 : 1;
  if (!na) return cmp(a, b);
  const da = a.replace(/^0+(?=\d)/, ''), db = b.replace(/^0+(?=\d)/, '');
  return da.length - db.length || cmp(da, db) || cmp(a, b);
};
// Derived deadlines can exceed Date's domain while remaining safe epoch-ms.
const iso = (ms: number): string => ms <= MAX_EPOCH_MS ? new Date(ms).toISOString() : `${ms} epoch-ms`;

function subjectLabel(s: Subject): string {
  return `${s.host}/${s.baseRepository}#${s.prNumber} at head ${s.headSha}`;
}

function copySubject(s: Subject): Subject {
  return {
    host: s.host, baseRepository: s.baseRepository, headRepository: s.headRepository, prNumber: s.prNumber,
    baseBranch: s.baseBranch, headBranch: s.headBranch, baseSha: s.baseSha, headSha: s.headSha,
    state: s.state, isDraft: s.isDraft, createdAtEpochMs: s.createdAtEpochMs,
  };
}

function canonicalDiagnostics(list: Diagnostic[]): Diagnostic[] {
  const seen = new Map<string, Diagnostic>();
  for (const d of list) seen.set(`${d.path}\u0000${d.problem}\u0000${d.cause}`, d);
  return [...seen.values()].sort((a, b) => cmp(a.path, b.path) || cmp(a.problem, b.problem));
}

function finish(ctx: Ctx, o: Outcome): LifecycleResult {
  return {
    inputVersion: INPUT_VERSION,
    policyRevision: POLICY_REVISION,
    boundSubject: copySubject(ctx.input.subject),
    observationId: ctx.input.observationId,
    ruleId: o.ruleId,
    reason: o.reason,
    policyRef: RULES[o.ruleId].policyRef,
    evidenceRefs: [...new Set(o.refs)].sort(cmp),
    diagnostics: canonicalDiagnostics([...o.diagnostics, ...ctx.notes]),
    ...o.body,
  } as LifecycleResult;
}

// ─── R01: contract validation ─────────────────────────────────────────────

type Family = 'refs' | 'diff' | 'config' | 'comments' | 'submissions' | 'ownerJournal' | 'runs' | 'ancestry' | 'receipts' | 'localGates';
const FAMILIES: readonly Family[] = ['refs', 'diff', 'config', 'comments', 'submissions', 'ownerJournal', 'runs', 'ancestry', 'receipts', 'localGates'];

/** Producers each family accepts. */
const FAMILY_PRODUCERS: Readonly<Record<Family, readonly Producer[]>> = {
  refs: ['git'],
  diff: ['git'],
  config: ['git'],
  comments: ['github-api'],
  submissions: ['greptile-mcp', 'caller-journal'],
  ownerJournal: ['caller-journal'],
  runs: ['greptile-mcp', 'github-api'],
  ancestry: ['git'],
  receipts: ['github-api', 'caller-journal'],
  localGates: ['local-checks'],
};

interface Issue { path: string; expected: string; received: string }
type Check = (value: unknown, path: string, issues: Issue[]) => void;

const MAX_EPOCH_MS = 8_640_000_000_000_000;
const SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function received(v: unknown): string {
  if (v === undefined) return 'missing';
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return `number ${String(v)}`;
  if (typeof v === 'string') return /^[A-Za-z0-9._:-]{1,32}$/.test(v) ? `string '${v}'` : 'string';
  return typeof v;
}

const fail = (issues: Issue[], path: string, expected: string, v: unknown): void => {
  issues.push({ path: path || '(observation)', expected, received: received(v) });
};
const text: Check = (v, p, i) => { if (typeof v !== 'string' || v.length === 0) fail(i, p, 'non-empty string', v); };
/** Identifiers that results echo: non-empty, no control or line-separator characters. */
const ident: Check = (v, p, i) => {
  if (typeof v !== 'string' || v.length === 0 || CONTROL_CHARACTER.test(v)) fail(i, p, 'non-empty identifier without control characters', v);
};
const REQUEST_REF_RE = /^(?:comment:[1-9]\d*|(?:run|submission):.+)$/s;
/** A recorded request or run: `comment:<id>`, `run:<id>`, or `submission:<id>`. */
const requestRef: Check = (v, p, i) => {
  if (typeof v !== 'string' || !REQUEST_REF_RE.test(v) || CONTROL_CHARACTER.test(v)) fail(i, p, "'comment:<id>' | 'run:<id>' | 'submission:<id>'", v);
};
const anyString: Check = (v, p, i) => { if (typeof v !== 'string') fail(i, p, 'string', v); };
const bool: Check = (v, p, i) => { if (typeof v !== 'boolean') fail(i, p, 'boolean', v); };
const epoch: Check = (v, p, i) => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > MAX_EPOCH_MS) fail(i, p, 'non-negative integer epoch-ms', v);
};
const nonNegInt: Check = (v, p, i) => { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) fail(i, p, 'non-negative integer', v); };
const posInt: Check = (v, p, i) => { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) fail(i, p, 'positive integer', v); };
const sha: Check = (v, p, i) => { if (typeof v !== 'string' || !SHA_RE.test(v)) fail(i, p, 'full lowercase hex SHA (40 or 64 characters)', v); };
const oneOf = (...values: readonly (string | number)[]): Check => (v, p, i) => {
  if (!values.includes(v as string | number)) fail(i, p, values.map(x => (typeof x === 'string' ? `'${x}'` : String(x))).join(' | '), v);
};
const nullable = (c: Check): Check => (v, p, i) => { if (v !== null) c(v, p, i); };
const list = (c: Check): Check => (v, p, i) => {
  if (!Array.isArray(v)) { fail(i, p, 'array', v); return; }
  for (let n = 0; n < v.length; n++) {
    if (!Object.hasOwn(v, n)) fail(i, `${p}[${n}]`, 'present array element', undefined);
    else c(v[n], `${p}[${n}]`, i);
  }
};
const nonEmptyList = (c: Check): Check => (v, p, i) => {
  if (Array.isArray(v) && v.length === 0) { fail(i, p, 'non-empty array', v); return; }
  list(c)(v, p, i);
};
const shape = (fields: Record<string, Check>): Check => (v, p, i) => {
  if (!isRecord(v)) { fail(i, p, 'object', v); return; }
  for (const [k, c] of Object.entries(fields)) c(v[k], p ? `${p}.${k}` : k, i);
};
const variant = (key: string, variants: Record<string, Record<string, Check>>): Check => (v, p, i) => {
  if (!isRecord(v)) { fail(i, p, 'object', v); return; }
  const tag = v[key];
  const fields = typeof tag === 'string' && Object.hasOwn(variants, tag) ? variants[tag] : undefined;
  if (!fields) { fail(i, `${p}.${key}`, Object.keys(variants).map(k => `'${k}'`).join(' | '), tag); return; }
  for (const [k, c] of Object.entries(fields)) c(v[k], `${p}.${k}`, i);
};
const configFile: Check = (v, p, i) => {
  if (!isRecord(v)) { fail(i, p, 'object', v); return; }
  if (v.readable === true) anyString(v.content, `${p}.content`, i);
  else if (v.readable !== false) fail(i, `${p}.readable`, 'boolean', v.readable);
};

const subjectShape = shape({
  host: text, baseRepository: text, headRepository: text, prNumber: posInt, baseBranch: text, headBranch: text,
  baseSha: sha, headSha: sha, state: oneOf('OPEN', 'CLOSED', 'MERGED'), isDraft: bool, createdAtEpochMs: epoch,
});
const ancestryShape = shape({
  ancestorSha: sha, descendantSha: sha,
  result: oneOf('ancestor', 'not-ancestor', 'missing-object', 'error'),
  history: oneOf('complete', 'shallow', 'fetch-incomplete'),
});
const tipShape = shape({
  sha, greptileJson: nullable(configFile), dotGreptileJson: nullable(configFile),
  dotGreptileDir: nullable(shape({ files: list(text), configJson: nullable(configFile) })),
});
const gateSource = variant('kind', { 'current-session': {}, receipt: { recordId: text } });
const gateRecord = shape({ status: oneOf('passed', 'failed', 'incomplete'), treeSha: sha, source: gateSource });
const runShape = shape({
  runId: ident, reporter: oneOf('greptile-mcp', 'github-review', 'github-check-run'), actorId: ident,
  origin: oneOf('automatic', 'manual', 'unknown'),
  status: oneOf('queued', 'running', 'completed', 'failed', 'cancelled', 'unknown'),
  statusRevision: nullable(nonNegInt), recordedSha: nullable(sha), reviewedSha: nullable(sha),
  completionProof: oneOf('mcp-run-metadata', 'bot-review-commit', 'check-output-confirms-review', 'none'),
  submittedAtEpochMs: nullable(epoch), firstSeenAtEpochMs: epoch, observedAtEpochMs: epoch,
});
const submissionShape = shape({
  submissionId: ident, reservationCommentId: nullable(posInt), sessionId: text, journalObservationId: nullable(text), attemptedAtEpochMs: epoch,
  outcome: oneOf('accepted', 'ambiguous', 'not-submitted'),
  notSubmittedProof: nullable(oneOf('mcp-request-history', 'run-history')), runId: nullable(ident),
});
const decisionShape = shape({
  decisionId: ident, question: oneOf('E1', 'E2', 'E4', 'E6', 'E7', 'POLICY-CHANGE', 'SKIP-ACK'), option: oneOf('a', 'b', 'c'),
  edgeKey: text, answeredAtEpochMs: epoch, waitDeadlineEpochMs: nullable(epoch), runId: nullable(ident),
  requestRef: nullable(requestRef), postedFindingsTriaged: bool, fullDiffReviewTreeSha: nullable(sha),
  requestHistoryCollectedAtEpochMs: nullable(shape({ comments: epoch, submissions: epoch, runs: epoch })),
  grant: nullable(shape({ headSha: sha, baseSha: sha, treeSha: sha, baseInclusion: ancestryShape,
    run: runShape, submission: nullable(submissionShape),
    historyCollectedAtEpochMs: nullable(shape({ comments: epoch, submissions: epoch, runs: epoch })),
    reviewedAncestry: nullable(ancestryShape), fullDiffReview: nullable(gateRecord) })),
});

const VALUE_SHAPES: Readonly<Record<Family, Check>> = {
  refs: shape({ localHeadSha: sha, remoteHeadSha: nullable(sha), baseInclusion: ancestryShape }),
  diff: shape({
    baseSha: sha, headSha: sha,
    files: list(shape({
      path: text, previousPath: nullable(text),
      status: oneOf('added', 'modified', 'deleted', 'renamed', 'copied', 'type-changed'),
      entryKind: oneOf('file', 'symlink', 'submodule'),
      contentClass: oneOf('prose', 'doc-asset', 'agent-instructions', 'code', 'configuration', 'build', 'test', 'unclassified'),
    })),
    docsPolicy: variant('kind', { documented: { path: text, readAtSha: sha }, 'not-documented': { readAtSha: sha } }),
  }),
  config: shape({
    base: tipShape, head: tipShape,
    verifiedSettings: nullable(shape({
      source: text, autoReview: list(anyString), requiredLabels: nullable(list(text)),
      exclusion: nullable(shape({ key: text, location: text })),
    })),
    app: oneOf('installed', 'not-installed', 'unknown'),
  }),
  comments: list(shape({
    commentId: posInt, kind: oneOf('reservation', 'trigger'), markerSha: sha, authorId: text,
    editorIds: nullable(list(text)), createdAtEpochMs: epoch, containsTriggerCall: bool,
  })),
  submissions: list(submissionShape),
  ownerJournal: list(shape({
    reservationCommentId: posInt, reservationCreatedAtEpochMs: epoch, sessionId: text, observationId: text,
    subjectHeadSha: sha, readbackConfirmed: bool, phase: oneOf('confirmed-unattempted', 'attempted', 'unknown'),
    attemptTransport: nullable(oneOf('mcp', 'comment')), recordedAtEpochMs: epoch,
  })),
  runs: list(runShape),
  ancestry: list(ancestryShape),
  receipts: list(shape({
    recordId: ident, location: oneOf('pr-body', 'paused-comment', 'receipt-comment', 'current-session'),
    authorId: text, editorIds: nullable(list(text)), createdAtEpochMs: epoch, prNumber: posInt, headSha: sha,
    recordedRequestRefs: list(requestRef),
    restrictions: list(shape({ restrictionId: ident, kind: oneOf('manual-testing-pending', 'greptile-postponed', 'draft-push-conflict') })),
    resolutions: list(shape({ restrictionId: ident })),
    decisions: list(decisionShape),
  })),
  localGates: shape({
    treeSha: sha, worktree: oneOf('clean', 'uncommitted-in-scope'), reviewedBaseSha: sha,
    review: gateRecord, tests: gateRecord, planCompletion: gateRecord,
    manualTesting: shape({ status: oneOf('not-required', 'passed', 'deferred-by-user', 'pending'), source: gateSource }),
    blockingHumanReviews: list(text), unresolvedDecisions: list(text), prLabels: list(text),
    labelApplication: oneOf('not-attempted', 'applied', 'failed', 'unverified'),
    findings: list(shape({ runId: text, allPagesCollected: bool, undispositioned: list(text) })),
    deltaReviews: list(shape({ fromSha: sha, treeSha: sha, source: gateSource })),
    mergeable: oneOf('MERGEABLE', 'CONFLICTING', 'UNKNOWN'),
  }),
};

const evidenceOf = (family: Family): Check => (v, p, i) => {
  if (!isRecord(v)) { fail(i, p, 'evidence object', v); return; }
  const provenance = () => shape({
    producer: oneOf(...FAMILY_PRODUCERS[family]),
    collectedAtEpochMs: epoch,
    subject: shape({ host: text, repository: text, prNumber: posInt, headSha: sha }),
  })(v.provenance, `${p}.provenance`, i);
  switch (v.state) {
    case 'known': provenance(); VALUE_SHAPES[family](v.value, `${p}.value`, i); return;
    case 'unknown': text(v.reason, `${p}.reason`, i); return;
    case 'failed': case 'incomplete': case 'stale': provenance(); text(v.reason, `${p}.reason`, i); return;
    default: fail(i, `${p}.state`, "'known' | 'unknown' | 'failed' | 'incomplete' | 'stale'", v.state);
  }
};

const observationShape = shape({
  inputVersion: oneOf(INPUT_VERSION),
  timeUnit: oneOf(TIME_UNIT),
  observationId: text,
  nowEpochMs: epoch,
  observedAtEpochMs: epoch,
  caller: shape({ accountId: text, sessionId: text, greptileActorIds: nonEmptyList(text), mcpTrigger: oneOf('available', 'unavailable') }),
  subject: subjectShape,
  ...Object.fromEntries(FAMILIES.map(f => [f, evidenceOf(f)])),
});

function validateObservation(raw: unknown): { ok: true; input: LifecycleInput } | { ok: false; issues: Issue[] } {
  const issues: Issue[] = [];
  observationShape(raw, '', issues);
  if (issues.length > 0) return { ok: false, issues };
  const input = raw as LifecycleInput;
  temporalAndIdentityIssues(input, issues);
  return issues.length > 0 ? { ok: false, issues } : { ok: true, input };
}

/**
 * Causal and identity checks. Every PR-bound time must fall between PR
 * creation and the observation; that also catches second-based or otherwise
 * mixed-unit values without an arbitrary magnitude cutoff.
 */
function temporalAndIdentityIssues(input: LifecycleInput, issues: Issue[]): void {
  const lo = input.subject.createdAtEpochMs;
  const hi = input.observedAtEpochMs;
  const window = 'epoch-ms between subject.createdAtEpochMs and observedAtEpochMs';
  const within = (v: number, path: string): void => {
    if (v < lo || v > hi) issues.push({ path, expected: window, received: `number ${v}` });
  };
  if (hi > input.nowEpochMs) issues.push({ path: 'observedAtEpochMs', expected: 'epoch-ms <= nowEpochMs', received: `number ${hi}` });
  if (input.caller.greptileActorIds.includes(input.caller.accountId)) {
    issues.push({ path: 'caller.greptileActorIds', expected: 'Greptile identities other than caller.accountId', received: 'the running account' });
  }
  const config = known(input.config);
  if (config) {
    for (const side of ['base', 'head'] as const) {
      const dir = config[side].dotGreptileDir;
      if (dir && dir.configJson === null && dir.files.includes('.greptile/config.json')) {
        issues.push({ path: `config.value.${side}.dotGreptileDir.configJson`, expected: 'contents when files lists .greptile/config.json', received: 'null' });
      }
    }
  }
  if (lo > hi) issues.push({ path: 'subject.createdAtEpochMs', expected: 'epoch-ms <= observedAtEpochMs', received: `number ${lo}` });
  for (const f of FAMILIES) {
    const e = input[f];
    if (e.state !== 'unknown') within(e.provenance.collectedAtEpochMs, `${f}.provenance.collectedAtEpochMs`);
  }
  const unique = (ids: readonly (string | number)[], path: string): void => {
    const seen = new Set<string | number>();
    for (const id of ids) {
      if (seen.has(id)) issues.push({ path, expected: 'unique ids', received: `duplicate ${String(id)}` });
      seen.add(id);
    }
  };
  const comments = known(input.comments);
  if (comments) {
    comments.forEach((c, n) => within(c.createdAtEpochMs, `comments.value[${n}].createdAtEpochMs`));
    unique(comments.map(c => c.commentId), 'comments.value[].commentId');
  }
  const subs = known(input.submissions);
  if (subs) {
    subs.forEach((s, n) => {
      within(s.attemptedAtEpochMs, `submissions.value[${n}].attemptedAtEpochMs`);
      if (s.outcome === 'not-submitted' && s.runId !== null) {
        issues.push({ path: `submissions.value[${n}].runId`, expected: 'null for a not-submitted record', received: 'a run id' });
      }
    });
    unique(subs.map(s => s.submissionId), 'submissions.value[].submissionId');
  }
  known(input.ownerJournal)?.forEach((j, n) => {
    within(j.reservationCreatedAtEpochMs, `ownerJournal.value[${n}].reservationCreatedAtEpochMs`);
    within(j.recordedAtEpochMs, `ownerJournal.value[${n}].recordedAtEpochMs`);
    if (j.reservationCreatedAtEpochMs > j.recordedAtEpochMs) {
      issues.push({ path: `ownerJournal.value[${n}].recordedAtEpochMs`, expected: 'epoch-ms >= reservationCreatedAtEpochMs', received: `number ${j.recordedAtEpochMs}` });
    }
  });
  const runTimes = (r: RunObservation, p: string, upper = hi): void => {
    within(r.firstSeenAtEpochMs, `${p}.firstSeenAtEpochMs`);
    within(r.observedAtEpochMs, `${p}.observedAtEpochMs`);
    if (r.submittedAtEpochMs !== null) within(r.submittedAtEpochMs, `${p}.submittedAtEpochMs`);
    if (r.submittedAtEpochMs !== null && r.submittedAtEpochMs > r.firstSeenAtEpochMs) {
      issues.push({ path: `${p}.submittedAtEpochMs`, expected: 'epoch-ms <= firstSeenAtEpochMs', received: `number ${r.submittedAtEpochMs}` });
    }
    if (r.firstSeenAtEpochMs > r.observedAtEpochMs) {
      issues.push({ path: `${p}.firstSeenAtEpochMs`, expected: 'epoch-ms <= the observation\'s observedAtEpochMs', received: `number ${r.firstSeenAtEpochMs}` });
    }
    if (r.observedAtEpochMs > upper) {
      issues.push({ path: `${p}.observedAtEpochMs`, expected: 'epoch-ms <= answeredAtEpochMs', received: `number ${r.observedAtEpochMs}` });
    }
  };
  known(input.runs)?.forEach((r, n) => runTimes(r, `runs.value[${n}]`));
  const receipts = known(input.receipts);
  if (receipts) {
    unique(receipts.map(r => r.recordId), 'receipts.value[].recordId');
    unique(receipts.flatMap(r => r.decisions.map(d => d.decisionId)), 'receipts.value[].decisions[].decisionId');
    receipts.forEach((r, n) => {
      within(r.createdAtEpochMs, `receipts.value[${n}].createdAtEpochMs`);
      r.decisions.forEach((d, m) => {
        const p = `receipts.value[${n}].decisions[${m}]`;
        // Step 1 answers can predate the PR; they still cannot postdate the observation.
        if (d.answeredAtEpochMs > hi) issues.push({ path: `${p}.answeredAtEpochMs`, expected: 'epoch-ms <= observedAtEpochMs', received: `number ${d.answeredAtEpochMs}` });
        if (d.answeredAtEpochMs > r.createdAtEpochMs) issues.push({ path: `${p}.answeredAtEpochMs`, expected: 'epoch-ms <= receipt current-content write time', received: `number ${d.answeredAtEpochMs}` });
        const requestCollected = d.requestHistoryCollectedAtEpochMs;
        if (requestCollected !== null) for (const f of ['comments', 'submissions', 'runs'] as const) {
          within(requestCollected[f], `${p}.requestHistoryCollectedAtEpochMs.${f}`);
          if (requestCollected[f] > d.answeredAtEpochMs) issues.push({ path: `${p}.requestHistoryCollectedAtEpochMs.${f}`, expected: 'epoch-ms <= answeredAtEpochMs', received: `number ${requestCollected[f]}` });
        }
        if (d.grant !== null) {
          runTimes(d.grant.run, `${p}.grant.run`, d.answeredAtEpochMs);
          const collected = d.grant.historyCollectedAtEpochMs;
          if (collected !== null) for (const f of ['comments', 'submissions', 'runs'] as const) {
            within(collected[f], `${p}.grant.historyCollectedAtEpochMs.${f}`);
            if (collected[f] > d.answeredAtEpochMs) issues.push({ path: `${p}.grant.historyCollectedAtEpochMs.${f}`, expected: 'epoch-ms <= answeredAtEpochMs', received: `number ${collected[f]}` });
          }
          const sub = d.grant.submission;
          if (sub !== null) {
            within(sub.attemptedAtEpochMs, `${p}.grant.submission.attemptedAtEpochMs`);
            if (sub.attemptedAtEpochMs > d.grant.run.firstSeenAtEpochMs || sub.attemptedAtEpochMs > d.answeredAtEpochMs) {
              issues.push({ path: `${p}.grant.submission.attemptedAtEpochMs`, expected: 'epoch-ms <= original firstSeenAtEpochMs and answeredAtEpochMs', received: `number ${sub.attemptedAtEpochMs}` });
            }
          }
        }
        if (d.waitDeadlineEpochMs !== null && d.waitDeadlineEpochMs <= d.answeredAtEpochMs) {
          issues.push({ path: `${p}.waitDeadlineEpochMs`, expected: 'epoch-ms after answeredAtEpochMs', received: `number ${d.waitDeadlineEpochMs}` });
        }
      });
    });
  }
}

const MAX_CONTRACT_DIAGNOSTICS = 25;

function invalidInput(raw: unknown, issues: Issue[]): InvalidInputResult {
  const subjectIssues: Issue[] = [];
  const rawSubject = isRecord(raw) ? raw.subject : undefined;
  subjectShape(rawSubject, 'subject', subjectIssues);
  const boundSubject = subjectIssues.length === 0 ? copySubject(rawSubject as Subject) : null;
  const rawId = isRecord(raw) ? raw.observationId : undefined;
  const observationId = typeof rawId === 'string' && rawId.length > 0 ? rawId : null;
  const shown = issues.slice(0, MAX_CONTRACT_DIAGNOSTICS).map(issue =>
    diag(issue.path, `expected ${issue.expected}, received ${issue.received}`, 'contract', 'repair-adapter-contract', 'R01.invalid-input'));
  if (issues.length > MAX_CONTRACT_DIAGNOSTICS) {
    shown.push(diag('(observation)', `${issues.length - MAX_CONTRACT_DIAGNOSTICS} more contract problems not listed`, 'contract', 'repair-adapter-contract', 'R01.invalid-input'));
  }
  return {
    inputVersion: INPUT_VERSION,
    policyRevision: POLICY_REVISION,
    boundSubject,
    observationId,
    ruleId: 'R01.invalid-input',
    reason: `Observation violates input contract version ${INPUT_VERSION} (${issues.length} problems); repair the adapter instead of refetching.`,
    policyRef: RULES['R01.invalid-input'].policyRef,
    evidenceRefs: [],
    diagnostics: canonicalDiagnostics(shown),
    action: 'continue',
    next: 'refresh-evidence',
  };
}

/** Known evidence must describe this subject; any family must name this PR. */
function subjectMismatches(input: LifecycleInput): Diagnostic[] {
  const s = input.subject;
  const out: Diagnostic[] = [];
  const m = (path: string, problem: string): void => {
    out.push(diag(path, problem, 'collection', 'obtain-specific-evidence', 'R01.subject-mismatch'));
  };
  for (const f of FAMILIES) {
    const e = input[f];
    if (e.state === 'unknown') continue;
    const ps = e.provenance.subject;
    if (ps.host !== s.host || ps.repository !== s.baseRepository || ps.prNumber !== s.prNumber) {
      m(`${f}.provenance.subject`, `collected for ${ps.host}/${ps.repository}#${ps.prNumber}, not ${s.host}/${s.baseRepository}#${s.prNumber}`);
    } else if (e.state === 'known' && ps.headSha !== s.headSha) {
      m(`${f}.provenance.subject.headSha`, `known evidence was collected for head ${ps.headSha}, not ${s.headSha}; mark it stale or collect it again`);
    }
  }
  const diff = known(input.diff);
  if (diff) {
    if (diff.baseSha !== s.baseSha || diff.headSha !== s.headSha) m('diff.value', `diff covers ${diff.baseSha}..${diff.headSha}, not ${s.baseSha}..${s.headSha}`);
    if (diff.docsPolicy.readAtSha !== s.baseSha) m('diff.value.docsPolicy.readAtSha', `docs-only policy was read at ${diff.docsPolicy.readAtSha}, not the base tip ${s.baseSha}`);
  }
  const config = known(input.config);
  if (config) {
    if (config.base.sha !== s.baseSha) m('config.value.base.sha', `base configuration was read at ${config.base.sha}, not ${s.baseSha}`);
    if (config.head.sha !== s.headSha) m('config.value.head.sha', `head configuration was read at ${config.head.sha}, not ${s.headSha}`);
  }
  const refs = known(input.refs);
  if (refs && (refs.baseInclusion.ancestorSha !== s.baseSha || refs.baseInclusion.descendantSha !== s.headSha)) {
    m('refs.value.baseInclusion', `base inclusion checks ${refs.baseInclusion.ancestorSha} in ${refs.baseInclusion.descendantSha}, not ${s.baseSha} in ${s.headSha}`);
  }
  // With the base integrated, every marker change between the configuration tips is a change this PR makes.
  if (refs && diff && config && classifyAncestry(refs.baseInclusion) === 'ancestor') {
    const listed = new Set(policyFileChanges(diff));
    const omitted = markerChanges(config.base, config.head).filter(path => !listed.has(path));
    if (omitted.length > 0) m('diff.value.files', `the configuration tips differ in ${omitted.length} root marker path${omitted.length === 1 ? '' : 's'} the diff does not list`);
  }
  for (const r of known(input.receipts) ?? []) {
    if (r.prNumber !== s.prNumber) m(`receipts[recordId=${r.recordId}].prNumber`, `receipt belongs to PR #${r.prNumber}, not #${s.prNumber}`);
  }
  return out;
}

// ─── Shared derivations ───────────────────────────────────────────────────

function isRunningAccount(ctx: Ctx, authorId: string, editorIds: readonly string[] | null): boolean {
  const account = ctx.input.caller.accountId;
  return authorId === account && editorIds !== null && editorIds.every(e => e === account);
}

/** Classify `<sha>` against the current head: `ancestor`, `stale` (full history says gone), or `unresolved`. */
function ancestryOf(ctx: Ctx, ancestor: Sha): { status: 'ancestor' | 'stale' | 'unresolved'; ref: string } {
  const head = ctx.input.subject.headSha;
  const ref = `ancestry:${ancestor}..${head}`;
  if (ancestor === head) return { status: 'ancestor', ref };
  if (!ctx.memo.ancestry) {
    const classes = new Map<Sha, Set<'ancestor' | 'stale'>>();
    for (const c of known(ctx.input.ancestry) ?? []) {
      if (c.descendantSha !== head) continue;
      const cls = classifyAncestry(c);
      if (cls === 'unresolved') continue;
      const group = classes.get(c.ancestorSha) ?? new Set<'ancestor' | 'stale'>();
      group.add(cls);
      classes.set(c.ancestorSha, group);
    }
    ctx.memo.ancestry = new Map([...classes].map(([sha, group]) => [sha, group.size === 1 ? [...group][0]! : 'unresolved']));
  }
  return { status: ctx.memo.ancestry.get(ancestor) ?? 'unresolved', ref };
}

function classifyAncestry(c: AncestryCheck): 'ancestor' | 'stale' | 'unresolved' {
  if (c.result === 'ancestor') return 'ancestor';
  if ((c.result === 'not-ancestor' || c.result === 'missing-object') && c.history === 'complete') return 'stale';
  return 'unresolved';
}

// Receipts, decisions, restrictions.

interface DecisionEntry {
  row: DecisionRow;
  recordId: string;
  trusted: boolean;
  ref: string;
  position: number;
  headSha: Sha;
}

interface RestrictionEntry {
  row: RestrictionRow;
  createdAt: number;
  ref: string;
}

interface Records {
  trustedIds: Set<string>;
  /** Valid-option decisions, oldest first. */
  decisions: DecisionEntry[];
  unresolved: RestrictionEntry[];
  /** Unresolved restrictions that a running-account receipt resolves, pending only that receipt's ancestry. */
  lineagePending: Map<string, string>;
  /** Each receipt's recorded head. */
  headOf: Map<string, Sha>;
  latest: Map<QuestionCode, Map<string, DecisionEntry>>;
}

/** Escape compound-reference separators without rejecting accepted UTF-16 IDs. */
function refPart(id: string): string {
  return id.replaceAll('%', '%25').replaceAll('/', '%2F');
}

function recordDistrust(ctx: Ctx, r: ReceiptRecord): string | null {
  const account = ctx.input.caller.accountId;
  if (r.authorId !== account) return 'authored by another account';
  if (r.editorIds === null) return 'edit history is unreadable';
  if (r.editorIds.some(e => e !== account)) return 'edited by another account';
  const lineage = ancestryOf(ctx, r.headSha);
  if (lineage.status === 'stale') return `recorded head ${r.headSha} is no longer in this branch`;
  if (lineage.status === 'unresolved') return `recorded head ${r.headSha} has no verified ancestry to the current head`;
  return null;
}

function records(ctx: Ctx): Records {
  if (ctx.memo.records) return ctx.memo.records;
  const list = [...(known(ctx.input.receipts) ?? [])].sort((a, b) => a.createdAtEpochMs - b.createdAtEpochMs || cmp(a.recordId, b.recordId));
  const rank = new Map(list.map((r, n) => [r.recordId, n]));
  const trustedIds = new Set<string>();
  const lineageOnly = new Set<string>();
  const decisions: DecisionEntry[] = [];
  const restrictions: RestrictionEntry[] = [];
  for (const r of list) {
    const why = recordDistrust(ctx, r);
    if (why === null) trustedIds.add(r.recordId);
    else {
      if (isRunningAccount(ctx, r.authorId, r.editorIds) && ancestryOf(ctx, r.headSha).status === 'unresolved') lineageOnly.add(r.recordId);
      if (r.decisions.length > 0 || r.resolutions.length > 0) {
        note(ctx, `receipts[recordId=${r.recordId}]`, `receipt is not usable as affirmative evidence: ${why}; its restrictions still bind`, 'R04.restriction');
      }
    }
    for (const row of r.decisions) {
      const ref = `receipt:${refPart(r.recordId)}/decision:${refPart(row.decisionId)}`;
      if (!optionSpec(row.question, row.option)) {
        note(ctx, `receipts[recordId=${r.recordId}].decisions[decisionId=${row.decisionId}].option`,
          `(${row.option}) is not an option of ${row.question}; the question remains unanswered`, 'R04.stay-draft', 'contract');
        continue;
      }
      if (row.question === 'E6' && row.option === 'a' && row.waitDeadlineEpochMs === null) {
        note(ctx, `receipts[recordId=${r.recordId}].decisions[decisionId=${row.decisionId}].waitDeadlineEpochMs`,
          'E6 (a) needs a recorded wait deadline; the question remains unanswered', 'R09.E6', 'contract');
        continue;
      }
      decisions.push({ row, recordId: r.recordId, headSha: r.headSha, trusted: why === null, ref, position: 0 });
    }
    for (const row of r.restrictions) {
      restrictions.push({ row, createdAt: r.createdAtEpochMs, ref: `receipt:${refPart(r.recordId)}/restriction:${refPart(row.restrictionId)}` });
    }
  }
  decisions.sort((a, b) => a.row.answeredAtEpochMs - b.row.answeredAtEpochMs
    || (rank.get(a.recordId) ?? 0) - (rank.get(b.recordId) ?? 0) || cmp(a.row.decisionId, b.row.decisionId));
  decisions.forEach((d, n) => { d.position = n; });
  const resolutions = new Map<string, number>();
  for (const r of list) if (trustedIds.has(r.recordId)) {
    for (const resolution of r.resolutions) {
      resolutions.set(resolution.restrictionId, Math.max(resolutions.get(resolution.restrictionId) ?? -1, r.createdAtEpochMs));
    }
  }
  const unresolved = restrictions.filter(x => (resolutions.get(x.row.restrictionId) ?? -1) <= x.createdAt);
  const earliestUnresolved = new Map<string, number>();
  for (const x of unresolved) earliestUnresolved.set(x.row.restrictionId, Math.min(earliestUnresolved.get(x.row.restrictionId) ?? Infinity, x.createdAt));
  const lineagePending = new Map<string, string>();
  for (const r of list) if (lineageOnly.has(r.recordId)) {
    for (const resolution of r.resolutions) {
      if ((earliestUnresolved.get(resolution.restrictionId) ?? Infinity) < r.createdAtEpochMs) lineagePending.set(resolution.restrictionId, r.recordId);
    }
  }
  const latest = new Map<QuestionCode, Map<string, DecisionEntry>>();
  for (const d of decisions) if (d.trusted) {
    const edges = latest.get(d.row.question) ?? new Map<string, DecisionEntry>();
    edges.set(d.row.edgeKey, d);
    latest.set(d.row.question, edges);
  }
  ctx.memo.records = { trustedIds, decisions, unresolved, lineagePending, headOf: new Map(list.map(r => [r.recordId, r.headSha])), latest };
  return ctx.memo.records;
}

/** Latest trusted answer for an edge. Restrictive (stay-draft) answers are read in R04 regardless of trust. */
function latestDecision(ctx: Ctx, question: QuestionCode, edgeKey: string): DecisionEntry | null {
  return records(ctx).latest.get(question)?.get(edgeKey) ?? null;
}

function sourceTrusted(ctx: Ctx, source: GateSource): boolean {
  return source.kind === 'current-session' || records(ctx).trustedIds.has(source.recordId);
}

// ─── Applicability (R05) and waivers ──────────────────────────────────────

/** Greptile applies, or a skip basis says why not. */
type Applicability =
  | { applicable: true; refs: string[] }
  | { applicable: false; skipBasis: GreptileBasis; refs: string[] };

type BaseApplicability = Applicability & {
  status: 'resolved';
  pendingPolicy: { key: string; paths: string[] } | null;
  pendingSkipAck: { key: string; reason: string } | null;
};

type BaseResult = BaseApplicability | { status: 'unresolved'; outcome: Outcome };

function policyKey(paths: string[]): string {
  return `POLICY|${JSON.stringify(paths)}`;
}

interface SkipAck {
  key: string;
  reason: string;
  basis: (ref: string) => GreptileBasis;
}

function skipAck(config: ConfigFacts, repo: string): SkipAck | null {
  if (config.app === 'not-installed') {
    return {
      key: 'SKIP|app-not-installed', reason: `The Greptile app is not installed on ${repo}; no review can come.`,
      basis: ref => ({ kind: 'skipped', reason: 'app-not-installed', ref, detail: null }),
    };
  }
  const ex = config.verifiedSettings?.exclusion ?? null;
  if (ex && config.verifiedSettings) {
    return {
      key: `SKIP|excluded|${ex.location}|${ex.key}`,
      reason: `Verified settings (${config.verifiedSettings.source}) exclude this PR via ${ex.key} in ${ex.location}; no review can come.`,
      basis: ref => ({ kind: 'skipped', reason: 'excluded', ref, detail: `${ex.location} ${ex.key}` }),
    };
  }
  return null;
}

/** Step 1 applicability before any waiver; memoized. */
function baseApplicability(ctx: Ctx): BaseResult {
  const cached = ctx.memo.base;
  if (cached) return cached;
  const result = computeBaseApplicability(ctx);
  ctx.memo.base = result;
  return result;
}

function computeBaseApplicability(ctx: Ctx): BaseResult {
  const { diff: diffE, config: configE } = ctx.input;
  const diff = known(diffE);
  const config = known(configE);
  if (!diff || !config) {
    const diags = [diffE.state !== 'known' ? familyDiag('diff', diffE, 'R05.applicability-unresolved') : null,
      configE.state !== 'known' ? familyDiag('config', configE, 'R05.applicability-unresolved') : null].filter((d): d is Diagnostic => d !== null);
    return {
      status: 'unresolved',
      outcome: out('R05.applicability-unresolved', cont('refresh-evidence'),
        'Greptile applicability needs the full intended diff and both tips\' configuration.', [], diags),
    };
  }
  const refs = ['evidence:diff', 'evidence:config'];
  const paths = policyFileChanges(diff);
  let skipBasis: GreptileBasis | null = null;
  let pendingPolicy: BaseApplicability['pendingPolicy'] = null;
  if (paths.length > 0) {
    const key = policyKey(paths);
    const d = latestDecision(ctx, 'POLICY-CHANGE', key);
    if (!d) pendingPolicy = { key, paths };
    else {
      refs.push(d.ref);
      if (d.row.option === 'b') skipBasis = { kind: 'skipped', reason: 'user-policy-decision', ref: d.ref, detail: null };
    }
  } else if (!hasRootMarker(config.base) && !hasRootMarker(config.head)) {
    skipBasis = { kind: 'skipped', reason: 'no-root-configuration', ref: null, detail: null };
  } else {
    const cls = classifyDiff(diff);
    if (cls === 'empty') {
      return {
        status: 'unresolved',
        outcome: out('R05.applicability-unresolved', cont('refresh-evidence'),
          'The intended diff is empty; confirm the base and head before deciding whether Greptile applies.', refs,
          [diag('diff.value.files', 'the intended base-to-head diff lists no files', 'collection', 'obtain-specific-evidence', 'R05.applicability-unresolved')]),
      };
    }
    if (cls === 'unclassified') {
      const diags = diff.files.filter(f => f.contentClass === 'unclassified').map(f =>
        diag(`diff.value.files[path=${f.path}].contentClass`, 'content is unclassified; docs-only status cannot be decided', 'collection', 'obtain-specific-evidence', 'R05.applicability-unresolved'));
      return {
        status: 'unresolved',
        outcome: out('R05.applicability-unresolved', cont('refresh-evidence'),
          'Docs-only classification is unresolved: classify every changed file from the base-tip policy or by inspection.', refs, diags),
      };
    }
    if (cls === 'docs-only') skipBasis = { kind: 'skipped', reason: 'docs-only', ref: null, detail: null };
  }
  let pendingSkipAck: BaseApplicability['pendingSkipAck'] = null;
  // "A review that cannot come" excludes a PR whose request or run already consumed the allowance.
  if (skipBasis === null && consumedBeforeSkip(ctx) === false) {
    const ack = skipAck(config, ctx.input.subject.baseRepository);
    if (ack) {
      const d = latestDecision(ctx, 'SKIP-ACK', ack.key);
      if (d?.row.option === 'a') {
        skipBasis = ack.basis(d.ref);
        refs.push(d.ref);
      } else pendingSkipAck = { key: ack.key, reason: ack.reason };
    }
  }
  const pending = { status: 'resolved' as const, pendingPolicy, pendingSkipAck, refs };
  return skipBasis === null ? { ...pending, applicable: true } : { ...pending, applicable: false, skipBasis };
}

interface Waiver {
  question: 'E1' | 'E2' | 'E6' | 'E7';
  decisionRef: string;
  missing: 'full-review' | 'triage' | null;
  runId: string | null;
}

/** A trusted E2 (a), E6 (b), or E7 (a) waiver; met obligations first. Memoized. */
function runWaiver(ctx: Ctx): Waiver | null {
  if (ctx.memo.waiver !== undefined) return ctx.memo.waiver;
  const all = records(ctx).decisions;
  const candidates: Waiver[] = [];
  for (const d of all) {
    const effect = effectOf(d.row.question, d.row.option);
    if (effect !== 'affirmative-waiver' || d.row.question === 'E1') continue;
    const where = `receipts[recordId=${d.recordId}].decisions[decisionId=${d.row.decisionId}]`;
    if (!d.trusted) {
      note(ctx, where, `${d.row.question} (${d.row.option}) waiver is not trusted (author, editors, or recorded head unverified); no Greptile bypass`, 'R07.waiver-triage');
      continue;
    }
    if (d.row.runId === null) {
      note(ctx, where, `${d.row.question} (${d.row.option}) waiver names no run; no Greptile bypass`, 'R07.waiver-triage', 'contract');
      continue;
    }
    if (!validGrant(ctx, d)) {
      note(ctx, where, 'waiver lacks a correlated original question/run/head/base witness; no Greptile bypass', 'R07.waiver-triage', 'contract');
      continue;
    }
    const latest = latestDecision(ctx, d.row.question, d.row.edgeKey);
    if (latest !== d) continue;
    const question = d.row.question as 'E2' | 'E6' | 'E7';
    const grant = d.row.grant!;
    const review = grant.fullDiffReview;
    const missing = question === 'E7' && (d.row.fullDiffReviewTreeSha !== grant.treeSha
      || !review || review.status !== 'passed' || review.treeSha !== grant.treeSha || !sourceTrusted(ctx, review.source)
      || (grant.headSha === ctx.input.subject.headSha && known(ctx.input.localGates)?.treeSha !== grant.treeSha)) ? 'full-review'
      : !d.row.postedFindingsTriaged ? 'triage' : null;
    candidates.push({ question, decisionRef: d.ref, missing, runId: d.row.runId });
  }
  candidates.sort((a, b) => Number(a.missing !== null) - Number(b.missing !== null));
  ctx.memo.waiver = candidates[0] ?? null;
  return ctx.memo.waiver;
}

/** Validate the original grant, not the later run's status or collection completeness. */
function validGrant(ctx: Ctx, d: DecisionEntry): boolean {
  const row = d.row;
  const grant: WaiverGrant | null = row.grant;
  if (!grant || grant.headSha !== d.headSha || grant.run.runId !== row.runId
    || !verifiedActors(ctx).has(grant.run.actorId)) return false;
  const inc = grant.baseInclusion;
  if (inc.ancestorSha !== grant.baseSha || inc.descendantSha !== grant.headSha || classifyAncestry(inc) !== 'ancestor') return false;
  const run = grant.run;
  const sub = grant.submission;
  if (sub !== null && (sub.runId !== run.runId || sub.outcome === 'not-submitted')) return false;
  // As in reduceRuns, the earliest known submission time anchors the run.
  const submitted = Math.min(run.submittedAtEpochMs ?? Infinity, sub?.attemptedAtEpochMs ?? Infinity);
  const anchor = submitted === Infinity ? run.firstSeenAtEpochMs : submitted;
  if (row.question === 'E2') {
    const a = grant.reviewedAncestry;
    const currentReview = run.reviewedSha === null || run.reviewedSha === grant.headSha
      || (a !== null && a.ancestorSha === run.reviewedSha && a.descendantSha === grant.headSha && classifyAncestry(a) === 'ancestor');
    return currentReview && (run.status === 'failed' || run.status === 'cancelled')
      && row.edgeKey === `E2|run=${run.runId}|status=${run.status}`;
  }
  if (row.question === 'E6') {
    const collected = grant.historyCollectedAtEpochMs;
    return (run.status === 'queued' || run.status === 'running') && collected !== null
      && Math.min(collected.comments, collected.submissions, collected.runs) - anchor >= NO_RESPONSE_MS
      && row.edgeKey === `E6|run=${run.runId}|anchor=${anchor}`;
  }
  if (row.question === 'E7') {
    const a = grant.reviewedAncestry;
    return run.status !== 'queued' && run.status !== 'running' && run.status !== 'unknown'
      && (run.status !== 'completed' || (run.completionProof === PROOF_FOR[run.reporter]
        && run.recordedSha !== null && run.reviewedSha === run.recordedSha))
      && run.reviewedSha !== null && a !== null && a.ancestorSha === run.reviewedSha
      && a.descendantSha === grant.headSha && classifyAncestry(a) === 'stale'
      && row.edgeKey === `E7|run=${run.runId}|reviewed=${run.reviewedSha}`;
  }
  return false;
}

/** An E1 edge on which (b) was offered: no request or run, and push/rebase excluded. */
const E1B_OFFERED = /^E1\|(?:will-start|cannot-rule-out)\|consumed=0\|b=1\|/;

/** The latest trusted E1 (a) or (b) answer on any edge; (c) is a restriction read in R04. */
function latestE1Choice(ctx: Ctx, option?: 'a' | 'b'): DecisionEntry | null {
  let latest: DecisionEntry | null = null;
  for (const d of records(ctx).decisions) {
    if (d.trusted && d.row.question === 'E1' && (option ? d.row.option === option : d.row.option !== 'c')) latest = d;
  }
  return latest;
}

/** A trusted E1 (b) answered where (b) was offered waives Greptile for the rest of the PR (Step 1 extension). */
function standingE1Waiver(ctx: Ctx): Waiver | null {
  let found: DecisionEntry | null = null;
  for (const d of records(ctx).decisions) {
    if (d.trusted && d.row.question === 'E1' && d.row.option === 'b' && E1B_OFFERED.test(d.row.edgeKey)) found = d;
  }
  return found ? { question: 'E1', decisionRef: found.ref, missing: null, runId: null } : null;
}

/** A proof releases only its session/observation attempt; unmatched phases stay consumed. */
function releasedReservations(ctx: Ctx): Set<number> {
  if (ctx.memo.released) return ctx.memo.released;
  const proven = new Set<number>();
  const proofs = new Map<number, Map<string, Map<string, number>>>();
  const consuming = new Set<number>();
  for (const s of known(ctx.input.submissions) ?? []) {
    if (s.reservationCommentId === null) continue;
    if (s.outcome === 'not-submitted' && s.notSubmittedProof !== null) {
      proven.add(s.reservationCommentId);
      if (s.journalObservationId !== null) {
        const sessions = proofs.get(s.reservationCommentId) ?? new Map<string, Map<string, number>>();
        const observations = sessions.get(s.sessionId) ?? new Map<string, number>();
        observations.set(s.journalObservationId, Math.max(observations.get(s.journalObservationId) ?? -1, s.attemptedAtEpochMs));
        sessions.set(s.sessionId, observations);
        proofs.set(s.reservationCommentId, sessions);
      }
    } else consuming.add(s.reservationCommentId);
  }
  for (const j of known(ctx.input.ownerJournal) ?? []) {
    const proofAt = proofs.get(j.reservationCommentId)?.get(j.sessionId)?.get(j.observationId) ?? -1;
    if (j.phase !== 'confirmed-unattempted'
      && (j.phase !== 'attempted' || j.attemptTransport !== 'mcp' || j.recordedAtEpochMs > proofAt)) consuming.add(j.reservationCommentId);
  }
  // A never-submitted MCP proof cannot undo a reservation comment that itself called the bot, nor one
  // whose readback is unverifiable because another account edited it or its history is unreadable.
  for (const c of known(ctx.input.comments) ?? []) {
    if (c.containsTriggerCall || !isRunningAccount(ctx, c.authorId, c.editorIds)) consuming.add(c.commentId);
  }
  return ctx.memo.released = new Set([...proven].filter(id => !consuming.has(id)));
}

// ─── Greptile history (R08) ───────────────────────────────────────────────

interface Run {
  runId: string;
  status: RunStatus;
  reviewedSha: Sha | null;
  proofOk: boolean;
  /** Earliest first sighting, on the caller's clock. */
  firstSeen: number;
  /** Every observation reports an automatic origin: such a run never explains a manual request. */
  automatic: boolean;
  anchor: number;
  anchorKind: 'submitted' | 'first-seen';
  anchorRefs: string[];
  ref: string;
}

interface Marker {
  commentId: number;
  kind: 'reservation' | 'trigger';
  trusted: boolean;
  confirmedTrigger: boolean;
  /** Readback contains the `@greptileai` call; a reservation that does is itself a request. */
  callsBot: boolean;
  createdAt: number;
  headSha: Sha;
  ref: string;
}

interface Own {
  state: 'unconfirmed' | 'fresh' | 'stale';
  commentId: number;
  ref: string;
}

interface Consumption {
  transport: 'comment' | 'mcp-or-ambiguous';
  requestRef: string;
  anchor: number;
  /** The latest request: each request waits its own ten minutes, and an answer covers only earlier requests. */
  latestAt: number;
  refs: string[];
}

type History =
  | { status: 'unresolved'; outcome: Outcome }
  | {
    status: 'resolved'; runs: Run[]; markers: Marker[]; own: Own | null; winner: Marker | null; consumption: Consumption | null; refs: string[];
    /** Earliest collection time of the comment, submission, and run histories: what the timers have observed. */
    observedAt: number;
  };

const PROOF_FOR: Readonly<Record<RunObservation['reporter'], RunObservation['completionProof']>> = {
  'greptile-mcp': 'mcp-run-metadata',
  'github-review': 'bot-review-commit',
  'github-check-run': 'check-output-confirms-review',
};

function deriveHistory(ctx: Ctx): History {
  if (ctx.memo.history) return ctx.memo.history;
  ctx.memo.history = computeHistory(ctx);
  return ctx.memo.history;
}

function computeHistory(ctx: Ctx): History {
  const { comments: commentsE, submissions: submissionsE, runs: runsE } = ctx.input;
  const missing = ([['comments', commentsE], ['submissions', submissionsE], ['runs', runsE]] as const).filter(([, e]) => e.state !== 'known');
  if (missing.length > 0) {
    return {
      status: 'unresolved',
      outcome: out('R08.history-unresolved', cont('refresh-evidence'),
        `Greptile request and run history is not complete (${missing.map(([f, e]) => `${f}: ${e.state}`).join(', ')}); no trigger, timer, or readiness without it.`,
        [], missing.map(([f, e]) => familyDiag(f, e, 'R08.history-unresolved'))),
    };
  }
  const reduced = reduceRuns(ctx, runsE.state === 'known' ? runsE.value : []);
  if ('outcome' in reduced) return { status: 'unresolved', outcome: reduced.outcome };
  const runs = reduced.runs;
  const s = ctx.input.subject;
  const account = ctx.input.caller.accountId;
  const comments = commentsE.state === 'known' ? commentsE.value : [];
  const submissions = [...(submissionsE.state === 'known' ? submissionsE.value : [])].sort((a, b) => cmp(a.submissionId, b.submissionId));
  const refs: string[] = runs.map(r => r.ref);
  const observedAt = Math.min(collectedAt(commentsE), collectedAt(submissionsE), collectedAt(runsE));

  const consuming = submissions.filter(x => !(x.outcome === 'not-submitted' && x.notSubmittedProof !== null));
  const recorded = new Set(recordedConsumptionRefs(ctx));
  for (const x of consuming) {
    if (x.outcome === 'not-submitted') {
      note(ctx, `submissions[submissionId=${x.submissionId}]`, 'not-submitted without request or run history proof stays an ambiguous request', 'R11.E4');
    }
  }
  const released = releasedReservations(ctx);

  const markers: Marker[] = [];
  for (const c of [...comments].sort((a, b) => a.commentId - b.commentId)) {
    const ref = `comment:${c.commentId}`;
    if (c.authorId !== account) {
      note(ctx, `comments[commentId=${c.commentId}]`, `${c.kind} marker by another account is neither a request nor an authorization; only run metadata corroborates other actors`, 'R13.trigger');
      continue;
    }
    if (c.kind === 'reservation' && released.has(c.commentId)) {
      refs.push(ref);
      continue;
    }
    const trusted = isRunningAccount(ctx, c.authorId, c.editorIds);
    if (!trusted) {
      note(ctx, `comments[commentId=${c.commentId}]`, 'marker edit history is unreadable or includes another account: it still consumes the allowance but cannot authorize a trigger or confirm a request', 'R13.trigger');
    }
    markers.push({
      commentId: c.commentId, kind: c.kind, trusted, confirmedTrigger: c.kind === 'trigger' && trusted && c.containsTriggerCall,
      callsBot: c.containsTriggerCall, createdAt: c.createdAtEpochMs, headSha: c.markerSha, ref,
    });
  }
  markers.sort((a, b) => a.createdAt - b.createdAt || a.commentId - b.commentId);

  const visible = new Set(comments.filter(c => c.authorId === account).map(c => c.commentId));
  const journal = known(ctx.input.ownerJournal) ?? [];
  const attemptedEntries = journal.filter(e => e.phase !== 'confirmed-unattempted' && !released.has(e.reservationCommentId));
  const attempted = new Set(attemptedEntries.map(e => e.reservationCommentId));
  // Only a comment attempt is explained by its trigger marker; an MCP or unknown attempt stays uncertain.
  const uncertainAttempt = new Set(attemptedEntries.filter(e => e.phase === 'unknown' || e.attemptTransport !== 'comment').map(e => e.reservationCommentId));
  const unseen = unexplainedRequests(runs, consuming, markers, attemptedEntries);
  if (unseen.length > 0) {
    return { status: 'unresolved', outcome: out('R08.history-unresolved', cont('refresh-evidence'),
      `${unseen.length} request${unseen.length === 1 ? '' : 's'} may have a run the run history does not show; refresh run history before relying on the observed runs.`,
      [...refs, ...unseen.map(x => x.ref)],
      unseen.map(x => diag(x.path, x.problem, 'collection', 'obtain-specific-evidence', 'R08.history-unresolved'))) };
  }
  const deleted = new Map<number, number>();
  for (const e of journal) {
    if ((e.readbackConfirmed || e.phase !== 'confirmed-unattempted') && !visible.has(e.reservationCommentId) && !released.has(e.reservationCommentId)) {
      const prior = deleted.get(e.reservationCommentId);
      deleted.set(e.reservationCommentId, prior === undefined ? e.reservationCreatedAtEpochMs : Math.min(prior, e.reservationCreatedAtEpochMs));
    }
  }

  const mine = journal
    .filter(e => e.sessionId === ctx.input.caller.sessionId && e.observationId === ctx.input.observationId)
    .sort((a, b) => a.recordedAtEpochMs - b.recordedAtEpochMs || a.reservationCommentId - b.reservationCommentId
      || cmp(a.phase, b.phase) || cmp(a.subjectHeadSha, b.subjectHeadSha) || a.reservationCreatedAtEpochMs - b.reservationCreatedAtEpochMs
      || Number(b.readbackConfirmed) - Number(a.readbackConfirmed));
  const entry = mine.at(-1);
  let own: Own | null = null;
  if (entry) {
    const ref = `comment:${entry.reservationCommentId}`;
    const marker = new Map(markers.map(m => [m.commentId, m])).get(entry.reservationCommentId);
    const conflictingReadback = mine.some(e => e.recordedAtEpochMs === entry.recordedAtEpochMs && e.reservationCommentId === entry.reservationCommentId
      && (e.readbackConfirmed !== entry.readbackConfirmed || e.subjectHeadSha !== entry.subjectHeadSha
        || e.reservationCreatedAtEpochMs !== entry.reservationCreatedAtEpochMs || e.phase !== entry.phase));
    if (conflictingReadback || !entry.readbackConfirmed || !marker || !marker.trusted) own = { state: 'unconfirmed', commentId: entry.reservationCommentId, ref };
    else if (marker.kind !== 'reservation' || marker.headSha !== entry.subjectHeadSha || marker.createdAt !== entry.reservationCreatedAtEpochMs
      || entry.subjectHeadSha !== s.headSha || entry.phase !== 'confirmed-unattempted' || attempted.has(entry.reservationCommentId)
      || marker.callsBot || recorded.has(marker.ref)
      || journal.some(e => e.reservationCommentId === entry.reservationCommentId
        && (e.sessionId !== entry.sessionId || e.observationId !== entry.observationId))
      || consuming.some(x => x.reservationCommentId === entry.reservationCommentId)) own = { state: 'stale', commentId: entry.reservationCommentId, ref };
    else own = { state: 'fresh', commentId: entry.reservationCommentId, ref };
  }
  const winner = markers[0] ?? null;
  const ownFreshWinner = own?.state === 'fresh' && winner?.commentId === own.commentId;

  type Req = { ref: string; at: number; kind: 'confirmed-comment' | 'reservation' | 'ambiguous' | 'mcp' };
  const requests: Req[] = [];
  const createdOf = new Map(markers.map(m => [m.commentId, m.createdAt]));
  for (const m of markers) {
    if (m.kind === 'trigger') {
      requests.push({ ref: m.ref, at: m.createdAt, kind: m.confirmedTrigger ? 'confirmed-comment' : 'ambiguous' });
    } else if (uncertainAttempt.has(m.commentId) || m.callsBot) {
      // An MCP or unknown attempt, or a reservation that itself called the bot, is an uncertain request.
      requests.push({ ref: m.ref, at: m.createdAt, kind: 'ambiguous' });
    } else if ((m === winner && !ownFreshWinner) || attempted.has(m.commentId) || recorded.has(m.ref)) {
      requests.push({ ref: m.ref, at: m.createdAt, kind: 'reservation' });
    } else if (m !== winner) {
      // A later reservation lost to the earliest marker: history, never a request of its own.
      refs.push(m.ref);
    }
  }
  for (const x of consuming) {
    const linked = x.reservationCommentId === null ? undefined : createdOf.get(x.reservationCommentId) ?? deleted.get(x.reservationCommentId);
    requests.push({ ref: `submission:${x.submissionId}`, at: linked ?? x.attemptedAtEpochMs, kind: 'mcp' });
  }
  for (const [id, at] of deleted) requests.push({ ref: `comment:${id}`, at, kind: 'ambiguous' });
  requests.sort((a, b) => a.at - b.at || (a.ref.startsWith('comment:') && b.ref.startsWith('comment:')
    ? Number(a.ref.slice(8)) - Number(b.ref.slice(8)) : cmp(a.ref, b.ref)));
  for (const request of requests) refs.push(request.ref);
  for (const ref of recorded) refs.push(ref);
  const explainedRefs = new Set([...runs.map(r => r.ref), ...requests.map(r => r.ref)]);
  const unexplained = [...recorded].filter(ref => !explainedRefs.has(ref));
  if (unexplained.length > 0) {
    return { status: 'unresolved', outcome: out('R08.history-unresolved', cont('refresh-evidence'),
      'A receipt records a consumed request or run that visible history does not explain; obtain its original history or bound never-submitted proof. Do not reserve or trigger again.',
      refs, [diag('receipts.value.recordedRequestRefs', `visible histories do not explain recorded consumption: ${unexplained.join(', ')}`, 'collection', 'obtain-specific-evidence', 'R08.history-unresolved')]) };
  }

  let consumption: Consumption | null = null;
  if (requests.length > 0) {
    const confirmed = requests.filter(r => r.kind === 'confirmed-comment');
    const uncertain = requests.filter(r => r.kind === 'mcp' || r.kind === 'ambiguous');
    const reqRefs = requests.map(r => r.ref);
    const latestAt = requests.reduce((max, r) => Math.max(max, r.at), -Infinity);
    const first = confirmed[0];
    if (first && uncertain.length === 0) {
      consumption = { transport: 'comment', requestRef: first.ref, anchor: first.at, latestAt, refs: reqRefs };
    } else {
      // The earliest request names E4: a reservation counts from its own time.
      const anchor = requests[0];
      if (anchor) consumption = { transport: 'mcp-or-ambiguous', requestRef: anchor.ref, anchor: anchor.at, latestAt, refs: reqRefs };
      if (first) note(ctx, 'comments', 'a confirmed comment trigger coexists with an MCP or ambiguous request; the uncertain request governs and E4 applies', 'R11.E4');
    }
  }
  return { status: 'resolved', runs, markers, own, winner, consumption, refs, observedAt };
}

/**
 * Beside observed runs, a request may still have a run of its own unless the history explains it: a
 * submission naming an observed run, or a request made no later than a non-automatic run was first seen
 * (the caller's clock; comment times are GitHub's).
 */
function unexplainedRequests(runs: Run[], consuming: SubmissionRecord[], markers: Marker[], attempts: readonly OwnerJournalEntry[]): { ref: string; path: string; problem: string }[] {
  if (runs.length === 0) return [];
  const observedRuns = new Set(runs.map(r => r.runId));
  const explained = (at: number): boolean => runs.some(r => !r.automatic && r.firstSeen >= at);
  const unseen: { ref: string; path: string; problem: string }[] = [];
  for (const x of consuming) {
    if (x.runId !== null ? !observedRuns.has(x.runId) : !explained(x.attemptedAtEpochMs)) {
      unseen.push({
        ref: `submission:${x.submissionId}`, path: `submissions[submissionId=${x.submissionId}]`,
        problem: x.runId !== null ? `names run ${x.runId}, which the complete run history does not show` : 'no observed non-automatic run was first seen after this attempt',
      });
    }
  }
  for (const m of markers) {
    if ((m.kind === 'trigger' || m.callsBot) && !explained(m.createdAt)) {
      unseen.push({ ref: m.ref, path: `comments[commentId=${m.commentId}]`, problem: 'no observed non-automatic run was first seen after this trigger comment' });
    }
  }
  for (const e of attempts) {
    if (!explained(e.recordedAtEpochMs)) {
      unseen.push({ ref: `comment:${e.reservationCommentId}`, path: `ownerJournal[reservationCommentId=${e.reservationCommentId}]`, problem: 'no observed non-automatic run was first seen after this journaled attempt' });
    }
  }
  return unseen;
}

function collectedAt(e: Evidence<unknown>): number {
  return e.state === 'unknown' ? -Infinity : e.provenance.collectedAtEpochMs;
}

function reduceRuns(ctx: Ctx, list: readonly RunObservation[]): { runs: Run[] } | { outcome: Outcome } {
  const actors = verifiedActors(ctx);
  const submissionsByRun = new Map<string, SubmissionRecord[]>();
  for (const sub of known(ctx.input.submissions) ?? []) {
    if (sub.runId === null || sub.outcome === 'not-submitted') continue;
    const group = submissionsByRun.get(sub.runId) ?? [];
    group.push(sub);
    submissionsByRun.set(sub.runId, group);
  }
  const groups = new Map<string, RunObservation[]>();
  const misattributed: RunObservation[] = [];
  for (const o of list) {
    if (!actors.has(o.actorId)) {
      // Greptile's own MCP reports only Greptile runs: an unlisted identity is a caller misconfiguration, never an absent run.
      if (o.reporter === 'greptile-mcp') misattributed.push(o);
      else note(ctx, `runs[runId=${o.runId}]`, `${o.reporter} observation is not from a verified Greptile identity; ignored, and it never proves completion`, 'R10.completion-unverified');
      continue;
    }
    const group = groups.get(o.runId) ?? [];
    group.push(o);
    groups.set(o.runId, group);
  }
  if (misattributed.length > 0) {
    return {
      outcome: out('R08.history-unresolved', cont('refresh-evidence'),
        'Greptile MCP reported a run under an identity missing from caller.greptileActorIds; correct the identity list. Such a run is never ignored and never proves completion.',
        misattributed.map(o => `run:${o.runId}`),
        misattributed.map(o => diag(`runs[runId=${o.runId}].actorId`, 'reported by Greptile MCP under an identity missing from caller.greptileActorIds', 'contract', 'repair-adapter-contract', 'R08.history-unresolved'))),
    };
  }
  const runs: Run[] = [];
  for (const [runId, obs] of [...groups].sort((a, b) => cmpId(a[0], b[0]))) {
    const ref = `run:${runId}`;
    const path = `runs[runId=${runId}]`;
    const distinct = <T>(values: T[]): T[] => [...new Set(values)];
    const conflicts: string[] = [];
    const statuses = distinct(obs.map(o => o.status));
    let status: RunStatus = statuses[0] ?? 'unknown';
    // Reporters lag each other: queued beside running is still one pending run.
    if (statuses.length > 1 && statuses.every(x => x === 'queued' || x === 'running')) status = 'running';
    else if (statuses.length > 1) {
      const revisions = obs.map(o => o.statusRevision);
      if (distinct(obs.map(o => o.reporter)).length === 1 && revisions.every((r): r is number => r !== null)) {
        const max = revisions.reduce((highest, revision) => Math.max(highest, revision), -1);
        const top = distinct(obs.filter(o => o.statusRevision === max).map(o => o.status));
        if (top.length === 1 && top[0]) status = top[0];
        else conflicts.push('status');
      } else conflicts.push('status');
    }
    const correlated = submissionsByRun.get(runId) ?? [];
    const anchorRefs = correlated.map(s => `submission:${s.submissionId}`).sort(cmp);
    // Clocks differ across reporters and the caller: the earliest time anchors, so no later value restarts a timer.
    const submitted = [...obs.map(o => o.submittedAtEpochMs ?? Infinity), ...correlated.map(s => s.attemptedAtEpochMs)]
      .reduce((min, at) => Math.min(min, at), Infinity);
    const firstSeen = obs.reduce((min, o) => Math.min(min, o.firstSeenAtEpochMs), Infinity);
    const recorded = distinct(obs.flatMap(o => (o.recordedSha === null ? [] : [o.recordedSha])));
    const reviewed = distinct(obs.flatMap(o => (o.reviewedSha === null ? [] : [o.reviewedSha])));
    if (submitted !== Infinity && submitted > firstSeen) conflicts.push('submittedAtEpochMs');
    if (recorded.length > 1) conflicts.push('recordedSha');
    if (reviewed.length > 1) conflicts.push('reviewedSha');
    if (conflicts.length > 0) {
      return {
        outcome: out('R08.run-contradiction', cont('refresh-evidence'),
          `Observations of run ${runId} disagree on ${conflicts.join(', ')} without an authoritative ordered revision; refresh that run's status.`,
          [ref, ...anchorRefs], conflicts.map(c => diag(`${path}.${c}`, 'observations of one run disagree; an anchor never restarts from a later observation', 'collection', 'obtain-specific-evidence', 'R08.run-contradiction'))),
      };
    }
    if (status === 'unknown') {
      return {
        outcome: out('R08.history-unresolved', cont('refresh-evidence'), `Run ${runId} has an unknown status; refresh its status before any other Greptile rule.`, [ref],
          [diag(`${path}.status`, 'run status is unknown', 'collection', 'obtain-specific-evidence', 'R08.history-unresolved')]),
      };
    }
    const recordedSha = recorded[0] ?? null;
    const reviewedSha = reviewed[0] ?? null;
    const proofOk = obs.some(o => o.status === 'completed' && o.completionProof !== 'none' && o.completionProof === PROOF_FOR[o.reporter] && o.reviewedSha !== null)
      && recordedSha !== null && reviewedSha === recordedSha;
    runs.push({
      runId, status, reviewedSha, proofOk, ref, anchorRefs, firstSeen, automatic: obs.every(o => o.origin === 'automatic'),
      anchor: submitted === Infinity ? firstSeen : submitted,
      anchorKind: submitted === Infinity ? 'first-seen' : 'submitted',
    });
  }
  runs.sort((a, b) => a.anchor - b.anchor || cmpId(a.runId, b.runId));
  if (runs.length > 1) {
    note(ctx, 'runs', `${runs.length} distinct corroborated runs on one PR violate the Greptile-once rule; all stay referenced and none is retried`, 'R10.E2');
  }
  return { runs };
}

/** Whether a request or run consumed the allowance, for the second-run safeguard. */
function consumption(ctx: Ctx, applicable: boolean): boolean | 'unknown' {
  const memo = ctx.memo.consumption ??= new Map();
  const prior = memo.get(applicable);
  if (prior !== undefined) return prior;
  const result = computeConsumption(ctx, applicable);
  memo.set(applicable, result);
  return result;
}

function computeConsumption(ctx: Ctx, applicable: boolean): boolean | 'unknown' {
  // Positive consumption survives unavailable unrelated families and every skip.
  const actors = verifiedActors(ctx);
  if ((known(ctx.input.runs) ?? []).some(r => actors.has(r.actorId) || r.reporter === 'greptile-mcp') || recordedConsumptionRefs(ctx).length > 0) return true;
  // A findings row is Greptile feedback: some request or run produced it.
  if ((known(ctx.input.localGates)?.findings.length ?? 0) > 0) return true;
  if ((known(ctx.input.submissions) ?? []).some(s => s.outcome !== 'not-submitted' || s.notSubmittedProof === null)) return true;
  const released = releasedReservations(ctx);
  if ((known(ctx.input.comments) ?? []).some(c => c.authorId === ctx.input.caller.accountId
    && (c.kind === 'trigger' || !released.has(c.commentId)))) return true;
  if ((known(ctx.input.ownerJournal) ?? []).some(j => (j.readbackConfirmed || j.phase !== 'confirmed-unattempted') && !released.has(j.reservationCommentId))) return true;
  if (records(ctx).decisions.some(d => d.row.runId !== null || d.row.requestRef !== null)) return true;
  const h = deriveHistory(ctx);
  if (h.status === 'resolved') return h.runs.length > 0 || h.markers.length > 0 || h.consumption !== null;
  if (!applicable || standingE1Waiver(ctx)) return false;
  return 'unknown';
}

/**
 * Consumption that rules out a skip acknowledgment. This observation's own fresh, unattempted reservation
 * is not a request, so it never hides the acknowledgment an uninstalled app or verified exclusion needs.
 */
function consumedBeforeSkip(ctx: Ctx): boolean | 'unknown' {
  if (ctx.memo.skipConsumed !== undefined) return ctx.memo.skipConsumed;
  const h = deriveHistory(ctx);
  const consumed = h.status !== 'resolved' ? consumption(ctx, true)
    : h.runs.length > 0 || h.consumption !== null || recordedConsumptionRefs(ctx).length > 0
      || records(ctx).decisions.some(d => d.row.runId !== null || d.row.requestRef !== null)
      || (known(ctx.input.localGates)?.findings.length ?? 0) > 0;
  return ctx.memo.skipConsumed = consumed;
}

/** Receipt references and recorded answers' runs and requests are restrictive evidence, including from untrusted records. */
function recordedConsumptionRefs(ctx: Ctx): string[] {
  if (ctx.memo.recordedRefs) return ctx.memo.recordedRefs;
  const refs = new Set<string>();
  for (const r of known(ctx.input.receipts) ?? []) {
    for (const ref of r.recordedRequestRefs) refs.add(ref);
    for (const d of r.decisions) {
      if (d.runId !== null) refs.add(`run:${d.runId}`);
      if (d.requestRef !== null) refs.add(d.requestRef);
      if (d.grant) {
        refs.add(`run:${d.grant.run.runId}`);
        if (d.grant.submission) refs.add(`submission:${d.grant.submission.submissionId}`);
      }
    }
  }
  const submissions = known(ctx.input.submissions) ?? [];
  const released = releasedReservations(ctx);
  for (const s of submissions) if (s.outcome === 'not-submitted' && s.notSubmittedProof !== null) {
    refs.delete(`submission:${s.submissionId}`);
    if (s.reservationCommentId !== null && released.has(s.reservationCommentId)) refs.delete(`comment:${s.reservationCommentId}`);
  }
  return ctx.memo.recordedRefs = [...refs].sort(cmp);
}

// ─── E1 edge (R06) ────────────────────────────────────────────────────────

interface E1Edge {
  key: string;
  detection: Detection;
  consumed: boolean;
  offersB: boolean;
}

function e1Edge(ctx: Ctx): E1Edge | null | 'unresolved' {
  if (ctx.memo.e1 !== undefined) return ctx.memo.e1;
  return ctx.memo.e1 = computeE1Edge(ctx);
}

function computeE1Edge(ctx: Ctx): E1Edge | null | 'unresolved' {
  const base = baseApplicability(ctx);
  const config = known(ctx.input.config);
  if (base.status === 'unresolved' || !config) return 'unresolved';
  const consumed = consumption(ctx, base.applicable);
  if (consumed === 'unknown') return 'unresolved';
  if (!base.applicable && !consumed) return null;
  const detection = detectReadyTrigger(config);
  if (detection.kind === 'excluded') return null;
  const offersB = !consumed && detection.pushRebaseExcluded;
  return { key: `E1|${detection.kind}|consumed=${consumed ? 1 : 0}|b=${offersB ? 1 : 0}|${detection.facts.join(';')}`, detection, consumed, offersB };
}

// ─── Edge currency for stay-draft answers (R04) ───────────────────────────

function historyEdgeKeys(ctx: Ctx, question: QuestionCode): Set<string> | 'unresolved' {
  const memo = ctx.memo.historyEdges ??= new Map();
  const prior = memo.get(question);
  if (prior !== undefined) return prior;
  const result = computeHistoryEdgeKeys(ctx, question);
  memo.set(question, result);
  return result;
}

function computeHistoryEdgeKeys(ctx: Ctx, question: QuestionCode): Set<string> | 'unresolved' {
  const h = deriveHistory(ctx);
  if (h.status !== 'resolved') return 'unresolved';
  const keys = new Set<string>();
  if (question === 'E6') for (const r of h.runs) if (r.status === 'queued' || r.status === 'running') keys.add(e6Key(r));
  if (question === 'E2') for (const r of h.runs) if (r.status === 'failed' || r.status === 'cancelled') keys.add(e2Key(r));
  if (question === 'E4' && h.runs.length === 0 && h.consumption?.transport === 'mcp-or-ambiguous') keys.add(e4Key(h.consumption));
  if (question === 'E7') {
    let unresolved = false;
    for (const r of h.runs) {
      if (r.reviewedSha === null || r.status === 'queued' || r.status === 'running') continue;
      const a = ancestryOf(ctx, r.reviewedSha);
      if (a.status === 'stale') keys.add(e7Key(r, r.reviewedSha));
      if (a.status === 'unresolved') unresolved = true;
    }
    if (unresolved) return 'unresolved';
  }
  return keys;
}

function edgeStatus(ctx: Ctx, question: QuestionCode, key: string): 'current' | 'changed' | 'unresolved' {
  if (question === 'POLICY-CHANGE') {
    const diff = known(ctx.input.diff);
    if (!diff) return 'unresolved';
    const paths = policyFileChanges(diff);
    return paths.length > 0 && policyKey(paths) === key ? 'current' : 'changed';
  }
  if (question === 'SKIP-ACK') {
    const config = known(ctx.input.config);
    if (!config) return 'unresolved';
    if (skipAck(config, ctx.input.subject.baseRepository)?.key !== key) return 'changed';
    const consumed = consumedBeforeSkip(ctx);
    return consumed === 'unknown' ? 'unresolved' : consumed ? 'changed' : 'current';
  }
  if (question === 'E1') {
    const edge = e1Edge(ctx);
    if (edge === 'unresolved') return 'unresolved';
    return edge?.key === key ? 'current' : 'changed';
  }
  const keys = historyEdgeKeys(ctx, question);
  if (keys === 'unresolved') return 'unresolved';
  return keys.has(key) ? 'current' : 'changed';
}

const e2Key = (r: Run): string => `E2|run=${r.runId}|status=${r.status}`;
const e6Key = (r: Run): string => `E6|run=${r.runId}|anchor=${r.anchor}`;
const e7Key = (r: Run, reviewed: Sha): string => `E7|run=${r.runId}|reviewed=${reviewed}`;
const e4Key = (c: Consumption): string => `E4|request=${c.requestRef}`;

// ─── Rows ─────────────────────────────────────────────────────────────────

interface Guard {
  outcome: Outcome | null;
  e1Waiver: Waiver | null;
  /** E1 (a) chosen while detection is still positive: wait before trigger and readiness. */
  pause: { file: string; edge: E1Edge; decisionRef: string } | null;
}

function evaluate(ctx: Ctx, readOnly: boolean): Outcome {
  const restricted = restrictionRow(ctx);
  if (restricted) return restricted;
  const app = applicabilityRow(ctx);
  if ('outcome' in app) return app.outcome;
  // A ready PR's transition already happened: its standing E1 (b) waiver satisfies the guard.
  // Release pushes must still not start a run: settings that now include push or rebase bring the guard back.
  const checked = secondRunGuard(ctx);
  const edge = e1Edge(ctx);
  const pushesSafe = edge === null || edge === 'unresolved' || edge.detection.pushRebaseExcluded;
  const guard: Guard = readOnly && checked.e1Waiver && pushesSafe ? { outcome: null, e1Waiver: checked.e1Waiver, pause: null } : checked;
  if (guard.outcome) return guard.outcome;
  if (!app.applicable) return readiness(ctx, app.skipBasis, guard, readOnly, basisRefs(app.skipBasis));
  const waiver = guard.e1Waiver ?? runWaiver(ctx);
  if (waiver) return waiverPath(ctx, waiver, guard, readOnly);
  const history = deriveHistory(ctx);
  if (history.status === 'unresolved') return history.outcome;
  return greptilePath(ctx, history, guard, readOnly);
}

/** R03: read-only verification of an already-ready PR. */
function readOnlyCheck(ctx: Ctx): Outcome {
  const inner = evaluate(ctx, true);
  if (inner.body.action === 'ready-eligible') {
    return out('R03.already-prepared', cont('already-prepared'),
      `Ready PR passes every current gate (Greptile: ${basisText(inner.body.greptile)}); report it prepared from verified evidence without new pushes, triggers, or ready transitions.`,
      inner.refs, inner.diagnostics);
  }
  return out('R03.incomplete-preparation', cont('incomplete-preparation'),
    `Ready PR cannot be verified as prepared: ${inner.ruleId} (${RULES[inner.ruleId].title}). It stays ready and is never converted to draft; further preparation requires a draft PR.`,
    inner.refs,
    [...inner.diagnostics, diag('subject.isDraft', `readiness gate ${inner.ruleId} is not satisfied for this ready PR`, 'gate', 'informational', inner.ruleId)]);
}

/** R04: restrictions bind even from untrusted records; only an explicit, trusted, later resolution releases them. */
function restrictionRow(ctx: Ctx): Outcome | null {
  const receiptsE = ctx.input.receipts;
  if (receiptsE.state !== 'known') {
    return out('R04.restrictions-unknown', cont('refresh-evidence'),
      'Receipts are not known, so pending manual testing or other restrictions cannot be ruled out.', [], [familyDiag('receipts', receiptsE, 'R04.restrictions-unknown')]);
  }
  const rec = records(ctx);
  const lg = known(ctx.input.localGates);
  const proofPending = rec.unresolved.filter(r => rec.lineagePending.has(r.row.restrictionId));
  if (proofPending.length > 0 && proofPending.length === rec.unresolved.length && lg?.manualTesting.status !== 'pending') {
    const recordIds = [...new Set(proofPending.map(r => rec.lineagePending.get(r.row.restrictionId)!))].sort(cmp);
    return out('R04.resolution-unverified', cont('refresh-evidence'),
      'A running-account receipt resolves the recorded restrictions, but its recorded head has no verified ancestry to the current head; check that ancestry instead of retesting.',
      [...proofPending.map(r => r.ref), ...recordIds.map(id => `receipt:${refPart(id)}`)],
      recordIds.map(id => diag(`receipts[recordId=${id}].headSha`, 'the resolving receipt\'s recorded head has no full-history ancestry result for the current head', 'collection', 'obtain-specific-evidence', 'R04.resolution-unverified')));
  }
  const manual = rec.unresolved.filter(r => r.row.kind === 'manual-testing-pending' || r.row.kind === 'greptile-postponed');
  const manualRefs = manual.map(r => r.ref);
  const diags: Diagnostic[] = [];
  if (lg) {
    const mt = lg.manualTesting;
    if (mt.status === 'pending') manualRefs.push('evidence:localGates.manualTesting');
    else if (!sourceTrusted(ctx, mt.source)) {
      manualRefs.push('evidence:localGates.manualTesting');
      diags.push(diag('localGates.value.manualTesting.source', `manual testing "${mt.status}" comes from an untrusted receipt; results must be re-confirmed`, 'gate', 'resolve-restriction', 'R04.manual-testing'));
    } else if (mt.source.kind === 'receipt' && (mt.status === 'passed' || mt.status === 'deferred-by-user')
      && rec.headOf.get(mt.source.recordId) !== ctx.input.subject.headSha) {
      // User results cover the head they were recorded for; later changes need them re-confirmed.
      manualRefs.push('evidence:localGates.manualTesting');
      diags.push(diag('localGates.value.manualTesting.source', `manual testing "${mt.status}" was recorded for an earlier head; re-confirm it for the current head`, 'gate', 'resolve-restriction', 'R04.manual-testing'));
    }
  }
  if (manualRefs.length > 0) {
    return out('R04.manual-testing', { action: 'wait', waitFor: { kind: 'restriction-resolution', restrictionRefs: [...manualRefs].sort(cmp) } },
      'Required user testing is pending: stay paused after the draft push, start no Greptile timer, and resume after /pair-review records the results.', manualRefs, diags);
  }
  const other = rec.unresolved.filter(r => r.row.kind === 'draft-push-conflict');
  if (other.length > 0) {
    const refs = other.map(r => r.ref);
    return out('R04.restriction', { action: 'wait', waitFor: { kind: 'restriction-resolution', restrictionRefs: [...refs].sort(cmp) } },
      'A draft push or PR creation would start an automatic run; that conflict holds until a later trusted receipt records its resolution.', refs);
  }
  const holding: DecisionEntry[] = [];
  rec.decisions.forEach(d => {
    if (effectOf(d.row.question, d.row.option) !== 'stay-draft') return;
    const later = latestDecision(ctx, d.row.question, d.row.edgeKey);
    const superseded = later && later.position > d.position;
    if (superseded) return;
    const status = edgeStatus(ctx, d.row.question, d.row.edgeKey);
    if (status === 'changed') {
      note(ctx, `receipts[recordId=${d.recordId}].decisions[decisionId=${d.row.decisionId}]`, `stay-draft answer to ${d.row.question} no longer matches current evidence; the edge is re-evaluated`, 'R04.stay-draft');
      return;
    }
    holding.push(d);
  });
  const first = holding[0];
  if (first) {
    const refs = holding.map(d => d.ref);
    return out('R04.stay-draft', { action: 'wait', waitFor: { kind: 'restriction-resolution', restrictionRefs: [...refs].sort(cmp) } },
      `The user chose to stay draft at ${first.row.question} (${QUESTIONS[first.row.question].title}) and that edge is unchanged; a stay-draft answer never grants a waiver. Resume only after a new explicit answer or changed evidence.`, refs);
  }
  return null;
}

type AppRow = { outcome: Outcome } | Applicability;

/** R05: applicability, policy-file decisions, and skip acknowledgments, independent of Greptile history. */
function applicabilityRow(ctx: Ctx): AppRow {
  const base = baseApplicability(ctx);
  if (base.status === 'unresolved') return { outcome: base.outcome };
  if (base.pendingPolicy) {
    const { key, paths } = base.pendingPolicy;
    return {
      outcome: ask(ctx, 'R05.policy-change', 'POLICY-CHANGE', key, ['a', 'b'],
        `This PR adds, removes, renames, or edits ${paths.join(', ')}. Greptile applies pending the user's explicit decision, which is required before readiness even if the default is kept.`,
        [...base.refs], []),
    };
  }
  if (base.pendingSkipAck && !runWaiver(ctx)) {
    return {
      outcome: ask(ctx, 'R05.skip-acknowledgment', 'SKIP-ACK', base.pendingSkipAck.key, ['a', 'b'],
        `${base.pendingSkipAck.reason} Skipping needs the user's acknowledgment; unknown settings alone never justify a skip.`, [...base.refs], []),
    };
  }
  return base.applicable ? { applicable: true, refs: base.refs } : { applicable: false, skipBasis: base.skipBasis, refs: base.refs };
}

/** R06: the ready transition must not start a second run. */
function secondRunGuard(ctx: Ctx): Guard {
  const waiver = standingE1Waiver(ctx);
  const none: Guard = { outcome: null, e1Waiver: waiver, pause: null };
  const edge = e1Edge(ctx);
  if (edge === null || edge === 'unresolved') return none;
  const config = known(ctx.input.config);
  const choice = latestE1Choice(ctx);
  // The waiver stands for the PR; the ready transition still needs (a) once (b) is no longer offered.
  if (choice?.row.option === 'b' && waiver && edge.offersB) return none;
  const paused = latestE1Choice(ctx, 'a');
  if (paused && config) return { ...none, pause: { file: remedyFile(config), edge, decisionRef: paused.ref } };
  if (choice?.row.option === 'b' && !(waiver && E1B_OFFERED.test(choice.row.edgeKey))) {
    note(ctx, `receipts[recordId=${choice.recordId}].decisions[decisionId=${choice.row.decisionId}]`, 'E1 (b) was not offered on its edge; the question is asked again', 'R06.E1');
  }
  const offered: OptionId[] = edge.offersB ? ['a', 'b', 'c'] : ['a', 'c'];
  const notes = edge.consumed
    ? ['A request or run already exists, so only (a) or (c) is offered. Readiness requires (a) whatever other exit is taken; marking the PR ready outside this workflow is the user\'s own action and starts a second run.']
    : [];
  const lead = edge.detection.kind === 'will-start'
    ? 'Greptile\'s settings will start a review when this PR is marked ready'
    : 'Cannot rule out an automatic review when this PR is marked ready';
  const remedy: ConfigRemedy | null = config
    ? { file: remedyFile(config), branch: 'base', snippet: '"autoReview": []', scope: 'every PR in the repository' }
    : null;
  return {
    ...none,
    outcome: ask(ctx, 'R06.E1', 'E1', edge.key, offered,
      `${lead}: ${edge.detection.facts.join('; ')}. A manual request plus that automatic run would be two reviews, and this PR gets one.`,
      ['evidence:config'], notes, remedy),
  };
}

/** R07: an affirmatively waived PR goes to local readiness gates without any Greptile collection, once its obligations are met. */
function waiverPath(ctx: Ctx, waiver: Waiver, guard: Guard, readOnly: boolean): Outcome {
  if (waiver.missing === 'full-review') {
    return out('R07.waiver-full-review', cont('local-review'),
      `${waiver.question} (a) waives Greptile only after /review of the full base-to-head diff (not a delta) for run ${waiver.runId ?? '(unnamed)'}; record that review, then triage and waive.`,
      [waiver.decisionRef]);
  }
  if (waiver.missing === 'triage') {
    return out('R07.waiver-triage', cont('triage'),
      `The ${waiver.question} waiver triages any findings run ${waiver.runId ?? '(unnamed)'} already posted before it is recorded; the consumed run is never reset.`,
      [waiver.decisionRef]);
  }
  const basis: GreptileBasis = { kind: 'waived', question: waiver.question, decisionRef: waiver.decisionRef };
  return readiness(ctx, basis, guard, readOnly, basisRefs(basis));
}

function basisRefs(b: GreptileBasis): string[] {
  switch (b.kind) {
    case 'completed': return b.runIds.map(id => `run:${id}`);
    case 'unverified-no-response': return [b.requestRef];
    case 'unverified-user-decision': return [b.requestRef, b.decisionRef];
    case 'skipped': return b.ref === null ? ['evidence:diff', 'evidence:config'] : [b.ref];
    case 'waived': return [b.decisionRef];
  }
}

/** The receipt wording Step 1 and Step 4 lock for each skip. */
function skipText(b: Extract<GreptileBasis, { kind: 'skipped' }>): string {
  switch (b.reason) {
    case 'no-root-configuration': return 'no root configuration';
    case 'docs-only': return 'docs-only PR';
    case 'user-policy-decision': return b.ref === null ? 'user policy decision' : `user policy decision ${b.ref}`;
    case 'app-not-installed': return 'app not installed';
    case 'excluded': return `excluded by ${b.detail}`;
  }
}

function basisText(b: GreptileBasis): string {
  switch (b.kind) {
    case 'completed': return `completed run ${b.runIds.join(', ')} on ${b.reviewedShas.join(', ')}`;
    case 'unverified-no-response': return `unverified — no response after 10 minutes (${b.requestRef})`;
    case 'unverified-user-decision': return `unverified — no response after 10 minutes (MCP request with no observable run; user decision ${b.decisionRef})`;
    case 'skipped': return `skipped — ${skipText(b)}`;
    case 'waived': return `skipped — user policy decision ${b.decisionRef} (${b.question})`;
  }
}

/** R09–R13 for an applicable PR without a skip or waiver. */
function greptilePath(ctx: Ctx, h: Extract<History, { status: 'resolved' }>, guard: Guard, readOnly: boolean): Outcome {
  // Timers count only evidence collected after their threshold, never decision time alone.
  const seen = h.observedAt;
  const reobserve = (until: number): string => (ctx.input.nowEpochMs >= until
    ? ` The histories were collected at ${iso(seen)}, before that time; observe them again.` : '');
  const s = ctx.input.subject;
  const runRefs = h.runs.flatMap(r => [r.ref, ...r.anchorRefs]);
  const e1Note = guard.pause && guard.pause.edge.consumed
    ? ['Readiness also requires E1 option (a): the configuration change must land at both tips.']
    : [];

  // R09: any pending run is monitored before completed or failed records.
  const pending = h.runs.filter(r => r.status === 'queued' || r.status === 'running');
  const run = pending[0];
  if (run) {
    const key = e6Key(run);
    const chosen = latestDecision(ctx, 'E6', key);
    const deadline = chosen?.row.option === 'a' ? chosen.row.waitDeadlineEpochMs : null;
    if (chosen && deadline !== null && seen < deadline) {
      return out('R09.chosen-wait', { action: 'wait', waitFor: { kind: 'run-progress', runId: run.runId, anchorEpochMs: chosen.row.answeredAtEpochMs, anchor: 'user-wait', untilEpochMs: deadline } },
        `The user chose to keep waiting on run ${run.runId} until ${iso(deadline)}; ask again only after that.${reobserve(deadline)}`, [...runRefs, chosen.ref]);
    }
    const elapsed = seen - run.anchor;
    if (!chosen && elapsed < NO_RESPONSE_MS) {
      const until = run.anchor + NO_RESPONSE_MS;
      return out('R09.monitor-run', { action: 'wait', waitFor: { kind: 'run-progress', runId: run.runId, anchorEpochMs: run.anchor, anchor: run.anchorKind, untilEpochMs: until } },
        `Run ${run.runId} is ${run.status}; keep monitoring that same run until ${iso(until)} (ten minutes after its ${run.anchorKind === 'submitted' ? 'trigger' : 'first sighting'}). Never retry.${reobserve(until)}`,
        runRefs);
    }
    return ask(ctx, 'R09.E6', 'E6', key, ['a', 'b', 'c'],
      `Run ${run.runId} is still ${run.status} ${elapsed} ms after its ${run.anchorKind === 'submitted' ? 'trigger' : 'first sighting'} at ${iso(run.anchor)}${deadline !== null ? '; the chosen wait has expired' : ''}.`,
      chosen ? [...runRefs, chosen.ref] : runRefs, ['The run is never retried and the allowance is not reset.', ...e1Note]);
  }

  // R10: terminal runs.
  if (h.runs.length > 0) {
    const unverified = h.runs.filter(r => r.status === 'completed' && !r.proofOk);
    if (unverified.length > 0) {
      return out('R10.completion-unverified', cont('refresh-evidence'),
        `Completion of ${unverified.map(r => r.runId).join(', ')} is not correlated: it needs verified Greptile identity, matching completion proof, and a reviewed SHA equal to the run's recorded SHA. A marker, timestamp, empty comments, or unrelated success check is not completion.`,
        runRefs, unverified.map(r => diag(`runs[runId=${r.runId}]`, 'completed status lacks correlated completion evidence', 'collection', 'obtain-specific-evidence', 'R10.completion-unverified')));
    }
    const shaRuns = h.runs.filter((r): r is Run & { reviewedSha: Sha } => r.reviewedSha !== null);
    const lineage = shaRuns.map(r => ({ run: r, a: ancestryOf(ctx, r.reviewedSha) }));
    const unresolved = lineage.filter(x => x.a.status === 'unresolved');
    if (unresolved.length > 0) {
      return out('R10.ancestry-unresolved', cont('refresh-evidence'),
        `Ancestry of reviewed ${unresolved.map(x => x.run.reviewedSha).join(', ')} in head ${s.headSha} is unresolved; deepen or unshallow history and re-check. Shallow or failed checks never prove a stale review.`,
        [...runRefs, ...unresolved.map(x => x.a.ref)],
        unresolved.map(x => diag(`ancestry[${x.run.reviewedSha}..${s.headSha}]`, 'no full-history ancestry result for this reviewed SHA', 'collection', 'obtain-specific-evidence', 'R10.ancestry-unresolved')));
    }
    const staleRun = lineage.find(x => x.a.status === 'stale');
    if (staleRun) {
      return ask(ctx, 'R10.E7', 'E7', e7Key(staleRun.run, staleRun.run.reviewedSha), ['a', 'b'],
        `Run ${staleRun.run.runId} reviewed ${staleRun.run.reviewedSha}, which full fetched history shows is not in head ${s.headSha}. It consumed the allowance but does not satisfy the gate.`,
        [...runRefs, ...lineage.filter(x => x.a.status === 'stale').map(x => x.a.ref)], e1Note);
    }
    const failed = h.runs.find(r => r.status === 'failed' || r.status === 'cancelled');
    if (failed) {
      return ask(ctx, 'R10.E2', 'E2', e2Key(failed), ['a', 'b'],
        `Run ${failed.runId} is ${failed.status}; failed or cancelled runs consume the allowance and are never retried.`, runRefs,
        ['A completed run elsewhere on this PR does not erase this failure.', ...e1Note]);
    }
    const lg = known(ctx.input.localGates);
    if (lg) {
      // Every run needs a clean findings row, and no row (run or runless feedback) may stay open.
      const clean = findingsByRun(lg);
      const untriaged = new Set(h.runs.filter(r => clean.get(r.runId) !== true).map(r => r.runId));
      for (const [runId, ok] of clean) if (!ok) untriaged.add(runId);
      if (untriaged.size > 0) {
        return out('R10.triage', cont('triage'),
          `Findings from ${[...untriaged].sort(cmpId).join(', ')} are not fully collected and dispositioned; triage every page before readiness.`,
          [...runRefs, 'evidence:localGates.findings']);
      }
      const deltas = new Set(lg.deltaReviews.filter(d => d.treeSha === lg.treeSha && sourceTrusted(ctx, d.source)).map(d => d.fromSha));
      const uncovered = h.runs.filter(r => r.reviewedSha !== null && r.reviewedSha !== s.headSha && !deltas.has(r.reviewedSha));
      if (uncovered.length > 0) {
        return out('R10.delta-review', cont('local-review'),
          `Changes after reviewed ${uncovered.map(r => r.reviewedSha).join(', ')} need local review covering each delta to tree ${lg.treeSha}; the run is never relabeled as a review of the final head.`,
          [...runRefs, 'evidence:localGates.deltaReviews']);
      }
    }
    const basis: GreptileBasis = { kind: 'completed', runIds: h.runs.map(r => r.runId), reviewedShas: [...new Set(h.runs.map(r => r.reviewedSha ?? ''))] };
    return readiness(ctx, basis, guard, readOnly, runRefs);
  }

  // R13 in-progress arbitration yields before R11 within the observation that posted the reservation.
  const own = h.own;
  if (own?.state === 'unconfirmed') {
    return out('R13.reservation-unconfirmed', cont('refresh-evidence'),
      `This session's reservation ${own.ref} is not confirmed by a trusted readback in this observation; do not trigger. Re-read the markers.`,
      [own.ref], [diag('ownerJournal', 'reservation readback is unconfirmed or the marker is not visible and trusted', 'collection', 'obtain-specific-evidence', 'R13.reservation-unconfirmed')]);
  }
  // Once the winner's request is ten minutes old, R11 times it out for every session.
  if (own?.state === 'fresh' && h.winner && h.winner.commentId !== own.commentId && seen - h.winner.createdAt < NO_RESPONSE_MS) {
    const w = h.winner;
    return out('R13.reservation-lost', { action: 'wait', waitFor: { kind: 'reservation-winner', winnerRef: w.ref, ownRef: own.ref, anchorEpochMs: w.createdAt, untilEpochMs: w.createdAt + NO_RESPONSE_MS } },
      `Another session holds the earliest marker ${w.ref} for ${subjectLabel(s)}; this reservation ${own.ref} lost, stays as history, and must not trigger. Monitor the winner.`,
      [w.ref, own.ref]);
  }

  // R11: consumed request without an observable run.
  const c = h.consumption;
  if (c) {
    // Each request waits its own ten minutes, so the latest one governs.
    const elapsed = seen - c.latestAt;
    if (elapsed < NO_RESPONSE_MS) {
      const until = c.latestAt + NO_RESPONSE_MS;
      const later = c.latestAt > c.anchor ? `; the latest request was at ${iso(c.latestAt)}` : '';
      return out('R11.monitor-request', { action: 'wait', waitFor: { kind: 'request-response', requestRef: c.requestRef, transport: c.transport, anchorEpochMs: c.anchor, untilEpochMs: until } },
        `Request ${c.requestRef} consumed the allowance at ${iso(c.anchor)}${later} and has no observable run yet; keep monitoring until ${iso(until)}. Never send another trigger.${reobserve(until)}`,
        c.refs);
    }
    const key = e4Key(c);
    const recordedE4 = latestDecision(ctx, 'E4', key);
    // Preserve the original collection clock: a later answer is not proof that
    // the question was eligible on the snapshot which offered it.
    const original = recordedE4?.row.requestHistoryCollectedAtEpochMs;
    const d = recordedE4 && recordedE4.row.answeredAtEpochMs - c.latestAt >= NO_RESPONSE_MS
      && original && Math.min(original.comments, original.submissions, original.runs) - c.latestAt >= NO_RESPONSE_MS
      ? recordedE4 : null;
    if (recordedE4 && !d) {
      note(ctx, `receipts[recordId=${recordedE4.recordId}].decisions[decisionId=${recordedE4.row.decisionId}]`, 'the recorded E4 answer lacks original complete-history collection proof at the ten-minute exit for every covered request, or predates that exit; the question is asked again', 'R11.E4');
    }
    const permitted = c.transport === 'comment' || (d?.row.option === 'a' && d.row.requestRef === c.requestRef);
    const lg = known(ctx.input.localGates);
    const open = lg ? [...findingsByRun(lg)].filter(([, ok]) => !ok).map(([runId]) => runId).sort(cmpId) : [];
    if (permitted && open.length > 0) {
      return out('R11.triage', cont('triage'),
        `Greptile feedback ${open.join(', ')} is not fully collected and dispositioned; feedback that arrives before readiness is still triaged.`,
        [...c.refs, 'evidence:localGates.findings']);
    }
    if (c.transport === 'comment') {
      return readiness(ctx, { kind: 'unverified-no-response', requestRef: c.requestRef, anchorEpochMs: c.anchor }, guard, readOnly, c.refs);
    }
    if (d?.row.option === 'a' && d.row.requestRef === c.requestRef) {
      return readiness(ctx, { kind: 'unverified-user-decision', requestRef: c.requestRef, decisionRef: d.ref }, guard, readOnly, [...c.refs, d.ref]);
    }
    return ask(ctx, 'R11.E4', 'E4', key, ['a', 'b'],
      `Request ${c.requestRef} (MCP accepted, ambiguous, or reservation without a confirmed trigger) has no observable run ${elapsed} ms after ${iso(c.latestAt)}; it consumed the allowance.`,
      c.refs, ['Only request or run history showing nothing was submitted permits the first request; the user\'s confirmation does not release the reservation.', ...e1Note]);
  }

  // Greptile feedback with no visible request or run means history is missing; never trigger beside it.
  const feedback = known(ctx.input.localGates)?.findings ?? [];
  if (feedback.length > 0) {
    return out('R08.history-unresolved', cont('refresh-evidence'),
      'Greptile feedback is recorded, but no request or run is visible; refresh the request and run history. Never trigger while feedback exists.',
      ['evidence:localGates.findings', 'evidence:comments', 'evidence:runs', 'evidence:submissions'],
      [diag('localGates.value.findings', `${feedback.length} findings row${feedback.length === 1 ? '' : 's'} without a visible Greptile request or run`, 'collection', 'obtain-specific-evidence', 'R08.history-unresolved')]);
  }

  // R12: prerequisites before a reservation or trigger.
  const gate = gateFailure(ctx, 'pre-trigger');
  if (gate) return gate;
  if (guard.pause) return configPause(guard.pause, 'the first trigger');

  // R13: record or trigger.
  const config = known(ctx.input.config);
  if (own?.state === 'fresh') {
    const labels = config ? requiredLabels(config) : null;
    const transport = ctx.input.caller.mcpTrigger === 'available' ? 'mcp' : 'comment';
    return out('R13.trigger', {
      action: 'trigger', transport, reservationRef: own.ref, requestedHeadSha: s.headSha,
      validFor: { observationId: ctx.input.observationId, sessionId: ctx.input.caller.sessionId },
      consumesAllowance: true,
      configuration: config?.verifiedSettings ? 'verified-settings' : 'declared-intent-only',
      requiredLabels: labels?.kind === 'labels' ? labels.labels : [],
    }, `This session holds the earliest marker ${own.ref} with fresh confirmed-unattempted proof and every pre-trigger gate holds; send the PR's single request via ${transport} for head ${s.headSha}. Revalidate this observation immediately before the effect.`,
    [own.ref, 'evidence:refs', 'evidence:localGates', 'evidence:config']);
  }
  return out('R13.record-reservation', cont('record-reservation'),
    `No request, run, or marker exists and every pre-trigger gate holds; post the reservation comment for head ${s.headSha}, read it back, and journal confirmed-unattempted ownership before any trigger.`,
    ['evidence:comments', 'evidence:runs', 'evidence:submissions']);
}

/** Per findings row id: whether every row for it is fully collected and dispositioned. */
function findingsByRun(lg: LocalGates): Map<string, boolean> {
  // Conflicting rows retain all blockers rather than letting array order pick a winner.
  const clean = new Map<string, boolean>();
  for (const f of lg.findings) clean.set(f.runId, (clean.get(f.runId) ?? true) && f.allPagesCollected && f.undispositioned.length === 0);
  return clean;
}

function configPause(pause: NonNullable<Guard['pause']>, before: string): Outcome {
  return out('R06.config-pause', { action: 'wait', waitFor: { kind: 'configuration-change', file: pause.file } },
    `E1 (a) was chosen and detection is still positive (${pause.edge.detection.facts.join('; ')}); wait for "autoReview": [] to land in ${pause.file} at both tips before ${before}.`,
    [pause.decisionRef, 'evidence:config']);
}

/** R14: local readiness gates, the E1 pause, then eligibility. */
function readiness(ctx: Ctx, basis: GreptileBasis, guard: Guard, readOnly: boolean, refs: string[]): Outcome {
  const gate = gateFailure(ctx, 'readiness');
  if (gate) return { ...gate, refs: [...gate.refs, ...refs] };
  if (guard.pause) return configPause(guard.pause, 'marking ready');
  return out('R14.ready-eligible', {
    action: 'ready-eligible',
    greptile: basis,
    satisfiedGates: [
      'no-restrictions', 'applicability', 'second-run-guard', 'greptile-basis', 'heads-match', 'base-included',
      'worktree-clean', 'review', 'tests', 'plan-completion', 'manual-testing', 'no-blocking-human-review', 'mergeable', 'no-open-decisions',
    ],
    authority: 'recommendation-only',
  }, `Every readiness gate holds for head ${ctx.input.subject.headSha}; Greptile: ${basisText(basis)}. Eligible for this snapshot only; recheck immediately before the ready transition.`,
  [...refs, 'evidence:localGates', 'evidence:refs']);
}

// ─── R12 / R14 local gates ────────────────────────────────────────────────

/** Gates both phases check; labels are pre-trigger only, mergeability and open decisions readiness only. */
type SharedGate = 'refs-unresolved' | 'reconcile-head' | 'integrate-base' | 'worktree' | 'local-review' | 'human-feedback';

const GATE_RULES: Readonly<Record<'pre-trigger' | 'readiness', Readonly<Record<SharedGate, RuleId>>>> = {
  'pre-trigger': {
    'refs-unresolved': 'R12.refs-unresolved',
    'reconcile-head': 'R12.reconcile-head',
    'integrate-base': 'R12.integrate-base',
    worktree: 'R12.worktree',
    'local-review': 'R12.local-review',
    'human-feedback': 'R12.human-feedback',
  },
  readiness: {
    'refs-unresolved': 'R14.refs-unresolved',
    'reconcile-head': 'R14.reconcile-head',
    'integrate-base': 'R14.integrate-base',
    worktree: 'R14.worktree',
    'local-review': 'R14.local-review',
    'human-feedback': 'R14.human-feedback',
  },
};

function gateFailure(ctx: Ctx, phase: 'pre-trigger' | 'readiness'): Outcome | null {
  const fail = (ruleId: RuleId, reason: string, refs: string[], diags: (Diagnostic | Omit<Diagnostic, 'policyRef'>)[] = []): Outcome =>
    out(ruleId, cont(RULES[ruleId].next ?? 'refresh-evidence'), reason, refs, diags.map(d => ({ ...d, policyRef: RULES[ruleId].policyRef })));
  const failGate = (gate: SharedGate, reason: string, refs: string[], diags: (Diagnostic | Omit<Diagnostic, 'policyRef'>)[] = []): Outcome =>
    fail(GATE_RULES[phase][gate], reason, refs, diags);
  const s = ctx.input.subject;
  const refsE = ctx.input.refs;
  const lgE = ctx.input.localGates;
  const refs = known(refsE);
  const lg = known(lgE);
  if (!refs || !lg) {
    const diags = [refs ? null : familyDiag('refs', refsE, 'R12.refs-unresolved'), lg ? null : familyDiag('localGates', lgE, 'R12.refs-unresolved')]
      .filter((d): d is Diagnostic => d !== null);
    return failGate('refs-unresolved', 'Head, base, and local gate evidence must be known before this step.', [], diags);
  }
  const inc = refs.baseInclusion;
  const base = classifyAncestry(inc);
  if (base === 'unresolved') {
    return failGate('refs-unresolved', `Inclusion of base ${s.baseSha} in head ${s.headSha} is unresolved (${inc.result}, ${inc.history} history); fetch full history and re-check.`,
      ['evidence:refs'], [{ path: 'refs.value.baseInclusion', problem: 'base inclusion is not proven either way', cause: 'collection', remediation: 'obtain-specific-evidence' }]);
  }
  if (refs.localHeadSha !== s.headSha || refs.remoteHeadSha !== s.headSha) {
    return failGate('reconcile-head', `Local HEAD ${refs.localHeadSha}, remote ${refs.remoteHeadSha ?? '(absent)'}, and PR head ${s.headSha} must be one pushed SHA.`,
      ['evidence:refs'], [{ path: 'refs.value', problem: 'local, remote, and PR heads differ', cause: 'gate', remediation: 'complete-prerequisite' }]);
  }
  if (base === 'stale') {
    return failGate('integrate-base', `Base tip ${s.baseSha} is not in head ${s.headSha}; merge it, then review and test the integrated tree.`, ['evidence:refs']);
  }
  if (phase === 'readiness' && lg.mergeable === 'CONFLICTING') {
    return failGate('integrate-base', 'GitHub reports a merge conflict with the base; integrate the base before readiness.', ['evidence:localGates']);
  }
  if (lg.worktree !== 'clean') {
    return failGate('worktree', 'In-scope work is uncommitted or unpushed; commit and push it while draft.', ['evidence:localGates'],
      [{ path: 'localGates.value.worktree', problem: 'uncommitted in-scope work', cause: 'gate', remediation: 'complete-prerequisite' }]);
  }
  const stale = localReviewProblems(ctx, lg);
  if (stale.length > 0) {
    return failGate('local-review', `Local verification is not current for tree ${lg.treeSha} on base ${s.baseSha}: ${stale.map(x => x.problem).join('; ')}.`, ['evidence:localGates'], stale);
  }
  if (lg.blockingHumanReviews.length > 0) {
    return failGate('human-feedback', `Blocking human review ${[...lg.blockingHumanReviews].sort(cmp).join(', ')} is unresolved.`,
      lg.blockingHumanReviews.map(id => `review:${id}`));
  }
  if (phase === 'pre-trigger') {
    const config = known(ctx.input.config);
    const labels = config ? requiredLabels(config) : { kind: 'unverified' as const, source: 'config' };
    if (labels.kind === 'unverified') {
      return fail('R12.labels-unverified', `Required labels cannot be read from ${labels.source}; report the blocker rather than falling back to another transport.`, ['evidence:config'],
        [{ path: 'config.value', problem: `label requirement in ${labels.source} is unreadable or not valid label names`, cause: 'gate', remediation: 'complete-prerequisite' }]);
    }
    // GitHub label names are case-insensitive. Label values stay out of reason text; requiredLabels() reads them.
    const present = new Set(lg.prLabels.map(l => l.toLowerCase()));
    const missing = labels.labels.filter(l => !present.has(l.toLowerCase())).length;
    const count = `${missing} required label${missing === 1 ? '' : 's'}`;
    if (missing > 0) {
      if (lg.labelApplication === 'failed' || lg.labelApplication === 'unverified') {
        return fail('R12.labels-unverified', `Applying ${count} from ${labels.source} ${lg.labelApplication === 'failed' ? 'failed' : 'is unverified'}; report the blocker and do not fall back to the comment trigger.`,
          ['evidence:localGates', 'evidence:config']);
      }
      return fail('R12.apply-labels', `${labels.source} names ${count} missing from the PR; apply ${missing === 1 ? 'it' : 'them'} before the first trigger.`, ['evidence:config', 'evidence:localGates']);
    }
  } else {
    if (lg.mergeable === 'UNKNOWN') {
      return fail('R14.mergeable-unknown', 'GitHub mergeability is UNKNOWN at the polling bound; refresh before readiness.', ['evidence:localGates'],
        [{ path: 'localGates.value.mergeable', problem: 'mergeability is unknown', cause: 'collection', remediation: 'obtain-specific-evidence' }]);
    }
    if (lg.unresolvedDecisions.length > 0) {
      return fail('R14.unresolved-decisions', `Required decisions remain open: ${[...lg.unresolvedDecisions].sort(cmp).join(', ')}.`, ['evidence:localGates']);
    }
  }
  return null;
}

function localReviewProblems(ctx: Ctx, lg: LocalGates): Omit<Diagnostic, 'policyRef'>[] {
  const problems: Omit<Diagnostic, 'policyRef'>[] = [];
  const gates = [['review', lg.review], ['tests', lg.tests], ['planCompletion', lg.planCompletion]] as const;
  for (const [name, g] of gates) {
    const path = `localGates.value.${name}`;
    if (g.status !== 'passed') problems.push({ path, problem: `${name} is ${g.status}`, cause: 'gate', remediation: 'complete-prerequisite' });
    else if (g.treeSha !== lg.treeSha) problems.push({ path, problem: `${name} covers tree ${g.treeSha}, not ${lg.treeSha}`, cause: 'gate', remediation: 'complete-prerequisite' });
    else if (!sourceTrusted(ctx, g.source)) problems.push({ path, problem: `${name} comes from an untrusted receipt`, cause: 'gate', remediation: 'complete-prerequisite' });
  }
  if (lg.reviewedBaseSha !== ctx.input.subject.baseSha) {
    problems.push({ path: 'localGates.value.reviewedBaseSha', problem: `local verification ran against base ${lg.reviewedBaseSha}, not ${ctx.input.subject.baseSha}`, cause: 'gate', remediation: 'complete-prerequisite' });
  }
  return problems;
}

// ─── Asks ─────────────────────────────────────────────────────────────────

function ask(ctx: Ctx, ruleId: RuleId, code: QuestionCode, edgeKey: string, offered: OptionId[], reason: string, refs: string[], notes: string[], remedy: ConfigRemedy | null = null): Outcome {
  const spec = QUESTIONS[code];
  const options: AskOption[] = spec.options.filter(o => offered.includes(o.id)).map(o => ({ ...o }));
  const recommended = options.find(o => o.recommended) ?? options[0];
  const s = ctx.input.subject;
  return out(ruleId, {
    action: 'ask', policyCode: code, title: spec.title, edgeKey, options,
    recommendedOptionId: recommended?.id ?? 'a',
    notes: [`Repository ${s.baseRepository}, PR #${s.prNumber}, head ${s.headSha}.`, ...notes, ASKED_ONCE_LINE],
    remedy,
  }, reason, refs);
}
