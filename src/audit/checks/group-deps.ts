/**
 * group-deps.ts — port of check_group_deps (~L2679-2853).
 *
 * Validates the inter-Group dependency graph and emits an ADJACENCY block
 * regardless of status (the adjacency is the useful artifact for humans
 * and downstream tools).
 *
 * Effective dep rule:
 *   - No `_Depends on:_` annotation → defaults to "depends on the
 *     immediately preceding Group in numeric order".
 *   - `_Depends on: none_` (or `—` / `-`) → no deps.
 *   - `_Depends on: Group N[, Group M]_` → explicit list.
 *
 * Validations (in fail-precedence order):
 *   1. Forward-ref: every explicit dep must point at an existing Group.
 *   2. Cycle: Kahn's algorithm on the effective DAG (forward-ref phantoms
 *      are excluded from in-degree counts).
 *   3. STALE_DEPS (warn): name-anchored ref `Group N (Name)` whose anchored
 *      name no longer matches the current Group heading.
 *
 * STATUS precedence:
 *   - Any forward-ref OR cycle → fail (warn findings still printed).
 *   - Only STALE_DEPS → warn.
 *   - Otherwise → pass.
 *
 * The Adjacency line format is `- Group N ← {dep1,dep2}` (empty braces for
 * groups with no deps). cli.ts emits this regardless of status.
 */

import type { GroupDeps, GroupInfo } from '../parsers/roadmap.ts';
import type { AuditCtx, CheckResult } from '../types.ts';

function parseGroupNum(num: string): number {
  // Pre-validated by the parser to /^[0-9]+$/.
  return Number.parseInt(num, 10);
}

function compareGroupNums(a: string, b: string): number {
  const an = parseGroupNum(a);
  const bn = parseGroupNum(b);
  return an - bn;
}

function effectiveDepsFor(g: GroupInfo, prevGroupNum: string | null): string[] {
  const deps = g.deps;
  switch (deps.kind) {
    case 'unspecified':
      return prevGroupNum === null ? [] : [prevGroupNum];
    case 'none':
      return [];
    case 'list':
      return deps.depNums;
  }
}

function explicitDepsFor(g: GroupInfo): string[] | null {
  // Returns the explicit list (or [] for none), or null when unspecified.
  // Forward-ref validation walks only the explicit set — implicit
  // "depends on previous group" can't reference a nonexistent Group by
  // construction (the previous Group always exists).
  switch (g.deps.kind) {
    case 'unspecified':
      return null;
    case 'none':
      return [];
    case 'list':
      return g.deps.depNums;
  }
}

export function runCheckGroupDeps(ctx: AuditCtx): CheckResult {
  const groups = ctx.roadmap.value.groups;
  if (groups.length === 0) {
    return {
      section: 'GROUP_DEPS',
      status: 'skip',
      body: ['FINDINGS:', '- No Groups in ROADMAP.md'],
    };
  }

  // Sort groups numerically — bash `sort -n`. Stable on equal keys (no dups
  // expected: parser stores groupOrder as deduped first-encounter order).
  const sortedGroups = [...groups].sort((a, b) => compareGroupNums(a.num, b.num));
  const groupSet = new Set(groups.map((g) => g.num));

  const effectiveDeps = new Map<string, string[]>();
  let prev: string | null = null;
  for (const g of sortedGroups) {
    effectiveDeps.set(g.num, effectiveDepsFor(g, prev));
    prev = g.num;
  }

  const failFindings: string[] = [];
  const warnFindings: string[] = [];

  // 1. Forward-ref validation: every explicit dep must reference an existing Group.
  for (const g of sortedGroups) {
    const explicit = explicitDepsFor(g);
    if (explicit === null) continue;
    for (const d of explicit) {
      if (!groupSet.has(d)) {
        failFindings.push(`- Group ${g.num} references nonexistent Group ${d} (forward reference)`);
      }
    }
  }

  // 2. Kahn's: in-degree only counts deps that point at extant Groups
  //    (forward-ref phantoms don't block the topological sort, they just fail
  //    the forward-ref rule above).
  const inDegree = new Map<string, number>();
  for (const g of sortedGroups) {
    let count = 0;
    for (const d of effectiveDeps.get(g.num) ?? []) {
      if (groupSet.has(d)) count++;
    }
    inDegree.set(g.num, count);
  }

  const processed = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const g of sortedGroups) {
      if (processed.has(g.num)) continue;
      if ((inDegree.get(g.num) ?? 0) === 0) {
        processed.add(g.num);
        for (const g2 of sortedGroups) {
          const deps = effectiveDeps.get(g2.num) ?? [];
          if (deps.includes(g.num)) {
            inDegree.set(g2.num, (inDegree.get(g2.num) ?? 0) - 1);
          }
        }
        changed = true;
      }
    }
  }
  if (processed.size < sortedGroups.length) {
    const cycleMembers: string[] = [];
    for (const g of sortedGroups) {
      if (!processed.has(g.num)) cycleMembers.push(g.num);
    }
    failFindings.push(`- Cycle detected involving Groups: ${cycleMembers.join(',')}`);
  }

  // 3. STALE_DEPS — anchored name vs current Group heading.
  const groupNames = new Map<string, string>();
  for (const g of groups) groupNames.set(g.num, g.name);
  for (const g of groups) {
    for (const a of g.depAnchors) {
      const current = groupNames.get(a.depNum);
      if (current !== undefined && current !== a.name) {
        warnFindings.push(
          `- Group ${g.num} references "Group ${a.depNum} (${a.name})" but Group ${a.depNum} is now titled "${current}" — update the annotation`,
        );
      }
    }
  }

  // Body assembly. Adjacency comes after FINDINGS (so the section ends with
  // the artifact, not the verdict). Trailing '' is omitted — adjacency
  // already has its own newline-per-line; the section separator handles spacing.
  const body: string[] = [];
  let status: 'pass' | 'fail' | 'warn';
  if (failFindings.length > 0) {
    status = 'fail';
    body.push('FINDINGS:');
    body.push(...failFindings);
    body.push(...warnFindings);
  } else if (warnFindings.length > 0) {
    status = 'warn';
    body.push('FINDINGS:');
    body.push(...warnFindings);
  } else {
    status = 'pass';
    body.push('FINDINGS:');
    body.push(`- All Group-level dependencies valid (${sortedGroups.length} groups)`);
  }

  body.push('ADJACENCY:');
  for (const g of sortedGroups) {
    const deps = effectiveDeps.get(g.num) ?? [];
    if (deps.length === 0) {
      body.push(`- Group ${g.num} ← {}`);
    } else {
      body.push(`- Group ${g.num} ← {${deps.join(',')}}`);
    }
  }

  return { section: 'GROUP_DEPS', status, body };
}
