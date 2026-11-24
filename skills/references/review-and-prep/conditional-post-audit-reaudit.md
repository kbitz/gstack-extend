# /review-and-prep reference: Post-audit undocumented-internal class, targeted re-audit, and receipt lines

## From Classify changes after the documentation audit's last attempt

1. **`undocumented-internal` class (`owner=not-needed`).** When an existing
   no-owner class (for example `tests-only` or `rename`) fits a change, classify
   uses it; `undocumented-internal` applies only otherwise, and reuse reads no
   documentation so `documentation-scope=contracts` does not change it. A
   non-merge commit `<commit>` on `git rev-list --first-parent S..HEAD` is
   `undocumented-internal` when all three hold:
   - (a) None of its changed paths
     (`git diff --no-renames --no-ext-diff --no-textconv --ignore-submodules=none --no-relative --name-only -z <commit>^ <commit>`)
     is protected: under `docs/`; any `.md`, `.mdx`, `.markdown`, `.rst` or
     `.adoc` file anywhere; a file whose base name, ignoring case, is `README`,
     `AGENTS`, `CLAUDE`, `CHANGELOG` or `SPEC` with no extension or with `.txt`
     (exact names, so source files such as `spec.ts` or `spec.test.ts` do not
     match); the file the project instructions name as the product spec; a path
     under a documentation root recorded in `doc-roots-<audit_id>.txt` for the
     accepted audit; or a path in that audit's snapshot `docs` list (missing or
     unreadable roots are `docs-roots-unreadable`).
   - (b) Classify's bounded re-audit selection for that change — **Bound the
     documentation audit** item 3's literal search over its changed paths (old
     and new names) and the contracts the parent names as defined or changed by
     them, plus their linked authorities — selects no inventoried doc. A parent
     that cannot name a changed non-test path's contracts, or a search that
     fails, is doubt; when (b) selects a doc, classify's own classes (such as
     `already-documented`) decide as today.
   - (c) For each path of the change, the parent (the agent running
     `/review-and-prep`, not a subagent) reads its full diff
     (`git diff --no-renames --no-ext-diff --no-textconv --ignore-submodules=none --no-relative <commit>^ <commit>`)
     and decides whether it changes user-visible text (messages, prompts, skill
     or help text), a flag, a help line, a config key or its default, an
     environment variable or a command a person runs (the last three read the
     criterion so that it only adds asks). The parent never reads a model's
     reply text to decide. Any yes, any doubt, or a diff the parent cannot read
     in full fails the class and makes the change `documented-behavior`; the
     `Post-audit change:` line's `reason=` then names the path and why
     (`user-visible <path>`, `doubt <path>` or `protected-path <path>`).
2. **Qualifying base merges (`class=base-merge`, `owner=not-needed`).** Under
   the value, classify's not-applied condition "the base changed since the
   accepted audit" does not count a qualifying base merge on the first-parent
   walk. The fetched base tip is the verified base remote's tip fetched in this
   invocation at the trigger (the fetch the later-change and readiness rules
   use); a failed fetch is `base-fetch-failed`. A merge commit `<merge>` on
   `git rev-list --first-parent S..HEAD` qualifies only when all of these hold
   in order:
   - `<merge>` has exactly two parents (`git rev-parse <merge>^@` prints two
     lines, `<merge>^1` and `<merge>^2`; an octopus or non-merge commit is
     `merge-unqualified`), and
     `git merge-base --is-ancestor <merge>^2 <fetched base tip>` exits 0
     (otherwise `merge-unqualified`).
   - Only after the two-parent check passes (because on a non-merge commit it
     prints the ordinary diff),
     `git log -1 --remerge-diff --no-renames --no-ext-diff --no-textconv --ignore-submodules=none --no-relative --no-show-signature --format= --name-only -z <merge>`
     exits 0 and prints nothing, which means no hand-resolved conflict, no edit
     made inside the merge and a merge Git's default strategy reproduces. An
     error from `--remerge-diff` on Git older than 2.36 is `git-too-old` (naming
     the `git --version` output and `needs Git 2.36+`); any listed path is
     `merge-unqualified`, so `class=base-merge` is the only merge outcome.
   - Its two-way merge guard holds across the base side's changed paths
     (`git diff --no-renames --no-ext-diff --no-textconv --ignore-submodules=none --no-relative --name-only -z <merge>^1...<merge>^2`)
     and the pull request's own changed paths
     (`git diff --no-renames --no-ext-diff --no-textconv --ignore-submodules=none --no-relative --name-only -z <fetched base tip>...HEAD`);
     any failure is `merge-guard-failed`:
     (1) **Overlap:** the base side's changed paths share none with the pull
     request's own changed paths;
     (2) **Forward:** no documentation file among the pull request's own changed
     paths names a base-side changed path;
     (3) **Reverse:** no documentation file among the base side's changed paths
     names one of the pull request's own changed paths or a contract the parent
     names for them.
     A documentation file is a 1(a) protected path. Both searches use **Bound
     the documentation audit** item 3's literal search under its history rule:
     changelogs, roadmaps, backlogs
     and archived plans are never searched files by a mention alone, and
     `CHANGELOG.md` and `VERSION` are never search terms. The guard alone judges
     base-side paths; item 4's broad fallback, classify's not-applied checks and
     1(a)–1(c) apply only to the first-parent changes' own contributions.
3. **One extra audit attempt.** When upstream's attempt budget (initial plus one
   re-audit) is exhausted and classify, with these additions, left any
   change `owner=needed` or reuse was not applied (never while upstream's
   re-audit attempt remains or when reuse applied), blocked recovery treats one
   more attempt as remaining and uses it exactly as its step 2 uses a remaining
   attempt (only when the audited inputs changed or a concrete correction or
   reviewed repair is available; Prepare with current inputs and a fresh id and
   snapshot; validate through Parent processing; under
   `documentation-scope=contracts`, scoped as the remaining re-audit would be).
   It is authorized only when all of these hold:
   - Blocked recovery's safety checks have passed. A non-waivable failure or
     unverifiable safety check stops before this allowance is considered.
     Preserve a stopped child's partial edits and stop on `dirty-tree`. For any
     dispatch require a clean tree and a successful base fetch.
   - It would be the review's first extra audit: this invocation is not a
     continuation (`/review-and-prep continue`), and the counter file
     `doc-audit-extra.txt` in this invocation's evidence directory, which a
     resume reuses, holds no `Doc-audit extra: action=extra-audit` line (an
     absent file means none). A file that cannot be read or any line that fails
     the `Doc-audit extra:` template below counts as one already used. Among
     well-formed lines, only `action=extra-audit` lines count. The extra-audit
     allowance belongs to one invocation and its resumes; a continuation runs
     none; an ordinary new `/review-and-prep` run on the same pull request, such
     as one after a `/ship-and-land` hand-back, is a new review round with
     upstream's fresh budget and its own allowance.
   - The base fetch at the trigger succeeded; a failed fetch means no extra
     audit (`Doc-audit extra: action=today; … reason=base-fetch-failed`).
   - The pull request changes no SPEC: no path in
     `git diff --no-renames --no-ext-diff --no-textconv --ignore-submodules=none --no-relative --name-only -z <fetched base tip>...HEAD`
     is a SPEC. A path is a SPEC when its base name, ignoring case and with
     every extension removed, is `SPEC`, at any depth (`SPEC`, `SPEC.md`,
     `SPEC.txt`, `docs/SPEC.md`, `api/spec.rst`), or when it is the file the
     project instructions name as the product spec; because the list uses
     `--no-renames`, a deleted, added or renamed spec (old and new names) all
     count. This predicate also matches source basenames such as `spec.ts` or
     `spec.test.ts` for the extra-attempt decision only.
   When an authorization condition or step 2's condition fails, record
   `Doc-audit extra: action=today` with that reason and `result=none`, then take
   the owner stop. Before launching the extra attempt,
   the parent appends the `Doc-audit extra: action=extra-audit` line to
   `doc-audit-extra.txt` first, so an interrupted launch counts as used on
   resume. The launch runs `gstack-docs-candidate attempt` like any launch; an
   `ATTEMPT: not-counted` install refusal lets upstream's one relaunch run as
   the same extra attempt with no new `action=extra-audit` line. If
   `gstack-docs-candidate attempt` refuses either launch (exit 3, STOP),
   including when the install-refusal allowance was already used before the
   first extra launch, the extra attempt is spent:
   record `result=refused`. When the attempt ends, the parent appends an
   `action=result` line with its outcome. On resume, reconcile
   any interrupted extra launch before deciding whether an attempt remains. An
   `action=extra-audit` line with no later `action=result` line is an
   interrupted extra launch: the parent first runs blocked recovery step 1
   (confirm the child stopped), then verifies the original Prepare snapshot's
   pre-dispatch hash, invocation and audit ID before Parent processing. Missing
   or mismatched proof takes the non-waivable stop. Before Parent processing,
   enforce any saved non-waivable failure for that attempt.
   Apply the stopped-state evidence rule
   above even when there is no saved reconciliation. If the required proof is
   missing or unverifiable, record `result=interrupted` and take the non-waivable
   stop. With verified proof, validate the saved output through upstream's
   Parent processing (collect, check output, check ownership, check freshness
   and run the verified-base cap check above).
   Record `result=accepted` only when it passes. Otherwise record
   `result=interrupted` with the failure code in evidence.
   For any blocked or failed result, including a refusal or
   interruption, use the same safety-gated fallback above. Reuse carries the
   earlier accepted audit only. If fallback declines reuse, take the existing
   owner stop. The extra attempt remains spent. A later change after an
   accepted extra audit with no attempt left reaches the trigger again:
   classify, with these additions, runs against the extra audit as the last
   accepted audit; no second extra audit runs; the owner stop follows otherwise.
4. **Recording, status lines and veto line.** When this paragraph group applies,
   use this extended template for the `Post-audit change:` line:

   `Post-audit change: <full commit SHA>; paths=<n>; class=<rename|tests-only|test-tooling|todos-only|mechanical-correction|already-documented|undocumented-internal|base-merge|documented-behavior>; owner=<not-needed|needed>; carried-audit=<audit_id> <section-sha256>; reason=<one line>; evidence=<reference>`

   `carried-audit=<audit_id> <section-sha256>` names the reused audit. A reuse
   writes no new `record audit`. When the carried audit lacks a final binding,
   the compact receipt's `- documentation:` line renders `not-run`; an
   existing exact-bound audit keeps its own compact status. At each trigger,
   record `post-audit: active` and one `Post-audit change:` line per classified
   commit, or `post-audit: not applied — <reason>` when classification cannot
   proceed. Name the trigger phase (`pre-attempt`, `blocked-re-audit`,
   `failed-re-audit` or `post-exhaustion`) and decision reason in `reason=`. Write
   one status line beside the documentation section (never inside it), using
   the latest trigger's reuse decision:
   - when a trigger is reached with both companions present:
     `doc-audit-gap: active; reuse=applied` or
     `doc-audit-gap: active; reuse=not-applied <token> <context>; evidence=<evidence locator>`,
     with `<token>` one of `walk-missed-snapshot`, `dirty-tree`,
     `base-fetch-failed`, `merge-unqualified`, `merge-guard-failed`,
     `git-too-old`, `docs-roots-unreadable`, `command-failed`, or
     `classify-not-applied` followed by classify's own reason. Use
     `reuse=applied` only when classify continues on the carried audit, which
     can include an empty walk with a valid audit. A failed precondition or
     unqualified merge records `post-audit: not applied — <reason>`. If classify leaves
     `owner=needed`, has no accepted audit or declines reuse for another
     classify condition, use `classify-not-applied` with that reason, unless a
     more specific token applies. Record the decline even if the next audit
     succeeds. A fresh accepted audit replaces the carried audit for readiness.
     Keep all superseded `Post-audit change:` rows, including `owner=needed`,
     in evidence only. When the fresh accepted audit covers the final binding
     and no later trigger applies, record `post-audit: not applied — fresh audit covers current binding`,
     retain the latest decline on `doc-audit-gap:`, and emit zero current
     `Post-audit change:` rows. An extra audit gets its own `Doc-audit extra:` lines;
   - when the value did nothing:
     `doc-audit-gap: not applied — <token> <context>; evidence=<evidence locator>`,
     with `<token>` one of `full-suite-absent`, `post-audit-absent`, or
     `no-trigger` (`no post-audit freshness check or re-audit failure reached`).
     With both companions present and no trigger, keep
     `post-audit: not applied — no exhausted-audit freshness check reached`.
   See [`docs/workflow-handoffs.md#doc-audit-gap-reasons`](https://github.com/kbitz/gstack-extend/blob/main/docs/workflow-handoffs.md#doc-audit-gap-reasons)
   for each token's meaning and caller fix. Context: `git-too-old` names the
   `git --version` output and `needs Git 2.36+`; `command-failed` names the
   command name and its exit status; a path-bearing token names at most its
   first three paths. Redaction: a reason carries no stderr text and no remote
   URL. Per extra-audit decision, write in the full receipt (beside the
   documentation section) and append to `doc-audit-extra.txt`:
   `Doc-audit extra: action=<extra-audit|result|today>; audit=<carried audit_id> <section-sha256>|none; new-audit=<audit_id|none>; result=<accepted|blocked|invalid|refused|interrupted|none>; head=<full SHA>; reason=<one line>; evidence=<evidence locator>`
   (`audit=none` when this invocation has no accepted audit). When the value
   continues past a gap (any `undocumented-internal` or `base-merge` line, or an
   accepted extra audit), the receipt and the PR body carry one veto line under
   **Take recommended fix-scope options without asking**:
   `Auto-chosen (veto by replying on this PR): documentation audit gap (blocked recovery's owner question) → <continue on carried audit <audit_id>|extra audit <audit_id>>`
   Append the classes used, any qualifying merge and the offered options as
   plain-text details after the chosen option on the same line. The offered
   options are continue on the carried audit, run the extra audit, stop for
   repair, accept a named risk.

<!-- end of skills/references/review-and-prep/conditional-post-audit-reaudit.md -->
