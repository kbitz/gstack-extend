/**
 * semver.ts — pure version comparison.
 *
 * Port of bin/lib/semver.sh. Bash uses 4-component dotted versions (gstack-extend
 * MAJOR.MINOR.PATCH.MICRO); shorter versions are zero-padded on the right
 * (e.g. "1.2" compares as "1.2.0.0"). Non-numeric components compare as 0,
 * matching `${a[$i]:-0}` semantics in bash with empty/missing array entries.
 *
 * LC_ALL=C parity: comparisons are numeric, not string-locale. No Intl, no
 * String.localeCompare.
 */

export function versionGt(a: string, b: string): boolean {
  const aParts = parseVersion(a);
  const bParts = parseVersion(b);
  for (let i = 0; i < 4; i++) {
    const ai = aParts[i] ?? 0;
    const bi = bParts[i] ?? 0;
    if (ai > bi) return true;
    if (ai < bi) return false;
  }
  return false;
}

export function semverLte(a: string, b: string): boolean {
  return !versionGt(a, b);
}

export function parseVersion(v: string): number[] {
  return v.split('.').map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isNaN(n) ? 0 : n;
  });
}
