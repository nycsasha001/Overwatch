import assert from "node:assert/strict";
import {
  allocation,
  availableRanges,
  costFromTransactions,
  filterable,
  investedFromTransactions,
  isManuallyValued,
  manualQuote,
  sharesForAmount,
  performanceSinceStart,
  inRange,
  portfolio,
  position,
  shouldSnapshot,
  snapshotValue,
  totalsOf,
  type Holding,
  type Quote,
  type Snapshot,
} from "../src/lib/portfolio.ts";

let checks = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  checks++;
  console.log(`  ok  ${name}`);
};

const hold = (symbol: string, shares: number, avgCost: number): Holding => ({
  id: `h_${symbol}`,
  symbol,
  name: null,
  shares,
  avgCost,
  assetType: "stock",
  createdAt: "2026-01-01T00:00:00Z",
});

const quote = (symbol: string, price: number, previousClose: number | null = null, stale = false): Quote => ({
  symbol,
  price,
  previousClose,
  fetchedAt: 1_700_000_000_000,
  stale,
});

const near = (a: number | null, b: number, msg?: string) => assert.ok(a !== null && Math.abs(a - b) < 0.005, `${msg ?? ""} got ${a}, want ${b}`);

ok("a position values shares at the current price", () => {
  const p = position(hold("TSLA", 9, 200), quote("TSLA", 250));
  assert.equal(p.marketValue, 2250);
  assert.equal(p.costBasis, 1800);
  assert.equal(p.unrealised, 450);
  near(p.unrealisedPct, 25);
});

ok("fractional shares are handled exactly", () => {
  // 0.9 shares is the case that breaks naive integer maths, and it is in the example holdings.
  const p = position(hold("QQQ", 0.9, 400), quote("QQQ", 500));
  assert.equal(p.marketValue, 450);
  assert.equal(p.costBasis, 360);
  assert.equal(p.unrealised, 90);
  near(p.unrealisedPct, 25);
});

ok("a loss is negative, not just smaller", () => {
  const p = position(hold("SPY", 3, 600), quote("SPY", 500));
  assert.equal(p.marketValue, 1500);
  assert.equal(p.costBasis, 1800);
  assert.equal(p.unrealised, -300);
  near(p.unrealisedPct, -16.667);
});

ok("today's move needs the previous close, and is null without it", () => {
  const withPrev = position(hold("TSLA", 10, 100), quote("TSLA", 110, 100));
  assert.equal(withPrev.dayChange, 100);
  near(withPrev.dayChangePct, 10);

  const noPrev = position(hold("TSLA", 10, 100), quote("TSLA", 110, null));
  assert.equal(noPrev.dayChange, null, "no previous close means the day's move is unknown");
  assert.equal(noPrev.dayChangePct, null);
  assert.equal(noPrev.marketValue, 1100, "but the position is still worth something");
});

ok("a missing price gives null, never zero", () => {
  // The whole point: a holding that failed to price is worth an unknown amount, not nothing.
  const p = position(hold("TSLA", 9, 200), null);
  assert.equal(p.marketValue, null);
  assert.equal(p.unrealised, null);
  assert.equal(p.unrealisedPct, null);
  assert.equal(p.costBasis, 1800, "cost basis comes from what you typed and is always known");
});

ok("a zero cost basis has no percentage return rather than Infinity", () => {
  const p = position(hold("FREE", 10, 0), quote("FREE", 5));
  assert.equal(p.marketValue, 50);
  assert.equal(p.unrealised, 50);
  assert.equal(p.unrealisedPct, null, "dividing by zero must not reach the screen");
});

ok("the portfolio total is holdings plus cash", () => {
  const holdings = [hold("TSLA", 9, 200), hold("SPY", 3, 500), hold("QQQ", 0.9, 400)];
  const quotes = new Map([
    ["TSLA", quote("TSLA", 250, 240)],
    ["SPY", quote("SPY", 550, 545)],
    ["QQQ", quote("QQQ", 500, 495)],
  ]);
  const { totals } = portfolio(holdings, quotes, 500);

  assert.equal(totals.marketValue, 2250 + 1650 + 450);
  assert.equal(totals.cash, 500);
  assert.equal(totals.total, 4350 + 500);
  assert.equal(totals.costBasis, 1800 + 1500 + 360);
  assert.equal(totals.unrealised, 4350 - 3660);
  // Day: 9×10 + 3×5 + 0.9×5 = 90 + 15 + 4.50
  assert.equal(totals.dayChange, 109.5);
});

ok("an unpriced holding is excluded from totals and named, not counted as zero", () => {
  const holdings = [hold("TSLA", 10, 100), hold("WEIRD", 5, 50)];
  const quotes = new Map([["TSLA", quote("TSLA", 120, 110)]]);
  const { totals, positions } = portfolio(holdings, quotes, 0);

  assert.equal(totals.marketValue, 1200, "only the priced holding is counted");
  assert.deepEqual(totals.missingPrices, ["WEIRD"], "and the other is reported");
  // Unrealised compares like with like: WEIRD's cost basis is excluded because its value is unknown.
  assert.equal(totals.unrealised, 200, "not 1200 - 1250, which would invent a loss");
  assert.equal(positions[1].marketValue, null);
  assert.equal(positions[1].costBasis, 250, "its cost is still shown in the table");
});

ok("stale prices are reported so the page can say so", () => {
  const holdings = [hold("TSLA", 1, 100)];
  const quotes = new Map([["TSLA", quote("TSLA", 120, 110, true)]]);
  const { totals } = portfolio(holdings, quotes, 0);
  assert.deepEqual(totals.stalePrices, ["TSLA"]);
  assert.equal(totals.marketValue, 120, "a stale price is still a price — it is used, and flagged");
});

ok("the day's percentage ignores cash", () => {
  // A flat day on a big cash pile should read 0%, not a diluted fraction.
  const holdings = [hold("TSLA", 10, 100)];
  const quotes = new Map([["TSLA", quote("TSLA", 110, 100)]]);
  const { totals } = portfolio(holdings, quotes, 100_000);
  near(totals.dayChangePct, 10, "10% on the invested side");
});

ok("symbols match case-insensitively", () => {
  const { totals } = portfolio([hold("tsla", 1, 100)], new Map([["TSLA", quote("TSLA", 150)]]), 0);
  assert.equal(totals.marketValue, 150, "a lowercase entry still finds its quote");
});

ok("an empty portfolio is zero, not NaN", () => {
  const { totals, positions } = portfolio([], new Map(), 0);
  assert.equal(positions.length, 0);
  assert.equal(totals.total, 0);
  assert.equal(totals.unrealisedPct, null);
  assert.equal(totals.dayChangePct, null);
  assert.ok(!Number.isNaN(totals.marketValue));
});

ok("allocation percentages are dynamic and sum to 100", () => {
  // 5000 + 3000 + 2000 cash = 10000, so the percentages are exact and the order unambiguous.
  const holdings = [hold("TSLA", 10, 100), hold("SPY", 10, 100)];
  const quotes = new Map([["TSLA", quote("TSLA", 500)], ["SPY", quote("SPY", 300)]]);
  const { positions, totals } = portfolio(holdings, quotes, 2000);
  const slices = allocation(positions, totals.cash, totals.total);

  assert.equal(totals.total, 10000);
  assert.deepEqual(slices.map((s) => s.label), ["TSLA", "SPY", "Cash"], "largest first");
  near(slices.reduce((s, x) => s + x.pct, 0), 100, "slices account for the whole portfolio");
  near(slices[0].pct, 50);
  near(slices[1].pct, 30);
  near(slices[2].pct, 20);
});

ok("an unpriced holding gets no allocation slice at all", () => {
  const holdings = [hold("TSLA", 10, 100), hold("WEIRD", 5, 50)];
  const quotes = new Map([["TSLA", quote("TSLA", 100)]]);
  const { positions, totals } = portfolio(holdings, quotes, 0);
  const slices = allocation(positions, totals.cash, totals.total);
  assert.deepEqual(slices.map((s) => s.label), ["TSLA"], "0% would read as 'I own none of this'");
});

ok("chart ranges only include snapshots that exist", () => {
  const now = Date.UTC(2026, 5, 1);
  const day = 86_400_000;
  const snaps: Snapshot[] = [
    { ts: now - 200 * day, total: 100, cash: 0, invested: 100 },
    { ts: now - 20 * day, total: 200, cash: 0, invested: 200 },
    { ts: now - 2 * day, total: 300, cash: 0, invested: 300 },
    { ts: now - 1000, total: 400, cash: 0, invested: 400 },
  ];
  assert.equal(inRange(snaps, "1D", now).length, 1);
  assert.equal(inRange(snaps, "1W", now).length, 2);
  assert.equal(inRange(snaps, "1M", now).length, 3);
  assert.equal(inRange(snaps, "ALL", now).length, 4);
  // Nothing is invented to fill a sparse range.
  assert.equal(inRange([], "1Y", now).length, 0);
});

ok("only ranges with real history are offered", () => {
  const now = Date.UTC(2026, 5, 1);
  const day = 86_400_000;
  const snaps: Snapshot[] = [
    { ts: now - 3 * day, total: 100, cash: 0, invested: 100 },
    { ts: now - 1000, total: 110, cash: 0, invested: 110 },
  ];
  const ranges = availableRanges(snaps, now);
  assert.ok(!ranges.includes("1D"), "one point in the last day is not a chart");
  assert.ok(ranges.includes("1W"));
  assert.ok(ranges.includes("ALL"));
  assert.deepEqual(availableRanges([], now), [], "no history, no ranges");
});

ok("snapshots are not written on every refresh", () => {
  const now = Date.UTC(2026, 5, 1);
  const last: Snapshot = { ts: now - 60_000, total: 1000, cash: 100, invested: 900 };
  assert.equal(shouldSnapshot(null, { total: 1000, cash: 100, invested: 900 }, now), true, "the first one always");
  assert.equal(shouldSnapshot(last, { total: 1000, cash: 100, invested: 900 }, now), false, "a minute later, unchanged");
  assert.equal(shouldSnapshot(last, { total: 1050, cash: 100, invested: 950 }, now), true, "but a real change is recorded");
  assert.equal(shouldSnapshot({ ...last, ts: now - 20 * 60_000 }, { total: 1000, cash: 100, invested: 900 }, now), true, "and so is the interval");
});

ok("weighted-average cost matches how a broker reports it", () => {
  // Buy 10 at 100, buy 10 at 200 -> 20 at 150.
  const bought = costFromTransactions([
    { kind: "buy", shares: 10, price: 100, date: "2026-01-01" },
    { kind: "buy", shares: 10, price: 200, date: "2026-02-01" },
  ]);
  assert.equal(bought!.shares, 20);
  near(bought!.avgCost, 150);

  // Selling does not move the average of what is left — this is the convention brokers use.
  const sold = costFromTransactions([
    { kind: "buy", shares: 10, price: 100, date: "2026-01-01" },
    { kind: "buy", shares: 10, price: 200, date: "2026-02-01" },
    { kind: "sell", shares: 5, price: 500, date: "2026-03-01" },
  ]);
  assert.equal(sold!.shares, 15);
  near(sold!.avgCost, 150, "still 150, not moved by the sale price");
});

ok("transactions are applied in date order, not entry order", () => {
  const out = costFromTransactions([
    { kind: "sell", shares: 5, price: 500, date: "2026-03-01" },
    { kind: "buy", shares: 10, price: 100, date: "2026-01-01" },
  ]);
  assert.ok(out !== null, "entering the sale first must not look like selling from nothing");
  assert.equal(out!.shares, 5);
});

ok("selling more than held is rejected rather than producing nonsense", () => {
  assert.equal(
    costFromTransactions([
      { kind: "buy", shares: 5, price: 100, date: "2026-01-01" },
      { kind: "sell", shares: 10, price: 100, date: "2026-02-01" },
    ]),
    null
  );
  // Selling everything is fine and leaves a flat position.
  const flat = costFromTransactions([
    { kind: "buy", shares: 5, price: 100, date: "2026-01-01" },
    { kind: "sell", shares: 5, price: 120, date: "2026-02-01" },
  ]);
  assert.equal(flat!.shares, 0);
});

ok("totals stay in cents rather than drifting on float dust", () => {
  const holdings = [hold("A", 3, 0.1), hold("B", 3, 0.2)];
  const quotes = new Map([["A", quote("A", 0.1)], ["B", quote("B", 0.2)]]);
  const { totals } = portfolio(holdings, quotes, 0.1);
  assert.equal(totals.marketValue, 0.9, "0.30000000000000004 must not reach the screen");
  assert.equal(totals.total, 1);
});


/* ---------------- buying more on a later day, the way the app now works ---------------- */

ok("buying more later averages at the weighted cost, not the latest price", () => {
  // Day one: 10 @ $100. A week later: 10 @ $200. You hold 20 at an average of $150 —
  // not $200 (the last price) and not $100 (the first).
  const c = costFromTransactions([
    { kind: "buy", shares: 10, price: 100, date: "2026-09-03" },
    { kind: "buy", shares: 10, price: 200, date: "2026-09-10" },
  ])!;
  assert.equal(c.shares, 20);
  near(c.avgCost, 150);
});

ok("three buys at different prices average across all of them", () => {
  const c = costFromTransactions([
    { kind: "buy", shares: 5, price: 100, date: "2026-01-01" },
    { kind: "buy", shares: 10, price: 130, date: "2026-03-01" },
    { kind: "buy", shares: 5, price: 200, date: "2026-06-01" },
  ])!;
  assert.equal(c.shares, 20);
  near(c.avgCost, (5 * 100 + 10 * 130 + 5 * 200) / 20);
});

ok("entering a buy out of order still gives the same average", () => {
  // The dates decide, not the order they were typed — otherwise correcting an omission later
  // would silently change your cost basis.
  const forwards = costFromTransactions([
    { kind: "buy", shares: 10, price: 100, date: "2026-09-03" },
    { kind: "buy", shares: 10, price: 200, date: "2026-09-10" },
  ])!;
  const backwards = costFromTransactions([
    { kind: "buy", shares: 10, price: 200, date: "2026-09-10" },
    { kind: "buy", shares: 10, price: 100, date: "2026-09-03" },
  ])!;
  near(backwards.avgCost, forwards.avgCost);
  assert.equal(backwards.shares, forwards.shares);
});

ok("a partial sale leaves the average cost alone", () => {
  // Selling does not change what the remaining shares cost you — it only reduces the count.
  // This is the convention every broker statement uses.
  const c = costFromTransactions([
    { kind: "buy", shares: 10, price: 100, date: "2026-09-03" },
    { kind: "buy", shares: 10, price: 200, date: "2026-09-10" },
    { kind: "sell", shares: 5, price: 300, date: "2026-09-20" },
  ])!;
  assert.equal(c.shares, 15);
  near(c.avgCost, 150, "still 150, not marked up by the sale price");
});

ok("selling everything leaves no position rather than a zero-share ghost", () => {
  const c = costFromTransactions([
    { kind: "buy", shares: 10, price: 100, date: "2026-09-03" },
    { kind: "sell", shares: 10, price: 150, date: "2026-09-20" },
  ])!;
  assert.equal(c.shares, 0);
});

ok("deleting a mistaken buy restores the earlier average", () => {
  // The correction path: the fat-fingered row is removed and the average recomputes from what is
  // left, rather than you working out what it should have been.
  const withMistake = costFromTransactions([
    { kind: "buy", shares: 10, price: 100, date: "2026-09-03" },
    { kind: "buy", shares: 10, price: 9999, date: "2026-09-04" },
  ])!;
  const corrected = costFromTransactions([{ kind: "buy", shares: 10, price: 100, date: "2026-09-03" }])!;
  assert.ok(withMistake.avgCost > 1000, "the typo does skew it");
  near(corrected.avgCost, 100, "and removing it puts it back");
});


/* ------------------------ buying by dollar amount ------------------------ */

ok("a dollar amount converts to shares at the given price", () => {
  near(sharesForAmount(500, 200)!, 2.5);
  near(sharesForAmount(1000, 250)!, 4);
  // The case that matters: an amount that does not divide evenly still round-trips.
  const s = sharesForAmount(500, 205)!;
  near(s * 205, 500, "shares x price must equal the amount you typed");
});

ok("the round trip holds for awkward prices", () => {
  for (const [amount, price] of [[100, 3.33], [7, 1234.56], [50000, 0.42], [1, 999999]] as const) {
    const s = sharesForAmount(amount, price)!;
    near(s * price, amount, `${amount} at ${price}`);
  }
});

ok("a nonsense amount or price gives null, never Infinity", () => {
  assert.equal(sharesForAmount(0, 100), null);
  assert.equal(sharesForAmount(-50, 100), null);
  assert.equal(sharesForAmount(NaN, 100), null);
  assert.equal(sharesForAmount(500, 0), null, "dividing by a zero price must not reach the screen");
  assert.equal(sharesForAmount(500, -5), null);
  assert.equal(sharesForAmount(500, NaN), null);
});

ok("an amount-bought position values back to the amount", () => {
  // End to end: $500 of a $205 stock, priced at $205, is worth $500 and shows no return.
  const shares = sharesForAmount(500, 205)!;
  const p = position(hold("AAPL", shares, 205), quote("AAPL", 205));
  near(p.marketValue!, 500);
  near(p.costBasis, 500);
  near(p.unrealised!, 0, "buying at the current price is neither a gain nor a loss");
});


/* ------------------ performance, with money going in and out ------------------ */

const snap = (ts: number, total: number, cash: number): Snapshot => ({ ts, total, cash, invested: total - cash });
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 1);

ok("with no deposits, performance is just the change in value", () => {
  const r = performanceSinceStart([snap(T0, 10_000, 0), snap(T0 + DAY, 11_000, 0)], [])!;
  assert.equal(r.gain, 1000);
  near(r.pct, 10);
  assert.equal(r.contributions, 0);
});

ok("adding a holding is a deposit, not a gain", () => {
  // The bug this exists to prevent: start at $10,000, buy $2,900 of SPY, portfolio now reads
  // $12,900. That is not a 29% return.
  const r = performanceSinceStart(
    [snap(T0, 10_000, 0), snap(T0 + DAY, 12_900, 0)],
    [{ kind: "buy", shares: 3.78, price: 767.19576719576724, at: T0 + DAY / 2 }]
  )!;
  near(r.contributions, 2900);
  near(r.gain, 0, "the money moved in, nothing was earned");
  near(r.pct, 0);
});

ok("a deposit plus a real gain reports only the gain", () => {
  const r = performanceSinceStart(
    [snap(T0, 10_000, 0), snap(T0 + DAY, 13_400, 0)],
    [{ kind: "buy", shares: 10, price: 290, at: T0 + DAY / 2 }]
  )!;
  near(r.contributions, 2900);
  near(r.gain, 500);
  near(r.pct, (500 / 12_900) * 100, "measured against the capital actually at work");
});

ok("topping up cash is a deposit too", () => {
  const r = performanceSinceStart([snap(T0, 5_000, 5_000), snap(T0 + DAY, 9_000, 9_000)], [])!;
  assert.equal(r.contributions, 4000);
  assert.equal(r.gain, 0, "moving cash in is not performance");
});

ok("withdrawing cash is not a loss", () => {
  const r = performanceSinceStart([snap(T0, 9_000, 9_000), snap(T0 + DAY, 5_000, 5_000)], [])!;
  assert.equal(r.contributions, -4000);
  assert.equal(r.gain, 0);
});

ok("selling reduces contributions rather than counting as a loss", () => {
  // Sold $2,000 of stock; the position left the portfolio, so the total falls by $2,000 and none
  // of that is a loss.
  const r = performanceSinceStart(
    [snap(T0, 10_000, 0), snap(T0 + DAY, 8_000, 0)],
    [{ kind: "sell", shares: 10, price: 200, at: T0 + DAY / 2 }]
  )!;
  near(r.contributions, -2000);
  near(r.gain, 0);
});

ok("a buy recorded before tracking started is not counted again", () => {
  // Its value is already inside the opening balance; subtracting it too would invent a loss.
  const r = performanceSinceStart(
    [snap(T0, 10_000, 0), snap(T0 + DAY, 10_500, 0)],
    [{ kind: "buy", shares: 10, price: 500, at: T0 - 30 * DAY }]
  )!;
  assert.equal(r.contributions, 0);
  assert.equal(r.gain, 500);
});

ok("rebaselining to today does not double-count what you entered today", () => {
  // The whole point of "start from today": you spend an afternoon typing in every holding, then
  // set the baseline to the total. Those buys are already inside the opening balance. Filtering
  // contributions by trade *date* would subtract them a second time and understate every future
  // gain by the size of the portfolio.
  const enteredToday = [
    { kind: "buy" as const, shares: 3.78, price: 769.62, at: T0 - 3600_000 },
    { kind: "buy" as const, shares: 9.38, price: 353.42, at: T0 - 1800_000 },
    { kind: "buy" as const, shares: 1, price: 525.74, at: T0 - 60_000 },
  ];
  const opening = 3.78 * 769.62 + 9.38 * 353.42 + 525.74;

  const flat = performanceSinceStart([snap(T0, opening, 0), snap(T0 + DAY, opening, 0)], enteredToday)!;
  assert.equal(flat.contributions, 0, "nothing was paid in after the baseline");
  assert.equal(flat.gain, 0, "a flat day is a flat day");

  const up = performanceSinceStart([snap(T0, opening, 0), snap(T0 + DAY, opening + 250, 0)], enteredToday)!;
  near(up.gain, 250, "and a $250 move reads as $250, not as $250 minus the portfolio");
});

ok("one recorded value is not a performance history", () => {
  assert.equal(performanceSinceStart([snap(T0, 10_000, 0)], []), null);
  assert.equal(performanceSinceStart([], []), null);
});

ok("starting from zero gives a gain but no percentage", () => {
  // Dividing by nothing is undefined, not infinite, and certainly not 0.00%.
  const r = performanceSinceStart([snap(T0, 0, 0), snap(T0 + DAY, 500, 0)], [])!;
  assert.equal(r.pct, null);
});

ok("a real loss still reads as a loss", () => {
  const r = performanceSinceStart([snap(T0, 10_000, 0), snap(T0 + DAY, 9_100, 0)], [])!;
  assert.equal(r.gain, -900);
  near(r.pct, -9);
});

/* --------------------------- assets with no ticker --------------------------- */

const bullion = (shares: number, avgCost: number, manualPrice: number | null, setAt?: string): Holding => ({
  id: "h_gold",
  symbol: "GOLD",
  name: "Physical gold",
  shares,
  avgCost,
  assetType: "metal",
  manualPrice,
  manualPriceAt: setAt ?? null,
  createdAt: "2026-01-01T00:00:00Z",
});

ok("things with a ticker are priced by the feed, things without are not", () => {
  for (const t of ["stock", "etf", "crypto", "other"]) assert.equal(isManuallyValued(t), false, t);
  for (const t of ["metal", "cash", "property", "collectible"]) assert.equal(isManuallyValued(t), true, t);
});

ok("a hand-set value prices the position", () => {
  const q = manualQuote(bullion(5, 3_800, 4_400))!;
  const pos = position(bullion(5, 3_800, 4_400), q);
  assert.equal(pos.marketValue, 22_000);
  assert.equal(pos.costBasis, 19_000);
  assert.equal(pos.unrealised, 3_000);
});

ok("the day's move on bullion is unknown, not zero", () => {
  // Nobody marks the coins in a safe overnight. Reporting 0.00% would be a claim; null is the
  // truth, and it keeps the portfolio's daily percentage from being diluted by a made-up flat.
  const q = manualQuote(bullion(5, 3_800, 4_400))!;
  assert.equal(q.previousClose, null);
  assert.equal(position(bullion(5, 3_800, 4_400), q).dayChange, null);
});

ok("the quote is stamped with when you set it, not with now", () => {
  const when = "2026-08-01T12:00:00.000Z";
  const q = manualQuote(bullion(5, 3_800, 4_400, when), Date.parse("2026-09-05T00:00:00Z"))!;
  assert.equal(q.fetchedAt, Date.parse(when));
});

ok("a manual holding with no value yet has no quote", () => {
  // It must read as unpriced rather than worthless: zero would quietly understate the total.
  assert.equal(manualQuote(bullion(5, 3_800, null)), null);
  assert.equal(manualQuote(bullion(5, 3_800, 0)), null);
});

ok("a ticker never takes a hand-set price", () => {
  // The guard that stops a typed number shadowing a real quote for something the market prices.
  assert.equal(manualQuote({ ...hold("AAPL", 10, 100), manualPrice: 999 }), null);
});

ok("an unvalued holding is missing from the total, not counted as zero", () => {
  const { totals } = portfolio(
    [hold("AAPL", 10, 100), bullion(5, 3_800, null)],
    new Map([["AAPL", quote("AAPL", 200)]]),
    0
  );
  assert.equal(totals.marketValue, 2_000);
  assert.deepEqual(totals.missingPrices, ["GOLD"]);
});

ok("bullion and shares add up together", () => {
  const gold = bullion(5, 3_800, 4_400);
  const quotes = new Map([["AAPL", quote("AAPL", 200)], ["GOLD", manualQuote(gold)!]]);
  const { totals } = portfolio([hold("AAPL", 10, 100), gold], quotes, 500);
  assert.equal(totals.marketValue, 24_000);
  assert.equal(totals.total, 24_500);
  assert.deepEqual(totals.missingPrices, []);
});

ok("bullion does not dilute the day's percentage", () => {
  // AAPL fell 10% today. Holding an equal value of gold beside it does not make the day half as
  // bad — gold's move is unknown, so it stays out of the denominator entirely.
  const gold = bullion(1, 2_000, 2_000);
  const quotes = new Map([
    ["AAPL", quote("AAPL", 90, 100)],
    ["GOLD", manualQuote(gold)!],
  ]);
  const { totals } = portfolio([hold("AAPL", 20, 50), gold], quotes, 0);
  assert.equal(totals.dayChange, -200);
  near(totals.dayChangePct, -10, "measured against AAPL's prior close alone");
});

ok("a day with nothing priced has no percentage", () => {
  const gold = bullion(1, 2_000, 2_000);
  const { totals } = portfolio([gold], new Map([["GOLD", manualQuote(gold)!]]), 0);
  assert.equal(totals.dayChange, 0);
  assert.equal(totals.dayChangePct, null, "dividing by nothing is undefined, not 0.00%");
});


/* ------------------------------ gifted assets ------------------------------- */

const lot = (
  kind: "buy" | "sell",
  shares: number,
  price: number,
  date: string,
  acquisition?: "purchase" | "gift" | "other",
  cashPaid?: number | null
) => ({ kind, shares, price, date, acquisition, cashPaid });

ok("a purchase invests its whole basis", () => {
  const r = investedFromTransactions([lot("buy", 10, 100, "2026-01-01")]);
  assert.equal(r.invested, 1000);
  assert.equal(r.acquisition, "purchase");
  assert.equal(r.acquiredAt, "2026-01-01");
});

ok("a gift has a basis but costs nothing", () => {
  // The whole point. Two ounces worth $4,000 arrive; the basis is $8,000 so gains are measured
  // from there, but no money left your account and the portfolio must not claim otherwise.
  const lots = [lot("buy", 2, 4_000, "2026-03-01", "gift")];
  assert.equal(costFromTransactions(lots)!.avgCost, 4_000);
  assert.equal(investedFromTransactions(lots).invested, 0);
  assert.equal(investedFromTransactions(lots).acquisition, "gift");
});

ok("a gift you paid something towards keeps that something", () => {
  // An explicit zero and an explicit 500 are both answers; neither falls back to the basis.
  assert.equal(investedFromTransactions([lot("buy", 2, 4_000, "2026-03-01", "gift", 500)]).invested, 500);
  assert.equal(investedFromTransactions([lot("buy", 2, 4_000, "2026-03-01", "purchase", 0)]).invested, 0);
});

ok("bought and gifted lots of the same thing report as mixed", () => {
  const lots = [lot("buy", 3, 3_000, "2026-01-01"), lot("buy", 2, 4_000, "2026-03-01", "gift")];
  const cost = costFromTransactions(lots)!;
  const acq = investedFromTransactions(lots);
  assert.equal(cost.shares, 5);
  near(cost.avgCost, (3 * 3_000 + 2 * 4_000) / 5, "basis is the weighted average of every lot");
  assert.equal(acq.invested, 9_000, "only the three bought ounces cost money");
  assert.equal(acq.acquisition, "mixed");
  assert.equal(acq.acquiredAt, "2026-01-01", "the earliest lot");
});

ok("selling takes a proportional slice of the cash, not all of it", () => {
  // Half a position that was half gifted leaves half the basis and half the cash.
  const lots = [
    lot("buy", 3, 3_000, "2026-01-01"),
    lot("buy", 2, 4_000, "2026-03-01", "gift"),
    lot("sell", 2.5, 5_000, "2026-06-01"),
  ];
  near(investedFromTransactions(lots).invested, 4_500, "half of the $9,000 that was actually spent");
  assert.equal(investedFromTransactions(lots).acquisition, "mixed", "selling does not change how the rest arrived");
});

ok("selling out entirely leaves nothing invested", () => {
  const lots = [lot("buy", 2, 100, "2026-01-01"), lot("sell", 2, 150, "2026-02-01")];
  assert.equal(investedFromTransactions(lots).invested, 0);
});

ok("a gift's return is measured from its basis, not from zero", () => {
  // Valuing a gift at a cost of nothing would report an infinite gain. It is worth $10,000 against
  // a basis of $8,000: a $2,000 gain, and $0 of your own money at work.
  const gift: Holding = {
    ...bullion(2, 4_000, 5_000),
    amountInvested: 0,
    acquisition: "gift",
  };
  const pos = position(gift, manualQuote(gift)!);
  assert.equal(pos.costBasis, 8_000);
  assert.equal(pos.invested, 0);
  assert.equal(pos.unrealised, 2_000);
  near(pos.unrealisedPct, 25);
});

ok("holdings from before acquisition tracking count as fully paid for", () => {
  // The migration writes no data, so every existing holding arrives here with amountInvested
  // undefined. Reading that as zero would erase the money actually spent from the invested total.
  const legacy = hold("AAPL", 10, 100);
  assert.equal("amountInvested" in legacy, false);
  assert.equal(position(legacy, quote("AAPL", 120)).invested, 1_000);
});

ok("the invested total sums separately from the basis", () => {
  const gift: Holding = { ...bullion(2, 4_000, 5_000), amountInvested: 0, acquisition: "gift" };
  const quotes = new Map([["AAPL", quote("AAPL", 120)], ["GOLD", manualQuote(gift)!]]);
  const { totals } = portfolio([hold("AAPL", 10, 100), gift], quotes, 0);
  assert.equal(totals.costBasis, 9_000, "basis includes the gift");
  assert.equal(totals.invested, 1_000, "cash does not");
  assert.equal(totals.unrealised, 2_200);
});

ok("receiving a gift is an inflow, not a gain", () => {
  // The subtle one. You did not pay for it, but the market did not earn it either — it simply
  // arrived. Counting it as performance would report a 88% return for opening a parcel.
  const r = performanceSinceStart(
    [snap(T0, 10_000, 0), snap(T0 + DAY, 18_800, 0)],
    [{ kind: "buy", shares: 2, price: 4_400, at: T0 + DAY / 2 }]
  )!;
  near(r.contributions, 8_800);
  near(r.gain, 0);
});


/* ------------------------------ filtering by class --------------------------- */

const snapWith = (ts: number, total: number, cash: number, breakdown: Record<string, number> | null): Snapshot => ({
  ts,
  total,
  cash,
  invested: total - cash,
  breakdown,
});

ok("a filtered total sums only the chosen classes", () => {
  const s = snapWith(T0, 12_000, 1_000, { stock: 6_000, etf: 2_000, metal: 3_000 });
  assert.equal(snapshotValue(s, null), 12_000, "no filter is the whole recorded total");
  assert.equal(snapshotValue(s, ["metal"]), 3_000);
  assert.equal(snapshotValue(s, ["stock", "etf"]), 8_000);
});

ok("cash counts only when it is ticked", () => {
  const s = snapWith(T0, 12_000, 1_000, { stock: 11_000 });
  assert.equal(snapshotValue(s, ["stock"]), 11_000);
  assert.equal(snapshotValue(s, ["stock", "cash_balance"]), 12_000);
});

ok("history recorded before the split cannot answer a filtered question", () => {
  // The honest answer is "unknown", not the whole total. Returning the total would draw the entire
  // portfolio's line under a metals-only filter and label it as metals.
  const old = snapWith(T0, 12_000, 0, null);
  assert.equal(snapshotValue(old, ["metal"]), null);
  assert.equal(snapshotValue(old, null), 12_000, "unfiltered, an old row is still perfectly good");
});

ok("filterable drops exactly the points that cannot answer", () => {
  const snaps = [
    snapWith(T0, 10_000, 0, null),
    snapWith(T0 + DAY, 11_000, 0, { stock: 8_000, metal: 3_000 }),
    snapWith(T0 + 2 * DAY, 12_000, 0, { stock: 9_000, metal: 3_000 }),
  ];
  assert.equal(filterable(snaps, null).length, 3, "nothing is dropped when nothing is filtered");
  assert.equal(filterable(snaps, ["metal"]).length, 2);
  assert.equal(filterable(snaps, ["metal"])[0].ts, T0 + DAY, "the line starts where the record does");
});

ok("a class with no recorded value reads as zero, not as unknown", () => {
  // Owning no crypto on a day the split was recorded is a fact, not a gap.
  assert.equal(snapshotValue(snapWith(T0, 5_000, 0, { stock: 5_000 }), ["crypto"]), 0);
});

ok("filtered totals go through the same arithmetic as the whole portfolio", () => {
  const gold = { ...bullion(2, 4_000, 5_000), amountInvested: 0, acquisition: "gift" as const };
  const quotes = new Map([["AAPL", quote("AAPL", 120, 100)], ["GOLD", manualQuote(gold)!]]);
  const all = portfolio([hold("AAPL", 10, 100), gold], quotes, 500);

  // Filtering to just the metals must reproduce what that holding reports on its own.
  const metalsOnly = totalsOf(all.positions.filter((p) => p.holding.assetType === "metal"), 0);
  assert.equal(metalsOnly.totals.marketValue, 10_000);
  assert.equal(metalsOnly.totals.costBasis, 8_000);
  assert.equal(metalsOnly.totals.invested, 0, "the gift cost nothing, filtered or not");
  assert.equal(metalsOnly.totals.dayChange, 0);
  assert.equal(metalsOnly.totals.dayChangePct, null, "bullion has no day move to report");

  const stocksOnly = totalsOf(all.positions.filter((p) => p.holding.assetType === "stock"), 0);
  assert.equal(stocksOnly.totals.marketValue, 1_200);
  near(stocksOnly.totals.dayChangePct, 20, "AAPL's own day move, undiluted by the gold");
  assert.equal(stocksOnly.totals.invested, 1_000, "the shares were paid for");
});

ok("filtered weights add up to what is on screen", () => {
  const gold = { ...bullion(2, 4_000, 5_000), amountInvested: 0 };
  const quotes = new Map([["AAPL", quote("AAPL", 120)], ["GOLD", manualQuote(gold)!]]);
  const all = portfolio([hold("AAPL", 10, 100), gold], quotes, 500);
  const metals = totalsOf(all.positions.filter((p) => p.holding.assetType === "metal"), 0);
  assert.equal(metals.positions[0].weight, 100, "the only thing shown is all of what is shown");
});

ok("buying into a filtered class is still money paid in, not a gain", () => {
  // The trap: filter to metals, buy gold, and the metals line jumps. Without the contributions
  // adjustment that reads as performance. It is the same guard as the unfiltered chart, and it has
  // to survive filtering because that is exactly when a single class moves the most.
  const r = performanceSinceStart(
    [snapWith(T0, 3_000, 0, { metal: 3_000 }), snapWith(T0 + DAY, 11_800, 0, { metal: 11_800 })],
    [{ kind: "buy", shares: 2, price: 4_400, at: T0 + DAY / 2 }]
  )!;
  near(r.contributions, 8_800);
  near(r.gain, 0);
});

console.log(`\n${checks} portfolio checks passed`);
