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
unmodified `/review`, `bin/outside-review` refuses at dispatch, and
`/autoplan-lean` records criteria drift and continues with voices that are not
upstream-identical. The check moves that discovery ahead of the spend. It only
describes the installation at the moment it ran.

## Run it

Pass the root of the installed upstream the stage will use. The checker never
guesses a root.

```sh
# Claude Code layout: review and autoplan live under the root.
bin/upstream-check --gstack-root "$HOME/.claude/skills/gstack"

# Codex-style layout: gstack-review and gstack-autoplan are siblings of the root.
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
exists: review is `<root>/review/SKILL.md`, autoplan is
`<root>/autoplan/SKILL.md` and each phase section is
`<root>/autoplan/sections/<phase>-phase.md` (or the autoplan file for every
phase when that directory is absent). Otherwise it is **sibling**:
`<skills dir>/gstack-review/SKILL.md` and `<skills dir>/gstack-autoplan/SKILL.md`,
which inlines the phase sections. In both layouts the snapshot tool is
`<root>/bin/gstack-autoplan-snapshot.ts` and helper modules are
`<root>/lib/<name>.ts`. No run mixes layouts, and an `INFO file` line names the
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
(`review-and-prep.incap.1`, `autoplan-lean.skip-list`,
`outside-review.classifyOutsideReview`, `classifier.review-not-ready`,
`criteria.eng.outside`). `INFO` keys are `extend-version`, `extend-root`,
`inspected <contract> <revision> <version>`, `scope`, `root`,
`upstream-version`, `upstream-revision` (the git revision when the root is a
checkout, `unknown` otherwise), `layout` and `file <id> <path>`. A difference
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
  effect: /review-and-prep: the in-cap delta is inactive and /review runs unmodified
  fix: run /gstack-extend-upgrade and rerun; if it still drifts the extension is not qualified for this upstream, so proceed knowing the stated cost or hold the stage (your decision); see docs/upstream-check.md#drift-anchor
RESULT drift checks=21 drift=1
```

## What it checks

`OK` means only that the listed anchors, exports, classifier cases and known
criteria paragraphs matched. It does not detect newly added upstream
requirements, changed surrounding instructions, or classifier behavior outside
the golden cases. It is not the installed-call qualification
[outside-review.md](outside-review.md) requires after an upstream upgrade.

The inventory comes from this extension's own source, never a second copy:

- **Anchors.** The backtick spans after "byte for byte," and before "Check each
  with `grep -F`" in the `/review`-repeat-cycles paragraph of
  `skills/review-and-prep.md`, each checked as raw bytes anywhere in the
  installed `/review` skill file (whole-file `grep -F` semantics, as the
  wrapper's check does; its prose "in its Step 5.8" is enforced by neither, and
  there is no decoding or normalization), plus the `**Section skip list` label in the installed
  autoplan file, through the `skipList` helper `/autoplan-lean outline` uses.
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
- **Criteria.** `driftReport` from `src/autoplan-lean/criteria.ts`, the
  comparison `autoplan-lean drift` uses, over the installed snapshot tool and
  each phase's section text. `unreadable` and `unknown` count as drift.

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
  and `/review` runs unmodified (full repeat cycles). For the skip list,
  `autoplan-lean outline` marks no row `skip`, so `/autoplan-lean` applies
  upstream's skip list by heading itself and reads more.

<a id="drift-criteria"></a>
- **`criteria`.** The copied reviewer criteria no longer match the installed
  text, so `/autoplan-lean` voices are not upstream-identical for that phase.
  The run continues, but it records the difference.

<a id="drift-inventory"></a>
- **`inventory`.** This extension's own files are damaged or edited: the
  anchors cannot be listed. Re-run its `setup` or reinstall, then rerun.

For `anchor`, `export`, `classifier` and `criteria`, run
`/gstack-extend-upgrade` and rerun. If it still drifts, the extension is not
qualified for this upstream; proceed knowing the stated cost, or hold the stage.
That decision belongs to the caller.

`autoplan-lean drift` prints `DRIFT: found` and `CRITERIA:` lines; this command
prints `DRIFT <kind> …`. `autoplan-lean drift` also refuses a symlinked file
argument, while this command resolves symlinks, so a symlinked nested layout
(such as Claude's) is checked, not reported unreadable.

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

## Upgrade checklist

1. Upgrade (`/gstack-extend-upgrade`, or a gstack upgrade), then rerun the
   check against the root the stage will use.
2. A pass is not the installed-call qualification
   [outside-review.md](outside-review.md) requires. Re-inspect the adapter
   against the new upstream before changing the inspected revision recorded
   there; the constants in `src/upstream-check/cli.ts`,
   `src/autoplan-lean/criteria.ts` and `src/outside-review/cli.ts` must agree
   with the documents (a test checks).
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
| Reviewer criteria copies | `514fbfdc9799376edfd2536f60659501a48ead64` | 1.91.176.0 |
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
