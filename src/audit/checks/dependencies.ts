/**
 * dependencies.ts — port of check_dependencies (~L1008-1077).
 *
 * For every `Depends on:` line in ROADMAP.md, extract the `Track NX[.M]`
 * references it cites and verify each one matches an existing `### Track`
 * heading.
 *
 * Findings are emitted in (line-number, ref-position) order so the report
 * is stable regardless of dep-list shape. STATUS=skip when no `Depends on:`
 * lines exist at all (greenfield project, not a failure).
 *
 * Bash strips the heading prefix and trailing colon to get track names,
 * then a substring match (`grep -q "$ref"`) decides existence. So a
 * heading like `### Track 1A.1: foo` matches the ref `Track 1A`. Mirror
 * exactly via `tracks.some(t => t.includes(ref))`.
 */

import type { AuditCtx, CheckResult } from '../types.ts';

const TRACK_REF_RE = /Track [0-9]+[A-Z](?:\.[0-9]+)?/g;

export function runCheckDependencies(ctx: AuditCtx): CheckResult {
  if (ctx.paths.roadmap === null) {
    return {
      section: 'DEPENDENCIES',
      status: 'skip',
      body: ['FINDINGS:', '- No ROADMAP.md found'],
    };
  }

  const lines = ctx.files.roadmap.split('\n');
  const tracks: string[] = [];
  for (const line of lines) {
    if (!/^### Track/.test(line)) continue;
    // Strip "### " prefix and everything from ":" onward.
    const name = line.replace(/^### /, '').replace(/:.*$/, '');
    tracks.push(name);
  }

  const findings: string[] = [];
  let hasDeps = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.includes('Depends on:')) continue;
    hasDeps = true;
    const refs = line.match(TRACK_REF_RE);
    if (refs === null) continue;
    for (const ref of refs) {
      let exists = false;
      for (const t of tracks) {
        if (t.includes(ref)) {
          exists = true;
          break;
        }
      }
      if (!exists) {
        findings.push(`- line ${i + 1}: references "${ref}" but no such track exists`);
      }
    }
  }

  if (!hasDeps) {
    return {
      section: 'DEPENDENCIES',
      status: 'skip',
      body: ['FINDINGS:', '- No Depends on: lines found'],
    };
  }
  if (findings.length === 0) {
    return {
      section: 'DEPENDENCIES',
      status: 'pass',
      body: ['FINDINGS:', '- (none)'],
    };
  }
  return {
    section: 'DEPENDENCIES',
    status: 'fail',
    body: ['FINDINGS:', ...findings, ''],
  };
}
