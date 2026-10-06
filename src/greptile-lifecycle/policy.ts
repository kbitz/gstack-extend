/**
 * Greptile lifecycle policy tables and pure configuration normalization.
 *
 * Source of every rule: `skills/review-and-prep.md` at POLICY_COMMIT. Line
 * anchors in `policyRef` point into that pinned revision. Vendor behavior
 * (`autoReview` events, legacy keys, `.greptile/` precedence) follows the
 * references below as recorded during Track 22E planning on 2026-10-03.
 *
 * Nothing here reads files, prose, clocks, or the network. A policy change in
 * the skill requires a matching change to these tables, to decide.ts, and to
 * the scenario fixtures in tests/greptile-lifecycle.test.ts. Track 24B owns
 * the drift lock between the skill prose and this module.
 */
import { POLICY_COMMIT } from './types.ts';
import type {
  ConfigFile,
  ConfigFacts,
  ContinueNext,
  DiffFacts,
  LifecycleAction,
  OptionEffect,
  OptionId,
  QuestionCode,
  RuleId,
  TipConfig,
} from './types.ts';

export const POLICY_SOURCE = 'skills/review-and-prep.md';

/** `skills/review-and-prep.md@<short commit>#L<a>-L<b>`. */
export function policyRef(lines: string): string {
  return `${POLICY_SOURCE}@${POLICY_COMMIT.slice(0, 7)}#${lines}`;
}

export const VENDOR_REFERENCES = [
  {
    url: 'https://www.greptile.com/docs/code-review/greptile-json-reference',
    inspected: '2026-10-03',
    covers: 'greptile.json keys: autoReview (default ["open"]), triggerOnUpdates, skipReview',
  },
  {
    url: 'https://www.greptile.com/docs/code-review/greptile-config-reference',
    inspected: '2026-10-03',
    covers: '.greptile/ directory; .greptile/config.json takes precedence over greptile.json',
  },
] as const;

/**
 * The ten-minute no-response and incomplete-run threshold. Inclusive:
 * `observed - anchor >= 600000`, where `observed` is the earliest collection
 * time of the comment, submission, and run histories.
 */
export const NO_RESPONSE_MS = 600_000;
/**
 * E6 (a) default wait when the user names no interval. The caller records
 * `waitDeadlineEpochMs = answeredAtEpochMs + DEFAULT_E6_WAIT_MS`; the core
 * never fills in a missing deadline and treats such an answer as unanswered.
 */
export const DEFAULT_E6_WAIT_MS = 600_000;

/** Every exit question closes with this line. */
export const ASKED_ONCE_LINE = 'This is asked once for this PR; your answer is recorded in the receipt.';

// ─── Numbered decision table ──────────────────────────────────────────────

/**
 * Precedence rows. The first row whose condition holds decides, except where
 * a row states that it yields; a row's subbranches are the rule ids in RULES.
 */
export const ROWS = {
  R01: { title: 'Input contract and subject binding', precedence: 'Malformed input or evidence bound to another subject blocks before any policy rule.' },
  R02: { title: 'Terminal PR', precedence: 'A closed or merged PR needs a new work decision; nothing here acts on it.' },
  R03: { title: 'Already-ready PR', precedence: 'A ready PR gets a read-only preparation check: no trigger, push, ready, or redraft.' },
  R04: { title: 'Restrictive pauses', precedence: 'Manual testing, recorded restrictions, and current stay-draft answers hold until explicitly resolved. A resolution that lacks only its receipt\'s ancestry asks for that evidence.' },
  R05: { title: 'Applicability and waiver provenance', precedence: 'Root markers, docs-only classification, policy-file changes, and skip acknowledgments, independent of Greptile history.' },
  R06: { title: 'Second-run safeguard (E1)', precedence: 'When Greptile applies or a request/run exists, the ready transition must not start a second run. A recorded E1 (a) pause yields: it applies only at the trigger and readiness boundaries, after the R09–R12 and R14 gates.' },
  R07: { title: 'Valid skip or affirmative waiver', precedence: 'Skipped or waived PRs go to local readiness gates without fetching, polling, or triaging Greptile.' },
  R08: { title: 'History completeness', precedence: 'Without a skip or waiver, incomplete or contradictory Greptile history refreshes before any other Greptile rule.' },
  R09: { title: 'Pending run (E6)', precedence: 'Any queued or running run is monitored before any completed or failed record is considered.' },
  R10: { title: 'Terminal runs (E7, E2)', precedence: 'Unverified completion or ancestry refreshes; stale reviewed SHAs (E7) precede failures (E2); completions need triage and delta review.' },
  R11: { title: 'Consumed request without a run (E4, fallback)', precedence: 'A submitted, accepted, or ambiguous request waits ten minutes, then takes the comment fallback or E4. Yields to R13 while this observation holds an in-progress reservation.' },
  R12: { title: 'Pre-trigger prerequisites', precedence: 'Before a reservation or trigger: refs, heads, base, clean tree, local review, human feedback, labels. Yields to R13 while this observation holds an unconfirmed or losing reservation.' },
  R13: { title: 'Reservation arbitration and trigger', precedence: 'Earliest running-account marker wins; only a fresh confirmed owner may trigger.' },
  R14: { title: 'Readiness', precedence: 'All local gates plus a satisfied Greptile basis make the snapshot ready-eligible.' },
} as const;

export type RowId = keyof typeof ROWS;

export interface RuleSpec {
  row: RowId;
  title: string;
  action: LifecycleAction;
  next: ContinueNext | null;
  policyRef: string;
  /** Name of the test scenario that reaches this rule. */
  scenario: string;
}

const SRC = {
  greptileOnce: policyRef('L62-L68'),
  draftOnce: policyRef('L58-L60'),
  applicability: policyRef('L131-L171'),
  waiverExtension: policyRef('L173-L186'),
  terminal: policyRef('L194-L194'),
  restrictions: policyRef('L210-L216'),
  readyPr: policyRef('L218-L227'),
  detection: policyRef('L286-L341'),
  manualCheckpoint: policyRef('L516-L536'),
  reuseRun: policyRef('L588-L602'),
  preTrigger: policyRef('L604-L608'),
  labels: policyRef('L610-L631'),
  arbitration: policyRef('L633-L672'),
  monitoring: policyRef('L708-L720'),
  fallback: policyRef('L722-L740'),
  completion: policyRef('L753-L769'),
  exits: policyRef('L771-L808'),
  e1: policyRef('L810-L851'),
  e2: policyRef('L852-L858'),
  e4: policyRef('L860-L871'),
  e6: policyRef('L873-L880'),
  e7: policyRef('L882-L888'),
  triage: policyRef('L939-L951'),
  readiness: policyRef('L956-L1014'),
  validation: policyRef('L103-L111'),
} as const;

function rule(row: RowId, title: string, action: LifecycleAction, next: ContinueNext | null, ref: string, scenario: string): RuleSpec {
  return { row, title, action, next, policyRef: ref, scenario };
}

export const RULES: Readonly<Record<RuleId, RuleSpec>> = {
  'R01.invalid-input': rule('R01', 'Input violates the version 1 contract', 'continue', 'refresh-evidence', SRC.validation, 'invalid input: wrong version is a contract diagnostic'),
  'R01.subject-mismatch': rule('R01', 'Evidence is bound to another subject', 'continue', 'refresh-evidence', SRC.validation, 'invalid input: evidence bound to another PR'),
  'R02.terminal-pr': rule('R02', 'PR is closed or merged', 'continue', 'no-op', SRC.terminal, 'terminal: merged PR is a no-op'),
  'R03.already-prepared': rule('R03', 'Ready PR passes every current gate', 'continue', 'already-prepared', SRC.readyPr, 'ready PR: complete gates report already prepared'),
  'R03.incomplete-preparation': rule('R03', 'Ready PR has an unmet gate', 'continue', 'incomplete-preparation', SRC.readyPr, 'ready PR: missing gates report incomplete preparation'),
  'R04.restrictions-unknown': rule('R04', 'Receipts are not known, so restrictions cannot be ruled out', 'continue', 'refresh-evidence', SRC.restrictions, 'restrictions: unknown receipts block'),
  'R04.manual-testing': rule('R04', 'Required user testing is pending', 'wait', null, SRC.manualCheckpoint, 'restrictions: pending manual testing waits'),
  'R04.restriction': rule('R04', 'A recorded restriction is unresolved', 'wait', null, SRC.restrictions, 'restrictions: draft-push conflict holds until resolved'),
  'R04.stay-draft': rule('R04', 'A stay-draft answer covers the current edge', 'wait', null, SRC.exits, 'restrictions: stay-draft answer holds on an unchanged edge'),
  'R04.resolution-unverified': rule('R04', 'A resolving receipt has no verified ancestry', 'continue', 'refresh-evidence', SRC.restrictions, 'restrictions: resolution on unverified lineage refreshes ancestry'),
  'R05.applicability-unresolved': rule('R05', 'Applicability cannot be determined', 'continue', 'refresh-evidence', SRC.applicability, 'applicability: unclassified diff is unresolved'),
  'R05.policy-change': rule('R05', 'The PR changes Greptile policy files', 'ask', null, SRC.applicability, 'applicability: marker change asks for a policy decision'),
  'R05.skip-acknowledgment': rule('R05', 'Greptile cannot review this PR', 'ask', null, SRC.labels, 'applicability: app not installed needs acknowledgment'),
  'R06.E1': rule('R06', 'Marking ready would start a second run', 'ask', null, SRC.e1, 'E1: ready transition would start a second run'),
  'R06.config-pause': rule('R06', 'E1 (a) configuration change has not landed at both tips', 'wait', null, SRC.e1, 'E1: configuration pause waits before the trigger'),
  'R07.waiver-full-review': rule('R07', 'E7 (a) waiver lacks its full base-to-head review', 'continue', 'local-review', SRC.e7, 'waiver: E7 (a) needs the full-diff review first'),
  'R07.waiver-triage': rule('R07', 'Waiver lacks triage of findings the run already posted', 'continue', 'triage', SRC.waiverExtension, 'waiver: E2 (a) needs posted findings triaged first'),
  'R08.history-unresolved': rule('R08', 'Greptile request or run history is not complete', 'continue', 'refresh-evidence', SRC.arbitration, 'history: missing comment page refreshes'),
  'R08.run-contradiction': rule('R08', 'Observations of one run contradict each other', 'continue', 'refresh-evidence', SRC.completion, 'history: contradictory run status refreshes'),
  'R09.monitor-run': rule('R09', 'A known run is pending inside ten minutes', 'wait', null, SRC.monitoring, 'pending run: monitored before ten minutes'),
  'R09.chosen-wait': rule('R09', 'A pending run is inside the user-chosen wait', 'wait', null, SRC.e6, 'pending run: chosen wait budget holds'),
  'R09.E6': rule('R09', 'A known run is still incomplete', 'ask', null, SRC.e6, 'E6: run still incomplete at ten minutes'),
  'R10.completion-unverified': rule('R10', 'A completed run lacks bot identity or SHA correlation', 'continue', 'refresh-evidence', SRC.completion, 'completion: success without bot correlation is unverified'),
  'R10.ancestry-unresolved': rule('R10', 'A reviewed SHA has no full-history ancestry result', 'continue', 'refresh-evidence', SRC.reuseRun, 'completion: shallow ancestry is unresolved'),
  'R10.E7': rule('R10', 'The reviewed commit is no longer in this branch', 'ask', null, SRC.e7, 'E7: reviewed commit missing from full history'),
  'R10.E2': rule('R10', 'A failed or cancelled run consumed the allowance', 'ask', null, SRC.e2, 'E2: failed run consumed the allowance'),
  'R10.triage': rule('R10', 'Completed run findings are not dispositioned', 'continue', 'triage', SRC.triage, 'completion: undispositioned findings need triage'),
  'R10.delta-review': rule('R10', 'Changes after a reviewed SHA lack local review', 'continue', 'local-review', SRC.triage, 'completion: delta since reviewed SHA needs local review'),
  'R11.monitor-request': rule('R11', 'A consumed request is inside ten minutes', 'wait', null, SRC.fallback, 'request: confirmed comment monitored before ten minutes'),
  'R11.E4': rule('R11', 'No observable run after an MCP request', 'ask', null, SRC.e4, 'E4: MCP request with no observable run at ten minutes'),
  'R11.triage': rule('R11', 'Feedback that arrived without a run is not dispositioned', 'continue', 'triage', SRC.triage, 'request: runless feedback needs triage before the fallback'),
  'R12.refs-unresolved': rule('R12', 'Head, base, or local gate evidence is not resolved', 'continue', 'refresh-evidence', SRC.preTrigger, 'pre-trigger: unknown refs refresh'),
  'R12.reconcile-head': rule('R12', 'Local, remote, and PR heads differ', 'continue', 'reconcile-head', SRC.preTrigger, 'pre-trigger: local and PR heads differ'),
  'R12.integrate-base': rule('R12', 'The base tip is not in the pushed head', 'continue', 'integrate-base', SRC.preTrigger, 'pre-trigger: moved base needs integration'),
  'R12.worktree': rule('R12', 'In-scope work is uncommitted', 'continue', 'resolve-local-gates', SRC.readiness, 'pre-trigger: uncommitted in-scope work'),
  'R12.local-review': rule('R12', 'Local review, tests, or plan completion are not current', 'continue', 'local-review', SRC.preTrigger, 'pre-trigger: local review incomplete'),
  'R12.human-feedback': rule('R12', 'A blocking human review is unresolved', 'continue', 'resolve-restriction', SRC.readiness, 'pre-trigger: blocking human review'),
  'R12.labels-unverified': rule('R12', 'Required labels cannot be verified', 'continue', 'resolve-label-evidence', SRC.labels, 'pre-trigger: label application failed'),
  'R12.apply-labels': rule('R12', 'A required label is missing', 'continue', 'apply-required-labels', SRC.labels, 'pre-trigger: required label missing'),
  'R13.reservation-unconfirmed': rule('R13', 'This session\'s reservation is not confirmed', 'continue', 'refresh-evidence', SRC.arbitration, 'reservation: unconfirmed post refreshes'),
  'R13.reservation-lost': rule('R13', 'An earlier marker holds the reservation', 'wait', null, SRC.arbitration, 'reservation: later session monitors the winner'),
  'R13.record-reservation': rule('R13', 'No reservation exists yet', 'continue', 'record-reservation', SRC.arbitration, 'reservation: none yet, record one'),
  'R13.trigger': rule('R13', 'Fresh confirmed owner of the earliest reservation', 'trigger', null, SRC.arbitration, 'reservation: fresh owner may trigger'),
  'R14.refs-unresolved': rule('R14', 'Head, base, or local gate evidence is not resolved', 'continue', 'refresh-evidence', SRC.readiness, 'readiness: unknown local gates refresh'),
  'R14.reconcile-head': rule('R14', 'Local, remote, and PR heads differ', 'continue', 'reconcile-head', SRC.readiness, 'readiness: remote head differs'),
  'R14.integrate-base': rule('R14', 'The base moved or the PR conflicts', 'continue', 'integrate-base', SRC.readiness, 'readiness: merge conflict needs base integration'),
  'R14.worktree': rule('R14', 'In-scope work is uncommitted', 'continue', 'resolve-local-gates', SRC.readiness, 'readiness: uncommitted in-scope work'),
  'R14.local-review': rule('R14', 'Local review, tests, or plan completion are not current', 'continue', 'local-review', SRC.readiness, 'readiness: tests stale for current tree'),
  'R14.human-feedback': rule('R14', 'A blocking human review is unresolved', 'continue', 'resolve-restriction', SRC.readiness, 'readiness: blocking human review'),
  'R14.mergeable-unknown': rule('R14', 'GitHub mergeability is unknown', 'continue', 'refresh-evidence', SRC.readiness, 'readiness: mergeability unknown'),
  'R14.unresolved-decisions': rule('R14', 'A required decision is open', 'continue', 'resolve-local-gates', SRC.readiness, 'readiness: open scope decision'),
  'R14.ready-eligible': rule('R14', 'Every gate holds for this snapshot', 'ready-eligible', null, SRC.readiness, 'readiness: completed run and all gates'),
};

export const RULE_IDS = Object.keys(RULES) as RuleId[];

/** What each `continue.next` asks the caller to do. */
export const CONTINUE_NEXT: Readonly<Record<ContinueNext, string>> = {
  'refresh-evidence': 'Collect the named evidence again; for a contract diagnostic, repair the adapter instead of refetching.',
  'no-op': 'Do nothing; the PR is closed or merged.',
  'already-prepared': 'Report the ready PR as prepared and regenerate the handoff from verified evidence.',
  'incomplete-preparation': 'Report incomplete preparation; leave the PR ready and withhold the success handoff.',
  'record-reservation': 'Post the reservation comment, read it back, and journal confirmed-unattempted ownership.',
  'integrate-base': 'Merge the verified base into the feature branch, then review and test the result.',
  'reconcile-head': 'Bring local HEAD, the remote branch, and the PR head to one pushed SHA.',
  'apply-required-labels': 'Apply the declared required labels before the first trigger.',
  'resolve-label-evidence': 'Report the label blocker; never fall back to the other transport.',
  'local-review': 'Run or refresh local review, tests, and plan completion for the current tree.',
  triage: 'Triage the named run\'s findings and record dispositions.',
  'resolve-restriction': 'Resolve the named blocking feedback or restriction before continuing.',
  'resolve-local-gates': 'Commit and push in-scope work or settle the open decisions named in diagnostics.',
};

export const CONTINUE_NEXTS = Object.keys(CONTINUE_NEXT) as ContinueNext[];
export const ACTIONS: readonly LifecycleAction[] = ['trigger', 'wait', 'ask', 'continue', 'ready-eligible'];

// ─── Exit and policy questions ────────────────────────────────────────────

export interface OptionSpec {
  id: OptionId;
  label: string;
  consequence: string;
  effect: OptionEffect;
  recommended: boolean;
}

export interface QuestionSpec {
  title: string;
  policyRef: string;
  options: readonly OptionSpec[];
}

const stayDraft = (id: OptionId, consequence = 'Preparation stops and the PR stays draft. A stay-draft answer never grants a waiver.'): OptionSpec =>
  ({ id, label: 'Stay draft', consequence, effect: 'stay-draft', recommended: false });

/** Every question the core can ask, with its exact named options, recommended first. There is no E3 or E5. */
export const QUESTIONS: Readonly<Record<QuestionCode, QuestionSpec>> = {
  E1: {
    title: 'Marking ready would start a second run.',
    policyRef: SRC.e1,
    options: [
      { id: 'a', label: 'Pause for a one-time configuration change', consequence: 'Set "autoReview": [] in the named file on the base branch. That turns off automatic reviews for every PR in the repository; explicit requests, including this workflow\'s, still work. The edit is never made for you.', effect: 'configuration-pause', recommended: true },
      { id: 'b', label: 'Waive Greptile for this PR', consequence: 'Greptile may still review automatically when the PR is marked ready. That run is this PR\'s only one, and neither this workflow nor /ship-and-land triages it.', effect: 'affirmative-waiver', recommended: false },
      stayDraft('c'),
    ],
  },
  E2: {
    title: 'A failed or cancelled run consumed the allowance.',
    policyRef: SRC.e2,
    options: [
      { id: 'a', label: 'Triage posted findings, waive Greptile for this PR, and continue on local review', consequence: 'The waiver cites the run ID and status. The consumed run is never reset or retried.', effect: 'affirmative-waiver', recommended: true },
      stayDraft('b', 'A resume re-checks that same run and never retries.'),
    ],
  },
  E4: {
    title: 'No observable run after an MCP request.',
    policyRef: SRC.e4,
    options: [
      { id: 'a', label: 'Proceed as unverified', consequence: 'Record "Greptile: unverified — no response after 10 minutes (MCP request with no observable run; user decision <reference>)". The reservation stays the PR\'s only allowance; feedback that arrives before readiness is still triaged.', effect: 'unverified-permission', recommended: true },
      stayDraft('b'),
    ],
  },
  E6: {
    title: 'A known run is still incomplete.',
    policyRef: SRC.e6,
    options: [
      { id: 'a', label: 'Keep waiting', consequence: 'Record "wait until <UTC>" (10 minutes by default, or the interval you name); asked again only after it passes.', effect: 'wait', recommended: true },
      { id: 'b', label: 'Waive Greptile for this PR', consequence: 'The run\'s later results will not be triaged.', effect: 'affirmative-waiver', recommended: false },
      stayDraft('c'),
    ],
  },
  E7: {
    title: 'The reviewed commit is no longer in this branch.',
    policyRef: SRC.e7,
    options: [
      { id: 'a', label: 'Review the full diff, triage the stale run, then waive', consequence: 'Run /review on the full base-to-head diff (not a delta), triage the stale run\'s findings against current code, then waive Greptile citing the stale SHA.', effect: 'affirmative-waiver', recommended: true },
      stayDraft('b'),
    ],
  },
  'POLICY-CHANGE': {
    title: 'This PR changes Greptile review policy.',
    policyRef: SRC.applicability,
    options: [
      { id: 'a', label: 'Keep Greptile review for this PR', consequence: 'The documented default: Greptile applies under the changed policy.', effect: 'policy-retain', recommended: true },
      { id: 'b', label: 'Disable Greptile review for this PR', consequence: 'Recorded as "Greptile: skipped — user policy decision <reference>".', effect: 'policy-disable', recommended: false },
    ],
  },
  'SKIP-ACK': {
    title: 'Greptile cannot review this PR.',
    policyRef: SRC.labels,
    options: [
      { id: 'a', label: 'Acknowledge and record the skip', consequence: 'Recorded as "Greptile: skipped — app not installed" or "Greptile: skipped — excluded by <source> <key>".', effect: 'acknowledge-skip', recommended: true },
      stayDraft('b'),
    ],
  },
};

export function optionSpec(question: QuestionCode, option: OptionId): OptionSpec | null {
  return QUESTIONS[question].options.find(o => o.id === option) ?? null;
}

/** Affirmative applicability waivers under the Step 1 extension: E1 (b), E2 (a), E6 (b), E7 (a). */
export const AFFIRMATIVE_WAIVERS: readonly { question: 'E1' | 'E2' | 'E6' | 'E7'; option: OptionId }[] = [
  { question: 'E1', option: 'b' },
  { question: 'E2', option: 'a' },
  { question: 'E6', option: 'b' },
  { question: 'E7', option: 'a' },
];

// ─── Policy-to-scenario map ───────────────────────────────────────────────

/** Reconstructed policy examples. Synthetic: no production incident data is claimed. */
export const ORIGINAL_HISTORIES = [
  'synthetic: accepted but invisible submission',
  'synthetic: crash between reservation and trigger',
  'synthetic: concurrent sessions on both transports',
  'synthetic: late run after fallback',
  'synthetic: rewritten history on a shallow clone',
  'synthetic: older receipt',
] as const;

export interface PolicyArea {
  title: string;
  policyRef: string;
  rows: readonly RowId[];
  questions: readonly QuestionCode[];
  histories: readonly (typeof ORIGINAL_HISTORIES)[number][];
}

/** Plain-language map from policy areas to rows, questions, and recorded histories. */
export const POLICY_MAP: Readonly<Record<string, PolicyArea>> = {
  'input-binding': { title: 'Observation contract and subject binding', policyRef: SRC.validation, rows: ['R01'], questions: [], histories: [] },
  'draft-once': { title: 'Terminal and already-ready PRs', policyRef: SRC.draftOnce, rows: ['R02', 'R03'], questions: [], histories: [] },
  restrictions: { title: 'Manual testing and recorded restrictions', policyRef: SRC.restrictions, rows: ['R04'], questions: [], histories: ['synthetic: older receipt'] },
  applicability: { title: 'Greptile applicability (Step 1)', policyRef: SRC.applicability, rows: ['R05', 'R07'], questions: ['POLICY-CHANGE', 'SKIP-ACK'], histories: [] },
  'second-run-safeguard': { title: 'Ready transition must not start a second run', policyRef: SRC.detection, rows: ['R06'], questions: ['E1'], histories: [] },
  'request-history': { title: 'Greptile-once request and run history', policyRef: SRC.greptileOnce, rows: ['R08'], questions: [], histories: ['synthetic: older receipt'] },
  'run-monitoring': { title: 'Pending runs', policyRef: SRC.monitoring, rows: ['R09'], questions: ['E6'], histories: ['synthetic: late run after fallback'] },
  completion: { title: 'Completion, ancestry, and failures', policyRef: SRC.completion, rows: ['R10'], questions: ['E2', 'E7'], histories: ['synthetic: rewritten history on a shallow clone'] },
  'no-response': { title: 'Consumed requests without a run', policyRef: SRC.fallback, rows: ['R11'], questions: ['E4'], histories: ['synthetic: accepted but invisible submission', 'synthetic: crash between reservation and trigger', 'synthetic: late run after fallback'] },
  'pre-trigger': { title: 'Prerequisites before the single trigger', policyRef: SRC.preTrigger, rows: ['R12'], questions: [], histories: [] },
  'reservation-ownership': { title: 'Reservation arbitration and fresh ownership', policyRef: SRC.arbitration, rows: ['R13'], questions: [], histories: ['synthetic: crash between reservation and trigger', 'synthetic: concurrent sessions on both transports'] },
  readiness: { title: 'Final readiness gate', policyRef: SRC.readiness, rows: ['R14'], questions: [], histories: [] },
};

// ─── Configuration normalization ─────────────────────────────────────────

export type TriggerEvent = 'open' | 'push' | 'rebase';
const EVENTS: readonly TriggerEvent[] = ['open', 'push', 'rebase'];

/** Root marker paths, including a root `.greptile` entry that is not a directory. A `.greptile/` marker needs a file beneath it. */
export function isRootMarkerPath(path: string): boolean {
  return path === 'greptile.json' || path === '.greptile.json' || path === '.greptile' || path.startsWith('.greptile/');
}

export function hasRootMarker(tip: TipConfig): boolean {
  return tip.greptileJson !== null || tip.dotGreptileJson !== null
    || (tip.dotGreptileDir !== null && (tip.dotGreptileDir.configJson !== null || tip.dotGreptileDir.files.length > 0));
}

/** Expand implied events: `push` includes `open`; `rebase` includes `push` and `open`. */
export function normalizeEvents(list: readonly TriggerEvent[]): TriggerEvent[] {
  const set = new Set(list);
  if (set.has('rebase')) set.add('push');
  if (set.has('push')) set.add('open');
  return EVENTS.filter(e => set.has(e));
}

/** `null` when the value is not a list of documented event names. */
export function parseEventList(value: unknown): TriggerEvent[] | null {
  if (!Array.isArray(value)) return null;
  const out: TriggerEvent[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !EVENTS.includes(item as TriggerEvent)) return null;
    out.push(item as TriggerEvent);
  }
  return normalizeEvents(out);
}

export type TipTrigger =
  | { kind: 'list'; source: string; events: TriggerEvent[] }
  | { kind: 'unverified'; source: string; why: 'missing' | 'unreadable' | 'dotted-only' | 'invalid' | 'conflicting' };

function parseObject(content: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(content);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    // Unparseable JSON is the documented "unreadable" state, not a safe default.
    return null;
  }
}

/** Effective file at a tip: `.greptile/config.json`, otherwise `greptile.json`. */
export function effectiveFile(tip: TipConfig): { path: string; content: string | null } | null {
  const nested = tip.dotGreptileDir?.configJson ?? null;
  if (nested) return { path: '.greptile/config.json', content: nested.readable ? nested.content : null };
  if (tip.greptileJson) return { path: 'greptile.json', content: tip.greptileJson.readable ? tip.greptileJson.content : null };
  return null;
}

/** The trigger list one tip's effective file declares, with legacy keys normalized. */
export function tipTrigger(tip: TipConfig, side: 'base' | 'head'): TipTrigger {
  const file = effectiveFile(tip);
  if (!file) {
    if (tip.dotGreptileJson) return { kind: 'unverified', source: `${side}:.greptile.json`, why: 'dotted-only' };
    return { kind: 'unverified', source: `${side}:(no effective file)`, why: 'missing' };
  }
  const source = `${side}:${file.path}`;
  const obj = file.content === null ? null : parseObject(file.content);
  if (!obj) return { kind: 'unverified', source, why: 'unreadable' };
  const lists: TriggerEvent[][] = [];
  if ('autoReview' in obj) {
    const events = parseEventList(obj.autoReview);
    if (!events) return { kind: 'unverified', source, why: 'invalid' };
    lists.push(events);
  }
  if ('triggerOnUpdates' in obj) {
    if (typeof obj.triggerOnUpdates !== 'boolean') return { kind: 'unverified', source, why: 'invalid' };
    lists.push(obj.triggerOnUpdates ? ['open', 'push', 'rebase'] : ['open']);
  }
  if ('skipReview' in obj) {
    if (obj.skipReview !== 'AUTOMATIC') return { kind: 'unverified', source, why: 'invalid' };
    lists.push([]);
  }
  if (lists.length === 0) return { kind: 'list', source, events: ['open'] };
  const first = lists[0] ?? [];
  if (lists.some(l => l.join(',') !== first.join(','))) return { kind: 'unverified', source, why: 'conflicting' };
  return { kind: 'list', source, events: first };
}

export interface Detection {
  /** `excluded`: the ready transition starts no automatic run. */
  kind: 'excluded' | 'will-start' | 'cannot-rule-out';
  /** Verified settings, or both tips' valid lists, exclude `push` and `rebase` (E1 (b) availability). */
  pushRebaseExcluded: boolean;
  /** Deterministic source/value facts, e.g. `head:greptile.json=open`. */
  facts: string[];
  verified: boolean;
}

function describe(t: TipTrigger): string {
  return t.kind === 'list' ? `${t.source}=[${t.events.join(',')}]` : `${t.source}:${t.why}`;
}

/** Step 1's ready-transition detection over verified settings or both tips. */
export function detectReadyTrigger(config: ConfigFacts): Detection {
  const verified = config.verifiedSettings;
  if (verified) {
    if (verified.exclusion) {
      return { kind: 'excluded', pushRebaseExcluded: true, facts: [`verified:${verified.source}:excluded`], verified: true };
    }
    const events = parseEventList(verified.autoReview);
    if (!events) return { kind: 'cannot-rule-out', pushRebaseExcluded: false, facts: [`verified:${verified.source}:invalid`], verified: true };
    const facts = [`verified:${verified.source}=[${events.join(',')}]`];
    return { kind: events.includes('open') ? 'will-start' : 'excluded', pushRebaseExcluded: !events.includes('push'), facts, verified: true };
  }
  const base = tipTrigger(config.base, 'base');
  const head = tipTrigger(config.head, 'head');
  const facts = [describe(base), describe(head)];
  if (base.kind === 'list' && head.kind === 'list') {
    const pushRebaseExcluded = !base.events.includes('push') && !head.events.includes('push');
    if (!base.events.includes('open') && !head.events.includes('open')) return { kind: 'excluded', pushRebaseExcluded, facts, verified: false };
    if (base.events.includes('open') && head.events.includes('open')) return { kind: 'will-start', pushRebaseExcluded, facts, verified: false };
    return { kind: 'cannot-rule-out', pushRebaseExcluded, facts, verified: false };
  }
  return { kind: 'cannot-rule-out', pushRebaseExcluded: false, facts, verified: false };
}

/** E1 (a) destination: the base effective file, else `.greptile/config.json` when `.greptile/` exists, else `greptile.json`. */
export function remedyFile(config: ConfigFacts): string {
  const file = effectiveFile(config.base);
  if (file) return file.path;
  return config.base.dotGreptileDir ? '.greptile/config.json' : 'greptile.json';
}

/** C0/C1 controls and Unicode line/paragraph separators. */
export const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

const MAX_LABEL_LENGTH = 50;

/** A plausible GitHub label name: 1–50 characters with no control or line-separator characters. */
export function isLabelName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_LABEL_LENGTH && !CONTROL_CHARACTER.test(value);
}

/**
 * Required labels (`labels` key) from exposed verified settings, else the
 * head's effective file, else `.greptile.json` as declared intent. When the
 * head has no configuration (a removed marker), the base tip's is read the
 * same way. A value that is not a plausible label name leaves the requirement
 * unverified.
 */
export function requiredLabels(config: ConfigFacts): { kind: 'labels'; labels: string[]; source: string } | { kind: 'unverified'; source: string } {
  const verified = config.verifiedSettings;
  if (verified && verified.requiredLabels !== null) {
    const source = `verified:${verified.source}`;
    if (!verified.requiredLabels.every(isLabelName)) return { kind: 'unverified', source };
    return { kind: 'labels', labels: [...verified.requiredLabels].sort(), source };
  }
  const declared = (tip: TipConfig) => effectiveFile(tip)
    ?? (tip.dotGreptileJson ? { path: '.greptile.json', content: tip.dotGreptileJson.readable ? tip.dotGreptileJson.content : null } : null);
  const head = declared(config.head);
  const base = head ? null : declared(config.base);
  const chosen = head ?? base;
  if (!chosen) return { kind: 'labels', labels: [], source: 'head:(no configuration)' };
  const source = `${head ? 'head' : 'base'}:${chosen.path}`;
  const obj = chosen.content === null ? null : parseObject(chosen.content);
  if (!obj) return { kind: 'unverified', source };
  if (!('labels' in obj)) return { kind: 'labels', labels: [], source };
  const labels = obj.labels;
  if (!Array.isArray(labels) || !labels.every(isLabelName)) return { kind: 'unverified', source };
  return { kind: 'labels', labels: [...new Set(labels as string[])].sort(), source };
}

/** Root marker paths whose presence or readable content differs between two tips. */
export function markerChanges(base: TipConfig, head: TipConfig): string[] {
  const sig = (f: ConfigFile | null): string => (f === null ? 'absent' : f.readable ? `content:${f.content}` : 'unreadable');
  const changed = new Set<string>();
  if (sig(base.greptileJson) !== sig(head.greptileJson)) changed.add('greptile.json');
  if (sig(base.dotGreptileJson) !== sig(head.dotGreptileJson)) changed.add('.greptile.json');
  if (sig(base.dotGreptileDir?.configJson ?? null) !== sig(head.dotGreptileDir?.configJson ?? null)) changed.add('.greptile/config.json');
  const baseFiles = new Set(base.dotGreptileDir?.files ?? []);
  const headFiles = new Set(head.dotGreptileDir?.files ?? []);
  for (const path of [...baseFiles, ...headFiles]) if (baseFiles.has(path) !== headFiles.has(path)) changed.add(path);
  return [...changed].sort();
}

/** Root marker paths (and the documented docs policy file) the PR adds, removes, renames, or edits. */
export function policyFileChanges(diff: DiffFacts): string[] {
  const docsPolicy = diff.docsPolicy.kind === 'documented' ? diff.docsPolicy.path : null;
  const hit = new Set<string>();
  for (const file of diff.files) {
    for (const path of [file.path, file.previousPath]) {
      if (path === null) continue;
      if (isRootMarkerPath(path) || path === docsPolicy) hit.add(path);
    }
  }
  return [...hit].sort();
}

/**
 * Docs-only classification over the whole intended diff. Agent instructions,
 * code, configuration, build, test, symlink, or submodule changes make it
 * mixed. An empty diff is its own state: it never skips review silently.
 */
export function classifyDiff(diff: DiffFacts): 'docs-only' | 'mixed' | 'unclassified' | 'empty' {
  if (diff.files.length === 0) return 'empty';
  if (diff.files.some(f => f.contentClass === 'unclassified')) return 'unclassified';
  const docs = diff.files.every(f => f.entryKind === 'file' && (f.contentClass === 'prose' || f.contentClass === 'doc-asset'));
  return docs ? 'docs-only' : 'mixed';
}

/** Option-effect lookup used by tests and callers rendering a recorded answer. */
export function effectOf(question: QuestionCode, option: OptionId): OptionEffect | null {
  return optionSpec(question, option)?.effect ?? null;
}
