import { describe, expect, test } from 'bun:test';

import {
  computeRenames,
  formatRenamesTable,
  normalizeTitle,
  parseEntities,
} from '../src/audit/lib/renames-diff.ts';

describe('normalizeTitle', () => {
  test('strips ✓ Shipped suffix with version', () => {
    expect(normalizeTitle('Audit Polish ✓ Shipped (v0.18.14.0)')).toBe('audit polish');
  });

  test('strips ✓ Complete suffix without version', () => {
    expect(normalizeTitle('Bun Toolchain ✓ Complete')).toBe('bun toolchain');
  });

  test('strips Hotfix: prefix', () => {
    expect(normalizeTitle('Hotfix: bin/update-run regression')).toBe('bin/update-run regression');
  });

  test('collapses whitespace + lowercases', () => {
    expect(normalizeTitle('  Audit   Polish  ')).toBe('audit polish');
  });

  test('preserves punctuation in title body', () => {
    expect(normalizeTitle('New Skill `/gstack-extend-upgrade`')).toBe(
      'new skill `/gstack-extend-upgrade`',
    );
  });
});

describe('parseEntities', () => {
  test('extracts Groups at all heading depths', () => {
    const md = `## Group 1: Foo
### Group 2: Bar
#### Group 3: Baz`;
    expect(parseEntities(md)).toEqual([
      { id: '1', kind: 'group', title: 'foo' },
      { id: '2', kind: 'group', title: 'bar' },
      { id: '3', kind: 'group', title: 'baz' },
    ]);
  });

  test('extracts Tracks at all heading depths', () => {
    const md = `### Track 1A: First
#### Track 2B: Second
##### Track 3C: Third`;
    expect(parseEntities(md)).toEqual([
      { id: '1A', kind: 'track', title: 'first' },
      { id: '2B', kind: 'track', title: 'second' },
      { id: '3C', kind: 'track', title: 'third' },
    ]);
  });

  test('handles Track sub-IDs with dots', () => {
    const md = `### Track 7A.1: Sub-track`;
    expect(parseEntities(md)).toEqual([
      { id: '7A.1', kind: 'track', title: 'sub-track' },
    ]);
  });

  test('ignores non-heading lines', () => {
    const md = `Some prose mentioning Group 5 inline.
A bullet about Track 6A: not a heading.
## Group 7: Real
Body text.`;
    expect(parseEntities(md)).toEqual([
      { id: '7', kind: 'group', title: 'real' },
    ]);
  });
});

describe('computeRenames', () => {
  test('detects Group ID change with same title', () => {
    const oldMd = `## Group 7: Audit Polish`;
    const newMd = `### Group 6: Audit Polish`;
    expect(computeRenames(oldMd, newMd)).toEqual([
      { kind: 'group', oldId: '7', newId: '6', title: 'audit polish' },
    ]);
  });

  test('detects Track ID change with same title', () => {
    const oldMd = `### Track 8A: Snapshot staged state`;
    const newMd = `##### Track 7A: Snapshot staged state`;
    expect(computeRenames(oldMd, newMd)).toEqual([
      { kind: 'track', oldId: '8A', newId: '7A', title: 'snapshot staged state' },
    ]);
  });

  test('ignores entries with same ID + same title (no rename)', () => {
    const oldMd = `## Group 5: Install Pipeline`;
    const newMd = `#### Group 5: Install Pipeline`;
    expect(computeRenames(oldMd, newMd)).toEqual([]);
  });

  test('ignores entries that exist only on one side (additions/deletions)', () => {
    const oldMd = `## Group 1: Old Only`;
    const newMd = `## Group 99: New Only`;
    expect(computeRenames(oldMd, newMd)).toEqual([]);
  });

  test('matches across ✓ Shipped suffix change', () => {
    // Track 5A becomes shipped between snapshots — title body unchanged
    // after stripping the suffix, so a rename of 5A → 5A is a no-op
    // (same id, same title); but if the ID also changed, we catch it.
    const oldMd = `##### Track 5A: Install pipeline polish`;
    const newMd = `##### Track 6A: Install pipeline polish ✓ Shipped (v0.18.14.0)`;
    expect(computeRenames(oldMd, newMd)).toEqual([
      { kind: 'track', oldId: '5A', newId: '6A', title: 'install pipeline polish' },
    ]);
  });

  test('separates Group and Track namespaces', () => {
    // A Group titled "Foo" shouldn't match a Track titled "Foo".
    const oldMd = `## Group 1: Foo
### Track 2A: Foo`;
    const newMd = `## Group 5: Foo
### Track 7A: Foo`;
    expect(computeRenames(oldMd, newMd)).toEqual([
      { kind: 'group', oldId: '1', newId: '5', title: 'foo' },
      { kind: 'track', oldId: '2A', newId: '7A', title: 'foo' },
    ]);
  });

  test('first-occurrence-wins on duplicate old titles', () => {
    const oldMd = `## Group 1: Dup
## Group 2: Dup`;
    const newMd = `## Group 9: Dup`;
    const renames = computeRenames(oldMd, newMd);
    expect(renames).toHaveLength(1);
    expect(renames[0]!.oldId).toBe('1');
    expect(renames[0]!.newId).toBe('9');
  });

  test('multiple renames in one regen', () => {
    const oldMd = `## Group 7: A
## Group 8: B
## Group 9: C`;
    const newMd = `## Group 6: A
## Group 7: B
## Group 8: C`;
    expect(computeRenames(oldMd, newMd)).toEqual([
      { kind: 'group', oldId: '7', newId: '6', title: 'a' },
      { kind: 'group', oldId: '8', newId: '7', title: 'b' },
      { kind: 'group', oldId: '9', newId: '8', title: 'c' },
    ]);
  });

  test('returns empty list when nothing renamed', () => {
    const md = `## Group 1: Stable
### Track 1A: Also Stable`;
    expect(computeRenames(md, md)).toEqual([]);
  });
});

describe('formatRenamesTable', () => {
  test('emits empty string for no renames', () => {
    expect(formatRenamesTable([])).toBe('');
  });

  test('renders Group + Track renames in stable order', () => {
    const out = formatRenamesTable([
      { kind: 'group', oldId: '7', newId: '6', title: 'audit polish' },
      { kind: 'track', oldId: '8A', newId: '7A', title: 'commit handling' },
    ]);
    expect(out).toBe(
      [
        'ID renames:',
        '- Group 7 → Group 6 (audit polish)',
        '- Track 8A → Track 7A (commit handling)',
      ].join('\n'),
    );
  });
});
