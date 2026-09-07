import assert from "node:assert/strict";
import { GROUPS, SYMBOLS, lookup, quoteSymbolFor, searchSymbols } from "../src/lib/symbols.ts";

let checks = 0;
const ok = (name: string, fn: () => void | Promise<void>) => {
  const done = () => {
    checks++;
    console.log(`  ok  ${name}`);
  };
  const r = fn();
  return r instanceof Promise ? r.then(done) : (done(), Promise.resolve());
};

const run = async () => {
  /* ---------------------------------- symbols ---------------------------------- */

  await ok("SPX finds SPY, because you cannot buy an index", () => {
    const hits = searchSymbols("SPX");
    assert.equal(hits[0]?.symbol, "SPY", "the tradeable equivalent, not nothing");
    assert.equal(searchSymbols("NDX")[0]?.symbol, "QQQ");
  });

  await ok("an exact ticker outranks a longer one that contains it", () => {
    assert.equal(searchSymbols("V")[0]?.symbol, "V", "Visa before Vanguard anything");
    assert.equal(searchSymbols("T")[0]?.symbol, "T");
    assert.equal(searchSymbols("AAPL")[0]?.symbol, "AAPL");
  });

  await ok("company names work as well as tickers", () => {
    assert.equal(searchSymbols("apple")[0]?.symbol, "AAPL");
    assert.equal(searchSymbols("tesla")[0]?.symbol, "TSLA");
    assert.equal(searchSymbols("facebook")[0]?.symbol, "META", "the old name still finds it");
    assert.equal(searchSymbols("buffett")[0]?.symbol, "BRK.B");
  });

  await ok("search is case-insensitive and tolerates stray spaces", () => {
    assert.equal(searchSymbols("  nvda  ")[0]?.symbol, "NVDA");
    assert.equal(searchSymbols("NvDa")[0]?.symbol, "NVDA");
  });

  await ok("nonsense returns nothing rather than everything", () => {
    assert.deepEqual(searchSymbols("ZZZZQQQQ"), []);
  });

  await ok("an empty query offers the list rather than nothing", () => {
    assert.ok(searchSymbols("").length > 0, "opening the picker should show something");
  });

  await ok("the catalogue has no duplicates and every group is real", () => {
    const seen = new Set<string>();
    for (const s of SYMBOLS) {
      assert.ok(!seen.has(s.symbol), `${s.symbol} appears twice`);
      seen.add(s.symbol);
      assert.ok(GROUPS.includes(s.group), `${s.symbol} is in unknown group "${s.group}"`);
      assert.equal(s.symbol, s.symbol.toUpperCase(), `${s.symbol} should be uppercase`);
      assert.ok(s.name.length > 0);
    }
    // Every group should actually contain something, or the picker renders an empty heading.
    for (const g of GROUPS) assert.ok(SYMBOLS.some((s) => s.group === g), `group "${g}" is empty`);
  });

  await ok("no leveraged or inverse products in a long-term list", () => {
    // They decay against the index over any holding period longer than a day.
    for (const bad of ["TQQQ", "SQQQ", "UVXY", "SPXL", "SOXL", "TMF"]) {
      assert.equal(lookup(bad), null, `${bad} should not be offered here`);
    }
  });

  await ok("lookup is case-insensitive", () => {
    assert.equal(lookup("aapl")?.name, "Apple");
    assert.equal(lookup(" tsla ")?.symbol, "TSLA");
    assert.equal(lookup("NOTREAL"), null);
  });

  await ok("crypto is quoted under the exchange-prefixed symbol the feed understands", () => {
    // A bare "BTC" returns an empty body from Finnhub; the prefixed form returns a price.
    assert.equal(quoteSymbolFor("BTC"), "BINANCE:BTCUSDT");
    assert.equal(quoteSymbolFor("eth"), "BINANCE:ETHUSDT", "and it is case-insensitive");
    assert.equal(lookup("BTC")?.assetType, "crypto");
  });

  await ok("an ordinary ticker is passed straight through", () => {
    assert.equal(quoteSymbolFor("AAPL"), "AAPL");
    assert.equal(quoteSymbolFor("SPY"), "SPY");
    // Unlisted symbols must not be mangled — the mapping is an exception list, not a gate.
    assert.equal(quoteSymbolFor("wxyz"), "WXYZ");
  });

  await ok("everything in the screenshot is findable", () => {
    for (const s of ["SPY", "TSLA", "QQQ", "LMT", "BTC"]) {
      assert.ok(lookup(s), `${s} should be in the catalogue`);
      assert.equal(searchSymbols(s)[0]?.symbol, s, `searching ${s} should find it first`);
    }
  });

  console.log(`\n${checks} symbol catalogue checks passed`);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
