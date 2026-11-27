import { describe, expect, test } from 'bun:test';

import { runCheckWorkItemIds } from '../src/audit/checks/work-item-ids.ts';
import { mergeFutureArchive, mergeShippedArchive, parseRoadmap } from '../src/audit/parsers/roadmap.ts';
import { parseIntakeFile, parseTodos } from '../src/audit/parsers/todos.ts';
import { makeCtx } from './helpers/audit-ctx.ts';

describe('runCheckWorkItemIds', () => {
  test('skips when zero inspectable records exist', () => {
    const ctx = makeCtx({});
    const res = runCheckWorkItemIds(ctx);
    expect(res.section).toBe('WORK_ITEM_IDS');
    expect(res.status).toBe('skip');
  });

  test('audits duplicates and malformed fields in Completed even without active records', () => {
    const todos = parseTodos([
      '## Completed', '### A', '- **ID:** wi-112233',
      '### B', '- **ID:** wi-112233', '### C', '- **ID:** wi-BAD',
    ].join('\n'));
    const result = runCheckWorkItemIds(makeCtx({ parsedTodos: todos.value }));
    expect(result.status).toBe('fail');
    expect(result.body.join('\n')).toContain('DUPLICATE_ID: TODOS.md ## Completed');
    expect(result.body.join('\n')).toContain('MALFORMED_ID: TODOS.md ## Completed');
  });

  test('checks both Future sources and ignores fenced examples', () => {
    const active = parseRoadmap([
      '## Future', '- **Inline** — **ID:** wi-a1b2c3 — first.', '~~~md', '- An example.', '~~~',
    ].join('\n'));
    const satellite = parseRoadmap([
      '## Future', '- **Archive** — **ID:** wi-a1b2c3 — second.',
      '- **Two fields** — **ID:** wi-444444 — **ID:** wi-555555 — third.',
    ].join('\n'));
    const merged = mergeFutureArchive(active, satellite);
    const result = runCheckWorkItemIds(makeCtx({ parsedRoadmap: merged.value }));
    expect(merged.value.futureBullets).toHaveLength(1);
    expect(result.body.join('\n')).toContain('DUPLICATE_ID: docs/roadmap-future.md (Archive)');
    expect(result.body.join('\n')).toContain('DUPLICATE_ID: docs/roadmap-future.md (Two fields)');
    expect(result.body.join('\n')).not.toContain('MISSING_ID');
  });

  test('fails on a missing ID under a descriptive Future heading with a migration hint', () => {
    const bullet = '- **Follow-up**: More work. **Revisit when:** - use **Phase 2** — after GA';
    const roadmap = parseRoadmap([
      '## Future (deferred) — next release', bullet,
      '## Future-proof rollout notes', '- Keep the old link',
    ].join('\n'));
    expect(roadmap.value.futureBullets).toEqual([bullet]);
    const result = runCheckWorkItemIds(makeCtx({ parsedRoadmap: roadmap.value }));
    expect(result.status).toBe('fail');
    expect(result.body.filter(line => line.includes('MISSING_ID'))).toEqual([
      '- MISSING_ID: ROADMAP.md ## Future (Follow-up) — missing **ID:** wi-<hex>',
    ]);
    expect(result.body).toContain(
      '- Hint: run `bin/roadmap-id migrate` to assign work-item IDs to existing records.',
    );
  });

  test('checks shipped receipts with a recycled display label as separate records', () => {
    const roadmap = parseRoadmap([
      '## Shipped', '### Track 1A: First ✓ Shipped', '_id: wi-111111_',
      '### Track 1A: Second ✓ Shipped', '_id: wi-222222_',
    ].join('\n'));
    const result = runCheckWorkItemIds(makeCtx({ parsedRoadmap: roadmap.value }));
    expect(result.status).toBe('pass');
    const todos = parseTodos('## Unprocessed\n### [manual] Inbox entry\n- **ID:** wi-222222\n');
    const duplicate = runCheckWorkItemIds(makeCtx({ parsedRoadmap: roadmap.value, parsedTodos: todos.value }));
    expect(duplicate.body.join('\n')).toContain('DUPLICATE_ID: ROADMAP.md Track 1A');
  });

  test('passes when all records across TODOS, Future, ROADMAP, and shipped have valid unique IDs', () => {
    const todos = parseTodos([
      '# TODOS',
      '## Unprocessed',
      '### [manual] First todo',
      '- **ID:** wi-000001',
      '- **Why:** test',
      '## Completed',
      '### [manual] Done todo',
      '- **ID:** wi-000002',
    ].join('\n'));
    const active = parseRoadmap([
      '# Roadmap',
      '## Current Plan',
      '### Group 1: Core',
      '#### Track 1A: Build',
      '_1 task · ~50 LOC · low risk_',
      '_id: wi-000003_',
      '_touches: src/a.ts_',
      '- **Do** -- body (S)',
      '## Future',
      '- **Deferred item** — **ID:** wi-000004 — details. **Revisit when:** trigger',
      '## Shipped',
      'History: docs/roadmap-shipped.md',
    ].join('\n'));
    const shipped = parseRoadmap([
      '# Shipped',
      '## Shipped',
      '#### Group 0: Legacy ✓ Shipped (v0.1.0)',
      '- Track 0A — **ID:** wi-000005 — _shipped (v0.1.0): old_',
      '### Track 0B: Receipt ✓ Shipped (v0.2.0)',
      '_id: wi-000006_',
      '- 2026-01-01: merged',
    ].join('\n'));
    const merged = mergeShippedArchive(active, shipped);

    const ctx = makeCtx({
      todos: 'x',
      roadmap: 'x',
      parsedTodos: todos.value,
      parsedRoadmap: merged.value,
    });
    const res = runCheckWorkItemIds(ctx);
    expect(res.status).toBe('pass');
    expect(res.body).toEqual(['FINDINGS:', '- (none)']);
  });

  test('reports missing IDs alongside failing malformed and cross-document duplicate IDs', () => {
    const todos = parseTodos([
      '# TODOS',
      '## Unprocessed',
      '### [manual] Missing id',
      '- **Why:** no id',
      '### [manual] Bad id',
      '- **ID:** wi-ZZZZ',
      '### [manual] Reused completed id',
      '- **ID:** wi-aaaaaa',
      '## Completed',
      '### [manual] Completed entry',
      '- **ID:** wi-aaaaaa',
    ].join('\n'));
    const active = parseRoadmap([
      '# Roadmap',
      '## Current Plan',
      '### Group 1: Core',
      '#### Track 1A: Active track',
      '_1 task · ~50 LOC · low risk_',
      '_id: wi-bbbbbb_',
      '_touches: src/a.ts_',
      '- **Do** -- body (S)',
      '## Future',
      '- **Dup future** — **ID:** wi-bbbbbb — dup with Track 1A. **Revisit when:** x',
    ].join('\n'));
    const shipped = parseRoadmap([
      '# Shipped',
      '## Shipped',
      '### Track 1A: Colliding label ✓ Shipped (v0.1.0)',
      '_id: wi-bbbbbb_',
      '- 2026-01-01: merged',
    ].join('\n'));
    const merged = mergeShippedArchive(active, shipped);

    const ctx = makeCtx({
      todos: 'x',
      roadmap: 'x',
      parsedTodos: todos.value,
      parsedRoadmap: merged.value,
    });
    const res = runCheckWorkItemIds(ctx);
    expect(res.status).toBe('fail');
    const joined = res.body.join('\n');
    expect(joined).toContain('MISSING_ID:');
    expect(joined).toContain('MALFORMED_ID:');
    expect(joined).toContain('DUPLICATE_ID:');
    expect(joined).toContain('TODOS.md ## Completed');
    expect(joined).toContain('docs/roadmap-shipped.md Track 1A');
  });
});

describe('per-record intake IDs', () => {
  const record = (stem: string, id?: string) => parseIntakeFile(
    'docs/todos/' + stem + '.md', stem + '.md', 'file',
    '### [manual] An intake record\n' + (id ? '- **ID:** ' + id + '\n' : ''),
  );
  const intake = record('wi-a1b2c3', 'wi-a1b2c3');
  test('detects duplicates across every planning source', () => {
    const todos = parseTodos('## Unprocessed\n### [manual] Other\n- **ID:** wi-a1b2c3\n').value;
    const active = parseRoadmap('## Current Plan\n### Group 1: Test\n#### Track 1A: Existing\n_id: wi-a1b2c3_\n');
    const future = parseRoadmap('## Future\n- **Other** — **ID:** wi-a1b2c3 — test.\n');
    const shipped = parseRoadmap('## Shipped\n### Track 2A: Shipped ✓ Shipped (v0.1.0)\n_id: wi-a1b2c3_\n', { fromShippedArchive: true });
    const result = runCheckWorkItemIds(makeCtx({
      parsedTodos: todos,
      parsedRoadmap: mergeFutureArchive(mergeShippedArchive(active, shipped), future).value,
      intakeFiles: [intake, record('wi-aabbcc', 'wi-a1b2c3')],
    }));
    expect(result.status).toBe('fail');
    const duplicates = result.body.filter(line => line.includes('DUPLICATE_ID:'));
    expect(duplicates).toHaveLength(5);
    for (const source of ['docs/todos/wi-a1b2c3.md', 'docs/todos/wi-aabbcc.md', 'ROADMAP.md Track 1A', 'docs/roadmap-future.md', 'docs/roadmap-shipped.md Track 2A']) {
      expect(duplicates.some(line => line.includes(source))).toBe(true);
    }
  });

  test('missing IDs fail on both legacy records and intake files with a migration hint', () => {
    const parsedTodos = parseTodos('## Unprocessed\n### [manual] Existing\n').value;
    const legacyOnly = runCheckWorkItemIds(makeCtx({ parsedTodos }));
    expect(legacyOnly.status).toBe('fail');
    expect(legacyOnly.body).toContain(
      '- Hint: run `bin/roadmap-id migrate` to assign work-item IDs to existing records.',
    );
    const result = runCheckWorkItemIds(makeCtx({ parsedTodos, intakeFiles: [record('wi-a1b2c3')] }));
    expect(result.status).toBe('fail');
    expect(result.body.join('\n')).toContain('MISSING_ID: docs/todos/wi-a1b2c3.md');
    expect(result.body).toContain(
      '- Hint: run `bin/roadmap-id migrate` to assign work-item IDs to existing records.',
    );
  });

  test('checks and reserves both IDs when the filename and body disagree', () => {
    const result = runCheckWorkItemIds(makeCtx({
      intakeFiles: [record('wi-a1b2c3', 'wi-abcdef'), record('wi-abcdef', 'wi-abcdef')],
    }));
    expect(result.status).toBe('fail');
    expect(result.body.join('\n')).toContain('ID_MISMATCH: docs/todos/wi-a1b2c3.md');
    expect(result.body.join('\n')).toContain('DUPLICATE_ID: docs/todos/wi-abcdef.md');
  });
});
