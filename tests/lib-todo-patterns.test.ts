/**
 * lib-todo-patterns.test.ts — count_todo_patterns parity coverage.
 *
 * Bash awk uses single-pass scanning with fence tracking; the TS port
 * must agree on every pattern category. Each category gets its own
 * test plus the fence-suppression test (which the snapshot oracle
 * can't isolate cleanly).
 */

import { describe, expect, test } from 'bun:test';

import { countTodoPatterns } from '../src/audit/lib/todo-patterns.ts';

describe('countTodoPatterns', () => {
  test('empty content', () => {
    expect(countTodoPatterns('')).toBe(0);
  });

  test('checkboxes — both unchecked and checked variants', () => {
    const md = ['- [ ] todo', '- [x] done', '- [X] also done', '- [a] not a checkbox'].join('\n');
    expect(countTodoPatterns(md)).toBe(3);
  });

  test('inline markers TODO/FIXME/HACK/XXX with colon', () => {
    const md = [
      '// TODO: fix this',
      '/* FIXME: broken */',
      'HACK: dirty',
      'XXX: ugly',
      'todoxx: nope', // lowercase, no boundary
    ].join('\n');
    expect(countTodoPatterns(md)).toBe(4);
  });

  test('inline marker requires word-boundary', () => {
    expect(countTodoPatterns('subTODO: no')).toBe(0);
    expect(countTodoPatterns('TODO:')).toBe(1);
    expect(countTodoPatterns('-TODO:')).toBe(1);
  });

  test('section headings (case-insensitive)', () => {
    const md = ['# TODO list', '## tasks', '### Action Items', '#### Backlog'].join('\n');
    // # TODO and #### Backlog: # is 1 mark (matches), but #### is 4 (no match).
    expect(countTodoPatterns(md)).toBe(3);
  });

  test('bold task with effort tier', () => {
    const md = ['- **Implement foo** — body (S)', '- **No tier** body', '- **Tier with whitespace** ... (M)   '].join('\n');
    expect(countTodoPatterns(md)).toBe(2);
  });

  test('fenced code block content is ignored', () => {
    const md = [
      '- [ ] task A',
      '```',
      '- [ ] inside fence',
      'TODO: not counted',
      '```',
      '- [ ] task B',
    ].join('\n');
    expect(countTodoPatterns(md)).toBe(2);
  });

  test('nested fence with longer marker still suppresses', () => {
    const md = [
      '````md',
      '```',
      'TODO: still inside',
      '```',
      '````',
      'TODO: outside',
    ].join('\n');
    // Outer fence is 4 backticks; inner 3-backtick line opens nothing because
    // we're already inside. Closing ```` matches because length >= 4. Outside
    // line counts.
    expect(countTodoPatterns(md)).toBe(1);
  });

  test('one count per matching line (categories don\'t double-count)', () => {
    // A line that matches TWO categories: bold task + inline marker.
    // Bash uses `next` so each matched line counts once.
    const md = '- **TODO: implement** ... (S)';
    expect(countTodoPatterns(md)).toBe(1);
  });
});
