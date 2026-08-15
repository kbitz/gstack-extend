# TODOS

## Unprocessed

v0.23 packer dogfood — file these as high priority on the next `/roadmap`.
Sources: Claude's first real-repo regen (Bolt, 2026-08-14, 60-track plan,
4 audit iterations) and Grok's gstack-extend regen (same day). Verdict to
preserve: packer is excellent as a validator and knowledge store, and
mis-aimed as a scheduler. Do not weaken SIZE / COLLISIONS / PACKING hard
gates, the proposal artifact, the drain-orphan check, or audit-after-apply.

### [manual] Packer should minimize dependency layers and fill to parallelism_cap
- **Why:** `pack.ts` emits collision-free bins under a track-count cap and never sees the critical path or real concurrency. Bolt got 22 waves averaging 3.3 tracks (user concurrency 4–6); the cutover critical path went from ~4 wave boundaries to ~9. Calendar time is (boundaries on the critical path) × land-and-relaunch, not track count. gstack-extend's first regen hit the same trap: two layer-0 bins totaling 9 ready tracks vs cap 6, with no legal move that satisfied both PACKING and PARALLELISM_BUDGET.
- **Hypothesis (untested):** merge adjacent thin layers when no collision or edge prevents it; bound bin width by `parallelism_cap`, not just `max_tracks_per_group`; print `longest chain: N waves through <ids>`.
- **Effort:** L
- **Priority:** P1
- **Context:** Bolt #1 + gstack-extend dogfood. `src/audit/lib/pack.ts`, `src/audit/pack-cli.ts`, `skills/roadmap.md`.

### [manual] Stop inheriting full-group deps as packer input
- **Why:** `tracksForPacker()` treats `_Depends on: Group N` as every track of N blocking every track of this group. Bolt Track 102A.2 (only real blocker: 102A.1 in wave 1) landed in wave 5 because the group's written deps pulled in waves 2–4 wholesale. This is the root of layer inflation. Track-level `_blocked-by:` + `_touches:` collisions already carry the truth.
- **Hypothesis (untested):** drop group-dep inheritance from packer input; derive group deps as output/validation only. If they must feed back, inherit only the specific bin-edge tracks, not the full cross product.
- **Effort:** M
- **Priority:** P1
- **Context:** Bolt #2. `src/audit/checks/packing.ts`.

### [manual] Make the packer converge internally and accept a draft
- **Why:** writing the `_Depends on:` lines the audit demanded changed packer input (via group-dep inheritance), which changed bins, which changed required deps. Bolt converged on iteration 2; the skill never mentions a loop. An agent that follows the skill literally writes groups from bins, fails PACKING, and does not know whether to iterate or escalate. Separately, `bin/roadmap-pack` only reads `ROADMAP.md`, so a regen cannot pack a draft without writing the live file first — gstack-extend had to call `packTracks()` from a scratch script.
- **Hypothesis (untested):** `roadmap-pack --materialize` iterates to a stable partition and emits final bins plus ready-to-paste `_Depends on:` lines per bin, in execution order. Accept `--stdin` or a proposal path so Step 2 does not have to overwrite ROADMAP.md to pack.
- **Effort:** M
- **Priority:** P1
- **Context:** Bolt #3 + gstack-extend dogfood (draft→packer chicken-and-egg). `src/audit/pack-cli.ts`, `src/audit/lib/pack.ts`, `skills/roadmap.md`.

### [manual] Require _blocked-by on every serialized chain
- **Why:** first Bolt pack with edges omitted (relying on prose + document order) scheduled the cutover Track in layer 0 and reversed the settings chain. Collisions only order tracks inside the same dependency layer; within a layer, placement is most-constrained-first, not document order. "Optional _blocked-by for a semantic dep" reads as a nice-to-have; Bolt needed 53 explicit edges.
- **Hypothesis (untested):** skill Step 2 says every serialized chain must have `_blocked-by`. Lint: two colliding tracks in different DAG layers with no edge → warn `unordered collision`.
- **Effort:** M
- **Priority:** P1
- **Context:** Bolt #4. `skills/roadmap.md`, new or existing STYLE/STRUCTURE check.

### [manual] Calibrate session-weight cap from shipped history before splitting
- **Why:** cap 4 (S=1/M=2/L=4) forced 11 Bolt splits. Four (101C, 102E, 103B, 106B — weight-5) were compliance theater; that repo ships weight-5 cards as one PR daily. Cost: +12 PRs and extra wave boundaries. Hard splits on weight-7/8 (104A, 105A, 107E) were real wins.
- **Hypothesis (untested):** Step 2 says check recently-shipped track weights and set `roadmap_max_session_weight` before splitting; or warn at 5 and hard-fail at ≥6.
- **Effort:** S
- **Priority:** P2
- **Context:** Bolt #5. `skills/roadmap.md`, `src/audit/lib/effort.ts`. Keep hard splits for genuinely oversized cards.

### [manual] Detect shipped-Track closure from commit messages in Step 1a
- **Why:** Track 82A's live remainder shipped in Bolt PR #402 ("Closes the live remainder of Track 82A"); the skill never surfaced it; the user caught it mid-run. Closing it unblocked the rewrite arc into wave 1. gstack-extend's Group 14 was the same class of miss (CHANGELOG/commits said shipped; Current Plan still listed it).
- **Hypothesis (untested):** for each In Progress / Current Plan track ID, `git log --since=<last regen> --grep "Track <ID>"` and surface "commit X claims to close Track Y — verify and move to Shipped."
- **Effort:** S
- **Priority:** P2
- **Context:** Bolt #6 + gstack-extend Group 14. `skills/roadmap.md` Step 1a.

### [manual] Stop the task parser from silently dropping or mislabeling tasks
- **Why:** compound tags `(S-M)`, `(M-L)`, `(XS)`, `(S once decided)` all report "missing effort tag" with no hint of what was found (20+ Bolt findings). A bold title with inline italics (`- **~~X~~ -- the richest *raw* yield...**`) fails `/^- \*\*([^*]+)\*\*/` and the task vanishes from SIZE/TASK_LIST — Bolt 112A had an unenforced weight. Done-marker bullets (`- **G0 ✓ RUN 2026-08-14**`) count as untagged work. On gstack-extend, a real `(S)` / `(M)` with trailing `_Source: [tag]` also parsed as untagged.
- **Hypothesis (untested):** name the found tag in the finding; alias XS→S; round or reject compounds explicitly; tolerate `*` / `~~` inside bold titles; exclude ✓ / SHIPPED / RETIRED / CUT / DISCHARGED titles from weight; allow trailing `_Source:` after the effort tag.
- **Effort:** M
- **Priority:** P2
- **Context:** Bolt #7 + gstack-extend SIZE false fail on 14A/22A. `src/audit/parsers/roadmap.ts` ~515–560, `src/audit/checks/size-caps.ts`.

### [manual] Fix roadmap-pack returning BINS: (none) on first run after the file changes
- **Why:** reproduced twice on Bolt: run immediately after writing ROADMAP.md → `BINS: (none)`; identical rerun → full bins. Looks like an mtime/cache race. An agent that trusts the first output will debug a non-problem. Also distinguish real empty-input from cycle-detected in the output.
- **Hypothesis (untested):** find and kill the stale read; emit `EMPTY` vs `CYCLE` instead of a bare none.
- **Effort:** S
- **Priority:** P2
- **Context:** Bolt #8. `src/audit/pack-cli.ts`, `src/audit/lib/pack.ts`.

### [manual] Canonize dotted family IDs for splits and teach the renames helper
- **Why:** splitting 102A into 102A.1/102A.2 preserved every design-doc and source-tag reference; the audit already accepts the grammar, but `skills/roadmap.md` does not state it as the default, and `renames-diff.ts` matches exact titles only, so splits surface as unrelated add/delete pairs.
- **Hypothesis (untested):** skill default for a split is a dotted family ID, not a renumber. `computeRenames` matches "same normalized title, ID differs only by dot suffix."
- **Effort:** S
- **Priority:** P3
- **Context:** Bolt #9. `skills/roadmap.md`, `src/audit/lib/renames-diff.ts`.

### [manual] Bless DAG-order launch in the Execution Map template
- **Why:** the emitted adjacency is a real DAG (Bolt Groups 124/125 independent of 126's chain), but roadmap prose says groups run sequentially in document order, so thin waves become calendar loss. Related vocab bug: `## In Progress` can be empty while PARALLELISM_BUDGET still counts Current Plan groups with no deps as "in-flight."
- **Hypothesis (untested):** one sentence in the template: "A Group may launch when every Group in its ← set has landed, regardless of document order; document order is priority, not gating."
- **Effort:** S
- **Priority:** P3
- **Context:** Bolt #10 + gstack-extend "in-flight" vocab collision. `skills/roadmap.md` Execution Map template.

### [manual] Collapse PACKING finding spam to one line per group pair
- **Why:** one missing dep-annotation family produced 100+ near-identical lines (`Group 118 is packer-blocked by Group 102 (102A → 118A)` × every track pair). Signal drowns.
- **Hypothesis (untested):** emit `Group 118 ← Group 102 missing (16 track-level edges)`.
- **Effort:** S
- **Priority:** P3
- **Context:** Bolt #11. `src/audit/checks/packing.ts`.

### [manual] Align the 1-track-Group rule between skill prose and packer
- **Why:** skill prose says a 1-track Group is legal only as a Hotfix or an everything-colliding scan scope; the packer freely emits 1-track bins for ordinary tracks (Bolt 121B; gstack-extend's Group 17 / 17A). The audit accepted them, so tool behavior is the de-facto rule.
- **Hypothesis (untested):** update the prose to match the packer, or make the packer absorb singletons into a later compatible bin.
- **Effort:** S
- **Priority:** P3
- **Context:** Bolt #12. `skills/roadmap.md`, optionally `src/audit/lib/pack.ts`.

### [manual] PROGRESS staleness should see version gaps, not just latest
- **Why:** Step 4 compares latest VERSION to latest PROGRESS row. gstack-extend matched on 0.23.0.0 and skipped, while 0.22.0.1 / 0.22.0.2 / 0.22.1.0 / 0.22.2.0 rows are still missing.
- **Hypothesis (untested):** diff the set of shipped versions against PROGRESS rows and offer to append the gaps.
- **Effort:** S
- **Priority:** P3
- **Context:** gstack-extend dogfood. `skills/roadmap.md` Step 4.

### [manual] Step 1a should notice a stale origin/main checkout
- **Why:** gstack-extend regen branched off local main at v0.22.3.0 while origin was v0.23.0.0 (the packer). The packer did not exist in the tree until a fetch. Extra sharp when the skill is the product.
- **Hypothesis (untested):** Step 1a fetches and reports `HEAD` vs `origin/<base>` before gathering; refuse to regen, or warn hard, when the checkout is behind the branch the plan claims to describe.
- **Effort:** S
- **Priority:** P3
- **Context:** gstack-extend dogfood. `skills/roadmap.md` Step 1a.
