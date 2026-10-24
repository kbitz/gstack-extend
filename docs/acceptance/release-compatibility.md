# Release compatibility qualification

Track 28A, qualification on 2026-10-23–24. Source revision: `42eacc7b3426643f80f8ca89b9acee52bc22c91b`
plus this Track's implementation, later committed as
`0691d5c79d531fd3e0af2e72c9714f0165c64aab`. This record covers a local
candidate, not a published three-part release or installed two-host acceptance.
No VERSION, package version or CHANGELOG release entry is assigned by this Track.
Runtime: local macOS 27.0.1, Bun 1.3.10, Git 2.54.0 (Apple Git-157).
The operator used a Paseo worktree with Codex; this is isolated CLI/fixture
qualification, not installed host/harness workflow acceptance.

## Boundaries and stable surface

The supported in-repo stage-runs v2 readers are the published JSON schema,
the executable validator in [telemetry](../telemetry.md#schema-validation), and
quota's projection of existing attribution fields. `tests/telemetry-contract.test.ts`
checks producers `0.47.0` and `1.0.0` with schema/validator and quota projection;
`0.47` and `0.47.0.0.0` fail schema/validator. Historical v1 grammar and legacy
records stay unchanged. This confirms one versioned provenance example on
[SPEC's stable surfaces](../SPEC.md#release-policy), not the full O5.1 catalog.
External consumers must qualify their own readers. Retain readers capable of
all emitted schemas when rolling back a writer; never rewrite ledger rows.

## Automated qualification

`tests/update.test.ts` loads the actual updater, checker, config and Bash
comparison bytes from tag `v0.46.0.0`, then upgrades through a local bare remote
to `0.47.0` and `0.46.1`. It checks offers, upgrade results, next-check markers,
`(OLD, NEW]` migration boundaries and a repeated invocation's once-only ledger.
Both `v0.47.0.sh` and `v0.47.0.0.sh` run once when in-window; the old-bound and
future scripts stay skipped. These are synthetic migrations; none is added to
the production migrations directory.

Real-checker controls include padded-equal remote `0.46.0`, two/five-part
versions, a `v` prefix, an rc suffix and `0.08.0`. The last exposed Bash octal
errors in the original checker; rejecting leading-zero remote components fixes
that demonstrated incompatibility. The Bash comparator itself is unchanged.
Audit pins exact tag spelling, while ordering guards use padded comparison.
Real Git version-sort tests cover mixed historical and new-width tags. Workflow
ERE tests reject leading zeros; extraction tests distinguish adjacent sections.

The release-manifest suite rejects older releases, a changed VERSION that does
not exceed an untagged base VERSION, padded-equal spelling collisions,
unmerged exact-tag collisions, missing history/tags/remote base, width
regression, a three-part release cut from a base without the marker, a release
branch cut before the marker reached `origin/main`, and a first three-part
release that is not the next MINOR above every fetched tag with PATCH 0. Its
fixtures include a historical three-part tag below the legacy top, as this
repository's history does. Base policy activates only from the remote merge
base (`origin/master` fallback), on any `Release format:` line or a CLAUDE.md
that is not a regular blob; HEAD's marker must be exact. `TOUCHFILES_BASE`,
HEAD-only policy and stale local main cannot activate it. auto-tag has syntax checks,
not an ordering gate. These are local fixture checks, not GitHub Actions proof.

## Operator-isolated legacy upgrade

Passed with legacy `v0.46.0.0` and local candidate `0.47.0` (candidate-only
commit `a9a1d1354bdc9ea71e11d11a1e0ebc8a42ee9a7a`). The harness verified original
legacy `setup`, `bin/update-check` and `bin/update-run` bytes before executing
them. It created four temporary host installs with explicit setup host flags,
then used the real updater's auto setup. All recorded operations exited 0.
The whole-roadmap audit has advisory exit semantics; only its VERSION section is acceptance evidence
for this upgrade. The known SIZE exception is recorded separately below.

The operator created a local bare remote and two independent clones under
`<clone>`, with push URLs disabled except the candidate's temporary bare remote.
HOME, state, TMPDIR, Git identity and caches were temporary. The remote was
seeded at the legacy tag's commit. The candidate applied the source working
diff, assigned clone-only release metadata, prepended candidate notes and added
an idempotent `v0.47.0.sh` that wrote only temporary state. It committed/tagged
and pushed only to the temporary bare remote. No production migration was added.

Relevant executed operations, normalized to placeholders (preparation above is
required; the remote URL override points to the candidate's local VERSION file):

```sh
<clone>/legacy/setup --host claude --quiet
<clone>/legacy/setup --host codex --quiet
<clone>/legacy/setup --host opencode --quiet
<clone>/legacy/setup --host cursor --quiet
GSTACK_EXTEND_REMOTE_URL=file://<clone>/remote-VERSION <clone>/legacy/bin/update-check --force
<clone>/legacy/bin/update-run <clone>/legacy
GSTACK_EXTEND_REMOTE_URL=file://<clone>/remote-VERSION <clone>/legacy/bin/update-check --force
<clone>/legacy/bin/roadmap-audit <clone>/legacy
# In the legacy clone, after a clean-status check:
git checkout --detach v0.46.0.0
./setup --host auto --quiet
git checkout main
./bin/update-run <clone>/legacy
```

```text
UPGRADE_AVAILABLE 0.46.0.0 0.47.0
UPGRADE_OK 0.46.0.0 0.47.0
JUST_UPGRADED 0.46.0.0 0.47.0
CURRENT: 0.47.0
LATEST_TAG: v0.47.0
CHANGELOG_LATEST: 0.47.0
STATUS: pass
```

Rollback left detached HEAD as documented. After returning to main, re-upgrade
printed `UPGRADE_OK 0.47.0 0.47.0`. The ledger contained `v0.47.0.sh` exactly
once, its state marker's modification time stayed unchanged, and rollback
retained all migration state. The installed clone ended clean. Real HOME
four-host directory/link metadata and every real repository tag ref/object ID
were captured before and after and compared equal.

Installed upstream gstack `1.91.185.0` was exercised in another isolated scratch
repository with no remotes. Commands used the installed helper binaries:

```sh
~/.claude/skills/gstack/bin/gstack-version-bump classify --base main
~/.claude/skills/gstack/bin/gstack-next-version --base main --bump micro --current-version 0.47.0 --workspace-root null --json
~/.claude/skills/gstack/bin/gstack-next-version --base main --bump patch --current-version 0.47.0 --workspace-root null --json
~/.claude/skills/gstack/bin/gstack-next-version --base main --bump minor --current-version 0.47.0 --workspace-root null --json
```

Classifier result: four-part base `0.46.0.0` / current `0.47.0` →
`ALREADY_BUMPED`; three-part base/current `0.47.0` → `FRESH`.
Allocator results: micro → `0.47.1` (treated as patch), patch → `0.47.1`,
minor → `0.48.0`. Every operation exited 0. `host: unknown` and explicit
queue-awareness warnings were present. `complete:true` / `offline:false` in
those responses does not prove queue safety; only local classification and
arithmetic were qualified. Repeat this probe when upstream changes.

## Full format probe

Both full invocations use `EVALS_ALL=1 bun run test`, with dependency setup by
`bun install --frozen-lockfile`. The throwaway clone starts from the source's
actual `origin/main` revision above, applies this Track's working changes, and
keeps that remote-tracking base. It never uses the stale local main branch.
Only the candidate changes VERSION/package version to `0.47.0` and prepends a
candidate CHANGELOG heading and disclosure/migration note; historical headings
are retained. These assignments never touch the source checkout.

HOME, state, caches and temporary files are isolated. Installed upstream
`1.91.185.0` logger/config/state-resolver copies keep real telemetry checks
active; fixture copies omit the network sync helper. The clone's fetch URL
retains this repository's identity for self-registration tests, while its
push URL is disabled. No fetch or push to the real remote is part of the probe.

The full four-part control finished with exit 1: **4,111 passed, 6 skipped,
3 failed**, 4,120 tests across 76 files, 1,468.489 seconds. The three failures
were probe-harness assumptions: an explicit `GIT_CONFIG_GLOBAL` prevented a
safe-directory fixture's HOME override from selecting its own config, and the
local clone origin/folder identity produced the wrong slug in two registration
assertions. Removing that override and restoring the source remote identity
in a clone named `gstack-extend` made all three pass on unchanged four-part
metadata: **3 passed, 0 failed**, exit 0, 1.916 seconds. The clean command
was `EVALS_ALL=1 bun test tests/merge-gate.test.ts tests/setup-init-wire.test.ts
--test-name-pattern 'global safe.directory|self-registration'` from the corrected
clone. No source assertions were changed. The full control was retained, rather than relabeled green.

The clean three-part candidate finished with exit 0: **4,114 passed, 6 skipped,
0 failed**, 4,120 tests across 76 files, 1,293.275 seconds. It exercised the
same 17 real-upstream telemetry checks. The only failure-name delta from the
full control was removal of the three already-confirmed harness failures;
there were no new failures. No VERSION-format reader needed an additional fix
or a new VERSION dependency. Format-sensitive release-only selection remains
the release-manifest, telemetry and telemetry-contract suites. The paired
probe's control was not repeated wholesale after correcting the harness;
the clean three-case four-part rerun supplies that bounded confirmation.

Fourteen functional/policy/test inputs in the clone were byte-compared with
the source and matched, including the checker, workflow, release guards,
reader tests and dependency map. The patch applied to the clone matches commit
`0691d5c` for the checker, workflow, extractor, pregate map and every test
file; it differs only in documentation and comments. Review fixes after that
commit tightened tests and release guards and edited documentation; they left
`bin/update-check`, `auto-tag.yml` and the extractor logic unchanged, and the
PR head's own full suite covers them. The source's VERSION,
package.json and CHANGELOG.md remain identical to its base, and all real tag
refs still match the before-probe snapshot.

The six normal skips comprise two negative telemetry sentinel cases (actual
upstream telemetry checks run) and four opt-in integrations whose environment
gates are unset: secret-disposition/pregate integration, upstream planning
phase discovery, upstream outside-review result validation, and upstream
Claude transport conformance. These skips do not count as passes; no paid
outside-review route was invoked. The full control exercised 17 real-upstream
telemetry checks; candidate coverage is recorded with its result above.

An earlier six-suite sandbox run exited 1 with 262 passes, 2 skips and 25
failures (21 timeout/hook failures, including the new legacy cases, and four
Python macOS temp-directory stderr warnings). Preliminary sandbox format
controls were incomplete and are not full-suite evidence. The isolated
unsandboxed control cleared the warnings and all updater timeout failures;
only the separately reproduced harness assumptions above remained.

The source roadmap checks report `DRIFT: pass` and `PACKING: pass`. Audit exit
0 is advisory: `SIZE: fail` remains the explicitly approved d33 exception,
21 files against the 16-file cap, for the single PR (the 21st, the shared
fixture helper's GIT_* fix, was approved during review). Record it in the PR body.
No cap was weakened. The group collision ordering was aligned with accepted
28A-before-27A scheduling; whichever lands second rebases shared files.

## Remaining acceptance and release obligations

The full O5.1 stable-surface catalog, a real legacy install upgraded from the
first published three-part tag/default remote, tagged-release identity, and
failed-migration recovery remain in the four preserved Unprocessed TODOs.
Candidate runs cannot satisfy the published-release upgrade obligation.
The release owner must confirm this SPEC policy amendment directly when
shipping; the transition's own release uses the base's four-part policy.
The subsequent cutover must be an unused 0.x MINOR above all tags, disclose
padded equality and unchanged consumer schemes, link migration/rollback guidance,
and pass the full suite on its actual release head. Verify the resulting
GitHub release after authorized merge; no remote publication was exercised here.

Proposed O5 acceptance text for later owner consideration (not awarded and not
written to PROGRESS): “Track 28A supplies local candidate upgrade and three-part
release-reader qualification, with the source revision and evidence above.
Published-tag upgrade, full O5.1 catalog and O1–O4 host/harness qualification
remain pending; this does not complete O5 or authorize 1.0.”
