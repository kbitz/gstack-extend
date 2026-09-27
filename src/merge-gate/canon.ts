import { createHash } from 'node:crypto';

/** Canonical JSON: sorted object keys, no whitespace, omitted undefined. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function sha256Hex(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sha256Canonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortValue);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    if (obj[key] === undefined) continue;
    out[key] = sortValue(obj[key]);
  }
  return out;
}
