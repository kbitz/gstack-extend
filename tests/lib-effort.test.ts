import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ceiling,
  configIntGet,
  effortToLoc,
  resolveStateDir,
  type ConfigDeps,
} from '../src/audit/lib/effort.ts';

let tmp: string;
let warnings: string[];
let deps: ConfigDeps;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'gse-effort-'));
  warnings = [];
  deps = {
    env: {},
    stateDir: tmp,
    warn: (m) => warnings.push(m),
  };
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeConfig(lines: string[]) {
  writeFileSync(join(tmp, 'config'), lines.join('\n') + '\n');
}

describe('effortToLoc — defaults', () => {
  test('S/M/L/XL hardcoded defaults', () => {
    expect(effortToLoc('S', deps)).toBe(50);
    expect(effortToLoc('M', deps)).toBe(150);
    expect(effortToLoc('L', deps)).toBe(300);
    expect(effortToLoc('XL', deps)).toBe(500);
  });

  test('unknown tier returns 0', () => {
    expect(effortToLoc('XXL', deps)).toBe(0);
    expect(effortToLoc('', deps)).toBe(0);
    expect(effortToLoc('s', deps)).toBe(0); // case-sensitive, matches bash
  });
});

describe('ceiling — defaults', () => {
  test('all four cap keys have hardcoded defaults', () => {
    expect(ceiling('max_tasks_per_track', deps)).toBe(5);
    expect(ceiling('max_loc_per_track', deps)).toBe(300);
    expect(ceiling('max_files_per_track', deps)).toBe(8);
    expect(ceiling('max_tracks_per_group', deps)).toBe(8);
  });

  test('unknown key returns 0', () => {
    expect(ceiling('nope', deps)).toBe(0);
  });
});

describe('configIntGet — env > config-file > default', () => {
  test('env wins over config and default', () => {
    deps.env = { ROADMAP_EFFORT_S_LOC: '99' };
    writeConfig(['roadmap_effort_s_loc=77']);
    expect(effortToLoc('S', deps)).toBe(99);
  });

  test('config wins over default when env unset', () => {
    writeConfig(['roadmap_effort_s_loc=77']);
    expect(effortToLoc('S', deps)).toBe(77);
  });

  test('default when neither env nor config set', () => {
    expect(effortToLoc('S', deps)).toBe(50);
  });

  test('empty env value falls through to config', () => {
    deps.env = { ROADMAP_EFFORT_S_LOC: '' };
    writeConfig(['roadmap_effort_s_loc=77']);
    expect(effortToLoc('S', deps)).toBe(77);
  });
});

describe('configIntGet — invalid input', () => {
  test('non-numeric env value warns + falls through', () => {
    deps.env = { ROADMAP_EFFORT_S_LOC: 'lots' };
    expect(effortToLoc('S', deps)).toBe(50);
    expect(warnings.some((w) => w.startsWith('CONFIG_INVALID: env'))).toBe(true);
    expect(warnings[0]).toContain("env ROADMAP_EFFORT_S_LOC='lots'");
  });

  test('zero env value warns + falls through (bash rejects 0)', () => {
    deps.env = { ROADMAP_EFFORT_S_LOC: '0' };
    expect(effortToLoc('S', deps)).toBe(50);
    expect(warnings.some((w) => w.includes("env ROADMAP_EFFORT_S_LOC='0'"))).toBe(true);
  });

  test('non-numeric config value warns + falls through to default', () => {
    writeConfig(['roadmap_effort_s_loc=heaps']);
    expect(effortToLoc('S', deps)).toBe(50);
    expect(warnings.some((w) => w.startsWith('CONFIG_INVALID: roadmap_effort_s_loc'))).toBe(true);
  });

  test('invalid env then valid config falls through to config (matches bash semantics)', () => {
    deps.env = { ROADMAP_EFFORT_S_LOC: 'bad' };
    writeConfig(['roadmap_effort_s_loc=200']);
    expect(effortToLoc('S', deps)).toBe(200);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('env');
  });

  test('numeric edge cases — leading zero accepted (bash *[!0-9]* allows 01)', () => {
    deps.env = { ROADMAP_EFFORT_S_LOC: '01' };
    expect(effortToLoc('S', deps)).toBe(1);
    expect(warnings).toHaveLength(0);
  });

  test('numeric edge cases — scientific notation rejected (1e2)', () => {
    deps.env = { ROADMAP_EFFORT_S_LOC: '1e2' };
    expect(effortToLoc('S', deps)).toBe(50);
    expect(warnings).toHaveLength(1);
  });

  test('numeric edge cases — decimal rejected', () => {
    deps.env = { ROADMAP_EFFORT_S_LOC: '12.5' };
    expect(effortToLoc('S', deps)).toBe(50);
    expect(warnings).toHaveLength(1);
  });

  test('numeric edge cases — negative rejected', () => {
    deps.env = { ROADMAP_EFFORT_S_LOC: '-5' };
    expect(effortToLoc('S', deps)).toBe(50);
    expect(warnings).toHaveLength(1);
  });

  test('numeric edge cases — whitespace rejected', () => {
    deps.env = { ROADMAP_EFFORT_S_LOC: ' 50' };
    expect(effortToLoc('S', deps)).toBe(50);
    expect(warnings).toHaveLength(1);
  });
});

describe('configIntGet — config file edge cases', () => {
  test('missing config file is fine', () => {
    expect(effortToLoc('S', deps)).toBe(50);
    expect(warnings).toHaveLength(0);
  });

  test('config file with comments and blanks ignored', () => {
    writeConfig(['# top comment', '', 'roadmap_effort_s_loc=42', 'irrelevant=key']);
    expect(effortToLoc('S', deps)).toBe(42);
  });

  test('value with embedded equals preserved as bash bin/config does', () => {
    // bin/config: `awk -F= ... sub(/^[^=]*=/, "")` — value can contain =
    writeConfig(['roadmap_effort_s_loc=42=extra']);
    // 42=extra is non-numeric, should fall through with warning
    expect(effortToLoc('S', deps)).toBe(50);
    expect(warnings[0]).toContain("'42=extra'");
  });

  test('last key wins on duplicate keys', () => {
    writeConfig([
      'roadmap_effort_s_loc=10',
      'roadmap_effort_s_loc=99',
    ]);
    expect(effortToLoc('S', deps)).toBe(99);
  });
});

describe('configIntGet — direct (used by ceiling)', () => {
  test('direct configIntGet call respects deps', () => {
    deps.env = { MY_KEY: '42' };
    expect(configIntGet('my_cfg_key', 7, 'MY_KEY', deps)).toBe(42);
  });
});

describe('resolveStateDir', () => {
  test('uses GSTACK_EXTEND_STATE_DIR env', () => {
    expect(resolveStateDir({ env: { GSTACK_EXTEND_STATE_DIR: '/foo' } })).toBe('/foo');
  });

  test('uses explicit stateDir override', () => {
    expect(resolveStateDir({ env: {}, stateDir: '/bar' })).toBe('/bar');
  });

  test('falls back to ~/.gstack-extend by default', () => {
    const got = resolveStateDir({ env: {} });
    expect(got.endsWith('.gstack-extend')).toBe(true);
  });
});
