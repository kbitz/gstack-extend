import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { routeSourceTag, validateTagExpression } from '../src/audit/lib/source-tag.ts';
import { main, type ScanResult } from '../src/full-review/state-machines-cli.ts';
import type { ScanResult as EngineScanResult } from '../src/full-review/state-machines.ts';

const REPO_ROOT = resolve(import.meta.dir, '..');
const BIN = join(REPO_ROOT, 'bin/full-review-state-machines');
const FIXTURES_ROOT = join(REPO_ROOT, 'tests/fixtures/full-review-state-machines');
const BASE_TMP = mkdtempSync(join(tmpdir(), 'fr-state-machines-test-'));

afterAll(() => {
  rmSync(BASE_TMP, { recursive: true, force: true });
});

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  const visit = (cur: string) => {
    for (const entry of readdirSync(cur, { withFileTypes: true })) {
      const abs = join(cur, entry.name);
      if (entry.isDirectory()) visit(abs);
      else out.push(abs);
    }
  };
  visit(dir);
  return out.sort();
}

function materializeFixture(name: string, options: { initGit?: boolean } = {}): string {
  const srcRoot = join(FIXTURES_ROOT, name);
  const destRoot = mkdtempSync(join(BASE_TMP, `${name}-`));
  for (const abs of walkFiles(srcRoot)) {
    const relTxt = relative(srcRoot, abs);
    const rel = relTxt.endsWith('.txt') ? relTxt.slice(0, -4) : relTxt;
    const target = join(destRoot, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(abs, 'utf8'));
  }
  if (options.initGit) {
    const init = spawnSync('git', ['init', '--quiet', destRoot], { encoding: 'utf8', timeout: 15_000 });
    expect(init.status).toBe(0);
  }
  return destRoot;
}

function runMain(argv: string[], cwd: string = BASE_TMP): { status: number; stdout: string; stderr: string } {
  let stdout = '';
  let stderr = '';
  const status = main(argv, {
    cwd,
    stdout: chunk => {
      stdout += chunk;
    },
    stderr: chunk => {
      stderr += chunk;
    },
  });
  return { status, stdout, stderr };
}

function runSubprocess(argv: string[], cwd: string = BASE_TMP): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync('/bin/sh', [BIN, ...argv], { cwd, encoding: 'utf8', timeout: 15_000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function assertMechanicsOnly(result: EngineScanResult): void {
  const forbiddenKeys = new Set(['severity', 'verdict', 'classification', 'recommendation']);
  for (const candidate of result.candidates) {
    for (const key of Object.keys(candidate)) {
      expect(forbiddenKeys.has(key)).toBe(false);
    }
    for (const key of Object.keys(candidate.facts)) {
      expect(forbiddenKeys.has(key)).toBe(false);
    }
    expect(candidate.sites.length).toBeGreaterThan(0);
    for (const site of candidate.sites) {
      expect(site.line).toBeGreaterThan(0);
      expect(site.file.length).toBeGreaterThan(0);
    }
  }
}

describe('bin/full-review-state-machines mechanical pre-scanner', () => {
  // Value: protects=all six intra-language mechanical signals fire on seeded Python implicit state machines with accurate sites and zero verdict fields; fails_when=any signal regresses or emits non-mechanical judgments; why_new=Track 100A T3; seam=none
  test('surfaces S1-S6 on seeded Python implicit-state-machine fixture with mechanics-only output', () => {
    const dir = materializeFixture('implicit-sm-py', { initGit: true });
    const res = runSubprocess(['--format', 'json', dir]);
    expect(res.status).toBe(0);
    expect(res.stderr).toBe('');
    const parsed = JSON.parse(res.stdout) as EngineScanResult;
    expect(parsed.schema).toBe('full-review-state-machines/v1');
    expect(parsed.discovery).toBe('git');
    expect(parsed.scanned_by_language).toEqual({ python: 2, ts_js: 0 });
    expect(parsed.skipped_files).toBe(0);
    assertMechanicsOnly(parsed);

    const signals = new Set(parsed.candidates.map(c => c.signal));
    expect(signals).toEqual(
      new Set([
        'string-state-fanout',
        'boolean-state-bag',
        'mutation-fanout',
        'write-decode-gap',
        'cross-file-inferred-state',
        'counter-thresholds',
      ]),
    );

    const bag = parsed.candidates.find(c => c.signal === 'boolean-state-bag')!;
    expect(bag.subject).toBe('OrderRecord');
    expect(bag.facts.fields).toEqual(['in_flight', 'pending_retry', 'settled_at']);

    const gap = parsed.candidates.find(c => c.signal === 'write-decode-gap')!;
    expect(gap.subject).toBe('lease_token');
    expect(gap.sites[0]!.file).toBe('workflow.py');

    const crossFile = parsed.candidates.find(c => c.signal === 'cross-file-inferred-state')!;
    expect(crossFile.facts.function).toBe('infer_order_phase');
    expect(crossFile.facts.state_files).toEqual([
      'order_checkpoint.json',
      'order_done.marker',
      'order_lock.flag',
    ]);
  });

  // Value: protects=all six intra-language mechanical signals fire on seeded TS/JS implicit state machines; fails_when=TS/JS lexical parsing misses any signal; why_new=Track 100A T3; seam=none
  test('surfaces S1-S6 on seeded TypeScript implicit-state-machine fixture', () => {
    const dir = materializeFixture('implicit-sm-ts');
    const res = runMain(['--format', 'json', dir]);
    expect(res.status).toBe(0);
    expect(res.stderr).toBe('');
    const parsed = JSON.parse(res.stdout) as EngineScanResult;
    expect(parsed.discovery).toBe('walk');
    expect(parsed.scanned_by_language).toEqual({ python: 0, ts_js: 2 });
    assertMechanicsOnly(parsed);

    const signals = new Set(parsed.candidates.map(c => c.signal));
    expect(signals).toEqual(
      new Set([
        'string-state-fanout',
        'boolean-state-bag',
        'mutation-fanout',
        'write-decode-gap',
        'cross-file-inferred-state',
        'counter-thresholds',
      ]),
    );

    const bag = parsed.candidates.find(c => c.signal === 'boolean-state-bag')!;
    expect(bag.subject).toBe('JobRecord');
    expect(bag.facts.fields).toEqual(['inFlight', 'awaitingAck', 'settledAt']);

    const gap = parsed.candidates.find(c => c.signal === 'write-decode-gap')!;
    expect(gap.subject).toBe('leaseToken');
  });

  // Value: protects=cross-language vocabulary drift flags overlapping Python and TS vocabularies without a parity test and stays quiet when a parity test exists; fails_when=S7 misses asymmetric tokens or ignores parity tests; why_new=Track 100A T3; seam=none
  test('surfaces S7 on cross-language vocabulary drift and suppresses it when a parity test exists', () => {
    const driftDir = materializeFixture('cross-lang-drift');
    const driftRes = runMain(['--format', 'json', driftDir]);
    expect(driftRes.status).toBe(0);
    const driftParsed = JSON.parse(driftRes.stdout) as EngineScanResult;
    assertMechanicsOnly(driftParsed);
    const drift = driftParsed.candidates.find(c => c.signal === 'cross-language-enum-drift');
    expect(drift).toBeDefined();
    expect(drift!.facts.shared_tokens).toEqual(['completed', 'pending', 'running']);
    expect(drift!.facts.python_only).toEqual(['paused']);
    expect(drift!.facts.ts_js_only).toEqual(['cancelled']);

    const parityDir = materializeFixture('cross-lang-parity');
    const parityRes = runMain(['--format', 'json', parityDir]);
    expect(parityRes.status).toBe(0);
    const parityParsed = JSON.parse(parityRes.stdout) as EngineScanResult;
    expect(parityParsed.candidates.filter(c => c.signal === 'cross-language-enum-drift')).toEqual([]);
  });

  // Value: protects=the plain-check fixture surfaces only write-decode-gap without false positives on fan-out or boolean bags; fails_when=the scanner conflates a single unchecked persisted key with a full implicit state machine; why_new=Track 100A T3; seam=none
  test('plain-check fixture surfaces only write-decode-gap', () => {
    const dir = materializeFixture('plain-check');
    const res = runMain(['--format', 'json', dir]);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout) as EngineScanResult;
    assertMechanicsOnly(parsed);

    const signals = new Set(parsed.candidates.map(c => c.signal));
    expect(signals).toEqual(new Set(['write-decode-gap']));
    const subjects = parsed.candidates.map(c => c.subject).sort();
    expect(subjects).toEqual(['formatVersion', 'schema_version']);
  });

  // Value: protects=clean typed code and unsupported languages emit NO_CANDIDATES and exit 0 with accurate skipped counts; fails_when=typed enums, reducer modules, or non-Python/non-TS files trigger false positives or errors; why_new=Track 100A T3; seam=none
  test('clean-and-other-langs emits zero candidates and skips unsupported extensions cleanly', () => {
    const dir = materializeFixture('clean-and-other-langs');
    const textRes = runSubprocess([dir]);
    expect(textRes.status).toBe(0);
    expect(textRes.stderr).toBe('');
    expect(textRes.stdout.trim()).toBe('NO_CANDIDATES');

    const jsonRes = runMain(['--format', 'json', dir]);
    expect(jsonRes.status).toBe(0);
    const parsed = JSON.parse(jsonRes.stdout) as EngineScanResult;
    expect(parsed.candidates).toEqual([]);
    expect(parsed.scanned_by_language).toEqual({ python: 1, ts_js: 1 });
    expect(parsed.skipped_files).toBe(3); // main.go, lib.rs, README.md
  });

  test('CLI flags, limits, escaping symlinks, --help/-h, and error exit codes behave deterministically', () => {
    for (const flag of ['--help', '-h']) {
      const scratch = mkdtempSync(join(BASE_TMP, 'help-'));
      const r = runSubprocess([flag], scratch);
      expect(r.status).toBe(0);
      expect(r.stderr).toBe('');
      expect(r.stdout).toContain('Usage: full-review-state-machines');
      expect(r.stdout).toContain('--max-candidates');
      expect(readdirSync(scratch)).toEqual([]);
    }

    const badArg = runMain(['--not-a-flag']);
    expect(badArg.status).toBe(2);
    expect(badArg.stderr).toContain('unknown option');

    const badFormat = runMain(['--format', 'xml']);
    expect(badFormat.status).toBe(2);

    const badNum = runMain(['--min-fields', '0']);
    expect(badNum.status).toBe(2);

    const missingDir = runMain([join(BASE_TMP, 'does-not-exist-9999')]);
    expect(missingDir.status).toBe(1);
    expect(missingDir.stderr).toContain('does not exist');

    // Limit tuning & truncation
    const pyDir = materializeFixture('implicit-sm-py');
    const raised = runMain(['--format', 'json', '--min-fields', '5', '--max-candidates', '2', pyDir]);
    expect(raised.status).toBe(0);
    const raisedParsed = JSON.parse(raised.stdout) as EngineScanResult;
    expect(raisedParsed.candidates.some(c => c.signal === 'boolean-state-bag')).toBe(false);
    expect(raisedParsed.candidates.length).toBe(2);
    expect(raisedParsed.truncated).toBe(true);
    expect(raisedParsed.total_candidates).toBeGreaterThan(2);

    // Escaping symlink is skipped
    const outsideDir = mkdtempSync(join(BASE_TMP, 'outside-'));
    const outsideFile = join(outsideDir, 'escaped.py');
    writeFileSync(outsideFile, 'x = 1\n');
    const cleanDir = materializeFixture('clean-and-other-langs');
    symlinkSync(outsideFile, join(cleanDir, 'escaped_link.py'));
    const symRes = runMain(['--format', 'json', cleanDir]);
    expect(symRes.status).toBe(0);
    const symParsed = JSON.parse(symRes.stdout) as EngineScanResult;
    expect(symParsed.scanned_by_language).toEqual({ python: 1, ts_js: 1 });
    expect(symParsed.skipped_files).toBe(4);
  });
});

describe('fixture-backed implicit-state-machine lens classification and source-tag contract', () => {
  // Value: protects=pre-scanner evidence pairs cleanly with /full-review finding lines, [make explicit now]/[plain check] tags, validateTagExpression, and routeSourceTag; fails_when=classification tags break finding grammar, source-tag validation, or routing; why_new=Track 100A T3 criterion 5; seam=none; no_claim=live LLM judgment
  test('seeded implicit state machine vs plain-check findings satisfy /full-review grammar and source-tag routing', () => {
    const smDir = materializeFixture('implicit-sm-py');
    const smScan = JSON.parse(runMain(['--format', 'json', smDir]).stdout) as EngineScanResult;
    expect(smScan.candidates.some(c => c.signal === 'boolean-state-bag')).toBe(true);
    expect(smScan.candidates.some(c => c.signal === 'mutation-fanout')).toBe(true);

    const pcDir = materializeFixture('plain-check');
    const pcScan = JSON.parse(runMain(['--format', 'json', pcDir]).stdout) as EngineScanResult;
    expect(pcScan.candidates.map(c => c.signal)).toEqual(['write-decode-gap', 'write-decode-gap']);

    const findingLineRe =
      /^FILE: (.+?) \| LINE: ([0-9-]+) \| SEVERITY: (critical|necessary|nice-to-have|edge-case) \| DESCRIPTION: (.+?) \| HYPOTHESIS: (.+)$/;

    const findings = [
      {
        line:
          'FILE: workflow.py | LINE: 8-35 | SEVERITY: critical | DESCRIPTION: [make explicit now] OrderRecord spreads lifecycle state across status strings, in_flight/pending_retry/settled_at flags, and three scattered writers, allowing an order to be settled_at non-null while in_flight is True on crash recovery. | HYPOTHESIS: Introduce an explicit OrderState union/enum, a single transition table, and load-time validation rejecting impossible flag combinations.',
        tag: '[full-review:critical,files=workflow.py]',
        expectedRoute: 'KEEP',
        expectedMarker: '[make explicit now]',
      },
      {
        line:
          'FILE: store.py | LINE: 5-17 | SEVERITY: necessary | DESCRIPTION: [plain check] save_session persists schema_version but load_session ignores it, allowing a corrupt or incompatible persisted record to decode silently. | HYPOTHESIS: Add a single assertion in load_session validating data["schema_version"] against the supported version before returning.',
        tag: '[full-review:necessary,files=store.py]',
        expectedRoute: 'KEEP',
        expectedMarker: '[plain check]',
      },
      {
        line:
          'FILE: order.py | LINE: 12 | SEVERITY: edge-case | DESCRIPTION: is_terminal is a pure derivation over OrderStatus with no reachable impossible state; dropped at source. | HYPOTHESIS: No change needed.',
        tag: '[full-review:edge-case,files=order.py]',
        expectedRoute: 'KILL',
        expectedMarker: null,
      },
    ];

    for (const f of findings) {
      const m = findingLineRe.exec(f.line);
      expect(m, f.line).not.toBeNull();
      if (f.expectedMarker) {
        expect(m![4]).toContain(f.expectedMarker);
      }
      expect(validateTagExpression(f.tag).ok).toBe(true);
      expect(routeSourceTag(f.tag).action).toBe(f.expectedRoute);
    }
  });
});

describe('fixture hygiene and consumer independence', () => {
  test('every file under tests/fixtures/full-review-state-machines/ ends in .txt', () => {
    const allFixtureFiles = walkFiles(FIXTURES_ROOT);
    expect(allFixtureFiles.length).toBeGreaterThan(0);
    for (const abs of allFixtureFiles) {
      expect(abs.endsWith('.txt'), `expected .txt suffix on ${relative(REPO_ROOT, abs)}`).toBe(true);
    }
  });

  test('shipped skill, helper, docs, and fixtures contain no personal or consumer-specific identifiers', () => {
    const filesToCheck = [
      join(REPO_ROOT, 'skills/full-review.md'),
      join(REPO_ROOT, 'bin/full-review-state-machines'),
      join(REPO_ROOT, 'src/full-review/state-machines.ts'),
      join(REPO_ROOT, 'src/full-review/state-machines-cli.ts'),
      join(REPO_ROOT, 'docs/source-tag-contract.md'),
      ...walkFiles(FIXTURES_ROOT),
    ];
    const forbidden = [
      /\/Users\/[a-z0-9_-]+/i,
      /\/home\/[a-z0-9_-]+\/(?!\.gstack)/i,
      /\bmmm-factory\b/i,
      /\bkarlos\b/i,
      /\bthreading\b/i,
    ];
    for (const file of filesToCheck) {
      const content = readFileSync(file, 'utf8');
      for (const re of forbidden) {
        // docs/source-tag-contract.md has one historical example line referencing kbitz/threading; skip that pre-existing example line
        const filtered = file.endsWith('docs/source-tag-contract.md')
          ? content.split('\n').filter(l => !l.includes('surfaced during Group 2 pair-review')).join('\n')
          : content;
        expect(re.test(filtered), `${relative(REPO_ROOT, file)} matched ${re}`).toBe(false);
      }
    }
    expect(existsSync(BIN)).toBe(true);
  });
});
