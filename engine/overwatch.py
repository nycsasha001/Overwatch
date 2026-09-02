"""
Overwatch client — read candles, write trades and backtest runs.

Zero dependencies: standard library only, so it drops into any Python project without touching
your environment. Everything talks to the app you already run at localhost:3000.

    from overwatch import Overwatch

    ow = Overwatch()
    bars = ow.candles("MNQ", "1m", "2026-03-01", "2026-04-01")
    ...
    ow.log_trades(my_trades, account="Engine")
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterable, Sequence

DEFAULT_BASE = "http://localhost:3000"


class OverwatchError(RuntimeError):
    pass


@dataclass
class Trade:
    """One completed trade. Only date, instrument, direction and result are required."""

    date: str                      # YYYY-MM-DD, New York time
    instrument: str
    direction: str                 # "long" | "short"
    result: str                    # win | loss | breakeven | early_profit | early_loss |
                                   # partial_profit | partial_loss
    time: str | None = None        # HH:MM, New York time — when it was entered
    exitTime: str | None = None    # HH:MM, New York time — when it was closed
    entry: float | None = None
    stop: float | None = None
    target: float | None = None
    exit: float | None = None
    size: float | None = None      # contracts
    riskAmount: float | None = None
    riskPct: float | None = None
    pnl: float = 0.0
    rMultiple: float | None = None
    mae: float | None = None       # in R, how far it went against you
    mfe: float | None = None       # in R, best unrealised move in your favour
    fees: float | None = None
    session: str | None = None
    strategy: str | None = None
    setup: str | None = None
    entryModel: str | None = None
    pdArray: str | None = None
    liquidityTarget: str | None = None
    htfSweep: bool = False
    sweep4h: bool = False
    sweep1h: bool = False
    sweep15m: bool = False
    sessionSweep: bool = False
    mss: bool = False
    fvg: bool = False
    orderBlock: bool = False
    displacement: bool = False
    thesis: str | None = None
    execution: str | None = None
    review: str | None = None
    mistakes: str | None = None
    emotions: str | None = None
    reason: str | None = None      # why the trade was taken
    exitReason: str | None = None  # stop / target / manual / time
    timeframes: str | None = None  # e.g. "1H bias, 1m entry"
    tags: list[str] = field(default_factory=lambda: ["engine", "backtest"])

    def payload(self) -> dict[str, Any]:
        """
        Journal payload. Fields the journal does not store natively — exit time, why it was taken,
        how it closed — are folded into the notes so nothing is lost.
        """
        d = {k: v for k, v in asdict(self).items() if v is not None}
        extra = d.pop("reason", None)
        exit_reason = d.pop("exitReason", None)
        timeframes = d.pop("timeframes", None)
        exit_time = d.pop("exitTime", None)

        if extra and not d.get("thesis"):
            d["thesis"] = extra
        elif extra:
            d["thesis"] = f"{extra}\n\n{d['thesis']}"

        held = []
        if self.time and exit_time:
            held.append(f"Entered {self.time}, exited {exit_time} (New York).")
        elif self.time:
            held.append(f"Entered {self.time} (New York).")
        if exit_reason:
            held.append(f"Closed on the {exit_reason}.")
        if timeframes:
            held.append(f"Timeframes: {timeframes}.")
        if held:
            note = " ".join(held)
            d["execution"] = f"{note}\n\n{d['execution']}" if d.get("execution") else note
        return d


class Overwatch:
    def __init__(self, base: str = DEFAULT_BASE, timeout: int = 120):
        self.base = base.rstrip("/")
        self.timeout = timeout

    # ------------------------------------------------------------------ http

    def _request(self, method: str, path: str, body: Any | None = None, params: dict | None = None) -> Any:
        url = f"{self.base}{path}"
        if params:
            url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(url, data=data, method=method)
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                raw = res.read().decode()
        except urllib.error.HTTPError as e:
            detail = e.read().decode()[:400]
            raise OverwatchError(f"{method} {path} → {e.code}: {detail}") from None
        except urllib.error.URLError as e:
            raise OverwatchError(
                f"Could not reach Overwatch at {self.base} ({e.reason}). Is the app running?"
            ) from None
        return json.loads(raw) if raw else None

    # --------------------------------------------------------------- candles

    def candles(
        self,
        symbol: str,
        timeframe: str = "1m",
        start: str | None = None,
        end: str | None = None,
        limit: int = 50000,
    ) -> list[dict[str, Any]]:
        """
        Bars from the app's store — the same ones the charts and replay use, with daily, weekly
        and 4H anchored to the 18:00 ET CME session open.

        Timestamps come back as epoch milliseconds UTC at the bar's open.
        """
        out = self._request(
            "GET",
            "/api/candles",
            params={"symbol": symbol, "tf": timeframe, "from": start, "to": end, "limit": limit},
        )
        return out["candles"]

    def coverage(self) -> list[dict[str, Any]]:
        """What is stored, per symbol and timeframe."""
        return self._request("GET", "/api/market/coverage")["coverage"]

    # -------------------------------------------------------------- accounts

    def account_id(self, name: str, starting_balance: float = 100000, account_type: str = "paper") -> str:
        """
        Find an account by name, creating it if it does not exist.

        Engine trades belong in their own paper account: mixing simulated fills into a live
        account quietly corrupts every statistic that account produces.
        """
        for a in self._request("GET", "/api/accounts"):
            if a["name"].lower() == name.lower():
                return a["id"]
        created = self._request(
            "POST",
            "/api/accounts",
            {"name": name, "type": account_type, "startingBalance": starting_balance, "currency": "USD"},
        )
        return created["id"]

    # ---------------------------------------------------------------- trades

    def log_trades(
        self,
        trades: Sequence[Trade | dict[str, Any]],
        account: str = "Engine",
        starting_balance: float = 100000,
    ) -> dict[str, Any]:
        """
        Write trades into the journal. Rows that fail validation are skipped and reported rather
        than silently dropped. Re-running a backtest appends — clear the account first if you want
        a clean slate.
        """
        payload = [t.payload() if isinstance(t, Trade) else dict(t) for t in trades]
        if not payload:
            return {"imported": 0, "skipped": 0, "errors": []}
        return self._request(
            "POST",
            "/api/trades/import",
            {"accountId": self.account_id(account, starting_balance), "trades": payload},
        )

    def backfill_excursions(self, account: str = "Engine", overwrite: bool = False) -> dict[str, Any]:
        """
        Fill MAE and MFE from stored candles for trades that did not supply them. Cheaper than
        computing excursions in the engine, and it uses exactly the same bars.
        """
        return self._request(
            "POST",
            "/api/trades/backfill-excursions",
            {"accountId": self.account_id(account), "overwrite": overwrite},
        )

    # ------------------------------------------------------------- backtests

    def save_run(
        self,
        name: str,
        trades: Iterable[Trade | dict[str, Any]],
        *,
        strategy: str | None = None,
        instrument: str | None = None,
        start: str | None = None,
        end: str | None = None,
        params: dict[str, Any] | None = None,
        note: str | None = None,
    ) -> dict[str, Any]:
        """
        Store a run in the Backtesting journal with its aggregates and every individual test,
        so the write-ups sit beside the numbers.
        """
        originals = list(trades)
        rows = [t.payload() if isinstance(t, Trade) else dict(t) for t in originals]
        wins = [t for t in rows if (t.get("rMultiple") or 0) > 0.05]
        losses = [t for t in rows if (t.get("rMultiple") or 0) < -0.05]
        gross_profit = sum(t.get("pnl", 0) for t in rows if t.get("pnl", 0) > 0)
        gross_loss = -sum(t.get("pnl", 0) for t in rows if t.get("pnl", 0) < 0)

        cum = peak = maxdd = 0.0
        equity: list[float] = []
        for t in rows:
            r = t.get("rMultiple") or 0
            equity.append(r)
            cum += r
            peak = max(peak, cum)
            maxdd = max(maxdd, peak - cum)

        def planned_rr(t: Trade | dict[str, Any]) -> float | None:
            g = (lambda k: getattr(t, k, None)) if isinstance(t, Trade) else t.get
            entry, stop, target = g("entry"), g("stop"), g("target")
            if entry is None or stop is None or target is None:
                return None
            risk = abs(entry - stop)
            return round(abs(target - entry) / risk, 2) if risk else None

        detail = []
        for i, (orig, row) in enumerate(zip(originals, rows)):
            g = (lambda k: getattr(orig, k, None)) if isinstance(orig, Trade) else orig.get
            entered, exited = g("time"), g("exitTime")
            window = f"{entered} → {exited}" if entered and exited else entered
            notes = " ".join(
                x for x in [g("reason"), row.get("thesis") if not g("reason") else None, g("exitReason") and f"Closed on the {g('exitReason')}."] if x
            ).strip()
            detail.append(
                {
                    "ref": str(i + 1),
                    "date": row.get("date"),
                    "direction": row.get("direction"),
                    "result": row.get("result"),
                    "r": row.get("rMultiple"),
                    "plannedRr": planned_rr(orig),
                    "risk": row.get("riskAmount"),
                    "size": row.get("size"),
                    "balance": None,
                    "duration": window,
                    "timeframes": g("timeframes"),
                    "verdict": None,
                    "notes": notes or None,
                    "sourceUrl": None,
                }
            )

        result = {
            "trades": len(rows),
            "netR": round(sum(t.get("rMultiple") or 0 for t in rows), 2),
            "netPnl": round(sum(t.get("pnl", 0) for t in rows), 2),
            "winRate": round(len(wins) / max(len(wins) + len(losses), 1) * 100, 1),
            "profitFactor": round(gross_profit / gross_loss, 2) if gross_loss else None,
            "maxDrawdownR": round(maxdd, 2),
            "equityR": equity,
            "raw": {"tests": detail},
        }

        return self._request(
            "POST",
            "/api/backtests/import",
            {
                "runs": [
                    {
                        "name": name,
                        "strategy": strategy,
                        "instrument": instrument,
                        "startDate": start,
                        "endDate": end,
                        "params": params or {},
                        "engineNote": note
                        or (
                            "Produced by the backtesting engine on "
                            f"{datetime.now(timezone.utc).date().isoformat()} — simulated fills, not live trades."
                        ),
                        "result": result,
                    }
                ]
            },
        )
