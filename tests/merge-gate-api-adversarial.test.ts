import { expect, test } from 'bun:test';
import { scanLines } from '../src/merge-gate/api.ts';

for (const close of ['  b }', '  b } from "./other"']) {
  test(`multiline exports retain the member on a closing line: ${close}`, () => {
    expect(scanLines('api.ts', ['export {', '  a,', close])).toEqual([
      { rule: 'ts-list', name: 'a' }, { rule: 'ts-list', name: 'b' },
    ]);
    expect(scanLines('api.ts', [close], 'export {')).toEqual([{ rule: 'ts-list', name: 'b' }]);
  });
}

test('a new function body invalidates stale export-list hunk context', () => {
  expect(scanLines('api.ts', ['export function f() {', '  return {', '    x,', '    y,', '  }', '}'], 'export {'))
    .toEqual([{ rule: 'ts-decl', name: 'f' }]);
});

test('an array declaration invalidates stale export-list hunk context', () => {
  expect(scanLines('api.ts', ['const all = [', '  alpha,', '  beta,', '];'], 'export {'))
    .toEqual([]);
});

test('a nonmember call invalidates stale export-list hunk context without a brace', () => {
  expect(scanLines('api.ts', ['doWork(', '  alpha,', '  beta', ');'], 'export {'))
    .toEqual([]);
});

test('blank and comment lines preserve valid export members and a closing-line member', () => {
  expect(scanLines('api.ts', ['', '  // public members', '  alpha,', '   ', '  /* another member */', '  beta }'], 'export {'))
    .toEqual([{ rule: 'ts-list', name: 'alpha' }, { rule: 'ts-list', name: 'beta' }]);
});

test('a visible export opener restores scanning after a nonmember statement', () => {
  expect(scanLines('api.ts', ['const local = 1;', 'export {', '  alpha,', '  beta }'], 'export {'))
    .toEqual([{ rule: 'ts-list', name: 'alpha' }, { rule: 'ts-list', name: 'beta' }]);
});

test('braces in export member comments do not terminate the list', () => {
  expect(scanLines('api.ts', ['export {', '  a, // { comment', '  b,', '}']))
    .toEqual([{ rule: 'ts-list', name: 'a' }, { rule: 'ts-list', name: 'b' }]);
});

test('Go block members still end only at their closing line', () => {
  expect(scanLines('api.go', ['const (', '\tA = iota', '\tB', ')']))
    .toEqual([{ rule: 'go-exported', name: 'A' }, { rule: 'go-exported', name: 'B' }]);
});
