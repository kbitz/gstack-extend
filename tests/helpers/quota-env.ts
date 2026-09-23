import { mkdtempSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const QUOTA_ROOT = join(import.meta.dir, '../..');
export function quotaFixture() {
  const home = mkdtempSync(join(tmpdir(), 'quota-test-'));
  const fixtures = join(home, 'fixtures');
  cpSync(join(QUOTA_ROOT, 'tests/fixtures/quota'), fixtures, { recursive: true });
  for (const path of ['.claude/projects', '.codex/sessions', '.cursor/projects', '.grok/sessions', 'Library/Application Support/com.conductor.app/cursor-sdk-store', 'state', 'fixtures/bin']) {
    mkdirSync(join(home, path), { recursive: true });
  }
  // Explicit allowlist: never spread process.env into a quota test child.
  const env: Record<string, string> = {
    HOME: home, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8',
    GSTACK_EXTEND_STATE_DIR: join(home, 'state'), GSTACK_EXTEND_QUOTA_FIXTURES: fixtures,
    GSTACK_EXTEND_QUOTA_NOW: '2026-09-23T12:00:00Z',
  };
  if (process.env.EVALS_ALL === '1') env.EVALS_ALL = '1';
  return {
    home, fixtures, env,
    run(args: string[], overrides: Record<string, string> = {}) {
      return spawnSync(join(QUOTA_ROOT, 'bin/gstack-extend'), ['quota', ...args], {
        cwd: QUOTA_ROOT, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 20_000,
      });
    },
    cleanup() { rmSync(home, { recursive: true, force: true }); },
  };
}
