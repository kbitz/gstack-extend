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

for (const [label, lines, context, names] of [
  ['a closing brace in a line comment', ['export {', '  a, // }', '  b, c,', '};'], '', ['a', 'b', 'c']],
  ['a closing brace in a block comment', ['export { a, /* } */', '  b,', '}'], '', ['a', 'b']],
  ['a block-commented member', ['export {', '  a, /* deprecated */', '  b,', '};'], '', ['a', 'b']],
  ['a block-commented member in hunk context', ['  a, /* deprecated */', '  b,'], 'export {', ['a', 'b']],
  ['an unrecognized member under a visible opener', ['export {', '  a,', '  café,', '  b,', '};'], '', ['a', 'b']],
] as const) {
  test(`export-list comments and members: ${label}`, () => {
    expect(scanLines('api.ts', [...lines], context).map(p => p.name)).toEqual([...names]);
  });
}

test('Rust qualifiers and TS anonymous default classes do not become names', () => {
  expect(scanLines('lib.rs', ['pub const fn new() {}', 'pub static mut COUNT: u32 = 0;', 'pub const unsafe fn raw() {}', 'pub extern "C" fn cb() {}', 'pub const LIMIT: u32 = 1;']).map(p => p.name))
    .toEqual(['new', 'COUNT', 'raw', 'cb', 'LIMIT']);
  expect(scanLines('api.ts', ['export default class extends Base {}'])).toEqual([{ rule: 'ts-default', name: 'default@api.ts' }]);
});

test('a top-level Go declaration invalidates stale Go block hunk context', () => {
  expect(scanLines('api.go', ['type config struct {', '\tField int', '}'], 'const (')).toEqual([]);
  expect(scanLines('api.go', ['\tB = 2', '\t// note', '\tC'], 'const ('))
    .toEqual([{ rule: 'go-exported', name: 'B' }, { rule: 'go-exported', name: 'C' }]);
  // Raw-string content can sit at column zero inside the block.
  expect(scanLines('api.go', ['\tusage = `', 'Usage: tool [flags]', '`', '\tVersion = "1"'], 'var ('))
    .toEqual([{ rule: 'go-exported', name: 'Version' }]);
});

test('Go block members still end only at their closing line', () => {
  expect(scanLines('api.go', ['const (', '\tA = iota', '\tB', ')']))
    .toEqual([{ rule: 'go-exported', name: 'A' }, { rule: 'go-exported', name: 'B' }]);
});
