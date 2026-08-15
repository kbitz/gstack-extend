import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runDrift, runTouchesCli } from '../src/audit/touches-cli.ts';

const ROADMAP = [
  '## Current Plan',
  '#### Group 1: A',
  '##### Track 1A: T',
  '_touches: src/a.ts_',
  '',
].join('\n');

function git(repo: string, args: string): void {
  execSync(`git ${args}`, { cwd: repo });
}

describe('runDrift — committed vs working tree', () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'gse-touches-'));
    git(repo, 'init -q -b main');
    git(repo, 'config user.email t@e.st');
    git(repo, 'config user.name test');
    mkdirSync(join(repo, 'docs'), { recursive: true });
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'docs/ROADMAP.md'), ROADMAP);
    writeFileSync(join(repo, 'src/a.ts'), 'a\n');
    git(repo, 'add .');
    git(repo, 'commit -qm base');
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  test('committed undeclared path on a clean feature branch is drift', () => {
    git(repo, 'checkout -q -b feat');
    writeFileSync(join(repo, 'src/secret.ts'), 'x\n');
    git(repo, 'add src/secret.ts');
    git(repo, 'commit -qm feat');
    const r = runDrift(repo, '1A');
    expect(r.ok).toBe(false);
    expect(r.text).toContain('src/secret.ts');
  });

  test('documented drift --track <id> [repo] does not steal the id as repoRoot', () => {
    const r = runTouchesCli(['drift', '--track', '1A', repo]);
    expect(r.ok).toBe(true);
    expect(r.text).toContain('DRIFT: pass');
  });

  test('TRACK_NOT_FOUND and missing --track are hard fails', () => {
    expect(runDrift(repo, '9Z').ok).toBe(false);
    expect(runTouchesCli(['drift']).ok).toBe(false);
  });

  test('directory with ROADMAP but no git fail-closes', () => {
    const bare = mkdtempSync(join(tmpdir(), 'gse-nogit-'));
    mkdirSync(join(bare, 'docs'), { recursive: true });
    writeFileSync(join(bare, 'docs/ROADMAP.md'), ROADMAP);
    try {
      const r = runDrift(bare, '1A');
      expect(r.ok).toBe(false);
      expect(r.text).toContain('NOT_A_REPO');
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
