import { NextRequest, NextResponse } from "next/server";
import { insertTradesBulk, uid } from "@/lib/db";
import { jsonError, normalizeTrade } from "@/lib/validate";
import { TradeInput } from "@/lib/types";
import { requireScope, unauthorized } from "@/lib/current-user";

export const dynamic = "force-dynamic";

/** Accepts { accountId, trades: [...] } where each trade is already mapped to app fields. */
export async function POST(req: NextRequest) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  try {
    const body = await req.json();
    const accountId = String(body.accountId ?? "");
    if (!accountId) return NextResponse.json({ error: "An account must be selected" }, { status: 400 });
    const rows: Record<string, unknown>[] = Array.isArray(body.trades) ? body.trades : [];
    if (!rows.length) return NextResponse.json({ error: "No rows to import" }, { status: 400 });

    const valid: TradeInput[] = [];
    const errors: { row: number; message: string }[] = [];
    rows.forEach((raw, i) => {
      try {
        valid.push(normalizeTrade(raw, uid("trd"), accountId));
      } catch (e) {
        errors.push({ row: i + 1, message: e instanceof Error ? e.message : "Invalid row" });
      }
    });
    const imported = valid.length ? insertTradesBulk(u, valid) : 0;
    return NextResponse.json({ imported, skipped: errors.length, errors: errors.slice(0, 50) });
  } catch (e) {
    const { error, status } = jsonError(e);
    return NextResponse.json({ error }, { status });
  }
}
