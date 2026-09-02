import { NextRequest, NextResponse } from "next/server";
import { DatabentoError, fetchBars } from "@/lib/databento";
import { insertCandles, recordImport, storedRange } from "@/lib/market";
import { daysBetween, daysIn, missingRanges } from "@/lib/gaps";
import { uid } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Databento's `end` is exclusive, so an inclusive last day has to be advanced by one. */
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

/**
 * Imports ONE window of 1-minute bars. The client walks month by month so that a failure costs a
 * single month rather than the whole range, and so progress is visible while it runs.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const symbol = String(body.symbol ?? "").trim().toUpperCase();
  const dbSymbol = String(body.databentoSymbol ?? `${symbol}.c.0`).trim();
  const start = String(body.start ?? "");
  const end = String(body.end ?? "");
  if (!symbol) return NextResponse.json({ error: "A symbol is required" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return NextResponse.json({ error: "start and end must be YYYY-MM-DD" }, { status: 400 });
  }

  // Databento's finest OHLCV schema is one second; 30s bars are built from it afterwards.
  const schema = body.schema === "ohlcv-1s" ? "ohlcv-1s" : "ohlcv-1m";
  const storeAs = schema === "ohlcv-1s" ? "1s" : "1m";

  /**
   * Never buy the same bars twice.
   *
   * Databento bills per request on the streaming endpoint, so asking again for a range already on
   * disk is paid for again. Nothing here checked, which made it possible to re-download five years
   * of one-minute data — 1.7 million bars already stored — without a word of warning.
   *
   * Only the days genuinely absent are fetched. `force` exists for the case where stored data is
   * known to be wrong and has to be replaced, and it has to be asked for explicitly.
   */
  const force = body.force === true;
  const stored = force ? { first: null, last: null } : storedRange(symbol, storeAs);
  const gaps = missingRanges(start, end, stored);

  if (!gaps.length) {
    return NextResponse.json({
      symbol,
      start,
      end,
      timeframe: storeAs,
      bars: 0,
      skipped: true,
      reason: `Already stored — ${symbol} ${storeAs} covers ${start} to ${end}. Nothing was requested from Databento.`,
      first: null,
      last: null,
    });
  }

  // The client walks one window at a time, so this request covers the first gap inside it and
  // reports the rest back for the caller to continue with.
  const [first, ...rest] = gaps;

  try {
    const bars = await fetchBars({
      symbol: dbSymbol,
      dataset: body.dataset ? String(body.dataset) : undefined,
      stypeIn: body.stypeIn ? String(body.stypeIn) : undefined,
      schema,
      start: first.start,
      // Databento treats `end` as exclusive, and the gap is an inclusive day range.
      end: nextDay(first.end),
    });
    const written = insertCandles(symbol, storeAs, bars);
    return NextResponse.json({
      symbol,
      start: first.start,
      end: first.end,
      requestedStart: start,
      requestedEnd: end,
      timeframe: storeAs,
      bars: written,
      skipped: false,
      // Days inside the requested window that were already on disk and cost nothing.
      skippedDays: daysBetween(start, end).length - daysIn(gaps),
      // Any further gaps in this window, for the caller to walk through.
      remaining: rest,
      first: bars[0]?.ts ?? null,
      last: bars[bars.length - 1]?.ts ?? null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Import failed";
    recordImport({
      id: uid("imp"),
      symbol,
      source: "databento",
      dataset: body.dataset ? String(body.dataset) : null,
      startDate: start,
      endDate: end,
      bars: 0,
      status: "failed",
      message,
    });
    return NextResponse.json({ error: message }, { status: e instanceof DatabentoError && e.status === 401 ? 401 : 502 });
  }
}
