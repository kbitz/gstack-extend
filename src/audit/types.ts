/**
 * audit/types.ts — cross-cutting types for the TS port of bin/roadmap-audit.
 *
 * AuditCtx is constructed once in cli.ts and passed by value into every check.
 * Each check is `(ctx: AuditCtx) => CheckResult`. Pure functions, no I/O —
 * the gateway in lib/git.ts is the only place that touches subprocesses.
 *
 * Output rendering: cli.ts emits
 *   `## ${section}\n${preamble?.join('\n')}\nSTATUS: ${status}\n${body.join('\n')}\n`
 * with a trailing blank line between sections to match the bash output exactly.
 *
 * Parsed* type aliases below are intentionally unknown at the audit-types layer
 * and are narrowed to concrete shapes by the parser modules that produce them.
 * The narrowing is statically enforced by parsers re-exporting their concrete
 * types and cli.ts wiring them into AuditCtx via type assertion at construction.
 */

import type { GitGateway } from './lib/git.ts';

// ─── Parser result shape (T1: parsers return value + errors) ──────────

export type ParseErrorKind = 'malformed' | 'missing-required' | 'duplicate' | 'unknown';

export type ParseError = {
  file: string;
  line?: number;
  message: string;
  kind: ParseErrorKind;
};

export type ParserResult<T> = {
  value: T;
  errors: ParseError[];
};

// ─── Check result shape ───────────────────────────────────────────────

export type CheckStatus =
  | 'pass'
  | 'fail'
  | 'warn'
  | 'info'
  | 'skip'
  | 'found'
  | 'none'
  | 'error';

export type CheckResult = {
  section: string;
  preamble?: string[];
  status: CheckStatus;
  body: string[];
};

// ─── Version info ─────────────────────────────────────────────────────

export type VersionInfo = {
  current: string;
  source: 'VERSION' | 'pyproject.toml' | 'package.json' | 'unknown';
  latestTag: string | null;
  progressLatest: string | null;
  changelogLatest: string | null;
};

// ─── Parsed type placeholders (concrete in parser modules) ────────────
//
// These are deliberately structural placeholders. As each parser module
// lands, replace the `unknown` here with `import type { Parsed* } from`.
// Marked `Record<string, unknown>` rather than `unknown` so AuditCtx
// stays usable in checks that only need a few fields during the port.

export type ParsedRoadmap = Record<string, unknown>;
export type ParsedPhases = Record<string, unknown>;
export type ParsedTodos = Record<string, unknown>;
export type ParsedProgress = Record<string, unknown>;

// ─── AuditCtx — passed by value into every check ──────────────────────

export type AuditEnv = {
  stateDir: string;
  scanState: boolean;
  userPrompt?: string;
};

export type AuditCtx = {
  repoRoot: string;
  extendDir: string;
  env: AuditEnv;
  git: GitGateway;
  roadmap: ParserResult<ParsedRoadmap>;
  phases: ParserResult<ParsedPhases>;
  todos: ParserResult<ParsedTodos>;
  progress: ParserResult<ParsedProgress>;
  version: VersionInfo;
};

// All parse errors aggregated — cli.ts emits ## PARSE_ERRORS only when non-empty (T1).
export function collectParseErrors(ctx: AuditCtx): ParseError[] {
  return [
    ...ctx.roadmap.errors,
    ...ctx.phases.errors,
    ...ctx.todos.errors,
    ...ctx.progress.errors,
  ];
}
