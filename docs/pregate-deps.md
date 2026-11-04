# `pregate-deps` — Python source-root dependency maps for `.gstack/pregate.json`

Upstream `gstack-pregate` (`lib/pregate/import-graph.ts`) resolves Python `import` and `from … import` statements from the repository root only. In repositories that place packages under a source root such as `src/<pkg>`, imports like `import pkg.alpha` or `from pkg import beta` do not resolve to `src/pkg/alpha.py` or `src/pkg/beta.py` without explicit `.gstack/pregate.json` `dependencies` entries.

`bin/pregate-deps` is an opt-in helper that scans a repository's tracked and untracked-unignored Python files, computes the transitive test-file closure for modules under declared source roots, and writes or checks those entries in `.gstack/pregate.json` `dependencies`.

Nothing in `setup`, hooks, or any skill runs `pregate-deps` automatically, and `pregate-deps` never runs `gstack-pregate`.

## Usage

Run the helper by its installed path from inside the consumer Git repository:

```sh
~/.claude/skills/gstack-extend/bin/pregate-deps --check
~/.claude/skills/gstack-extend/bin/pregate-deps
~/.claude/skills/gstack-extend/bin/pregate-deps --prune
```

### Flags

- `--check`: Compare `.gstack/pregate.json` against the derived map without modifying any files.
- `--prune`: Allow write mode to remove stale owned keys or stale test paths inside an owned key's list. Without `--prune`, a write may only add keys and values.
- `--root DIR`: Declare a source root directory relative to the repository root (repeatable; defaults to `src`). Trailing `/` is stripped. Empty values, `.`, absolute paths, and `..` segments are rejected as usage errors. Pass the same `--root` flags to `--check` and write runs:
  ```sh
  ~/.claude/skills/gstack-extend/bin/pregate-deps --root src --root lib --check
  ~/.claude/skills/gstack-extend/bin/pregate-deps --root src --root lib
  ```
- `--help`, `-h`: Print the CLI usage, ownership rule, output lines, and exit codes.

## Which edges count

`pregate-deps` reads `.py` files from `git ls-files -co --exclude-standard -z` (excluding `node_modules/`, non-regular files, symlinks escaping the repository, and files over 2 MiB) and mirrors upstream's Python import rules:

1. **Import statements**: `import a.b as c, d` and `from X import (...)` (including multi-line parenthesized imports and backslash line continuations), after blanking string literals and stripping `#` comments. `from X import a` records edges to both `X` and `X.a`.
2. **Module and package resolution**: An absolute module `a.b` resolves against the repository root and each declared `--root DIR` to `<base>/a/b/__init__.py` and `<base>/a/b.py`, plus every ancestor `__init__.py` under `<base>` when found. Relative imports (`from .beta import VALUE`) resolve from the importing file's directory against the repository root and are ignored if they climb above the repository root.
3. **Dotted `mock.patch` string literals**: In Python files under `test/`, `tests/`, `spec/`, `__tests__/`, `bin/`, or named as test files (`test_*.py` or `*_test.py`), quoted dotted identifiers such as `"pkg.beta.VALUE"` resolve to the longest prefix that matches a module under the repository root or any declared root.
4. **Transitive closure**: For each non-test `.py` file under a declared root, `pregate-deps` walks reverse dependencies breadth-first through non-test Python files (including shared test helpers such as `tests/helpers.py`) with no depth cap, collecting terminal Python test files (`test_*.py` and `*_test.py`). Modules with at least one reaching test file are emitted with sorted keys and sorted test lists.

## Ownership rule and `--prune`

A key in `.gstack/pregate.json` `dependencies` is **owned** when all of the following hold:

- It contains no `*` or `?` glob characters.
- It ends in `.py`.
- It lies under a declared root (`<root>/...`).
- It is not a Python test file (`test_*.py` or `*_test.py`).
- Its value is a non-empty array of test file paths.

Every **unowned** entry is preserved verbatim: glob patterns (`src/pkg/data/*.json`, `src/pkg/alpha*.py`), paths outside declared roots (`scripts/tool.py`), non-Python keys, test files, and empty-array no-lane declarations (`"src/pkg/orphan.py": []`).

### Protecting existing entries and adding hand-written edges

Run `--check` before the first write to inspect `MISSING` and `STALE` edges.

- **Plain write (`pregate-deps` without `--prune`)**: May only add keys and values. If writing the derived map would remove any value already present in `.gstack/pregate.json` — either a whole owned key that no longer has importers or any test path in an owned key's list — `pregate-deps` refuses with exit code `2`, writes nothing, and names every `<key> -> <test>` it would remove.
- **Prune write (`pregate-deps --prune`)**: Replaces owned entries with the derived map, removing stale owned keys and stale test paths from owned keys' lists, and prints `REMOVED <key> -> <test>` for each removed edge.
- **Hand-written edges on owned modules**: If a module under a declared root needs a manual edge that static import scanning cannot see, declare it under a glob pattern key such as `"src/pkg/alpha*.py": ["tests/test_extra.py"]`. Because pattern keys contain `*`, they are unowned and survive both plain writes and `--prune` writes, and `gstack-pregate` unions all matching declarations.

After updating `.gstack/pregate.json`, run `gstack-pregate validate` to confirm the policy file passes upstream schema validation.

## Output format and exit codes

### `--check` mode

Prints sorted diff lines, a summary count, and the final status:

- `MISSING <key> -> <test>`: Derived edge not present in `.gstack/pregate.json`.
- `STALE <key> -> <test>`: Owned edge in `.gstack/pregate.json` no longer derived from imports (including edges only `--prune` can remove).
- `ENTRIES: <n> generated, <m> kept`
- `STATUS: current` (exit `0`) or `STATUS: stale` (exit `1`). Comparison is semantic: key order and JSON formatting alone never mark a file stale.

### Write mode

- When no semantic change exists, leaves `.gstack/pregate.json` untouched on disk and prints `STATUS: unchanged` (exit `0`).
- When changes exist (and `--prune` is supplied if any owned edge is removed), rewrites `.gstack/pregate.json` as 2-space JSON with other top-level keys kept in place and `dependencies` keys sorted, then prints:
  - `ADDED <key> -> <test>` for each added edge
  - `REMOVED <key> -> <test>` for each pruned edge
  - `NOTE: .gstack/pregate.json now declares lanes; pregate will fail a touched file with no lane.` when the file previously had none of the lane-declaring keys (`dependencies`, `empty_lanes`, `selection`, `local`)
  - `STATUS: written` (exit `0`)

### Refusals

All usage and validation refusals write `ERROR <code>: <detail>` and `FIX: <action>` to `stderr`, leave `.gstack/pregate.json` untouched, and exit `2` (for example: outside a Git work tree, missing `--root` directory, missing `.gstack/pregate.json` where `FIX:` recommends `gstack-pregate init`, invalid JSON or `dependencies` shape, stale owned entries without `--prune`, or exceeding upstream's 256-entry / 256-character caps).

### Exit codes

- `0`: Written, unchanged, or current (`--check`).
- `1`: Stale map (`--check` only).
- `2`: Usage error or refusal (nothing written).

## Limits and base-branch behavior

- **Upstream size caps**: `gstack-pregate` rejects `dependencies` maps with more than 256 entries or paths over 256 characters (`lib/pregate/config.ts`, `lib/ship-policy.ts`). `pregate-deps` enforces both caps before writing and exits `2` on overflow.
- **Edges outside static root-layout equivalence**: `conftest.py` implicit fixture autoloading, `importlib.import_module(...)`, Django framework string loads, pytest sibling-directory `import helpers` without package qualification, and chains through non-Python files remain hand-written declarations.
- **Base-branch policy reading**: `gstack-pregate` reads `.gstack/pregate.json` from the base branch by default, so a newly generated map takes effect on default pregate runs after the PR merges. On the PR that adds lanes to `.gstack/pregate.json`, pass `--policy-from head` to `gstack-pregate`.
- **First lane declaration (`NOTE:`)**: Adding `dependencies` to a `.gstack/pregate.json` that previously had none of `dependencies`, `empty_lanes`, `selection`, or `local` activates lane enforcement in `gstack-pregate`, turning touched files without a lane into hard `PREGATE_NO_LANE` failures.

## Qualification

Qualified against installed upstream `gstack` `1.94.39.0` on `2026-11-04`:

- Materialized `tests/fixtures/pregate-deps/src-layout/` as two Git repositories: the `src/` layout updated by `bin/pregate-deps --prune`, and a root-layout mirror with `src/*` moved to the repository root and empty `dependencies`.
- Imported `buildGraph` and `testsFor` from `~/.claude/skills/gstack/lib/pregate/import-graph.ts`.
- Verified that `src/pkg/beta.py` selected no tests with hand-written entries alone and selected `tests/test_alpha.py`, `tests/test_gamma.py`, and `tests/test_patch.py` after `bin/pregate-deps` wrote the map.
- Verified across every non-test module under `src/` (`src/pkg/__init__.py`, `src/pkg/alpha.py`, `src/pkg/beta.py`, `src/pkg/gamma.py`, `src/pkg/sub/__init__.py`, `src/pkg/sub/delta.py`, and `src/pkg/orphan.py`) that the `src/` layout selection with the generated declarations contained every test selected by the root-layout mirror.

Repeat when installed gstack changes.
