/**
 * pack-cli.ts — `bin/roadmap-pack` entry.
 *
 * Reads ROADMAP.md (+ optional roadmap-shipped.md), prints packer bins.
 * `--materialize` prints the old implicit previous-Group edges so a
 * one-time regen can write them explicitly before unspecified=none.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { formatPackOutput, packTracks } from './lib/pack.ts';
import { tracksForPacker } from './checks/packing.ts';
import { mergeShippedArchive, parseRoadmap } from './parsers/roadmap.ts';
import type { AuditCtx } from './types.ts';

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

function repoRootFromArgv(argv: string[]): string {
  const rest = argv.filter((a) => !a.startsWith('--'));
  return rest[0] ?? process.cwd();
}

export function runPackCli(argv: string[]): string {
  const repoRoot = repoRootFromArgv(argv);
  const materialize = argv.includes('--materialize');
  const roadmapPath = findDoc(repoRoot, 'ROADMAP.md');
  let parsed = parseRoadmap(readMaybe(roadmapPath));
  const archive = findDoc(repoRoot, 'roadmap-shipped.md');
  if (archive !== null) parsed = mergeShippedArchive(parsed, parseRoadmap(readMaybe(archive)));

  if (materialize) {
    // Walk numeric order and emit old implicit edges for unspecified groups.
    const groups = [...parsed.value.groups].sort(
      (a, b) => Number.parseInt(a.num, 10) - Number.parseInt(b.num, 10),
    );
    const lines = ['MATERIALIZE (old implicit previous-Group edges):'];
    let prev: string | null = null;
    let any = false;
    for (const g of groups) {
      if (g.deps.kind === 'unspecified' && prev !== null) {
        lines.push(`- Group ${g.num}: write \`_Depends on: Group ${prev}_\` if this edge is still wanted`);
        any = true;
      }
      prev = g.num;
    }
    if (!any) lines.push('- (none — every Group already has an explicit annotation or is first)');
    return lines.join('\n') + '\n';
  }

  const ctx = { roadmap: parsed } as AuditCtx;
  const packed = packTracks(tracksForPacker(ctx));
  return formatPackOutput(packed);
}

if (import.meta.main) {
  process.stdout.write(runPackCli(process.argv.slice(2)));
}
