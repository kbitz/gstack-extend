/**
 * check-version-tag-staleness.test.ts — unit coverage for the
 * version-tagged completed-item check.
 *
 * Renamed from check-staleness.test.ts in Track 6A alongside the section
 * rename STALENESS → VERSION_TAG_STALENESS and the STATUS bug fix
 * (fail → warn). Bash parity contracts exercised here:
 *   - "shipped" iff a matching tag exists OR current >= matched version.
 *   - Strikethrough markers: `~~text~~ DONE`, `~~text~~ ✓`, `~~text~~ ✅`,
 *     `~~text~~ Completed`, `^### ~~`. All trigger the version probe.
 *   - Lines without `(vX.Y.Z)` annotations are silently passed.
 *   - Both `(vX.Y.Z)` and `(X.Y.Z)` parenthetical forms accepted.
 *   - Findings emit STATUS: warn (was fail before Track 6A) so the section
 *     matches its skill-prose advisory classification.
 */

import { describe, expect, test } from 'bun:test';

import { runCheckVersionTagStaleness } from '../src/audit/checks/version-tag-staleness.ts';
import { makeCtx, stubGit } from './helpers/audit-ctx.ts';

describe('check_version_tag_staleness', () => {
  test('skip when no ROADMAP.md', () => {
    const ctx = makeCtx({ current: '0.5.0' });
    ctx.paths.roadmap = null;
    const r = runCheckVersionTagStaleness(ctx);
    expect(r.section).toBe('VERSION_TAG_STALENESS');
    expect(r.status).toBe('skip');
    expect(r.body).toContain('- No ROADMAP.md found');
  });

  test('pass when no completed-item markers', () => {
    const r = runCheckVersionTagStaleness(
      makeCtx({ roadmap: '# Active items\n- foo\n- bar\n', current: '0.5.0' }),
    );
    expect(r.status).toBe('pass');
    expect(r.body).toEqual(['FINDINGS:', '- (none)']);
  });

  test('flags ~~item~~ DONE (vX.Y.Z) when current is ahead — STATUS warn', () => {
    const md = ['line 1', 'line 2', '~~Old item~~ DONE (v0.3.0)', 'line 4'].join('\n');
    const r = runCheckVersionTagStaleness(makeCtx({ roadmap: md, current: '0.5.0' }));
    expect(r.status).toBe('warn');
    expect(r.body.some((l) => l.includes('line 3') && l.includes('v0.3.0'))).toBe(true);
  });

  test('flags ~~item~~ DONE when matching tag exists', () => {
    const md = '~~Old~~ DONE (v0.4.0)\n';
    const r = runCheckVersionTagStaleness(
      makeCtx({ roadmap: md, current: '0.4.0', git: stubGit({ tags: ['v0.4.0'] }) }),
    );
    expect(r.status).toBe('warn');
  });

  test('skips item whose version has not shipped', () => {
    const md = '~~Future~~ DONE (v9.9.9)\n';
    const r = runCheckVersionTagStaleness(
      makeCtx({ roadmap: md, current: '0.4.0', git: stubGit({ tags: ['v0.4.0'] }) }),
    );
    expect(r.status).toBe('pass');
  });

  test('matches all four marker variants', () => {
    const md = [
      '~~item A~~ DONE (v0.1.0)',
      '~~item B~~ ✓ (v0.1.0)',
      '~~item C~~ ✅ (v0.1.0)',
      '~~item D~~ Completed (v0.1.0)',
      '### ~~item E~~ (v0.1.0)',
    ].join('\n');
    const r = runCheckVersionTagStaleness(makeCtx({ roadmap: md, current: '0.2.0' }));
    expect(r.status).toBe('warn');
    const findings = r.body.filter((l) => l.startsWith('- line '));
    expect(findings.length).toBe(5);
  });

  test('strikethrough without version annotation is ignored', () => {
    const md = '~~Old item with no version~~ DONE\n~~Another~~ ✓\n';
    const r = runCheckVersionTagStaleness(makeCtx({ roadmap: md, current: '99.0.0' }));
    expect(r.status).toBe('pass');
  });

  test('plain (X.Y.Z) parenthetical (no v prefix) is recognized', () => {
    const md = '~~Old~~ DONE (0.3.0)\n';
    const r = runCheckVersionTagStaleness(makeCtx({ roadmap: md, current: '0.5.0' }));
    expect(r.status).toBe('warn');
    expect(r.body.some((l) => l.includes('v0.3.0'))).toBe(true);
  });

  test('finding line numbers are 1-indexed and match input order', () => {
    const md = ['', '', '~~A~~ DONE (v0.1.0)', '', '~~B~~ DONE (v0.2.0)'].join('\n');
    const r = runCheckVersionTagStaleness(makeCtx({ roadmap: md, current: '0.5.0' }));
    const findings = r.body.filter((l) => l.startsWith('- line '));
    expect(findings[0]).toContain('line 3');
    expect(findings[1]).toContain('line 5');
  });
});
