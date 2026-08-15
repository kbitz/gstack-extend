/**
 * touches-cli.ts — `bin/roadmap-touches` entry.
 *
 *   drift --track <id>   hard-fail if committed/staged/unstaged/untracked
 *                        paths are not covered by `_touches:_`
 *   report-cross-group   print soft overlaps across Groups
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { createGitGateway } from './lib/git.ts';
import { isSharedDoc, normalizeTouch, schedulingTouches } from './lib/pack.ts';
import { mergeShippedArchive, parseRoadmap, type TrackInfo } from './parsers/roadmap.ts';

function findDoc(repoRoot: string, name: string): string | null {
  const root = join(repoRoot, name);
  if (existsSync(root) && statSync(root).isFile()) return root;
  const docs = join(repoRoot, 'docs', name);
  if (existsSync(docs) && statSync(docs).isFile()) return docs;
  return null;
}

function readMaybe(path: string | null): string {
  if (path === null || !existsSync(path)) return '';
  return readFileSync(path, 'utf8');
}

function parseRoadmaps(repoRoot: string) {
  let parsed = parseRoadmap(readMaybe(findDoc(repoRoot, 'ROADMAP.md')));
  const archive = findDoc(repoRoot, 'roadmap-shipped.md');
  if (archive !== null) parsed = mergeShippedArchive(parsed, parseRoadmap(readMaybe(archive)));
  return parsed.value;
}

function covers(declared: string[], path: string): boolean {
  if (isSharedDoc(path)) return true;
  const n = normalizeTouch(path);
  for (const d of schedulingTouches(declared)) {
    if (d.path === n.path) return true;
    if (d.dir && n.path.startsWith(d.path)) return true;
    if (n.dir && d.path.startsWith(n.path)) return true;
  }
  return false;
}

const DEFAULT_BASE_REFS = ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master'];

function driftPaths(repoRoot: string): { ok: boolean; paths: string[] } {
  const git = createGitGateway({ cwd: repoRoot });
  if (git.toplevel() === null) return { ok: false, paths: [] };
  let base: string | null = null;
  for (const ref of DEFAULT_BASE_REFS) {
    base = git.mergeBase(ref);
    if (base !== null) break;
  }
  const committed = base !== null ? git.diffNamesBetween(base, 'HEAD') : [];
  const dirty = git.workingTreePaths();
  const paths = [...new Set([...committed, ...dirty])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { ok: true, paths };
}

export function runDrift(repoRoot: string, trackId: string): { ok: boolean; text: string } {
  const rm = parseRoadmaps(repoRoot);
  const track = rm.tracks.find((t) => t.id === trackId);
  if (track === undefined) {
    return { ok: false, text: `TRACK_NOT_FOUND: ${trackId}\n` };
  }
  const changed = driftPaths(repoRoot);
  if (!changed.ok) {
    return { ok: false, text: `DRIFT: fail\nTRACK: ${trackId}\nNOT_A_REPO: ${repoRoot}\n` };
  }
  const undeclared: string[] = [];
  for (const p of changed.paths) {
    if (!covers(track.touches, p)) undeclared.push(p);
  }
  if (undeclared.length === 0) {
    return { ok: true, text: `DRIFT: pass\nTRACK: ${trackId}\nUNDECLARED: (none)\n` };
  }
  return {
    ok: false,
    text:
      `DRIFT: fail\nTRACK: ${trackId}\nUNDECLARED:\n` +
      undeclared.map((p) => `- ${p}`).join('\n') +
      '\n',
  };
}

export function runReportCrossGroup(repoRoot: string): string {
  const rm = parseRoadmaps(repoRoot);
  const live = rm.tracks.filter((t) => t.state !== 'shipped' && !t.legacy);
  const byGroup = new Map<string, TrackInfo[]>();
  for (const t of live) {
    const arr = byGroup.get(t.groupNum) ?? [];
    arr.push(t);
    byGroup.set(t.groupNum, arr);
  }
  const groups = [...byGroup.keys()].sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
  const lines = ['CROSS_GROUP:'];
  let any = false;
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const ga = byGroup.get(groups[i]!) ?? [];
      const gb = byGroup.get(groups[j]!) ?? [];
      for (const a of ga) {
        for (const b of gb) {
          const hits: string[] = [];
          for (const ta of a.touches) {
            if (covers(b.touches, normalizeTouch(ta).path)) {
              const p = normalizeTouch(ta).path;
              if (!isSharedDoc(p)) hits.push(p);
            }
          }
          if (hits.length > 0) {
            any = true;
            lines.push(`- ${a.id} ∥ ${b.id}: ${[...new Set(hits)].join(',')}`);
          }
        }
      }
    }
  }
  if (!any) lines.push('- (none)');
  return lines.join('\n') + '\n';
}

export function runTouchesCli(argv: string[]): { ok: boolean; text: string } {
  const ti = argv.indexOf('--track');
  const trackId = ti >= 0 ? (argv[ti + 1] ?? '') : '';
  const skip = new Set<number>();
  if (ti >= 0) {
    skip.add(ti);
    if (ti + 1 < argv.length) skip.add(ti + 1);
  }
  const repoRoot =
    argv.find(
      (a, i) => !skip.has(i) && !a.startsWith('--') && a !== 'drift' && a !== 'report-cross-group',
    ) ?? process.cwd();
  if (argv.includes('report-cross-group')) {
    return { ok: true, text: runReportCrossGroup(repoRoot) };
  }
  if (trackId === '') {
    return { ok: false, text: 'usage: roadmap-touches drift --track <id> [repo]\n' };
  }
  return runDrift(repoRoot, trackId);
}

if (import.meta.main) {
  const r = runTouchesCli(process.argv.slice(2));
  process.stdout.write(r.text);
  process.exit(r.ok ? 0 : 1);
}
