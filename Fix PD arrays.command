#!/bin/bash
# Re-reads each entry's notes and corrects which PD arrays it records.
cd "$(dirname "$0")" || exit 1
python3 scripts/fix-pd-arrays.py --account "Backtests"
echo
read -r -p "Press return to close."
