#!/bin/zsh
LABEL="com.overwatch.dailyupdate"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null
rm -f "$PLIST"
echo "Daily market-data update removed. Candles will only change when you import manually."
echo
read -r "?Press Return to close…"
