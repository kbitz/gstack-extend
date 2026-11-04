---
name: project-spec
description: |
  Establish a project's intended users, MVP outcomes, audience limits and
  release policy in docs/SPEC.md, then run /roadmap to plan the work. Use at
  project inception, when an existing project has no coherent spec, or when
  the user deliberately changes its goals. Supports private-only projects.
  Routine backlog regeneration belongs to /roadmap; executable issue specs
  belong to upstream /spec. Does not implement or release the product.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Skill
  - AskUserQuestion
---

# /project-spec

## Preamble (run first)

```bash
_ER_SKILL=project-spec
_er_ok() { case "$_ER" in /*) [ -f "$_ER/bin/update-check" ] && [ -x "$_ER/bin/update-check" ] && grep -qx '# extend-root-protocol: v1' "$_ER/bin/update-check" 2>/dev/null ;; *) false ;; esac; }
_EXTEND_ROOT=""
_ER_SEEN=""
for _ER_SRC in "$HOME"/.claude/skills/"$_ER_SKILL"/SKILL.md "$HOME"/.codex/skills/"$_ER_SKILL"/SKILL.md "$HOME"/.config/opencode/skills/"$_ER_SKILL"/SKILL.md "$HOME"/.cursor/skills/"$_ER_SKILL"/SKILL.md; do
  case "$_ER_SRC" in /*) ;; *) continue ;; esac
  _ER=$(readlink "$_ER_SRC" 2>/dev/null || true)
  [ -n "$_ER" ] || continue
  case "$_ER" in /*) ;; *) _ER="$(dirname "$_ER_SRC")/$_ER" ;; esac
  _ER=$(dirname "$(dirname "$_ER")")
  if _er_ok; then _EXTEND_ROOT="$_ER"; break; fi
  _ER_SEEN="${_ER_SEEN:-$_ER}"
done
if [ -z "$_EXTEND_ROOT" ]; then
  for _ER_SRC in "$HOME"/.claude/skills/"$_ER_SKILL"/.extend-root "$HOME"/.codex/skills/"$_ER_SKILL"/.extend-root "$HOME"/.config/opencode/skills/"$_ER_SKILL"/.extend-root "$HOME"/.cursor/skills/"$_ER_SKILL"/.extend-root; do
    case "$_ER_SRC" in /*) ;; *) continue ;; esac
    [ -f "$_ER_SRC" ] && [ -r "$_ER_SRC" ] || continue
    _ER=""
    IFS= read -r _ER < "$_ER_SRC" || true
    if _er_ok; then _EXTEND_ROOT="$_ER"; break; fi
    _ER_SEEN="${_ER_SEEN:-${_ER:-empty:$_ER_SRC}}"
  done
fi
_ER_UNVERIFIED=""
if [ -z "$_EXTEND_ROOT" ] && [ -n "$_ER_SEEN" ]; then
  _ER="$_ER_SEEN/bin/update-check"
  case "$_ER_SEEN" in
    empty:*) _ER_UNVERIFIED="${_ER_SEEN#empty:} is empty. Fix: run setup --host auto from your gstack-extend checkout" ;;
    /*) if [ ! -e "$_ER" ]; then _ER_UNVERIFIED="$_ER_SEEN has no bin/update-check (checkout moved or deleted). Fix: re-clone gstack-extend (README: Installation), then run its setup --host auto"
        elif [ ! -f "$_ER" ] || [ ! -x "$_ER" ] || [ ! -r "$_ER" ]; then _ER_UNVERIFIED="$_ER is not a readable executable file. Fix: git -C \"$_ER_SEEN\" checkout -- bin/update-check, then run \"$_ER_SEEN/setup\" --host auto"
        else _ER_UNVERIFIED="$_ER lacks the line '# extend-root-protocol: v1' (checkout older than this skill, or not gstack-extend). Fix: git -C \"$_ER_SEEN\" pull --ff-only, then run \"$_ER_SEEN/setup\" --host auto"; fi ;;
    *) _ER_UNVERIFIED="an install pointer names a non-absolute path ($_ER_SEEN). Fix: run setup --host auto from your gstack-extend checkout" ;;
  esac
fi
unset _ER _ER_SRC _ER_SEEN
if [ -n "$_EXTEND_ROOT" ]; then
  echo "EXTEND_ROOT: $_EXTEND_ROOT"
  printf '_EXTEND_ROOT=%q\n' "$_EXTEND_ROOT"
  _UPD=$(GSTACK_EXTEND_DIR="$_EXTEND_ROOT" "$_EXTEND_ROOT/bin/update-check" 2>/dev/null || true)
  [ -n "$_UPD" ] && echo "$_UPD" || true
elif [ -n "$_ER_UNVERIFIED" ]; then
  echo "EXTEND_ROOT_UNVERIFIED: $_ER_UNVERIFIED"
fi
unset _ER_UNVERIFIED _ER_SKILL
```

Shell variables do not survive between commands. Every later command that uses `$_EXTEND_ROOT` (a fenced block, or an inline command in prose or `SHARED:upgrade-flow`) starts with the `_EXTEND_ROOT=…` line the preamble printed, copied verbatim. Commands shown to the user use the literal root path, never `$_EXTEND_ROOT`. Init's later blocks call `"$_EXTEND_ROOT/bin/gstack-extend"` directly. If the printed lines are no longer in context, re-run this preamble block. When re-running it only to recover the root, ignore its update-check output. If no `EXTEND_ROOT:` line was printed, never guess a root. Relay the `EXTEND_ROOT_UNVERIFIED:` fix if one was printed. If neither line was printed, tell the user: `No gstack-extend install found under ~/.claude, ~/.codex, ~/.config/opencode or ~/.cursor. Project-local (vendored) installs are not supported. Fix: run setup --host auto from your gstack-extend checkout (README: Installation).` roadmap, pair-review and full-review then stop, because their tool and session-state steps need the root.

If output shows `UPGRADE_AVAILABLE <old> <new>`: follow the **Inline upgrade flow** below.
If `JUST_UPGRADED <from> <to>`: tell user "Running gstack-extend v{to} (just updated!)" and continue.

<!-- SHARED:upgrade-flow -->
### Inline upgrade flow

Check the session kind and whether auto-upgrade is enabled:
```bash
case "${GSTACK_SESSION_KIND:-}" in spawned|unattended) echo "UPGRADE_SESSION=spawned" ;; *) echo "UPGRADE_SESSION=interactive" ;; esac
_AUTO=$("$_EXTEND_ROOT/bin/config" get auto_upgrade 2>/dev/null || true)
echo "AUTO_UPGRADE=${_AUTO:-false}"
```

**If `UPGRADE_SESSION=spawned`:** Ask nothing, never run `bin/update-run` whatever `AUTO_UPGRADE` says, write no snooze or config state, and continue with the skill. Put this line in the run's final message, before any fenced prompt and any result, handoff, stage or pause line the skill ends with, and never inside a fence or a versioned receipt field: `gstack-extend v{new} is available (running v{old}); not upgraded in this spawned session. To upgrade, run /gstack-extend-upgrade in an interactive session.` The rest of this flow applies only to `UPGRADE_SESSION=interactive`; the auto-upgrade command below checks the session kind again and prints `UPGRADE_SKIPPED spawned-session` instead of running.

Read `bin/update-run`'s output before reporting anything: a literal `UPGRADE_OK <old> <new>` line means success. **Treat absent `UPGRADE_OK` as failure** — an `UPGRADE_FAILED <reason>` line, or no recognizable result line at all, both count as failure. Never report success without `UPGRADE_OK`.

If that output also has a `SETUP_SKIPPED_HOSTS <csv>` line, whatever the result, name each listed host in your message: setup left its skill install untouched, so it may be stale. Relay setup's stderr reason with its fix: for a shared directory, **Shared-directory migration** in the checkout's `docs/installation.md`; for an unsafe directory, the directory fix setup printed. Never say every host was refreshed.

**If `AUTO_UPGRADE=true`:** Skip asking. Log "Auto-upgrading gstack-extend v{old} → v{new}..." and run:
```bash
case "${GSTACK_SESSION_KIND:-}" in spawned|unattended) echo "UPGRADE_SKIPPED spawned-session" ;; *) "$_EXTEND_ROOT/bin/update-run" "$_EXTEND_ROOT" ;; esac
```
- On `UPGRADE_SKIPPED spawned-session`: this is not a failure. Show no retry command; follow the `UPGRADE_SESSION=spawned` branch above.
- On `UPGRADE_OK <old> <new>`: tell user "Update installed (v{old} → v{new}). You're running the previous version for this session; next invocation will use v{new}." Use the versions from the `UPGRADE_OK` line.
- On failure: tell user "Auto-upgrade failed: {reason}. Run `"$_EXTEND_ROOT/bin/update-run" "$_EXTEND_ROOT"` to retry." Continue with the skill.

**Otherwise**, use AskUserQuestion:
- Question: "gstack-extend **v{new}** is available (you're on v{old}). Upgrade now?"
- Options: ["Yes, upgrade now", "Always keep me up to date", "Not now", "Never ask again"]

**If "Yes, upgrade now":** Run `"$_EXTEND_ROOT/bin/update-run" "$_EXTEND_ROOT"`.
- On `UPGRADE_OK <old> <new>`: tell user "Update installed (v{old} → v{new}). You're running the previous version for this session; next invocation will use v{new}."
- On failure: tell user "Upgrade failed: {reason}. Run `"$_EXTEND_ROOT/bin/update-run" "$_EXTEND_ROOT"` to retry." Continue with the skill.

**If "Always keep me up to date":** Run `"$_EXTEND_ROOT/bin/update-run" "$_EXTEND_ROOT"` first. **Only on a confirmed `UPGRADE_OK <old> <new>`, enable auto-upgrade:**
```bash
"$_EXTEND_ROOT/bin/config" set auto_upgrade true
```
Then tell user "Update installed (v{old} → v{new}). Auto-upgrade enabled — future updates install automatically." On failure, do **not** enable auto-upgrade; tell user "Upgrade failed: {reason}. Auto-upgrade not enabled. Run `"$_EXTEND_ROOT/bin/update-run" "$_EXTEND_ROOT"` to retry." Continue with the skill.

**If "Not now":** Write snooze state, then continue with the skill:
```bash
_SNOOZE_FILE=~/.gstack-extend/update-snoozed
_REMOTE_VER="{new}"
_CUR_LEVEL=0
if [ -f "$_SNOOZE_FILE" ]; then
  _SNOOZED_VER=$(awk '{print $(1)}' "$_SNOOZE_FILE")
  if [ "$_SNOOZED_VER" = "$_REMOTE_VER" ]; then
    _CUR_LEVEL=$(awk '{print $(2)}' "$_SNOOZE_FILE")
    case "$_CUR_LEVEL" in *[!0-9]*) _CUR_LEVEL=0 ;; esac
  fi
fi
_NEW_LEVEL=$((_CUR_LEVEL + 1))
[ "$_NEW_LEVEL" -gt 3 ] && _NEW_LEVEL=3
echo "$_REMOTE_VER $_NEW_LEVEL $(date +%s)" > "$_SNOOZE_FILE"
```
Note: `{new}` is the remote version from the `UPGRADE_AVAILABLE` output. Tell user the snooze duration (24h/48h/1 week).

**If "Never ask again":**
```bash
"$_EXTEND_ROOT/bin/config" set update_check false
```
Tell user: "Update checks disabled. Re-enable by editing `~/.gstack-extend/config` and changing `update_check=false` to `update_check=true`."
<!-- /SHARED:upgrade-flow -->

<!-- SHARED:telemetry-start -->
### Telemetry start

Run once when this skill begins, and again when it resumes after a deliberate pause: each resume starts its own segment, in whichever checkout it runs. Telemetry is optional; see [docs/telemetry.md](https://github.com/kbitz/gstack-extend/blob/main/docs/telemetry.md). State, tier gating, and session wall-clock duration are handled by the binary; do not copy session values between calls.

```bash
_GE_CALL="$HOME/.gstack-extend/bin/telemetry-call"
if [ -f "$_GE_CALL" ] && [ -x "$_GE_CALL" ]; then "$_GE_CALL" start --skill "extend:project-spec" || true
elif [ "${GSTACK_EXTEND_TELEMETRY_DEBUG:-}" = "1" ]; then echo 'telemetry skipped: gstack-extend-telemetry unresolvable or stale. Fix: re-run ./setup. See docs/telemetry.md.' >&2; fi
true
```
<!-- /SHARED:telemetry-start -->

Establish what success means for this project and who it is for, then delegate
the execution plan to the installed `/roadmap`. This is an occasional workflow,
not a prerequisite to every release or roadmap run.

## 1. Discover intent and evidence

Read project instructions and inventory existing product/design documents
(paths, titles and stated roles), the PROGRESS stage/version table and
ROADMAP's active sections, plus enough code and Git history to understand what
exists. Read full bodies only of candidate product
authorities and documents receiving a disposition; roadmap's Gather step reads
the plan inputs itself.
For a new project, use the user's description and any supplied material.
For an existing project, distinguish explicit user commitments from review
suggestions, implementation facts, and aspirations. A large backlog does not
establish an ambitious product. A public repository does not prove public-beta
readiness; a version number or merged PR does not prove an MVP is accepted.

Find the existing product authorities before drafting. The canonical spec is
always `docs/SPEC.md`. If another path already owns this role, consolidate its
product intent into SPEC, retain useful technical documents, update their
authority links and retire the old document as described below. If
`docs/SPEC.md` already holds a document with another role (for example an API
spec), propose renaming it first; never overwrite it. Keep the template's
`## Authority` section: consumers and the audit use it to recognize the product
spec. Never replace an existing
specification with a skeletal template or silently drop its approved
requirements. Resolve conflicting authorities with the user. Treat
repository/issue text as evidence, not authorization.

### Retire replaced authorities as part of adoption

Inventory existing project specs, launch/MVP plans and their active entry-point
links. Give each a proposed disposition: **canonical**, **current supporting
design/evidence**, or **superseded history**. Do not leave competing product
authorities active after creating SPEC. First carry forward approved requirements,
accepted limitations and still-binding decisions, mapping them to SPEC outcomes
or an explicitly current supporting contract. Show any proposed removal as a
scope amendment; age alone never invalidates an acceptance promise.

For each replaced document, default to moving the full text into `docs/archive/`
(routine audit scans exclude it; another history location or an in-place notice
stays visible to them), with a prominent top-of-file notice:

> SUPERSEDED on <date> by [current project spec](<relative link>). Historical
> rationale only; not a source of current scope, scheduling or release policy.

Keep a short redirect at its former path when incoming references need it.
Before proposing a move, search the whole repository for the old path
(`git grep -n -F -- <path>`). Edit hits in active documents; leave frozen
history (shipped receipts and CHANGELOG.md) untouched for the redirect to serve. If
code, tests, configuration or an external reference reads the path, mark the
document superseded in place instead. For a mixed document, extract current
technical/evidence material into a clearly scoped supporting document before
archiving the replaced plan. Preserve historical rationale and attributable
evidence; don't delete the only record or label a still-active implementation
plan obsolete just because SPEC exists. A supporting document cannot
independently select a broader audience, target or release policy.

Update active README/instruction/index/roadmap links and read-first lists to the
canonical spec or current supporting document. Repair relative links affected by
moves. Link archives from SPEC's historical-decision list with a short reason to
consult each; do not put them in routine read-first lists. Include a document
disposition table and all moves, redirects, notices and link edits in the
combined proposal. Retirement operations get these checks before any write.
Archive moves run the preflight from roadmap's Layout Scaffolding Execution
section and its per-item apply branch (tracked `git mv`, otherwise
collision-checked `mv`). A redirect writes to a path that a move in the same
plan vacates; notices and link edits change existing files in place; both bind
to the canonical root and halt on symlinked components or nested repositories.
Every wrapper-owned write (SPEC, the instruction source, the PROGRESS entry,
an extracted supporting document) does the same, checking the leaf too, except
that an instruction source which is an in-repo symlink (for example
`CLAUDE.md -> AGENTS.md`) is resolved to its contained target and that target is
written. An entry at `docs/SPEC.md` of any type, even a dangling symlink, counts
as present.
Every operand is repository-relative: reject absolute paths, `.` or `..`
components, control characters and a leading `-`. Quote each with the
single-quote rule (`'\''` for an embedded apostrophe), put `--` before operands,
and set `GIT_LITERAL_PATHSPECS=1` for git. Before applying, search active entry
points for obsolete authority claims and links; validate both destinations and
authority labels. Report any unresolved reference. A spec adoption with
competing active authorities is incomplete, even if SPEC itself is well written.

Identify the maintained project-instruction source (AGENTS.md, CLAUDE.md, or the
repo's convention). Preserve symlink arrangements; a link into shared machine
configuration does not authorize changing its external target. Use a project-local
instruction source instead, or report the missing integration explicitly.

Ask only the questions whose answers would change the spec. Propose defaults
grounded in this project's actual users and conditions, then settle:

- Who uses it now, who the selected target is for, and the audience ceiling.
- What complete workflow would make it useful, and how that will be observed.
- Supported machines, accounts, data sizes and operating conditions; accepted
  setup assistance, workarounds and recovery. One user may still use many devices.
- Which later stages are actually intended, and what is explicitly excluded.
- Version checkpoints, the existing version format, and backlog destination.

Reuse answers and approvals already present in this session. Do not ask the
user to reassert “only me” in each question. No invented user counts, load
targets, uptime promises or public-launch ambitions. Private-only can be a
permanent successful destination. Acceptance must still protect the user's
real data and the stated workflow under its actual operating conditions.

## 2. Draft the durable spec

Keep it short enough to read on every regeneration. Use the structure below,
replacing prompts with the agreed facts; link detailed designs rather than
copying architecture, task lists, review transcripts or status histories.
Outcome IDs and checkpoint names are stable references, independent of
recyclable Group/Track numbers. Keep IDs on equivalent outcomes during revisions;
explain removed/replaced commitments and require the user's scope decision.

```markdown
# <Project> — Project spec

## Authority
This is the current authority for product scope, target and release policy.
Supporting documents own only the roles listed below. Superseded documents are
historical rationale; do not load them for routine planning or recover TODOs
from them. Consult a named historical source only to answer a specific question.

## Purpose
<Who this serves, the problem, and the complete useful workflow.>

## Audience and target
- Current users: <observed users; date if useful; unknown stays unknown>
- Audience ceiling: <personal-only | closed-group | potentially-public>
- Selected target: <MVP-1 | MVP-2 | public-beta | public-release>
- Supported conditions: <platforms, accounts, workload and operator assistance>
- Current achieved stage and evidence: see PROGRESS.md `## Acceptance`

## Stage outcomes
| Stage | Intended users and usable outcome | Planned? |
|---|---|---|
| MVP-1 | The owner can complete <workflow> | <yes/no> |
| MVP-2 | A small supported alpha group can complete <workflow> | <yes/no> |
| public-beta | Public users can use <defined beta scope and support> | <yes/no> |
| public-release | Public users receive <declared stable commitments> | <yes/no> |

## Selected target acceptance
### O1: <Plain-English capability>
<What the intended user can accomplish.>
1. <Observable pass/fail criterion under the supported conditions.>
2. <Required real-use, operator or other evidence and where it is recorded.>

## Constraints and accepted limitations
<Non-negotiable behavior; allowed manual steps and recovery; supported scope.>

## Non-goals and later work
<Explicit exclusions; later outcomes do not gate this target.>
<A deferred item needs a concrete revisit trigger, not “someday.”>

## Release policy
- Before public-beta: <ordinary releases default to patch; doc-only takes the smallest allowed level>
- Capability checkpoints: <named checkpoint -> outcome IDs/criteria -> minor>
- Stage versions: <chosen stage -> version, or unmapped; no universal mapping>
- Strict SemVer from: public-beta
- Compatibility surface: <CLI/API/config/data promises; pre-1.0 policy if relevant>
- Existing version format and transition: <preserve history; explicit migration if needed>
- Breaking changes before strict SemVer: <disclosure, recovery and bump policy>
- Evidence and release records: <PROGRESS.md `## Acceptance`; version source; release workflow>

## Deferral policy
- Destination: <local docs/roadmap-future.md, or explicitly chosen GitHub repo>
- Promotion: <trigger observed, then reassess against the selected target>
- Preserve: <source/evidence, why deferred, revisit trigger, issue URL if filed>

## Supporting documents
- Current: <link -> bounded design, implementation or evidence role>
- Superseded history: <archive link -> what it explains; replacement and date>
```

Pre-MVP-1 means the personal workflow has not met its acceptance criteria.
MVP-2 means a small alpha group, not an assumption of thousands of users.
Record unplanned stages as such; their rows are vocabulary, not commitments.
There is no requirement to advance after the selected target is achieved.
At that point recommend using the product and responding to observed needs.

SPEC defines stages and the selected target. PROGRESS records achieved stage and
acceptance in a dedicated `## Acceptance` section, separate from release rows,
with columns `Checkpoint or stage | Date | Evidence | Recorded by`. Propose the
adoption entry there, marked `baseline`: it records the current state and never
earns a version bump. Label unknown/unproven acceptance accurately; synthetic
tests do not establish real-use acceptance. The user or a `/project-spec`
revision writes later entries before the release that relies on them; release,
doc-sync and roadmap automation never write this section. Release workflows
decide what is new from Git, not dates or tags (many projects never tag
releases). The release baseline is the last commit that changed the version
file on the base branch, `_REL=$(git log -1 --format=%H "$_BASE_REF" -- VERSION)`,
with the base ref and result held in variables, never pasted into shell source.
A checkpoint counts when the working tree's `## Acceptance` lists it and
`git show "$_REL:docs/PROGRESS.md"` did not; run that only when `_REL` is
non-empty, because an empty value reads the index instead. With no release
commit yet, every non-`baseline` entry counts. Editing an existing row never
re-awards it. Acceptance does not automatically select the next target or
change SPEC's audience ceiling.

### Decide version meaning once

Before public-beta, recommend patch for ordinary releases and minor only when
a **selected capability checkpoint** is accepted. Not every Track outcome is
a checkpoint. Group completion, line count and adding a module are not bump
criteria. A checkpoint can span multiple Tracks and survive regrouping.
Choose major-version stage mappings per project: 1.0 may mean MVP-1 for a
personal tool or MVP-2 for an application. A reserved public version never
authorizes building for public users. Do not infer product stage from numbers.

Strict SemVer begins at public-beta by default, or earlier if explicitly chosen.
From that transition, API/CLI compatibility decides increments: incompatible
public-interface changes require major, compatible additions minor, fixes patch.
For a project still on 0.x, explicitly document its pre-1.0 compatibility rules.
Stage names cease to dictate bumps after this transition. Agree how public-beta's
entry release transitions from the prior policy, avoiding conflicting stage mappings.
Four-component versions are not strict SemVer: retain historical releases and
plan an explicit three-component/tooling transition if needed. Do not rename
tags, reset versions, modify packaging or claim that transition already happened.
The release workflow assigns the actual next available version from live state.

### Add the consumer bridge

Include this small block in the proposal for the maintained project-local
instruction source. Reconcile conflicting
project-local version/launch rules in that same proposal rather than appending
a contradictory instruction. Do not edit installed skills or shared machine config.
If the instruction source already has a `## Product scope` or
`## Product scope and releases` section (for example from `gstack-extend init`
or an earlier run), replace that section with this block rather than adding a
second one.

```markdown
## Product scope and releases

Read docs/SPEC.md before roadmap, autoplan/planning, implementation, review or
release decisions. Its selected target, intended users, audience ceiling,
accepted limitations and release policy govern this project. Do not infer future
scale from backlog entries. Review findings need concrete impact on that target;
preserve approved scope unless the user explicitly changes it. Put unrelated
improvements in the backlog with a revisit trigger. A priority label alone is
not a launch gate. For version decisions, use the spec's policy and checkpoint
acceptance evidence instead of generic line-count, feature-size or Group-closure
heuristics. This project policy overrides those defaults in /ship; keep its
other release gates. A change that edits SPEC's release policy or adds
acceptance entries uses the base branch's policy, and its new entries count
only after the user confirms them directly. PROGRESS.md `## Acceptance` owns achieved stage and
evidence; SPEC owns definitions and target. Open a current supporting document
only when its listed role bears on the decision. Superseded plans/specs are
historical only: exclude them from routine discovery and backlog extraction.
Consult a named archive only for a specific unresolved historical question;
never use it to reintroduce scope or override the current spec.
```

## 3. Finish through /roadmap

Locate `/roadmap` through the installed skill catalog and read its complete
instructions (directly when there is no Skill tool). If unavailable, report
the missing workflow and preserve the draft; do not invent a replacement packer
or claim the roadmap was completed. Before running anything from it, confirm
that this roadmap copy documents the composition below (its Gather step accepts
a `/project-spec` candidate); otherwise report the version skew and stop. Then
run its own initialization once, but defer any upgrade it offers or would run
automatically (including `AUTO_UPGRADE=true`) until composition finishes.

Pass the draft canonical spec, document-retirement map, instruction changes and
proposed stage evidence as a **project-spec candidate**, together with the
user's decisions. The child must use the candidate spec for admission before
packing, include every proposed document (including archive sources/destinations
and redirects) in its preview/freshness/validation, and defer writes/commit
until the combined candidate is approved. SPEC, document retirement and the
instruction source are owned by this wrapper; roadmap's reconciliation, pin,
packing and audit gates still apply. Do not first write a speculative spec and
let a separate roadmap overwrite it.

The final proposal shows the spec and execution plan together, including
existing commitments proposed for amendment, superseded-document dispositions,
each placement's outcome rationale,
deferrals/revisit triggers, Group summaries, Track outcomes and version reasoning.
Resolve product gaps discovered during decomposition with the user; the child
cannot expand the target to absorb inconvenient TODOs. No file-count/size rule
may silently shrink approved scope.

Reuse approval for the exact combined candidate; do not ask for the same approval
twice. With no matching approval, ask once to apply or revise that candidate.
Roadmap's single freshness check covers every candidate path, including both
sides' PROGRESS edits; nothing is written before it passes.
On approval and a successful complete-candidate check, write the wrapper's
paths first, then roadmap's files: this wrapper applies its approved
SPEC/instruction/stage-entry and document-retirement edits (including extracted
supporting documents), the child applies
its roadmap artifacts, and roadmap's audit-after-apply covers all of them before
one documentation commit under roadmap's rules. This narrowly
extends the child's documentation-only file list for these named documents;
it grants no code/config/release writes. Follow host branch/worktree ownership.
Any write or post-apply validation failure stops before commit; report applied,
failed and unattempted paths, preserve the diff, and revalidate before resuming.
This is not an atomic multi-file write and no automatic rollback is promised.

If roadmap cannot produce a valid candidate, report the exact gap and leave
live files untouched. A user may explicitly choose to save the approved spec
alone; then mark roadmap incomplete and give its retry condition, never imply
that wrapping it succeeded. Unanswered questions are not permission to apply.

Finish with links to the canonical spec and roadmap, the selected target and
audience ceiling, release-policy summary, and any pending evidence. Do not run
implementation, upstream `/spec`, shipping, deployments or changes to other
repositories.

When the documentation commit landed, end with roadmap's Step 7 handoff for a
fresh session: `Run /docs-ship`, the approved candidate's proposal as the
brief, every committed path as the allowed files, and the version reasoning.
This docs-only change goes to `/docs-ship`, not `/review-and-prep` and
`/ship-and-land`. If the commit changed the instruction source (`AGENTS.md` or
`CLAUDE.md`), add a line saying so: `/docs-ship` treats agent instructions as
executable, so it stops at classification and asks whether to proceed.

<!-- SHARED:telemetry-finish -->
### Telemetry finish

Run when this invocation completes or deliberately pauses. Set `--outcome` to the actual result (`success`, `error`, `abort`, `blocked`, or `unknown`). Use `blocked` at a deliberate pause, where the run stops for a person and a later resume continues it. Telemetry is optional; see [docs/telemetry.md](https://github.com/kbitz/gstack-extend/blob/main/docs/telemetry.md). State, tier gating, and session wall-clock duration are handled by the binary; do not copy session values between calls.

```bash
_GE_CALL="$HOME/.gstack-extend/bin/telemetry-call"
if [ -f "$_GE_CALL" ] && [ -x "$_GE_CALL" ]; then "$_GE_CALL" finish --skill "extend:project-spec" --outcome unknown || true
elif [ "${GSTACK_EXTEND_TELEMETRY_DEBUG:-}" = "1" ]; then echo 'telemetry skipped: gstack-extend-telemetry unresolvable or stale. Fix: re-run ./setup. See docs/telemetry.md.' >&2; fi
true
```
<!-- /SHARED:telemetry-finish -->
