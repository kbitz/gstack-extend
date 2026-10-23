/**
 * classify.ts — the shared docs-only classification (docs/docs-ship.md#docs-only-classification).
 *
 * Default docs: top-level *.md and prose/raster files under docs/. Agent
 * instructions (AGENTS.md, CLAUDE.md, SKILL.md, skills/, prompts/, templates)
 * are executable and stop by default; a project opts paths in with
 * `docs-ship:docs=`. A version change stops; CHANGELOG lines are docs unless
 * they add a version heading; editing an already-released section is a
 * release-policy finding, not a stop.
 */
import { globMatcher } from '../merge-gate/glob.ts';
import { CONFIG_FILES, hasMarker, type DocsShipConfig } from './config.ts';
import { hunks, readAt, type Change, type Git, type Hunks } from './git.ts';

export const CHANGELOG = 'CHANGELOG.md';
const PROSE_EXT = /\.(md|markdown|rst|adoc|txt)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;
const AGENT_NAMES = new Set(['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'SKILL.md']);
const AGENT_SEGMENTS = new Set(['skills', 'prompts', 'templates', 'template']);
const TEMPLATE_NAME = /\.(tmpl|template)(\.[^/]+)?$/i;
const TEST_SEGMENTS = new Set(['tests', 'test', '__tests__', 'spec', 'specs']);
const TEST_NAME = /(\.(test|spec)\.[cm]?[jt]sx?$|^test_.*\.py$|_test\.(py|go)$|_spec\.rb$)/;
const BUILD_NAME = /^(package(-lock)?\.json|bun\.lockb?|yarn\.lock|pnpm-lock\.yaml|Cargo\.(toml|lock)|pyproject\.toml|setup\.(py|cfg)|requirements.*\.txt|poetry\.lock|go\.(mod|sum)|Gemfile(\.lock)?|.*\.gemspec|Makefile|Dockerfile|.*\.gradle(\.kts)?|pom\.xml|tsconfig.*\.json|composer\.(json|lock)|pubspec\.ya?ml|mix\.exs)$/;
const CODE_EXT = /\.([cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|pl|lua|scala|sql|ex|exs|vue|svelte)$/i;
const VERSION_FIELD = /(^|[^\w])(__version__|version|VERSION)\s*["']?\s*[:=]/;

export type Reason =
  | 'version' | 'agent-instructions' | 'classification-config' | 'project-excluded'
  | 'special-file' | 'test' | 'build' | 'code' | 'outside-allowlist';

export type FileResult =
  | { path: string; status: string; kind: 'docs'; why: string }
  | { path: string; status: string; kind: 'stop'; reason: Reason; why: string };

export type ReleaseFinding = { file: string; line: number; section: string; message: string; fix: string };

export type Classification = { files: FileResult[]; findings: ReleaseFinding[] };

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const segments = (p: string) => p.split('/').slice(0, -1);

/** Level-2 version headings, keyed by version text: `## [1.2.3] - date`, `## v1.2.3`, `## 1.2.3.4`. */
export function versionOf(heading: string): string | undefined {
  const m = /^\[?v?(\d+(?:\.\d+)+)\]?(?:\s|$)/.exec(heading.trim());
  return m?.[1];
}

type Section = { title: string; version?: string };

/** The level-2 section each 1-based line belongs to; undefined before the first one. */
function sectionsByLine(text: string): (Section | undefined)[] {
  const out: (Section | undefined)[] = [undefined];
  let current: Section | undefined;
  for (const line of text.split('\n')) {
    const h = /^##(?!#)\s+(.*?)\s*$/.exec(line);
    if (h) current = { title: h[1]!, version: versionOf(h[1]!) };
    out.push(current);
  }
  return out;
}

function versionHeadings(text: string): Set<string> {
  const set = new Set<string>();
  for (const s of sectionsByLine(text)) if (s?.version) set.add(s.version);
  return set;
}

function changelog(git: Git, from: string, to: string, change: Change, findings: ReleaseFinding[]): FileResult {
  const base: FileResult = { path: change.path, status: change.status, kind: 'docs', why: 'changelog' };
  if (change.status === 'D') return { ...base, kind: 'stop', reason: 'version', why: 'CHANGELOG.md deleted' };
  const before = readAt(git, from, change.path) ?? '';
  const after = readAt(git, to, change.path) ?? '';
  const released = versionHeadings(before);
  const added = [...versionHeadings(after)].filter((v) => !released.has(v));
  if (added.length) return { ...base, kind: 'stop', reason: 'version', why: `adds version heading ${added.map((v) => `[${v}]`).join(', ')}` };
  const h = hunks(git, from, to, change.path);
  const headSections = sectionsByLine(after);
  const baseSections = sectionsByLine(before);
  const touched = new Map<string, number>();
  for (const a of h.added) {
    const s = headSections[a.line];
    if (s?.version && released.has(s.version) && !touched.has(s.version)) touched.set(s.version, a.line);
  }
  h.removed.forEach((r, i) => {
    const s = baseSections[r.line];
    if (s?.version && !touched.has(s.version)) touched.set(s.version, h.removedAt[i]!);
  });
  for (const [version, line] of touched) {
    findings.push({
      file: change.path,
      line,
      section: version,
      message: `edits the already-released [${version}] section`,
      fix: `check the release policy; if it is silent, move the line to [Unreleased] or the next version's section`,
    });
  }
  return { ...base, why: touched.size ? 'changelog (edits a released section)' : 'changelog' };
}

function changedLines(h: Hunks): string[] {
  return [...h.added.map((l) => l.text), ...h.removed.map((l) => l.text)];
}

function stopCategory(path: string, lines: () => string[]): { reason: Reason; why: string } {
  const name = basename(path);
  const segs = segments(path);
  if (lines().some((l) => VERSION_FIELD.test(l))) return { reason: 'version', why: 'changes a version field' };
  if (TEST_NAME.test(name) || segs.some((s) => TEST_SEGMENTS.has(s))) return { reason: 'test', why: 'test file' };
  if (BUILD_NAME.test(name) || path.startsWith('.github/')) return { reason: 'build', why: 'build or CI file' };
  if (CODE_EXT.test(name)) return { reason: 'code', why: 'code file' };
  return { reason: 'outside-allowlist', why: 'outside the docs allowlist' };
}

export function isAgentInstructions(path: string): boolean {
  const name = basename(path);
  return AGENT_NAMES.has(name) || TEMPLATE_NAME.test(name) || segments(path).some((s) => AGENT_SEGMENTS.has(s));
}

export function isDefaultDocs(path: string): boolean {
  if (!path.includes('/')) return /\.(md|markdown)$/i.test(path);
  return path.startsWith('docs/') && (PROSE_EXT.test(path) || IMAGE_EXT.test(path));
}

export function classify(git: Git, from: string, to: string, list: Change[], config: DocsShipConfig): Classification {
  const optedIn = globMatcher(config.docs);
  const excluded = globMatcher(config.notDocs);
  const findings: ReleaseFinding[] = [];
  const files: FileResult[] = list.map((change): FileResult => {
    const { path, status } = change;
    const stop = (reason: Reason, why: string): FileResult => ({ path, status, kind: 'stop', reason, why });
    let cached: string[] | undefined;
    const lines = () => (cached ??= changedLines(hunks(git, from, to, path)));
    if ([change.oldMode, change.newMode].some((m) => m === '120000' || m === '160000')) return stop('special-file', 'symlink or submodule');
    if ((CONFIG_FILES as readonly string[]).includes(path) && lines().some(hasMarker)) return stop('classification-config', 'changes a docs-ship marker');
    if (excluded(path)) return stop('project-excluded', 'docs-ship:not-docs');
    if (basename(path) === 'VERSION') return stop('version', 'VERSION changed');
    if (path === CHANGELOG) return changelog(git, from, to, change, findings);
    if (optedIn(path)) return { path, status, kind: 'docs', why: 'docs-ship:docs' };
    if (isAgentInstructions(path)) return stop('agent-instructions', 'agent instructions are executable');
    if (isDefaultDocs(path)) return { path, status, kind: 'docs', why: 'default allowlist' };
    const c = stopCategory(path, lines);
    return stop(c.reason, c.why);
  });
  return { files, findings };
}
