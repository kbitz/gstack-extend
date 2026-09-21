/**
 * Isolated telemetry fixtures: HOME is always temporary and no inherited state
 * overrides reach the child. The real logger/config are copied without the
 * network sync helper; stub mode exercises CI without an installed gstack.
 */
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, symlinkSync, chmodSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..');
// Fixture homes are removed at process exit (the repo's exit-time cleanup convention). Each home holds a link into
// the real repo's bin/; rmSync unlinks a symlink without following it.
const fixtureHomes: string[] = [];
process.on('exit', () => {
  for (const home of fixtureHomes) {
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      // Best effort: a test may have left a directory unwritable.
    }
  }
});
export const HELPER_BIN = join(ROOT, 'bin', 'gstack-extend-telemetry');
export const REAL_GSTACK_ROOT = join(process.env.HOME ?? '', '.claude', 'skills', 'gstack');
export const REAL_GSTACK_BIN = join(REAL_GSTACK_ROOT, 'bin');
export type TelemetryTier = 'off' | 'anonymous' | 'community';
export type FixtureMode = 'real' | 'stub' | 'absent';
export type TelemetryFixture = {
  home: string;
  env: Record<string, string>;
  readJsonl: () => Array<Record<string, any>>;
  readStubArgs: () => string[];
};

export function makeTelemetryFixture(tier: TelemetryTier, mode: FixtureMode = 'stub'): TelemetryFixture {
  const home = mkdtempSync(join(tmpdir(), 'gx-tel-'));
  fixtureHomes.push(home);
  mkdirSync(join(home, '.gstack'), { recursive: true });
  writeFileSync(join(home, '.gstack', 'config.yaml'), `telemetry: ${tier}\n`);
  const upstream = join(home, '.claude/skills/gstack');
  const upstreamBin = join(upstream, 'bin');
  if (mode !== 'absent') {
    mkdirSync(upstreamBin, { recursive: true });
    mkdirSync(join(home, '.claude/skills/gstack-extend'), { recursive: true });
    symlinkSync(join(ROOT, 'bin'), join(home, '.claude/skills/gstack-extend/bin'));
  }
  if (mode === 'real') {
    for (const name of ['gstack-config', 'gstack-telemetry-log']) {
      copyFileSync(join(REAL_GSTACK_BIN, name), join(upstreamBin, name));
      chmodSync(join(upstreamBin, name), 0o755);
    }
    copyFileSync(join(REAL_GSTACK_ROOT, 'VERSION'), join(upstream, 'VERSION'));
  } else if (mode === 'stub') {
    const config = `#!/usr/bin/env python3
import os
from pathlib import Path
p = Path(os.environ.get('GSTACK_STATE_ROOT') or os.environ.get('GSTACK_HOME') or os.environ.get('GSTACK_STATE_DIR') or Path.home() / '.gstack') / 'config.yaml'
try:
    for line in p.read_text().splitlines():
        if line.startswith('telemetry:'):
            print(line.split(':', 1)[1].strip())
            break
except OSError:
    pass
`;
    const logger = `#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
from datetime import datetime, timezone
args = sys.argv[1:]
with (Path.home() / 'captured-args.txt').open('a') as f:
    f.write('\\t'.join(args) + '\\n')
values = {}
while args:
    key = args.pop(0)
    values[key] = True if key == '--no-sweep' else args.pop(0)
sink = Path(os.environ.get('GSTACK_STATE_DIR') or Path.home() / '.gstack') / 'analytics'
sink.mkdir(parents=True, exist_ok=True)
rows = []
# Deliberately simulate the destructive upstream behavior if the guard is lost.
if not values.get('--no-sweep'):
    for marker in sink.glob('.pending-*'):
        rows.append(dict(v=1, event_type='skill_run', skill='qa', outcome='unknown'))
        marker.unlink()
duration = int(values.get('--duration', '0'))
rows.append(dict(v=1, event_type='skill_run', ts=datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                 skill=values.get('--skill'), source=values.get('--source'),
                 session_id=values.get('--session-id'), duration_s=duration if duration <= 86400 else None,
                 outcome=values.get('--outcome', 'unknown')))
with (sink / 'skill-usage.jsonl').open('a') as f:
    for row in rows:
        f.write(json.dumps(row) + '\\n')
`;
    for (const [name, text] of [['gstack-config', config], ['gstack-telemetry-log', logger]]) {
      writeFileSync(join(upstreamBin, name), text);
      chmodSync(join(upstreamBin, name), 0o755);
    }
  }
  return {
    home,
    env: { HOME: home, PATH: '/usr/bin:/bin' },
    readJsonl: () => {
      const file = join(home, '.gstack/analytics/skill-usage.jsonl');
      if (!existsSync(file)) return [];
      return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
    },
    readStubArgs: () => {
      const file = join(home, 'captured-args.txt');
      return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean) : [];
    },
  };
}
