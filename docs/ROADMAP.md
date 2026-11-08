# Roadmap

Organized by lifecycle state: **In Progress**, **Current Plan**, **Future** and
**Shipped**. A Track is one PR/session. The packer assigns Groups of disjoint
file footprints and their launch dependencies. Explicit scheduling edges carry
the owner's priority order, and each card's **Scheduling:** line separates its
priority choices from technical prerequisites.

**Spec revision, 2026-11-07.** The owner revised [SPEC](SPEC.md): 1.0.0 is the
owner's own real use, by hand and through an orchestrator, and the public
release (the owner's "2.0") is the next stage; no single workspace host is
required, because a published orchestration contract (O4) says what a host or
orchestrator must provide, and O3 is evidenced by two real drivers; bounded,
measured stage effort is outcome O6. The owner's answers that shaped this plan
(2026-11-07): "1 - a", "2 yes", "3 yes", "70b yes future", "71a yes kill",
"70a ok", "72c ok", "72a confirm" and "72d confirmed as well", using that day's
labels. The pair-review redesign ("pair-review design: yes"), the Codex sandbox
fix ("let's do everything under our control though to resolve this") and the
retirement of `/autoplan-lean` ("yes, kill autoplan-lean") were approved the
same day, as were capturing the owner's hand use in telemetry ("we need to make
sure telemetry captures my use by hand") and labelled release-note disclosures
in plans and review handoffs ("sure if necessary").

**Order.** The owner's efficiency order through Track 69A has shipped (see
shipped history), as have the retirement of `/autoplan-lean` (Track 70A,
v0.72.0), the published orchestration contract (Track 71C), agent verification
before human testing (Track 71D, v0.73.0) and the Codex sandbox fix for the
layout-scaffold suite (Track 71E, v0.72.2). Owner priority, 2026-11-08:
"contract gaps and attacker parts is first priorities", so the fixed stage exit
lines (Track 72A) and the red team with delegable attacker parts (Track 72B)
lead the plan, then docs-only test selection (Track 72C) and the remaining 1.0
order: the skills and telemetry move onto the contract's signals, hand use
becomes visible in telemetry, and install/upgrade and the two-driver workflow
are qualified on that final behavior. The O6 measurement and decisions follow,
beside the stable update channel the owner placed "right before 1.0" (Track
77B). The install qualification (Track 72E) can run whenever the owner has
time. Work that gates nothing comes last: the review-finding records (Tracks
77C and 79A) and aligning install and upgrade with gstack (Track 78A), whose
timing is the owner's "at some point".

**Keep moving; park only what we should not do.** Owner rule (2026-11-05): "we
never want to 'park' something -- we always want to find a way to keep moving
forward". A stalled or blocked Track is unblocked, split or rerouted, not set
aside. "parking is an option when it turns out we shouldn't even do a track,
because it's counter to our objectives, then it would make sense to park and
re-evaluate".

**Dropped: Track 35B.** The `full-suite=before-audit` value was dropped rather
than renumbered (2026-10-31): under `full-suite=final` and
`full-suite=external` the full suite already runs once on the final content,
after the documentation audit (`skills/review-and-prep.md`, Review policy
section and the external gate's slot), so that value has no second full suite
to avoid, and no caller has asked for it. Under `full-suite=external` the
pregate's selected test lanes ran a second time after the caller's accepted
full-suite pass (corrected 2026-11-01); the v0.60.0 pregate narrowing skips
that repeat when the attested command covers every selected test. That is a
different repetition from the one 35B targeted, so 35B stays dropped and its
design item E3 stays marked dropped in the
[efficiency program](designs/workflow-efficiency-program.md); reinstating it is
the owner's decision.

**Card size.** A Track estimated above about 300 authored lines, counting its
tests, is split into separate Tracks unless splitting would leave a Track that
cannot ship alone. Byte-copied shared blocks and generated text do not count
toward that threshold. Do not split when the resulting Tracks would edit the
same files and must run one after another anyway, because each Track costs a
full pipeline run. A card kept above the threshold says why on its
**Scheduling:** line, and a card with copied or generated lines states them
separately from authored ones (owner rule, 2026-10-26). Track 31A was already in
progress when the rule was adopted and has shipped. Applied 2026-10-26 to three
Track pairs that edit the same files and run in sequence: each pair is now one
card, with the reason on its Scheduling line; the review-fix policy pair stayed
split on purpose (both Tracks have shipped, 33A in v0.55.0 and 51A in v0.59.0;
the reason is on 51A's shipped receipt).

**Labels.** This regeneration recorded Tracks 71C, 71D and 71E, retired
Group 71 and relabelled the remaining work from Group 72 in packer order; the
renames are in its commit messages. Shipped numbers through 71 are reserved by
tombstones; 64 was never a roadmap Group.

Target: [SPEC](SPEC.md) O1–O6, 1.0.0 as the owner's own real use by hand and
through an orchestrator; audience ceiling potentially-public. No workspace host
or orchestrator is required; support claims name only exercised combinations.
Implementation, installed/operator evidence and owner acceptance remain
distinct. No new spend or unattended merge is authorized.

## In Progress

No Track is declared in flight. Tracks 71C (PR #217), 71D (PR #218, v0.73.0)
and 71E (PR #216, v0.72.2) shipped after the last regeneration and are recorded
in shipped history. O1 and O3–O6 remain pending; O2 was accepted on 2026-10-23.

## Current Plan

_tombstone: 17, 19, 20, 22, 23, 24, 25, 26, 28, 29, 30, 31, 32, 33, 47, 48, 49, 50, 51, 52, 57, 58, 64, 65, 66, 67, 68, 69, 70, 71_

### Group 72: Contract exit lines ∥ delegable attacker parts ∥ docs-only selection ∥ Codex sandbox suites ∥ install qualification

_Depends on: none_

**This group delivers:** Fixed exit lines for the stages the orchestration contract still lists as gaps, a red team on every host with attacker parts a caller can delegate, policy-backed docs-only test selection, a whole suite that passes inside Codex's sandbox, and the owner's install/upgrade/recovery evidence including the published three-part upgrade.

##### Track 72A: Give the remaining stages a fixed exit line under the contract
_3 tasks . ~400 LOC incl. tests . medium risk_
**Outcome:** An orchestrator can read the exit of `/pair-review`, `/ship-and-land`, `/full-review`, `/roadmap` and `/project-spec` from one fixed, versioned line (stage identity, status or hold, checked revision and next action) instead of parsing prose, as it already can for `/plan-track`, `/implement` and `/review-and-prep`.
**Supports:** [SPEC](SPEC.md) O4.1 (what each stage promises); closes the stage-exit rows that contract version 1 of the [orchestration contract](orchestration-contract.md) marked "no Track scheduled"; they now name this Track. Owner priority, 2026-11-08: "contract gaps and attacker parts is first priorities".
**Done when:** `/pair-review`, `/ship-and-land` (every exit, including landed, release-only hold, blocked and handed back), `/full-review` (finish, pause and blocked) and `/roadmap` and `/project-spec` (the `Run /docs-ship` handoff, no-commit and blocked exits) end their final message with a fixed line under the [stage line](workflow-handoffs.md#grammar-stage-line) grammar, or a documented versioned successor, carrying stage identity, status, checked revision (the head the stage checked, or `none`) and next action; `docs/workflow-handoffs.md` documents each new producer and exit with fixtures, and older consumers that ignore unknown lines stay valid; existing `Run /review-and-prep`, `review-and-prep/v1`, `Run /docs-ship` and H-C resume consumers are unaffected; protocol tests lock each line; the contract's rows for these stages read `honored` or name what is still open; the H-C pause example and its byte-locked fixture `tests/fixtures/handoffs/c-pause.txt` list only judgment or access checks, matching Track 71D's narrowed definition.
_touches: skills/pair-review.md, skills/ship-and-land.md, skills/full-review.md, skills/roadmap.md, skills/project-spec.md, docs/workflow-handoffs.md, docs/orchestration-contract.md, tests/handoff-contract.test.ts, tests/fixtures/handoffs/, tests/skill-protocols-pair-review.test.ts, tests/skill-protocols-ship-and-land.test.ts, tests/skill-protocols-full-review.test.ts, tests/skill-protocols-roadmap.test.ts, tests/skill-protocols-project-spec.test.ts_
_blocked-by: Track 71C_
**Scheduling:** First by owner priority (2026-11-08). Kept as one card above ~300 lines under the card-size rule's same-files exception: a split by stage would edit the same stage-line grammar, contract rows, handoff test and fixtures and run one after another anyway. The edge on Track 71C (shipped, contract version 1) is satisfied. Whether the new producers extend `stage-handoff/v1` or need a successor is the plan's call under that grammar's rule 7; adding a producer to a line older consumers ignore is the compatible path.
_Source: [orchestration contract](orchestration-contract.md) rows marked "no Track scheduled" (Track 71C, PR #217); the stale H-C pause example from Track 71D's documentation audit (PR #218)._
_read-first: docs/orchestration-contract.md, docs/workflow-handoffs.md_
- **Extend the stage-line grammar for the new producers** -- Stage and next values, the exit table for each new producer, what `head` means for each (for `/ship-and-land`, the PR head it checked and the merge commit when it landed), fixtures and the H-C pause example correction; update the contract rows. _~120 lines incl. tests._ (M)
- **Fixed exits for /pair-review and /ship-and-land** -- Print the line after the H-C resume prompt and on `/pair-review`'s other exits, and on every `/ship-and-land` exit beside its existing report and release-only hold; lock each with protocol tests. _~180 lines incl. tests._ (M)
- **Fixed exits for /full-review, /roadmap and /project-spec** -- Print the line after `/full-review`'s finish and pause reports and after the `Run /docs-ship` handoff (and on the no-commit and blocked exits) of `/roadmap` and `/project-spec`; lock each with protocol tests. _~100 lines incl. tests._ (S)

##### Track 72B: Run a red team on every host and let callers delegate the attacker parts
_3 tasks . ~350 LOC incl. tests . medium risk_
**Outcome:** When a host's `/review` rendering has no red team (as on Codex), `/review-and-prep` still runs one, and a caller can send the native adversarial pass and the red team, like the specialist parts today, to the model and effort it names per part in settings, with each finding still attributed to the part that found it; a by-hand run with no caller lines behaves exactly as today.
**Supports:** [SPEC](SPEC.md) O6 and the optimization evidence rules (P1: caller-specific behavior through a documented option, today's default kept) and O4.4 (attribution and provenance). Not a 1.0 gate; owner priority, 2026-11-08: "contract gaps and attacker parts is first priorities". Owner, 2026-11-08: "yes, this approach seems compelling; we need to be able to assign the models for each of these in settings so we can easily change if we decide in the future"; on hand use: "i want to make sure the attacker parts we're adding will function appropriately when we use review and prep by hand; but still allow [the orchestrator] to fill in specific models to each part as it wants", then "that's actually fine; i'm not asking for anything new when run by hand, as long as it continues to work".
**Done when:** `/review-and-prep` runs a red-team step itself when the installed `/review` rendering has none, without changing upstream gstack, and the plan states whether it runs by default or only on a caller's opt-in (a by-hand default adds no question or hold); `delegate=` accepts `adversarial` and `red-team`, each sent to the provider, model and effort the caller's `review-delegates/v1` file maps to that part, with today's fallback to the host model when a delegate fails; a delegated attacker finding keeps `found_by` `native-adversarial` or `red-team` plus the v:3 delegate fields, with no new label; every gate, stop condition and the default (no `delegate=`, nothing changes) are preserved; a by-hand run with no `Review policy:` or `Review delegates:` line needs no new setup and behaves and passes exactly as before; a dated record holds one real by-hand run with no caller lines read back as unchanged and one orchestrated run with per-part models; the release notes disclose the review-policy contract change and its level.
_touches: skills/review-and-prep.md, tests/skill-protocols-review-and-prep.test.ts, src/review-delegate/delegate.ts, src/review-delegate/cli.ts, tests/review-delegate.test.ts, docs/delegated-review.md, docs/acceptance/attacker-parts.md (new)_
_blocked-by: Track 69B_
**Scheduling:** First by owner priority (2026-11-08), beside the exit-line Track (disjoint files). Kept as one card above ~300 lines under the card-size rule's same-files exception: the red-team step and the delegable parts edit the same skill section and protocol test and would run one after another. An orchestrator has already agreed to the part names `adversarial` and `red-team`, which match the existing attribution labels. Facts checked 2026-11-08: `src/review-delegate/delegate.ts` `PARTS` lists only `testing`, `maintainability`, `performance` and `simplification`; a `review-delegates/v1` provider carries `argv`, `timeout_s` and `model`, so effort travels in the provider's `argv`; `skills/review-and-prep.md` keeps "Security, Red Team, state-machines, the native adversarial pass, the outside voices and the documentation and coverage audits" on the host model and reads any other part as `delegate: <name> is not delegable`; the installed Codex rendering of `/review` contains no Red Team step.
_Source: owner-approved card (2026-11-08) from an orchestrator's review experiment (2026-11-07, caller-reported, not reproduced here): on one head two Codex-hosted reviews found nothing, while a Claude-hosted review found 3 critical findings (one a shipped regression) and 9 informational; its native adversarial pass found the regression by reproducing it and its red team found two more, while specialists found only low-severity items._
_read-first: docs/delegated-review.md, docs/workflow-metrics.schema.json_
- **Red-team step for hosts whose /review has none** -- Detect the missing step in the installed rendering, run the red team from `/review-and-prep` with today's inputs and gates, and settle default versus opt-in so a by-hand run gains no question or hold. _~120 lines incl. tests._ (M)
- **Delegable `adversarial` and `red-team` parts** -- Widen `PARTS`, the policy value and the skill's delegation section; keep attribution labels, v:3 fields, host fallback and every stop condition; lock the by-hand no-line path. _~190 lines incl. tests._ (M)
- **Record a by-hand and an orchestrated run** -- One real by-hand run with no caller lines read back as unchanged, and one orchestrated run with per-part models, in `docs/acceptance/attacker-parts.md`. _~40 lines._ (S)

##### Track 72C: Use pregate to select docs-only tests and explain long runs
_2 tasks . ~280 LOC incl. tests . medium risk_
**Outcome:** Docs-only shipping has one policy map for selected tests and attributable work/wait timing.
**Supports:** [SPEC](SPEC.md) O6, a non-gating candidate optimization (P1, selected efficiency program item E8, 2026-10-25), kept in the plan by the owner on 2026-11-07 ("70a ok") because `/docs-ship` ships every roadmap and spec PR.
**Done when:** With a usable base policy the nonexecuting pregate explanation owns selected tests and reasons for the exact delta; missing/invalid policy and legacy marker handling are explicit and conservative. Same-tree evidence reuse survives. The reported 211-minute outlier has an evidenced explanation; any unavailable intervals remain open unless the owner explicitly defers that obligation.
_touches: src/docs-ship/pinning.ts, src/docs-ship/cli.ts, src/docs-ship/config.ts, skills/docs-ship.md, docs/docs-ship.md, tests/docs-ship.test.ts, tests/skill-protocols-docs-ship.test.ts_
_blocked-by: Track 31A, Track 29A, Track 69A_
**Scheduling:** Its before/after evidence feeds the O6 decision for item E8; the change itself is not a 1.0 gate.
_Source: program E8 / research R8_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Adopt the policy map compatibly** -- Consume exact-delta/base-policy explanation, preserve no-lane and error semantics, and cover policy-backed, policy-less, configured-marker and bump-delta cases without silently losing coverage. _~210 lines._ (M)
- **Account for long docs-only runs** -- Separate active review/test work, host/tool stalls and human waits using E1; retain bounded evidence and unknowns, and attach the installed `/docs-ship` run to the two-driver workflow qualification. _~70 lines._ (S)

##### Track 72D: Make the subprocess-driven suites pass inside Codex's sandbox
_3 tasks . ~200 LOC . low risk_
**Outcome:** Every suite passes the same on the host and inside a Codex worker's workspace-write sandbox, including the suites that run a gstack-extend command as a child process and read its output, so a Codex implementer's or reviewer's checks never fail on the test environment.
**Supports:** [SPEC](SPEC.md) O3 (a supported driver's checks must not fail on its own sandbox). Owner direction, 2026-11-07: "let's do everything under our control though to resolve this"; owner word for this card, 2026-11-07: "Ok sure".
**Done when:** The whole suite passes on the host and inside `codex sandbox -c sandbox_mode=workspace-write` with a private `TMPDIR`, including with `/tmp` excluded from the writable roots; child processes get file-backed stdio from one shared test helper instead of a per-suite wrapper; the tests that run `./setup` with an explicit environment pass `TMPDIR` through; no assertion is weakened and no retry is added; product code changes only where the plan shows the failure is in product code; the handoff records the sandbox run per suite.
_touches: tests/helpers/child-stdio.ts (new), tests/helpers/run-bin.ts, tests/layout-scaffold.test.ts, tests/upstream-check.test.ts, tests/merge-gate.test.ts, tests/audit-cli-contract.test.ts, tests/workflow-metrics.test.ts, tests/pregate-deps.test.ts, tests/telemetry.test.ts, tests/setup-init-wire.test.ts_
_blocked-by: Track 71E_
**Scheduling:** Follows Track 71E (shipped, v0.72.2), which fixed `tests/layout-scaffold.test.ts` alone and whose sweep found 9 other suites failing in the sandbox (6 on the `spawnSync` pipe `EPERM`, 3 only with `/tmp` excluded because their synthetic environment omits `TMPDIR`). Checked 2026-11-08: those suites call `spawnSync` directly rather than through `tests/helpers/run-bin.ts`, so each switches to the shared helper; `tests/helpers/run-bin.ts` is a global touchfile, so its edit runs the whole suite.
_Source: owner-approved card (2026-11-07) and Track 71E's sweep (PR #216)._
_read-first: tests/layout-scaffold.test.ts, tests/helpers/run-bin.ts_
- **Shared file-backed child stdio** -- Move Track 71E's temporary regular-file descriptors into a shared helper under the suite's temp parent and switch each failing suite's `spawnSync` calls to it. _~140 lines._ (M)
- **Pass `TMPDIR` to `./setup` in tests** -- Give the explicit environments that tests pass to `./setup` the caller's `TMPDIR`. _~30 lines._ (S)
- **Prove it on both sides** -- Run the whole suite in the sandbox with a private `TMPDIR` (with and without `/tmp` writable) and on the host, and record the per-suite result. _~30 lines._ (S)

##### Track 72E: Qualify install, upgrade and recovery on the owner's machines
_2 tasks . ~160 LOC . medium risk_
**Outcome:** The owner can install, onboard, upgrade and recover a working skill set on a fresh machine from the published instructions, with evidence of what was actually installed.
**Supports:** [SPEC](SPEC.md) O1 (all three criteria) and O5.2; the preserved published three-part upgrade obligation from Track 28A planning (2026-10-23), whose trigger was met by v0.48.0.
**Done when:** A dated record names the OS, host, harnesses and versions of a fresh install and project onboarding on the owner's machine, actionable failures for a missing prerequisite, an upgrade with user-owned files preserved and stale copies reported, a working recovery path, and a real legacy four-part install upgraded through the default remote with offered and installed commit/tag identity, reader compatibility and unchanged user state; it records the actual installed commit and discloses that upgrade offers follow main rather than a release identity; failures stay open; the owner confirms before O1 counts.
_touches: docs/acceptance/install-upgrade.md (new)_
_blocked-by: Track 70A, Track 28A_
**Scheduling:** Technical edge on Track 70A (shipped, v0.72.0): the qualified upgrade includes removing the retired skill. Candidate or file-remote proof does not satisfy the published-upgrade obligation.
_read-first: docs/installation.md, docs/acceptance/release-compatibility.md_
- **Fresh install, onboarding, upgrade and recovery** -- Run them on the owner's machine from the published instructions and record each step, intervention and result. _~90 lines._ (M)
- **Published three-part upgrade from a legacy install** -- Upgrade a real four-part install through the default remote and record offered and installed identity, reader compatibility, recovery and unchanged state beside `docs/acceptance/release-compatibility.md`. _~70 lines._ (M)

### Group 73: Contract host attribution ∥ release-note labels

_Depends on: Group 72_

**This group delivers:** Host attribution through the contract in telemetry, and labelled release-note disclosures and the exact `_release:` line in plans and review handoffs.

##### Track 73A: Attribute workspace hosts through the contract in telemetry
_3 tasks . ~260 LOC incl. tests . medium risk_
**Outcome:** Provenance rows record the workspace host from the contract's signal, Conductor-only reading code is gone, and every existing row stays readable.
**Supports:** [SPEC](SPEC.md) O4.2 and O4.4 (host evidence distinguishable, public provenance schemas readable); owner, 2026-11-07 (host-specific markers replaced by the generic contract).
**Done when:** `bin/lib/telemetry.py` takes host attribution from the contract's signal instead of the `PASEO_AGENT_ID`/`CONDUCTOR_SESSION_ID` pair, and its Conductor Cursor-store reader and `conductor` route are removed; the schema and `docs/telemetry.md` keep accepting old rows' `conductor` route and `workspace_host` values; the four recorded report test gaps from Track 69D's review have tests; the release notes disclose the incompatible change under the 0.x policy.
_touches: bin/lib/telemetry.py, tests/telemetry.test.ts, tests/telemetry-contract.test.ts, docs/telemetry.md, docs/stage-runs.schema.json_
_blocked-by: Track 71C, Track 70A, Track 72D_
**Scheduling:** Technical edge on Track 71C (shipped; the contract names the host-attribution signal as `GSTACK_EXTEND_WORKSPACE_OWNER`); the edge on Track 70A (shipped, v0.72.0) is satisfied. The edge on Track 72D is a priority choice: both edit `tests/telemetry.test.ts`, and the sandbox fix goes first so a Codex worker's checks on this Track pass. The quota ledger's Conductor store reader stays in Future: quota is experimental and not a host guard or marker.
_read-first: docs/orchestration-contract.md, docs/telemetry.md_
- **Attribute the host from the contract and drop the Conductor reader** -- Replace the marker pair, remove the Conductor store reader and route, keep old rows valid. _~170 lines incl. tests._ (M)
- **Keep the schema and documentation readable for old rows** -- Document the change, keep historical enum values, and disclose it. _~40 lines._ (S)
- **Cover the recorded report test gaps** -- Structured transcript resume forms, signal-reader exception isolation, missing installed-skill metadata and report filesystem error diagnostics (`[review:files=bin/lib/telemetry.py]`, recorded 2026-11-07). _~50 lines._ (S)

##### Track 73B: Carry release-note disclosures from the plan through the review handoff
_4 tasks . ~210 LOC incl. tests . low risk_
**Outcome:** An orchestrator's release step can read labelled release-note and upgrade-risk disclosures from the plan and the review handoff instead of inferring them from prose.
**Supports:** [SPEC](SPEC.md) O4.1 (what each stage promises) and O5.1 (disclosed upgrade risk); owner, 2026-11-07 ("sure if necessary"). Today no stored plan carries such labels and almost no review handoff does.
**Done when:** `/plan-track` writes an optional labelled block of `Release note:` and `Upgrade risk:` lines only when a change needs a disclosure, never reusing Risks bullets; `/review-and-prep`'s handoff carries `User-facing change:` lines kept out of the `Run /ship-and-land` and `stage-handoff/v1` lines; `docs/workflow-handoffs.md` documents both with the grammar a consumer reads (label singular or plural, optionally bold, inline or as a bullet block, outside code fences); `/plan-track` documents the exact one-line release-level grammar `_release: <patch|minor|major|1.0.0> (<SPEC mapping>)_`, with any disclosure on separate labelled lines rather than on the `_release:` line; protocol tests lock all three; existing handoff consumers are unaffected.
_touches: skills/plan-track.md, skills/review-and-prep.md, docs/workflow-handoffs.md, tests/skill-protocols-plan-track.test.ts, tests/skill-protocols-review-and-prep.test.ts, tests/handoff-contract.test.ts_
_blocked-by: Track 70A, Track 71D, Track 72A, Track 72B_
**Scheduling:** The edges are priority choices ordering edits to the same skill, handoff and test files: behind the retirement of `/autoplan-lean` (Track 70A, v0.72.0) and the narrowed user-testing Track (Track 71D, v0.73.0), both shipped, and behind the owner's first priorities, the exit-line and attacker-parts Tracks (owner, 2026-11-08). On 2026-11-07 a search of `skills/`, `src/`, `bin/`, `docs/workflow-handoffs.md` and `docs/roadmap-shipped.md` found none of the three labels, so the grammar clashes with nothing.
- **Optional disclosure block in /plan-track** -- `Release note:` / `Upgrade risk:` lines, written only when needed. _~40 lines incl. tests._ (S)
- **`User-facing change:` lines in the review handoff** -- Emit them beside, never inside, the `Run /ship-and-land` and `stage-handoff/v1` lines. _~70 lines incl. tests._ (M)
- **Document and lock the label grammar** -- Add the grammar to the handoff contract with fixtures. _~70 lines incl. tests._ (S)
- **Document the exact `_release:` line in /plan-track** -- One line, `_release: <patch|minor|major|1.0.0> (<SPEC mapping>)_`, with disclosure text on the separate labelled lines above. Evidence: Track 71D's plan wrote `_release: minor — <paragraph>`, and the caller's scripted release refused it as `level_invalid`, so v0.73.0 was released by hand. No code in this repository or in installed gstack reads `_release:` today (checked 2026-11-08); the caller's release step does. _~30 lines incl. tests._ (S)

### Group 74: Hand use in telemetry ∥ human-judgment pair-review

_Depends on: Group 73_

**This group delivers:** Telemetry that records the owner's hand use correctly across machines, and a `/pair-review` that carries only human-judgment items.

##### Track 74A: Record hand use accurately across the owner's machines
_3 tasks . ~260 LOC incl. tests . medium risk_
**Outcome:** The owner can see in telemetry how often they run each stage by hand, on every machine they use, and an orchestrated run is never counted as hand use.
**Supports:** [SPEC](SPEC.md) O6.1 and O3.3 (the by-hand driver's evidence); owner, 2026-11-07: "we need to make sure telemetry captures my use by hand, because I use it by hand often enough but you don't seem to be aware of it".
**Done when:** A stage the owner runs by hand is recorded `user-directed` in each harness the owner uses by hand, or `unknown` with the reason where no signal can show it, never a guess; a stage an orchestrator launches, interactive or not, is never recorded `user-directed` when it carries the orchestration contract's run-mode signal, and an interactive session in a host-managed workspace without that signal is not assumed to be hand use; `gstack-extend-telemetry report` can read per-host files synced from the owner's other machines (no hosted service) and shows hand use per machine; a dated record holds real by-hand runs on each of the owner's machines read back as `user-directed`, and an orchestrated interactive run read back as `orchestrated`; until that record exists, nothing claims hand use is captured.
_touches: bin/lib/telemetry.py, tests/telemetry.test.ts, tests/telemetry-contract.test.ts, docs/telemetry.md, docs/acceptance/hand-use-telemetry.md (new)_
_blocked-by: Track 71C, Track 73A_
**Scheduling:** Technical edge on Track 71C (the contract names the run-mode signal an orchestrator sets for every stage it launches). The edge on Track 73A orders edits to the same telemetry files. Facts at 0.71.0 (`bin/lib/telemetry.py` `run_mode()`, checked 2026-11-07): with no `GSTACK_SESSION_KIND`, work item or `GSTACK_EXTEND_RUN_MODE`, a Claude session whose entrypoint is `cli` or `Paseo` reads `user-directed`, so an orchestrator-launched interactive worker that sets none of them is counted as hand use (this machine's report showed exactly that for two `project-spec` runs on 2026-11-07); Codex and Cursor sessions always read `unknown`; rows are written per host under each machine's own state directory; and only gstack-extend's own skills write rows, so hand use of upstream gstack skills is not counted (out of scope here). Setting the signal inside an orchestrator is that consumer's work, not this repository's.
_read-first: docs/telemetry.md, docs/orchestration-contract.md_
- **Classify interactive orchestrated runs and hand runs correctly** -- Read the contract's run-mode signal for interactive workers, stop inferring hand use from a host entrypoint alone, and cover the harnesses the owner uses by hand, with `unknown` plus a reason where no signal decides. _~140 lines incl. tests._ (M)
- **Report hand use across the owner's machines** -- Let the report read synced per-host files from more than one state directory and show runs per machine and mode, keeping today's single-machine output. _~90 lines incl. tests._ (M)
- **Record real by-hand and orchestrated runs** -- Run stages by hand on each of the owner's machines and one orchestrated interactive stage, read them back through the report and record the result. _~30 lines._ (S)

##### Track 74B: Keep /pair-review to human-judgment items
_3 tasks . ~260 LOC incl. tests, plus deletions . medium risk_
**Outcome:** A person running `/pair-review` sees only items that need their judgment or access, with state prepared and evidence attached by the agent, and is asked to retest only after the agent has reproduced and re-verified a fix.
**Supports:** [SPEC](SPEC.md) O3 manual-testing pause/resume; owner, 2026-11-07 ("pair-review design: yes … it isn't supposed to be [autonomous QA]").
**Done when:** The test list carries only human-judgment items, each with agent-prepared state and attached evidence; after a fix the agent reproduces and re-verifies before any human retest and keeps the failed result on record; the Covers/bundle and coverage-editing machinery that exists only for inspection checks (cookies, logs, DB rows, network calls) is removed, so `skills/pair-review.md` shrinks; the handoff `Results:` line stays readable by `/review-and-prep resume` and published H-C consumers (a compatible form or an explicit migration); it stays a human-testing skill.
_touches: skills/pair-review.md, tests/skill-protocols-pair-review.test.ts, docs/workflow-handoffs.md, tests/handoff-contract.test.ts_
_blocked-by: Track 71D, Track 70A, Track 73B_
**Scheduling:** Technical edge on Track 71D: it consumes the narrowed definition of required user testing. The edge on Track 73B is a priority choice ordering edits to the handoff contract and its test; the edge on Track 70A (shipped, v0.72.0) is satisfied. Kept at three tasks; the deletion is cheap.
_read-first: skills/review-and-prep.md_
- **Remove the inspection-only coverage machinery** -- Delete `Covers:` inference, its validation, the coverage-graph review, bundle confirmation and their counters. _~300 lines (del)._ (S)
- **Carry only human-judgment items with prepared state and evidence** -- Generate the list from the narrowed definition, have the agent prepare state and attach its evidence per item, and keep the H-C `Results:` line compatible (`(0 by coverage)` or a documented migration). _~150 lines._ (M)
- **Re-verify fixes before any human retest** -- After a fix the agent reproduces the failure and re-verifies; a human retests only a verified fix, and a failed check is never re-marked passed. _~110 lines incl. tests._ (M)

### Group 75: Review evidence and recovery ∥ contract workspace signal in the skills

_Depends on: Group 74_

**This group delivers:** A documented review-evidence and capped-review recovery path, and stage skills that read the contract's workspace signal with the Conductor code removed.

##### Track 75A: Specify portable review evidence and capped-review recovery
_2 tasks . ~220 LOC incl. tests . medium risk_
**Outcome:** Callers know what proves a completed full review and how a stopped draft can reach shipping.
**Supports:** [SPEC](SPEC.md) O3.2 stop preservation and O4.3–O4.4 provenance (efficiency program E10–E11); confirmed by the owner, 2026-11-07 ("72d confirmed as well").
**Done when:** A supporting design maps review facts to a portable evidence-bundle reference and independently checks review-log full-scope/completion/convergence/binding predicates. Documentation walks stopped draft → authorized exact repair-only continuation → prepared readiness → ship with all unavailable evidence and continuation counts preserved, including a stop after a first cycle that reproduced defects; it cites the already recorded rule that `/ship-and-land` keeps refusing a stopped draft, including one whose receipt says `Unresolved: none recorded` (`B-STOPPED-NONE-RECORDED`). No envelope runtime or stop bypass is introduced.
_touches: docs/designs/review-evidence-envelope.md (new), docs/workflow-handoffs.md_
_blocked-by: Track 29A, Track 30A, Track 32A, Track 74B_
**Scheduling:** The capped-review repair and baseline-repair edges are technical: the documented recovery path must describe the shipped repair-only continuation. The edge on Track 74B is a priority choice ordering edits to `docs/workflow-handoffs.md` behind the pair-review Tracks. This Track specifies and checks the cycle 1 baseline record and does not write it.
_Source: program E10–E11 / research R11 and observed capped-review stops_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Map the existing upstream proof** -- Compare commit_full/tree/scope/completed/converged/cycles plus review_binding and verified/imported lane semantics; specify missing/stale/unavailable cases and identify gaps without claiming nonconverged full scope is a completed baseline. _~150 lines._ (M)
- **Document the recovery path** -- Use the stop receipt's own repair-only prompt and remaining budget, preserve the bound PR, and show why shipping cannot replace the continuation, including for a receipt that says `Unresolved: none recorded`. Keep manual holds and Full-review evidence: unavailable explicit. _~70 lines._ (S)

##### Track 75B: Honor the contract's workspace signal in the skills
_3 tasks . ~220 LOC incl. tests . medium risk_
**Outcome:** Every stage leaves branch and worktree lifecycle to whatever host or orchestrator marks the workspace as its own, without detecting Paseo or Conductor by name.
**Supports:** [SPEC](SPEC.md) O4.2 and O3.2 (host ownership of branches and worktrees); owner, 2026-11-07, approving that the Future entry "Remove Conductor support from the code" become a 1.0 Track.
**Done when:** The host-managed-workspace guards in `/implement`, `/review-and-prep` and `/ship-and-land` read the contract's worktree-ownership signal, with Paseo documented as one provider if the contract keeps it; the `SHARED:conductor-visibility-head` block, its `CONDUCTOR_SKILLS` cohort and the Conductor `.context/` storage fallbacks are gone from `/full-review`, `/pair-review` and `/roadmap`, which store under the state root, then `~/scratch/`; protocol tests lock the new guards and the removal; the release notes disclose the incompatible change under the 0.x policy.
_touches: skills/implement.md, skills/review-and-prep.md, skills/ship-and-land.md, skills/full-review.md, skills/pair-review.md, skills/roadmap.md, tests/skill-protocols.test.ts, tests/skill-protocols-implement.test.ts, tests/skill-protocols-review-and-prep.test.ts, tests/skill-protocols-ship-and-land.test.ts, tests/skill-protocols-roadmap.test.ts, tests/skill-protocols-plan-track.test.ts, tests/helpers/parse-setup-skills.ts_
_blocked-by: Track 71C, Track 74B, Track 70A_
**Scheduling:** Technical edge on Track 71C (it implements the contract's signal). The edge on Track 74B is a priority choice that orders same-file edits with the pair-review Tracks; the edge on Track 70A (shipped, v0.72.0) is satisfied.
_read-first: docs/orchestration-contract.md_
- **Read the contract's signal in the workspace guards** -- Replace the Paseo- and Conductor-named guards in the three stage skills. _~90 lines._ (M)
- **Remove the Conductor visibility block and `.context/` fallbacks** -- Remove the shared block, its cohort and the fallbacks, keeping each cohort's other members exact. _~110 lines incl. tests._ (M)
- **Lock the CLAUDE.md never-shared sentence** -- Add the missing drift lock for `/roadmap`'s sentence that `CLAUDE.md` is never shared and only one Track per Group may declare it, with a negative case. _~20 lines._ (S)

### Group 76: Compatibility catalog ∥ two-driver workflow qualification

_Depends on: Group 72, Group 73, Group 74, Group 75_

**This group delivers:** The stable compatibility and recovery catalog, and real by-hand and orchestrated workflow evidence.

##### Track 76A: Publish the stable compatibility and recovery catalog
_1 tasks . ~180 LOC incl. tests . medium risk_
**Outcome:** The owner and an orchestrator can identify stable interfaces, experimental exclusions and recovery obligations before relying on them.
**Supports:** [SPEC](SPEC.md) O5.1; preserved required inbox obligation, 2026-10-23; confirmed by the owner, 2026-11-07.
**Done when:** A catalog names every promised surface (including the orchestration contract), version/compatibility rules, support conditions and recovery links; stage-runs v2 is one checked example, not the whole catalog. Experimental surfaces stay explicitly excluded; no checkpoint is awarded by documentation alone.
_touches: docs/compatibility.md (new), docs/SPEC.md, README.md, docs/installation.md_
_blocked-by: Track 28A, Track 71C, Track 75B, Track 73A_
**Scheduling:** The edges on the contract and host-signal Tracks keep the catalog from freezing host-specific behavior as stable.
_Source: [plan-ceo-review] stable compatibility surfaces (O5.1)_
_read-first: docs/orchestration-contract.md_
- **Catalog the promised surfaces** -- Trace CLI/config, skills, the orchestration contract, handoffs, provenance and install ownership against shipped code and public instructions. Carry the existing stable promises and disclose unknown qualification; retain O5 acceptance as an owner gate. _~180 lines._ (M)

##### Track 76B: Qualify the workflow with two real drivers
_2 tasks . ~240 LOC . medium risk_
**Outcome:** The owner can carry real work through every stage both by hand and through a real external orchestrator, and the evidence shows what the documented contract actually supports.
**Supports:** [SPEC](SPEC.md) O3.3 and O4.5 (reshaped from the Paseo host Track by the owner, 2026-11-07: "72c ok").
**Done when:** A dated record names host, harness and versions for real runs by both drivers (the owner by hand, and one real external orchestrator), each run read back in telemetry with the correct run mode, covering, between them, a complete plan-to-authorized-release workflow, interrupted resume, manual-testing pause/resume, `/full-review` finish/restart, an explicit negative hold, an external-consumer handoff consumed from artifacts, a cross-session handoff and stale/partial/held handoffs; it counts operator interventions and keeps pending approvals or failures as holds; it includes the installed `/docs-ship` acceptance below; no unexercised combination is claimed.
_touches: docs/acceptance/workflow-drivers.md (new)_
_blocked-by: Track 70A, Track 72C, Track 71E, Track 74B, Track 75B, Track 73A, Track 74A, Track 26A, Track 23I, Track 23A, Track 26B, Track 65A, Track 66A, Track 66B, Track 72A, Track 72B_
**Scheduling:** Runs on the final behavior of the stages it qualifies, so it follows every Track that changes them, including the exit-line and attacker-parts Tracks. The external orchestrator may stop at a ready PR; a separate authorized run by hand proves landing. No consumer-repo edits, new spend, unattended release or acceptance-by-idle-status. The independently followed onboarding attempt moved to the public-release stage (Future).
- **Exercise both drivers** -- Use real host-managed workspaces and approved accounts with the harnesses the owner uses for each stage; retain the bound PR and workspace, test stale/partial/held handoffs, confirm next-stage consumption from artifacts across sessions, include the host-attribution check deferred from Track 26A, and count operator interventions. _~200 documentation lines._ (L)
- **Include installed `/docs-ship` acceptance** -- Run a real docs-only PR through classification, a no-write classification hand-back, selected tests once, same-tree test-record reuse, final receipt hash, policy bump and `docs-ship/v1` without merging; include one Sonnet-class run and one `/roadmap` handoff, and compare work/wait wall time with a recent docs PR shipped through the ordinary path. _~40 lines._ (S)

### Group 77: Measured stage cost ∥ stable update channel ∥ review-finding identity

_Depends on: Group 72, Group 75, Group 76_

**This group delivers:** Expected cost per stage with an adopt, reject or insufficient-evidence decision for every candidate optimization, upgrades that follow a stable release channel with a non-interactive auto-upgrade switch, and review findings that keep one identity and state across cycles.

##### Track 77A: Measure each stage's cost and decide each optimization
_3 tasks . ~460 LOC incl. tests . medium risk_
**Outcome:** The owner can reproduce an offline report of each stage's measured cost (model work, tool/CI/human waits, reuse and rework), read a documented expected cost per stage, and see an adopt, reject or insufficient-evidence decision for every candidate optimization.
**Supports:** [SPEC](SPEC.md) O6.1–O6.3 (owner, 2026-11-07: P1 joins the 1.0 outcomes with this finish line, and this Track gains the expected stage cost).
**Done when:** A reproducible offline report from sanitized projections separates DOCS/FULL/release-only paths, diff/task size, repo/host, run mode, skill version, waits and fresh versus resumed runs, and reports sample size and missingness; fixtures cover each split. A documented expected cost per stage (wall time and model usage, with sample size and unknowns) is published. Each efficiency-program candidate, including first-cycle overlap (69A), fold, delegation and the docs-only selection, has measured evidence or a named evidence gap and an adopt, reject or insufficient-evidence decision with its follow-up mapped to existing Future items. No review gate, model choice or default changes through the study itself.
_touches: scripts/workflow-efficiency-report.py (new), tests/workflow-efficiency-report.test.ts (new), tests/fixtures/workflow-efficiency/ (new), tests/helpers/touchfiles.ts, docs/acceptance/workflow-efficiency.md (new)_
_blocked-by: Track 67A, Track 52A, Track 76A, Track 75A, Track 76B_
**Scheduling:** Kept as one card above ~300 lines under the card-size rule's same-files exception (owner direction, 2026-10-26): the evaluation edits the same script, test and fixture files and reads the report the baseline builds. It follows the workflow qualification, whose real runs supply most of its rows.
_read-first: docs/telemetry.md, docs/quota-ledger.md, docs/designs/review-independence.md_
- **Build a comparable baseline and expected stage costs** -- Produce the offline report and the per-stage expected cost from it; reuse eligible release-only receipts and preserve the first-installed-no-CI timing obligation and 15-minute target; report time to push and merge gate separately from human approval. Observational differences are not causal model comparisons. _~200 lines._ (M)
- **Assess the uncertain efficiency choices** -- Compare smaller models and lower effort for bounded drafting/extraction versus the main runner, including launch/context-transfer and parent-correction costs; investigate repeated plan extraction, evidence reads, long-suite reruns, section loading, parallel scheduling and each reviewer voice's unique accepted findings. Define corpus, quality bars, fixed budgets and stop rules before any model trial; offline analysis only, and any paid trial needs a separately approved pilot and spend bound. _~180 lines._ (M)
- **Publish decisions and follow-up ownership** -- Adopt/reject/insufficient-evidence per candidate with expected benefit, observed limitations and the smallest follow-up, mapped to existing Future items; an insufficient-evidence result names missing data and a bounded next measurement and never silently removes a review or acceptance gate. _~80 lines._ (S)

##### Track 77B: Follow a stable release channel and let a bootstrap turn on auto-upgrade
_4 tasks . ~280 LOC incl. tests . medium risk_
**Outcome:** gstack-extend upgrades follow a stable release channel rather than main, each upgrade installs the release it offered, and a bootstrap script can turn on auto-upgrade on that channel without a prompt, mirroring gstack's `auto_upgrade` and `update_channel` settings.
**Supports:** [SPEC](SPEC.md) O1 (install, update and recover) and O5 (release promise). Required before 1.0. Owner, 2026-11-07: "Another we need here for 1.0 (if not already done) - on install, we should check for gstack and extend and install them if missing + turn on auto upgrade on stable for both — they are dependencies" and "This can be deferred to be done right before 1.0".
**Done when:** An `update_channel` setting selects a stable channel (release tags, or a stable branch the release step advances, chosen in the plan) and keeps today's main-tracking behavior available, with existing main-tracking installs and the rollback recipe documented in `docs/installation.md`; `bin/update-check` offers and `bin/update-run` installs the same release identity, or reports the mismatch; a documented non-interactive command enables auto-upgrade on the channel; `setup` reports a missing gstack install actionably (installing it stays the bootstrap's job unless the plan shows otherwise); `bin/update-check`'s published output and install-safety stay compatible; the compatibility catalog lists the setting; a dated upgrade through the stable channel on the owner's machine is added to the install qualification record.
_touches: bin/update-check, bin/update-run, bin/config, setup, docs/installation.md, docs/compatibility.md, tests/update.test.ts, docs/acceptance/install-upgrade.md_
_blocked-by: Track 76B, Track 76A, Track 72E_
**Scheduling:** Placed "right before 1.0" (owner): the edge on the workflow qualification is a priority choice; the edges on the catalog and install qualification Tracks are technical (it adds the setting to the catalog and appends to the install record). Facts checked 2026-11-08: `bin/update-check` reads `main`'s VERSION from the remote and `bin/update-run` fast-forwards `origin main`; there is no channel setting; `setup` checks only that `bun` exists; `bin/config set auto_upgrade true` is honored only by interactive upgrade flows, and spawned sessions never upgrade. An orchestrator's bootstrap does its own install-if-missing; this repository owes the channel, the setting and the non-interactive enable path.
_Source: owner-approved card (2026-11-07); merges the Future entry "Bind upgrade offers to the installed release identity" (raised during Track 28A planning, 2026-10-23), which the owner's word pulls into 1.0._
_read-first: docs/installation.md, docs/acceptance/release-compatibility.md_
- **Stable channel and offered-equals-installed identity** -- The `update_channel` key and its values, the channel mechanism, and binding the installed release to the offered one, with update tests. _~170 lines incl. tests._ (M)
- **Non-interactive enable and rollback** -- Document and test the bootstrap command and the return to main tracking. _~50 lines incl. tests._ (S)
- **Report a missing gstack at setup** -- An actionable result when installed gstack is absent. _~30 lines incl. tests._ (S)
- **Record a real channel upgrade** -- Upgrade the owner's install through the stable channel and record offered and installed identity in the install qualification record; list the setting in the catalog. _~30 lines._ (S)

##### Track 77C: Give review findings a stable identity and state across cycles
_3 tasks . ~300 LOC incl. tests . medium risk_
**Outcome:** A review finding keeps one identity and state (open, resolved or irrelevant, with who set it) across review cycles and re-reviews, and an orchestrator reads that state from the published workflow-metrics records instead of an invented file.
**Supports:** [SPEC](SPEC.md) O6 and the optimization evidence rules (P1), and O4.4 (public records stay readable). Not a 1.0 gate unless O6 needs it. Owner, 2026-11-07: "sure".
**Done when:** A cross-cycle finding key that survives line moves is recorded on each finding, with a test that moves the code and keeps the key; a finding state field (`open`, `resolved`, `irrelevant`) and who set it (model or owner) are written as a new version of the pass and correction records, while every existing record version stays readable; `docs/telemetry.md` and `docs/workflow-metrics.schema.json` document both; `/review-and-prep` writes them; the four recorded run-usage test gaps from Track 67A's review have tests.
_touches: bin/lib/workflow_metrics.py, docs/workflow-metrics.schema.json, docs/telemetry.md, tests/workflow-metrics.test.ts, skills/review-and-prep.md_
_blocked-by: Track 75B, Track 76B_
**Scheduling:** The edges are priority choices: they keep this non-gating Track off the 1.0 path, after the workflow qualification runs on settled stage behavior, and order its `skills/review-and-prep.md` edit behind the 1.0 Tracks that edit it. Facts checked 2026-11-08: `finding_id` is unique only within an attempt and nothing links a finding across cycles; receipt fingerprints (`path:line:category`) shift when lines move; an orchestrator agreed to extend the workflow-metrics records rather than add a file. The key comes first because suppression keyed on an unstable identity would hide real regressions.
_Source: owner-approved card (2026-11-07); Future entry "Recorded test gaps: run-usage capture and projection" (its trigger, a Track whose `_touches:` cover `tests/workflow-metrics.test.ts` and `bin/lib/workflow_metrics.py`, is met here)._
_read-first: docs/telemetry.md, docs/workflow-metrics.schema.json_
- **Cross-cycle finding key** -- Derive a key that survives line moves, record it beside `finding_id`, and prove it with a moved-code test. _~120 lines incl. tests._ (M)
- **Finding state and who set it** -- A new pass/correction record version with `open`, `resolved` or `irrelevant` and its setter, written by `/review-and-prep`, with old versions still readable. _~130 lines incl. tests._ (M)
- **Cover the recorded run-usage test gaps** -- Nested containing steps in `bin/lib/telemetry_usage.py` `collect`, the missing-usage projection, conflicting and dangling usage rows, and the 16-model and 32-pass projection limits, in `tests/workflow-metrics.test.ts` (`[review:files=bin/lib/telemetry_usage.py|tests/workflow-metrics.test.ts]` and three `[review:files=bin/lib/workflow_metrics.py|tests/workflow-metrics.test.ts]`, PR #206, 2026-11-05). _~50 lines._ (S)

### Group 78: Install and upgrade aligned with upstream gstack

_Depends on: Group 77_

**This group delivers:** An install and upgrade flow that looks and behaves like upstream gstack's, with a What's-new summary after every upgrade.

##### Track 78A: Align install and upgrade with upstream gstack
_3 tasks . ~280 LOC incl. tests, plus byte-copied shared blocks . medium risk_
**Outcome:** Installing and upgrading gstack-extend looks and behaves like upgrading upstream gstack: the same flow shape and output style, and a "What's new" summary shown after every upgrade.
**Supports:** [SPEC](SPEC.md) O1 (install, update and recover a working skill set). Not a 1.0 gate. Owner, 2026-11-07: "One thing I want to do at some point is re-align our install and upgrade process with gstack. Both visually and functionally, including the nice release notes presented to the user".
**Done when:** The upgrade flow's steps, prompts and output match upstream `/gstack-upgrade`'s shape, including snooze, auto-upgrade and just-upgraded handling; after every upgrade the user sees a What's-new summary drawn from `CHANGELOG.md` between the old and new versions (or the commit log on a main-tracking install) and a per-host upgrade summary; fresh-install onboarding is compared with gstack's and any gap recorded; install-safety rules, the `UPGRADE_OK`, `UPGRADE_FAILED`, `MIGRATION_WARN` and `INSTALL_WARN` tokens and `bin/update-check`'s published output stay compatible or migrate explicitly with disclosure; the two recorded update-check test gaps from Track 66A's review have tests.
_touches: skills/gstack-extend-upgrade.md, skills/gstack-extend-init.md, skills/full-review.md, skills/implement.md, skills/plan-track.md, skills/project-spec.md, skills/pair-review.md, skills/ship-and-land.md, skills/roadmap.md, skills/review-and-prep.md, skills/docs-ship.md, bin/update-run, setup, docs/installation.md, tests/skill-protocols.test.ts, tests/update.test.ts, tests/setup-hosts.test.ts_
_blocked-by: Track 77B_
**Scheduling:** Owner timing: "at some point"; it gates nothing. The edge on the stable-channel Track orders edits to the same upgrade files behind the 1.0 change. It lists every skill file because the shared upgrade-flow block is byte-copied into each of them; those copies do not count toward the card size. Facts checked 2026-11-08: `skills/gstack-extend-upgrade.md` only points the user at `CHANGELOG.md` and shows no summary, while upstream `/gstack-upgrade` shows a grouped What's-new summary; release text from 0.68.0 to 0.72.0 is thin, so the summary is only as good as the CHANGELOG.
_Source: owner-approved card (2026-11-07); Future entry "Recorded test gaps: update-check wording, trigger lines and notice placement" (its trigger, a Track whose `_touches:` cover `tests/skill-protocols.test.ts` and `tests/update.test.ts`, is met here)._
_read-first: skills/gstack-extend-upgrade.md, docs/installation.md_
- **Match upstream's upgrade flow and output** -- Steps, prompts and output format across the shared upgrade flow and `/gstack-extend-upgrade`, keeping the result tokens and install-safety rules. _~150 lines incl. tests, plus shared copies._ (M)
- **What's-new and per-host upgrade summaries** -- Summarize `CHANGELOG.md` (or the commit log) between versions and print one row per host install. _~100 lines incl. tests._ (M)
- **Cover the recorded update-check test gaps** -- Pin the `UPGRADE_SKIPPED spawned-session` sentence and the installation guide's just-upgraded clauses, assert the per-skill `UPGRADE_AVAILABLE` and `JUST_UPGRADED` lines and the spawned branch's placement, and show `bin/update-check` output reaching stdout (`[review:files=tests/skill-protocols.test.ts|tests/update.test.ts]` and `[review:files=tests/skill-protocols.test.ts]`, Track 66A, 2026-11-04). _~30 lines._ (S)

### Group 79: Review cycles scoped to open findings

_Depends on: Group 77, Group 78_

**This group delivers:** Opt-in later review cycles scoped to the delta plus open findings, with dismissed findings kept out unless their code changed.

##### Track 79A: Scope later review cycles to open findings and keep dismissals out
_2 tasks . ~220 LOC incl. tests . medium risk_
**Outcome:** A caller can scope a later review cycle to the changed code plus the still-open findings, and a finding dismissed as irrelevant is not raised again unless the code it cited changed.
**Supports:** [SPEC](SPEC.md) O6 and the optimization evidence rules (P1: opt-in through a versioned review-policy value, today's default kept). Not a 1.0 gate. Owner, 2026-11-07: "sure".
**Done when:** An opt-in `review-and-prep-policy/v1` value scopes a later cycle to the delta plus the open findings from Track 77C's records, and its interaction with the cycle cap, repair-only continuation and the opt-in `in-cap=delta` is documented; a dismissed finding is suppressed only while its key and cited code are unchanged, with a regression test proving a changed defect is raised again; the plan decides whether each finding's Confirmed or Investigate label is worth adopting; the default, every gate and the stop conditions are unchanged; the delta-default decision stays with its Future entry.
_touches: skills/review-and-prep.md, tests/skill-protocols-review-and-prep.test.ts, docs/workflow-handoffs.md_
_blocked-by: Track 77C_
**Scheduling:** Technical edge on Track 77C: it reads the cross-cycle key and state. Making delta-scoped review the default stays in Future ("Decide whether delta-scoped review becomes the wrapper default"), which waits on paired evidence; suppression may need the same evidence before any default.
_Source: owner-approved card (2026-11-07), split under the card-size rule (records first, then scoping and suppression)._
- **Scope a later cycle to the delta plus open findings** -- The policy value, its scope rules and its interaction with the cycle cap and continuations. _~110 lines incl. tests._ (M)
- **Suppress dismissed findings with a regression guard** -- Suppress only while key and cited code are unchanged; a changed defect is raised again. _~110 lines incl. tests._ (M)

### Execution Map

A Group may launch when every Group in its dependency set has landed;
document order is not an additional gate. The cards label priority choices
separately from technical prerequisites. Adjacency below is the packer's
DEPENDS output with bin numbers replaced by the assigned Group numbers.

```
- Group 72 ← {}
- Group 73 ← {72}
- Group 74 ← {73}
- Group 75 ← {74}
- Group 76 ← {72, 73, 74, 75}
- Group 77 ← {72, 75, 76}
- Group 78 ← {77}
- Group 79 ← {77, 78}
```

**8 Groups / 18 Tracks remaining**, all in the Current Plan.

Only owner-confirmed acceptance in PROGRESS can satisfy a stage/checkpoint.


## Future

Deferred: docs/roadmap-future.md (84 items)

## Shipped

History: docs/roadmap-shipped.md
