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
shipped history). The in-flight retirement of `/autoplan-lean` runs first. The
plan then builds the published contract and the pair-review change side by
side, moves the skills and telemetry onto the contract's signals, makes hand use
visible in telemetry, qualifies install/upgrade and the two-driver workflow on
that final behavior, and ends with the O6 measurement and decisions, whose rows
come from those real runs.

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

**Labels.** This regeneration recorded Tracks 69A to 69D, retired Group 69 and
relabelled the remaining work from Group 70 in packer order; the renames are in
its commit message. Shipped numbers through 69 are reserved by tombstones; 64
was never a roadmap Group.

Target: [SPEC](SPEC.md) O1–O6, 1.0.0 as the owner's own real use by hand and
through an orchestrator; audience ceiling potentially-public. No workspace host
or orchestrator is required; support claims name only exercised combinations.
Implementation, installed/operator evidence and owner acceptance remain
distinct. No new spend or unattended merge is authorized.

## In Progress

Track 70A (retire `/autoplan-lean`) was declared in flight to this regeneration
on 2026-11-07 by its launching caller, on another branch; no PR was open at its
base. The packer put four unstarted Tracks in the same bin, so Group 70 sits
here with them. Every shipped Track is recorded independently in shipped
history; the latest are 69A to 69D (v0.69.0 to v0.71.0). O1 and O3–O6 remain
pending; O2 was accepted on 2026-10-23.

### Group 70: Retire /autoplan-lean ∥ contract, pair-review narrowing, docs-only selection and the Codex sandbox

_Depends on: none_

**This group delivers:** The retired `/autoplan-lean`, the published orchestration contract, agent verification ahead of human testing, policy-backed docs-only test selection and a suite that passes inside Codex's sandbox.

##### Track 70A: Retire /autoplan-lean
_1 tasks . ~260 LOC incl. tests . medium risk_
**Outcome:** gstack-extend stops shipping `/autoplan-lean`; `/plan-track` plans small cards and upstream `/autoplan` keeps full planning. An existing install loses the skill cleanly on upgrade, and no live text points at it.
**Supports:** [SPEC](SPEC.md) O6 and the P1 evidence rules (the skill is no longer used, and its upstream review dependencies are being retired); owner decision, 2026-11-07 ("yes, kill autoplan-lean").
**Done when:** `setup` installs no `/autoplan-lean` on any host and an upgrade removes the installed copy and launcher under the install-safety rules (a test proves both, including that a user-owned file at that path is left and reported); no live skill, doc, template or helper names it as an option, default or route, while shipped history stays unchanged; `/plan-track` no longer says `/autoplan-lean` stays the default; the expected-skill list, `SKILLS=( … )` and every protocol cohort match exactly; no code another shipped skill imports is removed.
_touches: skills/autoplan-lean.md, bin/autoplan-lean, src/autoplan-lean/, setup, tests/autoplan-lean.test.ts, tests/autoplan-lean-history.test.ts, tests/helpers/expected-setup-skills.ts, tests/helpers/touchfiles.ts, tests/helpers/extend-root.ts, tests/skill-protocols.test.ts, tests/skill-protocols-plan-track.test.ts, tests/handoff-contract.test.ts, tests/outside-review.test.ts, tests/upstream-check.test.ts, src/upstream-check/cli.ts, skills/plan-track.md, skills/implement.md, scripts/init-templates/CLAUDE.md.tmpl, CLAUDE.md, README.md, docs/installation.md, docs/workflow-handoffs.md, docs/telemetry.md, docs/outside-review.md, docs/upstream-check.md, bin/lib/telemetry-doctor.py, .gstack/pregate.json_
**Scheduling:** In flight on another branch when this roadmap was regenerated (2026-11-07); declared by its launching caller, not detected. The release files (CHANGELOG, VERSION, package files) are written at the release step, not by the implementation. Its 71A-dependent Future work was left for this regeneration, which killed Track 71A and the Future entry "Quote arbitrary lean budget reasons as data".
- **Remove the skill and every live reference** -- Remove the skill, its launcher and `src/autoplan-lean/`, drop it from `setup`'s `SKILLS=( … )`, the expected-skill list and every protocol cohort, make upgrade remove installed copies under the install-safety rules, and reword live text that names it; keep shipped history and any shared code another skill imports. _~260 lines._ (M)

##### Track 70B: Use pregate to select docs-only tests and explain long runs
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

##### Track 70C: Publish the orchestration contract
_2 tasks . ~220 LOC . medium risk_
**Outcome:** A person writing an orchestrator, or configuring a workspace host, can read what they must provide and what each stage promises, without reading skill prose.
**Supports:** [SPEC](SPEC.md) O4.1 (owner, 2026-11-07: host-agnostic, "publish good documentation about how an orchestrator can use our skill flow successfully").
**Done when:** A versioned contract names what a host or orchestrator must provide (a worktree-ownership signal, a state root, a run-mode signal for every stage it launches, interactive or not, resume semantics and approval semantics) and, for each stage, what it promises (stage identity, status/hold, plan and repository/PR identity, checked revision, artifact references, next action), linking the existing handoff grammar instead of copying it; every requirement names its current provider in the code or is marked not yet honored, with the Track that closes it; existing `Run /review-and-prep` and `review-and-prep/v1` consumers stay valid; no orchestrator is named as required and no unexercised combination is claimed.
_touches: docs/orchestration-contract.md (new)_
**Scheduling:** First of the host-neutral chain: the skill-guard and telemetry Tracks implement the signals it names. It writes one new document and links it from nothing else, so it can run beside the in-flight work; the catalog Track adds the README and installation links.
_read-first: docs/workflow-handoffs.md, docs/telemetry.md_
- **State what a host or orchestrator provides** -- Worktree-ownership signal, state root (`GSTACK_STATE_ROOT` and its fallbacks), resume and approval semantics, and the run-mode signal an orchestrator sets for every stage it launches, interactive workers included, each traced to the code that reads it today. _~120 lines._ (M)
- **State what each stage promises** -- One row per stage linking its handoff grammar, holds and next action, plus the compatibility and versioning rules. _~100 lines._ (M)

##### Track 70D: Verify agent-checkable items before human testing
_2 tasks . ~240 LOC incl. tests . medium risk_
**Outcome:** `/review-and-prep` sends a person only the checks that need human judgment or access; everything an agent can check is verified first with the installed upstream QA skill that fits the project, with recorded evidence.
**Supports:** [SPEC](SPEC.md) O3 (manual-testing pause/resume stays human testing, not autonomous QA); owner, 2026-11-07: "there are just items that should never go to pair review because they can be qa'd without the user in the review process".
**Done when:** "Identify required user testing" counts only judgment or access (look and feel, a physical device, credentials only the human holds, a decision), no longer "exercising a flow in the app"; items an agent can check run before any pause through the installed QA skill that fits (the plan checks what is installed and each skill's contract, for example `/qa-only` or `/browse` for a web app, `/qa`'s CLI/API modes, `/ios-qa` for an iOS app), and their evidence is recorded in the completion matrix; an app the agent cannot drive falls back to the human with the reason recorded, never by default; destructive actions against shared environments stay with the human; a failed agent check is never re-marked passed; protocol tests lock each rule.
_touches: skills/review-and-prep.md, tests/skill-protocols-review-and-prep.test.ts_
**Scheduling:** The owner approved this design on 2026-11-07 ("pair-review design: yes"); it is the first of two Tracks under the card-size rule, and the `/pair-review` Track consumes its narrowed definition.
- **Narrow required user testing to judgment or access** -- Rewrite the definition and its pause trigger; keep `manual testing pending` semantics, the passed-status invariant and the H-C pause handoff unchanged. _~90 lines._ (M)
- **Run agent-checkable items through the fitting QA skill first** -- Select the installed upstream QA skill by project type, record its evidence in the matrix, fall back to the human only when the agent cannot drive the app, and never let the agent re-mark its own failed check. _~150 lines incl. tests._ (M)

##### Track 70E: Make the suite pass inside Codex's workspace-write sandbox
_1 tasks . ~120 LOC incl. tests . low risk_
**Outcome:** The tests pass the same on the host and inside a Codex worker's workspace-write sandbox, so a Codex implementer's or reviewer's targeted checks never fail on the test environment.
**Supports:** [SPEC](SPEC.md) O3 (a supported driver's checks must not fail on its own sandbox); owner direction, 2026-11-07: "let's do everything under our control though to resolve this" (no upstream report).
**Done when:** `tests/layout-scaffold.test.ts` passes on the host and inside `codex sandbox -c sandbox_mode=workspace-write`, with and without `TMPDIR` set to a private directory and with `/tmp` excluded from the sandbox's writable roots; a plain root with a real `.git` ancestor is still refused, and a test proves it; no assertion is weakened, no retry is added and `src/layout-scaffold/` behavior is unchanged unless the plan names why; the handoff records the sweep: each other test file with the same pattern and whether it now passes under the sandbox.
_touches: tests/layout-scaffold.test.ts, tests/helpers/fixture-repo.ts_
_blocked-by: Track 69C_
**Scheduling:** Facts probed on 2026-11-07 with codex-cli 0.167.0: in workspace-write mode Codex bind-mounts a read-only `.git` at every writable root (the workspace, `/tmp`, `$TMPDIR`), creating an empty mount point where none exists, present inside the sandbox for the whole command. At v0.70.0, `codex sandbox -c sandbox_mode=workspace-write -- bun test tests/layout-scaffold.test.ts` printed "0 pass, 1 fail, 1 error", because the suite places its roots under `$XDG_RUNTIME_DIR`, which the sandbox cannot write; on the host the file passes 183/183. A caller-side change giving Codex workers a private `TMPDIR` still leaves an empty `.git` at that `TMPDIR` inside the sandbox. `tests/helpers/fixture-repo.ts` is a global touchfile, so its edit runs the whole suite.
_read-first: tests/layout-scaffold.test.ts, src/layout-scaffold/root.ts_
- **Pass inside and outside the sandbox** -- Choose the suite's private temp parent from a location the running process can actually write (probe rather than assume `XDG_RUNTIME_DIR`) and make the expectations hold when an empty read-only `.git` sits at that location's writable root; keep the product refusal, every assertion and no retry; a test-only boundary needs the plan to show why no other route works. Then sweep the other test files for the same pattern (plain temp roots plus an upward `.git` lookup or `git` probe) and fix any that fail under the sandbox the same way. _~120 lines._ (M)

## Current Plan

_tombstone: 17, 19, 20, 22, 23, 24, 25, 26, 28, 29, 30, 31, 32, 33, 47, 48, 49, 50, 51, 52, 57, 58, 64, 65, 66, 67, 68, 69_

### Group 71: Contract host attribution ∥ install/upgrade qualification ∥ release-note labels

_Depends on: Group 70_

**This group delivers:** Host attribution through the contract in telemetry, the owner's install/upgrade/recovery evidence including the published three-part upgrade, and labelled release-note disclosures in plans and review handoffs.

##### Track 71A: Attribute workspace hosts through the contract in telemetry
_3 tasks . ~260 LOC incl. tests . medium risk_
**Outcome:** Provenance rows record the workspace host from the contract's signal, Conductor-only reading code is gone, and every existing row stays readable.
**Supports:** [SPEC](SPEC.md) O4.2 and O4.4 (host evidence distinguishable, public provenance schemas readable); owner, 2026-11-07 (host-specific markers replaced by the generic contract).
**Done when:** `bin/lib/telemetry.py` takes host attribution from the contract's signal instead of the `PASEO_AGENT_ID`/`CONDUCTOR_SESSION_ID` pair, and its Conductor Cursor-store reader and `conductor` route are removed; the schema and `docs/telemetry.md` keep accepting old rows' `conductor` route and `workspace_host` values; the four recorded report test gaps from Track 69D's review have tests; the release notes disclose the incompatible change under the 0.x policy.
_touches: bin/lib/telemetry.py, tests/telemetry.test.ts, tests/telemetry-contract.test.ts, docs/telemetry.md, docs/stage-runs.schema.json_
_blocked-by: Track 70C, Track 70A_
**Scheduling:** Technical edge on Track 70C (the contract names the host-attribution signal); the edge on Track 70A orders edits to `docs/telemetry.md`. The quota ledger's Conductor store reader stays in Future: quota is experimental and not a host guard or marker.
_read-first: docs/orchestration-contract.md, docs/telemetry.md_
- **Attribute the host from the contract and drop the Conductor reader** -- Replace the marker pair, remove the Conductor store reader and route, keep old rows valid. _~170 lines incl. tests._ (M)
- **Keep the schema and documentation readable for old rows** -- Document the change, keep historical enum values, and disclose it. _~40 lines._ (S)
- **Cover the recorded report test gaps** -- Structured transcript resume forms, signal-reader exception isolation, missing installed-skill metadata and report filesystem error diagnostics (`[review:files=bin/lib/telemetry.py]`, recorded 2026-11-07). _~50 lines._ (S)

##### Track 71B: Qualify install, upgrade and recovery on the owner's machines
_2 tasks . ~160 LOC . medium risk_
**Outcome:** The owner can install, onboard, upgrade and recover a working skill set on a fresh machine from the published instructions, with evidence of what was actually installed.
**Supports:** [SPEC](SPEC.md) O1 (all three criteria) and O5.2; the preserved published three-part upgrade obligation from Track 28A planning (2026-10-23), whose trigger was met by v0.48.0.
**Done when:** A dated record names the OS, host, harnesses and versions of a fresh install and project onboarding on the owner's machine, actionable failures for a missing prerequisite, an upgrade with user-owned files preserved and stale copies reported, a working recovery path, and a real legacy four-part install upgraded through the default remote with offered and installed commit/tag identity, reader compatibility and unchanged user state; it records the actual installed commit and discloses that upgrade offers follow main rather than a release identity; failures stay open; the owner confirms before O1 counts.
_touches: docs/acceptance/install-upgrade.md (new)_
_blocked-by: Track 70A, Track 28A_
**Scheduling:** Technical edge on Track 70A: the qualified upgrade must include removing the retired skill. Candidate or file-remote proof does not satisfy the published-upgrade obligation.
_read-first: docs/installation.md, docs/acceptance/release-compatibility.md_
- **Fresh install, onboarding, upgrade and recovery** -- Run them on the owner's machine from the published instructions and record each step, intervention and result. _~90 lines._ (M)
- **Published three-part upgrade from a legacy install** -- Upgrade a real four-part install through the default remote and record offered and installed identity, reader compatibility, recovery and unchanged state beside `docs/acceptance/release-compatibility.md`. _~70 lines._ (M)

##### Track 71C: Carry release-note disclosures from the plan through the review handoff
_3 tasks . ~180 LOC incl. tests . low risk_
**Outcome:** An orchestrator's release step can read labelled release-note and upgrade-risk disclosures from the plan and the review handoff instead of inferring them from prose.
**Supports:** [SPEC](SPEC.md) O4.1 (what each stage promises) and O5.1 (disclosed upgrade risk); owner, 2026-11-07 ("sure if necessary"). Today no stored plan carries such labels and almost no review handoff does.
**Done when:** `/plan-track` writes an optional labelled block of `Release note:` and `Upgrade risk:` lines only when a change needs a disclosure, never reusing Risks bullets; `/review-and-prep`'s handoff carries `User-facing change:` lines kept out of the `Run /ship-and-land` and `stage-handoff/v1` lines; `docs/workflow-handoffs.md` documents both with the grammar a consumer reads (label singular or plural, optionally bold, inline or as a bullet block, outside code fences); protocol tests lock both; existing handoff consumers are unaffected.
_touches: skills/plan-track.md, skills/review-and-prep.md, docs/workflow-handoffs.md, tests/skill-protocols-plan-track.test.ts, tests/skill-protocols-review-and-prep.test.ts, tests/handoff-contract.test.ts_
_blocked-by: Track 70A, Track 70D_
**Scheduling:** The edges are priority choices ordering edits to the same skill, handoff and test files behind the in-flight retirement and the narrowed user-testing Track. On 2026-11-07 a search of `skills/`, `src/`, `bin/`, `docs/workflow-handoffs.md` and `docs/roadmap-shipped.md` found none of the three labels, so the grammar clashes with nothing.
- **Optional disclosure block in /plan-track** -- `Release note:` / `Upgrade risk:` lines, written only when needed. _~40 lines incl. tests._ (S)
- **`User-facing change:` lines in the review handoff** -- Emit them beside, never inside, the `Run /ship-and-land` and `stage-handoff/v1` lines. _~70 lines incl. tests._ (M)
- **Document and lock the label grammar** -- Add the grammar to the handoff contract with fixtures. _~70 lines incl. tests._ (S)

### Group 72: Hand use in telemetry ∥ human-judgment pair-review

_Depends on: Group 70, Group 71_

**This group delivers:** Telemetry that records the owner's hand use correctly across machines, and a `/pair-review` that carries only human-judgment items.

##### Track 72A: Record hand use accurately across the owner's machines
_3 tasks . ~260 LOC incl. tests . medium risk_
**Outcome:** The owner can see in telemetry how often they run each stage by hand, on every machine they use, and an orchestrated run is never counted as hand use.
**Supports:** [SPEC](SPEC.md) O6.1 and O3.3 (the by-hand driver's evidence); owner, 2026-11-07: "we need to make sure telemetry captures my use by hand, because I use it by hand often enough but you don't seem to be aware of it".
**Done when:** A stage the owner runs by hand is recorded `user-directed` in each harness the owner uses by hand, or `unknown` with the reason where no signal can show it, never a guess; a stage an orchestrator launches, interactive or not, is never recorded `user-directed` when it carries the orchestration contract's run-mode signal, and an interactive session in a host-managed workspace without that signal is not assumed to be hand use; `gstack-extend-telemetry report` can read per-host files synced from the owner's other machines (no hosted service) and shows hand use per machine; a dated record holds real by-hand runs on each of the owner's machines read back as `user-directed`, and an orchestrated interactive run read back as `orchestrated`; until that record exists, nothing claims hand use is captured.
_touches: bin/lib/telemetry.py, tests/telemetry.test.ts, tests/telemetry-contract.test.ts, docs/telemetry.md, docs/acceptance/hand-use-telemetry.md (new)_
_blocked-by: Track 70C, Track 71A_
**Scheduling:** Technical edge on Track 70C (the contract names the run-mode signal an orchestrator sets for every stage it launches). The edge on Track 71A orders edits to the same telemetry files. Facts at 0.71.0 (`bin/lib/telemetry.py` `run_mode()`, checked 2026-11-07): with no `GSTACK_SESSION_KIND`, work item or `GSTACK_EXTEND_RUN_MODE`, a Claude session whose entrypoint is `cli` or `Paseo` reads `user-directed`, so an orchestrator-launched interactive worker that sets none of them is counted as hand use (this machine's report showed exactly that for two `project-spec` runs on 2026-11-07); Codex and Cursor sessions always read `unknown`; rows are written per host under each machine's own state directory; and only gstack-extend's own skills write rows, so hand use of upstream gstack skills is not counted (out of scope here). Setting the signal inside an orchestrator is that consumer's work, not this repository's.
_read-first: docs/telemetry.md, docs/orchestration-contract.md_
- **Classify interactive orchestrated runs and hand runs correctly** -- Read the contract's run-mode signal for interactive workers, stop inferring hand use from a host entrypoint alone, and cover the harnesses the owner uses by hand, with `unknown` plus a reason where no signal decides. _~140 lines incl. tests._ (M)
- **Report hand use across the owner's machines** -- Let the report read synced per-host files from more than one state directory and show runs per machine and mode, keeping today's single-machine output. _~90 lines incl. tests._ (M)
- **Record real by-hand and orchestrated runs** -- Run stages by hand on each of the owner's machines and one orchestrated interactive stage, read them back through the report and record the result. _~30 lines._ (S)

##### Track 72B: Keep /pair-review to human-judgment items
_3 tasks . ~260 LOC incl. tests, plus deletions . medium risk_
**Outcome:** A person running `/pair-review` sees only items that need their judgment or access, with state prepared and evidence attached by the agent, and is asked to retest only after the agent has reproduced and re-verified a fix.
**Supports:** [SPEC](SPEC.md) O3 manual-testing pause/resume; owner, 2026-11-07 ("pair-review design: yes … it isn't supposed to be [autonomous QA]").
**Done when:** The test list carries only human-judgment items, each with agent-prepared state and attached evidence; after a fix the agent reproduces and re-verifies before any human retest and keeps the failed result on record; the Covers/bundle and coverage-editing machinery that exists only for inspection checks (cookies, logs, DB rows, network calls) is removed, so `skills/pair-review.md` shrinks; the handoff `Results:` line stays readable by `/review-and-prep resume` and published H-C consumers (a compatible form or an explicit migration); it stays a human-testing skill.
_touches: skills/pair-review.md, tests/skill-protocols-pair-review.test.ts, docs/workflow-handoffs.md, tests/handoff-contract.test.ts_
_blocked-by: Track 70D, Track 70A, Track 71C_
**Scheduling:** Technical edge on Track 70D: it consumes the narrowed definition of required user testing. The edges on Tracks 70A and 71C are priority choices ordering edits to the handoff contract and its test. Kept at three tasks; the deletion is cheap.
_read-first: skills/review-and-prep.md_
- **Remove the inspection-only coverage machinery** -- Delete `Covers:` inference, its validation, the coverage-graph review, bundle confirmation and their counters. _~300 lines (del)._ (S)
- **Carry only human-judgment items with prepared state and evidence** -- Generate the list from the narrowed definition, have the agent prepare state and attach its evidence per item, and keep the H-C `Results:` line compatible (`(0 by coverage)` or a documented migration). _~150 lines._ (M)
- **Re-verify fixes before any human retest** -- After a fix the agent reproduces the failure and re-verifies; a human retests only a verified fix, and a failed check is never re-marked passed. _~110 lines incl. tests._ (M)

### Group 73: Contract workspace signal in the skills ∥ review evidence and recovery

_Depends on: Group 70, Group 72_

**This group delivers:** Stage skills that read the contract's workspace signal with the Conductor code removed, and a documented review-evidence and capped-review recovery path.

##### Track 73A: Specify portable review evidence and capped-review recovery
_2 tasks . ~220 LOC incl. tests . medium risk_
**Outcome:** Callers know what proves a completed full review and how a stopped draft can reach shipping.
**Supports:** [SPEC](SPEC.md) O3.2 stop preservation and O4.3–O4.4 provenance (efficiency program E10–E11); confirmed by the owner, 2026-11-07 ("72d confirmed as well").
**Done when:** A supporting design maps review facts to a portable evidence-bundle reference and independently checks review-log full-scope/completion/convergence/binding predicates. Documentation walks stopped draft → authorized exact repair-only continuation → prepared readiness → ship with all unavailable evidence and continuation counts preserved, including a stop after a first cycle that reproduced defects; it cites the already recorded rule that `/ship-and-land` keeps refusing a stopped draft, including one whose receipt says `Unresolved: none recorded` (`B-STOPPED-NONE-RECORDED`). No envelope runtime or stop bypass is introduced.
_touches: docs/designs/review-evidence-envelope.md (new), docs/workflow-handoffs.md_
_blocked-by: Track 29A, Track 30A, Track 32A, Track 72B_
**Scheduling:** The capped-review repair and baseline-repair edges are technical: the documented recovery path must describe the shipped repair-only continuation. The edge on Track 72B is a priority choice ordering edits to `docs/workflow-handoffs.md` behind the pair-review and in-flight Tracks. This Track specifies and checks the cycle 1 baseline record and does not write it.
_Source: program E10–E11 / research R11 and observed capped-review stops_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Map the existing upstream proof** -- Compare commit_full/tree/scope/completed/converged/cycles plus review_binding and verified/imported lane semantics; specify missing/stale/unavailable cases and identify gaps without claiming nonconverged full scope is a completed baseline. _~150 lines._ (M)
- **Document the recovery path** -- Use the stop receipt's own repair-only prompt and remaining budget, preserve the bound PR, and show why shipping cannot replace the continuation, including for a receipt that says `Unresolved: none recorded`. Keep manual holds and Full-review evidence: unavailable explicit. _~70 lines._ (S)

##### Track 73B: Honor the contract's workspace signal in the skills
_3 tasks . ~220 LOC incl. tests . medium risk_
**Outcome:** Every stage leaves branch and worktree lifecycle to whatever host or orchestrator marks the workspace as its own, without detecting Paseo or Conductor by name.
**Supports:** [SPEC](SPEC.md) O4.2 and O3.2 (host ownership of branches and worktrees); owner, 2026-11-07, approving that the Future entry "Remove Conductor support from the code" become a 1.0 Track.
**Done when:** The host-managed-workspace guards in `/implement`, `/review-and-prep` and `/ship-and-land` read the contract's worktree-ownership signal, with Paseo documented as one provider if the contract keeps it; the `SHARED:conductor-visibility-head` block, its `CONDUCTOR_SKILLS` cohort and the Conductor `.context/` storage fallbacks are gone from `/full-review`, `/pair-review` and `/roadmap`, which store under the state root, then `~/scratch/`; protocol tests lock the new guards and the removal; the release notes disclose the incompatible change under the 0.x policy.
_touches: skills/implement.md, skills/review-and-prep.md, skills/ship-and-land.md, skills/full-review.md, skills/pair-review.md, skills/roadmap.md, tests/skill-protocols.test.ts, tests/skill-protocols-implement.test.ts, tests/skill-protocols-review-and-prep.test.ts, tests/skill-protocols-ship-and-land.test.ts, tests/skill-protocols-roadmap.test.ts, tests/skill-protocols-plan-track.test.ts, tests/helpers/parse-setup-skills.ts_
_blocked-by: Track 70C, Track 72B, Track 70A_
**Scheduling:** Technical edge on Track 70C (it implements the contract's signal). The edges on Tracks 72B and 70A are priority choices that order same-file edits: the pair-review Tracks and the in-flight retirement edit the same skill and protocol files.
_read-first: docs/orchestration-contract.md_
- **Read the contract's signal in the workspace guards** -- Replace the Paseo- and Conductor-named guards in the three stage skills. _~90 lines._ (M)
- **Remove the Conductor visibility block and `.context/` fallbacks** -- Remove the shared block, its cohort and the fallbacks, keeping each cohort's other members exact. _~110 lines incl. tests._ (M)
- **Lock the CLAUDE.md never-shared sentence** -- Add the missing drift lock for `/roadmap`'s sentence that `CLAUDE.md` is never shared and only one Track per Group may declare it, with a negative case. _~20 lines._ (S)

### Group 74: Compatibility catalog ∥ two-driver workflow qualification

_Depends on: Group 70, Group 71, Group 72, Group 73_

**This group delivers:** The stable compatibility and recovery catalog, and real by-hand and orchestrated workflow evidence.

##### Track 74A: Publish the stable compatibility and recovery catalog
_1 tasks . ~180 LOC incl. tests . medium risk_
**Outcome:** The owner and an orchestrator can identify stable interfaces, experimental exclusions and recovery obligations before relying on them.
**Supports:** [SPEC](SPEC.md) O5.1; preserved required inbox obligation, 2026-10-23; confirmed by the owner, 2026-11-07.
**Done when:** A catalog names every promised surface (including the orchestration contract), version/compatibility rules, support conditions and recovery links; stage-runs v2 is one checked example, not the whole catalog. Experimental surfaces stay explicitly excluded; no checkpoint is awarded by documentation alone.
_touches: docs/compatibility.md (new), docs/SPEC.md, README.md, docs/installation.md_
_blocked-by: Track 28A, Track 70C, Track 73B, Track 71A_
**Scheduling:** The edges on the contract and host-signal Tracks keep the catalog from freezing host-specific behavior as stable.
_Source: [plan-ceo-review] stable compatibility surfaces (O5.1)_
_read-first: docs/orchestration-contract.md_
- **Catalog the promised surfaces** -- Trace CLI/config, skills, the orchestration contract, handoffs, provenance and install ownership against shipped code and public instructions. Carry the existing stable promises and disclose unknown qualification; retain O5 acceptance as an owner gate. _~180 lines._ (M)

##### Track 74B: Qualify the workflow with two real drivers
_2 tasks . ~240 LOC . medium risk_
**Outcome:** The owner can carry real work through every stage both by hand and through a real external orchestrator, and the evidence shows what the documented contract actually supports.
**Supports:** [SPEC](SPEC.md) O3.3 and O4.5 (reshaped from the Paseo host Track by the owner, 2026-11-07: "72c ok").
**Done when:** A dated record names host, harness and versions for real runs by both drivers (the owner by hand, and one real external orchestrator), each run read back in telemetry with the correct run mode, covering, between them, a complete plan-to-authorized-release workflow, interrupted resume, manual-testing pause/resume, `/full-review` finish/restart, an explicit negative hold, an external-consumer handoff consumed from artifacts, a cross-session handoff and stale/partial/held handoffs; it counts operator interventions and keeps pending approvals or failures as holds; it includes the installed `/docs-ship` acceptance below; no unexercised combination is claimed.
_touches: docs/acceptance/workflow-drivers.md (new)_
_blocked-by: Track 70A, Track 70B, Track 70E, Track 72B, Track 73B, Track 71A, Track 72A, Track 26A, Track 23I, Track 23A, Track 26B, Track 65A, Track 66A, Track 66B_
**Scheduling:** Runs on the final behavior of the stages it qualifies, so it follows every Track that changes them. The external orchestrator may stop at a ready PR; a separate authorized run by hand proves landing. No consumer-repo edits, new spend, unattended release or acceptance-by-idle-status. The independently followed onboarding attempt moved to the public-release stage (Future).
- **Exercise both drivers** -- Use real host-managed workspaces and approved accounts with the harnesses the owner uses for each stage; retain the bound PR and workspace, test stale/partial/held handoffs, confirm next-stage consumption from artifacts across sessions, include the host-attribution check deferred from Track 26A, and count operator interventions. _~200 documentation lines._ (L)
- **Include installed `/docs-ship` acceptance** -- Run a real docs-only PR through classification, a no-write classification hand-back, selected tests once, same-tree test-record reuse, final receipt hash, policy bump and `docs-ship/v1` without merging; include one Sonnet-class run and one `/roadmap` handoff, and compare work/wait wall time with a recent docs PR shipped through the ordinary path. _~40 lines._ (S)

### Group 75: Measured stage cost and optimization decisions

_Depends on: Group 73, Group 74_

**This group delivers:** Expected cost per stage and an adopt, reject or insufficient-evidence decision for every candidate optimization.

##### Track 75A: Measure each stage's cost and decide each optimization
_3 tasks . ~460 LOC incl. tests . medium risk_
**Outcome:** The owner can reproduce an offline report of each stage's measured cost (model work, tool/CI/human waits, reuse and rework), read a documented expected cost per stage, and see an adopt, reject or insufficient-evidence decision for every candidate optimization.
**Supports:** [SPEC](SPEC.md) O6.1–O6.3 (owner, 2026-11-07: P1 joins the 1.0 outcomes with this finish line, and this Track gains the expected stage cost).
**Done when:** A reproducible offline report from sanitized projections separates DOCS/FULL/release-only paths, diff/task size, repo/host, run mode, skill version, waits and fresh versus resumed runs, and reports sample size and missingness; fixtures cover each split. A documented expected cost per stage (wall time and model usage, with sample size and unknowns) is published. Each efficiency-program candidate, including first-cycle overlap (69A), fold, delegation and the docs-only selection, has measured evidence or a named evidence gap and an adopt, reject or insufficient-evidence decision with its follow-up mapped to existing Future items. No review gate, model choice or default changes through the study itself.
_touches: scripts/workflow-efficiency-report.py (new), tests/workflow-efficiency-report.test.ts (new), tests/fixtures/workflow-efficiency/ (new), tests/helpers/touchfiles.ts, docs/acceptance/workflow-efficiency.md (new)_
_blocked-by: Track 67A, Track 52A, Track 74A, Track 73A, Track 74B_
**Scheduling:** Kept as one card above ~300 lines under the card-size rule's same-files exception (owner direction, 2026-10-26): the evaluation edits the same script, test and fixture files and reads the report the baseline builds. It follows the workflow qualification, whose real runs supply most of its rows.
_read-first: docs/telemetry.md, docs/quota-ledger.md, docs/designs/review-independence.md_
- **Build a comparable baseline and expected stage costs** -- Produce the offline report and the per-stage expected cost from it; reuse eligible release-only receipts and preserve the first-installed-no-CI timing obligation and 15-minute target; report time to push and merge gate separately from human approval. Observational differences are not causal model comparisons. _~200 lines._ (M)
- **Assess the uncertain efficiency choices** -- Compare smaller models and lower effort for bounded drafting/extraction versus the main runner, including launch/context-transfer and parent-correction costs; investigate repeated plan extraction, evidence reads, long-suite reruns, section loading, parallel scheduling and each reviewer voice's unique accepted findings. Define corpus, quality bars, fixed budgets and stop rules before any model trial; offline analysis only, and any paid trial needs a separately approved pilot and spend bound. _~180 lines._ (M)
- **Publish decisions and follow-up ownership** -- Adopt/reject/insufficient-evidence per candidate with expected benefit, observed limitations and the smallest follow-up, mapped to existing Future items; an insufficient-evidence result names missing data and a bounded next measurement and never silently removes a review or acceptance gate. _~80 lines._ (S)

### Execution Map

A Group may launch when every Group in its dependency set has landed;
document order is not an additional gate. The cards label priority choices
separately from technical prerequisites. Adjacency below is the packer's
DEPENDS output with bin numbers replaced by the assigned Group numbers.

```
- Group 70 ← {}
- Group 71 ← {70}
- Group 72 ← {70, 71}
- Group 73 ← {70, 72}
- Group 74 ← {70, 71, 72, 73}
- Group 75 ← {73, 74}
```

**6 Groups / 15 Tracks remaining.** Group 70 is In Progress; Groups 71 to 75
are in the Current Plan.

Only owner-confirmed acceptance in PROGRESS can satisfy a stage/checkpoint.


## Future

Deferred: docs/roadmap-future.md (86 items)

## Shipped

History: docs/roadmap-shipped.md
