import { PHASES, PlanError, type Phase } from './plan.ts';

export const PHASE_HISTORY = 'phase-attempts.jsonl';
export const PHASE_OUTPUTS = ['review', 'native', 'outside'] as const;
export type PhaseOutput = (typeof PHASE_OUTPUTS)[number];
/**
 * One archived attempt. A row with `voice: "native"` preserves only the native
 * output (a retried native voice whose outside sibling's completed result
 * stayed current); a row without it preserves the whole phase before a rerun.
 */
export type PhaseAttempt = { v: 1; phase: Phase; attempt: number; voice?: 'native' } & Partial<Record<PhaseOutput, string>>;

/** Refuse damaged history before any current output can be superseded. */
export function parsePhaseHistory(text: string): PhaseAttempt[] {
  const rows: PhaseAttempt[] = [];
  const counts = new Map<Phase, number>();
  for (const [index, line] of text.split('\n').entries()) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { /* Report the same repair for malformed rows. */ }
    if (!row || typeof row !== 'object' || Array.isArray(row)
        || row.v !== 1 || !PHASES.includes(row.phase)
        || row.attempt !== (counts.get(row.phase) ?? 0) + 1
        || Object.keys(row).some((key) => !['v', 'phase', 'attempt', 'voice', ...PHASE_OUTPUTS].includes(key))
        || !PHASE_OUTPUTS.some((key) => typeof row[key] === 'string')
        || PHASE_OUTPUTS.some((key) => key in row && typeof row[key] !== 'string')
        || ('voice' in row && (row.voice !== 'native' || PHASE_OUTPUTS.some((key) => key !== 'native' && key in row)))) {
      throw new PlanError('HISTORY_INVALID', `${PHASE_HISTORY} line ${index + 1} is not a valid sequential phase attempt`,
        'preserve the run files and repair the history from its original review outputs before retrying');
    }
    counts.set(row.phase, row.attempt);
    rows.push(row as PhaseAttempt);
  }
  return rows;
}
