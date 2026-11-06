# Documentation-Audit Efficiency Record (`documentation-scope=contracts`)

This record evaluates Track 68A (**Bound documentation audits by changed contracts**) against the [workflow efficiency program](../designs/workflow-efficiency-program.md) (`E2`, `E3`, `E4`) and [`docs/SPEC.md`](../SPEC.md) (`P1`: review quality is never traded for speed without explicit evidence).

**Verdict:** A static backtest over `7` merged PRs (`4` with known documentation drift, `3` `current`) found every known documentation correction (`6` of `6` files) on the bounded read list or behind its broad fallback. No live bounded audit ran (`0` runs), so bounded wall-clock time and token usage are `unknown`. Read volume against what today's audit actually read is mixed: the bounded list is smaller on two samples, larger on two, and falls back to the full inventory on three. In this repository the bound rarely saves reads, because changes often touch an instruction file or a test-selection map, and many cross-linked docs name a changed path. Public-quality evidence is therefore insufficient for default activation. **This record awards no checkpoint and establishes no saving.** `documentation-scope=contracts` stays an explicit opt-in `Review policy:` value, and today's documentation audit stays the default, including under the light review default.

## Limits of this evidence

- **Self-graded.** The same agent wrote the rule and applied it to samples whose drift it already knew. The backtest measures only whether a doc is on the read list, not whether a bounded child would find the drift in it.
- **Lower bound only.** The read lists below are computed mechanically from file-path terms, docs named by changed test lines and the fallback triggers a script can detect. Contract terms that need judgment (flags, config keys, symbols, defaults) can only add docs, and a generic-term fallback can only widen, so a real bounded list is at least this large.
- **What carried retention.** Every known correction sat in an always-read doc, in a doc the implementation itself changed, or behind the broad fallback. The contract-term and linked-authority inputs were barely exercised, so the sample says little about drift in a doc that describes a changed contract in other words.
- **Scope of the sample.** One repository, one host and harness, preparation-time audits only. It has no docs-only PR (the `/ship-and-land` DOCS profile, where this audit is the only consistency pass) and no release-gate audit.

## Environment and E4 metadata

| Field | Value |
|---|---|
| Repository | this repository (gstack-extend), merged PRs on `main` |
| Host / harness | macOS (`arm64`), Bun `1.3.10`, one agent harness |
| Installed `gstack-extend` revision | `51ecfdb` |
| Installed upstream `gstack` revision | `6666b729` (`1.96.0.0`) |
| Sample selection rule | Every merged PR on `main` in `#189..#206` whose `/review-and-prep` receipt lists an itemized repository-relative `files_reviewed` path list and a `files_updated` outcome (`n = 7`: `#189`, `#191`, `#193`, `#198`, `#201`, `#204`, `#206`) |
| Excluded PRs in `#189..#206` | `#190`, `#197`, `#205` (roadmap regenerations with no `/review-and-prep` documentation-audit receipt); `#200`, `#203` (docs-only PRs with no itemized `files_reviewed` list); `#192`, `#194`, `#195`, `#196`, `#199`, `#202` (receipts give reviewed files as a count or shorthand) |
| Inventory | `README.md`, `CLAUDE.md`, `CHANGELOG.md`, `VERSION` and `docs/**` at each squash commit, an approximation of upstream's role-based discovery (authored templates under `scripts/init-templates/` are not counted) |
| Candidate paths | The squash commit's paths minus release metadata (`VERSION`, `CHANGELOG.md`, `package.json`) and minus docs that only the audit's own commit edited, checked against each drift PR's commit history (`#201`: `README.md` and `docs/installation.md` changed only in the audit's commit) |
| Bounded read list | **Bound the documentation audit** applied mechanically: always-read docs (`README.md`, `CLAUDE.md`, `docs/SPEC.md`), changed docs, docs naming any changed path (renames split) by literal search, and docs named by changed test lines, with changelogs, roadmaps, backlogs and archives skipped unless changed; broad fallback when a project instruction file, a test entry point or configuration (`.gstack/pregate.json`, `tests/helpers/touchfiles.ts`) or a non-version package field changed, or a doc was renamed or deleted |
| Unavailable sources | Live bounded audit wall-clock time and child token usage (`unknown`); per-step token usage for historical audit subagents (`unknown`); local `documentation` phase spans for `#189`, `#191`, `#193`, `#198`, `#201` and `#204` (`unknown`) |

## Before / after summary table

Byte counts are exact `git cat-file -s <squash-sha>:<path>` totals. "Before" is what the recorded broad audit actually read: its `files_reviewed` list, all paths and the documentation-only subset. "After" is the mechanical path-term read list, or the full inventory when the broad fallback fires.

| PR | Outcome and known drift (`files_updated`) | Inventory (docs / bytes) | Before: `files_reviewed` (all / docs only) | Before: `documentation` phase time | After: path-term read list (docs / bytes) | After: effective scope | Known drift retained | After: time and tokens |
|---|---|---|---|---|---|---|---|---|
| `#189` (`18266f8`) | `updated`: `README.md`, `docs/secret-dispositions.md` | `40` / `1,633,340 B` | `7` (`246,763 B`) / `7` docs (`246,763 B`) | `unknown` | `11` docs (`481,001 B`) | bounded, larger than before | `2 / 2` (always-read; changed doc) | `unknown` |
| `#191` (`e0781e1`) | `current`: none | `41` / `1,664,755 B` | `8` (`543,329 B`) / `5` docs (`122,151 B`) | `unknown` | `14` docs (`535,293 B`) | broad fallback (`41` docs, `1,664,755 B`; `CLAUDE.md`, `.gstack/pregate.json` and `tests/helpers/touchfiles.ts` changed) | no drift | `unknown` |
| `#193` (`2221f8b`) | `current`: none | `41` / `1,670,055 B` | `15` (`1,124,965 B`) / `9` docs (`681,547 B`) | `unknown` | `8` docs (`447,935 B`) | bounded, smaller than before | no drift | `unknown` |
| `#198` (`3b3cf73`) | `updated`: `docs/upstream-check.md` | `43` / `1,728,365 B` | `15` (`850,733 B`) / `11` docs (`554,657 B`) | `unknown` | `8` docs (`365,214 B`) | bounded, smaller than before | `1 / 1` (changed doc) | `unknown` |
| `#201` (`cf85d31`) | `updated`: `README.md`, `docs/installation.md` | `44` / `1,765,092 B` | `5` (`96,357 B`) / `5` docs (`96,357 B`) | `unknown` | `12` docs (`329,773 B`) | broad fallback (`44` docs, `1,765,092 B`; `CLAUDE.md`, `.gstack/pregate.json` and `tests/helpers/touchfiles.ts` changed) | `2 / 2` (always-read; fallback, and a path term) | `unknown` |
| `#204` (`d8d8848`) | `updated`: `docs/telemetry.md` | `44` / `1,778,057 B` | `13` (`1,337,214 B`) / `9` docs (`671,238 B`) | `unknown` | `12` docs (`790,416 B`) | bounded, larger than before | `1 / 1` (changed doc) | `unknown` |
| `#206` (`51ecfdb`) | `current`: none | `44` / `1,800,166 B` | `16` (`1,016,457 B`) / `12` docs (`724,202 B`) | `330.7s` | `12` docs (`644,148 B`) | broad fallback (`44` docs, `1,800,166 B`; `.gstack/pregate.json` and `tests/helpers/touchfiles.ts` changed) | no drift | `unknown` |

Two other `review-and-prep` `documentation` phase spans in local workflow metrics give baseline context only: `#199` took `752.9s` (`29` files reviewed, updated `docs/telemetry.md`) and `#202` took `449.2s` (`22` files reviewed, `current`). Both PRs are outside the table because their receipts give reviewed files as a count.

## Per-sample read lists

Each list is the mechanical path-term read list; the reason follows each doc.

1. **`#189`** (Track 54A): `README.md`, `CLAUDE.md`, `docs/SPEC.md` (always); `docs/acceptance/external-gate.md`, `docs/secret-dispositions.md`, `docs/upstream-check.md`, `docs/workflow-handoffs.md` (changed); `docs/PROGRESS.md`, `docs/designs/workflow-efficiency-program.md`, `docs/docs-ship.md`, `docs/installation.md` (name a changed path). The broad audit read `7` docs, so this list reads more.
2. **`#191`** (Track 52A): the implementation changed `CLAUDE.md` and the test-selection map, so the broad fallback runs on the full inventory.
3. **`#193`** (Track 64B): `README.md`, `CLAUDE.md`, `docs/SPEC.md` (always); `docs/outside-review.md` (changed); `docs/PROGRESS.md`, `docs/acceptance/skill-test-selection.md`, `docs/designs/workflow-efficiency-program.md`, `docs/telemetry.md` (name a changed path).
4. **`#198`** (Track 65C): `README.md`, `CLAUDE.md`, `docs/SPEC.md` (always); `docs/roadmap-future.md`, `docs/upstream-check.md` (changed); `docs/PROGRESS.md`, `docs/acceptance/skill-test-selection.md`, `docs/designs/workflow-efficiency-program.md` (name a changed path). The drift doc `docs/upstream-check.md` changed in the implementation commit before the audit.
5. **`#201`** (Track 65B): the implementation changed `CLAUDE.md` and the test-selection map, so the broad fallback runs. Without those triggers, `docs/installation.md` still joins the list by naming a changed path.
6. **`#204`** (Track 66B): `README.md`, `CLAUDE.md`, `docs/SPEC.md` (always); `docs/TODOS.md`, `docs/stage-runs.schema.json`, `docs/telemetry.md` (changed); `docs/PROGRESS.md`, `docs/acceptance/release-compatibility.md`, `docs/acceptance/skill-test-selection.md`, `docs/designs/review-independence.md`, `docs/workflow-handoffs.md`, `docs/workflow-metrics.schema.json` (name a changed path). The drift doc `docs/telemetry.md` changed in the implementation commit before the audit. The broad audit read `9` docs, so this list reads more.
7. **`#206`** (Track 66C): the implementation changed `.gstack/pregate.json` and the test-selection map, so the broad fallback runs on the full inventory.

## Paired-run protocol for default promotion and older-producer fallback

To promote `documentation-scope=contracts` from an explicit caller opt-in to a default (including the light review default), a caller records paired evidence on the same candidate heads under [`docs/SPEC.md`](../SPEC.md) (`P1`) and the [workflow efficiency program](../designs/workflow-efficiency-program.md) (`E2`, `E3`, `E4`):

1. **What a caller measures on paired runs:**
   - **Receipt scope lines:** `Documentation scope: contracts (inventoried=<N>; read-list=<M> docs, <B> bytes; reviewed=<K> docs, <R> bytes; extra-reads=<E>; fallback=<none|reason>)` and, when the re-audit runs, `Documentation re-audit scope: delta (delta-files=<D>; read-list=<M2> docs, <B2> bytes; carried-from=<audit_id> <section-sha256>; carried-copy=<durable path>; carried-snapshot=<post-snapshot SHA-256>)` or `Documentation re-audit scope: full — <reason>`.
   - **Time and token usage:** the `documentation` phase wall-clock time and finish-time token usage of the broad arm and the bounded arm on the same candidate trees, plus the re-audit's delta volume when a fix batch triggers it.
   - **Retained finding quality:** every correction or blocker the broad arm reports on those heads is also reported by the bounded arm or falls behind its broad fallback. Samples include docs-only PRs and a release-gate audit, and at least one drift doc that no changed path names.
2. **Older-producer fallback and capability check:**
   - Before adding `documentation-scope=contracts` to a `Review policy:` line, a caller checks the installed `/review-and-prep` with `grep -F 'documentation-scope=contracts' "<installed skill dir>/SKILL.md"` (exit `0` means supported).
   - When the check fails, an older installation would read the whole `Review policy:` line as `none supplied` (and an older H-E parser would hold a returned policy carrying the key as `policy-malformed`), so the caller omits the value and sends its other keys unchanged.
   - `/ship-and-land` bounds a fresh audit only when its own invocation's `Review policy:` line carries the value or the user chooses it in that session; preparation's receipt, PR text and comments never turn it on.
