# Roadmap v3 — packing is a program

Groups are launch batches. Tracks are one-PR / one-session cards. The
LLM drafts Tracks; `bin/roadmap-pack` assigns Groups.

## Rules

- Unspecified `_Depends on:_` is **none**. Serial is opt-in.
- Session weight: S=1, M=2, L=4, XL=forbidden. Cap 4. Deletions are S.
- Markdown-only and delete-only Tracks skip the code file-fanout cap.
- Shared docs are not collisions. `CLAUDE.md` is, one Track per Group.
- `PACKING` fails when written Groups ≠ packer bins.
- Optional `docs/roadmap-shipped.md` is merged for frozen IDs.
- `_touches:` drift: `bin/roadmap-touches drift --track <id>`.

See `skills/roadmap.md` Step 2 for the regen ritual.
