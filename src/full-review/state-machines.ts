import { spawnSync } from 'node:child_process';
import { accessSync, constants, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, posix, relative, sep } from 'node:path';

export type SignalName =
  | 'string-state-fanout'
  | 'boolean-state-bag'
  | 'mutation-fanout'
  | 'write-decode-gap'
  | 'cross-file-inferred-state'
  | 'counter-thresholds'
  | 'cross-language-enum-drift';

export type SupportedLanguage = 'python' | 'ts_js';

export interface ScannerLimits {
  minStringCompareFunctions: number;
  minStringCompareFiles: number;
  minCoupledFields: number;
  minWriteFunctions: number;
  minStateFilesPerFunction: number;
  minThresholdBranches: number;
  minSharedVocabTokens: number;
  maxFileBytes: number;
  maxCandidates: number;
}

export const DEFAULT_LIMITS: ScannerLimits = {
  minStringCompareFunctions: 3,
  minStringCompareFiles: 2,
  minCoupledFields: 3,
  minWriteFunctions: 3,
  minStateFilesPerFunction: 3,
  minThresholdBranches: 2,
  minSharedVocabTokens: 3,
  maxFileBytes: 524_288,
  maxCandidates: 50,
};

export interface CandidateSite {
  file: string;
  line: number;
  function?: string;
  detail?: string;
}

export interface StateMachineCandidate {
  signal: SignalName;
  subject: string;
  languages: SupportedLanguage[];
  sites: CandidateSite[];
  facts: Record<string, unknown>;
}

export interface ScanResult {
  schema: 'full-review-state-machines/v1';
  root: string;
  discovery: 'git' | 'walk';
  scanned_by_language: {
    python: number;
    ts_js: number;
  };
  skipped_files: number;
  limits: ScannerLimits;
  total_candidates: number;
  truncated: boolean;
  candidates: StateMachineCandidate[];
}

export interface SourceFile {
  rel: string;
  language: SupportedLanguage;
  isTest: boolean;
  source: string;
}

const PY_EXTS = new Set(['.py']);
const TS_JS_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const WALK_SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '__pycache__', '.venv', 'venv']);
const MAX_WALK_ENTRIES = 100_000;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_STATE_LITERAL_LENGTH = 48;
const MIN_VOCAB_OVERLAP_RATIO = 0.5;
const MAX_VOCAB_PAIR_CHECKS = 250_000;
const MAX_TEMPLATE_NESTING = 128;
const MAX_FUNCTION_SPANS = 768;

const TEST_PATH_RE =
  /(?:^|\/)(?:test|tests|__tests__|spec)\/|(?:^|\/)test_[^/]*\.py$|_test\.py$|\.(?:test|spec)\.[^/]+$/i;
const TRANSITION_MODULE_RE = /transition|reducer|state[-_]?machine/i;
const STATE_FIELD_RE =
  /^(?:state|status|stage|phase|mode|outcome|kind|[a-z][a-z0-9_]*_(?:state|status)|[a-z][a-zA-Z0-9]*(?:State|Status))$/;
const COUPLED_FIELD_RE =
  /^(?:in_flight|inFlight|pending(?:_?[A-Za-z0-9_]*)|[a-z0-9_]+_pending|[a-z][a-zA-Z0-9]*Pending|awaiting(?:_?[A-Za-z0-9_]*)|[a-z0-9_]+_awaiting|[a-z][a-zA-Z0-9]*Awaiting|armed(?:_?[A-Za-z0-9_]*)|[a-z0-9_]+_armed|[a-z][a-zA-Z0-9]*Armed|settled(?:_?[A-Za-z0-9_]*)|[a-z0-9_]+_settled|[a-z][a-zA-Z0-9]*Settled|paused(?:_?[A-Za-z0-9_]*)|[a-z0-9_]+_paused|[a-z][a-zA-Z0-9]*Paused|active(?:_?[A-Za-z0-9_]*)|[a-z0-9_]+_active|[a-z][a-zA-Z0-9]*Active|ready(?:_?[A-Za-z0-9_]*)|[a-z0-9_]+_ready|[a-z][a-zA-Z0-9]*Ready|locked(?:_?[A-Za-z0-9_]*)|[a-z0-9_]+_locked|[a-z][a-zA-Z0-9]*Locked|closed(?:_?[A-Za-z0-9_]*)|[a-z0-9_]+_closed|[a-z][a-zA-Z0-9]*Closed|cancell?ed(?:_?[A-Za-z0-9_]*)|[a-z0-9_]+_cancell?ed|[a-z][a-zA-Z0-9]*Cancell?ed|[a-z0-9_]+_at|[a-z][a-zA-Z0-9]*At|hold(?:_?[A-Za-z0-9_]*)|[a-z0-9_]+_hold|[a-z][a-zA-Z0-9]*Hold|[a-z0-9_]+_error|[a-z][a-zA-Z0-9]*Error|is_[a-z0-9_]+|has_[a-z0-9_]+|is[A-Z][a-zA-Z0-9]*|has[A-Z][a-zA-Z0-9]*)$/;
const COUNTER_IDENT_RE =
  /^(?:failures|retries|attempts|occurrences|sends|errors|strikes|consecutive[A-Za-z0-9_]*|[a-z][a-z0-9_]*_count|[a-z][a-zA-Z0-9]*Count)$/;
const POLICY_TABLE_RE =
  /\b(?:POLICY_TABLE|THRESHOLD_TABLE|RETRY_POLICY|ESCALATION_POLICY|BACKOFF_POLICY|LIMIT_POLICY|policyTable|thresholdTable|retryPolicy|escalationPolicy)\b/;

export function cleanGitEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const configKeys = new Set(['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM']);
  return Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('GIT_') || configKeys.has(k)));
}

export function classifyLanguage(rel: string): SupportedLanguage | null {
  const ext = extname(rel).toLowerCase();
  if (PY_EXTS.has(ext)) return 'python';
  if (TS_JS_EXTS.has(ext)) return 'ts_js';
  return null;
}

export function isTestFile(rel: string): boolean {
  return TEST_PATH_RE.test(rel);
}

function listViaGit(targetRoot: string, env: NodeJS.ProcessEnv): string[] | null {
  const res = spawnSync('git', ['-C', targetRoot, '-c', 'core.fsmonitor=false', 'ls-files', '-co', '--exclude-standard', '-z'], {
    encoding: 'utf8',
    env: { ...cleanGitEnv(env), GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error && (res.error as NodeJS.ErrnoException).code !== 'ENOENT') throw res.error;
  if (res.error || /(?:^|\n)fatal: not a git repository\b/.test(res.stderr ?? '')) return null;
  if (res.status !== 0) throw new Error('could not list source files with Git');
  return (res.stdout ?? '').split('\0').filter(Boolean);
}

function listViaWalk(targetRoot: string): string[] {
  const out: string[] = [];
  const pending = [''];
  let visited = 0;
  while (pending.length > 0) {
    const relDir = pending.pop()!;
    let entries;
    try {
      entries = readdirSync(join(targetRoot, relDir), { withFileTypes: true });
    } catch (error) {
      if (!relDir) throw error;
      continue;
    }
    visited += entries.length;
    if (visited > MAX_WALK_ENTRIES) throw new Error('directory walk exceeds the scan limit');
    for (const entry of entries) {
      if (entry.isDirectory() && WALK_SKIP_DIRS.has(entry.name)) continue;
      const rel = posix.join(relDir, entry.name);
      if (entry.isDirectory()) pending.push(rel);
      else out.push(rel);
    }
  }
  return out;
}

export function discoverFiles(
  targetRoot: string,
  maxFileBytes: number = DEFAULT_LIMITS.maxFileBytes,
  env: NodeJS.ProcessEnv = process.env,
): {
  discovery: 'git' | 'walk';
  files: SourceFile[];
  scannedByLanguage: { python: number; ts_js: number };
  skippedFiles: number;
} {
  const realRoot = realpathSync(targetRoot);
  accessSync(realRoot, constants.R_OK | constants.X_OK);
  const gitPaths = listViaGit(realRoot, env);
  const discovery: 'git' | 'walk' = gitPaths !== null ? 'git' : 'walk';
  const rawPaths = [...new Set(gitPaths ?? listViaWalk(realRoot))].sort();

  const files: SourceFile[] = [];
  const scannedByLanguage = { python: 0, ts_js: 0 };
  let skippedFiles = 0;
  let sourceBytes = 0;

  for (const rel of rawPaths) {
    const lang = classifyLanguage(rel);
    if (!lang) {
      skippedFiles++;
      continue;
    }
    let source: string;
    let size: number;
    try {
      const real = realpathSync(join(realRoot, rel));
      const withinRoot = relative(realRoot, real);
      if (withinRoot === '..' || withinRoot.startsWith(`..${sep}`) || isAbsolute(withinRoot)) {
        skippedFiles++;
        continue;
      }
      // Scan the canonical source through its own inventory entry. An alias
      // cannot admit an ignored file, a Git metadata path or a duplicate site.
      if (withinRoot.split(sep).join('/') !== rel) {
        skippedFiles++;
        continue;
      }
      const st = statSync(real);
      if (!st.isFile() || st.size > maxFileBytes) {
        skippedFiles++;
        continue;
      }
      size = st.size;
      source = readFileSync(real, 'utf8');
    } catch {
      skippedFiles++;
      continue;
    }
    sourceBytes += size;
    if (sourceBytes > MAX_SOURCE_BYTES) throw new Error('source bytes exceed the scan limit');
    files.push({ rel, language: lang, isTest: isTestFile(rel), source });
    scannedByLanguage[lang]++;
  }

  return { discovery, files, scannedByLanguage, skippedFiles };
}

function blanks(text: string): string {
  return text.replace(/[^\r\n]/g, ' ');
}

// Distinguish division from regex literals in common expression positions.
function regexEnd(source: string, start: number): number {
  let inClass = false;
  for (let i = start + 1; i < source.length && source[i] !== '\n'; i++) {
    const char = source[i];
    if (char === '\\') i++;
    else if (char === '[') inClass = true;
    else if (char === ']') inClass = false;
    else if (char === '/' && !inClass) return i + 1;
  }
  return start;
}

function quotedEnd(source: string, start: number, close: string, multiline: boolean): number {
  let end = start + close.length;
  while (end < source.length && !source.startsWith(close, end)) {
    if (source[end] === '\\' && end + 1 < source.length) end += 2;
    else if (!multiline && source[end] === '\n') break;
    else end++;
  }
  return source.startsWith(close, end) ? end + close.length : end;
}

function templateEnd(source: string, start: number, nesting = 0): number {
  if (nesting >= MAX_TEMPLATE_NESTING) throw new Error('template nesting exceeds the scan limit');
  let braces = 0;
  for (let i = start + 1; i < source.length; i++) {
    const c = source[i]!;
    const next = source[i + 1];
    if (c === '\\') {
      i++;
    } else if (braces === 0) {
      if (c.charCodeAt(0) === 96) return i + 1;
      if (c === '$' && next === '{') {
        braces = 1;
        i++;
      }
    } else if (c === '"' || c === "'") {
      i = quotedEnd(source, i, c, false) - 1;
    } else if (c.charCodeAt(0) === 96) {
      i = templateEnd(source, i, nesting + 1) - 1;
    } else if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i + 2);
      if (end < 0) return source.length;
      i = end;
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) return source.length;
      i = end + 1;
    } else {
      if (c === '/') {
        let before = i - 1;
        while (before > start && /\s/.test(source[before]!)) before--;
        let wordStart = before;
        while (wordStart > start && /[\w$]/.test(source[wordStart - 1]!)) wordStart--;
        const canStartRegex = /[=(:,;!?&|+*{}[\-]/.test(source[before]!) ||
          /^(?:return|throw|case|yield)$/.test(source.slice(wordStart, before + 1));
        if (canStartRegex) {
          const end = regexEnd(source, i);
          if (end > i) i = end - 1;
        }
      }
      if (c === '{') braces++;
      if (c === '}') braces--;
    }
  }
  return source.length;
}

function lexSource(source: string, lang: SupportedLanguage): { text: string; structure: string } {
  const text: string[] = [];
  const structure: string[] = [];
  let i = 0;
  let regexAllowed = true;

  function readTo(end: number, kind: 'code' | 'string' | 'comment') {
    const part = source.slice(i, end);
    const masked = kind === 'code' ? part : blanks(part);
    text.push(kind === 'comment' ? masked : part);
    structure.push(masked);
    i = end;
  }

  while (i < source.length) {
    const c = source[i]!;
    const next = source[i + 1];
    if ((lang === 'python' && c === '#') || (lang === 'ts_js' && c === '/' && next === '/')) {
      const newline = source.indexOf('\n', i);
      readTo(newline < 0 ? source.length : newline, 'comment');
      continue;
    }
    if (lang === 'ts_js' && c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      readTo(end < 0 ? source.length : end + 2, 'comment');
      continue;
    }
    if (lang === 'ts_js' && c === '/' && regexAllowed) {
      const end = regexEnd(source, i);
      if (end !== i) {
        readTo(end, 'comment');
        regexAllowed = false;
        continue;
      }
    }
    if (c === '"' || c === "'" || (lang === 'ts_js' && c.charCodeAt(0) === 96)) {
      const triple = lang === 'python' && source.startsWith(c.repeat(3), i);
      const end = c.charCodeAt(0) === 96
        ? templateEnd(source, i)
        : quotedEnd(source, i, triple ? c.repeat(3) : c, triple);
      readTo(end, 'string');
      regexAllowed = false;
      continue;
    }
    if (lang === 'ts_js' && /[A-Za-z_$]/.test(c)) {
      let end = i + 1;
      while (end < source.length && /[\w$]/.test(source[end]!)) end++;
      regexAllowed = /^(?:return|throw|case|yield|typeof|void|delete|else)$/.test(source.slice(i, end));
      readTo(end, 'code');
      continue;
    }
    if (!/\s/.test(c)) regexAllowed = /[=(:,;!?&|+*{}[\-]/.test(c);
    readTo(i + 1, 'code');
  }
  return { text: text.join(''), structure: structure.join('') };
}

interface FunctionSpan {
  name: string;
  startLine: number;
  bodyOffset: number;
  endOffset: number;
  endLine: number;
}

function closingDelimiter(text: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close && --depth === 0) return i;
  }
  return -1;
}

function lineIndex(text: string): (offset: number) => number {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return offset => {
    let lo = 0;
    let hi = starts.length;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >>> 1;
      if (starts[mid]! <= offset) lo = mid;
      else hi = mid;
    }
    return lo + 1;
  };
}

function pythonHeaderColon(structure: string, offset: number): number {
  let depth = 0;
  for (let i = offset; i < structure.length; i++) {
    const c = structure[i];
    if (depth === 0 && c === ':') return i;
    if (depth === 0 && c === '\n') break;
    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') depth--;
  }
  return -1;
}

function pythonSpans(structure: string, lineAt: (offset: number) => number): FunctionSpan[] {
  const spans: FunctionSpan[] = [];
  const lines = structure.split('\n');
  const stack: Array<{ name: string; startLine: number; bodyOffset: number; indent: number }> = [];
  const finish = (endOffset: number, endLine: number) => {
    const { name, startLine, bodyOffset } = stack.pop()!;
    spans.push({ name, startLine, bodyOffset, endOffset, endLine });
  };
  let offset = 0;
  let signatureThrough = 0;
  let continuationDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const start = offset;
    offset += line.length + 1;
    if (!line.trim() || start < signatureThrough) continue;
    const indent = line.length - line.trimStart().length;
    if (continuationDepth === 0) {
      while (stack.length && indent <= stack[stack.length - 1]!.indent) finish(start, i);
      const m = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/.exec(line);
      if (m) {
        const close = closingDelimiter(structure, start + m[0].length - 1, '(', ')');
        const colon = close < 0 ? -1 : pythonHeaderColon(structure, close + 1);
        if (colon >= 0) {
          signatureThrough = colon + 1;
          if (stack.length + spans.length >= MAX_FUNCTION_SPANS) throw new Error('function spans exceed the scan limit');
          stack.push({ name: m[1]!, indent, startLine: lineAt(start), bodyOffset: signatureThrough });
          continue;
        }
      }
    }
    for (const c of line) {
      if (c === '(' || c === '[' || c === '{') continuationDepth++;
      else if (c === ')' || c === ']' || c === '}') continuationDepth = Math.max(0, continuationDepth - 1);
    }
  }
  while (stack.length) finish(structure.length, lines.length);
  return spans;
}

function skipWhitespace(text: string, start: number): number {
  while (start < text.length && /\s/.test(text[start]!)) start++;
  return start;
}

function tsBodyStart(structure: string, afterParameters: number, arrow: boolean): number {
  let start = skipWhitespace(structure, afterParameters);
  if (structure[start] !== ':') {
    if (arrow && structure.startsWith('=>', start)) start = skipWhitespace(structure, start + 2);
    else if (arrow) return -1;
    return structure[start] === '{' ? start : -1;
  }

  let angles = 0;
  let needsType = true;
  for (let i = start + 1; i < structure.length; i++) {
    const c = structure[i]!;
    if (c === '\n' && angles === 0 && !needsType) {
      const next = structure[skipWhitespace(structure, i + 1)];
      if (next && !/[{<|&=[\]]/.test(next)) return -1;
    }
    if (/\s/.test(c)) continue;
    if (angles === 0 && (c === ';' || c === '}' || c === ',')) return -1;
    if (structure.startsWith('=>', i)) {
      const next = skipWhitespace(structure, i + 2);
      if (angles === 0 && arrow && structure[next] === '{') return next;
      needsType = true;
      i++;
      continue;
    }
    if (c === '=') return -1;
    if (c === '{' && angles === 0 && !needsType) return arrow ? -1 : i;
    if (c === '{' || c === '(' || c === '[') {
      const close = c === '{' ? '}' : c === '(' ? ')' : ']';
      i = closingDelimiter(structure, i, c, close);
      if (i < 0) return -1;
    }
    if (c === '<') angles++;
    if (c === '>' && angles > 0) angles--;
    needsType = c === '|' || c === '&' || c === '?' || c === ':';
  }
  return -1;
}

function extractFunctionSpans(structure: string, lang: SupportedLanguage): FunctionSpan[] {
  const lineAt = lineIndex(structure);
  if (lang === 'python') return pythonSpans(structure, lineAt);
  const spans: FunctionSpan[] = [];
  const namedBodies = new Set<number>();
  const headers = /^[ \t]*(?:(?:export[ \t]+)?(?:default[ \t]+)?(?:async[ \t]+)?function[ \t]+([A-Za-z_$][\w$]*)[ \t]*(?:<[^>\n]+>[ \t]*)?\(|(?:export[ \t]+)?(?:const|let|var)[ \t]+([A-Za-z_$][\w$]*)[ \t]*(?::[^=\n]+)?=[ \t]*(?:async[ \t]+)?(\(|[A-Za-z_$][\w$]*)|(?:(?:public|private|protected|static|async|override)[ \t]+)*([A-Za-z_$][\w$]*)[ \t]*\()/gm;
  let headersExamined = 0;
  for (const m of structure.matchAll(headers)) {
    if (++headersExamined > MAX_FUNCTION_SPANS) throw new Error('function headers exceed the scan limit');
    const name = m[1] ?? m[2] ?? m[4]!;
    if (/^(?:if|for|while|switch|catch|with|return)$/.test(name)) continue;
    const start = m.index!;
    const paramEnd = start + m[0].length - 1;
    const close = structure[paramEnd] === '(' ? closingDelimiter(structure, paramEnd, '(', ')') : paramEnd;
    if (close < 0) continue;
    const open = tsBodyStart(structure, close + 1, m[2] !== undefined);
    if (open < 0) continue;
    const end = closingDelimiter(structure, open, '{', '}');
    if (end < 0) continue;
    namedBodies.add(open);
    spans.push({ name, startLine: lineAt(start), bodyOffset: open + 1, endOffset: end, endLine: lineAt(end) });
  }
  for (const match of structure.matchAll(/=>\s*\{/g)) {
    const open = match.index! + match[0].length - 1;
    if (namedBodies.has(open)) continue;
    if (++headersExamined > MAX_FUNCTION_SPANS) throw new Error('function spans exceed the scan limit');
    const end = closingDelimiter(structure, open, '{', '}');
    if (end < 0) continue;
    const startLine = lineAt(match.index!);
    spans.push({
      name: '<callback:' + startLine + '>',
      startLine, bodyOffset: open + 1, endOffset: end, endLine: lineAt(end),
    });
  }
  return spans;
}

function functionAtLine(spans: FunctionSpan[], line: number): FunctionSpan | null {
  let best: FunctionSpan | null = null;
  for (const s of spans) {
    if (line >= s.startLine && line <= s.endLine) {
      if (!best || s.startLine >= best.startLine) best = s;
    }
  }
  return best;
}

interface VocabDecl {
  file: string;
  line: number;
  language: SupportedLanguage;
  name: string;
  tokens: Set<string>;
  isTypedEnumOrUnion: boolean;
}

function extractStringLiterals(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(['"])([A-Za-z0-9_.-]+)\1/g)) {
    const val = m[2]!;
    if (val.length >= 2 && val.length <= MAX_STATE_LITERAL_LENGTH) out.push(val);
  }
  return out;
}

function extractVocabularies(file: SourceFile, lines: string[]): VocabDecl[] {
  const decls: VocabDecl[] = [];
  if (file.language === 'python') {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();
      const enumM = /^class\s+([A-Za-z_]\w*)\s*\(([^)]*\b(?:StrEnum|IntEnum|Enum)\b[^)]*)\)\s*:/.exec(trimmed);
      if (enumM) {
        const indent = line.length - line.trimStart().length;
        const tokens = new Set<string>();
        let j = i + 1;
        while (j < lines.length) {
          const nxt = lines[j]!;
          if (nxt.trim() && nxt.length - nxt.trimStart().length <= indent) break;
          for (const lit of extractStringLiterals(nxt)) tokens.add(lit);
          j++;
        }
        if (tokens.size >= 2) {
          decls.push({ file: file.rel, line: i + 1, language: 'python', name: enumM[1]!, tokens, isTypedEnumOrUnion: true });
        }
        continue;
      }

      const litM = /^([A-Za-z_]\w*)\s*(?::\s*TypeAlias\s*)?=\s*Literal\s*\[(.*)$/.exec(trimmed);
      if (litM) {
        let buf = litM[2]!;
        for (let j = i + 1; j < lines.length && j - i < 20 && !buf.includes(']'); j++) buf += ' ' + lines[j]!;
        const tokens = new Set(extractStringLiterals(buf.split(']')[0]!));
        if (tokens.size >= 2) {
          decls.push({ file: file.rel, line: i + 1, language: 'python', name: litM[1]!, tokens, isTypedEnumOrUnion: true });
        }
        continue;
      }

      const colM = /^([A-Z][A-Z0-9_]{2,})\s*(?::[^=]+)?=\s*(?:frozenset\s*\(\s*)?[\[\(\{](.*)$/.exec(trimmed);
      if (colM) {
        let buf = colM[2]!;
        let j = i + 1;
        while (j < lines.length && !/[\]\)\}]/.test(buf) && j - i < 20) {
          buf += ' ' + lines[j]!;
          j++;
        }
        const tokens = new Set(extractStringLiterals(buf));
        if (tokens.size >= 2) {
          decls.push({ file: file.rel, line: i + 1, language: 'python', name: colM[1]!, tokens, isTypedEnumOrUnion: false });
        }
      }
    }
    return decls;
  }

  // TS/JS
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    const enumM = /^(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)\s*\{(.*)$/.exec(trimmed);
    if (enumM) {
      let buf = enumM[2]!;
      let j = i + 1;
      while (j < lines.length && !buf.includes('}') && j - i < 40) {
        buf += ' ' + lines[j]!;
        j++;
      }
      const tokens = new Set(extractStringLiterals(buf));
      if (tokens.size >= 2) {
        decls.push({ file: file.rel, line: i + 1, language: 'ts_js', name: enumM[1]!, tokens, isTypedEnumOrUnion: true });
      }
      continue;
    }

    const typeM = /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=\s*(.*)$/.exec(trimmed);
    if (typeM) {
      let buf = typeM[2]!;
      let j = i + 1;
      while (j < lines.length && !buf.includes(';') && j - i < 15 &&
        (/^\s*\|/.test(lines[j]!) || ((!buf.trim() || /\|\s*$/.test(buf)) && /^\s*['"]/.test(lines[j]!)))) {
        buf += ' ' + lines[j]!;
        j++;
      }
      if (buf.includes('|')) {
        const tokens = new Set(extractStringLiterals(buf));
        if (tokens.size >= 2) {
          decls.push({ file: file.rel, line: i + 1, language: 'ts_js', name: typeM[1]!, tokens, isTypedEnumOrUnion: true });
        }
      }
      continue;
    }

    const arrM = /^(?:export\s+)?const\s+([A-Z][A-Z0-9_]{2,}|[A-Za-z_$][\w$]*(?:States?|Statuses|Phases|Stages|Modes|Outcomes|Kinds))\s*(?::[^=]+)?=\s*(?:new\s+Set\s*\(\s*)?\[(.*)$/.exec(
      trimmed,
    );
    if (arrM) {
      let buf = arrM[2]!;
      let j = i + 1;
      while (j < lines.length && !buf.includes(']') && j - i < 20) {
        buf += ' ' + lines[j]!;
        j++;
      }
      const tokens = new Set(extractStringLiterals(buf));
      if (tokens.size >= 2) {
        decls.push({ file: file.rel, line: i + 1, language: 'ts_js', name: arrM[1]!, tokens, isTypedEnumOrUnion: false });
      }
    }
  }
  return decls;
}

function appendTo<K, V>(groups: Map<K, V[]>, key: K, value: V): void {
  const group = groups.get(key);
  if (group) group.push(value);
  else groups.set(key, [value]);
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
}

function mentionsSymbol(text: string, name: string): boolean {
  return new RegExp('(?:^|[^\\w$])' + escapeRegex(name) + '(?![\\w$])').test(text);
}

function importsSymbol(pf: ParsedFile, name: string): boolean {
  const pattern = pf.file.language === 'python'
    ? /^[ \t]*from[ \t]+\S+[ \t]+import[ \t]*(?:\([^)]*\)|[^\n]+)/gm
    : /^[ \t]*import[ \t]+(?:type[ \t]+)?(?:\{[^}]*\}|[^\n;]+)/gm;
  for (const block of pf.structure.matchAll(pattern)) {
    if (mentionsSymbol(block[0], name)) return true;
  }
  return false;
}

function typedFieldTokens(pf: ParsedFile, field: string, vocabs: VocabDecl[], declarations = pf.stripped): Set<string> {
  const tokens = new Set<string>();
  const annotation = new RegExp('\\b' + escapeRegex(field) + '\\s*\\??:\\s*((?:typing\\.)?Literal\\s*\\[[^\\]]{0,512}\\]|[^,\\n;{}]+)', 'g');
  for (const match of declarations.matchAll(annotation)) {
    const type = match[1]!;
    if (/^(?:(?:typing\.)?Literal\s*\[|['"][^'"]+['"]\s*\|)/.test(type)) {
      for (const token of extractStringLiterals(type)) tokens.add(token);
    }
    for (const v of vocabs) {
      if (v.language !== pf.file.language || !mentionsSymbol(type, v.name)) continue;
      if (v.file === pf.file.rel || importsSymbol(pf, v.name)) {
        for (const token of v.tokens) tokens.add(token);
      }
    }
  }
  return tokens;
}

interface RecordDeclaration {
  owner: ParsedFile;
  body: string;
}

function collectRecordDeclarations(files: ParsedFile[]): Map<string, RecordDeclaration[]> {
  const records = new Map<string, RecordDeclaration[]>();
  for (const owner of files) {
    if (owner.file.isTest) continue;
    if (owner.file.language === 'ts_js') {
      for (const match of owner.structure.matchAll(/\b(?:(?:interface|class)\s+([A-Za-z_$][\w$]*)[^{;\n]{0,240}|type\s+([A-Za-z_$][\w$]*)\s*=\s*)\{/g)) {
        const open = match.index! + match[0].length - 1;
        const close = closingDelimiter(owner.structure, open, '{', '}');
        if (close >= 0) appendTo(records, match[1] ?? match[2]!, { owner, body: owner.stripped.slice(open + 1, close) });
      }
    } else {
      const lines = owner.structure.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const match = /^([ \t]*)class[ \t]+([A-Za-z_]\w*)[^:\n]*:/.exec(lines[i]!);
        if (!match) continue;
        const indent = match[1]!.length;
        let end = i + 1;
        while (end < lines.length && (!lines[end]!.trim() || lines[end]!.length - lines[end]!.trimStart().length > indent)) end++;
        appendTo(records, match[2]!, { owner, body: owner.lines.slice(i + 1, end).join('\n') });
      }
    }
  }
  return records;
}

function receiverFieldTokens(
  pf: ParsedFile,
  field: string,
  receiver: string,
  records: Map<string, RecordDeclaration[]>,
  vocabs: VocabDecl[],
): Set<string> {
  const annotation = new RegExp('\\b' + escapeRegex(receiver) + '\\s*:\\s*([A-Za-z_$][\\w$]*)', 'g');
  const tokens = new Set<string>();
  for (const match of pf.structure.matchAll(annotation)) {
    const name = match[1]!;
    for (const { owner, body } of records.get(name) ?? []) {
      if (owner.file.language !== pf.file.language) continue;
      if (owner !== pf && !importsSymbol(pf, name)) continue;
      for (const token of typedFieldTokens(owner, field, vocabs, body)) tokens.add(token);
    }
  }
  return tokens;
}

interface ParsedFile {
  file: SourceFile;
  stripped: string;
  structure: string;
  lines: string[];
  spans: FunctionSpan[];
  vocabs: VocabDecl[];
}

function detectStringStateFanout(
  parsedFiles: ParsedFile[],
  typedVocabs: VocabDecl[],
  limits: ScannerLimits,
): StateMachineCandidate[] {
  type CompSite = { file: string; line: number; fn: string; fnOffset: number | undefined; literal: string; lang: SupportedLanguage };
  interface Comparisons { field: string; sites: CompSite[] }
  const byField = new Map<string, Comparisons>();
  const records = collectRecordDeclarations(parsedFiles);

  for (const pf of parsedFiles) {
    if (pf.file.isTest) continue;
    const { rel, language } = pf.file;
    const typedByField = new Map<string, Set<string>>();
    const structureLines = pf.structure.split('\n');
    for (let i = 0; i < pf.lines.length; i++) {
      const line = pf.lines[i]!;
      const lineNum = i + 1;
      const scope = functionAtLine(pf.spans, lineNum);
      const fn = scope?.name ?? '<module>';
      const record = (field: string, literal: string, expression: string, offset: number) => {
        if (!STATE_FIELD_RE.test(field) || literal.length > MAX_STATE_LITERAL_LENGTH) return;
        // A comparison written inside a string is data; the operator must
        // survive masking even when the observed value is a string literal.
        if (!/(?:===|!==|==|!=|\bin\b|\.includes\()/.test(structureLines[i]!.slice(offset, offset + expression.length))) return;
        const receiver = new RegExp('([A-Za-z_$][\\w$]*)\\s*(?:\\.|\\[["\'])\\s*' + escapeRegex(field) + '\\b')
          .exec(expression)?.[1];
        const typeKey = receiver ? receiver + '.' + field : field;
        let typed = typedByField.get(typeKey);
        if (!typed) {
          typed = typedFieldTokens(pf, field, typedVocabs);
          if (receiver) {
            for (const token of receiverFieldTokens(pf, field, receiver, records, typedVocabs)) typed.add(token);
          }
          typedByField.set(typeKey, typed);
        }
        if (typed.has(literal)) return;
        const key = language + ':' + field;
        let found = byField.get(key);
        if (!found) {
          found = { field, sites: [] };
          byField.set(key, found);
        }
        found.sites.push({ file: rel, line: lineNum, fn, fnOffset: scope?.bodyOffset, literal, lang: language });
      };

      // obj.field == 'lit' | field === 'lit' | field != 'lit'
      for (const m of line.matchAll(
        /(?<![\w$])(?:[A-Za-z_$][\w$]*\.)?([A-Za-z_$][\w$]*)\s*(?:===|!==|==|!=)\s*(['"])([A-Za-z0-9_.-]+)\2/g,
      )) {
        record(m[1]!, m[3]!, m[0], m.index!);
      }
      // obj['field'] == 'lit'
      for (const m of line.matchAll(
        /\[(['"])([A-Za-z_$][\w$]*)\1\]\s*(?:===|!==|==|!=)\s*(['"])([A-Za-z0-9_.-]+)\3/g,
      )) {
        if (structureLines[i]!.slice(m.index!, m.index! + m[0].length).includes('=')) {
          record(m[2]!, m[4]!, line.slice(Math.max(0, m.index! - 64), m.index! + m[0].length), Math.max(0, m.index! - 64));
        }
      }
      // 'lit' == obj.field
      for (const m of line.matchAll(
        /(['"])([A-Za-z0-9_.-]+)\1\s*(?:===|!==|==|!=)\s*(?:\b[A-Za-z_$][\w$]*\.)?([A-Za-z_$][\w$]*)/g,
      )) {
        record(m[3]!, m[2]!, m[0], m.index!);
      }
      // field in ('a', 'b') or field in {'a', 'b'} or field in ['a', 'b']
      for (const m of line.matchAll(
        /(?<![\w$])(?:[A-Za-z_$][\w$]*\.)?([A-Za-z_$][\w$]*)\s+(?:not\s+)?in\s*[\(\[\{]([^()[\]{}\n]{0,512})[\)\]\}]/g,
      )) {
        for (const lit of extractStringLiterals(m[2]!)) {
          record(m[1]!, lit, m[0], m.index!);
        }
      }
      // ['a', 'b'].includes(obj.field)
      for (const m of line.matchAll(
        /\[([^[\]\n]{1,512})\]\.includes\(\s*(?:\b[A-Za-z_$][\w$]*\.)?([A-Za-z_$][\w$]*)\s*\)/g,
      )) {
        for (const lit of extractStringLiterals(m[1]!)) {
          record(m[2]!, lit, m[0], m.index!);
        }
      }
    }
  }

  const candidates: StateMachineCandidate[] = [];
  for (const { field, sites } of byField.values()) {
    const literals = new Set(sites.map(s => s.literal));
    if (literals.size < 2) continue;
    const fns = new Set(sites.filter(s => s.fnOffset !== undefined).map(s => `${s.file}::${s.fnOffset}`));
    const files = new Set(sites.map(s => s.file));
    if (fns.size < limits.minStringCompareFunctions && files.size < limits.minStringCompareFiles) continue;
    const languages = [...new Set(sites.map(s => s.lang))].sort() as SupportedLanguage[];
    candidates.push({
      signal: 'string-state-fanout',
      subject: field,
      languages,
      sites: sites.map(s => ({ file: s.file, line: s.line, function: s.fn, detail: 'literal ' + JSON.stringify(s.literal) })),
      facts: {
        field,
        literals: [...literals].sort(),
        function_count: fns.size,
        file_count: files.size,
      },
    });
  }
  return candidates;
}

function literalStateBags(pf: ParsedFile, limits: ScannerLimits): StateMachineCandidate[] {
  const { file, stripped, structure } = pf;
  const declaration = file.language === 'python'
    ? /^[ \t]*([A-Za-z_]\w*)\s*(?::[^=\n]+)?=\s*\{/gm
    : /^[ \t]*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*\{/gm;
  const lineAt = lineIndex(structure);
  const candidates: StateMachineCandidate[] = [];

  for (const match of structure.matchAll(declaration)) {
    const name = match[1]!;
    const start = match.index! + match[0].length - 1;
    const end = closingDelimiter(structure, start, '{', '}');
    if (end < 0) continue;
    const fields = new Map<string, number>();
    const members = /(?:^|,)\s*(?:(['"])([A-Za-z_$][\w$]*)\1|([A-Za-z_$][\w$]*))\s*:\s*(?:true|false|null|undefined|True|False|None)(?=\s*(?:,|$))/g;
    const body = stripped.slice(start + 1, end);
    let scanned = 0;
    let depth = 0;
    for (const member of body.matchAll(members)) {
      for (; scanned < member.index!; scanned++) {
        const c = structure[start + 1 + scanned];
        if (c === '{' || c === '[' || c === '(') depth++;
        if (c === '}' || c === ']' || c === ')') depth--;
      }
      const field = member[2] ?? member[3]!;
      const offset = start + 1 + member.index!;
      const colon = member[0].indexOf(':');
      if (depth !== 0 || structure[offset + colon] !== ':' || !COUPLED_FIELD_RE.test(field)) continue;
      fields.set(field, lineAt(offset + member[0].indexOf(field)));
    }
    if (fields.size >= limits.minCoupledFields) {
      candidates.push({
        signal: 'boolean-state-bag', subject: name, languages: [file.language],
        sites: [...fields].map(([field, line]) => ({ file: file.rel, line, detail: field })),
        facts: { record: name, fields: [...fields.keys()] },
      });
    }
  }
  return candidates;
}

function detectBooleanStateBag(parsedFiles: ParsedFile[], limits: ScannerLimits): StateMachineCandidate[] {
  const candidates: StateMachineCandidate[] = [];

  for (const pf of parsedFiles) {
    if (pf.file.isTest) continue;
    candidates.push(...literalStateBags(pf, limits));
    const { rel, language } = pf.file;
    const lines = pf.structure.split('\n');

    if (language === 'python') {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const clsM = /^(\s*)class\s+([A-Za-z_]\w*)(?:\s*\(([^)]*)\))?\s*:/.exec(line);
        if (!clsM) continue;
        const baseList = clsM[3] ?? '';
        if (/\b(?:Enum|StrEnum|IntEnum)\b/.test(baseList)) continue;
        const indent = clsM[1]!.length;
        const name = clsM[2]!;
        const matchedFields: Array<{ name: string; line: number }> = [];
        const seen = new Set<string>();
        let memberIndent: number | undefined;
        for (let j = i + 1; j < lines.length; j++) {
          const body = lines[j]!;
          if (!body.trim()) continue;
          const bodyIndent = body.length - body.trimStart().length;
          if (bodyIndent <= indent) break;
          memberIndent ??= bodyIndent;
          const annM = bodyIndent === memberIndent ? /^\s+([a-z][a-z0-9_]*)\s*:\s*([^=#]+)/.exec(body) : null;
          if (annM) {
            const fname = annM[1]!;
            const ftype = annM[2]!;
            if (
              COUPLED_FIELD_RE.test(fname) &&
              /\b(?:bool|Optional|None)\b|\|\s*None/.test(ftype) &&
              !seen.has(fname)
            ) {
              seen.add(fname);
              matchedFields.push({ name: fname, line: j + 1 });
            }
          }
          const initM = /^\s+self\.([a-z][a-z0-9_]*)\s*(?::[^=]+)?=\s*(True|False|None)\b/.exec(body);
          if (initM) {
            const fname = initM[1]!;
            if (COUPLED_FIELD_RE.test(fname) && !seen.has(fname)) {
              seen.add(fname);
              matchedFields.push({ name: fname, line: j + 1 });
            }
          }
        }
        if (matchedFields.length >= limits.minCoupledFields) {
          candidates.push({
            signal: 'boolean-state-bag',
            subject: name,
            languages: ['python'],
            sites: matchedFields.map(f => ({ file: rel, line: f.line, detail: f.name })),
            facts: { record: name, fields: matchedFields.map(f => f.name) },
          });
        }
      }
      continue;
    }

    // TS/JS interface / type / class
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]!.trim();
      const hdrM =
        /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)[^{]*\{/.exec(trimmed) ??
        /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=\s*\{/.exec(trimmed) ??
        /^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)[^{]*\{/.exec(trimmed);
      if (!hdrM) continue;
      const name = hdrM[1]!;
      const matchedFields: Array<{ name: string; line: number }> = [];
      const seen = new Set<string>();
      let depth = (lines[i]!.match(/\{/g) ?? []).length - (lines[i]!.match(/\}/g) ?? []).length;
      for (let j = i + 1; j < lines.length && depth > 0; j++) {
        const body = lines[j]!;
        if (depth === 1) {
          const fM =
            /^\s*(?:(?:readonly|public|private|protected|static)\s+)*([A-Za-z_$][\w$]*)(\?)?\s*:\s*([^;=]+)/.exec(
              body,
            );
          if (fM) {
            const fname = fM[1]!;
            const isOpt = Boolean(fM[2]);
            const ftype = fM[3]!;
            if (
              COUPLED_FIELD_RE.test(fname) &&
              (isOpt || /\b(?:boolean|null|undefined)\b/.test(ftype)) &&
              !seen.has(fname)
            ) {
              seen.add(fname);
              matchedFields.push({ name: fname, line: j + 1 });
            }
          }
        }
        depth += (body.match(/\{/g) ?? []).length - (body.match(/\}/g) ?? []).length;
      }
      if (matchedFields.length >= limits.minCoupledFields) {
        candidates.push({
          signal: 'boolean-state-bag',
          subject: name,
          languages: ['ts_js'],
          sites: matchedFields.map(f => ({ file: rel, line: f.line, detail: f.name })),
          facts: { record: name, fields: matchedFields.map(f => f.name) },
        });
      }
    }
  }

  return candidates;
}

function detectMutationFanout(parsedFiles: ParsedFile[], limits: ScannerLimits): StateMachineCandidate[] {
  type WriteSite = { file: string; line: number; fn: string; fnOffset: number; lang: SupportedLanguage };
  const byField = new Map<string, WriteSite[]>();

  for (const pf of parsedFiles) {
    if (pf.file.isTest) continue;
    if (TRANSITION_MODULE_RE.test(pf.file.rel)) continue;
    const { rel, language } = pf.file;
    const structure = pf.structure.split('\n');

    for (let i = 0; i < pf.lines.length; i++) {
      const line = pf.lines[i]!;
      const lineNum = i + 1;
      const scope = functionAtLine(pf.spans, lineNum);
      if (!scope) continue;
      const fn = scope.name;

      // obj.status = ... (not ==, !=, <=, >=, =>)
      for (const m of structure[i]!.matchAll(
        /\b[A-Za-z_$][\w$]*\.([A-Za-z_$][\w$]*)\s*(?<![=!<>])=(?![=>])/g,
      )) {
        const field = m[1]!;
        if (!STATE_FIELD_RE.test(field)) continue;
        appendTo(byField, field, { file: rel, line: lineNum, fn, fnOffset: scope.bodyOffset, lang: language });
      }
      // obj['status'] = ...
      for (const m of line.matchAll(
        /\b[A-Za-z_$][\w$]*\[(['"])([A-Za-z_$][\w$]*)\1\]\s*(?<![=!<>])=(?![=>])/g,
      )) {
        const eq = m.index! + m[0].length - 1;
        if (structure[i]![eq] !== '=') continue;
        const field = m[2]!;
        if (!STATE_FIELD_RE.test(field)) continue;
        appendTo(byField, field, { file: rel, line: lineNum, fn, fnOffset: scope.bodyOffset, lang: language });
      }
    }
  }

  const candidates: StateMachineCandidate[] = [];
  for (const [field, sites] of byField) {
    const fns = new Set(sites.map(s => `${s.file}::${s.fnOffset}`));
    if (fns.size < limits.minWriteFunctions) continue;
    const files = new Set(sites.map(s => s.file));
    const languages = [...new Set(sites.map(s => s.lang))].sort() as SupportedLanguage[];
    candidates.push({
      signal: 'mutation-fanout',
      subject: field,
      languages,
      sites: sites.map(s => ({ file: s.file, line: s.line, function: s.fn })),
      facts: { field, function_count: fns.size, file_count: files.size },
    });
  }
  return candidates;
}

// Return argument ranges in the masked source, where delimiters in strings
// and comments cannot affect the split.
function callArguments(structure: string, open: number): Array<[number, number]> {
  const args: Array<[number, number]> = [];
  let start = open + 1;
  let depth = 0;
  for (let i = start; i < structure.length; i++) {
    const c = structure[i]!;
    if (depth === 0 && (c === ',' || c === ')')) {
      args.push([start, i]);
      if (c === ')') return args;
      start = i + 1;
    } else if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
  }
  return [];
}

const PERSIST_CALL_RE =
  /\b(json\.dumps?|JSON\.stringify|writeFile(?:Sync)?|Bun\.write|write_text|save|persist|execute|executemany|query)\s*\(/g;

function persistedKeys(pf: ParsedFile, span: FunctionSpan, lineAt: (offset: number) => number): Map<string, CandidateSite[]> {
  const body = pf.stripped.slice(span.bodyOffset, span.endOffset);
  const code = pf.structure.slice(span.bodyOffset, span.endOffset);
  const literalStarts = new Set<number>();
  const payloadNames = new Set<string>();
  const writes = new Map<string, CandidateSite[]>();
  const add = (key: string, offset: number) => {
    const line = lineAt(span.bodyOffset + offset);
    appendTo(writes, key, { file: pf.file.rel, line, function: span.name });
  };
  for (const match of code.matchAll(PERSIST_CALL_RE)) {
    const open = match.index! + match[0].length - 1;
    const args = callArguments(code, open);
    const name = match[1]!;
    const first = args[0] ? body.slice(...args[0]).trim() : '';
    const namedDestination = /^(?:save|persist)$/.test(name) && args.length > 1 &&
      /^(?:['"\x60]|(?:path|file|filename|destination|dest|target)\b|(?:Path|join|resolve)\s*\()/i.test(first);
    const valueIndex = /^(?:writeFile|Bun\.write)/.test(name) || namedDestination ? 1 : 0;
    const value = args[valueIndex];
    if (!value) continue;
    if (/^(?:execute|executemany|query)$/.test(match[1]!)) {
      const statement = body.slice(...value);
      const insert = /^\s*['"\x60]\s*INSERT\s+INTO\s+\w+\s*\(([^)]+)\)/i.exec(statement);
      if (insert) {
        for (const key of insert[1]!.split(',').map(part => part.trim())) {
          if (/^\w+$/.test(key)) add(key, value[0]);
        }
      }
      const update = /^\s*['"\x60]\s*UPDATE\s+\w+\s+SET\s+(.*?)(?:\s+WHERE\b|['"\x60])/i.exec(statement);
      if (update) {
        for (const column of update[1]!.matchAll(/(?:^|,)\s*(\w+)\s*=/g)) add(column[1]!, value[0]);
      }
      continue;
    }
    const start = skipWhitespace(code, value[0]);
    if (code[start] === '{') literalStarts.add(start);
    const payload = code.slice(start, value[1]).trimEnd();
    if (/^[A-Za-z_$][\w$]*$/.test(payload)) payloadNames.add(payload);
  }

  for (const name of payloadNames) {
    const declaration = new RegExp('\\b' + escapeRegex(name) + '\\s*(?::[^=\\n]+)?=\\s*\\{', 'g');
    for (const match of code.matchAll(declaration)) literalStarts.add(match.index! + match[0].length - 1);
  }

  const member = pf.file.language === 'python'
    ? /(?:^|,)\s*(['"])([a-z][A-Za-z0-9_]{0,40})\1\s*:/g
    : /(?:^|,)\s*(?:(['"])([a-z][A-Za-z0-9_]{0,40})\1|([a-z][A-Za-z0-9_]{0,40}))\s*(?::|(?=,|$))/g;

  for (const open of literalStarts) {
    const end = closingDelimiter(code, open, '{', '}');
    if (end < 0) continue;
    let read = open + 1;
    let depth = 0;
    for (const match of body.slice(open + 1, end).matchAll(member)) {
      const offset = open + 1 + match.index!;
      for (; read < offset; read++) {
        const c = code[read];
        if (c === '{' || c === '[' || c === '(') depth++;
        if (c === '}' || c === ']' || c === ')') depth--;
      }
      const key = match[2] ?? match[3]!;
      const keyOffset = offset + match[0].indexOf(key);
      const colon = match[0].indexOf(':');
      const inCode = colon >= 0 ? code[offset + colon] === ':' : code[keyOffset] === key[0];
      if (depth === 0 && inCode) add(key, keyOffset);
    }
  }
  for (const name of payloadNames) {
    const assignment = new RegExp('\\b' + escapeRegex(name) + '(?:\\.(\\w+)|\\[([\'"])(\\w+)\\2\\])\\s*=(?![=>])', 'g');
    for (const match of body.matchAll(assignment)) {
      const eq = match.index! + match[0].length - 1;
      if (code[eq] === '=') add(match[1] ?? match[3]!, match.index!);
    }
  }
  return writes;
}

const LOADER_PREFIX_RE = /^(?:deserialize|from_?dict|from_?json|load|decode|parse|read|validate)/i;
const WRITER_PREFIX_RE = /^(?:serialize|save|write|persist|dump|store|encode|create|update)/i;

function recordName(name: string, prefix: RegExp): string {
  return name.replace(prefix, '').replaceAll('_', '').toLowerCase();
}

function containsRecordKey(text: string, key: string): boolean {
  const id = escapeRegex(key);
  if (new RegExp('["\']' + id + '["\']|\\.' + id + '\\b|\\b' + id + '\\s*:').test(text)) return true;
  for (const match of text.matchAll(/\{([^{}]{1,512})\}\s*=/g)) {
    if (mentionsSymbol(match[1]!, key)) return true;
  }
  return false;
}

function detectWriteDecodeGap(parsedFiles: ParsedFile[]): StateMachineCandidate[] {
  const prodFiles = parsedFiles.filter(pf => !pf.file.isTest);
  interface Loader {
    file: SourceFile;
    record: string;
    body: string;
  }
  const loaders: Loader[] = [];

  for (const pf of prodFiles) {
    for (const span of pf.spans) {
      if (LOADER_PREFIX_RE.test(span.name)) {
        loaders.push({
          file: pf.file,
          record: recordName(span.name, LOADER_PREFIX_RE),
          body: pf.stripped.slice(span.bodyOffset, span.endOffset),
        });
      }
    }
    for (const m of pf.structure.matchAll(/(?:(\w+)\s*=\s*)?\bz\.object\s*\(\s*\{/g)) {
      const start = m.index! + m[0].length - 1;
      const end = closingDelimiter(pf.structure, start, '{', '}');
      if (end < 0) continue;
      loaders.push({
        file: pf.file,
        record: (m[1] ?? '').replace(/Schema$/i, '').replaceAll('_', '').toLowerCase(),
        body: pf.stripped.slice(start + 1, end),
      });
    }
  }

  const candidates: StateMachineCandidate[] = [];
  for (const pf of prodFiles) {
    if (pf.structure.search(PERSIST_CALL_RE) < 0) continue;
    const { rel, language } = pf.file;
    const lineAt = lineIndex(pf.structure);
    for (const span of pf.spans) {
      if (LOADER_PREFIX_RE.test(span.name)) continue;
      const writes = persistedKeys(pf, span, lineAt);
      if (writes.size === 0) continue;
      const record = recordName(span.name, WRITER_PREFIX_RE);
      const matching = loaders.filter(loader =>
        loader.file.language === language && (
          Boolean(record && loader.record === record) ||
          (loader.file.rel === rel && (!record || !loader.record))
        ));
      if (matching.length === 0) continue;
      const exact = matching.filter(loader => record && loader.record === record);
      const exactLocal = exact.filter(loader => loader.file.rel === rel);
      const related = exactLocal.length ? exactLocal : exact.length ? exact : matching;

      for (const [key, sites] of writes) {
        if (related.some(loader => containsRecordKey(loader.body, key))) continue;
        candidates.push({
          signal: 'write-decode-gap', subject: key, languages: [language],
          sites, facts: { key, loaders_checked: related.length },
        });
      }
    }
  }
  return candidates;
}

const FILE_PROBE_RE = /\b(?:existsSync|readFileSync|statSync|accessSync|readFile|exists|isfile|read_text|open)\s*\(/g;
const STATE_PATH_RE =
  /(?:state|status|checkpoint|marker|lock|phase|stage|progress|done|ready|pending|error|cursor|handoff|receipt|flag)[^'"\n]*\.(?:json|ya?ml|txt)$|\.(?:lock|state|status|flag|done|marker|pid)$/i;
const BRANCH_RE = /\b(?:if|elif|switch|while)\b|(?<!\?)\?(?![.?])/;

function probeExpressionStart(code: string, call: number): number {
  if (code[call - 1] !== '.' || code[call - 2] !== ')') return call;
  let depth = 1;
  for (let i = call - 3; i >= 0; i--) {
    if (code[i] === ')') depth++;
    if (code[i] === '(' && --depth === 0) return i;
  }
  return call;
}

function parenthesizedBranches(code: string): Array<[number, number]> {
  const branches: Array<[number, number]> = [];
  for (const branch of code.matchAll(/\b(?:if|elif|switch|while)\s*\(/g)) {
    const open = branch.index! + branch[0].length - 1;
    const close = closingDelimiter(code, open, '(', ')');
    if (close >= 0) branches.push([open, close]);
  }
  return branches;
}

function detectCrossFileInferredState(parsedFiles: ParsedFile[], limits: ScannerLimits): StateMachineCandidate[] {
  const candidates: StateMachineCandidate[] = [];
  for (const pf of parsedFiles) {
    if (pf.file.isTest) continue;
    const { rel, language } = pf.file;
    const lineAt = lineIndex(pf.structure);
    for (const span of pf.spans) {
      const body = pf.stripped.slice(span.bodyOffset, span.endOffset);
      const code = pf.structure.slice(span.bodyOffset, span.endOffset);
      if (!BRANCH_RE.test(code)) continue;
      const branchLines = code.split('\n').filter(line => BRANCH_RE.test(line));
      const conditions = parenthesizedBranches(code);

      const filesFound = new Map<string, number>();
      for (const call of code.matchAll(FILE_PROBE_RE)) {
        const begin = call.index!;
        const open = begin + call[0].length - 1;
        const value = callArguments(code, open)[0];
        if (!value) continue;
        const expression = probeExpressionStart(code, begin);
        const lineStart = code.lastIndexOf('\n', expression - 1) + 1;
        const prefix = code.slice(lineStart, expression);
        const assigned = /\b([A-Za-z_$][\w$]*)\s*=\s*[\w. \t]*$/.exec(prefix)?.[1];
        const usedByBranch = BRANCH_RE.test(prefix) ||
          conditions.some(([start, end]) => expression >= start && open < end) ||
          (assigned !== undefined && branchLines.some(line => mentionsSymbol(line, assigned)));
        if (!usedByBranch) continue;
        const operand = begin === expression ? body.slice(...value) : body.slice(expression, begin);
        for (const literal of operand.matchAll(/(['"\x60])([^'"\x60\n]{1,240})\1/g)) {
          const path = literal[2]!;
          if (STATE_PATH_RE.test(path) && !filesFound.has(path)) filesFound.set(path, lineAt(span.bodyOffset + expression));
        }
      }
      if (filesFound.size < limits.minStateFilesPerFunction) continue;
      const sortedFiles = [...filesFound.keys()].sort();
      candidates.push({
        signal: 'cross-file-inferred-state',
        subject: rel + ':' + span.name,
        languages: [language],
        sites: sortedFiles.map(file => ({ file: rel, line: filesFound.get(file)!, function: span.name, detail: file })),
        facts: { function: span.name, state_files: sortedFiles },
      });
    }
  }
  return candidates;
}

function detectCounterThresholds(parsedFiles: ParsedFile[], limits: ScannerLimits): StateMachineCandidate[] {
  type ThreshSite = { file: string; line: number; fn: string; threshold: string; lang: SupportedLanguage };
  const byCounter = new Map<string, ThreshSite[]>();

  for (const pf of parsedFiles) {
    if (pf.file.isTest) continue;
    if (POLICY_TABLE_RE.test(pf.structure)) continue;
    const { rel, language } = pf.file;

    const lines = pf.structure.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;
      if (!BRANCH_RE.test(line)) continue;
      const scope = functionAtLine(pf.spans, lineNum);
      const fn = scope?.name ?? '<module>';

      for (const m of line.matchAll(
        /(?:\b[A-Za-z_$][\w$]*\.)?([A-Za-z_$][\w$]*)\s*(>=|<=|>|<|===|==)\s*(-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)(?![\w.])/g,
      )) {
        const ident = m[1]!;
        if (!COUNTER_IDENT_RE.test(ident)) continue;
        appendTo(byCounter, ident, { file: rel, line: lineNum, fn, threshold: `${m[2]!} ${m[3]!}`, lang: language });
      }
    }
  }

  const candidates: StateMachineCandidate[] = [];
  for (const [counter, sites] of byCounter) {
    const branchCount = new Set(sites.map(site => site.file + ':' + site.line)).size;
    if (branchCount < limits.minThresholdBranches) continue;
    const languages = [...new Set(sites.map(s => s.lang))].sort() as SupportedLanguage[];
    candidates.push({
      signal: 'counter-thresholds',
      subject: counter,
      languages,
      sites: sites.map(s => ({ file: s.file, line: s.line, function: s.fn, detail: s.threshold })),
      facts: {
        counter,
        thresholds: [...new Set(sites.map(s => s.threshold))].sort(),
        site_count: branchCount,
      },
    });
  }
  return candidates;
}

interface ParityAssertion {
  language: SupportedLanguage;
  actual: string;
  expected: string;
}

function collectParityAssertions(testFiles: ParsedFile[]): ParityAssertion[] {
  const assertions: ParityAssertion[] = [];
  for (const { file, stripped, structure } of testFiles) {
    if (file.language === 'python') {
      for (const start of structure.matchAll(/^[ \t]*assert[ \t]+/gm)) {
        const offset = start.index! + start[0].length;
        let end = offset;
        let depth = 0;
        let equals = -1;
        let equalityDepth = Infinity;
        for (; end < structure.length; end++) {
          const char = structure[end];
          if (char === '\n' && depth === 0) break;
          if (char === '(' || char === '[' || char === '{') depth++;
          if (char === ')' || char === ']' || char === '}') depth = Math.max(0, depth - 1);
          if (char === '=' && structure[end + 1] === '=' && depth < equalityDepth) {
            equals = end;
            equalityDepth = depth;
          }
        }
        if (equals >= 0) assertions.push({
          language: file.language,
          actual: stripped.slice(offset, equals),
          expected: stripped.slice(equals + 2, end),
        });

      }
    } else {
      for (const call of structure.matchAll(/\bexpect\(/g)) {
        const open = call.index! + call[0].length - 1;
        const close = closingDelimiter(structure, open, '(', ')');
        if (close < 0) continue;
        const equality = /^\s*\.\s*to(?:Strict)?Equal\(/.exec(structure.slice(close + 1));
        if (!equality) continue;
        const right = close + equality[0].length;
        const end = closingDelimiter(structure, right, '(', ')');
        if (end < 0) continue;
        assertions.push({
          language: file.language,
          actual: stripped.slice(open + 1, close),
          expected: stripped.slice(right + 1, end),
        });
      }
    }
  }
  return assertions;
}

function coversVocabulary(text: string, vocab: VocabDecl, allowSymbol: boolean): boolean {
  const path = escapeRegex(posix.basename(vocab.file));
  if (new RegExp('["\'](?:[^"\'\\n]*/)?' + path + '["\']').test(text)) return true;
  if (!allowSymbol) return false;
  const symbol = escapeRegex(vocab.name);
  return new RegExp('(?:^|[^\\w$])' + symbol + '(?![\\w$])').test(text);
}

function hasParityTest(py: VocabDecl, ts: VocabDecl, assertions: ParityAssertion[]): boolean {
  for (const { language, actual, expected } of assertions) {
    const differentNames = py.name !== ts.name;
    const python = (text: string) => coversVocabulary(text, py, differentNames || language === 'python');
    const tsJs = (text: string) => coversVocabulary(text, ts, differentNames || language === 'ts_js');
    if ((python(actual) && tsJs(expected)) || (python(expected) && tsJs(actual))) return true;
  }
  return false;
}

function detectCrossLanguageEnumDrift(parsedFiles: ParsedFile[], limits: ScannerLimits): StateMachineCandidate[] {
  const prodFiles = parsedFiles.filter(pf => !pf.file.isTest);
  const parity = collectParityAssertions(parsedFiles.filter(pf => pf.file.isTest));
  const relevantVocabs = (language: SupportedLanguage) => prodFiles
    .filter(pf => pf.file.language === language)
    .flatMap(pf => pf.vocabs)
    .filter(vocab => vocab.tokens.size >= limits.minSharedVocabTokens);
  const pyVocabs = relevantVocabs('python');
  const tsVocabs = relevantVocabs('ts_js');
  if (pyVocabs.length * tsVocabs.length > MAX_VOCAB_PAIR_CHECKS) {
    throw new Error('cross-language vocabulary pairs exceed the scan limit');
  }

  const candidates: StateMachineCandidate[] = [];
  for (const py of pyVocabs) {
    for (const ts of tsVocabs) {
      const shared = [...py.tokens].filter(t => ts.tokens.has(t)).sort();
      if (shared.length < limits.minSharedVocabTokens) continue;
      const unionSize = new Set([...py.tokens, ...ts.tokens]).size;
      const overlap = shared.length / unionSize;
      if (overlap < MIN_VOCAB_OVERLAP_RATIO) continue;
      if (hasParityTest(py, ts, parity)) continue;

      const pyOnly = [...py.tokens].filter(t => !ts.tokens.has(t)).sort();
      const tsOnly = [...ts.tokens].filter(t => !py.tokens.has(t)).sort();
      candidates.push({
        signal: 'cross-language-enum-drift',
        subject: `${py.name} <-> ${ts.name}`,
        languages: ['python', 'ts_js'],
        sites: [
          { file: py.file, line: py.line, detail: `python:${py.name}` },
          { file: ts.file, line: ts.line, detail: `ts_js:${ts.name}` },
        ],
        facts: {
          python_symbol: py.name,
          ts_js_symbol: ts.name,
          shared_tokens: shared,
          python_only: pyOnly,
          ts_js_only: tsOnly,
          overlap_ratio: Number(overlap.toFixed(3)),
        },
      });
    }
  }
  return candidates;
}

export function scanSources(
  files: SourceFile[],
  root: string,
  discovery: 'git' | 'walk',
  scannedByLanguage: { python: number; ts_js: number },
  skippedFiles: number,
  partialLimits: Partial<ScannerLimits> = {},
): ScanResult {
  const limits: ScannerLimits = { ...DEFAULT_LIMITS, ...partialLimits };

  const parsedFiles: ParsedFile[] = files.map(file => {
    const { text: stripped, structure } = lexSource(file.source, file.language);
    const lines = stripped.split('\n');
    const spans = file.isTest ? [] : extractFunctionSpans(structure, file.language);
    const vocabs = file.isTest ? [] : extractVocabularies(file, lines);
    return { file, stripped, structure, lines, spans, vocabs };
  });

  const typedVocabs = parsedFiles.flatMap(pf => pf.vocabs.filter(v => v.isTypedEnumOrUnion));

  const allCandidates: StateMachineCandidate[] = [
    ...detectStringStateFanout(parsedFiles, typedVocabs, limits),
    ...detectBooleanStateBag(parsedFiles, limits),
    ...detectMutationFanout(parsedFiles, limits),
    ...detectWriteDecodeGap(parsedFiles),
    ...detectCrossFileInferredState(parsedFiles, limits),
    ...detectCounterThresholds(parsedFiles, limits),
    ...detectCrossLanguageEnumDrift(parsedFiles, limits),
  ];

  // Spread the output limit across signals before spending more slots on a noisy group.
  const groups = new Map<SignalName, StateMachineCandidate[]>();
  const compare = (a: string, b: string) => (a < b ? -1 : Number(a > b));
  for (const candidate of allCandidates) appendTo(groups, candidate.signal, candidate);
  for (const group of groups.values()) {
    group.sort((a, b) =>
      compare(a.subject, b.subject) ||
      compare(a.sites[0]!.file, b.sites[0]!.file) ||
      a.sites[0]!.line - b.sites[0]!.line);
  }
  const ordered = [...groups.keys()].sort().map(signal => groups.get(signal)!);
  const candidates: StateMachineCandidate[] = [];
  const count = Math.min(allCandidates.length, limits.maxCandidates);
  for (let site = 0; candidates.length < count; site++) {
    for (const group of ordered) {
      if (group[site]) candidates.push(group[site]!);
      if (candidates.length === count) break;
    }
  }
  const truncated = candidates.length < allCandidates.length;

  return {
    schema: 'full-review-state-machines/v1',
    root,
    discovery,
    scanned_by_language: scannedByLanguage,
    skipped_files: skippedFiles,
    limits,
    total_candidates: allCandidates.length,
    truncated,
    candidates,
  };
}

export function scanDirectory(
  targetRoot: string,
  partialLimits: Partial<ScannerLimits> = {},
  env: NodeJS.ProcessEnv = process.env,
): ScanResult {
  const limits: ScannerLimits = { ...DEFAULT_LIMITS, ...partialLimits };
  const { discovery, files, scannedByLanguage, skippedFiles } = discoverFiles(targetRoot, limits.maxFileBytes, env);
  return scanSources(files, targetRoot, discovery, scannedByLanguage, skippedFiles, limits);
}
