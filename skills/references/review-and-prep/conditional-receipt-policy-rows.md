# /review-and-prep reference: Receipt rows for active optional policies

## From Readiness

| `Final-gate repair:`, `Final-gate repair rerun:`, `Final-gate repair review:`, `Final-gate repair refusal:` | when `final-gate-repair=tests-docs` ran a repair or fallback, with the authorizing policy line (**Repair a test-only final-gate failure**) | yes | yes | no |
| `repair-review:`, `Repair classification:`, `Repair without review cycle:`, `Repair evidence:`, `Repair chain voided:`, `neutral-only baseline:` | when `repair-review=behavior-changing` is on the policy line, with the authorizing policy line (**Reopen review only for behavior-changing repairs**) | yes | yes | yes |
| `skipped — light default repair cycle; source: repair-cycles=light`, `repair-cycles=light: nothing skipped — in-cap=full` | when `repair-cycles=light` is on the policy line (**Read an optional review policy**) | yes | no | no |
| the `test-gaps:` status line and every `Test gap recorded:`, `Test gap not recorded:` and `Test gap withdrawn:` line with the authorizing policy line | when `test-gaps=record` is on the policy line; recorded gaps are omitted from `Unresolved:` (**Record unproven test gaps**) | yes | yes | yes |
| `blocking:`, `Finding blocking:`, `Finding not blocking:` | when `blocking=shown` is on the policy line, with the authorizing policy line; non-blocking findings are omitted from `Unresolved:` (**Block readiness only on shown findings**) | yes | yes | yes |
| `settled:`, `Finding settled:` | when **Give review parts the settled decisions** built or checked settled context; settled findings are omitted from `Unresolved:` | yes | yes | yes |
| `post-audit:`, `Post-audit change:`, `doc-audit-gap:`, `Doc-audit extra:` | The `post-audit:` and `Post-audit change:` lines require `post-audit=classify`. The `doc-audit-gap:` line requires `doc-audit-gap=auto`. The two new classes and any `Doc-audit extra:` decision require both companions (**Classify changes after the documentation audit's last attempt**). | yes | yes | yes |
| the `delegation:` status line and every `Delegated part:` line | when `delegate=<part>` is on the policy line and the receipt carries Step 2 review evidence; name the configuration's SHA-256 and labels, never its path (**Delegate named specialist parts**) | yes | yes | yes |
| `Review arm:`, `Folded checklist:` | when `specialists=fold` is on the policy line (**Fold specialist checklists into cycle 1**) | yes | yes | yes |
| `specialists-dispatched:` | only while the policy's `delegate=` or `specialists=fold` section is active (**Delegate named specialist parts**, **Fold specialist checklists into cycle 1**) | yes | yes | yes |
| `adversarial-pass:` | only while `delegate=adversarial` is active (**Delegate named specialist parts**) | yes | yes | yes |
| `Red team:` | only when the policy carries `red-team=ensure` or `delegate=` names `red-team` (**Run a red team where /review has none**) | yes | yes | yes |
| `Review overlap:` | when `first-cycle=overlap` is on the policy line (**Overlap independent first-cycle reviewers**) | yes | yes | yes |
| `External gate attestation:` | each accepted external-gate result row (**Pause for an external full-suite gate**) | yes | no | no |
| the `pregate-narrowing:` status line and each `Pregate lane not run:` line | when `full-suite=external` evaluated pregate narrowing on an accepted pass (**Narrow the pregate after an accepted pass**) | yes | no | no |

<!-- end of skills/references/review-and-prep/conditional-receipt-policy-rows.md -->
