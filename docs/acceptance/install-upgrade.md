# Install, upgrade and recovery qualification

Status: **Open — partial qualification; open failures and owner confirmation pending (O1 not awarded)**

- **Date:** 2026-11-23 (`2026-11-23 04:40–04:44 UTC` `v0.111.0` scratch run; `2026-11-23 20:34 UTC` `v0.112.2` prerequisite re-check)
- **Track:** Track 94D — Qualify install, upgrade and recovery on the owner's machines
- **Supports:** [SPEC O1 (all three criteria)](../SPEC.md#o1-install-update-and-recover-a-working-skill-set) and [SPEC O5.2](../SPEC.md#o5-make-a-stable-release-promise-that-the-tooling-can-keep), plus the preserved Track 28A published three-part upgrade obligation (`2026-10-23`, trigger met by `v0.48.0`, `3cd166c`).
- **Downstream consumer:** Track 96C appends stable-channel upgrade evidence to this record ([ROADMAP](../ROADMAP.md)).
- **Qualification boundary:** Synthetic and scratch `HOME` fixtures alone do not establish O1.3. Open failures stay open, and no [PROGRESS acceptance](../PROGRESS.md#acceptance) entry is claimed until the owner completes the pending items and confirms acceptance.

## Environment and installed-commit disclosure

Host identification uses the generic label `host B`, matching [hand-use-telemetry.md](hand-use-telemetry.md) and [workflow-drivers.md](workflow-drivers.md). Scratch paths use placeholders (`<scratch-home>`, `<scratch-work>`, `<checkout>`).

| Item | Value |
|---|---|
| Host / OS / kernel | `host B` — Omarchy Linux, kernel `7.2.15-1-omarchy x86_64` |
| Installed harnesses on machine | `Claude Code 2.1.330`, `codex-cli 0.171.0` |
| Supported install hosts exercised | `claude` (`~/.claude/skills`) and `codex` (`~/.codex/skills`) |
| Runtime and tools | `Bun 1.4.3` (system); Linux x64 `Bun 1.3.2` and `Bun 1.2.0` (scratch test binaries); `Git 2.56.0`; `jq 1.8.2`; `Bash 5.3.20` |
| Scratch-HOME harness boundary | **No authenticated harness session was launched** in the scratch `HOME` (no credentials were copied). `~/.gstack-extend/bin/preamble` stood in for skill start. Upstream `gstack`, `gh`, and `~/.local/bin` were absent in the scratch `HOME`. |
| Scratch run installed commit (`v0.111.0`) | `54fd6df2f5a9c387f3ef226667b46d83498dd12c` (exact tag `v0.111.0`, `VERSION` `0.111.0`; cloned from `https://github.com/kbitz/gstack-extend.git`) |
| Prerequisite re-check commit (`v0.112.2`) | `39c2b0c1d7d8e02e5e2f6a4860fe75e13e84e2d1` (exact tag `v0.112.2`, `VERSION` `0.112.2`, PR #300) |

**Main-tracking upgrade disclosure:** Upgrade offers follow `main`, not a release identity. `bin/update-check` fetches raw `main/VERSION` from GitHub with no commit SHA or tag identity, and `bin/update-run` runs `git pull --ff-only origin main`. In the `v0.111.0` scratch upgrade (`54fd6df`), `main` happened to coincide with tag `v0.111.0`, so the offered `VERSION` string and installed tag agreed only incidentally. In the live `host B` historical pull on `2026-11-06` (see Task 2 below), `pull --ff-only origin main` landed on untagged commit `f4f79ab` (carrying `VERSION 0.68.0`, one docs commit ahead of tag `v0.68.0` at `8c514a9`).

## Fresh install and project onboarding (`v0.111.0`, `54fd6df`)

Executed `2026-11-23 04:40–04:44 UTC` in an isolated scratch `HOME` (`env -i HOME=<scratch-home>` with minimal `PATH` and no orchestration or session variables) against a fresh clone of `https://github.com/kbitz/gstack-extend.git`.

### Fresh install (README steps)

| # | Command | Exit | Trimmed output |
|---|---|---|---|
| 1 | `git clone https://github.com/kbitz/gstack-extend.git ~/.claude/skills/gstack-extend` | `0` | Cloned `main` at `54fd6df` (`v0.111.0`) |
| 2 | `~/.claude/skills/gstack-extend/setup --host auto` | `0` | `Installed preamble → <scratch-home>/.gstack-extend/bin/preamble`; `Installed 11 skills into <scratch-home>/.claude/skills`; `Tip: ~/.local/bin doesn't exist…` (printed twice); `Installed telemetry-call`; `Self-registered gstack-extend in <scratch-home>/.gstack-extend/projects.json` |
| 3 | `~/.gstack-extend/bin/preamble plan-track --root` | `0` | `EXTEND_ROOT: <checkout>` and `_EXTEND_ROOT=<checkout>` |
| 4 | `~/.claude/skills/gstack-extend/setup --host codex` | `0` | `Installed 11 skills into <scratch-home>/.codex/skills` |
| 5 | `mkdir -p ~/.local/bin && ~/.claude/skills/gstack-extend/setup --host auto` | `0` | Refreshed both Claude and Codex; `Wired gstack-extend → ~/.local/bin/gstack-extend`; `Wired gstack-extend-telemetry` |

Observed install layout and state:
- `--host auto` with no `~/.codex` installed Claude only; once `~/.codex` existed, `--host auto` refreshed both hosts.
- **Claude layout:** 11 skill directories, each containing `.extend-root` and a `SKILL.md` symlink into `<checkout>/skills/<name>.md`.
- **Codex layout:** 11 skill directories, each containing `.extend-root` and a generated regular `SKILL.md` copy (frontmatter stripped).
- **State created under `<scratch-home>/.gstack-extend/`:** `bin/preamble`, `bin/telemetry-call`, `install-status`, `projects.json`.
- **Self-registration note:** At `v0.111.0`, setup self-registered `kbitz-gstack-extend` with `"version_scheme": "4-digit"` (candidate defect 6; fixed to `"3-digit"` at `v0.112.2`, verified below).

### Project onboarding (`gstack-extend init`)

Tested on a throwaway Git repository (`<scratch-work>/demo-app`, initialized on `main` with one empty commit, a minimal `package.json` with `bun test`, and placeholder remote `https://example.invalid/acme/demo-app.git`):

1. `gstack-extend init <scratch-work>/demo-app --dry-run` → exit `0`. Listed 3 directories and 8 files to create; wrote nothing.
2. `gstack-extend init <scratch-work>/demo-app --no-prompt` → exit `0`.
   - Wrote `CLAUDE.md`, `CHANGELOG.md`, `VERSION` (`0.0.0.0`), `docs/{ROADMAP,TODOS,PROGRESS,roadmap-future,roadmap-shipped}.md`, `docs/designs/`, and `docs/archive/`.
   - Post-render audit ran and printed `VERSION STATUS: warn` (no git tags), `UNPROCESSED STATUS: found` (1 item), `MODE DETECTED: triage`, ending with `gstack-extend init: SUCCESS`.
   - Registered `acme-demo-app` in `<scratch-home>/.gstack-extend/projects.json` with `"version_scheme": "4-digit"` (preserved consumer default).
3. **Not exercised:** first skill runs (`/project-spec`, `/roadmap`) inside an authenticated Claude Code or Codex session.

## Missing and older prerequisites (`v0.111.0` baseline and `v0.112.2` live re-check)

### `v0.111.0` (`54fd6df`) baseline failures

In the `2026-11-23 04:40 UTC` scratch run (`PATH` built from `/usr/bin` excluding `bun` and `bunx`, plus Linux x64 `Bun 1.3.2` and `1.2.0`):
- **Bun absent:** `setup --host auto` exited `1` with an install hint whose `BUN_VERSION="1.3.10"` env var was ignored by `bun.sh/install` (defect 3); `bin/roadmap-audit --help` failed with unguarded `exec: bun: not found` (exit `127`, defect 2); `gstack-extend init --no-prompt` scaffolded and registered before failing the post-render audit with exit `127` (defect 2).
- **Bun `1.3.2`:** `setup`, `roadmap-audit`, and `init` all exited `0` despite the documented `1.3.3` floor (defect 1).
- **Bun `1.2.0`:** `roadmap-audit` and `init` exited `0`; `setup` exited `1` with a raw Bun stack trace (`ENOENT: … lstat '<cwd>/[eval]'`) and a misleading permissions `Fix:` line (defect 4).

### `v0.112.2` (`39c2b0c`, PR #300) live re-check (`2026-11-23 20:34 UTC`)

Re-checked live on `host B` in a fresh disposable scratch `HOME` (`env -i HOME=<scratch-home> PATH=<controlled-path> LANG=C.UTF-8 TERM=dumb`) against checkout `39c2b0c1d7d8e02e5e2f6a4860fe75e13e84e2d1` (`VERSION` `0.112.2`). Live `~/.claude/skills/gstack-extend`, `~/.codex/skills`, and `~/.gstack-extend/` metadata were verified unchanged before and after.

#### Missing Bun (`nobun` PATH)

| Command | Exit | Observed output (trimmed) and side effects |
|---|---|---|
| `./setup --host auto` | `1` | stderr: `setup: PREREQ_BUN_MISSING Bun >= 1.3.3 is required (not on PATH); … No changes were made. See docs/installation.md#requirements.` plus checksum instructions using `BUN_VERSION="1.4.3"` and positional `bash "$tmpfile" "bun-v$BUN_VERSION" && rm "$tmpfile"`. `<scratch-home>` remained empty. |
| `bin/roadmap-audit --help`, `bin/roadmap-pack --help`, `bin/outside-review --help` | `1` each | stderr: `<entry>: PREREQ_BUN_MISSING Bun >= 1.3.3 is required (not on PATH); … No changes were made. See docs/installation.md#requirements.` |
| `bin/layout-scaffold --help`, `bin/docs-ship --help`, `bin/upstream-check --help` | `5` each | stderr: `ERROR bun_missing: PREREQ_BUN_MISSING <entry>: bun is not on PATH` and `FIX: install Bun >= 1.3.3 … See docs/installation.md#requirements` |
| `bin/merge-gate check` | `1` | stderr: `ERROR bun_missing: PREREQ_BUN_MISSING merge-gate: Bun >= 1.3.3 is required (not on PATH)` and `FIX: …` |
| `bin/merge-gate --json` | `1` | stdout: `{"error":{"code":"bun_missing","doc":"docs/merge-gate.md#errors","fix":"install Bun >= 1.3.3 …","message":"PREREQ_BUN_MISSING merge-gate: Bun >= 1.3.3 is required (not on PATH)"},"v":1}` |
| `bin/review-state --help` | `5` | stdout: canonical JSON `{"v":1,"command":"unknown","status":"error","reason":"internal-error","detail":{"cause":"runtime-missing","message":"PREREQ_BUN_MISSING review-state: Bun >= 1.3.3 is required (not on PATH)","trace":null},…,"side_effects":"none",…}`; stderr: `ERROR INTERNAL_ERROR: …` and `FIX: …` |
| `bin/gstack-extend init <scratch-work>/nobun-dry --dry-run` | `0` | stdout: dry-run preview; stderr: `gstack-extend init: warning: PREREQ_BUN_MISSING … Dry-run writes nothing.` Nothing written to `<scratch-work>` or `<scratch-home>`. |
| `bin/gstack-extend init <scratch-work>/nobun-real --no-prompt` | `1` | stderr: `gstack-extend init: PREREQ_BUN_MISSING … No changes were made. See docs/installation.md#requirements.` Neither project directory nor `projects.json` was created. |

#### Older Bun (`1.3.2` and `1.2.0`)

Verified `bun --version` printed `1.3.2` and `1.2.0` respectively before each set:

| Command | `Bun 1.3.2` | `Bun 1.2.0` | Observed output (trimmed) and side effects |
|---|---|---|---|
| `./setup --host auto` | `1` | `1` | stderr: `setup: PREREQ_BUN_TOO_OLD Bun >= 1.3.3 is required (found <ver> at <path>); run: upgrade Bun to >= 1.3.3 … No changes were made. See docs/installation.md#requirements.` No stack trace, no misleading permissions `Fix:`, `<scratch-home>` empty. |
| `bin/roadmap-audit --help` | `1` | `1` | stderr: `roadmap-audit: PREREQ_BUN_TOO_OLD Bun >= 1.3.3 is required (found <ver> at <path>); …` |
| `bin/gstack-extend init … --dry-run` | `0` | `0` | stdout: dry-run preview; stderr: `gstack-extend init: warning: PREREQ_BUN_TOO_OLD … Dry-run writes nothing.` Nothing written. |
| `bin/gstack-extend init … --no-prompt` | `1` | `1` | stderr: `gstack-extend init: PREREQ_BUN_TOO_OLD … No changes were made.` Neither project directory nor `projects.json` was created. |

#### Supported Bun (`1.4.3`) verification of remaining `v0.112.2` fixes

- `bin/roadmap-audit --help`, `bin/roadmap-pack --help`, and `bin/outside-review --help` each exited `0` and printed usage text (defect 5 fixed).
- `./setup --host auto` in `<scratch-home>` (with `~/.local/bin` absent) exited `0`, printed `Tip: ~/.local/bin doesn't exist…` twice (once for `gstack-extend`, once for `gstack-extend-telemetry`; defect 9 still open), and self-registered `kbitz-gstack-extend` in `<scratch-home>/.gstack-extend/projects.json` with `"version_scheme": "3-digit"` (defect 6 fixed).
- `bin/gstack-extend init <scratch-work>/demo-v01122 --no-prompt` on a fresh throwaway Git repo exited `0` and registered `acme-demo-v01122` with `"version_scheme": "4-digit"` (confirming consumer project default is preserved).

## Upgrade with user-owned files preserved and stale copies reported (`v0.110.1` → `v0.111.0`)

In the `v0.111.0` scratch checkout, `git reset --hard v0.110.1` on `main` placed the install one release behind `origin/main` (`abe6979`, `VERSION` `0.110.1`), and that checkout's `./setup --host auto` installed it. User state was seeded with `config set review_default light` and 5 projects in `projects.json`. `~/.claude/skills/pair-review/SKILL.md` was replaced with a regular file containing a local edit and re-checked via setup, which preserved it as `reason=preserved_regular` in `install-status`.

Running the documented `/gstack-extend-upgrade` path (`~/.gstack-extend/bin/preamble gstack-extend-upgrade --force`, then `bin/update-run <checkout>`):

| Step | Exit | Trimmed output |
|---|---|---|
| `update-check --force` | `0` | `UPGRADE_AVAILABLE 0.110.1 0.111.0` and `INSTALL_WARN host=claude skill=pair-review … reason=preserved_regular cause=regular_file_not_overwritten compare=differs_canonical … Fix: <checkout>/docs/installation.md#shared-directory-migration` |
| `bin/update-run <checkout>` | `0` | `Updating abe6979..54fd6df` (6 files changed); `Warning: …/pair-review/SKILL.md is a regular file, not overwriting`; `UPGRADE_OK 0.110.1 0.111.0` |
| next `update-check` | `0` | `JUST_UPGRADED 0.110.1 0.111.0`; `INSTALL_WARN` for `pair-review` (`observed=0.111.0`) persisted on every subsequent check until recovered |

Observed preservation and refresh:
- **User-owned files:** `config` (`8dc7a522…`, `review_default=light`) and `projects.json` (`1d421cc6…`) kept identical SHA-256 digests before and after. `install-status` was rewritten by setup as designed.
- **Refreshed copies:** Codex regular copies were refreshed (mtime matched `update-run`), `~/.gstack-extend/bin/preamble` matched the new `bin/lib/preamble.sh`, and Claude symlinks resolved into the updated checkout.
- **Stale-copy reporting detail:** `bin/update-run` printed setup's one-line `Warning:`; the structured `INSTALL_WARN` line was emitted by `bin/update-check`.

## Working recovery paths (`docs/installation.md`, `v0.111.0`)

### Per-file preserved-copy recovery (`recovery-example:per-file`)

Ran the documented [shared-directory migration / per-file recovery](../installation.md#shared-directory-migration) block verbatim with `GSTACK_EXTEND_RECOVERY_SKILL=pair-review`:
- Exited `0`, printing `RECOVERY_COMPARE_DIFFERS` and `RECOVERY_MIGRATED`.
- `~/.claude/skills/pair-review/SKILL.md` was restored as a symlink into `<checkout>` with `SKILL.md.backup` beside it.
- Subsequent `update-check --force` printed nothing (`INSTALL_WARN` cleared).

### Rollback to `v0.47.0.0` (`3654619`) and resume to `main` (`54fd6df`)

Followed [docs/installation.md#version-numbers](../installation.md#version-numbers) using the actual last four-part tag `v0.47.0.0` (`3654619`):

1. `git fetch --tags origin`, `git status --short` (clean), `./bin/config set update_check false`, `git checkout --detach v0.47.0.0`, `./setup --host auto --quiet` — all exited `0`.
2. **State after rollback:** detached `HEAD` at `3654619` (`VERSION 0.47.0.0`); `config` kept `review_default=light` and `update_check=false`; `projects.json` SHA-256 unchanged. Claude had 11 readable skills plus dangling `plan-track` (added after `v0.47.0.0`, as disclosed) and restored retired `autoplan-lean`; Codex kept 12 readable copies; `preamble plan-track --root` still resolved.
3. **Resume:** `git checkout main`, `./bin/config set update_check true`, `./bin/update-run "$PWD"` — exited `0`, printing `Already up to date.` and `UPGRADE_OK 0.111.0 0.111.0`. The next `update-check --force` printed `JUST_UPGRADED 0.111.0 0.111.0` (candidate defect 7).
4. **State after resume:** `HEAD` back on `main` (`54fd6df`); Claude had 11 readable skills and `0` dangling links; Codex had 11 readable skills; retired `autoplan-lean` was removed again (confirming Track 70A `v0.72.0` retired-skill cleanup); `update_check=true` and user state remained intact; `preamble --root`, `update-check`, and `roadmap-audit` all succeeded.

Rollback + resume is not a real legacy four-part upgrade (`update-run` was a no-op against an already-current `main`).

## Published three-part upgrade from a real legacy four-part install (Task 2 — OPEN FAILURE)

**Status: Open failure — not passed.**

Candidate or `file://`-remote proof in [Release compatibility qualification](release-compatibility.md) does not satisfy O1.3 or Track 28A's published-upgrade obligation. No controlled end-to-end qualification of a real legacy four-part install upgraded through `https://github.com/kbitz/gstack-extend.git` has been completed and captured yet.

### Non-passing corroborating historical context (`host B`, `2026-10-24` → `2026-11-06`)

The live `host B` checkout's git reflog and stage-runs ledgers supply partial historical observations (recorded here as non-passing context only):
- **Initial install:** Cloned `https://github.com/kbitz/gstack-extend.git` on `2026-10-24T13:32:17Z` at `42eacc7` (tag `v0.46.0.0`, four-part); `~/.gstack-extend/` and `projects.json` entry (`version_scheme: "4-digit"`) were created at `2026-10-24T13:32:17Z`.
- **Default-remote upgrade:** Reflog `2026-11-06T14:27:10Z` records `pull --ff-only origin main`, moving `42eacc7` → `f4f79ab` (41 commits crossed, including `v0.47.0.0` at `3654619` and `v0.48.0` at `3cd166c`). Installed commit `f4f79ab` carried `VERSION 0.68.0` and was **untagged** (one commit ahead of tag `v0.68.0` at `8c514a9`), demonstrating main-tracking behavior in real use.
- **Post-upgrade reader compatibility:** Live `gstack-extend-telemetry report --by-host --json` read legacy `analytics/stage-runs.jsonl` (61 rows, producer `0.68.0`–`0.70.0`, schema v2/v3) alongside per-host v4 files: `5` files read, `0` unreadable, `1,305` rows counted, `0` malformed/invalid/unsupported.

**Why Task 2 stays open (missing evidence):**
1. The legacy checker's `UPGRADE_AVAILABLE` offer text and `UPGRADE_OK` result line from `2026-11-06` were not retained (`just-upgraded-from` was overwritten by subsequent upgrades).
2. Whether the `2026-10-24` install followed the published README instructions (rather than a personal bootstrap) is unconfirmed.
3. No pre-upgrade snapshot of `config` or `projects.json` was captured, so unchanged user state is inferred rather than proven.
4. No before/after skill-copy diff or `SETUP_SKIPPED_HOSTS` / `INSTALL_WARN` output was captured.
5. No live recovery path was exercised on that install.

### Owner runbook to close Task 2

To close Task 2, the owner must either:
1. **Run a controlled legacy four-part upgrade through the default remote** on an owner machine (without mutating the live install):
   - Seed a clean install at `v0.46.0.0` (`42eacc7`) or `v0.47.0.0` (`3654619`) pointing at `https://github.com/kbitz/gstack-extend.git` with realistic user state (`config`, `projects.json`, and a legacy `stage-runs.jsonl` sample).
   - Snapshot pre-upgrade `HEAD`, `VERSION`, `config`/`projects.json` SHA-256 digests, and host skill listings.
   - Run the legacy checkout's `bin/update-check --force` and `bin/update-run` against the default remote and retain the exact `UPGRADE_AVAILABLE`, `UPGRADE_OK`, `JUST_UPGRADED`, `SETUP_SKIPPED_HOSTS`, and `INSTALL_WARN` lines.
   - Record offered `VERSION` vs actual installed commit SHA and tag status, verify before/after user-state hashes, verify `gstack-extend-telemetry report --by-host --json` reads legacy + v4 rows cleanly, and confirm recovery works if needed.
2. **Or supply the missing historical provenance** for the `2026-10-24` → `2026-11-06` `host B` upgrade (confirming install provenance, supplying the retained `2026-11-06` `UPGRADE_AVAILABLE`/`UPGRADE_OK` lines, and explicitly accepting any remaining snapshot/recovery gaps as owner-waived).

## Candidate defects (1–9) and `v0.112.2` (`39c2b0c`) disposition

| # | Defect observed at `v0.111.0` (`54fd6df`) | `v0.112.2` (`39c2b0c`) disposition | Verification evidence |
|---|---|---|---|
| 1 | Documented Bun `1.3.3` floor did not match runtime behavior (`1.3.2` and `1.2.0` ran `roadmap-audit` and `init` with exit `0`). | **Fixed** | Live T1 re-check: `setup`, `roadmap-audit`, and `gstack-extend init --no-prompt` all exit `1` with `PREREQ_BUN_TOO_OLD` under both `1.3.2` and `1.2.0`; `docs/installation.md#requirements` explains `--no-env-file` (`1.3.3+`). |
| 2 | Bun-less launchers failed with unguarded `exec: bun: not found` (exit `127`), and `init` scaffolded/registered before failing the post-render audit. | **Fixed** | Live T1 re-check: all refusal families (`setup`, single-line launchers, two-line exit-5 launchers, `merge-gate`, `review-state`) and `init --no-prompt` refuse with structured `PREREQ_BUN_MISSING` before writing anything; `init --dry-run` warns and exits `0`. |
| 3 | `setup`'s Bun install hint set `BUN_VERSION="1.3.10"` as an env var, which `bun.sh/install` ignores. | **Fixed** | Live T1 re-check: `./setup --host auto` without Bun prints `bash "$tmpfile" "bun-v$BUN_VERSION" && rm "$tmpfile"` (positional version argument, `BUN_VERSION="1.4.3"`). |
| 4 | `setup` under Bun `1.2.0` crashed with a raw `[eval]` stack trace and a misleading permissions `Fix:` line. | **Fixed** | Live T1 re-check: `./setup --host auto` under Bun `1.2.0` exits `1` cleanly with `setup: PREREQ_BUN_TOO_OLD … (found 1.2.0 at <path>)`, no stack trace, no misleading `Fix:`, and writes nothing. |
| 5 | `bin/roadmap-audit --help`, `bin/roadmap-pack --help`, and `bin/outside-review --help` did not print usage help. | **Fixed** | Live T1 re-check under Bun `1.4.3`: all three exit `0` and print `Usage:` help text. |
| 6 | `setup` self-registered `gstack-extend` in `projects.json` with `"version_scheme": "4-digit"` despite its three-part `VERSION`. | **Fixed** | Live T1 re-check: `./setup --host auto` writes `"version_scheme": "3-digit"` for `kbitz-gstack-extend`, while `gstack-extend init` keeps `"4-digit"` for new consumer projects. |
| 7 | Same-version `JUST_UPGRADED 0.111.0 0.111.0` after a no-op resume (`UPGRADE_OK 0.111.0 0.111.0`). | **Open** | Source check at `39c2b0c`: `bin/update-run:186` writes `just-upgraded-from` unconditionally and `bin/update-check:443` emits `JUST_UPGRADED $OLD $LOCAL` even when `OLD == LOCAL`. |
| 8 | Rollback docs (`docs/installation.md`) showed `v0.46.0.0` as example tag instead of actual last four-part tag `v0.47.0.0` and only noted later skills "may fail". | **Fixed** | Source check at `39c2b0c`: `docs/installation.md#version-numbers` names `v0.47.0.0`, computes `LAST_FOUR_PART`, diffs added `skills/`, and discloses `plan-track` as a dangling link or stale copy. |
| 9 | When `~/.local/bin` is absent, `setup` prints the same `Tip: ~/.local/bin doesn't exist…` twice, and README does not mention creating `~/.local/bin` before wiring CLI commands. | **Open (minor)** | Live T1 re-check: `./setup --host auto` with `~/.local/bin` absent still prints the `Tip:` twice (once for `gstack-extend`, once for `gstack-extend-telemetry`). |

## Acceptance criteria status and open holds

| Criterion | Status | Evidence | Remaining owner action |
|---|---|---|---|
| Fresh install and project onboarding on owner's machine (OS, host, harnesses, versions, dated) | **Partial** | `v0.111.0` scratch run (`host B`, Omarchy Linux, Claude + Codex layouts, `init` dry-run and `--no-prompt`) + `v0.112.2` `init` re-check. | Run first skill invocation (`/project-spec` / `/roadmap`) in an authenticated harness session with upstream `gstack` installed, or confirm scratch coverage suffices. |
| Actionable failures for a missing prerequisite | **Covered on Linux `host B`** (at `v0.112.2`) | Live `v0.112.2` (`39c2b0c`) T1 re-check across missing Bun (all refusal families + `init`) and older Bun (`1.3.2`, `1.2.0`). | Confirm Linux `host B` coverage (macOS untested). |
| Upgrade with user-owned files preserved and stale copies reported | **Covered** (one-release hop) | `v0.110.1` → `v0.111.0` scratch upgrade: unchanged `config` and `projects.json` SHA-256 digests, `INSTALL_WARN` (`preserved_regular`), refreshed Codex copies and `preamble`. | Confirm one-release hop suffices alongside Task 2. |
| Working recovery path | **Covered** | Per-file `pair-review` recovery (`RECOVERY_MIGRATED`, cleared `INSTALL_WARN`) and rollback to `v0.47.0.0` (`3654619`) + resume to `main` (`54fd6df`) with retired `autoplan-lean` cleanup. | Confirm recovery evidence; note open minor defect 7 (same-version `JUST_UPGRADED` after no-op resume). |
| Real legacy four-part install upgraded through default remote (offered/installed identity, reader compatibility, unchanged user state) | **Open failure** | Not run as a controlled qualification. Non-passing `host B` `2026-10-24` → `2026-11-06` reflog (`42eacc7` → untagged `f4f79ab`) and v2/v3+v4 reader check (`1,305` rows, `0` bad) recorded as context only. | Execute the Task 2 owner runbook above (or supply missing provenance and explicit waiver). |
| Actual installed commit recorded; main-tracking offer behavior disclosed | **Covered** | `54fd6df` (`v0.111.0`), `39c2b0c` (`v0.112.2`), and historical `f4f79ab` (untagged ahead of `v0.68.0` `8c514a9`) recorded; `main/VERSION` vs `pull --ff-only origin main` disclosed. | Track 96C will later append stable-channel upgrade evidence. |
| Failures stay open; owner confirms before O1 counts | **Pending** | Task 2 and defects 7 & 9 remain open; [PROGRESS acceptance](../PROGRESS.md#acceptance) untouched. | Owner closes or explicitly waives open items and records O1 confirmation in `docs/PROGRESS.md`. |

## Qualification limits

- **Single platform/host:** Linux `host B` (Omarchy) only; no macOS fresh install, upgrade, or recovery run is recorded here.
- **No authenticated harness or upstream `gstack` in scratch `HOME`:** `~/.gstack-extend/bin/preamble` stood in for skill start; upstream `gstack`, `gh`, and real skill telemetry (`doctor` reported `tier: unavailable` / gstack helper unresolvable) were not exercised in scratch `HOME`.
- **Older-Bun sample:** Limited to Linux x64 `Bun 1.3.2` and `1.2.0`; other versions and macOS binaries were not tested.
- **Upgrade span:** Controlled scratch upgrade covered a one-release hop (`v0.110.1` → `v0.111.0`); Codex refresh was verified by mtime and `install-status` rather than a full 11-skill content diff.
- **Published legacy four-part upgrade (Task 2):** Still open; historical `host B` reflog observations do not replace a controlled end-to-end capture.
- **Compatibility catalog reference:** See [compatibility.md](../compatibility.md) for the stable-surface inventory and [release-compatibility.md](release-compatibility.md) for local candidate-only three-part release checks.
