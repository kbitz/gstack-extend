import { describe, expect, test } from 'bun:test';
import { parsePhases } from '../src/audit/parsers/phases.ts';

describe('parsePhases', () => {
  test('empty content', () => {
    const r = parsePhases('');
    expect(r.value.phases).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  test('content with no Phase headings', () => {
    const r = parsePhases('# Title\n## Group 1: Foo\nstuff\n');
    expect(r.value.phases).toEqual([]);
  });

  test('single phase, basic shape', () => {
    const md = [
      '## Phase 1: Bun Test Migration',
      '',
      '**End-state:** all bash scripts deleted; bun test is the sole runner.',
      '',
      '**Groups:** 1, 2, 3, 4 (sequential).',
      '',
      '## Group 1: Foo',
    ].join('\n');
    const r = parsePhases(md);
    expect(r.value.phases).toHaveLength(1);
    const p = r.value.phases[0]!;
    expect(p.num).toBe('1');
    expect(p.title).toBe('Bun Test Migration');
    expect(p.headLine).toBe(1);
    expect(p.hasEndState).toBe(true);
    expect(p.hasGroups).toBe(true);
    expect(p.groupNums).toEqual(['1', '2', '3', '4']);
  });

  test('Groups: stripping parenthetical', () => {
    const md = [
      '## Phase 1: Title',
      '**Groups:** 1, 2 (sequential), 5',
    ].join('\n');
    const r = parsePhases(md);
    expect(r.value.phases[0]!.groupNums).toEqual(['1', '2', '5']);
  });

  test('plain Field: (no bold) accepted', () => {
    const md = [
      '## Phase 1: Title',
      'End-state: done',
      'Groups: 1',
    ].join('\n');
    const r = parsePhases(md);
    expect(r.value.phases[0]!.hasEndState).toBe(true);
    expect(r.value.phases[0]!.hasGroups).toBe(true);
    expect(r.value.phases[0]!.groupNums).toEqual(['1']);
  });

  test('phase with missing End-state', () => {
    const md = [
      '## Phase 1: Title',
      '**Groups:** 1, 2',
    ].join('\n');
    const r = parsePhases(md);
    expect(r.value.phases[0]!.hasEndState).toBe(false);
    expect(r.value.phases[0]!.hasGroups).toBe(true);
  });

  test('Any ## heading after Phase exits the block', () => {
    const md = [
      '## Phase 1: First',
      '**End-state:** x',
      '## Group 1: Foo',
      '**End-state:** should NOT attribute to Phase 1',
      '## Phase 2: Second',
      '**Groups:** 5',
    ].join('\n');
    const r = parsePhases(md);
    expect(r.value.phases).toHaveLength(2);
    expect(r.value.phases[0]!.hasEndState).toBe(true);
    expect(r.value.phases[1]!.hasGroups).toBe(true);
  });

  test('scaffolding block extracts backtick paths', () => {
    const md = [
      '## Phase 1: Title',
      '**Scaffolding contract:**',
      '- Group 1 lands `src/audit/lib/source-tag.ts` and `tests/source-tag.test.ts`',
      '- Group 2 adds `src/audit/parsers/roadmap.ts`',
      '',
      '## Phase 2: Next',
    ].join('\n');
    const r = parsePhases(md);
    expect(r.value.phases[0]!.scaffoldPaths).toEqual([
      'src/audit/lib/source-tag.ts',
      'tests/source-tag.test.ts',
      'src/audit/parsers/roadmap.ts',
    ]);
  });

  test('blank line ends scaffolding block', () => {
    const md = [
      '## Phase 1: Title',
      '**Scaffolding contract:**',
      '- Adds `a.ts`',
      '',
      'Then this `should not count` because we left the block.',
    ].join('\n');
    const r = parsePhases(md);
    expect(r.value.phases[0]!.scaffoldPaths).toEqual(['a.ts']);
  });

  test('End-state and Groups inside scaffolding block close the block', () => {
    const md = [
      '## Phase 1: Title',
      '**Scaffolding contract:**',
      '- Adds `a.ts`',
      '**End-state:** done',
      '- This `b.ts` should not be captured (out of block)',
    ].join('\n');
    const r = parsePhases(md);
    expect(r.value.phases[0]!.scaffoldPaths).toEqual(['a.ts']);
    expect(r.value.phases[0]!.hasEndState).toBe(true);
  });

  test('multiple phases preserved in order', () => {
    const md = [
      '## Phase 1: First',
      '**Groups:** 1',
      '## Phase 2: Second',
      '**Groups:** 2, 3',
      '## Phase 3: Third',
      '**Groups:** 4',
    ].join('\n');
    const r = parsePhases(md);
    expect(r.value.phases.map((p) => p.num)).toEqual(['1', '2', '3']);
    expect(r.value.phases.map((p) => p.title)).toEqual(['First', 'Second', 'Third']);
  });

  test('headLine is 1-indexed', () => {
    const md = [
      '# Top',
      '',
      '## Phase 1: Title',
    ].join('\n');
    const r = parsePhases(md);
    expect(r.value.phases[0]!.headLine).toBe(3);
  });
});

describe('parsePhases — real ROADMAP.md', () => {
  test('extracts Phase 1: Bun Test Migration', async () => {
    const path = `${import.meta.dir}/../docs/ROADMAP.md`;
    const content = await Bun.file(path).text();
    const r = parsePhases(content);
    expect(r.value.phases).toHaveLength(1);
    expect(r.value.phases[0]!.num).toBe('1');
    expect(r.value.phases[0]!.title).toBe('Bun Test Migration');
    expect(r.value.phases[0]!.hasEndState).toBe(true);
    expect(r.value.phases[0]!.hasGroups).toBe(true);
    expect(r.value.phases[0]!.groupNums).toEqual(['1', '2', '3', '4']);
  });
});
