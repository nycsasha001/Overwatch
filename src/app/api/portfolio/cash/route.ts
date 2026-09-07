import { NextRequest, NextResponse } from "next/server";
import { getPortfolioMeta, savePortfolioMeta } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getPortfolioMeta());
}

export async function PUT(req: NextRequest) {
  try {
    const b = await req.json();
    const cash = Number(b.cash);
    // Negative cash is a margin balance, which is real, so it is allowed. NaN is not.
    if (!Number.isFinite(cash)) return NextResponse.json({ error: "Cash must be a number" }, { status: 400 });
    return NextResponse.json(savePortfolioMeta({ cash }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not save the cash balance" }, { status: 500 });
  }
}
