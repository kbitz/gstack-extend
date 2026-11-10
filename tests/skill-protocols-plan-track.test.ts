/**
 * skill-protocols-plan-track.test.ts — drift-locks for skills/plan-track.md.
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
import { extractCanonicalSpan, HANDOFF_PARAGRAPH } from './helpers/extend-root.ts';
import { parseSetupSkills } from './helpers/parse-setup-skills.ts';

const ROOT = join(import.meta.dir, '..');

// Literal paths keep each file this suite reads visible to test selection.
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const norm = (text: string) => text.replace(/\s+/g, ' ');

const skill = read('skills/plan-track.md');
const skillN = norm(skill);
const readme = read('README.md');
const claude = read('CLAUDE.md');
const installation = read('docs/installation.md');
const handoffs = read('docs/workflow-handoffs.md');
const design = read('docs/designs/workflow-efficiency-program.md');
const setup = read('setup');

const frontmatter = (text: string) => /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
const fences = (text: string) => [...text.matchAll(/^```(\w*)\n([\s\S]*?)\n```$/gm)].map(m => ({ lang: m[1]!, body: m[2]!, start: m.index!, end: m.index! + m[0].length }));

const STAGE_LINE = 'Stage handoff: stage-handoff/v1; stage: plan; next: <implement|none>; status: <done|done-with-concerns|blocked|needs-context>; head: <full HEAD SHA|none>; plan-sha256: <SHA-256|none>';

describe('plan-track works alone and hands off to /implement', () => {
  // Value: protects=the skill cannot spawn helpers, call another model or ask a question; fails_when=a tool beyond the five is granted or the working-alone rule is edited out; why_new=no other suite reads this skill; seam=none; no_claim=what an installed agent does
  test('allows exactly Bash, Read, Write, Glob and Grep and states the working-alone rule', () => {
    const tools = [...frontmatter(skill).matchAll(/^  - (\S+)$/gm)].map(m => m[1]);
    expect(tools).toEqual(['Bash', 'Read', 'Write', 'Glob', 'Grep']);
    expect(frontmatter(skill)).toMatch(/^name: plan-track$/m);
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

describe('plan-track sits beside upstream /autoplan after /autoplan-lean retirement', () => {
  // Value: protects=criteria 2 and 3, no live skill, doc or setup list names /autoplan-lean; fails_when=autoplan-lean returns to plan-track, README, CLAUDE.md, installation, workflow-handoffs or setup SKILLS; why_new=replaces the pre-retirement coexistence lock; seam=none; no_claim=routing in a live host
  test('plan-track, entry docs, handoff contract and setup SKILLS exclude autoplan-lean', () => {
    for (const [label, text] of [
      ['skills/plan-track.md', skill],
      ['README.md', readme],
      ['CLAUDE.md', claude],
      ['docs/installation.md', installation],
      ['docs/workflow-handoffs.md', handoffs],
    ] as const) {
      expect(text, label).not.toContain('autoplan-lean');
    }
    expect(parseSetupSkills(setup)).not.toContain('autoplan-lean');
  });

  // Value: protects=neither skill claims to replace the other; fails_when=the words replace, supersede or deprecate enter the skill; why_new=no other suite reads this skill; seam=none; no_claim=none
  test('the skill never says it replaces, supersedes or deprecates anything', () => {
    expect(skill).not.toMatch(/replac|supersed|deprecat/i);
  });

  // Value: protects=the recorded comparison figures and the 2026-11-07 retirement record; fails_when=the skill or the design doc drops the two blind comparisons, the risk-handling figures, upstream /autoplan or the 2026-11-07 retirement; why_new=locks the retirement decision alongside the preserved comparison data; seam=none; no_claim=the figures are measured here
  test('the skill and the design doc record the two blind comparisons, upstream /autoplan and the 2026-11-07 retirement', () => {
    expect(skillN).toContain('upstream `/autoplan`');
    expect(skillN).toContain('two blind comparisons');
    expect(skillN).toContain('risk handling lower');
    expect(skillN).toContain('workflow-efficiency-program.md');
    const section = design.slice(design.indexOf('## A planning skill that works alone'), design.indexOf('## Deferred experiments'));
    expect(section.length).toBeGreaterThan(0);
    const sectionN = norm(section);
    for (const phrase of ['30 vs 31 and 31 vs 32 of 50 overall', 'risk handling scored 5 vs 6 and 5 vs 7', '2026-11-07', 'source observations']) {
      expect(sectionN, phrase).toContain(phrase);
    }
  });
});

describe('plan-track inputs are documented fields and its text is generic', () => {
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
    const withoutResolver = skill.replace(extractCanonicalSpan(skill), '').replace(HANDOFF_PARAGRAPH, '');
    expect(withoutResolver).not.toMatch(/paseo|conductor|claude|codex|cursor|opencode|antigravity/i);
  });

  // Value: protects=plan-track never asks an upgrade question or runs setup in any session kind; fails_when=the local spawned-branch directive is removed or moved after the shared upgrade flow; why_new=the shared block includes interactive branches that plan-track's tool and install rules forbid; seam=none; no_claim=an installed agent obeys the directive
  test('directs the skill to follow the spawned upgrade branch before SHARED:upgrade-flow', () => {
    const localLine =
      'This skill asks no questions and installs nothing, so in the flow below it always follows the `UPGRADE_SESSION=spawned` branch, whatever the session kind.';
    const localAt = skill.indexOf(localLine);
    const sharedAt = skill.indexOf('<!-- SHARED:upgrade-flow -->');
    expect(localAt).toBeGreaterThan(-1);
    expect(sharedAt).toBeGreaterThan(localAt);
    // An unmanaged host (docs/installation.md "Hosts setup does not manage") prints no root line;
    // plan-track needs none, so it must not report a missing install there.
    const quietLine =
      "It runs none of the flow's commands. When the preamble prints neither an `EXTEND_ROOT:` nor an `EXTEND_ROOT_UNVERIFIED:` line, it says nothing about the install and continues, because it needs no root.";
    const quietAt = skill.indexOf(quietLine);
    expect(quietAt).toBeGreaterThan(localAt);
    expect(sharedAt).toBeGreaterThan(quietAt);
  });

  // Value: protects=the default plan path follows the one state-root rule; fails_when=the skill hardcodes the root or drops the collision stop; why_new=the state-root suite checks the expression, not the collision rule; seam=none; no_claim=none
  test('writes its plan under the state root and stops on a collision instead of overwriting', () => {
    expect(skillN).toContain('${GSTACK_STATE_ROOT:-${GSTACK_HOME:-$HOME/.gstack}}');
    expect(skillN).toContain('<state-root>/projects/<slug>/plans/<card-stem>.md');
    expect(skillN).toContain('~/scratch/gstack-plan-track/<slug>-<card-stem>.md');
    expect(skillN).toContain('A default target that already exists with different bytes is not overwritten: write no plan and stop with `needs-context`.');
  });
});

describe('plan-track ends with the stage line', () => {
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

describe('plan-track uses one verify-command label', () => {
  // Value: protects=criterion 5, one verify-command label that /implement reads as intent; fails_when=the template or the docs use a bare Verify: label or drop the intent rule; why_new=the label differs in the private source and must stay settled; seam=none; no_claim=a caller gate reads the label
  test('the plan carries Verify command: and the skill and the contract state that /implement reads it as intent', () => {
    const template = fences(skill).find(f => f.lang === 'markdown')!;
    expect(template.body.split('\n')).toContain('Verify command: <command, or none — how the plan is verified>');
    expect(skill).not.toMatch(/^Verify:/m);
    expect(template.body).not.toMatch(/^Verify:/m);
    expect(skillN).toContain('`/implement` reads it as intent and never runs it.');
    expect(norm(handoffs)).toContain('`/implement` reads its plan\'s `Verify command:` line as intent and never runs it');
  });

  // Value: protects=the exact _release: header line, its single-occurrence rule, and the Post-merge row syntax; fails_when=the template drops _release:, allows duplicate _release: lines or prose on _release:, or drops the - <ID>: <text> rule; why_new=Track 73B locks the release-level line and Post-merge row shape in plan-track; seam=none; no_claim=a live planner writes a valid plan
  test('the plan template carries the single _release: line after Verify command: and states the Post-merge - <ID>: <text> row rule', () => {
    const template = fences(skill).find(f => f.lang === 'markdown')!;
    const lines = template.body.split('\n');
    const verifyIdx = lines.indexOf('Verify command: <command, or none — how the plan is verified>');
    expect(verifyIdx).toBeGreaterThan(-1);
    expect(lines[verifyIdx + 1]).toBe('_release: <patch|minor|major|1.0.0> (<SPEC mapping>)_');
    expect(template.body.match(/^_release:/gm)).toHaveLength(1);
    expect(skillN).toContain('write it once in the entire plan file: never repeat `_release:` in `## Acceptance criteria`, `## Tasks`, `## Risks` or `## Review record`, and never append user-facing disclosure prose to it.');
    expect(skillN).toContain('Put user-facing changes and upgrade notes on the separate `Release note:` and `Upgrade risk:` lines instead.');
    expect(skillN).toContain('A `## Post-merge` row is written `- <ID>: <text>`, with a colon right after its ID and none inside it; with no such check the section is the single line `none`.');
  });

  // Value: protects=optional Release note: and Upgrade risk: disclosures stay separate from ## Risks; fails_when=the template drops either label, allows none/n/a placeholders or permits reusing ## Risks bullets; why_new=Track 73B separates user-facing disclosures from implementation risks; seam=none; no_claim=a consumer parses the disclosures here (covered in handoff-contract.test.ts)
  test('the plan template carries Release note: and Upgrade risk: lines and forbids reusing ## Risks bullets', () => {
    const template = fences(skill).find(f => f.lang === 'markdown')!;
    const lines = template.body.split('\n');
    const releaseIdx = lines.indexOf('_release: <patch|minor|major|1.0.0> (<SPEC mapping>)_');
    expect(lines[releaseIdx + 1]).toBe('Release note: <what a user of the project sees or does differently>');
    expect(lines[releaseIdx + 2]).toBe('Upgrade risk: <what an upgrading user must do or watch for>');
    expect(skillN).toContain('`Release note:` and `Upgrade risk:` are optional header lines');
    expect(skillN).toContain('Omit either label, or both, when nothing applies; never write `none` or `n/a`.');
    expect(skillN).toContain('never copies, re-labels or summarizes `## Risks` bullets');
    expect(skill).toContain('https://github.com/kbitz/gstack-extend/blob/main/docs/workflow-handoffs.md#release-disclosures');
  });
});

describe('plan-track is registered everywhere a skill is', () => {
  // Value: protects=criteria 6 and 7, the skill is installed, covered by the telemetry cohort and documented; fails_when=it leaves setup, the expected list, the README or the routing; why_new=the cross-skill suites check lists, not that this skill is named in the docs; seam=none; no_claim=an install on a real host
  test('setup, the expected list, the README and the CLAUDE.md routing all name it', () => {
    expect(EXPECTED_SETUP_SKILLS).toContain('plan-track');
    expect(parseSetupSkills(setup)).toContain('plan-track');
    expect(readme).toContain('| [`/plan-track`](skills/plan-track.md) |');
    expect(claude).toContain('→ invoke plan-track');
  });

  // Value: protects=criterion 6, the telemetry cohort covers the skill with one start and one finish call; fails_when=a call is duplicated or names another skill; why_new=the cohort suites iterate the list, so this pins the skill's own name; seam=none; no_claim=a row is recorded
  test('carries exactly one telemetry start and one finish call under its own name', () => {
    for (const kind of ['start', 'finish']) {
      expect(skill.split(`"$_GE_CALL" ${kind} --skill "extend:plan-track"`)).toHaveLength(2);
    }
  });
});

describe('plan-track documents the manual link', () => {
  // Value: protects=criterion 8, a host that setup does not manage can link the skill; fails_when=the section or either link form is dropped; why_new=update.test.ts locks only the rollback steps in this file; seam=none; no_claim=a link works on a real host
  test('docs/installation.md holds the unmanaged-host section with both link forms', () => {
    expect(installation).toContain('### Hosts setup does not manage');
    expect(norm(installation)).toContain('With a managed Claude install');
    expect(installation).toContain('mkdir -p <host-skills-dir>');
    expect(installation).toContain('ln -s ~/.claude/skills/plan-track <host-skills-dir>/plan-track');
    expect(installation).toContain('ln -s <checkout>/skills/plan-track.md <host-skills-dir>/plan-track/SKILL.md');
    expect(norm(installation)).toContain('`setup` and its uninstall never see these links, so remove them by hand');
  });
});

// Value: protects=requested-only release metadata; fails_when=plans infer release levels or accept free prose; why_new=review found scope drift; seam=none; no_claim=live planner output
describe('plan-track requested release level', () => {
  test('requires an explicit request and a valid single-line form', () => {
    expect(skillN).toContain('only when the card, `NOTES` or the project\'s instructions ask the plan to name a release level');
    expect(skillN).toContain('at the start of a line and outside any code fence');
    const template = fences(skill).find(f => f.lang === 'markdown')!.body;
    const placeholder = template.split('\n').find(l => l.startsWith('_release:'))!;
    const pattern = new RegExp('^' + placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('<patch\\|minor\\|major\\|1\\.0\\.0>', '(?:patch|minor|major|1\\.0\\.0)').replace('<SPEC mapping>', '[^\\n]+') + '$');
    expect('_release: minor (SPEC release policy: compatible additions use MINOR)_').toMatch(pattern);
    expect('_release: minor — a paragraph').not.toMatch(pattern);
  });
});
