/**
 * skill-protocols-full-review.test.ts — drift-locks for skills/full-review.md.
 *
 * Split from tests/skill-protocols.test.ts, which keeps the cross-skill rules.
 * tests/helpers/touchfiles.ts declares every skill file this suite reads, and
 * tests/touchfiles.test.ts checks that declaration against the paths named here.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  agentShells,
  extractFences,
  runShell,
  scopedEnv,
  writeUpdateCheck,
} from './helpers/extend-root.ts';
import { makeBaseTmp } from './helpers/fixture-repo.ts';
import {
  skillSection,
  flatProse,
  type Clause,
  missingClauses,
  stateBashFences,
  guardOrdered,
} from './helpers/skill-protocols.ts';

const ROOT = join(import.meta.dir, '..');

function withoutSection(text: string, section: string): string {
  const at = text.indexOf(section);
  if (at < 0) throw new Error('section text not found');
  return text.slice(0, at) + text.slice(at + section.length);
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function writtenPhases(text: string): string[] {
  const phases: string[] = [];
  const yaml = /^```yaml\n([\s\S]*?)^```/gm;
  let fence: RegExpExecArray | null;
  while ((fence = yaml.exec(text))) {
    for (const line of (fence[1] ?? '').split('\n')) {
      const phase = /^phase:\s*([a-z_]+)\s*$/.exec(line.trim());
      if (phase) phases.push(phase[1]!);
    }
  }
  for (const phase of text.matchAll(/set `phase: ([a-z_]+)`/g)) phases.push(phase[1]!);
  return phases;
}

function resumeRowPhases(section: string): string[] {
  const phases: string[] = [];
  for (const line of section.split('\n')) {
    const row = /^[-*]\s+`([a-z_]+)`/.exec(line);
    if (row) phases.push(row[1]!);
  }
  return phases;
}

function completionSentencePhases(section: string): string[] {
  const list = /session phases \(([^)]*)\)/.exec(section);
  if (!list) return [];
  return [...list[1]!.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]!);
}

// The `- ` rows after `marker`, continuation lines folded in, up to the first blank line.
function bulletRowsAfter(section: string, marker: string): string[] {
  const at = section.indexOf(marker);
  if (at < 0) return [];
  const rows: string[] = [];
  for (const line of section.slice(at + marker.length).split('\n')) {
    if (/^[-*] /.test(line)) rows.push(line);
    else if (rows.length > 0 && line.trim() === '') break;
    else if (rows.length > 0) rows[rows.length - 1] += ` ${line.trim()}`;
  }
  return rows.map(flatProse);
}

function rollupRows(section: string): Array<{ status: string; text: string }> {
  const rows: Array<{ status: string; text: string }> = [];
  for (const row of bulletRowsAfter(section, 'Rollup rule, first match wins:')) {
    const match = /^- ([A-Z_]+) — (.+)$/.exec(row);
    if (match) rows.push({ status: match[1]!, text: match[2]! });
  }
  return rows;
}

const BRANCH_WARNING =
  "If /full-review is still running in that branch's workspace, finish it there first.";

const ARCHIVE_SENTENCE =
  'Earlier runs are kept as `<project dir>/full-review-archived-<UTC timestamp>/`, each with its `report.md`.';

const UNUSABLE_OUTPUT =
  'An output with no `FILE:` line, no `NO_FINDINGS` and nothing extractable counts as `failed`.';

const NEEDS_RECOMMENDATION =
  'Run /full-review and choose Start fresh. The old files move to an archive; nothing is deleted.';

const WRITE_REPORT = 'Write `<SESSION_DIR>/report.md`';

const SET_COMPLETE = 'set `phase: complete`';

const GUARD = '## Active Session Guard';

const STEP3_VALIDATE = '### Step 3: Validate agent outputs';

// Value: protects=Guard: a complete session archives silently, other phases name branch, commit and started,
//   unreadable gets one option;
// fails_when=a clause is reworded to ask on complete, drops a provenance field, or gains a second unreadable option;
// why_new=old checks were bare substrings (phase: complete, branch) that still pass after the behavior is reworded away;
// seam=none
const GUARD_PROMPT_CLAUSES: Clause[] = [
  {
    id: 'guard: complete archives without asking',
    heading: GUARD,
    text: '`phase: complete`: ask nothing. Run the Init state block, which archives the finished session.',
  },
  {
    id: 'guard: other phase names branch, commit and started',
    heading: GUARD,
    text: "ask Resume or Start fresh, naming the session's `branch`, `commit` and `started`.",
  },
  {
    id: 'guard: other-phase question carries all three fields',
    heading: GUARD,
    text: 'You have an existing review session on branch [branch] at commit [commit], started [started].',
  },
  {
    id: 'guard: unreadable asks with one option',
    heading: GUARD,
    text: 'Unreadable (the file exists but cannot be read): ask with one option, naming the `<SESSION_DIR>/session.yaml` path and what could not be read.',
  },
  {
    id: 'guard: unreadable option list has only start fresh',
    heading: GUARD,
    text: 'Options: ["Start a fresh review (archives the old one)"]',
  },
];

// Value: protects=Guard stops the run on a non-zero or ERROR: Init block and reports the archived path from ARCHIVED=;
// fails_when=the stop-and-relay sentence or the archive-receipt rule is deleted or softened;
// why_new=executed Init cases test the block output, nothing asserted the guard prose that acts on that output;
// seam=none
const GUARD_STOP_CLAUSES: Clause[] = [
  {
    id: 'guard: Init failure stops the run',
    heading: GUARD,
    text: 'On any non-zero exit or `ERROR:` line from the Init state block, stop and relay the output. Never write session state over an unarchived session.',
  },
  {
    id: 'guard: ARCHIVED= receipt rule',
    heading: GUARD,
    text: 'Whenever the block prints `ARCHIVED=<path>`, print "Archived the previous review to <path>." and name that path in the next question\'s action receipt.',
  },
];

// Value: protects=Phase 1 failure ladder: 2 failed agents offer partial, retry or stop, 3 offer retry or stop,
//   retries cap at 3, Stop records BLOCKED;
// fails_when=an option is dropped or swapped between prompts, the cap of 3 changes, or Stop stops recording BLOCKED;
// why_new=only a bare Stop (records a BLOCKED run) substring was checked, which survives rewriting either prompt;
// seam=none
const AGENT_FAILURE_CLAUSES: Clause[] = [
  {
    id: 'phase 1: two failed agents prompt',
    heading: STEP3_VALIDATE,
    text: '2 agents failed or timed out: present via AskUserQuestion. Options: "Proceed with partial results", "Retry the failed agents", "Stop (records a BLOCKED run)".',
  },
  {
    id: 'phase 1: three failed agents prompt',
    heading: STEP3_VALIDATE,
    text: 'All 3 failed: present via AskUserQuestion. Options: "Retry the failed agents", "Stop (records a BLOCKED run)". Tell the user: "Run /full-review again; the stopped session is archived automatically. If it fails again, the agent errors above are the cause."',
  },
  {
    id: 'phase 1: retry cap of 3 then automatic BLOCKED',
    heading: STEP3_VALIDATE,
    text: 'Retries are counted per run. One retry re-dispatches every failed agent. After 3 retries, remove the Retry option. If all three agents still fail, the run stops as BLOCKED without another question.',
  },
  {
    id: 'phase 1: Stop records BLOCKED and goes to Phase 6',
    heading: STEP3_VALIDATE,
    text: "On Stop, or on that automatic stop after 3 retries: tell the user what failed, run Step 4 with each agent's status and the real `findings_total`, add the line `status: BLOCKED` to `session.yaml`, then go to Phase 6.",
  },
];

// Value: protects=Zero clusters (Phase 2) and no approved cluster (Phase 4, Phase 5 entry) route straight to Phase 6;
// fails_when=a routing sentence is removed or retargeted to another phase;
// why_new=old check was a bare no clusters substring with no routing target, Phase 4 and Phase 5 entry were unlocked;
// seam=none
const PHASE6_ROUTING_CLAUSES: Clause[] = [
  {
    id: 'phase 2: no clusters skips Phases 3-5 to Phase 6',
    heading: '### Step 4: Handle empty results',
    text: 'When clustering produced no clusters (every completed agent returned `NO_FINDINGS`, every finding was `edge-case` and dropped, or a mix), skip Phases 3-5 and go to Phase 6.',
  },
  {
    id: 'phase 4: no approved cluster goes to Phase 6',
    heading: '### Triage completion',
    text: 'If no cluster is approved, go to Phase 6.',
  },
  {
    id: 'phase 5 entry: no approved cluster goes to Phase 6',
    heading: '## Phase 5: Persist to TODOS.md',
    text: 'If no cluster is approved, go to Phase 6.',
    lead: true,
  },
];

// Value: protects=Resumed runs skip entries whose Found in and theme match (legacy Context theme extracted),
//   other commit failures are DONE_WITH_CONCERNS;
// fails_when=a dedupe, legacy-theme or commit-failure sentence is deleted or inverted;
// why_new=no test names these rules, losing them duplicates TODOS entries or hides a failed commit;
// seam=none
const TODOS_CLAUSES: Clause[] = [
  {
    id: 'phase 5: skip entries matching Found in and theme',
    heading: '### Step 3: Write approved findings',
    text: 'Skip any entry whose `**Found in:**` value and cluster theme (in `**Context:**`) both match an entry already under `## Unprocessed`.',
  },
  {
    id: 'phase 5: legacy Context theme is extracted from the quotes',
    heading: '### Step 3: Write approved findings',
    text: 'For an existing entry, use the entire `**Context:**` value as the theme in the current format; for the legacy `From /full-review cluster "<theme>" on branch <branch> (<date>).` format, extract the quoted cluster theme.',
  },
  {
    id: 'phase 5: dedupe compares against clusters.md values',
    heading: '### Step 3: Write approved findings',
    text: 'Compare that theme and `**Found in:**` against the verbatim values in `clusters.md`, so a resumed run, including one an older version interrupted, matches even when it words the title differently.',
  },
  {
    id: 'phase 5: nothing to commit continues',
    heading: '### Step 4: Commit',
    text: "If the commit fails because there's nothing to commit, that's fine — continue.",
  },
  {
    id: 'phase 5: any other commit failure is DONE_WITH_CONCERNS with recovery',
    heading: '### Step 4: Commit',
    text: 'Any other failure makes the run DONE_WITH_CONCERNS. Phase 6 Step 2 gives the exact recovery: `git -C <repo root> add <path>` and `git -C <repo root> commit -m "<message>" -- <path>`.',
  },
];

// Value: protects=Phase 6 handoff: stopped-versus-complete header, Status and Report lines, BLOCKED rerun text,
//   commit-failure recovery commands;
// fails_when=the header rule, the Status/Report lines, the BLOCKED text or the recovery commands are deleted or reworded;
// why_new=old check was a bare Status: substring that survives rewriting the header rule and the BLOCKED handoff;
// seam=none
const HANDOFF_CLAUSES: Clause[] = [
  {
    id: 'phase 6: header is stopped for BLOCKED and complete otherwise',
    heading: '### Step 2: Handoff',
    text: 'The header is "**Full review stopped.**" when the status is BLOCKED, and "**Full review complete.**" otherwise. Name the failed agents for BLOCKED and DONE_WITH_CONCERNS.',
  },
  {
    id: 'phase 6: handoff status and report lines',
    heading: '### Step 2: Handoff',
    text: '**Full review complete.**\\n- Status: <STATUS>\\n- Report: <SESSION_DIR>/report.md',
  },
  {
    id: 'phase 6: BLOCKED handoff header and rerun text',
    heading: '### Step 2: Handoff',
    text: "[If BLOCKED, header is '**Full review stopped.**' instead, name the failed agents, and show: 'Run /full-review again; the stopped session is archived automatically. If it fails again, the agent errors above are the cause.']",
  },
  {
    id: 'phase 6: commit failure recovery commands',
    heading: '### Step 2: Handoff',
    text: '[If the TODOS.md commit failed: `git -C <repo root> add <path>` and `git -C <repo root> commit -m "<message>" -- <path>`.]',
  },
];

// Rollup definitions, scoped to the rollup rows (the SHARED enum block repeats the status words).
const ROLLUP_DEFINITIONS: Array<[string, string]> = [
  [
    'NEEDS_CONTEXT',
    'on resume, `session.yaml` exists but is malformed (including a session at `clusters_complete` or later, not BLOCKED, with no `clusters_total`), or a phase is about to run without its input (`raw-findings.md` for Phase 2, `clusters.md` for Phases 3-5, and `clusters.md` for Phase 6 when `clusters_total` is above 0 and the status is not BLOCKED). Phase 6 does not run and nothing is marked complete.',
  ],
  [
    'BLOCKED',
    'the run stopped before synthesis (Stop at an agent-failure prompt, or all three agents still failed after 3 retries).',
  ],
  [
    'DONE_WITH_CONCERNS',
    'the run finished with one or two failed agents (named), a deferred cluster, `(unstructured)` output, or a TODOS commit failure other than nothing to commit.',
  ],
  [
    'DONE',
    'all three agents completed with structured output and the run finished with approved findings written, zero clusters, or every cluster rejected.',
  ],
];

describe('Track 22D full-review sections and run state', () => {
  const skill = readFileSync(join(ROOT, 'skills', 'full-review.md'), 'utf8');

  test('GSTACK section extends past the heading inside its template fence', () => {
    const section = skillSection(skill, '## GSTACK REVIEW REPORT');
    const first = section.indexOf('## GSTACK REVIEW REPORT');
    const second = section.indexOf('## GSTACK REVIEW REPORT', first + 1);
    expect(second).toBeGreaterThan(first);
    expect(section.slice(second)).toContain('| Review | Trigger | Why | Runs | Status | Findings |');
  });

  test('written phases equal resume rows and the completion sentence', () => {
    const written = sortedUnique(writtenPhases(skill));
    const resume = sortedUnique(resumeRowPhases(skillSection(skill, '## Resume Flow')));
    const completion = sortedUnique(
      completionSentencePhases(skillSection(skill, '## Completion Status Protocol')),
    );
    expect(resume).toEqual(written);
    expect(completion).toEqual(written);
    expect(written).toEqual([
      'clusters_complete',
      'complete',
      'dedup_complete',
      'dispatch_complete',
      'triage_complete',
    ]);

    // Value: protects=Resume phase rows match first-wins: complete first, BLOCKED second, clusters_complete routes on clusters_total;
    // fails_when=rows are reordered (BLOCKED below a phase row) or the clusters_total 0 routing is changed;
    // why_new=the phase-set equality above sorts the rows, so any order passes;
    // seam=none
    const ordered = bulletRowsAfter(
      skillSection(skill, '## Resume Flow'),
      'Then match the `phase` field, first match wins:',
    );
    expect(ordered[0]).toMatch(/^- `complete` → finished\. /);
    expect(ordered[1]).toBe('- Any other phase with `status: BLOCKED` → Phase 6.');
    expect(ordered).toContain(
      '- `clusters_complete` → Phase 6 when `clusters_total` is 0, else Phase 3 onwards.',
    );
  });

  test('report write and phase complete live only under Phase 6', () => {
    const phase6 = skillSection(skill, '## Phase 6: Report and Handoff');
    expect(phase6).toContain(WRITE_REPORT);
    expect(phase6).toContain(SET_COMPLETE);
    const outside = withoutSection(skill, phase6);
    expect(outside).not.toContain(WRITE_REPORT);
    expect(outside).not.toContain(SET_COMPLETE);
  });

  test('scoped run-state sentences', () => {
    const guard = skillSection(skill, '## Active Session Guard');
    expect(guard).toContain('phase: complete');
    expect(guard).toContain('branch');
    expect(guard).toContain(BRANCH_WARNING);
    const resume = skillSection(skill, '## Resume Flow');
    expect(resume).toContain(BRANCH_WARNING);
    expect(resume).toContain(ARCHIVE_SENTENCE);
    const step3 = skillSection(skill, '### Step 3: Validate agent outputs');
    expect(step3).toContain(UNUSABLE_OUTPUT);
    expect(step3).toContain('Stop (records a BLOCKED run)');
    expect(skill).not.toContain('Try scoping to a specific directory');
    expect(skill).not.toContain('Clean codebase');
    expect(skillSection(skill, '### Step 3: Write state checkpoint')).toContain('edge_case_dropped');
    const empty = skillSection(skill, '### Step 4: Handle empty results');
    expect(empty).toContain('no clusters');
    expect(empty).not.toContain('If all agents returned');
    const report = skillSection(skill, '### Step 1: Write report');
    expect(report).toContain('not recorded');
    expect(report).toContain('Already in TODOS.md (skipped)');
    expect(skillSection(skill, '### Step 2: Handoff')).toContain('Status:');
    expect(skillSection(skill, '### Step 4: Commit')).toContain('-- <path');
    const rollup = skillSection(skill, '## Completion Status Protocol');
    expect(rollup).toContain('DONE');
    expect(rollup).toContain('DONE_WITH_CONCERNS');
    expect(rollup).toContain('BLOCKED');
    expect(rollup).toContain('NEEDS_CONTEXT');
    expect(rollup).toContain(NEEDS_RECOMMENDATION);
    expect(skillSection(skill, '## GSTACK REVIEW REPORT')).not.toContain(
      'Verdict-to-status mapping (same as',
    );

    // Exact-clause tables: each id that is missing names the clause that was reworded or removed.
    expect(missingClauses(skill, GUARD_PROMPT_CLAUSES)).toEqual([]);
    expect(missingClauses(skill, GUARD_STOP_CLAUSES)).toEqual([]);
    expect(missingClauses(skill, AGENT_FAILURE_CLAUSES)).toEqual([]);
    expect(missingClauses(skill, PHASE6_ROUTING_CLAUSES)).toEqual([]);
    expect(missingClauses(skill, TODOS_CLAUSES)).toEqual([]);
    expect(missingClauses(skill, HANDOFF_CLAUSES)).toEqual([]);

    // Value: protects=Phase 5 commits only the TODOS.md path via a git commit pathspec, after a git add of that path;
    // fails_when=-- <path> is dropped from the real commit command, which would sweep other staged work into the commit;
    // why_new=old -- <path substring was also satisfied by the recovery sentence in the same section;
    // seam=none
    const commitFences = extractFences(skillSection(skill, '### Step 4: Commit')).map((fence) => fence.body);
    expect(commitFences.some((body) => /^git add <path>$/m.test(body))).toBe(true);
    expect(commitFences.some((body) => /^_OUT=\$\(git commit -m "[^"]+" -- <path> 2>&1\)$/m.test(body))).toBe(true);

    // Value: protects=Completion rollup rows define NEEDS_CONTEXT, BLOCKED, DONE_WITH_CONCERNS and DONE in first-match order;
    // fails_when=a row definition is reworded away or the rows are reordered;
    // why_new=old enum-word checks were satisfied by the SHARED enum block in the same section, so they asserted nothing;
    // seam=none
    const rows = rollupRows(rollup);
    expect(rows.map((row) => row.status)).toEqual(ROLLUP_DEFINITIONS.map(([status]) => status));
    const reworded = ROLLUP_DEFINITIONS.filter(
      ([status, text]) => !rows.find((row) => row.status === status)?.text.includes(flatProse(text)),
    ).map(([status]) => status);
    expect(reworded).toEqual([]);
  });

  test('every SESSION_DIR bash fence carries the guard, in order', () => {
    const fences = stateBashFences(skill);
    expect(fences.length).toBeGreaterThan(0);
    expect(fences.every((fence) => guardOrdered(fence.body))).toBe(true);
    const mutated = `${skill}\n\`\`\`bash\nmv "$SESSION_DIR" "$ARCHIVE_DIR"\n\`\`\`\n`;
    expect(stateBashFences(mutated).every((fence) => guardOrdered(fence.body))).toBe(false);
  });
});

const initStateTmp = makeBaseTmp('skill-protocols-22d-init-');

const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;

afterAll(() => {
  try {
    rmSync(initStateTmp, { recursive: true, force: true });
  } catch {
    /* a mode-0555 fixture is restored in the test */
  }
});

function initStateBlock(skill: string): string {
  const hits = extractFences(skill).filter(
    (fence) => fence.body.includes('session_dir full-review') && fence.body.includes('session_archive_dir'),
  );
  if (hits.length !== 1) throw new Error(`expected 1 init state fence, found ${hits.length}`);
  return hits[0]!.body.replace(/\n$/, '');
}

function initFixture(name: string) {
  const base = join(initStateTmp, name);
  rmSync(base, { recursive: true, force: true });
  const home = join(base, 'home');
  const state = join(base, 'state');
  const cwd = join(base, 'fr22d');
  const checkout = join(base, 'checkout');
  writeUpdateCheck(checkout);
  mkdirSync(join(checkout, 'bin', 'lib'), { recursive: true });
  copyFileSync(join(ROOT, 'bin', 'lib', 'session-paths.sh'), join(checkout, 'bin', 'lib', 'session-paths.sh'));
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  const slugDir = join(state, 'projects', 'fr22d');
  const session = join(slugDir, 'full-review');
  return { home, state, cwd, checkout, slugDir, session };
}

function archivedNames(slugDir: string): string[] {
  if (!existsSync(slugDir)) return [];
  return readdirSync(slugDir).filter((name) => name.startsWith('full-review-archived-'));
}

function runInitBlock(
  fx: ReturnType<typeof initFixture>,
  block: string,
  shell: { shell: 'bash' | 'zsh'; args: string[] },
  opts: { root?: boolean; pathPrefix?: string } = {},
) {
  const prefix = opts.root === false ? '' : `_EXTEND_ROOT=${JSON.stringify(fx.checkout)}\n`;
  const path = opts.pathPrefix
    ? `${opts.pathPrefix}:${process.env.PATH ?? '/usr/bin:/bin'}`
    : (process.env.PATH ?? '/usr/bin:/bin');
  return runShell(
    shell.shell,
    shell.args,
    `${prefix}${block}\n`,
    scopedEnv(fx.home, { GSTACK_STATE_ROOT: fx.state, PATH: path }),
    fx.cwd,
  );
}

describe('Track 22D init state block', () => {
  const block = initStateBlock(readFileSync(join(ROOT, 'skills', 'full-review.md'), 'utf8'));

  test('a: a non-empty session moves to the archive and an empty slot remains', () => {
    for (const shell of agentShells()) {
      const fx = initFixture(`a-${shell.shell}`);
      mkdirSync(fx.session, { recursive: true });
      writeFileSync(join(fx.session, 'session.yaml'), 'phase: complete\n');
      writeFileSync(join(fx.session, 'clusters.md'), '# clusters\n');
      const result = runInitBlock(fx, block, shell);
      expect(result.status).toBe(0);
      expect(result.stderr ?? '').not.toContain('ERROR:');
      const archived = /^ARCHIVED=(.+)$/m.exec(result.stdout ?? '')?.[1];
      expect(archived?.startsWith(join(fx.state, 'projects', 'fr22d', 'full-review-archived-'))).toBe(true);
      expect(existsSync(join(archived!, 'session.yaml'))).toBe(true);
      expect(existsSync(join(archived!, 'clusters.md'))).toBe(true);
      expect(readdirSync(fx.session)).toEqual([]);
    }
  });

  test('b: a missing directory is created and nothing is archived; one that cannot be created exits 1', () => {
    for (const shell of agentShells()) {
      const fx = initFixture(`b-${shell.shell}`);
      const result = runInitBlock(fx, block, shell);
      expect(result.status).toBe(0);
      expect(result.stdout ?? '').not.toContain('ARCHIVED=');
      expect(readdirSync(fx.session)).toEqual([]);
      expect(archivedNames(fx.slugDir)).toEqual([]);
    }

    // Value: protects=Init exits 1 with an ERROR and leaves no session state when the session slot cannot be created;
    // fails_when=the mkdir -p failure guard is removed or no longer exits non-zero;
    // why_new=cases d-f cover the archive-collision, mv and ls failures, the mkdir -p failure in the missing-directory path was unexercised;
    // seam=none
    if (!runningAsRoot) {
      for (const shell of agentShells()) {
        const fx = initFixture(`b-readonly-${shell.shell}`);
        mkdirSync(fx.slugDir, { recursive: true });
        chmodSync(fx.slugDir, 0o555);
        try {
          const result = runInitBlock(fx, block, shell);
          expect(result.status).toBe(1);
          expect(result.stderr ?? '').toContain('ERROR: could not create');
          expect(result.stdout ?? '').not.toContain('SESSION_DIR=');
          expect(result.stdout ?? '').not.toContain('ARCHIVED=');
        } finally {
          chmodSync(fx.slugDir, 0o755);
        }
        expect(existsSync(fx.session)).toBe(false);
        expect(readdirSync(fx.slugDir)).toEqual([]);
      }
    }
  });

  test('c: an empty directory is kept and nothing is archived', () => {
    for (const shell of agentShells()) {
      const fx = initFixture(`c-${shell.shell}`);
      mkdirSync(fx.session, { recursive: true });
      const before = statSync(fx.session).ino;
      const result = runInitBlock(fx, block, shell);
      expect(result.status).toBe(0);
      expect(result.stdout ?? '').not.toContain('ARCHIVED=');
      expect(statSync(fx.session).ino).toBe(before);
      expect(readdirSync(fx.session)).toEqual([]);
      expect(archivedNames(fx.slugDir)).toEqual([]);
    }
  });

  test('d: a pre-created archive path exits 1 and leaves the session', () => {
    for (const shell of agentShells()) {
      const fx = initFixture(`d-${shell.shell}`);
      const stamp = '20261001-120000';
      const stub = join(fx.home, 'date-bin');
      mkdirSync(stub, { recursive: true });
      writeFileSync(join(stub, 'date'), `#!/bin/sh\nprintf '%s\\n' '${stamp}'\n`);
      chmodSync(join(stub, 'date'), 0o755);
      mkdirSync(fx.session, { recursive: true });
      writeFileSync(join(fx.session, 'session.yaml'), 'phase: triage_complete\n');
      const archive = join(fx.slugDir, `full-review-archived-${stamp}`);
      mkdirSync(archive, { recursive: true });
      writeFileSync(join(archive, 'preexisting'), 'keep\n');
      const result = runInitBlock(fx, block, shell, { pathPrefix: stub });
      expect(result.status).toBe(1);
      expect(result.stderr ?? '').toContain('ERROR:');
      expect(result.stdout ?? '').not.toContain('ARCHIVED=');
      expect(readFileSync(join(fx.session, 'session.yaml'), 'utf8')).toContain('triage_complete');
      expect(readFileSync(join(archive, 'preexisting'), 'utf8')).toBe('keep\n');
    }
  });

  test.skipIf(runningAsRoot)('e: a read-only slug directory fails mv and leaves the session', () => {
    for (const shell of agentShells()) {
      const fx = initFixture(`e-${shell.shell}`);
      mkdirSync(fx.session, { recursive: true });
      writeFileSync(join(fx.session, 'session.yaml'), 'phase: clusters_complete\n');
      chmodSync(fx.slugDir, 0o555);
      try {
        const result = runInitBlock(fx, block, shell);
        expect(result.status).toBe(1);
        expect(result.stderr ?? '').toContain('ERROR:');
        expect(result.stdout ?? '').not.toContain('ARCHIVED=');
      } finally {
        chmodSync(fx.slugDir, 0o755);
      }
      expect(readFileSync(join(fx.session, 'session.yaml'), 'utf8')).toContain('clusters_complete');
      expect(archivedNames(fx.slugDir)).toEqual([]);
    }
  });

  test.skipIf(runningAsRoot)('f: an unreadable session directory exits 1 and moves nothing', () => {
    for (const shell of agentShells()) {
      const fx = initFixture(`f-${shell.shell}`);
      mkdirSync(fx.session, { recursive: true });
      writeFileSync(join(fx.session, 'session.yaml'), 'phase: complete\n');
      chmodSync(fx.session, 0o300);
      try {
        const result = runInitBlock(fx, block, shell);
        expect(result.status).toBe(1);
        expect(result.stderr ?? '').toContain('ERROR:');
        expect(result.stdout ?? '').not.toContain('ARCHIVED=');
      } finally {
        chmodSync(fx.session, 0o755);
      }
      expect(existsSync(join(fx.session, 'session.yaml'))).toBe(true);
      expect(archivedNames(fx.slugDir)).toEqual([]);
    }
  });

  test('g: no _EXTEND_ROOT line exits 1 and moves nothing', () => {
    for (const shell of agentShells()) {
      const fx = initFixture(`g-${shell.shell}`);
      mkdirSync(fx.session, { recursive: true });
      writeFileSync(join(fx.session, 'kept'), 'yes\n');
      const result = runInitBlock(fx, block, shell, { root: false });
      expect(result.status).toBe(1);
      expect(readFileSync(join(fx.session, 'kept'), 'utf8')).toBe('yes\n');
      expect(archivedNames(fx.slugDir)).toEqual([]);
    }
  });
});
