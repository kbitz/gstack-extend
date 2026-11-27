import {
  isObj, isRelPath, HEX64_RE, validateStoredState,
  type EnvChecker, type FindingClass, type FindingRecord, type GitInfo, type PassRecord,
  type PriorFindings, type PriorFindingEntry, type PriorStateRequest, type ReviewRunState,
} from './state.ts';

export const MAX_PRIOR_ENTRIES = 2000;
export const MAX_PRIOR_ENTRY_BYTES = 512 * 1024;
type UnavailableReason = Extract<PriorFindings, { status: 'unavailable' }>['reason'];
type FindingGroup = { cycle: number | 'greptile'; passes: PassRecord[] };
type FindingPrior = 'none' | 'imported' | 'partial' | `unavailable:${UnavailableReason}`;
export type FindingCycle = {
  run: number;
  cycle: FindingGroup['cycle'];
  coverage: 'full' | 'delta' | 'mixed';
  observed: 'complete' | 'partial';
  new: number;
  carried: number;
  repeated_premise: number;
  repeated_premise_pairs: number;
  unkeyed: number;
  prior: FindingPrior;
};

function findingGroups(passes: PassRecord[]): FindingGroup[] {
  const groups: FindingGroup[] = [];
  const local = new Map<number, FindingGroup>();
  for (const pass of passes) {
    const group = pass.scope === 'local' ? local.get(pass.cycle) : undefined;
    if (group) {
      group.passes.push(pass);
    } else {
      const next: FindingGroup = { cycle: pass.scope === 'local' ? pass.cycle : 'greptile', passes: [pass] };
      groups.push(next);
      if (next.cycle !== 'greptile') local.set(next.cycle, next);
    }
  }
  return groups;
}

function selectedFindings(group: FindingGroup): Map<string, FindingRecord> {
  const findings = new Map<string, FindingRecord>();
  for (const pass of group.passes) {
    for (const voice of pass.voices) {
      const attempt = voice.attempts.find((a) => a.attempt_id === voice.selected_attempt_id);
      for (const finding of attempt?.findings ?? []) {
        if (!findings.get(finding.finding_id)?.identity) findings.set(finding.finding_id, finding);
      }
    }
  }
  return findings;
}

function observed(group: FindingGroup): FindingCycle['observed'] {
  return group.passes.some((p) => p.state === 'open' || p.voices.some(
    (v) => v.required && v.selected_attempt_id === null && v.not_applicable === null,
  )) ? 'partial' : 'complete';
}

const pair = (path: string, findingClass: FindingClass) => JSON.stringify([path, findingClass]);

export function summarizePrior(prior: PriorFindings | null) {
  if (prior === null) return null;
  return prior.status === 'unavailable'
    ? { status: prior.status, reason: prior.reason, complete: false, entry_count: 0, source: null }
    : { status: prior.status, reason: null, complete: prior.complete, entry_count: prior.entries.length, source: prior.source };
}

export function findingPrior(state: ReviewRunState): FindingPrior {
  const { prior_findings: prior, prior_stops: stops } = state.continuation;
  if (!prior) return stops === 0 ? 'none' : 'unavailable:not-recorded';
  return prior.status === 'unavailable' ? `unavailable:${prior.reason}` : prior.complete ? 'imported' : 'partial';
}

export function findingCycles(state: ReviewRunState): FindingCycle[] {
  const prior = state.continuation.prior_findings;
  const entries = prior?.status === 'imported' ? prior.entries : [];
  const earlierKeys = new Set(entries.map((e) => e.key));
  const earlierPairs = new Set(entries.map((e) => pair(e.path, e.finding_class)));
  const earlierIds = new Set<string>();
  return findingGroups(state.passes).map((group) => {
    const current = selectedFindings(group);
    const keyed = new Map<string, { premise: string; carried: boolean }>();
    let unkeyed = 0;
    for (const [id, { identity, finding_class: findingClass }] of current) {
      if (identity && findingClass) {
        keyed.set(identity.key, {
          premise: pair(identity.path, findingClass),
          carried: earlierIds.has(id) || earlierKeys.has(identity.key) || (keyed.get(identity.key)?.carried ?? false),
        });
      } else {
        unkeyed++;
      }
    }
    let carried = 0;
    let repeated = 0;
    const repeatedPairs = new Set<string>();
    for (const item of keyed.values()) {
      if (item.carried) carried++;
      else if (earlierPairs.has(item.premise)) {
        repeated++;
        repeatedPairs.add(item.premise);
      }
    }
    for (const id of current.keys()) earlierIds.add(id);
    for (const [key, item] of keyed) {
      earlierKeys.add(key);
      earlierPairs.add(item.premise);
    }
    const firstCoverage = group.passes[0]!.coverage === 'delta' ? 'delta' : 'full';
    return {
      run: state.continuation.prior_stops + 1,
      cycle: group.cycle,
      coverage: group.passes.every((p) => p.coverage === firstCoverage) ? firstCoverage : 'mixed',
      observed: observed(group),
      new: keyed.size - carried,
      carried,
      repeated_premise: repeated,
      repeated_premise_pairs: repeatedPairs.size,
      unkeyed,
      prior: findingPrior(state),
    };
  });
}

export function formatFindingCycle(cycle: FindingCycle): string {
  return `Finding cycle: ${Object.entries(cycle).map(([key, value]) => `${key}=${value}`).join('; ')}`;
}

export function canonicalPriorRequest(raw: unknown): PriorStateRequest | null {
  if (raw === undefined || raw === null) return null;
  const path = isObj(raw) && isRelPath(raw.path) ? raw.path : null;
  // Distinguish a supplied bad digest from a legacy request without one.
  const digest = isObj(raw) ? raw.sha256 : null;
  const sha256 = typeof digest === 'string' && HEX64_RE.test(digest) ? digest : digest == null ? null : 'invalid';
  return { path, sha256 };
}

export function importPriorFindings(
  request: PriorStateRequest | null,
  continues: string | null,
  git: GitInfo,
  env: EnvChecker,
  helperVersion: string | null,
): PriorFindings | null {
  const unavailable = (reason: UnavailableReason): PriorFindings => ({ status: 'unavailable', reason });
  if (request === null) return continues === null ? null : unavailable('not-supplied');
  const file = env.readAdvisoryFile?.(request.path, 4 * 1024 * 1024);
  if (!file || request.path === null) return unavailable('unusable-file');
  if (request.sha256 !== null && request.sha256 !== file.sha256) return unavailable('digest-mismatch');
  let raw: unknown;
  try {
    raw = JSON.parse(file.text);
  } catch {
    return unavailable('corrupt');
  }
  const validated = validateStoredState(raw, request.path, helperVersion);
  if (!validated.ok) return unavailable(validated.reason);
  const prior = validated.state;
  if (prior.finish?.outcome !== 'stopped') return unavailable('not-stopped');
  if (prior.finish.head !== continues) return unavailable('head-mismatch');
  if (prior.run.repo !== git.repo || prior.run.branch !== git.branch) return unavailable('binding-mismatch');

  const history = prior.continuation.prior_findings;
  const entries = new Map<string, PriorFindingEntry>();
  if (history?.status === 'imported') {
    for (const entry of history.entries) entries.set(entry.key, entry);
  }
  let complete = request.sha256 !== null && (history === null
    ? prior.continuation.prior_stops === 0
    : history.status === 'imported' && history.complete);
  for (const group of findingGroups(prior.passes)) {
    if (observed(group) === 'partial') complete = false;
    for (const { identity, finding_class: findingClass } of selectedFindings(group).values()) {
      if (!identity || !findingClass) {
        complete = false;
      } else if (!entries.has(identity.key)) {
        entries.set(identity.key, { ...identity, finding_class: findingClass, run: prior.continuation.prior_stops + 1, cycle: group.cycle });
      }
    }
  }

  const newest = [...entries.values()].slice(-MAX_PRIOR_ENTRIES);
  let bytes = 2; // JSON array brackets
  let first = newest.length;
  while (first > 0) {
    const entryBytes = Buffer.byteLength(JSON.stringify(newest[first - 1])) + (first === newest.length ? 0 : 1);
    if (bytes + entryBytes > MAX_PRIOR_ENTRY_BYTES) break;
    bytes += entryBytes;
    first--;
  }
  const retained = newest.slice(first);
  return {
    status: 'imported',
    source: { path: request.path, sha256: file.sha256, run_id: prior.run.run_id },
    complete: complete && retained.length === entries.size,
    entries: retained,
  };
}
