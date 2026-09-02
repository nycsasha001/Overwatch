import { NextRequest, NextResponse } from "next/server";
import { coverage, rebuildDerived, rebuildSubMinute, recordImport } from "@/lib/market";
import { uid } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Rebuilds 2m…1w from the stored 1m bars. Run once after an import finishes. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const symbol = String(body.symbol ?? "").trim().toUpperCase();
  if (!symbol) return NextResponse.json({ error: "A symbol is required" }, { status: 400 });

  const counts = { ...rebuildDerived(symbol), ...rebuildSubMinute(symbol) };
  if (!counts["1m"] && !counts["1s"]) {
    return NextResponse.json({ error: `No 1m or 1s bars stored for ${symbol}` }, { status: 400 });
  }

  const cov = coverage(symbol);
  const daily = cov.find((c) => c.timeframe === "1d");
  recordImport({
    id: uid("imp"),
    symbol,
    source: "aggregate",
    bars: counts["1m"] ?? 0,
    status: "complete",
    startDate: daily?.first ? new Date(daily.first).toISOString().slice(0, 10) : null,
    endDate: daily?.last ? new Date(daily.last).toISOString().slice(0, 10) : null,
    message: `Rebuilt timeframes from ${(counts["1m"] ?? 0).toLocaleString()} one-minute bars${counts["1s"] ? ` and ${counts["1s"].toLocaleString()} one-second bars` : ""}`,
  });
  return NextResponse.json({ symbol, counts, coverage: cov });
}
