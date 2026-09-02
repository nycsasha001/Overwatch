#!/bin/bash
# Double-click to copy the Notion backtesting entries into the "Backtests" account.
# Nothing in Notion is read or changed — this reads the export already in this folder.
cd "$(dirname "$0")" || exit 1

if ! curl -s -o /dev/null -m 5 "http://localhost:3000/api/accounts"; then
  echo "Overwatch is not responding at http://localhost:3000"
  echo "Open the app first, then double-click this again."
  echo
  read -r -p "Press return to close."
  exit 1
fi

python3 scripts/import-notion-backtests.py --account "Backtests"
echo
read -r -p "Press return to close."
