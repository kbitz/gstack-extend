/**
 * config.ts — a project's docs-ship settings: HTML comment markers in the
 * base tip's AGENTS.md / CLAUDE.md, like `<!-- roadmap:parallelism_cap=N -->`.
 *
 *   <!-- docs-ship:docs=AGENTS.md,runbooks/** -->           opt paths in as docs
 *   <!-- docs-ship:not-docs=docs/templates/** -->           extra exclusions
 *   <!-- docs-ship:tests=tests/test_docs.py -->             always-run doc tests
 *   <!-- docs-ship:rules=docs/writing-rules.md -->          rules file to check
 *   <!-- docs-ship:test-command=python3 -m pytest {tests} --> runner template
 *
 * Markers inside fenced blocks or inline code are examples, not settings.
 */
import { GateError } from '../merge-gate/errors.ts';
import { assertGlob } from '../merge-gate/glob.ts';
import { readAt, Refusal, resolvedPath, type Git } from './git.ts';
import { fencedLines, maskInlineCode } from './markdown.ts';

export const CONFIG_FILES = ['AGENTS.md', 'CLAUDE.md'] as const;
const LIST_KEYS = ['docs', 'not-docs', 'tests'] as const;
const SCALAR_KEYS = ['rules', 'test-command'] as const;
export const MARKER_KEYS = [...LIST_KEYS, ...SCALAR_KEYS];

export type DocsShipConfig = {
  docs: string[];
  notDocs: string[];
  tests: string[];
  rules?: string;
  testCommand?: string;
  /** Files the markers came from (symlinked duplicates once). */
  sources: string[];
  /** Resolved instruction paths at the base tip, even when no marker is active. */
  sourcePaths: string[];
};

export type Marker = { key: string; value: string; line: number };

const MARKER = /<!--\s*docs-ship:([a-z-]+)=(.*?)\s*-->/g;

/** True when a line carries a docs-ship marker outside inline code. */
export function hasMarker(line: string): boolean {
  return new RegExp(MARKER.source).test(maskInlineCode(line));
}

export function markersIn(text: string): Marker[] {
  const fenced = fencedLines(text);
  const out: Marker[] = [];
  text.split('\n').forEach((line, i) => {
    if (fenced.has(i + 1)) return;
    for (const m of maskInlineCode(line).matchAll(MARKER)) out.push({ key: m[1]!, value: m[2]!.trim(), line: i + 1 });
  });
  return out;
}

function invalid(source: string, marker: Marker, why: string): never {
  throw new Refusal('CONFIG_INVALID', `${source}:${marker.line}: docs-ship:${marker.key} ${why}`, 'fix the marker on the base branch (see docs/docs-ship.md#configuration)');
}

export function readConfig(git: Git, rev: string): DocsShipConfig {
  const config: DocsShipConfig = { docs: [], notDocs: [], tests: [], sources: [], sourcePaths: [] };
  const read = new Set<string>();
  for (const file of CONFIG_FILES) {
    const real = resolvedPath(git, rev, file);
    if (real === undefined || read.has(real)) continue;
    read.add(real);
    config.sourcePaths.push(real);
    const text = readAt(git, rev, file);
    if (text === undefined) continue;
    const markers = markersIn(text);
    if (markers.length) config.sources.push(file);
    for (const marker of markers) {
      if ((LIST_KEYS as readonly string[]).includes(marker.key)) {
        const values = marker.value.split(',').map((v) => v.trim()).filter(Boolean);
        if (values.length === 0) invalid(file, marker, 'has no values');
        for (const v of values) {
          try {
            assertGlob(v, `docs-ship:${marker.key}`);
          } catch (error) {
            if (error instanceof GateError) invalid(file, marker, `value ${v} uses brackets or braces; use * and ** only`);
            throw error;
          }
        }
        const list = marker.key === 'docs' ? config.docs : marker.key === 'not-docs' ? config.notDocs : config.tests;
        for (const v of values) if (!list.includes(v)) list.push(v);
      } else if ((SCALAR_KEYS as readonly string[]).includes(marker.key)) {
        if (marker.value === '') invalid(file, marker, 'is empty');
        if (marker.key === 'test-command' && !marker.value.includes('{tests}')) invalid(file, marker, 'must contain {tests}');
        const prop = marker.key === 'rules' ? 'rules' : 'testCommand';
        if (config[prop] !== undefined && config[prop] !== marker.value) invalid(file, marker, `conflicts with an earlier value (${config[prop]})`);
        config[prop] = marker.value;
      } else {
        invalid(file, marker, `is not a known key (use ${[...LIST_KEYS, ...SCALAR_KEYS].join(', ')})`);
      }
    }
  }
  return config;
}

export function describeConfig(config: DocsShipConfig): string {
  if (config.sources.length === 0) return 'defaults (no docs-ship markers)';
  const parts = [`markers from ${config.sources.join(', ')}`];
  if (config.docs.length) parts.push(`docs=${config.docs.join(',')}`);
  if (config.notDocs.length) parts.push(`not-docs=${config.notDocs.join(',')}`);
  if (config.tests.length) parts.push(`tests=${config.tests.join(',')}`);
  if (config.rules) parts.push(`rules=${config.rules}`);
  if (config.testCommand) parts.push(`test-command=${config.testCommand}`);
  return parts.join('; ');
}
