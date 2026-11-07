# Collision Contract

Version: `collision-contract/v1`

This contract defines the scheduling collision rule that decides whether two Track `_touches:` lists collide. It is used by `bin/roadmap-pack` and by `bin/roadmap-audit`'s `PACKING`, `COLLISIONS`, and `STYLE_LINT` sections (`src/audit/lib/pack.ts`, `COLLISION_CONTRACT = 'collision-contract/v1'`).

## What the rule decides

Given two `_touches:` token lists `a` and `b` and an optional project shared-doc list `shared_docs`, the rule decides:
- `collide`: whether the two Tracks touch overlapping scheduling paths and therefore cannot be packed into the same parallel launch Group.
- `folder_only`: whether the pair collides solely through folder entries (`true` when matches exist and none is an exact file-to-file match).

## Normalization

Each raw `_touches:` entry is normalized before matching (`normalizeTouch`):
1. Trim leading and trailing ASCII whitespace (`[ \t\v\f\r]`).
2. If the entry ends with a `(new)` marker (`/[ \t\v\f\r]*\(new\)[ \t\v\f\r]*$/i`, case-insensitive), record `isNew = true` and strip the suffix. Otherwise `isNew = false`.
3. Trim leading and trailing ASCII whitespace again.
4. If the remaining string ends with `/`, record `dir = true` (a folder entry) and collapse one or more trailing slashes to a single `/`. Otherwise `dir = false`.
5. Drop empty entries (`path === ""`).

## Shared documentation exclusions

Shared documentation paths are removed from scheduling touches before matching.

### Fixed shared docs (`SHARED_DOC_PATHS`)

The following paths (and their trailing-slash stripped forms) are always excluded from scheduling collisions:
- `docs/ROADMAP.md`
- `docs/TODOS.md`
- `docs/PROGRESS.md`
- `docs/roadmap-shipped.md`
- `docs/roadmap-future.md`
- `ROADMAP.md`
- `TODOS.md`
- `PROGRESS.md`
- `CHANGELOG.md`
- `VERSION`

### Project marker (`roadmap:shared_docs=`)

A project may declare additional shared documentation files in `CLAUDE.md`. `bin/roadmap-pack` and `bin/roadmap-audit` read the same file: repo-root `CLAUDE.md` when it is a regular file (even an empty one), otherwise `docs/CLAUDE.md`.

```markdown
<!-- roadmap:shared_docs=AGENTS.md,docs/runbook.md -->
```

Parsing and entry rules (`sharedDocsMarker`):
- A marker starts with `<!--`, optional whitespace, then `roadmap:shared_docs=`, so a bare prose or inline-code mention of `roadmap:shared_docs=` is not a marker. The parser does not read Markdown structure: as with `parallelism_cap`, a full `<!-- roadmap:shared_docs=... -->` form inside a code span or fenced block still counts. The first marker in the file wins, so put the real marker before any example of it.
- The value runs to the first whitespace character or `-->` and is split on `,`, with each entry trimmed and empty entries dropped. Missing or empty markers yield `[]`.
- Each listed entry is normalized with `normalizeTouch`:
  - Empty entries are ignored.
  - Folder entries (`dir === true`, ending with `/`) are ignored so a directory prefix cannot erase scheduling collisions.
  - `CLAUDE.md` and `docs/CLAUDE.md` are ignored so the `COLLISIONS` one-owner-per-Group rule remains enforced. The check compares these literal paths only: when `CLAUDE.md` is a symlink (for example to `AGENTS.md`), do not list its target, or Tracks that edit the project instructions run in parallel.
  - Remaining file paths are excluded from scheduling touches before matching, alongside `SHARED_DOC_PATHS`. Remaining conflicts in listed docs are left to the base merge.

## Match rule and `(new)` exemption

After filtering out empty entries and shared docs, each normalized entry `x` from `a` is compared symmetrically against each normalized entry `y` from `b`:

1. **Equal paths (`x.path === y.path`)**:
   - Always match, regardless of `isNew`.
   - If neither side is a folder entry (`!x.dir && !y.dir`), the match kind is `'file'`.
   - Otherwise (folder entry), the match kind is `'folder'`.
2. **Folder prefix (`x.path !== y.path`)**:
   - A folder entry `F` (`F.dir === true`) matches a path `P` under it (`P.path.startsWith(F.path)`), **unless** `P` is marked new (`P.isNew === true`) and `F` is not (`F.isNew === false`).
   - All folder prefix matches have kind `'folder'`.

This rule is symmetric in `a` and `b`:
- A new file (`src/audit/new-check.ts (new)`) or new subfolder (`src/audit/sub/ (new)`) does **not** collide with an existing parent folder entry (`src/audit/`).
- A new file (`src/audit/new-check.ts (new)`) **does** collide with the same file path (`src/audit/new-check.ts` or `src/audit/new-check.ts (new)`).
- Any path under a folder entry that is itself marked new (`src/audit/ (new)`) **does** collide with that folder entry.

The `(new)` marker is trusted: nothing checks that the path is absent from the repository. A `(new)` marker on an existing file removes its collision with a folder entry above it, and the conflict surfaces at merge.

## `collisionKind` and `folder_only`

From the set of matches between `a` and `b`:
- `'none'`: no matches exist (`collide = false`, `folder_only = false`).
- `'file'`: at least one match has kind `'file'` (`collide = true`, `folder_only = false`).
- `'folder-only'`: at least one match exists and no match has kind `'file'` (`collide = true`, `folder_only = true`). This includes two Tracks naming the same folder entry (`src/audit/` vs `src/audit/`).

## What this contract does not decide

- Explicit `_blocked-by:` Track ordering edges.
- `packIdent` FFD tie-breaking and Track/bin ordering.
- The `COLLISIONS` audit rule that at most one Track per Group may claim `CLAUDE.md` or `docs/CLAUDE.md`.
- `bin/roadmap-touches` (`drift` and `report-cross-group`) folder-prefix coverage.

## Conformance vectors (`tests/fixtures/collision-vectors.json`)

The canonical conformance suite lives in `tests/fixtures/collision-vectors.json`:

```json
{
  "schema": "collision-vectors/v1",
  "contract": "collision-contract/v1",
  "vectors": [
    {
      "name": "...",
      "case": "exact | folder | folder-only | new | shared-doc",
      "a": ["..."],
      "b": ["..."],
      "shared_docs": ["..."],
      "collide": true,
      "folder_only": false
    }
  ]
}
```

How an implementation runs the vector file:
1. Assert `schema === "collision-vectors/v1"` and `contract === "collision-contract/v1"`.
2. For every vector, evaluate **both** argument orders: `(a, b)` and `(b, a)` with `shared_docs`.
3. Assert that `collide` and `folder_only` match the vector in both argument orders.

## Version bump rule

Any change that alters a `collide` or `folder_only` outcome for any input pair is a breaking contract change and requires bumping `Version` / `COLLISION_CONTRACT` (for example, to `collision-contract/v2`) and updating `tests/fixtures/collision-vectors.json`.
