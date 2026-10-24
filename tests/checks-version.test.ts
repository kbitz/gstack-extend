import { describe, expect, test } from 'bun:test';

import { runCheckVersion } from '../src/audit/checks/version.ts';
import type { CheckStatus } from '../src/audit/types.ts';
import { makeCtx, type MakeCtxOpts } from './helpers/audit-ctx.ts';

describe('runCheckVersion', () => {
  test('three-part candidate passes only its exact tag, not a padded-equal tag', () => {
    expect(runCheckVersion(makeCtx({ current: '0.47.0', versionInfo: { latestTag: 'v0.47.0' } })).status).toBe('pass');
    expect(runCheckVersion(makeCtx({ current: '0.47.0', versionInfo: { latestTag: 'v0.47.0.0' } })).status).toBe('fail');
    for (const current of ['0.47', '0.47.0.0.0', 'v0.47.0', '0.47.0-rc1']) {
      expect(runCheckVersion(makeCtx({ current, versionInfo: { latestTag: null } })).status).toBe('fail');
    }
  });

  const cases: Array<{
    name: string;
    opts: MakeCtxOpts;
    status: CheckStatus;
    body: string[];
  }> = [
    {
      name: 'valid non-initial version with a null tag warns (including unavailable git)',
      opts: { current: '1.2.3', versionInfo: { latestTag: null } },
      status: 'warn',
      body: ['FINDINGS:', '- No local git tags found — consider tagging releases (git tag v1.2.3)', ''],
    },
    {
      name: 'matching tag with a leading v passes',
      opts: { current: '1.2.3', versionInfo: { latestTag: 'v1.2.3' } },
      status: 'pass',
      body: ['FINDINGS:', '- (none)'],
    },
    {
      name: 'matching tag without a leading v passes',
      opts: { current: '1.2.3', versionInfo: { latestTag: '1.2.3' } },
      status: 'pass',
      body: ['FINDINGS:', '- (none)'],
    },
    {
      name: 'VERSION ahead of the latest tag fails',
      opts: { current: '1.2.4', versionInfo: { latestTag: 'v1.2.3' } },
      status: 'fail',
      body: ['FINDINGS:', '- VERSION version (1.2.4) does not match latest tag (v1.2.3)', ''],
    },
    {
      name: 'VERSION behind the latest tag fails',
      opts: { current: '1.2.2', versionInfo: { latestTag: 'v1.2.3' } },
      status: 'fail',
      body: ['FINDINGS:', '- VERSION version (1.2.2) does not match latest tag (v1.2.3)', ''],
    },
    {
      name: 'invalid version with a null tag fails before the advisory and keeps the generic hint',
      opts: { current: 'banana', versionInfo: { latestTag: null } },
      status: 'fail',
      body: [
        'FINDINGS:',
        '- version "banana" (from VERSION) is not valid (expected X.Y.Z or X.Y.Z.W)',
        '- No local git tags found — consider tagging releases (git tag vX.Y.Z)',
        '',
      ],
    },
    {
      name: 'invalid version with a tag fails for both format and mismatch',
      opts: { current: 'banana', versionInfo: { latestTag: 'v1.2.3' } },
      status: 'fail',
      body: [
        'FINDINGS:',
        '- version "banana" (from VERSION) is not valid (expected X.Y.Z or X.Y.Z.W)',
        '- VERSION version (banana) does not match latest tag (v1.2.3)',
        '',
      ],
    },
    {
      name: 'empty VERSION skips with its write-or-fallback hint',
      opts: { version: ' \t\n\r' },
      status: 'skip',
      body: [
        'FINDINGS:',
        '- VERSION file exists but is empty (write a version like `echo 0.1.0 > VERSION`, or delete the file to fall back to pyproject.toml)',
      ],
    },
    {
      name: 'missing version source skips with its existing hint',
      opts: { exists: { versionFile: false }, versionInfo: { source: 'unknown' } },
      status: 'skip',
      body: ['FINDINGS:', '- No VERSION file or pyproject.toml version found'],
    },
    {
      name: 'pyproject version with a null tag warns',
      opts: {
        current: '2.3.4',
        exists: { versionFile: false, pyprojectFile: true },
        versionInfo: { source: 'pyproject.toml', latestTag: null },
      },
      status: 'warn',
      body: ['FINDINGS:', '- No local git tags found — consider tagging releases (git tag v2.3.4)', ''],
    },
    {
      name: 'four-part initial version with a null tag warns with a matching four-part hint',
      opts: { current: '0.0.0.0', versionInfo: { latestTag: null } },
      status: 'warn',
      body: ['FINDINGS:', '- No local git tags found — consider tagging releases (git tag v0.0.0.0)', ''],
    },
  ];

  for (const { name, opts, status, body } of cases) {
    test(name, () => {
      const result = runCheckVersion(makeCtx(opts));
      expect(result.section).toBe('VERSION');
      expect(result.status).toBe(status);
      expect(result.body).toEqual(body);
      if (status === 'warn') {
        expect(result.preamble).toEqual([
          `CURRENT: ${opts.current}`,
          `SOURCE: ${opts.versionInfo?.source ?? 'VERSION'}`,
          'LATEST_TAG: (none)',
          'RECOMMEND: none',
        ]);
      }
    });
  }
});
