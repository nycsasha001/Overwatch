import assert from "node:assert/strict";
import { etDateTime, etParts, etToUtc, fourHourOpen, isClosed, sessionOpen, tradeInstant, tradingDay, weekOpen } from "../src/lib/session.ts";
import { aggregate, bucketStart, type Candle } from "../src/lib/aggregate.ts";

let pass = 0;
const test = (name: string, fn: () => void) => {
  try {
    fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}\n       ${(e as Error).message}`);
    process.exitCode = 1;
  }
};

const utc = (s: string) => Date.parse(s);
const iso = (ms: number) => new Date(ms).toISOString();

test("ET wall clock and DST offset", () => {
  // 2026: DST runs Mar 8 → Nov 1.
  assert.equal(etParts(utc("2026-01-15T18:00:00Z")).hour, 13); // EST, UTC-5
  assert.equal(etParts(utc("2026-07-15T18:00:00Z")).hour, 14); // EDT, UTC-4
});

test("etToUtc round-trips across DST", () => {
  assert.equal(iso(etToUtc(2026, 1, 15, 18, 0)), "2026-01-15T23:00:00.000Z"); // EST
  assert.equal(iso(etToUtc(2026, 7, 15, 18, 0)), "2026-07-15T22:00:00.000Z"); // EDT
});

test("trading day rolls at 18:00 ET", () => {
  assert.equal(tradingDay(utc("2026-07-15T21:59:00Z")), "2026-07-15"); // 17:59 ET
  assert.equal(tradingDay(utc("2026-07-15T22:00:00Z")), "2026-07-16"); // 18:00 ET → next session
  assert.equal(tradingDay(utc("2026-07-16T13:30:00Z")), "2026-07-16"); // 09:30 ET
});

test("Sunday 18:00 ET open belongs to Monday", () => {
  // Sunday 2026-07-12 18:00 EDT = 22:00Z
  assert.equal(tradingDay(utc("2026-07-12T22:00:00Z")), "2026-07-13");
  assert.equal(iso(sessionOpen("2026-07-13")), "2026-07-12T22:00:00.000Z");
});

test("session open shifts correctly across the DST change", () => {
  assert.equal(iso(sessionOpen("2026-03-06")), "2026-03-05T23:00:00.000Z"); // EST
  assert.equal(iso(sessionOpen("2026-03-10")), "2026-03-09T22:00:00.000Z"); // EDT
});

test("4H blocks anchor to the 18:00 ET open", () => {
  const open = sessionOpen("2026-07-16"); // 2026-07-15T22:00Z
  assert.equal(fourHourOpen(open), open);
  assert.equal(fourHourOpen(open + 3 * 3600000), open);
  assert.equal(fourHourOpen(open + 4 * 3600000), open + 4 * 3600000);
  // 09:30 ET is 15.5h into the session → the 10:00 ET block is the 4th (index 3)
  assert.equal(iso(fourHourOpen(utc("2026-07-16T13:30:00Z"))), iso(open + 12 * 3600000));
  // the final block is short (14:00–17:00 ET) and must not spill into a 7th
  assert.equal(iso(fourHourOpen(utc("2026-07-16T20:59:00Z"))), iso(open + 20 * 3600000));
});

test("week opens on Sunday 18:00 ET", () => {
  const expected = sessionOpen("2026-07-13"); // Sunday 2026-07-12 22:00Z
  assert.equal(iso(weekOpen(utc("2026-07-16T13:30:00Z"))), iso(expected)); // Thursday
  assert.equal(iso(weekOpen(utc("2026-07-13T02:00:00Z"))), iso(expected)); // Sunday evening
  assert.notEqual(iso(weekOpen(utc("2026-07-20T13:30:00Z"))), iso(expected)); // next week
});

test("closed periods", () => {
  assert.equal(isClosed(utc("2026-07-16T21:30:00Z")), true); // 17:30 ET break
  assert.equal(isClosed(utc("2026-07-18T16:00:00Z")), true); // Saturday
  assert.equal(isClosed(utc("2026-07-16T13:30:00Z")), false); // NY session
});

test("intraday buckets align to the hour", () => {
  const t = utc("2026-07-16T13:37:00Z");
  assert.equal(iso(bucketStart(t, "5m")), "2026-07-16T13:35:00.000Z");
  assert.equal(iso(bucketStart(t, "4m")), "2026-07-16T13:36:00.000Z");
  assert.equal(iso(bucketStart(t, "15m")), "2026-07-16T13:30:00.000Z");
  assert.equal(iso(bucketStart(t, "1h")), "2026-07-16T13:00:00.000Z");
});

const bars = (startIso: string, n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const ts = utc(startIso) + i * 60000;
    const base = 21000 + i;
    return { ts, open: base, high: base + 2, low: base - 2, close: base + 1, volume: 10 };
  });

test("aggregation preserves OHLCV correctly", () => {
  const b = bars("2026-07-16T13:30:00Z", 5);
  const five = aggregate(b, "5m");
  assert.equal(five.length, 1);
  assert.equal(five[0].open, b[0].open);
  assert.equal(five[0].close, b[4].close);
  assert.equal(five[0].high, Math.max(...b.map((x) => x.high)));
  assert.equal(five[0].low, Math.min(...b.map((x) => x.low)));
  assert.equal(five[0].volume, 50);
});

test("daily aggregation splits on the 18:00 ET boundary, not midnight", () => {
  // 17:58 ET → 18:01 ET spans the session change
  const b = [...bars("2026-07-16T21:58:00Z", 2), ...bars("2026-07-16T22:00:00Z", 2)];
  const daily = aggregate(b, "1d");
  assert.equal(daily.length, 2, "must produce two trading days");
  assert.equal(iso(daily[0].ts), iso(sessionOpen("2026-07-16")));
  assert.equal(iso(daily[1].ts), iso(sessionOpen("2026-07-17")));
  // and midnight UTC must NOT split a session
  const overnight = [...bars("2026-07-16T23:58:00Z", 2), ...bars("2026-07-17T00:00:00Z", 2)];
  assert.equal(aggregate(overnight, "1d").length, 1, "midnight UTC must not start a new day");
});

test("weekly aggregation covers Sunday open to Friday close", () => {
  const week = [...bars("2026-07-12T22:00:00Z", 1), ...bars("2026-07-16T13:30:00Z", 1), ...bars("2026-07-17T20:59:00Z", 1)];
  assert.equal(aggregate(week, "1w").length, 1);
  const next = [...week, ...bars("2026-07-19T22:00:00Z", 1)];
  assert.equal(aggregate(next, "1w").length, 2);
});


/* ------------------------- sub-minute aggregation ------------------------- */

test("30s bars build from 1s bars", async () => {
  const { aggregate } = await import("../src/lib/aggregate.ts");
  const oneSec = Array.from({ length: 90 }, (_, i) => ({
    ts: utc("2026-07-16T13:30:00Z") + i * 1000,
    open: 100 + i,
    high: 100 + i + 1,
    low: 100 + i - 1,
    close: 100 + i + 0.5,
    volume: 1,
  }));
  const half = aggregate(oneSec, "30s", "1s");
  assert.equal(half.length, 3, "90 seconds is three 30s bars");
  assert.equal(half[0].open, oneSec[0].open);
  assert.equal(half[0].close, oneSec[29].close);
  assert.equal(half[0].volume, 30);
  assert.equal(iso(half[1].ts), "2026-07-16T13:30:30.000Z");
});

test("1s and 30s bucket boundaries", async () => {
  const { bucketStart } = await import("../src/lib/aggregate.ts");
  assert.equal(iso(bucketStart(utc("2026-07-16T13:30:47.900Z"), "1s")), "2026-07-16T13:30:47.000Z");
  assert.equal(iso(bucketStart(utc("2026-07-16T13:30:47.900Z"), "30s")), "2026-07-16T13:30:30.000Z");
  assert.equal(iso(bucketStart(utc("2026-07-16T13:30:12.000Z"), "30s")), "2026-07-16T13:30:00.000Z");
});

test("30s bars roll up into minutes correctly", async () => {
  const { aggregate } = await import("../src/lib/aggregate.ts");
  const halves = Array.from({ length: 4 }, (_, i) => ({
    ts: utc("2026-07-16T13:30:00Z") + i * 30000,
    open: 100 + i, high: 105 + i, low: 95 + i, close: 102 + i, volume: 5,
  }));
  const mins = aggregate(halves, "1m", "30s");
  assert.equal(mins.length, 2);
  assert.equal(mins[0].open, 100);
  assert.equal(mins[0].close, 103);
  assert.equal(mins[0].high, 106);
  assert.equal(mins[0].low, 95);
  assert.equal(mins[0].volume, 10);
});


/* --------------------------- ordering guarantees -------------------------- */

test("ensureAscending drops the stale-history race that crashed the chart", async () => {
  const { ensureAscending } = await import("../src/lib/aggregate.ts");
  const bar = (ts: number, close = 1) => ({ ts, open: 1, high: 2, low: 0, close, volume: 1 });

  // the exact shape of the reported crash: history from a later position, then an older live bar
  const stale = [bar(1761695700000), bar(1761626100000)];
  const fixed = ensureAscending(stale);
  assert.equal(fixed.length, 1, "the out-of-order bar is dropped, not passed to the chart");

  assert.deepEqual(
    ensureAscending([bar(1), bar(2), bar(3)]).map((b) => b.ts),
    [1, 2, 3],
    "already ordered data is untouched"
  );

  // a rebuilt bucket replaces the previous version rather than duplicating it
  const rebuilt = ensureAscending([bar(1), bar(2, 10), bar(2, 20)]);
  assert.equal(rebuilt.length, 2);
  assert.equal(rebuilt[1].close, 20, "the newer version of the same bucket wins");

  assert.deepEqual(ensureAscending([]).length, 0);
});

test("jumping to a date and time lands on that New York wall clock", () => {
  // The replay jump reads the menu's date and time. Both have to come back unchanged, or the
  // session starts somewhere other than where it was asked to.
  for (const [date, time] of [
    ["2022-04-04", "09:30"],  // EDT, -4
    ["2022-01-12", "09:30"],  // EST, -5
    ["2022-04-04", "00:00"],  // midnight, the value most likely to slip a day
    ["2022-04-04", "23:45"],  // and the last quarter hour of it
    ["2022-11-04", "18:00"],  // session open, days before the autumn changeover
  ] as const) {
    const ts = tradeInstant(date, time);
    assert.ok(ts !== null, `${date} ${time} parsed`);
    assert.deepEqual(etDateTime(ts!), { date, time }, `${date} ${time} round-trips`);
  }
});

test("reading a jump date as UTC lands on the previous evening", () => {
  // What the jump used to do. Kept as a check because the two readings differ by hours, not
  // minutes: asking for the 4th put the cursor on the evening of the 3rd.
  const asUtc = etDateTime(Date.parse("2022-04-04T00:00:00Z"));
  assert.equal(asUtc.date, "2022-04-03");
  assert.equal(asUtc.time, "20:00");

  const asEt = etDateTime(tradeInstant("2022-04-04", "00:00")!);
  assert.equal(asEt.date, "2022-04-04");
  assert.equal(asEt.time, "00:00");
});

test("every quarter hour of the day is offered, and each one is valid", () => {
  const quarters = Array.from({ length: 96 }, (_, i) => {
    const h = Math.floor(i / 4);
    const m = (i % 4) * 15;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  });
  assert.equal(quarters.length, 96);
  assert.equal(quarters[0], "00:00");
  assert.equal(quarters[95], "23:45");
  assert.equal(new Set(quarters).size, 96, "no duplicates");
  // Every option the menu can produce has to be something the jump can actually parse.
  for (const q of quarters) assert.ok(tradeInstant("2022-06-15", q) !== null, `${q} is usable`);
});

console.log(`\n${pass} session/aggregation checks passed`);
