/**
 * check.ts — mechanical checks on the PR's added lines in changed Markdown:
 * relative links and #anchors must resolve at head; claims (SHAs, hashes,
 * PR/issue numbers, IDs, versions, dates, numbers, quotations) are listed for
 * the reviewer. Only two claim kinds are decided here: a SHA that names no
 * commit in this repository, and a quotation that nearly matches a brief
 * passage without matching it verbatim. Everything else stays a checklist.
 */
import { lookupCommit, normalizePath, objectType, readAt, hunks, type Change, type Git } from './git.ts';
import { anchors, fencedLines, isExternal, linkTargets, maskInlineCode, MARKDOWN_EXT } from './markdown.ts';

export type Finding = { file: string; line: number; kind: string; message: string; fix: string };
export type Claim = { file: string; line: number; kind: string; value: string; status: string; detail?: string };
export type CheckResult = { findings: Finding[]; claims: Claim[]; links: number };

const MAX_VALUE = 160;
const clip = (s: string) => (s.length > MAX_VALUE ? `${s.slice(0, MAX_VALUE - 1)}…` : s);

// ---------- links ----------

function checkLink(git: Git, head: string, file: string, line: number, raw: string, findings: Finding[], anchorCache: Map<string, Set<string> | undefined>): boolean {
  if (isExternal(raw) || raw === '') return false;
  const hash = raw.indexOf('#');
  const pathPart = hash === -1 ? raw : raw.slice(0, hash);
  const anchor = hash === -1 ? undefined : raw.slice(hash + 1);
  let decoded = pathPart;
  try {
    decoded = decodeURIComponent(pathPart.split('?')[0]!);
  } catch {
    // keep the raw path; resolution below reports it if it is wrong
  }
  const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
  const target = decoded === '' ? file : normalizePath(dir, decoded);
  if (target === undefined) {
    findings.push({ file, line, kind: 'link', message: `link ${raw} leaves the repository`, fix: 'point it at a file inside the repository or use a full URL' });
    return true;
  }
  const type = target === '' ? 'tree' : objectType(git, head, target);
  if (type === undefined) {
    findings.push({ file, line, kind: 'link', message: `link target ${target} does not exist at head`, fix: 'correct the path or add the file' });
    return true;
  }
  if (anchor === undefined || anchor === '') return true;
  if (type !== 'blob' || !MARKDOWN_EXT.test(target)) return true;
  if (!anchorCache.has(target)) {
    const text = readAt(git, head, target);
    anchorCache.set(target, text === undefined ? undefined : anchors(text));
  }
  const set = anchorCache.get(target);
  let want = anchor;
  try {
    want = decodeURIComponent(anchor);
  } catch {
    // compare the raw fragment
  }
  if (set && !set.has(want) && !set.has(want.toLowerCase())) {
    findings.push({ file, line, kind: 'anchor', message: `${target} has no heading for #${anchor}`, fix: 'use an existing heading anchor or restore the heading' });
  }
  return true;
}

// ---------- quotations ----------

type Token = { word: string; start: number; end: number };

const TYPOGRAPHIC: Record<string, string> = { '‘': "'", '’': "'", '“': '"', '”': '"' };
export const normalizeQuote = (s: string) => s.normalize('NFC').replace(/[‘’“”]/g, (c) => TYPOGRAPHIC[c]!).replace(/\s+/g, ' ').trim();

function tokens(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)) out.push({ word: m[0].toLowerCase().replace(/’/g, "'"), start: m.index!, end: m.index! + m[0].length });
  return out;
}

function lcs(a: string[], b: string[]): number {
  const prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]!;
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(prev[j]!, prev[j - 1]!);
      diag = up;
    }
  }
  return prev[b.length]!;
}

/** The brief passage closest to the quotation, when similar enough to be a misquote. */
export function nearestPassage(quote: string, brief: string): { text: string; score: number } | undefined {
  const q = tokens(quote).map((t) => t.word);
  if (q.length < 3 || q.length > 128) return undefined;
  const b = tokens(brief);
  if (b.length > 25000) return undefined;
  let cells = 0;
  const words = new Set(q);
  let best: { text: string; score: number } | undefined;
  for (let i = 0; i < b.length; i++) {
    if (!words.has(b[i]!.word)) continue;
    for (let len = Math.max(1, q.length - 2); len <= q.length + 2 && i + len <= b.length; len++) {
      // Budget the quadratic work. Exhaustion leaves the claim unconfirmed.
      cells += q.length * len;
      if (cells > 1000000) return undefined;
      const window = b.slice(i, i + len);
      const score = lcs(q, window.map((t) => t.word)) / Math.max(q.length, len);
      if (!best || score > best.score) best = { text: brief.slice(window[0]!.start, window[len - 1]!.end), score };
    }
  }
  return best && best.score >= 0.6 ? best : undefined;
}

function quoteClaim(file: string, line: number, quote: string, briefs: string[], findings: Finding[], claims: Claim[]): void {
  const value = clip(quote);
  if (briefs.length === 0) {
    claims.push({ file, line, kind: 'quote', value, status: 'unconfirmed', detail: 'no brief given' });
    return;
  }
  const norm = normalizeQuote(quote);
  if (briefs.some((b) => normalizeQuote(b).includes(norm))) {
    claims.push({ file, line, kind: 'quote', value, status: 'confirmed', detail: 'verbatim in the brief' });
    return;
  }
  const near = briefs.map((b) => nearestPassage(quote, b)).filter((n) => n !== undefined).sort((x, y) => y!.score - x!.score)[0];
  if (near) {
    const verbatim = normalizeQuote(near.text);
    claims.push({ file, line, kind: 'quote', value, status: 'misquote', detail: `brief has: ${clip(verbatim)}` });
    findings.push({ file, line, kind: 'quote', message: `quotation does not match the brief verbatim: "${clip(norm)}"`, fix: `quote the brief exactly: "${clip(verbatim)}"` });
    return;
  }
  claims.push({ file, line, kind: 'quote', value, status: 'unconfirmed', detail: 'no confirmed match; confirm its source' });
}

function quotesOn(masked: string): string[] {
  const out: string[] = [];
  for (const m of masked.matchAll(/"([^"\n]+)"|“([^”\n]+)”/g)) {
    const text = (m[1] ?? m[2] ?? '').trim();
    if (tokens(text).length >= 3) out.push(text);
  }
  return out;
}

// ---------- other claims ----------

const SHA = /(?<![\w#.-])[0-9a-f]{7,64}(?![\w-])/g;
const PR = /(?<![\w&])(?:#|PR\s*#?|pull\/|issues\/)(\d{1,7})\b/gi;
const ID = /\b(?:Track|Group|Phase)\s+\d+[A-Z]?\b|\b(?!(?:SHA|UTF|ISO|UTC|GMT|HTTP)-)[A-Z][A-Z0-9]{1,9}-\d+\b/g;
const VERSION = /(?<![\w.])v?\d+\.\d+\.\d+(?:\.\d+)?(?![\w.]*\d)/g;
const DATE = /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?\b/g;
const NUMBER = /(?<![\w.#/:-])\d+(?:[.,]\d+)*(?:%|[a-zA-Z]{1,3}\b)?/g;

/**
 * SHAs, versions, PR numbers, IDs and dates are read from the raw line (inline
 * code often holds them); bare numbers only from prose, with code masked.
 * Link URLs are blanked first; `raw` and `masked` keep equal lengths.
 */
function otherClaims(git: Git, file: string, line: number, raw: string, masked: string, findings: Finding[], claims: Claim[]): void {
  const blankUrls = (s: string) => s.replace(/\]\([^)]*\)/g, (m) => ' '.repeat(m.length));
  let rest = blankUrls(raw);
  let prose = blankUrls(masked);
  const blank = (s: string, at: number, len: number) => s.slice(0, at) + ' '.repeat(len) + s.slice(at + len);
  const take = (re: RegExp, kind: string, onEach?: (v: string) => void) => {
    for (const m of [...rest.matchAll(re)]) {
      if (onEach) onEach(m[0]);
      else claims.push({ file, line, kind, value: m[0].trim(), status: 'check' });
      rest = blank(rest, m.index!, m[0].length);
      prose = blank(prose, m.index!, m[0].length);
    }
  };
  take(DATE, 'date');
  take(SHA, 'sha', (v) => {
    if (!/[0-9]/.test(v) || !/[a-f]/.test(v)) return;
    if (v.length === 64) {
      claims.push({ file, line, kind: 'hash', value: v, status: 'check' });
      return;
    }
    if (v.length > 40) return;
    const found = lookupCommit(git, v);
    if (found.ok) {
      claims.push({ file, line, kind: 'sha', value: v, status: 'exists', detail: found.detail });
    } else {
      claims.push({ file, line, kind: 'sha', value: v, status: found.reason });
      findings.push({ file, line, kind: 'sha', message: `${v} is ${found.reason === 'ambiguous' ? 'an ambiguous prefix' : 'not a commit'} in this repository`, fix: found.reason === 'ambiguous' ? 'use a longer SHA' : 'use the SHA of the commit the text cites (git log), or verify it in the repository it names' });
    }
  });
  take(VERSION, 'version');
  take(PR, 'pr');
  take(ID, 'id');
  const listMarker = /^\s*\d+[.)]\s/.exec(prose);
  if (listMarker) prose = ' '.repeat(listMarker[0].length) + prose.slice(listMarker[0].length);
  const numbers = [...prose.matchAll(NUMBER)].map((m) => m[0]);
  if (numbers.length) claims.push({ file, line, kind: 'numbers', value: clip(numbers.join(', ')), status: 'check' });
}

// ---------- driver ----------

export function check(git: Git, from: string, head: string, list: Change[], briefs: string[]): CheckResult {
  const findings: Finding[] = [];
  const claims: Claim[] = [];
  const anchorCache = new Map<string, Set<string> | undefined>();
  let links = 0;
  for (const change of list) {
    if (change.status === 'D' || !MARKDOWN_EXT.test(change.path)) continue;
    const text = readAt(git, head, change.path);
    if (text === undefined) continue;
    const fenced = fencedLines(text);
    const added = hunks(git, from, head, change.path).added;
    let block: { line: number; parts: string[] } | undefined;
    const flush = () => {
      if (block && tokens(block.parts.join(' ')).length >= 3) quoteClaim(change.path, block.line, block.parts.join(' '), briefs, findings, claims);
      block = undefined;
    };
    let prevLine = -1;
    for (const a of added) {
      const inFence = fenced.has(a.line);
      const masked = maskInlineCode(a.text);
      if (!inFence) {
        for (const l of linkTargets(a.text)) if (checkLink(git, head, change.path, a.line, l.target, findings, anchorCache)) links++;
        const bq = /^ {0,3}>\s?(.*)$/.exec(masked);
        if (bq) {
          if (!block || prevLine !== a.line - 1) {
            flush();
            block = { line: a.line, parts: [] };
          }
          block.parts.push(bq[1]!.trim());
        } else {
          flush();
          for (const q of quotesOn(masked)) quoteClaim(change.path, a.line, q, briefs, findings, claims);
        }
      } else {
        flush();
      }
      otherClaims(git, change.path, a.line, a.text, inFence ? ' '.repeat(a.text.length) : masked, findings, claims);
      prevLine = a.line;
    }
    flush();
  }
  return { findings, claims, links };
}
