"""
Re-derive the PD array recorded on each journal entry from its own written notes.

The first import decided "was an order block involved?" by looking for the substring "ob " in the
note. That is wrong in both directions: it marked entries whose notes say *"no OB overlap"* as
having one, and missed *"OB/FVG overlap"* because of the slash. This reads the notes properly —
handling negations and the "X midpoint only" phrasing — and writes the result back.

Each trade is fetched, amended and written whole through /api/trades/{id}, so the same validation
runs as an edit made in the app. Nothing but the PD array fields is touched.

    python3 scripts/fix-pd-arrays.py --account Backtests --dry-run
    python3 scripts/fix-pd-arrays.py --account Backtests
"""

from __future__ import annotations

import argparse
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

# Every spelling of each array that appears in the journal.
PATTERNS = {
    "OB": r"\border\s*blocks?\b|\bob\b",
    "BB": r"\bbreaker(?:\s*blocks?)?\b|\bbb\b",
    "FVG": r"\bd?i?fvg\b|\bfair\s*value\s*gaps?\b",
}
NEGATION = r"(?:\bno\b|\bwithout\b|\bnot\b|\black(?:ing|ed)?\b)"


def pd_parts(note: str) -> set[str]:
    """Which PD arrays the note actually claims were present."""
    low = (note or "").lower()
    found: set[str] = set()
    for name, pat in PATTERNS.items():
        for m in re.finditer(pat, low):
            # A negation shortly before the mention governs it: "no OB overlap mentioned".
            window = low[max(0, m.start() - 40): m.start()]
            if re.search(NEGATION + r"[^.;]{0,25}$", window):
                continue
            found.add(name)
            break
    # "FVG midpoint only" states that nothing else was there, however the rest of the note reads.
    only = re.search(r"\b(ob|order block|bb|breaker|fvg)\b[^.]{0,30}\bonly\b", low)
    if only:
        kept = {"ob": "OB", "order block": "OB", "bb": "BB",
                "breaker": "BB", "fvg": "FVG"}[only.group(1)]
        found &= {kept}
    return found


def label(parts: set[str]) -> str | None:
    ordered = [p for p in ("OB", "BB", "FVG") if p in parts]
    return " + ".join(ordered) or None


def stacked(parts: set[str]) -> bool:
    return "FVG" in parts and bool({"OB", "BB"} & parts)


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


def main() -> None:
    ap = argparse.ArgumentParser(description="Re-derive PD arrays from trade notes.")
    ap.add_argument("--account", default="Backtests")
    ap.add_argument("--url", default=os.environ.get("OVERWATCH_URL", "http://localhost:3000"))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    accounts = request(args.url, "GET", "/api/accounts")
    match = next((a for a in accounts if a["name"].strip().lower() == args.account.strip().lower()), None)
    if not match:
        raise SystemExit(f'No account named "{args.account}".')

    trades = request(args.url, "GET", f"/api/trades?accountId={urllib.parse.quote(match['id'])}") or []
    trades.sort(key=lambda t: t.get("date") or "")

    changed = 0
    print(f"{'date':<12} {'was':<18} {'now':<18} tick")
    print("-" * 62)
    for t in trades:
        parts = pd_parts(t.get("thesis") or "")
        want = {
            "pdArray": label(parts),
            "fvg": 1 if "FVG" in parts else 0,
            "orderBlock": 1 if "OB" in parts else 0,
        }
        was = t.get("pdArray") or (
            " + ".join(x for x in (["OB"] if t.get("orderBlock") else []) + (["FVG"] if t.get("fvg") else [])) or "—"
        )
        if all(t.get(k) == v for k, v in want.items()):
            continue
        changed += 1
        print(f"{t['date']:<12} {was:<18} {want['pdArray'] or '—':<18} {'✓' if stacked(parts) else ''}")
        if not args.dry_run:
            request(args.url, "PUT", f"/api/trades/{t['id']}", {**t, **want})

    ticks = sum(1 for t in trades if stacked(pd_parts(t.get("thesis") or "")))
    print(f"\n  {changed} of {len(trades)} corrected · {ticks} entries have a stacked PD array")
    if args.dry_run:
        print("\nDry run — nothing written.")


if __name__ == "__main__":
    main()
