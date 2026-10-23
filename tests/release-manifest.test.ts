/**
 * release-manifest.test.ts — the release and manifest checks.
 *
 * A release commit changes VERSION, the CHANGELOG entry and package.json's
 * version field. Diff selection runs this suite (plus the two telemetry
 * suites, which validate VERSION's format) for such a commit instead of the
 * whole suite, so it pins what those three files must agree on:
 *
 *   - VERSION matches the format the auto-tag workflow accepts;
 *   - package.json's version is VERSION's MAJOR.MINOR.PATCH;
 *   - CHANGELOG.md's first release heading is VERSION, and the release-notes
 *     extractor the workflow runs finds a non-empty section for it.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const VERSION = readFileSync(join(ROOT, 'VERSION'), 'utf8').trim();

describe('release and manifest checks', () => {
  test('VERSION matches the format the auto-tag workflow accepts', () => {
    const workflow = readFileSync(join(ROOT, '.github/workflows/auto-tag.yml'), 'utf8');
    const pattern = /grep -qE '([^']+)'/.exec(workflow)?.[1];
    expect(pattern).toBeDefined();
    expect(new RegExp(pattern!).test(VERSION)).toBe(true);
  });

  test("package.json's version is VERSION's MAJOR.MINOR.PATCH", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version?: unknown };
    expect(manifest.version).toBe(VERSION.split('.').slice(0, 3).join('.'));
  });

  test("CHANGELOG.md's first release is VERSION and the extractor finds its notes", () => {
    const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
    const first = /^## \[([^\]]+)\] - \d{4}-\d{2}-\d{2}$/m.exec(changelog)?.[1];
    expect(first).toBe(VERSION);
    const notes = spawnSync('bash', [join(ROOT, 'scripts/extract-changelog-section.sh'), VERSION], { cwd: ROOT, encoding: 'utf8' });
    expect(notes.status).toBe(0);
    expect(notes.stdout.trim().length).toBeGreaterThan(0);
  });
});
