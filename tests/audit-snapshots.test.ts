/**
 * audit-snapshots.test.ts — snapshot diff suite for bin/roadmap-audit.
 *
 * Each fixture in tests/roadmap-audit/ is a directory:
 *
 *   <name>/
 *     files/        files copied into a fresh git repo before audit runs
 *     args          (optional) extra args to roadmap-audit, word-split
 *     expected.txt  canonical audit stdout (path-normalized to <TMPDIR>)
 *
 * The runner copies `files/` into a tmpdir, runs `bin/roadmap-audit [args]`,
 * normalizes the tmpdir path in the output, and diffs against `expected.txt`.
 *
 * Beyond stdout parity, asserts stderr is empty (D13 cross-model: CLI
 * contract gap surfaced by codex; the audit emits nothing to stderr by
 * design — guard against silent drift).
 *
 * Updating snapshots:
 *   UPDATE_SNAPSHOTS=1 bun test tests/audit-snapshots.test.ts
 *
 * Then `git diff tests/roadmap-audit/` shows exactly what audit behavior
 * changed. Review the diff like any other code review.
 *
 * Migrated from scripts/test-roadmap-audit.sh (deleted in Track 3A).
 */

import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadFixtures, makeBaseTmp, setupRepo } from './helpers/fixture-repo.ts';
import { runBin } from './helpers/run-bin.ts';

const ROOT = join(import.meta.dir, '..');
const FIXTURES_DIR = join(ROOT, 'tests', 'roadmap-audit');
const AUDIT = join(ROOT, 'bin', 'roadmap-audit');
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';

describe('audit snapshot suite', () => {
  const baseTmp = makeBaseTmp('audit-snapshots-');
  const stateDir = join(baseTmp, 'state');
  const homeDir = join(baseTmp, 'home');
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(homeDir, { recursive: true });

  process.on('exit', () => {
    try { rmSync(baseTmp, { recursive: true, force: true }); } catch {}
  });

  for (const fix of loadFixtures(FIXTURES_DIR)) {
    test(fix.name, () => {
      const repo = setupRepo(fix.dir, baseTmp);
      const r = runBin(AUDIT, [...fix.args, repo], {
        home: homeDir,
        gstackExtendDir: ROOT,
        gstackExtendStateDir: stateDir,
      });

      // D13: assert stderr is empty (CLI contract — audit emits nothing
      // to stderr by design; silent drift here would slip past stdout-only
      // snapshot tests).
      if (r.stderr !== '') {
        throw new Error(
          `[${fix.name}] unexpected stderr (audit should emit nothing to stderr):\n${r.stderr}`,
        );
      }

      // Path normalization: replace per-test tmpdir with a stable token so
      // snapshots stay portable across machines. Also normalize trailing
      // newlines to exactly one — matches bash `printf '%s\n' "$(...)"`
      // semantics, which the original test-roadmap-audit.sh used.
      const normalized =
        r.stdout
          .replace(new RegExp(escapeRegExp(repo), 'g'), '<TMPDIR>')
          .replace(/\n*$/, '') + '\n';

      const expectedFile = join(fix.dir, 'expected.txt');

      if (UPDATE) {
        // Codex-flagged: don't bless spawn failures as snapshots. A missing
        // or non-executable binary returns exitCode != 0 with empty stdout;
        // writing that to expected.txt would break the suite silently.
        if (r.exitCode !== 0) {
          throw new Error(
            `[${fix.name}] refusing to update snapshot: audit exited with ${r.exitCode}. ` +
              `stderr: ${r.stderr || '(empty)'}`,
          );
        }
        if (r.stdout.length === 0) {
          throw new Error(`[${fix.name}] refusing to update snapshot: audit produced no stdout`);
        }
        writeFileSync(expectedFile, normalized);
        console.log(`  ↻ ${fix.name} (snapshot written)`);
        expect(true).toBe(true);
        return;
      }

      let expected: string;
      try {
        expected = readFileSync(expectedFile, 'utf8');
      } catch {
        throw new Error(
          `[${fix.name}] no expected.txt at ${expectedFile} — run with UPDATE_SNAPSHOTS=1 to seed`,
        );
      }

      if (normalized !== expected) {
        // Compose a unified-ish diff for readability.
        throw new Error(
          `[${fix.name}] snapshot drift (run UPDATE_SNAPSHOTS=1 to accept):\n` +
            `--- expected\n${expected}\n--- actual\n${normalized}`,
        );
      }
      expect(true).toBe(true);
    }, 60_000);
  }
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
