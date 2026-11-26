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
import { buildAuditCtx } from '../src/audit/cli.ts';
import { computeRenames, formatRenamesTable } from '../src/audit/lib/renames-diff.ts';
import { CANONICAL_SECTIONS, OPTIONAL_SECTIONS, parseAuditSections } from '../src/audit/sections.ts';
import { agentShells, extractFences, runShell, scopedEnv } from './helpers/extend-root.ts';
import { makeBaseTmp } from './helpers/fixture-repo.ts';
import { referenceText, resolverSkillText } from './helpers/skill-protocols.ts';

const ROOT = join(import.meta.dir, '..');

test('roadmap candidate validation reads the drained inbox and Future draft when items are promoted', () => {
  const scratch = makeBaseTmp('roadmap-promoted-');
  try {
    const project = join(scratch, 'project');
    const docs = join(project, 'docs');
    mkdirSync(docs, { recursive: true });
    mkdirSync(join(project, 'src'));
    writeFileSync(join(project, 'src', 'a.ts'), 'export {};\n');
    writeFileSync(join(project, 'src', 'b.ts'), 'export {};\n');
    writeFileSync(join(project, 'VERSION'), '0.1.0\n');
    const baseRoadmap = [
      '## In Progress', '', '## Current Plan', '',
      '## Future', 'Deferred: docs/roadmap-future.md (1 items)', '',
      '## Shipped', 'History: docs/roadmap-shipped.md', '',
    ].join('\n');
    const baseTodos = '## Unprocessed\n### [manual] Inbox follow-up\n- **ID:** wi-aabbcc\n';
    const baseFuture = '## Future\n- **Deferred follow-up** — **ID:** wi-ddeeff — Work to move. **Revisit when:** ready.\n';
    writeFileSync(join(docs, 'ROADMAP.md'), baseRoadmap);
    writeFileSync(join(docs, 'TODOS.md'), baseTodos);
    writeFileSync(join(docs, 'roadmap-future.md'), baseFuture);
    const draftRoadmap = join(scratch, 'draft-roadmap.md');
    const draftArchive = join(scratch, 'draft-shipped.md');
    const draftTodos = join(scratch, 'draft-todos.md');
    const draftFuture = join(scratch, 'draft-future.md');
    const cards = [
      '### Group 1: Promoted work', '_Depends on: none_',
      '#### Track 1A: Inbox follow-up', '_1 task . ~20 LOC . low risk_', '_id: wi-aabbcc_',
      '_touches: src/a.ts_', '- Update the first file (~20 lines).',
      '#### Track 1B: Deferred follow-up', '_1 task . ~20 LOC . low risk_', '_id: wi-ddeeff_',
      '_touches: src/b.ts_', '- Update the second file (~20 lines).', '',
    ].join('\n');
    writeFileSync(draftRoadmap, baseRoadmap
      .replace('## Current Plan\n', '## Current Plan\n' + cards)
      .replace('(1 items)', '(0 items)'));
    writeFileSync(draftArchive, '## Shipped\n');
    writeFileSync(draftTodos, '## Unprocessed\n');
    writeFileSync(draftFuture, '## Future\n');
    const reference = referenceText('roadmap', 'conditional-candidate-validation');
    const script = reference.match(/^```typescript\n([\s\S]*?)^```$/m)?.[1];
    expect(script).toBeDefined();
    const command = join(scratch, 'candidate-validation.ts');
    writeFileSync(command, script!);
    const run = (...extra: string[]) => Bun.spawnSync([
      process.execPath, '--no-env-file', '--no-install', '--config=/dev/null',
      command, project, ROOT, draftRoadmap, draftArchive, ...extra,
    ], { env: scopedEnv(scratch), stdout: 'pipe', stderr: 'pipe', timeout: 15_000 });
    const workItemSection = (result: ReturnType<typeof run>) =>
      parseAuditSections(result.stdout.toString()).find(section => section.name === 'WORK_ITEM_IDS');

    const partial = run('-', draftFuture);
    expect(partial.exitCode).toBe(1);
    expect(workItemSection(partial)?.body.join('\n')).toContain('duplicate work-item ID "wi-aabbcc"');
    expect(workItemSection(partial)?.body.join('\n')).not.toContain('duplicate work-item ID "wi-ddeeff"');

    const full = run(draftTodos, draftFuture);
    expect(full.exitCode, full.stderr.toString()).toBe(0);
    expect(workItemSection(full)?.body).toContain('STATUS: pass');
    const live = buildAuditCtx({
      repoRoot: project, extendDir: ROOT, argv: { repoRoot: project, scanState: false, futureIndex: false, prompt: null },
    });
    expect(live.files.todos).toBe(baseTodos);
    expect(live.files.futureArchive).toBe(baseFuture);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

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

const ROADMAP_VERBATIM_BLOCKS: Array<{ block: string; label: string; inLayoutApply?: boolean }> = [
  { block: BLOCK_ROADMAP_PROPOSAL_PATH, label: 'proposal-artifact-path' },
  { block: BLOCK_ROADMAP_PROPOSAL_HELPER_CALL, label: 'proposal-artifact-helper-call' },
  { block: BLOCK_ROADMAP_DISCHARGE_SUMMARY, label: 'drain-discharge-summary' },
  { block: BLOCK_ROADMAP_DISCHARGE_SHA, label: 'drain-discharge-sha' },
  { block: BLOCK_ROADMAP_REDERIVE, label: 'regen-rederive-not-reemit' },
  { block: BLOCK_LAYOUT_SCAFFOLDING_HEADING, label: 'layout-scaffolding-section' },
  { block: BLOCK_LAYOUT_GIT_REV_PARSE, label: 'layout-git-rev-parse-preflight', inLayoutApply: true },
  { block: BLOCK_LAYOUT_GIT_LS_FILES, label: 'layout-git-ls-files-tracked-check', inLayoutApply: true },
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
  const layoutApplyRef = referenceText('roadmap', 'conditional-layout-apply');
  for (const { block, label, inLayoutApply } of ROADMAP_VERBATIM_BLOCKS) {
    test(`roadmap contains verbatim block: ${label}`, () => {
      const target = inLayoutApply ? layoutApplyRef : content;
      if (!target.includes(block)) {
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
  'WORK_ITEM_IDS',
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
  'WORK_ITEM_IDS',
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

  // Value: protects=a review-tagged test gap with files= routes KEEP; fails_when=the router starts killing or prompting the tag the review skill writes; why_new=criterion 3; seam=none
  test('roadmap-route keeps a review-tagged test gap carrying files=', () => {
    const script = '_EXTEND_ROOT="$CHECKOUT"\n"$_EXTEND_ROOT/bin/roadmap-route" \'[review:files=a.ts|b.ts]\'\n';
    for (const sh of agentShells()) {
      const r = runShell(sh.shell, sh.args, script, scopedEnv(join(extendRootTmp, 'route-gap-home'), { CHECKOUT: ROOT }));
      expect(r.status).toBe(0);
      expect(r.stdout ?? '').toContain('action=KEEP');
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

describe('Track 51A recorded test gaps at drain', () => {
  const roadmap = readFileSync(join(ROOT, 'skills', 'roadmap.md'), 'utf8');
  const drain = roadmap.slice(roadmap.indexOf('### Verify at drain time'), roadmap.indexOf('### Unobserved defects wait for manifestation'));
  const flat = drain.replace(/\s+/g, ' ');

  // Value: protects=the drain rule sits in Verify at drain time, exempts a recorded gap from the manifestation kill, discharges or kills on re-verification, places it by files= and defers with a touches trigger; fails_when=a sentence is dropped, the rule moves after the manifestation gate or the placement loses its size cap; why_new=criterion 3; seam=none
  test('a recorded test gap is placed by its files= value and is not a defect claim', () => {
    expect(drain.length).toBeGreaterThan(0);
    expect(flat).toContain('**A recorded test gap is not a defect claim.**');
    expect(flat).toContain('whose tag is `review` with `files=` and whose body has the bullet `**Test gap:** no demonstrated defect` was filed by `/review-and-prep` under `test-gaps=record`');
    expect(flat).toContain('so the manifestation kill below does not apply to it, and it never admits a Track on its own');
    expect(flat).toContain('`discharge` it when a test now covers the behavior, `kill` it when its paths are gone');
    expect(flat).toContain('**place** it as one S task on the first Track in plan order whose `_touches:` cover every `files=` path (the same path, or a path under a directory entry ending `/`)');
    expect(flat).toContain("add the task's proposed test file to that Track's `_touches:`");
    expect(flat).toContain('the one named exception to "proximity to touched files" in **Admission before decomposition**');
    expect(flat).toContain("**defer** it to Future with `**Revisit when:** a Track's `_touches:` cover <paths>.` Re-check that trigger on each run.");
    expect(flat).toContain('or the task would break a size cap (**Sizing discipline**)');
    // The gate it is exempt from still limits itself to defect claims, and admission still refuses proximity alone.
    expect(roadmap).toContain('judges defect claims only');
    expect(roadmap.replace(/\s+/g, ' ')).toContain('future scale and proximity to touched files do not establish necessity');
    expect(roadmap.indexOf('**A recorded test gap is not a defect claim.**')).toBeLessThan(roadmap.indexOf('### Unobserved defects wait for manifestation'));
  });
});

describe('collision-driven grouping prose and shared_docs marker', () => {
  const roadmap = readFileSync(join(ROOT, 'skills', 'roadmap.md'), 'utf8');
  const section = roadmap.slice(
    roadmap.indexOf('### Collision-driven grouping'),
    roadmap.indexOf('### Renumbering'),
  );
  const flat = section.replace(/\s+/g, ' ');

  // Value: protects=Collision-driven grouping instructs regeneration to resolve modules to files and keep bare folders only when the code does not show which files change, explains the (new) collision rule, tells the author to narrow FOLDER_ONLY pairs and re-pack, and documents the roadmap:shared_docs marker and contract link; fails_when=any of the three _touches: rules or the shared_docs marker guidance is dropped or moved out of Collision-driven grouping; why_new=criteria 2 and 3; seam=none
  test('Collision-driven grouping locks file-naming judgment, (new) rule, FOLDER_ONLY, and roadmap:shared_docs marker', () => {
    expect(section.length).toBeGreaterThan(0);
    expect(flat).toContain('bins + `DEPENDS` lines + `CRITICAL_PATH` + `FOLDER_ONLY`');
    expect(flat).toContain(
      '<!-- roadmap:shared_docs=AGENTS.md,docs/runbook.md -->',
    );
    expect(flat).toContain(
      'folder entries and `CLAUDE.md` are ignored, and conflicts in listed docs are left to the base merge',
    );
    expect(flat).toContain(
      'https://github.com/kbitz/gstack-extend/blob/main/docs/collision-contract.md',
    );
    expect(flat).toContain(
      'Never list the file a symlinked `CLAUDE.md` points to (such as `AGENTS.md`): the guard below matches the literal name only.',
    );
    expect(flat).toContain(
      "Resolving a card's named functions or modules to files is the regeneration's judgment: read the code and name each file the work changes, keeping a bare folder entry (ending in `/`) only when the code does not show which files change.",
    );
    expect(flat).toContain(
      'Mark each file the Track creates `path (new)`; a new path collides only with the same path or a folder entry itself marked `(new)`.',
    );
    expect(flat).toContain(
      '`bin/roadmap-pack` lists under `FOLDER_ONLY` each pair that collides only through a folder entry — narrow those entries where the code allows, then re-pack.',
    );
  });

  // Value: protects=Collision-driven grouping keeps the rule that CLAUDE.md is never shared and only one Track per Group may declare it; fails_when=the sentence is removed, CLAUDE.md enters the default shared-docs list, or the section permits sharing CLAUDE.md; why_new=Track 76A criterion 5 locks the CLAUDE.md never-shared sentence with negative cases; seam=none
  test('Collision-driven grouping locks the CLAUDE.md never-shared sentence and rejects sharing it', () => {
    const neverShared = '`CLAUDE.md` is never shared: only one Track per Group may declare it.';
    const checkNeverShared = (text: string): boolean => {
      const normalized = text.replace(/\s+/g, ' ');
      const sharedDocsMatch = /Shared docs \(([^)]+)\) are not collisions\./.exec(normalized);
      if (!sharedDocsMatch || sharedDocsMatch[1]!.includes('CLAUDE.md')) return false;
      if (/`CLAUDE\.md` (?:is|may be|can be) (?:a )?shared/.test(normalized)) return false;
      return normalized.includes(neverShared);
    };

    expect(checkNeverShared(section)).toBe(true);
    const sharedList = /Shared docs \(([^)]+)\) are not collisions\./.exec(flat)?.[1] ?? '';
    expect(sharedList).not.toBe('');
    expect(sharedList).not.toContain('CLAUDE.md');
    expect(flat).not.toMatch(/`CLAUDE\.md` (?:is|may be|can be) (?:a )?shared/);
    expect(checkNeverShared(section.replace(neverShared, ''))).toBe(false);
  });
});

describe('roadmap stage line', () => {
  const raw = readFileSync(join(ROOT, 'skills', 'roadmap.md'), 'utf8');
  const flat = raw.replace(/\s+/g, ' ');

  // Value: protects=standalone /roadmap ends every exit with a stage-handoff/v1 line while preserving the 4-line Run /docs-ship fence and suppressing the line when composed inside /project-spec; fails_when=the Run /docs-ship fence changes, the roadmap stage-line template or exit table drifts, or the composition suppression rule is dropped; why_new=Track 72A gives roadmap a fixed exit line under the contract; seam=none; no_claim=agent behavior (static prose lock)
  test('Step 7 preserves the Run /docs-ship fence, defines the stage line and suppresses it when composed into /project-spec', () => {
    expect(raw).toContain(
      '```text\nRun /docs-ship\nBrief: <PROPOSAL_DIR>/proposal-{ts}.md (the approved proposal)\nAllowed files: <every path the Step 6 commit staged>\nVersion: <Step 5 level and reason, or "no bump">\n```',
    );
    expect(raw).toContain(
      'Stage handoff: stage-handoff/v1; stage: roadmap; next: <docs-ship|none>; status: <done|done-with-concerns|blocked|needs-context>; head: <full HEAD SHA|none>; plan-sha256: none',
    );
    for (const clause of [
      "Under `/project-spec` composition, return these values to the wrapper, which prints the handoff; a run composed into `/project-spec` ends in that skill's Step 3, which prints the stage line, so this step returns its values and prints none.",
      '- **Step 7 `Run /docs-ship` handoff:** `next: docs-ship`, `status: done` or `done-with-concerns` from the rollup, `head` from `git rev-parse HEAD` (the Step 6 commit), `plan-sha256: none`.',
      '- **No commit (nothing was committed):** `next: none`, `status: done` or `done-with-concerns`, `head` from `git rev-parse HEAD`, `plan-sha256: none`.',
      '- **BLOCKED or NEEDS_CONTEXT:** `next: none`, `status: blocked` or `needs-context`, `head` from `git rev-parse HEAD` (or `none` without one), `plan-sha256: none`.',
      "End every standalone `/roadmap` final message, including no-commit, BLOCKED and NEEDS_CONTEXT exits, with Step 7's stage line (`next: none` when no `Run /docs-ship` handoff is printed).",
    ]) {
      expect(flat, clause).toContain(clause);
    }
  });
});

describe('Track 94B roadmap scratch paths and no fixed /tmp redirects', () => {
  const roadmap = readFileSync(join(ROOT, 'skills', 'roadmap.md'), 'utf8');

  const FIXED_TMP_IN_FENCE_RE = /(?:^|[\s"'=><;|&(])\/tmp\//;
  const INLINE_TMP_WRITE_RE =
    /(?:(?:\d|&)?>>?\|?\s*["']?\/tmp\/|\btee\b(?:\s+-[^\s]+)*\s+["']?\/tmp\/|--(?:from|map-file)(?:=|\s+)["']?\/tmp\/)/;

  function findFixedTmpWrites(markdown: string): string[] {
    const hits: string[] = [];
    for (const fence of extractFences(markdown)) {
      for (const rawLine of fence.body.split('\n')) {
        const stripped = rawLine.replace(/\$\{TMPDIR:-\/tmp\}/g, '');
        if (FIXED_TMP_IN_FENCE_RE.test(stripped)) {
          hits.push(`fence(${fence.lang}): ${rawLine.trim()}`);
        }
      }
    }
    const withoutFences = markdown.replace(/^([ \t]*)```[^\n]*\n[\s\S]*?^\1```/gm, '');
    const inlineCodeRe = /`([^`\n]+)`/g;
    let m: RegExpExecArray | null;
    while ((m = inlineCodeRe.exec(withoutFences))) {
      const span = m[1]!.replace(/\$\{TMPDIR:-\/tmp\}/g, '');
      if (INLINE_TMP_WRITE_RE.test(span)) {
        hits.push(`inline: ${m[1]!}`);
      }
    }
    return hits;
  }

  // Value: protects=skills/roadmap.md does not direct writes, redirects, or fixed /tmp/ file paths in shell fences or inline code; fails_when=any fixed /tmp/ redirect, tee target, or --from/--map-file /tmp/ path is reintroduced into skills/roadmap.md; why_new=Track 94B criteria 1 and 3; seam=none; no_claim=agent behavior (static prose lock)
  test('roadmap has no fixed /tmp/ paths or redirects and detector catches synthetic regressions', () => {
    expect(roadmap).not.toContain('/tmp/roadmap-audit.txt');
    expect(roadmap).not.toContain('/tmp/draft-tracks.md');
    expect(roadmap).not.toContain('/tmp/renames.txt');
    expect(findFixedTmpWrites(roadmap)).toEqual([]);

    for (const bad of [
      '```bash\n"$_EXTEND_ROOT/bin/roadmap-audit" "$ROOT" > /tmp/roadmap-audit.txt\n```',
      '```bash\ncmd 2>>/tmp/err.txt\n```',
      '```sh\ncmd > "/tmp/out.txt"\n```',
      '```bash\ncmd | tee -a /tmp/out.txt\n```',
      '```bash\n"$_EXTEND_ROOT/bin/roadmap-pack" "$ROOT" --from /tmp/draft-tracks.md\n```',
      '```bash\n# or: --map-file /tmp/renames.txt\n```',
      'Run `roadmap-audit "$ROOT" > /tmp/audit.txt` first.',
    ]) {
      expect(findFixedTmpWrites(bad).length, bad).toBeGreaterThan(0);
    }

    for (const ok of [
      'Use `<PROPOSAL_DIR>` or `~/scratch/`, never a fixed `/tmp/` path.',
      '```bash\ntmp=$(mktemp -d "${TMPDIR:-/tmp}/foo.XXXXXX")\n```',
    ]) {
      expect(findFixedTmpWrites(ok), ok).toEqual([]);
    }
  });

  // Value: protects=Step 1b prints its first audit to stdout and documents <PROPOSAL_DIR> with ~/scratch/ fallback and no host-private directory, while audit, packer, and renumber keep their arguments; fails_when=Step 1b re-adds a redirect or drops scratch-dir guidance, or audit/pack/renumber invocations lose their root or CLI flags; why_new=Track 94B criteria 2 and 4; seam=none; no_claim=agent behavior (static prose lock)
  test('Step 1b, Collision-driven grouping, and Renumbering preserve invocations and scratch-path guidance', () => {
    const step1b = roadmap.slice(
      roadmap.indexOf('### 1b. Read the roadmap, inbox, and audit'),
      roadmap.indexOf('## Step 2: Regenerate'),
    );
    expect(step1b.length).toBeGreaterThan(0);
    const step1bFence = extractFences(step1b)[0];
    expect(step1bFence?.lang).toBe('bash');
    expect(step1bFence?.body).toContain(
      '"$_EXTEND_ROOT/bin/roadmap-audit" "${_ROADMAP_ROOT:?Paste the resolved project-root assignment}"',
    );
    expect(step1bFence?.body).not.toContain('>');
    const step1bFlat = step1b.replace(/\s+/g, ' ');
    expect(step1bFlat).toContain('<PROPOSAL_DIR>');
    expect(step1bFlat).toContain('~/scratch/');
    expect(step1bFlat).toContain('host-private directory');
    expect(step1bFlat).toContain('Never use a host-private directory or a fixed `/tmp/` path.');

    const grouping = roadmap.slice(
      roadmap.indexOf('### Collision-driven grouping'),
      roadmap.indexOf('### Renumbering'),
    );
    expect(grouping.length).toBeGreaterThan(0);
    const groupingFence = extractFences(grouping)[0];
    expect(grouping.replace(/\s+/g, ' ')).toMatch(/Before invoking `--from`[^.]+confirm the file exists and is nonempty/);
    expect(groupingFence?.lang).toBe('bash');
    expect(groupingFence?.body).toContain(
      '"$_EXTEND_ROOT/bin/roadmap-pack" "${_ROADMAP_ROOT:?Paste the resolved project-root assignment}" --from \'<PROPOSAL_DIR>/<run>/draft-tracks.md\'',
    );
    expect(grouping.replace(/\s+/g, ' ')).toContain(
      '"$_EXTEND_ROOT/bin/roadmap-pack" "${_ROADMAP_ROOT:?Paste the resolved project-root assignment}" --stdin',
    );

    const renumbering = roadmap.slice(
      roadmap.indexOf('### Renumbering'),
      roadmap.indexOf('### Greenfield'),
    );
    expect(renumbering.length).toBeGreaterThan(0);
    const renumberingFence = extractFences(renumbering)[0];
    expect(renumberingFence?.lang).toBe('bash');
    expect(renumberingFence?.body).toContain(
      '"$_EXTEND_ROOT/bin/roadmap-renumber" "${_ROADMAP_ROOT:?Paste the resolved project-root assignment}" --map old=new,old=new --dry-run',
    );
    expect(renumberingFence?.body).toContain("# or: --map-file '<PROPOSAL_DIR>/<run>/renames.txt'");

    const proposal = roadmap.slice(roadmap.indexOf('### Structured proposal artifact'));
    expect(proposal).toContain('create a directory for this run under `~/scratch/`');
    expect(proposal).toContain('create a unique subdirectory of `<PROPOSAL_DIR>` for this run');
    expect(proposal).toContain('substitute the resolved absolute file path for the full placeholder path');
  });

  test('roadmap locks immutable work-item IDs (_id:, bin/roadmap-id mint, ID-based _blocked-by:)', () => {
    const roadmap = readFileSync(join(ROOT, 'skills', 'roadmap.md'), 'utf8');
    expect(roadmap).toContain('_id: wi-<hex>_');
    expect(roadmap).toContain('bin/roadmap-id" mint');
    expect(roadmap).toContain('_blocked-by: wi-a1b2c3, wi-d4e5f6_');
    expect(roadmap).toContain('WORK_ITEM_IDS');
  });
});

test('roadmap consumes both inbox sources, reports landings and commits the intake drain', () => {
  const roadmap = resolverSkillText('roadmap');
  const steps = roadmap.replace(/\s+/g, ' ');
  expect(steps).toContain('Read the full `TODOS.md ## Unprocessed`, each validated intake file');
  const intakeGate = steps.indexOf('`WORK_ITEM_IDS` failures before reading any intake records');
  expect(intakeGate).toBeGreaterThan(-1);
  expect(intakeGate).toBeLessThan(steps.indexOf('each validated intake file'));
  expect(steps).toContain('each record from `TODOS.md` or `docs/todos/*.md`, its filed priority (or unprioritized), and landing');
  expect(steps).toContain('`docs/todos/` file list and raw bytes');
  expect(steps).toContain('is gone from `TODOS.md ## Unprocessed` and `docs/todos/`');
  expect(steps).toContain('removed `docs/todos/<id>.md` files. Commit the deletions with the planning updates.');
  expect(steps).toContain('Report each record from both inbox sources with its filed priority (or unprioritized) and landing');
});

test('roadmap candidate validation excludes drained intake records only in the overlay', () => {
  const scratch = makeBaseTmp('roadmap-intake-promotion-');
  try {
    const project = join(scratch, 'project');
    const docs = join(project, 'docs');
    const intakeRel = 'docs/todos/wi-a1b2c3.md';
    const intake = '### [review] Inbox follow-up\n- **ID:** wi-a1b2c3\n';
    mkdirSync(join(docs, 'todos'), { recursive: true });
    mkdirSync(join(project, 'src'));
    writeFileSync(join(project, 'src', 'a.ts'), 'export {};\n');
    writeFileSync(join(project, 'VERSION'), '0.1.0\n');
    writeFileSync(join(project, intakeRel), intake);
    writeFileSync(join(docs, 'TODOS.md'), '## Unprocessed\n');
    writeFileSync(join(docs, 'roadmap-future.md'), '## Future\n');
    const base = '## In Progress\n\n## Current Plan\n\n## Future\nDeferred: docs/roadmap-future.md (0 items)\n\n## Shipped\nHistory: docs/roadmap-shipped.md\n';
    writeFileSync(join(docs, 'ROADMAP.md'), base);
    const draft = join(scratch, 'draft-roadmap.md');
    const shipped = join(scratch, 'draft-shipped.md');
    const drained = join(scratch, 'drained.txt');
    writeFileSync(draft, base.replace('## Current Plan\n', [
      '## Current Plan', '', '### Group 1: Promoted work', '_Depends on: none_',
      '#### Track 1A: Inbox follow-up', '_1 task . ~20 LOC . low risk_',
      '_id: wi-a1b2c3_', '_touches: src/a.ts_', '- Update the file (~20 lines).', '',
    ].join('\n')));
    writeFileSync(shipped, '## Shipped\n');
    writeFileSync(drained, intakeRel + '\n');
    const reference = referenceText('roadmap', 'conditional-candidate-validation');
    const script = reference.match(/^```typescript\n([\s\S]*?)^```$/m)?.[1];
    expect(script).toBeDefined();
    const command = join(scratch, 'candidate-validation.ts');
    writeFileSync(command, script!);
    const run = (...extra: string[]) => Bun.spawnSync([
      process.execPath, '--no-env-file', '--no-install', '--config=/dev/null',
      command, project, ROOT, draft, shipped, ...extra,
    ], { env: scopedEnv(scratch), stdout: 'pipe', stderr: 'pipe', timeout: 15_000 });
    const sections = (result: ReturnType<typeof run>) => new Map(
      parseAuditSections(result.stdout.toString()).map(section => [section.name, section.body.join('\n')]),
    );
    for (const result of [run(), run('-', '-'), run('-', '-', '-')]) {
      expect(result.exitCode, result.stderr.toString()).toBe(1);
      expect(sections(result).get('WORK_ITEM_IDS')).toContain('DUPLICATE_ID:');
    }
    const emptyDrain = run('-', '-', '');
    expect(emptyDrain.exitCode).toBe(1);
    expect(emptyDrain.stderr.toString()).toContain('Drained intake list needs an absolute path or -');

    const directoryRel = 'docs/todos/wi-111111.md';
    mkdirSync(join(project, directoryRel));
    writeFileSync(drained, intakeRel + '\n' + directoryRel + '\n');
    const directoryDrain = run('-', '-', drained);
    expect(directoryDrain.exitCode).toBe(1);
    expect(directoryDrain.stderr.toString()).toContain('Drained intake paths must name existing canonical intake files');
    rmSync(join(project, directoryRel), { recursive: true });
    writeFileSync(drained, intakeRel + '\n');

    writeFileSync(join(project, intakeRel), intake + '\n### [review] Undrained second record\n');
    const malformedDrain = run('-', '-', drained);
    expect(malformedDrain.exitCode).toBe(1);
    expect(malformedDrain.stderr.toString()).toContain('Resolve selected intake format and ID failures');
    writeFileSync(join(project, intakeRel), intake);

    const promoted = run('-', '-', drained);
    const failures = [...sections(promoted)].filter(([, body]) => body.includes('STATUS: fail'));
    expect(promoted.exitCode, JSON.stringify(failures) + promoted.stderr.toString()).toBe(0);
    expect(sections(promoted).get('WORK_ITEM_IDS')).toContain('STATUS: pass');
    expect(sections(promoted).get('UNPROCESSED')).toContain('STATUS: empty');
    expect(sections(promoted).get('DOC_INVENTORY')).not.toContain(intakeRel);
    expect(readFileSync(join(project, intakeRel), 'utf8')).toBe(intake);

    const placement = readFileSync(draft, 'utf8');
    const liveRoadmap = join(docs, 'ROADMAP.md');
    writeFileSync(liveRoadmap, placement);
    const resumedDrain = run('-', '-', drained);
    expect(resumedDrain.exitCode, resumedDrain.stderr.toString()).toBe(0);
    expect(sections(resumedDrain).get('WORK_ITEM_IDS')).toContain('STATUS: pass');
    expect(readFileSync(liveRoadmap, 'utf8')).toBe(placement);
    expect(readFileSync(join(project, intakeRel), 'utf8')).toBe(intake);

    writeFileSync(liveRoadmap, base);
    const legacyTodos = join(docs, 'TODOS.md');
    const legacy = '## Unprocessed\n\n- [review] Legacy migration\n';
    writeFileSync(legacyTodos, legacy);
    const todosDraft = join(scratch, 'draft-todos.md');
    writeFileSync(todosDraft, '## Unprocessed\n');
    const migratedDrain = run(todosDraft, '-', drained);
    expect(migratedDrain.exitCode, migratedDrain.stderr.toString()).toBe(0);
    expect(sections(migratedDrain).get('TODO_FORMAT')).toContain('STATUS: pass');
    expect(sections(migratedDrain).get('WORK_ITEM_IDS')).toContain('STATUS: pass');
    expect(readFileSync(legacyTodos, 'utf8')).toBe(legacy);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

describe('one-task Tracks for existing code paths sizing rule', () => {
  const roadmap = readFileSync(join(ROOT, 'skills', 'roadmap.md'), 'utf8');
  const sizingStart = roadmap.indexOf('### Sizing discipline');
  const groupingStart = roadmap.indexOf('### Collision-driven grouping');
  const renumberingStart = roadmap.indexOf('### Renumbering');
  const proposalStart = roadmap.indexOf('### Structured proposal artifact');
  const summaryStart = roadmap.indexOf('## Summary', proposalStart);
  const dischargedStart = roadmap.indexOf('## Discharged', summaryStart);

  const sizing = roadmap.slice(sizingStart, groupingStart);
  const grouping = roadmap.slice(groupingStart, renumberingStart);
  const proposalSummary = roadmap.slice(summaryStart, dischargedStart);

  const ruleLead = '**One-task Tracks for existing code paths.**';
  const scopeLead = '**The card is the scope.**';
  const ruleStart = sizing.indexOf(ruleLead);
  const scopeStart = sizing.indexOf(scopeLead);
  const oneTaskSubsection =
    ruleStart >= 0 && scopeStart > ruleStart ? sizing.slice(ruleStart, scopeStart) : '';

  const NUMERIC_TRIGGER_RE = /\b\d+\s*(?:lines?|LOC|tasks?|items?)\b/i;

  const checkOneTaskSplittingRule = (text: string): boolean => {
    const flat = text.replace(/\s+/g, ' ');
    if (!flat.includes(ruleLead)) return false;
    if (!flat.includes('When a card changes existing code paths, default to one-task Tracks')) return false;
    if (!flat.includes('one PR each')) return false;
    if (!flat.includes('qualitative judgment in skill prose')) return false;
    if (!flat.includes('never use a line-count, task-count, or other numeric threshold to trigger a split')) return false;
    if (!flat.includes("remain the audit's mechanical ceiling, not the decomposition rule")) return false;
    if (!flat.includes('**0-to-1 exception**')) return false;
    if (!flat.includes("new module's first version")) return false;
    if (!flat.includes('cannot ship meaningfully on their own')) return false;
    if (!flat.includes('**same-files exception**')) return false;
    if (!flat.includes('edit the same files and force strictly sequential PRs')) return false;
    if (!flat.includes('cannot ship cleanly alone')) return false;
    if (!flat.includes('separate concerns or trust boundaries')) return false;
    const withoutZeroToOne = flat.replace(/\b0-to-1\b/g, '');
    if (NUMERIC_TRIGGER_RE.test(withoutZeroToOne)) return false;
    return true;
  };

  const summarySizingLine =
    '- Card sizing decisions: each card split into one-task Tracks and each multi-task card kept whole, with the reason (existing code paths split, 0-to-1 exception, or same-files exception; or none)';

  const checkProposalSummarySizing = (text: string): boolean => {
    const flat = text.replace(/\s+/g, ' ');
    return (
      flat.includes('Card sizing decisions:') &&
      flat.includes('each card split into one-task Tracks') &&
      flat.includes('each multi-task card kept whole, with the reason') &&
      flat.includes('0-to-1 exception') &&
      flat.includes('same-files exception')
    );
  };

  // Value: protects=Sizing discipline states the qualitative one-task default for existing code paths, honours both the 0-to-1 and same-files exceptions, keeps Collision-driven grouping's same-files note, and rejects numeric line/task triggers; fails_when=a required clause is dropped, moved out of Sizing discipline, or a numeric trigger is added; why_new=plan criteria 1, 3, and 4; seam=none
  test('Sizing discipline locks the qualitative one-task rule, 0-to-1 and same-files exceptions, and no numeric triggers', () => {
    expect(sizingStart).toBeGreaterThan(-1);
    expect(groupingStart).toBeGreaterThan(sizingStart);
    expect(renumberingStart).toBeGreaterThan(groupingStart);
    expect(sizing.length).toBeGreaterThan(0);
    expect(grouping.length).toBeGreaterThan(0);
    expect(oneTaskSubsection.length).toBeGreaterThan(0);

    expect(checkOneTaskSplittingRule(oneTaskSubsection)).toBe(true);
    expect(grouping.replace(/\s+/g, ' ')).toContain(
      'Same files → different Groups (or one merged Track).',
    );

    // Synthetic failing mutations prove the helper rejects dropped clauses and injected numeric triggers.
    expect(checkOneTaskSplittingRule(oneTaskSubsection.replace('**0-to-1 exception**', ''))).toBe(false);
    expect(checkOneTaskSplittingRule(oneTaskSubsection.replace('**same-files exception**', ''))).toBe(false);
    expect(checkOneTaskSplittingRule(`${oneTaskSubsection} Split cards over 200 lines.`)).toBe(false);
    expect(checkOneTaskSplittingRule(`${oneTaskSubsection} Split cards with 3 tasks.`)).toBe(false);
  });

  // Value: protects=Structured proposal artifact Summary requires naming each card split into one-task Tracks and each multi-task card kept whole with its reason; fails_when=the Card sizing decisions bullet is removed or weakened; why_new=plan criteria 2 and 3; seam=none
  test('proposal Summary requires naming each split and kept-whole card with its reason', () => {
    expect(proposalStart).toBeGreaterThan(-1);
    expect(summaryStart).toBeGreaterThan(proposalStart);
    expect(dischargedStart).toBeGreaterThan(summaryStart);
    expect(proposalSummary.length).toBeGreaterThan(0);

    expect(proposalSummary).toContain(summarySizingLine);
    expect(checkProposalSummarySizing(proposalSummary)).toBe(true);
    expect(checkProposalSummarySizing(proposalSummary.replace(summarySizingLine, ''))).toBe(false);
  });
});
