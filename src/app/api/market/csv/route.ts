import { NextRequest, NextResponse } from "next/server";
import { parseCsv } from "@/lib/csv";
import { insertCandles, recordImport } from "@/lib/market";
import { uid } from "@/lib/db";
import { Candle } from "@/lib/aggregate";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Import 1-minute bars from a CSV — a Databento batch download, or an export from any other
 * source. Recognised headers: ts/timestamp/time/date, open, high, low, close, volume.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const symbol = String(form.get("symbol") ?? "").trim().toUpperCase();
  const file = form.get("file");
  if (!symbol) return NextResponse.json({ error: "A symbol is required" }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const rows = parseCsv(await file.text());
  if (rows.length < 2) return NextResponse.json({ error: "That file has no data rows" }, { status: 400 });

  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
  const idx = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const iTs = idx("ts", "timestamp", "time", "date", "datetime", "tsevent", "opentime");
  const iO = idx("open", "o");
  const iH = idx("high", "h");
  const iL = idx("low", "l");
  const iC = idx("close", "c");
  const iV = idx("volume", "vol", "v");

  const missing = [
    iTs < 0 && "timestamp",
    iO < 0 && "open",
    iH < 0 && "high",
    iL < 0 && "low",
    iC < 0 && "close",
  ].filter(Boolean);
  if (missing.length) {
    return NextResponse.json({ error: `The CSV is missing a column for: ${missing.join(", ")}` }, { status: 400 });
  }

  const bars: Candle[] = [];
  let skipped = 0;
  for (const row of rows.slice(1)) {
    const rawTs = row[iTs]?.trim() ?? "";
    let ts: number;
    if (/^\d+$/.test(rawTs)) {
      const n = Number(rawTs);
      ts = n > 1e17 ? Math.floor(n / 1e6) : n > 1e14 ? Math.floor(n / 1e3) : n > 1e11 ? n : n * 1000;
    } else {
      ts = Date.parse(rawTs.includes("T") || rawTs.includes(" ") ? rawTs : `${rawTs}T00:00:00Z`);
    }
    const bar = {
      ts,
      open: Number(row[iO]),
      high: Number(row[iH]),
      low: Number(row[iL]),
      close: Number(row[iC]),
      volume: iV >= 0 ? Number(row[iV]) || 0 : 0,
    };
    if (![bar.ts, bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)) {
      skipped++;
      continue;
    }
    bars.push(bar);
  }

  bars.sort((a, b) => a.ts - b.ts);
  const written = insertCandles(symbol, "1m", bars);
  recordImport({
    id: uid("imp"),
    symbol,
    source: "csv",
    bars: written,
    status: "complete",
    startDate: bars[0] ? new Date(bars[0].ts).toISOString().slice(0, 10) : null,
    endDate: bars.length ? new Date(bars[bars.length - 1].ts).toISOString().slice(0, 10) : null,
    message: `${file.name}${skipped ? ` — ${skipped} unparseable rows skipped` : ""}`,
  });

  return NextResponse.json({ symbol, bars: written, skipped });
}
