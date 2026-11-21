import { describe, test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { prepare, snapshotDiff, CLOSING_LINES, NOTHING_MISSING, POLICY, TASKS, type Request } from '../src/outside-review/prompt';
import { buildPrompt, DELEGATE_POLICY, POLICY_FORMAT, SETTLED_RULE } from '../src/review-delegate/delegate';
import { exactForms, recover, type Classifier } from '../src/outside-review/recovery';
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
    const input = gate === 'review' ? `${text}\n${REC}\nVERDICT: FINDINGS` : `${text}\nVERDICT: FINDINGS`;
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
    for (const golden of GOLDEN_CASES) {
      if (golden.id.endsWith('-advisory')) expect(golden.text.endsWith('\nVERDICT: FINDINGS')).toBe(true);
      else expect(golden.text.endsWith('\nVerdict: not ready')).toBe(true);
    }
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
    const checked = recover(example + '\nRecommendation: fix because advisory.\nVERDICT: FINDINGS', 'review', 0, '', classifyOutsideReview);
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
const result = process.env.FAKE_MODE === 'clean' ? 'NO_FINDINGS: none\\nRecommendation: approve because clean.\\nVERDICT: CLEAN' : process.env.FAKE_MODE === 'ambiguous' ? 'Looks fine' : task.includes('adversarial') ? '[P1] failure path' : '[P2] duplicate said entry\\nVERDICT: FINDINGS';
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

// Faithful fixture mirroring installed gstack's lastLineVerdict plus NUMBERED_ITEM (`lib/outside-review-result.ts:277`).
const NUMBERED_ITEM_RE = /^(?:\*\*|__)?\(?\d{1,3}[.)][\t ]+\S.*$/gm;
const stripClosedFences = (text: string): string => {
  const lines = text.split(/\r?\n/);
  const markers = lines.map(l => /^[\t ]*(`{3,}|~{3,})/.exec(l)?.[1]);
  let fence: string | undefined;
  return lines.map((line, i) => {
    const m = markers[i];
    if (fence) { if (m && m[0] === fence[0] && m.length >= fence.length) fence = undefined; return ''; }
    if (m) { fence = m; return ''; }
    return line;
  }).join('\n');
};
const numberedItems: Classifier = ({ text, gate, exit }) => {
  const base = lastLineVerdict({ text, gate, exit, stderr: '' });
  if (base.execution.state !== 'ran') return base;
  const lines = text.trimEnd().split(/\r?\n/);
  const last = (lines.at(-1) ?? '').replace(/^[\t ]*(?:#{1,6}[\t ]+|[-+*][\t ]+)?/, '').replace(/[*_`]/g, '').trim();
  const token = /^VERDICT: (CLEAN|FINDINGS)$/.exec(last)?.[1] as 'CLEAN' | 'FINDINGS' | undefined;
  const body = token ? lines.slice(0, -1).join('\n') : text;
  const codeFree = stripClosedFences(body);
  const hasVerdictLine = /^[\t ]*Verdict[\t ]*:/im.test(codeFree);
  const unlabeled = (hasVerdictLine || token === 'CLEAN')
    ? [...codeFree.matchAll(NUMBERED_ITEM_RE)].filter(m => !/\[P[0-3]\]/.test(m[0])).length : 0;
  if (token === 'CLEAN' && unlabeled > 0) {
    return { execution: { state: 'ran' }, findings: { highest: base.findings.highest, unlabeled }, verdict: 'unverified', reason: 'untagged_review' };
  }
  return unlabeled ? { ...base, findings: { ...base.findings, unlabeled } } : base;
};

describe('exact reply forms (NEEDS_CONTEXT: none and <n>. MET)', () => {
  const gates = ['review', 'structured'] as const;
  const CLOSING_CLEAN = 'NO_FINDINGS: none\nRecommendation: approve because every criterion is met and no caller changes behavior.\nVERDICT: CLEAN';
  const CLOSING_FINDINGS = 'Recommendation: merge, optionally addressing the advisory note, because no blocking defect remains.\nVERDICT: FINDINGS';
  const installedClassifier = async (): Promise<Classifier> =>
    (await import(join(process.env.GSTACK_OUTSIDE_TEST_ROOT!, 'lib/outside-review-result.ts'))).classifyOutsideReview;
  const bothStrict = (title: string, body: (classifier: Classifier) => void) => {
    test(`${title} (strict fixture)`, () => body(classify));
    test.skipIf(!process.env.GSTACK_OUTSIDE_TEST_ROOT)(`${title} (installed classifier)`, async () => body(await installedClassifier()));
  };
  const bothNumbered = (title: string, body: (classifier: Classifier) => void) => {
    test(`${title} (numberedItems fixture)`, () => body(numberedItems));
    test.skipIf(!process.env.GSTACK_OUTSIDE_TEST_ROOT)(`${title} (installed classifier)`, async () => body(await installedClassifier()));
  };

  // Value: protects=approved exact marks and later-closing-line rule; fails_when=the MET closer guard or exact token spelling check is removed;
  // why_new=the post-verdict case exercises a separate bound; seam=none; no_claim=installed classifier or producer behavior.
  test('E1 pure exactForms predicate table covers token and MET accept and reject cases', () => {
    const cases: Array<[string, string[], ('nothing-missing' | 'met' | null)[]]> = [
      ['first-line token before closing lines', ['NEEDS_CONTEXT: none', 'NO_FINDINGS: none', 'Recommendation: merge because clean.', 'VERDICT: CLEAN'], ['nothing-missing', null, null, null]],
      ['token after blank line and before closing lines', ['Analysis paragraph.', '', 'NEEDS_CONTEXT: none', 'NO_FINDINGS: none', 'Recommendation: merge because clean.', 'VERDICT: CLEAN'], [null, null, 'nothing-missing', null, null, null]],
      ['token with trailing spaces/tabs and space/tab neighbor above', ['Analysis.', ' \t ', 'NEEDS_CONTEXT: none \t', '', 'NO_FINDINGS: none\t ', 'Recommendation: merge because clean.', 'VERDICT: CLEAN \t'], [null, null, 'nothing-missing', null, null, null, null]],
      ['token after NO_FINDINGS: none with blank line between', ['NO_FINDINGS: none', '', 'NEEDS_CONTEXT: none', 'Recommendation: merge because clean.', 'VERDICT: CLEAN'], [null, null, 'nothing-missing', null, null]],
      ['token directly under NO_FINDINGS: none rejected', ['NO_FINDINGS: none', 'NEEDS_CONTEXT: none', 'Recommendation: merge because clean.', 'VERDICT: CLEAN'], [null, null, null, null]],
      ['token directly under prose line rejected', ['Caller context is missing.', 'NEEDS_CONTEXT: none', 'NO_FINDINGS: none', 'Recommendation: merge because clean.', 'VERDICT: CLEAN'], [null, null, null, null, null]],
      ['token directly above prose line rejected', ['NEEDS_CONTEXT: none', 'All callers were checked.', 'NO_FINDINGS: none', 'Recommendation: merge because clean.', 'VERDICT: CLEAN'], [null, null, null, null, null]],
      ['token followed by later paragraph after blank line rejected', ['NEEDS_CONTEXT: none', '', 'Wait, callers are missing.', 'NO_FINDINGS: none', 'Recommendation: merge because clean.', 'VERDICT: CLEAN'], [null, null, null, null, null, null]],
      ['token with NBSP neighbor above rejected', ['\u00A0', 'NEEDS_CONTEXT: none', 'NO_FINDINGS: none', 'Recommendation: merge because clean.', 'VERDICT: CLEAN'], [null, null, null, null, null]],
      ['token with BOM neighbor above rejected', ['\uFEFF', 'NEEDS_CONTEXT: none', 'NO_FINDINGS: none', 'Recommendation: merge because clean.', 'VERDICT: CLEAN'], [null, null, null, null, null]],
      ['token under bold Recommendation rejected', ['NEEDS_CONTEXT: none', '**Recommendation:** merge because clean.', 'VERDICT: CLEAN'], [null, null, null]],
      ['token under leading-space NO_FINDINGS rejected', ['NEEDS_CONTEXT: none', ' NO_FINDINGS: none', 'Recommendation: merge because clean.', 'VERDICT: CLEAN'], [null, null, null, null]],
      ['token after final VERDICT line rejected (E3)', ['NO_FINDINGS: none', 'Recommendation: merge because clean.', 'VERDICT: CLEAN', '', 'NEEDS_CONTEXT: none'], [null, null, null, null, null]],
      ['token alone with no closing line rejected (E3)', ['NEEDS_CONTEXT: none'], [null]],
      ['a later recommendation does not count a token after the last verdict', ['VERDICT: CLEAN', '', 'NEEDS_CONTEXT: none', 'Recommendation: merge because clean.'], [null, null, null, null]],
      ['token written twice rejected', ['NEEDS_CONTEXT: none', '', 'NEEDS_CONTEXT: none', 'NO_FINDINGS: none', 'Recommendation: merge because clean.', 'VERDICT: CLEAN'], [null, null, 'nothing-missing', null, null, null]],
      ['MET block between blank lines before closing lines', ['**Heading**', '', '1. MET', '2. MET', '999. MET \t', '', 'NO_FINDINGS: none', 'Recommendation: merge because clean.', 'VERDICT: CLEAN'], [null, null, 'met', 'met', 'met', null, null, null, null]],
      ['MET block at reply start directly before closing line', ['1. MET', '2. MET', 'NO_FINDINGS: none', 'Recommendation: merge because clean.', 'VERDICT: CLEAN'], ['met', 'met', null, null, null]],
      ['MET block directly under nonblank line rejected', ['**Heading**', '1. MET', '2. MET', '', 'NO_FINDINGS: none', 'Recommendation: merge because clean.', 'VERDICT: CLEAN'], [null, null, null, null, null, null, null]],
      ['MET block directly above prose line rejected', ['', '1. MET', '2. MET', 'Prose note.', '', 'NO_FINDINGS: none', 'Recommendation: merge because clean.', 'VERDICT: CLEAN'], [null, null, null, null, null, null, null, null]],
      ['a later recommendation does not count a MET block after the last verdict', ['VERDICT: FINDINGS', '', '1. MET', '2. MET', 'Recommendation: hold because a test failed.'], [null, null, null, null, null]],
      ['MET block with a blank below but no later closing line rejected', ['1. MET', '', 'Verification notes.'], [null, null, null]],
      ['MET block interrupted by indented sub-bullet rejected', ['', '1. MET', '  - sub-bullet', '2. MET', '', 'NO_FINDINGS: none', 'Recommendation: merge because clean.', 'VERDICT: CLEAN'], [null, null, null, null, null, null, null, null]],
      ['MET block after final VERDICT line rejected (E3)', ['NO_FINDINGS: none', 'Recommendation: merge because clean.', 'VERDICT: CLEAN', '', '1. MET', '2. MET'], [null, null, null, null, null, null]],
      ['non-exact MET lines rejected', ['', '3. Met', '', '3. MET.', '', '3) MET', '', '**3. MET**', '', '03. MET', '', '1000. MET', '', '3. MET, by inspection', '', 'NO_FINDINGS: none', 'VERDICT: CLEAN'], new Array(17).fill(null)],
    ];
    for (const [label, lines, expected] of cases) {
      expect([label, exactForms(lines)]).toEqual([label, expected]);
    }

    const positions = (reply: string) => exactForms(reply.split('\n'))
      .flatMap((form, index) => form === null ? [] : [index]);
    for (const reply of rejectedTokenReplies) {
      // Blanking a counted form cannot hide the separate context request.
      const expected = reply === tokenAfterContextRequest ? [2] : [];
      expect([reply, positions(reply)]).toEqual([reply, expected]);
    }
    for (const [index, reply] of creditedTokenReplies) {
      expect([reply, positions(reply)]).toEqual([reply, [index]]);
    }
    expect(positions(tokenWithTrailingSpaces)).toEqual([2]);
    expect(positions(REWRITTEN_2026_11_19)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    for (const reply of rejectedMetReplies) {
      expect([reply, positions(reply)]).toEqual([reply, []]);
    }
  });

  // O1
  bothStrict('O1: credits clean challenge and structured replies with a counted token, and fails closed when prose follows a first-line token', classifier => {
    const cleanFirst = `NEEDS_CONTEXT: none\n${CLOSING_CLEAN}`;
    const cleanAfterProse = `I checked every hunk of the diff against the acceptance criteria and the supplied callers.\n\nNEEDS_CONTEXT: none\n${CLOSING_CLEAN}`;
    const tokenBeforeProse = `NEEDS_CONTEXT: none\n\nI checked every hunk of the diff against the acceptance criteria.\n${CLOSING_CLEAN}`;
    for (const gate of gates) {
      for (const reply of [cleanFirst, cleanAfterProse]) {
        const res = recover(reply, gate, 0, '', classifier);
        expect([gate, res.credited, res.needs_context, res.parse, res.classification.verdict]).toEqual([gate, true, false, 'valid', 'clean']);
      }
      const bad = recover(tokenBeforeProse, gate, 0, '', classifier);
      expect([gate, bad.credited, bad.needs_context, bad.parse, bad.classification.verdict]).toEqual([gate, false, true, 'failed', 'unverified']);
    }
  });

  const tokenAfterContextRequest = `NEEDS_CONTEXT: the callers of save()\n\nNEEDS_CONTEXT: none\n${CLOSING_CLEAN}`;
  const rejectedTokenReplies = [
    `NEEDS_CONTEXT: none of the above depends on missing context.\n${CLOSING_CLEAN}`,
    `NEEDS_CONTEXT: none (the callers were supplied).\n${CLOSING_CLEAN}`,
    `NEEDS_CONTEXT: None\n${CLOSING_CLEAN}`,
    `NEEDS_CONTEXT:none\n${CLOSING_CLEAN}`,
    `NEEDS_CONTEXT: none.\n${CLOSING_CLEAN}`,
    `- NEEDS_CONTEXT: none\n${CLOSING_CLEAN}`,
    `> NEEDS_CONTEXT: none\n${CLOSING_CLEAN}`,
    `**NEEDS_CONTEXT: none**\n${CLOSING_CLEAN}`,
    ` NEEDS_CONTEXT: none\n${CLOSING_CLEAN}`,
    `\uFEFFNEEDS_CONTEXT: none\n${CLOSING_CLEAN}`,
    `NEEDS_CONTEXT: none\uFEFF\n${CLOSING_CLEAN}`,
    `NEEDS_CONTEXT:\u00A0none\n${CLOSING_CLEAN}`,
    `NEEDS_CONTEXT: none\u00A0\n${CLOSING_CLEAN}`,
    `\u00A0\nNEEDS_CONTEXT: none\n${CLOSING_CLEAN}`,
    `\uFEFF\nNEEDS_CONTEXT: none\n${CLOSING_CLEAN}`,
    `NO_FINDINGS: none\nNEEDS_CONTEXT: none\nRecommendation: approve because clean.\nVERDICT: CLEAN`,
    `The callers of save() were not supplied.\nNEEDS_CONTEXT: none\n${CLOSING_CLEAN}`,
    `Everything looks fine except\nNEEDS_CONTEXT: none\n${CLOSING_CLEAN}`,
    `NEEDS_CONTEXT: none\nAll callers were checked.\n${CLOSING_CLEAN}`,
    `NEEDS_CONTEXT: none\n\nThe callers of save() were not supplied.\n${CLOSING_CLEAN}`,
    `Analysis start.\n\nNEEDS_CONTEXT: none\n\nMore analysis.\n\n${CLOSING_CLEAN}`,
    tokenAfterContextRequest,
    // O7: bold Recommendation or leading-space NO_FINDINGS directly under token
    `NEEDS_CONTEXT: none\n**Recommendation:** approve because clean.\nVERDICT: CLEAN`,
    `NEEDS_CONTEXT: none\n NO_FINDINGS: none\nRecommendation: approve because clean.\nVERDICT: CLEAN`,
    // O11 (E2): reply made only of the token
    'NEEDS_CONTEXT: none',
  ];

  const creditedTokenReplies = [
    // Token after NO_FINDINGS: none with a blank line between
    [2, 'NO_FINDINGS: none\n\nNEEDS_CONTEXT: none\nRecommendation: approve because clean.\nVERDICT: CLEAN'],
    // Neighbor line of only spaces or tabs counts as blank; token with trailing spaces/tabs counts
    [2, 'Analysis.\n  \t \nNEEDS_CONTEXT: none \t\n' + CLOSING_CLEAN],
    // Residual 1: gap named in a separate earlier paragraph
    [2, 'The callers of save() were not supplied in the bundle.\n\nNEEDS_CONTEXT: none\n' + CLOSING_CLEAN],
    // Residual 2: gap named in the closing Recommendation's because-clause directly under the token
    [0, 'NEEDS_CONTEXT: none\nNO_FINDINGS: none\nRecommendation: hold because the callers of save() were not supplied.\nVERDICT: CLEAN'],
  ] as const;

  // O2, O7, O11
  bothStrict('O2, O7, O11: fails closed on every token variant or neighbor violation and pins the accepted residuals', classifier => {
    for (const gate of gates) {
      for (const reply of rejectedTokenReplies) {
        const res = recover(reply, gate, 0, '', classifier);
        expect([gate, reply, res.credited, res.needs_context, res.classification.verdict]).toEqual([gate, reply, false, true, 'unverified']);
      }
    }

    for (const gate of gates) {
      for (const [, reply] of creditedTokenReplies) {
        const res = recover(reply, gate, 0, '', classifier);
        expect([gate, reply, res.credited, res.needs_context, res.classification.verdict]).toEqual([gate, reply, true, false, 'clean']);
      }
    }
  });

  const tokenWithTrailingSpaces = 'Analysis.\n  \t \nNEEDS_CONTEXT: none \t\nNO_FINDINGS: none \t\nRecommendation: approve because clean. \t\nVERDICT: CLEAN \t';

  // O7 trailing spaces/tabs on closing lines (run through numberedItems and installedClassifier, since strict stub regex has no trailing whitespace on NO_FINDINGS)
  bothNumbered('O7: closing lines with trailing spaces or tabs count under the token', classifier => {
    for (const gate of gates) {
      const res = recover(tokenWithTrailingSpaces, gate, 0, '', classifier);
      expect([gate, res.credited, res.needs_context, res.classification.verdict]).toEqual([gate, true, false, 'clean']);
    }
  });

  // O3 and O4
  const REWRITTEN_2026_11_19 = [
    '**Structured Review**',
    '**Criteria assessment**',
    '',
    '1. MET',
    '2. MET',
    '3. MET',
    '4. MET',
    '5. MET',
    '6. MET',
    '7. MET',
    '8. MET',
    '',
    '**Verification notes**',
    '- Checked all hunks against the contract.',
    '- No regression risk identified.',
    '',
    'NO_FINDINGS: none',
    'Recommendation: approve because all eight criteria are met and no defect was found.',
    'VERDICT: CLEAN',
  ].join('\n');

  const ORIGINAL_2026_11_19 = REWRITTEN_2026_11_19.replace(
    ['1. MET', '2. MET', '3. MET', '4. MET', '5. MET', '6. MET', '7. MET', '8. MET'].join('\n'),
    [
      '1. **Criterion one.** Met.',
      '2. **Criterion two.** Met.',
      '3. **Criterion three.** Met.',
      '4. **Criterion four.** Met.',
      '5. **Criterion five.** Met.',
      '6. **Criterion six.** Met.',
      '7. **Criterion seven.** Met.',
      '8. **Criterion eight.** Met.',
    ].join('\n'),
  );

  const rejectedMetReplies = [
    ORIGINAL_2026_11_19,
    REWRITTEN_2026_11_19.replace('3. MET', '3. Missing guard on empty input in parser.'),
    REWRITTEN_2026_11_19.replace('3. MET', '3. Met'),
    REWRITTEN_2026_11_19.replace('3. MET', '3. MET.'),
    REWRITTEN_2026_11_19.replace('3. MET', '3) MET'),
    REWRITTEN_2026_11_19.replace('3. MET', '**3. MET**'),
    REWRITTEN_2026_11_19.replace('3. MET', '03. MET'),
    REWRITTEN_2026_11_19.replace('3. MET', '3. MET, by inspection'),
    REWRITTEN_2026_11_19.replace('**Criteria assessment**\n\n1. MET', '**Criteria assessment**\n1. MET'),
    REWRITTEN_2026_11_19.replace('8. MET\n\n**Verification notes**', '8. MET\nAll criteria verified.\n\n**Verification notes**'),
    REWRITTEN_2026_11_19.replace('1. MET\n2. MET', '1. MET\n  - checked by inspection\n2. MET'),
  ];

  bothNumbered('O3, O4: credits the rewritten 2026-11-19 MET block (including challenge structured fallback) and keeps non-exact numbered shapes fail-closed', classifier => {
    for (const gate of gates) {
      const ok = recover(REWRITTEN_2026_11_19, gate, 0, '', classifier);
      expect([gate, ok.credited, ok.needs_context, ok.parse, ok.classification.verdict]).toEqual([gate, true, false, 'valid', 'clean']);
    }

    for (const gate of gates) {
      for (const reply of rejectedMetReplies) {
        const res = recover(reply, gate, 0, '', classifier);
        expect([gate, reply, res.credited, res.classification.verdict, res.classification.reason]).toEqual([
          gate, reply, false, 'unverified', 'untagged_review',
        ]);
      }
    }

    // O4: challenge reply (review gate) with counted MET lines and no Recommendation credits via structured fallback with parse: 'recovered'
    const challengeNoRec = REWRITTEN_2026_11_19.replace(
      '\nRecommendation: approve because all eight criteria are met and no defect was found.',
      '',
    );
    const recovered = recover(challengeNoRec, 'review', 0, '', classifier);
    expect([recovered.credited, recovered.needs_context, recovered.parse, recovered.classification.verdict]).toEqual([
      true, false, 'recovered', 'clean',
    ]);
  });

  // O5
  test('O5: prompts ask for the exact forms with quoted interpolation, structural bounds, and no met-criterion line in delegated prompts', () => {
    expect(NOTHING_MISSING).toBe('NEEDS_CONTEXT: none');
    for (const promptText of [CLOSING_LINES, POLICY, POLICY_FORMAT, DELEGATE_POLICY,
      buildPrompt('testing', 'a'.repeat(40), 'b'.repeat(40), 'diff', 'checklist', undefined, ['bun test *'])]) {
      expect(promptText).toContain(`write no NEEDS_CONTEXT line, or write the exact line "${NOTHING_MISSING}" on its own line after a blank line, or as the reply's first line`);
      expect(promptText).toContain(`if you would qualify it in any way, write NEEDS_CONTEXT: <what is missing> instead`);
      expect(promptText).toContain(`no formatting (no bold, list marker, quote or code span) on "${NOTHING_MISSING}" or the closing lines`);
      expect(promptText.indexOf('If essential context is missing, return NEEDS_CONTEXT: <specific callers, contracts or tests>.'))
        .toBeLessThan(promptText.indexOf(`"${NOTHING_MISSING}"`));
      expect(promptText.indexOf(`"${NOTHING_MISSING}"`))
        .toBeLessThan(promptText.indexOf('Never declare a review complete when essential context is missing.'));
    }
    expect(POLICY).toContain('in the exact form "<number>. MET"');
    expect(POLICY).toContain('blank line above and below');
    expect(POLICY_FORMAT).not.toContain('"<number>. MET"');
    expect(DELEGATE_POLICY).not.toContain('"<number>. MET"');
  });

  // O6
  bothNumbered('O6: an exact-form line inside a fenced code block has the same classification as the reply without that line', classifier => {
    const withFencedToken = `\`\`\`text\n\nNEEDS_CONTEXT: none\n\n\`\`\`\n[P2] advisory note\n${CLOSING_FINDINGS}`;
    const withoutFencedToken = `\`\`\`text\n\n\n\`\`\`\n[P2] advisory note\n${CLOSING_FINDINGS}`;
    const withFencedMet = `\`\`\`text\n\n1. MET\n2. MET\n\n\`\`\`\n${CLOSING_CLEAN}`;
    const withoutFencedMet = `\`\`\`text\n\n\n\`\`\`\n${CLOSING_CLEAN}`;
    for (const gate of gates) {
      expect(recover(withFencedToken, gate, 0, '', classifier).classification)
        .toEqual(recover(withoutFencedToken, gate, 0, '', classifier).classification);
      expect(recover(withFencedMet, gate, 0, '', classifier).classification)
        .toEqual(recover(withoutFencedMet, gate, 0, '', classifier).classification);
    }
  });

  // O8
  bothNumbered('O8: the three documented example replies in docs/outside-review.md are credited verbatim', classifier => {
    const example1 = [
      'I checked every hunk of the diff against the acceptance criteria and the supplied callers.',
      '',
      'NEEDS_CONTEXT: none',
      'NO_FINDINGS: none',
      'Recommendation: approve because every criterion is met and no caller changes behavior.',
      'VERDICT: CLEAN',
    ].join('\n');
    const example2 = [
      '**Criteria assessment**',
      '',
      '1. MET',
      '2. MET',
      '3. MET',
      '',
      'NO_FINDINGS: none',
      'Recommendation: approve because every acceptance criterion is met and no defect was found.',
      'VERDICT: CLEAN',
    ].join('\n');
    const example3 = [
      '[P2] {"severity":"INFORMATIONAL","confidence":80,"path":"src/outside-review/recovery.ts","line":20,"category":"maintainability","summary":"keep the pre-pass pure","fix":"avoid mutating caller arrays"}',
      '',
      'NEEDS_CONTEXT: none',
      'Recommendation: merge, optionally applying the advisory note, because no blocking defect was found.',
      'VERDICT: FINDINGS',
    ].join('\n');
    for (const example of [example1, example2, example3]) {
      for (const gate of gates) {
        const res = recover(example, gate, 0, '', classifier);
        expect([gate, res.credited, res.needs_context, res.parse]).toEqual([gate, true, false, 'valid']);
      }
    }
  });

  // O9 (E5)
  bothStrict('O9: inline code spans holding NEEDS_CONTEXT: none or NEEDS_CONTEXT: <gap> keep HEAD quoted-example behavior', classifier => {
    for (const spanLine of ['`NEEDS_CONTEXT: none`', '`NEEDS_CONTEXT: the callers of save()`']) {
      const res = recover(`${spanLine}\n${CLOSING_CLEAN}`, 'review', 0, '', classifier);
      expect([spanLine, res.credited, res.needs_context]).toEqual([spanLine, true, false]);
    }
    for (const bareSpan of ['`NEEDS_CONTEXT`: callers', '`NEEDS_CONTEXT:` callers']) {
      const res = recover(`${bareSpan}\n${CLOSING_CLEAN}`, 'review', 0, '', classifier);
      expect([bareSpan, res.credited, res.needs_context]).toEqual([bareSpan, false, true]);
    }
  });

  // O10 (E3)
  bothNumbered('O10: a token or MET block placed after the final VERDICT line is not counted and stays uncredited', classifier => {
    const tokenAfterVerdict = `${CLOSING_CLEAN}\n\nNEEDS_CONTEXT: none`;
    const metAfterVerdict = `${CLOSING_CLEAN}\n\n1. MET\n2. MET`;
    const tokenBeforeAnotherRecommendation = tokenAfterVerdict + '\nRecommendation: approve because clean.';
    for (const gate of gates) {
      for (const reply of [tokenAfterVerdict, tokenBeforeAnotherRecommendation]) {
        const tok = recover(reply, gate, 0, '', classifier);
        expect([gate, tok.credited, tok.needs_context, tok.classification.verdict]).toEqual([gate, false, true, 'unverified']);
      }
      const met = recover(metAfterVerdict, gate, 0, '', classifier);
      expect([gate, met.credited, met.needs_context, met.classification.verdict]).toEqual([gate, false, false, 'unverified']);
    }
  });

  // O12 (E4)
  bothStrict('O12: CRLF replies without a counted form keep HEAD parse="recovered", and CRLF replies with a counted token are credited', classifier => {
    const crlfNoForm = CLOSING_CLEAN.replace(/\n/g, '\r\n');
    const crlfWithToken = `NEEDS_CONTEXT: none\r\n${crlfNoForm}`;
    for (const gate of gates) {
      const plain = recover(crlfNoForm, gate, 0, '', classifier);
      expect([gate, plain.credited, plain.needs_context, plain.parse]).toEqual([gate, true, false, 'recovered']);
      const withToken = recover(crlfWithToken, gate, 0, '', classifier);
      expect([gate, withToken.credited, withToken.needs_context, withToken.parse]).toEqual([gate, true, false, 'recovered']);
    }
  });
});
