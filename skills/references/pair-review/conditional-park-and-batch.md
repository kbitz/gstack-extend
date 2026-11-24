# /pair-review reference: On PARK and On BATCH procedures

## From On PARK

1. If the user didn't include a description, ask via AskUserQuestion:
   - Question: "**What's the bug, and how do you reproduce it?** A short
     symptom + numbered repro steps. Repro is what makes this fixable later
     without re-deriving the bug from a vague memory."
   - Options: ["Let me describe it"]

   The user's response should give you both a symptom and repro steps. If
   they only describe the symptom (no repro), gently ask once more for the
   steps. If they push back ("can't repro reliably" / "saw it once"), accept
   that and record `Repro: not reliably reproducible — verify before fixing`.
   Do NOT insist past one nudge.

   **Ambiguous-response fallback:** if after one nudge the response is still
   vague, contradictory, or you genuinely cannot extract numbered steps,
   record what you have for `Symptom:` and write `Repro: not reliably
   reproducible — verify before fixing` for the repro. Move on. The
   re-verify guidance in the promoted TODO will surface the gap later if
   the bug ever needs to be fixed.

## From On BATCH

1. Read the group file. Collect the next 2-3 consecutive UNTESTED items in index
   order that share one prepared state (or fewer if the group is nearly done).
   Prepare that state once. Also identify the item after the batch (the
   post-batch lookahead).
2. Present all items in a single AskUserQuestion:
   - **Question:** "[Action receipt if applicable]\n\n**[Group] — Batch [start]-[end]/[Total]:**\nPrepared: [shared Prepared field]\n\n[N]. [Action line]\n    PASS: [Pass field]\n[N+1]. [Action line]\n    PASS: [Pass field]\n[N+2]. [Action line]\n    PASS: [Pass field]\n\n_Next up: [N+3]. [Post-batch action line]_\n\nReport results for each item. Examples:\n`all pass` · `1 pass, 2 fail: button misaligned, 3 skip` · `2 fail: crashes on tap`"
   - **Options:** ["All pass", "Report results", "Park a bug", "Back to single mode"]

   Batch mode renders **action + PASS only** — the `Fail:` field is omitted on
   purpose to keep three items scannable in one block. If the user asks what a
   failure would look like for a batched item, give them that item's `Fail:`
   line and re-present the batch unchanged. `Context:` is never rendered here
   either.

3. **On "All pass"**: Mark every batched item `PASSED`, write `Build: <HEAD>` +
   `Tested: <now>`, and append `PASSED at <HEAD> (<now>)` to each item's
   `Attempts:`. Update `session.yaml` summary counts.

4. **On "Report results"**: The user clicked a button, so you don't have results yet.
   Ask a follow-up via AskUserQuestion:
   - Question: "Enter results for each item. Examples:\n`all pass` · `1 pass, 2 fail: button misaligned, 3 skip` · `2 fail: crashes on tap`"
   - Options: ["Submit"]
   Parse the user's free-text response. Map each item to PASS, FAIL (with evidence),
   or SKIP. For any FAILs, follow the standard FAIL flow (ask "Fix now or continue
   testing?") one at a time in item order after recording all results.
   Apply the ordinary PASS, FAIL or SKIP recording to each item, including
   appending each result to `Attempts:`; never record a reported FAIL twice.

5. **On "Back to single mode"**: Return to single-item presentation with lookahead
   at the next UNTESTED item.

**Minimum threshold:** If fewer than 2 consecutive UNTESTED items share a
prepared state when "Batch: next 3" is selected, stay in single-item mode. Tell
the user: "Only N item(s) left — staying in single mode."
If enough items remain but their states differ, say "No consecutive items share
a prepared state — staying in single mode" instead.

After a batch, offer another batch only when the next consecutive items share
one prepared state and at least 3 UNTESTED items remain. Otherwise fall back to
single-item presentation with lookahead.

<!-- end of skills/references/pair-review/conditional-park-and-batch.md -->
