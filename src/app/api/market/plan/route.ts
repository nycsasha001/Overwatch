import { NextRequest, NextResponse } from "next/server";
import { storedRange } from "@/lib/market";
import { daysBetween, daysIn, missingRanges } from "@/lib/gaps";
import type { Timeframe } from "@/lib/aggregate";

export const dynamic = "force-dynamic";

/**
 * What an import would actually fetch — without fetching anything.
 *
 * Databento bills per request on the streaming endpoint, so the expensive mistake is asking for a
 * range you already own. This answers that question for free, before any money is spent.
 *
 * GET /api/market/plan?symbol=MNQ&start=2021-01-01&end=2026-08-13&schema=ohlcv-1m
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const symbol = (q.get("symbol") ?? "").trim().toUpperCase();
  const start = q.get("start") ?? "";
  const end = q.get("end") ?? "";
  const storeAs: Timeframe = q.get("schema") === "ohlcv-1s" ? "1s" : "1m";

  if (!symbol) return NextResponse.json({ error: "A symbol is required" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return NextResponse.json({ error: "start and end must be YYYY-MM-DD" }, { status: 400 });
  }

  const stored = storedRange(symbol, storeAs);
  const gaps = missingRanges(start, end, stored);
  const requested = daysBetween(start, end).length;
  const toFetch = daysIn(gaps);

  return NextResponse.json({
    symbol,
    timeframe: storeAs,
    requestedDays: requested,
    alreadyStoredDays: requested - toFetch,
    daysToFetch: toFetch,
    gaps,
    summary: toFetch
      ? `${toFetch} of ${requested} days are missing and would be downloaded; ${requested - toFetch} are already stored and cost nothing.`
      : `All ${requested} days are already stored. Importing this range would download nothing.`,
  });
}
