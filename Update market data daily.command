#!/bin/zsh
# Double-click once to top the candle data up automatically every morning.
#
# Registers a launch agent that asks the running app to import everything between your newest
# stored bar and today, at 06:30 local time, then rebuilds the derived timeframes. It also runs
# once immediately so you can see it work. Remove it with "Stop daily update.command".

cd "$(dirname "$0")" || exit 1
DIR="$PWD"
LABEL="com.overwatch.dailyupdate"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$DIR/data/update.log"

mkdir -p "$HOME/Library/LaunchAgents" "$DIR/data"

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/curl</string>
    <string>-sS</string>
    <string>-X</string><string>POST</string>
    <string>-H</string><string>Content-Type: application/json</string>
    <string>-d</string><string>{}</string>
    <string>http://localhost:3000/api/market/update</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>6</integer>
    <key>Minute</key><integer>30</integer>
  </dict>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLISTEOF

launchctl bootout "gui/$UID/$LABEL" 2>/dev/null
launchctl bootstrap "gui/$UID" "$PLIST" 2>/dev/null || launchctl load -w "$PLIST" 2>/dev/null

echo "Daily update registered for 06:30."
echo
if curl -sf http://localhost:3000 >/dev/null 2>&1; then
  echo "Running one now — this can take a minute if you are several days behind…"
  curl -sS -X POST -H "Content-Type: application/json" -d '{}' http://localhost:3000/api/market/update \
    | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin)
    for r in d.get("updated",[]):
        note=r.get("error") or ("up to date" if r["bars"]==0 else f"added {r[\"bars\"]:,} bars")
        print(f"  {r[\"symbol\"]}: {r.get(\"from\")} → {r[\"to\"]} — {note}")
except Exception:
    print("  (could not read the response; see data/update.log)")'
else
  echo "The app is not running, so the immediate run was skipped."
  echo "It will still run at 06:30 as long as the app is up then."
fi
echo
echo "Log: data/update.log"
read -r "?Press Return to close…"
