#!/usr/bin/env bun
/**
 * sync-pregate-deps.ts — rewrite `.gstack/pregate.json` `dependencies` from
 * MANUAL_TOUCHFILES in tests/helpers/touchfiles.ts, so pregate's lane
 * selection and `bun run test` read the same non-import edges. Other keys are
 * kept, and so is a `glob: []` entry (pregate's "no lane needed", which the
 * map cannot express): repair a missing lane in MANUAL_TOUCHFILES, and
 * declare `[]` here. `--check` changes nothing and exits 1 when the file is
 * out of date; tests/touchfiles.test.ts makes the same comparison.
 *
 * Pregate reads the copy on the base branch, so a change here takes effect for
 * pregate after it merges; `bun run test` uses it at once.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { pregateDependencies } from '../tests/helpers/touchfiles.ts';

const REPO_ROOT = resolve(import.meta.dir, '..');
export const PREGATE_CONFIG = '.gstack/pregate.json';

/** The config text with `dependencies` regenerated. */
export function syncedPregateConfig(current: string): string {
  const config = JSON.parse(current) as Record<string, unknown>;
  const previous = (config.dependencies ?? {}) as Record<string, unknown>;
  const merged: Record<string, string[]> = { ...pregateDependencies() };
  for (const [glob, tests] of Object.entries(previous)) {
    if (Array.isArray(tests) && tests.length === 0 && !(glob in merged)) merged[glob] = [];
  }
  config.dependencies = Object.fromEntries(Object.keys(merged).sort().map(glob => [glob, merged[glob]]));
  return JSON.stringify(config, null, 2) + '\n';
}

if (import.meta.main) {
  const path = join(REPO_ROOT, PREGATE_CONFIG);
  const current = readFileSync(path, 'utf8');
  const next = syncedPregateConfig(current);
  if (process.argv.includes('--check')) {
    if (next !== current) {
      process.stderr.write(`${PREGATE_CONFIG} is out of date; run: bun scripts/sync-pregate-deps.ts\n`);
      process.exit(1);
    }
    process.exit(0);
  }
  if (next !== current) writeFileSync(path, next);
  process.stdout.write(`${PREGATE_CONFIG}: ${Object.keys(JSON.parse(next).dependencies).length} dependency globs\n`);
}
