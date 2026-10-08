# Project spec and outcome-led roadmap

Approved scope: the project-spec / roadmap discussion ending with “let's build
it” on 2026-10-07. This document records the implementation contract; it does
not declare this repository's own product stage or change its release policy.

## Problem and outcome

Review deferrals accumulate into execution commitments without establishing
whether they help the intended users reach a usable product. The same audience
and scale decisions have to be repeated in later sessions. Track descriptions
often explain implementation without plainly stating what becomes possible.

An occasional `/project-spec` establishes those decisions for a new project or
an existing project that lacks them, then delegates the execution plan to
`/roadmap`. Routine regeneration applies that contract without expanding it.

## Accepted requirements

1. **Creation and adoption.** Discover existing intent, implementation, approved
   commitments and evidence before asking questions. Support deliberate later
   revisions. A backlog is input for triage, never proof of product ambition.
2. **Durable spec.** Produce `docs/SPEC.md` with purpose, intended users and
   conditions, selected target, audience ceiling, stable outcome references,
   acceptance criteria, constraints, accepted limitations and revisit triggers.
   Reconcile existing specifications rather than creating competing authorities.
   Per the user's 2026-10-07 clarification, aggressively retire replaced specs
   and plans: archive or prominently mark them superseded, update active links,
   and preserve a historical-decision index without routine archive ingestion.
   Carry forward binding commitments and retain current supporting evidence.
3. **Stages and audience.** Define pre-MVP-1, MVP-1 (personal use), MVP-2
   (small supported alpha group), public-beta and public-release. Private-only
   is a separate audience policy. A project need not progress to a later stage.
   Record current achieved state/evidence in PROGRESS; keep target definitions
   and the selected target in SPEC. Unknown evidence remains unknown.
4. **Version policy.** Decide per project which capability checkpoints earn
   minors and which stages map to majors. Before public-beta, ordinary releases
   default to patch; Group closure and diff size do not decide. Strict SemVer
   begins at public-beta by default. Preserve existing release history and
   identify any necessary version-format/tooling transition explicitly.
5. **Roadmap composition.** Use the installed roadmap skill as the final
   planning step, carrying the draft spec into its proposal and validation.
   Review the combined candidate, reuse matching approval, and report partial
   writes honestly. Do not duplicate packing, closure, or audit machinery.
6. **Admission.** Every placed item must explain its contribution to the
   selected target or a necessary prerequisite/defect fix, with concrete
   impact on the specified users and conditions. Review severity and provenance
   alone do not authorize placement. Preserve explicit scope commitments unless
   the user approves an amendment; do not discard required acceptance evidence.
7. **Deferral.** Retain context, rationale and a revisit trigger. Support local
   backlog or user-selected GitHub issues without automatic reimport, duplicate
   ownership, or dropping an item when issue filing fails. Retain reject and
   discharge dispositions. No issue-tracker dependency for private-only work.
8. **Readable outcomes.** Every newly regenerated Track has an Outcome,
   Supports and Done when line. Every Group summarizes what its batch delivers.
   Technical `_produces:` contracts may remain. Only selected outcomes are
   version checkpoints; not every Track outcome earns a minor.
9. **Consumers and installation.** Install the new skill on the supported
   hosts. Write a small project-instruction bridge so planning, review and
   direct ship consume SPEC. Extend owned implementation/review/release
   workflows and init guidance without modifying upstream skills or deployed
   machine configuration.

## Boundaries

This implementation adds the shared workflow; it does not migrate the example
projects, run `/project-spec` on this repository, release anything, or alter
global configuration. It does not add a scoring service or a second scheduler.
The installed upstream `/spec` remains an issue-spec workflow.

## Verification

Use installer/host/protocol and telemetry suites for discoverability and
cross-host delivery; source-tag tests for conservative review-deferral routing;
existing parser/packing checks for the new card prose; init checks for guidance.
Forward-test realistic new and existing projects with isolated fixtures and
read-only/no-external-action boundaries. These are synthetic workflow checks,
not evidence that a real project's MVP or release is accepted.
