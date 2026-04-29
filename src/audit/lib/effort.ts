/**
 * effort.ts — effort/ceiling lookups with env > config-file > default fallback.
 *
 * Port of bin/lib/effort.sh. Reads ~/.gstack-extend/config (or
 * $GSTACK_EXTEND_STATE_DIR/config) as plain key=value lines. Reads env vars
 * directly via process.env. No shell-out to bin/config.
 *
 * Validation: only positive integers are accepted (matches bash
 * _is_positive_int). Invalid overrides emit a CONFIG_INVALID warning to
 * stderr and fall through to the next layer (default), so a typo in env
 * doesn't break the audit.
 *
 * LC_ALL=C parity: numeric validation uses /^[0-9]+$/ (ASCII digits only,
 * matches bash `case *[!0-9]*`). Coercion via parseInt(s, 10) only after
 * regex validation, so "08" becomes 8 (matches bash `(( $val ))` arithmetic).
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type EffortTier = 'S' | 'M' | 'L' | 'XL';

export type CeilingKey =
  | 'max_tasks_per_track'
  | 'max_loc_per_track'
  | 'max_files_per_track'
  | 'max_tracks_per_group';

const EFFORT_DEFAULTS: Record<EffortTier, number> = {
  S: 50,
  M: 150,
  L: 300,
  XL: 500,
};

const CEILING_DEFAULTS: Record<CeilingKey, number> = {
  max_tasks_per_track: 5,
  max_loc_per_track: 300,
  max_files_per_track: 8,
  max_tracks_per_group: 8,
};

const EFFORT_ENV: Record<EffortTier, string> = {
  S: 'ROADMAP_EFFORT_S_LOC',
  M: 'ROADMAP_EFFORT_M_LOC',
  L: 'ROADMAP_EFFORT_L_LOC',
  XL: 'ROADMAP_EFFORT_XL_LOC',
};

const EFFORT_CFG: Record<EffortTier, string> = {
  S: 'roadmap_effort_s_loc',
  M: 'roadmap_effort_m_loc',
  L: 'roadmap_effort_l_loc',
  XL: 'roadmap_effort_xl_loc',
};

const CEILING_ENV: Record<CeilingKey, string> = {
  max_tasks_per_track: 'ROADMAP_MAX_TASKS_PER_TRACK',
  max_loc_per_track: 'ROADMAP_MAX_LOC_PER_TRACK',
  max_files_per_track: 'ROADMAP_MAX_FILES_PER_TRACK',
  max_tracks_per_group: 'ROADMAP_MAX_TRACKS_PER_GROUP',
};

const CEILING_CFG: Record<CeilingKey, string> = {
  max_tasks_per_track: 'roadmap_max_tasks_per_track',
  max_loc_per_track: 'roadmap_max_loc_per_track',
  max_files_per_track: 'roadmap_max_files_per_track',
  max_tracks_per_group: 'roadmap_max_tracks_per_group',
};

function isPositiveInt(s: string): boolean {
  // /^[0-9]+$/ matches bash *[!0-9]* rejection on empty / non-digits.
  // Reject literal "0" to match bash `case 0) return 1 ;;`.
  if (!/^[0-9]+$/.test(s)) return false;
  if (s === '0') return false;
  // Reject leading-zero forms (we keep "01" as valid since bash accepts it).
  return true;
}

export type ConfigDeps = {
  /** Override env (defaults to process.env). Tests inject a fake. */
  env?: NodeJS.ProcessEnv;
  /** Override stateDir resolution. Tests inject a tmpdir. */
  stateDir?: string;
  /** Override stderr writer. Tests inject a buffer to assert CONFIG_INVALID warnings. */
  warn?: (msg: string) => void;
};

export function resolveStateDir(deps: ConfigDeps = {}): string {
  const env = deps.env ?? process.env;
  return deps.stateDir ?? env.GSTACK_EXTEND_STATE_DIR ?? join(homedir(), '.gstack-extend');
}

function readConfigFile(stateDir: string): Record<string, string> {
  const path = join(stateDir, 'config');
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq);
    const val = line.slice(eq + 1);
    out[key] = val;
  }
  return out;
}

export function configIntGet(
  cfgKey: string,
  defaultValue: number,
  envName: string,
  deps: ConfigDeps = {},
): number {
  const env = deps.env ?? process.env;
  const warn = deps.warn ?? ((msg: string) => process.stderr.write(msg + '\n'));

  const envVal = env[envName];
  if (envVal !== undefined && envVal !== '') {
    if (isPositiveInt(envVal)) return Number.parseInt(envVal, 10);
    warn(
      `CONFIG_INVALID: env ${envName}='${envVal}' (expected positive integer, using default ${defaultValue})`,
    );
  }

  const stateDir = resolveStateDir(deps);
  const cfg = readConfigFile(stateDir);
  const cfgVal = cfg[cfgKey];
  if (cfgVal !== undefined && cfgVal !== '') {
    if (isPositiveInt(cfgVal)) return Number.parseInt(cfgVal, 10);
    warn(
      `CONFIG_INVALID: ${cfgKey}='${cfgVal}' (expected positive integer, using default ${defaultValue})`,
    );
  }

  return defaultValue;
}

export function effortToLoc(tier: string, deps: ConfigDeps = {}): number {
  if (tier !== 'S' && tier !== 'M' && tier !== 'L' && tier !== 'XL') return 0;
  return configIntGet(EFFORT_CFG[tier], EFFORT_DEFAULTS[tier], EFFORT_ENV[tier], deps);
}

export function ceiling(key: string, deps: ConfigDeps = {}): number {
  if (
    key !== 'max_tasks_per_track' &&
    key !== 'max_loc_per_track' &&
    key !== 'max_files_per_track' &&
    key !== 'max_tracks_per_group'
  ) {
    return 0;
  }
  return configIntGet(CEILING_CFG[key], CEILING_DEFAULTS[key], CEILING_ENV[key], deps);
}
