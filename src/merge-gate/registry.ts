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

/** A `*.` name matches by suffix; any other name matches the whole basename. */
export const UNSUPPORTED_MANIFESTS: { name: string; label: string }[] = [
  { name: 'pom.xml', label: 'Maven' },
  { name: 'build.gradle', label: 'Gradle' },
  { name: 'build.gradle.kts', label: 'Gradle' },
  { name: 'build.sbt', label: 'sbt' },
  { name: 'composer.json', label: 'Composer' },
  { name: 'Pipfile', label: 'Pipfile' },
  { name: 'setup.py', label: 'setuptools' },
  { name: 'setup.cfg', label: 'setuptools' },
  { name: 'environment.yml', label: 'Conda' },
  { name: '*.gemspec', label: 'gemspec' },
  { name: 'Package.swift', label: 'Swift Package Manager' },
  { name: 'Podfile', label: 'CocoaPods' },
  { name: 'pubspec.yaml', label: 'Pub' },
  { name: 'deno.json', label: 'Deno' },
  { name: 'mix.exs', label: 'Mix' },
  { name: '*.csproj', label: '.NET' },
  { name: 'packages.config', label: '.NET' },
];

export const TEST_DEP_SEGMENTS = ['test', 'tests', '__tests__', 'spec', 'fixtures', '__fixtures__', 'testdata'];

/** Paths excluded from public-API counting (CEO-S9). */
export const TEST_PATHS: { segments: string[]; basenames: RegexSpec[] } = {
  segments: ['test', 'tests', '__tests__', 'spec'],
  basenames: [
    { source: String.raw`\.(?:test|spec)\.[^.]+$`, flags: '' },
    { source: String.raw`_test\.go$`, flags: '' },
    { source: String.raw`^test_.*\.py$`, flags: '' },
    { source: String.raw`_test\.py$`, flags: '' },
    { source: String.raw`^conftest\.py$`, flags: '' },
  ],
};

/** List lengths kept in a verdict; the matching `*_count` field has the full total. */
export const OUTPUT_CAPS = {
  subjects: 20,
  detail_names: 20,
  top_churn: 3,
  excluded: 100,
  unmeasured_api: 50,
};

/**
 * Minimum git (CEO-S18, CEO-V10): 2.41 for the global `--attr-source` option,
 * and 2.45 in a partial clone, the first release where GIT_NO_LAZY_FETCH stops
 * lazy blob fetches.
 */
export const GIT_FLOOR = { full: { major: 2, minor: 41 }, partial: { major: 2, minor: 45 } };

/** `git config --get-regexp` keys (canonical lowercase) that mark a partial clone. */
export const PARTIAL_CLONE_KEYS = String.raw`^extensions\.partialclone$|^remote\..+\.(promisor|partialclonefilter)$`;

/**
 * Config pinned for every git child through GIT_CONFIG_COUNT. Command-line
 * level config outranks the repository's own, so a repo-local setting cannot
 * change quoting, attributes, binary detection, or submodule visibility.
 */
export const GIT_PINNED_CONFIG: [string, string][] = [
  ['core.quotePath', 'false'],
  ['core.fsmonitor', 'false'],
  ['core.attributesFile', '/dev/null'],
  ['core.bigFileThreshold', '512m'],
  ['diff.ignoreSubmodules', 'none'],
];

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
  check_run_completed_status: 'COMPLETED',
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

const compiledSpecs = new Map<RegexSpec, RegExp>();

/** Compile a table regex once. `lastIndex` is reset so `g` specs are safe to reuse. */
export function regex(spec: RegexSpec): RegExp {
  let r = compiledSpecs.get(spec);
  if (!r) {
    r = new RegExp(spec.source, spec.flags);
    compiledSpecs.set(spec, r);
  }
  r.lastIndex = 0;
  return r;
}

/**
 * How a public-API matcher turns a match into names:
 * `group` takes the first non-empty capture; `file` is `<label>@<path>`;
 * `export-list` reads `a as b, type c` (a `default` name becomes `default@<path>`);
 * `idents` splits a comma list and keeps names matching `keep`;
 * `receiver` is `<receiver type>.<method>`; `star` is the alias or `*:<source>`.
 */
export type ApiName =
  | { from: 'group'; groups: number[] }
  | { from: 'file'; label: string }
  | { from: 'export-list'; group: number }
  | { from: 'idents'; group: number; keep: RegexSpec }
  | { from: 'receiver'; receiver: number; group: number }
  | { from: 'star'; alias: number; source: number };

/**
 * A matcher with `within` applies only between an `open` line and a `close`
 * line. The scan starts inside when the hunk's function-context line (the
 * text after `@@ ... @@`) matches `open`, so names added to an existing block
 * are seen even though `-U0` omits the block's first line.
 */
export type ApiMatcher = {
  pattern: RegexSpec;
  name: ApiName;
  within?: { open: RegexSpec; close: RegexSpec };
};

export type ApiRule = {
  id: string;
  extensions: string[];
  matchers: ApiMatcher[];
  /** Skip this rule on a line where the named rule matched. */
  unless?: string;
};

const TS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.d.ts', '.js', '.jsx', '.mjs', '.cjs'];
const JS_IDENT = String.raw`[A-Za-z_$][\w$]*`;
const TS_MEMBER = String.raw`(?:type\s+)?${JS_IDENT}(?:\s+as\s+${JS_IDENT})?`;
const TS_LIST_OPEN = String.raw`^export\s*(?:type\s*)?\{`;
const GO_IDENTS = String.raw`[A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*`;
const GO_EXPORTED: RegexSpec = { source: '^[A-Z]', flags: '' };

export const API_RULES: ApiRule[] = [
  {
    id: 'ts-decl',
    extensions: TS_EXTENSIONS,
    matchers: [{
      pattern: {
        source: String.raw`^export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\s*\*\s*|(?:function|class|(?:const\s+)?enum|const|let|var|interface|type|namespace|module)\s+)(${JS_IDENT})`,
        flags: '',
      },
      name: { from: 'group', groups: [1] },
    }],
  },
  {
    id: 'ts-default',
    extensions: TS_EXTENSIONS,
    unless: 'ts-decl',
    matchers: [{ pattern: { source: String.raw`^export\s+default\b`, flags: '' }, name: { from: 'file', label: 'default' } }],
  },
  {
    id: 'ts-list',
    extensions: TS_EXTENSIONS,
    matchers: [
      { pattern: { source: String.raw`${TS_LIST_OPEN}([^}]*)\}`, flags: '' }, name: { from: 'export-list', group: 1 } },
      { pattern: { source: String.raw`${TS_LIST_OPEN}([^}]*)$`, flags: '' }, name: { from: 'export-list', group: 1 } },
      {
        pattern: { source: String.raw`^\s*(${TS_MEMBER}(?:\s*,\s*${TS_MEMBER})*)\s*,?\s*(?://.*)?$`, flags: '' },
        name: { from: 'export-list', group: 1 },
        within: {
          open: { source: String.raw`${TS_LIST_OPEN}[^}]*$`, flags: '' },
          close: { source: String.raw`\}`, flags: '' },
        },
      },
    ],
  },
  {
    id: 'ts-star',
    extensions: TS_EXTENSIONS,
    matchers: [{
      pattern: { source: String.raw`^export\s*\*\s*(?:as\s+(${JS_IDENT})\s+)?from\s*['"]([^'"]+)['"]`, flags: '' },
      name: { from: 'star', alias: 1, source: 2 },
    }],
  },
  {
    id: 'js-cjs-assign',
    extensions: ['.js', '.cjs'],
    matchers: [{ pattern: { source: String.raw`^module\.exports\s*=(?!=)`, flags: '' }, name: { from: 'file', label: 'module.exports' } }],
  },
  {
    id: 'js-cjs',
    extensions: ['.js', '.cjs'],
    matchers: [{
      pattern: { source: String.raw`^(?:module\.)?exports\.(${JS_IDENT})\s*=(?!=)`, flags: '' },
      name: { from: 'group', groups: [1] },
    }],
  },
  {
    id: 'py-def',
    extensions: ['.py'],
    matchers: [{
      pattern: { source: String.raw`^(?:async\s+)?def\s+([A-Za-z]\w*)|^class\s+([A-Za-z]\w*)`, flags: '' },
      name: { from: 'group', groups: [1, 2] },
    }],
  },
  {
    id: 'go-exported',
    extensions: ['.go'],
    matchers: [
      { pattern: { source: String.raw`^func\s*\(([^)]*)\)\s*([A-Z]\w*)`, flags: '' }, name: { from: 'receiver', receiver: 1, group: 2 } },
      { pattern: { source: String.raw`^func\s+([A-Z]\w*)`, flags: '' }, name: { from: 'group', groups: [1] } },
      { pattern: { source: String.raw`^type\s+([A-Z]\w*)`, flags: '' }, name: { from: 'group', groups: [1] } },
      { pattern: { source: String.raw`^(?:var|const)\s+(${GO_IDENTS})`, flags: '' }, name: { from: 'idents', group: 1, keep: GO_EXPORTED } },
      {
        pattern: { source: String.raw`^\t(${GO_IDENTS})(?:\s*=|\s+[^\s(=]|\s*$)`, flags: '' },
        name: { from: 'idents', group: 1, keep: GO_EXPORTED },
        within: {
          open: { source: String.raw`^(?:const|var|type)\s*\(\s*(?://.*)?$`, flags: '' },
          close: { source: String.raw`^\)`, flags: '' },
        },
      },
    ],
  },
  {
    id: 'rust-pub',
    extensions: ['.rs'],
    matchers: [{
      pattern: {
        source: String.raw`^\s*pub\s+(?:async\s+)?(?:unsafe\s+)?(?:fn|struct|enum|trait|type|const|static|mod|union)\s+([A-Za-z_]\w*)`,
        flags: '',
      },
      name: { from: 'group', groups: [1] },
    }],
  },
];

// PEP 508 requirement: name, extras, then a direct reference or version specifiers.
// The caller strips the environment marker (after `;`) first.
const PEP508_NAME = String.raw`[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?`;
const PEP508_EXTRAS = String.raw`\[\s*(?:${PEP508_NAME}(?:\s*,\s*${PEP508_NAME})*)?\s*\]`;
const PEP508_CLAUSE = String.raw`(?:===|==|!=|~=|<=|>=|<|>)\s*[A-Za-z0-9.*+!_-]+`;
const PEP508_SPEC = String.raw`${PEP508_CLAUSE}(?:\s*,\s*${PEP508_CLAUSE})*`;
const PEP508: RegexSpec = {
  source: String.raw`^(${PEP508_NAME})\s*(?:${PEP508_EXTRAS})?\s*(?:@\s*(\S+)|\(\s*${PEP508_SPEC}\s*\)|${PEP508_SPEC})?$`,
  flags: '',
};
const LOCAL_PATH: RegexSpec = { source: String.raw`^(?:\.\.?(?:[/\\]|$)|[/~]|file:)`, flags: 'i' };

// Gemfile values: quoted strings (no interpolation), symbols, literals, and flat arrays of those.
const RB_STR = String.raw`(?:'[^'\\]*'|"(?:[^"\\#]|#(?!\{))*")`;
const RB_SYM = String.raw`:[A-Za-z_]\w*[?!]?`;
const RB_ATOM = String.raw`(?:${RB_STR}|${RB_SYM}|true|false|nil)`;
const RB_VAL = String.raw`(?:${RB_ATOM}|\[\s*(?:${RB_ATOM}(?:\s*,\s*${RB_ATOM})*\s*,?)?\s*\])`;
const RB_OPT = String.raw`(?:[A-Za-z_]\w*:\s*${RB_VAL}|(?:${RB_SYM}|${RB_STR})\s*=>\s*${RB_VAL})`;

export const DEP_GRAMMAR = {
  npm_sections: ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'],
  npm_local_prefixes: ['workspace:', 'file:', 'link:', 'portal:'],
  requirements: {
    include_options: ['-r', '--requirement', '-c', '--constraint'],
    editable_options: ['-e', '--editable'],
    ignored_options: [
      '-i', '--index-url', '--extra-index-url', '-f', '--find-links', '--trusted-host',
      '--no-index', '--pre', '--prefer-binary', '--require-hashes', '--only-binary',
      '--no-binary', '--use-feature',
    ],
    comment: { source: String.raw`(?:^|\s+)#.*$`, flags: '' },
    option: { source: String.raw`^(--[A-Za-z][A-Za-z0-9-]*|-[A-Za-z])(?:\s*=\s*|\s+|$)(.*)$`, flags: '' },
    trailing_option: { source: String.raw`\s+--hash(?:\s*=\s*|\s+)\S+`, flags: 'g' },
    url: { source: String.raw`^(?:[A-Za-z][A-Za-z0-9+.-]*://|git\+)`, flags: '' },
    local: LOCAL_PATH,
    requirement: PEP508,
  },
  gemfile: {
    comment: { source: String.raw`(?:^|\s+)#.*$`, flags: '' },
    gem: {
      source: String.raw`^gem\s+['"]([A-Za-z0-9][A-Za-z0-9._-]*)['"](?:\s*,\s*(?:${RB_STR}|${RB_OPT}))*$`,
      flags: '',
    },
    local_option: { source: String.raw`(?:[\s,]path:|:path\s*=>|['"]path['"]\s*=>)`, flags: '' },
    gemspec: { source: String.raw`^gemspec\b`, flags: '' },
    allowed: [
      { source: String.raw`^source\s+${RB_STR}(?:\s+do)?$`, flags: '' },
      { source: String.raw`^(?:group|platforms?)\s+${RB_SYM}(?:\s*,\s*${RB_SYM})*(?:\s*,\s*[A-Za-z_]\w*:\s*${RB_VAL})*\s+do$`, flags: '' },
      { source: String.raw`^ruby\s+(?:${RB_STR}|[A-Za-z_]\w*:\s*${RB_STR})(?:\s*,\s*(?:${RB_STR}|[A-Za-z_]\w*:\s*${RB_STR}))*$`, flags: '' },
      { source: String.raw`^end$`, flags: '' },
    ],
  },
  gomod: {
    require: 'require',
    ignored_directives: ['module', 'go', 'toolchain', 'godebug', 'tool'],
    unsupported_directives: ['replace', 'exclude', 'retract'],
    indirect: { source: String.raw`//\s*indirect\b`, flags: '' },
  },
  cargo: {
    dep_tables: ['dependencies', 'dev-dependencies', 'dev_dependencies', 'build-dependencies', 'build_dependencies'],
  },
  pyproject: {
    project_dependencies: ['project', 'dependencies'],
    project_optional: ['project', 'optional-dependencies'],
    poetry_tables: [
      ['tool', 'poetry', 'dependencies'],
      ['tool', 'poetry', 'dev-dependencies'],
    ],
    poetry_group_prefix: ['tool', 'poetry', 'group'],
    poetry_group_suffix: 'dependencies',
    poetry_skip_keys: ['python'],
    pep508: PEP508,
  },
  toml_bare_key: { source: String.raw`^[A-Za-z0-9_-]+`, flags: '' },
  toml_local_attrs: ['path'],
  toml_workspace_attr: 'workspace',
};

export function gateTablesForHash(): unknown {
  return {
    reasons: REASON_REGISTRY,
    lockfiles: LOCKFILES,
    pr_signals: PR_SIGNAL_TABLE,
    default_policy: DEFAULT_POLICY,
    api_capable_extensions: API_CAPABLE_EXTENSIONS,
    test_dep_segments: TEST_DEP_SEGMENTS,
    test_paths: TEST_PATHS,
    output_caps: OUTPUT_CAPS,
  };
}

export function collectorTablesForHash(): unknown {
  return {
    api_rules: API_RULES,
    dep_grammar: DEP_GRAMMAR,
    unsupported_manifests: UNSUPPORTED_MANIFESTS,
    git_pinned_config: GIT_PINNED_CONFIG,
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
  '1': '4d4facdbe9d2ad447dd6421ed286533f75e779eb3863b2195a4262b3f64f53cc',
};

export const COLLECTOR_FINGERPRINTS: Record<string, string> = {
  '1': '94a4b7452b0b3367c66faab4778a98abc2af4a51e21ab4277152bf137a3becd2',
};
