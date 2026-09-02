import { NextRequest, NextResponse } from "next/server";
import { listTrades, updateTrade } from "@/lib/db";
import { getCandles, listSymbols } from "@/lib/market";
import { computeExcursion } from "@/lib/excursions";
import { tradeInstant } from "@/lib/session";
import type { TradeInput } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Fills MAE/MFE on journalled trades from stored candles.
 *
 * Trade times are read as New York time. Trades already carrying excursion data are left alone
 * unless `overwrite` is set, and everything that could not be measured is reported rather than
 * silently skipped.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const accountId = body.accountId && body.accountId !== "all" ? String(body.accountId) : null;
  const overwrite = Boolean(body.overwrite);

  const symbols = new Set(listSymbols());
  const trades = listTrades(accountId);
  const skipped = { alreadySet: 0, noPrices: 0, noSymbol: 0, noCandles: 0 };
  let updated = 0;

  for (const t of trades) {
    if (!overwrite && (t.mae !== null || t.mfe !== null)) {
      skipped.alreadySet++;
      continue;
    }
    if (t.entry === null || t.stop === null) {
      skipped.noPrices++;
      continue;
    }
    if (!symbols.has(t.instrument)) {
      skipped.noSymbol++;
      continue;
    }
    const entryTs = tradeInstant(t.date, t.time);
    if (entryTs === null) {
      skipped.noPrices++;
      continue;
    }

    const bars = getCandles(t.instrument, "1m", entryTs, entryTs + 6 * 3600000, 400);
    const ex = computeExcursion(t, bars, entryTs);
    if (!ex) {
      skipped.noCandles++;
      continue;
    }

    const { screenshots: _s, createdAt: _c, updatedAt: _u, ...rest } = t;
    void _s;
    void _c;
    void _u;
    updateTrade(t.id, { ...rest, mae: ex.mae, mfe: ex.mfe } as TradeInput);
    updated++;
  }

  return NextResponse.json({
    updated,
    skipped,
    symbolsAvailable: [...symbols],
    note: "Trade times are interpreted as US Eastern. Excursions are measured from entry until the exit, stop or target is touched, capped at six hours.",
  });
}
