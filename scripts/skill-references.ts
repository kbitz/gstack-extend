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

Read conditional instructions from the verified gstack-extend checkout with the named \`~/.gstack-extend/bin/preamble <skill> --ref <file> --expect <digest>\` command.

- **On step entry.** Run the named command on every entry, even after compaction. Verify the \`REFERENCE_END\` digest and contiguous numbered lines 1 through \`lines=<N>\`. If the trailer was elided, get it with \`--lines 1-1\`, then fetch missing lines with bounded ranges. If verification fails, report \`SKILL_REFERENCE_INCOMPLETE\` with step, reference, harness and version and take the failure exit.
- **On failure.** Relay \`SKILL_REFERENCE_*\` verbatim; for \`PREAMBLE_USAGE\` or a missing launcher relay the start-command fix. Never use moved instructions from memory. Record only the cause and repository-relative reference path in receipts and PR bodies. Use the core's explicit fallback for optional reads. Otherwise preserve inline holds and finish telemetry with \`--outcome error\`. Where applicable end with \`Stage handoff: stage-handoff/v1; stage: <token from the final stage template>; next: none; status: blocked; head: <HEAD or none>; plan-sha256: <plan SHA-256 or none>\`. Resume the existing work.
- **Host subagents.** Fetch each needed reference and start the reply with \`REFERENCE_READ <skill>/<file> lines=<N> digest=<digest>\`. A missing header or wrong digest means incomplete-reviewer or missing coverage. If the host denies the command, the primary fetches and passes the text inline for that host. Helper-run delegates keep their code-built prompts.
- **Mid-run upgrade.** If **Inline upgrade flow** printed \`UPGRADE_OK\` in this run, tell the user the upgrade finished and to rerun this skill so the loaded instructions match the updated checkout. Run Telemetry finish and stop before Step 1.`;

export interface MoveEntry {
  skill: string;
  ref: string;
  refTitle: string;
  sectionHeading: string;
  startMarker: string;
  endBeforeMarker: string | null;
  /** Text appended after the backticked preamble command in the read instruction. */
  readInstructionSuffix: string | null;
  /** Other entry points that need this same reference before using the moved steps. */
  additionalReads?: readonly (readonly [sectionHeading: string, suffix: string])[];
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
    endBeforeMarker: '- derive writes the run `begin`. In the call that runs the first derive of a',
    readInstructionSuffix: null,
    coreGate: "Capture changes no gate, finding or readiness. Both metrics reads below are optional. If either fails, set `GX_CAPTURE=0` for this segment, skip metrics wrappers and continue the workflow. Record `capture=partial (reference-unavailable)`. For unavailable capture, no session ID or a failed receipt read, write `Workflow metrics (local, optional): capture=disabled|unavailable|partial (<reason>).` with the actual status and reason.",
    navigationEdits: [['the literal status line below', 'the core metrics status line']],
  },
  {
    skill: 'review-and-prep',
    ref: 'conditional-workflow-metrics',
    refTitle: 'Workflow metrics capture and span wrappers',
    sectionHeading: '### Workflow metrics (optional, local)',
    startMarker: '- One governing `decision` per executed phase visit, recorded under the phase of',
    endBeforeMarker: '- A fix batch is a `kind:"fix"` step, counted separately from passes. Greptile is',
    readInstructionSuffix: "before the first span, decision or receipt read when `GX_CAPTURE=1` for this workflow segment",
    coreGate: "Enter this metrics step once per bound segment and reuse the read for its spans. Re-enter after compaction if its instructions are absent.",
  },
  {
    skill: 'review-and-prep',
    ref: 'conditional-greptile-recovery',
    refTitle: 'Greptile second-run detection, user-decision exits, and configuration repair',
    sectionHeading: '### Detect whether marking ready would start a second run',
    startMarker: 'The ready transition starts an automatic run unless the effective trigger list',
    endBeforeMarker: null,
    readInstructionSuffix: 'before evaluating trigger settings when Greptile applies or a recorded request/run has consumed the allowance',
    coreGate: "Treat `push`, `rebase`, legacy `triggerOnUpdates: true` and unknown effective settings as including `open`. If readiness would start a run, take E1 before review. After a request or run exists, readiness requires E1(a).",
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
    readInstructionSuffix: 'before deciding or reporting Red Team applicability when `red-team=ensure` or `delegate=` names `red-team`',
  },
  {
    skill: 'review-and-prep',
    ref: 'delegate-red-team-and-fold',
    refTitle: 'Red-team pass, folded specialist checklists, and overlapped cycle-1 reviewers',
    sectionHeading: '### Fold specialist checklists into cycle 1',
    startMarker: 'This is a **wrapper override**, not an upstream fork: it changes who applies a',
    endBeforeMarker: null,
    readInstructionSuffix: 'before folding specialist checklists when the review policy carries `specialists=fold` and the activation anchors match',
    coreGate: "On anchor drift record `Review arm: dispatch — anchor changed (<which>)` and use upstream dispatch. Where declared, waive `specialists-dispatched` once per applied fold with `gstack-skill-contract waive specialists-dispatched --reason \"<why>\"`. Keep its outcome and history.",
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
    ref: 'conditional-behavior-repairs',
    refTitle: 'Behavior-changing repair classification',
    sectionHeading: '### Reopen review only for behavior-changing repairs',
    startMarker: "**Classify the batch once.** Under the active value only, after `/review`'s",
    endBeforeMarker: null,
    readInstructionSuffix: 'before classifying a repair batch when `repair-review: active` under `repair-review=behavior-changing`',
  },
  {
    skill: 'review-and-prep',
    ref: 'conditional-repair-and-gaps',
    refTitle: 'Unproven test gaps and shown-finding blocking',
    sectionHeading: '### Record unproven test gaps',
    startMarker: '**A recordable gap** meets all of these:',
    endBeforeMarker: null,
    readInstructionSuffix: 'before recording unproven test gaps when `test-gaps: active` under `test-gaps=record`',
  },
  {
    skill: 'review-and-prep',
    ref: 'conditional-repair-and-gaps',
    refTitle: 'Unproven test gaps and shown-finding blocking',
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
    startMarker: '2. Without a policy that names `continuation`, ask the user: repair-only',
    endBeforeMarker: "On `/review-and-prep continue`, refresh Step 1's live state. A later pause or",
    readInstructionSuffix: "before saving a cycle-cap receipt when `/review` stops at its three-cycle cap",
    coreGate: "Before fetching, save the cap hold at that HEAD using `checkpoint stop` while recording. On fetch failure, retain the compact `<!-- review-and-prep:stopped:<full-sha> -->` from **Inline outputs** with `Full-review evidence: unavailable` and no continuation prompt. Look up the marker before posting or retrying. Reuse one corroborated match; post only if absent. If posting fails or history is ambiguous, keep `STOPPED — review cycle cap` in the draft body and receipt, then take the reference failure exit. Step 1 reconciles the hold first. An ordinary stop uses H-E only with authorization and allowance, finishing `--outcome blocked` with no `STATUS:` line.",
    navigationEdits: [['`next-cycle` late write above.', "`next-cycle` late write in **Record cycle 1's full-review baseline**."]],
  },
  {
    skill: 'review-and-prep',
    ref: 'conditional-post-audit-classification',
    refTitle: 'Post-audit diff classification and outcomes',
    sectionHeading: "### Classify changes after the documentation audit's last attempt",
    startMarker: "**The delta.** Compute the delta from the last accepted audit's post-child",
    endBeforeMarker: '**Under `doc-audit-gap=auto`.** Under `doc-audit-gap=auto`, apply this paragraph',
    readInstructionSuffix: "before classifying an exhausted audit, recording why classification did not apply or evaluating active `doc-audit-gap=auto` reuse when the policy carries `post-audit=classify`",
    coreGate: "Carry the accepted audit unchanged when every change qualifies for `owner=not-needed`. Otherwise take the owner stop under blocked recovery, subject to the active `doc-audit-gap=auto` rules. Test-gate freshness still applies.",
  },
  {
    skill: 'review-and-prep',
    ref: 'conditional-post-audit-reuse',
    refTitle: 'Documentation audit reuse checks and attempt entry points',
    sectionHeading: "### Classify changes after the documentation audit's last attempt",
    startMarker: '**Under `doc-audit-gap=auto`.** Under `doc-audit-gap=auto`, apply this paragraph',
    endBeforeMarker: '1. **`undocumented-internal` class (`owner=not-needed`).** When an existing',
    readInstructionSuffix: 'before Prepare, documentation cap check or reuse evaluation when `doc-audit-gap=auto` is active',
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
    coreGate: "Record `contract-missing` at `classification-unreadable` when the contract cannot be read. Failed safe restoration stops BLOCKED as `restore-failed`. Other unverified repairs take ordinary rules.",
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
    coreGate: "Require Step 3's manual checkpoint and integrated draft. Existing runs or requests consume the one allowance. Check settings and labels and wait for any configured auto-run. Verify all prior markers and runs. Only the earliest confirmed `<!-- review-and-prep:greptile-reservation:<full-sha> -->` can post the trigger `<!-- review-and-prep:greptile:<full-sha> -->`. Check `--is-shallow-repository` and deepen via `git fetch --unshallow` before E7 on non-ancestor evidence. Ambiguous requests take E4, incomplete runs take E6 and failed or cancelled runs take E2. Keep draft until corroborated completion or the fallback. A confirmed comment unanswered after 10 minutes with no observable request or run yields `Greptile: unverified — no response after 10 minutes` and no completion credit. Any later run supersedes it.",
  },
  {
    skill: "review-and-prep",
    sectionHeading: "## 5. Triage, fix, and verify locally",
    ref: "conditional-greptile-run",
    refTitle: "Greptile reservation, submission and monitoring procedure",
    startMarker: "Use the installed `/review` Greptile triage instructions for classification and",
    endBeforeMarker: "After fixes, review the changed code and run applicable local verification.",
    readInstructionSuffix: "before Step 5 triage when Step 1 says Greptile applies, including after a no-response fallback",
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
    coreGate: "A delta uses frozen candidates and a valid ancestor base. Run `gstack-diff-scope \"B\"` and require the reference's path guard to print `SCOPE_DELTA: covered`. Any unverified binding, dependency, selection or changed plan triggers full scope. Delta coverage is never full-review evidence.",
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
    coreGate: "Validate opt-ins. `full-suite=external` pauses for a result; `full-suite=final` runs targeted lanes before the final full run. `doc-audit-gap=auto` needs `full-suite=external` and `post-audit=classify`. Together `specialists=fold` and `delegate=` read as `none supplied`. Either excludes `first-cycle=overlap`. Use host fallback for unavailable delegation. Light skips apply only to eligible delta repairs; `in-cap=full` overrides. Repair-only needs a verified baseline and authorization.\n\n**Published capability commands:**",
  },
  {
    skill: "review-and-prep",
    sectionHeading: "### Readiness",
    ref: "conditional-receipt-policy-rows",
    refTitle: "Receipt rows for active optional policies",
    startMarker: "| `Final-gate repair:`, `Final-gate repair rerun:`, `Final-gate repair review:`, `Final-gate repair refusal:` | when `final-gate-repair=tests-docs` ran a repair or fallback, with the authorizing policy line (**Repair a test-only final-gate failure**) | yes | yes | no |",
    endBeforeMarker: "For each test run, include a `Test selection:` line from",
    readInstructionSuffix: "before assembling receipt rows when a policy or the settled-context step produced them",
    coreGate: "Persist a required pause or stop checkpoint before reading optional receipt rows. If the read fails, preserve that hold and the known compact status. Include applicable policy rows and policy values, including settled status when produced without a policy. An unverified gate stays unverified.",
  },
  {
    skill: "review-and-prep",
    sectionHeading: "### Record cycle 1's full-review baseline",
    ref: "conditional-cycle-followup",
    refTitle: "Fix-review records, checkpoint misses and late evidence",
    startMarker: "- **Fix-review record.** When cycle 1's record says",
    endBeforeMarker: "- **Files and write-once.** Write the records as `cycle-1-baseline.json` and",
    readInstructionSuffix: "before checking fix-review evidence or recovering a missed record when a later review cycle begins or the cycle-cap stop reads the baseline",
    coreGate: "With the fence available, check `before-fix` for each required baseline or fix-review record. On `missing`, write from that collection and recheck. Require `present` before fixing. Late recovery uses contemporaneous evidence only at `next-cycle`. If the fence cannot persist the miss, stop before its readers.",
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
    sectionHeading: "## 1. Establish the branch, PR, and review inputs",
    ref: "resume-review-records",
    refTitle: "Corroboration and resumption of existing review records",
    startMarker: "While the run state is recorded, a resume or repeat invocation first runs the calls document's **Resume** procedure, which supplies the recorded checkpoint, passes and gate results that the reads below would otherwise rebuild; the corroboration and authorization rules below still apply.",
    endBeforeMarker: "Read the actual CI triggers before the first push, including any relevant",
    readInstructionSuffix: "before resuming or reusing an earlier preparation run when Step 1 finds a matching PR, prior run state, or external-gate checkpoint",
    coreGate: "Under `full-suite=external`, check **Resume entry** before review even without a PR. A resume or repeat first runs the calls document's **Resume** procedure to check the newest run state or receipt for this repository, branch and candidate. Corroborate the record by author and edit history. Existing manual, configuration, Greptile or cycle-cap holds stand until resolved. Recency alone never clears them. Reconcile a recorded cap hold even when no stop comment was confirmed. Do not start a new review after a cycle-cap stop without continuation authorization. Hold a ready PR with pending changes or unverifiable preparation. A later corroborated pause may resolve the review-stop restriction with `reviewRestrictionResolved: true`.",
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
    readInstructionSuffix: null,
  },
  {
    skill: "review-and-prep",
    sectionHeading: "### Prove /ship's release gates on this head",
    ref: "conditional-coverage-gap-audit",
    refTitle: "Coverage-audit adjustments for recorded test gaps",
    startMarker: "   Under `test-gaps: active`, **Record unproven test gaps** changes only how",
    endBeforeMarker: "3. **Documentation audit.** Run `/ship`'s Documentation audit section with its",
    readInstructionSuffix: "before dispatching the coverage audit when `test-gaps: active` applies",
    coreGate: "With `test-gaps: active`, dispatch coverage with `Generation: audit-only`. Apply the gap exception only to eligible, recorded gaps. Reproduced regressions and unrecordable gaps take ordinary generation and threshold rules.",
  },
  {
    skill: "review-and-prep",
    sectionHeading: "### Prove /ship's release gates on this head",
    ref: "conditional-doc-gate-reuse",
    refTitle: "Documentation-gate reuse and freshness rules",
    startMarker: "   Under active `doc-audit-gap=auto`, any documentation freshness check that",
    endBeforeMarker: "4. **Pregate and test lanes.** Under `full-suite=external`, first take **Pause",
    readInstructionSuffix: "before preparing a documentation audit or rechecking freshness when `post-audit=classify` or active `doc-audit-gap=auto` applies",
    coreGate: "With active `doc-audit-gap=auto`, take **Classify changes after the documentation audit's last attempt** at Prepare, before re-audit or after failure, and use the verified-base cap check in place of upstream's origin-based cap lookup for every audit acceptance. On resume verify Prepare and child stop.",
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
    readInstructionSuffix: "before handling recovered or uncredited outside results or a counted no-missing-context reply",
    coreGate: "Record parse details for every voice. Uncredited stays missing coverage. Retain provider results and reconcile open claims before any action. Never retry unchanged input.",
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
  // ── roadmap (PR B) ───────────────────────────────────────────────────────
  {
    skill: 'roadmap',
    ref: 'conditional-candidate-validation',
    refTitle: 'Shipped-Track reconciliation examples, complete-candidate validation, and recovery',
    sectionHeading: '### Common path',
    startMarker: '**Illustrative start/evidence**, not a claim about PR #109: Group 22 contains',
    endBeforeMarker: "Resolve the project root before Step 1's audit using its rule: an explicit audit",
    readInstructionSuffix: 'before drafting shipped-Track receipts or remainder previews when reconciling landed Tracks',
    coreGate: 'Verify land-time identity, approved scope/acceptance and raw archive receipts before recycling any ID. Use the attributable historical release version (or bare `✓ Shipped` with `release version unknown`).',
  },
  {
    skill: 'roadmap',
    ref: 'conditional-candidate-validation',
    refTitle: 'Shipped-Track reconciliation examples, complete-candidate validation, and recovery',
    sectionHeading: '### Complete-candidate validation',
    startMarker: 'Save active/archive drafts and this temporary Bun script **outside the workspace**',
    endBeforeMarker: 'After copying the script to its actual absolute path, invoke it with Bun and',
    readInstructionSuffix: 'before validating a complete active/archive candidate before any live write',
    coreGate: 'Validate the complete candidate outside the workspace against real Git/version/cap/scaffold metadata before either write; test stub metadata and live write-and-restore are insufficient.',
  },
  {
    skill: 'roadmap',
    ref: 'conditional-candidate-validation',
    refTitle: 'Shipped-Track reconciliation examples, complete-candidate validation, and recovery',
    sectionHeading: '### Exceptions and recovery',
    startMarker: '- **Historical identity/completion:** land as 16D, later relabel to 18B, then',
    endBeforeMarker: 'Use the existing [Escalation](#escalation) REASON/ATTEMPTED/RECOMMENDATION fields',
    readInstructionSuffix: 'before handling reconciliation exceptions when historical identity, duplicates, pins, Hold, or legacy conversion applies',
    coreGate: 'Incomplete proof, unresolved raw duplicates, incompatible pins, or Hold candidates that change the unfinished partition or dependencies refuse writes and keep active/archive unchanged.',
  },
  {
    skill: 'roadmap',
    ref: 'conditional-deferred-migration',
    refTitle: 'Legacy trigger migration and GitHub backlog filing',
    sectionHeading: '### Deferred work',
    startMarker: "1. **Scope.** Take the flagged entries that survive this run's manifestation",
    endBeforeMarker: 'For a user-selected GitHub backlog, the approval artifact names the destination',
    readInstructionSuffix: 'before running a legacy trigger migration when the owner selects the batch and this run does not move Future bullets',
    coreGate: 'Append-only migration: never promote, kill, rewrite, or reorder entries, and validate every approved bullet through the Future index before the first write. A failure blocks before the first write.',
  },
  {
    skill: 'roadmap',
    ref: 'conditional-deferred-migration',
    refTitle: 'Legacy trigger migration and GitHub backlog filing',
    sectionHeading: '### Deferred work',
    startMarker: "Run the recipe under bash (zsh's `echo` alters backslashes inside",
    endBeforeMarker: 'Do not automatically import all open issues into the execution plan.',
    readInstructionSuffix: "before filing deferred items to a user-selected GitHub backlog after Apply's freshness check passes",
    coreGate: 'Recheck repo visibility immediately before filing, pass title/body/query from files in a private `mktemp -d` directory, and keep pending or failed filings in the inbox or Future with full richness.',
  },
  {
    skill: 'roadmap',
    ref: 'delegate-progress-append',
    refTitle: 'Delegated PROGRESS.md version-row append and parent baseline verification',
    sectionHeading: '## Step 4: PROGRESS.md staleness check',
    startMarker: 'If the user picks "Yes", resolve the destination first: the single table the',
    endBeforeMarker: 'Right after the subagent reports, before Step 5, the parent compares',
    readInstructionSuffix: 'before saving the baseline and delegating the PROGRESS.md append when the user chooses "Yes, append rows"',
    coreGate: 'Give the foreground subagent the exact read command next, the inputs in its quoted prompt, and the required `REFERENCE_READ` reply header from the core reference rule. The child executes only its quoted prompt. Verify the header against the trailer you read. Use the inline fallback on a host denial. An absent or mismatched acknowledgment counts as a missing report under the append check in this step.',
    navigationEdits: [
      ['the\nrules above', 'the destination rules in **Step 4: PROGRESS.md staleness check**'],
      ['the STOP above', 'the Step 4 destination STOP in **Step 4: PROGRESS.md staleness check**'],
    ],
  },
  {
    skill: 'roadmap',
    ref: 'conditional-layout-plan',
    refTitle: 'Layout Scaffolding plan presentation and batch confirmation',
    sectionHeading: '### Plan presentation (single batch confirm)',
    startMarker: "- **Scaffold list:** every directory that should exist but doesn't. The canonical set is `docs/`, `docs/designs/`, `docs/archive/`. Only include dirs that don't already exist.",
    endBeforeMarker: null,
    readInstructionSuffix: 'before building and presenting the Layout Scaffolding batch plan when Trigger detection fires or the user explicitly requests layout scaffolding',
    coreGate: 'Run audited-root binding and preflight read-only before asking. **A) Apply** never authorizes external targets; unauthorizable refusals print with zero writes and exit without asking.',
    navigationEdits: [['the **Refusal format** below', 'the **Refusal format** for **Execution (apply path)**']],
  },
  {
    skill: 'roadmap',
    ref: 'conditional-layout-apply',
    refTitle: 'Layout Scaffolding preflight, execution, and post-apply verification',
    sectionHeading: '### Execution (apply path)',
    startMarker: '**Preflight — fail fast, mutate nothing.** Finish this whole procedure before any `mkdir` or move, including a moves-only plan whose scaffold list is empty. The preflight set is always `docs/`, `docs/designs/`, and `docs/archive/`, including directories that already exist and were omitted from the scaffold list, plus every destination parent an approved move uses (the audited root, when the destination has no parent) and every parent absorbed from a recognized `mkdir -p` prefix.',
    endBeforeMarker: null,
    readInstructionSuffix: 'before running Layout Scaffolding preflight, mkdir, or moves when the user approves A or C',
    additionalReads: [
      ['### Plan presentation (single batch confirm)', 'before running the read-only Layout Scaffolding preflight when preparing the batch plan'],
    ],
    coreGate: 'Finish preflight steps 1–5 with zero writes before any `mkdir` or move. Any failing or unauthorized path, existing destination, submodule, or tracked move through a symlink HALTs the whole batch with zero writes. Never rollback after partial writes; re-run `roadmap-audit` on clean success.',
  },
  // ── ship-and-land (PR B) ─────────────────────────────────────────────────
  {
    skill: 'ship-and-land',
    ref: 'conditional-workflow-metrics',
    refTitle: 'Workflow metrics capture, span wrappers, and receipts',
    sectionHeading: '### Workflow metrics (optional, local)',
    startMarker: 'Resolve `gstack-extend-telemetry` exactly as the telemetry blocks do. Every',
    endBeforeMarker: '- Once, before other metrics: `begin` with `kind:"run"`, `phase:"run"`, a fresh',
    readInstructionSuffix: 'before the workflow metrics run `begin` when this invocation retained a telemetry session ID',
    coreGate: 'Metrics capture is optional and never changes reuse, review, Greptile, ship/land readiness, or merge approval. If this reference cannot be read, set `GX_CAPTURE=0`, skip metrics wrappers, continue the workflow, and record `Workflow metrics (local, optional): capture=partial (reference-unavailable).` in receipts.',
    navigationEdits: [
      ['the literal status line below', 'the status line in the metrics receipt instructions'],
      ['the run `begin` (below)', 'the run `begin` under **Workflow metrics (optional, local)** in the core'],
    ],
  },
  {
    skill: 'ship-and-land',
    ref: 'conditional-workflow-metrics',
    refTitle: 'Workflow metrics capture, span wrappers, and receipts',
    sectionHeading: '### Workflow metrics (optional, local)',
    startMarker: '  Once the candidate changes (you first observe it, a base merge, a fix or release commit),',
    endBeforeMarker: 'Run `validate evidence → /ship with the overrides below → /land-and-deploy`.',
    readInstructionSuffix: null,
  },
  {
    skill: 'ship-and-land',
    ref: 'conditional-docs-profile',
    refTitle: 'DOCS profile coverage and docs test policy',
    sectionHeading: '### Choose the review profile',
    startMarker: 'For `DOCS`, require these three pieces of coverage:',
    endBeforeMarker: '- **Consistency:** run ship\'s required Documentation audit on the release candidate',
    readInstructionSuffix: 'before running DOCS-profile claims and plan coverage when the diff classifies as DOCS',
    coreGate: "DOCS requires an independent claims pass, ship's Documentation audit, and complete plan/scope audit; missing required output is incomplete coverage, never a clean pass.",
  },
  {
    skill: 'ship-and-land',
    ref: 'conditional-docs-profile',
    refTitle: 'DOCS profile coverage and docs test policy',
    sectionHeading: '### Choose the review profile',
    startMarker: '- **Plan and scope:** retain the complete approved-scope audit, verification and',
    endBeforeMarker: 'Record `docs-claims` and `docs-consistency` separately in the wrapper receipt;',
    readInstructionSuffix: null,
  },
  {
    skill: 'ship-and-land',
    ref: 'conditional-release-only',
    refTitle: 'Release-only stage table, hand-back template, and post-write recovery',
    sectionHeading: '### Release-only path',
    startMarker: "On this path reuse the receipt's `Ship gates` coverage and documentation audits",
    endBeforeMarker: '```text',
    readInstructionSuffix: 'before executing ship stages on the release-only path after all release-only preconditions pass',
    coreGate: 'Settle every reuse decision before Step 12. Ship never edits code, tests or docs on this path. A non-release finding stops and hands back to `/review-and-prep` (`next: review-and-prep; status: stopped`). Restore only verified unpushed release writes. Preserve published commits.',
    navigationEdits: [
      ['the provenance and binding checks above', 'the provenance and binding checks under **Release-only path** in the core'],
      ['matching stage-table rows below', 'matching rows under **Ship overrides** in the core'],
      ['Stop and hand back, naming the\nfinding:', 'Stop and hand back using the release-only hand-back template in **Release-only path** in the core, naming the\nfinding.'],
    ],
  },
  {
    skill: 'ship-and-land',
    ref: 'conditional-release-only',
    refTitle: 'Release-only stage table, hand-back template, and post-write recovery',
    sectionHeading: '### Release-only path',
    startMarker: 'Print the stage line after the hand-back fence (`next: review-and-prep; status: stopped`, `head` set to the fence\'s `head:`). A post-write failure, such as a build, a release check or the final preflight, stops before the',
    endBeforeMarker: null,
    readInstructionSuffix: null,
  },
  {
    skill: 'ship-and-land',
    ref: 'conditional-test-evidence',
    refTitle: 'Pregate-wrapped test evidence, release-metadata verification, and test selection',
    sectionHeading: '### Test evidence',
    startMarker: "For a new declared-runner run, use `/review-and-prep`'s **Pregate and test lanes**",
    endBeforeMarker: 'A test gate accepts',
    readInstructionSuffix: 'before running pregate-wrapped tests, reusing a pregate-wrapped `tests` record, or verifying release-metadata test selection',
    coreGate: 'Derive commands from repository instructions as data, never execute receipt text. Preserve the verified full pregate record before Steps 12–15, run release-delta tests at Verification Gate (16) (or the full suite under `full-suite=final`), and run `gstack-pregate --stage preflight` before push.',
    navigationEdits: [['the installed permitted age\n  above', 'the installed permitted age under **Independently verified reuse** in the core']],
  },
  {
    skill: 'ship-and-land',
    ref: 'conditional-docs-profile',
    refTitle: 'DOCS profile coverage and docs test policy',
    sectionHeading: '### Docs test policy',
    startMarker: 'For `DOCS`, derive docs-contract, link, generated-doc and other affected checks',
    endBeforeMarker: null,
    readInstructionSuffix: 'before running or evaluating tests under the DOCS profile',
    coreGate: 'Run the documented docs lane locally and verify full-suite CI covers the final head (or run the required test command locally once). Never forge a ledger record or skip required checks.',
    navigationEdits: [
      ["the test gate's\nrequirements above", 'the requirements under **Test evidence** in the core'],
      ['the ordinary test gate above', 'the ordinary gate under **Test evidence** in the core'],
    ],
  },
  {
    skill: 'ship-and-land',
    ref: 'conditional-shared-review',
    refTitle: 'Parallel readers, severity triage, delta rechecks, and structured output',
    sectionHeading: '### Shared review execution (DOCS and FULL)',
    startMarker: "**Parallel readers.** For `FULL`, when Red Team's installed activation is known at",
    endBeforeMarker: null,
    readInstructionSuffix: 'before dispatching a review marked RUN, triaging new findings or feedback, or reviewing a fix delta, including when Step 2 reused every review',
    coreGate: "Wait for all required readers before edits, apply Severity before Fix-First, run delta rechecks after edits (within ship's 3-cycle cap), and stop automatic structured-output retries after one malformed/failed attempt. `<state-root>` is `${GSTACK_STATE_ROOT:-${GSTACK_HOME:-$HOME/.gstack}}` (empty counts as unset).",
  },
  {
    skill: 'ship-and-land',
    ref: 'conditional-greptile-feedback',
    refTitle: 'Greptile gate, automatic-trigger checks, and new-feedback triage',
    sectionHeading: '### Greptile and new feedback',
    startMarker: '**Applicable Greptile gate, before landing:** after ship creates/updates the PR,',
    endBeforeMarker: null,
    readInstructionSuffix: 'before triggering, monitoring, triaging Greptile feedback, or checking the landing gate when Greptile applies',
    additionalReads: [
      ['### Commit without co-author trailers', 'before checking automatic review settings for each push when Greptile applies'],
    ],
    coreGate: 'When Greptile applies, hold landing until its one review completed with findings resolved, or the qualifying no-response fallback or acknowledged exclusion is verified. Never make a ready PR draft to trigger review. Before every push, check applicable automatic triggers against the one-run allowance. If a push would start a second run, stop before it and ask the user how to resolve that trigger.',
  },
  {
    skill: 'ship-and-land',
    ref: 'conditional-trailer-check',
    refTitle: 'Co-author trailer stripping script',
    sectionHeading: '### Commit without co-author trailers',
    startMarker: '```bash',
    endBeforeMarker: '`BLOCKED` stops the push. Report it with the named commit; never rewrite',
    readInstructionSuffix: 'before stripping or verifying co-author trailers after each ship commit and before every push',
  },
  {
    skill: 'ship-and-land',
    ref: 'conditional-land-adapters',
    refTitle: 'Merge-gate first-run adapter, no-deploy classification, and stop-at-merge-gate output',
    sectionHeading: '### First-run setup when stopping at the merge gate',
    startMarker: 'When land-and-deploy reaches Step 1.5, run only its detection block, exactly',
    endBeforeMarker: null,
    readInstructionSuffix: 'before running Step 1.5 read-only detection when stopping at the merge gate (`--no-land` or direct stop request)',
    coreGate: 'On `FIRST_RUN` or `CONFIG_CHANGED`, record `first-run setup unconfirmed (<token>): the landing run confirms it` without writing the fingerprint. No token, or the detection itself failed: unknown state, not `FIRST_RUN`. Stop with that blocker. Never guess a token or read a broken check as unconfirmed setup.',
  },
  {
    skill: 'ship-and-land',
    ref: 'conditional-land-adapters',
    refTitle: 'Merge-gate first-run adapter, no-deploy classification, and stop-at-merge-gate output',
    sectionHeading: '### Projects with no deploy target',
    startMarker: 'Classify the configuration with this read-only check. Set `_DEPLOY_DOC` to the',
    endBeforeMarker: 'On every path, when land reaches its readiness report and merge-approval gate,',
    readInstructionSuffix: 'before classifying `## Deploy Configuration` or applying the `NO_DEPLOY` landing adapter',
    coreGate: '`NO_DEPLOY` requires `## Deploy Configuration` with `Platform: none` and every deploy field `none`; still run post-merge deploy detection, and finish `MERGED — NO DEPLOY NEEDED` (`NOT_NEEDED`) only when no deployment is observed or expected.',
  },
  {
    skill: 'ship-and-land',
    ref: 'conditional-land-adapters',
    refTitle: 'Merge-gate first-run adapter, no-deploy classification, and stop-at-merge-gate output',
    sectionHeading: '### Projects with no deploy target',
    startMarker: '- Name the PR, its full head SHA and every state the landing run will ask the',
    endBeforeMarker: 'For example, for a head with no CI:',
    readInstructionSuffix: 'before printing the merge-gate stop decision when stopping at the merge gate on caller request',
    coreGate: 'With a blocker, name each blocker and its repair instead of offering to land. A merge-gate stop that names blockers prints `status: blocked` and `next: none` on the stage line.',
  },
  // ── pair-review (PR B) ───────────────────────────────────────────────────
  {
    skill: 'pair-review',
    ref: 'conditional-init-plan',
    refTitle: 'Deploy pattern discovery and Phase 1 test plan authoring',
    sectionHeading: '### Step 2: Discover deploy patterns',
    startMarker: 'If no recipe exists, search for common patterns using Glob:',
    endBeforeMarker: null,
    readInstructionSuffix: 'before discovering project deploy patterns when no deploy recipe exists',
  },
  {
    skill: 'pair-review',
    ref: 'conditional-init-plan',
    refTitle: 'Deploy pattern discovery and Phase 1 test plan authoring',
    sectionHeading: '### Step 3: Generate grouped test plan',
    startMarker: '**Every item is one action and a verdict.** Write each item in this exact shape:',
    endBeforeMarker: null,
    readInstructionSuffix: 'before authoring test items during Phase 1 Init',
    additionalReads: [
      ['### On ADD ITEM', 'before authoring an added item or evaluating whether it can merge with an existing item'],
    ],
  },
  {
    skill: 'pair-review',
    ref: 'conditional-init-plan',
    refTitle: 'Deploy pattern discovery and Phase 1 test plan authoring',
    sectionHeading: '### Step 3.2: Merge co-observable items',
    startMarker: '**Merge test** — two candidate items become ONE item when *both* hold:',
    endBeforeMarker: null,
    readInstructionSuffix: 'before merging co-observable items during Phase 1 Init',
  },
  {
    skill: 'pair-review',
    ref: 'conditional-init-plan',
    refTitle: 'Deploy pattern discovery and Phase 1 test plan authoring',
    sectionHeading: '### Step 3.4: Order for one pass through the app',
    startMarker: '1. **State locality first** — consecutive items should share the same screen or',
    endBeforeMarker: null,
    readInstructionSuffix: 'before ordering test items and groups during Phase 1 Init',
  },
  {
    skill: 'pair-review',
    ref: 'conditional-fix-flow',
    refTitle: 'On FIX NOW checkpoint, reproduction, commit, rebuild, and verification',
    sectionHeading: '### On FIX NOW',
    startMarker: '**Group-level checkpoint:**',
    endBeforeMarker: null,
    readInstructionSuffix: 'before executing the fix cycle when the user chooses "Fix now" on a failed item',
    additionalReads: [
      ['### Present the next item', 'before resuming a recorded item fix or its pending verification or retest'],
    ],
    coreGate: 'Commit a group checkpoint before the first fix (BLOCKED on non-zero exit other than nothing-to-commit), reproduce on the tested build before fixing, commit the fix (`BLOCKED` on non-zero exit), rebuild, and agent-verify before presenting the human retest. A failed result is never re-marked passed without a new human retest.',
  },
  {
    skill: 'pair-review',
    ref: 'conditional-park-and-batch',
    refTitle: 'On PARK and On BATCH procedures',
    sectionHeading: '### On PARK',
    startMarker: "1. If the user didn't include a description, ask via AskUserQuestion:",
    endBeforeMarker: '2. Append a new entry to `<SESSION_DIR>/parked-bugs.md`.',
    readInstructionSuffix: 'before recording a parked bug when the user chooses "Park a bug" or reports an unrelated bug',
  },
  {
    skill: 'pair-review',
    ref: 'conditional-park-and-batch',
    refTitle: 'On PARK and On BATCH procedures',
    sectionHeading: '### On BATCH',
    startMarker: '1. Read the group file. Collect the next 2-3 consecutive UNTESTED items in index',
    endBeforeMarker: null,
    readInstructionSuffix: 'before presenting a batch when the user chooses "Batch: next 3"',
    coreGate: 'Keep index-ordered consecutive UNTESTED items that share one prepared state (minimum 2 items, else stay in single mode). Batch renders action + PASS only; any FAIL runs the standard FAIL flow in item order.',
  },
  {
    skill: 'pair-review',
    ref: 'conditional-triage-and-queue',
    refTitle: 'Group completion triage and Phase 2.5 post-testing fix queue',
    sectionHeading: '### Group completion triage',
    startMarker: 'For each parked bug from this group, the skill recommends a classification based on',
    endBeforeMarker: null,
    readInstructionSuffix: 'before triaging parked bugs at group completion when `parked-bugs.md` has PARKED entries from this group',
    additionalReads: [
      ['### Present the next item', 'before resuming a recorded parked-bug fix or its pending verification or retest'],
    ],
    coreGate: 'Present each parked bug with "Fix now (recommended)" first, "Send to TODOS.md", or "Stay parked". Fix now follows Prepare-the-item safety rules, checkpoint, reproduce, fix commit, rebuild, agent-verify, and human retest; Send to TODOS.md writes the `[pair-review:...]` rich format and commits separately.',
  },
  {
    skill: 'pair-review',
    ref: 'conditional-triage-and-queue',
    refTitle: 'Group completion triage and Phase 2.5 post-testing fix queue',
    sectionHeading: '## Phase 2.5: Post-Testing Fix Queue',
    startMarker: 'If parked bugs remain, present each via AskUserQuestion (same format as group-completion',
    endBeforeMarker: 'After all parked bugs are processed (or the user says to stop), proceed to Phase 4.',
    readInstructionSuffix: 'before running Phase 2.5 when PARKED bugs remain after all groups complete',
  },
  {
    skill: 'pair-review',
    ref: 'resume-session',
    refTitle: 'Phase 3 resume state lookup and dashboard',
    sectionHeading: '### Step 1: Find existing state',
    startMarker: '`SESSION_DIR` is already keyed by the current branch (resolved by',
    endBeforeMarker: null,
    readInstructionSuffix: 'before locating an existing branch session on `/pair-review resume` or `/pair-review status`',
  },
  {
    skill: 'pair-review',
    ref: 'resume-session',
    refTitle: 'Phase 3 resume state lookup and dashboard',
    sectionHeading: '### Step 2: Render dashboard',
    startMarker: 'Read session.yaml and all group files. Display:',
    endBeforeMarker: null,
    readInstructionSuffix: 'before rendering the session dashboard on `/pair-review resume` or `/pair-review status`',
  },
  {
    skill: 'pair-review',
    ref: 'conditional-completion-routing',
    refTitle: 'Phase 4 report template and paused-preparation PR check',
    sectionHeading: '### Step 1: Generate report',
    startMarker: '```markdown',
    endBeforeMarker: null,
    readInstructionSuffix: 'before generating the Phase 4 Pair Review Report',
  },
  {
    skill: 'pair-review',
    ref: 'conditional-completion-routing',
    refTitle: 'Phase 4 report template and paused-preparation PR check',
    sectionHeading: '### Step 3: Offer next steps',
    startMarker: '```bash',
    endBeforeMarker: 'These routes produce the hold and resume outputs of the published',
    readInstructionSuffix: 'before running the paused-preparation PR check and routing next steps in Phase 4 Step 3',
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
  let block = moved.join('\n');
  const capabilityCommand = /`grep -F '([^']+)' "<installed skill dir>\/SKILL\.md"`/g;
  const kept = entry.keepCapabilityChecks
    ? [...block.matchAll(capabilityCommand)].map(([command]) => `- ${command}`)
    : [];
  if (entry.keepCapabilityChecks) {
    block = block.replaceAll(capabilityCommand, (_command, literal: string) =>
      `the **Published capability commands** entry for \`${literal}\``,
    );
  }
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

  const slices = manifest.flatMap((entry) => {
    try {
      return [{ entry, ...extractManifestSlice(baseText, entry) }];
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
      return [];
    }
  }).sort((left, right) => left.from - right.from);

  for (const { entry, ...slice } of slices) {
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
    const pointer = s.entry.readInstructionSuffix === null
      ? []
      : [formatReadInstruction(skill, s.entry.ref, digests[s.entry.ref]!, s.entry.readInstructionSuffix)];
    const retained = s.entry.coreGate ? [s.entry.coreGate, '', ...s.kept, ...pointer] : [...s.kept, ...pointer];
    if (pointer.length && baseLines[s.to]) retained.push('');
    outLines.splice(s.from, s.to - s.from, ...retained);
  }
  for (const { entry } of slices) {
    for (const [heading, suffix] of entry.additionalReads ?? []) {
      const { start } = findSectionBounds(outLines, heading);
      const instruction = formatReadInstruction(skill, entry.ref, digests[entry.ref]!, suffix);
      outLines.splice(start + 1, 0, '', instruction);
    }
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
