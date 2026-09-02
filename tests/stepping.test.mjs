// The stepping helpers must land on candle boundaries and move N candles in ONE calculation.
import assert from "node:assert/strict";
import { bucketStart } from "../src/lib/aggregate.ts";

const bars = [];
const start = Date.parse("2026-07-16T13:07:00Z"); // mid-hour on purpose
for (let i = 0; i < 900; i++) bars.push({ ts: start + i * 60000 });

function advanceCandles(from, count, tf, stepBars) {
  if (stepBars <= 1) return Math.min(from + count, bars.length - 1);
  let idx = from;
  for (let n = 0; n < count; n++) {
    const here = bars[idx];
    if (!here) break;
    const bucket = bucketStart(here.ts, tf);
    let i = idx + 1;
    while (i < bars.length && bucketStart(bars[i].ts, tf) === bucket) i++;
    if (i - 1 > idx) { idx = i - 1; continue; }
    if (i >= bars.length) break;
    const next = bucketStart(bars[i].ts, tf);
    let j = i + 1;
    while (j < bars.length && bucketStart(bars[j].ts, tf) === next) j++;
    idx = Math.min(j - 1, bars.length - 1);
  }
  return idx;
}

const at = (i) => new Date(bars[i].ts).toISOString().slice(11, 16);

// one candle at a time
let c = 0;
c = advanceCandles(c, 1, "1h", 60); assert.equal(at(c), "13:59");
c = advanceCandles(c, 1, "1h", 60); assert.equal(at(c), "14:59");

// ten candles in a single call — the bug was that this only moved one
const ten = advanceCandles(0, 10, "1h", 60);
assert.equal(at(ten), "22:59", "ten hourly candles from 13:07 ends at 22:59");
let repeated = 0;
for (let i = 0; i < 10; i++) repeated = advanceCandles(repeated, 1, "1h", 60);
assert.equal(repeated, ten, "ten single steps equal one ten-step jump");

// 15m behaves the same: from 13:07 the first press closes 13:14, then 13:29, 13:44, 13:59, 14:14, 14:29
assert.equal(at(advanceCandles(0, 4, "15m", 15)), "13:59");
assert.equal(at(advanceCandles(0, 6, "15m", 15)), "14:29");

// a 1m step interval is a plain bar count
assert.equal(advanceCandles(5, 10, "1m", 1), 15);

// never runs past the end of the buffer
assert.equal(advanceCandles(bars.length - 2, 50, "1h", 60), bars.length - 1);

console.log("stepping helper: 7 checks passed");

// Picking a bar must start the replay before it — that candle has not printed yet.
{
  const seq = [10, 20, 30, 40, 50].map((n) => ({ ts: n }));
  const pick = (ts, exclusive) => {
    const found = seq.findIndex((b) => b.ts >= ts);
    return exclusive ? found - 1 : found;
  };
  assert.equal(pick(30, false), 2, "inclusive lands on the clicked bar");
  assert.equal(pick(30, true), 1, "exclusive lands on the one before it");
  assert.equal(seq[pick(30, true)].ts, 20);
  assert.equal(pick(10, true), -1, "clicking the very first bar has nothing before it");
  console.log("select-bar exclusivity: 4 checks passed");
}
