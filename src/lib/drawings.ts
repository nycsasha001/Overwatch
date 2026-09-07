/**
 * Chart drawings.
 *
 * Anchors are stored in data space (timestamp + price) so a drawing stays welded to the bars it
 * was placed against through any pan, zoom or timeframe change. Everything else — hit testing,
 * dragging, handles — happens in pixel space, converted at render time.
 */

export type DrawingKind = "trendline" | "ray" | "rect" | "gann" | "long" | "short";

export interface Anchor {
  t: number; // epoch ms
  price: number;
}

export interface DrawingStyle {
  color: string;
  width: number;
  /** 0 solid, 1 dotted, 2 dashed */
  dash: 0 | 1 | 2;
  /** Legacy rgba string; `fillColor` + `fillOpacity` take precedence when present. */
  fill: string | null;
  fillColor: string | null;
  /** 0–100. */
  fillOpacity: number;
  /**
   * Border opacity, 0–100, independent of the fill.
   *
   * A shaded zone often wants a faint outline or none at all, and tying the two together meant
   * fading the border also faded the thing it was drawn around. `width: 0` removes it entirely.
   */
  strokeOpacity: number;
  /** Rectangle only: draw a dashed line through the middle. */
  midline: boolean;
  extendLeft: boolean;
  extendRight: boolean;
  label: string;
  labelColor: string | null;
  labelSize: number;
  /** Position tools: each level gets its own colour, and prices can be hidden. */
  entryColor: string;
  stopColor: string;
  targetColor: string;
  showPrices: boolean;
  /** Position tools: which extra numbers ride along with the stop/target price. */
  statsFields: ("offset" | "pct" | "ticks")[];
  /** Position tools: collapse the info chips to a single line each. */
  compactStats: boolean;
  /** Position tools: show the info chips even while the drawing isn't selected. */
  alwaysShowStats: boolean;
  /** Trend line / ray endpoint markers. */
  capA: "none" | "arrow";
  capB: "none" | "arrow";
  /** Trend line: a small marker at the segment's midpoint. */
  midpoint: boolean;
  /** Trend line: a Δprice / Δ% / bar-count readout riding along the segment. */
  lineStats: boolean;
  statsPosition: "left" | "center" | "right";
  labelBold: boolean;
  /** Where the label sits relative to the shape, vertically. */
  labelAlign: "inside" | "top" | "bottom";
  /** Where the label sits relative to the shape, horizontally — independent of labelAlign. */
  labelHAlign: "left" | "middle" | "right";
  /** Only draw on timeframes between these two, inclusive. Null means always. */
  visibleFrom: string | null;
  visibleTo: string | null;
}

export interface Drawing {
  id: string;
  kind: DrawingKind;
  /** Entry for the position tools; first corner or endpoint otherwise. */
  a: Anchor;
  /** Stop for the position tools; second corner or endpoint otherwise. */
  b: Anchor;
  /** Target for the position tools. Independent of the stop — no fixed ratio. */
  c?: Anchor;
  style: DrawingStyle;
  locked?: boolean;
}

/** Timeframe order used by the visibility range. */
const TF_ORDER = ["1s", "30s", "1m", "2m", "3m", "4m", "5m", "15m", "1h", "4h", "1d", "1w"];

/** Whether a drawing should be drawn on the timeframe currently displayed. */
export function visibleOn(style: DrawingStyle, tf: string): boolean {
  const i = TF_ORDER.indexOf(tf);
  if (i < 0) return true;
  const from = style.visibleFrom ? TF_ORDER.indexOf(style.visibleFrom) : 0;
  const to = style.visibleTo ? TF_ORDER.indexOf(style.visibleTo) : TF_ORDER.length - 1;
  return i >= (from < 0 ? 0 : from) && i <= (to < 0 ? TF_ORDER.length - 1 : to);
}

export const TIMEFRAME_ORDER = TF_ORDER;

export const DRAWING_LABEL: Record<DrawingKind, string> = {
  trendline: "Trend line",
  ray: "Horizontal ray",
  rect: "Rectangle",
  gann: "Equilibrium",
  long: "Long position",
  short: "Short position",
};

/** Gann box divisions, applied to both the price and the time side of the box. */
/**
 * The only three levels this box draws: the two ends of the range and its midpoint.
 *
 * It is used to read equilibrium — is price in premium or discount relative to the leg — and for
 * that question the quarter and Fibonacci lines are noise. Three lines answer it; seven bury it.
 */
export const GANN_LEVELS = [0, 0.5, 1];

export const DEFAULT_STYLE: DrawingStyle = {
  color: "#ffffff",
  width: 1,
  dash: 0,
  fill: null,
  fillColor: null,
  fillOpacity: 8,
  strokeOpacity: 100,
  midline: false,
  extendLeft: false,
  extendRight: false,
  label: "",
  labelColor: null,
  labelSize: 10,
  entryColor: "#d1d4dc",
  stopColor: "#787b86",
  targetColor: "#ffffff",
  // Off by default: selecting the drawing reveals them, so the chart stays quiet at rest.
  showPrices: false,
  statsFields: ["pct", "ticks"],
  compactStats: false,
  alwaysShowStats: true,
  capA: "none",
  capB: "none",
  midpoint: false,
  lineStats: false,
  statsPosition: "right",
  labelBold: false,
  labelAlign: "top",
  labelHAlign: "left",
  visibleFrom: null,
  visibleTo: null,
};

/** Per-tool starting styles. Overridden by saved templates. */
export const TOOL_DEFAULTS: Record<DrawingKind, Partial<DrawingStyle>> = {
  // Quiet until asked for: a trend line's stats and always-on chip are opt-in, unlike a
  // position's, which exists to be read at a glance.
  trendline: { alwaysShowStats: false },
  // A horizontal ray: anchored at a price, running forward from where it was placed.
  ray: { extendRight: true, dash: 0, alwaysShowStats: false },
  rect: { fillColor: "#ffffff", fillOpacity: 6, midline: true },
  gann: { fillColor: "#ffffff", fillOpacity: 3 },
  // The position tools stay grey so they read as trade objects rather than analysis.
  long: { color: "#d1d4dc", fillColor: "#d1d4dc", fillOpacity: 10 },
  short: { color: "#9598a1", fillColor: "#9598a1", fillOpacity: 10 },
};

export const styleFor = (kind: DrawingKind, template?: Partial<DrawingStyle>): DrawingStyle => ({
  ...DEFAULT_STYLE,
  ...TOOL_DEFAULTS[kind],
  ...(template ?? {}),
});

/** Resolve a fill to a CSS colour, preferring the editable colour + opacity pair. */
/** A hex colour at a given opacity (0–100), as an rgba() string. Used wherever a fill needs to
 *  track some other colour setting rather than its own dedicated one. */
export function rgbaFromHex(hex: string | null | undefined, opacityPct: number): string | undefined {
  if (!hex) return undefined;
  const stripped = hex.replace("#", "");
  const full = stripped.length === 3 ? stripped.split("").map((c) => c + c).join("") : stripped;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return undefined;
  return `rgba(${r},${g},${b},${Math.min(Math.max(opacityPct, 0), 100) / 100})`;
}

export function fillOf(style: DrawingStyle): string | undefined {
  if (style.fillColor) return rgbaFromHex(style.fillColor, style.fillOpacity);
  return style.fill ?? undefined;
}

/* ------------------------------- geometry -------------------------------- */

export interface Pt {
  x: number;
  y: number;
}

/** Shortest distance from a point to a line segment, in pixels. */
export function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance to the border of a rectangle; zero when the point is inside it. */
export function distanceToRect(p: Pt, a: Pt, b: Pt): number {
  const x1 = Math.min(a.x, b.x);
  const x2 = Math.max(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const y2 = Math.max(a.y, b.y);
  if (p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2) return 0;
  const dx = Math.max(x1 - p.x, 0, p.x - x2);
  const dy = Math.max(y1 - p.y, 0, p.y - y2);
  return Math.hypot(dx, dy);
}

export const HIT_TOLERANCE = 6;

/** Whether a pointer at `p` is over a drawing, given its two anchors in pixels. */
export function hitTest(kind: DrawingKind, p: Pt, a: Pt, b: Pt, width: number): boolean {
  switch (kind) {
    case "ray":
      // Anchored at a price and only live from its start point rightwards.
      return Math.abs(p.y - a.y) <= HIT_TOLERANCE && p.x >= Math.min(a.x, b.x) - HIT_TOLERANCE;
    case "rect":
    case "gann":
    case "long":
    case "short":
      return distanceToRect(p, a, b) <= HIT_TOLERANCE;
    default:
      return distanceToSegment(p, a, b) <= HIT_TOLERANCE + width;
  }
}

/** Extend a segment to the edges of a viewport, for rays and extended lines. */
export function extendSegment(a: Pt, b: Pt, width: number, left: boolean, right: boolean): [Pt, Pt] {
  if (!left && !right) return [a, b];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return [a, b];
  const slope = dy / (dx === 0 ? 1e-9 : dx);
  const at = (x: number): Pt => ({ x, y: a.y + (x - a.x) * slope });
  return [left ? at(0) : a, right ? at(width) : b];
}

/**
 * Shift-constrained drawing: snap a point to horizontal, vertical or 45° from its origin,
 * whichever the pointer is closest to. Worked in pixel space so the result looks straight on
 * screen regardless of how the axes are scaled.
 */
export function constrainToAxis(start: Pt, current: Pt): Pt {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx > ady * 2) return { x: current.x, y: start.y };
  if (ady > adx * 2) return { x: start.x, y: current.y };
  const m = Math.min(adx, ady);
  return { x: start.x + Math.sign(dx) * m, y: start.y + Math.sign(dy) * m };
}

/**
 * A long/short position box. Entry, stop and target are three independent prices — drag any of
 * them anywhere. The ratio shown is whatever those levels produce, never something imposed.
 *
 * Older drawings stored without a target fall back to twice the stop distance so they still open.
 */
/**
 * Timestamp ↔ logical bar index.
 *
 * The charting library can only map a time to a pixel when that exact timestamp is on the scale,
 * so anything between bars or past the last candle comes back as null — which made drawings
 * vanish the moment they were dragged into the empty space on the right. Converting through a
 * fractional bar index instead keeps every position mappable, interpolating between bars and
 * extrapolating beyond them at the prevailing spacing.
 */
export function logicalForTime(bars: { ts: number }[], t: number): number | null {
  if (!bars.length) return null;
  if (bars.length === 1) return 0;

  const first = bars[0].ts;
  const last = bars[bars.length - 1].ts;
  if (t <= first) {
    const spacing = bars[1].ts - first || 1;
    return (t - first) / spacing;
  }
  if (t >= last) {
    const spacing = last - bars[bars.length - 2].ts || 1;
    return bars.length - 1 + (t - last) / spacing;
  }

  let lo = 0;
  let hi = bars.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].ts <= t) lo = mid;
    else hi = mid;
  }
  const span = bars[hi].ts - bars[lo].ts || 1;
  return lo + (t - bars[lo].ts) / span;
}

/** Inverse of logicalForTime. */
export function timeForLogical(bars: { ts: number }[], logical: number): number | null {
  if (!bars.length) return null;
  if (bars.length === 1) return bars[0].ts;

  if (logical <= 0) {
    const spacing = bars[1].ts - bars[0].ts || 1;
    return Math.round(bars[0].ts + logical * spacing);
  }
  if (logical >= bars.length - 1) {
    const spacing = bars[bars.length - 1].ts - bars[bars.length - 2].ts || 1;
    return Math.round(bars[bars.length - 1].ts + (logical - (bars.length - 1)) * spacing);
  }
  const lo = Math.floor(logical);
  const frac = logical - lo;
  return Math.round(bars[lo].ts + frac * (bars[lo + 1].ts - bars[lo].ts));
}

/**
 * Clamp a shape's horizontal span to the visible plot.
 *
 * An anchor that now sits outside the loaded bars extrapolates to a coordinate far off-screen,
 * and an unclamped rectangle drawn from it stretches across the whole chart. Clamping keeps the
 * box where it belongs and collapses it to nothing when it is genuinely out of view.
 */
export function clampSpan(x1: number, x2: number, width: number, margin = 2): { x: number; w: number } {
  const lo = Math.min(x1, x2);
  const hi = Math.max(x1, x2);
  const left = Math.max(lo, -margin);
  const right = Math.min(hi, width + margin);
  return { x: left, w: Math.max(right - left, 0) };
}

export type MagnetMode = "off" | "weak" | "strong";

/** Pixel radius within which the weak magnet grabs a candle level. */
export const MAGNET_RADIUS = 18;

export interface OhlcLike {
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * The candle level a price should snap to: a wick (high/low) or a body edge (open/close).
 *
 * Weak magnet passes a small radius, so the pointer stays free between levels. Strong magnet
 * passes Infinity, so it always lands on the nearest one.
 */
export function nearestCandleLevel(
  bar: OhlcLike,
  price: number,
  within: number
): { price: number; kind: "high" | "low" | "open" | "close" } | null {
  const options: { price: number; kind: "high" | "low" | "open" | "close" }[] = [
    { price: bar.high, kind: "high" },
    { price: bar.low, kind: "low" },
    { price: bar.open, kind: "open" },
    { price: bar.close, kind: "close" },
  ];
  let best: { price: number; kind: "high" | "low" | "open" | "close" } | null = null;
  let bestDistance = within;
  for (const o of options) {
    const d = Math.abs(o.price - price);
    if (d <= bestDistance) {
      bestDistance = d;
      best = o;
    }
  }
  return best;
}

export function positionLevels(d: Drawing): { entry: number; stop: number; target: number; rr: number | null } {
  const entry = d.a.price;
  const stop = d.b.price;
  const risk = Math.abs(entry - stop);
  const fallback = d.kind === "long" ? entry + risk * 2 : entry - risk * 2;
  const target = d.c?.price ?? fallback;
  return { entry, stop, target, rr: risk > 0 ? Math.abs(target - entry) / risk : null };
}

/** A new position drawing: the drag sets entry and stop, the target starts two R away. */
export function seedPosition(kind: "long" | "short", a: Anchor, b: Anchor): Anchor {
  const risk = Math.abs(a.price - b.price);
  return { t: b.t, price: kind === "long" ? a.price + risk * 2 : a.price - risk * 2 };
}

/**
 * Where a drawing's text label sits.
 *
 * Pulled out of the rendering because the same decision is made for several shapes and was being
 * re-derived inline each time — the rectangle grew a full left/middle/right × above/inside/below
 * grid, while the horizontal ray had its label nailed to `x + 6, y - 5` and no way to move it.
 *
 * Works in screen pixels against the span the shape occupies. `y` is the line for a ray or a trend
 * line, and the relevant edge for a box.
 */
export function labelPlacement(opts: {
  /** Left and right edge of the shape, in pixels. */
  x1: number;
  x2: number;
  /** The line, or the edge the label is being placed against. */
  y: number;
  hAlign: "left" | "middle" | "right";
  vAlign: "inside" | "top" | "bottom";
  fontSize: number;
  /** Gap between the text and the line it belongs to. */
  pad?: number;
}): { x: number; y: number; anchor: "start" | "middle" | "end" } {
  const pad = opts.pad ?? 6;
  const left = Math.min(opts.x1, opts.x2);
  const right = Math.max(opts.x1, opts.x2);

  const x = opts.hAlign === "middle" ? (left + right) / 2 : opts.hAlign === "right" ? right - pad : left + pad;
  const anchor = opts.hAlign === "middle" ? "middle" : opts.hAlign === "right" ? "end" : "start";

  /**
   * SVG text sits on its baseline, which is why each case shifts by a different amount.
   *
   * "Above" lifts the baseline clear of the line. "Below" has to drop by a whole font size, since
   * the baseline is the *bottom* of the text and anything less would leave it straddling. "Inside"
   * centres the glyphs on the line — roughly a third of the size, not half, because most of a
   * capital sits above the baseline.
   */
  const y =
    opts.vAlign === "bottom" ? opts.y + opts.fontSize + pad / 2 : opts.vAlign === "inside" ? opts.y + opts.fontSize * 0.34 : opts.y - pad / 2 - 1;

  return { x, y, anchor };
}
