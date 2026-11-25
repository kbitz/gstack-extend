import { cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function markedVersion(checkout: string): string {
  return JSON.parse(readFileSync(join(checkout, 'package.json'), 'utf8')).dependencies.marked;
}

export function installedMarkedVersion(checkout: string): string {
  return JSON.parse(readFileSync(join(checkout, 'node_modules', 'marked', 'package.json'), 'utf8')).version;
}

// Seed the exact version from the test checkout. The frozen lockfile needs
// only the package cache. New releases support --offline. Older releases
// use a closed loopback registry for any cache miss.
export function offlineFloorBun(
  checkout: string,
  dir: string,
  path: string,
  options: { failInstall?: boolean } = {},
): Record<string, string> {
  const version = markedVersion(checkout);
  const cache = join(dir, 'cache');
  const bin = join(dir, 'bin');
  const cacheVersion = `${version}@@@1`;
  const cachedPackage = `marked@${cacheVersion}`;
  mkdirSync(join(cache, 'marked'), { recursive: true });
  mkdirSync(bin, { recursive: true });
  cpSync(join(checkout, 'node_modules', 'marked'), join(cache, cachedPackage), { recursive: true, dereference: true });
  symlinkSync(`../${cachedPackage}`, join(cache, 'marked', cacheVersion));
  writeFileSync(join(bin, 'bun'), `#!/bin/sh
case "$1" in
  --version) echo '1.3.3' ;;
  --help) exec "$TEST_REAL_BUN" "$@" ;;
  install)
    case " $* " in
      *' --no-env-file '*) ;;
      *) echo 'fixture install environment flag missing' >&2; exit 44 ;;
    esac
    ${options.failInstall ? "echo 'fixture install refused' >&2; exit 43" : `if "$TEST_REAL_BUN" install --help | command -p grep -q -- --offline; then
      exec "$TEST_REAL_BUN" "$@" --offline --registry=https://registry.npmjs.org
    fi
    exec "$TEST_REAL_BUN" "$@" --registry=http://127.0.0.1:1`}
    ;;
  --no-env-file)
    case "${'$'}{2-} ${'$'}{3-}" in
      '--no-install --config=/dev/null'|'--config=/dev/null -e') ;;
      *) exit 44 ;;
    esac
    exec "$TEST_REAL_BUN" "$@"
    ;;
  *) echo 'fixture runtime flags missing' >&2; exit 44 ;;
esac
`, { mode: 0o755 });
  return { PATH: `${bin}:${path}`, TEST_REAL_BUN: process.execPath, BUN_INSTALL_CACHE_DIR: cache };
}
