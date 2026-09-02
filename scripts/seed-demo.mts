/**
 * OPTIONAL demo data generator.
 *
 * This is NOT part of the application and is never run automatically. It exists so you can
 * see how the interface behaves with a populated database before you have logged real trades.
 * It creates a clearly-labelled account called "Demo (sample data)" — delete that account in
 * Settings to remove every trade it created.
 *
 *   1. npm run dev            (leave running)
 *   2. npm run demo:seed
 */

const BASE = process.env.BASE ?? "http://localhost:3000";

const post = async (path: string, body: unknown) => {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json();
};

const SETUPS = ["4H Sweep", "1H Sweep", "15m Sweep", "Session Sweep"];
const SESSIONS = ["London", "NY AM", "NY PM"];
const ENTRY_MODELS = ["FVG entry", "Order block", "Retest of MSS", "Breaker"];

// Deterministic pseudo-random so repeated runs are comparable.
let seed = 20260811;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];

const account = await post("/api/accounts", {
  name: "Demo (sample data)",
  type: "paper",
  startingBalance: 50000,
  currency: "USD",
  defaultRiskPct: 1,
});

const trades: Record<string, unknown>[] = [];
const start = new Date();
start.setDate(start.getDate() - 120);

for (let d = 0; d < 120; d++) {
  const day = new Date(start);
  day.setDate(start.getDate() + d);
  const dow = day.getDay();
  if (dow === 0 || dow === 6) continue;
  if (rnd() < 0.42) continue; // not every day is a trading day

  const count = rnd() < 0.65 ? 1 : rnd() < 0.9 ? 2 : 3;
  for (let i = 0; i < count; i++) {
    const win = rnd() < 0.44;
    const setup = pick(SETUPS);
    const session = pick(SESSIONS);
    const direction = rnd() < 0.5 ? "long" : "short";
    const riskAmount = 500;
    let result: string;
    let r: number;
    if (win) {
      r = Number((0.8 + rnd() * 2.2).toFixed(2));
      result = r < 1.4 && rnd() < 0.4 ? "early_profit" : rnd() < 0.15 ? "partial_profit" : "win";
    } else if (rnd() < 0.12) {
      r = Number((rnd() * 0.14 - 0.07).toFixed(2));
      result = "breakeven";
    } else {
      r = Number((-0.7 - rnd() * 0.35).toFixed(2));
      result = r > -0.85 ? "early_loss" : "loss";
    }
    const hour = session === "London" ? 3 + Math.floor(rnd() * 2) : session === "NY AM" ? 9 + Math.floor(rnd() * 2) : 13 + Math.floor(rnd() * 2);
    const entry = Number((18000 + rnd() * 900).toFixed(2));
    const stopDist = Number((12 + rnd() * 18).toFixed(2));
    const stop = direction === "long" ? entry - stopDist : entry + stopDist;
    const exit = direction === "long" ? entry + stopDist * r : entry - stopDist * r;

    trades.push({
      date: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`,
      time: `${String(hour).padStart(2, "0")}:${String(Math.floor(rnd() * 60)).padStart(2, "0")}`,
      instrument: rnd() < 0.85 ? "MNQ" : "MES",
      direction,
      session,
      strategy: "Liquidity sweep reversal",
      setup,
      entry,
      stop: Number(stop.toFixed(2)),
      target: Number((direction === "long" ? entry + stopDist * 3 : entry - stopDist * 3).toFixed(2)),
      exit: Number(exit.toFixed(2)),
      size: 2,
      riskAmount,
      riskPct: 1,
      result,
      pnl: Number((r * riskAmount).toFixed(2)),
      rMultiple: r,
      mae: Number((rnd() * (win ? 0.75 : 1)).toFixed(2)),
      mfe: Number((Math.max(r, 0) + rnd() * 1.6).toFixed(2)),
      htfSweep: rnd() < 0.5,
      sweep4h: setup === "4H Sweep",
      sweep1h: setup === "1H Sweep",
      sweep15m: setup === "15m Sweep",
      sessionSweep: setup === "Session Sweep",
      mss: rnd() < 0.8,
      fvg: rnd() < 0.7,
      orderBlock: rnd() < 0.4,
      displacement: rnd() < 0.6,
      entryModel: pick(ENTRY_MODELS),
      pdArray: rnd() < 0.6 ? "FVG" : "Order block",
      liquidityTarget: direction === "long" ? "Session high" : "Session low",
      tags: rnd() < 0.25 ? ["A+ setup"] : [],
      thesis: `${session} — price swept the ${direction === "long" ? "session low" : "session high"} and displaced back through the ${setup.toLowerCase()} level. Entry on the retrace into the ${rnd() < 0.5 ? "FVG" : "order block"}.`,
      execution: win ? "Entry filled on the first touch, held to target." : "Filled late; price never expanded and rotated back through the entry.",
      review: win ? "Setup behaved as expected. Nothing to change." : "Sequence was incomplete — no clean displacement before entry.",
      mistakes: win ? null : rnd() < 0.5 ? "Entered before the retrace confirmed." : null,
      emotions: win ? "Patient, followed the plan." : "Slightly impatient after sitting out the previous session.",
    });
  }
}

const res = await post("/api/trades/import", { accountId: account.id, trades });
console.log(`Seeded ${res.imported} demo trades into "${account.name}" (${account.id}).`);
console.log("Delete that account in Settings → Accounts to remove all of it.");
