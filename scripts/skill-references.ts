#!/usr/bin/env bun
/**
 * skill-references.ts — move manifest, conservation check, apply mode, and
 * content-digest updater for gstack-extend skill reference files (Track 94I).
 *
 * Commands:
 *   bun scripts/skill-references.ts check|apply --base <pre-move ref> [--skill <name>]
 *   bun scripts/skill-references.ts digests [--skill <name>] [--write]
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dir, '..');

export const ALLOWED_REF_PREFIXES = [
  'conditional-',
  'delegate-',
  'orchestrated-',
  'by-hand-',
  'resume-',
] as const;

/**
 * Exact byte-identical reference-read and upgrade rule carried by every slimmed
 * skill core right beside the preamble's root rules.
 */
export const CORE_REFERENCE_RULE = `### Reference files and mid-run upgrades

Some conditional steps keep their detailed instructions in reference files under the verified gstack-extend checkout. Each read point names the exact \`~/.gstack-extend/bin/preamble <skill> --ref <file> --expect <digest>\` command to run.

- **Always fetch on step entry.** Run the \`--ref\` command each time its step is entered; nothing already in context, including a \`REFERENCE_READ\` reply or a compaction summary, counts as having the text. Verify the trailer's digest against the read instruction and check that the numbered lines run contiguously from \`1\` to the \`REFERENCE_END\` trailer's \`lines=<N>\`. If output is truncated, retry in bounded \`--lines <a>-<b>\` chunks. If the full range still cannot be verified, report \`SKILL_REFERENCE_INCOMPLETE\` with the step, reference, harness and version and take the same stop as a failed fetch.
- **Stop on reference failure.** Relay the command's \`SKILL_REFERENCE_*\` line verbatim. For an older shared command that returns \`PREAMBLE_USAGE\`, or a missing launcher, use the start-command recovery above. In PR bodies and receipts record only the cause and the repository-relative path \`skills/references/<skill>/<file>.md\`. Run Telemetry finish with \`--outcome error\` for the failed step. Where the skill uses a stage line, end with \`Stage handoff: stage-handoff/v1; stage: <current stage>; next: none; status: blocked; head: <HEAD or none>; plan-sha256: <plan SHA-256 or none>\`. Work completed before the step stands; rerunning the skill re-binds to the existing PR or uses the skill's resume form. Never continue a moved step from memory.
- **Host subagents.** A host subagent that needs a reference runs the same \`--ref\` command itself and starts its reply with \`REFERENCE_READ <skill>/<file> lines=<N> digest=<digest>\`; a reply without that header or with a different digest is recorded under the skill's existing incomplete-reviewer or missing-coverage rule, never as a clean pass. (If the host denies a headless subagent the start command, the primary fetches the reference and passes its text inline on that host only.) Helper-run delegates keep their code-built prompts.
- **Mid-run upgrade.** If **Inline upgrade flow** printed \`UPGRADE_OK\` in this run, tell the user the upgrade finished and to rerun this skill so the loaded instructions match the updated checkout. Run Telemetry finish and stop before Step 1.`;

export interface MoveEntry {
  skill: string;
  ref: string;
  refTitle: string;
  sectionHeading: string;
  startMarker: string;
  endBeforeMarker: string | null;
  /** Text appended after the backticked preamble command in the read instruction. */
  readInstructionSuffix: string;
  /** Trigger and outcome kept visible at the read point. */
  coreGate?: string;
  /** Exact published capability commands stay in the core. */
  keepCapabilityChecks?: boolean;
  /** Relative directions replaced by named steps after moving the text. */
  navigationEdits?: readonly (readonly [from: string, to: string])[];
}

export const MOVE_MANIFEST: readonly MoveEntry[] = [
  {
    skill: 'review-and-prep',
    ref: 'conditional-workflow-metrics',
    refTitle: 'Workflow metrics capture and span wrappers',
    sectionHeading: '### Workflow metrics (optional, local)',
    startMarker: 'Resolve `gstack-extend-telemetry` exactly as the telemetry blocks do. Each',
    endBeforeMarker: '- A fix batch is a `kind:"fix"` step, counted separately from passes. Greptile is',
    readInstructionSuffix: "before recording workflow metrics when `GX_CAPTURE=1`",
    coreGate: "Capture changes no gate, finding or readiness. When capture or the receipt read is unavailable, keep the actual outcome and write `Workflow metrics (local, optional): capture=disabled|unavailable|partial (<reason>).` with the actual status and reason. When there is no session ID, use that line in place of the read.",
    navigationEdits: [['the literal status line below', 'the core metrics status line']],
  },
  {
    skill: 'review-and-prep',
    ref: 'conditional-greptile-recovery',
    refTitle: 'Greptile second-run detection, user-decision exits, and configuration repair',
    sectionHeading: '### Detect whether marking ready would start a second run',
    startMarker: 'The ready transition starts an automatic run unless the effective trigger list',
    endBeforeMarker: null,
    readInstructionSuffix: 'before evaluating trigger settings when Greptile applies or a recorded request/run has consumed the allowance',
    coreGate: "The effective source-branch triggers must exclude `open`. `push`, `rebase` and legacy `triggerOnUpdates: true` imply `open`. Missing, unreadable, conflicting or unknown effective configuration counts as starting a run. If marking ready would start one, take the E1 user decision before review. After a request or run exists, readiness requires E1(a).",
    navigationEdits: [['the resume rule above', 'the resume rule in **Establish the branch, PR, and review inputs**']],
  },
  {
    skill: 'review-and-prep',
    ref: "conditional-outside-review",
    refTitle: "Claude Code outside-call adapter",
    sectionHeading: '### Bound Claude Code outside calls',
    startMarker: "After `/review` selects the outside passes, prepare one private request JSON:",
    endBeforeMarker: "A completed response with a marker failure is a **parse failure**, not a",
    readInstructionSuffix: "before running the bounded Claude Code adapter when `/review` selects those outside passes and the installed adapter is available",
    navigationEdits: [['the validated delta procedure below', '**Scope a re-review to its delta**']],
  },
  {
    skill: 'review-and-prep',
    ref: 'delegate-specialist-parts',
    refTitle: "Delegated specialist dispatch and result handling",
    sectionHeading: '### Delegate named specialist parts',
    startMarker: 'Read [the delegate contract](https://github.com/kbitz/gstack-extend/blob/main/docs/delegated-review.md)',
    endBeforeMarker: null,
    readInstructionSuffix: "before deciding delegation in Step 1 when the review policy carries `delegate=<part>` and the delegate helper and contract are available",
    coreGate: "A missing `Review delegates:` line, root, contract or helper keeps delegation inactive. Record `delegation: inactive — <reason>` and use host review. Before applying a delegate finding, validate any tools-mode reproduction in a disposable copy under the provider command allowlist. A delegate that changes the worktree stops the run before any commit.",
  },
  {
    skill: 'review-and-prep',
    ref: 'delegate-red-team-and-fold',
    refTitle: 'Red-team pass, folded specialist checklists, and overlapped cycle-1 reviewers',
    sectionHeading: '### Run a red team where /review has none',
    startMarker: "**Place and inputs.** Run the step at most once per cycle, after Step 4's core",
    endBeforeMarker: null,
    readInstructionSuffix: 'before running the red-team pass when `red-team=ensure` or `delegate=` names `red-team` and the activation gate passes',
  },
  {
    skill: 'review-and-prep',
    ref: 'delegate-red-team-and-fold',
    refTitle: 'Red-team pass, folded specialist checklists, and overlapped cycle-1 reviewers',
    sectionHeading: '### Fold specialist checklists into cycle 1',
    startMarker: 'This is a **wrapper override**, not an upstream fork: it changes who applies a',
    endBeforeMarker: null,
    readInstructionSuffix: 'before folding specialist checklists when the review policy carries `specialists=fold` and the activation anchors match',
    coreGate: "Check the activation anchors before choosing this arm. On drift, record `Review arm: dispatch — anchor changed (<which>)` and run upstream selection and dispatch. Where upstream declares `specialists-dispatched`, waive it once for an applied fold using `gstack-skill-contract waive specialists-dispatched --reason \"<why>\"`, and retain the current outcome and cycle history in the receipt.",
  },
  {
    skill: 'review-and-prep',
    ref: 'delegate-red-team-and-fold',
    refTitle: 'Red-team pass, folded specialist checklists, and overlapped cycle-1 reviewers',
    sectionHeading: '### Overlap independent first-cycle reviewers',
    startMarker: 'This is a **wrapper override**, not an upstream fork: it changes when parts',
    endBeforeMarker: null,
    readInstructionSuffix: 'before overlapping cycle-1 reviewers when the review policy carries `first-cycle=overlap` and the activation anchors match',
    coreGate: "Check the activation anchors and policy exclusions first. When overlap cannot apply, record `Review overlap: sequential — <reason>` and run upstream order.",
  },
  {
    skill: 'review-and-prep',
    ref: 'conditional-repair-and-gaps',
    refTitle: 'Behavior-changing repair classification, unproven test gaps, and shown-finding blocking',
    sectionHeading: '### Reopen review only for behavior-changing repairs',
    startMarker: "**Classify the batch once.** Under the active value only, after `/review`'s",
    endBeforeMarker: null,
    readInstructionSuffix: 'before classifying a repair batch when `repair-review: active` under `repair-review=behavior-changing`',
  },
  {
    skill: 'review-and-prep',
    ref: 'conditional-repair-and-gaps',
    refTitle: 'Behavior-changing repair classification, unproven test gaps, and shown-finding blocking',
    sectionHeading: '### Record unproven test gaps',
    startMarker: '**A recordable gap** meets all of these:',
    endBeforeMarker: null,
    readInstructionSuffix: 'before recording unproven test gaps when `test-gaps: active` under `test-gaps=record`',
  },
  {
    skill: 'review-and-prep',
    ref: 'conditional-repair-and-gaps',
    refTitle: 'Behavior-changing repair classification, unproven test gaps, and shown-finding blocking',
    sectionHeading: '### Block readiness only on shown findings',
    startMarker: "**Where it acts.** Under the active value only, after `/review`'s Step 5.0",
    endBeforeMarker: null,
    readInstructionSuffix: 'before evaluating shown findings when the review policy carries `blocking=shown`',
    coreGate: "Safety findings keep today's handling. When `blocking: active`, a non-safety finding blocks only if the host shows it on the reviewed candidate and it does not reproduce on the same reachable path at base. A finding from an attacker part needs the host's own showing attempt.",
  },
  {
    skill: 'review-and-prep',
    ref: 'conditional-cycle-baseline',
    refTitle: "Cycle 1 full-review baseline and fix-review records",
    sectionHeading: "### Record cycle 1's full-review baseline",
    startMarker: "- **B.** B is the HEAD that cycle 1 reviews: capture it at cycle 1's /review's Step 3,",
    endBeforeMarker: "- **Fix-review record.** When cycle 1's record says",
    readInstructionSuffix: "before collecting or checking cycle-1 baseline evidence when the baseline fence is available",
    coreGate: "Check the fence availability below before fetching its procedure. While available, enforce the write point before fixes and record the actual coverage. If the fence cannot persist a missed record, stop before any reader, probe or record write until that I/O failure is repaired.",
    navigationEdits: [['with the delta procedure above', 'under **Scope a re-review to its delta**']],
  },
  {
    skill: 'review-and-prep',
    ref: 'conditional-cycle-cap',
    refTitle: 'Three-cycle cap stop procedure and continuation envelope',
    sectionHeading: '### When /review stops at its cycle cap',
    startMarker: "1. Commit the reviewed work and the cycle's fixes, run the targeted checks the",
    endBeforeMarker: "On `/review-and-prep continue`, refresh Step 1's live state. A later pause or",
    readInstructionSuffix: "before saving a cycle-cap receipt when `/review` stops at its three-cycle cap",
    coreGate: "On a cycle-cap stop, keep the PR draft and request no Greptile review. Publish `STOPPED — review cycle cap` with the H-E continuation only under the recorded policy and allowance. Do not emit a `STATUS:` line. Any subsequent continuation must pass the inline hold and claim checks before dispatch. A cycle stop is a deliberate pause. Run Telemetry finish with `--outcome blocked` and retain the existing stopped-marker and stage-line contract.",
    navigationEdits: [['`next-cycle` late write above.', "`next-cycle` late write in **Record cycle 1's full-review baseline**."]],
  },
  {
    skill: 'review-and-prep',
    ref: 'conditional-post-audit-classification',
    refTitle: 'Post-audit diff classification and doc-audit-gap decision table',
    sectionHeading: "### Classify changes after the documentation audit's last attempt",
    startMarker: "**The delta.** Compute the delta from the last accepted audit's post-child",
    endBeforeMarker: '1. **`undocumented-internal` class (`owner=not-needed`).** When an existing',
    readInstructionSuffix: "before classifying an exhausted audit, recording why classification did not apply or evaluating active `doc-audit-gap=auto` reuse when the policy carries `post-audit=classify`",
    coreGate: "Carry the accepted audit unchanged when every change qualifies for `owner=not-needed`. Otherwise take the owner stop under blocked recovery, subject to the active `doc-audit-gap=auto` rules. Test-gate freshness still applies.",
  },
  {
    skill: 'review-and-prep',
    ref: 'conditional-post-audit-reaudit',
    refTitle: 'Post-audit undocumented-internal class, targeted re-audit, and receipt lines',
    sectionHeading: "### Classify changes after the documentation audit's last attempt",
    startMarker: '1. **`undocumented-internal` class (`owner=not-needed`).** When an existing',
    endBeforeMarker: null,
    readInstructionSuffix: "before deciding documentation reuse, extra attempts or receipt status when `doc-audit-gap=auto` is active",
  },
  {
    skill: "review-and-prep",
    sectionHeading: "### Bound the documentation audit",
    ref: "conditional-doc-audit-and-gates",
    refTitle: "Contract-scoped documentation audit and external full-suite gate pause/resume",
    startMarker: "3. **Initial read list.** After Prepare's snapshot and before its dispatch,",
    endBeforeMarker: "   Changelogs, roadmaps, backlogs and archived or superseded plans record",
    readInstructionSuffix: "before building the initial read list when `documentation-scope=contracts` applies",
    coreGate: "Build an initial inventoried read list before dispatch only when this documentation scope applies. Where it cannot be built faithfully, take the broad fallback.",
  },
  {
    skill: 'review-and-prep',
    ref: 'conditional-doc-audit-and-gates',
    refTitle: 'Contract-scoped documentation audit and external full-suite gate pause/resume',
    sectionHeading: '### Bound the documentation audit',
    startMarker: '   Changelogs, roadmaps, backlogs and archived or superseded plans record',
    endBeforeMarker: null,
    readInstructionSuffix: "before applying read-list, delta or broad-fallback rules when `documentation-scope=contracts` applies or post-audit classification uses those rules",
  },
  {
    skill: 'review-and-prep',
    ref: 'conditional-doc-audit-and-gates',
    refTitle: 'Contract-scoped documentation audit and external full-suite gate pause/resume',
    sectionHeading: '### Pause for an external full-suite gate',
    startMarker: "**Checkpoint.** Before every pause, save a new checkpoint in this invocation's",
    endBeforeMarker: "**Pause.** Write the line below and the policy line to the evidence directory.",
    readInstructionSuffix: "before persisting an external full-suite checkpoint when the review policy carries `full-suite=external`",
    coreGate: "The external pause requires a clean, committed tree, passing preflight and a saved checkpoint. A failed write or an unresolved preflight failure stops BLOCKED. Keep the PR unready and publish the external-gate line last.",
  },
  {
    skill: "review-and-prep",
    ref: "conditional-doc-audit-and-gates",
    refTitle: "Contract-scoped documentation audit and external full-suite gate pause/resume",
    sectionHeading: "### Pause for an external full-suite gate",
    startMarker: "**Pass.** Add the receipt row, with both command and log as the scan left them.",
    endBeforeMarker: null,
    readInstructionSuffix: "before applying a verified external full-suite result when the review policy carries `full-suite=external`",
    coreGate: "Persist the verified result first. A pass takes item 4's pregate with no main-suite fallback. A fail takes item 4's failure rule, starting with the test-only repair when enabled. Freeze again before any authorized rerun.",
  },
  {
    skill: 'review-and-prep',
    ref: 'conditional-pregate-and-final-repair',
    refTitle: 'Narrowed pregate coverage rules and test-only final-gate repair loop',
    sectionHeading: '### Narrow the pregate after an accepted pass',
    startMarker: '**Coverage.** Decide in this order. The first miss records `pregate-narrowing:',
    endBeforeMarker: null,
    readInstructionSuffix: "before evaluating pregate coverage when `full-suite=external` has an accepted pass and the activation anchors match",
    coreGate: "If an activation anchor changed, record `pregate-narrowing: inactive — anchor changed (<which>)` and run item 4's ordinary pregate.",
  },
  {
    skill: 'review-and-prep',
    ref: 'conditional-pregate-and-final-repair',
    refTitle: 'Narrowed pregate coverage rules and test-only final-gate repair loop',
    sectionHeading: '### Repair a test-only final-gate failure',
    startMarker: "- A path qualifies as tests only if its basename matches the classification's",
    endBeforeMarker: null,
    readInstructionSuffix: "before repairing a test-only final-gate failure when `final-gate-repair=tests-docs` applies and the classification contract is readable",
    coreGate: "A failed safe restoration takes `restore-failed` and stops BLOCKED. All other unverified repair paths fall back to the ordinary review and test rules.",
  },
  {
    skill: 'review-and-prep',
    ref: 'resume-manual-testing',
    refTitle: 'Manual testing resume reconciliation',
    sectionHeading: '### Manual testing checkpoint and resume',
    startMarker: "On `/review-and-prep resume` (or a repeat invocation), refresh Step 1's live",
    endBeforeMarker: null,
    readInstructionSuffix: 'before reconciling manual-testing results when resuming via `/review-and-prep resume` or a repeat invocation',
  },
  {
    skill: 'review-and-prep',
    ref: 'conditional-greptile-recovery',
    refTitle: 'Greptile second-run detection, user-decision exits, and configuration repair',
    sectionHeading: '### Greptile exits that need a user decision',
    startMarker: 'Every exit question uses this template:',
    endBeforeMarker: null,
    readInstructionSuffix: 'before composing a Greptile exit question when a Greptile exit requires a user decision',
  },
  {
    skill: 'review-and-prep',
    ref: 'conditional-greptile-recovery',
    refTitle: 'Greptile second-run detection, user-decision exits, and configuration repair',
    sectionHeading: '### Configuration repair',
    startMarker: '- When a root `.greptile/` exists, consolidate root settings into',
    endBeforeMarker: null,
    readInstructionSuffix: 'before preparing a Greptile configuration repair when an automatic trigger conflicts with the single run',
  },
  {
    skill: "review-and-prep",
    sectionHeading: "## 4. Trigger once and await Greptile",
    ref: "conditional-greptile-run",
    refTitle: "Greptile reservation, submission and monitoring procedure",
    startMarker: "The Step 3 manual testing checkpoint must have passed before any trigger.",
    endBeforeMarker: "### Greptile exits that need a user decision",
    readInstructionSuffix: "before inspecting, triggering or monitoring the single Greptile run when Step 1 says Greptile applies",
    coreGate: "Require the Step 3 manual checkpoint and an integrated, pushed draft before triggering. Existing runs or submitted requests consume the allowance. Reuse only an ancestor review SHA and use E7 on a proven non-ancestor. Check effective source-branch settings, obey required labels and wait for an automatic draft review where configured. Only the earliest confirmed reservation can trigger, once, after checking all pages of trusted markers and live run history. An ambiguous request holds under E4. A known incomplete run goes to E6 at its bound and a failed or cancelled run goes to E2. The 10-minute comment fallback applies only when a confirmed comment is unanswered and no request result or observable run exists; it gives no completion credit. A later observed run supersedes the fallback. Require corroborated completion or the authorized fallback, otherwise keep the PR draft. Detect shallow history with `--is-shallow-repository` and deepen it with `git fetch --unshallow` before trusting a non-ancestor result. Post and corroborate `<!-- review-and-prep:greptile-reservation:<full-sha> -->` before submitting, and use `<!-- review-and-prep:greptile:<full-sha> -->` for the trigger comment. When the fallback applies, record `Greptile: unverified — no response after 10 minutes`.",
  },
  {
    skill: "review-and-prep",
    sectionHeading: "## 5. Triage, fix, and verify locally",
    ref: "conditional-greptile-run",
    refTitle: "Greptile reservation, submission and monitoring procedure",
    startMarker: "Use the installed `/review` Greptile triage instructions for classification and",
    endBeforeMarker: "After fixes, review the changed code and run applicable local verification.",
    readInstructionSuffix: "before classifying Greptile feedback when Step 1 says Greptile applies and Step 4 observed feedback",
    coreGate: "Use the installed triage rules, author checks and trust envelope. Resolve actionable findings and unsuccessful replies before readiness. Unknown or disputed dispositions hold the draft. If the no-response fallback applies and no feedback exists, continue with local verification.",
  },
  {
    skill: "review-and-prep",
    sectionHeading: "### Scope a re-review to its delta",
    ref: "conditional-delta-selection",
    refTitle: "Delta reviewer selection and scope coverage",
    startMarker: "Tell the nested `/review` its delta base B and candidate snapshot S. Every",
    endBeforeMarker: "**`/review`'s own repeat cycles (`in-cap=delta`).** Apply this only when the",
    readInstructionSuffix: "before selecting a delta reviewer scope when the current pass proposes a delta",
    coreGate: "A delta uses frozen candidate snapshots and only a valid ancestor base. Verify that scope detection covers each changed path before using the results. Run `gstack-diff-scope \"B\"` and confirm `SCOPE_DELTA: covered`. A missing or incompatible binding, unbounded dependency, unverifiable selection or changed plan triggers full scope. A delta alone never counts as full-review coverage.",
    navigationEdits: [['the full-review baseline specified below', "the baseline in **Record cycle 1's full-review baseline**"]],
  },
  {
    skill: "review-and-prep",
    sectionHeading: "### Read an optional review policy",
    ref: "conditional-policy-values",
    refTitle: "Opt-in choices for full-suite, reviewer selection and repair",
    startMarker: "- `in-cap` and `continuation` choose between Step 2 procedures.",
    endBeforeMarker: "- `run-state=record` (its only value) is accepted and changes nothing: recording is the default. Every invocation records its run state through the",
    readInstructionSuffix: "before applying opt-in policy values when a valid Review policy line contains a key covered in this section",
    keepCapabilityChecks: true,
    navigationEdits: [
      ['the phase-status warning above', 'the phase-status warning in **Read an optional review policy**'],
      ['bounded-wait host rules above', '**Hosts with bounded subagent waits**'],
    ],
    coreGate: "Apply opt-in values only from the validated invocation policy. A policy does not waive a gate. A recorded external full-suite result is required under `full-suite=external`, while `full-suite=final` leaves the full suite to `/ship-and-land`. `doc-audit-gap=auto` is inert without both `full-suite=external` and `post-audit=classify`. `specialists=fold` excludes `delegate=` and a line carrying both reads as `none supplied`. When `first-cycle=overlap` appears with either, use upstream reviewer order. Delegation uses the caller's mapping and falls back to host review on missing prerequisites or an uncredited result. Light repair skips apply only to qualifying delta cycles, and explicit `in-cap=full` takes precedence. Repair-only continuation still needs a verifiable baseline and authorization.",
  },
  {
    skill: "review-and-prep",
    sectionHeading: "### Readiness",
    ref: "conditional-receipt-policy-rows",
    refTitle: "Receipt rows for active optional policies",
    startMarker: "| `Final-gate repair:`, `Final-gate repair rerun:`, `Final-gate repair review:`, `Final-gate repair refusal:` | when `final-gate-repair=tests-docs` ran a repair or fallback, with the authorizing policy line (**Repair a test-only final-gate failure**) | yes | yes | no |",
    endBeforeMarker: "For each test run, include a `Test selection:` line from",
    readInstructionSuffix: "before assembling receipt rows when a policy or the settled-context step produced them",
    coreGate: "Include every applicable policy receipt row and the authorizing policy value. Policy rows cannot remove a required user check or make an unverified gate current. Record settled status and finding lines whenever the settled-context step produced them, including on runs without a review policy.",
  },
  {
    skill: "review-and-prep",
    sectionHeading: "### Record cycle 1's full-review baseline",
    ref: "conditional-cycle-followup",
    refTitle: "Fix-review records, checkpoint misses and late evidence",
    startMarker: "- **Fix-review record.** When cycle 1's record says",
    endBeforeMarker: "- **Files and write-once.** Write the records as `cycle-1-baseline.json` and",
    readInstructionSuffix: "before checking fix-review evidence or recovering a missed record when a later review cycle begins or the cycle-cap stop reads the baseline",
    coreGate: "Before applying fixes, require the recorded baseline and any required fix-review record. A missed write discovered at the next cycle can be recovered only at that cycle's start, with contemporaneous evidence. If the fence cannot persist the miss, stop before opening the later cycle. Never create a late record at the cycle stop.",
  },
  {
    skill: "review-and-prep",
    sectionHeading: "### Record cycle 1's full-review baseline",
    ref: "conditional-cycle-baseline",
    refTitle: "Cycle 1 full-review baseline and fix-review records",
    startMarker: "- **Files and write-once.** Write the records as `cycle-1-baseline.json` and",
    endBeforeMarker: "Before the first fence use in an invocation, confirm its",
    readInstructionSuffix: "before writing cycle-1 baseline evidence when the baseline fence is available",
  },
  {
    skill: "review-and-prep",
    sectionHeading: "### Pause for an external full-suite gate",
    ref: "conditional-external-resume",
    refTitle: "External-gate checkpoint reconciliation",
    startMarker: "**Resume entry.** If this segment has not started telemetry yet (a result",
    endBeforeMarker: "**Resume.** Accept a result line only from the prompt that invoked or resumed",
    readInstructionSuffix: "before reconciling an external-gate checkpoint at resume entry when the prompt carries `full-suite=external`",
    coreGate: "Handle earlier manual-testing and cycle-cap holds first. Reuse only corroborated checkpoint history. An ambiguous history leaves the repair allowance consumed. A checkpoint cannot supply the new result or authorize a policy.",
  },
  {
    skill: "review-and-prep",
    sectionHeading: "### Manual testing checkpoint and resume",
    ref: "conditional-manual-pause-receipt",
    refTitle: "Manual testing pause receipt assembly",
    startMarker: "The PAUSED body uses Step 6's `## Review and prep` body-section shape, listing",
    endBeforeMarker: "The PAUSED receipt, its `review-and-prep:paused:` comment and the prompt below",
    readInstructionSuffix: "before assembling the manual testing receipt when required user checks remain pending after the draft push",
    coreGate: "Post the distinct `review-and-prep:paused:` marker. Keep the testing hold and preparation incomplete if the comment fails to post; recheck it on resume. The body's status preserves the hold. Use `<!-- review-and-prep:paused:<full-sha> -->`, `Resume with /review-and-prep resume; do not run /ship on this draft.` and `Full receipt: <evidence locator>; sha256: <64 hex>` in the comment. While the run state is recorded, guard the paused receipt render with the calls document's **Fixed points** (`\"<extend-root>/bin/review-state\" render --help`).",
  },
  {
    skill: "review-and-prep",
    sectionHeading: "## 1. Establish the branch, PR, and review inputs",
    ref: "resume-review-records",
    refTitle: "Corroboration and resumption of existing review records",
    startMarker: "While the run state is recorded, a resume or repeat invocation first runs the calls document's **Resume** procedure, which supplies the recorded checkpoint, passes and gate results that the reads below would otherwise rebuild; the corroboration and authorization rules below still apply.",
    endBeforeMarker: "Read the actual CI triggers before the first push, including any relevant",
    readInstructionSuffix: "before resuming or reusing an earlier preparation run when Step 1 finds a matching PR, prior run state, or external-gate checkpoint",
    coreGate: "With `full-suite=external`, check **Resume entry** before scheduling review or checks even when no PR exists. On a resume, read and corroborate the newest run state or receipt for this exact repository, branch and candidate. Existing manual, configuration, Greptile or cycle-cap holds stand until separately resolved. Recency alone never clears them. Do not start a new review after a cycle-cap stop without continuation authorization. A ready PR with pending changes or unverifiable preparation cannot run preparation again. A later corroborated pause may resolve the review-stop restriction with `reviewRestrictionResolved: true`. While the run state is recorded, a resume or repeat invocation first runs the calls document's **Resume** procedure. Corroborate the record by author and edit history.",
  },
  {
    skill: "review-and-prep",
    sectionHeading: "### Workflow metrics (optional, local)",
    ref: "conditional-metrics-findings",
    refTitle: "Review finding attribution and correction metrics",
    startMarker: "- A fix batch is a `kind:\"fix\"` step, counted separately from passes. Greptile is",
    endBeforeMarker: "- Waits as `kind:\"wait\"` steps (`gx_span_begin_wait`) with `wait_category`",
    readInstructionSuffix: "before attributing a finding or recording a correction or fix batch when `GX_CAPTURE=1`",
  },
  {
    skill: "review-and-prep",
    sectionHeading: "### Workflow metrics (optional, local)",
    ref: "conditional-workflow-metrics",
    refTitle: "Workflow metrics capture and span wrappers",
    startMarker: "- Waits as `kind:\"wait\"` steps (`gx_span_begin_wait`) with `wait_category`",
    endBeforeMarker: "Own the interval between implementation and `/ship-and-land`:",
    readInstructionSuffix: "before recording ordinary wait and receipt metrics when `GX_CAPTURE=1`",
  },
  {
    skill: "review-and-prep",
    sectionHeading: "### Prove /ship's release gates on this head",
    ref: "conditional-coverage-gap-audit",
    refTitle: "Coverage-audit adjustments for recorded test gaps",
    startMarker: "   Under `test-gaps: active`, **Record unproven test gaps** changes only how",
    endBeforeMarker: "3. **Documentation audit.** Run `/ship`'s Documentation audit section with its",
    readInstructionSuffix: "before handling coverage gaps when `test-gaps: active` applies",
    coreGate: "The coverage audit still runs. Apply the recorded-gaps threshold only when every remaining gap is eligible and recorded. A reproduced regression or a required unrecordable gap takes the audit's ordinary generation and threshold rules.",
  },
  {
    skill: "review-and-prep",
    sectionHeading: "### Prove /ship's release gates on this head",
    ref: "conditional-doc-gate-reuse",
    refTitle: "Documentation-gate reuse and freshness rules",
    startMarker: "   Under active `doc-audit-gap=auto`, any documentation freshness check that",
    endBeforeMarker: "4. **Pregate and test lanes.** Under `full-suite=external`, first take **Pause",
    readInstructionSuffix: "before preparing a documentation audit or rechecking freshness when `post-audit=classify` or active `doc-audit-gap=auto` applies",
    coreGate: "Under active `doc-audit-gap=auto`, check reuse before spending a re-audit attempt and after a failed attempt, verify Prepare and stopped-child evidence on resume, and use the verified-base cap check in place of upstream's origin-based cap lookup for every audit acceptance.",
    navigationEdits: [['the verified-base cap check below', "the cap check in **Classify changes after the documentation audit's last attempt**"]],
  },
  {
    skill: "review-and-prep",
    sectionHeading: "### Take recommended fix-scope options without asking",
    ref: "conditional-auto-choice-receipts",
    refTitle: "Auto-choice evidence, deferrals and vetoes",
    startMarker: "Record each auto-choice when it is taken, in the evidence directory and then in",
    endBeforeMarker: null,
    readInstructionSuffix: "before recording or resolving an auto-choice when the skill took a recommended fix-scope option",
    coreGate: "Record every auto-choice in evidence and repeat it in receipts and every exit. A verified user's veto blocks readiness until resolved; it cannot authorize unoffered work.\n\n`Auto-chosen (veto by replying on this PR): <question> → <option>`",
  },
  {
    skill: "review-and-prep",
    sectionHeading: "### Bound Claude Code outside calls",
    ref: "conditional-outside-recovery",
    refTitle: "Claude Code outside-review recovery outcomes",
    startMarker: "A completed response with a marker failure is a **parse failure**, not a",
    endBeforeMarker: null,
    readInstructionSuffix: "before classifying an uncredited outside voice when the wrapper reports a parse, context or transport failure",
    coreGate: "An uncredited outside voice stays missing coverage. No retry with unchanged input. Retain provider results, and reconcile any unresolved claim before deciding another action.",
  },
  {
    skill: "review-and-prep",
    sectionHeading: "### Hosts with bounded subagent waits",
    ref: "conditional-bounded-reviewer-waits",
    refTitle: "Review host wait and dispatch details",
    startMarker: "- A wait that times out means the subagent is still running, not failed. Do",
    endBeforeMarker: null,
    readInstructionSuffix: "before dispatching or waiting on reviewers when the host has bounded waits and cannot stop them",
    coreGate: "A fixed wait timeout leaves the subagent running. Keep waiting until it returns or the 15-minute failure budget expires. Never dispatch a speculative replacement. On these hosts Red Team runs only in cycle 1.",
    navigationEdits: [['provider-failure rule above', '**Report elapsed time and stop on provider failures**']],
  },
  {
    skill: "review-and-prep",
    ref: "conditional-agent-qa",
    refTitle: "Report-only agent QA setup and execution",
    sectionHeading: "### Verify agent-checkable items before any pause",
    startMarker: "Choose the skill from what this host has installed. List the upstream QA skills",
    endBeforeMarker: "Record each check on its matrix row: the skill and its version or SKILL.md",
    readInstructionSuffix: "before choosing and driving a QA skill when an agent-checkable item still needs an observable flow check",
    coreGate: "The parent owns fixes. Use an installed report-only QA skill and an isolated build or fixture at the current candidate. Unexpected worktree changes block the check. Never direct the QA skill to edit, commit or install project files.",
  },
];

export function computeRefDigest(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
}

export function closingMarkerFor(skill: string, ref: string): string {
  return `<!-- end of skills/references/${skill}/${ref}.md -->`;
}

export const READ_INSTRUCTION_RE =
  /^Run `~\/\.gstack-extend\/bin\/preamble (?<skill>[a-z0-9-]+) --ref (?<ref>[a-z0-9-]+) --expect (?<digest>[0-9a-f]{16})` (?<suffix>before .+)\.$/gm;

export interface ParsedReadInstruction {
  skill: string;
  ref: string;
  digest: string;
  suffix: string;
  line: string;
}

export function parseReadInstructions(coreContent: string): ParsedReadInstruction[] {
  const out: ParsedReadInstruction[] = [];
  for (const m of coreContent.matchAll(READ_INSTRUCTION_RE)) {
    out.push({
      skill: m.groups!.skill!,
      ref: m.groups!.ref!,
      digest: m.groups!.digest!,
      suffix: m.groups!.suffix!,
      line: m[0],
    });
  }
  return out;
}

export function formatReadInstruction(skill: string, ref: string, digest: string, suffix: string): string {
  return `Run \`~/.gstack-extend/bin/preamble ${skill} --ref ${ref} --expect ${digest}\` ${suffix}.`;
}

/** Extract the exact line range [startIdx, endIdx) of a section heading (outside fences). */
function findSectionBounds(lines: string[], heading: string): { start: number; end: number } {
  let openChar = '';
  let openLen = 0;
  let start = -1;
  let startLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      const marks = fence[1]!;
      const rest = fence[2] ?? '';
      if (openLen === 0) {
        openChar = marks[0]!;
        openLen = marks.length;
      } else if (marks[0] === openChar && marks.length >= openLen && rest.trim() === '') {
        openChar = '';
        openLen = 0;
      }
      continue;
    }
    if (openLen !== 0) continue;
    const h = /^(#{1,6}) /.exec(line);
    if (!h) continue;
    const level = h[1]!.length;
    if (start < 0) {
      if (line === heading) {
        start = i;
        startLevel = level;
      }
      continue;
    }
    if (level <= startLevel) return { start, end: i };
  }
  if (start < 0) throw new Error(`Section heading not found: ${heading}`);
  return { start, end: lines.length };
}

/** Locate one manifest entry's exact line range [from, to) inside `baseText`. */
export function extractManifestSlice(baseText: string, entry: MoveEntry): { from: number; to: number; block: string; kept: string[] } {
  const lines = baseText.split('\n');
  const { start, end } = findSectionBounds(lines, entry.sectionHeading);
  let from = -1;
  for (let i = start; i < end; i++) {
    if (lines[i] === entry.startMarker) {
      from = i;
      break;
    }
  }
  if (from < 0) {
    throw new Error(`startMarker not found in ${entry.sectionHeading}: ${entry.startMarker}`);
  }
  let to = end;
  if (entry.endBeforeMarker !== null) {
    to = -1;
    for (let i = from + 1; i < end; i++) {
      if (lines[i] === entry.endBeforeMarker) {
        to = i;
        break;
      }
    }
    if (to < 0) {
      throw new Error(`endBeforeMarker not found in ${entry.sectionHeading}: ${entry.endBeforeMarker}`);
    }
  }
  // Trim trailing blank lines from the extracted block so the reference file stays clean.
  let trimmedTo = to;
  while (trimmedTo > from && lines[trimmedTo - 1] === '') trimmedTo--;
  const moved = lines.slice(from, trimmedTo);
  const kept = entry.keepCapabilityChecks
    ? moved.filter((line) => line.includes('grep -F '))
    : [];
  let block = moved.filter((line) => !kept.includes(line)).join('\n');
  for (const [source, target] of entry.navigationEdits ?? []) {
    const index = block.indexOf(source);
    if (index < 0 || index !== block.lastIndexOf(source)) {
      throw new Error(`Expected one navigation edit in ${entry.ref}: ${source}`);
    }
    block = block.slice(0, index) + target + block.slice(index + source.length);
  }
  return { from, to: trimmedTo, block, kept };
}

export interface ConservationResult {
  ok: boolean;
  errors: string[];
  movedBlocks: number;
  droppedLines: string[];
}

/**
 * Conservation check: verify every manifest entry from `baseText` appears as one
 * contiguous block (with any declared navigation edits) in source order, and
 * that every non-blank line of `baseText` is conserved in either the new core
 * or its manifest reference file, and no core-only gate heading was removed.
 */
export function checkConservation(
  skill: string,
  baseText: string,
  candidateCore: string,
  references: Record<string, string>,
  manifest: readonly MoveEntry[] = MOVE_MANIFEST.filter((m) => m.skill === skill),
): ConservationResult {
  const errors: string[] = [];
  const baseLines = baseText.split('\n');
  const movedLineFlags = new Array<boolean>(baseLines.length).fill(false);

  // Track last matched offset per reference file so source order is enforced.
  const lastOffsetByRef = new Map<string, number>();

  for (const entry of manifest) {
    let slice: { from: number; to: number; block: string };
    try {
      slice = extractManifestSlice(baseText, entry);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
      continue;
    }
    for (let i = slice.from; i < slice.to; i++) movedLineFlags[i] = true;

    const refBody = references[entry.ref];
    if (refBody === undefined) {
      errors.push(`missing target reference file: skills/references/${skill}/${entry.ref}.md`);
      continue;
    }
    const prevOffset = lastOffsetByRef.get(entry.ref) ?? 0;
    const foundAt = refBody.indexOf(slice.block, prevOffset);
    if (foundAt < 0) {
      const anywhere = refBody.indexOf(slice.block);
      if (anywhere >= 0) {
        errors.push(`reordered block in skills/references/${skill}/${entry.ref}.md for ${entry.sectionHeading}`);
      } else {
        errors.push(`missing or modified moved block in skills/references/${skill}/${entry.ref}.md for ${entry.sectionHeading}`);
      }
      continue;
    }
    lastOffsetByRef.set(entry.ref, foundAt + slice.block.length);

    // Every section heading in the manifest must remain in the core (gates/anchors stay in core).
    if (!candidateCore.includes(`\n${entry.sectionHeading}\n`) && !candidateCore.startsWith(`${entry.sectionHeading}\n`)) {
      errors.push(`section heading moved out of core: ${entry.sectionHeading}`);
    }
  }

  // Every unmoved line from baseText must still appear verbatim in candidateCore.
  const coreLineCounts = new Map<string, number>();
  for (const l of candidateCore.split('\n')) {
    coreLineCounts.set(l, (coreLineCounts.get(l) ?? 0) + 1);
  }
  const droppedLines: string[] = [];
  for (let i = 0; i < baseLines.length; i++) {
    if (movedLineFlags[i]) continue;
    const line = baseLines[i]!;
    if (line === '') continue;
    const remaining = coreLineCounts.get(line) ?? 0;
    if (remaining > 0) {
      coreLineCounts.set(line, remaining - 1);
    } else {
      droppedLines.push(`L${i + 1}: ${line}`);
    }
  }
  if (droppedLines.length > 0) {
    errors.push(`${droppedLines.length} unmoved line(s) from base are missing in candidate core`);
  }

  if (errors.length === 0) {
    const expected = applyManifestToSkill(skill, baseText, manifest);
    if (expected.core !== candidateCore) {
      errors.push(`unexpected core edits or read-instruction placement in skills/${skill}.md`);
    }
    for (const ref of new Set([...Object.keys(expected.references), ...Object.keys(references)])) {
      if (expected.references[ref] !== references[ref]) {
        errors.push(`unexpected edits in skills/references/${skill}/${ref}.md`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    movedBlocks: manifest.length,
    droppedLines,
  };
}

/** Build reference files and slimmed core from `baseText` + `manifest`. */
export function applyManifestToSkill(
  skill: string,
  baseText: string,
  manifest: readonly MoveEntry[] = MOVE_MANIFEST.filter((m) => m.skill === skill),
): { core: string; references: Record<string, string>; digests: Record<string, string> } {
  const baseLines = baseText.split('\n');
  const slices = manifest.map((entry) => ({
    entry,
    ...extractManifestSlice(baseText, entry),
  })).sort((left, right) => left.from - right.from);
  for (let index = 1; index < slices.length; index++) {
    if (slices[index]!.from < slices[index - 1]!.to) {
      throw new Error(`Overlapping reference moves in ${slices[index]!.entry.sectionHeading}`);
    }
  }

  // Group blocks per reference file in source order.
  const byRef = new Map<string, { title: string; blocks: Array<{ heading: string; block: string }> }>();
  for (const s of slices) {
    const cur = byRef.get(s.entry.ref) ?? { title: s.entry.refTitle, blocks: [] };
    cur.blocks.push({ heading: s.entry.sectionHeading, block: s.block });
    byRef.set(s.entry.ref, cur);
  }

  const references: Record<string, string> = {};
  const digests: Record<string, string> = {};
  for (const [ref, data] of byRef.entries()) {
    const parts: string[] = [`# /${skill} reference: ${data.title}`, ''];
    let lastHeading = '';
    for (const b of data.blocks) {
      if (b.heading !== lastHeading) {
        parts.push(`## From ${b.heading.replace(/^#{1,6}\s+/, '')}`, '');
        lastHeading = b.heading;
      }
      parts.push(b.block, '');
    }
    parts.push(closingMarkerFor(skill, ref), '');
    const content = parts.join('\n');
    references[ref] = content;
    digests[ref] = computeRefDigest(content);
  }

  // Replace moved ranges in reverse line order so earlier indices stay valid.
  const sortedDesc = [...slices].reverse();
  const outLines = [...baseLines];
  for (const s of sortedDesc) {
    const instr = formatReadInstruction(skill, s.entry.ref, digests[s.entry.ref]!, s.entry.readInstructionSuffix);
    const retained = s.entry.coreGate ? [s.entry.coreGate, '', ...s.kept, instr] : [...s.kept, instr];
    outLines.splice(s.from, s.to - s.from, ...retained);
  }

  let core = outLines.join('\n');
  // Insert CORE_REFERENCE_RULE right before <!-- SHARED:upgrade-flow --> if not already present.
  if (!core.includes('### Reference files and mid-run upgrades')) {
    const anchor = '<!-- SHARED:upgrade-flow -->';
    const idx = core.indexOf(anchor);
    if (idx < 0) throw new Error(`Missing ${anchor} in skills/${skill}.md`);
    core = `${core.slice(0, idx)}${CORE_REFERENCE_RULE}\n\n${core.slice(idx)}`;
  }

  return { core, references, digests };
}

function readGitFile(ref: string, relPath: string, repoRoot: string = REPO_ROOT): string {
  const r = spawnSync('git', ['-C', repoRoot, 'show', '--end-of-options', `${ref}:${relPath}`], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`git show ${ref}:${relPath} failed: ${r.stderr.trim()}`);
  }
  return r.stdout;
}

function listRefFilesOnDisk(skill: string, repoRoot: string = REPO_ROOT): Record<string, string> {
  const dir = join(repoRoot, 'skills', 'references', skill);
  const out: Record<string, string> = {};
  if (!existsSync(dir)) return out;
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.md')) continue;
    const p = join(dir, file);
    if (!statSync(p).isFile()) continue;
    out[file.slice(0, -3)] = readFileSync(p, 'utf8');
  }
  return out;
}

function printUnexpectedDiff(
  skill: string,
  baseText: string,
  core: string,
  refs: Record<string, string>,
): void {
  let expected: ReturnType<typeof applyManifestToSkill>;
  try {
    expected = applyManifestToSkill(skill, baseText);
  } catch {
    return; // The caller already prints the manifest extraction error.
  }
  const directory = mkdtempSync(join(tmpdir(), 'skill-reference-diff-'));
  try {
    const before = join(directory, 'expected');
    const after = join(directory, 'candidate');
    const compare = (path: string, oldText = '', newText = ''): void => {
      if (oldText === newText) return;
      writeFileSync(before, oldText);
      writeFileSync(after, newText);
      console.error(`Unexpected difference in ${path}:`);
      const diff = spawnSync('git', ['diff', '--no-index', '--no-ext-diff', '--no-color', '--text', '--', before, after], {
        encoding: 'utf8',
      });
      console.error(diff.stdout || diff.stderr || 'Unable to format the diff.');
    };
    compare(`skills/${skill}.md`, expected.core, core);
    for (const ref of new Set([...Object.keys(expected.references), ...Object.keys(refs)])) {
      compare(`skills/references/${skill}/${ref}.md`, expected.references[ref], refs[ref]);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runCli(argv: string[]): number {
  const cmd = argv[0];
  let baseRef: string | undefined;
  let selectedSkill: string | undefined;
  let writeMode = false;
  for (let i = 1; i < argv.length; i++) {
    if ((cmd === 'apply' || cmd === 'check') && argv[i] === '--base' && !baseRef && argv[i + 1] && !argv[i + 1]!.startsWith('-')) {
      baseRef = argv[++i];
    } else if (argv[i] === '--skill' && !selectedSkill && argv[i + 1] && !argv[i + 1]!.startsWith('-')) {
      selectedSkill = argv[++i];
    } else if (cmd === 'digests' && argv[i] === '--write' && !writeMode) {
      writeMode = true;
    } else {
      console.error(`Unknown argument: ${argv[i]}`);
      return 2;
    }
  }

  const skills = [...new Set(MOVE_MANIFEST.map((m) => m.skill))].filter((skill) => !selectedSkill || skill === selectedSkill);
  if (skills.length === 0) {
    console.error(`No move manifest for ${selectedSkill}.`);
    return 2;
  }
  if ((cmd === 'apply' || cmd === 'check') && !baseRef) {
    console.error('Pass --base <pre-move ref> for the selected skill(s). See docs/skill-references.md.');
    return 2;
  }

  if (cmd === 'apply') {
    for (const skill of skills) {
      const baseText = readGitFile(baseRef!, `skills/${skill}.md`);
      const { core, references, digests } = applyManifestToSkill(skill, baseText);
      const refDir = join(REPO_ROOT, 'skills', 'references', skill);
      mkdirSync(refDir, { recursive: true });
      for (const [ref, content] of Object.entries(references)) {
        writeFileSync(join(refDir, `${ref}.md`), content);
        console.log(`WROTE skills/references/${skill}/${ref}.md (${Buffer.byteLength(content, 'utf8')} B, digest=${digests[ref]})`);
      }
      writeFileSync(join(REPO_ROOT, 'skills', `${skill}.md`), core);
      console.log(`WROTE skills/${skill}.md (${Buffer.byteLength(baseText, 'utf8')} -> ${Buffer.byteLength(core, 'utf8')} B)`);
    }
    return 0;
  }

  if (cmd === 'check') {
    let failed = false;
    for (const skill of skills) {
      const baseText = readGitFile(baseRef!, `skills/${skill}.md`);
      const coreText = readFileSync(join(REPO_ROOT, 'skills', `${skill}.md`), 'utf8');
      const refs = listRefFilesOnDisk(skill);
      const res = checkConservation(skill, baseText, coreText, refs);
      console.log(
        `CONSERVATION ${skill}: ok=${res.ok} blocks=${res.movedBlocks} dropped=${res.droppedLines.length} base=${Buffer.byteLength(baseText, 'utf8')}B core=${Buffer.byteLength(coreText, 'utf8')}B`,
      );
      if (!res.ok) {
        failed = true;
        for (const e of res.errors) console.error(`  ERROR: ${e}`);
        for (const d of res.droppedLines) console.error(`  DROPPED: ${d}`);
        printUnexpectedDiff(skill, baseText, coreText, refs);
      }
    }
    return failed ? 1 : 0;
  }

  if (cmd === 'digests') {
    let mismatch = false;
    for (const skill of skills) {
      const corePath = join(REPO_ROOT, 'skills', `${skill}.md`);
      let coreText = readFileSync(corePath, 'utf8');
      const refs = listRefFilesOnDisk(skill);
      const instrs = parseReadInstructions(coreText);
      let updated = false;
      for (const instr of instrs) {
        const content = refs[instr.ref];
        if (content === undefined) {
          console.error(`MISSING_REF: ${skill}/${instr.ref}`);
          mismatch = true;
          continue;
        }
        const actual = computeRefDigest(content);
        if (actual === instr.digest) {
          console.log(`OK ${skill}/${instr.ref} ${actual}`);
        } else if (writeMode) {
          const replacement = formatReadInstruction(skill, instr.ref, actual, instr.suffix);
          coreText = coreText.replaceAll(instr.line, () => replacement);
          updated = true;
          console.log(`UPDATED ${skill}/${instr.ref} ${instr.digest} -> ${actual}`);
        } else {
          console.error(`MISMATCH ${skill}/${instr.ref} core=${instr.digest} actual=${actual}`);
          mismatch = true;
        }
      }
      if (writeMode && updated) {
        writeFileSync(corePath, coreText);
      }
    }
    return mismatch ? 1 : 0;
  }

  console.error('Usage: bun scripts/skill-references.ts apply|check --base <pre-move ref> [--skill <name>] | digests [--skill <name>] [--write]');
  return 2;
}

if (import.meta.main) {
  process.exit(runCli(process.argv.slice(2)));
}
