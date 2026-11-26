import { describe, expect, test } from 'bun:test';
import { parseIntakeFile, parseTodos } from '../src/audit/parsers/todos.ts';

describe('parseTodos — section detection', () => {
  test('empty content', () => {
    const r = parseTodos('');
    expect(r.value.hasUnprocessedSection).toBe(false);
    expect(r.value.entries).toEqual([]);
  });

  test('no Unprocessed section', () => {
    const r = parseTodos('# Top\n\n## Other\n- item\n');
    expect(r.value.hasUnprocessedSection).toBe(false);
    expect(r.value.entries).toEqual([]);
  });

  test('Unprocessed section detected even when empty', () => {
    const r = parseTodos('## Unprocessed\n');
    expect(r.value.hasUnprocessedSection).toBe(true);
    expect(r.value.entries).toEqual([]);
  });

  test('next ## heading exits Unprocessed section', () => {
    const md = [
      '## Unprocessed',
      '### [manual] First',
      '## Other',
      '### [manual] Should not be captured',
    ].join('\n');
    const r = parseTodos(md);
    expect(r.value.entries).toHaveLength(1);
    expect(r.value.entries[0]!.title).toBe('First');
  });
});

describe('parseTodos — entry classification', () => {
  test('canonical heading entry', () => {
    const md = [
      '## Unprocessed',
      '### [manual] First item',
      '',
      'body line',
    ].join('\n');
    const r = parseTodos(md);
    expect(r.value.entries).toHaveLength(1);
    const e = r.value.entries[0]!;
    expect(e.kind).toBe('heading');
    expect(e.tag).toBe('[manual]');
    expect(e.title).toBe('First item');
    expect(e.line).toBe(2);
  });

  test('untagged heading (treated as [manual] downstream)', () => {
    const md = [
      '## Unprocessed',
      '### Plain title with no tag',
    ].join('\n');
    const r = parseTodos(md);
    const e = r.value.entries[0]!;
    expect(e.kind).toBe('heading');
    expect(e.tag).toBe('');
    expect(e.unclosedTag).toBe(false);
  });

  test('unclosed tag bracket flagged', () => {
    const md = [
      '## Unprocessed',
      '### [pair-review:group=2 Unclosed',
    ].join('\n');
    const r = parseTodos(md);
    const e = r.value.entries[0]!;
    expect(e.kind).toBe('heading');
    expect(e.tag).toBe('');
    expect(e.unclosedTag).toBe(true);
  });

  test('compact bullet form', () => {
    const md = [
      '## Unprocessed',
      '- **[manual] Compact** — body text',
    ].join('\n');
    const r = parseTodos(md);
    const e = r.value.entries[0]!;
    expect(e.kind).toBe('compactBullet');
    expect(e.raw).toContain('Compact');
  });

  test('legacy bullet form', () => {
    const md = [
      '## Unprocessed',
      '- [legacy] body',
    ].join('\n');
    const r = parseTodos(md);
    const e = r.value.entries[0]!;
    expect(e.kind).toBe('legacyBullet');
  });

  test('standalone checklist and link bullets remain visible as legacy inbox entries', () => {
    const markdown = [
      '## Unprocessed', '- [ ] Repair the link', '- [Spec](docs/SPEC.md) needs repair',
      '### [manual] Another entry', '- [ ] Check the section', '- [Spec](docs/SPEC.md)', '- **ID:** wi-aabbcc',
    ].join('\n');
    const entries = parseTodos(markdown).value.entries;
    expect(entries.map(entry => [entry.kind, entry.line])).toEqual([
      ['legacyBullet', 2],
      ['legacyBullet', 3],
      ['heading', 4],
    ]);
    expect(entries[2]!.workItemId).toBe('wi-aabbcc');
  });

  test('mixed entries preserved in document order', () => {
    const md = [
      '## Unprocessed',
      '### [manual] First',
      '- **[manual] Compact** — body',
      '- [legacy] body',
      '### [manual] Last',
    ].join('\n');
    const r = parseTodos(md);
    expect(r.value.entries.map((e) => e.kind)).toEqual([
      'heading',
      'compactBullet',
      'legacyBullet',
      'heading',
    ]);
  });
});

describe('parseTodos — code fence handling', () => {
  test('content inside ``` fence not classified', () => {
    const md = [
      '## Unprocessed',
      '```',
      '### [manual] Inside fence — example only',
      '- **[manual] Also inside**',
      '```',
      '### [manual] Real entry',
    ].join('\n');
    const r = parseTodos(md);
    expect(r.value.entries).toHaveLength(1);
    expect(r.value.entries[0]!.title).toBe('Real entry');
  });

  for (const marker of ['```', '~~~']) {
    test.each([0, 1, 2, 3])(`${marker} fence with %i leading spaces`, (indent) => {
      const fence = ' '.repeat(indent) + marker;
      const md = [
        '## Unprocessed',
        fence + 'md',
        '### [manual] Inside fence',
        '    ' + marker,
        '### [manual] Still inside after four spaces',
        '\t' + marker,
        '### [manual] Still inside after a tab',
        fence,
        '### [manual] Real',
      ].join('\n');
      expect(parseTodos(md).value.entries.map(entry => entry.title)).toEqual(['Real']);
    });
  }

  test('fences outside Unprocessed section have no effect on entries', () => {
    const md = [
      '## Other section',
      '```',
      'random',
      '```',
      '## Unprocessed',
      '### [manual] Real',
    ].join('\n');
    const r = parseTodos(md);
    expect(r.value.entries).toHaveLength(1);
  });

  test('section heading inside fence does not toggle section state', () => {
    const md = [
      '## Unprocessed',
      '### [manual] Real',
      '```',
      '## Random',
      '```',
      '### [manual] Still in section',
    ].join('\n');
    const r = parseTodos(md);
    expect(r.value.entries).toHaveLength(2);
  });
});

describe('parseTodos — line numbers', () => {
  test('1-indexed line numbers preserved', () => {
    const md = [
      '# Top', // 1
      '', // 2
      '## Unprocessed', // 3
      '', // 4
      '### [manual] First', // 5
    ].join('\n');
    const r = parseTodos(md);
    expect(r.value.entries[0]!.line).toBe(5);
  });
});

describe('parseTodos — work-item IDs', () => {
  test('captures valid, malformed, duplicate IDs and ## Completed IDs without changing entries count', () => {
    const md = [
      '## Unprocessed',
      '### [manual] Valid',
      '- **ID:** wi-a1b2c3',
      '- **Why:** ok',
      '### [manual] Malformed',
      '- **ID:** wi-BAD!',
      '### [manual] Duplicate bullets',
      '- **ID:** wi-111111',
      '- **ID:** wi-222222',
      '## Completed',
      '### [manual] Done',
      '- **ID:** wi-dead01',
    ].join('\n');
    const r = parseTodos(md);
    expect(r.value.entries).toHaveLength(3);
    expect(r.value.entries[0]!.workItemId).toBe('wi-a1b2c3');
    expect(r.value.entries[0]!.workItemIdError).toBeNull();
    expect(r.value.entries[1]!.workItemId).toBeNull();
    expect(r.value.entries[1]!.workItemIdRaw).toBe('wi-BAD!');
    expect(r.value.entries[1]!.workItemIdError).toBe('malformed');
    expect(r.value.entries[2]!.workItemIdError).toBe('duplicate');
    expect(r.value.completedIds).toEqual(['wi-dead01']);
  });
});

test.each([
  ['HTML comment', ['<!--', '```md', '### [manual] Example', '-->']],
  ['closed list example', ['- ```md', '  ### [manual] Example', '  ```']],
  ['unclosed list example', ['- ```md', '  ### [manual] Example']],
  ['nonbreaking-space closer', ['~~~md', '~~~\u00a0', '### [manual] Example', '~~~ \t ']],
] as const)('keeps the real TODO and its line number after a %s', (_, example) => {
  const content = ['## Unprocessed', ...example, '### [manual] Real'].join('\n');
  const { entries } = parseTodos(content).value;
  expect(entries.map(entry => [entry.title, entry.line])).toEqual([['Real', example.length + 2]]);
});

describe('parseIntakeFile', () => {
  const heading = '### [review] Fix the queue';
  const id = '- **ID:** wi-a1b2c3';
  const parse = (content: string, name = 'wi-a1b2c3.md', kind: 'file' | 'non-file' = 'file') =>
    parseIntakeFile('docs/todos/' + name, name, kind, content);

  test('parses one record and ignores examples in fences and comments', () => {
    const result = parse([heading, id, '', '~~~md', '### Example', id, '~~~',
      '<!--', '### Another example', id, '-->', '- [ ] Checklist'].join('\n'));
    expect(result.headings).toMatchObject([{ line: 1, tag: '[review]', title: 'Fix the queue' }]);
    expect(result).toMatchObject({
      filenameId: 'wi-a1b2c3', workItemId: 'wi-a1b2c3', workItemIdError: null,
      idIsFirst: true, legacyBullets: [], compactBullets: [], unexpectedHeadings: [],
    });
  });

  test('retains malformed shapes for audit diagnostics', () => {
    expect(parse('').headings).toHaveLength(0);
    expect(parse('### [review]').headings[0]?.title).toBe('');
    expect(parse('### [review]No separator').headings[0]?.title).toBe('');
    const result = parse(['## Unprocessed', '- [manual] Old', '- **[manual] Compact**',
      '### Untagged', heading, id].join('\n'), 'bad.md');
    expect(result.filenameId).toBeNull();
    expect(result.unexpectedHeadings).toMatchObject([{ line: 1, raw: '## Unprocessed' }]);
    expect(result.legacyBullets).toMatchObject([{ line: 2 }]);
    expect(result.compactBullets).toMatchObject([{ line: 3 }]);
    expect(result.headings).toMatchObject([{ line: 4, tag: '' }, { line: 5, tag: '[review]' }]);
    expect(parse(['---', 'priority: P0', '---', heading, id].join('\n')).hasFrontmatter).toBe(true);
  });

  test('distinguishes missing, invalid, duplicate, mismatched, and misordered IDs', () => {
    expect(parse(heading)).toMatchObject({ workItemId: null, workItemIdRaw: null, workItemIdError: null });
    expect(parse(heading + '\n- **ID:** wi-BAD').workItemIdError).toBe('malformed');
    expect(parse([heading, id, id].join('\n')).workItemIdError).toBe('duplicate');
    expect(parse([heading, '- **ID:** wi-deadbe'].join('\n'))).toMatchObject({
      filenameId: 'wi-a1b2c3', workItemId: 'wi-deadbe',
    });
    expect(parse([heading, '- **Priority:** P1', id].join('\n')).idIsFirst).toBe(false);
  });

  test('ignores content of non-Markdown or non-regular entries', () => {
    for (const result of [parse(heading, 'wi-a1b2c3.txt'), parse(heading, 'wi-a1b2c3.md', 'non-file')]) {
      expect(result).toMatchObject({ filenameId: null, headings: [], workItemId: null });
    }
  });
});
