/**
 * docs-ship.test.ts — the /docs-ship helper on fixture PRs built as tmp git
 * repos: the shared docs-only classification (allowlist, agent-instruction
 * files, project markers, release files), doc-pinning test selection, link,
 * anchor, SHA and quotation findings, and the PR-body receipt binding.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { help, main, type CliIo } from '../src/docs-ship/cli.ts';
import { bodyHash, END, REQUIRED_FIELDS, START, receiptField, upsert } from '../src/docs-ship/body.ts';
import { MARKER_KEYS } from '../src/docs-ship/config.ts';
import { anchors, githubSlug } from '../src/docs-ship/markdown.ts';

const ROOT = resolve(import.meta.dir, '..');
const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'docs-ship-')));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'T',
  GIT_AUTHOR_EMAIL: 't@t.invalid',
  GIT_COMMITTER_NAME: 'T',
  GIT_COMMITTER_EMAIL: 't@t.invalid',
};

function git(repo: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd: repo, env: GIT_ENV, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

type Files = Record<string, string | null>;

function write(repo: string, files: Files): void {
  for (const [path, text] of Object.entries(files)) {
    const full = join(repo, path);
    if (text === null) {
      rmSync(full, { force: true });
      continue;
    }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
}

const CHANGELOG = `# Changelog

## [Unreleased]

- Pending note.

## [1.2.0] - 2026-10-01

- Shipped feature.

## [1.1.0] - 2026-09-01

- Older feature.
`;

const BASE_FILES: Files = {
  'README.md': '# Project\n\nSee [the guide](docs/guide.md#setup).\n',
  'VERSION': '1.2.0\n',
  'package.json': '{\n  "name": "fixture",\n  "version": "1.2.0"\n}\n',
  'CHANGELOG.md': CHANGELOG,
  'AGENTS.md': '# Agents\n\nRules.\n',
  'CLAUDE.md': '# Claude\n\nRules.\n',
  'docs/guide.md': '# Guide\n\n## Setup\n\nInstall it.\n\n## Usage\n\nRun it.\n',
  'docs/other.md': '# Other\n',
  'skills/tool/SKILL.md': '# Tool skill\n',
  'src/app.ts': 'export const x = 1;\n',
  'tests/guide.test.ts': "import { readFileSync } from 'node:fs';\nreadFileSync('docs/guide.md', 'utf8');\n",
  'tests/app.test.ts': "import '../src/app.ts';\n",
  'tests/helpers/paths.ts': "export const all = ['docs/guide.md'];\n",
};

/** A repo whose main holds `base`, with a `pr` branch checked out holding `change` in one commit. */
function repo(change: Files, base: Files = {}): { dir: string; base: string } {
  const dir = mkdtempSync(join(TMP, 'repo-'));
  git(dir, 'init', '--quiet', '--initial-branch=main');
  write(dir, { ...BASE_FILES, ...base });
  git(dir, 'add', '-A');
  git(dir, 'commit', '--quiet', '-m', 'base');
  git(dir, 'checkout', '--quiet', '-b', 'pr');
  write(dir, change);
  git(dir, 'add', '-A');
  git(dir, 'commit', '--quiet', '--allow-empty', '-m', 'change');
  return { dir, base: 'main' };
}

function cli(cwd: string, ...argv: string[]) {
  let stdout = '';
  let stderr = '';
  const io: CliIo = { stdout: (t) => { stdout += t; }, stderr: (t) => { stderr += t; }, cwd };
  const code = main(argv, io);
  return { code, stdout, stderr };
}

const field = (out: string, key: string) => new RegExp(`^${key}: (.*)$`, 'm').exec(out)?.[1];
const lines = (out: string, key: string) => out.split('\n').filter((l) => l.startsWith(`${key}: `)).map((l) => l.slice(key.length + 2).split(' | '));
const fileLine = (out: string, path: string) => lines(out, 'FILE').find((f) => f[2] === path);

describe('docs-only classification', () => {
  test('a docs, README and Unreleased CHANGELOG change is docs-only', () => {
    const r = repo({
      'docs/guide.md': '# Guide\n\n## Setup\n\nInstall it with care.\n\n## Usage\n\nRun it.\n',
      'README.md': '# Project\n\nSee [the guide](docs/guide.md#usage).\n',
      'docs/img/shot.png': 'not really a png',
      'CHANGELOG.md': CHANGELOG.replace('- Pending note.\n', '- Pending note.\n- Another pending note.\n'),
    });
    const out = cli(r.dir, 'classify', '--base', r.base);
    expect(out.code).toBe(0);
    expect(field(out.stdout, 'STATUS')).toBe('docs');
    expect(field(out.stdout, 'RELEASE_FINDINGS')).toBe('0');
    expect(lines(out.stdout, 'FILE').every((f) => f[0] === 'docs')).toBe(true);
    expect(field(out.stdout, 'WORKTREE')).toBe('clean');
  });

  const stops: [string, Files, string][] = [
    ['a code file', { 'src/app.ts': 'export const x = 2;\n' }, 'code'],
    ['a test file', { 'tests/app.test.ts': "import '../src/app.ts';\n// more\n" }, 'test'],
    ['VERSION', { 'VERSION': '1.2.1\n' }, 'version'],
    ['a manifest version field', { 'package.json': '{\n  "name": "fixture",\n  "version": "1.2.1"\n}\n' }, 'version'],
    ['a new CHANGELOG version heading', { 'CHANGELOG.md': CHANGELOG.replace('## [Unreleased]\n', '## [Unreleased]\n\n## [1.2.1] - 2026-10-23\n\n- Fix.\n') }, 'version'],
    ['a non-prose file under docs/', { 'docs/build.py': 'print(1)\n' }, 'code'],
    ['a Markdown file outside the allowlist', { 'notes/plan.md': '# Plan\n' }, 'outside-allowlist'],
  ];
  for (const [name, change, reason] of stops) {
    test(`${name} stops with reason ${reason} and changes nothing`, () => {
      const r = repo({ 'docs/other.md': '# Other\n\nMore.\n', ...change });
      const head = git(r.dir, 'rev-parse', 'HEAD');
      const out = cli(r.dir, 'classify', '--base', r.base);
      expect(out.code).toBe(1);
      expect(field(out.stdout, 'STATUS')).toBe('stop');
      const stopped = lines(out.stdout, 'FILE').filter((f) => f[0] === 'stop');
      expect(stopped.map((f) => f[3])).toEqual([reason]);
      expect(fileLine(out.stdout, 'docs/other.md')?.[0]).toBe('docs');
      expect(git(r.dir, 'rev-parse', 'HEAD')).toBe(head);
      expect(git(r.dir, 'status', '--porcelain')).toBe('');
    });
  }

  test('a line added under a released version heading passes with one release-policy finding', () => {
    const r = repo({ 'CHANGELOG.md': CHANGELOG.replace('- Shipped feature.\n', '- Shipped feature.\n- A late note.\n') });
    const out = cli(r.dir, 'classify', '--base', r.base);
    expect(out.code).toBe(0);
    expect(field(out.stdout, 'STATUS')).toBe('docs');
    const findings = lines(out.stdout, 'FINDING');
    expect(findings).toHaveLength(1);
    expect(findings[0]![0]).toBe('CHANGELOG.md:10');
    expect(findings[0]![1]).toBe('release-policy');
    expect(findings[0]![2]).toContain('[1.2.0]');
    expect(findings[0]![3]).toContain('[Unreleased]');
  });

  test('removing a released line is also a release-policy finding, not a stop', () => {
    const r = repo({ 'CHANGELOG.md': CHANGELOG.replace('- Older feature.\n', '') });
    const out = cli(r.dir, 'classify', '--base', r.base);
    expect(field(out.stdout, 'STATUS')).toBe('docs');
    expect(lines(out.stdout, 'FINDING').map((f) => f[2])).toEqual(['edits the already-released [1.1.0] section']);
  });

  test('agent-instruction files are not docs by default', () => {
    const r = repo({
      'AGENTS.md': '# Agents\n\nNew rule.\n',
      'CLAUDE.md': '# Claude\n\nNew rule.\n',
      'skills/tool/SKILL.md': '# Tool skill\n\nMore.\n',
      'docs/nested/SKILL.md': '# Nested skill\n',
      'docs/templates/pr.md': '# PR template\n',
      'docs/prompt.tmpl.md': 'Prompt\n',
    });
    const out = cli(r.dir, 'classify', '--base', r.base);
    expect(field(out.stdout, 'STATUS')).toBe('stop');
    const stopped = lines(out.stdout, 'FILE').filter((f) => f[0] === 'stop');
    expect(stopped.map((f) => f[2]).sort()).toEqual(['AGENTS.md', 'CLAUDE.md', 'docs/nested/SKILL.md', 'docs/prompt.tmpl.md', 'docs/templates/pr.md', 'skills/tool/SKILL.md']);
    expect(new Set(stopped.map((f) => f[3]))).toEqual(new Set(['agent-instructions']));
  });

  test('a base-tip marker opts agent-instruction paths in; examples in code do not', () => {
    const base = {
      'CLAUDE.md': '# Claude\n\n<!-- docs-ship:docs=AGENTS.md,skills/** -->\n\nExample: `<!-- docs-ship:docs=src/** -->`\n\n```\n<!-- docs-ship:docs=tests/** -->\n```\n',
    };
    const r = repo({ 'AGENTS.md': '# Agents\n\nNew rule.\n', 'skills/tool/SKILL.md': '# Tool skill\n\nMore.\n', 'src/app.ts': 'export const x = 2;\n' }, base);
    const out = cli(r.dir, 'classify', '--base', r.base);
    expect(field(out.stdout, 'CONFIG')).toBe('markers from CLAUDE.md; docs=AGENTS.md,skills/**');
    expect(fileLine(out.stdout, 'AGENTS.md')).toEqual(['docs', 'M', 'AGENTS.md', 'docs-ship:docs']);
    expect(fileLine(out.stdout, 'skills/tool/SKILL.md')?.[0]).toBe('docs');
    expect(fileLine(out.stdout, 'src/app.ts')?.[3]).toBe('code');
  });

  test('a symlinked CLAUDE.md is read once through its target', () => {
    const r = repo({ 'AGENTS.md': '# Agents\n\nNew rule.\n<!-- docs-ship:docs=AGENTS.md -->\n' }, { 'AGENTS.md': '# Agents\n\n<!-- docs-ship:docs=AGENTS.md -->\n', 'CLAUDE.md': null });
    const dir = r.dir;
    git(dir, 'checkout', '--quiet', 'main');
    symlinkSync('AGENTS.md', join(dir, 'CLAUDE.md'));
    git(dir, 'add', 'CLAUDE.md');
    git(dir, 'commit', '--quiet', '-m', 'link');
    git(dir, 'checkout', '--quiet', 'pr');
    git(dir, 'rebase', '--quiet', 'main');
    const out = cli(dir, 'classify', '--base', 'main');
    expect(field(out.stdout, 'CONFIG')).toBe('markers from AGENTS.md; docs=AGENTS.md');
    expect(fileLine(out.stdout, 'AGENTS.md')?.[0]).toBe('docs');
  });

  test('a PR that adds a marker gets no benefit from it and stops on the marker change', () => {
    const r = repo({ 'CLAUDE.md': '# Claude\n\nRules.\n<!-- docs-ship:docs=AGENTS.md -->\n', 'AGENTS.md': '# Agents\n\nNew rule.\n' });
    const out = cli(r.dir, 'classify', '--base', r.base);
    expect(field(out.stdout, 'CONFIG')).toBe('defaults (no docs-ship markers)');
    expect(fileLine(out.stdout, 'CLAUDE.md')?.[3]).toBe('classification-config');
    expect(fileLine(out.stdout, 'AGENTS.md')?.[3]).toBe('agent-instructions');
  });

  test('not-docs markers exclude default docs; an invalid marker refuses', () => {
    const r = repo({ 'docs/other.md': '# Other\n\nMore.\n' }, { 'AGENTS.md': '<!-- docs-ship:not-docs=docs/other.md -->\n' });
    expect(fileLine(cli(r.dir, 'classify', '--base', r.base).stdout, 'docs/other.md')?.[3]).toBe('project-excluded');
    const bad = repo({ 'docs/other.md': '# Other\n\nMore.\n' }, { 'AGENTS.md': '<!-- docs-ship:colour=blue -->\n' });
    const out = cli(bad.dir, 'classify', '--base', bad.base);
    expect(out.code).toBe(3);
    expect(out.stderr).toContain('ERROR CONFIG_INVALID: AGENTS.md:1: docs-ship:colour is not a known key');
  });

  test('a symlink under docs/ is a special file; an empty PR is empty', () => {
    const r = repo({});
    symlinkSync('guide.md', join(r.dir, 'docs', 'alias.md'));
    git(r.dir, 'add', '-A');
    git(r.dir, 'commit', '--quiet', '-m', 'link');
    expect(fileLine(cli(r.dir, 'classify', '--base', r.base).stdout, 'docs/alias.md')?.[3]).toBe('special-file');
    const empty = repo({});
    const out = cli(empty.dir, 'classify', '--base', empty.base);
    expect(out.code).toBe(1);
    expect(field(out.stdout, 'STATUS')).toBe('empty');
  });
});

describe('doc-pinning tests', () => {
  test('a docs change that one test reads selects exactly that test', () => {
    const r = repo({ 'docs/guide.md': '# Guide\n\n## Setup\n\nChanged.\n\n## Usage\n\nRun it.\n' });
    const out = cli(r.dir, 'tests', '--base', r.base);
    expect(out.code).toBe(0);
    expect(lines(out.stdout, 'TEST')).toEqual([['tests/guide.test.ts', 'names docs/guide.md']]);
    expect(field(out.stdout, 'COMMAND')).toBeUndefined();
    expect(field(out.stdout, 'STATUS')).toBe('selected');
  });

  test('configured tests join the selection and fill the command template', () => {
    const base = { 'AGENTS.md': '<!-- docs-ship:tests=tests/app.test.ts -->\n<!-- docs-ship:test-command=bun test {tests} -->\n' };
    const r = repo({ 'docs/guide.md': '# Guide\n\nChanged.\n' }, base);
    const out = cli(r.dir, 'tests', '--base', r.base);
    expect(lines(out.stdout, 'TEST').map((t) => t[0])).toEqual(['tests/app.test.ts', 'tests/guide.test.ts']);
    expect(field(out.stdout, 'COMMAND')).toBe('bun test tests/app.test.ts tests/guide.test.ts');
  });

  test('a change no test reads selects none', () => {
    const r = repo({ 'docs/other.md': '# Other\n\nMore.\n' });
    const out = cli(r.dir, 'tests', '--base', r.base);
    expect(field(out.stdout, 'TESTS')).toBe('0');
    expect(field(out.stdout, 'STATUS')).toBe('none');
  });
});

describe('review boundary regressions', () => {
  // Generated by the /ship coverage audit.
  // Value: protects=version stops override docs opt-ins and frontmatter allowlists;
  // fails_when=classification accepts a version bump or turns unchanged prose into version metadata;
  // why_new=initial fixtures omit opt-ins, frontmatter and fence-only metadata activation; seam=none;
  // no_claim=installed-agent or GitHub acceptance; fixture repositories exercise the real CLI.
  test('version fields cannot enter through docs opt-ins or frontmatter', () => {
    const cases: [string, string, string][] = [
      ['package.json', '{"version":"1.2.0"}\n', '{"version":"1.2.1"}\n'],
      ['docs/release.md', '---\nversion: 1.2.0\n---\n# Release\n', '---\nversion: 1.2.1\n---\n# Release\n'],
      ['docs/activated.md', 'version: 1.2.3\n# Release\n', '---\nversion: 1.2.3\n---\n# Release\n'],
      ['docs/multiline.md', '---\nversion:\n  1.2.0\n---\n# Release\n', '---\nversion:\n  1.2.1\n---\n# Release\n'],
    ];
    const results = cases.map(([path, before, after]) => {
      const r = repo({ [path]: after }, { [path]: before, 'AGENTS.md': `<!-- docs-ship:docs=${path} -->\n` });
      const head = git(r.dir, 'rev-parse', 'HEAD');
      const out = cli(r.dir, 'classify', '--base', r.base);
      return [path, out.code, fileLine(out.stdout, path)?.[3], git(r.dir, 'rev-parse', 'HEAD') === head, git(r.dir, 'status', '--porcelain')];
    });
    expect(results).toEqual(cases.map(([path]) => [path, 1, 'version', true, '']));
  });

  // Generated by the /ship coverage audit.
  // Value: protects=linked and nested release headings obey the same stop and released-edit policy;
  // fails_when=heading syntax or discarded prerelease suffixes hide a new release or historical edit;
  // why_new=initial fixtures only cover plain level-two headings and core versions; seam=none;
  // no_claim=all Markdown dialects or live release approval; fixture Git history is the oracle.
  test('linked H2 and H3 release headings retain release policy', () => {
    const headings = ['## [1.2.0](https://example.com/releases/1.2.0)', '### [1.2.0] - 2026-10-01'];
    const results = headings.map((heading) => {
      const before = `# Changelog\n\n## [Unreleased]\n\n${heading}\n\n- Shipped.\n`;
      const released = repo({ 'CHANGELOG.md': before.replace('- Shipped.', '- Shipped.\n- Late.') }, { 'CHANGELOG.md': before });
      const added = repo({ 'CHANGELOG.md': before.replace('## [Unreleased]', `## [Unreleased]\n\n${heading.replaceAll('1.2.0', '1.3.0')}\n\n- New.`) }, { 'CHANGELOG.md': before });
      const edited = cli(released.dir, 'classify', '--base', released.base);
      const next = cli(added.dir, 'classify', '--base', added.base);
      return [edited.code, field(edited.stdout, 'RELEASE_FINDINGS'), next.code, fileLine(next.stdout, 'CHANGELOG.md')?.[3]];
    });
    expect(results).toEqual(headings.map(() => [0, '1', 1, 'version']));
    const prerelease = '# Changelog\n\n## [Unreleased]\n\n## [1.2.0-rc.1]\n\n- Candidate.\n';
    const versions = ['1.2.0', '1.2.0-rc.2'];
    const promoted = versions.map((version) => {
      const r = repo({ 'CHANGELOG.md': prerelease.replace('## [Unreleased]', `## [Unreleased]\n\n## [${version}]\n\n- New release.`) }, { 'CHANGELOG.md': prerelease });
      const out = cli(r.dir, 'classify', '--base', r.base);
      return [version, out.code, fileLine(out.stdout, 'CHANGELOG.md')?.[3]];
    });
    expect(promoted).toEqual(versions.map((version) => [version, 1, 'version']));
  });

  // Generated by the /ship coverage audit.
  // Value: protects=classification settings cannot change through linked instructions or fence removal;
  // fails_when=an alias, fence-only activation or newer base-tip source bypasses the configuration stop;
  // why_new=initial marker fixtures change literal root-file lines with an integrated base; seam=none;
  // no_claim=agent policy enforcement; these are real-Git classifier fixtures.
  test('linked marker changes and fence activation stop as configuration changes', () => {
    const r = repo({}, { 'AGENTS.md': null, 'docs/rules.md': '<!-- docs-ship:docs=docs/** -->\n' });
    git(r.dir, 'checkout', '--quiet', 'main');
    symlinkSync('docs/rules.md', join(r.dir, 'AGENTS.md'));
    git(r.dir, 'add', '-A');
    git(r.dir, 'commit', '--quiet', '-m', 'linked instructions');
    git(r.dir, 'checkout', '--quiet', 'pr');
    git(r.dir, 'rebase', '--quiet', 'main');
    write(r.dir, { 'docs/rules.md': '<!-- docs-ship:docs=** -->\n' });
    git(r.dir, 'add', '-A');
    git(r.dir, 'commit', '--quiet', '-m', 'change linked marker');
    const linked = cli(r.dir, 'classify', '--base', r.base);
    const fenced = repo({ 'AGENTS.md': '<!-- docs-ship:docs=AGENTS.md -->\n<!-- docs-ship:docs=src/** -->\n' }, {
      'AGENTS.md': '<!-- docs-ship:docs=AGENTS.md -->\n```\n<!-- docs-ship:docs=src/** -->\n```\n',
    });
    const activated = cli(fenced.dir, 'classify', '--base', fenced.base);
    expect([linked.code, fileLine(linked.stdout, 'docs/rules.md')?.[3], activated.code, fileLine(activated.stdout, 'AGENTS.md')?.[3]])
      .toEqual([1, 'classification-config', 1, 'classification-config']);
    const divergent = repo({ 'docs/rules.md': '<!-- docs-ship:docs=** -->\n' }, {
      'AGENTS.md': null, 'docs/rules.md': '<!-- docs-ship:docs=docs/** -->\n',
    });
    git(divergent.dir, 'checkout', '--quiet', 'main');
    symlinkSync('docs/rules.md', join(divergent.dir, 'AGENTS.md'));
    git(divergent.dir, 'add', '-A');
    git(divergent.dir, 'commit', '--quiet', '-m', 'base adopts linked instructions');
    git(divergent.dir, 'checkout', '--quiet', 'pr');
    const head = git(divergent.dir, 'rev-parse', 'HEAD');
    const baseTip = cli(divergent.dir, 'classify', '--base', divergent.base);
    expect([baseTip.code, fileLine(baseTip.stdout, 'docs/rules.md')?.[3], git(divergent.dir, 'rev-parse', 'HEAD') === head, git(divergent.dir, 'status', '--porcelain')])
      .toEqual([1, 'classification-config', true, '']);
  });

  // Generated by the /ship coverage audit.
  // Value: protects=every explicitly configured always-run test pattern must resolve;
  // fails_when=a typo or deleted configured test silently becomes zero successful tests;
  // why_new=existing selection fixtures only contain valid markers or no markers; seam=none;
  // no_claim=runner success; this checks discovery and actionable refusal before execution.
  test('unmatched configured test patterns refuse instead of silently skipping', () => {
    const results = ['tests/missing.test.ts', 'tests/missing-*.test.ts'].map((pattern) => {
      const r = repo({ 'docs/other.md': '# Updated\n' }, { 'AGENTS.md': `<!-- docs-ship:tests=tests/app.test.ts,${pattern} -->\n` });
      const out = cli(r.dir, 'tests', '--base', r.base);
      return [out.code, out.stderr.includes(pattern), out.stderr.includes('FIX:'), field(out.stdout, 'STATUS')];
    });
    expect(results).toEqual([[3, true, true, undefined], [3, true, true, undefined]]);
  });

  // Generated by the /ship coverage audit.
  // Value: protects=each Markdown file is checked using only its own literal Git path;
  // fails_when=pathspec metacharacters cause another file's hunks to be checked under the wrong path;
  // why_new=existing link checks use ordinary filenames; seam=none;
  // no_claim=all unusual filesystem names; this covers literal wildcard and bracket paths.
  test('pathspec-like filenames do not import other documents hunks', () => {
    const results = ['docs/*.md', 'docs/[ab].md'].map((path) => {
      const r = repo({ [path]: '# Safe\n\nOrdinary text.\n', 'docs/a.md': '# Bad\n\n[broken](missing.md)\n' });
      const out = cli(r.dir, 'check', '--base', r.base);
      return lines(out.stdout, 'FINDING').map((f) => [f[0], f[1], f[2]]);
    });
    expect(results).toEqual(results.map(() => [['docs/a.md:3', 'link', 'link target docs/missing.md does not exist at head']]));
  });
});

describe('links, anchors and claims', () => {
  const BRIEF = 'Background.\n\nThe owner wrote: we just need to ensure we are getting a far lighter review burden for those than normal PRs.\n';

  test('a wrong SHA, a misquoted user line and a broken anchor are three findings', () => {
    const r = repo({});
    const real = git(r.dir, 'rev-parse', 'main');
    write(r.dir, {
      'docs/notes.md': [
        '# Notes',
        '',
        `Base commit \`${real.slice(0, 10)}\` is real; commit 1f2e3d4c5b6a is not.`,
        '',
        'The owner said "we just need to ensure we get a far lighter review burden for docs than normal PRs".',
        '',
        'The owner said "a far lighter review burden for those than normal PRs".',
        '',
        'See [setup](guide.md#setup), [missing](guide.md#install) and [site](https://example.com/x#y).',
        '',
        '```',
        '[not a link](missing.md)',
        '```',
        '',
      ].join('\n'),
    });
    git(r.dir, 'add', '-A');
    git(r.dir, 'commit', '--quiet', '-m', 'notes');
    const briefPath = join(r.dir, '..', `brief-${Date.now()}.md`);
    writeFileSync(briefPath, BRIEF);
    const out = cli(r.dir, 'check', '--base', r.base, '--brief', briefPath);
    expect(out.code).toBe(1);
    const findings = lines(out.stdout, 'FINDING');
    expect(findings.map((f) => [f[0], f[1]])).toEqual([
      ['docs/notes.md:3', 'sha'],
      ['docs/notes.md:5', 'quote'],
      ['docs/notes.md:9', 'anchor'],
    ]);
    expect(findings.find((f) => f[1] === 'quote')![3]).toBe('fix: quote the brief exactly: "we just need to ensure we are getting a far lighter review burden for those than normal PRs"');
    expect(findings.find((f) => f[1] === 'anchor')![2]).toBe('docs/guide.md has no heading for #install');
    const claims = lines(out.stdout, 'CLAIM');
    expect(claims.find((c) => c[1] === 'sha' && c[3] === 'exists')?.[2]).toBe(real.slice(0, 10));
    expect(claims.find((c) => c[1] === 'quote' && c[3] === 'confirmed')?.[2]).toBe('a far lighter review burden for those than normal PRs');
    expect(field(out.stdout, 'LINKS')).toBe('2');
  });

  test('a missing link target and a link that leaves the repository are findings', () => {
    const r = repo({ 'docs/notes.md': '# Notes\n\nSee [gone](nowhere.md), [up](../../x.md), [self](#notes) and [dir](../src).\n' });
    const findings = lines(cli(r.dir, 'check', '--base', r.base).stdout, 'FINDING');
    expect(findings.map((f) => f[2])).toEqual(['link target docs/nowhere.md does not exist at head', 'link ../../x.md leaves the repository']);
  });

  test('without a brief, quotations are unconfirmed rather than findings', () => {
    const r = repo({ 'docs/notes.md': '# Notes\n\nThe owner said "keep it small and fast".\n\n> A quoted\n> passage here.\n' });
    const out = cli(r.dir, 'check', '--base', r.base);
    expect(out.code).toBe(0);
    expect(lines(out.stdout, 'CLAIM').filter((c) => c[1] === 'quote').map((c) => [c[0], c[2], c[3]])).toEqual([
      ['docs/notes.md:3', 'keep it small and fast', 'unconfirmed'],
      ['docs/notes.md:5', 'A quoted passage here.', 'unconfirmed'],
    ]);
  });

  test('versions, dates, PR numbers and IDs are listed for checking', () => {
    const r = repo({ 'docs/notes.md': '# Notes\n\nOn 2026-10-12, PR #161 shipped v0.41.1.0 for Track 24A with 4 suites.\n' });
    const claims = lines(cli(r.dir, 'check', '--base', r.base).stdout, 'CLAIM').map((c) => `${c[1]}=${c[2]}`);
    expect(claims).toEqual(['date=2026-10-12', 'version=v0.41.1.0', 'pr=PR #161', 'id=Track 24A', 'numbers=4']);
  });
});

describe('GitHub anchors', () => {
  test('slugs follow GitHub rules, including repeats and punctuation', () => {
    expect(githubSlug('Docs-only classification')).toBe('docs-only-classification');
    expect(githubSlug('`docs-ship` result line (v1)')).toBe('docs-ship-result-line-v1');
    expect(githubSlug('A - B')).toBe('a---b');
    expect([...anchors('# A\n\n## A\n\n```\n# not a heading\n```\n\nSetext\n------\n<a id="custom"></a>\n')]).toEqual(['a', 'a-1', 'setext', 'custom']);
  });
});

describe('receipt binding', () => {
  const receipt = (hash: string) => `## Docs ship\n\n- **Verdict:** PASS\n- **Head:** abc\n- **Base:** main@def\n- **Body SHA-256:** \`${hash}\`\n- **Classification:** docs (2 files)\n- **Tests:** none selected\n`;

  test('the body hash ignores the receipt block, so it survives the write', () => {
    const body = 'Summary of the change.\r\n\r\nMore detail.\r\n';
    const hash = bodyHash(body);
    const first = upsert(body, receipt(hash));
    expect(first.body).toContain(START);
    expect(first.body).toContain(END);
    expect(bodyHash(first.body)).toBe(hash);
    const second = upsert(first.body, receipt(hash).replace('PASS', 'CHANGES'));
    expect(second.body.match(/docs-ship:receipt:start/g)).toHaveLength(1);
    expect(second.body).toContain('**Verdict:** CHANGES');
    expect(bodyHash(second.body)).toBe(hash);
  });

  test('a stale hash, a missing field or a forged marker refuses', () => {
    const body = 'Summary.\n';
    expect(() => upsert(body, receipt('0'.repeat(64)))).toThrow(/BODY|records body SHA-256/);
    expect(() => upsert(body, receipt(bodyHash(body)).replace(/- \*\*Tests:\*\*.*\n/, ''))).toThrow(/missing Tests/);
    expect(() => upsert(body, `${receipt(bodyHash(body))}\n${END}`)).toThrow(/must not contain/);
    expect(() => bodyHash(`a ${START} b`)).toThrow(/unpaired/);
  });

  test('the receipt command writes the new body and prints the hash', () => {
    const dir = mkdtempSync(join(TMP, 'body-'));
    writeFileSync(join(dir, 'body.md'), 'Summary.\n');
    const hash = field(cli(dir, 'hash', '--body', 'body.md').stdout, 'BODY_SHA256')!;
    writeFileSync(join(dir, 'receipt.md'), receipt(hash));
    const out = cli(dir, 'receipt', '--body', 'body.md', '--receipt', 'receipt.md', '--out', 'new.md');
    expect(out.code).toBe(0);
    expect(field(out.stdout, 'BODY_SHA256')).toBe(hash);
    expect(readFileSync(join(dir, 'new.md'), 'utf8')).toBe(`Summary.\n\n${START}\n${receipt(hash).trim()}\n${END}\n`);
  });
});

describe('command line', () => {
  test('usage errors exit 2; a bad ref refuses with 3', () => {
    const r = repo({});
    expect(cli(r.dir, 'nope').code).toBe(2);
    expect(cli(r.dir, 'classify').stderr).toContain('ERROR USAGE: --base is required');
    const bad = cli(r.dir, 'classify', '--base', 'no-such-ref');
    expect(bad.code).toBe(3);
    expect(bad.stderr).toContain('ERROR BAD_REF');
  });

  test('the launcher runs the helper with the pinned Bun flags', () => {
    const r = repo({ 'docs/other.md': '# Other\n\nMore.\n' });
    const run = spawnSync(join(ROOT, 'bin', 'docs-ship'), ['classify', '--base', 'main'], { cwd: r.dir, encoding: 'utf8', env: GIT_ENV });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('STATUS: docs');
    expect(readFileSync(join(ROOT, 'bin', 'docs-ship'), 'utf8')).toContain('exec bun --no-env-file --no-install --config=/dev/null "$_cli" "$@"');
  });
});

describe('skill and contract text', () => {
  const skill = readFileSync(join(ROOT, 'skills', 'docs-ship.md'), 'utf8');
  const contract = readFileSync(join(ROOT, 'docs', 'docs-ship.md'), 'utf8');
  const frontmatter = skill.slice(0, skill.indexOf('\n---', 4));
  const headings = new Set([...contract.matchAll(/^## (.+)$/gm)].map((m) => m[1]!));

  test('the skill stays light: no subagent tool, outside voices, full suite or merge', () => {
    expect(frontmatter).not.toMatch(/^\s+- (Agent|Skill|WebSearch)$/m);
    for (const clause of [
      'no Agent tool, no subagents, no outside voices, no `/review`, no Greptile, no full test suite. Never run `gh pr merge`.',
      'Never use the full suite or a wrapper that selects its own tests.',
      '`HANDED-BACK` writes nothing: no commit, push, PR, body edit or receipt.',
      'Nothing is written before step 2 classifies the change.',
    ]) expect(skill).toContain(clause);
    expect(skill.split('\n').length).toBeLessThan(260);
  });

  test('every helper command and contract section the skill names exists', () => {
    for (const m of skill.matchAll(/docs-ship (classify|check|tests|hash|receipt)\b/g)) expect(help()).toContain(`docs-ship ${m[1]} `);
    const sections = [...skill.matchAll(/§ ([A-Z][a-z-]+(?: [a-z-]+)*)/g)].map((m) => m[1]!);
    expect(sections.length).toBeGreaterThan(4);
    for (const name of sections) expect([name, headings.has(name)]).toEqual([name, true]);
  });

  test('the contract documents every marker key and receipt field the helper enforces', () => {
    const table = [...contract.matchAll(/^\| `<!-- docs-ship:([a-z-]+)=/gm)].map((m) => m[1]);
    expect(table).toEqual([...MARKER_KEYS]);
    const template = /```markdown\n(## Docs ship\n[\s\S]*?)```/.exec(contract)![1]!;
    for (const field of REQUIRED_FIELDS) expect([field, receiptField(template, field) !== undefined]).toEqual([field, true]);
  });

  test('skill and contract share one result line', () => {
    const line = /^Docs ship: docs-ship\/v1; verdict: .*$/m;
    expect(line.exec(contract)![0].replace(/<[^>]+>/g, '<>')).toBe(line.exec(skill)![0].replace(/<[^>]+>/g, '<>'));
  });

  test('docs-only skills hand off to /docs-ship, not the code review path', () => {
    const roadmap = readFileSync(join(ROOT, 'skills', 'roadmap.md'), 'utf8');
    const spec = readFileSync(join(ROOT, 'skills', 'project-spec.md'), 'utf8');
    const step7 = roadmap.slice(roadmap.indexOf('## Step 7: Hand off to /docs-ship'), roadmap.indexOf('## Output Format'));
    expect(step7).toContain('```text\nRun /docs-ship\n');
    expect(step7).toContain('not `/review-and-prep` and `/ship-and-land`');
    expect(roadmap).not.toContain('Run `/ship` to assign and write the version.');
    expect(spec).toContain("end with roadmap's Step 7 handoff");
    expect(spec).toContain('This docs-only change goes to `/docs-ship`, not `/review-and-prep` and\n`/ship-and-land`.');
  });
});
