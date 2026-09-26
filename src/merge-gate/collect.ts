import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { hasApiRule, scanHunks } from './api.ts';
import { canonicalJson } from './canon.ts';
import { parseBatchCheck, parseCatFileBatch, parseRawNumstat, parseUnified, type FileFact, type PatchFile } from './diff.ts';
import { manifestKind, parseManifest, unsupportedDetail, type ManifestKind, type ManifestParse } from './deps.ts';
import type { ApiFact, Evidence, ManifestFact } from './decide.ts';
import { GateError } from './errors.ts';
import { createGateway, parseGitVersion, versionAtLeast, type Gateway } from './exec.ts';
import {
  API_BLOB_LIMIT,
  API_LINE_LIMIT,
  COLLECTOR_VERSION,
  EMPTY_TREE,
  GIT_FLOOR,
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

type Failures = Evidence['collection']['failures'];

/** API patch chunk bounds: estimated output bytes, pathspec count, and pathspec bytes. */
const CHUNK = { output: 4_000_000, paths: 1000, argvBytes: 256 * 1024 };

let version: string | null = null;

export function installVersion(): string {
  if (version !== null) return version;
  try {
    const root = dirname(dirname(import.meta.dir));
    version = readFileSync(join(root, 'VERSION'), 'utf8').trim() || 'unknown';
  } catch {
    version = 'unknown';
  }
  return version;
}

export function collect(input: CollectInput): { evidence: Evidence; canonical: string } {
  const started = input.now();
  const gatewayAt = (cwd: string, safeDirectories: string[] = []) => createGateway({
    cwd,
    parentEnv: input.env,
    gitTimeoutMs: input.gitTimeoutMs,
    ghTimeoutMs: input.ghTimeoutMs,
    debug: input.debug,
    safeDirectories,
  });
  const gateway = gatewayAt(input.cwd);
  // `git version` runs before any call that passes --attr-source, which older git rejects.
  const versionText = gateway.version();
  requireGit(versionText, false);
  const safe = gateway.safeDirectories();
  const toplevel = gatewayAt(input.cwd, safe).toplevel();
  const rooted = gatewayAt(toplevel, safe);
  const partial = isPartialClone(rooted.partialCloneConfig());
  if (partial) requireGit(versionText, true);

  const failures: Failures = [];
  const attributes = infoAttributes(rooted, toplevel);
  if (attributes !== null) failures.push({ stage: 'attributes', code: 'info_attributes', subjects: [attributes] });

  const originUrl = rooted.remoteUrl(input.remote);
  const origin = originUrl ? stripRemoteUrl(originUrl) : null;
  const target = input.mode === 'pr'
    ? prTarget(rooted, input, originUrl)
    : { base: resolveRef(rooted, input.baseRef ?? '', input.remote), head: resolveRef(rooted, input.headRef ?? 'HEAD', input.remote), pr: null, observedAt: null };

  const mergeBase = rooted.mergeBase(target.base, target.head);
  if (!mergeBase) {
    throw new GateError(
      'no_merge_base',
      'the base and head commits have no merge base',
      rooted.isShallow() ? 'git fetch --unshallow' : 'fetch the missing history so the commits share an ancestor',
    );
  }

  const build = (files: FileFact[], manifests: ManifestFact[], api: ApiFact[], renameSkipped: boolean) => {
    const evidence: Evidence = {
      v: 1,
      observed_at: (target.observedAt ?? input.now()).toISOString(),
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
      git: { base_sha: target.base, head_sha: target.head, merge_base_sha: mergeBase, files },
      dependencies: { manifests },
      public_api: { files: api },
      collection: { complete: failures.length === 0, failures },
      pr: target.pr,
    };
    return { evidence, canonical: canonicalJson(evidence) };
  };

  const diff = rooted.diffRaw(mergeBase, target.head);
  if (diff.overflow) {
    failures.push({ stage: 'diff', code: 'buffer_overflow', subjects: [] });
    return build([], [], [], false);
  }
  if (diff.status !== 0) {
    throw new GateError('git_failed', firstLine(diff.stderr) || 'git diff failed', 'confirm the commits exist locally and retry');
  }
  const parsedDiff = parseRawNumstat(diff.stdout);
  if (parsedDiff.badStatus.length > 0) {
    failures.push({ stage: 'diff', code: 'bad_status', subjects: parsedDiff.badStatus });
  }
  const files = parsedDiff.files;
  markLarge(rooted, files, failures);
  const manifests = loadManifests(rooted, files, failures);
  const api = loadApi(rooted, mergeBase, target.head, files, failures);
  return build(files, manifests, api, diff.stderr.includes('inexact rename detection was skipped'));
}

function requireGit(versionText: string, partial: boolean): void {
  const floor = partial ? GIT_FLOOR.partial : GIT_FLOOR.full;
  const need = `${floor.major}.${floor.minor}`;
  const parsed = parseGitVersion(versionText);
  if (!parsed) {
    throw new GateError('git_unsupported_version', `could not parse git version: ${versionText.trim()}`, `install git ${need} or newer`);
  }
  if (!versionAtLeast(versionText, floor)) {
    throw new GateError(
      'git_unsupported_version',
      `git ${parsed.major}.${parsed.minor} is below ${need}${partial ? ' (partial clone)' : ''}`,
      `install git ${need} or newer`,
    );
  }
}

/**
 * `key value` lines from `config --get-regexp`. A key with no value is a
 * boolean true; any value other than an explicit false marks a partial clone.
 */
function isPartialClone(config: string): boolean {
  return config.split('\n').some(line => {
    if (line.trim() === '') return false;
    const space = line.indexOf(' ');
    if (space < 0) return true;
    const value = line.slice(space + 1).trim().toLowerCase();
    return value !== '' && !['false', 'no', 'off', '0'].includes(value);
  });
}

/**
 * git has no switch that ignores `$GIT_DIR/info/attributes`, so a file with
 * any effective line is recorded as a collection failure.
 */
function infoAttributes(gateway: Gateway, toplevel: string): string | null {
  const subject = '.git/info/attributes';
  const rel = gateway.gitPath('info/attributes');
  const path = isAbsolute(rel) ? rel : join(toplevel, rel);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? null : subject;
  }
  const effective = text.split('\n').some(line => {
    const t = line.trim();
    return t !== '' && !t.startsWith('#');
  });
  return effective ? subject : null;
}

function prTarget(
  gateway: Gateway,
  input: CollectInput,
  originUrl: string | null,
): { base: string; head: string; pr: Evidence['pr']; observedAt: Date } {
  const remoteId = originUrl ? parseRemote(originUrl) : null;
  if (!remoteId) {
    throw new GateError(
      'no_remote',
      originUrl ? `remote '${input.remote}' is not a host/owner/repo URL` : `remote '${input.remote}' has no URL`,
      `add a remote named ${input.remote}, or pass --remote with the base repository`,
    );
  }
  const spec = input.prUrl ? repoSpecFromUrl(input.prUrl) : repoSpecFromRemote(remoteId);
  const number = input.prUrl?.number ?? input.prNumber ?? '';
  const first = ghView(gateway, number, spec);
  let raw = first;
  let rawFirst: Record<string, unknown> | null = null;
  let retryWait: number | null = null;
  if (raw.state === 'OPEN' && raw.mergeable === 'UNKNOWN') {
    sleep(input.retryMs);
    retryWait = input.retryMs;
    rawFirst = first;
    raw = ghView(gateway, number, spec);
  }
  // PR signals were observed when the final response completed, before local
  // object checks and diff work can move the clock past the merge event.
  const observedAt = input.now();
  const prId = parsePrUrl(String(raw.url));
  if (!prId || !identityMatches(remoteId, prId)) {
    const want = prId ? `${prId.owner}/${prId.name}` : 'the pull request repository';
    throw new GateError(
      'repo_mismatch',
      `remote ${input.remote} does not match ${want}`,
      `run from a clone whose ${input.remote} is ${want}`,
    );
  }
  const head = String(raw.headRefOid);
  const base = String(raw.baseRefOid);
  const missingHead = !gateway.verifyCommit(head);
  const missingBase = !gateway.verifyCommit(base);
  if (missingHead || missingBase) {
    const refs: string[] = [];
    if (missingHead) refs.push(`pull/${number}/head`);
    if (missingBase && typeof raw.baseRefName === 'string' && raw.baseRefName !== '') refs.push(raw.baseRefName);
    const which = [missingHead ? 'head' : '', missingBase ? 'base' : ''].filter(Boolean).join(' and ');
    throw new GateError(
      'commit_not_local',
      `missing local commit for the pull request ${which}`,
      `git fetch ${[input.remote, ...refs].map(shellWord).join(' ')}`,
    );
  }
  return {
    base,
    head,
    observedAt,
    pr: {
      number: Number(raw.number),
      url: String(raw.url),
      repo: { host: prId.host, owner: prId.owner, name: prId.name },
      raw,
      raw_first: rawFirst,
      retry_wait_ms: retryWait,
    },
  };
}

/** Quote a word for a copy-paste fix line; ref names may hold shell metacharacters. */
function shellWord(word: string): string {
  return /^[A-Za-z0-9._/:@%+=-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

function resolveRef(gateway: Gateway, ref: string, remote: string): string {
  const sha = gateway.verifyCommit(ref);
  if (sha) return sha;
  const alt = gateway.verifyCommit(`${remote}/${ref}`);
  const hint = alt ? `try ${remote}/${ref}` : 'pass a commit, branch, or tag that exists locally';
  throw new GateError('ref_not_found', `ref '${ref}' is not a commit`, hint);
}

function ghView(gateway: Gateway, number: string, spec: string): Record<string, unknown> {
  const result = gateway.ghPrView(number, spec);
  if (result.status === 4) {
    const parts = spec.split('/');
    const host = parts.length === 3 ? parts[0] : 'github.com';
    throw new GateError('gh_auth', firstLine(result.stderr) || 'gh is not authenticated', `gh auth status -h ${host}; gh auth login -h ${host}`);
  }
  if (result.status !== 0) {
    const multi = /multiple remotes|no default repository|no git remotes/i.test(result.stderr);
    throw new GateError(
      'gh_failed',
      redact(firstLine(result.stderr) || 'gh pr view failed'),
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
  const typed = typeof raw.state === 'string' && typeof raw.url === 'string' && typeof raw.number === 'number' &&
    typeof raw.headRefOid === 'string' && typeof raw.baseRefOid === 'string';
  if (!typed) {
    throw new GateError('gh_bad_json', 'gh response is missing or mistypes state, url, number, headRefOid, or baseRefOid', 'upgrade gh and retry');
  }
  return raw;
}

function hasRule(file: FileFact): boolean {
  return hasApiRule(file.path) || (file.old_path !== null && hasApiRule(file.old_path));
}

/** Mark API-scannable files whose line count or either blob exceeds the scan limits. */
function markLarge(gateway: Gateway, files: FileFact[], failures: Failures): void {
  const candidates = files.filter(f => !f.binary && !f.submodule && hasRule(f));
  const oids = new Set<string>();
  for (const file of candidates) {
    if (file.additions + file.deletions > API_LINE_LIMIT) {
      file.api_skipped = 'too_large';
      continue;
    }
    for (const oid of [file.old_oid, file.new_oid]) if (isBlobOid(oid)) oids.add(oid);
  }
  if (oids.size === 0) return;
  let sizes: Map<string, number | null>;
  try {
    sizes = parseBatchCheck(gateway.catFileBatchCheck([...oids]));
  } catch (err) {
    if (!isDegradable(err)) throw err;
    failures.push({ stage: 'api_size', code: err.code, subjects: candidates.map(f => f.path) });
    return;
  }
  for (const file of candidates) {
    if (file.api_skipped) continue;
    if ([file.old_oid, file.new_oid].some(oid => (sizes.get(oid) ?? 0) > API_BLOB_LIMIT)) file.api_skipped = 'too_large';
  }
}

function isDegradable(err: unknown): err is GateError {
  return err instanceof GateError && (err.code === 'git_failed' || err.code === 'spawn_timeout');
}

type ManifestRead = { file: FileFact; kind: ManifestKind; baseOid: string | null };

function loadManifests(gateway: Gateway, files: FileFact[], failures: Failures): ManifestFact[] {
  const rows: (ManifestFact | ManifestRead)[] = [];
  for (const file of files) {
    // A deleted manifest of any kind never makes the change deps_unverifiable (ENG-6).
    if (file.status === 'D' || file.submodule) continue;
    const kind = manifestKind(file.path);
    if (kind === 'lockfile' || kind === 'other') continue;
    if (kind === 'unsupported') {
      rows.push(unreadManifest(file, unsupportedDetail(file.path)));
      continue;
    }
    // A rename from another manifest kind, or from a non-manifest, is a new manifest.
    const sameKind = file.status !== 'A' && manifestKind(file.old_path ?? file.path) === kind;
    rows.push({ file, kind, baseOid: sameKind ? file.old_oid : null });
  }
  const reads = rows.filter((r): r is ManifestRead => 'kind' in r);
  if (reads.length === 0) return rows as ManifestFact[];
  const oids = [...new Set(reads.flatMap(r => [r.file.new_oid, r.baseOid ?? '']).filter(isBlobOid))];
  const blobs = new Map<string, string>();
  try {
    for (const blob of parseCatFileBatch(gateway.catFileBatch(oids))) {
      if (!blob.missing && blob.body) blobs.set(blob.oid, blob.body.toString('utf8'));
    }
  } catch (err) {
    if (!isDegradable(err)) throw err;
    failures.push({ stage: 'manifest', code: err.code, subjects: reads.map(r => r.file.path) });
    return rows.map(r => ('kind' in r ? unreadManifest(r.file, 'manifest blob could not be read') : r));
  }
  return rows.map(row => {
    if (!('kind' in row)) return row;
    const head = blobs.get(row.file.new_oid);
    const base = row.baseOid === null ? null : blobs.get(row.baseOid);
    if (head === undefined || base === undefined) {
      failures.push({ stage: 'manifest', code: 'read_failed', subjects: [row.file.path] });
      return unreadManifest(row.file, 'manifest blob could not be read');
    }
    const parsed: ManifestParse = parseManifest(row.kind, base, head);
    const fact: ManifestFact = {
      path: row.file.path,
      added: parsed.added,
      removed: parsed.removed,
      unverifiable: parsed.unverifiable !== null,
    };
    if (row.file.path_b64) fact.path_b64 = row.file.path_b64;
    if (parsed.unverifiable) fact.unverifiable_detail = parsed.unverifiable;
    return fact;
  });
}

function unreadManifest(file: FileFact, detail: string): ManifestFact {
  const fact: ManifestFact = { path: file.path, added: [], removed: [], unverifiable: true, unverifiable_detail: detail };
  if (file.path_b64) fact.path_b64 = file.path_b64;
  return fact;
}

function isBlobOid(oid: string): boolean {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(oid) && !/^0+$/.test(oid);
}

/**
 * Scan patches of files with an API rule, deleted files included, so moves
 * cancel. A rename's old path goes in the same chunk as its new path so git
 * pairs them the way the raw diff did.
 */
function loadApi(gateway: Gateway, mergeBase: string, head: string, files: FileFact[], failures: Failures): ApiFact[] {
  const ready: FileFact[] = [];
  for (const file of files) {
    if (file.binary || file.submodule || !hasRule(file) || file.api_skipped) continue;
    // A lossy-decoded name cannot be passed back to git as a pathspec.
    if (file.path_b64 || file.old_path_b64) file.api_skipped = 'non_utf8_path';
    else ready.push(file);
  }
  const patches = new Map<string, PatchFile>();
  for (const chunk of chunkFiles(ready)) {
    let code: string | null = null;
    let stdout: Buffer = Buffer.alloc(0);
    try {
      const result = gateway.diffPatch(mergeBase, head, chunk.flatMap(pathspecs));
      if (result.overflow) code = 'buffer_overflow';
      else if (result.status !== 0) code = 'git_failed';
      else stdout = result.stdout;
    } catch (err) {
      if (!isDegradable(err)) throw err;
      code = err.code;
    }
    if (code !== null) {
      failures.push({ stage: 'api_patch', code, subjects: chunk.map(f => f.path) });
      for (const file of chunk) file.api_skipped = 'patch_failed';
      continue;
    }
    for (const [path, body] of parseUnified(stdout)) patches.set(path, body);
  }
  const facts: ApiFact[] = [];
  for (const file of ready) {
    if (file.api_skipped) continue;
    const patch = patches.get(file.path);
    if (!patch) {
      if (file.additions + file.deletions > 0) file.api_skipped = 'patch_missing';
      continue;
    }
    const added = scanHunks(file.path, patch.hunks.map(h => ({ context: h.context, lines: h.added })));
    const removed = scanHunks(file.path, patch.hunks.map(h => ({ context: h.context, lines: h.removed })), file.old_path ?? file.path);
    if (added.length === 0 && removed.length === 0) continue;
    const fact: ApiFact = { path: file.path, added, removed };
    if (file.path_b64) fact.path_b64 = file.path_b64;
    facts.push(fact);
  }
  return facts;
}

function pathspecs(file: FileFact): string[] {
  return file.old_path !== null && file.old_path !== file.path ? [file.old_path, file.path] : [file.path];
}

function chunkFiles(files: FileFact[]): FileFact[][] {
  const chunks: FileFact[][] = [];
  let current: FileFact[] = [];
  let output = 0;
  let count = 0;
  let bytes = 0;
  for (const file of files) {
    const specs = pathspecs(file);
    const cost = (file.additions + file.deletions) * 80 + 100;
    const size = specs.reduce((n, p) => n + Buffer.byteLength(p) + 1, 0);
    const full = output + cost > CHUNK.output || count + specs.length > CHUNK.paths || bytes + size > CHUNK.argvBytes;
    if (current.length > 0 && full) {
      chunks.push(current);
      current = [];
      output = 0;
      count = 0;
      bytes = 0;
    }
    current.push(file);
    output += cost;
    count += specs.length;
    bytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function sleep(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
