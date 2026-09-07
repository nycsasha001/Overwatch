import {
  getPortfolioMeta,
  listTransactions,
  insertSnapshot,
  lastSnapshot,
  listHoldings,
  listSnapshots,
  readPriceCache,
  writePriceCache,
} from "./db";
import {
  allocation,
  cents,
  isManuallyValued,
  manualQuote,
  performanceSinceStart,
  portfolio,
  shouldSnapshot,
  type Holding,
  type Position,
  type PortfolioTotals,
  type Quote,
  type Snapshot,
} from "./portfolio";
import { hasApiKey, refreshQuotes } from "./prices";

/**
 * Assembles everything the portfolio page shows, in one place.
 *
 * The page needs holdings, prices, totals, allocation and history together — computing them in
 * separate requests would let them disagree with each other, so the client gets one consistent
 * picture per request and never does the arithmetic itself.
 */

export interface PortfolioState {
  positions: Position[];
  totals: PortfolioTotals;
  allocation: { label: string; value: number; pct: number }[];
  snapshots: Snapshot[];
  /** When prices were last successfully fetched, for the "updated N minutes ago" line. */
  lastFetchedAt: number | null;
  /** False when FINNHUB_API_KEY is unset: the page then says prices are unavailable rather than lying. */
  pricingEnabled: boolean;
  /** Symbols whose refresh failed on this request. */
  priceErrors: string[];
  /**
   * What the market did since tracking began, with money you paid in taken out of it.
   *
   * Null until there are two recorded values to compare. Computed on the server so the page cannot
   * disagree with itself about what counts as a gain.
   */
  performance: { gain: number; pct: number | null; from: number; startTotal: number; contributions: number } | null;
  /**
   * The lots, reduced to what performance arithmetic needs, so a filtered view can recompute
   * "since you started" for a subset of asset types through the same tested function rather than a
   * second implementation. `assetType` is carried because the browser cannot classify a symbol it
   * no longer holds.
   */
  lots: { symbol: string; assetType: string; kind: "buy" | "sell"; shares: number; price: number; at: number }[];
}

export async function portfolioState(opts: { force?: boolean } = {}): Promise<PortfolioState> {
  const now = Date.now();
  const rows = listHoldings();
  const holdings: Holding[] = rows.map((h) => ({
    id: h.id,
    symbol: h.symbol,
    name: h.name,
    shares: h.shares,
    avgCost: h.avgCost,
    amountInvested: h.amountInvested,
    acquisition: h.acquisition,
    acquiredAt: h.acquiredAt,
    assetType: h.assetType,
    manualPrice: h.manualPrice,
    manualPriceAt: h.manualPriceAt,
    createdAt: h.createdAt,
  }));

  // Gold in a safe has no ticker. Asking the feed for "GOLD" would spend a request from a rate
  // limit shared with the holdings that do need one, and come back empty — so those are valued
  // from what you last said and never reach the network.
  const feedPriced = holdings.filter((h) => !isManuallyValued(h.assetType));

  const cache = readPriceCache();
  const { quotes, fetched, failed } = await refreshQuotes(
    feedPriced.map((h) => h.symbol),
    cache,
    { force: opts.force }
  );

  // Captured before the hand-set quotes go in: "prices updated 2 minutes ago" is a claim about the
  // feed, and folding in the day you valued your bullion would make it say two months.
  const lastFetchedAt = [...quotes.values()].reduce<number | null>(
    (max, q) => (max === null || q.fetchedAt > max ? q.fetchedAt : max),
    null
  );

  for (const h of holdings) {
    const q: Quote | null = manualQuote(h, now);
    if (q) quotes.set(q.symbol, q);
  }

  // Persist anything freshly fetched so the next request — or the next restart, or the next outage
  // — has a price to fall back on.
  if (fetched.length) {
    writePriceCache(
      fetched
        .map((s) => quotes.get(s))
        .filter((q): q is NonNullable<typeof q> => Boolean(q))
        .map((q) => ({ symbol: q.symbol, price: q.price, previousClose: q.previousClose, fetchedAt: q.fetchedAt }))
    );
  }

  const { cash } = getPortfolioMeta();
  const { positions, totals } = portfolio(holdings, quotes, cash);

  // Record the value, but only when it is worth recording. See shouldSnapshot: one row per fifteen
  // minutes unless something actually moved, otherwise a year of refreshes is half a million rows.
  // The split that makes a filtered chart possible. Positions with no price contribute nothing —
  // they are already absent from the total, and inventing a value for them here would make the
  // parts disagree with the whole.
  const breakdown: Record<string, number> = {};
  for (const p of positions) {
    if (p.marketValue === null) continue;
    breakdown[p.holding.assetType] = cents((breakdown[p.holding.assetType] ?? 0) + p.marketValue);
  }

  const candidate = { total: totals.total, cash: totals.cash, invested: totals.marketValue, breakdown };
  const previous = lastSnapshot();
  // An empty portfolio records nothing, so the chart begins at your first real value rather than at
  // zero. Starting from zero would make the first holding you add look like an infinite gain
  // instead of a starting point — and after a reset, that is exactly what would happen.
  //
  // The exception is a portfolio that *becomes* empty: once there is history, a drop to zero is a
  // real event and belongs in it.
  const hasValue = totals.marketValue > 0 || totals.cash > 0;
  const worthRecording = hasValue || previous !== null;
  if (worthRecording && shouldSnapshot(previous, candidate, now)) {
    insertSnapshot({ ts: now, ...candidate });
  }

  const snapshots = listSnapshots();
  const byType = new Map(rows.map((h) => [h.symbol.toUpperCase(), h.assetType as string]));
  const txs = listTransactions();

  return {
    lots: txs.map((t) => ({
      symbol: t.symbol,
      // A symbol you have sold out of has no holding left to classify it. "other" keeps it in the
      // unfiltered arithmetic while excluding it from every specific class, which is the honest
      // answer when the type genuinely is not recorded any more.
      assetType: byType.get(t.symbol.toUpperCase()) ?? "other",
      kind: t.kind,
      shares: t.shares,
      price: t.price,
      at: Date.parse(t.createdAt),
    })),
    positions,
    totals,
    allocation: allocation(positions, totals.cash, totals.total),
    snapshots,
    performance: performanceSinceStart(
      snapshots,
      txs.map((t) => ({ kind: t.kind, shares: t.shares, price: t.price, at: Date.parse(t.createdAt) }))
    ),
    lastFetchedAt,
    pricingEnabled: hasApiKey(),
    priceErrors: failed,
  };
}
