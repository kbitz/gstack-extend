/**
 * check-vocab-lint.test.ts — direct unit coverage for `runCheckVocabLint`.
 *
 * Two-pass scan: (1) banned-term outer loop (cluster, workstream, milestone,
 * sprint), (2) `phase` state machine with whitelists. These tests pin each
 * branch of the state machine so a regression in transition handling
 * doesn't cascade across snapshot fixtures.
 */

import { describe, expect, test } from 'bun:test';

import { runCheckVocabLint } from '../src/audit/checks/vocab-lint.ts';
import { makeCtx } from './helpers/audit-ctx.ts';

describe('check_vocab_lint', () => {
  test('skip when no ROADMAP.md', () => {
    const ctx = makeCtx();
    ctx.paths.roadmap = null;
    const r = runCheckVocabLint(ctx);
    expect(r.section).toBe('VOCAB_LINT');
    expect(r.status).toBe('skip');
  });

  test('pass when no banned terms or stray phase', () => {
    const r = runCheckVocabLint(makeCtx({ roadmap: '# Title\n## Group 1: Foo\n' }));
    expect(r.status).toBe('pass');
    expect(r.body).toEqual(['FINDINGS:', '- (none)']);
  });

  test('banned-term outer order matches BANNED list (cluster→workstream→milestone→sprint)', () => {
    // Each banned term on its own line, declared OUT of the BANNED order.
    // The check should re-emit them in BANNED order (term-major), not file order.
    const md = [
      'A milestone here',
      'A sprint here',
      'A cluster here',
      'A workstream here',
    ].join('\n');
    const r = runCheckVocabLint(makeCtx({ roadmap: md }));
    expect(r.status).toBe('warn');
    const findings = r.body.filter((l) => l.startsWith('- line '));
    expect(findings).toHaveLength(4);
    // Order must follow BANNED = [cluster, workstream, milestone, sprint].
    expect(findings[0]).toContain('"cluster"');
    expect(findings[1]).toContain('"workstream"');
    expect(findings[2]).toContain('"milestone"');
    expect(findings[3]).toContain('"sprint"');
  });

  test('strikethrough lines (~~...~~) are skipped — not active drift', () => {
    const md = ['~~old cluster~~ DONE', 'fresh cluster line'].join('\n');
    const r = runCheckVocabLint(makeCtx({ roadmap: md }));
    expect(r.status).toBe('warn');
    const findings = r.body.filter((l) => l.startsWith('- line '));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('line 2');
  });

  test('"phase" whitelisted in title line (^# .*Phase)', () => {
    const md = ['# Roadmap Phase 1', '## Group 1: Foo', 'Some phase mention here'].join('\n');
    const r = runCheckVocabLint(makeCtx({ roadmap: md }));
    expect(r.status).toBe('warn');
    // Only line 3 (in GROUP state, not whitelisted) flags.
    const findings = r.body.filter((l) => l.startsWith('- line ') && l.includes('"phase"'));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('line 3');
  });

  test('"phase" whitelisted inside ## Future block', () => {
    const md = [
      '# Title',
      '## Future',
      '- item mentioning phase boundaries — no flag',
      '## Current Plan',
      '- item mentioning phase here — flagged',
    ].join('\n');
    const r = runCheckVocabLint(makeCtx({ roadmap: md }));
    expect(r.status).toBe('warn');
    const findings = r.body.filter((l) => l.startsWith('- line ') && l.includes('"phase"'));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('line 5');
  });

  test('"phase" whitelisted inside ## Phase N: block', () => {
    const md = [
      '# Title',
      '## Phase 1: Bootstrap',
      '- item mentioning phase boundaries inside the phase block — no flag',
      '## Group 1: Foo',
      '- item mentioning phase outside — flagged',
    ].join('\n');
    const r = runCheckVocabLint(makeCtx({ roadmap: md }));
    expect(r.status).toBe('warn');
    const findings = r.body.filter((l) => l.startsWith('- line ') && l.includes('"phase"'));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('line 5');
  });

  test('state machine resets to TOPLEVEL on plain ## heading after PHASE', () => {
    // Verify a non-Phase ## heading after a Phase block resets state, so subsequent
    // "phase" mentions outside FUTURE/PHASE get flagged.
    const md = [
      '# Title',
      '## Phase 1: Bootstrap',
      '- inside phase — no flag',
      '## Done',
      '- after phase — should flag',
    ].join('\n');
    const r = runCheckVocabLint(makeCtx({ roadmap: md }));
    expect(r.status).toBe('warn');
    const findings = r.body.filter((l) => l.startsWith('- line ') && l.includes('"phase"'));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('line 5');
  });
});
