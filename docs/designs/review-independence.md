# Review independence on the Cursor harness

Original snapshot: 2026-09-25, cutoff 12:21:00Z. Documentation correction and read-only reconstruction: 2026-09-25. This track changes no runtime code.

Accepted scope, 2026-09-25: this PR delivers the independence policy, checked static routing map, runnable reference calculations, corrected metadata reconstruction, and evidenced follow-ups as a limited documentation snapshot. The original empirical study remains unfinished; its missing measurements and historical source verification are deferred to [Complete the deferred review-independence empirical study](../TODOS.md#manual-complete-the-deferred-review-independence-empirical-study). This scope decision does not convert missing evidence into measured results or mark Track 16B complete.

## 0. Answer first

A configuration includes the entry point, route, primary vendor set, author vendor set, and dispatch gates. The table below applies to `/review` with the outside CLI available, no configured external bot, and no recorded ability for an in-host subagent to use a vendor different from the primary. Both the small-diff adversarial path and the 200+ line structured path can dispatch that outside vendor. `derived` means static analysis, not an observed review verdict. A derived failure can justify a routing change only when the complete configuration is established as **in use**; merely having the route installed does not establish its author set.

[Compute a verdict](#2-worked-example). [Re-run after an upgrade](#12-appendix).

<!-- expected:static -->
```text
TABLE answer entry=/review gates=outside-ready,no-proven-extra-vendor
route=cursor-cli primary=xai authors={openai} verdict=FAIL reasons=config-unsatisfiable provable-today=no label=derived
route=cursor-cli primary=xai authors={anthropic} verdict=UNMEASURED reasons=(none) provable-today=no label=derived
route=conductor-native primary=xai authors={anthropic} verdict=UNMEASURED reasons=(none) provable-today=requested-only-primary label=derived
route=conductor-native primary=xai authors={openai} verdict=FAIL reasons=config-unsatisfiable provable-today=no label=derived
route=claude primary=anthropic authors={anthropic} verdict=UNMEASURED reasons=(none) provable-today=when-logs-exist label=derived
route=claude primary=anthropic authors={openai} verdict=FAIL reasons=config-unsatisfiable provable-today=when-logs-exist label=derived
route=codex primary=openai authors={anthropic} verdict=FAIL reasons=config-unsatisfiable provable-today=when-logs-exist label=derived
route=codex primary=openai authors={openai} verdict=UNMEASURED reasons=(none) provable-today=when-logs-exist label=derived
TABLE calls
routing=insufficient-evidence
provenance=insufficient-evidence
availability=insufficient-evidence
priority-c=P2
```

The first eight rows are derived from the installed outside-voice resolver. On Cursor with primary xAI and an OpenAI author, Codex's vendor overlaps the author. On Codex with primary OpenAI and an Anthropic author, Claude Code's vendor overlaps the author. Neither configuration has an independent voice under these gates. A Codex primary and OpenAI author can use an Anthropic outside voice; “third vendor” means outside the excluded set, not three distinct vendors in every review.

The final calls remain insufficient-evidence. The original historical join compared sanitized log filenames with raw branches and incorrectly reported zero matches. The correction finds all eight Cursor rows' workspaces and 25 rows with time-qualified writer candidates across the selected cohort. Those are candidate metadata links, not proof of which session supplied a consumed result. No complete artifact → session → review row → consuming gate chain was frozen. We therefore withdraw the original zero-match explanation without inventing a measured PASS or FAIL. See section 7.

## 1. Question, definitions, verdict, policy

Question: does at least one consumed review voice come from a proven vendor outside both the code authors and the primary reviewer?

Vendor separation is a proxy for independent judgment. This track does not measure whether that proxy catches additional defects; that work is [Measure whether vendor separation catches more real defects](../TODOS.md).

Defaults: `exclude_vendors: [author, primary]`, `min_independent: 1`, `undisclosed_vendors: [cursor]`, `counted_voice_kinds: [outside, in-host adversarial, specialist, external bot]`, `proof_sources: [served, uncontradicted requested-only]`. The primary pass itself is not a counted witness. Under the alternative `exclude_vendors: [author]`, a **proven xAI in-host adversarial pass** could count when the author is OpenAI, even though xAI also ran the primary. That alternative changes the exclusion policy, not the counted kinds; this document does not recommend it.

- Voice: one pass whose completed output reaches a review gate. A configured or attempted pass is not a consumed voice.
- Vendor: `model_vendor()` in `bin/lib/quota/common.py:279`, first match, case-insensitive: `claude|opus|sonnet|haiku|fable` → anthropic; `gpt-|o[1-9]` → openai; `grok-` → xai; `composer-|vega` → cursor; otherwise unknown. Unknown and undisclosed Cursor lineage cannot prove independence.
- Author: a stage that changed the reviewed content, including `implement` and later fix passes, on the same repo and raw branch before the reviewed commit time. Merely committing unchanged content is not authorship. Writer coverage is `recorded-only` unless complete coverage is established; an empty recorded writer set cannot prove author exclusion. A known unrecorded writer leaves the author set unproven.
- Primary: the host model invoking `/review`, `/ship`, `/autoplan`, or `/review-and-prep`. In standalone `/codex`, Codex is the primary and there is no host review voice.
- Consumed result: the review row has `status` clean/issues_found; an outside pass additionally has `outside_status: completed`, and an in-host pass has `completed: true`. These are necessary, not sufficient: the result must also be bound to the artifact and gate. See gstack `review/sections/adversarial.md:223-226` for the result fields and `lib/review-evidence.ts:80-110` for artifact binding at commit `06ed920`.
- Proof: served evidence comes from billing or Claude `message.model`; requested evidence comes from an executing harness's Conductor `model.id` or Codex `turn_context.model`. Every contributing model must be covered. A bare command-line `--model`, `outside_provider`, stage finish override, or quota run's top-level `model` is an assignment and never sufficient proof. A concrete requested record is usable only when no served record contradicts it. `auto` is an alias, not a vendor.
- Multiple models: complete non-billing transcript evidence can prove a vendor set; every member must be outside both excluded sets. Several models from one vendor count once. Cursor billing has the stricter single-vendor predicate below; a multi-vendor billing window is unproven with `cause=multi-model`.
- Review identity: require an invocation link to combine phase rows. Different passes normally have different `review_binding.started_at` values, so matching commit/tree alone must not merge them. The filename branch is lossy; use `review_binding.branch_id` (SHA-256 of the raw branch) when present, otherwise match the installed sanitizer and reject collisions.

PASS requires one consumed proven independent witness and proven author and primary vendors. Other same-vendor, missing, or unproven voices remain observations and do not veto that witness. PASS has no failure reasons. Its assurance is derived from the primary, authors, and an eligible witness: it is `requested-only` if any necessary evidence is requested-only, otherwise `served`. Every verdict reports writer coverage. FAIL lists all applicable reasons, at least one, and preserves each unproven observation's original cause. The inline evaluator accepts normalized, evidence-checked inputs; setting its booleans is not a substitute for checking the source chain.

| Reason | When a review cannot PASS |
|---|---|
| `outside-same-vendor` | A consumed outside-harness voice overlaps an author or primary vendor |
| `outside-missing` | No voice from another harness was consumed |
| `voice-vendor-unproven` | A consumed voice lacks sufficient model evidence |
| `voice-vendor-unmapped` | Any contributing concrete model is unmapped; do not discard it |
| `voice-vendor-undisclosed` | A proven voice includes Cursor lineage |
| `primary-vendor-unproven` | Primary evidence is absent, incomplete, or undisclosed |
| `author-vendor-unproven` | Any author evidence is absent, incomplete, or undisclosed |
| `config-unsatisfiable` | No counted voice can be independent under the recorded dispatch gates |

| Cause | Action | Counts toward provenance go |
|---|---|---|
| `no-credential` | Make the billing credential available only to the billing reader | no |
| `unsettled` | Read twice after the run has ended for at least five minutes | no |
| `probe-induced` | Demonstrate the failure was introduced by the probe; report the control result | no |
| `window-ambiguous` | Resolve overlapping candidate sessions or turn windows | yes |
| `partial-coverage` | Obtain complete paging and window coverage | yes |
| `multi-model` | Separate Cursor billing windows until each proves one vendor | yes |
| `requested-only-contradicted` | Resolve served/requested disagreement; prefer applicable served evidence | yes |
| `alias` | Obtain a concrete executed model identifier | yes |
| `no-turn-bounds` | Obtain provider turn bounds; do not substitute usage totals | yes |
| `unrecorded-writer` | Recover the writer's execution evidence | yes |
| `not-recorded` | Recover the missing source or record it upstream | yes |
| `timeout`, `auth-rejected`, `rate-limited`, `sandbox-refused`, `unsupported-version`, `schema-changed` | Resolve the source failure, retaining its original adapter error code separately | yes |
| `workspace-archived` | Resolve archived workspace records before using worktree fallback | route |
| `no-slug-mapping`, `no-cwd-match` | Repair the project/branch/path join; not a measured configuration | route |

An unmapped concrete model keeps `voice-vendor-unmapped` as a reason and uses `not-recorded` for the unavailable vendor. That map gap is excluded from structural-provenance causes and requires the separate model-map remedy. Source errors are mapped to these presentation causes, not renamed in the source reader. For example `no_credentials` → `no-credential`, `http_401` → `auth-rejected`, `http_429` → `rate-limited`, `schema_changed` → `schema-changed`. Preserve `source_error` for diagnosis.

Cursor billing proof uses `events(store, deadline, start, end)` in `bin/lib/quota/readers/cursor.py:57`. Fully page [start − measured skew, end + 10 minutes + skew]. Two reads made at least five minutes after end must return identical projected events. Match the conversation from the transcript directory or a unique SDK agent/cwd/window, never the environment. Step 0 requires turn bounds and a provider distinction between parent/subagent turns, with no parent window enclosing a child. Missing bounds are structural `no-turn-bounds`. CLI child windows use `st_birthtime` through `st_mtime`; native children need their own recorded run. The billing adapter in section 12 fails closed on absent role fields; their availability has not been demonstrated on this machine. `quota sample` measures consumption, not model proof.

## 2. Worked example

The appendix's evaluator is standalone Python. Copy it into a file and run `python3 <file>`; it runs the samples without any private snapshot or network access. Inside this repository it imports the canonical vendor map; elsewhere it uses the same listed patterns. `authors` contains normalized evidence objects, not unverified vendor names. `complete` describes checked source coverage; `chain_verified` describes the artifact/session/row/gate join already verified by the caller.

<!-- expected:samples -->
```text
SAMPLE pass-served verdict=PASS reasons=(none) causes=(none) evidence=served writers=recorded-only
VOICE kind=outside vendor=openai proof=served same=False consumed=True reasons=(none) cause=(none)
SAMPLE outside-same-vendor verdict=FAIL reasons=outside-same-vendor causes=(none) evidence=unproven writers=recorded-only
VOICE kind=outside vendor=openai proof=served same=True consumed=True reasons=outside-same-vendor cause=(none)
SAMPLE voice-vendor-unproven verdict=FAIL reasons=voice-vendor-unproven causes=no-turn-bounds evidence=unproven writers=recorded-only
VOICE kind=outside vendor=unproven proof=served same=None consumed=True reasons=voice-vendor-unproven cause=no-turn-bounds
SAMPLE supplied-model verdict=FAIL reasons=voice-vendor-unproven causes=not-recorded evidence=unproven writers=recorded-only
VOICE kind=outside vendor=unproven proof=supplied same=None consumed=True reasons=voice-vendor-unproven cause=not-recorded
SAMPLE mixed-unmapped verdict=FAIL reasons=voice-vendor-unmapped causes=not-recorded evidence=unproven writers=recorded-only
VOICE kind=outside vendor=unproven proof=served same=None consumed=True reasons=voice-vendor-unmapped cause=not-recorded
SAMPLE missing-proof verdict=FAIL reasons=voice-vendor-unproven causes=not-recorded evidence=unproven writers=recorded-only
VOICE kind=outside vendor=unproven proof=None same=None consumed=True reasons=voice-vendor-unproven cause=not-recorded
SAMPLE invalid-author verdict=FAIL reasons=author-vendor-unproven causes=not-recorded evidence=unproven writers=recorded-only
VOICE kind=outside vendor=openai proof=served same=False consumed=True reasons=(none) cause=(none)
SAMPLE requested-only verdict=PASS reasons=(none) causes=(none) evidence=requested-only writers=recorded-only
VOICE kind=outside vendor=openai proof=served same=False consumed=True reasons=(none) cause=(none)
SAMPLE independent-specialist verdict=PASS reasons=(none) causes=(none) evidence=served writers=recorded-only
VOICE kind=outside vendor=openai proof=served same=True consumed=True reasons=outside-same-vendor cause=(none)
VOICE kind=specialist vendor=anthropic proof=served same=False consumed=True reasons=(none) cause=(none)
SAMPLE unproven-cursor verdict=FAIL reasons=voice-vendor-unproven causes=no-turn-bounds evidence=unproven writers=recorded-only
VOICE kind=outside vendor=unproven proof=served same=None consumed=True reasons=voice-vendor-unproven cause=no-turn-bounds
SAMPLE empty-branch not-a-cell cause=no-slug-mapping
```

The counterexamples cover supplied and absent proof, a mixture of known and unknown models, an invalid author, requested-only assurance, and preservation of an unproven Cursor voice's cause. The independent-specialist example is deliberately PASS while retaining the outside voice's same-vendor observation. Automated extraction testing remains [Automated test for the review-independence doc's reference evaluator](../TODOS.md); the appendix provides exact manual comparisons and mutation checks in the PR evidence.

For historical evidence, the three commands under “Extract and replay” extract the committed code, reconstruct projected inputs, and replay the metadata join. A writer candidate is then checked against its actual transcript (`message.model` for Claude, `turn_context.model` for Codex), full source window, reviewed commit/tree, review result, and consuming gate. No historical PASS is claimed here: the original snapshot did not preserve that complete chain. A count-only command cannot prove one, and the metadata join explicitly reports that limitation.

## 3. Routes, dates, versions

The original cutoff was 2026-09-25T12:21:00Z, before the first CLI attempt at 12:26:24Z. The reconstruction uses that same cutoff against retained records; it is not a new live review. Current database mappings and retained log files cannot recreate records already deleted or changed, so it is a dated reconstruction, not a claim that row-level evidence was frozen at the original cutoff.

| Tool | Original version | Source |
|---|---|---|
| gstack | 1.89.0.0 | `~/.claude/skills/gstack`, commit 06ed920 |
| gstack-extend | 0.29.0.1 | VERSION, commit a952f8d |
| cursor-agent | 2026.09.23-86fc751 | `cursor-agent --version` |
| codex | 0.155.1 | `codex --version`; ChatGPT subscription |
| claude | 2.1.282 | `claude --version`; claude.ai first party |
| Conductor | 0.87.3 | `CFBundleShortVersionString` |
| macOS | 26.6.2 build 25G83 | `sw_vers` |

Execution binaries were installed and the parent Cursor status check was logged in. `CURSOR_API_KEY` was absent; billing proof and skew measurement were therefore unavailable. Cursor has gstack's render but no gstack-extend setup target, so `/review-and-prep` is absent there. Telemetry tier was off. `CODEX_SANDBOX_NETWORK_DISABLED` was absent. The scratch slug was `scratch`; no pre-existing project directory collided. Missing `origin/HEAD` was repaired with a local bare remote, never a network push.

Invalidate this analysis when the outside resolver, review-log fields, store schema, or vendor map changes. Append a dated snapshot rather than replacing retained evidence. Anthropic documents a 30-day default for local session retention via [`cleanupPeriodDays`](https://support.claude.com/en/articles/14128775-claude-code-on-console-to-enterprise-migration); this is not a verified deletion date for these records or an explanation for their absence. The billing history depth was not observed. The original aggregate-only snapshot cannot be upgraded into a lossless historical projection after the fact.

Source and evidence-availability recheck, 2026-09-25: `origin/main` remains `bcd635a`; its `docs/telemetry.md` is unchanged from this branch and its TODOs contain neither reader nor wording follow-up. No published Track 16A revalidation was found in the inspected branch refs, open PRs, or local sibling workspaces. The read-first/deduplication check is complete for those sources; Track 16A's contract revalidation remains pending. The installed gstack is now 1.91.1.0 (`2a113ae`), but `git diff 06ed920 2a113ae -- scripts/resolvers/outside-voice.ts review/sections/adversarial.md lib/review-evidence.ts` is empty. This rechecks those three sources only, not the original live measurements.

The correction's `reconstructed-inputs-final.json` still matches SHA-256 `2701977d882b3c1b93375af09ce6dda95afb2afbca227876611591460504b1a2`, and exact replay passes for samples, static calculations, synthetic receipts, and metadata. It contains zero execution-chain receipts. The current local inventory lacks the original author logs and the live Cursor SDK/transcript directories named below; the separate isolated `independence-probe/e4-home` fixture remains present. The retained bare probe repository still resolves both author pins and their 280/332-line changes; Git content alone does not prove the authoring models. Missing local records may be recoverable from another retained source, but this recheck recovered none and establishes no historical PASS. A fresh measurement must be a separately dated snapshot with its own captured evidence.

## 4. Evidence sources

| ID | Source | What it proves and limits |
|---|---|---|
| E1 | `~/.gstack/projects/<slug>/<branch>-reviews.jsonl` | Host, phase, result, provider assignment, captured artifact fingerprints. No observed per-voice model on the Cursor/Grok rows; filenames are sanitized |
| E2 | Conductor `cursor-sdk-store/*/{agents,runs}.ndjson` | Agent → cwd and requested `model.id`, epoch-millisecond times. Does not identify a CLI or child model |
| E3 | `stage-runs.jsonl` | Writer candidates by repo/branch/time. Model may be a finish override and needs harness-log corroboration; contract pending Track 16A |
| E4 | `cursor_turns()` in `bin/lib/telemetry.py:483` | No turn for the copied live SDK shape; integer dates and list params fail its checks |
| E5 | Cursor transcript | Session activity; no model. A source limitation, not a proposed transcript fix |
| E6 | Skill ownership | Only extend skills write `stage-runs.jsonl`; gstack review voices are outside that coverage |
| E7 | gstack `scripts/resolvers/outside-voice.ts:8` | Codex host dispatches Claude Code; other renders dispatch Codex. Assignment is not observed execution |
| E8 | gstack host render | Cursor render identifies host cursor. Historical Grok used the Claude render; manually typed host grok is historical evidence only |
| E9 | Static composition | Satisfiability under explicit gates, not a measured result |
| E10 | Cursor events | Charged model if the full billing predicate holds; credential was missing |
| E11 | `model_vendor()`, `timestamp()` and quota SDK reader | Map concrete IDs and parse epoch milliseconds; quota reads model.id without dict params |

At cutoff, the original count projection reported 8 Cursor rows, 10 Grok rows, 14 stage rows, and 40 SDK runs all requesting `grok-4.7`. The corrected row-level reconstruction is in section 7. The original aggregate counts are not enough to recover authors or phase grouping. Cursor/Grok review rows contain no model field. For billing field citations: `cursor_cost.py:34` reads turn bounds, `:53` provides SDK fallback boundaries for consumption, and `:102`/`:155` carry model evidence. The quota run's top-level model (`ledger.py:300`) remains caller metadata.

E4 was isolated from cwd mismatch by copying one agent/run, rewriting cwd, setting `CURSOR_AGENT=1` and the copied conversation ID, and calling `cursor_turns()`. `parse_ts` at `telemetry.py:273` rejects integer timestamps; `cursor_turns` also requires dict params, but all 40 runs used a list of `{id,value}`. The start/end window check around `:616` uses the same ISO-only parser. The appendix now contains the full offline reproduction.

## 5. Static voice map

All entries below refer to installed gstack 1.89.0.0 and the matching host render. On Claude/Codex use `/review`, `/ship`, `/codex`, `/autoplan`; the Cursor skill directory is `gstack-review` and its declared skill name is `review`. Source: `scripts/resolvers/outside-voice.ts`, the generated host skill, and `review/sections/adversarial.md`.

| Entry | Host/render | Primary | Outside | Other counted voices and gates |
|---|---|---|---|---|
| `/review`, `/ship` review step | Claude | host | Codex | In-host adversarial on every diff; specialists by scope; outside adversarial if CLI ready; outside structured at 200+ lines |
| `/review`, `/ship` review step | Codex | host | Claude Code | Same size/scope gates, resolved by Codex render |
| `review`, `/ship` review step | Cursor CLI/native | selected host model | Codex | In-host and specialists only when available; model must be observed, not assumed from harness |
| historical `/review`, `/ship` | Grok on Claude render | Grok | Codex | Historical only; no active Grok render |
| `/codex` standalone | any supported render | Codex | none | No extra host voice; cannot import the `/review` satisfiability result |
| `/autoplan` dual voices | Claude/Cursor; historical Grok | host | Codex | Native voice plus outside when preflight is ready; no 200-line diff gate |
| `/autoplan` dual voices | Codex | host | Claude Code | Native voice plus outside when preflight is ready |
| `/review-and-prep` | Claude | host | Codex through nested `/review` | Greptile only under repository policy; does not guarantee a bot's model vendor |
| `/review-and-prep` | Codex | host | Claude Code through nested `/review` | Same repository policy; not installed on Cursor or Grok as a separate target |

Missing/disabled/auth-failed outside execution is missing coverage, never proof that it ran. Questions about base/scope/fixes can precede dispatch. The original probe used `GSTACK_SESSION_KIND=spawned` and report-only prompts, but because the preamble may auto-choose fixes, unchanged HEAD/tree and clean porcelain are mandatory validity checks.

## 6. Satisfiability and remedies

The section 0 table is calculated by the inline static function from each route's outside vendor, author set, and primary. It assumes no extra proven vendor from specialists/bots. A configured bot or a model-switching in-host pass changes the gates and requires another configuration row. A static contradiction with an observed independent witness is an input error, not a forced FAIL.

Original provisional calls before the live attempts were routing go for Cursor/xAI/OpenAI-author by construction, provenance go from reader/transcript gaps, and availability insufficient-evidence. Those observations do not establish that the complete failing configuration is in use or that a measured review failed. The corrected final calls remain insufficient-evidence under section 10.

| Remedy | Can add an eligible vendor for Cursor/xAI/OpenAI author? | Owner/cost | Installed on route |
|---|---|---|---|
| Review on implementer's harness | Sometimes; depends on its outside vendor and all authors | consumer process; no code | n/a |
| Vendor-aware outside voice in `/review-and-prep` | Yes, with observed model and consumption receipts | this repo; new skill path/setup work | no Cursor target today |
| Consumer dispatch with artifact/session/result/gate receipts | Yes, for its dispatched reviews | consumer orchestrator | n/a |
| Upstream vendor-aware gstack dispatch | Yes, when chosen outside both excluded sets | upstream routing and per-voice provenance | requires updated Cursor render |

No remedy is selected for adoption without a routing go. Consumers may block, obtain human review, or choose an explicitly weaker policy. The checker CLI remains deferred.

## 7. Composition and corrected reconstruction

The original aggregate file `~/.gstack/projects/kbitz-gstack-extend/independence-probe/p2-snapshot.json` remains untouched. Its reported zero workspace matches and zero implement-branch matches are **withdrawn**: filenames encode sanitized branches. This correction compares the raw-branch hash where available, otherwise sanitized names with collision rejection, and joins writer candidates before the actual commit time.

<!-- expected:metadata -->
```text
TABLE reconstructed-metadata
cursor-rows=8 workspace-matches=8
grok-rows=10
host-claude-grok-overlap-rows=1
rows-with-writer-candidates=25
measured-review-verdicts=unavailable cause=not-recorded
projection-errors=56
```

These are row counts, not counts of grouped reviews. The 25 writer-candidate rows include planning/review records on several hosts; a stage name does not alone establish content authorship. The one host-Claude row overlapping a Grok session is retained as historical, not treated as an Anthropic primary. The 56 malformed-record observations from 13 retained log files are preserved as `schema-changed` input gaps; counts can be incomplete. Do not turn missing records, ambiguous phase grouping, or a time-window candidate into a vendor proof.

The reconstruction freezes only whitelisted metadata with hashed repository, path, branch, and session join keys. It reads archived Conductor workspace records first, then existing worktrees. Raw messages, credentials, account fields and private project names are not output. Its metadata join deliberately stops before a verdict because the retained projection lacks a source-backed link from every session to the reviewed artifact and consuming gate. This is a reproducible evidence limit, not a hard-coded clean result. Filling it requires actual receipts, not a new inferred match.

Original CLI attempts: two of two budgeted attempts exited with authentication required and no review rows. Parent `cursor-agent status` succeeded, but **the same review command was not tested outside the allowlist**. `probe-induced` is only a suspected diagnosis; the observed failure is `auth-rejected`. Neither a failed probe nor a status check establishes an in-use route failure. The optional native attempt was not run.

## 8. Provenance feasibility

| Voice | Possible proof | Current limitation |
|---|---|---|
| Native Cursor primary | Concrete SDK `model.id`, requested-only unless contradicted | Does not bind a particular review result; reader shape defect |
| CLI primary / Cursor child | Billing events passing the full predicate | No credential; no demonstrated provider child bounds/role markers |
| Codex outside | Exact rollout, cwd/window, `turn_context.model`, requested-only | Candidate window alone does not bind output to artifact/gate |
| Claude primary/outside | Exact transcript/window `message.model`, served | Must verify execution/result chain and all contributing models |
| Authors | Proven content-writing stages and their own harness evidence | Stage models may be overrides; direct/fix writers may be unrecorded |

Filed gaps: [cursor_turns() cannot read the Conductor store shape](../TODOS.md), [The Cursor and quota sentence overstates what the store reader can read](../TODOS.md), and [File upstream: gstack review rows need per-voice observed model and vendor](../TODOS.md).

## 9. Observed join keys (gstack 1.89.0.0, no stability guarantee)

Track 16A's contract is [docs/telemetry.md](../telemetry.md), pending its revalidation at the original snapshot. This track does not edit telemetry or duplicate the reader owner’s work. Stage fields include `stage`, `agent`, `model`, `effort`, `rung`, `outcome`, `started_at`, `duration_s`, `session_id`, `repo`, `branch`, `work_item`, `source`, `route`, `entrypoint_raw`.

| Link | Required keys and checks |
|---|---|
| Project/branch → workspace | Project slug/remote identity, raw branch hash or unique sanitized branch; include archived workspaces |
| Writer → artifact | Same repository/raw branch, stage starts before commit time, actual content-change evidence, complete writer model window |
| Review row → artifact | Exact `commit_full` and reviewed tree/`wtree`; do not confuse a dirty working-tree snapshot with HEAD tree |
| Phase rows → invocation | Explicit invocation/result receipt; different start tokens are distinct unless linked by source evidence |
| SDK session | `agentId`, cwd, numeric `startedAt`/`endedAt`, concrete `model.id` |
| Cursor billing | Raw conversation equals session agent ID before projection; hash consistently after matching; never use the quota ledger HMAC as the raw ID |
| Codex / Claude evidence | Exact thread/session, cwd/window, contributing model records, output/result identity |
| Result → gate | A source-backed consuming-gate receipt naming that result and artifact; completion flags alone are insufficient |

The full chain is stricter than the metadata join. Normalizing a proven review means first verifying all these links, then constructing the evaluator's author/primary/voice evidence objects. Preserve source references privately. Do not mark `chain_verified` from a caller-supplied model, free text, or matching timestamps alone. Several candidate Codex sessions with the same vendor do not disagree on vendor, but still need the artifact/result binding; conflicting vendors are `window-ambiguous`.

## 10. Final decision rules

In use means a complete configuration observed in the preceding 30 days or explicitly declared by the operator. Installed routes alone and probe-only configurations do not qualify. Historical Grok configurations never drive a call. Count only deduplicated review invocations with checked evidence chains.

- Routing **go**: static unsatisfiability of a complete in-use configuration, or an in-use measured review failing with `outside-same-vendor`. Static analysis is sufficient for the former; it need not wait for a failed live review. File the selected remedy at P1 with a joined real failure, otherwise P2. **No-go** requires a complete inventory of in-use configurations, all satisfiable and each with measured PASS. Otherwise insufficient-evidence.
- Provenance **go**: an in-use measured FAIL has an unproven voice/primary/author with a structural cause belonging to that failure. Missing credential, unsettled data, and demonstrated probe-induced failures do not qualify. Priority for the per-voice upstream entry is P1 on go, P3 on no-go, P2 on insufficient-evidence. **No-go** requires measured served-evidence PASS for every in-use configuration and complete inventory coverage.
- Availability **go**: an in-use measured `outside-missing` has a demonstrated route cause, or the same failure reproduces outside the probe. **No-go** requires positive measured PASS coverage for every in-use configuration; otherwise insufficient-evidence.

The inline `calls()` computes those rules from explicit configuration inventory, coverage state, and measured results. No-go is a configuration-level feasibility call: one qualifying measured PASS covers that configuration; it does not claim every historical invocation passed. A qualifying failure still takes precedence through the go rules. The snapshot supplies no proven measured chains or complete configuration inventory, so all three calls are insufficient-evidence. Next deciding evidence: a complete real Cursor review with a recorded writer, concrete primary/outside evidence, and an artifact/result/gate chain; for availability, an equivalent execution control. No new live attempt was made during this correction.

No routing, model-map, or availability entry is filed on those calls. All observed concrete model IDs map. The roadmap audit on the original draft passed TODO_FORMAT, DOC_LOCATION and ARCHIVE_CANDIDATES, with only the four pre-existing scattered items. The first version in this file is gstack `1.89.0.0`; any future archive flag due only to that foreign version is a false positive, to record rather than conceal by reordering text.

## 11. Historical note

Grok Build previously used the Claude render. Its manually tagged rows and host-Claude rows overlapping Grok sessions require historical treatment; a host label does not identify the vendor. The nominal Cursor/xAI/OpenAI-author collision remains a static fact under the section 0 gates, not a proven historical review result.

The evidence-availability recheck confirmed `p0-preflight.txt`, `p2-snapshot.json`, both `review-*-meta.txt` files, `origin.git`, and the isolated `e4-home` fixture under `~/.gstack/projects/kbitz-gstack-extend/independence-probe/`; the original author logs were absent. This correction does not commit or rewrite those retained files. The correction's reconstructed inputs and checks live separately under `~/.gstack/projects/kbitz-gstack-extend/review-and-prep/cursor-independence-fixes/`. Missing original row-level projections cannot be recovered by relabeling the aggregate file.

## 12. Appendix

### Preflight and original attempt evidence

Before a future snapshot, record each binary's `--version`, `cursor-agent status`, `codex login status`, `claude auth status`, repository VERSION/HEAD, macOS `sw_vers`, and Conductor bundle version. Run `~/.claude/skills/gstack/bin/gstack-config get telemetry`. Check environment names only with `env | cut -d= -f1`; never print credential values. A missing binary/authentication blocks its route; a missing billing key blocks proof, not the CLI attempt. Check installed host skill names and the scratch slug before execution.

The prior correction reported `author-openai.log` and `author-anthropic.log` in the probe directory: each contained its seven-character commit ID, neither contained the full commit ID, and only the OpenAI log named a model (`gpt-6-astra`). Those logs were unavailable during the later evidence-availability recheck in section 3, so their contents remain a prior observation, not newly inspected evidence. Pins: OpenAI `2d31ae726cc7f7024dfc1cec5e58649d1f7dd588` (280 lines) and Anthropic `73b626703a5de0227a007438942e3423cc2021ef` (332 lines). Full writer-transcript binding was not frozen, so the probe author sets remain assignment-level.

The two meta files record unchanged HEAD/tree and empty porcelain. Telemetry brackets are 12:26:24Z + 2 seconds and 12:26:55Z + 1 second; they are wrapper durations, not exact CLI runtimes. The OpenAI quota bracket spans 12:26:24.704Z–12:26:27.099Z and reports `complete:false`; per-run consumption is unavailable. The Anthropic attempt has no frozen complete quota measurement. A success outcome on the first telemetry wrapper does not override the CLI's authentication error. Live stage counts were 14→14, skill usage 1976→1976, and live quota changes 0; the original aggregate records these observations, not a replayable transaction history.

Both attempts used `env -i` with HOME, PATH, USER, SHELL, TMPDIR, TERM, LANG and `GSTACK_SESSION_KIND=spawned`. No parent harness markers or billing key were passed. Flags: `cursor-agent -p --force --trust --sandbox disabled --model grok-4.7`; author launches used `codex exec --sandbox danger-full-access --skip-git-repo-check` and `claude -p --dangerously-skip-permissions`. Full original launch scripts were not retained. The following is the **future attempt-capture recipe**, not a claim to recover the original script bytes. It allows one attempt per existing author branch in a fresh local clone, a 1,200-second timeout, and no retries. Run it only as a newly authorized live snapshot, never as a deterministic replay:

```python
import hashlib, json, os, re, signal, sqlite3, subprocess, time, uuid
from pathlib import Path


def attempt(bare_origin, branch, pin, clone, destination, extend_bin, gstack_bin):
    """Future live recipe: call once per author branch, never during replay."""
    destination = Path(destination)
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    subprocess.run(["git", "clone", "--branch", branch, str(bare_origin), str(clone)], check=True)
    env = {k: os.environ[k] for k in ("HOME", "PATH", "USER", "SHELL", "TMPDIR", "TERM", "LANG") if k in os.environ}
    live_env = dict(env)
    env.update(GSTACK_SESSION_KIND="spawned", GSTACK_EXTEND_STATE_DIR=str(destination/"extend"),
               GSTACK_HOME=str(destination/"gstack"), GSTACK_STATE_DIR=str(destination/"gstack"))
    quota_env = dict(env)
    if "CURSOR_API_KEY" in os.environ:
        quota_env["CURSOR_API_KEY"] = os.environ["CURSOR_API_KEY"]
    def git(*args):
        return subprocess.check_output(["git", "-C", str(clone), *args], text=True).strip()
    phase_status = {}
    def capture(name, argv, run_env=env, timeout=120):
        # Every subprocess has a separate process group, including nested review voices.
        try:
            with (destination/(name + ".log")).open("w") as stream:
                process = subprocess.Popen([str(a) for a in argv], cwd=clone, env=run_env,
                                           stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
                try:
                    status = "exit-%s" % process.wait(timeout=timeout)
                except subprocess.TimeoutExpired:
                    status = "timeout"
                finally:
                    # Kill remaining group members even if the direct child already exited.
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.wait()
                    deadline = time.monotonic() + 5
                    while True:
                        try:
                            os.killpg(process.pid, 0)
                        except ProcessLookupError:
                            break
                        if time.monotonic() >= deadline:
                            raise RuntimeError("process group cleanup unverified")
                        time.sleep(0.05)
        except Exception as error:
            status = "error:" + type(error).__name__
        phase_status[name] = status
        return status
    def sinks():
        result = {}
        for name, path in [("stages", Path.home()/".gstack-extend/analytics/stage-runs.jsonl"),
                           ("usage", Path.home()/".gstack/analytics/skill-usage.jsonl")]:
            data = path.read_bytes() if path.exists() else b""
            result[name] = dict(lines=len(data.splitlines()), sha256=hashlib.sha256(data).hexdigest())
        db = Path.home()/".gstack-extend/quota/quota.sqlite3"
        if db.exists():
            with sqlite3.connect(db.as_uri() + "?mode=ro", uri=True) as conn:
                rows = list(conn.execute("SELECT kind,key,value,updated FROM documents ORDER BY kind,key"))
            result["quota"] = dict(rows=len(rows), sha256=hashlib.sha256(json.dumps(rows).encode()).hexdigest())
        else:
            result["quota"] = None
        return result
    token = re.sub(r"[^a-zA-Z0-9]+", "-", str(Path(clone).resolve())).strip("-")
    transcript_root = Path.home()/".cursor/projects"/token/"agent-transcripts"
    def transcripts():
        return [p for p in transcript_root.rglob("*") if p.is_file() and p.suffix in {".jsonl", ".txt"}]
    before = [git("rev-parse", "HEAD"), git("rev-parse", "HEAD^{tree}")]
    if before[0] != pin or git("status", "--porcelain"):
        raise RuntimeError("author pin/cleanliness check failed")
    tier_command = [Path(gstack_bin)/"gstack-config", "get", "telemetry"]
    def tier(name, run_env):
        if capture(name, tier_command, run_env) != "exit-0":
            return None
        return (destination/(name + ".log")).read_text().strip()
    live_tier, isolated_tier = tier("tier-live-before", live_env), tier("tier-before", env)
    if live_tier != "off" or isolated_tier != "off":
        raise RuntimeError("this off-tier recipe requires both verified telemetry=off settings")
    before_sinks, existing = sinks(), set(transcripts())
    session = "independence-" + str(uuid.uuid4())
    quota = [Path(extend_bin)/"gstack-extend", "quota"]
    prompt = ("Run skill review (gstack-review directory) against main, report only, every phase "
              "including the outside Codex and in-host adversarial passes. Do not edit, commit, "
              "or apply fixes. Do not change configuration or detach child processes. "
              "If asked a choice, continue read-only. This is a 200+ line diff.")
    result = dict(status="not-started", phase_status=phase_status, model_assignment="grok-4.7",
                  env_names=sorted(env), telemetry_tier_before=isolated_tier,
                  live_tier_before=live_tier, live_sinks_before=before_sinks,
                  phase_receipts="pending-source-chain-verification", consumption="see-private-quota-runs")
    begin = end = clock = None
    try:
        capture("telemetry-start", [Path(extend_bin)/"gstack-extend-telemetry", "start", "--skill", "extend:independence-probe"])
        capture("quota-start", quota + ["sample", "--session-id", session, "--phase", "start", "--stage", "review",
                                         "--agent", "cursor", "--route", "cli", "--auth", "subscription",
                                         "--cwd", str(clone), "--repo-root", str(clone), "--json"], quota_env)
        begin, clock = time.time(), time.monotonic()
        result["status"] = capture("review", ["cursor-agent", "-p", "--force", "--trust", "--sandbox", "disabled",
                                             "--model", "grok-4.7", prompt], timeout=1200)
        end = time.time()
        result.update(start=begin, end=end, elapsed_s=time.monotonic() - clock)
        candidates = [p for p in transcripts() if p not in existing and
                      getattr(p.stat(), "st_birthtime", 0) >= begin and p.stat().st_mtime <= end]
        relative = [p.relative_to(transcript_root) for p in candidates]
        sessions = {p.parts[0] if len(p.parts) > 1 else p.stem for p in relative}
        if len(sessions) == 1:
            capture("quota-attach", quota + ["sample", "--session-id", session, "--phase", "attach",
                                             "--agent", "cursor", "--harness-session", sessions.pop(), "--json"], quota_env)
    except Exception as error:
        result["capture_error"] = type(error).__name__
        result["status"] = "capture-error"
    finally:
        # Each capture retains its own failure; one failed finish must not skip the others.
        capture("quota-finish", quota + ["sample", "--session-id", session, "--phase", "finish", "--json"], quota_env)
        capture("quota-runs", quota + ["runs", "--session-id", session, "--json"], quota_env)
        capture("telemetry-finish", [Path(extend_bin)/"gstack-extend-telemetry", "finish", "--skill",
                                     "extend:independence-probe", "--outcome", "success" if result["status"] == "exit-0" else "error"])
        result["isolation_unchanged"] = False
        try:
            live_after, isolated_after = tier("tier-live-after", live_env), tier("tier-after", env)
            after_sinks = sinks()
            result.update(telemetry_tier_after=isolated_after, live_tier_after=live_after,
                          live_sinks_after=after_sinks,
                          isolation_unchanged=(before_sinks == after_sinks and live_after == isolated_after == "off"),
                          unchanged=before == [git("rev-parse", "HEAD"), git("rev-parse", "HEAD^{tree}")],
                          clean=not bool(git("status", "--porcelain")))
        except Exception as error:
            result["verification_error"] = type(error).__name__
        result["capture_complete"] = (result["status"] == "exit-0" and result["isolation_unchanged"] and
                                      result.get("unchanged") is True and result.get("clean") is True and
                                      all(status == "exit-0" for status in phase_status.values()))
        (destination/"attempt.json").write_text(json.dumps(result, indent=2))
    return result
```

The recipe takes an existing reviewed author branch and its full pin, fresh clone and artifact paths, and the installed `bin` directories. It never reconstructs missing original authoring scripts. State isolation depends on both `GSTACK_HOME`/`GSTACK_STATE_DIR` for gstack and `GSTACK_EXTEND_STATE_DIR` for extend; HOME remains unchanged. Extend provenance is separately gated by its own `provenance` setting (default on in the fresh isolated state), not gstack's telemetry tier. The only credential passed goes to quota subprocesses. This recipe checks the original and isolated `off` tiers before and after execution without changing either setting. Endpoint checks cannot prove that no temporary setting change occurred mid-run; inspect configuration changes before accepting isolation. Expected changes to all three live sinks are zero. Higher-tier capture requires a separately reviewed sink/upload policy; off disables analytics upload by configuration, which is not a packet-capture observation. Any sink change invalidates isolation; unrelated concurrent activity must be investigated rather than attributed automatically to this probe.

The timeout terminates and waits for the subprocess group before final sampling. Detached descendants escape this mechanism: detachment or unverified cleanup invalidates the attempt. Each phase records errors, and finish steps still run after ordinary launch/capture failures; an unwritable artifact directory or forcibly terminated Python supervisor can still prevent receipt persistence. `capture_complete` describes capture mechanics only, never a proven review. Missing local rows remain missing evidence. Inspect `quota-runs.log` for complete consumption; a missing credential is not zero spend. After end + five minutes, run the inline billing projection twice to assess model proof. Capture each dispatched phase's artifact/session/result/gate records with the receipt schema below before treating the run as valid. The recipe alone cannot diagnose availability: a separately authorized equivalent execution control must reproduce the same failure outside the probe environment. It does not automatically retry or spend a control-run budget. This future recipe has been checked offline, not live-executed in this correction.

Native Conductor is optional and user-run. The prepared prompt is: “Open the scratch repository on author-anthropic. Run review against main, report only, every phase including Codex and in-host adversarial. Do not edit, commit, or apply fixes.” Recover the agent ID by a unique store cwd/window afterward. It was not run here.

### Reference evaluator

```python
# review-independence-evaluator
import copy
import json
import re
import sys
from pathlib import Path

PATTERNS = (
    (r"claude|opus|sonnet|haiku|fable", "anthropic"),
    (r"gpt-|o[1-9]", "openai"),
    (r"grok-", "xai"),
    (r"composer-|vega", "cursor"),
)
REASONS = (
    "outside-same-vendor", "outside-missing", "voice-vendor-unproven",
    "voice-vendor-unmapped", "voice-vendor-undisclosed",
    "primary-vendor-unproven", "author-vendor-unproven", "config-unsatisfiable",
)
KINDS = {"outside", "in-host adversarial", "specialist", "external bot"}
EXTERNAL = {"outside", "external bot"}


def model_vendor(model):
    if not isinstance(model, str):
        return None
    here = Path.cwd()
    for base in (here, *here.parents):
        candidate = base / "bin/lib/quota/common.py"
        if candidate.is_file():
            sys.path.insert(0, str(candidate.parents[1]))
            from quota.common import model_vendor as live
            return live(model)
    return next((vendor for pattern, vendor in PATTERNS
                 if re.match(pattern, model, re.I)), None)


def vendors_of(evidence):
    if not isinstance(evidence, dict):
        return None, "not-recorded"
    # These are normalized evidence records, not arbitrary --model assignments.
    if evidence.get("cause"):
        return None, evidence["cause"]
    if evidence.get("proof") not in {"served", "requested-only"}:
        return None, "not-recorded"
    if evidence.get("complete") is not True:
        return None, "partial-coverage"
    if evidence.get("contradicted") is True:
        return None, "requested-only-contradicted"
    models = evidence.get("models")
    if not isinstance(models, list) or not models:
        return None, "not-recorded"
    found = set()
    for model in models:
        if not isinstance(model, str) or not model:
            return None, "not-recorded"
        if model.lower() == "auto" or model.lower().endswith("/auto"):
            return None, "alias"
        vendor = model_vendor(model)
        if vendor is None:
            return None, "voice-vendor-unmapped"
        found.add(vendor)
    # Cursor billing's predicate requires one vendor. Other fully covered
    # transcripts may prove a set; every member must be independent.
    if evidence.get("source") == "cursor-billing" and len(found) != 1:
        return None, "multi-model"
    return found, None


def evaluate(review):
    if not review.get("branch"):
        return {"cell": False, "cause": "no-slug-mapping"}
    reasons, causes, observations, provenance_causes = [], [], [], []
    writers = review.get("writers", "recorded-only")
    if writers not in {"recorded-only", "complete"}:
        raise ValueError("invalid writer coverage")
    author_set, required_proofs = set(), []
    authors = review.get("authors")
    author_bad = not isinstance(authors, list) or not authors
    if author_bad:
        causes.append("unrecorded-writer" if authors == [] else "not-recorded")
        provenance_causes.append(causes[-1])
    for author in authors if isinstance(authors, list) else []:
        vendors, cause = vendors_of(author)
        if not vendors or "cursor" in vendors:
            author_bad = True
            causes.append("not-recorded" if cause == "voice-vendor-unmapped" else cause or "not-recorded")
            if cause == "voice-vendor-unmapped":
                reasons.append(cause)
            else:
                provenance_causes.append(causes[-1])
        else:
            author_set.update(vendors)
            required_proofs.append(author["proof"])
    if review.get("author_cause"):
        author_bad = True
        causes.append(review["author_cause"])
        provenance_causes.append(causes[-1])
    if author_bad:
        reasons.append("author-vendor-unproven")
    primary, cause = vendors_of(review.get("primary"))
    primary_bad = not primary or "cursor" in primary
    if primary_bad:
        reasons.append("primary-vendor-unproven")
        causes.append("not-recorded" if cause == "voice-vendor-unmapped" else cause or "not-recorded")
        if cause == "voice-vendor-unmapped":
            reasons.append(cause)
        else:
            provenance_causes.append(causes[-1])
    else:
        required_proofs.append(review["primary"]["proof"])
    primary = primary or set()
    independent_proofs = []
    outside_consumed = False
    for voice in review.get("voices", []):
        kind = voice.get("kind")
        if kind not in KINDS:
            raise ValueError("unknown counted voice kind")
        consumed = voice.get("consumed") is True
        vendors, cause = vendors_of(voice)
        if review.get("chain_verified") is not True:
            vendors, cause = None, "not-recorded"
        same = bool(vendors & (author_set | primary)) if vendors else None
        diagnostics = []
        if vendors is None:
            diagnostics.append("voice-vendor-unmapped" if cause == "voice-vendor-unmapped"
                               else "voice-vendor-unproven")
        elif "cursor" in vendors:
            diagnostics.append("voice-vendor-undisclosed")
        if same and kind in EXTERNAL:
            diagnostics.append("outside-same-vendor")
        observations.append(dict(kind=kind, vendor=sorted(vendors) if vendors else None,
                                 proof=voice.get("proof"), same_vendor=same,
                                 consumed=consumed, reasons=diagnostics,
                                 cause="not-recorded" if cause == "voice-vendor-unmapped" else cause,
                                 source_error=voice.get("source_error")))
        if not consumed:
            continue
        outside_consumed |= kind in EXTERNAL
        reasons.extend(diagnostics)
        if cause:
            causes.append("not-recorded" if cause == "voice-vendor-unmapped" else cause)
            if "voice-vendor-unproven" in diagnostics:
                provenance_causes.append(cause)
        if vendors and "cursor" not in vendors and not same:
            independent_proofs.append(voice["proof"])
    if not outside_consumed:
        reasons.append("outside-missing")
        if review.get("outside_cause"):
            causes.append(review["outside_cause"])
    if review.get("config_unsatisfiable"):
        reasons.append("config-unsatisfiable")
    passed = bool(independent_proofs) and not author_bad and not primary_bad
    if passed and review.get("config_unsatisfiable"):
        raise ValueError("observed independent voice contradicts static configuration")
    result = dict(cell=True, verdict="PASS" if passed else "FAIL", writers=writers,
                  observations=observations)
    if passed:
        # A fully served eligible witness suffices; unrelated voices do not veto it.
        witness = "served" if "served" in independent_proofs else "requested-only"
        proof = "requested-only" if "requested-only" in required_proofs + [witness] else "served"
        return dict(result, reasons=[], causes=[], provenance_causes=[], evidence=proof)
    return dict(result, reasons=[code for code in REASONS if code in reasons],
                causes=list(dict.fromkeys(causes)),
                provenance_causes=list(dict.fromkeys(provenance_causes)))


def evidence(model, proof="served", **extra):
    return dict(models=[model], proof=proof, complete=True, **extra)


BASE = dict(branch="sample", authors=[evidence("claude-opus-5")],
            primary=evidence("claude-opus-5"), writers="recorded-only", chain_verified=True,
            voices=[dict(evidence("gpt-6-astra"), kind="outside", consumed=True)])


def samples():
    cases = {"pass-served": copy.deepcopy(BASE)}
    for name in ("outside-same-vendor", "voice-vendor-unproven", "supplied-model",
                 "mixed-unmapped", "missing-proof", "invalid-author", "requested-only",
                 "independent-specialist", "unproven-cursor", "empty-branch"):
        cases[name] = copy.deepcopy(BASE)
    cases["outside-same-vendor"]["authors"] = [evidence("gpt-6-astra")]
    cases["outside-same-vendor"]["primary"] = evidence("grok-4.7")
    cases["voice-vendor-unproven"]["voices"][0]["cause"] = "no-turn-bounds"
    cases["supplied-model"]["voices"][0]["proof"] = "supplied"
    cases["mixed-unmapped"]["voices"][0]["models"].append("unmapped-model")
    del cases["missing-proof"]["voices"][0]["proof"]
    cases["invalid-author"]["authors"] = ["unknown"]
    cases["requested-only"]["primary"]["proof"] = "requested-only"
    cases["independent-specialist"] = copy.deepcopy(cases["outside-same-vendor"])
    cases["independent-specialist"]["voices"].append(
        dict(evidence("claude-opus-5"), kind="specialist", consumed=True))
    cases["unproven-cursor"]["voices"][0].update(models=["composer-2"], cause="no-turn-bounds")
    cases["empty-branch"]["branch"] = ""
    return cases


def emit(result, name):
    if not result["cell"]:
        print("SAMPLE %s not-a-cell cause=%s" % (name, result["cause"]))
        return
    print("SAMPLE %s verdict=%s reasons=%s causes=%s evidence=%s writers=%s" % (
        name, result["verdict"], ",".join(result["reasons"]) or "(none)",
        ",".join(result["causes"]) or "(none)", result.get("evidence", "unproven"), result["writers"]))
    for voice in result["observations"]:
        print("VOICE kind=%s vendor=%s proof=%s same=%s consumed=%s reasons=%s cause=%s" % (
            voice["kind"], ",".join(voice["vendor"] or []) or "unproven", voice["proof"],
            voice["same_vendor"], voice["consumed"], ",".join(voice["reasons"]) or "(none)",
            voice["cause"] or "(none)"))


if __name__ == "__main__":
    for name, review in samples().items():
        emit(evaluate(review), name)
```

### Static answer and decision-rule calculation

```python
# review-independence-tables
# Execute after the evaluator block, or copy both blocks into one file.
CONFIGS = [
    ("cursor-cli", "xai", {"openai"}, "no"),
    ("cursor-cli", "xai", {"anthropic"}, "no"),
    ("conductor-native", "xai", {"anthropic"}, "requested-only-primary"),
    ("conductor-native", "xai", {"openai"}, "no"),
    ("claude", "anthropic", {"anthropic"}, "when-logs-exist"),
    ("claude", "anthropic", {"openai"}, "when-logs-exist"),
    ("codex", "openai", {"anthropic"}, "when-logs-exist"),
    ("codex", "openai", {"openai"}, "when-logs-exist"),
]


def satisfiable(route, primary, authors, extra_vendors=()):
    outside = "anthropic" if route == "codex" else "openai"
    return bool(({outside} | set(extra_vendors)) - ({primary} | set(authors) | {"cursor"}))


def calls(configurations, measured, coverage_complete=False):
    # IDs include entry point, route, primary set, author set, and dispatch gates.
    active = [c for c in configurations if c["in_use"] and not c.get("historical")]
    active_ids = {c["id"] for c in active}
    rows = [r for r in measured if r["config"] in active_ids]
    covered = {r["config"] for r in rows if r["result"]["verdict"] == "PASS"}
    served = {r["config"] for r in rows if r["result"]["verdict"] == "PASS" and r["result"].get("evidence") == "served"}
    all_pass = bool(active_ids) and coverage_complete and active_ids <= covered
    all_served = bool(active_ids) and coverage_complete and active_ids <= served
    reasons = [r["result"]["reasons"] for r in rows]
    routing_go = any(c["unsatisfiable"] for c in active) or any("outside-same-vendor" in r for r in reasons)
    structural = {"voice-vendor-unproven", "primary-vendor-unproven", "author-vendor-unproven"}
    structural_causes = {"window-ambiguous", "partial-coverage", "multi-model",
                         "requested-only-contradicted", "alias", "no-turn-bounds",
                         "unrecorded-writer", "not-recorded", "timeout", "auth-rejected",
                         "rate-limited", "sandbox-refused", "unsupported-version", "schema-changed"}
    provenance_go = any(r["result"]["verdict"] == "FAIL" and
                        structural.intersection(r["result"]["reasons"]) and
                        structural_causes.intersection(r["result"].get("provenance_causes", [])) for r in rows)
    availability_go = any(r["result"]["verdict"] == "FAIL" and
                          "outside-missing" in r["result"]["reasons"] and
                          (r.get("availability_route_cause") not in {None, "probe-induced"} or
                           r.get("reproduced_outside_probe") is True) for r in rows)
    result = dict(routing="go" if routing_go else "no-go" if all_pass else "insufficient-evidence",
                  provenance="go" if provenance_go else "no-go" if all_served else "insufficient-evidence",
                  availability="go" if availability_go else "no-go" if all_pass else "insufficient-evidence")
    result["priority-c"] = {"go": "P1", "no-go": "P3", "insufficient-evidence": "P2"}[result["provenance"]]
    return result


def table_report():
    print("TABLE answer entry=/review gates=outside-ready,no-proven-extra-vendor")
    for route, primary, authors, proof in CONFIGS:
        possible = satisfiable(route, primary, authors)
        print("route=%s primary=%s authors={%s} verdict=%s reasons=%s provable-today=%s label=derived" % (
            route, primary, ",".join(sorted(authors)), "UNMEASURED" if possible else "FAIL",
            "(none)" if possible else "config-unsatisfiable", proof))
    print("TABLE calls")
    # No complete observed configuration or proven review chain was frozen.
    # A route's existence alone does not supply its primary/author/gate tuple.
    result = calls([], [], coverage_complete=False)
    for key in ("routing", "provenance", "availability", "priority-c"):
        print("%s=%s" % (key, result[key]))


if __name__ == "__main__":
    table_report()
```

### Historical projection and metadata join

This script opens the Conductor database read-only, reads existing local logs, and emits only a fixed projection. It never starts a model, calls billing, or modifies a repository. `receipts: []` makes the missing execution-chain evidence explicit. The report does not turn these metadata candidates into measured verdicts. A malformed record is retained as an input error, not silently treated as absence. Non-implement fix stages need independent content-change evidence and remain an author-coverage limitation.

```python
# review-independence-project
import hashlib
import json
import math
import re
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote


def stamp(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and math.isfinite(value):
        return value / 1000 if abs(value) > 100000000000 else value
    try:
        # Harness timestamps may have nanoseconds; normalize for Python 3.9+.
        text = re.sub(r"(\.\d{6})\d+", r"\1", str(value).replace("Z", "+00:00"))
        parsed = datetime.fromisoformat(text)
        return parsed.timestamp() if parsed.tzinfo is not None else None
    except (ValueError, TypeError, OverflowError, OSError):
        return None


def digest(value):
    return hashlib.sha256(str(value).encode()).hexdigest()


def branch_token(raw):
    return re.sub(r"[^a-zA-Z0-9._-]", "", raw.replace("/", "-"))


def slug(remote):
    match = re.search(r"[:/]([^/:]+/[^/]+)$", str(remote).removesuffix(".git"))
    return match[1].replace("/", "-") if match else None


def records(path, errors):
    try:
        with path.open() as stream:
            for line in stream:
                if not line.strip():
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    errors.append(dict(source=digest(path), cause="schema-changed"))
                    continue
                if isinstance(row, dict):
                    yield row
                else:
                    errors.append(dict(source=digest(path), cause="schema-changed"))
    except OSError:
        errors.append(dict(source=digest(path), cause="not-recorded"))


def project(home, cutoff):
    errors, workspaces, writers, reviews, native, grok, cursor_cli = [], [], [], [], [], [], []
    def malformed(source):
        errors.append(dict(source=digest(source), cause="schema-changed"))
    roots = {}
    db = home / "Library/Application Support/com.conductor.app/conductor.db"
    with sqlite3.connect(db.as_uri() + "?mode=ro", uri=True) as conn:
        query = """SELECT r.remote_url, r.root_path, w.branch, w.workspace_path,
                   w.state, w.created_at FROM workspaces w
                   JOIN repos r ON r.id=w.repository_id"""
        for remote, root, branch, cwd, state, created in conn.execute(query):
            created_at = stamp(created)
            if created_at is None or not isinstance(branch, str) or not isinstance(cwd, str):
                malformed(db)
                continue
            if not branch or not cwd or created_at > cutoff:
                continue
            project_slug = slug(remote)
            if not project_slug:
                continue
            repo = digest(project_slug)
            roots[repo] = root
            workspaces.append(dict(repo=repo, branch=digest(branch), token=digest(branch_token(branch)),
                                   cwd=digest(cwd), cursor_path=digest(re.sub(r"[^a-zA-Z0-9]+", "-", cwd).strip("-")), archived=state == "archived"))
    # Local worktrees supplement absent workspace mappings. Never create/rename them.
    for repo, root in roots.items():
        if not root or not Path(root).is_dir():
            continue
        result = subprocess.run(["git", "-C", root, "worktree", "list", "--porcelain"],
                                capture_output=True, text=True, timeout=20)
        cwd = None
        for line in result.stdout.splitlines():
            if line.startswith("worktree "):
                cwd = line[9:]
            elif line.startswith("branch refs/heads/") and cwd:
                raw = line.removeprefix("branch refs/heads/")
                item = dict(repo=repo, branch=digest(raw), token=digest(branch_token(raw)),
                            cwd=digest(cwd), cursor_path=digest(re.sub(r"[^a-zA-Z0-9]+", "-", cwd).strip("-")), archived=False)
                if not any(w["repo"] == repo and w["branch"] == item["branch"] for w in workspaces):
                    workspaces.append(item)
    for row in records(home / ".gstack-extend/analytics/stage-runs.jsonl", errors):
        begin = stamp(row.get("started_at"))
        duration = row.get("duration_s")
        duration = 0 if duration is None else duration
        if (begin is None or isinstance(duration, bool) or not isinstance(duration, (int, float)) or
            not math.isfinite(duration) or duration < 0 or not isinstance(row.get("branch", ""), str)):
            malformed("stage-runs")
            continue
        if begin + duration > cutoff:
            continue
        if row.get("stage") != "implement":
            continue  # Fix-only stages need explicit content-change evidence, not a name guess.
        raw = row.get("branch") or ""
        writers.append(dict(repo=digest(str(row.get("repo", "")).replace("/", "-")),
                            branch=digest(raw), token=digest(branch_token(raw)), start=begin,
                            end=begin + duration, agent=row.get("agent"),
                            model_assignment=row.get("model"), session=digest(row.get("session_id"))))
    for path in (home / ".grok/sessions").glob("*/*/events.jsonl"):
        times = [stamp(r.get("ts")) for r in records(path, errors)]
        for invalid in (t for t in times if t is None):
            malformed(path)
        times = [t for t in times if t is not None and t < cutoff]
        if times:
            grok.append(dict(cwd=digest(unquote(path.parent.parent.name)),
                             start=min(times), end=max(times), session=digest(path.parent.name)))
    for agents in (home / "Library/Application Support/com.conductor.app/cursor-sdk-store").glob("*/agents.ndjson"):
        cwds = {}
        for row in records(agents, errors):
            if not all(isinstance(row.get(k), str) and row[k] for k in ("agentId", "cwd")):
                malformed(agents)
                continue
            cwds[row["agentId"]] = row["cwd"]
        for row in records(agents.with_name("runs.ndjson"), errors):
            begin, end = stamp(row.get("startedAt")), stamp(row.get("endedAt"))
            model = row.get("model")
            if (begin is None or (row.get("endedAt") is not None and (end is None or end < begin)) or
                not isinstance(model, dict) or not isinstance(model.get("id"), str) or
                not isinstance(row.get("agentId"), str)):
                malformed(agents.with_name("runs.ndjson"))
                continue
            if begin >= cutoff:
                continue
            cwd = cwds.get(row.get("agentId"))
            if cwd:
                native.append(dict(cwd=digest(cwd), start=begin, end=end,
                                   session=digest(row.get("agentId")), model=model.get("id")))
    # Cursor transcript content has no reliable timestamps/model fields here.
    # Filesystem birth/mtime supply candidates only, never execution proof.
    for directory in (home / ".cursor/projects").glob("*/agent-transcripts"):
        for path in directory.rglob("*"):
            if not path.is_file() or path.suffix not in {".jsonl", ".txt"}:
                continue
            stat = path.stat()
            begin, end = getattr(stat, "st_birthtime", None), stat.st_mtime
            if begin is None or end >= cutoff:
                continue  # A later-modified file cannot recover its old activity window.
            relative = path.relative_to(directory)
            session = relative.parts[0] if len(relative.parts) > 1 else path.stem
            cursor_cli.append(dict(path_token=digest(directory.parent.name), session=digest(session),
                                   start=begin, end=end, source=digest(path)))
    for path in (home / ".gstack/projects").glob("*/*-reviews.jsonl"):
        if path.parent.name == "scratch":
            continue
        project_slug = path.parent.name
        repo = digest(project_slug)
        token = path.name.removesuffix("-reviews.jsonl")
        for index, row in enumerate(records(path, errors)):
            end = stamp(row.get("timestamp"))
            binding = row.get("review_binding")
            binding = {} if binding is None else binding
            if end is None or not isinstance(binding, dict):
                malformed(path)
                continue
            if not cutoff - 30 * 86400 <= end < cutoff:
                continue
            begin = stamp(binding.get("started_at"))
            if binding.get("started_at") is not None and begin is None:
                malformed(path)
                continue
            commit = row.get("commit_full")
            commit_time = None
            if repo in roots and roots[repo] and re.fullmatch(r"[0-9a-f]{40,64}", str(commit)):
                result = subprocess.run(["git", "-C", roots[repo], "show", "-s", "--format=%ct", commit],
                                        capture_output=True, text=True, timeout=20)
                if result.returncode == 0:
                    commit_time = float(result.stdout.strip())
            reviews.append(dict(id=digest(str(path) + ":" + str(index)), repo=repo,
                                token=digest(token) if token else None,
                                branch=binding.get("branch_id"), commit=commit, commit_time=commit_time,
                                tree=row.get("wtree") or row.get("tree"), start=begin, end=end,
                                host=row.get("host"), skill=row.get("skill"), source=row.get("source"),
                                status=row.get("status"), completed=row.get("completed"),
                                outside_status=row.get("outside_status")))
    return dict(schema=1, cutoff=cutoff, projected_at=datetime.now(timezone.utc).isoformat(),
                reviews=reviews, workspaces=workspaces, writers=writers, native=native,
                grok=grok, cursor_cli=cursor_cli, errors=errors, receipts=[])


def join(snapshot):
    selected = []
    for row in snapshot["reviews"]:
        candidates = [w for w in snapshot["workspaces"] if w["repo"] == row["repo"] and
                      (w["branch"] == row["branch"] if row["branch"] else w["token"] == row["token"])]
        # A token is lossy. More than one branch or cwd is ambiguous, never pick first.
        unique = {(w["branch"], w["cwd"]) for w in candidates}
        workspace = candidates[0] if len(unique) == 1 else None
        resolved_branch = row["branch"] or (workspace["branch"] if workspace else None)
        authors = [w for w in snapshot["writers"] if w["repo"] == row["repo"] and
                   resolved_branch is not None and w["branch"] == resolved_branch and
                   row["commit_time"] is not None and w["start"] < row["commit_time"]]
        historical_grok = bool(workspace and row["host"] == "claude" and
                               row["start"] is not None and
                               any(g["cwd"] == workspace["cwd"] and g["start"] <= row["end"] and
                                   g["end"] >= row["start"] for g in snapshot["grok"]))
        if row["host"] not in {"cursor", "grok"} and not authors and not historical_grok:
            continue
        cause = "not-recorded"
        if not row["token"]:
            cause = "no-slug-mapping"
        elif workspace is None:
            cause = "window-ambiguous" if unique else "no-cwd-match"
        route = row["host"]
        runs, cli = [], []
        if workspace and row["start"] is not None:
            runs = [r for r in snapshot["native"] if r["cwd"] == workspace["cwd"] and
                    r["start"] <= row["end"] and (r["end"] is None or r["end"] >= row["start"])]
            if row["host"] == "cursor":
                cli = [r for r in snapshot.get("cursor_cli", []) if
                       r["path_token"] == workspace.get("cursor_path") and
                       r["start"] <= row["end"] and r["end"] >= row["start"]]
                # A path token may itself collide across distinct workspace cwds.
                path_unique = len({w["cwd"] for w in snapshot["workspaces"] if
                                  w.get("cursor_path") == workspace.get("cursor_path")}) == 1
                route = ("conductor-native" if runs and len({r["session"] for r in runs}) == 1 else "cursor-cli" if
                         not runs and path_unique and len({r["session"] for r in cli}) == 1 else "unknown")
        if row["host"] == "grok" or historical_grok:
            route = "historical-grok"
        # Window/branch matches are candidates, not artifact→session→gate proof.
        selected.append(dict(row=row["id"], host=row["host"], route=route,
                             workspace_match=workspace is not None, writer_candidates=len(authors),
                             native_candidates=len(runs), cli_candidates=len(cli), historical_grok=historical_grok,
                             verdict=None, cause=cause))
    return selected


def report(snapshot):
    rows = join(snapshot)
    cursor = [r for r in rows if r["host"] == "cursor"]
    print("TABLE reconstructed-metadata")
    print("cursor-rows=%d workspace-matches=%d" % (len(cursor), sum(r["workspace_match"] for r in cursor)))
    print("grok-rows=%d" % sum(r["host"] == "grok" for r in rows))
    print("host-claude-grok-overlap-rows=%d" % sum(r["historical_grok"] for r in rows))
    print("rows-with-writer-candidates=%d" % sum(r["writer_candidates"] > 0 for r in rows))
    print("measured-review-verdicts=unavailable cause=not-recorded")
    print("projection-errors=%d" % len(snapshot["errors"]))


if __name__ == "__main__":
    if sys.argv[1:] == ["--project"]:
        print(json.dumps(project(Path.home(), stamp("2026-09-25T12:21:00Z")), sort_keys=True))
    else:
        report(json.loads(Path(sys.argv[1]).read_text()))
```

### Execution-chain receipt normalization

The historical projection has no execution-chain receipts. This separate input schema makes the remaining join executable without fabricating them. `artifacts` identify repo/raw-branch, exact commit/tree, commit time, and reviewed paths. `executions` link a source session and its fully covered contributing models to the reviewed artifact and review invocation; this invocation link is created by checking source references, not by relabeling a writer's original invocation. `writers` link a checked content diff to that artifact, including fix passes. `phase_rows`, `results`, and `gates` bind each execution to the consumed result. Every `source_ref` and `content_diff_ref` is a private citation to an inspected source record, never text supplied by the model under review. The projection boundary must verify those citations and coverage. This is an offline join contract, not an authentication layer for arbitrary JSON.

Different phase start tokens require explicit parent-invocation links. Matching timestamps, model names, or commits cannot create them. Group once by the verified invocation ID and exact artifact, then pass the normalized record to `evaluate()`. Absent/duplicate/mismatched links cannot produce PASS. The synthetic example proves the algorithm only; it is not a measured review.

<!-- expected:receipts -->
```text
CHAIN complete verdict=PASS
CHAIN missing-gate verdict=FAIL
CHAIN mismatched-artifact cell=False
```

```python
# review-independence-receipts
# Execute after the evaluator. Inputs are projections from inspected source
# records, not caller-assigned model names or unverified flags.
def normalize(invocation, snapshot):
    def unique(rows, **keys):
        if any(v is None or v == "" for v in keys.values()):
            return None
        matches = [r for r in rows if all(r.get(k) == v for k, v in keys.items())]
        return matches[0] if len(matches) == 1 else None
    def missing():
        return dict(cause="not-recorded")
    artifact = unique(snapshot.get("artifacts", []), id=invocation.get("artifact"))
    required = ("repo", "branch", "commit", "tree")
    if not artifact or any(not artifact.get(k) or artifact[k] != invocation.get(k) for k in required):
        return None  # No artifact/branch cell can be established.
    if not invocation.get("id") or not invocation.get("primary_session"):
        return None
    def execution(session, start, end):
        entry = unique(snapshot.get("executions", []), session=session,
                       artifact=artifact["id"], invocation=invocation["id"])
        if not entry or not entry.get("source_ref") or not start <= end:
            return missing()
        if entry.get("cause"):
            return {k: entry[k] for k in ("cause", "source_error") if k in entry}
        if entry.get("start", float("inf")) > start or entry.get("end", 0) < end:
            return dict(cause="partial-coverage")
        proof = entry.get("proof")
        if proof not in {"served", "requested-only"}:
            return missing()
        return {k: entry[k] for k in ("models", "proof", "complete", "source", "contradicted") if k in entry}
    start, end = invocation["start"], invocation["end"]
    result = dict(branch=artifact["branch"], writers=snapshot.get("writer_coverage", "recorded-only"),
                  primary=execution(invocation["primary_session"], start, end), authors=[], voices=[],
                  chain_verified=True)
    # Writers come from source content-change records, including review fixes.
    # Each change receipt is linked to this artifact by a checked content diff.
    for writer in snapshot.get("writers", []):
        if writer.get("artifact") != artifact["id"]:
            continue
        linked = (writer.get("source_ref") and writer.get("content_diff_ref") and
                  writer.get("repo") == artifact["repo"] and writer.get("branch") == artifact["branch"] and
                  writer.get("start", float("inf")) < artifact["commit_time"] and
                  writer.get("start", float("inf")) <= writer.get("end", 0) and
                  bool(set(writer.get("changed_paths", [])) & set(artifact.get("paths", []))))
        result["authors"].append(execution(writer.get("session"), writer["start"], writer["end"])
                                 if linked else missing())
    if snapshot.get("known_unrecorded_writer"):
        result["author_cause"] = "unrecorded-writer"
    for row in snapshot.get("phase_rows", []):
        if row.get("invocation") != invocation["id"]:
            continue
        kind = row.get("kind")
        consumed = (row.get("status") in {"clean", "issues_found"} and
                    (row.get("outside_status") == "completed" if kind in EXTERNAL else row.get("completed") is True))
        voice = dict(kind=kind, consumed=consumed, **missing())
        binding = unique(snapshot.get("results", []), id=row.get("result"),
                         invocation=invocation["id"], artifact=artifact["id"], session=row.get("session"))
        gate = unique(snapshot.get("gates", []), invocation=invocation["id"],
                      artifact=artifact["id"], result=row.get("result"))
        if gate and gate.get("consumed") is False:
            voice["consumed"] = False
        within = start <= row.get("start", float("inf")) <= row.get("end", 0) <= end
        if (within and row.get("artifact") == artifact["id"] and row.get("source_ref") and
            binding and binding.get("source_ref") and gate and gate.get("source_ref") and
            gate.get("consumed") is True):
            voice = dict(kind=kind, consumed=consumed,
                         **execution(row.get("session"), row["start"], row["end"]))
        result["voices"].append(voice)
    return result


def receipt_samples():
    invocation = dict(id="invocation-1", artifact="artifact-1", repo="example", branch="feature",
                      commit="commit-a", tree="tree-a", primary_session="primary-1", start=30, end=40)
    artifact = dict(id="artifact-1", repo="example", branch="feature", commit="commit-a", tree="tree-a",
                    commit_time=20, paths=["src/example.py"])
    executions = [dict(session=session, artifact="artifact-1", invocation="invocation-1", start=start,
                       end=end, source_ref="synthetic-observed-record", **evidence(model))
                  for session, start, end, model in [("writer-1", 1, 10, "claude-opus-5"),
                                                     ("primary-1", 30, 40, "claude-opus-5"),
                                                     ("outside-1", 32, 39, "gpt-6-astra")]]
    snapshot = dict(artifacts=[artifact], executions=executions, writers=[dict(
        artifact="artifact-1", repo="example", branch="feature", session="writer-1", start=1, end=10,
        changed_paths=["src/example.py"], source_ref="synthetic-writer", content_diff_ref="synthetic-diff")],
        phase_rows=[dict(invocation="invocation-1", artifact="artifact-1", session="outside-1",
                         result="result-1", kind="outside", status="clean", outside_status="completed",
                         start=32, end=39, source_ref="synthetic-row")],
        results=[dict(id="result-1", invocation="invocation-1", artifact="artifact-1", session="outside-1",
                      source_ref="synthetic-result")],
        gates=[dict(invocation="invocation-1", artifact="artifact-1", result="result-1", consumed=True,
                    source_ref="synthetic-gate")])
    print("CHAIN complete verdict=" + evaluate(normalize(invocation, snapshot))["verdict"])
    snapshot["gates"] = []
    print("CHAIN missing-gate verdict=" + evaluate(normalize(invocation, snapshot))["verdict"])
    invocation["tree"] = "different-tree"
    print("CHAIN mismatched-artifact cell=" + str(normalize(invocation, snapshot) is not None))


if __name__ == "__main__":
    receipt_samples()
```

### Billing projection and proof predicate

This code defines the projection and matching logic; it was not exercised against live billing because the credential was absent. Import the evaluator first. Put the repository's `bin/lib` on Python's import path and create `quota.store.Store` under a new private snapshot directory, never the live quota store. Only that billing process may receive `CURSOR_API_KEY`. Invoke `billing_projection()` twice after end + five minutes, retaining its whitelisted output only. Record the provider's actual parent/child field semantics before trusting the adapter; absent `isSubagent` currently fails closed. Source errors retain both their original code and the mapped document cause.

Measure skew with a uniquely identified billing event corresponding to a local marker bracket [before, after]; tolerance is `max(abs(provider_timestamp - before), abs(provider_timestamp - after))`. Repeat for the end marker and use the larger bound. No unique marker means skew is unavailable and no cross-clock proof is accepted. Expanding a window must never silently choose between overlapping parent/child sessions.

```python
# review-independence-billing
# Import after the evaluator block; no network call occurs merely by defining these functions.
def billing_projection(store, deadline, start, end, session_id, skew):
    from quota.readers.cursor import events
    from quota.common import QuotaError, timestamp
    from hashlib import sha256
    from time import time
    left, right = start - skew, end + 600 + skew
    try:
        rows, complete, _ = events(store, deadline, left, right)
    except QuotaError as error:
        mapping = {"no_credentials": "no-credential", "auth_expired": "auth-rejected",
                   "http_401": "auth-rejected", "http_403": "auth-rejected",
                   "http_429": "rate-limited", "exchange_throttled": "rate-limited",
                   "timeout": "timeout", "sandboxed": "sandbox-refused",
                   "unsupported_version": "unsupported-version", "schema_changed": "schema-changed"}
        return dict(error=mapping.get(error.code, "not-recorded"), source_error=error.code)
    read_at = time()  # Observe completion here, never accept a caller-assigned settlement time.
    selected = []
    for row in rows:
        if row.get("conversationId") != session_id:
            continue
        # Only selected structural fields survive. Never retain owningUser or raw responses.
        selected.append(dict(model=row.get("model"), start=timestamp(row.get("turnStartedAt")),
                             end=timestamp(row.get("turnEndedAt")), timestamp=timestamp(row.get("timestamp")),
                             is_subagent=row.get("isSubagent")))
    selected.sort(key=lambda r: json.dumps(r, sort_keys=True))
    return dict(session=sha256(session_id.encode()).hexdigest(), left=left, right=right,
                read_at=read_at, complete=complete, events=selected)


def billing_proof(first, second, start, end, skew, subagent_window=None):
    # isSubagent is a required provider-supplied boolean for this adapter, not an
    # inferred label. Its presence was NOT observed in the original snapshot.
    # A future schema needs a verified adapter change if it uses a different field.
    for read in (first, second):
        if read.get("error"):
            return dict(cause=read["error"], source_error=read.get("source_error"))
        if read.get("complete") is not True or read.get("left", float("inf")) > start - skew or read.get("right", 0) < end + 600 + skew:
            return dict(cause="partial-coverage")
        if read.get("read_at", 0) < end + 300:
            return dict(cause="unsettled")
    if not first.get("session") or first["session"] != second.get("session"):
        return dict(cause="window-ambiguous")
    if second["read_at"] <= first["read_at"] or first.get("events") != second.get("events"):
        return dict(cause="unsettled")
    events = second.get("events") or []
    if not events:
        return dict(cause="not-recorded")
    if any(e.get("start") is None or e.get("end") is None for e in events):
        return dict(cause="no-turn-bounds")
    if any(e["start"] > e["end"] or not isinstance(e.get("is_subagent"), bool) for e in events):
        return dict(cause="schema-changed")
    parents = [e for e in events if not e["is_subagent"]]
    children = [e for e in events if e["is_subagent"]]
    if any(p["start"] - skew <= c["start"] and p["end"] + skew >= c["end"]
           for p in parents for c in children):
        return dict(cause="window-ambiguous")
    if subagent_window is None:
        selected = [e for e in parents if e["start"] >= start - skew and e["end"] <= end + skew]
    else:
        left, right = subagent_window
        selected = [e for e in children if e["start"] >= left - skew and e["end"] <= right + skew]
        if any(p["start"] <= right + skew and p["end"] >= left - skew for p in parents):
            return dict(cause="window-ambiguous")
    if not selected:
        return dict(cause="not-recorded")
    # Include every event in the session read when checking single-vendor evidence.
    proof = dict(models=[e.get("model") for e in events], proof="served", complete=True,
                 source="cursor-billing")
    _, cause = vendors_of(proof)
    return dict(cause=cause) if cause else proof
```

### Offline SDK reader reproduction

Use the retained isolated copy, not the live account store. The command sends no telemetry and makes no changes to the copied records:

```python
import json, os, subprocess, sys
from pathlib import Path
repo = Path.cwd()
fixture_home = Path.home()/".gstack/projects/kbitz-gstack-extend/independence-probe/e4-home"
agents = next(fixture_home.glob("Library/Application Support/com.conductor.app/cursor-sdk-store/*/agents.ndjson"))
agent = json.loads(agents.read_text().splitlines()[0])
env = {k: os.environ[k] for k in ("PATH", "LANG", "TMPDIR") if k in os.environ}
env.update(HOME=str(fixture_home), CURSOR_AGENT="1", CURSOR_CONVERSATION_ID=agent["agentId"], PYTHONDONTWRITEBYTECODE="1")
code = """import os, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from telemetry import cursor_sdk_runs, cursor_turns, parse_ts
matched = [r for r in cursor_sdk_runs(os.getcwd()) if r.get('agentId') == os.environ['CURSOR_CONVERSATION_ID']]
assert matched, 'fixture did not match cwd/session'
assert all(isinstance(r.get('updatedAt'), (int, float)) and isinstance(r.get('model', {}).get('params'), list) for r in matched)
print('integer timestamp', parse_ts(1790337600000))
print('turn count', len(cursor_turns(Path.cwd(), 0)))
"""
subprocess.run([sys.executable, "-c", code, str(repo/"bin/lib")], cwd=agent["cwd"], env=env, check=True)
```

Expected on the measured source: `integer timestamp None` and `turn count 0`. A missing retained fixture is missing evidence, not success. For a new offline reproduction, copy one matching agent/run to a disposable home, rewrite its cwd to the test directory, and use the same marker setup.

### Extract and replay

From the repository root, extract only the named committed blocks to a separate artifact directory. This does not execute the future live-attempt recipe:

```python
import pathlib, re
doc = pathlib.Path("docs/designs/review-independence.md").read_text()
dest = pathlib.Path.home()/".gstack/projects/kbitz-gstack-extend/review-and-prep/independence-replay"
dest.mkdir(parents=True, exist_ok=True)
for name in ("evaluator", "tables", "project", "billing", "receipts"):
    blocks = re.findall(r"```python\n(.*?)\n```", doc, re.S)
    matches = [b for b in blocks if b.startswith("# review-independence-" + name + "\n")]
    if len(matches) != 1:
        raise SystemExit("missing or duplicate block: " + name)
    (dest/(name + ".py")).write_text(matches[0] + "\n")
```

For a new read-only reconstruction, freeze before joining (this command reads current retained records, so future output may differ):

```text
python3 ~/.gstack/projects/kbitz-gstack-extend/review-and-prep/independence-replay/project.py --project > ~/.gstack/projects/kbitz-gstack-extend/review-and-prep/independence-replay/inputs.json
```

For the correction's deterministic replay, use the separately retained `cursor-independence-fixes/reconstructed-inputs-final.json` instead of re-projecting live stores. The following comparison preserves each block's identity and line order; executable source is never searched for expected output. Samples/static calculations work without the private projection. Supplying a snapshot adds the exact metadata comparison:

```python
import pathlib, re, subprocess, sys
doc = pathlib.Path("docs/designs/review-independence.md").read_text()
def code(name):
    matches = [b for b in re.findall(r"```python\n(.*?)\n```", doc, re.S)
               if b.startswith("# review-independence-" + name + "\n")]
    if len(matches) != 1:
        raise SystemExit("missing or duplicate source: " + name)
    return matches[0]
def check(name, actual):
    matches = re.findall(r"<!-- expected:" + name + r" -->\n```text\n(.*?)\n```", doc, re.S)
    if len(matches) != 1 or actual.rstrip("\n") != matches[0]:
        raise SystemExit("replay mismatch: " + name)
check("samples", subprocess.check_output([sys.executable, "-c", code("evaluator")], text=True))
check("static", subprocess.check_output([sys.executable, "-c", code("tables")], text=True))
receipt_program = "ns = {'__name__': 'reference'}\nexec(%r, ns)\nexec(%r, ns)\nns['receipt_samples']()" % (code("evaluator"), code("receipts"))
check("receipts", subprocess.check_output([sys.executable, "-c", receipt_program], text=True))
if len(sys.argv) > 1:
    check("metadata", subprocess.check_output([sys.executable, "-c", code("project"), sys.argv[1]], text=True))
print("replay-ok: samples, static, receipts" + (", frozen metadata" if len(sys.argv) > 1 else ""))
```

This replay verifies the computations against the displayed blocks. It does not authenticate the original aggregate counts, recover deleted logs, fill the missing execution-chain receipts, or certify billing fields never observed. Those limitations remain explicit inputs to the insufficient-evidence decision.

### Upstream issue text

The installed CHANGELOG at gstack 1.89.0.0 was searched for vendor-aware routing and per-voice model fields; no match was found.

```text
Title: Review rows need per-voice observed models and execution/result bindings

Problem: host, source and outside_provider record harness assignment, not the model that ran. Cursor can use a different vendor from its outside Codex CLI. Record every contributing model per voice and the artifact, invocation, result and consuming-gate links needed to verify it.

Measured shape at 2026-09-25 cutoff: 8 host-cursor rows and 10 host-grok rows lack model fields. SDK runs request grok-4.7; that is requested evidence, not billing proof. Corrected branch matching resolves all 8 Cursor workspace candidates; candidate windows still do not prove result consumption. Extend stage rows do not cover gstack review voices.

Proposed fields: execution/session identity, observed model IDs and their served/requested class, reviewed commit/tree, parent invocation, result identity and gate consumption. Preserve assignment fields separately. Use the raw branch hash or a reversible mapping, not equality between sanitized filenames and raw branches. Unknown evidence must remain unknown.
```
