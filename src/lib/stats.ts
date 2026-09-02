import type { Classification, ResultCode, Settings, Trade } from "./types";

export interface Metrics {
  trades: number;
  wins: number;
  losses: number;
  breakevens: number;
  excluded: number;
  netPnl: number;
  netR: number;
  grossProfit: number;
  grossLoss: number; // positive number
  winRate: number | null;
  profitFactor: number | null;
  expectancyR: number | null;
  /** Average reward-to-risk the trades were planned at. */
  avgPlannedRr: number | null;
  /** Win rate this edge needs just to break even at that planned RR, as a percentage. */
  breakevenWinRate: number | null;
  /** Actual win rate minus the break-even one. Positive means the edge clears its own bar. */
  winRateEdge: number | null;
  expectancyPnl: number | null;
  avgWin: number | null;
  avgLoss: number | null; // negative
  avgWinR: number | null;
  avgLossR: number | null;
  largestWin: number | null;
  largestLoss: number | null;
  avgR: number | null;
  medianR: number | null;
  maxDrawdown: number; // dollars, positive
  maxDrawdownR: number;
  maxDrawdownPct: number | null;
  currentStreak: { type: "win" | "loss" | "none"; count: number };
  bestDay: { date: string; pnl: number } | null;
  worstDay: { date: string; pnl: number } | null;
  avgHoldNote?: never;
}

export function classify(result: ResultCode, settings: Settings): Classification {
  return settings.classification[result] ?? "excluded";
}

/** Chronological ascending sort (date, then time, then insertion order). */
export function chronological(trades: Trade[]): Trade[] {
  return [...trades].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const at = a.time ?? "";
    const bt = b.time ?? "";
    if (at !== bt) return at < bt ? -1 : 1;
    return a.createdAt < b.createdAt ? -1 : 1;
  });
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export function computeMetrics(trades: Trade[], settings: Settings, startingBalance = 0): Metrics {
  const ordered = chronological(trades);
  let wins = 0,
    losses = 0,
    breakevens = 0,
    excluded = 0;
  let grossProfit = 0,
    grossLoss = 0;
  let netPnl = 0,
    netR = 0;
  const winPnls: number[] = [];
  const lossPnls: number[] = [];
  const winRs: number[] = [];
  const lossRs: number[] = [];
  const allR: number[] = [];

  for (const t of ordered) {
    const cls = classify(t.result, settings);
    if (cls === "excluded") {
      excluded++;
      continue;
    }
    netPnl += t.pnl;
    if (t.rMultiple !== null) {
      netR += t.rMultiple;
      allR.push(t.rMultiple);
    }
    if (t.pnl > 0) grossProfit += t.pnl;
    if (t.pnl < 0) grossLoss += -t.pnl;
    if (cls === "win") {
      wins++;
      winPnls.push(t.pnl);
      if (t.rMultiple !== null) winRs.push(t.rMultiple);
    } else if (cls === "loss") {
      losses++;
      lossPnls.push(t.pnl);
      if (t.rMultiple !== null) lossRs.push(t.rMultiple);
    } else {
      breakevens++;
    }
  }

  const counted = wins + losses + breakevens;
  const wrDenom = settings.breakevenInWinRate ? wins + losses + breakevens : wins + losses;
  const winRate = wrDenom > 0 ? (wins / wrDenom) * 100 : null;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : null;

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  /**
   * A win rate on its own says nothing about whether an edge makes money — 40% at 3R is strong,
   * 60% at 0.5R loses. So the planned reward-to-risk is averaged and turned into the win rate this
   * strategy would need simply to break even: 1 / (1 + RR).
   *
   * Only trades that recorded a plan are counted. Averaging in a zero for trades where the RR was
   * never written down would drag the bar down and flatter the edge.
   */
  const plannedRrs = ordered.map((t) => t.plannedRr).filter((v): v is number => typeof v === "number" && v > 0);
  const avgPlannedRr = avg(plannedRrs);
  const breakevenWinRate = avgPlannedRr !== null ? (1 / (1 + avgPlannedRr)) * 100 : null;

  // Equity / drawdown
  let equity = startingBalance;
  let peak = startingBalance;
  let maxDd = 0;
  let maxDdPct = 0;
  let eqR = 0;
  let peakR = 0;
  let maxDdR = 0;
  const dayPnl = new Map<string, number>();

  for (const t of ordered) {
    if (classify(t.result, settings) === "excluded") continue;
    equity += t.pnl;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) {
      maxDd = dd;
      maxDdPct = peak !== 0 ? (dd / peak) * 100 : 0;
    }
    eqR += t.rMultiple ?? 0;
    if (eqR > peakR) peakR = eqR;
    if (peakR - eqR > maxDdR) maxDdR = peakR - eqR;
    dayPnl.set(t.date, (dayPnl.get(t.date) ?? 0) + t.pnl);
  }

  // Streak: walk backwards through counted win/loss trades
  let streakType: "win" | "loss" | "none" = "none";
  let streakCount = 0;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const cls = classify(ordered[i].result, settings);
    if (cls === "excluded" || cls === "breakeven") continue;
    if (streakType === "none") {
      streakType = cls;
      streakCount = 1;
    } else if (streakType === cls) {
      streakCount++;
    } else break;
  }

  let bestDay: Metrics["bestDay"] = null;
  let worstDay: Metrics["worstDay"] = null;
  for (const [date, pnl] of dayPnl) {
    if (!bestDay || pnl > bestDay.pnl) bestDay = { date, pnl };
    if (!worstDay || pnl < worstDay.pnl) worstDay = { date, pnl };
  }

  return {
    trades: counted,
    wins,
    losses,
    breakevens,
    excluded,
    netPnl,
    netR,
    grossProfit,
    grossLoss,
    winRate,
    profitFactor,
    expectancyR: allR.length ? netR / allR.length : null,
    avgPlannedRr,
    breakevenWinRate,
    winRateEdge: winRate !== null && breakevenWinRate !== null ? winRate - breakevenWinRate : null,
    expectancyPnl: counted ? netPnl / counted : null,
    avgWin: avg(winPnls),
    avgLoss: avg(lossPnls),
    avgWinR: avg(winRs),
    avgLossR: avg(lossRs),
    largestWin: winPnls.length ? Math.max(...winPnls) : null,
    largestLoss: lossPnls.length ? Math.min(...lossPnls) : null,
    avgR: avg(allR),
    medianR: median(allR),
    maxDrawdown: maxDd,
    maxDrawdownR: maxDdR,
    maxDrawdownPct: startingBalance > 0 ? maxDdPct : null,
    currentStreak: { type: streakType, count: streakCount },
    bestDay,
    worstDay,
  };
}

export interface EquityPoint {
  index: number;
  date: string;
  tradeId: string;
  pnl: number;
  r: number;
  equity: number;
  equityR: number;
  drawdown: number;
  drawdownR: number;
}

export function equitySeries(trades: Trade[], settings: Settings, startingBalance = 0): EquityPoint[] {
  const ordered = chronological(trades).filter((t) => classify(t.result, settings) !== "excluded");
  const out: EquityPoint[] = [];
  let equity = startingBalance;
  let equityR = 0;
  let peak = startingBalance;
  let peakR = 0;
  ordered.forEach((t, i) => {
    equity += t.pnl;
    equityR += t.rMultiple ?? 0;
    peak = Math.max(peak, equity);
    peakR = Math.max(peakR, equityR);
    out.push({
      index: i + 1,
      date: t.date,
      tradeId: t.id,
      pnl: t.pnl,
      r: t.rMultiple ?? 0,
      equity,
      equityR,
      drawdown: equity - peak,
      drawdownR: equityR - peakR,
    });
  });
  return out;
}

export interface Bucket {
  key: string;
  label: string;
  trades: Trade[];
  metrics: Metrics;
}

export function groupBy(
  trades: Trade[],
  settings: Settings,
  keyFn: (t: Trade) => string | null,
  labelFn?: (k: string) => string
): Bucket[] {
  const map = new Map<string, Trade[]>();
  for (const t of trades) {
    const k = keyFn(t) ?? "—";
    const arr = map.get(k) ?? [];
    arr.push(t);
    map.set(k, arr);
  }
  return [...map.entries()]
    .map(([key, list]) => ({
      key,
      label: labelFn ? labelFn(key) : key,
      trades: list,
      metrics: computeMetrics(list, settings),
    }))
    .sort((a, b) => b.metrics.netR - a.metrics.netR);
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function hourBucket(t: Trade): string | null {
  if (!t.time) return null;
  const h = Number(t.time.slice(0, 2));
  if (Number.isNaN(h)) return null;
  return `${String(h).padStart(2, "0")}:00`;
}

export interface DaySummary {
  date: string;
  pnl: number;
  r: number;
  trades: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number | null;
  avgR: number | null;
  best: Trade | null;
  worst: Trade | null;
  list: Trade[];
}

export function dailySummaries(trades: Trade[], settings: Settings): Map<string, DaySummary> {
  const map = new Map<string, Trade[]>();
  for (const t of trades) {
    const arr = map.get(t.date) ?? [];
    arr.push(t);
    map.set(t.date, arr);
  }
  const out = new Map<string, DaySummary>();
  for (const [date, list] of map) {
    const m = computeMetrics(list, settings);
    const sorted = [...list].sort((a, b) => b.pnl - a.pnl);
    out.set(date, {
      date,
      pnl: m.netPnl,
      r: m.netR,
      trades: list.length,
      wins: m.wins,
      losses: m.losses,
      breakevens: m.breakevens,
      winRate: m.winRate,
      avgR: m.avgR,
      best: sorted[0] ?? null,
      worst: sorted[sorted.length - 1] ?? null,
      list: chronological(list),
    });
  }
  return out;
}

/** R distribution histogram with 0.5R buckets, clamped to [-3, 5]. */
export function rHistogram(trades: Trade[]): { label: string; count: number; from: number }[] {
  const buckets = new Map<number, number>();
  for (const t of trades) {
    if (t.rMultiple === null) continue;
    const clamped = Math.max(-3, Math.min(4.99, t.rMultiple));
    const from = Math.floor(clamped * 2) / 2;
    buckets.set(from, (buckets.get(from) ?? 0) + 1);
  }
  if (!buckets.size) return [];
  const min = Math.min(...buckets.keys());
  const max = Math.max(...buckets.keys());
  const out: { label: string; count: number; from: number }[] = [];
  for (let v = min; v <= max + 0.001; v += 0.5) {
    const key = Math.round(v * 2) / 2;
    out.push({ from: key, label: `${key >= 0 ? "+" : ""}${key.toFixed(1)}R`, count: buckets.get(key) ?? 0 });
  }
  return out;
}

export interface ExcursionStats {
  sample: number;
  avgMaeWinners: number | null;
  avgMaeLosers: number | null;
  avgMfeWinners: number | null;
  avgMfeLosers: number | null;
  maxMaeWinner: number | null;
  avgCapturedRatio: number | null; // realised R / MFE for winners
}

export function excursionStats(trades: Trade[], settings: Settings): ExcursionStats {
  const withData = trades.filter((t) => t.mae !== null || t.mfe !== null);
  const winners = withData.filter((t) => classify(t.result, settings) === "win");
  const losers = withData.filter((t) => classify(t.result, settings) === "loss");
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const captured = winners
    .filter((t) => t.mfe && t.mfe > 0 && t.rMultiple !== null)
    .map((t) => (t.rMultiple as number) / (t.mfe as number));
  return {
    sample: withData.length,
    avgMaeWinners: avg(winners.map((t) => t.mae).filter((v): v is number => v !== null)),
    avgMaeLosers: avg(losers.map((t) => t.mae).filter((v): v is number => v !== null)),
    avgMfeWinners: avg(winners.map((t) => t.mfe).filter((v): v is number => v !== null)),
    avgMfeLosers: avg(losers.map((t) => t.mfe).filter((v): v is number => v !== null)),
    maxMaeWinner: winners.length ? Math.max(...winners.map((t) => t.mae ?? 0)) : null,
    avgCapturedRatio: avg(captured),
  };
}

/** Derive R multiple from prices when the user has not supplied one. */
export function deriveR(entry: number | null, stop: number | null, exit: number | null, direction: "long" | "short"): number | null {
  if (entry === null || stop === null || exit === null) return null;
  const risk = Math.abs(entry - stop);
  if (!risk) return null;
  const move = direction === "long" ? exit - entry : entry - exit;
  return Number((move / risk).toFixed(3));
}
