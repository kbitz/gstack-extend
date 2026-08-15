/**
 * pack-cli.ts — `bin/roadmap-pack` entry.
 *
 * Reads ROADMAP.md (+ optional roadmap-shipped.md), prints packer bins.
 * `--from <path>` / `--stdin` pack a draft without touching the live file.
 * `--materialize` prints implicit previous-Group edges (v3 one-time) AND
 * the packer's ready-to-paste `_Depends on:` lines for the current bins.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { fillCap, formatPackOutput, packTracks } from './lib/pack.ts';
import { tracksForPacker } from './checks/packing.ts';
import { parallelismCap } from './lib/parallelism-cap.ts';
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

function takeFlagValue(argv: string[], flag: string): string | null {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  return argv[i + 1] ?? null;
}

function repoRootFromArgv(argv: string[]): string {
  const rest = argv.filter((a, i) => {
    if (a.startsWith('--')) return false;
    if (i > 0 && (argv[i - 1] === '--from' || argv[i - 1] === '--stdin')) return false;
    return true;
  });
  return rest[0] ?? process.cwd();
}

export function runPackCli(argv: string[], stdinText?: string): string {
  const repoRoot = repoRootFromArgv(argv);
  const materialize = argv.includes('--materialize');
  const fromPath = takeFlagValue(argv, '--from');
  const useStdin = argv.includes('--stdin');

  let draft = '';
  if (useStdin) {
    draft = stdinText ?? readFileSync(0, 'utf8');
  } else if (fromPath !== null) {
    draft = readMaybe(fromPath);
  }

  const roadmapPath = findDoc(repoRoot, 'ROADMAP.md');
  const live = draft !== '' ? draft : readMaybe(roadmapPath);
  let parsed = parseRoadmap(live);
  if (draft === '') {
    const archive = findDoc(repoRoot, 'roadmap-shipped.md');
    if (archive !== null) parsed = mergeShippedArchive(parsed, parseRoadmap(readMaybe(archive)));
  }

  if (materialize) {
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
    lines.push('');
    const claude =
      readMaybe(join(repoRoot, 'CLAUDE.md')) || readMaybe(join(repoRoot, 'docs', 'CLAUDE.md'));
    const ctx = { roadmap: parsed, parallelismCap: parallelismCap(claude) } as AuditCtx;
    const cap = fillCap(ctx.parallelismCap);
    const packed = packTracks(tracksForPacker(ctx), { target: cap, maxPerBin: cap });
    lines.push(formatPackOutput(packed).trimEnd());
    return lines.join('\n') + '\n';
  }

  const claude =
    readMaybe(join(repoRoot, 'CLAUDE.md')) || readMaybe(join(repoRoot, 'docs', 'CLAUDE.md'));
  const cap = fillCap(parallelismCap(claude));
  const ctx = { roadmap: parsed, parallelismCap: cap } as AuditCtx;
  const input = tracksForPacker(ctx);
  const packed = packTracks(input, { target: cap, maxPerBin: cap });
  const headingCount = (live.match(/^#{3,5} Track /gm) ?? []).length;
  let emptyHint = 'no unshipped Tracks';
  if (input.length === 0 && headingCount > 0) {
    emptyHint = `parsed 0 unshipped Tracks; file still has ${headingCount} Track heading(s) — check ✓ Shipped / Hotfix / _touches:`;
  }
  return formatPackOutput(packed, { emptyHint });
}

if (import.meta.main) {
  process.stdout.write(runPackCli(process.argv.slice(2)));
}
