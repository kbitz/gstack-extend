import { expect, test } from 'bun:test';
import { planningLines } from '../src/audit/lib/markdown.ts';

test('keeps one-based positions and original text across CRLF and embedded CR', () => {
  expect([...planningLines('')]).toEqual([]);
  expect([...planningLines('# A\r\n\r\nbody\rtext\r\n## B\r\n')]).toEqual([
    [1, '# A'], [3, 'body\rtext'], [4, '## B'],
  ]);
});

test.each(['```', '~~~'])('ignores %s inside HTML comments', (fence) => {
  for (const comment of [
    ['<!-- ' + fence + ' -->'],
    ['<!--', fence + 'md', '### Hidden', '-->'],
    ['<!--', fence + 'md', '### Hidden', fence, '-->'],
  ]) {
    expect([...planningLines([...comment, '# Visible'].join('\n'))]).toEqual([
      [comment.length + 1, '# Visible'],
    ]);
  }
});

test.each([0, 1, 2, 3])('skips fenced code with %i leading spaces', (indent) => {
  for (const marker of ['```', '~~~']) {
    const fence = ' '.repeat(indent) + marker;
    expect([...planningLines([fence + 'md', '# Hidden', fence, '# Visible'].join('\n'))]).toEqual([
      [4, '# Visible'],
    ]);
  }
});

test.each(['    ', '\t'])('skips indented code whose prefix is %j', (indent) => {
  const text = ['# Before', '', indent + '```', indent + '# Hidden', '', '# After'];
  expect([...planningLines(text.join('\n'))]).toEqual([[1, '# Before'], [6, '# After']]);
});

test('handles the fence length, info strings and closing whitespace', () => {
  const text = [
    '````md', '```', '# Hidden', '````\u00a0', '# Still hidden',
    '```` \t ', '# Visible', '```md`bad', '# Also visible',
  ];
  const visible = [...planningLines(text.join('\n'))];
  expect(visible).toContainEqual([7, '# Visible']);
  expect(visible).toContainEqual([9, '# Also visible']);
  expect(visible.filter(([, line]) => line.startsWith('#'))).toEqual([
    [7, '# Visible'], [9, '# Also visible'],
  ]);
});

// Value: protects=short delimiters inside a longer nested fence stay hidden;
// fails_when=the nested fence closes at a three-character delimiter;
// why_new=existing long and nested fixtures exercise the two properties separately;
// seam=none; no_claim=all Markdown containers.
test.each([
  ['- ```md', '  # Hidden'],
  ['- ```md', '  # Hidden', '  ``` \t '],
  ['- Example', '  - ~~~md', '    # Hidden'],
  ['- Example', '  - ~~~md', '    # Hidden', '    ~~~'],
  ['- Example', '  - ~~~~md', '    ~~~', '    # Hidden', '    ~~~~ \t '],
  ['- Example', '  > ~~~md', '  > # Hidden'],
  ['- Example', '  > ~~~md', '  > # Hidden', '  > ~~~'],
  ['> - Example', '>   ~~~md', '>   # Hidden', '>   ~~~'],
])('skips a nested fence starting with %j', (...example) => {
  for (const gap of [[], ['']]) {
    const content = [...example, ...gap, '# Visible'];
    const lines = [...planningLines(content.join('\n'))];
    expect(lines.some(([, line]) => line.includes('# Hidden'))).toBe(false);
    expect(lines.at(-1)).toEqual([content.length, '# Visible']);
  }
});

test('yields task list text once and supports interleaved walks', () => {
  const first = planningLines('- [x] A\n- [ ] B\n\n# End');
  expect(first.next().value).toEqual([1, '- [x] A']);
  expect([...planningLines('> Quoted\n> text\n\nOther')]).toEqual([
    [1, '> Quoted'], [2, '> text'], [4, 'Other'],
  ]);
  expect([...first]).toEqual([[2, '- [ ] B'], [4, '# End']]);
});
