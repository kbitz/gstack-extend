import { spawnSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, join, posix } from 'node:path';

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
  const res = spawnSync('git', ['-C', targetRoot, 'ls-files', '-co', '--exclude-standard', '-z'], {
    encoding: 'utf8',
    env: cleanGitEnv(env),
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) return null;
  return (res.stdout ?? '').split('\0').filter(Boolean);
}

function listViaWalk(targetRoot: string): string[] {
  const out: string[] = [];
  const walk = (absDir: string, relPrefix: string) => {
    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && WALK_SKIP_DIRS.has(entry.name)) continue;
      const rel = relPrefix ? posix.join(relPrefix, entry.name) : entry.name;
      const abs = join(absDir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else {
        out.push(rel);
      }
    }
  };
  walk(targetRoot, '');
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
  const gitPaths = listViaGit(targetRoot, env);
  const discovery: 'git' | 'walk' = gitPaths !== null ? 'git' : 'walk';
  const rawPaths = (gitPaths ?? listViaWalk(targetRoot))
    .map(p => p.replaceAll('\\', '/'))
    .filter(p => !p.startsWith('node_modules/') && !p.includes('/node_modules/'))
    .sort();

  const files: SourceFile[] = [];
  const scannedByLanguage = { python: 0, ts_js: 0 };
  let skippedFiles = 0;

  for (const rel of rawPaths) {
    const abs = join(targetRoot, rel);
    try {
      const lst = lstatSync(abs);
      if (lst.isSymbolicLink()) {
        const real = realpathSync(abs);
        if (real !== realRoot && !real.startsWith(`${realRoot}/`)) {
          skippedFiles++;
          continue;
        }
      }
      const st = statSync(abs);
      if (!st.isFile() || st.size > maxFileBytes) {
        skippedFiles++;
        continue;
      }
      const lang = classifyLanguage(rel);
      if (!lang) {
        skippedFiles++;
        continue;
      }
      const source = readFileSync(abs, 'utf8');
      files.push({ rel, language: lang, isTest: isTestFile(rel), source });
      scannedByLanguage[lang]++;
    } catch {
      skippedFiles++;
    }
  }

  return { discovery, files, scannedByLanguage, skippedFiles };
}

/**
 * Strip comments while preserving exact 1-based line numbers and string literals.
 */
function stripCommentsPreserveLines(source: string, lang: SupportedLanguage): string {
  const out: string[] = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i]!;
    if (lang === 'python') {
      if (c === '#') {
        while (i < n && source[i] !== '\n') i++;
        continue;
      }
      if (c === '"' || c === "'") {
        const triple = source.startsWith(c + c + c, i);
        const close = triple ? c + c + c : c;
        const start = i;
        i += close.length;
        while (i < n && !source.startsWith(close, i)) {
          if (source[i] === '\\' && i + 1 < n) i += 2;
          else if (!triple && source[i] === '\n') break;
          else i++;
        }
        if (source.startsWith(close, i)) i += close.length;
        out.push(source.slice(start, i));
        continue;
      }
    } else {
      if (c === '/' && source[i + 1] === '/') {
        while (i < n && source[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && source[i + 1] === '*') {
        i += 2;
        while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
          if (source[i] === '\n') out.push('\n');
          i++;
        }
        if (i < n) i += 2;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        const start = i;
        i++;
        while (i < n && source[i] !== c) {
          if (source[i] === '\\' && i + 1 < n) i += 2;
          else if (c !== '`' && source[i] === '\n') break;
          else i++;
        }
        if (i < n && source[i] === c) i++;
        out.push(source.slice(start, i));
        continue;
      }
    }
    out.push(c);
    i++;
  }
  return out.join('');
}

interface FunctionSpan {
  name: string;
  startLine: number;
  endLine: number;
}

function extractFunctionSpans(lines: string[], lang: SupportedLanguage): FunctionSpan[] {
  const spans: FunctionSpan[] = [];
  if (lang === 'python') {
    const stack: Array<{ name: string; startLine: number; indent: number }> = [];
    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx]!;
      const trimmed = line.trim();
      if (!trimmed) continue;
      const indent = line.length - line.trimStart().length;
      while (stack.length > 0 && indent <= stack[stack.length - 1]!.indent) {
        const done = stack.pop()!;
        spans.push({ name: done.name, startLine: done.startLine, endLine: idx });
      }
      const m = /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/.exec(trimmed);
      if (m) {
        stack.push({ name: m[1]!, startLine: idx + 1, indent });
      }
    }
    while (stack.length > 0) {
      const done = stack.pop()!;
      spans.push({ name: done.name, startLine: done.startLine, endLine: lines.length });
    }
    return spans;
  }

  // TS/JS brace-depth tracking
  let depth = 0;
  const stack: Array<{ name: string; startLine: number; openDepth: number }> = [];
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!;
    const trimmed = line.trim();
    const fnMatch =
      /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*[<(]/.exec(trimmed) ??
      /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>\s*\{/.exec(
        trimmed,
      ) ??
      /^(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^{=]+)?\{/.exec(
        trimmed,
      );
    const openCount = (line.match(/\{/g) ?? []).length;
    const closeCount = (line.match(/\}/g) ?? []).length;
    if (fnMatch) {
      const name = fnMatch[1]!;
      if (!['if', 'for', 'while', 'switch', 'catch', 'else', 'try', 'finally'].includes(name)) {
        stack.push({ name, startLine: idx + 1, openDepth: depth });
      }
    }
    depth = Math.max(0, depth + openCount - closeCount);
    while (stack.length > 0 && depth <= stack[stack.length - 1]!.openDepth && closeCount > 0) {
      const done = stack.pop()!;
      spans.push({ name: done.name, startLine: done.startLine, endLine: idx + 1 });
    }
  }
  while (stack.length > 0) {
    const done = stack.pop()!;
    spans.push({ name: done.name, startLine: done.startLine, endLine: lines.length });
  }
  return spans;
}

function functionAtLine(spans: FunctionSpan[], line: number): string {
  let best: FunctionSpan | null = null;
  for (const s of spans) {
    if (line >= s.startLine && line <= s.endLine) {
      if (!best || s.startLine >= best.startLine) best = s;
    }
  }
  return best ? best.name : '<module>';
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
    if (val.length >= 2 && val.length <= 48) out.push(val);
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

      const litM = /^([A-Za-z_]\w*)\s*(?::\s*TypeAlias\s*)?=\s*Literal\s*\[([^\]]+)\]/.exec(trimmed);
      if (litM) {
        const tokens = new Set(extractStringLiterals(litM[2]!));
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
      while (j < lines.length && !buf.includes(';') && j - i < 15 && /^\s*\|/.test(lines[j]!)) {
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

function isFieldCoveredByTypedVocab(literals: Set<string>, typedVocabs: VocabDecl[]): boolean {
  for (const v of typedVocabs) {
    let matched = 0;
    for (const lit of literals) {
      if (v.tokens.has(lit)) matched++;
    }
    if (matched === literals.size && matched >= 2) return true;
  }
  return false;
}

interface ParsedFile {
  file: SourceFile;
  stripped: string;
  lines: string[];
  spans: FunctionSpan[];
  vocabs: VocabDecl[];
}

function detectStringStateFanout(
  parsedFiles: ParsedFile[],
  typedVocabs: VocabDecl[],
  limits: ScannerLimits,
): StateMachineCandidate[] {
  type CompSite = { file: string; line: number; fn: string; literal: string; lang: SupportedLanguage };
  const byField = new Map<string, CompSite[]>();

  const record = (field: string, literal: string, file: string, line: number, fn: string, lang: SupportedLanguage) => {
    if (!STATE_FIELD_RE.test(field)) return;
    if (!literal || literal.length > 48) return;
    let list = byField.get(field);
    if (!list) {
      list = [];
      byField.set(field, list);
    }
    list.push({ file, line, fn, literal, lang });
  };

  for (const pf of parsedFiles) {
    if (pf.file.isTest) continue;
    const { rel, language } = pf.file;
    for (let i = 0; i < pf.lines.length; i++) {
      const line = pf.lines[i]!;
      const lineNum = i + 1;
      const fn = functionAtLine(pf.spans, lineNum);

      // obj.field == 'lit' | field === 'lit' | field != 'lit'
      for (const m of line.matchAll(
        /(?:\b[A-Za-z_$][\w$]*\.)?([A-Za-z_$][\w$]*)\s*(?:===|!==|==|!=)\s*(['"])([A-Za-z0-9_.-]+)\2/g,
      )) {
        record(m[1]!, m[3]!, rel, lineNum, fn, language);
      }
      // obj['field'] == 'lit'
      for (const m of line.matchAll(
        /\[(['"])([A-Za-z_$][\w$]*)\1\]\s*(?:===|!==|==|!=)\s*(['"])([A-Za-z0-9_.-]+)\3/g,
      )) {
        record(m[2]!, m[4]!, rel, lineNum, fn, language);
      }
      // 'lit' == obj.field
      for (const m of line.matchAll(
        /(['"])([A-Za-z0-9_.-]+)\1\s*(?:===|!==|==|!=)\s*(?:\b[A-Za-z_$][\w$]*\.)?([A-Za-z_$][\w$]*)/g,
      )) {
        record(m[3]!, m[2]!, rel, lineNum, fn, language);
      }
      // field in ('a', 'b') or field in {'a', 'b'} or field in ['a', 'b']
      for (const m of line.matchAll(
        /(?:\b[A-Za-z_$][\w$]*\.)?([A-Za-z_$][\w$]*)\s+(?:not\s+)?in\s*[\(\[\{]([^\)\]\}]*)[\)\]\}]/g,
      )) {
        for (const lit of extractStringLiterals(m[2]!)) {
          record(m[1]!, lit, rel, lineNum, fn, language);
        }
      }
      // ['a', 'b'].includes(obj.field)
      for (const m of line.matchAll(
        /\[([^\]]+)\]\.includes\(\s*(?:\b[A-Za-z_$][\w$]*\.)?([A-Za-z_$][\w$]*)\s*\)/g,
      )) {
        for (const lit of extractStringLiterals(m[1]!)) {
          record(m[2]!, lit, rel, lineNum, fn, language);
        }
      }
    }
  }

  const candidates: StateMachineCandidate[] = [];
  for (const [field, sites] of byField) {
    const literals = new Set(sites.map(s => s.literal));
    if (literals.size < 2) continue;
    if (isFieldCoveredByTypedVocab(literals, typedVocabs)) continue;
    const fns = new Set(sites.map(s => `${s.file}::${s.fn}`));
    const files = new Set(sites.map(s => s.file));
    if (fns.size < limits.minStringCompareFunctions && files.size < limits.minStringCompareFiles) continue;
    const languages = [...new Set(sites.map(s => s.lang))].sort() as SupportedLanguage[];
    candidates.push({
      signal: 'string-state-fanout',
      subject: field,
      languages,
      sites: sites.map(s => ({ file: s.file, line: s.line, function: s.fn, detail: `== '${s.literal}'` })),
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

function detectBooleanStateBag(parsedFiles: ParsedFile[], limits: ScannerLimits): StateMachineCandidate[] {
  const candidates: StateMachineCandidate[] = [];

  for (const pf of parsedFiles) {
    if (pf.file.isTest) continue;
    const { rel, language } = pf.file;
    const lines = pf.lines;

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
        for (let j = i + 1; j < lines.length; j++) {
          const body = lines[j]!;
          if (body.trim() && body.length - body.trimStart().length <= indent) break;
          const annM = /^\s+([a-z][a-z0-9_]*)\s*:\s*([^=#]+)/.exec(body);
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
            /^\s*(?:readonly\s+|public\s+|private\s+|protected\s+)?([A-Za-z_$][\w$]*)(\?)?\s*:\s*([^;=]+)/.exec(
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
  type WriteSite = { file: string; line: number; fn: string; lang: SupportedLanguage };
  const byField = new Map<string, WriteSite[]>();

  for (const pf of parsedFiles) {
    if (pf.file.isTest) continue;
    if (TRANSITION_MODULE_RE.test(pf.file.rel)) continue;
    const { rel, language } = pf.file;

    for (let i = 0; i < pf.lines.length; i++) {
      const line = pf.lines[i]!;
      const lineNum = i + 1;
      const fn = functionAtLine(pf.spans, lineNum);
      if (fn === '<module>') continue;

      // obj.status = ... (not ==, !=, <=, >=, =>)
      for (const m of line.matchAll(
        /\b[A-Za-z_$][\w$]*\.([A-Za-z_$][\w$]*)\s*(?<![=!<>])=(?![=>])/g,
      )) {
        const field = m[1]!;
        if (!STATE_FIELD_RE.test(field)) continue;
        let list = byField.get(field);
        if (!list) {
          list = [];
          byField.set(field, list);
        }
        list.push({ file: rel, line: lineNum, fn, lang: language });
      }
      // obj['status'] = ...
      for (const m of line.matchAll(
        /\b[A-Za-z_$][\w$]*\[(['"])([A-Za-z_$][\w$]*)\1\]\s*(?<![=!<>])=(?![=>])/g,
      )) {
        const field = m[2]!;
        if (!STATE_FIELD_RE.test(field)) continue;
        let list = byField.get(field);
        if (!list) {
          list = [];
          byField.set(field, list);
        }
        list.push({ file: rel, line: lineNum, fn, lang: language });
      }
    }
  }

  const candidates: StateMachineCandidate[] = [];
  for (const [field, sites] of byField) {
    const fns = new Set(sites.map(s => `${s.file}::${s.fn}`));
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

const PERSIST_FILE_RE =
  /\b(?:json\.dumps?|JSON\.stringify|writeFile(?:Sync)?|Bun\.write|write_text|persist|INSERT\s+INTO|UPDATE\s+\w+\s+SET)\b/;
const LOADER_FN_RE = /^(?:load|decode|parse|read|validate)[A-Za-z0-9_]*$/i;
const WRITER_FN_RE = /^(?:save|write|persist|dump|store|encode|serialize|create|update)[A-Za-z0-9_]*$/i;

function detectWriteDecodeGap(parsedFiles: ParsedFile[]): StateMachineCandidate[] {
  const prodFiles = parsedFiles.filter(pf => !pf.file.isTest);
  const loaderTexts: string[] = [];
  let loadersChecked = 0;

  for (const pf of prodFiles) {
    for (const span of pf.spans) {
      if (LOADER_FN_RE.test(span.name)) {
        loadersChecked++;
        loaderTexts.push(pf.lines.slice(span.startLine - 1, span.endLine).join('\n'));
      }
    }
    // Also capture z.object({...}) schemas
    for (const m of pf.stripped.matchAll(/z\.object\s*\(\s*\{([\s\S]*?)\}\s*\)/g)) {
      loadersChecked++;
      loaderTexts.push(m[1]!);
    }
  }

  if (loadersChecked === 0) return [];
  const combinedLoaders = loaderTexts.join('\n');

  type KeyWrite = { file: string; line: number; fn: string; lang: SupportedLanguage };
  const writesByKey = new Map<string, KeyWrite[]>();

  for (const pf of prodFiles) {
    if (!PERSIST_FILE_RE.test(pf.stripped)) continue;
    const { rel, language } = pf.file;
    for (const span of pf.spans) {
      const bodyLines = pf.lines.slice(span.startLine - 1, span.endLine);
      const body = bodyLines.join('\n');
      if (!WRITER_FN_RE.test(span.name) && !PERSIST_FILE_RE.test(body)) continue;
      if (LOADER_FN_RE.test(span.name)) continue;

      for (let offset = 0; offset < bodyLines.length; offset++) {
        const line = bodyLines[offset]!;
        const lineNum = span.startLine + offset;
        // 'key': value or "key": value
        for (const m of line.matchAll(/(['"])([a-z][a-z0-9_]{1,40})\1\s*:/g)) {
          const key = m[2]!;
          let list = writesByKey.get(key);
          if (!list) {
            list = [];
            writesByKey.set(key, list);
          }
          list.push({ file: rel, line: lineNum, fn: span.name, lang: language });
        }
        // record['key'] = ...
        for (const m of line.matchAll(/\[(['"])([a-z][a-z0-9_]{1,40})\1\]\s*(?<![=!<>])=(?![=>])/g)) {
          const key = m[2]!;
          let list = writesByKey.get(key);
          if (!list) {
            list = [];
            writesByKey.set(key, list);
          }
          list.push({ file: rel, line: lineNum, fn: span.name, lang: language });
        }
        // TS object literal keys inside a persistence block: { key: value }
        if (language === 'ts_js') {
          for (const m of line.matchAll(/^\s*([a-z][A-Za-z0-9_]{1,40})\s*:\s*[^=]/g)) {
            const key = m[1]!;
            if (['return', 'case', 'default', 'const', 'let', 'var'].includes(key)) continue;
            let list = writesByKey.get(key);
            if (!list) {
              list = [];
              writesByKey.set(key, list);
            }
            list.push({ file: rel, line: lineNum, fn: span.name, lang: language });
          }
        }
      }
    }
  }

  const candidates: StateMachineCandidate[] = [];
  for (const [key, sites] of writesByKey) {
    const keyRe = new RegExp(`(?:['"]${key}['"]|\\.${key}\\b|\\b${key}\\s*:)`);
    if (keyRe.test(combinedLoaders)) continue;
    const languages = [...new Set(sites.map(s => s.lang))].sort() as SupportedLanguage[];
    candidates.push({
      signal: 'write-decode-gap',
      subject: key,
      languages,
      sites: sites.map(s => ({ file: s.file, line: s.line, function: s.fn })),
      facts: { key, loaders_checked: loadersChecked },
    });
  }
  return candidates;
}

const FILE_PROBE_RE =
  /\b(?:existsSync|readFileSync|statSync|accessSync|exists|isfile|read_text|open)\s*\(/;
const STATE_FILENAME_RE =
  /['"`]([^'"`\n]*?(?:state|status|checkpoint|marker|lock|phase|stage|progress|done|ready|pending|error|cursor|handoff|receipt|flag)[^'"`\n]*?\.(?:json|ya?ml|txt|lock|state|status|flag|done|marker|pid)|[^'"`\n]+\.(?:lock|state|status|flag|done|marker|pid))['"`]/gi;
const BRANCH_RE = /\b(?:if|elif|switch)\b|\?/;

function detectCrossFileInferredState(parsedFiles: ParsedFile[], limits: ScannerLimits): StateMachineCandidate[] {
  const candidates: StateMachineCandidate[] = [];

  for (const pf of parsedFiles) {
    if (pf.file.isTest) continue;
    const { rel, language } = pf.file;
    for (const span of pf.spans) {
      const bodyLines = pf.lines.slice(span.startLine - 1, span.endLine);
      const body = bodyLines.join('\n');
      if (!FILE_PROBE_RE.test(body) || !BRANCH_RE.test(body)) continue;

      const filesFound = new Map<string, number>();
      for (let offset = 0; offset < bodyLines.length; offset++) {
        const line = bodyLines[offset]!;
        for (const m of line.matchAll(STATE_FILENAME_RE)) {
          const fname = m[1]!;
          if (!filesFound.has(fname)) filesFound.set(fname, span.startLine + offset);
        }
      }
      if (filesFound.size >= limits.minStateFilesPerFunction) {
        const sortedFiles = [...filesFound.keys()].sort();
        candidates.push({
          signal: 'cross-file-inferred-state',
          subject: `${rel}:${span.name}`,
          languages: [language],
          sites: sortedFiles.map(f => ({ file: rel, line: filesFound.get(f)!, function: span.name, detail: f })),
          facts: { function: span.name, state_files: sortedFiles },
        });
      }
    }
  }
  return candidates;
}

function detectCounterThresholds(parsedFiles: ParsedFile[], limits: ScannerLimits): StateMachineCandidate[] {
  type ThreshSite = { file: string; line: number; fn: string; threshold: string; lang: SupportedLanguage };
  const byCounter = new Map<string, ThreshSite[]>();

  for (const pf of parsedFiles) {
    if (pf.file.isTest) continue;
    if (POLICY_TABLE_RE.test(pf.stripped)) continue;
    const { rel, language } = pf.file;

    for (let i = 0; i < pf.lines.length; i++) {
      const line = pf.lines[i]!;
      const lineNum = i + 1;
      if (!/\b(?:if|elif|while|return)\b|\?/.test(line)) continue;
      const fn = functionAtLine(pf.spans, lineNum);

      for (const m of line.matchAll(
        /(?:\b[A-Za-z_$][\w$]*\.)?([A-Za-z_$][\w$]*)\s*(>=|<=|>|<|===|==)\s*(\d+)\b/g,
      )) {
        const ident = m[1]!;
        if (!COUNTER_IDENT_RE.test(ident)) continue;
        let list = byCounter.get(ident);
        if (!list) {
          list = [];
          byCounter.set(ident, list);
        }
        list.push({ file: rel, line: lineNum, fn, threshold: `${m[2]!} ${m[3]!}`, lang: language });
      }
    }
  }

  const candidates: StateMachineCandidate[] = [];
  for (const [counter, sites] of byCounter) {
    if (sites.length < limits.minThresholdBranches) continue;
    const languages = [...new Set(sites.map(s => s.lang))].sort() as SupportedLanguage[];
    candidates.push({
      signal: 'counter-thresholds',
      subject: counter,
      languages,
      sites: sites.map(s => ({ file: s.file, line: s.line, function: s.fn, detail: s.threshold })),
      facts: {
        counter,
        thresholds: [...new Set(sites.map(s => s.threshold))].sort(),
        site_count: sites.length,
      },
    });
  }
  return candidates;
}

function hasParityTest(pyVocab: VocabDecl, tsVocab: VocabDecl, testFiles: ParsedFile[]): boolean {
  const pyBase = posix.basename(pyVocab.file).replace(/\.[^.]+$/, '');
  const tsBase = posix.basename(tsVocab.file).replace(/\.[^.]+$/, '');
  for (const tf of testFiles) {
    const src = tf.file.source;
    const refsPy = src.includes(pyVocab.file) || src.includes(pyVocab.name) || src.includes(pyBase);
    const refsTs = src.includes(tsVocab.file) || src.includes(tsVocab.name) || src.includes(tsBase);
    if (refsPy && refsTs) return true;
  }
  return false;
}

function detectCrossLanguageEnumDrift(parsedFiles: ParsedFile[], limits: ScannerLimits): StateMachineCandidate[] {
  const prodFiles = parsedFiles.filter(pf => !pf.file.isTest);
  const testFiles = parsedFiles.filter(pf => pf.file.isTest);
  const pyVocabs = prodFiles.filter(pf => pf.file.language === 'python').flatMap(pf => pf.vocabs);
  const tsVocabs = prodFiles.filter(pf => pf.file.language === 'ts_js').flatMap(pf => pf.vocabs);

  const candidates: StateMachineCandidate[] = [];
  for (const py of pyVocabs) {
    if (py.tokens.size < limits.minSharedVocabTokens) continue;
    for (const ts of tsVocabs) {
      if (ts.tokens.size < limits.minSharedVocabTokens) continue;
      const shared = [...py.tokens].filter(t => ts.tokens.has(t)).sort();
      if (shared.length < limits.minSharedVocabTokens) continue;
      const unionSize = new Set([...py.tokens, ...ts.tokens]).size;
      const overlap = shared.length / unionSize;
      if (overlap < 0.5) continue;
      if (hasParityTest(py, ts, testFiles)) continue;

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
    const stripped = stripCommentsPreserveLines(file.source, file.language);
    const lines = stripped.split('\n');
    const spans = extractFunctionSpans(lines, file.language);
    const vocabs = file.isTest ? [] : extractVocabularies(file, lines);
    return { file, stripped, lines, spans, vocabs };
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

  allCandidates.sort((a, b) => {
    if (a.signal !== b.signal) return a.signal.localeCompare(b.signal);
    if (a.subject !== b.subject) return a.subject.localeCompare(b.subject);
    const aSite = a.sites[0];
    const bSite = b.sites[0];
    if (aSite && bSite) {
      if (aSite.file !== bSite.file) return aSite.file.localeCompare(bSite.file);
      return aSite.line - bSite.line;
    }
    return 0;
  });

  const truncated = allCandidates.length > limits.maxCandidates;
  const candidates = truncated ? allCandidates.slice(0, limits.maxCandidates) : allCandidates;

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
