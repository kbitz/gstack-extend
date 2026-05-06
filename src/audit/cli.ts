/**
 * cli.ts — orchestrator for the TS port of bin/roadmap-audit.
 *
 * Constructs an AuditCtx from the filesystem (the only place outside
 * lib/git.ts that touches I/O), then dispatches each check and renders
 * its CheckResult into the stable section-block format that bash
 * emits. Per the PR-2 plan, only the 12 ported sections are wired up;
 * un-ported PR-3 sections are deliberately omitted from the output (the
 * shadow runner's PORTED_SECTIONS allowlist diffs only the subset).
 *
 * Section render contract:
 *   ## SECTION
 *   <preamble lines, if any>
 *   STATUS: <status>
 *   <body lines>
 *
 *   ← single blank line between sections
 *
 * Warn/fail bodies that include user findings push a trailing '' into
 * `body` so the rendered section has TWO blank lines before the next —
 * mirrors the bash artifact of `echo -e "$findings"` (a `\n`-terminated
 * string interpreted by `echo -e` plus echo's own newline). Snapshot
 * fixtures depend on this exact spacing.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Glob } from 'bun';

import { runCheckArchiveCandidates } from './checks/archive-candidates.ts';
import { runCheckCollisions } from './checks/collisions.ts';
import { runCheckDependencies } from './checks/dependencies.ts';
import { runCheckDocInventory } from './checks/doc-inventory.ts';
import { runCheckDocLocation } from './checks/doc-location.ts';
import { runCheckDocType } from './checks/doc-type.ts';
import { runCheckGroupDeps } from './checks/group-deps.ts';
import { runCheckInFlightGroups } from './checks/in-flight-groups.ts';
import { detectMode, type ModeResult } from './checks/mode.ts';
import { runCheckOriginStats } from './checks/origin-stats.ts';
import { runCheckParallelismBudget } from './checks/parallelism-budget.ts';
import { runCheckParallelizableFuture } from './checks/parallelizable-future.ts';
import { runCheckPhaseInvariants } from './checks/phase-invariants.ts';
import { runCheckPhases } from './checks/phases.ts';
import { runCheckScatteredTodos } from './checks/scattered-todos.ts';
import { runCheckSizeCaps } from './checks/size-caps.ts';
import { runCheckStaleness } from './checks/staleness.ts';
import { runCheckStructuralFitness } from './checks/structural-fitness.ts';
import { runCheckStructure } from './checks/structure.ts';
import { runCheckStyleLint } from './checks/style-lint.ts';
import { runCheckTaskList } from './checks/task-list.ts';
import { runCheckTaxonomy } from './checks/taxonomy.ts';
import { runCheckTodoFormat } from './checks/todo-format.ts';
import { runCheckUnprocessed } from './checks/unprocessed.ts';
import { runCheckVersion } from './checks/version.ts';
import { runCheckVocabLint } from './checks/vocab-lint.ts';
import { createGitGateway } from './lib/git.ts';
import { resolveStateDir } from './lib/effort.ts';
import { computeInFlight } from './lib/in-flight.ts';
import { walkMdFiles } from './lib/md-walk.ts';
import { parallelismCap as resolveParallelismCap } from './lib/parallelism-cap.ts';
import { versionGt } from './lib/semver.ts';
import { loadSharedInfra } from './lib/shared-infra.ts';
import { parsePhases } from './parsers/phases.ts';
import { parseProgress } from './parsers/progress.ts';
import { parseRoadmap } from './parsers/roadmap.ts';
import { parseTodos } from './parsers/todos.ts';
import {
  collectParseErrors,
  type AuditCtx,
  type CheckResult,
  type DesignDoc,
  type MdFileSnapshot,
  type ScaffoldResolution,
  type VersionInfo,
} from './types.ts';

// ─── Args ─────────────────────────────────────────────────────────────

export type Argv = {
  repoRoot: string | null; // null → resolve via gateway / pwd
  scanState: boolean;
  prompt: string | null;
};

export function parseArgs(argv: string[]): Argv {
  const out: Argv = { repoRoot: null, scanState: false, prompt: null };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--scan-state') {
      out.scanState = true;
      continue;
    }
    if (a === '--prompt') {
      out.prompt = argv[++i] ?? '';
      continue;
    }
    rest.push(a);
  }
  if (rest.length > 0) out.repoRoot = rest[0]!;
  return out;
}

// ─── find_doc ─────────────────────────────────────────────────────────

function findDoc(repoRoot: string, name: string): string | null {
  const root = join(repoRoot, name);
  if (existsSync(root) && statSync(root).isFile()) return root;
  const docs = join(repoRoot, 'docs', name);
  if (existsSync(docs) && statSync(docs).isFile()) return docs;
  return null;
}

function readMaybe(path: string | null): string {
  if (path === null) return '';
  if (!existsSync(path)) return '';
  if (!statSync(path).isFile()) return '';
  return readFileSync(path, 'utf8');
}

function fileExists(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function dirExists(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

// ─── pyproject version ────────────────────────────────────────────────

const PYPROJECT_VERSION_RE = /^[ \t\v\f\r]*version[ \t\v\f\r]*=[ \t\v\f\r]*"([0-9]+\.[0-9]+\.[0-9]+(?:\.[0-9]+)?)"/m;

function readPyprojectVersion(content: string): string | null {
  const m = PYPROJECT_VERSION_RE.exec(content);
  return m === null ? null : m[1]!;
}

// ─── changelog latest ─────────────────────────────────────────────────

const CHANGELOG_VERSION_RE = /## \[?([0-9]+\.[0-9]+\.[0-9]+(?:\.[0-9]+)?)/;

function readChangelogLatest(content: string): string | null {
  if (content === '') return null;
  for (const line of content.split('\n')) {
    const m = CHANGELOG_VERSION_RE.exec(line);
    if (m !== null) return m[1]!;
  }
  return null;
}

// ─── Build AuditCtx ───────────────────────────────────────────────────

export function buildAuditCtx(args: {
  repoRoot: string;
  extendDir: string;
  argv: Argv;
}): AuditCtx {
  const { repoRoot, extendDir, argv } = args;
  const git = createGitGateway({ cwd: repoRoot });

  const todosPath = findDoc(repoRoot, 'TODOS.md');
  const roadmapPath = findDoc(repoRoot, 'ROADMAP.md');
  const progressPath = findDoc(repoRoot, 'PROGRESS.md');

  const versionFilePath = join(repoRoot, 'VERSION');
  const pyprojectPath = join(repoRoot, 'pyproject.toml');
  const changelogPath = join(repoRoot, 'CHANGELOG.md');

  const roadmapContent = readMaybe(roadmapPath);
  const todosContent = readMaybe(todosPath);
  const progressContent = readMaybe(progressPath);
  const versionContent = fileExists(versionFilePath) ? readFileSync(versionFilePath, 'utf8') : '';
  const changelogContent = fileExists(changelogPath) ? readFileSync(changelogPath, 'utf8') : '';
  const pyprojectContent = fileExists(pyprojectPath) ? readFileSync(pyprojectPath, 'utf8') : '';

  // VersionInfo. VERSION wins; pyproject is the fallback when VERSION
  // is absent. An empty VERSION file is its own diagnostic — version.ts
  // emits a custom "VERSION file is empty" hint and treats source as
  // "unknown" so downstream checks (TAXONOMY, ARCHIVE_CANDIDATES) skip.
  let current = '';
  let source: VersionInfo['source'] = 'unknown';
  if (fileExists(versionFilePath)) {
    const trimmed = versionContent.replace(/[\t\n\v\f\r ]/g, '');
    if (trimmed !== '') {
      current = trimmed;
      source = 'VERSION';
    }
  }
  if (source === 'unknown') {
    const pyVer = readPyprojectVersion(pyprojectContent);
    if (pyVer !== null) {
      current = pyVer;
      source = 'pyproject.toml';
    }
  }
  const latestTag = git.tagsLatest();

  // PROGRESS.md latest version (highest by semver across cells).
  // Bash: `grep -oE '\| [0-9]+\.[0-9]+(\.[0-9]+)*(\.[0-9]+)* \|'` then trim
  // surrounding `| ... |`. Implemented via the parser.
  const progressParsed = parseProgress(progressContent);
  const progressLatest = progressParsed.value.latestVersion;

  const changelogLatest = readChangelogLatest(changelogContent);

  const versionInfo: VersionInfo = {
    current,
    source,
    latestTag,
    progressLatest,
    changelogLatest,
  };

  // Existence flags for TAXONOMY / DOC_LOCATION.
  const docsDir = join(repoRoot, 'docs');
  const designsDir = join(repoRoot, 'docs', 'designs');
  const exists = {
    rootTodos: fileExists(join(repoRoot, 'TODOS.md')),
    docsTodos: fileExists(join(repoRoot, 'docs', 'TODOS.md')),
    rootRoadmap: fileExists(join(repoRoot, 'ROADMAP.md')),
    docsRoadmap: fileExists(join(repoRoot, 'docs', 'ROADMAP.md')),
    rootProgress: fileExists(join(repoRoot, 'PROGRESS.md')),
    docsProgress: fileExists(join(repoRoot, 'docs', 'PROGRESS.md')),
    versionFile: fileExists(versionFilePath),
    pyprojectFile: fileExists(pyprojectPath),
    changelogFile: fileExists(changelogPath),
    docsDir: dirExists(docsDir),
    designsDir: dirExists(designsDir),
    rootReadme: fileExists(join(repoRoot, 'README.md')),
    docsReadme: fileExists(join(repoRoot, 'docs', 'README.md')),
    rootChangelog: fileExists(changelogPath),
    docsChangelog: fileExists(join(repoRoot, 'docs', 'CHANGELOG.md')),
    rootClaude: fileExists(join(repoRoot, 'CLAUDE.md')),
    docsClaude: fileExists(join(repoRoot, 'docs', 'CLAUDE.md')),
    rootVersion: fileExists(versionFilePath),
    docsVersion: fileExists(join(repoRoot, 'docs', 'VERSION')),
    rootLicense: fileExists(join(repoRoot, 'LICENSE')),
    docsLicense: fileExists(join(repoRoot, 'docs', 'LICENSE')),
    rootLicenseMd: fileExists(join(repoRoot, 'LICENSE.md')),
    docsLicenseMd: fileExists(join(repoRoot, 'docs', 'LICENSE.md')),
  };

  // docs/designs/ scan for ARCHIVE_CANDIDATES.
  const designs: DesignDoc[] = [];
  if (exists.designsDir) {
    const entries = readdirSync(designsDir);
    // Sort byte-wise to mirror bash `*.md` glob expansion under LC_ALL=C.
    entries.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const name of entries) {
      if (!name.endsWith('.md')) continue;
      const full = join(designsDir, name);
      if (!fileExists(full)) continue;
      designs.push({ basename: name, content: readFileSync(full, 'utf8') });
    }
  }

  // Parse all four docs.
  const roadmap = parseRoadmap(roadmapContent);
  const phases = parsePhases(roadmapContent);
  const todos = parseTodos(todosContent);

  // Pre-resolve scaffold paths (file existence or glob match) keyed by
  // `${phaseNum}|${path}`. Globs use Bun's fast glob; fallback to
  // existsSync for plain paths.
  const scaffoldExists: ScaffoldResolution = new Map();
  for (const ph of phases.value.phases) {
    for (const p of ph.scaffoldPaths) {
      const key = `${ph.num}|${p}`;
      if (p === '') {
        scaffoldExists.set(key, false);
        continue;
      }
      if (p.includes('*')) {
        // Glob expansion. Use Bun.Glob, which returns matches relative to
        // the cwd argument. Empty iterator → no match → "matches no files".
        const glob = new Glob(p);
        let matched = false;
        for (const _ of glob.scanSync({ cwd: repoRoot, onlyFiles: true })) {
          matched = true;
          break;
        }
        scaffoldExists.set(key, matched);
        continue;
      }
      const abs = join(repoRoot, p);
      scaffoldExists.set(key, existsSync(abs));
    }
  }

  // .md walk for DOC_INVENTORY / SCATTERED_TODOS. Read every file's
  // content here so the checks stay pure.
  const mdFiles: MdFileSnapshot[] = [];
  for (const f of walkMdFiles(repoRoot)) {
    mdFiles.push({
      abs: f.abs,
      rel: f.rel,
      content: fileExists(f.abs) ? readFileSync(f.abs, 'utf8') : '',
    });
  }

  // Shared-infra config (docs/shared-infra.txt) — loaded once.
  const sharedInfra = loadSharedInfra(repoRoot);

  // Parallelism cap from CLAUDE.md (root or docs/). find_doc resolution.
  const claudeMdPath = findDoc(repoRoot, 'CLAUDE.md');
  const claudeMd = readMaybe(claudeMdPath);
  const parallelismCap = resolveParallelismCap(claudeMd);

  return {
    repoRoot,
    extendDir,
    env: {
      stateDir: resolveStateDir(),
      scanState: argv.scanState,
      userPrompt: argv.prompt ?? undefined,
    },
    git,
    paths: { todos: todosPath, roadmap: roadmapPath, progress: progressPath },
    files: {
      roadmap: roadmapContent,
      todos: todosContent,
      progress: progressContent,
      version: versionContent,
      changelog: changelogContent,
      pyproject: pyprojectContent,
    },
    exists,
    designs,
    scaffoldExists,
    mdFiles,
    sharedInfra,
    parallelismCap,
    claudeMd,
    roadmap,
    phases,
    todos,
    progress: progressParsed,
    version: versionInfo,
  };
}

// ─── Render ───────────────────────────────────────────────────────────

export function renderCheckResult(r: CheckResult): string {
  const lines: string[] = [`## ${r.section}`];
  if (r.preamble && r.preamble.length > 0) lines.push(...r.preamble);
  lines.push(`STATUS: ${r.status}`);
  lines.push(...r.body);
  // Trailing blank line between sections (matches bash `echo ""`).
  lines.push('');
  return lines.join('\n');
}

// ─── Run ──────────────────────────────────────────────────────────────

// All 25 checks in the canonical order bash emits at L3842-3868.
// MODE is special (no STATUS line) — rendered via renderMode at the end.
// DOC_TYPE_MISMATCH (Track 5A) lives adjacent to DOC_LOCATION; both are
// "doc-in-the-right-place?" checks that share doc-walk context.
const ALL_CHECKS: Array<(ctx: AuditCtx) => CheckResult> = [
  runCheckVocabLint,
  runCheckStructure,
  runCheckPhases,
  runCheckPhaseInvariants,
  runCheckStaleness,
  runCheckVersion,
  runCheckTaxonomy,
  runCheckDocLocation,
  runCheckDocType,
  runCheckArchiveCandidates,
  runCheckDependencies,
  runCheckGroupDeps,
  runCheckTaskList,
  runCheckStructuralFitness,
  runCheckInFlightGroups,
  runCheckOriginStats,
  runCheckSizeCaps,
  runCheckCollisions,
  runCheckParallelismBudget,
  runCheckParallelizableFuture,
  runCheckStyleLint,
  runCheckDocInventory,
  runCheckScatteredTodos,
  runCheckUnprocessed,
  runCheckTodoFormat,
];

function renderMode(m: ModeResult): string {
  return `## MODE\nDETECTED: ${m.detected}\nREASON: ${m.reason}\n`;
}

export function runAudit(ctx: AuditCtx): string {
  const out: string[] = [];
  for (const check of ALL_CHECKS) {
    out.push(renderCheckResult(check(ctx)));
  }
  out.push(renderMode(detectMode(ctx)));

  // T1: emit ## PARSE_ERRORS only when non-empty.
  const errors = collectParseErrors(ctx);
  if (errors.length > 0) {
    const lines = ['## PARSE_ERRORS', 'STATUS: warn'];
    for (const e of errors) {
      lines.push(`- ${e.file}:${e.line ?? '?'} [${e.kind}] ${e.message}`);
    }
    lines.push('');
    out.push(lines.join('\n'));
  }
  return out.join('\n');
}

// ─── --scan-state ─────────────────────────────────────────────────────
//
// Emits the JSON envelope documented at bash L3825-3837. The bash version
// runs the audit silently and greps fields out of the output; here we
// reach into the structured CheckResults instead, which is faster and
// less brittle.
//
// Intent detection mirrors bash word-pattern matching with negation
// guards (a 5-word window before each match looks for negators like
// "don't" / "not" / "never"). Hand-rolled to avoid the awk loop the
// bash version uses.

const CLOSURE_WORDS = /\b(close out|close-out|finish|wrap up|fully done|fully close)\b/i;
const SPLIT_WORDS = /\b(split|break up|break apart|too big|decompose)\b/i;
const TRACK_REF_RE = /Track ([0-9]+)([a-zA-Z])(\.[0-9]+)?/i;
const NEGATORS = new Set([
  "don't",
  'do',
  'not',
  'never',
  'unless',
  'instead',
]);

function intentFires(prompt: string, pattern: RegExp): boolean {
  if (prompt === '') return false;
  const lower = prompt.toLowerCase();
  let firstMatch: RegExpMatchArray | null = null;
  const re = new RegExp(pattern.source, pattern.flags.replace('i', '') + 'gi');
  while (true) {
    const m = re.exec(lower);
    if (m === null) break;
    firstMatch = m;
    // Look at the 5 tokens preceding this match.
    const before = lower.slice(0, m.index).trim();
    const tokens = before.split(/[ \t\n\v\f\r]+/);
    const window = tokens.slice(-5);
    let neg = false;
    for (const tok of window) {
      const stripped = tok.replace(/[^a-z']+$/g, '');
      if (NEGATORS.has(stripped)) {
        neg = true;
        break;
      }
    }
    if (!neg) return true;
  }
  return firstMatch !== null && false;
}

function normalizeTrackRef(prompt: string): string {
  const m = TRACK_REF_RE.exec(prompt);
  if (m === null) return '';
  const num = m[1]!;
  const letter = m[2]!.toUpperCase();
  const suffix = m[3] ?? '';
  return `${num}${letter}${suffix}`;
}

export function runScanState(ctx: AuditCtx, prompt: string | null): string {
  const promptStr = prompt ?? '';
  const closure = intentFires(promptStr, CLOSURE_WORDS) ? 1 : 0;
  const split = intentFires(promptStr, SPLIT_WORDS) ? 1 : 0;
  const trackRef = normalizeTrackRef(promptStr);

  if (ctx.paths.roadmap === null) {
    return [
      '{',
      '  "exclusive_state": "GREENFIELD",',
      `  "intents": {"closure": ${closure}, "split": ${split}, "track_ref": "${trackRef}"},`,
      '  "signals": null',
      '}',
    ].join('\n');
  }

  // Compute signals via the same checks the bash version would scan.
  const stalenessFail = runCheckStaleness(ctx).status === 'fail' ? 1 : 0;
  const unprocessedRes = runCheckUnprocessed(ctx);
  const itemsLine = unprocessedRes.preamble?.find((l) => l.startsWith('ITEMS: ')) ?? 'ITEMS: 0';
  const unprocessedCount = Number.parseInt(itemsLine.replace(/^ITEMS:[ \t]*/, ''), 10) || 0;

  const { inFlight } = computeInFlight(ctx.roadmap.value);
  const inFlightGroups = inFlight.join(' ');

  // origin_total — extract from ORIGIN_STATS body.
  const originRes = runCheckOriginStats(ctx);
  const totalLine = originRes.body.find((l) => l.startsWith('TOTAL_OPEN_ORIGIN: ')) ?? '';
  const originTotal = Number.parseInt(totalLine.replace(/^TOTAL_OPEN_ORIGIN:[ \t]*/, ''), 10) || 0;

  // has_zero_open_group — any in-flight Group with zero open Tracks
  // (PER_GROUP entry of `${g}=0`).
  const budget = runCheckParallelismBudget(ctx);
  const perGroupLine = budget.preamble?.find((l) => l.startsWith('PER_GROUP: ')) ?? '';
  let hasZeroOpenGroup = 0;
  for (const entry of perGroupLine.replace(/^PER_GROUP:[ \t]*/, '').split(' ')) {
    if (entry === '') continue;
    const eq = entry.indexOf('=');
    if (eq < 0) continue;
    if (entry.slice(eq + 1) === '0') {
      hasZeroOpenGroup = 1;
      break;
    }
  }

  // git_inferred_freshness — scan ROADMAP.md for active task bullets and
  // probe git for "this file changed since the task was introduced".
  // 2-commit floor OR 1-commit with Track-ID in commit subject (relaxed
  // to catch single-bundled-PR Tracks).
  const gitFreshness = computeGitInferredFreshness(ctx);

  return [
    '{',
    '  "exclusive_state": null,',
    `  "intents": {"closure": ${closure}, "split": ${split}, "track_ref": "${trackRef}"},`,
    '  "signals": {',
    `    "unprocessed_count": ${unprocessedCount},`,
    `    "in_flight_groups": "${inFlightGroups}",`,
    `    "origin_total": ${originTotal},`,
    `    "staleness_fail": ${stalenessFail},`,
    `    "git_inferred_freshness": ${gitFreshness},`,
    `    "has_zero_open_group": ${hasZeroOpenGroup}`,
    '  }',
    '}',
  ].join('\n');
}

// ─── git_inferred_freshness ───────────────────────────────────────────
//
// Scans ROADMAP.md for active task bullets (everything before
// `## Future` / `## Unprocessed` / `## Execution Map`). For each task,
// extracts a 4-word title phrase, finds the task's introduction date via
// `git log -S`, and counts subsequent commits to any referenced file.
// Two-commit threshold (conservative) OR one-commit with Track-ID in the
// subject (relaxed to catch single-bundled-PR Tracks).
//
// Cost: O(active_tasks × files_per_task) git calls. Bounded — bash audit
// is OK with this; touchfile cache (Group 4A) will further amortize.

function computeGitInferredFreshness(ctx: AuditCtx): number {
  if (ctx.paths.roadmap === null) return 0;
  if (ctx.git.toplevel() === null) return 0;

  const lines = ctx.files.roadmap.split('\n');
  let inActive = true;
  let curTrack = '';
  let count = 0;

  for (const line of lines) {
    if (/^## (Future|Unprocessed|Execution Map)/i.test(line)) {
      inActive = false;
      continue;
    }
    if (/^## Group/.test(line)) {
      inActive = true;
      continue;
    }
    if (!inActive) continue;

    const tm = line.match(/^### Track ([0-9]+[A-Z](?:\.[0-9]+)?):/);
    if (tm !== null) {
      curTrack = tm[1]!;
      continue;
    }

    if (!/^- \*\*/.test(line)) continue;

    // Title without bold/Pre-flight numbering, then 4-word phrase.
    const title = line.replace(/^- \*\*/, '').replace(/\*\*.*/, '').replace(/^\[[0-9]+\][ \t\v\f\r]*/, '');
    const words = title.split(/[ \t]+/).filter((w) => w !== '');
    if (words.length === 0) continue;
    const phrase = words.slice(0, 4).join(' ');

    // Files: italic _[a, b, c]_ + backtick-quoted paths (with `/` or `.`).
    const files = new Set<string>();
    const itMatch = line.match(/_\[([^\]]+)\]/);
    if (itMatch !== null) {
      for (const f of itMatch[1]!.split(',')) {
        const trimmed = f.replace(/^[ \t\v\f\r]+|[ \t\v\f\r]+$/g, '');
        if (trimmed !== '') files.add(trimmed);
      }
    }
    const btRe = /`([^`]+)`/g;
    let bt: RegExpExecArray | null;
    while ((bt = btRe.exec(line)) !== null) {
      const v = bt[1]!;
      if (v.includes('/') || v.includes('.')) files.add(v);
    }
    if (files.size === 0) continue;

    const intro = ctx.git.logFirstWithPhrase(phrase, ctx.paths.roadmap);
    if (intro === null || intro.date === '') continue;

    let fired = false;
    for (const f of files) {
      const subjects = ctx.git.logSubjectsSince(intro.date, f);
      if (subjects.length >= 2) {
        count++;
        fired = true;
        break;
      }
      if (subjects.length >= 1 && curTrack !== '') {
        const trackEsc = curTrack.replace(/\./g, '\\.');
        const re = new RegExp(`track ${trackEsc}([^a-z0-9]|$)`, 'i');
        if (subjects.some((s) => re.test(s))) {
          count++;
          fired = true;
          break;
        }
      }
    }
    if (fired) continue;
  }
  return count;
}

// ─── main ─────────────────────────────────────────────────────────────

export function main(argv: string[]): { stdout: string; exitCode: number } {
  const args = parseArgs(argv);
  let repoRoot = args.repoRoot;
  if (repoRoot === null) {
    const gw = createGitGateway({ cwd: process.cwd() });
    repoRoot = gw.toplevel() ?? process.cwd();
  }

  const extendDir = process.env.GSTACK_EXTEND_DIR ?? join(import.meta.dir, '..', '..');
  const ctx = buildAuditCtx({ repoRoot, extendDir, argv: args });

  if (args.scanState) {
    return { stdout: runScanState(ctx, args.prompt) + '\n', exitCode: 0 };
  }
  return { stdout: runAudit(ctx), exitCode: 0 };
}

// versionGt is re-used by version.ts; this re-export keeps the module
// surface symmetric with semver.ts's public types.
export { versionGt };

if (import.meta.main) {
  const { stdout, exitCode } = main(process.argv.slice(2));
  process.stdout.write(stdout);
  process.exit(exitCode);
}
