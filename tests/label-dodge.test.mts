import assert from "node:assert/strict";
import { boxesOverlap, placeLevelLabel, textBox } from "../src/lib/label-dodge.ts";
import { DEFAULT_STYLE, drawingLabel, labelPlacement, timeToCoordinate, type Drawing } from "../src/lib/drawings.ts";

let checks = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  checks++;
  console.log(`  ok  ${name}`);
};

ok("a text box hangs off its baseline in the direction it is anchored", () => {
  const start = textBox(100, 50, 40, 10, "start");
  assert.deepEqual([start.left, start.right], [100, 140], "start runs right from x");
  const end = textBox(100, 50, 40, 10, "end");
  assert.deepEqual([end.left, end.right], [60, 100], "end runs left to x");
  const mid = textBox(100, 50, 40, 10, "middle");
  assert.deepEqual([mid.left, mid.right], [80, 120], "middle straddles x");
  assert.ok(start.top < 50 && start.bottom > 50, "glyphs sit mostly above the baseline, a little below");
});

ok("overlap allows a little breathing space and nothing less", () => {
  const a = { left: 0, top: 0, right: 50, bottom: 10 };
  assert.equal(boxesOverlap(a, { left: 51, top: 0, right: 90, bottom: 10 }), true, "one pixel apart is too close");
  assert.equal(boxesOverlap(a, { left: 53, top: 0, right: 90, bottom: 10 }), false, "three pixels is clear");
  assert.equal(boxesOverlap(a, { left: 0, top: 13, right: 50, bottom: 20 }), false, "and so is three below");
});

const line = { left: 100, right: 400, y: 200, width: 50, fontSize: 9 };

ok("with nothing in the way a level label sits where it always has: left end, above the line", () => {
  const spot = placeLevelLabel({ ...line, avoid: [] });
  assert.equal(spot.x, 104);
  assert.equal(spot.y, 197);
  assert.equal(spot.anchor, "start");
});

ok("text written over the left end pushes the label under the line", () => {
  // A horizontal ray labelled at its left end, above the line, exactly where the level label goes.
  const written = textBox(106, 197, 60, 12, "start");
  const spot = placeLevelLabel({ ...line, avoid: [written] });
  assert.equal(spot.anchor, "start", "still at the left end");
  assert.ok(spot.y > 200, "but below the line");
  assert.equal(boxesOverlap(spot.box, written), false);
});

ok("text above and below the left end sends the label to the right end", () => {
  const above = textBox(106, 197, 60, 12, "start");
  const below = textBox(106, 214, 60, 12, "start");
  const spot = placeLevelLabel({ ...line, avoid: [above, below] });
  assert.equal(spot.anchor, "end");
  assert.equal(spot.x, 396, "tucked inside the right end");
  assert.ok(spot.y < 200, "above the line, the first free spot there");
});

ok("every spot taken, it falls back to the usual one rather than vanishing", () => {
  const everywhere = { left: 0, top: 0, right: 500, bottom: 400 };
  const spot = placeLevelLabel({ ...line, avoid: [everywhere] });
  assert.equal(spot.x, 104);
  assert.equal(spot.y, 197);
});

ok("a label already placed counts: two levels at the same price do not stack", () => {
  const first = placeLevelLabel({ ...line, avoid: [] });
  const second = placeLevelLabel({ ...line, y: 203, avoid: [first.box] });
  assert.equal(boxesOverlap(first.box, second.box), false);
});

const drawing = (kind: Drawing["kind"], style: Partial<Drawing["style"]> = {}): Drawing => ({
  id: "d1",
  kind,
  a: { t: 0, price: 100 },
  b: { t: 60000, price: 90 },
  style: { ...DEFAULT_STYLE, label: "my level", ...style },
});

ok("a ray's written label is placed exactly as the overlay places it", () => {
  const A = { x: 100, y: 200 };
  const B = { x: 300, y: 250 };
  const L = drawingLabel(drawing("ray", { labelHAlign: "right", labelAlign: "bottom" }), A, B, 800);
  assert.ok(L);
  const expected = labelPlacement({ x1: 100, x2: 800, y: 200, hAlign: "right", vAlign: "bottom", fontSize: DEFAULT_STYLE.labelSize });
  assert.deepEqual({ x: L.x, y: L.y, anchor: L.anchor }, expected, "spans from the anchor to the edge of the plot");
  assert.equal(L.text, "my level");
  assert.equal(L.fontSize, DEFAULT_STYLE.labelSize);
});

ok("a rectangle's label keeps the grid it always had", () => {
  const A = { x: 100, y: 100 };
  const B = { x: 300, y: 160 };
  const above = drawingLabel(drawing("rect"), A, B, 800)!;
  assert.deepEqual({ x: above.x, y: above.y, anchor: above.anchor }, { x: 104, y: 96, anchor: "start" });
  const inside = drawingLabel(drawing("rect", { labelAlign: "inside", labelHAlign: undefined as unknown as "middle" }), A, B, 800)!;
  assert.deepEqual({ x: inside.x, y: inside.y, anchor: inside.anchor }, { x: 200, y: 127, anchor: "middle" }, "inside used to mean centred both ways");
  const below = drawingLabel(drawing("rect", { labelAlign: "bottom", labelHAlign: "right" }), A, B, 800)!;
  assert.deepEqual({ x: below.x, y: below.y, anchor: below.anchor }, { x: 296, y: 160 + DEFAULT_STYLE.labelSize + 2, anchor: "end" });
});

ok("a trend line's label rides the segment and follows an extension", () => {
  const A = { x: 100, y: 200 };
  const B = { x: 300, y: 100 };
  // The default style puts it at the left end, at the height of the line there.
  const plain = drawingLabel(drawing("trendline"), A, B, 800)!;
  assert.deepEqual({ x: plain.x, y: plain.y, anchor: plain.anchor }, { x: 106, y: 196, anchor: "start" });
  // Centred, it sits over the midpoint at the line's height there.
  const centred = drawingLabel(drawing("trendline", { labelHAlign: "middle" }), A, B, 800)!;
  const mid = labelPlacement({ x1: 100, x2: 300, y: 150, hAlign: "middle", vAlign: "top", fontSize: DEFAULT_STYLE.labelSize });
  assert.deepEqual({ x: centred.x, y: centred.y }, { x: mid.x, y: mid.y });
  const extended = drawingLabel(drawing("trendline", { extendRight: true, labelHAlign: "right" }), A, B, 800)!;
  assert.equal(extended.anchor, "end");
  assert.equal(extended.x, 794, "against the right edge, where the extended line now ends");
});

ok("shapes with no free text have no label to avoid, and empty text says so", () => {
  assert.equal(drawingLabel(drawing("long"), { x: 0, y: 0 }, { x: 10, y: 10 }, 800), null);
  assert.equal(drawingLabel(drawing("gann"), { x: 0, y: 0 }, { x: 10, y: 10 }, 800), null);
  const blank = drawingLabel(drawing("ray", { label: "" }), { x: 0, y: 0 }, { x: 10, y: 10 }, 800);
  assert.ok(blank, "the ray still needs the spot for its price readout");
  assert.equal(blank.text, "");
});

ok("a timestamp between two candles lands between them, not at the left edge", () => {
  // The chart's own lookup answers 0 for any fractional index — which is what a ray drawn on the
  // 1m chart hands it on the 5m chart, and why the primitive once reckoned every such label to be
  // at x = 0 and never dodged it.
  const scale = { logicalToCoordinate: (l: number) => (Number.isInteger(l) ? (l * 10 + 100) : 0) as never };
  const bars = [{ ts: 0 }, { ts: 60000 }, { ts: 120000 }];
  assert.equal(timeToCoordinate(scale, bars, 60000), 110, "on a bar, its own coordinate");
  assert.equal(timeToCoordinate(scale, bars, 30000), 105, "halfway between two, halfway across");
  assert.equal(timeToCoordinate(scale, bars, 180000), 130, "and past the end, projected at the same spacing");
  assert.equal(timeToCoordinate(scale, [], 0), null, "nothing to place against");
});

console.log(`${checks} label dodge checks passed`);
