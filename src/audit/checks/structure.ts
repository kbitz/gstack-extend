/**
 * structure.ts — port of check_structure (bin/roadmap-audit ~L301-404).
 *
 * Validates ROADMAP.md skeleton:
 *   - At least one `## Group` heading (or a `## Future` section — future-only
 *     roadmap is a valid greenfield state).
 *   - If Groups exist, at least one `### Track` heading.
 *   - Each `### Track` heading is followed by an `_..._`-italic metadata
 *     line containing the words "risk" or "low/medium/high".
 *   - The `_touches:_` line (when present) must come AFTER the metadata line,
 *     not before it.
 *
 * Findings are pushed in scan order; the first violation per Track wins
 * (the bash version sets `in_track=0` after the first non-blank post-heading
 * line, so subsequent malformed lines on the same track aren't reported).
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
    if (/^## Group/.test(line)) groupCount++;
    if (/^### Track/.test(line)) trackCount++;
    if (/^## Future($| \()/i.test(line)) hasFuture = true;
  }

  if (groupCount === 0 && !hasFuture) {
    findings.push('- No Group headings found (expected ## Group N: Name)');
  }
  if (groupCount > 0 && trackCount === 0) {
    findings.push('- Groups found but no Track headings (expected ### Track NA: Name)');
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
      if (/^### Track/.test(line)) {
        inTrack = true;
        trackName = line.replace(/^### /, '');
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

  if (findings.length === 0) {
    return {
      section: 'STRUCTURE',
      status: 'pass',
      body: ['FINDINGS:', '- (none)'],
    };
  }
  // Trailing '' mirrors bash echo -e of a \n-terminated $findings.
  return {
    section: 'STRUCTURE',
    status: 'fail',
    body: ['FINDINGS:', ...findings, ''],
  };
}
