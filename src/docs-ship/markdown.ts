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
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n === 0 ? base : `${base}-${n}`);
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

/** Link targets on one line (inline, reference definitions, href/src attributes); inline code is masked first. */
export function linkTargets(line: string): LinkRef[] {
  const masked = maskInlineCode(line);
  const out: LinkRef[] = [];
  for (const m of masked.matchAll(/!?\[(?:[^\]\\]|\\.)*\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g)) {
    out.push({ target: m[1]!, column: m.index! + 1 });
  }
  const def = /^ {0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)/.exec(masked);
  if (def) out.push({ target: def[1]!, column: 1 });
  for (const m of masked.matchAll(/<(?:a|img)\s[^>]*\b(?:href|src)\s*=\s*"([^"]*)"/gi)) out.push({ target: m[1]!, column: m.index! + 1 });
  return out.map((l) => ({ ...l, target: l.target.replace(/^<|>$/g, '') }));
}

/** True for targets docs-ship does not resolve: URLs with a scheme and protocol-relative links. */
export function isExternal(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//');
}

export const MARKDOWN_EXT = /\.(md|markdown)$/i;
