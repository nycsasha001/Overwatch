import assert from "node:assert/strict";
import { pdArrayLabel, pdArrayParts, pdArrayStacked } from "../src/lib/setup.ts";

let checks = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  checks++;
  console.log(`  ok  ${name}`);
};

const trade = (pdArray: string | null, fvg = 0, orderBlock = 0) =>
  ({ pdArray, fvg, orderBlock } as { pdArray: string | null; fvg: 0 | 1; orderBlock: 0 | 1 });

ok("a gap overlapping an order block is stacked", () => {
  assert.equal(pdArrayStacked(trade("OB + FVG")), true);
  assert.equal(pdArrayStacked(trade(null, 1, 1)), true);
});

ok("a gap overlapping a breaker is stacked", () => {
  assert.equal(pdArrayStacked(trade("BB + FVG")), true);
  assert.equal(pdArrayStacked(trade("breaker block + fair value gap")), true);
});

ok("all three is stacked", () => {
  assert.equal(pdArrayStacked(trade("OB + BB + FVG")), true);
  assert.equal(pdArrayLabel(trade("OB + BB + FVG")), "OB + BB + FVG");
});

ok("a gap on its own is not stacked", () => {
  assert.equal(pdArrayStacked(trade("FVG")), false);
  assert.equal(pdArrayStacked(trade(null, 1, 0)), false);
});

ok("an order block on its own is not stacked — the gap is required", () => {
  assert.equal(pdArrayStacked(trade("OB")), false);
  assert.equal(pdArrayStacked(trade("OB + BB")), false);
  assert.equal(pdArrayStacked(trade(null, 0, 1)), false);
});

ok("nothing recorded is not stacked", () => {
  assert.equal(pdArrayStacked(trade(null)), false);
  assert.equal(pdArrayLabel(trade(null)), "");
});

ok("gap spellings are all recognised", () => {
  for (const s of ["FVG", "iFVG", "DFVG", "fair value gap"]) {
    assert.equal(pdArrayParts(trade(`OB + ${s}`)).fvg, true, s);
  }
});

ok("the structured flags and the text agree rather than fighting", () => {
  // Flag set, text silent — still counts.
  assert.equal(pdArrayStacked(trade("BB", 1, 0)), true);
  // Text names an order block the flag missed.
  assert.equal(pdArrayStacked(trade("order block", 1, 0)), true);
});

ok("the label orders the arrays consistently", () => {
  assert.equal(pdArrayLabel(trade("FVG + OB")), "OB + FVG");
  assert.equal(pdArrayLabel(trade(null, 1, 1)), "OB + FVG");
});

console.log(`\n${checks} PD-array checks passed`);
