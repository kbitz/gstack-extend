/**
 * planning-docs.ts — shared planning document resolution used by both the
 * roadmap audit and work-item ID migration.
 */

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function findDoc(repoRoot: string, name: string): string | null {
  const root = join(repoRoot, name);
  const docs = join(repoRoot, 'docs', name);
  // Pointer grammar is locked to docs/roadmap-{future,shipped}.md.
  // Prefer that path so a leftover root copy cannot hide the live file.
  const docsFirst = name === 'roadmap-future.md' || name === 'roadmap-shipped.md';
  const first = docsFirst ? docs : root;
  const second = docsFirst ? root : docs;
  if (existsSync(first) && statSync(first).isFile()) return first;
  if (existsSync(second) && statSync(second).isFile()) return second;
  return null;
}
