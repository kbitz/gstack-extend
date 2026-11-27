# /review-and-prep reference: Finding identity

## Record a review pass's findings

Read this once when the first attempt with findings is recorded in the pass.
Reuse it for further attempts in the same pass. The parent
assigns one `finding_id` per defect for the whole run and chooses its
`finding_class` using the first applicable row below. Begin with the upstream
`category` when present. The default mappings cover the category's usual claim.
Use judgment when a mapping does not fit the actual finding.

| Finding class | Meaning and default upstream category mapping |
|---|---|
| `safety` | Data loss, trust-boundary bypass, uncapped spend or credential exposure under the [safety-class rule](conditional-repair-and-gaps.md#from-block-readiness-only-on-shown-findings). Use for SQL & Data Safety, LLM Output Trust Boundary, Shell Injection and other categories when they show one of these harms. |
| `concurrency` | Race, locking, ordering, retry or replay. Race Conditions & Concurrency, Async/Sync Mixing. |
| `contract` | Disagreement with a documented interface, schema or handoff. Gate Integrity, Distribution & CI/CD Pipeline, Repo Conventions & Platform Fit where the claim names a contract. |
| `validation` | Missing or wrong input check, refusal or error path. Enum & Value Completeness, Type Coercion at Boundaries. |
| `scope` | Unmet approved scope or behavior added beyond it. Completeness Gaps where the claim names an approved obligation. |
| `test-gap` | Missing or weak tests for existing behavior. Missing Negative-Path Tests, Missing Edge-Case Coverage, Coverage Gaps. |
| `docs` | Documentation or prose accuracy, drift or clarity. |
| `performance` | Cost, latency or resource use. Performance specialist findings. |
| `maintainability` | Duplication, structure, naming or dead code. `shared-libs`, Dead Code & Consistency, simplification. |
| `correctness` | Wrong behavior that no earlier class explains. Column/Field Name Safety, Time Window Safety and View/Frontend behavior defects where no earlier mapping fits. |
| `other` | No other class applies. |

Use `safety` for every `shown=safety-class` finding. Keep the same class and
citation for repeated reports of the same finding in the pass.

As new findings arrive, append one line per new ID to the pass file before
recording its attempt. Pass that relative filename as `--finding-identity-file`
on every `record pass --state attempt`.
Use UTF-8 and one line per ID, with exactly these space-separated tokens:

```text
<finding_id> <finding_class>
<finding_id> <finding_class> <path> <line>
```

Use the short form for a file-level finding or no usable citation. The long
form takes a repository-relative POSIX path without whitespace and a 1-based
line number. The helper strips a leading `./`. It rejects empty, `.` and `..`
segments and backslashes as key inputs. Write the tokens as data. Do not read,
copy or write the cited line's text into the identity file or a command.

Pass `--anchor-commit` with the pass's frozen candidate snapshot for local
voices, or the reviewed head for Greptile. Preserve `candidate.commit`'s
cycle-1 baseline binding. Use **Scope a re-review to its delta** to freeze the
candidate before dispatch in both full and delta local passes. Reuse the
pass's existing snapshot if it has one. If the frozen snapshot is unavailable,
send the class-only forms, omit `--anchor-commit` and write
`Finding identity: unavailable (anchor-commit-missing)` in the full-receipt
sections. The helper derives keys from the named Git object, including for
paths tracked only in the frozen snapshot. The clean attempt path can send
the file with no lines for the attempt and omit the anchor commit.

An unusable identity file or a bad citation downgrades its affected findings.
The helper warns with `WARNING IDENTITY_DOWNGRADED` and provides
`detail.identity_downgraded` with the line, finding ID and rule. Lines for other
attempts in the pass are ignored. If a finding in this attempt has no entry,
its class and key are null. A duplicate entry, conflicting key for one finding
in a cycle or a second same-class finding on one line can leave a finding
class-only. Every eligible finding keeps its own report and disposition.

Identity and prior-state input problems are warnings, so the calls document's
stop-recording refusal rule does not apply to them. On a recorded downgrade,
put `Finding identity: unavailable (<reason>)` in the full-receipt sections
using the first downgrade's rule. Use the calls document's diagnostic
sanitization for any values included in a reason. The capability failure line
from Step 1 also belongs in the full-receipt sections.

## Two cycles with one carried finding

Run from a Git work tree with a tracked `example.txt` whose first line is
nonempty and unique within the file. Set `REVIEW_STATE` to the absolute path
of `bin/review-state`. The example uses the same committed candidate twice to
isolate identity behavior.

```bash
set -eu
EVIDENCE_DIR=$(mktemp -d)
CANDIDATE=$(git rev-parse HEAD)
PLAN_SHA=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
record() { "$REVIEW_STATE" build "$@" --dir "$EVIDENCE_DIR" >/dev/null; }
record start --run-id 019315e0-0000-7000-8000-000000000001 --base "$CANDIDATE" \
  --plan-ref docs/plan.md --plan-sha256 "$PLAN_SHA" --policy-source 'none supplied' --max-continuations 0
for CYCLE in 1 2; do
  PASS_ID="019315e0-0000-7000-8000-00000000001${CYCLE}"
  ATTEMPT_ID="019315e0-0000-7000-8000-00000000002${CYCLE}"
  IDENTITY_FILE="identity-$PASS_ID.txt"
  echo 'F1 validation example.txt 1' > "$EVIDENCE_DIR/$IDENTITY_FILE"
  record record pass --state started --pass-id "$PASS_ID" --scope local \
    --cycle "$CYCLE" --coverage full --commit "$CANDIDATE" --voice core
  record record pass --state attempt --pass-id "$PASS_ID" --voice-id core --part core \
    --attempt-id "$ATTEMPT_ID" --outcome completed --finding F1,high,core \
    --finding-identity-file "$IDENTITY_FILE" --anchor-commit "$CANDIDATE"
  record record pass --state voice-complete --pass-id "$PASS_ID" --voice-id core \
    --selected-attempt-id "$ATTEMPT_ID"
  record record pass --state completed --pass-id "$PASS_ID"
done
"$REVIEW_STATE" show --dir "$EVIDENCE_DIR"
```

The second `finding_cycles` entry has `"carried":1`. See the
[handoff contract](../../../docs/workflow-handoffs.md#finding-identity-and-cycle-counts)
for the fields, bounds and continuation import rules.

<!-- end of skills/references/review-and-prep/conditional-finding-identity.md -->
