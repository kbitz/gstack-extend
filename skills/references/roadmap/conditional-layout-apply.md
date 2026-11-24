# /roadmap reference: Layout Scaffolding preflight, execution, and post-apply verification

## From Execution (apply path)

**Preflight — fail fast, mutate nothing.** Finish this whole procedure before any `mkdir` or move, including a moves-only plan whose scaffold list is empty. The preflight set is always `docs/`, `docs/designs/`, and `docs/archive/`, including directories that already exist and were omitted from the scaffold list, plus every destination parent an approved move uses (the audited root, when the destination has no parent) and every parent absorbed from a recognized `mkdir -p` prefix.

One failing or unauthorized path means zero writes for every path. A missing or valid earlier path does not permit a later external or invalid path to be created or moved. Named external authorization does not waive a different error.

1. Run `LC_ALL=C git rev-parse --is-inside-work-tree`. Capture exit code and stderr. Only exit 128 with `not a git repository` on stderr, while `lstatSync` finds no `.git` entry at the canonical root, means not in a git repo: the move executor then uses plain `mv` for every item and still applies the plain-mv collision check. If exit is 0 and stdout is `true`, the executor branches per-item via `git ls-files`. Any other result, such as `false` from a bare repository, dubious ownership, a corrupt repo, or a `.git` entry git cannot use, HALTs before writes.
2. For every path in the preflight set, confirm it is absent (`node:fs.lstatSync` fails with `ENOENT`) or that `node:fs.statSync` reports a directory. `statSync` also reports `ENOENT` for a dangling link, so its error alone does not prove absence. A symlink to a directory passes this type check only. Step 4 decides containment, and step 5 can still refuse a tracked move through the link. A regular file, FIFO, or broken symlink HALTs. Name the path. No `mkdir` and no move runs until the entire preflight is clean.
3. For every move source: confirm the file still exists with `[ -e <quoted-src> ]` (defends against the file being deleted or moved between plan and apply). If a source has disappeared, drop it from the move list and note it in the post-apply summary; don't halt — the remaining moves are still safe.
   For each source that remains, `lstatSync` every directory component of its requested path, joined under the canonical root. If any is a symlink, or contains a `.git` entry (a submodule or nested repository), HALT the whole batch. The file lives somewhere other than its path says, or belongs to another repository; `git ls-files` reports it untracked even when it is tracked, and plain `mv` would take it out of that directory or repository with no containment check. The user moves such a file by hand. Also HALT when `realpathSync` of a source returns a different spelling than the one requested for any component: on a case-insensitive volume, git's index can hold the other spelling. Do not assume every resolver reports on-disk case.
   For every remaining move, probe the destination itself with `[ -e <quoted-dst> ]` and, as a separate call, `[ -L <quoted-dst> ]`. Any existing entry, whether file, directory, or link, HALTs the batch: `git mv` moves a file into an existing directory and still exits 0, and plain `mv` overwrites. Two moves with the same destination also HALT. A destination directory component that contains a `.git` entry HALTs too.
4. Resolve each preflight path from the canonical root, then test containment. `realpathSync` an existing directory, following its entire symlink chain. For a missing descendant, climb with `node:fs.lstatSync` only while the error code is `ENOENT`. On `EACCES`, `ELOOP`, `ENOTDIR`, or any other error, HALT instead of climbing. Stop at the first existing entry, including a symlink. A dangling symlink is a link, not an absent directory: if the requested path continues beneath that link, HALT rather than treating the child as a missing directory to create.
   `realpathSync` the nearest existing ancestor, append the missing relative components, and lexically normalize only that absent suffix. Do not create it, and do not lexically normalize a component that exists in place of resolving it. A loop, a non-directory ancestor, a permission failure, or any other resolution failure HALTs.
   A resolved path is contained only when it equals the canonical root or extends it by whole path components. `/repo-other` is outside `/repo`. Compare the components the resolver returned. Do not case-fold either side, and do not treat `realpathSync.native` as a universal case canonicalizer. If a case-variant spelling does not resolve to one definite contained or external path, HALT and tell the user the spelling to retry.
5. When step 1 found no git repository, every remaining move is plain `mv`; skip the tracking probe and continue. When step 1 exited 0, classify each source still left after step 3 with `GIT_LITERAL_PATHSPECS=1 git ls-files --error-unmatch -- <quoted-src>`, so git reads the name literally rather than as a pathspec. Exit 0 means tracked. Exit 1 means untracked. Any other exit fails closed and HALTs the batch before writes. Also run `GIT_LITERAL_PATHSPECS=1 git ls-files --stage -- 'docs' 'docs/designs'`; if it lists `docs` or `docs/designs` itself with mode `160000`, that destination parent is a submodule, even an uninitialized one, so HALT the batch. `git mv` into a submodule exits 0 and stages the submodule's deletion.
   For each tracked source, `lstatSync` every directory component of the originally requested destination, joined under the canonical root. Do not inspect only the fully resolved target, which would hide links. A component already established as absent is not a symlink. If any existing component is a symlink, HALT the whole batch: `git mv` through that link can leave an invalid index entry. The halt covers an internal link and an external link the user authorized.
   In-root directory links remain allowed for scaffold directories and in the destinations of untracked or plain moves. An external plain move still needs named-target authorization from this apply. Never replace a tracked `git mv` with plain `mv`, and never rewrite the destination to its resolved path. The per-item tracking check below still runs at execution time.

On an escape without matching named-target authorization from this apply, HALT the batch. Name the requested path, the resolved target, and the canonical root, and state that no `mkdir` or move ran. When resolution fails and there is no target, name the requested path, the root, and the actual resolver error. Do not invent a resolved path.

**Refusal format.** Every preflight refusal states the problem, the cause, that zero writes ran, and a safe next action, and points the user at the roadmap skill's Layout Scaffolding section. Illustrative shape only, not a captured run: requested `docs/`, resolved `/home/me/dotfiles/docs`, root `/repo`; nothing was written; repair the link or the permissions, or start in the audited root, and rerun. If that external directory is intentional, as with chezmoi or GNU Stow, authorize the resolved target `/home/me/dotfiles/docs` for this apply. That clears scaffold directories and untracked moves only: a tracked move through a linked directory always halts, and the user moves that file by hand. The repair is manual. Do not unlink, replace, or relocate the symlink, and do not offer a generic force bypass.

A continuation that uses new authorization reruns steps 1–5 first. Each authorized requested→resolved pair must still match. A changed target needs a new decision that names the new resolved path; the previous authorization does not write to that new destination. Declined, unanswered, and non-matching answers write nothing.

**Apply scaffold (all dirs validated, no rollback):**

Run one `mkdir -p <quoted-path>` call per missing scaffold directory, including parents absorbed from a recognized prefix, only after the preflight and only under the audited-root binding. `mkdir -p` is idempotent — already-exists is a no-op. If any `mkdir` fails (permission denied, path conflict the preflight missed), HALT and emit a partial-state summary listing completed/failed/not-attempted. Do NOT attempt rollback — the user can `rmdir` empty directories manually if they want to undo.

**Apply moves (per-item branch on git tracking):**

For each remaining move, in order, as its own call. Run the preserved `git mv -- <quoted-src> <quoted-dst>` suffix, never the compound `mkdir -p … && git mv …` suggestion.

1. If preflight found no git repository: use plain `mv` (see "plain-mv branch" below).
2. If preflight returned exit 0 (in git): run `GIT_LITERAL_PATHSPECS=1 git ls-files --error-unmatch -- <quoted-src>`. Capture exit code.
   - Exit 0: source is tracked → run the preserved quoted `git mv --` suffix. Preflight step 3 already refused existing destinations, and `git mv` refuses to overwrite an existing file.
   - Exit 1: source is untracked → use plain `mv` (see below).
   - Exit 128 (or anything other than 0/1): unexpected git failure (corrupt repo, path-resolution error, etc.) → HALT and emit a partial-state summary.

**Plain-mv branch (collision-safe):** Plain `mv` is silently destructive — it overwrites an existing destination without error. Two design docs with the same basename in different directories both produce dest `docs/designs/<basename>.md`; without a guard, the second move silently clobbers the first. Before each plain `mv`, run `[ -e <quoted-dst> ]` and, as a separate call, `[ -L <quoted-dst> ]`. If either succeeds, the destination already exists (a dangling link counts): HALT with a collision-error message naming the source and destination, and emit the partial-state summary. Otherwise, substitute `mv --` for `git mv --` in the preserved suffix and run that command alone.

Run each move as a Bash tool call bound to the canonical audited root. Keep the audit's quoted operands and `--` sentinel. Capture combined stdout+stderr. On non-zero exit from `mv` or `git mv`, HALT with a friendly error wrap (the raw stderr plus a one-line context note) and emit the partial-state summary.

**Post-apply summary:**

After every move attempt (success or halt), print a summary block:

```
Layout Scaffolding summary:
  Scaffolded: docs/, docs/designs/, docs/archive/
  Moved (3): TODOS.md → docs/TODOS.md, docs/sketch.md → docs/designs/sketch.md, ...
  Skipped (1): docs/old.md — source disappeared before move
  Blocked (informational): docs/inbox-notes.md (always-block per audit)
  Failed (0): —
```

When this apply used named external authorization, add each requested path and its resolved target to that summary. On clean success, re-run `"$_EXTEND_ROOT/bin/roadmap-audit"` with the canonical audited root as its one quoted positional argument. Do not omit that argument: an explicit subdirectory must not be re-audited as the git top-level. Read the `## DOC_LOCATION` and `## DOC_TYPE_MISMATCH` sections and confirm the only findings left are ones this plan listed as Blocked. Any other remaining finding means something didn't land; surface it. On halt, the summary captures what did and didn't happen; the user resolves manually.

The preflight is a procedure, not an atomic filesystem transaction. A concurrent replacement after the last check can still change a path, so this section does not claim race-free confinement. The boundary is exactly the audited root chosen above, even when that root is broad. Left to the shared helper (Track 19A), and not covered here: a move source that is itself a dangling link, which step 3 drops as disappeared; control characters other than the line breaks the audit already neutralizes, which the agent may not see, so that HALT is best effort; case-insensitive volumes where git's index spelling differs from the on-disk name, or where two destinations differ only in case; authorization text another agent relays as if the user wrote it; and a repository `bunfig.toml` (for example a `preload`) that Bun may load when it starts in the audited root, an exposure `roadmap-audit` already shares.

<!-- end of skills/references/roadmap/conditional-layout-apply.md -->
