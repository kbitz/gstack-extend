/**
 * test-plan.test.ts — deterministic tests for skills/test-plan.md's
 * bash-testable pieces.
 *
 * Because /test-plan's core logic runs inside the LLM (prompt extraction,
 * classification, handoff to /pair-review), this harness tests CONTRACTS
 * the skill file documents: paths, slugification, item-ID stability, YAML
 * shape, archive behavior, classification heuristic table, subcommand
 * contract, and various invariants surfaced during prior reviews.
 *
 * The LLM-facing extractor output quality is covered by
 * tests/test-plan-extractor.test.ts and scripts/score-extractor.ts; e2e
 * data-flow integration by tests/test-plan-e2e.test.ts.
 *
 * Migrated from scripts/test-test-plan.sh (deleted in Track 3A).
 *
 * D14: dropped the chmod-555 OS-behavior assertion. Bash's read-only
 * guard test was exercising OS perms (no skill code under test) plus a
 * doc-grep. Only the doc-grep ports here — testing the OS is silly.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeBaseTmp } from './helpers/fixture-repo.ts';

const ROOT = join(import.meta.dir, '..');
const SKILL_FILE = join(ROOT, 'skills', 'test-plan.md');
const CONTRACT_FILE = join(ROOT, 'docs', 'designs', 'test-plan-artifact-contract.md');

const baseTmp = makeBaseTmp('test-plan-');
afterAll(() => {
  try { rmSync(baseTmp, { recursive: true, force: true }); } catch {}
});

const skillContent = readFileSync(SKILL_FILE, 'utf8');

// ─── slugify pipeline ────────────────────────────────────────────────
//
// /test-plan slugs Group titles for filenames. Contract:
//   lowercase → replace non-alphanumerics with hyphens → collapse runs of
//   hyphens → trim leading/trailing hyphens.
// Drift breaks paths silently.

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

describe('slugify pipeline', () => {
  test('skills/test-plan.md exists', () => {
    expect(existsSync(SKILL_FILE)).toBe(true);
  });

  test('skills/test-plan.md documents the slugify pipeline', () => {
    expect(skillContent).toContain("tr '[:upper:]' '[:lower:]'");
    expect(skillContent).toContain("sed 's/[^a-z0-9]/-/g'");
    expect(skillContent).toContain("sed 's/--*/-/g'");
    expect(skillContent).toContain("sed 's/^-//;s/-$//'");
  });

  for (const [input, expected] of [
    ['Install Pipeline', 'install-pipeline'],
    ['Distribution Infrastructure', 'distribution-infrastructure'],
    ['Auth & Onboarding', 'auth-onboarding'],
    ['v0.15 Ship Prep', 'v0-15-ship-prep'],
    ['  Leading and Trailing  ', 'leading-and-trailing'],
    ['Already-slug-like', 'already-slug-like'],
  ] as const) {
    test(`slugify '${input}' → '${expected}'`, () => {
      expect(slugify(input)).toBe(expected);
    });
  }
});

// ─── stable item IDs ─────────────────────────────────────────────────
//
// id_input = <branch>|<source_doc_path>|<section_heading>|<normalized_description>
// item_id  = first 8 hex chars of sha256(id_input)
// Determinism is the whole point — same inputs MUST produce same ID
// across invocations, machines, and time.

function computeItemId(branch: string, doc: string, section: string, desc: string): string {
  const normalized = desc.toLowerCase().replace(/\s+/g, ' ').trim();
  const input = `${branch}|${doc}|${section}|${normalized}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 8);
}

describe('stable item IDs', () => {
  test('deterministic: same inputs → same output', () => {
    const id1 = computeItemId('kbitz/auth', 'ceo-plan.md', 'Magical moment', 'Verify feedback appears within 200ms');
    const id2 = computeItemId('kbitz/auth', 'ceo-plan.md', 'Magical moment', 'Verify feedback appears within 200ms');
    expect(id1).toBe(id2);
    expect(id1).toHaveLength(8);
  });

  test('normalizes case and whitespace', () => {
    const idA = computeItemId('kbitz/auth', 'ceo-plan.md', 'Magical moment', 'verify feedback appears within 200ms');
    const idB = computeItemId('kbitz/auth', 'ceo-plan.md', 'Magical moment', 'Verify  feedback   appears within 200ms');
    const idC = computeItemId('kbitz/auth', 'ceo-plan.md', 'Magical moment', 'VERIFY FEEDBACK APPEARS WITHIN 200MS');
    expect(idA).toBe(idB);
    expect(idB).toBe(idC);
  });

  test('varies with branch', () => {
    const idX = computeItemId('kbitz/auth', 'ceo-plan.md', 'Magical moment', 'Verify feedback');
    const idY = computeItemId('kbitz/payments', 'ceo-plan.md', 'Magical moment', 'Verify feedback');
    expect(idX).not.toBe(idY);
  });

  test('varies with source doc path', () => {
    const idP = computeItemId('main', 'ceo-plan.md', '§1', 'Item');
    const idQ = computeItemId('main', 'eng-plan.md', '§1', 'Item');
    expect(idP).not.toBe(idQ);
  });

  test('deterministic for diff-derived items', () => {
    const id1 = computeItemId('diff', 'diff', 'src/auth.ts', 'Verify login redirects after success');
    const id2 = computeItemId('diff', 'diff', 'src/auth.ts', 'Verify login redirects after success');
    expect(id1).toBe(id2);
  });
});

// ─── path construction ───────────────────────────────────────────────

describe('path construction', () => {
  const SLUG = 'test-project';
  const BRANCH_SLUG = 'kbitz-auth';
  const USER = 'tester';
  const TS = '20260421-120000';

  const batchPath = `/home/${USER}/.gstack/projects/${SLUG}/${USER}-${BRANCH_SLUG}-test-plan-batch-${TS}.md`;
  const manifestPath = `/home/${USER}/.gstack/projects/${SLUG}/groups/install-pipeline/manifest.yaml`;
  const engReviewBasename = 'kb-kbitz-auth-eng-review-test-plan-20260421-115000.md';
  const batchBasename = `${USER}-${BRANCH_SLUG}-test-plan-batch-${TS}.md`;

  test('batch plan filename matches qa-only glob *-test-plan-*.md', () => {
    expect(batchBasename).toMatch(/-test-plan-.*\.md$/);
  });

  test('manifest path has canonical /groups/<slug>/manifest.yaml shape', () => {
    expect(manifestPath).toMatch(/\/groups\/[^/]+\/manifest\.yaml$/);
  });

  test('eng-review artifact does NOT match test-plan-batch token', () => {
    expect(engReviewBasename).not.toContain('-test-plan-batch-');
  });

  test('test-plan batch artifact matches test-plan-batch token', () => {
    expect(batchBasename).toContain('-test-plan-batch-');
  });

  // Reference unused so the linter stays happy without weakening the contract.
  void batchPath;
});

// ─── archive behavior ────────────────────────────────────────────────
//
// Per design Issue 3 (strict handoff): re-running /test-plan run on the
// same Group must archive the old groups/<g>.md to a timestamped sibling
// before writing fresh. No joint ownership. No merging.

describe('archive behavior', () => {
  test('archive preserves old + fresh replaces', () => {
    const ws = mkdirSyncIn(baseTmp, 'archive-1');
    const groupsDir = join(ws, '.context', 'pair-review', 'groups');
    mkdirSync(groupsDir, { recursive: true });
    const groupsFile = join(groupsDir, 'auth.md');
    writeFileSync(groupsFile, '# Test Group: Auth\n## Items\n### 1. Old item\n- Status: PASSED\n');

    const ts = '20260421-120000';
    const arch = join(groupsDir, `auth-archived-${ts}.md`);
    // Simulate Phase 7 archive step.
    Bun.spawnSync(['mv', groupsFile, arch]);
    writeFileSync(groupsFile, '# Test Group: Auth\n## Items\n### 1. New item\n- Status: UNTESTED\n');

    expect(existsSync(arch)).toBe(true);
    expect(readFileSync(arch, 'utf8')).toContain('Old item');
    expect(readFileSync(groupsFile, 'utf8')).toContain('New item');
    expect(readFileSync(groupsFile, 'utf8')).not.toContain('Old item');
  });

  test('multiple archive generations coexist (distinct timestamps)', () => {
    const ws = mkdirSyncIn(baseTmp, 'archive-2');
    const groupsDir = join(ws, '.context', 'pair-review', 'groups');
    mkdirSync(groupsDir, { recursive: true });
    const groupsFile = join(groupsDir, 'auth.md');
    writeFileSync(groupsFile, 'gen-1\n');
    const arch1 = join(groupsDir, 'auth-archived-A.md');
    Bun.spawnSync(['mv', groupsFile, arch1]);
    writeFileSync(groupsFile, 'gen-2\n');
    const arch2 = join(groupsDir, 'auth-archived-B.md');
    Bun.spawnSync(['mv', groupsFile, arch2]);

    expect(existsSync(arch1)).toBe(true);
    expect(existsSync(arch2)).toBe(true);
    expect(readFileSync(arch1, 'utf8')).toBe('gen-1\n');
    expect(readFileSync(arch2, 'utf8')).toBe('gen-2\n');
  });
});

// ─── state-write failure guard (D14: doc-grep only) ─────────────────
//
// D14: dropped the chmod-555 OS-perms test (was exercising OS, not skill
// code). The remaining assertion — that the skill DOCUMENTS the guard —
// is the only one with real signal.

describe('state-write failure guard documentation', () => {
  test('skill file documents Failure-mode guard + abort path', () => {
    expect(skillContent).toContain('Failure-mode guard');
    expect(skillContent).toContain('abort BEFORE dropping into pair-review');
  });
});

// ─── classification heuristic table ──────────────────────────────────

describe('classification heuristic coverage', () => {
  const REQUIRED_AUTOMATED_SIGNALS = [
    '"loads"',
    '"returns"',
    '"200"',
    '"schema"',
    '"form-submits"',
    '"api"',
    '"endpoint"',
    '"element-visible"',
  ];

  const REQUIRED_MANUAL_SIGNALS = [
    '"feel"',
    '"looks"',
    '"animation"',
    '"copy"',
    '"tone"',
    '"judgment"',
  ];

  for (const sig of REQUIRED_AUTOMATED_SIGNALS) {
    test(`automated signal documented: ${sig}`, () => {
      expect(skillContent).toContain(sig);
    });
  }

  for (const sig of REQUIRED_MANUAL_SIGNALS) {
    test(`manual signal documented: ${sig}`, () => {
      expect(skillContent).toContain(sig);
    });
  }

  test('conservative-default rule documented (ambiguous → manual)', () => {
    const re = /Ambiguous[^)]*manual|default.*to manual|confidence.*< 0\.7.*downgraded to .*manual/;
    expect(re.test(skillContent)).toBe(true);
  });
});

// ─── subcommand contract ─────────────────────────────────────────────

describe('subcommand contract', () => {
  test('run subcommand documented', () => {
    expect(skillContent).toContain('/test-plan run <group>');
  });

  test('status subcommand documented', () => {
    expect(/\/test-plan status(  | <)/.test(skillContent)).toBe(true);
  });

  test('seed deferred-to-v2 documented', () => {
    expect(skillContent).toContain('/test-plan seed');
    expect(/seed.*v2|Deferred to v2|v2 work/.test(skillContent)).toBe(true);
  });

  test('retro deferred-to-v2 documented', () => {
    expect(skillContent).toContain('/test-plan retro');
    expect(/retro.*v2|Deferred to v2|v2 work/.test(skillContent)).toBe(true);
  });
});

// ─── provenance tag taxonomy ─────────────────────────────────────────

describe('provenance tag taxonomy', () => {
  test('artifact contract doc exists', () => {
    expect(existsSync(CONTRACT_FILE)).toBe(true);
  });

  const REQUIRED_TAGS = [
    '`[from diff]`',
    '`[from ceo-review: <file>]`',
    '`[from eng-review: <file>]`',
    '`[from design-review: <file>]`',
    '`[from design-doc: <file>]`',
    '`[from parked-bug: <branch>]`',
    '`[retest-after-fix]`',
    '`[regression-candidate]`',
  ];

  const contractContent = existsSync(CONTRACT_FILE) ? readFileSync(CONTRACT_FILE, 'utf8') : '';

  for (const tag of REQUIRED_TAGS) {
    test(`contract documents tag: ${tag}`, () => {
      expect(contractContent).toContain(tag);
    });
  }
});

// ─── consume categories ──────────────────────────────────────────────

describe('consume categories (Phase 4)', () => {
  // Slice the skill file to just Phase 4 content.
  const phase4Match = /## Phase 4\b[\s\S]*?(?=## Phase 5\b)/.exec(skillContent);
  const phase4 = phase4Match !== null ? phase4Match[0] : '';

  for (const cat of ['PASSED', 'SKIPPED', 'DEFERRED_TO_TODOS', 'PARKED', 'FAILED']) {
    test(`consume category documented: ${cat}`, () => {
      expect(phase4).toContain(cat);
    });
  }

  test('DEFERRED_TO_TODOS refinement: surfaced as Known Deferred', () => {
    expect(/DEFERRED_TO_TODOS.*Known Deferred|Known Deferred.*DEFERRED/.test(phase4)).toBe(true);
  });

  test('FAILED+FIXED refinement: regression only when integrated build differs', () => {
    expect(/integrated build differs|most recent commit|overlapping files/.test(phase4)).toBe(true);
  });
});

// ─── timestamp collision avoidance ───────────────────────────────────

describe('TS collision avoidance', () => {
  test('skill documents TS format with PID suffix (%Y%m%d-%H%M%S-$$)', () => {
    expect(/TS=\$\(date \+%Y%m%d-%H%M%S\)-\$\$/.test(skillContent)).toBe(true);
  });

  test('skill documents collision rationale', () => {
    expect(/collision|silently overwrite/.test(skillContent)).toBe(true);
  });
});

// ─── extractor trust boundary ────────────────────────────────────────

describe('extractor trust boundary', () => {
  test('extractor prompt section has trust-boundary note', () => {
    expect(/Trust boundary|untrusted LLM output|MUST NOT be shell-executed/.test(skillContent)).toBe(true);
  });
});

// ─── single-deploy-target guard (Tension 1) ──────────────────────────

describe('single-deploy-target guard', () => {
  const phase0Match = /## Phase 0\b[\s\S]*?(?=## Phase 1\b)/.exec(skillContent);
  const phase0 = phase0Match !== null ? phase0Match[0] : '';

  test('Phase 0 documents integrated-build confirmation', () => {
    expect(/integrated build|all Track branches.*merged|single integrated/.test(phase0)).toBe(true);
  });
});

// ─── helpers ─────────────────────────────────────────────────────────

function mkdirSyncIn(parent: string, name: string): string {
  const dir = join(parent, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}
