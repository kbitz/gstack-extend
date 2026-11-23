/**
 * skill-references.test.ts — budgets, pointer integrity, digests, capability
 * literals, inbound anchors, disposable-HOME install verification, and
 * conservation-script fixtures (Track 94I).
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { EXPECTED_SETUP_SKILLS as SKILLS } from './helpers/expected-setup-skills.ts';
import {
  ALLOWED_REF_PREFIXES,
  CORE_REFERENCE_RULE,
  MOVE_MANIFEST,
  applyManifestToSkill,
  checkConservation,
  closingMarkerFor,
  computeRefDigest,
  parseReadInstructions,
} from '../scripts/skill-references.ts';
import {
  CORE_BYTE_CAP,
  REFERENCE_BYTE_CAP,
  REFERENCE_LINE_CAP,
  REFERENCE_MAX_LINE_CHARS,
  REFERENCE_OUTPUT_BYTE_CAP,
  SKILL_BUDGETS,
} from './helpers/skill-budgets.ts';
import { scopedEnv } from './helpers/extend-root.ts';

const ROOT = resolve(import.meta.dir, '..');
const SKILLS_DIR = join(ROOT, 'skills');
const REFS_ROOT = join(SKILLS_DIR, 'references');
const SETUP = join(ROOT, 'setup');
const baseTmp = mkdtempSync(join(tmpdir(), 'gx-skill-refs-'));

afterAll(() => {
  rmSync(baseTmp, { recursive: true, force: true });
});

function skillPath(skill: string): string {
  return join(SKILLS_DIR, `${skill}.md`);
}

function listRefSkills(): string[] {
  if (!existsSync(REFS_ROOT)) return [];
  return readdirSync(REFS_ROOT)
    .filter((entry) => statSync(join(REFS_ROOT, entry)).isDirectory())
    .sort();
}

function listRefsForSkill(skill: string): string[] {
  const dir = join(REFS_ROOT, skill);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.md') && statSync(join(dir, entry)).isFile())
    .map((entry) => entry.slice(0, -3))
    .sort();
}

function slugifyHeading(heading: string): string {
  return heading
    .replace(/^#{1,6}\s+/, '')
    .trim()
    .toLowerCase()
    .replace(/[`'".,():/?!]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-');
}

function collectCoreHeadingAnchors(text: string): Set<string> {
  const anchors = new Set<string>();
  let open = '';
  for (const line of text.split('\n')) {
    const fence = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (!open) open = fence[1]![0]!;
      else if (fence[1]![0] === open && (fence[2] ?? '').trim() === '') open = '';
      continue;
    }
    if (open) continue;
    if (/^#{1,6} /.test(line)) anchors.add(slugifyHeading(line));
  }
  return anchors;
}

describe('skill size budgets (Track 94I)', () => {
  test('SKILL_BUDGETS covers every skill in setup SKILLS and enforces core and default-path budgets', () => {
    expect(Object.keys(SKILL_BUDGETS).sort()).toEqual([...SKILLS].sort());

    const violations: string[] = [];
    for (const skill of SKILLS) {
      const budget = SKILL_BUDGETS[skill];
      const coreContent = readFileSync(skillPath(skill), 'utf8');
      const coreBytes = Buffer.byteLength(coreContent, 'utf8');
      if (coreBytes > budget.coreBytes) {
        violations.push(
          `${skill}: core ${coreBytes} B exceeds budget ${budget.coreBytes} B (+${coreBytes - budget.coreBytes} B). Move conditional text to a reference (a budget raise needs the developer's word); see docs/skill-references.md.`,
        );
      }
      if (coreBytes > CORE_BYTE_CAP) {
        violations.push(
          `${skill}: core ${coreBytes} B exceeds hard cap ${CORE_BYTE_CAP} B (+${coreBytes - CORE_BYTE_CAP} B); see docs/skill-references.md.`,
        );
      }

      const refFiles = listRefsForSkill(skill);
      let totalRefBytes = 0;
      for (const ref of refFiles) {
        const refPath = join(REFS_ROOT, skill, `${ref}.md`);
        const refContent = readFileSync(refPath, 'utf8');
        const refBytes = Buffer.byteLength(refContent, 'utf8');
        const refLines = refContent === '' ? [] : refContent.replace(/\n$/, '').split('\n');
        const numberedOutput = refLines.map((line, index) => `${index + 1}: ${line}\n`).join('')
          + `REFERENCE_END ${skill}/${ref} lines=${refLines.length} digest=${computeRefDigest(refContent)}\n`;
        const outputBytes = Buffer.byteLength(numberedOutput);
        totalRefBytes += refBytes;
        if (refBytes > REFERENCE_BYTE_CAP) {
          violations.push(
            `skills/references/${skill}/${ref}.md: ${refBytes} B exceeds per-reference cap ${REFERENCE_BYTE_CAP} B (+${refBytes - REFERENCE_BYTE_CAP} B) — split by reader cluster; see docs/skill-references.md.`,
          );
        }
        if (outputBytes > REFERENCE_OUTPUT_BYTE_CAP) {
          violations.push(
            `skills/references/${skill}/${ref}.md: numbered preamble output ${outputBytes} B exceeds cap ${REFERENCE_OUTPUT_BYTE_CAP} B — split by reader cluster; see docs/skill-references.md.`,
          );
        }
        if (refLines.length > REFERENCE_LINE_CAP) {
          violations.push(
            `skills/references/${skill}/${ref}.md: ${refLines.length} lines exceeds cap ${REFERENCE_LINE_CAP} — split by reader cluster; see docs/skill-references.md.`,
          );
        }
        const maxLine = Math.max(...refLines.map((l) => l.length));
        if (maxLine > REFERENCE_MAX_LINE_CHARS) {
          violations.push(
            `skills/references/${skill}/${ref}.md: line length ${maxLine} exceeds ${REFERENCE_MAX_LINE_CHARS} chars; see docs/skill-references.md.`,
          );
        }
      }

      let defaultByHandBytes = coreBytes;
      for (const ref of budget.defaultByHandRefs) {
        defaultByHandBytes += Buffer.byteLength(readFileSync(join(REFS_ROOT, skill, `${ref}.md`), 'utf8'), 'utf8');
      }
      if (defaultByHandBytes > budget.defaultByHandBytes) {
        violations.push(
          `${skill}: default by-hand path ${defaultByHandBytes} B exceeds budget ${budget.defaultByHandBytes} B (+${defaultByHandBytes - budget.defaultByHandBytes} B); see docs/skill-references.md.`,
        );
      }

      if (refFiles.length > 0) {
        let orchBytes = coreBytes;
        for (const ref of budget.orchestratedDefaultRefs ?? []) {
          orchBytes += Buffer.byteLength(readFileSync(join(REFS_ROOT, skill, `${ref}.md`), 'utf8'), 'utf8');
        }
        // Visibility output for budget tracking.
        console.log(
          `[skill-budgets] ${skill}: core=${coreBytes}B/${budget.coreBytes}B totalRefs=${totalRefBytes}B (${refFiles.length} files) defaultByHand=${defaultByHandBytes}B/${budget.defaultByHandBytes}B orchestratedDefault=${orchBytes}B`,
        );
      }
    }

    expect(violations, violations.join('\n')).toEqual([]);
  });
});

describe('pointer integrity and reference structure (Track 94I)', () => {
  test('the core binds workflow metrics before its single per-segment reference read', () => {
    const core = readFileSync(skillPath('review-and-prep'), 'utf8');
    const instructions = parseReadInstructions(core).filter(({ ref }) => ref === 'conditional-workflow-metrics');
    expect(instructions).toHaveLength(1);
    expect(core).toContain('print the library path to retain as `GX_LIB`');
    expect(core.indexOf(instructions[0]!.line)).toBeGreaterThan(core.indexOf('print the library path to retain as `GX_LIB`'));
  });

  test('a reference failure at a cycle cap preserves a durable hold and cannot create a continuation', () => {
    const core = readFileSync(skillPath('review-and-prep'), 'utf8');
    const stop = core.split('### When /review stops at its cycle cap\n')[1]!;
    const guard = stop.split(' --ref conditional-cycle-cap ')[0]!;
    expect(guard).toContain('save the cap hold at that HEAD using `checkpoint stop`');
    expect(guard).toContain('<!-- review-and-prep:stopped:<full-sha> -->');
    expect(guard).toContain('`Full-review evidence: unavailable` and no continuation prompt');
    expect(guard).toContain('If posting fails, keep `STOPPED — review cycle cap` in the draft body');
    expect(core).toContain('Reconcile a recorded cap hold even when no stop comment was confirmed.');
  });

  test('plain post-audit classification loads its rules without the doc-audit-gap opt-in', () => {
    const core = readFileSync(skillPath('review-and-prep'), 'utf8');
    const instruction = parseReadInstructions(core).find(({ ref }) => ref === 'conditional-post-audit-classification');
    expect(instruction?.suffix).toEndWith('when the policy carries `post-audit=classify`');
    expect(core).toContain('Carry the accepted audit unchanged when every change qualifies for `owner=not-needed`.');
  });

  test('every slimmed core carries the exact reference rule, valid read instructions, matching digests, and valid references', () => {
    const violations: string[] = [];
    const refSkills = listRefSkills();

    for (const skill of refSkills.filter((name) => !(SKILLS as readonly string[]).includes(name))) {
      violations.push(`skills/references/${skill}: unknown skill directory; see docs/skill-references.md.`);
    }
    for (const skill of SKILLS) {
      const core = readFileSync(skillPath(skill), 'utf8');
      const instrs = parseReadInstructions(core);
      if ((instrs.length > 0 || refSkills.includes(skill)) && !core.includes(CORE_REFERENCE_RULE)) {
        violations.push(`skills/${skill}.md: missing exact CORE_REFERENCE_RULE beside preamble root rules; see docs/skill-references.md.`);
      }

      const referencedSet = new Set<string>();
      for (const instr of instrs) {
        if (instr.skill !== skill) {
          violations.push(`skills/${skill}.md: cross-skill reference to ${instr.skill}/${instr.ref} (single ownership violated); see docs/skill-references.md.`);
        }
        referencedSet.add(instr.ref);
        const refPath = join(REFS_ROOT, skill, `${instr.ref}.md`);
        if (!existsSync(refPath)) {
          violations.push(`skills/${skill}.md: dangling read instruction for missing ${relative(ROOT, refPath)}; see docs/skill-references.md.`);
          continue;
        }
        const refContent = readFileSync(refPath, 'utf8');
        const actualDigest = computeRefDigest(refContent);
        if (instr.digest !== actualDigest) {
          violations.push(
            `skills/${skill}.md: digest mismatch for ${skill}/${instr.ref} (core=${instr.digest}, actual=${actualDigest}); run bun scripts/skill-references.ts digests --write.`,
          );
        }
      }

      const readLines = new Set(instrs.map((instruction) => instruction.line));
      const remainder = core.replace(CORE_REFERENCE_RULE, '').split('\n').filter((line) => !readLines.has(line)).join('\n');
      if (remainder.includes('skills/references/') || /(?:^|\s)--ref\b/.test(remainder)) {
        violations.push(`skills/${skill}.md: names a reference outside the documented --ref command form; see docs/skill-references.md.`);
      }

      const dir = join(REFS_ROOT, skill);
      if (!refSkills.includes(skill)) continue;
      const entries = readdirSync(dir).sort();
      const diskRefs = new Set<string>();
      for (const entry of entries) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          violations.push(`${relative(ROOT, full)}: nested directory (references must be one level deep); see docs/skill-references.md.`);
          continue;
        }
        if (entry === 'SKILL.md') {
          violations.push(`${relative(ROOT, full)}: reference must never be named SKILL.md; see docs/skill-references.md.`);
          continue;
        }
        if (!entry.endsWith('.md')) {
          violations.push(`${relative(ROOT, full)}: non-markdown file in skills/references/${skill}/; see docs/skill-references.md.`);
          continue;
        }
        const refName = entry.slice(0, -3);
        diskRefs.add(refName);
        if (!ALLOWED_REF_PREFIXES.some((p) => refName.startsWith(p))) {
          violations.push(
            `${relative(ROOT, full)}: bad prefix (must start with one of ${ALLOWED_REF_PREFIXES.join(', ')}); see docs/skill-references.md.`,
          );
        }
        const content = readFileSync(full, 'utf8');
        const expectedMarker = closingMarkerFor(skill, refName);
        const trimmedLines = content.trimEnd().split('\n');
        if (trimmedLines[trimmedLines.length - 1] !== expectedMarker) {
          violations.push(
            `${relative(ROOT, full)}: missing or wrong closing marker (expected "${expectedMarker}"); see docs/skill-references.md.`,
          );
        }
        if (content.includes('--ref ') || content.includes('skills/references/')) {
          const withoutMarker = content.split(expectedMarker).join('');
          if (withoutMarker.includes('--ref ') || withoutMarker.includes('skills/references/')) {
            violations.push(`${relative(ROOT, full)}: nested reference pointer inside reference file; see docs/skill-references.md.`);
          }
        }
      }

      for (const refName of diskRefs) {
        if (!referencedSet.has(refName)) {
          violations.push(
            `skills/references/${skill}/${refName}.md: unreferenced reference (not named by any read instruction in skills/${skill}.md); see docs/skill-references.md.`,
          );
        }
      }
    }

    expect(violations, violations.join('\n')).toEqual([]);
  });

  test('the documented example uses a valid pointer to the example reference bytes', () => {
    const guide = readFileSync(join(ROOT, 'docs', 'skill-references.md'), 'utf8');
    const example = guide.split('## Worked example\n')[1]!.split('\n## Maintainer checklist')[0]!;
    const [core, reference] = [...example.matchAll(/^```markdown\n([\s\S]*?)^```$/gm)].map((match) => match[1]!);
    expect(core).toBeDefined();
    expect(reference).toBeDefined();
    const instructions = parseReadInstructions(core!);
    expect(instructions).toHaveLength(1);
    const [{ skill, ref, digest }] = instructions as [typeof instructions[number]];
    expect(reference!.trimEnd().endsWith(closingMarkerFor(skill, ref))).toBe(true);
    expect(digest).toBe(computeRefDigest(reference!));
  });
});

describe('machine-read capability literals and inbound anchors (Track 94I)', () => {
  const CAPABILITY_LITERALS = [
    'final-gate-repair=tests-docs',
    'full-suite=external',
    'parent-io=lean',
    'repair-review=behavior-changing',
    'repair-cycles=light',
    'test-gaps=record',
    'Narrow the pregate after an accepted pass',
    'delegate=<part>',
    'delegate=adversarial,red-team',
    'red-team=ensure',
    'specialists=fold',
    'documentation-scope=contracts',
    'first-cycle=overlap',
    'blocking=shown',
    'post-audit=classify',
    'run-state=record',
    'doc-audit-gap=auto',
  ] as const;

  test('every documented capability literal appears in review-and-prep core and in setup Codex rendering', () => {
    const core = readFileSync(skillPath('review-and-prep'), 'utf8');
    for (const lit of CAPABILITY_LITERALS) {
      expect(core, `core missing capability literal: ${lit}`).toContain(lit);
    }

    const home = mkdtempSync(join(baseTmp, 'codex-cap-'));
    const r = spawnSync(SETUP, ['--host', 'codex', '--quiet'], {
      env: scopedEnv(home),
      encoding: 'utf8',
    });
    expect(r.status, r.stderr).toBe(0);
    const codexCopy = readFileSync(join(home, '.codex', 'skills', 'review-and-prep', 'SKILL.md'), 'utf8');
    for (const lit of CAPABILITY_LITERALS) {
      expect(codexCopy, `Codex rendering missing capability literal: ${lit}`).toContain(lit);
    }
  });

  test('every skills/<skill>.md#<anchor> link in docs/ and tests/ resolves to a heading in that core', () => {
    const anchorsBySkill = new Map<string, Set<string>>();
    for (const skill of SKILLS) {
      anchorsBySkill.set(skill, collectCoreHeadingAnchors(readFileSync(skillPath(skill), 'utf8')));
    }

    const walk = (dir: string, acc: string[]): void => {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) walk(full, acc);
        else if (entry.endsWith('.md') || entry.endsWith('.ts')) acc.push(full);
      }
    };
    const files: string[] = [];
    walk(join(ROOT, 'docs'), files);
    walk(join(ROOT, 'tests'), files);

    const broken: string[] = [];
    const linkRe = /skills\/([a-z0-9-]+)\.md#([a-z0-9-]+)/g;
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(linkRe)) {
        const skill = m[1]!;
        const anchor = m[2]!;
        const anchors = anchorsBySkill.get(skill);
        if (!anchors) continue;
        if (!anchors.has(anchor)) {
          broken.push(`${relative(ROOT, file)}: skills/${skill}.md#${anchor}`);
        }
      }
    }
    expect(broken, broken.join('\n')).toEqual([]);
  });
});

describe('disposable-HOME install root resolution for references (Track 94I)', () => {
  for (const host of ['claude', 'codex'] as const) {
    test(`setup --host ${host} installs preamble that fetches every reference named by installed cores`, () => {
      const home = mkdtempSync(join(baseTmp, `install-${host}-`));
      const r = spawnSync(SETUP, ['--host', host, '--quiet'], {
        env: scopedEnv(home),
        encoding: 'utf8',
      });
      expect(r.status, r.stderr).toBe(0);

      const installedPreamble = join(home, '.gstack-extend', 'bin', 'preamble');
      expect(existsSync(installedPreamble)).toBe(true);

      for (const skill of listRefSkills()) {
        const installedCore = readFileSync(
          join(home, host === 'claude' ? '.claude' : '.codex', 'skills', skill, 'SKILL.md'),
          'utf8',
        );
        const instrs = parseReadInstructions(installedCore);
        expect(instrs.length).toBeGreaterThan(0);

        const seenRefs = new Set<string>();
        for (const instr of instrs) {
          if (seenRefs.has(instr.ref)) continue;
          seenRefs.add(instr.ref);
          const fetch = spawnSync(
            installedPreamble,
            [skill, '--ref', instr.ref, '--expect', instr.digest],
            { env: scopedEnv(home), encoding: 'utf8' },
          );
          expect(fetch.status, `${host} ${skill}/${instr.ref}: ${fetch.stdout}${fetch.stderr}`).toBe(0);
          expect(fetch.stdout).toContain(`REFERENCE_END ${skill}/${instr.ref} lines=`);
          expect(fetch.stdout).toContain(`digest=${instr.digest}`);
        }
      }
    });
  }
});

describe('scripts/skill-references.ts conservation fixtures (Track 94I)', () => {
  const sampleBase = [
    '# /sample',
    '',
    '<!-- SHARED:upgrade-flow -->',
    '<!-- /SHARED:upgrade-flow -->',
    '',
    '### Gate Alpha',
    '',
    'Keep this gate sentence in the core.',
    '',
    'Moved block A line 1.',
    'Moved block A line 2.',
    '',
    '### Gate Beta',
    '',
    'Keep this beta gate in the core.',
    '',
    'Moved block B line 1.',
    'Moved block B line 2.',
    '',
  ].join('\n');

  const sampleManifest = [
    {
      skill: 'sample',
      ref: 'conditional-sample',
      refTitle: 'Sample reference',
      sectionHeading: '### Gate Alpha',
      startMarker: 'Moved block A line 1.',
      endBeforeMarker: null,
      readInstructionSuffix: 'before Gate Alpha when alpha applies',
    },
    {
      skill: 'sample',
      ref: 'conditional-sample',
      refTitle: 'Sample reference',
      sectionHeading: '### Gate Beta',
      startMarker: 'Moved block B line 1.',
      endBeforeMarker: null,
      readInstructionSuffix: 'before Gate Beta when beta applies',
    },
  ] as const;

  test('clean apply passes conservation check', () => {
    const applied = applyManifestToSkill('sample', sampleBase, sampleManifest);
    const res = checkConservation('sample', sampleBase, applied.core, applied.references, sampleManifest);
    expect(res.ok, res.errors.join('\n')).toBe(true);
    expect(res.droppedLines).toEqual([]);
  });

  test('a dropped line fails conservation check', () => {
    const applied = applyManifestToSkill('sample', sampleBase, sampleManifest);
    const corruptedCore = applied.core.replace('Keep this gate sentence in the core.\n', '');
    const res = checkConservation('sample', sampleBase, corruptedCore, applied.references, sampleManifest);
    expect(res.ok).toBe(false);
    expect(res.droppedLines.some((l) => l.includes('Keep this gate sentence in the core.'))).toBe(true);
  });

  test('explicit navigation edits must match once and are verified in the generated reference', () => {
    const manifest = [
      { ...sampleManifest[0]!, navigationEdits: [['line 2', 'under Gate Alpha']] as const },
      sampleManifest[1]!,
    ];
    const applied = applyManifestToSkill('sample', sampleBase, manifest);
    expect(applied.references['conditional-sample']).toContain('Moved block A under Gate Alpha.');
    expect(checkConservation('sample', sampleBase, applied.core, applied.references, manifest).ok).toBe(true);
    expect(() => applyManifestToSkill('sample', sampleBase.replace('line 2.', 'another line.'), manifest))
      .toThrow('Expected one navigation edit');
  });

  test('a reordered block fails conservation check', () => {
    const applied = applyManifestToSkill('sample', sampleBase, sampleManifest);
    const swappedRef = [
      '# /sample reference: Sample reference',
      '',
      'Moved block B line 1.',
      'Moved block B line 2.',
      '',
      'Moved block A line 1.',
      'Moved block A line 2.',
      '',
      closingMarkerFor('sample', 'conditional-sample'),
      '',
    ].join('\n');
    const res = checkConservation('sample', sampleBase, applied.core, { 'conditional-sample': swappedRef }, sampleManifest);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes('reordered block'))).toBe(true);
  });

  test('a gate heading moved out of the core fails conservation check', () => {
    const applied = applyManifestToSkill('sample', sampleBase, sampleManifest);
    const missingHeadingCore = applied.core.replace('### Gate Alpha\n', '');
    const res = checkConservation('sample', sampleBase, missingHeadingCore, applied.references, sampleManifest);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes('section heading moved out of core'))).toBe(true);
  });

  test('moving a valid read command away from its original gate fails conservation check', () => {
    const applied = applyManifestToSkill('sample', sampleBase, sampleManifest);
    const [instruction] = parseReadInstructions(applied.core);
    const changedCore = applied.core.replace(`${instruction!.line}\n`, '') + `\n${instruction!.line}\n`;
    const result = checkConservation('sample', sampleBase, changedCore, applied.references, sampleManifest);
    expect(result.errors).toContain('unexpected core edits or read-instruction placement in skills/sample.md');
  });

  test('MOVE_MANIFEST has at least one entry for review-and-prep', () => {
    expect(MOVE_MANIFEST.some((m) => m.skill === 'review-and-prep')).toBe(true);
  });
});
