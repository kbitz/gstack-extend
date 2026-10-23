/**
 * pinning.ts — find the tests that read the changed files. A test file is
 * selected when its text names a changed path or file name, or when the
 * project lists it in `docs-ship:tests=`. Imports and computed paths are not
 * followed; list such tests in the marker.
 */
import { globMatcher } from '../merge-gate/glob.ts';
import { shellQuote } from '../audit/lib/shell-quote.ts';
import { readAt, Refusal, trackedFiles, type Git } from './git.ts';
import { validTestCommand } from './config.ts';

const TEST_NAME = /(\.(test|spec)\.[^/.]+$|(^|\/)test_[^/]*\.py$|_test\.(py|go)$|_spec\.rb$)/;
const TEST_DIR = /(^|\/)(tests?|__tests__|specs?)\//;
const NOT_TESTS = /(^|\/)(fixtures?|__fixtures__|testdata|__snapshots__|helpers?)\//;
const CODE_EXT = /\.([cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|sh|bash|php|ex|exs)$/;

export type Selected = { test: string; reasons: string[] };

/** Runnable test files: name-pattern tests when the repo has any, else code files under a test directory. */
export function testFiles(files: string[]): string[] {
  const named = files.filter((f) => TEST_NAME.test(f) && CODE_EXT.test(f) && !NOT_TESTS.test(f));
  if (named.length) return named;
  return files.filter((f) => TEST_DIR.test(f) && CODE_EXT.test(f) && !NOT_TESTS.test(f));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function selectTests(git: Git, head: string, changed: string[], configured: string[]): Selected[] {
  const all = trackedFiles(git, head);
  const tests = testFiles(all);
  const byTest = new Map<string, string[]>();
  const note = (test: string, reason: string) => {
    const list = byTest.get(test) ?? [];
    if (!list.includes(reason)) list.push(reason);
    byTest.set(test, list);
  };
  // An extensionless name (VERSION, LICENSE) counts only as a string or path
  // segment, so a constant of the same name does not select a test.
  const bounded = (s: string) => (/\./.test(s.slice(s.lastIndexOf('/') + 1))
    ? new RegExp(`(^|[^\\w.-])${escape(s)}($|[^\\w-])`)
    : new RegExp(`['"\`/]${escape(s)}(?![\\w./-])`));
  const patterns = changed.map((path) => {
    const name = path.slice(path.lastIndexOf('/') + 1);
    return { path, name, pathRe: bounded(path), nameRe: bounded(name) };
  });
  for (const test of tests) {
    const text = readAt(git, head, test);
    if (text === undefined) continue;
    for (const p of patterns) {
      if (p.pathRe.test(text)) note(test, `names ${p.path}`);
      else if (p.name !== p.path && p.nameRe.test(text)) note(test, `names ${p.name}`);
    }
  }
  if (configured.length) {
    for (const pattern of configured) {
      const matches = all.filter(globMatcher([pattern]));
      if (!matches.length) throw new Refusal('CONFIG_TESTS_MISSING', `docs-ship:tests pattern ${pattern} matches no tracked files at head`, 'restore the configured tests or fix the marker on the base branch');
      for (const f of matches) note(f, 'docs-ship:tests');
    }
  }
  return [...byTest.entries()].map(([test, reasons]) => ({ test, reasons })).sort((a, b) => (a.test < b.test ? -1 : a.test > b.test ? 1 : 0));
}

export function expandCommand(template: string, tests: string[]): string {
  if (!validTestCommand(template)) throw new Refusal('CONFIG_INVALID', 'unsafe docs-ship:test-command template', 'use one standalone unquoted {tests} argument; put shell syntax in a wrapper script');
  return template.replace('{tests}', () => tests.map((t) => {
    const path = t.startsWith('-') ? `./${t}` : t;
    return /^[\w./-]+$/.test(path) ? path : shellQuote(path);
  }).join(' '));
}
