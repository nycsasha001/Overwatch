import assert from "node:assert/strict";
import { METAL_SPOT_SYMBOLS, metalSpotSymbol, parseMetalQuote } from "../src/lib/metals.ts";

/**
 * Bullion pricing.
 *
 * Nothing here touches the network. The part worth testing is the same part that is worth testing
 * in prices.ts: a well-formed reply that carries no usable price must be rejected rather than
 * written in as a real one, because a zero in a portfolio is not an absent number — it is a wrong
 * one that quietly drags every total down.
 */

let checks = 0;
const ok = (name: string, fn: () => void) => {
  try {
    fn();
    checks++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}\n       ${(e as Error).message}`);
    process.exitCode = 1;
  }
};

const chart = (meta: Record<string, unknown>) => ({ chart: { result: [{ meta }] } });

/* ------------------------------ symbol mapping ------------------------------ */

ok("every spelling of a metal reaches the same contract", () => {
  for (const spelling of ["GOLD", "XAU", "AU", "GC"]) {
    assert.equal(metalSpotSymbol(spelling), "GC=F", `${spelling} should price from gold`);
  }
  for (const spelling of ["SILVER", "XAG", "AG", "SI"]) {
    assert.equal(metalSpotSymbol(spelling), "SI=F", `${spelling} should price from silver`);
  }
  assert.equal(metalSpotSymbol("PLATINUM"), "PL=F");
  assert.equal(metalSpotSymbol("PALLADIUM"), "PA=F");
});

ok("case and stray whitespace do not decide whether your gold gets priced", () => {
  assert.equal(metalSpotSymbol("gold"), "GC=F");
  assert.equal(metalSpotSymbol("  Xau  "), "GC=F");
  assert.equal(metalSpotSymbol("sIlVeR"), "SI=F");
});

ok("anything else is not a metal, and says so rather than guessing", () => {
  // The important half: a wrong guess here would price a holding off an unrelated contract.
  for (const notMetal of ["AAPL", "GLD", "BTC", "ROLEX", "", "   ", "G", "XAUUSD"]) {
    assert.equal(metalSpotSymbol(notMetal), null, `${JSON.stringify(notMetal)} must not map to a metal`);
  }
});

ok("GLD is deliberately absent from the map", () => {
  // The whole point of this module. If GLD ever appears here, an ounce of gold starts being
  // valued at roughly a eleventh of its worth, and the portfolio is wrong without saying so.
  assert.equal(METAL_SPOT_SYMBOLS.GLD, undefined);
  assert.equal(METAL_SPOT_SYMBOLS.SLV, undefined);
  assert.equal(metalSpotSymbol("GLD"), null);
});

/* -------------------------------- parsing ---------------------------------- */

ok("a normal reply yields price and previous close", () => {
  const q = parseMetalQuote(chart({ regularMarketPrice: 4400.4, chartPreviousClose: 4376.4 }));
  assert.deepEqual(q, { price: 4400.4, previousClose: 4376.4 });
});

ok("the chart's own previous close wins over the generic one", () => {
  // On a futures series the former is the prior settle, which is what a day's move measures from.
  const q = parseMetalQuote(chart({ regularMarketPrice: 100, chartPreviousClose: 98, previousClose: 1 }));
  assert.equal(q?.previousClose, 98);
});

ok("a missing previous close is null, not zero", () => {
  const q = parseMetalQuote(chart({ regularMarketPrice: 67.72 }));
  assert.deepEqual(q, { price: 67.72, previousClose: null });
});

ok("a zero or negative price is no price at all", () => {
  // Yahoo answers an unknown symbol with a well-formed body full of zeros, exactly as Finnhub does.
  for (const price of [0, -1, Number.NaN]) {
    assert.equal(parseMetalQuote(chart({ regularMarketPrice: price })), null, `rejected ${price}`);
  }
  assert.equal(parseMetalQuote(chart({ regularMarketPrice: 0, chartPreviousClose: 0 })), null);
});

ok("a nonsense previous close does not poison a good price", () => {
  const q = parseMetalQuote(chart({ regularMarketPrice: 4400, chartPreviousClose: 0 }));
  assert.deepEqual(q, { price: 4400, previousClose: null });
});

ok("malformed bodies return null instead of throwing", () => {
  // A metals outage must never take the rest of the portfolio down with it.
  for (const body of [null, undefined, 42, "gold", {}, { chart: {} }, { chart: { result: [] } }, { chart: { result: [{}] } }]) {
    assert.equal(parseMetalQuote(body), null, `rejected ${JSON.stringify(body)}`);
  }
});

ok("a price arriving as a string is still a price", () => {
  const q = parseMetalQuote(chart({ regularMarketPrice: "4400.40", chartPreviousClose: "4376.40" }));
  assert.deepEqual(q, { price: 4400.4, previousClose: 4376.4 });
});

console.log(`\n${checks} metal pricing checks passed`);
