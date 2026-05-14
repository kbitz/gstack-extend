# TODOS

## Unprocessed

### [plan-ceo-review:track-10a] Migrations runner parity for gstack-extend upgrades

**What:** Add a `migrations/v*.sh` runner to `bin/update-run`, mirroring gstack's `gstack-upgrade/SKILL.md` Step 4.75 — after the git pull + `./setup`, run any migration script whose version is newer than the old `VERSION`. Idempotent, non-fatal on error.

**Why:** Track 10A makes `/gstack-extend-upgrade` the first-class upgrade path. gstack's equivalent has a state-fix channel for changes a plain `git pull` can't cover (renamed config keys, moved state dirs, orphaned files). gstack-extend has none. The day gstack-extend ships a breaking state change, existing installs have no migration mechanism and get stranded on broken state.

**Pros:**
- Cheap (~30 LOC) — `update-run` already has `OLD_VERSION`/`NEW_VERSION` in hand; gstack's Step 4.75 is a direct reference impl.
- Removes a latent upgrade hazard before it bites.

**Cons:**
- Speculative until a real migration exists — building infra with no first customer. Mitigation: P3 means "build when the first migration is actually needed," not now.

**Context:** Deferred from Approach C during the Track 10A CEO review (2026-05-14). The review chose Approach B (standalone skill + consolidate the inline flow) and explicitly held the migrations runner out of scope. Reference: gstack `gstack-upgrade/SKILL.md` Step 4.75.

**Effort estimate:** S (human) → S (CC)

**Priority:** P3

**Depends on / blocked by:** Track 10A landing first (it establishes `/gstack-extend-upgrade` and may further touch `bin/update-run` via the D9 EXIT-trap hardening).

### [plan-eng-review:track-6a] Drift test: skill prose section-name lists vs CANONICAL_SECTIONS

**What:** Add a test that asserts every `## SECTION_NAME` referenced in the advisory-sections lists in `skills/roadmap.md` matches `CANONICAL_SECTIONS` from `src/audit/sections.ts`.

**Why:** The skill file hand-lists audit section names. If a future Track adds, renames, or removes a section and forgets to sync the skill file, drift goes uncaught until a user hits a missing-section lookup. The Track 6A STALENESS → VERSION_TAG_STALENESS rename surfaced the gap; the v0.19.0.0 cutover collapsed `skills/roadmap-new.md` into `skills/roadmap.md`, so the test scope is now a single file.

**Pros:**
- One-shot ~30 LOC test pins the drift channel forever.
- Pairs with existing `tests/audit-invariants.test.ts` (fixture-lock) and `tests/audit-compliance.test.ts` (skill registry) — same family of structural-invariants tests.
- Catches the bug class before it ships, not after.

**Cons:**
- Slightly brittle if a future skill intentionally references a deprecated section name in prose (e.g., "STALENESS used to be called…"). Mitigation: strikethrough-aware parsing or a whitelist file.

**Context:** Pre-existing gap. Surfaced during /plan-eng-review of Track 6A (kbitz/audit-polish-freshness, 2026-05-10) when grepping for STALENESS revealed advisory-list refs the plan didn't account for. Test walks `skills/roadmap.md`, extracts `## [A-Z_]+` tokens from advisory-list paragraphs, asserts each is in `CANONICAL_SECTIONS`.

**Depends on / blocked by:** None — both blockers (Track 6A rename and the v0.19.0.0 cutover) have shipped.

### [review:track-8a] Tighten docs/-absent gate if CLAUDE.md proves too broad in dogfood

**What:** Narrow the gate on `src/audit/checks/doc-location.ts`'s "docs/ directory absent" finding from `hasClaude` to a stronger gstack-extend signal (e.g., the presence of a `bin/roadmap-audit` shim, or an entry in `~/.gstack-extend/projects.yaml` once that exists, or `docs/ROADMAP.md` anywhere in the worktree).

**Why:** Codex /review caught that CLAUDE.md is a Claude Code marker, not a gstack-extend marker. Generic Claude Code repos commonly have CLAUDE.md but aren't gstack-extend onboarded. With the current gate, running `bin/roadmap-audit` (or `/ship` gating) on such a repo emits a hard DOC_LOCATION fail telling the user to scaffold a layout they didn't opt into. For solo gstack-extend dogfood, the false-positive rate is near zero — but if you ever run the audit in a fleet context or open the project up, the gate needs to be tighter.

**Pros:**
- Closes the only remaining cross-model tension from /review on Track 8A.
- Tightens a deliberate user-facing gate decision (eng-review D7) once we have dogfood evidence either way.

**Cons:**
- Re-opens a recently-locked design decision; no fix until the gate is actually firing on the wrong projects in practice.

**Context:** Track 8A `/review` codex round caught this as finding #5. User chose to keep the CLAUDE.md gate (D2-A) and defer the tightening as TODO. Re-evaluate after first dogfood-encountered false positive.

**Depends on / blocked by:** Dogfood signal — a real false positive firing on a non-gstack repo, or a fleet-context expansion.

### [review:track-8a] Add realpath preflight to Layout Scaffolding skill prose for non-solo contexts

**What:** Skill prose currently allows symlinked scaffold directories (chezmoi/stow setups). Add a realpath preflight that resolves each scaffold directory and refuses to proceed if the resolved target lives outside the repo root. Defense-in-depth against a hypothetical malicious-repo clone scenario.

**Why:** Codex /review caught that a malicious repo can make `docs` a symlink to an external directory; then Layout Scaffolding creates `docs/designs/` at that external path and `mv`s files out of the repo. Real risk in fleet / "I cloned a stranger's repo and ran /roadmap" contexts. Solo-repo risk is near zero (you only run /roadmap on your own clones).

**Pros:**
- Closes a defense-in-depth gap codex flagged on the Layout Scaffolding flow.
- Mirrors the `is_safe_install_path` pattern Track 5A shipped for the install context.

**Cons:**
- chezmoi/stow setups that legitimately symlink `docs/` outside the worktree (rare but real) lose the auto-scaffold; they'd hit a halt and need manual setup.
- ~15 lines of skill prose for a low-likelihood scenario in solo context.

**Context:** Track 8A `/review` codex round caught this as finding #4. User chose to defer (D3-A). Resurrect when the project opens up or when the symlink-attack vector becomes relevant.

**Depends on / blocked by:** Non-solo / opening-up event, OR a realized symlink-attack scenario.

_(empty — all entries drained into ROADMAP.md by /roadmap on 2026-05-10)_
