# Documentation-Audit Efficiency Record (`documentation-scope=contracts`)

This record evaluates Track 68A (**Bound documentation audits by changed contracts**) against the [workflow efficiency program](../designs/workflow-efficiency-program.md) (`E2`, `E3`, `E4`) and [`docs/SPEC.md`](../SPEC.md) (`P1`: review quality is never traded for speed without explicit evidence).

**Verdict:** Static backtest complete (`n = 7` merged PRs on `main`, `4` with known documentation drift and `3` `current`); live bounded runs `0`. The four-input contract-and-authority read list retains every known documentation correction in the sample (`6` of `6` updated files across the `4` drift PRs, `0` missed findings), either directly through the contract/authority read list or via the rule's broad fallback when `CLAUDE.md` changes. Because no live paired bounded audit ran in this session, after wall-clock time and token usage are `unknown`, public-quality evidence is insufficient for default activation, **this record awards no checkpoint and establishes no saving**, and `documentation-scope=contracts` remains an explicit opt-in `Review policy:` value while today's broad documentation audit stays the default (including under the light review default).

## Environment and E4 metadata

| Field | Value |
|---|---|
| Repository | `kbitz/gstack-extend` |
| Host / harness | macOS (`arm64`), Bun `1.3.10`, Git worktree checkout on `mmm/177176a7` |
| Installed `gstack-extend` revision | `51ecfdb` |
| Installed upstream `gstack` revision | `6666b729` |
| Sample selection rule | Every merged PR on `main` in `#189..#206` whose `/review-and-prep` receipt in the PR body lists an explicit repository-relative `files_reviewed` path list and `files_updated` outcome (`n = 7`: `#189`, `#191`, `#193`, `#198`, `#201`, `#204`, `#206`) |
| Excluded PRs in `#189..#206` | `#190`, `#197`, `#205` (roadmap regenerations without a `/review-and-prep` documentation-audit receipt); `#200`, `#203` (docs-only PRs without an itemized `files_reviewed` path list in the PR body); `#192`, `#194`, `#195`, `#196`, `#199`, `#202` (receipts summarize reviewed files as a count or shorthand rather than an itemized path list) |
| Sample size and outcomes | `7` merged PRs (`4` `updated` with `6` total corrected documentation files; `3` `current` with `0` documentation edits) |
| Unavailable sources | Live bounded documentation-audit wall-clock duration (`unknown`); live bounded child token usage (`unknown`); per-step token breakdown for historical documentation-audit subagents prior to finish-time token attribution (`unknown`); paired local `documentation` phase spans for `#189`, `#191`, `#193`, `#198`, `#201` and `#204` (`unknown` in local `workflow-metrics` logs) |

## Before / after summary table

Byte counts are exact `git cat-file -s <merge-sha>:<path>` totals at each PR's squash commit on `main`. For the broad arm, both the total `files_reviewed` list recorded by the audit (which often includes changed code or test files alongside documentation) and the documentation-only subset (`README.md`, `CLAUDE.md`, `CHANGELOG.md`, `VERSION`, `docs/**` and `scripts/init-templates/**`) are shown. For the bounded arm, both the four-input contract-and-authority read list and the effective read scope after applying **Bound the documentation audit** item 3 (**Broad fallback**) are shown.

| PR | Outcome & known drift (`files_updated`) | Inventoried docs (count / bytes) | Before: broad `files_reviewed` (all / docs-only) | Before: `documentation` phase wall time | After: 4-input contract list (docs / bytes) | After: effective bounded scope & fallback | Known drift retained | After: wall time & tokens |
|---|---|---|---|---|---|---|---|---|
| `#189` (`18266f8`) | `updated`: `README.md`, `docs/secret-dispositions.md` | `40` / `1,633,340 B` | `7` (`246,763 B`) / `7` docs (`246,763 B`) | `unknown` | `8` docs (`279,397 B`) | Bounded (`8` docs, `279,397 B`; `fallback=none`) | `2 / 2` (`README.md`, `docs/secret-dispositions.md`) | `unknown` |
| `#191` (`e0781e1`) | `current`: none | `41` / `1,664,755 B` | `8` (`543,329 B`) / `5` docs (`122,151 B`) | `unknown` | `6` docs (`260,939 B`) | Broad fallback (`41` docs, `1,664,755 B`; candidate modifies `CLAUDE.md`) | `current` (no drift) | `unknown` |
| `#193` (`2221f8b`) | `current`: none | `41` / `1,670,055 B` | `15` (`1,124,965 B`) / `9` docs (`681,547 B`) | `unknown` | `6` docs (`163,264 B`) | Bounded (`6` docs, `163,264 B`; `fallback=none`) | `current` (no drift) | `unknown` |
| `#198` (`3b3cf73`) | `updated`: `docs/upstream-check.md` | `43` / `1,728,365 B` | `15` (`850,733 B`) / `11` docs (`554,657 B`) | `unknown` | `8` docs (`350,741 B`) | Bounded (`8` docs, `350,741 B`; `fallback=none`) | `1 / 1` (`docs/upstream-check.md`) | `unknown` |
| `#201` (`cf85d31`) | `updated`: `README.md`, `docs/installation.md` | `44` / `1,765,092 B` | `5` (`96,357 B`) / `5` docs (`96,357 B`) | `unknown` | `6` docs (`123,863 B`) | Broad fallback (`44` docs, `1,765,092 B`; candidate modifies `CLAUDE.md`) or bounded `6` docs (`123,863 B`) without `CLAUDE.md` | `2 / 2` (`README.md`, `docs/installation.md` in both arms) | `unknown` |
| `#204` (`d8d8848`) | `updated`: `docs/telemetry.md` | `44` / `1,778,057 B` | `13` (`1,337,214 B`) / `9` docs (`671,238 B`) | `unknown` | `7` docs (`326,939 B`) | Bounded (`7` docs, `326,939 B`; `fallback=none`) | `1 / 1` (`docs/telemetry.md`) | `unknown` |
| `#206` (`51ecfdb`) | `current`: none | `44` / `1,800,166 B` | `16` (`1,016,457 B`) / `12` docs (`724,202 B`) | `330.7s` (step `69f3db9e-9a9e-4e0d-82c1-5591f55e7b90`) | `8` docs (`357,107 B`) | Bounded (`8` docs, `357,107 B`; `fallback=none`) | `current` (no drift) | `unknown` |

*Context from other paired `review-and-prep` `documentation` phase spans in local `workflow-metrics` logs:* PR `#199` (`base=3b3cf73`, step `264d4bc6-3d23-447d-a4aa-da95d017a17e`) recorded `752.9s` (`29` files reviewed, updated `docs/telemetry.md`), and PR `#202` (`base=cf85d31`, step `4d24f70b-433a-4ef4-bae4-d1fc2837c430`) recorded `449.2s` (`22` files reviewed, status `current`). Those two PRs are outside the table above because their PR bodies report `Files reviewed` as a count rather than an itemized path list; their timings are cited only as supplementary baseline context.

## Per-sample contract trace and retained-quality analysis

1. **PR `#189` (`18266f8`, Track 54A — narrow pregate after covered external tests):**
   - **Candidate paths:** `README.md`, `docs/acceptance/external-gate.md`, `docs/secret-dispositions.md`, `docs/upstream-check.md`, `docs/workflow-handoffs.md`, `skills/review-and-prep.md`, `src/upstream-check/cli.ts`, plus `3` test files and `1` fixture.
   - **Four-input read list (`8` docs, `279,397 B`):** `README.md`, `CLAUDE.md`, `docs/SPEC.md` (always); `docs/acceptance/external-gate.md`, `docs/secret-dispositions.md`, `docs/upstream-check.md`, `docs/workflow-handoffs.md` (changed docs and matches for `full-suite=external`, `pregate-narrowing`, `Narrow the pregate after an accepted pass`); `docs/installation.md` (linked from `README.md` / `CLAUDE.md`).
   - **Retained drift:** Both `README.md` and `docs/secret-dispositions.md` are on the bounded read list (`2 / 2` retained).
2. **PR `#191` (`e0781e1`, Track 52A — narrow skill-only test selection):**
   - **Candidate paths:** `.gstack/pregate.json`, `CLAUDE.md`, `README.md`, `docs/acceptance/skill-test-selection.md`, `skills/review-and-prep.md`, `tests/helpers/touchfiles.ts`, plus `6` test files.
   - **Bounded rule behavior:** Because `CLAUDE.md` is in the candidate diff, item 3 (**Broad fallback**) selects the full `41`-file doc inventory (`1,664,755 B`). Even under the four inputs alone (`6` docs, `260,939 B`: `README.md`, `CLAUDE.md`, `docs/SPEC.md`, `docs/acceptance/skill-test-selection.md`, `docs/installation.md`, `docs/workflow-handoffs.md`), every doc the broad audit reviewed except `docs/ROADMAP.md` (`42,573 B`) is included, and the audit outcome was `current`.
3. **PR `#193` (`2221f8b`, Track 64B — align outside-review no-findings instructions):**
   - **Candidate paths:** `docs/outside-review.md`, `src/outside-review/prompt.ts`, `tests/outside-review.test.ts`, `tests/telemetry.test.ts`.
   - **Four-input read list (`6` docs, `163,264 B`):** `README.md`, `CLAUDE.md`, `docs/SPEC.md` (always); `docs/outside-review.md` (changed doc and authority for `src/outside-review/prompt.ts`); `docs/upstream-check.md` and `docs/roadmap-future.md` (mentioning outside-review prompt contracts and linked from `docs/outside-review.md`).
   - **Volume delta vs. broad:** Drops `docs/telemetry.md` (`55,612 B`), `CHANGELOG.md` (`501,561 B`) and `VERSION` (`7 B`) that had no outside-review contract drift, reducing documentation bytes read from `681,547 B` (`9` docs) to `163,264 B` (`6` docs, `-76.0%` doc bytes) while keeping the `current` result.
4. **PR `#198` (`3b3cf73`, Track 65C — requalify upstream anchors against installed gstack):**
   - **Candidate paths:** `docs/roadmap-future.md`, `docs/upstream-check.md`, `skills/review-and-prep.md`, `src/autoplan-lean/criteria.ts`, `src/upstream-check/cli.ts`, `tests/skill-protocols-review-and-prep.test.ts`, `tests/upstream-check.test.ts`.
   - **Four-input read list (`8` docs, `350,741 B`):** `README.md`, `CLAUDE.md`, `docs/SPEC.md` (always); `docs/upstream-check.md`, `docs/roadmap-future.md` (changed docs); `docs/acceptance/review-fold.md`, `docs/acceptance/external-gate.md`, `docs/workflow-handoffs.md` (linked from `docs/upstream-check.md` and matching `bin/upstream-check` / `skills/review-and-prep.md` contract terms).
   - **Retained drift & volume delta:** `docs/upstream-check.md` (where the audit fixed a table cross-reference) is both a changed doc and the primary `src/upstream-check/cli.ts` authority (`1 / 1` retained). Documentation bytes read drop from `554,657 B` (`11` docs, including `CHANGELOG.md`) to `350,741 B` (`8` docs, `-36.8%` doc bytes).
5. **PR `#201` (`cf85d31`, Track 65B — generate pregate dependency maps for Python source roots):**
   - **Candidate paths:** `.gstack/pregate.json`, `CLAUDE.md`, `README.md`, `bin/pregate-deps`, `docs/TODOS.md`, `docs/installation.md`, `docs/pregate-deps.md`, `src/pregate-deps/cli.ts`, `src/pregate-deps/graph.ts`, plus fixtures and tests.
   - **Bounded rule behavior:** Because `CLAUDE.md` is modified in the candidate diff, item 3 (**Broad fallback**) triggers when `CLAUDE.md` is edited before the audit. Even if `CLAUDE.md` were untouched before the audit, the four-input contract list (`6` docs, `123,863 B`: `README.md`, `CLAUDE.md`, `docs/SPEC.md`, `docs/pregate-deps.md`, `docs/TODOS.md`, and `docs/installation.md` via both the `CLAUDE.md`/`README.md` installation link and the `--no-env-file --no-install --config=/dev/null` Bun launcher contract term in `bin/pregate-deps`) includes both `README.md` and `docs/installation.md` (`2 / 2` retained).
6. **PR `#204` (`d8d8848`, Track 66B — record requested model and effort telemetry):**
   - **Candidate paths:** `bin/lib/telemetry.py`, `docs/TODOS.md`, `docs/stage-runs.schema.json`, `docs/telemetry.md`, `tests/telemetry-contract.test.ts`, `tests/telemetry.test.ts`.
   - **Four-input read list (`7` docs, `326,939 B`):** `README.md`, `CLAUDE.md`, `docs/SPEC.md` (always); `docs/telemetry.md`, `docs/stage-runs.schema.json`, `docs/TODOS.md` (changed docs); `docs/designs/workflow-efficiency-program.md` (mentions `stage-runs.schema.json` and `requested_model` / `requested_effort` telemetry contracts).
   - **Retained drift & volume delta:** `docs/telemetry.md` (updated by the audit) is both a changed doc and the `bin/lib/telemetry.py` authority (`1 / 1` retained). Documentation bytes read drop from `671,238 B` (`9` docs, including `CHANGELOG.md` and `docs/quota-ledger.md`) to `326,939 B` (`7` docs, `-51.3%` doc bytes).
7. **PR `#206` (`51ecfdb`, Track 66C — record finish-time run token usage):**
   - **Candidate paths:** `.gstack/pregate.json`, `bin/lib/telemetry.py`, `bin/lib/telemetry_usage.py`, `bin/lib/workflow_metrics.py`, `docs/TODOS.md`, `docs/telemetry.md`, `docs/workflow-metrics.schema.json`, plus fixtures and tests.
   - **Four-input read list (`8` docs, `357,107 B`):** `README.md`, `CLAUDE.md`, `docs/SPEC.md` (always); `docs/telemetry.md`, `docs/workflow-metrics.schema.json`, `docs/TODOS.md` (changed docs); `docs/stage-runs.schema.json` and `docs/designs/workflow-efficiency-program.md` (mentioning `bin/lib/telemetry.py`, `bin/lib/workflow_metrics.py` and `token_usage` schema fields).
   - **Volume delta vs. broad:** Drops `CHANGELOG.md` (`529,405 B`), `docs/quota-ledger.md` (`12,068 B`), `scripts/init-templates/CLAUDE.md.tmpl` (`25,615 B`) and `VERSION` (`7 B`), reducing documentation bytes read from `724,202 B` (`12` docs) to `357,107 B` (`8` docs, `-50.7%` doc bytes) on a `current` audit whose broad `documentation` phase span took `330.7s`.

## Paired-run protocol for default promotion and older-producer fallback

To promote `documentation-scope=contracts` from an explicit caller opt-in to the default (or to include it in the light review default), a caller must record paired evidence on the same candidate heads under `docs/SPEC.md` (`P1`) and `docs/designs/workflow-efficiency-program.md` (`E2`, `E3`, `E4`):

1. **What a caller measures on paired runs:**
   - **Receipt scope lines:** `Documentation scope: contracts (inventoried=<N>; read-list=<M> docs, <B> bytes; reviewed=<K> docs, <R> bytes; extra-reads=<E>; fallback=<none|reason>)` and, when a second attempt runs after a fix batch, `Documentation re-audit scope: delta (delta-files=<D>; read-list=<M2> docs, <B2> bytes; carried-from=<audit_id> <section-sha256>)`.
   - **Time and token usage:** Paired `documentation` phase wall-clock duration (`begin`/`end` in `workflow-metrics`) and finish-time run token usage (`token_usage` in `stage-runs` / `workflow-metrics`) between the broad arm and the `documentation-scope=contracts` arm on the same candidate trees, plus re-audit delta volume when a fix batch triggers the second attempt.
   - **Retained finding quality:** Every factual correction or blocker surfaced by the broad arm on those heads must also be surfaced by the bounded arm (or trigger item 3's broad fallback).
2. **Older-producer fallback and capability check:**
   - Before adding `documentation-scope=contracts` to a `Review policy:` line, a caller checks the installed `/review-and-prep` skill with `grep -F 'documentation-scope=contracts' "<installed skill dir>/SKILL.md"` (exit `0` means supported).
   - When the check exits non-zero, an older `/review-and-prep` installation would reject the entire `Review policy:` line as `none supplied` (and an older H-E parser would hold a returned policy carrying the key as `policy-malformed`), so the caller omits `documentation-scope=contracts` and sends the remaining policy keys unchanged.
   - `/ship-and-land` activates bounded documentation audits only when its own invocation prompt's `Review policy:` line carries `documentation-scope=contracts` or the user chooses it in that session; preparation's receipt, PR text and comments never turn it on.
