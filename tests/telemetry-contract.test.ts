/**
 * Doc/join contract (deterministic, stub mode, no gstack) plus opportunistic
 * real-upstream checks. Real logger/config copies omit the network sync helper;
 * HOME and all inherited state overrides are isolated by telemetry-env.
 */

import { afterAll, describe, test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
// Development dependency pinned in bun.lock: run `bun install --frozen-lockfile` before this suite.
import Ajv from 'ajv';
import { quotaFixture } from './helpers/quota-env';
import { REAL_GSTACK_BIN, cleanupTelemetryFixtures, makeTelemetryFixture } from './helpers/telemetry-env';
import { computeTestSelection, listTestFiles } from './helpers/touchfiles';

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
  'the schema, version and source rules in docs/telemetry.md',
  'docs/stage-runs.schema.json',
  'the Join contract',
  'the quickstart example',
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
    'import json, sys\nsys.path.insert(0, sys.argv[1])\nimport telemetry\nprint(json.dumps({"harnesses": list(telemetry.HARNESSES), '
      + '"outcomes": list(telemetry.OUTCOMES), "routes": list(telemetry.ROUTES), "sources": list(telemetry.SOURCES), '
      + '"schema_version": telemetry.SCHEMA_VERSION, "release": telemetry.RELEASE_RE.pattern}))',
    LIB,
  ], { env, encoding: 'utf8' });
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout) as {
    harnesses: string[]; outcomes: string[]; routes: string[]; sources: string[]; schema_version: number; release: string;
  };
}

const same = (left: unknown[], right: unknown[]) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());

// ─── The published stage-runs schema, compiled the way consumers are told to ───

const ROOT = join(import.meta.dir, '..');
const SCHEMA_FILE = join(ROOT, 'docs/stage-runs.schema.json');
const RELEASE = readFileSync(join(ROOT, 'VERSION'), 'utf8').trim();
// Independent of the writer and the schema: the v1 wire order, of which legacy rows carry the first 13 or 15.
const V1_FIELDS = ['stage', 'agent', 'model', 'effort', 'rung', 'outcome', 'started_at', 'duration_s', 'session_id',
  'repo', 'branch', 'work_item', 'source', 'route', 'entrypoint_raw', 'schema_version', 'producer_version',
  'agent_source', 'model_source', 'effort_source'];
const METADATA = V1_FIELDS.slice(15);

function compileSchema() {
  // Ajv's defaults keep coercion, default insertion, removeAdditional and remote loading off.
  return new Ajv({ strict: true, allErrors: true }).compile(JSON.parse(readFileSync(SCHEMA_FILE, 'utf8')));
}
let compiled: ReturnType<typeof compileSchema> | undefined;

/** Validates without letting the validator touch the row; if/then/else wrapper errors are dropped. */
function verdict(row: unknown) {
  compiled ??= compileSchema();
  const before = JSON.stringify(row);
  const ok = compiled(row);
  expect(JSON.stringify(row)).toBe(before);
  const errors = (compiled.errors ?? []).filter(error => error.keyword !== 'if').map(error =>
    (error.keyword === 'required' ? '/' + (error.params as { missingProperty: string }).missingProperty : error.instancePath)
    + ' ' + error.keyword);
  return { ok, errors };
}

function quickstartRow() {
  return JSON.parse(quickstartLines(docText()).find(line => line.includes('"stage"'))!) as Record<string, unknown>;
}

function legacyOf(row: Record<string, unknown>, keep: string[] = V1_FIELDS.slice(0, 15)) {
  return Object.fromEntries(keep.map(key => [key, row[key]]));
}

/** The one `bun --no-install -e` block under "## Schema validation", byte for byte. */
function validationCommand(doc: string) {
  const blocks = [...section(doc, '## Schema validation').matchAll(/~~~sh\n([\s\S]*?)~~~/g)].map(match => match[1]);
  const commands = blocks.filter(block => block.startsWith('bun --no-install -e '));
  if (commands.length !== 1) {
    throw new Error('docs/telemetry.md "## Schema validation" must contain exactly one ~~~sh block starting with bun --no-install -e');
  }
  return commands[0];
}

function documentedOutputs(doc: string) {
  return [...section(doc, '## Schema validation').matchAll(/~~~text\n([\s\S]*?)~~~/g)].map(match => match[1].trimEnd());
}

/** Runs the documented command from `cwd` with an isolated HOME; `input` becomes STAGE_RUNS_FILE. */
function runValidation(input?: string | Buffer, options: { cwd?: string; file?: string } = {}) {
  const fix = makeTelemetryFixture('off');
  const env: Record<string, string> = { HOME: fix.home, PATH: dirname(process.execPath) + ':/usr/bin:/bin' };
  let file = options.file;
  if (input !== undefined) {
    file = join(fix.home, 'ledger', 'stage-runs.jsonl');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, input);
  }
  if (file !== undefined) env.STAGE_RUNS_FILE = file;
  const result = spawnSync('bash', ['-c', validationCommand(docText())],
    { cwd: options.cwd ?? ROOT, env, encoding: 'utf8', timeout: 30_000 });
  const diagnoses = result.stdout.split('\n').filter(line => line.startsWith('line '));
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, diagnoses, file,
    summary: result.stdout.split('\n').find(line => line.startsWith('summary: ')) ?? '' };
}

function summaryOf(counts: Partial<Record<'rows' | 'v1' | 'legacy' | 'invalid' | 'unsupported' | 'routed' | 'blank', number>>) {
  const value = (name: keyof typeof counts) => counts[name] ?? 0;
  return `summary: rows=${value('rows')} valid=${value('v1') + value('legacy')} v1=${value('v1')} legacy=${value('legacy')} `
    + `invalid=${value('invalid')} unsupported=${value('unsupported')} routed=${value('routed')} blank=${value('blank')}`;
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
    const routes = backtickedValues(valueCell(doc, 'route'));
    if (!same(agents, constants.harnesses)) mismatch('agent values differ from HARNESSES', agents, constants.harnesses);
    if (!same(outcomes, constants.outcomes)) mismatch('outcome values differ from OUTCOMES', outcomes, constants.outcomes);
    if (!same(routes, constants.routes)) mismatch('route values differ from ROUTES', routes, constants.routes);
    for (const field of ['agent_source', 'model_source', 'effort_source']) {
      const values = backtickedValues(valueCell(doc, field));
      if (!same(values, constants.sources)) mismatch(`${field} values differ from SOURCES`, values, constants.sources);
    }
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
    expect(verdict(JSON.parse(stageLine))).toEqual({ ok: true, errors: [] });
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

describe('docs/stage-runs.schema.json', () => {
  test('is self-contained draft-07 that compiles under strict Ajv, with the writer vocabularies', () => {
    const text = readFileSync(SCHEMA_FILE, 'utf8');
    const schema = JSON.parse(text);
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(schema).not.toHaveProperty('$id');
    const refs = [...text.matchAll(/"\$ref":\s*"([^"]*)"/g)].map(match => match[1]);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.filter(ref => !ref.startsWith('#/definitions/'))).toEqual([]);
    expect(text).not.toContain('"format"');
    expect(() => compileSchema()).not.toThrow();
    const constants = allowedConstants(makeTelemetryFixture('off').env);
    const defs = schema.definitions;
    expect(defs.agent.enum).toContain(null);
    const agents = defs.agent.enum.filter((value: unknown) => value !== null);
    if (!same(agents, constants.harnesses)) mismatch('schema agent enum differs from HARNESSES', agents, constants.harnesses);
    if (!same(defs.outcome.enum, constants.outcomes)) mismatch('schema outcome enum differs from OUTCOMES', defs.outcome.enum, constants.outcomes);
    if (!same(defs.route.enum, constants.routes)) mismatch('schema route enum differs from ROUTES', defs.route.enum, constants.routes);
    if (!same(defs.evidence_source.enum, constants.sources)) mismatch('schema evidence_source enum differs from SOURCES', defs.evidence_source.enum, constants.sources);
    expect(defs.schema_version.const).toBe(constants.schema_version);
    // One release grammar: what the writer accepts from VERSION is exactly what the schema accepts.
    expect(defs.producer_version.pattern).toBe('^' + constants.release + '$');
    expect(Object.keys(schema.properties)).toEqual(V1_FIELDS);
    expect(Object.keys(defs.v1.properties)).toEqual(V1_FIELDS);
    expect(defs.v1.required).toEqual(V1_FIELDS);
    expect(defs.legacy.required).toEqual(V1_FIELDS.slice(0, 13));
    expect(Object.keys(defs.legacy.properties)).toEqual([...V1_FIELDS.slice(0, 15), ...METADATA.slice(1)]);
  });

  test('wrapper-emitted rows are v1, name this checkout as producer, and validate', () => {
    const fix = makeTelemetryFixture('off');
    const repo = initCheckout(fix.home, fix.env, 'checkout-dir', 'git@github.com:acme/widget.git');
    const sid = '0c7f2e29-0000-4000-8000-0000000000c1';
    const claude = { ...fix.env, CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: sid };
    const run = (env: Record<string, string>, flags: string[] = []) => {
      expect(runTelemetry(env, repo, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
      const at = new Date().toISOString();
      const transcript = join(fix.home, '.claude/projects/-w', sid + '.jsonl');
      mkdirSync(dirname(transcript), { recursive: true });
      writeFileSync(transcript, JSON.stringify({ type: 'assistant', timestamp: at, effort: 'xhigh',
        message: { id: 'm-' + at, model: 'claude-opus-5', role: 'assistant' } }) + '\n');
      expect(runTelemetry(env, repo, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success', ...flags]).status).toBe(0);
      return fix.readLedger().at(-1)!;
    };
    const cases: Array<[Record<string, unknown>, string[]]> = [
      [run(fix.env), ['unknown', 'unknown', 'unknown']],
      [run(claude), ['detected', 'detected', 'detected']],
      [run(claude, ['--model', 'claude-opus-5', '--effort', 'max']), ['detected', 'flag', 'flag']],
      [run(claude, ['--agent', 'codex']), ['flag', 'unknown', 'unknown']],
    ];
    for (const [row, sources] of cases) {
      expect(Object.keys(row)).toEqual(V1_FIELDS);
      expect(row).toMatchObject({ schema_version: 1, producer_version: RELEASE });
      expect([row.agent_source, row.model_source, row.effort_source]).toEqual(sources);
      expect(verdict(row)).toEqual({ ok: true, errors: [] });
    }
  }, 30_000);

  test('genuine legacy rows validate with route and entrypoint_raw each optional; hybrids are not legacy', () => {
    const v1 = quickstartRow();
    const base = legacyOf(v1);
    const legacy = [
      base,
      legacyOf(v1, V1_FIELDS.slice(0, 13)),
      legacyOf(v1, V1_FIELDS.slice(0, 14)),
      legacyOf(v1, [...V1_FIELDS.slice(0, 13), 'entrypoint_raw']),
      { ...base, agent: null, model: null, effort: null, started_at: null, duration_s: 9223372036854775807, repo: null, branch: null },
    ];
    for (const row of legacy) expect(verdict(row)).toEqual({ ok: true, errors: [] });
    // Deleting only the version leaves v1 metadata behind, which a legacy row never has.
    const { schema_version: _version, ...unversioned } = v1;
    expect(verdict(unversioned)).toEqual({ ok: false,
      errors: ['/producer_version false schema', '/agent_source false schema', '/model_source false schema', '/effort_source false schema'] });
    for (const field of METADATA.slice(1)) {
      expect(verdict({ ...base, [field]: v1[field] }).errors).toEqual([`/${field} false schema`]);
    }
    // Removing all five is indistinguishable from a legacy row, which is why key absence never proves a release.
    expect(verdict(legacyOf(v1))).toEqual({ ok: true, errors: [] });
    expect(verdict({ ...v1, started_at: null, duration_s: 9223372036854775807 })).toEqual({ ok: true, errors: [] });
  });

  test('each missing field and each version, type, enum, source/value and extra-key mutation fails at its path', () => {
    const v1 = quickstartRow();
    for (const field of V1_FIELDS) {
      const { [field]: _gone, ...row } = v1;
      // Without schema_version the row is judged as legacy, which the remaining metadata fails.
      expect(verdict(row).errors).toContain(field === 'schema_version' ? '/producer_version false schema' : `/${field} required`);
    }
    for (const field of V1_FIELDS.slice(0, 13)) {
      const { [field]: _gone, ...row } = legacyOf(v1);
      expect(verdict(row)).toEqual({ ok: false, errors: [`/${field} required`] });
    }
    const failures: Array<[Record<string, unknown>, string[]]> = [
      [{ schema_version: null }, ['/schema_version type', '/schema_version const']],
      [{ schema_version: '1' }, ['/schema_version type', '/schema_version const']],
      [{ schema_version: 0 }, ['/schema_version const']],
      [{ schema_version: -1 }, ['/schema_version const']],
      [{ schema_version: 1.5 }, ['/schema_version type', '/schema_version const']],
      [{ schema_version: 2 }, ['/schema_version const']],
      [{ schema_version: true }, ['/schema_version type', '/schema_version const']],
      [{ stage: 7 }, ['/stage type']],
      [{ agent: 'gpt' }, ['/agent enum']],
      [{ model: 5 }, ['/model type']],
      [{ effort: false }, ['/effort type']],
      [{ rung: 1 }, ['/rung const']],
      [{ outcome: 'exploded' }, ['/outcome enum']],
      [{ started_at: '2026-09-20 12:00:00' }, ['/started_at pattern']],
      [{ started_at: 0 }, ['/started_at type']],
      [{ duration_s: -1 }, ['/duration_s minimum']],
      [{ duration_s: 1.5 }, ['/duration_s type']],
      [{ duration_s: '3' }, ['/duration_s type']],
      [{ session_id: null }, ['/session_id type']],
      [{ repo: 1 }, ['/repo type']],
      [{ branch: [] }, ['/branch type']],
      [{ work_item: {} }, ['/work_item type']],
      [{ source: 'other' }, ['/source const']],
      [{ route: 'web' }, ['/route enum']],
      [{ route: null }, ['/route type', '/route enum']],
      [{ entrypoint_raw: 1 }, ['/entrypoint_raw type']],
      [{ producer_version: '0.33.1' }, ['/producer_version pattern']],
      [{ producer_version: '٠.33.1.0' }, ['/producer_version pattern']],
      [{ producer_version: ' 0.33.1.0' }, ['/producer_version pattern']],
      [{ producer_version: 33 }, ['/producer_version type']],
      [{ agent_source: 'guess' }, ['/agent_source enum', '/agent_source enum']],
      // Source/value consistency: null pairs with unknown, a value with flag or detected.
      [{ agent: null, agent_source: 'detected' }, ['/agent_source const']],
      [{ model: null, model_source: 'flag' }, ['/model_source const']],
      [{ effort: 'high', effort_source: 'unknown' }, ['/effort_source enum']],
      [{ agent: 'claude', agent_source: 'unknown' }, ['/agent_source enum']],
      [{ extra: 1 }, [' additionalProperties']],
    ];
    for (const [patch, errors] of failures) {
      expect([patch, verdict({ ...v1, ...patch })]).toEqual([patch, { ok: false, errors }]);
    }
    expect(verdict({ ...legacyOf(v1), extra: 1 })).toEqual({ ok: false, errors: [' additionalProperties'] });
    for (const patch of [{ producer_version: null }, { agent: null, agent_source: 'unknown' }, { model_source: 'flag' }]) {
      expect(verdict({ ...v1, ...patch })).toEqual({ ok: true, errors: [] });
    }
  });

  test('quota runs enrichment is unchanged by v1 metadata, and the metadata never reaches skill-usage', () => {
    const quota = quotaFixture();
    try {
      const v1 = { ...quickstartRow(), agent: 'codex', model: 'gpt-6-astra', effort: 'high', route: 'conductor', agent_source: 'flag' };
      const ledger = join(quota.env.GSTACK_EXTEND_STATE_DIR, 'analytics/stage-runs.jsonl');
      mkdirSync(dirname(ledger), { recursive: true });
      writeFileSync(ledger, [{ ...v1, session_id: 'run-v1' }, { ...legacyOf(v1), session_id: 'run-legacy' }]
        .map(row => JSON.stringify(row)).join('\n') + '\n');
      const enriched = (sid: string) => {
        for (const [phase, at] of [['start', '2026-09-23T12:00:00Z'], ['finish', '2026-09-23T12:01:00Z']]) {
          const sample = quota.run(['sample', '--session-id', sid, '--phase', phase, '--json'], { GSTACK_EXTEND_QUOTA_NOW: at });
          expect(sample.status).toBe(0);
        }
        const runs = quota.run(['runs', '--session-id', sid, '--json'], { GSTACK_EXTEND_QUOTA_NOW: '2026-09-23T12:02:00Z' });
        expect(runs.status).toBe(0);
        const rows = JSON.parse(runs.stdout).runs as Array<Record<string, unknown>>;
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) for (const field of METADATA) expect(row).not.toHaveProperty(field);
        return rows.map(row => ({ stage: row.stage, agent: row.agent, model: row.model, effort: row.effort, route: row.route }));
      };
      const expected = { stage: 'roadmap', agent: 'codex', model: 'gpt-6-astra', effort: 'high', route: 'conductor' };
      expect(enriched('run-v1')).toEqual([expected]);
      expect(enriched('run-legacy')).toEqual([expected]);
    } finally {
      quota.cleanup();
    }
    const fix = makeTelemetryFixture('community');
    expect(runTelemetry(fix.env, ROOT, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    expect(runTelemetry(fix.env, ROOT, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    expect(Object.keys(fix.readLedger()[0])).toEqual(V1_FIELDS);
    const usage = JSON.stringify(fix.readJsonl()) + fix.readStubArgs().join('\n');
    for (const field of [...METADATA, 'producer', 'schema-version', 'detected']) expect(usage).not.toContain(field);
  }, 60_000);

  test('schema-only and VERSION-only diffs reach their suites; any lockfile change runs everything', () => {
    const tests = listTestFiles();
    const dependents = ['tests/telemetry-contract.test.ts', 'tests/telemetry.test.ts'];
    for (const changed of ['docs/stage-runs.schema.json', 'VERSION']) {
      const selection = computeTestSelection([changed], tests);
      expect(selection.reason).toBe('diff');
      expect(selection.selected).toEqual(expect.arrayContaining(dependents));
    }
    for (const changed of ['bin/lib/install-safety.sh', 'bin/lib/projects-registry.sh']) {
      const selection = computeTestSelection([changed], tests);
      expect(selection.reason).toBe('diff');
      expect(selection.selected).toContain('tests/telemetry-contract.test.ts');
    }
    expect(computeTestSelection(['docs/telemetry.md'], tests).reason).toBe('diff');
    for (const changed of [['bun.lock'], ['bun.lock', 'docs/telemetry.md'], ['docs/telemetry.md', 'bun.lock']]) {
      expect(computeTestSelection(changed, tests)).toEqual({ selected: tests, skipped: [], reason: 'global: bun.lock matches bun.lock' });
    }
  }, 30_000);
});

describe('docs/telemetry.md schema validation command', () => {
  const SEE = 'See docs/telemetry.md#schema-validation';

  test('the documented command validates its included row and prints the documented output', () => {
    const doc = docText();
    const command = validationCommand(doc);
    const [success, failure] = documentedOutputs(doc);
    // The included row is the quickstart row, so both examples stay one valid v1 row.
    expect(command).toContain('const EXAMPLE = ' + JSON.stringify(quickstartRow()) + ';');
    const result = runValidation();
    expect([result.status, result.stdout.trimEnd(), result.stderr]).toEqual([0, success, '']);
    const v1 = quickstartRow();
    const shown = runValidation([{ ...v1, model: null, model_source: 'flag' }, { ...v1, schema_version: 2 }]
      .map(row => JSON.stringify(row)).join('\n') + '\n');
    expect([shown.status, shown.stdout.trimEnd(), shown.stderr]).toEqual([1, failure, '']);
    // One streamed pass: the schema is the only file read whole.
    expect(command).toContain('createInterface({ input: Readable.from(utf8(file))');
    expect(command.match(/readFileSync\(/g)).toHaveLength(1);
  }, 30_000);

  // Every line carries its expected classification, written independently of the command.
  const v1 = () => quickstartRow();
  const mixed: Array<[string, 'v1' | 'legacy' | 'invalid' | 'unsupported' | 'routed' | 'blank']> = [
    [JSON.stringify(v1()), 'v1'],
    [JSON.stringify(v1()), 'v1'],
    [JSON.stringify(legacyOf(v1())), 'legacy'],
    [JSON.stringify(legacyOf(v1(), V1_FIELDS.slice(0, 13))), 'legacy'],
    [JSON.stringify(legacyOf(v1(), V1_FIELDS.slice(0, 14))), 'legacy'],
    [JSON.stringify({ source: 'another-writer', anything: true }), 'routed'],
    [JSON.stringify({ ...v1(), source: 'another-writer', schema_version: 'x' }), 'routed'],
    ['', 'blank'],
    ['   ', 'blank'],
    [JSON.stringify((({ source: _s, ...row }) => row)(v1())), 'invalid'],
    [JSON.stringify({ ...v1(), source: 1 }), 'invalid'],
    [JSON.stringify({ ...v1(), source: '  ' }), 'invalid'],
    [JSON.stringify((({ producer_version: _p, ...row }) => row)(v1())), 'invalid'],
    [JSON.stringify({ ...v1(), effort: null }), 'invalid'],
    [JSON.stringify({ ...v1(), schema_version: null }), 'invalid'],
    [JSON.stringify({ ...v1(), schema_version: '1' }), 'invalid'],
    [JSON.stringify({ ...v1(), schema_version: 1.5 }), 'invalid'],
    [JSON.stringify({ ...v1(), schema_version: 0 }), 'invalid'],
    [JSON.stringify({ ...v1(), schema_version: -3 }), 'invalid'],
    [JSON.stringify({ ...v1(), schema_version: 2 }), 'unsupported'],
    [JSON.stringify({ ...v1(), schema_version: 7 }), 'unsupported'],
    ['{"stage": "roadmap",', 'invalid'],
    ['null', 'invalid'],
    ['[1, 2]', 'invalid'],
    ['"a string"', 'invalid'],
  ];
  const expectedSummary = (lines: typeof mixed, times = 1) => {
    const counts: Record<string, number> = { rows: 0 };
    for (const [, kind] of lines) {
      counts[kind] = (counts[kind] ?? 0) + times;
      if (kind !== 'blank') counts.rows += times;
    }
    return summaryOf(counts);
  };

  test('a mixed ledger is dispatched by source, then version, then schema, and fails with exact counts', () => {
    const text = mixed.map(([line]) => line).join('\n') + '\n';
    const result = runValidation(text);
    expect([result.status, result.stderr, result.summary]).toEqual([1, '', expectedSummary(mixed)]);
    const failedLines = mixed.map(([, kind], index) => [kind, index + 1] as const)
      .filter(([kind]) => kind === 'invalid' || kind === 'unsupported').map(([, line]) => line);
    expect([...new Set(result.diagnoses.map(line => Number(line.match(/^line (\d+):/)![1])))]).toEqual(failedLines);
    for (const line of result.diagnoses) {
      expect(line).toMatch(/^line \d+: (\/[a-z_]+|\(root\)) [a-z ]+: .+\. Fix: .+\. See docs\/telemetry\.md#schema-validation$/);
    }
    expect(result.diagnoses).toContain(`line 13: /producer_version required: a required field is missing. Fix: write every field the contract requires, never a default. ${SEE}`);
    expect(result.diagnoses).toContain(`line 14: /effort_source const: a null value needs source unknown; any other value needs flag or detected. Fix: correct the producer, never the saved row. ${SEE}`);
    // The file is read, never written; duplicates count separately.
    expect(readFileSync(result.file!, 'utf8')).toBe(text);
  }, 30_000);

  test('CRLF, a last line without a newline, empty and all-blank input are line-exact', () => {
    const crlf = mixed.map(([line]) => line).join('\r\n');
    expect(runValidation(crlf).summary).toBe(expectedSummary(mixed));
    expect(runValidation('')).toMatchObject({ status: 0, stderr: '', summary: summaryOf({}) });
    expect(runValidation('\n  \r\n\t\n')).toMatchObject({ status: 0, stderr: '', summary: summaryOf({ blank: 3 }) });
    const ok = runValidation(JSON.stringify(v1()) + '\n' + JSON.stringify(legacyOf(v1())));
    expect(ok).toMatchObject({ status: 0, stderr: '', summary: summaryOf({ rows: 2, v1: 1, legacy: 1 }) });
    expect(runValidation(JSON.stringify({ source: 'another-writer' }))).toMatchObject({ status: 0, summary: summaryOf({ rows: 1, routed: 1 }) });
  }, 30_000);

  test('invalid UTF-8 fails privately while valid Unicode survives streamed chunks', () => {
    const marker = 'SENTINEL-ENCODING-VALUE';
    const row = Buffer.from(JSON.stringify({ ...v1(), model: marker }));
    const at = row.indexOf(marker);
    const corrupt = Buffer.concat([row.subarray(0, at), Buffer.from(marker), Buffer.from([0xff]),
      row.subarray(at + marker.length)]);
    const truncated = Buffer.concat([Buffer.from(JSON.stringify(v1()) + '\n'), Buffer.from([0xe2, 0x82])]);
    for (const bytes of [corrupt, truncated]) {
      const result = runValidation(bytes);
      expect([result.status, result.summary]).toEqual([1, '']);
      expect(result.stderr).toMatch(/^input unreadable or invalid UTF-8 after line [0-9]+\. See docs\/telemetry\.md#schema-validation\n$/);
      expect(result.stdout + result.stderr).not.toContain(marker);
      expect(result.stdout + result.stderr).not.toContain(result.file!);
      expect(readFileSync(result.file!).equals(bytes)).toBe(true);
    }
    // A literal replacement character is valid Unicode, not evidence of bad bytes.
    // The large branch crosses multiple stream chunks in the middle of UTF-8 characters.
    for (const row of [{ ...v1(), model: 'cafe\u0301 \ufffd \ud83c\udf89' }, { ...v1(), branch: '\u20ac'.repeat(90000) }]) {
      const bytes = Buffer.from(JSON.stringify(row));
      const result = runValidation(bytes);
      expect([result.status, result.stderr, result.summary]).toEqual([0, '', summaryOf({ rows: 1, v1: 1 })]);
      expect(readFileSync(result.file!).equals(bytes)).toBe(true);
    }
    // Preserve the BOM for JSON.parse to reject, rather than silently stripping it.
    const bom = runValidation(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(v1()))]));
    expect([bom.status, bom.stderr, bom.summary]).toEqual([1, '', summaryOf({ rows: 1, invalid: 1 })]);
  }, 30_000);

  test('a ten-times ledger keeps every count but shows at most 20 diagnoses', () => {
    const lines = Array.from({ length: 10 }, () => mixed).flat();
    const result = runValidation(lines.map(([line]) => line).join('\n') + '\n');
    expect([result.status, result.summary]).toEqual([1, expectedSummary(mixed, 10)]);
    expect(result.diagnoses).toHaveLength(20);
    const hidden = Number(result.stdout.match(/^(\d+) more diagnoses not shown$/m)?.[1]);
    expect(hidden).toBeGreaterThan(0);
  }, 30_000);

  test('diagnoses never echo row values, unknown keys, malformed text, or the input path', () => {
    const marks = ['SENTINEL-VALUE-1', 'SENTINEL_KEY_2', 'SENTINEL-MALFORMED-3', 'SENTINEL-SOURCE-4', 'SENTINEL-MODEL-5',
      'SENTINEL-VERSION-6', 'SENTINEL-PATH-7', 'SENTINEL-SCHEMA-8'];
    const rows = [
      JSON.stringify({ ...v1(), agent: marks[0] }),
      JSON.stringify({ ...v1(), [marks[1]]: 'x' }),
      `{"stage": "${marks[2]}"`,
      JSON.stringify({ ...v1(), source: marks[3] }),
      JSON.stringify({ ...v1(), model: marks[4] }),
      JSON.stringify({ ...v1(), schema_version: marks[5] }),
      JSON.stringify({ ...v1(), effort: null, effort_source: marks[0] }),
    ];
    const fix = makeTelemetryFixture('off');
    const file = join(fix.home, marks[6], 'stage-runs.jsonl');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, rows.join('\n') + '\n');
    const before = readFileSync(file);
    const checked = runValidation(undefined, { file });
    expect(checked.status).toBe(1);
    expect(checked.summary).toBe(summaryOf({ rows: 7, v1: 1, invalid: 5, routed: 1 }));
    expect(readFileSync(file).equals(before)).toBe(true);
    const missing = runValidation(undefined, { file: join(fix.home, marks[6], 'absent.jsonl') });
    expect([missing.status, missing.stdout, missing.stderr]).toEqual([1, '', `input unreadable: pass a readable JSONL file. ${SEE}\n`]);
    const directory = runValidation(undefined, { file: dirname(file) });
    expect([directory.status, directory.stderr]).toEqual([1, `input unreadable: pass a readable JSONL file. ${SEE}\n`]);
    // A damaged schema fails closed with a fixed message, not the parser's.
    const broken = join(fix.home, 'broken-checkout');
    mkdirSync(join(broken, 'docs'), { recursive: true });
    symlinkSync(join(ROOT, 'node_modules'), join(broken, 'node_modules'));
    writeFileSync(join(broken, 'docs/stage-runs.schema.json'), `{"${marks[7]}": `);
    const schema = runValidation(undefined, { cwd: broken, file });
    expect([schema.status, schema.stdout, schema.stderr]).toEqual([1, '', `schema unavailable: run from the gstack-extend checkout root. ${SEE}\n`]);
    for (const result of [checked, missing, directory, schema]) {
      for (const mark of marks) expect(result.stdout + result.stderr).not.toContain(mark);
    }
  }, 30_000);

  test.if(typeof process.getuid === 'function' && process.getuid() !== 0)('an unreadable regular ledger fails privately after stat succeeds (non-root)', () => {
    const fix = makeTelemetryFixture('off');
    const file = join(fix.home, 'SENTINEL-UNREADABLE-PATH.jsonl');
    writeFileSync(file, JSON.stringify(v1()) + '\n');
    const before = readFileSync(file);
    chmodSync(file, 0);
    try {
      const result = runValidation(undefined, { file });
      expect([result.status, result.stdout, result.stderr]).toEqual([1, '', `input unreadable or invalid UTF-8 after line 0. ${SEE}\n`]);
      expect(result.stdout + result.stderr).not.toContain('SENTINEL-UNREADABLE-PATH');
      expect(result.stdout + result.stderr).not.toContain('EACCES');
    } finally {
      chmodSync(file, 0o600);
    }
    expect(readFileSync(file).equals(before)).toBe(true);
  }, 30_000);
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

const CURSOR_RECIPE_MARK = '# gstack-extend-cursor-ledger-recipe';
const CURSOR_LEDGER_SENTINEL = 'cursor-ledger-secret-sentinel-23b';

function cursorLedgerRecipe() {
  const doc = readFileSync(DOC, 'utf8');
  const python = [...doc.matchAll(/```python\n([\s\S]*?)```/g)].map(match => match[1]);
  const marked = python.filter(body => body.startsWith(CURSOR_RECIPE_MARK + '\n'));
  expect(marked).toHaveLength(1);
  expect(marked[0]).not.toContain('import telemetry');
  expect(marked[0]).toContain('def main():');
  return marked[0];
}

function writeStageRuns(root: string, rows: Array<Record<string, unknown>>) {
  const dir = join(root, 'analytics');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'stage-runs.jsonl');
  writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  return file;
}

function runCursorRecipe(env: Record<string, string>, args: string[], cwd: string) {
  return spawnSync('python3', ['-I', '-', ...args], {
    input: cursorLedgerRecipe(),
    encoding: 'utf8',
    env,
    cwd,
  });
}

describe('Conductor Cursor ledger recipe', () => {
  const known = {
    stage: 'implement',
    session_id: 'known-session',
    started_at: '2026-10-08T18:00:00Z',
    agent: 'cursor',
    route: 'conductor',
    model: 'grok-4.7',
    effort: 'high',
    schema_version: 1,
    producer_version: '0.0.0.0',
    agent_source: 'detected',
    model_source: 'detected',
    effort_source: 'detected',
    outcome: 'success',
    entrypoint_raw: 'finish',
  };

  test('T39 reads only the whitelisted fields from the selected state root', () => {
    const recipe = cursorLedgerRecipe();
    const fix = makeTelemetryFixture('off');
    const homeLedger = writeStageRuns(join(fix.home, '.gstack-extend'), [known]);
    const before = readFileSync(homeLedger);
    const beforeMtime = statSync(homeLedger).mtimeMs;
    // Fixture env only: an exported state override from the developer's shell must not reach the recipe.
    const base = { ...fix.env };
    const def = runCursorRecipe(base, ['known-session'], fix.home);
    expect(def.status).toBe(0);
    expect(def.stdout.trim()).toBe(JSON.stringify(known));
    expect(readFileSync(homeLedger).equals(before)).toBe(true);
    expect(statSync(homeLedger).mtimeMs).toBe(beforeMtime);

    const absRoot = join(fix.home, 'abs-state');
    writeStageRuns(absRoot, [{ ...known, model: 'from-absolute' }]);
    writeStageRuns(join(fix.home, '.gstack-extend'), [{ ...known, model: CURSOR_LEDGER_SENTINEL }]);
    const absolute = runCursorRecipe({ ...base, GSTACK_EXTEND_STATE_DIR: absRoot }, ['known-session'], fix.home);
    expect(absolute.status).toBe(0);
    expect(absolute.stdout).toContain('"model":"from-absolute"');
    expect(absolute.stdout).not.toContain(CURSOR_LEDGER_SENTINEL);

    const decoy = join(fix.home, 'rel-decoy');
    writeStageRuns(decoy, [{ ...known, model: CURSOR_LEDGER_SENTINEL, secret: CURSOR_LEDGER_SENTINEL }]);
    writeStageRuns(join(fix.home, '.gstack-extend'), [known]);
    const relative = runCursorRecipe({ ...base, GSTACK_EXTEND_STATE_DIR: 'rel-decoy' }, ['known-session'], fix.home);
    expect(relative.status).toBe(0);
    expect(relative.stdout).toContain('"model":"grok-4.7"');
    expect(relative.stdout).not.toContain(CURSOR_LEDGER_SENTINEL);

    const missing = makeTelemetryFixture('off');
    const absent = runCursorRecipe({ ...missing.env }, ['known-session'], missing.home);
    expect(absent.status).toBe(0);
    expect(absent.stdout.trim()).toBe('missing-file');

    const unmatched = makeTelemetryFixture('off');
    writeStageRuns(join(unmatched.home, '.gstack-extend'), [{ ...known, session_id: 'other-session' }]);
    const none = runCursorRecipe({ ...unmatched.env }, ['known-session', 'implement', known.started_at], unmatched.home);
    expect(none.status).toBe(0);
    expect(none.stdout.trim()).toBe('no-match');

    const several = makeTelemetryFixture('off');
    const second = { ...known, stage: 'review', started_at: '2026-10-08T18:05:00Z', model: 'other-model' };
    writeStageRuns(join(several.home, '.gstack-extend'), [known, second]);
    const many = runCursorRecipe({ ...several.env }, ['known-session'], several.home);
    expect(many.status).toBe(0);
    expect(many.stdout.split('\n')[0]).toBe('multiple-match');
    expect(many.stdout).toContain('"model":"grok-4.7"');
    expect(many.stdout).toContain('"model":"other-model"');
    const narrowed = runCursorRecipe({ ...several.env }, ['known-session', 'implement', known.started_at], several.home);
    expect(narrowed.status).toBe(0);
    expect(narrowed.stdout).not.toContain('multiple-match');
    expect(narrowed.stdout.trim()).toBe(JSON.stringify(known));

    const dirty = makeTelemetryFixture('off');
    const dirtyFile = writeStageRuns(join(dirty.home, '.gstack-extend'), [known]);
    writeFileSync(dirtyFile, `{not-json ${CURSOR_LEDGER_SENTINEL}\n` + JSON.stringify({
      ...known,
      model: { id: CURSOR_LEDGER_SENTINEL },
      secret: CURSOR_LEDGER_SENTINEL,
    }) + '\n' + JSON.stringify({ ...known, session_id: 'other-session', model: CURSOR_LEDGER_SENTINEL }) + '\n');
    const dirtyBefore = readFileSync(dirtyFile);
    const dirtyMtime = statSync(dirtyFile).mtimeMs;
    const projected = runCursorRecipe({ ...dirty.env }, ['known-session'], dirty.home);
    expect(projected.status).toBe(0);
    expect(projected.stdout).toContain('malformed-lines: 1');
    expect(projected.stdout).toContain('"model":null');
    expect(projected.stdout).not.toContain(CURSOR_LEDGER_SENTINEL);
    expect(projected.stdout).not.toContain('not-json');
    expect(readFileSync(dirtyFile).equals(dirtyBefore)).toBe(true);
    expect(statSync(dirtyFile).mtimeMs).toBe(dirtyMtime);
    expect(recipe).toContain('main()');

    // The documented invocation is isolated: a module planted in the operator's cwd is never imported.
    const invocation = readFileSync(DOC, 'utf8').split('\n').find(line => line.startsWith('python3 ') && line.includes("'known-session'"));
    expect(invocation?.startsWith('python3 -I - ')).toBe(true);
    const planted = makeTelemetryFixture('off');
    writeStageRuns(join(planted.home, '.gstack-extend'), [known]);
    writeFileSync(join(planted.home, 'json.py'), `raise SystemExit("${CURSOR_LEDGER_SENTINEL}")\n`);
    const isolated = runCursorRecipe({ ...planted.env }, ['known-session'], planted.home);
    expect(isolated.status).toBe(0);
    expect(isolated.stdout.trim()).toBe(JSON.stringify(known));
    expect(isolated.stdout + isolated.stderr).not.toContain(CURSOR_LEDGER_SENTINEL);
  });

  test('every Cursor reader reason in the registry has its documented anchor row', () => {
    const result = spawnSync('python3', ['-B', '-I', '-c',
      'import json, sys\nsys.path.insert(0, sys.argv[1])\nimport telemetry\nprint(json.dumps(telemetry.CURSOR_SDK_REASONS))',
      join(ROOT, 'bin/lib')], { encoding: 'utf8' });
    expect([result.status, result.stderr]).toEqual([0, '']);
    const registry = JSON.parse(result.stdout) as Array<[string, string]>;
    for (const [code, anchor] of registry) expect(anchor).toBe(`cursor-sdk-${code}`);
    const doc = readFileSync(DOC, 'utf8');
    const documented = [...doc.matchAll(/<a id="(cursor-sdk-[a-z-]+)"><\/a>`([a-z-]+)`/g)].map(match => [match[2], match[1]]);
    expect(documented).toEqual(registry);
  });

  test('T40 documents the store contract, the reason rows, and the pending native check', () => {
    const doc = readFileSync(DOC, 'utf8');
    const cursor = doc.slice(doc.indexOf('## Cursor and quota'));
    expect(cursor.startsWith('## Cursor and quota')).toBe(true);
    expect(cursor).toContain('numeric_unit="milliseconds"');
    expect(cursor).toContain('epoch milliseconds');
    expect(cursor).toContain('list of `{id, value}`');
    expect(cursor).toContain('`params` may be a dict');
    expect(cursor).toContain('not served or billed proof');
    expect(cursor).toContain('0.36.0.1');
    expect(cursor).toContain('dated pre-repair');
    expect(cursor).toContain('designs/review-independence.md#8-provenance-feasibility');
    expect(cursor).toContain('Doctor reports skill-usage pairing, not model coverage');
    expect(cursor).toContain('GSTACK_EXTEND_TELEMETRY_DEBUG=1');
    expect(cursor).toContain('`pwd -P`');
    expect(cursor).toContain('stale open run');
    expect(cursor).toContain('2-5 minute target is an unmeasured');
    expect(cursor).toContain('not native evidence');
    expect(cursor.replace(/\s+/g, ' ')).toContain('Do not rewrite old rows');
    expect(cursor).toContain('100000000000');
    expect(cursor).toContain('does not change supported Paseo behavior');
    expect(doc).toContain('Captured 2026-09-25T12:28:18Z');
    // Anchors come from the registry; the registry-to-docs lock test above owns their order and spelling.
    const registry = spawnSync('python3', ['-B', '-I', '-c',
      'import json, sys\nsys.path.insert(0, sys.argv[1])\nimport telemetry\nprint(json.dumps(telemetry.CURSOR_SDK_REASONS))',
      join(ROOT, 'bin/lib')], { encoding: 'utf8' });
    expect(registry.status).toBe(0);
    for (const [, anchor] of JSON.parse(registry.stdout) as Array<[string, string]>) {
      expect(cursor).toContain(`id="${anchor}"`);
    }
    // Debug privacy is promised only for the fixed reason lines; the provenance trace prints recorded values.
    expect(cursor.replace(/\s+/g, ' ')).toContain('provenance agent=… model=… effort=…');
    expect(cursor.replace(/\s+/g, ' ')).toContain('Copy only lines that begin `telemetry: cursor-sdk` into a receipt');
  });
});
