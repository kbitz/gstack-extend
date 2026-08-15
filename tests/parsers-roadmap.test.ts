import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  mergeShippedArchive,
  parseRoadmap,
  type ParseRoadmapDeps,
} from '../src/audit/parsers/roadmap.ts';

// Use a known stateDir so effortToLoc never reads ~/.gstack-extend/config.
function deps(): ParseRoadmapDeps {
  const tmp = mkdtempSync(join(tmpdir(), 'gse-rm-'));
  // Best-effort cleanup; tests are short-lived.
  process.on('exit', () => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
  });
  return { env: {}, stateDir: tmp, warn: () => {} };
}

describe('parseRoadmap — edges', () => {
  test('empty content yields empty parsed state', () => {
    const r = parseRoadmap('', deps());
    expect(r.errors).toEqual([]);
    expect(r.value.groups).toEqual([]);
    expect(r.value.tracks).toEqual([]);
    expect(r.value.styleLintWarnings).toEqual([]);
    expect(r.value.sizeLabelMismatches).toEqual([]);
    expect(r.value.trackDepCycles).toEqual([]);
  });

  test('content without any Group/Track headings yields empty', () => {
    const r = parseRoadmap('# Title\n\nSome prose.\n', deps());
    expect(r.value.groups).toEqual([]);
    expect(r.value.tracks).toEqual([]);
  });
});

describe('parseRoadmap — Groups', () => {
  test('single group + name trim', () => {
    const r = parseRoadmap('## Group 1: Foundation\n', deps());
    expect(r.value.groups).toHaveLength(1);
    expect(r.value.groups[0]!.num).toBe('1');
    expect(r.value.groups[0]!.name).toBe('Foundation');
    expect(r.value.groups[0]!.isComplete).toBe(false);
  });

  test('Group ✓ Complete suffix detected and stripped', () => {
    const r = parseRoadmap('## Group 1: Foundation ✓ Complete\n', deps());
    expect(r.value.groups[0]!.name).toBe('Foundation');
    expect(r.value.groups[0]!.isComplete).toBe(true);
  });

  test('multiple groups in document order', () => {
    const r = parseRoadmap(
      '## Group 1: A\n## Group 2: B\n## Group 3: C\n',
      deps(),
    );
    expect(r.value.groups.map((g) => g.num)).toEqual(['1', '2', '3']);
  });

  test('duplicate Group N is ignored (first wins)', () => {
    const r = parseRoadmap(
      '## Group 1: First\n## Group 1: Second\n',
      deps(),
    );
    expect(r.value.groups).toHaveLength(1);
    expect(r.value.groups[0]!.name).toBe('First');
  });
});

describe('parseRoadmap — state-section enclosure (v2) drives completion', () => {
  // Deterministic coverage of the exact path the real-world ROADMAP test used
  // to assert via hard-coded group numbers (which drifted every ship). A Group
  // under `## Shipped` resolves to `shipped` purely by section enclosure — even
  // with NO inline `✓` marker — and a Group under `## Current Plan` resolves to
  // `current-plan`. Section enclosure takes precedence over inline markers
  // (roadmap.ts), so omitting the marker isolates the enclosure logic.
  test('Group under ## Shipped is complete; under ## Current Plan is not (no inline markers)', () => {
    const md = [
      '## Current Plan',
      '### Group 1: Active',
      '### Track 1A: Do the thing',
      '',
      '## Shipped',
      '#### Group 2: Done',
      '- Track 2A — shipped (v1.0.0)',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    const g1 = r.value.groups.find((g) => g.num === '1');
    const g2 = r.value.groups.find((g) => g.num === '2');
    expect(g1?.state).toBe('current-plan');
    expect(g1?.isComplete).toBe(false);
    expect(g2?.state).toBe('shipped');
    expect(g2?.isComplete).toBe(true);
  });
});

describe('parseRoadmap — Group _Depends on:_', () => {
  test('none / em-dash / single dash all map to kind: none', () => {
    for (const annotation of ['none', '—', '-', '---']) {
      const r = parseRoadmap(
        `## Group 2: B\n_Depends on: ${annotation}_\n`,
        deps(),
      );
      expect(r.value.groups[0]!.deps).toEqual({ kind: 'none' });
      expect(r.value.groups[0]!.depsRaw).toBe(annotation);
    }
  });

  test('"Group N" dep lists single number', () => {
    const r = parseRoadmap(
      '## Group 2: B\n_Depends on: Group 1_\n',
      deps(),
    );
    expect(r.value.groups[0]!.deps).toEqual({ kind: 'list', depNums: ['1'] });
  });

  test('"Group N (Name)" captures dep anchor', () => {
    const r = parseRoadmap(
      '## Group 3: C\n_Depends on: Group 1 (Foundation)_\n',
      deps(),
    );
    expect(r.value.groups[0]!.deps).toEqual({ kind: 'list', depNums: ['1'] });
    expect(r.value.groups[0]!.depAnchors).toEqual([
      { depNum: '1', name: 'Foundation' },
    ]);
  });

  test('comma-separated multiple deps', () => {
    const r = parseRoadmap(
      '## Group 4: D\n_Depends on: Group 1, Group 2, Group 3_\n',
      deps(),
    );
    expect(r.value.groups[0]!.deps).toEqual({
      kind: 'list',
      depNums: ['1', '2', '3'],
    });
  });

  test('trailing prose after Group N (Name) is ignored for parsing', () => {
    const r = parseRoadmap(
      '## Group 2: B\n_Depends on: Group 1 (Foundation) landing first_\n',
      deps(),
    );
    expect(r.value.groups[0]!.deps).toEqual({ kind: 'list', depNums: ['1'] });
  });

  test('unparseable annotation surfaces a style lint warning', () => {
    const r = parseRoadmap(
      '## Group 2: B\n_Depends on: see notes_\n',
      deps(),
    );
    expect(r.value.groups[0]!.deps).toEqual({ kind: 'unspecified' });
    expect(r.value.styleLintWarnings).toHaveLength(1);
    expect(r.value.styleLintWarnings[0]).toContain('Group 2');
    expect(r.value.styleLintWarnings[0]).toContain('"see notes"');
  });

  test('depsRaw preserved for display even when parsed', () => {
    const r = parseRoadmap(
      '## Group 2: B\n_Depends on: Group 1 (Foundation), Group 5 (Testing)_\n',
      deps(),
    );
    expect(r.value.groups[0]!.depsRaw).toBe(
      'Group 1 (Foundation), Group 5 (Testing)',
    );
  });
});

// `_serialize: true_` and Pre-flight subsection were v1 primitives. Both
// are gone in v2 — sequential file work belongs in different Groups (or
// merged into one Track), and shared-infra-before-parallel work belongs
// in a small earlier Group, not a sub-section of the same Group.

describe('parseRoadmap — Tracks', () => {
  test('basic Track parses ID and group attribution', () => {
    const md = ['## Group 1: A', '### Track 1A: Foo', ''].join('\n');
    const r = parseRoadmap(md, deps());
    expect(r.value.tracks).toHaveLength(1);
    expect(r.value.tracks[0]!.id).toBe('1A');
    expect(r.value.tracks[0]!.groupNum).toBe('1');
    expect(r.value.tracks[0]!.title).toBe('Foo');
    expect(r.value.tracks[0]!.legacy).toBe(true); // no _touches:_ yet
  });

  test('Track ID with sub-number (e.g. 2A.1)', () => {
    const md = ['## Group 2: B', '### Track 2A.1: Sub', ''].join('\n');
    const r = parseRoadmap(md, deps());
    expect(r.value.tracks[0]!.id).toBe('2A.1');
  });

  test('Track ✓ Complete suffix detected', () => {
    const md = ['## Group 1: A', '### Track 1A: Foo ✓ Complete', ''].join('\n');
    const r = parseRoadmap(md, deps());
    expect(r.value.tracks[0]!.isComplete).toBe(true);
    expect(r.value.tracks[0]!.title).toBe('Foo');
  });

  test('duplicate Track ID surfaces warning', () => {
    const md = [
      '## Group 1: A',
      '### Track 1A: First',
      '## Group 2: B',
      '### Track 1A: Second (duplicate ID)',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    expect(r.value.styleLintWarnings.some((w) => w.includes('duplicate'))).toBe(true);
    expect(r.value.tracks).toHaveLength(1); // only the first registered
  });
});

describe('parseRoadmap — _touches:_', () => {
  test('comma-separated paths populate touches and clear legacy', () => {
    const md = [
      '## Group 1: A',
      '### Track 1A: Foo',
      '_touches: src/a.ts, src/b.ts, src/c.ts_',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    const t = r.value.tracks[0]!;
    expect(t.touches).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect(t.filesCount).toBe(3);
    expect(t.legacy).toBe(false);
  });

  test('empty _touches:_ keeps track legacy + warns', () => {
    const md = [
      '## Group 1: A',
      '### Track 1A: Foo',
      '_touches: _',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    const t = r.value.tracks[0]!;
    expect(t.legacy).toBe(true);
    expect(t.filesCount).toBe(0);
    expect(r.value.styleLintWarnings.some((w) => w.includes('empty or whitespace-only'))).toBe(
      true,
    );
  });

  test('whitespace-containing token rejected, malformed flag warns', () => {
    const md = [
      '## Group 1: A',
      '### Track 1A: Foo',
      '_touches: src/a.ts, has space, src/b.ts_',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    const t = r.value.tracks[0]!;
    expect(t.touches).toEqual(['src/a.ts', 'src/b.ts']);
    expect(t.filesCount).toBe(2);
    expect(r.value.styleLintWarnings.some((w) => w.includes('whitespace'))).toBe(true);
  });

  test('path (new) is a legal touch token', () => {
    const md = [
      '## Group 1: A',
      '### Track 1A: Foo',
      '_touches: src/a.ts (new), src/b.ts_',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    const t = r.value.tracks[0]!;
    expect(t.touches).toEqual(['src/a.ts (new)', 'src/b.ts']);
    expect(t.legacy).toBe(false);
    expect(r.value.styleLintWarnings.some((w) => w.includes('whitespace'))).toBe(false);
  });

  test('= in token rejected (kv-store separator)', () => {
    const md = [
      '## Group 1: A',
      '### Track 1A: Foo',
      '_touches: src/a.ts, key=value, src/c.ts_',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    expect(r.value.tracks[0]!.touches).toEqual(['src/a.ts', 'src/c.ts']);
  });
});

describe('parseRoadmap — Track _Depends on:_', () => {
  test('intra-group Track dep recorded', () => {
    const md = [
      '## Group 1: A',
      '### Track 1A: First',
      '### Track 1B: Second',
      'Depends on: Track 1A',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    const t1b = r.value.tracks.find((t) => t.id === '1B')!;
    expect(t1b.deps).toEqual(['1A']);
  });

  test('cross-group Track dep ignored (Group-level handles cross-group)', () => {
    const md = [
      '## Group 1: A',
      '### Track 1A: First',
      '## Group 2: B',
      '### Track 2A: After',
      'Depends on: Track 1A',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    const t2a = r.value.tracks.find((t) => t.id === '2A')!;
    expect(t2a.deps).toEqual([]);
  });

  test('self-reference warns, no edge added', () => {
    const md = [
      '## Group 1: A',
      '### Track 1A: First',
      'Depends on: Track 1A',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    const t1a = r.value.tracks[0]!;
    expect(t1a.deps).toEqual([]);
    expect(r.value.styleLintWarnings.some((w) => w.includes('Depends on itself'))).toBe(true);
  });

  test('free-text Depends on: sets freetext flag', () => {
    const md = [
      '## Group 1: A',
      '### Track 1A: First',
      'Depends on: at least one major version bump',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    expect(r.value.tracks[0]!.depsFreetext).toBe(true);
    expect(r.value.tracks[0]!.deps).toEqual([]);
  });

  test('multiple deps deduped', () => {
    const md = [
      '## Group 1: A',
      '### Track 1A: First',
      '### Track 1B: Second',
      '### Track 1C: Third',
      'Depends on: Track 1A',
      'Depends on: Track 1B',
      'Depends on: Track 1A', // duplicate
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    const t1c = r.value.tracks.find((t) => t.id === '1C')!;
    expect(t1c.deps).toEqual(['1A', '1B']);
  });
});

describe('parseRoadmap — task lines', () => {
  test('task with effort tag accumulates LOC and tasksCount', () => {
    const md = [
      '## Group 1: A',
      '### Track 1A: Foo',
      '- **Implement foo** -- description (S)',
      '- **Implement bar** -- description (M)',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    const t = r.value.tracks[0]!;
    expect(t.tasksCount).toBe(2);
    // S=50, M=150 → 200
    expect(t.loc).toBe(200);
  });

  test('task without effort tag still counted (no LOC)', () => {
    const md = [
      '## Group 1: A',
      '### Track 1A: Foo',
      '- **Implement foo** -- no effort suffix',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    const t = r.value.tracks[0]!;
    expect(t.tasksCount).toBe(1);
    expect(t.loc).toBe(0);
    expect(t.untaggedWriteTasks).toBe(1);
    expect(t.sessionWeight).toBe(0);
  });

  test('size label mismatch when declared lines diverges >3x from effort tier', () => {
    // S = 50 LOC. ~200 lines is 4x → mismatch.
    const md = [
      '## Group 1: A',
      '### Track 1A: Foo',
      '- **Implement foo** -- ~200 lines (S)',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    expect(r.value.sizeLabelMismatches).toHaveLength(1);
    expect(r.value.sizeLabelMismatches[0]).toMatchObject({
      trackId: '1A',
      title: 'Implement foo',
      effort: 'S',
      declaredLines: 200,
      expectedLoc: 50,
    });
  });

  test('size label NOT flagged when within 3x', () => {
    // S = 50 LOC. ~100 lines is 2x → no mismatch.
    const md = [
      '## Group 1: A',
      '### Track 1A: Foo',
      '- **Implement foo** -- ~100 lines (S)',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    expect(r.value.sizeLabelMismatches).toEqual([]);
  });

  test('trailing _Source: after effort tag still counts', () => {
    const md = [
      '## Group 1: A',
      '### Track 1A: Foo',
      '- **Reconcile** -- body. (S) _Source: [ship:track=13A]._',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    const t = r.value.tracks[0]!;
    expect(t.untaggedWriteTasks).toBe(0);
    expect(t.sessionWeight).toBe(1);
  });

  test('inline italics in title still parse', () => {
    const md = [
      '## Group 1: A',
      '### Track 1A: Foo',
      '- **~~X~~ -- the richest *raw* yield** -- body (M)',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    expect(r.value.tracks[0]!.sessionWeight).toBe(2);
    expect(r.value.tracks[0]!.untaggedWriteTasks).toBe(0);
  });

  test('compound tag is named, not silently untagged', () => {
    const md = [
      '## Group 1: A',
      '### Track 1A: Foo',
      '- **Implement foo** -- body (S-M)',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    expect(r.value.tracks[0]!.untaggedWriteTasks).toBe(1);
    expect(r.value.effortTagFindings.some((f) => f.includes('(S-M)'))).toBe(true);
  });

  test('done-marker title is excluded from weight', () => {
    const md = [
      '## Group 1: A',
      '### Track 1A: Foo',
      '- **G0 ✓ RUN 2026-08-14** -- leftover',
      '- **Real work** -- body (S)',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    expect(r.value.tracks[0]!.sessionWeight).toBe(1);
    expect(r.value.tracks[0]!.untaggedWriteTasks).toBe(0);
    expect(r.value.effortTagFindings.some((f) => f.includes('looks done'))).toBe(true);
  });

  test('declared 0 lines does not trigger /0 (matches bash guard)', () => {
    const md = [
      '## Group 1: A',
      '### Track 1A: Foo',
      '- **Implement foo** -- ~0 lines (S)',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    expect(r.value.sizeLabelMismatches).toEqual([]);
  });
});

describe('parseRoadmap — top-level skip sections', () => {
  test('## Future stops Track parsing', () => {
    const md = [
      '## Group 1: A',
      '### Track 1A: First',
      '## Future',
      '- **Future item** (S)',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    expect(r.value.tracks).toHaveLength(1);
    expect(r.value.tracks[0]!.tasksCount).toBe(0);
  });

  test('## Unprocessed stops Track parsing', () => {
    const md = [
      '## Group 1: A',
      '### Track 1A: First',
      '## Unprocessed',
      '- **Unprocessed item** (S)',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    expect(r.value.tracks[0]!.tasksCount).toBe(0);
  });

  test('## Execution Map stops Track parsing', () => {
    const md = [
      '## Group 1: A',
      '### Track 1A: First',
      '## Execution Map',
      '- **Mapped item** (S)',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    expect(r.value.tracks[0]!.tasksCount).toBe(0);
  });
});

describe('parseRoadmap — cycle detection', () => {
  test('1A→1B→1A cycle detected and canonicalized', () => {
    const md = [
      '## Group 1: A',
      '### Track 1A: First',
      'Depends on: Track 1B',
      '### Track 1B: Second',
      'Depends on: Track 1A',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    expect(r.value.trackDepCycles).toContain('1A → 1B → 1A');
  });

  test('canonical form is deduped regardless of DFS root', () => {
    // 1A→1B→1C→1A — three roots can each find the cycle, but it should
    // dedup to a single canonical string.
    const md = [
      '## Group 1: A',
      '### Track 1A: First',
      'Depends on: Track 1B',
      '### Track 1B: Second',
      'Depends on: Track 1C',
      '### Track 1C: Third',
      'Depends on: Track 1A',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    expect(r.value.trackDepCycles).toEqual(['1A → 1B → 1C → 1A']);
  });

  test('no cycle in linear chain', () => {
    const md = [
      '## Group 1: A',
      '### Track 1A: First',
      '### Track 1B: Second',
      'Depends on: Track 1A',
      '### Track 1C: Third',
      'Depends on: Track 1B',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    expect(r.value.trackDepCycles).toEqual([]);
  });
});

describe('parseRoadmap — real-world: gstack-extend ROADMAP.md', () => {
  test('parses without errors and produces sensible counts', async () => {
    const path = join(import.meta.dir, '..', 'docs', 'ROADMAP.md');
    const file = Bun.file(path);
    const content = await file.text();
    const r = parseRoadmap(content, deps());
    expect(r.errors).toEqual([]);
    // Frozen anchors: Groups 1 and 5 are permanently in `## Shipped`, so the
    // parser resolves them to `shipped` via section enclosure. These never
    // drift as the roadmap advances. Specific *active* group/track numbers are
    // intentionally NOT asserted here — they migrate into `## Shipped` on every
    // ship and rot the assertion (the bug Track 14A fixed). Lifecycle behavior
    // is covered deterministically by the synthetic `state-section enclosure`
    // fixture, not by reading the live document.
    const g1 = r.value.groups.find((g) => g.num === '1');
    expect(g1?.isComplete).toBe(true);
    const g5 = r.value.groups.find((g) => g.num === '5');
    expect(g5?.isComplete).toBe(true);
    // Group dep parse: kinds limited to 'unspecified' / 'none' / 'list'.
    // Unspecified means none (v3). No Group should have a malformed deps block.
    for (const g of r.value.groups) {
      expect(['unspecified', 'none', 'after', 'list']).toContain(g.deps.kind);
    }
    // Sanity: at least 10 groups, several tracks (real-repo shape).
    expect(r.value.groups.length).toBeGreaterThanOrEqual(10);
    expect(r.value.tracks.length).toBeGreaterThanOrEqual(7);
  });
});

describe('parseRoadmap — card fields + session weight', () => {
  test('parses _out / _read-first / _produces / _blocked-by', () => {
    const md = [
      '## Current Plan',
      '#### Group 1: A',
      '##### Track 1A: Title',
      '_1 task . ~S . low risk . [a.ts]_',
      '_touches: src/a.ts_',
      '_out: 1B, 2A_',
      '_read-first: 0A, docs/designs/foo.md_',
      '_produces: typed accessors on UbiquitousKVStore_',
      '_blocked-by: Track 0A_',
      '- **Do it** -- yes. _src/a.ts, ~20 lines._ (S)',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    const t = r.value.tracks[0]!;
    expect(t.out).toEqual(['1B', '2A']);
    expect(t.readFirst).toEqual(['0A', 'docs/designs/foo.md']);
    expect(t.produces).toBe('typed accessors on UbiquitousKVStore');
    expect(t.blockedBy).toEqual(['0A']);
    expect(t.sessionWeight).toBe(1);
    expect(t.markdownOnly).toBe(false);
  });

  test('mixed Track-ref and bare IDs are unioned; lowercase is canonicalized', () => {
    const md = [
      '## Current Plan',
      '#### Group 1: A',
      '##### Track 1A: T',
      '_touches: src/a.ts_',
      '_blocked-by: Track 15a, 16B_',
      '- **Do it** -- yes. _src/a.ts, ~20 lines._ (S)',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    expect(r.value.tracks[0]!.blockedBy).toEqual(['15A', '16B']);
  });

  test('delete task is weight S even when tagged L', () => {
    const md = [
      '## Current Plan',
      '#### Group 1: A',
      '##### Track 1A: Trim',
      '_1 task . ~L . low risk . [skills/foo.md]_',
      '_touches: skills/foo.md_',
      '- **Delete dead helper** -- gone. _skills/foo.md, ~2000 lines (del)._ (L)',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    const t = r.value.tracks[0]!;
    expect(t.sessionWeight).toBe(1);
    expect(t.deleteOnly).toBe(true);
    expect(t.markdownOnly).toBe(true);
    expect(t.sizeLabelMismatches ?? r.value.sizeLabelMismatches).toEqual([]);
  });

  test('title verb without (del) is not a delete', () => {
    const md = [
      '## Current Plan',
      '#### Group 1: A',
      '##### Track 1A: Trim skill',
      '_1 task . ~M . low risk . [skills/pair-review.md]_',
      '_touches: skills/pair-review.md_',
      '- **Trim pair-review.md** -- rewrite. _skills/pair-review.md, ~100 lines._ (M)',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    const t = r.value.tracks[0]!;
    expect(t.sessionWeight).toBe(2);
    expect(t.deleteOnly).toBe(false);
  });

  test('Implement trim() helper is not a delete', () => {
    const md = [
      '## Current Plan',
      '#### Group 1: A',
      '##### Track 1A: Util',
      '_1 task . ~M . low risk . [src/trim.ts]_',
      '_touches: src/trim.ts_',
      '- **Implement trim() helper** -- add util. _src/trim.ts, ~80 lines._ (M)',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    const t = r.value.tracks[0]!;
    expect(t.sessionWeight).toBe(2);
    expect(t.deleteOnly).toBe(false);
  });

  test('(del) hint without a title verb is still a delete', () => {
    const md = [
      '## Current Plan',
      '#### Group 1: A',
      '##### Track 1A: Drop',
      '_1 task . ~L . low risk . [src/old.ts]_',
      '_touches: src/old.ts_',
      '- **Drop the unused helper** -- gone. _src/old.ts, ~40 lines (del)._ (L)',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    const t = r.value.tracks[0]!;
    expect(t.sessionWeight).toBe(1);
    expect(t.deleteOnly).toBe(true);
  });

  test('mixed delete + write is not deleteOnly', () => {
    const md = [
      '## Current Plan',
      '#### Group 1: A',
      '##### Track 1A: Mix',
      '_2 tasks . ~M . low risk . [src/a.ts]_',
      '_touches: src/a.ts_',
      '- **Delete dead helper** -- gone. _src/old.ts, ~10 lines (del)._ (L)',
      '- **Write new** -- . _src/a.ts, ~80 lines._ (M)',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    const t = r.value.tracks[0]!;
    expect(t.deleteOnly).toBe(false);
    expect(t.sessionWeight).toBe(3);
  });

  test('two M write-tasks sum to weight 4', () => {
    const md = [
      '## Current Plan',
      '#### Group 1: A',
      '##### Track 1A: Two',
      '_2 tasks . ~M . low risk . [a.ts]_',
      '_touches: src/a.ts_',
      '- **One** -- . _src/a.ts, ~80 lines._ (M)',
      '- **Two** -- . _src/a.ts, ~80 lines._ (M)',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    expect(r.value.tracks[0]!.sessionWeight).toBe(4);
  });
});

describe('parseRoadmap — _tombstone:', () => {
  test('collects reserved numbers from Current Plan', () => {
    const md = [
      '## Current Plan',
      '_tombstone: 84, 86, 90_',
      '#### Group 91: Next',
      '##### Track 91A: Live',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    expect(r.value.tombstones).toEqual(['84', '86', '90']);
  });

  test('ignores _tombstone: inside a Track body', () => {
    const md = [
      '## Current Plan',
      '#### Group 91: Next',
      '##### Track 91A: Live',
      '_tombstone: 84_',
      '',
    ].join('\n');
    const r = parseRoadmap(md, deps());
    expect(r.value.tombstones).toEqual([]);
  });
});

describe('mergeShippedArchive', () => {
  test('archive fills gaps; active wins on collision with a warning', () => {
    const active = parseRoadmap(
      '## Current Plan\n#### Group 2: Live\n##### Track 2A: New\n',
      deps(),
    );
    const archive = parseRoadmap(
      '## Shipped\n#### Group 1: Old\n##### Track 1A: Done\n#### Group 2: StaleName\n##### Track 2A: Stale\n',
      deps(),
    );
    const m = mergeShippedArchive(active, archive);
    expect(m.value.groups.find((g) => g.num === '1')?.state).toBe('shipped');
    expect(m.value.groups.find((g) => g.num === '2')?.name).toBe('Live');
    expect(m.value.tracks.map((t) => t.id).sort()).toEqual(['1A', '2A']);
    expect(m.value.tracks.find((t) => t.id === '1A')?.state).toBe('shipped');
    expect(m.value.styleLintWarnings.some((w) => w.includes('archive Group 2'))).toBe(true);
    expect(m.value.styleLintWarnings.some((w) => w.includes('archive Track 2A'))).toBe(true);
  });

  test('empty archive is a no-op', () => {
    const active = parseRoadmap('', deps());
    const m = mergeShippedArchive(active, parseRoadmap('', deps()));
    expect(m.value.groups).toEqual([]);
    expect(m.value.tracks).toEqual([]);
  });

  test('unions tombstones; active order wins on overlap', () => {
    const active = parseRoadmap(
      '## Current Plan\n_tombstone: 84, 90_\n#### Group 2: Live\n',
      deps(),
    );
    const archive = parseRoadmap(
      '## Shipped\n_tombstone: 90, 86_\n#### Group 1: Old\n',
      deps(),
    );
    expect(mergeShippedArchive(active, archive).value.tombstones).toEqual(['84', '90', '86']);
    expect(mergeShippedArchive(active, parseRoadmap('', deps())).value.tombstones).toEqual([
      '84',
      '90',
    ]);
  });
});
