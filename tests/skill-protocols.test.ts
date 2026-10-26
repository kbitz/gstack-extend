/**
 * skill-protocols.test.ts — the cross-skill protocol rules: what every skill,
 * or a named cohort of skills, must carry, and the canonical blocks one skill
 * holds for the others (telemetry start/finish from full-review, the upgrade
 * flow and extend-root resolver from gstack-extend-upgrade).
 *
 * Each skill's own drift-locks live in tests/skill-protocols-<skill>.test.ts,
 * so a change to one skill file selects that skill's suite and this one.
 * tests/helpers/touchfiles.ts declares the skill files each suite reads.
 *
 * Migrated from scripts/test-skill-protocols.sh (deleted in Track 3A).
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
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  AUTOPLAN_LEAN_TAIL,
  DOCS_SHIP_TAIL,
  CANONICAL_SPAN,
  CMD_BIN_RE,
  FOR_POINTER_LINE,
  FOR_SKILL_LINE,
  GUARD_COMMENT,
  GUARD_LINE,
  HANDOFF_PARAGRAPH,
  INIT_ERROR_STOP,
  INIT_TAIL,
  MARKER_LINE,
  NO_INSTALL_MESSAGE,
  RENAMES_ER_LINE,
  ROOT_RESOLVER_SKILLS,
  SKILL_PATH_PREFIXES,
  SKILL_PATH_RE,
  UPGRADE_NO_ROOT,
  UPGRADE_TAIL,
  WORKFLOW_SKILLS,
  WORKFLOW_TAIL,
  agentShells,
  extractCanonicalSpan,
  extractFences,
  extractPreambleFence,
  hostDir,
  runShell,
  scopedEnv,
  skillPreamble,
  strictShells,
  writePointer,
  writeUpdateCheck,
} from './helpers/extend-root.ts';
import { makeBaseTmp } from './helpers/fixture-repo.ts';
import { parseSetupSkills } from './helpers/parse-setup-skills.ts';
import { EXPECTED_SETUP_SKILLS } from './helpers/expected-setup-skills.ts';
import { resolverSkillText } from './helpers/skill-protocols.ts';

const ROOT = join(import.meta.dir, '..');

// Orthogonal memberships: SHARED protocol, upgrade preamble, and telemetry.
// Do not derive protocol membership from setup's
// install list — project-spec, init, review-and-prep, implement, and ship-and-land are utility/workflow skills
// without the legacy SHARED protocol / upgrade preamble / Conductor blocks.
// 16A–D: do not touch <!-- SHARED:… --> blocks. Item 2/3 of the Conductor
// rule stay per-skill. Keep "Action receipt format".
// 17A: SHARED:conductor-visibility-head is a Conductor host workaround,
// not tmpl-universal — do not inherit it blindly.
const PROTOCOL_SKILLS = [
  'pair-review',
  'roadmap',
  'full-review',
] as const;

const PREAMBLE_SKILLS = [...PROTOCOL_SKILLS, 'gstack-extend-upgrade'] as const;

const NON_PREAMBLE_SETUP_SKILLS = [
  'project-spec',
  'gstack-extend-init',
  'review-and-prep',
  'implement',
  'ship-and-land',
  'autoplan-lean',
  'docs-ship',
] as const;

const CONDUCTOR_SKILLS = [
  'pair-review',
  'full-review',
] as const;

const TELEMETRY_SKILLS = [...EXPECTED_SETUP_SKILLS];

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

// ─── Track 13A: telemetry-start + telemetry-finish blocks ──────────
//
// All installed extend skills carry two bash blocks each (start + finish) that
// emit telemetry to ~/.gstack/analytics/skill-usage.jsonl with --source
// gstack-extend marking. Only the quoted `--skill "extend:<name>"` argument differs
// per skill; everything else is byte-identical across the cohort.
//
// Rather than redefining the canonical text in TypeScript (escaping bash
// `${...}` interpolations and `\n` printf sequences is fragile), we extract
// each block from skills/full-review.md as the canonical source, then
// template the skill name to match the file under test. Mirrors the
// Track 10A SHARED:upgrade-flow extraction pattern below.
const TELEMETRY_PREAMBLE_RE = /<!-- SHARED:telemetry-start -->[\s\S]*?<!-- \/SHARED:telemetry-start -->/;

const TELEMETRY_EPILOGUE_RE = /<!-- SHARED:telemetry-finish -->[\s\S]*?<!-- \/SHARED:telemetry-finish -->/;

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

describe('argument-safe executable skill text', () => {
  test('two-word host rendering leaves every bash block unchanged', () => {
    // Model positional replacement only: missing indices stay untouched.
    const args = ['example', 'plan'];
    const render = (text: string) => text.replace(/\$([0-9]+)/g, (token, index) => args[Number(index)] ?? token);
    expect(render('length($0); print $1; print $2')).toBe('length(example); print plan; print $2');
    for (const file of readdirSync(join(ROOT, 'skills')).filter(file => file.endsWith('.md'))) {
      for (const fence of extractFences(readFileSync(join(ROOT, 'skills', file), 'utf8'))) {
        if (fence.lang === 'bash') expect(render(fence.body)).toBe(fence.body);
      }
    }
  });

  for (const awk of ['/usr/bin/awk', 'gawk']) {
    const available = spawnSync(awk, ['BEGIN {exit 0}'], { encoding: 'utf8' });
    test.skipIf((available.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT')(`${awk}: expression field syntax preserves reads and record assignment`, () => {
      expect(available.status).toBe(0);
      const result = spawnSync(awk, ['{ print $(0); print $(1); print $(2); $(0) = "replacement record"; print $(0); print $(2) }'], {
        input: 'version level timestamp\n', encoding: 'utf8',
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toBe('version level timestamp\nversion\nlevel\nreplacement record\nrecord\n');
    });
  }
});

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
  test('upgrade activation precedes its actual upgrade work', () => {
    const content = readFileSync(join(ROOT, 'skills/gstack-extend-upgrade.md'), 'utf8');
    expect(content.indexOf('<!-- SHARED:telemetry-start -->')).toBeLessThan(content.indexOf('bin/update-check'));
  });
  test('telemetry covers exactly the installed cohort', () => {
    expect([...TELEMETRY_SKILLS].sort()).toEqual(parseSetupSkills(readFileSync(join(ROOT, 'setup'), 'utf8')).sort());
  });
  test('canonical preamble block extracted from skills/full-review.md', () => {
    expect(CANONICAL_TELEMETRY_PREAMBLE).not.toBe('');
    expect(CANONICAL_TELEMETRY_PREAMBLE).toContain('<!-- SHARED:telemetry-start -->');
    expect(CANONICAL_TELEMETRY_PREAMBLE).toContain('--skill "extend:full-review"');
    expect(CANONICAL_TELEMETRY_PREAMBLE).toContain('"$_GE_BIN" start --skill');
    expect(CANONICAL_TELEMETRY_PREAMBLE).toContain('.extend-root');
  });
  test('canonical epilogue block extracted from skills/full-review.md', () => {
    expect(CANONICAL_TELEMETRY_EPILOGUE).not.toBe('');
    expect(CANONICAL_TELEMETRY_EPILOGUE).toContain('<!-- SHARED:telemetry-finish -->');
    expect(CANONICAL_TELEMETRY_EPILOGUE).toContain('--skill "extend:full-review"');
    expect(CANONICAL_TELEMETRY_EPILOGUE).toContain('bin/gstack-extend-telemetry');
    expect(CANONICAL_TELEMETRY_EPILOGUE).toContain('"$_GE_BIN" finish --skill');
  });
  // Drift locks use content.includes(), which cannot see a duplicated block, a finish that precedes
  // its start, or a skill whose frontmatter forbids the Bash tool the blocks need. Duplicated starts
  // would emit an unpaired activation per invocation; a missing Bash grant silently disables telemetry.
  test('every skill has exactly one start before exactly one finish, allows Bash, and docs/telemetry.md copies the canonical blocks', () => {
    const problems: string[] = [];
    for (const skill of TELEMETRY_SKILLS) {
      const content = readFileSync(join(ROOT, 'skills', `${skill}.md`), 'utf8');
      const count = (needle: string) => content.split(needle).length - 1;
      for (const kind of ['start', 'finish']) {
        if (count(`<!-- SHARED:telemetry-${kind} -->`) !== 1) problems.push(`${skill}: expected exactly one opening telemetry-${kind} marker`);
        if (count(`<!-- /SHARED:telemetry-${kind} -->`) !== 1) problems.push(`${skill}: expected exactly one closing telemetry-${kind} marker`);
        if (count(`"$_GE_BIN" ${kind} --skill "extend:${skill}"`) !== 1) problems.push(`${skill}: expected exactly one ${kind} invocation`);
      }
      if (content.indexOf('<!-- SHARED:telemetry-start -->') > content.indexOf('<!-- SHARED:telemetry-finish -->')) {
        problems.push(`${skill}: finish block precedes start block`);
      }
      const frontmatter = /^---\n([\s\S]*?)\n---/.exec(content)?.[1] ?? '';
      if (!/^\s+- Bash\s*$/m.test(frontmatter)) problems.push(`${skill}: allowed-tools must include Bash`);
    }
    const docs = readFileSync(join(ROOT, 'docs', 'telemetry.md'), 'utf8');
    if (TELEMETRY_PREAMBLE_RE.exec(docs)?.[0] !== CANONICAL_TELEMETRY_PREAMBLE) problems.push('docs/telemetry.md start block differs from the canonical block');
    if (TELEMETRY_EPILOGUE_RE.exec(docs)?.[0] !== CANONICAL_TELEMETRY_EPILOGUE) problems.push('docs/telemetry.md finish block differs from the canonical block');
    expect(problems).toEqual([]);
  });

  for (const skill of TELEMETRY_SKILLS) {
    const file = join(ROOT, 'skills', `${skill}.md`);
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    test(`${skill} embeds the canonical telemetry-start block (skill name: extend:${skill})`, () => {
      const expected = telemetryPreambleFor(skill);
      if (!content.includes(expected)) {
        throw new Error(
          `${skill} drift in SHARED:telemetry-start — propagate canonical text from skills/full-review.md`,
        );
      }
    });
    test(`${skill} embeds the canonical telemetry-finish block (skill name: extend:${skill})`, () => {
      const expected = telemetryEpilogueFor(skill);
      if (!content.includes(expected)) {
        throw new Error(
          `${skill} drift in SHARED:telemetry-finish — propagate canonical text from skills/full-review.md`,
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
  // Value: protects=Not now preserves same-version snooze progression, resets new versions and caps the saved level;
  // fails_when=the shipped field reads lose the version or level, or reset/increment/cap changes;
  // why_new=existing update tests consume snooze state but never execute the skill fence that writes it;
  // seam=none; no_claim=installed host argument rendering (isolated shell fixtures and a fixed date command only).
  test('Not now writes the expected snooze state in agent shells', () => {
    const block = extractFences(CANONICAL_UPGRADE_FLOW).find(f => f.body.includes('_SNOOZE_FILE='))?.body;
    expect(block).toBeDefined();
    const tmp = makeBaseTmp('skill-protocols-snooze-');
    const stamp = '1800000000';
    const cases = [
      { name: 'absent', previous: null, level: 1 },
      { name: 'same version', previous: '2.0.0 2 1700000000\n', level: 3 },
      { name: 'capped', previous: '2.0.0 3 1700000000\n', level: 3 },
      { name: 'new version', previous: '1.9.0 3 1700000000\n', level: 1 },
      { name: 'malformed level', previous: '2.0.0 invalid 1700000000\n', level: 1 },
      { name: 'missing level', previous: '2.0.0\n', level: 1 },
    ];
    try {
      const shim = join(tmp, 'shim');
      mkdirSync(shim);
      writeFileSync(join(shim, 'date'), `#!/bin/sh\nprintf '%s\\n' '${stamp}'\n`, { mode: 0o755 });
      for (const shell of agentShells()) for (const c of cases) {
        const home = join(tmp, `${shell.shell}-${c.name}`);
        mkdirSync(join(home, '.gstack-extend'), { recursive: true });
        const state = join(home, '.gstack-extend', 'update-snoozed');
        if (c.previous !== null) writeFileSync(state, c.previous);
        const result = runShell(shell.shell, shell.args, block!.replace('{new}', '2.0.0'), scopedEnv(home, {
          PATH: `${shim}:/usr/bin:/bin`,
        }));
        expect(result.status, `${shell.shell}: ${c.name}`).toBe(0);
        expect(result.stderr).toBe('');
        expect(result.stdout).toBe('');
        expect(readFileSync(state, 'utf8')).toBe(`2.0.0 ${c.level} ${stamp}\n`);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

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
  // cross-reference and the broken `git pull` recovery command. Part 4
  // removed the session-paths re-resolution chain, so its `.` guard is a
  // negative token too.
  const REMOVED_TOKENS = [
    'Handle responses the same way as /pair-review',
    'git -C $_EXTEND_ROOT pull',
    '[ "$_EXTEND_ROOT" = "." ]',
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

// Track 5A's two-path (including vendored) probe is replaced by the Track 16D
// resolver locks. A cwd-relative `.claude/skills/` path must not come back.

// ─── Session-paths helper drift-lock ─────────────────────────────────
//
// State for /pair-review, /full-review, /roadmap moved off `.context/<skill>/`
// (workspace-local) onto `~/.gstack/projects/<slug>/<skill>/` (durable, mirrors
// gstack /context-save's checkpoints/ shape). Each affected skill must source
// bin/lib/session-paths.sh and call session_dir with its own skill name.
// Lock the call site so a future edit
// can't accidentally regress to `.context/`.

const SESSION_DIR_CALLERS: Array<{ skill: string; call: string }> = [
  { skill: 'pair-review', call: 'session_dir pair-review' },
  { skill: 'full-review', call: 'session_dir full-review' },
  { skill: 'roadmap', call: 'session_dir roadmap-proposals' },
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
    test(`${skill}.md no longer references .context/${skill}/`, () => {
      const oldPath = `.context/${skill}/`;
      expect(content).not.toContain(oldPath);
    });
  }
});

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

  test("SETUP \\ PREAMBLE contains the utility/workflow skills", () => {
    const extra = setupSkills.filter((s) => !(PREAMBLE_SKILLS as readonly string[]).includes(s));
    expect(extra).toEqual([...NON_PREAMBLE_SETUP_SKILLS]);
  });

  test('PROTOCOL and PREAMBLE exclude every non-preamble setup skill', () => {
    for (const s of NON_PREAMBLE_SETUP_SKILLS) {
      expect(PROTOCOL_SKILLS).not.toContain(s);
      expect(PREAMBLE_SKILLS).not.toContain(s);
    }
  });

  test('CONDUCTOR_SKILLS is the 4 trim-target files, not PROTOCOL', () => {
    expect([...CONDUCTOR_SKILLS]).toEqual([
      'pair-review',
      'full-review',
    ]);
    expect(CONDUCTOR_SKILLS).not.toContain('roadmap');
  });

  test('every cohort member has skills/<name>.md', () => {
    for (const name of [...setupSkills, ...PROTOCOL_SKILLS, ...PREAMBLE_SKILLS, ...CONDUCTOR_SKILLS]) {
      expect(existsSync(join(ROOT, 'skills', `${name}.md`))).toBe(true);
    }
  });
});

describe('host-managed workspace lifecycle', () => {
  // Conductor and Paseo both own worktree/branch lifecycle; Paseo's archive
  // teardown removes the worktree, so agents must not clean it up themselves.
  const PASEO_MARKER =
    'a Paseo worktree: `PASEO_AGENT_ID` is set and the checkout is under Paseo\'s worktree root, default `~/.paseo/worktrees/`';
  for (const skill of ['implement', 'review-and-prep', 'ship-and-land']) {
    test(`${skill} defers branch/worktree lifecycle to Conductor and Paseo`, () => {
      const normalized = readFileSync(join(ROOT, 'skills', `${skill}.md`), 'utf8').replace(/\s+/g, ' ');
      expect(normalized).toContain(`In a host-managed workspace (a Conductor workspace, or ${PASEO_MARKER})`);
      // `.context/` scratch stays Conductor-only: Paseo has no equivalent.
      expect(normalized).not.toMatch(/\bIn Conductor, (?:use the current|leave|do not)/);
    });
  }

  test('ship-and-land declines land cleanup in any host-managed workspace', () => {
    const normalized = readFileSync(join(ROOT, 'skills', 'ship-and-land.md'), 'utf8').replace(/\s+/g, ' ');
    expect(normalized).toContain(
      "decline land's local branch/worktree cleanup offers and leave cleanup to the host.",
    );
  });
});

describe('Paseo lifecycle wording beyond the primary workflow guards', () => {
  test('review-and-prep base merge leaves lifecycle to the workspace host', () => {
    // Value: protects=review-and-prep base merge defers branch and worktree lifecycle to the host; fails_when=the ownership clause is removed; why_new=primary prep guard does not cover the merge step; seam=none
    const normalized = readFileSync(join(ROOT, 'skills', 'review-and-prep.md'), 'utf8').replace(/\s+/g, ' ');
    expect(normalized).toContain(
      'existing feature branch; a workspace host (Conductor, Paseo) still owns branch/worktree creation and cleanup.',
    );
  });

  test('review-and-prep assigns blocked-push reconciliation to the user or host', () => {
    // Value: protects=blocked-push reconciliation is owned by the user or workspace host; fails_when=the owner sentence is dropped or narrowed to Conductor; why_new=primary prep guard does not cover blocked-push recovery; seam=none
    const normalized = readFileSync(join(ROOT, 'skills', 'review-and-prep.md'), 'utf8').replace(/\s+/g, ' ');
    expect(normalized).toContain(
      'The user or the workspace host owns reconciliation outside this workflow.',
    );
  });

  test('pair-review keeps branch-keyed sessions independent across Paseo workspaces', () => {
    // Value: protects=pair-review identifies Paseo workspaces as independent homes for branch-keyed sessions; fails_when=Paseo is removed from the scope; why_new=existing lifecycle assertions cover only implement prep and land; seam=none
    const normalized = readFileSync(join(ROOT, 'skills', 'pair-review.md'), 'utf8').replace(/\s+/g, ' ');
    expect(normalized).toContain(
      'multiple branches (in different Conductor or Paseo workspaces, or on different machines) can each have their own active session',
    );
  });

  test('full-review session state survives Paseo workspace archival', () => {
    // Value: protects=full-review documents durable session state across Paseo archival; fails_when=Paseo is removed from the archival guarantee; why_new=existing tests do not pin durable-state wording; seam=none
    const normalized = readFileSync(join(ROOT, 'skills', 'full-review.md'), 'utf8').replace(/\s+/g, ' ');
    expect(normalized).toContain('Survives workspace archival (Conductor, Paseo).');
  });

  test('roadmap proposals survive Paseo workspace archival', () => {
    // Value: protects=roadmap proposal artifacts are durable across Paseo archival; fails_when=Paseo is removed from the durability guarantee; why_new=existing tests do not pin durable-state wording; seam=none
    const normalized = readFileSync(join(ROOT, 'skills', 'roadmap.md'), 'utf8').replace(/\s+/g, ' ');
    expect(normalized).toContain(
      'durable, survives workspace archival (Conductor, Paseo).',
    );
  });
});

describe('non-preamble setup skills carry only telemetry SHARED blocks', () => {
  const setupSkills = parseSetupSkills(readFileSync(join(ROOT, 'setup'), 'utf8'));
  const outside = setupSkills.filter((s) => !(PREAMBLE_SKILLS as readonly string[]).includes(s));

  test('the outside set is exactly the utility/workflow cohort', () => {
    expect(outside).toEqual([...NON_PREAMBLE_SETUP_SKILLS]);
  });

  for (const skill of outside) {
    test(`${skill} has only telemetry markers and no protocol/upgrade/Conductor blocks`, () => {
      const content = readFileSync(join(ROOT, 'skills', `${skill}.md`), 'utf8');
      const markers = [...content.matchAll(/<!-- (\/?SHARED:[^ ]+) -->/g)].map(match => match[1]);
      expect(markers).toEqual(['SHARED:telemetry-start', '/SHARED:telemetry-start', 'SHARED:telemetry-finish', '/SHARED:telemetry-finish']);
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

describe('Track 16D extend-root resolver locks', () => {
  const upgrade = resolverSkillText('gstack-extend-upgrade');
  const span = extractCanonicalSpan(upgrade);

  test('canonical span matches the locked text', () => {
    expect(span).toBe(CANONICAL_SPAN);
  });

  test('L1: span is byte-identical exactly once, and each _ER_SKILL line is pinned', () => {
    for (const skill of ROOT_RESOLVER_SKILLS) {
      const content = resolverSkillText(skill);
      if (content.split(span).length - 1 !== 1) {
        throw new Error(
          `drift in extend-root resolver — propagate canonical span from skills/gstack-extend-upgrade.md (${skill})`,
        );
      }
      expect(content.match(/^_ER_SKILL=\S+$/gm)).toEqual([`_ER_SKILL=${skill}`]);
    }
  });

  test('L2: canonical span keeps the absolute-path, file, executable, and marker checks', () => {
    expect(span).toContain('case "$_ER" in /*)');
    expect(span).toContain('[ -f');
    expect(span).toContain('[ -x');
    expect(span).toContain(`grep -qx '${MARKER_LINE}'`);
    expect(span).toContain(FOR_SKILL_LINE);
    expect(span).toContain(FOR_POINTER_LINE);
  });

  test('L3: workflow, upgrade, and init tails are verbatim', () => {
    for (const skill of WORKFLOW_SKILLS) {
      expect(extractPreambleFence(resolverSkillText(skill))).toBe(skillPreamble(skill, WORKFLOW_TAIL));
    }
    expect(extractPreambleFence(upgrade)).toBe(skillPreamble('gstack-extend-upgrade', UPGRADE_TAIL));
    expect(extractPreambleFence(resolverSkillText('gstack-extend-init'))).toBe(
      skillPreamble('gstack-extend-init', INIT_TAIL),
    );
    expect(extractPreambleFence(resolverSkillText('autoplan-lean'))).toBe(
      skillPreamble('autoplan-lean', AUTOPLAN_LEAN_TAIL),
    );
    expect(extractPreambleFence(resolverSkillText('docs-ship'))).toBe(
      skillPreamble('docs-ship', DOCS_SHIP_TAIL),
    );
  });

  test('L4: hand-off paragraph, upgrade no-root branch, and renames ER= line', () => {
    for (const skill of ROOT_RESOLVER_SKILLS) {
      const content = resolverSkillText(skill);
      expect(content).toContain(HANDOFF_PARAGRAPH);
      expect(content).toContain(NO_INSTALL_MESSAGE);
    }
    expect(resolverSkillText('gstack-extend-upgrade')).toContain(UPGRADE_NO_ROOT);
    expect(resolverSkillText('gstack-extend-init')).toContain(INIT_ERROR_STOP);
    expect(resolverSkillText('autoplan-lean')).toContain(INIT_ERROR_STOP);
    expect(resolverSkillText('docs-ship')).toContain(INIT_ERROR_STOP);
    expect(resolverSkillText('roadmap')).toContain(RENAMES_ER_LINE);
  });

  test('L5: every skill path is home-anchored', () => {
    for (const skill of ROOT_RESOLVER_SKILLS) {
      const content = resolverSkillText(skill);
      const re = new RegExp(SKILL_PATH_RE.source, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(content))) {
        const before = content.slice(Math.max(0, m.index - 24), m.index);
        const ok = SKILL_PATH_PREFIXES.some((p) => before.endsWith(p));
        if (!ok) {
          throw new Error(`${skill}: skill path is not home-anchored: ${JSON.stringify(before + m[0])}`);
        }
      }
    }
  });

  test('L6 regex flags cwd-relative bin/ calls and passes verified-root ones', () => {
    const flagged = [
      'bin/x', './bin/x', 'foo && bin/x', 'X=$(bin/x)', 'if ! bin/x', 'ER=1 bin/x', 'source bin/lib/x.sh',
      '. bin/lib/x.sh', '  bin/x', 'bash bin/x', 'sh ./bin/x', 'bun bin/x.ts', 'bun run bin/x', 'python3 bin/x.py',
    ];
    for (const line of flagged) expect([line, CMD_BIN_RE.test(line)]).toEqual([line, true]);
    const passed = [
      '"$_EXTEND_ROOT/bin/x"',
      'cat docs/bin/x',
      'GSTACK_EXTEND_DIR="$_EXTEND_ROOT" "$_EXTEND_ROOT/bin/update-check"',
      'bash "$_EXTEND_ROOT/bin/lib/run-migrations.sh"',
      'source "$_EXTEND_ROOT/bin/lib/session-paths.sh"',
    ];
    for (const line of passed) expect([line, CMD_BIN_RE.test(line)]).toEqual([line, false]);
  });

  test('L6: bash fences have no command-position bin/ call', () => {
    for (const skill of ROOT_RESOLVER_SKILLS) {
      for (const fence of extractFences(resolverSkillText(skill))) {
        for (const line of fence.body.split('\n')) {
          if (CMD_BIN_RE.test(line)) {
            throw new Error(`${skill}: command-position bin/ call: ${line}`);
          }
        }
      }
    }
  });

  test('L7: every extend-root source is guarded, and every guard sources next', () => {
    const sourceRe = /^(?:source|\.) "\$_EXTEND_ROOT\//;
    let guards = 0;
    for (const skill of ROOT_RESOLVER_SKILLS) {
      const content = resolverSkillText(skill);
      const prose = content.replace(/^([ \t]*)```[\s\S]*?^\1```/gm, '');
      expect(prose).not.toContain('source "$_EXTEND_ROOT');
      for (const fence of extractFences(content)) {
        if (fence.lang !== 'bash') continue;
        const lines = fence.body.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (sourceRe.test(lines[i] ?? '')) {
            let j = i - 1;
            while (j >= 0 && (lines[j] ?? '').trim() === '') j--;
            expect(lines[j]).toBe(GUARD_LINE);
          }
          if (lines[i] === GUARD_LINE) {
            guards++;
            expect(lines[i - 1]).toBe(GUARD_COMMENT);
            let k = i + 1;
            while (k < lines.length && (lines[k] ?? '').trim() === '') k++;
            expect(lines[k] ?? '').toMatch(sourceRe);
          }
        }
      }
    }
    expect(guards).toBe(6);
  });
});

const extendRootTmp = makeBaseTmp('skill-protocols-extend-root-');

afterAll(() => {
  try { rmSync(extendRootTmp, { recursive: true, force: true }); } catch { /* */ }
});

function plantSkillLink(home: string, skill: string, root: string): void {
  mkdirSync(join(root, 'skills'), { recursive: true });
  writeFileSync(join(root, 'skills', `${skill}.md`), 'skill\n');
  const dir = hostDir(home, 'claude', skill);
  mkdirSync(dir, { recursive: true });
  symlinkSync(join(root, 'skills', `${skill}.md`), join(dir, 'SKILL.md'));
}

function plantHostileTree(cwd: string, skill: string): void {
  const root = join(cwd, 'evil');
  writeUpdateCheck(root, { marker: true, record: true });
  mkdirSync(join(root, 'skills'), { recursive: true });
  writeFileSync(join(root, 'skills', `${skill}.md`), 'hostile\n');
  const dir = join(cwd, '.claude', 'skills', skill);
  mkdirSync(dir, { recursive: true });
  symlinkSync(`../../../evil/skills/${skill}.md`, join(dir, 'SKILL.md'));
  writeFileSync(join(dir, '.extend-root'), `${root}\n`);
}

function runPreamble(skill: string, home: string, cwd: string, extra: Record<string, string> = {}) {
  const script = extractPreambleFence(resolverSkillText(skill));
  return strictShells().map((sh) => {
    const extraForShell = { ...extra };
    if (extra.SENTINEL) extraForShell.SENTINEL = `${extra.SENTINEL}-${sh.shell}`;
    const r = runShell(sh.shell, sh.args, script, scopedEnv(home, extraForShell), cwd);
    return {
      shell: sh.shell,
      status: r.status,
      stdout: r.stdout ?? '',
      stderr: r.stderr ?? '',
      sentinel: extraForShell.SENTINEL,
    };
  });
}

// Init-tail skills exit 1 without a verified root and never run update-check.
const INIT_LIKE = new Set<string>(['gstack-extend-init', 'autoplan-lean', 'docs-ship']);

describe('Track 16D preamble representatives', () => {
  const cohorts = ['pair-review', 'gstack-extend-upgrade', 'gstack-extend-init'] as const;

  for (const skill of ROOT_RESOLVER_SKILLS) {
    for (const install of ['pointer', 'symlink', 'unverified'] as const) {
      test(`Cursor-only ${skill} preamble resolves ${install} installs safely`, () => {
        const label = `cursor-${skill}-${install}`;
        const home = join(extendRootTmp, `${label} home`);
        const root = join(extendRootTmp, `${label} checkout`);
        const cwd = join(extendRootTmp, `${label}-cwd`);
        const sentinel = join(extendRootTmp, `${label}-sentinel`);
        const hostileSentinel = join(extendRootTmp, `${label}-hostile`);
        mkdirSync(cwd, { recursive: true });
        writeUpdateCheck(root, { marker: install !== 'unverified', record: true });
        if (INIT_LIKE.has(skill)) {
          const bin = join(root, 'bin', skill === 'gstack-extend-init' ? 'gstack-extend' : skill);
          writeFileSync(bin, '#!/bin/sh\nexit 0\n');
          chmodSync(bin, 0o755);
        }
        const dir = hostDir(home, 'cursor', skill);
        mkdirSync(dir, { recursive: true });
        if (install === 'symlink') {
          mkdirSync(join(root, 'skills'), { recursive: true });
          writeFileSync(join(root, 'skills', `${skill}.md`), 'skill\n');
          symlinkSync(join(root, 'skills', `${skill}.md`), join(dir, 'SKILL.md'));
        } else {
          writePointer(home, 'cursor', skill, root);
          writeFileSync(join(dir, 'SKILL.md'), 'generated copy\n');
        }
        // A repository-local Cursor install must never override the HOME install.
        const evil = join(cwd, 'evil');
        writeUpdateCheck(evil);
        writeFileSync(join(evil, 'bin', 'update-check'),
          `#!/bin/sh\n${MARKER_LINE}\nprintf hostile > "$HOSTILE_SENTINEL"\n`);
        writePointer(cwd, 'cursor', skill, evil);
        for (const r of runPreamble(skill, home, cwd, {
          SENTINEL: sentinel, HOSTILE_SENTINEL: hostileSentinel,
        })) {
          expect(r.stderr).toBe('');
          expect(existsSync(hostileSentinel)).toBe(false);
          if (install === 'unverified') {
            expect(r.stdout).toContain("lacks the line '# extend-root-protocol: v1'");
            expect(r.stdout).not.toContain('EXTEND_ROOT:');
            expect(r.status).toBe(INIT_LIKE.has(skill) ? 1 : 0);
            expect(existsSync(r.sentinel!)).toBe(false);
          } else {
            expect(r.status).toBe(0);
            expect(r.stdout).toContain(`EXTEND_ROOT: ${root}`);
            if (!INIT_LIKE.has(skill)) {
              expect(readFileSync(r.sentinel!, 'utf8').trim()).toBe(root);
            }
          }
        }
      });
    }
  }

  test('verified root prints EXTEND_ROOT and pins GSTACK_EXTEND_DIR', () => {
    for (const skill of cohorts) {
      const home = join(extendRootTmp, `ok-home-${skill}`);
      const root = join(extendRootTmp, `ok-root-${skill}`);
      const cwd = join(extendRootTmp, `ok-cwd-${skill}`);
      const sentinel = join(extendRootTmp, `ok-sentinel-${skill}`);
      mkdirSync(home, { recursive: true });
      mkdirSync(cwd, { recursive: true });
      writeUpdateCheck(root, { record: true });
      if (skill === 'gstack-extend-init') {
        const bin = join(root, 'bin', 'gstack-extend');
        writeFileSync(bin, '#!/bin/sh\nexit 0\n');
        chmodSync(bin, 0o755);
      }
      plantSkillLink(home, skill, root);
      const hostileEnv = join(extendRootTmp, `ok-hostile-env-${skill}`);
      mkdirSync(hostileEnv, { recursive: true });
      for (const r of runPreamble(skill, home, cwd, { SENTINEL: sentinel, GSTACK_EXTEND_DIR: hostileEnv })) {
        expect(r.stderr).toBe('');
        expect(r.status).toBe(0);
        expect(r.stdout).toContain(`EXTEND_ROOT: ${root}`);
        if (skill === 'gstack-extend-init') {
          expect(existsSync(r.sentinel ?? sentinel)).toBe(false);
        } else {
          expect(readFileSync(r.sentinel ?? sentinel, 'utf8').trim()).toBe(root);
        }
      }
    }
  });

  test('init with a verified root but no bin/gstack-extend exits 1 before printing the root', () => {
    const home = join(extendRootTmp, 'init-nobin-home');
    const root = join(extendRootTmp, 'init-nobin-root');
    const cwd = join(extendRootTmp, 'init-nobin-cwd');
    mkdirSync(cwd, { recursive: true });
    writeUpdateCheck(root);
    plantSkillLink(home, 'gstack-extend-init', root);
    const results = runPreamble('gstack-extend-init', home, cwd);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.stderr).toBe('');
      expect(r.status).toBe(1);
      expect(r.stdout).toContain(`ERROR: ${root}/bin/gstack-extend is missing or not executable`);
      expect(r.stdout).not.toContain('EXTEND_ROOT:');
      expect(r.stdout).not.toContain('_EXTEND_ROOT=');
    }
  });

  test('init with a verified root but a non-executable bin/gstack-extend exits 1 before printing the root', () => {
    const home = join(extendRootTmp, 'init-nox-home');
    const root = join(extendRootTmp, 'init-nox-root');
    const cwd = join(extendRootTmp, 'init-nox-cwd');
    mkdirSync(cwd, { recursive: true });
    writeUpdateCheck(root);
    const bin = join(root, 'bin', 'gstack-extend');
    writeFileSync(bin, '#!/bin/sh\nexit 0\n');
    chmodSync(bin, 0o644);
    plantSkillLink(home, 'gstack-extend-init', root);
    const results = runPreamble('gstack-extend-init', home, cwd);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.stderr).toBe('');
      expect(r.status).toBe(1);
      expect(r.stdout).toContain(`ERROR: ${root}/bin/gstack-extend is missing or not executable`);
      expect(r.stdout).not.toContain('EXTEND_ROOT:');
      expect(r.stdout).not.toContain('_EXTEND_ROOT=');
    }
  });

  test('hostile cwd alone never runs, and init exits 1', () => {
    for (const skill of cohorts) {
      const home = join(extendRootTmp, `bad-home-${skill}`);
      const cwd = join(extendRootTmp, `bad-cwd-${skill}`);
      const sentinel = join(extendRootTmp, `bad-sentinel-${skill}`);
      mkdirSync(home, { recursive: true });
      plantHostileTree(cwd, skill);
      for (const r of runPreamble(skill, home, cwd, { SENTINEL: sentinel })) {
        expect(r.stderr).toBe('');
        expect(existsSync(r.sentinel ?? sentinel)).toBe(false);
        if (skill === 'gstack-extend-init') {
          expect(r.status).toBe(1);
          expect(r.stdout).toContain('ERROR:');
        } else {
          expect(r.status).toBe(0);
          expect(r.stdout).not.toContain('EXTEND_ROOT:');
        }
      }
    }
  });

  test('marker-less home pointer prints the missing-marker cause and runs nothing', () => {
    for (const skill of cohorts) {
      const home = join(extendRootTmp, `stale-home-${skill}`);
      const root = join(extendRootTmp, `stale-root-${skill}`);
      const cwd = join(extendRootTmp, `stale-cwd-${skill}`);
      const sentinel = join(extendRootTmp, `stale-sentinel-${skill}`);
      mkdirSync(cwd, { recursive: true });
      writeUpdateCheck(root, { marker: false, record: true });
      writePointer(home, 'claude', skill, root);
      writeFileSync(join(hostDir(home, 'claude', skill), 'SKILL.md'), 'copy\n');
      for (const r of runPreamble(skill, home, cwd, { SENTINEL: sentinel })) {
        expect(r.stderr).toBe('');
        expect(existsSync(r.sentinel ?? sentinel)).toBe(false);
        expect(r.stdout).toContain("lacks the line '# extend-root-protocol: v1'");
        if (skill === 'gstack-extend-init') {
          expect(r.status).toBe(1);
          expect(r.stdout).toContain('ERROR:');
        } else {
          expect(r.status).toBe(0);
          expect(r.stdout).toContain('EXTEND_ROOT_UNVERIFIED:');
        }
      }
    }
  });

  test('re-verification after the fix prints EXTEND_ROOT and runs the stub', () => {
    const skill = 'pair-review';
    const home = join(extendRootTmp, 'recover-home');
    const root = join(extendRootTmp, 'recover-root');
    const cwd = join(extendRootTmp, 'recover-cwd');
    const sentinel = join(extendRootTmp, 'recover-sentinel');
    mkdirSync(cwd, { recursive: true });
    writeUpdateCheck(root, { marker: false, record: true });
    writePointer(home, 'claude', skill, root);
    writeFileSync(join(hostDir(home, 'claude', skill), 'SKILL.md'), 'copy\n');
    for (const r of runPreamble(skill, home, cwd, { SENTINEL: sentinel })) {
      expect(r.stdout).toContain('EXTEND_ROOT_UNVERIFIED:');
      expect(existsSync(r.sentinel ?? sentinel)).toBe(false);
    }
    writeFileSync(join(root, 'bin', 'update-check'), `#!/bin/sh\nprintf '%s\\n' "\${GSTACK_EXTEND_DIR:-}" > "\${SENTINEL:?}"\n${MARKER_LINE}\n`);
    chmodSync(join(root, 'bin', 'update-check'), 0o755);
    for (const r of runPreamble(skill, home, cwd, { SENTINEL: sentinel })) {
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(`EXTEND_ROOT: ${root}`);
      expect(readFileSync(r.sentinel ?? sentinel, 'utf8').trim()).toBe(root);
    }
  });
});

describe('Track 16D root hand-off', () => {
  test('%q line round-trips a root with a space and an apostrophe', () => {
    const skill = 'pair-review';
    const home = join(extendRootTmp, 'q-home');
    const root = join(extendRootTmp, 'q root', "o'brien");
    const cwd = join(extendRootTmp, 'q-cwd');
    mkdirSync(cwd, { recursive: true });
    writeUpdateCheck(root, { record: true });
    plantSkillLink(home, skill, root);
    const sentinel = join(extendRootTmp, 'q-sentinel');
    const ran = runPreamble(skill, home, cwd, { SENTINEL: sentinel });
    for (const r of ran) {
      const line = r.stdout.split('\n').find((l) => l.startsWith('_EXTEND_ROOT='));
      expect(line).toBeTruthy();
      for (const sh of agentShells()) {
        const ev = runShell(sh.shell, sh.args, `${line}\nprintf '%s\\n' "$_EXTEND_ROOT"\n`, scopedEnv(home), cwd);
        expect(ev.stderr).toBe('');
        expect((ev.stdout ?? '').trim()).toBe(root);
      }
    }
  });

  test('upgrade-flow block prints AUTO_UPGRADE=true only with the emitted line', () => {
    const home = join(extendRootTmp, 'flow-home');
    const root = join(extendRootTmp, 'flow-root');
    const cwd = join(extendRootTmp, 'flow-cwd');
    mkdirSync(cwd, { recursive: true });
    writeUpdateCheck(root);
    const config = join(root, 'bin', 'config');
    writeFileSync(config, '#!/bin/sh\necho true\n');
    chmodSync(config, 0o755);
    plantSkillLink(home, 'gstack-extend-upgrade', root);
    const preamble = runPreamble('gstack-extend-upgrade', home, cwd)[0]!;
    const line = preamble.stdout.split('\n').find((l) => l.startsWith('_EXTEND_ROOT='));
    expect(line).toBeTruthy();
    const flow = resolverSkillText('gstack-extend-upgrade').match(
      /<!-- SHARED:upgrade-flow -->[\s\S]*?<!-- \/SHARED:upgrade-flow -->/,
    )?.[0] ?? '';
    const block = flow.match(/```bash\n([\s\S]*?)```/)?.[1]?.replace(/\n$/, '') ?? '';
    expect(block).toContain('auto_upgrade');
    for (const sh of agentShells()) {
      const withLine = runShell(sh.shell, sh.args, `${line}\n${block}\n`, scopedEnv(home), cwd);
      expect(withLine.stdout ?? '').toContain('AUTO_UPGRADE=true');
      const without = runShell(sh.shell, sh.args, `${block}\n`, scopedEnv(home), cwd);
      expect(without.stdout ?? '').toContain('AUTO_UPGRADE=false');
    }
  });
});

describe('Track 16D guarded source', () => {
  const block = extractFences(resolverSkillText('pair-review'))
    .find((f) => f.body.includes('session_dir pair-review "$BRANCH"'))!
    .body.replace(/\n$/, '');

  function sessionStub(root: string, marker: boolean): void {
    writeUpdateCheck(root, { marker });
    const lib = join(root, 'bin', 'lib');
    mkdirSync(lib, { recursive: true });
    writeFileSync(
      join(lib, 'session-paths.sh'),
      `printf 'sourced\\n' > "\${SENTINEL:?}"\nsession_dir() { printf 'stub\\n'; }\n`,
    );
  }

  test('verified %q line sources the stub', () => {
    const home = join(extendRootTmp, 'guard-ok-home');
    const root = join(extendRootTmp, 'guard root', "o'brien");
    const cwd = join(extendRootTmp, 'guard-ok-cwd');
    const sentinel = join(extendRootTmp, 'guard-ok-sentinel');
    mkdirSync(cwd, { recursive: true });
    writeUpdateCheck(root, { record: true });
    sessionStub(root, true);
    plantSkillLink(home, 'pair-review', root);
    const upd = join(extendRootTmp, 'guard-ok-upd');
    const preamble = runPreamble('pair-review', home, cwd, { SENTINEL: upd })[0]!;
    const line = preamble.stdout.split('\n').find((l) => l.startsWith('_EXTEND_ROOT='));
    expect(line).toBeTruthy();
    for (const sh of strictShells()) {
      rmSync(sentinel, { force: true });
      const r = runShell(sh.shell, sh.args, `${line}\n${block}\n`, scopedEnv(home, { SENTINEL: sentinel }), cwd);
      expect(r.stderr ?? '').toBe('');
      expect(r.status).toBe(0);
      expect(readFileSync(sentinel, 'utf8')).toContain('sourced');
    }
  });

  test('missing, relative, and marker-less roots exit 1 without sourcing', () => {
    const sentinel = join(extendRootTmp, 'guard-bad-sentinel');
    const hostile = join(extendRootTmp, 'guard-hostile');
    const rel = join(hostile, 'x');
    sessionStub(rel, true);
    const markerLess = join(extendRootTmp, 'guard-markerless');
    sessionStub(markerLess, false);
    const cases = [
      { name: 'no prefix', prefix: '', cwd: hostile },
      { name: 'relative', prefix: '_EXTEND_ROOT=x\n', cwd: hostile },
      { name: 'marker-less', prefix: `_EXTEND_ROOT=${JSON.stringify(markerLess)}\n`, cwd: hostile },
    ];
    for (const c of cases) {
      for (const sh of strictShells()) {
        rmSync(sentinel, { force: true });
        const r = runShell(
          sh.shell,
          sh.args,
          `${c.prefix}${block}\n`,
          scopedEnv(join(extendRootTmp, 'guard-bad-home'), { SENTINEL: sentinel }),
          c.cwd,
        );
        expect(r.status).toBe(1);
        expect(r.stderr ?? '').toContain('ERROR: no verified gstack-extend root');
        expect(existsSync(sentinel)).toBe(false);
      }
    }
  });

  test('real session-paths helper prints PROJECT_DIR and SESSION_DIR', () => {
    const root = join(extendRootTmp, 'guard-real');
    const cwd = join(extendRootTmp, 'guard-real-cwd');
    mkdirSync(cwd, { recursive: true });
    writeUpdateCheck(root);
    const lib = join(root, 'bin', 'lib');
    mkdirSync(lib, { recursive: true });
    copyFileSync(join(ROOT, 'bin', 'lib', 'session-paths.sh'), join(lib, 'session-paths.sh'));
    const script = `_EXTEND_ROOT="$CHECKOUT"\n${block}\n`;
    for (const sh of agentShells()) {
      const r = runShell(
        sh.shell,
        sh.args,
        script,
        scopedEnv(join(extendRootTmp, 'guard-real-home'), { CHECKOUT: root, GSTACK_STATE_ROOT: join(extendRootTmp, 'gstack-state') }),
        cwd,
      );
      expect(r.status).toBe(0);
      expect(r.stdout ?? '').toContain('PROJECT_DIR=');
      expect(r.stdout ?? '').toContain('SESSION_DIR=');
    }
  });
});

// Track 24A: workflow-metrics prose lives outside the SHARED telemetry blocks in
// exactly the two wrappers, maps their real headings, and cannot move a gate.
describe('Track 24A workflow metrics drift-locks', () => {
  const metricsSchema = JSON.parse(readFileSync(join(ROOT, 'docs/workflow-metrics.schema.json'), 'utf8'));
  const schemaPhases = metricsSchema.definitions.phase.enum as string[];
  const waitCategories = metricsSchema.definitions.begin_request.properties.wait_category.enum as string[];
  const wrappers: Record<string, string[]> = {
    'review-and-prep': ['1. Establish the branch, PR, and review inputs', '2. Review and verify locally',
      'Merge the latest base before review', "Enforce completion, beyond /review's informational audit",
      "Prove /ship's release gates on this head", 'Capture evidence and commit',
      '3. Push and create or update the draft', 'Manual testing checkpoint and resume',
      '4. Trigger once and await Greptile', '5. Triage, fix, and verify locally',
      '6. Final readiness gate and handoff', '7. Emit the copyable prompt for a new session'],
    'ship-and-land': ['1. Resolve the workflows and target', '2. Decide what can be reused',
      'Release-only path', 'Independently verified reuse', 'Shared review execution (DOCS and FULL)',
      'Greptile and new feedback', '3. Execute ship and verify its final changes', '4. Land and verify'],
  };
  for (const [skill, anchors] of Object.entries(wrappers)) {
    test(`${skill} carries metrics outside SHARED with every anchor and gate guard`, () => {
      const content = readFileSync(join(ROOT, 'skills', `${skill}.md`), 'utf8');
      const flat = content.replace(/\s+/g, ' ');
      const startBlock = content.match(TELEMETRY_PREAMBLE_RE)?.[0] ?? '';
      const finishBlock = content.match(TELEMETRY_EPILOGUE_RE)?.[0] ?? '';
      expect(startBlock).not.toContain('metrics');
      expect(finishBlock).not.toContain('metrics');
      const at = content.indexOf('### Workflow metrics (optional, local)');
      expect(at).toBeGreaterThan(content.indexOf('<!-- /SHARED:telemetry-start -->'));
      expect(at).toBeLessThan(content.indexOf('<!-- SHARED:telemetry-finish -->'));
      expect(flat).toContain('The SHARED prohibition on copying session values governs legacy start/finish calls only.');
      expect(flat).toContain('retain the opaque session ID this invocation\'s start printed');
      expect(flat).toContain('docs/telemetry.md#workflow-metrics');
      expect(flat).toContain('inspect the JSON envelope\'s `status`');
      expect(flat).toContain('Never rerun completed work to manufacture telemetry');
      expect(flat).toContain('replay that identical payload at most once');
      expect(flat).toContain('capture=disabled|unavailable|partial');
      expect(flat).toContain('cannot authorize');
      expect(flat).toContain('clock-sensitive');
      expect(flat).toContain('metrics never triggers');
      expect(flat).toContain(`stage:"${skill}"`);
      expect(flat).toContain('Issue metrics calls one at a time from this session');
      expect(flat).toContain('emit nothing further in this invocation');
      expect(flat).toContain('lowercase UUID');
      expect(flat).toContain('never guess an ID');
      expect(flat).toContain('immediately before writing');
      expect(flat).toContain('`end` the run step just before the legacy telemetry finish');
      expect(flat).toContain('kind:"fix"');
      expect(flat).toContain('correction_kind:"finding"');
      expect(flat).toContain('One governing `decision` per executed phase visit');
      expect(flat).toContain('`rc=$?`');
      // The mapping table: every left-hand anchor is a real heading (inline code stripped), every
      // required anchor is mapped, and every right-hand token is a controlled phase, wait category
      // or decision value, so a renamed heading or a misspelt phase fails here.
      const headings = [...content.matchAll(/^#{2,4} (.+)$/gm)].map(m => m[1].replace(/`/g, '').trim());
      const tableAt = content.indexOf('| Anchor in this skill | Metric phases |', at);
      expect(tableAt).toBeGreaterThan(at);
      const rows = content.slice(tableAt, content.indexOf('\n\n', tableAt)).split('\n').slice(2);
      const mapped: string[] = [];
      const allowed = [...schemaPhases, ...waitCategories, 'RUN', 'REUSE', 'N/A'];
      for (const row of rows) {
        const [, left, right] = row.split('|');
        for (const [, anchor] of left.matchAll(/`([^`]+)`/g)) {
          expect(headings, `${skill}: ${anchor}`).toContain(anchor);
          mapped.push(anchor);
        }
        for (const [, token] of right.matchAll(/`([^`]+)`/g)) expect(allowed, `${skill}: ${row}`).toContain(token);
      }
      for (const anchor of anchors) expect(mapped, `${skill} maps ${anchor}`).toContain(anchor);
      const tablePhases = rows.flatMap(row => [...row.split('|')[2].matchAll(/`([a-z][a-z-]*)`/g)].map(m => m[1]))
        .filter(p => schemaPhases.includes(p));
      expect(new Set(tablePhases).size).toBeGreaterThanOrEqual(5);
    });
  }
  // Track 31A: the consolidated at-boundary rules, the canonical span pattern and the closed site tables.
  const DOCS = readFileSync(join(ROOT, 'docs/telemetry.md'), 'utf8');
  const spanDocs = DOCS.slice(DOCS.indexOf('<a id="workflow-metrics-span"></a>'), DOCS.indexOf('### Diagnostic reasons'));
  const strip = (text: string) => text.replace(/`/g, '').trim();
  const metricsOf = (skill: string) => {
    const content = readFileSync(join(ROOT, 'skills', `${skill}.md`), 'utf8');
    const at = content.indexOf('### Workflow metrics (optional, local)');
    return content.slice(at, content.indexOf('<!-- SHARED:telemetry-finish -->'));
  };
  const siteRows = (skill: string) => {
    const body = metricsOf(skill);
    const tableAt = body.indexOf('| Anchor in this skill | Metric phases | Spans |');
    expect(tableAt, `${skill}: the mapping table needs a Spans column; a wrapper change updates the mapping in the same change`).toBeGreaterThan(-1);
    return body.slice(tableAt, body.indexOf('\n\n', tableAt)).split('\n').slice(2).map(row => {
      const [, left, phases, spans] = row.split('|');
      return { anchors: [...left.matchAll(/`([^`]+)`/g)].map(m => strip(m[1])), phases, spans, row };
    });
  };
  const spanBlock = (text: string, marker: string) => {
    const at = text.indexOf(marker);
    expect(at, `missing ${marker}`).toBeGreaterThan(-1);
    const lines = /(?:~~~sh|```bash)\n([\s\S]*?)(?:~~~|```)\n/.exec(text.slice(at))![1].split('\n');
    const indent = Math.min(...lines.filter(l => l.trim()).map(l => l.match(/^ */)![0].length)); // a bullet indents its copy
    return lines.map(l => l.slice(indent)).join('\n');
  };
  const requiredSites: Record<string, Record<string, string[]>> = {
    'review-and-prep': {
      completion: ["Enforce completion, beyond /review's informational audit", '5. Triage, fix, and verify locally'],
      pregate: ["Prove /ship's release gates on this head", 'Repair a test-only final-gate failure', '5. Triage, fix, and verify locally', 'Reviewed secret findings'],
      coverage: ["Prove /ship's release gates on this head"],
      documentation: ["Prove /ship's release gates on this head"],
      tests: ["Prove /ship's release gates on this head", 'Repair a test-only final-gate failure', '5. Triage, fix, and verify locally'],
      'external-review': ['4. Trigger once and await Greptile'],
    },
    'ship-and-land': {
      completion: ['Project release policy'],
      pregate: ['Test evidence', 'Release-only path', 'Reviewed secret findings'],
      tests: ['Test evidence', 'Release-only path', 'Docs test policy'],
      coverage: ['Shared review execution (DOCS and FULL)'],
      documentation: ['Shared review execution (DOCS and FULL)'],
      'external-review': ['Greptile and new feedback'],
    },
  };
  const longSites: Record<string, Record<string, string[]>> = {
    'review-and-prep': {
      pregate: ["Prove /ship's release gates on this head", 'Repair a test-only final-gate failure', '5. Triage, fix, and verify locally', 'Reviewed secret findings'],
      tests: ["Prove /ship's release gates on this head", 'Repair a test-only final-gate failure', '5. Triage, fix, and verify locally'],
      'external-review': ['4. Trigger once and await Greptile'],
    },
    'ship-and-land': {
      pregate: ['Test evidence', 'Release-only path', 'Reviewed secret findings'],
      tests: ['Test evidence', 'Release-only path'],
      'external-review': ['Greptile and new feedback'],
    },
  };
  for (const skill of Object.keys(wrappers)) {
    test(`${skill} states the consolidated at-boundary rules and drops the batching sentence`, () => {
      const flat = metricsOf(skill).replace(/\s+/g, ' ');
      expect(flat, `${skill}: the old batching sentence must stay replaced`).not.toContain('Emit, batched into existing tool calls where practical');
      for (const phrase of [
        'Emit each record at its boundary, never afterward',
        "a step's `begin` goes in the tool call that starts its work, ahead of that work's first command",
        'Its `end` goes in the same call right after the command returns, or in the first tool call after a subagent, background command or external result returns',
        'Work with no command of its own (completion audit, scope reading, triage) gets its `begin` and `end` in short dedicated calls',
        'their `begin` records go one after another in a single Bash call immediately before the one dispatch message, never inside it',
        "Each voice's `end` goes in the first tool call after that voice's own result arrives",
        'A pass `started` precedes the dispatch of its voices',
        'A RUN-decided visit with no span reads unknown by design',
        'Never backfill: never write a `begin` or `end` for a boundary that has already passed or has not happened yet',
        "if a step's `begin` was not `recorded`, `replayed` or reconciled, emit no `end` for it",
        'A wait is ended `paused` only at an actual pause',
        'If the host kills the tool call so the same-call `end` never runs, the step stays open',
        'Mint IDs at random',
        'Never derive an ID from the session ID, a counter, another ID or a typed pattern',
        'Never reuse an ID for a different event or entity',
        'Never use the same-call form under background execution',
        '`WORK` is written inline, never through `eval`',
        'One governing `decision` per executed phase visit',
        'A `tests` decision made inside a pregate run carries the enclosing `pregate` step\'s `step_id`',
        'A `begin` or `end` is never replayed later',
      ]) expect(flat, `${skill}: missing rule text "${phrase}"`).toContain(phrase);
    });
    test(`${skill} carries the canonical span pattern and library lookup byte for byte`, () => {
      const body = metricsOf(skill);
      const wrapperSame = spanBlock(body, 'Same-call form').replace(/GX_STAGE='[a-z-]+'/, "GX_STAGE='review-and-prep'");
      expect(wrapperSame, `${skill}: the same-call pattern differs from docs/telemetry.md#workflow-metrics-span-same-call; update both in the same change`)
        .toBe(spanBlock(spanDocs, 'workflow-metrics-span-same-call').replace(/GX_STAGE='[a-z-]+'/, "GX_STAGE='review-and-prep'"));
      expect(wrapperSame).toContain(`GX_E=$-; set +e; ( set -e -o pipefail; WORK ); rc=$?; case "$GX_E" in *e*) set -e ;; esac`);
      expect(wrapperSame.trimEnd().endsWith('(exit "$rc")')).toBe(true);
      expect(spanBlock(body, 'print the library path to retain'), `${skill}: the library lookup differs from docs/telemetry.md`)
        .toBe(spanBlock(spanDocs, 'To obtain the retained library path'));
      const flat = body.replace(/\s+/g, ' ');
      expect(flat).toContain("gx_span_end 'STEP-FROM-THE-SPAN-LINE' \"$rc\" 'BEGIN-FROM-THE-SPAN-LINE'");
      expect(spanDocs.replace(/\s+/g, ' ')).toContain("gx_span_end 'STEP-FROM-THE-SPAN-LINE' \"$rc\" 'BEGIN-FROM-THE-SPAN-LINE'");
    });
    test(`${skill}'s Spans column is a closed list: every required site is mapped and every phase has a span site`, () => {
      const rows = siteRows(skill);
      const phasesOf = (text: string) => [...text.replace(/wait `[a-z-]+`/g, '').matchAll(/`([a-z][a-z-]*)`/g)].map(m => m[1]).filter(p => schemaPhases.includes(p));
      const spanned = new Set(rows.flatMap(r => phasesOf(r.spans)));
      for (const row of rows) for (const phase of phasesOf(row.phases)) {
        expect(spanned.has(phase), `${skill}: phase ${phase} (row ${row.anchors.join(', ')}) has no span site; add its anchor to the Spans column in the same change`).toBe(true);
      }
      for (const [phase, anchors] of Object.entries(requiredSites[skill])) {
        for (const anchor of anchors) {
          const hit = rows.find(r => r.anchors.includes(anchor) && phasesOf(r.spans).includes(phase));
          expect(hit, `${skill}: ${phase} needs a span under "${anchor}"`).toBeTruthy();
        }
      }
      for (const [phase, anchors] of Object.entries(longSites[skill])) {
        for (const anchor of anchors) {
          const hit = rows.find(r => r.anchors.includes(anchor) && r.spans.includes(`\`${phase}\` (cross-call)`));
          expect(hit, `${skill}: ${phase} under "${anchor}" is a long site and must be marked (cross-call)`).toBeTruthy();
        }
      }
      expect(rows.some(r => r.anchors.includes(skill === 'review-and-prep' ? '4. Trigger once and await Greptile' : 'Greptile and new feedback')
        && r.spans.includes('wait `external-review` (cross-call)')), `${skill}: the Greptile wait needs its span`).toBe(true);
      for (const row of rows) for (const anchor of row.anchors) {
        const headings = [...readFileSync(join(ROOT, 'skills', `${skill}.md`), 'utf8').matchAll(/^#{2,4} (.+)$/gm)].map(m => strip(m[1]));
        expect(headings, `${skill}: Spans row anchor ${anchor}`).toContain(anchor);
      }
    });
  }
  test('docs/telemetry.md states the span rules the wrappers point to, with stable anchors', () => {
    for (const anchor of ['workflow-metrics-span', 'workflow-metrics-boundary', 'workflow-metrics-no-backfill', 'workflow-metrics-replay',
      'workflow-metrics-ids', 'workflow-metrics-untimed', 'workflow-metrics-read-semantics', 'workflow-metrics-span-same-call',
      'workflow-metrics-span-cross-call', 'workflow-metrics-pregate-time', 'workflow-metrics-voice-begin',
      'workflow-metrics-isolation', 'workflow-metrics-id-shape', 'workflow-metrics-guard',
      ...['prefix-rewrite', 'appended-id', 'named-file', 'escaped-root', 'unexpected'].map(code => `workflow-metrics-guard-${code}`)]) {
      expect(DOCS, `docs/telemetry.md anchor ${anchor}`).toContain(`<a id="${anchor}"></a>`);
    }
    const flat = spanDocs.replace(/\s+/g, ' ');
    for (const phrase of ['Never write a `begin` or `end` for a boundary that has already passed or has not happened yet',
      "an ID's shape alone never classifies a row as synthetic", 'pregate\'s own `stage2_ms` and per-check `ms`',
      'consumers keyed on the old zero will see that change', 'The launcher has no `--version`']) expect(flat).toContain(phrase);
  });
  test('no other skill gained a workflow-metrics section', () => {
    for (const skill of EXPECTED_SETUP_SKILLS) {
      if (skill === 'review-and-prep' || skill === 'ship-and-land') continue;
      expect(readFileSync(join(ROOT, 'skills', `${skill}.md`), 'utf8')).not.toContain('### Workflow metrics (optional, local)');
    }
  });
  test('the helper phase vocabulary matches the published schema', () => {
    const py = readFileSync(join(ROOT, 'bin/lib/workflow_metrics.py'), 'utf8');
    const phasesLine = /PHASES = \(([^)]*)\)/.exec(py)![1];
    const pyPhases = [...phasesLine.matchAll(/"([^"]+)"/g)].map(m => m[1]);
    expect(pyPhases).toEqual(schemaPhases);
  });
});
