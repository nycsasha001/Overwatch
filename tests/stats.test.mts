import assert from "node:assert/strict";
import { computeMetrics, deriveR, equitySeries, dailySummaries, rHistogram, excursionStats, weekdayOf } from "../src/lib/stats.ts";
import { DEFAULT_SETTINGS } from "../src/lib/types.ts";

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

const t = (over: Record<string, unknown> = {}) =>
  ({
    id: Math.random().toString(36).slice(2),
    accountId: "a",
    date: "2026-08-03",
    time: "10:30",
    instrument: "MNQ",
    direction: "long",
    session: "NY AM",
    strategy: null,
    setup: null,
    entry: null,
    stop: null,
    target: null,
    exit: null,
    size: null,
    riskAmount: 500,
    riskPct: 1,
    result: "win",
    pnl: 0,
    rMultiple: 0,
    mae: null,
    mfe: null,
    fees: null,
    htfSweep: 0,
    sweep4h: 0,
    sweep1h: 0,
    sweep15m: 0,
    sessionSweep: 0,
    mss: 0,
    fvg: 0,
    orderBlock: 0,
    displacement: 0,
    pdArray: null,
    entryModel: null,
    liquidityTarget: null,
    tags: [],
    thesis: null,
    execution: null,
    review: null,
    mistakes: null,
    emotions: null,
    createdAt: "2026-08-03T10:00:00.000Z",
    updatedAt: "2026-08-03T10:00:00.000Z",
    ...over,
  }) as never;

const S = DEFAULT_SETTINGS;

test("empty set produces no NaNs", () => {
  const m = computeMetrics([], S, 1000);
  assert.equal(m.trades, 0);
  assert.equal(m.winRate, null);
  assert.equal(m.profitFactor, null);
  assert.equal(m.netPnl, 0);
  assert.equal(m.maxDrawdown, 0);
});

test("core metrics", () => {
  const trades = [
    t({ date: "2026-08-03", pnl: 1000, rMultiple: 2, result: "win" }),
    t({ date: "2026-08-04", pnl: -500, rMultiple: -1, result: "loss" }),
    t({ date: "2026-08-05", pnl: 500, rMultiple: 1, result: "win" }),
    t({ date: "2026-08-06", pnl: 0, rMultiple: 0, result: "breakeven" }),
  ];
  const m = computeMetrics(trades, S, 10000);
  assert.equal(m.netPnl, 1000);
  assert.equal(m.netR, 2);
  assert.equal(m.wins, 2);
  assert.equal(m.losses, 1);
  assert.equal(m.breakevens, 1);
  assert.equal(m.winRate, (2 / 3) * 100); // BE excluded by default
  assert.equal(m.profitFactor, 3); // 1500 / 500
  assert.equal(m.expectancyR, 0.5);
  assert.equal(m.avgWin, 750);
  assert.equal(m.avgLoss, -500);
  assert.equal(m.largestWin, 1000);
  assert.equal(m.largestLoss, -500);
  assert.equal(m.medianR, 0.5);
});

test("break-even inclusion in win rate is configurable", () => {
  const trades = [t({ pnl: 100, rMultiple: 1, result: "win" }), t({ pnl: 0, rMultiple: 0, result: "breakeven" })];
  assert.equal(computeMetrics(trades, S, 0).winRate, 100);
  assert.equal(computeMetrics(trades, { ...S, breakevenInWinRate: true }, 0).winRate, 50);
});

test("excluded classifications are ignored everywhere", () => {
  const settings = { ...S, classification: { ...S.classification, partial_profit: "excluded" as const } };
  const trades = [t({ pnl: 100, rMultiple: 1, result: "win" }), t({ pnl: 999, rMultiple: 9, result: "partial_profit" })];
  const m = computeMetrics(trades, settings, 0);
  assert.equal(m.netPnl, 100);
  assert.equal(m.netR, 1);
  assert.equal(m.trades, 1);
  assert.equal(m.excluded, 1);
});

test("drawdown and streaks", () => {
  const trades = [
    t({ date: "2026-08-03", pnl: 1000, rMultiple: 2 }),
    t({ date: "2026-08-04", pnl: -400, rMultiple: -1, result: "loss" }),
    t({ date: "2026-08-05", pnl: -300, rMultiple: -1, result: "loss" }),
  ];
  const m = computeMetrics(trades, S, 10000);
  assert.equal(m.maxDrawdown, 700);
  assert.equal(m.maxDrawdownR, 2);
  assert.equal(m.currentStreak.type, "loss");
  assert.equal(m.currentStreak.count, 2);
  assert.ok(Math.abs((m.maxDrawdownPct ?? 0) - (700 / 11000) * 100) < 1e-9);
});

test("equity series starts from the account balance and is chronological", () => {
  const trades = [t({ date: "2026-08-05", pnl: 200, rMultiple: 1 }), t({ date: "2026-08-03", pnl: 100, rMultiple: 0.5 })];
  const eq = equitySeries(trades, S, 1000);
  assert.deepEqual(eq.map((p) => p.date), ["2026-08-03", "2026-08-05"]);
  assert.equal(eq[0].equity, 1100);
  assert.equal(eq[1].equity, 1300);
  assert.equal(eq[1].equityR, 1.5);
  assert.equal(eq[1].drawdown, 0);
});

test("daily summaries group by calendar day", () => {
  const days = dailySummaries(
    [
      t({ date: "2026-08-03", pnl: 100, rMultiple: 1 }),
      t({ date: "2026-08-03", pnl: -50, rMultiple: -0.5, result: "loss" }),
      t({ date: "2026-08-04", pnl: 20, rMultiple: 0.2 }),
    ],
    S
  );
  assert.equal(days.size, 2);
  const d = days.get("2026-08-03")!;
  assert.equal(d.pnl, 50);
  assert.equal(d.trades, 2);
  assert.equal(d.winRate, 50);
  assert.equal(d.best!.pnl, 100);
  assert.equal(d.worst!.pnl, -50);
});

test("R derivation respects direction", () => {
  assert.equal(deriveR(100, 90, 120, "long"), 2);
  assert.equal(deriveR(100, 110, 80, "short"), 2);
  assert.equal(deriveR(100, 100, 120, "long"), null);
  assert.equal(deriveR(100, null, 120, "long"), null);
});

test("weekday parsing has no timezone drift", () => {
  assert.equal(weekdayOf("2026-08-03"), 1); // Monday
  assert.equal(weekdayOf("2026-08-09"), 0); // Sunday
});

test("R histogram buckets", () => {
  const h = rHistogram([t({ rMultiple: 2.2 }), t({ rMultiple: 2.4 }), t({ rMultiple: -1 })]);
  const two = h.find((b) => b.from === 2)!;
  assert.equal(two.count, 2);
  assert.equal(h.find((b) => b.from === -1)!.count, 1);
});

test("excursion stats only use trades with data", () => {
  const e = excursionStats([t({ mae: 0.5, mfe: 3, rMultiple: 1.5, result: "win" }), t({ mae: null, mfe: null })], S);
  assert.equal(e.sample, 1);
  assert.equal(e.avgMaeWinners, 0.5);
  assert.equal(e.avgCapturedRatio, 0.5);
});


test("win rate is judged against the RR it was earned at", () => {
  // Three trades planned at 3:1. Break-even for 3:1 is 1/(1+3) = 25%.
  const trades = [
    t({ result: "win", rMultiple: 3, plannedRr: 3, pnl: 300 }),
    t({ result: "loss", rMultiple: -1, plannedRr: 3, pnl: -100 }),
    t({ result: "loss", rMultiple: -1, plannedRr: 3, pnl: -100 }),
  ];
  const m = computeMetrics(trades, DEFAULT_SETTINGS, 10000);
  assert.equal(m.avgPlannedRr, 3);
  assert.equal(Number((m.breakevenWinRate).toFixed(2)), 25);
  assert.equal(Number((m.winRate).toFixed(2)), 33.33);
  // 33.3% actual against a 25% bar — the edge clears it.
  assert.ok((m.winRateEdge ?? 0) > 0);
  assert.ok(m.netR > 0, "and the net R agrees");
});

test("a high win rate at poor RR is correctly reported as losing", () => {
  // 60% win rate looks healthy until you see it was earned at 0.5:1, where break-even is 66.7%.
  const trades = [
    ...Array.from({ length: 6 }, () => t({ result: "win", rMultiple: 0.5, plannedRr: 0.5, pnl: 50 })),
    ...Array.from({ length: 4 }, () => t({ result: "loss", rMultiple: -1, plannedRr: 0.5, pnl: -100 })),
  ];
  const m = computeMetrics(trades, DEFAULT_SETTINGS, 10000);
  assert.equal(Number((m.winRate).toFixed(2)), 60);
  assert.equal(Number((m.breakevenWinRate).toFixed(2)), 66.67);
  assert.ok((m.winRateEdge ?? 0) < 0, "60% does not clear a 66.7% bar");
  assert.ok(m.netR < 0, "and the net R agrees");
});

test("trades with no planned RR recorded are left out of the average", () => {
  const m = computeMetrics(
    [
      t({ result: "win", rMultiple: 2, plannedRr: 4, pnl: 200 }),
      t({ result: "loss", rMultiple: -1, plannedRr: null, pnl: -100 }),
    ],
    DEFAULT_SETTINGS,
    10000
  );
  // Averaging in a null as zero would drag the bar down and flatter the edge.
  assert.equal(m.avgPlannedRr, 4);
});

test("no planned RR anywhere means no bar to report", () => {
  const m = computeMetrics([t({ result: "win", rMultiple: 1, plannedRr: null, pnl: 100 })], DEFAULT_SETTINGS, 10000);
  assert.equal(m.avgPlannedRr, null);
  assert.equal(m.breakevenWinRate, null);
  assert.equal(m.winRateEdge, null);
});

console.log(`\n${pass} assertions groups passed`);
