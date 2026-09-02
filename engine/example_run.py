"""
A worked example of the plumbing — not a strategy.

It pulls candles from Overwatch, walks them, and posts whatever your rule produced. The rule here
is deliberately trivial and has no edge; replace `find_setups` with your engine's own logic.

    python3 engine/example_run.py --dry-run     # prints what it would send
    python3 engine/example_run.py               # actually writes to the journal
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone

from overwatch import Overwatch, Trade

ET_OFFSET_NOTE = "Times are written as New York time, which is how the journal reads them."


def to_ny(ms: int) -> tuple[str, str]:
    """Epoch ms → (YYYY-MM-DD, HH:MM) in New York."""
    from zoneinfo import ZoneInfo

    dt = datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone(ZoneInfo("America/New_York"))
    return dt.strftime("%Y-%m-%d"), dt.strftime("%H:%M")


def find_setups(bars: list[dict]) -> list[dict]:
    """
    Placeholder. Returns at most three trades so the example stays small.

    Yours would detect the sweep, the market structure shift and the entry, and return the same
    shape: an entry bar, a stop, a target, and the bar it closed on.
    """
    out = []
    for i in range(2, min(len(bars), 400)):
        a, c = bars[i - 2], bars[i]
        if c["low"] > a["high"]:  # a bullish imbalance, purely as something to point at
            entry = c["close"]
            stop = a["high"]
            risk = entry - stop
            if risk <= 0:
                continue
            out.append({"bar": c, "entry": entry, "stop": stop, "target": entry + risk * 2})
        if len(out) >= 3:
            break
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol", default="MNQ")
    ap.add_argument("--tf", default="1m")
    ap.add_argument("--start", default="2026-03-02")
    ap.add_argument("--end", default="2026-03-06")
    ap.add_argument("--account", default="Engine")
    ap.add_argument("--contracts", type=int, default=2)
    ap.add_argument("--point-value", type=float, default=2.0, help="MNQ is $2 a point")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    ow = Overwatch()
    bars = ow.candles(args.symbol, args.tf, args.start, args.end)
    print(f"{len(bars):,} {args.tf} bars for {args.symbol} between {args.start} and {args.end}")
    if not bars:
        print("Nothing stored for that range — import it on the Market data page first.")
        return

    by_ts = {b["ts"]: i for i, b in enumerate(bars)}
    trades: list[Trade] = []

    for setup in find_setups(bars):
        entry, stop, target = setup["entry"], setup["stop"], setup["target"]
        risk_points = abs(entry - stop)
        risk_dollars = risk_points * args.point_value * args.contracts
        start_i = by_ts[setup["bar"]["ts"]] + 1

        # Walk forward exactly as the replay does, and take the pessimistic reading: a bar that
        # touches both levels is a stop, because a minute bar cannot say which came first.
        exit_price, exit_bar, reason = None, None, "open"
        mae = mfe = 0.0
        for b in bars[start_i : start_i + 360]:
            mae = max(mae, (entry - b["low"]) / risk_points)
            mfe = max(mfe, (b["high"] - entry) / risk_points)
            hit_stop = b["low"] <= stop
            hit_target = b["high"] >= target
            if hit_stop:
                exit_price, exit_bar, reason = (min(b["open"], stop) if b["open"] <= stop else stop), b, "stop"
                break
            if hit_target:
                exit_price, exit_bar, reason = (max(b["open"], target) if b["open"] >= target else target), b, "target"
                break

        if exit_price is None or exit_bar is None:
            continue

        r = (exit_price - entry) / risk_points
        date, time = to_ny(setup["bar"]["ts"])
        trades.append(
            Trade(
                date=date,
                time=time,
                instrument=args.symbol,
                direction="long",
                entry=round(entry, 2),
                stop=round(stop, 2),
                target=round(target, 2),
                exit=round(exit_price, 2),
                size=args.contracts,
                riskAmount=round(risk_dollars, 2),
                result="win" if r > 0.05 else "loss" if r < -0.05 else "breakeven",
                pnl=round(r * risk_dollars, 2),
                rMultiple=round(r, 3),
                mae=round(mae, 3),
                mfe=round(mfe, 3),
                strategy="Example plumbing",
                setup="Imbalance",
                fvg=True,
                execution=f"Closed on the {reason}. {ET_OFFSET_NOTE}",
                tags=["engine", "example"],
            )
        )

    print(f"{len(trades)} trades produced")
    for t in trades:
        print(f"  {t.date} {t.time}  {t.direction:5} {t.rMultiple:+.2f}R  ${t.pnl:+,.2f}  mae {t.mae}R  mfe {t.mfe}R")

    if args.dry_run:
        print("\nDry run — nothing was written. Drop --dry-run to log these.")
        return
    if not trades:
        return

    logged = ow.log_trades(trades, account=args.account)
    print(f"\nJournal: imported {logged['imported']}, skipped {logged['skipped']}")
    run = ow.save_run(
        f"{args.symbol} example — {args.start} to {args.end}",
        trades,
        strategy="Example plumbing",
        instrument=args.symbol,
        start=args.start,
        end=args.end,
        params={"contracts": args.contracts, "timeframe": args.tf},
    )
    print(f"Backtesting journal: {run['imported']} run stored")


if __name__ == "__main__":
    main()
