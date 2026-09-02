/**
 * End-to-end API test. Requires the app to be running:
 *   npm run build && npm start   (or npm run dev)
 * Usage: BASE=http://localhost:3000 npm test
 */
import assert from "node:assert/strict";

const BASE = process.env.BASE ?? "http://localhost:3000";

let pass = 0;
const step = async (name: string, fn: () => Promise<void>) => {
  try {
    await fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}\n       ${(e as Error).message}`);
    process.exitCode = 1;
  }
};

const j = async (url: string, init?: RequestInit) => {
  const res = await fetch(BASE + url, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

const account = (await j("/api/accounts", {
  method: "POST",
  body: JSON.stringify({ name: `Test ${Date.now()}`, type: "paper", startingBalance: 25000, currency: "USD", defaultRiskPct: 1 }),
})).body;

let tradeId = "";

await step("creates a trade and derives R from prices", async () => {
  const r = await j("/api/trades", {
    method: "POST",
    body: JSON.stringify({
      accountId: account.id,
      date: "2026-08-10",
      time: "09:45",
      instrument: "mnq",
      direction: "long",
      entry: 100,
      stop: 90,
      exit: 125,
      result: "win",
      pnl: 250,
      riskAmount: 100,
    }),
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.rMultiple, 2.5);
  assert.equal(r.body.instrument, "MNQ");
  tradeId = r.body.id;
});

await step("rejects an invalid date", async () => {
  const r = await j("/api/trades", {
    method: "POST",
    body: JSON.stringify({ accountId: account.id, date: "10/08/2026", instrument: "MNQ", direction: "long", result: "win" }),
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /date/i);
});

await step("rejects an unknown result code", async () => {
  const r = await j("/api/trades", {
    method: "POST",
    body: JSON.stringify({ accountId: account.id, date: "2026-08-10", instrument: "MNQ", direction: "long", result: "moon" }),
  });
  assert.equal(r.status, 400);
});

await step("updates a trade", async () => {
  const r = await j(`/api/trades/${tradeId}`, {
    method: "PUT",
    body: JSON.stringify({
      accountId: account.id,
      date: "2026-08-10",
      instrument: "MNQ",
      direction: "long",
      result: "partial_profit",
      pnl: 180,
      rMultiple: 1.8,
      thesis: "Swept Asia high, displaced through 15m FVG.",
    }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.result, "partial_profit");
  assert.equal(r.body.rMultiple, 1.8);
  assert.equal(r.body.thesis, "Swept Asia high, displaced through 15m FVG.");
});

await step("duplicates a trade", async () => {
  const r = await j(`/api/trades/${tradeId}/duplicate`, { method: "POST" });
  assert.equal(r.status, 201);
  assert.notEqual(r.body.id, tradeId);
  assert.equal(r.body.pnl, 180);
  await j(`/api/trades/${r.body.id}`, { method: "DELETE" });
});

await step("bulk imports and skips invalid rows", async () => {
  const r = await j("/api/trades/import", {
    method: "POST",
    body: JSON.stringify({
      accountId: account.id,
      trades: [
        { date: "2026-08-11", instrument: "MNQ", direction: "short", result: "loss", pnl: -100, rMultiple: -1 },
        { date: "not-a-date", instrument: "MNQ", direction: "short", result: "loss", pnl: -100 },
      ],
    }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.imported, 1);
  assert.equal(r.body.skipped, 1);
});

await step("exports CSV with a header row", async () => {
  const res = await fetch(`${BASE}/api/trades/export?accountId=${account.id}`);
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/csv/);
  assert.match(text.split("\n")[0], /^date,time,instrument/);
  assert.ok(text.split("\n").length >= 3);
});

await step("uploads, serves and deletes a screenshot", async () => {
  // 1x1 transparent PNG
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const fd = new FormData();
  fd.append("tradeId", tradeId);
  fd.append("phase", "before");
  fd.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "chart.png");
  const up = await fetch(`${BASE}/api/screenshots`, { method: "POST", body: fd });
  const shot = await up.json();
  assert.equal(up.status, 201);
  const file = await fetch(`${BASE}/api/screenshots/file/${shot.filename}`);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("content-type"), "image/png");
  const bad = await fetch(`${BASE}/api/screenshots/file/..%2F..%2Fjournal.db`);
  assert.ok(bad.status === 404 || bad.status === 400, "path traversal must not resolve");
  const del = await j(`/api/screenshots/${shot.id}`, { method: "DELETE" });
  assert.equal(del.status, 200);
});

await step("rejects a non-image upload", async () => {
  const fd = new FormData();
  fd.append("tradeId", tradeId);
  fd.append("phase", "before");
  fd.append("file", new Blob(["#!/bin/sh"], { type: "application/x-sh" }), "evil.sh");
  const up = await fetch(`${BASE}/api/screenshots`, { method: "POST", body: fd });
  assert.equal(up.status, 400);
});

await step("bootstrap scopes trades to the selected account", async () => {
  const r = await j(`/api/bootstrap?accountId=${account.id}`);
  assert.equal(r.status, 200);
  assert.ok(r.body.trades.every((t: { accountId: string }) => t.accountId === account.id));
  assert.equal(r.body.trades.length, 2);
});

await step("stores settings", async () => {
  const r = await j("/api/settings", {
    method: "PUT",
    body: JSON.stringify({ defaultRiskPct: 0.75, classification: { partial_profit: "excluded" } }),
  });
  assert.equal(r.body.defaultRiskPct, 0.75);
  assert.equal(r.body.classification.partial_profit, "excluded");
  assert.equal(r.body.classification.win, "win");
  await j("/api/settings", { method: "PUT", body: JSON.stringify({ defaultRiskPct: 1, classification: { partial_profit: "win" } }) });
});

await step("backtests never fabricate results", async () => {
  const created = await j("/api/backtests", {
    method: "POST",
    body: JSON.stringify({ name: "API test run", instrument: "MNQ", startDate: "2026-01-01", endDate: "2026-06-30" }),
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.status, "awaiting_engine");
  assert.equal(created.body.result, null);

  const ingested = await j(`/api/backtests/${created.body.id}/result`, {
    method: "POST",
    body: JSON.stringify({ trades: 120, netR: 33.5, netPnl: 6700, winRate: 44.2, profitFactor: 1.7, maxDrawdownR: 8.1 }),
  });
  assert.equal(ingested.body.status, "complete");
  assert.equal(ingested.body.result.trades, 120);
  await j(`/api/backtests/${created.body.id}`, { method: "DELETE" });
});

await step("deleting an account cascades its trades", async () => {
  await j(`/api/accounts/${account.id}`, { method: "DELETE" });
  const r = await j(`/api/trades?accountId=${account.id}`);
  assert.equal(r.body.length, 0);
});

console.log(`\n${pass} API checks passed`);
