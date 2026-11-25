import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { runIdCli } from '../src/audit/id-cli.ts';
import { createGitGateway } from '../src/audit/lib/git.ts';
import {
  WORK_ITEM_ID_CONTRACT,
  WORK_ITEM_ID_PREFIX,
  WORK_ITEM_ID_RE,
  deriveDeterministicId,
  extractInlineBulletId,
  isValidWorkItemId,
  migrateFutureText,
  migrateRoadmapText,
  migrateTodosText,
  mintRandomId,
  parseTodoIdBullet,
  parseTrackIdLine,
  scanAllWorkItemIds,
} from '../src/audit/lib/work-item-id.ts';
import { parseRoadmap } from '../src/audit/parsers/roadmap.ts';
import { parseTodos } from '../src/audit/parsers/todos.ts';
import { GIT_ENV, makeEmptyRepo } from './helpers/fixture-repo.ts';

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

  test('deterministic ID grows 6 -> 7 -> 8 hex on collision and re-salts after 8', () => {
    const taken = new Set<string>();
    const id6 = deriveDeterministicId('seed-one', taken);
    expect(id6).toMatch(/^wi-[0-9a-f]{6}$/);
    taken.add(id6);

    const id7 = deriveDeterministicId('seed-one', taken);
    expect(id7).toMatch(/^wi-[0-9a-f]{7}$/);
    expect(id7.startsWith(id6)).toBe(true);
    taken.add(id7);

    const id8 = deriveDeterministicId('seed-one', taken);
    expect(id8).toMatch(/^wi-[0-9a-f]{8}$/);
    expect(id8.startsWith(id7)).toBe(true);
    taken.add(id8);

    const idResalt = deriveDeterministicId('seed-one', taken);
    expect(idResalt).toMatch(/^wi-[0-9a-f]{6}$/);
    expect(taken.has(idResalt)).toBe(false);
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

  test('migrateTodosText handles blank-line, immediate, non-bullet, fenced, and duplicate-title entries idempotently', () => {
    const input = [
      '# TODOS',
      '',
      '## Unprocessed',
      '',
      '### [manual] First item',
      '',
      '- **Why:** reason one',
      '',
      '### [manual] First item',
      '- **Why:** duplicate title',
      '',
      '```markdown',
      '### [manual] Inside fence',
      '```',
      '',
      '## Completed',
      '',
      '### Legacy completed',
      '',
      '**What:** no bullet list here',
      '',
    ].join('\n');

    const taken = new Set<string>();
    const first = migrateTodosText(input, taken);
    expect(first.added).toBe(3);
    expect(first.ids.length).toBe(3);
    expect(new Set(first.ids).size).toBe(3);
    expect(first.text).not.toContain('Inside fence\n- **ID:**');
    // Blank line preserved between heading and first bullet for First item #1
    expect(first.text).toContain(`### [manual] First item\n\n- **ID:** ${first.ids[0]}\n- **Why:** reason one`);
    // Directly below heading for First item #2
    expect(first.text).toContain(`### [manual] First item\n- **ID:** ${first.ids[1]}\n- **Why:** duplicate title`);
    // Directly below heading when body has no `- **...**` bullet
    expect(first.text).toContain(`### Legacy completed\n- **ID:** ${first.ids[2]}\n\n**What:** no bullet list here`);

    // Second run is byte-identical
    const second = migrateTodosText(first.text, taken);
    expect(second.added).toBe(0);
    expect(second.text).toBe(first.text);
  });

  test('migrateFutureText handles bold-dash, plain, revisit-when, empty revisit, and fences idempotently', () => {
    const input = [
      '# Future',
      '',
      '## Future',
      '',
      '- **Alpha** — Some prose. **Revisit when:** trigger',
      '- Plain bullet without bold **Revisit when:** ',
      '- Bare bullet with no revisit',
      '```',
      '- **Fenced** — should not change',
      '```',
      '',
    ].join('\n');

    const taken = new Set<string>();
    const first = migrateFutureText(input, taken);
    expect(first.added).toBe(3);
    expect(first.text).toContain(`- **Alpha** — **ID:** ${first.ids[0]} — Some prose. **Revisit when:** trigger`);
    expect(first.text).toContain(`- Plain bullet without bold — **ID:** ${first.ids[1]} **Revisit when:** `);
    expect(first.text).toContain(`- Bare bullet with no revisit — **ID:** ${first.ids[2]}`);
    expect(first.text).toContain('- **Fenced** — should not change');

    const second = migrateFutureText(first.text, taken);
    expect(second.added).toBe(0);
    expect(second.text).toBe(first.text);
  });

  test('migrateRoadmapText handles active tracks, shipped receipts, legacy bullets, and --rewrite-blocked-by', () => {
    const input = [
      '# Roadmap',
      '',
      '## Current Plan',
      '',
      '### Group 1: Core',
      '',
      '#### Track 1A: First',
      '_1 task · ~50 LOC · low risk_',
      '_touches: src/a.ts_',
      '- **Do A** -- work (S)',
      '',
      '### Group 2: Next',
      '_Depends on: Group 1_',
      '',
      '#### Track 2A: Second',
      '_1 task · ~50 LOC · low risk_',
      '_touches: src/b.ts_',
      '_blocked-by: Track 1A_',
      '- **Do B** -- work (S)',
      '',
      '## Shipped',
      '',
      '#### Group 0: Legacy ✓ Shipped (v0.1.0)',
      '- Track 0A — _shipped (v0.1.0): old stuff_',
      '- _Note about Group 0_',
      '',
      '### Track 0B: Receipt ✓ Shipped (v0.2.0)',
      '- 2026-01-01: merged PR #1',
      '',
    ].join('\n');

    const taken = new Set<string>();
    const defaultRun = migrateRoadmapText(input, taken);
    expect(defaultRun.added).toBe(4);
    // Default migration does NOT rewrite _blocked-by:
    expect(defaultRun.text).toContain('_blocked-by: Track 1A_');
    expect(defaultRun.text).toContain('- _Note about Group 0_');
    expect(defaultRun.text).not.toContain('- _Note about Group 0_ — **ID:**');

    const secondDefault = migrateRoadmapText(defaultRun.text, taken);
    expect(secondDefault.added).toBe(0);
    expect(secondDefault.text).toBe(defaultRun.text);

    const taken2 = new Set<string>();
    const rewriteRun = migrateRoadmapText(input, taken2, { rewriteBlockedBy: true });
    expect(rewriteRun.added).toBe(4);
    // Track 1A's ID is now on _blocked-by:
    const id1A = rewriteRun.ids[1]!; // ids[0] is legacy 0A, ids[1] is 1A
    expect(rewriteRun.text).toContain(`_blocked-by: ${id1A}_`);
  });

  test('scanAllWorkItemIds finds unique sorted valid IDs', () => {
    expect(scanAllWorkItemIds('wi-ffff00 wi-0000aa wi-ffff00 wi-12 wi-ZZZZ')).toEqual([
      'wi-0000aa',
      'wi-ffff00',
    ]);
  });
});

describe('bin/roadmap-id CLI', () => {
  test('mint and migrate reserve Markdown Track IDs in live and deleted records', () => {
    const repo = freshDir('mint-git');
    mkdirSync(join(repo, 'docs'), { recursive: true });
    const git = (args: string[]) =>
      spawnSync('git', args, {
        cwd: repo,
        env: {
          ...GIT_ENV,
          GIT_AUTHOR_NAME: 'Test',
          GIT_AUTHOR_EMAIL: 'test@example.com',
          GIT_COMMITTER_NAME: 'Test',
          GIT_COMMITTER_EMAIL: 'test@example.com',
        },
        encoding: 'utf8',
      });
    expect(git(['init']).status).toBe(0);
    writeFileSync(join(repo, '.gitattributes'), 'docs/TODOS.md -diff\n');
    const roadmapPath = join(repo, 'ROADMAP.md');
    const todoPath = join(repo, 'docs', 'TODOS.md');
    const pending = '## Unprocessed\n### My entry\n';
    const id = migrateTodosText(pending, new Set()).ids[0]!;
    // The initial patch must exceed Bun's default child-process output limit.
    const track = `## Current Plan\n### Group 1: Work\n#### Track 1A: First\n_1 task . low risk_\n_id: ${id}_\n`
      + 'Historical planning detail.\n'.repeat(44_000);
    writeFileSync(roadmapPath, track);
    writeFileSync(todoPath, pending);
    expect(runIdCli(['migrate', repo]).exitCode).toBe(0);
    expect(readFileSync(todoPath, 'utf8')).not.toContain(`- **ID:** ${id}\n`);
    writeFileSync(
      join(repo, 'docs', 'TODOS.md'),
      '# TODOS\n\n## Unprocessed\n\n### [manual] Killed entry\n- **ID:** wi-dead01\n',
    );
    expect(git(['add', '.']).status).toBe(0);
    expect(git(['commit', '-m', 'add entry']).status).toBe(0);
    // Kill the entry
    writeFileSync(roadmapPath, '');
    writeFileSync(todoPath, pending);
    expect(git(['add', '.']).status).toBe(0);
    expect(git(['commit', '-m', 'kill entry']).status).toBe(0);
    const historical = createGitGateway({ cwd: repo, bindToCwd: true }).historicalWorkItemIds(['ROADMAP.md', 'docs/TODOS.md']);
    expect(historical).toContain(id);
    expect(historical).toContain('wi-dead01');
    expect(runIdCli(['migrate', repo]).exitCode).toBe(0);
    expect(readFileSync(todoPath, 'utf8')).not.toContain(`- **ID:** ${id}\n`);

    const r = spawnSync('/bin/sh', [BIN, 'mint', repo, '--count', '5'], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    const ids = r.stdout.trim().split('\n');
    expect(ids.length).toBe(5);
    expect(new Set(ids).size).toBe(5);
    for (const id of ids) {
      expect(isValidWorkItemId(id)).toBe(true);
      expect(id).not.toBe('wi-dead01');
    }
  });

  test('an explicit project path reserves its own history under an inherited Git checkout', () => {
    const repo = makeEmptyRepo(BASE_TMP);
    const other = makeEmptyRepo(BASE_TMP);
    const path = join(repo, 'TODOS.md');
    const pending = '## Unprocessed\n### Existing entry\n';
    const retired = migrateTodosText(pending, new Set()).ids[0]!;
    writeFileSync(path, `${pending}- **ID:** ${retired}\n`);
    expect(spawnSync('git', ['add', 'TODOS.md'], { cwd: repo, env: GIT_ENV }).status).toBe(0);
    expect(spawnSync('git', ['commit', '-m', 'record the ID'], { cwd: repo, env: GIT_ENV }).status).toBe(0);
    writeFileSync(path, pending);

    const result = spawnSync('/bin/sh', [BIN, 'migrate', repo], {
      env: { ...GIT_ENV, GIT_DIR: join(other, '.git'), GIT_WORK_TREE: other },
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(path, 'utf8')).toMatch(/^- \*\*ID:\*\* wi-[0-9a-f]{6,8}$/m);
    expect(readFileSync(path, 'utf8')).not.toContain(`- **ID:** ${retired}\n`);
  });

  test('migration retains a linked docs directory and reserves IDs from its history', () => {
    const repo = makeEmptyRepo(BASE_TMP);
    const docs = join(repo, 'docs');
    const target = join(repo, 'documentation');
    mkdirSync(target);
    symlinkSync('documentation', docs);
    const todos = join(target, 'TODOS.md');
    const pending = '## Unprocessed\n### Follow-up\n';
    const retired = migrateTodosText(pending, new Set()).ids[0]!;
    writeFileSync(todos, `${pending}- **ID:** ${retired}\n`);
    expect(spawnSync('git', ['add', 'docs', 'documentation/TODOS.md'], { cwd: repo, env: GIT_ENV }).status).toBe(0);
    expect(spawnSync('git', ['commit', '-m', 'record the linked TODO'], { cwd: repo, env: GIT_ENV }).status).toBe(0);
    writeFileSync(todos, pending);

    const result = spawnSync('/bin/sh', [BIN, 'migrate', repo], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('ADDED: docs/TODOS.md (1)');
    expect(readlinkSync(docs)).toBe('documentation');
    expect(readFileSync(todos, 'utf8')).toBe(migrateTodosText(pending, new Set([retired])).text);
  });

  test('migration updates an in-project planning file once through its compatibility link', () => {
    const repo = freshDir('linked-todo');
    mkdirSync(join(repo, 'docs'));
    const path = join(repo, 'docs', 'TODOS.md');
    const alias = join(repo, 'TODOS.md');
    const pending = '## Unprocessed\n### [manual] Follow-up\n';
    writeFileSync(path, pending);
    symlinkSync('docs/TODOS.md', alias);

    const preview = runIdCli(['migrate', '--dry-run', repo]);
    expect(preview.exitCode, preview.stderr).toBe(0);
    expect(preview.stdout).toContain('ADDED: 1\nSTATUS: dry-run');
    expect(readFileSync(path, 'utf8')).toBe(pending);
    const result = runIdCli(['migrate', repo]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain('ADDED: 1\nSTATUS: ok');
    expect(readlinkSync(alias)).toBe('docs/TODOS.md');
    expect(readFileSync(path, 'utf8')).toBe(migrateTodosText(pending, new Set()).text);
    expect(runIdCli(['migrate', repo]).stdout).toContain('STATUS: unchanged');
  });

  test('migration refuses to treat one file as two planning document types', () => {
    const repo = freshDir('mixed-planning-alias');
    const path = join(repo, 'TODOS.md');
    const original = '## Unprocessed\n### [manual] Follow-up\n';
    writeFileSync(path, original);
    symlinkSync('TODOS.md', join(repo, 'ROADMAP.md'));

    const result = runIdCli(['migrate', repo]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('multiple planning document types refer to the same file');
    expect(readFileSync(path, 'utf8')).toBe(original);
  });

  test('migration stops before writing any file when a planning document is not UTF-8', () => {
    const repo = freshDir('legacy-encoding');
    const roadmap = join(repo, 'ROADMAP.md');
    const todos = join(repo, 'TODOS.md');
    const card = '## Current Plan\n### Group 1: Work\n#### Track 1A: First\n_1 task . low risk_\n';
    const legacy = Buffer.concat([
      Buffer.from('## Unprocessed\n### Existing entry\n<!-- legacy encoding '),
      Buffer.from([0xa0]),
      Buffer.from(' -->\n'),
    ]);
    writeFileSync(roadmap, card);
    writeFileSync(todos, legacy);

    const result = runIdCli(['migrate', repo]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('not valid UTF-8: TODOS.md');
    expect(readFileSync(roadmap, 'utf8')).toBe(card);
    expect(readFileSync(todos)).toEqual(legacy);
  });

  test.each([
    'direct', 'relative project alias', 'relative project alias with literal Git pathspecs',
    'absolute project alias', 'removed project alias',
  ])('migration reserves IDs from the previous location of linked project docs (%s)', (layout) => {
    const repo = makeEmptyRepo(BASE_TMP);
    const docs = join(repo, 'docs');
    mkdirSync(join(repo, 'planning'));
    mkdirSync(join(repo, 'documentation'));
    const pending = '## Unprocessed\n### Follow-up\n';
    const previous = migrateTodosText(pending, new Set());
    const projectAlias = join(BASE_TMP, basename(repo) + '-alias');
    let oldLink = 'planning';
    if (layout.startsWith('relative project alias')) oldLink = '../' + basename(repo) + '/planning';
    if (layout === 'absolute project alias' || layout === 'removed project alias') {
      symlinkSync(repo, projectAlias);
      oldLink = join(projectAlias, 'planning');
    }
    symlinkSync(oldLink, docs);
    const oldTodo = join(repo, 'planning', 'TODOS.md');
    const newTodo = join(repo, 'documentation', 'TODOS.md');
    const commit = (message: string, paths: string[]) => {
      expect(spawnSync('git', ['add', '--', ...paths], { cwd: repo, env: GIT_ENV }).status).toBe(0);
      expect(spawnSync('git', ['commit', '-m', message], { cwd: repo, env: GIT_ENV }).status).toBe(0);
    };
    writeFileSync(oldTodo, previous.text);
    commit('record first follow-up', ['docs', 'planning/TODOS.md']);
    const preview = spawnSync('/bin/sh', [BIN, 'migrate', '--dry-run', repo], { encoding: 'utf8' });
    expect(preview.status, preview.stderr).toBe(0);
    writeFileSync(oldTodo, '## Unprocessed\n');
    commit('retire first follow-up', ['planning/TODOS.md']);
    unlinkSync(docs);
    symlinkSync('documentation', docs);
    writeFileSync(newTodo, pending);
    commit('move planning docs and add new follow-up', ['docs', 'documentation/TODOS.md']);
    if (layout === 'removed project alias') unlinkSync(projectAlias);

    const env = layout.endsWith('literal Git pathspecs') ? { ...GIT_ENV, GIT_LITERAL_PATHSPECS: '1' } : GIT_ENV;
    const result = spawnSync('/bin/sh', [BIN, 'migrate', repo], { env, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(readlinkSync(docs)).toBe('documentation');
    expect(readFileSync(newTodo, 'utf8')).toBe(migrateTodosText(pending, new Set(previous.ids)).text);
  });

  test.each([
    { docsTarget: 'current/planning', linkLeaf: '' },
    { docsTarget: 'current/../planning', linkLeaf: 'nested' },
    { docsTarget: 'current/../../current/../planning', linkLeaf: 'nested' },
  ])('migration reserves retired IDs when the planning link moves ($docsTarget)', ({ docsTarget, linkLeaf }) => {
    const repo = makeEmptyRepo(BASE_TMP);
    const docs = join(repo, 'docs');
    const current = join(repo, 'current');
    for (const release of ['release-v1', 'release-v2']) {
      mkdirSync(join(repo, release, linkLeaf), { recursive: true });
      mkdirSync(join(repo, release, 'planning'));
    }
    symlinkSync(docsTarget, docs);
    symlinkSync(join('release-v1', linkLeaf), current);
    const oldTodo = join(repo, 'release-v1/planning/TODOS.md');
    const newTodo = join(repo, 'release-v2/planning/TODOS.md');
    const pending = '## Unprocessed\n### Follow-up\n';
    const retired = migrateTodosText(pending, new Set());
    const commit = (message: string, paths: string[]) => {
      expect(spawnSync('git', ['add', '--', ...paths], { cwd: repo, env: GIT_ENV }).status).toBe(0);
      expect(spawnSync('git', ['commit', '-m', message], { cwd: repo, env: GIT_ENV }).status).toBe(0);
    };
    writeFileSync(oldTodo, retired.text);
    commit('record first follow-up', ['docs', 'current', 'release-v1/planning/TODOS.md']);
    writeFileSync(oldTodo, '## Unprocessed\n');
    commit('retire first follow-up', ['release-v1/planning/TODOS.md']);
    unlinkSync(current);
    symlinkSync(join('release-v2', linkLeaf), current);
    writeFileSync(newTodo, pending);
    commit('move the active planning directory', ['current', 'release-v2/planning/TODOS.md']);

    const result = spawnSync('/bin/sh', [BIN, 'migrate', repo], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(readlinkSync(docs)).toBe(docsTarget);
    expect(readFileSync(newTodo, 'utf8')).toBe(migrateTodosText(pending, new Set(retired.ids)).text);
  });

  test('rewrite uses the live label over a shipped label and reads legacy archive Groups', () => {
    const repo = freshDir('rewrite');
    mkdirSync(join(repo, 'docs'));
    writeFileSync(join(repo, 'docs', 'roadmap-shipped.md'), [
      '## Shipped', '### Track 1A: Retired ✓ Shipped', '_id: wi-aaaaaa_',
      '## Group 2: Legacy', '- Track 2A — Shipped', '',
    ].join('\n'));
    const path = join(repo, 'ROADMAP.md');
    writeFileSync(path, [
      '## Current Plan', '### Group 1: Current',
      '#### Track 1A: Live', '_1 task . low risk_', '_id: wi-bbbbbb_',
      '#### Track 1B: Blocked', '_1 task . low risk_',
      '_blocked-by: Track 1A, Track 2A   , Track 1A (live, required)_', '',
    ].join('\n'));
    expect(runIdCli(['migrate', '--rewrite-blocked-by', repo]).exitCode).toBe(0);
    const archive = readFileSync(join(repo, 'docs', 'roadmap-shipped.md'), 'utf8');
    const legacyId = archive.match(/^- Track 2A — \*\*ID:\*\* (wi-[0-9a-f]+) —/m)?.[1];
    expect(legacyId).toBeDefined();
    expect(readFileSync(path, 'utf8')).toContain(`_blocked-by: wi-bbbbbb, ${legacyId}   , Track 1A (live, required)_`);
  });

  test('migration retains CRLF and the existing spaces before a Future trigger', () => {
    const input = '## Future\r\n  - A plain entry    **Revisit when:** ready.\r\n';
    const result = migrateFutureText(input, new Set());
    expect(result.added).toBe(1);
    expect(result.text.replace(` — **ID:** ${result.ids[0]}`, '')).toBe(input);
    expect(migrateFutureText(result.text, new Set()).text).toBe(result.text);
  });

  test('a Future bullet with an inline code example receives one work-item ID', () => {
    const source = '## Future\n- Document the format `Example — **ID:** wi-aabbcc`\n';
    const migrated = migrateFutureText(source, new Set());
    expect(migrated.added).toBe(1);
    expect(extractInlineBulletId(migrated.text.split('\n')[1]!)).toEqual({
      raw: migrated.ids[0], id: migrated.ids[0],
    });
    expect(migrated.text.replace(` — **ID:** ${migrated.ids[0]}`, '')).toBe(source);
    expect(migrateFutureText(migrated.text, new Set()).text).toBe(migrated.text);
    expect(extractInlineBulletId('- **Read** — **ID:** wi-a1b2c3 — `Example — **ID:** wi-aabbcc`')).toEqual({
      raw: 'wi-a1b2c3', id: 'wi-a1b2c3',
    });
  });

  test('an inline code span in a Future title leaves its assigned ID intact', () => {
    const bullet = '- **Document `**ID:**` in recipes** — **ID:** wi-aabbcc — Keep examples. **Revisit when:** next release';
    const source = `## Future\n${bullet}\n`;
    expect(extractInlineBulletId(bullet)).toEqual({ raw: 'wi-aabbcc', id: 'wi-aabbcc' });
    expect(migrateFutureText(source, new Set())).toEqual({ text: source, added: 0, ids: [] });
  });

  test('a descriptive Future heading is migrated without changing the trigger', () => {
    const source = '## Future (deferred) — next release\n- **Follow-up**: More work. **Revisit when:** - use **Phase 2** — after GA\n';
    expect(parseRoadmap(source).value.futureBullets).toEqual([source.split('\n')[1]]);
    const migrated = migrateFutureText(source, new Set());
    expect(migrated.added).toBe(1);
    expect(extractInlineBulletId(migrated.text.split('\n')[1]!)?.id).toBe(migrated.ids[0]);
    expect(migrated.text.replace(` — **ID:** ${migrated.ids[0]}`, '')).toBe(source);
    expect(migrateFutureText(migrated.text, new Set()).text).toBe(migrated.text);
  });

  test('a Future title ending in italic emphasis retains its assigned ID', () => {
    const bullet = '- **Read *this*** — **ID:** wi-aabbcc — Keep context. **Revisit when:** next release';
    const source = '## Future\n' + bullet + '\n';
    expect(extractInlineBulletId(bullet)?.id).toBe('wi-aabbcc');
    expect(migrateFutureText(source, new Set())).toEqual({ text: source, added: 0, ids: [] });
  });

  test('a leading field after a plain or partly bold Future title stays assigned', () => {
    for (const title of ['Plain title', '**One** and **Two**', '**Title** (follow-up)']) {
      const bullet = '- ' + title + ' — **ID:** wi-aabbcc — Keep context.';
      const source = '## Future\n' + bullet + '\n';
      expect(extractInlineBulletId(bullet)?.id).toBe('wi-aabbcc');
      expect(migrateFutureText(source, new Set())).toEqual({ text: source, added: 0, ids: [] });
    }
  });

  test('migration ends Future at the separate Future-proof notes heading', () => {
    const notes = '## Future-proof rollout notes\n- Keep the old link\n';
    const source = '## Future — after release\n- Draft a follow-up\n' + notes;
    const result = migrateFutureText(source, new Set());
    expect(result.added).toBe(1);
    expect(result.text).toBe('## Future — after release\n- Draft a follow-up — **ID:** ' + result.ids[0] + '\n' + notes);
  });

  test('inline shipped and legacy archive receipts cannot shadow a unique live blocker', () => {
    const repo = freshDir('ambiguous-archive');
    mkdirSync(join(repo, 'docs'));
    writeFileSync(join(repo, 'docs', 'roadmap-shipped.md'), [
      '## Group 1: Legacy', '- Track 2A — **ID:** wi-222221 — First receipt.',
      '- Track 2A — **ID:** wi-222222 — Second receipt.', '',
    ].join('\n'));
    const roadmap = join(repo, 'ROADMAP.md');
    writeFileSync(roadmap, [
      '## Current Plan', '### Group 3: Current',
      '#### Track 1A: Live', '_1 task . low risk_', '_id: wi-111111_',
      '#### Track 3B: Blocked', '_1 task . low risk_', '_blocked-by: Track 1A, Track 2A_',
      '## Shipped', '### Track 1A: Older receipt ✓ Shipped', '_id: wi-111112_',
      '### Track 2A: Third receipt ✓ Shipped', '_id: wi-222223_', '',
    ].join('\n'));

    expect(runIdCli(['migrate', '--rewrite-blocked-by', repo]).exitCode).toBe(0);
    expect(readFileSync(roadmap, 'utf8')).toContain('_blocked-by: wi-111111, Track 2A_');
  });

  test('blocker rewriting preserves nested notes and labels with ambiguous IDs', () => {
    const blockers = '_blocked-by: Track 1A, Track 1C, Track 1B (prep, Track 1D, another check (optional)), Track 1D_';
    const source = [
      '## Current Plan', '### Group 1: Current',
      '#### Track 1A: First', '_id: wi-aabbcc_',
      '#### Track 1B: Second', '_id: wi-aabbcc_',
      '#### Track 1C: Third', '_id: wi-bbccdd_', '_id: wi-ccdd11_',
      '#### Track 1D: Fourth', '_id: wi-ddee11_',
      '#### Track 1E: Follow-up', '_id: wi-eeff11_', blockers, '',
    ].join('\n');
    const result = migrateRoadmapText(source, new Set(), { rewriteBlockedBy: true });
    expect(result.text).toBe(source.replace(blockers,
      '_blocked-by: Track 1A, Track 1C, Track 1B (prep, Track 1D, another check (optional)), wi-ddee11_'));
  });

  test('blocker rewriting keeps the references on an inline shipped receipt', () => {
    const roadmap = [
      '## Current Plan', '### Group 1: Live',
      '#### Track 1A: Later work', '_id: wi-111111_',
      '#### Track 1B: Live follow-up', '_id: wi-222222_', '_blocked-by: Track 1A_',
      '## Shipped', '### Track 2A: Earlier work ✓ Shipped', '_id: wi-333333_', '_blocked-by: Track 1A_', '',
    ].join('\n');
    const result = migrateRoadmapText(roadmap, new Set(), { rewriteBlockedBy: true });
    expect(result.text).toBe(roadmap.replace('_blocked-by: Track 1A_', '_blocked-by: wi-111111_'));
  });

  test('migration inserts a Track ID after metadata ending directly after the risk level', () => {
    const card = '## Current Plan\n### Group 1: Work\n#### Track 1A: First\n_1 task · ~1 LOC · low_\n';
    const result = migrateRoadmapText(card, new Set());
    expect(result.text).toBe(`${card}_id: ${result.ids[0]}_\n`);
  });

  test('migration places the ID below a task-count line that still needs a risk level', () => {
    const card = '## Current Plan\n### Group 1: Work\n#### Track 1A: First\n_2 tasks · ~80 LOC_\n';
    const result = migrateRoadmapText(card, new Set());
    expect(result.text).toBe(`${card}_id: ${result.ids[0]}_\n`);
  });

  test('migration of a CRLF Group receipt neither changes its bytes nor re-adds its ID on rerun', () => {
    const original = '## Shipped\r\n#### Group 3: Old\r\n- Track 3A — Shipped.\r\n';
    const migrated = migrateRoadmapText(original, new Set());
    expect(migrated.added).toBe(1);
    expect(migrated.text.replace(`**ID:** ${migrated.ids[0]} — `, '')).toBe(original);
    expect(migrateRoadmapText(migrated.text, new Set()).text).toBe(migrated.text);
  });

  test('a Track note in an active Group stays prose while archived Group receipts get IDs', () => {
    const active = [
      '## Current Plan', '```markdown', '## Shipped', '```',
      '### Group 1: Current', '- Track 1A — wait for the owner review.',
      '#### Track 1A: First', '_1 task . low risk_', '_id: wi-aabbcc_', '_touches: src/first.ts_', '',
    ].join('\n');
    const parsed = parseRoadmap(active).value;
    expect(parsed.legacyShippedTracks).toEqual([]);
    expect(parsed.tracks[0]?.state).toBe('current-plan');
    expect(parsed.tracks[0]?.isComplete).toBe(false);
    const untouched = migrateRoadmapText(active, new Set());
    expect(untouched.added).toBe(0);
    expect(untouched.text).toBe(active);

    const archive = '## Group 2: History\n- Track 2A — Shipped.\n';
    const migrated = migrateRoadmapText(archive, new Set(), { fromShippedArchive: true });
    expect(migrated.added).toBe(1);
    expect(parseRoadmap(migrated.text, { fromShippedArchive: true }).value.legacyShippedTracks?.[0]?.workItemId)
      .toBe(migrated.ids[0]);
  });

  test('an archived Track ID sits immediately below its heading before an italic note', () => {
    const heading = '### Track 1A: Delivered ✓ Shipped\n';
    const receipt = '## Shipped\n' + heading + '_Follow-up notes_\n';
    const result = migrateRoadmapText(receipt, new Set(), { fromShippedArchive: true });
    expect(result.text).toBe(receipt.replace(heading, heading + '_id: ' + result.ids[0] + '_\n'));
  });

  test('code spans and inline attribute prose leave later Future records visible', () => {
    const original = [
      '## Future', '```code``` explains the entry below.',
      '- **Entry** — Text mentions — **ID:** as a label here. **Revisit when:** ready.',
    ].join('\n');
    const migrated = migrateFutureText(original, new Set());
    expect(migrated.added).toBe(1);
    const bullet = migrated.text.split('\n')[2]!;
    expect(extractInlineBulletId(bullet)).toEqual({ raw: migrated.ids[0], id: migrated.ids[0] });
  });

  test('TODO migration and audit agree on checklist, link and legacy entry boundaries', () => {
    const withNotes = [
      '## Unprocessed', '### [manual] Follow-up', '- [ ] Take a note',
      '- [Spec](docs/SPEC.md)', '- **[Guide](docs/guide.md)**', '- **ID:** wi-aabbcc', '',
    ].join('\n');
    const entries = parseTodos(withNotes).value.entries;
    expect(entries.map(entry => [entry.kind, entry.workItemId])).toEqual([['heading', 'wi-aabbcc']]);
    expect(migrateTodosText(withNotes, new Set()).text).toBe(withNotes);

    const legacy = '## Unprocessed\n### [manual] First\n- [review] Legacy item\n- **ID:** wi-112233\n';
    const migrated = migrateTodosText(legacy, new Set(['wi-112233']));
    expect(migrated.added).toBe(1);
    expect(migrated.text).toBe(legacy.replace('### [manual] First\n',
      '### [manual] First\n- **ID:** ' + migrated.ids[0] + '\n'));
  });

  test.each([
    { label: 'heading needs an ID', ownId: '' },
    { label: 'heading already has an ID', ownId: 'wi-aabbcc' },
  ])('Completed legacy records keep their IDs separate ($label)', ({ ownId }) => {
    const markdown = [
      '## Completed', '### Completed heading', ...(ownId === '' ? [] : ['- **ID:** ' + ownId]),
      '- [manual] Earlier legacy entry', '- **ID:** wi-112233', '',
    ].join('\n');
    const before = parseTodos(markdown).value;
    expect(before.completedIds).toContain('wi-112233');
    expect(before.completedEntries![0]!.workItemId).toBe(ownId || null);
    expect(before.completedEntries![0]!.workItemIdError).toBeNull();

    const migrated = migrateTodosText(markdown, new Set(before.completedIds));
    expect(migrated.added).toBe(ownId === '' ? 1 : 0);
    const id = ownId || migrated.ids[0]!;
    expect(migrated.text).toBe(ownId === '' ? markdown.replace(
      '### Completed heading\n',
      '### Completed heading\n- **ID:** ' + id + '\n',
    ) : markdown);
    expect(parseTodos(migrated.text).value.completedIds).toEqual([id, 'wi-112233']);
    expect(migrateTodosText(migrated.text, new Set([id, 'wi-112233'])).added).toBe(0);
  });

  test('migrate --dry-run, migrate, and idempotent second run', () => {
    const repo = freshDir('migrate-cli');
    mkdirSync(join(repo, 'docs'), { recursive: true });
    const todosPath = join(repo, 'docs', 'TODOS.md');
    const original = '# TODOS\n\n## Unprocessed\n\n### [manual] One\n\n- **Why:** x\n';
    writeFileSync(todosPath, original);

    const dry = runIdCli(['migrate', '--dry-run', repo]);
    expect(dry.exitCode).toBe(0);
    expect(dry.stdout).toContain('ADDED: 1');
    expect(dry.stdout).toContain('STATUS: dry-run');
    expect(readFileSync(todosPath, 'utf8')).toBe(original);

    const run1 = runIdCli(['migrate', repo]);
    expect(run1.exitCode).toBe(0);
    expect(run1.stdout).toContain('ADDED: 1');
    expect(run1.stdout).toContain('STATUS: ok');
    const migrated = readFileSync(todosPath, 'utf8');
    expect(migrated).toMatch(/- \*\*ID:\*\* wi-[0-9a-f]{6}/);

    const run2 = runIdCli(['migrate', repo]);
    expect(run2.exitCode).toBe(0);
    expect(run2.stdout).toContain('ADDED: 0');
    expect(run2.stdout).toContain('STATUS: unchanged');
    expect(readFileSync(todosPath, 'utf8')).toBe(migrated);
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
    expect(runIdCli(['migrate', '--nope']).exitCode).toBe(2);
  });
});
