import { GateError } from './errors.ts';

/**
 * `*` matches within one path segment. `**` matches zero or more segments,
 * so `**​/*.ts` matches a root-level `a.ts`; a trailing `**` (`vendor/**`, or a
 * bare `**`) matches every file below it. `?` and `+` are literals.
 * Brackets and braces are rejected.
 */
export function assertGlob(pattern: string, flag = '--exclude'): void {
  if (/[[\]{}]/.test(pattern)) {
    throw new GateError(
      'usage',
      `${flag}: '${pattern}' contains a bracket or brace, which is not supported`,
      'use * and ** only; quote the glob so the shell does not expand it',
    );
  }
}

export function matchGlob(file: string, pattern: string): boolean {
  return globMatcher([pattern])(file);
}

/** Compile the patterns once and return a matcher that is true when any pattern matches. */
export function globMatcher(patterns: string[]): (file: string) => boolean {
  for (const p of patterns) assertGlob(p);
  const compiled = patterns.map(compileGlob);
  return file => compiled.some(re => re.test(file));
}

/** A `**` segment matches zero or more directories; a trailing `**` also matches the file. */
function compileGlob(pattern: string): RegExp {
  const segments = pattern.split('/');
  let re = '^';
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i] ?? '';
    const last = i === segments.length - 1;
    if (seg === '**') {
      re += last ? '[\\s\\S]+' : '(?:[^/]+/)*';
      continue;
    }
    re += segmentRegex(seg);
    if (!last) re += '/';
  }
  return new RegExp(`${re}$`);
}

function segmentRegex(seg: string): string {
  let out = '';
  for (const ch of seg) {
    if (ch === '*') out += '[^/]*';
    else out += escapeChar(ch);
  }
  return out;
}

function escapeChar(ch: string): string {
  return /[\\^$.|+?()[\]]/.test(ch) ? `\\${ch}` : ch;
}
