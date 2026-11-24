# /review-and-prep reference: Delta reviewer selection and scope coverage

## From Scope a re-review to its delta

Tell the nested `/review` its delta base B and candidate snapshot S. Every
diff, numstat, name-status and reviewer-prompt diff command compares `"B" "S"`
with its usual pathspecs (except a `repair-only` continuation's full-scope
outside rerun, which compares the verified merge base to S), and scope detection runs `gstack-diff-scope "B"` and
`gstack-state-matrix detect --diff-base "B"`. Before using delta scope, inspect
the installed `gstack-diff-scope` input collection. Its `B...HEAD`, changes
against HEAD and current untracked-path union can omit a snapshot's reverted
tracked file or deleted untracked file. Run this guard from the workspace to
prove that union contains every B-to-S path; if the installed helper collects
different inputs, use full scope until coverage can be established:

```bash
bun --no-env-file --config=/dev/null --no-install -e '
const {execFileSync} = require("node:child_process");
const [b,s] = process.argv.slice(1);
const paths = args => execFileSync("git", args, {encoding:"utf8",stdio:["ignore","pipe","pipe"]}).split("\0").filter(Boolean);
try {
  const delta = paths(["diff","--no-renames","--name-only","-z",b,s]);
  const selected = new Set([
    ...paths(["diff","--name-only","-z",b+"...HEAD"]),
    ...paths(["diff","--name-only","-z","HEAD"]),
    ...paths(["ls-files","--others","--exclude-standard","-z"])
  ]);
  console.log("SCOPE_DELTA: "+(delta.every(p=>selected.has(p)) ? "covered" : "full-required"));
} catch { console.log("SCOPE_DELTA: full-required"); }
' "<delta-base>" "<candidate-snapshot>"
```

Only `SCOPE_DELTA: covered` permits delta selection. A missing path, failed
command or unknown result runs a full-scope pass and records the reason.
Otherwise use the helper's output unchanged; it can still over-select.
`/review`'s own gates then pick reviewers for the delta:
its small-diff, simplification, Red Team and structured-review size gates, its
scope signals, the always-on native adversarial pass and the outside challenge
its preflight allows. Never pick or skip a reviewer yourself, and never use a
force flag to skip. The only exceptions are the light review default's
repair-cycle skips, a bounded-wait host's Red Team rule and a `repair-only`
continuation's full-scope rerun of an outside voice the corroborated full-review
evidence records as missing coverage, each recorded with its reason.
`repair-cycles=light` selects the light default's skips. Its
plan-completion audit stays informational; Step 2's matrix governs.

For a wrapper re-review, B is the newest commit on this branch whose content a
completed `/review` pass covered, normally the commit the last invocation
started from. H-E uses the baseline in **Record cycle 1's full-review baseline** so later
continuations need no synthetic claim of full coverage. B must be an ancestor of HEAD. A snapshot is local: never carry
one to another session as B. Use full scope instead when B is not an ancestor,
the delta includes a base merge that resolved conflicts or touched reviewed
files, the approved scope or plan changed, **The reviewed commit is no longer
in this branch.** (E7) applies, or the delta's dependencies are unknown.

Record `scope: delta from <B> to <S>` with its file and line counts,
`/review`'s selection line, each reviewer it skipped with its own reason plus
`delta re-review from <B>`, and the full-scope coverage the delta extends. A
delta pass is partial: never present it as a full re-review.

<!-- end of skills/references/review-and-prep/conditional-delta-selection.md -->
