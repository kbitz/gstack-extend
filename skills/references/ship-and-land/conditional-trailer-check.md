# /ship-and-land reference: Co-author trailer stripping script

## From Commit without co-author trailers

```bash
_SINCE="<full SHA: local HEAD bound in Step 1, or the last tip this invocation pushed>"
_BASE="<full SHA: fetched base tip>"
_BASE=$(git rev-parse --verify "$_BASE^{commit}") || exit 1
_HEAD=$(git rev-parse --verify HEAD) || exit 1
_BRANCH=$(git symbolic-ref --quiet --short HEAD) || { echo "TRAILERS: BLOCKED — detached HEAD"; exit 1; }
git merge-base --is-ancestor "$_SINCE" "$_HEAD" || { echo "TRAILERS: BLOCKED — HEAD does not descend from $_SINCE"; exit 1; }
_COMMITS=$(git rev-list --reverse --first-parent "$_SINCE..$_HEAD") || exit 1
if [ -n "$_COMMITS" ]; then
  _FIRST=$(printf '%s\n' "$_COMMITS" | sed -n '1p')
  [ "$(git rev-parse --verify "$_FIRST^1")" = "$_SINCE" ] || { echo "TRAILERS: BLOCKED — starting point is not on the first-parent chain"; exit 1; }
fi
_BAD=$(git log --no-show-signature --first-parent --format=%H --regexp-ignore-case --grep='^co-authored-by:' "$_SINCE..$_HEAD" "^$_BASE") || exit 1
if [ -z "$_BAD" ]; then echo "TRAILERS: CLEAN"; exit 0; fi
_TIP=$_SINCE
for _C in $(printf '%s\n' "$_COMMITS"); do
  git merge-base --is-ancestor "$_C" "$_BASE"
  _ANCESTOR=$?
  if [ "$_ANCESTOR" -eq 0 ]; then _TIP=$_C; continue; fi
  [ "$_ANCESTOR" -eq 1 ] || exit 1
  _OLD=$(git rev-parse --verify "$_C^1") || exit 1
  _NEW=$(git cat-file commit "$_C" | awk -v op="parent $_OLD" -v np="parent $_TIP" 'BEGIN { h = 1 } h { if (!d && $(0) == op) { $(0) = np; d = 1 } print; if ($(0) == "") h = 0; next } tolower($(0)) ~ /^co-authored-by:/ { next } { l[++n] = $(0) } END { while (n > 0 && l[n] == "") n--; for (i = 1; i <= n; i++) print l[i] }' | git hash-object -t commit -w --stdin) || exit 1
  if [ "$_NEW" != "$_C" ] && git cat-file commit "$_C" | sed '/^$/q' | grep -q '^gpgsig'; then echo "TRAILERS: BLOCKED — $_C is signed; a rewrite would invalidate its signature"; exit 1; fi
  [ -n "$(git log -1 --no-show-signature --format=%s "$_NEW")" ] || { echo "TRAILERS: BLOCKED — $_C would have an empty message"; exit 1; }
  _TIP=$_NEW
done
[ "$(git rev-parse "$_TIP^{tree}")" = "$(git rev-parse "$_HEAD^{tree}")" ] || { echo "TRAILERS: BLOCKED — the rewrite changed the tree"; exit 1; }
git update-ref -m "ship-and-land: drop co-author trailers" "refs/heads/$_BRANCH" "$_TIP" "$_HEAD" || { echo "TRAILERS: BLOCKED — $_BRANCH moved during the check"; exit 1; }
echo "TRAILERS: STRIPPED $_HEAD -> $_TIP"
```

<!-- end of skills/references/ship-and-land/conditional-trailer-check.md -->
