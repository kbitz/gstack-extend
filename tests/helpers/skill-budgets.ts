/**
 * skill-budgets.ts — per-skill byte budgets and default-path reference lists
 * for gstack-extend skills (Track 94I).
 *
 * Cap: 75% of the smallest measured hard per-file skill limit (196,608 bytes,
 * 75% of Muse Code 1.4.25's measured 262,144-byte SKILL.md limit).
 *
 * Budget formula: min(CORE_BYTE_CAP, roundUp4KiB(measured * 1.10)).
 * Reference cap: 16,384 file bytes, 340 lines and 17,000 numbered output bytes,
 * leaving 1,000 bytes below the smallest successful single-call measurement.
 *
 * Raising any budget requires the developer's explicit word and an entry in
 * BUDGET_RAISE_LOG below. See docs/skill-references.md.
 */

import type { ExpectedSetupSkill } from './expected-setup-skills.ts';

export const SMALLEST_HARD_SKILL_LIMIT_BYTES = 262_144; // Muse Code 1.4.25 measured
export const CORE_BYTE_CAP = 196_608; // 75% of 262,144
export const REFERENCE_BYTE_CAP = 16_384;
export const REFERENCE_OUTPUT_BYTE_CAP = 17_000;
export const REFERENCE_LINE_CAP = 340;
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
 * - Slimmed in PR A: review-and-prep, with a separate cumulative path budget.
 * - Slimmed in PR B: roadmap, ship-and-land, pair-review.
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
    coreBytes: 73_728, // 65,418 * 1.10 = 71,960 -> 72 KiB (slimmed in PR B)
    // Default by-hand Init -> all-pass loop -> Phase 4 completion.
    defaultByHandRefs: [
      'conditional-init-plan',
      'conditional-completion-routing',
    ],
    defaultByHandBytes: 86_016, // 76,378 * 1.10 = 84,016 -> 84 KiB
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
    coreBytes: 184_320,
    // Successful first cycle in a repo without Greptile, metrics capture active,
    // with the selected Claude Code outside review on Codex.
    defaultByHandRefs: [
      'conditional-workflow-metrics',
      'conditional-outside-review',
      'conditional-cycle-baseline',
    ],
    defaultByHandBytes: CORE_BYTE_CAP,
    orchestratedDefaultRefs: [
      'conditional-workflow-metrics',
      'conditional-outside-review',
      'conditional-cycle-baseline',
      'conditional-policy-values',
      'conditional-doc-audit-and-gates',
    ],
  },
  roadmap: {
    coreBytes: 110_592, // 99,823 * 1.10 = 109,805 -> 108 KiB (slimmed in PR B)
    // Representative regeneration with shipped-Track candidate validation.
    defaultByHandRefs: [
      'conditional-candidate-validation',
    ],
    defaultByHandBytes: 122_880, // 110,778 * 1.10 = 121,856 -> 120 KiB
  },
  'ship-and-land': {
    coreBytes: 86_016, // 76,513 * 1.10 = 84,164 -> 84 KiB (slimmed in PR B)
    // Release-only path with metrics active, trailer check, and landing adapters.
    defaultByHandRefs: [
      'conditional-workflow-metrics',
      'conditional-release-only',
      'conditional-trailer-check',
      'conditional-land-adapters',
    ],
    defaultByHandBytes: 114_688, // 103,471 * 1.10 = 113,818 -> 112 KiB
    orchestratedDefaultRefs: [
      'conditional-workflow-metrics',
      'conditional-release-only',
      'conditional-test-evidence',
      'conditional-trailer-check',
      'conditional-land-adapters',
    ],
  },
};
