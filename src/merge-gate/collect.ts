import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { binExecPair, isTestPath, scanLines } from './api.ts';
import { canonicalJson } from './canon.ts';
import { parseBatchCheck, parseCatFileBatch, parseRawNumstat, parseUnified, type FileFact } from './diff.ts';
import { manifestKind, parseManifest, unsupportedDetail, type ManifestParse } from './deps.ts';
import type { ApiFact, Evidence, ManifestFact } from './decide.ts';
import { GateError } from './errors.ts';
import { createGateway, parseGitVersion, type Gateway } from './exec.ts';
import {
  API_BLOB_LIMIT,
  API_LINE_LIMIT,
  COLLECTOR_VERSION,
  EMPTY_TREE,
  RENAME_LIMIT,
} from './registry.ts';
import {
  firstLine,
  identityMatches,
  parsePrUrl,
  parseRemote,
  redact,
  repoSpecFromRemote,
  repoSpecFromUrl,
  stripRemoteUrl,
  type RepoIdentity,
} from './redact.ts';

export type CollectInput = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  mode: 'git' | 'pr';
  baseRef?: string;
  headRef?: string;
  prNumber?: string;
  prUrl?: { host: string; owner: string; name: string; number: string };
  remote: string;
  decisionId: string | null;
  gitTimeoutMs: number;
  ghTimeoutMs: number;
  retryMs: number;
  now: () => Date;
  clockOverridden: boolean;
  testOverrides: string[];
  debug: boolean;
};

const ZERO = '0000000000000000000000000000000000000000';

export function installVersion(): string {
  try {
    const root = dirname(dirname(import.meta.dir));
    return readFileSync(join(root, 'VERSION'), 'utf8').trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function collect(input: CollectInput): { evidence: Evidence; canonical: string } {
  const started = input.now();
  const gateway = createGateway({
    cwd: input.cwd,
    parentEnv: input.env,
    gitTimeoutMs: input.gitTimeoutMs,
    ghTimeoutMs: input.ghTimeoutMs,
    debug: input.debug,
  });
  const toplevel = gateway.toplevel();
  const rooted = createGateway({
    cwd: toplevel,
    parentEnv: input.env,
    gitTimeoutMs: input.gitTimeoutMs,
    ghTimeoutMs: input.ghTimeoutMs,
    debug: input.debug,
  });
  const versionText = rooted.version();
  const parsed = parseGitVersion(versionText);
  if (!parsed) {
    throw new GateError('git_unsupported_version', `could not parse git version: ${versionText.trim()}`, 'install git 2.40 or newer');
  }
  const partial = rooted.partialClone();
  const floorMinor = partial ? 44 : 40;
  const ok = parsed.major > 2 || (parsed.major === 2 && parsed.minor >= floorMinor);
  if (!ok) {
    const need = partial ? '2.44' : '2.40';
    throw new GateError(
      'git_unsupported_version',
      `git ${parsed.major}.${parsed.minor} is below ${need}${partial ? ' (partial clone)' : ''}`,
      `install git ${need} or newer`,
    );
  }
  const originUrl = rooted.remoteUrl(input.remote);
  const origin = originUrl ? stripRemoteUrl(originUrl) : null;
  const remoteId = originUrl ? parseRemote(originUrl) : null;

  let prBlock: Evidence['pr'] = null;
  let baseSha = '';
  let headSha = '';

  if (input.mode === 'pr') {
    if (!origin || !remoteId) {
      throw new GateError(
        'no_remote',
        `remote '${input.remote}' has no URL`,
        `add a remote named ${input.remote}, or pass --remote with the base repository`,
      );
    }
    const spec = input.prUrl
      ? repoSpecFromUrl(input.prUrl)
      : repoSpecFromRemote(remoteId);
    const number = input.prUrl?.number ?? input.prNumber ?? '';
    const first = ghView(rooted, number, spec, input);
    let raw = first.raw;
    let rawFirst: Record<string, unknown> | null = null;
    let retryWait: number | null = null;
    const state = raw.state;
    if (state === 'OPEN' && raw.mergeable === 'UNKNOWN') {
      sleep(input.retryMs);
      retryWait = input.retryMs;
      rawFirst = first.raw;
      const second = ghView(rooted, number, spec, input);
      raw = second.raw;
    }
    const prId = parsePrUrl(String(raw.url ?? ''));
    if (!prId || !identityMatches(remoteId, prId)) {
      const want = prId ? `${prId.owner}/${prId.name}` : 'the pull request repository';
      throw new GateError(
        'repo_mismatch',
        `remote ${input.remote} does not match ${want}`,
        `run from a clone whose ${input.remote} is ${want}`,
      );
    }
    headSha = String(raw.headRefOid);
    baseSha = String(raw.baseRefOid);
    const missing: string[] = [];
    if (!rooted.verifyCommit(headSha)) missing.push('head');
    if (!rooted.verifyCommit(baseSha)) missing.push('base');
    if (missing.length > 0) {
      const bits: string[] = [];
      if (missing.includes('head')) bits.push(`pull/${number}/head`);
      if (missing.includes('base')) bits.push(String(raw.baseRefName ?? ''));
      throw new GateError(
        'commit_not_local',
        `missing local commit for ${missing.join(' and ')}`,
        `git fetch ${input.remote} ${bits.join(' ')}`,
      );
    }
    prBlock = {
      number: Number(raw.number),
      url: String(raw.url),
      repo: { host: prId.host, owner: prId.owner, name: prId.name },
      raw,
      raw_first: rawFirst,
      retry_wait_ms: retryWait,
    };
  } else {
    const baseRef = input.baseRef ?? '';
    const headRef = input.headRef ?? 'HEAD';
    const base = resolveRef(rooted, baseRef, input.remote);
    const head = resolveRef(rooted, headRef, input.remote);
    baseSha = base;
    headSha = head;
  }

  const mergeBase = rooted.mergeBase(baseSha, headSha);
  if (!mergeBase) {
    const shallow = rooted.isShallow();
    throw new GateError(
      'no_merge_base',
      'the base and head commits have no merge base',
      shallow ? 'git fetch --unshallow' : 'fetch the missing history so the commits share an ancestor',
    );
  }

  const diff = rooted.diffRaw(mergeBase, headSha);
  if (diff.overflow) {
    const done = finish(input, started, versionText, partial, origin, baseSha, headSha, mergeBase, prBlock, [], [{
      stage: 'diff', code: 'buffer_overflow', subjects: [],
    }]);
    return done;
  }
  if (diff.status !== 0 && diff.status !== null) {
    throw new GateError(
      'git_failed',
      firstLine(diff.stderr) || 'git diff failed',
      'confirm the commits exist locally and retry',
    );
  }
  const renameSkipped = diff.stderr.includes('inexact rename detection was skipped');
  const parsedDiff = parseRawNumstat(diff.stdout);
  const failures: Evidence['collection']['failures'] = [];
  if (parsedDiff.badStatus.length > 0) {
    failures.push({ stage: 'diff', code: 'bad_status', subjects: parsedDiff.badStatus });
  }

  const files = markLarge(rooted, parsedDiff.files);
  const manifests = loadManifests(rooted, files, failures);
  const apiFiles = loadApi(rooted, mergeBase, headSha, files, failures);

  const observed = input.now();
  const evidence: Evidence = {
    v: 1,
    observed_at: observed.toISOString(),
    collection_started_at: started.toISOString(),
    clock_overridden: input.clockOverridden,
    test_overrides: input.testOverrides,
    collector_version: COLLECTOR_VERSION,
    gstack_extend_version: installVersion(),
    git_version: versionText.trim(),
    partial_clone: partial,
    attr_source: EMPTY_TREE,
    rename_limit: RENAME_LIMIT,
    rename_detection_skipped: renameSkipped,
    decision_id: input.decisionId,
    repo: { origin },
    git: { base_sha: baseSha, head_sha: headSha, merge_base_sha: mergeBase, files },
    dependencies: { manifests },
    public_api: { files: apiFiles },
    collection: { complete: failures.length === 0, failures },
    pr: prBlock,
  };
  void ZERO;
  void isTestPath;
  void binExecPair;
  return { evidence, canonical: canonicalJson(evidence) };
}

function finish(
  input: CollectInput,
  started: Date,
  versionText: string,
  partial: boolean,
  origin: string | null,
  baseSha: string,
  headSha: string,
  mergeBase: string,
  pr: Evidence['pr'],
  files: FileFact[],
  failures: Evidence['collection']['failures'],
): { evidence: Evidence; canonical: string } {
  const evidence: Evidence = {
    v: 1,
    observed_at: input.now().toISOString(),
    collection_started_at: started.toISOString(),
    clock_overridden: input.clockOverridden,
    test_overrides: input.testOverrides,
    collector_version: COLLECTOR_VERSION,
    gstack_extend_version: installVersion(),
    git_version: versionText.trim(),
    partial_clone: partial,
    attr_source: EMPTY_TREE,
    rename_limit: RENAME_LIMIT,
    rename_detection_skipped: false,
    decision_id: input.decisionId,
    repo: { origin },
    git: { base_sha: baseSha, head_sha: headSha, merge_base_sha: mergeBase, files },
    dependencies: { manifests: [] },
    public_api: { files: [] },
    collection: { complete: false, failures },
    pr,
  };
  return { evidence, canonical: canonicalJson(evidence) };
}

function resolveRef(gateway: Gateway, ref: string, remote: string): string {
  const sha = gateway.verifyCommit(ref);
  if (sha) return sha;
  const alt = gateway.verifyCommit(`${remote}/${ref}`);
  const hint = alt ? `try ${remote}/${ref}` : 'pass a commit, branch, or tag that exists locally';
  throw new GateError('ref_not_found', `ref '${ref}' is not a commit`, hint);
}

function ghView(
  gateway: Gateway,
  number: string,
  spec: string,
  input: CollectInput,
): { raw: Record<string, unknown> } {
  let result;
  try {
    result = gateway.ghPrView(number, spec);
  } catch (err) {
    if (err instanceof GateError && err.code === 'gh_missing') throw err;
    throw err;
  }
  if (result.status === 4) {
    const host = spec.includes('/') && spec.split('/').length === 3 ? spec.split('/')[0] : 'github.com';
    throw new GateError('gh_auth', firstLine(result.stderr) || 'gh is not authenticated', `gh auth status -h ${host}; gh auth login -h ${host}`);
  }
  if (result.status !== 0) {
    const line = firstLine(result.stderr) || 'gh pr view failed';
    const multi = /multiple remotes|no default repository|no git remotes/i.test(result.stderr);
    throw new GateError(
      'gh_failed',
      redact(line),
      multi ? 'pass the PR URL instead of a number' : 'confirm gh can view the pull request and retry',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout.toString('utf8'));
  } catch {
    throw new GateError('gh_bad_json', 'gh returned invalid JSON', 'upgrade gh and retry');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new GateError('gh_bad_json', 'gh returned a non-object', 'upgrade gh and retry');
  }
  const raw = parsed as Record<string, unknown>;
  for (const key of ['state', 'url', 'headRefOid', 'baseRefOid', 'number'] as const) {
    if (raw[key] === undefined || raw[key] === null) {
      throw new GateError('gh_bad_json', `gh response is missing ${key}`, 'upgrade gh and retry');
    }
  }
  if (typeof raw.state !== 'string' || typeof raw.url !== 'string') {
    throw new GateError('gh_bad_json', 'gh response has a mistyped field', 'upgrade gh and retry');
  }
  if (typeof raw.headRefOid !== 'string' || typeof raw.baseRefOid !== 'string' || typeof raw.number !== 'number') {
    throw new GateError('gh_bad_json', 'gh response has a mistyped field', 'upgrade gh and retry');
  }
  void input;
  return { raw };
}

function markLarge(gateway: Gateway, files: FileFact[]): FileFact[] {
  const oids: string[] = [];
  for (const file of files) {
    if (file.binary || file.submodule || file.status === 'D') continue;
    if (file.additions + file.deletions > API_LINE_LIMIT) {
      file.api_skipped = 'too_large';
      continue;
    }
    if (/^[0-9a-f]{40}$/.test(file.new_oid) && !/^0+$/.test(file.new_oid)) oids.push(file.new_oid);
  }
  if (oids.length === 0) return files;
  const sizes = parseBatchCheck(gateway.catFileBatchCheck(oids));
  for (const file of files) {
    const size = sizes.get(file.new_oid);
    if (size !== undefined && size !== null && size > API_BLOB_LIMIT) file.api_skipped = 'too_large';
  }
  return files;
}

function loadManifests(gateway: Gateway, files: FileFact[], failures: Evidence['collection']['failures']): ManifestFact[] {
  const wanted = files.filter(f => {
    const kind = manifestKind(f.path);
    if (kind === 'lockfile' || kind === 'other') return false;
    if (f.status === 'D' && kind === 'unsupported') return false;
    if (f.status === 'D') return false;
    return kind !== 'other';
  });
  const facts: ManifestFact[] = [];
  for (const file of wanted) {
    const kind = manifestKind(file.old_path ?? file.path);
    const headKind = manifestKind(file.path);
    if (headKind === 'unsupported' && file.status !== 'D') {
      facts.push({
        path: file.path,
        ...(file.path_b64 ? { path_b64: file.path_b64 } : {}),
        added: [],
        removed: [],
        unverifiable: true,
        unverifiable_detail: unsupportedDetail(file.path),
      });
      continue;
    }
    if (headKind === 'lockfile' || headKind === 'other') continue;
    const oldKind = file.old_path ? manifestKind(file.old_path) : kind;
    void oldKind;
    try {
      const headText = showPath(gateway, file, 'head');
      const baseText = file.status === 'A' ? null : showPath(gateway, file, 'base');
      if (headText === null) {
        failures.push({ stage: 'manifest', code: 'read_failed', subjects: [file.path] });
        facts.push({ path: file.path, added: [], removed: [], unverifiable: true, unverifiable_detail: 'manifest blob could not be read' });
        continue;
      }
      const parsed: ManifestParse = parseManifest(headKind, baseText, headText);
      const fact: ManifestFact = {
        path: file.path,
        added: parsed.added,
        removed: parsed.removed,
        unverifiable: parsed.unverifiable !== null,
      };
      if (file.path_b64) fact.path_b64 = file.path_b64;
      if (parsed.unverifiable) fact.unverifiable_detail = parsed.unverifiable;
      facts.push(fact);
    } catch (err) {
      if (err instanceof GateError && (err.code === 'git_failed' || err.code === 'spawn_timeout')) {
        failures.push({ stage: 'manifest', code: err.code, subjects: [file.path] });
        facts.push({ path: file.path, added: [], removed: [], unverifiable: true, unverifiable_detail: 'manifest blob could not be read' });
        continue;
      }
      throw err;
    }
  }
  return facts;
}

function showPath(gateway: Gateway, file: FileFact, side: 'head' | 'base'): string | null {
  const oid = side === 'head' ? file.new_oid : file.old_oid;
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(oid) || /^0+$/.test(oid)) return null;
  const bodies = parseCatFileBatch(gateway.catFileBatch([oid]));
  const body = bodies[0];
  if (!body || body.missing || !body.body) return null;
  return body.body.toString('utf8');
}

function loadApi(
  gateway: Gateway,
  mergeBase: string,
  head: string,
  files: FileFact[],
  failures: Evidence['collection']['failures'],
): ApiFact[] {
  const scan = files.filter(f => !f.binary && !f.submodule && f.api_skipped !== 'too_large' && f.status !== 'D');
  const facts: ApiFact[] = [];
  const chunks: FileFact[][] = [];
  let current: FileFact[] = [];
  let estimate = 0;
  for (const file of scan) {
    const cost = (file.additions + file.deletions) * 80 + 100;
    if (current.length > 0 && estimate + cost > 4_000_000) {
      chunks.push(current);
      current = [];
      estimate = 0;
    }
    current.push(file);
    estimate += cost;
  }
  if (current.length > 0) chunks.push(current);
  const patches = new Map<string, { added: string[]; removed: string[] }>();
  for (const chunk of chunks) {
    if (chunk.length === 0) continue;
    const result = gateway.diffPatch(mergeBase, head, chunk.map(f => f.path));
    if (result.overflow || (result.status !== 0 && result.status !== null)) {
      failures.push({ stage: 'api_patch', code: result.overflow ? 'buffer_overflow' : 'git_failed', subjects: chunk.map(f => f.path) });
      continue;
    }
    for (const [path, body] of parseUnified(result.stdout)) patches.set(path, body);
  }
  for (const file of files) {
    if (file.binary || file.submodule) continue;
    const patch = patches.get(file.path);
    const added = patch ? scanLines(file.path, patch.added, 'added') : [];
    const removed = patch ? scanLines(file.path, patch.removed, 'removed') : [];
    if (added.length === 0 && removed.length === 0 && file.api_skipped !== 'too_large') continue;
    const fact: ApiFact = { path: file.path, added, removed };
    if (file.path_b64) fact.path_b64 = file.path_b64;
    facts.push(fact);
  }
  void parseBatchCheck;
  void parseCatFileBatch;
  void binExecPair;
  return facts;
}

function sleep(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
