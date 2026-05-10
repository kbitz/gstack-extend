/**
 * structure.ts — ROADMAP.md skeleton validation (v2 grammar).
 *
 * Validates:
 *   - At least one Group heading OR a `## Future` section (greenfield is OK).
 *   - If Groups exist, at least one Track heading.
 *   - Each Track heading is followed by an `_..._`-italic metadata line
 *     containing "risk" or "low/medium/high".
 *   - The `_touches:_` line (when present) appears AFTER the metadata line.
 *   - No Track has an intra-Group `_Depends on: Track NX_` (parallel-safety
 *     escape hatch is gone in v2; sequential file work belongs in one Track
 *     or in different Groups).
 *   - No Track body contains "Ship as N PRs" / "PR1" / "PR2" / "two PRs"
 *     style language (v2: 1 Track = 1 PR, no exceptions).
 *   - Hotfix Groups (title starts with "Hotfix:") have exactly 1 Track and
 *     no Group-level `_Depends on:_` to non-shipped Groups.
 *
 * Findings are pushed in scan order; the first metadata-violation per Track
 * wins (matches the v1 short-circuit).
 */

import type { AuditCtx, CheckResult } from '../types.ts';

export function runCheckStructure(ctx: AuditCtx): CheckResult {
  if (ctx.paths.roadmap === null) {
    return {
      section: 'STRUCTURE',
      status: 'skip',
      body: ['FINDINGS:', '- No ROADMAP.md found'],
    };
  }

  const lines = ctx.files.roadmap.split('\n');
  const findings: string[] = [];

  let groupCount = 0;
  let trackCount = 0;
  let hasFuture = false;
  for (const line of lines) {
    if (/^#{2,4} Group [0-9]+:/.test(line)) groupCount++;
    if (/^#{3,5} Track [0-9]+[A-Z](?:\.[0-9]+)?:/.test(line)) trackCount++;
    if (/^## Future($| \()/i.test(line)) hasFuture = true;
  }

  if (groupCount === 0 && !hasFuture) {
    findings.push('- No Group headings found (expected ## Group N: Name or ### Group N: Name)');
  }
  if (groupCount > 0 && trackCount === 0) {
    findings.push('- Groups found but no Track headings (expected ### Track NA: Name or #### Track NA: Name)');
  }

  if (trackCount > 0) {
    let inTrack = false;
    let trackName = '';

    const flushMissingMeta = () => {
      if (inTrack && trackName !== '') {
        findings.push(
          `- ${trackName}: missing metadata line (expected _N tasks . effort . risk . files_)`,
        );
      }
    };

    for (const line of lines) {
      if (/^#{3,5} Track [0-9]+[A-Z](?:\.[0-9]+)?:/.test(line)) {
        inTrack = true;
        trackName = line.replace(/^#{3,5} /, '');
        continue;
      }
      if (!inTrack) continue;

      if (/^_touches:/.test(line)) {
        findings.push(
          `- ${trackName}: _touches:_ line appears before metadata (expected metadata first)`,
        );
        inTrack = false;
        trackName = '';
        continue;
      }
      if (/^_.*_$/.test(line)) {
        if (!/risk|low|medium|high/i.test(line)) {
          findings.push(`- ${trackName}: metadata line missing risk level`);
        }
        inTrack = false;
        trackName = '';
        continue;
      }
      if (line !== '') {
        findings.push(
          `- ${trackName}: missing metadata line (expected _N tasks . effort . risk . files_)`,
        );
        inTrack = false;
        trackName = '';
      }
    }
    flushMissingMeta();
  }

  // v2-only bans: gated on detected v2 grammar so v1 roadmaps audited by
  // /roadmap (the existing skill) keep working without surprise blockers.
  if (ctx.roadmap.value.hasV2Grammar) {
    // Intra-Group _Depends on: Track NX_ — banned in v2.
    for (const t of ctx.roadmap.value.tracks) {
      if (t.state === 'shipped') continue;
      if (t.deps.length === 0) continue;
      findings.push(
        `- Track ${t.id}: intra-Group _Depends on: Track ${t.deps.join(', ')}_ is banned (Tracks within a Group must be fully parallel-safe — merge or move to different Groups)`,
      );
    }

    // PR-split language ban — body contains "N PRs" / "PR1" / "PR2" / "two PRs".
    for (const t of ctx.roadmap.value.tracks) {
      if (t.state === 'shipped') continue;
      if (!t.bannedPrSplit) continue;
      findings.push(
        `- Track ${t.id}: body contains PR-split language ("N PRs"/"PR1"/"PR2"/"two PRs"/etc.) — 1 Track = 1 PR; if work needs multiple PRs, split into multiple Tracks`,
      );
    }

    // Hotfix Group invariants: exactly 1 Track; no deps on non-shipped Groups.
    const groupById = new Map(ctx.roadmap.value.groups.map((g) => [g.num, g]));
    for (const g of ctx.roadmap.value.groups) {
      if (!g.isHotfix) continue;
      if (g.state === 'shipped') continue;
      if (g.trackIds.length !== 1) {
        findings.push(
          `- Group ${g.num} (Hotfix): expected exactly 1 Track, found ${g.trackIds.length} (hotfixes are single-Track groups by definition)`,
        );
      }
      if (g.deps.kind === 'list') {
        for (const d of g.deps.depNums) {
          const dep = groupById.get(d);
          if (dep !== undefined && dep.state !== 'shipped') {
            findings.push(
              `- Group ${g.num} (Hotfix): depends on non-shipped Group ${d} — hotfixes jump the queue and may only depend on already-shipped work`,
            );
          }
        }
      }
    }
  }

  if (findings.length === 0) {
    return {
      section: 'STRUCTURE',
      status: 'pass',
      body: ['FINDINGS:', '- (none)'],
    };
  }
  return {
    section: 'STRUCTURE',
    status: 'fail',
    body: ['FINDINGS:', ...findings, ''],
  };
}
