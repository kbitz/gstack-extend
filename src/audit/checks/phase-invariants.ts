/**
 * phase-invariants.ts — port of check_phase_invariants (~L481-624).
 *
 * Validates each declared `## Phase N:` block:
 *   - Has **End-state:** field (else warn).
 *   - Has **Groups:** field (else warn; remaining checks skipped for that
 *     Phase since the group list is needed).
 *   - Lists ≥2 Groups (Phases coordinate ≥2 Groups by design).
 *   - Each listed Group exists as a `## Group N:` heading.
 *   - Listed groups are sequential ascending integers, no gaps.
 *   - No Group is double-claimed by two Phases.
 *   - Each declared scaffolding path exists (cli.ts pre-resolves; globs
 *     match if at least one file matched, plain paths via fs.existsSync).
 *
 * Findings emitted in bash order: per-phase findings in document order
 * with the field-presence checks first, then the cross-phase double-claim
 * check at the end. STATUS=warn (advisory) when any finding fires.
 */

import type { AuditCtx, CheckResult } from '../types.ts';

export function runCheckPhaseInvariants(ctx: AuditCtx): CheckResult {
  if (ctx.paths.roadmap === null) {
    return {
      section: 'PHASE_INVARIANTS',
      status: 'skip',
      body: ['FINDINGS:', '- No ROADMAP.md found'],
    };
  }

  const phases = ctx.phases.value.phases;
  if (phases.length === 0) {
    return {
      section: 'PHASE_INVARIANTS',
      status: 'skip',
      body: ['FINDINGS:', '- (none declared)'],
    };
  }

  const groupNums = new Set<string>();
  for (const g of ctx.roadmap.value.groups) groupNums.add(g.num);

  const findings: string[] = [];
  // Track which Phase claims each Group, in document order, for the
  // double-claim diagnostic. Bash uses `sort | uniq -d` then `sort -u` per
  // dup-group to dedupe owner Phases — replicate via Sets.
  const claimsOrdered: { groupNum: string; phaseNum: string }[] = [];

  for (const ph of phases) {
    if (!ph.hasEndState) {
      findings.push(
        `- Phase ${ph.num} (line ${ph.headLine}): missing **End-state:** field`,
      );
    }
    if (!ph.hasGroups) {
      findings.push(
        `- Phase ${ph.num} (line ${ph.headLine}): missing **Groups:** field`,
      );
      // Without a Groups list, remaining checks are moot for this Phase.
      continue;
    }

    const groups = ph.groupNums;
    if (groups.length < 2) {
      findings.push(
        `- Phase ${ph.num} (line ${ph.headLine}): declares ${groups.length} group(s); a Phase requires ≥2 Groups`,
      );
    }

    for (const g of groups) {
      if (g === '') continue;
      if (!groupNums.has(g)) {
        findings.push(
          `- Phase ${ph.num} (line ${ph.headLine}): listed Group ${g} has no \`## Group ${g}\` heading`,
        );
      }
      claimsOrdered.push({ groupNum: g, phaseNum: ph.num });
    }

    // Sequential ascending integers, no gaps.
    let prev: number | null = null;
    let seqOk = true;
    for (const g of groups) {
      if (g === '') continue;
      const n = Number.parseInt(g, 10);
      if (Number.isNaN(n)) {
        seqOk = false;
        break;
      }
      if (prev !== null && n !== prev + 1) {
        seqOk = false;
        break;
      }
      prev = n;
    }
    if (!seqOk) {
      findings.push(
        `- Phase ${ph.num} (line ${ph.headLine}): Groups list is not sequential (got ${groups.join(',')})`,
      );
    }

    // Scaffolding paths — pre-resolved by cli.ts.
    for (const path of ph.scaffoldPaths) {
      if (path === '') continue;
      const key = `${ph.num}|${path}`;
      const exists = ctx.scaffoldExists.get(key) ?? false;
      if (exists) continue;
      const isGlob = path.includes('*');
      const reason = isGlob ? 'matches no files' : 'does not exist';
      findings.push(
        `- Phase ${ph.num} (line ${ph.headLine}): scaffolding path \`${path}\` ${reason}`,
      );
    }
  }

  // Double-claim: a Group listed in more than one Phase.
  if (claimsOrdered.length > 0) {
    const ownersByGroup = new Map<string, Set<string>>();
    const docOrder: string[] = [];
    for (const c of claimsOrdered) {
      let cur = ownersByGroup.get(c.groupNum);
      if (cur === undefined) {
        cur = new Set();
        ownersByGroup.set(c.groupNum, cur);
        docOrder.push(c.groupNum);
      }
      cur.add(c.phaseNum);
    }
    // Bash: `cut | sort | uniq -d` — emit dup groups in numeric order.
    const dupGroups = docOrder
      .filter((g) => (ownersByGroup.get(g) ?? new Set()).size >= 2)
      .map((g) => ({ g, n: Number.parseInt(g, 10) }))
      .sort((a, b) => (Number.isNaN(a.n) || Number.isNaN(b.n) ? (a.g < b.g ? -1 : a.g > b.g ? 1 : 0) : a.n - b.n))
      .map((x) => x.g);

    for (const g of dupGroups) {
      const owners = [...(ownersByGroup.get(g) ?? new Set())].sort((a, b) => {
        const an = Number.parseInt(a, 10);
        const bn = Number.parseInt(b, 10);
        if (Number.isNaN(an) || Number.isNaN(bn)) {
          return a < b ? -1 : a > b ? 1 : 0;
        }
        return an - bn;
      });
      findings.push(`- Group ${g}: claimed by multiple Phases (${owners.join(',')})`);
    }
  }

  if (findings.length === 0) {
    return {
      section: 'PHASE_INVARIANTS',
      status: 'pass',
      body: ['FINDINGS:', '- (none)'],
    };
  }
  return {
    section: 'PHASE_INVARIANTS',
    status: 'warn',
    body: ['FINDINGS:', ...findings, ''],
  };
}
