import { afterAll, describe, expect, test } from 'bun:test';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import { parseAuditSections } from '../src/audit/sections.ts';
import { runTodoFileCli } from '../src/audit/todo-file-cli.ts';
import { GIT_ENV, makeBaseTmp, makeEmptyRepo } from './helpers/fixture-repo.ts';
import { runBin } from './helpers/run-bin.ts';
import { openChildStdio, spawnSync } from './helpers/child-stdio.ts';

const ROOT = resolve(import.meta.dir, '..');
const TODO_FILE_BIN = join(ROOT, 'bin', 'todo-file');
const AUDIT_BIN = join(ROOT, 'bin', 'roadmap-audit');
const BASE_TMP = makeBaseTmp('todo-file-test-');
const HOME_DIR = mkdtempSync(join(BASE_TMP, 'home-'));
const STATE_DIR = mkdtempSync(join(BASE_TMP, 'state-'));

afterAll(() => {
  rmSync(BASE_TMP, { recursive: true, force: true });
});

function runTodoFileBin(args: string[], cwd?: string) {
  return runBin(TODO_FILE_BIN, args, {
    home: HOME_DIR,
    gstackExtendDir: ROOT,
    gstackExtendStateDir: STATE_DIR,
    cwd,
  });
}

function runAuditBin(args: string[], cwd?: string) {
  return runBin(AUDIT_BIN, args, {
    home: HOME_DIR,
    gstackExtendDir: ROOT,
    gstackExtendStateDir: STATE_DIR,
    cwd,
  });
}

type TreeEntry = {
  path: string;
  kind: 'dir' | 'file' | 'symlink';
  bytes?: string;
};

function snapshotTree(root: string, prefix = ''): TreeEntry[] {
  const out: TreeEntry[] = [];
  const names = readdirSync(root).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const name of names) {
    if (prefix === '' && name === '.git') continue;
    const full = join(root, name);
    const rel = prefix === '' ? name : `${prefix}/${name}`;
    const st = lstatSync(full);
    if (st.isSymbolicLink()) {
      out.push({ path: rel, kind: 'symlink' });
    } else if (st.isDirectory()) {
      out.push({ path: rel, kind: 'dir' });
      out.push(...snapshotTree(full, rel));
    } else {
      out.push({ path: rel, kind: 'file', bytes: readFileSync(full).toString('base64') });
    }
  }
  return out;
}

function extractTestGapExample(): {
  fullText: string;
  tag: string;
  title: string;
  fields: string[];
} {
  const contract = readFileSync(join(ROOT, 'docs', 'source-tag-contract.md'), 'utf8');
  const heading = '### [review:files=src/export.ts|src/export-format.ts] Test gap: empty batch is not tested';
  const start = contract.indexOf(heading);
  expect(start).toBeGreaterThan(-1);
  const lines = contract.slice(start).split('\n');
  const block: string[] = [lines[0]!];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.startsWith('- **')) break;
    block.push(line);
  }
  const tag = '[review:files=src/export.ts|src/export-format.ts]';
  const title = 'Test gap: empty batch is not tested';
  const fields: string[] = [];
  for (const line of block.slice(1)) {
    const match = /^- \*\*(.+?):\*\* (.*)$/.exec(line);
    expect(match).not.toBeNull();
    const key = match![1]!;
    const value = match![2]!;
    if (key === 'ID') continue;
    fields.push(`${key}: ${value}`);
  }
  return { fullText: block.join('\n') + '\n', tag, title, fields };
}

function sectionBody(stdout: string, name: string): string | undefined {
  return parseAuditSections(stdout).find(entry => entry.name === name)?.body.join('\n');
}

describe('bin/todo-file', () => {
  test('1. --help and -h print usage on stdout, exit 0, and write nothing (spawned and in-process)', () => {
    const repo = makeEmptyRepo(BASE_TMP);
    const before = snapshotTree(repo);

    for (const flag of ['--help', '-h']) {
      const inProc = runTodoFileCli([flag]);
      expect(inProc.exitCode).toBe(0);
      expect(inProc.stderr).toBe('');
      expect(inProc.stdout.startsWith('Usage: todo-file')).toBe(true);

      const spawned = runTodoFileBin([flag], repo);
      expect(spawned.exitCode).toBe(0);
      expect(spawned.stderr).toBe('');
      expect(spawned.stdout.startsWith('Usage: todo-file')).toBe(true);
    }

    expect(snapshotTree(repo)).toEqual(before);
  });

  test('2. worker-filed record creates docs/todos/<id>.md with Filed by: worker (spawned)', () => {
    const repo = makeEmptyRepo(BASE_TMP);
    const res = runTodoFileBin([
      repo,
      '--tag', '[review:files=src/a.ts]',
      '--title', 'Worker filed follow-up',
      '--field', 'Description: Retry loop skips jitter on first attempt.',
      '--field', 'Evidence: Read src/a.ts:12-30 and ran bun test tests/a.test.ts.',
    ]);

    expect(res.exitCode, res.stderr).toBe(0);
    expect(res.stderr).toBe('');
    const match = /^FILED (wi-[0-9a-f]{6}) docs\/todos\/(wi-[0-9a-f]{6})\.md\n$/.exec(res.stdout);
    expect(match).not.toBeNull();
    const id = match![1]!;
    expect(match![2]).toBe(id);

    const filePath = join(repo, 'docs', 'todos', `${id}.md`);
    const content = readFileSync(filePath, 'utf8');
    const expected = [
      '### [review:files=src/a.ts] Worker filed follow-up',
      `- **ID:** ${id}`,
      '- **Filed by:** worker',
      '- **Description:** Retry loop skips jitter on first attempt.',
      '- **Evidence:** Read src/a.ts:12-30 and ran bun test tests/a.test.ts.',
      '',
    ].join('\n');
    expect(content).toBe(expected);
    expect(content.split('\n')[2]).toBe('- **Filed by:** worker');
    expect(content).not.toContain('Deferred by');
  });

  test('3. developer-deferred record writes UTC date and verbatim developer words', () => {
    const repo = makeEmptyRepo(BASE_TMP);
    const dateBefore = new Date().toISOString().slice(0, 10);
    const res = runTodoFileCli([
      repo,
      '--tag', '[manual]',
      '--title', 'Defer remaining cleanup',
      '--field', 'Why: Keep this PR focused on the core change.',
      '--field', 'Evidence: Reviewed the diff; remaining items are independent.',
      '--developer-words', '1 - fix, file the rest, finish',
    ]);
    const dateAfter = new Date().toISOString().slice(0, 10);

    expect(res.exitCode, res.stderr).toBe(0);
    expect(res.stderr).toBe('');
    const id = /^FILED (wi-[0-9a-f]{6}) /.exec(res.stdout)?.[1];
    expect(id).toBeDefined();

    const content = readFileSync(join(repo, 'docs', 'todos', `${id}.md`), 'utf8');
    const line3 = content.split('\n')[2];
    const allowedDates = new Set([dateBefore, dateAfter]);
    const dateMatch = /^- \*\*Deferred by:\*\* developer, (\d{4}-\d{2}-\d{2}): "1 - fix, file the rest, finish"$/.exec(line3 ?? '');
    expect(dateMatch).not.toBeNull();
    expect(allowedDates.has(dateMatch![1]!)).toBe(true);

    // Words containing curly quotes and [brackets] appear verbatim.
    const specialWords = 'Leave \u201cthis\u201d and [brackets] for later';
    const res2 = runTodoFileCli([
      repo,
      '--tag', '[manual]',
      '--title', 'Defer with curly quotes and brackets',
      '--field', 'Why: Not needed for this milestone.',
      '--field', 'Evidence: Confirmed in planning notes.',
      '--developer-words', specialWords,
    ]);
    expect(res2.exitCode, res2.stderr).toBe(0);
    const id2 = /^FILED (wi-[0-9a-f]{6}) /.exec(res2.stdout)?.[1];
    expect(id2).toBeDefined();
    const content2 = readFileSync(join(repo, 'docs', 'todos', `${id2}.md`), 'utf8');
    expect(content2.split('\n')[2]).toContain(`: "${specialWords}"`);
  });

  test('4. test-gaps=record example from docs/source-tag-contract.md files identically with minted ID and Filed by: worker', () => {
    const repo = makeEmptyRepo(BASE_TMP);
    const example = extractTestGapExample();
    const args = [
      repo,
      '--tag', example.tag,
      '--title', example.title,
      ...example.fields.flatMap(f => ['--field', f]),
    ];

    const res = runTodoFileCli(args);
    expect(res.exitCode, res.stderr).toBe(0);
    expect(res.stderr).toBe('');
    const id = /^FILED (wi-[0-9a-f]{6}) /.exec(res.stdout)?.[1];
    expect(id).toBeDefined();

    const content = readFileSync(join(repo, 'docs', 'todos', `${id}.md`), 'utf8');
    const exampleLines = example.fullText.trimEnd().split('\n');
    const expectedLines = [
      exampleLines[0]!,
      `- **ID:** ${id}`,
      '- **Filed by:** worker',
      ...exampleLines.slice(2),
    ];
    expect(content).toBe(expectedLines.join('\n') + '\n');
  });

  test('5. audit round trip: filed records pass TODO_FORMAT and WORK_ITEM_IDS and count INTAKE_FILES: 3 (spawned)', () => {
    const repo = makeEmptyRepo(BASE_TMP);
    mkdirSync(join(repo, 'docs'));
    writeFileSync(
      join(repo, 'docs', 'ROADMAP.md'),
      '## In Progress\n\n## Current Plan\n\n## Future\n\n## Shipped\n',
    );
    const add = spawnSync('git', ['-C', repo, 'add', 'docs/ROADMAP.md'], { encoding: 'utf8', env: GIT_ENV });
    expect(add.status, add.stderr).toBe(0);
    const commit = spawnSync('git', ['-C', repo, 'commit', '-m', 'Add minimal roadmap'], { encoding: 'utf8', env: GIT_ENV });
    expect(commit.status, commit.stderr).toBe(0);

    // Case 2: worker-filed
    const r1 = runTodoFileBin([
      repo,
      '--tag', '[review:files=src/a.ts]',
      '--title', 'Worker filed follow-up',
      '--field', 'Description: Retry loop skips jitter on first attempt.',
      '--field', 'Evidence: Read src/a.ts:12-30.',
    ]);
    expect(r1.exitCode, r1.stderr).toBe(0);

    // Case 3: developer-deferred
    const r2 = runTodoFileBin([
      repo,
      '--tag', '[manual]',
      '--title', 'Defer remaining cleanup',
      '--field', 'Why: Keep this PR focused.',
      '--field', 'Evidence: Reviewed diff.',
      '--developer-words', '1 - fix, file the rest, finish',
    ]);
    expect(r2.exitCode, r2.stderr).toBe(0);

    // Case 4: test-gaps=record
    const example = extractTestGapExample();
    const r3 = runTodoFileBin([
      repo,
      '--tag', example.tag,
      '--title', example.title,
      ...example.fields.flatMap(f => ['--field', f]),
    ]);
    expect(r3.exitCode, r3.stderr).toBe(0);

    const audit = runAuditBin([repo]);
    expect(audit.exitCode, audit.stderr).toBe(0);
    expect(audit.stderr).toBe('');
    expect(sectionBody(audit.stdout, 'TODO_FORMAT')).toContain('STATUS: pass');
    expect(sectionBody(audit.stdout, 'WORK_ITEM_IDS')).toContain('STATUS: pass');
    expect(sectionBody(audit.stdout, 'UNPROCESSED')).toContain('INTAKE_FILES: 3');
  });

  test('6. uniqueness avoids seeded intake and TODOS.md IDs without altering seeded files', () => {
    const repo = makeEmptyRepo(BASE_TMP);
    mkdirSync(join(repo, 'docs', 'todos'), { recursive: true });
    const seededIntakePath = join(repo, 'docs', 'todos', 'wi-a1b2c3.md');
    const seededIntakeContent = '### [manual] Seeded intake\n- **ID:** wi-a1b2c3\n- **Why:** Seeded.\n';
    writeFileSync(seededIntakePath, seededIntakeContent);
    writeFileSync(
      join(repo, 'docs', 'TODOS.md'),
      '# TODOs\n\n## Unprocessed\n\n### [manual] Seeded TODO\n- **ID:** wi-d4e5f6\n- **Why:** Seeded.\n',
    );

    const f1 = runTodoFileCli([
      repo,
      '--tag', '[manual]',
      '--title', 'First new record',
      '--field', 'Why: Needed.',
      '--field', 'Evidence: Observed.',
    ]);
    const f2 = runTodoFileCli([
      repo,
      '--tag', '[manual]',
      '--title', 'Second new record',
      '--field', 'Why: Also needed.',
      '--field', 'Evidence: Observed.',
    ]);

    expect(f1.exitCode, f1.stderr).toBe(0);
    expect(f2.exitCode, f2.stderr).toBe(0);
    const id1 = /^FILED (wi-[0-9a-f]{4,8}) /.exec(f1.stdout)?.[1];
    const id2 = /^FILED (wi-[0-9a-f]{4,8}) /.exec(f2.stdout)?.[1];
    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);
    expect(id1).not.toBe('wi-a1b2c3');
    expect(id1).not.toBe('wi-d4e5f6');
    expect(id2).not.toBe('wi-a1b2c3');
    expect(id2).not.toBe('wi-d4e5f6');
    expect(readFileSync(seededIntakePath, 'utf8')).toBe(seededIntakeContent);
  });

  test.each([
    [
      'missing-why',
      ['--tag', '[manual]', '--title', 'No why', '--field', 'Evidence: Checked.'],
      'REFUSED missing-why',
    ],
    [
      'missing-evidence',
      ['--tag', '[review]', '--title', 'No evidence', '--field', 'Description: Something.'],
      'REFUSED missing-evidence',
    ],
    [
      'empty-value',
      ['--tag', '[manual]', '--title', 'Empty val', '--field', 'Why: Ok.', '--field', 'Evidence:   '],
      'REFUSED empty-value',
    ],
    [
      'reserved-field ID',
      ['--tag', '[manual]', '--title', 'Reserved ID', '--field', 'ID: x', '--field', 'Why: Ok.', '--field', 'Evidence: Checked.'],
      'REFUSED reserved-field',
    ],
    [
      'reserved-field Deferred by',
      ['--tag', '[manual]', '--title', 'Reserved deferred', '--field', 'Deferred by: developer', '--field', 'Why: Ok.', '--field', 'Evidence: Checked.'],
      'REFUSED reserved-field',
    ],
    [
      'reserved-field filed by',
      ['--tag', '[manual]', '--title', 'Reserved filed', '--field', 'filed by: worker', '--field', 'Why: Ok.', '--field', 'Evidence: Checked.'],
      'REFUSED reserved-field',
    ],
    [
      'duplicate-field',
      ['--tag', '[review]', '--title', 'Dup', '--field', 'Description: One.', '--field', 'Description: Two.', '--field', 'Evidence: Checked.'],
      'REFUSED duplicate-field',
    ],
    [
      'invalid-field lowercase key',
      ['--tag', '[manual]', '--title', 'Bad key', '--field', 'lower: x', '--field', 'Why: Ok.', '--field', 'Evidence: Checked.'],
      'REFUSED invalid-field',
    ],
    [
      'invalid-field missing space after colon',
      ['--tag', '[manual]', '--title', 'No space', '--field', 'Key:value', '--field', 'Why: Ok.', '--field', 'Evidence: Checked.'],
      'REFUSED invalid-field',
    ],
    [
      'invalid-tag UNKNOWN_SOURCE',
      ['--tag', '[nope]', '--title', 'Bad source', '--field', 'Why: Ok.', '--field', 'Evidence: Checked.'],
      'REFUSED invalid-tag: UNKNOWN_SOURCE',
    ],
    [
      'invalid-tag MALFORMED_TAG',
      ['--tag', 'review:files=a', '--title', 'No brackets', '--field', 'Why: Ok.', '--field', 'Evidence: Checked.'],
      'REFUSED invalid-tag: MALFORMED_TAG',
    ],
    [
      'invalid-tag INJECTION_ATTEMPT',
      ['--tag', '[review:files=a;b]', '--title', 'Injection', '--field', 'Why: Ok.', '--field', 'Evidence: Checked.'],
      'REFUSED invalid-tag: INJECTION_ATTEMPT',
    ],
    [
      'empty-title',
      ['--tag', '[manual]', '--title', '   ', '--field', 'Why: Ok.', '--field', 'Evidence: Checked.'],
      'REFUSED empty-title',
    ],
    [
      'control-character in title',
      ['--tag', '[manual]', '--title', 'Line1\n### [manual] Injected', '--field', 'Why: Ok.', '--field', 'Evidence: Checked.'],
      'REFUSED control-character',
    ],
    [
      'control-character in field value',
      ['--tag', '[manual]', '--title', 'Title', '--field', 'Why: Line1\nLine2', '--field', 'Evidence: Checked.'],
      'REFUSED control-character',
    ],
    [
      'control-character in developer words',
      ['--tag', '[manual]', '--title', 'Title', '--field', 'Why: Ok.', '--field', 'Evidence: Checked.', '--developer-words', 'later\rsoon'],
      'REFUSED control-character',
    ],
    [
      'empty-developer-words',
      ['--tag', '[manual]', '--title', 'Title', '--field', 'Why: Ok.', '--field', 'Evidence: Checked.', '--developer-words', '   '],
      'REFUSED empty-developer-words',
    ],
    [
      'noncanonical-record closing hashes',
      ['--tag', '[manual]', '--title', 'Follow-up ###', '--field', 'Why: Ok.', '--field', 'Evidence: Checked.'],
      'REFUSED noncanonical-record',
    ],
  ])('7. content refusal: %s writes nothing and exits 1', (_label, args, expectedStderr) => {
    const repo = makeEmptyRepo(BASE_TMP);
    const before = snapshotTree(repo);
    const res = runTodoFileCli([repo, ...args]);
    expect(res.exitCode).toBe(1);
    expect(res.stdout).toBe('');
    expect(res.stderr).toContain(expectedStderr);
    expect(snapshotTree(repo)).toEqual(before);
  });

  test('8. repository refusals exit 1 and change nothing', () => {
    const validArgs = [
      '--tag', '[manual]',
      '--title', 'Valid record',
      '--field', 'Why: Needed.',
      '--field', 'Evidence: Checked.',
    ];

    // 8a: docs is a symbolic link to another directory
    {
      const repo = makeEmptyRepo(BASE_TMP);
      const other = makeEmptyRepo(BASE_TMP);
      symlinkSync(other, join(repo, 'docs'), 'dir');
      const before = snapshotTree(repo);
      const otherBefore = snapshotTree(other);
      const res = runTodoFileCli([repo, ...validArgs]);
      expect(res.exitCode).toBe(1);
      expect(res.stdout).toBe('');
      expect(res.stderr).toContain('docs/ is a symbolic link or not a directory');
      expect(snapshotTree(repo)).toEqual(before);
      expect(snapshotTree(other)).toEqual(otherBefore);
    }

    // 8b: docs is a regular file
    {
      const repo = makeEmptyRepo(BASE_TMP);
      writeFileSync(join(repo, 'docs'), 'not a dir\n');
      const before = snapshotTree(repo);
      const res = runTodoFileCli([repo, ...validArgs]);
      expect(res.exitCode).toBe(1);
      expect(res.stdout).toBe('');
      expect(res.stderr).toContain('docs/ is a symbolic link or not a directory');
      expect(snapshotTree(repo)).toEqual(before);
    }

    // 8c: docs/todos is a regular file
    {
      const repo = makeEmptyRepo(BASE_TMP);
      mkdirSync(join(repo, 'docs'));
      writeFileSync(join(repo, 'docs', 'todos'), 'not a dir\n');
      const before = snapshotTree(repo);
      const res = runTodoFileCli([repo, ...validArgs]);
      expect(res.exitCode).toBe(1);
      expect(res.stdout).toBe('');
      expect(res.stderr).toContain('refusing non-directory intake path docs/todos');
      expect(snapshotTree(repo)).toEqual(before);
    }

    // 8d: directory named docs/todos/wi-0a0a0a.md (refused by collectTakenIds)
    {
      const repo = makeEmptyRepo(BASE_TMP);
      mkdirSync(join(repo, 'docs', 'todos', 'wi-0a0a0a.md'), { recursive: true });
      const before = snapshotTree(repo);
      const res = runTodoFileCli([repo, ...validArgs]);
      expect(res.exitCode).toBe(1);
      expect(res.stdout).toBe('');
      expect(res.stderr).toContain('refusing non-regular intake document docs/todos/wi-0a0a0a.md');
      expect(snapshotTree(repo)).toEqual(before);
    }
  });

  test.each([
    ['unknown option', ['--bogus']],
    ['missing --tag', ['--title', 'Title']],
    ['missing --title', ['--tag', '[manual]']],
    ['--tag with no value', ['--title', 'Title', '--tag']],
    ['--title twice', ['--tag', '[manual]', '--title', 'One', '--title', 'Two']],
    ['two positionals', ['repo-a', 'repo-b', '--tag', '[manual]', '--title', 'Title']],
    ['empty positional', ['', '--tag', '[manual]', '--title', 'Title']],
  ])('9. usage error: %s exits 2 with usage on stderr', (_label, args) => {
    const res = runTodoFileCli(args);
    expect(res.exitCode).toBe(2);
    expect(res.stdout).toBe('');
    expect(res.stderr).toContain('Usage: todo-file');
  });

  const filingFields = ['--field', 'Why: Needed.', '--field', 'Evidence: Checked.'];

  test.each([
    ['--tag', ['--tag', '--unknown', '--title', 'Follow-up']],
    ['--title', ['--tag', '[manual]', '--title', '--unknown']],
    ['--field', ['--tag', '[manual]', '--title', 'Follow-up', '--field', '--unknown']],
    ['--developer-words', ['--tag', '[manual]', '--title', 'Follow-up', '--developer-words', '--unknown']],
  ])('review regression: an option token cannot supply the missing %s value', (option, args) => {
    const repo = makeEmptyRepo(BASE_TMP);
    const before = snapshotTree(repo);
    const result = runTodoFileBin([repo, ...args, ...filingFields]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(`missing value for ${option}`);
    expect(snapshotTree(repo)).toEqual(before);
  });

  test('review regression: explicit flag-shaped text is filed without triggering help', () => {
    const repo = makeEmptyRepo(BASE_TMP);
    const result = runTodoFileBin([
      repo, '--tag', '[manual]', '--title=--help', '--developer-words=-h', ...filingFields,
    ]);
    expect(result.exitCode, result.stderr).toBe(0);
    const path = /^FILED wi-[0-9a-f]{6} (docs\/todos\/wi-[0-9a-f]{6}\.md)\n$/.exec(result.stdout)?.[1];
    expect(path).toBeDefined();
    const record = readFileSync(join(repo, path!), 'utf8');
    expect(record).toStartWith('### [manual] --help\n');
    expect(record.split('\n')[2]).toMatch(/^- \*\*Deferred by:\*\* developer, \d{4}-\d{2}-\d{2}: "-h"$/);
  });

  test('review regression: spacing variants of reserved provenance keys are refused', () => {
    const repo = makeEmptyRepo(BASE_TMP);
    const before = snapshotTree(repo);
    const result = runTodoFileCli([
      repo, '--tag', '[manual]', '--title', 'Follow-up', ...filingFields,
      '--field', 'Filed  by: example',
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('REFUSED reserved-field');
    expect(snapshotTree(repo)).toEqual(before);
  });

  test('review regression: concurrent first filings initialize one intake directory', async () => {
    const repo = makeEmptyRepo(BASE_TMP);
    const invocations = Array.from({ length: 6 }, (_, index) => [
      repo, '--tag', '[manual]', '--title', `Concurrent filing ${index}`, ...filingFields,
    ]);
    const outputs = invocations.map(() => openChildStdio());
    try {
      const children = invocations.map((args, index) => Bun.spawn([TODO_FILE_BIN, ...args], {
        env: { ...GIT_ENV, PATH: process.env.PATH, HOME: HOME_DIR },
        stdout: outputs[index]!.stdoutFd,
        stderr: outputs[index]!.stderrFd,
      }));
      const exits = await Promise.all(children.map(child => child.exited));

      for (const [index, exitCode] of exits.entries()) {
        const output = outputs[index]!.read();
        // An ID collision is allowed to refuse. Retry after the other filers exit.
        const result = output.stderr.includes('REFUSED record-exists')
          ? runTodoFileBin(invocations[index]!)
          : { ...output, exitCode };
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stdout).toStartWith('FILED ');
      }
    } finally {
      outputs.forEach(output => output.dispose());
    }
    expect(readdirSync(join(repo, 'docs', 'todos'))).toHaveLength(invocations.length);
  });

  test('review regression: a reported write failure removes the incomplete record', () => {
    const repo = makeEmptyRepo(BASE_TMP);
    const result = runBin('/bin/bash', [
      '-c', 'trap "" XFSZ; ulimit -f 1 && exec "$@"', 'limit-record-size', TODO_FILE_BIN,
      repo, '--tag', '[manual]', '--title', 'Follow-up', '--field', 'Why: Needed.',
      '--field', `Evidence: ${'a'.repeat(8192)}`,
    ], {
      home: HOME_DIR,
      gstackExtendDir: ROOT,
      gstackExtendStateDir: STATE_DIR,
    });
    expect(result.exitCode, result.stderr).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('EFBIG');
    expect(readdirSync(join(repo, 'docs', 'todos'))).toEqual([]);
  });
});
