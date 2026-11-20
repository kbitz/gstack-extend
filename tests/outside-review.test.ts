import { describe, test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { prepare, snapshotDiff, CLOSING_LINES, POLICY, TASKS, type Request } from '../src/outside-review/prompt';
import { SETTLED_RULE } from '../src/review-delegate/delegate';
import { contextLine, recover, type Classifier } from '../src/outside-review/recovery';
import { run, measurement } from '../src/outside-review/run';
import { restrictedArgs, UPSTREAM_HELPERS } from '../src/outside-review/cli';
import { GOLDEN_CASES } from '../src/upstream-check/probe';

const request: Request = { repo: '.', base: 'a'.repeat(40), candidate: 'b'.repeat(40), scope: 'full',
  criteria: 'Retain duplicate-entry detection 🦊', instructions: 'Review all severities', context: '', structured: true };
// A deliberately strict upstream boundary fixture, not the recovery implementation.
const classify: Classifier = ({ text, gate, exit }) => {
  const execution = { state: exit || !text || text.startsWith('I cannot review') ? 'unavailable' : 'ran' };
  const highest = text.match(/\[(P[0-3])\]/)?.[1] ?? null;
  const findings = { highest };
  if (execution.state !== 'ran') return { execution, findings, verdict: 'unavailable', reason: 'execution_failed' };
  if (gate === 'review' && !/^Recommendation: .+ because .+/m.test(text)) return { execution, findings, verdict: 'unavailable', reason: 'missing_markers' };
  // The stub also reads the `NO_FINDINGS: none` line that POLICY asks for.
  if (!highest && !/^NO_FINDINGS(?:: none)?$/m.test(text)) return { execution, findings, verdict: 'unverified', reason: 'untagged_review' };
  return { execution, findings, verdict: highest === 'P0' || highest === 'P1' ? 'findings' : 'clean' };
};
const temporary = async (work: (dir: string) => Promise<void> | void) => {
  const dir = mkdtempSync(join(tmpdir(), 'extend-outside-test-'));
  try { await work(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

describe('completed outside recovery', () => {
  test('credits a paid finding with missing recommendation without losing priority', () => {
    const result = recover('[P1] parser accepts duplicate state', 'review', 0, '', classify);
    expect(result.parse).toBe('recovered');
    expect(result.credited).toBe(true);
    expect(result.classification.verdict).toBe('findings');
    expect(result.classification.findings.highest).toBe('P1');
  });
  test('recovers formatted markers and retains advisory findings', () => {
    const result = recover('- [p2] duplicate said entry\nRecommendation:\n Fix it because state duplicates.', 'review', 0, '', classify);
    expect(result.parse).toBe('recovered');
    expect(result.classification.findings.highest).toBe('P2');
  });
  test('only explicit no-findings can recover a missing recommendation', () => {
    expect(recover('NO_FINDINGS', 'review', 0, '', classify).credited).toBe(true);
    const ambiguous = recover('Looks reasonable overall.', 'review', 0, '', classify);
    expect(ambiguous.parse).toBe('failed');
    expect(ambiguous.classification.verdict).toBe('unverified');
  });
  test('failure, refusal, empty and missing context never credit a voice', () => {
    for (const [text, exit] of [['NO_FINDINGS', 124], ['', 0], ['I cannot review\nNO_FINDINGS', 0],
      ['NEEDS_CONTEXT: callers\nNO_FINDINGS\nRecommendation: wait because callers are missing.', 0]] as const) {
      expect(recover(text, 'review', exit, '', classify).credited).toBe(false);
    }
  });
  test('formatted missing context cannot claim completion beside NO_FINDINGS', () => {
    for (const marker of ['**NEEDS_CONTEXT:**', '- NEEDS_CONTEXT:', '# NEEDS_CONTEXT:', '`NEEDS_CONTEXT:`', '1. NEEDS_CONTEXT:']) {
      expect(recover(`${marker} callers\nNO_FINDINGS\nRecommendation: wait because callers are missing.`, 'review', 0, '', classify).credited).toBe(false);
    }
  });
  test('normalize lowercase blocking labels even beside a valid advisory label', () => {
    const result = recover('[p1] crash\n[P2] advisory\nRecommendation: fix because bug.', 'review', 0, '', classify);
    expect(result.classification.verdict).toBe('findings');
    expect(result.classification.findings.highest).toBe('P1');
  });
  test('prose and quoted marker examples do not invalidate a paid review', () => {
    for (const text of ['[P3] Prefer args[p1]', '[P3] Prefer `args[p1]`',
      '[P2] recovery.ts treats `NEEDS_CONTEXT:` too broadly', 'No NEEDS_CONTEXT: all callers present\n[P2] advisory',
      '```text\nNEEDS_CONTEXT: example only\n```\n[P2] advisory']) {
      const result = recover(text + '\nRecommendation: fix because advisory.', 'review', 0, '', classify);
      expect(result.credited).toBe(true);
      expect(result.parse).toBe('valid');
    }
    expect(recover('## NEEDS_CONTEXT\nMissing callers\n[P2] advisory', 'structured', 0, '', classify).credited).toBe(false);
  });
  test('context verdicts, tables and unterminated fences cannot credit incomplete coverage', () => {
    for (const marker of ['Recommendation: NEEDS_CONTEXT because callers are missing', 'Verdict: NEEDS_CONTEXT',
      '**Status:** NEEDS_CONTEXT:', '| Verdict | NEEDS_CONTEXT |', '| NEEDS_CONTEXT | callers |',
      'NEEDS_CONTEXT — missing callers', '```diff\nNEEDS_CONTEXT: missing callers',
      '```diff\nexample\n```ts\nNEEDS_CONTEXT: missing callers']) {
      const result = recover('[P2] advisory\nRecommendation: wait because callers are missing.\n' + marker, 'review', 0, '', classify);
      expect(result.credited).toBe(false);
      expect(result.classification.verdict).toBe('unverified');
    }
  });
});

describe('no-findings line the review prompt asks for', () => {
  const gates = ['review', 'structured'] as const;
  const NO_FINDINGS_SENTENCE = `If you have no findings, write the line "NO_FINDINGS: none" immediately before the Recommendation line, with nothing between them, and give your reason in the Recommendation's because-clause.`;
  const RECOMMENDATION_SENTENCE = 'After the findings, write Recommendation: <action> because <specific reason>.';
  const VERDICT_SENTENCE = 'End with exactly one more line, the last line of the reply: VERDICT: CLEAN if you report no findings, or VERDICT: FINDINGS if you report any finding.';
  // A reply that follows the prompt: rationale prose, the line, a Recommendation with its reason, and the last verdict line.
  const NO_FINDINGS_REPLY = 'I checked every hunk of the diff against the acceptance criteria and the supplied callers.\nNO_FINDINGS: none\nRecommendation: approve because every criterion is met and no caller changes behavior.\nVERDICT: CLEAN';
  // Reconstructs the shape of the Track 64A review reply (PR #192), not its text: a bold NO_FINDINGS opening,
  // prose, then a qualified Recommendation. The installed classifier left it uncredited.
  const REJECTED_2026_11_02 = '**NO_FINDINGS**\n\nThe prompt change keeps every gate and the tests pin each criterion.\n\nRecommendation: approve, subject to the AC4 check, because the change is confined to the prompt text.';

  // Value: protects=an outside review that follows POLICY's no-findings, Recommendation, and closing VERDICT instructions is credited on both
  //   gates, and the instructions keep their order (NO_FINDINGS before Recommendation before VERDICT last); fails_when=POLICY drops or
  //   reorders the closing lines; why_new=paid reviews were discarded as untagged_review or unverified_verdict when closing lines drifted; seam=none;
  //   no_claim=that a model follows the prompt; the classifier here is the strict stub
  test('no-findings line: POLICY asks for it and the stub credits a reply that follows it', () => {
    expect(POLICY.endsWith(CLOSING_LINES)).toBe(true);
    expect(POLICY).toContain(NO_FINDINGS_SENTENCE);
    expect(POLICY).not.toContain('end with NO_FINDINGS and an explicit rationale');
    expect(POLICY).not.toContain('End with Recommendation');
    for (const retained of ['Report concrete findings with [P0], [P1], [P2] or [P3], path, evidence and impact.',
      RECOMMENDATION_SENTENCE,
      VERDICT_SENTENCE,
      'If essential context is missing, return NEEDS_CONTEXT: <specific callers, contracts or tests>.',
      'Never declare a review complete when essential context is missing.']) {
      expect(POLICY).toContain(retained);
    }
    expect(POLICY.indexOf(NO_FINDINGS_SENTENCE)).toBeLessThan(POLICY.indexOf('Recommendation: <action> because <specific reason>'));
    expect(POLICY.indexOf('Recommendation: <action> because <specific reason>')).toBeLessThan(POLICY.indexOf('VERDICT: CLEAN'));
    for (const gate of gates) {
      const followed = recover(NO_FINDINGS_REPLY, gate, 0, '', classify);
      expect([gate, followed.credited, followed.parse, followed.classification.verdict]).toEqual([gate, true, 'valid', 'clean']);
      // Widening the stub for the requested line did not make it credit the old shape.
      const old = recover(REJECTED_2026_11_02, gate, 0, '', classify);
      expect([gate, old.credited, old.parse, old.classification.verdict]).toEqual([gate, false, 'failed', 'unverified']);
    }
  });

  // Value: protects=the requested line is credited by the installed validator, and the 2026-11-02 reply shape
  //   stays uncredited, so the fix stays in the prompt; fails_when=upstream's no-findings reading changes under
  //   the prompt, or recovery starts accepting the old shape; why_new=the stub cannot show what the installed
  //   classifier reads; seam=installed gstack lib (GSTACK_OUTSIDE_TEST_ROOT);
  //   no_claim=that a model follows the prompt
  test.skipIf(!process.env.GSTACK_OUTSIDE_TEST_ROOT)('no-findings line: the installed classifier credits it and still rejects the 2026-11-02 shape (installed only)', async () => {
    const { classifyOutsideReview } = await import(join(process.env.GSTACK_OUTSIDE_TEST_ROOT!, 'lib/outside-review-result.ts'));
    for (const gate of gates) {
      // A parse of `valid` shows recovery took no part in crediting the reply.
      const followed = recover(NO_FINDINGS_REPLY, gate, 0, '', classifyOutsideReview);
      expect([gate, followed.credited, followed.parse, followed.classification.verdict]).toEqual([gate, true, 'valid', 'clean']);
      const old = recover(REJECTED_2026_11_02, gate, 0, '', classifyOutsideReview);
      expect([gate, old.credited, old.parse, old.classification.verdict]).toEqual([gate, false, 'failed', 'unverified']);
      expect(['missing_verdict', 'untagged_review']).toContain(old.classification.reason!);
    }
  });
});

// Upstream 7cb151bf (1.99.0.0): on the review and structured gates, the reply's last nonempty line must be
// `VERDICT: CLEAN` or `VERDICT: FINDINGS` to credit a non-blocking review. The fixture below mirrors that rule subset;
// the installed classifier runs the same shapes when GSTACK_OUTSIDE_TEST_ROOT is set.
const lastLineVerdict: Classifier = ({ text, gate, exit }) => {
  const lines = text.trimEnd().split(/\r?\n/);
  const last = (lines.at(-1) ?? '').replace(/^[\t ]*(?:#{1,6}[\t ]+|[-+*][\t ]+)?/, '').replace(/[*_`]/g, '').trim();
  const token = /^VERDICT: (CLEAN|FINDINGS)$/.exec(last)?.[1] as 'CLEAN' | 'FINDINGS' | undefined;
  const body = token ? lines.slice(0, -1).join('\n') : text;
  const levels = [...body.matchAll(/\[(P[0-3])\]/g)].map(m => m[1]!).sort();
  const highest = levels[0] ?? null;
  const findings = { highest };
  if (exit || !text.trim()) return { execution: { state: 'unavailable' }, findings, verdict: 'unavailable', reason: 'execution_failed' };
  if (gate === 'review' && !/^Recommendation: .+ because\b.+/m.test(body)) {
    return { execution: { state: 'ran' }, findings, verdict: 'unavailable', reason: 'missing_markers' };
  }
  if (highest === 'P0' || highest === 'P1') return { execution: { state: 'ran' }, findings, verdict: 'findings' };
  const earlierVerdict = [...body.matchAll(/^[\t ]*Verdict[\t ]*:[\t ]*([^\r\n]*)$/gim)].at(-1)?.[1]?.trim();
  if (earlierVerdict !== undefined && !/^(?:ready|lgtm|approved?|ship(?:[\t ]+it)?|pass(?:ed)?|clean|good to (?:go|merge|ship)|NO_?FINDINGS)\b/i.test(earlierVerdict)) {
    return { execution: { state: 'ran' }, findings, verdict: 'unverified', reason: 'unverified_verdict' };
  }
  if (!token) return { execution: { state: 'ran' }, findings, verdict: 'unverified', reason: 'missing_verdict' };
  if (token === 'FINDINGS' && !highest) return { execution: { state: 'ran' }, findings, verdict: 'unverified', reason: 'untagged_review' };
  return { execution: { state: 'ran' }, findings, verdict: 'clean' };
};

describe('verdict line last (upstream 7cb151bf, 1.99.0.0)', () => {
  const gates = ['review', 'structured'] as const;
  const FINDING_BODY = [
    '**[P3] `docs/x.md`: clarify the fallback order in the prose note**',
    'The section lists the reasons without stating that the first match wins.',
    '',
    '**[P2] `src/x.ts`: guard the optional field before trimming**',
    'An empty string input reaches the branch without an explicit check.',
    '',
    '- Checked callers in `src/x.ts` and `tests/x.test.ts`.',
    '- No blocking defect found.',
  ].join('\n');
  const REC_LINE = 'Recommendation: merge, optionally tightening the note, because every finding is non-blocking.';
  // Reconstructs the shape (not the text) of the two 2026-11-12 outside replies: VERDICT: FINDINGS before Recommendation.
  const OLD_SHAPE = `${FINDING_BODY}\n\nVERDICT: FINDINGS\n\n${REC_LINE}`;
  // The corrected shape requested by CLOSING_LINES: Recommendation before the final VERDICT: FINDINGS line.
  const FIXED_SHAPE = `${FINDING_BODY}\n\n${REC_LINE}\nVERDICT: FINDINGS`;
  const CLEAN_SHAPE = 'I checked every hunk of the diff against the acceptance criteria and the supplied callers.\nNO_FINDINGS: none\nRecommendation: approve because every criterion is met and no caller changes behavior.\nVERDICT: CLEAN';

  // Value: protects=the corrected reply shape (Recommendation before a final VERDICT line) is credited through run() on both gates while
  //   the old 2026-11-12 shape (VERDICT: FINDINGS before Recommendation) has its documented uncredited/unverified_verdict outcome and
  //   recovery deliberately does not move the verdict line; fails_when=run() or recovery reorders a misplaced verdict line or stops crediting
  //   the corrected shape; why_new=Track 77B's two outside voices put VERDICT: FINDINGS before Recommendation under the old prompt and were
  //   discarded as unverified_verdict on 1.99.1.0; seam=run() and recover() with lastLineVerdict;
  //   no_claim=that a model follows the prompt
  test('credits the corrected shape and clean shape through the adapter, and documents the old verdict-before-recommendation shape as uncredited without recovery reordering', async () => {
    await temporary(async dir => {
      const results = await run(request, '+diff', dir, 'model', async () => ({ status: 'completed', result: FIXED_SHAPE }), lastLineVerdict);
      expect(results.map(r => [r.phase, r.credited, r.parse, r.classification.verdict, r.classification.findings.highest])).toEqual([
        ['challenge', true, 'valid', 'clean', 'P2'],
        ['structured', true, 'valid', 'clean', 'P2'],
      ]);
      expect(results.map(r => measurement(r).credited)).toEqual([true, true]);
    });
    await temporary(async dir => {
      const results = await run(request, '+diff', dir, 'model', async () => ({ status: 'completed', result: CLEAN_SHAPE }), lastLineVerdict);
      expect(results.map(r => [r.phase, r.credited, r.parse, r.classification.verdict, r.classification.findings.highest])).toEqual([
        ['challenge', true, 'valid', 'clean', null],
        ['structured', true, 'valid', 'clean', null],
      ]);
      expect(results.map(r => measurement(r).credited)).toEqual([true, true]);
    });
    await temporary(async dir => {
      const results = await run(request, '+diff', dir, 'model', async () => ({ status: 'completed', result: OLD_SHAPE }), lastLineVerdict);
      expect(results.map(r => [r.phase, r.credited, r.parse, r.classification.verdict, r.classification.reason, r.classification.findings.highest])).toEqual([
        ['challenge', false, 'failed', 'unverified', 'unverified_verdict', 'P2'],
        ['structured', false, 'failed', 'unverified', 'unverified_verdict', 'P2'],
      ]);
      expect(results.map(r => measurement(r).credited)).toEqual([false, false]);
    });
  });

  // Holds for installed gstack 1.99.0.0 and later.
  test.skipIf(!process.env.GSTACK_OUTSIDE_TEST_ROOT)('the installed classifier gives the same outcomes for the corrected, clean, and old shapes (installed only)', async () => {
    const { classifyOutsideReview } = await import(join(process.env.GSTACK_OUTSIDE_TEST_ROOT!, 'lib/outside-review-result.ts'));
    for (const gate of gates) {
      const fixed = recover(FIXED_SHAPE, gate, 0, '', classifyOutsideReview);
      expect([gate, fixed.credited, fixed.parse, fixed.classification.verdict, fixed.classification.findings.highest]).toEqual([gate, true, 'valid', 'clean', 'P2']);
      const clean = recover(CLEAN_SHAPE, gate, 0, '', classifyOutsideReview);
      expect([gate, clean.credited, clean.parse, clean.classification.verdict, clean.classification.findings.highest]).toEqual([gate, true, 'valid', 'clean', null]);
      const old = recover(OLD_SHAPE, gate, 0, '', classifyOutsideReview);
      expect([gate, old.credited, old.parse, old.classification.verdict, old.classification.reason, old.classification.findings.highest]).toEqual([
        gate, false, 'failed', 'unverified', 'unverified_verdict', 'P2',
      ]);
    }
  });
});

// Mirrors upstream 4ed1711d (#3925) + 7cb151bf (#4140): column-0 numbered items without a severity
// are counted as findings.unlabeled when the reply ends VERDICT: CLEAN, returning untagged_review.
const numberedCleanVerdict: Classifier = (input) => {
  const base = lastLineVerdict(input);
  if (base.execution.state !== 'ran') return base;
  const lines = input.text.trimEnd().split(/\r?\n/);
  const last = (lines.at(-1) ?? '').replace(/^[\t ]*(?:#{1,6}[\t ]+|[-+*][\t ]+)?/, '').replace(/[*_`]/g, '').trim();
  const token = /^VERDICT: (CLEAN|FINDINGS)$/.exec(last)?.[1] as 'CLEAN' | 'FINDINGS' | undefined;
  const body = token ? lines.slice(0, -1).join('\n') : input.text;
  const unlabeled = token === 'CLEAN'
    ? [...body.matchAll(/^(?:\*\*|__)?\(?\d{1,3}[.)][\t ]+\S.*$/gm)].filter(m => !/\[(P[0-3])\]/.test(m[0])).length
    : 0;
  if (!unlabeled) return base;
  const findings = { ...base.findings, unlabeled };
  if (base.verdict === 'clean' && token === 'CLEAN') {
    return { execution: base.execution, findings, verdict: 'unverified', reason: 'untagged_review' };
  }
  return { ...base, findings };
};

describe('nothing-missing context lines (Track 90A)', () => {
  const gates = ['review', 'structured'] as const;
  const OBSERVED_NONE_FORMS = [
    'NEEDS_CONTEXT: none (the context extension supplied all three requested interfaces).',
    'NEEDS_CONTEXT: none of the above depends on missing context. Every caller and schema was supplied in the prompt.',
  ] as const;
  const FORMATTING_NONE_VARIANTS = [
    ...OBSERVED_NONE_FORMS,
    '**NEEDS_CONTEXT:** none',
    '- NEEDS_CONTEXT: none',
    '`NEEDS_CONTEXT:` none',
    '1. NEEDS_CONTEXT: none',
    'NEEDS_CONTEXT — none',
    'NEEDS_CONTEXT – none',
    'NEEDS_CONTEXT - none',
    'NEEDS_CONTEXT: None.',
    '**NEEDS_CONTEXT: none**',
    'NEEDS_CONTEXT: none; all callers are present above.',
    'NEEDS_CONTEXT: none of the above depend on missing context.',
  ] as const;
  const FAIL_CLOSED_MISSING = [
    'NEEDS_CONTEXT: none of the callers are visible',
    'NEEDS_CONTEXT: none. The callers of x are missing.',
    'NEEDS_CONTEXT: none (callers needed)',
    'NEEDS_CONTEXT: none, but the schema is not shown',
    'NEEDS_CONTEXT: none; the schema was omitted',
    'NEEDS_CONTEXT: nonetheless callers are required',
    'NEEDS_CONTEXT: none-such',
    'NEEDS_CONTEXT: review material truncated',
    'NEEDS_CONTEXT:',
    'NEEDS_CONTEXT',
    '| NEEDS_CONTEXT | none |',
    '| NEEDS_CONTEXT: none |',
    'NEEDS_CONTEXT because callers are missing',
    'Verdict: NEEDS_CONTEXT',
    'NEEDS_CONTEXT: callers',
  ] as const;

  const findingsReply = (ctxLine: string) => [
    '[P1] `src/alpha.ts`: state check skips the duplicate branch when the map is empty.',
    '',
    ctxLine,
    'Recommendation: request changes because the duplicate branch is reachable.',
    'VERDICT: FINDINGS',
  ].join('\n');

  const cleanReply = (ctxLine: string) => [
    'Checked every hunk against the supplied callers and contracts.',
    ctxLine,
    'NO_FINDINGS: none',
    'Recommendation: approve because every criterion holds.',
    'VERDICT: CLEAN',
  ].join('\n');

  test('credits findings and clean replies carrying nothing-missing context lines and fails closed on missing-context forms', () => {
    for (const line of FORMATTING_NONE_VARIANTS) expect([line, contextLine(line)]).toEqual([line, 'none']);
    for (const line of FAIL_CLOSED_MISSING) expect([line, contextLine(line)]).toEqual([line, 'missing']);
    expect(contextLine('No NEEDS_CONTEXT: all callers present')).toBeNull();

    for (const classifier of [classify, lastLineVerdict]) {
      for (const gate of gates) {
        // (a) Findings reply with each observed value form + trailing sentence.
        for (const line of OBSERVED_NONE_FORMS) {
          const res = recover(findingsReply(line), gate, 0, '', classifier);
          expect([gate, line, res.credited, res.parse, res.classification.verdict, res.needs_context]).toEqual([
            gate, line, true, 'valid', 'findings', false,
          ]);
        }
        // (b) NO_FINDINGS reply beside it.
        for (const line of OBSERVED_NONE_FORMS) {
          const res = recover(cleanReply(line), gate, 0, '', classifier);
          expect([gate, line, res.credited, res.parse, res.classification.verdict, res.needs_context]).toEqual([
            gate, line, true, 'valid', 'clean', false,
          ]);
        }
        // (c) Formatting variants table.
        for (const line of FORMATTING_NONE_VARIANTS) {
          const res = recover(cleanReply(line), gate, 0, '', classifier);
          expect([gate, line, res.credited, res.parse, res.classification.verdict, res.needs_context]).toEqual([
            gate, line, true, 'valid', 'clean', false,
          ]);
        }
        // (d) Fail-closed table, plus a reply carrying both a nothing-missing line and a naming line.
        for (const line of [...FAIL_CLOSED_MISSING, `${OBSERVED_NONE_FORMS[0]}\nNEEDS_CONTEXT: callers of alpha()`]) {
          for (const reply of [findingsReply(line), cleanReply(line)]) {
            const res = recover(reply, gate, 0, '', classifier);
            expect([gate, line, res.credited, res.parse, res.classification.verdict, res.needs_context]).toEqual([
              gate, line, false, 'failed', 'unverified', true,
            ]);
          }
        }
      }
    }
  });

  // Lines that name missing context through a contraction, a typographic apostrophe, a request, a caveat or a
  // code-span deny word, and nothing-missing lines with a nested call or a benign negation (review fixes).
  const NAMING_REVIEW_FIXES = [
    'NEEDS_CONTEXT: none (I can’t see the callers)',
    "NEEDS_CONTEXT: none (the body wasn't shown)",
    "NEEDS_CONTEXT: none; the callers weren't provided",
    'NEEDS_CONTEXT: none; please supply src/x.ts',
    'NEEDS_CONTEXT: none (unable to see the callers of alpha)',
    'NEEDS_CONTEXT: none (I lack the callers)',
    "NEEDS_CONTEXT: none. I don't have the schema.",
    'NEEDS_CONTEXT: none (for the first item) except the callers of alpha()',
    'NEEDS_CONTEXT: none. The implementation excerpt is `missing`.',
    'NEEDS_CONTEXT: none. Diff was cut off.',
    'NEEDS_CONTEXT: none (callers of alpha() would help)',
  ] as const;
  const NONE_REVIEW_FIXES = [
    'NEEDS_CONTEXT: none (callers of alpha() were supplied).',
    'NEEDS_CONTEXT: none (the change does not touch any caller).',
  ] as const;
  // Owner decision A (review cycle 2): an explanation may only affirm supplied context. A negation, absence,
  // inability, request or hedge, another marker, a severity label or a `path:line`, or a deny word before the
  // marker fails closed; a statement that the change does not touch, change, edit, modify, affect or depend on
  // something is allowed.
  const NAMING_CYCLE_2 = [
    'NEEDS_CONTEXT: none. The callers are not in the diff.',
    'NEEDS_CONTEXT: none (all supplied). Callers of alpha() are invisible.',
    'NEEDS_CONTEXT: none (the callers are not in the prompt).',
    "NEEDS_CONTEXT: none. The schema isn't in the supplied material.",
    'NEEDS_CONTEXT: none (I have no access to the caller source).',
    'NEEDS_CONTEXT: none (I did not receive the schema)',
    "NEEDS_CONTEXT: none. The diff doesn't show the callers.",
    'NEEDS_CONTEXT: none. Nothing about the callers was supplied.',
    'NEEDS_CONTEXT: none. Only the diff was reviewed.',
    'NEEDS_CONTEXT: none. For the delegate path, NEEDS_CONTEXT: the callers of recover() in cli.ts.',
    'NEEDS_CONTEXT: none. [P1] `src/alpha.ts`: the retry loop drops the write on timeout.',
    'NEEDS_CONTEXT: none. src/alpha.ts:14 loses the write when the timeout fires.',
    '`callers absent` NEEDS_CONTEXT: none',
  ] as const;
  const NONE_CYCLE_2 = [
    'NEEDS_CONTEXT: none of the above depends on missing context. The fix does not depend on any caller.',
  ] as const;
  // Owner decision A (review cycle 3): each part of the explanation (its parenthetical and each sentence or clause)
  // must say context was supplied or state that the change does not touch, change, edit, modify, affect or depend on
  // a list of names. A request, hedge or defect in other words, a sentence that affirms nothing, a clause after the
  // affirmation, a path followed by a verb, a qualified label, severity word, quote, brace or question, another
  // subject for the change statement, and any text before the marker but list, quote or heading markup fail closed.
  const NAMING_CYCLE_3 = [
    'NEEDS_CONTEXT: none. Can you show the callers of parse()?',
    'NEEDS_CONTEXT: none (presumably the loader validates input)',
    'NEEDS_CONTEXT: none (callers of parse() unverified)',
    'NEEDS_CONTEXT: none. I am requesting the caller source.',
    'NEEDS_CONTEXT: none (show me the callers of alpha())',
    "NEEDS_CONTEXT: none. I'd like the callers.",
    'NEEDS_CONTEXT: none. The retry loop drops the write when the timeout fires.',
    'NEEDS_CONTEXT: none. Dockerfile:12 exposes the signing key in the image.',
    'NEEDS_CONTEXT: none. Makefile:14 loses the write.',
    'NEEDS_CONTEXT: none (all three interfaces were supplied). The tests agree.',
    'NEEDS_CONTEXT: none (every caller was supplied and the token check accepts expired tokens)',
    'NEEDS_CONTEXT: none (src/auth.ts accepts expired tokens and every caller was supplied)',
    'NEEDS_CONTEXT: none (all supplied). [P1, security] The token check accepts expired tokens.',
    'NEEDS_CONTEXT: none (all supplied). Critical: the token check accepts expired tokens.',
    'NEEDS_CONTEXT: none (all supplied). {"callers": "supplied"}',
    'NEEDS_CONTEXT: none (all supplied). bin/outside-review:14 was supplied.',
    'NEEDS_CONTEXT: none (I did not touch the callers)',
    'NEEDS_CONTEXT: none. The supplied excerpts do not touch the caller implementation.',
    '`src/alpha.ts:14 loses the write` NEEDS_CONTEXT: none',
    '`[P1] retry drops writes` NEEDS_CONTEXT: none',
    'Status: NEEDS_CONTEXT: none',
  ] as const;
  const NONE_CYCLE_3 = [
    'NEEDS_CONTEXT: none (all three interfaces were supplied). The tests were supplied too.',
    'NEEDS_CONTEXT: none (callers in src/cli.ts were supplied).',
    '- NEEDS_CONTEXT: none (the change does not touch `src/cli.ts` or its callers).',
  ] as const;

  // Value: protects=owner decision A for context lines: a negating, hedging or requesting explanation, a glued marker,
  //   label or path:line, and a deny word before the marker keep coverage missing, while a supplied-context explanation,
  //   the allowed non-dependency statement and a numbered nothing-missing line are credited; fails_when=the remainder scan
  //   credits any naming line or the numbered line stays an unlabeled item; why_new=cycle 2 of Track 90A's review
  //   reproduced each; seam=contextLine() and recover(); no_claim=an exhaustive list of phrasings
  test('fails closed on negation, absence, hedges, glued markers and text before the marker (owner decision A)', () => {
    for (const line of NAMING_CYCLE_2) expect([line, contextLine(line)]).toEqual([line, 'missing']);
    for (const line of NONE_CYCLE_2) expect([line, contextLine(line)]).toEqual([line, 'none']);
    for (const classifier of [classify, lastLineVerdict]) {
      for (const gate of gates) {
        for (const line of NAMING_CYCLE_2) {
          const res = recover(cleanReply(line), gate, 0, '', classifier);
          expect([gate, line, res.credited, res.needs_context]).toEqual([gate, line, false, true]);
        }
        for (const line of NONE_CYCLE_2) {
          const res = recover(cleanReply(line), gate, 0, '', classifier);
          expect([gate, line, res.credited, res.parse, res.classification.verdict]).toEqual([gate, line, true, 'valid', 'clean']);
        }
      }
    }
    for (const gate of gates) {
      const numbered = recover(cleanReply('1. NEEDS_CONTEXT: none'), gate, 0, '', numberedCleanVerdict);
      expect([gate, numbered.credited, numbered.parse, numbered.classification.verdict]).toEqual([gate, true, 'recovered', 'clean']);
    }
  });

  // Value: protects=owner decision A for context lines: only a supplied-context affirmation or the change statement is
  //   credited, so a request, hedge, defect, unaffirmed sentence, glued label or path, foreign subject or text before the
  //   marker keeps coverage missing; fails_when=the explanation is screened with a deny list again or the prefix and glue
  //   checks are dropped; why_new=cycle 3 of Track 90A's review reproduced each naming line as credited;
  //   seam=contextLine() and recover(); no_claim=an exhaustive list of phrasings
  test('credits only supplied-context affirmations and the change statement (owner decision A, cycle 3)', () => {
    for (const line of NAMING_CYCLE_3) expect([line, contextLine(line)]).toEqual([line, 'missing']);
    for (const line of NONE_CYCLE_3) expect([line, contextLine(line)]).toEqual([line, 'none']);
    for (const classifier of [classify, lastLineVerdict]) {
      for (const gate of gates) {
        for (const line of NAMING_CYCLE_3) {
          const res = recover(cleanReply(line), gate, 0, '', classifier);
          expect([gate, line, res.credited, res.parse, res.needs_context]).toEqual([gate, line, false, 'failed', true]);
        }
        for (const line of NONE_CYCLE_3) {
          const res = recover(cleanReply(line), gate, 0, '', classifier);
          expect([gate, line, res.credited, res.parse, res.classification.verdict]).toEqual([gate, line, true, 'valid', 'clean']);
        }
      }
    }
  });

  // Owner decision A (continuation review): an affirmation uses only a closed vocabulary (affirming words, copulas,
  // determiners, review-material nouns, attributive adjectives, a number after `all`, code names) and names nothing
  // but in-prompt places after its affirming word; each change-statement name is a code name or a vocabulary noun.
  // Outside material, exclusions, partial supply, unlisted negators or quantifiers, curly or single quotes, a
  // predicative `requested`, two counts and a clause among the names therefore fail closed.
  const NAMING_CONTINUATION = [
    'NEEDS_CONTEXT: none (the callers are available in the repository).',
    'NEEDS_CONTEXT: none (the schema is available upon request).',
    'NEEDS_CONTEXT: none (the callers are available on GitHub).',
    'NEEDS_CONTEXT: none (the callers are covered by CI).',
    'NEEDS_CONTEXT: none (the callers are present in the original module).',
    'NEEDS_CONTEXT: none (all files were supplied excluding the schema).',
    'NEEDS_CONTEXT: none (everything was provided other than the test fixtures).',
    'NEEDS_CONTEXT: none (all requested interfaces were supplied apart from the config schema)',
    'NEEDS_CONTEXT: none (the callers were shown in part).',
    'NEEDS_CONTEXT: none (the callers were partly supplied).',
    'NEEDS_CONTEXT: none (the callers were incompletely provided).',
    'NEEDS_CONTEXT: none (the provided diff ends before END_OF_REVIEW_MATERIAL)',
    'NEEDS_CONTEXT: none (the diff was provided up to the 400-line cap)',
    'NEEDS_CONTEXT: none. src/b.ts was provided empty.',
    'NEEDS_CONTEXT: none. Context supplied is limited to the diff.',
    'NEEDS_CONTEXT: none. The supplied context excludes the authentication middleware.',
    'NEEDS_CONTEXT: none (supplied excerpts exclude the callers)',
    'NEEDS_CONTEXT: none. The schema wasn`t provided.',
    'NEEDS_CONTEXT: none. The callers werent provided.',
    'NEEDS_CONTEXT: none. Nobody provided the callers.',
    'NEEDS_CONTEXT: none. Zero callers were provided.',
    'NEEDS_CONTEXT: none. Just the diff was provided.',
    'NEEDS_CONTEXT: none. The diff alone was provided.',
    'NEEDS_CONTEXT: none (all “requested” files were provided)',
    "NEEDS_CONTEXT: none (all 'requested' files were provided)",
    'NEEDS_CONTEXT: none. Three interfaces were supplied and four were requested.',
    'NEEDS_CONTEXT: none. The callers were supplied and the schema was requested.',
    'NEEDS_CONTEXT: none. The change does not touch auth, and the token validator accepts expired tokens.',
    'NEEDS_CONTEXT: none. The change does not touch auth, and src/auth.ts is accepting expired tokens.',
  ] as const;
  const NONE_CONTINUATION = [
    'NEEDS_CONTEXT: none (the requested interfaces are present in the supplied diff).',
    'NEEDS_CONTEXT: none (every caller of alpha() was supplied in full).',
    "NEEDS_CONTEXT: none. The module's callers were supplied as well.",
    'NEEDS_CONTEXT: none (all four requested interfaces were provided by the context extension).',
    'NEEDS_CONTEXT: none. Everything is visible above.',
    'NEEDS_CONTEXT: none. The change does not touch `src/cli.ts`, its callers or the parse() helper.',
  ] as const;

  // Value: protects=owner decision A for context lines as a closed vocabulary: a nothing-missing explanation that places
  //   the material outside the prompt, excludes part of it, says it was partial, or carries an unlisted negator,
  //   quantifier, quote or clause keeps coverage missing, on the outside and numbered paths, while plain supplied-context
  //   affirmations and the change statement stay credited; fails_when=any explanation word outside the vocabulary is
  //   accepted again; why_new=the continuation review of Track 90A reproduced each naming line as credited at f15befa7;
  //   seam=contextLine() and recover(); no_claim=an exhaustive list of phrasings
  test('credits only a closed supplied-context vocabulary and change-statement names (owner decision A, continuation)', () => {
    for (const line of NAMING_CONTINUATION) expect([line, contextLine(line)]).toEqual([line, 'missing']);
    for (const line of NONE_CONTINUATION) expect([line, contextLine(line)]).toEqual([line, 'none']);
    for (const classifier of [classify, lastLineVerdict]) {
      for (const gate of gates) {
        for (const line of NAMING_CONTINUATION) {
          const res = recover(cleanReply(line), gate, 0, '', classifier);
          expect([gate, line, res.credited, res.parse, res.needs_context]).toEqual([gate, line, false, 'failed', true]);
        }
        for (const line of NONE_CONTINUATION) {
          for (const [reply, verdict] of [[cleanReply(line), 'clean'], [findingsReply(line), 'findings']] as const) {
            const res = recover(reply, gate, 0, '', classifier);
            expect([gate, line, res.credited, res.parse, res.classification.verdict, res.needs_context]).toEqual([
              gate, line, true, 'valid', verdict, false,
            ]);
          }
        }
      }
    }
    // A numbered naming line keeps its number, so upstream's numbered-item rule still applies to it.
    const numbered = [
      '1. **Expired tokens are rejected.** Met.',
      '2. NEEDS_CONTEXT: none (the provided login handler accepts expired tokens)',
      'NO_FINDINGS: none',
      'Recommendation: approve because every criterion holds.',
      'VERDICT: CLEAN',
    ].join('\n');
    for (const gate of gates) {
      const res = recover(numbered, gate, 0, '', numberedCleanVerdict);
      expect([gate, res.credited, res.needs_context]).toEqual([gate, false, true]);
    }
  });

  // Continuation review, cycle 2: a code name is a call or a file name with a listed extension, never an abbreviation or
  // words joined by a slash or dot; a part never opens with a copula; an attribute never follows a copula; and each comma
  // clause with its own copula holds its own affirming word.
  const NAMING_CONTINUATION_C2 = [
    'NEEDS_CONTEXT: none. The callers are supplied w/o their tests.',
    'NEEDS_CONTEXT: none (all callers w/o src/a.ts supplied)',
    'NEEDS_CONTEXT: none (the diff is supplied, the callers n/a)',
    'NEEDS_CONTEXT: none. The callers are supplied, the tests are n.a.',
    'NEEDS_CONTEXT: none. 0.5 of the callers are supplied.',
    'NEEDS_CONTEXT: none. The diff is supplied, the callers and tests are missing/stale.',
    'NEEDS_CONTEXT: none (the callers and/or the tests were supplied)',
    'NEEDS_CONTEXT: none (the diff is visible, the callers not.visible)',
    'NEEDS_CONTEXT: none. The diff is available, the callers are requested context.',
    'NEEDS_CONTEXT: none. Are all the callers supplied',
    'NEEDS_CONTEXT: none. The diff is complete, the requested context is config.ts and the callers of parse().',
    'NEEDS_CONTEXT: none (the diff is supplied, the callers are the requested material)',
    'NEEDS_CONTEXT: none. Had the full callers been supplied, the tests are covered.',
  ] as const;
  const NONE_CONTINUATION_C2 = [
    'NEEDS_CONTEXT: none (all callers, tests and fixtures were supplied).',
    'NEEDS_CONTEXT: none (x.h, package.json and the callers of parse() were supplied).',
    'NEEDS_CONTEXT: none. The diff is supplied, the callers are present in the prompt.',
  ] as const;

  // Value: protects=owner decision A's closed vocabulary against abbreviations and joined words read as code names,
  //   clauses that borrow another clause's affirming word, predicate attributes and copula-first questions; fails_when=a
  //   slash or dot token without a listed extension, a comma clause without its own affirming word, or an inverted part is
  //   credited again; why_new=cycle 2 of the continuation review reproduced each as credited at cb43794c;
  //   seam=contextLine() and recover(); no_claim=an exhaustive list of phrasings
  test('reads code names by shape and each comma clause on its own (owner decision A, continuation cycle 2)', () => {
    for (const line of NAMING_CONTINUATION_C2) expect([line, contextLine(line)]).toEqual([line, 'missing']);
    for (const line of NONE_CONTINUATION_C2) expect([line, contextLine(line)]).toEqual([line, 'none']);
    for (const classifier of [classify, lastLineVerdict]) {
      for (const gate of gates) {
        for (const line of NAMING_CONTINUATION_C2) {
          const res = recover(cleanReply(line), gate, 0, '', classifier);
          expect([gate, line, res.credited, res.parse, res.needs_context]).toEqual([gate, line, false, 'failed', true]);
        }
        for (const line of NONE_CONTINUATION_C2) {
          const res = recover(cleanReply(line), gate, 0, '', classifier);
          expect([gate, line, res.credited, res.parse, res.classification.verdict]).toEqual([gate, line, true, 'valid', 'clean']);
        }
      }
    }
  });

  // Continuation review, cycle 3: a part never opens with an affirming word (a condition or an imperative), a comma clause
  // after an affirmed clause holds its own affirming word, and `full` names a place only in `in full`.
  const NAMING_CONTINUATION_C3 = [
    'NEEDS_CONTEXT: none (provided the callers are supplied).',
    'NEEDS_CONTEXT: none. Present the callers of save().',
    'NEEDS_CONTEXT: none (present the callers of save())',
    'NEEDS_CONTEXT: none. Complete the schema.',
    'NEEDS_CONTEXT: none. The diff is supplied, requested callers of save().',
    'NEEDS_CONTEXT: none. The diff is supplied, the callers of save().',
    'NEEDS_CONTEXT: none. The callers are available in the full src/caller.ts file.',
  ] as const;
  const NONE_CONTINUATION_C3 = [
    'NEEDS_CONTEXT: none (every caller of alpha() was supplied in full).',
    'NEEDS_CONTEXT: none. The full diff was supplied in full, the callers are present in the full excerpt.',
    'NEEDS_CONTEXT: none (the requested interfaces were provided by the context extension).',
  ] as const;

  // Value: protects=owner decision A against an affirming verb used as a condition or an imperative, a bare fragment after
  //   an affirmed clause, and `full` standing in for a place outside the prompt; fails_when=a part that opens with an
  //   affirming word, a fragment clause or `in the full <file>` is credited again; why_new=cycle 3 of the continuation
  //   review reproduced each as credited at ce8b0a73; seam=contextLine() and recover(); no_claim=an exhaustive list
  test('rejects conditional and imperative openings, trailing fragments and full as a place (continuation cycle 3)', () => {
    for (const line of NAMING_CONTINUATION_C3) expect([line, contextLine(line)]).toEqual([line, 'missing']);
    for (const line of NONE_CONTINUATION_C3) expect([line, contextLine(line)]).toEqual([line, 'none']);
    for (const classifier of [classify, lastLineVerdict]) {
      for (const gate of gates) {
        for (const line of NAMING_CONTINUATION_C3) {
          const res = recover(cleanReply(line), gate, 0, '', classifier);
          expect([gate, line, res.credited, res.parse, res.needs_context]).toEqual([gate, line, false, 'failed', true]);
        }
        for (const line of NONE_CONTINUATION_C3) {
          const res = recover(cleanReply(line), gate, 0, '', classifier);
          expect([gate, line, res.credited, res.parse, res.classification.verdict]).toEqual([gate, line, true, 'valid', 'clean']);
        }
      }
    }
  });

  // Second continuation review, cycle 1: each clause (a part split at commas and at `and`) keeps the opening rule and,
  // after an affirmed clause, holds its own affirming word; `provided` and `given` never read as a condition; an attribute
  // needs its noun within its clause; and `full` is a place only after `in`.
  const NAMING_CONTINUATION_2 = [
    'NEEDS_CONTEXT: none. The diff is supplied, complete the schema.',
    'NEEDS_CONTEXT: none. The diff is supplied, present the callers of save().',
    'NEEDS_CONTEXT: none. The diff is supplied, are the callers supplied.',
    'NEEDS_CONTEXT: none (the callers are sufficient, provided the tests are supplied).',
    'NEEDS_CONTEXT: none (the callers are sufficient provided the tests are supplied).',
    'NEEDS_CONTEXT: none (the callers are complete given the schema is supplied).',
    'NEEDS_CONTEXT: none. The diff is supplied and the requested context is config.ts.',
    'NEEDS_CONTEXT: none. The diff is complete and the requested context is config.ts and the callers of parse().',
    'NEEDS_CONTEXT: none (schema requested, callers supplied)',
    'NEEDS_CONTEXT: none (callers requested, tests requested, diff supplied)',
    'NEEDS_CONTEXT: none (types.ts referenced, callers supplied)',
    "NEEDS_CONTEXT: none (the schema requested's, callers supplied)",
    'NEEDS_CONTEXT: none (the callers are supplied within full).',
    'NEEDS_CONTEXT: none (the callers are supplied by full).',
  ] as const;
  const NONE_CONTINUATION_2 = [
    'NEEDS_CONTEXT: none (the context extension provided all three requested interfaces).',
    'NEEDS_CONTEXT: none (the callers are present and the schema was provided).',
    'NEEDS_CONTEXT: none (the entire requested interface was supplied in full).',
  ] as const;

  // Value: protects=owner decision A against a request, question or condition in a later clause, an affirmation borrowed
  //   across `and`, an attribute read as a predicate before a comma and `within full` or `by full` as a place;
  //   fails_when=any of them is credited again; why_new=the second continuation review reproduced each as credited at
  //   d0e2a9a9; seam=contextLine() and recover(); no_claim=an exhaustive list
  test('reads every clause on its own and rejects conditions, predicate attributes and other full places (continuation 2)', () => {
    for (const line of NAMING_CONTINUATION_2) expect([line, contextLine(line)]).toEqual([line, 'missing']);
    for (const line of NONE_CONTINUATION_2) expect([line, contextLine(line)]).toEqual([line, 'none']);
    for (const classifier of [classify, lastLineVerdict]) {
      for (const gate of gates) {
        for (const line of NAMING_CONTINUATION_2) {
          const res = recover(cleanReply(line), gate, 0, '', classifier);
          expect([gate, line, res.credited, res.parse, res.needs_context]).toEqual([gate, line, false, 'failed', true]);
        }
        for (const line of NONE_CONTINUATION_2) {
          const res = recover(cleanReply(line), gate, 0, '', classifier);
          expect([gate, line, res.credited, res.parse, res.classification.verdict]).toEqual([gate, line, true, 'valid', 'clean']);
        }
      }
    }
  });

  // Value: protects=a degenerate possessive token in an untrusted reply costs linear time, so one reply cannot block the
  //   event loop that runs other reviewers' timeouts; fails_when=possessive suffixes are stripped recursively (about 40 s
  //   at a million suffixes, so this test exceeds its 10 s timeout); why_new=cycle 2 of the continuation review measured
  //   decide() blocked 18 s on an 800 KB reply; seam=contextLine(); no_claim=a wall-clock bound
  test('reads a long possessive token in linear time', () => {
    expect(contextLine(`NEEDS_CONTEXT: none. x${"'s".repeat(1_000_000)} was supplied.`)).toBe('missing');
    expect(contextLine("NEEDS_CONTEXT: none. The module's callers were supplied.")).toBe('none');
  }, 10_000);

  // Owner decision "1 a" (2026-11-19): the observed cycle-2 reply shape, the value form followed by a sentence that
  // references a severity-tagged finding and says it relies only on a supplied excerpt, stays uncredited under rule A.
  // Reconstructs the shape, not the text. The value form alone stays credited.
  const OBSERVED_CYCLE_2_SENTENCE = 'NEEDS_CONTEXT: none of the above depends on missing context. The P2 retry interaction relies only on the supplied `retry.ts` excerpt.';
  const OBSERVED_CYCLE_2_VALUE = 'NEEDS_CONTEXT: none of the above depends on missing context.';

  // Value: protects=the owner's choice that criterion 1 covers the observed value form and the allowed explanations, not
  //   the observed sentence (a severity-tagged finding reference that relies only on a supplied excerpt); fails_when=that
  //   sentence is credited, so a finding mentioned only in a context line passes the coverage gate, or the bare value form
  //   stops being credited; why_new=the continuation review's Red Team showed the shape uncredited and the owner kept it
  //   so; seam=contextLine() and recover(); no_claim=the consumer's original wording
  test('keeps the observed cycle-2 sentence uncredited while its value form stays credited (owner decision 1 a)', () => {
    expect(contextLine(OBSERVED_CYCLE_2_SENTENCE)).toBe('missing');
    expect(contextLine(OBSERVED_CYCLE_2_VALUE)).toBe('none');
    for (const classifier of [classify, lastLineVerdict]) {
      for (const gate of gates) {
        const sentence = recover(cleanReply(OBSERVED_CYCLE_2_SENTENCE), gate, 0, '', classifier);
        expect([gate, sentence.credited, sentence.parse, sentence.needs_context]).toEqual([gate, false, 'failed', true]);
        const value = recover(cleanReply(OBSERVED_CYCLE_2_VALUE), gate, 0, '', classifier);
        expect([gate, value.credited, value.parse, value.classification.verdict, value.needs_context]).toEqual([
          gate, true, 'valid', 'clean', false,
        ]);
      }
    }
  });

  // Value: protects=a context line that names missing context in a contraction, typographic apostrophe, request, caveat or code span
  //   stays uncredited (criteria 1 and 4) while nested calls and benign negations still read as nothing missing; fails_when=the deny
  //   scan misses these forms or reads code-span text as erased; why_new=cycle 1 of Track 90A's review reproduced each form as credited;
  //   seam=contextLine() and recover() with the strict and last-line classifiers; no_claim=an exhaustive deny list
  test('fails closed on contractions, typographic apostrophes, requests, caveats and code-span deny words', () => {
    for (const line of NAMING_REVIEW_FIXES) expect([line, contextLine(line)]).toEqual([line, 'missing']);
    for (const line of NONE_REVIEW_FIXES) expect([line, contextLine(line)]).toEqual([line, 'none']);
    for (const classifier of [classify, lastLineVerdict]) {
      for (const gate of gates) {
        for (const line of NAMING_REVIEW_FIXES) {
          const res = recover(cleanReply(line), gate, 0, '', classifier);
          expect([gate, line, res.credited, res.parse, res.needs_context]).toEqual([gate, line, false, 'failed', true]);
        }
        for (const line of NONE_REVIEW_FIXES) {
          const res = recover(cleanReply(line), gate, 0, '', classifier);
          expect([gate, line, res.credited, res.parse, res.classification.verdict, res.needs_context]).toEqual([
            gate, line, true, 'valid', 'clean', false,
          ]);
        }
      }
    }
  });

  // Value: protects=the glued `path:line` check stays linear on a long dotted token in an untrusted reply; fails_when=the
  //   path pattern backtracks quadratically (it hung on a 1 MiB `a.a.` run during review), so this test exceeds its
  //   timeout; why_new=cycle 2 of Track 90A's review measured the hang; seam=contextLine(); no_claim=a wall-clock bound
  test('keeps the glued path:line check linear on long dotted tokens', () => {
    expect(contextLine(`NEEDS_CONTEXT: none. ${'a.'.repeat(200_000)}ts was supplied.`)).toBe('none');
    expect(contextLine(`NEEDS_CONTEXT: none. ${'a.'.repeat(200_000)}ts:14`)).toBe('missing');
  });

  test('credits nothing-missing replies through run() and keeps a naming line uncredited', async () => {
    await temporary(async dir => {
      const results = await run(request, '+diff', dir, 'model', async (_prefix, task) => ({
        status: 'completed',
        result: task === TASKS.challenge ? findingsReply(OBSERVED_NONE_FORMS[0]) : cleanReply(OBSERVED_NONE_FORMS[1]),
      }), lastLineVerdict);
      expect(results.map(r => [r.phase, r.credited, r.parse, r.classification.verdict, r.needs_context])).toEqual([
        ['challenge', true, 'valid', 'findings', false],
        ['structured', true, 'valid', 'clean', false],
      ]);
      expect(results.map(r => measurement(r).credited)).toEqual([true, true]);
    });
    await temporary(async dir => {
      const results = await run(request, '+diff', dir, 'model', async () => ({
        status: 'completed',
        result: cleanReply('NEEDS_CONTEXT: callers of alpha()'),
      }), lastLineVerdict);
      expect(results.map(r => [r.phase, r.credited, r.parse, r.classification.verdict, r.needs_context])).toEqual([
        ['challenge', false, 'failed', 'unverified', true],
        ['structured', false, 'failed', 'unverified', true],
      ]);
      expect(results.map(r => measurement(r).credited)).toEqual([false, false]);
    });
  });

  test.skipIf(!process.env.GSTACK_OUTSIDE_TEST_ROOT)('the installed classifier gives the same outcomes for nothing-missing and fail-closed context lines (installed only)', async () => {
    const { classifyOutsideReview } = await import(join(process.env.GSTACK_OUTSIDE_TEST_ROOT!, 'lib/outside-review-result.ts'));
    for (const gate of gates) {
      for (const line of OBSERVED_NONE_FORMS) {
        const found = recover(findingsReply(line), gate, 0, '', classifyOutsideReview);
        expect([gate, line, found.credited, found.parse, found.classification.verdict, found.needs_context]).toEqual([
          gate, line, true, 'valid', 'findings', false,
        ]);
        const clean = recover(cleanReply(line), gate, 0, '', classifyOutsideReview);
        expect([gate, line, clean.credited, clean.parse, clean.classification.verdict, clean.needs_context]).toEqual([
          gate, line, true, 'valid', 'clean', false,
        ]);
      }
      for (const line of [...FAIL_CLOSED_MISSING, ...NAMING_REVIEW_FIXES, ...NAMING_CYCLE_2, ...NAMING_CYCLE_3, ...NAMING_CONTINUATION, ...NAMING_CONTINUATION_C2, ...NAMING_CONTINUATION_C3, ...NAMING_CONTINUATION_2, OBSERVED_CYCLE_2_SENTENCE, `${OBSERVED_NONE_FORMS[0]}\nNEEDS_CONTEXT: callers of alpha()`]) {
        const res = recover(cleanReply(line), gate, 0, '', classifyOutsideReview);
        expect([gate, line, res.credited, res.parse, res.classification.verdict, res.needs_context]).toEqual([
          gate, line, false, 'failed', 'unverified', true,
        ]);
      }
      const numbered = recover(cleanReply('1. NEEDS_CONTEXT: none'), gate, 0, '', classifyOutsideReview);
      expect([gate, numbered.credited, numbered.classification.verdict]).toEqual([gate, true, 'clean']);
      for (const line of [...NONE_REVIEW_FIXES, ...NONE_CYCLE_2, ...NONE_CYCLE_3, ...NONE_CONTINUATION, ...NONE_CONTINUATION_C2, ...NONE_CONTINUATION_C3, ...NONE_CONTINUATION_2]) {
        const res = recover(cleanReply(line), gate, 0, '', classifyOutsideReview);
        expect([gate, line, res.credited, res.parse, res.classification.verdict, res.needs_context]).toEqual([
          gate, line, true, 'valid', 'clean', false,
        ]);
      }
    }
  });
});

describe('numbered met-criterion recovery (Track 90A, upstream 4ed1711d)', () => {
  const gates = ['review', 'structured'] as const;
  // Reconstructs the 2026-11-19 structured reply shape, not its text.
  const STRUCTURED_MET_SHAPE = [
    '**Structured review — parser and contract changes**',
    '',
    '**Criteria assessment**',
    '1. **Parser accepts the nothing-missing context line.** Met.',
    '   - Checked the delimiter and parenthetical branches.',
    '2. **Missing-context lines still fail closed.** Met.',
    '3. **Delegated reply parser uses the same predicate.** Met, by inspection.',
    '4. **Existing gates remain unchanged for missing context.** Met. The change does not touch the negative fixtures.',
    '5. **Structured met-criterion reply is credited.** Met.',
    '6. **Release files are untouched on the branch.** Met.',
    '7. **Baseline record preserves missing outside coverage.** Met.',
    '8. **Handoff grammar and labels stay byte-identical.** Met.',
    '',
    '**Additional checks**',
    '- Verified callers in `src/alpha.ts` and `tests/alpha.test.ts`.',
    '- Checked fence handling and replay behavior.',
    '',
    'NO_FINDINGS: none',
    'Recommendation: approve because all eight criteria are satisfied and no defect was found.',
    'VERDICT: CLEAN',
  ].join('\n');

  const NEGATIVE_SHAPES = [
    [
      'untagged numbered findings',
      [
        '1. `src/alpha.ts`: missing null check before trimming the input.',
        '2. `src/beta.ts`: retry counter resets on error.',
        'Recommendation: approve because minor.',
        'VERDICT: CLEAN',
      ].join('\n'),
    ],
    [
      'Met lines plus one numbered finding',
      [
        '1. **First criterion holds.** Met.',
        '2. `src/alpha.ts` drops the fallback when the map is empty.',
        'NO_FINDINGS: none',
        'Recommendation: approve because minor.',
        'VERDICT: CLEAN',
      ].join('\n'),
    ],
    [
      'Not met line',
      [
        '1. **First criterion holds.** Met.',
        '2. **Second criterion holds.** Not met.',
        'NO_FINDINGS: none',
        'Recommendation: approve because partial.',
        'VERDICT: CLEAN',
      ].join('\n'),
    ],
    [
      'Partially met line',
      [
        '1. **First criterion holds.** Partially met.',
        'NO_FINDINGS: none',
        'Recommendation: approve because partial.',
        'VERDICT: CLEAN',
      ].join('\n'),
    ],
    [
      'Met? line',
      [
        '1. **First criterion holds.** Met?',
        'NO_FINDINGS: none',
        'Recommendation: approve because uncertain.',
        'VERDICT: CLEAN',
      ].join('\n'),
    ],
    [
      'Met line carrying a severity word',
      [
        '1. **High-priority paths are covered.** Met.',
        'NO_FINDINGS: none',
        'Recommendation: approve because covered.',
        'VERDICT: CLEAN',
      ].join('\n'),
    ],
    // Review fixes: emphasis around a severity token or negation, and a caveat or defect sentence after `Met.`.
    ...([
      ['emphasized severity token', '1. Criterion with __P1__: Met.'],
      ['emphasized severity word', '1. __High-priority paths are covered.__ Met.'],
      ['emphasized negation after Met', '1. **Criterion.** Met. __Not__ met when the list is empty.'],
      ['emphasized unmet after Met', '1. **Criterion holds.** Met. __Unmet__ for empty input.'],
      ['caveat after Met', '4. **Retry handling.** Met. However, src/alpha.ts drops the write when the timeout fires.'],
      ['defect sentence after Met', '2. **Retry handling.** Met. The retry counter resets on error and drops the last attempt.'],
      // Owner decision A (review cycle 2): only the bold title, a delimiter and the status may precede `Met`, and the
      // one sentence allowed after `Met.` states that the change does not touch, change, edit, modify or affect something.
      ['caveat in the statement before Met', '1. **Handles empty and non-empty input.** Fails on empty input; non-empty input: Met.'],
      ['caveat between the bold title and Met', '1. **Retry handling** (however, src/alpha.ts drops writes on timeout): Met.'],
      ['unverified path after Met', '4. **Retry handling.** Met. Could not verify the timeout path.'],
      ['untested note after Met', '4. **Retry handling.** Met. Not covered by tests.'],
      ['hedge after Met', '4. **Retry handling.** Met. Only on the happy path.'],
      ['defect sentence without a keyword after Met', '1. **Input validation.** Met. src/auth.ts accepts expired tokens.'],
      ['any other sentence after Met', '4. **Existing gates remain unchanged.** Met. Every negative fixture still returns unverified.'],
      // Owner decision A (review cycle 3): the change statement names only what the change leaves alone, so a contrast,
      // a defect clause, a path followed by a verb or a colon after its list of names leaves the line unrewritten.
      ['contrast clause after the change statement', '1. **Input validation.** Met. The change does not touch auth, but src/auth.ts accepts expired tokens.'],
      ['defect clause after the change statement', '1. Parser handles empty input: Met. The change does not touch the lexer, but the new caller crashes on empty input.'],
      ['defect verb after the change statement', '1. **Retry handling.** Met. The change does not touch the retry path, but the timeout branch still drops writes.'],
      ['path and verb after the change statement', '1. **Input validation.** Met. The change does not touch auth, and src/auth.ts accepts expired tokens.'],
      ['colon after the change statement', '1. **Input validation.** Met. The diff does not touch auth: the token check accepts expired tokens.'],
    ] as const).map(([label, line]) => [
      label,
      [line, 'NO_FINDINGS: none', 'Recommendation: approve because covered.', 'VERDICT: CLEAN'].join('\n'),
    ] as const),
  ] as const;

  // Review fixes: a statement with an internal delimiter before its final `Met`, and a benign negation after `Met.`
  // (the retained 2026-11-19 reply has that shape), are still met-criterion lines.
  const COMPOSITE_MET_SHAPES = [
    ['internal colon, final em dash', '1. Full-review evidence: baseline usable — Met.'],
    ['bold statement with an internal colon, final em dash', '1. **Full-review evidence: baseline usable** — Met.'],
    ['bold statement with an internal colon, final colon', '1. **Track 90A: parser**: Met.'],
    ['benign negation after Met', '6. **Release files are untouched on the branch.** Met. The branch does not edit any release file.'],
    ['trailing whitespace after Met', '1. **Criterion holds.** Met.  '],
    ['change statement listing code spans', '6. **Release files are untouched on the branch.** Met. The diff does not touch `CHANGELOG.md`, `VERSION` or any package file.'],
  ].map(([label, line]) => [
    label,
    [line, 'NO_FINDINGS: none', 'Recommendation: approve because every criterion holds.', 'VERDICT: CLEAN'].join('\n'),
  ] as const);

  test('credits the reconstructed 2026-11-19 met-criterion shape, fails closed on untagged findings or non-Met lines, and keeps existing valid shapes valid', async () => {
    for (const gate of gates) {
      const res = recover(STRUCTURED_MET_SHAPE, gate, 0, '', numberedCleanVerdict);
      expect([gate, res.credited, res.parse, res.classification.verdict, res.classification.findings.highest]).toEqual([
        gate, true, 'recovered', 'clean', null,
      ]);
      for (const [label, text] of NEGATIVE_SHAPES) {
        const neg = recover(text, gate, 0, '', numberedCleanVerdict);
        expect([gate, label, neg.credited, neg.parse, neg.classification.verdict, neg.classification.reason]).toEqual([
          gate, label, false, 'failed', 'unverified', 'untagged_review',
        ]);
      }
    }
    await temporary(async dir => {
      const results = await run(request, '+diff', dir, 'model', async () => ({
        status: 'completed',
        result: STRUCTURED_MET_SHAPE,
      }), numberedCleanVerdict);
      expect(results.map(r => [r.phase, r.credited, r.parse, r.classification.verdict])).toEqual([
        ['challenge', true, 'recovered', 'clean'],
        ['structured', true, 'recovered', 'clean'],
      ]);
    });
    // Existing valid shapes keep parse: 'valid'.
    const fixed = '[P2] `src/x.ts`: guard optional field\nRecommendation: merge because advisory.\nVERDICT: FINDINGS';
    const clean = 'Checked every hunk.\nNO_FINDINGS: none\nRecommendation: approve because clean.\nVERDICT: CLEAN';
    for (const gate of gates) {
      expect(recover(fixed, gate, 0, '', numberedCleanVerdict).parse).toBe('valid');
      expect(recover(clean, gate, 0, '', numberedCleanVerdict).parse).toBe('valid');
    }
  });

  // Value: protects=met-criterion lines whose statement holds an internal delimiter, or whose sentence after `Met.` is a benign
  //   negation, are credited as plan T3 describes; fails_when=the delimiter search stops at the first internal delimiter or the
  //   caveat scan rejects negation; why_new=cycle 1 of Track 90A's review reproduced the composite shapes as uncredited;
  //   seam=recover() with the numbered-item fixture classifier; no_claim=a model's wording
  test('credits met-criterion lines with an internal delimiter or a benign negation after Met', () => {
    for (const gate of gates) {
      for (const [label, text] of COMPOSITE_MET_SHAPES) {
        const res = recover(text, gate, 0, '', numberedCleanVerdict);
        expect([gate, label, res.credited, res.parse, res.classification.verdict]).toEqual([gate, label, true, 'recovered', 'clean']);
      }
    }
  });

  // Owner decision A (continuation review): a negation up to two words before `Met`, a condition, hedge or exception in an
  // unwrapped statement, and a clause among the change statement's names leave the line unrewritten.
  const CONTINUATION_MET_NEGATIVES = [
    ['negation two words before Met', '1. **Expired tokens are rejected — not yet** Met.'],
    ['negation and adverb before Met', '1. **Expired tokens are rejected — not fully** Met.'],
    ['never before Met', '1. **Expired tokens are rejected — never** Met.'],
    ['partly before Met', '1. **Expired tokens are rejected — only partly** Met.'],
    ['condition in the statement', '1. Expired tokens are rejected if the cache is warm: Met'],
    ['time condition in the statement', '1. Expired tokens are rejected when the cache is warm: Met'],
    ['hedge in the statement', '1. Expired tokens are probably rejected: Met'],
    ['exception in the statement', '1. Expired tokens are rejected apart from admin sessions: Met'],
    ['clause among the change statement names', '1. **Authentication.** Met. The change does not touch auth, and the token validator accepts expired tokens.'],
    ['copula after a path among the names', '1. **Input validation.** Met. The diff does not touch auth, and src/auth.ts is accepting expired tokens.'],
    // Continuation review, cycle 2: absence and deferral words in an unwrapped statement, and an abbreviation among the names.
    ['without in the statement', '1. Every caller is covered without a test for the CRLF path: Met'],
    ['lacks in the statement', '1. Every caller is covered, the CRLF path lacks a test: Met'],
    ['skipped in the statement', '1. Every caller is covered; CRLF path skipped: Met'],
    ['pending in the statement', '1. Every caller is covered, the CRLF test is pending: Met'],
    ['abbreviation among the change statement names', '1. Parser handles CRLF: Met. The diff does not touch the tests w/o a fixture.'],
  ].map(([label, line]) => [
    label,
    [line, 'NO_FINDINGS: none', 'Recommendation: approve because covered.', 'VERDICT: CLEAN'].join('\n'),
  ] as const);

  // Value: protects=owner decision A for met-criterion lines: a negated status with words before `Met`, a caveat in an
  //   unwrapped statement and a clause hidden among the change statement's names stay unlabeled items, so upstream's
  //   numbered-item rule still rejects the reply; fails_when=the guard, the caveat list or the names check credits them
  //   again; why_new=the continuation review of Track 90A reproduced each as credited clean at f15befa7;
  //   seam=recover() with the numbered-item fixture classifier; no_claim=a model's wording
  test('fails closed on negated statuses, statement caveats and clauses among the change statement names (continuation)', () => {
    for (const gate of gates) {
      for (const [label, text] of CONTINUATION_MET_NEGATIVES) {
        const res = recover(text, gate, 0, '', numberedCleanVerdict);
        expect([gate, label, res.credited, res.parse, res.classification.verdict, res.classification.reason]).toEqual([
          gate, label, false, 'failed', 'unverified', 'untagged_review',
        ]);
      }
    }
  });

  // Second continuation review, cycle 1: the first delimiter followed by `Met` starts the status, a negation counts
  // whatever punctuation or spacing separates it from `Met` (and `cannot` or an `n't` word is one), and only a bold
  // `Met.` takes a sentence after it.
  const CONTINUATION_2_MET_NEGATIVES = [
    ['a first status other than Met', '1. Callers updated: Met? Tests added: Met.'],
    ['a parenthesized negation before Met', '1. **Expired tokens are rejected — not (yet)** Met.'],
    ['a nonbreaking space in the negation', '1. **Expired tokens are rejected — not yet** Met.'],
    ['a contracted negation before Met', "1. **Expired tokens are rejected — isn't** Met."],
    ['cannot before Met', '1. **Expired tokens cannot be** Met.'],
    ['a sentence after a bold Met, by inspection.', '1. The parser keeps CR lines — **Met, by inspection.** The change does not touch the tests.'],
    ['a sentence after a bold Met, by inspection', '1. The parser keeps CR lines — **Met, by inspection** The change does not touch the tests.'],
  ].map(([label, line]) => [
    label,
    [line, 'NO_FINDINGS: none', 'Recommendation: approve because covered.', 'VERDICT: CLEAN'].join('\n'),
  ] as const);
  const CONTINUATION_2_MET_POSITIVES = [
    ['a bold Met, by inspection.', '1. The parser keeps CR lines — **Met, by inspection.**'],
    ['Met, by inspection without its period', '1. The parser keeps CR lines — Met, by inspection'],
  ].map(([label, line]) => [
    label,
    [line, 'NO_FINDINGS: none', 'Recommendation: approve because covered.', 'VERDICT: CLEAN'].join('\n'),
  ] as const);

  // Value: protects=owner decision A for met-criterion lines: a second status cannot hide a first status that is not Met,
  //   punctuation, a nonbreaking space or a contraction cannot hide a negation, and a bold `Met, by inspection.` takes no
  //   sentence; fails_when=any of them is credited clean again, or the inspection forms stop being credited;
  //   why_new=the second continuation review reproduced each as credited at d0e2a9a9; seam=recover() with the
  //   numbered-item fixture classifier; no_claim=a model's wording
  test('fails closed on a hidden first status, a punctuated or contracted negation and a sentence after a bold inspection status (continuation 2)', () => {
    for (const gate of gates) {
      for (const [label, text] of CONTINUATION_2_MET_NEGATIVES) {
        const res = recover(text, gate, 0, '', numberedCleanVerdict);
        expect([gate, label, res.credited, res.parse, res.classification.verdict, res.classification.reason]).toEqual([
          gate, label, false, 'failed', 'unverified', 'untagged_review',
        ]);
      }
      for (const [label, text] of CONTINUATION_2_MET_POSITIVES) {
        const res = recover(text, gate, 0, '', numberedCleanVerdict);
        expect([gate, label, res.credited, res.parse, res.classification.verdict]).toEqual([gate, label, true, 'recovered', 'clean']);
      }
    }
  });

  // Value: protects=the met-criterion rewrite stays linear on a long whitespace run in an untrusted reply, so a degenerate reply
  //   cannot stall the runner; fails_when=the delimiter search backtracks quadratically (about 1.7 s at 32k spaces, over a minute at
  //   200k, so this test then exceeds its timeout); why_new=cycle 1 of Track 90A's review measured the quadratic search;
  //   seam=recover() with the numbered-item fixture classifier; no_claim=a wall-clock bound
  test('keeps the met-criterion rewrite linear on long whitespace runs', () => {
    const run200k = ' '.repeat(200_000);
    const tail = 'NO_FINDINGS: none\nRecommendation: approve because covered.\nVERDICT: CLEAN';
    for (const gate of gates) {
      const unmatched = recover(`1. x${run200k}y\n${tail}`, gate, 0, '', numberedCleanVerdict);
      expect([gate, unmatched.credited, unmatched.classification.reason]).toEqual([gate, false, 'untagged_review']);
      const delimited = recover(`1. Statement holds:${run200k}Met.\n${tail}`, gate, 0, '', numberedCleanVerdict);
      expect([gate, delimited.credited, delimited.parse, delimited.classification.verdict]).toEqual([gate, true, 'recovered', 'clean']);
    }
  });

  test.skipIf(!process.env.GSTACK_OUTSIDE_TEST_ROOT)('the installed classifier credits the met-criterion shape and rejects the negative shapes (installed only)', async () => {
    const { classifyOutsideReview } = await import(join(process.env.GSTACK_OUTSIDE_TEST_ROOT!, 'lib/outside-review-result.ts'));
    for (const gate of gates) {
      const res = recover(STRUCTURED_MET_SHAPE, gate, 0, '', classifyOutsideReview);
      expect([gate, res.credited, res.parse, res.classification.verdict, res.classification.findings.highest]).toEqual([
        gate, true, 'recovered', 'clean', null,
      ]);
      for (const [label, text] of COMPOSITE_MET_SHAPES) {
        const composite = recover(text, gate, 0, '', classifyOutsideReview);
        expect([gate, label, composite.credited, composite.parse, composite.classification.verdict]).toEqual([
          gate, label, true, 'recovered', 'clean',
        ]);
      }
      for (const [label, text] of CONTINUATION_2_MET_POSITIVES) {
        const positive = recover(text, gate, 0, '', classifyOutsideReview);
        expect([gate, label, positive.credited, positive.parse, positive.classification.verdict]).toEqual([
          gate, label, true, 'recovered', 'clean',
        ]);
      }
      for (const [label, text] of [...NEGATIVE_SHAPES, ...CONTINUATION_MET_NEGATIVES, ...CONTINUATION_2_MET_NEGATIVES]) {
        const neg = recover(text, gate, 0, '', classifyOutsideReview);
        expect([gate, label, neg.credited, neg.parse, neg.classification.verdict, neg.classification.reason]).toEqual([
          gate, label, false, 'failed', 'unverified', 'untagged_review',
        ]);
      }
    }
  });
});

describe('qualified severity labels', () => {
  const REC = 'Recommendation: fix because reason.';
  const gates = ['review', 'structured'] as const;
  type Gate = (typeof gates)[number];
  const installedClassifier = async (): Promise<Classifier> =>
    (await import(join(process.env.GSTACK_OUTSIDE_TEST_ROOT!, 'lib/outside-review-result.ts'))).classifyOutsideReview;
  // The strict fixture and the installed classifier read the same table; the installed run skips without the root.
  const both = (title: string, body: (classifier: Classifier, installed: boolean) => void) => {
    test(`${title} (strict fixture)`, () => body(classify, false));
    test.skipIf(!process.env.GSTACK_OUTSIDE_TEST_ROOT)(`${title} (installed classifier)`, async () => body(await installedClassifier(), true));
  };
  // `recover` does not return its normalized text, so record what the classifier is given: call 0 is the
  // original, call 1 the normalized copy. The review gate gets a one-line recommendation so no line is joined.
  const read = (classifier: Classifier, text: string, gate: Gate) => {
    const input = gate === 'review' ? `${text}\n${REC}` : text;
    const seen: string[] = [];
    const result = recover(input, gate, 0, '', args => { seen.push(args.text); return classifier(args); });
    return { input, normalized: seen[1]!, result };
  };
  const outcome = ({ result }: ReturnType<typeof read>) =>
    [result.credited, result.parse, result.classification.verdict, result.classification.findings.highest];
  const UNREAD = [false, 'failed', 'unverified', null];
  const rows = (classifier: Classifier, table: readonly (readonly [string, readonly unknown[]])[], unchanged = false) => {
    for (const gate of gates) for (const [text, expected] of table) {
      const checked = read(classifier, text, gate);
      expect([gate, text, outcome(checked)]).toEqual([gate, text, expected]);
      if (unchanged) expect([gate, text, checked.normalized]).toEqual([gate, text, checked.input]);
    }
  };

  // Criterion 1
  const credited = (highest: string) => [true, 'recovered', 'clean', highest];
  const labelled: [string, unknown[]][] = [
    ...['', '# ', '## ', '- ', '+ ', '* ', '1. ', '1) '].map(prefix => [`${prefix}[P3, advisory] note`, credited('P3')] as [string, unknown[]]),
    ['[p3, advisory] note', credited('P3')], ['**[P3, advisory]** note', credited('P3')], ['__[P3, advisory]__ note', credited('P3')],
    ['**[p3, advisory]:** note', credited('P3')], ['- **[P2, advisory]** note', credited('P2')],
    ['[P3; advisory] note', credited('P3')], ['[P3: advisory] note', credited('P3')], ['[P3 - advisory] note', credited('P3')],
    ['[P3 — advisory] note', credited('P3')], ['[P3 – advisory] note', credited('P3')], ['[P3/advisory] note', credited('P3')],
    ['[P3 advisory] note', credited('P3')],
  ];
  both('a qualified label is credited at the severity it names', classifier => rows(classifier, labelled));

  // Criterion 2
  both('the qualifier cannot lower or raise the severity, and its text stays in the response', classifier => {
    for (const [text, highest, qualifier] of [['[P1, blocking] crash', 'P1', '(blocking)'], ['[P0, security] crash', 'P0', '(security)']] as const) {
      for (const gate of gates) {
        const checked = read(classifier, text, gate);
        expect([gate, text, outcome(checked)]).toEqual([gate, text, [true, 'recovered', 'findings', highest]]);
        expect(checked.normalized).toContain(qualifier);
        expect(checked.normalized.split('\n').length).toBe(checked.input.split('\n').length);
      }
    }
  });
  test('a saved response is byte-identical to what the provider sent, and replays without another call', async () => temporary(async dir => {
    const text = `[P3, advisory] x\n[P1, blocking] y\n${REC}`;
    let calls = 0;
    const send = async () => { calls++; return { status: 'completed', result: text }; };
    const first = await run(request, '+diff', dir, 'model', send, classify);
    expect(calls).toBe(2);
    expect(first.map(r => [r.credited, r.parse, r.response.result])).toEqual([[true, 'recovered', text], [true, 'recovered', text]]);
    const replay = await run(request, '+diff', dir, 'model', send, classify);
    expect(calls).toBe(2);
    expect(replay.map(r => [r.replay, r.credited, r.response.result])).toEqual([[true, true, text], [true, true, text]]);
  }));
  test.skipIf(!process.env.GSTACK_OUTSIDE_TEST_ROOT)('the installed classifier reads the highest of several qualified labels (installed only)', async () => {
    const classifier = await installedClassifier();
    for (const gate of gates) {
      expect([gate, outcome(read(classifier, '[P2, advisory] x\n[P1, blocking] y', gate))]).toEqual([gate, [true, 'recovered', 'findings', 'P1']]);
    }
  });
  both('a qualifier that names a severity word is not rewritten, while a hyphen compound is', classifier => {
    rows(classifier, ['[P3, high] note', '[P1, low] crash', '[P3, HIGH] note', '[P2, high confidence] note',
      '[P3-high] note', '[P3-critical] note', '[P3 -HIGH] note', '[P1-low] crash', '[P2-medium] note',
      '[P3-high]', '[P3-critical]', '[P3, risk -high] note', '[P3, high-] note',
      '[P3 -critical-] note', '[P1, risk --low] crash'].map(text => [text, UNREAD] as const), true);
    rows(classifier, ['[P3, low-risk] note', '[P3, non-critical] note', '[P3, severity]: high', '[P3, x -] high'].map(text => [text, credited('P3')] as const));
  });

  // Criterion 3
  both('a label naming more than one severity is not rewritten and stays uncredited', classifier => {
    rows(classifier, ['[P1, P2] note', '[P1/P2] note', '## P1/P2 findings', '- P2/P3 nits', '[P1 - P2] note', '[P1 P2] note',
      '[P1, advisory, P2] note', '**[P1, P2]** note'].map(text => [text, UNREAD] as const), true);
    for (const gate of gates) {
      // Only the existing first-token case change applies.
      const checked = read(classifier, '[p1, p2] note', gate);
      expect([gate, outcome(checked), checked.normalized]).toEqual([gate, UNREAD, checked.input.replace('[p1, p2]', '[P1, p2]')]);
    }
  });
  test.skipIf(!process.env.GSTACK_OUTSIDE_TEST_ROOT)('the installed classifier reports an unparsed severity for a multi-severity label (installed only)', async () => {
    const classifier = await installedClassifier();
    for (const text of ['[P1, P2] note', '[P1/P2] note', '[P1 P2] note', '## P1/P2 findings', '- P2/P3 nits']) {
      for (const gate of gates) {
        expect([gate, text, read(classifier, text, gate).result.classification.reason]).toEqual([gate, text, 'unparsed_severity']);
      }
    }
    for (const gate of gates) {
      // The readable advisory label keeps its severity, but the unreadable label beside it leaves the response uncredited.
      expect([gate, outcome(read(classifier, '[P3, advisory] x\n## P1/P2 findings', gate)).slice(0, 3)]).toEqual([gate, [false, 'failed', 'unverified']]);
      // A readable blocker keeps upstream's own result; the unreadable label stays unread beside it.
      for (const blocker of ['[P1] crash', '[P1, blocking] crash']) {
        const checked = read(classifier, `${blocker}\n## P1/P2 findings`, gate);
        expect([gate, blocker, checked.result.credited, checked.result.classification.verdict, checked.result.classification.findings.highest])
          .toEqual([gate, blocker, true, 'findings', 'P1']);
        expect(checked.result.classification.unparsed).toBeTruthy();
      }
    }
  });

  // Criterion 4: the example comes first, so a rewrite would make the first-match strict fixture read P1.
  const quoted = ['```text\n[P1, blocking] quoted\n```', '~~~\n[P1, blocking] quoted\n~~~', '`[P1, blocking]` quoted', '- `[P1, blocking]` quoted',
    '**`[P1, blocking]`** quoted', 'See [P1, blocking] in the docs.'].map(example => `${example}\n[P3] real`);
  both('a bracketed example in a fence, code span or prose does not change the highest severity', classifier => {
    rows(classifier, [...quoted, '[P3] Prefer [P1, blocking] here'].map(text => [text, [true, 'valid', 'clean', 'P3']] as const), true);
    for (const gate of gates) {
      // The existing case normalizer still upper-cases a code-span label; upstream blanks that span.
      expect([gate, outcome(read(classifier, '`[p1, blocking]` quoted\n[P3] real', gate))]).toEqual([gate, credited('P3')]);
    }
  });
  both('a blockquote or table cell is not a label position', (classifier, installed) => {
    for (const gate of gates) {
      for (const text of ['> [P1, blocking] quoted\n[P3] real', '| [P1, blocking] | cell |\n[P3] real']) {
        const checked = read(classifier, text, gate);
        expect([gate, text, checked.normalized]).toEqual([gate, text, checked.input]);
        if (!installed) expect([gate, text, checked.result.classification.findings.highest]).toEqual([gate, text, 'P3']);
      }
      if (installed) expect([gate, read(classifier, '> [P1, blocking] quoted\n[P3] real', gate).result.credited]).toEqual([gate, false]);
    }
  });

  // Criterion 5: a rewrite must not rescue a response the recovery cannot read.
  both('a response the recovery cannot read is still not credited', classifier => {
    for (const gate of gates) {
      for (const failure of ['NEEDS_CONTEXT: callers\nNO_FINDINGS', '**NEEDS_CONTEXT:** callers\nNO_FINDINGS', '| Verdict | NEEDS_CONTEXT |', '```diff\nexample']) {
        const text = `[P3, advisory] x\n${failure}`;
        expect([gate, text, outcome(read(classifier, text, gate)).slice(0, 3)]).toEqual([gate, text, [false, 'failed', 'unverified']]);
      }
      expect([gate, outcome(read(classifier, 'Looks reasonable overall.', gate)).slice(0, 3)]).toEqual([gate, [false, 'failed', 'unverified']]);
    }
    for (const [text, exit] of [['[P3, advisory] x', 124], ['I cannot review\n[P3, advisory] x', 0]] as const) {
      const result = recover(text, 'structured', exit, '', classifier);
      expect([text, exit, result.credited, result.parse, result.classification.verdict]).toEqual([text, exit, false, 'not-applicable', 'unavailable']);
    }
  });

  test.skipIf(!process.env.GSTACK_OUTSIDE_TEST_ROOT)("a reviewer's not-ready verdict still blocks beside an advisory qualified label (installed only)", async () => {
    const result = recover(`[P3, advisory] x\n${REC}\nVerdict: not ready`, 'review', 0, '', await installedClassifier());
    expect([result.credited, result.classification.verdict, result.classification.findings.highest]).toEqual([true, 'findings', 'P3']);
  });
});

test('UTF-8 byte record accounts for every supplied byte and contains no content', () => {
  const p = prepare(request, '+secret-diff');
  const record = p.record('challenge');
  expect(record.supplied_bytes).toBe(Buffer.byteLength(p.prefix + TASKS.challenge));
  expect(Object.values(record.sections).reduce((a, b) => a + b, 0)).toBe(record.supplied_bytes);
  expect(record.sections.criteria).toBe(Buffer.byteLength(JSON.stringify(request.criteria)));
  expect(record.provider_overhead_bytes).toBeNull();
  expect(JSON.stringify(record)).not.toContain('secret-diff');
});

test('frozen delta prompt excludes earlier branch changes and later working edits', async () => temporary(dir => {
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(dir, 'baseline'), 'old\n'); git('add', '.'); git('commit', '-qm', 'base');
  writeFileSync(join(dir, 'first-cycle'), 'earlier-branch-change\n'); git('add', '.'); git('commit', '-qm', 'reviewed');
  const base = git('rev-parse', 'HEAD');
  writeFileSync(join(dir, 'repair'), 'delta-fix\n'); git('add', '.'); git('commit', '-qm', 'repair');
  const candidate = git('rev-parse', 'HEAD');
  writeFileSync(join(dir, 'repair'), 'unreviewed-working-edit\n');
  const delta = { ...request, repo: dir, base, candidate, scope: 'delta' as const };
  const prompt = prepare(delta, snapshotDiff(delta)).prefix;
  expect(prompt).toContain('delta-fix');
  expect(prompt).not.toContain('earlier-branch-change');
  expect(prompt).not.toContain('unreviewed-working-edit');
  expect(() => snapshotDiff({ ...delta, base: 'HEAD~1' })).toThrow();
}));

test('two independent sequential calls share a prefix, keep distinct findings, and replay without paying', async () => temporary(async dir => {
  const calls: { prefix: string; task: string }[] = [];
  const send = async (prefix: string, task: string) => {
    calls.push({ prefix, task });
    return { status: 'completed', result: task === TASKS.challenge ? '[P1] race' : '[P2] duplicate entry',
      usage: { cache_read_input_tokens: 123, unsafe: 'secret' } };
  };
  const results = await run(request, '+diff', dir, 'model', send, classify);
  expect(calls.length).toBe(2);
  expect(calls[0]!.prefix).toBe(calls[1]!.prefix);
  expect(calls[0]!.task).not.toBe(calls[1]!.task);
  expect(results.map(r => r.classification.findings.highest)).toEqual(['P1', 'P2']);
  const replay = await run(request, '+diff', dir, 'model', send, classify);
  expect(calls.length).toBe(2);
  expect(replay.every(r => r.replay && r.credited)).toBe(true);
  expect(measurement(results[0]!).cache_read_input_tokens).toBe(123);
  expect(measurement(results[0]!).cache_creation_input_tokens).toBeNull();
  expect(JSON.stringify(measurement(results[0]!))).not.toContain('secret');
  for (const file of readdirSync(dir).filter(f => f.endsWith('.claim'))) {
    const record = readFileSync(join(dir, file), 'utf8');
    expect(record).not.toContain('+diff');
    expect(JSON.parse(record).prompt.supplied_bytes).toBeGreaterThan(0);
  }
  const saved = readdirSync(dir).find(f => f.endsWith('.json'))!;
  writeFileSync(join(dir, saved), '{corrupt');
  expect((await run(request, '+diff', dir, 'model', send, classify)).some(r => r.state_error === 'read-result')).toBe(true);
  expect(calls.length).toBe(2);
}));

test('crash claim prevents duplicate spend; a failed parse stays missing coverage on replay', async () => temporary(async dir => {
  let calls = 0;
  const input = { ...request, structured: false };
  const send = async () => { calls++; throw new Error('lost after billing'); };
  expect((await run(input, '+crash', dir, 'model', send, classify))[0]!.state_error).toBe('dispatch');
  const replay = (await run(input, '+crash', dir, 'model', send, classify))[0]!;
  expect(replay.state_error).toBe('claim');
  expect(replay.dispatched_at).toBeNull();
  expect(replay.returned_at).toBeNull();
  expect(measurement(replay).dispatched).toBe(false);
  expect(calls).toBe(1);
  const failed = async () => { calls++; return { status: 'completed', result: 'Ambiguous output' }; };
  for (let i = 0; i < 2; i++) {
    const [result] = await run(input, '+different-content', dir, 'model', failed, classify);
    expect(result!.credited).toBe(false);
    expect(result!.parse).toBe('failed');
    expect(result!.classification.verdict).toBe('unverified');
  }
  expect(calls).toBe(2);
}));

test('malformed requests and failed result persistence never dispatch another paid call', async () => temporary(async dir => {
  let calls = 0;
  const send = async () => {
    calls++;
    const claim = readdirSync(dir).find(f => f.endsWith('.claim'))!;
    mkdirSync(join(dir, claim.replace(/\.claim$/, '.json')));
    return { status: 'completed', result: 'NO_FINDINGS' };
  };
  for (const patch of [{ criteria: '' }, { instructions: '' }, { context: null }, { structured: 'yes' }]) {
    await expect(run({ ...request, ...patch } as Request, '+diff', dir, 'model', send, classify)).rejects.toThrow();
  }
  expect(calls).toBe(0);
  const first = await run(request, '+diff', dir, 'model', send, classify);
  expect(first[0]!.state_error).toBe('save-result');
  expect(first[0]!.credited).toBe(true);
  expect(first[0]!.response.result).toBe('NO_FINDINGS');
  expect(first[0]!.dispatched_at).not.toBeNull();
  expect(first[0]!.returned_at).not.toBeNull();
  expect(first[1]!.state_error).toBe('blocked-by-state-error');
  expect((await run(request, '+diff', dir, 'model', send, classify))[0]!.state_error).toBe('read-result');
  expect(calls).toBe(1);
}));

test('a later phase exception returns earlier paid findings, including on replay', async () => temporary(async dir => {
  let calls = 0;
  const send = async (_prefix: string, task: string) => {
    calls++;
    if (task === TASKS.structured) throw new Error('lost after billing');
    return { status: 'completed', result: '[P0] critical challenge finding' };
  };
  for (let i = 0; i < 2; i++) {
    const results = await run(request, '+diff', dir, 'model', send, classify);
    expect(results[0]!.credited).toBe(true);
    expect(results[0]!.classification.findings.highest).toBe('P0');
    expect(results[0]!.response.result).toContain('critical challenge finding');
    expect(results[1]!.credited).toBe(false);
    expect(results[1]!.state_error).toBe(i ? 'claim' : 'dispatch');
  }
  expect(calls).toBe(2);
}));

test('a corrupt earlier result cannot hide a later saved paid finding or start new work', async () => temporary(async dir => {
  let calls = 0;
  const send = async (_prefix: string, task: string) => {
    calls++;
    return { status: 'completed', result: task === TASKS.challenge ? 'NO_FINDINGS' : '[P0] saved structured finding' };
  };
  const first = await run(request, '+diff', dir, 'model', send, classify);
  writeFileSync(join(dir, first[0]!.call_id + '.json'), '{corrupt');
  const replay = await run(request, '+diff', dir, 'model', send, classify);
  expect(calls).toBe(2);
  expect(replay[0]!.state_error).toBe('read-result');
  expect(replay[0]!.dispatched_at).toBeNull();
  expect(replay[1]!.classification.findings.highest).toBe('P0');
  expect(replay[1]!.credited).toBe(true);
  expect(replay[1]!.replay).toBe(true);
  expect(replay[1]!.dispatched_at).toBeNull();
  expect(replay[1]!.returned_at).toBeNull();
}));

// Upstream db87940e (1.91.198.0): advisory-only findings do not block, but the reviewer's own last
// `Verdict: not ready` line does. The fixture below mirrors that rule; the installed classifier runs the same table below.
const notReadyFloor: Classifier = ({ text, gate, exit }) => {
  const highest = text.match(/\[(P[0-3])\]/)?.[1] ?? null;
  const last = [...text.matchAll(/^Verdict:\s*(.*)$/gim)].at(-1)?.[1] ?? '';
  const blocking = highest === 'P0' || highest === 'P1' || /^not\s+ready\b/i.test(last.trim());
  const execution = { state: exit ? 'unavailable' : 'ran' };
  if (gate === 'review' && !/^Recommendation: .+ because .+/m.test(text)) return { execution, findings: { highest }, verdict: 'unavailable', reason: 'missing_markers' };
  return { execution, findings: { highest }, verdict: blocking ? 'findings' : 'clean' };
};

describe('advisory findings and a not-ready verdict', () => {
  test.each(GOLDEN_CASES.map(g => [g.id, g] as const))('%s is classified and credited as the golden table says', (_id, golden) => {
    const result = recover(golden.text, golden.gate, 0, '', notReadyFloor);
    expect(result.classification.verdict).toBe(golden.verdict);
    expect(result.classification.findings.highest).toBe('P2');
    expect(result.credited).toBe(golden.credited);
    expect(result.parse).toBe('valid');
  });
  test('the table pairs each gate with an advisory case and a not-ready case', () => {
    expect(GOLDEN_CASES.map(g => `${g.gate}:${g.verdict}`).sort()).toEqual(
      ['review:clean', 'review:findings', 'structured:clean', 'structured:findings']);
  });
  test('the adapter loads exactly the helpers the launch check inventories', () => {
    expect(UPSTREAM_HELPERS.map(h => h.name)).toEqual(['runClaudeCode', 'resolveClaudeCommand', 'classifyOutsideReview']);
    expect(readFileSync(join(import.meta.dir, '../src/outside-review/cli.ts'), 'utf8')).toContain('for (const { module, name } of UPSTREAM_HELPERS)');
  });
  test.skipIf(!process.env.GSTACK_OUTSIDE_TEST_ROOT)('the installed classifier gives the golden verdicts through recovery', async () => {
    const { classifyOutsideReview } = await import(join(process.env.GSTACK_OUTSIDE_TEST_ROOT!, 'lib/outside-review-result.ts'));
    for (const golden of GOLDEN_CASES) {
      const result = recover(golden.text, golden.gate, 0, '', classifyOutsideReview);
      expect([golden.id, result.classification.verdict, result.credited]).toEqual([golden.id, golden.verdict, golden.credited]);
    }
  });
});

test('adapter retains restricted transport and replaces default prompt without changing model', () => {
  const args = restrictedArgs(['-p', '--tools', '', '--strict-mcp-config', '--settings', '{"disableAllHooks":true}',
    '--append-system-prompt', 'upstream no-tool instruction', '--model', 'configured-model'], '/private/prefix');
  expect(args).toContain('--strict-mcp-config');
  expect(args).toContain('configured-model');
  expect(args).not.toContain('--append-system-prompt');
  expect(args).not.toContain('--setting-sources');
  expect(args).toContain('--system-prompt-file');
  expect(JSON.parse(args[args.indexOf('--settings') + 1]!)).toEqual({ disableAllHooks: true, claudeMdExcludes: ['**'], autoMemoryEnabled: false });
});

test('missing installed validator export fails before dispatch or a call claim', async () => temporary(async dir => {
  const lib = join(dir, 'lib');
  mkdirSync(lib);
  writeFileSync(join(lib, 'claude-code.ts'), 'export function runClaudeCode() { throw new Error("DISPATCHED"); }');
  writeFileSync(join(lib, 'claude-bin.ts'), `import { writeFileSync } from 'node:fs'; export function resolveClaudeCommand() { writeFileSync(${JSON.stringify(join(dir, 'resolved'))}, 'called'); return null; }`);
  writeFileSync(join(lib, 'outside-review-result.ts'), 'export const incompatible = true;');
  const input = join(dir, 'request.json');
  writeFileSync(input, JSON.stringify(request));
  const result = Bun.spawnSync(['sh', join(import.meta.dir, '../bin/outside-review'), input, dir, join(dir, 'calls')],
    { stdout: 'pipe', stderr: 'pipe', timeout: 10000 });
  expect(result.exitCode).toBe(1);
  expect(result.stdout.toString()).toBe('');
  expect(readdirSync(dir)).not.toContain('calls');
  expect(readdirSync(dir)).not.toContain('resolved');
}));

test('wrapper wires delta scope, both first-cycle voices and unchanged missing coverage gate', () => {
  const skill = readFileSync(join(import.meta.dir, '../skills/review-and-prep.md'), 'utf8');
  for (const marker of ['### Bound Claude Code outside calls', 'bin/outside-review', 'in-cap=delta',
    'continuation=repair-only', 'Retain both distinct', 'GATE: MISSING COVERAGE', 'native pass never substitutes']) expect(skill).toContain(marker);
});

test('prepare places SETTLED_RULE and settled context in the shared prefix for both phases', () => {
  const settledContext = `${SETTLED_RULE}\nPlan: items/1.plan.md; SHA-256: ${'c'.repeat(64)}\nAccepted decisions:\n- Use base-tip read (items/1.plan.md:14)\nReview rules: none`;
  const prepared = prepare({ ...request, context: settledContext }, '+diff\n');
  expect(prepared.phases).toEqual(['challenge', 'structured']);
  expect(prepared.prefix).toContain(JSON.stringify(settledContext));
  for (const phase of prepared.phases) {
    const rec = prepared.record(phase);
    expect(rec.sections.other_context).toBe(Buffer.byteLength(JSON.stringify(settledContext), 'utf8'));
    expect(rec.shared_prefix_bytes).toBe(Buffer.byteLength(prepared.prefix, 'utf8'));
  }
});

test.skipIf(!process.env.GSTACK_OUTSIDE_TEST_ROOT)('installed upstream transport and validator through fake Claude process (no paid calls)', async () => temporary(async dir => {
  const { classifyOutsideReview } = await import(join(process.env.GSTACK_OUTSIDE_TEST_ROOT!, 'lib/outside-review-result.ts'));
  expect(recover('[p1] crash\n[P2] advisory\nRecommendation: fix because bug.', 'review', 0, '', classifyOutsideReview).classification.verdict).toBe('findings');
  expect(recover('**NEEDS_CONTEXT:** callers\nNO_FINDINGS\nRecommendation: wait because callers are missing.', 'review', 0, '', classifyOutsideReview).credited).toBe(false);
  for (const label of ['**[p1]**', '1. [p1]', '| p1 |']) {
    expect(recover(`${label} crash\n[P2] advisory\nRecommendation: fix because bug.`, 'review', 0, '', classifyOutsideReview).classification.verdict).toBe('findings');
  }
  for (const example of ['[P3] Prefer args[p1]', '[P3] Prefer `args[p1]`', '[P3] Explain `NEEDS_CONTEXT:`']) {
    const checked = recover(example + '\nRecommendation: fix because advisory.', 'review', 0, '', classifyOutsideReview);
    expect(checked.classification.findings.highest).toBe('P3');
    expect(checked.credited).toBe(true);
    expect(checked.parse).toBe('valid');
  }
  for (const marker of ['Recommendation: NEEDS_CONTEXT because callers are missing', 'Verdict: NEEDS_CONTEXT',
    '| Verdict | NEEDS_CONTEXT |', '| NEEDS_CONTEXT | callers |', 'NEEDS_CONTEXT — missing callers',
    '```diff\nNEEDS_CONTEXT: missing callers']) {
    expect(recover('[P2] advisory\nRecommendation: wait because callers are missing.\n' + marker,
      'review', 0, '', classifyOutsideReview).credited).toBe(false);
  }
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(dir, 'source'), 'before\n'); git('add', '.'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  writeFileSync(join(dir, 'source'), 'after\n'); git('add', '.'); git('commit', '-qm', 'candidate');
  const candidate = git('rev-parse', 'HEAD');
  const fake = join(dir, 'fake-claude.ts');
  writeFileSync(fake, `
import { readFileSync, appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
const task = await Bun.stdin.text();
if (process.env.FAKE_MODE === 'provider-error') process.exit(1);
const prefix = readFileSync(args[args.indexOf('--system-prompt-file') + 1], 'utf8');
appendFileSync(process.env.FAKE_CAPTURE!, JSON.stringify({ args, task, prefix, cwd: process.cwd() }) + '\\n');
const result = process.env.FAKE_MODE === 'clean' ? 'NO_FINDINGS' : process.env.FAKE_MODE === 'ambiguous' ? 'Looks fine' : task.includes('adversarial') ? '[P1] failure path' : '[P2] duplicate said entry';
console.log(JSON.stringify({ result,
  session_id: 'fixture-session', usage: { cache_read_input_tokens: 17 }, modelUsage: { 'fixture-model': { inputTokens: 5 } } }));
`);
  const input = join(dir, 'request.json');
  writeFileSync(input, JSON.stringify({ ...request, repo: dir, base, candidate }));
  const capture = join(dir, 'capture.jsonl');
  const invoke = (mode = 'findings') => Bun.spawnSync([join(import.meta.dir, '../bin/outside-review'), input,
    process.env.GSTACK_OUTSIDE_TEST_ROOT!, join(dir, 'calls-' + mode)], {
    env: { ...process.env, GSTACK_CLAUDE_BIN: process.execPath,
      GSTACK_CLAUDE_BIN_ARGS: JSON.stringify(['--no-env-file', fake]), FAKE_CAPTURE: capture, FAKE_MODE: mode },
    stdout: 'pipe', stderr: 'pipe', timeout: 20000,
  });
  const first = invoke();
  expect(first.stderr.toString()).toBe('');
  expect(first.exitCode).toBe(3);
  const result = JSON.parse(first.stdout.toString());
  expect(result.results.map((r: any) => r.classification.findings.highest)).toEqual(['P1', 'P2']);
  expect(result.results[0].parse).toBe('recovered');
  const captured = readFileSync(capture, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(captured.length).toBe(2);
  expect(captured[0].prefix).toBe(captured[1].prefix);
  expect(captured[0].task).not.toBe(captured[1].task);
  expect(realpathSync(captured[0].cwd)).toBe(realpathSync(dir));
  expect(captured[0].args).not.toContain('--setting-sources');
  expect(captured[0].args[captured[0].args.indexOf('--tools') + 1]).toBe('');
  expect(captured[0].args).toContain('--strict-mcp-config');
  expect(invoke().exitCode).toBe(3);
  expect(readFileSync(capture, 'utf8').trim().split('\n').length).toBe(2);
  expect(invoke('clean').exitCode).toBe(0);
  const ambiguous = invoke('ambiguous');
  expect(ambiguous.exitCode).toBe(4);
  expect(JSON.parse(ambiguous.stdout.toString()).results.every((r: any) => !r.credited)).toBe(true);
  const failed = invoke('provider-error');
  expect(failed.exitCode).toBe(4);
  expect(JSON.parse(failed.stdout.toString()).results.every((r: any) => !r.credited && r.classification.verdict === 'unavailable')).toBe(true);
  const count = readFileSync(capture, 'utf8').trim().split('\n').length;
  writeFileSync(input, JSON.stringify({ ...request, repo: dir, base: 'HEAD', candidate }));
  expect(invoke('invalid').exitCode).toBe(1);
  expect(readFileSync(capture, 'utf8').trim().split('\n').length).toBe(count);
}), 30000);
