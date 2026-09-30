import assert from "node:assert/strict";
import { FRAME, barIndexAt, tradeFrame } from "../src/lib/trade-frame.ts";

let pass = 0;
const test = async (n: string, f: () => void | Promise<void>) => {
  try { await f(); pass++; console.log(`  ok  ${n}`); }
  catch (e) { console.error(`  FAIL ${n}\n       ${(e as Error).message}`); process.exitCode = 1; }
};

const MIN = 60_000;
/** One-minute bars whose middle price is `mid(i)`, a point either side. */
const series = (n: number, mid: (i: number) => number) =>
  Array.from({ length: n }, (_, i) => ({ ts: i * MIN, high: mid(i) + 1, low: mid(i) - 1 }));
const flat = series(600, () => 100);

await test("a timestamp belongs to the bar it falls inside", () => {
  const bars = series(10, () => 100);
  assert.equal(barIndexAt(bars, 0), 0);
  assert.equal(barIndexAt(bars, 3 * MIN), 3, "on the open");
  assert.equal(barIndexAt(bars, 3 * MIN + 59_999), 3, "anywhere up to the next one");
  assert.equal(barIndexAt(bars, 99 * MIN), 9, "past the end: the last bar");
  assert.equal(barIndexAt(bars, -1), -1, "before the first");
});

await test("with nothing to find, a hundred bars before and fifteen after", () => {
  const f = tradeFrame({ bars: flat, entryTs: 300 * MIN, exitTs: 305 * MIN, direction: "long" })!;
  assert.equal(f.first, 300 - FRAME.minBefore);
  assert.equal(f.last, 305 + FRAME.minAfter);
});

await test("the time after the exit grows with the trade, within bounds", () => {
  const after = (bars: number) => tradeFrame({ bars: flat, entryTs: 200 * MIN, exitTs: (200 + bars) * MIN, direction: "long" })!.last - (200 + bars);
  assert.equal(after(5), 15, "a quick trade still gets the follow-through");
  assert.equal(after(50), 30, "three fifths of the trade's own length");
  assert.equal(after(200), 45, "but never so long that the trade is crowded out");
});

await test("a long reaches back to where the selloff it faded began", () => {
  // Flat at 150 until bar 200, sold off to a low at bar 330, then rallied into a long at 350.
  const mid = (i: number) => (i < 200 ? 150 : i <= 330 ? 200 - ((i - 200) * 100) / 130 : 100 + (i - 330));
  const bars = series(500, mid);
  const f = tradeFrame({ bars, entryTs: 350 * MIN, exitTs: 360 * MIN, direction: "long" })!;
  assert.equal(f.first, 200 - FRAME.pad, "the top of the leg is in the picture, with room before it");
  assert.ok(f.first < 350 - FRAME.minBefore, "further back than the floor alone would go");
});

await test("a short does the same the other way up", () => {
  // Flat at 150 until bar 200, rallied to a high at bar 330, then sold into a short at 350.
  const mid = (i: number) => (i < 200 ? 150 : i <= 330 ? 100 + ((i - 200) * 100) / 130 : 200 - (i - 330));
  const bars = series(500, mid);
  const f = tradeFrame({ bars, entryTs: 350 * MIN, exitTs: 360 * MIN, direction: "short" })!;
  assert.equal(f.first, 200 - FRAME.pad, "the bottom of the rally is in the picture");
});

await test("a leg shorter than the floor leaves the floor in charge", () => {
  // A brief dip ten bars before the entry, inside the hundred bars shown anyway.
  const mid = (i: number) => (i >= 330 && i <= 340 ? 90 : 100);
  const f = tradeFrame({ bars: series(500, mid), entryTs: 350 * MIN, exitTs: 355 * MIN, direction: "long" })!;
  assert.equal(f.first, 350 - FRAME.minBefore);
});

await test("a long trade shows twice its length before it, up to the cap", () => {
  const f = tradeFrame({ bars: flat, entryTs: 350 * MIN, exitTs: 550 * MIN, direction: "long" })!;
  assert.equal(f.first, 350 - FRAME.maxBefore, "two hundred bars long would ask for four hundred before");
});

await test("the frame stops where the bars do", () => {
  const early = tradeFrame({ bars: flat, entryTs: 20 * MIN, exitTs: 25 * MIN, direction: "long" })!;
  assert.equal(early.first, 0, "nothing stored before the start");
  const late = tradeFrame({ bars: flat, entryTs: 590 * MIN, exitTs: 595 * MIN, direction: "short" })!;
  assert.equal(late.last, 599, "nothing stored after the end");
  assert.equal(tradeFrame({ bars: [], entryTs: 0, exitTs: 0, direction: "long" }), null);
});

console.log(`\n${pass} trade-frame checks passed`);
