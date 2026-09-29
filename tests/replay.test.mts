import assert from "node:assert/strict";
import { anchorRisk, closeAtMarket, closePartial, fillAtMarket, rOf, riskUnit, sessionStats, step, tryFill, validateOrder, type OrderDraft, type Position } from "../src/lib/replay.ts";

let pass = 0;
const test = async (n: string, f: () => void | Promise<void>) => {
  try { await f(); pass++; console.log(`  ok  ${n}`); }
  catch (e) { console.error(`  FAIL ${n}\n       ${(e as Error).message}`); process.exitCode = 1; }
};

const bar = (open: number, high: number, low: number, close: number, ts = 1_000_000) => ({ ts, open, high, low, close, volume: 100 });

const longPos = (over: Partial<Position> = {}): Position => ({
  direction: "long", entry: 21000, stop: 20980, target: 21060,
  contracts: 12.5, pointValue: 2, risk: 500, initialStop: 20980,
  entryTs: 0, mae: 0, mfe: 0, bars: 0, ...over,
});

const order = (over: Partial<OrderDraft> = {}): OrderDraft => ({
  direction: "long", entryType: "market", entryPrice: null, stop: 20980, target: 21060,
  contracts: 10, pointValue: 2, ...over,
});

/* ------------------------------- entries -------------------------------- */

await test("a queued market order fills at the next bar's open", () => {
  const p = tryFill(order(), bar(21005, 21010, 20995, 21000))!;
  assert.equal(p.entry, 21005);
});

await test("buy limit does not fill until price trades through it", () => {
  const o = order({ entryType: "limit", entryPrice: 20990 });
  assert.equal(tryFill(o, bar(21005, 21010, 20995, 21000)), null, "low never reached the limit");
  assert.equal(tryFill(o, bar(21005, 21010, 20985, 21000))!.entry, 20990);
});

await test("a gap below a buy limit fills better, at the open", () => {
  const o = order({ entryType: "limit", entryPrice: 20990 });
  assert.equal(tryFill(o, bar(20970, 20995, 20960, 20980))!.entry, 20970);
});

await test("sell limit mirrors the long behaviour", () => {
  const o = order({ direction: "short", entryType: "limit", entryPrice: 21010, stop: 21030, target: 20950 });
  assert.equal(tryFill(o, bar(21000, 21005, 20990, 20995)), null);
  assert.equal(tryFill(o, bar(21000, 21015, 20990, 21010))!.entry, 21010);
  assert.equal(tryFill(o, bar(21030, 21040, 21020, 21035))!.entry, 21030, "gap above fills at the open");
});

/* --------------------------- the pessimistic rule ------------------------ */

await test("a bar touching BOTH stop and target is taken as the stop", () => {
  const { closed } = step(longPos(), bar(21000, 21065, 20975, 21050));
  assert.equal(closed!.reason, "stop");
  assert.equal(closed!.exit, 20980);
  assert.equal(closed!.r, -1);
  assert.equal(closed!.ambiguous, true, "must be flagged for 1s re-checking");
});

await test("target alone fills at the target", () => {
  const { closed } = step(longPos(), bar(21000, 21065, 20990, 21055));
  assert.equal(closed!.reason, "target");
  assert.equal(closed!.exit, 21060);
  assert.equal(closed!.r, 3);
  assert.equal(closed!.ambiguous, false);
});

await test("stop alone fills at the stop", () => {
  const { closed } = step(longPos(), bar(21000, 21010, 20975, 20985));
  assert.equal(closed!.reason, "stop");
  assert.equal(closed!.r, -1);
});

await test("a gap through the stop fills at the open, worse than the stop", () => {
  const { closed } = step(longPos(), bar(20950, 20960, 20940, 20955));
  assert.equal(closed!.reason, "gap-stop");
  assert.equal(closed!.exit, 20950);
  assert.equal(closed!.r, -2.5, "a -1R stop became a -2.5R loss");
});

await test("a gap through the target fills at the open, better than the target", () => {
  const { closed } = step(longPos(), bar(21080, 21090, 21075, 21085));
  assert.equal(closed!.reason, "gap-target");
  assert.equal(closed!.exit, 21080);
  assert.equal(closed!.r, 4);
});

await test("short positions apply the same rules inverted", () => {
  const shortPos = longPos({ direction: "short", entry: 21000, stop: 21020, target: 20940 });
  const both = step(shortPos, bar(21000, 21025, 20935, 20990));
  assert.equal(both.closed!.reason, "stop");
  assert.equal(both.closed!.r, -1);
  const gapped = step(shortPos, bar(21050, 21060, 21040, 21055));
  assert.equal(gapped.closed!.reason, "gap-stop");
  assert.equal(gapped.closed!.r, -2.5);
});

/* ------------------------------ excursions ------------------------------- */

await test("MAE and MFE accumulate across bars", () => {
  let pos = longPos({ target: null });
  pos = step(pos, bar(21000, 21020, 20990, 21010)).position; // +1R high, -0.5R low
  assert.equal(pos.mfe, 1);
  assert.equal(pos.mae, 0.5);
  pos = step(pos, bar(21010, 21040, 21005, 21035)).position; // new high only
  assert.equal(pos.mfe, 2);
  assert.equal(pos.mae, 0.5, "MAE must not shrink");
  assert.equal(pos.bars, 2);
});

await test("excursions are recorded on the closing bar too", () => {
  const { closed } = step(longPos(), bar(21000, 21065, 20975, 21050));
  assert.equal(closed!.mfe, 3.25, "the bar's high still counts");
  assert.equal(closed!.mae, 1.25);
});

/* -------------------------------- closing -------------------------------- */

await test("manual close fills at the bar close", () => {
  const t = closeAtMarket(longPos(), bar(21000, 21030, 20995, 21020));
  assert.equal(t.exit, 21020);
  assert.equal(t.r, 1);
  assert.equal(t.pnl, 500);
  assert.equal(t.reason, "manual");
});

await test("P&L is R times the risk taken", () => {
  const { closed } = step(longPos({ risk: 250 }), bar(21000, 21065, 20990, 21055));
  assert.equal(closed!.r, 3);
  assert.equal(closed!.pnl, 750);
});

await test("risk is derived from contracts and point value", () => {
  // 10 MNQ, 20 points of stop, $2 a point = $400 at risk
  const pos = fillAtMarket(order({ contracts: 10, pointValue: 2 }), bar(21005, 21010, 20995, 21000));
  assert.equal(pos.entry, 21000, "market fills at the close of the bar on screen");
  assert.equal(pos.risk, 400);
  const { closed } = step(pos, bar(21000, 21065, 20990, 21055));
  assert.equal(closed!.r, 3);
  assert.equal(closed!.pnl, 1200, "3R on $400 of risk");
});

await test("a bigger contract size scales the dollars, not the R", () => {
  const small = fillAtMarket(order({ contracts: 5 }), bar(21005, 21010, 20995, 21000));
  const big = fillAtMarket(order({ contracts: 20 }), bar(21005, 21010, 20995, 21000));
  assert.equal(big.risk, small.risk * 4);
  assert.equal(step(small, bar(21000, 21065, 20990, 21055)).closed!.r, step(big, bar(21000, 21065, 20990, 21055)).closed!.r);
});

await test("R of an arbitrary price", () => {
  assert.equal(rOf({ direction: "long", entry: 21000, stop: 20980 }, 21040), 2);
  assert.equal(rOf({ direction: "short", entry: 21000, stop: 21020 }, 20960), 2);
});

/* ------------------------------ validation ------------------------------- */

await test("orders with the stop on the wrong side are rejected", () => {
  assert.match(validateOrder(order({ stop: 21050 }), 21000)!, /below the entry/);
  assert.match(validateOrder(order({ direction: "short", stop: 20950 }), 21000)!, /above the entry/);
  assert.match(validateOrder(order({ target: 20900 }), 21000)!, /above the entry/);
  assert.match(validateOrder(order({ contracts: 0 }), 21000)!, /at least one contract/);
  assert.equal(validateOrder(order(), 21000), null);
});

await test("a limit order with no price is rejected", () => {
  assert.match(validateOrder(order({ entryType: "limit", entryPrice: null }), 21000)!, /limit price/);
});

/* ----------------------------- session stats ----------------------------- */

await test("session stats count outcomes and flag ambiguity", () => {
  const t = (r: number, ambiguous = false) => ({ ...longPos(), exit: 0, exitTs: 0, reason: "stop" as const, r, pnl: r * 500, ambiguous });
  const s = sessionStats([t(2), t(-1), t(-1, true), t(0)]);
  assert.equal(s.trades, 4);
  assert.equal(s.wins, 1);
  assert.equal(s.losses, 2);
  assert.equal(s.breakeven, 1);
  assert.equal(s.netR, 0);
  assert.equal(s.netPnl, 0);
  assert.equal(s.winRate, (1 / 3) * 100);
  assert.equal(s.ambiguous, 1);
});

/* -------------------------- R is fixed at the fill ------------------------ */

await test("moving the stop to breakeven does not erase the trade's R", () => {
  // It used to: R was measured off wherever the stop sat, so a stop at the entry made the
  // distance zero and every R after it zero — a runner three R up logged as a scratch.
  const pos = fillAtMarket(order({ contracts: 10, pointValue: 2 }), bar(21000, 21000, 21000, 21000));
  assert.equal(pos.initialStop, 20980, "the stop it was taken with is what R leans on");
  assert.equal(rOf(pos, 21060), 3);
  const be = { ...pos, stop: pos.entry };
  assert.equal(rOf(be, 21060), 3, "breakeven stop rewrote what the trade was risking");
  const closed = closeAtMarket(be, bar(21060, 21060, 21060, 21060));
  assert.equal(closed.r, 3);
  assert.equal(closed.pnl, 3 * pos.risk);
});

await test("a working order still reads its risk off its stop", () => {
  // It has no fill yet, so there is no distance recorded and the stop is the risk being taken.
  assert.equal(rOf({ direction: "long", entry: 100, stop: 98 }, 104), 2);
});

await test("the stop a trade was taken with is recorded at the fill", () => {
  const pos = fillAtMarket(order({ stop: 20970, contracts: 10, pointValue: 2 }), bar(21000, 21000, 21000, 21000));
  assert.equal(pos.initialStop, 20970);
  assert.equal(riskUnit(pos), 30, "one R in points");
  assert.equal(pos.risk, 30 * 2 * 10, "and in money");
});

await test("re-anchoring R moves it to the stop in hand", () => {
  // Placed roughly to get filled, then tightened to the level that actually invalidates the idea.
  const pos = fillAtMarket(order({ stop: 20960, contracts: 10, pointValue: 2 }), bar(21000, 21000, 21000, 21000));
  assert.equal(rOf(pos, 21040), 1, "40 points on a 40-point stop");
  const tightened = anchorRisk({ ...pos, stop: 20980 }, 20980);
  assert.equal(tightened.initialStop, 20980);
  assert.equal(rOf(tightened, 21040), 2, "the same move is 2R against the tighter stop");
  assert.equal(tightened.risk, 20 * 2 * 10, "and the money risked is restated with it");
});

await test("re-anchoring refuses a stop that risks nothing", () => {
  const pos = fillAtMarket(order({ contracts: 10, pointValue: 2 }), bar(21000, 21000, 21000, 21000));
  assert.equal(anchorRisk(pos, pos.entry), pos, "a stop on the entry was accepted");
  assert.equal(anchorRisk(pos, Number.NaN), pos, "a nonsense stop was accepted");
  assert.equal(anchorRisk(pos, pos.entry + 10), pos, "a stop in profit was accepted");
});

await test("a stop trailed into profit closes as a win, measured from the original stop", () => {
  const pos = fillAtMarket(order({ stop: 20970, contracts: 10, pointValue: 2 }), bar(21000, 21000, 21000, 21000));
  const trailed = { ...pos, stop: 21015 };
  const { closed } = step(trailed, bar(21030, 21035, 21010, 21012));
  assert.equal(closed?.reason, "stop");
  assert.equal(closed?.exit, 21015);
  assert.equal(closed?.r, 0.5, "15 points on the 30-point stop it was taken with");
  assert.equal(closed?.pnl, 15 * 2 * 10);
});

await test("a re-anchored R carries through the exit and its partials", () => {
  const pos = anchorRisk(fillAtMarket(order({ stop: 20960, contracts: 4, pointValue: 2 }), bar(21000, 21000, 21000, 21000)), 20980);
  const at = bar(21040, 21040, 21040, 21040);
  const { closed, remaining } = closePartial(pos, at, 2);
  assert.equal(closed.r, 2, "the partial is measured against the anchored stop");
  assert.equal(closed.risk, 20 * 2 * 2);
  assert.equal(remaining?.initialStop, 20980, "and the runner keeps the same anchor");
  assert.equal(closeAtMarket(remaining!, at).r, 2);
});

/* -------------------------------- partials ------------------------------- */

await test("a partial closes part of the position and leaves the rest running", () => {
  const pos = fillAtMarket(order({ contracts: 4, pointValue: 2 }), bar(21000, 21000, 21000, 21000));
  const { closed, remaining } = closePartial(pos, bar(21040, 21040, 21040, 21040), 2);
  assert.equal(closed.contracts, 2, "two left");
  assert.equal(closed.reason, "partial");
  assert.equal(closed.r, 2, "R is the same R the whole position had here");
  assert.equal(closed.risk, 20 * 2 * 2, "money is restated on the contracts that left");
  assert.equal(closed.pnl, 2 * closed.risk);
  assert.equal(remaining?.contracts, 2, "two stayed");
  assert.equal(remaining?.risk, 20 * 2 * 2, "and the remaining risk shrank with them");
  assert.equal(remaining?.entry, pos.entry, "on the same entry and stop");
  assert.equal(remaining?.stop, pos.stop);
});

await test("two partials add up to closing the lot in one go", () => {
  const pos = fillAtMarket(order({ contracts: 4, pointValue: 2 }), bar(21000, 21000, 21000, 21000));
  const at = bar(21040, 21040, 21040, 21040);
  const first = closePartial(pos, at, 2);
  const second = closePartial(first.remaining!, at, 2);
  const whole = closeAtMarket(pos, at);
  assert.equal(first.closed.pnl + second.closed.pnl, whole.pnl);
  assert.equal(second.remaining, null, "the last one closes the position");
  assert.equal(second.closed.reason, "manual", "and is the trade ending, not a partial");
});

await test("a partial cannot take more than is on, or less than one", () => {
  const pos = fillAtMarket(order({ contracts: 3, pointValue: 2 }), bar(21000, 21000, 21000, 21000));
  const at = bar(21020, 21020, 21020, 21020);
  assert.equal(closePartial(pos, at, 99).closed.contracts, 3);
  assert.equal(closePartial(pos, at, 99).remaining, null);
  assert.equal(closePartial(pos, at, 0).closed.contracts, 1);
  assert.equal(closePartial(pos, at, -5).closed.contracts, 1);
});

await test("a runner keeps the heat the whole position took", () => {
  const pos = fillAtMarket(order({ contracts: 4, pointValue: 2 }), bar(21000, 21000, 21000, 21000));
  const hot = step(pos, bar(21000, 21030, 20990, 21020)).position; // dipped before it ran
  assert.ok(hot.mae > 0);
  const { remaining } = closePartial(hot, bar(21040, 21040, 21040, 21040), 2);
  assert.equal(remaining?.mae, hot.mae, "the remainder forgot the drawdown it had already taken");
  assert.equal(remaining?.mfe, hot.mfe);
  assert.equal(remaining?.bars, hot.bars);
});

await test("the runner is still stopped and targeted normally after a partial", () => {
  const pos = fillAtMarket(order({ contracts: 4, pointValue: 2 }), bar(21000, 21000, 21000, 21000));
  const { remaining } = closePartial(pos, bar(21040, 21040, 21040, 21040), 2);
  const out = step(remaining!, bar(21040, 21040, 20970, 20975));
  assert.equal(out.closed?.reason, "stop");
  assert.equal(out.closed?.contracts, 2, "only the contracts still on");
  assert.equal(out.closed?.r, -1);
  assert.equal(out.closed?.pnl, -remaining!.risk);
});

console.log(`\n${pass} replay-engine checks passed`);
