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

// ─── Roadmap-only verbatim assertions (v0.18.0 reassessment redesign) ─
//
// These strings live in skills/roadmap.md only. Load-bearing for skill
// behavior (fast-path output) and test fixtures (proposal artifact format).

const BLOCK_ROADMAP_FAST_PATH = 'Plan looks current. No changes.';
const BLOCK_ROADMAP_PROPOSAL_PATH = '.context/roadmap/proposal-';
const BLOCK_ROADMAP_CLUSTER_STRUCTURAL = 'Hold scope — fold into existing structure instead';

const ROADMAP_VERBATIM_BLOCKS: Array<{ block: string; label: string }> = [
  { block: BLOCK_ROADMAP_FAST_PATH, label: 'fast-path-output' },
  { block: BLOCK_ROADMAP_PROPOSAL_PATH, label: 'proposal-artifact-path' },
  { block: BLOCK_ROADMAP_CLUSTER_STRUCTURAL, label: 'cluster-structural-hold-scope' },
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
