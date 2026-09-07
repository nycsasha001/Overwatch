import assert from "node:assert/strict";
import {
  describeSession,
  netR,
  parseSessionState,
  resumeBlocker,
  serialiseSessionState,
} from "../src/lib/replay-session.ts";
import type { ClosedTrade, Position } from "../src/lib/replay.ts";

let checks = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  checks++;
  console.log(`  ok  ${name}`);
};

const trade = (over: Partial<ClosedTrade> = {}): ClosedTrade => ({
  direction: "long",
  entry: 100,
  stop: 98,
  target: 104,
  contracts: 2,
  pointValue: 2,
  risk: 8,
  entryTs: 1_700_000_000_000,
  mae: 0.2,
  mfe: 1.4,
  bars: 12,
  exit: 104,
  exitTs: 1_700_000_600_000,
  reason: "target",
  r: 2,
  pnl: 16,
  ambiguous: false,
  ...over,
});

const position = (over: Partial<Position> = {}): Position => ({
  direction: "short",
  entry: 210,
  stop: 213,
  target: 200,
  contracts: 1,
  pointValue: 5,
  risk: 15,
  entryTs: 1_700_000_900_000,
  mae: 0.3,
  mfe: 0.9,
  bars: 4,
  ...over,
});

ok("a session survives the round trip through storage", () => {
  const state = { trades: [trade(), trade({ r: -1, reason: "stop" })], position: position() };
  const back = parseSessionState(serialiseSessionState(state));
  assert.deepEqual(back, state);
});

ok("a session with no position comes back with none", () => {
  const back = parseSessionState(serialiseSessionState({ trades: [trade()], position: null }));
  assert.equal(back.position, null);
  assert.equal(back.trades.length, 1);
});

ok("unreadable storage degrades to an empty session, never an exception", () => {
  // This runs on whatever a previous version of the app wrote. Throwing here would take out the
  // whole session list rather than the one bad row.
  for (const bad of ["", "{", "null", "[]", '"a string"', "undefined"]) {
    const r = parseSessionState(bad);
    assert.deepEqual(r, { trades: [], position: null }, bad);
  }
  assert.deepEqual(parseSessionState(undefined), { trades: [], position: null });
  assert.deepEqual(parseSessionState(42), { trades: [], position: null });
});

ok("a trade missing an exit price is dropped, not half-loaded", () => {
  // A trade with no exit would sit in the results contributing a silent zero to expectancy.
  const state = parseSessionState(
    JSON.stringify({ trades: [trade(), { ...trade(), exit: undefined }], position: null })
  );
  assert.equal(state.trades.length, 1, "the good one survives");
  assert.equal(state.trades[0].exit, 104);
});

ok("an unusable position is discarded while the trades are kept", () => {
  const state = parseSessionState(JSON.stringify({ trades: [trade()], position: { direction: "long" } }));
  assert.equal(state.position, null);
  assert.equal(state.trades.length, 1);
});

ok("an unrecognised close reason falls back rather than being trusted", () => {
  const state = parseSessionState(JSON.stringify({ trades: [{ ...trade(), reason: "wishful" }], position: null }));
  assert.equal(state.trades[0].reason, "manual");
});

ok("net R adds the trades up and ignores nonsense", () => {
  assert.equal(netR([trade({ r: 2 }), trade({ r: -1 })]), 1);
  assert.equal(netR([trade({ r: Number.NaN }), trade({ r: 3 })]), 3);
  assert.equal(netR([]), 0);
});

ok("a session describes itself well enough to choose from a list", () => {
  assert.equal(
    describeSession({ symbol: "MNQ", tf: "5m", trades: [trade({ r: 2 }), trade({ r: -1 })], position: null }),
    "MNQ · 5m · 2 trades · +1.00R"
  );
  assert.equal(
    describeSession({ symbol: "ES", tf: "1m", trades: [trade({ r: -0.5 })], position: position() }),
    "ES · 1m · 1 trade · -0.50R · position open"
  );
  assert.equal(describeSession({ symbol: "MNQ", tf: "15m", trades: [], position: null }), "MNQ · 15m · 0 trades");
});

ok("resuming onto the wrong instrument is refused with a reason", () => {
  // Trades priced in MNQ dropped onto ES bars would be quietly, confidently wrong.
  assert.equal(resumeBlocker({ symbol: "MNQ" }, "MNQ"), null);
  assert.match(resumeBlocker({ symbol: "MNQ" }, "ES") ?? "", /MNQ/);
});

console.log(`\n${checks} replay-session checks passed`);
