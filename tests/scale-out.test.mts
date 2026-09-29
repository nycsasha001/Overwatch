import assert from "node:assert/strict";
import { closePartial, rOf, step, type Candle, type Position, type TakeProfit } from "../src/lib/replay.ts";

/**
 * Scaling out: resting orders that take part of a position off at a price.
 *
 * The claim these checks defend is the one that makes the feature worth having — every partial is
 * measured against the risk the trade was *taken* with, not against wherever the stop has since
 * been dragged. Get that wrong and moving a stop to breakeven turns a three-R runner into a
 * scratch, which is exactly the bug the `initialStop` field exists to prevent.
 */

let checks = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  checks++;
  console.log(`  ok  ${name}`);
};
const near = (a: number, b: number, msg = "") => assert.ok(Math.abs(a - b) < 0.0005, `${msg} got ${a}, want ${b}`);

const bar = (o: number, h: number, l: number, c: number, ts = 1_000): Candle => ({ ts, open: o, high: h, low: l, close: c, volume: 0 });

/** A long from 100 with a stop at 90: one R is ten points. */
function long(contracts = 4, legs: TakeProfit[] = []): Position {
  return {
    direction: "long",
    entry: 100,
    stop: 90,
    initialStop: 90,
    target: null,
    takeProfits: legs,
    contracts,
    pointValue: 1,
    risk: 10 * contracts,
    entryTs: 0,
    mae: 0,
    mfe: 0,
    bars: 0,
  };
}

const tp = (id: string, price: number, contracts: number): TakeProfit => ({ id, price, contracts });

/* ------------------------------- filling legs ------------------------------- */

ok("a leg fills when the bar trades through it, and the rest runs on", () => {
  const r = step(long(4, [tp("a", 110, 2)]), bar(101, 112, 100, 111));
  assert.equal(r.partials?.length, 1);
  assert.equal(r.closed, null, "the position is still open");
  assert.equal(r.position.contracts, 2, "two left");
  near(r.partials![0].r, 1, "110 is one R above a 100 entry with a 90 stop");
  assert.equal(r.partials![0].reason, "partial");
});

ok("it fills at the resting price, not the bar close", () => {
  // The order was sitting at 110. Filling at the close would credit a run that happened after it.
  const r = step(long(4, [tp("a", 110, 2)]), bar(101, 125, 100, 124));
  assert.equal(r.partials![0].exit, 110);
});

ok("a gap through a leg fills at the open", () => {
  // Price never traded at 110 on the way up, so claiming that fill would be fiction.
  const r = step(long(4, [tp("a", 110, 2)]), bar(118, 120, 117, 119));
  assert.equal(r.partials![0].exit, 118);
  near(r.partials![0].r, 1.8);
});

ok("a bar that reaches nothing leaves the position alone", () => {
  const r = step(long(4, [tp("a", 110, 2)]), bar(101, 104, 99, 103));
  assert.equal(r.partials ?? null, null);
  assert.equal(r.position.contracts, 4);
});

ok("two legs swept by one bar fill nearest first", () => {
  const r = step(long(4, [tp("b", 120, 1), tp("a", 110, 2)]), bar(101, 125, 100, 124));
  assert.equal(r.partials?.length, 2);
  assert.equal(r.partials![0].exit, 110, "the closer one first");
  assert.equal(r.partials![1].exit, 120);
  assert.equal(r.position.contracts, 1, "one runner left");
});

ok("the last leg ends the trade rather than reporting a partial", () => {
  const r = step(long(2, [tp("a", 110, 2)]), bar(101, 112, 100, 111));
  assert.ok(r.closed, "the trade is over");
  assert.equal(r.closed!.reason, "target", "not 'partial' — nothing is left to run");
  assert.equal(r.position.contracts, 0);
});

ok("a filled leg stops resting; an untouched one stays", () => {
  const r = step(long(4, [tp("a", 110, 2), tp("b", 130, 2)]), bar(101, 112, 100, 111));
  const left = r.position.takeProfits ?? [];
  assert.deepEqual(left.map((t) => t.id), ["b"], "only the far leg is still working");
});

/* ------------------------- R against the original risk ------------------------- */

ok("a partial is measured against the stop the trade was taken with", () => {
  /**
   * The whole point. Stop moved to breakeven, so the *current* stop distance is zero — dividing by
   * it would be infinite or, as it once was, zero. `initialStop` keeps the original ten points.
   */
  const pos: Position = { ...long(4, [tp("a", 130, 2)]), stop: 100 };
  // The bar's low stays clear of the moved stop, or the stop fires and there is nothing to measure.
  const r = step(pos, bar(101, 135, 101, 134));

  near(r.partials![0].r, 3, "130 is three R from a 100 entry risking ten points");
  assert.ok(Number.isFinite(r.partials![0].pnl));
  near(r.partials![0].pnl, 3 * 10 * 2, "three R on two contracts at ten points of risk each");
});

ok("moving the stop does not change what a later leg is worth", () => {
  const tick = bar(107, 125, 106, 124); // above both the original stop and the moved one
  const original = step(long(4, [tp("a", 120, 2)]), tick);
  const moved = step({ ...long(4, [tp("a", 120, 2)]), stop: 105 }, tick);
  near(moved.partials![0].r, original.partials![0].r, "same R either way");
});

ok("two partials add up to closing the lot in one go", () => {
  // If scaling out at 110 and 120 did not equal closing four at those prices, the P&L would depend
  // on how the trade was managed rather than on where it was exited.
  const scaled = step(long(4, [tp("a", 110, 2), tp("b", 120, 2)]), bar(101, 125, 100, 124));
  const total = scaled.partials!.reduce((s, p) => s + p.pnl, 0);

  const half = 2 * 10; // two contracts, ten points of risk each
  near(total, 1 * half + 2 * half, "one R on the first two, two R on the second two");
});

/* -------------------------------- the stop wins -------------------------------- */

ok("a bar that hits both the stop and a leg resolves as the stop", () => {
  /**
   * Pessimistic on purpose. OHLC cannot say which came first, and assuming the good one is how a
   * backtest quietly flatters the strategy it is meant to be testing.
   */
  const r = step(long(4, [tp("a", 110, 2)]), bar(101, 112, 89, 95));
  assert.equal(r.partials ?? null, null, "no scale-out on an ambiguous bar");
  assert.ok(r.closed, "the stop took it");
  assert.equal(r.closed!.reason, "stop");
  near(r.closed!.r, -1);
});

ok("a leg beyond the stop on a gap-down still does not fill", () => {
  const r = step(long(4, [tp("a", 110, 2)]), bar(85, 112, 84, 111));
  assert.equal(r.closed!.reason, "gap-stop");
  assert.equal(r.partials ?? null, null);
});

/* --------------------------------- odd sizes --------------------------------- */

ok("a leg sized past what is left takes only what is left", () => {
  const r = step(long(2, [tp("a", 110, 99)]), bar(101, 112, 100, 111));
  assert.equal(r.partials![0].contracts, 2);
  assert.equal(r.position.contracts, 0);
});

ok("a zero-size leg is ignored rather than filling for nothing", () => {
  const r = step(long(4, [tp("a", 110, 0)]), bar(101, 112, 100, 111));
  assert.equal(r.partials ?? null, null);
  assert.equal(r.position.contracts, 4);
});

ok("a position with no legs behaves exactly as before", () => {
  // The regression guard: everything built before scale-outs existed must be untouched.
  const plain: Position = { ...long(4), target: 120 };
  const r = step(plain, bar(101, 125, 100, 124));
  assert.equal(r.partials ?? null, null);
  assert.equal(r.closed!.reason, "target");
  assert.equal(r.closed!.contracts, 4, "a target still closes the whole lot");
});

/* ----------------------------- shorts, mirrored ----------------------------- */

ok("a short scales out downwards", () => {
  const pos: Position = {
    ...long(4, [tp("a", 90, 2)]),
    direction: "short",
    entry: 100,
    stop: 110,
    initialStop: 110,
  };
  const r = step(pos, bar(99, 100, 88, 89));
  assert.equal(r.partials![0].exit, 90);
  near(r.partials![0].r, 1, "ten points in favour on a ten-point risk");
  assert.equal(r.position.contracts, 2);
});

ok("a short's stop still wins an ambiguous bar", () => {
  const pos: Position = {
    ...long(4, [tp("a", 90, 2)]),
    direction: "short",
    entry: 100,
    stop: 110,
    initialStop: 110,
  };
  const r = step(pos, bar(99, 112, 88, 95));
  assert.equal(r.closed!.reason, "stop");
  assert.equal(r.partials ?? null, null);
});

/* ------------------------ the manual partial still works ------------------------ */

ok("taking one off by hand is unchanged and agrees on R", () => {
  const { closed, remaining } = closePartial(long(4), bar(101, 112, 100, 110), 2);
  assert.equal(closed.contracts, 2);
  assert.equal(remaining!.contracts, 2);
  near(closed.r, rOf(long(4), 110), "the same R the resting leg would have reported");
});

console.log(`\n${checks} scale-out checks passed`);
