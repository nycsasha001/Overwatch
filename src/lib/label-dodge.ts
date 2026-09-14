/**
 * Keeping an indicator's label out from under text you wrote.
 *
 * A session level's name used to be nailed to the left end of its line, just above it. That is
 * also exactly where a horizontal ray puts the label typed onto it, and the two surfaces cannot
 * see each other — the ray is SVG drawn over the canvas — so both landed in the same place and
 * neither could be read. The level gives way: it has three other places it can sit, and the
 * written text has been put where it is on purpose.
 */

export interface TextBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The box a run of text occupies, from where its baseline is anchored.
 *
 * Ascenders reach about the full font size above the baseline and descenders a quarter below it;
 * generous, since the cost of a box that is too tight is the overlap this exists to prevent.
 */
export function textBox(x: number, baseline: number, width: number, fontSize: number, anchor: "start" | "middle" | "end"): TextBox {
  const left = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
  return { left, top: baseline - fontSize, right: left + width, bottom: baseline + fontSize * 0.25 };
}

/** True when the two boxes touch, allowing a small breathing space between them. */
export function boxesOverlap(a: TextBox, b: TextBox, margin = 2): boolean {
  return a.left < b.right + margin && a.right > b.left - margin && a.top < b.bottom + margin && a.bottom > b.top - margin;
}

export interface LevelLabelSpot {
  x: number;
  y: number;
  anchor: "start" | "end";
  box: TextBox;
}

/**
 * Where a level's label goes.
 *
 * At the left end above the line unless something is already there; then below it, then the
 * right end, above and below. Every spot taken, it falls back to the first — two labels on top
 * of each other is still better than a label nowhere near its line. The caller passes back what
 * it has already placed, so levels keep clear of each other as well as of drawings.
 */
export function placeLevelLabel(opts: {
  /** Where the line runs, in pixels, already clamped to the plot. */
  left: number;
  right: number;
  /** The line itself. */
  y: number;
  /** The label's measured width. */
  width: number;
  fontSize: number;
  avoid: TextBox[];
  /** Inset from the end of the line. */
  pad?: number;
}): LevelLabelSpot {
  const pad = opts.pad ?? 4;
  const gap = 3;
  const above = opts.y - gap;
  const below = opts.y + opts.fontSize + gap;
  const candidates: [number, number, "start" | "end"][] = [
    [opts.left + pad, above, "start"],
    [opts.left + pad, below, "start"],
    [opts.right - pad, above, "end"],
    [opts.right - pad, below, "end"],
  ];
  let first: LevelLabelSpot | null = null;
  for (const [x, y, anchor] of candidates) {
    const box = textBox(x, y, opts.width, opts.fontSize, anchor);
    const spot = { x, y, anchor, box };
    first ??= spot;
    if (!opts.avoid.some((b) => boxesOverlap(box, b))) return spot;
  }
  return first as LevelLabelSpot;
}
