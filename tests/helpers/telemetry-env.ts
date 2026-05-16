/**
 * telemetry-env.ts — fixtures for testing bin/gstack-extend-telemetry and
 * the inline preamble/epilogue shell snippets in the 5 extend skill files.
 *
 * Why a helper: the wrapper and the integration tests all need the same
 * isolation primitives:
 *
 *   1. HOME = a per-test tmpdir so `~/.gstack/...` writes can never
 *      pollute the developer's real ~/.gstack/analytics/skill-usage.jsonl
 *      (the very file mind-meld retro reads — corrupting it would mix
 *      test garbage into real activity logs forever).
 *
 *   2. Symlinks under $tmpdir/.claude/skills/{gstack,gstack-extend}/
 *      pointing at the real installs, so the wrapper's 3-tier lookup
 *      (PATH → $GSTACK_DIR/bin → $HOME/.claude/skills/gstack/bin) resolves
 *      to a real, working gstack-telemetry-log without us having to
 *      install gstack into the tmpdir from scratch.
 *
 *   3. A stub mode that puts a capturing fake gstack-telemetry-log on
 *      PATH (and skips the symlink), so flag-pass-through can be asserted
 *      without spawning the real binary's side effects (config reads,
 *      background sync).
 *
 *   4. An "absent" mode with no symlink and no stub — exercises the
 *      silent-no-op contract when gstack isn't installed at all.
 *
 * Public API: makeTelemetryFixture(tier, mode) → fixture object;
 * telemetryEnv(fixture) → env vars to pass to spawnSync.
 */

import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, symlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..');
export const HELPER_BIN = join(ROOT, 'bin', 'gstack-extend-telemetry');
export const EXTEND_ROOT = ROOT;

/** Real gstack install location on the developer's machine. Tests skip when missing. */
export const REAL_GSTACK_ROOT = join(process.env.HOME ?? '', '.claude', 'skills', 'gstack');
export const REAL_GSTACK_BIN = join(REAL_GSTACK_ROOT, 'bin');

export type TelemetryTier = 'off' | 'anonymous' | 'community';
export type FixtureMode = 'real' | 'stub' | 'absent';

export type TelemetryFixture = {
  /** Per-test tmpdir. Becomes $HOME for spawned processes — also where ~/.gstack lives. */
  home: string;
  /** Build the env to pass to spawnSync. */
  env: Record<string, string>;
  /** Read the jsonl rows the wrapper wrote (parses each line as JSON). */
  readJsonl: () => Array<Record<string, unknown>>;
  /** When mode='stub': read the lines the stub captured. */
  readStubArgs: () => string[];
};

/**
 * Build a per-test telemetry fixture.
 *
 *   real   — symlink real gstack into $tmpdir/.claude/skills/gstack so the
 *            wrapper resolves the real gstack-telemetry-log. Writes go to
 *            $tmpdir/.gstack/analytics/. Use for end-to-end behavior tests.
 *   stub   — put a capturing fake gstack-telemetry-log on PATH. No real
 *            gstack involvement. Use for flag-pass-through assertions.
 *   absent — no symlink, no stub. Wrapper's 3-tier lookup all fails.
 *            Use for the silent-no-op contract.
 */
export function makeTelemetryFixture(tier: TelemetryTier, mode: FixtureMode = 'real'): TelemetryFixture {
  const home = mkdtempSync(join(tmpdir(), 'gx-tel-'));

  // gstack-config reads ${GSTACK_HOME:-${GSTACK_STATE_DIR:-$HOME/.gstack}}/config.yaml.
  // We leave GSTACK_HOME / GSTACK_STATE_DIR unset and rely on HOME=$tmpdir,
  // so config goes to $tmpdir/.gstack/config.yaml.
  mkdirSync(join(home, '.gstack'), { recursive: true });
  writeFileSync(join(home, '.gstack', 'config.yaml'), `telemetry: ${tier}\n`);

  let stubDir: string | undefined;
  const extraPath: string[] = [];

  if (mode === 'real') {
    if (!existsSync(REAL_GSTACK_ROOT)) {
      throw new Error(
        `telemetry-env: mode='real' requires gstack installed at ${REAL_GSTACK_ROOT}. ` +
          `Use mode='absent' or 'stub' for environments without gstack.`,
      );
    }
    // Symlink real gstack into the tmpdir so $HOME/.claude/skills/gstack/bin/...
    // resolves to the real binaries.
    mkdirSync(join(home, '.claude', 'skills'), { recursive: true });
    symlinkSync(REAL_GSTACK_ROOT, join(home, '.claude', 'skills', 'gstack'));
    // Symlink gstack-extend's bin dir so the epilogue's
    // $HOME/.claude/skills/gstack-extend/bin/gstack-extend-telemetry resolves.
    mkdirSync(join(home, '.claude', 'skills', 'gstack-extend'), { recursive: true });
    symlinkSync(join(ROOT, 'bin'), join(home, '.claude', 'skills', 'gstack-extend', 'bin'));
  } else if (mode === 'stub') {
    stubDir = mkdtempSync(join(tmpdir(), 'gx-stub-'));
    const stub = `#!/usr/bin/env bash
# Capturing stub for gstack-telemetry-log. Records argv to captured-args.txt
# as one invocation per line; args within an invocation are tab-separated so
# arg boundaries survive quoting (printf '%s\\n' "$*" would join on IFS and
# lose the boundary between "--skill" and "extend:my skill" if the value ever
# contained whitespace).
{ for _a in "$@"; do printf '%s\\t' "$_a"; done; printf '\\n'; } >> "${stubDir}/captured-args.txt"
exit 0
`;
    const stubPath = join(stubDir, 'gstack-telemetry-log');
    writeFileSync(stubPath, stub);
    chmodSync(stubPath, 0o755);
    extraPath.push(stubDir);
  }
  // mode === 'absent' → no symlink, no stub, nothing on PATH

  // Build PATH: stub dir first (when stub mode), then a minimal real PATH.
  // We deliberately EXCLUDE REAL_GSTACK_BIN from PATH so the wrapper's
  // fallback chain is exercised cleanly (real mode finds gstack via the
  // $HOME/.claude/... symlink, not via PATH).
  const path = [...extraPath, '/usr/bin', '/bin'].join(':');

  const env: Record<string, string> = {
    PATH: path,
    HOME: home,
    // TMPDIR preserved so mktemp inside spawned processes stays in the test's tmp tree
    ...(process.env.TMPDIR !== undefined ? { TMPDIR: process.env.TMPDIR } : {}),
  };

  return {
    home,
    env,
    readJsonl: () => {
      const file = join(home, '.gstack', 'analytics', 'skill-usage.jsonl');
      if (!existsSync(file)) return [];
      const raw = readFileSync(file, 'utf8').trim();
      if (raw === '') return [];
      return raw.split('\n').map((l) => JSON.parse(l));
    },
    readStubArgs: () => {
      if (stubDir === undefined) return [];
      const file = join(stubDir, 'captured-args.txt');
      if (!existsSync(file)) return [];
      return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
    },
  };
}
