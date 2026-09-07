/**
 * Portfolio arithmetic.
 *
 * Every number the portfolio page shows is computed here, and nothing in this file touches the
 * network, the database or the clock. That is deliberate: these are the figures you would use to
 * decide something, so they need to be testable directly rather than inspected on a rendered page.
 *
 * The hard part is not the arithmetic, it is what to do when a price is missing. A holding whose
 * price failed to load is not worth zero — it is worth an unknown amount, and showing zero would
 * quietly understate the portfolio. Everything below distinguishes the two.
 */

export type AssetType =
  | "stock"
  | "etf"
  | "crypto"
  | "other"
  | "metal"
  | "cash"
  | "property"
  | "collectible";

/**
 * The asset types no price feed can quote, so their value is whatever you last set.
 *
 * Kept as data rather than a chain of comparisons because three layers need the same answer — the
 * form, the route that decides whether to call the feed, and the server that decides whether to
 * fetch a quote — and they must not be able to disagree. A holding that the form treats as manual
 * but the fetcher treats as live would ask Finnhub for "GOLD", get nothing back, and show your
 * bullion as unpriced.
 */
export const MANUAL_ASSET_TYPES = ["metal", "cash", "property", "collectible"] as const;

export function isManuallyValued(assetType: string): boolean {
  return (MANUAL_ASSET_TYPES as readonly string[]).includes(assetType);
}

export interface Holding {
  id: string;
  symbol: string;
  name: string | null;
  shares: number;
  /** Cost basis per unit. For a gift, the value on the day it was received. */
  avgCost: number;
  /**
   * Cash actually spent. Undefined or null on holdings from before this was tracked, which are read
   * as "all of the basis was paid for" — the behaviour they already had.
   */
  amountInvested?: number | null;
  acquisition?: "purchase" | "gift" | "other" | "mixed" | null;
  acquiredAt?: string | null;
  assetType: AssetType;
  /** Set only for manually valued types; see `isManuallyValued`. */
  manualPrice?: number | null;
  manualPriceAt?: string | null;
  createdAt: string;
}

/**
 * A quote for something you value yourself.
 *
 * Deliberately reports `previousClose: null`. The day's move on a bar of silver is not zero, it is
 * unknown — nobody marked it overnight — and a zero would quietly drag the portfolio's daily
 * change percentage toward nothing. `fetchedAt` is when *you* set the price, so the interface can
 * say "you valued this three weeks ago" rather than implying a live number.
 */
export function manualQuote(holding: Holding, now: number = Date.now()): Quote | null {
  if (!isManuallyValued(holding.assetType)) return null;
  const price = holding.manualPrice;
  if (price === null || price === undefined || !Number.isFinite(price) || price <= 0) return null;
  const setAt = holding.manualPriceAt ? Date.parse(holding.manualPriceAt) : NaN;
  return {
    symbol: holding.symbol.toUpperCase(),
    price,
    previousClose: null,
    fetchedAt: Number.isFinite(setAt) ? setAt : now,
    stale: false,
  };
}

export interface Quote {
  symbol: string;
  price: number;
  /** Previous session's close, for the day's move. Null when the feed did not supply one. */
  previousClose: number | null;
  /** When this price was fetched (epoch ms). */
  fetchedAt: number;
  /** True when it came from cache after a failed refresh, so the UI can say so. */
  stale: boolean;
}

export interface Position {
  holding: Holding;
  quote: Quote | null;
  /** shares × price. Null when there is no price at all. */
  marketValue: number | null;
  /** shares × average cost. Always known — it comes from what you entered. */
  costBasis: number;
  /**
   * Of that basis, how much was your own money. Equal to `costBasis` for anything bought outright;
   * zero for a pure gift; somewhere between for a position that is part bought and part given.
   */
  invested: number;
  unrealised: number | null;
  unrealisedPct: number | null;
  /** Today's move on this position: shares × (price − previous close). */
  dayChange: number | null;
  dayChangePct: number | null;
  /** Share of the whole portfolio, including cash. Null while the value is unknown. */
  weight: number | null;
}

export interface PortfolioTotals {
  /** Holdings only. */
  marketValue: number;
  costBasis: number;
  /**
   * The part of the basis that was your own cash. Reported alongside rather than instead of
   * `costBasis`: returns are measured from the basis, but "how much did I actually put in" is a
   * different and equally real question, and a portfolio containing gifts cannot answer both with
   * one number.
   */
  invested: number;
  unrealised: number;
  unrealisedPct: number | null;
  dayChange: number;
  dayChangePct: number | null;
  cash: number;
  /** Holdings + cash. */
  total: number;
  /** Positions whose price could not be determined; their value is missing from the totals. */
  missingPrices: string[];
  /** Positions priced from a cached quote after a failed refresh. */
  stalePrices: string[];
}

/** Round money to the cent, avoiding the float dust that makes totals disagree with their parts. */
export function cents(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/**
 * One holding valued against one quote.
 *
 * A null quote produces nulls rather than zeros throughout. Cost basis is the exception: it is
 * derived entirely from what you typed, so it is known even when the market is not reachable.
 */
export function position(holding: Holding, quote: Quote | null): Omit<Position, "weight"> {
  const costBasis = cents(holding.shares * holding.avgCost);
  // Undefined means the holding predates acquisition tracking, and every such holding was bought:
  // reading it as zero would erase the money you actually spent from the invested total. Null is
  // treated the same way. An explicit 0 is a real answer — a gift — and is kept.
  const invested =
    holding.amountInvested === undefined || holding.amountInvested === null
      ? costBasis
      : cents(holding.amountInvested);

  if (!quote || !Number.isFinite(quote.price)) {
    return { holding, quote: null, marketValue: null, costBasis, invested, unrealised: null, unrealisedPct: null, dayChange: null, dayChangePct: null };
  }

  const marketValue = cents(holding.shares * quote.price);
  const unrealised = cents(marketValue - costBasis);
  // A zero cost basis has no percentage return — dividing by it gives Infinity, which is not a
  // number anyone wants to read. Free shares are rare but they do happen.
  const unrealisedPct = costBasis === 0 ? null : (unrealised / costBasis) * 100;

  const prev = quote.previousClose;
  const dayChange = prev === null || !Number.isFinite(prev) ? null : cents(holding.shares * (quote.price - prev));
  const dayChangePct = prev === null || prev === 0 || !Number.isFinite(prev) ? null : ((quote.price - prev) / prev) * 100;

  return { holding, quote, marketValue, costBasis, invested, unrealised, unrealisedPct, dayChange, dayChangePct };
}

/**
 * The whole portfolio.
 *
 * Positions with no price contribute their cost basis to nothing and are named in `missingPrices`,
 * so the page can say "two holdings could not be priced" instead of silently reporting a total
 * that is too low. Weights are computed against the total including cash, which is what makes the
 * allocation add up to 100%.
 */
export function portfolio(holdings: Holding[], quotes: Map<string, Quote>, cash: number): {
  positions: Position[];
  totals: PortfolioTotals;
} {
  const priced = holdings.map((h) => position(h, quotes.get(h.symbol.toUpperCase()) ?? null));
  return totalsOf(priced, cash);
}

/**
 * The same arithmetic, over an already-priced set of positions.
 *
 * Split out from `portfolio` so a filtered view — "just the metals", "everything but crypto" —
 * totals through this identical path rather than through a second implementation on the client.
 * Two sets of books disagreeing about what a percentage means is exactly the bug this prevents.
 */
export function totalsOf(priced: Omit<Position, "weight">[], cash: number): {
  positions: Position[];
  totals: PortfolioTotals;
} {
  const marketValue = cents(priced.reduce((sum, p) => sum + (p.marketValue ?? 0), 0));
  const costBasis = cents(priced.reduce((sum, p) => sum + p.costBasis, 0));
  const invested = cents(priced.reduce((sum, p) => sum + p.invested, 0));
  const dayChange = cents(priced.reduce((sum, p) => sum + (p.dayChange ?? 0), 0));
  const unrealised = cents(marketValue - cents(priced.reduce((sum, p) => sum + (p.marketValue === null ? 0 : p.costBasis), 0)));

  const safeCash = Number.isFinite(cash) ? cents(cash) : 0;
  const total = cents(marketValue + safeCash);

  // Yesterday's close of the part that actually reported a move, used for the day's percentage.
  //
  // Cash is excluded because it does not move: including it would dilute the number and make a flat
  // day on a large cash balance look like a tiny gain. Holdings with no day change are excluded for
  // a stronger reason — their move is *unknown*, not zero. Nobody marks a bar of silver overnight,
  // so counting its value in the denominator asserts it was flat, and a portfolio half in bullion
  // would report half the daily percentage its shares actually did.
  const movedValue = cents(priced.reduce((sum, p) => sum + (p.dayChange === null ? 0 : p.marketValue ?? 0), 0));
  const priorValue = cents(movedValue - dayChange);

  return {
    positions: priced.map((p) => ({
      ...p,
      weight: p.marketValue === null || total === 0 ? null : (p.marketValue / total) * 100,
    })),
    totals: {
      marketValue,
      costBasis,
      invested,
      unrealised,
      unrealisedPct: costBasis === 0 ? null : (unrealised / costBasis) * 100,
      dayChange,
      dayChangePct: priorValue === 0 ? null : (dayChange / priorValue) * 100,
      cash: safeCash,
      total,
      missingPrices: priced.filter((p) => p.marketValue === null).map((p) => p.holding.symbol),
      stalePrices: priced.filter((p) => p.quote?.stale).map((p) => p.holding.symbol),
    },
  };
}

/**
 * Allocation slices, holdings plus cash, largest first.
 *
 * Unpriced holdings are left out rather than shown as 0% — a slice of zero reads as "I own none of
 * this", which is the opposite of "I could not price this".
 */
export function allocation(positions: Position[], cash: number, total: number): { label: string; value: number; pct: number }[] {
  if (total <= 0) return [];
  const slices = positions
    .filter((p) => p.marketValue !== null && p.marketValue > 0)
    .map((p) => ({ label: p.holding.symbol, value: p.marketValue as number, pct: ((p.marketValue as number) / total) * 100 }));
  if (cash > 0) slices.push({ label: "Cash", value: cash, pct: (cash / total) * 100 });
  return slices.sort((a, b) => b.value - a.value);
}

export interface Snapshot {
  ts: number;
  total: number;
  cash: number;
  invested: number;
  /**
   * Market value at that moment, split by asset type — what makes a filtered chart possible.
   *
   * Null on every row recorded before this was tracked, and those rows are dropped from a filtered
   * line rather than guessed at. A chart cannot be told retroactively how much of a total was gold:
   * the number was never written down, and inventing a split would turn a record into a drawing.
   */
  breakdown: Record<string, number> | null;
}

/**
 * What a snapshot was worth, counting only the chosen asset types.
 *
 * Returns null when the split is unknowable for that moment, so the caller can leave a gap instead
 * of plotting a total that answers a different question than the one being asked.
 */
export function snapshotValue(s: Snapshot, classes: readonly string[] | null): number | null {
  if (classes === null) return s.total;
  if (!s.breakdown) return null;
  const holdings = classes.reduce((sum, c) => sum + (s.breakdown?.[c] ?? 0), 0);
  // Cash is its own class in the picker, so it is included only when explicitly chosen — the same
  // rule the live totals use.
  return cents(holdings + (classes.includes("cash_balance") ? s.cash : 0));
}

export type Range = "1D" | "1W" | "1M" | "3M" | "1Y" | "ALL";

const RANGE_MS: Record<Exclude<Range, "ALL">, number> = {
  "1D": 86_400_000,
  "1W": 7 * 86_400_000,
  "1M": 30 * 86_400_000,
  "3M": 90 * 86_400_000,
  "1Y": 365 * 86_400_000,
};

/**
 * Snapshots inside a range.
 *
 * No interpolation and no back-filling: a range with two snapshots draws two points. Inventing the
 * shape of a curve you did not record would make the chart a drawing rather than a record, and the
 * whole reason for storing snapshots is that the history is real.
 */
/** Snapshots that can answer for these classes. Everything, when nothing is filtered. */
export function filterable(snapshots: Snapshot[], classes: readonly string[] | null): Snapshot[] {
  if (classes === null) return snapshots;
  return snapshots.filter((s) => snapshotValue(s, classes) !== null);
}

export function inRange(snapshots: Snapshot[], range: Range, now: number = Date.now()): Snapshot[] {
  const sorted = [...snapshots].sort((a, b) => a.ts - b.ts);
  if (range === "ALL") return sorted;
  return sorted.filter((s) => s.ts >= now - RANGE_MS[range]);
}

/** Which ranges have enough recorded history to be worth offering. */
export function availableRanges(snapshots: Snapshot[], now: number = Date.now()): Range[] {
  const all: Range[] = ["1D", "1W", "1M", "3M", "1Y", "ALL"];
  return all.filter((r) => inRange(snapshots, r, now).length >= 2);
}

/**
 * Whether this snapshot is worth storing.
 *
 * Refreshing prices every minute would otherwise write a row every minute, and a year of that is
 * half a million rows describing a line that barely moves. One row per interval unless the value
 * actually changed, which keeps the history honest and the table small.
 */
export function shouldSnapshot(last: Snapshot | null, next: Omit<Snapshot, "ts">, now: number, minGapMs = 15 * 60_000): boolean {
  if (!last) return true;
  if (now - last.ts >= minGapMs) return true;
  // A material change is worth recording immediately, whatever the interval — that is usually you
  // editing a holding, and losing the before-and-after would misrepresent what happened.
  return Math.abs(next.total - last.total) >= 0.01;
}

/**
 * Average cost from a transaction history, using the weighted-average method.
 *
 * A sale does not change the average cost of what remains; it only reduces the share count. That is
 * the convention every broker statement uses, so matching it keeps this agreeing with Robinhood.
 * Returns null when the transactions cannot produce a position (for example selling more than held).
 */
export function costFromTransactions(
  txs: { kind: "buy" | "sell"; shares: number; price: number; date: string }[]
): { shares: number; avgCost: number } | null {
  const ordered = [...txs].sort((a, b) => a.date.localeCompare(b.date));
  let shares = 0;
  let cost = 0;

  for (const t of ordered) {
    if (!Number.isFinite(t.shares) || t.shares <= 0) continue;
    if (t.kind === "buy") {
      cost += t.shares * t.price;
      shares += t.shares;
    } else {
      if (t.shares > shares + 1e-9) return null; // sold more than held: the history is wrong
      const avg = shares === 0 ? 0 : cost / shares;
      cost -= t.shares * avg;
      shares -= t.shares;
    }
  }

  if (shares <= 1e-9) return { shares: 0, avgCost: 0 };
  return { shares, avgCost: cost / shares };
}

/** One recorded lot, as both cost and acquisition arithmetic need to see it. */
export interface Lot {
  kind: "buy" | "sell";
  shares: number;
  /** Cost basis per unit. */
  price: number;
  date: string;
  acquisition?: "purchase" | "gift" | "other" | null;
  /** Cash paid for the lot. Null or undefined means the whole basis was paid. */
  cashPaid?: number | null;
}

/**
 * How much of your own money is still tied up in a position, and how the lots arrived.
 *
 * The companion to `costFromTransactions`, and it has to walk the history separately because the
 * two answers diverge: a gift adds to the basis but not to the cash. Both use the same
 * weighted-average convention, so a sale takes a proportional slice out of each — sell half a
 * position that was half gifted and you are left with half the basis and half the cash.
 *
 * A lot's cash defaults to its full basis, which is what an ordinary purchase is. A gift defaults
 * to nothing. `cashPaid` overrides both, because the real world has partial cases — you paid $500
 * towards something worth $2,000 and were given the rest.
 *
 * `acquisition` is "mixed" when the buys did not all arrive the same way. Sells are ignored for
 * that summary: selling does not change how what remains came to you.
 */
export function investedFromTransactions(txs: Lot[]): {
  invested: number;
  acquisition: "purchase" | "gift" | "other" | "mixed" | null;
  acquiredAt: string | null;
} {
  const ordered = [...txs].sort((a, b) => a.date.localeCompare(b.date));
  let shares = 0;
  let invested = 0;
  const kinds = new Set<string>();
  let acquiredAt: string | null = null;

  for (const t of ordered) {
    if (!Number.isFinite(t.shares) || t.shares <= 0) continue;

    if (t.kind === "buy") {
      const how = t.acquisition ?? "purchase";
      kinds.add(how);
      if (acquiredAt === null) acquiredAt = t.date;
      // Null and undefined mean "not recorded", so fall back on what the acquisition implies.
      // A stored 0 is an answer and survives, which is how a gift with an explicit zero stays zero.
      const paid =
        t.cashPaid === null || t.cashPaid === undefined ? (how === "purchase" ? t.shares * t.price : 0) : t.cashPaid;
      invested += paid;
      shares += t.shares;
    } else {
      if (t.shares > shares + 1e-9) break; // the history is wrong; costFromTransactions reports it
      const perShare = shares === 0 ? 0 : invested / shares;
      invested -= t.shares * perShare;
      shares -= t.shares;
    }
  }

  const acquisition =
    kinds.size === 0 ? null : kinds.size > 1 ? "mixed" : ([...kinds][0] as "purchase" | "gift" | "other");

  return {
    // Float dust from the proportional sells above would otherwise leave a fully sold position
    // holding a fraction of a cent.
    invested: shares <= 1e-9 ? 0 : Math.max(0, cents(invested)),
    acquisition,
    acquiredAt,
  };
}

/**
 * How many shares a given amount of money buys at a given price.
 *
 * Trivial arithmetic, but it earns its own function because of where the division has to happen.
 * If the browser converts using a price it fetched and the server then records at a price fetched a
 * second later, the cost basis will not equal the amount you typed — "$500 of AAPL" quietly becomes
 * $499.83. Doing the division on the server with the exact price being stamped makes
 * shares × price === amount by construction.
 *
 * Returns null rather than Infinity or NaN for a price of zero or a nonsensical amount.
 */
export function sharesForAmount(amount: number, price: number): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (!Number.isFinite(price) || price <= 0) return null;
  const shares = amount / price;
  return Number.isFinite(shares) && shares > 0 ? shares : null;
}

/**
 * How the portfolio has actually performed since you started tracking it.
 *
 * The naive version — last recorded value minus the first — is wrong in a way that flatters you.
 * Adding a holding raises the total without earning anything, so entering a $2,900 position the
 * day after you start would show up as a $2,900 gain. Topping up your cash balance does the same.
 * Neither is performance; both are money you put in.
 *
 * So contributions are subtracted. What is left is the part the market did:
 *
 *   gain = (value now − value at the start) − (everything paid in since)
 *
 * Where a contribution is a buy recorded after the starting point, less anything sold, plus any
 * change in the cash balance — cash does not move on its own, so every dollar of change in it was
 * put there or taken out by you.
 *
 * Returns null rather than a number when there is nothing meaningful to report: fewer than two
 * recorded values, or a starting base of zero. A percentage of nothing is not zero, it is
 * undefined, and printing 0.00% would be a claim rather than an absence.
 */
export function performanceSinceStart(
  snapshots: Snapshot[],
  transactions: { kind: "buy" | "sell"; shares: number; price: number; at: number }[]
): { gain: number; pct: number | null; from: number; startTotal: number; contributions: number } | null {
  if (snapshots.length < 2) return null;

  const ordered = [...snapshots].sort((a, b) => a.ts - b.ts);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];

  /**
   * Filtered on when the transaction was *recorded*, not the date written on it.
   *
   * This is the difference between working and quietly wrong. The opening balance is a photograph
   * of the portfolio at one instant, so anything already in it must not be subtracted again — and
   * "already in it" means entered before that instant, regardless of what date it carries. Filter
   * by trade date instead and rebaselining to today double-counts every position you added today,
   * understating every gain from then on by exactly the size of your portfolio.
   */
  const traded = transactions
    .filter((t) => Number.isFinite(t.at) && t.at > first.ts)
    .reduce((sum, t) => sum + (t.kind === "buy" ? 1 : -1) * t.shares * t.price, 0);

  const contributions = cents(traded + (last.cash - first.cash));
  const gain = cents(last.total - first.total - contributions);

  // Measured against the capital that was actually at work: what you started with, plus whatever
  // you added along the way. Dividing by the opening value alone would overstate the return of a
  // portfolio that has grown mostly by deposit.
  const base = first.total + Math.max(0, contributions);

  return {
    gain,
    pct: base <= 0 ? null : (gain / base) * 100,
    from: first.ts,
    startTotal: first.total,
    contributions,
  };
}
