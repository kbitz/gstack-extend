/**
 * Review-record sidecar assembly for /autoplan-lean.
 *
 * The run directory holds what the parent and the voices wrote while
 * reviewing; `seal` copies it into the sidecar in a fixed order, so the parent
 * never re-emits reviewer output through its own context:
 *
 *   intake.md                  intake, scope, outside preflight, criteria drift
 *   prompt-sizes.jsonl         one row per reviewer prompt (bytes, never content)
 *   <phase>-review.md          the phase's primary review and required outputs
 *   <phase>-native.md          the native voice's raw output
 *   <phase>-outside.md         the outside voice's raw output
 *   phase-attempts.jsonl       previous phase attempts, preserved before reruns
 *   decisions.md               the decision audit trail
 *   gate.md                    the final approval gate and its answer
 */
import { PHASES, type Phase } from './plan.ts';
import { parseSizeRecords, sizeTable } from './prompt.ts';
import { PHASE_HISTORY, parsePhaseHistory } from './history.ts';

export type RunFiles = (name: string) => string | undefined;

const PHASE_TITLE: Record<Phase, string> = {
  ceo: 'Phase 1: CEO review',
  design: 'Phase 2: Design review',
  dx: 'Phase 2.5: DX review',
  eng: 'Phase 3: Eng review',
};

const body = (text: string) => text.replace(/^\n+/, '').replace(/\s+$/, '');

function raw(phase: Phase, voice: 'native' | 'outside', text: string | undefined, level = 3): string[] {
  const title = `${'#'.repeat(level)} ${voice === 'native' ? 'Native voice' : 'Outside voice'} output (raw)`;
  if (text === undefined) {
    return [title, '', `_No ${voice} output file: the voice was unavailable, disabled or skipped. The phase review records its status._`, ''];
  }
  return [title, '', `<!-- autoplan-lean:raw ${phase} ${voice} -->`, body(text), '<!-- /autoplan-lean:raw -->', ''];
}

export function assembleSidecar(planPath: string, runDir: string, files: RunFiles, previous?: { path: string; sha256: string }): string {
  const out: string[] = [
    '# /autoplan-lean review record',
    '',
    `Plan: \`${planPath}\``,
    `Run directory: \`${runDir}\``,
  ];
  if (previous) out.push(`Previous record: \`${previous.path}\` (SHA-256 \`${previous.sha256}\`)`);
  out.push('', 'This file holds the full review record. The plan proper holds the decisions; implementation reads only the plan.', '');
  out.push('## Intake', '', files('intake.md') === undefined ? '_No intake notes recorded._' : body(files('intake.md')!), '');
  const sizes = files('prompt-sizes.jsonl');
  out.push('## Reviewer prompt sizes', '', sizeTable(sizes === undefined ? [] : parseSizeRecords(sizes)).replace(/\n+$/, ''), '');
  const history = parsePhaseHistory(files(PHASE_HISTORY) ?? '');
  for (const phase of PHASES) {
    const review = files(`${phase}-review.md`);
    const native = files(`${phase}-native.md`);
    const outside = files(`${phase}-outside.md`);
    const archived = history.filter((entry) => entry.phase === phase);
    out.push(`## ${PHASE_TITLE[phase]}`, '');
    const hasCurrent = review !== undefined || native !== undefined || outside !== undefined;
    if (!archived.length && !hasCurrent) {
      out.push('_Not run: no review files in the run directory (skipped scope, or the run stopped earlier)._', '');
      continue;
    }
    for (const entry of archived) {
      out.push(`### Attempt ${entry.attempt} (archived)`, '', entry.review === undefined ? '_No phase review file recorded._' : body(entry.review), '');
      out.push(...raw(phase, 'native', entry.native, 4), ...raw(phase, 'outside', entry.outside, 4));
    }
    if (hasCurrent) {
      if (archived.length) out.push(`### Attempt ${archived.length + 1} (current)`, '');
      out.push(review === undefined ? '_No phase review file recorded._' : body(review), '');
      out.push(...raw(phase, 'native', native, archived.length ? 4 : 3), ...raw(phase, 'outside', outside, archived.length ? 4 : 3));
    }
  }
  out.push('## Decision audit trail', '', files('decisions.md') === undefined ? '_No decisions recorded._' : body(files('decisions.md')!), '');
  out.push('## Final approval gate', '', files('gate.md') === undefined ? '_No gate record._' : body(files('gate.md')!), '');
  return out.join('\n');
}
