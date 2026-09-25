import { GateError } from './errors.ts';

/**
 * `*` matches within one path segment. `**` matches zero or more segments,
 * so `**​/*.ts` matches a root-level `a.ts`. `?` and `+` are literals.
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
  assertGlob(pattern);
  return compileGlob(pattern).test(file);
}

function compileGlob(pattern: string): RegExp {
  const segments = pattern.split('/');
  let re = '^';
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i] ?? '';
    if (seg === '**') {
      re += '(?:(?:[^/]+/)*)';
      continue;
    }
    re += segmentRegex(seg);
    const next = segments[i + 1];
    if (next !== undefined && next !== '**') re += '/';
    if (next === '**') re += '/';
  }
  re += '$';
  return new RegExp(re);
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
