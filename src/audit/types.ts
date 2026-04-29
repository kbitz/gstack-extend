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
import type { ParsedPhases } from './parsers/phases.ts';
import type { ParsedProgress } from './parsers/progress.ts';
import type { ParsedRoadmap } from './parsers/roadmap.ts';
import type { ParsedTodos } from './parsers/todos.ts';

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

// ─── AuditCtx — passed by value into every check ──────────────────────

export type AuditEnv = {
  stateDir: string;
  scanState: boolean;
  userPrompt?: string;
};

// File paths resolved by find_doc (root first, then docs/). null when neither exists.
export type AuditFilePaths = {
  todos: string | null;
  roadmap: string | null;
  progress: string | null;
};

// File contents (empty string when the corresponding file is missing). Parsers
// already handle empty input gracefully; checks that grep raw content treat
// "" as "no findings" — matches bash where `grep < /dev/null` returns nothing.
export type AuditFileContents = {
  roadmap: string;
  todos: string;
  progress: string;
  version: string; // VERSION file content (raw, no trim)
  changelog: string; // CHANGELOG.md content
  pyproject: string; // pyproject.toml content
};

// Existence flags used by checks that decide on file location, not content.
// Mirrors bash `[ -f "$REPO_ROOT/X" ]` test points; collected once in cli.ts.
export type AuditFileExists = {
  // Project docs in either location (TAXONOMY duplicates check).
  rootTodos: boolean;
  docsTodos: boolean;
  rootRoadmap: boolean;
  docsRoadmap: boolean;
  rootProgress: boolean;
  docsProgress: boolean;
  // Root-only docs.
  versionFile: boolean;
  pyprojectFile: boolean;
  changelogFile: boolean;
  // Layout indicators.
  docsDir: boolean;
  designsDir: boolean;
  // ROOT_DOCS / DOCS_DIR_DOCS pairs for DOC_LOCATION (one bit per location).
  rootReadme: boolean;
  docsReadme: boolean;
  rootChangelog: boolean;
  docsChangelog: boolean;
  rootClaude: boolean;
  docsClaude: boolean;
  rootVersion: boolean;
  docsVersion: boolean;
  rootLicense: boolean;
  docsLicense: boolean;
  rootLicenseMd: boolean;
  docsLicenseMd: boolean;
};

// One design doc (basename + content) for ARCHIVE_CANDIDATES. cli.ts reads
// these once so the check doesn't touch the filesystem.
export type DesignDoc = {
  basename: string;
  content: string;
};

// Pre-resolved scaffolding-path existence keyed by `${phaseNum}|${path}`.
// cli.ts populates this so check_phase_invariants stays pure (no I/O in
// checks). For glob paths, value is true iff at least one match expanded.
export type ScaffoldResolution = Map<string, boolean>;

export type AuditCtx = {
  repoRoot: string;
  extendDir: string;
  env: AuditEnv;
  git: GitGateway;
  paths: AuditFilePaths;
  files: AuditFileContents;
  exists: AuditFileExists;
  designs: DesignDoc[];
  scaffoldExists: ScaffoldResolution;
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
