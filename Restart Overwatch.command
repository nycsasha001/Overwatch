#!/bin/bash
# Bounce the background service, clearing the build cache while nothing is writing into it.
#
# The order is the whole point. Clearing .next with the server still running lets it recreate
# files halfway through the delete, which leaves a cache that is part old build and part new —
# the state where every page returns "Internal Server Error" and the log complains about a
# missing routes-manifest.json. So: stop it completely, clear, then start.
cd "$(dirname "$0")" || exit 1
LABEL="com.overwatch.app"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
URL="http://localhost:3000/api/market/coverage"

# Anything left behind by a previous run of this script.
rm -rf .next.stale.* 2>/dev/null

echo "Stopping the Overwatch service..."
# Only the port matters. bootout followed immediately by bootstrap races on macOS — launchd is
# still tearing the job down when the load arrives, and the reload fails with an I/O error while
# reporting nothing useful. kickstart -k restarts a loaded job in place and sidesteps all of it.
PORT_PIDS="$(lsof -ti tcp:3000 2>/dev/null)"
if [ -n "$PORT_PIDS" ]; then
  echo "  freeing port 3000 (pids: $(echo "$PORT_PIDS" | tr '\n' ' '))"
  # shellcheck disable=SC2086
  kill $PORT_PIDS 2>/dev/null
  sleep 2
  STILL="$(lsof -ti tcp:3000 2>/dev/null)"
  # shellcheck disable=SC2086
  [ -n "$STILL" ] && kill -9 $STILL 2>/dev/null
  sleep 1
fi

echo "Clearing the build cache..."
if [ -d .next ]; then
  STALE=".next.stale.$$"
  if mv .next "$STALE" 2>/dev/null; then
    rm -rf "$STALE" 2>/dev/null
  else
    rm -rf .next 2>/dev/null
  fi
fi
[ -e .next ] && echo "  Could not clear .next. Delete that folder in Finder, then run this again."

echo "Starting the Overwatch service..."
if [ ! -f "$PLIST" ]; then
  echo "  No launch agent installed. Double-click \"Run in background.command\" instead."
else
  # Load it if it is not loaded; harmless and silent when it already is.
  launchctl bootstrap "gui/$UID" "$PLIST" 2>/dev/null
  out=$(launchctl kickstart -k "gui/$UID/$LABEL" 2>&1)
  if [ -n "$out" ]; then
    echo "  kickstart: $out"
    # One retry: a job mid-teardown refuses the first kick and accepts the second.
    sleep 3
    out=$(launchctl kickstart -k "gui/$UID/$LABEL" 2>&1)
    [ -n "$out" ] && echo "  retry: $out"
  fi
fi

echo
echo "Waiting for it to answer - the first build after a clear takes a little longer..."
up=""
for _ in $(seq 1 60); do
  if curl -s -o /dev/null -m 2 "$URL"; then
    up="yes"
    break
  fi
  sleep 2
done

echo
if [ -n "$up" ]; then
  echo "Overwatch is up at http://localhost:3000"
else
  # Never report success it cannot see. The log says more than a guess would.
  echo "It did not come up. The end of the log:"
  echo
  tail -25 data/server.log
fi

echo
read -r -p "Press return to close."
