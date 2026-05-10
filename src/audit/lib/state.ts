/**
 * state.ts — lifecycle-state detection for ROADMAP.md sections.
 *
 * The v2 grammar puts state at the top of the document hierarchy:
 *
 *   ## Shipped
 *   ## In Progress
 *   ## Current Plan
 *   ## Future
 *
 * Each H2 state heading opens a region that runs until the next H2 (state or
 * otherwise) or EOF. Phases, Groups, and Tracks inherit their lifecycle state
 * from the enclosing region.
 *
 * Backward compatibility (v1 input): when no state sections are seen, the
 * detector returns `kind: 'v1'` and consumers fall back to inline-marker
 * derivation (✓ Complete on Group heading → shipped; etc.).
 */
export type LifecycleState = 'shipped' | 'in-progress' | 'current-plan' | 'future';

export type StateRegions =
  | { kind: 'v1' }
  | { kind: 'v2'; ranges: StateRange[] };

export type StateRange = {
  state: LifecycleState;
  startLine: number; // 1-indexed, line of the `## Heading`
  endLine: number; // 1-indexed, last line included; Number.MAX_SAFE_INTEGER for "to EOF"
};

const SHIPPED_RE = /^## Shipped[ \t\v\f\r]*$/;
const IN_PROGRESS_RE = /^## In Progress[ \t\v\f\r]*$/;
const CURRENT_PLAN_RE = /^## Current Plan[ \t\v\f\r]*$/;
const FUTURE_RE = /^## Future[ \t\v\f\r]*(\([^)]*\))?[ \t\v\f\r]*$/;
const ANY_H2_RE = /^## /;

export function detectStateRegions(content: string): StateRegions {
  if (content === '') return { kind: 'v1' };
  const lines = content.split('\n');
  const ranges: StateRange[] = [];
  let cur: StateRange | null = null;

  const close = (atLine: number) => {
    if (cur !== null) {
      cur.endLine = atLine - 1;
      ranges.push(cur);
      cur = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNo = i + 1;
    let opened: LifecycleState | null = null;
    if (SHIPPED_RE.test(line)) opened = 'shipped';
    else if (IN_PROGRESS_RE.test(line)) opened = 'in-progress';
    else if (CURRENT_PLAN_RE.test(line)) opened = 'current-plan';
    else if (FUTURE_RE.test(line)) opened = 'future';

    if (opened !== null) {
      close(lineNo);
      cur = { state: opened, startLine: lineNo, endLine: Number.MAX_SAFE_INTEGER };
      continue;
    }

    if (cur !== null && ANY_H2_RE.test(line)) {
      // Any other H2 closes the current state region but doesn't open a new one.
      close(lineNo);
    }
  }
  if (cur !== null) {
    cur.endLine = lines.length;
    ranges.push(cur);
  }

  if (ranges.length === 0) return { kind: 'v1' };
  // v2 trigger requires at least one of Shipped / In Progress / Current Plan.
  // `## Future` alone is ambiguous (v1 had it too), so a Future-only document
  // is treated as v1 with the Future region preserved for use by checks that
  // care (e.g. legacy parallelizable-future analysis).
  const hasV2Trigger = ranges.some(
    (r) => r.state === 'shipped' || r.state === 'in-progress' || r.state === 'current-plan',
  );
  if (!hasV2Trigger) return { kind: 'v1' };
  return { kind: 'v2', ranges };
}

/** Returns the lifecycle state for a given 1-indexed line number, or null
 *  if the line is outside any state region. v1 input always returns null. */
export function stateAtLine(regions: StateRegions, lineNo: number): LifecycleState | null {
  if (regions.kind === 'v1') return null;
  for (const r of regions.ranges) {
    if (lineNo >= r.startLine && lineNo <= r.endLine) return r.state;
  }
  return null;
}
