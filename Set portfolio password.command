#!/bin/bash
# Put a second password in front of the Portfolio page.
#
# Typed here, written straight into .env.local, never echoed or logged. .env.local is git-ignored,
# so it cannot reach GitHub.
cd "$(dirname "$0")" || exit 1
ENV_FILE=".env.local"

echo "Overwatch — set the Portfolio page password"
echo
echo "This is a SECOND password, separate from your login. The Portfolio page asks for it every"
echo "time you open it, and locks itself again the moment you navigate away."
echo
echo "Leave it blank to remove the lock and let Portfolio behave like every other page."
echo

if grep -q '^PORTFOLIO_PASSWORD=' "$ENV_FILE" 2>/dev/null; then HAD=1; else HAD=0; fi

echo "Click this window first, then type the password and press return."
echo "The typing is hidden, so nothing will appear. That is normal."
echo

read -r -s -p "Portfolio password: " PW1
echo
read -r -s -p "Type it again: " PW2
echo
echo

if [ -z "$PW1" ] && [ "$HAD" -eq 0 ]; then
  echo "Nothing was entered, so nothing changed."
  echo
  echo "If you meant to set one: click inside this window first so it has keyboard focus, then"
  echo "type the password and press return. Run this script again to retry."
  echo
  read -r -p "Press return to close."
  exit 0
fi

if [ "$PW1" != "$PW2" ]; then
  echo "Those did not match. Nothing was changed."
  echo
  read -r -p "Press return to close."
  exit 1
fi

if [ -n "$PW1" ]; then
  if [ ${#PW1} -lt 6 ]; then
    echo "Use at least 6 characters. Nothing was changed."
    echo
    read -r -p "Press return to close."
    exit 1
  fi

  # A second copy of the same password is not a second lock — it is the same lock, asked twice.
  MAIN="$(grep '^APP_PASSWORD=' "$ENV_FILE" 2>/dev/null | sed "s/^APP_PASSWORD=//; s/^'//; s/'$//")"
  if [ -n "$MAIN" ] && [ "$PW1" = "$MAIN" ]; then
    echo "That is the same as your login password, which defeats the point of a second one."
    echo "Nothing was changed. Run this again with something different."
    echo
    read -r -p "Press return to close."
    exit 1
  fi
fi

touch "$ENV_FILE"
[ -s "$ENV_FILE" ] && [ -n "$(tail -c 1 "$ENV_FILE")" ] && echo >> "$ENV_FILE"

grep -v '^PORTFOLIO_PASSWORD=' "$ENV_FILE" > "$ENV_FILE.tmp" 2>/dev/null || true
mv "$ENV_FILE.tmp" "$ENV_FILE"

if [ -n "$PW1" ]; then
  ESCAPED=$(printf '%s' "$PW1" | sed "s/'/'\\\\''/g")
  printf "PORTFOLIO_PASSWORD='%s'\n" "$ESCAPED" >> "$ENV_FILE"
  echo "Set. The Portfolio page will ask for this every time you open it."
else
  echo "Removed. Portfolio is no longer separately locked."
fi

chmod 600 "$ENV_FILE"

echo
echo "Restarting Overwatch so it picks this up…"
echo
"./Restart Overwatch.command" < /dev/null
