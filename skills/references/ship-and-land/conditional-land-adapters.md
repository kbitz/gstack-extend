# /ship-and-land reference: Merge-gate first-run adapter, no-deploy classification, and stop-at-merge-gate output

## From First-run setup when stopping at the merge gate

When land-and-deploy reaches Step 1.5, run only its detection block, exactly
as installed in the discovered copy: the read-only comparison against the
`land-deploy-confirmed` fingerprint. Act on its printed token:

- `CONFIRMED`: continue exactly as land directs; this adapter changes nothing.
- `FIRST_RUN` or `CONFIG_CHANGED`: do not stop. Do not read or execute the
  first-run validation section, do not present its dry-run confirmation, and do
  not write, create or refresh the fingerprint. Record
  `first-run setup unconfirmed (<token>): the landing run confirms it`, with
  the actual token, in the readiness report and in the `Ship and land`
  receipt. An unconfirmed setup is not a blocker on this path. Then continue
  through land's CI gate, version-drift check and readiness report to the
  merge gate, with the other adapters above. Other blockers keep their
  installed behavior and are reported at the gate; only the first-run stop is
  replaced.
- No token, or the detection itself failed: unknown state, not `FIRST_RUN`.
  Stop with that blocker. Never guess a token or read a broken check as
  unconfirmed setup.

This path leaves the fingerprint absent or unchanged. A later landing run
detects setup again and runs the full first-run confirmation before any merge,
unchanged. Once setup is confirmed, replace any earlier unconfirmed note in
the readiness report and receipt with the actual confirmed status.

## From Projects with no deploy target

Classify the configuration with this read-only check. Set `_DEPLOY_DOC` to the
bound checkout's CLAUDE.md. It prints one token; act on the token:

```bash
_DEPLOY_DOC="<bound checkout CLAUDE.md>"
if [ ! -f "$_DEPLOY_DOC" ]; then
  echo "NOT_NO_DEPLOY"
else
  awk '
    function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
    {
      line = trim($(0))
      if (match(line, /^(```+|~~~+)/)) {
        delimiter = substr(line, 1, RLENGTH)
        if (!fence) { fence = substr(delimiter, 1, 1); fence_len = length(delimiter) }
        else if (substr(delimiter, 1, 1) == fence && length(delimiter) >= fence_len && trim(substr(line, RLENGTH + 1)) == "") fence = ""
        next
      }
      if (fence) next
      if ($(0) ~ /^## Deploy Configuration([ \t]*$| \(configured by \/setup-deploy\)[ \t]*$)/) { insec = 1; seen = 1; next }
      if ($(0) ~ /^##? /) insec = 0
      if (!insec) next
      sub(/^- /, "", line)
      i = index(line, ":")
      if (i == 0) next
      key = trim(substr(line, 1, i - 1))
      gsub(/\*/, "", key)
      lk = tolower(trim(key))
      if (lk == "") next
      if (lk == "merge method" || lk == "project type" || lk == "pre-merge") next
      if (lk == "platform") pseen = 1
      if (tolower(trim(substr(line, i + 1))) != "none") fail = 1
    }
    END { print (seen && pseen && !fail) ? "NO_DEPLOY" : "NOT_NO_DEPLOY" }
  ' "$_DEPLOY_DOC"
fi
```

`NO_DEPLOY` requires all of: the section exists; a `Platform` field is present;
and every field value is exactly `none` (trimmed, case-insensitive), except
`Merge method`, `Project type` and `Pre-merge`, which describe the merge, not
a deploy target. A missing file or section, a missing `Platform`, an empty
field value, or any other value — a production URL, a deploy workflow, a
deploy trigger, a status command, a health check, or any unlisted field —
prints `NOT_NO_DEPLOY`. That keeps land's behavior exactly as installed.
Only the exact section heading (optionally suffixed with
`(configured by /setup-deploy)`) counts; fenced examples do not record setup.

When the check prints `NO_DEPLOY`, apply this adapter on a landing run:

- Deployment facts record no deploy target, from that configuration, not
  "deployment unknown". Still inspect current workflows and platform files
  as land requires; the recorded configuration cannot override those facts.
  Do not promise a post-merge URL question when no deployment is expected.
- After the merge, still run land's post-merge deploy-run detection. A
  matching triggered deploy, an expected deployment whose run has not appeared,
  or an explicit verification URL from the caller takes precedence and
  restores land's steps as installed. Poll expected deployments under land's
  existing deadline. Failed or unknown detection stays unknown and follows
  land's installed handling; it cannot authorize `NOT_NEEDED`. A `none`
  configuration cannot erase an observed or expected deployment.
- Only after successful detection with no observed or expected deployment
  and no explicit verification URL, skip land's production-route question, the staging offer, the
  deploy wait and canary verification. Finish at land's deploy report with
  verdict `MERGED — NO DEPLOY NEEDED` and deploy status `NOT_NEEDED`. That
  verdict does not claim any deployment happened or was verified.

This adapter does not change first-run setup: a landing run on a no-deploy
project still runs Step 1.5's full confirmation until the user confirms the
recorded setup. Merge approval, merge/queue handling and every pre-merge gate
also stay as installed.

- Name the PR, its full head SHA and every state the landing run will ask the
  user to accept on that head: the CI verdict (`NO_CHECKS`, or each named
  non-required failing or pending check), an unconfirmed first-run setup, each
  readiness warning and any deployment the merge triggers.
- Ask whether to land it or leave the PR open. To land, give the exact command
  that starts the landing run: `/ship-and-land <PR URL>`, plus this
  invocation's verification URL when the user passed one. Never fill in
  `--reviewed`: when this invocation accepted it, say to add it only if the
  user still accepts the prior review for that head. When this invocation
  validated a marked handoff, tell them to paste the same handoff again with
  it. Say that run rechecks the head, asks for each acceptance and the merge
  approval, then merges and reports. Leaving the PR open needs no action.
- With a blocker, name each blocker and its repair instead of offering to land. A merge-gate stop that names blockers prints `status: blocked` and `next: none` on the stage line.

<!-- end of skills/references/ship-and-land/conditional-land-adapters.md -->
