# Unshown review findings under `blocking=shown`: measurement and decision

Recorded on 2026-11-16 against base commit `6b6f0bb` ([SPEC](../SPEC.md) O6.3 and P1). This record measures how often findings dispositioned non-blocking under `blocking=shown` (introduced in `7891822`, PR #234, 2026-11-10) were later confirmed real, establishes the baseline of `CRITICAL` unshown rows that only contested an approved plan decision, and records the resulting rule decision.

## Sample and method

- **Window:** 2026-11-10 (`7891822`, #234) through 2026-11-16 on this Linux workstation. Other machines are out of sample (`unknown`, not counted as zero).
- **Roots inspected:** this repository's evidence root and four consumer project roots under the orchestrator's state root and `~/.gstack/projects/<slug>/review-and-prep/`. Three roots held `Finding not blocking:` rows: this repository (16 PRs: #239, #241–#245, #248, #250, #252, #253, #256, #257, #259–#262; 90 rows), consumer A (13 PRs: #171, #172, #174, #176, #177, #180, #182, #184, #185, #187, #188, #190, #191; 158 rows), and consumer B (21 PRs: #310, #311, #313–#316, #318–#320, #322–#324, #326, #327, #330–#336; 138 rows). Consumer C and consumer D held 0 `Finding not blocking:` rows. Total sample: **386 deduplicated rows across 50 PRs** (385 `Finding not blocking:` rows plus 1 `Finding blocking:` row on consumer A #188 whose receipt notes it was initially unshown before Greptile reproduced it).
- **Extraction steps (read-only):**
  1. Scan regular files under each `review-and-prep` root (excluding diff/patch files, test sources, and template placeholders `<fingerprint>`) for lines matching `^\s*(?:[>*+-]\s+)?`?Finding not blocking:\s+([^;`]+?)\s*;\s*(.+?)\s*`?\s*$`, plus `Finding blocking:` lines whose adjacent disposition text states the finding was initially unshown.
  2. Map each evidence directory to its PR number from the receipt header (`PR:` line or pull-request URL) and deduplicate by `(repository, PR, fingerprint)` (normalizing one draft `F2 ` prefix on consumer B #318 to its final receipt fingerprint).
  3. Cross-check each deduplicated row against four confirmation signals: (a) a later `Finding blocking:` row for the same fingerprint on the same PR; (b) a Greptile inline finding on that PR describing the same defect with a fix reply (read from saved review artifacts and `gh api` pull-request comments); (c) a later commit on that PR or a follow-up PR (`git log --since=2026-11-10` and `git show`) fixing that defect; (d) a `docs/TODOS.md` entry, issue, or roadmap card naming it.
  4. Inspect the disposition rationale and approved plan for all 100 `CRITICAL` rows to record whether each only contested a decision the approved plan had made (`yes`, `no`, or `unknown`).

## Normalization mapping

| Field | Raw labels observed in receipts | Normalized value |
|---|---|---|
| `found_by` (or `source` on 3 rows in consumer A #180) | `core` | `core` |
| | `specialist:maintainability`, `specialist:simplification`, `specialist:state-machines`, `specialist:testing`, `performance` | `specialist:*` |
| | `native-adversarial`, `adversarial` | `adversarial` |
| | `red-team` | `red-team` |
| | `qa` | `qa` |
| | `outside:challenge`, `outside:structured`, `outside-challenge`, `outside-structured` | `outside` |
| | `greptile` | `greptile` |
| `severity` | `CRITICAL`, `critical`, `P1`, `CRITICAL (FIXABLE rule...)` | `CRITICAL` |
| | `INFORMATIONAL`, `info`, `P2`, `P3`, `INFORMATIONAL / P2` | `INFORMATIONAL` |
| `reason` | `not-shown`, `approved-design` (1 row, consumer A #176), `shown=none; reason=<prose>` (3 rows, consumer A #180), initially unshown `Finding blocking:` (1 row, consumer A #188) | `not-shown` |
| | `attacker-not-rerun` | `attacker-not-rerun` |
| | `base-only` | `base-only` |

## Results by part and severity

A multi-part row counts once per listed part and once in the deduplicated totals. `Rate` is `confirmed / (confirmed + not confirmed)`. All 386 sampled rows had readable PR and receipt evidence on this machine (`unknown = 0` in-sample; other machines `unknown`).

| Part | Severity | Confirmed | Not confirmed | Unknown | Total | Rate |
|---|---|---:|---:|---:|---:|---:|
| `core` | `CRITICAL` | 0 | 1 | 0 | 1 | 0.0% |
| `core` | `INFORMATIONAL` | 1 | 5 | 0 | 6 | 16.7% |
| `specialist:*` | `CRITICAL` | 0 | 2 | 0 | 2 | 0.0% |
| `specialist:*` | `INFORMATIONAL` | 2 | 19 | 0 | 21 | 9.5% |
| `adversarial` | `CRITICAL` | 6 | 85 | 0 | 91 | 6.6% |
| `adversarial` | `INFORMATIONAL` | 6 | 139 | 0 | 145 | 4.1% |
| `red-team` | `CRITICAL` | 2 | 7 | 0 | 9 | 22.2% |
| `red-team` | `INFORMATIONAL` | 2 | 30 | 0 | 32 | 6.3% |
| `qa` | `CRITICAL` | 1 | 0 | 0 | 1 | 100.0% |
| `qa` | `INFORMATIONAL` | 0 | 0 | 0 | 0 | n/a |
| `outside` | `CRITICAL` | 1 | 15 | 0 | 16 | 6.3% |
| `outside` | `INFORMATIONAL` | 4 | 93 | 0 | 97 | 4.1% |
| `greptile` | `CRITICAL` | 0 | 3 | 0 | 3 | 0.0% |
| `greptile` | `INFORMATIONAL` | 0 | 2 | 0 | 2 | 0.0% |
| **Deduplicated total** | **`CRITICAL`** | **9** | **91** | **0** | **100** | **9.0%** |
| **Deduplicated total** | **`INFORMATIONAL`** | **13** | **273** | **0** | **286** | **4.5%** |
| **Deduplicated grand total** | **All** | **22** | **364** | **0** | **386** | **5.7%** |

## Results by reason

| Reason | `CRITICAL` (conf / total) | `INFORMATIONAL` (conf / total) | Confirmed | Not confirmed | Unknown | Total | Rate |
|---|---:|---:|---:|---:|---:|---:|---:|
| `not-shown` | 6 / 80 (7.5%) | 5 / 250 (2.0%) | 11 | 319 | 0 | 330 | 3.3% |
| `attacker-not-rerun` | 0 / 17 (0.0%) | 1 / 28 (3.6%) | 1 | 44 | 0 | 45 | 2.2% |
| `base-only` | 3 / 3 (100.0%) | 7 / 8 (87.5%) | 10 | 1 | 0 | 11 | 90.9% |

## Confirmed rows (all 22)

1. **Consumer A #188 (`adversarial`, `CRITICAL`, `not-shown`):** deadline-bound slug lookup failed on local repositories without an `origin` remote instead of falling back to the directory name. Initially left unshown; confirmed by (a) a later `Finding blocking:` row on #188, (b) Greptile inline comment `4579006434` (fix reply `4579099675`), and (c) fix commit `b34fccf` on #188. Contested plan decision: `no`.
2. **Consumer A #188 (`adversarial`, `CRITICAL`, `not-shown`):** origin/slug lookup ran on shipped items without a PR or decision, emitting `unknown:git` rows. Confirmed by (c) follow-up fix PR #192 (`d24dfba`) and (d) consumer A's pending-work listing card after 38 such `unknown` rows appeared in real use. Contested plan decision: `no`.
3. **Consumer A #188 (`adversarial`, `INFORMATIONAL`, `not-shown`):** sequential oldest-first `gh pr view` per shipped item exhausted the 30 s budget on historical merged items. Confirmed by (c) follow-up fix PR #192 (`d24dfba`) and (d) the same card (100 `unknown:gh` rows in real use).
4. **Consumer A #188 (`red-team`, `INFORMATIONAL`, `not-shown`):** same oldest-first per-item `gh pr view` budget exhaustion on merged items; confirmed by (c) consumer A PR #192 (`d24dfba`) and (d) card.
5. **Consumer A #188 (`outside`, `INFORMATIONAL`, `not-shown`):** challenge phase report of the same per-shipped-item `gh pr view` budget exhaustion; confirmed by (c) consumer A PR #192 (`d24dfba`) and (d) card.
6. **Consumer A #188 (`outside`, `INFORMATIONAL`, `not-shown`):** challenge phase report of unconditional slug resolution on non-decision items; confirmed by (c) consumer A PR #192 (`d24dfba`) and (d) card.
7. **Consumer A #188 (`outside`, `CRITICAL`, `not-shown`):** structured phase `P1` report of oldest-first per-shipped-item `gh pr view` budget exhaustion; confirmed by (c) consumer A PR #192 (`d24dfba`) and (d) card. Contested plan decision: `yes` (contested the approved plan's per-shipped-item query design, which then failed at host scale).
8. **Consumer A #188 (`outside`, `INFORMATIONAL`, `not-shown`):** structured phase report of unconditional slug resolution on non-decision items; confirmed by (c) consumer A PR #192 (`d24dfba`) and (d) card.
9. **Consumer A #190 (`adversarial`, `CRITICAL`, `not-shown`):** per-operation wait budgets versus remaining append budget; confirmed by (d) `docs/TODOS.md` entry filed on #190 under convergence. Contested plan decision: `yes`.
10. **This repository #248 (`red-team,qa`, `CRITICAL`, `not-shown`):** scan-text separator boundary coverage; confirmed by (d) `docs/TODOS.md` entry on #248 and card in #251 (`7310660`), and (c) boundary tests added in #252 (`36a66ad`). Contested plan decision: `no`.
11. **This repository #252 (`adversarial`, `CRITICAL`, `not-shown`):** installed scanner native-receipt failure tail; confirmed by (a) a later `Finding blocking:` row on #252 (`shown=failing-test`, retained without code change as an approved plan risk under AC3). Contested plan decision: `yes`.
12. **Consumer B #324 (`adversarial`, `INFORMATIONAL`, `attacker-not-rerun`):** long relative symlink chain hitting `ENAMETOOLONG` in conflict resolution; confirmed by (a) a later `Finding blocking:` row in pass 8 on #324 and (c) fix commit `1bac8a3` on #324.
13. **Consumer B #316 (`red-team`, `CRITICAL`, `base-only`):** historical Git walk budget warning surviving a clean capture; confirmed by (d) `docs/TODOS.md` base-issue entry in `bbbe943` on #316 (carded in #317). Contested plan decision: `no`.
14. **Consumer B #318 (`core,adversarial`, `INFORMATIONAL`, `base-only`):** status showing conflicting update remedies after autopush; confirmed by (d) `docs/TODOS.md` entry on #318 and (c) follow-up PR #330 (`c10aafe`).
15. **Consumer B #319 (`specialist:*`, `INFORMATIONAL`, `base-only`):** `gc --conflicts` reporting deliberate keeps as permissions/locks failures (outcomes); confirmed by (d) `docs/TODOS.md` entry on #319 and (c) follow-up PR #332 (`fab4ef4`).
16. **Consumer B #319 (`specialist:*`, `INFORMATIONAL`, `base-only`):** `gc --conflicts` collapsing kept and failed conflict kinds; confirmed by (d) `docs/TODOS.md` entry on #319 and (c) follow-up PR #332 (`fab4ef4`).
17. **Consumer B #319 (`red-team,outside`, `INFORMATIONAL`, `base-only`):** non-verbose recapture printing inner push legacy summary; confirmed by (d) `docs/TODOS.md` entry on #319 and (c) follow-up PR #330 (`c10aafe`).
18. **Consumer B #322 (`adversarial`, `INFORMATIONAL`, `base-only`):** conflict discovery dropping unsearchable directory sidecars; confirmed by (d) `docs/TODOS.md` entry on #322 (deferred in #325).
19. **Consumer B #322 (`adversarial`, `CRITICAL`, `base-only`):** unmatched-path conflict error omitting shared `Run:` remedy; confirmed by (d) `docs/TODOS.md` entry on #322 and (c) follow-up PR #332 (`fab4ef4`). Contested plan decision: `no`.
20. **Consumer B #322 (`adversarial`, `INFORMATIONAL`, `base-only`):** nonempty conflicts listing trailing hint outside shared style; confirmed by (d) `docs/TODOS.md` entry on #322 and (c) follow-up PR #332 (`fab4ef4`).
21. **Consumer B #322 (`adversarial`, `CRITICAL`, `base-only`):** peer-controlled `:emoji:` codes rendered in outcome lines; confirmed by (d) `docs/TODOS.md` entry on #322 (killed in #325 triage). Contested plan decision: `no`.
22. **Consumer B #330 (`adversarial`, `INFORMATIONAL`, `base-only`):** recapture hiding held-file count from quiet inner push; confirmed by (d) `docs/TODOS.md` entry and (c) fix commit `c10aafe` on #330.

## Baseline: `CRITICAL` rows that only contested an approved plan decision

Across all 100 deduplicated `CRITICAL` rows (`80` `not-shown`, `17` `attacker-not-rerun`, `3` `base-only`):
- **Contested an approved plan decision only (`yes`):** **31 of 100 (31.0%)** (`3` in consumer B, `19` in consumer A, `9` in this repository).
- **Did not only contest a plan decision (`no`):** **69 of 100 (69.0%)**.
- **Unknown:** **0**.

Of the 31 `yes` rows, 3 were later confirmed under the signals above (3/31,
9.7%); among the 69 `no` rows, 6 were confirmed (6/69, 8.7%). Rows #7, #9 and
#11 are the confirmed `yes` cases. This is a historical plan-contesting
baseline, not a count of findings safe to settle: a failure the decision did
not accept remains an ordinary finding. Confirmation by a filed TODO or an
accepted-risk reproduction is the plan's measurement definition, not proof of
a post-merge escape; the high `base-only` rate largely reflects required filing.

- **Check on #260 and #261:** #260 had 1 `Finding not blocking:` `CRITICAL` row (`directory-sharing`, `found_by=red-team,native-adversarial,outside:challenge,outside:structured`), which contested the plan's accepted slash-flattening scheme (`yes`), plus 1 delegated adversarial `CRITICAL` finding on nullable wall time that was rejected in `final-dispositions.md` before `Finding not blocking:` emission because the plan and SPEC O6.1 explicitly required nullable timing (`yes`). #261 had 3 `Finding not blocking:` `CRITICAL` rows: 1 (`skills/review-and-prep.md:2806:A1`) contested AC6's preserved prefix-only validation (`yes`), while 2 (`:2485:A2`, `:2439:A3`) misread existing snapshot/cycle prose (`no`).

## Decision: **change**

- **Evidence:** `base-only` (10/11 confirmed via required `docs/TODOS.md` filing, 7 fixed in follow-up PRs) and `attacker-not-rerun` (0/17 `CRITICAL` confirmed; 1/28 `INFORMATIONAL` caught and fixed before merge on consumer B #324) work as designed. However, under `reason=not-shown`, 8 confirmed-real findings on consumer A #188 (including 3 `CRITICAL`: #1, #2, #7 above) were left unshown without a host probe: 1 (`adversarial-2.json:1`, origin-less local repo failure) escaped local review to the Greptile stage (`4579006434`), and 7 (unconditional slug reads on non-decision items and oldest-first per-item `gh pr view` budget starvation) reached merge and required a 623-line follow-up bugfix PR (consumer A #192, `d24dfba`).
- **Named rule change (filed in `docs/TODOS.md`, not implemented in this PR):** before recording `Finding not blocking:` with `reason=not-shown` for a `CRITICAL` (`CRITICAL`/`P0`/`P1`) finding from `adversarial`, `red-team`, or `outside` that names a concrete input state and failure on changed code and is neither disproved by source inspection nor settled by `Finding settled:`, require one bounded host reproduction probe against that input state. Keep `attacker-not-rerun`, `base-only`, and `INFORMATIONAL` `not-shown` rules unchanged.
