"""
Fill in the planned reward-to-risk on trades that were imported before the field existed.

The value is already recorded in Notion's RR column and sits in the export; this reads it back and
writes it onto the matching journal entry. Trades are matched on their Notion page URL, so only
entries that came from that import are touched, and anything that already has a planned RR is left
alone.

    python3 scripts/backfill-planned-rr.py --account Backtests --dry-run
    python3 scripts/backfill-planned-rr.py --account Backtests
"""

from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def request(base, method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            raw = res.read().decode()
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} → {e.code}: {e.read().decode()[:300]}") from None
    except urllib.error.URLError as e:
        raise SystemExit(f"Could not reach Overwatch at {base} ({e.reason}). Is the app running?") from None
    return json.loads(raw) if raw else None


def main() -> None:
    ap = argparse.ArgumentParser(description="Backfill planned R:R from the Notion export.")
    ap.add_argument("--account", default="Backtests")
    ap.add_argument("--file", default=os.path.join(HERE, "Notion Backtests.json"))
    ap.add_argument("--url", default=os.environ.get("OVERWATCH_URL", "http://localhost:3000"))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    export = json.load(open(args.file))
    by_page = {}
    for run in export.get("runs", []):
        for test in (run.get("result") or {}).get("raw", {}).get("tests") or []:
            if test.get("sourceUrl") and test.get("plannedRr") is not None:
                by_page[test["sourceUrl"]] = test["plannedRr"]

    accounts = request(args.url, "GET", "/api/accounts")
    match = next((a for a in accounts if a["name"].strip().lower() == args.account.strip().lower()), None)
    if not match:
        raise SystemExit(f'No account named "{args.account}".')

    trades = request(args.url, "GET", f"/api/trades?accountId={urllib.parse.quote(match['id'])}") or []
    trades.sort(key=lambda t: t.get("date") or "")

    changed = 0
    print(f"{'date':<12} {'planned':>8}  {'realised':>9}   reached target?")
    print("-" * 52)
    for t in trades:
        review = t.get("review") or ""
        page = next((u for u in by_page if u and u in review), None)
        if not page:
            continue
        want = by_page[page]
        realised = t.get("rMultiple")
        hit = "" if realised is None else ("yes" if realised >= want else "no")
        print(f"{t['date']:<12} {want:>8}  {str(realised):>9}   {hit}")
        if t.get("plannedRr") == want:
            continue
        changed += 1
        if not args.dry_run:
            request(args.url, "PUT", f"/api/trades/{t['id']}", {**t, "plannedRr": want})

    print(f"\n  {changed} of {len(trades)} updated")
    if args.dry_run:
        print("\nDry run — nothing written.")


if __name__ == "__main__":
    main()
