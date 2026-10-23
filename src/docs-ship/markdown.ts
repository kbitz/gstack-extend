/**
 * markdown.ts — the small Markdown reading docs-ship needs: fenced-block
 * lines, inline-code masking, GitHub heading anchors and link targets.
 */

/** 1-based line numbers inside fenced code blocks, fence lines included. */
export function fencedLines(text: string): Set<number> {
  const inside = new Set<number>();
  let fence: { char: string; len: number } | undefined;
  text.split('\n').forEach((line, i) => {
    if (fence) {
      inside.add(i + 1);
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1]!.charAt(0) === fence.char && close[1]!.length >= fence.len) fence = undefined;
      return;
    }
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (m) {
      fence = { char: m[1]!.charAt(0), len: m[1]!.length };
      inside.add(i + 1);
    }
  });
  return inside;
}

/** Replace inline code spans with spaces so nothing inside them is read as a link or quote. */
export function maskInlineCode(line: string): string {
  return line.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (m) => ' '.repeat(m.length));
}

/** GitHub's heading anchor for the heading text (github-slugger rules, approximately). */
export function githubSlug(heading: string): string {
  const text = heading
    .replace(/<[^>]*>/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/`/g, '')
    .replace(/(^|[^\p{L}\p{N}])_+([^_]+?)_+(?=[^\p{L}\p{N}]|$)/gu, '$1$2');
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

/** Every anchor a Markdown file offers: heading slugs (with -1, -2 for repeats) and explicit HTML ids. */
export function anchors(text: string): Set<string> {
  const fenced = fencedLines(text);
  const lines = text.split('\n');
  const seen = new Map<string, number>();
  const out = new Set<string>();
  const add = (heading: string) => {
    const base = githubSlug(heading);
    let slug = base;
    let n = seen.get(base) ?? 0;
    while (seen.has(slug)) slug = `${base}-${++n}`;
    seen.set(base, n);
    seen.set(slug, 0);
    out.add(slug);
  };
  lines.forEach((line, i) => {
    if (fenced.has(i + 1)) return;
    const atx = /^ {0,3}#{1,6}(?:\s+(.*?))?\s*$/.exec(line);
    if (atx) {
      add((atx[1] ?? '').replace(/\s+#+\s*$/, '').replace(/^#+$/, ''));
    } else {
      const next = lines[i + 1];
      if (next !== undefined && !fenced.has(i + 2) && /^ {0,3}(=+|-+)\s*$/.test(next) && line.trim() !== '' && !/^ {0,3}([-*+]\s|>)/.test(line)) add(line.trim());
    }
    for (const m of line.matchAll(/<a\s[^>]*\b(?:id|name)\s*=\s*["']([^"']+)["']/gi)) out.add(m[1]!);
  });
  return out;
}

export type LinkRef = { target: string; column: number };

/** Index balanced pairs once so malformed links cannot repeatedly scan a suffix. */
function destinationPairs(text: string): Map<number, number> {
  const pairs = new Map<number, number>();
  const stack: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '\\' && i + 1 < text.length && /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/.test(text[i + 1]!)) i++;
    // Bare destinations cannot continue through whitespace, even inside a pair.
    else if (/\s/.test(char)) stack.length = 0;
    else if (char === '(') stack.push(i);
    else if (char === ')') {
      const opening = stack.pop();
      if (opening !== undefined) pairs.set(opening, i);
    }
  }
  return pairs;
}

/** Read a destination without treating escaped or balanced parentheses as link delimiters. */
function destination(text: string, start: number, pairs: Map<number, number>): { target: string; end: number } | undefined {
  const angle = text[start] === '<';
  const begin = start + (angle ? 1 : 0);
  let i = begin;
  for (; i < text.length; i++) {
    const char = text[i]!;
    if (char === '\\' && i + 1 < text.length && /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/.test(text[i + 1]!)) {
      i++;
      continue;
    }
    if (angle) {
      if (char === '>') break;
      if (char === '<') return undefined;
    } else {
      if (/\s/.test(char)) break;
      if (char === '(') {
        const close = pairs.get(i);
        if (close === undefined) return undefined;
        i = close;
      } else if (char === ')') break;
    }
  }
  if (angle && text[i] !== '>') return undefined;
  return { target: text.slice(begin, i).replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, '$1'), end: i + (angle ? 1 : 0) };
}

/** An inline destination may be followed by whitespace and a quoted/parenthesized title. */
function inlineEnd(text: string, start: number): number | undefined {
  let i = start;
  while (/\s/.test(text[i] ?? '') && i < text.length) i++;
  if (text[i] === ')') return i + 1;
  if (i === start || !['"', "'", '('].includes(text[i] ?? '')) return undefined;
  const close = text[i] === '(' ? ')' : text[i];
  for (i++; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === close) break;
  }
  if (i === text.length) return undefined;
  for (i++; i < text.length && /\s/.test(text[i]!); i++);
  return text[i] === ')' ? i + 1 : undefined;
}

/** Link targets on one line (inline, reference definitions, href/src attributes); inline code is masked first. */
export function linkTargets(line: string): LinkRef[] {
  const masked = maskInlineCode(line);
  const pairs = destinationPairs(masked);
  const out: LinkRef[] = [];
  const inline = /!?\[(?:[^\]\\]|\\.)*\]\(\s*/g;
  for (let m; (m = inline.exec(masked));) {
    const dest = destination(masked, inline.lastIndex, pairs);
    if (!dest) continue;
    const end = inlineEnd(masked, dest.end);
    if (end === undefined) continue;
    out.push({ target: dest.target, column: m.index + 1 });
    inline.lastIndex = end;
  }
  const def = /^ {0,3}\[[^\]]+\]:\s*/.exec(masked);
  if (def) {
    const dest = destination(masked, def[0].length, pairs);
    if (dest) out.push({ target: dest.target, column: 1 });
  }
  for (const m of masked.matchAll(/<(?:a|img)\s[^>]*\b(?:href|src)\s*=\s*"([^"]*)"/gi)) out.push({ target: m[1]!, column: m.index! + 1 });
  return out;
}

/** True for targets docs-ship does not resolve: URLs with a scheme and protocol-relative links. */
export function isExternal(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//');
}

export const MARKDOWN_EXT = /\.(md|markdown)$/i;
