import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runIdCli } from '../src/audit/id-cli.ts';
import {
  WORK_ITEM_ID_CONTRACT,
  WORK_ITEM_ID_PREFIX,
  WORK_ITEM_ID_RE,
  extractInlineBulletId,
  isValidWorkItemId,
  mintRandomId,
  parseTodoIdBullet,
  parseTrackIdLine,
  scanAllWorkItemIds,
} from '../src/audit/lib/work-item-id.ts';
import { parseRoadmap } from '../src/audit/parsers/roadmap.ts';
import { parseTodos } from '../src/audit/parsers/todos.ts';

const REPO_ROOT = resolve(import.meta.dir, '..');
const BIN = join(REPO_ROOT, 'bin', 'roadmap-id');
const BASE_TMP = mkdtempSync(join(tmpdir(), 'roadmap-id-test-'));

afterAll(() => {
  rmSync(BASE_TMP, { recursive: true, force: true });
});

function freshDir(prefix: string): string {
  return mkdtempSync(join(BASE_TMP, `${prefix}-`));
}

describe('work-item-id library', () => {
  test('validates work-item IDs strictly', () => {
    expect(WORK_ITEM_ID_CONTRACT).toBe('work-item-id/v1');
    expect(WORK_ITEM_ID_PREFIX).toBe('wi-');
    expect(isValidWorkItemId('wi-a1b2')).toBe(true);
    expect(isValidWorkItemId('wi-a1b2c3')).toBe(true);
    expect(isValidWorkItemId('wi-01234567')).toBe(true);
    expect(isValidWorkItemId('wi-123')).toBe(false);
    expect(isValidWorkItemId('wi-012345678')).toBe(false);
    expect(isValidWorkItemId('wi-ABCDEF')).toBe(false);
    expect(isValidWorkItemId('wi-a1b2c!')).toBe(false);
    expect(isValidWorkItemId('96A')).toBe(false);
    expect(isValidWorkItemId('')).toBe(false);
  });

  test('parses TODO, Track, and inline bullet IDs', () => {
    expect(parseTodoIdBullet('- **ID:** wi-a1b2c3')).toEqual({ raw: 'wi-a1b2c3', id: 'wi-a1b2c3' });
    expect(parseTodoIdBullet('- **ID:** wi-BAD!')).toEqual({ raw: 'wi-BAD!', id: null });
    expect(parseTodoIdBullet('- **Why:** something')).toBeNull();

    expect(parseTrackIdLine('_id: wi-0123ab_')).toEqual({ raw: 'wi-0123ab', id: 'wi-0123ab' });
    expect(parseTrackIdLine('_id: wi-0123ab')).toEqual({ raw: 'wi-0123ab', id: null });
    expect(parseTrackIdLine('_id: wi-12_')).toEqual({ raw: 'wi-12', id: null });
    expect(parseTrackIdLine('_touches: src/a.ts_')).toBeNull();

    expect(extractInlineBulletId('- **Title** — **ID:** wi-a1b2c3 — body **Revisit when:** x')).toEqual({
      raw: 'wi-a1b2c3',
      id: 'wi-a1b2c3',
    });
    expect(extractInlineBulletId('- **Title** — body **Revisit when:** **ID:** wi-a1b2c3')).toBeNull();
    expect(extractInlineBulletId('- **Title** — Shows `- **ID:** wi-a1b2c3` in an example.')).toBeNull();
    expect(extractInlineBulletId('- Plain title — **ID:** wi-a1b2c3 — **Revisit when:** x')?.id).toBe('wi-a1b2c3');
    expect(extractInlineBulletId('- **Title** — **ID:** wi-ZZZZ — body')).toEqual({
      raw: 'wi-ZZZZ',
      id: null,
    });
  });

  test('mintRandomId grows 6 -> 7 -> 8 hex on collision and draws fresh entropy after 8', () => {
    const entropy = 'a1b2c3d4e5f60718';
    const taken = new Set<string>();
    expect(mintRandomId(taken, entropy)).toBe('wi-a1b2c3');
    taken.add('wi-a1b2c3');
    expect(mintRandomId(taken, entropy)).toBe('wi-a1b2c3d');
    taken.add('wi-a1b2c3d');
    expect(mintRandomId(taken, entropy)).toBe('wi-a1b2c3d4');
    taken.add('wi-a1b2c3d4');
    const fresh = mintRandomId(taken, entropy);
    expect(WORK_ITEM_ID_RE.test(fresh)).toBe(true);
    expect(taken.has(fresh)).toBe(false);
  });

  test('scanAllWorkItemIds finds unique sorted valid IDs', () => {
    expect(scanAllWorkItemIds('wi-ffff00 wi-0000aa wi-ffff00 wi-12 wi-ZZZZ')).toEqual([
      'wi-0000aa',
      'wi-ffff00',
    ]);
  });

  test('an inline code example is not an ID field on a Future bullet', () => {
    expect(extractInlineBulletId('- Document the format `Example — **ID:** wi-aabbcc`')).toBeNull();
    expect(extractInlineBulletId('- **Read** — **ID:** wi-a1b2c3 — `Example — **ID:** wi-aabbcc`')).toEqual({
      raw: 'wi-a1b2c3', id: 'wi-a1b2c3',
    });
  });

  test('an inline code span in a Future title leaves its assigned ID intact', () => {
    const bullet = '- **Document `**ID:**` in recipes** — **ID:** wi-aabbcc — Keep examples. **Revisit when:** next release';
    expect(extractInlineBulletId(bullet)).toEqual({ raw: 'wi-aabbcc', id: 'wi-aabbcc' });
  });

  test('a Future title ending in italic emphasis retains its assigned ID', () => {
    const bullet = '- **Read *this*** — **ID:** wi-aabbcc — Keep context. **Revisit when:** next release';
    expect(extractInlineBulletId(bullet)?.id).toBe('wi-aabbcc');
  });

  test('a leading field after a plain or partly bold Future title stays assigned', () => {
    for (const title of ['Plain title', '**One** and **Two**', '**Title** (follow-up)']) {
      const bullet = '- ' + title + ' — **ID:** wi-aabbcc — Keep context.';
      expect(extractInlineBulletId(bullet)?.id).toBe('wi-aabbcc');
    }
  });

  test('code spans and inline attribute prose leave later Future records visible', () => {
    const bullet = '- **Entry** — Text mentions — **ID:** as a label here. **Revisit when:** ready.';
    const markdown = ['## Future', '```code``` explains the entry below.', bullet].join('\n');
    expect(parseRoadmap(markdown).value.futureBullets).toEqual([bullet]);
    expect(extractInlineBulletId(bullet)).toBeNull();
  });

  test('a Track note stays prose in the active plan and an archive bullet carries its ID', () => {
    const active = [
      '## Current Plan', '```markdown', '## Shipped', '```',
      '### Group 1: Current', '- Track 1A — wait for the owner review.',
      '#### Track 1A: First', '_1 task . low risk_', '_id: wi-aabbcc_', '_touches: src/first.ts_', '',
    ].join('\n');
    const parsed = parseRoadmap(active).value;
    expect(parsed.legacyShippedTracks).toEqual([]);
    expect(parsed.tracks[0]?.state).toBe('current-plan');
    expect(parsed.tracks[0]?.isComplete).toBe(false);

    const archive = '## Group 2: History\n- Track 2A — **ID:** wi-aabbdd — Shipped.\n';
    expect(parseRoadmap(archive, { fromShippedArchive: true }).value.legacyShippedTracks?.[0]?.workItemId)
      .toBe('wi-aabbdd');
  });

  test('TODO audit keeps checklist and link bullets with their heading', () => {
    const withNotes = [
      '## Unprocessed', '### [manual] Follow-up', '- [ ] Take a note',
      '- [Spec](docs/SPEC.md)', '- **[Guide](docs/guide.md)**', '- **ID:** wi-aabbcc', '',
    ].join('\n');
    const entries = parseTodos(withNotes).value.entries;
    expect(entries.map(entry => [entry.kind, entry.workItemId])).toEqual([['heading', 'wi-aabbcc']]);
  });

  test.each([
    { label: 'heading needs an ID', ownId: '' },
    { label: 'heading already has an ID', ownId: 'wi-aabbcc' },
  ])('Completed legacy records keep their IDs separate ($label)', ({ ownId }) => {
    const markdown = [
      '## Completed', '### Completed heading', ...(ownId === '' ? [] : ['- **ID:** ' + ownId]),
      '- [manual] Earlier legacy entry', '- **ID:** wi-112233', '',
    ].join('\n');
    const result = parseTodos(markdown).value;
    expect(result.completedIds).toEqual(ownId === '' ? ['wi-112233'] : [ownId, 'wi-112233']);
    expect(result.completedEntries![0]!.workItemId).toBe(ownId || null);
    expect(result.completedEntries![0]!.workItemIdError).toBeNull();
  });
});

describe('bin/roadmap-id CLI', () => {
  test('mints a batch alongside the current planning documents without editing them', () => {
    const repo = freshDir('mint');
    mkdirSync(join(repo, 'docs'), { recursive: true });
    const documents = [
      ['ROADMAP.md', '## Current Plan\n### Group 1: Work\n#### Track 1A: First\n_id: wi-aabbcc_\n', 'wi-aabbcc'],
      ['docs/TODOS.md', '## Unprocessed\n### [manual] Entry\n- **ID:** wi-112233\n', 'wi-112233'],
      ['docs/roadmap-future.md', '## Future\n- **Deferred** — **ID:** wi-ddeeff — body\n', 'wi-ddeeff'],
      ['docs/roadmap-shipped.md', '## Shipped\n### Track 1A: Past ✓ Shipped\n_id: wi-445566_\n', 'wi-445566'],
    ] as const;
    for (const [path, markdown] of documents) {
      writeFileSync(join(repo, path), markdown);
    }

    const result = spawnSync('/bin/sh', [BIN, 'mint', repo, '--count', '5'], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const ids = result.stdout.trim().split('\n');
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    for (const id of ids) {
      expect(id).toMatch(/^wi-[0-9a-f]{6,8}$/);
    }
    for (const [path, markdown, id] of documents) {
      expect(ids).not.toContain(id);
      expect(readFileSync(join(repo, path), 'utf8')).toBe(markdown);
    }
  });

  test('--help, -h, and invalid arguments', () => {
    for (const flag of ['--help', '-h']) {
      const r = runIdCli([flag]);
      expect(r.exitCode).toBe(0);
      expect(r.stderr).toBe('');
      expect(r.stdout).toContain('Usage: roadmap-id');
    }

    expect(runIdCli([]).exitCode).toBe(2);
    expect(runIdCli(['bogus']).exitCode).toBe(2);
    expect(runIdCli(['mint', '--count', '0']).exitCode).toBe(2);
    expect(runIdCli(['mint', '--count', 'abc']).exitCode).toBe(2);
    expect(runIdCli(['mint', '--count', '999999999999999999999999']).exitCode).toBe(2);
    expect(runIdCli(['migrate']).exitCode).toBe(2);
  });
});
