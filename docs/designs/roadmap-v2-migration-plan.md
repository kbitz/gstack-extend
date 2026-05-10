# Roadmap v2 — migration plan (for a future session)

The v2 state-section model ships alongside v1 as `/roadmap-new` (see
`docs/designs/roadmap-v2-state-model.md` for the spec). When the user
decides v2 is proven, run this migration to make it the only model.

## Trigger conditions (when to do this)

Wait for an explicit "let's migrate now" from the user. Don't volunteer it.
Reasonable signals that v2 is proven:

- `/roadmap-new` has been used on real projects (managua, bolt, etc.)
- No structural failures the user wants to walk back (e.g. no "I miss the
  v1 surgical reassessment")
- v1 `/roadmap` has been unused for several weeks across the user's
  workspaces

## Migration steps

### 1. Promote `/roadmap-new` → `/roadmap`

```sh
git -C <repo> mv skills/roadmap-new.md skills/roadmap.md
```

The frontmatter `name:` field updates to `roadmap`. The body's title line
updates to `# /roadmap — Plan Regeneration`. Drop the "ships alongside the
v1 skill" paragraph; it's no longer relevant.

### 2. Drop v1 from setup

In `setup`, remove `roadmap-new` from `SKILLS=( … )`. The line for
`roadmap` stays.

### 3. Drop the v2-grammar gate from the audit

In `src/audit/checks/structure.ts`, remove the `if (ctx.roadmap.value.hasV2Grammar)`
wrapper around the intra-Group dep ban, PR-split ban, and Hotfix
invariants. These become unconditional structural checks.

### 4. Strip v1 compat code from the parser

In `src/audit/parsers/roadmap.ts`:

- Drop `serialize` and `hasPreflight` fields from `GroupInfo`.
- Drop the `_serialize: true_` parsing block.
- Drop the `**Pre-flight**` parsing block.
- Drop the post-parse implicit-dep generation for serialized groups.

In `src/audit/checks/style-lint.ts`:

- Drop the Pre-flight-in-single-Track-Group warning (item 4).

In `src/audit/checks/collisions.ts`:

- Drop the `g.serialize && tracks.length >= 2` block that emits
  `SERIALIZED_GROUPS:` notes.
- Drop the `trackDependsOn(...)` dep-skip in the collision pair loop. With
  the v2-only intra-Group dep ban now unconditional, there are no deps to
  skip.

In `src/audit/checks/structural-fitness.ts` and `task-list.ts`:

- The PREFLIGHT_RE regexes can stay (harmless if no Pre-flight markers
  appear) or be dropped for cleanliness.

### 5. Delete `bin/roadmap-revise`

The split-track helper isn't used by v2. The file was kept for v1 compat
and can be deleted unconditionally.

### 6. Drop v1-only test fixtures

Look for fixtures whose entire purpose is testing v1 behavior:

- `tests/roadmap-audit/preflight-single-track/` — purely v1 Pre-flight
  test. Delete it.

Other fixtures (good-canonical, structure-violations, etc.) use v1 grammar
input but exercise checks that still apply to v2. Keep them but consider
porting their input ROADMAP.md to v2 grammar for clarity.

### 7. Drop v1 fast-path block from the prose corpus

`tests/fixtures/skill-prose-corpus/1-roadmap-reassessment.md` is calibrated
on the v1 surgical-reassessment voice. After migration, regenerate it from
a real `/roadmap` regeneration run.

### 8. Strip the MIGRATION_NEEDED branch from `state-sections.ts`

In `src/audit/checks/state-sections.ts`, the `if (grammar === 'v1')` block
emits `MIGRATION_NEEDED: warn`. Once v1 is gone, replace with a hard fail
(or drop entirely if you trust the regenerator to always produce v2).

### 9. Update `lib/state.ts` v2-trigger logic

The current trigger for v2 mode requires Shipped/In Progress/Current Plan
(Future alone is ambiguous since v1 had it). After migration this
ambiguity is gone — v2 is the only model. Simplify
`detectStateRegions()` to treat any of the four state sections as a v2
trigger, or just always return `kind: 'v2'` if a roadmap exists.

### 10. Test fixture regeneration

Run `UPDATE_SNAPSHOTS=1 bun test tests/audit-snapshots.test.ts` to
regenerate snapshots after all the above. Expect the v1 fixtures to
either be dropped (step 6) or to flag the v1-grammar inputs as
fail/error (since we no longer accept them).

### 11. Migrate active projects' ROADMAP.md to v2

This happens at the project level, not in this repo. The first `/roadmap`
run on each project after migration will detect v1 grammar (now hard
fail) and refuse to proceed without first regenerating. The user runs
`/roadmap` manually on each project that needs it; the regen converts
shipped Groups to `## Shipped` entries and rebuilds the upcoming plan.

Plan to migrate: managua (this repo), bolt main + active workspaces, any
other gstack-extend consumer projects.

### 12. Final cleanup

- Drop `docs/designs/roadmap-v2-state-model.md`'s "ships alongside v1"
  language.
- Drop this migration-plan doc (`roadmap-v2-migration-plan.md`).
- Update CHANGELOG with the migration entry.

## What NOT to do

- Don't delete `docs/designs/roadmap-v2-state-model.md` — keep it as the
  living spec for the v2 model after migration. It's the source of truth
  for the audit and skill prose.
- Don't try to back-port v2 features (Hotfix-as-Group, state sections) to
  the v1 skill. v1 is meant to be retired, not extended.
