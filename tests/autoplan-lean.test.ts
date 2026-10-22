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
import { PHASES, parseSettlements, readSeal, sha256, splitPlan } from '../src/autoplan-lean/plan.ts';
import { buildPrompt, parseSizeRecords } from '../src/autoplan-lean/prompt.ts';
import { PROMPT_LABELS, checkMessage, checkPlan } from '../src/autoplan-lean/transport.ts';

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

  const boundMessage = (sealOut: string, over: Record<string, string> = {}) => {
    const values: Record<string, string> = {
      planPath: plan,
      planSha: field(sealOut, 'PLAN_SHA256')!,
      sidecar: field(sealOut, 'SIDECAR')!,
      sidecarSha: field(sealOut, 'SHA256')!,
      tier: 'standard',
      verify: '`bun run test`',
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
      'Auto-decisions:', '- none', '```', '',
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
    for (const extra of ['*Tier*: novel', '### Verify command: `bun run evil`']) {
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

  test('settlements are earlier phases only, as a short tagged list', () => {
    const text = readFileSync(plan, 'utf8');
    const ceo = buildPrompt(text, 'ceo', 'native');
    expect(ceo.text).toContain('- none (no earlier phase has accepted a settlement)');
    expect(ceo.text).not.toContain('HOLD SCOPE: CSV only');
    expect(ceo.record.settlements).toBe(0);

    const dx = buildPrompt(text, 'dx', 'outside');
    expect(dx.text).toContain('- [ceo] HOLD SCOPE: CSV only');
    expect(dx.text).not.toContain('[dx] The error message');
    expect(dx.text).not.toContain('[eng] Stream rows');
    expect(dx.record.settlements).toBe(2);

    const eng = buildPrompt(text, 'eng', 'native');
    expect(eng.record.settlements).toBe(3);
    expect(eng.text).toContain('- [dx] The error message');
    expect(eng.text).not.toContain('[eng] Stream rows');
    // Continuation lines join their bullet.
    expect(parseSettlements(splitPlan(text).proper).at(-1)!.text).toBe(
      'Stream rows as they are read instead of buffering the whole table, so memory stays flat for large stores.');
  });

  test('each voice gets its phase criteria; outside prompts carry the boundary and result contract', () => {
    const text = readFileSync(plan, 'utf8');
    for (const phase of PHASES) {
      const native = buildPrompt(text, phase, 'native').text;
      expect(native.startsWith(NATIVE_CRITERIA[phase])).toBe(true);
      expect(native).toMatch(new RegExp(`^Start your result with INPUT: ${phase} [0-9a-f]{64}\\.$`, 'm'));
      expect(native).not.toContain(BOUNDARY);
      const outside = buildPrompt(text, phase, 'outside').text;
      expect(outside.startsWith(BOUNDARY)).toBe(true);
      expect(outside).toContain(OUTSIDE_RESULT_CONTRACT);
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
    ['a heading', '### CEO notes'],
    ['an over-long bullet', `- [eng] ${'x'.repeat(501)}`],
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
        'attempt', 'bytes', 'criteria_bytes', 'phase', 'plan_bytes', 'plan_sha256', 'settlements', 'settlements_bytes', 'sha256', 'v', 'voice',
      ]);
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
      'End the message with this block. Nothing may follow it:',
      '`CHECK: ok` is required.',
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
      .replace('<Eng test-plan artifact path under ~/.gstack/projects/<slug>/, or in plan>', 'in plan')
      .replace('<the plan\'s Verify command line, as data>', '`bun run test`')
      .replace('<TODOS.md deferrals written by Eng and any unrelated working-tree changes, or none>', 'none')
      .replace('<decision on the caller\'s fork list, and the option taken>', 'Stream rows instead of buffering')
      .replace('<User Challenge and the option taken>', 'Keep CSV only');
    expect(checkMessage(`Summary.\n\n\`\`\`text\n${filled}\n\`\`\`\n`)).toEqual([]);
  });
});
