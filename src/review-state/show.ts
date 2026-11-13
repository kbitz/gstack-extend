import { readdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { loadStoredState } from './export.ts';
import { exitState, isFreshForBinding, unresolvedFindings, type RenderExitState } from './render.ts';
import {
  collectEvidenceItems,
  HEX40_RE,
  truncate80,
  WTREE_RE,
  type CandidateBinding,
  type ReasonCode,
  type ReviewRunState,
} from './state.ts';
import {
  checkDirFile,
  cleanGitEnv,
  makeEnvelope,
  readHelperVersion,
  runGit,
  type StoreResult,
} from './store.ts';

export const SHOW_SCHEMA = 'review-state-show/v1' as const;
const RENDERED_FILE_RE = /^(full-receipt|comment-receipt|comment-paused|comment-stopped|pr-body|final)-([1-9]\d*)\.md$/;

export type ShowGateOrAudit = {
  name: string;
  result: string;
  reason: string | null;
  candidate: CandidateBinding;
  recorded_at: string;
  fresh: boolean | null;
  evidence_ok: boolean;
};

export type ReviewStateShow = {
  schema: typeof SHOW_SCHEMA;
  state_path: string;
  rev: number;
  helper_version: string | null;
  lifecycle: 'open' | 'paused' | 'finished';
  exit: Exclude<RenderExitState, 'not-renderable'> | null;
  run: ReviewRunState['run'];
  binding: ReviewRunState['binding'];
  head: {
    current: string;
    tree: string;
    reference: string;
    relation: 'same' | 'ahead' | 'diverged';
  };
  plan: ReviewRunState['plan'];
  policy: ReviewRunState['policy'];
  continuation: ReviewRunState['continuation'];
  segments: {
    segment: number;
    started_at: string;
    ended_at: string | null;
    end: 'paused' | 'finished' | 'interrupted' | null;
    session_id: string | null;
  }[];
  checkpoints: {
    kind: string;
    segment: number | null;
    head: string;
  }[];
  last_checkpoint: Omit<ReviewRunState['checkpoints'][number], 'evidence'> | null;
  passes: {
    pass_id: string;
    scope: string;
    cycle: number;
    coverage: string;
    state: 'open' | 'completed';
    candidate: CandidateBinding;
    voices: {
      voice_id: string;
      required: boolean;
      status: 'selected' | 'not-applicable' | 'open';
    }[];
  }[];
  gates: ShowGateOrAudit[];
  audits: ShowGateOrAudit[];
  unresolved: string[];
  finish: {
    outcome: string;
    stop_reason: string | null;
    head: string;
  } | null;
  rendered: {
    path: string;
    sha256: string;
  }[];
};

export type ShowCommandResult =
  | { ok: true; exitCode: 0; showDoc: ReviewStateShow }
  | { ok: false; exitCode: 1 | 2 | 3 | 4; envelope: StoreResult };

function latestByFirstSeenName<T extends { name: string }>(items: readonly T[]): T[] {
  const order: string[] = [];
  const latest = new Map<string, T>();
  for (const item of items) {
    if (!latest.has(item.name)) order.push(item.name);
    latest.set(item.name, item);
  }
  return order.map((name) => latest.get(name)!);
}

export function executeShow(
  dirArg: string,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  versionPath?: string,
  baseArg?: string,
  wtreeArg?: string,
): ShowCommandResult {
  const helperVersion = readHelperVersion(versionPath);
  const initialStatePath = isAbsolute(dirArg) ? join(dirArg.replace(/\/+$/, '') || '/', 'review-run-state.json') : null;
  const fail = (
    reason: ReasonCode,
    detail: Record<string, unknown>,
    sPath: string | null,
    rev: number | null = null,
    customFix?: string,
  ): ShowCommandResult => {
    const envObj = makeEnvelope('show', reason, detail, sPath, rev, customFix, helperVersion, null);
    return { ok: false, exitCode: envObj.exitCode as 1 | 2 | 3 | 4, envelope: envObj };
  };

  if (baseArg !== undefined && !HEX40_RE.test(baseArg)) {
    return fail('usage', { message: truncate80(`invalid --base "${baseArg}"; expected 40-hex commit SHA`) }, initialStatePath);
  }
  if (wtreeArg !== undefined && !WTREE_RE.test(wtreeArg)) {
    return fail('usage', { message: truncate80(`invalid --wtree "${wtreeArg}"`) }, initialStatePath);
  }
  if (baseArg !== undefined) {
    const checkGitEnv = cleanGitEnv(env);
    const topRes = runGit(cwd, ['rev-parse', '--show-toplevel'], checkGitEnv);
    if (topRes.ok && !runGit(cwd, ['cat-file', '-e', `${baseArg}^{commit}`], checkGitEnv).ok) {
      return fail('usage', { message: truncate80(`--base commit "${baseArg}" does not exist`) }, initialStatePath);
    }
  }

  const loaded = loadStoredState('show', dirArg, cwd, env, versionPath);
  if (!loaded.ok) return loaded;
  const { state, statePath, realDir, actualBranch, gitEnv } = loaded;

  if (state.run.branch !== actualBranch) {
    return fail(
      'worktree-mismatch',
      {
        expected_repo: truncate80(state.run.repo),
        actual_repo: truncate80(state.run.repo),
        expected_branch: truncate80(state.run.branch),
        actual_branch: truncate80(actualBranch),
      },
      statePath,
      state.rev,
    );
  }

  const headRes = runGit(cwd, ['rev-parse', 'HEAD'], gitEnv);
  const treeRes = runGit(cwd, ['rev-parse', 'HEAD^{tree}'], gitEnv);
  if (!headRes.ok || !HEX40_RE.test(headRes.stdout) || !treeRes.ok || !HEX40_RE.test(treeRes.stdout)) {
    return fail('not-in-worktree', { cwd: truncate80(cwd) }, statePath, state.rev);
  }
  const liveHead = headRes.stdout;
  const liveTree = treeRes.stdout;

  const lastSeg = state.segments[state.segments.length - 1]!;
  const lifecycle: ReviewStateShow['lifecycle'] =
    state.finish !== null ? 'finished' : lastSeg.end === 'paused' ? 'paused' : 'open';
  const rawExit = exitState(state);
  const exit = rawExit === 'not-renderable' ? null : rawExit;

  const lastCp = state.checkpoints.length > 0 ? state.checkpoints[state.checkpoints.length - 1]! : null;
  const refHead = lastCp ? lastCp.head : state.binding.head;
  const relation: 'same' | 'ahead' | 'diverged' =
    liveHead === refHead
      ? 'same'
      : runGit(cwd, ['merge-base', '--is-ancestor', refHead, liveHead], gitEnv).ok
        ? 'ahead'
        : 'diverged';

  const segments = state.segments.map((s) => ({
    segment: s.segment,
    started_at: s.started_at,
    ended_at: s.ended_at,
    end: s.end,
    session_id: s.session_id,
  }));

  const checkpoints = state.checkpoints.map((cp) => ({
    kind: cp.kind,
    segment: cp.segment,
    head: cp.head,
  }));

  const lastCheckpoint = lastCp
    ? {
        checkpoint_id: lastCp.checkpoint_id,
        segment: lastCp.segment,
        kind: lastCp.kind,
        head: lastCp.head,
        tree: lastCp.tree,
        base: lastCp.base,
        wtree: lastCp.wtree,
        session_id: lastCp.session_id,
        recorded_at: lastCp.recorded_at,
      }
    : null;

  const passes = state.passes.map((p) => ({
    pass_id: p.pass_id,
    scope: p.scope,
    cycle: p.cycle,
    coverage: p.coverage,
    state: p.state,
    candidate: p.candidate,
    voices: p.voices.map((v) => ({
      voice_id: v.voice_id,
      required: v.required,
      status: (v.selected_attempt_id !== null
        ? 'selected'
        : v.not_applicable !== null
          ? 'not-applicable'
          : 'open') as 'selected' | 'not-applicable' | 'open',
    })),
  }));

  const activeCheckBinding = baseArg
    ? { head: liveHead, tree: liveTree, base: baseArg, wtree: wtreeArg ?? null }
    : null;

  const gates: ShowGateOrAudit[] = latestByFirstSeenName(state.gates).map((g) => ({
    name: g.name,
    result: g.result,
    reason: g.reason,
    candidate: g.candidate,
    recorded_at: g.recorded_at,
    fresh: activeCheckBinding ? isFreshForBinding(g.candidate, activeCheckBinding) : null,
    evidence_ok: collectEvidenceItems('record gate', g).every((ev) => checkDirFile(realDir, ev.path, ev.sha256).ok),
  }));

  const audits: ShowGateOrAudit[] = latestByFirstSeenName(state.audits).map((a) => ({
    name: a.name,
    result: a.result,
    reason: null,
    candidate: a.candidate,
    recorded_at: a.recorded_at,
    fresh: activeCheckBinding ? isFreshForBinding(a.candidate, activeCheckBinding) : null,
    evidence_ok: collectEvidenceItems('record audit', a).every((ev) => checkDirFile(realDir, ev.path, ev.sha256).ok),
  }));

  let dirEntries: string[] = [];
  try {
    dirEntries = readdirSync(realDir);
  } catch {
    dirEntries = [];
  }
  const renderedCandidates: { path: string; sha256: string; prefix: string; num: bigint }[] = [];
  for (const name of dirEntries) {
    const m = RENDERED_FILE_RE.exec(name);
    if (!m) continue;
    const chk = checkDirFile(realDir, name);
    if (!chk.ok) continue;
    renderedCandidates.push({ path: name, sha256: chk.sha256, prefix: m[1]!, num: BigInt(m[2]!) });
  }
  renderedCandidates.sort((a, b) => {
    if (a.prefix !== b.prefix) return a.prefix < b.prefix ? -1 : 1;
    if (a.num !== b.num) return a.num < b.num ? -1 : 1;
    return 0;
  });

  const showDoc: ReviewStateShow = {
    schema: SHOW_SCHEMA,
    state_path: statePath,
    rev: state.rev,
    helper_version: loaded.helperVersion ?? state.writer,
    lifecycle,
    exit,
    run: state.run,
    binding: state.binding,
    head: {
      current: liveHead,
      tree: liveTree,
      reference: refHead,
      relation,
    },
    plan: state.plan,
    policy: state.policy,
    continuation: state.continuation,
    segments,
    checkpoints,
    last_checkpoint: lastCheckpoint,
    passes,
    gates,
    audits,
    unresolved: unresolvedFindings(state),
    finish: state.finish
      ? {
          outcome: state.finish.outcome,
          stop_reason: state.finish.stop_reason,
          head: state.finish.head,
        }
      : null,
    rendered: renderedCandidates.map(({ path, sha256 }) => ({ path, sha256 })),
  };

  return { ok: true, exitCode: 0, showDoc };
}
