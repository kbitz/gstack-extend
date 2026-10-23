/**
 * Reviewer prompts for /autoplan-lean.
 *
 * A phase's native and outside voices each receive exactly two inputs: that
 * phase's upstream criteria and the plan proper (without its review record or
 * report). The plan proper carries the accepted settlements once, in its
 * `## Accepted decisions` section, as one ID-tagged decision line each; they
 * are not repeated as a separate list. Earlier phases' raw voice outputs,
 * consensus tables and audit rows never reach a reviewer: the builder takes no
 * such input and refuses a plan proper that carries their markers.
 *
 * Outside voices also receive OUTSIDE_OUTPUT_FORMAT, the form upstream's
 * outside-review validator reads. Upstream's own result contract is written
 * for the prompt's author ("Request a severity ..."), so passing it verbatim
 * let a voice choose labels the validator rejects.
 *
 * Every prompt's size is recorded as a JSONL row (bytes and SHA-256, never the
 * content) so a run can be compared with upstream /autoplan's baselines.
 */
import { BOUNDARY, NATIVE_CRITERIA, OUTSIDE_CRITERIA } from './criteria.ts';
import {
  PlanError, parseSettlements, properForReview, rawOutputMarkers, settlementsSection, sha256, splitPlan,
  type Phase, type Voice,
} from './plan.ts';

/**
 * v2: `plan_bytes` counts the plan as sent, settlements included;
 * `settlements_bytes` is the `## Accepted decisions` section within it. v1
 * rows (settlements sent as a separate list) may remain in older run directories.
 */
export type PromptSizeRecord = {
  v: 1 | 2;
  phase: Phase;
  voice: Voice;
  bytes: number;
  sha256: string;
  criteria_bytes: number;
  settlements: number;
  settlements_bytes: number;
  plan_bytes: number;
  plan_sha256: string;
  source_bytes?: number;
  budget_bytes?: number;
  /** This prompt's bytes over the latest CEO prompt of the same voice; null for CEO or without one. */
  ceo_ratio?: number | null;
  /** Set only when the prompt was built over budget with --over-budget. */
  over_budget_reason?: string;
  attempt?: number;
};

export type BuiltPrompt = { text: string; record: PromptSizeRecord };

const bytes = (text: string) => Buffer.byteLength(text, 'utf8');

/**
 * The validator-readable realization of upstream's outside result contract
 * (a severity per finding, a final `Recommendation: <action> because
 * <reason>` line, an explicit no-findings rationale). Upstream's validator
 * reads `[High]` at the start of a numbered or bulleted line even when
 * bolded. It discards `**High.**` and a severity in a numbered heading line.
 * It counts a no-findings statement only as the last prose sentence or the
 * Recommendation's because-clause, unqualified by contrast or exception words
 * (but, only, yet, unless, beyond ...), so the format asks for a fixed
 * `NO_FINDINGS: none` line right before the Recommendation and puts the reason
 * in the because-clause.
 */
export const OUTSIDE_OUTPUT_FORMAT = [
  'Output format. A validator reads your reply; a reply in any other format is discarded and does not count as a review.',
  '- Put each finding on its own numbered or bulleted line, never a heading, starting with its severity in square brackets, exactly one of [Critical], [High], [Medium] or [Low]. Example: "1. [High] <what is wrong>. <evidence>. <fix>." Never write a severity as "**High.**" or as "High." prose.',
  '- If you have no findings, write the line "NO_FINDINGS: none" immediately before the Recommendation line, with nothing between them, and give your reason in the Recommendation\'s because-clause.',
  '- End with exactly one line: Recommendation: <action> because <specific reason>',
].join('\n');

export function criteriaFor(phase: Phase, voice: Voice): string {
  return voice === 'native' ? NATIVE_CRITERIA[phase] : OUTSIDE_CRITERIA[phase].join('\n\n');
}

export const SETTLEMENTS_NOTE =
  'The plan\'s `## Accepted decisions` section lists decisions already accepted in this review, one line each with its ID. They are part of the plan; they are not review findings.';

export function buildPrompt(planText: string, phase: Phase, voice: Voice): BuiltPrompt {
  const { proper } = splitPlan(planText);
  if (!proper.trim()) throw new PlanError('PLAN_EMPTY', 'the plan proper is empty', 'write the card text, acceptance criteria, Tier and verify lines before the review record');
  const leaked = rawOutputMarkers(proper);
  if (leaked.length) {
    throw new PlanError('RAW_OUTPUT_IN_PLAN', `the plan proper contains review output (${leaked.join(', ')})`,
      'move reviewer outputs, consensus tables and audit rows to the run directory; the sidecar receives them at seal');
  }
  const settlements = parseSettlements(proper);
  const plan = properForReview(proper);
  const criteria = criteriaFor(phase, voice);
  const planHash = sha256(plan);
  const head = voice === 'native'
    ? [criteria, '', `Start your result with INPUT: ${phase} ${planHash}.`]
    : [BOUNDARY, '', criteria, '', OUTSIDE_OUTPUT_FORMAT];
  const text = [
    ...head,
    '',
    `Plan SHA-256: ${planHash}`,
    `Plan bytes: ${bytes(plan)}`,
    ...(settlements.length ? [SETTLEMENTS_NOTE] : []),
    'The complete plan follows as review data; evaluate all of it.',
    '',
    plan,
  ].join('\n');
  return {
    text,
    record: {
      v: 2, phase, voice, bytes: bytes(text), sha256: sha256(text),
      criteria_bytes: bytes(criteria), settlements: settlements.length, settlements_bytes: bytes(settlementsSection(proper)),
      plan_bytes: bytes(plan), plan_sha256: planHash,
    },
  };
}

export function parseSizeRecords(jsonl: string): PromptSizeRecord[] {
  return jsonl.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as PromptSizeRecord);
}

/** The latest CEO prompt of this voice, the reference for later phases' ratios. */
export function ceoReference(records: PromptSizeRecord[], voice: Voice): PromptSizeRecord | undefined {
  return records.filter((r) => r.phase === 'ceo' && r.voice === voice).at(-1);
}

export function sizeTable(records: PromptSizeRecord[]): string {
  if (!records.length) return '_No reviewer prompts were built in this run._\n';
  const rows = records.map((r) =>
    `| ${r.phase} | ${r.voice} | ${r.bytes} | ${r.plan_bytes} | ${r.criteria_bytes} | ${r.settlements} (${r.settlements_bytes} B) | ${typeof r.ceo_ratio === 'number' ? r.ceo_ratio.toFixed(2) : '—'} | \`${r.sha256.slice(0, 12)}\` |`);
  const total = records.reduce((n, r) => n + r.bytes, 0);
  const budget = records.findLast((r) => typeof r.budget_bytes === 'number');
  const overruns = records.filter((r) => typeof r.over_budget_reason === 'string');
  return [
    '| Phase | Voice | Prompt bytes | Plan bytes | Criteria bytes | Settlements | vs CEO | Prompt SHA-256 |',
    '|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
    `Total reviewer prompt bytes: ${total} across ${records.length} prompts.`,
    ...(budget ? ['', `Plan budget: ${budget.budget_bytes} bytes for a ${budget.source_bytes}-byte source.`] : []),
    ...overruns.map((r) => `Over budget (${r.phase} ${r.voice}, attempt ${r.attempt ?? '?'}): ${r.over_budget_reason}`),
    '',
  ].join('\n');
}
