/**
 * Doc/join contract (deterministic, stub mode, no gstack) plus opportunistic
 * real-upstream checks. Real logger/config copies omit the network sync helper;
 * HOME and all inherited state overrides are isolated by telemetry-env.
 */

import { afterAll, describe, test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
// Development dependency pinned in bun.lock: run `bun install --frozen-lockfile` before this suite.
import Ajv from 'ajv';
import { quotaFixture } from './helpers/quota-env';
import { REAL_GSTACK_BIN, cleanupTelemetryFixtures, makeTelemetryFixture } from './helpers/telemetry-env';
import { computeTestSelection, listTestFiles } from './helpers/touchfiles';

// Hundreds of fixture homes are removed here; the default 5 s hook limit is too tight on a loaded machine.
afterAll(cleanupTelemetryFixtures, 60_000);

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

/** Open handoffs: `<key>/<sha256(session)>.json` per invocation, or a legacy `<key>.json`. */
function handoffFiles(home: string) {
  const dir = join(home, '.gstack-extend/telemetry');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? readdirSync(join(dir, entry.name)).filter(name => /^[0-9a-f]{64}\.json$/.test(name)).map(name => join(entry.name, name))
    : entry.name.endsWith('.json') ? [entry.name] : []);
}

function allowedConstants(env: Record<string, string>) {
  const result = spawnSync('python3', ['-B', '-I', '-c',
    'import json, sys\nsys.path.insert(0, sys.argv[1])\nimport telemetry\nprint(json.dumps({"harnesses": list(telemetry.HARNESSES), '
      + '"outcomes": list(telemetry.OUTCOMES), "routes": list(telemetry.ROUTES), "sources": list(telemetry.SOURCES), '
      + '"run_modes": list(telemetry.RUN_MODES), "run_mode_sources": list(telemetry.RUN_MODE_SOURCES), '
      + '"user_signals_sources": list(telemetry.USER_SIGNALS_SOURCES), "blocked_reason_sources": list(telemetry.BLOCKED_REASON_SOURCES), '
      + '"schema_version": telemetry.SCHEMA_VERSION, "release": telemetry.RELEASE_RE.pattern}))',
    LIB,
  ], { env, encoding: 'utf8' });
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout) as {
    harnesses: string[]; outcomes: string[]; routes: string[]; sources: string[];
    run_modes: string[]; run_mode_sources: string[]; user_signals_sources: string[]; blocked_reason_sources: string[];
    schema_version: number; release: string;
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
const V2_FIELDS = [...V1_FIELDS, 'workspace_host', 'host_agent_id'];
const V3_FIELDS = [...V2_FIELDS, 'run_mode', 'run_mode_source', 'questions', 'user_wait_s', 'resumes',
  'user_signals_source', 'blocked_reason', 'blocked_reason_source'];
const V4_FIELDS = [...V1_FIELDS, 'workspace_host', ...V3_FIELDS.slice(22)];
// Immutable historical fixtures, independent of current docs, schema and writer constants.
function historicalRow(): Record<string, unknown> {
  return { stage: 'roadmap', agent: 'claude', model: 'claude-opus-5', effort: 'xhigh', rung: 0,
    outcome: 'success', started_at: '2026-09-20T12:00:00Z', duration_s: 3, session_id: 'extend-example',
    repo: 'acme/widget', branch: 'main', work_item: null, source: 'gstack-extend', route: 'cli', entrypoint_raw: 'cli',
    schema_version: 1, producer_version: '1.2.3.4', agent_source: 'detected', model_source: 'detected', effort_source: 'detected' };
}
function historicalV2Row(): Record<string, unknown> {
  return { ...historicalRow(), schema_version: 2, workspace_host: 'paseo', host_agent_id: 'example-agent' };
}
function historicalV3Row(): Record<string, unknown> {
  return { ...historicalV2Row(), schema_version: 3, producer_version: '1.0.0', route: 'conductor',
    workspace_host: 'conductor', host_agent_id: 'example-agent', run_mode: 'user-directed', run_mode_source: 'Paseo',
    questions: null, user_wait_s: null, resumes: null, user_signals_source: 'session-log-unavailable',
    blocked_reason: null, blocked_reason_source: 'not-blocked' };
}
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

// Frozen pre-v2 reader command from planning HEAD 45a60d1; never derive this from current docs.
const V1_READER_COMMAND = [
  "bun --no-install -e '",
  "import Ajv from \"ajv\";",
  "import { createReadStream, readFileSync, statSync } from \"node:fs\";",
  "import { createInterface } from \"node:readline\";",
  "import { Readable } from \"node:stream\";",
  "",
  "const DOC = \"See docs/telemetry.md#schema-validation\";",
  "const FIELDS = [\"stage\", \"agent\", \"model\", \"effort\", \"rung\", \"outcome\", \"started_at\", \"duration_s\", \"session_id\",",
  "  \"repo\", \"branch\", \"work_item\", \"source\", \"route\", \"entrypoint_raw\", \"schema_version\", \"producer_version\",",
  "  \"agent_source\", \"model_source\", \"effort_source\"];",
  "const EXAMPLE = {\"stage\":\"roadmap\",\"agent\":\"claude\",\"model\":\"claude-opus-5\",\"effort\":\"xhigh\",\"rung\":0,\"outcome\":\"success\",\"started_at\":\"2026-09-20T12:00:00Z\",\"duration_s\":3,\"session_id\":\"extend-example\",\"repo\":\"acme/widget\",\"branch\":\"main\",\"work_item\":null,\"source\":\"gstack-extend\",\"route\":\"cli\",\"entrypoint_raw\":\"cli\",\"schema_version\":1,\"producer_version\":\"1.2.3.4\",\"agent_source\":\"detected\",\"model_source\":\"detected\",\"effort_source\":\"detected\"};",
  "const EVIDENCE = \"a null value needs source unknown; any other value needs flag or detected\";",
  "const WHY = {",
  "  required: [\"a required field is missing\", \"write every field the contract requires, never a default\"],",
  "  additionalProperties: [\"a field outside this contract\", \"remove it, or route the row to its own contract\"],",
  "  type: [\"a value has the wrong JSON type\", \"write the documented type\"],",
  "  const: [\"a value differs from the fixed contract value\", \"write the documented value\"],",
  "  enum: [\"a value is outside the documented set\", \"write a documented value\"],",
  "  pattern: [\"a string does not match the documented format\", \"write the documented format\"],",
  "  minimum: [\"a number is below the documented minimum\", \"write a nonnegative value\"],",
  "  \"false schema\": [\"v1 metadata without schema_version\", \"keep the row whole; never strip or add fields\"],",
  "};",
  "const counts = { rows: 0, blank: 0, v1: 0, legacy: 0, invalid: 0, unsupported: 0, routed: 0 };",
  "let shown = 0;",
  "let hidden = 0;",
  "function report(line, where, keyword, cause, fix) {",
  "  if (shown === 20) return hidden++;",
  "  shown++;",
  "  console.log(`line ${line}: ${where} ${keyword}: ${cause}. Fix: ${fix}. ${DOC}`);",
  "}",
  "",
  "let validate;",
  "try {",
  "  validate = new Ajv({ strict: true, allErrors: true }).compile(JSON.parse(readFileSync(\"docs/stage-runs.schema.json\", \"utf8\")));",
  "} catch {",
  "  console.error(`schema unavailable: run from the gstack-extend checkout root. ${DOC}`);",
  "  process.exit(1);",
  "}",
  "async function* utf8(file) {",
  "  const decoder = new TextDecoder(\"utf-8\", { fatal: true, ignoreBOM: true });",
  "  for await (const chunk of createReadStream(file)) yield decoder.decode(chunk, { stream: true });",
  "  yield decoder.decode();",
  "}",
  "const file = process.env.STAGE_RUNS_FILE;",
  "let lines = [JSON.stringify(EXAMPLE)];",
  "if (file) {",
  "  try {",
  "    if (!statSync(file).isFile()) throw new Error();",
  "    lines = createInterface({ input: Readable.from(utf8(file)), crlfDelay: Infinity });",
  "  } catch {",
  "    console.error(`input unreadable: pass a readable JSONL file. ${DOC}`);",
  "    process.exit(1);",
  "  }",
  "}",
  "",
  "let line = 0;",
  "try {",
  "  for await (const text of lines) {",
  "    line++;",
  "    if (text.trim() === \"\") { counts.blank++; continue; }",
  "    counts.rows++;",
  "    let row;",
  "    try { row = JSON.parse(text); } catch { row = undefined; }",
  "    if (row === null || typeof row !== \"object\" || Array.isArray(row)) {",
  "      counts.invalid++;",
  "      report(line, \"(root)\", \"json\", \"the line is not one JSON object\", \"write one JSON object per line\");",
  "      continue;",
  "    }",
  "    if (typeof row.source !== \"string\" || row.source.trim() === \"\") {",
  "      counts.invalid++;",
  "      report(line, \"/source\", \"source\", \"the writer label is missing, blank or not a string\", \"every row names its writer\");",
  "      continue;",
  "    }",
  "    if (row.source !== \"gstack-extend\") { counts.routed++; continue; }",
  "    let kind = \"legacy\";",
  "    if (Object.hasOwn(row, \"schema_version\")) {",
  "      const version = row.schema_version;",
  "      if (Number.isInteger(version) && version >= 2) {",
  "        counts.unsupported++;",
  "        report(line, \"/schema_version\", \"unsupported\", \"newer than this contract\", \"keep the row and use a schema release that supports it\");",
  "        continue;",
  "      }",
  "      if (version !== 1) {",
  "        counts.invalid++;",
  "        report(line, \"/schema_version\", \"version\", \"not a positive integer\", \"correct the producer; never guess a version\");",
  "        continue;",
  "      }",
  "      kind = \"v1\";",
  "    }",
  "    if (validate(row)) { counts[kind]++; continue; }",
  "    counts.invalid++;",
  "    const seen = new Set();",
  "    for (const error of validate.errors) {",
  "      if (error.keyword === \"if\") continue;",
  "      const field = error.keyword === \"required\" ? error.params.missingProperty : error.instancePath.slice(1);",
  "      const where = FIELDS.includes(field) ? \"/\" + field : \"(root)\";",
  "      if (seen.has(where + error.keyword)) continue;",
  "      seen.add(where + error.keyword);",
  "      const [cause, fix] = WHY[error.keyword] ?? [\"the row fails the contract\", \"compare it with the schema\"];",
  "      const evidence = where.endsWith(\"_source\") && (error.keyword === \"const\" || error.keyword === \"enum\");",
  "      report(line, where, error.keyword, evidence ? EVIDENCE : cause, evidence ? \"correct the producer, never the saved row\" : fix);",
  "    }",
  "  }",
  "} catch {",
  "  console.error(`input unreadable or invalid UTF-8 after line ${line}. ${DOC}`);",
  "  process.exit(1);",
  "}",
  "if (hidden) console.log(`${hidden} more diagnoses not shown`);",
  "console.log(`summary: rows=${counts.rows} valid=${counts.v1 + counts.legacy} v1=${counts.v1} legacy=${counts.legacy} invalid=${counts.invalid} unsupported=${counts.unsupported} routed=${counts.routed} blank=${counts.blank}`);",
  "process.exitCode = counts.invalid || counts.unsupported ? 1 : 0;",
  "'",
  "",
].join('\n');

/** The reusable validator block under "## Schema validation", byte for byte. */
function validationCommand(doc: string) {
  const blocks = [...section(doc, '## Schema validation').matchAll(/~~~sh\n([\s\S]*?)~~~/g)].map(match => match[1]);
  const commands = blocks.filter(block => block.startsWith('validate_stage_runs() {\nbun --no-install -e '));
  if (commands.length !== 1) {
    throw new Error('docs/telemetry.md "## Schema validation" must contain exactly one validate_stage_runs function block');
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
  const diagnoses = result.stderr.split('\n').filter(line => line.startsWith('line '));
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, diagnoses, file,
    summary: result.stdout.split('\n').find(line => line.startsWith('summary: ')) ?? '' };
}

function summaryOf(counts: Partial<Record<'rows' | 'v4' | 'v3' | 'v2' | 'v1' | 'legacy' | 'invalid' | 'unsupported' | 'routed' | 'blank', number>>) {
  const value = (name: keyof typeof counts) => counts[name] ?? 0;
  return `summary: rows=${value('rows')} valid=${value('v4') + value('v3') + value('v2') + value('v1') + value('legacy')} v4=${value('v4')} v3=${value('v3')} v2=${value('v2')} v1=${value('v1')} legacy=${value('legacy')} `
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
    const runModes = backtickedValues(valueCell(doc, 'run_mode'));
    const runModeSources = backtickedValues(valueCell(doc, 'run_mode_source'));
    const userSignalsSources = backtickedValues(valueCell(doc, 'user_signals_source'));
    const blockedReasonSources = backtickedValues(valueCell(doc, 'blocked_reason_source'));
    if (!same(agents, constants.harnesses)) mismatch('agent values differ from HARNESSES', agents, constants.harnesses);
    if (!same(outcomes, constants.outcomes)) mismatch('outcome values differ from v2 vocabulary', outcomes, constants.outcomes);
    if (!same(routes, constants.routes)) mismatch('route values differ from ROUTES', routes, constants.routes);
    if (!same(runModes, constants.run_modes)) mismatch('run_mode values differ from RUN_MODES', runModes, constants.run_modes);
    if (!same(runModeSources, constants.run_mode_sources)) mismatch('run_mode_source values differ from RUN_MODE_SOURCES', runModeSources, constants.run_mode_sources);
    if (!same(userSignalsSources, constants.user_signals_sources)) mismatch('user_signals_source values differ from USER_SIGNALS_SOURCES', userSignalsSources, constants.user_signals_sources);
    if (!same(blockedReasonSources, constants.blocked_reason_sources)) mismatch('blocked_reason_source values differ from BLOCKED_REASON_SOURCES', blockedReasonSources, constants.blocked_reason_sources);
    for (const field of ['agent_source', 'model_source', 'effort_source']) {
      const values = backtickedValues(valueCell(doc, field));
      const expected = field === "agent_source" ? constants.sources : [...constants.sources, "requested"];
      if (!same(values, expected)) mismatch(`${field} values differ from schema vocabulary`, values, expected);
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

  test('same-root collision keeps each invocation: finishes pair first start with first finish, with their own identity', () => {
    const fix = makeTelemetryFixture('community');
    const repo = initCheckout(fix.home, fix.env, 'checkout-dir', 'git@github.com:acme/widget.git');
    const started = ['first', 'second'].map(() => {
      const result = runTelemetry(fix.env, repo, ['start', '--skill', 'extend:roadmap']);
      expect(result.status).toBe(0);
      return { sid: result.stdout.match(/session=(\S+)/)?.[1] ?? '', epoch: Number(result.stdout.match(/start=(\d+)/)?.[1]) };
    });
    expect(started[0].sid).not.toBe(started[1].sid);
    expect(handoffFiles(fix.home)).toHaveLength(2);
    expect(runTelemetry(fix.env, repo, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    expect(runTelemetry(fix.env, repo, ['finish', '--skill', 'extend:roadmap', '--outcome', 'error']).status).toBe(0);
    const outcomes = ['success', 'error'];
    expect(fix.readLedger().map(row => [row.session_id, row.started_at, row.outcome])).toEqual(
      started.map((item, index) => [item.sid, isoEpoch(item.epoch), outcomes[index]]));
    const usage = fix.readJsonl();
    expect(usage.filter(row => row.event_type === 'skill_start').map(row => row.session_id)).toEqual(started.map(item => item.sid));
    expect(usage.filter(row => row.event_type === 'skill_run').map(row => [row.session_id, row.outcome])).toEqual(
      started.map((item, index) => [item.sid, outcomes[index]]));
    expect(handoffFiles(fix.home)).toHaveLength(0);
  });

  test('an explicit retry with the original ids appends neither a second stage-runs row nor a second skill_run', () => {
    const fix = makeTelemetryFixture('community');
    const repo = initCheckout(fix.home, fix.env, 'checkout-dir', 'git@github.com:acme/widget.git');
    const start = runTelemetry(fix.env, repo, ['start', '--skill', 'extend:roadmap']);
    expect(start.status).toBe(0);
    const sid = start.stdout.match(/session=(\S+)/)?.[1] ?? '';
    const epoch = start.stdout.match(/start=(\d+)/)?.[1] ?? '';
    expect(runTelemetry(fix.env, repo, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(runTelemetry(fix.env, repo, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success', '--session-id', sid, '--start', epoch]).status).toBe(0);
    }
    expect(fix.readLedger().filter(row => row.session_id === sid)).toHaveLength(1);
    expect(fix.readJsonl().filter(row => row.event_type === 'skill_run' && row.session_id === sid)).toHaveLength(1);
    expect(handoffFiles(fix.home)).toHaveLength(0);
  });
});

/** The text under one `###` heading, up to the next heading of any level. Comment lines inside ~~~ fences are not headings. */
function subsection(doc: string, heading: string) {
  const lines = doc.split('\n');
  const at = lines.findIndex(line => line.trimEnd() === heading);
  if (at < 0) throw new Error(`docs/telemetry.md is missing the ${JSON.stringify(heading)} section`);
  let fenced = false;
  let end = lines.length;
  for (let index = at + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith('~~~')) fenced = !fenced;
    else if (!fenced && /^#{1,3} /.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(at, end).join('\n');
}

describe('docs/telemetry.md run identity and work item', () => {
  test('the Collision limit table lists exactly the pairing reasons the writer emits', () => {
    const script = `import json, sys
sys.path.insert(0, ${JSON.stringify(LIB)})
import telemetry
now = 1_700_000_000
labels = set()
for skill in ("extend:roadmap", "extend:pair-review"):
    for stored in (None, "h"):
        for current in (None, "h"):
            item = telemetry.Candidate({"session_id": "sid", "start": str(now - 10), "harness": stored}, "p", False)
            telemetry.classify(item, skill, now, current)
            if item.classification[3]:
                labels.add(item.classification[3])
print(json.dumps(sorted(labels)))
`;
    const run = spawnSync('python3', ['-I', '-c', script], { encoding: 'utf8', timeout: 10_000 });
    expect(run.status).toBe(0);
    const emitted = JSON.parse(run.stdout) as string[];
    expect(emitted).toHaveLength(4);
    const table = subsection(docText(), '### Collision limit');
    const documented = [...table.matchAll(/^\| \d \|.*\| `([^`]+)` \|$/gm)].map(match => match[1]);
    if (!same(documented, emitted)) mismatch('the Collision limit pairing table differs from the reasons classify() emits', documented, emitted);
  });

  // Value: protects=diagnostics tolerate damaged rows without following links or blocking on FIFOs;
  // fails_when=listing opens unsafe files or join parsing aborts on malformed JSON; why_new=the recipe test used valid files; seam=none;
  // no_claim=installed acceptance (owned fixture state and real documented recipe).
  test('the quick-start recipes run: join by work item, read the GE_TELEMETRY line, list open handoffs', () => {
    const fix = makeTelemetryFixture('community');
    const repo = initCheckout(fix.home, fix.env, 'checkout-dir', 'git@github.com:acme/widget.git');
    const blocks = [...subsection(docText(), '### Work item and launcher quick-start').matchAll(/~~~sh\n([\s\S]*?)~~~/g)].map(match => match[1]);
    const recipe = (marker: string) => {
      const found = blocks.filter(block => block.includes(marker));
      if (found.length !== 1) throw new Error(`docs/telemetry.md quick-start must contain exactly one ~~~sh block with ${JSON.stringify(marker)}`);
      return found[0];
    };
    const exported = recipe('export GSTACK_EXTEND_WORK_ITEM=');
    expect(exported).toContain('"issue-1234"');
    const env = { ...fix.env, GSTACK_EXTEND_WORK_ITEM: 'issue-1234' };
    const start = runTelemetry(env, repo, ['start', '--skill', 'extend:roadmap']);
    expect(start.status).toBe(0);
    const geLine = start.stdout.trim();
    const sid = geLine.match(/session=(\S+)/)?.[1] ?? '';
    const shell = (script: string, extra: Record<string, string> = {}) =>
      spawnSync('bash', ['-c', script], { env: { ...fix.env, ...extra }, encoding: 'utf8', timeout: 15_000 });

    const listing = shell(recipe('glob.glob'));
    expect(listing.status).toBe(0);
    expect(listing.stdout.trim().split('\n')).toHaveLength(1);
    const [skill, root, listedSid, item, uncertain] = listing.stdout.trim().split('\t');
    expect([skill, listedSid, item, uncertain]).toEqual(['extend:roadmap', sid, 'issue-1234', 'False']);
    expect(root).toBe(realpathSync(repo));
    for (const content of ['[]', 'null']) {
      writeFileSync(join(fix.home, '.gstack-extend/telemetry', '0'.repeat(64) + '.json'), content);
      const damaged = shell(recipe('glob.glob'));
      expect(damaged.status).toBe(0);
      expect(damaged.stdout).toContain(sid);
      expect(damaged.stdout.trim().split('\n')).toHaveLength(2);
    }
    const telemetry = join(fix.home, '.gstack-extend/telemetry');
    symlinkSync(listing.stdout.trim().split('\t')[5], join(telemetry, '1'.repeat(64) + '.json'));
    expect(spawnSync('mkfifo', [join(telemetry, '2'.repeat(64) + '.json')]).status).toBe(0);
    const unsafe = spawnSync('bash', ['-c', recipe('glob.glob')], { env: fix.env, encoding: 'utf8', timeout: 1_000 });
    expect(unsafe.status).toBe(0);
    expect(unsafe.stdout.trim().split('\n')).toHaveLength(2);
    expect(unsafe.stdout).toContain(sid);

    const parsed = shell(recipe('GE_LINE'), { GE_LINE: geLine });
    expect(parsed.status).toBe(0);
    expect(parsed.stdout.trim()).toBe(`${sid} ${geLine.match(/start=(\d+)/)![1]} issue-1234`);
    const quoted = shell(recipe('GE_LINE'), { GE_LINE: 'GE_TELEMETRY: session=extend-x start=5 work_item="a b=c\\"d\\\\e"' });
    expect(quoted.stdout.trim()).toBe('extend-x 5 a b=c"d\\e');
    const copiedLine = shell(recipe('GE_LINE'), { GE_LINE: geLine + '\n' });
    expect(copiedLine.status).toBe(0);
    expect(copiedLine.stdout).toBe(parsed.stdout);
    for (const line of ['not a telemetry line', 'GE_TELEMETRY: session=extend-x start=5 work_item="truncated']) {
      const invalidLine = shell(recipe('GE_LINE'), { GE_LINE: line });
      expect(invalidLine.status).toBe(1);
      expect(invalidLine.stderr).toContain('Expected a GE_TELEMETRY line');
      expect(invalidLine.stderr).not.toContain('Traceback');
    }

    expect(runTelemetry(fix.env, repo, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    const joined = shell(recipe('row.get("work_item")'));
    expect(joined.status).toBe(0);
    expect(joined.stdout.trim().split(' ').slice(0, 3)).toEqual(['roadmap', sid, 'success']);
    expect(fix.readLedger()[0].work_item).toBe('issue-1234');
    const ledger = fix.ledgerFiles()[0];
    writeFileSync(ledger, Buffer.concat([Buffer.from([0xff, 0x0a]),
      Buffer.from('{torn\nnull\n[]\n{"work_item":"issue-1234"}\n'), readFileSync(ledger)]));
    const damagedJoin = shell(recipe('row.get("work_item")'));
    expect(damagedJoin.status).toBe(0);
    expect(damagedJoin.stdout).toBe('None None None None\n' + joined.stdout);
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
    // v1 rows never carry blocked; the v2 vocabulary is the writer's whole OUTCOMES.
    const v1Outcomes = constants.outcomes.filter((value: string) => value !== 'blocked');
    if (!same(defs.outcome.enum, v1Outcomes)) mismatch('schema v1 outcome enum differs from OUTCOMES without blocked', defs.outcome.enum, v1Outcomes);
    if (!same(defs.outcome_2.enum, constants.outcomes)) mismatch('schema v2 outcome enum differs from OUTCOMES', defs.outcome_2.enum, constants.outcomes);
    const v1Routes = [...constants.routes, 'conductor'];
    if (!same(defs.route.enum, v1Routes)) mismatch('schema v1-v3 route enum differs from ROUTES + conductor', defs.route.enum, v1Routes);
    if (!same(defs.route_4.enum, constants.routes)) mismatch('schema v4 route enum differs from ROUTES', defs.route_4.enum, constants.routes);
    if (!same(defs.evidence_source.enum, constants.sources)) mismatch('schema evidence_source enum differs from SOURCES', defs.evidence_source.enum, constants.sources);
    if (!same(defs.run_mode.enum, constants.run_modes)) mismatch('schema run_mode enum differs from RUN_MODES', defs.run_mode.enum, constants.run_modes);
    if (!same(defs.run_mode_source_4.enum, constants.run_mode_sources)) mismatch('schema v4 run_mode_source enum differs from RUN_MODE_SOURCES', defs.run_mode_source_4.enum, constants.run_mode_sources);
    if (!same(defs.user_signals_source.enum, constants.user_signals_sources)) mismatch('schema user_signals_source enum differs from USER_SIGNALS_SOURCES', defs.user_signals_source.enum, constants.user_signals_sources);
    if (!same(defs.blocked_reason_source.enum, constants.blocked_reason_sources)) mismatch('schema blocked_reason_source enum differs from BLOCKED_REASON_SOURCES', defs.blocked_reason_source.enum, constants.blocked_reason_sources);
    expect(defs.schema_version.const).toBe(1);
    expect(defs.schema_version_2.const).toBe(2);
    expect(defs.schema_version_3.const).toBe(3);
    expect(defs.schema_version_4.const).toBe(constants.schema_version);
    // One release grammar: what the writer accepts from VERSION is exactly what the schema accepts.
    expect(defs.producer_version.pattern).toBe('^[0-9]+(\\.[0-9]+){3}$');
    expect(defs.producer_version_2.pattern).toBe('^' + constants.release + '$');
    expect(Object.keys(schema.properties)).toEqual(V3_FIELDS);
    expect(Object.keys(defs.v4.properties)).toEqual(V3_FIELDS);
    expect(defs.v4.required).toEqual(V4_FIELDS);
    expect(defs.v4.properties.host_agent_id).toBe(false);
    expect(Object.keys(defs.v3.properties)).toEqual(V3_FIELDS);
    expect(defs.v3.required).toEqual(V3_FIELDS);
    expect(Object.keys(defs.v2.properties)).toEqual(V3_FIELDS);
    expect(defs.v2.required).toEqual(V2_FIELDS);
    expect(Object.keys(defs.v1.properties)).toEqual(V3_FIELDS);
    expect(defs.v1.required).toEqual(V1_FIELDS);
    expect(defs.legacy.required).toEqual(V1_FIELDS.slice(0, 13));
    expect(Object.keys(defs.legacy.properties)).toEqual([...V1_FIELDS.slice(0, 15), ...METADATA.slice(1), ...V3_FIELDS.slice(20)]);
  });

  test('wrapper-emitted rows are v4, name this checkout as producer, and validate', () => {
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
      expect(Object.keys(row)).toEqual(V4_FIELDS);
      expect(row).toMatchObject({ schema_version: 4, producer_version: RELEASE });
      expect([row.agent_source, row.model_source, row.effort_source]).toEqual(sources);
      expect(verdict(row)).toEqual({ ok: true, errors: [] });
    }
  }, 30_000);

  test('requested model and effort rows validate against the schema and documented reader, and detection wins', () => {
    const fix = makeTelemetryFixture('off');
    const repo = initCheckout(fix.home, fix.env, 'checkout-dir', 'git@github.com:acme/widget.git');
    const requestedEnv = { ...fix.env, GSTACK_EXTEND_MODEL: 'requested-model', GSTACK_EXTEND_EFFORT: 'high' };
    expect(runTelemetry(requestedEnv, repo, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    expect(runTelemetry(requestedEnv, repo, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    const requestedRow = fix.readLedger().at(-1)!;
    expect(Object.keys(requestedRow)).toEqual(V4_FIELDS);
    expect(requestedRow).toMatchObject({ model: 'requested-model', effort: 'high' });
    expect([requestedRow.agent_source, requestedRow.model_source, requestedRow.effort_source]).toEqual([
      'unknown', 'requested', 'requested',
    ]);
    expect(verdict(requestedRow)).toEqual({ ok: true, errors: [] });
    const validated = runValidation(JSON.stringify(requestedRow));
    expect([validated.status, validated.summary]).toEqual([0, summaryOf({ rows: 1, v4: 1 })]);

    const sid = '0c7f2e29-0000-4000-8000-0000000000c2';
    const claudeEnv = { ...requestedEnv, CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: sid };
    expect(runTelemetry(claudeEnv, repo, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    const at = new Date().toISOString();
    const transcript = join(fix.home, '.claude/projects/-w', sid + '.jsonl');
    mkdirSync(dirname(transcript), { recursive: true });
    writeFileSync(transcript, JSON.stringify({
      type: 'assistant', timestamp: at, effort: 'xhigh',
      message: { id: 'm-' + at, model: 'claude-opus-5', role: 'assistant' },
    }) + '\n');
    expect(runTelemetry(claudeEnv, repo, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    const detectedRow = fix.readLedger().at(-1)!;
    expect(detectedRow).toMatchObject({ agent: 'claude', model: 'claude-opus-5', effort: 'xhigh' });
    expect([detectedRow.agent_source, detectedRow.model_source, detectedRow.effort_source]).toEqual([
      'detected', 'detected', 'detected',
    ]);
    expect(verdict(detectedRow)).toEqual({ ok: true, errors: [] });
  }, 30_000);

  test('v2, v3, and v4 three-part producers pass schema and documented reader; malformed widths fail', () => {
    for (const producer_version of ['0.47.0', '1.0.0', '0.47', '0.47.0.0.0']) {
      for (const [base, kind] of [[historicalV2Row(), 'v2'], [historicalV3Row(), 'v3'], [quickstartRow(), 'v4']] as const) {
        const row = { ...base, producer_version };
        const valid = ['0.47.0', '1.0.0'].includes(producer_version);
        expect(verdict(row).ok).toBe(valid);
        const result = runValidation(JSON.stringify(row));
        expect(result.status).toBe(valid ? 0 : 1);
        expect(result.summary).toBe(summaryOf(valid ? { rows: 1, [kind]: 1 } : { rows: 1, invalid: 1 }));
        if (!valid) expect(result.stderr).toContain('/producer_version pattern');
      }
    }
  });

  test('genuine legacy rows validate with route and entrypoint_raw each optional; hybrids are not legacy', () => {
    const v1 = historicalRow();
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
    const v1 = historicalRow();
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
      [{ schema_version: 5 }, ['/schema_version const']],
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

  test('quota runs enrichment is unchanged by v1/v2/v3/v4 metadata and per-host files, and the metadata never reaches skill-usage', () => {
    const quota = quotaFixture();
    try {
      const attribution = { agent: 'codex', model: 'gpt-6-astra', effort: 'high', route: 'conductor', agent_source: 'flag' };
      const v1 = { ...historicalRow(), ...attribution };
      const v2 = { ...historicalV2Row(), ...attribution, workspace_host: 'paseo', host_agent_id: 'quota-host' };
      const v3 = { ...historicalV3Row(), ...attribution, workspace_host: 'paseo', host_agent_id: 'quota-host' };
      const v4 = { ...quickstartRow(), agent: 'codex', model: 'gpt-6-astra', effort: 'high', route: 'sdk', agent_source: 'flag', workspace_host: 'paseo' };
      expect(v1.schema_version).toBe(1);
      expect(v2.schema_version).toBe(2);
      expect(v3.schema_version).toBe(3);
      expect(v4.schema_version).toBe(4);
      const ledger = join(quota.env.GSTACK_EXTEND_STATE_DIR, 'analytics/stage-runs.jsonl');
      const hostDir = join(quota.env.GSTACK_EXTEND_STATE_DIR, 'analytics/stage-runs');
      mkdirSync(hostDir, { recursive: true });
      writeFileSync(ledger, [{ ...v1, session_id: 'run-v1' }, { ...legacyOf(v1), session_id: 'run-legacy' },
        { ...v2, producer_version: '0.47.0', session_id: 'run-v2' },
        { ...v2, producer_version: '1.0.0', session_id: 'run-v2-stable' },
        { ...v2, model: 'stale-model', session_id: 'run-v3' }]
        .map(row => JSON.stringify(row)).join('\n') + '\n');
      writeFileSync(join(hostDir, 'host-a.jsonl'), [
        JSON.stringify({ ...v3, session_id: 'run-v3' }),
        JSON.stringify({ ...v4, session_id: 'run-v4' }),
      ].join('\n') + '\n');
      const enriched = (sid: string) => {
        for (const [phase, at] of [['start', '2026-09-23T12:00:00Z'], ['finish', '2026-09-23T12:01:00Z']]) {
          const sample = quota.run(['sample', '--session-id', sid, '--phase', phase, '--json'], { GSTACK_EXTEND_QUOTA_NOW: at });
          expect(sample.status).toBe(0);
        }
        const runs = quota.run(['runs', '--session-id', sid, '--json'], { GSTACK_EXTEND_QUOTA_NOW: '2026-09-23T12:02:00Z' });
        expect(runs.status).toBe(0);
        const rows = JSON.parse(runs.stdout).runs as Array<Record<string, unknown>>;
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) for (const field of [...METADATA, ...V3_FIELDS.slice(20)]) expect(row).not.toHaveProperty(field);
        return rows.map(row => ({ stage: row.stage, agent: row.agent, model: row.model, effort: row.effort, route: row.route }));
      };
      const expected = { stage: 'roadmap', agent: 'codex', model: 'gpt-6-astra', effort: 'high', route: 'conductor' };
      expect(enriched('run-v1')).toEqual([expected]);
      expect(enriched('run-v2')).toEqual([expected]);
      expect(enriched('run-v2-stable')).toEqual([expected]);
      expect(enriched('run-v3')).toEqual([expected]);
      expect(enriched('run-v4')).toEqual([{ ...expected, route: 'sdk' }]);
      expect(enriched('run-legacy')).toEqual([expected]);
    } finally {
      quota.cleanup();
    }
    const fix = makeTelemetryFixture('community');
    expect(runTelemetry(fix.env, ROOT, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
    expect(runTelemetry(fix.env, ROOT, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success']).status).toBe(0);
    expect(Object.keys(fix.readLedger()[0])).toEqual(V4_FIELDS);
    const usage = JSON.stringify(fix.readJsonl()) + fix.readStubArgs().join('\n');
    for (const field of [...METADATA, ...V3_FIELDS.slice(20), 'producer', 'schema-version', 'detected']) expect(usage).not.toContain(field);
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
    // The included row is the quickstart row, so both examples stay one valid v4 row.
    expect(command).toContain('const EXAMPLE = ' + JSON.stringify(quickstartRow()) + ';');
    const result = runValidation();
    expect([result.status, result.stdout.trimEnd(), result.stderr]).toEqual([0, success, '']);
    const v1 = quickstartRow();
    const shown = runValidation([{ ...v1, model: null, model_source: 'flag' }, { ...v1, schema_version: 5 }]
      .map(row => JSON.stringify(row)).join('\n') + '\n');
    expect([shown.status, (shown.stderr + shown.stdout).trimEnd()]).toEqual([1, failure]);
    expect(shown.stdout).toBe(shown.summary + '\n');
    // One streamed pass: the schema is the only file read whole.
    expect(command).toContain('lines = jsonLines(file)');
    expect(command.match(/readFileSync\(/g)).toHaveLength(1);
  }, 30_000);

  // Every line carries its expected classification, written independently of the command.
  const v1 = () => historicalRow();
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
    [JSON.stringify({ ...v1(), schema_version: 5 }), 'unsupported'],
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
    expect([result.status, result.summary]).toEqual([1, expectedSummary(mixed)]);
    expect(result.stdout).toBe(result.summary + '\n');
    const failedLines = mixed.map(([, kind], index) => [kind, index + 1] as const)
      .filter(([kind]) => kind === 'invalid' || kind === 'unsupported').map(([, line]) => line);
    expect([...new Set(result.diagnoses.map(line => Number(line.match(/^line (\d+):/)![1])))]).toEqual(failedLines);
    for (const line of result.diagnoses) {
      expect(line).toMatch(/^line \d+: (\/[a-z_]+|\(root\)) [a-z ]+: .+\. Fix: .+\. See docs\/telemetry\.md#schema-validation$/);
    }
    expect(result.diagnoses).toContain(`line 13: /producer_version required: a required field is missing. Fix: keep the saved row unchanged; correct the producer to emit every field required by this branch. ${SEE}`);
    expect(result.diagnoses).toContain(`line 14: /effort_source const: a null value needs source unknown; a non-null agent or v1 value needs flag/detected; non-null v2 model/effort needs flag/detected/requested. Fix: correct the producer, never the saved row. ${SEE}`);
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
    expect([bom.status, bom.summary]).toEqual([1, summaryOf({ rows: 1, invalid: 1 })]);
    expect(bom.stdout).toBe(bom.summary + '\n');
    expect(bom.stderr).toContain('(root) json:');
  }, 30_000);

  test('a ten-times ledger keeps every count but shows at most 20 diagnoses', () => {
    const lines = Array.from({ length: 10 }, () => mixed).flat();
    const result = runValidation(lines.map(([line]) => line).join('\n') + '\n');
    expect([result.status, result.summary]).toEqual([1, expectedSummary(mixed, 10)]);
    expect(result.diagnoses).toHaveLength(20);
    const hidden = Number(result.stderr.match(/^(\d+) more diagnoses not shown$/m)?.[1]);
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

    // Another writer's non-UTF-8 line is a skipped malformed line, not a traceback.
    const binary = makeTelemetryFixture('off');
    const binaryFile = writeStageRuns(join(binary.home, '.gstack-extend'), [known]);
    writeFileSync(binaryFile, Buffer.concat([Buffer.from([0xff, 0xfe, 0x0a]), readFileSync(binaryFile)]));
    const decoded = runCursorRecipe({ ...binary.env }, ['known-session'], binary.home);
    expect([decoded.status, decoded.stderr]).toEqual([0, '']);
    expect(decoded.stdout).toContain('malformed-lines: 1');
    expect(decoded.stdout).toContain(JSON.stringify(known));

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

    // Value: protects=the recipe's stage selector and its started_at selector each narrow a session's rows, and a blank ledger line is not malformed; fails_when=either selector is dropped from the recipe; why_new=the earlier narrowing row differs in both fields so one filter hides the other; seam=none
    const selectors = makeTelemetryFixture('off');
    const later = { ...known, started_at: '2026-10-08T18:05:00Z', model: 'later-run' };
    const elsewhere = { ...known, stage: 'review', model: 'other-stage' };
    const selectorFile = writeStageRuns(join(selectors.home, '.gstack-extend'), [known, later, elsewhere]);
    writeFileSync(selectorFile, readFileSync(selectorFile, 'utf8').replace('\n', '\n\n'));
    const byStage = runCursorRecipe({ ...selectors.env }, ['known-session', 'implement'], selectors.home);
    expect(byStage.status).toBe(0);
    expect(byStage.stdout.split('\n')[0]).toBe('multiple-match');
    expect(byStage.stdout).toContain('"model":"grok-4.7"');
    expect(byStage.stdout).toContain('"model":"later-run"');
    expect(byStage.stdout).not.toContain('other-stage');
    expect(byStage.stdout).not.toContain('malformed-lines');
    const byStart = runCursorRecipe({ ...selectors.env }, ['known-session', 'implement', known.started_at], selectors.home);
    expect(byStart.status).toBe(0);
    expect(byStart.stdout.trim()).toBe(JSON.stringify(known));
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

  test('Cursor and quota documents the retired Conductor store, transcript-unreadable anchor, and honored orchestration-contract status', () => {
    const doc = readFileSync(DOC, 'utf8');
    const cursor = doc.slice(doc.indexOf('## Cursor and quota'));
    expect(cursor.startsWith('## Cursor and quota')).toBe(true);
    expect(cursor).toContain("Conductor's private Cursor SDK store (`~/Library/Application Support/com.conductor.app/cursor-sdk-store/`) is no longer read");
    expect(cursor).toContain('id="cursor-sdk-historical-route"');
    expect(cursor).toContain('id="cursor-sdk-transcript-unreadable"');
    expect(cursor).toContain('id="cursor-ledger-recipe"');
    expect(cursor.replace(/\s+/g, ' ')).toContain('Do not rewrite old rows');

    const orchContract = readFileSync(join(ROOT, 'docs/orchestration-contract.md'), 'utf8');
    expect(orchContract).toContain('| Host attribution | Set `GSTACK_EXTEND_WORKSPACE_OWNER=<host label>`, recorded as provenance `workspace_host` ([Host attribution](telemetry.md#host-attribution)) | `bin/lib/telemetry.py` `workspace_host()` | `honored` |');
    expect(orchContract).toContain('| Run-mode signal | Set `GSTACK_EXTEND_RUN_MODE=orchestrated` on every stage launched, interactive or not ([Run mode](telemetry.md#run-mode)) | `bin/lib/telemetry.py` `run_mode()` | `honored` |');
  });
});

// Track 24A: the metrics companion must not disturb the published contracts above.
describe('workflow metrics contract (Track 24A)', () => {
  const metricsSchema = JSON.parse(readFileSync(join(ROOT, 'docs/workflow-metrics.schema.json'), 'utf8'));
  const helperSource = readFileSync(join(ROOT, 'bin/lib/workflow_metrics.py'), 'utf8');
  const pyTuple = (name: string) => [...(new RegExp(`^${name} = \\(([^)]*)\\)`, 'm').exec(helperSource)![1]).matchAll(/"([^"]+)"/g)].map(m => m[1]);
  // Every envelope reason the schema publishes has one fixed helper action and one docs anchor.
  const REASONS = (metricsSchema.definitions.envelope.properties.reason.enum as (string | null)[]).filter((r): r is string => r !== null);
  test('docs carry the schema link, clock qualification and one anchored action per reason', () => {
    const doc = docText();
    const body = section(doc, '## Workflow metrics');
    expect(body).toContain('workflow-metrics.schema.json');
    expect(body).toContain('clock-sensitive');
    expect(body).toContain('qualified_elapsed_ms');
    expect(REASONS.length).toBeGreaterThanOrEqual(16);
    for (const reason of REASONS) expect(body, reason).toContain(`<a id="workflow-metrics-${reason}"></a>`);
    const fixText = /^FIX_TEXT = \{([\s\S]*?)^\}/m.exec(helperSource)![1];
    expect([...fixText.matchAll(/^ {4}"([a-z-]+)":/gm)].map(m => m[1]).sort()).toEqual([...REASONS].sort());
    const local = new Ajv({ strict: true, allErrors: true });
    local.addSchema(metricsSchema);
    const envelope = local.getSchema('workflow-metrics#/definitions/envelope')!;
    expect(envelope({ v: 1, status: 'ok', reason: null, session_id: 'x', event_id: null, data: {}, diagnostics: null })).toBe(true);
    expect(envelope({ v: 1, status: 'ok', reason: null, session_id: 'x', event_id: null, data: { unknown_reasons: ['not-a-reason'] }, diagnostics: null })).toBe(false);
  });
  test('the unknown-reason vocabulary matches across helper, schema and docs', () => {
    const helper = pyTuple('UNKNOWN_REASONS');
    const integrity = pyTuple('INTEGRITY_REASONS');
    expect([...helper].sort()).toEqual([...(metricsSchema.definitions.unknown_reason.enum as string[])].sort());
    const used = [...new Set([...helperSource.matchAll(/unknown\.add\("([a-z-]+)"\)/g)].map(m => m[1]))];
    expect(used.every(r => helper.includes(r)), used.join(',')).toBe(true);
    const body = section(docText(), '## Workflow metrics');
    const table = body.slice(body.indexOf('#### Unknown reasons in a read'));
    const rows = [...table.matchAll(/^\| `([a-z-]+)` \|/gm)].map(m => m[1]);
    expect([...rows].sort()).toEqual([...helper].sort());
    expect(rows.slice(0, integrity.length).sort()).toEqual([...integrity].sort()); // the first rows make a read partial
    expect(body).toContain('<a id="workflow-metrics-unknown"></a>');
  });
  test('a metrics sequence leaves stage-runs v2 and skill-usage shapes unchanged', () => {
    const fix = makeTelemetryFixture('community');
    const repo = initCheckout(fix.home, fix.env, 'checkout-dir', 'git@github.com:acme/widget.git');
    const started = runTelemetry(fix.env, repo, ['start', '--skill', 'extend:review-and-prep']);
    const sid = /session=(extend-[0-9a-f-]{36})/.exec(started.stdout)![1];
    const begin = spawnSync(WRAPPER, ['metrics', 'begin'], {
      cwd: repo, env: fix.env, encoding: 'utf8', timeout: 15_000,
      input: JSON.stringify({ v: 1, stage: 'review-and-prep', session_id: sid, event_id: randomUUID(), step_id: randomUUID(), parent_step_id: null, kind: 'run', phase: 'run', context: { candidate_head: null, candidate_tree: null, candidate_base: null, binding: 'unknown', skill_sha256: null, parent_session_id: null } }),
    });
    expect(JSON.parse(begin.stdout).status).toBe('recorded');
    expect(runTelemetry(fix.env, repo, ['finish', '--skill', 'extend:review-and-prep', '--outcome', 'success']).status).toBe(0);
    const row = fix.readLedger()[0];
    expect(verdict(row)).toEqual({ ok: true, errors: [] });
    expect(row.session_id).toBe(sid);
    expect(row.schema_version).toBe(4);
    expect(fix.readJsonl().map(r => r.event_type)).toEqual(['skill_start', 'skill_run']);
    const read = spawnSync(WRAPPER, ['metrics', 'read', '--session-id', sid], { cwd: repo, env: fix.env, encoding: 'utf8', timeout: 15_000 });
    expect(JSON.parse(read.stdout).status).toBe('ok');
    const ledger = join(fix.home, '.gstack-extend/analytics/workflow-metrics', createHash('sha256').update(sid).digest('hex') + '.jsonl');
    expect(existsSync(ledger)).toBe(true);
    expect(fix.readJsonl()).toHaveLength(2); // metrics never append to the upstream sink
  }, 30_000);
  test('the documented quickstart runs verbatim to a receipt', () => {
    const body = section(docText(), '## Workflow metrics');
    const block = /~~~sh\n([\s\S]*?)~~~/.exec(body)![1];
    const run = (keep: boolean) => {
      const fix = makeTelemetryFixture('off');
      // Canary state locations: every resolver variable the documentation unsets points here, so any write
      // that escapes the temporary HOME lands in a directory this test can see.
      const canary = join(fix.home, 'canary');
      const callerDir = join(fix.home, 'caller');
      mkdirSync(canary);
      mkdirSync(callerDir);
      const proof = join(fix.home, 'isolation-proof.txt');
      // The block writes its own isolation proof from inside its subshell, where HOME has changed.
      const withProof = block.replace(/\n\)\n?$/, `\n  printf 'HOME=%s STATE=%s\\n' "$HOME" "$GSTACK_EXTEND_STATE_DIR" > '${proof}'\n)\n`);
      expect(withProof).not.toBe(block);
      const canaries = Object.fromEntries(['GSTACK_STATE_ROOT', 'GSTACK_HOME', 'GSTACK_STATE_DIR', 'GSTACK_EXTEND_STATE_DIR', 'GSTACK_DIR',
        'CLAUDE_PLUGIN_DATA', 'CLAUDE_PLUGIN_ROOT'].map(name => [name, canary]));
      const script = join(fix.home, 'quickstart.sh');
      writeFileSync(script, `cd '${callerDir}'\n${withProof}\nrc=$?\necho "AFTER rc=$rc pwd=$PWD home=$HOME state=$GSTACK_EXTEND_STATE_DIR root=$GSTACK_STATE_ROOT"\n`);
      const r = spawnSync('bash', [script], { env: { PATH: join(ROOT, 'bin') + ':/usr/bin:/bin', HOME: fix.home, ...(process.env.TMPDIR !== undefined ? { TMPDIR: process.env.TMPDIR } : {}), ...canaries, ...(keep ? { KEEP: '1' } : {}) }, encoding: 'utf8', timeout: 30_000 });
      return { fix, canary, callerDir, proof, r };
    };
    const { fix, canary, callerDir, proof, r } = run(false);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('"status":"recorded"');
    expect(r.stdout).toContain('"status":"ok"');
    expect(r.stdout).toContain('capture=ok; clock=utc-wall clock-sensitive');
    // The block's own proof: a fresh temporary HOME with the state directory beneath it, removed on exit.
    const isolation = /HOME=(\S+) STATE=(\S+)/.exec(readFileSync(proof, 'utf8'))!;
    expect(isolation[1]).not.toBe('');
    expect(isolation[1]).not.toBe(fix.home);
    expect(isolation[2]).toBe(`${isolation[1]}/.gstack-extend`);
    expect(existsSync(isolation[1])).toBe(false);
    // Nothing reached the canary locations or the runner's HOME, and the caller's shell is unchanged.
    expect(readdirSync(canary)).toEqual([]);
    expect(existsSync(join(fix.home, '.gstack-extend'))).toBe(false);
    expect(existsSync(join(fix.home, '.gstack'))).toBe(true); // the fixture's own config only
    expect(readdirSync(join(fix.home, '.gstack'))).toEqual(['config.yaml']);
    expect(r.stdout).toContain(`AFTER rc=0 pwd=${callerDir} home=${fix.home} state=${canary} root=${canary}`);
    for (const name of ['GSTACK_STATE_ROOT', 'GSTACK_HOME', 'GSTACK_STATE_DIR', 'GSTACK_DIR', 'CLAUDE_PLUGIN_DATA', 'CLAUDE_PLUGIN_ROOT', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'GROK_HOME']) {
      expect(block, `the quickstart must unset ${name}`).toMatch(new RegExp(`unset [^\\n]*\\b${name}\\b`));
    }
    // The documented reading: evidence ran and completed; tests were reused with no work interval.
    const summary = r.stdout.split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)).find(e => e.status === 'ok')!.data;
    const phase = (name: string) => summary.phases.find((p: any) => p.phase === name);
    expect(phase('evidence')).toMatchObject({ steps_started: 1, steps_completed: 1 });
    expect(phase('tests')).toMatchObject({ decisions: { RUN: 0, REUSE: 1, 'N/A': 0 }, steps_started: 0, observed_wall_duration_ms: null });
    expect(summary.qualified_elapsed_ms).toBeNull();
    // KEEP=1 keeps the temporary state for inspection.
    const kept = run(true);
    expect(kept.r.status).toBe(0);
    const keptHome = /HOME=(\S+) STATE=/.exec(readFileSync(kept.proof, 'utf8'))![1];
    expect(existsSync(join(keptHome, '.gstack-extend'))).toBe(true);
    expect(readdirSync(kept.canary)).toEqual([]);
    rmSync(keptHome, { recursive: true, force: true });
  }, 60_000);

  test('every runnable example that writes follows the isolation prelude', () => {
    const doc = docText();
    const blocks = [...doc.matchAll(/~~~sh\n([\s\S]*?)~~~/g)].map(m => m[1]);
    const writers = blocks.filter(b => /^[^#\n]*(gstack-extend-telemetry|"\$GXT")\s+(start|finish|metrics\s+(begin|end|decision|pass|correction))\b/m.test(b));
    expect(writers.length).toBeGreaterThanOrEqual(3); // the quickstart, the prelude example, the author quickstart, plus recovery commands
    for (const block of writers) {
      // Recovering a real older run is the one documented write to real state.
      if (/extend-ORIGINAL|SESSION --start START/.test(block)) continue;
      expect(block, `a writing example needs the isolation prelude:\n${block}`).toMatch(/^\($/m);
      expect(block).toContain('export HOME="$');
      expect(block).toMatch(/unset GSTACK_STATE_ROOT GSTACK_HOME GSTACK_STATE_DIR GSTACK_DIR CLAUDE_PLUGIN_DATA CLAUDE_PLUGIN_ROOT CLAUDE_CONFIG_DIR CODEX_HOME GROK_HOME/);
      expect(block).toContain('GSTACK_EXTEND_STATE_DIR=');
      expect(block).toContain('trap ');
      expect(block).toContain('KEEP');
    }
  });

  // Track 31A: the host smoke prelude exports both upstream sink variables; prove each logger generation honours them,
  // against stand-in stores, so the smoke cannot reach a real ~/.gstack.
  for (const mode of ['stub', 'real'] as const) {
    test.if(mode === 'stub' || HAS_GSTACK)(`the host smoke prelude steers the ${mode === 'stub' ? 'legacy' : 'modern'} logger sink and the extend state into stand-in stores`, () => {
      const fix = makeTelemetryFixture('community', mode);
      const repo = initCheckout(fix.home, fix.env, 'smoke-repo', 'git@github.com:acme/widget.git');
      const upstream = join(fix.home, 'standin-upstream');
      const extendState = join(fix.home, 'standin-extend');
      mkdirSync(upstream);
      mkdirSync(extendState);
      writeFileSync(join(upstream, 'config.yaml'), 'telemetry: community\n');
      // The smoke prelude: both upstream variables at one directory, the extend state elsewhere, the rest unset.
      const env = { ...fix.env, GSTACK_STATE_ROOT: upstream, GSTACK_STATE_DIR: upstream, GSTACK_EXTEND_STATE_DIR: extendState };
      const started = runTelemetry(env, repo, ['start', '--skill', 'extend:review-and-prep']);
      expect(started.status).toBe(0);
      expect(runTelemetry(env, repo, ['finish', '--skill', 'extend:review-and-prep', '--outcome', 'success']).status).toBe(0);
      const rows = join(upstream, 'analytics', 'skill-usage.jsonl');
      expect(existsSync(rows), `${mode} logger wrote its sink under the isolated upstream directory`).toBe(true);
      expect(readFileSync(rows, 'utf8')).toContain('review-and-prep');
      const hostFiles = readdirSync(join(extendState, 'analytics', 'stage-runs')).filter(f => f.endsWith('.jsonl'));
      expect(hostFiles).toHaveLength(1);
      // Nothing reached the runner's HOME stores (the fixture HOME stands in for the real one).
      expect(existsSync(join(fix.home, '.gstack', 'analytics', 'skill-usage.jsonl'))).toBe(false);
      expect(existsSync(join(fix.home, '.gstack-extend'))).toBe(false);
    }, 30_000);
  }

  test('the host smoke prelude preserves custom profiles and tolerates unmatched marker globs', () => {
    const at = docText().indexOf('### Installed two-wrapper smoke');
    const command = /~~~sh\n([\s\S]*?)~~~/.exec(docText().slice(at))![1];
    for (const shell of ['bash', 'zsh']) {
      if (spawnSync(shell, ['-c', 'exit 0']).status !== 0) continue;
      const fix = makeTelemetryFixture('off');
      const source = join(fix.home, 'upstream-source');
      mkdirSync(source);
      writeFileSync(join(source, 'config.yaml'), 'telemetry: off\n');
      writeFileSync(join(source, '.test-seen'), 'seen'); // the other two globs deliberately have no matches
      const paths = join(fix.home, 'gstack-paths');
      writeFileSync(paths, `#!/bin/sh\nprintf '%s\\n' "\${GSTACK_STATE_ROOT:-${source}}"\n`);
      chmodSync(paths, 0o755);
      symlinkSync(process.execPath, join(fix.home, 'bun'));
      const profiles = { CLAUDE_CONFIG_DIR: '/synthetic/claude-profile', CODEX_HOME: '/synthetic/codex-profile', GROK_HOME: '/synthetic/grok-profile' };
      const script = `${command}\n[ "$CLAUDE_CONFIG_DIR" = '${profiles.CLAUDE_CONFIG_DIR}' ] && [ "$CODEX_HOME" = '${profiles.CODEX_HOME}' ] && [ "$GROK_HOME" = '${profiles.GROK_HOME}' ] || exit 91\n[ -f "$UP_ISO/.test-seen" ] && [ -f "$UP_ISO/config.yaml" ] || exit 92\n[ "$GSTACK_STATE_ROOT" = "$UP_ISO" ] && [ "$GSTACK_STATE_DIR" = "$UP_ISO" ] || exit 93\n`;
      const r = spawnSync(shell, ['-c', script], { cwd: ROOT, env: { ...fix.env, ...profiles, PATH: `${fix.home}:${fix.env.PATH}`, GSP: paths, TMPDIR: fix.home }, encoding: 'utf8', timeout: 30_000 });
      expect(r.status, r.stdout + r.stderr).toBe(0);
      expect(r.stderr).not.toContain('no matches found');
      expect(r.stdout).toContain('SMOKE_READY');
    }
  }, 60_000);

  // Value: protects=host setup stops before state exports when allocation or snapshot preparation fails;
  // fails_when=setup reports success or mutates inherited destinations after a failed prerequisite;
  // why_new=the existing host smoke case exercises successful preparation only; seam=PATH command stand-ins;
  // no_claim=installed host acceptance (document-extracted shell against a disposable HOME).
  test('the host smoke prelude fails closed before exporting any destinations', () => {
    const at = docText().indexOf('### Installed two-wrapper smoke');
    const command = /~~~sh\n([\s\S]*?)~~~/.exec(docText().slice(at))![1];
    for (const shell of ['bash', '/bin/bash', 'zsh']) for (const failure of ['allocation-1', 'allocation-2', 'allocation-3', 'snapshot']) {
      if (spawnSync(shell, ['-c', 'exit 0']).status !== 0) continue;
      const fix = makeTelemetryFixture('off');
      const source = join(fix.home, 'source');
      const mockBin = join(fix.home, 'mock-bin');
      mkdirSync(source); mkdirSync(mockBin);
      writeFileSync(join(source, 'config.yaml'), 'telemetry: off\n');
      const scripts = {
        'gstack-paths': '#!/bin/sh\nprintf "%s\\n" "${GSTACK_STATE_ROOT:-$PROBE_SOURCE}"\n',
        bun: '#!/bin/sh\n[ "$PROBE_FAILURE" != snapshot ] || exit 41\nprintf snapshot > "$3"\n',
        mktemp: '#!/bin/sh\nn=0; [ ! -f "$PROBE_COUNT" ] || read -r n < "$PROBE_COUNT"\nn=$((n+1)); printf "%s\\n" "$n" > "$PROBE_COUNT"\n[ "$PROBE_FAILURE" != "allocation-$n" ] || exit 42\nexec /usr/bin/mktemp -d "$TMPDIR/owned.XXXXXX"\n',
      };
      for (const [name, text] of Object.entries(scripts)) { writeFileSync(join(mockBin, name), text); chmodSync(join(mockBin, name), 0o755); }
      const script = `${command}\nprep_rc=$?\n[ "$prep_rc" -ne 0 ] || exit 91\n[ -z "\${GSTACK_EXTEND_STATE_DIR:-}" ] && [ -z "\${GSTACK_STATE_ROOT:-}" ] && [ -z "\${GSTACK_STATE_DIR:-}" ] || exit 92\n`;
      const r = spawnSync(shell, ['-c', script], { cwd: ROOT, env: { ...fix.env, PATH: `${mockBin}:${fix.env.PATH}`, GSP: join(mockBin, 'gstack-paths'),
        PROBE_SOURCE: source, PROBE_FAILURE: failure, PROBE_COUNT: join(fix.home, 'allocations'), TMPDIR: fix.home }, encoding: 'utf8', timeout: 30_000 });
      expect(r.status, `${shell} ${failure}: ${r.stdout}${r.stderr}`).toBe(0);
      expect(r.stdout).not.toContain('SMOKE_READY');
    }
  }, 60_000);

  test('the smoke timestamp command prints only tool-call IDs and timestamps, never content', () => {
    const doc = docText();
    const at = doc.indexOf('this field-only command prints');
    const command = /~~~sh\n([\s\S]*?)~~~/.exec(doc.slice(at))![1];
    const fix = makeTelemetryFixture('off');
    const log = join(fix.home, 'smoke-session.jsonl');
    const secret = 'SECRET-CONTENT-MUST-NOT-PRINT';
    writeFileSync(log, [
      { type: 'assistant', timestamp: '2026-10-26T01:00:00.000Z', message: { content: [{ type: 'text', text: secret }, { type: 'tool_use', id: 'toolu_a', name: 'Bash', input: { command: secret } }] } },
      { type: 'user', timestamp: '2026-10-26T01:00:02.500Z', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_a', content: secret }] } },
      { type: 'user', timestamp: '2026-10-26T01:00:03.000Z', message: { content: secret } },
    ].map(entry => JSON.stringify(entry)).join('\n') + '\nnot json\n');
    const r = spawnSync('bash', ['-c', command.replace('SMOKE_SESSION_LOG', `'${log}'`)], { env: fix.env, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain(secret);
    expect(r.stdout.trim().split('\n')).toEqual(['tool_use toolu_a 2026-10-26T01:00:00.000Z', 'tool_result toolu_a 2026-10-26T01:00:02.500Z']);
  });

  // Track 31A: the documented same-call span pattern, extracted verbatim, keeps the work's exit status
  // whatever the capture does, in every shell the hosts use, with errexit on and off.
  describe('the documented same-call span pattern', () => {
    const block = () => {
      const body = section(docText(), '## Workflow metrics');
      const at = body.indexOf('<a id="workflow-metrics-span-same-call"></a>');
      return /~~~sh\n([\s\S]*?)~~~/.exec(body.slice(at))![1];
    };
    const shells = [...new Set(['bash', '/bin/bash', 'zsh'].filter(sh => spawnSync(sh, ['-c', 'exit 0']).status === 0))];
    test('UUID minting ignores checkout and PYTHONPATH modules', () => {
      const fix = makeTelemetryFixture('off');
      const marker = join(fix.home, 'imported');
      const shadow = `from pathlib import Path\nPath(${JSON.stringify(marker)}).write_text('unexpected import')\nraise RuntimeError('synthetic shadow module')\n`;
      writeFileSync(join(fix.home, 'uuid.py'), shadow);
      for (const cwd of [fix.home, ROOT]) {
        const r = spawnSync('/bin/bash', ['-c', '. "$1"; _gx_mint', 'probe', join(ROOT, 'bin/lib/workflow-span.sh')],
          { cwd, env: { ...fix.env, PYTHONPATH: fix.home }, encoding: 'utf8' });
        expect(r.status).toBe(0);
        expect(existsSync(marker)).toBe(false);
        expect(r.stdout.trim().split(' ')).toHaveLength(3);
        for (const id of r.stdout.trim().split(' ')) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      }
    });
    test('a missing library preserves wait work and its status in every supported shell', () => {
      const fix = makeTelemetryFixture('off');
      const fallback = block().split('\n').find(line => line.startsWith('[ -f "$GX_LIB" ]'))!;
      for (const shell of shells) for (const errexit of [false, true]) {
        const r = spawnSync(shell, ['-c', `${errexit ? 'set -e\n' : ''}GX_LIB=''; GX_RUN='run'\n${fallback}\ngx_span_begin_wait human "$GX_RUN"\necho work-ran\n(exit 7)`], { env: fix.env, encoding: 'utf8' });
        expect(r.status).toBe(7);
        expect(r.stdout).toContain('work-ran');
        expect(r.stderr).toBe('');
      }
    });
    // Value: protects=enabled capture failures remain visible without changing the work result;
    // fails_when=missing launchers or failed UUID mints report intentional skipping;
    // why_new=the span matrix lacks mint failures and previously accepted silent skipping; seam=launcher stub;
    // no_claim=installed host timing.
    test('enabled capture reports unavailable when the launcher or UUID mint fails', () => {
      for (const shell of shells) for (const failure of ['launcher', 'begin-mint', 'end-mint']) {
        const fix = makeTelemetryFixture('off');
        const bin = join(fix.home, 'span-bin');
        mkdirSync(join(bin, 'lib'), { recursive: true });
        const lib = join(bin, 'lib/workflow-span.sh');
        writeFileSync(lib, readFileSync(join(ROOT, 'bin/lib/workflow-span.sh'), 'utf8'));
        const launcher = join(bin, 'gstack-extend-telemetry');
        if (failure !== 'launcher') { writeFileSync(launcher, '#!/bin/sh\ncat >/dev/null\nprintf \'{"status":"recorded"}\\n\'\n'); chmodSync(launcher, 0o755); }
        const script = `. "$GX_LIB"\n${failure === 'begin-mint' ? '_gx_mint() { return 1; }' : ''}\ngx_span_begin scope "$GX_RUN" phase\n${failure === 'end-mint' ? '_gx_mint() { return 1; }' : ''}\necho work-ran\ngx_span_end "$GX_STEP" 0\n`;
        const r = spawnSync(shell, ['-c', script], { env: { ...fix.env, GX_LIB: lib, GX_STAGE: 'review-and-prep', GX_SID: 'extend-' + randomUUID(), GX_CAPTURE: '1', GX_RUN: randomUUID() }, encoding: 'utf8', timeout: 15_000 });
        expect(r.status, `${shell} ${failure}: ${r.stderr}`).toBe(0);
        expect(r.stdout).toContain('work-ran');
        expect(r.stdout).toContain(failure === 'end-mint' ? 'end=unavailable' : 'begin=unavailable');
      }
    });

    // Value: protects=span options preserve governing decisions, parent and candidate attribution and explicit outcomes;
    // fails_when=NODECISION is ignored or a reason, context, parent or cancelled outcome is dropped;
    // why_new=the existing same-call matrix uses only default phase options; seam=none;
    // no_claim=agent boundary timing (real launcher in temporary fixture repositories only).
    test('span options preserve one governing decision and carry candidate and parent context', () => {
      for (const shell of shells) {
        const fix = makeTelemetryFixture('off');
        const repo = join(fix.home, 'span-options');
        mkdirSync(repo);
        expect(spawnSync('git', ['init', '-q', repo], { env: fix.env }).status).toBe(0);
        const sid = /session=(extend-[0-9a-f-]{36})/.exec(runTelemetry(fix.env, repo, ['start', '--skill', 'extend:review-and-prep']).stdout)![1];
        const run = randomUUID();
        const opened = spawnSync(WRAPPER, ['metrics', 'begin'], { cwd: repo, env: fix.env, encoding: 'utf8', timeout: 15_000,
          input: JSON.stringify({ v: 1, stage: 'review-and-prep', session_id: sid, event_id: randomUUID(), step_id: run,
            parent_step_id: null, kind: 'run', phase: 'run', context: { candidate_head: null, candidate_tree: null,
              candidate_base: null, binding: 'unknown', skill_sha256: null, parent_session_id: null } }) });
        expect(JSON.parse(opened.stdout).status).toBe('recorded');
        const context = { candidate_head: 'e'.repeat(40), candidate_tree: 'f'.repeat(40), binding: 'dirty' };
        const script = [
          '. "$GX_LIB"',
          "gx_span_begin scope '' phase",
          'GX_REASON=candidate-changed',
          'gx_span_begin coverage "$GX_RUN" phase "$GX_CTX"',
          'PARENT_STEP=$GX_STEP',
          'NODECISION=1',
          'gx_span_begin coverage "$PARENT_STEP" voice "$GX_CTX"',
          'gx_span_end "$GX_STEP" 0 recorded cancelled',
          'NODECISION=0',
          'gx_span_begin_wait human "$GX_RUN" "$GX_CTX"',
        ].join('\n');
        const result = spawnSync(shell, ['-c', script], { cwd: repo, env: { ...fix.env, GX_LIB: join(ROOT, 'bin/lib/workflow-span.sh'),
          GX_STAGE: 'review-and-prep', GX_SID: sid, GX_CAPTURE: '1', GX_RUN: run, GX_CTX: JSON.stringify(context) }, encoding: 'utf8', timeout: 60_000 });
        expect(result.status, `${shell}: ${result.stdout}${result.stderr}`).toBe(0);
        const file = join(fix.home, '.gstack-extend/analytics/workflow-metrics', createHash('sha256').update(sid).digest('hex') + '.jsonl');
        const records = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line)).slice(1);
        expect(records.map(row => row.op), shell).toEqual(['decision', 'begin', 'decision', 'begin', 'begin', 'end', 'begin']);
        const [defaultDecision, defaultBegin, decision, begin, voice, end, wait] = records.map(row => row.request);
        expect(defaultDecision).toMatchObject({ phase: 'scope', decision: 'RUN', reason: 'required', step_id: defaultBegin.step_id });
        expect(defaultBegin).toMatchObject({ parent_step_id: null, kind: 'phase', phase: 'scope' });
        expect(defaultBegin).not.toHaveProperty('context');
        expect(decision).toMatchObject({ phase: 'coverage', decision: 'RUN', reason: 'candidate-changed', step_id: begin.step_id });
        expect(begin).toMatchObject({ parent_step_id: run, kind: 'phase', context });
        expect(voice).toMatchObject({ parent_step_id: begin.step_id, kind: 'voice', phase: 'coverage', context });
        expect(end).toMatchObject({ step_id: voice.step_id, outcome: 'cancelled' });
        expect(wait).toMatchObject({ parent_step_id: run, kind: 'wait', wait_category: 'human', context });
        expect(wait).not.toHaveProperty('phase');
        expect(new Set([defaultBegin.step_id, begin.step_id, voice.step_id, wait.step_id]).size).toBe(4);
        expect(new Set(records.map(row => row.event_id)).size).toBe(records.length);
      }
    }, 60_000);

    // Value: protects=terminal capture replies never retry and uncertain decisions replay once unchanged only after absence;
    // fails_when=terminal or unknown replies retry, absent decisions lose their retry, or replay payload/ID changes;
    // why_new=the existing uncertain-reply matrix intercepts begin/end, not the governing decision; seam=none;
    // no_claim=real storage failures or agent timing (a recording launcher stub supplies reply envelopes).
    test('capture reply matrix bounds decision replay and preserves the work exit status', () => {
      type Reply = { terminal?: string; first?: string; event?: string; retry?: string };
      const rows: Array<{ name: string; reply: Reply; ops: string[]; begin: string; end: string; decision?: string }> = [
        ...['recorded', 'replayed', 'disabled', 'unavailable', 'conflict', 'partial'].map(status => ({
          name: status, reply: { terminal: status }, ops: ['decision', 'begin', ...(['recorded', 'replayed'].includes(status) ? ['end'] : [])],
          begin: status, end: ['recorded', 'replayed'].includes(status) ? status : 'skipped',
          ...(['recorded', 'replayed'].includes(status) ? {} : { decision: status }),
        })),
        { name: 'unconfirmed absent', reply: { first: 'unconfirmed', event: 'absent', retry: 'recorded' }, ops: ['decision', 'read', 'decision', 'begin', 'end'], begin: 'recorded', end: 'recorded' },
        { name: 'missing absent', reply: { first: '', event: 'absent', retry: 'replayed' }, ops: ['decision', 'read', 'decision', 'begin', 'end'], begin: 'recorded', end: 'recorded' },
        { name: 'unconfirmed matched', reply: { first: 'unconfirmed', event: 'match' }, ops: ['decision', 'read', 'begin', 'end'], begin: 'recorded', end: 'recorded' },
        { name: 'unconfirmed unknown', reply: { first: 'unconfirmed', event: 'unknown' }, ops: ['decision', 'read', 'begin', 'end'], begin: 'recorded', end: 'recorded', decision: 'unconfirmed' },
        { name: 'retry unavailable', reply: { first: 'unconfirmed', event: 'absent', retry: 'unavailable' }, ops: ['decision', 'read', 'decision', 'begin', 'end'], begin: 'recorded', end: 'recorded', decision: 'missing' },
        { name: 'retry unconfirmed', reply: { first: 'unconfirmed', event: 'absent', retry: 'unconfirmed' }, ops: ['decision', 'read', 'decision', 'begin', 'end'], begin: 'recorded', end: 'recorded', decision: 'unconfirmed' },
      ];
      for (const shell of shells) for (const row of rows) {
        const fix = makeTelemetryFixture('off');
        const checkout = join(fix.home, 'checkout/bin');
        mkdirSync(join(checkout, 'lib'), { recursive: true });
        const lib = join(checkout, 'lib/workflow-span.sh');
        writeFileSync(lib, readFileSync(join(ROOT, 'bin/lib/workflow-span.sh'), 'utf8'));
        const log = join(fix.home, 'capture-calls.jsonl');
        const launcher = join(checkout, 'gstack-extend-telemetry');
        writeFileSync(launcher, [
          '#!/usr/bin/env python3', 'import json, os, sys', 'from pathlib import Path',
          'log = Path(os.environ["CAPTURE_CALL_LOG"])',
          'prior = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []',
          'reply = json.loads(os.environ["CAPTURE_REPLY"])', 'op = sys.argv[2]',
          'entry = {"op": op, "input": sys.stdin.read() if op != "read" else None, "argv": sys.argv[3:]}',
          'with log.open("a") as stream: stream.write(json.dumps(entry) + "\\n")',
          'if op == "read":',
          '    print(json.dumps({"status": "ok", "data": {"event": {"status": reply["event"]}}}))',
          'else:',
          '    status = reply.get("terminal", "recorded")',
          '    if op == "decision" and "first" in reply:',
          '        status = reply["retry"] if any(item["op"] == "decision" for item in prior) else reply["first"]',
          '    if status: print(json.dumps({"status": status}))',
        ].join('\n') + '\n');
        chmodSync(launcher, 0o755);
        const sid = 'extend-' + randomUUID();
        const pattern = block().replace('<session ID the start printed>', sid).replace('<retained library path>', lib).replace('<run step_id>', randomUUID()).replace('PHASE', 'coverage').replace('WORK', 'echo work-ran; exit 7');
        const result = spawnSync(shell, ['-c', 'set -e\n' + pattern], { env: { ...fix.env,
          CAPTURE_CALL_LOG: log, CAPTURE_REPLY: JSON.stringify(row.reply) }, encoding: 'utf8', timeout: 30_000 });
        const label = `${shell}: ${row.name}`;
        expect(result.status, `${label}\n${result.stdout}${result.stderr}`).toBe(7);
        expect(result.stdout, label).toContain('work-ran');
        expect(result.stderr, label).toBe('');
        const calls = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
        expect(calls.map(call => call.op), label).toEqual(row.ops);
        const decisions = calls.filter(call => call.op === 'decision');
        if (decisions.length === 2) expect(decisions[1].input, label).toBe(decisions[0].input);
        const decision = JSON.parse(decisions[0].input);
        const read = calls.find(call => call.op === 'read');
        if (read) expect(read.argv, label).toEqual(['--session-id', sid, '--event-id', decision.event_id]);
        const begin = JSON.parse(calls.find(call => call.op === 'begin').input);
        expect(begin.step_id, label).toBe(decision.step_id);
        const spans = result.stdout.split('\n').filter(line => line.startsWith('SPAN '));
        expect(spans, label).toHaveLength(2);
        expect(spans[0], label).toContain(`begin=${row.begin} end=pending`);
        expect(spans[0].includes(' decision='), label).toBe(row.decision !== undefined);
        if (row.decision) expect(spans[0], label).toEndWith(` decision=${row.decision}`);
        expect(spans[1], label).toEndWith(`begin=${row.begin} end=${row.end} rc=7`);
      }
    }, 60_000);

    type Case = { name: string; work: string; capture?: number; lib?: 'real' | 'missing' | 'no-launcher' | 'garbage' | 'unconfirmed' | 'absent-begin' | 'absent-end'; rc: number; end: 'recorded' | 'skipped' | 'match' | 'unconfirmed'; begin?: string; outcome?: 'completed' | 'failed' };
    const cases: Case[] = [
      { name: 'enabled, passing command', work: 'echo worked', rc: 0, end: 'recorded', outcome: 'completed' },
      { name: 'enabled, failing command', work: 'echo before; false; echo after', rc: 1, end: 'recorded', outcome: 'failed' },
      { name: 'enabled, failing command inside a pipe', work: 'false | cat; echo after', rc: 1, end: 'recorded', outcome: 'failed' },
      { name: 'capture disabled', work: 'echo worked; exit 7', capture: 0, rc: 7, end: 'skipped', begin: 'skipped' },
      { name: 'no launcher beside the library', work: 'echo worked; exit 3', lib: 'no-launcher', rc: 3, end: 'skipped', begin: 'unavailable' },
      { name: 'library not found', work: 'echo worked; exit 4', lib: 'missing', rc: 4, end: 'skipped', begin: 'none' },
      { name: 'malformed envelope', work: 'echo worked; exit 5', lib: 'garbage', rc: 5, end: 'skipped', begin: 'missing' },
      { name: 'unconfirmed write the read finds', work: 'false', lib: 'unconfirmed', rc: 1, end: 'match', begin: 'match', outcome: 'failed' },
      { name: 'unconfirmed begin the read finds absent', work: 'echo worked; exit 6', lib: 'absent-begin', rc: 6, end: 'skipped', begin: 'unconfirmed' },
      { name: 'unconfirmed end the read finds absent', work: 'echo worked; exit 7', lib: 'absent-end', rc: 7, end: 'unconfirmed' },
    ];
    for (const shell of shells) {
      test(`${shell}: exit status, SPAN line and records in ${cases.length} cases, errexit on and off`, () => {
        for (const errexit of [false, true]) for (const c of cases) {
          const label = `${shell} errexit=${errexit} ${c.name}`;
          const fix = makeTelemetryFixture('off');
          const repo = join(fix.home, 'repo');
          mkdirSync(repo);
          expect(spawnSync('git', ['init', '-q', repo], { env: fix.env }).status).toBe(0);
          const sid = /session=(extend-[0-9a-f-]{36})/.exec(runTelemetry(fix.env, repo, ['start', '--skill', 'extend:review-and-prep']).stdout)![1];
          const run = randomUUID();
          const begun = spawnSync(WRAPPER, ['metrics', 'begin'], { cwd: repo, env: fix.env, encoding: 'utf8', timeout: 15_000, input: JSON.stringify({ v: 1, stage: 'review-and-prep', session_id: sid, event_id: randomUUID(), step_id: run, parent_step_id: null, kind: 'run', phase: 'run', context: { candidate_head: null, candidate_tree: null, candidate_base: null, binding: 'unknown', skill_sha256: null, parent_session_id: null } }) });
          expect(JSON.parse(begun.stdout).status).toBe('recorded');
          // The library finds its launcher as a sibling, so each case builds the checkout it wants.
          const checkout = join(fix.home, 'checkout', 'bin');
          mkdirSync(join(checkout, 'lib'), { recursive: true });
          writeFileSync(join(checkout, 'lib', 'workflow-span.sh'), readFileSync(join(ROOT, 'bin/lib/workflow-span.sh'), 'utf8'));
          const stub = (body: string) => { writeFileSync(join(checkout, 'gstack-extend-telemetry'), `#!/bin/sh\n${body}\n`); chmodSync(join(checkout, 'gstack-extend-telemetry'), 0o755); };
          if (c.lib === 'garbage') stub('echo "not an envelope"');
          else if (c.lib === 'unconfirmed') stub(`case "$2" in\n  begin|end) ${JSON.stringify(WRAPPER)} "$@" >/dev/null; echo '{"v":1,"status":"unconfirmed","reason":"io-error"}' ;;\n  *) exec ${JSON.stringify(WRAPPER)} "$@" ;;\nesac`);
          else if (c.lib?.startsWith('absent-')) stub(`printf '%s\\n' "$2" >> '${checkout}/calls'\ncase "$2" in\n  ${c.lib.slice(7)}) cat >/dev/null; echo '{"v":1,"status":"unconfirmed","reason":"io-error"}' ;;\n  *) exec ${JSON.stringify(WRAPPER)} "$@" ;;\nesac`);
          else if (c.lib !== 'no-launcher' && c.lib !== 'missing') symlinkSync(WRAPPER, join(checkout, 'gstack-extend-telemetry'));
          const lib = c.lib === 'missing' ? join(fix.home, 'nowhere', 'bin', 'lib', 'workflow-span.sh') : join(checkout, 'lib', 'workflow-span.sh');
          const pattern = block().replace('<session ID the start printed>', sid).replace('<retained library path>', lib).replace('<run step_id>', run).replace('GX_CAPTURE=1', `GX_CAPTURE=${c.capture ?? 1}`)
            .replace('PHASE', 'pregate').replace('WORK', c.work);
          const script = `${errexit ? 'set -e\n' : ''}${pattern}`;
          const r = spawnSync(shell, ['-c', script], { cwd: repo, env: fix.env, encoding: 'utf8', timeout: 45_000 });
          expect(r.status, `${label}: the call's exit status must equal the work's\n${r.stdout}${r.stderr}`).toBe(c.rc);
          if (c.work.includes('echo worked')) expect(r.stdout, label).toContain('worked');
          if (c.work.includes('after')) expect(r.stdout, `${label}: the block stops at the first failure`).not.toContain('after');
          const spans = r.stdout.split('\n').filter(l => l.startsWith('SPAN '));
          if (c.begin === 'none') {
            expect(spans, label).toEqual([]);
          } else {
            const last = spans[spans.length - 1];
            expect(spans.length, label).toBe(2);
            expect(spans[0], label).toMatch(new RegExp(`^SPAN step=\\S+ phase=pregate begin=${c.begin ?? 'recorded'} end=pending`));
            expect(last, label).toMatch(new RegExp(`phase=pregate begin=${c.begin ?? 'recorded'} end=${c.end} rc=${c.rc}$`));
          }
          const read = spawnSync(WRAPPER, ['metrics', 'read', '--session-id', sid], { cwd: repo, env: fix.env, encoding: 'utf8', timeout: 15_000 });
          const data = JSON.parse(read.stdout).data;
          const pregate = data.phases.find((p: any) => p.phase === 'pregate');
          if (c.lib?.startsWith('absent-')) {
            const calls = readFileSync(join(checkout, 'calls'), 'utf8').trim().split('\n');
            expect(calls.filter(op => op === 'begin'), label).toHaveLength(1);
            expect(calls.filter(op => op === 'end'), label).toHaveLength(c.lib === 'absent-begin' ? 0 : 1);
            expect(calls.filter(op => op === 'read'), label).toHaveLength(1);
            expect(pregate, label).toMatchObject({ steps_started: c.lib === 'absent-begin' ? 0 : 1, steps_completed: 0,
              decisions: { RUN: 1 }, unknown_durations: 1, observed_wall_duration_ms: null });
            expect(data.unknown_reasons, label).not.toContain('missing-begin');
          } else if (c.end === 'skipped') {
            // No lone end: nothing of this span reaches the ledger, and the open run step is the only unknown.
            expect(pregate, label).toBeUndefined();
            expect(data.unknown_reasons, label).not.toContain('missing-begin');
          } else {
            expect(pregate, label).toMatchObject({ steps_started: 1, steps_completed: c.outcome === 'completed' ? 1 : 0, decisions: { RUN: 1 }, unknown_durations: 0 });
            expect(typeof pregate.observed_wall_duration_ms, label).toBe('number');
          }
        }
      }, 300_000);
    }

    test('the cross-call form ends a step begun in an earlier call, and never ends an unconfirmed begin', () => {
      const body = section(docText(), '## Workflow metrics');
      const lookup = /~~~sh\n([\s\S]*?)~~~/.exec(body.slice(body.indexOf('To obtain the retained library path')))![1];
      const fix = makeTelemetryFixture('off');
      const repo = join(fix.home, 'repo');
      mkdirSync(repo);
      expect(spawnSync('git', ['init', '-q', repo], { env: fix.env }).status).toBe(0);
      const sid = /session=(extend-[0-9a-f-]{36})/.exec(runTelemetry(fix.env, repo, ['start', '--skill', 'extend:review-and-prep']).stdout)![1];
      const run = randomUUID();
      spawnSync(WRAPPER, ['metrics', 'begin'], { cwd: repo, env: fix.env, encoding: 'utf8', timeout: 15_000, input: JSON.stringify({ v: 1, stage: 'review-and-prep', session_id: sid, event_id: randomUUID(), step_id: run, parent_step_id: null, kind: 'run', phase: 'run', context: { candidate_head: null, candidate_tree: null, candidate_base: null, binding: 'unknown', skill_sha256: null, parent_session_id: null } }) });
      // The lookup resolves a symlinked launcher to the checkout's own library, as the helper's --resolve may print one.
      // The documented lookup now sets _GE_BIN itself, from the installed helper, so a stub helper stands in for it.
      const link = join(fix.home, 'launcher-link');
      symlinkSync(WRAPPER, link);
      const helper = join(fix.home, '.gstack-extend/bin/telemetry-call');
      const stubHelper = (target: string) => {
        mkdirSync(join(fix.home, '.gstack-extend/bin'), { recursive: true });
        writeFileSync(helper, `#!/bin/sh\nprintf '%s\\n' '${target}'\n`);
        chmodSync(helper, 0o755);
      };
      stubHelper(link);
      const found = spawnSync('bash', ['-c', lookup], { env: fix.env, encoding: 'utf8' });
      const lib = /^GX_LIB=(.+)$/m.exec(found.stdout)![1];
      expect(realpathSync(lib)).toBe(realpathSync(join(ROOT, 'bin/lib/workflow-span.sh')));
      stubHelper(join(fix.home, 'absent'));
      const missing = spawnSync('bash', ['-c', lookup], { env: fix.env, encoding: 'utf8' });
      expect(missing.stdout.trim()).toBe('GX_LIB=');
      // No helper installed at all: the same empty result, not an error.
      rmSync(helper);
      // An empty resolved launcher must not select a sibling library via realpath("").
      mkdirSync(join(fix.home, 'lib'));
      writeFileSync(join(fix.home, 'lib/workflow-span.sh'), 'echo unintended-library\n');
      const unhelped = spawnSync('bash', ['-c', lookup], { cwd: repo, env: fix.env, encoding: 'utf8' });
      expect(unhelped.stdout.trim()).toBe('GX_LIB=');
      const head = `GX_STAGE='review-and-prep'; GX_SID='${sid}'; GX_CAPTURE=1; GX_LIB='${lib}'; GX_RUN='${run}'\n. "$GX_LIB"\n`;
      const first = spawnSync('bash', ['-c', head + 'gx_span_begin tests "$GX_RUN" phase'], { cwd: repo, env: fix.env, encoding: 'utf8', timeout: 30_000 });
      const line = /^SPAN step=(\S+) phase=tests begin=(\S+) end=pending$/m.exec(first.stdout)!;
      expect(line[2]).toBe('recorded');
      // A new shell (a later tool call) knows the step only from the quoted SPAN line.
      const later = (step: string, bstat: string, rc = '0') => spawnSync('bash', ['-c', head + `gx_span_end '${step}' '${rc}' '${bstat}'`], { cwd: repo, env: fix.env, encoding: 'utf8', timeout: 30_000 });
      expect(later(line[1], 'unconfirmed').stdout).toContain('end=skipped');
      for (const rc of ['', 'unknown']) {
        const missingResult = later(line[1], line[2], rc);
        expect(missingResult.status).toBe(0);
        expect(missingResult.stdout).toContain('end=missing rc=unknown');
        const stillOpen = JSON.parse(spawnSync(WRAPPER, ['metrics', 'read', '--session-id', sid], { cwd: repo, env: fix.env, encoding: 'utf8' }).stdout).data;
        expect(stillOpen.phases.find((p: any) => p.phase === 'tests')).toMatchObject({ steps_completed: 0, unknown_durations: 1 });
      }
      expect(later(line[1], line[2]).stdout).toContain(`SPAN step=${line[1]} phase=- begin=recorded end=recorded rc=0`);
      const data = JSON.parse(spawnSync(WRAPPER, ['metrics', 'read', '--session-id', sid], { cwd: repo, env: fix.env, encoding: 'utf8' }).stdout).data;
      expect(data.phases.find((p: any) => p.phase === 'tests')).toMatchObject({ steps_started: 1, steps_completed: 1, unknown_durations: 0 });
      // A wait opens without a decision and ends paused only on request: its duration then reads unknown.
      const waitOut = spawnSync('bash', ['-c', head + 'gx_span_begin_wait human "$GX_RUN"'], { cwd: repo, env: fix.env, encoding: 'utf8', timeout: 30_000 }).stdout;
      const wait = /^SPAN step=(\S+) phase=human begin=recorded end=pending$/m.exec(waitOut)!;
      expect(spawnSync('bash', ['-c', head + `gx_span_end '${wait[1]}' 0 recorded paused`], { cwd: repo, env: fix.env, encoding: 'utf8', timeout: 30_000 }).stdout).toContain('end=recorded');
      const after = JSON.parse(spawnSync(WRAPPER, ['metrics', 'read', '--session-id', sid], { cwd: repo, env: fix.env, encoding: 'utf8' }).stdout).data;
      expect(after.waits).toEqual([{ wait_category: 'human', count: 1, observed_wall_duration_ms: null, unknown_durations: 1 }]);
      expect(after.unknown_reasons).toContain('open-wait');
    }, 60_000);
  });
});


describe('Track 26A v2 regression bundles G1–G5/G8', () => {
  test('G4 historical branches remain closed; v2, v3, and v4 reserve vocabulary without widening history', () => {
    const v1 = historicalRow();
    const v2 = historicalV2Row();
    const v3 = historicalV3Row();
    const v4 = quickstartRow();
    const legacy = legacyOf(v1);
    expect(verdict(v1).ok).toBe(true);
    expect(verdict(v2).ok).toBe(true);
    expect(verdict(v3).ok).toBe(true);
    expect(verdict(v4).ok).toBe(true);
    for (const old of [legacy, v1]) {
      for (const field of ['workspace_host', 'host_agent_id', ...V3_FIELDS.slice(22)]) {
        expect(verdict({ ...old, [field]: v3[field] }).ok).toBe(false);
      }
      for (const patch of [{ outcome: 'blocked' }, { model_source: 'requested' }, { effort_source: 'requested' }]) {
        expect(verdict({ ...old, ...patch }).ok).toBe(false);
      }
    }
    for (const field of V3_FIELDS.slice(22)) {
      expect(verdict({ ...v2, [field]: v3[field] }).ok).toBe(false);
    }
    for (const field of V2_FIELDS) {
      const { [field]: _gone, ...row } = v2;
      expect([field, verdict(row).ok]).toEqual([field, false]);
    }
    for (const field of V3_FIELDS) {
      const { [field]: _gone, ...row } = v3;
      expect([field, verdict(row).ok]).toEqual([field, false]);
    }
    for (const field of V4_FIELDS) {
      const { [field]: _gone, ...row } = v4;
      expect([field, verdict(row).ok]).toEqual([field, false]);
    }
    for (const patch of [
      { schema_version: 1 }, { schema_version: 3 }, { schema_version: 5 }, { extra: true },
      { workspace_host: 'unknown', host_agent_id: 'invented' }, { workspace_host: 'other' },
      { host_agent_id: 3 }, { agent_source: 'requested' },
      { model: null, model_source: 'requested' }, { effort: null, effort_source: 'requested' },
      { model_source: 'unknown' }, { effort_source: 'unknown' },
    ]) expect([patch, verdict({ ...v2, ...patch }).ok]).toEqual([patch, false]);
    for (const patch of [
      { run_mode: 'user-directed', run_mode_source: 'session-kind' },
      { run_mode: 'orchestrated', run_mode_source: 'cli' },
      { run_mode: 'orchestrated', run_mode_source: 'Paseo' },
      { run_mode: 'unknown', run_mode_source: 'work-item' },
      { run_mode: 'unknown', run_mode_source: 'run-mode-env' },
      { run_mode: 'orchestrated', run_mode_source: 'session-kind', user_signals_source: 'session-log', questions: 0, user_wait_s: 0, resumes: 0, blocked_reason_source: 'orchestrated' },
      { run_mode: 'user-directed', run_mode_source: 'cli', user_signals_source: 'orchestrated', blocked_reason_source: 'not-blocked' },
      { run_mode: 'user-directed', run_mode_source: 'cli', user_signals_source: 'session-log-unavailable', blocked_reason_source: 'orchestrated' },
      { user_signals_source: 'session-log', questions: null, user_wait_s: 0, resumes: 0 },
      { user_signals_source: 'session-log-unavailable', questions: 0 },
      { outcome: 'blocked', blocked_reason: null, blocked_reason_source: 'flag' },
      { outcome: 'blocked', blocked_reason: 'missing-env', blocked_reason_source: 'not-supplied' },
      { outcome: 'blocked', blocked_reason: null, blocked_reason_source: 'not-blocked' },
      { outcome: 'success', blocked_reason: 'missing-env', blocked_reason_source: 'flag' },
      { outcome: 'success', blocked_reason: null, blocked_reason_source: 'not-supplied' },
    ]) expect([patch, verdict({ ...v3, ...patch }).ok]).toEqual([patch, false]);
    for (const validPatch of [
      { run_mode: 'orchestrated', run_mode_source: 'session-kind', user_signals_source: 'orchestrated', questions: null, user_wait_s: null, resumes: null, blocked_reason: null, blocked_reason_source: 'orchestrated' },
      { run_mode: 'orchestrated', run_mode_source: 'work-item', user_signals_source: 'orchestrated', questions: null, user_wait_s: null, resumes: null, blocked_reason: null, blocked_reason_source: 'orchestrated' },
      { run_mode: 'orchestrated', run_mode_source: 'run-mode-env', user_signals_source: 'orchestrated', questions: null, user_wait_s: null, resumes: null, blocked_reason: null, blocked_reason_source: 'orchestrated' },
      { run_mode: 'user-directed', run_mode_source: 'cli', user_signals_source: 'session-log', questions: 1, user_wait_s: 12, resumes: 1, blocked_reason: null, blocked_reason_source: 'not-blocked' },
      { run_mode: 'user-directed', run_mode_source: 'Paseo', outcome: 'blocked', user_signals_source: 'session-log', questions: 0, user_wait_s: 0, resumes: 0, blocked_reason: 'awaiting-user', blocked_reason_source: 'flag' },
      { run_mode: 'unknown', run_mode_source: 'launcher-state-root', outcome: 'blocked', user_signals_source: 'no-harness', questions: null, user_wait_s: null, resumes: null, blocked_reason: null, blocked_reason_source: 'not-supplied' },
    ]) expect([validPatch, verdict({ ...v3, ...validPatch }).ok]).toEqual([validPatch, true]);
    for (const patch of [
      { host_agent_id: null }, { host_agent_id: 'paseo-1' },
      { route: 'conductor' },
      { run_mode: 'user-directed', run_mode_source: 'sdk-cli' },
      { run_mode: 'user-directed', run_mode_source: 'Paseo' },
      { run_mode: 'unknown', run_mode_source: 'cli' },
      { run_mode: 'unknown', run_mode_source: 'paseo-entrypoint' },
      { workspace_host: '' }, { workspace_host: '   ' },
    ]) expect([patch, verdict({ ...v4, ...patch }).ok]).toEqual([patch, false]);
    for (const validV4Patch of [
      { workspace_host: null },
      { workspace_host: 'my-host' },
      { run_mode: 'user-directed', run_mode_source: 'cli', user_signals_source: 'session-log', questions: 0, user_wait_s: 0, resumes: 0, blocked_reason: null, blocked_reason_source: 'not-blocked' },
      { run_mode: 'user-directed', run_mode_source: 'paseo-entrypoint', user_signals_source: 'session-log', questions: 0, user_wait_s: 0, resumes: 0, blocked_reason: null, blocked_reason_source: 'not-blocked' },
      { run_mode: 'unknown', run_mode_source: 'entrypoint-unqualified', user_signals_source: 'no-harness', questions: null, user_wait_s: null, resumes: null, blocked_reason: null, blocked_reason_source: 'not-blocked' },
      { run_mode: 'unknown', run_mode_source: 'host-managed-workspace', user_signals_source: 'no-harness', questions: null, user_wait_s: null, resumes: null, blocked_reason: null, blocked_reason_source: 'not-blocked' },
    ]) expect([validV4Patch, verdict({ ...v4, ...validV4Patch }).ok]).toEqual([validV4Patch, true]);
    for (const source of ['flag', 'detected', 'requested']) {
      const row = { ...v2, model_source: source, effort_source: source, outcome: 'blocked' };
      expect(verdict(row).ok).toBe(true);
      expect(verdict({ ...v1, producer_version: '1.0.0' }).ok).toBe(false);
    }
    expect(verdict({ ...v2, agent: null, model: null, effort: null,
      agent_source: 'unknown', model_source: 'unknown', effort_source: 'unknown',
      workspace_host: 'unknown', host_agent_id: null, producer_version: null }).ok).toBe(true);
  });

  test('G1/G2 actual wrapper host matrix and Unicode agree with strict schema and exact docs reader', () => {
    const fix = makeTelemetryFixture('off');
    const cwd = join(fix.home, 'arbitrary');
    mkdirSync(cwd, { recursive: true });
    const rows: Record<string, unknown>[] = [];
    const run = (markers: Record<string, string>, host: string | null,
      harness: Record<string, string> = {}, agent: string | null = null, route = 'unknown') => {
      const env = { ...fix.env, ...markers, ...harness };
      expect(runTelemetry(env, cwd, ['start', '--skill', 'extend:roadmap']).status).toBe(0);
      const result = runTelemetry(env, cwd, ['finish', '--skill', 'extend:roadmap', '--outcome', 'blocked',
        '--model', 'fixture-model', '--effort', 'high']);
      expect([result.status, result.stdout, result.stderr]).toEqual([0, '', '']);
      const row = fix.readLedger().at(-1)!;
      expect(row).toMatchObject({ schema_version: 4, workspace_host: host, agent, route,
        model: 'fixture-model', effort: 'high', model_source: 'flag', effort_source: 'flag', outcome: 'blocked' });
      expect(row).not.toHaveProperty('host_agent_id');
      expect(Object.keys(row)).toEqual(V4_FIELDS);
      expect(verdict(row).ok).toBe(true);
      rows.push(row);
    };
    // Host-specific env vars are never read in v4; only GSTACK_EXTEND_WORKSPACE_OWNER sets workspace_host.
    run({}, null);
    run({ PASEO_AGENT_ID: 'paseo-id' }, null);
    run({ CONDUCTOR_SESSION_ID: 'cond-id' }, null);
    run({ PASEO_AGENT_ID: 'p', CONDUCTOR_SESSION_ID: 'c' }, null);
    run({ GSTACK_EXTEND_WORKSPACE_OWNER: 'my-host' }, 'my-host');
    run({ GSTACK_EXTEND_WORKSPACE_OWNER: 'paseo', PASEO_AGENT_ID: 'paseo-id' }, 'paseo');
    for (const [harness, agent, route] of [
      [{ CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'sdk-fixture' }, 'claude', 'sdk'],
      [{ CODEX_THREAD_ID: 'host-matrix' }, 'codex', 'unknown'],
      [{ CURSOR_AGENT: '1', CURSOR_INVOKED_AS: 'cursor-agent' }, 'cursor', 'cli'],
    ] as Array<[Record<string, string>, string, string]>) {
      run({ PASEO_AGENT_ID: 'p' }, null, harness, agent, route);
      run({ CONDUCTOR_SESSION_ID: 'c' }, null, harness, agent, route);
      run({ GSTACK_EXTEND_WORKSPACE_OWNER: 'owner-host' }, 'owner-host', harness, agent, route);
    }
    const labels: Array<[string, string | null]> = [
      ['x', 'x'], ['x'.repeat(200), 'x'.repeat(200)], ['x'.repeat(201), null],
      ['café', 'café'], ['🎉'.repeat(200), '🎉'.repeat(200)], ['🎉'.repeat(201), null],
      [' a 🎉 ', ' a 🎉 '], ['   ', null], ['', null], ['bad\tvalue', null],
      ['bad\nvalue', null], ['bad\u007fvalue', null], ['a\u00a0b', null], ['a\u2028b', null],
      ['a\u200db', null], ['a\ue000b', null], ['a\u0378b', null],
    ];
    for (const [label, accepted] of labels) {
      run({ GSTACK_EXTEND_WORKSPACE_OWNER: label }, accepted);
      expect(verdict({ ...quickstartRow(), workspace_host: label }).ok).toBe(accepted !== null);
    }
    // Lone surrogates cannot be transported in an OS environment. Exercise the real
    // constructor with a plain inherited-environment mapping at this encoding boundary.
    const script = [
      'import json, sys', 'from unittest import mock', 'sys.path.insert(0, sys.argv[1])', 'import telemetry',
      'with mock.patch.object(telemetry.os, "environ", {"GSTACK_EXTEND_WORKSPACE_OWNER": "bad\\ud800id"}), mock.patch.object(telemetry, "detect", return_value=(None,None,None)):',
      '    row = telemetry.provenance_row("roadmap", "surrogate", 1790000000, 1, {}, None)',
      'print(json.dumps(row))',
    ].join('\n');
    const surrogate = spawnSync('python3', ['-B', '-I', '-c', script, join(ROOT, 'bin/lib')],
      { env: fix.env, encoding: 'utf8' });
    expect([surrogate.status, surrogate.stderr]).toEqual([0, '']);
    rows.push(JSON.parse(surrogate.stdout));
    expect(rows.at(-1)).toMatchObject({ workspace_host: null, run_mode: 'unknown', run_mode_source: 'malformed-signal' });
    expect(verdict({ ...quickstartRow(), workspace_host: 'bad\ud800id' }).ok).toBe(false);
    const result = runValidation(rows.map(row => JSON.stringify(row)).join('\n'));
    expect([result.status, result.stderr, result.summary]).toEqual([0, '', summaryOf({ rows: rows.length, v4: rows.length })]);
    const rejected = labels.filter(([, accepted]) => accepted === null).map(([label]) => ({ ...quickstartRow(), workspace_host: label }));
    rejected.push({ ...quickstartRow(), workspace_host: 'bad\ud800id' });
    const invalid = runValidation(rejected.map(row => JSON.stringify(row)).join('\n'));
    expect(invalid.summary).toBe(summaryOf({ rows: rejected.length, invalid: rejected.length }));
    expect(invalid.status).toBe(1);
  }, 120_000);

  test('G5 JSONL boundaries preserve Unicode separators and split CRLF without changing rows', () => {
    const empty = { ...quickstartRow(), model: '' };
    const padded = { ...empty, model: 'x'.repeat(65535 - Buffer.byteLength(JSON.stringify(empty))) };
    const unicode = { ...quickstartRow(), model: 'a\u2028b\u2029c' };
    const invalid = { ...quickstartRow(), workspace_host: 'a\u2028b\u2029c' };
    const routed = { source: 'other', value: 'a\u2028b\u2029c' };
    for (const ending of ['\n', '\r', '\r\n']) {
      const input = [padded, unicode, invalid, routed].map(row => JSON.stringify(row)).join(ending) + ending;
      const result = runValidation(input);
      expect([result.status, result.summary]).toEqual([1, summaryOf({ rows: 4, v4: 2, invalid: 1, routed: 1 })]);
      expect(readFileSync(result.file!, 'utf8')).toBe(input);
      expect(result.stderr).not.toMatch(/a\u2028b|a\u2029b/);
    }
  });

  test('G5 positive safe integer dispatch, mixed versions and frozen old-reader rollback are read-only', () => {
    const base = JSON.stringify(historicalRow());
    const versions: Array<[string, 'v1' | 'v2' | 'v3' | 'v4' | 'unsupported' | 'invalid']> = [
      ['1', 'v1'], ['2', 'v2'], ['3', 'v3'], ['4', 'v4'], ['5', 'unsupported'], ['9007199254740991', 'unsupported'],
      ['9007199254740992', 'invalid'], ['9007199254740993', 'invalid'], ['1e400', 'invalid'],
      ['0', 'invalid'], ['-1', 'invalid'], ['1.5', 'invalid'], ['"1"', 'invalid'], ['null', 'invalid'], ['true', 'invalid'],
    ];
    for (const [version, kind] of versions) {
      const row = kind === 'v2'
        ? JSON.stringify(historicalV2Row())
        : kind === 'v3'
          ? JSON.stringify(historicalV3Row())
          : kind === 'v4'
            ? JSON.stringify(quickstartRow())
            : base.replace('"schema_version":1', '"schema_version":' + version);
      const result = runValidation(row);
      expect([version, result.status, result.summary]).toEqual([version, ['v1', 'v2', 'v3', 'v4'].includes(kind) ? 0 : 1,
        summaryOf({ rows: 1, [kind]: 1 })]);
      expect(readFileSync(result.file!, 'utf8')).toBe(row);
      if (kind === 'unsupported') expect(result.stderr).toContain(`version ${version} is newer than supported versions 1/2/3/4`);
      if (kind === 'invalid') {
        expect(result.stderr).toContain('not a positive safe integer');
        expect(result.stderr).not.toContain('version ' + version);
      }
    }
    const text = [legacyOf(historicalRow()), historicalRow(), historicalV2Row(), historicalV3Row(), quickstartRow()].map(row => JSON.stringify(row)).join('\n');
    expect(runValidation(text).summary).toBe(summaryOf({ rows: 5, legacy: 1, v1: 1, v2: 1, v3: 1, v4: 1 }));
    const fix = makeTelemetryFixture('off');
    const file = join(fix.home, 'old-reader.jsonl');
    writeFileSync(file, text);
    const old = spawnSync('bash', ['-c', V1_READER_COMMAND], { cwd: ROOT,
      env: { HOME: fix.home, PATH: dirname(process.execPath) + ':/usr/bin:/bin', STAGE_RUNS_FILE: file }, encoding: 'utf8' });
    expect([old.status, old.stderr]).toEqual([1, '']);
    expect(old.stdout).toContain('summary: rows=5 valid=2 v1=1 legacy=1 invalid=0 unsupported=3');
    expect(old.stdout).toContain('newer than this contract');
    expect(readFileSync(file, 'utf8')).toBe(text);
  }, 30_000);

  test('G8 all actual remediation targets the producer/reader and preserves cross-version input', () => {
    const v2 = historicalV2Row();
    const rows = [
      { ...v2, schema_version: 1 }, { ...v2, workspace_host: 'unknown' },
      { ...v2, host_agent_id: 'bad\nPRIVATE-ID' }, { ...v2, extra: 'PRIVATE-EXTRA' },
      { ...v2, host_agent_id: 'x'.repeat(201) }, { ...v2, host_agent_id: ' ' },
      { ...legacyOf(historicalRow()), model_source: 'requested' }, { ...v2, model: null, model_source: 'requested' },
    ];
    const text = rows.map(row => JSON.stringify(row)).join('\n');
    const result = runValidation(text);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe(result.summary + '\n');
    expect(result.diagnoses.length).toBeGreaterThan(0);
    for (const line of result.diagnoses) {
      expect(line).toMatch(/Fix: (keep the saved row unchanged;|correct the producer, never the saved row)/);
      expect(line).not.toMatch(/Fix: (remove|write|add)/);
    }
    for (const secret of ['PRIVATE-ID', 'PRIVATE-EXTRA']) expect(result.stderr + result.stdout).not.toContain(secret);
    expect(readFileSync(result.file!, 'utf8')).toBe(text);
  });
});

describe('paused and resumed segments', () => {
  test('paused and resumed segments: the join contract states the rules, and two checkouts leave two valid v2 rows', () => {
    const contract = section(docText(), '## Join contract').replace(/\s+/g, ' ');
    expect(contract).toContain('Segments link by `work_item` when the launcher set it for every segment.');
    expect(contract).toContain('the segments are unlinked, which is unknown');
    expect(contract).toContain("is unobserved and unknown, never zero");
    expect(contract).toContain('A resume that skips its own start has no handoff: its start-less finish adopts another open handoff of that skill in that root');
    expect(contract).toContain('(an exact fingerprint match first, newest first)');
    expect(contract).toContain('A status-only invocation (`/pair-review status`, `/full-review status`) finishes `unknown`: it pairs its own start and reports no run outcome. A short `unknown` row can therefore be a status check, not a segment outcome, even when it carries the run\'s `work_item`.');
    expect(contract).toContain('Work that continues later in the same conversation after a pause (an answered question, a result line, the first action after a PAUSE that continues the work) is a resume too and runs its own start, once.');
    expect(contract).toContain('runs start again whenever work continues after a pause, including later in the same conversation.');

    const fix = makeTelemetryFixture('off');
    const checkoutA = initCheckout(fix.home, fix.env, 'checkout-a', 'git@github.com:acme/widget.git');
    const checkoutB = initCheckout(fix.home, fix.env, 'checkout-b', 'git@github.com:acme/widget.git');
    const env = { ...fix.env, GSTACK_EXTEND_WORK_ITEM: 'item-53a' };
    const skill = 'extend:review-and-prep';
    expect(runTelemetry({ ...env, CODEX_THREAD_ID: 'thread-a' }, checkoutA, ['start', '--skill', skill]).status).toBe(0);
    expect(runTelemetry({ ...env, CODEX_THREAD_ID: 'thread-a' }, checkoutA, ['finish', '--skill', skill, '--outcome', 'blocked']).status).toBe(0);
    expect(runTelemetry({ ...env, CODEX_THREAD_ID: 'thread-b' }, checkoutB, ['start', '--skill', skill]).status).toBe(0);
    expect(runTelemetry({ ...env, CODEX_THREAD_ID: 'thread-b' }, checkoutB, ['finish', '--skill', skill, '--outcome', 'success']).status).toBe(0);

    const rows = fix.readLedger();
    expect(rows.map(row => row.outcome)).toEqual(['blocked', 'success']);
    expect(new Set(rows.map(row => row.session_id)).size).toBe(2);
    expect(rows.map(row => row.work_item)).toEqual(['item-53a', 'item-53a']);
    for (const row of rows) {
      expect(row.schema_version).toBe(4);
      expect(verdict(row)).toEqual({ ok: true, errors: [] });
    }

    const v1 = historicalRow();
    const all = [legacyOf(v1), v1, ...rows];
    const result = runValidation(all.map(row => JSON.stringify(row)).join('\n') + '\n');
    expect(result.status).toBe(0);
    expect(result.summary).toBe(summaryOf({ rows: 4, v4: 2, v1: 1, legacy: 1 }));
  }, 60_000);
});

describe('Track 67A usage capture and workflow-metrics v2 schema contract', () => {
  test('review-and-prep finish with capture preserves stage-runs v3 key order and saved-row retry byte identity, while legacy, v1, and v2 fixtures still validate', () => {
    const fix = makeTelemetryFixture('community');
    const repo = initCheckout(fix.home, fix.env, 'checkout-67a', 'git@github.com:acme/widget.git');
    const started = runTelemetry(fix.env, repo, ['start', '--skill', 'extend:review-and-prep']);
    const sid = /session=(extend-[0-9a-f-]{36})/.exec(started.stdout)![1];

    const begin = spawnSync(WRAPPER, ['metrics', 'begin'], {
      cwd: repo,
      env: fix.env,
      encoding: 'utf8',
      timeout: 15_000,
      input: JSON.stringify({
        v: 1,
        stage: 'review-and-prep',
        session_id: sid,
        event_id: randomUUID(),
        step_id: randomUUID(),
        parent_step_id: null,
        kind: 'run',
        phase: 'run',
        context: {
          candidate_head: null,
          candidate_tree: null,
          candidate_base: null,
          binding: 'unknown',
          skill_sha256: null,
          parent_session_id: null,
        },
      }),
    });
    expect(JSON.parse(begin.stdout).status).toBe('recorded');

    // First attempt fails stage-runs append by blocking the stage-runs directory, saving the constructed row in the handoff.
    const analyticsDir = join(fix.home, '.gstack-extend/analytics');
    const stageRunsDir = join(analyticsDir, 'stage-runs');
    mkdirSync(analyticsDir, { recursive: true });
    writeFileSync(stageRunsDir, 'block'); // regular file at directory path causes append to fail
    expect(runTelemetry(fix.env, repo, ['finish', '--skill', 'extend:review-and-prep', '--outcome', 'success']).status).toBe(0);

    // Inspect the saved row inside the handoff file before retrying.
    const telRoot = join(fix.home, '.gstack-extend/telemetry');
    const slotDirs = readdirSync(telRoot);
    expect(slotDirs).toHaveLength(1);
    const slotDir = join(telRoot, slotDirs[0]!);
    const handoffFile = join(slotDir, readdirSync(slotDir)[0]!);
    const savedRow = JSON.parse(readFileSync(handoffFile, 'utf8')).row;
    expect(savedRow).toBeTruthy();
    const expectedLine = JSON.stringify(savedRow) + '\n';

    // Remove the obstacle and retry finish with capture enabled: appended bytes must equal the saved row byte-for-byte.
    rmSync(stageRunsDir, { recursive: true, force: true });
    expect(runTelemetry(fix.env, repo, ['finish', '--skill', 'extend:review-and-prep', '--outcome', 'success']).status).toBe(0);
    const ledgerFile = fix.ledgerFiles()[0]!;
    const rawStageRuns = readFileSync(ledgerFile, 'utf8');
    expect(rawStageRuns).toBe(expectedLine);

    const row = fix.readLedger()[0]!;
    expect(Object.keys(row)).toEqual(Object.keys(quickstartRow()));
    expect(verdict(row)).toEqual({ ok: true, errors: [] });

    // Existing legacy, v1, and v2 fixtures still validate alongside the new v3 row.
    const v1 = historicalRow();
    const v2 = historicalV2Row();
    const leg = legacyOf(v1);
    expect(verdict(v1)).toEqual({ ok: true, errors: [] });
    expect(verdict(v2)).toEqual({ ok: true, errors: [] });
    expect(verdict(leg)).toEqual({ ok: true, errors: [] });
  }, 60_000);

  test('workflow-metrics schema validates v1 records and v2 usage records, and rejects v:1+usage, v:2+begin, and extra keys in usage_request', () => {
    const metricsSchema = JSON.parse(readFileSync(join(ROOT, 'docs/workflow-metrics.schema.json'), 'utf8'));
    const ajv = new Ajv({ strict: true, allErrors: true });
    const validate = ajv.compile(metricsSchema);

    const sid = `extend-${randomUUID()}`;
    const eid = randomUUID();
    const stepId = randomUUID();
    const digest = 'a'.repeat(64);

    const v1Begin = {
      v: 1,
      op: 'begin',
      event_id: eid,
      request_digest: digest,
      captured_at_ms: 1000,
      producer_version: '0.57.0',
      request: {
        v: 1,
        stage: 'review-and-prep',
        session_id: sid,
        event_id: eid,
        step_id: stepId,
        parent_step_id: null,
        kind: 'phase',
        phase: 'tests',
      },
    };
    expect(validate(v1Begin)).toBe(true);

    const v2Usage = {
      v: 2,
      op: 'usage',
      event_id: eid,
      request_digest: digest,
      captured_at_ms: 2000,
      producer_version: '0.57.0',
      request: {
        v: 1,
        stage: 'review-and-prep',
        session_id: sid,
        event_id: eid,
        status: 'ok',
        reasons: ['not-reported', 'window-not-reported'],
        harness: 'claude',
        window: { begin_ms: 1000, end_ms: 2000 },
        observed_through_ms: 2000,
        sources: [{
          ref: 'b'.repeat(64),
          agent: 'claude',
          relation: 'own',
          evidence: 'direct',
          parent_ref: null,
          link: null,
          link_evidence: null,
          models: ['claude-opus-4-6'],
          first_ms: 1100,
          last_ms: 1900,
          complete: true,
          reasons: ['window-not-reported'],
        }],
        buckets: [{
          source: 0,
          model: 'claude-opus-4-6',
          step_id: stepId,
          placement: 'step',
          input: 100,
          cache_read: 50,
          cache_write: 10,
          output: 40,
          reasoning: null,
          null_reasons: ['not-reported'],
          responses: 1,
        }],
        windows: [],
        cli_reported: [],
      },
    };
    expect(validate(v2Usage)).toBe(true);

    // v:1 + usage is invalid; v:2 + begin is invalid; extra key in usage_request is invalid.
    expect(validate({ ...v2Usage, v: 1 })).toBe(false);
    expect(validate({ ...v1Begin, v: 2 })).toBe(false);
    expect(validate({
      ...v2Usage,
      request: { ...v2Usage.request, extra_key: true },
    })).toBe(false);
  });
});

describe('stage-runs v4: run_mode, usability signals, per-host files, migration, and report', () => {
  test('run_mode branches follow the amended rule and validate against stage-runs.schema.json', () => {
    const fix = makeTelemetryFixture('off');
    const repo = initCheckout(fix.home, fix.env, 'checkout-v4-mode', 'git@github.com:acme/widget.git');
    const customGstackHome = join(fix.home, 'custom-gstack-home');
    mkdirSync(customGstackHome, { recursive: true });

    const cases: Array<{
      name: string;
      env: Record<string, string>;
      finishArgs?: string[];
      expectedMode: string;
      expectedSource: string;
    }> = [
      {
        name: 'GSTACK_EXTEND_RUN_MODE=orchestrated',
        env: { GSTACK_EXTEND_RUN_MODE: 'orchestrated', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
        expectedMode: 'orchestrated',
        expectedSource: 'run-mode-env',
      },
      {
        name: 'unrecognized GSTACK_EXTEND_RUN_MODE',
        env: { GSTACK_EXTEND_RUN_MODE: 'user-directed', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
        expectedMode: 'unknown',
        expectedSource: 'unrecognized-run-mode-env',
      },
      {
        name: 'GSTACK_SESSION_KIND=spawned',
        env: { GSTACK_SESSION_KIND: 'spawned', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
        expectedMode: 'orchestrated',
        expectedSource: 'session-kind',
      },
      {
        name: 'GSTACK_SESSION_KIND=unattended',
        env: { GSTACK_SESSION_KIND: 'unattended', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
        expectedMode: 'orchestrated',
        expectedSource: 'session-kind',
      },
      {
        name: 'GSTACK_EXTEND_WORK_ITEM primary signal',
        env: { GSTACK_EXTEND_WORK_ITEM: 'item-primary', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
        expectedMode: 'orchestrated',
        expectedSource: 'work-item',
      },
      {
        name: '--work-item flag alone does not classify as orchestrated',
        env: { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
        finishArgs: ['--work-item', 'manual-flag-item'],
        expectedMode: 'user-directed',
        expectedSource: 'cli',
      },
      {
        name: 'non-default GSTACK_HOME blocks user-directed',
        env: { GSTACK_HOME: customGstackHome, CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
        expectedMode: 'unknown',
        expectedSource: 'launcher-state-root',
      },
      {
        name: 'GSTACK_EXTEND_WORKSPACE_OWNER blocks user-directed',
        env: { GSTACK_EXTEND_WORKSPACE_OWNER: 'paseo', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
        expectedMode: 'unknown',
        expectedSource: 'host-managed-workspace',
      },
      {
        name: 'malformed GSTACK_EXTEND_WORKSPACE_OWNER fails closed as malformed-signal',
        env: { GSTACK_EXTEND_WORKSPACE_OWNER: 'bad\nowner', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
        expectedMode: 'unknown',
        expectedSource: 'malformed-signal',
      },
      {
        name: 'Claude cli interactive entrypoint',
        env: { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
        expectedMode: 'user-directed',
        expectedSource: 'cli',
      },
      {
        name: 'Paseo app entrypoint Paseo qualifies as user-directed with paseo-entrypoint',
        env: { PASEO_AGENT_ID: 'paseo-1', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'Paseo' },
        expectedMode: 'user-directed',
        expectedSource: 'paseo-entrypoint',
      },
      {
        name: 'SDK entrypoint sdk-cli is unqualified',
        env: { PASEO_AGENT_ID: 'paseo-2', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' },
        expectedMode: 'unknown',
        expectedSource: 'entrypoint-unqualified',
      },
      {
        name: 'SDK entrypoint sdk-ts is unqualified',
        env: { PASEO_AGENT_ID: 'paseo-3', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' },
        expectedMode: 'unknown',
        expectedSource: 'entrypoint-unqualified',
      },
      {
        name: 'ACP entrypoint acp is unqualified',
        env: { PASEO_AGENT_ID: 'paseo-4', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'acp' },
        expectedMode: 'unknown',
        expectedSource: 'entrypoint-unqualified',
      },
      {
        name: 'missing entrypoint on Claude yields entrypoint-unavailable',
        env: { CLAUDECODE: '1' },
        expectedMode: 'unknown',
        expectedSource: 'entrypoint-unavailable',
      },
      {
        name: 'non-Claude harness yields harness-unqualified',
        env: { CODEX_THREAD_ID: 'codex-1' },
        expectedMode: 'unknown',
        expectedSource: 'harness-unqualified',
      },
      {
        name: 'no harness yields no-harness',
        env: {},
        expectedMode: 'unknown',
        expectedSource: 'no-harness',
      },
    ];

    for (const tc of cases) {
      const env = { ...fix.env, ...tc.env };
      expect(runTelemetry(env, repo, ['start', '--skill', 'extend:roadmap']).status, tc.name).toBe(0);
      expect(runTelemetry(env, repo, ['finish', '--skill', 'extend:roadmap', '--outcome', 'success', ...(tc.finishArgs ?? [])]).status, tc.name).toBe(0);
      const row = fix.readLedger().at(-1)!;
      expect(row.run_mode, tc.name).toBe(tc.expectedMode);
      expect(row.run_mode_source, tc.name).toBe(tc.expectedSource);
      expect(verdict(row), tc.name).toEqual({ ok: true, errors: [] });
    }
  }, 60_000);

  test('documented per-host migration command moves legacy stage-runs.jsonl without clobbering, preserves the row multiset, and leaves report totals unchanged', () => {
    const fix = makeTelemetryFixture('off');
    const body = section(docText(), '### Per-host files and migration');
    const migrationCmd = /~~~sh\n([\s\S]*?)~~~/.exec(body)![1];
    const analyticsDir = join(fix.home, '.gstack-extend/analytics');
    const stageRunsDir = join(analyticsDir, 'stage-runs');
    mkdirSync(stageRunsDir, { recursive: true });
    const legacyFile = join(analyticsDir, 'stage-runs.jsonl');

    const r1 = { ...legacyOf(historicalRow()), session_id: 'mig-leg' };
    const r2 = { ...historicalRow(), session_id: 'mig-v1' };
    const r3 = { ...historicalV2Row(), session_id: 'mig-v2' };
    const r4 = {
      ...quickstartRow(),
      session_id: 'mig-v3-blocked',
      outcome: 'blocked',
      run_mode: 'orchestrated',
      run_mode_source: 'run-mode-env',
      questions: null,
      user_wait_s: null,
      resumes: null,
      user_signals_source: 'orchestrated',
      blocked_reason: null,
      blocked_reason_source: 'orchestrated',
    };
    writeFileSync(legacyFile, [r1, r2, r3].map(r => JSON.stringify(r)).join('\n') + '\n');
    writeFileSync(join(stageRunsDir, 'other-host.jsonl'), JSON.stringify(r4) + '\n');

    const beforeMultiset = fix.readLedger().map(r => JSON.stringify(r)).sort();
    const beforeReport = JSON.parse(runTelemetry(fix.env, ROOT, ['report', '--json']).stdout);

    // Run 1: target <host>.legacy.jsonl does not exist yet -> moves legacyFile to stage-runs/<host>.legacy.jsonl.
    const first = spawnSync('bash', ['-c', migrationCmd], {
      cwd: ROOT,
      env: { ...fix.env, PATH: join(ROOT, 'bin') + ':/usr/bin:/bin' },
      encoding: 'utf8',
    });
    expect([first.status, first.stderr]).toEqual([0, '']);
    expect(first.stdout).toContain('migrated rows: before=3 after=3');
    expect(existsSync(legacyFile)).toBe(false);
    expect(fix.ledgerFiles().some(f => f.endsWith('.legacy.jsonl'))).toBe(true);

    const afterMultiset = fix.readLedger().map(r => JSON.stringify(r)).sort();
    expect(afterMultiset).toEqual(beforeMultiset);
    const afterReport = JSON.parse(runTelemetry(fix.env, ROOT, ['report', '--json']).stdout);
    expect(afterReport.rows).toEqual(beforeReport.rows);
    expect(afterReport.skills).toEqual(beforeReport.skills);
    expect(afterReport.empty_cells).toEqual(beforeReport.empty_cells);

    // Run 2: if legacyFile is recreated while <host>.legacy.jsonl already exists -> refuses without clobbering.
    writeFileSync(legacyFile, JSON.stringify(r1) + '\n');
    const second = spawnSync('bash', ['-c', migrationCmd], {
      cwd: ROOT,
      env: { ...fix.env, PATH: join(ROOT, 'bin') + ':/usr/bin:/bin' },
      encoding: 'utf8',
    });
    expect(second.status).not.toBe(0);
    expect(second.stderr).toContain('refused: target already exists');
  });

  test('documented migration rolls back its new link when removing the source fails', () => {
    const body = section(docText(), '### Per-host files and migration');
    const command = /~~~sh\n([\s\S]*?)~~~/.exec(body)![1];
    const script = /^python3 -I -c '([\s\S]*)'\n$/.exec(command)![1];
    for (const replaceDestination of [false, true]) {
      const fix = makeTelemetryFixture('off');
      const root = join(fix.home, '.gstack-extend');
      const legacy = join(root, 'analytics/stage-runs.jsonl');
      const destination = join(root, 'analytics/stage-runs/fixture-host.legacy.jsonl');
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(join(root, 'config'), 'host_id=fixture-host\n');
      const original = JSON.stringify(historicalRow()) + '\n';
      writeFileSync(legacy, original);
      // Inject the filesystem failure in this isolated process, including an unrelated replacement
      // at the destination: recovery must remove only the hard link this attempt created.
      const failUnlink = `import os\nfrom pathlib import Path\n_real_unlink = os.unlink\ndef fail_source(path, *args, **kwargs):\n    if Path(path).name == "stage-runs.jsonl":\n        target = Path(path).parent / "stage-runs/fixture-host.legacy.jsonl"\n        if ${replaceDestination ? 'True' : 'False'}:\n            _real_unlink(target)\n            target.write_text("replacement\\n")\n        raise PermissionError("injected source removal failure")\n    return _real_unlink(path, *args, **kwargs)\nos.unlink = fail_source\n`;
      const result = spawnSync('python3', ['-B', '-I', '-c', failUnlink + script],
        { cwd: ROOT, env: fix.env, encoding: 'utf8', timeout: 10_000 });
      expect(result.status).not.toBe(0);
      expect(readFileSync(legacy, 'utf8')).toBe(original);
      if (replaceDestination) expect(readFileSync(destination, 'utf8')).toBe('replacement\n');
      else {
        expect(existsSync(destination)).toBe(false);
        expect(fix.readLedger()).toEqual([historicalRow()]);
      }
    }
  });

  test('documented validator visits legacy and every host ledger in shared-reader order', () => {
    const fix = makeTelemetryFixture('off');
    const root = join(fix.home, '.gstack-extend');
    const hosts = join(root, 'analytics/stage-runs');
    mkdirSync(hosts, { recursive: true });
    writeFileSync(join(root, 'config'), 'host_id=configured-host\n');
    const files = [join(root, 'analytics/stage-runs.jsonl'), join(hosts, 'a.legacy.jsonl'),
      join(hosts, 'configured-host.jsonl'), join(hosts, 'z.jsonl')];
    for (let index = 0; index < files.length; index++) {
      writeFileSync(files[index], (JSON.stringify(historicalRow()) + '\n').repeat(index + 1));
    }
    symlinkSync(files[0], join(hosts, 'symlink.jsonl'));
    writeFileSync(join(hosts, 'ignored.txt'), 'not a ledger\n');
    expect(spawnSync('mkfifo', [join(hosts, 'fifo.jsonl')]).status).toBe(0);
    const doc = docText();
    const discovery = [...section(doc, '## Schema validation').matchAll(/~~~sh\n([\s\S]*?)~~~/g)]
      .map(match => match[1]).find(block => block.includes('export STAGE_RUNS_FILE'))!;
    expect(discovery).toBeDefined();
    const result = spawnSync('bash', ['-c', validationCommand(doc) + '\n' + discovery], {
      cwd: ROOT, env: { ...fix.env, PATH: dirname(process.execPath) + ':/usr/bin:/bin' },
      encoding: 'utf8', timeout: 30_000,
    });
    expect([result.status, result.stderr]).toEqual([0, '']);
    expect(result.stdout.trimEnd().split('\n')).toEqual([
      summaryOf({ rows: 1, v4: 1 }),
      ...files.map((_, index) => summaryOf({ rows: index + 1, v1: index + 1 })),
    ]);
    // One invalid file must fail the whole block without hiding the remaining host results.
    writeFileSync(files[1], 'null\n');
    const invalid = spawnSync('bash', ['-c', validationCommand(doc) + '\n' + discovery], {
      cwd: ROOT, env: { ...fix.env, PATH: dirname(process.execPath) + ':/usr/bin:/bin' },
      encoding: 'utf8', timeout: 30_000,
    });
    expect(invalid.status).toBe(1);
    expect(invalid.stdout.trimEnd().split('\n')).toEqual([
      summaryOf({ rows: 1, v4: 1 }), summaryOf({ rows: 1, v1: 1 }),
      summaryOf({ rows: 1, invalid: 1 }), summaryOf({ rows: 3, v1: 3 }),
      summaryOf({ rows: 4, v1: 4 }),
    ]);
  }, 30_000);

  test('hand-use qualification record and docs/telemetry.md notice match the pending-PM1 contract', () => {
    const recordPath = join(ROOT, 'docs/acceptance/hand-use-telemetry.md');
    expect(existsSync(recordPath)).toBe(true);
    const record = readFileSync(recordPath, 'utf8');
    expect(record).toContain('Status: pending — no real runs recorded');
    for (const h of [
      '## What counts',
      '## Readback procedure',
      '## Recorded runs',
      '## Harnesses and entrypoints that read `unknown`',
    ]) {
      expect(record).toContain(h);
    }
    expect(record).toContain('paseo-entrypoint');
    expect(record).toContain('GSTACK_EXTEND_RUN_MODE=orchestrated');
    const telemetryDoc = docText();
    const runModeSection = section(telemetryDoc, '### Run mode');
    expect(runModeSection).toContain('(acceptance/hand-use-telemetry.md)');
    expect(runModeSection).toContain('Hand-use capture is not yet established: no real by-hand run has been read back');
  });
});
