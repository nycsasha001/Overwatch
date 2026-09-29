import assert from "node:assert/strict";
import zlib from "node:zlib";
import { exportBundle, type BundleOptions } from "../src/lib/trade-export.ts";
import { buildZip } from "../src/lib/zip.ts";
import { parseCsv } from "../src/lib/csv.ts";
import { DEFAULT_SETTINGS, type Trade } from "../src/lib/types.ts";

let checks = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  checks++;
  console.log(`  ok  ${name}`);
};

const trade = (over: Partial<Trade>): Trade =>
  ({
    id: "trd_1",
    accountId: "acc_bt",
    date: "2023-02-09",
    time: "09:54",
    instrument: "MNQ",
    direction: "long",
    session: "NY AM",
    strategy: "Reversals",
    setup: "1H Sweep",
    entry: 12663,
    stop: 12626.5,
    target: 12742.5,
    exit: 12626.5,
    size: null,
    riskAmount: null,
    riskPct: null,
    result: "loss",
    pnl: 0,
    rMultiple: -1,
    plannedRr: 2.18,
    mae: 1.233,
    mfe: 1.219,
    fees: null,
    htfSweep: 0,
    sweep4h: 0,
    sweep1h: 1,
    sweep15m: 0,
    sessionSweep: 0,
    mss: 1,
    fvg: 1,
    orderBlock: 0,
    displacement: 0,
    pdArray: "OB/FVG overlap",
    entryModel: "FVG 50%",
    liquidityTarget: "Session high",
    tags: ["replay"],
    thesis: "Swept the 1H low, shifted structure, waited for the gap.",
    execution: null,
    review: "Stopped out | then ran to target.",
    mistakes: null,
    emotions: null,
    createdAt: "2026-09-23T01:42:48.165Z",
    updatedAt: "2026-09-23T01:42:48.165Z",
    screenshots: [],
    ...over,
  }) as Trade;

// Handed in newest first, the way the journal lists them. The export must number them oldest first.
const trades = [
  trade({
    id: "trd_3",
    date: "2023-03-24",
    time: "10:21",
    setup: "London Sweep",
    result: "breakeven",
    rMultiple: 0.04,
    screenshots: [
      { id: "s2", tradeId: "trd_3", phase: "trade", filename: "img_b.png", mime: "image/png", caption: null, createdAt: "" },
      { id: "s3", tradeId: "trd_3", phase: "trade", filename: "img_c.PNG", mime: "image/png", caption: null, createdAt: "" },
    ],
  }),
  trade({
    id: "trd_2",
    date: "2023-02-14",
    time: "10:46",
    result: "win",
    rMultiple: 0.54,
    thesis: null,
    review: null,
    screenshots: [{ id: "s1", tradeId: "trd_2", phase: "trade", filename: "img_a.png", mime: "image/png", caption: null, createdAt: "" }],
  }),
  trade({}),
];

const opts: BundleOptions = {
  settings: DEFAULT_SETTINGS,
  accountNames: new Map([["acc_bt", "Backtests"]]),
  rOnly: true,
  filtered: false,
  exportedOn: "2026-09-29",
};

const bundle = exportBundle(trades, opts);
const md = bundle.report;

ok("the report says what it is, when, and over which dates", () => {
  assert.match(md, /^# Backtests — trade export$/m);
  assert.match(md, /on 2026-09-29\. 3 trades from 2023-02-09 to 2023-03-24, all on the "Backtests" account\./);
});

ok("a backtest is explained as R only, and carries no money anywhere", () => {
  assert.match(md, /These are backtests\./);
  assert.doesNotMatch(md, /P&L \|/);
  assert.doesNotMatch(md, /\$/);
});

ok("the reader is told how each result present counts", () => {
  assert.match(md, /Loss counts as a loss/);
  assert.match(md, /Break-even counts as a break-even/);
  assert.match(md, /Win counts as a win/);
});

ok("trades are numbered oldest first, whatever order they arrive in", () => {
  const a = md.indexOf("### #1 · Thu 2023-02-09 09:54 · Long MNQ · -1.00R Loss");
  const b = md.indexOf("### #2 · Tue 2023-02-14 10:46");
  const c = md.indexOf("### #3 · Fri 2023-03-24 10:21");
  assert.ok(a > 0 && b > a && c > b, "sections in date order");
});

ok("the summary reports the headline numbers in R", () => {
  assert.match(md, /\| Trades \| 3 \(1 win, 1 loss, 1 break-even\) \|/);
  assert.match(md, /\| Net R \| -0\.42R \|/);
  assert.match(md, /\| Average planned RR \| 2\.18R \|/);
});

ok("a breakdown appears only for a field the trades differ on", () => {
  assert.match(md, /### By setup/);
  assert.match(md, /\| London Sweep \| 1 \| 0 \/ 0 \/ 1 \|/);
  assert.doesNotMatch(md, /### By session/, "every trade is NY AM");
});

ok("a pipe in a field is escaped where it lands in a table, and left alone in the notes", () => {
  const piped = exportBundle([trade({ setup: "Sweep|MSS" })], opts).report;
  assert.match(piped, /\| Setup \| Sweep\\\|MSS \|/);
  assert.match(piped, /^Stopped out \| then ran to target\.$/m);
});

ok("empty notes say so rather than leaving a bare heading", () => {
  const section = md.slice(md.indexOf("### #2"), md.indexOf("### #3"));
  assert.match(section, /_No notes written for this trade\._/);
  assert.doesNotMatch(section, /#### Thesis/);
});

ok("screenshots are named after their trade's number, and the report names each one", () => {
  assert.deepEqual(
    bundle.screenshots.map((s) => [s.filename, s.path]),
    [
      ["img_a.png", "screenshots/2_2023-02-14_1046_MNQ_long.png"],
      ["img_b.png", "screenshots/3_2023-03-24_1021_MNQ_long.png"],
      ["img_c.PNG", "screenshots/3_2023-03-24_1021_MNQ_long_2.png"],
    ]
  );
  assert.match(md, /\| Screenshots \| `screenshots\/3_2023-03-24_1021_MNQ_long\.png`, `screenshots\/3_2023-03-24_1021_MNQ_long_2\.png` \|/);
});

ok("numbers are zero-padded once there are ten or more trades, so the folder sorts in order", () => {
  const many = Array.from({ length: 10 }, (_, i) =>
    trade({ id: `t${i}`, date: `2023-01-${String(i + 1).padStart(2, "0")}`, screenshots: [
      { id: `s${i}`, tradeId: `t${i}`, phase: "trade", filename: `i${i}.png`, mime: "image/png", caption: null, createdAt: "" },
    ] })
  );
  const paths = exportBundle(many, opts).screenshots.map((s) => s.path);
  assert.equal(paths[0], "screenshots/01_2023-01-01_0954_MNQ_long.png");
  assert.equal(paths[9], "screenshots/10_2023-01-10_0954_MNQ_long.png");
});

ok("the CSV keeps planned RR and drops the money columns on a backtest", () => {
  const rows = parseCsv(bundle.csv);
  const head = rows[0];
  assert.deepEqual(head.slice(0, 4), ["number", "id", "account", "weekday"]);
  assert.ok(head.includes("plannedRr"));
  assert.ok(!head.includes("pnl") && !head.includes("size"));
  assert.equal(rows.length, 4);
  const last = rows[3];
  assert.equal(last[head.indexOf("number")], "3");
  assert.equal(last[head.indexOf("screenshots")], "screenshots/3_2023-03-24_1021_MNQ_long.png|screenshots/3_2023-03-24_1021_MNQ_long_2.png");
  assert.equal(last[head.indexOf("review")], "Stopped out | then ran to target.");
});

ok("a stop moved to or past the entry is marked, and no risk is worked out from it", () => {
  const section = md.slice(md.indexOf("### #3"));
  assert.match(section, /\| Stop \| 12626\.5 \|/, "trade #3's stop is where it started");
  const be = exportBundle([trade({ stop: 12669, exit: 12669, result: "breakeven", rMultiple: 0.16 })], opts).report;
  assert.match(be, /\| Stop \(moved to or past entry before the close\) \| 12669 \|/);
  assert.match(be, /\| 12663 \| 12669 \(moved\) \| 12742\.5 \|/);
  assert.doesNotMatch(be, /Risk \(points/);
  const short = exportBundle([trade({ direction: "short", entry: 100, stop: 110 })], opts).report;
  assert.match(short, /\| Risk \(points, entry to stop\) \| 10 \|/);
});

ok("a live account keeps its money, and a filtered export says it is one", () => {
  const live = exportBundle([trade({ accountId: "acc_live", pnl: -80, size: 2, riskAmount: 80 })], {
    ...opts,
    accountNames: new Map([["acc_live", "50k Flex"]]),
    rOnly: false,
    filtered: true,
  });
  assert.doesNotMatch(live.report, /These are backtests/);
  assert.match(live.report, /This is a filtered selection/);
  assert.match(live.report, /\| P&L \| -\$80\.00 \|/);
  assert.ok(parseCsv(live.csv)[0].includes("pnl"));
});

/* ----------------------------------- zip ----------------------------------- */

/** Read a zip back through its central directory, the way an unzipper does. */
function unzip(buf: Buffer): Map<string, Buffer> {
  const end = buf.length - 22;
  assert.equal(buf.readUInt32LE(end), 0x06054b50, "end-of-directory record");
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, "central directory entry");
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    assert.equal(buf.readUInt32LE(local), 0x04034b50, "local header");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.subarray(start, start + csize);
    const data = method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body);
    assert.equal(zlib.crc32(data), crc, `checksum of ${name}`);
    out.set(name, data);
    p += 46 + nameLen;
  }
  return out;
}

ok("a zip reads back to exactly the files that went in", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const zip = buildZip([
    { path: "x/report.md", data: bundle.report },
    { path: "x/trades.csv", data: bundle.csv },
    { path: "x/screenshots/1_ä.png", data: png },
  ]);
  const files = unzip(zip);
  assert.deepEqual([...files.keys()], ["x/report.md", "x/trades.csv", "x/screenshots/1_ä.png"]);
  assert.equal(files.get("x/report.md")!.toString("utf8"), bundle.report);
  assert.equal(files.get("x/trades.csv")!.toString("utf8"), bundle.csv);
  assert.deepEqual(files.get("x/screenshots/1_ä.png"), png);
});

ok("text is compressed, and data that would not shrink is stored as it is", () => {
  const zip = buildZip([{ path: "a.md", data: "R ".repeat(5000) }, { path: "b.bin", data: Buffer.from([7, 1, 9]) }]);
  let p = zip.readUInt32LE(zip.length - 22 + 16);
  assert.equal(zip.readUInt16LE(p + 10), 8, "markdown deflated");
  p += 46 + zip.readUInt16LE(p + 28);
  assert.equal(zip.readUInt16LE(p + 10), 0, "three bytes stored");
});

console.log(`\n${checks} trade export checks passed`);
