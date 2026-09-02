import { NextRequest, NextResponse } from "next/server";
import { fetchBars } from "@/lib/databento";
import { coverage, insertCandles, listSymbols, rebuildDerived, rebuildSubMinute, recordImport } from "@/lib/market";
import { monthChunks } from "@/lib/chunks";
import { uid } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Top a symbol up to the present: import everything between the newest stored bar and today,
 * then rebuild the derived timeframes. Safe to run repeatedly — an up-to-date symbol is a no-op,
 * and re-importing an overlapping day replaces those bars rather than duplicating them.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const only = body.symbol ? String(body.symbol).trim().toUpperCase() : null;
  const symbols = only ? [only] : listSymbols();
  if (!symbols.length) return NextResponse.json({ error: "No symbols stored yet" }, { status: 400 });

  const cov = coverage();
  const results: { symbol: string; from: string | null; to: string; bars: number; error?: string }[] = [];
  const today = day(Date.now());

  for (const symbol of symbols) {
    const base = cov.find((c) => c.symbol === symbol && c.timeframe === "1m");
    if (!base?.last) {
      results.push({ symbol, from: null, to: today, bars: 0, error: "no 1m bars stored" });
      continue;
    }

    // Start from the last stored bar's day so a partially imported day is completed.
    const from = day(base.last);
    if (from >= today) {
      results.push({ symbol, from, to: today, bars: 0 });
      continue;
    }

    let imported = 0;
    let failed: string | undefined;
    for (const chunk of monthChunks(from, today)) {
      try {
        const bars = await fetchBars({
          symbol: body.databentoSymbol ? String(body.databentoSymbol) : `${symbol}.c.0`,
          start: chunk.start,
          end: chunk.end,
        });
        imported += insertCandles(symbol, "1m", bars);
      } catch (e) {
        failed = e instanceof Error ? e.message : "Import failed";
        break;
      }
    }

    if (imported > 0) {
      rebuildDerived(symbol);
      rebuildSubMinute(symbol);
    }
    recordImport({
      id: uid("imp"),
      symbol,
      source: "update",
      startDate: from,
      endDate: today,
      bars: imported,
      status: failed ? "failed" : "complete",
      message: failed ?? `Topped up to ${today}`,
    });
    results.push({ symbol, from, to: today, bars: imported, error: failed });
  }

  return NextResponse.json({ updated: results, coverage: coverage() });
}
