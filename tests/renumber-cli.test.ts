import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runRenumberCli } from '../src/audit/renumber-cli.ts';

describe('runRenumberCli', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gse-renumber-'));
    mkdirSync(join(dir, 'docs', 'designs'), { recursive: true });
    writeFileSync(
      join(dir, 'docs', 'ROADMAP.md'),
      ['## Current Plan', '#### Group 101: Wave', '##### Track 101A: First', '_blocked-by: Track 101B_'].join(
        '\n',
      ) + '\n',
    );
    writeFileSync(
      join(dir, 'docs', 'designs', 'track-101A.md'),
      'See Track 101A. split from the 2026-08-14 101B.\n',
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('--dry-run does not write', () => {
    const r = runRenumberCli(['--map', '101A=91A,101B=91B,101=91', '--dry-run', dir]);
    expect(r.ok).toBe(true);
    expect(r.text).toContain('WOULD_WRITE: docs/ROADMAP.md');
    expect(r.text).toContain('DRY_RUN:');
    expect(readFileSync(join(dir, 'docs', 'ROADMAP.md'), 'utf8')).toContain('Track 101A');
  });

  test('writes docs and skips dated-historical', () => {
    const r = runRenumberCli(['--map', '101A=91A,101B=91B,101=91', dir]);
    expect(r.ok).toBe(true);
    const roadmap = readFileSync(join(dir, 'docs', 'ROADMAP.md'), 'utf8');
    expect(roadmap).toContain('Group 91: Wave');
    expect(roadmap).toContain('Track 91A: First');
    expect(roadmap).toContain('_blocked-by: Track 91B_');
    const design = readFileSync(join(dir, 'docs', 'designs', 'track-101A.md'), 'utf8');
    expect(design).toContain('See Track 91A.');
    expect(design).toContain('split from the 2026-08-14 101B.');
    expect(r.text).toContain('SKIPPED_HISTORICAL:');
    expect(r.text).toMatch(/101B/);
  });

  test('usage when map missing', () => {
    const r = runRenumberCli([dir]);
    expect(r.ok).toBe(false);
    expect(r.text).toContain('usage:');
  });
});
