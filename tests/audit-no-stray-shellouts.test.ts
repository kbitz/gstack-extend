/**
 * audit-no-stray-shellouts.test.ts — D3 contract test.
 *
 * The git gateway in src/audit/lib/git.ts is the ONLY module under
 * src/audit/** allowed to spawn subprocesses. Every other file must consume
 * git data through the typed gateway so the spawn surface is auditable in
 * one place and tests can mock it cleanly.
 *
 * This test fails if any subprocess primitive appears outside
 * src/audit/lib/git.ts. It catches regressions where someone reaches for
 * Bun.$ inline because "it's just one little call."
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const FORBIDDEN = [
  'Bun.$',
  'Bun.spawn',
  'Bun.spawnSync',
  "from 'node:child_process'",
  'from "node:child_process"',
  "from 'child_process'",
  'from "child_process"',
  'execSync',
  'spawnSync',
];

const GATEWAY = 'src/audit/lib/git.ts';
const ROOT = join(import.meta.dir, '..');
const SRC_AUDIT = join(ROOT, 'src/audit');

function* walkTs(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walkTs(full);
    } else if (entry.endsWith('.ts')) {
      yield full;
    }
  }
}

describe('audit no-stray-shellouts contract (D3)', () => {
  test('every src/audit/**/*.ts except the gateway is shellout-free', () => {
    const violations: string[] = [];
    for (const file of walkTs(SRC_AUDIT)) {
      const rel = relative(ROOT, file);
      if (rel === GATEWAY) continue;
      const content = readFileSync(file, 'utf8');
      for (const needle of FORBIDDEN) {
        if (content.includes(needle)) {
          violations.push(`${rel}: contains forbidden token "${needle}"`);
        }
      }
    }
    if (violations.length > 0) {
      const msg = [
        'D3 contract violation: subprocess calls outside lib/git.ts.',
        'Add the call to lib/git.ts and consume via GitGateway, or whitelist',
        'this file by extending the audit gateway API.',
        '',
        ...violations,
      ].join('\n');
      throw new Error(msg);
    }
    expect(violations).toEqual([]);
  });
});
