import type { RawQuote } from "./prices";

/**
 * Live prices for bullion.
 *
 * Metals used to be valued by hand alongside property and collectibles, for a good reason that is
 * worth restating: pricing an ounce of gold off GLD produces a confident, wrong number. At the time
 * of writing GLD traded at $400.07 against $4,400 an ounce — a ratio of roughly eleven that is not
 * fixed, because the fund's expenses come out of the metal it holds, so the share slowly represents
 * less gold every year. A portfolio built on that drifts away from the truth and never says so.
 *
 * The answer is not to go back to the ETF, it is to quote the metal. Front-month COMEX futures are
 * the closest freely available thing to spot: GC=F printed $4,400.40 against the $4,400 spot figure
 * in the original note. They are quoted in US dollars per troy ounce, which is exactly the unit
 * holdings are already stored in.
 *
 * Two honest caveats. A future is not spot — it carries a small basis for financing and storage,
 * typically a few dollars on gold, against the ETF's error of several thousand. And the front month
 * rolls; the feed's continuous series handles that, but the tiny step at each roll is real. Both are
 * rounding errors next to valuing bullion off a share price, and neither is hidden: a holding whose
 * symbol is not recognised here keeps its hand-set price rather than being guessed at.
 *
 * Finnhub is not used because its free tier answers spot metal symbols with 403 — it quotes the
 * ETFs and nothing else, which is the exact thing this avoids.
 */

/**
 * Symbols understood as bullion, and the contract each is priced from.
 *
 * Generous on input because nobody agrees what to call these: the ISO currency code (XAU), the
 * element (AU), the plain English word, and the exchange's own ticker all appear in the wild, and
 * a holding typed as "GOLD" should not be silently left unpriced because the catalogue wanted
 * "XAU".
 */
export const METAL_SPOT_SYMBOLS: Record<string, string> = {
  GOLD: "GC=F",
  XAU: "GC=F",
  AU: "GC=F",
  GC: "GC=F",
  SILVER: "SI=F",
  XAG: "SI=F",
  AG: "SI=F",
  SI: "SI=F",
  PLATINUM: "PL=F",
  XPT: "PL=F",
  PL: "PL=F",
  PALLADIUM: "PA=F",
  XPD: "PA=F",
  PA: "PA=F",
};

/** The contract to quote a holding from, or null when it is not a metal this can price. */
export function metalSpotSymbol(symbol: string): string | null {
  return METAL_SPOT_SYMBOLS[symbol.trim().toUpperCase()] ?? null;
}

/**
 * Read a price out of a Yahoo chart response.
 *
 * Total and separate from the fetching, for the same reason `parseQuote` is in prices.ts: the
 * failure that matters is a well-formed reply carrying no usable price, and that is only worth
 * trusting if it can be tested without a network.
 *
 * `chartPreviousClose` is preferred over `previousClose` — on a futures series the former is the
 * prior session's settle, which is what a day's move should be measured against.
 */
export function parseMetalQuote(body: unknown): RawQuote | null {
  if (!body || typeof body !== "object") return null;
  const meta = (body as { chart?: { result?: { meta?: unknown }[] } })?.chart?.result?.[0]?.meta;
  if (!meta || typeof meta !== "object") return null;
  const m = meta as { regularMarketPrice?: unknown; chartPreviousClose?: unknown; previousClose?: unknown };

  const price = Number(m.regularMarketPrice);
  if (!Number.isFinite(price) || price <= 0) return null;

  const prevRaw = Number(m.chartPreviousClose ?? m.previousClose);
  const previousClose = Number.isFinite(prevRaw) && prevRaw > 0 ? prevRaw : null;
  return { price, previousClose };
}

const REQUEST_TIMEOUT_MS = 8_000;

async function fetchContract(contract: string): Promise<RawQuote | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(contract)}?range=1d&interval=1d`;
  try {
    const res = await fetch(url, {
      // Answered with a 404 and an HTML body without one.
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return parseMetalQuote(await res.json());
  } catch {
    // A metals outage must never take the rest of the portfolio down with it. The caller falls back
    // to the cached price, and past that to whatever you last set by hand.
    return null;
  }
}

/**
 * Quote every recognised metal among `symbols`, keyed by the holding's own symbol.
 *
 * Each distinct contract is fetched once however many holdings reference it, so a safe holding gold
 * bars, gold coins and a gold ring costs one request rather than three.
 */
export async function fetchMetalQuotes(symbols: string[]): Promise<Map<string, RawQuote>> {
  const wanted = new Map<string, string>();
  for (const s of symbols) {
    const contract = metalSpotSymbol(s);
    if (contract) wanted.set(s.trim().toUpperCase(), contract);
  }
  if (!wanted.size) return new Map();

  const contracts = [...new Set(wanted.values())];
  const results = await Promise.all(contracts.map(async (c) => [c, await fetchContract(c)] as const));
  const byContract = new Map(results);

  const out = new Map<string, RawQuote>();
  for (const [symbol, contract] of wanted) {
    const quote = byContract.get(contract);
    if (quote) out.set(symbol, quote);
  }
  return out;
}
