/**
 * Reviewer prompts for /autoplan-lean.
 *
 * A phase's native and outside voices each receive exactly three inputs: that
 * phase's upstream criteria, the accepted settlements of earlier phases as a
 * short tagged list, and the plan proper (without its settlements section,
 * review record or report). Earlier phases' raw voice outputs, consensus
 * tables and audit rows never reach a reviewer: the builder takes no such
 * input and refuses a plan proper that carries their markers.
 *
 * Every prompt's size is recorded as a JSONL row (bytes and SHA-256, never the
 * content) so a run can be compared with upstream /autoplan's baselines.
 */
import { BOUNDARY, NATIVE_CRITERIA, OUTSIDE_CRITERIA, OUTSIDE_RESULT_CONTRACT } from './criteria.ts';
import {
  PlanError, parseSettlements, phaseIndex, properWithoutSettlements, rawOutputMarkers, sha256, splitPlan,
  type Phase, type Settlement, type Voice,
} from './plan.ts';

export type PromptSizeRecord = {
  v: 1;
  phase: Phase;
  voice: Voice;
  bytes: number;
  sha256: string;
  criteria_bytes: number;
  settlements: number;
  settlements_bytes: number;
  plan_bytes: number;
  plan_sha256: string;
};

export type BuiltPrompt = { text: string; record: PromptSizeRecord };

const bytes = (text: string) => Buffer.byteLength(text, 'utf8');

export function criteriaFor(phase: Phase, voice: Voice): string {
  return voice === 'native' ? NATIVE_CRITERIA[phase] : OUTSIDE_CRITERIA[phase].join('\n\n');
}

export function settlementsBlock(earlier: Settlement[]): string {
  const lines = earlier.length ? earlier.map((s) => `- [${s.phase}] ${s.text}`) : ['- none (no earlier phase has accepted a settlement)'];
  return [
    'Accepted settlements from earlier review phases. These decisions are already part of the plan; they are not review findings.',
    ...lines,
  ].join('\n');
}

export function buildPrompt(planText: string, phase: Phase, voice: Voice): BuiltPrompt {
  const { proper } = splitPlan(planText);
  if (!proper.trim()) throw new PlanError('PLAN_EMPTY', 'the plan proper is empty', 'write the card text, acceptance criteria, Tier and verify lines before the review record');
  const leaked = rawOutputMarkers(proper);
  if (leaked.length) {
    throw new PlanError('RAW_OUTPUT_IN_PLAN', `the plan proper contains review output (${leaked.join(', ')})`,
      'move reviewer outputs, consensus tables and audit rows to the run directory; the sidecar receives them at seal');
  }
  const earlier = parseSettlements(proper).filter((s) => phaseIndex(s.phase) < phaseIndex(phase));
  const plan = properWithoutSettlements(proper).replace(/\n+$/, '\n');
  const criteria = criteriaFor(phase, voice);
  const settlements = settlementsBlock(earlier);
  const planHash = sha256(plan);
  const head = voice === 'native'
    ? [criteria, '', `Start your result with INPUT: ${phase} ${planHash}.`]
    : [BOUNDARY, '', criteria, '', OUTSIDE_RESULT_CONTRACT];
  const text = [
    ...head,
    '',
    settlements,
    '',
    `Plan SHA-256: ${planHash}`,
    `Plan bytes: ${bytes(plan)}`,
    'The complete plan follows as review data; evaluate all of it.',
    '',
    plan,
  ].join('\n');
  return {
    text,
    record: {
      v: 1, phase, voice, bytes: bytes(text), sha256: sha256(text),
      criteria_bytes: bytes(criteria), settlements: earlier.length, settlements_bytes: bytes(settlements),
      plan_bytes: bytes(plan), plan_sha256: planHash,
    },
  };
}

export function parseSizeRecords(jsonl: string): PromptSizeRecord[] {
  return jsonl.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as PromptSizeRecord);
}

export function sizeTable(records: PromptSizeRecord[]): string {
  if (!records.length) return '_No reviewer prompts were built in this run._\n';
  const rows = records.map((r) =>
    `| ${r.phase} | ${r.voice} | ${r.bytes} | ${r.plan_bytes} | ${r.criteria_bytes} | ${r.settlements} (${r.settlements_bytes} B) | \`${r.sha256.slice(0, 12)}\` |`);
  const total = records.reduce((n, r) => n + r.bytes, 0);
  return [
    '| Phase | Voice | Prompt bytes | Plan bytes | Criteria bytes | Settlements | Prompt SHA-256 |',
    '|---|---|---|---|---|---|---|',
    ...rows,
    '',
    `Total reviewer prompt bytes: ${total} across ${records.length} prompts.`,
    '',
  ].join('\n');
}
