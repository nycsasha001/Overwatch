import assert from "node:assert/strict";
import { labelPlacement } from "../src/lib/drawings.ts";

let checks = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  checks++;
  console.log(`  ok  ${name}`);
};

const at = (hAlign: "left" | "middle" | "right", vAlign: "inside" | "top" | "bottom") =>
  labelPlacement({ x1: 100, x2: 500, y: 200, hAlign, vAlign, fontSize: 12 });

ok("horizontal placement spans the shape, not just its anchor", () => {
  assert.equal(at("left", "top").x, 106, "just inside the left end");
  assert.equal(at("middle", "top").x, 300, "the centre of the span");
  assert.equal(at("right", "top").x, 494, "just inside the right end");
});

ok("the text anchor matches the side it is placed on", () => {
  // Without this, a right-aligned label starts at the right edge and runs off the chart.
  assert.equal(at("left", "top").anchor, "start");
  assert.equal(at("middle", "top").anchor, "middle");
  assert.equal(at("right", "top").anchor, "end");
});

ok("above, below and on the line are actually different places", () => {
  const above = at("left", "top").y;
  const inside = at("left", "inside").y;
  const below = at("left", "bottom").y;
  assert.ok(above < 200, "above sits over the line");
  assert.ok(below > 200, "below sits under it");
  assert.ok(above < inside && inside < below, "and on-the-line is between the two");
});

ok("below clears the line by a whole font size", () => {
  // SVG text sits on its baseline: dropping by less than the size leaves the glyphs straddling
  // the line they are meant to be under.
  const p = labelPlacement({ x1: 0, x2: 100, y: 50, hAlign: "left", vAlign: "bottom", fontSize: 16 });
  assert.ok(p.y - 50 >= 16);
});

ok("a bigger label moves further, so the gap stays visually even", () => {
  const small = labelPlacement({ x1: 0, x2: 100, y: 50, hAlign: "left", vAlign: "bottom", fontSize: 9 });
  const large = labelPlacement({ x1: 0, x2: 100, y: 50, hAlign: "left", vAlign: "bottom", fontSize: 16 });
  assert.ok(large.y > small.y);
});

ok("a backwards span is handled, not mirrored", () => {
  // Drawn right-to-left, x1 > x2. "Left" must still mean the left of the screen.
  const forward = labelPlacement({ x1: 100, x2: 500, y: 0, hAlign: "left", vAlign: "top", fontSize: 12 });
  const backward = labelPlacement({ x1: 500, x2: 100, y: 0, hAlign: "left", vAlign: "top", fontSize: 12 });
  assert.equal(backward.x, forward.x);
});

ok("a zero-width shape does not produce NaN", () => {
  const p = labelPlacement({ x1: 240, x2: 240, y: 10, hAlign: "middle", vAlign: "inside", fontSize: 12 });
  assert.equal(p.x, 240);
  assert.ok(Number.isFinite(p.y));
});

ok("padding is adjustable and respected on both sides", () => {
  const p = labelPlacement({ x1: 0, x2: 100, y: 0, hAlign: "right", vAlign: "top", fontSize: 12, pad: 20 });
  assert.equal(p.x, 80);
});

console.log(`\n${checks} label placement checks passed`);
