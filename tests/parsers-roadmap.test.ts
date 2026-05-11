import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
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
    // v2 grammar: shipped Groups (1-5) live in `## Shipped` with bullet-form
    // Tracks. The parser still picks up the Group headings and marks them
    // complete via the `✓ Shipped (vX.Y.Z)` heading suffix.
    const g1 = r.value.groups.find((g) => g.num === '1');
    expect(g1?.isComplete).toBe(true);
    const g5 = r.value.groups.find((g) => g.num === '5');
    expect(g5?.isComplete).toBe(true);
    // Active Groups (6+) parse and are NOT marked complete.
    const g6 = r.value.groups.find((g) => g.num === '6');
    expect(g6?.isComplete).toBe(false);
    // Group 7's first Track (current plan) is extracted as in-progress.
    const t7a = r.value.tracks.find((t) => t.id === '7A');
    expect(t7a).toBeDefined();
    expect(t7a!.isComplete).toBe(false);
    // Group dep parse: kinds limited to 'unspecified' / 'none' / 'after'.
    // Active Groups in the current plan use explicit `_Depends on:_` blocks
    // OR rely on the preceding-Group default. No Group should have a
    // malformed deps block.
    for (const g of r.value.groups) {
      expect(['unspecified', 'none', 'after', 'list']).toContain(g.deps.kind);
    }
    // Sanity: at least 10 groups, several tracks (real-repo shape).
    expect(r.value.groups.length).toBeGreaterThanOrEqual(10);
    expect(r.value.tracks.length).toBeGreaterThanOrEqual(7);
  });
});
