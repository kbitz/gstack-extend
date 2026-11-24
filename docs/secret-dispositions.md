# Reviewed secret-scanner findings

`/review-and-prep` and `/ship-and-land` can satisfy their pregate gate when
every blocking secret finding is a reviewed MEDIUM false positive. Upstream
gstack, its raw pregate record, and its non-downgradable secrets policy stay
unchanged. HIGH findings never qualify. The pre-push hook and pregate remain
unchanged; PR-text scanning gains only the run-bound known-safe rule in
`scan-text` below.

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
normalize. A finding's number is not always a source line number; see
[finding locations](#finding-locations). Use the evaluator's resolved `text`
and `line_sha256`, and confirm the source before asking. The hash covers the
entire line, not just the match.
Entries cover identical occurrences of that line under the same path/rule.
They do not cover changed lines, renamed files, another rule, or HIGH findings.

After an approved edit, commit the entries and run upstream pregate again on
the new HEAD. The evaluator refuses uncommitted/staged disposition edits. Do
not create a real project disposition file merely to copy this example.

### Finding locations

Upstream renders a finding's location in one of two forms. The evaluator accepts
each only for the files that take it:

| Form | Files | `N`, and the reported `added_line` |
|---|---|---|
| `line N` | A Python or Dart file (`.py`, `.pyi`, `.dart`, any case) that upstream reads whole, tracked or untracked | The line number in the working-tree file. `N` must be one of the part's `keep` numbers, the lines the branch added. |
| `added line N` | Every other file, and a tracked Python or Dart file that upstream cannot read whole or whose working copy no longer holds the diff's added lines at their numbers | The position among that file's added lines, not a source line number. |

The wrong form for a file, or `line N` outside `keep`, is the error `finding
location does not match upstream added-line selection`, and the result stays
unsatisfied. A finding on a line the branch did not add cannot be satisfied by
any entry, even one whose path, rule and line hash match; that includes an
`engine.` finding, which upstream's own filter lets through anywhere in the
file. The JSON field keeps the name `added_line` for both forms.

Since upstream gstack `1.103.0.0` (qualified at upstream revision
`f7402213a04d720eed5c50557c0ba528a69af4bd`, version `1.103.1.0`), upstream
formats each finding's file name with `displayPath(f.file)` from
`lib/pregate/allowlist.ts`, which JSON-quotes and `\uXXXX`-escapes paths
containing C0 controls (`\x00-\x1f`), DEL (`\x7f`), C1 controls (`\x80-\x9f`),
or bidi-override characters (`\u202a-\u202e`, `\u2066-\u2069`). The evaluator
matches each part against both its `displayPath(file)` form and its raw `file`
form (when they differ, preserving compatibility with pre-`1.103.0.0` finding
output) and fails closed with `finding path is missing or ambiguous` whenever
fewer or more than one part matches. This ensures a quoted C1/bidi filename
cannot drop out of candidate matching and let a suffix-colliding filename
borrow another path's approval.

Anchor checks are advisory and separate from runtime evaluation:
[`bin/upstream-check`](upstream-check.md#drift-anchor) checks both the
`secrets.ts` finding-location anchors (`secret-dispositions.location.1..2`) and
the raw bytes of `displayPath()` in `lib/pregate/allowlist.ts`
(`secret-dispositions.display-path.1`) before a stage runs, while
`bin/secret-dispositions` enforces the finding-line grammar and ambiguity rules
at runtime without importing `allowlist.ts`.

In `.gstack/secret-dispositions.json`, `entries[].path` always stores the raw
repository path (never the outer quotes added by `displayPath`), and
`line_sha256` hashes the raw source line. Commit C1 or bidi-override characters
in `entries[].path` as valid single-backslash JSON `\uXXXX` escapes so git diffs
remain auditable (do not double-escape the backslash, which decodes to a literal
`\` that `safePath()` rejects):

```json
{
  "version": 1,
  "entries": [
    {
      "path": "dir/file\u202e.py",
      "rule": "env.kv",
      "line_sha256": "<64 lowercase hex characters>",
      "reason": "Synthetic test fixture in a bidi-named file, not a credential.",
      "approved_by": "<user who approved in this session>",
      "approved_at": "2026-11-24T12:00:00Z"
    }
  ]
}
```

Path eligibility is asymmetric across control ranges: `safePath()` allows C1
control and bidi-override characters (so those files can be dispositioned using
their raw path), while C0 control characters (`\x00-\x1f`), DEL (`\x7f`), and
backslashes (`\`) are refused by `safePath()` and cannot be dispositioned.
Because `bin/secret-dispositions` writes raw UTF-8 JSON to stdout, pipe its
output through an escaping formatter when inspecting findings on C1/bidi
filenames in a terminal:

```sh
<extend-root>/bin/secret-dispositions \
  --gstack-root <trusted-installed-gstack-root> \
  --pregate <raw-pregate.json> \
  | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin), ensure_ascii=True, indent=2))'
```

### Refusal reasons and recovery

Every refusal leaves the repository, `.gstack/secret-dispositions.json`, and the
raw pregate record untouched (no side effects). Keep raw finding text in the
private session only; never paste potential credentials into PR text or public
logs.

| Exit | Refusal message | Diagnosis | Safe recovery | Human escalation |
|---|---|---|---|---|
| 2 | `unsafe source path` | CLI pre-`evaluate()` path check rejected a part path (C0/DEL, `\`, absolute, `.`/`..`/`.git`, or drive prefix) before calling `evaluate()`. | Do not retry unchanged. Inspect the filename privately; rename or remove the file, or switch to upstream `gstack-pregate` policy `allowlist` as a full replacement (it cannot be combined with `.gstack/secret-dispositions.json` on the same failing check). | Confirm rename/removal or upstream policy change with the user. |
| 2 | `invalid disposition entry <N>` | `.gstack/secret-dispositions.json` entry `<N>` failed schema or `safePath()` validation (for example, double-escaped `"\\u202e"` decoding to a literal `\`, bad SHA-256, or invalid UTC timestamp). | Fix the malformed entry (use single-backslash JSON `\uXXXX` escapes for C1/bidi paths and raw repository paths without outer `displayPath` quotes), commit, and rerun pregate + evaluator. | Get fresh user approval in-session for any edited entry fields. |
| 2 | `TypeError` (malformed `parts` before `evaluate()`) | Installed upstream `addedLines()` returned a non-array or null value before `evaluate()` ran (`cli.ts` maps over `parts`). | Do not retry unchanged. Run `bin/upstream-check --gstack-root <root>` and `/gstack-extend-upgrade`; hold if upstream drifted. | Report the upstream version mismatch and decide whether to hold. |
| 2 | `unrecognized upstream added-line part shape` | `readPart()` / `evaluate()` rejected an unknown or malformed part object (`null`, primitive, array, missing/non-string `file`, non-string `text`, non-array `texts`/`keep`, or non-array `parts`). | Do not retry unchanged. Run `bin/upstream-check --gstack-root <root>` and `/gstack-extend-upgrade`; hold until the extension is qualified for the installed upstream. | Escalate upstream schema drift before proceeding. |
| 1 | `finding path is missing or ambiguous` | Zero or more than one added-line part matched the finding's rendered path (suffix collision, look-alike C1/bidi filename, or upstream `displayPath` quoting drift). | Run `bin/upstream-check --gstack-root <root>` first; if `display-path.1` or `location.1` drifts, run `/gstack-extend-upgrade` or hold. Otherwise inspect the colliding filenames privately via the escaping formatter above and rename/refactor the colliding file (requiring fresh approval for the new path), or replace with upstream `gstack-pregate` policy `allowlist` (full replacement only; cannot mix with `.gstack/secret-dispositions.json` on the same failing check). | Confirm filename rename/refactor or hold decision with the user. |
| 1 | `finding location does not match upstream added-line selection` | A finding used `line N` outside `part.keep` (for example, an `engine.` finding on an unchanged line) or mismatched `line N` vs `added line N`. | Do not retry unchanged. Verify whether the finding is on an unchanged line (cannot be dispositioned) or run `bin/upstream-check --gstack-root <root>` to check `secret-dispositions.location.2`. | Ask the user to remediate the underlying line or update upstream policy. |
| 1 | `finding is in a binary part and cannot be dispositioned` | Upstream marked the part `binary: true`; binary findings are never eligible for `.gstack/secret-dispositions.json`. | Do not retry unchanged. Remove or rotate the flagged binary content, or replace with upstream `gstack-pregate` policy `allowlist` if appropriate (full replacement only). | Escalate to the user for removal, rotation, or upstream policy handling. |
| 1 | `finding does not resolve to an exact current source line` | `safePath(file)` rejected the path (for example, C0/DEL) or the working-tree source line no longer matches the collected part text at that line. | Inspect the file path and working tree privately. If the tree changed after pregate ran, rerun `gstack-pregate` on the current committed HEAD and re-evaluate; if `safePath()` rejected the path, rename/remove the file. | Confirm any source edit or rename with the user. |

## Evaluation and receipts

From the project root, after running upstream pregate:

```sh
<extend-root>/bin/secret-dispositions \
  --gstack-root <trusted-installed-gstack-root> \
  --pregate <raw-pregate.json>
```

For a self-contained synthetic first evaluation (requires Bun >= 1.3.3, an
installed gstack checkout, and a clean committed branch with a synthetic MEDIUM
finding — do not use this to approve real project findings):

```sh
EXTEND_ROOT=$(cat "$HOME/.claude/skills/gstack-extend/.extend-root")
GSTACK_ROOT="$HOME/.claude/skills/gstack"
RAW_PREGATE="/tmp/pregate-synthetic.json"

"$GSTACK_ROOT/bin/gstack-pregate" --base main --stage preflight --out "$RAW_PREGATE"
"$EXTEND_ROOT/bin/secret-dispositions" \
  --gstack-root "$GSTACK_ROOT" \
  --pregate "$RAW_PREGATE" \
  --stage preflight
# Expect exit 0 with {"satisfied":true,"raw_verdict":"fail",...,"matched":[...],"errors":[]}
# when every blocking MEDIUM finding has a committed matching entry, or exit 1 with
# "unmatched":[...] when an entry is missing.
```

Resolve extend-root from the installed skill's `.extend-root`, and gstack-root
from the trusted installation that just ran pregate, never a path from a PR
receipt. The adapter follows the existing outside-review adapter pattern:
it imports installed upstream readers, check registry, fingerprinting and
added-line collection. No upstream file is written. An incompatible API,
finding format, absent finding, or mismatched input hash blocks the override.
Ambiguous rendered filenames also block rather than guessing an approval path.
The supplied upstream root must be outside the target project.

The evaluator reads both upstream added-line part shapes (`text` from older
installs and `texts` with one reading per non-binary file from current ones),
hashing the raw parts as upstream returns them. Its shape reader rejects
unrecognized parts with `unrecognized upstream added-line part shape` (exit 2);
malformed collection values or paths rejected earlier by the CLI also exit 2,
with that earlier check's error. A finding in a part upstream
marks binary reports `finding is in a binary part and cannot be dispositioned`
(exit 1) and cannot be satisfied by any entry.

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
added-line hash. It matches every blocking finding by exact path, rule,
accepted location form and line hash. It verifies the current tree again after
collection. A stale pregate record must be rerun, not repaired or relabeled.

Exit 0 means the **wrapper gate** is satisfied; 1 means blocked; 2 means invalid
arguments, incompatible helpers, or unavailable evidence. JSON always includes
`satisfied`; a successful evaluation also includes raw verdict/status,
tree/HEAD/base, raw-record and disposition-file SHA-256s, matched entries,
unmatched findings, stale entries and errors. The one exception is a launcher
refusal: `bin/secret-dispositions` checks the [Bun prerequisite](installation.md#requirements)
before either command starts, and a refusal writes its diagnostic to stderr,
prints no JSON and exits 1. Finding text is private inspection
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

## Known-safe run values in PR text

`/review-and-prep` scans PR title, body and comment text from the repository
root through `scan-text`:

```sh
<extend-root>/bin/secret-dispositions scan-text \
  --gstack-root <trusted-installed-gstack-root> \
  --from-file <file> \
  [--evidence-dir <dir>] \
  [--pr-url <url>]
```

- `--gstack-root <dir>` (`<root>/bin/gstack-redact` must be a regular executable
  file outside the project) and `--from-file <file>` (a regular file, not a
  symlink) are required. `--evidence-dir <dir>` and `--pr-url <url>` are
  optional; each flag may appear at most once. With neither optional flag,
  `scan-text` returns upstream's result with status `none`.
- `--evidence-dir <dir>` must be an existing directory (not a symlink), given as
  an absolute path with no empty, `.` or `..` segments, control characters or trailing slash,
  whose realpath lies strictly below `<state-root>/projects/<one segment>/review-and-prep/`
  (where `<state-root>` is `${GSTACK_STATE_ROOT:-${GSTACK_HOME:-$HOME/.gstack}}`;
  empty values count as unset and relative values are ignored) or
  `$HOME/scratch/review-and-prep/`. The scanner matches the exact supplied and
  canonical absolute paths and their `~/` spellings when under the corresponding
  `$HOME` spelling, including when HOME and the path use different aliases. The
  scanner also matches the directory's final segment where it begins a relative
  path (followed by `/`), which is the evidence locator `/review-and-prep`
  publishes.
- `--pr-url <url>` must match `^https://github\.com/[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9._-]+/pull/[1-9][0-9]*$`.
  Only `<prUrl>#issuecomment-<digits>` occurrences are matched; nothing else in
  the URL is a component.
- An occurrence is kept only when delimited after: the text ends there, or the
  next character is not `[A-Za-z0-9_]` and is not a space, `.` or `-` followed
  by an ASCII digit. Phone-style joins are refused when an ASCII digit follows
  `(` (optionally preceded by one of those separators) or `)` (optionally
  followed by one of them). A terminal `)` without following digits remains a
  delimiter. Each maximal ASCII digit run inside a kept evidence-dir
  occurrence is an `evidence-dir` component; the digit run after
  `#issuecomment-` is a `pr-comment` component.
  A boundary that changes under NFKC or is a default-ignorable Unicode character
  is refused, including after a space, `.`, `-` or phone-style parenthesis, so
  upstream normalization cannot join outside numbers to the bound digits.
- Only `pii.cc` and `pii.phone.e164` findings with severity `MEDIUM` and
  category `pii` whose start offset (`line`, `col`) falls inside a component and
  whose first 4 characters equal `preview.slice(0, 4)` are eligible. `HIGH` and
  `secret` findings never qualify.
- When an eligible finding is present and `oversize` is false, `scan-text`
  creates a transient `0700` directory `.scan-text-*` beside `<file>`, writes a
  `0600` copy with the same basename and digits inside components masked to `x`,
  runs `gstack-redact` again, and removes the directory in `finally`.
- Status is `none` when no eligible finding exists, `oversize` is true, or no
  eligible finding vanishes; `applied` when the second scan adds no finding key
  (`id|severity|category|line|col`), retains every non-eligible finding, and
  at least one eligible finding vanishes; and `inconclusive` (returning
  upstream's findings unchanged) when the second scan fails, adds a finding, or
  drops a non-eligible finding.
- Output JSON: `{version: 1, status, reason?, upstream_exit, findings, counts, repoVisibility, oversize, known_safe: [{id, line, col, context}]}`.
  On usage or first-scan failure, `scan-text` prints `{"version":1,"error":"..."}` and exits `1`.
  Malformed finding fields, unknown severities, or counts/exit codes inconsistent
  with the findings also fail the scan: exit `1` on the first scan, or status
  `inconclusive` with the first scan's findings and exit on the second.
- Exit codes: `0` clean, `2` `MEDIUM` remaining, `3` `HIGH` remaining (matching
  `gstack-redact`), and `1` for usage errors or an unavailable scanner.
  `scan-text` uses no `.gstack/secret-dispositions.json` entries or approvals
  and never writes the input file.

## Verification limits

Unit/CLI fixtures test matching and refusal paths. The opt-in installed-upstream
fixture tests run the actual scanner and preflight against temporary projects:

```sh
GSTACK_SECRET_DISPOSITIONS_INTEGRATION_ROOT=<trusted-installed-gstack-root> \
  bun test tests/secret-dispositions.test.ts
```

`GSTACK_SECRET_DISPOSITIONS_INTEGRATION_ROOT` is intentionally distinct from
`tests/upstream-check.test.ts`'s `GSTACK_OUTSIDE_TEST_ROOT` because this suite
executes installed `bin/gstack-pregate`, `bin/gstack-redact`, and
`bin/gstack-ship-receipt` on temporary git repositories (longer runtime and
broader upstream surface) rather than `bin/upstream-check`'s read-only anchor
and outside-review probe.

To verify the standalone quoted-path live check without hitting `#3859` in the
first test, filter with `-t "quoted"`:

```sh
GSTACK_SECRET_DISPOSITIONS_INTEGRATION_ROOT=<trusted-installed-gstack-root> \
  bun test tests/secret-dispositions.test.ts -t "quoted"
```

On installed gstack `1.103.1.0` (`f7402213a04d720eed5c50557c0ba528a69af4bd`),
running the full `GSTACK_SECRET_DISPOSITIONS_INTEGRATION_ROOT` suite produced
61 pass / 1 fail: the tracked-Python (`line N`), standalone quoted-bidi
(borrowing collision, single-file raw path, `.py` whole-file `line N`, and
edit-stale rerun), and `scan-text` offset checks all passed, and the first
test's wrapper-matching assertions passed, while its `gstack-ship-receipt`
native-receipt assertion still failed (`exit 1`) because upstream requires
`--review-targeted` when `.gstack/secret-dispositions.json` is in `main...HEAD`
(#3859). Filtering with `-t "quoted"` passed cleanly (5/5, exit 0).
The installed scanner decides which examples it flags, and the wrapper must
match every blocking finding it reports. These are synthetic fixture approvals,
not approvals for the working project or proof of attended agent behavior.
Workflow instructions require an actual in-session decision before any real
entry is written.
