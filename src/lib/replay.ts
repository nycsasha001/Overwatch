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
export type CloseReason = "stop" | "target" | "manual" | "gap-stop" | "gap-target" | "partial";

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

/**
 * A resting order that takes part of the position off at a price.
 *
 * Separate from `target`, which closes the lot outright. A scale-out is the other intent: bank
 * some of it here and let the rest run, which is most of what managing a trade actually consists
 * of and was the one thing the engine could not express.
 */
export interface TakeProfit {
  /** Stable across fills and re-renders, so a chart chip can be dragged and removed by identity. */
  id: string;
  price: number;
  /** Contracts to close when price trades through. Clamped to what is still open. */
  contracts: number;
}

export interface Position {
  direction: Direction;
  entry: number;
  stop: number;
  target: number | null;
  /**
   * Scale-outs, in no particular order — `step` sorts them by how soon price would reach them.
   *
   * Optional so every position built before this existed still type-checks and behaves exactly as
   * it did: no legs, one target, one exit.
   */
  takeProfits?: TakeProfit[];
  contracts: number;
  pointValue: number;
  /** Dollar risk at the fill: |entry − stop| × point value × contracts. */
  risk: number;
  /**
   * The stop the trade's R is measured from — the one it was taken with, unless it is re-anchored.
   *
   * Kept as the price rather than as a distance so it can be shown, checked and dragged against:
   * "R from 20980" is something you can read off the chart, where "one R is 20 points" is not.
   *
   * R leans on this rather than on wherever the stop currently sits, because the two are the same
   * thing only until the stop is moved. Moving it to breakeven made the distance zero and every R
   * after it zero with it: a runner closed three R up was logged as a scratch, and its P&L with
   * it. Moving a stop is risk management — it changes what the trade can still lose, not what it
   * was risking when it was taken. `anchorRisk` restates it deliberately, when that is the intent.
   */
  initialStop: number;
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

/** One R in points: the distance from the entry to the stop the trade is measured against. */
export function riskUnit(pos: Pick<Position, "entry" | "stop"> & Partial<Pick<Position, "initialStop">>): number {
  // A working order has no fill yet, so its stop distance *is* the risk it is being taken with.
  return riskDistance(pos.entry, pos.initialStop ?? pos.stop);
}

export function rOf(
  pos: Pick<Position, "direction" | "entry" | "stop"> & Partial<Pick<Position, "initialStop">>,
  price: number
): number {
  const risk = riskUnit(pos);
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
    initialStop: order.stop,
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
  /**
   * Scale-outs that filled on this bar, oldest first.
   *
   * Separate from `closed` because they are a different event: `closed` means the trade is over,
   * while these leave a position still running. A bar that fills the last leg reports it in both —
   * as a partial here and as the trade ending there — so a caller that only reads one of the two
   * still sees a complete picture.
   */
  partials?: ClosedTrade[];
}


/**
 * Close one or more scale-out legs on a bar that traded through them.
 *
 * Each leg is priced at its own limit rather than at the bar's close: that is where the order was
 * resting, and it is the price it would have been filled at. The one exception is a gap — if the
 * bar opened beyond the leg, the fill happens at the open, because the market never traded at the
 * limit on the way there. Same rule `step` already applies to a target, for the same reason.
 *
 * R comes from `rOf`, which measures against `initialStop`. So every partial is reported against
 * the risk the trade was *taken* with, not against wherever the stop has since been moved — which
 * is what "compared to original R" means and why moving a stop to breakeven does not turn a
 * three-R runner into a scratch.
 */
function fillScaleOuts(pos: Position, bar: Candle, legs: TakeProfit[]): StepResult {
  const long = pos.direction === "long";
  const onePoint = riskUnit(pos);
  const partials: ClosedTrade[] = [];

  let remaining = pos.contracts;
  let current: Position = pos;

  for (const leg of legs) {
    if (remaining <= 0) break;
    // A leg sized beyond what is left takes what is left. Over-sizing the legs is a mistake worth
    // tolerating rather than one worth refusing a fill over.
    const size = Math.min(Math.max(Math.floor(leg.contracts), 1), remaining);

    const gapped = long ? bar.open >= leg.price : bar.open <= leg.price;
    const exit = gapped ? bar.open : leg.price;

    const r = rOf(pos, exit);
    const risk = onePoint * pos.pointValue * size;
    remaining -= size;

    partials.push({
      ...pos,
      contracts: size,
      risk,
      exit,
      exitTs: bar.ts,
      // The last leg is not a partial — it is the trade ending, and labelling it otherwise would
      // leave a closed trade that never reports a close.
      reason: remaining > 0 ? "partial" : gapped ? "gap-target" : "target",
      r: Number(r.toFixed(4)),
      pnl: Number((r * risk).toFixed(2)),
      ambiguous: false,
    });

    current = {
      ...current,
      contracts: remaining,
      risk: onePoint * pos.pointValue * remaining,
      // Filled legs are gone. Anything untouched stays resting on the remainder.
      takeProfits: (current.takeProfits ?? []).filter((t) => t.id !== leg.id),
    };
  }

  if (remaining <= 0) {
    // Everything is off. The final leg doubles as the trade's close.
    const last = partials[partials.length - 1];
    return { position: current, closed: last, partials };
  }

  return { position: current, closed: null, partials };
}

/** Advance an open position by one bar: update excursions, then check for a fill. */
export function step(position: Position, bar: Candle): StepResult {
  const pos: Position = { ...position, bars: position.bars + 1 };
  const risk = riskUnit(pos);

  if (risk > 0) {
    const adverse = pos.direction === "long" ? (pos.entry - bar.low) / risk : (bar.high - pos.entry) / risk;
    const favourable = pos.direction === "long" ? (bar.high - pos.entry) / risk : (pos.entry - bar.low) / risk;
    if (adverse > pos.mae) pos.mae = adverse;
    if (favourable > pos.mfe) pos.mfe = favourable;
  }

  const long = pos.direction === "long";
  const stopTouched = long ? bar.low <= pos.stop : bar.high >= pos.stop;
  const targetTouched = pos.target !== null && (long ? bar.high >= pos.target : bar.low <= pos.target);

  /**
   * Scale-outs fill before anything else, and only when the stop did not also trade.
   *
   * A bar that reaches both a take-profit and the stop is ambiguous — from OHLC alone there is no
   * way to know which came first — and the engine has always resolved that pessimistically, in
   * favour of the stop. Filling a scale-out on such a bar would be assuming the good half of an
   * unknowable order, which is the assumption that makes a backtest flatter its strategy.
   */
  if (!stopTouched) {
    const hit = (pos.takeProfits ?? [])
      .filter((tp) => tp.contracts > 0 && (long ? bar.high >= tp.price : bar.low <= tp.price))
      // Nearest first, so two legs swept by one bar fill in the order price would have reached them.
      .sort((a, b) => (long ? a.price - b.price : b.price - a.price));

    if (hit.length) {
      return fillScaleOuts(pos, bar, hit);
    }
  }

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

/**
 * Take part of a position off at the current bar's close, leaving the rest running.
 *
 * A partial is two things at once — a finished trade for the contracts that left, and a smaller
 * position for the ones that stayed — so both come back and the caller replaces the position with
 * what is returned rather than editing it in place.
 *
 * The lot that closed keeps the entry, stop and target it was taken under: its R is the same R
 * the whole position had at this price, and only the money differs, because risk is restated on
 * the contracts actually leaving. That is what makes two partials on one position add up to the
 * same P&L as closing the lot in one go at those prices.
 *
 * The excursions travel with both halves. They are a property of how far the trade went, not of
 * how much of it was on at the time, and resetting them on the remainder would quietly erase the
 * heat the position had already taken.
 */
export function closePartial(position: Position, bar: Candle, contracts: number): { closed: ClosedTrade; remaining: Position | null } {
  const size = Math.min(Math.max(Math.floor(contracts), 1), position.contracts);
  const rest = position.contracts - size;
  const r = rOf(position, bar.close);
  const onePoint = riskUnit(position);
  const risk = onePoint * position.pointValue * size;

  const closed: ClosedTrade = {
    ...position,
    contracts: size,
    risk,
    exit: bar.close,
    exitTs: bar.ts,
    // Closing the last of it is not a partial, whatever the button said — it is the trade ending.
    reason: rest > 0 ? "partial" : "manual",
    r: Number(r.toFixed(4)),
    pnl: Number((r * risk).toFixed(2)),
    ambiguous: false,
  };

  if (rest === 0) return { closed, remaining: null };
  return {
    closed,
    remaining: {
      ...position,
      contracts: rest,
      risk: onePoint * position.pointValue * rest,
    },
  };
}

/**
 * Measure this trade's R from where the stop is now.
 *
 * The deliberate version of what moving a stop used to do by accident. A stop is often placed
 * roughly to get filled and then tightened to the level that actually invalidates the idea — and
 * it is that level, not the first guess, that the trade should be judged against. Pressing the
 * button says so; dragging the stop on its own still leaves R where it was.
 *
 * Refuses a stop sitting exactly on the entry, or past it in profit: either is a risk of nothing,
 * and every R measured against it would be infinite, zero or backwards rather than wrong in some
 * visible way.
 */
export function anchorRisk(position: Position, stop: number): Position {
  if (!Number.isFinite(stop) || stop === position.entry) return position;
  // A stop trailed into profit risks nothing, so it cannot be what one R is measured in.
  if (position.direction === "long" ? stop > position.entry : stop < position.entry) return position;
  return {
    ...position,
    initialStop: stop,
    risk: riskDistance(position.entry, stop) * position.pointValue * position.contracts,
  };
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
