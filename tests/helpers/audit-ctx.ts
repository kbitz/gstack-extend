/**
 * audit-ctx.ts — override-based factory for AuditCtx and a stub GitGateway.
 *
 * Direct check tests need to construct an AuditCtx without spinning up a
 * fixture repo + parser pipeline. The factory provides every required field
 * with a sensible default, and accepts overrides for any subset. Tests stay
 * focused on the slice they actually exercise (e.g. phase-invariants tests
 * pass `phases` + `roadmap.groups` + `scaffoldExists` and ignore everything
 * else).
 *
 * Why not extend the inline `makeCtx` from check-staleness: each new check
 * test needed richer ctx (parsed phases for phases.ts, scaffold map for
 * phase-invariants), and three inline copies would drift the day AuditCtx
 * gains a required field. One factory, one update site.
 *
 * stubGit() returns a no-op GitGateway with overridable methods. Pass `tags`
 * for staleness tests; everything else returns null/[] by default.
 */

import type { ParsedPhases, PhaseInfo } from '../../src/audit/parsers/phases.ts';
import type { ParsedProgress } from '../../src/audit/parsers/progress.ts';
import type { ParsedRoadmap } from '../../src/audit/parsers/roadmap.ts';
import type { ParsedTodos } from '../../src/audit/parsers/todos.ts';
import type { GitGateway } from '../../src/audit/lib/git.ts';
import type {
  AuditCtx,
  AuditFileContents,
  AuditFileExists,
  AuditFilePaths,
  DesignDoc,
  MdFileSnapshot,
  ParserResult,
  ScaffoldResolution,
  SharedInfraSnapshot,
  VersionInfo,
} from '../../src/audit/types.ts';

export type StubGitOpts = {
  toplevel?: string | null;
  tags?: string[];
  latest?: string | null;
  diffNames?: string[];
  logFirstWithPhrase?: { date: string } | null;
  logSubjectsSince?: string[];
};

export function stubGit(opts: StubGitOpts = {}): GitGateway {
  return {
    toplevel: () => opts.toplevel ?? null,
    tags: () => opts.tags ?? [],
    tagsLatest: () => opts.latest ?? null,
    diffNamesBetween: () => opts.diffNames ?? [],
    logFirstWithPhrase: () => opts.logFirstWithPhrase ?? null,
    logSubjectsSince: () => opts.logSubjectsSince ?? [],
  };
}

export type MakeCtxOpts = {
  roadmap?: string;
  todos?: string;
  progress?: string;
  version?: string;
  changelog?: string;
  pyproject?: string;
  current?: string;
  git?: GitGateway;
  paths?: Partial<AuditFilePaths>;
  exists?: Partial<AuditFileExists>;
  designs?: DesignDoc[];
  scaffoldExists?: ScaffoldResolution;
  mdFiles?: MdFileSnapshot[];
  sharedInfra?: SharedInfraSnapshot;
  parallelismCap?: number;
  claudeMd?: string;
  parsedRoadmap?: Partial<ParsedRoadmap>;
  parsedPhases?: PhaseInfo[];
  parsedTodos?: Partial<ParsedTodos>;
  parsedProgress?: Partial<ParsedProgress>;
  versionInfo?: Partial<VersionInfo>;
};

const EMPTY_EXISTS: AuditFileExists = {
  rootTodos: false,
  docsTodos: false,
  rootRoadmap: false,
  docsRoadmap: true,
  rootProgress: false,
  docsProgress: false,
  versionFile: true,
  pyprojectFile: false,
  changelogFile: false,
  docsDir: true,
  designsDir: false,
  rootReadme: false,
  docsReadme: false,
  rootChangelog: false,
  docsChangelog: false,
  rootClaude: false,
  docsClaude: false,
  rootVersion: true,
  docsVersion: false,
  rootLicense: false,
  docsLicense: false,
  rootLicenseMd: false,
  docsLicenseMd: false,
};

function defaultParsedRoadmap(overrides: Partial<ParsedRoadmap> = {}): ParserResult<ParsedRoadmap> {
  return {
    value: {
      groups: [],
      tracks: [],
      styleLintWarnings: [],
      sizeLabelMismatches: [],
      trackDepCycles: [],
      hasV2Grammar: false,
      futureBullets: [],
      futureMalformed: [],
      ...overrides,
    },
    errors: [],
  };
}

function defaultParsedPhases(phases: PhaseInfo[] = []): ParserResult<ParsedPhases> {
  return { value: { phases }, errors: [] };
}

function defaultParsedTodos(overrides: Partial<ParsedTodos> = {}): ParserResult<ParsedTodos> {
  return {
    value: { hasUnprocessedSection: false, entries: [], ...overrides },
    errors: [],
  };
}

function defaultParsedProgress(
  overrides: Partial<ParsedProgress> = {},
): ParserResult<ParsedProgress> {
  return {
    value: { versions: [], latestVersion: null, rawTableLines: [], ...overrides },
    errors: [],
  };
}

function defaultVersionInfo(current: string, overrides: Partial<VersionInfo> = {}): VersionInfo {
  return {
    current,
    source: 'VERSION',
    latestTag: null,
    progressLatest: null,
    changelogLatest: null,
    ...overrides,
  };
}

export function makeCtx(opts: MakeCtxOpts = {}): AuditCtx {
  const current = opts.current ?? opts.version ?? '0.5.0';

  const paths: AuditFilePaths = {
    todos: opts.todos !== undefined ? 'TODOS.md' : null,
    roadmap: opts.roadmap !== undefined ? 'ROADMAP.md' : null,
    progress: opts.progress !== undefined ? 'PROGRESS.md' : null,
    ...opts.paths,
  };

  const files: AuditFileContents = {
    roadmap: opts.roadmap ?? '',
    todos: opts.todos ?? '',
    progress: opts.progress ?? '',
    version: opts.version ?? current,
    changelog: opts.changelog ?? '',
    pyproject: opts.pyproject ?? '',
  };

  return {
    repoRoot: '/tmp/x',
    extendDir: '/tmp/x',
    env: { stateDir: '/tmp/x', scanState: false },
    git: opts.git ?? stubGit(),
    paths,
    files,
    exists: { ...EMPTY_EXISTS, ...opts.exists },
    designs: opts.designs ?? [],
    scaffoldExists: opts.scaffoldExists ?? new Map(),
    mdFiles: opts.mdFiles ?? [],
    sharedInfra: opts.sharedInfra ?? { status: 'missing' },
    parallelismCap: opts.parallelismCap ?? 3,
    claudeMd: opts.claudeMd ?? '',
    roadmap: defaultParsedRoadmap(opts.parsedRoadmap),
    phases: defaultParsedPhases(opts.parsedPhases),
    todos: defaultParsedTodos(opts.parsedTodos),
    progress: defaultParsedProgress(opts.parsedProgress),
    version: defaultVersionInfo(current, opts.versionInfo),
  };
}
