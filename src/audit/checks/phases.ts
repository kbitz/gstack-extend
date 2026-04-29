/**
 * phases.ts — port of check_phases (bin/roadmap-audit ~L405-463).
 *
 * Per declared `## Phase N:` block, emits one row:
 *   `- phase=N title="..." groups=[A, B] state=in_flight current_group=B scaffolding_decls=K`
 *
 * State derivation: if every listed group is in ✓ Complete, state=complete
 * (and current_group is omitted). Otherwise state=in_flight and
 * current_group is the first listed group that is NOT complete (or `?`
 * if no groups are listed at all).
 *
 * When no Phases are declared the section emits STATUS: skip + a
 * `(none declared)` row so consumers can still rely on a STATUS line.
 */

import type { AuditCtx, CheckResult } from '../types.ts';

export function runCheckPhases(ctx: AuditCtx): CheckResult {
  if (ctx.paths.roadmap === null) {
    return {
      section: 'PHASES',
      status: 'skip',
      body: ['FINDINGS:', '- No ROADMAP.md found'],
    };
  }

  const phases = ctx.phases.value.phases;
  if (phases.length === 0) {
    return {
      section: 'PHASES',
      status: 'skip',
      body: ['PHASES:', '- (none declared)'],
    };
  }

  const completeGroups = new Set<string>();
  for (const g of ctx.roadmap.value.groups) {
    if (g.isComplete) completeGroups.add(g.num);
  }

  const body: string[] = ['PHASES:'];
  for (const ph of phases) {
    const groups = ph.groupNums;
    const groupsFmt = groups.length === 0 ? '[]' : `[${groups.join(', ')}]`;
    const scaffoldingDecls = ph.scaffoldPaths.length;

    let state: 'in_flight' | 'complete' = 'in_flight';
    let currentGroup = '';
    if (groups.length > 0) {
      let allComplete = true;
      for (const g of groups) {
        if (!completeGroups.has(g)) {
          allComplete = false;
          if (currentGroup === '') currentGroup = g;
        }
      }
      if (allComplete) state = 'complete';
    }

    if (state === 'complete') {
      body.push(
        `- phase=${ph.num} title="${ph.title}" groups=${groupsFmt} state=complete scaffolding_decls=${scaffoldingDecls}`,
      );
    } else {
      const cg = currentGroup === '' ? '?' : currentGroup;
      body.push(
        `- phase=${ph.num} title="${ph.title}" groups=${groupsFmt} state=in_flight current_group=${cg} scaffolding_decls=${scaffoldingDecls}`,
      );
    }
  }

  return { section: 'PHASES', status: 'pass', body };
}
