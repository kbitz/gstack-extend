import { describe, expect, test } from 'bun:test';
import { versionGt, semverLte, parseVersion } from '../src/audit/lib/semver.ts';

describe('versionGt', () => {
  test('strict greater', () => {
    expect(versionGt('1.2.4', '1.2.3')).toBe(true);
    expect(versionGt('1.3.0', '1.2.99')).toBe(true);
    expect(versionGt('2.0.0', '1.99.99')).toBe(true);
  });

  test('strict lesser', () => {
    expect(versionGt('1.2.3', '1.2.4')).toBe(false);
    expect(versionGt('1.2.99', '1.3.0')).toBe(false);
  });

  test('equal returns false (matches bash version_gt)', () => {
    expect(versionGt('1.2.3', '1.2.3')).toBe(false);
    expect(versionGt('0.0.0', '0.0.0')).toBe(false);
    expect(versionGt('1.2.3.4', '1.2.3.4')).toBe(false);
  });

  test('shorter version zero-pads on right', () => {
    // "1.2" == "1.2.0.0" per bash ${a[$i]:-0}
    expect(versionGt('1.2', '1.2.0')).toBe(false);
    expect(versionGt('1.2.0', '1.2')).toBe(false);
    expect(versionGt('1.2.1', '1.2')).toBe(true);
    expect(versionGt('1.2', '1.1.99')).toBe(true);
  });

  test('4-component (gstack-extend native)', () => {
    expect(versionGt('0.18.5.0', '0.18.4.0')).toBe(true);
    expect(versionGt('0.18.4.1', '0.18.4.0')).toBe(true);
    expect(versionGt('0.18.5', '0.18.5.0')).toBe(false);
    expect(versionGt('0.18.5.0', '0.18.5')).toBe(false);
  });

  test('non-numeric components treated as 0', () => {
    expect(versionGt('1.x.0', '1.0.0')).toBe(false);
    expect(versionGt('1.0.0', '1.x.0')).toBe(false);
    expect(versionGt('1.x.1', '1.0.0')).toBe(true);
  });

  test('empty string treated as 0.0.0.0', () => {
    expect(versionGt('', '0.0.0.0')).toBe(false);
    expect(versionGt('0.0.0.1', '')).toBe(true);
  });
});

describe('semverLte', () => {
  test('inclusive less-or-equal', () => {
    expect(semverLte('1.2.3', '1.2.3')).toBe(true);
    expect(semverLte('1.2.3', '1.2.4')).toBe(true);
    expect(semverLte('1.2.4', '1.2.3')).toBe(false);
  });
});

describe('parseVersion', () => {
  test('canonical 4-component', () => {
    expect(parseVersion('0.18.5.0')).toEqual([0, 18, 5, 0]);
  });

  test('shorter versions return their actual length', () => {
    expect(parseVersion('1.2')).toEqual([1, 2]);
    expect(parseVersion('1')).toEqual([1]);
  });

  test('non-numeric components become 0', () => {
    expect(parseVersion('1.x.3')).toEqual([1, 0, 3]);
  });

  test('empty string', () => {
    expect(parseVersion('')).toEqual([0]);
  });
});
