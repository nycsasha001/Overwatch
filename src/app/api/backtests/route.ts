import { NextRequest, NextResponse } from "next/server";
import { createBacktest, listBacktests } from "@/lib/db";
import { requireScope, unauthorized } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  return NextResponse.json(listBacktests(u));
}

export async function POST(req: NextRequest) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  const b = await req.json();
  const name = String(b.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Run name is required" }, { status: 400 });
  const bt = createBacktest(u, {
    name,
    strategy: b.strategy ? String(b.strategy) : null,
    instrument: b.instrument ? String(b.instrument) : null,
    startDate: b.startDate ? String(b.startDate) : null,
    endDate: b.endDate ? String(b.endDate) : null,
    params: typeof b.params === "object" && b.params ? b.params : {},
    status: "awaiting_engine",
    result: null,
    engineNote: "Queued. No backtesting engine is connected to this instance yet — results appear here once an engine posts to /api/backtests/{id}/result.",
  });
  return NextResponse.json(bt, { status: 201 });
}
