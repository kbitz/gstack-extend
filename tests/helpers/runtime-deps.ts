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
  options: { failInstall?: boolean; installWithoutPackages?: boolean; installMarker?: string; includeDevelopment?: boolean } = {},
): Record<string, string> {
  const version = markedVersion(checkout);
  const cache = join(dir, 'cache');
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const visited = new Set<string>();
  function seed(name: string, packageVersion?: string) {
    if (visited.has(name)) return;
    visited.add(name);
    const source = join(checkout, 'node_modules', name);
    const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
    const cacheVersion = `${packageVersion ?? manifest.version}@@@1`;
    const cachedPackage = `${name}@${cacheVersion}`;
    mkdirSync(join(cache, name), { recursive: true });
    cpSync(source, join(cache, cachedPackage), { recursive: true, dereference: true });
    symlinkSync(`../${cachedPackage}`, join(cache, name, cacheVersion));
    for (const dependency of Object.keys(manifest.dependencies ?? {})) seed(dependency);
  }
  seed('marked', version);
  if (options.includeDevelopment) seed('ajv');
  writeFileSync(join(bin, 'bun'), `#!/bin/sh
case "$1" in
  --version) echo '1.3.3' ;;
  --help) exec "$TEST_REAL_BUN" "$@" ;;
  install)
    if [ -n "${'$'}{TEST_INSTALL_MARKER-}" ]; then : >"$TEST_INSTALL_MARKER"; fi
    case " $* " in
      *' --no-env-file '*) ;;
      *) echo 'fixture install environment flag missing' >&2; exit 44 ;;
    esac
    ${options.failInstall ? "echo 'fixture install refused' >&2; exit 43" : options.installWithoutPackages ? 'exit 0' : `if "$TEST_REAL_BUN" install --help | command -p grep -q -- --offline; then
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
  return {
    PATH: `${bin}:${path}`,
    TEST_REAL_BUN: process.execPath,
    BUN_INSTALL_CACHE_DIR: cache,
    TEST_INSTALL_MARKER: options.installMarker ?? '',
  };
}
