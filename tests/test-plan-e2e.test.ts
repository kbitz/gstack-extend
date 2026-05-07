/**
 * test-plan-e2e.test.ts — end-to-end integration test for /test-plan.
 *
 * The skill itself runs inside a live Claude session (no standalone
 * binary). This test validates the DATA CONTRACTS the skill's phases
 * establish:
 *
 *   - A fixture repo with ROADMAP.md containing a Group+Tracks is
 *     parseable (via parseGroupTracks).
 *   - Fixture review docs under the project store are discoverable by
 *     the expected glob patterns.
 *   - Fixture pair-review state is readable in the 5-category consumption
 *     scheme (PASSED/SKIPPED/DEFERRED/PARKED/FIXED). State now lives at
 *     ~/.gstack/projects/<slug>/pair-review/ — fixtures mirror that shape.
 *   - A simulated /test-plan run writes the expected files to expected paths.
 *   - /qa-only's discovery glob would find the written batch-plan file.
 *   - Archive-then-fresh-write is idempotent.
 *   - TODOS.md Unprocessed append format is correct.
 *   - session.yaml carries the plan_source: test-plan handoff marker.
 *
 * Migrated from scripts/test-test-plan-e2e.sh (deleted in Track 3A).
 *
 * Codex #7 mitigation: the two awk pipelines from the bash version live
 * as pure functions in src/test-plan/parsers.ts with their own ugly-input
 * unit tests (parsers-group-tracks.test.ts, parsers-pair-review-session.test.ts).
 * This file consumes them.
 *
 * Setup convention: each describe() owns its own state. Top-level writes
 * caused order-dependent failures (later writes mutated state under
 * earlier tests). beforeAll() per describe scopes setup correctly.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeBaseTmp } from './helpers/fixture-repo.ts';
import { parseGroupTracks, scanPairReviewSession } from '../src/test-plan/parsers.ts';

const baseTmp = makeBaseTmp('test-plan-e2e-');
afterAll(() => {
  try { rmSync(baseTmp, { recursive: true, force: true }); } catch {}
});

// ─── ROADMAP fixture (pure data, safe to declare at top level) ──────

const ROADMAP_MD = `# Roadmap — Pre-1.0 (v0.x)

Organized as Groups > Tracks > Tasks.

---

## Group 1: Widget Pipeline

Build the widget processing pipeline with validation.

### Track 1A: Widget Core
_1 task · ~1 hour (human) / ~20 min (CC) · medium risk · [src/widget.ts]_
_touches: src/widget.ts_

- **Implement the widget model** -- core data type and persistence. _[src/widget.ts], ~80 lines._ (M)

### Track 1B: Widget Validation
_1 task · ~1 hour (human) / ~20 min (CC) · low risk · [src/validate.ts]_
_touches: src/validate.ts_

- **Add widget validation layer** -- validates inputs and surfaces errors. _[src/validate.ts], ~50 lines._ (S)

### Track 1C: Widget Bug-Bash
_0 tasks · bug-bash only · medium risk · [no code]_
_touches: (none)_

(No implementation work. Bug-bash against integrated build. See /test-plan run widget-pipeline.)

---

## Unprocessed
`;

// ─── ROADMAP parsing (uses pure data — no fs setup) ─────────────────

describe('ROADMAP parsing', () => {
  const groups = parseGroupTracks(ROADMAP_MD);

  test('detects 1 Group in fixture', () => {
    expect(groups).toHaveLength(1);
  });

  test('detects 3 Tracks in Group 1 (including bug-bash Track)', () => {
    expect(groups[0]!.tracks).toHaveLength(3);
  });

  test("Group 1 title slugifies to 'widget-pipeline'", () => {
    expect(slugify(groups[0]!.title)).toBe('widget-pipeline');
  });
});

// ─── Per-describe scratch dirs to keep state isolated ───────────────

describe('fixture review docs', () => {
  const projectDir = join(baseTmp, 'review-docs', '.gstack', 'projects', 'fixture-project');
  beforeAll(() => {
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'test-kbitz-widget-core-ceo-plan-20260420-100000.md'),
      '# CEO Plan\n## Magical moment\nUnder 100ms.\n',
    );
    writeFileSync(
      join(projectDir, 'test-kbitz-widget-core-eng-review-20260420-110000.md'),
      '# Eng Review\n## Architecture\nSQLite.\n',
    );
    writeFileSync(
      join(projectDir, 'test-kbitz-widget-validation-design-review-20260420-120000.md'),
      '# Design Review\n## Error messaging\nClear.\n',
    );
  });

  test('3 review docs planted in project store', () => {
    const docs = readdirSync(projectDir).filter((n) => n.endsWith('.md'));
    expect(docs).toHaveLength(3);
  });
});

describe('review doc discovery', () => {
  const projectDir = join(baseTmp, 'discovery', '.gstack', 'projects', 'fixture-project');
  const repoDir = join(baseTmp, 'discovery', 'fixture-repo');

  beforeAll(() => {
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'test-kbitz-widget-core-ceo-plan-20260420-100000.md'), 'x');
    writeFileSync(join(projectDir, 'test-kbitz-widget-core-eng-review-20260420-110000.md'), 'x');
    writeFileSync(join(projectDir, 'test-kbitz-widget-validation-design-review-20260420-120000.md'), 'x');

    mkdirSync(join(repoDir, 'docs', 'designs'), { recursive: true });
    writeFileSync(join(repoDir, 'docs', 'designs', 'widget-api.md'), 'x');
  });

  function discoverDocsForBranch(branch: string): string[] {
    const branchSlug = branch.replace(/\//g, '-');
    return readdirSync(projectDir)
      .filter((n) => {
        if (!n.includes(`-${branchSlug}-`)) return false;
        return /-plan-/.test(n) || n.includes(`-${branchSlug}-design-`) || /-review-/.test(n);
      })
      .sort();
  }

  test('Track 1A (kbitz/widget-core) discovers 2 docs (ceo-plan + eng-review)', () => {
    expect(discoverDocsForBranch('kbitz/widget-core')).toHaveLength(2);
  });

  test('Track 1B (kbitz/widget-validation) discovers 1 doc (design-review)', () => {
    expect(discoverDocsForBranch('kbitz/widget-validation')).toHaveLength(1);
  });

  test('in-repo docs/designs glob finds 1 doc', () => {
    const designs = readdirSync(join(repoDir, 'docs', 'designs')).filter((n) => n.endsWith('.md'));
    expect(designs).toHaveLength(1);
  });
});

describe('manifest write', () => {
  const projectDir = join(baseTmp, 'manifest', '.gstack', 'projects', 'fixture-project');
  let manifest: string;

  beforeAll(() => {
    const dir = join(projectDir, 'groups', 'widget-pipeline');
    mkdirSync(dir, { recursive: true });
    manifest = join(dir, 'manifest.yaml');
    writeFileSync(
      manifest,
      `schema: 1
group: widget-pipeline
group_title: "Widget Pipeline"
created: 2026-04-21T00:00:00Z
tracks:
  - id: 1A
    name: Widget Core
    branch: kbitz/widget-core
  - id: 1B
    name: Widget Validation
    branch: kbitz/widget-validation
  - id: 1C
    name: Widget Bug-Bash
    branch: main
`,
    );
  });

  test('manifest.yaml created at canonical path', () => {
    expect(existsSync(manifest)).toBe(true);
  });

  test('manifest has required top-level fields', () => {
    const c = readFileSync(manifest, 'utf8');
    expect(c).toMatch(/^schema: 1$/m);
    expect(c).toMatch(/^group: widget-pipeline$/m);
    expect(c).toMatch(/^tracks:$/m);
  });

  test('manifest contains all 3 Tracks', () => {
    const c = readFileSync(manifest, 'utf8');
    const trackCount = (c.match(/^  - id: \d+[A-Z]$/gm) ?? []).length;
    expect(trackCount).toBe(3);
  });
});

describe('prior pair-review consumption', () => {
  const sessionDir = join(baseTmp, 'consume', '.gstack', 'projects', 'fixture', 'pair-review-archived-20260420-150000');

  beforeAll(() => {
    mkdirSync(join(sessionDir, 'groups'), { recursive: true });
    writeFileSync(
      join(sessionDir, 'session.yaml'),
      'project: fixture-project\nbranch: kbitz/widget-core\nstarted: 2026-04-20T14:00:00Z\n',
    );
    writeFileSync(
      join(sessionDir, 'groups', 'widget-core.md'),
      [
        '# Test Group: Widget Core',
        '## Items',
        '### 1. Verify widget list loads under 100ms',
        '- Status: PASSED',
        '### 2. Verify widget creation returns 50ms response',
        '- Status: FAILED',
        '### 3. Verify very long widget names',
        '- Status: SKIPPED',
      ].join('\n'),
    );
    writeFileSync(
      join(sessionDir, 'parked-bugs.md'),
      [
        '# Parked Bugs',
        '## 1. Widget icon flickers on hover',
        '- Status: PARKED',
        '## 2. Typo in widget-empty state',
        '- Status: DEFERRED_TO_TODOS',
      ].join('\n'),
    );
  });

  for (const status of ['PASSED', 'FAILED', 'SKIPPED', 'PARKED', 'DEFERRED_TO_TODOS']) {
    test(`consumed category found: ${status}`, () => {
      const items = scanPairReviewSession(sessionDir, 'kbitz/widget-core');
      expect(items.some((i) => i.status === status)).toBe(true);
    });
  }

  test('branch filter works (wrong branch yields no items)', () => {
    expect(scanPairReviewSession(sessionDir, 'kbitz/some-other-branch')).toEqual([]);
  });
});

describe('Phase 7 archive + write groups file', () => {
  const groupsDir = join(baseTmp, 'phase7', '.gstack', 'projects', 'fixture', 'pair-review', 'groups');
  let archPath: string;
  let groupsFile: string;

  beforeAll(() => {
    mkdirSync(groupsDir, { recursive: true });
    groupsFile = join(groupsDir, 'widget-pipeline.md');
    archPath = join(groupsDir, 'widget-pipeline-archived-20260421-120000.md');

    writeFileSync(groupsFile, '# Test Group: Widget Pipeline (old)\n## Items\n### 1. old item, archive me\n- Status: PASSED\n');
    Bun.spawnSync(['mv', groupsFile, archPath]);
    writeFileSync(
      groupsFile,
      [
        '# Test Group: Widget Pipeline',
        '',
        '## Items',
        '',
        '### 1. Verify widget creation (retest-after-fix)',
        '- Status: UNTESTED',
        '- Provenance: [retest-after-fix] [from parked-bug: kbitz/widget-core]',
        '<!-- test-plan-id: aa112233 -->',
        '',
        '### 2. Verify widget list loads under 100ms',
        '- Status: UNTESTED',
        '- Provenance: [from ceo-review: ceo-plan.md]',
        '<!-- test-plan-id: bb224455 -->',
      ].join('\n'),
    );
  });

  test('old groups file archived', () => {
    expect(existsSync(archPath)).toBe(true);
    expect(readFileSync(archPath, 'utf8')).toContain('old item');
  });

  test('fresh groups file has new items + IDs, no old content', () => {
    const c = readFileSync(groupsFile, 'utf8');
    expect(c).not.toContain('old item');
    expect(c).toContain('test-plan-id');
  });

  test('item ID comment uses canonical format', () => {
    const c = readFileSync(groupsFile, 'utf8');
    expect(/^<!-- test-plan-id: [a-f0-9]{8} -->$/m.test(c)).toBe(true);
  });
});

describe('Phase 6 batch-plan write', () => {
  const projectDir = join(baseTmp, 'phase6', '.gstack', 'projects', 'fixture-project');
  let batch: string;

  beforeAll(() => {
    mkdirSync(projectDir, { recursive: true });
    batch = join(projectDir, 'tester-main-test-plan-batch-20260421-120000.md');
    writeFileSync(
      batch,
      `---
schema: 1
name: test-plan-batch
group: widget-pipeline
group_title: "Widget Pipeline"
generated: 2026-04-21T12:00:00Z
generated_by: /test-plan run
build_branch: main
build_commit: abc1234
manifest: ${join(projectDir, 'groups', 'widget-pipeline', 'manifest.yaml')}
---

# Test Plan: Widget Pipeline

## Affected Pages/Routes
- [\`abc11111\`] [from diff] /widgets list page

## Key Interactions to Verify
- [\`bb224455\`] [from ceo-review: ceo-plan.md] Verify list loads under 100ms.

## Edge Cases
- [\`dd446677\`] [from eng-review: eng.md] List under 200ms with 1000.

## Critical Paths
_none_

## Known Deferred
- Typo. See TODOS.md.

## Automated (v2, not yet executed)
- [\`ff668899\`] [from design-doc: docs/designs/widget-api.md] POST returns 201.

## Manual (for /pair-review)
- [\`aa112233\`] [retest-after-fix] [from parked-bug: kbitz/widget-core] 50ms.

## Items Surfaced From Prior Sessions (user decision required)
- Long names don't overflow.

## Provenance Index

| ID | Source | Rationale |
|----|--------|-----------|
| \`bb224455\` | \`ceo-plan.md\` §Magical | "under 100ms" |
`,
    );
  });

  test('batch plan written at project-scoped path', () => {
    expect(existsSync(batch)).toBe(true);
  });

  test('batch plan matches qa-only glob *-test-plan-*.md', () => {
    const matches = readdirSync(projectDir).filter((n) => /-test-plan-.*\.md$/.test(n));
    expect(matches.length).toBeGreaterThan(0);
  });

  for (const field of [
    'schema: 1',
    'name: test-plan-batch',
    'group: widget-pipeline',
    'generated_by: /test-plan run',
    'build_commit:',
    'manifest:',
  ]) {
    test(`batch plan front-matter has: ${field}`, () => {
      expect(readFileSync(batch, 'utf8')).toContain(field);
    });
  }

  for (const section of [
    '## Affected Pages/Routes',
    '## Key Interactions to Verify',
    '## Edge Cases',
    '## Critical Paths',
    '## Known Deferred',
    '## Automated (v2',
    '## Manual (for /pair-review)',
    '## Items Surfaced From Prior Sessions',
    '## Provenance Index',
  ]) {
    test(`batch plan section present: ${section}`, () => {
      expect(readFileSync(batch, 'utf8')).toContain(section);
    });
  }
});

describe('TODOS.md append', () => {
  const todosPath = join(baseTmp, 'todos', 'docs', 'TODOS.md');

  beforeAll(() => {
    mkdirSync(join(baseTmp, 'todos', 'docs'), { recursive: true });
    writeFileSync(
      todosPath,
      '# TODOS\n\n## Unprocessed\n\n- [pair-review] Existing parked bug — example\n\n',
    );

    const NEW_BUG = '- [test-plan] Widget icon flickers on hover — found on branch main (2026-04-21)';
    const updated = readFileSync(todosPath, 'utf8').replace(
      /(## Unprocessed\n\n)/,
      `$1${NEW_BUG}\n`,
    );
    writeFileSync(todosPath, updated);
  });

  test('bug appended with [test-plan] tag', () => {
    expect(readFileSync(todosPath, 'utf8')).toContain('[test-plan] Widget icon flickers on hover');
  });

  test('existing Unprocessed entry preserved', () => {
    expect(readFileSync(todosPath, 'utf8')).toContain('[pair-review] Existing parked bug');
  });
});

describe('idempotence: multiple archive generations coexist', () => {
  const groupsDir = join(baseTmp, 'idempotence', '.gstack', 'projects', 'fixture', 'pair-review', 'groups');
  let arch1: string;
  let arch2: string;
  let groupsFile: string;

  beforeAll(() => {
    mkdirSync(groupsDir, { recursive: true });
    groupsFile = join(groupsDir, 'wp.md');
    arch1 = join(groupsDir, 'wp-archived-A.md');
    arch2 = join(groupsDir, 'wp-archived-B.md');

    writeFileSync(groupsFile, 'gen-1\n');
    Bun.spawnSync(['mv', groupsFile, arch1]);
    writeFileSync(groupsFile, 'gen-2\n');
    Bun.spawnSync(['mv', groupsFile, arch2]);
    writeFileSync(groupsFile, '# After 2nd run\n## Items\n### 1. Second-run item\n- Status: UNTESTED\n');
  });

  test('multiple re-run archives coexist', () => {
    expect(existsSync(arch1)).toBe(true);
    expect(existsSync(arch2)).toBe(true);
  });

  test('second-run groups file has fresh content', () => {
    expect(readFileSync(groupsFile, 'utf8')).toContain('Second-run item');
  });
});

describe('session.yaml handoff marker', () => {
  const session = join(baseTmp, 'session', '.gstack', 'projects', 'fixture', 'pair-review', 'session.yaml');

  beforeAll(() => {
    mkdirSync(join(baseTmp, 'session', '.gstack', 'projects', 'fixture', 'pair-review'), { recursive: true });
    writeFileSync(
      session,
      `project: fixture-project
branch: main
started: 2026-04-21T12:00:00Z
build_commit: abc1234
plan_source: test-plan
active_groups:
  - widget-pipeline
`,
    );
  });

  test('carries plan_source: test-plan', () => {
    expect(/^plan_source: test-plan$/m.test(readFileSync(session, 'utf8'))).toBe(true);
  });
});

// ─── helper ─────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
