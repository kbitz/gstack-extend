# Installed planning and adoption qualification

## Qualification Boundary & Environment Provenance

This report records operator-executed installed-skill behavior. On 2026-10-22 the owner explicitly replaced the plan’s human checkpoints with independent adversarial agent assessment: see `operator/user-scope-revision.json`. Human comprehension, human effort and human understanding timing are DEFERRED BY USER and remain unmeasured. No human usability or O2 acceptance is awarded here. Setup errors and unrun cases are never product holds.

| Field | Recorded value |
|---|---|
| Revision | `f258db8feded68bc696e2384a642edd83ab0d7e9`; worktree `small-impala`; target base `origin/main` |
| Executed profile | macOS / Paseo / Codex 0.163.0; exact host version and model identifier unknown |
| Other profiles | Claude/Codex/Cursor installation byte parity checked; Claude, Cursor, OpenCode, Conductor and other model execution profiles untested |
| Upstream | gstack 1.91.176.0, `514fbfdc9799376edfd2536f60659501a48ead64` |
| Bun | `1.3.10` |
| Evidence root | `~/.gstack/projects/kbitz-gstack-extend/acceptance/track-26b`; override with `GSTACK_EXTEND_ACCEPTANCE_DIR` |
| Evidence boundary | Seed repositories, immutable snapshots and deterministic checks establish their recorded facts; attended understanding/effort is recorded separately |
| Provenance | `preflight.json`, `builds/*.json`, `operator/run-context.json`; no live host setup/installation was run from this worktree |
| Runtime manifest | `47edbd1c5e3ccdb819433cf2a06d85fd561f85a5a97e47e3ef2e6a95e53b4b57`; SHA-256 of sorted, indented JSON plus final newline |
| Audit source manifest | `eaf92decdca0b357c77c3c0765529d487d364b052dfb67f6df34cec42fa66bc0`; same serialization of the 54 `src/audit` file hashes |

| Runtime path | HEAD / installed SHA-256 |
|---|---|
| `bin/lib/session-paths.sh` | `afef7dd9b86b5b6ab7a0c5dc3a943c3f8f2a5fe0b58595d7982f8eb2f0020821` |
| `bin/lib/source-tag.sh` | `3040e871efa8adba22e22ad2deece726cc9ab92667a2c25463c8ce474c45b014` |
| `bin/roadmap-audit` | `f18c19cb83cc75e0c49687367bbdf653e295082aa9231d272100adb46ada7839` |
| `bin/roadmap-pack` | `49132af25b612bb77c2790f522acce29e33f494827367911e8c39ebb1ea63557` |
| `bin/roadmap-renumber` | `7b9495fe41823aea234f405b6b987777dbef0925d1ebf12cd274742538ee4488` |
| `bin/roadmap-route` | `1f9237b95da723f8ee0e47f8fb0490dc0f8cabe3e1b848db5d1a0138d0d5bd72` |
| `setup` | `dc54aa2d7b7d0ea65dea516031b8fdd6fe26cb933d79e6b763263d12a43b0e08` |
| `skills/project-spec.md` | `24758b080c44ece88c7a75c4e80930ceff278f8ee1da2bbe6b7982df585facd5` |
| `skills/roadmap.md` | `67609004db75932e7185ef73567a03cf08cb48a2fa2fc138dc6120474e0fe8bc` |

| Host skill body | Roadmap SHA-256 | Project-spec SHA-256 |
|---|---|---|
| claude (raw-symlink) | `67609004db75932e7185ef73567a03cf08cb48a2fa2fc138dc6120474e0fe8bc` | `24758b080c44ece88c7a75c4e80930ceff278f8ee1da2bbe6b7982df585facd5` |
| codex (setup-host_skill_body-awk) | `a9347d63d87047b039eb8c96a259af03c781fba59dcc1a612a23d482e7bc1992` | `7ba85079bc2cafff6738f105e371f34769f5edd6983c6f2b1afe5c251da5b95f` |
| cursor (setup-host_skill_body-awk) | `a9347d63d87047b039eb8c96a259af03c781fba59dcc1a612a23d482e7bc1992` | `7ba85079bc2cafff6738f105e371f34769f5edd6983c6f2b1afe5c251da5b95f` |

| Changed input | Evidence invalidated |
|---|---|
| `skills/project-spec.md` | PS1–PS2 |
| `skills/roadmap.md` | All 18 roadmap rows, TM1–TM7 and PS1–PS2 roadmap handoffs |
| `bin/roadmap-*`, supporting shell libraries, `src/audit/**`, Bun version | All 27 rows |
| `setup` | T1 host parity, plus all 27 behavioral rows on hosts whose installed skill body `setup` transforms (`codex`, `cursor`) |

The builder pins system/global Git configuration, author/committer identity and dates, signing, hooks and the default branch. Ten original seeds rebuilt twice to identical HEADs. Scenario prerequisites are retained as explicit amendments before pre snapshots. Each repository has a local bare remote and separate state, telemetry and proposal roots.

## Attended /roadmap Qualification Matrix (PR #126 — 18 Rows)

Original source paths below are relative to `~/.gstack/projects/kbitz-gstack-extend/`; runtime evidence pointers are relative to the acceptance root. Primary scenario fingerprints hash the retained snapshot directory trees (`snapshots/<row>/{pre,post}/repo`, including `.git/`), while portable git `HEAD` and `HEAD^{tree}` SHAs are verified against each snapshot's `manifest.json` (`--verify-only` checks all 27 primary `snapshots/` pairs and `verify-evidence.py` checks the 4 supplemental `retests/ps-complete-measured/snapshots/` pairs); their complete SHA-256 index is `operator/roadmap/results.json`.

Exact source rows: `review-and-prep/track-22b-20261001-9wzap6j1/completion-matrix.md` SHA-256 `509fa06f10435464c249dcde4394bf620dc34d197565b8c137cc962601136700`; expanded acceptance source `kb-kbitz-track-22b-reconcile-packing-eng-review-test-plan-20261001-095338.md` SHA-256 `3fa2b090cd7be16140bf15b50d3e19ea34b9675b4c1793aaf1bd32f1945f0ef5`.

| Row | Pre repository fingerprint | Post repository fingerprint | Observation and evidence | Status |
|---|---|---|---|---|
| C14 | 2aef7d2ebfed487487fc8dcdc5d2ac0a140ff9ed79e7ac1d092762567d86adc9 | 98205f6fc7f96058b122de4c38efaf84a3aaaab3f3144c137ba5b0ff69a036ad | Raw history inspected independently from merge. Raw duplicate22A warning survives in RAW but disappears in MERGED; operator refuses despite no mechanical blocker. Exact completed/resume/unrelated-conflict states separately executed. Evidence: `operator/roadmap/C14-EC3-EC13-resume/proposal.md`, `operator/roadmap/C14-EC3-EC13-resume/events.jsonl` | PASSED |
| DX8 | f5ded987872b840893c061d75bfbe6310b4392a9bc85bf4b421db93f4118a999 | 6e6bbfb4dead583ce1cff262917a921effceff8ac8157761bc0550f475cb705b | Supplied toy text-state scope and canonical16D/active18B lineage technically reviewed; original owner preview needed clarification. User explicitly replaced human review with independent agent technical review. Adapted technical qualification, not human usability or uncoached study. Evidence: `operator/roadmap/CP1/proposal.md`, `operator/roadmap/CP1/events.jsonl` | PASSED |
| DX9 | f5ded987872b840893c061d75bfbe6310b4392a9bc85bf4b421db93f4118a999 | 6e6bbfb4dead583ce1cff262917a921effceff8ac8157761bc0550f475cb705b | Prerequisites, reading/draft and execution event bounds measured; human understanding explicitly unmeasured after owner replacement by agent review. Gaps unallocated; historical117s baseline retained and target2–5min is not a numeric release gate. Evidence: `operator/roadmap/CP1/proposal.md`, `operator/roadmap/CP1/events.jsonl` | PASSED |
| E5 | b5baa4ad84629052b0d014c471c0dd7a76c965506c20ad2c768cbef968f78297 | 80b6c0c40d124859fa5a3314ac57f3d853e7b6bf6e59156e4bd385d8cf614632 | Full27 aggregation:18 recovered roadmap rows,TM1–TM7,PS1–PS2 executed; all expected failures/refusals, snapshots and fix/retests retained. Independent agent substituted for human checkpoints by owner decision; no human usability or O2 award. Evidence: `operator/roadmap/results.json`, `operator/adversarial-assessment.json` | PASSED |
| CP1 | f5ded987872b840893c061d75bfbe6310b4392a9bc85bf4b421db93f4118a999 | 6e6bbfb4dead583ce1cff262917a921effceff8ac8157761bc0550f475cb705b | Approved92c2bda toy text-state obligations fail before landing and pass at840aa70/current; raw receipt canonical16D once with dated18B lineage; unfinishedsrc/c remains active17A. Initial non-executed proof gap corrected after independent review; installed identity/no-op path re-executed with actual assertion and all blockers pass, bytes unchanged. Evidence: `operator/roadmap/CP1/proposal.md`, `operator/roadmap/CP1/events.jsonl` | PASSED |
| CP4 | 4228f0321e8561ae1de70e19831811b4c224f0dbd199c218684e6ef2b5aad0de | e477cfdd7680bbe01ae652b4286b2ec7ac8cb42c48910a0b7c74eed8b1fe6bfc | Complete real-metadata active/archive candidates packed/final-labelled/audited before writes; plan-scripted Hold applies only fully shipped Group22 retirement retaining bin23A/deps; partial partition and dependency-output changes refuse with zero writes. Evidence: `operator/roadmap/CP4-EC11-allowed/proposal.md`, `operator/roadmap/CP4-EC11-allowed/events.jsonl` | PASSED |
| CP5 | 441e4b5171e68bd566b7b184e3161d7793d987b31fb07f91e9d176a83ac7f68c | 0a1fd1b50fb4857d1ef89727b34436e708b3aaeae2a0d40a27e0bda9844bb4cf | Actual Path.write_bytes after archive append raised OS IsADirectoryError(errno21). Full diagnostic includes CAP6:CP5:trace, What/Fix/Recovery/Code/Context/Redaction/Channel and completed/failed/unattempted. Operator followed emitted guidance in separate recovery event, revalidated same evidence and resumed active removal only; one receipt. Evidence: `operator/roadmap/CP5-archive-first-write-failure/proposal.md`, `operator/roadmap/CP5-archive-first-write-failure/events.jsonl` | PASSED |
| CP6 | 2ab36ab85fc4112065439e2ebb6df02144f69fbdb56ae0726a64a3dd917abe7c | 0509dc06de74b6d76a6d72012e31fafbd1faeaee7cb8549e6cad34a653ee6c87 | Named22B/Group22/branchmain preserved; one-bin backfill23A→22C skips archived22A with no tombstone22. Explicit plan-scripted pin release followed by full reservation/reallocation23A/23B plus outside-body tombstone22; final PACKING passes. Evidence: `operator/roadmap/CP6-compatible-backfill/proposal.md`, `operator/roadmap/CP6-compatible-backfill/events.jsonl` | PASSED |
| EC2 | 2aef7d2ebfed487487fc8dcdc5d2ac0a140ff9ed79e7ac1d092762567d86adc9 | 98205f6fc7f96058b122de4c38efaf84a3aaaab3f3144c137ba5b0ff69a036ad | Active unrelated22A retained while raw archived22A unchanged; merged active-wins collision warning observed. Clean-metadata retest has all mechanical blockers pass and still refuses solely on unresolved identity, zero writes. Evidence: `operator/roadmap/EC2-clean-metadata-identity-refusal/proposal.md`, `operator/roadmap/EC2-clean-metadata-identity-refusal/events.jsonl` | PASSED |
| EC3 | 2aef7d2ebfed487487fc8dcdc5d2ac0a140ff9ed79e7ac1d092762567d86adc9 | 98205f6fc7f96058b122de4c38efaf84a3aaaab3f3144c137ba5b0ff69a036ad | Exact same-work still-active receipt resumes; completed inactive identical evidence no-ops; raw duplicate22A warning omitted by merge is inspected/refused. Supplied contradictory zero commit actually fails git lookup and differs from preserved receipt exact commit; zero writes. Evidence: `operator/roadmap/C14-EC3-EC13-resume/proposal.md`, `operator/roadmap/C14-EC3-EC13-resume/events.jsonl` | PASSED |
| EC6 | 63d753b085edd40dc314201ef99113406fbf18c66b98f8f7c4f34eb8ede1b793 | 2c946bf8b1b2e6e2018205526243a0b6fc37caf692f257f8248e55a05339d56e | First legacy conversion count1 and canonical independent receipt shown with full toy scope proof and remainder bins. Wider real-context overlay includes every changed active/archive/Future snapshot and all blockers pass. Plan-scripted Hold refuses partial repack and preserves both originals byte-identically; no forced sunset. Evidence: `operator/roadmap/EC6-first-legacy-regeneration-hold/proposal.md`, `operator/roadmap/EC6-first-legacy-regeneration-hold/events.jsonl` | PASSED |
| EC7 | b5baa4ad84629052b0d014c471c0dd7a76c965506c20ad2c768cbef968f78297 | 80b6c0c40d124859fa5a3314ac57f3d853e7b6bf6e59156e4bd385d8cf614632 | Actual approved-obligation assertion fails on pending src/b regression requirement despite landed-like implementation. Missing obligation named;22A and unfinished22B stay active; no receipt or recycling, no attributable scope reduction supplied, zero writes. Evidence: `operator/roadmap/EC7-incomplete-approved-scope/proposal.md`, `operator/roadmap/EC7-incomplete-approved-scope/events.jsonl` | PASSED |
| EC8 | b5baa4ad84629052b0d014c471c0dd7a76c965506c20ad2c768cbef968f78297 | 80b6c0c40d124859fa5a3314ac57f3d853e7b6bf6e59156e4bd385d8cf614632 | Actual depth1 file:// clone reports shallow=true; git show HEAD^ introduction fails128; attributable supplied proof intentionally withheld. Operator requires saved proof/full history and refuses closure/ID recycling without guessing; zero writes. Evidence: `operator/roadmap/EC8-shallow-missing-introduction/proposal.md`, `operator/roadmap/EC8-shallow-missing-introduction/events.jsonl` | PASSED |
| EC9 | 2ab36ab85fc4112065439e2ebb6df02144f69fbdb56ae0726a64a3dd917abe7c | 0509dc06de74b6d76a6d72012e31fafbd1faeaee7cb8549e6cad34a653ee6c87 | Uncertain association produces named clarification choices and zero writes retaining original labels; plan-scripted confirmation then complete candidate/Apply preserves22B/Group22 and22C. Independently changed association after approval triggers pins_changed=true zero-write refusal, renewed named session candidate then applies preserving labels. Evidence: `operator/roadmap/EC9-uncertain-association/proposal.md`, `operator/roadmap/EC9-uncertain-association/events.jsonl` | PASSED |
| EC10 | 2ab36ab85fc4112065439e2ebb6df02144f69fbdb56ae0726a64a3dd917abe7c | 0509dc06de74b6d76a6d72012e31fafbd1faeaee7cb8549e6cad34a653ee6c87 | Actual packer shows22B,23A in one bin conflicting with two named pinned owning Groups; separate colliding22B/22C yields two bins for one owning Group. Both refuse zero writes and offer release/compatible-arrangement/retry, no PACKING exemption. Evidence: `operator/roadmap/EC10-two-groups-one-bin/proposal.md`, `operator/roadmap/EC10-two-groups-one-bin/events.jsonl` | PASSED |
| EC11 | 4228f0321e8561ae1de70e19831811b4c224f0dbd199c218684e6ef2b5aad0de | e477cfdd7680bbe01ae652b4286b2ec7ac8cb42c48910a0b7c74eed8b1fe6bfc | Hold allowed full Group retirement without changing remaining bin/deps; partial-shipment old[22B / 23A]→new[23A,23B] and dependency-output Group23←{22}→{} separately refused, byte-identical originals. Evidence: `operator/roadmap/CP4-EC11-allowed/proposal.md`, `operator/roadmap/CP4-EC11-allowed/events.jsonl` | PASSED |
| EC12 | 441e4b5171e68bd566b7b184e3161d7793d987b31fb07f91e9d176a83ac7f68c | 0a1fd1b50fb4857d1ef89727b34436e708b3aaeae2a0d40a27e0bda9844bb4cf | Four independent active bytes/archive bytes/declared pins/evidence HEAD drifts each yield PROPOSAL_STALE exit1 before first write. Each renewed complete proposal incorporates changed evidence and passes full gate. Controlled actual OS failure and emitted-guidance recovery also covered. Evidence: `operator/roadmap/CP5-archive-first-write-failure/proposal.md`, `operator/roadmap/CP5-archive-first-write-failure/events.jsonl` | PASSED |
| EC13 | 2aef7d2ebfed487487fc8dcdc5d2ac0a140ff9ed79e7ac1d092762567d86adc9 | 98205f6fc7f96058b122de4c38efaf84a3aaaab3f3144c137ba5b0ff69a036ad | Completed second run is byte-identical no-op; identical still-active receipt resumes active removal without append; unrelated reuse refuses; raw duplicate22A seeded/diagnosed/refused separately. Evidence: `operator/roadmap/C14-EC13-completed-noop/events.jsonl`, `operator/roadmap/C14-EC13-completed-noop/operator-verdict.json` | PASSED |

| New DX9 bucket | Start → stop (UTC) | Seconds |
|---|---|---|
| Prerequisites | 14:04:01.390437 → 14:05:05.816384 | 64.425947 |
| Reading / draft | 14:05:06.011861 → 14:05:33.502086 | 27.490225 |
| Execution through offered preview | 14:05:33.502086 → 14:06:09.123094 | 35.621008 |
| Human understanding | Explicitly replaced by owner | Unmeasured |

CP1 initially closed on asserted fixture text. The adversarial correction added executable before-fail/after-pass assertions and an installed no-op retest: `operator/roadmap/CP1/scope-proof-supplement.md`. This proves the supplied synthetic text-state contract, not a production application regression suite. Original attempts remain intact.

The historical DX9 attempt remains 16:53:33–16:55:30Z (117 seconds): reading/draft 80.946 seconds, execution 36.054 seconds, prerequisites and human understanding unknown. It does not replace the new attended attempt. The new event spans are a bounded supplied-evidence case after shared installed-skill reading/setup, not first-use onboarding; earlier shared reading and unallocated gaps are not silently included. The 2–5 minute common-case target is reported, not a numeric release gate.

Four timing buckets use explicit start/stop events: prerequisites begin at environment/evidence preparation and end when ready to read; reading begins when installed instructions/input reading starts and ends at draft readiness; execution begins at candidate validation/apply and ends at the offered preview or resulting summary; human understanding would begin when a concrete preview is presented and end on a comprehension response; this bucket is unmeasured under the owner’s scope revision. Agent assessment uses separate event-bounded reading/execution records. Gaps, overlapping work and unknown values remain explicit in retained timing records.

## Trigger-Migration Qualification Matrix (TM1–TM7)

| Row | Pre repository fingerprint | Post repository fingerprint | Observation and evidence | Status |
|---|---|---|---|---|
| TM1 | f0ed018294d87d9bf8eb8a69979ed1763851a3266bba5adb5db242a0297484ce | cd585d5e155aa10b1ed6b934ea97b81cc5283e7055648d8e6dc7296d2621ca47 | Observed every original line byte preserved before its appended marker; 17 already-triggered rows and every other repository file unchanged;25 appends. Evidence: `operator/tm/commands.jsonl`, `operator/tm/operator-events.jsonl` | PASSED |
| TM2 | f0ed018294d87d9bf8eb8a69979ed1763851a3266bba5adb5db242a0297484ce | cd585d5e155aa10b1ed6b934ea97b81cc5283e7055648d8e6dc7296d2621ca47 | Plan-scripted Hold wrote nothing; Revise supplied selected-target-changes for title-only25; Approve applied exact revised25-row candidate after installed index/full-context audit/freshness. Evidence: `operator/tm/commands.jsonl`, `operator/tm/operator-events.jsonl` | PASSED |
| TM3 | c4173db20387b67fa407a1bbd787852942e672c61098a91a5f1cf83d9b4d351d | e49db4e7a275f741471d0c546ac3e3e03b3c2246ca23f8fb64117b5b356c4ff7 | Actual locator found duplicate2, nonbold0 qualifying, absent0 -> not located. Two installed-parser draft negatives (MISSING placeholder and omitted title separator) refused before writes; valid recovery appended only title-only row; other3 missing bullets unchanged. Evidence: `operator/tm/commands.jsonl`, `operator/tm/operator-events.jsonl` | PASSED |
| TM4 | f0ed018294d87d9bf8eb8a69979ed1763851a3266bba5adb5db242a0297484ce | cd585d5e155aa10b1ed6b934ea97b81cc5283e7055648d8e6dc7296d2621ca47 | Title-only25 appended exact em dash then bold Revisit when marker; installed index reads selected-target-changes condition. Evidence: `operator/tm/commands.jsonl`, `operator/tm/operator-events.jsonl` | PASSED |
| TM5 | cd585d5e155aa10b1ed6b934ea97b81cc5283e7055648d8e6dc7296d2621ca47 | cd585d5e155aa10b1ed6b934ea97b81cc5283e7055648d8e6dc7296d2621ca47 | Second installed index42/0; operator did not re-offer migration. Whole repository fingerprint pre/post identical; no writes. Evidence: `operator/tm/commands.jsonl`, `operator/tm/operator-events.jsonl` | PASSED |
| TM6 | f0ed018294d87d9bf8eb8a69979ed1763851a3266bba5adb5db242a0297484ce | db4c02863e40fd0794d3c4e8aeaa8374d8be873140a42df4ec88faba90ef6e46 | Realistic42/25 batch;24 explicit queue-file>=100 conditions lifted. Parser accepts vacuous later but operator rejected it. New queue01=100 met condition; deliberate reassessment/plan-scripted Hold kept capability deferred; no implicit promotion. Evidence: `operator/tm/commands.jsonl`, `operator/tm/operator-events.jsonl` | PASSED |
| TM7 | f0ed018294d87d9bf8eb8a69979ed1763851a3266bba5adb5db242a0297484ce | cd585d5e155aa10b1ed6b934ea97b81cc5283e7055648d8e6dc7296d2621ca47 | Independent adversarial assessment verified exact preservation, deferred commitments and observable triggers; agent review intervals shared across profiles, comparator375–750s estimated, no measured speed advantage. Human observations replaced by explicit owner decision. Evidence: `operator/adversarial-assessment.json`, `operator/tm/results.json` | PASSED |

Independent technical assessment: `operator/adversarial-assessment.json`. Shared CP/TM/PS inspection spans were 14:12:16–14:16:26Z (250 seconds) and 14:20:48–14:21:31Z (43 seconds), with additional brief script inspections unmeasured. The triage/deletion comparator is an agent estimate of 25 × 15–30 seconds = 375–750 seconds, not a measured speed advantage. The 42 homogeneous synthetic entries qualify size/preservation mechanics; diverse real backlog judgment remains unproven.

The 42-item fixture contains 25 missing triggers. Approve/Revise/Hold are plan-scripted test operator choices; the replacement agent review effort and estimated triage/deletion comparison are labeled separately from unmeasured human effort. Met triggers enable reassessment rather than automatic promotion.

## Project-Spec Adoption & Reproducible Verification

| Row | Pre repository fingerprint | Post repository fingerprint | Observation and evidence | Status |
|---|---|---|---|---|
| PS1 | e0cdbe9efa0b1bcef5eb02d0b8fbe9465a768215ae5e4b5898c13adc533d43fd | f5fb339a365b64bf9922bb14e3334cef12f869b1107fbfacb909362cf3c57254 | Corrected known-input repeat: zero tags/VERSION0.0.0.0 advisory, authoritative SPEC+consumer bridge, additive baseline preserving original Acceptance, full audited roadmap;7 intended paths. Independent agent explains personal MVP1 with implementation/real-use proof still required. Evidence: `retests/ps-complete-measured/scenarios/PS1/results.json`, `operator/adversarial-assessment.json` | PASSED |
| PS2 | 3b9211c3137b6d54af53ec3d1f0f47039dcf5439663f1b666665e7282581f4be | 9cdb93440b5bfa72a6557be5ae728c677add0bfaa5915a7edee1d8644c89c6f5 | Corrected known-input repeat: complete disposition preview, actual tracked git mv+superseded notice+redirect,4 active links repaired, frozen history/original authority/Acceptance preserved;8 safety refusals,10 intended paths. Independent agent explains retained export/search obligations. Evidence: `retests/ps-complete-measured/scenarios/PS2/results.json`, `operator/adversarial-assessment.json` | PASSED |

PS1 uses a separately initialized, untagged repository with VERSION 0.0.0.0. Guided README navigation: line 64 describes the later-stage workflow; line 114 names project-spec and the roadmap handoff; line 23 also lists the skill. The repeated, supplied-line navigation ran 14:07:01–14:07:09Z (8 seconds), with prior knowledge disclosed; this is not first-time discoverability evidence.

PS1/PS2 retain separate timing, turn/coaching counts and independent agent commitment explanations; human measurements were explicitly replaced by the owner. PS2 must preserve the original authority text under the superseded notice, repair active references and leave frozen history byte-identical. Completion and qualified profile claims depend on recorded execution and adversarial observations. The original human comprehension questions required two clarifications before the owner replaced that gate; no successful human assessment is inferred.

Reproduction uses the durable builder; seed construction and snapshot verification never grade agent behavior:

```text
ACCEPTANCE=${GSTACK_EXTEND_ACCEPTANCE_DIR:-$HOME/.gstack/projects/kbitz-gstack-extend/acceptance/track-26b}
"$ACCEPTANCE/build-repos.sh" --verify-preflight --source-root "$PWD"
"$ACCEPTANCE/build-repos.sh" --verify-only
python3 "$ACCEPTANCE/operator/verify-evidence.py"
bun run test
bun "$ACCEPTANCE/operator/report-audit.ts"
```

The report audit wraps roadmap-audit with a non-zero assertion exit: this document has zero inventory patterns and no scattered entry, the scattered total remains the existing 1, and document type, location and taxonomy pass. It also checks checkbox/pattern and redaction constraints. Retained transcripts are scanned separately. Immutable snapshot collisions or corruption fail verification; use a new run root rather than replacing evidence.

Measured corrected adoption runs: `retests/ps-complete-measured/`; initial `scenarios/PS1`, `scenarios/PS2` and primary snapshots are preserved as earlier attempts. Final matrix fingerprints reference the corrected supplemental manifests.

| Profile | Prerequisites start → stop; seconds | Reading start → stop; seconds | Execution start → stop; seconds |
|---|---|---|---|
| PS1 | 14:18:42.105487 → 14:18:42.252114; 0.146627 | 14:19:09.168432 → 14:19:21.355837; 12.187405 | 14:20:38.669156 → 14:20:39.429681; 0.760525 |
| PS2 | 14:18:42.252532 → 14:18:42.398545; 0.146013 | 14:19:21.356181 → 14:20:24.878982; 63.522801 | 14:20:39.471363 → 14:20:40.327851; 0.856488 |

Each known-input repeat records 2 parent/operator messages (request and exact-preview approval), 2 defined visible tool cycles and 0 corrections during the bounded repeat. Hidden harness/model turns are unexposed. Five shared prior operator corrections cover bridge extraction, empty-Future draft prose, Group summaries, disposition tables and PS2 tracked-move execution; these earlier attempts are retained. Human understanding is unmeasured under the explicit scope revision. These short scripted execution spans exclude earlier novel planning/model work and do not establish first-use time-to-success.

Independent commitment explanations: PS1 plans personal local task listing/completion with preservation and repeat-use evidence still required. PS2 plans local export/search, retains original unfinished obligations as 1A/1B, and follows implementation with real-use qualification. The dated archive/redirect preserves history; active links select SPEC. Neither adoption awards acceptance.

Adversarial corrections covered missing executable CP1 proof, missing disposition tables, PS2 tracked-move protocol and measurement instrumentation. Corrected proofs/previews, literal tracked move, eight safety refusal probes and measured repeats were independently inspected. No installed code or skill was changed.

Verification receipt: `operator/checks/verification.json`; sanitized full logs are retained beside it.

| Acceptance artifact / verifier | SHA-256 |
|---|---|
| `build-repos.sh` | `e3bc73ab8dc749b8ea4020700d8932f6414d96efbd51021f3ad8f6e5c52bb6e5` |
| `acceptance.py` | `1fafefbb016a1bf26f60acf037eabecf37a69793dd9c0c95954870002e319fda` |
| `preflight.json` | `56cf84a3d055147fd5d6c710e3062ecd43f68846460d0f83b92a6a343ca8ae8c` |
| `operator/verify-evidence.py` | `88e55a26fe4b585325329a33b3e5acfa7bade3188a6e2053663aaa66990612dd` |
| `operator/report-audit.ts` | `e377a665c428442aa1695a85a787cbcc09fd8eef23cb254600ca67970edf7a17` |
| `operator/run-context.json` | `5e5443bb9cfbd7e9585519b7d9ec2a9abcf45d718cc6aa158807a16c6d152a61` |
| `operator/user-scope-revision.json` | `42a83ebabe620f0907de1967158676264018afac52c8d2acdcdea1560cc90638` |
| `operator/adversarial-assessment.json` | `c4d19f4628729fef33131ca58c38698e387eeeb5da23ecf4ae495d3940a6dda0` |
| `operator/roadmap/results.json` | `1bc1a2aa1de8b57599f2c9cf958fe3e6ab2ef5d9c3a3edf74c8facc153233ceb` |
| `operator/roadmap/integrity.json` | `de50cb558b30223e2aaab5afbc9e972d6a96cb57cf23d0102525a502ebf417e8` |
| `operator/tm/results.json` | `de06650f4dda3ea01e2e4511258a84a4148b3a99cf108d93b69431b66a57665f` |
| `retests/ps-complete-measured/scenarios/PS1/results.json` | `8efefb453c9b5df155979448c6891ecc4b3d475c55af5596cc7704ae542e58d3` |
| `retests/ps-complete-measured/scenarios/PS2/results.json` | `2ef16b586dbbe01350ba868d2f870178669c750e7b4d571972740138c14a9006` |
| `operator/checks/verification.json` | `0a1eb0ae500f7f2abfe6e09dbcb6915cc6a0996bc1dd543e0833429674289896` |

| Check | Result |
|---|---|
| Frozen dependency install | Passed; Bun1.3.10 |
| Full test suite outside sandbox | 3906 passed,3 skipped,0 failed; exit0;828.24 seconds |
| Earlier sandbox test run | 3799 passed,3 skipped,107 failed; exit1;687.63 seconds; failures cleared outside sandbox |
| Installed parity / immutable evidence | Passed:3 host copies,27 primary pairs,4 supplemental snapshots,1748 indexed roadmap artifacts,1875 redaction-clean text files |
| Section-scoped report audit / redaction | Passed:zero inventory patterns, scattered total1 with no report entry, document type/location/taxonomy pass |
| Source boundary | Only this new report is the product diff; root Acceptance/inbox/README/version/release files unchanged |

## Discovered 1.0 Blockers

No reproducible installed-skill defect was found in this recorded profile. All 27 rows pass the owner-amended operator qualification; no BLOCKING_HOLD is recorded. Unmeasured human usability and untested host/model profiles remain outside that claim. O2 owner acceptance is unchanged.

A reproduced defect uses Blocker Code `BLOCKING_HOLD:<id>` and fields What, Context, Trace, Recovery, Fix; negative paths also retain code/anchor, channel, redaction and the bounded retry observation. Any such defect keeps O2 unproven. Updating the project inbox requires explicit owner approval; it is outside this report’s file fence.
