#!/bin/zsh
# Stops Overwatch running in the background and removes it from login.

LABEL="com.overwatch.app"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null
rm -f "$PLIST"

if curl -sf http://localhost:3000 >/dev/null 2>&1; then
  echo "The service was removed, but something is still answering on port 3000 —"
  echo "that will be a copy started from a Terminal window. Close that window to stop it."
else
  echo "Overwatch is stopped and will no longer start at login."
  echo "Double-click \"Start Overwatch.command\" to run it manually, or"
  echo "\"Run in background.command\" to put it back."
fi
echo
read -r "?Press Return to close…"
