# /pair-review reference: Phase 4 report template and paused-preparation PR check

## From Step 1: Generate report

```markdown
## Pair Review Report

Branch: <branch>
Date: <date>
Duration: <time from started to now>

### Summary
- Total items: N
- Passed: N
- Failed + fixed: N
- Skipped: N
- Checks left off as agent checks: <list, or none>

### Groups

#### <Group 1>
| # | Check | Item | Status | Evidence | Notes |
|---|-------|------|--------|----------|-------|
| 1 | <matrix ID or none> | <description> | PASSED | <Agent evidence path> | |
| 2 | <matrix ID or none> | <description> | PASSED (failed at <build>: <evidence>; fixed in abc123) | <Agent evidence path> | <notes> |
...

### Fixes Applied
| Commit | Item | Verified Build | Description |
|--------|------|----------------|-------------|
| abc123 | Auth #2 | def456 | Fixed loading state transition |
...

### Skipped Items
| Item | Reason |
|------|--------|
| <description> | <reason> |

### Parked Bugs
| # | Bug | Noticed During | Outcome |
|---|-----|----------------|---------|
| 1 | <description> | <group>, item <N> | FIXED (abc123) / DEFERRED_TO_TODOS / SKIPPED |
```

## From Step 3: Offer next steps

```bash
PR_CLASS=lookup-failure
PR_REASON=
if [ -z "$(git remote)" ]; then
  PR_CLASS=no-github
elif ! command -v gh >/dev/null 2>&1; then
  PR_REASON=gh-missing
elif [ -z "$(git branch --show-current)" ]; then
  PR_REASON=detached
else
  _PR_ERR=$(mktemp) || { printf 'PR_CLASS=lookup-failure\nPR_REASON=api\n'; exit 0; }
  trap 'rm -f "$_PR_ERR" "${_PR_OUT:-}"' EXIT
  _PR_OUT=$(mktemp) || { printf 'PR_CLASS=lookup-failure\nPR_REASON=api\n'; exit 0; }
  gh pr view --json state,isDraft,url,body,comments --jq '
(.comments // [] | map(select(.viewerDidAuthor == true and
  (.body | contains("<!-- review-and-prep:paused:") or contains("<!-- review-and-prep:receipt:"))))
  | sort_by(.createdAt)) as $markers
| ($markers | map(select(.body | contains("<!-- review-and-prep:paused:"))) | last) as $pause
| (($markers | last | .body // "" | contains("<!-- review-and-prep:paused:"))
   or (.isDraft == true and $pause != null)) as $comment_paused
| (.body // "" | split("\n") | map(rtrimstr("\r"))
   | reduce .[] as $line ({active: false, paused: false};
     if $line == "## Review and prep" then .active = true
     else if ($line | startswith("## ")) then .active = false
     else if .active and ($line | contains("PAUSED") and contains("manual testing required"))
       then .paused = true else . end end end)) as $section
| ($pause.body // "" | split("<!-- review-and-prep:paused:")[1] // ""
   | split(" ")[0] // "" | split("\n")[0] // "" | split("-->")[0] // "") as $candidate
| (if ($candidate | length) == 40 and
       ($candidate | explode | all((. >= 48 and . <= 57) or (. >= 97 and . <= 102)))
   then $candidate else "" end) as $sha
| "PR_STATE=\(.state)", "PR_DRAFT=\(.isDraft == true)", "PR_URL=\(.url)",
  "BODY_PAUSED=\($section.paused == true)", "COMMENT_PAUSED=\($comment_paused == true)", "PAUSE_SHA=\($sha)"
' >"$_PR_OUT" 2>"$_PR_ERR"
  PR_VIEW_RC=$?
  cat "$_PR_ERR" >&2
  printf 'PR_VIEW_RC=%s\n' "$PR_VIEW_RC"
  if [ "$PR_VIEW_RC" -ne 0 ]; then
    _PR_ERROR=$(LC_ALL=C tr '[:upper:]' '[:lower:]' < "$_PR_ERR")
    case "$_PR_ERROR" in
      *'of the git remotes configured for this repository point to a known github host'*|*'no git remotes found'*) PR_CLASS=no-github ;;
      *'no pull requests found for branch'*) PR_CLASS=no-pr ;;
      *) if [ "$PR_VIEW_RC" -eq 4 ] || case "$_PR_ERROR" in *'gh auth login'*) true ;; *) false ;; esac; then PR_REASON=auth; else PR_REASON=api; fi ;;
    esac
  elif LC_ALL=C awk '
    NR == 1 && /^PR_STATE=(OPEN|CLOSED|MERGED)$/ {next}
    NR == 2 && /^PR_DRAFT=(true|false)$/ {next}
    NR == 3 && /^PR_URL=https?:\/\/[^[:space:]]+$/ {next}
    NR == 4 && /^BODY_PAUSED=(true|false)$/ {next}
    NR == 5 && /^COMMENT_PAUSED=(true|false)$/ {next}
    NR == 6 && (/^PAUSE_SHA=$/ || (/^PAUSE_SHA=[0-9a-fA-F]+$/ && length($(0)) == 50)) {next}
    {bad = 1}
    END {exit (bad || NR != 6)}' "$_PR_OUT"; then
    awk '{print}' "$_PR_OUT"
    if grep -Eq '^(BODY_PAUSED|COMMENT_PAUSED)=true$' "$_PR_OUT"; then
      if grep -qx 'PR_STATE=OPEN' "$_PR_OUT"; then PR_CLASS=paused; else PR_CLASS=closed-paused; fi
    else
      PR_CLASS=no-pause
    fi
  else
    PR_REASON=unreadable
  fi
fi
printf 'PR_CLASS=%s\n' "$PR_CLASS"
if [ -n "$PR_REASON" ]; then printf 'PR_REASON=%s\n' "$PR_REASON"; fi
```

Before presenting options, determine the recommended next step:

1. Run `gstack-review-read` and check its output.
2. If the output is **not** "NO_REVIEWS", a review exists for this branch — recommend `/ship`.
3. If the output **is** "NO_REVIEWS", check the diff size: run `git diff --stat main...HEAD` and count changed lines (insertions + deletions).
   - **≤ 30 lines changed** (trivial): recommend `/ship` — the changes are minor enough to skip review.
   - **> 30 lines changed**: recommend `/review` first.

Present via AskUserQuestion:

**If recommending `/review`:**
- Question: "**Test session complete.** [N] items tested, [M] fixes applied, [K] bugs parked.\n\n[One-line summary of parked bug outcomes if any]\n\nYou haven't run `/review` on this branch yet and there are meaningful code changes — worth a quick review before shipping."
- Options: ["Continue to /review", "Skip review, continue to /ship", "Commit the report to the repo", "Done for now"]

**If recommending `/ship`:**
- Question: "**Test session complete.** [N] items tested, [M] fixes applied, [K] bugs parked.\n\n[One-line summary of parked bug outcomes if any]"
- Options: ["Continue to /ship", "Commit the report to the repo", "Done for now"]

<!-- end of skills/references/pair-review/conditional-completion-routing.md -->
