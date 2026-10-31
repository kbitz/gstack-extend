/**
 * autoplan-lean.test.ts — the /autoplan-lean helper and skill contract.
 *
 * Covers the plan-proper / sidecar split (path and SHA-256 in the plan), the
 * transport shape checks on a fixture plan and final message, reviewer
 * prompts that exclude earlier phases' raw outputs, and prompt-size records.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { main, sidecarPathFor, type CliIo } from '../src/autoplan-lean/cli.ts';
import { BOUNDARY, NATIVE_CRITERIA, OUTSIDE_CRITERIA, OUTSIDE_RESULT_CONTRACT, UPSTREAM, driftReport } from '../src/autoplan-lean/criteria.ts';
import { BUDGET_ALLOWANCE_BYTES, BUDGET_SOURCE_FACTOR, PHASES, changedLines, parseSettlements, planBudget, readSeal, settlementsSection, sha256, splitPlan, taskRefs } from '../src/autoplan-lean/plan.ts';
import { OUTSIDE_OUTPUT_FORMAT, SETTLEMENTS_NOTE, buildPrompt, parseSizeRecords } from '../src/autoplan-lean/prompt.ts';
import { outline, skipList } from '../src/autoplan-lean/outline.ts';
import { PROMPT_LABELS, STAGE_LINE, checkMessage, checkPlan, checkStageLine, handoffBlock } from '../src/autoplan-lean/transport.ts';

const ROOT = resolve(import.meta.dir, '..');
const FIXTURES = join(ROOT, 'tests', 'fixtures', 'autoplan-lean');
const SENTINELS = ['CEO-NATIVE-RAW-SENTINEL', 'CEO-OUTSIDE-RAW-SENTINEL', 'CEO-REVIEW-SENTINEL'];

let temp: string;
let plan: string;
let run: string;

function cli(...argv: string[]) {
  let stdout = '';
  let stderr = '';
  const io: CliIo = { stdout: (t) => { stdout += t; }, stderr: (t) => { stderr += t; }, cwd: temp };
  const code = main(argv, io);
  return { code, stdout, stderr };
}

const field = (out: string, key: string) => new RegExp(`^${key}: (.*)$`, 'm').exec(out)?.[1];
const reader = (path: string) => (existsSync(path) ? readFileSync(path) : undefined);

beforeEach(() => {
  temp = realpathSync(mkdtempSync(join(tmpdir(), 'autoplan-lean-')));
  plan = join(temp, 'track-plan.md');
  run = join(temp, 'run');
  cpSync(join(FIXTURES, 'plan.md'), plan);
  cpSync(join(FIXTURES, 'run'), run, { recursive: true });
});

afterEach(() => rmSync(temp, { recursive: true, force: true }));

describe('plan proper and sidecar split', () => {
  // Value: protects=review bytes stay private at creation, publication and archival; fails_when=sidecar
  // permissions inherit a permissive default or existing record; why_new=byte-integrity cases did not
  // inspect permissions; seam=none; no_claim=ACLs, concurrent writers or crash durability.
  for (const planMode of [0o600, 0o640]) {
    test(`private sidecars, staging and archives preserve plan mode ${planMode.toString(8)}`, () => {
      const oldMask = process.umask(0);
      const sidecar = sidecarPathFor(plan);
      fs.chmodSync(temp, 0o755);
      fs.chmodSync(plan, planMode);
      const rename = fs.renameSync;
      const stagedModes: number[] = [];
      const observe = spyOn(fs, 'renameSync').mockImplementation((from, to) => {
        if (to === sidecar) stagedModes.push(fs.statSync(from).mode & 0o777);
        return rename(from, to);
      });
      try {
        expect(cli('seal', '--plan', plan, '--run', run).code).toBe(0);
        expect(stagedModes).toEqual([0o600]);
        expect(fs.statSync(sidecar).mode & 0o777).toBe(0o600);
        expect(fs.statSync(plan).mode & 0o777).toBe(planMode);
        // A previously permissive sidecar must not broaden the next record or its backup.
        fs.chmodSync(sidecar, 0o644);
        const reseal = cli('seal', '--plan', plan, '--run', run);
        expect(reseal.code).toBe(0);
        expect(stagedModes).toEqual([0o600, 0o600]);
        expect(fs.statSync(sidecar).mode & 0o777).toBe(0o600);
        expect(fs.statSync(field(reseal.stdout, 'PREVIOUS')!).mode & 0o777).toBe(0o600);
        expect(fs.statSync(plan).mode & 0o777).toBe(planMode);
        expect(cli('check', '--plan', plan).code).toBe(0);
      } finally {
        observe.mockRestore();
        process.umask(oldMask);
      }
    });
  }

  test('seal writes the sidecar beside the plan and names its path, SHA-256 and size', () => {
    const r = cli('seal', '--plan', plan, '--run', run);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    const sidecar = join(temp, 'track-plan.review-record.md');
    expect(sidecarPathFor(plan)).toBe(sidecar);
    expect(field(r.stdout, 'SIDECAR')).toBe(sidecar);
    const bytes = readFileSync(sidecar);
    expect(field(r.stdout, 'SHA256')).toBe(sha256(bytes));

    const sealed = readFileSync(plan, 'utf8');
    expect(field(r.stdout, 'PLAN_SHA256')).toBe(sha256(Buffer.from(sealed)));
    expect(field(r.stdout, 'PLAN_BYTES')).toBe(String(Buffer.byteLength(sealed)));
    const parts = splitPlan(sealed);
    expect(readSeal(parts.record)).toEqual({ path: sidecar, sha256: sha256(bytes), bytes: bytes.byteLength });
    // The record sits between the plan proper and the report, which stays last.
    expect(sealed.indexOf('## Review record')).toBeGreaterThan(sealed.indexOf('## Implementation tasks'));
    expect(sealed.indexOf('## Review record')).toBeLessThan(sealed.indexOf('## GSTACK REVIEW REPORT'));
    // The plan proper is byte-identical to the unsealed plan's.
    expect(parts.proper).toBe(splitPlan(readFileSync(join(FIXTURES, 'plan.md'), 'utf8')).proper);
  });

  test('the sidecar holds the review record and the plan holds none of it', () => {
    writeFileSync(join(run, 'dx-review.md'), 'DX native unavailable [single-model].\n');
    cli('seal', '--plan', plan, '--run', run);
    const sidecar = readFileSync(join(temp, 'track-plan.review-record.md'), 'utf8');
    for (const s of SENTINELS) expect(sidecar).toContain(s);
    expect(sidecar).toContain('<!-- autoplan-lean:raw ceo native -->');
    expect(sidecar).toContain('<!-- autoplan-lean:raw ceo outside -->');
    expect(sidecar).toContain('| 1 | eng | Stream rows |');
    expect(sidecar).toContain('## Phase 3: Eng review\n\n_Not run');
    expect(sidecar).toContain('## Phase 2.5: DX review\n\nDX native unavailable [single-model].\n\n### Native voice output (raw)\n\n_No native output file');
    const sealed = readFileSync(plan, 'utf8');
    for (const s of SENTINELS) expect(sealed).not.toContain(s);
  });

  test('re-seal keeps the previously sealed record; a foreign sidecar refuses', () => {
    const first = cli('seal', '--plan', plan, '--run', run);
    const firstHash = field(first.stdout, 'SHA256')!;
    writeFileSync(join(run, 'gate.md'), 'Approved as-is (auto-choose).\n');
    const second = cli('seal', '--plan', plan, '--run', run);
    expect(second.code).toBe(0);
    const archive = join(temp, `track-plan.review-record.${firstHash.slice(0, 12)}.md`);
    expect(field(second.stdout, 'PREVIOUS')).toBe(archive);
    expect(sha256(readFileSync(archive))).toBe(firstHash);
    expect(readFileSync(join(temp, 'track-plan.review-record.md'), 'utf8')).toContain(`Previous record: \`${archive}\``);
    expect(readFileSync(plan, 'utf8').match(/^## Review record$/gm)).toHaveLength(1);

    const other = join(temp, 'other.md');
    cpSync(join(FIXTURES, 'plan.md'), other);
    writeFileSync(join(temp, 'other.review-record.md'), 'someone else\n');
    const refused = cli('seal', '--plan', other, '--run', run);
    expect(refused.code).toBe(3);
    expect(refused.stderr).toContain('ERROR SIDECAR_EXISTS');
    expect(readFileSync(join(temp, 'other.review-record.md'), 'utf8')).toBe('someone else\n');
    expect(cli('seal', '--plan', other, '--run', run, '--replace').code).toBe(0);
  });

  test('seal refuses symlinked plans and a plan proper carrying raw output', () => {
    const link = join(temp, 'link.md');
    symlinkSync(plan, link);
    expect(cli('seal', '--plan', link, '--run', run).stderr).toContain('ERROR UNSAFE_PATH');
    writeFileSync(plan, readFileSync(plan, 'utf8').replace('## Implementation tasks', `INPUT: ceo ${'a'.repeat(64)}\n\n## Implementation tasks`));
    const r = cli('seal', '--plan', plan, '--run', run);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain('ERROR RAW_OUTPUT_IN_PLAN');
    expect(existsSync(join(temp, 'track-plan.review-record.md'))).toBe(false);
  });

  test('seal ignores files outside the fixed run-file list', () => {
    writeFileSync(join(run, 'notes.md'), 'STRAY-SENTINEL\n');
    cli('seal', '--plan', plan, '--run', run);
    expect(readFileSync(join(temp, 'track-plan.review-record.md'), 'utf8')).not.toContain('STRAY-SENTINEL');
  });

  // Generated by /ship coverage audit.
  // Value: protects=re-seal never overwrites an archived sidecar with different bytes and leaves plan, sidecar
  //   and archive untouched; fails_when=the archive-hash guard is removed or archive is renamed over;
  //   why_new=only the clean re-seal path was tested; seam=none; no_claim=none beyond protects
  test('re-seal refuses when the archive name is taken by different content, changing nothing', () => {
    const first = cli('seal', '--plan', plan, '--run', run);
    const hash = field(first.stdout, 'SHA256')!;
    const sidecar = join(temp, 'track-plan.review-record.md');
    const archive = join(temp, `track-plan.review-record.${hash.slice(0, 12)}.md`);
    writeFileSync(archive, 'an unrelated earlier record\n');
    const before = { plan: readFileSync(plan, 'utf8'), sidecar: readFileSync(sidecar, 'utf8') };
    writeFileSync(join(run, 'gate.md'), 'Approved as-is (auto-choose).\n');
    const r = cli('seal', '--plan', plan, '--run', run);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain(`ERROR SIDECAR_EXISTS: ${archive} exists with different content`);
    expect(r.stdout).toBe('');
    expect(readFileSync(archive, 'utf8')).toBe('an unrelated earlier record\n');
    expect(readFileSync(sidecar, 'utf8')).toBe(before.sidecar);
    expect(readFileSync(plan, 'utf8')).toBe(before.plan);
  });

  for (const invalid of ['malformed sizes', 'unsafe run file'] as const) {
    test(`failed re-seal preserves the valid sealed pair: ${invalid}`, () => {
      expect(cli('seal', '--plan', plan, '--run', run).code).toBe(0);
      const sidecar = sidecarPathFor(plan);
      const before = { plan: readFileSync(plan), sidecar: readFileSync(sidecar), files: readdirSync(temp).sort() };
      if (invalid === 'malformed sizes') writeFileSync(join(run, 'prompt-sizes.jsonl'), '{not JSON}\n');
      else symlinkSync(plan, join(run, 'gate.md'));

      const failed = cli('seal', '--plan', plan, '--run', run);
      expect(failed.code).not.toBe(0);
      expect(failed.stderr).toContain(invalid === 'malformed sizes' ? 'JSON Parse error' : 'UNSAFE_PATH');
      expect(readFileSync(plan)).toEqual(before.plan);
      expect(readFileSync(sidecar)).toEqual(before.sidecar);
      expect(readdirSync(temp).sort()).toEqual(before.files);
      expect(cli('check', '--plan', plan).code).toBe(0);
    });
  }

  test('failed re-seal plan publication restores the prior sidecar and leaves the plan valid', () => {
    expect(cli('seal', '--plan', plan, '--run', run).code).toBe(0);
    const sidecar = sidecarPathFor(plan);
    const before = { plan: readFileSync(plan), sidecar: readFileSync(sidecar) };
    writeFileSync(join(run, 'gate.md'), 'Approved after another review.\n');
    const rename = fs.renameSync;
    let sawNewSidecar = false;
    const failure = spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (to === plan) {
        sawNewSidecar = !readFileSync(sidecar).equals(before.sidecar);
        throw Object.assign(new Error('injected plan rename EIO'), { code: 'EIO' });
      }
      return rename(from, to);
    });
    let failed: ReturnType<typeof cli>;
    try { failed = cli('seal', '--plan', plan, '--run', run); }
    finally { failure.mockRestore(); }
    expect(sawNewSidecar).toBe(true);
    expect(failed!.code).not.toBe(0);
    expect(failed!.stderr).toContain('injected plan rename EIO');
    expect(readFileSync(plan)).toEqual(before.plan);
    expect(readFileSync(sidecar)).toEqual(before.sidecar);
    expect(readdirSync(temp).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(cli('check', '--plan', plan).code).toBe(0);
  });

  test('failed re-seal staging leaves the pair untouched and removes incomplete temp files', () => {
    expect(cli('seal', '--plan', plan, '--run', run).code).toBe(0);
    const sidecar = sidecarPathFor(plan);
    const before = { plan: readFileSync(plan), sidecar: readFileSync(sidecar), files: readdirSync(temp).sort() };
    const sync = fs.fsyncSync;
    let calls = 0;
    const failure = spyOn(fs, 'fsyncSync').mockImplementation((fd) => {
      if (++calls === 2) throw new Error('injected staged-plan flush failure');
      return sync(fd);
    });
    let failed: ReturnType<typeof cli>;
    try { failed = cli('seal', '--plan', plan, '--run', run); }
    finally { failure.mockRestore(); }
    expect(failed!.code).not.toBe(0);
    expect(failed!.stderr).toContain('injected staged-plan flush failure');
    expect(readFileSync(plan)).toEqual(before.plan);
    expect(readFileSync(sidecar)).toEqual(before.sidecar);
    expect(readdirSync(temp).sort()).toEqual(before.files);
    expect(cli('check', '--plan', plan).code).toBe(0);
  });

  for (const cleanupFails of [false, true]) {
    test(`failed re-seal restoration retains exact recovery bytes and reports their path (cleanup failure: ${cleanupFails})`, () => {
      expect(cli('seal', '--plan', plan, '--run', run).code).toBe(0);
      const sidecar = sidecarPathFor(plan);
      const before = { plan: readFileSync(plan), sidecar: readFileSync(sidecar) };
      const rename = fs.renameSync;
      let sidecarRenames = 0;
      const failure = spyOn(fs, 'renameSync').mockImplementation((from, to) => {
        if (to === plan) throw new Error('injected plan rename failure');
        if (to === sidecar && ++sidecarRenames === 2) throw new Error('injected restore failure');
        return rename(from, to);
      });
      const remove = fs.rmSync;
      const cleanupFailure = cleanupFails ? spyOn(fs, 'rmSync').mockImplementation((path, options) => {
        if (String(path).endsWith('.tmp')) throw new Error('injected cleanup failure');
        return remove(path, options);
      }) : undefined;
      let failed: ReturnType<typeof cli>;
      try { failed = cli('seal', '--plan', plan, '--run', run); }
      finally { failure.mockRestore(); cleanupFailure?.mockRestore(); }
      expect(failed!.code).toBe(1);
      expect(failed!.stderr).toContain('ERROR SEAL_RECOVERY_FAILED');
      expect(failed!.stderr).toContain('injected plan rename failure');
      expect(failed!.stderr).toContain('injected restore failure');
      expect(readFileSync(plan)).toEqual(before.plan);
      const retained = readdirSync(temp).filter((name) => name.endsWith('.tmp'));
      expect(retained).toHaveLength(cleanupFails ? 2 : 1);
      const backup = retained.map((name) => join(temp, name)).find((path) => readFileSync(path).equals(before.sidecar))!;
      expect(readFileSync(backup)).toEqual(before.sidecar);
      expect(fs.statSync(backup).mode & 0o077).toBe(0);
      expect(fs.statSync(sidecar).mode & 0o077).toBe(0);
      expect(failed!.stderr).toContain(`restore ${sidecar} from ${backup}`);
      if (cleanupFails) expect(failed!.stderr).toContain('WARNING: could not remove staging file');
      rename(backup, sidecar);
      expect(cli('check', '--plan', plan).code).toBe(0);
    });
  }

  // Generated by /ship coverage audit.
  // Value: protects=proper writes exactly the plan proper, and --upstream-layout wraps it in the headings
  //   upstream scope tools read; a symlinked --out refuses; fails_when=proper leaks the record/report, the
  //   wrapper changes, or writes go through a symlink; why_new=proper had no test; seam=none;
  //   no_claim=upstream scope tool acceptance of the wrapped file (not run here)
  test('proper writes only the plan proper; --upstream-layout wraps it; a symlinked --out refuses', () => {
    expect(cli('seal', '--plan', plan, '--run', run).code).toBe(0);
    const expected = splitPlan(readFileSync(join(FIXTURES, 'plan.md'), 'utf8')).proper;
    const out = join(run, 'proper.md');
    const plain = cli('proper', '--plan', plan, '--out', out);
    expect(plain.code).toBe(0);
    expect(readFileSync(out, 'utf8')).toBe(expected);
    expect(field(plain.stdout, 'BYTES')).toBe(String(Buffer.byteLength(expected)));

    const scope = join(run, 'scope-input.md');
    expect(cli('proper', '--plan', plan, '--out', scope, '--upstream-layout').code).toBe(0);
    const wrapped = readFileSync(scope, 'utf8');
    expect(wrapped).toBe(`## Implementation plan\n${expected}## Review record\n`);
    expect(wrapped).not.toContain('GSTACK REVIEW REPORT');
    expect(wrapped).not.toContain('review-record.md');

    const target = join(temp, 'elsewhere.md');
    writeFileSync(target, 'keep\n');
    symlinkSync(target, join(run, 'linked.md'));
    const refused = cli('proper', '--plan', plan, '--out', join(run, 'linked.md'));
    expect(refused.code).toBe(3);
    expect(refused.stderr).toContain('ERROR UNSAFE_PATH');
    expect(readFileSync(target, 'utf8')).toBe('keep\n');
  });
});

describe('transport contract shape', () => {
  const sealedPlan = () => {
    expect(cli('seal', '--plan', plan, '--run', run).code).toBe(0);
    return readFileSync(plan, 'utf8');
  };
  const problems = (text: string) => checkPlan(Buffer.from(text), reader);

  test('the sealed fixture plan and both fixture messages pass', () => {
    const text = sealedPlan();
    expect(problems(text)).toEqual([]);
    // Fixture messages carry example hashes, so they prove the format layer;
    // the bound cli check below builds its message from real seal output.
    expect(checkMessage(readFileSync(join(FIXTURES, 'final-message.md'), 'utf8'))).toEqual([]);
    expect(checkMessage(readFileSync(join(FIXTURES, 'final-message-fenced.md'), 'utf8'))).toEqual([]);
  });

  const STAGE_HEAD = '0123456789abcdef0123456789abcdef01234567';
  // The stage line binds to the sealed plan itself, so a test that stales the prompt's own fields keeps a good line.
  const stageLine = (planSha: string, head = STAGE_HEAD, fields = 'stage: plan; next: implement; status: done') =>
    `Stage handoff: stage-handoff/v1; ${fields}; head: ${head}; plan-sha256: ${planSha}`;
  const boundMessage = (sealOut: string, over: Record<string, string> = {}) => {
    const values: Record<string, string> = {
      planPath: plan,
      planSha: field(sealOut, 'PLAN_SHA256')!,
      sidecar: field(sealOut, 'SIDECAR')!,
      sidecarSha: field(sealOut, 'SHA256')!,
      tier: 'standard',
      verify: '`bun run test`',
      stage: stageLine(field(sealOut, 'PLAN_SHA256')!),
      ...over,
    };
    return [
      'DONE', '', '```text', `Run /implement ${values.planPath}`, '',
      `Workspace: ${temp} — continue in this same workspace`,
      'Branch: feature/x; target base: origin/main; HEAD: 0123456789abcdef0123456789abcdef01234567',
      'Work state: clean working tree',
      `Plan: ${values.planPath}; SHA-256: ${values.planSha}; Tier: ${values.tier}`,
      `Review record: ${values.sidecar}; SHA-256: ${values.sidecarSha}`,
      'Approved scope: Export widgets as CSV; approved as-is',
      'Spec: none', 'Test plan: in plan', `Verify command: ${values.verify}`, 'Preserve: none', '',
      'Auto-decisions:', '- none', '```', ...(values.stage ? [values.stage] : []), '',
    ].join('\n');
  };

  test('check binds the prompt to the sealed plan it checks', () => {
    const seal = cli('seal', '--plan', plan, '--run', run);
    expect(seal.code).toBe(0);
    const msg = join(temp, 'bound.md');
    const check = (text: string) => {
      writeFileSync(msg, text);
      return cli('check', '--plan', plan, '--message', msg);
    };
    const ok = check(boundMessage(seal.stdout));
    expect(ok.code).toBe(0);
    expect(field(ok.stdout, 'CHECK')).toBe('ok');

    const stale: Array<[string, Record<string, string>, string]> = [
      ['stale plan hash', { planSha: '0'.repeat(64) }, 'does not match the checked plan'],
      ['stale sidecar hash', { sidecarSha: '0'.repeat(64) }, 'does not match the checked plan'],
      ['different sidecar path', { sidecar: '/tmp/other.review-record.md' }, 'does not match the checked plan'],
      ['wrong Tier', { tier: 'novel' }, 'does not match the checked plan'],
      ['divergent Verify command', { verify: '`bun run other`' }, 'does not match the checked plan'],
      ['different plan path', { planPath: '/tmp/elsewhere.md' }, 'does not match the checked plan'],
    ];
    for (const [name, over, expected] of stale) {
      const r = check(boundMessage(seal.stdout, over));
      expect(r.code, name).toBe(1);
      expect(r.stdout, name).toContain(expected);
      expect(field(r.stdout, 'CHECK'), name).toBe('fail');
    }
  });

  describe('the trailing stage handoff line', () => {
    const sealed = () => {
      const seal = cli('seal', '--plan', plan, '--run', run);
      expect(seal.code).toBe(0);
      return seal.stdout;
    };
    const planSha = (out: string) => field(out, 'PLAN_SHA256')!;
    const checkText = (text: string) => {
      const msg = join(temp, 'stage-bound.md');
      writeFileSync(msg, text);
      return cli('check', '--plan', plan, '--message', msg);
    };
    const without = (text: string) => text.split('\n').filter((l) => !l.startsWith('Stage handoff:')).join('\n');

    test('a well-formed line after the fence passes the CLI, checkMessage and checkStageLine', () => {
      const out = sealed();
      const text = boundMessage(out);
      const r = checkText(text);
      expect([r.code, field(r.stdout, 'CHECK')]).toEqual([0, 'ok']);
      expect(checkMessage(text)).toEqual([]);
      expect(checkStageLine(text)).toEqual([]);
      // Blank lines between the fence and the line are not text after the block.
      expect(checkMessage(text.replace('```\nStage', '```\n\n\nStage'))).toEqual([]);
      // done-with-concerns is the other status a handoff prompt goes with.
      expect(checkText(boundMessage(out, { stage: stageLine(planSha(out), STAGE_HEAD, 'stage: plan; next: implement; status: done-with-concerns') })).code).toBe(0);
    });

    test('checkMessage ignores exactly one line and checkStageLine is not needed to read the block', () => {
      const text = boundMessage(sealed());
      expect(handoffBlock(text)!.at(-1)).toBe('- none');
      expect(handoffBlock(without(text))!.at(-1)).toBe('- none');
      expect(checkMessage(without(text))).toEqual([]);
    });

    test('a missing line fails at the CLI and in checkStageLine, naming the line', () => {
      const text = without(boundMessage(sealed()));
      const r = checkText(text);
      expect([r.code, field(r.stdout, 'CHECK')]).toEqual([1, 'fail']);
      expect(r.stdout).toContain('does not end with a "Stage handoff: stage-handoff/v1; ..." line');
      expect(checkMessage(text)).toEqual([]);
    });

    test('a malformed line fails: every field is required and lower case', () => {
      const out = sealed();
      const good = stageLine(planSha(out));
      for (const bad of [
        good.replace('; plan-sha256: ' + planSha(out), ''),
        good.replace('status: done', 'status: DONE'),
        good.replace('stage-handoff/v1', 'stage-handoff/v2'),
        good.replace('stage: plan', 'stage: planning'),
        good.replace(STAGE_HEAD, 'abc123'),
        good + ';',
        good.replace('Stage handoff:', 'stage handoff:'),
      ]) {
        const r = checkText(boundMessage(out, { stage: bad }));
        expect(r.code, bad).toBe(1);
        expect(r.stdout, bad).toMatch(/PROBLEM: message: (the stage handoff line is malformed|the final message does not end with a "Stage handoff)/);
      }
      expect(STAGE_LINE.test(good)).toBe(true);
    });

    test('two lines, or prose after the line, fail', () => {
      const out = sealed();
      const text = boundMessage(out);
      const twice = checkText(text + stageLine(planSha(out)) + '\n');
      expect(twice.code).toBe(1);
      expect(twice.stdout).toContain('carries 2 stage handoff lines');
      expect(checkMessage(text + stageLine(planSha(out)) + '\n').join('\n')).toContain('does not end with a block');
      const prose = checkText(text + 'Thanks!\n');
      expect(prose.code).toBe(1);
      expect(prose.stdout).toContain('malformed or not the last line');
      expect(checkMessage(text + 'Thanks!\n').join('\n')).toContain('does not end with a block');
    });

    test('a line inside the fence, or before the block, is not the trailing line', () => {
      const out = sealed();
      const line = stageLine(planSha(out));
      const inside = boundMessage(out, { stage: '' }).replace('```\n', `${line}\n\`\`\`\n`);
      expect(checkText(inside).code).toBe(1);
      expect(checkText(line + '\n' + boundMessage(out, { stage: '' })).code).toBe(1);
    });

    test('a stale plan-sha256 or a head that is not the prompt\'s Branch HEAD fails', () => {
      const out = sealed();
      const stale = checkText(boundMessage(out, { stage: stageLine('0'.repeat(64)) }));
      expect(stale.code).toBe(1);
      expect(stale.stdout).toContain('plan-sha256 does not match the checked plan');
      const moved = checkText(boundMessage(out, { stage: stageLine(planSha(out), 'f'.repeat(40)) }));
      expect(moved.code).toBe(1);
      expect(moved.stdout).toContain("does not match the prompt's Branch HEAD");
      const none = checkText(boundMessage(out, { stage: stageLine(planSha(out), 'none') }));
      expect(none.code).toBe(1);
      expect(none.stdout).toContain("does not match the prompt's Branch HEAD");
    });

    test('the line must belong to this stage: plan, then implement, with a status a prompt goes with', () => {
      const out = sealed();
      for (const [fields, expected] of [
        ['stage: implement; next: implement; status: done', 'names stage implement'],
        ['stage: plan; next: none; status: done', 'names next none'],
        ['stage: plan; next: implement; status: blocked', 'has status blocked'],
        ['stage: plan; next: implement; status: stopped', 'has status stopped'],
      ] as const) {
        const r = checkText(boundMessage(out, { stage: stageLine(planSha(out), STAGE_HEAD, fields) }));
        expect(r.code, fields).toBe(1);
        expect(r.stdout, fields).toContain(expected);
      }
    });

    test('without a binding, checkStageLine still checks shape but cannot compare the plan', () => {
      const out = sealed();
      expect(checkStageLine(boundMessage(out, { stage: stageLine('0'.repeat(64)) }))).toEqual([]);
      expect(checkStageLine('nothing here\n')[0]).toContain('does not end with a "Stage handoff');
    });
  });

  test('check fails closed when the plan Verify lines disagree', () => {
    writeFileSync(plan, readFileSync(plan, 'utf8').replace('Verify command: `bun run test`', 'Verify command: `bun run test`\nVerify command: `bun run other`'));
    const seal = cli('seal', '--plan', plan, '--run', run);
    expect(seal.code).toBe(0);
    const msg = join(temp, 'bound.md');
    writeFileSync(msg, boundMessage(seal.stdout, { planSha: '0'.repeat(64) }));
    const r = cli('check', '--plan', plan, '--message', msg);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('cannot bind the /implement prompt to the checked plan');
  });

  test('check fails closed when a bullet Verify line diverges from the standalone one', () => {
    writeFileSync(plan, readFileSync(plan, 'utf8').replace('Verify command: `bun run test`', 'Verify command: `bun run test`\n- Verify: `bun run evil`'));
    const seal = cli('seal', '--plan', plan, '--run', run);
    expect(seal.code).toBe(0);
    const msg = join(temp, 'bound.md');
    writeFileSync(msg, boundMessage(seal.stdout));
    const r = cli('check', '--plan', plan, '--message', msg);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('cannot bind the /implement prompt to the checked plan');
  });

  test('check fails closed when a loose Tier or heading Verify diverges', () => {
    for (const extra of ['*Tier*: novel', '### Verify command: `bun run evil`', '> - Tier: novel', '> - **Tier:** novel']) {
      rmSync(sidecarPathFor(plan), { force: true });
      writeFileSync(plan, readFileSync(join(FIXTURES, 'plan.md'), 'utf8').replace('Tier: standard', `Tier: standard\n${extra}`));
      const seal = cli('seal', '--plan', plan, '--run', run);
      expect(seal.code, extra).toBe(0);
      const msg = join(temp, 'bound.md');
      writeFileSync(msg, boundMessage(seal.stdout));
      const r = cli('check', '--plan', plan, '--message', msg);
      expect(r.code, extra).toBe(1);
      expect(r.stdout, extra).toContain('cannot bind the /implement prompt to the checked plan');
    }
  });

  test('a bold-colon Verify label in the plan binds to its plain value', () => {
    writeFileSync(plan, readFileSync(plan, 'utf8').replace('Verify command: `bun run test`', '**Verify command:** `bun run test`'));
    const seal = cli('seal', '--plan', plan, '--run', run);
    expect(seal.code).toBe(0);
    const msg = join(temp, 'bound.md');
    writeFileSync(msg, boundMessage(seal.stdout));
    const r = cli('check', '--plan', plan, '--message', msg);
    expect(r.code).toBe(0);
    expect(field(r.stdout, 'CHECK')).toBe('ok');
  });

  test('fenced Tier and Verify examples in the plan do not bind', () => {
    writeFileSync(plan, readFileSync(plan, 'utf8').replace('## Acceptance criteria', 'Example:\n\n```\nTier: novel\nVerify command: `bun run evil`\n```\n\n## Acceptance criteria'));
    const seal = cli('seal', '--plan', plan, '--run', run);
    expect(seal.code).toBe(0);
    const msg = join(temp, 'bound.md');
    writeFileSync(msg, boundMessage(seal.stdout));
    const r = cli('check', '--plan', plan, '--message', msg);
    expect(r.code).toBe(0);
    expect(field(r.stdout, 'CHECK')).toBe('ok');
  });

  test('a bound Verify command containing an angle span passes verbatim', () => {
    writeFileSync(plan, readFileSync(plan, 'utf8').replace('Verify command: `bun run test`', 'Verify command: bun test --grep <pattern>'));
    const seal = cli('seal', '--plan', plan, '--run', run);
    expect(seal.code).toBe(0);
    const msg = join(temp, 'bound.md');
    writeFileSync(msg, boundMessage(seal.stdout, { verify: 'bun test --grep <pattern>' }));
    const r = cli('check', '--plan', plan, '--message', msg);
    expect(r.code).toBe(0);
    expect(field(r.stdout, 'CHECK')).toBe('ok');
  });

  test('an unsealed plan fails: no review record', () => {
    expect(problems(readFileSync(plan, 'utf8'))).toContain('expected one unfenced ## Review record section, found 0');
  });

  const mutations: Array<[string, (t: string) => string, string]> = [
    ['criteria list starts at 2', (t) => t.replace('1. `widget export', '2. `widget export').replace('2. A write', '3. A write').replace('3. Existing', '4. Existing'), 'acceptance-criteria'],
    ['criteria only after the review record', (t) => t.replace('## Acceptance criteria', '## Criteria'), 'acceptance-criteria'],
    ['tier inline, not standalone', (t) => t.replace('Tier: standard\n', 'Effort is moderate. **Tier:** standard\n'), 'standalone "Tier'],
    ['tiers disagree', (t) => t.replace('Verify command:', '- Tier: novel\nVerify command:'), 'Tier lines disagree'],
    ['no verify command', (t) => t.replace(/^Verify command: .*\n/m, ''), 'Verify command'],
    ['a second task list', (t) => t.replace('## Review record', '### Implementation Tasks from eng\n\n- [ ] dup\n\n## Review record'), 'implementation-tasks heading'],
    ['report not last', (t) => `${t}\n## Appendix\n\nmore\n`, 'last ## heading'],
    ['sidecar edited after seal', (t) => { writeFileSync(join(temp, 'track-plan.review-record.md'), 'tampered\n'); return t; }, 'does not match the recorded SHA-256'],
    ['sidecar missing', (t) => { rmSync(join(temp, 'track-plan.review-record.md')); return t; }, 'missing or not a regular file'],
    ['raw output in the plan proper', (t) => t.replace('## Implementation tasks', 'ENG DUAL VOICES — CONSENSUS TABLE:\n\n## Implementation tasks'), 'contains review output'],
    ['criteria inside a fence', (t) => t.replace('## Acceptance criteria\n', '```\n## Acceptance criteria\n').replace('3. Existing `widget list` output is unchanged.\n', '3. Existing `widget list` output is unchanged.\n```\n'), 'acceptance-criteria'],
    // Generated by /ship coverage audit.
    // Value: protects=check verifies the sealed byte count and that the record names a sidecar, once;
    //   fails_when=the Bytes comparison, the missing-path guard or the single-record count is dropped;
    //   why_new=only hash mismatch and a missing sidecar file were tested; seam=none; no_claim=none beyond protects
    ['recorded byte count edited', (t) => t.replace(/^- Bytes: (\d+)$/m, (_, n: string) => `- Bytes: ${Number(n) + 1}`), 'does not match the recorded byte count'],
    ['record names no sidecar path', (t) => t.replace(/^- Sidecar: .*\n/m, ''), 'does not name the sidecar path and SHA-256'],
    ['a second review record', (t) => t.replace('## GSTACK REVIEW REPORT', '## Review record\n\n## GSTACK REVIEW REPORT'), 'section, found 2'],
  ];
  for (const [name, mutate, expected] of mutations) {
    test(`fails: ${name}`, () => {
      const found = problems(mutate(sealedPlan()));
      expect(found.some((p) => p.includes(expected))).toBe(true);
    });
  }

  const HASH64 = 'a'.repeat(64);
  const SIDECAR64 = 'b'.repeat(64);
  const HEAD40 = '0123456789abcdef'.repeat(2) + '01234567';
  const promptFields = (planPath = '/p.md') => [
    'Workspace: /tmp/work/widgets — continue in this same workspace',
    `Branch: feature/widget-csv; target base: origin/main; HEAD: ${HEAD40}`,
    'Work state: clean working tree',
    `Plan: ${planPath}; SHA-256: ${HASH64}; Tier: standard`,
    `Review record: ${planPath.replace(/\.md$/, '')}.review-record.md; SHA-256: ${SIDECAR64}`,
    'Approved scope: Export widgets as CSV; approved as-is',
    'Spec: none',
    'Test plan: in plan',
    'Verify command: `bun run test`',
    'Preserve: none',
  ].join('\n');
  const handoff = (decisions: string, planPath = '/p.md', fields = promptFields(planPath)) =>
    `Run /implement ${planPath}\n\n${fields}\n\n${decisions}`;

  const messages: Array<[string, string, string | undefined]> = [
    ['plain block with marked bullets', `Done.\n\n${handoff('Auto-decisions:\n- [fork] a\n- [challenge] b\n')}`, undefined],
    ['continuation lines join their bullet and field', handoff('Auto-decisions:\n- [fork] a long\n  decision\n', '/p.md', promptFields('/p.md').replace('Approved scope: Export widgets as CSV; approved as-is', 'Approved scope: Export widgets as CSV;\n  approved as-is')), undefined],
    ['none', handoff('Auto-decisions:\n- none\n'), undefined],
    ['an earlier fenced example quoting the handoff', `Example:\n\n\`\`\`\nRun /implement /old.md\n\`\`\`\n\n${handoff('Auto-decisions:\n- none\n')}`, undefined],
    ['no block', 'All done; run implement next.\n', 'does not end with a block'],
    ['indented run line', `  Run /implement /p.md\n${promptFields()}\nAuto-decisions:\n- none\n`, 'does not end with a block'],
    ['fence not last', `\`\`\`\n${handoff('Auto-decisions:\n- none\n')}\`\`\`\nThanks!\n`, 'does not end with a block'],
    ['no label', `Run /implement /p.md\n${promptFields()}\n- [fork] a\n`, 'no bare "Auto-decisions:"'],
    ['inline none label', `Run /implement /p.md\n${promptFields()}\nAuto-decisions: none\n`, 'no bare "Auto-decisions:"'],
    ['empty list', handoff('Auto-decisions:\n'), 'list is empty'],
    ['unmarked bullet', handoff('Auto-decisions:\n- [fork] a\n- chose b\n'), 'lack a [fork] or [challenge]'],
    ['none with others', handoff('Auto-decisions:\n- none\n- [fork] a\n'), 'cannot be combined'],
    ['prose after the list', handoff('Auto-decisions:\n- [fork] a\nThat is all.\n'), 'unexpected line'],
    ['bare stub without /implement prompt fields', 'Run /implement /p.md\nAuto-decisions:\n- none\n', 'missing required field(s): Workspace, Branch'],
    ['missing plan path on Run /implement line', `Run /implement\n${promptFields()}\nAuto-decisions:\n- none\n`, 'first line of the handoff block must be "Run /implement <ACTIVE_PLAN>"'],
    ['unfilled <ACTIVE_PLAN> on Run /implement line', handoff('Auto-decisions:\n- none\n', '<ACTIVE_PLAN>'), 'first line of the handoff block must be "Run /implement <ACTIVE_PLAN>"'],
    ['unfilled <ACTIVE_PLAN> in prompt prose', `Run /implement /p.md\nRead <ACTIVE_PLAN> once.\n${promptFields()}\nAuto-decisions:\n- none\n`, 'still contains unfilled'],
    ['generic placeholder in prompt prose', `Run /implement /p.md\nRead <branch-name> once.\n${promptFields()}\nAuto-decisions:\n- none\n`, 'unfilled'],
    ['placeholder only in an Auto-decisions bullet', handoff('Auto-decisions:\n- [fork] chose <option>\n'), 'Auto-decisions bullet still contains an unfilled'],
    ['shadow lowercase plan label', handoff('Auto-decisions:\n- none\n', '/p.md', `${promptFields()}\nplan: /evil.md`), 'looks like the "Plan:" field'],
    ['shadow tab Verify label', handoff('Auto-decisions:\n- none\n', '/p.md', `${promptFields()}\nVerify\tcommand: bun run evil`), 'looks like the "Verify command:" field'],
    ['shadow single-asterisk Verify label', handoff('Auto-decisions:\n- none\n', '/p.md', `${promptFields()}\n*Verify command*: bun run evil`), 'looks like the "Verify command:" field'],
    ['placeholder split across a continuation', handoff('Auto-decisions:\n- none\n', '/p.md', promptFields().replace('Approved scope: Export widgets as CSV; approved as-is', 'Approved scope: Build <the\n  thing> now')), 'unfilled'],
    ['shadow numbered Verify label', handoff('Auto-decisions:\n- none\n', '/p.md', `${promptFields()}\n1. Verify command: bun run evil`), 'looks like the "Verify command:" field'],
    ['shadow stacked-prefix Verify label', handoff('Auto-decisions:\n- none\n', '/p.md', `${promptFields()}\n> - Verify command: bun run evil`), 'looks like the "Verify command:" field'],
    ['placeholder split across a bullet continuation', handoff('Auto-decisions:\n- [fork] chose <opt\n  ion>\n'), 'Auto-decisions bullet still contains an unfilled'],
    ['relative Workspace path', handoff('Auto-decisions:\n- none\n', '/p.md', promptFields().replace('Workspace: /tmp/work/widgets — continue in this same workspace', 'Workspace: relative/path')), 'Workspace: must name an absolute workspace path'],
    ['malformed Branch line (short SHA)', handoff('Auto-decisions:\n- none\n', '/p.md', promptFields().replace(HEAD40, 'abc1234')), 'Branch: must be'],
    ['Plan path disagrees with Run /implement path', handoff('Auto-decisions:\n- none\n', '/p.md', promptFields('/other.md')), 'Plan: path (/other.md) does not match "Run /implement /p.md"'],
    ['malformed Review record line', handoff('Auto-decisions:\n- none\n', '/p.md', promptFields().replace('/p.review-record.md', '/p.sidecar.md')), 'Review record: must be'],
    ['duplicate prompt field label', handoff('Auto-decisions:\n- none\n', '/p.md', `${promptFields()}\nSpec: docs/SPEC.md`), 'duplicate "Spec:" line'],
    ['malformed Plan hash (short)', handoff('Auto-decisions:\n- none\n', '/p.md', promptFields().replace(HASH64, 'abc123')), 'Plan: must be'],
    ['Plan Tier outside the enum', handoff('Auto-decisions:\n- none\n', '/p.md', promptFields().replace('Tier: standard', 'Tier: huge')), 'Plan: must be'],
    ['relative Run /implement path', handoff('Auto-decisions:\n- none\n', 'relative/p.md', promptFields('relative/p.md')), 'absolute'],
    ['embedded placeholder in a free-text field', handoff('Auto-decisions:\n- none\n', '/p.md', promptFields().replace('Approved scope: Export widgets as CSV; approved as-is', 'Approved scope: Build <thing> now')), 'unfilled'],
    // Generated by /ship coverage audit.
    // Value: protects=a fenced handoff counts only in a column-0 fence of the same char, closed by an equal or
    //   longer fence on the last line; fails_when=fence char/length matching or the inner-close guard breaks;
    //   why_new=only one backtick-fenced fixture was tested; seam=none; no_claim=parity with any one transport parser
    ['tilde-fenced block', `Done.\n\n~~~\n${handoff('Auto-decisions:\n- none\n')}~~~\n`, undefined],
    ['four-backtick fence closed by five', `\`\`\`\`text\n${handoff('Auto-decisions:\n- none\n')}\`\`\`\`\`\n`, undefined],
    ['fence closed by a shorter fence', `\`\`\`\`\n${handoff('Auto-decisions:\n- none\n')}\`\`\`\n`, 'does not end with a block'],
    ['fence closed by the other character', `\`\`\`\n${handoff('Auto-decisions:\n- none\n')}~~~\n`, 'does not end with a block'],
    ['indented fence', `  \`\`\`\n${handoff('Auto-decisions:\n- none\n')}  \`\`\`\n`, 'does not end with a block'],
    ['handoff fence closed before the list', `\`\`\`\nRun /implement /p.md\n\`\`\`\nAuto-decisions:\n- none\n\`\`\`\n`, 'does not end with a block'],
  ];
  for (const [name, message, expected] of messages) {
    test(`final message: ${name}`, () => {
      const found = checkMessage(message);
      if (expected === undefined) expect(found).toEqual([]);
      else expect(found.join('\n')).toContain(expected);
    });
  }

  // Generated by /ship coverage audit.
  // Value: protects=checkPlan reports invalid UTF-8 as its one problem instead of checking replacement-char text;
  //   fails_when=the decoder's fatal flag or the early return is dropped; why_new=every other check test feeds
  //   valid UTF-8; seam=none; no_claim=none beyond protects
  test('a plan that is not valid UTF-8 reports exactly that problem', () => {
    const bytes = Buffer.concat([Buffer.from('# Plan\n\nTier: standard\n'), Buffer.from([0xff, 0xfe, 0x0a])]);
    expect(checkPlan(bytes, reader)).toEqual(['the plan is not valid UTF-8']);
  });

  test('check exits 1 and lists problems for a failing message', () => {
    sealedPlan();
    writeFileSync(join(temp, 'msg.md'), 'Run /implement\nAuto-decisions:\n- chose b\n');
    const r = cli('check', '--plan', plan, '--message', join(temp, 'msg.md'));
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('PROBLEM: message:');
    expect(field(r.stdout, 'CHECK')).toBe('fail');
  });
});

describe('reviewer prompts exclude earlier phases\' raw outputs', () => {
  test('a sealed plan with a full review record still yields prompts with no record content', () => {
    cli('seal', '--plan', plan, '--run', run);
    const sealed = readFileSync(plan, 'utf8');
    const sidecar = readFileSync(join(temp, 'track-plan.review-record.md'), 'utf8');
    for (const phase of PHASES) {
      for (const voice of ['native', 'outside'] as const) {
        const { text } = buildPrompt(sealed, phase, voice);
        for (const s of SENTINELS) expect(text).not.toContain(s);
        expect(text).not.toContain('## Review record');
        expect(text).not.toContain('## GSTACK REVIEW REPORT');
        expect(text).not.toContain('review-record.md');
        expect(text).not.toContain('| Review | Trigger |');
        expect(text).not.toContain(sidecar.slice(0, 200));
        expect(text).toContain('Export widgets as CSV');
        expect(text).toContain('Verify command: `bun run test`');
      }
    }
  });

  // Value: protects=each settlement reaches a reviewer once, inside the plan, for every phase; fails_when=the
  //   builder re-appends settlements as a separate list or strips them from the plan; why_new=a real run sent
  //   12 KB of settlements beside a plan that already applied them; seam=none; no_claim=reviewer behavior
  test('settlements ride in the plan once, as ID-tagged decision lines, for every phase', () => {
    const text = readFileSync(plan, 'utf8');
    const section = settlementsSection(splitPlan(text).proper);
    for (const phase of PHASES) {
      for (const voice of ['native', 'outside'] as const) {
        const built = buildPrompt(text, phase, voice);
        expect(built.text.split('- [ceo] d1: HOLD SCOPE: CSV only')).toHaveLength(2);
        expect(built.text.split('- [eng] d4: Stream rows')).toHaveLength(2);
        expect(built.text).toContain(SETTLEMENTS_NOTE);
        expect(built.text).not.toContain('Accepted settlements from earlier review phases');
        expect(built.record.settlements).toBe(4);
        expect(built.record.settlements_bytes).toBe(Buffer.byteLength(section));
        expect(built.record.plan_bytes).toBeGreaterThan(built.record.settlements_bytes);
      }
    }
    // Continuation lines join their bullet; the ID is parsed apart from the decision.
    expect(parseSettlements(splitPlan(text).proper).at(-1)).toEqual({ phase: 'eng', id: 'd4',
      text: 'Stream rows as they are read instead of buffering the whole table, so memory stays flat for large stores.' });
    const bare = text.replace(/## Accepted decisions\n[\s\S]*?(?=## Implementation tasks)/, '');
    const built = buildPrompt(bare, 'eng', 'outside');
    expect(built.text).not.toContain(SETTLEMENTS_NOTE);
    expect(built.record).toMatchObject({ settlements: 0, settlements_bytes: 0 });
  });

  test('a settlement may hold 200 characters after its ID, and a split decision repeats its ID', () => {
    const extra = `- [eng] d4: ${'x'.repeat(200)}\n- [eng] d4: second line of the same decision.\n`;
    writeFileSync(plan, readFileSync(plan, 'utf8').replace('\n## Implementation tasks', `${extra}\n## Implementation tasks`));
    expect(cli('prompt', '--plan', plan, '--run', run, '--phase', 'eng', '--voice', 'native').code).toBe(0);
    expect(parseSettlements(splitPlan(readFileSync(plan, 'utf8')).proper).filter((s) => s.id === 'd4')).toHaveLength(3);
  });

  test('each voice gets its phase criteria; outside prompts carry the boundary and the validator format', () => {
    const text = readFileSync(plan, 'utf8');
    for (const phase of PHASES) {
      const native = buildPrompt(text, phase, 'native').text;
      expect(native.startsWith(NATIVE_CRITERIA[phase])).toBe(true);
      expect(native).toMatch(new RegExp(`^Start your result with INPUT: ${phase} [0-9a-f]{64}\\.$`, 'm'));
      expect(native).not.toContain(BOUNDARY);
      const outside = buildPrompt(text, phase, 'outside').text;
      expect(outside.startsWith(BOUNDARY)).toBe(true);
      // Upstream's contract addresses the prompt's author; the voice gets its validator-readable form.
      expect(outside).not.toContain(OUTSIDE_RESULT_CONTRACT);
      expect(outside).toContain(OUTSIDE_OUTPUT_FORMAT);
      expect(native).not.toContain(OUTSIDE_OUTPUT_FORMAT);
      for (const paragraph of OUTSIDE_CRITERIA[phase]) expect(outside).toContain(paragraph);
      for (const other of PHASES.filter((p) => p !== phase)) expect(native).not.toContain(NATIVE_CRITERIA[other]);
    }
  });

  const leaks: Array<[string, string]> = [
    ['a native INPUT line', `INPUT: ceo ${'b'.repeat(64)}`],
    ['an outside status line', 'OUTSIDE_STATUS: completed provider=codex host=claude'],
    ['a consensus table', 'CEO DUAL VOICES — CONSENSUS TABLE:'],
    ['an audit trail', '## Decision Audit Trail'],
    ['a sidecar raw block', '<!-- autoplan-lean:raw ceo native -->'],
    ['an aggregated per-phase task list', '### Implementation Tasks (aggregated across phases)'],
  ];
  for (const [name, line] of leaks) {
    test(`refuses a plan proper carrying ${name}`, () => {
      writeFileSync(plan, readFileSync(plan, 'utf8').replace('## Accepted decisions', `${line}\n\n## Accepted decisions`));
      const r = cli('prompt', '--plan', plan, '--run', run, '--phase', 'eng', '--voice', 'native');
      expect(r.code).toBe(3);
      expect(r.stderr).toContain('ERROR RAW_OUTPUT_IN_PLAN');
      expect(existsSync(join(run, 'eng-native-prompt.md'))).toBe(false);
    });
  }

  test('a fenced example of a marker is not a leak', () => {
    writeFileSync(plan, readFileSync(plan, 'utf8').replace('## Accepted decisions', '```text\nOUTSIDE_STATUS: completed\n```\n\n## Accepted decisions'));
    expect(cli('prompt', '--plan', plan, '--run', run, '--phase', 'eng', '--voice', 'native').code).toBe(0);
  });

  const badSettlements: Array<[string, string]> = [
    ['a table row', '| 1 | eng | Stream rows |'],
    ['an untagged bullet', '- Stream rows'],
    ['a tagged bullet without a d<N> ID', '- [eng] Stream rows'],
    ['a malformed ID', '- [eng] D4: Stream rows'],
    ['a heading', '### CEO notes'],
    ['an over-long bullet', `- [eng] d9: ${'x'.repeat(201)}`],
    // Generated by /ship coverage audit.
    // Value: protects=only plain indented prose continues a settlement; nested lists, tables and fences refuse;
    //   fails_when=the continuation rule accepts any indented line or skips fenced lines; why_new=only a prose
    //   continuation was tested; seam=none; no_claim=none beyond protects
    ['an indented sub-bullet', '  - nested reviewer detail'],
    ['an indented numbered item', '  1) first step'],
    ['an indented table row', '  | 1 | eng | Stream rows |'],
    ['a fenced block', '```\nreviewer note\n```'],
  ];
  for (const [name, line] of badSettlements) {
    test(`refuses settlements containing ${name}`, () => {
      writeFileSync(plan, readFileSync(plan, 'utf8').replace('\n## Implementation tasks', `${line}\n\n## Implementation tasks`));
      const r = cli('prompt', '--plan', plan, '--run', run, '--phase', 'eng', '--voice', 'outside');
      expect(r.code).toBe(3);
      expect(r.stderr).toContain('ERROR SETTLEMENTS_INVALID');
    });
  }
});

describe('prompt-size records', () => {
  test('each prompt appends bytes and SHA-256, never content, and counts attempts', () => {
    for (const voice of ['native', 'outside', 'native']) {
      expect(cli('prompt', '--plan', plan, '--run', run, '--phase', 'dx', '--voice', voice).code).toBe(0);
    }
    const records = parseSizeRecords(readFileSync(join(run, 'prompt-sizes.jsonl'), 'utf8'));
    expect(records).toHaveLength(3);
    expect(records.map((r) => (r as { attempt?: number }).attempt)).toEqual([1, 1, 2]);
    for (const record of records) {
      expect(Object.keys(record).sort()).toEqual([
        'attempt', 'budget_bytes', 'bytes', 'ceo_ratio', 'criteria_bytes', 'phase', 'plan_bytes', 'plan_sha256', 'settlements',
        'settlements_bytes', 'sha256', 'source_bytes', 'v', 'voice',
      ]);
      expect(record).toMatchObject({ v: 2, source_bytes: 382, budget_bytes: planBudget(382), ceo_ratio: null });
      const file = readFileSync(join(run, `dx-${record.voice}-prompt.md`));
      expect(record.bytes).toBe(file.byteLength);
      expect(record.sha256).toBe(sha256(file));
    }
    const log = readFileSync(join(run, 'prompt-sizes.jsonl'), 'utf8');
    expect(log).not.toContain('Export widgets');
    expect(log).not.toContain('developer who has never seen');
  });

  test('the CLI prints the recorded size, and seal tabulates it in the sidecar only', () => {
    const r = cli('prompt', '--plan', plan, '--run', run, '--phase', 'ceo', '--voice', 'outside');
    const bytes = Number(field(r.stdout, 'BYTES'));
    expect(bytes).toBe(lstatSync(field(r.stdout, 'PROMPT')!).size);
    cli('seal', '--plan', plan, '--run', run);
    const sidecar = readFileSync(join(temp, 'track-plan.review-record.md'), 'utf8');
    expect(sidecar).toContain(`| ceo | outside | ${bytes} |`);
    expect(sidecar).toContain(`Total reviewer prompt bytes: ${bytes} across 1 prompts.`);
    expect(readFileSync(plan, 'utf8')).not.toContain(`| ceo | outside | ${bytes} |`);
  });

  test('prompt refuses a missing or symlinked run directory', () => {
    expect(cli('prompt', '--plan', plan, '--run', join(temp, 'nope'), '--phase', 'ceo', '--voice', 'native').stderr).toContain('ERROR RUN_DIR_MISSING');
    symlinkSync(run, join(temp, 'runlink'));
    expect(cli('prompt', '--plan', plan, '--run', join(temp, 'runlink'), '--phase', 'ceo', '--voice', 'native').stderr).toContain('ERROR UNSAFE_PATH');
    expect(readdirSync(run).filter((f) => f.endsWith('-prompt.md'))).toEqual([]);
  });
});

describe('plan budget and size ratios', () => {
  const grow = (bytes: number) => {
    const filler = Array.from({ length: Math.ceil(bytes / 60) }, (_, i) => `- [ ] Task ${i} padded to grow the plan proper past budget (src/x.ts).`).join('\n');
    writeFileSync(plan, readFileSync(plan, 'utf8').replace('## Implementation tasks\n\n', `## Implementation tasks\n\n${filler}\n`));
  };

  // Value: protects=the plan proper cannot outgrow 1.5 x source + 4096 at any prompt build; fails_when=prompt
  //   writes an over-budget prompt or size row; why_new=a real plan grew to 3.1 x its card; seam=none;
  //   no_claim=how a parent shortens a plan
  test('prompt refuses a plan proper over budget and writes nothing', () => {
    grow(planBudget(382));
    const r = cli('prompt', '--plan', plan, '--run', run, '--phase', 'dx', '--voice', 'native');
    expect(r.code).toBe(3);
    expect(r.stderr).toContain('ERROR PLAN_OVER_BUDGET');
    expect(r.stderr).toContain(`its budget is ${planBudget(382)} (1.5 x the 382-byte source + 4096)`);
    expect(existsSync(join(run, 'dx-native-prompt.md'))).toBe(false);
    expect(existsSync(join(run, 'prompt-sizes.jsonl'))).toBe(false);
  });

  // Generated by /ship coverage audit.
  // Value: protects=the documented budget floor(1.5 x source) + 4096 is inclusive and measures the plan as the
  //   prompt carries it; fails_when=the factor, allowance or floor changes, the limit turns exclusive, or trailing
  //   blank lines count; why_new=other cases derive limits from planBudget and overshoot by ~4.6 KB; seam=none;
  //   no_claim=none beyond protects
  test('the budget is floor(1.5 x source) + 4096, inclusive, and ignores trailing blank lines', () => {
    expect([planBudget(382), planBudget(383)]).toEqual([4669, 4670]);
    const text = readFileSync(plan, 'utf8');
    const room = 4669 - Buffer.byteLength(splitPlan(text).proper);
    // `extra` bytes of card text, plus two trailing blank lines that the reviewer prompt drops.
    const fill = (extra: number) => writeFileSync(plan, text
      .replace('\n## Acceptance criteria', `\n${'x'.repeat(extra - 2)}\n\n## Acceptance criteria`)
      .replace('\n## GSTACK REVIEW REPORT', '\n\n\n## GSTACK REVIEW REPORT'));
    fill(room);
    const at = cli('prompt', '--plan', plan, '--run', run, '--phase', 'eng', '--voice', 'native');
    expect(at.code).toBe(0);
    expect([field(at.stdout, 'PLAN_BYTES'), field(at.stdout, 'BUDGET_BYTES')]).toEqual(['4669', '4669']);
    const sealed = cli('seal', '--plan', plan, '--run', run);
    expect(sealed.code).toBe(0);
    expect(field(sealed.stdout, 'PROPER_BYTES')).toBe('4669');
    fill(room + 1);
    const over = cli('prompt', '--plan', plan, '--run', run, '--phase', 'eng', '--voice', 'native');
    expect(over.code).toBe(3);
    expect(over.stderr).toContain('ERROR PLAN_OVER_BUDGET: the plan proper is 4670 bytes; its budget is 4669');
  });

  test('prompt and seal refuse a run directory without restore.md', () => {
    rmSync(join(run, 'restore.md'));
    for (const args of [['prompt', '--plan', plan, '--run', run, '--phase', 'ceo', '--voice', 'native'], ['seal', '--plan', plan, '--run', run]]) {
      const r = cli(...args);
      expect(r.code).toBe(3);
      expect(r.stderr).toContain('ERROR SOURCE_MISSING');
    }
    expect(existsSync(sidecarPathFor(plan))).toBe(false);
  });

  test('later prompts record their ratio to the latest CEO prompt of the same voice', () => {
    expect(field(cli('prompt', '--plan', plan, '--run', run, '--phase', 'eng', '--voice', 'outside').stdout, 'CEO_RATIO')).toBe('none');
    const ceo = cli('prompt', '--plan', plan, '--run', run, '--phase', 'ceo', '--voice', 'outside');
    expect(field(ceo.stdout, 'CEO_RATIO')).toBe('none');
    const eng = cli('prompt', '--plan', plan, '--run', run, '--phase', 'eng', '--voice', 'outside');
    const expected = Math.round((Number(field(eng.stdout, 'BYTES')) / Number(field(ceo.stdout, 'BYTES'))) * 100) / 100;
    expect(Number(field(eng.stdout, 'CEO_RATIO'))).toBe(expected);
    expect(field(cli('prompt', '--plan', plan, '--run', run, '--phase', 'eng', '--voice', 'native').stdout, 'CEO_RATIO')).toBe('none');
    const rows = parseSizeRecords(readFileSync(join(run, 'prompt-sizes.jsonl'), 'utf8'));
    expect(rows.map((r) => r.ceo_ratio)).toEqual([null, null, expected, null]);
    cli('seal', '--plan', plan, '--run', run);
    const sidecar = readFileSync(sidecarPathFor(plan), 'utf8');
    expect(sidecar).toContain(`| ${expected.toFixed(2)} |`);
    expect(sidecar).toContain(`Plan budget: ${planBudget(382)} bytes for a 382-byte source.`);

    // Generated by /ship coverage audit.
    // Value: protects=a rebuilt CEO prompt becomes the reference for later ratios ("the latest CEO prompt of the
    //   voice"); fails_when=ceoReference picks the first CEO row; why_new=this run built one CEO prompt per voice;
    //   seam=none; no_claim=none beyond protects
    writeFileSync(plan, readFileSync(plan, 'utf8').replace('## Implementation tasks\n\n',
      `## Implementation tasks\n\n${'- [ ] Pad the CEO rebuild (src/pad.ts; AC1).\n'.repeat(12)}`));
    const ceo2 = cli('prompt', '--plan', plan, '--run', run, '--phase', 'ceo', '--voice', 'outside');
    const eng2 = cli('prompt', '--plan', plan, '--run', run, '--phase', 'eng', '--voice', 'outside');
    const bytesOf = (r: { stdout: string }) => Number(field(r.stdout, 'BYTES'));
    const latest = Math.round((bytesOf(eng2) / bytesOf(ceo2)) * 100) / 100;
    expect(latest).not.toBe(Math.round((bytesOf(eng2) / bytesOf(ceo)) * 100) / 100);
    expect(Number(field(eng2.stdout, 'CEO_RATIO'))).toBe(latest);
  });

  // Generated by /ship coverage audit.
  // Value: protects=a size log still holding v1 rows (no ratio or budget fields) seals, and a v1 CEO row still
  //   serves as the ratio reference; fails_when=the table or ratio assumes v2 fields, or prints a budget line
  //   with no budget; why_new=every sealed log in the suite is all-v2; seam=none; no_claim=none beyond protects
  test('a size log with v1 rows from an older run still seals and serves as the CEO reference', () => {
    const v1 = { v: 1, phase: 'ceo', voice: 'native', bytes: 1234, sha256: 'c'.repeat(64), criteria_bytes: 900,
      settlements: 0, settlements_bytes: 120, plan_bytes: 300, plan_sha256: 'd'.repeat(64), attempt: 1 };
    writeFileSync(join(run, 'prompt-sizes.jsonl'), `${JSON.stringify(v1)}\n`);
    expect(cli('seal', '--plan', plan, '--run', run).code).toBe(0);
    const legacy = readFileSync(sidecarPathFor(plan), 'utf8');
    expect(legacy).toContain('| ceo | native | 1234 | 300 | 900 | 0 (120 B) | — | `cccccccccccc` |');
    expect(legacy).not.toContain('Plan budget:');

    const eng = cli('prompt', '--plan', plan, '--run', run, '--phase', 'eng', '--voice', 'native');
    expect(eng.code).toBe(0);
    expect(Number(field(eng.stdout, 'CEO_RATIO'))).toBe(Math.round((Number(field(eng.stdout, 'BYTES')) / 1234) * 100) / 100);
    expect(cli('seal', '--plan', plan, '--run', run).code).toBe(0);
    expect(readFileSync(sidecarPathFor(plan), 'utf8')).toContain(`Plan budget: ${planBudget(382)} bytes for a 382-byte source.`);
  });

  test('seal prints the plan against its source and refuses an over-budget or malformed plan proper', () => {
    const ok = cli('seal', '--plan', plan, '--run', run);
    expect(ok.code).toBe(0);
    const proper = Buffer.byteLength(splitPlan(readFileSync(plan, 'utf8')).proper);
    expect(field(ok.stdout, 'SOURCE_BYTES')).toBe('382');
    expect(field(ok.stdout, 'PROPER_BYTES')).toBe(String(proper));
    expect(field(ok.stdout, 'BUDGET_BYTES')).toBe(String(planBudget(382)));
    expect(Number(field(ok.stdout, 'PLAN_RATIO'))).toBe(Math.round((Number(field(ok.stdout, 'PLAN_BYTES')) / 382) * 100) / 100);
    const sealed = readFileSync(plan);
    const sidecar = readFileSync(sidecarPathFor(plan));

    grow(planBudget(382));
    const over = cli('seal', '--plan', plan, '--run', run);
    expect(over.code).toBe(3);
    expect(over.stderr).toContain('ERROR PLAN_OVER_BUDGET');
    expect(readFileSync(sidecarPathFor(plan))).toEqual(sidecar);

    writeFileSync(plan, sealed.toString('utf8').replace('- [ceo] d2: Keep', '- [ceo] Keep'));
    const bad = cli('seal', '--plan', plan, '--run', run);
    expect(bad.code).toBe(3);
    expect(bad.stderr).toContain('ERROR SETTLEMENTS_INVALID');
    expect(readFileSync(sidecarPathFor(plan))).toEqual(sidecar);
  });

  // Value: protects=the parent can check the budget before the gate without writing anything, and an approved
  //   overrun passes only with a recorded one-line reason; fails_when=budget writes or exits 0 when over, or
  //   --over-budget is ignored, unrecorded or accepts an empty reason; why_new=overruns surfaced only at seal, after
  //   approval, with no exit for approved growth; seam=none; no_claim=whether a reason is justified
  test('budget reports without writing, and --over-budget lets an approved overrun through on the record', () => {
    const ok = cli('budget', '--plan', plan, '--run', run);
    expect(ok.code).toBe(0);
    expect(field(ok.stdout, 'BUDGET')).toBe('ok');
    expect(field(ok.stdout, 'BUDGET_BYTES')).toBe(String(planBudget(382)));
    grow(planBudget(382));
    const before = readdirSync(run).sort();
    const over = cli('budget', '--plan', plan, '--run', run);
    expect(over.code).toBe(1);
    expect(field(over.stdout, 'BUDGET')).toBe('over (no reason given)');
    expect(readdirSync(run).sort()).toEqual(before);

    for (const bad of ['', '  ', 'two\nlines', 'x'.repeat(201)]) {
      expect(cli('prompt', '--plan', plan, '--run', run, '--phase', 'eng', '--voice', 'native', '--over-budget', bad).code).toBe(2);
    }
    const reason = 'd3 and d7 added AC9 and AC10';
    const prompt = cli('prompt', '--plan', plan, '--run', run, '--phase', 'eng', '--voice', 'native', '--over-budget', reason);
    expect(prompt.code).toBe(0);
    expect(field(prompt.stdout, 'BUDGET')).toBe(`over (${reason})`);
    expect(parseSizeRecords(readFileSync(join(run, 'prompt-sizes.jsonl'), 'utf8')).at(-1)!.over_budget_reason).toBe(reason);
    const sealed = cli('seal', '--plan', plan, '--run', run, '--over-budget', reason);
    expect(sealed.code).toBe(0);
    expect(field(sealed.stdout, 'BUDGET')).toBe(`over (${reason})`);
    expect(readFileSync(sidecarPathFor(plan), 'utf8')).toContain(`Over budget (eng native, attempt 1): ${reason}`);

    // Generated by /ship coverage audit.
    // Value: protects=--over-budget accepts a reason of exactly 200 characters, the documented "at most 200";
    //   fails_when=the length limit turns exclusive; why_new=only a 201-character reason was tested; seam=none;
    //   no_claim=none beyond protects
    const longest = 'x'.repeat(200);
    const edge = cli('prompt', '--plan', plan, '--run', run, '--phase', 'ceo', '--voice', 'native', '--over-budget', longest);
    expect(edge.code).toBe(0);
    expect(field(edge.stdout, 'BUDGET')).toBe(`over (${longest})`);
  });

  // Value: protects=an overrun first approved at seal leaves its reason in the sealed record, and an in-budget
  //   seal records none; fails_when=seal's --over-budget reason reaches only stdout; why_new=the sidecar's
  //   over-budget lines came only from prompt rows, so a seal-only overrun left no record; seam=none;
  //   no_claim=none beyond protects
  test('a seal-only overrun records its reason in the sidecar; an in-budget seal records none', () => {
    expect(cli('prompt', '--plan', plan, '--run', run, '--phase', 'eng', '--voice', 'native').code).toBe(0);
    grow(planBudget(382));
    const reason = 'gate d5 added AC4';
    const sealed = cli('seal', '--plan', plan, '--run', run, '--over-budget', reason);
    expect(sealed.code).toBe(0);
    const proper = field(sealed.stdout, 'PROPER_BYTES');
    expect(readFileSync(sidecarPathFor(plan), 'utf8')).toContain(`Sealed over budget: ${reason} (plan proper ${proper} of ${planBudget(382)} bytes).`);
    cpSync(join(FIXTURES, 'plan.md'), plan);
    const ok = cli('seal', '--plan', plan, '--run', run, '--replace', '--over-budget', 'not needed');
    expect(field(ok.stdout, 'BUDGET')).toBe('ok');
    const sidecar = readFileSync(sidecarPathFor(plan), 'utf8');
    expect(sidecar).not.toContain('not needed');
    expect(sidecar).not.toContain('Sealed over budget');
  });

  test('an in-budget prompt or seal ignores --over-budget and records no reason', () => {
    const r = cli('prompt', '--plan', plan, '--run', run, '--phase', 'ceo', '--voice', 'outside', '--over-budget', 'not needed');
    expect(field(r.stdout, 'BUDGET')).toBe('ok');
    expect(Object.keys(parseSizeRecords(readFileSync(join(run, 'prompt-sizes.jsonl'), 'utf8'))[0]!)).not.toContain('over_budget_reason');
  });

  // Value: protects=a reviewed plan used as the next run's source sets its budget from its plan proper only;
  //   fails_when=the record and report raise the budget run after run; why_new=restore.md was measured whole;
  //   seam=none; no_claim=none beyond protects
  test('the budget source is restore.md\'s plan proper, not its review record or report', () => {
    const card = readFileSync(join(run, 'restore.md'), 'utf8');
    writeFileSync(join(run, 'restore.md'), `${card}\n## Review record\n\n${'- Sidecar: x\n'.repeat(50)}\n## GSTACK REVIEW REPORT\n\n${'| row |\n'.repeat(200)}`);
    expect(field(cli('budget', '--plan', plan, '--run', run).stdout, 'SOURCE_BYTES')).toBe(String(Buffer.byteLength(card.replace(/\n+$/, '\n'))));
  });

  // Value: protects=every d<N> a task cites resolves to a settlement /implement can read, and one ID never spans
  //   two phases; fails_when=seal accepts a dangling or path-like ID or a cross-phase ID; why_new=tasks now cite
  //   settlements by ID instead of restating them; seam=none; no_claim=that the cited decision is the right one
  test('seal refuses a task citing a d<N> with no settlement, and an ID under two phase tags', () => {
    const text = readFileSync(plan, 'utf8');
    writeFileSync(plan, text.replace('(src/export/csv.ts; AC1, d4; surfaced by eng)', '(src/export/csv.ts; AC1, d9; surfaced by eng)'));
    const dangling = cli('seal', '--plan', plan, '--run', run);
    expect(dangling.code).toBe(3);
    expect(dangling.stderr).toContain('ERROR TASK_REF_UNRESOLVED: implementation tasks cite d9');
    expect(existsSync(sidecarPathFor(plan))).toBe(false);
    writeFileSync(plan, text.replace('(src/export/csv.ts; AC1, d4; surfaced by eng)', '(src/d9.ts, lib/odd9; AC1, per d4.; surfaced by eng)'));
    expect(cli('seal', '--plan', plan, '--run', run).code).toBe(0);
    writeFileSync(plan, text.replace('- [dx] d3:', '- [dx] d1:'));
    const tagged = cli('prompt', '--plan', plan, '--run', run, '--phase', 'eng', '--voice', 'native');
    expect(tagged.code).toBe(3);
    expect(tagged.stderr).toContain('d1 is tagged both [ceo] and [dx]');
  });

  // Generated by /ship coverage audit.
  // Value: protects=seal checks only d<N> cited on unfenced ## Implementation tasks lines, sentence-final and
  //   multi-digit IDs included; fails_when=the fence skip or section scope is dropped, or the lookahead stops
  //   counting `d2.` or `d12`; why_new=the seal case covers dangling and path-like tokens only; seam=none;
  //   no_claim=none beyond protects
  test('task references come only from unfenced task lines and include sentence-final IDs', () => {
    const proper = [
      '# Plan', '', 'Card prose mentions d7.', '',
      '## Acceptance criteria', '', '1. Behaves as d8 describes.', '',
      '## Accepted decisions', '', '- [eng] d1: Keep it small.', '',
      '## Implementation tasks', '',
      '- [ ] Build it (src/a.ts; AC1, d1; check: unit).',
      '- [ ] Finish per d2.',
      '- [ ] Wire (d3) and d12, then d5;',
      '```text', '- [ ] fenced example citing d6', '```',
      '- [ ] Leave src/d9.ts, lib/odd9, d9-x, d9/y and v1.d9 alone.',
      '',
      '## Notes', '', 'A later section mentions d10.', '',
    ].join('\n');
    expect(taskRefs(proper)).toEqual(['d1', 'd2', 'd3', 'd12', 'd5']);
  });

  // Value: protects=a variant decisions or tasks heading is refused instead of silently hiding its section from
  //   the settlement and task-reference checks, and a code span such as `d2` is not read as a decision ID;
  //   fails_when=only the exact headings are parsed with no guard, or backtick spans count as IDs; why_new=a
  //   renamed tasks heading let a dangling d99 seal and pass check; seam=none; no_claim=none beyond protects
  test('variant section headings refuse, and inline code is not a decision ID', () => {
    const text = readFileSync(plan, 'utf8');
    for (const [from, to] of [['## Implementation tasks', '## Implementation tasks (merged)'], ['## Accepted decisions', '### Accepted decisions']]) {
      writeFileSync(plan, text.replace(from, to));
      const r = cli('seal', '--plan', plan, '--run', run);
      expect(r.code).toBe(3);
      expect(r.stderr).toContain('ERROR SECTION_HEADING_INVALID');
    }
    writeFileSync(plan, text.replace('(src/export/csv.ts; AC1, d4; surfaced by eng)', '(render with `d2` and the `d8` profile; src/export/csv.ts; AC1, d4; surfaced by eng)'));
    expect(taskRefs(splitPlan(readFileSync(plan, 'utf8')).proper)).toEqual(['d2', 'd4', 'd3']);
    expect(cli('seal', '--plan', plan, '--run', run).code).toBe(0);
  });

  // Value: protects=seal's new plan pre-checks run before any sidecar decision, so a refusal never touches a
  //   foreign sidecar or a taken archive name; fails_when=--replace or the archive path runs before the budget and
  //   settlement checks; why_new=those pre-checks are new; seam=none; no_claim=none beyond protects
  test('seal pre-check refusals leave a foreign sidecar and a taken archive name untouched', () => {
    const foreign = sidecarPathFor(plan);
    writeFileSync(foreign, 'someone else\n');
    grow(planBudget(382));
    const grown = readFileSync(plan);
    for (const extra of [[], ['--replace']]) {
      const r = cli('seal', '--plan', plan, '--run', run, ...extra);
      expect(r.code).toBe(3);
      expect(r.stderr).toContain('ERROR PLAN_OVER_BUDGET');
      expect(readFileSync(foreign, 'utf8')).toBe('someone else\n');
      expect(readFileSync(plan)).toEqual(grown);
    }
    rmSync(foreign);
    cpSync(join(FIXTURES, 'plan.md'), plan);
    const hash = field(cli('seal', '--plan', plan, '--run', run).stdout, 'SHA256')!;
    const archive = join(temp, `track-plan.review-record.${hash.slice(0, 12)}.md`);
    writeFileSync(archive, 'unrelated\n');
    writeFileSync(plan, readFileSync(plan, 'utf8').replace('- [ceo] d2: Keep', '- [ceo] Keep'));
    const before = { plan: readFileSync(plan), sidecar: readFileSync(foreign) };
    const r = cli('seal', '--plan', plan, '--run', run);
    expect(r.stderr).toContain('ERROR SETTLEMENTS_INVALID');
    expect(readFileSync(archive, 'utf8')).toBe('unrelated\n');
    expect(readFileSync(foreign)).toEqual(before.sidecar);
    expect(readFileSync(plan)).toEqual(before.plan);
  });

  test('proper --previous counts changed lines against the previous round', () => {
    const first = join(run, 'ceo-spec-input.1.md');
    expect(cli('proper', '--plan', plan, '--out', first).code).toBe(0);
    const same = cli('proper', '--plan', plan, '--out', join(run, 'ceo-spec-input.2.md'), '--previous', first);
    expect(field(same.stdout, 'CHANGED_LINES')).toBe('0');
    writeFileSync(plan, readFileSync(plan, 'utf8').replace('so memory stays flat for large stores.', 'so memory stays flat.'));
    const changed = cli('proper', '--plan', plan, '--out', join(run, 'ceo-spec-input.3.md'), '--previous', join(run, 'ceo-spec-input.2.md'));
    expect(field(changed.stdout, 'CHANGED_LINES')).toBe('2');
    expect(cli('proper', '--plan', plan, '--out', join(run, 'x.md')).stdout).not.toContain('CHANGED_LINES');
    const missing = cli('proper', '--plan', plan, '--out', join(run, 'y.md'), '--previous', join(run, 'nope.md'));
    expect(missing.code).toBe(3);
    expect(missing.stderr).toContain('ERROR PREVIOUS_MISSING');
    expect(existsSync(join(run, 'y.md'))).toBe(false);
    expect(changedLines('a\nb\nb\n', 'b\na\nb\n')).toBe(0);
    expect(changedLines('a\nb\n', 'a\nc\n')).toBe(2);
  });
});

describe('skill outlines', () => {
  const base = [
    '# /autoplan',
    '## Voice',
    'Be direct.',
    '## Phase 0',
    '**Section skip list — when following a loaded skill file, SKIP these sections',
    '(they are already handled by /autoplan):**',
    '- Preamble (run first)',
    '- AskUserQuestion Format',
    '- Outside Voice — Independent Plan Challenge',
    '',
    'Follow ONLY the review-specific methodology.',
    '',
  ].join('\n');
  const skill = [
    '---',
    'name: plan-x-review',
    '---',
    '## Preamble (after scope gate)',
    '```bash',
    '## not a heading inside a fence',
    '```',
    '## AskUserQuestion Format',
    '### Format',
    'question details',
    '## Voice',
    'Be   direct.',
    '## Review Sections',
    '### 1. Architecture review',
    'check the boundaries',
    '## Outside Voice — Independent Plan Challenge (default-on)',
    '### Continue after Outside Voice',
    'go on',
    '',
  ].join('\n');

  // Value: protects=parents can load methodology by range and skip what autoplan already handles;
  //   fails_when=fenced lines become headings, H3s escape a skipped H2, or whitespace breaks shared matches;
  //   why_new=a real run read 540 KB of skill text whole; seam=none; no_claim=which sections a parent reads
  test('marks skip-list, shared and read sections with non-overlapping line ranges', () => {
    expect(skipList(base)).toEqual(['preamble', 'askuserquestion format', 'outside voice — independent plan challenge']);
    const { rows } = outline(skill, base);
    expect(rows.map((r) => [r.start, r.end, r.status, r.heading])).toEqual([
      [4, 7, 'skip', '## Preamble (after scope gate)'],
      [8, 8, 'skip', '## AskUserQuestion Format'],
      [9, 10, 'skip-parent', '### Format'],
      [11, 12, 'shared', '## Voice'],
      [13, 13, 'read', '## Review Sections'],
      [14, 15, 'read', '### 1. Architecture review'],
      [16, 16, 'skip', '## Outside Voice — Independent Plan Challenge (default-on)'],
      [17, 18, 'skip-parent', '### Continue after Outside Voice'],
    ]);
    expect(outline(skill).rows.every((r) => r.status === 'read')).toBe(true);
    // Rows end at the last real line and cover the file after its frontmatter exactly once.
    const frontmatter = Buffer.byteLength('---\nname: plan-x-review\n---\n');
    expect(rows.reduce((n, r) => n + r.bytes, 0)).toBe(Buffer.byteLength(skill) - frontmatter);
    expect(outline('# A\nx\n## B\ny').rows.map((r) => [r.start, r.end, r.bytes])).toEqual([[1, 2, 6], [3, 4, 6]]);

    // Generated by /ship coverage audit.
    // Value: protects=an H1 ends a skipped H2's scope, a listed H3 is skipped under a read H2, and H4 never starts
    //   a row; fails_when=H1 stops resetting the skip scope, the own-name H3 check is dropped, or headings widen
    //   past H3; why_new=the fixture had no H1 after a skipped H2, listed H3 or H4; seam=none; no_claim=none beyond protects
    const nested = ['## Preamble', 'setup', '# Plan Review Mode', '### Step 1', '#### Detail', 'method',
      '## Review Sections', '### AskUserQuestion Format', 'ask', ''].join('\n');
    expect(outline(nested, base).rows.map((r) => [r.start, r.end, r.status, r.heading])).toEqual([
      [1, 2, 'skip', '## Preamble'],
      [3, 3, 'read', '# Plan Review Mode'],
      [4, 6, 'read', '### Step 1'],
      [7, 7, 'read', '## Review Sections'],
      [8, 9, 'skip', '### AskUserQuestion Format'],
    ]);
  });

  // Generated by /ship coverage audit.
  // Value: protects=a skip-list section, or an H3 under one, stays skip/skip-parent even when it matches a base
  //   section; fails_when=the shared check runs before the skip checks; why_new=no fixture skip row matched a base
  //   span, yet ~15 KB per installed phase skill does; seam=none; no_claim=none beyond protects
  test('skip and skip-parent outrank shared when a skipped section also matches the base', () => {
    const repeated = `${base}## AskUserQuestion Format\n### Format\nquestion details\n`;
    const status = (b: string) => outline(skill, b).rows.filter((r) => r.start === 8 || r.start === 9).map((r) => [r.heading, r.status]);
    // Without the skip list both sections are plainly shared, so the overlap is real.
    expect(status(repeated.replace('**Section skip list', '**Section list'))).toEqual([['## AskUserQuestion Format', 'shared'], ['### Format', 'shared']]);
    expect(status(repeated)).toEqual([['## AskUserQuestion Format', 'skip'], ['### Format', 'skip-parent']]);
  });

  // Value: protects=a section file with no H1-H3 heading (upstream's sections/<phase>-phase.md) still gets a
  //   readable range, and body text before the first heading is never lost; fails_when=outline only emits heading
  //   rows; why_new=a real installed ceo-phase.md outlined to zero rows; seam=none; no_claim=none beyond protects
  test('body text before the first heading is a row, so a heading-less file is one readable range', () => {
    const headingless = '<!-- generated -->\n**Override rules:** keep HOLD SCOPE.\n\n**Mandatory outputs:** a table.\n';
    expect(outline(headingless).rows).toEqual([
      { start: 1, end: 4, bytes: Buffer.byteLength(headingless), level: 0, heading: '(before first heading)', status: 'read' },
    ]);
    const intro = '---\nname: x\n---\n\nIntro paragraph.\n## A\nbody\n';
    expect(outline(intro).rows.map((r) => [r.start, r.end, r.heading])).toEqual([[5, 5, '(before first heading)'], [6, 7, '## A']]);
    expect(outline('---\nname: x\n---\n## A\n').rows.map((r) => r.heading)).toEqual(['## A']);
  });

  // Value: protects=installed skills reached through the host catalog's symlinks outline normally;
  //   fails_when=outline applies the write-path symlink refusal to read-only inputs; why_new=every Claude Code
  //   catalog SKILL.md is a symlink and outline refused it; seam=none; no_claim=none beyond protects
  test('outline reads symlinked skill and base files through to their targets', () => {
    writeFileSync(join(temp, 'real-skill.md'), skill);
    writeFileSync(join(temp, 'real-autoplan.md'), base);
    symlinkSync(join(temp, 'real-skill.md'), join(temp, 'SKILL.md'));
    symlinkSync(join(temp, 'real-autoplan.md'), join(temp, 'autoplan.md'));
    const r = cli('outline', '--skill', 'SKILL.md', '--base', 'autoplan.md');
    expect(r.code).toBe(0);
    expect(field(r.stdout, 'SKIP_LIST')).toBe('3');
    expect(r.stdout).toContain('SECTION: 14-15 48 read ### 1. Architecture review\n');
    symlinkSync(join(temp, 'gone.md'), join(temp, 'dangling.md'));
    expect(cli('outline', '--skill', 'dangling.md').stderr).toContain('ERROR SKILL_MISSING');
  });

  // Value: protects=a base whose skip list moved is reported as drift instead of silently marking every
  //   section read; fails_when=outline exits 0 with no skip rows; why_new=the skip-list parse fails open;
  //   seam=none; no_claim=none beyond protects
  test('a base with no Section skip list is drift: exit 4 and no row marked skip', () => {
    writeFileSync(join(temp, 'SKILL.md'), skill);
    writeFileSync(join(temp, 'autoplan.md'), '# /autoplan\n## Voice\nBe direct.\n');
    const r = cli('outline', '--skill', 'SKILL.md', '--base', 'autoplan.md');
    expect(r.code).toBe(4);
    expect(field(r.stdout, 'SKIP_LIST')).toBe('0');
    expect(r.stdout).toContain('DRIFT: no Section skip list found in BASE');
    expect(r.stdout).not.toMatch(/ skip(-parent)? #/);
  });

  // Generated by /ship coverage audit.
  // Value: protects=outline finds the installed autoplan's skip list and each phase skill's shared preamble and
  //   methodology; fails_when=upstream's skip-list label or preamble drifts so outline skips or shares nothing;
  //   why_new=the other outline cases use synthetic text; seam=none; no_claim=skipped unless GSTACK_OUTSIDE_TEST_ROOT is set
  test.skipIf(!process.env.GSTACK_OUTSIDE_TEST_ROOT)('installed upstream skills outline into skip, shared and read sections', () => {
    const root = process.env.GSTACK_OUTSIDE_TEST_ROOT!;
    const autoplan = readFileSync(join(root, 'autoplan', 'SKILL.md'), 'utf8');
    expect(skipList(autoplan)).toContain('preamble');
    for (const name of ['plan-ceo-review', 'plan-design-review', 'plan-devex-review', 'plan-eng-review']) {
      const statuses = new Set(outline(readFileSync(join(root, name, 'SKILL.md'), 'utf8'), autoplan).rows.map((r) => r.status));
      for (const status of ['read', 'shared', 'skip'] as const) expect(statuses.has(status), `${name} ${status}`).toBe(true);
    }
    // CEO pre-review steps nested under the skipped Prerequisite Skill Offer must stay readable.
    const ceo = outline(readFileSync(join(root, 'plan-ceo-review', 'SKILL.md'), 'utf8'), autoplan).rows;
    for (const heading of ['### Retrospective Check', '### Frontend/UI Scope Detection', '### Taste Calibration', '### Landscape Check']) {
      const row = ceo.find((r) => r.heading.startsWith(heading));
      expect(row, heading).toBeDefined();
      expect(row!.status, heading).not.toBe('skip');
    }
    for (const phase of ['ceo', 'eng']) {
      const section = join(root, 'autoplan', 'sections', `${phase}-phase.md`);
      if (!existsSync(section)) continue;
      const rows = outline(readFileSync(section, 'utf8')).rows;
      expect(rows.reduce((n, r) => n + r.bytes, 0), section).toBeGreaterThan(0);
    }
  });

  test('the CLI prints sections and byte totals, and refuses a missing file', () => {
    writeFileSync(join(temp, 'SKILL.md'), skill);
    writeFileSync(join(temp, 'autoplan.md'), base);
    const r = cli('outline', '--skill', 'SKILL.md', '--base', 'autoplan.md');
    expect(r.code).toBe(0);
    expect(field(r.stdout, 'SKIP_LIST')).toBe('3');
    expect(r.stdout).toContain('SECTION: 14-15 48 read ### 1. Architecture review\n');
    const rows = outline(skill, base).rows;
    const sum = (status: string) => rows.filter((row) => row.status === status).reduce((n, row) => n + row.bytes, 0);
    expect(Number(field(r.stdout, 'READ_BYTES'))).toBe(sum('read'));
    expect(Number(field(r.stdout, 'SHARED_BYTES'))).toBe(sum('shared'));
    expect(Number(field(r.stdout, 'SKIP_BYTES'))).toBe(sum('skip'));
    expect(Number(field(r.stdout, 'SKIP_PARENT_BYTES'))).toBe(sum('skip-parent'));
    expect(field(cli('outline', '--skill', 'SKILL.md').stdout, 'BASE')).toBe('none');
    const missing = cli('outline', '--skill', 'nope.md');
    expect(missing.code).toBe(3);
    expect(missing.stderr).toContain('ERROR SKILL_MISSING');
  });
});

describe('outside voice output format', () => {
  // Replies in the label forms of three real plan reviews that upstream's validator rejected as
  // untagged_review: severities written as bold "**High.**" text. The prose is replaced; numbering,
  // bullets, bold labels, severity counts and Recommendation lines are kept.
  const OUTSIDE = join(FIXTURES, 'outside');
  const cases = [
    { file: 'numbered-bold-period.md', verdict: 'findings', highest: 'P1', counts: { High: 3, Medium: 5, Low: 2 } },
    { file: 'outcome-and-bold-recommendation.md', verdict: 'clean', highest: 'P2', counts: { High: 0, Medium: 3, Low: 2 } },
    { file: 'bulleted-bold-period.md', verdict: 'findings', highest: 'P1', counts: { High: 1, Medium: 5, Low: 8 } },
  ] as const;
  /** The same reply written in OUTSIDE_OUTPUT_FORMAT's bracketed severity form. */
  const bracketed = (text: string) => text.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\*\*(Critical|High|Medium|Low)\.\s+/gm, '$1**[$2] ');
  const labels = (text: string) => [...text.matchAll(/^\s*(?:[-*+]|\d+[.)])\s+\*\*\[(Critical|High|Medium|Low)\]/gm)].map((m) => m[1]);

  test('fixtures keep the rejected form, and the requested form labels every finding', () => {
    for (const c of cases) {
      const text = readFileSync(join(OUTSIDE, c.file), 'utf8');
      expect(text).toMatch(/\*\*(High|Medium|Low)\. /);
      const fixed = bracketed(text);
      expect(fixed).not.toMatch(/\*\*(Critical|High|Medium|Low)\. /);
      for (const [severity, n] of Object.entries(c.counts)) expect(labels(fixed).filter((l) => l === severity)).toHaveLength(n);
    }
    for (const rule of ['[Critical], [High], [Medium] or [Low]', 'never a heading', '"NO_FINDINGS: none" immediately before the Recommendation line', 'Recommendation: <action> because <specific reason>']) {
      expect(OUTSIDE_OUTPUT_FORMAT).toContain(rule);
    }
  });

  // Value: protects=an outside voice that follows the prompt's format is counted, with each finding's
  //   severity; fails_when=the requested form drifts from what upstream's validator reads; why_new=three paid
  //   outside reviews were discarded as untagged_review; seam=installed gstack lib (GSTACK_OUTSIDE_TEST_ROOT);
  //   no_claim=that a model follows the format
  test.skipIf(!process.env.GSTACK_OUTSIDE_TEST_ROOT)('installed upstream validator rejects the bold form and reads the requested one', async () => {
    const { classifyOutsideReview } = await import(join(process.env.GSTACK_OUTSIDE_TEST_ROOT!, 'lib/outside-review-result.ts'));
    const classify = (text: string) => classifyOutsideReview({ text, gate: 'review', stderr: '', exit: 0 });
    const level = { Critical: 'P0', High: 'P1', Medium: 'P2', Low: 'P3' } as Record<string, string>;
    for (const c of cases) {
      const text = readFileSync(join(OUTSIDE, c.file), 'utf8');
      expect(classify(text)).toMatchObject({ verdict: 'unverified', reason: 'untagged_review' });
      const fixed = bracketed(text);
      expect(classify(fixed)).toMatchObject({ verdict: c.verdict, findings: { highest: c.highest } });
      for (const line of fixed.split('\n').filter((l) => /\*\*\[(High|Medium|Low)\]/.test(l))) {
        const severity = /\[(High|Medium|Low)\]/.exec(line)![1]!;
        expect(classify(`${line}\n\nRecommendation: Revise because of this finding.`).findings.highest).toBe(level[severity]);
      }
    }
    expect(classify('1. [High] The export drops rows. Evidence. Fix.\n\nRecommendation: Revise because rows are dropped.'))
      .toMatchObject({ verdict: 'findings', findings: { highest: 'P1' } });
    expect(classify('NO_FINDINGS: the plan covers every path.\n\nRecommendation: Proceed because the plan is complete.'))
      .toMatchObject({ verdict: 'clean' });
    // The no-findings form OUTSIDE_OUTPUT_FORMAT requests passes even with contrast words in the reason.
    expect(classify('Reviewed every criterion.\n\nNO_FINDINGS: none\n\nRecommendation: Approve because each criterion has a task, but only one test covers the export.'))
      .toMatchObject({ verdict: 'clean' });
    // The forms the format forbids are discarded, so the instructions stay necessary.
    for (const text of ['### 1. [High] The export drops rows.', 'NO_FINDINGS: covered; nothing else', 'NO_FINDINGS: covers x, and y',
      'NO_FINDINGS: covers x. It is fine', 'NO_FINDINGS: it only adds one flag', 'NO_FINDINGS: none\n\nOne more note.']) {
      expect(classify(`${text}\n\nRecommendation: Revise because x.`), text).toMatchObject({ verdict: 'unverified', reason: 'untagged_review' });
    }
  });
});

describe('copied upstream criteria', () => {
  const snapshot = `const NATIVE_REVIEWS = {\n${PHASES.map((p) => `  ${p}: \`${NATIVE_CRITERIA[p]}\``).join(',\n')}\n};\n`;
  const section = (phase: (typeof PHASES)[number]) =>
    `${BOUNDARY}\n\n  ${OUTSIDE_CRITERIA[phase].join('\n\n  Also consider prior findings.\n\n  ')}\n\nWrite the prompt. ${OUTSIDE_RESULT_CONTRACT}\n`;

  test('records its upstream source and revision', () => {
    expect(UPSTREAM.repository).toBe('garrytan/gstack');
    expect(UPSTREAM.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(UPSTREAM.version).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });

  test('drift reports match, drift and unreadable separately', () => {
    const all = Object.fromEntries(PHASES.map((p) => [p, section(p)]));
    expect(driftReport(snapshot, all, PHASES).every((i) => i.status === 'match')).toBe(true);
    const changed = driftReport(snapshot.replace('10x impact', '100x impact'), { ...all, eng: all.eng!.replace('Be adversarial', 'Be kind') }, PHASES);
    expect(changed.filter((i) => i.status === 'drift').map((i) => `${i.phase}/${i.voice}`)).toEqual(['ceo/native', 'eng/outside']);
    const missing = driftReport(undefined, { ceo: all.ceo }, ['ceo', 'dx']);
    expect(missing.map((i) => i.status)).toEqual(['unreadable', 'match', 'unreadable', 'unreadable']);
  });

  test('drift CLI exits 4 when upstream text differs and 0 when it matches', () => {
    writeFileSync(join(temp, 'snap.ts'), snapshot);
    const args = ['drift', '--snapshot-tool', join(temp, 'snap.ts')];
    for (const p of PHASES) {
      writeFileSync(join(temp, `${p}.md`), section(p));
      args.push('--section', `${p}=${join(temp, `${p}.md`)}`);
    }
    const ok = cli(...args);
    expect(ok.code).toBe(0);
    expect(field(ok.stdout, 'DRIFT')).toBe('none');
    writeFileSync(join(temp, 'dx.md'), 'unrelated\n');
    const bad = cli(...args);
    expect(bad.code).toBe(4);
    expect(bad.stdout).toContain('CRITERIA: dx outside drift');
    expect(field(bad.stdout, 'DRIFT')).toBe('found');
  });

  // Generated by /ship coverage audit.
  // Value: protects=an unreadable snapshot tool yields DRIFT: unknown and exit 4, never none/0, and --phases
  //   limits rows to the listed phases; fails_when=unreadable counts as a match or --phases is ignored;
  //   why_new=the drift CLI test reads every file and all phases; seam=none; no_claim=none beyond protects
  test('drift CLI: an unreadable snapshot tool is unknown, exit 4; --phases limits the rows', () => {
    for (const p of ['ceo', 'eng'] as const) writeFileSync(join(temp, `${p}.md`), section(p));
    const sections = ['--section', `ceo=${join(temp, 'ceo.md')}`, '--section', `eng=${join(temp, 'eng.md')}`];
    for (const snapshotTool of [join(temp, 'missing.ts'), run]) {
      const r = cli('drift', '--snapshot-tool', snapshotTool, ...sections, '--phases', 'ceo, eng');
      expect(r.code).toBe(4);
      expect(r.stderr).toBe('');
      expect(r.stdout.match(/^CRITERIA: \S+ \S+ \S+/gm)).toEqual([
        'CRITERIA: ceo native unreadable', 'CRITERIA: ceo outside match',
        'CRITERIA: eng native unreadable', 'CRITERIA: eng outside match',
      ]);
      expect(field(r.stdout, 'DRIFT')).toBe('unknown');
    }
  });
});

describe('CLI usage errors and refusals', () => {
  const tree = () => ({
    files: readdirSync(temp, { recursive: true }).map(String).sort(),
    plan: readFileSync(plan, 'utf8'),
  });

  // Generated by /ship coverage audit.
  // Value: protects=malformed argv exits 2 with ERROR USAGE and writes nothing; fails_when=a parser
  //   guard (unknown arg, missing/duplicate value, phase/voice/section/phases check) is dropped or exits 0/1;
  //   why_new=only an unknown command and a missing required flag were tested; seam=none; no_claim=none beyond protects
  const usage: Array<[string, () => string[], string]> = [
    ['an unknown argument', () => ['seal', '--plan', plan, '--run', run, '--bogus'], 'unknown argument --bogus'],
    ['a flag missing its value', () => ['check', '--plan'], '--plan requires a value'],
    ['a duplicate value flag', () => ['check', '--plan', plan, '--plan', plan], 'duplicate --plan'],
    ['an invalid --phase', () => ['prompt', '--plan', plan, '--run', run, '--phase', 'qa', '--voice', 'native'], '--phase must be one of ceo, design, dx, eng'],
    ['an invalid --voice', () => ['prompt', '--plan', plan, '--run', run, '--phase', 'ceo', '--voice', 'both'], '--voice must be one of native, outside'],
    ['a drift --section without =', () => ['drift', '--snapshot-tool', plan, '--section', 'ceo'], '--section must be PHASE=FILE, got ceo'],
    ['a drift --section with an unknown phase', () => ['drift', '--snapshot-tool', plan, '--section', `qa=${plan}`], '--section must be PHASE=FILE, got qa='],
    ['a drift --section with an empty path', () => ['drift', '--snapshot-tool', plan, '--section', 'ceo='], '--section must be PHASE=FILE, got ceo='],
    ['an unknown drift --phases entry', () => ['drift', '--snapshot-tool', plan, '--phases', 'ceo,qa'], 'unknown phase qa'],
  ];
  for (const [name, argv, message] of usage) {
    test(`usage error: ${name}`, () => {
      const before = tree();
      const r = cli(...argv());
      expect(r.code).toBe(2);
      expect(r.stderr).toContain(`ERROR USAGE: ${message}`);
      expect(r.stdout).toBe('');
      expect(tree()).toEqual(before);
    });
  }

  // Generated by /ship coverage audit.
  // Value: protects=check refuses a missing plan or message file, and prompt refuses an empty plan proper, with
  //   exit 3 and no output or prompt file; fails_when=a missing file is read as empty or an empty plan builds a
  //   prompt; why_new=no test hit these refusals; seam=none; no_claim=none beyond protects
  const refusals: Array<[string, () => string[], string]> = [
    ['check with a missing plan', () => ['check', '--plan', join(temp, 'nope.md')], 'PLAN_MISSING'],
    ['check with a missing message file', () => ['check', '--plan', plan, '--message', join(temp, 'nope.md')], 'MESSAGE_MISSING'],
    ['prompt on an empty plan proper', () => {
      writeFileSync(plan, '## Review record\n\nnothing yet\n\n## GSTACK REVIEW REPORT\n');
      return ['prompt', '--plan', plan, '--run', run, '--phase', 'eng', '--voice', 'native'];
    }, 'PLAN_EMPTY'],
  ];
  for (const [name, argv, code] of refusals) {
    test(`refusal: ${name}`, () => {
      const args = argv();
      const before = tree();
      const r = cli(...args);
      expect(r.code).toBe(3);
      expect(r.stderr).toContain(`ERROR ${code}:`);
      expect(r.stdout).toBe('');
      expect(tree()).toEqual(before);
      expect(existsSync(join(run, 'eng-native-prompt.md'))).toBe(false);
      expect(existsSync(join(run, 'prompt-sizes.jsonl'))).toBe(false);
    });
  }
});

describe('launcher and skill contract', () => {
  // Value: protects=scope detection cannot execute checkout preloads; fails_when=the actual skill
  // command loses Bun isolation; why_new=launcher tests do not execute this separate command;
  // seam=none; no_claim=installed upstream scope classification or model/host behavior.
  test('the skill scope command isolates Bun from checkout configuration', () => {
    const skill = readFileSync(join(ROOT, 'skills', 'autoplan-lean.md'), 'utf8');
    const command = skill.split('\n').find((line) => /^bun .*"<SNAPSHOT_TOOL>" scope /.test(line))!;
    expect(command).toBeDefined();
    writeFileSync(join(temp, 'bunfig.toml'), 'preload = ["./preload.ts"]\n');
    writeFileSync(join(temp, 'preload.ts'), 'console.log("CHECKOUT_PRELOAD_RAN");\n');
    const snapshot = join(temp, 'scope-tool.ts');
    writeFileSync(snapshot, 'console.log("SCOPE_OK " + Bun.argv[2]);\n');
    const invocation = command.replace('<SNAPSHOT_TOOL>', snapshot).replace('<run>', run);
    const result = spawnSync('/bin/sh', ['-c', invocation], {
      cwd: temp, env: { PATH: process.env.PATH!, HOME: temp }, encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('SCOPE_OK scope\n');
    for (const flag of ['--no-env-file', '--no-install', '--config=/dev/null']) expect(command).toContain(flag);
  });

  test('the hardened launcher runs help and version', () => {
    const env = { PATH: process.env.PATH!, HOME: temp };
    const help = spawnSync(join(ROOT, 'bin', 'autoplan-lean'), ['--help'], { cwd: temp, env, encoding: 'utf8' });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('autoplan-lean seal --plan PLAN --run DIR');
    const version = spawnSync(join(ROOT, 'bin', 'autoplan-lean'), ['--version'], { cwd: temp, env, encoding: 'utf8' });
    expect(version.stdout.trim()).toBe(`autoplan-lean ${readFileSync(join(ROOT, 'VERSION'), 'utf8').trim()}`);
    expect(cli('bogus').code).toBe(2);
    expect(cli('prompt', '--plan', plan).code).toBe(2);
  });

  // Generated by /ship coverage audit.
  // Value: protects=the launcher refuses a PATH of only relative entries with exit 5 and ERROR bun_missing instead of
  //   running a cwd-local bun; fails_when=the absolute-entry filter is dropped; why_new=launcher tests used the
  //   full PATH only; seam=none; no_claim=a mixed relative+absolute PATH; shells whose command -v differs from this machine's /bin/sh
  test('the launcher refuses a PATH with only relative entries instead of running a cwd-local bun', () => {
    writeFileSync(join(temp, 'bun'), '#!/bin/sh\necho PLANTED-BUN\n', { mode: 0o755 });
    for (const PATH of ['.', '.:bin']) {
      const r = spawnSync(join(ROOT, 'bin', 'autoplan-lean'), ['--help'], { cwd: temp, env: { PATH, HOME: temp }, encoding: 'utf8' });
      expect(r.status).toBe(5);
      expect(r.stderr).toContain('ERROR bun_missing: bun is not on an absolute PATH entry');
      expect(r.stdout).toBe('');
    }
  });

  test('the skill orchestrates upstream phase skills and keeps the transport contract', () => {
    const rawSkill = readFileSync(join(ROOT, 'skills', 'autoplan-lean.md'), 'utf8');
    const skill = rawSkill.replace(/\s+/g, ' ');
    for (const phrase of [
      '`autoplan`, `plan-ceo-review`, `plan-design-review`, `plan-devex-review` and `plan-eng-review`',
      'Never invoke `/autoplan` itself.',
      'Never recreate a review from memory.',
      '"$_EXTEND_ROOT/bin/autoplan-lean" prompt --plan',
      '"$_EXTEND_ROOT/bin/autoplan-lean" seal --plan',
      '"$_EXTEND_ROOT/bin/autoplan-lean" check --plan',
      'It never gets earlier phases\' raw outputs.',
      'record the native voice as unavailable and continue',
      'Do not add a model parameter.',
      '**HOLD SCOPE:**',
      '**Auto-choose at every gate:**',
      '**No repository edits, commits, pushes or PRs:**',
      'never in `TODOS.md` or any other repository file',
      'Never leave the only copy of the reviewed plan in `.context`, `/tmp`, or session memory',
      'On E (reject), stop after writing `<run>/gate.md`: do not seal the plan or emit the `/implement` prompt.',
      'gstack-redact --from-file "<run>/final-message.md"',
      'Run /implement <ACTIVE_PLAN>',
      'Read the sealed plan once, then re-read only needed line ranges and keep the plan read-only.',
      'Do not load the review-record sidecar into main context unless a task or accepted decision needs deeper phase detail.',
      'With none, the list is exactly `- none`.',
      'Mark each User Challenge `[challenge]` and every other entry `[fork]`.',
      'End the message with this block, then the stage line below. Nothing else may follow the block:',
      'Stage handoff: stage-handoff/v1; stage: plan; next: <implement|none>; status: <done|done-with-concerns|stopped|blocked|needs-context>; head: <full HEAD SHA|none>; plan-sha256: <SHA-256|none>',
      '`CHECK: ok` is required.',
      '"$_EXTEND_ROOT/bin/autoplan-lean" outline --skill',
      'Do not re-read a range you still hold in context; after a compaction, and on every rerun from the final gate, re-read the ranges the current step applies.',
      'A `skip-parent` row is an H3 under a skipped H2: read it unless its heading plainly belongs to the skipped topic',
      'Start both before awaiting either.',
      'Agent `run_in_background: false`',
      'Do not read either voice\'s output or begin the phase\'s review analysis until both have finished or failed.',
      'run native first, then outside, as upstream does',
      '"$_EXTEND_ROOT/bin/autoplan-lean" budget --plan',
      'Before a D rerun, move the settlements of every phase that will rerun',
      '`TASK_REF_UNRESOLVED`',
      'check: <test or manual check>',
      '`archive-phase --run "<run>" --phase <phase> --voice native`',
      '`CHANGED_LINES: 0` always stops the loop',
      'Never shorten the card text, the criteria, `Tier:`, the verify line or a task\'s check to fit, and never cut an accepted settlement or task.',
      `within a budget of ${BUDGET_SOURCE_FACTOR} × the source's plan-proper bytes + ${BUDGET_ALLOWANCE_BYTES}`,
      `may hold at most ${BUDGET_SOURCE_FACTOR} × the plan proper of \`<run>/restore.md\` + ${BUDGET_ALLOWANCE_BYTES} bytes`,
      'After its ID it holds at most 200 characters',
      'If the native dispatch returns a launch receipt instead of a result, await that agent\'s completion notice',
      'and the tasks that cite them, out of the plan into their phase reviews',
      'subsection from the Eng skill',
      '`SOURCE_BYTES`, `PROPER_BYTES`, `BUDGET_BYTES` and `PLAN_RATIO`',
    ]) expect(skill).toContain(phrase);

    const fenceMatch = /## 7\. Final message[\s\S]*?```text\n([\s\S]*?)\n```/.exec(rawSkill);
    expect(fenceMatch).not.toBeNull();
    const tpl = fenceMatch![1]!;
    const labels = tpl.split('\n').flatMap((l) => (/^([A-Z][A-Za-z ]+): /.exec(l) ? [l.split(': ')[0]!] : []));
    expect(labels).toEqual([...PROMPT_LABELS]);
    expect(checkMessage(`Summary.\n\n\`\`\`text\n${tpl}\n\`\`\`\n`).length).toBeGreaterThan(0);

    const filled = tpl
      .replaceAll('<ACTIVE_PLAN>', '/tmp/plan.md')
      .replace('<absolute path — continue in this same workspace>', '/tmp/work/widgets — continue in this same workspace')
      .replace('<current branch>', 'feature/widget-csv')
      .replace('<base ref>', 'origin/main')
      .replace('<full SHA>', '0123456789abcdef0123456789abcdef01234567')
      .replace('<clean, or committed/staged/unstaged/untracked changes including any TODOS.md updates>', 'clean working tree')
      .replace('<plan SHA-256>', 'a'.repeat(64))
      .replace('<routine|standard|novel>', 'standard')
      .replace('<sidecar path>', '/tmp/plan.review-record.md')
      .replace('<sidecar SHA-256>', 'b'.repeat(64))
      .replace('<what to build, gate outcome, and any HOLD SCOPE or Track boundary>', 'Export widgets as CSV; approved as-is')
      .replace('<docs/SPEC.md path and relevant outcome/target IDs, or none>', 'none')
      .replace('<Eng test-plan artifact path under <state-root>/projects/<slug>/, or in plan>', 'in plan')
      .replace('<the plan\'s Verify command line, as data>', '`bun run test`')
      .replace('<TODOS.md deferrals written by Eng and any unrelated working-tree changes, or none>', 'none')
      .replace('<decision on the caller\'s fork list, and the option taken>', 'Stream rows instead of buffering')
      .replace('<User Challenge and the option taken>', 'Keep CSV only');
    expect(checkMessage(`Summary.\n\n\`\`\`text\n${filled}\n\`\`\`\n`)).toEqual([]);
  });
});
