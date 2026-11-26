#!/usr/bin/env bun
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_LIMITS, scanDirectory, type ScannerLimits, type ScanResult, type StateMachineCandidate } from './state-machines.ts';

const MAX_DISPLAY_SITES = 6;
const MAX_DISPLAY_FIELD = 160;
const MAX_DISPLAY_CHARS = 16_000;

export interface CliIo {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export interface ParsedArgs {
  dir?: string;
  format: 'text' | 'json';
  limits: Partial<ScannerLimits>;
  help: boolean;
}

export function help(): string {
  return `Usage: full-review-state-machines [DIR] [options]

Read-only mechanical pre-scanner for /full-review that reports candidate
implicit state-machine sites in Python and TypeScript/JavaScript repositories.
Other languages are skipped cleanly. Output contains mechanical facts only
(never severities, verdicts, or explicit-vs-plain-check classifications).

Options:
  --format text|json     Output format (default: text)
  --max-candidates N     Maximum candidates emitted (default: ${DEFAULT_LIMITS.maxCandidates})
  --min-sites N          Minimum functions for string-state-fanout / mutation-fanout (default: ${DEFAULT_LIMITS.minStringCompareFunctions})
  --min-files N          Minimum files for string-state-fanout (default: ${DEFAULT_LIMITS.minStringCompareFiles})
  --min-fields N         Minimum coupled lifecycle fields for boolean-state-bag (default: ${DEFAULT_LIMITS.minCoupledFields})
  --min-state-files N    Minimum state files per function for cross-file-inferred-state (default: ${DEFAULT_LIMITS.minStateFilesPerFunction})
  --min-thresholds N     Minimum branch sites for counter-thresholds (default: ${DEFAULT_LIMITS.minThresholdBranches})
  --min-vocab N          Minimum shared tokens for cross-language-enum-drift (default: ${DEFAULT_LIMITS.minSharedVocabTokens})
  --help, -h             Show this help message

Signals:
  string-state-fanout        State-like field compared to string literals across functions/files with no enum/union
  boolean-state-bag          Record/type/class with multiple coupled lifecycle booleans or nullables
  mutation-fanout            State-like field mutated across functions outside a transition/reducer module
  write-decode-gap           Persisted record key written but never referenced by loaders/decoders/schemas
  cross-file-inferred-state  Single function probing/reading multiple state files and branching on them
  counter-thresholds         Counter identifier compared against numeric literal thresholds across branches
  cross-language-enum-drift  Overlapping Python and TS/JS string vocabularies without a parity test

Exit codes:
  0  Scan completed (including zero candidates or unsupported-only repositories)
  1  Target directory missing/unreadable or internal error
  2  Invalid CLI arguments
`;
}

function parsePositiveInt(flag: string, raw: string): number {
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${flag} requires a positive integer, got ${JSON.stringify(raw)}`);
  }
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new Error(`${flag} requires a positive integer, got ${JSON.stringify(raw)}`);
  }
  return n;
}

export function parseArgs(argv: string[]): ParsedArgs {
  let dir: string | undefined;
  let format: 'text' | 'json' = 'text';
  let helpFlag = false;
  const limits: Partial<ScannerLimits> = {};

  const takeValue = (i: number, flag: string, inline?: string): [string, number] => {
    if (inline !== undefined) return [inline, i];
    if (i + 1 >= argv.length) throw new Error(`${flag} requires a value`);
    return [argv[i + 1]!, i + 1];
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--help' || arg === '-h') {
      helpFlag = true;
      continue;
    }
    const eq = arg.indexOf('=');
    const flag = eq > 0 && arg.startsWith('--') ? arg.slice(0, eq) : arg;
    const inline = eq > 0 && arg.startsWith('--') ? arg.slice(eq + 1) : undefined;

    if (flag === '--format') {
      const [val, next] = takeValue(i, flag, inline);
      i = next;
      if (val !== 'text' && val !== 'json') {
        throw new Error(`--format must be 'text' or 'json', got ${JSON.stringify(val)}`);
      }
      format = val;
    } else if (flag === '--max-candidates') {
      const [val, next] = takeValue(i, flag, inline);
      i = next;
      limits.maxCandidates = parsePositiveInt(flag, val);
    } else if (flag === '--min-sites') {
      const [val, next] = takeValue(i, flag, inline);
      i = next;
      const n = parsePositiveInt(flag, val);
      limits.minStringCompareFunctions = n;
      limits.minWriteFunctions = n;
    } else if (flag === '--min-files') {
      const [val, next] = takeValue(i, flag, inline);
      i = next;
      limits.minStringCompareFiles = parsePositiveInt(flag, val);
    } else if (flag === '--min-fields') {
      const [val, next] = takeValue(i, flag, inline);
      i = next;
      limits.minCoupledFields = parsePositiveInt(flag, val);
    } else if (flag === '--min-state-files') {
      const [val, next] = takeValue(i, flag, inline);
      i = next;
      limits.minStateFilesPerFunction = parsePositiveInt(flag, val);
    } else if (flag === '--min-thresholds') {
      const [val, next] = takeValue(i, flag, inline);
      i = next;
      limits.minThresholdBranches = parsePositiveInt(flag, val);
    } else if (flag === '--min-vocab') {
      const [val, next] = takeValue(i, flag, inline);
      i = next;
      limits.minSharedVocabTokens = parsePositiveInt(flag, val);
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown option: ${arg}`);
    } else if (dir === undefined) {
      dir = arg;
    } else {
      throw new Error(`unexpected extra positional argument: ${arg}`);
    }
  }

  return { dir, format, limits, help: helpFlag };
}

function singleLine(text: string): string {
  const escaped = JSON.stringify(text.slice(0, MAX_DISPLAY_FIELD)).slice(1, -1).replace(/[\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g,
    char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
  return escaped.length > MAX_DISPLAY_FIELD || text.length > MAX_DISPLAY_FIELD
    ? escaped.slice(0, MAX_DISPLAY_FIELD) + '…'
    : escaped;
}

function renderFacts(facts: StateMachineCandidate['facts']): string {
  return Object.entries(facts).map(([name, value]) => {
    const summary = Array.isArray(value) ? value.slice(0, 4).join(', ') + (value.length > 4 ? ', …' : '') : String(value);
    return name + '=' + singleLine(summary);
  }).join(' | ');
}

export function formatText(result: ScanResult): string {
  if (result.candidates.length === 0) {
    return 'NO_CANDIDATES\n';
  }
  const lines: string[] = [
    `CANDIDATES: ${result.candidates.length}${result.truncated ? ` (truncated from ${result.total_candidates})` : ''} | scanned python=${result.scanned_by_language.python} ts_js=${result.scanned_by_language.ts_js} skipped=${result.skipped_files}`,
  ];
  let size = lines[0]!.length;
  for (const c of result.candidates) {
    const siteList = c.sites
      .slice(0, MAX_DISPLAY_SITES)
      .map(s => `${singleLine(s.file)}:${s.line}${s.function ? `(${singleLine(s.function)})` : ''}`)
      .join(', ');
    const more = c.sites.length > MAX_DISPLAY_SITES ? ` (+${c.sites.length - MAX_DISPLAY_SITES} more)` : '';
    const line = `- [${c.signal}] ${singleLine(c.subject)} | sites: ${siteList}${more} | ${renderFacts(c.facts)}`;
    size += line.length + 1;
    if (size > MAX_DISPLAY_CHARS) {
      lines.push('Text output capped. Use --format json for all emitted candidates.');
      break;
    }
    lines.push(line);
  }
  return `${lines.join('\n')}\n`;
}

export function main(argv: string[], overrides: Partial<CliIo> = {}): number {
  const io: CliIo = {
    cwd: process.cwd(),
    env: process.env,
    stdout: text => { process.stdout.write(text); },
    stderr: text => { process.stderr.write(text); },
    ...overrides,
  };

  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    io.stderr(`full-review-state-machines: ${(err as Error).message}\n`);
    return 2;
  }

  if (parsed.help) {
    io.stdout(help());
    return 0;
  }

  const targetDir = resolve(io.cwd, parsed.dir ?? '.');
  try {
    if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
      io.stderr(`full-review-state-machines: target directory does not exist or is not a directory: ${targetDir}\n`);
      return 1;
    }
    const result = scanDirectory(targetDir, parsed.limits, io.env);
    if (parsed.format === 'json') {
      io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      io.stdout(formatText(result));
    }
    return 0;
  } catch (err) {
    io.stderr(`full-review-state-machines: ${(err as Error).message}\n`);
    return 1;
  }
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
