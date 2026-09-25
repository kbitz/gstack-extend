import { basename } from 'node:path';
import { isTestPath } from './api.ts';
import { sha256Canonical } from './canon.ts';
import { matchGlob } from './glob.ts';
import {
  API_CAPABLE_EXTENSIONS,
  GATE_VERSION,
  LOCKFILES,
  PR_SIGNAL_TABLE,
  REASON_REGISTRY,
  TEST_DEP_SEGMENTS,
  VERDICT_V,
  type Policy,
  type ReasonClass,
  type ReasonCode,
} from './registry.ts';
import type { FileFact } from './diff.ts';

export type DepEntry = { name: string; classification: 'remote' | 'local' };

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
  const reasons: Reason[] = [];
  const excluded: { path: string; reason: string }[] = [];
  const lineFiles: FileFact[] = [];
  const allFiles: FileFact[] = [];

  for (const file of evidence.git.files) {
    const reason = excludeReason(file, policy.exclude);
    if (reason === 'binary') {
      excluded.push({ path: file.path, reason });
      allFiles.push(file);
      continue;
    }
    if (reason) {
      excluded.push({ path: file.path, reason });
      continue;
    }
    allFiles.push(file);
    lineFiles.push(file);
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

  const newFiles = allFiles.filter(f => f.status === 'A' && !f.submodule && !isLock(f.path) && !userExcluded(f.path, policy.exclude)).length;
  // binaries with status A are in allFiles; lockfiles and submodules and user globs are not.
  // Recompute new files from original list with the right exclusions.
  const newFileCount = evidence.git.files.filter(f => {
    if (f.status !== 'A') return false;
    if (f.submodule || isLock(f.path)) return false;
    if (userExcluded(f.path, policy.exclude)) return false;
    return true;
  }).length;
  void newFiles;

  const depSubjects: string[] = [];
  let newDeps = 0;
  const unverifiable: { path: string; detail: string }[] = [];
  for (const manifest of evidence.dependencies.manifests) {
    if (excludedDepPath(manifest.path, policy.exclude)) continue;
    if (manifest.unverifiable) {
      unverifiable.push({ path: manifest.path, detail: manifest.unverifiable_detail ?? 'manifest could not be parsed' });
      continue;
    }
    for (const entry of manifest.added) {
      if (entry.classification !== 'remote') continue;
      newDeps++;
      depSubjects.push(`${manifest.path}:${entry.name}`);
    }
  }

  const apiNet = netApi(evidence, policy.exclude);
  const unmeasured = unmeasuredApi(evidence, policy.exclude);

  const metrics: Metrics = {
    net_lines: net,
    churn,
    new_files: newFileCount,
    new_deps: newDeps,
    new_public_api: apiNet.total,
    top_churn_files: churnRows.slice(0, 3),
    excluded: excluded.slice(0, 100),
    excluded_count: excluded.length,
    coverage: { new_public_api: unmeasured.length > 0 ? 'partial' : 'complete' },
    unmeasured_api_files: unmeasured.slice(0, 50),
    unmeasured_api_count: unmeasured.length,
  };

  budget(reasons, 'net_lines_over_budget', net, policy.max_net_lines, lineFiles.map(f => f.path));
  budget(reasons, 'new_files_over_budget', newFileCount, policy.max_new_files, evidence.git.files.filter(f => f.status === 'A').map(f => f.path));
  budget(reasons, 'new_deps_over_budget', newDeps, policy.max_new_deps, depSubjects);
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
    info(reasons, 'api_coverage_partial', 'some changed files have no public-API rule in collector v1');
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

function excludeReason(file: FileFact, globs: string[]): string | null {
  if (file.submodule) return 'submodule';
  if (isLock(file.path)) return 'lockfile';
  if (userExcluded(file.path, globs)) return 'user_glob';
  if (file.binary) return 'binary';
  return null;
}

function isLock(path: string): boolean {
  return LOCKFILES.includes(basename(path));
}

function userExcluded(path: string, globs: string[]): boolean {
  return globs.some(g => matchGlob(path, g));
}

function excludedDepPath(path: string, globs: string[]): boolean {
  if (isLock(path) || userExcluded(path, globs)) return true;
  return path.split('/').some(s => TEST_DEP_SEGMENTS.includes(s));
}

function netApi(evidence: Evidence, globs: string[]): { total: number; names: string[] } {
  const counts = new Map<string, number>();
  const consider = (path: string) => !isTestPath(path) && !userExcluded(path, globs) && !isLock(path);
  for (const file of evidence.public_api.files) {
    if (!consider(file.path)) continue;
    for (const pair of file.added) bump(counts, `${pair.rule}\0${pair.name}`, 1);
    for (const pair of file.removed) bump(counts, `${pair.rule}\0${pair.name}`, -1);
  }
  for (const file of evidence.git.files) {
    if (!consider(file.path)) continue;
    if (!file.path.split('/').includes('bin')) continue;
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

function unmeasuredApi(evidence: Evidence, globs: string[]): { path: string; reason: string }[] {
  const out: { path: string; reason: string }[] = [];
  for (const file of evidence.git.files) {
    if (file.status === 'D') continue;
    if (isTestPath(file.path) || userExcluded(file.path, globs) || isLock(file.path) || file.submodule) continue;
    if (file.api_skipped === 'too_large') {
      out.push({ path: file.path, reason: 'too_large' });
      continue;
    }
    if (apiCapableUnmeasured(file.path)) out.push({ path: file.path, reason: 'no_rule' });
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
  if (limit === null) return;
  if (measured > limit) {
    const reason = pushReason(reasons, code, `${measured} > ${limit}`, subjects);
    reason.measured = measured;
    reason.limit = limit;
  }
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
    reason.subjects = unique.slice(0, 20);
    reason.subjects_count = unique.length;
  }
  reasons.push(reason);
  return reason;
}

function info(reasons: Reason[], code: ReasonCode, detail: string): void {
  const meta = REASON_META.get(code);
  reasons.push({
    code,
    class: meta?.class ?? 'info',
    blocking: false,
    detail,
  });
}

function applyPr(reasons: Reason[], raw: Record<string, unknown>): void {
  if (raw.isDraft === true) {
    pushReason(reasons, 'pr_draft', 'pull request is a draft', []);
  }
  const mergeable = raw.mergeable;
  if (mergeable === 'CONFLICTING') {
    pushReason(reasons, 'merge_conflict', 'GitHub reports mergeable CONFLICTING', []);
  } else if (mergeable !== 'MERGEABLE') {
    pushReason(reasons, 'mergeability_unknown', 'GitHub reports mergeable UNKNOWN or the field is absent', []);
  }
  const review = raw.reviewDecision;
  if (review === 'CHANGES_REQUESTED') {
    pushReason(reasons, 'changes_requested', 'reviewDecision is CHANGES_REQUESTED', []);
  } else if (review === 'REVIEW_REQUIRED') {
    pushReason(reasons, 'review_required', 'reviewDecision is REVIEW_REQUIRED', []);
  }
  const rollup = raw.statusCheckRollup;
  const checks = Array.isArray(rollup) ? rollup : [];
  if (checks.length === 0) {
    info(reasons, 'no_checks_configured', 'statusCheckRollup is empty');
  } else {
    const failing: string[] = [];
    const pending: string[] = [];
    const unknown: string[] = [];
    for (const item of checks) {
      if (item === null || typeof item !== 'object') {
        unknown.push('unknown');
        continue;
      }
      const rec = item as Record<string, unknown>;
      const name = String(rec.name ?? rec.context ?? 'check');
      const bucket = classifyCheck(rec);
      if (bucket === 'failure') failing.push(name);
      else if (bucket === 'pending') pending.push(name);
      else if (bucket === 'unknown') unknown.push(name);
    }
    if (failing.length) pushReason(reasons, 'checks_failing', `failing checks: ${failing.slice(0, 20).join(', ')}`, failing);
    if (pending.length) pushReason(reasons, 'checks_pending', `pending checks: ${pending.slice(0, 20).join(', ')}`, pending);
    if (unknown.length) pushReason(reasons, 'check_state_unknown', `checks in an unknown state: ${unknown.slice(0, 20).join(', ')}`, unknown);
    if (checks.length === PR_SIGNAL_TABLE.truncation_count) {
      pushReason(reasons, 'checks_truncated', 'statusCheckRollup has 100 contexts; GitHub may have truncated the page', []);
    }
  }
  if (typeof raw.mergeStateStatus === 'string') {
    info(reasons, 'github_merge_state', `mergeStateStatus is ${raw.mergeStateStatus}`);
  }
}

function classifyCheck(rec: Record<string, unknown>): 'success' | 'neutral' | 'failure' | 'pending' | 'unknown' {
  if ('status' in rec || 'conclusion' in rec) {
    const status = rec.status;
    if (status !== PR_SIGNAL_TABLE.check_run_pending_status) return 'pending';
    const conclusion = rec.conclusion;
    if (includes(PR_SIGNAL_TABLE.check_run_success, conclusion)) return 'success';
    if (includes(PR_SIGNAL_TABLE.check_run_neutral, conclusion)) return 'neutral';
    if (includes(PR_SIGNAL_TABLE.check_run_failure, conclusion)) return 'failure';
    return 'unknown';
  }
  if ('state' in rec) {
    const state = rec.state;
    if (includes(PR_SIGNAL_TABLE.status_success, state)) return 'success';
    if (includes(PR_SIGNAL_TABLE.status_pending, state)) return 'pending';
    if (includes(PR_SIGNAL_TABLE.status_failure, state)) return 'failure';
    return 'unknown';
  }
  return 'unknown';
}

function includes(list: readonly (string | null)[], value: unknown): boolean {
  return list.some(item => item === value);
}

export function validateEvidence(value: unknown): value is Evidence {
  if (value === null || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  if (e.v !== 1) return false;
  if (typeof e.observed_at !== 'string') return false;
  if (typeof e.collection_started_at !== 'string') return false;
  if (typeof e.collector_version !== 'number') return false;
  if (e.git === null || typeof e.git !== 'object') return false;
  const git = e.git as Record<string, unknown>;
  if (typeof git.base_sha !== 'string' || typeof git.head_sha !== 'string' || typeof git.merge_base_sha !== 'string') {
    return false;
  }
  if (!Array.isArray(git.files)) return false;
  if (e.dependencies === null || typeof e.dependencies !== 'object') return false;
  if (e.collection === null || typeof e.collection !== 'object') return false;
  if (e.repo === null || typeof e.repo !== 'object') return false;
  if (!('pr' in e)) return false;
  return true;
}
