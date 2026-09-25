import { sha256Canonical } from './canon.ts';

export const GATE_VERSION = 1;
export const COLLECTOR_VERSION = 1;
export const EVIDENCE_V = 1;
export const VERDICT_V = 1;

export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
export const RENAME_LIMIT = 10000;
export const API_LINE_LIMIT = 20000;
export const API_BLOB_LIMIT = 1024 * 1024;

export const GH_FIELDS = [
  'number', 'url', 'state', 'isDraft', 'mergeable', 'mergeStateStatus',
  'reviewDecision', 'statusCheckRollup', 'baseRefName', 'baseRefOid',
  'headRefName', 'headRefOid', 'additions', 'deletions', 'changedFiles',
  'labels', 'author', 'createdAt', 'updatedAt', 'mergedAt', 'closedAt',
  'reviewRequests',
].join(',');

export const LOCKFILES = [
  'bun.lock', 'bun.lockb', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'Cargo.lock', 'go.sum', 'poetry.lock', 'uv.lock', 'Gemfile.lock', 'Pipfile.lock',
  'composer.lock', 'Podfile.lock', 'pubspec.lock', 'mix.lock', 'Package.resolved',
  'npm-shrinkwrap.json', 'packages.lock.json', 'gradle.lockfile', 'flake.lock',
];

export const UNSUPPORTED_MANIFESTS = [
  'pom.xml', 'build.gradle', 'build.gradle.kts', 'build.sbt', 'composer.json',
  'Pipfile', 'setup.py', 'setup.cfg', 'environment.yml', 'Package.swift',
  'Podfile', 'pubspec.yaml', 'deno.json', 'mix.exs', 'packages.config',
];

export const UNSUPPORTED_SUFFIXES = ['.gemspec', '.csproj'];

export const TEST_DEP_SEGMENTS = ['test', 'tests', '__tests__', 'spec', 'fixtures', '__fixtures__', 'testdata'];

export const API_CAPABLE_EXTENSIONS = [
  '.sh', '.bash', '.rb', '.java', '.kt', '.swift', '.c', '.h', '.cpp', '.hpp',
  '.cs', '.php', '.scala', '.ex', '.exs', '.lua',
];

export const DEFAULT_POLICY = {
  max_net_lines: 500,
  max_new_files: 10,
  max_new_deps: 0,
  max_new_public_api: 10,
  max_churn: null as number | null,
  exclude: [] as string[],
};

export type Policy = {
  max_net_lines: number | null;
  max_new_files: number | null;
  max_new_deps: number | null;
  max_new_public_api: number | null;
  max_churn: number | null;
  exclude: string[];
};

export const POLICY_KEYS = [
  'exclude', 'max_churn', 'max_net_lines', 'max_new_deps', 'max_new_files', 'max_new_public_api',
] as const;

export const REASON_REGISTRY = [
  { code: 'net_lines_over_budget', class: 'budget', blocking: true },
  { code: 'new_files_over_budget', class: 'budget', blocking: true },
  { code: 'new_deps_over_budget', class: 'budget', blocking: true },
  { code: 'new_public_api_over_budget', class: 'budget', blocking: true },
  { code: 'churn_over_budget', class: 'budget', blocking: true },
  { code: 'deps_unverifiable', class: 'evidence', blocking: true },
  { code: 'empty_diff', class: 'evidence', blocking: true },
  { code: 'evidence_incomplete', class: 'evidence', blocking: true },
  { code: 'rename_detection_incomplete', class: 'evidence', blocking: true },
  { code: 'pr_draft', class: 'readiness', blocking: true },
  { code: 'merge_conflict', class: 'readiness', blocking: true },
  { code: 'mergeability_unknown', class: 'readiness', blocking: true },
  { code: 'checks_failing', class: 'readiness', blocking: true },
  { code: 'checks_pending', class: 'readiness', blocking: true },
  { code: 'check_state_unknown', class: 'readiness', blocking: true },
  { code: 'changes_requested', class: 'readiness', blocking: true },
  { code: 'review_required', class: 'readiness', blocking: true },
  { code: 'checks_truncated', class: 'readiness', blocking: true },
  { code: 'binary_files_excluded', class: 'info', blocking: false },
  { code: 'pr_signals_not_checked', class: 'info', blocking: false },
  { code: 'retroactive_pr_state', class: 'info', blocking: false },
  { code: 'no_checks_configured', class: 'info', blocking: false },
  { code: 'github_merge_state', class: 'info', blocking: false },
  { code: 'api_coverage_partial', class: 'info', blocking: false },
] as const;

export type ReasonCode = (typeof REASON_REGISTRY)[number]['code'];
export type ReasonClass = 'budget' | 'readiness' | 'evidence' | 'info';

export const PR_SIGNAL_TABLE = {
  mergeable_pass: ['MERGEABLE'],
  mergeable_conflict: ['CONFLICTING'],
  review_pass: ['APPROVED', '', null],
  review_changes: ['CHANGES_REQUESTED'],
  review_required: ['REVIEW_REQUIRED'],
  check_run_pending_status: 'COMPLETED',
  check_run_success: ['SUCCESS'],
  check_run_neutral: ['NEUTRAL', 'SKIPPED'],
  check_run_failure: ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'],
  status_success: ['SUCCESS'],
  status_pending: ['PENDING', 'EXPECTED'],
  status_failure: ['FAILURE', 'ERROR'],
  truncation_count: 100,
};

export const ERROR_CODES = [
  'usage', 'not_a_repo', 'git_missing', 'git_unsupported_version', 'ref_not_found',
  'no_merge_base', 'commit_not_local', 'no_remote', 'repo_mismatch', 'gh_missing',
  'gh_failed', 'gh_bad_json', 'gh_auth', 'spawn_timeout', 'forbidden_command',
  'evidence_not_found', 'evidence_corrupt', 'evidence_unsupported_version',
  'store_error', 'store_refused', 'internal_error', 'test_env_refused',
  'bun_missing', 'git_failed',
] as const;

export type RegexSpec = { source: string; flags: string };

export const API_RULES: {
  id: string;
  extensions: string[];
  pattern: RegexSpec;
  group: number;
}[] = [
  {
    id: 'ts-decl',
    extensions: ['.ts', '.tsx', '.mts', '.cts', '.d.ts', '.js', '.jsx', '.mjs', '.cjs'],
    pattern: {
      source: String.raw`^export\s+(default\s+)?(declare\s+)?(async\s+)?(abstract\s+)?(function\*?|class|const|let|var|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)`,
      flags: '',
    },
    group: 6,
  },
  {
    id: 'ts-default',
    extensions: ['.ts', '.tsx', '.mts', '.cts', '.d.ts', '.js', '.jsx', '.mjs', '.cjs'],
    pattern: { source: String.raw`^export\s+default\b`, flags: '' },
    group: 0,
  },
  {
    id: 'ts-list',
    extensions: ['.ts', '.tsx', '.mts', '.cts', '.d.ts', '.js', '.jsx', '.mjs', '.cjs'],
    pattern: { source: String.raw`^export\s*(type\s*)?\{([^}]*)\}`, flags: '' },
    group: 2,
  },
  {
    id: 'ts-list-open',
    extensions: ['.ts', '.tsx', '.mts', '.cts', '.d.ts', '.js', '.jsx', '.mjs', '.cjs'],
    pattern: { source: String.raw`^export\s*(type\s*)?\{`, flags: '' },
    group: 0,
  },
  {
    id: 'ts-star',
    extensions: ['.ts', '.tsx', '.mts', '.cts', '.d.ts', '.js', '.jsx', '.mjs', '.cjs'],
    pattern: { source: String.raw`^export\s*\*\s*(as\s+(\w+)\s+)?from\s+['"]([^'"]+)`, flags: '' },
    group: 2,
  },
  {
    id: 'js-cjs-assign',
    extensions: ['.js', '.cjs'],
    pattern: { source: String.raw`^module\.exports\s*=`, flags: '' },
    group: 0,
  },
  {
    id: 'js-cjs',
    extensions: ['.js', '.cjs'],
    pattern: { source: String.raw`^(module\.)?exports\.([A-Za-z_$][\w$]*)\s*=`, flags: '' },
    group: 2,
  },
  {
    id: 'py-def',
    extensions: ['.py'],
    pattern: { source: String.raw`^(?:async\s+)?def\s+([A-Za-z]\w*)|^class\s+([A-Za-z]\w*)`, flags: '' },
    group: 1,
  },
  {
    id: 'go-exported',
    extensions: ['.go'],
    pattern: {
      source: String.raw`^func\s+\([^)]*?(\w+)(\[[^\]]*\])?\)\s*([A-Z]\w*)|^func\s+([A-Z]\w*)|^type\s+([A-Z]\w*)|^(?:var|const)\s+([A-Z]\w*)`,
      flags: '',
    },
    group: 3,
  },
  {
    id: 'rust-pub',
    extensions: ['.rs'],
    pattern: {
      source: String.raw`^\s*pub\s+(?:async\s+)?(?:unsafe\s+)?(?:fn|struct|enum|trait|type|const|static|mod|union)\s+([A-Za-z_]\w*)`,
      flags: '',
    },
    group: 1,
  },
];

export const DEP_GRAMMAR = {
  npm_sections: ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'],
  npm_local_prefixes: ['workspace:', 'file:', 'link:', 'portal:'],
  requirements_include: ['-r', '--requirement', '-c', '--constraint'],
  poetry_skip_keys: ['python'],
  cargo_sections: ['dependencies', 'dev-dependencies', 'build-dependencies'],
  local_markers: ['path', 'workspace'],
};

export function gateTablesForHash(): unknown {
  return {
    reasons: REASON_REGISTRY,
    lockfiles: LOCKFILES,
    pr_signals: PR_SIGNAL_TABLE,
    default_policy: DEFAULT_POLICY,
    api_capable_extensions: API_CAPABLE_EXTENSIONS,
    test_dep_segments: TEST_DEP_SEGMENTS,
  };
}

export function collectorTablesForHash(): unknown {
  return {
    api_rules: API_RULES,
    dep_grammar: DEP_GRAMMAR,
    unsupported_manifests: UNSUPPORTED_MANIFESTS,
    unsupported_suffixes: UNSUPPORTED_SUFFIXES,
    api_line_limit: API_LINE_LIMIT,
    api_blob_limit: API_BLOB_LIMIT,
  };
}

export function hashGateTables(): string {
  return sha256Canonical(gateTablesForHash());
}

export function hashCollectorTables(): string {
  return sha256Canonical(collectorTablesForHash());
}

/** Pinned {version: hash}. A table change without a version bump fails the test. */
export const GATE_FINGERPRINTS: Record<string, string> = {
  '1': '22f929a8d527643255a8c64f82c9b31598e8f87d148b81fd52472571c971258d',
};

export const COLLECTOR_FINGERPRINTS: Record<string, string> = {
  '1': '4431916b51f9cecc2f9913770c910975d93191753c3d24758d9ffa057956e00d',
};
