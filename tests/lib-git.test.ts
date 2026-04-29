import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createGitGateway,
  type GitSpawn,
  type GitSpawnResult,
} from '../src/audit/lib/git.ts';

// ─── Mock-spawn tests (fast, deterministic) ──────────────────────────

function mockSpawn(
  responses: Record<string, GitSpawnResult>,
): GitSpawn {
  return (args) => {
    const key = args.join(' ');
    return (
      responses[key] ?? { ok: false, stdout: '', stderr: 'no canned response' }
    );
  };
}

describe('createGitGateway — mocked', () => {
  test('toplevel: trims trailing newline', () => {
    const git = createGitGateway({
      cwd: '/tmp/repo',
      spawn: mockSpawn({
        'rev-parse --show-toplevel': { ok: true, stdout: '/tmp/repo\n', stderr: '' },
      }),
    });
    expect(git.toplevel()).toBe('/tmp/repo');
  });

  test('toplevel: returns null on git failure', () => {
    const git = createGitGateway({
      cwd: '/not-a-repo',
      spawn: mockSpawn({}), // no canned response → ok: false
    });
    expect(git.toplevel()).toBeNull();
  });

  test('toplevel: returns null on empty stdout', () => {
    const git = createGitGateway({
      cwd: '/tmp',
      spawn: mockSpawn({
        'rev-parse --show-toplevel': { ok: true, stdout: '', stderr: '' },
      }),
    });
    expect(git.toplevel()).toBeNull();
  });

  test('tags: splits and strips trailing newline', () => {
    const git = createGitGateway({
      cwd: '/tmp',
      spawn: mockSpawn({
        'tag --list': {
          ok: true,
          stdout: 'v0.1.0\nv0.2.0\nv0.18.5\n',
          stderr: '',
        },
      }),
    });
    expect(git.tags()).toEqual(['v0.1.0', 'v0.2.0', 'v0.18.5']);
  });

  test('tags: empty repo returns []', () => {
    const git = createGitGateway({
      cwd: '/tmp',
      spawn: mockSpawn({
        'tag --list': { ok: true, stdout: '', stderr: '' },
      }),
    });
    expect(git.tags()).toEqual([]);
  });

  test('tags: spawn failure returns []', () => {
    const git = createGitGateway({ cwd: '/tmp', spawn: mockSpawn({}) });
    expect(git.tags()).toEqual([]);
  });

  test('tagsLatest: head of -v:refname sorted', () => {
    const git = createGitGateway({
      cwd: '/tmp',
      spawn: mockSpawn({
        '--no-pager tag --list --sort=-v:refname': {
          ok: true,
          stdout: 'v0.18.5\nv0.18.4\nv0.18.3\n',
          stderr: '',
        },
      }),
    });
    expect(git.tagsLatest()).toBe('v0.18.5');
  });

  test('tagsLatest: empty returns null', () => {
    const git = createGitGateway({
      cwd: '/tmp',
      spawn: mockSpawn({
        '--no-pager tag --list --sort=-v:refname': {
          ok: true,
          stdout: '',
          stderr: '',
        },
      }),
    });
    expect(git.tagsLatest()).toBeNull();
  });

  test('diffNamesBetween: splits names', () => {
    const git = createGitGateway({
      cwd: '/tmp',
      spawn: mockSpawn({
        '--no-pager diff --name-only v0.18.4..HEAD': {
          ok: true,
          stdout: 'src/audit/lib/semver.ts\ntests/lib-semver.test.ts\n',
          stderr: '',
        },
      }),
    });
    expect(git.diffNamesBetween('v0.18.4', 'HEAD')).toEqual([
      'src/audit/lib/semver.ts',
      'tests/lib-semver.test.ts',
    ]);
  });

  test('logFirstWithPhrase: returns {date} on hit', () => {
    const git = createGitGateway({
      cwd: '/tmp',
      spawn: mockSpawn({
        'log -1 --format=%ai -S phrase -- ROADMAP.md': {
          ok: true,
          stdout: '2026-04-29 14:00:00 -0400\n',
          stderr: '',
        },
      }),
    });
    expect(git.logFirstWithPhrase('phrase', 'ROADMAP.md')).toEqual({
      date: '2026-04-29 14:00:00 -0400',
    });
  });

  test('logFirstWithPhrase: empty stdout returns null', () => {
    const git = createGitGateway({
      cwd: '/tmp',
      spawn: mockSpawn({
        'log -1 --format=%ai -S phrase -- ROADMAP.md': {
          ok: true,
          stdout: '',
          stderr: '',
        },
      }),
    });
    expect(git.logFirstWithPhrase('phrase', 'ROADMAP.md')).toBeNull();
  });

  test('logSubjectsSince: splits commit subjects', () => {
    const git = createGitGateway({
      cwd: '/tmp',
      spawn: mockSpawn({
        'log --format=%s --after=2026-01-01 -- src/foo.ts': {
          ok: true,
          stdout: 'feat: x\nfix: y\n',
          stderr: '',
        },
      }),
    });
    expect(git.logSubjectsSince('2026-01-01', 'src/foo.ts')).toEqual([
      'feat: x',
      'fix: y',
    ]);
  });

  test('logSubjectsSince: failure returns []', () => {
    const git = createGitGateway({ cwd: '/tmp', spawn: mockSpawn({}) });
    expect(git.logSubjectsSince('2026-01-01', 'src/foo.ts')).toEqual([]);
  });

  test('phrase passed to git log -S is not regex-escaped — caller responsibility', () => {
    let captured: string[] = [];
    const git = createGitGateway({
      cwd: '/tmp',
      spawn: (args) => {
        captured = args;
        return { ok: true, stdout: '', stderr: '' };
      },
    });
    git.logFirstWithPhrase('with spaces & shell metas', 'a.md');
    // -S receives the phrase verbatim; no escaping applied (matches bash quoted arg)
    expect(captured).toEqual([
      'log',
      '-1',
      '--format=%ai',
      '-S',
      'with spaces & shell metas',
      '--',
      'a.md',
    ]);
  });
});

// ─── Real-git smoke tests (slower; verify defaultSpawn) ──────────────

describe('createGitGateway — real subprocess (smoke)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'gse-git-'));
    execSync('git init -q -b main', { cwd: tmp });
    execSync('git config user.email t@e.st', { cwd: tmp });
    execSync('git config user.name test', { cwd: tmp });
    writeFileSync(join(tmp, 'a.txt'), 'hello\n');
    execSync('git add . && git commit -qm initial', { cwd: tmp });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('toplevel resolves real repo', () => {
    const git = createGitGateway({ cwd: tmp });
    // macOS's tmpdir() is a /var/folders symlink to /private/var/folders;
    // git resolves to the real path.
    expect(git.toplevel()).not.toBeNull();
    expect(git.toplevel()).toContain('gse-git-');
  });

  test('non-repo cwd returns null', () => {
    const nonRepo = mkdtempSync(join(tmpdir(), 'gse-norepo-'));
    try {
      const git = createGitGateway({ cwd: nonRepo });
      expect(git.toplevel()).toBeNull();
    } finally {
      rmSync(nonRepo, { recursive: true, force: true });
    }
  });

  test('tags after tagging', () => {
    execSync('git tag v0.1.0 && git tag v0.2.0', { cwd: tmp });
    const git = createGitGateway({ cwd: tmp });
    const tags = git.tags();
    expect(tags).toContain('v0.1.0');
    expect(tags).toContain('v0.2.0');
  });

  test('tagsLatest with version sort', () => {
    execSync('git tag v0.1.0 && git tag v0.18.5 && git tag v0.2.0', { cwd: tmp });
    const git = createGitGateway({ cwd: tmp });
    expect(git.tagsLatest()).toBe('v0.18.5');
  });

  test('tags on empty repo (no tags) returns []', () => {
    const git = createGitGateway({ cwd: tmp });
    expect(git.tags()).toEqual([]);
    expect(git.tagsLatest()).toBeNull();
  });
});
