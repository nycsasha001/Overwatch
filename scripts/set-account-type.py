"""
Change what an account is for.

The type decides which rules apply, whether the account's numbers belong in a real track record,
and how the Accounts page groups it. This goes through the app's own API, so the same validation
runs as when the type is changed from Settings.

    python3 scripts/set-account-type.py --account Backtests --type backtest
    python3 scripts/set-account-type.py --list
"""

from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.request

TYPES = ["personal", "evaluation", "funded", "paper", "backtest"]


def request(base: str, method: str, path: str, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            raw = res.read().decode()
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} → {e.code}: {e.read().decode()[:300]}") from None
    except urllib.error.URLError as e:
        raise SystemExit(f"Could not reach Overwatch at {base} ({e.reason}). Is the app running?") from None
    return json.loads(raw) if raw else None


def main() -> None:
    ap = argparse.ArgumentParser(description="Change an account's type.")
    ap.add_argument("--account")
    ap.add_argument("--type", choices=TYPES)
    ap.add_argument("--url", default=os.environ.get("OVERWATCH_URL", "http://localhost:3000"))
    ap.add_argument("--list", action="store_true", help="show every account and its type")
    args = ap.parse_args()

    accounts = request(args.url, "GET", "/api/accounts")

    if args.list or not (args.account and args.type):
        print("Accounts on this instance:\n")
        for a in accounts:
            print(f"  {a['name']:<20} {a['type']}")
        if not (args.account and args.type):
            print("\nPass --account NAME --type TYPE to change one.")
        return

    match = next((a for a in accounts if a["name"].strip().lower() == args.account.strip().lower()), None)
    if not match:
        have = ", ".join(sorted(a["name"] for a in accounts)) or "none"
        raise SystemExit(f'No account named "{args.account}". Accounts: {have}')

    if match["type"] == args.type:
        print(f"'{match['name']}' is already a {args.type} account. Nothing to do.")
        return

    was = match["type"]
    updated = request(args.url, "PATCH", f"/api/accounts/{match['id']}", {"type": args.type})
    print(f"'{updated['name']}': {was} → {updated['type']}")
    print("\nTrades are untouched — only what the account is classified as has changed.")


if __name__ == "__main__":
    main()
