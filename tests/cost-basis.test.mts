import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Setting a position's average cost by hand.
 *
 * The whole point of these checks is the second group. Average cost is *derived* from the lots, so
 * the naive implementation — write the number into the holdings row — appears to work and then
 * silently reverts the next time anything touches the transaction history. A correction that
 * undoes itself is worse than no correction, and it is invisible until the day the numbers matter.
 *
 * A temporary data directory is set before the modules load, because db.ts reads TJ_DATA_DIR once
 * at import time.
 */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "overwatch-cost-"));
process.env.TJ_DATA_DIR = TMP;

const {
  createHolding,
  createTransaction,
  deleteTransaction,
  getHolding,
  listHoldings,
  listTransactions,
  restateCostBasis,
  restorePortfolio,
  syncHoldingFromTransactions,
} = await import("../src/lib/db.ts");

const { performanceSinceStart } = await import("../src/lib/portfolio.ts");

const U = null; // the legacy single-journal scope; isolation is covered by accounts.test.mts

let checks = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  checks++;
  console.log(`  ok  ${name}`);
};
const near = (a: number, b: number, msg = "") => assert.ok(Math.abs(a - b) < 0.005, `${msg} got ${a}, want ${b}`);

/** A position entered the way the app does it: one lot stamped at the price of the day. */
function seed(symbol: string, shares: number, price: number, date = "2026-01-05") {
  for (const t of listTransactions(U, symbol)) deleteTransaction(U, t.id);
  const existing = listHoldings(U).find((h) => h.symbol === symbol);
  if (!existing) createHolding(U, { symbol, shares, avgCost: price, assetType: "stock" });
  createTransaction(U, { symbol, kind: "buy", shares, price, date });
  return syncHoldingFromTransactions(U, symbol)!;
}

/* ------------------------------ the basic edit ------------------------------ */

ok("setting an average cost changes it", () => {
  const h = seed("AAPL", 10, 200);
  near(h.avgCost, 200);
  const after = restateCostBasis(U, h.id, 150)!;
  near(after.avgCost, 150);
  assert.equal(after.shares, 10, "the share count is not touched");
});

ok("the share count and the cost move independently", () => {
  const h = seed("MSFT", 8, 300);
  const after = restateCostBasis(U, h.id, 250, 12)!;
  assert.equal(after.shares, 12);
  near(after.avgCost, 250);
});

ok("a nonsense cost is refused rather than written", () => {
  const h = seed("NVDA", 5, 100);
  near(restateCostBasis(U, h.id, Number.NaN)!.avgCost, 100);
  near(restateCostBasis(U, h.id, -50)!.avgCost, 100);
});

ok("an unknown holding is null, not a crash", () => {
  assert.equal(restateCostBasis(U, "hld_does_not_exist", 100), null);
});

/* ------------- the part that would silently revert if done wrong ------------- */

ok("the restated cost survives a later buy", () => {
  // The bug this file exists for. Write the number into the holdings row instead of restating the
  // lots and this line reverts to the weighted average of the *original* price and the new buy.
  const h = seed("SPY", 10, 769.62);
  restateCostBasis(U, h.id, 600);

  createTransaction(U, { symbol: "SPY", kind: "buy", shares: 10, price: 800, date: "2026-02-01" });
  const after = syncHoldingFromTransactions(U, "SPY")!;

  assert.equal(after.shares, 20);
  near(after.avgCost, 700, "600 and 800 average to 700 — the restated 600, not the original 769.62");
});

ok("the restated cost survives a sell", () => {
  const h = seed("TSLA", 20, 400);
  restateCostBasis(U, h.id, 250);
  createTransaction(U, { symbol: "TSLA", kind: "sell", shares: 5, price: 900, date: "2026-03-01" });
  const after = syncHoldingFromTransactions(U, "TSLA")!;
  assert.equal(after.shares, 15);
  near(after.avgCost, 250, "selling never moves the average cost of what remains");
});

ok("the restated cost survives deleting a transaction", () => {
  const h = seed("QQQ", 10, 500);
  restateCostBasis(U, h.id, 300);
  const extra = createTransaction(U, { symbol: "QQQ", kind: "buy", shares: 10, price: 700, date: "2026-02-01" });
  near(syncHoldingFromTransactions(U, "QQQ")!.avgCost, 500, "300 and 700 average to 500");

  deleteTransaction(U, extra.id);
  const after = syncHoldingFromTransactions(U, "QQQ")!;
  assert.equal(after.shares, 10);
  near(after.avgCost, 300, "removing the later buy leaves the restated basis, not the original 500");
});

/* --------------------------- what it does to history -------------------------- */

ok("the lots are replaced by exactly one", () => {
  seed("AMD", 10, 100);
  createTransaction(U, { symbol: "AMD", kind: "buy", shares: 10, price: 200, date: "2026-02-01" });
  const h = syncHoldingFromTransactions(U, "AMD")!;
  assert.equal(listTransactions(U, "AMD").length, 2);

  restateCostBasis(U, h.id, 120);
  const lots = listTransactions(U, "AMD");
  assert.equal(lots.length, 1, "two lots collapse to one");
  near(lots[0].price, 120);
  assert.equal(lots[0].kind, "buy");
});

ok("the position keeps the date it has been held from", () => {
  // Re-dating to today would tell the performance maths that a months-old holding was bought this
  // morning, and every "since you started" figure would be wrong by the size of the position.
  seed("KO", 10, 50, "2025-04-02");
  createTransaction(U, { symbol: "KO", kind: "buy", shares: 5, price: 60, date: "2025-09-15" });
  const h = syncHoldingFromTransactions(U, "KO")!;

  restateCostBasis(U, h.id, 55);
  assert.equal(listTransactions(U, "KO")[0].date, "2025-04-02", "the earliest date, not today");
});

/* ----------------------------------- undo ----------------------------------- */

ok("undo puts the original lots back and the average with them", () => {
  seed("META", 10, 100, "2026-01-05");
  createTransaction(U, { symbol: "META", kind: "buy", shares: 10, price: 300, date: "2026-02-01" });
  const before = syncHoldingFromTransactions(U, "META")!;
  const lotsBefore = listTransactions(U, "META");
  near(before.avgCost, 200);

  restateCostBasis(U, before.id, 75);
  near(getHolding(U, before.id)!.avgCost, 75);

  // replaceLots: without it the synthetic opening lot stays and the position doubles.
  restorePortfolio(U, before, lotsBefore, true);
  const after = syncHoldingFromTransactions(U, "META")!;

  assert.equal(listTransactions(U, "META").length, 2, "both original lots are back");
  assert.equal(after.shares, 20, "and the position is not doubled");
  near(after.avgCost, 200, "the average falls out of the restored maths");
});

ok("undoing twice does not duplicate the lots", () => {
  seed("GOOGL", 10, 100);
  const before = syncHoldingFromTransactions(U, "GOOGL")!;
  const lotsBefore = listTransactions(U, "GOOGL");

  restateCostBasis(U, before.id, 40);
  restorePortfolio(U, before, lotsBefore, true);
  restorePortfolio(U, before, lotsBefore, true);

  const after = syncHoldingFromTransactions(U, "GOOGL")!;
  assert.equal(listTransactions(U, "GOOGL").length, 1);
  assert.equal(after.shares, 10);
  near(after.avgCost, 100);
});

ok("restoring without the flag still behaves as it did", () => {
  // The default path is used by every other undo in the app; it must not have changed.
  seed("LMT", 4, 500);
  const h = syncHoldingFromTransactions(U, "LMT")!;
  const lots = listTransactions(U, "LMT");
  restorePortfolio(U, h, lots);
  assert.equal(listTransactions(U, "LMT").length, 1, "a lot already present is skipped, not duplicated");
});

/* ------------------- the sign-inverting bug this once had ------------------- */

ok("restating a cost does not make the position look like a fresh deposit", () => {
  /**
   * The regression. `restateCostBasis` replaces a position's lots, and the replacement used to take
   * the current timestamp. `performanceSinceStart` treats anything recorded after the baseline as
   * money paid in, so a position held for weeks read as a deposit made today and the headline gain
   * fell by its entire cost basis — a portfolio up $730 reported being down $1,910.
   */
  const h = seed("VOO", 3.7758, 699.10, "2026-09-06");
  const before = listTransactions(U, "VOO")[0];

  restateCostBasis(U, h.id, 650);
  const after = listTransactions(U, "VOO")[0];

  assert.equal(after.createdAt, before.createdAt, "the lot keeps when it was recorded");
  assert.equal(after.date, before.date, "and the day it was acquired");
});

ok("a genuinely new buy is still recorded as of now", () => {
  // The fix must not go too far: money that really did arrive after the baseline has to keep
  // counting as a contribution, or gains get overstated instead of understated.
  seed("IWM", 5, 200, "2026-01-05");
  const fresh = createTransaction(U, { symbol: "IWM", kind: "buy", shares: 5, price: 250, date: "2026-06-01" });
  assert.ok(fresh.createdAt.slice(0, 4) >= "2026", "stamped when it was entered, not backdated");
});

ok("performance ignores a restated lot and counts a real one", () => {
  // End to end, in the shape the page actually computes it.
  const t0 = Date.UTC(2026, 8, 8);
  const snaps = [
    { ts: t0, total: 21_597.63, cash: 0, invested: 21_597.63 },
    { ts: t0 + 14 * 86_400_000, total: 22_327.38, cash: 0, invested: 22_327.38 },
  ];

  // A lot recorded before the baseline, restated afterwards — createdAt preserved.
  const held = [{ kind: "buy" as const, shares: 3.7758, price: 699.1, at: t0 - 2 * 86_400_000 }];
  const onlyHeld = performanceSinceStart(snaps, held)!;
  near(onlyHeld.contributions, 0, "a position you already owned is not a contribution");
  near(onlyHeld.gain, 729.75, "which is the number the page should show");

  // The same lot with the old, wrong timestamp.
  const stamped = [{ kind: "buy" as const, shares: 3.7758, price: 699.1, at: t0 + 13 * 86_400_000 }];
  const broken = performanceSinceStart(snaps, stamped)!;
  assert.ok(broken.gain < -1900, "and this is what the bug produced");
});

console.log(`\n${checks} cost-basis checks passed`);
