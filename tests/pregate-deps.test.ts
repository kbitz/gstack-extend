import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { help, main } from '../src/pregate-deps/cli.ts';
import { generate } from '../src/pregate-deps/graph.ts';
import { GIT_ENV, makeBaseTmp, makeEmptyRepo } from './helpers/fixture-repo.ts';
import { matchGlob } from './helpers/touchfiles.ts';

const REPO_ROOT = resolve(import.meta.dir, '..');
const FIXTURE_DIR = join(REPO_ROOT, 'tests/fixtures/pregate-deps/src-layout');
const BIN_PATH = join(REPO_ROOT, 'bin/pregate-deps');

const baseTmp = makeBaseTmp('pregate-deps-');
afterAll(() => rmSync(baseTmp, { recursive: true, force: true }));

function materializeFixtureRepo(): string {
  const repo = makeEmptyRepo(baseTmp);
  for (const entry of readdirSync(FIXTURE_DIR, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.txt')) continue;
    const srcPath = join(entry.parentPath, entry.name);
    const rel = relative(FIXTURE_DIR, srcPath).replace(/\.txt$/, '');
    const dstPath = join(repo, rel);
    mkdirSync(dirname(dstPath), { recursive: true });
    writeFileSync(dstPath, readFileSync(srcPath));
  }
  const add = spawnSync('git', ['-C', repo, 'add', '.'], { env: GIT_ENV, encoding: 'utf8' });
  if (add.status !== 0) throw new Error(`git add failed: ${add.stderr}`);
  const commit = spawnSync('git', ['-C', repo, 'commit', '-m', 'seed fixture', '--quiet'], {
    env: GIT_ENV,
    encoding: 'utf8',
  });
  if (commit.status !== 0) throw new Error(`git commit failed: ${commit.stderr}`);
  return repo;
}

function runCli(cwd: string, argv: string[]): { status: number; stdout: string; stderr: string } {
  let stdout = '';
  let stderr = '';
  const status = main(argv, {
    cwd,
    env: GIT_ENV,
    stdout: text => { stdout += text; },
    stderr: text => { stderr += text; },
  });
  return { status, stdout, stderr };
}

function selectByDeclaredGlobs(dependencies: Record<string, string[]>, changedFile: string): string[] {
  const selected = new Set<string>();
  for (const [pattern, tests] of Object.entries(dependencies)) {
    if (matchGlob(changedFile, pattern)) {
      for (const t of tests) selected.add(t);
    }
  }
  return [...selected].sort();
}

const EXPECTED_GENERATED: Record<string, string[]> = {
  'src/pkg/__init__.py': [
    'tests/test_alpha.py',
    'tests/test_delta.py',
    'tests/test_gamma.py',
    'tests/test_patch.py',
  ],
  'src/pkg/alpha.py': ['tests/test_alpha.py'],
  'src/pkg/beta.py': [
    'tests/test_alpha.py',
    'tests/test_gamma.py',
    'tests/test_patch.py',
  ],
  'src/pkg/gamma.py': ['tests/test_gamma.py'],
  'src/pkg/sub/__init__.py': ['tests/test_delta.py'],
  'src/pkg/sub/delta.py': ['tests/test_delta.py'],
};

const EXPECTED_HAND: Record<string, string[]> = {
  'scripts/tool.py': ['tests/test_other.py'],
  'src/pkg/alpha*.py': ['tests/test_gamma.py'],
  'src/pkg/data/*.json': ['tests/test_alpha.py'],
  'src/pkg/orphan.py': [],
};

describe('pregate-deps', () => {
  test('replacement preserves policy permissions despite a restrictive umask', () => {
    const repo = materializeFixtureRepo();
    const configPath = join(repo, '.gstack/pregate.json');
    chmodSync(configPath, 0o664);
    const previous = process.umask(0o077);
    try {
      expect(runCli(repo, ['--prune']).status).toBe(0);
      expect(statSync(configPath).mode & 0o777).toBe(0o664);
    } finally {
      process.umask(previous);
    }
  });
  test('preserves prototype-named unowned dependency keys', () => {
    const repo = materializeFixtureRepo();
    const configPath = join(repo, '.gstack/pregate.json');
    for (const args of [[], ['--prune']]) {
      writeFileSync(configPath, '{"dependencies":{"__proto__":["tests/test_other.py"]}}');
      expect(runCli(repo, args).status).toBe(0);
      const deps = JSON.parse(readFileSync(configPath, 'utf8')).dependencies;
      expect(Object.hasOwn(deps, '__proto__')).toBe(true);
      expect(deps.__proto__).toEqual(['tests/test_other.py']);
    }
  });

  test('refuses config symlinks escaping through either the file or its directory', () => {
    for (const linkDirectory of [false, true]) {
      const repo = materializeFixtureRepo();
      const external = join(baseTmp, `external-${linkDirectory}`);
      mkdirSync(external);
      const target = join(external, 'pregate.json');
      const before = '{"sentinel":true}';
      writeFileSync(target, before);
      const configPath = join(repo, '.gstack/pregate.json');
      if (linkDirectory) {
        rmSync(join(repo, '.gstack'), { recursive: true });
        symlinkSync(external, join(repo, '.gstack'));
      } else {
        unlinkSync(configPath);
        symlinkSync(target, configPath);
      }
      expect(runCli(repo, []).status).toBe(2);
      expect(readFileSync(target, 'utf8')).toBe(before);
    }
  });

  test('relative imports preserve dotted source-root directory segments', () => {
    const repo = materializeFixtureRepo();
    renameSync(join(repo, 'src'), join(repo, 'src.v2'));
    expect(runCli(repo, ['--root', 'src.v2', '--prune']).status).toBe(0);
    const deps = JSON.parse(readFileSync(join(repo, '.gstack/pregate.json'), 'utf8')).dependencies;
    expect(deps['src.v2/pkg/beta.py']).toEqual([
      'tests/test_alpha.py', 'tests/test_gamma.py', 'tests/test_patch.py',
    ]);
  });

  test('respects global Git excludes while scanning untracked sources', () => {
    const repo = materializeFixtureRepo();
    mkdirSync(join(repo, 'scratch'));
    writeFileSync(join(repo, 'scratch/test_private.py'), 'import pkg.beta\n');
    const excludes = join(baseTmp, 'global-ignore');
    writeFileSync(excludes, 'scratch/\n');
    const config = join(baseTmp, 'synthetic.gitconfig');
    writeFileSync(config, `[core]\n excludesFile = ${excludes}\n`);
    expect(main(['--prune'], { cwd: repo, env: { ...GIT_ENV, GIT_CONFIG_GLOBAL: config }, stdout: () => {}, stderr: () => {} })).toBe(0);
    const deps = JSON.parse(readFileSync(join(repo, '.gstack/pregate.json'), 'utf8')).dependencies;
    expect(deps['src/pkg/beta.py']).not.toContain('scratch/test_private.py');
  });

  test('refuses generated module paths that upstream would interpret as globs', () => {
    const repo = materializeFixtureRepo();
    renameSync(join(repo, 'src'), join(repo, 'src?'));
    const configPath = join(repo, '.gstack/pregate.json');
    const before = readFileSync(configPath, 'utf8');
    expect(runCli(repo, ['--root', 'src?', '--prune']).status).toBe(2);
    expect(readFileSync(configPath, 'utf8')).toBe(before);
  });

  test('a partial filesystem write failure leaves the original policy intact', () => {
    const repo = materializeFixtureRepo();
    const configPath = join(repo, '.gstack/pregate.json');
    const before = '{}\n';
    writeFileSync(configPath, before);
    for (let i = 0; i < 30; i++) {
      writeFileSync(join(repo, `tests/test_write_${i}.py`), 'import pkg.beta\n');
    }
    // Force a real partial write using the child process's file-size limit.
    const result = spawnSync('bash', ['-c', 'ulimit -c 0; ulimit -f 1; exec "$1"', 'write-limit', BIN_PATH], {
      cwd: repo, env: GIT_ENV, encoding: 'utf8', timeout: 15_000,
    });
    expect(result.status).not.toBe(0);
    expect(readFileSync(configPath, 'utf8')).toBe(before);
  });

  test('(a) write mode: refuses removals without --prune, applies them with --prune, preserves hand entries and top-level keys, and preserves a hand-written link under an owned key on plain write', () => {
    const repo = materializeFixtureRepo();
    const configPath = join(repo, '.gstack/pregate.json');
    const initialBytes = readFileSync(configPath, 'utf8');

    // Starting fixture has stale owned entries src/pkg/gone.py and src/pkg/gamma.py -> tests/test_old.py.
    // Without --prune, write refuses with exit 2, writes nothing, and names each key and value it would remove.
    const refused = runCli(repo, []);
    expect(refused.status).toBe(2);
    expect(refused.stdout).toBe('');
    expect(refused.stderr).toContain('ERROR stale_entries:');
    expect(refused.stderr).toContain('src/pkg/gamma.py -> tests/test_old.py');
    expect(refused.stderr).toContain('src/pkg/gone.py -> tests/test_alpha.py');
    expect(refused.stderr).toContain('FIX:');
    expect(refused.stderr).toContain('--prune');
    expect(readFileSync(configPath, 'utf8')).toBe(initialBytes);

    // With --prune, removals are applied and all generated + hand entries are written.
    const pruned = runCli(repo, ['--prune']);
    expect(pruned.status).toBe(0);
    expect(pruned.stderr).toBe('');
    expect(pruned.stdout).toContain('REMOVED src/pkg/gamma.py -> tests/test_old.py\n');
    expect(pruned.stdout).toContain('REMOVED src/pkg/gone.py -> tests/test_alpha.py\n');
    expect(pruned.stdout).toContain('ADDED src/pkg/beta.py -> tests/test_alpha.py\n');
    expect(pruned.stdout).toContain('STATUS: written\n');

    const written = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(written)).toEqual(['$schema', 'runner', 'strays', 'dependencies']);
    expect(written.$schema).toBe('https://gstack.dev/schemas/pregate.json');
    expect(written.runner).toBe('pytest');
    expect(written.strays).toEqual({ allow: ['docs/**'] });
    expect(written.dependencies).toEqual({
      ...EXPECTED_HAND,
      ...EXPECTED_GENERATED,
    });

    // When a config has only additions (plus an existing hand-written link under an owned key that is valid),
    // a plain write without --prune succeeds and keeps the existing link while adding the rest.
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          $schema: 'https://gstack.dev/schemas/pregate.json',
          runner: 'pytest',
          strays: { allow: ['docs/**'] },
          dependencies: {
            ...EXPECTED_HAND,
            'src/pkg/beta.py': ['tests/test_alpha.py'],
          },
        },
        null,
        2,
      ) + '\n',
    );
    const plainAdd = runCli(repo, []);
    expect(plainAdd.status).toBe(0);
    expect(plainAdd.stdout).toContain('ADDED src/pkg/beta.py -> tests/test_gamma.py\n');
    expect(plainAdd.stdout).toContain('ADDED src/pkg/beta.py -> tests/test_patch.py\n');
    expect(plainAdd.stdout).toContain('STATUS: written\n');
    const afterPlainAdd = JSON.parse(readFileSync(configPath, 'utf8')) as { dependencies: Record<string, string[]> };
    expect(afterPlainAdd.dependencies['src/pkg/beta.py']).toEqual([
      'tests/test_alpha.py',
      'tests/test_gamma.py',
      'tests/test_patch.py',
    ]);

    // If a hand-written non-import link is placed under an owned key (src/pkg/alpha.py -> tests/test_other.py),
    // a plain write refuses with exit 2 and leaves the hand-written link intact on disk.
    const withHandOwned = {
      ...afterPlainAdd,
      dependencies: {
        ...afterPlainAdd.dependencies,
        'src/pkg/alpha.py': ['tests/test_alpha.py', 'tests/test_other.py'],
      },
    };
    const handOwnedText = JSON.stringify(withHandOwned, null, 2) + '\n';
    writeFileSync(configPath, handOwnedText);

    const protectHand = runCli(repo, []);
    expect(protectHand.status).toBe(2);
    expect(protectHand.stderr).toContain('src/pkg/alpha.py -> tests/test_other.py');
    expect(readFileSync(configPath, 'utf8')).toBe(handOwnedText);
    const savedDeps = (JSON.parse(readFileSync(configPath, 'utf8')) as { dependencies: Record<string, string[]> }).dependencies;
    expect(savedDeps['src/pkg/alpha.py']).toEqual(['tests/test_alpha.py', 'tests/test_other.py']);
  });

  test('(b) & (c) & (d) check mode, idempotent second write, and stale detection after import removal', () => {
    const repo = materializeFixtureRepo();
    const configPath = join(repo, '.gstack/pregate.json');
    const initialBytes = readFileSync(configPath, 'utf8');

    // (b) check on starting fixture exits 1, names STALE and MISSING edges, and changes nothing
    const checkInitial = runCli(repo, ['--check']);
    expect(checkInitial.status).toBe(1);
    expect(checkInitial.stderr).toBe('');
    expect(checkInitial.stdout).toContain('STALE src/pkg/gone.py -> tests/test_alpha.py\n');
    expect(checkInitial.stdout).toContain('STALE src/pkg/gamma.py -> tests/test_old.py\n');
    expect(checkInitial.stdout).toContain('MISSING src/pkg/alpha.py -> tests/test_alpha.py\n');
    expect(checkInitial.stdout).toContain('MISSING src/pkg/beta.py -> tests/test_alpha.py\n');
    expect(checkInitial.stdout).toContain('ENTRIES: 6 generated, 4 kept\n');
    expect(checkInitial.stdout).toContain('STATUS: stale\n');
    expect(readFileSync(configPath, 'utf8')).toBe(initialBytes);
    const statusPorcelain = spawnSync('git', ['-C', repo, 'status', '--porcelain'], {
      env: GIT_ENV,
      encoding: 'utf8',
    });
    expect(statusPorcelain.stdout).toBe('');

    // Write with --prune, then --check exits 0
    expect(runCli(repo, ['--prune']).status).toBe(0);
    const checkAfter = runCli(repo, ['--check']);
    expect(checkAfter.status).toBe(0);
    expect(checkAfter.stdout).toBe('ENTRIES: 6 generated, 4 kept\nSTATUS: current\n');

    // (c) second write prints STATUS: unchanged and leaves bytes identical
    const writtenBytes = readFileSync(configPath, 'utf8');
    const secondWrite = runCli(repo, []);
    expect(secondWrite.status).toBe(0);
    expect(secondWrite.stdout).toBe('STATUS: unchanged\n');
    expect(readFileSync(configPath, 'utf8')).toBe(writtenBytes);

    // Formatting/order differences alone are semantically current in --check and unchanged in write
    const reordered = JSON.stringify({
      runner: 'pytest',
      $schema: 'https://gstack.dev/schemas/pregate.json',
      strays: { allow: ['docs/**'] },
      dependencies: Object.fromEntries(
        Object.entries({ ...EXPECTED_HAND, ...EXPECTED_GENERATED })
          .reverse()
          .map(([k, v]) => [k, [...v].reverse()]),
      ),
    });
    writeFileSync(configPath, reordered);
    expect(runCli(repo, ['--check']).status).toBe(0);
    const unchangedOnReorder = runCli(repo, []);
    expect(unchangedOnReorder.status).toBe(0);
    expect(unchangedOnReorder.stdout).toBe('STATUS: unchanged\n');
    expect(readFileSync(configPath, 'utf8')).toBe(reordered);

    // (d) dropping the import from tests/test_gamma.py makes --check exit 1 naming STALE src/pkg/gamma.py -> tests/test_gamma.py
    writeFileSync(join(repo, 'tests/test_gamma.py'), '# no imports\n');
    const checkDropped = runCli(repo, ['--check']);
    expect(checkDropped.status).toBe(1);
    expect(checkDropped.stdout).toContain('STALE src/pkg/gamma.py -> tests/test_gamma.py\n');
    expect(checkDropped.stdout).toContain('STATUS: stale\n');
  });

  test('(e) & (f) selection for src/pkg/beta.py, multi-root --root src --root lib, and NOTE on first lane key', () => {
    const repo = materializeFixtureRepo();
    const configPath = join(repo, '.gstack/pregate.json');

    // (e) With hand entries alone, src/pkg/beta.py matches nothing; after write it selects test_alpha, test_gamma, test_patch
    expect(selectByDeclaredGlobs(EXPECTED_HAND, 'src/pkg/beta.py')).toEqual([]);
    expect(runCli(repo, ['--prune']).status).toBe(0);
    const writtenDeps = (JSON.parse(readFileSync(configPath, 'utf8')) as { dependencies: Record<string, string[]> }).dependencies;
    expect(selectByDeclaredGlobs(writtenDeps, 'src/pkg/beta.py')).toEqual([
      'tests/test_alpha.py',
      'tests/test_gamma.py',
      'tests/test_patch.py',
    ]);
    expect(writtenDeps['lib/other/x.py']).toBeUndefined();

    // (f) --root src --root lib adds lib/other/x.py: [tests/test_other.py]
    const multiRoot = runCli(repo, ['--root', 'src', '--root', 'lib']);
    expect(multiRoot.status).toBe(0);
    expect(multiRoot.stdout).toContain('ADDED lib/other/x.py -> tests/test_other.py\n');
    expect(multiRoot.stdout).toContain('STATUS: written\n');
    const multiDeps = (JSON.parse(readFileSync(configPath, 'utf8')) as { dependencies: Record<string, string[]> }).dependencies;
    expect(multiDeps['lib/other/x.py']).toEqual(['tests/test_other.py']);

    // First lane key NOTE: when config had no dependencies/empty_lanes/selection/local before
    writeFileSync(configPath, JSON.stringify({ runner: 'pytest' }, null, 2) + '\n');
    const firstLane = runCli(repo, []);
    expect(firstLane.status).toBe(0);
    expect(firstLane.stdout).toContain('NOTE: .gstack/pregate.json now declares lanes; pregate will fail a touched file with no lane.\n');
    expect(firstLane.stdout).toContain('STATUS: written\n');
  });

  test('(g) refusals exit 2 and write nothing', () => {
    const repo = materializeFixtureRepo();
    const configPath = join(repo, '.gstack/pregate.json');
    const initialBytes = readFileSync(configPath, 'utf8');

    // Outside git work tree
    const nonGit = makeBaseTmp('pregate-deps-nongit-');
    try {
      const res = runCli(nonGit, []);
      expect(res.status).toBe(2);
      expect(res.stderr).toContain('ERROR not_git_repo:');
      expect(res.stderr).toContain('FIX:');
    } finally {
      rmSync(nonGit, { recursive: true, force: true });
    }

    // Invalid flags and --root values
    for (const badArgs of [
      ['--unknown'],
      ['--root'],
      ['--root', ''],
      ['--root', '.'],
      ['--root', './'],
      ['--root', '../x'],
      ['--root', 'src/../x'],
      ['--root', '/abs/path'],
    ]) {
      const res = runCli(repo, badArgs);
      expect(res.status).toBe(2);
      expect(res.stderr).toContain('ERROR usage:');
      expect(res.stderr).toContain('FIX:');
      expect(readFileSync(configPath, 'utf8')).toBe(initialBytes);
    }

    // Missing root directory
    const missingRoot = runCli(repo, ['--root', 'nonexistent']);
    expect(missingRoot.status).toBe(2);
    expect(missingRoot.stderr).toContain('ERROR missing_root:');
    expect(readFileSync(configPath, 'utf8')).toBe(initialBytes);

    // No .gstack/pregate.json (and file is not created)
    unlinkSync(configPath);
    const noConfig = runCli(repo, []);
    expect(noConfig.status).toBe(2);
    expect(noConfig.stderr).toContain('ERROR missing_config:');
    expect(noConfig.stderr).toContain('gstack-pregate init');
    expect(existsSync(configPath)).toBe(false);

    // Invalid JSON
    writeFileSync(configPath, '{bad json\n');
    const badJson = runCli(repo, []);
    expect(badJson.status).toBe(2);
    expect(badJson.stderr).toContain('ERROR invalid_config:');
    expect(readFileSync(configPath, 'utf8')).toBe('{bad json\n');

    // Non-object JSON
    writeFileSync(configPath, '[]\n');
    expect(runCli(repo, []).status).toBe(2);

    // Non-array value in dependencies
    const nonArrayText = '{"dependencies":{"src/pkg/alpha.py":"tests/test_alpha.py"}}\n';
    writeFileSync(configPath, nonArrayText);
    const nonArray = runCli(repo, []);
    expect(nonArray.status).toBe(2);
    expect(nonArray.stderr).toContain('ERROR invalid_dependencies:');
    expect(readFileSync(configPath, 'utf8')).toBe(nonArrayText);

    // 257 entries cap
    const manyEntries: Record<string, string[]> = {};
    for (let i = 0; i < 252; i++) {
      manyEntries[`other/file_${i}.txt`] = ['tests/test_alpha.py'];
    }
    const overCapText = JSON.stringify({ dependencies: manyEntries });
    writeFileSync(configPath, overCapText);
    const overCap = runCli(repo, []);
    expect(overCap.status).toBe(2);
    expect(overCap.stderr).toContain('ERROR limit_exceeded:');
    expect(readFileSync(configPath, 'utf8')).toBe(overCapText);

    // Path over 256 characters
    const longKey = `other/${'a'.repeat(255)}.py`;
    const longKeyText = JSON.stringify({ dependencies: { [longKey]: ['tests/test_alpha.py'] } });
    writeFileSync(configPath, longKeyText);
    const overLen = runCli(repo, []);
    expect(overLen.status).toBe(2);
    expect(overLen.stderr).toContain('ERROR limit_exceeded:');
    expect(readFileSync(configPath, 'utf8')).toBe(longKeyText);
  });

  // Value: protects=relative imports above the repository root add no dependency while valid imports still resolve;
  //   fails_when=the above-root guard is removed and the existing target becomes a dependency;
  //   why_new=the previous relative cases reached only the root and named absent targets;
  //   seam=none; no_claim=pure parser graph fixture, not Python runtime or upstream selection acceptance
  test('(h) parser cases on inline sources', () => {
    const sources = new Map<string, string>([
      ['src/a/b.py', 'X = 1\n'],
      ['src/a/c.py', 'from ...too_high import z\n'],
      ['src/a/d.py', 'Y = 2\n'],
      ['src/a/ignored.py', 'Z = 3\n'],
      ['src/a/outside.py', 'VALUE = 4\n'],
      [
        'tests/test_parser.py',
        [
          '# import a.ignored',
          'S1 = "from a import ignored"',
          'S2 = """',
          'import a.ignored # inside triple string',
          '"""',
          'import a.b as c',
          'from a \\',
          '  import d',
          'from ..outside import nope',
          'from ...src.a.outside import VALUE',
        ].join('\n'),
      ],
    ]);
    const map = generate(sources, ['src']);
    expect(map).toEqual({
      'src/a/b.py': ['tests/test_parser.py'],
      'src/a/d.py': ['tests/test_parser.py'],
    });
  });

  test('(i) launcher flags, --help, and bunfig.toml preload isolation', () => {
    const launcher = readFileSync(BIN_PATH, 'utf8');
    expect(launcher.split('\n').filter(line => line.startsWith('exec '))).toEqual([
      expect.stringContaining('exec bun --no-env-file --no-install --config=/dev/null '),
    ]);

    const repo = materializeFixtureRepo();
    writeFileSync(join(repo, 'preload.ts'), "import { writeFileSync } from 'node:fs'; writeFileSync('preload-marker', 'ran');\n");
    writeFileSync(join(repo, 'probe.ts'), "console.log('probe ran');\n");
    writeFileSync(join(repo, 'bunfig.toml'), 'preload = ["./preload.ts"]\n');

    // Positive control runs preload
    const control = spawnSync(process.execPath, ['probe.ts'], {
      cwd: repo,
      env: GIT_ENV,
      encoding: 'utf8',
    });
    expect(control.status).toBe(0);
    expect(control.stdout).toContain('probe ran');
    expect(readFileSync(join(repo, 'preload-marker'), 'utf8')).toBe('ran');
    unlinkSync(join(repo, 'preload-marker'));

    // Launcher --help exits 0 and does not run preload
    const helpRes = spawnSync(BIN_PATH, ['--help'], {
      cwd: repo,
      env: GIT_ENV,
      encoding: 'utf8',
    });
    expect(helpRes.status).toBe(0);
    expect(helpRes.stderr).toBe('');
    expect(helpRes.stdout).toContain('Usage: pregate-deps [--check] [--prune] [--root DIR]...');
    expect(existsSync(join(repo, 'preload-marker'))).toBe(false);

    // Launcher --prune exits 0 and does not run preload
    const runRes = spawnSync(BIN_PATH, ['--prune'], {
      cwd: repo,
      env: GIT_ENV,
      encoding: 'utf8',
    });
    expect(runRes.status).toBe(0);
    expect(runRes.stdout).toContain('STATUS: written');
    expect(existsSync(join(repo, 'preload-marker'))).toBe(false);
  });

  test('(j) & (k) & (l) docs contract, .txt fixture suffixes, and no upstream wrapper references in src/pregate-deps/', () => {
    // (j) docs/pregate-deps.md names every exit code and flag that --help prints
    const helpText = help();
    const docText = readFileSync(join(REPO_ROOT, 'docs/pregate-deps.md'), 'utf8');
    const flags = [...new Set(helpText.match(/--[a-z-]+|-h\b/g) ?? [])];
    expect(flags.sort()).toEqual(['--check', '--help', '--prune', '--root', '-h']);
    for (const flag of flags) {
      expect(docText).toContain(flag);
    }
    for (const code of ['0', '1', '2']) {
      expect(helpText).toMatch(new RegExp(`^\\s*${code}\\s+`, 'm'));
      expect(docText).toContain(`\`${code}\``);
    }

    // (k) every file under tests/fixtures/pregate-deps/ ends in .txt
    const fixtureRoot = join(REPO_ROOT, 'tests/fixtures/pregate-deps');
    const fixtureFiles = readdirSync(fixtureRoot, { withFileTypes: true, recursive: true })
      .filter(e => e.isFile())
      .map(e => relative(fixtureRoot, join(e.parentPath, e.name)));
    expect(fixtureFiles.length).toBeGreaterThan(0);
    for (const f of fixtureFiles) {
      expect(f.endsWith('.txt')).toBe(true);
    }

    // (l) no file under src/pregate-deps/ names gstack-pregate or lib/pregate
    const srcRoot = join(REPO_ROOT, 'src/pregate-deps');
    const srcFiles = readdirSync(srcRoot, { withFileTypes: true, recursive: true }).filter(e => e.isFile());
    expect(srcFiles.length).toBeGreaterThan(0);
    const forbidden = [
      ['gstack', 'pregate'].join('-'),
      ['lib', 'pregate'].join('/'),
    ];
    for (const entry of srcFiles) {
      const content = readFileSync(join(entry.parentPath, entry.name), 'utf8');
      for (const word of forbidden) {
        expect(content).not.toContain(word);
      }
    }
  });
});
