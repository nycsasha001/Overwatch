import { NextRequest, NextResponse } from "next/server";
import { listAccounts, getSettings, listStrategies, listSetups, listTrades } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get("accountId");
  const accounts = listAccounts();
  const settings = getSettings();
  const scope = accountId && accountId !== "all" ? accountId : null;
  return NextResponse.json({
    accounts,
    settings,
    strategies: listStrategies(),
    setups: listSetups(),
    trades: accounts.length ? listTrades(scope) : [],
  });
}
