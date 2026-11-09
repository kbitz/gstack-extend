# Tools-mode delegation acceptance record

Source revision: `06679875` (`origin/main` base of the tools-mode track).
Qualified CLI: `2.1.319 (Claude Code)` on Linux (`macOS` unexercised).
Track 77A relation: tools mode (`"access": "tools"`) is a delegation arm for Track 77A's evaluation against diff-only delegation and host-native subagent review.

The runner, configuration schema, disposable copy lifecycle, and `/review-and-prep` Step 1 and Dispositions rules for tools-mode delegation (`"access": "tools"`, `"cli": "claude-code"`, `"commands"`) are covered by `tests/review-delegate.test.ts` and `tests/skill-protocols-review-and-prep.test.ts`. No installed-agent run backs
it yet: a static prose test is not installed-agent acceptance, so the live
verification below remains open until an installed `/review-and-prep` run
exercises a tools-mode provider end to end after merge and lands here.

## Runner-owned Claude Code flag list

For `"access": "tools"` with `"cli": "claude-code"`, `effectiveArgv` appends `--model <provider.model>` after `provider.argv` and then appends:

```text
-p --output-format json --safe-mode --restricted --strict-mcp-config --disable-slash-commands --no-session-persistence --permission-mode dontAsk --permission-prompts none --tools Read,Grep,Glob,Bash,Edit,Write --allowedTools Read Grep Glob Edit(./**) <one Bash(<entry>) per commands entry> --disallowedTools NotebookEdit WebFetch WebSearch Agent Task
```

## Supported and unsupported sign-in

- **Supported:** Claude Code's stored user login under the caller's normal `HOME` (`CHILD_ENV`: `HOME`, `USER`, `LOGNAME`, `PATH` filtered to absolute entries, `LANG`, `LC_ALL`, `TMPDIR`, plus `DISABLE_AUTOUPDATER=1`).
- **Unsupported (stripped from child environment or not read):** `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, a relocated `CLAUDE_CONFIG_DIR`, and settings-file `apiKeyHelper` or `env` entries requiring stripped environment variables.

## Planning probes (Linux, Claude Code `2.1.319`)

1. **Flag parse probe:** `claude -p --help` on `2.1.319 (Claude Code)` confirmed `--safe-mode`, `--restricted`, `--strict-mcp-config`, `--disable-slash-commands`, `--no-session-persistence`, `--permission-mode dontAsk`, `--permission-prompts none`, `--tools`, `--allowedTools`, and `--disallowedTools`.
2. **Minimal sign-in call:**
   ```bash
   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" LANG=C.UTF-8 DISABLE_AUTOUPDATER=1 \
     /home/kb/.local/share/mise/installs/claude/2.1.319/bin/claude \
     -p --output-format json --model haiku --safe-mode --restricted --strict-mcp-config \
     --disable-slash-commands --no-session-persistence --permission-mode dontAsk \
     --permission-prompts none --tools "" "Reply with the single word: OK"
   ```
   Result: exit `0`, `subtype: "success"`, `is_error: false`, `result: "OK"`.
3. **Behavioral permission probe (`haiku`, 7 tool calls in one session):**
   - `Read` on `target.txt` inside copy: **allowed** (`alpha`).
   - `Edit` on `target.txt` inside copy (`alpha` -> `beta`): **allowed** (`target.txt` modified inside copy).
   - `Bash("echo PROBE_OK")` matching `Bash(echo PROBE_OK)`: **allowed** (`PROBE_OK`).
   - `Bash("uname -a")` not in `commands`: **denied** (`Permission to use Bash with command uname -a has been denied`).
   - `Write` to `<outside>/pwn.txt`: **denied** (`Write is restricted to the current working directory`; file absent).
   - `Edit` to `<outside>/existing.txt`: **denied** (`Edit is restricted to the current working directory`; file unchanged).
   - `WebFetch` to `https://example.com`: **denied** (`unavailable`).
   Completed in `5,254 ms`, `num_turns: 4`, `$0.0085`.
4. **Extended boundary, symlink, protected-path, and repo-settings probe (`haiku`):**
   - `Edit` on `sub/nested.txt` inside copy: **allowed** (`Edit(./**)` matches nested paths).
   - `Write` on `./sub/new.txt` inside copy: **denied** (`Write` is in `--tools` so `Edit` remains functional, but omitted from `--allowedTools`).
   - `Edit` on `./escape-link.txt` (symlink inside copy targeting `<outside>/existing.txt`): **denied** (`Edit is restricted to the current working directory`; target outside copy unchanged).
   - `Edit` on `./.git/config` inside copy: **denied** (`Rule "Edit(./**)" cannot grant access to '.git/config'`).
   - `Edit` on `./.claude/settings.json` inside copy: **denied** (`Rule "Edit(./**)" cannot grant access to '.claude/settings.json'`).
   - `Read` on `<outside>/existing.txt`: **allowed** (confirming `--restricted` bounds writes to cwd, not reads).
   - Planted `<copy>/.claude/settings.local.json` with `permissions.allow: ["Bash(id)"]` and a `PreToolUse` hook writing a marker file: `Bash("id")` was **denied** and the hook marker file was **not created** (`12,066 ms`, `$0.027`).
5. **Shallow fetch copy probe (including unreachable snapshot commit):**
   - `git init -q <copy>`
   - `git -C <copy> fetch -q --depth=1 --upload-pack="git -c uploadpack.allowAnySHA1InWant=true upload-pack" <real-top> <base> <candidate>`
   - `git -C <copy> checkout -q --detach <candidate>`
   Verified on an unreachable `git commit-tree` snapshot SHA in `155 ms`.

## Pre-merge copy dry-run (no model call)

Executed on this repository at `HEAD` (`06679875ea89beca390496f3fc701000fc4485a9`):
- `git init -q`, `git fetch -q --depth=1 --upload-pack="git -c uploadpack.allowAnySHA1InWant=true upload-pack" <repo> <head> <head>`, and `git checkout -q --detach <head>` exited `0` in `171 ms` (`copyHead` matched `HEAD`).
- `bun install --frozen-lockfile` inside the copy exited `0` in `24 ms`.
- `bun test tests/touchfiles.test.ts` inside the copy exited `0` in `856 ms`.
- Temporary parent directory removed cleanly.

## Post-merge installed-agent verification

| ID | Status | Date | Host / Model | Delegate CLI / Model | Target Commit | Seeded Defect | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `PM1` | pending | — | — | `claude-code` (`2.1.319` or later requalified) / `sonnet` | commit where tools-mode lands on `main` | 1-line assertion inversion in a scratch branch's unit test target | Record: (a) `check` output with `"access":"tools"`, (b) `delegation: active (parts=adversarial; config=<sha256>; tools=adversarial)`, (c) `run` output with `outcome:"credited"`, non-empty `findings`, and `worktree_changed:false`, (d) `review-delegate: tools-mode setup took <ms> ms` in saved `stderr`, (e) finding summary citing the failing test run, (f) host re-running the reproduction before Fix-First, (g) zero remaining `$TMPDIR/extend-delegate-*` directories, and (h) real worktree unchanged. |
