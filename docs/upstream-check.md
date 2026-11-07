# Upstream launch check

`bin/upstream-check` tells a caller, before it launches a stage, whether the
installed upstream gstack still matches the literal contracts this extension
copied. It is local, read-only and advisory: no network, no model dispatch, no
pin, hold, upgrade, lease write or other file write. It reads files and imports
the same upstream helper modules `bin/outside-review` imports. Nothing in this
repository calls it yet; a caller runs it and decides what to do with the
answer (see [what it does not do](#what-it-does-not-do)).

Without it, a drifted contract is found when the stage reaches the affected
step: `/review-and-prep` records `in-cap delta: inactive` and runs the
unmodified `/review` (or records `repair-review: inactive` and repeats every
edited pass, or records `test-gaps: inactive` and writes tests as today, or
records `pregate-narrowing: inactive` and runs the pregate as today, or
records `Review arm: dispatch — anchor changed` and dispatches specialists as
today, or records `Review overlap: sequential — anchor changed` and runs cycle 1
in today's order),
`bin/outside-review` refuses at dispatch, and `bin/secret-dispositions` refuses a
reviewed finding whose location it cannot read. The check moves that discovery ahead of the spend. It only
describes the installation at the moment it ran.

## Run it

Pass the root of the installed upstream the stage will use. The checker never
guesses a root.

```sh
# Claude Code layout: review and ship live under the root.
bin/upstream-check --gstack-root "$HOME/.claude/skills/gstack"

# Codex-style layout: gstack-review and gstack-ship are siblings of the root
# (review/checklist.md stays under the root in both layouts).
bin/upstream-check --gstack-root "$HOME/.codex/skills/gstack"
# Sibling skills somewhere else:
bin/upstream-check --gstack-root /abs/path/gstack --skills-dir /abs/path/skills
```

A launch script branches on the exit status:

```sh
if out=$(bin/upstream-check --gstack-root "$HOME/.claude/skills/gstack"); then
  :                                   # exit 0: every listed check matched
else
  case $? in
    4) printf '%s\n' "$out" ;;        # drift: read the effect lines, then decide
    *) echo "upstream-check could not run (see stderr)" >&2 ;;  # 1, 2, 5
  esac
fi
```

Rerun it before each later stage and again at the end of a long one. Run it
under your own wall-clock limit if you like, but the upstream imports already
run in a child process with a deadline (below), so a hanging module cannot hang
the check.

| Flag | Meaning |
|---|---|
| `--gstack-root DIR` | Required, absolute. The installed upstream root the stage will use. |
| `--skills-dir DIR` | Absolute. Sibling-skill directory; defaults to the parent of `--gstack-root`. |
| `--timeout-ms N` | Deadline for the child that imports upstream modules, 100–120000, default 5000. |
| `--help`, `-h`, `--version` | Usage; `upstream-check <extension VERSION>`. |

Bun 1.3.3 or newer is required, like the other `bin/` launchers.

### Trust and layout

The root is trusted code: the checker imports it. It is never derived from the
working directory or the repository under review. Either `--gstack-root` or
`--skills-dir` (including its derived default, when the sibling layout is used)
resolving inside the current directory's git repository is a usage error
(exit 2). That also rules out a repository-local install such as
`.agents/skills/gstack`; the check does not support it. Where a host keeps its
root is defined by upstream and the host, so pass the root of the host whose
stage you are about to launch. Git discovery ignores inherited `GIT_*`
repository selectors and crosses filesystem boundaries while discovering the
innermost work tree containing the current directory (the submodule itself
when invoked in a submodule). Unavailable or failed discovery is an internal error;
only Git's explicit not-a-repository result permits a non-repository cwd.

For the installed `/review` used during qualification, root selection is:

1. **Codex:** an existing `GSTACK_ROOT` with `bin/` and `lib/`; otherwise
   `<git toplevel>/.agents/skills/gstack` when its `bin/` exists; otherwise
   `${CODEX_HOME:-~/.codex}/skills/gstack` when its `bin/` exists. No matching
   installation is an upstream setup error.
2. **Claude Code:** the installed `/review` invokes its helpers at
   `~/.claude/skills/gstack` directly.

Check the host's installed skill if that resolver changes. If Codex selects a
repository-local root, this checker rejects it: do not substitute a different
user-wide root and present that result as coverage of the selected install.
These are upstream host rules, not automatic discovery by this command.

The layout is chosen once per run. It is **nested** when `<root>/review/SKILL.md`
exists: review is that file, its adversarial section is
`<root>/review/sections/adversarial.md`, and test coverage is
`<root>/ship/sections/test-coverage.md`. Otherwise it is **sibling**:
`<skills dir>/gstack-review/SKILL.md` inlines the adversarial section, and
test coverage is `<skills dir>/gstack-ship/sections/test-coverage.md`.
In both layouts the review checklists stay under `<root>/review/`, pregate is
`<root>/bin/gstack-pregate` with modules under `<root>/lib/pregate/`, and
helper modules are `<root>/lib/<name>.ts`. No run mixes layouts, and an `INFO file` line names the
real path of each checked contract file, inventory source, VERSION and helper
module (not every transitive module import; symlinks are followed, so a symlinked layout
reports OK).

## Output

stdout carries only protocol lines. A report without a final `RESULT` line is
incomplete; treat it as drift.

```text
upstream-check/v1
INFO <key> <value to end of line>
OK <kind> <id>
DRIFT <kind> <id> <reason>
  effect: <the stage and the path it will take>
  fix: <action>
RESULT ok|drift checks=<n> drift=<m>
```

Ids contain no whitespace and come from the source position
(`review-and-prep.incap.1`,
`outside-review.classifyOutsideReview`, `classifier.review-not-ready`,
`secret-dispositions.location.1`). `INFO` keys are `extend-version`, `extend-root`,
`inspected <contract> <revision> <version>`, `scope`, `root`,
`upstream-version`, `upstream-revision` (the git revision when the root is a
checkout, `unknown` otherwise), `layout`, `file <id> <path>` and
`not-declared <list> <path>`. A difference
between an inspected and the installed revision is `INFO`, never `DRIFT`.
Within v1 new kinds and `INFO` keys may appear; consume the exit status, the
`DRIFT` prefix and `RESULT`. Any other grammar change bumps the version.

| Exit | Meaning | stdout | stderr |
|---|---|---|---|
| 0 | every check OK (`RESULT ok`) | report | empty |
| 4 | a check drifted, or an input is missing or malformed (`RESULT drift`) | report | empty |
| 2 | usage error, decided before any work | empty | `ERROR USAGE: …` and `FIX: …` |
| 1 | internal failure; wins over drift | empty | `ERROR INTERNAL: …`, a short trace, versions, `FIX: …` |
| 5 | Bun missing or not absolute (launcher) | empty | `ERROR bun_missing: …` or `ERROR bun_not_absolute: …`, then `FIX: …` |

A missing launcher source or a launcher symlink failure exits 1 with
`ERROR INTERNAL`, version context (extension version `unknown` before the
source is available), and the specific installation repair in `FIX`.

Output is buffered and written after every check finishes, so an internal
check failure produces no report. A failure while writing the output stream
can leave incomplete output; without the final `RESULT` it is not a passing
report. The command never prints environment values, and an
upstream exception message is never printed: a failure names the error class,
the module path and a reason the checker owns. To see the raw message run
`bun <root>/lib/<module>.ts` yourself.

### Example: a missing anchor

```text
DRIFT anchor review-and-prep.incap.2 anchor not found byte for byte in /Users/me/.claude/skills/gstack/review/SKILL.md: "Allow at most 3 fix cycles"
  effect: /review-and-prep: the in-cap delta is inactive and /review runs unmodified; repair-review=behavior-changing is also inactive, so every edited pass repeats as today and the receipt says so
  fix: run /gstack-extend-upgrade and rerun; if it still drifts the extension is not qualified for this upstream, so proceed knowing the stated cost or hold the stage (your decision); see docs/upstream-check.md#drift-anchor
RESULT drift checks=98 drift=1
```

## What it checks

`OK` means only that the listed anchors, exports and classifier cases matched. It does not detect newly added upstream
requirements, changed surrounding instructions, or classifier behavior outside
the golden cases. It is not the installed-call qualification
[outside-review.md](outside-review.md) requires after an upstream upgrade.

The inventory comes from this extension's own source, never a second copy:

- **Anchors.** The backtick spans after "byte for byte," and before "Check each
  with `grep -F`" in the `/review`-repeat-cycles paragraph of
  `skills/review-and-prep.md`, each checked as raw bytes anywhere in the
  installed `/review` skill file (whole-file `grep -F` semantics, as the
  wrapper's check does; its prose "in its Step 5.8" is enforced by neither, and
  there is no decoding or normalization).
- **Fix-First anchors.** The backtick spans of the activation paragraph of
  `skills/review-and-prep.md` (opened by `**Activation
  (`repair-review=behavior-changing`).**`): the two after its first "byte for
  byte," are checked as raw bytes in the installed `/review` skill file, and the
  four after its second, which follows "its `review/checklist.md` still
  contains,", in `review/checklist.md` under the same root. The checklist is
  read from the root in both layouts, so the nested-or-sibling choice is
  unchanged. They are listed by `fixFirstInventory`, a separate check
  (`review-and-prep.fix-first`) from the in-cap list. Their anchor results are
  independent, but activation is not: the paragraph also requires the first two
  in-cap anchors, which the in-cap list already checks. Drift in either of those
  disables both values even while the six Fix-First anchor checks say OK, and
  the in-cap effect line for those two anchors names both consequences.
- **Test-gap anchors.** The backtick spans of the activation paragraph of
  `skills/review-and-prep.md` (opened by `**Activation
  (`test-gaps=record`).**`), in four lists each opened by "byte for byte,": the
  six after the first are checked as raw bytes in the installed `/review` skill
  file, the five after the second (which follows "its
  `review/specialists/testing.md` still contains,") in
  `review/specialists/testing.md` under the root, the one after the third
  (following "its `review/checklist.md` still contains,") in
  `review/checklist.md`, and the four after the fourth (following "and the
  `ship/sections/test-coverage.md` that the coverage audit reads still
  contains,") in `ship/sections/test-coverage.md`. The specialist file is read
  from the root in both layouts. The coverage section is read from the root when
  the layout is nested and from the sibling `gstack-ship/sections/` directory of
  `--skills-dir` when it is sibling, because the Codex layout has no
  `gstack/ship`. They are listed by `testGapInventory`, a separate check
  (`review-and-prep.test-gaps`). Anchor IDs read
  `review-and-prep.test-gaps.<review|testing|checklist|coverage>.<n>`.
- **Pregate-narrowing anchors.** The backtick spans of the activation paragraph
  of `skills/review-and-prep.md` (opened by `**Activation (narrowed
  pregate).**`), in three lists each opened by "byte for byte,": the two after
  the first are checked as raw bytes in `bin/gstack-pregate` under the root, the
  two after the second (which follows "its `lib/pregate/index.ts` still
  contains,") in `lib/pregate/index.ts`, and the five after the third
  (following "and its `lib/pregate/checks/lanes.ts` still contains,") in
  `lib/pregate/checks/lanes.ts`. All three files are read from the root in both
  layouts. They are listed by `pregateNarrowInventory`, a separate check
  (`review-and-prep.pregate-narrowing`). Anchor IDs read
  `review-and-prep.pregate-narrowing.<bin|index|lanes>.<n>`.
- **Delegation anchors.** The backtick spans of the activation paragraph of
  `skills/review-and-prep.md` (opened by `**Activation (`delegate`).**`), in
  six lists each opened by "byte for byte,": the six after the first (including
  the two waive-instruction lines every copy carries) are checked as raw bytes in
  the installed `/review` skill file; the three after the second (following "and,
  where that `/review` contains any line of the next list, it still contains
  every line of it,") are checked all-or-none in that same `/review` file,
  reporting `OK` plus `INFO not-declared review-and-prep.delegate.dispatch-item <path>`
  when none of the three is present; and the three after each of the next four
  (following "its `review/specialists/testing.md` still contains,", then the same
  for `maintainability.md`, `performance.md` and, after "and its",
  `simplification.md`) in that specialist's file. Each specialist file holds its
  heading, the line `Output: JSON objects, one finding per line. Schema:` and its
  own `"specialist":"<part>"` tag; whole-file presence is the check, so the
  simplification tag, which that file also uses elsewhere, is not counted. The
  four specialist files are read from the root in both layouts (the Codex root's
  `review/specialists` links to the nested copy). They are listed by
  `delegateInventory`, a separate check (`review-and-prep.delegate`). Anchor IDs
  read `review-and-prep.delegate.<review|dispatch-item|testing|maintainability|performance|simplification>.<n>`,
  twenty-one in all. `bin/review-delegate` repeats the specialist-file anchors for
  the parts it is asked to run, so a part never runs partly applied.
- **Fold anchors.** The backtick spans of the activation paragraph of
  `skills/review-and-prep.md` (opened by `**Activation (`specialists=fold`).**`),
  in eleven lists each opened by "byte for byte,": the first list, six lines, is
  checked as raw bytes in the installed `/review` skill file; the second list,
  three lines, is checked all-or-none in that same `/review` file with `OK` plus
  `INFO not-declared review-and-prep.fold.dispatch-item <path>` when none is
  present; and each of the next nine lists holds one heading, checked in that
  checklist's file (following "its `review/specialists/testing.md` still
  contains,", then the same for `maintainability.md`, `security.md`,
  `performance.md`, `data-migration.md`, `api-contract.md`, `simplification.md`
  and `state-machines.md`, and, after "and its", `review/design-checklist.md`).
  All nine checklists are read from the root in both layouts (the Codex root's
  `review/specialists` and `review/design-checklist.md` link to the nested copy).
  Five of the review lines, the three item lines and four of the headings
  (testing, maintainability, performance and simplification) are also delegation
  anchors, and the combine line is also an overlap anchor: a change to one of
  them drifts every shared ID, each with its own effect. They are listed by
  `foldInventory`, a separate check (`review-and-prep.fold`). Anchor IDs read
  `review-and-prep.fold.review.<n>`, `review-and-prep.fold.dispatch-item.<n>` and
  `review-and-prep.fold.<testing|maintainability|security|performance|data-migration|api-contract|simplification|state-machines|design>.1`,
  eighteen in all. What the anchors do not cover: Review Army's selection, its
  State Machines and Design steps and the Red Team dispatch mechanics, which
  only the nested layout installs and which the fold uses as written, so an
  upstream change inside `review/sections/review-army.md` is not detected here.
- **Overlap anchors.** The backtick spans of the activation paragraph of
  `skills/review-and-prep.md` (opened by `**Activation (`first-cycle=overlap`).**`),
  in two lists each opened by "byte for byte,": the five after the first are
  checked as raw bytes in the installed `/review` skill file, and the three after
  the second (following "and its adversarial instructions
  (`review/sections/adversarial.md` in the nested layout, the review file itself
  in the sibling layout) still contain,") in `<root>/review/sections/adversarial.md`
  in the nested layout and in `<skills dir>/gstack-review/SKILL.md` in the sibling
  layout. They are listed by `overlapInventory`, a separate check
  (`review-and-prep.overlap`). Anchor IDs read
  `review-and-prep.overlap.review.<1..5>` and
  `review-and-prep.overlap.adversarial.<1..3>`, eight in all. What the anchors do
  not cover: Review Army's Red Team inputs and dispatch mechanics (the Codex
  sibling copy lacks Review Army), nor the native prompt beyond its anchored line;
  the section's runtime independence judgment covers them.
- **Secret-finding location anchors.** Two spans of the installed
  `lib/pregate/checks/secrets.ts`, read as raw bytes from the root in both
  layouts: the template that renders a finding's location, which writes
  `line N` for a file upstream scanned whole and `added line N` for any other,
  and the `fileLine: !!part.keep` flag that picks between them. They are the
  exported `UPSTREAM_FINDING_ANCHORS` list in
  `src/secret-dispositions/evaluate.ts`, beside the grammar they protect, not a
  list in a skill, so there is no inventory check for them. Anchor IDs read
  `secret-dispositions.location.<n>`. A healthy file prints
  `INFO file pregate.secrets <path>`. The evaluator reads both forms (see
  [secret dispositions](secret-dispositions.md#finding-locations)); its other
  imports of upstream helpers fail closed when it runs and are not anchors.
- **Exports.** `runClaudeCode`, `resolveClaudeCommand` and
  `classifyOutsideReview`, from the one list (`UPSTREAM_HELPERS`) that
  `src/outside-review/cli.ts` itself loads before any dispatch. Each module is
  imported from the root and the export must be a function. Importing runs the
  module's top-level code, as the adapter does.
- **Classifier cases.** Four golden cases run through the adapter's `recover`
  against the installed classifier: advisory-only findings are `clean` and
  credited, and the same text with a last `Verdict: not ready` line is `findings`
  and credited, for both the `review` and `structured` gates. The `review` cases
  include a recommendation; the `structured` cases omit it.
  The table is qualified at upstream `db87940e` (1.91.198.0) or later.

The upstream imports and the golden cases run in one child Bun process with
stdin closed and a deadline (`--timeout-ms`); its output never reaches this
command's stdout and at most 1 MiB is read. A timeout, an early exit, a missing
or malformed result frame or an output flood is drift, and every check the probe
could not run still prints a `DRIFT … not run: probe <cause>` line so
`checks=<n>` does not depend on the cause. A timeout may clear on rerun with a
larger `--timeout-ms`; content drift does not. Direct file reads by the checker
use `realpath` and require a regular file of at most 4 MiB. The file
type check and bounded read use the same descriptor, including during an upgrade.
A missing or inaccessible root, directory, FIFO, oversized file or malformed
inventory source is drift. A deadline exceeded during probe shutdown remains
drift even if the probe already emitted a result.
`VERSION` content that is not a dotted version is printed as `unknown`.
Frames await stream-write callbacks before upstream imports, respecting
output backpressure, so an upstream
nonzero early exit remains drift. An extension-owned child startup or internal
failure is instead exit 1, with no report.

### Drift kinds, by consequence

Each `DRIFT` line is followed by its `effect` and `fix`; this is the stable
list. Rerunning is always safe, and an unchanged rerun cannot repair drift.

<a id="drift-root"></a>
- **`root`.** No installation can be checked and every later check prints
  `not run`. Pass `--gstack-root` (and `--skills-dir`) for the host being
  launched.

<a id="drift-export"></a>
- **`export`.** A confirmed missing or non-function helper makes
  `bin/outside-review` refuse before dispatch, leaving `/review-and-prep`
  without outside coverage. An incomplete probe only establishes that the
  `bin/outside-review` export contract is unverified; it does not prove refusal.

<a id="drift-classifier"></a>
- **`classifier`.** The `bin/outside-review` classifier contract differs or
  could not be verified. Only an observed `clean/credited` result for a
  `not-ready` case establishes that the reviewer's not-ready verdict is credited
  clean and the stage may proceed past it. Unrun, throwing and uncredited cases
  do not establish that behavior.

<a id="drift-anchor"></a>
- **`anchor`.** For the three `/review` anchors, the in-cap delta is inactive
  and `/review` runs unmodified (full repeat cycles); the first two also gate
  `repair-review=behavior-changing`, which then records `repair-review: inactive`,
  and the effect line for those two anchors states both consequences.
  For the six Fix-First anchors, that value is inactive: every edited pass repeats
  as today and the receipt says so, with no upstream file edited. For the sixteen
  test-gap anchors, `test-gaps=record` is inactive: the review and the coverage
  audit write tests as today and the receipt says so, with no upstream file
  edited. For the nine pregate-narrowing anchors, a pass under
  `full-suite=external` does not narrow the pregate: it runs as today and the
  receipt says so, with no upstream file edited. For the twenty-one delegation
  anchors (including the three all-or-none item lines when at least one is
  present), `delegate=<part>` is inactive: every specialist runs on the host
  model as today and the receipt says so, with no upstream file edited; the
  option never runs partly applied. For the eighteen fold anchors (including the
  three all-or-none item lines when at least one is present),
  `specialists=fold` is inactive: cycle 1 dispatches specialists as today and the
  receipt says so, with no upstream file edited. For the eight overlap anchors,
  `first-cycle=overlap` is inactive: cycle 1 runs in today's order and the
  receipt says so, with no upstream file edited. For the two secret-finding
  location anchors, `bin/secret-dispositions` may refuse a reviewed MEDIUM
  secret finding as unrecognized, so the pregate gate stays blocked; nothing is
  approved in its place and no upstream file is edited.

<a id="drift-inventory"></a>
- **`inventory`.** This extension's own files are damaged or edited: the
  anchors cannot be listed. Re-run its `setup` or reinstall, then rerun.

For `anchor`, `export` and `classifier`, run
`/gstack-extend-upgrade` and rerun. If it still drifts, the extension is not
qualified for this upstream; proceed knowing the stated cost, or hold the stage.
That decision belongs to the caller.

### Upstream's specialist-dispatch item

Since upstream gstack 1.94.22.0 (`592fa0c8`), the nested `/review` (and the
Cursor sibling copy generated from it; grep counts on 2026-11-06 across nested /
Cursor / Codex: `specialists-dispatched` 2/1/0, `Dispatching N specialists:`
2/2/0, `then one Agent dispatch … skips them).` 1/1/0) declares the `Done means`
item `specialists-dispatched`: print the `Dispatching N specialists:` selection,
then one Agent dispatch per specialist it names. The frontmatter contract and its
`skill_contracts` Stop hook exist only in the nested Claude Code copy and are
off by default (`docs/skill-routing-and-contracts.md` in the gstack checkout).

- **Why both options waive it.** A delegated part that the delegate credits gets
  no Agent dispatch, and a folded cycle 1 dispatches no specialist Agent, so
  neither option can meet `specialists-dispatched` for those parts. Both options
  waive the item through upstream's own command (`gstack-skill-contract waive
  specialists-dispatched --reason "<why>"`, without `--skill`, anchored in both
  activation paragraphs by `For an item that truly does not apply, run` and
  `(this session only; it counts as a miss).`): once per cycle where the
  delegate credited at least one part, and once in a folded cycle 1 that applied
  at least one checklist. Parts that run on the host keep their Agent dispatch,
  and a later cycle that dispatches as today meets the item from its own later
  selection line (which outranks an earlier waiver in `lib/skill-contract.ts`).
  Neither option prints a narrowed or zero-count selection line or dispatches a
  placeholder Agent. Upstream counts a waiver as a miss (`met_waived`) in its
  follow record, and the receipt records one `specialists-dispatched:` line
  while the option is active. It names the current item result, with a
  `; history=<cycle>:<outcome>[,...]` suffix for mixed cycle outcomes so later
  met results or failed calls do not hide earlier waiver history.
- **All-or-none item anchors.** Both activation paragraphs list
  `specialists-dispatched`, `Dispatching N specialists:` and `then one Agent
  dispatch per specialist it names (none when a small diff skips them).` under
  `review-and-prep.delegate.dispatch-item.<1..3>` and
  `review-and-prep.fold.dispatch-item.<1..3>`. Because the Codex sibling copy
  declares none of the three lines, the list passes when the review file contains
  all three or none of them, and the none case prints `INFO not-declared
  review-and-prep.<delegate|fold>.dispatch-item <path>` with `OK` for each ID. If
  some lines are present and others are missing, or the review file cannot be
  read, the missing IDs drift and turn that option off. Detection gap: an
  upstream change that renames the item and rewrites its marker and bullet prose
  all at once (all three lines gone together) reads as `not-declared`, so the
  options stay on while a renamed item exists.

## The 120-minute lease limit

This section is bound to the inspected upstream revision recorded in
[outside-review.md](outside-review.md#upstream-revision). `gstack-skill-start`
touches an install lease once per skill start. `gstack-lease touch` deletes any
lease that has not been refreshed for 120 minutes, after which
`gstack-upgrade` no longer sees that session. A stage that runs longer than
that can have its installation upgraded under it with no lease to block it. A
launch check describes the installation only at the moment it ran, so rerun it
before each later stage and again at the end of a long one.

Initial qualification recorded: "No mid-run upgrade has been observed."
The subsequent review on 2026-10-25 saw the installed version change from
1.91.208.0 to 1.91.216.0 between checks; the inspected helper and review files
were unchanged. That observation does not establish lease expiry as its cause.
There is no persistent upgrade-observation record, so "not
observed" is not evidence that none happened.

## Related tools

`gstack-doctor --check` certifies install health; `upstream-check` certifies
this extension's contracts. Run both if you want both. The checker does not call
doctor. Revisit if upstream publishes anchor or contract identifiers.

The [review repair policy acceptance record](acceptance/review-fix-policy.md)
holds the measurement limits and release-note block for the opt-in repair values
and the test-gap routing value.

## Upgrade checklist

1. Upgrade (`/gstack-extend-upgrade`, or a gstack upgrade), then rerun the
   check against the root the stage will use.
2. A pass is not the installed-call qualification
   [outside-review.md](outside-review.md) requires. Re-inspect the adapter
   against the new upstream before changing the inspected revision recorded
   there; the constants in `src/upstream-check/cli.ts` and
   `src/outside-review/cli.ts` must agree with the documents (a test checks).
3. If a check still drifts, decide to proceed with the stated cost or hold.

## What it does not do

- It does not gate any skill. No skill calls it in this release; callers run it
  before a stage and decide for themselves.
- It does not pin, hold or upgrade, does not touch the lease and does not call
  the network or a model.
- It does not prove the stage will behave identically; see the definition of
  `OK` above.

## Inspected revisions

| Contract | Upstream revision | Version |
|---|---|---|
| Wrapper anchors and classifier cases (qualified by this Track) | `e2fffee3114e90ce2a7d165f09d3efce3555e252` | 1.91.208.0 |
| Fix-First anchors | `959c8a6a4fdafabf1186e407b76082b7f07e9f24` | 1.91.327.0 |
| Test-gap anchors | `41a67b996d8bbf2167996683953dd2d7cd387d64` | 1.91.367.0 |
| Pregate-narrowing anchors | `f8085aa0e499085c411f712d6d5c00a81d1b104a` | 1.94.39.0 |
| Secret-finding location anchors | `2512dd7624a474fee036326989ea0c6bb8470e69` | 1.92.55.0 |
| Delegation anchors | `9ceec3f05e4a960d023b3140d6f7a28ed06662d5` | 1.96.0.0 |
| Fold anchors | `9ceec3f05e4a960d023b3140d6f7a28ed06662d5` | 1.96.0.0 |
| Overlap anchors | `9ceec3f05e4a960d023b3140d6f7a28ed06662d5` | 1.96.0.0 |
| Outside-review adapter | `e2fffee3114e90ce2a7d165f09d3efce3555e252` | 1.91.208.0 |

## Measured startup profile

This is a recorded measurement of one named profile, not a CI assertion or a
guarantee elsewhere (timing tests flake under machine load). It is an external
wall clock around `sh bin/upstream-check --gstack-root <root>`, so launcher,
Bun startup, the child process and every check are included.

| Item | Value |
|---|---|
| Machine | Apple M2 Max, 64 GB |
| OS | macOS 27.0.1 |
| Bun | 1.3.10 |
| Installed upstream | 1.91.216.0, revision `64d82101cac149125d28df888e3f2ea14a444dc5` (nested checkout; sibling revision unknown) |
| Extension | 0.48.0 (21 checks, all OK, exit 0) |
| Load during the runs | load average about 8.4 (other sessions were active), not an idle machine |
| Date | 2026-10-25 |

| Layout | Runs | First run | Warm runs | Observed maximum |
|---|---|---|---|---|
| Nested (`~/.claude/skills/gstack`) | 11 (1 first + 10 warm) | 0.122 s | 0.100–0.145 s | 0.145 s |
| Sibling (`~/.codex/skills/gstack`) | 11 (1 first + 10 warm) | 0.104 s | 0.100–0.344 s | 0.344 s |

The first run is the first of each series of 11; the filesystem and Bun caches were
not purged, so it is not a true cold start. The under-one-second claim covers
only this profile. Re-measure on the machine you care about; a probe deadline
(`--timeout-ms`, default 5000) bounds the worst case instead.
