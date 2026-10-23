/**
 * skill-protocols-roadmap.test.ts — drift-locks for skills/roadmap.md.
 *
 * Split from tests/skill-protocols.test.ts, which keeps the cross-skill rules.
 * tests/helpers/touchfiles.ts declares every skill file this suite reads, and
 * tests/touchfiles.test.ts checks that declaration against the paths named here.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeRenames, formatRenamesTable } from '../src/audit/lib/renames-diff.ts';
import { CANONICAL_SECTIONS, OPTIONAL_SECTIONS } from '../src/audit/sections.ts';
import { agentShells, extractFences, runShell, scopedEnv } from './helpers/extend-root.ts';
import { makeBaseTmp } from './helpers/fixture-repo.ts';
import { resolverSkillText } from './helpers/skill-protocols.ts';

const ROOT = join(import.meta.dir, '..');

// ─── Roadmap-only verbatim assertions ─────────────────────────────────
//
// These strings live in skills/roadmap.md only. Load-bearing for the
// proposal artifact format. Proposal artifact path lives at
// `~/.gstack/projects/<slug>/roadmap-proposals/` (durable, mirrors gstack's
// checkpoints/ pattern); the skill resolves the concrete dir via
// session_dir roadmap-proposals.
const BLOCK_ROADMAP_PROPOSAL_PATH = '<PROPOSAL_DIR>/proposal-{ts}.md';

const BLOCK_ROADMAP_PROPOSAL_HELPER_CALL = 'session_dir roadmap-proposals';

const BLOCK_ROADMAP_DISCHARGE_SUMMARY = 'D items discharged';

const BLOCK_ROADMAP_DISCHARGE_SHA = 'discharged@<sha>';

const BLOCK_ROADMAP_REDERIVE = 'Regeneration **re-derives**';

// Track 8A — Layout Scaffolding section drift-locks. The flow has subtle
// load-bearing behavior the audit suggestions depend on:
//   - `git rev-parse --is-inside-work-tree`: distinguishes not-in-git from
//     in-git-but-untracked at preflight. Without this, `git mv` fails
//     ungracefully on greenfield repos.
//   - `git ls-files --error-unmatch --`: per-file tracked check that
//     decides between `git mv` and plain `mv`. The `--` sentinel is
//     load-bearing for leading-dash filenames.
//   - "inbox content typically wants merge, not rename": the inbox
//     always-block reason text the skill surfaces informationally. If
//     this string drifts, the skill prose stops matching the audit
//     output it consumes.
//   - The Layout Scaffolding section heading itself — required for the
//     trigger-detection rules above to resolve to anything.
const BLOCK_LAYOUT_SCAFFOLDING_HEADING = '## Layout Scaffolding';

const BLOCK_LAYOUT_GIT_REV_PARSE = 'git rev-parse --is-inside-work-tree';

const BLOCK_LAYOUT_GIT_LS_FILES = 'git ls-files --error-unmatch --';

const BLOCK_LAYOUT_INBOX_BLOCK_REASON = 'inbox content typically wants merge, not rename';

const BLOCK_LAYOUT_IDEMPOTENT_NOTE = 'Idempotent re-run';

const ROADMAP_VERBATIM_BLOCKS: Array<{ block: string; label: string }> = [
  { block: BLOCK_ROADMAP_PROPOSAL_PATH, label: 'proposal-artifact-path' },
  { block: BLOCK_ROADMAP_PROPOSAL_HELPER_CALL, label: 'proposal-artifact-helper-call' },
  { block: BLOCK_ROADMAP_DISCHARGE_SUMMARY, label: 'drain-discharge-summary' },
  { block: BLOCK_ROADMAP_DISCHARGE_SHA, label: 'drain-discharge-sha' },
  { block: BLOCK_ROADMAP_REDERIVE, label: 'regen-rederive-not-reemit' },
  { block: BLOCK_LAYOUT_SCAFFOLDING_HEADING, label: 'layout-scaffolding-section' },
  { block: BLOCK_LAYOUT_GIT_REV_PARSE, label: 'layout-git-rev-parse-preflight' },
  { block: BLOCK_LAYOUT_GIT_LS_FILES, label: 'layout-git-ls-files-tracked-check' },
  { block: BLOCK_LAYOUT_INBOX_BLOCK_REASON, label: 'layout-inbox-block-reason' },
  { block: BLOCK_LAYOUT_IDEMPOTENT_NOTE, label: 'layout-idempotent-re-run' },
];

// Track 10A D7 empty-guard and Track 5A's vendored readlink fallthrough
// locked the old preamble. Track 16D replaces both with the resolver locks
// below (the vendored path is now absent).

describe('roadmap-only verbatim blocks', () => {
  const file = join(ROOT, 'skills', 'roadmap.md');
  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const { block, label } of ROADMAP_VERBATIM_BLOCKS) {
    test(`roadmap contains verbatim block: ${label}`, () => {
      if (!content.includes(block)) {
        throw new Error(
          `roadmap drift in '${label}' — propagate canonical text from tests/skill-protocols-roadmap.test.ts`,
        );
      }
    });
  }
});

// ─── Track 15A: cohorts, Conductor lock, advisory-list drift ──────────

const KNOWN_FOSSILS = ['SIZE_LABEL_MISMATCH'] as const;

const EXPECTED_FAIL_SECTIONS = [
  'SIZE',
  'COLLISIONS',
  'PACKING',
  'STRUCTURE',
  'STATE_SECTIONS',
  'VERSION',
  'GROUP_DEPS',
  'PARALLELISM_BUDGET',
  'FUTURE',
] as const;

const EXPECTED_ADVISORY_SECTIONS = [
  'VOCAB_LINT',
  'STYLE_LINT',
  'VERSION_TAG_STALENESS',
  'VERSION',
  'TAXONOMY',
  'SIZE_LABEL_MISMATCH',
  'DOC_LOCATION',
  'ARCHIVE_CANDIDATES',
  'DEPENDENCIES',
  'TASK_LIST',
  'STRUCTURAL_FITNESS',
  'DOC_INVENTORY',
  'GROUP_DEPS',
  'STATE_SECTIONS',
] as const;

const FAIL_LIST_PREFIX = '`<N>` counts audit sections with `STATUS: fail`:';

const ADVISORY_LIST_PREFIX =
  '`<M>` counts advisory sections with `STATUS: warn` or `STATUS: info`:';

/**
 * Extract ALL_CAPS section tokens from the two GSTACK REVIEW REPORT
 * comma-lists in skills/roadmap.md. Strip parentheticals and never
 * treat `STATUS` as a section. Fail closed if a list is missing,
 * duplicated, empty, or a comma-cell has leftover ALL_CAPS after the
 * first token (missing-comma bypass).
 *
 * Do not harvest every `## ALL_CAPS` heading — `## GSTACK REVIEW REPORT`
 * is not an audit section.
 */
function extractAuditSectionLists(roadmapSkill: string): {
  fail: string[];
  advisory: string[];
} {
  const tokenize = (afterColon: string): string[] => {
    const stripped = afterColon.replace(/\([^)]*\)/g, ' ');
    const names: string[] = [];
    for (const part of stripped.split(',')) {
      const hits = [...part.matchAll(/\b([A-Z][A-Z0-9_]*)\b/g)]
        .map((m) => m[1])
        .filter((name): name is string => Boolean(name) && name !== 'STATUS');
      if (hits.length > 1) {
        throw new Error(
          `leftover section token '${hits[1]}' after '${hits[0]}' in skills/roadmap.md list cell`,
        );
      }
      if (hits[0]) names.push(hits[0]);
    }
    return names;
  };

  const collect = (prefix: string, label: string): string[] => {
    const hits: string[] = [];
    let from = 0;
    while (from < roadmapSkill.length) {
      const idx = roadmapSkill.indexOf(prefix, from);
      if (idx === -1) break;
      const lineEnd = roadmapSkill.indexOf('\n', idx);
      const rest = roadmapSkill.slice(idx + prefix.length, lineEnd === -1 ? undefined : lineEnd);
      hits.push(rest);
      from = idx + prefix.length;
    }
    if (hits.length === 0) {
      throw new Error(`no ${label} list found in skills/roadmap.md`);
    }
    if (hits.length > 1) {
      throw new Error(`duplicate ${label} list (${hits.length}) in skills/roadmap.md`);
    }
    const tokens = tokenize(hits[0] ?? '');
    if (tokens.length === 0) {
      throw new Error(`${label} list in skills/roadmap.md produced zero tokens`);
    }
    return tokens;
  };

  return {
    fail: collect(FAIL_LIST_PREFIX, 'fail'),
    advisory: collect(ADVISORY_LIST_PREFIX, 'advisory'),
  };
}

describe('Track 15A roadmap advisory-list drift vs CANONICAL_SECTIONS', () => {
  const roadmapSkill = readFileSync(join(ROOT, 'skills', 'roadmap.md'), 'utf8');
  const lists = extractAuditSectionLists(roadmapSkill);
  const allowed = new Set<string>([
    ...CANONICAL_SECTIONS,
    ...OPTIONAL_SECTIONS,
    ...KNOWN_FOSSILS,
  ]);

  test('fail list is the exact pinned set', () => {
    expect(lists.fail).toEqual([...EXPECTED_FAIL_SECTIONS]);
  });

  test('advisory list is the exact pinned set (includes SIZE_LABEL_MISMATCH fossil)', () => {
    expect(lists.advisory).toEqual([...EXPECTED_ADVISORY_SECTIONS]);
  });

  test('every extracted name is a canonical section, optional section, or known fossil', () => {
    for (const name of [...lists.fail, ...lists.advisory]) {
      if (!allowed.has(name)) {
        throw new Error(
          `'${name}' in skills/roadmap.md advisory/fail list is not a CANONICAL_SECTIONS / OPTIONAL_SECTIONS entry (and not KNOWN_FOSSILS). SIZE_LABEL_MISMATCH is a SIZE body label, not a section.`,
        );
      }
    }
  });

  test('SIZE_LABEL_MISMATCH is a known fossil, not a canonical section', () => {
    expect(CANONICAL_SECTIONS).not.toContain('SIZE_LABEL_MISMATCH');
    expect(KNOWN_FOSSILS).toContain('SIZE_LABEL_MISMATCH');
  });

  test('## SIZE_LABEL_MISMATCH heading is absent from skills/roadmap.md', () => {
    expect(roadmapSkill).not.toContain('## SIZE_LABEL_MISMATCH');
  });

  test('list parser strips parentheticals and ignores STATUS', () => {
    const sample = `${FAIL_LIST_PREFIX} SIZE, GROUP_DEPS (stale-anchor), STATE_SECTIONS (MIGRATION_NEEDED).\n${ADVISORY_LIST_PREFIX} VOCAB_LINT.\n`;
    const parsed = extractAuditSectionLists(sample);
    expect(parsed.fail).toEqual(['SIZE', 'GROUP_DEPS', 'STATE_SECTIONS']);
    expect(parsed.advisory).toEqual(['VOCAB_LINT']);
  });

  test('list parser throws on missing fail list', () => {
    expect(() => extractAuditSectionLists(`${ADVISORY_LIST_PREFIX} VOCAB_LINT.\n`)).toThrow(
      'no fail list found',
    );
  });

  test('list parser throws on duplicate fail list', () => {
    const dup = `${FAIL_LIST_PREFIX} SIZE.\n${FAIL_LIST_PREFIX} PACKING.\n${ADVISORY_LIST_PREFIX} VOCAB_LINT.\n`;
    expect(() => extractAuditSectionLists(dup)).toThrow('duplicate fail list');
  });

  test('list parser throws on empty fail tokens', () => {
    expect(() =>
      extractAuditSectionLists(`${FAIL_LIST_PREFIX}\n${ADVISORY_LIST_PREFIX} VOCAB_LINT.\n`),
    ).toThrow('produced zero tokens');
  });

  test('list parser throws on missing advisory list', () => {
    expect(() => extractAuditSectionLists(`${FAIL_LIST_PREFIX} SIZE.\n`)).toThrow(
      'no advisory list found',
    );
  });

  test('list parser throws on duplicate advisory list', () => {
    const dup = `${FAIL_LIST_PREFIX} SIZE.\n${ADVISORY_LIST_PREFIX} VOCAB_LINT.\n${ADVISORY_LIST_PREFIX} STYLE_LINT.\n`;
    expect(() => extractAuditSectionLists(dup)).toThrow('duplicate advisory list');
  });

  test('list parser throws on leftover ALL_CAPS in a cell (missing comma)', () => {
    const sample = `${FAIL_LIST_PREFIX} SIZE, PACKING NEW_SECTION.\n${ADVISORY_LIST_PREFIX} VOCAB_LINT.\n`;
    expect(() => extractAuditSectionLists(sample)).toThrow("leftover section token 'NEW_SECTION'");
  });

  test('list parser throws on leftover ALL_CAPS after a parenthetical', () => {
    const sample = `${FAIL_LIST_PREFIX} SIZE, GROUP_DEPS (stale-anchor) PHASES.\n${ADVISORY_LIST_PREFIX} VOCAB_LINT.\n`;
    expect(() => extractAuditSectionLists(sample)).toThrow("leftover section token 'PHASES'");
  });
});

const extendRootTmp = makeBaseTmp('skill-protocols-extend-root-');

afterAll(() => {
  try { rmSync(extendRootTmp, { recursive: true, force: true }); } catch { /* */ }
});

describe('Track 16D roadmap routing and renames', () => {
  test('roadmap-route prompts for target assessment of a multi-field defer tag', () => {
    const script = '_EXTEND_ROOT="$CHECKOUT"\n"$_EXTEND_ROOT/bin/roadmap-route" \'[plan-ceo-review:track=16D,defer=true]\'\n';
    for (const sh of agentShells()) {
      const r = runShell(sh.shell, sh.args, script, scopedEnv(join(extendRootTmp, 'route-home'), { CHECKOUT: ROOT }));
      expect(r.status).toBe(0);
      expect(r.stdout ?? '').toContain('action=PROMPT');
      expect(r.stdout ?? '').toContain('evaluate selected target');
    }
  });

  test('renames block matches the static import for an apostrophe-named root', () => {
    const work = join(extendRootTmp, 'renames-work');
    mkdirSync(join(work, 'docs'), { recursive: true });
    const oldRoadmap = '##### Track 1A: Alpha widget\n';
    const newRoadmap = '##### Track 2A: Alpha widget\n';
    writeFileSync(join(work, 'docs', 'ROADMAP.md'), newRoadmap);
    const link = join(extendRootTmp, "o'brien");
    symlinkSync(ROOT, link);
    const fence = extractFences(resolverSkillText('roadmap')).find((f) => f.body.includes('process.env.ER'));
    expect(fence).toBeTruthy();
    const r = runShell(
      'bash',
      ['-c'],
      fence!.body,
      scopedEnv(join(extendRootTmp, 'renames-home'), { _EXTEND_ROOT: link, ROADMAP_BEFORE: oldRoadmap }),
      work,
    );
    const expected = formatRenamesTable(computeRenames(oldRoadmap, newRoadmap));
    expect(r.status).toBe(0);
    expect((r.stdout ?? '').trim()).toBe(expected.trim());
    expect(expected).toContain('Track 1A');
  });
});
