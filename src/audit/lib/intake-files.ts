import { lstatSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname } from 'node:path';

/** Preserve the legacy inbox when intake is absent. Require real directories
 * before enumerating intake below an existing path. */
export function intakeDirectoryKind(path: string): 'absent' | 'directory' | 'invalid' {
  const parent = dirname(path);
  const parentStat = lstatSync(parent, { throwIfNoEntry: false });
  const realParent = parentStat?.isDirectory() === true;
  if (!realParent && !(parentStat?.isSymbolicLink() && statSync(parent, { throwIfNoEntry: false })?.isDirectory())) {
    return 'absent';
  }
  const intakeStat = lstatSync(path, { throwIfNoEntry: false });
  if (!intakeStat) return 'absent';
  // On case-insensitive filesystems, require the same spelling Git stores.
  if (!readdirSync(dirname(parent)).includes(basename(parent)) || !readdirSync(parent).includes(basename(path))) {
    return 'absent';
  }
  return realParent && intakeStat.isDirectory() ? 'directory' : 'invalid';
}
