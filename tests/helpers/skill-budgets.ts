/**
 * skill-budgets.ts — per-skill byte budgets and default-path reference lists
 * for gstack-extend skills (Track 94I).
 *
 * Cap: 75% of the smallest measured hard per-file skill limit (196,608 bytes,
 * 75% of Muse Code 1.4.25's measured 262,144-byte SKILL.md limit).
 *
 * Budget formula: min(CORE_BYTE_CAP, roundUp4KiB(measured * 1.10)).
 * Reference cap: 24,576 bytes (24 KiB) and 400 lines per reference file, with
 * every line <= 2,000 characters, staying safely below the smallest measured
 * per-call command output cap (~30 KiB on Claude Code).
 *
 * Raising any budget requires the developer's explicit word and an entry in
 * BUDGET_RAISE_LOG below. See docs/skill-references.md.
 */

import type { ExpectedSetupSkill } from './expected-setup-skills.ts';

export const SMALLEST_HARD_SKILL_LIMIT_BYTES = 262_144; // Muse Code 1.4.25 measured
export const CORE_BYTE_CAP = 196_608; // 75% of 262,144
export const REFERENCE_BYTE_CAP = 24_576; // 24 KiB (< ~30 KiB Claude Code per-call output cap)
export const REFERENCE_LINE_CAP = 400;
export const REFERENCE_MAX_LINE_CHARS = 2_000;

export interface SkillBudgetEntry {
  /** Maximum allowed bytes for skills/<skill>.md. */
  coreBytes: number;
  /** References read on the default by-hand path (empty when none are read). */
  defaultByHandRefs: readonly string[];
  /** Maximum allowed bytes for core + defaultByHandRefs. */
  defaultByHandBytes: number;
  /** Optional orchestrated default path references (reported by the budget test). */
  orchestratedDefaultRefs?: readonly string[];
}

export interface BudgetRaiseEntry {
  date: string;
  skill: ExpectedSetupSkill;
  fromBytes: number;
  toBytes: number;
  reason: string;
}

export const BUDGET_RAISE_LOG: readonly BudgetRaiseEntry[] = [];

/**
 * Budgets for every skill in setup's SKILLS list.
 * - Slimmed in PR A: review-and-prep (366,223 B -> ~183 KB; budget 196,608 B).
 * - Scheduled for PR B: roadmap, ship-and-land, pair-review (held at current
 *   size + <=10% rounded up to 4 KiB until PR B slims them).
 * - Unslimmed skills: current size + <=10% rounded up to 4 KiB.
 */
export const SKILL_BUDGETS: Record<ExpectedSetupSkill, SkillBudgetEntry> = {
  'docs-ship': {
    coreBytes: 32_768, // 28,849 * 1.10 = 31,734 -> 32 KiB
    defaultByHandRefs: [],
    defaultByHandBytes: 32_768,
  },
  'full-review': {
    coreBytes: 57_344, // 50,764 * 1.10 = 55,840 -> 56 KiB
    defaultByHandRefs: [],
    defaultByHandBytes: 57_344,
  },
  'gstack-extend-init': {
    coreBytes: 20_480, // 14,961 * 1.10 = 16,457 -> 20 KiB
    defaultByHandRefs: [],
    defaultByHandBytes: 20_480,
  },
  'gstack-extend-upgrade': {
    coreBytes: 20_480, // 16,128 * 1.10 = 17,741 -> 20 KiB
    defaultByHandRefs: [],
    defaultByHandBytes: 20_480,
  },
  implement: {
    coreBytes: 53_248, // 46,859 * 1.10 = 51,545 -> 52 KiB
    defaultByHandRefs: [],
    defaultByHandBytes: 53_248,
  },
  'pair-review': {
    coreBytes: 102_400, // 90,667 * 1.10 = 99,734 -> 100 KiB (PR B slims)
    defaultByHandRefs: [],
    defaultByHandBytes: 102_400,
  },
  'plan-track': {
    coreBytes: 32_768, // 27,135 * 1.10 = 29,849 -> 32 KiB
    defaultByHandRefs: [],
    defaultByHandBytes: 32_768,
  },
  'project-spec': {
    coreBytes: 36_864, // 30,202 * 1.10 = 33,222 -> 36 KiB
    defaultByHandRefs: [],
    defaultByHandBytes: 36_864,
  },
  'review-and-prep': {
    coreBytes: CORE_BYTE_CAP, // 196,608 B (75% cap of Muse's 262,144 B limit)
    defaultByHandRefs: [],
    defaultByHandBytes: CORE_BYTE_CAP,
    orchestratedDefaultRefs: [
      'conditional-workflow-metrics',
      'conditional-cycle-baseline',
      'conditional-doc-audit-and-gates',
    ],
  },
  roadmap: {
    coreBytes: 147_456, // 132,635 * 1.10 = 145,899 -> 144 KiB (PR B slims)
    defaultByHandRefs: [],
    defaultByHandBytes: 147_456,
  },
  'ship-and-land': {
    coreBytes: 126_976, // 114,290 * 1.10 = 125,719 -> 124 KiB (PR B slims)
    defaultByHandRefs: [],
    defaultByHandBytes: 126_976,
  },
};
