/**
 * audit-shadow.test.ts — D8 cutover safety net.
 *
 * For every fixture in tests/roadmap-audit/, runs both bash audit
 * (`bin/roadmap-audit`) and TS audit (`bun run src/audit/cli.ts`)
 * against the same prepared repo, then asserts byte equality of every
 * section listed in PORTED_SECTIONS. Sections not in the set are skipped
 * (PR 2 ports 12 of 24; PR 3 ports the rest and shrinks/deletes this set).
 *
 * Runtime: ~2× the snapshot suite (we run both engines per fixture). PR-3
 * Track 4A's "touchfiles" optimization will skip work when nothing changed.
 *
 * Failure mode: a single section-level diff fails its test case, with a
 * unified-diff message so the regression is obvious. Bash output (the
 * oracle) is the "expected" side; TS is "actual".
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = join(import.meta.dir, '..');
const FIXTURES_DIR = join(ROOT, 'tests', 'roadmap-audit');
const BASH_AUDIT = join(ROOT, 'bin', 'roadmap-audit');
const TS_AUDIT = join(ROOT, 'src', 'audit', 'cli.ts');

const PORTED_SECTIONS = new Set([
  'VOCAB_LINT',
  'STRUCTURE',
  'PHASES',
  'PHASE_INVARIANTS',
  'STALENESS',
  'VERSION',
  'TAXONOMY',
  'DOC_LOCATION',
  'ARCHIVE_CANDIDATES',
  'DEPENDENCIES',
  'GROUP_DEPS',
  'TASK_LIST',
]);

// Section heading regex: lines starting `## SECTION_NAME` where
// SECTION_NAME is upper-snake. Mirrors bash output and matches both
// engines' rendering.
const SECTION_RE = /^## ([A-Z_]+)$/;

function extractSections(output: string): Map<string, string> {
  const out = new Map<string, string>();
  let current: string | null = null;
  let buf: string[] = [];
  for (const line of output.split('\n')) {
    const m = SECTION_RE.exec(line);
    if (m !== null) {
      if (current !== null) out.set(current, buf.join('\n'));
      current = m[1]!;
      buf = [];
      continue;
    }
    if (current !== null) buf.push(line);
  }
  if (current !== null) out.set(current, buf.join('\n'));
  return out;
}

function trimTrailingBlanks(s: string): string {
  // Drop runs of blank lines at the end so renderer-spacing nits don't
  // break the diff.
  return s.replace(/\n+$/, '');
}

type Fixture = {
  name: string;
  dir: string;
  args: string[];
};

function loadFixtures(): Fixture[] {
  const out: Fixture[] = [];
  for (const name of readdirSync(FIXTURES_DIR)) {
    const dir = join(FIXTURES_DIR, name);
    if (!statSync(dir).isDirectory()) continue;
    const argsFile = join(dir, 'args');
    let args: string[] = [];
    try {
      const raw = readFileSync(argsFile, 'utf8').trim();
      args = raw === '' ? [] : raw.split(/\s+/);
    } catch {
      // No args file — empty args.
    }
    out.push({ name, dir, args });
  }
  // Stable order so failures point at predictable test names.
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

function setupRepo(fixtureDir: string, baseTmp: string): string {
  const repo = mkdtempSync(join(baseTmp, 'fix-'));
  const filesDir = join(fixtureDir, 'files');
  if (statSync(filesDir, { throwIfNoEntry: false })?.isDirectory()) {
    copyDirSync(filesDir, repo);
  }
  // Init a clean git repo so the audit can read git state safely.
  spawnSync('git', ['-C', repo, 'init', '--quiet'], { encoding: 'utf8' });
  spawnSync('git', ['-C', repo, 'config', 'user.email', 't@t.com'], { encoding: 'utf8' });
  spawnSync('git', ['-C', repo, 'config', 'user.name', 'T'], { encoding: 'utf8' });
  spawnSync('git', ['-C', repo, 'add', '-A'], { encoding: 'utf8' });
  spawnSync('git', ['-C', repo, 'commit', '-m', 'init', '--quiet', '--allow-empty'], {
    encoding: 'utf8',
  });
  return repo;
}

function copyDirSync(src: string, dst: string) {
  for (const name of readdirSync(src)) {
    const srcPath = join(src, name);
    const dstPath = join(dst, name);
    const st = statSync(srcPath);
    if (st.isDirectory()) {
      mkdirSync(dstPath, { recursive: true });
      copyDirSync(srcPath, dstPath);
    } else {
      mkdirSync(dirname(dstPath), { recursive: true });
      const content = readFileSync(srcPath);
      Bun.write(dstPath, content);
    }
  }
}

function runBash(repo: string, args: string[], stateDir: string): string {
  const r = spawnSync(BASH_AUDIT, [...args, repo], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GSTACK_EXTEND_DIR: ROOT,
      GSTACK_EXTEND_STATE_DIR: stateDir,
    },
  });
  return r.stdout ?? '';
}

function runTs(repo: string, args: string[], stateDir: string): string {
  const r = spawnSync('bun', ['run', TS_AUDIT, ...args, repo], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GSTACK_EXTEND_DIR: ROOT,
      GSTACK_EXTEND_STATE_DIR: stateDir,
    },
  });
  return r.stdout ?? '';
}

describe('audit shadow parity (D8)', () => {
  const baseTmp = mkdtempSync(join(tmpdir(), 'audit-shadow-'));
  const stateDir = join(baseTmp, 'state');
  mkdirSync(stateDir, { recursive: true });

  // Cleanup at-process-exit. bun:test doesn't expose afterAll cleanly when
  // describe is at top level — rely on the OS to clean tmp afterwards in
  // the worst case (path includes a unique random prefix).
  process.on('exit', () => {
    try { rmSync(baseTmp, { recursive: true, force: true }); } catch {}
  });

  for (const fix of loadFixtures()) {
    // Skip --scan-state fixtures: they emit JSON, not section blocks. The
    // bash snapshot suite still covers them; PR 3 will fold scan-state
    // parity into a separate test once all 24 checks land.
    if (fix.args.includes('--scan-state')) continue;

    // Per-test timeout: 20s. Bash + TS together typically run in 2-4s, but
    // CI cold-cache or busy machines can spike. Tighter than the snapshot
    // suite's implicit timeout because PR-3 Track 4A's touchfile cache
    // brings this back under 1s once it lands.
    test(fix.name, () => {
      const repo = setupRepo(fix.dir, baseTmp);
      const bashOut = runBash(repo, fix.args, stateDir);
      const tsOut = runTs(repo, fix.args, stateDir);

      const bashSections = extractSections(bashOut);
      const tsSections = extractSections(tsOut);

      for (const section of PORTED_SECTIONS) {
        const b = trimTrailingBlanks(bashSections.get(section) ?? '');
        const t = trimTrailingBlanks(tsSections.get(section) ?? '');
        if (b !== t) {
          throw new Error(
            `[${fix.name}] section ${section} drifted:\n--- bash (oracle)\n${b}\n--- ts (actual)\n${t}`,
          );
        }
      }
      expect(true).toBe(true);
    }, 20000);
  }
});
