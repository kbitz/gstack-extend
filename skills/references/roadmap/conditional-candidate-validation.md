# /roadmap reference: Shipped-Track reconciliation examples, complete-candidate validation, and recovery

## From Common path

**Illustrative start/evidence**, not a claim about PR #109: Group 22 contains
landed 22A and unfinished 22B; Group 23 contains unfinished 23A, with disjoint
`src/a.ts`, `src/b.ts`, `src/c.ts` and cap 2. The legacy active start parses as:

```markdown
## Current Plan
### Group 22: Partial shipment
_Depends on: none_
#### Track 22A: Record landed work ✓ Shipped (v1.2.3.0)
_1 task . ~50 LOC . low risk_
_touches: src/a.ts_
- Record the landed task (~50 lines).
#### Track 22B: Second remaining
_1 task . ~50 LOC . low risk_
_touches: src/b.ts_
- Finish the second task (~50 lines).
### Group 23: Third work
_Depends on: none_
#### Track 23A: Third remaining
_1 task . ~50 LOC . low risk_
_touches: src/c.ts_
- Finish the third task (~50 lines).
```

| Active ID | Canonical land-time ID | Attributable closure evidence | Dated lineage |
|-----------|------------------------|-------------------------------|---------------|
| 22A | 22A | illustrative approved plan, all acceptance met; merged PR #109 / abc1234 | 2026-10-01: original Group 22 |

Append a receipt of this exact shape using verified identity/evidence, even after an earlier archived Group. The H2 resets
Group context; never claim the whole original Group shipped:

```markdown
## Individual Track history

### Track 22A: Record landed work ✓ Shipped (v1.2.3.0)
- 2026-10-01: merged PR #109 (commit abc1234); verified land-time Track 22A, original Group 22.
```

Use the attributable historical release version when available. Otherwise use
bare `✓ Shipped` and include `release version unknown` in the dated evidence;
never invent a version or use today's VERSION for old work. Preserve existing
archive bytes and both roadmap pointers. Once no pinned active Group uses 22,
append a new `## Individual Track history` section with `_tombstone: 22_`
immediately after the H2, outside any Track body. While Group 22 is pinned,
omit that tombstone but reserve prefix 22 for new Groups and skip archived 22A.
Parser `groupNum: 0` on an independent receipt is a placeholder, not a Group
to allocate, freeze or tombstone.

**Remainder preview.** With no pins, map old `22B=23A,23A=23B` in one atomic
pass, reserving retired 22. This example's cap 2 (and default cap 6) yields one
bin, no dependencies. Use the caller's actual cap/output if different.

## From Complete-candidate validation

Save active/archive drafts and this temporary Bun script **outside the workspace**
in the durable proposal directory or scratch. Run it with four explicit absolute
arguments: project root, resolved extend root, active draft, archive draft.
It reads real Git/version/cap/scaffold metadata, overlays raw docs, reparses
phases, merges shipped/Future history and replaces markdown snapshots; it never
writes live files. This closure-only recipe requires every other artifact to remain byte-unchanged,
including TODOS and the Future satellite even when its pointer count is unchanged.
A selected trigger migration validates its Future draft with the snippet in Deferred work.
It preserves Future/scaffold declarations.
For wider regeneration overlay **every** changed artifact and rebuild all its
derived context (inbox, Future, design docs, existence/scaffold maps, etc.), or
defer both writes. Test stub metadata and live write-and-restore are insufficient.

```typescript
import { isAbsolute, join, relative } from 'node:path'
const [repoRoot, extendRoot, activeDraftPath, archiveDraftPath] = process.argv.slice(2)
if (![repoRoot, extendRoot, activeDraftPath, archiveDraftPath].every(p => p && isAbsolute(p))) throw new Error('Four absolute paths required')
const { buildAuditCtx, runAudit } = await import(join(extendRoot, 'src/audit/cli.ts'))
const { parseRoadmap, mergeShippedArchive, mergeFutureArchive } = await import(join(extendRoot, 'src/audit/parsers/roadmap.ts'))
const { parsePhases } = await import(join(extendRoot, 'src/audit/parsers/phases.ts'))
const { CANONICAL_SECTIONS, parseAuditSections } = await import(join(extendRoot, 'src/audit/sections.ts'))
const base = buildAuditCtx({ repoRoot, extendDir: extendRoot, argv: { repoRoot, scanState: false, futureIndex: false, prompt: null } })
if (!base.paths.roadmap) throw new Error('No live roadmap; use the greenfield flow')
const active = await Bun.file(activeDraftPath).text()
const archive = await Bun.file(archiveDraftPath).text()
const futureBody = text => text.split(/^## Future(?:[ \t].*)?$/m)[1]?.split(/^## /m)[0] ?? ''
if (futureBody(active) !== futureBody(base.files.roadmap)) throw new Error('Future changed; rebuild complete context')
const ctx = { ...base, paths: { ...base.paths }, files: { ...base.files } }
ctx.paths.shippedArchive ??= join(repoRoot, 'docs/roadmap-shipped.md')
ctx.files.roadmap = active
ctx.files.shippedArchive = archive
const rawArchive = parseRoadmap(archive)
ctx.roadmap = mergeFutureArchive(mergeShippedArchive(parseRoadmap(active), rawArchive), parseRoadmap(base.files.futureArchive))
ctx.phases = parsePhases(active)
const scaffolds = parsed => parsed.value.phases.flatMap(p => p.scaffoldPaths.map(path => p.num + '|' + path)).sort()
if (JSON.stringify(scaffolds(ctx.phases)) !== JSON.stringify(scaffolds(base.phases))) throw new Error('Scaffolds changed; rebuild complete context')
const replacements = new Map([[ctx.paths.roadmap, active], [ctx.paths.shippedArchive, archive]])
ctx.mdFiles = base.mdFiles.map(file => ({ ...file, content: replacements.get(file.abs) ?? file.content }))
for (const [path, content] of replacements) {
  if (!ctx.mdFiles.some(file => file.abs === path)) ctx.mdFiles.push({ abs: path, rel: relative(repoRoot, path), content })
}
const report = runAudit(ctx)
console.log(report)
console.log('RAW ARCHIVE DIAGNOSTICS', JSON.stringify({ errors: rawArchive.errors, warnings: rawArchive.value.styleLintWarnings }))
console.log('MERGED DIAGNOSTICS', JSON.stringify({ errors: ctx.roadmap.errors, warnings: ctx.roadmap.value.styleLintWarnings }))
const sections = parseAuditSections(report)
if (!CANONICAL_SECTIONS.every(name => sections.some(s => s.name === name))) throw new Error('Incomplete audit section coverage')
const blockers = new Set(['SIZE', 'COLLISIONS', 'PACKING', 'STRUCTURE', 'STATE_SECTIONS', 'VERSION', 'GROUP_DEPS', 'PARALLELISM_BUDGET', 'FUTURE'])
if (rawArchive.errors.length || sections.some(s => blockers.has(s.name) && s.body.includes('STATUS: fail'))) process.exit(1)
```

## From Exceptions and recovery

- **Historical identity/completion:** land as 16D, later relabel to 18B, then
  regenerate after a newer roadmap commit: receipt ID is verified land-time
  16D, with dated original/current lineage. Scan back to introduction, not the
  last run. Missing/shallow history or inaccessible identity/approval evidence
  needs supplied proof or refusal before recycling. A merged-but-incomplete
  Track stays active with the exact missing obligations, unless attributable
  user scope reduction supplies the closure proof.
- **Duplicates/collisions:** inspect raw archive parser errors/warnings and
  candidate bodies; archive merge omits raw duplicate warnings. Same ID/evidence
  with verified work already inactive is a no-op. Same work still active after
  archive-first interruption means **resume** removal/repack without appending.
  An unrelated reused ID, contradictory evidence or unresolved raw duplicate is
  refusal; active-wins collision warnings never authorize closure. Do not rewrite
  old history to hide a conflict.
- **Pins:** one computed bin with one pinned owning Group keeps that label and
  frozen Track IDs, backfilling fresh letters (22B stays, incoming old 23A becomes
  22C, skipping archived 22A). Two pinned Groups in one bin, or one pinned Group
  spanning bins, is incompatible. Show exact IDs, bins and named branches/PRs;
  defer active/archive edits until pin release or a user-approved compatible
  arrangement, then retry reconciliation before any later recycling.
- **Hold:** keep the active plan. Only a complete closure candidate that retains
  the current unfinished partition **and dependency output** and passes packer,
  identity/raw-history/pin gates and all blockers may apply under Hold approval.
  Allowed: retire a fully shipped/empty Group while other bins/dependencies stay
  identical. Refused: remove 22A from a partial Group when [22B | 23A] must become
  [22B,23A], or when dependency output changes. Keep both originals and the
  would-be archive append unapplied; full regeneration is required. Present the
  exact closure-only candidate with the Hold choice before it authorizes edits.
- **Legacy conversion:** on the first regeneration count inline `✓ Complete` /
  `✓ Shipped` Tracks proposed for independent receipts, verify identity/full
  scope and preview receipts plus remainder bins. Hold/refusal leaves originals
  byte-identical unless the complete no-repack candidate above qualifies. Legacy
  inline markers and v1 fallback remain parseable without a sunset; current
  writing uses independent history. Carry this policy change into later shipping
  release notes; do not update release files during regeneration.

<!-- end of skills/references/roadmap/conditional-candidate-validation.md -->
