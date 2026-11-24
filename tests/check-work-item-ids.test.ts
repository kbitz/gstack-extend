import { describe, expect, test } from 'bun:test';

import { runCheckWorkItemIds } from '../src/audit/checks/work-item-ids.ts';
import { mergeShippedArchive, parseRoadmap } from '../src/audit/parsers/roadmap.ts';
import { parseTodos } from '../src/audit/parsers/todos.ts';
import { makeCtx } from './helpers/audit-ctx.ts';

describe('runCheckWorkItemIds', () => {
  test('skips when zero inspectable records exist', () => {
    const ctx = makeCtx({});
    const res = runCheckWorkItemIds(ctx);
    expect(res.section).toBe('WORK_ITEM_IDS');
    expect(res.status).toBe('skip');
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

  test('fails on missing, malformed, and cross-document duplicate IDs (including Completed and archive collisions)', () => {
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
    expect(joined).toContain('bin/roadmap-id migrate');
  });
});
