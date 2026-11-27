/**
 * audit-cli-contract.test.ts — explicit CLI contract for bin/roadmap-audit.
 *
 * D13 + TODO 2/C scope expansion: codex (#5) flagged that "full parity"
 * for a CLI tool means more than stdout — exit codes, stderr, malformed
 * input behavior, env handling. The snapshot suite covers stdout only;
 * this file pins the rest.
 *
 * Locked contract (verified by probing the bash binary 2026-04-30):
 *   - exit code is ALWAYS 0 (audit is lenient — no fatal modes)
 *   - stderr is ALWAYS empty
 *   - bogus flags pass through silently (no validation)
 *   - missing/invalid repo path → "No ROADMAP.md found" skip path
 *   - malformed ROADMAP.md → graceful per-section STATUS (fail/warn)
 *   - --scan-state emits JSON for any repo, including empty
 *
 * Why lock these: a future refactor may legitimately change exit code
 * semantics (e.g., exit 1 on missing ROADMAP). That's a contract change
 * skill consumers (`/roadmap`) need to know about. This
 * file makes those changes deliberate, not silent.
 *
 * NEW in Track 3A — no equivalent in scripts/test-*.sh.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { GIT_ENV, makeBaseTmp, makeEmptyRepo } from './helpers/fixture-repo.ts';
import { parseAuditSections } from '../src/audit/sections.ts';
import { runBin } from './helpers/run-bin.ts';

const ROOT = join(import.meta.dir, '..');
const AUDIT = join(ROOT, 'bin', 'roadmap-audit');

const baseTmp = makeBaseTmp('audit-cli-contract-');
const stateDir = join(baseTmp, 'state');
const homeDir = join(baseTmp, 'home');
mkdirSync(stateDir, { recursive: true });
mkdirSync(homeDir, { recursive: true });

afterAll(() => {
  try { rmSync(baseTmp, { recursive: true, force: true }); } catch {}
});

function run(args: string[]) {
  return runBin(AUDIT, args, {
    home: homeDir,
    gstackExtendDir: ROOT,
    gstackExtendStateDir: stateDir,
    // Run from a non-repo cwd so audit's no-args / no-repo-arg paths
    // don't accidentally pick up the gstack-extend repo itself.
    cwd: baseTmp,
    // Tighter timeout — these tests run fast paths (no ROADMAP).
    timeout: 10_000,
  });
}

// Plant a malformed-shape ROADMAP.md and commit it. Used by three
// graceful-degradation tests below.
function seedRoadmap(repo: string, content: string): void {
  mkdirSync(join(repo, 'docs'), { recursive: true });
  writeFileSync(join(repo, 'docs', 'ROADMAP.md'), content);
  spawnSync('git', ['-C', repo, 'add', '-A'], { encoding: 'utf8' });
  spawnSync('git', ['-C', repo, 'commit', '-m', 'seed', '--quiet'], { encoding: 'utf8' });
}

describe('audit CLI contract: exit code is always 0', () => {
  test('no args', () => {
    expect(run([]).exitCode).toBe(0);
  });

  test('valid empty repo', () => {
    const repo = makeEmptyRepo(baseTmp);
    expect(run([repo]).exitCode).toBe(0);
  });

  test('nonexistent repo path', () => {
    expect(run(['/tmp/this-path-does-not-exist-zzz']).exitCode).toBe(0);
  });

  test('file (not directory) as repo path', () => {
    expect(run(['/etc/hosts']).exitCode).toBe(0);
  });

  test('bogus flag', () => {
    const repo = makeEmptyRepo(baseTmp);
    expect(run(['--bogus-flag-not-real', repo]).exitCode).toBe(0);
  });

  test('--scan-state on empty repo', () => {
    const repo = makeEmptyRepo(baseTmp);
    expect(run(['--scan-state', repo]).exitCode).toBe(0);
  });

  test('malformed ROADMAP.md', () => {
    const repo = makeEmptyRepo(baseTmp);
    seedRoadmap(repo, 'completely\nbroken\nnot a roadmap\n');
    expect(run([repo]).exitCode).toBe(0);
  });
});

describe('audit CLI contract: stderr is always empty', () => {
  // Mirrors D13 stderr-empty assertion in audit-snapshots.test.ts, but
  // covers the error-paths the snapshot suite doesn't exercise.
  test('no args', () => {
    expect(run([]).stderr).toBe('');
  });

  test('nonexistent repo', () => {
    expect(run(['/tmp/this-path-does-not-exist-zzz']).stderr).toBe('');
  });

  test('bogus flag', () => {
    const repo = makeEmptyRepo(baseTmp);
    expect(run(['--bogus-flag-not-real', repo]).stderr).toBe('');
  });

  test('malformed ROADMAP.md', () => {
    const repo = makeEmptyRepo(baseTmp);
    seedRoadmap(repo, '## Group 1\nNo colon.\n');
    expect(run([repo]).stderr).toBe('');
  });
});

describe('audit CLI contract: graceful handling of bad input', () => {
  test('missing ROADMAP.md → skip via "No ROADMAP.md found"', () => {
    const repo = makeEmptyRepo(baseTmp);
    const r = run([repo]);
    expect(r.stdout).toContain('No ROADMAP.md found');
  });

  test('--future-index prints an index even on an empty repo', () => {
    const repo = makeEmptyRepo(baseTmp);
    const r = run(['--future-index', repo]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('FUTURE_INDEX: 0');
    expect(r.stdout).toContain('FUTURE_TRIGGERS_MISSING: 0');
  });

  // Value: protects=the roadmap skill's --future-index read surfaces each satellite bullet's inline Revisit-when
  //   trigger through the real CLI; fails_when=satellite Future bullets are normalized or truncated before indexing,
  //   or the CLI stops printing the trigger; why_new=parsers-roadmap.test.ts feeds literal strings to
  //   formatFutureIndex and never crosses the process boundary; seam=none
  test('--future-index on a split repo merges satellite bullets and their revisit triggers', () => {
    const repo = makeEmptyRepo(baseTmp);
    mkdirSync(join(repo, 'docs'), { recursive: true });
    writeFileSync(
      join(repo, 'docs', 'ROADMAP.md'),
      '# Roadmap\n\n## Future\n\nDeferred: docs/roadmap-future.md (2 items)\n\n## Shipped\n\nHistory: docs/roadmap-shipped.md\n',
    );
    writeFileSync(
      join(repo, 'docs', 'roadmap-future.md'),
      '# Future\n\n## Future\n\n- **Keep the context** — filed from a review.\n'
        + '- **Parser v2** — Handle the new format. **Revisit when:** a second tenant is admitted.\n',
    );
    writeFileSync(
      join(repo, 'docs', 'roadmap-shipped.md'),
      '# Shipped\n\n## Shipped\n',
    );
    const r = run(['--future-index', repo]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('FUTURE_INDEX: 2');
    expect(r.stdout).toContain('FUTURE_TRIGGERS_MISSING: 1');
    expect(r.stdout).toContain('Keep the context');
    expect(r.stdout).toContain('filed from a review.');
    const lines = r.stdout.split('\n');
    expect(lines.find((l) => l.includes('Keep the context')))
      .toBe('- **Keep the context** — filed from a review. — revisit: MISSING');
    expect(lines.find((l) => l.includes('Parser v2')))
      .toBe('- **Parser v2** — Handle the new format. — revisit: a second tenant is admitted');
  });

  test.each([
    {
      label: 'revisit text in a Future title',
      bullet: '- Preserve the **Revisit when:** marker — Keep the field predictable.',
      missing: 1,
      row: '- **Preserve the **Revisit when:** marker** — Keep the field predictable. — revisit: MISSING',
    },
    {
      label: 'ID text in a Future description',
      bullet: '- **Clarify help output** — Include a final example line — **ID:** pending **Revisit when:** Next release.',
      missing: 0,
      row: '- **Clarify help output** — Include a final example line — **ID:** pending — revisit: Next release',
    },
  ])('--future-index preserves $label', ({ bullet, missing, row }) => {
    const repo = makeEmptyRepo(baseTmp);
    seedRoadmap(repo, `# Roadmap\n\n## Future\n${bullet}\n`);
    const index = run(['--future-index', repo]);
    expect(index.exitCode).toBe(0);
    expect(index.stdout).toBe(`FUTURE_INDEX: 1\nFUTURE_TRIGGERS_MISSING: ${missing}\n${row}\n`);

    const audit = run([repo]);
    expect(audit.exitCode).toBe(0);
    expect(audit.stdout).toContain('## WORK_ITEM_IDS\nSTATUS: fail\nFINDINGS:\n- MISSING_ID:');
  });

  // Value: protects=the observed undercount cannot pass SIZE again: a card whose task title merely contains a
  //   marker substring (Executable) is weighed through the real CLI and size-caps; fails_when=marker matching
  //   reverts to substrings; why_new=unit tests do not cross the CLI and size-caps boundary; seam=none;
  //   no_claim=installed-skill planning acceptance (Track 25B)
  // The Track declares a non-empty _touches: line (without one SIZE treats it as legacy and skips it). runBin
  // isolates the state directory, so the ceiling is the code default 4 regardless of the user's config.
  test('SIZE weighs a task whose title contains a marker substring', () => {
    const repo = makeEmptyRepo(baseTmp);
    seedRoadmap(
      repo,
      '# Roadmap\n\n## Current Plan\n\n## Group 1: G\n\n### Track 1A: Heavy\n'
        + '_2 tasks . high risk . [core/big.py]_\n_touches: core/big.py_\n\n'
        + '- **Executable foo** -- . (L)\n- **Bar** -- . (L)\n\n## Unprocessed\n',
    );
    const r = run([repo]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('1A: session_weight=8 exceeds max_session_weight=4');
  });

  test('--scan-state always emits valid JSON', () => {
    const repo = makeEmptyRepo(baseTmp);
    const r = run(['--scan-state', repo]);
    // Should parse without error.
    const parsed = JSON.parse(r.stdout);
    expect(typeof parsed).toBe('object');
    expect(parsed).toHaveProperty('signals');
    expect(parsed).toHaveProperty('intents');
  });

  test('--scan-state signals schema is pinned (regression guard for renames)', () => {
    // Track 6A renamed the section STALENESS → VERSION_TAG_STALENESS and the
    // JSON key staleness_fail → version_tag_staleness_fail. Assert every
    // dispatcher-consumed key explicitly. Adding a new signal here is
    // intentional friction — skills/roadmap.md consumes this contract.
    // Note: empty repo emits `signals: null` (GREENFIELD path) — must seed a
    // ROADMAP.md to reach the keyed-signals branch.
    const repo = makeEmptyRepo(baseTmp);
    seedRoadmap(repo, '## Group 1: Foo\n#### Track 1A: Bar\n_touches: a.ts_\n- thing\n');
    const r = run(['--scan-state', repo]);
    const parsed = JSON.parse(r.stdout) as { signals: Record<string, unknown> };
    const signalKeys = Object.keys(parsed.signals).sort();
    expect(signalKeys).toEqual([
      'git_inferred_freshness',
      'has_zero_open_group',
      'in_flight_groups',
      'origin_total',
      'unprocessed_count',
      'version_tag_staleness_fail',
    ]);
    // Old key must NOT come back — explicit guard against revert.
    expect(parsed.signals).not.toHaveProperty('staleness_fail');
  });

  test('malformed ROADMAP produces at least one fail/warn STATUS', () => {
    const repo = makeEmptyRepo(baseTmp);
    seedRoadmap(repo, '## Group 1: Foo\n\nNo Tracks.\n');
    const r = run([repo]);
    // At least one section reports fail or warn — the audit detected SOMETHING wrong.
    expect(/^STATUS: (fail|warn)$/m.test(r.stdout)).toBe(true);
  });
});

// Codex-flagged: the prior 'GSTACK_EXTEND_STATE_DIR is honored' test
// asserted exitCode + empty stderr only — both of which would pass even if
// the override were silently ignored. Removed rather than left as a false-
// negative test. The override IS exercised by audit-shadow / audit-snapshots
// (per-test stateDir), and bin/roadmap-audit doesn't write any state today
// (verified during Track 3A). Reintroduce when the audit gains state-write
// behavior with an actual marker file to assert.

describe('per-record intake audit', () => {
  const roadmap = '## In Progress\n\n## Current Plan\n\n## Future\n\n## Shipped\n';
  const record = (id: string) => '### [review] Follow-up ' + id + '\n- **ID:** ' + id + '\n';
  const section = (stdout: string, name: string) =>
    parseAuditSections(stdout).find(entry => entry.name === name)?.body.join('\n');

  test('counts records in both audit modes when no TODOS.md exists', () => {
    const repo = makeEmptyRepo(baseTmp);
    seedRoadmap(repo, roadmap);
    const intake = join(repo, 'docs', 'todos');
    mkdirSync(intake);
    writeFileSync(join(intake, '.gitkeep'), '');
    writeFileSync(join(intake, 'wi-a1b2c3.md'), record('wi-a1b2c3'));
    const audit = run([repo]);
    expect(audit.exitCode).toBe(0);
    expect(audit.stderr).toBe('');
    expect(section(audit.stdout, 'UNPROCESSED')).toContain('ITEMS: 1\nINTAKE_FILES: 1');
    expect(section(audit.stdout, 'UNPROCESSED')).toContain('STATUS: found');
    expect(section(audit.stdout, 'TODO_FORMAT')).toContain('STATUS: pass');
    expect(JSON.parse(run(['--scan-state', repo]).stdout).signals.unprocessed_count).toBe(1);
  });

  test('flags non-directory intake paths and unsafe entries without following them', () => {
    const repo = makeEmptyRepo(baseTmp);
    seedRoadmap(repo, roadmap);
    const intake = join(repo, 'docs', 'todos');
    writeFileSync(intake, '');
    const malformed = run([repo]);
    expect(malformed.exitCode).toBe(0);
    expect(malformed.stderr).toBe('');
    expect(section(malformed.stdout, 'TODO_FORMAT')).toContain('MALFORMED_INTAKE_FILE: docs/todos');
    rmSync(intake);
    mkdirSync(intake);
    mkdirSync(join(intake, 'nested'));
    writeFileSync(join(intake, 'unexpected.txt'), 'text');
    symlinkSync('../ROADMAP.md', join(intake, 'wi-a1b2c3.md'));
    const audit = run([repo]);
    expect(audit.exitCode).toBe(0);
    expect(audit.stderr).toBe('');
    expect(section(audit.stdout, 'TODO_FORMAT')).toContain('MALFORMED_INTAKE_FILE: docs/todos/wi-a1b2c3.md');
    expect(section(audit.stdout, 'TODO_FORMAT')).toContain('MALFORMED_INTAKE_FILE: docs/todos/nested');
    expect(section(audit.stdout, 'TODO_FORMAT')).toContain('MALFORMED_INTAKE_FILE: docs/todos/unexpected.txt');
    expect(section(audit.stdout, 'DOC_INVENTORY')).not.toContain('docs/todos/');
  });

  test.each([
    ['Setext wrapper', 'Unprocessed\n-----------\n\n', ''],
    ['tab-separated wrapper', '##\tUnprocessed\n\n', ''],
    ['second H3', '', '\n ### Second section\n'],
    ['BOM-prefixed frontmatter', '\uFEFF---\nname: metadata\n---\n\n', ''],
    ['leading priority attribute', '- **Priority:** P0\n\n', ''],
  ])('rejects a %s in a per-record intake file', (_, prefix, suffix) => {
    const repo = makeEmptyRepo(baseTmp);
    const intake = join(repo, 'docs', 'todos');
    mkdirSync(intake, { recursive: true });
    writeFileSync(join(intake, 'wi-a1b2c3.md'), prefix + record('wi-a1b2c3') + suffix);
    const audit = run([repo]);
    expect(audit.exitCode).toBe(0);
    expect(audit.stderr).toBe('');
    expect(section(audit.stdout, 'TODO_FORMAT')).toContain('STATUS: fail');
  });

  test('accepts quoted headings in intake prose', () => {
    const repo = makeEmptyRepo(baseTmp);
    const intake = join(repo, 'docs', 'todos');
    mkdirSync(intake, { recursive: true });
    writeFileSync(join(intake, 'wi-a1b2c3.md'), record('wi-a1b2c3') + '\n> ## Quoted section\n');
    const audited = run([repo]);
    expect(audited.exitCode).toBe(0);
    expect(audited.stderr).toBe('');
    expect(section(audited.stdout, 'TODO_FORMAT')).toContain('STATUS: pass');
  });

  test('rejects a record heading whose only title text is the closing delimiter', () => {
    const repo = makeEmptyRepo(baseTmp);
    const intake = join(repo, 'docs', 'todos');
    mkdirSync(intake, { recursive: true });
    writeFileSync(join(intake, 'wi-a1b2c3.md'), '### [review] ###\n- **ID:** wi-a1b2c3\n');
    expect(section(run([repo]).stdout, 'TODO_FORMAT')).toContain('missing title');
  });

  test('does not audit or mint IDs from intake through a symlinked docs directory', () => {
    const repo = makeEmptyRepo(baseTmp);
    const other = makeEmptyRepo(baseTmp);
    const intake = join(other, 'todos');
    symlinkSync(other, join(repo, 'docs'), 'dir');
    expect(section(run([repo]).stdout, 'TODO_FORMAT')).toContain('STATUS: skip');
    mkdirSync(intake);
    writeFileSync(join(intake, 'wi-a1b2c3.md'), record('wi-a1b2c3'));
    const audited = run([repo]);
    expect(audited.exitCode).toBe(0);
    expect(audited.stderr).toBe('');
    expect(section(audited.stdout, 'TODO_FORMAT')).toContain('MALFORMED_INTAKE_FILE: docs/todos');
    expect(section(audited.stdout, 'DOC_INVENTORY')).not.toContain('docs/todos/');
    const mint = runBin(join(ROOT, 'bin', 'roadmap-id'), ['mint', repo], { cwd: repo, home: homeDir });
    expect(mint.exitCode).toBe(1);
    expect(mint.stdout).toBe('');
    expect(mint.stderr).toContain('refusing non-directory intake path docs/todos');
  });

  test('keeps the legacy inbox migration findings when intake files also exist', () => {
    const repo = makeEmptyRepo(baseTmp);
    const intake = join(repo, 'docs', 'todos');
    mkdirSync(intake, { recursive: true });
    writeFileSync(join(repo, 'docs', 'TODOS.md'), '## Unprocessed\n\n- [review] Old bullet\n- **[review] Old bold bullet**\n');
    writeFileSync(join(intake, 'wi-a1b2c3.md'), record('wi-a1b2c3'));
    const inbox = section(run([repo]).stdout, 'UNPROCESSED');
    expect(inbox).toContain('1 legacy bullet-form entries');
    expect(inbox).toContain('1 compact bold-form entries');
  });

  test('escapes line breaks in diagnostics for a malformed intake filename', () => {
    const repo = makeEmptyRepo(baseTmp);
    const intake = join(repo, 'docs', 'todos');
    mkdirSync(intake, { recursive: true });
    writeFileSync(join(intake, 'bad\nrecord.md'), record('wi-a1b2c3'));
    const audited = run([repo]);
    expect(audited.exitCode).toBe(0);
    expect(audited.stderr).toBe('');
    expect(audited.stdout).not.toContain('bad\nrecord.md');
    expect(section(audited.stdout, 'TODO_FORMAT')).toContain('docs/todos/bad\\nrecord.md');
  });

  test('requires the ID bullet before any fenced example', () => {
    const repo = makeEmptyRepo(baseTmp);
    const intake = join(repo, 'docs', 'todos');
    mkdirSync(intake, { recursive: true });
    writeFileSync(join(intake, 'wi-a1b2c3.md'), '### [review] Record\n~~~md\nExample\n~~~\n- **ID:** wi-a1b2c3\n');
    expect(section(run([repo]).stdout, 'TODO_FORMAT')).toContain('put the ID first');
  });

  test.skipIf(process.getuid?.() === 0)('reports unreadable intake as an audit finding', () => {
    const repo = makeEmptyRepo(baseTmp);
    const intake = join(repo, 'docs', 'todos');
    mkdirSync(intake, { recursive: true });
    const path = join(intake, 'wi-a1b2c3.md');
    writeFileSync(path, record('wi-a1b2c3'));
    chmodSync(path, 0o000);
    try {
      const audit = run([repo]);
      expect(audit.exitCode).toBe(0);
      expect(audit.stderr).toBe('');
      expect(section(audit.stdout, 'TODO_FORMAT')).toContain('unable to read intake path');
    } finally {
      chmodSync(path, 0o600);
    }
  });

  test('two branches from the same base merge separate intake records without conflicts', () => {
    const repo = makeEmptyRepo(baseTmp);
    const docs = join(repo, 'docs');
    mkdirSync(docs);
    const todos = '# TODOs\n\n## Unprocessed\n';
    writeFileSync(join(docs, 'TODOS.md'), todos);
    writeFileSync(join(docs, 'ROADMAP.md'), roadmap);
    const git = (...args: string[]) => {
      const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: GIT_ENV });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim();
    };
    git('add', 'docs');
    git('commit', '-m', 'Seed planning docs');
    const base = git('rev-parse', 'HEAD');
    const ids: string[] = [];
    for (const branch of ['branch-a', 'branch-b']) {
      git('checkout', '-b', branch, base);
      const mint = runBin(join(ROOT, 'bin', 'roadmap-id'), ['mint', repo, '--count', '2'], { cwd: repo, home: homeDir });
      expect(mint.exitCode, mint.stderr).toBe(0);
      const id = mint.stdout.trim().split('\n').find(candidate => !ids.includes(candidate))!;
      expect(id).toMatch(/^wi-[0-9a-f]{4,8}$/);
      ids.push(id);
      const intake = join(docs, 'todos');
      mkdirSync(intake, { recursive: true });
      writeFileSync(join(intake, id + '.md'), record(id));
      git('add', 'docs/todos');
      git('commit', '-m', 'File review follow-up');
    }
    git('checkout', 'main');
    git('merge', '--no-edit', 'branch-a');
    git('merge', '--no-edit', 'branch-b');
    expect(git('ls-files', '--unmerged')).toBe('');
    expect(readFileSync(join(docs, 'TODOS.md'), 'utf8')).toBe(todos);
    for (const id of ids) expect(readFileSync(join(docs, 'todos', id + '.md'), 'utf8')).toBe(record(id));
    const audit = run([repo]);
    expect(audit.exitCode, audit.stderr).toBe(0);
    expect(section(audit.stdout, 'UNPROCESSED')).toContain('ITEMS: 2\nINTAKE_FILES: 2');
    for (const name of ['TODO_FORMAT', 'WORK_ITEM_IDS', 'SCATTERED_TODOS', 'DOC_TYPE_MISMATCH']) {
      expect(section(audit.stdout, name), name).toContain('STATUS: pass');
    }
    expect(JSON.parse(run(['--scan-state', repo]).stdout).signals.unprocessed_count).toBe(2);
  });
});
