/**
 * check-staleness.test.ts — unit coverage for the version-tagged
 * completed-item check.
 *
 * Uses a hand-rolled GitGateway stub so we can drive `tags()` without
 * touching real git. The check itself reads ROADMAP.md content from
 * ctx.files.roadmap, so we feed that directly. Bash parity contracts
 * exercised here:
 *   - "shipped" iff a matching tag exists OR current >= matched version.
 *   - Strikethrough markers: `~~text~~ DONE`, `~~text~~ ✓`, `~~text~~ ✅`,
 *     `~~text~~ Completed`, `^### ~~`. All trigger the version probe.
 *   - Lines without `(vX.Y.Z)` annotations are silently passed (they don't
 *     name a target version, so the check has nothing to compare against).
 *   - Both `(vX.Y.Z)` and `(X.Y.Z)` parenthetical forms accepted.
 */

import { describe, expect, test } from 'bun:test';

import { runCheckStaleness } from '../src/audit/checks/staleness.ts';
import type { GitGateway } from '../src/audit/lib/git.ts';
import type { AuditCtx } from '../src/audit/types.ts';

type StubGitOpts = {
  tags?: string[];
  latest?: string | null;
};

function stubGit(opts: StubGitOpts = {}): GitGateway {
  return {
    toplevel: () => null,
    tags: () => opts.tags ?? [],
    tagsLatest: () => opts.latest ?? null,
    diffNamesBetween: () => [],
    logFirstWithPhrase: () => null,
    logSubjectsSince: () => [],
  };
}

function makeCtx(roadmap: string, current: string, git: GitGateway): AuditCtx {
  return {
    repoRoot: '/tmp/x',
    extendDir: '/tmp/x',
    env: { stateDir: '/tmp/x' },
    git,
    paths: { todos: null, roadmap: 'ROADMAP.md', progress: null },
    files: {
      roadmap,
      todos: '',
      progress: '',
      version: current,
      changelog: '',
      pyproject: '',
    },
    exists: {
      rootTodos: false, docsTodos: false, rootRoadmap: false, docsRoadmap: true,
      rootProgress: false, docsProgress: false, versionFile: true, pyprojectFile: false,
      changelogFile: false, docsDir: true, designsDir: false,
      rootReadme: false, docsReadme: false, rootChangelog: false, docsChangelog: false,
      rootClaude: false, docsClaude: false, rootVersion: true, docsVersion: false,
      rootLicense: false, docsLicense: false, rootLicenseMd: false, docsLicenseMd: false,
    },
    designs: [],
    scaffoldExists: new Map(),
    roadmap: {
      value: { groups: [], tracks: [], styleLintWarnings: [], sizeLabelMismatches: [], trackDepCycles: [] },
      errors: [],
    },
    phases: { value: { phases: [] }, errors: [] },
    todos: { value: { hasUnprocessedSection: false, entries: [] }, errors: [] },
    progress: { value: { versions: [], latestVersion: null, rawTableLines: [] }, errors: [] },
    version: {
      current,
      source: 'VERSION',
      latestTag: null,
      progressLatest: null,
      changelogLatest: null,
    },
  };
}

describe('check_staleness', () => {
  test('skip when no ROADMAP.md', () => {
    const ctx = makeCtx('', '0.5.0', stubGit());
    ctx.paths.roadmap = null;
    const r = runCheckStaleness(ctx);
    expect(r.status).toBe('skip');
    expect(r.body).toContain('- No ROADMAP.md found');
  });

  test('pass when no completed-item markers', () => {
    const r = runCheckStaleness(makeCtx('# Active items\n- foo\n- bar\n', '0.5.0', stubGit()));
    expect(r.status).toBe('pass');
    expect(r.body).toEqual(['FINDINGS:', '- (none)']);
  });

  test('flags ~~item~~ DONE (vX.Y.Z) when current is ahead', () => {
    const md = ['line 1', 'line 2', '~~Old item~~ DONE (v0.3.0)', 'line 4'].join('\n');
    const r = runCheckStaleness(makeCtx(md, '0.5.0', stubGit()));
    expect(r.status).toBe('fail');
    expect(r.body.some((l) => l.includes('line 3') && l.includes('v0.3.0'))).toBe(true);
  });

  test('flags ~~item~~ DONE when matching tag exists', () => {
    const md = '~~Old~~ DONE (v0.4.0)\n';
    const r = runCheckStaleness(
      makeCtx(md, '0.4.0', stubGit({ tags: ['v0.4.0'] })),
    );
    expect(r.status).toBe('fail');
  });

  test('skips item whose version has not shipped', () => {
    const md = '~~Future~~ DONE (v9.9.9)\n';
    const r = runCheckStaleness(makeCtx(md, '0.4.0', stubGit({ tags: ['v0.4.0'] })));
    expect(r.status).toBe('pass');
  });

  test('matches all four marker variants', () => {
    const md = [
      '~~item A~~ DONE (v0.1.0)',
      '~~item B~~ ✓ (v0.1.0)',
      '~~item C~~ ✅ (v0.1.0)',
      '~~item D~~ Completed (v0.1.0)',
      '### ~~item E~~ (v0.1.0)',
    ].join('\n');
    const r = runCheckStaleness(makeCtx(md, '0.2.0', stubGit()));
    expect(r.status).toBe('fail');
    // 5 findings → 5 stale items (one per line).
    const findings = r.body.filter((l) => l.startsWith('- line '));
    expect(findings.length).toBe(5);
  });

  test('strikethrough without version annotation is ignored', () => {
    const md = '~~Old item with no version~~ DONE\n~~Another~~ ✓\n';
    const r = runCheckStaleness(makeCtx(md, '99.0.0', stubGit()));
    expect(r.status).toBe('pass');
  });

  test('plain (X.Y.Z) parenthetical (no v prefix) is recognized', () => {
    const md = '~~Old~~ DONE (0.3.0)\n';
    const r = runCheckStaleness(makeCtx(md, '0.5.0', stubGit()));
    expect(r.status).toBe('fail');
    expect(r.body.some((l) => l.includes('v0.3.0'))).toBe(true);
  });

  test('finding line numbers are 1-indexed and match input order', () => {
    const md = ['', '', '~~A~~ DONE (v0.1.0)', '', '~~B~~ DONE (v0.2.0)'].join('\n');
    const r = runCheckStaleness(makeCtx(md, '0.5.0', stubGit()));
    const findings = r.body.filter((l) => l.startsWith('- line '));
    expect(findings[0]).toContain('line 3');
    expect(findings[1]).toContain('line 5');
  });
});
