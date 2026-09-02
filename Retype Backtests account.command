#!/bin/bash
# Double-click to reclassify the "Backtests" account as a backtest account.
cd "$(dirname "$0")" || exit 1
python3 scripts/set-account-type.py --account "Backtests" --type backtest
echo
read -r -p "Press return to close."
