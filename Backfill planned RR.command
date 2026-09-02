#!/bin/bash
cd "$(dirname "$0")" || exit 1
python3 scripts/backfill-planned-rr.py --account "Backtests"
echo
read -r -p "Press return to close."
