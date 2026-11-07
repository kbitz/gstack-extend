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
    expect(out).toContain('FOLDER_ONLY');
    expect(out).toContain('- (none)');
  });

  test('prints FOLDER_ONLY pair when a draft has a folder Track and a file Track under it', () => {
    const draft = join(dir, 'folder-draft.md');
    writeFileSync(
      draft,
      [
        '## Current Plan',
        '##### Track 1A: Folder owner',
        '_touches: src/audit/_',
        '- **Do a** -- body (S)',
        '##### Track 1B: File owner',
        '_touches: src/audit/cli.ts_',
        '- **Do b** -- body (S)',
        '',
      ].join('\n'),
    );
    const out = runPackCli(['--from', draft, dir]);
    expect(out).toContain(
      'FOLDER_ONLY (collide only through a folder entry; name files where the code shows them, then re-pack):',
    );
    expect(out).toContain('- 1A ∥ 1B: src/audit/ ⊇ src/audit/cli.ts');
  });

  test('CLAUDE.md roadmap:shared_docs marker packs Tracks sharing listed doc into one bin', () => {
    const draft = join(dir, 'shared-docs-draft.md');
    writeFileSync(
      draft,
      [
        '## Current Plan',
        '##### Track 1A: First',
        '_touches: src/a.ts, docs/runbook.md_',
        '- **Do a** -- body (S)',
        '##### Track 1B: Second',
        '_touches: src/b.ts, docs/runbook.md_',
        '- **Do b** -- body (S)',
        '',
      ].join('\n'),
    );
    const withoutMarker = runPackCli(['--from', draft, dir]);
    expect(withoutMarker).toContain('- bin 1 layer=0 ← {} : 1A');
    expect(withoutMarker).toContain('- bin 2 layer=1 ← {1A} : 1B');

    writeFileSync(join(dir, 'CLAUDE.md'), '# Project\n<!-- roadmap:shared_docs=docs/runbook.md -->\n');
    const withMarker = runPackCli(['--from', draft, dir]);
    expect(withMarker).toContain('- bin 1 layer=0 ← {} : 1A 1B');
    expect(withMarker).not.toContain('- bin 2');
  });

  // The audit resolves CLAUDE.md as the root file whenever it is a regular file, else docs/CLAUDE.md;
  // the packer must read the same file, or it emits Groups that COLLISIONS and PACKING then fail.
  test('reads the CLAUDE.md the audit reads: an empty root file wins, a root directory falls back', () => {
    const draft = join(dir, 'shared-docs-draft.md');
    writeFileSync(
      draft,
      [
        '## Current Plan',
        '##### Track 1A: First',
        '_touches: src/a.ts, docs/runbook.md_',
        '- **Do a** -- body (S)',
        '##### Track 1B: Second',
        '_touches: src/b.ts, docs/runbook.md_',
        '- **Do b** -- body (S)',
        '',
      ].join('\n'),
    );
    writeFileSync(join(dir, 'docs', 'CLAUDE.md'), '# Docs\n<!-- roadmap:shared_docs=docs/runbook.md -->\n');

    writeFileSync(join(dir, 'CLAUDE.md'), '');
    const emptyRoot = runPackCli(['--from', draft, dir]);
    expect(emptyRoot).toContain('- bin 1 layer=0 ← {} : 1A');
    expect(emptyRoot).toContain('- bin 2 layer=1 ← {1A} : 1B');

    rmSync(join(dir, 'CLAUDE.md'));
    mkdirSync(join(dir, 'CLAUDE.md'));
    const dirRoot = runPackCli(['--from', draft, dir]);
    expect(dirRoot).toContain('- bin 1 layer=0 ← {} : 1A 1B');
    expect(dirRoot).not.toContain('- bin 2');
  });
});
