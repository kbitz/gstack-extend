import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { quotaFixture, QUOTA_ROOT } from './helpers/quota-env';
import { scrubQuotaFixture } from '../scripts/scrub-quota-fixture';

test('fixture scrubber removes numeric identities and embedded credentials', () => {
  const scrubbed = JSON.stringify(scrubQuotaFixture({ owningUser: 345678901, conversationId: 'private-conversation',
    note: 'contact fixture@example.invalid crsr_0123456789abcdef', tokenUsage: { inputTokens: 7 } }));
  expect(scrubbed).not.toContain('345678901');
  expect(scrubbed).not.toContain('private-conversation');
  expect(scrubbed).not.toContain('fixture@example.invalid');
  expect(scrubbed).not.toContain('crsr_0123456789abcdef');
  expect(JSON.parse(scrubbed).tokenUsage.inputTokens).toBe(7);
});

test('quota contract and failure scenarios under an allowlisted environment', () => {
  const fixture = quotaFixture();
  try {
    expect(fixture.env.CURSOR_API_KEY).toBeUndefined();
    const result = spawnSync('/usr/bin/python3', ['-B', '-E', '-s', join(QUOTA_ROOT, 'tests/quota_cases.py')], {
      cwd: QUOTA_ROOT, env: fixture.env, encoding: 'utf8', timeout: 120_000,
    });
    if (result.status !== 0) console.error(result.stdout + result.stderr);
    expect(result.status).toBe(0);
  } finally { fixture.cleanup(); }
}, 130_000);

test('JSON failures, no real credentials, no default-state fixture writes', () => {
  const fixture = quotaFixture();
  try {
    for (const args of [['sample', '--phase', 'finish', '--session-id', 'absent'], ['sample', '--phase', 'start', '--session-id', '../bad'], ['summary', '--by', 'nonsense']]) {
      const result = fixture.run([...args, '--json']);
      expect(result.status).toBeGreaterThan(0);
      expect(JSON.parse(result.stdout).error).toBeDefined();
    }
    const leaked = fixture.run(['status', '--json'], { CURSOR_API_KEY: 'fixture-sentinel' });
    expect(JSON.parse(leaked.stdout).error.code).toBe('fixture_refused');
    const unsafe = fixture.run(['status', '--json'], { GSTACK_EXTEND_STATE_DIR: join(fixture.home, '.gstack-extend') });
    expect(JSON.parse(unsafe.stdout).error.code).toBe('fixture_refused');
  } finally { fixture.cleanup(); }
});
