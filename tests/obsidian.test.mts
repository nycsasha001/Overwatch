import assert from "node:assert/strict";
import { OVERWATCH_KEY, accountFolder, noteName, ownedTradeId, tradeNote } from "../src/lib/obsidian.ts";
import type { Trade } from "../src/lib/types.ts";

let checks = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  checks++;
  console.log(`  ok  ${name}`);
};

const base: Trade = {
  id: "trd_abc123",
  accountId: "acc_1",
  date: "2026-04-04",
  time: "10:30",
  instrument: "MNQ",
  direction: "long",
  session: "NY AM",
  strategy: "ICT",
  setup: "FVG after sweep",
  entry: 14850.25,
  stop: 14830.25,
  target: 14890.25,
  exit: 14890.25,
  size: 2,
  riskAmount: 80,
  riskPct: 0.8,
  result: "win",
  pnl: 160,
  rMultiple: 2,
  plannedRr: 2,
  mae: 0.3,
  mfe: 2.1,
  fees: null,
  htfSweep: 1,
  sweep4h: 0,
  sweep1h: 1,
  sweep15m: 0,
  sessionSweep: 1,
  mss: 1,
  fvg: 1,
  orderBlock: 0,
  displacement: 1,
  pdArray: "FVG",
  entryModel: "FVG entry",
  liquidityTarget: null,
  tags: ["replay"],
  thesis: "Swept Asia low, displaced up, waited for the 5m gap.",
  execution: "Filled at the midpoint. Held to target.",
  review: null,
  mistakes: null,
  emotions: null,
  createdAt: "2026-04-04T14:30:00Z",
} as Trade;

const front = (md: string) => md.match(/^---\r?\n([\s\S]*?)\r?\n---/)![1];

ok("the note opens with frontmatter carrying the trade's identity", () => {
  const md = tradeNote(base);
  assert.ok(md.startsWith("---\n"), "frontmatter is the first thing in the file");
  const f = front(md);
  assert.match(f, new RegExp(`^${OVERWATCH_KEY}: trd_abc123$`, "m"));
  assert.match(f, /^instrument: MNQ$/m);
  assert.match(f, /^direction: long$/m);
  assert.match(f, /^r: 2$/m);
  assert.match(f, /^pnl: 160$/m);
});

ok("values YAML would misread are quoted", () => {
  // A bare 2026-04-04 is a date and 10:30 is a sexagesimal int in some parsers. Both have to come
  // back as the strings they were.
  const f = front(tradeNote(base));
  assert.match(f, /^date: "2026-04-04"$/m);
  assert.match(f, /^time: "10:30"$/m);

  const odd = tradeNote({ ...base, strategy: "yes", setup: "A: the setup", instrument: "ES #1" });
  const g = front(odd);
  assert.match(g, /^strategy: "yes"$/m, "a bare yes would parse as a boolean");
  assert.match(g, /^setup: "A: the setup"$/m, "a colon would split the key");
  // A hash only opens a comment after whitespace, so this needs quoting and "ES#1" would not.
  assert.match(g, /^instrument: "ES #1"$/m, "a space then a hash would comment out the rest");
});

ok("tags render as a YAML list, not a string", () => {
  const f = front(tradeNote(base, { tags: ["backtest"] }));
  assert.match(f, /^tags:\n(  - \w+\n?)+/m);
  assert.match(f, /^ {2}- trade$/m);
  assert.match(f, /^ {2}- backtest$/m);
  assert.match(f, /^ {2}- replay$/m);
});

ok("duplicate tags are collapsed", () => {
  const f = front(tradeNote({ ...base, tags: ["trade", "replay"] }, { tags: ["replay"] }));
  assert.equal((f.match(/^ {2}- replay$/gm) ?? []).length, 1);
  assert.equal((f.match(/^ {2}- trade$/gm) ?? []).length, 1);
});

ok("the body leads with the result, then the numbers", () => {
  const md = tradeNote(base);
  assert.match(md, /^# Long MNQ — 2026-04-04 10:30$/m);
  assert.ok(md.includes("**+2.00R  ·  $160.00  ·  win**"), "the headline reads R, money, result");
  assert.match(md, /\| Entry \| 14850\.25 \|/);
  assert.match(md, /\| Risk \| \$80\.00 \|/);
});

ok("a loss is signed correctly", () => {
  const md = tradeNote({ ...base, rMultiple: -1, pnl: -80, result: "loss" });
  assert.match(md, /\*\*-1\.00R/);
  assert.ok(!md.includes("+-"), "no doubled sign");
});

ok("only the sections that have something in them are written", () => {
  const md = tradeNote(base);
  assert.match(md, /^## Thesis$/m);
  assert.match(md, /^## Execution$/m);
  // Empty headings are indistinguishable from ones you meant to fill in.
  assert.ok(!/^## Review$/m.test(md), "review was null");
  assert.ok(!/^## Mistakes$/m.test(md), "mistakes was null");

  const blank = tradeNote({ ...base, thesis: "   ", execution: null });
  assert.ok(!/^## Thesis$/m.test(blank), "whitespace is not content");
});

ok("the setup flags become a readable list", () => {
  const md = tradeNote(base);
  assert.match(md, /^## Setup$/m);
  assert.match(md, /^- HTF sweep$/m);
  assert.match(md, /^- MSS$/m);
  assert.match(md, /^- FVG$/m);
  assert.ok(!/^- Order block$/m.test(md), "orderBlock was 0");

  const none = tradeNote({ ...base, htfSweep: 0, sweep1h: 0, sessionSweep: 0, mss: 0, fvg: 0, displacement: 0 });
  assert.ok(!/^## Setup$/m.test(none), "no heading when nothing is flagged");
});

ok("a screenshot is embedded as a wiki link when one came across", () => {
  assert.ok(!tradeNote(base).includes("![["), "nothing embedded without an image");
  const md = tradeNote(base, { imagePath: "Trades/attachments/2026-04-04 MNQ long 1030.png" });
  assert.match(md, /!\[\[Trades\/attachments\/2026-04-04 MNQ long 1030\.png\]\]/);
});

ok("filenames sort by date and survive every filesystem", () => {
  assert.equal(noteName(base), "2026-04-04 MNQ long 1030");
  assert.equal(noteName({ ...base, time: null }), "2026-04-04 MNQ long 0000");
  // Characters that break paths, Obsidian links, or Windows.
  const nasty = noteName({ ...base, instrument: "ES/M#1:[x]" });
  assert.ok(!/[\\/:*?"<>|#^[\]]/.test(nasty), `still has an unsafe character: ${nasty}`);
});

ok("an exported note is recognised as ours, and anything else is not", () => {
  // This is what stops the exporter overwriting writing it did not produce.
  assert.equal(ownedTradeId(tradeNote(base)), "trd_abc123");
  assert.equal(ownedTradeId("# Just my own note\n\nNothing to do with trading."), null);
  assert.equal(ownedTradeId("---\ntags:\n  - trade\n---\n\nMy own note."), null);
  assert.equal(ownedTradeId(`---\n${OVERWATCH_KEY}: "trd_quoted"\n---\n`), "trd_quoted");
});

ok("re-exporting the same trade produces the identical file", () => {
  // Export has to be repeatable, or every run leaves a diff in the vault's history.
  assert.equal(tradeNote(base), tradeNote(base));
});

ok("missing numbers are left out rather than written as null", () => {
  const sparse = tradeNote({
    ...base,
    entry: null, stop: null, target: null, exit: null, size: null,
    riskAmount: null, rMultiple: null, plannedRr: null, mae: null, mfe: null,
    time: null, session: null, strategy: null, setup: null, entryModel: null, pdArray: null,
  });
  assert.ok(!sparse.includes("null"), "no literal nulls anywhere in the note");
  assert.ok(!/^r:/m.test(front(sparse)), "absent keys are omitted, not emptied");
  assert.match(front(sparse), /^instrument: MNQ$/m, "what is known is still there");
});

ok("each trade records the account it was taken on", () => {
  assert.match(front(tradeNote(base, { account: "Backtests" })), /^account: Backtests$/m);
  // Quoted, because a bare 25k Pro starts with a digit and YAML would try to read it as a number.
  assert.match(front(tradeNote(base, { account: "25k Pro" })), /^account: "25k Pro"$/m);
  // Without an account there is no empty key left behind for a query to trip over.
  assert.ok(!/^account:/m.test(front(tradeNote(base))));
});

ok("account names become folder names that survive a filesystem", () => {
  assert.equal(accountFolder("Backtests"), "Backtests");
  assert.equal(accountFolder("25k Pro"), "25k Pro");
  assert.equal(accountFolder("Apex 50k · Eval #2"), "Apex 50k · Eval -2");
  assert.equal(accountFolder("Funded/Live"), "Funded-Live", "a slash would make a nested folder");
  assert.equal(accountFolder("A: B"), "A- B", "a colon is a path separator on some systems");
  assert.equal(accountFolder("  spaced  out  "), "spaced out");
});

ok("an account folder can never be empty, or climb out of the vault", () => {
  // A blank or punctuation-only name must still land somewhere predictable inside the folder.
  for (const name of [null, undefined, "", "   ", "...", "///", "..", "."]) {
    const f = accountFolder(name);
    assert.ok(f.length > 0, `${JSON.stringify(name)} produced an empty folder`);
    assert.ok(!f.includes("/") && !f.includes("\\"), `${JSON.stringify(name)} produced a separator`);
    assert.ok(f !== "." && f !== "..", `${JSON.stringify(name)} produced a relative path`);
  }
  assert.equal(accountFolder(".."), "Unassigned");
  assert.equal(accountFolder(null), "Unassigned");
});

ok("two differently-named accounts cannot collapse into one folder", () => {
  // If sanitising mapped these together, one account's trades would silently overwrite the other's.
  const names = ["Backtests", "Backtest", "25k Pro", "25k Pro Eval", "Funded/Live", "Funded-Live"];
  const folders = names.map(accountFolder);
  const collisions = folders.filter((f, i) => folders.indexOf(f) !== i);
  assert.deepEqual(collisions, ["Funded-Live"], "only the pair that was already identical collides");
});

console.log(`\n${checks} Obsidian export checks passed`);
