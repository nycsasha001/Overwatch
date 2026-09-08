import { NextRequest, NextResponse } from "next/server";
import { createBacktest, listBacktests } from "@/lib/db";
import type { Backtest, BacktestResult } from "@/lib/types";
import { requireScope, unauthorized } from "@/lib/current-user";

export const dynamic = "force-dynamic";

const num = (v: unknown, fallback: number | null = null) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

function normalizeResult(raw: unknown): BacktestResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const trades = num(r.trades);
  if (trades === null) return null;
  return {
    trades,
    netR: num(r.netR, 0) as number,
    netPnl: num(r.netPnl, 0) as number,
    winRate: num(r.winRate, 0) as number,
    profitFactor: num(r.profitFactor, null),
    maxDrawdownR: num(r.maxDrawdownR, 0) as number,
    equityR: Array.isArray(r.equityR) ? (r.equityR as unknown[]).map((x) => Number(x) || 0) : undefined,
    raw: r.raw && typeof r.raw === "object" ? (r.raw as BacktestResult["raw"]) : null,
  };
}

/**
 * Import one or more backtest runs.
 * Body: { runs: [...] } — or a bare array, or a single run object.
 * Runs whose name already exists are skipped, so re-importing the same file is safe.
 */
export async function POST(req: NextRequest) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "That file is not valid JSON" }, { status: 400 });
  }

  const asRecord = body as Record<string, unknown>;
  const list: unknown[] = Array.isArray(body)
    ? body
    : Array.isArray(asRecord?.runs)
    ? (asRecord.runs as unknown[])
    : body && typeof body === "object"
    ? [body]
    : [];

  if (!list.length) return NextResponse.json({ error: "No runs found in that file" }, { status: 400 });

  const existing = new Set(listBacktests(u).map((b) => b.name));
  const imported: Backtest[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  for (const item of list) {
    if (!item || typeof item !== "object") {
      errors.push("A run entry was not an object");
      continue;
    }
    const r = item as Record<string, unknown>;
    const name = String(r.name ?? "").trim();
    if (!name) {
      errors.push("A run is missing a name");
      continue;
    }
    if (existing.has(name)) {
      skipped.push(name);
      continue;
    }
    const result = normalizeResult(r.result);
    const created = createBacktest(u, {
      name,
      strategy: r.strategy ? String(r.strategy) : null,
      instrument: r.instrument ? String(r.instrument) : null,
      startDate: r.startDate ? String(r.startDate) : null,
      endDate: r.endDate ? String(r.endDate) : null,
      params: r.params && typeof r.params === "object" ? (r.params as Record<string, unknown>) : {},
      status: result ? "complete" : "awaiting_engine",
      result,
      engineNote: r.engineNote ? String(r.engineNote) : result ? "Imported from a JSON file." : null,
    });
    existing.add(name);
    imported.push(created);
  }

  return NextResponse.json({ imported: imported.length, skipped, errors, runs: imported });
}
