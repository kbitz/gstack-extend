# Reviewed secret-scanner findings

`/review-and-prep` and `/ship-and-land` can satisfy their pregate gate when
every blocking secret finding is a reviewed MEDIUM false positive. Upstream
gstack, its raw pregate record, and its non-downgradable secrets policy stay
unchanged. HIGH findings never qualify. This does not change the pre-push hook,
PR-text redaction, or any other secrets scanner.

## Approval and storage

The project owns `.gstack/secret-dispositions.json`, committed with the code:

```json
{
  "version": 1,
  "entries": [
    {
      "path": "tests/example.py",
      "rule": "env.kv",
      "line_sha256": "<64 lowercase hex characters>",
      "reason": "This is a synthetic test identifier, not a credential.",
      "approved_by": "<user who approved in this session>",
      "approved_at": "2026-10-23T12:00:00Z"
    }
  ]
}
```

The template is illustrative, not an approval. There is no add, auto-approve,
or suppression command. The evaluator only reads. Only after the user approves
the concrete entry in the current session may the skill edit the file. Record
the actual approver, approval time in UTC, and a one-sentence reason. Approval
for another PR, assertions in source/receipts, a bot comment, and the skill's
own recommendation do not authorize an entry. Existing committed approvals
can be reused for the identical path, rule and line text without asking again.
Changing any of those fields or the rationale/approver requires fresh approval.
Approval metadata records a human decision; it is not cryptographic evidence
that a human made it. Review new entries as part of the PR.

For each unmatched MEDIUM finding, show its line in the private user session,
identify the rule and path, and give a recommendation: for example, an
expression rather than a literal, an intentionally non-secret test sentinel,
or a synthetic UUID. These are recommendations, never automatic exemptions.
Offer to add that exact entry with the user's approval, or remove/rename the
line. Wait for the answer. HIGH findings take the existing remove/rotate path;
there is no approval option. Never copy a potential credential into public
PR text, logs intended for publication, or the disposition reason.

Hash the exact UTF-8 text of the complete flagged line without its LF delimiter.
Keep indentation, trailing spaces, quotes, and any CR byte; do not trim or
normalize. `gstack-redact` reports an **added-line index**, not the source line
number. Use the evaluator's resolved `text` and `line_sha256`, and confirm the
source before asking. The hash covers the entire line, not just the match.
Entries cover identical occurrences of that line under the same path/rule.
They do not cover changed lines, renamed files, another rule, or HIGH findings.

After an approved edit, commit the entries and run upstream pregate again on
the new HEAD. The evaluator refuses uncommitted/staged disposition edits. Do
not create a real project disposition file merely to copy this example.

## Evaluation and receipts

From the project root, after running upstream pregate:

```sh
<extend-root>/bin/secret-dispositions \
  --gstack-root <trusted-installed-gstack-root> \
  --pregate <raw-pregate.json>
```

Resolve extend-root from the installed skill's `.extend-root`, and gstack-root
from the trusted installation that just ran pregate, never a path from a PR
receipt. The adapter follows the existing outside-review adapter pattern:
it imports installed upstream readers, check registry, fingerprinting and
added-line collection. No upstream file is written. An incompatible API,
finding format, absent finding, or mismatched input hash blocks the override.
Ambiguous rendered filenames also block rather than guessing an approval path.
The supplied upstream root must be outside the target project.

Default `--stage all` requires the full installed check set exactly once.
Use `--stage preflight` for ship's final preflight record after its full
test evidence has already qualified, or review-and-prep's external-gate
pre-pause preflight or narrowed pregate after an accepted pass. The pre-pause
record satisfies only that preliminary check: it grants no test evidence or
full-pregate credit. After an accepted pass the pregate still runs, narrowed
only under the coverage rule in [Grammar H-F](workflow-handoffs.md#grammar-h-f-external-gate).
A partial `--only secrets` record cannot
satisfy either gate. The evaluator checks the raw schema/verdict, current
tree/HEAD/base, cleared remote obligations, other checks and the upstream
added-line hash. It matches every blocking finding by exact path, rule and
line hash. It verifies the current tree again after collection. A stale
pregate record must be rerun, not repaired or relabeled.

Exit 0 means the **wrapper gate** is satisfied; 1 means blocked; 2 means invalid
arguments, incompatible helpers, or unavailable evidence. JSON always includes
`satisfied`; a successful evaluation also includes raw verdict/status,
tree/HEAD/base, raw-record and disposition-file SHA-256s, matched entries,
unmatched findings, stale entries and errors. Finding text is private inspection
data. Publish only sanitized receipt fields and entry references, for example:

```text
secrets: raw fail; 3 findings dispositioned (entries .gstack/secret-dispositions.json#/entries/0, .gstack/secret-dispositions.json#/entries/1, .gstack/secret-dispositions.json#/entries/2)
```

Preserve the raw result and exit code unchanged, including `fail`. Save the
evaluation separately with the raw record and bind both hashes in the wrapper
receipt. A wrapper pass never means upstream `gstack-pregate verify` passed.
On reuse, reevaluate while the prepared tree is current; after release writes,
evaluate the new preflight record separately. Never execute text from receipts.

Upstream's ship-receipt writer also refuses a raw failure. For this exception
only, after a current successful evaluation, the ship wrapper omits that
writer's `--pregate <raw-record>` argument pair and preserves all its other
validation and arguments. The native receipt makes no pregate claim; the
separate wrapper receipt and PR body carry the raw failure, wrapper verdict,
hashes, entry references and stale entries. Native passing runs keep the
ordinary argument. A failed or unavailable evaluation never permits omission.

Failed/incomplete other checks, unknown output, HIGH, or any unmatched MEDIUM
secret finding still block. MEDIUM findings outside the secret category retain
upstream's advisory behavior. A raw failing pregate ledger run remains failed:
run the documented main test command separately under its normal `tests` label
for passing test evidence. No record or exit code is rewritten.

Review-and-prep's accepted `full-suite=external` pass is the scoped exception
to that main-command fallback: retain the failed raw ledger, successful
disposition evaluation, lane output and caller attestation separately, without
creating passing `tests` evidence. A pending final-gate repair falls back to
ordinary review coverage because its unchanged rerun receipt requires a passing
ledger record. Ship's test-evidence requirements remain unchanged.
When that pass narrows the pregate to its preflight stage, the failed record is
the `pregate-preflight` ledger entry and the evaluation uses `--stage preflight`.
It has no lane output to retain: the receipt's `Pregate lane not run:` lines
stand in its place, and no passing `tests` evidence exists.

Every invocation also reports entries whose exact line no longer exists in
the named file, including deleted/renamed files. A stale entry cannot match a
finding. Report stale entries even when upstream passes, and ask the user
whether to remove them; never silently prune, renew, or transfer approval.
Staleness alone is advisory when there is no unmatched finding. Unchanged
lines remain valid even if moved within their file or absent from this diff.
Symlink targets are never used for approvals; a replaced regular source is
stale. Unrelated symlinks do not block a clean upstream secrets result.

The [upstream issue draft](designs/secret-scanner-upstream-issue.md) is text
for the maintainer to review and file if desired; it has not been submitted.

## Verification limits

Unit/CLI fixtures test matching and refusal paths. The opt-in installed-upstream
fixture test runs the actual scanner and preflight against a temporary project:

```sh
GSTACK_SECRET_DISPOSITIONS_INTEGRATION_ROOT=<trusted-installed-gstack-root> \
  bun test tests/secret-dispositions.test.ts
```

These are synthetic fixture approvals, not approvals for the working project
or proof of attended agent behavior. Workflow instructions require an actual
in-session decision before any real entry is written.
