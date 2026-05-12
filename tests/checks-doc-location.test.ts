/**
 * checks-doc-location.test.ts — unit tests for src/audit/checks/doc-location.ts.
 *
 * Locks the docs/-absent finding's CLAUDE.md gate added in Track 8A.
 * Without the gate, the finding fires on every bare repo someone happens
 * to run `roadmap-audit` against and dirties almost every snapshot fixture.
 * The CLAUDE.md gate (root or docs/) is the load-bearing signal that the
 * project intends to use gstack/extend tooling.
 *
 * The existing root-only and docs-only branches are covered by snapshot
 * fixtures (tests/roadmap-audit/doc-location-bad/), not unit tests.
 *
 * Constructs a minimal AuditCtx — runCheckDocLocation only reads
 * ctx.exists fields, so the full buildAuditCtx machinery isn't needed.
 */

import { describe, expect, test } from 'bun:test';

import { runCheckDocLocation } from '../src/audit/checks/doc-location.ts';
import type { AuditCtx, AuditFileExists } from '../src/audit/types.ts';

function makeCtx(opts: Partial<AuditFileExists>): AuditCtx {
  const exists = {
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
    ...opts,
  } as AuditFileExists;
  return { exists } as unknown as AuditCtx;
}

describe('runCheckDocLocation: docs/-absent finding (Track 8A, CLAUDE.md gated)', () => {
  test('fires when CLAUDE.md at root + no docs/ + no project doc at root', () => {
    const ctx = makeCtx({ rootClaude: true });
    const result = runCheckDocLocation(ctx);
    expect(result.status).toBe('fail');
    const body = result.body.join('\n');
    expect(body).toContain('docs/ directory absent');
    expect(body).toContain('project-level docs');
    expect(body).toContain('/roadmap');
  });

  test('fires when CLAUDE.md at docs/ + no docs/ dir + no project doc at root', () => {
    // docsClaude true with docsDir false is unusual but possible (someone
    // tracks CLAUDE.md under docs/ without creating the dir as a marker
    // path — defensive coverage; the OR-gate must honor both halves).
    const ctx = makeCtx({ docsClaude: true });
    const result = runCheckDocLocation(ctx);
    const body = result.body.join('\n');
    expect(body).toContain('docs/ directory absent');
  });

  test('does NOT fire on a bare repo with no CLAUDE.md (the load-bearing gate)', () => {
    // Bare repo: nothing exists. Without the CLAUDE.md gate this would
    // emit a layout-pressure finding on every non-gstack repo.
    const ctx = makeCtx({});
    const result = runCheckDocLocation(ctx);
    expect(result.status).toBe('pass');
  });

  test('does NOT fire when CLAUDE.md exists but docs/ also exists', () => {
    // Project is set up correctly — no greenfield onboarding needed.
    const ctx = makeCtx({ rootClaude: true, docsDir: true });
    const result = runCheckDocLocation(ctx);
    expect(result.status).toBe('pass');
  });

  test('does NOT fire when a project doc exists at root (handled by other finding)', () => {
    // Project doc in root + no docs/ is the "root-only" misplacement case
    // already handled by the PROJECT_DOC_PAIRS loop above; the docs/-absent
    // finding shouldn't double-fire.
    const ctx = makeCtx({ rootClaude: true, rootRoadmap: true });
    const result = runCheckDocLocation(ctx);
    const body = result.body.join('\n');
    // The root-only finding fires (existing behavior).
    expect(body).toContain('ROADMAP.md is in root');
    // The docs/-absent finding does NOT also fire.
    expect(body).not.toContain('docs/ directory absent');
  });

  test('fires alongside other findings when conditions co-occur', () => {
    // docs/ doesn't exist AND a ROOT_DOC is in docs/ (impossible without
    // docsDir, but proves the finding is additive not exclusive on the
    // root-only path). Use a more realistic co-occurrence: CLAUDE.md
    // somewhere + no docs/ + no project doc at root → finding fires as
    // the only finding.
    const ctx = makeCtx({ rootClaude: true });
    const result = runCheckDocLocation(ctx);
    expect(result.status).toBe('fail');
    const findings = result.body.filter((l) => l.startsWith('- '));
    expect(findings.length).toBe(1);
    expect(findings[0]).toContain('docs/ directory absent');
  });
});
