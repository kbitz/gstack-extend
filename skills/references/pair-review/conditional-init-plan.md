# /pair-review reference: Deploy pattern discovery and Phase 1 test plan authoring

## From Step 2: Discover deploy patterns

If no recipe exists, search for common patterns using Glob:

```
Glob patterns (check each):
  Makefile
  package.json
  docker-compose.{yml,yaml}
  *.xcodeproj
  *.xcworkspace
```

For each pattern found:
- **Makefile:** `grep -E '^(dev|run|serve|start):' Makefile` for dev targets
- **package.json:** `grep -E '"(dev|start|serve)"' package.json` for npm scripts
- **docker-compose:** `docker compose up` is the likely command
- **Xcode project:** `xcodebuild -scheme <scheme> -configuration Debug build`

If patterns found, propose the recipe and ask for confirmation.

## From Step 3: Generate grouped test plan

**Every item is one action and a verdict.** Write each item in this exact shape:

```
<Imperative action — one line, verb-first, readable at a glance>
PASS: <the observable state that means it worked>
FAIL: <the concrete wrong behavior you expect if it's broken>
```

Authoring rules for the three lines:

- **Action is a single instruction.** "Sign in with a wrong password." Not
  "Test the login error path" (too vague to act on), and not "Verify that the
  login form, which now uses the new validation hook, shows an error" (buries
  the instruction in background).
- **PASS and FAIL describe what the eye sees**, not intent or correctness.
  Write "PASS: inline red text under the password field reads 'Incorrect
  password'" — never "PASS: error handling works correctly."
- **FAIL is not the negation of PASS.** Name the specific wrong behavior, so the
  human knows what to watch for: "FAIL: the page reloads, or the error shows as
  a toast instead of inline." If the only FAIL you can write is "not the above,"
  the PASS line isn't observable enough — rewrite it.
- **No background in the item.** No file paths, no commit hashes, no "this
  changed because…", no explanation of the implementation, no justification for
  why it's worth testing. If context genuinely matters, put it in the item's
  optional `Context:` field — written to disk and **never rendered in a prompt**.
  If the user asks "why am I testing this?", answer then, in a separate message.

**Forcing function**: if you cannot write a one-line observable PASS, it is not
a manual test item. Either an automated test already covers it (drop it) or it's
underspecified (rewrite it until you can). Do not ship a vague item and hope the
human infers the intent.

## From Step 3.2: Merge co-observable items

**Merge test** — two candidate items become ONE item when *both* hold:

1. A single user action puts both properties on screen at the same moment, AND
2. The human needs to do **nothing additional** — no navigation, no click, no
   scroll, no opening a panel — to judge the second after judging the first.

If "would they have to do anything else to see it?" is no, merge. Adjacency on
one screen is the common case: two fields in the same form, a button and its
label, a header and the list beneath it, a toggle and the state it controls.

**Merged item shape** — one action, several pass conditions:

```
Open the settings screen.
PASS: header reads "Settings"; both toggles render off; Save is disabled.
FAIL: header still reads "Preferences", a toggle renders on, or Save is
      enabled with no changes made.
```

Keep the action line singular. If merging forces it into "do X, then do Y", the
merge was wrong — split it back.

**Ceiling — judged, not counted**: merge only while a FAIL would still be
unambiguous. The test is "if they say it failed, do I know which condition
broke?" When the answer is no, split. In practice that lands around three or
four conditions, but a merged item with six tightly-related visual checks on
one screen can be fine and one with two unrelated ones can already be too many.
Judge the ambiguity, not the count.

**Inspection checks are not items.** A property confirmed only by inspecting a
cookie, a log line, a DB row or a network request is an agent check (Step 3),
never a second item linked to the first.

## From Step 3.4: Order for one pass through the app

1. **State locality first** — consecutive items should share the same screen or
   app state. All the settings-screen items together, then all the home-screen
   items. Every state change between consecutive items is dead time.
2. **Risk breaks ties** — when two items are equally cheap to reach, put the
   higher-blast-radius one first. Sessions get abandoned partway; the important
   verification should already be done when that happens.
3. **Destructive last** — items that delete data, sign out, or reset state go at
   the end of their group, or they invalidate the setup for everything after.

Rule 3 wins over rule 2. A destructive item that is also the highest-risk one
still goes last: putting it first would invalidate the state every other item
needs, which costs more than the early signal is worth.

Group order follows the same logic one level up: highest-risk group first.

Item indices are assigned **after** this ordering. Ordering does not run again.

<!-- end of skills/references/pair-review/conditional-init-plan.md -->
