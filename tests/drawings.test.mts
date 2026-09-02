import assert from "node:assert/strict";
import { constrainToAxis, distanceToRect, distanceToSegment, extendSegment, hitTest, styleFor, DEFAULT_STYLE } from "../src/lib/drawings.ts";

let pass = 0;
const test = async (n: string, f: () => void | Promise<void>) => {
  try { await f(); pass++; console.log(`  ok  ${n}`); }
  catch (e) { console.error(`  FAIL ${n}\n       ${(e as Error).message}`); process.exitCode = 1; }
};

await test("distance to a segment clamps to its ends", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };
  assert.equal(distanceToSegment({ x: 5, y: 3 }, a, b), 3, "perpendicular");
  assert.equal(distanceToSegment({ x: -4, y: 0 }, a, b), 4, "past the start");
  assert.equal(distanceToSegment({ x: 14, y: 0 }, a, b), 4, "past the end");
  assert.equal(distanceToSegment({ x: 5, y: 0 }, a, a), 5, "degenerate segment");
});

await test("distance to a rectangle is zero inside it", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 10 };
  assert.equal(distanceToRect({ x: 5, y: 5 }, a, b), 0);
  assert.equal(distanceToRect({ x: 14, y: 5 }, a, b), 4);
  assert.equal(distanceToRect({ x: 5, y: -3 }, a, b), 3);
  assert.equal(Math.round(distanceToRect({ x: 13, y: 14 }, a, b)), 5, "corner");
});

await test("hit testing respects the shape", () => {
  const a = { x: 0, y: 50 };
  const b = { x: 100, y: 50 };
  assert.equal(hitTest("ray", { x: 900, y: 53 }, a, b, 1), true, "a ray is hit anywhere to its right");
  assert.equal(hitTest("ray", { x: 900, y: 70 }, a, b, 1), false);
  assert.equal(hitTest("ray", { x: -50, y: 50 }, a, b, 1), false, "but not to its left");
  assert.equal(hitTest("gann", { x: 50, y: 60 }, a, { x: 100, y: 100 }, 1), true);
  assert.equal(hitTest("trendline", { x: 50, y: 54 }, a, b, 1), true);
  assert.equal(hitTest("trendline", { x: 200, y: 50 }, a, b, 1), false, "beyond the segment");
  assert.equal(hitTest("rect", { x: 50, y: 50 }, a, { x: 100, y: 100 }, 1), true);
});

await test("extending a segment reaches the viewport edges", () => {
  const [l, r] = extendSegment({ x: 20, y: 20 }, { x: 40, y: 40 }, 200, true, true);
  assert.equal(l.x, 0);
  assert.equal(l.y, 0, "slope of 1 extended back to x=0");
  assert.equal(r.x, 200);
  assert.equal(r.y, 200);
  const [l2, r2] = extendSegment({ x: 20, y: 20 }, { x: 40, y: 40 }, 200, false, false);
  assert.deepEqual([l2, r2], [{ x: 20, y: 20 }, { x: 40, y: 40 }], "untouched when not extending");
});

await test("tool defaults and templates layer correctly", () => {
  assert.equal(styleFor("ray").extendRight, true);
  assert.equal(styleFor("rect").midline, true);
  assert.equal(styleFor("trendline").dash, 0);
  assert.equal(styleFor("trendline", { dash: 2, color: "#fff" }).dash, 2, "template wins");
  assert.equal(styleFor("rect", { midline: false }).midline, false);
});

await test("shift constrains to horizontal, vertical or 45 degrees", () => {
  const o = { x: 100, y: 100 };
  assert.deepEqual(constrainToAxis(o, { x: 200, y: 108 }), { x: 200, y: 100 }, "mostly sideways → horizontal");
  assert.deepEqual(constrainToAxis(o, { x: 104, y: 300 }), { x: 100, y: 300 }, "mostly vertical → vertical");
  assert.deepEqual(constrainToAxis(o, { x: 180, y: 170 }), { x: 170, y: 170 }, "diagonal → exact 45°");
  assert.deepEqual(constrainToAxis(o, { x: 40, y: 160 }), { x: 40, y: 160 }, "45° down-left keeps both signs");
  assert.deepEqual(constrainToAxis(o, { x: 100, y: 100 }), { x: 100, y: 100 }, "no movement");
});

await test("drawings default to white, positions stay grey", () => {
  assert.equal(DEFAULT_STYLE.color, "#ffffff");
  assert.equal(styleFor("trendline").color, "#ffffff");
  assert.equal(styleFor("ray").color, "#ffffff");
  assert.equal(styleFor("rect").color, "#ffffff");
  assert.equal(styleFor("gann").color, "#ffffff");
  assert.equal(styleFor("long").color, "#d1d4dc");
  assert.equal(styleFor("short").color, "#9598a1");
});

await test("position levels are three independent prices", async () => {
  const { positionLevels, seedPosition, DEFAULT_STYLE } = await import("../src/lib/drawings.ts");
  const base = { id: "p1", kind: "long" as const, style: DEFAULT_STYLE };

  // stop 20 below, target 15 above — deliberately not a round multiple
  const custom = { ...base, a: { t: 0, price: 21000 }, b: { t: 0, price: 20980 }, c: { t: 0, price: 21015 } };
  const lv = positionLevels(custom);
  assert.equal(lv.entry, 21000);
  assert.equal(lv.stop, 20980);
  assert.equal(lv.target, 21015, "target is exactly where it was put");
  assert.equal(lv.rr, 0.75, "ratio is reported, not enforced");

  // a target further than 2R is equally fine
  const wide = positionLevels({ ...custom, c: { t: 0, price: 21100 } });
  assert.equal(wide.target, 21100);
  assert.equal(wide.rr, 5);

  // shorts invert
  const short = positionLevels({ ...base, kind: "short", a: { t: 0, price: 21000 }, b: { t: 0, price: 21020 }, c: { t: 0, price: 20950 } });
  assert.equal(short.stop, 21020);
  assert.equal(short.target, 20950);
  assert.equal(short.rr, 2.5);

  // drawings saved before targets existed still open
  const legacy = positionLevels({ ...base, a: { t: 0, price: 21000 }, b: { t: 0, price: 20980 } });
  assert.equal(legacy.target, 21040, "falls back to twice the stop distance");

  assert.equal(seedPosition("long", { t: 0, price: 21000 }, { t: 5, price: 20980 }).price, 21040);
  assert.equal(seedPosition("short", { t: 0, price: 21000 }, { t: 5, price: 21020 }).price, 20960);
});

await test("fill resolves colour and opacity, with a legacy fallback", async () => {
  const { fillOf, DEFAULT_STYLE } = await import("../src/lib/drawings.ts");
  assert.equal(fillOf({ ...DEFAULT_STYLE, fillColor: "#ffffff", fillOpacity: 12 }), "rgba(255,255,255,0.12)");
  assert.equal(fillOf({ ...DEFAULT_STYLE, fillColor: "#5b7cfa", fillOpacity: 50 }), "rgba(91,124,250,0.5)");
  assert.equal(fillOf({ ...DEFAULT_STYLE, fillColor: "#fff", fillOpacity: 100 }), "rgba(255,255,255,1)", "short hex");
  assert.equal(fillOf({ ...DEFAULT_STYLE, fillColor: null, fill: "rgba(1,2,3,0.4)" }), "rgba(1,2,3,0.4)", "legacy value still works");
  assert.equal(fillOf({ ...DEFAULT_STYLE, fillColor: null, fill: null }), undefined);
});

await test("the magnet picks the nearest wick or body edge", async () => {
  const { nearestCandleLevel } = await import("../src/lib/drawings.ts");
  const bar = { open: 100, high: 110, low: 90, close: 105 };

  assert.equal(nearestCandleLevel(bar, 109, 5)!.kind, "high");
  assert.equal(nearestCandleLevel(bar, 91.5, 5)!.kind, "low");
  assert.equal(nearestCandleLevel(bar, 100.7, 5)!.kind, "open");
  assert.equal(nearestCandleLevel(bar, 104, 5)!.kind, "close");
  assert.equal(nearestCandleLevel(bar, 109, 5)!.price, 110, "it returns the exact candle price");

  // between levels and outside the radius: no snap, the pointer stays free
  assert.equal(nearestCandleLevel(bar, 102.5, 1), null);
  assert.equal(nearestCandleLevel(bar, 130, 5), null);

  // strong magnet passes an unbounded radius and therefore always finds a level
  assert.equal(nearestCandleLevel(bar, 130, Infinity)!.kind, "high");
  assert.equal(nearestCandleLevel(bar, 10, Infinity)!.kind, "low");
  assert.equal(nearestCandleLevel(bar, 103, Infinity)!.kind, "close");
});

await test("time maps to a fractional bar index, inside the data and beyond it", async () => {
  const { logicalForTime, timeForLogical } = await import("../src/lib/drawings.ts");
  const bars = [0, 60, 120, 180, 240].map((m) => ({ ts: 1_000_000 + m * 1000 }));

  // exact bars
  assert.equal(logicalForTime(bars, bars[0].ts), 0);
  assert.equal(logicalForTime(bars, bars[3].ts), 3);

  // between two bars
  assert.equal(logicalForTime(bars, bars[1].ts + 30_000), 1.5, "halfway between bars");

  // past the last bar — this is the case that made drawings disappear
  const beyond = logicalForTime(bars, bars[4].ts + 120_000)!;
  assert.equal(beyond, 6, "two bar-widths past the end");
  assert.notEqual(beyond, null);

  // before the first bar
  assert.equal(logicalForTime(bars, bars[0].ts - 60_000), -1);

  // round trips
  for (const l of [-2, 0, 1.5, 3, 4, 7.25]) {
    const t = timeForLogical(bars, l)!;
    assert.ok(Math.abs(logicalForTime(bars, t)! - l) < 1e-6, `logical ${l} round-trips`);
  }

  assert.equal(logicalForTime([], 5), null);
  assert.equal(timeForLogical([], 5), null);
  assert.equal(logicalForTime([{ ts: 42 }], 99), 0, "a single bar degrades safely");
});

await test("boxes clamp to the plot instead of stretching across it", async () => {
  const { clampSpan } = await import("../src/lib/drawings.ts");
  const W = 1000;

  // fully visible: untouched
  assert.deepEqual(clampSpan(200, 340, W), { x: 200, w: 140 });

  // the reported bug: an anchor extrapolated far off-screen to the left
  const bug = clampSpan(-48000, 260, W);
  assert.equal(bug.x, -2, "starts at the plot edge, not thousands of pixels left");
  assert.equal(bug.w, 262, "and is only as wide as the visible part");

  // off to the right
  const right = clampSpan(900, 99999, W);
  assert.equal(right.x, 900);
  assert.equal(right.w, 102);

  // entirely off-screen collapses rather than painting the whole chart
  assert.equal(clampSpan(-9000, -5000, W).w, 0);
  assert.equal(clampSpan(5000, 9000, W).w, 0);

  // argument order does not matter
  assert.deepEqual(clampSpan(340, 200, W), clampSpan(200, 340, W));
});

console.log(`\n${pass} drawing-geometry checks passed`);
