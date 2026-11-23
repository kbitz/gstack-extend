# Skill core-versus-reference rule

A skill's **core** (`skills/<skill>.md`)
keeps everything needed on every run; conditional detail lives in **reference
files** under `skills/references/<skill>/` and is fetched on demand through the
start command (`~/.gstack-extend/bin/preamble`).

See the [Track 94I acceptance record](acceptance/skill-references.md) for the
`/review-and-prep` measurements and
[installation troubleshooting](installation.md#skill-references) for read failures.

## Why references live under the checkout root

References stay in `skills/references/<skill>/<file>.md` inside the
gstack-extend checkout rather than beside each host's installed `SKILL.md`:

- `setup` does not have to copy or synchronize a second tree of files across
  multiple host skill directories.
- Both Claude Code (symlinked `SKILL.md`) and Codex / Muse (rendered copy with
  `.extend-root`) resolve the same verified checkout root via the start command.
- Serving references through `~/.gstack-extend/bin/preamble <skill> --ref <file> --expect <digest>`
  reuses the existing `Bash(~/.gstack-extend/bin/preamble:*)` allow rule,
  validates a 16-hex SHA-256 content digest so a loaded skill and the live
  checkout can never silently drift apart, and prints numbered lines with a
  `REFERENCE_END` trailer for truncation detection.

## What stays in the core vs. what moves to a reference

### Always stays in the core (`skills/<skill>.md`)

- Frontmatter, `## Preamble (run first)`, `SHARED:upgrade-flow`, `SHARED:telemetry-finish`,
  and the byte-identical `### Reference files and mid-run upgrades` rule.
- The main step-by-step procedure, every **gate** (both its trigger condition
  and its outcome/stop/hold), and every stop rule or deliberate pause.
- All **machine-read text**:
  - Capability-check literals grepped by callers (`docs/workflow-handoffs.md`,
    `docs/delegated-review.md`).
  - Paragraphs parsed by helpers (`src/upstream-check/cli.ts`,
    `src/review-delegate/cli.ts`).
  - Any heading linked by `#anchor` from `docs/` or `tests/`.
- All **no-root and degraded-mode fallbacks** and their output templates.

### May move to a reference (`skills/references/<skill>/<prefix>-<topic>.md`)

- Conditional procedures gated by an explicit policy value, branch, helper
  result, or failure exit.
- Delegate / subagent prompt bodies and dispatch detail.
- Resume reconciliation checklists and large reference tables.

Split by **reader cluster**. The primary reviewer reads delegate instructions
only when dispatching that part. Count every reference on the representative
default path alongside its core.

## Exact formats (enforced by `tests/skill-references.test.ts`)

1. **File path and prefix:** `skills/references/<skill>/<prefix>-<topic>.md`,
   one level deep, owned by exactly one skill, never named `SKILL.md`.
   Allowed prefixes: `conditional-`, `delegate-`, `orchestrated-`, `by-hand-`,
   `resume-`.
2. **Size caps:**
   - Core: ≤ per-skill budget in `tests/helpers/skill-budgets.ts` and ≤ `196,608`
     bytes (75% of Muse Code 1.4.25's measured `262,144`-byte limit).
   - Reference file: ≤ `16,384` bytes (16 KiB), ≤ `340` lines, and every line
     ≤ `2,000` characters. The numbered output including the
     `REFERENCE_END` trailer must fit in `17,000` bytes. This leaves 1,000
     bytes below the smallest successful single-call measurement.
3. **Read instruction in the core** (the only allowed way a core names a
   reference):
   ```markdown
   Run `~/.gstack-extend/bin/preamble <skill> --ref <file> --expect <digest>` before <step> when <condition>.
   ```
   (Omit `when <condition>` for an unconditional read.)
4. **Closing marker** (final non-empty line of every reference file):
   ```markdown
   <!-- end of skills/references/<skill>/<file>.md -->
   ```
   No reference file may point to another reference file.

## Worked example

Core section (`skills/example.md`):

```markdown
### Handle an optional retry path

Apply this step only when the caller passes `retry=bounded`.

Run `~/.gstack-extend/bin/preamble example --ref conditional-retry --expect 1f67c880bf5612f0` before retrying when `retry=bounded` is set.
```

Reference file (`skills/references/example/conditional-retry.md`):

```markdown
# /example reference: Bounded retry procedure

## From Handle an optional retry path

1. Snapshot the failed state before editing.
2. Retry once and record the outcome.

<!-- end of skills/references/example/conditional-retry.md -->
```

## Maintainer checklist

When adding or editing a reference file:

1. Add or update the manifest entry in `scripts/skill-references.ts`.
2. Update digests in the owning core: `bun scripts/skill-references.ts digests --write`.
3. In the slimming change, run `bun scripts/skill-references.ts check --base
   <pre-move-ref> --skill <skill>` against the pre-move revision. This checks
   the exact one-time transformation, so later ordinary edits use the digest
   and pointer tests. On a clean migration branch with saved changes,
   `apply` with the same flags overwrites that skill's core and reference
   files with the manifest's output from the named revision.
4. Check or update `tests/helpers/skill-budgets.ts` (raising a budget requires
   the developer's explicit approval and a `BUDGET_RAISE_LOG` entry).
5. Add `skills/references/<skill>/**` to `MANUAL_TOUCHFILES` in
   `tests/helpers/touchfiles.ts` for every suite that reads that skill's
   references, then run `bun scripts/sync-pregate-deps.ts`.
6. Run `bun test tests/skill-references.test.ts tests/touchfiles.test.ts` (and
   the full suite before shipping).
