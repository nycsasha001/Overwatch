#!/bin/bash
cd "$(dirname "$0")" || exit 1
python3 scripts/import-notion-screenshots.py --account "Backtests"
echo
read -r -p "Press return to close."
