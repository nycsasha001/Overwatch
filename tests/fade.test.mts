import assert from "node:assert/strict";
import { advanceFades, syncFades, smooth, FADE_MS, type Fading } from "../src/lib/fade.ts";

let checks = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  checks++;
  console.log(`  ok  ${name}`);
};

/** A stand-in for a shape: the state machine never looks inside the value. */
type Shape = { id: string; edge: number };
const key = (s: Shape) => s.id;

/** Run frames of `ms` until nothing is moving, or the cap trips. Returns the frames taken. */
function settle(tracked: Map<string, Fading<Shape>>, ms = 16, cap = 200) {
  let frames = 0;
  while (advanceFades(tracked, ms) && frames < cap) frames++;
  return frames + 1;
}

ok("a new shape enters from nothing rather than at full strength", () => {
  const t = new Map<string, Fading<Shape>>();
  syncFades(t, [{ id: "a", edge: 1 }], key);
  assert.equal(t.get("a")!.alpha, 0, "it starts invisible");
  assert.equal(t.get("a")!.target, 1);

  advanceFades(t, 16);
  const mid = t.get("a")!.alpha;
  assert.ok(mid > 0 && mid < 1, `part way in after one frame, got ${mid}`);

  settle(t);
  assert.equal(t.get("a")!.alpha, 1, "and lands exactly on full");
});

ok("a fade takes about as long as it says it does", () => {
  const t = new Map<string, Fading<Shape>>();
  syncFades(t, [{ id: "a", edge: 1 }], key);
  const frames = settle(t, 16);
  const elapsed = frames * 16;
  assert.ok(
    Math.abs(elapsed - FADE_MS) <= 32,
    `${FADE_MS}ms fade took ${elapsed}ms — within one frame either side`
  );
});

ok("a departed shape keeps being drawn until it has finished leaving", () => {
  // The bug this exists to prevent: a filled gap vanishing between two frames.
  const t = new Map<string, Fading<Shape>>();
  syncFades(t, [{ id: "a", edge: 1 }], key);
  settle(t);

  syncFades(t, [], key);
  assert.ok(t.has("a"), "still tracked the moment it leaves the data");
  assert.equal(t.get("a")!.target, 0);
  assert.equal(t.get("a")!.alpha, 1, "and still fully drawn on that frame");

  advanceFades(t, 16);
  assert.ok(t.get("a")!.alpha < 1 && t.get("a")!.alpha > 0, "dimming, not gone");

  settle(t);
  assert.equal(t.size, 0, "dropped only once it reached zero");
});

ok("a shape that comes back mid-exit reverses instead of restarting", () => {
  // Stepping across a boundary can drop a gap and bring it straight back. Restarting from zero
  // would read as a blink, which is worse than the pop.
  const t = new Map<string, Fading<Shape>>();
  syncFades(t, [{ id: "a", edge: 1 }], key);
  settle(t);

  syncFades(t, [], key);
  advanceFades(t, 48);
  const partway = t.get("a")!.alpha;
  assert.ok(partway > 0 && partway < 1);

  syncFades(t, [{ id: "a", edge: 1 }], key);
  assert.equal(t.get("a")!.alpha, partway, "picks up from where it got to");
  assert.equal(t.get("a")!.target, 1);
});

ok("moving a shape's geometry does not restart its fade", () => {
  // A box whose right edge advances is the same box. Re-entering it every candle is exactly the
  // flicker being removed.
  const t = new Map<string, Fading<Shape>>();
  syncFades(t, [{ id: "a", edge: 1 }], key);
  settle(t);

  for (let edge = 2; edge < 30; edge++) {
    syncFades(t, [{ id: "a", edge }], key);
    assert.equal(t.get("a")!.alpha, 1, `still solid at edge ${edge}`);
  }
  assert.equal(t.get("a")!.value.edge, 29, "but the geometry is current");
});

ok("shapes fade independently, so one entering does not disturb the rest", () => {
  const t = new Map<string, Fading<Shape>>();
  syncFades(t, [{ id: "a", edge: 1 }, { id: "b", edge: 1 }], key);
  settle(t);

  syncFades(t, [{ id: "a", edge: 1 }, { id: "b", edge: 1 }, { id: "c", edge: 1 }], key);
  advanceFades(t, 16);
  assert.equal(t.get("a")!.alpha, 1);
  assert.equal(t.get("b")!.alpha, 1);
  assert.ok(t.get("c")!.alpha < 1, "only the new one is in motion");
});

ok("an inverted gap crossfades, because colour is part of its identity", () => {
  // Both are present at once at complementary strengths — no frame where the colour simply flips.
  const t = new Map<string, Fading<Shape>>();
  syncFades(t, [{ id: "gap|bull", edge: 1 }], key);
  settle(t);

  syncFades(t, [{ id: "gap|inverse", edge: 1 }], key);
  advanceFades(t, 80);
  assert.equal(t.size, 2, "old and new overlap while they trade places");
  assert.ok(t.get("gap|bull")!.alpha < 1);
  assert.ok(t.get("gap|inverse")!.alpha > 0);
});

ok("a long stall does not make everything jump to the end", () => {
  // A backgrounded tab hands back a delta of seconds. Unclamped, that is the pop again.
  const t = new Map<string, Fading<Shape>>();
  syncFades(t, [{ id: "a", edge: 1 }], key);
  const moving = advanceFades(t, 60_000);
  assert.ok(t.get("a")!.alpha < 1, "still eases in rather than snapping");
  assert.ok(moving);
});

ok("reduced motion snaps, with nothing left behind", () => {
  const t = new Map<string, Fading<Shape>>();
  syncFades(t, [{ id: "a", edge: 1 }], key, false);
  assert.equal(t.get("a")!.alpha, 1, "fully drawn immediately");

  syncFades(t, [], key, false);
  assert.equal(t.size, 0, "and gone immediately");
  assert.equal(advanceFades(t, 16), false, "with no frames requested");
});

ok("advance reports motion honestly, so the frame loop stops", () => {
  const t = new Map<string, Fading<Shape>>();
  assert.equal(advanceFades(t, 16), false, "an empty set is never moving");

  syncFades(t, [{ id: "a", edge: 1 }], key);
  assert.equal(advanceFades(t, 16), true);

  settle(t);
  assert.equal(advanceFades(t, 16), false, "settled means settled");
});

ok("smoothstep eases both ends and stays inside 0..1", () => {
  assert.equal(smooth(0), 0);
  assert.equal(smooth(1), 1);
  assert.equal(smooth(0.5), 0.5, "symmetric about the midpoint");
  assert.ok(smooth(0.1) < 0.1, "slow to leave");
  assert.ok(smooth(0.9) > 0.9, "slow to arrive");
  assert.equal(smooth(-3), 0, "clamped rather than inverted");
  assert.equal(smooth(4), 1);

  let prev = -1;
  for (let i = 0; i <= 20; i++) {
    const v = smooth(i / 20);
    assert.ok(v >= prev, "never goes backwards");
    prev = v;
  }
});

console.log(`\n${checks} fade checks passed`);
