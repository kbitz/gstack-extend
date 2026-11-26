import { lstatSync, readdirSync, statSync, type Stats } from 'node:fs';
import { basename, dirname, join } from 'node:path';

function entrySpelling(path: string, stat: Stats): string | undefined {
  const name = basename(path);
  const parent = dirname(path);
  const entries = readdirSync(parent);
  if (entries.includes(name)) return name;
  // The filesystem already resolved this spelling. Match the entry it resolved
  // to rather than approximating its case or normalization rules in JavaScript.
  return entries.find(entry => {
    const seen = lstatSync(join(parent, entry), { throwIfNoEntry: false });
    return seen?.dev === stat.dev && seen.ino === stat.ino;
  });
}

/** Preserve the legacy inbox when intake is absent. Require real directories
 * before enumerating intake below an existing path. */
export function inspectIntakeDirectory(path: string): { kind: 'absent' | 'directory' | 'invalid'; entryPath: string } {
  const parent = dirname(path);
  const parentStat = lstatSync(parent, { throwIfNoEntry: false });
  if (!parentStat) return { kind: 'absent', entryPath: path };
  const realParent = parentStat.isDirectory();
  if (!realParent && !(parentStat.isSymbolicLink() && statSync(parent, { throwIfNoEntry: false })?.isDirectory())) {
    return { kind: 'absent', entryPath: path };
  }
  const intakeStat = lstatSync(path, { throwIfNoEntry: false });
  if (!intakeStat) return { kind: 'absent', entryPath: path };
  // On case-insensitive filesystems, require the same spelling Git stores.
  const parentName = entrySpelling(parent, parentStat);
  const intakeName = entrySpelling(path, intakeStat);
  const entryPath = join(dirname(parent), parentName ?? basename(parent), intakeName ?? basename(path));
  const canonical = realParent && intakeStat.isDirectory() && parentName === basename(parent) && intakeName === basename(path);
  return { kind: canonical ? 'directory' : 'invalid', entryPath };
}
