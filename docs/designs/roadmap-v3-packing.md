# Roadmap v3 — packing is a program

Groups are launch batches. Tracks are one-PR / one-session cards. The
LLM drafts Tracks; `bin/roadmap-pack` assigns Groups.

## Rules

- Unspecified Group `_Depends on:_` is **none**. Serial is opt-in. Group `_Depends on:` is packer **output** (`DEPENDS` lines), not input. Pack from a draft with `--from` / `--stdin`. `BINS: EMPTY` = no unshipped Tracks; `BINS: CYCLE` = `_blocked-by` loop.
- Session weight: S=1, M=2, L=4, XL=5. Weight 5 warns (`WEIGHT_WARN`); ≥6 fails. A task tagged `~N lines (del)` is S; title verbs are not enough.
- Markdown-only and delete-only Tracks skip the code file-fanout cap.
- Shared docs are not collisions. `CLAUDE.md` is, one Track per Group.
- `PACKING` fails when written Groups ≠ packer bins. Live `Hotfix:` Groups are excluded from both sides.
- Collision-split bins are serial (later layer + `_Depends on:`). A leftover singleton tail is absorbed when it fits under the hard max of 8.
- Optional `docs/roadmap-shipped.md` is merged for frozen IDs. Archive ID collisions warn.
- `_touches:` drift: `bin/roadmap-touches drift --track <id>`. Created files are `path (new)`.

See `skills/roadmap.md` Step 2 for the regen ritual.
