#!/usr/bin/env bun
/** Pipe a foreground response here; never save the unsanitized input. */
import { createHash } from 'node:crypto';

export function scrubQuotaFixture(value: unknown, key = ''): unknown {
  const sensitive = /^(?:id|uuid|email|account_?id|accountId|organizationUuid|conversationId|owningUser|session_id|sessionId|agentId|requestId|serviceAccountId|subscriptionProductId|accessToken|access_token|refreshToken|refresh_token|apiKey|api_key|token|authorization|password|secret)$/i;
  if (sensitive.test(key) && value !== null) {
    return 'fixture-' + createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);
  }
  if (Array.isArray(value)) return value.map(item => scrubQuotaFixture(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, scrubQuotaFixture(item, name)]));
  }
  if (typeof value === 'string') {
    return value.replace(/eyJ[A-Za-z0-9_.-]{20,}/g, '<token>')
      .replace(/(?:crsr[_-]?|sk-|key_)[A-Za-z0-9_-]{10,}/g, '<key>')
      .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '<email>')
      .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, '<id>');
  }
  return value;
}

if (import.meta.main) {
  const input = await Bun.stdin.text();
  if (Buffer.byteLength(input) > 1024 * 1024) throw new Error('Quota response exceeds 1 MiB.');
  try { console.log(JSON.stringify(scrubQuotaFixture(JSON.parse(input)), null, 2)); }
  catch { console.error('Expected one JSON vendor response. No input was retained.'); process.exitCode = 1; }
}
