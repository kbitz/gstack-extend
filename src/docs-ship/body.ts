/**
 * body.ts — the PR body's `## Docs ship` receipt block and the body hash.
 *
 * The receipt sits between two markers. The recorded body SHA-256 covers the
 * body without that block (CRLF -> LF, whitespace around the block collapsed,
 * trailing whitespace trimmed), so anyone can recompute it from the final body.
 */
import { createHash } from 'node:crypto';

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
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start === -1 && end === -1) return { before: text, after: '' };
  if (start === -1 || end === -1 || end < start) throw new BodyError('RECEIPT_MARKERS', 'the body has an unpaired docs-ship receipt marker', `restore both ${START} and ${END}, or remove both`);
  if (text.indexOf(START, start + 1) !== -1 || text.indexOf(END, end + 1) !== -1) throw new BodyError('RECEIPT_MARKERS', 'the body has more than one docs-ship receipt', 'keep one receipt block');
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
  const m = new RegExp(`^- \\*\\*${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\*\\*\\s*(.*)$`, 'm').exec(receipt);
  return m?.[1]?.trim();
}

export function upsert(body: string, receipt: string): { body: string; hash: string } {
  const r = receipt.replace(/\r\n/g, '\n').trim();
  if (r.includes(START) || r.includes(END)) throw new BodyError('RECEIPT_INVALID', 'the receipt file must not contain the receipt markers', 'pass the receipt text only; docs-ship adds the markers');
  if (!r.startsWith(HEADING)) throw new BodyError('RECEIPT_INVALID', `the receipt must start with "${HEADING}"`, 'use the template in docs/docs-ship.md#receipt');
  const missing = REQUIRED_FIELDS.filter((f) => receiptField(r, f) === undefined);
  if (missing.length) throw new BodyError('RECEIPT_INVALID', `the receipt is missing ${missing.join(', ')}`, 'use the template in docs/docs-ship.md#receipt');
  const hash = bodyHash(body);
  const recorded = receiptField(r, 'Body SHA-256')!.replace(/`/g, '');
  if (recorded !== hash) throw new BodyError('BODY_HASH_MISMATCH', `the receipt records body SHA-256 ${recorded}, but the body hashes to ${hash}`, 'recompute it with docs-ship hash after the last body edit');
  const block = `${START}\n${r}\n${END}`;
  const s = split(body);
  const next = s.block === undefined ? `${s.before.trimEnd()}${s.before.trim() ? '\n\n' : ''}${block}\n` : `${s.before}${block}${s.after}`;
  if (bodyHash(next) !== hash) throw new BodyError('INTERNAL', 'writing the receipt changed the reviewed body', 'report this with the body you passed');
  return { body: next, hash };
}
