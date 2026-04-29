/**
 * in-flight-groups.ts — port of check_in_flight_groups (~L2934-3018).
 *
 * Emits the execution frontier of the Group DAG: Groups whose deps are
 * all ✓ Complete and which themselves are not ✓ Complete. Each row mirrors
 * bash output:
 *   STATUS: info | skip
 *   IN_FLIGHT: N1 N2 ...
 *   COMPLETE: N1 N2 ...    (mirrors _COMPLETE_GROUPS)
 *   PRIMARY: N             (first in_flight group by numeric sort)
 *   UNKNOWN_DEPS: g→d,...  (only when present)
 *
 * Trailing-space parity: bash `echo "X: $var"` always emits a literal
 * space after the colon — empty `$var` produces "X: " (with trailing
 * space). The skip path uses literal `echo "X:"` (no space). We mirror
 * by computing the value and using template literals; for the skip path
 * we emit literal lines without the space.
 */

import { computeInFlight } from '../lib/in-flight.ts';
import type { AuditCtx, CheckResult } from '../types.ts';

export function runCheckInFlightGroups(ctx: AuditCtx): CheckResult {
  if (ctx.roadmap.value.groups.length === 0) {
    return {
      section: 'IN_FLIGHT_GROUPS',
      status: 'skip',
      body: ['IN_FLIGHT:', 'COMPLETE:', 'PRIMARY:'],
    };
  }

  const { inFlight, unknownDeps } = computeInFlight(ctx.roadmap.value);
  const completeGroups = ctx.roadmap.value.groups
    .filter((g) => g.isComplete)
    .map((g) => g.num)
    // Bash: _COMPLETE_GROUPS is space-sep in DOC ORDER (parser appends as
    // it sees them). Mirror by preserving parser order.
    ;
  const primary = inFlight.length > 0 ? inFlight[0]! : '';

  const body: string[] = [];
  body.push(`IN_FLIGHT: ${inFlight.join(' ')}`);
  body.push(`COMPLETE: ${completeGroups.join(' ')}`);
  body.push(`PRIMARY: ${primary}`);
  if (unknownDeps.length > 0) {
    body.push(`UNKNOWN_DEPS: ${unknownDeps.join(',')}`);
  }
  return { section: 'IN_FLIGHT_GROUPS', status: 'info', body };
}
