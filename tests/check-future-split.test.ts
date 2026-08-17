import { describe, expect, test } from 'bun:test';
import { runCheckFuture } from '../src/audit/checks/future.ts';
import { runCheckStateSections } from '../src/audit/checks/state-sections.ts';
import { makeCtx } from './helpers/audit-ctx.ts';

const LIVE = `# Roadmap

## In Progress

## Current Plan

## Future

Deferred: docs/roadmap-future.md (1 items)

## Shipped

History: docs/roadmap-shipped.md
`;

const SATELLITE = `# Future

## Future

- **Keep the context** — filed from a review. More detail lives here.
`;

describe('runCheckFuture split states', () => {
  test('pointer + matching file passes', () => {
    const ctx = makeCtx({
      roadmap: LIVE,
      paths: { roadmap: 'docs/ROADMAP.md', futureArchive: 'docs/roadmap-future.md' },
    });
    ctx.files.futureArchive = SATELLITE;
    const r = runCheckFuture(ctx);
    expect(r.status).toBe('pass');
    expect(r.body.join('\n')).toContain('FUTURE_BULLET_COUNT: 1');
    expect(r.body.join('\n')).toContain('FUTURE_SOURCE: file');
  });

  test('pointer without file fails FUTURE_FILE_MISSING', () => {
    const ctx = makeCtx({
      roadmap: LIVE,
      paths: { roadmap: 'docs/ROADMAP.md', futureArchive: null },
    });
    const r = runCheckFuture(ctx);
    expect(r.status).toBe('fail');
    expect(r.body.join('\n')).toContain('FUTURE_FILE_MISSING');
  });

  test('file without pointer fails FUTURE_POINTER_MISSING', () => {
    const ctx = makeCtx({
      roadmap: `# Roadmap\n\n## Future\n\n## Shipped\n`,
      paths: { roadmap: 'docs/ROADMAP.md', futureArchive: 'docs/roadmap-future.md' },
    });
    ctx.files.futureArchive = SATELLITE;
    const r = runCheckFuture(ctx);
    expect(r.status).toBe('fail');
    expect(r.body.join('\n')).toContain('FUTURE_POINTER_MISSING');
  });

  test('bullets on both sides fail SPLIT_INCOMPLETE', () => {
    const ctx = makeCtx({
      roadmap: `# Roadmap\n\n## Future\n\n- **Inline** — leftover.\n`,
      paths: { roadmap: 'docs/ROADMAP.md', futureArchive: 'docs/roadmap-future.md' },
    });
    ctx.files.futureArchive = SATELLITE;
    const r = runCheckFuture(ctx);
    expect(r.status).toBe('fail');
    expect(r.body.join('\n')).toContain('SPLIT_INCOMPLETE');
  });

  test('count mismatch fails', () => {
    const ctx = makeCtx({
      roadmap: LIVE.replace('(1 items)', '(9 items)'),
      paths: { roadmap: 'docs/ROADMAP.md', futureArchive: 'docs/roadmap-future.md' },
    });
    ctx.files.futureArchive = SATELLITE;
    const r = runCheckFuture(ctx);
    expect(r.status).toBe('fail');
    expect(r.body.join('\n')).toContain('FUTURE_COUNT_MISMATCH');
  });

  test('satellite without ## Future fails MALFORMED', () => {
    const ctx = makeCtx({
      roadmap: LIVE,
      paths: { roadmap: 'docs/ROADMAP.md', futureArchive: 'docs/roadmap-future.md' },
    });
    ctx.files.futureArchive = '# Future\n\n- **Orphan** — no H2, parser will miss this.\n';
    const r = runCheckFuture(ctx);
    expect(r.status).toBe('fail');
    expect(r.body.join('\n')).toContain('FUTURE_FILE_MALFORMED');
  });

  test('0-item split with empty satellite passes', () => {
    const ctx = makeCtx({
      roadmap: LIVE.replace('(1 items)', '(0 items)'),
      paths: { roadmap: 'docs/ROADMAP.md', futureArchive: 'docs/roadmap-future.md' },
    });
    ctx.files.futureArchive = '# Future\n\n## Future\n';
    const r = runCheckFuture(ctx);
    expect(r.status).toBe('pass');
    expect(r.body.join('\n')).toContain('FUTURE_BULLET_COUNT: 0');
    expect(r.body.join('\n')).toContain('FUTURE_SOURCE: file');
  });

  test('legacy inline bullets still pass', () => {
    const ctx = makeCtx({
      roadmap: `# Roadmap\n\n## Future\n\n- **Old style** — still inline.\n`,
      paths: { roadmap: 'docs/ROADMAP.md', futureArchive: null },
    });
    const r = runCheckFuture(ctx);
    expect(r.status).toBe('pass');
    expect(r.body.join('\n')).toContain('FUTURE_BULLET_COUNT: 1');
    expect(r.body.join('\n')).not.toContain('FUTURE_SOURCE');
  });
});

describe('runCheckStateSections shipped pointer', () => {
  test('empty satellite plus live bullets says copy, not delete', () => {
    const ctx = makeCtx({
      roadmap: `# Roadmap\n\n## Future\n\n- **Inline** — leftover.\n\nDeferred: docs/roadmap-future.md (1 items)\n`,
      paths: { roadmap: 'docs/ROADMAP.md', futureArchive: 'docs/roadmap-future.md' },
    });
    ctx.files.futureArchive = '# Future\n\n## Future\n';
    const r = runCheckFuture(ctx);
    expect(r.status).toBe('fail');
    expect(r.body.join('\n')).toContain('SPLIT_INCOMPLETE');
    expect(r.body.join('\n')).toContain('Do not delete the live bullets');
  });

  test('archive without History: pointer fails SHIPPED_POINTER_MISSING', () => {
    const ctx = makeCtx({
      roadmap: `# Roadmap\n\n## In Progress\n\n## Current Plan\n\n## Future\n\n## Shipped\n`,
      paths: { roadmap: 'docs/ROADMAP.md', shippedArchive: 'docs/roadmap-shipped.md' },
      parsedRoadmap: { hasV2Grammar: true, shippedPointer: false },
    });
    const r = runCheckStateSections(ctx);
    expect(r.status).toBe('fail');
    expect(r.body.join('\n')).toContain('SHIPPED_POINTER_MISSING');
  });

  test('History pointer without file fails SHIPPED_FILE_MISSING', () => {
    const ctx = makeCtx({
      roadmap: `# Roadmap\n\n## Shipped\n\nHistory: docs/roadmap-shipped.md\n`,
      paths: { roadmap: 'docs/ROADMAP.md', shippedArchive: null },
      parsedRoadmap: { hasV2Grammar: true, shippedPointer: true },
    });
    const r = runCheckStateSections(ctx);
    expect(r.status).toBe('fail');
    expect(r.body.join('\n')).toContain('SHIPPED_FILE_MISSING');
  });
});
