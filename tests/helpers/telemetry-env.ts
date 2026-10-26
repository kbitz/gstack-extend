/**
 * Isolated telemetry fixtures: HOME is always temporary and no inherited state
 * overrides reach the child. The real logger/config are copied without the
 * network sync helper; stub mode exercises CI without an installed gstack.
 *
 * Track 31A real-store guard. The first makeTelemetryFixture() after module load (or after the previous comparison)
 * takes a read-only snapshot of the runner's real stores; cleanupTelemetryFixtures() harvests the fixtures' session
 * IDs, compares, clears the snapshot and removes the fixture homes in a `finally`. A failure throws, so the suite's
 * afterAll fails the bun run. Every failure line starts `REAL-STORE-GUARD:<code>` (codes: prefix-rewrite,
 * appended-id, named-file, escaped-root, unexpected; docs/telemetry.md#workflow-metrics-guard-<code>) and each
 * comparison ends with one `REAL-STORE-GUARD: verified|unverified|failed (<files> files, <ms> ms)` line.
 * GSTACK_EXTEND_STORE_GUARD=strict makes `unverified` fail; there is no off switch.
 *
 * Manual smoke (read-only on the real stores; the snapshot file holds paths, sizes and hashes only):
 *   bun tests/helpers/telemetry-env.ts --snapshot <file>
 *   bun tests/helpers/telemetry-env.ts --compare <file> [--ids <file>] [--harvest <dir>]...
 * `--ids` lists session IDs (any text containing `extend-<uuid>` tokens works) and `--harvest` scans an isolated
 * state directory (the smoke's own handoff, stage-runs and workflow-metrics additions) for them. With neither, the
 * compare still checks prefix rewrites and escaped roots. Exit 0 verified/unverified, 1 failed, 2 usage.
 */
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, symlinkSync, chmodSync, copyFileSync, rmSync, lstatSync, readdirSync, openSync, closeSync, fstatSync, readSync, realpathSync, constants as fsConstants } from 'node:fs';
import type { Dirent, Stats } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { basename, isAbsolute, join, sep } from 'node:path';
import { beforeAll } from 'bun:test';

const ROOT = join(import.meta.dir, '..', '..');
// Fixture homes are removed by cleanupTelemetryFixtures(), which every telemetry test file registers with afterAll
// (process 'exit' handlers never fire under `bun test`). Each home holds a link into the real repo's bin/; rmSync
// unlinks a symlink without following it.
const fixtureHomes: string[] = [];
export function cleanupTelemetryFixtures() {
  const homes = fixtureHomes.splice(0);
  const snapshot = activeSnapshot;
  activeSnapshot = null;
  let compared = false;
  try {
    if (snapshot) {
      let result: GuardResult;
      try {
        result = assertRealStoresUntouched(snapshot, harvestSessionIds(homes), { suite: snapshot.suite });
      } catch (error) {
        const failure = error instanceof RealStoreGuardError ? error : new RealStoreGuardError(unexpectedResult(error, snapshot).lines);
        // bun prefixes a thrown message with the error name, so print each line clean first, then fail the hook.
        for (const line of failure.lines) console.error(line);
        throw new RealStoreGuardError([failure.lines[failure.lines.length - 1]!]);
      }
      compared = true;
      for (const line of result.lines) (line.startsWith(`${GUARD}: warning`) ? console.warn : console.log)(line);
    }
  } finally {
    for (const home of homes) {
      try {
        rmSync(home, { recursive: true, force: true });
      } catch {
        // Best effort: a test may have left a directory unwritable.
      }
    }
  }
  // Re-arm outside any test body so the next suite's first fixture does not pay the snapshot inside its own timeout.
  if (compared) armSnapshot(null);
}
// What the skill blocks and the doctor require of a wrapper, and what the wrapper requires of a logger. Fixture
// scripts that stand in for either must carry these lines, or they are (correctly) treated as stale/old.
export const PROTOCOL_LINE = '# telemetry-protocol: start-finish-v1\n';
export const NO_SWEEP_LINE = '# --no-sweep\n';
export const HELPER_BIN = join(ROOT, 'bin', 'gstack-extend-telemetry');
export const REAL_GSTACK_ROOT = join(process.env.HOME ?? '', '.claude', 'skills', 'gstack');
export const REAL_GSTACK_BIN = join(REAL_GSTACK_ROOT, 'bin');
export type TelemetryTier = 'off' | 'anonymous' | 'community';
export type FixtureMode = 'real' | 'stub' | 'absent';
export type TelemetryFixture = {
  home: string;
  env: Record<string, string>;
  readJsonl: () => Array<Record<string, any>>;
  /** Local-only provenance rows (stage-runs.jsonl under the gstack-extend state directory). */
  readLedger: () => Array<Record<string, any>>;
  readStubArgs: () => string[];
};

export function makeTelemetryFixture(tier: TelemetryTier, mode: FixtureMode = 'stub'): TelemetryFixture {
  ensureSnapshot();
  const home = mkdtempSync(join(tmpdir(), 'gx-tel-'));
  fixtureHomes.push(home);
  const processBin = join(home, 'process-fixtures');
  mkdirSync(processBin);
  // A fixture's simulated harness markers must not discover the test runner's
  // real parent harness. Dedicated ancestry cases inject their process table.
  writeFileSync(join(processBin, 'ps'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(processBin, 'ps'), 0o755);
  mkdirSync(join(home, '.gstack'), { recursive: true });
  writeFileSync(join(home, '.gstack', 'config.yaml'), `telemetry: ${tier}\n`);
  const upstream = join(home, '.claude/skills/gstack');
  const upstreamBin = join(upstream, 'bin');
  if (mode !== 'absent') {
    mkdirSync(upstreamBin, { recursive: true });
    mkdirSync(join(home, '.claude/skills/gstack-extend'), { recursive: true });
    symlinkSync(join(ROOT, 'bin'), join(home, '.claude/skills/gstack-extend/bin'));
  }
  if (mode === 'real') {
    for (const name of ['gstack-config', 'gstack-telemetry-log']) {
      copyFileSync(join(REAL_GSTACK_BIN, name), join(upstreamBin, name));
      chmodSync(join(upstreamBin, name), 0o755);
    }
    // New upstream scripts source this shared resolver; older releases have no such file.
    // Copy only their local dependency, never the sync helper that could upload fixture rows.
    const stateResolver = join(REAL_GSTACK_BIN, 'gstack-state-root.sh');
    if (existsSync(stateResolver)) copyFileSync(stateResolver, join(upstreamBin, 'gstack-state-root.sh'));
    copyFileSync(join(REAL_GSTACK_ROOT, 'VERSION'), join(upstream, 'VERSION'));
  } else if (mode === 'stub') {
    const config = `#!/usr/bin/env python3
import os
from pathlib import Path
p = Path(os.environ.get('GSTACK_STATE_ROOT') or os.environ.get('GSTACK_HOME') or os.environ.get('GSTACK_STATE_DIR') or Path.home() / '.gstack') / 'config.yaml'
try:
    for line in p.read_text().splitlines():
        if line.startswith('telemetry:'):
            print(line.split(':', 1)[1].strip())
            break
except OSError:
    pass
`;
    const logger = `#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
from datetime import datetime, timezone
args = sys.argv[1:]
with (Path.home() / 'captured-args.txt').open('a') as f:
    f.write('\\t'.join(args) + '\\n')
values = {}
while args:
    key = args.pop(0)
    values[key] = True if key == '--no-sweep' else args.pop(0)
sink = Path(os.environ.get('GSTACK_STATE_DIR') or Path.home() / '.gstack') / 'analytics'
sink.mkdir(parents=True, exist_ok=True)
rows = []
# Deliberately simulate the destructive upstream behavior if the guard is lost.
if not values.get('--no-sweep'):
    for marker in sink.glob('.pending-*'):
        rows.append(dict(v=1, event_type='skill_run', skill='qa', outcome='unknown'))
        marker.unlink()
duration = int(values.get('--duration', '0'))
rows.append(dict(v=1, event_type='skill_run', ts=datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                 skill=values.get('--skill'), source=values.get('--source'),
                 session_id=values.get('--session-id'), duration_s=duration if duration <= 86400 else None,
                 outcome=values.get('--outcome', 'unknown')))
with (sink / 'skill-usage.jsonl').open('a') as f:
    for row in rows:
        f.write(json.dumps(row) + '\\n')
`;
    for (const [name, text] of [['gstack-config', config], ['gstack-telemetry-log', logger]]) {
      writeFileSync(join(upstreamBin, name), text);
      chmodSync(join(upstreamBin, name), 0o755);
    }
  }
  const readRows = (file: string) =>
    existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  return {
    home,
    env: { HOME: home, PATH: processBin + ':/usr/bin:/bin' },
    readJsonl: () => readRows(join(home, '.gstack/analytics/skill-usage.jsonl')),
    readLedger: () => readRows(join(home, '.gstack-extend/analytics/stage-runs.jsonl')),
    readStubArgs: () => {
      const file = join(home, 'captured-args.txt');
      return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean) : [];
    },
  };
}

// ───────────────────────────── Track 31A real-store guard ─────────────────────────────
// Core functions take explicit store specs so the self-tests can aim them at a stand-in store; the default wiring
// (realStoreSpecs) covers the runner's real HOME and every inherited state root.
//
// Upstream rotation finding (installed gstack 1.91.216.0): every writer of analytics/skill-usage.jsonl appends
// (gstack-telemetry-log, gstack-skill-start, gstack-skill-end, gstack-codex-probe and the careful hook use `>>`;
// browse/src/telemetry.ts uses appendFile) and gstack-telemetry-sync only reads it, tracking a line cursor in a
// separate file. No installed code rotates or truncates it. Another upstream version or a person still can, so a
// shrink or rewrite of an upstream ledger reads `unverified` rather than failing; gstack-extend's own ledgers
// (stage-runs.jsonl, analytics/workflow-metrics/*.jsonl) are append-only and fail as `prefix-rewrite`.

const GUARD = 'REAL-STORE-GUARD';
export type GuardCode = 'prefix-rewrite' | 'appended-id' | 'named-file' | 'escaped-root' | 'unexpected';
export type StoreKind = 'extend' | 'upstream';
export type StoreSpec = { label: string; root: string; kind: StoreKind };
type LedgerState = { size: number; sha256: string };
type StoreSnap = {
  spec: StoreSpec;
  state: 'present' | 'absent' | 'unreadable';
  ledgers: Record<string, LedgerState>;
  /** Stat keys of every file under telemetry/ and telemetry-completed/, to find new or changed handoffs and markers. */
  tree: Record<string, string>;
};
type Unverified = { store: string; path: string; cause: string; fix: string };
export type RealStoreSnapshot = {
  v: 1;
  takenAt: number;
  suite: string | null;
  home: string;
  inheritedVars: string[];
  stores: StoreSnap[];
  /** SHA-256 of each session-id token already present in the stores, so the file holds hashes only. */
  tokens: string[];
  unverified: Unverified[];
  files: number;
  ms: number;
  error: string | null;
};
export type GuardFinding = { code: GuardCode; store: string; path: string; size: number | null; detail: string; ids: string[]; fix?: string; recovery?: string };
export type GuardResult = { status: 'verified' | 'unverified' | 'failed'; findings: GuardFinding[]; unverified: Unverified[]; files: number; ms: number; lines: string[] };
export type GuardOpts = {
  suite?: string | null;
  /** Home used for `~/` labels; '' disables the substitution (stand-in stores). Defaults to the snapshot's. */
  home?: string;
  strict?: boolean;
  /** Extra temp directories whose `gx-tel-` children count as fixture roots (the runner's own is always included). */
  tempRoots?: string[];
  /** Test seam: runs after a file is stat'd and before it is read, to model a concurrent append. */
  hooks?: { afterStat?: (abs: string, phase: 'snapshot' | 'compare') => void };
};
export class RealStoreGuardError extends Error {
  constructor(readonly lines: string[]) {
    super(lines.join('\n'));
    this.name = 'RealStoreGuardError';
  }
}

const REAL_HOME = process.env.HOME || homedir();
const STORE_ENV: Array<[string, StoreKind]> = [
  ['GSTACK_EXTEND_STATE_DIR', 'extend'], ['GSTACK_STATE_ROOT', 'upstream'], ['GSTACK_STATE_DIR', 'upstream'],
  ['GSTACK_HOME', 'upstream'], ['CLAUDE_PLUGIN_DATA', 'upstream'], ['CLAUDE_PLUGIN_ROOT', 'upstream'],
];
const OTHER_RESOLVER_VARS = ['GSTACK_DIR', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'GROK_HOME'];
const TREES = ['analytics', 'telemetry', 'telemetry-completed', 'telemetry-locks', 'workflow-metrics-locks'];
const ID_RE = /extend-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const CARRY = 512; // longer than any needle, so a token or path split across two chunks is still seen
const CHUNK = 1 << 20;
const MAX_LISTED = 20;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const errCode = (error: unknown) => (error as NodeJS.ErrnoException)?.code ?? (error instanceof Error ? error.name : 'ERR');

// A trailing slash or '/.' makes lstat follow the final link. Remove only these suffixes,
// preserving '/' and every other component (including '..') without resolving any link.
const rootEntryPath = (root: string) => root.replace(/(?:\/\.?)+$/, '') || '/';

/** The stores the guard watches for this runner: its real HOME, then every inherited state root (absolute only). */
export function realStoreSpecs(env: NodeJS.ProcessEnv = process.env, home: string = REAL_HOME): StoreSpec[] {
  const specs: StoreSpec[] = [];
  const seen = new Set<string>();
  const add = (label: string, root: string, kind: StoreKind) => {
    if (!root || !isAbsolute(root)) return; // the launcher ignores a relative override too
    let key = root;
    try {
      if (!lstatSync(rootEntryPath(root)).isSymbolicLink()) key = realpathSync(root);
    } catch {
      // A missing store is still watched (it can appear); key by the given path.
    }
    if (seen.has(key)) return;
    seen.add(key);
    specs.push({ label, root, kind });
  };
  if (home) {
    add('~/.gstack-extend', join(home, '.gstack-extend'), 'extend');
    add('~/.gstack', join(home, '.gstack'), 'upstream');
  }
  for (const [name, kind] of STORE_ENV) add(`$${name}`, env[name] ?? '', kind);
  return specs;
}

/** Names (never values) of the state-resolver variables set in the runner's environment. */
function inheritedVarNames(env: NodeJS.ProcessEnv = process.env): string[] {
  return [...STORE_ENV.map(([name]) => name), ...OTHER_RESOLVER_VARS].filter(name => (env[name] ?? '') !== '');
}

function displayPath(spec: StoreSpec, rel: string, home: string): string {
  const full = rel ? `${spec.root}/${rel}` : spec.root;
  if (home && (full === home || full.startsWith(home + sep))) return '~' + full.slice(home.length);
  return rel ? `${spec.label}/${rel}` : spec.label;
}

type FileEntry = { rel: string; abs: string; size: number; key: string };
type Walked = { files: FileEntry[]; symlinks: string[]; errors: Array<{ rel: string; code: string }> };
const statKey = (s: Stats) => `${s.size}:${s.mtimeMs}:${s.ctimeMs}:${s.ino}`;

function walkDir(walkRoot: string, rel: string, out: Walked) {
  let entries: Dirent[];
  try {
    entries = readdirSync(join(walkRoot, rel), { withFileTypes: true });
  } catch (error) {
    if (errCode(error) !== 'ENOENT') out.errors.push({ rel, code: errCode(error) });
    return;
  }
  for (const entry of entries) {
    const childRel = `${rel}/${entry.name}`;
    if (entry.isSymbolicLink()) out.symlinks.push(childRel); // follow no symlink: skip and report by path
    else if (entry.isDirectory()) walkDir(walkRoot, childRel, out);
    else if (entry.isFile()) {
      try {
        const info = lstatSync(join(walkRoot, childRel));
        if (info.isFile()) out.files.push({ rel: childRel, abs: join(walkRoot, childRel), size: info.size, key: statKey(info) });
      } catch (error) {
        if (errCode(error) !== 'ENOENT') out.errors.push({ rel: childRel, code: errCode(error) });
      }
    } // FIFOs and sockets are never opened (an open could block)
  }
}

type Opened = { state: 'present'; walkRoot: string } | { state: 'absent' } | { state: 'unreadable'; code: string };
function openStore(spec: StoreSpec): Opened {
  try {
    const info = lstatSync(rootEntryPath(spec.root));
    if (info.isSymbolicLink()) return { state: 'unreadable', code: 'ELOOP' };
    if (!info.isDirectory()) return { state: 'unreadable', code: 'ENOTDIR' };
    const walkRoot = realpathSync(spec.root);
    readdirSync(walkRoot);
    return { state: 'present', walkRoot };
  } catch (error) {
    return errCode(error) === 'ENOENT' ? { state: 'absent' } : { state: 'unreadable', code: errCode(error) };
  }
}

function walkStore(walkRoot: string): Walked {
  const out: Walked = { files: [], symlinks: [], errors: [] };
  for (const tree of TREES) {
    try {
      const info = lstatSync(join(walkRoot, tree));
      if (info.isSymbolicLink()) out.symlinks.push(tree);
      else if (!info.isDirectory()) out.errors.push({ rel: tree, code: 'ENOTDIR' });
      else walkDir(walkRoot, tree, out);
    } catch (error) {
      if (errCode(error) !== 'ENOENT') out.errors.push({ rel: tree, code: errCode(error) });
    }
  }
  return out;
}

const isLedger = (rel: string) => rel.startsWith('analytics/') && rel.endsWith('.jsonl');
const isHandoffTree = (rel: string) => rel.startsWith('telemetry/') || rel.startsWith('telemetry-completed/');
const isNameKeyed = (rel: string) => isHandoffTree(rel) || rel.startsWith('telemetry-locks/') || rel.startsWith('workflow-metrics-locks/') || rel.startsWith('analytics/workflow-metrics/');

type RangeRead = { size: number; got: number; hash: string | null; ids: Set<string>; needle: number };
/**
 * Stat first, then hash exactly that many bytes: the size comes from fstat, the first hashLen bytes (capped at the
 * stat'd size) are hashed, and bytes from scanFrom on are scanned for session-id tokens and path needles. O_NOFOLLOW
 * refuses a link swapped in after the walk. A concurrent append lands past the stat'd length and is never read.
 */
function readRange(abs: string, o: { hashLen: number; scanFrom: number; needles: string[]; afterStat?: () => void }): RangeRead {
  const fd = openSync(abs, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const size = fstatSync(fd).size;
    o.afterStat?.();
    const hashLen = Math.min(o.hashLen, size);
    const hasher = createHash('sha256');
    const buffer = Buffer.allocUnsafe(Math.max(1, Math.min(CHUNK, size)));
    const ids = new Set<string>();
    let needle = -1, carry = '', pos = 0;
    while (pos < size) {
      const read = readSync(fd, buffer, 0, Math.min(buffer.length, size - pos), pos);
      if (read <= 0) break;
      if (pos < hashLen) hasher.update(buffer.subarray(0, Math.min(read, hashLen - pos)));
      const from = Math.max(0, o.scanFrom - pos);
      if (from < read) {
        const text = carry + buffer.toString('latin1', from, read);
        for (const match of text.matchAll(ID_RE)) ids.add(match[0]);
        if (needle < 0) needle = o.needles.findIndex(candidate => text.includes(candidate));
        carry = text.slice(-CARRY);
      }
      pos += read;
    }
    return { size, got: pos, hash: pos >= hashLen ? hasher.digest('hex') : null, ids, needle };
  } finally {
    closeSync(fd);
  }
}
function tryRead(abs: string, o: Parameters<typeof readRange>[1]): { r: RangeRead } | { code: string } {
  try {
    return { r: readRange(abs, o) };
  } catch (error) {
    return { code: errCode(error) };
  }
}

function describeError(error: unknown): string {
  const err = error instanceof Error ? error : new Error(String(error));
  const bare = (text: string) => text.replace(/(?:\/[^\s'",():]+)+/g, path => `…/${basename(path)}`);
  const frames = (err.stack ?? '').split('\n').slice(1, 4).map(line => bare(line.trim().replace(/^at /, '')));
  return `${err.constructor.name}: ${bare(err.message.split('\n')[0] ?? '')} @ ${frames.join(' < ')}`;
}

function unverifiedFor(spec: StoreSpec, rel: string, home: string, kind: 'unreadable' | 'symlink' | 'rotated', code = ''): Unverified {
  const causes = {
    unreadable: [`unreadable store (${code})`, 'restore read access and rerun'],
    symlink: ['skipped symlink (the guard follows no symlink)', 'replace the link with a real directory or file, or remove it, and rerun'],
    rotated: ['upstream ledger shrank or was rewritten (a rotation cannot be told from a leak)', 'confirm the rotation was yours and rerun'],
  } as const;
  return { store: spec.label, path: displayPath(spec, rel, home), cause: causes[kind][0], fix: causes[kind][1] };
}
function noteProblems(spec: StoreSpec, walked: Walked, home: string, into: Unverified[]) {
  for (const link of walked.symlinks) into.push(unverifiedFor(spec, link, home, 'symlink'));
  for (const problem of walked.errors) into.push(unverifiedFor(spec, problem.rel, home, 'unreadable', problem.code));
}

function snapStore(spec: StoreSpec, snap: RealStoreSnapshot, tokens: Set<string>, opts: GuardOpts): StoreSnap {
  const out: StoreSnap = { spec, state: 'absent', ledgers: {}, tree: {} };
  const opened = openStore(spec);
  out.state = opened.state;
  if (opened.state === 'unreadable') snap.unverified.push(unverifiedFor(spec, '', snap.home, opened.code === 'ELOOP' ? 'symlink' : 'unreadable', opened.code));
  if (opened.state !== 'present') return out;
  const walked = walkStore(opened.walkRoot);
  noteProblems(spec, walked, snap.home, snap.unverified);
  snap.files += walked.files.length;
  for (const file of walked.files) {
    const ledger = isLedger(file.rel);
    if (!ledger && !isHandoffTree(file.rel)) continue;
    if (!ledger) out.tree[file.rel] = file.key;
    const got = tryRead(file.abs, { hashLen: ledger ? Number.MAX_SAFE_INTEGER : 0, scanFrom: 0, needles: [], afterStat: () => opts.hooks?.afterStat?.(file.abs, 'snapshot') });
    if ('code' in got) {
      if (got.code !== 'ENOENT') snap.unverified.push(unverifiedFor(spec, file.rel, snap.home, got.code === 'ELOOP' ? 'symlink' : 'unreadable', got.code));
      continue;
    }
    for (const id of got.r.ids) tokens.add(id);
    if (ledger) {
      if (got.r.hash === null) snap.unverified.push(unverifiedFor(spec, file.rel, snap.home, 'unreadable', 'changed while read'));
      else out.ledgers[file.rel] = { size: got.r.size, sha256: got.r.hash };
    }
  }
  return out;
}

function suiteFromStack(): string | null {
  for (const match of (new Error().stack ?? '').matchAll(/(\/[^\s():]+\.(?:ts|js|mjs)):\d+:\d+/g)) {
    const file = match[1]!;
    if (file === import.meta.path) continue;
    return file.startsWith(ROOT + '/') ? file.slice(ROOT.length + 1) : basename(file);
  }
  return null;
}

/** Read-only snapshot of every store: ledger size+hash, handoff/marker stat keys, and the session tokens already present. */
export function snapshotRealStores(specs: StoreSpec[] = realStoreSpecs(), opts: GuardOpts = {}): RealStoreSnapshot {
  const started = performance.now();
  const snap: RealStoreSnapshot = {
    v: 1, takenAt: Date.now(), suite: opts.suite ?? null, home: opts.home ?? REAL_HOME, inheritedVars: inheritedVarNames(),
    stores: [], tokens: [], unverified: [], files: 0, ms: 0, error: null,
  };
  const tokens = new Set<string>();
  try {
    for (const spec of specs) snap.stores.push(snapStore(spec, snap, tokens, opts));
  } catch (error) {
    snap.error = describeError(error); // surfaces as `unexpected` at the comparison, never inside the test that took it
  }
  snap.tokens = [...tokens].map(sha256);
  snap.ms = Math.round(performance.now() - started);
  return snap;
}

/** Every `extend-<uuid>` session ID in the files under dir (a fixture home): handoffs, stage-runs rows, ledgers, crafted or not. */
export function harvestSessionIds(dirs: string | string[]): Set<string> {
  const ids = new Set<string>();
  const visit = (dir: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '.git' && entry.name !== 'node_modules') visit(path);
      } else if (entry.isFile()) {
        const got = tryRead(path, { hashLen: 0, scanFrom: 0, needles: [] });
        if ('r' in got) for (const id of got.r.ids) ids.add(id);
      } // symlinks are never followed
    }
  };
  for (const dir of Array.isArray(dirs) ? dirs : [dirs]) visit(dir);
  return ids;
}

function tempNeedles(extra: string[] = []): string[] {
  const dirs = new Set<string>();
  for (const dir of [tmpdir(), ...extra]) {
    dirs.add(dir);
    try {
      dirs.add(realpathSync(dir)); // macOS reports /private/var/... for a /var/... temp directory
    } catch {
      // The plain path still counts.
    }
  }
  return [...dirs].map(dir => join(dir, 'gx-tel-'));
}

function findingLine(finding: GuardFinding, suite: string, vars: string[]): string {
  const size = finding.size === null ? '' : ` size=${finding.size}B`;
  const ids = finding.ids.length ? ` session-id=${finding.ids.slice(0, 3).join(',')}${finding.ids.length > 3 ? ` (+${finding.ids.length - 3} more)` : ''}` : '';
  return `${GUARD}:${finding.code} what: store=${finding.store} path=${finding.path}${size} ${finding.detail}`
    + ` | context: suite=${suite}${ids} inherited-vars=${vars.join(',') || 'none'}`
    + ` | fix: ${finding.fix ?? `find the spawn in ${suite} that escaped isolation and run it through \`makeTelemetryFixture\` or the isolation prelude`}`
    + ` | recovery: ${finding.recovery ?? 'side effects are complete; never edit, move or delete the real rows; report them to the owner and rerun after the fix'}`
    + ` | docs: docs/telemetry.md#workflow-metrics-guard-${finding.code}`;
}

function finish(findings: GuardFinding[], unverified: Unverified[], files: number, started: number, suite: string, vars: string[], strict: boolean): GuardResult {
  const all = [...findings];
  const distinct = <T,>(values: T[]) => [...new Set(values)];
  if (strict && unverified.length) {
    all.push({
      code: 'unexpected', store: distinct(unverified.map(u => u.store)).join(','), path: unverified[0]!.path, size: null, ids: [],
      detail: `— unverified under GSTACK_EXTEND_STORE_GUARD=strict: ${distinct(unverified.map(u => u.cause)).join('; ')}`,
      fix: distinct(unverified.map(u => u.fix)).join('; '),
      recovery: 'the guard changed nothing and found no leak, it could not verify; fix the cause and rerun',
    });
  }
  const ms = Math.round(performance.now() - started);
  const status = all.length ? 'failed' : unverified.length ? 'unverified' : 'verified';
  const lines: string[] = [];
  const counts = new Map<string, number>();
  for (const finding of all) {
    const seen = counts.get(finding.code) ?? 0;
    counts.set(finding.code, seen + 1);
    if (seen < MAX_LISTED) lines.push(findingLine(finding, suite, vars));
    else if (seen === MAX_LISTED) lines.push(`${GUARD}:${finding.code} more findings of this code are not listed; fix the first ones and rerun`);
  }
  for (const item of unverified.slice(0, MAX_LISTED)) lines.push(`${GUARD}: warning unverified store=${item.store} path=${item.path} cause=${item.cause} fix=${item.fix}`);
  const tail = unverified.length ? `: ${distinct(unverified.map(u => u.cause)).join('; ')}; fix: ${distinct(unverified.map(u => u.fix)).join('; ')}` : '';
  lines.push(`${GUARD}: ${status} (${files} files, ${ms} ms)${status === 'verified' ? '' : tail}`);
  return { status, findings: all, unverified, files, ms, lines };
}

function unexpectedResult(error: unknown, snap: Pick<RealStoreSnapshot, 'suite' | 'inheritedVars'>): GuardResult {
  const finding: GuardFinding = { code: 'unexpected', store: 'real stores', path: 'unknown', size: null, ids: [], detail: `— ${describeError(error)}` };
  return finish([finding], [], 0, performance.now(), snap.suite ?? 'the suite under test', snap.inheritedVars, false);
}

/**
 * Compare the stores with a snapshot. ids are the session IDs the suite minted (harvestSessionIds); any already in the
 * pre-snapshot stores are excluded. Never throws: an internal failure comes back as an `unexpected` finding.
 */
export function compareRealStores(snap: RealStoreSnapshot, ids: Iterable<string>, opts: GuardOpts = {}): GuardResult {
  const started = performance.now();
  try {
    return compareStores(snap, ids, opts, started);
  } catch (error) {
    return unexpectedResult(error, { suite: opts.suite ?? snap?.suite ?? null, inheritedVars: snap?.inheritedVars ?? [] });
  }
}
/** compareRealStores, throwing a RealStoreGuardError (all lines, summary last) when the result is `failed`. */
export function assertRealStoresUntouched(snap: RealStoreSnapshot, ids: Iterable<string>, opts: GuardOpts = {}): GuardResult {
  const result = compareRealStores(snap, ids, opts);
  if (result.status === 'failed') throw new RealStoreGuardError(result.lines);
  return result;
}

function compareStores(snap: RealStoreSnapshot, idIterable: Iterable<string>, opts: GuardOpts, started: number): GuardResult {
  if (snap.error) throw new Error(`the snapshot failed: ${snap.error}`);
  const home = opts.home ?? snap.home;
  const suite = opts.suite ?? snap.suite ?? 'the suite under test';
  const strict = opts.strict ?? process.env.GSTACK_EXTEND_STORE_GUARD === 'strict';
  const known = new Set(snap.tokens);
  const harvested = new Set([...idIterable].filter(id => !known.has(sha256(id))));
  const byHash = new Map([...harvested].map(id => [sha256(id), id]));
  const needles = tempNeedles(opts.tempRoots);
  const findings = new Map<string, GuardFinding>();
  const unverified: Unverified[] = [...snap.unverified];
  let files = 0;
  const flag = (code: GuardCode, spec: StoreSpec, rel: string, size: number | null, detail: string, ids: string[] = []) => {
    const path = displayPath(spec, rel, home);
    const key = `${code}|${spec.label}|${path}`;
    const prior = findings.get(key);
    if (prior) prior.ids = [...new Set([...prior.ids, ...ids])];
    else findings.set(key, { code, store: spec.label, path, size, detail, ids });
  };
  const matched = (found: Set<string>) => [...found].filter(id => harvested.has(id));
  const temp = 'a path under the runner\'s temp directory (gx-tel-)';

  for (const ss of snap.stores) {
    const spec = ss.spec;
    const opened = openStore(spec);
    if (opened.state === 'unreadable') {
      unverified.push(unverifiedFor(spec, '', home, opened.code === 'ELOOP' ? 'symlink' : 'unreadable', opened.code));
      continue;
    }
    const walked = opened.state === 'present' ? walkStore(opened.walkRoot) : { files: [], symlinks: [], errors: [] } as Walked;
    noteProblems(spec, walked, home, unverified);
    files += walked.files.length;
    const covered = [...walked.symlinks, ...walked.errors.map(problem => problem.rel)];
    const isCovered = (rel: string) => covered.some(prefix => rel === prefix || rel.startsWith(prefix + '/'));
    const now = new Map(walked.files.map(file => [file.rel, file]));
    const hook = (abs: string) => opts.hooks?.afterStat?.(abs, 'compare');

    // A pre-existing ledger keeps its byte prefix; whatever was appended is scanned.
    for (const [rel, prev] of Object.entries(ss.ledgers)) {
      const file = now.get(rel);
      const rewritten = (size: number | null, why: string, scanned: Set<string>) => {
        if (spec.kind === 'extend') flag('prefix-rewrite', spec, rel, size, `— gstack-extend ledger ${why} (was ${prev.size}B)`, matched(scanned));
        else unverified.push(unverifiedFor(spec, rel, home, 'rotated'));
      };
      if (!file) {
        if (!isCovered(rel)) rewritten(null, 'was removed', new Set());
        continue;
      }
      const got = tryRead(file.abs, { hashLen: prev.size, scanFrom: prev.size, needles, afterStat: () => hook(file.abs) });
      if ('code' in got) {
        if (got.code === 'ENOENT') rewritten(null, 'was removed', new Set());
        else unverified.push(unverifiedFor(spec, rel, home, got.code === 'ELOOP' ? 'symlink' : 'unreadable', got.code));
        continue;
      }
      const r = got.r;
      let ids = r.ids, needle = r.needle, range = `appended range ${prev.size}..${r.size}`;
      if (r.size < prev.size || r.hash !== prev.sha256) {
        // The appended range is unknowable once the prefix moved: scan the whole file for harvested IDs and paths.
        const whole = tryRead(file.abs, { hashLen: 0, scanFrom: 0, needles });
        if ('r' in whole) { ids = whole.r.ids; needle = whole.r.needle; range = 'rewritten ledger'; }
        rewritten(r.size, r.size < prev.size ? `shrank to ${r.size}B` : 'changed its byte prefix', ids);
      }
      const hits = matched(ids);
      if (hits.length) flag('appended-id', spec, rel, r.size, `— ${range} holds a harvested session id`, hits);
      if (needle >= 0) flag('escaped-root', spec, rel, r.size, `— ${range} names ${temp}`);
    }

    for (const file of walked.files) {
      const { rel } = file;
      if (isLedger(rel) && !(rel in ss.ledgers)) {
        const got = tryRead(file.abs, { hashLen: 0, scanFrom: 0, needles });
        if ('code' in got) {
          if (got.code !== 'ENOENT') unverified.push(unverifiedFor(spec, rel, home, got.code === 'ELOOP' ? 'symlink' : 'unreadable', got.code));
        } else {
          const hits = matched(got.r.ids);
          if (hits.length) flag('appended-id', spec, rel, got.r.size, '— new ledger holds a harvested session id', hits);
          if (got.r.needle >= 0) flag('escaped-root', spec, rel, got.r.size, `— new ledger rows name ${temp}`);
        }
      } else if (isHandoffTree(rel) && ss.tree[rel] !== file.key) {
        const what = rel.startsWith('telemetry-completed/') ? 'completion marker' : 'handoff';
        const got = tryRead(file.abs, { hashLen: 0, scanFrom: 0, needles });
        if ('code' in got) {
          if (got.code !== 'ENOENT') unverified.push(unverifiedFor(spec, rel, home, got.code === 'ELOOP' ? 'symlink' : 'unreadable', got.code));
        } else {
          const hits = matched(got.r.ids);
          if (hits.length) flag('appended-id', spec, rel, got.r.size, `— new or changed ${what} holds a harvested session id`, hits);
          if (got.r.needle >= 0) flag('escaped-root', spec, rel, got.r.size, `— new or changed ${what} binds a root under ${temp}`);
        }
      }
      if (isNameKeyed(rel)) {
        const digest = /^[0-9a-f]{64}/.exec(file.rel.slice(file.rel.lastIndexOf('/') + 1))?.[0];
        const id = digest ? byHash.get(digest) : undefined;
        if (id) flag('named-file', spec, rel, file.size, '— a file is named with the SHA-256 of a harvested session id', [id]);
      }
    }
  }
  return finish([...findings.values()], unverified, files, started, suite, snap.inheritedVars, strict);
}

// Lifecycle: one snapshot per suite, outside any test body when possible. The first importing file arms it from a
// beforeAll hook (per-test timeouts do not apply to hooks); cleanupTelemetryFixtures() re-arms after each comparison
// so later suites in the same bun process find one waiting; makeTelemetryFixture() takes it lazily as the fallback.
let activeSnapshot: RealStoreSnapshot | null = null;
function armSnapshot(suite: string | null) {
  activeSnapshot = snapshotRealStores(realStoreSpecs(), { suite });
}
function ensureSnapshot() {
  if (!activeSnapshot) armSnapshot(suiteFromStack());
  else if (!activeSnapshot.suite) activeSnapshot.suite = suiteFromStack();
}
if (!import.meta.main) {
  try {
    beforeAll(() => {
      if (!activeSnapshot) armSnapshot(null);
    }, 120_000);
  } catch {
    // Imported outside `bun test` (a script): the first makeTelemetryFixture() takes the snapshot instead.
  }
}

// ──────────────────────────── manual smoke CLI (import.meta.main only) ────────────────────────────
function cliMain(argv: string[]): number {
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) flags.set(arg, [...(flags.get(arg) ?? []), argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[++i]! : '']);
  }
  const one = (name: string) => flags.get(name)?.[0];
  const usage = () => {
    console.error(`${GUARD}:unexpected usage: bun tests/helpers/telemetry-env.ts --snapshot <file> | --compare <file> [--ids <file>] [--harvest <dir>]...`);
    return 2;
  };
  if (one('--snapshot')) {
    const snap = snapshotRealStores(realStoreSpecs(), { suite: 'the manual smoke' });
    if (snap.error) {
      console.error(`${GUARD}:unexpected what: store=real stores ${snap.error}`);
      return 1;
    }
    writeFileSync(one('--snapshot')!, JSON.stringify(snap), { mode: 0o600 });
    for (const item of snap.unverified) console.warn(`${GUARD}: warning unverified store=${item.store} path=${item.path} cause=${item.cause} fix=${item.fix}`);
    console.log(`${GUARD}: snapshot written (${snap.files} files, ${snap.ms} ms)`);
    return 0;
  }
  if (one('--compare')) {
    let snap: RealStoreSnapshot;
    try {
      snap = JSON.parse(readFileSync(one('--compare')!, 'utf8')) as RealStoreSnapshot;
      if (snap.v !== 1 || !Array.isArray(snap.stores)) throw new Error('not a snapshot file');
    } catch (error) {
      console.error(`${GUARD}:unexpected what: store=snapshot file ${describeError(error)}`);
      return 2;
    }
    const ids = new Set<string>();
    if (one('--ids')) for (const match of readFileSync(one('--ids')!, 'utf8').matchAll(ID_RE)) ids.add(match[0]);
    for (const dir of (flags.get('--harvest') ?? []).filter(Boolean)) for (const id of harvestSessionIds(dir)) ids.add(id);
    const result = compareRealStores(snap, ids, { suite: 'the manual smoke' });
    for (const line of result.lines) (result.status === 'failed' ? console.error : console.log)(line);
    return result.status === 'failed' ? 1 : 0;
  }
  return usage();
}
if (import.meta.main) process.exit(cliMain(process.argv.slice(2)));
