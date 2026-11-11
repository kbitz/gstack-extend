# gstack-extend — Project spec

## Authority

This is the authority for product scope, target and release policy. Supporting
documents own only the roles listed below. Historical plans do not supply new
work or override this spec. The owner directed this revision on 2026-11-07
(1.0 as the owner's own real use, a published orchestration contract instead of
a single supported host, and bounded efficiency as outcome O6); it amends the
revision approved on 2026-10-08. Its scheduling consequences are recorded in
ROADMAP and Future.

## Purpose

Help developers carry an approved idea through planning, implementation,
review, required human testing and an authorized release, using gstack skills
across sessions and agents. The same stages work when a person runs each one by
hand and when an orchestrator launches them. A published orchestration contract
says what a host or orchestrator must provide and what each stage promises, so
no particular workspace host or orchestrator is required.

## Audience and target

- Current users: the owner, running stages by hand and through their own
  orchestrator (owner, 2026-11-06: "current users, just me"). The repository
  and its documented skills are public; public adoption has not been
  established here.
- Audience ceiling: potentially-public. Selected target: **1.0.0, the owner's
  own real use**, by hand and through an orchestrator, accepted on that use
  (owner decision, 2026-11-07). The planned public release, which the owner
  calls "2.0", is the next stage; it does not gate 1.0.
- Stage baseline: the owner declared public-beta on 2026-10-08. That records
  public availability with disclosed limitations; it is not the selected target
  and not acceptance evidence for any outcome below.
- **No workspace host or orchestrator is required.** A host or orchestrator
  that provides what the orchestration contract (O4) lists is supported through
  that contract. Support claims are bound to the combinations actually
  exercised and recorded; "any orchestrator works" is not claimable. Conductor
  support was dropped on 2026-11-06 and needs no acceptance evidence. Skill and
  helper code that names Paseo or Conductor is legacy until the Tracks that
  replace host-specific branches with the generic contract land.
- Acceptance conditions: Git repositories, GitHub PRs through authenticated
  `gh`, supported Bun, installed gstack and existing authorized agent accounts.
  Acceptance evidence names the operating system, workspace host, harness and
  upstream versions it ran on, and no other combination is claimed. This
  revision does not remove existing installation support for Claude Code,
  Codex, Cursor or OpenCode; full workflow acceptance is not inferred from
  setup fixtures.
- Human testing, account setup, exceptional decisions and explicit merge/deploy
  authorization remain allowed parts of the workflow. No new spend is authorized
  by this spec. See PROGRESS.md `## Acceptance` for achieved evidence.

## Stage outcomes

| Stage | Intended users and usable outcome | Planned? |
|---|---|---|
| MVP-1 | The owner completes the workflow by hand and through an orchestrator, on real work | Selected target: 1.0.0 |
| MVP-2 | A supported alpha group completes it | Not planned |
| public-beta | Public users can use documented skills with disclosed limitations | Owner-declared baseline (2026-10-08): availability, not acceptance |
| public-release | Public users can install, onboard independently and depend on stable outcomes with documented support | Planned next stage (the owner's "2.0"); no version reserved; not a 1.0 gate |

## Selected target acceptance

### O1: Install, update and recover a working skill set

1. Following the published instructions, the owner installs the selected
   harness copies on a fresh machine and completes project onboarding. Minimum
   runtime versions and missing prerequisites produce actionable results.
2. Upgrade preserves user-owned files, identifies skipped/stale copies and gives
   a working recovery path. The observed installation version matches the skills
   loaded by each exercised host/harness profile.
3. Retain the owner's fresh-install and upgrade/recovery evidence on the
   exercised combinations, including the published three-part upgrade: a real
   legacy four-part install upgraded through the default remote. Synthetic HOME
   fixtures alone do not establish this. An independently followed onboarding
   attempt belongs to the public-release stage, not 1.0.

### O2: Turn intent into an executable, bounded plan

1. `/project-spec` and `/roadmap` work for an untagged new project and an existing
   project. The plan maps work to selected outcomes, preserves accepted scope,
   distinguishes achieved acceptance from release history, and retains deferrals.
2. Closure, packing, pins, freshness and Hold preserve their existing contracts;
   document retirement preserves history and links. Approval concerns a complete
   candidate that can actually be reviewed.
3. Retain installed-skill acceptance for new/adopted projects and all 18 attended
   cases deferred from Track 22B. Earlier fixture passes and ordinary roadmap
   runs remain distinct from this required proof. (Accepted by the owner on
   2026-10-23; see PROGRESS.)

### O3: Complete or resume the workflow, run by a user or an orchestrator

1. From an approved plan, `/implement` hands off complete scope and verification;
   `/review-and-prep` prepares the bound PR; `/pair-review` pauses/resumes required
   human testing; `/ship-and-land` performs remaining authorized release steps.
   This holds whether a person runs each stage or an orchestrator launches it
   through the O4 contract.
2. A stage never invents completion, repeats a completed review without cause,
   loses uncommitted work, replaces the bound PR, or takes branch/worktree cleanup
   away from the host. Existing Greptile once-per-PR and approval rules remain.
3. Retain real runs from two drivers: the owner running the stages by hand, and
   one real external orchestrator, each read back in telemetry with its correct
   run mode (O6.1). Between them, show a complete workflow,
   interrupted resume, manual-testing pause/resume, `/full-review`
   finish/restart behavior and an explicit negative hold. Record host, harness
   and versions, human actions and workarounds; failures remain open. A static
   prose test is not installed-agent acceptance.

### O4: Publish the orchestration contract

1. Publish a versioned contract that states what a host or orchestrator must
   provide (a worktree-ownership signal, a state root, a run-mode signal on
   every stage it launches, interactive or not, resume semantics and approval
   semantics) and what each stage promises: stage identity,
   status/hold, plan and repository/PR identity, checked revision, artifact
   references and next action. Preserve existing `Run /review-and-prep` and
   `review-and-prep/v1` consumers, or provide an explicit compatible migration.
   No personal tool is required.
2. The skills honor the contract's signals instead of detecting a named host.
   Host-specific branches are removed or documented as one provider of a
   contract signal.
3. Unknown, stale, blocked, partially verified and user-deferred work is explicit.
   An idle agent or its success summary cannot authorize the next stage or merge.
   A caller may stop at a prepared PR without initiating shipping or landing.
4. Concurrent starts and retried finishes retain the correct run identity.
   Host, harness and requested-versus-observed model evidence are distinguishable;
   unavailable evidence stays unknown. Public provenance schemas remain readable.
5. Retain a real external-consumer handoff and a cross-session handoff from the
   O3 orchestrator runs. Capture success, stale artifact, interrupted run and
   manual hold. Test parsers/fixtures separately. Consumer-owned orchestration
   implementation and permission controls remain outside this repository.

### O5: Make a stable release promise that the tooling can keep

1. Name the stable compatibility surfaces (including the O4 contract) and
   experimental exclusions, document support/recovery, and verify an upgrade
   from the four-part releases.
2. Three-part release versions must pass updater, tagging, audit and provenance
   contracts before 1.0.0; legacy records/tags remain intact and readable.
3. O1–O6 acceptance is recorded with revisions, host/harness versions, reproducible
   steps and links to sanitized evidence. No unresolved blocker may be hidden by
   a version bump. The owner confirms acceptance before the release uses it.

### O6: Bounded, measured stage effort

1. Every stage records its wall time, model usage and run mode, separating work
   from waits and wall time from model consumption. Unavailable values are
   explicit unknowns, never zeros. A stage the owner runs by hand is recorded
   as `user-directed`, an orchestrated stage is never recorded as
   `user-directed`, and where the signals cannot tell them apart the record
   says `unknown`. The report covers every machine the owner uses (reading
   synced local records is enough; no hosted service). Hand use counts as
   captured only once real by-hand runs on those machines read back correctly
   (owner, 2026-11-07).
2. Each stage has a documented expected cost, drawn from recorded runs with
   sample size and missingness stated.
3. Each candidate optimization in the [efficiency program](designs/workflow-efficiency-program.md)
   receives an adopt, reject or insufficient-evidence decision with its
   evidence. An insufficient-evidence decision names the missing data and a
   bounded next measurement.
4. O6 gates on these measurements and decisions, not on any particular saving:
   individual optimizations do not gate 1.0. The owner confirms acceptance.

## Optimization evidence rules (P1)

P1 names the owner-selected efficiency program (2026-10-25) and the evidence
rules its optimizations follow; O6 applies them. Prioritize recurring
model-work and wall-time savings. Record work, waits, reuse and rework when
they happen. Report unavailable usage as unknown and distinguish wall time
from model consumption. Measure the before/after effect and retained review
quality before enforcing an optimization. Public defaults need evidence across
the supported conditions; caller-specific behavior uses a documented option or
versioned review-policy value and preserves today's default. Keep the published
handoffs, receipt formats, approval rules and review stop conditions
compatible, and preserve necessary safety and measurement prerequisites. The
[efficiency program](designs/workflow-efficiency-program.md) records the
selected work and evidence limits; ROADMAP owns scheduling.

## Constraints and accepted limitations

Skills compose with upstream gstack; this project does not replace workspace
hosts, agent runtimes or the orchestrator. Preserve host ownership of branches
and worktrees. Keep durable evidence outside disposable workspaces when it is
not committed. Never publish credentials or raw private transcripts.

Human decisions and documented manual recovery are supported. The orchestration
contract is documentation plus the signals the skills read; it is not an
orchestration engine or a promise to support every possible host, orchestrator
or provider combination. Bind evidence to the combinations actually exercised.
Missing model/billing observations stay unknown.

## Non-goals and later work

Quota-driven routing, autonomous/unattended shipping or merging, automated
review-independence certification, empirical vendor comparisons, and automatic
multi-agent test scheduling do not gate 1.0. Quota adapters remain experimental;
the merge gate remains shadow-only. Preserve their published data contracts.
No new UI, hosted service, orchestration engine or billing entitlement is implied.

Public-release obligations belong to the next stage, not 1.0: an independently
followed onboarding attempt by someone other than the owner, onboarding
qualified for fresh public users, and public support commitments. They are
retained in Future and revisited when the owner selects the public-release
target.

Internal capability-table/template refactors, telemetry dashboard expansion and
helper adoption are not gates unless a concrete supported workflow fails without
them. Individual optimizations are not gates; O6 gates only on measurement and
decisions. Their complete commitments and revisit triggers remain in Future.

## Release policy

- Current format: `MAJOR.MINOR.PATCH`, without prefixes or suffixes, from the
  first release cut from a base containing the verified transition. The policy
  transition itself ships under its base's four-part policy; do not relabel
  historical versions or tags. Owner confirmation during shipping is required
  before this amendment counts for releases.
- Public-beta's three-part transition happens in 0.x so compatibility can be
  qualified before 1.0. The first cutover is a 0.x MINOR with disclosure, padded
  equality, unchanged consumer schemes and migration/recovery guidance. Candidate
  qualification does not complete the required published-release upgrade proof.
  The release workflow selects the next available version from live state.
- During 0.x: compatible additions use MINOR; fixes and released documentation
  use PATCH after cutover. MICRO remains available only under the legacy base
  policy for the transition's own release. Incompatible public changes require
  an explicit 0.x MINOR release, disclosure and migration/recovery guidance.
  Do not silently break an orchestrator consumer in a patch.
- At 1.0 and later: breaking stable-interface changes use MAJOR, compatible
  additions MINOR, fixes PATCH. Documentation-only releases use PATCH when released.
- Stable surfaces: documented CLI arguments/exit and JSON semantics, skill names
  and required inputs, the orchestration contract and versioned handoff and
  provenance schemas, installation ownership, supported configuration and
  approval/hold semantics. Internal stores are private; experimental features
  retain their explicit schema-version rules.
- Capability checkpoints: installation (O1), planning (O2), workflow by user or
  orchestrator (O3), orchestration contract (O4), release compatibility (O5),
  measured stage effort (O6). Completion supplies evidence; compatibility
  decides increments, not Track/Group counts or code size.
- Stage mapping: 1.0.0 is the intended first stable release, only after the
  owner accepts O1–O6 under the MVP-1 target. The planned public release (the
  owner's "2.0") takes whatever version the compatibility rules give it when it
  ships. No date, version slot or release action is reserved here.
- VERSION remains the source; CHANGELOG records releases; PROGRESS `## Acceptance`
  records owner-confirmed stage/checkpoint evidence. Baseline entries earn no bump.
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
| [ROADMAP](ROADMAP.md) | Scheduled target work; IDs are recyclable |
| [Stage handoff contract](workflow-handoffs.md) | The published handoff grammar, run-mode signals and state root; the base the O4 orchestration contract extends |
| [Efficiency program](designs/workflow-efficiency-program.md) | O6 candidate optimizations, P1 measurement rules and upstream evidence limits; no independent release policy |
| [PROGRESS](PROGRESS.md), [CHANGELOG](../CHANGELOG.md) | Acceptance evidence and historical releases |
| [Future](roadmap-future.md), [shipped receipts](roadmap-shipped.md) | Deferred scope and frozen completion evidence |
| [Project-spec implementation](designs/project-spec.md) | Existing skill requirements, not this project's product vision |
| [Packing contract](designs/roadmap-v3-packing.md), [collision contract](collision-contract.md), [source tags](source-tag-contract.md) | Current planning mechanics |
| [Telemetry](telemetry.md), [stage-run schema](stage-runs.schema.json) | Provenance producer/consumer contract and qualified evidence |
| [Quota ledger](quota-ledger.md), [merge gate](merge-gate.md) | Experimental ledger and shadow verdict contracts |
| [Review independence](designs/review-independence.md) | Current evidence/definition limits; no empirical clearance or new gate |
| [Compatibility catalog](compatibility.md) | Stable surfaces, experimental exclusions, support conditions and recovery links under the release policy; no independent policy and no acceptance evidence |

Superseded history: [Group 4 re-plan](archive/group-4-replan.md) explains the
2026-05 test-migration decisions. Retired as an active scheduling authority on
2026-10-08; its surviving contracts are in the current testing instructions,
code, tests and retained Future entries. Other documents already under
`docs/archive/` remain historical; they are not routine planning inputs.
