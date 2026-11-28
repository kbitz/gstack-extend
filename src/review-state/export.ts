import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { findingCycles, type FindingCycle } from './finding-cycles.ts';
import { CORRUPT_ORDER_FIX, CORRUPT_READ_FIX, storedWriterOrderKnown, truncate80, validateStoredState, VOICE_RE, type PassRecord, type ReasonCode, type ReviewRunState } from './state.ts';
import { makeEnvelope, readHelperVersion, runGit, validateStateDir, type StoreResult } from './store.ts';

export const NAMESPACE = '9aa572eb-215f-452f-99e8-2bfdf0329cf3';
export const EXPORT_SCHEMA = 'review-state-export/v1' as const;

export function uuidv5(namespace: string, name: string): string {
  const nsHex = namespace.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(nsHex)) throw new Error(`Invalid UUID namespace: ${namespace}`);
  const nsBytes = Buffer.from(nsHex, 'hex');
  const digest = createHash('sha1').update(nsBytes).update(Buffer.from(name, 'utf8')).digest();
  const bytes = Uint8Array.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export type ExportSegment = {
  segment: number;
  started_at: string;
  ended_at: string | null;
  end: 'paused' | 'finished' | 'interrupted' | null;
  recorded_session_id: string | null;
  session_id: string;
  derived: boolean;
  outcome: 'success' | 'blocked' | 'unknown' | null;
  run_step_id: string;
};

export type ExportSkippedItem = {
  kind: 'pass' | 'correction';
  id: string;
  pass_id?: string;
  correction_id?: string;
  reason: 'segment-unknown';
};

export type ExportRecord = {
  session_id: string;
  op: 'begin' | 'pass' | 'correction' | 'end' | 'finding-cycles';
  request: Record<string, unknown>;
};

export type ExportStageRun = {
  segment: number;
  session_id: string;
  started_at: string;
  ended_at: string;
  outcome: 'success' | 'blocked' | 'unknown';
  branch: string;
};

export type ReviewStateExport = {
  schema: typeof EXPORT_SCHEMA;
  run: {
    run_id: string;
    repo: string;
    branch: string;
    helper_version: string | null;
  };
  segments: ExportSegment[];
  skipped: ExportSkippedItem[];
  records: ExportRecord[];
  stage_runs: ExportStageRun[];
};

export function projectState(state: ReviewRunState, helperVersion: string | null = null): ReviewStateExport {
  const runId = state.run.run_id;
  const metricVoiceId = (voiceId: string): string =>
    VOICE_RE.test(voiceId) ? voiceId : uuidv5(NAMESPACE, `${runId}:voice:${voiceId}`);

  const segments: ExportSegment[] = state.segments.map((seg) => {
    const derived = seg.session_id === null;
    const sessionId = seg.session_id ?? `extend-${uuidv5(NAMESPACE, `${runId}:segment:${seg.segment}`)}`;
    const outcome: 'success' | 'blocked' | 'unknown' | null =
      seg.end === null
        ? null
        : seg.end === 'interrupted'
          ? 'unknown'
          : seg.end === 'paused'
            ? 'blocked'
            : state.finish?.outcome === 'prepared'
              ? 'success'
              : 'blocked';
    const runStepId = uuidv5(NAMESPACE, `${runId}:segment:${seg.segment}:run`);
    return {
      segment: seg.segment,
      started_at: seg.started_at,
      ended_at: seg.ended_at,
      end: seg.end,
      recorded_session_id: seg.session_id,
      session_id: sessionId,
      derived,
      outcome,
      run_step_id: runStepId,
    };
  });

  const skipped: ExportSkippedItem[] = [];
  const passById = new Map(state.passes.map((p) => [p.pass_id, p]));
  for (const pass of state.passes) {
    if (pass.segment === null) {
      skipped.push({ kind: 'pass', id: pass.pass_id, pass_id: pass.pass_id, reason: 'segment-unknown' });
    }
  }

  type PendingFindingCorrection = {
    corr: ReviewRunState['corrections'][number];
    eventId: string;
    supersedesEventId: string | null;
  };
  const findingCorrectionsBySegment = new Map<number, PendingFindingCorrection[]>();
  const skippedCorrectionIds = new Set<string>();
  const nearestEmittedByCorrId = new Map<string, string | null>();

  for (const corr of state.corrections) {
    const targetPass = passById.get(corr.target.pass_id);
    const ancestorSkipped = corr.supersedes !== null && skippedCorrectionIds.has(corr.supersedes);
    if (corr.segment === null || !targetPass || targetPass.segment === null || ancestorSkipped) {
      skippedCorrectionIds.add(corr.correction_id);
      skipped.push({ kind: 'correction', id: corr.correction_id, correction_id: corr.correction_id, reason: 'segment-unknown' });
      continue;
    }

    const nearestAncestor = corr.supersedes !== null ? (nearestEmittedByCorrId.get(corr.supersedes) ?? null) : null;
    if (corr.adjudication === null && corr.resolution === null) {
      nearestEmittedByCorrId.set(corr.correction_id, nearestAncestor);
      continue;
    }

    const eventId = uuidv5(NAMESPACE, `${runId}:correction:${corr.correction_id}`);
    nearestEmittedByCorrId.set(corr.correction_id, eventId);
    const list = findingCorrectionsBySegment.get(targetPass.segment) ?? [];
    list.push({ corr, eventId, supersedesEventId: nearestAncestor });
    findingCorrectionsBySegment.set(targetPass.segment, list);
  }

  const resumeCheckpoints = state.checkpoints.filter((cp) => cp.kind === 'resume');
  const records: ExportRecord[] = [];
  const cyclesBySegment = new Map<number, { cycles: FindingCycle[]; progress: string }>();
  const localGroups = new Map<number, PassRecord[]>();
  const greptilePasses: PassRecord[] = [];
  for (const pass of state.passes) {
    if (pass.scope === 'local') {
      const group = localGroups.get(pass.cycle) ?? [];
      group.push(pass);
      localGroups.set(pass.cycle, group);
    } else {
      greptilePasses.push(pass);
    }
  }
  // Local passes share a group by cycle. Each Greptile pass has its own group.
  const progress = createHash('sha256');
  let greptileIndex = 0;
  for (const cycle of findingCycles(state)) {
    const passes = cycle.cycle === 'greptile'
      ? [greptilePasses[greptileIndex++]!]
      : localGroups.get(cycle.cycle)!;
    let segment = null;
    for (const pass of passes) {
      if (pass.segment !== null) segment = pass.segment;
      const settled = pass.voices.filter((voice) => voice.selected_attempt_id !== null || voice.not_applicable !== null);
      progress.update(JSON.stringify([pass.pass_id, pass.state, settled.map(
        (voice) => [voice.voice_id, voice.selected_attempt_id, voice.not_applicable],
      )]));
    }
    if (segment === null) continue;
    // Earlier groups affect carried and repeated counts. Include their progress so
    // counts that return to an earlier value still append a newer snapshot.
    const cycles = cyclesBySegment.get(segment)?.cycles ?? [];
    cycles.push(cycle);
    cyclesBySegment.set(segment, { cycles, progress: progress.copy().digest('hex') });
  }

  for (const segInfo of segments) {
    const sessionId = segInfo.session_id;
    const resumeCp = segInfo.segment > 1
      ? (resumeCheckpoints.find((cp) => cp.segment === segInfo.segment) ?? resumeCheckpoints[segInfo.segment - 2])
      : undefined;
    const candHead = segInfo.segment === 1 ? state.binding.head : (resumeCp ? resumeCp.head : state.binding.head);
    const candTree = segInfo.segment === 1 ? state.binding.tree : (resumeCp ? resumeCp.tree : state.binding.tree);
    const candBase = segInfo.segment === 1 ? state.binding.base : (resumeCp ? resumeCp.base : state.binding.base);

    // 1. Run begin
    records.push({
      session_id: sessionId,
      op: 'begin',
      request: {
        v: 1,
        stage: 'review-and-prep',
        session_id: sessionId,
        event_id: uuidv5(NAMESPACE, `${runId}:segment:${segInfo.segment}:begin`),
        step_id: segInfo.run_step_id,
        parent_step_id: null,
        kind: 'run',
        phase: 'run',
        context: {
          candidate_head: candHead,
          candidate_tree: candTree,
          candidate_base: candBase,
          binding: 'unknown',
          skill_sha256: null,
          parent_session_id: null,
        },
      },
    });

    // 2. Passes in this segment
    const segPasses = state.passes.filter((p) => p.segment === segInfo.segment);
    for (const pass of segPasses) {
      records.push({
        session_id: sessionId,
        op: 'pass',
        request: {
          v: 2,
          stage: 'review-and-prep',
          session_id: sessionId,
          event_id: uuidv5(NAMESPACE, `${runId}:pass:${pass.pass_id}:started`),
          pass_id: pass.pass_id,
          scope: pass.scope,
          state: 'started',
          required_voice_ids: pass.required_voices.map(metricVoiceId),
          context: {
            candidate_head: pass.candidate.commit,
            candidate_tree: pass.candidate.tree,
            candidate_base: pass.candidate.base,
            binding: 'unknown',
          },
        },
      });

      for (const voice of pass.voices) {
        for (const att of voice.attempts) {
          const attemptReq: Record<string, unknown> = {
            v: 4,
            stage: 'review-and-prep',
            session_id: sessionId,
            event_id: uuidv5(NAMESPACE, `${runId}:attempt:${pass.pass_id}:${voice.voice_id}:${att.attempt_id}`),
            pass_id: pass.pass_id,
            scope: pass.scope,
            state: 'attempt',
            voice_id: metricVoiceId(voice.voice_id),
            attempt_id: att.attempt_id,
            predecessor_attempt_id: att.predecessor_attempt_id,
            attempt_outcome: att.outcome,
          };
          if (att.outcome === 'completed') {
            attemptReq.findings = (att.findings ?? []).map((f) => ({
              finding_id: f.finding_id,
              severity_source: f.severity_source,
              severity_rubric: f.severity_rubric,
              adjudication: f.adjudication,
              resolution: f.resolution,
              duplicate_of: f.duplicate_of,
              found_by: [...f.found_by],
              attribution_reason: f.attribution_reason,
              finding_key: f.identity?.key ?? null,
              finding_class: f.finding_class ?? null,
            }));
          }
          if (att.delegate !== null) {
            attemptReq.delegate = {
              provider: att.delegate.provider,
              model: att.delegate.model,
              outcome: att.delegate.outcome,
              fallback_reason: att.delegate.fallback_reason,
              replay: att.delegate.replay,
              wall_ms: att.delegate.wall_ms,
              input_tokens: att.delegate.input_tokens,
              output_tokens: att.delegate.output_tokens,
              cache_read_input_tokens: att.delegate.cache_read_input_tokens,
              cache_creation_input_tokens: att.delegate.cache_creation_input_tokens,
            };
          }
          records.push({
            session_id: sessionId,
            op: 'pass',
            request: attemptReq,
          });
        }
      }

      for (const voice of pass.voices) {
        if (voice.selected_attempt_id !== null) {
          records.push({
            session_id: sessionId,
            op: 'pass',
            request: {
              v: 2,
              stage: 'review-and-prep',
              session_id: sessionId,
              event_id: uuidv5(NAMESPACE, `${runId}:voice-complete:${pass.pass_id}:${voice.voice_id}`),
              pass_id: pass.pass_id,
              scope: pass.scope,
              state: 'voice-complete',
              voice_id: metricVoiceId(voice.voice_id),
              voice_status: 'completed',
              selected_attempt_id: voice.selected_attempt_id,
            },
          });
        } else if (voice.not_applicable !== null) {
          records.push({
            session_id: sessionId,
            op: 'pass',
            request: {
              v: 2,
              stage: 'review-and-prep',
              session_id: sessionId,
              event_id: uuidv5(NAMESPACE, `${runId}:voice-complete:${pass.pass_id}:${voice.voice_id}`),
              pass_id: pass.pass_id,
              scope: pass.scope,
              state: 'voice-complete',
              voice_id: metricVoiceId(voice.voice_id),
              voice_status: 'not-applicable',
              na_reason: voice.not_applicable,
            },
          });
        }
      }

      if (pass.state === 'completed') {
        records.push({
          session_id: sessionId,
          op: 'pass',
          request: {
            v: 2,
            stage: 'review-and-prep',
            session_id: sessionId,
            event_id: uuidv5(NAMESPACE, `${runId}:pass:${pass.pass_id}:completed`),
            pass_id: pass.pass_id,
            scope: pass.scope,
            state: 'completed',
          },
        });
      }
    }

    // 3. Corrections for this segment (finding corrections targeting passes in this segment, then retry/fallback corrections)
    for (const item of findingCorrectionsBySegment.get(segInfo.segment) ?? []) {
      const corrReq: Record<string, unknown> = {
        v: 1,
        stage: 'review-and-prep',
        session_id: sessionId,
        event_id: item.eventId,
        correction_kind: 'finding',
        pass_id: item.corr.target.pass_id,
        voice_id: metricVoiceId(item.corr.target.voice_id),
        attempt_id: item.corr.target.attempt_id,
        finding_id: item.corr.target.finding_id,
      };
      if (item.supersedesEventId !== null) corrReq.supersedes_event_id = item.supersedesEventId;
      if (item.corr.adjudication !== null) corrReq.adjudication = item.corr.adjudication;
      if (item.corr.resolution !== null) corrReq.resolution = item.corr.resolution;
      records.push({
        session_id: sessionId,
        op: 'correction',
        request: corrReq,
      });
    }

    for (const pass of segPasses) {
      for (const voice of pass.voices) {
        for (const att of voice.attempts) {
          if (att.predecessor_attempt_id === null) continue;
          const pred = voice.attempts.find((a) => a.attempt_id === att.predecessor_attempt_id);
          const correctionKind = pred?.delegate?.outcome === 'fell-back' ? 'fallback' : 'retry';
          records.push({
            session_id: sessionId,
            op: 'correction',
            request: {
              v: 1,
              stage: 'review-and-prep',
              session_id: sessionId,
              event_id: uuidv5(NAMESPACE, `${runId}:attempt-correction:${pass.pass_id}:${voice.voice_id}:${att.attempt_id}`),
              correction_kind: correctionKind,
              pass_id: pass.pass_id,
              voice_id: metricVoiceId(voice.voice_id),
              attempt_id: att.attempt_id,
            },
          });
        }
      }
    }

    const snapshot = cyclesBySegment.get(segInfo.segment);
    if (snapshot) {
      const digest = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
      records.push({
        session_id: sessionId,
        op: 'finding-cycles',
        request: {
          v: 1,
          stage: 'review-and-prep',
          session_id: sessionId,
          event_id: uuidv5(NAMESPACE, `${runId}:finding-cycles:${segInfo.segment}:${digest}`),
          cycles: snapshot.cycles,
        },
      });
    }

    // 4. Run end (only when derived === false and seg.end is paused or finished)
    if (!segInfo.derived && (segInfo.end === 'paused' || segInfo.end === 'finished')) {
      const endOutcome = segInfo.end === 'finished' && state.finish?.outcome === 'prepared' ? 'completed' : 'paused';
      records.push({
        session_id: sessionId,
        op: 'end',
        request: {
          v: 1,
          stage: 'review-and-prep',
          session_id: sessionId,
          event_id: uuidv5(NAMESPACE, `${runId}:segment:${segInfo.segment}:end`),
          step_id: segInfo.run_step_id,
          outcome: endOutcome,
        },
      });
    }
  }

  const stageRuns: ExportStageRun[] = segments
    .filter((s): s is ExportSegment & { ended_at: string; outcome: 'success' | 'blocked' | 'unknown' } =>
      s.derived && s.end !== null && s.ended_at !== null && s.outcome !== null)
    .map((s) => ({
      segment: s.segment,
      session_id: s.session_id,
      started_at: s.started_at,
      ended_at: s.ended_at,
      outcome: s.outcome,
      branch: state.run.branch,
    }));

  return {
    schema: EXPORT_SCHEMA,
    run: {
      run_id: runId,
      repo: state.run.repo,
      branch: state.run.branch,
      helper_version: helperVersion ?? state.writer,
    },
    segments,
    skipped,
    records,
    stage_runs: stageRuns,
  };
}

export type LoadedStoredState =
  | {
      ok: true;
      state: ReviewRunState;
      statePath: string;
      stateBytes: Buffer;
      realDir: string;
      realTop: string;
      actualBranch: string;
      gitEnv: NodeJS.ProcessEnv;
      helperVersion: string | null;
    }
  | { ok: false; exitCode: 1 | 2 | 3 | 4; envelope: StoreResult };

export function loadStoredState(
  command: string,
  dirArg: string,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  versionPath?: string,
): LoadedStoredState {
  const helperVersion = readHelperVersion(versionPath);
  const fail = (reason: ReasonCode, detail: Record<string, unknown>, sPath: string | null, rev: number | null = null, customFix?: string): LoadedStoredState => {
    const envObj = makeEnvelope(command, reason, detail, sPath, rev, customFix, helperVersion, null);
    return { ok: false, exitCode: envObj.exitCode as 1 | 2 | 3 | 4, envelope: envObj };
  };

  const dirCheck = validateStateDir(command, dirArg, cwd, env, helperVersion);
  if (!dirCheck.ok) {
    return { ok: false, exitCode: dirCheck.result.exitCode as 1 | 2 | 3 | 4, envelope: dirCheck.result };
  }
  const { realTop, realDir, statePath, gitEnv } = dirCheck;

  const commonDirRes = runGit(cwd, ['rev-parse', '--git-common-dir'], gitEnv);
  const symRefRes = runGit(cwd, ['symbolic-ref', '--short', 'HEAD'], gitEnv);
  const revRefRes = symRefRes.ok ? symRefRes : runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], gitEnv);
  if (!commonDirRes.ok || !commonDirRes.stdout) {
    return fail('not-in-worktree', { cwd: truncate80(cwd) }, statePath);
  }
  const actualRepo = realpathSync(resolve(cwd, commonDirRes.stdout));
  const actualBranch = revRefRes.ok ? revRefRes.stdout : '';

  let stateBytes: Buffer;
  try {
    stateBytes = readFileSync(statePath);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') {
      return fail('not-started', {}, statePath);
    }
    return fail('corrupt', { path: truncate80(statePath), message: truncate80(e.message) }, statePath, null, CORRUPT_READ_FIX);
  }

  let parsedState: unknown;
  try {
    parsedState = JSON.parse(stateBytes.toString('utf8'));
  } catch (err) {
    return fail('corrupt', { path: truncate80(statePath), message: truncate80((err as Error).message) }, statePath);
  }

  const validated = validateStoredState(parsedState, statePath, helperVersion);
  if (!validated.ok) {
    const customFix = validated.reason === 'corrupt' && !storedWriterOrderKnown(parsedState, helperVersion) ? CORRUPT_ORDER_FIX : undefined;
    return fail(validated.reason, validated.detail, statePath, null, customFix);
  }
  const storedState = validated.state;

  const actualHost = hostname();
  if (storedState.host !== null && storedState.host !== actualHost) {
    return fail(
      'cross-host',
      {
        expected_host: truncate80(storedState.host),
        actual_host: truncate80(actualHost),
      },
      statePath,
      storedState.rev,
    );
  }

  if (storedState.run.repo !== actualRepo) {
    return fail(
      'worktree-mismatch',
      {
        expected_repo: truncate80(storedState.run.repo),
        actual_repo: truncate80(actualRepo),
        expected_branch: truncate80(storedState.run.branch),
        actual_branch: truncate80(actualBranch),
      },
      statePath,
      storedState.rev,
    );
  }

  return { ok: true, state: storedState, statePath, stateBytes, realDir, realTop, actualBranch, gitEnv, helperVersion };
}

export type ExportCommandResult =
  | { ok: true; exitCode: 0; exportDoc: ReviewStateExport }
  | { ok: false; exitCode: 1 | 2 | 3 | 4; envelope: StoreResult };

export function executeExport(
  dirArg: string,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  versionPath?: string,
): ExportCommandResult {
  const loaded = loadStoredState('export', dirArg, cwd, env, versionPath);
  if (!loaded.ok) return loaded;
  const exportDoc = projectState(loaded.state, loaded.helperVersion);
  return { ok: true, exitCode: 0, exportDoc };
}
