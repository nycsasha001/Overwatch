import assert from "node:assert/strict";
import { diffBars } from "../src/lib/series-sync.ts";
import type { Candle } from "../src/lib/aggregate.ts";

let checks = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  checks++;
  console.log(`  ok  ${name}`);
};

const M = 60_000;
const t0 = Date.UTC(2026, 0, 5, 14, 30);
const bar = (i: number, close = 100 + i): Candle => ({
  ts: t0 + i * M,
  open: 100 + i,
  high: 101 + i,
  low: 99 + i,
  close,
});
const run = (n: number) => Array.from({ length: n }, (_, i) => bar(i));

ok("an unchanged series is left completely alone", () => {
  const bars = run(600);
  assert.deepEqual(diffBars(bars, [...bars]), { kind: "none" });
});

ok("one candle appended is an append, not a rebuild", () => {
  // The whole point: a replay step must not re-ingest six hundred bars.
  const prev = run(600);
  const next = [...prev, bar(600)];
  assert.deepEqual(diffBars(prev, next), { kind: "append", from: 599 });
});

ok("the forming candle moving is an append", () => {
  // Its high, low and close change as the cursor advances through it.
  const prev = run(600);
  const next = [...prev.slice(0, 599), { ...bar(599), high: 999, close: 998 }];
  assert.deepEqual(diffBars(prev, next), { kind: "append", from: 599 });
});

ok("the forming candle closing and a new one opening is one append", () => {
  const prev = run(600);
  const next = [...prev.slice(0, 599), { ...bar(599), close: 555 }, bar(600)];
  const patch = diffBars(prev, next);
  assert.deepEqual(patch, { kind: "append", from: 599 });
  // Both the settled candle and the new one get written, in ascending order — update() rejects
  // anything earlier than the last bar it holds.
  assert.ok(next[599].ts < next[600].ts);
});

ok("a window that slid forward is a replace", () => {
  // This is what the refetch used to produce on every press, and why append never fired.
  const all = run(602);
  assert.deepEqual(diffBars(all.slice(0, 600), all.slice(1, 601)), { kind: "replace" });
});

ok("a bar changing behind the last one is a replace, never an append", () => {
  // An append here would leave the chart quietly showing a candle that no longer exists. Being
  // wrong in this direction is far worse than an unnecessary rebuild.
  const prev = run(600);
  for (const i of [0, 1, 299, 598]) {
    const next = prev.map((c, j) => (j === i ? { ...c, close: c.close + 7 } : c));
    assert.deepEqual(diffBars(prev, next), { kind: "replace" }, `bar ${i} moved`);
  }
});

ok("a last bar that moves backwards is a replace, not an append", () => {
  // The crash: stepping back through a replay leaves the count and every earlier bar identical,
  // but returns the forming candle to an earlier bucket. update() throws rather than rewriting
  // history, so this must never be reported as an append.
  const prev = run(600);
  const next = [...prev.slice(0, 599), { ...bar(599), ts: prev[598].ts + 1 }];
  assert.equal(next.length, prev.length);
  assert.deepEqual(diffBars(prev, next), { kind: "replace" });

  // Forward or level is still an append — the forming candle updating in place is the common case.
  const same = [...prev.slice(0, 599), { ...bar(599), close: 1234 }];
  assert.deepEqual(diffBars(prev, same), { kind: "append", from: 599 });
});

ok("a shorter series is a replace, since update cannot remove bars", () => {
  const prev = run(600);
  assert.deepEqual(diffBars(prev, prev.slice(0, 500)), { kind: "replace" });
  assert.deepEqual(diffBars(prev, prev.slice(0, 599)), { kind: "replace" });
});

ok("a different instrument or timeframe is a replace", () => {
  const prev = run(600);
  const shifted = prev.map((c) => ({ ...c, ts: c.ts + 5 * M }));
  assert.deepEqual(diffBars(prev, shifted), { kind: "replace" });
});

ok("empty on either side is handled without a rebuild of nothing", () => {
  assert.deepEqual(diffBars([], []), { kind: "none" }, "nothing to nothing does nothing");
  assert.deepEqual(diffBars([], run(10)), { kind: "replace" }, "first paint");
  assert.deepEqual(diffBars(run(10), []), { kind: "replace" }, "cleared");
});

ok("a long forward walk stays on the append path the whole way", () => {
  // Five hundred steps of an anchored window: the chart should rebuild exactly once, on first
  // paint, and append every time after that.
  let drawn: Candle[] = [];
  let replaces = 0;
  let appends = 0;

  for (let n = 1; n <= 500; n++) {
    const next = run(n);
    const patch = diffBars(drawn, next);
    if (patch.kind === "replace") replaces++;
    else if (patch.kind === "append") appends++;
    drawn = next;
  }

  assert.equal(replaces, 1, "one rebuild, on the first paint");
  assert.equal(appends, 499, "and an append for every step after it");
});

console.log(`\n${checks} series-sync checks passed`);
