# Shipped

## Shipped

### Phase 1: Bun Test Migration ✓ Shipped (v0.18.3 → v0.18.11.0)

**End-state:** `bun test` is the sole test entry point, all `scripts/test-*.sh` retired, `bin/roadmap-audit` is a 7-line POSIX-sh shim invoking `src/audit/cli.ts`, and the leverage patterns (touchfiles, audit-compliance) are adopted. Skill prose corpus + in-session judging shipped in Track 4C but was later removed in Track 7A as calibration theater (parent gstack project has no equivalent; the fixture genre didn't match real skill source-prose edits). Eval persistence was deferred to Future and remains deferred.

**Groups:** 1, 2, 3, 4 (sequential).

Suite 113s → 32s; audit snapshots 124s → 7.3s.

#### Group 1: Bun Test Toolchain ✓ Shipped (v0.18.3)
- Track 1A — _shipped (v0.18.3): bootstrap bun + port source-tag lib + tests_

#### Group 2: TypeScript Port of `bin/roadmap-audit` ✓ Shipped (v0.18.11.0)
- Track 2A — _shipped (v0.18.6.0): port `bin/roadmap-audit` to TypeScript_
- Track 2B — _shipped (v0.18.11.0): cut `bin/roadmap-audit` over to TS implementation_

#### Group 3: Test Runner Migration + Invariants ✓ Shipped (v0.18.7.0)
- Track 3A — _shipped (v0.18.7.0): migrate test runners + invariants test_

#### Group 4: Test Leverage Patterns ✓ Shipped (v0.18.11.0)
- Track 4A — _shipped (v0.18.9.0): touchfiles diff selection_
- Track 4C — _shipped (v0.18.11.0); removed in Track 7A: skill prose corpus + in-session judging routing rule_
- Track 4D — _shipped (v0.18.10.0): audit-compliance test for gstack-extend invariants_

#### Group 5: Install Pipeline ✓ Shipped (v0.18.14.0)
- Track 5A — _shipped (v0.18.14.0): install pipeline polish — 3 of 5 originally-planned tasks landed (preamble probe pattern, doc-type detection heuristic, setup symlink hardening); 2 deferred tasks (layout scaffolding, update-run dir propagation) routed to Project Bootstrapping (now Group 10 in Shipped, Group 12 in Current Plan)._

#### Group 6: Audit Polish + Track 5A Test Follow-ups + /roadmap v2 Cutover ✓ Shipped (v0.18.16.0 → v0.19.0.0)
- Track 6A — _shipped (v0.18.19.0): STALENESS → VERSION_TAG_STALENESS rename + STATUS warn fix_
- Track 6B — _shipped (v0.18.18.0): Track 5A test follow-ups_
- Track 6C — _shipped (v0.18.16.0–v0.18.17.0): /roadmap-new refactor + ID-renames helper + ROADMAP v2 migration_
- Track 6D — _shipped (v0.19.0.0): /roadmap-new → /roadmap cutover, drop v1 grammar_

#### Group 7: Hotfix: `/pair-review` Cross-Branch Resume ✓ Shipped (v0.19.0.1)
- Track 7A — _shipped (v0.19.0.1): /pair-review never offers to resume cross-branch sessions (#76)_

#### Group 8: `/pair-review` Concurrent Sessions Across Branches ✓ Shipped (v0.19.1.0)
- Track 8A — _shipped (v0.19.1.0): /pair-review supports concurrent sessions across branches (#77)_

#### Group 9: Tighten `git commit` Failure Handling ✓ Shipped (v0.19.2.0)
- Track 9A — _shipped (v0.19.2.0): surface git commit failure output + drop skill-prose-corpus (#78)_

#### Group 10: Project Bootstrapping — Layout Scaffolding ✓ Shipped (v0.19.3.0)
- Track 10A — _shipped (v0.19.3.0): Layout Scaffolding skill section + audit gap fixes (#79)_

#### Group 11: New Skill `/gstack-extend-upgrade` ✓ Shipped (v0.20.0.0)
- Track 11A — _shipped (v0.20.0.0): /gstack-extend-upgrade skill + consolidate upgrade flow (#80)_

#### Group 12: `gstack-extend init <project>` Scaffold ✓ Shipped (v0.21.0.0)
- Track 12A — _shipped (v0.21.0.0): gstack-extend init <project> + skill — full bootstrap (starter ROADMAP/CLAUDE/CHANGELOG/TODOS/PROGRESS/VERSION, docs/ layout, project registry, post-render audit gate), setup CLI symlink + self-registration (#83)_

#### Group 13: Telemetry Parity with Gstack ✓ Shipped (v0.22.0.0)
- Track 13A — _shipped (v0.22.0.0): bin/gstack-extend-telemetry wrapper + canonical preamble/epilogue blocks in 5 skill files. Every extend skill activation now writes start + end lines to ~/.gstack/analytics/skill-usage.jsonl with extend:<skill> name and source:gstack-extend field; mind-meld retro / /retro pick up extend activity with zero downstream changes. Wrapper falls back silently when gstack isn't installed. Drift-lock test extracts canonical blocks from skills/full-review.md and asserts each other skill embeds the templated variant. Opportunistic contract test catches future gstack flag renames._

#### Group 14: Fix `parsers-roadmap` Group 6 Completeness Failure ✓ Shipped (v0.22.0.2)
- Track 14A — _shipped (v0.22.0.2): dropped volatile live-ROADMAP assertions; added a synthetic state-section enclosure fixture. Parser untouched._
