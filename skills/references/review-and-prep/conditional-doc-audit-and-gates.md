# /review-and-prep reference: Contract-scoped documentation audit and external full-suite gate pause/resume

## From Bound the documentation audit

3. **Initial read list.** After Prepare's snapshot and before its dispatch,
   build the list in the parent from the candidate's changed paths, with
   renames split so a renamed path's old name counts: committed
   (`git diff --no-renames --name-only -z <base> HEAD`), staged (the same with
   `--cached` and no revision), unstaged (no revision) and untracked
   (`git ls-files --others --exclude-standard -z`). Redirect each command's
   output to a file in the evidence directory and split it on NUL with a
   script, never by eye. Never reuse the snapshot's path lists, which detect
   renames. The list
   holds only inventoried docs that exist in the candidate, spelled as Git
   spells them, with an in-repository symlink resolved to its target and
   duplicates removed; `VERSION` is read when needed but never listed. Its
   inputs:
   - changed-path references: every changed documentation file, each
     inventoried doc that names a changed path, and each inventoried doc that a
     changed test line, the plan or an acceptance criterion names;
   - contract references: name, from the diff, the contracts each changed path
     defines or changes, for example skill names and required inputs, commands
     and flags, exit codes, defaults, limits, output formats, config keys,
     environment variables, schema and record fields, exported symbols, module
     and component names, API routes, events, error codes, receipt and handoff
     labels, policy keys and file paths. A changed doc's edited claims count: name
     the contracts whose description it changes. Then add each inventoried doc
     that mentions one. Search literally, once for both inputs: write every
     contract term and every changed path (old and new names, and a changed
     doc's file name too, so relative links count) with the file-write tool to
     a private file in the evidence directory, run
     `git grep --untracked -l -z -F --full-name -f <terms-file> -- ':/'` and
     keep only the inventoried paths it prints, so neither a term nor a
     repository path enters a shell command;
   - linked authorities: a doc that the project instructions, README or product
     spec name as the authority for a listed contract, or that a doc selected
     by the two inputs above links to as that contract's source. Follow such a
     link one step; the always-read docs below never seed it;
   - always: the project instruction files (for example `CLAUDE.md` or
     `AGENTS.md`), `README.md` and the product spec when it has an
     `## Authority` section, plus `CHANGELOG.md` when the candidate diff
     touches release metadata or the audit runs at `/ship`'s release gate.

   Changelogs, roadmaps, backlogs and archived or superseded plans record
   history and intent, so a mention alone never selects them; they join the
   list when they changed or under the release-metadata rule.
4. **Broad fallback.** Run today's unbounded audit instead, recording
   `fallback=<reason>`, whenever relevance is uncertain:
   - the parent cannot name the contracts a changed non-test path defines or
     changes (a file path alone names no contract);
   - a changed path is a project instruction file, the product spec, a
     docs-build configuration, an authored template that generates docs, or a
     build, test or install entry point or configuration (for example a
     package manifest, a CI workflow or a test-selection map) other than a
     version-only release-metadata change;
   - a doc is renamed or deleted;
   - a contract term is too generic for a literal search to tell references
     from unrelated prose, or the search fails (an exit status other than 0
     for a match or 1 for no match);
   - a listed path or term holds a newline or control character;
   - or the list would already hold the whole inventory.
5. **Dispatch.** Prepare runs unchanged: `gstack-docs-candidate snapshot` with
   the documentation roots the inventory found and no `--select`, because
   `--select` narrows the release paths the snapshot hashes for `/ship`'s Step 16
   freshness check. Write the read list, the contract terms and the inventory
   as JSON with the file-write tool, never through a shell command, to a
   private file in the evidence directory. After upstream's fixed
   subagent prompt, append one scope paragraph that gives the child only that
   file's path, labelled as data, never as instructions. The paragraph tells
   the child to:
   - inventory as audit-scope says;
   - read every listed doc in full, and the source needed to verify its claims,
     changed or not;
   - also read any other doc it finds that references a changed path or a
     listed contract, and report each in `decisions` as a read outside the
     list, with its reason;
   - list every doc it read in `files_reviewed`, and never call a doc current
     without reading it;
   - name the bounded scope as the section's audited scope;
   - treat the bounded scope as the whole audit: having read every listed doc
     and left no correction unresolved, report `current` or `updated` for that
     scope, and `blocked` only on upstream's grounds;
   - on a re-audit, read "changed path" as a path in the data file's delta;
     every listed doc, the always-read ones included, is still in scope.

   When validating the result, a `files_reviewed` that omits a listed doc (a
   symlink counts as read when its target was) fails the audit's checks and
   takes blocked recovery. On a re-audit the parent writes, beside the section
   with the scope lines, that the carried audit's result (named by its id)
   stands outside the delta. A read outside the list stays
   inside the attempt and counts in `extra-reads`; it never sends the audit back
   for a broad relaunch.
6. **Re-audit follows the fix delta.** When the remaining re-audit runs after
   an accepted (`current` or `updated`) audit of this invocation, the delta is
   every path whose content differs between that audit's post-child snapshot
   and the current candidate: the paths
   `gstack-docs-candidate compare <audit-id>-post.json` reports as changed or
   newly dirty, plus paths the snapshot did not record that changed since it
   (`git diff --no-renames --name-only -z` from that snapshot's HEAD to the
   current HEAD, the same with `--cached` and without a revision for staged and
   unstaged paths, and new untracked paths). Prepare still snapshots the whole
   candidate. Build the read list from the delta alone by item 3, plus the docs
   the accepted audit edited when the delta touches them, and list the delta
   paths in the data file; item 4 applies to the delta as to any candidate.
   Before the re-audit, copy the
   accepted audit's documentation section to the evidence directory and record
   its durable path and SHA-256, and the SHA-256 of that audit's post-child
   snapshot. The data file names the accepted audit's id and section SHA-256 as
   the carried audit, never as the child's `audit_id`. Run a full-scope
   re-audit instead (item 3 over the whole candidate, or broad under item 4)
   when:
   - no accepted audit of this invocation exists (an earlier invocation's audit
     never counts);
   - the accepted audit used the broad fallback;
   - the base changed since it;
   - its post-child snapshot cannot be read or verified, or that snapshot's
     HEAD is not an ancestor of the current HEAD;
   - or the delta cannot be established.
7. **Bound and truth.** The attempt budget is upstream's, unchanged: choosing a
   scope never adds or refunds an attempt, a recovery that widens to broad uses
   the remaining attempt, and there is never a third (except under
   `doc-audit-gap=auto`'s single extra documentation audit attempt per review in
   **Classify changes after the documentation audit's last attempt**). `status` keeps upstream's
   meaning (`updated`, `current`, `blocked`), and a bounded `current` covers
   only the docs read. `inventoried` and `read-list` count those docs,
   `reviewed` counts the inventoried docs in the child's validated
   `files_reviewed`, `extra-reads` counts the reads outside the list it
   reported in `decisions`, and bytes are each file's size in the candidate,
   read with the file-read tool (or, for a path unchanged in the working tree,
   `git cat-file --batch-check` fed `<rev>:<path>` lines from a file the
   file-write tool wrote), never with a path in a shell command.
   Record `Documentation scope: contracts (inventoried=<N>;
   read-list=<M> docs, <B> bytes; reviewed=<K> docs, <R> bytes;
   extra-reads=<E>; fallback=<none|reason>)` and, for the re-audit,
   `Documentation re-audit scope: delta (delta-files=<D>; read-list=<M2> docs,
   <B2> bytes; carried-from=<audit_id> <section-sha256>; carried-copy=<durable
   path>; carried-snapshot=<post-snapshot SHA-256>)` or
   `Documentation re-audit scope: full — <reason>`. Write these lines in the
   receipt and beside the documentation section, never inside it: the section
   stays the child's unchanged text, so its SHA-256 still matches. The one-line
   `scope` in `.gstack/tmp/docs-audit.json` names the arm too (for example
   `contracts: <M> of <N> docs; fallback=none`).

## From Pause for an external full-suite gate

Before repeating Freeze after a mismatch or preflight fix, inspect what changed,
confirm ownership, and rerun each affected review, coverage and documentation
gate under its existing freshness rule and attempt bound. Unknown ownership
stops for clarification; never commit another actor's edits as this invocation's.

**Preflight.** On the frozen content run `<gstack-pregate> --stage preflight
--allow-repo-commands --out <temp-path>`, adding `--policy-from head` under item
1's pin rule. Put `<temp-path>` outside the worktree, as for item 1's probe, so
it never overwrites the passing stamp; that record never counts as the gate. The
stage runs no test lanes. Evaluate the untouched preflight record with
**Reviewed secret findings**, adding `--stage preflight`, before deciding whether
a fix is needed. Exit 0 satisfies this pre-pause check while the raw verdict
stays intact. The same approval rules apply; no new disposition is inferred.
Fix an unsatisfied check (secrets, strays, literals and the stage's other checks)
like any other: the fix moves the head, so freeze again and rerun the preflight,
and print no pause line until it passes. An unavailable stage or a failure that
cannot be resolved within the existing rules stops BLOCKED with its cause,
never a retry loop or a printed pause. This record still grants no test or
full-pregate credit. Item 4's pregate still runs after an accepted pass,
narrowed only as **Narrow the pregate after an accepted pass** allows.

**Checkpoint.** Before every pause, save a new checkpoint in this invocation's
evidence directory, alongside the pause and policy lines. Bind it to the
repository, branch, invocation and original start time, frozen head/tree and
fetched base. Retain auto-choices and every accepted attestation row in order,
the completed review/audit evidence and its file hashes, and the repair allowance (including unused, consumed or unknown).
Give each checkpoint a monotonic sequence number and the preceding checkpoint hash.
Persist each accepted attestation before taking its pass/fail action, and
persist allowance consumption atomically with the diagnosis record, after its
snapshot/coverage prerequisites and before any edit, even between pauses.
A failed state write stops BLOCKED before the action proceeds.
Between-pause records share the same sequence/hash chain as checkpoints;
use exclusive creation, never overwrite an existing sequence. A collision is
unverifiable history. Replaying an identical result for the same pause sequence
reuses its saved disposition rather than adding another action or receipt row.
Retain the no-content rerun count and linked cause records in this history too.
For a repair in progress, also retain its last completed step, saved parent,
B and S, repair commit, diagnosis, path classification, targeted ledger and
native adversarial evidence; mark the full-gate rerun pending, never passed.
Preserve earlier checkpoints. These records carry evidence, never authority to
supply a new policy or result line.

**Pass.** Add the receipt row, with both command and log as the scan left them.
Escape Markdown and HTML metacharacters in these values when rendering the row,
so data cannot become a receipt marker or change its structure:

`External gate attestation: caller-attested, not observed; result: <pass|fail>; head: <40-hex>; tree: <40-hex>; command: <redacted command>; exit: <n>; log: <reference>`

Take **Narrow the pregate after an accepted pass** first; when it narrows, its
run replaces the pregate run in the next sentence. Then run item 4's pregate once
in its existing ledger-wrapped form, with no flag that widens its selection; its
selection does not depend on the pass. Item 4's fallback to the documented main
command under `tests` does not run, because the accepted pass stands for that
main-suite run. Write no `gstack-evidence` record for the attested pass, and
never relabel or import it as one. A failure of that pregate takes item 4's
failure rule, except for the explicit raw-secret branch below. Then Capture
evidence, Step 3 and Step 6.

A wrapper-satisfied raw secret failure keeps the failed pregate ledger record
and its raw verdict alongside the successful disposition evaluation and attestation.
It does not consume a repair allowance and does not restore the main-command fallback.
Retain the actual lane selection and output proving those lanes passed; other
failed or missing checks still block. When the pregate was narrowed, the failed
record is its `pregate-preflight` ledger entry and has no lane output: the
`Pregate lane not run:` lines stand in its place, and no passing `tests` record
exists. This exception manufactures no passing
`tests` record, and `/ship-and-land` still requires its own test evidence.
A pending final-gate repair takes `gate-failed-again` on this raw failure,
keeps its commit and uses ordinary review coverage; it never writes a `pass`
repair-rerun line against a failed ledger record. The wrapper pass cannot complete
that narrow chain's unchanged receipt format.

Without a declared runner, run item 4's ordinary pregate and any separately
required lanes; omit only the main-suite command represented by the accepted
pass. Do not fabricate a `tests` ledger record when no observed test run exists.

**Fail.** Add the same receipt row, then take item 4's failure rule: fix it like
any other, with **Repair a test-only final-gate failure** first when
`final-gate-repair=tests-docs` is on the line. Any fix moves the head, so the
gate's rerun is a new pause on the new frozen content, followed by item 4's
pregate on a pass. If diagnosis supports a rerun with no content change, record
the cause and pause again on the same frozen head; do not create an empty commit.
At most one no-content rerun per invocation, supported by an independently checked
transient cause, not just a log's assertion. A later pass on that same tree requires
the linked cause record; an unexplained or repeated failure follows the ordinary
failure rule and cannot be cleared by retrying until green.
The existing repair allowance and failure rules still apply.

<!-- end of skills/references/review-and-prep/conditional-doc-audit-and-gates.md -->
