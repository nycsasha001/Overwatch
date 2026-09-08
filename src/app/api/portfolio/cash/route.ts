import { NextRequest, NextResponse } from "next/server";
import { getPortfolioMeta, savePortfolioMeta } from "@/lib/db";
import { requireScope, unauthorized } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  return NextResponse.json(getPortfolioMeta(u));
}

export async function PUT(req: NextRequest) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  try {
    const b = await req.json();
    const cash = Number(b.cash);
    // Negative cash is a margin balance, which is real, so it is allowed. NaN is not.
    if (!Number.isFinite(cash)) return NextResponse.json({ error: "Cash must be a number" }, { status: 400 });
    return NextResponse.json(savePortfolioMeta(u, { cash }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not save the cash balance" }, { status: 500 });
  }
}
