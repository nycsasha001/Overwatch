import { NextRequest, NextResponse } from "next/server";
import { listAccounts, getSettings, listStrategies, listSetups, listTrades } from "@/lib/db";
import { requireScope, unauthorized } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  const accountId = req.nextUrl.searchParams.get("accountId");
  const accounts = listAccounts(u);
  const settings = getSettings(u);
  const scope = accountId && accountId !== "all" ? accountId : null;
  return NextResponse.json({
    accounts,
    settings,
    strategies: listStrategies(u),
    setups: listSetups(u),
    trades: accounts.length ? listTrades(u, scope) : [],
  });
}
