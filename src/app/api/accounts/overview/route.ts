import { NextResponse } from "next/server";
import { getSettings, listAccounts, listTrades } from "@/lib/db";
import { computeMetrics } from "@/lib/stats";
import { guardrails } from "@/lib/guardrails";
import type { Account } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Every account, with the numbers needed to judge it at a glance.
 *
 * Computed here rather than in the browser because the alternative is shipping every trade from
 * every account to the client and reducing them there. On a machine that has run a few thousand
 * engine backtests that is a large payload to build a six-row summary from, and the metric and
 * guardrail code already exists on this side.
 *
 * GET /api/accounts/overview
 */
export interface AccountOverview {
  account: Account;
  trades: number;
  netPnl: number;
  netR: number;
  balance: number;
  winRate: number | null;
  profitFactor: number | null;
  expectancyR: number | null;
  maxDrawdown: number;
  lastTradeDate: string | null;
  /** Present only where the account actually has rules configured. */
  rules: {
    profitTargetRatio: number | null;
    drawdownRatio: number | null;
    dailyRatio: number | null;
    breached: boolean;
    warn: boolean;
  } | null;
}

export async function GET() {
  const settings = getSettings();
  const accounts = listAccounts();

  const rows: AccountOverview[] = accounts.map((account) => {
    const trades = listTrades(account.id);
    const m = computeMetrics(trades, settings, account.startingBalance);
    const g = guardrails(account, trades, settings);

    // Trades are not guaranteed to arrive in date order — an import or an engine run can append
    // history behind what is already stored — so the latest date is taken by scanning, not by
    // reading the last row.
    let lastTradeDate: string | null = null;
    for (const t of trades) if (!lastTradeDate || t.date > lastTradeDate) lastTradeDate = t.date;

    return {
      account,
      trades: m.trades,
      netPnl: m.netPnl,
      netR: m.netR,
      balance: account.startingBalance + m.netPnl,
      winRate: m.winRate,
      profitFactor: m.profitFactor,
      expectancyR: m.expectancyR,
      maxDrawdown: m.maxDrawdown,
      lastTradeDate,
      rules: g.configured
        ? {
            profitTargetRatio: g.profitTarget?.ratio ?? null,
            drawdownRatio: g.drawdown?.ratio ?? null,
            dailyRatio: g.daily?.ratio ?? null,
            breached: Boolean(g.drawdown?.breached || g.daily?.breached),
            warn: Boolean(g.drawdown?.warn || g.daily?.warn),
          }
        : null,
    };
  });

  return NextResponse.json({ accounts: rows });
}
