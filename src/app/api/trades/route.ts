import { NextRequest, NextResponse } from "next/server";
import { insertTrade, listTrades, uid } from "@/lib/db";
import { jsonError, normalizeTrade } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get("accountId");
  return NextResponse.json(listTrades(accountId && accountId !== "all" ? accountId : null));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const accountId = String(body.accountId ?? "");
    if (!accountId) return NextResponse.json({ error: "An account must be selected" }, { status: 400 });
    const trade = insertTrade(normalizeTrade(body, uid("trd"), accountId));
    return NextResponse.json(trade, { status: 201 });
  } catch (e) {
    const { error, field, status } = jsonError(e) as { error: string; field?: string; status: number };
    return NextResponse.json({ error, field }, { status });
  }
}
