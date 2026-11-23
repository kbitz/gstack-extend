#!/usr/bin/env bun
/**
 * skill-references.ts — move manifest, conservation check, apply mode, and
 * content-digest updater for gstack-extend skill reference files (Track 94I).
 *
 * Commands:
 *   bun scripts/skill-references.ts check [--base <ref>]
 *   bun scripts/skill-references.ts apply [--base <ref>]
 *   bun scripts/skill-references.ts digests [--write]
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
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

- **Always fetch on step entry.** Run the \`--ref\` command each time its step is entered; nothing already in context, including a \`REFERENCE_READ\` reply or a compaction summary, counts as having the text. Verify that the numbered lines printed run contiguously from \`1\` to the \`REFERENCE_END\` trailer's \`lines=<N>\`; if any lines were truncated, fetch the missing range with \`--lines <a>-<b>\`.
- **Stop on reference failure.** On any non-zero exit from \`preamble ... --ref\`, relay its \`SKILL_REFERENCE_*\` line verbatim (never include local absolute paths in PR bodies or receipts — record only the cause and the repository-relative path \`skills/references/<skill>/<file>.md\`), emit this skill's existing blocked stage line where it has one, run Telemetry finish with \`--outcome error\` naming the failed step, and stop. Work completed before the step stands; rerunning the skill re-binds to the existing PR or uses the skill's resume form. Never continue a moved step from memory.
- **Host subagents.** A host subagent that needs a reference runs the same \`--ref\` command itself and starts its reply with \`REFERENCE_READ <skill>/<file> lines=<N> digest=<digest>\`; a reply without that header or with a different digest is recorded under the skill's existing incomplete-reviewer or missing-coverage rule, never as a clean pass. (If the host denies a headless subagent the start command, the primary fetches the reference and passes its text inline on that host only.) Helper-run delegates keep their code-built prompts.
- **Mid-run upgrade.** If the inline upgrade flow above printed \`UPGRADE_OK\` in this run, tell the user the upgrade finished and to rerun this skill so the loaded instructions match the updated checkout, then stop before Step 1.`;

export interface MoveEntry {
  skill: string;
  ref: string;
  refTitle: string;
  sectionHeading: string;
  startMarker: string;
  endBeforeMarker: string | null;
  /** Text appended after the backticked preamble command in the read instruction. */
  readInstructionSuffix: string;
}

export const MOVE_MANIFEST: readonly MoveEntry[] = [
  {
    skill: 'review-and-prep',
    ref: 'conditional-workflow-metrics',
    refTitle: 'Workflow metrics capture and span wrappers',
    sectionHeading: '### Workflow metrics (optional, local)',
    startMarker: 'Resolve `gstack-extend-telemetry` exactly as the telemetry blocks do. Each',
    endBeforeMarker: 'Own the interval between implementation and `/ship-and-land`:',
    readInstructionSuffix: 'before recording workflow metrics when `GX_CAPTURE=1` or resolving `gstack-extend-telemetry`',
  },
  {
    skill: 'review-and-prep',
    ref: 'conditional-greptile-recovery',
    refTitle: 'Greptile second-run detection, user-decision exits, and configuration repair',
    sectionHeading: '### Detect whether marking ready would start a second run',
    startMarker: 'The ready transition starts an automatic run unless the effective trigger list',
    endBeforeMarker: null,
    readInstructionSuffix: 'before evaluating trigger settings when Greptile applies or a recorded request/run has consumed the allowance',
  },
  {
    skill: 'review-and-prep',
    ref: 'delegate-specialist-parts',
    refTitle: 'Claude Code outside-call adapter and delegated specialist parts',
    sectionHeading: '### Bound Claude Code outside calls',
    startMarker: 'Read [the adapter contract](https://github.com/kbitz/gstack-extend/blob/main/docs/outside-review.md)',
    endBeforeMarker: null,
    readInstructionSuffix: 'before running bounded outside calls when `/review` selects outside passes on Claude Code',
  },
  {
    skill: 'review-and-prep',
    ref: 'delegate-specialist-parts',
    refTitle: 'Claude Code outside-call adapter and delegated specialist parts',
    sectionHeading: '### Delegate named specialist parts',
    startMarker: 'Read [the delegate contract](https://github.com/kbitz/gstack-extend/blob/main/docs/delegated-review.md)',
    endBeforeMarker: null,
    readInstructionSuffix: 'before running delegated specialist parts when the review policy carries `delegate=<part>` and a `Review delegates:` line is present',
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
  },
  {
    skill: 'review-and-prep',
    ref: 'delegate-red-team-and-fold',
    refTitle: 'Red-team pass, folded specialist checklists, and overlapped cycle-1 reviewers',
    sectionHeading: '### Overlap independent first-cycle reviewers',
    startMarker: 'This is a **wrapper override**, not an upstream fork: it changes when parts',
    endBeforeMarker: null,
    readInstructionSuffix: 'before overlapping cycle-1 reviewers when the review policy carries `first-cycle=overlap` and the activation anchors match',
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
  },
  {
    skill: 'review-and-prep',
    ref: 'conditional-cycle-baseline',
    refTitle: "Cycle 1 full-review baseline and fix-review records",
    sectionHeading: "### Record cycle 1's full-review baseline",
    startMarker: "- **B.** B is the HEAD that cycle 1 reviews: capture it at cycle 1's /review's Step 3,",
    endBeforeMarker: null,
    readInstructionSuffix: "before recording or checking cycle 1's full-review baseline when a full-scope cycle 1 runs",
  },
  {
    skill: 'review-and-prep',
    ref: 'conditional-cycle-cap',
    refTitle: 'Three-cycle cap stop procedure and continuation envelope',
    sectionHeading: '### When /review stops at its cycle cap',
    startMarker: "1. Commit the reviewed work and the cycle's fixes, run the targeted checks the",
    endBeforeMarker: null,
    readInstructionSuffix: 'before handling a cycle-cap stop when `/review` stops at a verified three-cycle cap',
  },
  {
    skill: 'review-and-prep',
    ref: 'conditional-post-audit-classification',
    refTitle: 'Post-audit diff classification and doc-audit-gap decision table',
    sectionHeading: "### Classify changes after the documentation audit's last attempt",
    startMarker: "**The delta.** Compute the delta from the last accepted audit's post-child",
    endBeforeMarker: '1. **`undocumented-internal` class (`owner=not-needed`).** When an existing',
    readInstructionSuffix: 'before classifying post-audit changes when the review policy carries `post-audit=classify`',
  },
  {
    skill: 'review-and-prep',
    ref: 'conditional-post-audit-reaudit',
    refTitle: 'Post-audit undocumented-internal class, targeted re-audit, and receipt lines',
    sectionHeading: "### Classify changes after the documentation audit's last attempt",
    startMarker: '1. **`undocumented-internal` class (`owner=not-needed`).** When an existing',
    endBeforeMarker: null,
    readInstructionSuffix: 'before applying the `undocumented-internal` class or post-audit receipt rules when the review policy carries `post-audit=classify` and `doc-audit-gap=auto`',
  },
  {
    skill: 'review-and-prep',
    ref: 'conditional-doc-audit-and-gates',
    refTitle: 'Contract-scoped documentation audit and external full-suite gate pause/resume',
    sectionHeading: '### Bound the documentation audit',
    startMarker: '   Changelogs, roadmaps, backlogs and archived or superseded plans record',
    endBeforeMarker: null,
    readInstructionSuffix: 'before running the bounded documentation audit when the review policy carries `documentation-scope=contracts`',
  },
  {
    skill: 'review-and-prep',
    ref: 'conditional-doc-audit-and-gates',
    refTitle: 'Contract-scoped documentation audit and external full-suite gate pause/resume',
    sectionHeading: '### Pause for an external full-suite gate',
    startMarker: '**Freeze.** Commit the intended work and inspect the committed diff, including',
    endBeforeMarker: null,
    readInstructionSuffix: 'before pausing or resuming an external full-suite gate when the review policy carries `full-suite=external`',
  },
  {
    skill: 'review-and-prep',
    ref: 'conditional-pregate-and-final-repair',
    refTitle: 'Narrowed pregate coverage rules and test-only final-gate repair loop',
    sectionHeading: '### Narrow the pregate after an accepted pass',
    startMarker: '**Coverage.** Decide in this order. The first miss records `pregate-narrowing:',
    endBeforeMarker: null,
    readInstructionSuffix: 'before narrowing the pregate when `full-suite=external` has an accepted pass and the activation anchors match',
  },
  {
    skill: 'review-and-prep',
    ref: 'conditional-pregate-and-final-repair',
    refTitle: 'Narrowed pregate coverage rules and test-only final-gate repair loop',
    sectionHeading: '### Repair a test-only final-gate failure',
    startMarker: '**Classification.** Read the classification contract from',
    endBeforeMarker: null,
    readInstructionSuffix: 'before repairing a test-only final-gate failure when the review policy carries `final-gate-repair=tests-docs`',
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
export function extractManifestSlice(baseText: string, entry: MoveEntry): { from: number; to: number; block: string } {
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
  return { from, to: trimmedTo, block: lines.slice(from, trimmedTo).join('\n') };
}

export interface ConservationResult {
  ok: boolean;
  errors: string[];
  movedBlocks: number;
  droppedLines: string[];
}

/**
 * Conservation check: verify every manifest entry from `baseText` appears as one
 * contiguous verbatim block in its target reference file in source order, and
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
        errors.push(`missing or modified verbatim block in skills/references/${skill}/${entry.ref}.md for ${entry.sectionHeading}`);
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
  }));

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
        parts.push(`## From ${b.heading.replace(/^###\s+/, '')}`, '');
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
  const sortedDesc = [...slices].sort((a, b) => b.from - a.from);
  const outLines = [...baseLines];
  for (const s of sortedDesc) {
    const instr = formatReadInstruction(skill, s.entry.ref, digests[s.entry.ref]!, s.entry.readInstructionSuffix);
    outLines.splice(s.from, s.to - s.from, instr);
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
  const r = spawnSync('git', ['-C', repoRoot, 'show', `${ref}:${relPath}`], {
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

function runCli(argv: string[]): number {
  const cmd = argv[0];
  let baseRef = 'HEAD';
  let writeMode = false;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--base' && argv[i + 1]) {
      baseRef = argv[++i]!;
    } else if (argv[i] === '--write') {
      writeMode = true;
    } else {
      console.error(`Unknown argument: ${argv[i]}`);
      return 2;
    }
  }

  const skills = [...new Set(MOVE_MANIFEST.map((m) => m.skill))];

  if (cmd === 'apply') {
    for (const skill of skills) {
      const baseText = readGitFile(baseRef, `skills/${skill}.md`);
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
      const baseText = readGitFile(baseRef, `skills/${skill}.md`);
      const coreText = readFileSync(join(REPO_ROOT, 'skills', `${skill}.md`), 'utf8');
      const refs = listRefFilesOnDisk(skill);
      const res = checkConservation(skill, baseText, coreText, refs);
      console.log(
        `CONSERVATION ${skill}: ok=${res.ok} blocks=${res.movedBlocks} dropped=${res.droppedLines.length} base=${Buffer.byteLength(baseText, 'utf8')}B core=${Buffer.byteLength(coreText, 'utf8')}B`,
      );
      if (!res.ok) {
        failed = true;
        for (const e of res.errors) console.error(`  ERROR: ${e}`);
        for (const d of res.droppedLines.slice(0, 20)) console.error(`  DROPPED: ${d}`);
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
          coreText = coreText.replace(instr.line, replacement);
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

  console.error('Usage: bun scripts/skill-references.ts <apply|check|digests> [--base <ref>] [--write]');
  return 2;
}

if (import.meta.main) {
  process.exit(runCli(process.argv.slice(2)));
}
