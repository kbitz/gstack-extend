/**
 * System tool directories for tests that isolate PATH from host CLIs.
 *
 * setup detects a host by its binary on PATH. macOS keeps those binaries out
 * of /bin and /usr/bin, but a Linux distro package can put one there (Arch's
 * cursor lands in /usr/bin), so "no host binaries" tests would detect it.
 * When any host binary sits in a system directory, return a farm of symlinks
 * to every other system tool instead.
 */

import { existsSync, mkdirSync, readdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

const HOST_BINARIES = new Set(['claude', 'codex', 'opencode', 'cursor']);
const SYSTEM_DIRS = ['/bin', '/usr/bin'];

export function systemPath(baseTmp: string): string {
  const leaks = SYSTEM_DIRS.some(dir => [...HOST_BINARIES].some(name => existsSync(join(dir, name))));
  if (!leaks) return SYSTEM_DIRS.join(':');
  const farm = join(baseTmp, 'system-bin');
  if (!existsSync(farm)) {
    mkdirSync(farm, { recursive: true });
    const linked = new Set<string>();
    // Earlier directories win, matching PATH order.
    for (const dir of SYSTEM_DIRS) {
      for (const name of readdirSync(dir)) {
        if (HOST_BINARIES.has(name) || linked.has(name)) continue;
        symlinkSync(join(dir, name), join(farm, name));
        linked.add(name);
      }
    }
  }
  return farm;
}
