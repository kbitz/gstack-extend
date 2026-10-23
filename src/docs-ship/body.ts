/**
 * body.ts — the PR body's `## Docs ship` receipt block and the body hash.
 *
 * The receipt sits between two markers. The recorded body SHA-256 covers the
 * body without that block (CRLF -> LF, whitespace around the block collapsed,
 * trailing whitespace trimmed), so anyone can recompute it from the final body.
 */
import { createHash } from 'node:crypto';
import { fencedLines } from './markdown.ts';

export const START = '<!-- docs-ship:receipt:start -->';
export const END = '<!-- docs-ship:receipt:end -->';
export const HEADING = '## Docs ship';

export class BodyError extends Error {
  constructor(public code: string, message: string, public fix: string) {
    super(message);
  }
}

type Split = { before: string; block?: string; after: string };

function split(body: string): Split {
  const text = body.replace(/\r\n/g, '\n');
  const fenced = fencedLines(text);
  const starts: number[] = [];
  const ends: number[] = [];
  let offset = 0;
  text.split('\n').forEach((line, i) => {
    if (!fenced.has(i + 1) && !/^( {4}|\t)/.test(line)) {
      const marker = line.trim();
      if (marker === START) starts.push(offset + line.indexOf(START));
      if (marker === END) ends.push(offset + line.indexOf(END));
    }
    offset += line.length + 1;
  });
  const start = starts[0] ?? -1;
  const end = ends[0] ?? -1;
  if (start === -1 && end === -1) return { before: text, after: '' };
  if (start === -1 || end === -1 || end < start) throw new BodyError('RECEIPT_MARKERS', 'the body has an unpaired docs-ship receipt marker', `restore both ${START} and ${END}, or remove both`);
  if (starts.length > 1 || ends.length > 1) throw new BodyError('RECEIPT_MARKERS', 'the body has more than one docs-ship receipt', 'keep one receipt block');
  return { before: text.slice(0, start), block: text.slice(start, end + END.length), after: text.slice(end + END.length) };
}

/** The body as the receipt binds it: receipt removed, line endings and edge whitespace normalized. */
export function reviewedBody(body: string): string {
  const s = split(body);
  const before = s.before.trimEnd();
  const after = s.after.replace(/^\s+/, '').trimEnd();
  return before && after ? `${before}\n\n${after}` : before || after;
}

export function bodyHash(body: string): string {
  return createHash('sha256').update(reviewedBody(body), 'utf8').digest('hex');
}

/** Receipt fields every docs-ship receipt carries; values checked against the body. */
export const REQUIRED_FIELDS = ['Verdict', 'Head', 'Base', 'Body SHA-256', 'Classification', 'Tests'] as const;

export function receiptField(receipt: string, field: string): string | undefined {
  const matches = [...receipt.matchAll(new RegExp(`^- \\*\\*${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\*\\*[ \\t]*(.*)$`, 'gm'))];
  const value = matches.length === 1 ? matches[0]![1]?.trim() : undefined;
  return value?.replace(/`/g, '').trim() ? value : undefined;
}

export function upsert(body: string, receipt: string): { body: string; hash: string } {
  const r = receipt.replace(/\r\n/g, '\n').trim();
  if (r.includes(START) || r.includes(END)) throw new BodyError('RECEIPT_INVALID', 'the receipt file must not contain the receipt markers', 'pass the receipt text only; docs-ship adds the markers');
  if (r.split('\n')[0] !== HEADING) throw new BodyError('RECEIPT_INVALID', `the receipt must start with "${HEADING}"`, 'use the template in docs/docs-ship.md#receipt');
  const missing = REQUIRED_FIELDS.filter((f) => receiptField(r, f) === undefined);
  if (missing.length) throw new BodyError('RECEIPT_INVALID', `the receipt is missing ${missing.join(', ')}`, 'use the template in docs/docs-ship.md#receipt');
  const value = (field: string) => receiptField(r, field)!.replace(/`/g, '');
  if (!/^(PASS|CHANGES|HANDED-BACK)$/.test(value('Verdict')) || !/^[0-9a-f]{40}$/.test(value('Head')) || !/\b[0-9a-f]{40}$/.test(value('Base'))) {
    throw new BodyError('RECEIPT_INVALID', 'the verdict or full head/base SHA is invalid', 'use the verified identities and verdict in docs/docs-ship.md#receipt');
  }
  const hash = bodyHash(body);
  const recorded = receiptField(r, 'Body SHA-256')!.replace(/`/g, '');
  if (recorded !== hash) throw new BodyError('BODY_HASH_MISMATCH', `the receipt records body SHA-256 ${recorded}, but the body hashes to ${hash}`, 'recompute it with docs-ship hash after the last body edit');
  const block = `${START}\n${r}\n${END}`;
  const s = split(body);
  const next = s.block === undefined ? `${s.before.trimEnd()}${s.before.trim() ? '\n\n' : ''}${block}\n` : `${s.before}${block}${s.after}`;
  if (bodyHash(next) !== hash) throw new BodyError('INTERNAL', 'writing the receipt changed the reviewed body', 'report this with the body you passed');
  return { body: next, hash };
}
