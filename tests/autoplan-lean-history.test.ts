import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { main, sidecarPathFor } from '../src/autoplan-lean/cli.ts';

const FIXTURES = resolve(import.meta.dir, 'fixtures/autoplan-lean');
let temp: string;
let plan: string;
let run: string;
const outputNames = ['ceo-review.md', 'ceo-native.md', 'ceo-outside.md'];
const historyName = 'phase-attempts.jsonl';

function cli(...argv: string[]) {
  let stdout = '';
  let stderr = '';
  const code = main(argv, { cwd: temp, stdout: (text) => { stdout += text; }, stderr: (text) => { stderr += text; } });
  return { code, stdout, stderr };
}

function outputs(label: string) {
  return outputNames.map((name) => {
    const text = `${label}-${name}-RAW-SENTINEL\n`;
    writeFileSync(join(run, name), text);
    return text;
  });
}

beforeEach(() => {
  temp = realpathSync(mkdtempSync(join(tmpdir(), 'autoplan-lean-history-')));
  plan = join(temp, 'track-plan.md');
  run = join(temp, 'run');
  cpSync(join(FIXTURES, 'plan.md'), plan);
  mkdirSync(run);
});

afterEach(() => rmSync(temp, { recursive: true, force: true }));

describe('phase review history', () => {
  test('rerun retains both reviews and both voices while later prompts exclude every raw output', () => {
    const first = outputs('FIRST');
    const archived = cli('archive-phase', '--run', run, '--phase', 'ceo');
    expect(archived).toEqual({ code: 0, stdout: `HISTORY: ${join(run, historyName)}\nPHASE: ceo\nATTEMPT: 1\nSTATUS: archived\n`, stderr: '' });
    for (const name of outputNames) expect(existsSync(join(run, name))).toBe(false);
    const rows = readFileSync(join(run, historyName), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(rows).toEqual([{ v: 1, phase: 'ceo', attempt: 1, review: first[0], native: first[1], outside: first[2] }]);

    const second = outputs('SECOND');
    expect(cli('seal', '--plan', plan, '--run', run).code).toBe(0);
    const sidecar = readFileSync(sidecarPathFor(plan), 'utf8');
    expect(sidecar).toContain('### Attempt 1 (archived)');
    expect(sidecar).toContain('### Attempt 2 (current)');
    for (const text of [...first, ...second]) {
      expect(sidecar.split(text)).toHaveLength(2);
      expect(readFileSync(plan, 'utf8')).not.toContain(text);
    }
    for (const voice of ['native', 'outside']) {
      expect(cli('prompt', '--plan', plan, '--run', run, '--phase', 'eng', '--voice', voice).code).toBe(0);
      const prompt = readFileSync(join(run, `eng-${voice}-prompt.md`), 'utf8');
      for (const text of [...first, ...second]) expect(prompt).not.toContain(text);
    }
    const sizes = readFileSync(join(run, 'prompt-sizes.jsonl'), 'utf8');
    for (const text of [...first, ...second]) expect(sizes).not.toContain(text.trim());
  });

  test('an empty phase is a no-op, including after an archive', () => {
    const initial = cli('archive-phase', '--run', run, '--phase', 'ceo');
    expect(initial.code).toBe(0);
    expect(initial.stdout).toContain('STATUS: empty');
    expect(existsSync(join(run, historyName))).toBe(false);
    outputs('FIRST');
    expect(cli('archive-phase', '--run', run, '--phase', 'ceo').code).toBe(0);
    const archived = readFileSync(join(run, historyName), 'utf8');
    expect(cli('archive-phase', '--run', run, '--phase', 'ceo').stdout).toContain('STATUS: empty');
    expect(readFileSync(join(run, historyName), 'utf8')).toBe(archived);
    expect(cli('seal', '--plan', plan, '--run', run).code).toBe(0);
    const sidecar = readFileSync(sidecarPathFor(plan), 'utf8');
    expect(sidecar).toContain('FIRST-ceo-review.md-RAW-SENTINEL');
    expect(sidecar).not.toContain('### Attempt 2 (current)');
  });

  test('partial failed attempts and empty output bytes survive; a rerun does not inherit old voices', () => {
    writeFileSync(join(run, 'ceo-native.md'), 'REJECTED-INPUT-SENTINEL\n');
    writeFileSync(join(run, 'ceo-outside.md'), '');
    expect(cli('archive-phase', '--run', run, '--phase', 'ceo').code).toBe(0);
    writeFileSync(join(run, 'ceo-review.md'), 'RERUN single-model: voices unavailable\n');
    expect(cli('seal', '--plan', plan, '--run', run).code).toBe(0);
    const sidecar = readFileSync(sidecarPathFor(plan), 'utf8');
    expect(sidecar).toContain('REJECTED-INPUT-SENTINEL');
    const current = sidecar.split('### Attempt 2 (current)')[1]!;
    expect(current).toContain('_No native output file');
    expect(current).toContain('_No outside output file');
    expect(current).not.toContain('REJECTED-INPUT-SENTINEL');
    expect(JSON.parse(readFileSync(join(run, historyName), 'utf8')).outside).toBe('');
  });

  test('attempt numbering is per phase and preserves prior history bytes', () => {
    outputs('FIRST');
    expect(cli('archive-phase', '--run', run, '--phase', 'ceo').code).toBe(0);
    const first = readFileSync(join(run, historyName), 'utf8');
    writeFileSync(join(run, 'eng-review.md'), 'ENG-FIRST\n');
    expect(cli('archive-phase', '--run', run, '--phase', 'eng').stdout).toContain('ATTEMPT: 1');
    outputs('SECOND');
    expect(cli('archive-phase', '--run', run, '--phase', 'ceo').stdout).toContain('ATTEMPT: 2');
    const history = readFileSync(join(run, historyName), 'utf8');
    expect(history.startsWith(first)).toBe(true);
    expect(history.trim().split('\n').map((line) => JSON.parse(line)).map(({ phase, attempt }) => [phase, attempt])).toEqual([['ceo', 1], ['eng', 1], ['ceo', 2]]);
  });

  test.each([
    'not JSON\n',
    '{"v":1,"phase":"ceo","attempt":1,"native":42}\n',
    '{"v":1,"phase":"ceo","attempt":2,"native":"earlier"}\n',
    '{"v":1,"phase":"other","attempt":1,"native":"earlier"}\n',
    '{"v":1,"phase":"ceo","attempt":1}\n',
  ])('invalid history refuses archive and seal without changing current outputs: %s', (history) => {
    const current = outputs('CURRENT');
    writeFileSync(join(run, historyName), history);
    const beforePlan = readFileSync(plan, 'utf8');
    for (const args of [['archive-phase', '--run', run, '--phase', 'ceo'], ['seal', '--plan', plan, '--run', run]]) {
      const result = cli(...args);
      expect(result.code).toBe(3);
      expect(result.stderr).toContain('ERROR HISTORY_INVALID');
      expect(readFileSync(join(run, historyName), 'utf8')).toBe(history);
      outputNames.forEach((name, index) => expect(readFileSync(join(run, name), 'utf8')).toBe(current[index]));
      expect(readFileSync(plan, 'utf8')).toBe(beforePlan);
      expect(existsSync(sidecarPathFor(plan))).toBe(false);
    }
  });

  test('unsafe output and archive paths refuse before clearing or archiving any outputs', () => {
    outputs('CURRENT');
    const elsewhere = join(temp, 'elsewhere.md');
    writeFileSync(elsewhere, 'keep\n');
    rmSync(join(run, 'ceo-outside.md'));
    symlinkSync(elsewhere, join(run, 'ceo-outside.md'));
    expect(cli('archive-phase', '--run', run, '--phase', 'ceo').stderr).toContain('ERROR UNSAFE_PATH');
    expect(existsSync(join(run, historyName))).toBe(false);
    expect(readFileSync(join(run, 'ceo-native.md'), 'utf8')).toContain('CURRENT');
    rmSync(join(run, 'ceo-outside.md'));
    symlinkSync(elsewhere, join(run, historyName));
    expect(cli('archive-phase', '--run', run, '--phase', 'ceo').stderr).toContain('ERROR UNSAFE_PATH');
    expect(readFileSync(elsewhere, 'utf8')).toBe('keep\n');
    expect(readFileSync(join(run, 'ceo-native.md'), 'utf8')).toContain('CURRENT');
  });

  test.skipIf(process.getuid?.() === 0)('archive write failure retains current outputs and existing history', () => {
    outputs('FIRST');
    expect(cli('archive-phase', '--run', run, '--phase', 'ceo').code).toBe(0);
    const history = readFileSync(join(run, historyName), 'utf8');
    const current = outputs('CURRENT');
    chmodSync(run, 0o500);
    try {
      const result = cli('archive-phase', '--run', run, '--phase', 'ceo');
      expect(result.code).not.toBe(0);
      expect(readFileSync(join(run, historyName), 'utf8')).toBe(history);
      outputNames.forEach((name, index) => expect(readFileSync(join(run, name), 'utf8')).toBe(current[index]));
    } finally {
      chmodSync(run, 0o700);
    }
  });
});
