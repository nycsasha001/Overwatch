#!/bin/bash
# Turn the login on (or off), without the password passing through anything but this window.
#
# It is typed here, written straight into .env.local, and never echoed, logged, or shown again.
cd "$(dirname "$0")" || exit 1
ENV_FILE=".env.local"

echo "Overwatch — set the login password"
echo
echo "Leave it blank to remove the password and go back to no login."
echo

# -s hides the typing. Asking twice because a password you cannot see is a password you can typo,
# and getting it wrong here locks you out of your own journal until you run this again.
read -r -s -p "New password: " PW1
echo
read -r -s -p "Type it again: " PW2
echo
echo

if [ "$PW1" != "$PW2" ]; then
  echo "Those did not match. Nothing was changed."
  echo
  read -r -p "Press return to close."
  exit 1
fi

if [ -n "$PW1" ] && [ ${#PW1} -lt 8 ]; then
  echo "Use at least 8 characters. Nothing was changed."
  echo
  read -r -p "Press return to close."
  exit 1
fi

touch "$ENV_FILE"
# Make sure the file ends in a newline, or the new line would be glued onto the last one.
[ -s "$ENV_FILE" ] && [ -n "$(tail -c 1 "$ENV_FILE")" ] && echo >> "$ENV_FILE"

# Drop any existing setting before writing the new one, so this can be run repeatedly.
grep -v '^APP_PASSWORD=' "$ENV_FILE" > "$ENV_FILE.tmp" 2>/dev/null || true
mv "$ENV_FILE.tmp" "$ENV_FILE"

if [ -n "$PW1" ]; then
  # Single-quoted so spaces and symbols survive; any literal quote in the password is escaped.
  ESCAPED=$(printf '%s' "$PW1" | sed "s/'/'\\\\''/g")
  printf "APP_PASSWORD='%s'\n" "$ESCAPED" >> "$ENV_FILE"
  echo "Password set."
else
  echo "Password removed — the app will not ask for a login."
fi

# .env.local holds this and the Databento key; nobody else on the machine needs to read it.
chmod 600 "$ENV_FILE"

echo "Restarting Overwatch so it picks this up…"
echo
"./Restart Overwatch.command" < /dev/null
