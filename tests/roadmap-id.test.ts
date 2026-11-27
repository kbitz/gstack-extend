import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from './helpers/child-stdio.ts';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { collectTakenIds, runIdCli } from '../src/audit/id-cli.ts';
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
import { planWorkItemMigration } from '../src/audit/lib/work-item-migrate.ts';
import { parseRoadmap } from '../src/audit/parsers/roadmap.ts';
import { parseTodos } from '../src/audit/parsers/todos.ts';

import { GIT_ENV } from './helpers/fixture-repo.ts';

const REPO_ROOT = resolve(import.meta.dir, '..');
const BIN = join(REPO_ROOT, 'bin', 'roadmap-id');
const AUDIT_BIN = join(REPO_ROOT, 'bin', 'roadmap-audit');
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
    expect(runIdCli(['migrate', '--bogus']).exitCode).toBe(2);
    expect(runIdCli(['migrate', 'a', 'b']).exitCode).toBe(2);
  });
});

test('mint deterministically reserves IDs across root, docs and intake filenames and bodies', () => {
  const dir = freshDir('intake-reservation');
  const docs = join(dir, 'docs');
  mkdirSync(join(docs, 'todos'), { recursive: true });
  const expected = new Set<string>();
  const names = ['TODOS.md', 'ROADMAP.md', 'roadmap-future.md', 'roadmap-shipped.md'];
  for (const [i, path] of [...names, ...names.map(name => 'docs/' + name)].entries()) {
    const id = 'wi-00000' + i;
    writeFileSync(join(dir, path), id + '\n');
    expected.add(id);
  }
  expect(collectTakenIds(dir)).toEqual(expected);
  writeFileSync(join(docs, 'todos', 'wi-a1b2c3.md'), '### [manual] Record\n- **ID:** wi-a1b2c3d\n');
  expected.add('wi-a1b2c3');
  expected.add('wi-a1b2c3d');
  const taken = collectTakenIds(dir);
  expect(taken).toEqual(expected);
  expect(mintRandomId(taken, 'a1b2c3de')).toBe('wi-a1b2c3de');
});

test('mint fails cleanly on non-directory and symlinked intake entries', () => {
  const dir = freshDir('intake-errors');
  const docs = join(dir, 'docs');
  const intake = join(docs, 'todos');
  mkdirSync(docs);
  writeFileSync(intake, '');
  const mint = () => spawnSync(BIN, ['mint', dir], { encoding: 'utf8', env: GIT_ENV });
  const badDir = mint();
  expect(badDir.status).toBe(1);
  expect(badDir.stdout).toBe('');
  expect(badDir.stderr).toBe('roadmap-id: refusing non-directory intake path docs/todos\n');

  rmSync(intake);
  mkdirSync(intake);
  writeFileSync(join(docs, 'example.md'), 'wi-aabbcc\n');
  symlinkSync('../example.md', join(intake, 'wi-aabbcc.md'));
  const badEntry = mint();
  expect(badEntry.status).toBe(1);
  expect(badEntry.stdout).toBe('');
  expect(badEntry.stderr).toBe('roadmap-id: refusing non-regular intake document docs/todos/wi-aabbcc.md\n');
});

test('mint without a path uses the Git toplevel and reports planning read errors there', () => {
  const dir = freshDir('implicit-repo');
  expect(spawnSync('git', ['init', '--quiet', dir], { env: GIT_ENV }).status).toBe(0);
  const cwd = join(dir, 'nested');
  mkdirSync(cwd);
  mkdirSync(join(dir, 'ROADMAP.md'));
  const result = spawnSync(BIN, ['mint'], { cwd, env: GIT_ENV, encoding: 'utf8' });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe('roadmap-id: refusing non-regular planning document ROADMAP.md\n');
  rmSync(join(dir, 'ROADMAP.md'), { recursive: true });
  const success = spawnSync(BIN, ['mint'], { cwd, env: GIT_ENV, encoding: 'utf8' });
  expect(success.status).toBe(0);
  expect(success.stdout.trim()).toMatch(WORK_ITEM_ID_RE);
});

// ─── T1: Git history ID reservation ──────────────────────────────────

function gitIn(cwd: string, args: string[], env: NodeJS.ProcessEnv = GIT_ENV): void {
  const res = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${res.status}): ${res.stderr}`);
  }
}

function initGitRepo(prefix: string): string {
  const dir = freshDir(prefix);
  gitIn(dir, ['init', '-q', '-b', 'main']);
  gitIn(dir, ['config', 'user.email', 'test@example.com']);
  gitIn(dir, ['config', 'user.name', 'Test User']);
  return dir;
}

function commitFile(dir: string, relPath: string, content: string, message: string): void {
  const full = join(dir, relPath);
  const parent = resolve(full, '..');
  mkdirSync(parent, { recursive: true });
  writeFileSync(full, content);
  gitIn(dir, ['add', relPath]);
  gitIn(dir, ['commit', '-q', '-m', message]);
}

describe('Git history ID reservation', () => {
  test('reserves enclosing content and filename IDs from a nested project with relative diffs enabled', () => {
    const dir = initGitRepo('hist-relative');
    const nested = join(dir, 'nested');
    mkdirSync(nested);
    commitFile(dir, 'gone.txt', 'retired wi-00abcd\n', 'add historical content');
    commitFile(dir, 'docs/todos/wi-00abce.md', 'old intake without an ID field\n', 'add historical filename');
    gitIn(dir, ['rm', 'gone.txt', 'docs/todos/wi-00abce.md']);
    gitIn(dir, ['commit', '-qm', 'retire both files']);
    gitIn(dir, ['config', 'diff.relative', 'true']);
    expect([...collectTakenIds(nested)]).toEqual(['wi-00abcd', 'wi-00abce']);
  });

  test('reserves history when an explicit path names a bare Git repository', () => {
    const repo = initGitRepo('hist-bare-origin');
    commitFile(repo, 'gone.txt', 'retired wi-00abcf\n', 'add historical content');
    const bare = join(freshDir('hist-bare-target'), 'bare.git');
    gitIn(repo, ['clone', '-q', '--bare', repo, bare]);
    expect([...collectTakenIds(bare)]).toEqual(['wi-00abcf']);
  });

  test('reserves original contents even when a local Git replacement changes the blob', () => {
    const dir = initGitRepo('hist-replacement');
    commitFile(dir, 'entry.txt', 'historical wi-00aabd\n', 'commit historical file');
    function objectName(args: string[]): string {
      const result = spawnSync('git', args, { cwd: dir, env: GIT_ENV, encoding: 'utf8' });
      expect(result.status, result.stderr ?? '').toBe(0);
      return result.stdout.trim();
    }
    const original = objectName(['rev-parse', 'HEAD:entry.txt']);
    writeFileSync(join(dir, 'entry.txt'), 'replacement fixture body\n');
    const replacement = objectName(['hash-object', '-w', 'entry.txt']);
    gitIn(dir, ['replace', original, replacement]);
    expect([...collectTakenIds(dir)]).toEqual(['wi-00aabd']);
  });

  test('reserves IDs after a record is deleted (killed) or shipped then removed', () => {
    const dir = initGitRepo('hist-lifecycle');
    commitFile(dir, 'docs/TODOS.md', '## Unprocessed\n### [manual] Killed\n- **ID:** wi-111111\n', 'add killed');
    writeFileSync(join(dir, 'docs/TODOS.md'), '## Unprocessed\n');
    gitIn(dir, ['add', 'docs/TODOS.md']);
    gitIn(dir, ['commit', '-q', '-m', 'kill todo']);

    commitFile(dir, 'docs/roadmap-future.md', '## Future\n- **Item** — **ID:** wi-222222 — body.\n', 'add future');
    writeFileSync(join(dir, 'docs/roadmap-future.md'), '## Future\n');
    writeFileSync(join(dir, 'docs/roadmap-shipped.md'), '## Shipped\n### Track 1A: Item ✓ Shipped\n_id: wi-222222_\n');
    gitIn(dir, ['add', 'docs/roadmap-future.md', 'docs/roadmap-shipped.md']);
    gitIn(dir, ['commit', '-q', '-m', 'ship item']);

    writeFileSync(join(dir, 'docs/roadmap-shipped.md'), '## Shipped\n');
    gitIn(dir, ['add', 'docs/roadmap-shipped.md']);
    gitIn(dir, ['commit', '-q', '-m', 'merge into another record']);

    const taken = collectTakenIds(dir);
    expect(taken.has('wi-111111')).toBe(true);
    expect(taken.has('wi-222222')).toBe(true);
  });

  test('reserves IDs on a non-HEAD branch and on a tag (--all)', () => {
    const dir = initGitRepo('hist-refs');
    commitFile(dir, 'README.md', 'base\n', 'base');

    gitIn(dir, ['checkout', '-q', '-b', 'side-branch']);
    commitFile(dir, 'docs/TODOS.md', '## Unprocessed\n### [manual] Branch only\n- **ID:** wi-333333\n', 'branch id');

    gitIn(dir, ['checkout', '-q', 'main']);
    gitIn(dir, ['checkout', '-q', '-b', 'tag-branch']);
    commitFile(dir, 'docs/TODOS.md', '## Unprocessed\n### [manual] Tag only\n- **ID:** wi-444444\n', 'tag id');
    gitIn(dir, ['tag', 'v-only-here']);
    gitIn(dir, ['checkout', '-q', 'main']);
    gitIn(dir, ['branch', '-D', 'tag-branch']);

    const taken = collectTakenIds(dir);
    expect(taken.has('wi-333333')).toBe(true);
    expect(taken.has('wi-444444')).toBe(true);
  });

  test('reserves an ID introduced only by a merge commit resolution (-m)', () => {
    const dir = initGitRepo('hist-merge');
    commitFile(dir, 'notes.md', 'line 1\n', 'base');

    gitIn(dir, ['checkout', '-q', '-b', 'left']);
    commitFile(dir, 'notes.md', 'left change\n', 'left');

    gitIn(dir, ['checkout', '-q', 'main']);
    commitFile(dir, 'notes.md', 'right change\n', 'right');

    const merge = spawnSync('git', ['merge', '--no-commit', 'left'], { cwd: dir, env: GIT_ENV, encoding: 'utf8' });
    expect(merge.status).not.toBe(0);
    writeFileSync(join(dir, 'notes.md'), 'resolved with wi-555555\n');
    gitIn(dir, ['add', 'notes.md']);
    gitIn(dir, ['commit', '-q', '-m', 'merge resolution']);
    // Delete the ID on HEAD so it exists only in the merge commit's history.
    commitFile(dir, 'notes.md', 'cleaned up\n', 'cleanup');

    const taken = collectTakenIds(dir);
    expect(taken.has('wi-555555')).toBe(true);
  });

  test('reserves IDs committed under a symlinked directory or an unrelated filename', () => {
    const dir = initGitRepo('hist-aliases');
    mkdirSync(join(dir, 'real-docs'), { recursive: true });
    symlinkSync('real-docs', join(dir, 'alias-docs'));
    writeFileSync(join(dir, 'real-docs', 'TODOS.md'), '## Unprocessed\n### [manual] Via alias\n- **ID:** wi-666666\n');
    writeFileSync(join(dir, 'unrelated.txt'), 'archived id wi-777777\n');
    gitIn(dir, ['add', 'real-docs/TODOS.md', 'alias-docs', 'unrelated.txt']);
    gitIn(dir, ['commit', '-q', '-m', 'add aliased and unrelated']);

    rmSync(join(dir, 'real-docs', 'TODOS.md'));
    rmSync(join(dir, 'unrelated.txt'));
    gitIn(dir, ['add', '-A']);
    gitIn(dir, ['commit', '-q', '-m', 'remove both']);

    const taken = collectTakenIds(dir);
    expect(taken.has('wi-666666')).toBe(true);
    expect(taken.has('wi-777777')).toBe(true);
  });

  test('returns the same reserved set through symlink alias, sub/.., trailing slash, and case spelling', () => {
    const dir = initGitRepo('hist-spellings');
    commitFile(dir, 'docs/TODOS.md', '## Unprocessed\n### [manual] Entry\n- **ID:** wi-888888\n', 'add');
    commitFile(dir, 'docs/TODOS.md', '## Unprocessed\n', 'remove');
    mkdirSync(join(dir, 'sub'), { recursive: true });

    const symlinkPath = join(BASE_TMP, 'symlink-hist-spellings');
    symlinkSync(dir, symlinkPath);

    const baseline = collectTakenIds(dir);
    expect(baseline.has('wi-888888')).toBe(true);
    expect(collectTakenIds(symlinkPath)).toEqual(baseline);
    expect(collectTakenIds(join(dir, 'sub', '..'))).toEqual(baseline);
    expect(collectTakenIds(dir + '/')).toEqual(baseline);

    // Case-changed spelling only on case-insensitive filesystems.
    const upper = dir.slice(0, -1) + (dir.endsWith(dir.slice(-1).toUpperCase())
      ? dir.slice(-1).toLowerCase()
      : dir.slice(-1).toUpperCase());
    if (upper !== dir && existsSync(upper)) {
      expect(collectTakenIds(upper)).toEqual(baseline);
    }
  });

  test('ignores inherited GIT_DIR, GIT_WORK_TREE and pathspec variables', () => {
    const target = initGitRepo('hist-target');
    const decoy = initGitRepo('hist-decoy');
    commitFile(target, 'docs/TODOS.md', '## Unprocessed\n### [manual] Target\n- **ID:** wi-999991\n', 'target');
    commitFile(target, 'docs/TODOS.md', '## Unprocessed\n', 'clear target');
    commitFile(decoy, 'docs/TODOS.md', '## Unprocessed\n### [manual] Decoy\n- **ID:** wi-999992\n', 'decoy');

    const envVars: NodeJS.ProcessEnv = {
      ...GIT_ENV,
      GIT_DIR: join(decoy, '.git'),
      GIT_WORK_TREE: decoy,
      GIT_LITERAL_PATHSPECS: '1',
      GIT_GLOB_PATHSPECS: '1',
      GIT_NOGLOB_PATHSPECS: '1',
      GIT_ICASE_PATHSPECS: '1',
    };

    const res = spawnSync(BIN, ['mint', target], { encoding: 'utf8', env: envVars });
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toMatch(WORK_ITEM_ID_RE);

    // Also verify collectTakenIds directly with those env vars set in process.env.
    const saved: Record<string, string | undefined> = {};
    for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_LITERAL_PATHSPECS', 'GIT_GLOB_PATHSPECS', 'GIT_NOGLOB_PATHSPECS', 'GIT_ICASE_PATHSPECS']) {
      saved[key] = process.env[key];
      process.env[key] = envVars[key];
    }
    try {
      const taken = collectTakenIds(target);
      expect(taken.has('wi-999991')).toBe(true);
      expect(taken.has('wi-999992')).toBe(false);
    } finally {
      for (const [key, val] of Object.entries(saved)) {
        if (val === undefined) delete process.env[key]; else process.env[key] = val;
      }
    }
  });

  test('shallow clone exits 1 with shallow message and empty stdout for mint and migrate', () => {
    const upstream = initGitRepo('hist-upstream');
    commitFile(upstream, 'docs/TODOS.md', '## Unprocessed\n### [manual] One\n- **ID:** wi-aaaaaa\n', 'c1');
    commitFile(upstream, 'docs/TODOS.md', '## Unprocessed\n### [manual] Two\n', 'c2');

    const shallow = join(BASE_TMP, 'hist-shallow');
    gitIn(BASE_TMP, ['clone', '--quiet', '--depth', '1', `file://${upstream}`, shallow]);

    const mintRes = spawnSync(BIN, ['mint', shallow], { encoding: 'utf8', env: GIT_ENV });
    expect(mintRes.status).toBe(1);
    expect(mintRes.stdout).toBe('');
    expect(mintRes.stderr).toContain('shallow clone');

    const migRes = spawnSync(BIN, ['migrate', shallow], { encoding: 'utf8', env: GIT_ENV });
    expect(migRes.status).toBe(1);
    expect(migRes.stdout).toBe('');
    expect(migRes.stderr).toContain('shallow clone');
    expect(readFileSync(join(shallow, 'docs/TODOS.md'), 'utf8')).toBe('## Unprocessed\n### [manual] Two\n');
  });

  test('repository with no commits reserves only current-file IDs', () => {
    const dir = initGitRepo('hist-empty');
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, 'docs/TODOS.md'), '## Unprocessed\n### [manual] Local\n- **ID:** wi-ababab\n');
    expect(collectTakenIds(dir)).toEqual(new Set(['wi-ababab']));
  });

  test('non-repository directory keeps current-files-only behavior', () => {
    const dir = freshDir('hist-norepo');
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, 'docs/TODOS.md'), '## Unprocessed\n### [manual] Local\n- **ID:** wi-cdcdcd\n');
    expect(collectTakenIds(dir)).toEqual(new Set(['wi-cdcdcd']));
    const res = spawnSync(BIN, ['mint', dir], { encoding: 'utf8', env: GIT_ENV });
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toMatch(WORK_ITEM_ID_RE);
  });
});

// ─── T3: Idempotent migrate subcommand ───────────────────────────────

function deterministicMinter(ids: string[]) {
  let idx = 0;
  return (_taken: ReadonlySet<string>): string => {
    const next = ids[idx++];
    if (!next) throw new Error('ran out of deterministic IDs');
    return next;
  };
}

describe('work-item migration (accepted shapes)', () => {
  test('TODO T-a (bullet follows), T-b (paragraph follows), and T-c (blank-only)', () => {
    const input = [
      '# TODOS',
      '',
      '## Unprocessed',
      '',
      '### [manual] Bullet entry',
      '- **Why:** reason',
      '',
      '### [manual] Paragraph entry',
      '**What:** paragraph body',
      '',
      '### [manual] Empty entry',
      '',
      '## Completed',
      '### [manual] Done entry',
      '- **Why:** done',
      '',
    ].join('\n');
    const result = planWorkItemMigration(
      [{ kind: 'todos', relPath: 'docs/TODOS.md', content: input }],
      new Set(),
      deterministicMinter(['wi-000001', 'wi-000002', 'wi-000003', 'wi-000004']),
    );
    expect(result.refusals).toEqual([]);
    expect(result.assignments).toHaveLength(4);
    expect(result.files[0]!.content).toBe([
      '# TODOS',
      '',
      '## Unprocessed',
      '',
      '### [manual] Bullet entry',
      '- **ID:** wi-000001',
      '- **Why:** reason',
      '',
      '### [manual] Paragraph entry',
      '- **ID:** wi-000002',
      '',
      '**What:** paragraph body',
      '',
      '### [manual] Empty entry',
      '- **ID:** wi-000003',
      '',
      '## Completed',
      '### [manual] Done entry',
      '- **ID:** wi-000004',
      '- **Why:** done',
      '',
    ].join('\n'));
  });

  test('Future bold title (including Revisit when immediately after dash) and plain title', () => {
    const input = [
      '## Future',
      '- **Bold item** — body text. **Revisit when:** GA',
      '- **Trigger only** — **Revisit when:** next release',
      '- Plain item — plain body. **Revisit when:** trigger',
      '- Plain no trigger — plain body only.',
      '',
    ].join('\n');
    const result = planWorkItemMigration(
      [{ kind: 'future', relPath: 'docs/roadmap-future.md', content: input }],
      new Set(),
      deterministicMinter(['wi-000011', 'wi-000012', 'wi-000013', 'wi-000014']),
    );
    expect(result.refusals).toEqual([]);
    expect(result.files[0]!.content).toBe([
      '## Future',
      '- **Bold item** — **ID:** wi-000011 — body text. **Revisit when:** GA',
      '- **Trigger only** — **ID:** wi-000012 — **Revisit when:** next release',
      '- Plain item — plain body. — **ID:** wi-000013 **Revisit when:** trigger',
      '- Plain no trigger — plain body only. — **ID:** wi-000014',
      '',
    ].join('\n'));
  });

  test('ROADMAP Track heading, shipped-archive Track heading, and legacy shipped bullets', () => {
    const roadmap = [
      '## Current Plan',
      '### Group 1: Core',
      '#### Track 1A: Build',
      '_1 task · ~50 LOC · low risk_',
      '_touches: src/a.ts_',
      '',
    ].join('\n');
    const shipped = [
      '## Shipped',
      '#### Group 1: Early ✓ Shipped (v0.18.3)',
      '- Track 1A — _shipped (v0.18.3): initial_; removed in Track 7A: old helper',
      '### Track 22A: Receipt ✓ Shipped (v0.50.0)',
      '- 2026-06-01: merged',
      '',
    ].join('\n');
    const result = planWorkItemMigration(
      [
        { kind: 'roadmap', relPath: 'docs/ROADMAP.md', content: roadmap },
        { kind: 'shipped', relPath: 'docs/roadmap-shipped.md', content: shipped },
      ],
      new Set(),
      deterministicMinter(['wi-000021', 'wi-000022', 'wi-000023']),
    );
    expect(result.refusals).toEqual([]);
    expect(result.files[0]!.content).toBe([
      '## Current Plan',
      '### Group 1: Core',
      '#### Track 1A: Build',
      '_1 task · ~50 LOC · low risk_',
      '_id: wi-000021_',
      '_touches: src/a.ts_',
      '',
    ].join('\n'));
    expect(result.files[1]!.content).toBe([
      '## Shipped',
      '#### Group 1: Early ✓ Shipped (v0.18.3)',
      '- Track 1A — **ID:** wi-000023 — _shipped (v0.18.3): initial_; removed in Track 7A: old helper',
      '### Track 22A: Receipt ✓ Shipped (v0.50.0)',
      '_id: wi-000022_',
      '- 2026-06-01: merged',
      '',
    ].join('\n'));
  });

  test('Completed heading directly after Unprocessed entry, legacy Completed ID stays single, and **What:** paragraph', () => {
    const input = [
      '## Unprocessed',
      '### [manual] Last unprocessed',
      '## Completed',
      '### [manual] Completed right under heading',
      '**What:** paragraph body',
      '- [manual] Legacy completed bullet',
      '- **ID:** wi-112233',
      '',
    ].join('\n');
    const result = planWorkItemMigration(
      [{ kind: 'todos', relPath: 'docs/TODOS.md', content: input }],
      new Set(['wi-112233']),
      deterministicMinter(['wi-000031', 'wi-000032']),
    );
    expect(result.refusals).toEqual([]);
    expect(result.files[0]!.content).toBe([
      '## Unprocessed',
      '### [manual] Last unprocessed',
      '- **ID:** wi-000031',
      '## Completed',
      '### [manual] Completed right under heading',
      '- **ID:** wi-000032',
      '',
      '**What:** paragraph body',
      '- [manual] Legacy completed bullet',
      '- **ID:** wi-112233',
      '',
    ].join('\n'));
  });

  test('inline code spans that look like ID fields stay reserved and are never read as the field', () => {
    const future = [
      '## Future',
      '- **Document `**ID:**` in recipes** — Shows `**ID:** wi-abc123` in docs. **Revisit when:** GA',
      '',
    ].join('\n');
    const todos = [
      '## Unprocessed',
      '### [manual] Quote ID syntax',
      '- **What:** mentions `- **ID:** wi-abc123` in prose',
      '',
    ].join('\n');
    const result = planWorkItemMigration(
      [
        { kind: 'future', relPath: 'docs/roadmap-future.md', content: future },
        { kind: 'todos', relPath: 'docs/TODOS.md', content: todos },
      ],
      new Set(['wi-abc123']),
      deterministicMinter(['wi-000041', 'wi-000042']),
    );
    expect(result.refusals).toEqual([]);
    expect(result.files[0]!.content).toBe([
      '## Future',
      '- **Document `**ID:**` in recipes** — **ID:** wi-000041 — Shows `**ID:** wi-abc123` in docs. **Revisit when:** GA',
      '',
    ].join('\n'));
    expect(result.files[1]!.content).toBe([
      '## Unprocessed',
      '### [manual] Quote ID syntax',
      '- **ID:** wi-000042',
      '- **What:** mentions `- **ID:** wi-abc123` in prose',
      '',
    ].join('\n'));
  });

  test('descriptive Future heading is migrated while Future-proof rollout notes is untouched', () => {
    const input = [
      '## Future (deferred) — next release',
      '- **Deferred** — keep this. **Revisit when:** GA',
      '## Future-proof rollout notes',
      '- Keep the old link',
      '',
    ].join('\n');
    const result = planWorkItemMigration(
      [{ kind: 'future', relPath: 'docs/roadmap-future.md', content: input }],
      new Set(),
      deterministicMinter(['wi-000051']),
    );
    expect(result.refusals).toEqual([]);
    expect(result.files[0]!.content).toBe([
      '## Future (deferred) — next release',
      '- **Deferred** — **ID:** wi-000051 — keep this. **Revisit when:** GA',
      '## Future-proof rollout notes',
      '- Keep the old link',
      '',
    ].join('\n'));
  });

  test('preserves CRLF, UTF-8 BOM, and handles a final heading with no trailing newline', () => {
    const crlfBom = '\uFEFF# TODOS\r\n## Unprocessed\r\n### [manual] One\r\n- **Why:** x\r\n';
    const noTrailingNl = '## Unprocessed\n### [manual] Final';
    const r1 = planWorkItemMigration(
      [{ kind: 'todos', relPath: 'docs/TODOS.md', content: crlfBom }],
      new Set(),
      deterministicMinter(['wi-000061']),
    );
    expect(r1.refusals).toEqual([]);
    expect(r1.files[0]!.content).toBe('\uFEFF# TODOS\r\n## Unprocessed\r\n### [manual] One\r\n- **ID:** wi-000061\r\n- **Why:** x\r\n');

    const r2 = planWorkItemMigration(
      [{ kind: 'todos', relPath: 'docs/TODOS.md', content: noTrailingNl }],
      new Set(),
      deterministicMinter(['wi-000062']),
    );
    expect(r2.refusals).toEqual([]);
    expect(r2.files[0]!.content).toBe('## Unprocessed\n### [manual] Final\n- **ID:** wi-000062');
  });
});

describe('bin/roadmap-id migrate CLI', () => {
  test('refuses a bold colon title even when its prose contains a dash', () => {
    const dir = freshDir('mig-colon-dash');
    const future = join(dir, 'roadmap-future.md');
    const original = '## Future\n\n- **Legacy title**: revisit later — more detail.\n';
    writeFileSync(future, original);
    const result = runIdCli(['migrate', dir]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('REFUSED roadmap-future.md:3 future');
    expect(readFileSync(future, 'utf8')).toBe(original);
  });

  test('refuses a legacy shipped bullet under a Group heading outside the H4 shape', () => {
    const dir = freshDir('mig-legacy-group-depth');
    const shipped = join(dir, 'roadmap-shipped.md');
    const original = '## Shipped\n\n### Group 1: Legacy\n\n- Track 1A — _shipped: archived._\n';
    writeFileSync(shipped, original);
    const result = runIdCli(['migrate', dir]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('REFUSED roadmap-shipped.md:5 legacy-track');
    expect(readFileSync(shipped, 'utf8')).toBe(original);
  });

  test('refuses an explicit empty project path without writing to the current directory', () => {
    const dir = freshDir('mig-empty-project-path');
    const file = join(dir, 'TODOS.md');
    const original = '## Unprocessed\n\n### [manual] Existing entry\n- **What:** Work.\n';
    writeFileSync(file, original);
    const result = spawnSync(BIN, ['migrate', ''], { cwd: dir, env: GIT_ENV, encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(readFileSync(file, 'utf8')).toBe(original);
  });

  test('identifies the shipped Track line and kind if an assignment fails read-back', () => {
    const original = '## Shipped\n\n### Track 1A: Older receipt\n';
    const result = planWorkItemMigration(
      [{ kind: 'shipped', relPath: 'roadmap-shipped.md', content: original }],
      new Set(),
      () => 'invalid-assignment',
    );
    expect(result.refusals).toMatchObject([{
      relPath: 'roadmap-shipped.md', line: 3, kind: 'shipped-track',
      reason: expect.stringContaining('read-back verification failed'),
    }]);
  });

  test('refuses colon/separator-less Future bullets, metadata-less ROADMAP Track, and duplicate-label Track without writing', () => {
    const dir = freshDir('mig-refuse-shapes');
    mkdirSync(join(dir, 'docs'), { recursive: true });
    const futureText = [
      '## Future',
      '- **Follow-up**: More work. **Revisit when:** - use **Phase 2** — after GA',
      '- **Colon title**: body without dash',
      '',
    ].join('\n');
    const roadmapText = [
      '## Current Plan',
      '### Group 1: Core',
      '#### Track 1A: No metadata',
      '_touches: src/a.ts_',
      '#### Track 1A: Duplicate label',
      '_1 task · low risk_',
      '',
    ].join('\n');
    const todosText = '## Unprocessed\n### [manual] Valid entry\n- **Why:** ok\n';
    writeFileSync(join(dir, 'docs/roadmap-future.md'), futureText);
    writeFileSync(join(dir, 'docs/ROADMAP.md'), roadmapText);
    writeFileSync(join(dir, 'docs/TODOS.md'), todosText);

    const res = spawnSync(BIN, ['migrate', dir], { encoding: 'utf8', env: GIT_ENV });
    expect(res.status).toBe(1);
    expect(res.stdout).toBe('');
    expect(res.stderr).toContain('REFUSED docs/roadmap-future.md:2 future');
    expect(res.stderr).toContain('REFUSED docs/roadmap-future.md:3 future');
    expect(res.stderr).toContain('REFUSED docs/ROADMAP.md:3 track');
    expect(res.stderr).toContain('REFUSED docs/ROADMAP.md:5 track');
    expect(res.stderr).toContain('records refused; no files were written');
    expect(readFileSync(join(dir, 'docs/TODOS.md'), 'utf8')).toBe(todosText);
    expect(readFileSync(join(dir, 'docs/ROADMAP.md'), 'utf8')).toBe(roadmapText);
    expect(readFileSync(join(dir, 'docs/roadmap-future.md'), 'utf8')).toBe(futureText);
  });

  test('refuses dual root+docs copies, symlinked docs/files, and non-UTF-8 files without writing', () => {
    // Dual copy
    const dual = freshDir('mig-dual');
    mkdirSync(join(dual, 'docs'), { recursive: true });
    writeFileSync(join(dual, 'TODOS.md'), '## Unprocessed\n### [manual] Root\n');
    writeFileSync(join(dual, 'docs/TODOS.md'), '## Unprocessed\n### [manual] Docs\n');
    const dualRes = spawnSync(BIN, ['migrate', dual], { encoding: 'utf8', env: GIT_ENV });
    expect(dualRes.status).toBe(1);
    expect(dualRes.stdout).toBe('');
    expect(dualRes.stderr).toContain('REFUSED TODOS.md:1 document');

    // Symlinked file
    const sym = freshDir('mig-symlink');
    mkdirSync(join(sym, 'docs'), { recursive: true });
    writeFileSync(join(sym, 'real.md'), '## Unprocessed\n### [manual] Target\n');
    symlinkSync('../real.md', join(sym, 'docs/TODOS.md'));
    const symRes = spawnSync(BIN, ['migrate', sym], { encoding: 'utf8', env: GIT_ENV });
    expect(symRes.status).toBe(1);
    expect(symRes.stdout).toBe('');
    expect(symRes.stderr).toContain('REFUSED docs/TODOS.md:1 document');

    // Non-UTF-8 file
    const badUtf8 = freshDir('mig-utf8');
    mkdirSync(join(badUtf8, 'docs'), { recursive: true });
    writeFileSync(join(badUtf8, 'docs/TODOS.md'), Buffer.from([0xff, 0xfe, 0x00, 0x01]));
    const utf8Res = spawnSync(BIN, ['migrate', badUtf8], { encoding: 'utf8', env: GIT_ENV });
    expect(utf8Res.status).toBe(1);
    expect(utf8Res.stdout).toBe('');
    expect(utf8Res.stderr).toContain('REFUSED docs/TODOS.md:1 document');
  });

  test('refuses a shipped archive heading outside the approved H3 shape', () => {
    const dir = freshDir('mig-archive-depth');
    const path = join(dir, 'roadmap-shipped.md');
    const original = '## Shipped\n\n#### Group 1: History\n\n#### Track 1A: Heading depth four\n\nA shipped record.\n';
    writeFileSync(path, original);
    const result = runIdCli(['migrate', dir]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('REFUSED roadmap-shipped.md:5 shipped-track');
    expect(readFileSync(path, 'utf8')).toBe(original);
  });

  test('selects the physical project when a symlink is followed by a literal parent segment', () => {
    const dir = freshDir('mig-physical');
    const project = join(dir, 'project');
    mkdirSync(join(project, 'sub'), { recursive: true });
    symlinkSync(join(project, 'sub'), join(dir, 'alias'), 'dir');
    const original = '## Unprocessed\n\n### [manual] Existing entry\n- **What:** Work.\n';
    const sibling = join(dir, 'TODOS.md');
    const target = join(project, 'TODOS.md');
    writeFileSync(sibling, original);
    writeFileSync(target, original);
    const result = runIdCli(['migrate', `${join(dir, 'alias')}/..`]);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(sibling, 'utf8')).toBe(original);
    expect(readFileSync(target, 'utf8')).toContain('- **ID:** wi-');
  });

  test('preserves trailing spaces in the implicitly discovered Git project path', () => {
    const dir = freshDir('mig-root-spaces');
    const project = join(dir, 'project ');
    const cwd = join(project, 'nested');
    mkdirSync(cwd, { recursive: true });
    gitIn(project, ['init', '-q']);
    const neighbor = join(dir, 'project');
    mkdirSync(neighbor);
    const original = '## Unprocessed\n\n### [manual] Existing entry\n- **What:** Work.\n';
    writeFileSync(join(project, 'TODOS.md'), original);
    writeFileSync(join(neighbor, 'TODOS.md'), original);
    const result = spawnSync(BIN, ['migrate'], { cwd, env: GIT_ENV, encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(readFileSync(join(neighbor, 'TODOS.md'), 'utf8')).toBe(original);
    expect(readFileSync(join(project, 'TODOS.md'), 'utf8')).toContain('- **ID:** wi-');
  });

  test.skipIf(process.getuid?.() === 0)('a later staging error leaves earlier planning documents unchanged', () => {
    const dir = freshDir('mig-no-partial-write');
    const path = join(dir, 'TODOS.md');
    const original = '## Unprocessed\n\n### [manual] Existing entry\n- **What:** Work.\n';
    writeFileSync(path, original);
    const docs = join(dir, 'docs');
    mkdirSync(docs);
    const future = join(docs, 'roadmap-future.md');
    const originalFuture = '## Future\n\n- **Deferred** — reconsider when ready.\n';
    writeFileSync(future, originalFuture);
    chmodSync(docs, 0o555);
    try {
      const result = runIdCli(['migrate', dir]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('');
      expect(readFileSync(path, 'utf8')).toBe(original);
      expect(readFileSync(future, 'utf8')).toBe(originalFuture);
      expect(result.stderr).toContain('no files were written');
    } finally {
      chmodSync(docs, 0o755);
    }
  });

  test('preserves an existing document mode regardless of the process umask', () => {
    const dir = freshDir('mig-mode');
    const path = join(dir, 'TODOS.md');
    writeFileSync(path, '## Unprocessed\n\n### [manual] Existing entry\n- **What:** Work.\n');
    chmodSync(path, 0o664);
    const result = spawnSync('sh', ['-c', 'umask 077; exec "$@"', 'sh', BIN, 'migrate', dir], {
      env: GIT_ENV, encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(statSync(path).mode & 0o777).toBe(0o664);
  });

  test('--dry-run writes nothing; migrate is idempotent and works through aliases and pathspec env vars', () => {
    const dir = initGitRepo('mig-e2e');
    mkdirSync(join(dir, 'sub'), { recursive: true });
    commitFile(dir, 'docs/TODOS.md', '## Unprocessed\n### [manual] One\n- **Why:** x\n', 'add todo');
    const aliasPath = join(BASE_TMP, 'symlink-mig-e2e');
    symlinkSync(dir, aliasPath);

    const pathspecEnv: NodeJS.ProcessEnv = {
      ...GIT_ENV,
      GIT_LITERAL_PATHSPECS: '1',
      GIT_GLOB_PATHSPECS: '1',
      GIT_NOGLOB_PATHSPECS: '1',
      GIT_ICASE_PATHSPECS: '1',
    };

    const dry = spawnSync(BIN, ['migrate', aliasPath, '--dry-run'], { encoding: 'utf8', env: pathspecEnv });
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain('DRY_RUN 1\n');
    expect(readFileSync(join(dir, 'docs/TODOS.md'), 'utf8')).toBe('## Unprocessed\n### [manual] One\n- **Why:** x\n');

    const run1 = spawnSync(BIN, ['migrate', join(dir, 'sub', '..') + '/'], { encoding: 'utf8', env: pathspecEnv });
    expect(run1.status).toBe(0);
    expect(run1.stdout).toContain('ASSIGNED docs/TODOS.md:2 wi-');
    expect(run1.stdout).toContain('MIGRATED 1\n');
    const after1 = readFileSync(join(dir, 'docs/TODOS.md'), 'utf8');

    const run2 = spawnSync(BIN, ['migrate', dir], { encoding: 'utf8', env: pathspecEnv });
    expect(run2.status).toBe(0);
    expect(run2.stdout).toBe('MIGRATED 0\n');
    expect(readFileSync(join(dir, 'docs/TODOS.md'), 'utf8')).toBe(after1);
  });

  test('composite fixture: full bin/roadmap-audit output before and after migration differs only in WORK_ITEM_IDS', () => {
    const dir = initGitRepo('mig-audit-parity');
    commitFile(dir, 'VERSION', '0.1.0\n', 'version');
    commitFile(dir, 'docs/TODOS.md', [
      '# TODOS',
      '',
      '## Unprocessed',
      '',
      '### [manual] First task',
      '- **Why:** needed',
      '',
      '## Completed',
      '',
      '### [manual] Old task',
      '- **Why:** done',
      '',
    ].join('\n'), 'todos');
    commitFile(dir, 'docs/ROADMAP.md', [
      '# Roadmap',
      '',
      '## Current Plan',
      '',
      '### Group 1: Core',
      '_Depends on: none_',
      '',
      '#### Track 1A: Build',
      '_1 task · ~50 LOC · low risk_',
      '_touches: src/a.ts_',
      '- **Do** -- body (S)',
      '',
      '## Future',
      '',
      'Deferred: docs/roadmap-future.md (1 item)',
      '',
      '## Shipped',
      '',
      'History: docs/roadmap-shipped.md',
      '',
    ].join('\n'), 'roadmap');
    commitFile(dir, 'docs/roadmap-future.md', [
      '# Roadmap — Future',
      '',
      '## Future',
      '',
      '- **Later item** — details. **Revisit when:** GA',
      '',
    ].join('\n'), 'future');
    commitFile(dir, 'docs/roadmap-shipped.md', [
      '# Roadmap — Shipped',
      '',
      '## Shipped',
      '',
      '#### Group 0: Legacy ✓ Shipped (v0.1.0)',
      '- Track 0A — _shipped (v0.1.0): old_',
      '',
      '### Track 0B: Receipt ✓ Shipped (v0.1.0)',
      '- 2026-01-01: merged',
      '',
    ].join('\n'), 'shipped');

    const stripWorkItemIds = (out: string) =>
      out.replace(/## WORK_ITEM_IDS[\s\S]*?(?=\n## [A-Z_]+\n|$)/, '## WORK_ITEM_IDS\n<STRIPPED>\n');

    const beforeAudit = spawnSync(AUDIT_BIN, [dir], { encoding: 'utf8', env: GIT_ENV });
    expect(beforeAudit.status).toBe(0);
    expect(beforeAudit.stdout).toContain('MISSING_ID:');

    const mig = spawnSync(BIN, ['migrate', dir], { encoding: 'utf8', env: GIT_ENV });
    expect(mig.status).toBe(0);
    expect(mig.stdout).toContain('MIGRATED 6\n');

    const afterAudit = spawnSync(AUDIT_BIN, [dir], { encoding: 'utf8', env: GIT_ENV });
    expect(afterAudit.status).toBe(0);
    expect(afterAudit.stdout).toContain('## WORK_ITEM_IDS\nSTATUS: pass\n');
    expect(stripWorkItemIds(afterAudit.stdout)).toBe(stripWorkItemIds(beforeAudit.stdout));
  });
});
