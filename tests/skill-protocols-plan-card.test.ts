/**
 * skill-protocols-plan-card.test.ts — drift-locks for skills/plan-card.md.
 *
 * Split from tests/skill-protocols.test.ts, which keeps the cross-skill rules.
 * tests/helpers/touchfiles.ts declares every file this suite reads, and
 * tests/touchfiles.test.ts checks that declaration against the skill paths named here.
 * These are static text locks: they do not show that an installed agent produces a usable plan.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXPECTED_SETUP_SKILLS } from './helpers/expected-setup-skills.ts';
import { parseSetupSkills } from './helpers/parse-setup-skills.ts';

const ROOT = join(import.meta.dir, '..');

// Literal paths keep each file this suite reads visible to test selection.
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const norm = (text: string) => text.replace(/\s+/g, ' ');

const skill = read('skills/plan-card.md');
const skillN = norm(skill);
const lean = read('skills/autoplan-lean.md');
const readme = read('README.md');
const claude = read('CLAUDE.md');
const installation = read('docs/installation.md');
const handoffs = read('docs/workflow-handoffs.md');
const design = read('docs/designs/workflow-efficiency-program.md');
const setup = read('setup');

const frontmatter = (text: string) => /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
const fences = (text: string) => [...text.matchAll(/^```(\w*)\n([\s\S]*?)\n```$/gm)].map(m => ({ lang: m[1]!, body: m[2]!, start: m.index!, end: m.index! + m[0].length }));

const STAGE_LINE = 'Stage handoff: stage-handoff/v1; stage: plan; next: <implement|none>; status: <done|done-with-concerns|blocked|needs-context>; head: <full HEAD SHA|none>; plan-sha256: <SHA-256|none>';

// Copied from the skill as it stood when this Track shipped; a change to /autoplan-lean's description or routing fails here.
const LEAN_DESCRIPTION = `description: |
  Run upstream /autoplan's review pipeline (CEO, design, DX and eng phases
  with both review voices and auto-decisions) from the installed phase skills,
  keeping the plan small, and finish with a copyable /implement prompt for a
  fresh session. The plan holds criteria, Tier, the verify command, accepted
  settlements, one task list and the GSTACK REVIEW REPORT, within a budget set
  by the card's size. The full review record goes to a hashed sidecar file.
  Reviewers get only their phase's criteria and the plan, a phase's two voices
  run at the same time, and their prompt sizes are recorded. Use when asked to
  "autoplan lean", "run autoplan with a small plan", or when a caller launches
  /autoplan-lean by name.
allowed-tools:`;
const LEAN_ROUTE = "- Autoplan with a small plan, autoplan lean → invoke autoplan-lean (upstream /autoplan's review; review record in a sidecar, then a fresh-session implement handoff)";
const LEAN_README_ROW = "| [`/autoplan-lean`](skills/autoplan-lean.md) | Runs upstream `/autoplan`'s full review from the installed phase skills, keeps the plan within a size budget set by its card using a hashed review-record sidecar and bounded reviewer prompts, and finishes with a copyable `/implement` handoff. | New |";

describe('plan-card works alone and hands off to /implement', () => {
  // Value: protects=the skill cannot spawn helpers, call another model or ask a question; fails_when=a tool beyond the five is granted or the working-alone rule is edited out; why_new=no other suite reads this skill; seam=none; no_claim=what an installed agent does
  test('allows exactly Bash, Read, Write, Glob and Grep and states the working-alone rule', () => {
    const tools = [...frontmatter(skill).matchAll(/^  - (\S+)$/gm)].map(m => m[1]);
    expect(tools).toEqual(['Bash', 'Read', 'Write', 'Glob', 'Grep']);
    expect(frontmatter(skill)).toMatch(/^name: plan-card$/m);
    expect(skillN).toContain('Work alone: no subagents, outside voices or other model or agent CLI.');
    expect(skillN).toContain('Ask no questions.');
    expect(skillN).toContain('Write only `PLAN_FILE`');
    expect(skillN).toContain('Record the initial work-tree status and existing changed-file content');
    expect(skillN).toContain('identical status text alone does not prove unchanged content');
    expect(skillN).toContain('An unexpected change stops with `blocked` and no implementation prompt');
  });

  // Value: protects=the next stage receives a prompt it can parse; fails_when=the prompt fence stops starting with the run line or loses its closing list; why_new=no other suite reads this skill; seam=none; no_claim=a transport accepts the prompt
  test('ends with one fenced prompt that starts Run /implement <PLAN_FILE> and finishes with the auto-decisions list', () => {
    const prompts = fences(skill).filter(f => f.body.startsWith('Run /implement <PLAN_FILE>'));
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.lang).toBe('text');
    for (const label of ['Workspace:', 'Branch:', 'Work state:', 'Plan:', 'Approved scope:', 'Spec:', 'Verify command:', 'Preserve:']) {
      expect(prompts[0]!.body, label).toContain(`\n${label} `);
    }
    expect(prompts[0]!.body.trimEnd().split('\n').slice(-3)[0]).toBe('Auto-decisions:');
    expect(prompts[0]!.body).not.toContain('Review record:');
    expect(prompts[0]!.body).not.toContain('Test plan:');
    expect(skillN).toContain('On successful completion (`DONE` or `DONE_WITH_CONCERNS`), finish with one fenced `text` prompt');
    expect(skillN).toContain('Stops take precedence over both success statuses');
    expect(skillN).toContain('filesystem or permission failures stop with `blocked`');
  });
});

describe('plan-card sits beside /autoplan-lean and changes nothing about it', () => {
  // Value: protects=criterion 2, the two planners stay separate and the default does not move; fails_when=/autoplan-lean names this skill, or its description, routing line or README row changes; why_new=the lean suites do not lock its description or routing; seam=none; no_claim=routing in a live host
  test('/autoplan-lean never names /plan-card and keeps its description, routing line and README row', () => {
    expect(lean).not.toContain('plan-card');
    expect(lean).toContain(LEAN_DESCRIPTION);
    expect(claude).toContain(`${LEAN_ROUTE}\n`);
    expect(readme).toContain(LEAN_README_ROW);
  });

  // Value: protects=neither skill claims to replace the other; fails_when=the words replace, supersede or deprecate enter the skill; why_new=no other suite reads this skill; seam=none; no_claim=none
  test('the skill never says it replaces, supersedes or deprecates anything', () => {
    expect(skill).not.toMatch(/replac|supersed|deprecat/i);
  });

  // Value: protects=the recorded reason for keeping the default; fails_when=the skill or the design doc drops the two blind comparisons or the risk-handling figures; why_new=the card is the only other record and moves to shipped; seam=none; no_claim=the figures are measured here
  test('the skill and the design doc record the two blind comparisons and why /autoplan-lean stays the default', () => {
    expect(skillN).toContain('`/autoplan-lean` stays the default planner');
    expect(skillN).toContain('two blind comparisons');
    expect(skillN).toContain('risk handling lower');
    expect(skillN).toContain('workflow-efficiency-program.md');
    const section = design.slice(design.indexOf('## A planning skill that works alone'), design.indexOf('## Deferred experiments'));
    expect(section.length).toBeGreaterThan(0);
    const sectionN = norm(section);
    for (const phrase of ['30 vs 31 and 31 vs 32 of 50 overall', 'risk handling scored 5 vs 6 and 5 vs 7', '`/autoplan-lean` stays the default', 'source observations']) {
      expect(sectionN, phrase).toContain(phrase);
    }
  });
});

describe('plan-card inputs are documented fields and its text is generic', () => {
  const inputs = (() => {
    const from = skill.indexOf('## Inputs');
    const to = skill.indexOf('\n## ', from + 1);
    return skill.slice(from, to);
  })();

  // Value: protects=criterion 3, a caller can fill the inputs from documentation alone; fails_when=a field is added, renamed or dropped without this lock changing; why_new=required inputs are stable surfaces; seam=none; no_claim=a caller fills them
  test('the Inputs table names exactly the five fields, and nothing is host-filled', () => {
    const names = [...inputs.matchAll(/^\| `([A-Z_]+)` \|/gm)].map(m => m[1]);
    expect(names).toEqual(['CARD_FILE', 'PLAN_FILE', 'VERIFY_COMMAND', 'FORK_LIST', 'NOTES']);
    expect(norm(inputs)).toContain('Nothing fills them in.');
    expect(skill).not.toContain('{{');
    expect(frontmatter(skill)).not.toContain('argument-hint');
    expect(skill.split('\n').filter(line => /^[A-Z]{2,}-[A-Z]+:/.test(line))).toEqual([]);
  });

  // Value: protects=the shipped text names no host or product; fails_when=a public host name enters the skill; why_new=the consumer-independence rule has no test for this skill; seam=none; no_claim=consumer names are absent (checked outside the committed tests)
  test('names no workspace host or agent product', () => {
    expect(skill).not.toMatch(/paseo|conductor|claude|codex|cursor|opencode|antigravity/i);
  });

  // Value: protects=the default plan path follows the one state-root rule; fails_when=the skill hardcodes the root or drops the collision stop; why_new=the state-root suite checks the expression, not the collision rule; seam=none; no_claim=none
  test('writes its plan under the state root and stops on a collision instead of overwriting', () => {
    expect(skillN).toContain('${GSTACK_STATE_ROOT:-${GSTACK_HOME:-$HOME/.gstack}}');
    expect(skillN).toContain('<state-root>/projects/<slug>/plans/<card-stem>.md');
    expect(skillN).toContain('~/scratch/gstack-plan-card/<slug>-<card-stem>.md');
    expect(skillN).toContain('A default target that already exists with different bytes is not overwritten: write no plan and stop with `needs-context`.');
  });
});

describe('plan-card ends with the stage line', () => {
  // Value: protects=criterion 4, the line is printed once, outside the fence, after the prompt; fails_when=the line moves into a fence, repeats or loses its generic tokens; why_new=the contract suite checks the line, not its place in this skill; seam=none; no_claim=a consumer reads the line
  test('the stage line follows the prompt fence and only the exit paragraph and completion precede the telemetry finish', () => {
    const prompt = fences(skill).find(f => f.body.startsWith('Run /implement <PLAN_FILE>'))!;
    expect(skill.split(`\n${STAGE_LINE}\n`)).toHaveLength(2);
    const at = skill.indexOf(`\n${STAGE_LINE}\n`);
    expect(at).toBeGreaterThan(prompt.end);
    expect(fences(skill).filter(f => f.start > prompt.end && f.start < at)).toEqual([]);
    const finish = skill.indexOf('<!-- SHARED:telemetry-finish -->');
    const between = skill.slice(at + STAGE_LINE.length + 2, finish);
    expect(between).not.toContain('```');
    expect(between).not.toContain('Stage handoff:');
    for (const fence of fences(skill)) expect(fence.body, 'no fence carries the stage line').not.toContain('Stage handoff:');
    expect(skillN).toContain('A prompt goes with `next: implement` and `done`, or `done-with-concerns`');
    expect(skillN).toContain('print `next: none` with `needs-context`');
    expect(skillN).toContain('a card without acceptance criteria, an invalid `PLAN_FILE` and a path collision write no plan');
  });
});

describe('plan-card uses one verify-command label', () => {
  // Value: protects=criterion 5, one label across both planners; fails_when=the template or the docs use a bare Verify: label or drop the stated relation; why_new=the label differs in the private source and must stay settled; seam=none; no_claim=a caller gate reads the label
  test('the plan carries Verify command: and the skill and the contract state its relation to /autoplan-lean', () => {
    const template = fences(skill).find(f => f.lang === 'markdown')!;
    expect(template.body.split('\n')).toContain('Verify command: <command, or none — how the plan is verified>');
    expect(skill).not.toMatch(/^Verify:/m);
    expect(template.body).not.toMatch(/^Verify:/m);
    expect(skillN).toContain('`Verify command:` has the same label and meaning as the `Verify command:` line in a `/autoplan-lean` plan.');
    expect(skillN).toContain('`/implement` reads it as intent and never runs it.');
    expect(norm(handoffs)).toContain('Its plan\'s `Verify command:` line has the same label and meaning as `/autoplan-lean`\'s');
  });
});

describe('plan-card is registered everywhere a skill is', () => {
  // Value: protects=criteria 6 and 7, the skill is installed, covered by the telemetry cohort and documented; fails_when=it leaves setup, the expected list, the README or the routing; why_new=the cross-skill suites check lists, not that this skill is named in the docs; seam=none; no_claim=an install on a real host
  test('setup, the expected list, the README and the CLAUDE.md routing all name it', () => {
    expect(EXPECTED_SETUP_SKILLS).toContain('plan-card');
    expect(parseSetupSkills(setup)).toContain('plan-card');
    expect(readme).toContain('| [`/plan-card`](skills/plan-card.md) |');
    expect(claude).toContain('→ invoke plan-card');
  });

  // Value: protects=criterion 6, the telemetry cohort covers the skill with one start and one finish call; fails_when=a call is duplicated or names another skill; why_new=the cohort suites iterate the list, so this pins the skill's own name; seam=none; no_claim=a row is recorded
  test('carries exactly one telemetry start and one finish call under its own name', () => {
    for (const kind of ['start', 'finish']) {
      expect(skill.split(`"$_GE_CALL" ${kind} --skill "extend:plan-card"`)).toHaveLength(2);
    }
  });
});

describe('plan-card documents the manual link', () => {
  // Value: protects=criterion 8, a host that setup does not manage can link the skill; fails_when=the section or either link form is dropped; why_new=update.test.ts locks only the rollback steps in this file; seam=none; no_claim=a link works on a real host
  test('docs/installation.md holds the unmanaged-host section with both link forms', () => {
    expect(installation).toContain('### Hosts setup does not manage');
    expect(norm(installation)).toContain('With a managed Claude install');
    expect(installation).toContain('mkdir -p <host-skills-dir>');
    expect(installation).toContain('ln -s ~/.claude/skills/plan-card <host-skills-dir>/plan-card');
    expect(installation).toContain('ln -s <checkout>/skills/plan-card.md <host-skills-dir>/plan-card/SKILL.md');
    expect(norm(installation)).toContain('`setup` and its uninstall never see these links, so remove them by hand');
  });
});
