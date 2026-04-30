/**
 * parsers-group-tracks.test.ts — unit tests for parseGroupTracks().
 *
 * Codex flagged awk-to-TS regex translation as a known silent-drift
 * surface (cross-model review #7). These tests cover ugly markdown the
 * e2e harness's happy-path fixture wouldn't exercise:
 *   - missing colon in group/track heading
 *   - `## Group N: Title ✓ Complete` (completion suffix from real ROADMAP.md)
 *   - sub-track ID (`### Track 2A.1:`)
 *   - multiple groups (terminator behavior)
 *   - track-like line under no current group (must be ignored)
 *   - Unicode in titles
 */

import { describe, expect, test } from 'bun:test';
import { parseGroupTracks } from '../src/test-plan/parsers.ts';

describe('parseGroupTracks', () => {
  test('happy path: one group, three tracks', () => {
    const md = [
      '## Group 1: Widget Pipeline',
      'Some prose.',
      '### Track 1A: Widget Core',
      'description',
      '### Track 1B: Widget Validation',
      '### Track 1C: Widget Bug-Bash',
      '## Other Heading',
    ].join('\n');
    const r = parseGroupTracks(md);
    expect(r).toHaveLength(1);
    expect(r[0]!.title).toBe('Widget Pipeline');
    expect(r[0]!.tracks).toHaveLength(3);
    expect(r[0]!.tracks[0]!.id).toBe('1A');
    expect(r[0]!.tracks[0]!.title).toBe('Widget Core');
    expect(r[0]!.tracks[2]!.id).toBe('1C');
  });

  test('multiple groups: tracks scoped to their own group', () => {
    const md = [
      '## Group 1: Alpha',
      '### Track 1A: A1',
      '## Group 2: Beta',
      '### Track 2A: B1',
      '### Track 2B: B2',
      '---',
      '## Group 3: Gamma ✓ Complete',
      '### Track 3A: G1',
    ].join('\n');
    const r = parseGroupTracks(md);
    expect(r).toHaveLength(3);
    expect(r[0]!.tracks).toHaveLength(1);
    expect(r[1]!.tracks).toHaveLength(2);
    expect(r[2]!.title).toBe('Gamma'); // ✓ Complete suffix stripped
    expect(r[2]!.tracks).toHaveLength(1);
  });

  test('completion suffix on group/track titles is stripped', () => {
    const md = [
      '## Group 1: Bootstrap ✓ Complete',
      '### Track 1A: Bootstrap bun ✓ Complete',
    ].join('\n');
    const r = parseGroupTracks(md);
    expect(r[0]!.title).toBe('Bootstrap');
    expect(r[0]!.tracks[0]!.title).toBe('Bootstrap bun');
  });

  test('sub-track IDs (e.g. 2A.1) parse correctly', () => {
    const md = [
      '## Group 2: Foo',
      '### Track 2A: Main',
      '### Track 2A.1: Sub',
      '### Track 2B: Other',
    ].join('\n');
    const r = parseGroupTracks(md);
    expect(r[0]!.tracks).toHaveLength(3);
    expect(r[0]!.tracks[1]!.id).toBe('2A.1');
  });

  test('track-like line outside any group is ignored', () => {
    const md = [
      'Preamble prose.',
      '### Track 9Z: Stray track',
      '## Group 1: First',
      '### Track 1A: Real track',
    ].join('\n');
    const r = parseGroupTracks(md);
    expect(r).toHaveLength(1);
    expect(r[0]!.tracks).toHaveLength(1);
    expect(r[0]!.tracks[0]!.id).toBe('1A');
  });

  test('non-Group `## ` heading closes track collection (no leak)', () => {
    const md = [
      '## Group 1: Real',
      '### Track 1A: One',
      '## Some Other Section',
      '### Track 1B: Should NOT be in Group 1',
      '## Group 2: After',
      '### Track 2A: Two',
    ].join('\n');
    const r = parseGroupTracks(md);
    expect(r).toHaveLength(2);
    expect(r[0]!.tracks).toHaveLength(1);
    expect(r[0]!.tracks[0]!.id).toBe('1A');
    expect(r[1]!.tracks).toHaveLength(1);
    expect(r[1]!.tracks[0]!.id).toBe('2A');
  });

  test('malformed group heading (no colon) is skipped', () => {
    const md = [
      '## Group 1 Missing Colon',
      '### Track 1A: Lost',
      '## Group 2: Real',
      '### Track 2A: Found',
    ].join('\n');
    const r = parseGroupTracks(md);
    expect(r).toHaveLength(1);
    expect(r[0]!.title).toBe('Real');
  });

  test('Unicode + special chars in titles preserved', () => {
    const md = [
      '## Group 1: Auth & Onboarding (v0.15)',
      '### Track 1A: Lögin → flow',
    ].join('\n');
    const r = parseGroupTracks(md);
    expect(r[0]!.title).toBe('Auth & Onboarding (v0.15)');
    expect(r[0]!.tracks[0]!.title).toBe('Lögin → flow');
  });

  test('empty roadmap returns no groups', () => {
    expect(parseGroupTracks('')).toEqual([]);
    expect(parseGroupTracks('\n\n# Title\nProse.\n')).toEqual([]);
  });
});
