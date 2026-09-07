#!/bin/bash
# Push the current commit to GitHub.
#
# This runs on your Mac, so git uses your own credentials — the keychain if you have used GitHub
# here before, otherwise it asks you directly in this window. Nothing about your login is stored
# by this script or visible to anyone else.
cd "$(dirname "$0")" || exit 1

echo "Overwatch — push to GitHub"
echo

REMOTE="$(git remote get-url origin 2>/dev/null)"
if [ -z "$REMOTE" ]; then
  echo "No 'origin' remote is set. Nothing to push to."
  echo
  read -r -p "Press return to close."
  exit 1
fi
echo "Remote:  $REMOTE"
echo "Branch:  $(git rev-parse --abbrev-ref HEAD)"
echo "Commit:  $(git log --oneline -1)"
echo

# The same check as before, run once more immediately before anything leaves the machine. A push is
# not undoable in any way that matters — once a secret is on GitHub it must be treated as leaked,
# even if the commit is deleted a minute later.
echo "Checking that nothing private is in the commit…"
LEAKS="$(git ls-tree -r --name-only HEAD | grep -iE '\.env|\.db$|\.db-|^data/|uploads/|backups/|engine-runs|notion-images|Notion Backtests\.json|\.log$|DS_Store|^\.claude/|^node_modules/|^\.next/')"
if [ -n "$LEAKS" ]; then
  echo
  echo "STOPPED — these should not be committed:"
  echo "$LEAKS" | sed 's/^/  /'
  echo
  read -r -p "Press return to close."
  exit 1
fi
echo "  clean: $(git ls-tree -r --name-only HEAD | wc -l | tr -d ' ') files, no secrets or data"
echo

echo "Pushing…"
echo "(If it asks for a password, GitHub wants a Personal Access Token, not your account password.)"
echo
if git push -u origin "$(git rev-parse --abbrev-ref HEAD)"; then
  echo
  echo "Pushed. Your code is at:"
  echo "  ${REMOTE%.git}"
  echo
  echo "Now open that page and confirm it says Private next to the repository name."
else
  echo
  echo "The push did not complete — the reason is above."
fi

echo
read -r -p "Press return to close."
