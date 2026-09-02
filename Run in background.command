#!/bin/zsh
# Double-click once to keep Overwatch running in the background.
#
# Installs a macOS launch agent: starts at login, restarts itself if it stops, no Terminal window
# needed. Undo any time with "Stop background.command".

cd "$(dirname "$0")" || exit 1
DIR="$PWD"
LABEL="com.overwatch.app"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$DIR/data/server.log"
DIAG="$DIR/data/service-install.log"

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; fi

NPM_BIN="$(command -v npm)"
NODE_BIN="$(command -v node)"
if [ -z "$NPM_BIN" ]; then
  echo "npm was not found. Install Node.js from https://nodejs.org, then run this again."
  read -r "?Press Return to close…"; exit 1
fi
NODE_DIR="$(dirname "$NODE_BIN")"

mkdir -p "$HOME/Library/LaunchAgents" "$DIR/data"
: > "$DIAG"
{
  echo "install $(date)"
  echo "npm:  $NPM_BIN"
  echo "node: $NODE_BIN ($(node -v 2>&1))"
  echo "dir:  $DIR"
} >> "$DIAG"

# Absolute paths and an explicit PATH — a launch agent does not inherit your shell's environment.
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NPM_BIN</string>
    <string>run</string>
    <string>dev</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$NODE_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key><string>$HOME</string>
    <key>NODE_ENV</key><string>development</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLISTEOF

launchctl bootout "gui/$UID/$LABEL" 2>>"$DIAG"
launchctl unload "$PLIST" 2>>"$DIAG"
sleep 1
: > "$LOG"

if launchctl bootstrap "gui/$UID" "$PLIST" 2>>"$DIAG"; then
  echo "bootstrap: ok" >> "$DIAG"
else
  echo "bootstrap failed, trying load -w" >> "$DIAG"
  launchctl load -w "$PLIST" 2>>"$DIAG" && echo "load: ok" >> "$DIAG"
fi
launchctl kickstart -k "gui/$UID/$LABEL" 2>>"$DIAG"

echo "Registered. Waiting for it to answer on http://localhost:3000"
UP=0
for i in $(seq 1 60); do
  if curl -sf http://localhost:3000 >/dev/null 2>&1; then UP=1; break; fi
  printf "."
  sleep 1
done
echo

{
  echo "--- launchctl print ---"
  launchctl print "gui/$UID/$LABEL" 2>&1 | head -40
  echo "--- server.log (first 40 lines) ---"
  head -40 "$LOG" 2>/dev/null
} >> "$DIAG"

if [ "$UP" = "1" ]; then
  echo "Running in the background at http://localhost:3000"
  echo "It will start automatically when you log in. Stop it with \"Stop background.command\"."
  open http://localhost:3000
else
  echo "It did not answer in 60 seconds."
  echo "Diagnostics were written to data/service-install.log — send that to Claude."
fi
echo
read -r "?Press Return to close…"
