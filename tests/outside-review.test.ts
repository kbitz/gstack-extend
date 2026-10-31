import { describe, test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { prepare, snapshotDiff, TASKS, type Request } from '../src/outside-review/prompt';
import { recover, type Classifier } from '../src/outside-review/recovery';
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
  if (!highest && !/^NO_FINDINGS$/m.test(text)) return { execution, findings, verdict: 'unverified', reason: 'untagged_review' };
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
    rows(classifier, ['[P3, high] note', '[P1, low] crash', '[P3, HIGH] note', '[P2, high confidence] note'].map(text => [text, UNREAD] as const), true);
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
