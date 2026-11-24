import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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
          ...process.env,
          GIT_AUTHOR_NAME: 'Test',
          GIT_AUTHOR_EMAIL: 'test@example.com',
          GIT_COMMITTER_NAME: 'Test',
          GIT_COMMITTER_EMAIL: 'test@example.com',
        },
        encoding: 'utf8',
      });
    expect(git(['init']).status).toBe(0);
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
    const historical = createGitGateway({ cwd: repo }).historicalWorkItemIds(['ROADMAP.md', 'docs/TODOS.md']);
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
      '_blocked-by: Track 1A (live, required), Track 2A_', '',
    ].join('\n'));
    expect(runIdCli(['migrate', '--rewrite-blocked-by', repo]).exitCode).toBe(0);
    const archive = readFileSync(join(repo, 'docs', 'roadmap-shipped.md'), 'utf8');
    const legacyId = archive.match(/^- Track 2A — \*\*ID:\*\* (wi-[0-9a-f]+) —/m)?.[1];
    expect(legacyId).toBeDefined();
    expect(readFileSync(path, 'utf8')).toContain(`_blocked-by: wi-bbbbbb, ${legacyId}_`);
  });

  test('migration retains CRLF and the existing spaces before a Future trigger', () => {
    const input = '## Future\r\n  - A plain entry    **Revisit when:** ready.\r\n';
    const result = migrateFutureText(input, new Set());
    expect(result.added).toBe(1);
    expect(result.text.replace(` — **ID:** ${result.ids[0]}`, '')).toBe(input);
    expect(migrateFutureText(result.text, new Set()).text).toBe(result.text);
  });

  test('migration inserts a Track ID after metadata ending directly after the risk level', () => {
    const card = '## Current Plan\n### Group 1: Work\n#### Track 1A: First\n_1 task · ~1 LOC · low_\n';
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
