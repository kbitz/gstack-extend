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
import { CONFIG_FILES, hasMarker, markersIn, type DocsShipConfig } from './config.ts';
import { hunks, readAt, resolvedPath, type Change, type Git, type Hunks } from './git.ts';

export const CHANGELOG = 'CHANGELOG.md';
const PROSE_EXT = /\.(md|markdown|rst|adoc|txt)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;
const AGENT_NAMES = new Set(['agents.md', 'claude.md', 'gemini.md', 'skill.md']);
const AGENT_SEGMENTS = new Set(['skills', 'prompts', 'templates', 'template']);
const TEMPLATE_NAME = /\.(tmpl|template)(\.[^/]+)?$/i;
const TEST_SEGMENTS = new Set(['tests', 'test', '__tests__', 'spec', 'specs']);
const TEST_NAME = /(\.(test|spec)\.[cm]?[jt]sx?$|^test_.*\.py$|_test\.(py|go)$|_spec\.rb$)/;
const BUILD_NAME = /^(package(-lock)?\.json|bun\.lockb?|yarn\.lock|pnpm-lock\.yaml|Cargo\.(toml|lock)|pyproject\.toml|setup\.(py|cfg)|requirements.*\.txt|poetry\.lock|go\.(mod|sum)|Gemfile(\.lock)?|.*\.gemspec|Makefile|Dockerfile|.*\.gradle(\.kts)?|pom\.xml|tsconfig.*\.json|composer\.(json|lock)|pubspec\.ya?ml|mix\.exs)$/;
const CODE_EXT = /\.([cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|pl|lua|scala|sql|ex|exs|vue|svelte)$/i;
const VERSION_FIELD = /(^|[^\w])(__version__|version)\s*["']?\s*[:=](?!=)/i;

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
const isBuild = (path: string) => BUILD_NAME.test(basename(path)) || path.startsWith('.github/');

/** Match YAML/TOML frontmatter fences without interpreting metadata values. */
function frontmatterBody(text: string): string {
  const opening = /^\uFEFF?(---|\+\+\+)[ \t]*\r?\n/.exec(text);
  if (!opening) return '';
  const rest = text.slice(opening[0].length);
  const closing = (opening[1] === '---' ? /^(---|\.\.\.)[ \t]*\r?$/m : /^\+\+\+[ \t]*\r?$/m).exec(rest);
  return closing ? rest.slice(0, closing.index).replace(/\r?\n$/, '') : '';
}

/** Version headings, including linked headings used by release generators. */
export function versionOf(heading: string): string | undefined {
  const m = /^\[?v?(\d+(?:\.\d+)+(?:-[\w.-]+)?(?:\+[\w.-]+)?)\]?(?:\([^)]*\))?(?:\s|$)/.exec(heading.trim());
  return m?.[1];
}

type Section = { title: string; version?: string };
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;

/** Release sections retain their nested non-version subheadings. */
function sectionsByLine(text: string): (Section | undefined)[] {
  const out: (Section | undefined)[] = [undefined];
  let current: Section | undefined;
  let level = 2;
  for (const line of text.split('\n')) {
    const h = HEADING.exec(line);
    if (h && (versionOf(h[2]!) || h[1]!.length <= level)) {
      current = { title: h[2]!, version: versionOf(h[2]!) };
      level = h[1]!.length;
    }
    out.push(current);
  }
  return out;
}

function versionHeadings(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of text.split('\n')) {
    const h = HEADING.exec(line);
    const version = h && versionOf(h[2]!);
    if (version) counts.set(version, (counts.get(version) ?? 0) + 1);
  }
  return counts;
}

function changelog(git: Git, from: string, to: string, change: Change, findings: ReleaseFinding[]): FileResult {
  const base: FileResult = { path: change.path, status: change.status, kind: 'docs', why: 'changelog' };
  if (change.status === 'D') return { ...base, kind: 'stop', reason: 'version', why: 'CHANGELOG.md deleted' };
  const before = readAt(git, from, change.path) ?? '';
  const after = readAt(git, to, change.path) ?? '';
  const released = versionHeadings(before);
  const added = [...versionHeadings(after)].filter(([v, count]) => count > (released.get(v) ?? 0)).map(([v]) => v);
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

function stopCategory(path: string): { reason: Reason; why: string } {
  const name = basename(path);
  const segs = segments(path);
  if (TEST_NAME.test(name) || segs.some((s) => TEST_SEGMENTS.has(s))) return { reason: 'test', why: 'test file' };
  if (isBuild(path)) return { reason: 'build', why: 'build or CI file' };
  if (CODE_EXT.test(name)) return { reason: 'code', why: 'code file' };
  return { reason: 'outside-allowlist', why: 'outside the docs allowlist' };
}

export function isAgentInstructions(path: string): boolean {
  const name = basename(path);
  return AGENT_NAMES.has(name.toLowerCase()) || TEMPLATE_NAME.test(name) || segments(path).some((s) => AGENT_SEGMENTS.has(s));
}

export function isDefaultDocs(path: string): boolean {
  if (!path.includes('/')) return /\.(md|markdown)$/i.test(path);
  return path.startsWith('docs/') && (PROSE_EXT.test(path) || IMAGE_EXT.test(path));
}

export function classify(git: Git, from: string, to: string, list: Change[], config: DocsShipConfig): Classification {
  const optedIn = globMatcher(config.docs);
  const excluded = globMatcher(config.notDocs);
  const findings: ReleaseFinding[] = [];
  const configPaths = new Set<string>([...CONFIG_FILES, ...config.sourcePaths]);
  for (const rev of [from, to]) for (const file of CONFIG_FILES) {
    const real = resolvedPath(git, rev, file);
    if (real) configPaths.add(real);
  }
  const files: FileResult[] = list.map((change): FileResult => {
    const { path, status } = change;
    const stop = (reason: Reason, why: string): FileResult => ({ path, status, kind: 'stop', reason, why });
    let cached: string[] | undefined;
    const lines = () => (cached ??= changedLines(hunks(git, from, to, path)));
    if ([change.oldMode, change.newMode].some((m) => m === '120000' || m === '160000')) return stop('special-file', 'symlink or submodule');
    if (configPaths.has(path)) {
      const active = (rev: string) => markersIn(readAt(git, rev, path) ?? '', `${rev}:${path}`).map(({ key, value }) => [key, value]);
      if (lines().some(hasMarker) || JSON.stringify(active(from)) !== JSON.stringify(active(to))) return stop('classification-config', 'changes a docs-ship marker');
    }
    if (excluded(path)) return stop('project-excluded', 'docs-ship:not-docs');
    if (basename(path) === 'VERSION') return stop('version', 'VERSION changed');
    if (path === CHANGELOG) return changelog(git, from, to, change, findings);
    // Prose examples are not release fields; Markdown frontmatter is metadata.
    let structuredJson = /\.json$/i.test(path);
    const versionFields = (rev: string) => {
      const text = readAt(git, rev, path) ?? '';
      if (/\.json$/i.test(path)) {
        try {
          const fields: string[] = [];
          const visit = (value: unknown, keys: string[]) => {
            if (!value || typeof value !== 'object') return;
            for (const [key, child] of Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
              const at = [...keys, key];
              if (VERSION_FIELD.test(`${key}:`)) fields.push(JSON.stringify([at, child]));
              visit(child, at);
            }
          };
          visit(JSON.parse(text.replace(/^\uFEFF/, '')), []);
          return fields;
        } catch {
          structuredJson = false;
          // Parent paths cannot be established in invalid JSON. Conservatively
          // bind all its text when a version field is present.
          return VERSION_FIELD.test(text) ? [text] : [];
        }
      }
      const body = PROSE_EXT.test(path) ? frontmatterBody(text) : text;
      const fields: string[] = [];
      let fieldIndent: number | undefined;
      let multilineQuote: string | undefined;
      let bracketDepth = 0;
      const syntax = (line: string) => line.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/.*|#.*|\/\*.*?\*\//g, '');
      const brackets = (line: string) => [...syntax(line)]
        .reduce((n, c) => n + ('([{'.includes(c) ? 1 : ')]}'.includes(c) ? -1 : 0), 0);
      for (const line of body.split('\n')) {
        const indent = /^\s*/.exec(line)![0].length;
        if (multilineQuote) {
          fields.push(line);
          if (line.includes(multilineQuote)) multilineQuote = undefined;
          continue;
        }
        if (bracketDepth > 0) {
          fields.push(line);
          bracketDepth += brackets(line);
          continue;
        }
        const version = VERSION_FIELD.exec(line);
        const prefix = version ? line.slice(0, version.index + version[1]!.length) : '';
        // Distinguish parameter types from named arguments and object fields in
        // calls. This is lexical: ambiguous signatures can conservatively stop.
        const callValue = (version?.[0].endsWith('=') || brackets(syntax(prefix).replace(/[^{}]/g, '')) > 0 || /:\s*[(\[{`'"]?\s*$/.test(syntax(line)))
          && !/\b(?:def|function|func|fn|fun)\s/.test(syntax(prefix));
        const assignment = !CODE_EXT.test(path) || brackets(prefix.replace(/[{}\[\]]/g, '')) <= 0 || callValue;
        if (version && assignment) fieldIndent = indent;
        else if (fieldIndent !== undefined && indent <= fieldIndent
          && (CODE_EXT.test(path) ? line.trim() !== '' : /^\s*["']?[\w.-]+["']?\s*[:=]/.test(line))) fieldIndent = undefined;
        // Include multiline YAML values (and TOML string continuations), not
        // merely the key line. The next sibling field ends the value.
        if (fieldIndent !== undefined) {
          fields.push(line);
          const delimiter = (CODE_EXT.test(path) ? /("""|'''|`)/ : /("""|''')/).exec(line)?.[1];
          if (delimiter && line.split(delimiter).length % 2 === 0) multilineQuote = delimiter;
          else bracketDepth = Math.max(0, brackets(line));
        }
      }
      return fields;
    };
    const versionChanged = !IMAGE_EXT.test(path)
      && (JSON.stringify(versionFields(from)) !== JSON.stringify(versionFields(to))
        || (!PROSE_EXT.test(path) && !structuredJson && lines().some((line) => VERSION_FIELD.test(line))));
    if (versionChanged) return stop('version', 'changes a version field');
    if (optedIn(path)) return { path, status, kind: 'docs', why: 'docs-ship:docs' };
    if (isAgentInstructions(path)) return stop('agent-instructions', 'agent instructions are executable');
    if (isBuild(path)) return stop('build', 'build or CI file');
    if (isDefaultDocs(path)) return { path, status, kind: 'docs', why: 'default allowlist' };
    const c = stopCategory(path);
    return stop(c.reason, c.why);
  });
  return { files, findings };
}
