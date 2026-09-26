import { basename } from 'node:path';
import { isTestPath } from './api.ts';
import { sha256Canonical } from './canon.ts';
import { globMatcher } from './glob.ts';
import {
  API_CAPABLE_EXTENSIONS,
  GATE_VERSION,
  LOCKFILES,
  OUTPUT_CAPS,
  PR_SIGNAL_TABLE,
  REASON_REGISTRY,
  TEST_DEP_SEGMENTS,
  VERDICT_V,
  type Policy,
  type ReasonClass,
  type ReasonCode,
} from './registry.ts';
import type { DepEntry } from './deps.ts';
import type { FileFact } from './diff.ts';

export type ManifestFact = {
  path: string;
  path_b64?: string;
  added: DepEntry[];
  removed: DepEntry[];
  unverifiable: boolean;
  unverifiable_detail?: string;
};

export type ApiFact = {
  path: string;
  path_b64?: string;
  added: { rule: string; name: string }[];
  removed: { rule: string; name: string }[];
};

export type Evidence = {
  v: number;
  observed_at: string;
  collection_started_at: string;
  clock_overridden: boolean;
  test_overrides: string[];
  collector_version: number;
  gstack_extend_version: string;
  git_version: string;
  partial_clone: boolean;
  attr_source: string;
  rename_limit: number;
  rename_detection_skipped: boolean;
  decision_id: string | null;
  repo: { origin: string | null };
  git: {
    base_sha: string;
    head_sha: string;
    merge_base_sha: string;
    files: FileFact[];
  };
  dependencies: { manifests: ManifestFact[] };
  public_api: { files: ApiFact[] };
  collection: {
    complete: boolean;
    failures: { stage: string; code: string; subjects: string[] }[];
  };
  pr: null | {
    number: number;
    url: string;
    repo: { host: string; owner: string; name: string };
    raw: Record<string, unknown>;
    raw_first: Record<string, unknown> | null;
    retry_wait_ms: number | null;
  };
};

export type Reason = {
  code: ReasonCode;
  class: ReasonClass;
  blocking: boolean;
  detail: string;
  measured?: number;
  limit?: number | null;
  subjects?: string[];
  subjects_count?: number;
};

export type Verdict = {
  v: number;
  mode: 'shadow';
  gate_version: number;
  gstack_extend_version: string;
  evidence_collector_version: number;
  policy: Policy;
  policy_sha256: string;
  evidence_id: string;
  subject: {
    origin: string | null;
    pr_number: number | null;
    pr_url: string | null;
    base_sha: string;
    head_sha: string;
    merge_base_sha: string;
    decision_id: string | null;
  };
  decided_at: string;
  observed_at: string;
  replay: boolean;
  timing: 'open' | 'retroactive' | 'unanchored';
  metrics: Metrics;
  would_merge: boolean;
  within_budget: boolean;
  ready: boolean | null;
  evidence_complete: boolean;
  reasons: Reason[];
};

export type Metrics = {
  net_lines: number;
  churn: number;
  new_files: number;
  new_deps: number;
  new_public_api: number;
  top_churn_files: { path: string; churn: number }[];
  excluded: { path: string; reason: string }[];
  excluded_count: number;
  coverage: { new_public_api: 'complete' | 'partial' };
  unmeasured_api_files: { path: string; reason: string }[];
  unmeasured_api_count: number;
};

type Excluded = (path: string) => boolean;

const REASON_META = new Map(REASON_REGISTRY.map(r => [r.code, r]));

export function normalizePolicy(policy: Policy): Policy {
  return {
    max_net_lines: policy.max_net_lines,
    max_new_files: policy.max_new_files,
    max_new_deps: policy.max_new_deps,
    max_new_public_api: policy.max_new_public_api,
    max_churn: policy.max_churn,
    exclude: [...policy.exclude].sort(),
  };
}

export function decide(
  evidence: Evidence,
  policyIn: Policy,
  now: Date,
  opts: { evidenceId: string; replay: boolean; gstackVersion: string },
): Verdict {
  const policy = normalizePolicy(policyIn);
  const userExcluded = globMatcher(policy.exclude);
  const reasons: Reason[] = [];
  const excluded: { path: string; reason: string }[] = [];
  const lineFiles: FileFact[] = [];

  for (const file of evidence.git.files) {
    const reason = excludeReason(file, userExcluded);
    if (reason) excluded.push({ path: file.path, reason });
    else lineFiles.push(file);
  }

  let additions = 0;
  let deletions = 0;
  for (const file of lineFiles) {
    additions += file.additions;
    deletions += file.deletions;
  }
  const net = additions - deletions;
  const churn = additions + deletions;
  const churnRows = lineFiles
    .map(f => ({ path: f.path, churn: f.additions + f.deletions }))
    .sort((a, b) => b.churn - a.churn || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  // New binary files count; lockfiles, submodules, and user-excluded paths do not.
  const newFiles = evidence.git.files
    .filter(f => f.status === 'A' && !f.submodule && !isLock(f.path) && !userExcluded(f.path))
    .map(f => f.path);

  const depSubjects: string[] = [];
  const unverifiable: { path: string; detail: string }[] = [];
  for (const manifest of evidence.dependencies.manifests) {
    if (excludedDepPath(manifest.path, userExcluded)) continue;
    if (manifest.unverifiable) {
      unverifiable.push({ path: manifest.path, detail: manifest.unverifiable_detail ?? 'manifest could not be parsed' });
      continue;
    }
    for (const entry of manifest.added) {
      if (entry.classification === 'remote') depSubjects.push(`${manifest.path}:${entry.name}`);
    }
  }

  const apiNet = netApi(evidence, userExcluded);
  const unmeasured = unmeasuredApi(evidence, userExcluded);

  const metrics: Metrics = {
    net_lines: net,
    churn,
    new_files: newFiles.length,
    new_deps: depSubjects.length,
    new_public_api: apiNet.total,
    top_churn_files: churnRows.slice(0, OUTPUT_CAPS.top_churn),
    excluded: excluded.slice(0, OUTPUT_CAPS.excluded),
    excluded_count: excluded.length,
    coverage: { new_public_api: unmeasured.length > 0 ? 'partial' : 'complete' },
    unmeasured_api_files: unmeasured.slice(0, OUTPUT_CAPS.unmeasured_api),
    unmeasured_api_count: unmeasured.length,
  };

  budget(reasons, 'net_lines_over_budget', net, policy.max_net_lines, lineFiles.map(f => f.path));
  budget(reasons, 'new_files_over_budget', newFiles.length, policy.max_new_files, newFiles);
  budget(reasons, 'new_deps_over_budget', depSubjects.length, policy.max_new_deps, depSubjects);
  budget(reasons, 'new_public_api_over_budget', apiNet.total, policy.max_new_public_api, apiNet.names);
  budget(reasons, 'churn_over_budget', churn, policy.max_churn, churnRows.map(r => r.path));

  if (unverifiable.length > 0) {
    pushReason(reasons, 'deps_unverifiable', unverifiable[0]?.detail ?? 'a manifest could not be parsed', unverifiable.map(u => u.path));
  }
  if (evidence.rename_detection_skipped) {
    pushReason(reasons, 'rename_detection_incomplete', 'inexact rename detection was skipped; renames may be reported as additions and deletions', []);
  }
  if (evidence.collection.failures.length > 0 || !evidence.collection.complete) {
    const subjects = evidence.collection.failures.flatMap(f => f.subjects);
    const detail = evidence.collection.failures.map(f => `${f.stage}: ${f.code}`).join('; ') || 'collection recorded a failure';
    pushReason(reasons, 'evidence_incomplete', detail, subjects);
  }
  const noFiles = evidence.git.files.length === 0;
  const same = evidence.git.merge_base_sha === evidence.git.head_sha;
  if ((noFiles || same) && evidence.collection.complete && evidence.collection.failures.length === 0) {
    pushReason(reasons, 'empty_diff', same ? 'merge-base equals head, so there is no diff' : 'the diff contains no changed files', []);
  }
  if (excluded.some(e => e.reason === 'binary')) {
    info(reasons, 'binary_files_excluded', 'binary files are excluded from line metrics');
  }
  if (unmeasured.length > 0) {
    info(reasons, 'api_coverage_partial', 'some changed files were not scanned for public API; see metrics.unmeasured_api_files');
  }

  const timing = timingOf(evidence);
  if (timing === 'unanchored') {
    info(reasons, 'pr_signals_not_checked', 'git-only mode does not read pull request signals');
  } else if (timing === 'retroactive') {
    const state = String(evidence.pr?.raw?.state ?? '');
    info(reasons, 'retroactive_pr_state', `pull request state is ${state}; PR signals are not applied to a closed observation`);
  } else if (evidence.pr) {
    applyPr(reasons, evidence.pr.raw);
  }

  const blocking = reasons.filter(r => r.blocking);
  const withinBudget = !reasons.some(r => r.class === 'budget' && r.blocking);
  const evidenceComplete = !reasons.some(r => r.class === 'evidence' && r.blocking);
  const ready = timing === 'open' ? !reasons.some(r => r.class === 'readiness' && r.blocking) : null;

  return {
    v: VERDICT_V,
    mode: 'shadow',
    gate_version: GATE_VERSION,
    gstack_extend_version: opts.gstackVersion,
    evidence_collector_version: evidence.collector_version,
    policy,
    policy_sha256: sha256Canonical(policy),
    evidence_id: opts.evidenceId,
    subject: {
      origin: evidence.repo.origin,
      pr_number: evidence.pr?.number ?? null,
      pr_url: evidence.pr?.url ?? null,
      base_sha: evidence.git.base_sha,
      head_sha: evidence.git.head_sha,
      merge_base_sha: evidence.git.merge_base_sha,
      decision_id: evidence.decision_id,
    },
    decided_at: now.toISOString(),
    observed_at: evidence.observed_at,
    replay: opts.replay,
    timing,
    metrics,
    would_merge: blocking.length === 0,
    within_budget: withinBudget,
    ready,
    evidence_complete: evidenceComplete,
    reasons,
  };
}

function timingOf(evidence: Evidence): 'open' | 'retroactive' | 'unanchored' {
  if (!evidence.pr) return 'unanchored';
  const state = evidence.pr.raw.state;
  if (state === 'MERGED' || state === 'CLOSED') return 'retroactive';
  return 'open';
}

function excludeReason(file: FileFact, userExcluded: Excluded): string | null {
  if (file.submodule) return 'submodule';
  if (isLock(file.path)) return 'lockfile';
  if (userExcluded(file.path)) return 'user_glob';
  if (file.binary) return 'binary';
  return null;
}

function isLock(path: string): boolean {
  return LOCKFILES.includes(basename(path));
}

function excludedDepPath(path: string, userExcluded: Excluded): boolean {
  if (isLock(path) || userExcluded(path)) return true;
  return path.split('/').some(s => TEST_DEP_SEGMENTS.includes(s));
}

function apiCounted(path: string, userExcluded: Excluded): boolean {
  return !isTestPath(path) && !userExcluded(path) && !isLock(path);
}

function netApi(evidence: Evidence, userExcluded: Excluded): { total: number; names: string[] } {
  const counts = new Map<string, number>();
  for (const file of evidence.public_api.files) {
    if (!apiCounted(file.path, userExcluded)) continue;
    for (const pair of file.added) bump(counts, `${pair.rule}\0${pair.name}`, 1);
    for (const pair of file.removed) bump(counts, `${pair.rule}\0${pair.name}`, -1);
  }
  for (const file of evidence.git.files) {
    if (!apiCounted(file.path, userExcluded) || !file.path.split('/').includes('bin')) continue;
    const mode = (m: string) => m.slice(-6);
    const added = file.status === 'A' && mode(file.new_mode) === '100755';
    const flipped = mode(file.old_mode) === '100644' && mode(file.new_mode) === '100755';
    if (added || flipped) bump(counts, `bin-exec\0${file.path}`, 1);
  }
  let total = 0;
  const names: string[] = [];
  for (const [key, n] of counts) {
    if (n > 0) {
      total += n;
      names.push(key.split('\0')[1] ?? key);
    }
  }
  return { total, names };
}

function unmeasuredApi(evidence: Evidence, userExcluded: Excluded): { path: string; reason: string }[] {
  const out: { path: string; reason: string }[] = [];
  for (const file of evidence.git.files) {
    if (file.submodule || !apiCounted(file.path, userExcluded)) continue;
    if (file.api_skipped) {
      out.push({ path: file.path, reason: file.api_skipped });
      continue;
    }
    if (file.status !== 'D' && apiCapableUnmeasured(file.path)) out.push({ path: file.path, reason: 'no_rule' });
  }
  return out;
}

function apiCapableUnmeasured(path: string): boolean {
  const base = basename(path);
  const ext = base.endsWith('.d.ts') ? '.d.ts' : (base.includes('.') ? base.slice(base.lastIndexOf('.')) : '');
  if (ext === '' && path.split('/').includes('bin')) return true;
  return API_CAPABLE_EXTENSIONS.includes(ext);
}

function bump(map: Map<string, number>, key: string, delta: number): void {
  map.set(key, (map.get(key) ?? 0) + delta);
}

function budget(reasons: Reason[], code: ReasonCode, measured: number, limit: number | null, subjects: string[]): void {
  if (limit === null || measured <= limit) return;
  const reason = pushReason(reasons, code, `${measured} > ${limit}`, subjects);
  reason.measured = measured;
  reason.limit = limit;
}

function pushReason(reasons: Reason[], code: ReasonCode, detail: string, subjects: string[]): Reason {
  const meta = REASON_META.get(code);
  const unique = [...new Set(subjects)];
  const reason: Reason = {
    code,
    class: meta?.class ?? 'info',
    blocking: meta?.blocking ?? false,
    detail,
  };
  if (meta?.blocking) {
    reason.subjects = unique.slice(0, OUTPUT_CAPS.subjects);
    reason.subjects_count = unique.length;
  }
  reasons.push(reason);
  return reason;
}

function info(reasons: Reason[], code: ReasonCode, detail: string): void {
  const meta = REASON_META.get(code);
  reasons.push({ code, class: meta?.class ?? 'info', blocking: false, detail });
}

/** CEO-S1: every row of PR_SIGNAL_TABLE is read here; a value no row names fails closed. */
function applyPr(reasons: Reason[], raw: Record<string, unknown>): void {
  const t = PR_SIGNAL_TABLE;
  if (raw.isDraft === true) pushReason(reasons, 'pr_draft', 'pull request is a draft', []);

  const mergeable = raw.mergeable;
  if (includes(t.mergeable_conflict, mergeable)) {
    pushReason(reasons, 'merge_conflict', `GitHub reports mergeable ${String(mergeable)}`, []);
  } else if (!includes(t.mergeable_pass, mergeable)) {
    pushReason(reasons, 'mergeability_unknown', `GitHub reports mergeable ${mergeable === undefined ? '(absent)' : String(mergeable)}`, []);
  }

  const review = raw.reviewDecision;
  if (includes(t.review_changes, review)) {
    pushReason(reasons, 'changes_requested', `reviewDecision is ${String(review)}`, []);
  } else if (includes(t.review_required, review)) {
    pushReason(reasons, 'review_required', `reviewDecision is ${String(review)}`, []);
  } else if (!includes(t.review_pass, review)) {
    pushReason(reasons, 'review_required', `reviewDecision ${review === undefined ? 'is absent' : `is ${String(review)}`}, which the mapping does not recognize`, []);
  }

  const rollup = raw.statusCheckRollup;
  if (!Array.isArray(rollup)) {
    pushReason(reasons, 'check_state_unknown', 'statusCheckRollup is absent or not a list', []);
  } else if (rollup.length === 0) {
    info(reasons, 'no_checks_configured', 'statusCheckRollup is empty');
  } else {
    const buckets = { failure: [] as string[], pending: [] as string[], unknown: [] as string[] };
    for (const item of rollup) {
      const rec = item !== null && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      const bucket = classifyCheck(rec);
      if (bucket === 'failure' || bucket === 'pending' || bucket === 'unknown') {
        buckets[bucket].push(String(rec.name ?? rec.context ?? 'check'));
      }
    }
    const names = (list: string[]) => list.slice(0, OUTPUT_CAPS.detail_names).join(', ');
    if (buckets.failure.length) pushReason(reasons, 'checks_failing', `failing checks: ${names(buckets.failure)}`, buckets.failure);
    if (buckets.pending.length) pushReason(reasons, 'checks_pending', `pending checks: ${names(buckets.pending)}`, buckets.pending);
    if (buckets.unknown.length) pushReason(reasons, 'check_state_unknown', `checks in an unknown state: ${names(buckets.unknown)}`, buckets.unknown);
    if (rollup.length === t.truncation_count) {
      pushReason(reasons, 'checks_truncated', `statusCheckRollup has ${t.truncation_count} contexts; GitHub may have truncated the page`, []);
    }
  }
  if (typeof raw.mergeStateStatus === 'string') {
    info(reasons, 'github_merge_state', `mergeStateStatus is ${raw.mergeStateStatus}`);
  }
}

function classifyCheck(rec: Record<string, unknown>): 'success' | 'neutral' | 'failure' | 'pending' | 'unknown' {
  const t = PR_SIGNAL_TABLE;
  if ('status' in rec || 'conclusion' in rec) {
    if (rec.status !== t.check_run_completed_status) return 'pending';
    if (includes(t.check_run_success, rec.conclusion)) return 'success';
    if (includes(t.check_run_neutral, rec.conclusion)) return 'neutral';
    if (includes(t.check_run_failure, rec.conclusion)) return 'failure';
    return 'unknown';
  }
  if ('state' in rec) {
    if (includes(t.status_success, rec.state)) return 'success';
    if (includes(t.status_pending, rec.state)) return 'pending';
    if (includes(t.status_failure, rec.state)) return 'failure';
  }
  return 'unknown';
}

function includes(list: readonly (string | null)[], value: unknown): boolean {
  return list.some(item => item === value);
}

// Structural validation for replay (ENG-7): every field decide reads must have the right type.

type Check = (v: unknown) => boolean;

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr: Check = v => typeof v === 'string';
const isBool: Check = v => typeof v === 'boolean';
const isCount: Check = v => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const nullable = (c: Check): Check => v => v === null || c(v);
const optional = (c: Check): Check => v => v === undefined || c(v);
const listOf = (c: Check): Check => v => Array.isArray(v) && v.every(c);
const shape = (fields: Record<string, Check>): Check => v => isObj(v) && Object.entries(fields).every(([k, c]) => c(v[k]));

const API_SKIPS = ['too_large', 'non_utf8_path', 'patch_missing', 'patch_failed'];
const DEP_CLASSES = ['remote', 'local', 'indirect'];

const fileFact = shape({
  path: isStr,
  path_b64: optional(isStr),
  old_path: nullable(isStr),
  old_mode: isStr,
  new_mode: isStr,
  status: v => typeof v === 'string' && ['A', 'M', 'D', 'R', 'T'].includes(v),
  additions: isCount,
  deletions: isCount,
  binary: isBool,
  submodule: isBool,
  api_skipped: optional(v => typeof v === 'string' && API_SKIPS.includes(v)),
});
const depEntry = shape({ name: isStr, classification: v => typeof v === 'string' && DEP_CLASSES.includes(v) });
const apiPair = shape({ rule: isStr, name: isStr });

const evidenceShape = shape({
  v: v => v === 1,
  observed_at: isStr,
  collection_started_at: isStr,
  collector_version: v => typeof v === 'number' && Number.isInteger(v) && v >= 1,
  rename_detection_skipped: isBool,
  decision_id: nullable(isStr),
  repo: shape({ origin: nullable(isStr) }),
  git: shape({ base_sha: isStr, head_sha: isStr, merge_base_sha: isStr, files: listOf(fileFact) }),
  dependencies: shape({
    manifests: listOf(shape({
      path: isStr,
      added: listOf(depEntry),
      removed: listOf(depEntry),
      unverifiable: isBool,
      unverifiable_detail: optional(isStr),
    })),
  }),
  public_api: shape({ files: listOf(shape({ path: isStr, added: listOf(apiPair), removed: listOf(apiPair) })) }),
  collection: shape({
    complete: isBool,
    failures: listOf(shape({ stage: isStr, code: isStr, subjects: listOf(isStr) })),
  }),
  pr: nullable(shape({
    number: isCount,
    url: isStr,
    repo: shape({ host: isStr, owner: isStr, name: isStr }),
    raw: isObj,
    raw_first: nullable(isObj),
    retry_wait_ms: nullable(v => typeof v === 'number' && Number.isFinite(v) && v >= 0),
  })),
});

export function validateEvidence(value: unknown): value is Evidence {
  return evidenceShape(value);
}
