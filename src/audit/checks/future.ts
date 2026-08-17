/**
 * future.ts — `## Future` section format validation.
 *
 * The Future section is "items we might do but aren't committed to."
 * Plain bullets, no Phase/Group/Track structure, no `_touches:_`, no
 * sizing, no IDs. When split, ROADMAP holds a pointer and
 * docs/roadmap-future.md holds the bullets.
 *
 * Output shape:
 *   STATUS: pass | fail | skip
 *   FINDINGS: per-finding (or "- (none)")
 *   FUTURE_BULLET_COUNT: N
 *   FUTURE_SOURCE: inline | file | empty
 */

import { parseRoadmap } from '../parsers/roadmap.ts';
import type { AuditCtx, CheckResult, CheckStatus } from '../types.ts';

export function runCheckFuture(ctx: AuditCtx): CheckResult {
  if (ctx.paths.roadmap === null) {
    return {
      section: 'FUTURE',
      status: 'skip',
      body: ['FINDINGS:', '- No ROADMAP.md found'],
    };
  }

  // Parse the live file and the satellite independently. Merged
  // ctx.roadmap.futureBullets hides dual-presence and pointer lies.
  const active = parseRoadmap(ctx.files.roadmap);
  const archivePath = ctx.paths.futureArchive;
  const archive = archivePath !== null ? parseRoadmap(ctx.files.futureArchive) : null;

  const activeBullets = active.value.futureBullets;
  const archiveBullets = archive?.value.futureBullets ?? [];
  const pointer = active.value.futurePointer;
  const findings: string[] = [];

  const malformed = [
    ...active.value.futureMalformed,
    ...(archive?.value.futureMalformed ?? []),
  ];
  for (const m of malformed) {
    if (/^#{2,5} /.test(m)) {
      findings.push(
        `- Future contains a heading: "${m}" — Future is plain bullets only (no Phase/Group/Track structure)`,
      );
    } else if (/^_/.test(m)) {
      findings.push(
        `- Future contains a metadata line: "${m}" — Future is plain bullets only (no _touches:_, no sizing)`,
      );
    } else {
      findings.push(`- Future contains non-bullet content: "${m}"`);
    }
  }

  if (pointer !== null && archivePath === null) {
    findings.push(
      '- FUTURE_FILE_MISSING: ROADMAP points at docs/roadmap-future.md but the file is absent',
    );
  }
  if (archivePath !== null && pointer === null && activeBullets.length === 0) {
    findings.push(
      '- FUTURE_POINTER_MISSING: docs/roadmap-future.md exists but ROADMAP ## Future has no Deferred: pointer',
    );
  }
  if (archivePath !== null && activeBullets.length > 0) {
    findings.push(
      '- SPLIT_INCOMPLETE: Future bullets live in both ROADMAP.md and docs/roadmap-future.md — finish the split',
    );
  }
  if (archivePath !== null && pointer !== null) {
    if (archiveBullets.length === 0 && /^- /m.test(ctx.files.futureArchive)) {
      findings.push(
        '- FUTURE_FILE_MALFORMED: docs/roadmap-future.md has bullets but no ## Future heading — the parser will not see them',
      );
    }
    if (pointer.declaredCount !== archiveBullets.length) {
      findings.push(
        `- FUTURE_COUNT_MISMATCH: pointer says (${pointer.declaredCount} items) but the file has ${archiveBullets.length}`,
      );
    }
  }

  const count = archivePath !== null ? archiveBullets.length : activeBullets.length;
  const source =
    archivePath !== null ? 'file' : activeBullets.length > 0 ? 'inline' : 'empty';
  const tail = [`FUTURE_BULLET_COUNT: ${count}`];
  if (source === 'file') tail.push(`FUTURE_SOURCE: ${source}`);

  const status: CheckStatus = findings.length === 0 ? 'pass' : 'fail';
  if (status === 'pass') {
    return {
      section: 'FUTURE',
      status,
      body: ['FINDINGS:', '- (none)', ...tail],
    };
  }
  return {
    section: 'FUTURE',
    status,
    body: ['FINDINGS:', ...findings, '', ...tail],
  };
}
