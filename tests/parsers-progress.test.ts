import { describe, expect, test } from 'bun:test';
import { parseProgress } from '../src/audit/parsers/progress.ts';

describe('parseProgress', () => {
  test('empty content', () => {
    const r = parseProgress('');
    expect(r.value.versions).toEqual([]);
    expect(r.value.latestVersion).toBeNull();
    expect(r.value.rawTableLines).toEqual([]);
  });

  test('single version cell', () => {
    const md = ['| Version | Date |', '|---------|------|', '| 0.1.0 | 2026-01-01 |'].join('\n');
    const r = parseProgress(md);
    expect(r.value.versions).toEqual(['0.1.0']);
    expect(r.value.latestVersion).toBe('0.1.0');
  });

  test('latestVersion is highest by semver, not table order', () => {
    const md = [
      '| Version |',
      '|---------|',
      '| 0.18.5 |',
      '| 0.2.0 |',
      '| 0.18.4 |',
      '| 0.5.0 |',
    ].join('\n');
    const r = parseProgress(md);
    expect(r.value.latestVersion).toBe('0.18.5');
  });

  test('4-component versions handled (gstack-extend MAJOR.MINOR.PATCH.MICRO)', () => {
    const md = [
      '| 0.18.4.0 |',
      '| 0.18.5.0 |',
      '| 0.18.4.99 |',
    ].join('\n');
    const r = parseProgress(md);
    expect(r.value.latestVersion).toBe('0.18.5.0');
  });

  test('rawTableLines captures every line starting with |', () => {
    const md = [
      '# PROGRESS',
      '',
      '| Version | Date |',
      '|---------|------|',
      '| 0.1.0 | 2026-01-01 |',
      '',
      'prose',
    ].join('\n');
    const r = parseProgress(md);
    expect(r.value.rawTableLines).toEqual([
      '| Version | Date |',
      '|---------|------|',
      '| 0.1.0 | 2026-01-01 |',
    ]);
  });

  test('version not in pipe-space format ignored', () => {
    // bash regex requires literal `| X.Y.Z |` — so plain text with versions
    // doesn't match.
    const md = '0.18.5 was the last version we shipped.';
    const r = parseProgress(md);
    expect(r.value.versions).toEqual([]);
    expect(r.value.latestVersion).toBeNull();
  });

  test('multiple version cells on one line', () => {
    const md = '| 0.1.0 | foo | 0.2.0 |';
    const r = parseProgress(md);
    expect(r.value.versions).toEqual(['0.1.0', '0.2.0']);
  });
});

describe('parseProgress — real PROGRESS.md', () => {
  test('parses without errors and finds a sensible latest version', async () => {
    const path = `${import.meta.dir}/../docs/PROGRESS.md`;
    const file = Bun.file(path);
    if (!(await file.exists())) {
      // PROGRESS.md may not exist in every checkout; skip cleanly.
      return;
    }
    const content = await file.text();
    const r = parseProgress(content);
    expect(r.errors).toEqual([]);
    if (r.value.versions.length > 0) {
      expect(r.value.latestVersion).not.toBeNull();
    }
  });
});
