import assert from "node:assert/strict";
import { agoLabel, needsRefresh, parseQuote, refreshQuotes, type CachedPrice } from "../src/lib/prices.ts";

let checks = 0;
const ok = (name: string, fn: () => void | Promise<void>) => {
  const done = () => {
    checks++;
    console.log(`  ok  ${name}`);
  };
  const r = fn();
  return r instanceof Promise ? r.then(done) : (done(), Promise.resolve());
};

const cached = (symbol: string, price: number, fetchedAt: number): CachedPrice => ({
  symbol,
  price,
  previousClose: price - 1,
  fetchedAt,
});

const run = async () => {
  await ok("an unknown symbol is not a price of zero", () => {
    // Finnhub answers a bad ticker with 200 OK and a body of zeros. Storing that would put a
    // $0.00 holding on the dashboard and quietly wreck the total.
    assert.equal(parseQuote({ c: 0, pc: 0 }), null);
    assert.equal(parseQuote({}), null);
    assert.equal(parseQuote(null), null);
    assert.equal(parseQuote("nonsense"), null);
    assert.equal(parseQuote({ c: -5 }), null, "a negative price is not a price either");
  });

  await ok("a real quote is read out with its previous close", () => {
    assert.deepEqual(parseQuote({ c: 250.5, pc: 245 }), { price: 250.5, previousClose: 245 });
  });

  await ok("a quote with no previous close still gives a price", () => {
    // Crypto and some after-hours responses omit it. The position is still worth something; only
    // today's move is unknown.
    assert.deepEqual(parseQuote({ c: 250.5, pc: 0 }), { price: 250.5, previousClose: null });
  });

  await ok("string numbers from a sloppy response are still read", () => {
    assert.deepEqual(parseQuote({ c: "100", pc: "99" }), { price: 100, previousClose: 99 });
  });

  await ok("nothing is refetched while it is still fresh", () => {
    const now = 1_000_000;
    const cache = new Map([["TSLA", cached("TSLA", 250, now - 10_000)]]);
    assert.deepEqual(needsRefresh(["TSLA"], cache, now), [], "10 seconds old, inside the minute");
    assert.deepEqual(needsRefresh(["TSLA"], cache, now + 60_000), ["TSLA"], "past the TTL");
    assert.deepEqual(needsRefresh(["SPY"], cache, now), ["SPY"], "never fetched");
  });

  await ok("duplicate and lowercase symbols make one request", () => {
    const out = needsRefresh(["tsla", "TSLA", " tsla ", ""], new Map(), 0);
    assert.deepEqual(out, ["TSLA"]);
  });

  await ok("with no API key nothing is fetched and the cache is served, stale", async () => {
    const saved = process.env.FINNHUB_API_KEY;
    delete process.env.FINNHUB_API_KEY;
    const now = 2_000_000;
    const cache = new Map([["TSLA", cached("TSLA", 250, now - 5_000)]]);
    const { quotes, fetched, failed } = await refreshQuotes(["TSLA"], cache, { now });

    assert.deepEqual(fetched, [], "no key means no requests, not an exception");
    assert.deepEqual(failed, [], "and nothing counts as failed — it was never attempted");
    assert.equal(quotes.get("TSLA")?.price, 250, "the last known price is still shown");
    assert.equal(quotes.get("TSLA")?.stale, false, "5 seconds old is not stale");
    if (saved !== undefined) process.env.FINNHUB_API_KEY = saved;
  });

  await ok("an old cached price is marked stale even without a key", async () => {
    const saved = process.env.FINNHUB_API_KEY;
    delete process.env.FINNHUB_API_KEY;
    const now = 3_000_000;
    const cache = new Map([["TSLA", cached("TSLA", 250, now - 600_000)]]);
    const { quotes } = await refreshQuotes(["TSLA"], cache, { now });
    assert.equal(quotes.get("TSLA")?.stale, true, "ten minutes old must say so on screen");
    if (saved !== undefined) process.env.FINNHUB_API_KEY = saved;
  });

  await ok("a symbol never priced is absent rather than zero", async () => {
    const saved = process.env.FINNHUB_API_KEY;
    delete process.env.FINNHUB_API_KEY;
    const { quotes } = await refreshQuotes(["NEVER"], new Map(), { now: 1 });
    assert.equal(quotes.has("NEVER"), false, "absent reads as unknown; a zero would read as worthless");
    if (saved !== undefined) process.env.FINNHUB_API_KEY = saved;
  });

  await ok("a failed fetch falls back to cache and flags it", async () => {
    const saved = process.env.FINNHUB_API_KEY;
    const savedFetch = globalThis.fetch;
    process.env.FINNHUB_API_KEY = "test-key";
    // Every request fails, which is what being offline looks like from here.
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    const now = 4_000_000;
    const cache = new Map([["TSLA", cached("TSLA", 250, now - 120_000)]]);
    const { quotes, failed } = await refreshQuotes(["TSLA"], cache, { now });

    assert.deepEqual(failed, ["TSLA"]);
    assert.equal(quotes.get("TSLA")?.price, 250, "the page shows the last price rather than breaking");
    assert.equal(quotes.get("TSLA")?.stale, true, "and says it is old");
    assert.equal(quotes.get("TSLA")?.fetchedAt, now - 120_000, "with the time it was actually from");

    globalThis.fetch = savedFetch;
    if (saved === undefined) delete process.env.FINNHUB_API_KEY;
    else process.env.FINNHUB_API_KEY = saved;
  });

  await ok("a successful fetch replaces the cached price and clears stale", async () => {
    const saved = process.env.FINNHUB_API_KEY;
    const savedFetch = globalThis.fetch;
    process.env.FINNHUB_API_KEY = "test-key";
    globalThis.fetch = (async () => new Response(JSON.stringify({ c: 300, pc: 290 }), { status: 200 })) as typeof fetch;

    const now = 5_000_000;
    const cache = new Map([["TSLA", cached("TSLA", 250, now - 120_000)]]);
    const { quotes, fetched, failed } = await refreshQuotes(["TSLA"], cache, { now });

    assert.deepEqual(fetched, ["TSLA"]);
    assert.deepEqual(failed, []);
    assert.equal(quotes.get("TSLA")?.price, 300);
    assert.equal(quotes.get("TSLA")?.previousClose, 290);
    assert.equal(quotes.get("TSLA")?.stale, false);
    assert.equal(quotes.get("TSLA")?.fetchedAt, now);

    globalThis.fetch = savedFetch;
    if (saved === undefined) delete process.env.FINNHUB_API_KEY;
    else process.env.FINNHUB_API_KEY = saved;
  });

  await ok("a rate-limited response does not overwrite a good price with nothing", async () => {
    const saved = process.env.FINNHUB_API_KEY;
    const savedFetch = globalThis.fetch;
    process.env.FINNHUB_API_KEY = "test-key";
    globalThis.fetch = (async () => new Response("rate limit", { status: 429 })) as typeof fetch;

    const now = 6_000_000;
    const cache = new Map([["TSLA", cached("TSLA", 250, now - 120_000)]]);
    const { quotes, failed } = await refreshQuotes(["TSLA"], cache, { now });
    assert.deepEqual(failed, ["TSLA"]);
    assert.equal(quotes.get("TSLA")?.price, 250);

    globalThis.fetch = savedFetch;
    if (saved === undefined) delete process.env.FINNHUB_API_KEY;
    else process.env.FINNHUB_API_KEY = saved;
  });

  await ok("one bad symbol does not stop the others pricing", async () => {
    const saved = process.env.FINNHUB_API_KEY;
    const savedFetch = globalThis.fetch;
    process.env.FINNHUB_API_KEY = "test-key";
    globalThis.fetch = (async (url: string | URL | Request) => {
      const s = String(url);
      if (s.includes("BAD")) return new Response(JSON.stringify({ c: 0, pc: 0 }), { status: 200 });
      return new Response(JSON.stringify({ c: 100, pc: 99 }), { status: 200 });
    }) as typeof fetch;

    const { quotes, fetched, failed } = await refreshQuotes(["GOOD", "BAD"], new Map(), { now: 7_000_000 });
    assert.deepEqual(fetched, ["GOOD"]);
    assert.deepEqual(failed, ["BAD"]);
    assert.equal(quotes.get("GOOD")?.price, 100);
    assert.equal(quotes.has("BAD"), false);

    globalThis.fetch = savedFetch;
    if (saved === undefined) delete process.env.FINNHUB_API_KEY;
    else process.env.FINNHUB_API_KEY = saved;
  });

  await ok("the API key never appears in what comes back", async () => {
    const saved = process.env.FINNHUB_API_KEY;
    const savedFetch = globalThis.fetch;
    process.env.FINNHUB_API_KEY = "super-secret-key";
    globalThis.fetch = (async () => new Response(JSON.stringify({ c: 100, pc: 99 }), { status: 200 })) as typeof fetch;

    const result = await refreshQuotes(["TSLA"], new Map(), { now: 8_000_000 });
    assert.ok(!JSON.stringify([...result.quotes]).includes("super-secret-key"), "the key stays on the server");

    globalThis.fetch = savedFetch;
    if (saved === undefined) delete process.env.FINNHUB_API_KEY;
    else process.env.FINNHUB_API_KEY = saved;
  });

  await ok("freshness reads as plain English", () => {
    const now = 1_000_000_000;
    assert.equal(agoLabel(null, now), "never");
    assert.equal(agoLabel(now - 3_000, now), "just now");
    assert.equal(agoLabel(now - 30_000, now), "30 seconds ago");
    assert.equal(agoLabel(now - 60_000, now), "1 minute ago");
    assert.equal(agoLabel(now - 300_000, now), "5 minutes ago");
    assert.equal(agoLabel(now - 3_600_000, now), "1 hour ago");
    assert.equal(agoLabel(now - 90_000_000, now), "1 day ago");
    assert.equal(agoLabel(now + 5_000, now), "just now", "a clock skew must not read as negative");
  });

  console.log(`\n${checks} price checks passed`);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
