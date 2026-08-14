/**
 * touches-cli.ts — `bin/roadmap-touches` entry.
 *
 *   drift --track <id>   hard-fail if the working tree touches a path
 *                        no `_touches:_` entry covers
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

function gitPaths(repoRoot: string): string[] {
  return createGitGateway({ cwd: repoRoot }).workingTreePaths();
}

export function runDrift(repoRoot: string, trackId: string): { ok: boolean; text: string } {
  const rm = parseRoadmaps(repoRoot);
  const track = rm.tracks.find((t) => t.id === trackId);
  if (track === undefined) {
    return { ok: false, text: `TRACK_NOT_FOUND: ${trackId}\n` };
  }
  const changed = gitPaths(repoRoot);
  const undeclared: string[] = [];
  for (const p of changed) {
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
  const repoRoot = argv.find((a) => !a.startsWith('--') && a !== 'drift' && a !== 'report-cross-group')
    ?? process.cwd();
  if (argv.includes('report-cross-group')) {
    return { ok: true, text: runReportCrossGroup(repoRoot) };
  }
  const ti = argv.indexOf('--track');
  const trackId = ti >= 0 ? (argv[ti + 1] ?? '') : '';
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
