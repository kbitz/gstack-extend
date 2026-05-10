/**
 * check-group-deps.test.ts — unit coverage for the inter-Group DAG check.
 *
 * The shadow runner already covers fixture-driven byte parity, so this
 * suite focuses on shapes that fixtures don't exercise directly:
 *   - Forward references (explicit dep to nonexistent Group).
 *   - Cycle detection on multi-Group cycles.
 *   - STALE_DEPS warn when an anchored "Group N (Name)" annotation drifts.
 *   - ADJACENCY rendering, which is always emitted regardless of status.
 */

import { describe, expect, test } from 'bun:test';

import { runCheckGroupDeps } from '../src/audit/checks/group-deps.ts';
import type { ParsedRoadmap, GroupInfo } from '../src/audit/parsers/roadmap.ts';
import type { AuditCtx } from '../src/audit/types.ts';

function makeCtx(groups: GroupInfo[]): AuditCtx {
  const roadmap: ParsedRoadmap = {
    groups,
    tracks: [],
    styleLintWarnings: [],
    sizeLabelMismatches: [],
    trackDepCycles: [],
  };
  // Most ctx fields are unused by GROUP_DEPS — keep them as type-safe stubs.
  return {
    repoRoot: '/tmp/x',
    extendDir: '/tmp/x',
    env: { stateDir: '/tmp/x' },
    git: {
      toplevel: () => null,
      tags: () => [],
      tagsLatest: () => null,
      diffNamesBetween: () => [],
      logFirstWithPhrase: () => null,
      logSubjectsSince: () => [],
    },
    paths: { todos: null, roadmap: 'ROADMAP.md', progress: null },
    files: {
      roadmap: '',
      todos: '',
      progress: '',
      version: '',
      changelog: '',
      pyproject: '',
    },
    exists: {
      rootTodos: false, docsTodos: false, rootRoadmap: false, docsRoadmap: true,
      rootProgress: false, docsProgress: false, versionFile: false, pyprojectFile: false,
      changelogFile: false, docsDir: true, designsDir: false,
      rootReadme: false, docsReadme: false, rootChangelog: false, docsChangelog: false,
      rootClaude: false, docsClaude: false, rootVersion: false, docsVersion: false,
      rootLicense: false, docsLicense: false, rootLicenseMd: false, docsLicenseMd: false,
    },
    designs: [],
    scaffoldExists: new Map(),
    roadmap: { value: roadmap, errors: [] },
    phases: { value: { phases: [] }, errors: [] },
    todos: { value: { hasUnprocessedSection: false, entries: [] }, errors: [] },
    progress: { value: { versions: [], latestVersion: null, rawTableLines: [] }, errors: [] },
    version: {
      current: '0.1.0',
      source: 'VERSION',
      latestTag: null,
      progressLatest: null,
      changelogLatest: null,
    },
  };
}

function group(num: string, name: string, opts: Partial<GroupInfo> = {}): GroupInfo {
  return {
    num,
    name,
    isComplete: false,
    deps: { kind: 'unspecified' },
    depsRaw: null,
    depAnchors: [],
    serialize: false,
    hasPreflight: false,
    trackIds: [],
    ...opts,
  };
}

describe('check_group_deps', () => {
  test('skips when no groups parsed', () => {
    const r = runCheckGroupDeps(makeCtx([]));
    expect(r.status).toBe('skip');
    expect(r.body).toContain('- No Groups in ROADMAP.md');
  });

  test('emits ADJACENCY block even on pass', () => {
    const r = runCheckGroupDeps(
      makeCtx([
        group('1', 'A'),
        group('2', 'B'),
      ]),
    );
    expect(r.status).toBe('pass');
    // Default rule: Group 2 depends on Group 1 (the previous group).
    expect(r.body).toContain('ADJACENCY:');
    expect(r.body).toContain('- Group 1 ← {}');
    expect(r.body).toContain('- Group 2 ← {1}');
  });

  test('flags forward reference as fail', () => {
    const r = runCheckGroupDeps(
      makeCtx([
        group('1', 'A', { deps: { kind: 'list', depNums: ['9'] }, depsRaw: 'Group 9' }),
      ]),
    );
    expect(r.status).toBe('fail');
    expect(r.body.some((l) => l.includes('forward reference'))).toBe(true);
    // Adjacency still emitted.
    expect(r.body).toContain('ADJACENCY:');
  });

  test('detects 2-cycle', () => {
    const r = runCheckGroupDeps(
      makeCtx([
        group('1', 'A', { deps: { kind: 'list', depNums: ['2'] }, depsRaw: 'Group 2' }),
        group('2', 'B', { deps: { kind: 'list', depNums: ['1'] }, depsRaw: 'Group 1' }),
      ]),
    );
    expect(r.status).toBe('fail');
    const cycleLine = r.body.find((l) => l.startsWith('- Cycle detected'));
    expect(cycleLine).toBeDefined();
    // Members are listed numerically.
    expect(cycleLine).toContain('1,2');
  });

  test('detects 3-cycle', () => {
    const r = runCheckGroupDeps(
      makeCtx([
        group('1', 'A', { deps: { kind: 'list', depNums: ['3'] }, depsRaw: 'Group 3' }),
        group('2', 'B', { deps: { kind: 'list', depNums: ['1'] }, depsRaw: 'Group 1' }),
        group('3', 'C', { deps: { kind: 'list', depNums: ['2'] }, depsRaw: 'Group 2' }),
      ]),
    );
    expect(r.status).toBe('fail');
    const cycleLine = r.body.find((l) => l.startsWith('- Cycle detected'));
    expect(cycleLine).toContain('1,2,3');
  });

  test('explicit "none" suppresses default-prev', () => {
    const r = runCheckGroupDeps(
      makeCtx([
        group('1', 'A'),
        group('2', 'B', { deps: { kind: 'none' }, depsRaw: 'none' }),
      ]),
    );
    expect(r.status).toBe('pass');
    expect(r.body).toContain('- Group 2 ← {}');
  });

  test('STALE_DEPS warn when anchored name drifts', () => {
    const r = runCheckGroupDeps(
      makeCtx([
        group('1', 'Bun Test Migration'),
        group('2', 'Wire helpers', {
          deps: { kind: 'list', depNums: ['1'] },
          depsRaw: 'Group 1 (Old Name)',
          depAnchors: [{ depNum: '1', name: 'Old Name' }],
        }),
      ]),
    );
    expect(r.status).toBe('warn');
    const warnLine = r.body.find((l) => l.includes('is now titled'));
    expect(warnLine).toBeDefined();
    expect(warnLine).toContain('"Bun Test Migration"');
  });

  test('forward-ref + stale-anchor → fail (warn still rendered)', () => {
    const r = runCheckGroupDeps(
      makeCtx([
        group('1', 'A', {
          deps: { kind: 'list', depNums: ['2', '99'] },
          depsRaw: 'Group 2 (Old), Group 99',
          depAnchors: [{ depNum: '2', name: 'Old' }],
        }),
        group('2', 'New'),
      ]),
    );
    expect(r.status).toBe('fail');
    expect(r.body.some((l) => l.includes('forward reference'))).toBe(true);
    expect(r.body.some((l) => l.includes('is now titled'))).toBe(true);
  });

  test('numerically sorted output even for non-doc-order groups', () => {
    // Parser preserves doc order; check sorts numerically. This makes the
    // adjacency stable regardless of how ROADMAP.md authors reordered headings.
    const r = runCheckGroupDeps(
      makeCtx([
        group('10', 'A'),
        group('2', 'B'),
        group('1', 'C'),
      ]),
    );
    const adjStart = r.body.indexOf('ADJACENCY:');
    expect(adjStart).toBeGreaterThanOrEqual(0);
    expect(r.body[adjStart + 1]).toBe('- Group 1 ← {}');
    expect(r.body[adjStart + 2]).toBe('- Group 2 ← {1}');
    expect(r.body[adjStart + 3]).toBe('- Group 10 ← {2}');
  });
});
