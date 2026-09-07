#!/bin/bash
# Turn live portfolio prices on, without the key passing through anything but this window.
#
# It is typed here, checked against Finnhub, written straight into .env.local, and never echoed,
# logged, or shown again. .env.local is git-ignored, so it cannot reach GitHub.
cd "$(dirname "$0")" || exit 1
ENV_FILE=".env.local"

echo "Overwatch — set the Finnhub API key"
echo
echo "This switches on live prices for the Portfolio page."
echo "Get a free key at https://finnhub.io — the free tier allows 60 calls a minute."
echo
echo "Leave it blank to remove the key and go back to cost-basis-only."
echo

# grep -q, not grep -c: `grep -c` prints "0" *and* exits non-zero when there is no match, so a
# `|| echo 0` fallback appends a second line and the result stops being a number at all.
if grep -q '^FINNHUB_API_KEY=' "$ENV_FILE" 2>/dev/null; then HAD_KEY=1; else HAD_KEY=0; fi

echo "Click this window first, then paste the key and press return."
echo "The typing is hidden, so nothing will appear as you paste. That is normal."
echo

# -s hides the typing, the same as the password script. A key is a credential.
read -r -s -p "Finnhub API key: " KEY
echo
echo

# Strip whitespace — copying from a web page often brings a trailing space or newline with it,
# and Finnhub rejects the key without ever saying why.
KEY="$(printf '%s' "$KEY" | tr -d '[:space:]')"

# An empty answer when there was no key to begin with means the paste did not land — almost always
# because the window was not focused. Saying "key removed" there was actively misleading: it read
# as though something had been done, when in fact nothing had.
if [ -z "$KEY" ] && [ "$HAD_KEY" -eq 0 ]; then
  echo "Nothing was entered, so nothing changed."
  echo
  echo "If you meant to paste a key: click inside this window first so it has keyboard focus,"
  echo "then press Command-V and return. Run this script again to retry."
  echo
  read -r -p "Press return to close."
  exit 0
fi

if [ -n "$KEY" ]; then
  # Check the key before saving it. A typo would otherwise show up days later as "prices
  # unavailable" with nothing to indicate the key is the problem.
  echo "Checking the key against Finnhub…"
  RESPONSE="$(curl -s --max-time 15 "https://finnhub.io/api/v1/quote?symbol=AAPL&token=$KEY")"

  if [ -z "$RESPONSE" ]; then
    echo
    echo "No response from Finnhub. Check your internet connection."
    echo "Nothing was changed."
    echo
    read -r -p "Press return to close."
    exit 1
  fi

  case "$RESPONSE" in
    *"Invalid API key"* | *"401"* | *"You don't have access"*)
      echo
      echo "Finnhub rejected that key. Nothing was changed."
      echo "Check you copied the whole thing from the dashboard."
      echo
      read -r -p "Press return to close."
      exit 1
      ;;
    *'"c":0'* | *'"c": 0'*)
      # A price of exactly zero for AAPL means the key was accepted but returned nothing usable.
      echo
      echo "The key was accepted but returned no price. That usually means the free tier has"
      echo "not activated yet — wait a minute and run this again. Nothing was changed."
      echo
      read -r -p "Press return to close."
      exit 1
      ;;
  esac

  # Show the price it came back with, so you can see it is real data and not a stubbed response.
  PRICE="$(printf '%s' "$RESPONSE" | sed -n 's/.*"c":\([0-9.]*\).*/\1/p')"
  echo "  Key works — AAPL is \$$PRICE right now."
  echo
fi

touch "$ENV_FILE"
# Make sure the file ends in a newline, or the new line would be glued onto the last one.
[ -s "$ENV_FILE" ] && [ -n "$(tail -c 1 "$ENV_FILE")" ] && echo >> "$ENV_FILE"

# Drop any existing setting before writing the new one, so this can be run repeatedly.
grep -v '^FINNHUB_API_KEY=' "$ENV_FILE" > "$ENV_FILE.tmp" 2>/dev/null || true
mv "$ENV_FILE.tmp" "$ENV_FILE"

if [ -n "$KEY" ]; then
  printf "FINNHUB_API_KEY='%s'\n" "$KEY" >> "$ENV_FILE"
  echo "Key saved to .env.local — which is git-ignored, so it will not reach GitHub."
else
  echo "Key removed. The Portfolio page still works from cost basis; it just will not price."
fi

# .env.local holds this, the login password and the Databento key. Nobody else on the machine
# needs to read it.
chmod 600 "$ENV_FILE"

echo
echo "Restarting Overwatch so it picks this up…"
echo
"./Restart Overwatch.command" < /dev/null
