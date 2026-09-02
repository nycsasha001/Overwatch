import assert from "node:assert/strict";
import { daysBetween, daysIn, missingRanges } from "../src/lib/gaps.ts";

const NONE = { first: null, last: null };

let checks = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  checks++;
  console.log(`  ok  ${name}`);
};

ok("a fully stored range asks for nothing", () => {
  const have = { first: "2026-01-01", last: "2026-01-31" };
  assert.deepEqual(missingRanges("2026-01-05", "2026-01-20", have), []);
  // This is the case that cost money: re-requesting five years already on disk.
  assert.equal(daysIn(missingRanges("2026-01-05", "2026-01-20", have)), 0);
});

ok("an empty store asks for the whole range, as one request", () => {
  assert.deepEqual(missingRanges("2026-03-01", "2026-03-05", NONE), [
    { start: "2026-03-01", end: "2026-03-05" },
  ]);
});

ok("only the trailing edge is fetched when the store stops short", () => {
  const have = { first: "2026-01-01", last: "2026-01-10" };
  assert.deepEqual(missingRanges("2026-01-01", "2026-01-13", have), [
    { start: "2026-01-11", end: "2026-01-13" },
  ]);
});

ok("only the leading edge is fetched when the store starts late", () => {
  const have = { first: "2026-02-05", last: "2026-02-28" };
  assert.deepEqual(missingRanges("2026-02-01", "2026-02-10", have), [
    { start: "2026-02-01", end: "2026-02-04" },
  ]);
});

ok("an empty day inside the imported span is a closed market, not a gap", () => {
  // Saturdays and holidays hold no bars and never will. Fetching them buys nothing — over five
  // years of stored MNQ this was 268 days, every one a Saturday.
  const have = { first: "2026-01-01", last: "2026-01-12" };
  assert.deepEqual(missingRanges("2026-01-01", "2026-01-12", have), []);
});

ok("holes are ignored inside the span but not outside it", () => {
  const have = { first: "2026-01-02", last: "2026-01-05" };
  assert.deepEqual(missingRanges("2026-01-01", "2026-01-06", have), [
    { start: "2026-01-01", end: "2026-01-01" },
    { start: "2026-01-06", end: "2026-01-06" },
  ]);
  assert.equal(daysIn(missingRanges("2026-01-01", "2026-01-06", have)), 2);
});

ok("a single missing day is a one-day range", () => {
  assert.deepEqual(missingRanges("2026-04-01", "2026-04-01", NONE), [
    { start: "2026-04-01", end: "2026-04-01" },
  ]);
});

ok("ranges span month and year boundaries without drifting", () => {
  assert.deepEqual(missingRanges("2025-12-30", "2026-01-02", NONE), [
    { start: "2025-12-30", end: "2026-01-02" },
  ]);
  assert.equal(daysBetween("2025-12-30", "2026-01-02").length, 4);
});

ok("a leap day is counted", () => {
  assert.equal(daysBetween("2028-02-27", "2028-03-01").length, 4);
  assert.ok(daysBetween("2028-02-27", "2028-03-01").includes("2028-02-29"));
});

ok("a backwards or malformed range asks for nothing rather than everything", () => {
  assert.deepEqual(daysBetween("2026-05-10", "2026-05-01"), []);
  assert.deepEqual(missingRanges("2026-05-10", "2026-05-01", NONE), []);
  assert.deepEqual(missingRanges("not-a-date", "2026-05-01", NONE), []);
});

ok("extending to today fetches only what comes after the last stored day", () => {
  const have = { first: "2026-08-01", last: "2026-08-13" };
  assert.deepEqual(missingRanges("2026-08-01", "2026-08-24", have), [
    { start: "2026-08-14", end: "2026-08-24" },
  ]);
});

console.log(`\n${checks} gap checks passed`);
