import { NextRequest, NextResponse } from "next/server";
import { updateBacktestResult } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Ingest endpoint for an external backtesting engine (e.g. a Python runner).
 * POST { trades, netR, netPnl, winRate, profitFactor, maxDrawdownR, equityR?, raw? }
 * or   { status: "failed", error: "..." }
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await req.json();

  if (b.status === "failed") {
    const bt = updateBacktestResult(id, null, "failed", String(b.error ?? "Engine reported a failure"));
    if (!bt) return NextResponse.json({ error: "Backtest not found" }, { status: 404 });
    return NextResponse.json(bt);
  }

  const num = (v: unknown, fallback: number | null = null) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  const trades = num(b.trades, null);
  if (trades === null) return NextResponse.json({ error: "'trades' (number) is required" }, { status: 400 });

  const result = {
    trades,
    netR: num(b.netR, 0) as number,
    netPnl: num(b.netPnl, 0) as number,
    winRate: num(b.winRate, 0) as number,
    profitFactor: num(b.profitFactor, null),
    maxDrawdownR: num(b.maxDrawdownR, 0) as number,
    equityR: Array.isArray(b.equityR) ? b.equityR.map((x: unknown) => Number(x) || 0) : undefined,
    raw: b.raw,
  };
  const bt = updateBacktestResult(id, result, "complete", b.note ? String(b.note) : "Result received from external engine.");
  if (!bt) return NextResponse.json({ error: "Backtest not found" }, { status: 404 });
  return NextResponse.json(bt);
}
