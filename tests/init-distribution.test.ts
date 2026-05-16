/**
 * init-distribution.test.ts — invoke bin/gstack-extend through a PATH
 * symlink from outside the gstack-extend repo. Validates the POSIX
 * readlink-portability path (macOS BSD readlink lacks -f; the bin walks
 * the symlink chain in pure bash) and the `setup`-style invocation
 * shape: ~/.local/bin/gstack-extend -> $SCRIPT_DIR/bin/gstack-extend.
 *
 * Without this test, the readlink footgun would only surface in
 * production after `setup` symlinks the bin into ~/.local/bin/ and a
 * user runs it from a different cwd.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { join, relative } from 'node:path';

import { makeBaseTmp } from './helpers/fixture-repo.ts';
import { runBin } from './helpers/run-bin.ts';

const ROOT = join(import.meta.dir, '..');
const BIN_SRC = join(ROOT, 'bin', 'gstack-extend');

const baseTmp = makeBaseTmp('init-dist-');
afterAll(() => {
  try { rmSync(baseTmp, { recursive: true, force: true }); } catch {}
});

describe('PATH symlink invocation', () => {
  test('init via symlink finds templates and registry helper', () => {
    const home = join(baseTmp, 'home');
    const localBin = join(home, '.local', 'bin');
    const state = join(home, 'state');
    const groot = join(home, 'gstack');
    const target = join(baseTmp, 'project');
    mkdirSync(localBin, { recursive: true });
    mkdirSync(state, { recursive: true });
    mkdirSync(groot, { recursive: true });

    const symlink = join(localBin, 'gstack-extend');
    symlinkSync(BIN_SRC, symlink);

    // Invoke through the symlink. runBin scopes env so the bin doesn't
    // see process.env.HOME / project state.
    const r = runBin(symlink, ['init', target, '--no-prompt'], {
      home,
      gstackExtendDir: ROOT,
      gstackExtendStateDir: state,
      extraEnv: { GSTACK_STATE_ROOT: groot },
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('SUCCESS');
    expect(existsSync(join(target, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(state, 'projects.json'))).toBe(true);

    const reg = JSON.parse(readFileSync(join(state, 'projects.json'), 'utf8'));
    expect(reg.projects).toHaveLength(1);
  });

  test('init via two-hop symlink also resolves templates', () => {
    // Simulates a chained symlink (e.g., setup installs to ~/.local/bin/
    // and the user `ln -s` that elsewhere for a custom alias).
    const home = join(baseTmp, 'home-twohop');
    const localBin = join(home, '.local', 'bin');
    const aliasDir = join(home, 'aliases');
    const state = join(home, 'state');
    const groot = join(home, 'gstack');
    const target = join(baseTmp, 'project-twohop');
    mkdirSync(localBin, { recursive: true });
    mkdirSync(aliasDir, { recursive: true });
    mkdirSync(state, { recursive: true });
    mkdirSync(groot, { recursive: true });

    const hop1 = join(localBin, 'gstack-extend');
    symlinkSync(BIN_SRC, hop1);
    const hop2 = join(aliasDir, 'gx');
    symlinkSync(hop1, hop2);

    const r = runBin(hop2, ['init', target, '--no-prompt'], {
      home,
      gstackExtendDir: ROOT,
      gstackExtendStateDir: state,
      extraEnv: { GSTACK_STATE_ROOT: groot },
    });
    expect(r.exitCode).toBe(0);
    expect(existsSync(join(target, 'docs', 'ROADMAP.md'))).toBe(true);
  });

  test('init via symlink in a sibling location (relative readlink target)', () => {
    // Some setups (chezmoi/stow) put the symlink so the readlink target
    // is relative. Walk-the-chain logic must resolve against the symlink's
    // containing dir, not cwd.
    const home = join(baseTmp, 'home-rel');
    const localBin = join(home, 'bin');
    const state = join(home, 'state');
    const groot = join(home, 'gstack');
    const target = join(baseTmp, 'project-rel');
    mkdirSync(localBin, { recursive: true });
    mkdirSync(state, { recursive: true });
    mkdirSync(groot, { recursive: true });

    // Create a relative-target symlink in localBin pointing at our bin.
    // realpathSync both sides so macOS /tmp → /private/tmp symlink doesn't
    // throw off the .. count.
    const rel = relative(realpathSync(localBin), realpathSync(BIN_SRC));
    const symlink = join(localBin, 'gstack-extend');
    symlinkSync(rel, symlink);

    const r = runBin(symlink, ['init', target, '--no-prompt'], {
      home,
      gstackExtendDir: ROOT,
      gstackExtendStateDir: state,
      extraEnv: { GSTACK_STATE_ROOT: groot },
    });
    expect(r.exitCode).toBe(0);
    expect(existsSync(join(target, 'VERSION'))).toBe(true);
  });
});
