/**
 * Greptile lifecycle decision core: input, evidence and result contracts.
 *
 * Internal contract version 1 (Track 22E). There is no stable external API
 * promise: the collectors that Track 24B adds must reconcile their output
 * with these shapes before any skill adopts the core. Every value is plain
 * JSON (no Date, Map, class instance or `undefined`), so a caller can persist
 * one observation and replay it byte for byte.
 *
 * Evidence families, their producers, and what a caller passes when a family
 * cannot be obtained. The core derives trust and classification from these
 * raw facts; it never accepts a caller's "trusted" or "safe" flag, and it never
 * invents a missing fact. Missing evidence yields a concrete blocked result.
 *
 * | Family       | Producer                                              | Unavailable                          |
 * |--------------|-------------------------------------------------------|--------------------------------------|
 * | subject      | GitHub PR query (`gh pr view`), bound for the snapshot | input is invalid (R01)               |
 * | refs         | git: local HEAD, remote branch tip, base ancestry     | `unknown`/`failed` -> refresh        |
 * | diff         | git: full base-to-head diff plus intended work         | `unknown` -> applicability unresolved |
 * | config       | git trees at both tips; dashboard settings when cited | `unknown` -> applicability unresolved |
 * | comments     | GitHub issue comments, every page, author + editors   | `incomplete` -> refresh history      |
 * | submissions  | Greptile MCP responses and the caller's journal       | `unknown` -> refresh history         |
 * | ownerJournal | the caller's own durable reservation journal          | `unknown` -> no fresh-owner proof    |
 * | runs         | MCP run status, bot reviews, Greptile check runs      | `incomplete` -> refresh history      |
 * | ancestry     | git `merge-base --is-ancestor` with history depth     | `unknown` -> ancestry unresolved     |
 * | receipts     | PR body, paused/receipt comments, current-session answers | `unknown` -> restrictions unknown |
 * | localGates   | the local review/test/plan evidence ledger            | `unknown` -> refresh local evidence  |
 *
 * Trust roots are caller-supplied: `caller.accountId` is the authenticated
 * running account and `caller.greptileActorIds` the verified Greptile app or
 * bot identities. They are not cryptographic proof; a collector that reports
 * the wrong account defeats every author rule downstream.
 */

/** The only accepted `inputVersion`. Other values are an adapter contract error. */
export const INPUT_VERSION = 1;
/** The only accepted `timeUnit`: integer milliseconds since the Unix epoch (UTC). */
export const TIME_UNIT = 'epoch-ms';
/** Commit of `skills/review-and-prep.md` whose rules this core encodes. */
export const POLICY_COMMIT = '217d630653d6a9a334abd4e905c136394c28909d';
/** Pinned policy revision reported on every result. */
export const POLICY_REVISION = `skills/review-and-prep.md@${POLICY_COMMIT}`;

/** Integer milliseconds since the Unix epoch. */
export type EpochMs = number;
/** Full lowercase hex commit or tree id (40 or 64 characters). */
export type Sha = string;

/** Who produced an evidence family. Each family accepts a fixed producer set. */
export type Producer =
  | 'github-api'
  | 'greptile-mcp'
  | 'git'
  | 'caller-journal'
  | 'local-checks';

/** The PR identity an evidence family was collected for. */
export interface SubjectRef {
  host: string;
  /** Base repository, `owner/name`. */
  repository: string;
  prNumber: number;
  headSha: Sha;
}

export interface Provenance {
  producer: Producer;
  /**
   * When this family was collected. Ten-minute timers run from the request or
   * run anchor and are judged at the earliest collection time of `comments`,
   * `submissions`, and `runs`, so a decision never treats run absence it has
   * not observed as elapsed time.
   */
  collectedAtEpochMs: EpochMs;
  subject: SubjectRef;
}

/**
 * One evidence family. `known` is complete for this observation, including a
 * known-empty list. `unknown` was not collected or cannot be obtained.
 * `failed` errored, `incomplete` is missing pages or records, and `stale` was
 * collected for an earlier subject. Only `known` evidence can prove anything.
 */
export type Evidence<T> =
  | { state: 'known'; provenance: Provenance; value: T }
  | { state: 'unknown'; reason: string }
  | { state: 'failed'; provenance: Provenance; reason: string }
  | { state: 'incomplete'; provenance: Provenance; reason: string }
  | { state: 'stale'; provenance: Provenance; reason: string };

/** The PR this observation is bound to. Producer: GitHub PR metadata. */
export interface Subject {
  host: string;
  /** `owner/name` of the repository the PR targets. */
  baseRepository: string;
  /** `owner/name` of the repository holding the head branch (differs for forks). */
  headRepository: string;
  prNumber: number;
  baseBranch: string;
  headBranch: string;
  /** Fetched base tip this observation reviews against. */
  baseSha: Sha;
  /** PR `headRefOid`. */
  headSha: Sha;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  /** PR creation time. Every PR-bound record must fall between this and `observedAtEpochMs`. */
  createdAtEpochMs: EpochMs;
}

/** The session asking for a decision. Its identities are trust roots. */
export interface Caller {
  /** Authenticated running account; the author rule compares against it. */
  accountId: string;
  /** This agent session. Fresh reservation ownership binds to it. */
  sessionId: string;
  /**
   * Verified Greptile app/bot actor ids, never including `accountId`. Review and
   * check-run observations from other actors are ignored; a Greptile MCP
   * observation under any other identity blocks as a misconfiguration.
   */
  greptileActorIds: readonly string[];
  /** Whether a usable Greptile MCP trigger tool exists in this session. */
  mcpTrigger: 'available' | 'unavailable';
}

/** Result of `git merge-base --is-ancestor <ancestor> <descendant>`. */
export interface AncestryCheck {
  ancestorSha: Sha;
  descendantSha: Sha;
  /** `error` is any exit other than 0/1 that is not a confirmed missing object. */
  result: 'ancestor' | 'not-ancestor' | 'missing-object' | 'error';
  /** Only `complete` history can prove `not-ancestor` or `missing-object`. */
  history: 'complete' | 'shallow' | 'fetch-incomplete';
}

/** Producer: git after fetching the verified remotes. */
export interface RefFacts {
  localHeadSha: Sha;
  /** Remote feature-branch tip; `null` only when a successful lookup found no branch. */
  remoteHeadSha: Sha | null;
  /** `subject.baseSha` ancestry against `subject.headSha`. */
  baseInclusion: AncestryCheck;
}

/**
 * How a changed file's content was classified. The caller applies the
 * repository's documented docs-only classification when one exists, and
 * otherwise inspects the change. The class covers the whole change, including
 * removed or replaced content: deleting code, or renaming or retyping a code
 * file into documentation, is `code`. Markdown that drives agent behavior
 * (skills, prompts) is `agent-instructions`, not `prose`. `unclassified` keeps
 * applicability unresolved.
 */
export type ContentClass =
  | 'prose'
  | 'doc-asset'
  | 'agent-instructions'
  | 'code'
  | 'configuration'
  | 'build'
  | 'test'
  | 'unclassified';

export interface DiffFile {
  path: string;
  /** Source path for renames and copies; otherwise `null`. */
  previousPath: string | null;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'type-changed';
  entryKind: 'file' | 'symlink' | 'submodule';
  contentClass: ContentClass;
}

/** The repository's documented docs-only classification, read at the base tip. */
export type DocsPolicy =
  | { kind: 'documented'; path: string; readAtSha: Sha }
  | { kind: 'not-documented'; readAtSha: Sha };

/**
 * Producer: git. The whole intended PR diff, base tip to head plus intended
 * uncommitted work. An empty diff leaves applicability unresolved. Once the
 * base is integrated, every root-marker change between the configuration tips
 * must appear here.
 */
export interface DiffFacts {
  baseSha: Sha;
  headSha: Sha;
  files: readonly DiffFile[];
  docsPolicy: DocsPolicy;
}

/** A root configuration file. Unreadable bytes count the same as unparseable JSON. */
export type ConfigFile = { readable: true; content: string } | { readable: false };

/** Root Greptile markers and configuration at one tip. Nested configuration is not a root marker. */
export interface TipConfig {
  sha: Sha;
  /** Root `greptile.json`; `null` when absent. */
  greptileJson: ConfigFile | null;
  /** Root `.greptile.json`, a local policy signal Greptile may not read; `null` when absent. */
  dotGreptileJson: ConfigFile | null;
  /**
   * Root `.greptile/`: repository-relative paths of the files intended under
   * it (for example `.greptile/rules.md`), and its `config.json` contents;
   * `null` when absent. Listing `.greptile/config.json` requires `configJson`.
   */
  dotGreptileDir: { files: readonly string[]; configJson: ConfigFile | null } | null;
}

/** Effective settings an authenticated Greptile dashboard or run metadata exposed. */
export interface VerifiedSettings {
  /** Citation for the settings (dashboard page, run metadata id). */
  source: string;
  autoReview: readonly string[];
  /** [] means verified none; null means this setting was not exposed. */
  requiredLabels: readonly string[] | null;
  /** An ignore rule that verifiably excludes this PR. */
  exclusion: { key: string; location: string } | null;
}

/**
 * Producer: git trees at the reviewed base tip and the intended head, plus
 * verified dashboard metadata when a tool exposes it. Raw file contents are
 * parsed by the core; they never appear in a result.
 */
export interface ConfigFacts {
  base: TipConfig;
  head: TipConfig;
  verifiedSettings: VerifiedSettings | null;
  /** Greptile app installation on the base repository, from verified metadata. */
  app: 'installed' | 'not-installed' | 'unknown';
}

/**
 * A `review-and-prep:greptile-reservation:` or `review-and-prep:greptile:`
 * marker comment. Producer: every page of GitHub issue comments, with the
 * GraphQL `userContentEdits` editor set. Bodies are not passed.
 */
export interface MarkerComment {
  /** Numeric GitHub comment id; ties on `createdAtEpochMs` order by it numerically. */
  commentId: number;
  kind: 'reservation' | 'trigger';
  markerSha: Sha;
  authorId: string;
  /** Every editor in the edit history; `null` when the history is unreadable. */
  editorIds: readonly string[] | null;
  createdAtEpochMs: EpochMs;
  /** For a trigger: readback shows the actual `@greptileai review this draft` call. */
  containsTriggerCall: boolean;
}

/**
 * One MCP trigger attempt. Producer: the MCP response, or the caller's journal
 * when the response was lost. `not-submitted` releases a reservation only with
 * proof from Greptile request or run history; a user's word is not proof. A
 * `not-submitted` record names no run.
 */
export interface SubmissionRecord {
  submissionId: string;
  reservationCommentId: number | null;
  sessionId: string;
  /** Original journal observation for this attempt; null when unavailable. */
  journalObservationId: string | null;
  attemptedAtEpochMs: EpochMs;
  outcome: 'accepted' | 'ambiguous' | 'not-submitted';
  notSubmittedProof: 'mcp-request-history' | 'run-history' | null;
  runId: string | null;
}

/**
 * The caller's durable reservation journal. A fresh-owner entry must bind the
 * marker readback to this session and this observation and record the phase
 * `confirmed-unattempted` before any trigger attempt is made. The caller
 * writes `attempted` before calling a trigger, so a crash leaves no fresh proof.
 */
export interface OwnerJournalEntry {
  reservationCommentId: number;
  reservationCreatedAtEpochMs: EpochMs;
  sessionId: string;
  observationId: string;
  subjectHeadSha: Sha;
  readbackConfirmed: boolean;
  phase: 'confirmed-unattempted' | 'attempted' | 'unknown';
  /**
   * For `attempted`: the transport the caller was about to use. A `comment`
   * attempt is explained by its trigger comment; `mcp` or `null` (unknown)
   * stays an uncertain request. `null` for the other phases.
   */
  attemptTransport: 'mcp' | 'comment' | null;
  recordedAtEpochMs: EpochMs;
}

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown';

/**
 * One observation of a Greptile run. Producer: MCP run metadata, a submitted
 * bot review, or a Greptile check run, each with its actor id. Several
 * observations may describe the same `runId`.
 */
export interface RunObservation {
  runId: string;
  reporter: 'greptile-mcp' | 'github-review' | 'github-check-run';
  actorId: string;
  /** An automatic run never explains a manual request (trigger comment, MCP attempt). */
  origin: 'automatic' | 'manual' | 'unknown';
  status: RunStatus;
  /** Authoritative, monotonically increasing revision within this reporter's domain only. */
  statusRevision: number | null;
  /** The SHA the run was started for. */
  recordedSha: Sha | null;
  /** The SHA the completion evidence names (`commit_id`, check `head_sha`, MCP metadata). */
  reviewedSha: Sha | null;
  completionProof: 'mcp-run-metadata' | 'bot-review-commit' | 'check-output-confirms-review' | 'none';
  /**
   * Original trigger time when known. When reporters or a correlated
   * submission disagree, the earliest time anchors the run's timer.
   */
  submittedAtEpochMs: EpochMs | null;
  /** First sighting, preserved by the caller across sessions; never rewritten. The earliest sighting of a run wins. */
  firstSeenAtEpochMs: EpochMs;
  observedAtEpochMs: EpochMs;
}

export type RestrictionKind = 'manual-testing-pending' | 'greptile-postponed' | 'draft-push-conflict';

export interface RestrictionRow {
  restrictionId: string;
  kind: RestrictionKind;
}

/** Explicit resolution of an earlier restriction. Recency alone resolves nothing. */
export interface ResolutionRow {
  restrictionId: string;
}

export type QuestionCode = 'E1' | 'E2' | 'E4' | 'E6' | 'E7' | 'POLICY-CHANGE' | 'SKIP-ACK';
export type OptionId = 'a' | 'b' | 'c';

/**
 * Original evidence retained when granting E2/E6/E7. The trusted receipt binds
 * this witness to its recorded head; later missing histories cannot erase it.
 * These are raw run/git/local-review facts, not a caller-supplied validity flag.
 * The adapter retains the original head/tree/base association and run observation
 * when recording the answer, rather than reconstructing them on resume.
 */
export interface WaiverGrant {
  headSha: Sha;
  baseSha: Sha;
  treeSha: Sha;
  baseInclusion: AncestryCheck;
  run: RunObservation;
  /** Original accepted/ambiguous submission correlated by runId, or null when unavailable. */
  submission: SubmissionRecord | null;
  /**
   * E6's original complete comments/submissions/runs collection times, copied
   * from their provenance when recording the answer. Null when unavailable
   * or for other questions. The earliest collection must reach the run's
   * ten-minute exit; answer time alone cannot prove the question was offered.
   */
  historyCollectedAtEpochMs: { comments: EpochMs; submissions: EpochMs; runs: EpochMs } | null;
  /** E7's original complete-history stale-commit proof. */
  reviewedAncestry: AncestryCheck | null;
  /** E7's full base-to-head review, performed before the answer. */
  fullDiffReview: GateRecord | null;
}

/** A recorded answer to an exit or policy question. */
export interface DecisionRow {
  decisionId: string;
  question: QuestionCode;
  option: OptionId;
  /** The `edgeKey` of the ask result this answers. */
  edgeKey: string;
  /** May predate PR creation for Step 1 questions answered before the draft existed. */
  answeredAtEpochMs: EpochMs;
  /** E6 (a) only: inclusive end of the chosen wait. */
  waitDeadlineEpochMs: EpochMs | null;
  /** E2/E6/E7: the run the question named. */
  runId: string | null;
  /** E4: the request the question named. */
  requestRef: string | null;
  /**
   * E4's original complete comments/submissions/runs collection times, copied
   * from their provenance when recording the answer; null if unavailable or
   * for other questions. The earliest collection must reach the covered
   * request's ten-minute exit. Do not reconstruct this witness on resume.
   */
  requestHistoryCollectedAtEpochMs: { comments: EpochMs; submissions: EpochMs; runs: EpochMs } | null;
  /** E2 (a), E6 (b), E7 (a): findings the run already posted were triaged before the waiver. */
  postedFindingsTriaged: boolean;
  /** E7 (a): tree of the full base-to-head `/review` performed before the waiver. */
  fullDiffReviewTreeSha: Sha | null;
  /** Required original witness for a run waiver; null for other answers. */
  grant: WaiverGrant | null;
}

/**
 * A preparation receipt, paused receipt, or answer captured in this session.
 * Producer: PR body and comments with author and editor history, or the
 * caller for `current-session` answers. Restrictions bind even when the
 * record is untrusted; affirmative rows need the running account as author
 * and every editor, and a head on the current branch lineage.
 */
export interface ReceiptRecord {
  recordId: string;
  location: 'pr-body' | 'paused-comment' | 'receipt-comment' | 'current-session';
  authorId: string;
  editorIds: readonly string[] | null;
  /**
   * When this record's current content was written: a comment's creation
   * time, or the last edit of an edited comment or PR body. A resolution
   * releases only restrictions recorded strictly earlier, so a record never
   * repeats a restriction it resolves.
   */
  createdAtEpochMs: EpochMs;
  prNumber: number;
  /** Head recorded by the receipt (the pause SHA for a paused receipt). */
  headSha: Sha;
  /** Greptile requests/runs the receipt records (`run:<id>`, `comment:<id>`, `submission:<id>`). */
  recordedRequestRefs: readonly string[];
  restrictions: readonly RestrictionRow[];
  resolutions: readonly ResolutionRow[];
  decisions: readonly DecisionRow[];
}

/** Where a local gate's evidence came from. Receipt-sourced evidence needs a trusted record. */
export type GateSource = { kind: 'current-session' } | { kind: 'receipt'; recordId: string };

export interface GateRecord {
  status: 'passed' | 'failed' | 'incomplete';
  /** Tree covered: LocalGates.treeSha for local gates, or WaiverGrant.treeSha for an original E7 review. */
  treeSha: Sha;
  source: GateSource;
}

/**
 * Verified external preparation evidence. The core composes these gates; it
 * never re-runs or re-derives review, test, or plan policy.
 */
export interface LocalGates {
  /** Git tree of the current HEAD. */
  treeSha: Sha;
  worktree: 'clean' | 'uncommitted-in-scope';
  /** Base the local review and tests ran against. */
  reviewedBaseSha: Sha;
  review: GateRecord;
  tests: GateRecord;
  /** Completion matrix reconciled: every item VERIFIED or DEFERRED BY USER. */
  planCompletion: GateRecord;
  /** Receipt-sourced `passed`/`deferred-by-user` results cover only the head that receipt recorded. */
  manualTesting: { status: 'not-required' | 'passed' | 'deferred-by-user' | 'pending'; source: GateSource };
  /** Unresolved blocking reviews from owners, members, or collaborators. */
  blockingHumanReviews: readonly string[];
  /** Required scope or product decisions still open. */
  unresolvedDecisions: readonly string[];
  prLabels: readonly string[];
  labelApplication: 'not-attempted' | 'applied' | 'failed' | 'unverified';
  /** Greptile findings triage per run or runless response; any row is evidence that Greptile responded. */
  findings: readonly { runId: string; allPagesCollected: boolean; undispositioned: readonly string[] }[];
  /** Local review covering the delta from a reviewed SHA to the current tree. */
  deltaReviews: readonly { fromSha: Sha; treeSha: Sha; source: GateSource }[];
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
}

/** One recorded observation. Every top-level family is required; pass `unknown` rather than omitting one. */
export interface LifecycleInput {
  inputVersion: 1;
  timeUnit: 'epoch-ms';
  /** Caller-chosen stable id for this snapshot, forwarded unchanged. */
  observationId: string;
  /** Decision time. Injected; the core never reads a clock. Timers also need evidence collected after their threshold. */
  nowEpochMs: EpochMs;
  /** When this snapshot finished collecting; `<= nowEpochMs`. */
  observedAtEpochMs: EpochMs;
  caller: Caller;
  subject: Subject;
  refs: Evidence<RefFacts>;
  diff: Evidence<DiffFacts>;
  config: Evidence<ConfigFacts>;
  comments: Evidence<readonly MarkerComment[]>;
  submissions: Evidence<readonly SubmissionRecord[]>;
  ownerJournal: Evidence<readonly OwnerJournalEntry[]>;
  runs: Evidence<readonly RunObservation[]>;
  ancestry: Evidence<readonly AncestryCheck[]>;
  receipts: Evidence<readonly ReceiptRecord[]>;
  localGates: Evidence<LocalGates>;
}

// ─── Results ──────────────────────────────────────────────────────────────

/** Stable rule ids. `RULES` in policy.ts gives each one's row, title and source. */
export type RuleId =
  | 'R01.invalid-input'
  | 'R01.subject-mismatch'
  | 'R02.terminal-pr'
  | 'R03.already-prepared'
  | 'R03.incomplete-preparation'
  | 'R04.restrictions-unknown'
  | 'R04.manual-testing'
  | 'R04.restriction'
  | 'R04.stay-draft'
  | 'R04.resolution-unverified'
  | 'R05.applicability-unresolved'
  | 'R05.policy-change'
  | 'R05.skip-acknowledgment'
  | 'R06.E1'
  | 'R06.config-pause'
  | 'R07.waiver-full-review'
  | 'R07.waiver-triage'
  | 'R08.history-unresolved'
  | 'R08.run-contradiction'
  | 'R09.monitor-run'
  | 'R09.chosen-wait'
  | 'R09.E6'
  | 'R10.completion-unverified'
  | 'R10.ancestry-unresolved'
  | 'R10.E7'
  | 'R10.E2'
  | 'R10.triage'
  | 'R10.delta-review'
  | 'R11.monitor-request'
  | 'R11.E4'
  | 'R11.triage'
  | 'R12.refs-unresolved'
  | 'R12.reconcile-head'
  | 'R12.integrate-base'
  | 'R12.worktree'
  | 'R12.local-review'
  | 'R12.human-feedback'
  | 'R12.labels-unverified'
  | 'R12.apply-labels'
  | 'R13.reservation-unconfirmed'
  | 'R13.reservation-lost'
  | 'R13.record-reservation'
  | 'R13.trigger'
  | 'R14.refs-unresolved'
  | 'R14.reconcile-head'
  | 'R14.integrate-base'
  | 'R14.worktree'
  | 'R14.local-review'
  | 'R14.human-feedback'
  | 'R14.mergeable-unknown'
  | 'R14.unresolved-decisions'
  | 'R14.ready-eligible';

/** Closed set of prerequisites a `continue` result can name. The core never performs them. */
export type ContinueNext =
  | 'refresh-evidence'
  | 'no-op'
  | 'already-prepared'
  | 'incomplete-preparation'
  | 'record-reservation'
  | 'integrate-base'
  | 'reconcile-head'
  | 'apply-required-labels'
  | 'resolve-label-evidence'
  | 'local-review'
  | 'triage'
  | 'resolve-restriction'
  | 'resolve-local-gates';

export type DiagnosticCause = 'contract' | 'collection' | 'policy' | 'gate';
export type Remediation =
  | 'repair-adapter-contract'
  | 'obtain-specific-evidence'
  | 'await-user-decision'
  | 'complete-prerequisite'
  | 'resolve-restriction'
  | 'informational';

/** A specific, actionable explanation. `path` points into the input. */
export interface Diagnostic {
  path: string;
  problem: string;
  cause: DiagnosticCause;
  remediation: Remediation;
  policyRef: string;
}

export interface ResultCommon {
  inputVersion: 1;
  policyRevision: string;
  boundSubject: Subject;
  observationId: string;
  ruleId: RuleId;
  reason: string;
  policyRef: string;
  /** Canonically sorted references to the records that justified the result. */
  evidenceRefs: readonly string[];
  diagnostics: readonly Diagnostic[];
}

export type OptionEffect =
  | 'configuration-pause'
  | 'affirmative-waiver'
  | 'unverified-permission'
  | 'wait'
  | 'stay-draft'
  | 'policy-retain'
  | 'policy-disable'
  | 'acknowledge-skip';

export interface AskOption {
  id: OptionId;
  label: string;
  consequence: string;
  effect: OptionEffect;
  recommended: boolean;
}

/** E1's proposed configuration edit. Shown to the user; never applied by any caller automatically. */
export interface ConfigRemedy {
  file: string;
  branch: 'base';
  snippet: '"autoReview": []';
  scope: 'every PR in the repository';
}

export type GreptileBasis =
  | { kind: 'completed'; runIds: readonly string[]; reviewedShas: readonly Sha[] }
  | { kind: 'unverified-no-response'; requestRef: string; anchorEpochMs: EpochMs }
  | { kind: 'unverified-user-decision'; requestRef: string; decisionRef: string }
  | { kind: 'skipped'; reason: 'no-root-configuration' | 'docs-only' | 'user-policy-decision' | 'app-not-installed'; ref: string | null; detail: null }
  /** `detail` is the verified exclusion's `<location> <key>`. */
  | { kind: 'skipped'; reason: 'excluded'; ref: string | null; detail: string }
  | { kind: 'waived'; question: 'E1' | 'E2' | 'E6' | 'E7'; decisionRef: string };

export type WaitFor =
  | { kind: 'restriction-resolution'; restrictionRefs: readonly string[] }
  | { kind: 'run-progress'; runId: string; anchorEpochMs: EpochMs; anchor: 'submitted' | 'first-seen' | 'user-wait'; untilEpochMs: EpochMs }
  | { kind: 'request-response'; requestRef: string; transport: 'comment' | 'mcp-or-ambiguous'; anchorEpochMs: EpochMs; untilEpochMs: EpochMs }
  | { kind: 'reservation-winner'; winnerRef: string; ownRef: string; anchorEpochMs: EpochMs; untilEpochMs: EpochMs }
  | { kind: 'configuration-change'; file: string };

export interface TriggerResult extends ResultCommon {
  action: 'trigger';
  transport: 'mcp' | 'comment';
  reservationRef: string;
  requestedHeadSha: Sha;
  /** The recommendation holds only for this observation and session; revalidate before the effect. */
  validFor: { observationId: string; sessionId: string };
  consumesAllowance: true;
  configuration: 'verified-settings' | 'declared-intent-only';
  requiredLabels: readonly string[];
}

export interface WaitResult extends ResultCommon {
  action: 'wait';
  waitFor: WaitFor;
}

export interface AskResult extends ResultCommon {
  action: 'ask';
  policyCode: QuestionCode;
  title: string;
  /** Record this with the answer; an unchanged edge is not asked again. */
  edgeKey: string;
  /** Offered options, recommended first. */
  options: readonly AskOption[];
  recommendedOptionId: OptionId;
  notes: readonly string[];
  remedy: ConfigRemedy | null;
}

export interface ContinueResult extends ResultCommon {
  action: 'continue';
  next: ContinueNext;
}

export interface ReadyEligibleResult extends ResultCommon {
  action: 'ready-eligible';
  greptile: GreptileBasis;
  satisfiedGates: readonly string[];
  /** Eligibility for this snapshot only; never authority to mutate the PR. */
  authority: 'recommendation-only';
}

/** Malformed input: bindings are `null` when they could not be validated. */
export interface InvalidInputResult extends Omit<ContinueResult, 'boundSubject' | 'observationId' | 'ruleId'> {
  ruleId: 'R01.invalid-input';
  next: 'refresh-evidence';
  boundSubject: Subject | null;
  observationId: string | null;
}

export type LifecycleResult = TriggerResult | WaitResult | AskResult | ContinueResult | ReadyEligibleResult;
export type LifecycleDecision = LifecycleResult | InvalidInputResult;
export type LifecycleAction = LifecycleResult['action'];
