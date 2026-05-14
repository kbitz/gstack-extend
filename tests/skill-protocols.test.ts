/**
 * skill-protocols.test.ts — assert every skill file has the shared
 * protocol sections grafted in v0.11.0 and the REPORT table sections
 * grafted in v0.12.0.
 *
 * Each skill must contain:
 *   - Completion Status Protocol (with the full 4-status enum)
 *   - Escalation format (BLOCKED / NEEDS_CONTEXT path)
 *   - Confusion Protocol
 *   - GSTACK REVIEW REPORT section (with required table tokens)
 *
 * Plus four verbatim graft blocks shared across all 5 skills (HTML
 * markers make the shared-ness legible to humans). Plus roadmap-only
 * verbatim blocks (fast-path output, proposal artifact path, cluster
 * structural). Plus pair-review's multi-table per-group + session-rollup
 * templates.
 *
 * Migrated from scripts/test-skill-protocols.sh (deleted in Track 3A).
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');

const SKILLS = ['pair-review', 'roadmap', 'full-review', 'review-apparatus', 'test-plan'] as const;

// gstack-extend-upgrade is a thin utility skill (mirrors gstack's own
// gstack-upgrade): it carries the SHARED:upgrade-flow block and the two-path
// preamble probe, but NOT the workflow-skill protocol boilerplate (Completion
// Status Protocol, Confusion Protocol, GSTACK REVIEW REPORT table). So the
// protocol assertions below iterate SKILLS (5) while the upgrade-flow and
// preamble-probe assertions iterate PREAMBLE_SKILLS (6). This split is
// intentional — do not collapse it back to one list.
const PREAMBLE_SKILLS = [...SKILLS, 'gstack-extend-upgrade'] as const;

const REQUIRED_SECTIONS = [
  '## Completion Status Protocol',
  '### Escalation',
  '## Confusion Protocol',
];

const REQUIRED_STATUS_TOKENS = [
  '**DONE**',
  '**DONE_WITH_CONCERNS**',
  '**BLOCKED**',
  '**NEEDS_CONTEXT**',
];

const REQUIRED_ESCALATION_FIELDS = [
  'STATUS: BLOCKED | NEEDS_CONTEXT',
  'REASON:',
  'ATTEMPTED:',
  'RECOMMENDATION:',
];

const REQUIRED_REPORT_TOKENS = [
  'GSTACK REVIEW REPORT',
  '| Trigger |',
  '| Why |',
  '| Runs |',
  '| Status |',
  '| Findings |',
  '**VERDICT:**',
];

// First-col header: must contain at least one. Roadmap/full-review use "Review"
// (single-row dashboard); pair-review uses "Group" (multi-row session rollup).
const REQUIRED_FIRST_COL_ANY = ['| Review |', '| Group |'];

// ─── Verbatim graft blocks (shared across all 5 skills) ──────────────
//
// These fragments must appear byte-identical in every skill file. They
// represent the shared parts of cross-skill protocol grafts. Per-skill
// customization lives OUTSIDE these blocks. Updates to a shared fragment
// are a deliberate two-step: edit the expected block here, run tests
// (they fail), propagate the new text to all 5 skills.
//
// The <!-- SHARED:... --> HTML markers are part of each block — invisible
// to agents reading the prose but legible to humans, and a future
// SKILL.md.tmpl extraction can grep for them.

const BLOCK_COMPLETION_STATUS_ENUM = `<!-- SHARED:completion-status-enum -->
## Completion Status Protocol

When completing a skill workflow, report status using one of:

- **DONE** — All steps completed successfully. Evidence provided for each claim.
- **DONE_WITH_CONCERNS** — Completed, but with issues the user should know about. List each concern.
- **BLOCKED** — Cannot proceed. State what is blocking and what was tried.
- **NEEDS_CONTEXT** — Missing information required to continue. State exactly what you need.
<!-- /SHARED:completion-status-enum -->`;

const BLOCK_ESCALATION_OPENER = `<!-- SHARED:escalation-opener -->
### Escalation

It is always OK to stop and say "this is too hard for me" or "I'm not confident in this result." Bad work is worse than no work. You will not be penalized for escalating.
<!-- /SHARED:escalation-opener -->`;

const BLOCK_ESCALATION_FORMAT = `<!-- SHARED:escalation-format -->
Escalation format:

\`\`\`
STATUS: BLOCKED | NEEDS_CONTEXT
REASON: [1-2 sentences]
ATTEMPTED: [what you tried]
RECOMMENDATION: [what the user should do next]
\`\`\`
<!-- /SHARED:escalation-format -->`;

const BLOCK_CONFUSION_HEAD = `<!-- SHARED:confusion-head -->
## Confusion Protocol

When you encounter high-stakes ambiguity during this workflow:
<!-- /SHARED:confusion-head -->`;

const VERBATIM_BLOCKS: Array<{ block: string; label: string }> = [
  { block: BLOCK_COMPLETION_STATUS_ENUM, label: 'completion-status-enum' },
  { block: BLOCK_ESCALATION_OPENER, label: 'escalation-opener' },
  { block: BLOCK_ESCALATION_FORMAT, label: 'escalation-format' },
  { block: BLOCK_CONFUSION_HEAD, label: 'confusion-head' },
];

// ─── Roadmap-only verbatim assertions ─────────────────────────────────
//
// These strings live in skills/roadmap.md only. Load-bearing for the
// proposal artifact format. Proposal artifact path lives at
// `~/.gstack/projects/<slug>/roadmap-proposals/` (durable, mirrors gstack's
// checkpoints/ pattern); the skill resolves the concrete dir via
// session_dir roadmap-proposals.
const BLOCK_ROADMAP_PROPOSAL_PATH = '<PROPOSAL_DIR>/proposal-{ts}.md';
const BLOCK_ROADMAP_PROPOSAL_HELPER_CALL = 'session_dir roadmap-proposals';

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
  { block: BLOCK_LAYOUT_SCAFFOLDING_HEADING, label: 'layout-scaffolding-section' },
  { block: BLOCK_LAYOUT_GIT_REV_PARSE, label: 'layout-git-rev-parse-preflight' },
  { block: BLOCK_LAYOUT_GIT_LS_FILES, label: 'layout-git-ls-files-tracked-check' },
  { block: BLOCK_LAYOUT_INBOX_BLOCK_REASON, label: 'layout-inbox-block-reason' },
  { block: BLOCK_LAYOUT_IDEMPOTENT_NOTE, label: 'layout-idempotent-re-run' },
];

// ─── Tests ───────────────────────────────────────────────────────────

describe('skill protocol assertions', () => {
  for (const skill of SKILLS) {
    const file = join(ROOT, 'skills', `${skill}.md`);
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      test(`skills/${skill}.md exists`, () => {
        throw new Error(`Missing: ${file}`);
      });
      continue;
    }

    test(`skills/${skill}.md exists`, () => {
      expect(content.length).toBeGreaterThan(0);
    });

    for (const section of REQUIRED_SECTIONS) {
      test(`${skill} contains section: ${section}`, () => {
        expect(content).toContain(section);
      });
    }

    for (const token of REQUIRED_STATUS_TOKENS) {
      test(`${skill} contains status token: ${token}`, () => {
        expect(content).toContain(token);
      });
    }

    for (const field of REQUIRED_ESCALATION_FIELDS) {
      test(`${skill} contains escalation field: ${field}`, () => {
        expect(content).toContain(field);
      });
    }

    for (const token of REQUIRED_REPORT_TOKENS) {
      test(`${skill} contains REPORT token: ${token}`, () => {
        expect(content).toContain(token);
      });
    }

    test(`${skill} contains first-column header (Review or Group)`, () => {
      const matched = REQUIRED_FIRST_COL_ANY.some((t) => content.includes(t));
      if (!matched) {
        throw new Error(
          `Missing first-column header (expected one of ${REQUIRED_FIRST_COL_ANY.join(', ')}) in ${file}`,
        );
      }
    });
  }
});

describe('verbatim graft blocks (shared across all 5 skills)', () => {
  for (const skill of SKILLS) {
    const file = join(ROOT, 'skills', `${skill}.md`);
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const { block, label } of VERBATIM_BLOCKS) {
      test(`${skill} contains verbatim block: ${label}`, () => {
        if (!content.includes(block)) {
          throw new Error(
            `${skill} drift in '${label}' — propagate canonical text from tests/skill-protocols.test.ts`,
          );
        }
      });
    }
  }
});

// ─── Track 10A: SHARED:upgrade-flow verbatim block (drift-lock, 6 files) ──
//
// The upgrade flow used to be inlined — and silently divergent — across the 5
// workflow preambles. Track 10A consolidated it into ONE canonical block,
// sourced from skills/gstack-extend-upgrade.md and embedded byte-identically
// in all 6 files (5 workflow preambles + the standalone upgrade skill). The
// canonical text is extracted from the upgrade skill itself rather than
// duplicated here — the skill file IS the source of truth.
const UPGRADE_FLOW_RE = /<!-- SHARED:upgrade-flow -->[\s\S]*?<!-- \/SHARED:upgrade-flow -->/;
const upgradeSkillContent = readFileSync(
  join(ROOT, 'skills', 'gstack-extend-upgrade.md'),
  'utf8',
);
const upgradeFlowMatch = UPGRADE_FLOW_RE.exec(upgradeSkillContent);
const CANONICAL_UPGRADE_FLOW = upgradeFlowMatch ? upgradeFlowMatch[0] : '';

describe('Track 10A SHARED:upgrade-flow block', () => {
  test('canonical block is present in skills/gstack-extend-upgrade.md', () => {
    if (!CANONICAL_UPGRADE_FLOW) {
      throw new Error(
        'No <!-- SHARED:upgrade-flow --> ... <!-- /SHARED:upgrade-flow --> block in skills/gstack-extend-upgrade.md',
      );
    }
  });

  // Load-bearing strings — a reworded canonical block could stay byte-identical
  // across all 6 files yet silently drop the D9/D10 guarantees. Pin them.
  test('canonical block keeps the absent-UPGRADE_OK failure gate (D9)', () => {
    expect(CANONICAL_UPGRADE_FLOW).toContain('Treat absent `UPGRADE_OK` as failure');
  });
  test('canonical block keeps the auto_upgrade-after-success ordering (D10)', () => {
    expect(CANONICAL_UPGRADE_FLOW).toContain(
      'Only on a confirmed `UPGRADE_OK <old> <new>`, enable auto-upgrade',
    );
  });

  for (const skill of PREAMBLE_SKILLS) {
    const file = join(ROOT, 'skills', `${skill}.md`);
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    test(`${skill} embeds the canonical SHARED:upgrade-flow block`, () => {
      if (!CANONICAL_UPGRADE_FLOW) return; // covered by the presence test above
      if (!content.includes(CANONICAL_UPGRADE_FLOW)) {
        throw new Error(
          `${skill} drift in SHARED:upgrade-flow — propagate canonical text from skills/gstack-extend-upgrade.md`,
        );
      }
    });
  }
});

describe('Track 10A old inline-flow content removed', () => {
  // Negative assertions: prove the consolidation REPLACED the old per-skill
  // inline flows rather than appending alongside them. These tokens were
  // load-bearing in the pre-Track-10A divergent copies — the truncated
  // cross-reference and the broken `git pull` recovery command. (The old
  // bootstrap pattern is NOT a usable negative token: each skill has a
  // second, out-of-scope `_EXTEND_ROOT` computation for session-paths that
  // legitimately still uses it.)
  const REMOVED_TOKENS = [
    'Handle responses the same way as /pair-review',
    'git -C $_EXTEND_ROOT pull',
  ];
  for (const skill of SKILLS) {
    const file = join(ROOT, 'skills', `${skill}.md`);
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const token of REMOVED_TOKENS) {
      test(`${skill} no longer contains pre-Track-10A token: ${token}`, () => {
        expect(content).not.toContain(token);
      });
    }
  }
});

describe('Track 10A D7 bootstrap empty-guard', () => {
  // Positive assertion: the update-check preamble bootstrap guards on a
  // non-empty _SKILL_SRC before deriving _EXTEND_ROOT. Without the guard,
  // a failed readlink left _EXTEND_ROOT="." and `[ -x ./bin/update-check ]`
  // could execute a script from the caller's cwd. All 6 preamble skills
  // carry the guarded form.
  const D7_GUARD = '[ -n "$_SKILL_SRC" ] && _EXTEND_ROOT=$(dirname "$(dirname "$_SKILL_SRC")")';
  for (const skill of PREAMBLE_SKILLS) {
    const file = join(ROOT, 'skills', `${skill}.md`);
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    test(`${skill} preamble bootstrap has the _SKILL_SRC empty-guard`, () => {
      expect(content).toContain(D7_GUARD);
    });
  }
});

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
          `roadmap drift in '${label}' — propagate canonical text from tests/skill-protocols.test.ts`,
        );
      }
    });
  }
});

describe('pair-review multi-table templates', () => {
  const file = join(ROOT, 'skills', 'pair-review.md');
  const content = readFileSync(file, 'utf8');

  test('contains per-group mini-table template', () => {
    expect(content).toContain('GSTACK REVIEW REPORT — <group-name> group');
  });

  test('contains session-done rollup template', () => {
    expect(content).toContain('GSTACK REVIEW REPORT — session rollup');
  });
});

// ─── Per-branch session-path drift-lock ─────────────────────────────
//
// pair-review sessions are now keyed by branch: SESSION_DIR resolves to
// `<PR_PROJECT_DIR>/branches/<sanitized-branch>/`. The old stale-branch
// guard (which auto-archived sessions on branch mismatch) is no longer
// needed — different branches simply live at different paths. Lock the
// new shape so a future edit can't silently regress to the single-slot
// design.
describe('pair-review per-branch session paths', () => {
  const file = join(ROOT, 'skills', 'pair-review.md');
  const content = readFileSync(file, 'utf8');

  test('preamble resolves SESSION_DIR with branch arg', () => {
    expect(content).toContain('session_dir pair-review "$BRANCH"');
  });

  test('preamble resolves PROJECT_DIR (no branch)', () => {
    // The branchless call still exists for project-level resources (deploy.md).
    expect(content).toMatch(/PROJECT_DIR=\$\(session_dir pair-review\)/);
  });

  test('Active Session Guard does not contain the legacy stale-branch awk', () => {
    // The auto-archive-on-mismatch logic is dead code now; if a future edit
    // re-introduces the awk parse it likely means we regressed to one-slot.
    expect(content).not.toContain(`awk -F': *' '$1=="branch" {print $2; exit}'`);
  });

  test('Active Session Guard archives with per-branch arg', () => {
    const idx = content.indexOf('## Active Session Guard');
    expect(idx).toBeGreaterThan(-1);
    const next = content.indexOf('## ', idx + 3);
    const section = content.slice(idx, next === -1 ? undefined : next);
    expect(section).toContain('session_archive_dir pair-review "$TS" "$BRANCH"');
  });
});

// ─── Track 5A: skill preamble two-path probe (drift-lock) ────────────
//
// Each skill preamble probes path 1 (~/.claude/skills/{name}/SKILL.md)
// then path 2 (.claude/skills/{name}/SKILL.md) as a vendored-install
// fallback. The two-line readlink is identical-shaped across all 6 preamble
// skills (the 5 workflow skills + gstack-extend-upgrade) — assert presence
// here so a future PR can't drop the path-2 fallthrough from one skill while
// keeping it in the others.
//
// Mirrors gstack core's preamble probe pattern. See CHANGELOG v0.18.14.

describe('Track 5A two-path preamble probe (path-2 fallthrough)', () => {
  for (const skill of PREAMBLE_SKILLS) {
    const file = join(ROOT, 'skills', `${skill}.md`);
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    test(`${skill} preamble probes ~/.claude/skills/${skill}/SKILL.md (path 1)`, () => {
      expect(content).toContain(`readlink ~/.claude/skills/${skill}/SKILL.md 2>/dev/null`);
    });
    test(`${skill} preamble falls back to .claude/skills/${skill}/SKILL.md (path 2)`, () => {
      expect(content).toContain(`readlink .claude/skills/${skill}/SKILL.md 2>/dev/null`);
    });
  }
});

// ─── Track 5A: cross-skill inline-Read in test-plan.md ───────────────
//
// skills/test-plan.md Phase 8 reads pair-review.md inline. The original
// hardcoded `~/.claude/skills/pair-review/SKILL.md` path silently breaks
// on vendored installs. The prose was updated to instruct the agent to
// try path 1 first, fall back to path 2. Lock the prose change so a
// future edit can't drop the fallback.

describe('Track 5A test-plan.md cross-skill probe (Phase 8 inline-Read)', () => {
  const file = join(ROOT, 'skills', 'test-plan.md');
  const content = readFileSync(file, 'utf8');

  test('Phase 8 inline pair-review read mentions both probe paths', () => {
    // Path 1: the standard global install location.
    expect(content).toContain('~/.claude/skills/pair-review/SKILL.md');
    // Path 2: the vendored install fallback.
    expect(content).toContain('.claude/skills/pair-review/SKILL.md');
  });

  test('Phase 8 prose explicitly instructs the agent to fall back', () => {
    // Lock the actionable verb so future edits don't reduce this to a
    // single-path read by accident.
    expect(content).toMatch(/fall back to.+\.claude\/skills\/pair-review\/SKILL\.md/);
  });
});

// ─── Session-paths helper drift-lock ─────────────────────────────────
//
// State for /pair-review, /full-review, /roadmap moved off `.context/<skill>/`
// (workspace-local) onto `~/.gstack/projects/<slug>/<skill>/` (durable, mirrors
// gstack /context-save's checkpoints/ shape). Each affected skill must source
// bin/lib/session-paths.sh and call session_dir with its own skill name (or
// pair-review's, in test-plan's case). Lock the call site so a future edit
// can't accidentally regress to `.context/`.

const SESSION_DIR_CALLERS: Array<{ skill: string; call: string }> = [
  { skill: 'pair-review', call: 'session_dir pair-review' },
  { skill: 'full-review', call: 'session_dir full-review' },
  { skill: 'roadmap', call: 'session_dir roadmap-proposals' },
  // test-plan writes into pair-review's session dir, so it calls session_dir
  // pair-review (not session_dir test-plan).
  { skill: 'test-plan', call: 'session_dir pair-review' },
];

describe('session-paths helper drift-lock', () => {
  for (const { skill, call } of SESSION_DIR_CALLERS) {
    const file = join(ROOT, 'skills', `${skill}.md`);
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    test(`${skill}.md sources bin/lib/session-paths.sh`, () => {
      expect(content).toContain('bin/lib/session-paths.sh');
    });
    test(`${skill}.md calls ${call}`, () => {
      expect(content).toContain(call);
    });
    test(`${skill}.md no longer references .context/${skill === 'test-plan' ? 'pair-review' : skill}/`, () => {
      const oldPath = `.context/${skill === 'test-plan' ? 'pair-review' : skill}/`;
      expect(content).not.toContain(oldPath);
    });
  }
});
