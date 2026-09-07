import type { Quote } from "./portfolio";
import { quoteSymbolFor } from "./symbols";

/**
 * Market prices, and what to do when they are not available.
 *
 * Prices come from Finnhub, whose `/quote` endpoint returns the current price, the previous close
 * and today's change in a single call — which is exactly what the dashboard needs, and means one
 * request per symbol rather than two. The key is read from the environment here on the server and
 * never leaves it.
 *
 * The rules that matter more than the fetching:
 *
 *   1. A failed refresh falls back to the last cached price, marked stale. The alternative — zero,
 *      or a broken page — is worse than a slightly old number, as long as it says it is old.
 *   2. Prices are cached, so opening the page twice in a minute makes no requests at all.
 *   3. Requests are spaced. The free tier allows 60 a minute; a portfolio of twenty symbols
 *      refreshed carelessly could trip that and get the key throttled.
 */

/** How long a fetched price is considered current. */
export const CACHE_TTL_MS = 60_000;

/** Finnhub's free tier is 60 calls/minute. This stays comfortably inside it. */
const MIN_REQUEST_GAP_MS = 120;
const REQUEST_TIMEOUT_MS = 8_000;

export interface RawQuote {
  price: number;
  previousClose: number | null;
}

export function hasApiKey(): boolean {
  return Boolean(process.env.FINNHUB_API_KEY?.trim());
}

/**
 * Decide what still needs fetching.
 *
 * Split out from the fetching so the caching rule can be tested without a network: given what is
 * cached and how old it is, which symbols actually warrant a request?
 */
export function needsRefresh(
  symbols: string[],
  cached: Map<string, { fetchedAt: number }>,
  now: number,
  ttl = CACHE_TTL_MS
): string[] {
  const wanted = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  return wanted.filter((s) => {
    const hit = cached.get(s);
    return !hit || now - hit.fetchedAt >= ttl;
  });
}

/**
 * Read one quote out of a Finnhub response.
 *
 * Kept separate and total: Finnhub answers an unknown symbol with `200 OK` and a body of zeros
 * rather than an error, so a price of 0 has to be treated as "no such symbol" instead of being
 * written into the cache as a real price. That single quirk is the reason this is its own function
 * with its own tests.
 */
export function parseQuote(body: unknown): RawQuote | null {
  if (!body || typeof body !== "object") return null;
  const q = body as { c?: unknown; pc?: unknown };
  const price = typeof q.c === "number" ? q.c : Number(q.c);
  if (!Number.isFinite(price) || price <= 0) return null;
  const prevRaw = typeof q.pc === "number" ? q.pc : Number(q.pc);
  const previousClose = Number.isFinite(prevRaw) && prevRaw > 0 ? prevRaw : null;
  return { price, previousClose };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchOne(symbol: string, key: string): Promise<RawQuote | null> {
  // The feed's name for it, which is not always yours: Finnhub quotes BTC only as
  // "BINANCE:BTCUSDT", and returns an empty body for a bare "BTC".
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(quoteSymbolFor(symbol))}&token=${encodeURIComponent(key)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) return null;
    return parseQuote(await res.json());
  } catch {
    // Timeout, DNS, offline, rate limit — all the same from here: no price this time, use the
    // cache. The caller decides how to present that, which is the only place it matters.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface CachedPrice {
  symbol: string;
  price: number;
  previousClose: number | null;
  fetchedAt: number;
}

/**
 * Fetch what is stale, keep what is not, and never lose a price to a failed request.
 *
 * Returns a quote for every symbol that has ever been priced — freshly if the fetch worked, from
 * cache and marked stale if it did not. A symbol that has never priced successfully is simply
 * absent, which the portfolio maths reads as "unknown" rather than zero.
 */
export async function refreshQuotes(
  symbols: string[],
  cache: Map<string, CachedPrice>,
  opts: { now?: number; force?: boolean; ttl?: number } = {}
): Promise<{ quotes: Map<string, Quote>; fetched: string[]; failed: string[] }> {
  const now = opts.now ?? Date.now();
  const key = process.env.FINNHUB_API_KEY?.trim() ?? "";
  const wanted = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];

  const toFetch = key ? (opts.force ? wanted : needsRefresh(wanted, cache, now, opts.ttl)) : [];
  const fresh = new Map<string, CachedPrice>();
  const failed: string[] = [];

  for (let i = 0; i < toFetch.length; i++) {
    // Spaced out rather than fired in parallel: twenty simultaneous requests is how a free key
    // gets rate-limited, and the page is not waiting on a stopwatch.
    if (i > 0) await sleep(MIN_REQUEST_GAP_MS);
    const raw = await fetchOne(toFetch[i], key);
    if (raw) fresh.set(toFetch[i], { symbol: toFetch[i], ...raw, fetchedAt: now });
    else failed.push(toFetch[i]);
  }

  const quotes = new Map<string, Quote>();
  for (const symbol of wanted) {
    const hit = fresh.get(symbol);
    if (hit) {
      quotes.set(symbol, { symbol, price: hit.price, previousClose: hit.previousClose, fetchedAt: hit.fetchedAt, stale: false });
      continue;
    }
    const old = cache.get(symbol);
    if (old) {
      // Stale when the fetch was attempted and failed, or when it is simply older than the TTL.
      const attempted = toFetch.includes(symbol);
      quotes.set(symbol, {
        symbol,
        price: old.price,
        previousClose: old.previousClose,
        fetchedAt: old.fetchedAt,
        stale: attempted || now - old.fetchedAt >= (opts.ttl ?? CACHE_TTL_MS),
      });
    }
  }

  return { quotes, fetched: [...fresh.keys()], failed };
}

/** "2 minutes ago", for the freshness line under the refresh button. */
export function agoLabel(from: number | null, now: number = Date.now()): string {
  if (!from) return "never";
  const secs = Math.max(0, Math.round((now - from) / 1000));
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs} seconds ago`;
  const mins = Math.round(secs / 60);
  if (mins === 1) return "1 minute ago";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}
