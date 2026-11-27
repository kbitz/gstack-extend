# /review-and-prep reference: Refresh a prepared PR after a base move

## From 1. Establish the branch, PR, and review inputs

### A. Invocation and refusal

Enter on the `refresh` argument or exact first line `Run /review-and-prep refresh`. Validate in order before mutation. H-F continuations use G.

1. **Cause (`cause`).** Require `refresh` and exactly one `Cause: base_moved` line, from the invocation prompt only. Otherwise refuse with `reason: cause`.
2. **Live PR and checkout state (`state`).** Require Step 1's verified feature branch and exact open PR with `isDraft: false` and `HEAD` equal to `headRefOid`. Apply E's checkout checks. A failure refuses with `reason: state`.
3. **Receipt corroboration (`receipt`).** Corroborate the PR's latest preparation receipt under Boundaries' rule:
   - the running account authored the receipt comment, and every editor in its complete GraphQL `userContentEdits` history is the running account (an unreadable edit history counts as unverified);
   - it reads `Status: prepared`, both its `<!-- review-and-prep:receipt:<sha> -->` marker and `Prepared HEAD:` name the PR's `headRefOid`, and its tree matches `git rev-parse HEAD^{tree}`;
   - the base SHA in `Prepared HEAD:` is an ancestor of that head. Keep this earlier base for check 4;
   - verify that the plan or agreed scope bytes hash to the `Plan:` SHA-256. Require `Unresolved: none recorded` and retain any corroborated `reviewRestrictionResolved: true`. Read its Greptile and policy values as data;
   - confirm no newer `review-and-prep:paused:` or `review-and-prep:stopped:` record exists on the PR, and no Greptile run is pending (using `resume-review-records`'s rules);
   - resolve `Full receipt:` by Step 6's locator rules and verify its SHA-256 before converting to draft and on reread. For a refresh receipt, follow each predecessor comment back to the original full review. At each link verify the same PR and plan, author and complete edit history, and the `Full receipt:` digest. Require the predecessor's receipt marker and `Prepared HEAD:` to name the later receipt's `reviewed` head, with matching tree and ancestor base. Require strict head ancestry. The original full receipt supplies the matrix and any required user-test evidence;
   - if the prior recorded run is readable, require a prepared finish that matches the receipt. Missing or unreadable recorded state follows C's disclosure fallback.
   Missing, uncorroborated, mismatched, or superseded receipts, or a pending Greptile run, refuse with `reason: receipt`.
4. **Base tip currency (`current`).** Fetch and pin the verified target base. Require that it descends from the receipt's earlier base, or refuse with `reason: receipt`. Run `git merge-base --is-ancestor <fetched-base> HEAD`. Exit 0 means `reason: current`. Continue only on exit 1. Refuse with `reason: state` if the fetch or ancestry check cannot be verified.

On refusal, create no evidence directory, run state, commit, push, draft toggle or PR write. Print inline:

```text
Refresh refused: review-and-prep-refresh/v1; reason: <cause|state|receipt|current>
<one clear sentence explaining the refusal; nothing was changed>
Stage handoff: stage-handoff/v1; stage: review; next: none; status: needs-context; head: <HEAD or none>; plan-sha256: none
```

Run Telemetry finish with `--outcome error` and stop.

After validation this route supersedes the ready-PR stop. Evaluate Step 1's review policy before B. C owns evidence creation and run-state start.

### B. Return to draft

Recheck A's checkout, receipt, holds, base and `isDraft: false` before converting the PR. If a check fails, take A's refusal. A pre-readiness receipt cannot lift a draft hold.

1. Name any workflows that `converted_to_draft` and `ready_for_review` events trigger (from Step 1's CI-trigger read).
2. Convert the PR back to draft once: `gh pr ready "<number>" --repo "<base-owner/repo>" --undo`.
3. Even on error, read back the same open PR, branch, base, head and draft flag. Stop BLOCKED on an error, closure or mismatch. Report the state without retrying.

Never toggle a PR to draft more than once per refresh, and never toggle before validation passes.

### C. Evidence and run state

Create the evidence directory as in Step 1, prefixing its basename with `refresh--` for H-F routing. Reserve that prefix for refresh invocations. In `refresh-1.md` bind `Cause: base_moved`, `R`, its tree and reviewed base, and A's verified chain (comment URLs, full receipt locators and SHA-256 hashes). Include any corroborated `reviewRestrictionResolved: true` and the disclosure evidence below in that same file before hashing it.

Use the verified full receipt's run-state locator and corroborate the prior prepared finish by head, tree, base and plan SHA-256. Save the disclosure values verbatim in `refresh-1.md`. If the finish cannot be corroborated or the verified full receipt has G's `Disclosure evidence: unavailable` line, record that marker instead.

While recording, `build start` uses A's plan binding and the invocation policy. Attach `--evidence refresh-1.md` to checkpoints except G's invalid-evidence exit. Record the `greptile` gate with the prior `--greptile-value` and run link.

If evidence cannot be saved after drafting, stop BLOCKED and report the draft for ordinary preparation.

### D. Merge

Use Step 2's **Merge the latest base before review**. Fetch a verified descendant of the last merged base or A's earlier base. Merge with `git merge --no-edit <base-sha>`. On unverifiable fetch or ancestry, use F's `delta-unverified` after a committed merge and BLOCKED before it. After B or C, never emit A's refusal.

- Resolve every conflict within the agreed scope.
- Resolve a generated file only by rerunning the generator command named in the repository's instructions; never hand-edit generated output.
- Commit the merge locally. If it cannot be completed within scope, stop BLOCKED with the PR draft and report the checkout state and conflicts.

For D's BLOCKED exits, use `build finish --outcome blocked --base <last-merged-base> --stop-reason merge-blocked` (use A's earlier receipt base before the first committed merge). Then `derive` and render `final` while recording.

### E. Delta facts and classification

Pin the clean merge or authorized resolution fix as `S` and record its tree. Run this fence with `<workspace>`, `R`, fetched `B` and `S`. It includes discarded base changes and identical edits on both sides. Accept only exit 0 and a complete report whose `REFRESH_DELTA_DONE` count matches its rows and whose `head` equals `S`.

```bash
bun --no-env-file --config=/dev/null --no-install -e '
const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const [ws, revR, revB, candidate] = process.argv.slice(1);
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const gitAt = (cwd, args) => utf8.decode(execFileSync("git", ["-C", cwd, ...args], {
  stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024,
}));
const fail = (reason) => { console.log(`REFRESH_DELTA_UNVERIFIED: ${reason}`); process.exit(1); };
try {
  const root = gitAt(ws, ["rev-parse", "--show-toplevel"]).trimEnd();
  const git = (args) => gitAt(root, args);
  const diffPaths = (left, right) => new Set(git([
    "diff", "--no-relative", "--no-renames", "--ignore-submodules=none", "--name-only", "-z", left, right, "--",
  ]).split("\0").filter(Boolean));
  const operations = ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-apply", "rebase-merge", "sequencer"];
  if (operations.some(name => existsSync(resolve(root, git(["rev-parse", "--git-path", name]).trimEnd())))) {
    fail("git-operation-in-progress");
  }
  const bases = git(["merge-base", "--all", revR, revB]).trim().split("\n").filter(Boolean);
  if (bases.length !== 1) fail(bases.length === 0 ? "no-merge-base" : "multiple-merge-bases");
  const mb = bases[0];
  const head = git(["rev-parse", "HEAD"]).trim();
  if (head !== candidate) fail("candidate-moved");
  try {
    git(["merge-base", "--is-ancestor", revR, head]);
    git(["merge-base", "--is-ancestor", revB, head]);
  } catch {
    fail("head-missing-reviewed-or-base");
  }
  if (git(["ls-files", "-v", "-z"]).split("\0").some(entry => /^[a-zS]/.test(entry))) fail("hidden-index-entry");
  if (git(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"])) fail("unclean-worktree");
  const inR = diffPaths(mb, revR);
  const inB = diffPaths(mb, revB);
  const againstBase = diffPaths(revB, head);
  const changed = diffPaths(revR, head);
  for (const path of inB) {
    if (inR.has(path) || againstBase.has(path)) changed.add(path);
  }
  for (const path of changed) {
    const r = inR.has(path), b = inB.has(path);
    const side = b && r ? "both" : b ? "base-only" : "refresh-only";
    const merged = againstBase.has(path) ? "other" : "base";
    console.log(`REFRESH_DELTA: ${JSON.stringify({ path, side, merged })}`);
  }
  if (git(["rev-parse", "HEAD"]).trim() !== head) fail("candidate-moved");
  console.log(`REFRESH_DELTA_DONE: ${JSON.stringify({ count: changed.size, head })}`);
} catch {
  fail("git-or-path-read-error");
}
' "<workspace>" "<reviewed-head>" "<base-tip>" "<candidate-head>"
```

Classify every reported path conservatively at file level:

- **`base-only`**: `side` is `base-only` and `merged` is `base`.
- **`resolution`**: `side` is `both`, and the path is one of:
  - prose under the shared docs-only classification read from the base tip (skill and prompt instructions are implementation, per Step 1's rule, even when stored in Markdown);
  - the project's backlog or intake records (for example `TODOS.md`, `docs/TODOS.md`, or `docs/todos/*.md`);
  - a generated file regenerated as in Section D.
- **`reviewed-code`**: anything else. This includes every other `both` file (even a clean auto-merge), every `refresh-only` path, and every `base-only` path whose `merged` value is `other`.

Evaluate base-only behavior impact in both dependency directions. Escalate when code, tests, configuration, skills or prompts on one side call, import, read, or test modified behavior on the other. Also escalate when the base changes a contract the reviewed diff (`merge-base..R`) implements, changes the approved scope bytes, or invalidates recorded user-test evidence.

### F. Escalation exit

Use the reason for the failed step. Within classification, `reviewed-code-conflict` takes precedence over `reviewed-behavior-change`:

- `reviewed-code-conflict`: any file classified as `reviewed-code`;
- `reviewed-behavior-change`: a `base-only` change alters reviewed behavior;
- `delta-finding`: a delta-review defect remains after the single allowed resolution fix round, or requires editing a non-`resolution` file;
- `delta-unverified`: the delta facts, later base tip, or restored refresh evidence cannot be verified;
- `final-gate-failed`: the final gate fails on the merged head, or an external gate returns `fail`.

On escalation:

1. Keep the PR draft and candidate local without pushing. Report local and published heads, including any earlier draft push.
2. While recording, run `build finish --outcome escalated --base <last-merged-base> --stop-reason <reason>`, then `derive` and render `final`.
3. End the turn with:
   - affected files, reason and local state. Direct ordinary full `/review-and-prep` on the same PR in this workspace;
   - the escalation line:
     `Refresh escalated: review-and-prep-refresh/v1; reason: <token>; reviewed: <40-hex>; head: <40-hex>; base: <40-hex>; files: <JSON array of repository-relative paths>`
     Use an empty array when no affected path can be identified.
   - the rendered stage line (`Stage handoff: stage-handoff/v1; stage: review; next: review-and-prep; status: stopped; head: <40-hex>; plan-sha256: <64-hex or none>`), or that same stage line inline.
4. Run Telemetry finish with `--outcome blocked`.

<!-- end of skills/references/review-and-prep/conditional-base-move-refresh.md -->
