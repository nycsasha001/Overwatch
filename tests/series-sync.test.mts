import assert from "node:assert/strict";
import { barsBefore, diffBars, formingWindow, joinForming, replayWindow, settledWindow } from "../src/lib/series-sync.ts";
import { bucketStart, ensureAscending, type Candle } from "../src/lib/aggregate.ts";

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

/* --------------------------- the replay window --------------------------- */

/** One-minute bars, the shape the replay buffer holds them in. */
const base = Array.from({ length: 40 }, (_, i) => bar(i));
const FIVE = 5 * M;
const at = (i: number) => t0 + i * M;
/** A settled 5m candle, as the fetched window would hold it. */
const base5 = (i: number): Candle => ({
  ts: t0 + i * M,
  open: base[i].open,
  high: Math.max(...base.slice(i, i + 5).map((b) => b.high)),
  low: Math.min(...base.slice(i, i + 5).map((b) => b.low)),
  close: base[i + 4].close,
});

const window5 = (history: Candle[], cursor: number) =>
  replayWindow({ history, buffer: base, cursor, currentBucket: at(Math.floor(cursor / 5) * 5), tf: "5m", baseTf: "1m" });

ok("the candle the cursor is inside is built only as far as the cursor", () => {
  // Cursor two bars into the 14:40 candle: it holds those two bars and nothing after them.
  const w = window5([], 12);
  assert.equal(w.length, 1);
  assert.equal(w[0].ts, at(10), "stamped at the start of its bucket");
  assert.equal(w[0].close, base[12].close, "closing where the cursor is");
  assert.equal(w[0].high, Math.max(base[10].high, base[11].high, base[12].high));
});

ok("a candle that closed since the window was last brought forward is rebuilt, not left as a hole", () => {
  // The settled window ends at 14:30. The cursor has since moved into 14:40, so 14:35 closed in
  // between and is in neither piece — this is the gap that used to reach the chart.
  const w = window5([base5(0)], 12);
  assert.deepEqual(w.map((c) => c.ts), [at(0), at(5), at(10)], "no hole in front of the last candle");
  const rebuilt = w[1];
  assert.equal(rebuilt.open, base[5].open);
  assert.equal(rebuilt.close, base[9].close, "the whole closed candle, not part of one");
  assert.equal(rebuilt.high, Math.max(...base.slice(5, 10).map((b) => b.high)));
  assert.equal(rebuilt.low, Math.min(...base.slice(5, 10).map((b) => b.low)));
});

ok("more than one candle can have closed, and all of them come back", () => {
  const w = window5([base5(0)], 22);
  assert.deepEqual(w.map((c) => c.ts), [at(0), at(5), at(10), at(15), at(20)]);
});

ok("a window that already reaches the cursor's bucket gains nothing and duplicates nothing", () => {
  const w = window5([base5(0), base5(5)], 12);
  assert.deepEqual(w.map((c) => c.ts), [at(0), at(5), at(10)]);
});

ok("with no settled window at all there is nothing to bridge to", () => {
  // The first paint of a session, before any history has arrived.
  assert.deepEqual(window5([], 7).map((c) => c.ts), [at(5)]);
});

ok("crossing a boundary is an append, and the roll-forward that follows changes nothing", () => {
  /**
   * The three renders a single press produces, in order: the candle finished, the cursor in the
   * next bucket with the window not yet brought forward, and the window brought forward.
   *
   * Both steps have to be cheap. The middle one used to arrive with a hole in it, which matched
   * neither what was drawn nor what came next — so the third render rebuilt every bar in the
   * window, price scale and all. Now the middle render is already right and the third is a no-op.
   */
  const finished = window5([base5(0)], 9);
  const crossed = window5([base5(0)], 14);
  const rolled = window5([base5(0), base5(5)], 14);

  for (let i = 1; i < crossed.length; i++) {
    assert.equal(crossed[i].ts - crossed[i - 1].ts, FIVE, "evenly spaced, with nothing missing");
  }
  assert.equal(diffBars(finished, crossed).kind, "append", "the new candle is appended");
  assert.equal(diffBars(crossed, rolled).kind, "none", "and the roll-forward redraws nothing");
});

ok("stepping inside a candle only ever touches that candle", () => {
  let drawn = window5([base5(0)], 10);
  for (let cursor = 11; cursor <= 14; cursor++) {
    const next = window5([base5(0)], cursor);
    const patch = diffBars(drawn, next);
    assert.equal(patch.kind, "append", `step to ${cursor} rebuilt the series`);
    assert.equal((patch as { from: number }).from, next.length - 1, "and only the forming candle moved");
    drawn = next;
  }
});

/* ---------------------- the split that keeps a step cheap ------------------- */

/**
 * A step must not rebuild the window behind it.
 *
 * The settled part of the window is anchored on the bucket rather than the cursor, so stepping
 * through a candle reuses it rather than filtering and re-concatenating every bar on the chart.
 * These check that the cheap path gives exactly what the single-pass one did, and that it really
 * is being reused rather than quietly rebuilt.
 */
const stepped = (history: Candle[], buffer: Candle[], cursor: number) => {
  const currentBucket = bucketStart(buffer[cursor].ts, "5m");
  const hist = barsBefore(history, currentBucket);
  const settled = settledWindow({ history: hist, buffer, currentBucket, tf: "5m", baseTf: "1m" });
  const forming = formingWindow({ buffer, cursor, currentBucket, tf: "5m", baseTf: "1m" });
  return { settled, joined: joinForming(settled, forming), currentBucket, hist };
};

ok("settled plus forming is exactly what one pass produced", () => {
  const history = run(400);
  const buffer = Array.from({ length: 120 }, (_, i) => bar(400 + i));
  for (let cursor = 3; cursor < 120; cursor++) {
    const { joined, currentBucket, hist } = stepped(history, buffer, cursor);
    assert.deepEqual(
      joined,
      replayWindow({ history: hist, buffer, cursor, currentBucket, tf: "5m", baseTf: "1m" }),
      `the split disagreed with the single pass at cursor ${cursor}`
    );
  }
});

ok("the settled window is reused, not rebuilt, while a candle forms", () => {
  const history = run(400);
  const buffer = Array.from({ length: 120 }, (_, i) => bar(400 + i));
  const first = stepped(history, buffer, 10);
  for (let cursor = 11; cursor <= 14; cursor++) {
    const next = stepped(history, buffer, cursor);
    assert.equal(next.currentBucket, first.currentBucket, "still inside the same candle");
    assert.deepEqual(next.settled, first.settled, "the settled window moved mid-candle");
  }
});

ok("history already behind the cursor is handed back without copying", () => {
  // The common case every step: nothing to drop, so nothing should be rebuilt.
  const history = run(400);
  assert.equal(barsBefore(history, history[399].ts + M), history, "a needless copy was made");
  assert.equal(barsBefore(history, history[200].ts).length, 200, "and it still trims when it must");
  assert.deepEqual(barsBefore(history, history[200].ts), history.slice(0, 200));
  assert.deepEqual(barsBefore([], 0), []);
});

ok("bars already in order are handed back without copying", () => {
  const bars = run(600);
  assert.equal(ensureAscending(bars), bars, "an ordered window was copied for nothing");
  const dupe = [...bars.slice(0, 10), { ...bar(9), close: 42 }];
  assert.equal(ensureAscending(dupe).length, 10, "a repeated timestamp still collapses");
  assert.equal(ensureAscending(dupe)[9].close, 42, "and the newer version wins");
});

console.log(`\n${checks} series-sync checks passed`);
