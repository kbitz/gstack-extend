/**
 * checks-doc-location.test.ts — unit tests for src/audit/checks/doc-location.ts.
 *
 * The docs/-absent finding fires only when the audited repo has a file at
 * bin/roadmap-audit, docs/ is missing, and no project doc lives at root.
 * CLAUDE.md is not an adoption signal. Root project docs still get placement
 * guidance and suppress the missing-directory finding.
 *
 * Context-boundary cases build a real temporary repo and read rootRoadmapAudit
 * through buildAuditCtx. Checked-in fixtures cannot keep symlinks: fixture
 * copy dereferences them.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildAuditCtx, parseArgs } from '../src/audit/cli.ts';
import { runCheckDocLocation } from '../src/audit/checks/doc-location.ts';
import type { AuditCtx, AuditFileExists } from '../src/audit/types.ts';
import { makeBaseTmp, makeEmptyRepo } from './helpers/fixture-repo.ts';

function makeCtx(opts: Partial<AuditFileExists>): AuditCtx {
  const exists: AuditFileExists = {
    rootTodos: false,
    docsTodos: false,
    rootRoadmap: false,
    docsRoadmap: false,
    rootProgress: false,
    docsProgress: false,
    versionFile: false,
    pyprojectFile: false,
    changelogFile: false,
    docsDir: false,
    designsDir: false,
    rootReadme: false,
    docsReadme: false,
    rootChangelog: false,
    docsChangelog: false,
    rootClaude: false,
    docsClaude: false,
    rootVersion: false,
    docsVersion: false,
    rootLicense: false,
    docsLicense: false,
    rootLicenseMd: false,
    docsLicenseMd: false,
    rootRoadmapAudit: false,
    ...opts,
  };
  return { exists } as unknown as AuditCtx;
}

function absentFindings(ctx: AuditCtx): string[] {
  return runCheckDocLocation(ctx).body.filter((l) => l.startsWith('- '));
}

describe('runCheckDocLocation: docs/-absent finding (repo-local bin/roadmap-audit)', () => {
  test('does NOT fire on CLAUDE.md at root alone', () => {
    const result = runCheckDocLocation(makeCtx({ rootClaude: true }));
    expect(result.status).toBe('pass');
    expect(result.body.join('\n')).not.toContain('docs/ directory absent');
  });

  test('CLAUDE.md under docs/ gets placement guidance and no missing-directory finding', () => {
    const body = runCheckDocLocation(makeCtx({ docsClaude: true, docsDir: true })).body.join('\n');
    expect(body).toContain('CLAUDE.md is in docs/');
    expect(body).not.toContain('docs/ directory absent');
  });

  test('does NOT fire on a bare repo', () => {
    const result = runCheckDocLocation(makeCtx({}));
    expect(result.status).toBe('pass');
  });

  test('fires exactly once when the local shim is present and docs are absent', () => {
    const result = runCheckDocLocation(makeCtx({ rootRoadmapAudit: true }));
    expect(result.status).toBe('fail');
    const findings = absentFindings(makeCtx({ rootRoadmapAudit: true }));
    expect(findings).toEqual([
      '- docs/ directory absent — project-level docs (ROADMAP.md/TODOS.md/PROGRESS.md) belong there. Run /roadmap to scaffold.',
    ]);
  });

  test('fires the same single finding when CLAUDE.md is also present', () => {
    const findings = absentFindings(makeCtx({ rootRoadmapAudit: true, rootClaude: true }));
    expect(findings.length).toBe(1);
    expect(findings[0]).toContain('docs/ directory absent');
  });

  test('does NOT fire when docs/ exists', () => {
    const result = runCheckDocLocation(makeCtx({ rootRoadmapAudit: true, docsDir: true }));
    expect(result.status).toBe('pass');
  });

  test('root TODOS.md gets placement guidance and no missing-directory finding', () => {
    const body = runCheckDocLocation(
      makeCtx({ rootRoadmapAudit: true, rootTodos: true }),
    ).body.join('\n');
    expect(body).toContain('TODOS.md is in root');
    expect(body).not.toContain('docs/ directory absent');
  });

  test('root ROADMAP.md gets placement guidance and no missing-directory finding', () => {
    const body = runCheckDocLocation(
      makeCtx({ rootRoadmapAudit: true, rootRoadmap: true }),
    ).body.join('\n');
    expect(body).toContain('ROADMAP.md is in root');
    expect(body).not.toContain('docs/ directory absent');
  });

  test('root PROGRESS.md gets placement guidance and no missing-directory finding', () => {
    const body = runCheckDocLocation(
      makeCtx({ rootRoadmapAudit: true, rootProgress: true }),
    ).body.join('\n');
    expect(body).toContain('PROGRESS.md is in root');
    expect(body).not.toContain('docs/ directory absent');
  });
});

describe('buildAuditCtx: bin/roadmap-audit file type', () => {
  const baseTmp = makeBaseTmp('doc-location-marker-');
  afterAll(() => {
    try {
      rmSync(baseTmp, { recursive: true, force: true });
    } catch {}
  });

  function ctxFor(repo: string) {
    return buildAuditCtx({
      repoRoot: repo,
      extendDir: join(baseTmp, 'not-the-target'),
      argv: parseArgs([repo]),
    });
  }

  test('a regular file qualifies and emits the absent-docs finding', () => {
    const repo = makeEmptyRepo(baseTmp);
    mkdirSync(join(repo, 'bin'));
    writeFileSync(join(repo, 'bin', 'roadmap-audit'), '# fixture marker — not executed\n');
    const ctx = ctxFor(repo);
    expect(ctx.exists.rootRoadmapAudit).toBe(true);
    expect(absentFindings(ctx)).toEqual([
      '- docs/ directory absent — project-level docs (ROADMAP.md/TODOS.md/PROGRESS.md) belong there. Run /roadmap to scaffold.',
    ]);
  });

  test('a symlink resolving to a file qualifies', () => {
    const repo = makeEmptyRepo(baseTmp);
    mkdirSync(join(repo, 'bin'));
    const target = join(repo, 'bin', 'roadmap-audit-target');
    writeFileSync(target, '# fixture marker — not executed\n');
    symlinkSync(target, join(repo, 'bin', 'roadmap-audit'));
    const ctx = ctxFor(repo);
    expect(ctx.exists.rootRoadmapAudit).toBe(true);
    expect(absentFindings(ctx)[0]).toContain('docs/ directory absent');
  });

  test('a directory at bin/roadmap-audit does not qualify', () => {
    const repo = makeEmptyRepo(baseTmp);
    mkdirSync(join(repo, 'bin', 'roadmap-audit'), { recursive: true });
    const ctx = ctxFor(repo);
    expect(ctx.exists.rootRoadmapAudit).toBe(false);
    expect(runCheckDocLocation(ctx).status).toBe('pass');
  });

  test('a dangling symlink at bin/roadmap-audit does not qualify', () => {
    const repo = makeEmptyRepo(baseTmp);
    mkdirSync(join(repo, 'bin'));
    symlinkSync(join(repo, 'bin', 'missing-target'), join(repo, 'bin', 'roadmap-audit'));
    const ctx = ctxFor(repo);
    expect(ctx.exists.rootRoadmapAudit).toBe(false);
    expect(runCheckDocLocation(ctx).status).toBe('pass');
  });
});
