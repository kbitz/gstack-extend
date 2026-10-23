# Draft issue: reviewed secret findings and narrower env.kv heuristics

Status: text only, not filed. The maintainer decides whether to file this in
`garrytan/gstack`. No upstream implementation is included in this change.

## Problem

Pregate's `secrets` check runs `gstack-redact` on added lines and fails for any
HIGH finding or MEDIUM finding in category `secret`. The check is deliberately
non-downgradable. There is no persistent, finding-specific reviewed disposition,
so a human false-positive decision has to be repeated at review and shipping.

On 2026-10-23, three MEDIUM `env.kv` findings blocked a PR even though a human
read all three and confirmed that they were not credentials:

| Source | Flagged text | Human assessment |
|---|---|---|
| `src/mmm_factory/managerusage.py:50` | `session = row.get("manager_session") if row and row.get("stage") == "manager" else None` | A Python expression, not a credential literal. |
| `tests/test_factory_manager.py:322` | `secret = "SECRET-TOKEN-VALUE"` | A test sentinel asserted absent from error output. |
| `tests/test_manager_usage.py:21` | `SESSION = "5d2c8a10-3b7e-4c11-9a64-8f0e1b2c3d4e"` | A synthetic UUID; sibling `AGENT` and `OTHER` UUID constants were not flagged. |

The relevant installed code is `lib/pregate/checks/secrets.ts`'s blocking
predicate and `NON_DOWNGRADABLE` in `lib/pregate/config.ts`. The fixture in
gstack-extend reproduces the raw failure with the installed upstream scanner.

## Proposal

1. Support a line-scoped, rule-specific reviewed annotation, such as
   `# gstack:allow env.kv -- synthetic test UUID`. This is a proposed spelling,
   not an existing feature. Gitleaks documents a comparable
   [`gitleaks:allow` annotation](https://github.com/gitleaks/gitleaks#gitleaksallow).
   Retain annotated findings in structured output with their disposition and
   reason. Keep HIGH findings blocking, and make changed line text require
   review again (for example by binding approval to a line hash). Agents should
   only add the annotation after the user's concrete approval in the session.
2. Narrow `env.kv` heuristics for source code: skip non-literal right-hand sides
   such as the conditional expression above; recognize canonical UUIDs and
   obvious fixture sentinels such as `SECRET-TOKEN-VALUE` in test contexts.
   Keep high-confidence credential detectors active even when the generic
   assignment heuristic declines a match. UUID shape alone is not proof that a
   production value is non-secret; test context and explicit approval remain
   useful where intent cannot be determined.
3. Emit structured pregate findings with rule, severity, category, original
   path, source line and exact-line hash. Today the report renders an index
   within concatenated added lines, which wrappers must map back to source.

## Suggested regression coverage

- All three examples above, including an indented expression and moved lines.
- Actual literal credentials still fail; HIGH cannot be annotated away.
- An annotation for one rule cannot suppress another rule on the same line.
- A changed literal, renamed file or stale approval requires review again.
- A UUID-like credential outside test context does not get a blanket exemption.
- Scanner failure, malformed output and incomplete scans never become passes.

## Current wrapper workaround

gstack-extend keeps a committed exact-path/rule/line-hash disposition file,
requires user approval before adding an entry, and separately evaluates the
wrapper gate. The raw pregate result remains `fail` and appears in the receipt.
This preserves upstream's guard while making previously approved false
positives reusable. It does not modify upstream or change its pre-push hook.
