# Delegated review repository access: acceptance record

Recorded against source revision `fb04192` plus this Track's implementation,
with upstream gstack qualified at
`297f50c7e1d46aab1404f5f2e8a9584af76ad6b2` (`1.97.0.0`). This record covers
the opt-in `"access": "repo"` provider mode (with optional `"expose"` and
`"keep"` path lists) in `review-delegates/v1` (see
[delegated review](../delegated-review.md#repository-access)), the bubblewrap
sandbox and disposable copy in `bin/review-delegate`, and the `/review-and-prep`
receipt and capability-check rules. No real run backs it yet: a static prose or
fake-delegate test is not installed-agent acceptance ([SPEC](../SPEC.md)). It
establishes no saving and awards no checkpoint ([SPEC](../SPEC.md) selected
target acceptance O6 and P1).

## Opt-in decision

Repository access is **opt-in per provider**:

- A provider in `review-delegates/v1` sets `"access": "repo"` (with optional
  `expose` and `keep` absolute path lists) to run inside a bubblewrap sandbox
  whose working directory is a disposable copy of the repository at
  `--candidate`. Omitting `access` or setting `"access": "diff"` preserves
  v0.75.0 diff-only behavior byte-for-byte.
- With no `Review policy:` or `Review delegates:` line, under the light review
  default, or for a delegated part mapped to a diff-mode provider, nothing
  changes.
- On any platform other than Linux, without an executable at the fixed system
  `bwrap` paths (`/usr/bin/bwrap`, `/bin/bwrap`, `/usr/local/bin/bwrap`), or
  when the 10 s bubblewrap probe fails, a configuration that maps any named part
  to a repo-mode provider refuses before any call with `sandbox-unavailable`,
  and every part of that invocation runs on the host model.

## Specialist question (criterion 5)

Whether the four specialist parts (`testing`, `maintainability`, `performance`,
`simplification`) may also map to a repo-mode provider alongside `adversarial`
and `red-team` was put to the owner at plan approval on 2026-11-08:

- Owner answers at plan approval (2026-11-08, verbatim): `"1 both", "2 one", "3 yes", "4 accept", "5 minor is fine"`.
- Decision: **yes (`"1 both"`)** — all six delegable parts, the four specialists
  included, may map to an `"access": "repo"` provider. The single-PR option
  (`"2 one"`), post-merge `RR1` placement (`"3 yes"`), documented caller-side
  tool network bound (`"4 accept"`), and `minor` release level (`"5 minor is
  fine"`) were confirmed at the same approval.

## Safety-model summary

See [Repository access in `docs/delegated-review.md`](../delegated-review.md#repository-access)
for the complete contract:

- **Enforced by `bin/review-delegate` (Linux + bubblewrap):** `--unshare-all
  --share-net --die-with-parent --new-session`, `--ro-bind / /`, `--tmpfs` over
  `/tmp`, `/var` (with `/var/tmp` empty and `/var/run` linked to `../run`),
  `/run` (re-binding the DNS resolver directory read-only when
  `realpath('/etc/resolv.conf')` is under `/run/`), `$HOME` and the passwd home,
  throwaway overlays or staged copies for `expose` paths and read-write binds
  for `keep` paths (a parent before any listed path inside it), `--tmpfs` over
  the real repository's work tree, git directory, common git directory, every
  worktree `git worktree list` names, the `--calls` directory and
  `XDG_RUNTIME_DIR`, and a read-write bind of a disposable copy: an empty
  repository that fetches only `--candidate` (a frozen snapshot commit no ref
  reaches included) and checks it out detached, with hooks, LFS filters and the
  host's global and system git configuration off. `expose` and `keep` entries
  at or above a hidden root, and an `argv[0]` the sandbox would hide without an
  entry covering it, refuse as `config-malformed`. The before-and-after
  `worktreeState` check on the real repository still holds and discards every
  dispatched part on any change (`worktree-changed`).
- **Configured by the caller's command (unobservable to the runner):** the
  network namespace remains shared (`--share-net`) so the provider command can
  reach its API; bounding tool network access to that API and starting no agents
  belong to the command's own sandbox configuration. Code from the reviewed head
  can run when the model runs commands. Abstract-namespace Unix sockets and path
  sockets outside the hidden paths, reads of non-hidden world-readable host paths
  (`/etc`, `/sys`), reads of `expose`/`keep` paths, writes to `keep` paths,
  unsized temporary mounts, prompt injection inside the sandbox, and findings
  carrying tool-read text into the receipt are documented limits.

## Pending installed-agent run

No real run has been recorded for this Track yet. Criterion 7 tracks one
post-merge real run (`RR1`), to be recorded here once the release carrying this
Track is installed:

| Row | Status | Date | Scope | What it must show and where its evidence lives |
|---|---|---|---|---|
| `RR1` | pending | — | Real `/review-and-prep` run on Linux with bubblewrap and a repo-mode attacker part | After the release carrying this Track is installed, run one real `/review-and-prep` on Linux with bubblewrap using `Review policy:` with `delegate=adversarial` and/or `red-team` and a `Review delegates:` file mapping that part to an `"access": "repo"` provider whose command bounds its tools' network. On a head carrying a defect the attacker part reproduces or verifies, read back `delegation: active (…; repo=…)`, `Delegated part:`, the finding's `evidence` naming the reproduction, and the v3 attempt in workflow metrics. Record the date, revision, OS, bubblewrap version, host, harness and provider-command versions (sanitized) and the PR in this row through a docs-only change. |

## Release-note input

Release files (`CHANGELOG.md`, `VERSION`, `package.json`, `bun.lock`) are
written at the release step, not on the implementation branch:

_release: minor (0.x compatible addition to a stable surface: optional `review-delegates/v1` provider keys, SPEC Release policy "During 0.x: compatible additions use MINOR")_

- `User-facing change:` a `review-delegates/v1` provider can set `"access": "repo"` (with optional `expose` and `keep` paths); on Linux with bubblewrap, `bin/review-delegate` starts its command in a sandboxed, disposable copy of the repository at the reviewed head so a delegated review part can read repository files and use tools, and records `; repo=<part>[,<part>...]` on `delegation: active (...)`; providers without it are unchanged.
- `Upgrade risk:` an older runner refuses a `review-delegates/v1` file carrying `access`, `expose` or `keep` as `config-malformed`, so delegation goes inactive and every part runs on the host; callers first check `grep -F '"access": "repo"' "<installed skill dir>/SKILL.md"`. Repo mode is Linux-only and requires bubblewrap (refusing with `sandbox-unavailable` elsewhere); a repo-mode provider's command and runtime must be visible in the sandbox or listed in `expose`/`keep` (an `argv[0]` under a hidden path refuses as `config-malformed`); the model's commands can run code from the reviewed head, so diff mode stays the choice for untrusted changes; and bounding tool network access is the caller's command configuration. Existing flags, exits and `run` output keys are unchanged, while `check` gains a conditional `access` key and the `sandbox-unavailable` refusal.

## What this Track does not claim

- No real run yet: no real run backs it yet, and `RR1` above remains `pending`
  until post-merge verification on an installed release.
- No saving: no wall-time, token or quality saving is claimed before `RR1` is
  measured against the host default ([SPEC](../SPEC.md) O6 and P1).
- No spend in tests: every test in `tests/review-delegate.test.ts` uses a local
  fake delegate script and calls no model or provider.
- No default change: `delegate=` remains opt-in, and providers without
  `"access": "repo"` remain diff-only.
