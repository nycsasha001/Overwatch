#!/bin/zsh
# Double-click this file to start the trading journal.
cd "$(dirname "$0")" || exit 1

export PATH="/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/opt/node/bin:$HOME/.volta/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found on your PATH."
  echo "Install it from https://nodejs.org (v22.5 or newer), then double-click this file again."
  echo
  read -r "?Press Return to close…"
  exit 1
fi

echo "Node $(node -v)"

# A root-owned ~/.npm cache (left behind by an old `sudo npm`) makes installs fail with EACCES.
NPM_FLAGS=()
if [ -d "$HOME/.npm/_cacache" ] && [ ! -w "$HOME/.npm/_cacache" ]; then
  NPM_FLAGS=(--cache "$PWD/.npm-cache")
fi

# Reinstall when dependencies change, not only on the very first run.
NEEDS_INSTALL=0
[ ! -d node_modules/next ] && NEEDS_INSTALL=1
[ package.json -nt node_modules/.package-lock.json ] && NEEDS_INSTALL=1

if [ "$NEEDS_INSTALL" = "1" ]; then
  echo "Installing dependencies…"
  if ! npm install "${NPM_FLAGS[@]}"; then
    echo
    echo "Retrying with a local cache…"
    if ! npm install --cache "$PWD/.npm-cache"; then
      echo; echo "Install failed — scroll up for the reason."
      read -r "?Press Return to close…"
      exit 1
    fi
  fi
fi

echo
echo "Starting Overwatch on http://localhost:3000  —  press Control-C in this window to stop."
echo
(sleep 5 && open http://localhost:3000) &
npm run dev
