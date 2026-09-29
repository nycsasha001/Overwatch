#!/bin/zsh
# Run Overwatch on this Mac as a production build, the fast way to use it day to day.
#
# Builds first whenever the code has changed since the last build, so a restart after an edit
# picks the edit up. A build that fails falls back to development mode rather than leaving the app
# down: a slow journal is better than no journal, and the log says why.
cd "$(dirname "$0")/.." || exit 1

# `next build` misbehaves under a non-standard NODE_ENV, and an older launch agent set it to
# development. The build and the server each set the right one themselves.
unset NODE_ENV

# The switch that keeps a local production build on the development login rules (one shared
# journal, cookies that work over http://localhost) — see isPublicServer in src/lib/auth.ts.
export OVERWATCH_LOCAL=1

stale() {
  [ ! -f .next/BUILD_ID ] && return 0
  [ -n "$(find src public next.config.mjs package.json package-lock.json .env.local -newer .next/BUILD_ID -print -quit 2>/dev/null)" ]
}

if stale; then
  echo "[$(date)] Building Overwatch — about a minute…"
  if ! npx next build; then
    echo "[$(date)] The build failed (the reason is above). Starting in development mode instead."
    exec npx next dev -p 3000
  fi
fi

echo "[$(date)] Starting Overwatch (production build) on http://localhost:3000"
exec npx next start -p 3000
