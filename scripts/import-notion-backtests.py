"""
Copy the recorded tests out of the Notion backtesting export and into a journal account.

Reads "Notion Backtests.json" — the export already sitting in this project — and posts each of its
recorded tests to the app as a journal trade. Nothing is written to the database directly: it goes
through /api/trades/import, so every row is validated exactly like a manual entry or a CSV import.

Nothing in Notion is read, changed or removed. This only copies.

    python3 scripts/import-notion-backtests.py                 # into the "Backtests" account
    python3 scripts/import-notion-backtests.py --account Engine
    python3 scripts/import-notion-backtests.py --dry-run       # show the mapping, send nothing
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXPORT = os.path.join(HERE, "Notion Backtests.json")


# --------------------------------------------------------------------------- app

def request(base: str, method: str, path: str, body=None):
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


def account_id(base: str, name: str) -> str:
    accounts = request(base, "GET", "/api/accounts")
    for a in accounts:
        if a["name"].strip().lower() == name.strip().lower():
            return a["id"]
    have = ", ".join(sorted(a["name"] for a in accounts)) or "none"
    raise SystemExit(f'No account named "{name}". Accounts on this instance: {have}')


# --------------------------------------------------------------------------- mapping

# Notion and the app happen to use the same seven classifications, so these carry over exactly.
# Collapsing "Early profit" and "Partial profit" into breakeven would have lost the distinction the
# app's own win-rate setting depends on — and would have reported 3 winners where there are 6.
RESULT_CODE = {
    "win": "win",
    "loss": "loss",
    "break-even": "breakeven",
    "breakeven": "breakeven",
    "break even": "breakeven",
    "early profit": "early_profit",
    "early loss": "early_loss",
    "partial profit": "partial_profit",
    "partial loss": "partial_loss",
}

def to_24h(stamp: str) -> str | None:
    """'10:03AM' or '1:05 PM' -> '10:03' / '13:05'. Returns None if it cannot be read."""
    m = re.match(r"\s*(\d{1,2}):(\d{2})\s*([AaPp])?\.?[Mm]?", stamp or "")
    if not m:
        return None
    hour, minute, half = int(m.group(1)), int(m.group(2)), (m.group(3) or "").lower()
    if half == "p" and hour != 12:
        hour += 12
    if half == "a" and hour == 12:
        hour = 0
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    return f"{hour:02d}:{minute:02d}"


def split_duration(duration: str) -> tuple[str | None, str | None]:
    parts = re.split(r"\s*[-–—]\s*", duration or "", maxsplit=1)
    start = to_24h(parts[0]) if parts else None
    end = to_24h(parts[1]) if len(parts) > 1 else None
    return start, end


def flag(notes: str, *words: str) -> int:
    low = (notes or "").lower()
    return 1 if any(w.lower() in low for w in words) else 0


# Every spelling of each PD array seen in the journal. Substring matching is not enough here: an
# entry whose note reads "no OB overlap" was being recorded as having an order block, and
# "OB/FVG overlap" was being missed because of the slash.
PD_PATTERNS = {
    "OB": r"\border\s*blocks?\b|\bob\b",
    "BB": r"\bbreaker(?:\s*blocks?)?\b|\bbb\b",
    "FVG": r"\bd?i?fvg\b|\bfair\s*value\s*gaps?\b",
}
NEGATION = r"(?:\bno\b|\bwithout\b|\bnot\b|\black(?:ing|ed)?\b)"


def pd_parts(note: str) -> set:
    low = (note or "").lower()
    found = set()
    for name, pat in PD_PATTERNS.items():
        for m in re.finditer(pat, low):
            window = low[max(0, m.start() - 40): m.start()]
            if re.search(NEGATION + r"[^.;]{0,25}$", window):
                continue
            found.add(name)
            break
    only = re.search(r"\b(ob|order block|bb|breaker|fvg)\b[^.]{0,30}\bonly\b", low)
    if only:
        kept = {"ob": "OB", "order block": "OB", "bb": "BB",
                "breaker": "BB", "fvg": "FVG"}[only.group(1)]
        found &= {kept}
    return found


def entry_model(notes: str) -> str | None:
    low = (notes or "").lower()
    if "breaker" in low:
        return "Breaker"
    if "fvg" in low and ("overlap" in low or "ob" in low or "order block" in low):
        return "Order block"
    if "fvg" in low:
        return "FVG entry"
    if "order block" in low or re.search(r"\bob\b", low):
        return "Order block"
    return None


def to_trade(test: dict, run: dict) -> dict:
    entered, exited = split_duration(test.get("duration", ""))
    notes = test.get("notes") or ""

    r = test.get("r")
    result = RESULT_CODE.get(str(test.get("result") or "").strip().lower())
    if result is None:
        # An unrecognised label falls back to the sign of R rather than being dropped.
        result = "breakeven" if not r else ("win" if r > 0 else "loss")

    risk = test.get("risk")
    pnl = round(r * risk, 2) if isinstance(r, (int, float)) and isinstance(risk, (int, float)) else 0.0

    # Session comes from the entry time rather than the run's window: the window describes the
    # study, the clock describes this trade.
    session = None
    if entered:
        session = "NY AM" if int(entered[:2]) < 12 else "NY PM"

    detail = []
    if test.get("timeframes"):
        detail.append(f"Timeframes {test['timeframes']}.")
    if test.get("duration"):
        detail.append(f"In trade {test['duration']}.")
    if test.get("plannedRr") is not None:
        detail.append(f"Planned {test['plannedRr']}R, realised {r}R.")
    if test.get("balance") is not None:
        detail.append(f"Account balance after: {test['balance']}.")

    review = []
    if test.get("verdict"):
        review.append(f"Verdict: {test['verdict']}.")
    if test.get("sourceUrl"):
        review.append(f"Notion entry: {test['sourceUrl']}")

    return {
        "date": test["date"],
        "time": entered,
        "instrument": run.get("instrument") or "MNQ",
        "direction": str(test.get("direction") or "long").lower(),
        "result": result,
        "rMultiple": r,
        # Notion's RR column: what the trade was aiming for. Kept separate from the realised R so
        # win rate can be judged against the reward it was earned at.
        "plannedRr": test.get("plannedRr"),
        "riskAmount": risk,
        "size": test.get("size"),
        "pnl": pnl,
        "session": session,
        "strategy": run.get("strategy"),
        "setup": "Liquidity sweep reversal",
        "entryModel": entry_model(notes),
        "pdArray": " + ".join(x for x in ("OB", "BB", "FVG") if x in pd_parts(notes)) or None,
        "sessionSweep": flag(notes, "sweep"),
        "htfSweep": flag(notes, "4h", "daily", "htf"),
        "sweep1h": flag(notes, "1h", "hourly"),
        "mss": flag(notes, "mss", "market structure shift"),
        "fvg": 1 if "FVG" in pd_parts(notes) else 0,
        "orderBlock": 1 if "OB" in pd_parts(notes) else 0,
        "displacement": flag(notes, "displacement", "strong move", "impulsive"),
        "thesis": notes or None,
        "execution": " ".join(detail) or None,
        "review": " ".join(review) or None,
        "tags": ["notion", "backtest", f"test-{test.get('ref')}"],
    }


# --------------------------------------------------------------------------- main

def main() -> None:
    ap = argparse.ArgumentParser(description="Copy Notion backtest entries into a journal account.")
    ap.add_argument("--account", default="Backtests")
    ap.add_argument("--url", default=os.environ.get("OVERWATCH_URL", "http://localhost:3000"))
    ap.add_argument("--file", default=EXPORT)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not os.path.exists(args.file):
        raise SystemExit(f"No export at {args.file}")

    export = json.load(open(args.file))
    trades, sources = [], []
    for run in export.get("runs", []):
        tests = (run.get("result") or {}).get("raw", {}).get("tests") or []
        for test in tests:
            if not test.get("date"):
                continue
            trades.append(to_trade(test, run))
            sources.append(run.get("name", "?"))

    if not trades:
        raise SystemExit("The export contains no recorded tests.")

    print(f"{len(trades)} entries read from {os.path.basename(args.file)}\n")
    for t in trades:
        print(f"  {t['date']}  {t['time'] or '  —  '}  {t['direction']:<5} "
              f"{t['result']:<15} {str(t['rMultiple']):>6}R  {t['pnl']:>9.2f}")

    net_r = sum(t["rMultiple"] or 0 for t in trades)
    net = sum(t["pnl"] for t in trades)
    wins = sum(1 for t in trades if t["result"] == "win")
    print(f"\n  net {net_r:+.2f}R, {net:+,.2f}, {wins}/{len(trades)} winners")

    if args.dry_run:
        print("\nDry run — nothing sent.")
        return

    acc = account_id(args.url, args.account)

    # Skip anything already journalled. Each entry carries its Notion page URL in the review field,
    # which makes it identifiable across runs — without this, re-running after adding a few tests in
    # Notion would silently double every trade already imported.
    existing = request(args.url, "GET", f"/api/trades?accountId={urllib.parse.quote(acc)}") or []
    seen = {t.get("review") or "" for t in existing}
    fresh = [t for t in trades if not any(t["review"] and t["review"] in s for s in seen)]
    skipped = len(trades) - len(fresh)
    if skipped:
        print(f"\n  {skipped} already in '{args.account}' — skipping those.")
    if not fresh:
        print("Nothing new to import.")
        return
    trades = fresh

    out = request(args.url, "POST", "/api/trades/import", {"accountId": acc, "trades": trades})
    print(f"\nImported {out['imported']} into '{args.account}'"
          + (f", skipped {out['skipped']}" if out.get("skipped") else ""))
    for e in (out.get("errors") or [])[:10]:
        print(f"  row {e['row']}: {e['message']}")
    print("\nNothing in Notion was changed — this was a copy.")


if __name__ == "__main__":
    sys.exit(main())
