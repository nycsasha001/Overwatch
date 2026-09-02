import assert from "node:assert/strict";
import { DEFAULT_FVG, DEFAULT_SESSIONS, fairValueGaps, inWindow, po3Candles, sessionLevels } from "../src/lib/indicators.ts";

let pass = 0;
const test = async (n: string, f: () => void | Promise<void>) => {
  try { await f(); pass++; console.log(`  ok  ${n}`); }
  catch (e) { console.error(`  FAIL ${n}\n       ${(e as Error).message}`); process.exitCode = 1; }
};

const bar = (ts: number, o: number, h: number, l: number, c: number) => ({ ts, open: o, high: h, low: l, close: c, volume: 1 });
const M = 60000;
const t0 = Date.parse("2026-07-16T13:30:00Z"); // 09:30 ET

await test("a bullish FVG is the gap between candle 1's high and candle 3's low", () => {
  const bars = [
    bar(t0, 100, 102, 99, 101),
    bar(t0 + M, 101, 108, 101, 107),
    bar(t0 + 2 * M, 107, 110, 105, 109), // low 105 > high 102 → gap 102–105
  ];
  const { boxes } = fairValueGaps(bars, { ...DEFAULT_FVG, hideFilled: false });
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0].bottom, 102);
  assert.equal(boxes[0].top, 105);
  assert.equal(boxes[0].label, "FVG");
  assert.equal(boxes[0].from, t0, "anchored to the first candle of the three");
});

await test("a bearish FVG mirrors it", () => {
  const bars = [
    bar(t0, 110, 111, 108, 109),
    bar(t0 + M, 109, 109, 102, 103),
    bar(t0 + 2 * M, 103, 105, 100, 101), // high 105 < low 108 → gap 105–108
  ];
  const { boxes } = fairValueGaps(bars, { ...DEFAULT_FVG, hideFilled: false });
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0].bottom, 105);
  assert.equal(boxes[0].top, 108);
});

await test("overlapping candles produce no gap", () => {
  const bars = [bar(t0, 100, 105, 99, 104), bar(t0 + M, 104, 108, 103, 107), bar(t0 + 2 * M, 107, 109, 104, 108)];
  assert.equal(fairValueGaps(bars, DEFAULT_FVG).boxes.length, 0);
});

await test("a filled gap is hidden, and an inverted one is relabelled", () => {
  const base = [
    bar(t0, 100, 102, 99, 101),
    bar(t0 + M, 101, 108, 101, 107),
    bar(t0 + 2 * M, 107, 110, 105, 109),
  ];
  // a tap inside the gap does not count as filled — the gap is still live
  const tapped = [...base, bar(t0 + 3 * M, 109, 109, 103, 106)];
  assert.equal(fairValueGaps(tapped, { ...DEFAULT_FVG, hideFilled: true }).boxes.length, 1, "a partial tap keeps it");

  // price trades through the far edge → fully filled
  const filled = [...base, bar(t0 + 3 * M, 109, 109, 101, 106)];
  assert.equal(fairValueGaps(filled, { ...DEFAULT_FVG, hideFilled: true }).boxes.length, 0, "filled gaps hide");
  assert.equal(fairValueGaps(filled, { ...DEFAULT_FVG, hideFilled: false }).boxes.length, 1);

  // price closes below the gap entirely → inverse FVG
  const inverted = [...base, bar(t0 + 3 * M, 109, 109, 100, 101)];
  const shown = fairValueGaps(inverted, { ...DEFAULT_FVG, hideFilled: true, showInverse: true }).boxes;
  assert.equal(shown.length, 1);
  assert.equal(shown[0].label, "iFVG", "it survives as an inverse gap");
  assert.equal(fairValueGaps(inverted, { ...DEFAULT_FVG, showInverse: false }).boxes.length, 0);
});

await test("session windows are read in the configured timezone", () => {
  const [asia, london, ny] = DEFAULT_SESSIONS.windows; // 00-09, 09-14, 14-23 Brussels
  const tz = DEFAULT_SESSIONS.timezone;

  // Brussels is UTC+2 in July
  assert.equal(inWindow(Date.parse("2026-07-16T04:00:00Z"), asia, tz), true, "06:00 Brussels is Asia");
  assert.equal(inWindow(Date.parse("2026-07-16T09:00:00Z"), asia, tz), false, "11:00 Brussels is not");
  assert.equal(inWindow(Date.parse("2026-07-16T09:00:00Z"), london, tz), true, "11:00 Brussels is London");
  assert.equal(inWindow(Date.parse("2026-07-16T14:00:00Z"), ny, tz), true, "16:00 Brussels is NY");
  assert.equal(inWindow(Date.parse("2026-07-16T22:00:00Z"), ny, tz), false, "00:00 Brussels is not");

  // the same instants in New York terms land differently, proving the zone is honoured
  assert.equal(inWindow(Date.parse("2026-07-16T04:00:00Z"), asia, "America/New_York"), true, "00:00 ET");
  assert.equal(inWindow(Date.parse("2026-07-16T09:00:00Z"), asia, "America/New_York"), true, "05:00 ET is still Asia there");
});

await test("session levels take the extreme of the window and stop when swept", () => {
  // London session in Brussels terms: 09:00–14:00 local = 07:00–12:00Z in July
  const s0 = Date.parse("2026-07-16T08:00:00Z");
  const bars = [
    bar(s0, 100, 106, 99, 104),
    bar(s0 + M, 104, 105, 98, 100),
    bar(s0 + 2 * M, 100, 103, 97, 102),
    bar(Date.parse("2026-07-16T14:30:00Z"), 102, 110, 101, 109), // NY hours, sweeps the high
  ];
  const windows = DEFAULT_SESSIONS.windows.map((w) => ({ ...w, enabled: w.name === "London" }));
  const { levels } = sessionLevels(bars, { ...DEFAULT_SESSIONS, windows });
  const high = levels.find((l) => l.label?.endsWith("High"))!;
  const low = levels.find((l) => l.label?.endsWith("Low"))!;
  assert.equal(high.price, 106, "highest high in the window");
  assert.equal(low.price, 97, "lowest low in the window");
  assert.equal(high.from, s0, "the line starts at the candle that made the high");
  assert.equal(low.from, s0 + 2 * M, "and the low at the candle that made the low");
  assert.equal(high.swept, true, "the high was taken");
  assert.notEqual(high.to, Infinity, "so its ray stops");
  assert.equal(low.swept, false);
  // An untouched level runs to the most recent candle, not past it. It used to run to Infinity,
  // which drew a line across empty chart claiming a level in a future there is no data for.
  assert.notEqual(low.to, Infinity, "and neither runs off the end of the chart");
});

await test("a session level ends at the last candle, not at the edge of the chart", () => {
  // Nothing extends to Infinity any more: a line running past the final bar claims the level
  // exists in a future the chart has no information about.
  const bars = [
    ...Array.from({ length: 40 }, (_, i) => bar(t0 + i * M, 100, 105, 95, 100)),
  ];
  const { levels } = sessionLevels(bars, {
    ...DEFAULT_SESSIONS,
    windows: [{ name: "Test", start: 0, end: 24 * 60, color: "#fff", enabled: true }],
  });
  assert.ok(levels.length > 0, "levels were produced");
  const last = bars[bars.length - 1].ts;
  for (const l of levels) {
    assert.notEqual(l.to, Infinity, `${l.label} still runs forever`);
    assert.ok(l.to <= last, `${l.label} ends past the last candle`);
  }
});

await test("a swept level stops at the candle that swept it and changes nothing else", () => {
  // A sweep is only looked for after the session closes, so the window has to actually end —
  // an all-day window can never be swept, which is correct and was worth finding out.
  const d0 = Date.UTC(2026, 0, 5, 0, 0);
  const at = (i: number) => d0 + i * M;
  const session = Array.from({ length: 60 }, (_, i) => bar(at(i), 100, 105, 95, 100));
  const quiet = Array.from({ length: 20 }, (_, i) => bar(at(60 + i), 100, 103, 98, 100));
  const sweep = bar(at(80), 100, 110, 99, 108); // trades through the 105 high
  const after = Array.from({ length: 20 }, (_, i) => bar(at(81 + i), 108, 112, 106, 110));
  const bars = [...session, ...quiet, sweep, ...after];

  const windows = [{ name: "Test", start: 0, end: 60, color: "#abcdef", enabled: true }];
  const opts = { ...DEFAULT_SESSIONS, timezone: "UTC", windows, stopAtSweep: true };
  const high = sessionLevels(bars, opts).levels.find((l) => l.label?.includes("High"));
  assert.ok(high, "a session high was produced");

  assert.equal(high!.swept, true, "it was swept");
  assert.equal(high!.to, sweep.ts, "and it ends exactly at the candle that swept it");
  assert.ok(high!.to < bars[bars.length - 1].ts, "not at the end of the data");
  // Nothing else about it changes: the ending carries the meaning, not a restyle.
  assert.equal(high!.color, "#abcdef");
  assert.equal(high!.dashed, undefined, "a sweep does not make it dashed");

  // Left running, it still stops at the last candle rather than at the edge of the screen.
  const kept = sessionLevels(bars, { ...opts, stopAtSweep: false }).levels.find((l) => l.label?.includes("High"));
  assert.equal(kept!.swept, false);
  assert.equal(kept!.to, bars[bars.length - 1].ts);
});

await test("PO3 rolls the base bars into higher-timeframe candles", () => {
  const bars = Array.from({ length: 150 }, (_, i) => bar(t0 + i * M, 100 + i, 101 + i, 99 + i, 100.5 + i));
  const candles = po3Candles(bars, "1m", { timeframe: "1h", count: 4, offset: 13, width: 2, color: "#fff" });
  assert.ok(candles.length > 1 && candles.length <= 4);
  const last = candles[candles.length - 1];
  assert.equal(last.complete, false, "the candle in progress is marked incomplete");
  assert.equal(candles[0].complete, true);
  assert.equal(last.close, bars[bars.length - 1].close, "it closes at the latest price");
});

await test("FVG extension length is configurable", async () => {
  const bars = [
    bar(t0, 100, 102, 99, 101),
    bar(t0 + M, 101, 108, 101, 107),
    bar(t0 + 2 * M, 107, 110, 105, 109),
    ...Array.from({ length: 20 }, (_, i) => bar(t0 + (3 + i) * M, 109, 112, 106, 110)),
  ];

  const full = fairValueGaps(bars, { ...DEFAULT_FVG, hideFilled: false, extendBars: 0 }).boxes[0];
  assert.equal(full.to, Infinity, "zero runs it to the edge");

  const short = fairValueGaps(bars, { ...DEFAULT_FVG, hideFilled: false, extendBars: 5 }).boxes[0];
  assert.equal(short.to, t0 + 2 * M + 5 * M, "five bars past the third candle");

  const long = fairValueGaps(bars, { ...DEFAULT_FVG, hideFilled: false, extendBars: 50 }).boxes[0];
  assert.equal(long.to, t0 + 2 * M + 50 * M, "projects beyond the last bar rather than stopping at it");
  assert.ok(long.to > bars[bars.length - 1].ts);
});

await test("a fixed extension does not move as candles are added", () => {
  // The replay bug: stepping forward re-ran the indicator over a longer window, and the box's
  // right edge shifted every press. It has to be pinned in bar space, not to whatever the chart
  // currently happens to be showing.
  const history = [
    bar(t0, 100, 102, 99, 101),
    bar(t0 + M, 101, 108, 101, 107),
    bar(t0 + 2 * M, 107, 110, 105, 109),
  ];
  const opts = { ...DEFAULT_FVG, hideFilled: false, extendBars: 10 };

  const edges: number[] = [];
  for (let n = 1; n <= 30; n++) {
    const bars = [...history, ...Array.from({ length: n }, (_, i) => bar(t0 + (3 + i) * M, 109, 112, 106, 110))];
    edges.push(fairValueGaps(bars, opts).boxes[0].to);
  }
  assert.equal(new Set(edges).size, 1, "the right edge is identical at every step");

  // And "to the edge" is still available, still meaning exactly that.
  const open = fairValueGaps([...history, bar(t0 + 3 * M, 109, 112, 106, 110)], { ...opts, extendBars: 0 });
  assert.equal(open.boxes[0].to, Infinity);
});

await test("PO3 can show a single candle", () => {
  const bars = Array.from({ length: 150 }, (_, i) => bar(t0 + i * M, 100 + i, 101 + i, 99 + i, 100.5 + i));
  const one = po3Candles(bars, "1m", { timeframe: "1h", count: 1, offset: 13, width: 2, color: "#fff" });
  assert.equal(one.length, 1);
  assert.equal(one[0].complete, false, "the single candle is the one in progress");
});

console.log(`\n${pass} indicator checks passed`);
