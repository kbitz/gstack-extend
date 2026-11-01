/**
 * upstream-check: a read-only, advisory check of the installed upstream
 * gstack against the literal contracts this extension copied. It prints
 * `OK`/`DRIFT` lines and exits with a documented status; it never pins, holds,
 * upgrades, dispatches a model, uses the network or writes a file.
 * Contract and recovery: docs/upstream-check.md.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { accessSync, closeSync, constants, existsSync, fstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Phase } from '../autoplan-lean/plan.ts';
import type { ClassifierResult, ExportResult, GoldenCase, ProbeResult } from './probe.ts';

export const FORMAT = 'upstream-check/v1';
export const EXIT = { ok: 0, internal: 1, usage: 2, drift: 4, bun: 5 } as const;

/** Upstream revision at which this Track qualified the wrapper anchors and the classifier table. */
export const ANCHORS_QUALIFIED = { revision: 'e2fffee3114e90ce2a7d165f09d3efce3555e252', version: '1.91.208.0' } as const;

/** Upstream revision at which the Fix-First anchors behind `repair-review=behavior-changing` were qualified. */
export const FIX_FIRST_QUALIFIED = { revision: '959c8a6a4fdafabf1186e407b76082b7f07e9f24', version: '1.91.327.0' } as const;

/** Upstream revision at which the anchors behind `test-gaps=record` were qualified in both layouts. */
export const TEST_GAP_QUALIFIED = { revision: '41a67b996d8bbf2167996683953dd2d7cd387d64', version: '1.91.367.0' } as const;

/** Upstream revision at which the anchors behind the narrowed pregate (`full-suite=external`) were qualified in both layouts. */
export const PREGATE_NARROW_QUALIFIED = { revision: '41a67b996d8bbf2167996683953dd2d7cd387d64', version: '1.91.367.0' } as const;

/**
 * Gate idioms and upstream-root imports that are deliberately not in the
 * runtime inventory. `includes` is matched against the hit's line text, so an
 * exemption survives a line move but not a reworded gate.
 */
export const EXEMPTIONS: readonly { file: string; includes: string; reason: string }[] = [
  { file: 'src/secret-dispositions/cli.ts', includes: "join(root, 'lib'",
    reason: 'fails closed at call time with "incompatible installed pregate helpers"; outside the launch contracts in docs/upstream-check.md' },
  { file: 'skills/review-and-prep.md', includes: "grep -F 'final-gate-repair=tests-docs'",
    reason: 'the caller-side capability check greps this skill\'s own loaded copy for its policy key, not installed upstream text' },
  { file: 'skills/review-and-prep.md', includes: "grep -F 'full-suite=external'",
    reason: 'the caller-side capability check greps this skill\'s own loaded copy for its policy value, not installed upstream text' },
  { file: 'skills/review-and-prep.md', includes: "grep -F 'parent-io=lean'",
    reason: 'the caller-side capability check greps this skill\'s own loaded copy for its policy value, not installed upstream text' },
  { file: 'skills/review-and-prep.md', includes: "grep -F 'repair-review=behavior-changing'",
    reason: 'the caller-side capability check greps this skill\'s own loaded copy for its policy value, not installed upstream text' },
  { file: 'skills/review-and-prep.md', includes: "grep -F 'repair-cycles=light'",
    reason: 'the caller-side capability check greps this skill\'s own loaded copy for its policy value, not installed upstream text' },
  { file: 'skills/review-and-prep.md', includes: "grep -F 'test-gaps=record'",
    reason: 'the caller-side capability check greps this skill\'s own loaded copy for its policy value, not installed upstream text' },
  { file: 'skills/review-and-prep.md', includes: "grep -F 'Narrow the pregate",
    reason: 'the caller-side capability check greps this skill\'s own loaded copy for its section heading, not installed upstream text' },
  { file: 'skills/roadmap.md', includes: 'copied byte for byte',
    reason: 'quotes the audit\'s own shell operands, not installed upstream text' },
];

const MAX_BYTES = 4 * 1024 * 1024;
const OUTPUT_LIMIT = 1024 * 1024;
const VERSION_PATTERN = /^\d+(\.\d+){2,3}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const DOCS = 'docs/upstream-check.md';
const IN_CAP_HEADING = "**`/review`'s own repeat cycles (`in-cap=delta`).**";
const ANCHOR_LIST_FROM = 'byte for byte,';
const ANCHOR_LIST_TO = 'Check each with `grep -F`';
const FIX_FIRST_HEADING = '**Activation (`repair-review=behavior-changing`).**';
const FIX_FIRST_FILE_MARK = 'its `review/checklist.md` still contains,';
const FIX_FIRST_TO = 'and the `in-cap=delta` paragraph';
const TEST_GAP_HEADING = '**Activation (`test-gaps=record`).**';
const TEST_GAP_TESTING_MARK = 'its `review/specialists/testing.md` still contains,';
const TEST_GAP_CHECKLIST_MARK = 'its `review/checklist.md` still contains,';
const TEST_GAP_COVERAGE_MARK = 'and the `ship/sections/test-coverage.md` that the coverage audit reads still contains,';
const PREGATE_NARROW_HEADING = '**Activation (narrowed pregate).**';
const PREGATE_NARROW_INDEX_MARK = 'its `lib/pregate/index.ts` still contains,';
const PREGATE_NARROW_LANES_MARK = 'and its `lib/pregate/checks/lanes.ts` still contains,';

export interface CliIo { stdout(text: string): void; stderr(text: string): void; cwd: string }

type Kind = 'root' | 'inventory' | 'anchor' | 'export' | 'classifier' | 'criteria';
interface Check { kind: Kind; id: string; ok: boolean; reason: string; effect?: string; fix?: string }

class UsageError extends Error {
  constructor(message: string, readonly fix: string) { super(message); }
}

const oneLine = (text: string, max = 600) => {
  const flat = text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

export const extendRoot = () => resolve(import.meta.dir, '..', '..');

type Read = { ok: true; bytes: Buffer; real: string } | { ok: false; reason: string };

/** Inspect and read the same descriptor, bounded even if an upgrade replaces or grows the file. */
export function readTrusted(path: string, what: string): Read {
  let real: string;
  try { real = realpathSync(path); } catch { return { ok: false, reason: `${what} not found: ${path}` }; }
  let fd: number | undefined;
  try {
    fd = openSync(real, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { ok: false, reason: `${what} is not a regular file: ${real}` };
    if (stat.size > MAX_BYTES) return { ok: false, reason: `${what} is larger than 4 MiB: ${real}` };
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= MAX_BYTES) {
      const chunk = Buffer.allocUnsafe(Math.min(65536, MAX_BYTES + 1 - total));
      const size = readSync(fd, chunk, 0, chunk.length, null);
      if (!size) return { ok: true, bytes: Buffer.concat(chunks, total), real };
      chunks.push(chunk.subarray(0, size));
      total += size;
    }
    return { ok: false, reason: `${what} is larger than 4 MiB: ${real}` };
  } catch { return { ok: false, reason: `${what} unreadable: ${real}` }; }
  finally { if (fd !== undefined) closeSync(fd); }
}

const versionOf = (root: string, onRead?: (real: string) => void) => {
  const read = readTrusted(join(root, 'VERSION'), 'VERSION');
  if (!read.ok) return 'unknown';
  onRead?.(read.real);
  const value = read.bytes.toString('utf8').replace(/\r?\n$/, '');
  return VERSION_PATTERN.test(value) ? value : 'unknown';
};

export type Inventory = { ok: true; file: string; anchors: string[] } | { ok: false; file: string; reason: string };
export type FixFirstInventory = { ok: true; file: string; review: string[]; checklist: string[] } | { ok: false; file: string; reason: string };
export type TestGapInventory = { ok: true; file: string; review: string[]; testing: string[]; checklist: string[]; coverage: string[] } | { ok: false; file: string; reason: string };
export type PregateNarrowInventory = { ok: true; file: string; bin: string[]; index: string[]; lanes: string[] } | { ok: false; file: string; reason: string };

/** The backtick spans of one anchor list, or why the list is malformed. */
function spansIn(region: string, list: string): { ok: true; spans: string[] } | { ok: false; reason: string } {
  const spans = [...region.matchAll(/`([^`]*)`/g)].map((m) => m[1]!);
  if (!spans.length) return { ok: false, reason: `${list} has no backtick spans` };
  if (region.replace(/`[^`]*`/g, '').includes('`')) return { ok: false, reason: `${list} has an unbalanced backtick` };
  if (spans.some((s) => !s.length || /[\r\n]/.test(s))) return { ok: false, reason: `${list} has an empty span or a span containing a newline` };
  return { ok: true, spans };
}

/**
 * The `/review` anchors `/review-and-prep` gates on: the backtick spans between
 * "byte for byte," and "Check each with `grep -F`" in its in-cap paragraph.
 */
export function inventory(extendRootPath: string): Inventory {
  const file = join(extendRootPath, 'skills', 'review-and-prep.md');
  const read = readTrusted(file, 'inventory source');
  if (!read.ok) return { ok: false, file, reason: read.reason };
  const text = read.bytes.toString('utf8');
  const start = text.indexOf(IN_CAP_HEADING);
  if (start < 0) return { ok: false, file, reason: 'in-cap paragraph not found' };
  const blank = text.indexOf('\n\n', start);
  const paragraph = text.slice(start, blank < 0 ? undefined : blank);
  const from = paragraph.indexOf(ANCHOR_LIST_FROM);
  const to = from < 0 ? -1 : paragraph.indexOf(ANCHOR_LIST_TO, from);
  if (from < 0 || to < 0) return { ok: false, file, reason: 'anchor list delimiters not found in the in-cap paragraph' };
  const list = spansIn(paragraph.slice(from + ANCHOR_LIST_FROM.length, to), 'anchor list');
  if (!list.ok) return { ok: false, file, reason: list.reason };
  return { ok: true, file: read.real, anchors: list.spans };
}

/**
 * The Fix-First anchors behind `repair-review=behavior-changing`: the backtick
 * spans of its activation paragraph, first the `/review` text and then the
 * `review/checklist.md` text, each list opened by "byte for byte,".
 */
export function fixFirstInventory(extendRootPath: string): FixFirstInventory {
  const file = join(extendRootPath, 'skills', 'review-and-prep.md');
  const read = readTrusted(file, 'inventory source');
  if (!read.ok) return { ok: false, file, reason: read.reason };
  const text = read.bytes.toString('utf8');
  const start = text.indexOf(FIX_FIRST_HEADING);
  if (start < 0) return { ok: false, file, reason: 'activation paragraph not found' };
  const blank = text.indexOf('\n\n', start);
  const paragraph = text.slice(start, blank < 0 ? undefined : blank);
  const first = paragraph.indexOf(ANCHOR_LIST_FROM);
  const mark = first < 0 ? -1 : paragraph.indexOf(FIX_FIRST_FILE_MARK, first);
  const second = mark < 0 ? -1 : paragraph.indexOf(ANCHOR_LIST_FROM, mark);
  const end = second < 0 ? -1 : paragraph.indexOf(FIX_FIRST_TO, second);
  if (end < 0) return { ok: false, file, reason: 'anchor list delimiters not found in the activation paragraph' };
  const review = spansIn(paragraph.slice(first + ANCHOR_LIST_FROM.length, mark), 'review anchor list');
  if (!review.ok) return { ok: false, file, reason: review.reason };
  const checklist = spansIn(paragraph.slice(second + ANCHOR_LIST_FROM.length, end), 'checklist anchor list');
  if (!checklist.ok) return { ok: false, file, reason: checklist.reason };
  return { ok: true, file: read.real, review: review.spans, checklist: checklist.spans };
}

/**
 * The anchor lists of one activation paragraph. List `i` opens at the first
 * "byte for byte," after the previous mark and ends at `marks[i]`; the last mark
 * closes the final list. Each list is the backtick spans between those points.
 */
function activationLists(extendRootPath: string, heading: string, marks: readonly string[], names: readonly string[]):
  { ok: true; file: string; lists: string[][] } | { ok: false; file: string; reason: string } {
  const file = join(extendRootPath, 'skills', 'review-and-prep.md');
  const read = readTrusted(file, 'inventory source');
  if (!read.ok) return { ok: false, file, reason: read.reason };
  const text = read.bytes.toString('utf8');
  const start = text.indexOf(heading);
  if (start < 0) return { ok: false, file, reason: 'activation paragraph not found' };
  const blank = text.indexOf('\n\n', start);
  const paragraph = text.slice(start, blank < 0 ? undefined : blank);
  const opens: number[] = [];
  const ends: number[] = [];
  let at = -1;
  for (const mark of marks) {
    const open = paragraph.indexOf(ANCHOR_LIST_FROM, at + 1);
    at = open < 0 ? -1 : paragraph.indexOf(mark, open);
    if (at < 0) return { ok: false, file, reason: 'anchor list delimiters not found in the activation paragraph' };
    opens.push(open + ANCHOR_LIST_FROM.length);
    ends.push(at);
  }
  const lists: string[][] = [];
  for (const [i, name] of names.entries()) {
    const list = spansIn(paragraph.slice(opens[i]!, ends[i]), `${name} anchor list`);
    if (!list.ok) return { ok: false, file, reason: list.reason };
    lists.push(list.spans);
  }
  return { ok: true, file: read.real, lists };
}

/**
 * The anchors behind `test-gaps=record`: the backtick spans of its activation
 * paragraph, four lists (`/review`, the testing specialist, `review/checklist.md`
 * and the coverage audit section), each opened by "byte for byte,".
 */
export function testGapInventory(extendRootPath: string): TestGapInventory {
  const found = activationLists(extendRootPath, TEST_GAP_HEADING,
    [TEST_GAP_TESTING_MARK, TEST_GAP_CHECKLIST_MARK, TEST_GAP_COVERAGE_MARK, ANCHOR_LIST_TO], ['review', 'testing', 'checklist', 'coverage']);
  if (!found.ok) return found;
  const [review, testing, checklist, coverage] = found.lists as [string[], string[], string[], string[]];
  return { ok: true, file: found.file, review, testing, checklist, coverage };
}

/**
 * The anchors behind the narrowed pregate: the backtick spans of its activation
 * paragraph, three lists (`bin/gstack-pregate`, `lib/pregate/index.ts` and
 * `lib/pregate/checks/lanes.ts`), each opened by "byte for byte,".
 */
export function pregateNarrowInventory(extendRootPath: string): PregateNarrowInventory {
  const found = activationLists(extendRootPath, PREGATE_NARROW_HEADING,
    [PREGATE_NARROW_INDEX_MARK, PREGATE_NARROW_LANES_MARK, ANCHOR_LIST_TO], ['bin', 'index', 'lanes']);
  if (!found.ok) return found;
  const [bin, index, lanes] = found.lists as [string[], string[], string[]];
  return { ok: true, file: found.file, bin, index, lanes };
}

const STAGE = {
  review: '/review-and-prep: the in-cap delta is inactive and /review runs unmodified',
  fixFirst: '/review-and-prep: repair-review=behavior-changing is inactive, so every edited pass repeats as today and the receipt says so',
  fixFirstList: '/review-and-prep: the Fix-First anchors cannot be listed, so repair-review=behavior-changing is unverified and stays inactive',
  testGap: '/review-and-prep: test-gaps=record is inactive, so the review writes tests as today and the receipt says so',
  testGapList: '/review-and-prep: the test-gap anchors cannot be listed, so test-gaps=record is unverified and stays inactive',
  pregateNarrow: '/review-and-prep: a pass under full-suite=external does not narrow the pregate, so the pregate runs as today and the receipt says so',
  pregateNarrowList: '/review-and-prep: the pregate-narrowing anchors cannot be listed, so narrowing is unverified and the pregate runs as today',
  outline: '/autoplan-lean: outline marks no row skip, so /autoplan-lean applies upstream\'s skip list by heading itself and reads more',
  outside: '/review-and-prep: outside coverage is unavailable because bin/outside-review refuses before any dispatch',
  classifier: 'bin/outside-review: a reviewer\'s outside verdict may be credited differently than the golden table expects',
  notReady: 'bin/outside-review: a reviewer\'s own not-ready verdict with only advisory findings is credited clean, so the stage may proceed past it',
};
const UPGRADE_FIX = 'run /gstack-extend-upgrade and rerun; if it still drifts the extension is not qualified for this upstream, so proceed knowing the stated cost or hold the stage (your decision)';

function describe(check: Check): { effect: string; fix: string } {
  const docs = `${DOCS}#drift-${check.kind}`;
  const withDocs = (fix: string) => `${fix}; see ${docs}`;
  if (check.effect && check.fix) return { effect: check.effect, fix: withDocs(check.fix) };
  switch (check.kind) {
    case 'root':
      return { effect: 'no installed upstream can be checked, so every later check is not run', fix: withDocs('pass --gstack-root (and --skills-dir if needed) for the host being launched') };
    case 'inventory':
      return { effect: 'the anchors /review-and-prep gates on cannot be listed, so its in-cap gate is unverified', fix: withDocs('this extension\'s own files are damaged or edited: re-run its setup or reinstall, then rerun') };
    case 'anchor':
      return { effect: check.id.startsWith('autoplan-lean') ? STAGE.outline : STAGE.review, fix: withDocs(UPGRADE_FIX) };
    case 'export':
      return { effect: STAGE.outside, fix: withDocs(UPGRADE_FIX) };
    case 'classifier':
      return { effect: STAGE.classifier, fix: withDocs(UPGRADE_FIX) };
    case 'criteria':
      return { effect: `/autoplan-lean: the ${check.id.split('.').slice(1).join(' ')} voice is not upstream-identical for this run`, fix: withDocs(UPGRADE_FIX) };
  }
}

interface Layout {
  name: 'nested' | 'sibling';
  review: string;
  checklist: string;
  testing: string;
  coverage: string;
  pregateBin: string;
  pregateIndex: string;
  pregateLanes: string;
  autoplan: string;
  snapshot: string;
  section(phase: Phase): string;
}

function chooseLayout(root: string, skillsDir: string): Layout {
  const snapshot = join(root, 'bin', 'gstack-autoplan-snapshot.ts');
  // The pregate lives under the gstack root in both layouts.
  const pregate = { pregateBin: join(root, 'bin', 'gstack-pregate'), pregateIndex: join(root, 'lib', 'pregate', 'index.ts'), pregateLanes: join(root, 'lib', 'pregate', 'checks', 'lanes.ts') };
  if (existsSync(join(root, 'review', 'SKILL.md'))) {
    const autoplan = join(root, 'autoplan', 'SKILL.md');
    const sections = existsSync(join(root, 'autoplan', 'sections'));
    return { name: 'nested', review: join(root, 'review', 'SKILL.md'), checklist: join(root, 'review', 'checklist.md'),
      testing: join(root, 'review', 'specialists', 'testing.md'), coverage: join(root, 'ship', 'sections', 'test-coverage.md'), ...pregate, autoplan, snapshot,
      section: (phase) => (sections ? join(root, 'autoplan', 'sections', `${phase}-phase.md`) : autoplan) };
  }
  const autoplan = join(skillsDir, 'gstack-autoplan', 'SKILL.md');
  return { name: 'sibling', review: join(skillsDir, 'gstack-review', 'SKILL.md'), checklist: join(root, 'review', 'checklist.md'),
    testing: join(root, 'review', 'specialists', 'testing.md'), coverage: join(skillsDir, 'gstack-ship', 'sections', 'test-coverage.md'), ...pregate, autoplan, snapshot, section: () => autoplan };
}

interface Options { root: string; skillsDir: string; timeoutMs: number }

function parseArgs(argv: string[]): 'help' | 'version' | Options {
  const known = ['--gstack-root', '--skills-dir', '--timeout-ms'];
  const seen = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (flag === '--help' || flag === '-h') return 'help';
    if (flag === '--version') return 'version';
    if (!known.includes(flag)) throw new UsageError(`unknown argument ${oneLine(flag, 80)}`, `use only ${known.join(', ')}, --help or --version`);
    if (seen.has(flag)) throw new UsageError(`duplicate ${flag}`, `pass ${flag} once`);
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} needs a value`, `pass ${flag} <value>`);
    seen.set(flag, value);
  }
  for (const [flag, value] of seen) {
    if (CONTROL.test(value)) throw new UsageError(`${flag} contains a control character`, `pass a plain path for ${flag}`);
  }
  const root = seen.get('--gstack-root');
  if (root === undefined) throw new UsageError('--gstack-root is required', 'pass --gstack-root <absolute path of the installed gstack root for the host you are launching>');
  for (const flag of ['--gstack-root', '--skills-dir']) {
    const value = seen.get(flag);
    if (value !== undefined && !isAbsolute(value)) throw new UsageError(`${flag} must be an absolute path`, `pass an absolute path for ${flag}`);
  }
  let timeoutMs = 5000;
  const timeout = seen.get('--timeout-ms');
  if (timeout !== undefined) {
    if (!/^\d+$/.test(timeout) || Number(timeout) < 100 || Number(timeout) > 120000) {
      throw new UsageError(`--timeout-ms must be an integer from 100 to 120000, got ${oneLine(timeout, 40)}`, 'pass --timeout-ms 5000');
    }
    timeoutMs = Number(timeout);
  }
  const resolved = resolve(root);
  return { root: resolved, skillsDir: seen.has('--skills-dir') ? resolve(seen.get('--skills-dir')!) : dirname(resolved), timeoutMs };
}

const gitQuery = (cwd: string, args: string[]) => {
  // Discover the filesystem checkout, never an inherited hook/wrapper selection.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
  return spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 5000, env: { ...env, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0', GIT_DISCOVERY_ACROSS_FILESYSTEM: '1' } });
};
const gitOut = (cwd: string, args: string[]) => {
  const result = gitQuery(cwd, args);
  return result.status === 0 ? result.stdout.trim() : undefined;
};

function rejectRootInsideRepo(root: string, cwd: string, flag = '--gstack-root') {
  const result = gitQuery(cwd, ['rev-parse', '--show-toplevel']);
  if (result.status !== 0) {
    if (result.status === 128 && /^fatal: not a git repository(?: \(or any of the parent directories\))?: \.git\s*$/.test(result.stderr)) return;
    throw new Error('cannot establish the current repository boundary: Git discovery failed');
  }
  const repo = realpathSync(result.stdout.trim());
  let real: string;
  try { real = realpathSync(root); } catch { return; } // Missing roots are reported as drift and never imported.
  const rel = relative(repo, real);
  if (!rel || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) {
    throw new UsageError(`${flag} is inside the current git repository`, 'pass installed upstream paths, not paths under the repository under review');
  }
}

type Helpers = readonly { module: string; name: string }[];
type ProbeOutcome = { ok: true; result: ProbeResult } | { ok: false; cause: string; last?: string; internal?: boolean };

/** One child Bun process, a hard deadline, bounded output, settled on exit. */
function runProbe(root: string, timeoutMs: number, helpers: Helpers, goldens: readonly GoldenCase[]): Promise<ProbeOutcome> {
  const nonce = randomBytes(12).toString('hex');
  const probePath = join(import.meta.dir, 'probe.ts');
  return new Promise((settle) => {
    let child;
    try {
      child = spawn(process.execPath, ['--no-env-file', '--no-install', '--config=/dev/null', probePath, nonce, root, JSON.stringify(helpers)],
        { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      settle({ ok: false, cause: 'probe could not start', internal: true });
      return;
    }
    let out = '', total = 0, timedOut = false, overflow = false, finished = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const finish = (code: number | null, signal: string | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      clearTimeout(grace);
      child.stdout!.destroy();
      child.stderr!.destroy();
      settle(evaluate(out, nonce, { code, signal, timedOut, overflow, timeoutMs }, helpers, goldens));
    };
    const deadline = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    const take = (retain: boolean) => (chunk: string) => {
      total += Buffer.byteLength(chunk);
      if (total > OUTPUT_LIMIT) { overflow = true; child.kill('SIGKILL'); return; }
      if (retain) out += chunk;
    };
    child.stdout!.setEncoding('utf8').on('data', take(true));
    child.stderr!.setEncoding('utf8').on('data', take(false));
    child.on('error', () => finish(null, 'spawn-error'));
    // Settle on exit; allow a short grace for pipe data already in flight.
    child.on('close', (code, signal) => finish(code, signal));
    child.on('exit', (code, signal) => {
      clearTimeout(deadline);
      grace = setTimeout(() => finish(code, signal), 250);
    });
  });
}

function evaluate(out: string, nonce: string, state: { code: number | null; signal: string | null; timedOut: boolean; overflow: boolean; timeoutMs: number }, helpers: Helpers, goldens: readonly GoldenCase[]): ProbeOutcome {
  let last: string | undefined;
  let frame: string | undefined;
  let internal = false;
  for (const line of out.split('\n')) {
    if (line.startsWith(`${nonce} begin `)) last = line.slice(nonce.length + 7).trim();
    else if (line.startsWith(`${nonce} result `)) frame = line.slice(nonce.length + 8);
    else if (line === `${nonce} internal`) internal = true;
  }
  const fail = (cause: string): ProbeOutcome => ({ ok: false, cause, last });
  if (state.overflow) return fail('probe output exceeded 1 MiB');
  if (state.timedOut) return fail(`probe timed out after ${state.timeoutMs} ms`);
  if (internal || state.signal === 'spawn-error' || (last === undefined && state.code !== 0 && frame === undefined)) {
    return { ok: false, cause: 'extension probe failed before producing a result', internal: true };
  }
  if (frame === undefined) return fail(`probe exited ${state.code ?? state.signal ?? 'unknown'} without a result`);
  const parsed = validateResult(frame, helpers, goldens);
  return parsed ? { ok: true, result: parsed } : fail('probe result malformed');
}

function validateResult(frame: string, helpers: Helpers, goldens: readonly GoldenCase[]): ProbeResult | undefined {
  let value: any;
  try { value = JSON.parse(frame); } catch { return undefined; }
  const isText = (v: unknown): v is string => typeof v === 'string' && v.length < 500;
  if (!value || !Array.isArray(value.exports) || !Array.isArray(value.classifier)) return undefined;
  if (value.exports.length !== helpers.length || value.classifier.length !== goldens.length) return undefined;
  for (const [i, e] of (value.exports as ExportResult[]).entries()) {
    if (!e || e.name !== helpers[i]!.name || !isText(e.module) || !isText(e.reason) || (e.status !== 'ok' && e.status !== 'drift')) return undefined;
  }
  for (const [i, c] of (value.classifier as ClassifierResult[]).entries()) {
    if (!c || c.id !== goldens[i]!.id || !isText(c.verdict) || typeof c.credited !== 'boolean' || (c.error !== undefined && !isText(c.error))) return undefined;
  }
  return value as ProbeResult;
}

const credit = (verdict: string, credited: boolean) => `${verdict}/${credited ? 'credited' : 'uncredited'}`;

export async function run(argv: string[], io: CliIo): Promise<number> {
  const options = parseArgs(argv);
  if (options === 'help') { io.stdout(help()); return EXIT.ok; }
  if (options === 'version') { io.stdout(`upstream-check ${versionOf(extendRoot())}\n`); return EXIT.ok; }
  rejectRootInsideRepo(options.root, io.cwd);
  const layout = chooseLayout(options.root, options.skillsDir);
  if (layout.name === 'sibling') rejectRootInsideRepo(options.skillsDir, io.cwd, '--skills-dir');
  // Keep extension-owned loader failures inside main's internal-error boundary.
  const [{ driftReport, UPSTREAM }, { skipList }, { PHASES }, { INSPECTED_UPSTREAM, UPSTREAM_HELPERS }, { GOLDEN_CASES }] = await Promise.all([
    import('../autoplan-lean/criteria.ts'), import('../autoplan-lean/outline.ts'), import('../autoplan-lean/plan.ts'),
    import('../outside-review/cli.ts'), import('./probe.ts'),
  ]);

  const infos: string[] = [];
  const info = (key: string, value: string) => infos.push(`INFO ${key} ${oneLine(value, 400)}`);
  const checks: Check[] = [];
  const add = (check: Check) => checks.push(check);
  const ok = (kind: Kind, id: string) => add({ kind, id, ok: true, reason: '' });
  const drift = (kind: Kind, id: string, reason: string, extra: Partial<Check> = {}) => add({ kind, id, ok: false, reason: oneLine(reason), ...extra });

  const extend = extendRoot();
  info('extend-version', versionOf(extend, (real) => info('file', `extend-version ${real}`)));
  info('extend-root', extend);
  info('inspected', `anchors ${ANCHORS_QUALIFIED.revision} ${ANCHORS_QUALIFIED.version}`);
  info('inspected', `fix-first ${FIX_FIRST_QUALIFIED.revision} ${FIX_FIRST_QUALIFIED.version}`);
  info('inspected', `test-gaps ${TEST_GAP_QUALIFIED.revision} ${TEST_GAP_QUALIFIED.version}`);
  info('inspected', `pregate-narrowing ${PREGATE_NARROW_QUALIFIED.revision} ${PREGATE_NARROW_QUALIFIED.version}`);
  info('inspected', `criteria ${UPSTREAM.commit} ${UPSTREAM.version}`);
  info('inspected', `outside-review ${INSPECTED_UPSTREAM.revision} ${INSPECTED_UPSTREAM.version}`);
  info('scope', 'OK means only that the listed anchors, exports, classifier cases and known criteria paragraphs matched; newly added upstream requirements, changed surrounding instructions and other classifier behavior are not checked');

  // Root.
  let rootOk = false;
  try {
    rootOk = statSync(realpathSync(options.root)).isDirectory();
    accessSync(options.root, constants.X_OK);
  } catch { rootOk = false; }
  info('root', options.root);
  const notRun = rootOk ? undefined : 'not run: gstack root unavailable';
  if (rootOk) {
    ok('root', 'gstack-root');
    info('upstream-version', versionOf(options.root, (real) => info('file', `upstream-version ${real}`)));
    const real = realpathSync(options.root);
    const top = gitOut(options.root, ['rev-parse', '--show-toplevel']);
    let revision = 'unknown';
    try { if (top && realpathSync(top) === real) revision = gitOut(options.root, ['rev-parse', 'HEAD']) ?? 'unknown'; } catch { /* unknown */ }
    info('upstream-revision', /^[0-9a-f]{40}$/.test(revision) ? revision : 'unknown');
  } else {
    drift('root', 'gstack-root', `gstack root is missing, inaccessible or not a directory: ${options.root}`);
    info('upstream-version', 'unknown');
    info('upstream-revision', 'unknown');
  }

  // Inventory (this extension's own source).
  const inv = inventory(extend);
  if (inv.ok) { ok('inventory', 'review-and-prep.incap'); info('file', `inventory ${inv.file}`); }
  else drift('inventory', 'review-and-prep.incap', `${inv.reason} (${inv.file})`);
  const fixFirst = fixFirstInventory(extend);
  if (fixFirst.ok) ok('inventory', 'review-and-prep.fix-first');
  else drift('inventory', 'review-and-prep.fix-first', `${fixFirst.reason} (${fixFirst.file})`, { effect: STAGE.fixFirstList, fix: 'this extension\'s own files are damaged or edited: re-run its setup or reinstall, then rerun' });

  const testGaps = testGapInventory(extend);
  if (testGaps.ok) ok('inventory', 'review-and-prep.test-gaps');
  else drift('inventory', 'review-and-prep.test-gaps', `${testGaps.reason} (${testGaps.file})`, { effect: STAGE.testGapList, fix: 'this extension\'s own files are damaged or edited: re-run its setup or reinstall, then rerun' });

  const narrow = pregateNarrowInventory(extend);
  if (narrow.ok) ok('inventory', 'review-and-prep.pregate-narrowing');
  else drift('inventory', 'review-and-prep.pregate-narrowing', `${narrow.reason} (${narrow.file})`, { effect: STAGE.pregateNarrowList, fix: 'this extension\'s own files are damaged or edited: re-run its setup or reinstall, then rerun' });

  if (rootOk) info('layout', layout.name);
  const reads = new Map<string, Read>();
  const readOnce = (path: string, what: string, key: string) => {
    let read = reads.get(path);
    if (!read) {
      read = readTrusted(path, what);
      reads.set(path, read);
      if (read.ok) info('file', `${key} ${read.real}`);
    }
    return read;
  };
  const sibling = (path: string) => layout.name === 'sibling' ? `${path} (nested ${join(options.root, 'review', 'SKILL.md')} absent)` : path;

  // Anchors.
  const checkAnchor = (id: string, read: Read | undefined, anchor: string, reason: (cause: string) => string = (cause) => cause, extra: Partial<Check> = {}) => {
    if (!read) drift('anchor', id, notRun!, extra);
    else if (!read.ok) drift('anchor', id, reason(read.reason), extra);
    else if (read.bytes.includes(Buffer.from(anchor, 'utf8'))) ok('anchor', id);
    else drift('anchor', id, `anchor not found byte for byte in ${read.real}: "${oneLine(anchor, 70)}"`, extra);
  };
  const reviewRead = () => rootOk ? readOnce(layout.review, 'review skill', 'review') : undefined;
  if (inv.ok) {
    const review = reviewRead();
    inv.anchors.forEach((anchor, i) => checkAnchor(`review-and-prep.incap.${i + 1}`, review, anchor,
      (cause) => layout.name === 'sibling' && cause.includes('not found') ? sibling(cause) : cause));
  }
  if (fixFirst.ok) {
    const inactive = { effect: STAGE.fixFirst, fix: UPGRADE_FIX };
    const review = reviewRead();
    const checklist = rootOk ? readOnce(layout.checklist, 'review checklist', 'checklist') : undefined;
    fixFirst.review.forEach((anchor, i) => checkAnchor(`review-and-prep.fix-first.review.${i + 1}`, review, anchor,
      (cause) => layout.name === 'sibling' && cause.includes('not found') ? sibling(cause) : cause, inactive));
    fixFirst.checklist.forEach((anchor, i) => checkAnchor(`review-and-prep.fix-first.checklist.${i + 1}`, checklist, anchor, undefined, inactive));
  }
  if (testGaps.ok) {
    const inactive = { effect: STAGE.testGap, fix: UPGRADE_FIX };
    const review = reviewRead();
    const testing = rootOk ? readOnce(layout.testing, 'review testing specialist', 'testing') : undefined;
    const checklist = rootOk ? readOnce(layout.checklist, 'review checklist', 'checklist') : undefined;
    const coverage = rootOk ? readOnce(layout.coverage, 'coverage audit section', 'coverage') : undefined;
    testGaps.review.forEach((anchor, i) => checkAnchor(`review-and-prep.test-gaps.review.${i + 1}`, review, anchor,
      (cause) => layout.name === 'sibling' && cause.includes('not found') ? sibling(cause) : cause, inactive));
    testGaps.testing.forEach((anchor, i) => checkAnchor(`review-and-prep.test-gaps.testing.${i + 1}`, testing, anchor, undefined, inactive));
    testGaps.checklist.forEach((anchor, i) => checkAnchor(`review-and-prep.test-gaps.checklist.${i + 1}`, checklist, anchor, undefined, inactive));
    testGaps.coverage.forEach((anchor, i) => checkAnchor(`review-and-prep.test-gaps.coverage.${i + 1}`, coverage, anchor, undefined, inactive));
  }
  if (narrow.ok) {
    const inactive = { effect: STAGE.pregateNarrow, fix: UPGRADE_FIX };
    const bin = rootOk ? readOnce(layout.pregateBin, 'pregate command', 'pregate.bin') : undefined;
    const index = rootOk ? readOnce(layout.pregateIndex, 'pregate check list', 'pregate.index') : undefined;
    const lanes = rootOk ? readOnce(layout.pregateLanes, 'pregate lanes check', 'pregate.lanes') : undefined;
    narrow.bin.forEach((anchor, i) => checkAnchor(`review-and-prep.pregate-narrowing.bin.${i + 1}`, bin, anchor, undefined, inactive));
    narrow.index.forEach((anchor, i) => checkAnchor(`review-and-prep.pregate-narrowing.index.${i + 1}`, index, anchor, undefined, inactive));
    narrow.lanes.forEach((anchor, i) => checkAnchor(`review-and-prep.pregate-narrowing.lanes.${i + 1}`, lanes, anchor, undefined, inactive));
  }
  const autoplan = rootOk ? readOnce(layout.autoplan, 'autoplan skill', 'autoplan') : undefined;
  if (!autoplan) drift('anchor', 'autoplan-lean.skip-list', notRun!);
  else if (!autoplan.ok) drift('anchor', 'autoplan-lean.skip-list', autoplan.reason);
  else if (skipList(autoplan.bytes.toString('utf8')).length) ok('anchor', 'autoplan-lean.skip-list');
  else drift('anchor', 'autoplan-lean.skip-list', `**Section skip list label or its bullets not found in ${autoplan.real}`);

  // Exports and classifier cases, in one bounded child process.
  if (rootOk) for (const { module } of UPSTREAM_HELPERS) {
    try { info('file', `module.${module} ${realpathSync(join(options.root, 'lib', `${module}.ts`))}`); } catch { /* The probe reports the missing module. */ }
  }
  const probe: ProbeOutcome | undefined = rootOk ? await runProbe(options.root, options.timeoutMs, UPSTREAM_HELPERS, GOLDEN_CASES) : undefined;
  if (probe && !probe.ok && probe.internal) throw new Error(probe.cause);
  for (const { module, name } of UPSTREAM_HELPERS) {
    const id = `outside-review.${name}`;
    const path = join(options.root, 'lib', `${module}.ts`);
    if (!probe) drift('export', id, notRun!);
    else if (!probe.ok) {
      const transient = /timed out/.test(probe.cause);
      const own = probe.last === path;
      drift('export', id, own ? `${probe.cause} while importing ${path}` : `not run: ${probe.cause}`,
        { effect: 'bin/outside-review: the export contract is unverified because the probe did not complete', fix: transient ? 'rerun with a larger --timeout-ms; a timeout may clear on rerun, content drift does not' : UPGRADE_FIX });
    } else {
      const result = probe.result.exports.find((e) => e.name === name)!;
      if (result.status === 'ok') ok('export', id);
      else drift('export', id, `${result.reason} in ${path}`);
    }
  }
  for (const golden of GOLDEN_CASES) {
    const id = `classifier.${golden.id}`;
    const expected = credit(golden.verdict, golden.credited);
    if (!probe) drift('classifier', id, notRun!);
    else if (!probe.ok) {
      const transient = /timed out/.test(probe.cause);
      drift('classifier', id, probe.last === 'classifier' ? `${probe.cause} while running the classifier cases` : `not run: ${probe.cause}`,
        { effect: 'bin/outside-review: the classifier contract is unverified because the probe did not complete', fix: transient ? 'rerun with a larger --timeout-ms; a timeout may clear on rerun, content drift does not' : UPGRADE_FIX });
    } else {
      const got = probe.result.classifier.find((c) => c.id === golden.id)!;
      if (got.error) drift('classifier', id, `expected=${expected} got=${got.error}`, { effect: 'bin/outside-review: the classifier contract is unverified because the classifier could not run', fix: UPGRADE_FIX });
      else if (got.verdict === golden.verdict && got.credited === golden.credited) ok('classifier', id);
      else drift('classifier', id, `expected=${expected} got=${credit(got.verdict, got.credited)}`,
        golden.verdict === 'findings' && got.verdict === 'clean' && got.credited ? { effect: STAGE.notReady, fix: UPGRADE_FIX } : {});
    }
  }

  // Criteria, through the same comparison code `autoplan-lean drift` uses.
  const failures = new Map<string, string>();
  const text = (read: Read | undefined, key: string) => {
    if (!read) return undefined;
    if (!read.ok) { failures.set(key, read.reason); return undefined; }
    return read.bytes.toString('utf8');
  };
  const snapshot = text(rootOk ? readOnce(layout.snapshot, 'snapshot tool', 'snapshot') : undefined, 'snapshot');
  const sections: Partial<Record<Phase, string>> = {};
  for (const phase of PHASES) {
    const section = text(rootOk ? readOnce(layout.section(phase), `${phase} phase section`, `section.${phase}`) : undefined, phase);
    if (section !== undefined) sections[phase] = section;
  }
  for (const item of driftReport(snapshot, sections, PHASES)) {
    const id = `criteria.${item.phase}.${item.voice}`;
    if (item.status === 'match') { ok('criteria', id); continue; }
    const cause = failures.get(item.voice === 'native' ? 'snapshot' : item.phase) ?? notRun;
    drift('criteria', id, `${item.status}${item.detail ? ` (${item.detail})` : ''}${cause ? `: ${cause}` : ''}`);
  }

  const bad = checks.filter((c) => !c.ok);
  const lines = [FORMAT, ...infos];
  for (const check of checks) {
    if (check.ok) { lines.push(`OK ${check.kind} ${check.id}`); continue; }
    const { effect, fix } = describe(check);
    lines.push(`DRIFT ${check.kind} ${check.id} ${check.reason}`, `  effect: ${effect}`, `  fix: ${fix}`);
  }
  lines.push(`RESULT ${bad.length ? 'drift' : 'ok'} checks=${checks.length} drift=${bad.length}`);
  io.stdout(`${lines.join('\n')}\n`);
  return bad.length ? EXIT.drift : EXIT.ok;
}

export function help() {
  return `upstream-check — read-only check of the installed gstack against this extension's copied contracts

Usage: upstream-check --gstack-root DIR [--skills-dir DIR] [--timeout-ms N]
       upstream-check --help | -h | --version

  --gstack-root DIR  absolute path of the installed gstack root the stage will use (required; never guessed)
  --skills-dir DIR   absolute path of the sibling skills directory (default: the parent of --gstack-root)
  --timeout-ms N     deadline for the child process that imports upstream modules (100-120000, default 5000)

Output (stdout; a report without a final RESULT line is incomplete, treat it as drift):
  ${FORMAT}
  INFO <key> <value to end of line>
  OK <kind> <id>
  DRIFT <kind> <id> <reason>, then "  effect:" and "  fix:" lines
  RESULT ok|drift checks=<n> drift=<m>
Kinds: root, inventory, anchor, export, classifier, criteria.

Exit: 0 every check OK; 4 any check drifted or an input is missing or malformed; 2 usage error;
      1 internal failure; 5 Bun missing. Errors go to stderr as "ERROR <CODE>: ..." and "FIX: ...".
No network, model dispatch, pin, hold, upgrade or file write. OK means only that the listed checks matched.
Docs: ${DOCS}
`;
}

export async function main(argv: string[], io: CliIo): Promise<number> {
  try {
    return await run(argv, io);
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`ERROR USAGE: ${oneLine(error.message)}\nFIX: ${error.fix}; see upstream-check --help\n`);
      return EXIT.usage;
    }
    const frames = String((error as Error)?.stack ?? '').split('\n').filter((l) => /^\s+at /.test(l)).slice(0, 5).map((l) => oneLine(l, 200));
    io.stderr([`ERROR INTERNAL: ${oneLine(String((error as Error)?.message ?? error), 300)}`, ...frames,
      `upstream-check ${versionOf(extendRoot())} bun ${process.versions.bun ?? 'unknown'}`,
      'FIX: rerun once; if it repeats, report this output'].join('\n') + '\n');
    return EXIT.internal;
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2), {
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
    cwd: process.cwd(),
  });
}
