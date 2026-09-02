import type { Account, Settings, Trade } from "./types";
import { chronological, classify } from "./stats";
import { isoDate } from "./format";

export interface RuleLine {
  label: string;
  used: number;
  limit: number;
  remaining: number;
  /** 0–1, how much of the allowance is consumed. */
  ratio: number;
  breached: boolean;
  warn: boolean;
}

export interface Guardrails {
  configured: boolean;
  balance: number;
  peak: number;
  profitTarget: RuleLine | null;
  drawdown: (RuleLine & { floor: number; type: Account["drawdownType"] }) | null;
  daily: (RuleLine & { date: string }) | null;
  /** Drawdown headroom expressed in units of the account's normal risk, when that is known. */
  headroomInR: number | null;
  breaches: string[];
}

/**
 * Prop-firm style limits.
 *
 * Only trades belonging to the account are considered, and excluded result classifications are
 * still counted here — a firm's drawdown does not care how you classify a trade, only the P&L.
 */
export function guardrails(account: Account | null, trades: Trade[], settings: Settings, today = isoDate(new Date())): Guardrails {
  const empty: Guardrails = {
    configured: false,
    balance: account?.startingBalance ?? 0,
    peak: account?.startingBalance ?? 0,
    profitTarget: null,
    drawdown: null,
    daily: null,
    headroomInR: null,
    breaches: [],
  };
  if (!account) return empty;

  const own = chronological(trades.filter((t) => t.accountId === account.id));
  const start = account.startingBalance;
  let balance = start;
  let peak = start;
  for (const t of own) {
    balance += t.pnl;
    if (balance > peak) peak = balance;
  }

  const configured =
    account.profitTarget !== null || account.maxDrawdown !== null || account.dailyLossLimit !== null;
  if (!configured) return { ...empty, balance, peak };

  const line = (label: string, used: number, limit: number): RuleLine => {
    const remaining = limit - used;
    const ratio = limit > 0 ? Math.min(Math.max(used / limit, 0), 1) : 0;
    return { label, used, limit, remaining, ratio, breached: remaining <= 0, warn: remaining > 0 && ratio >= 0.75 };
  };

  const profitTarget =
    account.profitTarget !== null && account.profitTarget > 0
      ? { ...line("Profit target", Math.max(balance - start, 0), account.profitTarget), breached: false, warn: false }
      : null;

  let drawdown: Guardrails["drawdown"] = null;
  if (account.maxDrawdown !== null && account.maxDrawdown > 0) {
    const floor = (account.drawdownType === "trailing" ? peak : start) - account.maxDrawdown;
    const used = Math.max(0, account.maxDrawdown - (balance - floor));
    drawdown = { ...line("Drawdown used", used, account.maxDrawdown), floor, type: account.drawdownType };
  }

  let daily: Guardrails["daily"] = null;
  if (account.dailyLossLimit !== null && account.dailyLossLimit > 0) {
    const todayPnl = own.filter((t) => t.date === today).reduce((s, t) => s + t.pnl, 0);
    daily = { ...line("Daily loss used", Math.max(0, -todayPnl), account.dailyLossLimit), date: today };
  }

  // Express remaining drawdown as "how many normal losers away from a breach".
  const riskAmounts = own.map((t) => t.riskAmount).filter((v): v is number => v !== null && v > 0);
  const typicalRisk =
    riskAmounts.length > 0
      ? riskAmounts.slice(-10).reduce((a, b) => a + b, 0) / Math.min(riskAmounts.length, 10)
      : account.defaultRiskPct
      ? (account.defaultRiskPct / 100) * balance
      : settings.defaultRiskPct
      ? (settings.defaultRiskPct / 100) * balance
      : null;

  const breaches: string[] = [];
  if (drawdown?.breached) breaches.push(`Maximum drawdown breached — balance is at or below the ${drawdown.type} floor`);
  if (daily?.breached) breaches.push("Daily loss limit reached for today");

  return {
    configured: true,
    balance,
    peak,
    profitTarget,
    drawdown,
    daily,
    headroomInR: drawdown && typicalRisk ? (drawdown.limit - drawdown.used) / typicalRisk : null,
    breaches,
  };
}

/** Unused for now but kept beside the maths it belongs to. */
export const classifyForRules = classify;
