/**
 * Doc/join contract (deterministic, stub mode, no gstack) plus opportunistic
 * real-upstream checks. Real logger/config copies omit the network sync helper;
 * HOME and all inherited state overrides are isolated by telemetry-env.
 */

import { afterAll, describe, test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REAL_GSTACK_BIN, cleanupTelemetryFixtures, makeTelemetryFixture } from './helpers/telemetry-env';

afterAll(cleanupTelemetryFixtures);

const GSTACK_TELEMETRY_LOG = join(REAL_GSTACK_BIN, 'gstack-telemetry-log');
const HAS_GSTACK = existsSync(GSTACK_TELEMETRY_LOG);

// Flags our wrapper depends on. If gstack renames any of these, downstream
// extend telemetry breaks silently.
const REQUIRED_FLAGS = ['--source', '--skill', '--duration', '--outcome', '--session-id', '--event-type', '--no-sweep'] as const;

describe('gstack-telemetry-log contract (opportunistic)', () => {
  test.if(!HAS_GSTACK)('SKIPPED — gstack not installed at ~/.claude/skills/gstack/', () => {
    // This test exists so the suite reports the skip reason explicitly when
    // gstack is absent (CI / fresh devbox) instead of silently passing zero
    // contract checks. Documents the contract's enforcement gap.
    expect(HAS_GSTACK).toBe(false);
  });

  test.if(HAS_GSTACK)('gstack-telemetry-log is executable', () => {
    expect(HAS_GSTACK).toBe(true);
  });

  // For each flag we depend on, send a minimal valid invocation that uses
  // that flag and assert exit 0 + no flag-error on stderr. gstack-telemetry-log
  // uses a case-based arg parser with `*) shift ;;` default — unknown flags
  // are silently dropped (so we can't detect rename via parser errors), but
  // we CAN assert the helper exits 0 and writes nothing (when tier=off) or a
  // single row (when tier=community).
  test.if(HAS_GSTACK)('all 7 required flags accepted in a single invocation', () => {
    const fix = makeTelemetryFixture('community', 'real');
    const r = spawnSync(
      join(fix.home, '.claude/skills/gstack/bin/gstack-telemetry-log'),
      [
        '--no-sweep',
        '--source', 'gstack-extend',
        '--skill', 'extend:contract-test',
        '--duration', '7',
        '--outcome', 'success',
        '--session-id', 'sid-contract',
        '--event-type', 'skill_run',
      ],
      { env: fix.env, encoding: 'utf8', timeout: 10_000 },
    );
    expect(r.status).toBe(0);
    const rows = fix.readJsonl();
    expect(rows.length).toBe(1);
    // Confirm each flag's value actually landed in the schema — if gstack
    // renames a flag and silently drops the value, this row would have null
    // or default for that field.
    expect(rows[0].source).toBe('gstack-extend');         // --source
    expect(rows[0].skill).toBe('extend:contract-test');   // --skill
    expect(rows[0].duration_s).toBe(7);                   // --duration
    expect(rows[0].outcome).toBe('success');              // --outcome
    expect(rows[0].session_id).toBe('sid-contract');      // --session-id
    expect(rows[0].event_type).toBe('skill_run');         // --event-type
  });

  // Individual-flag round-trip: catches the case where a future gstack version
  // renames one flag but still parses the rest. gstack-telemetry-log's arg
  // parser silently drops unknown flags (`*) shift ;;`) so a row still appears
  // — but the renamed field would land as null / default. Each per-flag test
  // asserts the corresponding field appears with the supplied value in the
  // resulting jsonl row, so a silent rename trips the test.
  const PER_FLAG_CASES: Record<Exclude<typeof REQUIRED_FLAGS[number], '--no-sweep'>, { value: string; field: string; expected: string | number }> = {
    '--source':     { value: 'gstack-extend',       field: 'source',     expected: 'gstack-extend' },
    '--skill':      { value: 'extend:contract-flag', field: 'skill',      expected: 'extend:contract-flag' },
    '--duration':   { value: '42',                   field: 'duration_s', expected: 42 },
    '--outcome':    { value: 'success',              field: 'outcome',    expected: 'success' },
    '--session-id': { value: 'sid-roundtrip',        field: 'session_id', expected: 'sid-roundtrip' },
    '--event-type': { value: 'skill_run',            field: 'event_type', expected: 'skill_run' },
  };
  for (const flag of REQUIRED_FLAGS) {
    if (flag === '--no-sweep') continue;
    test.if(HAS_GSTACK)(`single-flag round-trip: ${flag} → ${PER_FLAG_CASES[flag].field}`, () => {
      const fix = makeTelemetryFixture('community', 'real');
      // Every invocation needs --skill (required for record-keeping); add the
      // flag under test on top of that (skipping the duplicate when testing --skill).
      const args = ['--skill', 'extend:contract-test', '--session-id', `sid-${flag.replace(/-/g, '')}`];
      if (flag !== '--skill' && flag !== '--session-id') {
        args.push(flag, PER_FLAG_CASES[flag].value);
      } else if (flag === '--skill') {
        // Override the placeholder skill with the test's expected value
        args[1] = PER_FLAG_CASES[flag].value;
      } else {
        // --session-id: override the auto-generated tag
        args[3] = PER_FLAG_CASES[flag].value;
      }
      const r = spawnSync(join(fix.home, '.claude/skills/gstack/bin/gstack-telemetry-log'), args, {
        env: fix.env, encoding: 'utf8', timeout: 10_000,
      });
      expect(r.status).toBe(0);
      const rows = fix.readJsonl();
      expect(rows.length).toBe(1);
      // Assert the flag's value actually landed in the schema. If gstack
      // renames the flag, the value silently drops and this assertion fails.
      expect(rows[0][PER_FLAG_CASES[flag].field]).toBe(PER_FLAG_CASES[flag].expected);
    });
  }
});


describe('foreign pending marker regression', () => {
  test.if(HAS_GSTACK)('--no-sweep preserves another session and emits no phantom row', () => {
    const fix = makeTelemetryFixture('community', 'real');
    const dir = join(fix.home, '.gstack', 'analytics');
    mkdirSync(dir, { recursive: true });
    const marker = join(dir, '.pending-OTHER');
    writeFileSync(marker, JSON.stringify({ skill: 'qa', session_id: 'OTHER', ts: '2026-09-20T00:00:00Z' }));
    const wrapper = join(import.meta.dir, '../bin/gstack-extend-telemetry');
    const start = spawnSync(wrapper, ['start', '--skill', 'extend:contract-test'], { env: fix.env, encoding: 'utf8' });
    expect(start.status).toBe(0);
    expect(existsSync(marker)).toBe(true);
    const result = spawnSync(wrapper, ['finish', '--skill', 'extend:contract-test', '--outcome', 'success'],
      { env: fix.env, encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(existsSync(marker)).toBe(true);
    expect(fix.readJsonl()).toHaveLength(2);
    expect(fix.readJsonl().some(row => row.outcome === 'unknown')).toBe(false);
  });
});

const DOC = join(import.meta.dir, '../docs/telemetry.md');
const WRAPPER = join(import.meta.dir, '../bin/gstack-extend-telemetry');
const LIB = join(import.meta.dir, '../bin/lib');
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const PLACES = [
  'the field table in docs/telemetry.md',
  'the version note',
  'the Join contract',
  'the quickstart example',
  'the schema-version TODO in docs/TODOS.md',
  'provenance_row in bin/lib/telemetry.py',
  'the SCHEMA constant in tests/telemetry.test.ts',
].join(', ');

function docText() {
  return readFileSync(DOC, 'utf8');
}

function section(doc: string, heading: string) {
  const lines = doc.split('\n');
  const at = lines.findIndex(line => line.trimEnd() === heading);
  if (at < 0) {
    throw new Error(`docs/telemetry.md is missing the ${JSON.stringify(heading)} section`);
  }
  const end = lines.findIndex((line, index) => index > at && line.startsWith('## '));
  return lines.slice(at, end < 0 ? undefined : end).join('\n');
}

function fieldNames(doc: string) {
  const body = section(doc, '## Execution provenance');
  const tableAt = body.search(/^\|/m);
  if (tableAt < 0 || !body.slice(tableAt).startsWith('| Field |')) {
    throw new Error('docs/telemetry.md "## Execution provenance" field table is missing or empty');
  }
  const names: string[] = [];
  for (const line of body.slice(tableAt).split('\n')) {
    if (!line.startsWith('|')) break;
    if (/^\| Field \|/.test(line) || /^\|[\s:-]+\|/.test(line)) continue;
    const cell = (line.split('|')[1] ?? '').trim();
    const tick = cell.match(/^`([^`]+)`$/);
    if (!tick) {
      throw new Error(`docs/telemetry.md "## Execution provenance" field table row is not one field name: ${line}`);
    }
    names.push(tick[1]);
  }
  if (names.length === 0) {
    throw new Error('docs/telemetry.md "## Execution provenance" field table parsed no fields');
  }
  return names;
}

function valueCell(doc: string, field: string) {
  const row = section(doc, '## Execution provenance')
    .split('\n')
    .find(line => line.startsWith(`| \`${field}\` |`));
  if (!row) throw new Error(`docs/telemetry.md "## Execution provenance" has no ${field} row`);
  return (row.split('|')[2] ?? '');
}

function backtickedValues(cell: string) {
  const head = cell.split(/[:;]/)[0] ?? '';
  return [...head.matchAll(/`([^`]+)`/g)].map(match => match[1]);
}

function quickstartLines(doc: string) {
  const body = section(doc, '## Author quickstart');
  const open = body.indexOf('~~~json');
  if (open < 0) throw new Error('docs/telemetry.md "Author quickstart" has no ~~~json block');
  const fenced = body.slice(open + '~~~json'.length);
  const close = fenced.indexOf('~~~');
  if (close < 0) throw new Error('docs/telemetry.md "Author quickstart" ~~~json block is unclosed');
  const lines = fenced.slice(0, close).split('\n').map(line => line.trim()).filter(Boolean);
  const kinds = [
    ['skill_start', /"event_type"\s*:\s*"skill_start"/],
    ['skill_run', /"event_type"\s*:\s*"skill_run"/],
    ['stage-runs', /"stage"\s*:/],
  ] as const;
  for (const [name, pattern] of kinds) {
    if (lines.filter(line => pattern.test(line)).length !== 1) {
      throw new Error(`docs/telemetry.md "Author quickstart" ~~~json block must contain exactly one ${name} line`);
    }
  }
  return lines;
}

function keysOf(line: string) {
  return Object.keys(JSON.parse(line));
}

function mismatch(problem: string, left: unknown, right: unknown): never {
  throw new Error(`problem: ${problem}.\ncause: ${JSON.stringify(left)} vs ${JSON.stringify(right)}.\nfix: update ${PLACES}.`);
}

function defect(what: string): never {
  throw new Error(`if you repaired this defect, update the Collision limit paragraph or the divergence row, the exceptions table, and this test. ${what}`);
}

function git(repo: string, env: Record<string, string>, args: string[]) {
  const result = spawnSync('git', args, { cwd: repo, env, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

function initCheckout(home: string, env: Record<string, string>, dirName: string, origin: string) {
  const repo = join(home, dirName);
  mkdirSync(repo);
  git(repo, env, ['init', '-q']);
  git(repo, env, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  git(repo, env, ['remote', 'add', 'origin', origin]);
  return repo;
}

function runTelemetry(env: Record<string, string>, cwd: string, args: string[]) {
  return spawnSync(WRAPPER, args, { cwd, env, encoding: 'utf8', timeout: 15_000 });
}

function isoEpoch(epoch: number) {
  return new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function handoffFiles(home: string) {
  const dir = join(home, '.gstack-extend/telemetry');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(name => name.endsWith('.json'));
}

function allowedConstants(env: Record<string, string>) {
  const result = spawnSync('python3', ['-B', '-I', '-c',
    'import json, sys\nsys.path.insert(0, sys.argv[1])\nimport telemetry\nprint(json.dumps({"harnesses": list(telemetry.HARNESSES), "outcomes": list(telemetry.OUTCOMES)}))',
    LIB,
  ], { env, encoding: 'utf8' });
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout) as { harnesses: string[]; outcomes: string[] };
}

describe('docs/telemetry.md join contract', () => {
  test('doc field table matches the emitted stage-runs row', () => {
    const doc = docText();
    const names = fieldNames(doc);
    const fix = makeTelemetryFixture('off');
    const repo = initCheckout(fix.home, fix.env, 'checkout-dir', 'git@github.com:acme/widget.git');
    const start = runTelemetry(fix.env, repo, ['start', '--skill', 'extend:roadmap']);
    expect(start.status).toBe(0);
    const finish = runTelemetry(fix.env, repo, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']);
    expect(finish.status).toBe(0);
    const row = fix.readLedger()[0];
    const emitted = Object.keys(row);
    if (JSON.stringify(emitted) !== JSON.stringify(names)) mismatch('field table keys differ from the emitted stage-runs row', names, emitted);
    const constants = allowedConstants(fix.env);
    const agents = backtickedValues(valueCell(doc, 'agent'));
    const outcomes = backtickedValues(valueCell(doc, 'outcome'));
    const same = (left: string[], right: string[]) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
    if (!same(agents, constants.harnesses)) mismatch('agent values differ from HARNESSES', agents, constants.harnesses);
    if (!same(outcomes, constants.outcomes)) mismatch('outcome values differ from OUTCOMES', outcomes, constants.outcomes);
    expect(fix.readJsonl()).toHaveLength(0);
  });

  test('doc quickstart example matches emitted skill_start and stage-runs keys', () => {
    const doc = docText();
    const lines = quickstartLines(doc);
    const startLine = lines.find(line => line.includes('"skill_start"'))!;
    const runLine = lines.find(line => line.includes('"skill_run"'))!;
    const stageLine = lines.find(line => line.includes('"stage"'))!;
    const fix = makeTelemetryFixture('community');
    const repo = initCheckout(fix.home, fix.env, 'checkout-dir', 'git@github.com:acme/widget.git');
    expect(runTelemetry(fix.env, repo, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    expect(runTelemetry(fix.env, repo, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    const startKeys = Object.keys(fix.readJsonl().find(row => row.event_type === 'skill_start')!);
    const stageKeys = Object.keys(fix.readLedger()[0]);
    if (JSON.stringify(keysOf(startLine)) !== JSON.stringify(startKeys)) {
      mismatch('quickstart skill_start keys differ from the emitted row', keysOf(startLine), startKeys);
    }
    const table = fieldNames(doc);
    if (JSON.stringify(keysOf(stageLine)) !== JSON.stringify(table) || JSON.stringify(keysOf(stageLine)) !== JSON.stringify(stageKeys)) {
      mismatch('quickstart stage-runs keys differ from the field table or the emitted row', keysOf(stageLine), { table, stageKeys });
    }
    for (const key of ['session_id', 'skill', 'duration_s', 'outcome']) {
      if (!keysOf(runLine).includes(key)) mismatch('abridged skill_run line is missing a required key', keysOf(runLine), key);
    }
    expect(keysOf(runLine)[1]).toBe('ts');
  });

  test('join invariants: shared session, printed epoch, ts format, forwarded duration', () => {
    const fix = makeTelemetryFixture('community');
    const repo = initCheckout(fix.home, fix.env, 'checkout-dir', 'git@github.com:acme/widget.git');
    const start = runTelemetry(fix.env, repo, ['start', '--skill', 'extend:roadmap']);
    expect(start.status).toBe(0);
    const epoch = Number(start.stdout.match(/start=(\d+)/)?.[1]);
    const sid = start.stdout.match(/session=(\S+)/)?.[1];
    expect(runTelemetry(fix.env, repo, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    const usage = fix.readJsonl();
    const stage = fix.readLedger()[0];
    const skillStart = usage.find(row => row.event_type === 'skill_start')!;
    const skillRun = usage.find(row => row.event_type === 'skill_run')!;
    expect([skillStart.skill, skillRun.skill, `extend:${stage.stage}`]).toEqual([
      'extend:roadmap', 'extend:roadmap', 'extend:roadmap',
    ]);
    expect([skillStart.session_id, skillRun.session_id, stage.session_id]).toEqual([sid, sid, sid]);
    expect(stage.started_at).toBe(isoEpoch(epoch));
    expect(skillStart.ts).toMatch(TS_RE);
    expect(skillRun.ts).toMatch(TS_RE);
    const forwarded = fix.readStubArgs().at(-1)!.split('\t');
    const durationFlag = forwarded[forwarded.indexOf('--duration') + 1];
    expect(String(stage.duration_s)).toBe(durationFlag);
    expect(skillRun.duration_s).toBe(stage.duration_s);
  });

  test('repo and detached-HEAD divergence is current behavior', () => {
    const fix = makeTelemetryFixture('community');
    const repo = initCheckout(fix.home, fix.env, 'checkout-dir', 'git@github.com:acme/widget.git');
    expect(runTelemetry(fix.env, repo, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    expect(runTelemetry(fix.env, repo, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    const skillStart = fix.readJsonl().find(row => row.event_type === 'skill_start')!;
    if (skillStart.repo !== 'checkout-dir' || fix.readLedger()[0].repo !== 'acme/widget') {
      defect(`skill_start.repo=${skillStart.repo} stage-runs.repo=${fix.readLedger()[0].repo}`);
    }
    git(repo, fix.env, ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-q', '-m', 'fixture']);
    git(repo, fix.env, ['checkout', '--detach', '-q']);
    expect(runTelemetry(fix.env, repo, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    expect(runTelemetry(fix.env, repo, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    const detached = fix.readLedger().at(-1)!;
    if (detached.branch !== null) defect(`detached stage-runs branch=${detached.branch}`);
  });

  test('same-root collision misattributes the earlier finish (current behavior)', () => {
    // Known defect, characterized as current behavior; update this test when repaired.
    const fix = makeTelemetryFixture('community');
    const repo = initCheckout(fix.home, fix.env, 'checkout-dir', 'git@github.com:acme/widget.git');
    const first = runTelemetry(fix.env, repo, ['start', '--skill', 'extend:roadmap']);
    const second = runTelemetry(fix.env, repo, ['start', '--skill', 'extend:roadmap']);
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    const secondSid = second.stdout.match(/session=(\S+)/)?.[1];
    const secondEpoch = Number(second.stdout.match(/start=(\d+)/)?.[1]);
    expect(runTelemetry(fix.env, repo, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    expect(runTelemetry(fix.env, repo, ['finish', '--skill', 'extend:roadmap', '--outcome', 'error']).status).toBe(0);
    const ledger = fix.readLedger();
    const starts = fix.readJsonl().filter(row => row.event_type === 'skill_start');
    const runs = fix.readJsonl().filter(row => row.event_type === 'skill_run');
    const row = ledger[0];
    const ok = ledger.length === 1
      && row.session_id === secondSid
      && row.started_at === isoEpoch(secondEpoch)
      && row.outcome === 'success'
      && starts.length === 2
      && starts.map(item => item.session_id).includes(first.stdout.match(/session=(\S+)/)?.[1] ?? '')
      && starts.map(item => item.session_id).includes(secondSid ?? '')
      && runs.length === 1
      && runs[0].session_id === secondSid
      && runs[0].outcome === 'success'
      && handoffFiles(fix.home).length === 0;
    if (!ok) defect(`ledger=${ledger.length} outcome=${row?.outcome} starts=${starts.length} runs=${runs.length} handoffs=${handoffFiles(fix.home).length}`);
  });

  test('explicit retry appends a second stage-runs row and a second skill_run (current behavior)', () => {
    // Known defect, characterized as current behavior; update this test when repaired.
    const fix = makeTelemetryFixture('community');
    const repo = initCheckout(fix.home, fix.env, 'checkout-dir', 'git@github.com:acme/widget.git');
    const start = runTelemetry(fix.env, repo, ['start', '--skill', 'extend:roadmap']);
    expect(start.status).toBe(0);
    const sid = start.stdout.match(/session=(\S+)/)?.[1] ?? '';
    const epoch = start.stdout.match(/start=(\d+)/)?.[1] ?? '';
    expect(runTelemetry(fix.env, repo, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    expect(runTelemetry(fix.env, repo, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success', '--session-id', sid, '--start', epoch]).status).toBe(0);
    const stages = fix.readLedger().filter(row => row.session_id === sid);
    const runs = fix.readJsonl().filter(row => row.event_type === 'skill_run' && row.session_id === sid);
    if (stages.length !== 2 || runs.length !== 2) defect(`stage-runs=${stages.length} skill_run=${runs.length}`);
  });
});

const LOGGER_SOURCE = existsSync(GSTACK_TELEMETRY_LOG) ? readFileSync(GSTACK_TELEMETRY_LOG, 'utf8') : '';
const LOGGER_HAS_NO_SWEEP = LOGGER_SOURCE.includes('--no-sweep');

describe('real upstream join (gated)', () => {
  test.if(!LOGGER_HAS_NO_SWEEP)('SKIPPED — gstack is absent or its logger source does not mention --no-sweep', () => {
    expect(LOGGER_HAS_NO_SWEEP).toBe(false);
  });

  test.if(LOGGER_HAS_NO_SWEEP)('skill_run joins session and duration; detached _branch is HEAD', () => {
    const fix = makeTelemetryFixture('community', 'real');
    const repo = initCheckout(fix.home, fix.env, 'checkout-dir', 'git@github.com:acme/widget.git');
    const start = runTelemetry(fix.env, repo, ['start', '--skill', 'extend:roadmap']);
    expect(start.status).toBe(0);
    expect(runTelemetry(fix.env, repo, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    const stage = fix.readLedger()[0];
    const skillRun = fix.readJsonl().find(row => row.event_type === 'skill_run')!;
    expect(skillRun.session_id).toBe(stage.session_id);
    expect(skillRun.duration_s).toBe(stage.duration_s);
    expect(skillRun.ts).toMatch(TS_RE);
    git(repo, fix.env, ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-q', '-m', 'fixture']);
    git(repo, fix.env, ['checkout', '--detach', '-q']);
    expect(runTelemetry(fix.env, repo, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    expect(runTelemetry(fix.env, repo, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    const detachedStage = fix.readLedger().at(-1)!;
    const detachedRun = fix.readJsonl().filter(row => row.event_type === 'skill_run').at(-1)!;
    expect(detachedStage.branch).toBeNull();
    expect(detachedRun._branch).toBe('HEAD');
    expect(Object.prototype.hasOwnProperty.call(detachedRun, '_repo_slug')).toBe(true);
  });
});
