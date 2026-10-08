# gstack-extend — Project spec

## Authority

This is the authority for product scope, target and release policy. Supporting
documents own only the roles listed below. Historical plans do not supply new
work or override this spec. The owner approved this revision on 2026-10-08;
its scheduling amendments are recorded in ROADMAP and Future.

## Purpose

Help developers carry an approved idea through planning, implementation,
review, required human testing and an authorized release, using gstack skills
across sessions and agents. Make those same stage boundaries dependable for
external orchestrators without requiring a particular orchestrator.

## Audience and target

- Current users: the maintainer and public-beta users; public adoption counts
  and independent onboarding success have not been established here.
- Audience ceiling: potentially-public. Selected target: public-release, 1.0.0.
- Current stage: public-beta, declared by the owner on 2026-10-08. This is a
  baseline, not retrospective proof of every beta or 1.0 acceptance criterion.
- **Paseo and Conductor have equal priority.** Both must satisfy the same core
  workflow outcomes. Their different launch and permission APIs do not require
  identical implementations. A critical supported-host failure blocks 1.0.
- Initial acceptance conditions: local macOS development, Git repositories,
  GitHub PRs through authenticated `gh`, supported Bun, installed gstack and
  existing authorized agent accounts. Other operating systems remain unverified
  until a named profile is qualified; this adoption does not remove existing
  installation support for Claude Code, Codex, Cursor or OpenCode.
- Qualify Codex implementation, Cursor review and Claude planning/shipping on
  both workspace hosts where those routes are provided. Record concrete host,
  harness and upstream versions. OpenCode retains its installation contract;
  full workflow acceptance is not inferred from setup fixtures.
- Human testing, account setup, exceptional decisions and explicit merge/deploy
  authorization remain allowed parts of the workflow. No new spend is authorized
  by this spec. See PROGRESS.md `## Acceptance` for achieved evidence.

## Stage outcomes

| Stage | Intended users and usable outcome | Planned? |
|---|---|---|
| MVP-1 | Maintainer completes the workflow | Historical use; no retroactive acceptance claim |
| MVP-2 | A supported alpha group completes it | No separate new stage commitment |
| public-beta | Public users can use documented skills with disclosed limitations | Current owner-declared baseline |
| public-release | Supported users and external orchestrators can depend on the outcomes below | Selected target: 1.0.0 |

## Selected target acceptance

### O1: Install, update and recover a working skill set

1. A fresh user follows the public instructions to install the selected harness
   copies and complete project onboarding. Minimum runtime versions and missing
   prerequisites produce actionable results.
2. Upgrade preserves user-owned files, identifies skipped/stale copies and gives
   a working recovery path. The observed installation version matches the skills
   loaded by each qualified host/harness profile.
3. Retain fresh-install and upgrade/recovery evidence on both workspace hosts,
   including an independently followed onboarding attempt without undocumented
   maintainer fixes. Synthetic HOME fixtures alone do not establish this.

### O2: Turn intent into an executable, bounded plan

1. `/project-spec` and `/roadmap` work for an untagged new project and an existing
   project. The plan maps work to selected outcomes, preserves accepted scope,
   distinguishes achieved acceptance from release history, and retains deferrals.
2. Closure, packing, pins, freshness and Hold preserve their existing contracts;
   document retirement preserves history and links. Approval concerns a complete
   candidate that can actually be reviewed.
3. Retain installed-skill acceptance for new/adopted projects and all 18 attended
   cases deferred from Track 22B. Earlier fixture passes and ordinary roadmap
   runs remain distinct from this required proof.

### O3: Complete or resume the workflow on either host

1. From an approved plan, `/implement` hands off complete scope and verification;
   `/review-and-prep` prepares the bound PR; `/pair-review` pauses/resumes required
   testing; `/ship-and-land` performs remaining authorized release steps.
2. A stage never invents completion, repeats a completed review without cause,
   loses uncommitted work, replaces the bound PR, or takes branch/worktree cleanup
   away from the host. Existing Greptile once-per-PR and approval rules remain.
3. Retain one real complete workflow per host, plus interrupted resume and
   manual-testing pause/resume evidence. Include `/full-review` finish/restart
   behavior and an explicit negative hold. Record human actions and workarounds;
   failures remain open. A static prose test is not installed-agent acceptance.

### O4: Let external orchestrators consume stable stage handoffs

1. Publish a versioned handoff contract for stage identity, status/hold, plan and
   repository/PR identity, checked revision, artifact references and next action.
   Preserve existing `Run /review-and-prep` and `review-and-prep/v1` consumers,
   or provide an explicit compatible migration. No personal tool is required.
2. Unknown, stale, blocked, partially verified and user-deferred work is explicit.
   An idle agent or its success summary cannot authorize the next stage or merge.
   A caller may stop at a prepared PR without initiating shipping or landing.
3. Concurrent starts and retried finishes retain the correct run identity.
   Host, harness and requested-versus-observed model evidence are distinguishable;
   unavailable evidence stays unknown. Public provenance schemas remain readable.
4. Retain a real external-consumer handoff on Paseo and a cross-session handoff on
   Conductor. Capture success, stale artifact, interrupted run and manual hold.
   Test parsers/fixtures separately. Consumer-owned orchestration implementation
   and permission controls remain outside this repository.

### O5: Make a stable release promise that the tooling can keep

1. Name the stable compatibility surfaces and experimental exclusions, document
   support/recovery, and verify an upgrade from the current four-part releases.
2. Three-part release versions must pass updater, tagging, audit and provenance
   contracts before 1.0.0; legacy records/tags remain intact and readable.
3. O1–O4 acceptance is recorded with revisions, host/harness versions, reproducible
   steps and links to sanitized evidence. No unresolved blocker may be hidden by
   a version bump. The owner confirms acceptance before the release uses it.

## Constraints and accepted limitations

Skills compose with upstream gstack; this project does not replace workspace
hosts, agent runtimes or the orchestrator. Preserve host ownership of branches
and worktrees. Keep durable evidence outside disposable workspaces when it is
not committed. Never publish credentials or raw private transcripts.

Human decisions and documented manual recovery are supported. Host parity means
equal priority for the declared outcomes, not a new generic host abstraction or
a promise to support every possible provider combination. Bind evidence to the
combinations actually exercised. Missing model/billing observations stay unknown.

## Non-goals and later work

Quota-driven routing, autonomous/unattended shipping or merging, automated
review-independence certification, empirical vendor comparisons, and automatic
multi-agent test scheduling do not gate 1.0. Quota adapters remain experimental;
the merge gate remains shadow-only. Preserve their published data contracts.
No new UI, hosted service, orchestration engine or billing entitlement is implied.

Internal capability-table/template refactors, telemetry dashboard expansion and
helper adoption are not gates unless a concrete supported workflow fails without
them. Their complete commitments and revisit triggers remain in Future; moving
them follows the approved 2026-10-08 scheduling amendment; they remain unshipped.

## Release policy

- Current format: `MAJOR.MINOR.PATCH.MICRO`. It is not strict SemVer. Keep the
  existing format until the compatibility transition is implemented and verified;
  do not relabel historical versions or change VERSION during spec adoption.
- Public-beta normally calls for strict SemVer. This project has explicit
  transition debt: enable three-part `MAJOR.MINOR.PATCH` before public-release.
  The release workflow selects the next available version from live state.
- During 0.x: compatible additions use MINOR; fixes use PATCH; documentation-only
  changes may use MICRO while the legacy format remains. Incompatible public
  changes require an explicit 0.x MINOR release, disclosure and migration/recovery
  guidance. Do not silently break an orchestrator consumer in a patch.
- At 1.0 and later: breaking stable-interface changes use MAJOR, compatible
  additions MINOR, fixes PATCH. Documentation-only releases use PATCH when released.
- Stable surfaces: documented CLI arguments/exit and JSON semantics, skill names
  and required inputs, versioned handoff and provenance schemas, installation
  ownership, supported configuration and approval/hold semantics. Internal stores
  are private; experimental features retain their explicit schema-version rules.
- Capability checkpoints: installation (O1), planning (O2), host workflow (O3),
  external handoffs (O4), release compatibility (O5). Completion supplies evidence;
  compatibility decides increments, not Track/Group counts or code size.
- Stage mapping: 1.0.0 is the intended first stable public release only after
  O1–O5 acceptance. No date, version slot or release action is reserved here.
- VERSION remains the source; CHANGELOG records releases; PROGRESS `## Acceptance`
  records owner-confirmed stage/checkpoint evidence. Baseline adoption earns no bump.
  This policy-editing change ships under the base branch's policy.

## Deferral policy

Use local `docs/roadmap-future.md`. Preserve source, evidence, outstanding scope,
why it can wait and a concrete inline **Revisit when:** trigger. Reassess when the
trigger occurs or the selected target changes. Never infer 1.0 gates from age,
severity alone, or a historical Track number. An explicit required acceptance
obligation remains pending until demonstrated or separately amended by the owner.

## Supporting documents

| Document | Bounded role |
|---|---|
| [README](../README.md), [installation](installation.md) | User entry point, setup and recovery |
| [ROADMAP](ROADMAP.md) | Scheduled work toward this target; IDs are recyclable |
| [PROGRESS](PROGRESS.md), [CHANGELOG](../CHANGELOG.md) | Acceptance evidence and historical releases |
| [Future](roadmap-future.md), [shipped receipts](roadmap-shipped.md) | Deferred scope and frozen completion evidence |
| [Project-spec implementation](designs/project-spec.md) | Existing skill requirements, not this project's product vision |
| [Packing contract](designs/roadmap-v3-packing.md), [source tags](source-tag-contract.md) | Current planning mechanics |
| [Telemetry](telemetry.md), [stage-run schema](stage-runs.schema.json) | Provenance producer/consumer contract and qualified evidence |
| [Quota ledger](quota-ledger.md), [merge gate](merge-gate.md) | Experimental ledger and shadow verdict contracts |
| [Review independence](designs/review-independence.md) | Current evidence/definition limits; no empirical clearance or new gate |

Superseded history: [Group 4 re-plan](archive/group-4-replan.md) explains the
2026-05 test-migration decisions. Retired as an active scheduling authority on
2026-10-08; its surviving contracts are in the current testing instructions,
code, tests and retained Future entries. Other documents already under
`docs/archive/` remain historical; they are not routine planning inputs.
