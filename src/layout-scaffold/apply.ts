import { constants } from 'node:fs';
import { basename, join } from 'node:path';
import { inventory, type GitGateway } from './git.ts';
import { bothExist, identity, type Audit, type Plan } from './plan.ts';
import { CANONICAL_DIRS } from './preflight.ts';
import { entry, errno, escapeValue, sameSpelling, type FileSystem } from './root.ts';

export type ApplyResult = { status: 'applied' | 'partial' | 'incomplete'; lines: string[]; exitCode: 0 | 4 };
const COPY_FALLBACK = new Set(['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EMLINK']);

export function apply(plan: Plan, fs: FileSystem, git: GitGateway, audit: Audit, onMutation: () => void = () => {}): ApplyResult {
  const operations = [
    ...plan.directories.filter(dir => !dir.exists).map(dir => ({ kind: 'directory' as const, dir, label: `mkdir ${dir.requested}` })),
    ...plan.moves.map(move => ({ kind: 'move' as const, move, label: `${move.tracking === 'tracked' ? 'git mv' : 'move'} ${move.source} → ${move.destination}` })),
  ];
  const completed: string[] = [];
  const notes: string[] = [];
  let staged = 0;
  let unstaged = 0;
  let attempted = false;
  const markMutation = () => { attempted = true; onMutation(); };
  const summary = (failed: string[], pending: string[]) => [
    'Apply summary:', 'Completed:', ...(completed.length ? completed.map(line => `- ${escapeValue(line)}`) : ['- (none)']),
    'Failed:', ...(failed.length ? failed.map(line => `- ${escapeValue(line)}`) : ['- (none)']),
    'Not attempted:', ...(pending.length ? pending.map(line => `- ${escapeValue(line)}`) : ['- (none)']),
    `Staged moves: ${staged}; unstaged moves: ${unstaged}`,
    ...notes.map(note => `Note: ${escapeValue(note)}`),
    ...(plan.external.some(pair => pair.write) ? ['Authorized external:', ...plan.external.filter(pair => pair.write)
      .map(pair => `- ${escapeValue(pair.requested)} → ${escapeValue(pair.resolved)}`)] : []),
  ];
  for (let n = 0; n < operations.length; n++) {
    const operation = operations[n]!;
    let label = operation.label;
    try {
      if (operation.kind === 'directory') {
        try { markMutation(); fs.mkdirSync(operation.dir.resolved); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !fs.lstatSync(operation.dir.resolved).isDirectory()) throw error;
        }
      } else {
        const move = operation.move;
        const source = join(plan.root.path, move.source);
        const destination = join(move.resolvedParent!, basename(move.destination));
        if (move.tracking === 'tracked') {
          markMutation();
          const result = git.run(['mv', '--', move.source, move.destination], plan.root.path, true);
          let indexed = false;
          let indexDetail = '';
          try {
            const index = inventory(git, plan.root.path);
            indexed = index.some(item => sameSpelling(item.path, move.destination, plan.root.precompose) && item.stage === 0)
              && !index.some(item => sameSpelling(item.path, move.source, plan.root.precompose));
          } catch (error) { indexDetail = errno(error); }
          const renamed = entry(destination, fs)?.isFile() === true && entry(source, fs) === null;
          if (result.status !== 0 || !renamed || !indexed) {
            throw new Error(`git mv exit ${result.status}; working-tree rename ${renamed ? 'happened' : 'incomplete'}; index update ${indexed ? 'happened' : 'incomplete'}; ${result.stderr || indexDetail}; inspect git status and reconcile the working tree and index by hand, then run plan`);
          }
          staged++;
        } else {
          const before = fs.statSync(source);
          try { markMutation(); fs.linkSync(source, destination); }
          catch (error) {
            if (!COPY_FALLBACK.has((error as NodeJS.ErrnoException).code ?? '')) throw error;
            // Copy exclusively; a raced EEXIST belongs to someone else and is never removed.
            const absentBeforeCopy = entry(destination, fs) === null;
            try { fs.copyFileSync(source, destination, constants.COPYFILE_EXCL); }
            catch (copyError) {
              if (absentBeforeCopy && (copyError as NodeJS.ErrnoException).code !== 'EEXIST' && entry(destination, fs)) {
                try { fs.unlinkSync(destination); notes.push(`removed exclusively created partial copy ${move.destination}; source untouched`); }
                catch (cleanupError) { notes.push(`partial copy ${move.destination} remains: ${errno(cleanupError)}; source untouched`); }
              }
              throw copyError;
            }
            label = `copy ${move.source} → ${move.destination}`;
            try { fs.utimesSync(destination, before.atime, before.mtime); }
            catch (mtimeError) { notes.push(`mtime not preserved for ${move.destination}: ${errno(mtimeError)}`); }
          }
          try { fs.unlinkSync(source); }
          catch (error) {
            throw new Error(`both paths present after unlink error: ${errno(error)}; compare ${move.source} and ${move.destination}, keep one by hand, run plan again`);
          }
          unstaged++;
        }
      }
      completed.push(label);
    } catch (error) {
      if (!attempted) throw error;
      return { status: 'partial', exitCode: 4, lines: [
        ...summary([`${label}: ${errno(error)}`], operations.slice(n + 1).map(item => item.label)),
        'Next: run plan for the remaining work; rmdir empty directories to undo',
      ] };
    }
  }
  const unexpected: string[] = [];
  try {
    if (plan.scaffoldOnly) {
      for (const path of CANONICAL_DIRS) {
        const approved = plan.directories.find(dir => dir.requested === path)!;
        if (!fs.statSync(join(plan.root.path, path)).isDirectory() || fs.realpathSync(join(plan.root.path, path)) !== approved.resolved) {
          unexpected.push(`${path}: canonical directory differs from its approved resolved target`);
        }
      }
    } else {
      const snapshot = audit(plan.root.path);
      const allowed = new Set([...plan.blocked, ...plan.excluded].map(identity));
      for (const finding of [...snapshot.moves, ...bothExist(snapshot, plan.root.path, fs)]) {
        if (!allowed.has(identity(finding))) unexpected.push(`${finding.check}: ${finding.source}${finding.destination ? ` → ${finding.destination}` : ''}`);
      }
      for (const dir of snapshot.unreadableDirs) if (!plan.unreadableDirs.includes(dir)) unexpected.push(`Not scanned: ${dir}`);
    }
  } catch (error) { unexpected.push(`post-apply check failed: ${errno(error)}`); }
  if (unexpected.length) return { status: 'incomplete', exitCode: 4, lines: [
    ...summary([], []), 'Unexpected findings:', ...unexpected.map(line => `- ${escapeValue(line)}`), 'Next: run plan again',
  ] };
  return { status: 'applied', exitCode: 0, lines: [...summary([], []),
    plan.blocked.length || plan.excluded.length || plan.unreadableDirs.length
      ? 'Next: review the Blocked, Excluded and Not scanned items by hand; run plan again'
      : 'Next: review the staged and unstaged changes',
  ] };
}
