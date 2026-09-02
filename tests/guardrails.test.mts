import assert from "node:assert/strict";
import { guardrails } from "../src/lib/guardrails.ts";
import { DEFAULT_SETTINGS } from "../src/lib/types.ts";

let pass = 0;
const test = async (n: string, f: () => void | Promise<void>) => {
  try { await f(); pass++; console.log(`  ok  ${n}`); }
  catch (e) { console.error(`  FAIL ${n}\n       ${(e as Error).message}`); process.exitCode = 1; }
};

const account = (over = {}) => ({
  id: "a1", name: "25k Pro", type: "evaluation", startingBalance: 25000, currency: "USD",
  defaultRiskPct: 1, archived: 0, createdAt: "2026-01-01T00:00:00Z",
  profitTarget: 1500, maxDrawdown: 1500, drawdownType: "static", dailyLossLimit: 500, ...over,
}) as never;

const trade = (date: string, pnl: number, riskAmount: number | null = 250) =>
  ({ id: Math.random().toString(36), accountId: "a1", date, time: "10:00", instrument: "MNQ", direction: "long",
     session: null, strategy: null, setup: null, entry: null, stop: null, target: null, exit: null, size: null,
     riskAmount, riskPct: null, result: pnl >= 0 ? "win" : "loss", pnl, rMultiple: null, mae: null, mfe: null,
     fees: null, htfSweep: 0, sweep4h: 0, sweep1h: 0, sweep15m: 0, sessionSweep: 0, mss: 0, fvg: 0, orderBlock: 0,
     displacement: 0, pdArray: null, entryModel: null, liquidityTarget: null, tags: [], thesis: null, execution: null,
     review: null, mistakes: null, emotions: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }) as never;

const S = DEFAULT_SETTINGS;

await test("no limits set means nothing is shown", () => {
  const g = guardrails(account({ profitTarget: null, maxDrawdown: null, dailyLossLimit: null }), [], S);
  assert.equal(g.configured, false);
});

await test("static drawdown measures from the starting balance", () => {
  const g = guardrails(account(), [trade("2026-07-13", 800), trade("2026-07-14", -300)], S, "2026-07-15");
  assert.equal(g.balance, 25500);
  assert.equal(g.drawdown!.floor, 23500); // 25000 - 1500
  assert.equal(g.drawdown!.used, 0); // still above the starting balance
  assert.equal(g.drawdown!.breached, false);
});

await test("trailing drawdown follows the peak balance", () => {
  const trades = [trade("2026-07-13", 1000), trade("2026-07-14", -400)];
  const g = guardrails(account({ drawdownType: "trailing" }), trades, S, "2026-07-15");
  assert.equal(g.peak, 26000);
  assert.equal(g.drawdown!.floor, 24500); // peak 26000 - 1500
  assert.equal(g.drawdown!.used, 400); // 400 below the peak
  assert.equal(g.drawdown!.remaining, 1100);
});

await test("drawdown breach is detected at the floor", () => {
  const g = guardrails(account(), [trade("2026-07-13", -1500)], S, "2026-07-15");
  assert.equal(g.balance, 23500);
  assert.equal(g.drawdown!.breached, true);
  assert.match(g.breaches[0], /drawdown/i);
});

await test("daily loss limit only counts today", () => {
  const trades = [trade("2026-07-13", -400), trade("2026-07-15", -200)];
  const g = guardrails(account(), trades, S, "2026-07-15");
  assert.equal(g.daily!.used, 200);
  assert.equal(g.daily!.remaining, 300);
  assert.equal(g.daily!.breached, false);
});

await test("a profitable day uses none of the daily allowance", () => {
  const g = guardrails(account(), [trade("2026-07-15", 300)], S, "2026-07-15");
  assert.equal(g.daily!.used, 0);
});

await test("daily limit breach", () => {
  const g = guardrails(account(), [trade("2026-07-15", -500)], S, "2026-07-15");
  assert.equal(g.daily!.breached, true);
  assert.equal(g.breaches.length, 1);
});

await test("profit target progress never goes negative and never breaches", () => {
  const down = guardrails(account(), [trade("2026-07-13", -200)], S, "2026-07-15");
  assert.equal(down.profitTarget!.used, 0);
  assert.equal(down.profitTarget!.breached, false);
  const up = guardrails(account(), [trade("2026-07-13", 900)], S, "2026-07-15");
  assert.equal(up.profitTarget!.used, 900);
  assert.equal(up.profitTarget!.remaining, 600);
});

await test("headroom is expressed in typical losing trades", () => {
  const g = guardrails(account(), [trade("2026-07-13", -500, 250)], S, "2026-07-15");
  // floor 23500, balance 24500 → 1000 of headroom at 250 per trade
  assert.equal(g.headroomInR, 4);
});

await test("warns before it breaches", () => {
  const g = guardrails(account(), [trade("2026-07-13", -1200)], S, "2026-07-15");
  assert.equal(g.drawdown!.breached, false);
  assert.equal(g.drawdown!.warn, true); // 1200/1500 = 80% used
});

console.log(`\n${pass} guardrail checks passed`);
