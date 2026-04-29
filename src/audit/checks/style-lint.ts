/**
 * style-lint.ts — port of check_style_lint (~L2854-2918).
 *
 * Advisory warnings that don't affect correctness. Composes from:
 *   1. Parser-emitted warnings (from ctx.roadmap.value.styleLintWarnings):
 *      duplicate track IDs, malformed _touches:_, self-dep, unparseable
 *      _Depends on:_ annotation. These accumulate in document order
 *      during parse.
 *   2. Intra-group track dep cycles (ctx.roadmap.value.trackDepCycles).
 *   3. Redundant explicit `_Depends on: Group N_` when N is the
 *      immediately-preceding Group in numeric order.
 *   4. Pre-flight subsection in a single-Track Group (artificial
 *      separation — Pre-flight exists to serialize parallel Tracks).
 *
 * Findings are emitted WITHOUT a `- ` bullet prefix — bash builds the
 * string verbatim and renders via `echo -e`, no ` -` adornment. Mirror
 * exactly so the snapshot stays byte-equal.
 */

import type { GroupInfo } from '../parsers/roadmap.ts';
import type { AuditCtx, CheckResult } from '../types.ts';

function compareGroupNum(a: string, b: string): number {
  return Number.parseInt(a, 10) - Number.parseInt(b, 10);
}

function explicitDeps(g: GroupInfo): string[] | null {
  switch (g.deps.kind) {
    case 'unspecified':
      return null;
    case 'none':
      return [];
    case 'list':
      return g.deps.depNums;
  }
}

export function runCheckStyleLint(ctx: AuditCtx): CheckResult {
  const warnings: string[] = [...ctx.roadmap.value.styleLintWarnings];

  // 2. Intra-group track dep cycles.
  for (const cyc of ctx.roadmap.value.trackDepCycles) {
    if (cyc === '') continue;
    warnings.push(
      `Dep cycle in intra-Group track graph: ${cyc} — remove or invert one edge to break the cycle`,
    );
  }

  // 3. Redundant-backwards-adjacent: explicit dep that equals the
  //    immediately-preceding Group (numeric-sort order).
  const groupsSorted = [...ctx.roadmap.value.groups].sort((a, b) => compareGroupNum(a.num, b.num));
  let prevSorted = '';
  for (const g of groupsSorted) {
    const explicit = explicitDeps(g);
    if (explicit !== null && explicit.length === 1 && prevSorted !== '') {
      if (explicit[0] === prevSorted) {
        warnings.push(
          `Group ${g.num}: _Depends on: Group ${prevSorted}_ is redundant (preceding Group is the default) — drop the annotation`,
        );
      }
    }
    prevSorted = g.num;
  }

  // 4. Pre-flight in single-Track Group.
  for (const g of ctx.roadmap.value.groups) {
    if (!g.hasPreflight) continue;
    if (g.isComplete) continue;
    if (g.trackIds.length === 0) continue;
    if (g.trackIds.length === 1) {
      warnings.push(
        `Group ${g.num}: Pre-flight subsection in a single-Track Group is artificial separation — fold into Track ${g.trackIds[0]} (Pre-flight exists to serialize shared-infra before parallel Tracks)`,
      );
    }
  }

  if (warnings.length === 0) {
    return {
      section: 'STYLE_LINT',
      status: 'pass',
      body: ['FINDINGS:', '- (none)'],
    };
  }
  // Trailing '' from bash echo -e of \n-terminated $_STYLE_LINT_WARNINGS.
  return {
    section: 'STYLE_LINT',
    status: 'warn',
    body: ['FINDINGS:', ...warnings, ''],
  };
}
