import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const EXTEND_ROOT = resolve(import.meta.dir, '..');
const DRAFT = '## Current Plan\n#### Group 101: Example\n##### Track 101A: Example\n_touches: src/example.ts_\n- **Build example** -- fixture (S)\n';

describe('Process: hardened launchers', () => {
  let temp: string;
  let root: string;
  let env: Record<string, string>;

  beforeEach(() => {
    temp = realpathSync(mkdtempSync(join(tmpdir(), 'layout-process-')));
    root = join(temp, 'repo');
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(temp, 'home'));
    env = {
      PATH: process.env.PATH!, HOME: join(temp, 'home'),
      GSTACK_EXTEND_DIR: EXTEND_ROOT, GSTACK_EXTEND_STATE_DIR: join(temp, 'state'),
    };
    writeFileSync(join(root, 'docs/ROADMAP.md'), DRAFT);
    writeFileSync(join(root, 'preload.ts'), "import { writeFileSync } from 'node:fs'; writeFileSync('preload-marker', 'ran');\n");
    writeFileSync(join(root, 'probe.ts'), "console.log('probe ran');\n");
    writeFileSync(join(root, 'bunfig.toml'), 'preload = ["./preload.ts"]\n');
  });

  afterEach(() => rmSync(temp, { recursive: true, force: true }));

  test('positive control runs preload; every audit launcher starts read-only without it', () => {
    const control = spawnSync(process.execPath, ['probe.ts'], { cwd: root, env, input: '', encoding: 'utf8' });
    expect(control.status).toBe(0);
    expect(control.stdout).toContain('probe ran');
    expect(readFileSync(join(root, 'preload-marker'), 'utf8')).toBe('ran');
    unlinkSync(join(root, 'preload-marker'));

    const rows = [
      { bin: 'roadmap-audit', args: [root], input: '', line: 'DOC_LOCATION' },
      { bin: 'roadmap-pack', args: ['--stdin', root], input: DRAFT, line: 'BINS:' },
      { bin: 'roadmap-touches', args: ['report-cross-group', root], input: '', line: 'CROSS_GROUP:' },
      { bin: 'roadmap-renumber', args: ['--map', '101A=91A', '--dry-run', root], input: '', line: 'DRY_RUN:' },
    ];
    for (const row of rows) {
      const result = spawnSync(join(EXTEND_ROOT, 'bin', row.bin), row.args, {
        cwd: root, env, input: row.input, encoding: 'utf8',
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain(row.line);
      expect(existsSync(join(root, 'preload-marker'))).toBe(false);
      const launcher = readFileSync(join(EXTEND_ROOT, 'bin', row.bin), 'utf8');
      expect(launcher.split('\n').filter(line => line.startsWith('exec '))).toEqual([
        expect.stringContaining('exec bun --no-env-file --no-install --config=/dev/null '),
      ]);
    }
    expect(readFileSync(join(root, 'docs/ROADMAP.md'), 'utf8')).toBe(DRAFT);
  });
});
