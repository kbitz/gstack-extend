/**
 * renumber-cli.ts — `bin/roadmap-renumber` entry.
 *
 *   --map old=new,old=new     atomic rewrite across docs
 *   --map-file <path>         one old=new per line (# comments ok)
 *   --dry-run                 print the plan, write nothing
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  applyRenames,
  formatRenamesList,
  parseMapArg,
  parseMapFile,
  type RenameMap,
} from './lib/renumber.ts';

function takeFlagValue(argv: string[], flag: string): string | null {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  return argv[i + 1] ?? null;
}

function repoRootFromArgv(argv: string[]): string {
  const skipVal = new Set<string>();
  for (const flag of ['--map', '--map-file']) {
    const i = argv.indexOf(flag);
    if (i >= 0 && argv[i + 1] !== undefined) skipVal.add(argv[i + 1]!);
  }
  const rest = argv.filter((a) => {
    if (a.startsWith('--')) return false;
    if (skipVal.has(a)) return false;
    return true;
  });
  return rest[0] ?? process.cwd();
}

function walkMd(dir: string, out: string[]): void {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return;
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkMd(p, out);
    else if (name.endsWith('.md')) out.push(p);
  }
}

export function defaultSweepFiles(repoRoot: string): string[] {
  const files: string[] = [];
  const seen = new Set<string>();
  const add = (p: string) => {
    if (!existsSync(p) || !statSync(p).isFile()) return;
    if (seen.has(p)) return;
    seen.add(p);
    files.push(p);
  };
  for (const name of ['ROADMAP.md', 'TODOS.md', 'PROGRESS.md', 'CLAUDE.md']) {
    add(join(repoRoot, name));
    add(join(repoRoot, 'docs', name));
  }
  add(join(repoRoot, 'docs', 'roadmap-shipped.md'));
  walkMd(join(repoRoot, 'docs', 'designs'), files);
  walkMd(join(repoRoot, 'docs', 'archive'), files);
  return files;
}

export function runRenumberCli(argv: string[]): { ok: boolean; text: string } {
  const mapArg = takeFlagValue(argv, '--map');
  const mapFile = takeFlagValue(argv, '--map-file');
  const dryRun = argv.includes('--dry-run');
  if ((mapArg === null && mapFile === null) || (mapArg !== null && mapFile !== null)) {
    return {
      ok: false,
      text: 'usage: roadmap-renumber --map old=new[,old=new...] [--dry-run] [repo]\n       roadmap-renumber --map-file <path> [--dry-run] [repo]\n',
    };
  }
  let map: RenameMap;
  try {
    map = mapFile !== null ? parseMapFile(readFileSync(mapFile, 'utf8')) : parseMapArg(mapArg!);
  } catch (e) {
    return { ok: false, text: `MAP: fail\n${e instanceof Error ? e.message : String(e)}\n` };
  }

  const repoRoot = repoRootFromArgv(argv);
  const files = defaultSweepFiles(repoRoot);
  const lines: string[] = [formatRenamesList(map)];
  let filesTouched = 0;
  let replacements = 0;
  const skipped: string[] = [];

  for (const path of files) {
    const before = readFileSync(path, 'utf8');
    const result = applyRenames(before, map);
    const rel = relative(repoRoot, path) || path;
    for (const s of result.skippedHistorical) {
      skipped.push(`- ${rel}:${s.id} (${s.snippet})`);
    }
    if (result.replaced === 0) continue;
    filesTouched++;
    replacements += result.replaced;
    if (!dryRun) writeFileSync(path, result.text);
    lines.push(`${dryRun ? 'WOULD_WRITE' : 'WROTE'}: ${rel} (${result.replaced})`);
  }

  lines.push(
    `${dryRun ? 'DRY_RUN' : 'WROTE'}: ${filesTouched} files (${replacements} replacements)`,
  );
  if (skipped.length > 0) {
    lines.push(`SKIPPED_HISTORICAL: ${skipped.length}`);
    lines.push(...skipped);
  } else {
    lines.push('SKIPPED_HISTORICAL: 0');
  }
  return { ok: true, text: lines.join('\n') + '\n' };
}

if (import.meta.main) {
  const r = runRenumberCli(process.argv.slice(2));
  process.stdout.write(r.text);
  process.exit(r.ok ? 0 : 1);
}
