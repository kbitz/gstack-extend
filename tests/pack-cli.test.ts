import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runPackCli } from '../src/audit/pack-cli.ts';

const DRAFT = [
  '## Current Plan',
  '##### Track 1A: First',
  '_touches: src/a.ts_',
  '- **Do a** -- body (S)',
  '##### Track 2A: Second',
  '_touches: src/b.ts_',
  '_blocked-by: Track 1A_',
  '- **Do b** -- body (S)',
  '',
].join('\n');

const SHIPPED_HEADINGS = [
  '## Shipped',
  '##### Track 1A: Done ✓ Shipped (v0.1.0.0)',
  '',
].join('\n');

describe('runPackCli', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gse-pack-cli-'));
    mkdirSync(join(dir, 'docs'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('--from packs a draft and skips the live shipped archive', () => {
    writeFileSync(join(dir, 'docs/ROADMAP.md'), SHIPPED_HEADINGS);
    writeFileSync(join(dir, 'docs/roadmap-shipped.md'), SHIPPED_HEADINGS);
    const draft = join(dir, 'draft.md');
    writeFileSync(draft, DRAFT);
    const out = runPackCli(['--from', draft, dir]);
    expect(out).toContain('BINS:');
    expect(out).toContain('1A');
    expect(out).toContain('2A');
    expect(out).toContain('_Depends on: Group <bin 1>_');
    expect(out).not.toContain('BINS: EMPTY');
  });

  test('--stdin packs the same draft', () => {
    writeFileSync(join(dir, 'docs/ROADMAP.md'), SHIPPED_HEADINGS);
    const out = runPackCli(['--stdin', dir], DRAFT);
    expect(out).toContain('1A');
    expect(out).toContain('2A');
  });

  test('emptyHint when headings exist but 0 unshipped', () => {
    writeFileSync(join(dir, 'docs/ROADMAP.md'), SHIPPED_HEADINGS);
    const out = runPackCli([dir]);
    expect(out).toContain('BINS: EMPTY');
    expect(out).toContain('Track heading');
  });

  test('--materialize prints implicit previous-Group edges then bins', () => {
    const live = [
      '## Current Plan',
      '### Group 1: First',
      '##### Track 1A: A',
      '_touches: src/a.ts_',
      '- **Do a** -- body (S)',
      '### Group 2: Second',
      '##### Track 2A: B',
      '_touches: src/b.ts_',
      '- **Do b** -- body (S)',
      '',
    ].join('\n');
    writeFileSync(join(dir, 'docs/ROADMAP.md'), live);
    const out = runPackCli(['--materialize', dir]);
    expect(out).toContain('MATERIALIZE');
    expect(out).toContain('Group 2');
    expect(out).toContain('BINS:');
  });
});
