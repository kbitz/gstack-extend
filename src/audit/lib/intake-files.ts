import { lstatSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

function entrySpelling(path: string): string {
  const name = basename(path);
  const entries = readdirSync(dirname(path));
  if (entries.includes(name)) return name;
  return entries.find(entry => entry.toLowerCase() === name) ?? name;
}

/** Preserve the legacy inbox when intake is absent. Require real directories
 * before enumerating intake below an existing path. */
export function inspectIntakeDirectory(path: string): { kind: 'absent' | 'directory' | 'invalid'; entryPath: string } {
  const parent = dirname(path);
  const parentStat = lstatSync(parent, { throwIfNoEntry: false });
  const realParent = parentStat?.isDirectory() === true;
  if (!realParent && !(parentStat?.isSymbolicLink() && statSync(parent, { throwIfNoEntry: false })?.isDirectory())) {
    return { kind: 'absent', entryPath: path };
  }
  const intakeStat = lstatSync(path, { throwIfNoEntry: false });
  if (!intakeStat) return { kind: 'absent', entryPath: path };
  // On case-insensitive filesystems, require the same spelling Git stores.
  const entryPath = join(dirname(parent), entrySpelling(parent), entrySpelling(path));
  const canonical = realParent && intakeStat.isDirectory() && entryPath === path;
  return { kind: canonical ? 'directory' : 'invalid', entryPath };
}
