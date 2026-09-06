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
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CANONICAL_SECTIONS, OPTIONAL_SECTIONS } from '../src/audit/sections.ts';
import { parseSetupSkills } from './helpers/parse-setup-skills.ts';
import { EXPECTED_SETUP_SKILLS } from './helpers/expected-setup-skills.ts';

const ROOT = join(import.meta.dir, '..');

// Three named cohorts. Do not derive protocol membership from setup's
// install list — init and review-and-prep are utility/orchestration skills
// without the legacy SHARED protocol / telemetry / Conductor blocks.
// 16A–D: do not touch <!-- SHARED:… --> blocks. Item 2/3 of the Conductor
// rule stay per-skill. Keep "Action receipt format".
// 17A: SHARED:conductor-visibility-head is a Conductor host workaround,
// not tmpl-universal — do not inherit it blindly.
const PROTOCOL_SKILLS = [
  'pair-review',
  'roadmap',
  'full-review',
  'review-apparatus',
  'test-plan',
] as const;
const PREAMBLE_SKILLS = [...PROTOCOL_SKILLS, 'gstack-extend-upgrade'] as const;
const CONDUCTOR_SKILLS = [
  'pair-review',
  'full-review',
  'review-apparatus',
  'test-plan',
] as const;

const SKILLS = PROTOCOL_SKILLS;

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

// ─── Track 13A: telemetry-preamble + telemetry-epilogue blocks ──────────
//
// The 5 extend skills carry two bash blocks each (preamble + epilogue) that
// emit telemetry to ~/.gstack/analytics/skill-usage.jsonl with --source
// gstack-extend marking. Only the `_GE_SKILL="extend:<name>"` line differs
// per skill; everything else is byte-identical across the cohort.
//
// Rather than redefining the canonical text in TypeScript (escaping bash
// `${...}` interpolations and `\n` printf sequences is fragile), we extract
// each block from skills/full-review.md as the canonical source, then
// template the skill name to match the file under test. Mirrors the
// Track 10A SHARED:upgrade-flow extraction pattern below.
const TELEMETRY_PREAMBLE_RE = /<!-- SHARED:telemetry-preamble -->[\s\S]*?<!-- \/SHARED:telemetry-preamble -->/;
const TELEMETRY_EPILOGUE_RE = /<!-- SHARED:telemetry-epilogue -->[\s\S]*?<!-- \/SHARED:telemetry-epilogue -->/;
const fullReviewContent = readFileSync(join(ROOT, 'skills', 'full-review.md'), 'utf8');
const PREAMBLE_MATCH = TELEMETRY_PREAMBLE_RE.exec(fullReviewContent);
const EPILOGUE_MATCH = TELEMETRY_EPILOGUE_RE.exec(fullReviewContent);
const CANONICAL_TELEMETRY_PREAMBLE = PREAMBLE_MATCH ? PREAMBLE_MATCH[0] : '';
const CANONICAL_TELEMETRY_EPILOGUE = EPILOGUE_MATCH ? EPILOGUE_MATCH[0] : '';

function telemetryPreambleFor(skill: string): string {
  return CANONICAL_TELEMETRY_PREAMBLE.replaceAll('"extend:full-review"', `"extend:${skill}"`);
}
function telemetryEpilogueFor(skill: string): string {
  return CANONICAL_TELEMETRY_EPILOGUE.replaceAll('"extend:full-review"', `"extend:${skill}"`);
}

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

describe('Track 13A telemetry blocks (per-skill, byte-identical modulo skill name)', () => {
  test('canonical preamble block extracted from skills/full-review.md', () => {
    expect(CANONICAL_TELEMETRY_PREAMBLE).not.toBe('');
    expect(CANONICAL_TELEMETRY_PREAMBLE).toContain('<!-- SHARED:telemetry-preamble -->');
    expect(CANONICAL_TELEMETRY_PREAMBLE).toContain('_GE_SKILL="extend:full-review"');
    expect(CANONICAL_TELEMETRY_PREAMBLE).toContain('source":"gstack-extend"');
    expect(CANONICAL_TELEMETRY_PREAMBLE).toContain('GE_TELEMETRY: session=');
  });
  test('canonical epilogue block extracted from skills/full-review.md', () => {
    expect(CANONICAL_TELEMETRY_EPILOGUE).not.toBe('');
    expect(CANONICAL_TELEMETRY_EPILOGUE).toContain('<!-- SHARED:telemetry-epilogue -->');
    expect(CANONICAL_TELEMETRY_EPILOGUE).toContain('_GE_SKILL="extend:full-review"');
    expect(CANONICAL_TELEMETRY_EPILOGUE).toContain('bin/gstack-extend-telemetry');
    expect(CANONICAL_TELEMETRY_EPILOGUE).toContain('--session-id "$_GE_SESSION_ID"');
  });

  for (const skill of SKILLS) {
    const file = join(ROOT, 'skills', `${skill}.md`);
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    test(`${skill} embeds the canonical telemetry-preamble block (skill name: extend:${skill})`, () => {
      const expected = telemetryPreambleFor(skill);
      if (!content.includes(expected)) {
        throw new Error(
          `${skill} drift in SHARED:telemetry-preamble — propagate canonical text from skills/full-review.md`,
        );
      }
    });
    test(`${skill} embeds the canonical telemetry-epilogue block (skill name: extend:${skill})`, () => {
      const expected = telemetryEpilogueFor(skill);
      if (!content.includes(expected)) {
        throw new Error(
          `${skill} drift in SHARED:telemetry-epilogue — propagate canonical text from skills/full-review.md`,
        );
      }
    });
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
    test(`${skill} preamble probes ~/.codex/skills/${skill}/SKILL.md`, () => {
      expect(content).toContain(`readlink ~/.codex/skills/${skill}/SKILL.md 2>/dev/null`);
    });
    test(`${skill} preamble probes ~/.config/opencode/skills/${skill}/SKILL.md`, () => {
      expect(content).toContain(`readlink ~/.config/opencode/skills/${skill}/SKILL.md 2>/dev/null`);
    });
    test(`${skill} preamble falls back to .claude/skills/${skill}/SKILL.md (vendored)`, () => {
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
    expect(content).toContain('~/.codex/skills/pair-review/SKILL.md');
    expect(content).toContain('~/.config/opencode/skills/pair-review/SKILL.md');
    expect(content).toContain('.claude/skills/pair-review/SKILL.md');
  });

  test('Phase 8 prose explicitly instructs the agent to fall back', () => {
    // Lock the actionable verb so future edits don't reduce this to a
    // single-path read by accident.
    expect(content).toMatch(/fall back to[\s\S]+\.claude\/skills\/pair-review\/SKILL\.md/);
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

// ─── Smart-batching coverage feature drift-locks ─────────────────────
//
// /pair-review smart-batching adds plan-time coverage hints, a post-PASS
// bundle prompt, a PASSED_BY_COVERAGE terminal status, FAIL-time E3
// demotion of bundled items, a Phase 3 COVERAGE dashboard sub-block, and
// Phase 4 report savings/acceptance/warnings lines. The skill is a markdown
// prompt file (not executable code), so these invariants lock the prose
// patterns that the agent reads at runtime. If a future edit silently
// strips one of these load-bearing constructs, the feature degrades to
// the pre-coverage behavior without any code-level signal.

describe('pair-review smart-batching: coverage feature drift-locks', () => {
  const file = join(ROOT, 'skills', 'pair-review.md');
  const content = readFileSync(file, 'utf8');

  test('canonical "terminal-passed statuses" definition exists', () => {
    // F1 prose-as-code: the named-reference pattern that filter sites
    // throughout the skill use instead of inline-enumerating PASSED +
    // PASSED_BY_COVERAGE. Drift here means filter sites diverge.
    expect(content).toContain('**Terminal-passed statuses**: PASSED or PASSED_BY_COVERAGE');
  });

  test('terminal-passed statuses referenced at known filter sites', () => {
    // The phrase must appear at multiple filter sites — not just the
    // definition. If a site falls back to inline-PASSED, this fails.
    const occurrences = content.match(/terminal-passed statuses/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(4);
  });

  test('PASSED_BY_COVERAGE status enum value present', () => {
    expect(content).toContain('PASSED_BY_COVERAGE');
  });

  test('Covers field in item-format spec block', () => {
    expect(content).toContain('- Covers: [<item-indices>]');
  });

  test('CoverageNote field in item-format spec block', () => {
    expect(content).toContain('- CoverageNote: <text>');
  });

  test('session.yaml summary includes coverage counters', () => {
    expect(content).toContain('passed_by_coverage:');
    expect(content).toContain('bundles_offered:');
    expect(content).toContain('bundles_accepted:');
    expect(content).toContain('bundles_rejected:');
  });

  test('coverage_warnings is a single list with phase tag (ER2)', () => {
    // F3 DRY win: one list + phase tag, not two parallel lists.
    expect(content).toContain('coverage_warnings:');
    expect(content).not.toContain('coverage_inference_warnings');
    // phase tag must be referenced near the schema definition
    const idx = content.indexOf('coverage_warnings:');
    expect(content.slice(idx, idx + 200)).toMatch(/phase:\s*inference\s*\|\s*resume/);
  });

  test('transitive coverage explicit non-support note exists', () => {
    expect(content).toMatch(
      /Transitive coverage is explicitly NOT supported/,
    );
  });

  test('inference heuristic names present (3 heuristics)', () => {
    expect(content).toContain('Same-prerequisite-action');
    expect(content).toContain('Strict subset');
    expect(content).toContain('Same observation, different framing');
  });

  test('validation rules (4) named in skill prose', () => {
    expect(content).toContain('No self-reference');
    expect(content).toContain('No cycles');
    expect(content).toContain('Existence');
    expect(content).toContain('Intra-group');
  });

  test('cycle-handling rule names SCC and highest-index tiebreak', () => {
    // Determinism is testable. The prose must lock the policy so a future
    // edit doesn't reduce it to a vague "drop one edge."
    expect(content).toContain('strongly connected component');
    expect(content).toMatch(/highest item index/i);
  });

  test('F2: load-bearing E3 re-read sentence exists', () => {
    // Without this sentence, lookahead-invalidation degrades silently:
    // the next prompt may use stale N+1 description from before the FAIL,
    // skipping past a newly-demoted UNTESTED item. Match the load-bearing
    // fragments rather than the exact wrapped-prose layout (whitespace can
    // legitimately shift with future markdown edits).
    const normalized = content.replace(/\s+/g, ' ');
    expect(normalized).toContain(
      'the next prompt MUST do a full group re-read',
    );
    expect(normalized).toContain(
      'demotion changed the UNTESTED set behind lookahead\'s back',
    );
  });

  test('multi-cover demotion rule: only when ALL covers non-PASSED', () => {
    // Codex T4 catch: single-cover demotion would silently destroy signal
    // when an item has multiple backings. The plan locks the safer rule.
    expect(content).toMatch(
      /demotes from `PASSED_BY_COVERAGE` to `UNTESTED`.+only when every item/,
    );
  });

  test('directly-PASSED items NEVER demote on covering-item FAIL', () => {
    // Integrity invariant: direct evidence is independent. If a future edit
    // tries to "simplify" by demoting all items in the Covers list, this
    // fails.
    expect(content).toContain('Direct `PASSED` items NEVER demote');
  });

  test('E3 demotion applies to ALL FAIL paths (not just Fix Now)', () => {
    expect(content).toMatch(
      /E3 demotion \(always — applies to ALL FAIL paths, not just Fix Now\)/,
    );
  });

  test('trust-posture language: verified by action vs observed property', () => {
    // Codex T2 catch: "covered" ≠ "observed". The bundle prompt and the
    // skill prose must explicitly calibrate trust.
    expect(content).toContain('verified by action');
    expect(content).toContain('observed property');
  });

  test('Phase 3 dashboard COVERAGE sub-block template tokens', () => {
    // ER3 dashboard render: the template must include the literal tokens
    // an agent will pattern-match against. Skip-condition language must
    // also be present (otherwise the block renders unconditionally).
    expect(content).toContain('COVERAGE: 3 bundles in plan');
    expect(content).toContain('Omit the COVERAGE block ENTIRELY if no item');
  });

  test('Phase 4 report Coverage savings line template', () => {
    expect(content).toContain('Coverage savings: K items confirmed by coverage');
    expect(content).toContain('Bundles accepted: B/O');
  });

  test('Phase 4 report Coverage warnings line omit-when-empty rule', () => {
    expect(content).toContain('Omit this line entirely if `coverage_warnings` is empty');
  });

  test('BATCH out-of-batch post-batch-walk explicit (ER4)', () => {
    // The non-trivial BATCH-coverage interaction Codex flagged: out-of-batch
    // covers must spawn post-batch bundle prompts. Locking the prose
    // prevents a future "simplification" from silently dropping the walk.
    expect(content).toContain('Out-of-batch covers');
    // Multi-line prose: scan for the load-bearing fragment without anchoring
    // on whitespace shape (the surrounding markdown wraps mid-sentence).
    const normalized = content.replace(/\s+/g, ' ');
    expect(normalized).toMatch(
      /after the batch resolves to disk, fire the standard post-PASS bundle prompt/,
    );
  });

  test('BATCH keeps index-ordered selection (no leapfrogging)', () => {
    expect(content).toContain('BATCH keeps **index-ordered** selection');
  });

  test('fix-commit-message COVERS_SUFFIX variable referenced', () => {
    // Locks the in-paren commit-message format. A future edit that drops
    // the suffix variable would silently lose coverage provenance in the
    // git log.
    expect(content).toContain('COVERS_SUFFIX');
    expect(content).toContain('pair-review item <N>$COVERS_SUFFIX');
  });
});

// ─── Smart-batching prompt-options table (T12) ───────────────────────
//
// Every new AskUserQuestion site introduced by smart-batching must use
// exact, agreed option strings. Capitalization drift (e.g., "All Pass" vs
// "All pass") or reordering would silently confuse the agent at runtime
// since prose-driven skills rely on string-matching for prompt detection.
// Single table, iterated below; one row = one site = one assertion.

const SMART_BATCHING_PROMPT_OPTIONS: Array<{ site: string; needle: string }> = [
  // Post-PASS coverage bundle prompt — options match the existing BATCH
  // mode capitalization convention ("All pass" not "All Pass").
  {
    site: 'post-PASS coverage bundle',
    needle: 'Options: ["All pass", "Mark individually", "Park a bug"]',
  },
  // Phase 1 Step 4.5 coverage graph review (top-level prompt).
  {
    site: 'coverage graph review (top-level)',
    needle: 'Options: ["Approve as-is", "Edit", "Strip all coverage"]',
  },
  // Phase 1 Step 4.5 edit-loop menu.
  {
    site: 'coverage edit menu',
    needle: 'Options: ["Drop an edge", "Add an edge", "Strip all coverage", "Done editing"]',
  },
  // Phase 1 Step 4.5 bail-out (after 3 consecutive invalid edits).
  {
    site: 'coverage edit bail-out',
    needle: 'Options: ["Strip all coverage", "Keep editing"]',
  },
  // Add Item Phase 2 — covers picker first question.
  {
    site: 'add-item covers picker',
    needle: 'Options: ["No", "Yes — pick targets"]',
  },
];

describe('pair-review smart-batching: prompt-options table (T12)', () => {
  const file = join(ROOT, 'skills', 'pair-review.md');
  const content = readFileSync(file, 'utf8');

  for (const { site, needle } of SMART_BATCHING_PROMPT_OPTIONS) {
    test(`${site}: options array matches exactly`, () => {
      if (!content.includes(needle)) {
        throw new Error(
          `Prompt-options drift at "${site}". Expected verbatim: ${needle}`,
        );
      }
    });
  }
});

// ─── Item-shape + merge-gate drift-locks ─────────────────────────────
//
// Two session-speed regressions the skill previously allowed:
//
//   1. Over-splitting — two items describing one glance, each asking its
//      own question (or worse, linked by a Covers edge that costs an extra
//      bundle prompt to resolve). Fixed by the Step 3.2 merge gate, which
//      runs BEFORE coverage inference and claims co-observable pairs first.
//   2. Muddy prompts — background, rationale, and file references inlined
//      into the item, burying the instruction. Fixed by the mandatory
//      three-line item shape (action / PASS / FAIL) plus a Context: field
//      that lives on disk and is never rendered in a prompt.
//
// Both fixes are prose the agent reads at runtime, so lock the load-bearing
// phrasing. Silent removal degrades straight back to the old behavior with
// no code-level signal.

describe('pair-review item shape: three-line contract', () => {
  const content = readFileSync(join(ROOT, 'skills', 'pair-review.md'), 'utf8');
  const normalized = content.replace(/\s+/g, ' ');

  test('Pass/Fail/Context fields exist in the item-format spec block', () => {
    expect(content).toContain('- Pass: <observable state that means it worked>');
    expect(content).toContain('- Fail: <the concrete wrong behavior to watch for>');
    expect(content).toContain(
      '- Context: <background — written to disk, NEVER rendered in a prompt>',
    );
  });

  test('sizing rule is a ceiling, not a target', () => {
    // The old "Each group has 3-7 items" read as a quota and pressured
    // splitting to fill it. If a future edit reintroduces a count target,
    // over-splitting comes back.
    expect(content).not.toContain('Each group has 3-7 items');
    expect(normalized).toContain('7 items per group is a **ceiling, not a target**');
  });

  test('FAIL-is-not-negation-of-PASS rule present', () => {
    // Without this, FAIL lines collapse to "not the above", which tells the
    // human nothing about what to watch for.
    expect(content).toContain('**FAIL is not the negation of PASS.**');
  });

  test('no-background-in-item rule present', () => {
    expect(content).toContain('**No background in the item.**');
    expect(normalized).toContain('never rendered in a prompt');
  });

  test('unwritable-PASS forcing function present', () => {
    // The rule that converts vague items into either a dropped item or a
    // rewritten one, instead of shipping them and hoping.
    expect(normalized).toContain(
      'if you cannot write a one-line observable PASS, it is not a manual test item',
    );
  });

  test('Phase 2 prompt template renders action + PASS + FAIL, lookahead action-only', () => {
    expect(content).toContain(
      '**[Group] [N]/[Total]:** [Action line]\\n\\nPASS: [item\'s Pass field]\\nFAIL: [item\'s Fail field]',
    );
    expect(content).toContain("_Next up: [N+1]. [Next item's action line only]_");
  });

  test('Phase 2 prompt has an explicit nothing-else clause', () => {
    // Load-bearing: this is the sentence that stops rationale and diff
    // summaries from leaking back into the question the human answers.
    expect(content).toContain('**Nothing else goes in the prompt.**');
    expect(normalized).toContain(
      'The prompt is exactly: receipt, action, PASS, FAIL, lookahead',
    );
  });

  test('plan review renders action lines only', () => {
    expect(normalized).toContain('Show each group with its items — **action lines only**');
  });

  test('legacy items without Pass/Fail render heading-only on resume', () => {
    // Sessions started before the three-line shape have items with no Pass:/
    // Fail: fields. Without this fallback the Phase 2 template renders bare
    // "PASS:" / "FAIL:" labels with nothing after them.
    expect(content).toContain('**Legacy items (sessions started before the three-line shape).**');
    expect(normalized).toContain('do NOT emit empty `PASS:` / `FAIL:` labels');
  });

  // Every other site that renders an item to the user. Each one previously
  // interpolated a single opaque `[Item description]`; reverting any of them
  // reintroduces the muddiness the three-line shape exists to prevent.

  test('retest-after-fix prompt renders action + PASS + FAIL', () => {
    expect(content).toContain(
      "**[Group] [N]/[Total]:** [Action line]\\n\\nPASS: [item's Pass field]\\nFAIL: [item's Fail field]",
    );
    expect(normalized).toContain(
      'Do not append an explanation of the fix to this prompt',
    );
  });

  test('BATCH prompt renders action + PASS per item, Fail omitted on purpose', () => {
    expect(content).toContain('[N]. [Action line]\\n    PASS: [Pass field]');
    expect(content).toContain('_Next up: [N+3]. [Post-batch action line]_');
    // The omission must stay documented as deliberate, or a future reader
    // "fixes" it by re-adding FAIL and the batch block stops being scannable.
    expect(normalized).toContain(
      'Batch mode renders **action + PASS only** — the `Fail:` field is omitted on purpose',
    );
  });

  test('bundle prompt lists covered items as action + PASS', () => {
    expect(content).toContain('[N]. <Item N action line> — PASS: <Item N Pass field>');
    expect(content).toContain('[M]. <Item M action line> — PASS: <Item M Pass field>');
  });

  test('no item-render site still uses the opaque [Item description] token', () => {
    // Catch-all: the old placeholder must not survive at any render site.
    // Prose references to "item description" (e.g. the FAIL-handler lookahead
    // sentence) are fine — only the bracketed template token is banned.
    expect(content).not.toContain('[Item description]');
  });
});

describe('pair-review merge gate (Step 3.2)', () => {
  const content = readFileSync(join(ROOT, 'skills', 'pair-review.md'), 'utf8');
  const normalized = content.replace(/\s+/g, ' ');

  test('merge step exists and is ordered before coverage inference', () => {
    expect(content).toContain('### Step 3.2: Merge co-observable items (run BEFORE coverage inference)');
    const mergeIdx = content.indexOf('### Step 3.2: Merge co-observable items');
    const coversIdx = content.indexOf('### Step 3.5: Infer coverage hints');
    expect(mergeIdx).toBeGreaterThan(-1);
    expect(coversIdx).toBeGreaterThan(mergeIdx);
  });

  test('merge test names the no-additional-action condition', () => {
    expect(normalized).toContain(
      'A single user action puts both properties on screen at the same moment',
    );
    expect(normalized).toContain('no navigation, no click, no scroll, no opening a panel');
  });

  test('merged-item ceiling is judged (FAIL ambiguity), not counted', () => {
    // Learning [qualitative-judgment-not-numeric-thresholds]: a hard "max 4"
    // encodes a programmatic decision where judgment belongs. The rule must
    // stay framed on whether a FAIL would be ambiguous; the count is a guide.
    expect(content).toContain('**Ceiling — judged, not counted**');
    expect(normalized).toContain('Judge the ambiguity, not the count');
  });

  test('merge-vs-Covers boundary stated in both directions', () => {
    // The boundary has to be stated at the merge step AND re-asserted in
    // the Covers heuristics, or inference drifts back to linking pairs that
    // should have been merged.
    expect(normalized).toContain(
      '**Never emit a `Covers:` link between two items visible on the same screen at the same time.**',
    );
    expect(content).toContain('Also disqualifying: **co-visibility**.');
  });

  test('Covers inference declares the merge precondition', () => {
    expect(normalized).toContain(
      'Run this **after** the Step 3.2 merge pass, on the surviving items only',
    );
  });

  test('ADD ITEM applies the merge test to new items', () => {
    expect(normalized).toContain('apply the Step 3.2 merge test against the group\'s existing UNTESTED items');
  });
});

describe('pair-review ordering (Step 3.4)', () => {
  const content = readFileSync(join(ROOT, 'skills', 'pair-review.md'), 'utf8');
  const normalized = content.replace(/\s+/g, ' ');

  test('ordering step exists between merge and coverage inference', () => {
    expect(content).toContain('### Step 3.4: Order for one pass through the app');
    const orderIdx = content.indexOf('### Step 3.4: Order for one pass');
    expect(content.indexOf('### Step 3.2: Merge co-observable items')).toBeLessThan(orderIdx);
    expect(content.indexOf('### Step 3.5: Infer coverage hints')).toBeGreaterThan(orderIdx);
  });

  test('three ordering rules named', () => {
    expect(content).toContain('**State locality first**');
    expect(content).toContain('**Risk breaks ties**');
    expect(content).toContain('**Destructive last**');
  });

  test('ordering precedes index assignment, orphans deferred to Existence rule', () => {
    // Reordering after Covers inference would silently repoint every edge.
    // The claim must stay honest: Step 4 approval can still delete items, so
    // "immutable thereafter" would be false — orphaned edges are the Step 4.5
    // Existence rule's job, not a reason to re-run ordering.
    expect(normalized).toContain('Item indices are assigned **after** this ordering');
    expect(normalized).toContain('caught by the existing **Existence** validation rule');
  });

  test('destructive-last takes precedence over risk-first', () => {
    expect(content).toContain('Rule 3 wins over rule 2.');
  });
});

describe('test-plan inherits the item shape and merge gate', () => {
  // /test-plan skips pair-review Phase 1 entirely (Phase 8 says so), so it
  // must apply Steps 3 / 3.2 / 3.4 itself. Extraction from review docs is
  // the worst offender for redundant prose-heavy items.
  const content = readFileSync(join(ROOT, 'skills', 'test-plan.md'), 'utf8');
  const normalized = content.replace(/\s+/g, ' ');

  test('Step 4 requires Pass/Fail/Context fields', () => {
    expect(content).toContain('`Pass:` and `Fail:` fields (required)');
    expect(normalized).toContain('never rendered in a prompt');
  });

  test('Step 4 defers to pair-review Steps 3 / 3.2 / 3.4 by name', () => {
    expect(normalized).toContain('**Step 3**');
    expect(normalized).toContain('**Step 3.2**');
    expect(normalized).toContain('**Step 3.4**');
    expect(normalized).toContain('/test-plan skips pair-review\'s Phase 1, so it owns those authoring rules here');
  });
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

describe('Track 15A skill-file presence', () => {
  for (const skill of [...new Set([...PROTOCOL_SKILLS, ...PREAMBLE_SKILLS, ...CONDUCTOR_SKILLS])]) {
    test(`skills/${skill}.md exists`, () => {
      const file = join(ROOT, 'skills', `${skill}.md`);
      if (!existsSync(file)) {
        throw new Error(`Missing: ${file}`);
      }
    });
  }
});

describe('Track 15A setup / protocol / preamble / conductor cohorts', () => {
  const setupText = readFileSync(join(ROOT, 'setup'), 'utf8');
  const setupSkills = parseSetupSkills(setupText);

  test('live setup parses to the exact install list', () => {
    expect(setupSkills).toEqual([...EXPECTED_SETUP_SKILLS]);
  });

  test('PROTOCOL ⊂ PREAMBLE ⊂ SETUP', () => {
    for (const s of PROTOCOL_SKILLS) {
      expect(PREAMBLE_SKILLS).toContain(s);
      expect(setupSkills).toContain(s);
    }
    for (const s of PREAMBLE_SKILLS) {
      expect(setupSkills).toContain(s);
    }
  });

  test("PREAMBLE \\ PROTOCOL === ['gstack-extend-upgrade']", () => {
    const extra = PREAMBLE_SKILLS.filter((s) => !(PROTOCOL_SKILLS as readonly string[]).includes(s));
    expect(extra).toEqual(['gstack-extend-upgrade']);
  });

  test("SETUP \\ PREAMBLE contains init and review-and-prep", () => {
    const extra = setupSkills.filter((s) => !(PREAMBLE_SKILLS as readonly string[]).includes(s));
    expect(extra).toEqual(['gstack-extend-init', 'review-and-prep']);
  });

  test('PROTOCOL and PREAMBLE exclude every non-preamble setup skill', () => {
    for (const s of ['gstack-extend-init', 'review-and-prep']) {
      expect(PROTOCOL_SKILLS).not.toContain(s);
      expect(PREAMBLE_SKILLS).not.toContain(s);
    }
  });

  test('CONDUCTOR_SKILLS is the 4 trim-target files, not PROTOCOL', () => {
    expect([...CONDUCTOR_SKILLS]).toEqual([
      'pair-review',
      'full-review',
      'review-apparatus',
      'test-plan',
    ]);
    expect(CONDUCTOR_SKILLS).not.toContain('roadmap');
  });

  test('every cohort member has skills/<name>.md', () => {
    for (const name of [...setupSkills, ...PROTOCOL_SKILLS, ...PREAMBLE_SKILLS, ...CONDUCTOR_SKILLS]) {
      expect(existsSync(join(ROOT, 'skills', `${name}.md`))).toBe(true);
    }
  });
});

// ─── review-and-prep drift-locks ────────────────────────────────────
//
// review-and-prep is a prompt-file skill outside the SHARED-block cohorts,
// so nothing else pins its load-bearing prose. Lock the invariants a
// rewording must not lose: draft-once, the Greptile applicability gate,
// the completion-matrix vocabulary, the receipt/handoff anchors, and the
// absence of destructive git/GitHub commands.
describe('review-and-prep drift-locks', () => {
  const file = join(ROOT, 'skills', 'review-and-prep.md');
  const content = readFileSync(file, 'utf8');
  const normalized = content.replace(/\s+/g, ' ');

  test('allowed-tools includes Agent for specialist and adversarial dispatch', () => {
    const closeIdx = content.indexOf('\n---', 4);
    const frontmatter = content.slice(0, closeIdx);
    expect(frontmatter).toContain('  - Agent\n');
    expect(frontmatter).toContain('  - Skill\n');
  });

  test('draft-once invariant', () => {
    expect(normalized).toContain(
      'Mark it ready exactly once, as the last mutation of a successful run. Never convert a ready PR back to draft.',
    );
    expect(normalized).toContain('Do not make further preparation pushes after readiness.');
    expect(content.split('**Draft-once rule:').length - 1).toBe(1);
  });

  test('Greptile applicability gate guards Steps 4 and 5', () => {
    const gate = 'Run this step only when Greptile applies under Step 1.';
    expect(content.split(gate).length - 1).toBe(2);
    for (const heading of ['## 4. Trigger', '## 5. Triage']) {
      const section = content.slice(content.indexOf(heading)).split(/\n## /)[0];
      expect(section).toContain(gate);
    }
    expect(normalized).toContain(
      '`greptile.json` (file), `.greptile.json` (file), or `.greptile/` (directory)',
    );
    expect(normalized).toContain('must exist at the reviewed base tip or in the intended head');
    expect(normalized).toContain('record the user\'s explicit decision in the receipt');
    expect(content).toContain('Greptile: skipped — no root configuration');
    expect(content).toContain('Greptile: skipped — docs-only PR');
    expect(content).toContain('<!-- review-and-prep:greptile:<full-sha> -->');
  });

  test('completion matrix vocabulary and readiness rule', () => {
    expect(normalized).toContain(
      '**VERIFIED**, **PARTIAL**, **MISSING**, **UNVERIFIABLE**, or **DEFERRED BY USER**',
    );
    expect(normalized).toContain(
      'Readiness requires every in-scope item to be VERIFIED or DEFERRED BY USER.',
    );
    expect(normalized).toContain('A core-only review cannot satisfy missing stages');
  });

  test('receipt, final mutation, and handoff anchors', () => {
    expect(content).toContain('`## Review and prep`');
    expect(content).toContain('gh pr ready "<number>" --repo "<base-owner/repo>"');
    expect(content).toContain('Run /ship, then /land-and-deploy for this prepared PR.');
    expect(normalized).toContain(
      'Reuse a receipt claim only after corroborating it against live state',
    );
  });

  test('no destructive git/GitHub commands and no co-authorship', () => {
    expect(content).toContain('Never add co-authorship trailers.');
    expect(content).not.toMatch(/push\s+(?:-f\b|--force)/);
    expect(content).not.toContain('--force-with-lease');
    expect(content).not.toMatch(/gh pr (?:merge|close)/);
    expect(content).not.toMatch(/gh pr edit[^\n]*--base/);
    expect(content).not.toContain('reset --hard');
    expect(content).not.toMatch(/branch -D\b/);
    expect(content).not.toContain('--undo');
  });
});

describe('non-cohort setup skills carry no SHARED or telemetry blocks', () => {
  const setupSkills = parseSetupSkills(readFileSync(join(ROOT, 'setup'), 'utf8'));
  const outside = setupSkills.filter((s) => !(PREAMBLE_SKILLS as readonly string[]).includes(s));

  test('the outside set is exactly init and review-and-prep', () => {
    expect(outside).toEqual(['gstack-extend-init', 'review-and-prep']);
  });

  for (const skill of outside) {
    test(`${skill} has no SHARED markers or telemetry hooks`, () => {
      const content = readFileSync(join(ROOT, 'skills', `${skill}.md`), 'utf8');
      expect(content).not.toMatch(/<!-- \/?SHARED:/);
      expect(content).not.toContain('_GE_SKILL=');
      expect(content).not.toContain('gstack-extend-telemetry');
    });
  }
});

describe('Track 15A parseSetupSkills grammar (synthetic)', () => {
  test('missing SKILLS=( throws', () => {
    expect(() => parseSetupSkills('LEGACY_SKILLS=(\n  x\n)\n')).toThrow(
      'SKILLS=( ... ) array not found in setup',
    );
  });

  test('comments and blanks are ignored', () => {
    const text = `SKILLS=(
  pair-review
  # comment only
  roadmap  # trailing

  full-review
)
`;
    expect(parseSetupSkills(text)).toEqual(['pair-review', 'roadmap', 'full-review']);
  });

  test('empty / comments-only body returns []', () => {
    const text = `SKILLS=(
  # none
)
`;
    expect(parseSetupSkills(text)).toEqual([]);
  });

  test('blank-only SKILLS body returns []', () => {
    expect(parseSetupSkills('SKILLS=(\n\n)\n')).toEqual([]);
  });

  test('multi-token line is one invalid name, not split', () => {
    const text = `SKILLS=(
  pair-review roadmap
)
`;
    expect(parseSetupSkills(text)).toEqual(['pair-review roadmap']);
  });
});

describe('Track 15A SHARED:conductor-visibility-head', () => {
  // Conductor-only host workaround. 17A must not treat this as tmpl-universal.
  const CONDUCTOR_RE =
    /<!-- SHARED:conductor-visibility-head -->[\s\S]*?<!-- \/SHARED:conductor-visibility-head -->/;
  const fullReview = readFileSync(join(ROOT, 'skills', 'full-review.md'), 'utf8');
  const match = CONDUCTOR_RE.exec(fullReview);
  const canonical = match ? match[0] : '';

  test('canonical block extracted from skills/full-review.md', () => {
    expect(canonical).not.toBe('');
    expect(canonical).toContain('<!-- SHARED:conductor-visibility-head -->');
    expect(canonical).toContain('<!-- /SHARED:conductor-visibility-head -->');
    expect(canonical).toContain('## Conductor Visibility Rule');
    expect(canonical).toContain('AskUserQuestion');
    expect(canonical).toContain('last message before the agent stops');
  });

  test('canonical block is exactly one marker pair', () => {
    expect(canonical.split('<!-- SHARED:conductor-visibility-head -->').length - 1).toBe(1);
    expect(canonical.split('<!-- /SHARED:conductor-visibility-head -->').length - 1).toBe(1);
  });

  test('canonical block excludes per-skill item 2 and Action receipt format', () => {
    expect(canonical).not.toContain('2. **Every AskUserQuestion MUST include an action receipt**');
    expect(canonical).not.toContain('Action receipt format');
  });

  for (const skill of CONDUCTOR_SKILLS) {
    const file = join(ROOT, 'skills', `${skill}.md`);
    const content = readFileSync(file, 'utf8');

    test(`${skill} embeds the canonical SHARED:conductor-visibility-head block`, () => {
      if (!content.includes(canonical)) {
        throw new Error(
          `${skill} drift in SHARED:conductor-visibility-head — propagate canonical text from skills/full-review.md`,
        );
      }
    });

    test(`${skill} has exactly one Conductor marker pair`, () => {
      expect(content.split('<!-- SHARED:conductor-visibility-head -->').length - 1).toBe(1);
      expect(content.split('<!-- /SHARED:conductor-visibility-head -->').length - 1).toBe(1);
    });

    test(`${skill} still has Action receipt format and item 2 outside the wrap`, () => {
      const after = content.slice(content.indexOf('<!-- /SHARED:conductor-visibility-head -->'));
      expect(after).toContain('Action receipt format');
      expect(after).toContain('2. **Every AskUserQuestion MUST include an action receipt**');
    });
  }
});

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
