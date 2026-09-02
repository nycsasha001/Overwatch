import type { Candle } from "./aggregate";

/**
 * Order-fill simulation for the replay backtester.
 *
 * A 1-minute bar records only open, high, low and close — never the order those prices occurred
 * in. Every rule below resolves that ambiguity *against* the trader, so a result produced here is
 * a floor rather than a best case:
 *
 *   • If one bar touches both the stop and the target, the stop is taken.
 *   • A gap through a stop fills at the bar's open, which is worse than the stop price.
 *   • A gap through a target also fills at the open — better, and what would really happen.
 *   • A limit entry only fills if price actually trades through the level.
 *
 * Trades whose closing bar touched both levels are flagged `ambiguous`, so they can be re-checked
 * against 1-second bars rather than quietly trusted.
 */

export type Direction = "long" | "short";
export type EntryType = "market" | "limit";
export type CloseReason = "stop" | "target" | "manual" | "gap-stop" | "gap-target";

export interface OrderDraft {
  direction: Direction;
  entryType: EntryType;
  entryPrice: number | null;
  stop: number;
  target: number | null;
  /** Size in contracts. Dollar risk is derived from this and the stop distance. */
  contracts: number;
  pointValue: number;
}

export interface Position {
  direction: Direction;
  entry: number;
  stop: number;
  target: number | null;
  contracts: number;
  pointValue: number;
  /** Dollar risk at the fill: |entry − stop| × point value × contracts. */
  risk: number;
  entryTs: number;
  mae: number;
  mfe: number;
  bars: number;
}

export interface ClosedTrade extends Position {
  exit: number;
  exitTs: number;
  reason: CloseReason;
  r: number;
  pnl: number;
  ambiguous: boolean;
}

export const riskDistance = (entry: number, stop: number): number => Math.abs(entry - stop);

export function rOf(pos: Pick<Position, "direction" | "entry" | "stop">, price: number): number {
  const risk = riskDistance(pos.entry, pos.stop);
  if (!risk) return 0;
  const move = pos.direction === "long" ? price - pos.entry : pos.entry - price;
  return move / risk;
}

export function validateOrder(order: OrderDraft, lastPrice: number): string | null {
  const entry = order.entryType === "market" ? lastPrice : order.entryPrice;
  if (entry === null || !Number.isFinite(entry)) return "Enter a limit price.";
  if (!Number.isFinite(order.stop)) return "Enter a stop price.";
  if (order.stop === entry) return "The stop cannot sit at the entry price.";
  if (order.direction === "long" && order.stop > entry) return "A long stop must be below the entry.";
  if (order.direction === "short" && order.stop < entry) return "A short stop must be above the entry.";
  if (order.target !== null) {
    if (order.direction === "long" && order.target <= entry) return "A long target must be above the entry.";
    if (order.direction === "short" && order.target >= entry) return "A short target must be below the entry.";
  }
  if (!(order.contracts > 0)) return "Enter a position size of at least one contract.";
  if (!(order.pointValue > 0)) return "This symbol has no point value configured.";
  return null;
}

/** Attempt to fill a working order against one bar. Market orders fill at that bar's open. */
export function tryFill(order: OrderDraft, bar: Candle): Position | null {
  let fill: number | null = null;

  if (order.entryType === "market") {
    fill = bar.open;
  } else if (order.entryPrice !== null) {
    const p = order.entryPrice;
    if (order.direction === "long") {
      if (bar.open <= p) fill = bar.open;
      else if (bar.low <= p) fill = p;
    } else {
      if (bar.open >= p) fill = bar.open;
      else if (bar.high >= p) fill = p;
    }
  }
  if (fill === null) return null;

  return positionFrom(order, fill, bar.ts);
}

function positionFrom(order: OrderDraft, entry: number, entryTs: number): Position {
  return {
    direction: order.direction,
    entry,
    stop: order.stop,
    target: order.target,
    contracts: order.contracts,
    pointValue: order.pointValue,
    risk: Math.abs(entry - order.stop) * order.pointValue * order.contracts,
    entryTs,
    mae: 0,
    mfe: 0,
    bars: 0,
  };
}

/**
 * Fill a market order on the bar the trader is looking at, at its close.
 *
 * That price has already printed at the cursor, so this is not look-ahead — and it is closer to
 * what actually happens than waiting for the next bar's open, which can gap away from the price
 * that was on screen when the button was pressed.
 */
export function fillAtMarket(order: OrderDraft, bar: Candle): Position {
  return positionFrom(order, bar.close, bar.ts);
}

export interface StepResult {
  position: Position;
  closed: ClosedTrade | null;
}

/** Advance an open position by one bar: update excursions, then check for a fill. */
export function step(position: Position, bar: Candle): StepResult {
  const pos: Position = { ...position, bars: position.bars + 1 };
  const risk = riskDistance(pos.entry, pos.stop);

  if (risk > 0) {
    const adverse = pos.direction === "long" ? (pos.entry - bar.low) / risk : (bar.high - pos.entry) / risk;
    const favourable = pos.direction === "long" ? (bar.high - pos.entry) / risk : (pos.entry - bar.low) / risk;
    if (adverse > pos.mae) pos.mae = adverse;
    if (favourable > pos.mfe) pos.mfe = favourable;
  }

  const long = pos.direction === "long";
  const stopTouched = long ? bar.low <= pos.stop : bar.high >= pos.stop;
  const targetTouched = pos.target !== null && (long ? bar.high >= pos.target : bar.low <= pos.target);

  if (!stopTouched && !targetTouched) return { position: pos, closed: null };

  const close = (exit: number, reason: CloseReason, ambiguous: boolean): StepResult => {
    const r = rOf(pos, exit);
    return {
      position: pos,
      closed: { ...pos, exit, exitTs: bar.ts, reason, r: Number(r.toFixed(4)), pnl: Number((r * pos.risk).toFixed(2)), ambiguous },
    };
  };

  if (stopTouched) {
    const gapped = long ? bar.open <= pos.stop : bar.open >= pos.stop;
    return close(gapped ? bar.open : pos.stop, gapped ? "gap-stop" : "stop", targetTouched);
  }

  const target = pos.target as number;
  const gapped = long ? bar.open >= target : bar.open <= target;
  return close(gapped ? bar.open : target, gapped ? "gap-target" : "target", false);
}

/** Close at the current bar's close, as if the trader pressed the button. */
export function closeAtMarket(position: Position, bar: Candle): ClosedTrade {
  const r = rOf(position, bar.close);
  return {
    ...position,
    exit: bar.close,
    exitTs: bar.ts,
    reason: "manual",
    r: Number(r.toFixed(4)),
    pnl: Number((r * position.risk).toFixed(2)),
    ambiguous: false,
  };
}

export interface SessionStats {
  trades: number;
  wins: number;
  losses: number;
  breakeven: number;
  netR: number;
  netPnl: number;
  winRate: number | null;
  ambiguous: number;
}

export function sessionStats(trades: ClosedTrade[]): SessionStats {
  let wins = 0, losses = 0, breakeven = 0, netR = 0, netPnl = 0, ambiguous = 0;
  for (const t of trades) {
    netR += t.r;
    netPnl += t.pnl;
    if (t.ambiguous) ambiguous++;
    if (t.r > 0.05) wins++;
    else if (t.r < -0.05) losses++;
    else breakeven++;
  }
  return {
    trades: trades.length,
    wins,
    losses,
    breakeven,
    netR: Number(netR.toFixed(2)),
    netPnl: Number(netPnl.toFixed(2)),
    winRate: wins + losses > 0 ? (wins / (wins + losses)) * 100 : null,
    ambiguous,
  };
}
