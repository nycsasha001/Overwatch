import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  Logical,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";
import { logicalForTime } from "@/lib/drawings";
import { advanceFades, smooth, syncFades, type Fading } from "@/lib/fade";
import { etDateTime } from "@/lib/session";
import type { Box, Level, Po3Candle } from "@/lib/indicators";
import type { Candle } from "@/lib/aggregate";

export interface IndicatorData {
  boxes: Box[];
  levels: Level[];
  po3: Po3Candle[];
  po3Style: { color: string; offset: number; width: number };
  bars: Candle[];
  /** Bar being hovered while picking a replay start point. */
  selection?: number | null;
}

const EMPTY: IndicatorData = {
  boxes: [],
  levels: [],
  po3: [],
  po3Style: { color: "#d1d4dc", offset: 13, width: 2 },
  bars: [],
  selection: null,
};

/**
 * Indicators drawn as a chart primitive rather than as an overlay.
 *
 * An HTML overlay can only be repositioned after React re-renders, which is always a frame behind
 * the canvas — so during a pan the boxes and levels visibly lag the candles. A primitive is drawn
 * by the chart itself, inside the same paint, using coordinates resolved at that instant. There is
 * no lag to chase because there is no second surface.
 */
/**
 * Identity of a box across recomputes.
 *
 * `from` is the timestamp of the gap's first candle, which is enough on its own: each three-candle
 * window yields at most one gap, so no two boxes in a result can share it. Nothing else about the
 * geometry belongs in the key.
 *
 * That is the whole point. During a replay the last bar is a candle still forming, so a gap
 * sitting against it has a top or bottom that moves on every step. Keying on those made each step
 * look like the old box leaving and a new one arriving — two nearly-identical boxes crossfading
 * over each other, which is worse than the pop the fade was added to remove. Keyed on `from`, the
 * same box simply changes shape.
 *
 * Colour and label stay in, and only they: a gap that inverts keeps its coordinates but changes
 * both, so it crossfades into its inverse for free rather than flipping between two frames.
 */
const boxKey = (b: Box) => `${b.from}|${b.color}|${b.label ?? ""}`;

export class IndicatorPrimitive {
  private data: IndicatorData = EMPTY;
  private attachedTo: SeriesAttachedParameter<Time> | null = null;
  private readonly view: IPrimitivePaneView;
  private readonly selectionView: IPrimitivePaneView;

  /** Boxes currently on screen, including ones that have left the data but not yet faded out. */
  private readonly fades = new Map<string, Fading<Box>>();
  private frame: number | null = null;
  private lastTick = 0;
  private readonly animate: boolean;

  constructor() {
    const self = this;
    this.animate =
      typeof window !== "undefined" && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // Drawn above the candles: it has to shade them, not sit behind them.
    this.selectionView = {
      zOrder: () => "top",
      renderer: (): IPrimitivePaneRenderer => ({
        draw: (target) => {
          target.useMediaCoordinateSpace((scope) =>
            self.renderSelection(scope.context, scope.mediaSize.width, scope.mediaSize.height)
          );
        },
      }),
    };
    this.view = {
      zOrder: () => "bottom",
      renderer: (): IPrimitivePaneRenderer => ({
        draw: (target) => {
          target.useMediaCoordinateSpace((scope) => self.render(scope.context, scope.mediaSize.width, scope.mediaSize.height));
        },
      }),
    };
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this.attachedTo = param;
  }

  detached() {
    this.attachedTo = null;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.fades.clear();
  }

  updateAllViews() {}

  paneViews(): IPrimitivePaneView[] {
    return [this.view, this.selectionView];
  }

  /**
   * Preview while choosing where to start a replay: everything from the hovered bar onwards is
   * dimmed, because that is what will be hidden, and the boundary is marked.
   */
  private renderSelection(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const ts = this.data.selection;
    if (ts === null || ts === undefined) return;
    const x = this.xOf(ts);
    if (x === null) return;

    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.62)";
    ctx.fillRect(x, 0, Math.max(width - x, 0), height);

    // White rather than a hue: it sits directly against the shaded future, so brightness alone is
    // enough contrast and the chart stays monochrome.
    ctx.strokeStyle = "#e7eaee";
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();

    /**
     * The instant the replay would start from, written against the line.
     *
     * Without it the only way to find out where a click lands is to click and then read the
     * header — which, if it was the wrong bar, means restarting the session to try again.
     */
    const { date, time } = etDateTime(ts);
    const label = `${date}  ${time} ET`;
    ctx.font = "11px ui-sans-serif, -apple-system, sans-serif";
    const padX = 7;
    const boxW = ctx.measureText(label).width + padX * 2;
    const boxH = 20;
    const top = 10;
    // Flipped to the other side of the line when it would otherwise run off the edge, so the
    // label stays readable as the cursor approaches the right of the chart.
    const left = x + 9 + boxW <= width ? x + 9 : Math.max(x - 9 - boxW, 2);

    ctx.fillStyle = "rgba(8,8,8,0.94)";
    ctx.strokeStyle = "rgba(231,234,238,0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    // roundRect is not in every engine this could run in; a square chip is a fine fallback.
    if (typeof ctx.roundRect === "function") ctx.roundRect(left, top, boxW, boxH, 4);
    else ctx.rect(left, top, boxW, boxH);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#e7eaee";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, left + padX, top + boxH / 2 + 0.5);
    ctx.restore();
  }

  setData(data: IndicatorData) {
    this.data = data;
    syncFades(this.fades, data.boxes, boxKey, this.animate);
    this.schedule();
    this.attachedTo?.requestUpdate();
  }

  /**
   * Drive the fades from the frame clock rather than from the data.
   *
   * Only the chart is asked to repaint — never React. A candle arriving is one state update; the
   * frames that follow it are the chart redrawing its own pane, so an animation running during a
   * replay costs nothing above the paint it was already doing.
   */
  private schedule() {
    if (this.frame !== null || !this.animate) return;
    this.lastTick = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  private readonly tick = () => {
    this.frame = null;
    const now = performance.now();
    const moving = advanceFades(this.fades, now - this.lastTick);
    this.lastTick = now;
    // One more frame while anything is in motion; the final settled state still gets painted by
    // the requestUpdate below, so the animation ends on the exact target rather than near it.
    if (moving) this.frame = requestAnimationFrame(this.tick);
    this.attachedTo?.requestUpdate();
  };

  private get series(): ISeriesApi<SeriesType, Time> | null {
    return (this.attachedTo?.series as ISeriesApi<SeriesType, Time> | undefined) ?? null;
  }

  private get chart(): IChartApi | null {
    return (this.attachedTo?.chart as IChartApi | undefined) ?? null;
  }

  /** Time to x, through a fractional bar index so it works between and beyond bars. */
  private xOf(ts: number): number | null {
    const chart = this.chart;
    const { bars } = this.data;
    if (!chart || !bars.length) return null;
    const logical = logicalForTime(bars, ts);
    if (logical === null) return null;
    return chart.timeScale().logicalToCoordinate(logical as Logical) ?? null;
  }

  private yOf(price: number): number | null {
    return this.series?.priceToCoordinate(price) ?? null;
  }

  private render(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const { levels, po3, po3Style } = this.data;
    if (!this.fades.size && !levels.length && !po3.length) return;

    ctx.save();
    ctx.font = "9px ui-sans-serif, -apple-system, sans-serif";

    for (const fading of this.fades.values()) {
      const b = fading.value;
      const alpha = smooth(fading.alpha);
      // Below this it is not distinguishable from nothing, and skipping it saves the coordinate
      // lookups on every box that is mid-entry.
      if (alpha < 0.004) continue;
      const x1 = this.xOf(b.from);
      const yTop = this.yOf(b.top);
      const yBottom = this.yOf(b.bottom);
      if (x1 === null || yTop === null || yBottom === null) continue;
      const x2 = b.to === Infinity ? width : this.xOf(b.to) ?? width;
      const left = Math.max(Math.min(x1, x2), 0);
      const right = Math.min(Math.max(x1, x2), width);
      const w = right - left;
      if (w <= 0) continue;

      const top = Math.min(yTop, yBottom);
      const h = Math.abs(yBottom - yTop);

      // Set before the fill and left in place for the midline and label below, so the box dims as
      // one object. globalAlpha multiplies whatever opacity each part already carries.
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = b.color;
      ctx.fillRect(left, top, w, h);

      // Where the label will sit, worked out before the midline is drawn so the line can be
      // broken around it — the two share the gap's centre line and would otherwise overlap.
      const pos = b.labelPosition ?? "right";
      // Bound once so the type narrows and the text is measured exactly as it will be drawn.
      const label = pos !== "hidden" && h > 9 ? b.label ?? "" : "";
      const showLabel = label.length > 0;
      const labelW = showLabel ? ctx.measureText(label).width : 0;
      const labelX = pos === "center" ? left + w / 2 : pos === "left" ? left + 4 : left + w - 4;
      const gapFrom = pos === "center" ? labelX - labelW / 2 : pos === "left" ? labelX : labelX - labelW;
      const gapTo = pos === "center" ? labelX + labelW / 2 : pos === "left" ? labelX + labelW : labelX;

      if (b.midline && h > 5) {
        const mid = top + h / 2;
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.3)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        if (showLabel && gapTo > left && gapFrom < left + w) {
          ctx.moveTo(left, mid);
          ctx.lineTo(Math.max(left, gapFrom - 4), mid);
          ctx.moveTo(Math.min(left + w, gapTo + 4), mid);
          ctx.lineTo(left + w, mid);
        } else {
          ctx.moveTo(left, mid);
          ctx.lineTo(left + w, mid);
        }
        ctx.stroke();
        ctx.restore();
      }

      if (showLabel) {
        // Sat on the gap's vertical midpoint rather than pinned under its top edge. The label
        // names the whole gap, so hanging it off one boundary made it read as belonging to that
        // edge — and on a thin gap it collided with the candles above.
        ctx.save();
        ctx.fillStyle = "rgba(149,152,161,0.85)";
        ctx.textAlign = pos === "center" ? "center" : pos === "left" ? "left" : "right";
        ctx.textBaseline = "middle";
        ctx.fillText(label, labelX, top + h / 2);
        ctx.restore();
      }

      ctx.restore();
    }

    for (const l of levels) {
      const y = this.yOf(l.price);
      const x1 = this.xOf(l.from);
      if (y === null || x1 === null) continue;
      const x2 = l.to === Infinity ? width : this.xOf(l.to) ?? width;
      const left = Math.max(Math.min(x1, x2), 0);
      const right = Math.min(Math.max(x1, x2), width);
      if (right - left <= 0) continue;

      ctx.save();
      // A swept level is not drawn any differently — it just stops at the candle that swept it.
      // Where a line ends already says everything dimming it would, and a level that changes
      // appearance the moment it is tapped makes the chart move when the price did not.
      ctx.strokeStyle = l.color;
      ctx.lineWidth = 1;
      ctx.setLineDash(l.dashed ? [4, 3] : []);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      if (l.label) {
        ctx.setLineDash([]);
        ctx.fillStyle = l.color;
        ctx.textAlign = "left";
        ctx.fillText(l.label, left + 4, y - 3);
      }
      ctx.restore();
    }

    if (po3.length) {
      const spacing = this.chart?.timeScale().options().barSpacing ?? 6;
      const slot = Math.max(spacing * po3Style.width, 6);
      const gap = Math.max(spacing, 3);
      const startX = width - (po3.length * (slot + gap) + spacing * po3Style.offset);

      po3.forEach((c, i) => {
        const yO = this.yOf(c.open);
        const yH = this.yOf(c.high);
        const yL = this.yOf(c.low);
        const yC = this.yOf(c.close);
        if (yO === null || yH === null || yL === null || yC === null) return;
        const x = startX + i * (slot + gap);
        const mid = x + slot / 2;

        ctx.save();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(mid, yH);
        ctx.lineTo(mid, yL);
        ctx.stroke();

        const bodyTop = Math.min(yO, yC);
        const bodyHeight = Math.max(Math.abs(yC - yO), 1);
        ctx.fillStyle = c.close >= c.open ? po3Style.color : "#000000";
        ctx.fillRect(x, bodyTop, slot, bodyHeight);
        ctx.strokeStyle = po3Style.color;
        ctx.setLineDash(c.complete ? [] : [3, 2]);
        ctx.strokeRect(x, bodyTop, slot, bodyHeight);
        ctx.restore();
      });
    }

    ctx.restore();
    void height;
  }
}
