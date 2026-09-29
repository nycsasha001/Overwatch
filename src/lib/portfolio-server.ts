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
import { CACHE_TTL_MS, hasApiKey, needsRefresh, refreshQuotes } from "./prices";
import { fetchMetalQuotes, metalSpotSymbol } from "./metals";
import type { Scope } from "./users";

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

export async function portfolioState(u: Scope, opts: { force?: boolean } = {}): Promise<PortfolioState> {
  const now = Date.now();
  const rows = listHoldings(u);
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

  /**
   * Property and collectibles have no ticker, and asking Finnhub for "THE FLAT" would spend a
   * request from a limit shared with the holdings that need one. Those stay hand-valued.
   *
   * Bullion is the exception, and it is quoted separately rather than through Finnhub: the free
   * tier answers spot metal symbols with 403 and offers only the ETFs, which is exactly the
   * substitution that makes an ounce of gold look like $400. See metals.ts.
   */
  const feedPriced = holdings.filter((h) => !isManuallyValued(h.assetType));
  const metalPriced = holdings.filter((h) => h.assetType === "metal" && metalSpotSymbol(h.symbol));

  const cache = readPriceCache(u);
  const { quotes, fetched, failed } = await refreshQuotes(
    feedPriced.map((h) => h.symbol),
    cache,
    { force: opts.force }
  );

  /**
   * Bullion, priced off the metal rather than off a fund that holds it.
   *
   * Cached and staleness-handled exactly as the Finnhub quotes are, and for the same reasons: the
   * metals feed takes no key, which makes it easy to forget it is someone else's server and that
   * it will rate-limit a caller that asks on every page load. One price per minute per metal is
   * plenty for something that moves in dollars a day.
   *
   * A failed fetch falls back to the last cached price, marked stale, rather than dropping the
   * holding out of the total. A metal whose symbol is not recognised is not here at all, and falls
   * through to its hand-set price below.
   */
  const metalSymbols = new Set<string>();
  if (metalPriced.length) {
    const wanted = [...new Set(metalPriced.map((h) => h.symbol.trim().toUpperCase()))];
    const toFetch = opts.force ? wanted : needsRefresh(wanted, cache, now);
    const live = toFetch.length ? await fetchMetalQuotes(toFetch) : new Map();

    for (const symbol of wanted) {
      const raw = live.get(symbol);
      if (raw) {
        metalSymbols.add(symbol);
        quotes.set(symbol, { symbol, price: raw.price, previousClose: raw.previousClose, fetchedAt: now, stale: false });
        continue;
      }
      const old = cache.get(symbol);
      if (old) {
        quotes.set(symbol, {
          symbol,
          price: old.price,
          previousClose: old.previousClose,
          fetchedAt: old.fetchedAt,
          // Stale when a fetch was attempted and failed, or when it is simply past the TTL.
          stale: toFetch.includes(symbol) || now - old.fetchedAt >= CACHE_TTL_MS,
        });
      }
    }
  }

  // Captured before the hand-set quotes go in: "prices updated 2 minutes ago" is a claim about the
  // feed, and folding in the day you valued your flat would make it say two months. Metals count —
  // they are a live quote now, not something you last touched in March.
  const lastFetchedAt = [...quotes.values()].reduce<number | null>(
    (max, q) => (max === null || q.fetchedAt > max ? q.fetchedAt : max),
    null
  );

  /**
   * Hand-set prices, for everything a feed did not answer.
   *
   * Only fills gaps, where it used to overwrite. A hand-set price on a metal is now the fallback
   * for a failed fetch or an unrecognised symbol, not a permanent override of a live quote —
   * otherwise a price typed once in March would outrank today's, which is the opposite of what
   * valuing bullion live is for.
   */
  for (const h of holdings) {
    const q: Quote | null = manualQuote(h, now);
    if (q && !quotes.has(q.symbol)) quotes.set(q.symbol, q);
  }

  // Persist anything freshly fetched so the next request — or the next restart, or the next outage
  // — has a price to fall back on.
  if (fetched.length || metalSymbols.size) {
    writePriceCache(u, 
      [...fetched, ...metalSymbols]
        .map((s) => quotes.get(s))
        .filter((q): q is NonNullable<typeof q> => Boolean(q))
        .map((q) => ({ symbol: q.symbol, price: q.price, previousClose: q.previousClose, fetchedAt: q.fetchedAt }))
    );
  }

  const { cash } = getPortfolioMeta(u);
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
  const previous = lastSnapshot(u);
  // An empty portfolio records nothing, so the chart begins at your first real value rather than at
  // zero. Starting from zero would make the first holding you add look like an infinite gain
  // instead of a starting point — and after a reset, that is exactly what would happen.
  //
  // The exception is a portfolio that *becomes* empty: once there is history, a drop to zero is a
  // real event and belongs in it.
  const hasValue = totals.marketValue > 0 || totals.cash > 0;
  const worthRecording = hasValue || previous !== null;
  if (worthRecording && shouldSnapshot(previous, candidate, now)) {
    insertSnapshot(u, { ts: now, ...candidate });
  }

  const snapshots = listSnapshots(u);
  const byType = new Map(rows.map((h) => [h.symbol.toUpperCase(), h.assetType as string]));
  const txs = listTransactions(u);

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
