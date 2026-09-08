import { NextRequest, NextResponse } from "next/server";
import { insertTrade, listTrades, uid } from "@/lib/db";
import { jsonError, normalizeTrade } from "@/lib/validate";
import { requireScope, unauthorized } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  const accountId = req.nextUrl.searchParams.get("accountId");
  return NextResponse.json(listTrades(u, accountId && accountId !== "all" ? accountId : null));
}

export async function POST(req: NextRequest) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  try {
    const body = await req.json();
    const accountId = String(body.accountId ?? "");
    if (!accountId) return NextResponse.json({ error: "An account must be selected" }, { status: 400 });
    const trade = insertTrade(u, normalizeTrade(body, uid("trd"), accountId));
    return NextResponse.json(trade, { status: 201 });
  } catch (e) {
    const { error, field, status } = jsonError(e) as { error: string; field?: string; status: number };
    return NextResponse.json({ error, field }, { status });
  }
}
