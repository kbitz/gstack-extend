import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ENUMS, HEX40_RE, SAFE_ID_RE, isObj, isPosInt, isRelPath, type EnvChecker, type FindingRecord } from './state.ts';

type IdentityInput = { findingClass: unknown; location: unknown; fileLine: number | null };
export type IdentityDowngrade = { line: number | null; finding_id: string | null; rule: string };

const MAX_IDENTITY_FILE_BYTES = 256 * 1024;
const MAX_ANCHOR_BLOB_BYTES = 16 * 1024 * 1024;
const MAX_ANCHOR_ATTEMPT_BYTES = 2 * MAX_ANCHOR_BLOB_BYTES;
const MAX_ANCHOR_ATTEMPT_MS = 5000;
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export function readAnchorBlob(cwd: string, env: NodeJS.ProcessEnv, commit: string, path: string, maxBytes: number, timeoutMs: number): Uint8Array | null {
  const result = spawnSync('git', ['-C', cwd, 'cat-file', 'blob', `${commit}:${path}`], {
    env: { ...env, GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1' },
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: timeoutMs,
    maxBuffer: maxBytes,
  });
  return !result.error && !result.signal && result.status === 0 && result.stdout.length <= maxBytes ? result.stdout : null;
}

const withoutCR = (s: string): string => s.endsWith('\r') ? s.slice(0, -1) : s;

function normalizeAnchor(text: string): string {
  const collapsed = withoutCR(text).replace(/[ \t]+/g, ' ');
  return collapsed.slice(collapsed.startsWith(' ') ? 1 : 0, collapsed.endsWith(' ') ? -1 : undefined);
}

function loadBlob(bytes: Uint8Array | null | undefined): { lines: string[]; counts: Map<string, number> } | null {
  if (!bytes) return null;
  try {
    const lines = utf8.decode(bytes).split('\n').map(normalizeAnchor);
    const counts = new Map<string, number>();
    for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
    return { lines, counts };
  } catch {
    return null;
  }
}

function parseIdentityFile(text: string, requested: ReadonlySet<string>, downgraded: IdentityDowngrade[]): Map<string, IdentityInput> {
  const entries = new Map<string, IdentityInput>();
  const rows = text.split('\n');
  if (rows.at(-1) === '') rows.pop();
  rows.forEach((raw, i) => {
    const tokens = withoutCR(raw).split(' ');
    const [id, findingClass, path, line] = tokens;
    const fileLine = i + 1;
    if (!id || !SAFE_ID_RE.test(id)) {
      downgraded.push({ line: fileLine, finding_id: null, rule: 'malformed-line' });
      return;
    }
    // The file covers the entire pass and is reused for each attempt.
    if (!requested.has(id)) return;
    const prior = entries.get(id);
    if (prior) {
      downgraded.push({ line: fileLine, finding_id: id, rule: 'duplicate-line' });
      prior.location = null;
      if (findingClass !== prior.findingClass) prior.findingClass = null;
      return;
    }
    if ((tokens.length !== 2 && tokens.length !== 4) || tokens.some((token) => token === '')) {
      downgraded.push({ line: fileLine, finding_id: id, rule: 'malformed-line' });
      entries.set(id, { findingClass: findingClass || null, location: null, fileLine });
      return;
    }
    const location = tokens.length === 4 ? { path, line: line && /^\d+$/.test(line) ? Number(line) : NaN } : null;
    entries.set(id, { findingClass, location, fileLine });
  });
  return entries;
}

function directIdentityInput(raw: unknown): IdentityInput {
  return isObj(raw)
    ? { findingClass: raw.finding_class, location: raw.identity, fileLine: null }
    : { findingClass: null, location: null, fileLine: null };
}

function anchorCommitProblem(commit: unknown, env: EnvChecker): string | null {
  if (commit === undefined || commit === null) return 'anchor-commit-missing';
  if (typeof commit !== 'string' || !HEX40_RE.test(commit)) return 'anchor-commit-invalid';
  try {
    return env.commitExists(commit) ? null : 'anchor-commit-invalid';
  } catch {
    return 'anchor-commit-invalid';
  }
}

export function decorateFindings(
  findings: FindingRecord[],
  inputs: unknown[],
  anchorCommit: unknown,
  identityFile: string | null | undefined,
  env: EnvChecker,
  earlierFindings: FindingRecord[],
): IdentityDowngrade[] {
  const downgraded: IdentityDowngrade[] = [];
  let fileEntries: Map<string, IdentityInput> | undefined;
  if (identityFile !== undefined) {
    const file = env.readAdvisoryFile?.(identityFile, MAX_IDENTITY_FILE_BYTES);
    if (!file) return findings.map(({ finding_id }) => ({ line: null, finding_id, rule: 'identity-file-unusable' }));
    fileEntries = parseIdentityFile(file.text, new Set(findings.map((f) => f.finding_id)), downgraded);
  }

  const earlierKeys = new Map<string, string>();
  for (const f of earlierFindings) if (f.identity && !earlierKeys.has(f.finding_id)) earlierKeys.set(f.finding_id, f.identity.key);

  const blobs = new Map<string, ReturnType<typeof loadBlob>>();
  const attemptKeys = new Set<string>();
  const deadline = performance.now() + MAX_ANCHOR_ATTEMPT_MS;
  let remainingBytes = MAX_ANCHOR_ATTEMPT_BYTES;
  let commitProblem: string | null | undefined;
  findings.forEach((finding, index) => {
    const input = fileEntries ? fileEntries.get(finding.finding_id) : directIdentityInput(inputs[index]);
    const downgrade = (rule: string) => { downgraded.push({ line: input?.fileLine ?? null, finding_id: finding.finding_id, rule }); };
    if (!input) return downgrade('missing-class');
    const location = input.location;
    const findingClass = ENUMS.findingClass.find((value) => value === input.findingClass);
    if (!findingClass) {
      if (input.findingClass != null) return downgrade('invalid-finding-class');
      if (location != null) return downgrade('missing-class');
      return;
    }
    finding.finding_class = findingClass;
    if (location == null) return;
    if (!isObj(location) || Object.keys(location).some((key) => key !== 'path' && key !== 'line')) return downgrade('malformed-identity');
    const path = typeof location.path === 'string' ? location.path.replace(/^\.\//, '') : null;
    if (!isRelPath(path) || /\s/.test(path)) return downgrade('invalid-path');
    if (!isPosInt(location.line)) return downgrade('invalid-line');
    if (commitProblem === undefined) commitProblem = anchorCommitProblem(anchorCommit, env);
    if (commitProblem !== null) return downgrade(commitProblem);

    if (!blobs.has(path)) {
      const timeoutMs = Math.floor(deadline - performance.now());
      if (timeoutMs <= 0 || remainingBytes === 0) return downgrade('anchor-budget-exhausted');
      const maxBytes = Math.min(MAX_ANCHOR_BLOB_BYTES, remainingBytes);
      const bytes = env.readAnchorBlob?.(anchorCommit as string, path, maxBytes, timeoutMs);
      if (bytes) remainingBytes -= bytes.byteLength;
      blobs.set(path, loadBlob(bytes));
    }
    const blob = blobs.get(path);
    const anchor = blob?.lines[location.line - 1];
    if (anchor === undefined) return downgrade('anchor-unavailable');
    if (!anchor) return downgrade('anchor-empty');
    if (blob!.counts.get(anchor) !== 1) return downgrade('anchor-non-unique');
    const key = `fk1:${createHash('sha256').update(['fk1', path, anchor, findingClass].join('\0')).digest('hex').slice(0, 16)}`;
    const earlierKey = earlierKeys.get(finding.finding_id);
    if (earlierKey !== undefined && earlierKey !== key) return downgrade('same-identity-within-cycle');
    if (attemptKeys.has(key)) return downgrade('same-key-within-attempt');
    attemptKeys.add(key);
    finding.identity = { key, path };
  });
  return downgraded;
}
