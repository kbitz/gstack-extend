/**
 * audit-shadow.test.ts — D8 cutover safety net.
 *
 * For every fixture in tests/roadmap-audit/, runs both bash audit
 * (`bin/roadmap-audit`) and TS audit (`bun run src/audit/cli.ts`)
 * against the same prepared repo, then asserts byte equality of every
 * emitted section. PR 3 brought the TS port to full parity, so this no
 * longer needs an allowlist — diffs run against the full output.
 *
 * `--scan-state` fixtures are diffed as plain JSON output (no section
 * extraction, since they emit a single JSON object).
 *
 * Runtime: ~2× the snapshot suite (we run both engines per fixture). Track
 * 4A's "touchfiles" optimization will skip work when nothing changed.
 *
 * Failure mode: a single section-level diff fails its test case, with a
 * unified-diff message so the regression is obvious. Bash output (the
 * oracle) is the "expected" side; TS is "actual".
 */

import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { parseAuditSections } from '../src/audit/sections.ts';
import { loadFixtures, makeBaseTmp, setupRepo } from './helpers/fixture-repo.ts';
import { runBin } from './helpers/run-bin.ts';

const ROOT = join(import.meta.dir, '..');
const FIXTURES_DIR = join(ROOT, 'tests', 'roadmap-audit');
const BASH_AUDIT = join(ROOT, 'bin', 'roadmap-audit');
const TS_AUDIT = join(ROOT, 'src', 'audit', 'cli.ts');

function extractSections(output: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of parseAuditSections(output)) out.set(s.name, s.body.join('\n'));
  return out;
}

function trimTrailingBlanks(s: string): string {
  // Drop runs of blank lines at the end so renderer-spacing nits don't
  // break the diff.
  return s.replace(/\n+$/, '');
}

describe('audit shadow parity (D8)', () => {
  const baseTmp = makeBaseTmp('audit-shadow-');
  const stateDir = join(baseTmp, 'state');
  const homeDir = join(baseTmp, 'home');
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(homeDir, { recursive: true });

  // Cleanup at-process-exit. bun:test doesn't expose afterAll cleanly when
  // describe is at top level — rely on the OS to clean tmp afterwards in
  // the worst case (path includes a unique random prefix).
  process.on('exit', () => {
    try { rmSync(baseTmp, { recursive: true, force: true }); } catch {}
  });

  for (const fix of loadFixtures(FIXTURES_DIR)) {
    // Per-test timeout: 60s. Each test spawns 2 subprocesses (bash + bun
    // run) — under bun's default test parallelism the spawn waves
    // contend for CPU and individual cases occasionally exceed 20s.
    // Track 4A's touchfile cache will bring this back under 1s.
    test(fix.name, () => {
      const repo = setupRepo(fix.dir, baseTmp);
      const bashRes = runBin(BASH_AUDIT, [...fix.args, repo], {
        home: homeDir,
        gstackExtendDir: ROOT,
        gstackExtendStateDir: stateDir,
      });
      const tsRes = runBin('bun', ['run', TS_AUDIT, ...fix.args, repo], {
        home: homeDir,
        gstackExtendDir: ROOT,
        gstackExtendStateDir: stateDir,
      });
      // Codex-flagged: empty stdout from BOTH engines (e.g., binary missing,
      // spawn failure) would silently equal-compare to pass. Lock the
      // contract that each engine actually produced output.
      if (bashRes.stdout.length === 0) {
        throw new Error(`[${fix.name}] bash audit produced no stdout (exit=${bashRes.exitCode}, stderr=${bashRes.stderr})`);
      }
      if (tsRes.stdout.length === 0) {
        throw new Error(`[${fix.name}] TS audit produced no stdout (exit=${tsRes.exitCode}, stderr=${tsRes.stderr})`);
      }
      const bashOut = bashRes.stdout;
      const tsOut = tsRes.stdout;

      // --scan-state mode emits a JSON object — diff as plain text.
      if (fix.args.includes('--scan-state')) {
        if (bashOut.trim() !== tsOut.trim()) {
          throw new Error(
            `[${fix.name}] scan-state drift:\n--- bash (oracle)\n${bashOut}\n--- ts (actual)\n${tsOut}`,
          );
        }
        expect(true).toBe(true);
        return;
      }

      const bashSections = extractSections(bashOut);
      const tsSections = extractSections(tsOut);
      const allSections = new Set([...bashSections.keys(), ...tsSections.keys()]);

      for (const section of allSections) {
        const b = trimTrailingBlanks(bashSections.get(section) ?? '');
        const t = trimTrailingBlanks(tsSections.get(section) ?? '');
        if (b !== t) {
          throw new Error(
            `[${fix.name}] section ${section} drifted:\n--- bash (oracle)\n${b}\n--- ts (actual)\n${t}`,
          );
        }
      }
      expect(true).toBe(true);
    }, 60000);
  }
});
