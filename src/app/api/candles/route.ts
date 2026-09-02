import { NextRequest, NextResponse } from "next/server";
import { getCandles } from "@/lib/market";
import { TIMEFRAMES, Timeframe } from "@/lib/aggregate";

export const dynamic = "force-dynamic";

/**
 * Windowed candle reads. Used by the chart, and by an external engine so that both work from
 * exactly the same bars.
 *
 * GET /api/candles?symbol=MNQ&tf=1m&from=2026-01-01&to=2026-02-01&limit=5000
 * Timestamps may be YYYY-MM-DD, an ISO datetime, or epoch milliseconds.
 */
const parseTime = (v: string | null): number | undefined => {
  if (!v) return undefined;
  if (/^\d+$/.test(v)) return Number(v);
  const ms = Date.parse(v.length === 10 ? `${v}T00:00:00Z` : v);
  return Number.isFinite(ms) ? ms : undefined;
};

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const symbol = (q.get("symbol") ?? "").trim().toUpperCase();
  const tf = (q.get("tf") ?? "1m") as Timeframe;
  if (!symbol) return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  if (!TIMEFRAMES.includes(tf)) {
    return NextResponse.json({ error: `tf must be one of ${TIMEFRAMES.join(", ")}` }, { status: 400 });
  }
  const limit = Math.min(Math.max(Number(q.get("limit") ?? 5000), 1), 50000);
  const candles = getCandles(symbol, tf, parseTime(q.get("from")), parseTime(q.get("to")), limit);
  return NextResponse.json({ symbol, timeframe: tf, count: candles.length, candles });
}
