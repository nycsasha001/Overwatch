"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type Logical,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { CORE_TIMEFRAMES, TIMEFRAMES, ensureAscending, type Timeframe } from "@/lib/aggregate";
import { diffBars } from "@/lib/series-sync";
import { createSeriesMarkers, type ISeriesMarkersPluginApi, type SeriesMarker } from "lightweight-charts";
import { Spinner } from "./ui";
import { DrawingLayer, type Converters } from "./drawing-layer";
import { ExecutionMarkers, type ExecutionMark } from "./execution-markers";
import { IndicatorPrimitive } from "./indicator-primitive";
import type { Box, Level, Po3Candle } from "@/lib/indicators";
import { logicalForTime, timeForLogical } from "@/lib/drawings";
import type { Drawing, DrawingKind, DrawingStyle, MagnetMode } from "@/lib/drawings";

/**
 * How large the order chips on the entry, stop and target lines are drawn.
 *
 * Gathered here rather than scattered through the markup because these numbers depend on each
 * other: the chip must be centred on its own line, so its offset is always half its height, and
 * the drag strip has to stay at least as tall as the chip or the target you can see is smaller
 * than the target you can hit.
 *
 * Sized to be read at a glance from across a desk. A chip that competes with the candles is the
 * wrong trade-off on a chart you are making decisions from.
 */
export const LEVEL_CHIP = {
  /** TradingView's order chip is a low, tight rectangle — 20px tall with 11px type. */
  height: 20,
  /** Half the height, negated — what centres the chip on its line. */
  get offset() {
    return -this.height / 2;
  },
  fontSize: 11,
  /** The drag strip, kept a little taller than the chip so the whole thing is grabbable. */
  grabHeight: 20,
  get grabOffset() {
    return -this.grabHeight / 2;
  },
  /** Line weight, resting and while being dragged. A working order is a hairline until touched. */
  lineWidth: 1,
  lineWidthActive: 2,
  /** Barely rounded, the way a platform's order line is. */
  radius: 2,
  /** The fill behind the chip and its axis tag: the chart, darkened, so candles do not read through. */
  fill: "rgba(10,10,12,0.92)",
} as const;

/**
 * Monochrome chart palette, deliberately independent of the interface theme. Direction is read
 * from the candle body fill (light = up, black = down) rather than from colour, so the chart is
 * unaffected by whatever the surrounding UI is painted.
 */
export const CHART = {
  // Off-black rather than #000. A pure-black canvas against grey chrome reads as a hole; a couple
  // of points of lift gives the pane a surface, and the candles are still the brightest thing on it.
  background: "#0a0a0c",
  text: "#d1d4dc",
  border: "#2a2e39",
  crosshair: "#9598a1",
  upBody: "#d1d4dc",
  downBody: "#0a0a0c",
  candleBorder: "#d1d4dc",
  wick: "#ffffff",
  entry: "#d1d4dc",
  /**
   * The two outcomes a trade can end on, in the two colours every platform ends them in.
   *
   * These are not the direction colours below and must not be read as them: blue and red say
   * which way a live order faces, red and green say which side of it you came off on. A stop and
   * a short order share a red because a stop *is* a hypothetical exit against you — what tells
   * them apart on the chart is the label, and that the stop is dashed.
   */
  stop: "#f23645",
  target: "#089981",
  exit: "#5d606b",
  markerNeutral: "#787b86",
  markerBright: "#d1d4dc",
  /**
   * Working orders and open positions, coloured by side.
   *
   * The two colours every platform uses for this, and TradingView's exact values: a buy is blue,
   * a sell is red, whatever the instrument and whoever is looking. Direction is the one thing on
   * an order line you must not have to read — the colour has to say it before the label does.
   */
  buy: "#2962ff",
  sell: "#f23645",
  // Order-fill markers: blue for a long, red for a short — independent of win/loss.
  executionLong: "#2962ff",
  executionShort: "#f23645",
} as const;

/** Timeframes that actually hold bars for a symbol, in display order. */
export function useAvailableTimeframes(symbol: string): Timeframe[] {
  const [available, setAvailable] = useState<Timeframe[]>(CORE_TIMEFRAMES);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/market/coverage")
      .then((r) => r.json())
      .then((j: { coverage: { symbol: string; timeframe: Timeframe; bars: number }[] }) => {
        if (cancelled) return;
        const mine = (j.coverage ?? []).filter((c) => c.symbol === symbol && c.bars > 0).map((c) => c.timeframe);
        setAvailable(mine.length ? TIMEFRAMES.filter((t) => mine.includes(t)) : CORE_TIMEFRAMES);
      })
      .catch(() => setAvailable(CORE_TIMEFRAMES));
    return () => {
      cancelled = true;
    };
  }, [symbol]);
  return available;
}

export interface ChartLevel {
  price: number;
  label: string;
  color: string;
  dashed?: boolean;
  /** Identifies the level to drag callbacks. Required for draggable levels. */
  id?: string;
  draggable?: boolean;
  /** Secondary text shown in the level's tag, e.g. an R multiple. */
  note?: string;
  /**
   * Contracts this line is for, drawn as the filled leading segment of the chip.
   *
   * TradingView puts the size first, in solid colour, because it is the number you check before
   * anything else — where you get in matters less than how much of you is getting in.
   */
  qty?: number;
  /** Editable size. Only working orders qualify; changing a live position means a partial fill. */
  qtyEditable?: boolean;
  /** Middle segment: an order type like LMT or STP, or a running result like "+152 ticks". */
  tag?: string;
  /** Colours the middle segment when it carries a result rather than a label. */
  tagTone?: "pos" | "neg";
  /** Bounds enforced while dragging, so a stop cannot cross its entry. */
  min?: number;
  max?: number;
  /** Shade the band between this level and another price (the risk or reward zone). */
  zoneTo?: number;
  zoneColor?: string;
  /** Show a remove control on the level's tag. */
  removable?: boolean;
}

interface Candle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function formatSpan(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/**
 * Crosshair readout.
 *
 * The weekday is spelled out because which day of the week it is decides whether a setup is worth
 * taking at all. The year is here because this chart is mostly used on historical data — scrolling
 * back through several years of bars, "Sep 01" alone tells you nothing about which September you
 * are looking at, and the answer matters when you are checking a setup against what the market was
 * doing at the time.
 */
const etTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "long",
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const etAxis = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const etDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "2-digit",
});

/**
 * The axis tick for the first bar of a year.
 *
 * Every midnight tick carrying a year would clutter the axis; a bare year at the boundary is how
 * a chart says "you have scrolled into 2024" without repeating it two hundred times.
 */
/**
 * Whether two instants fall on the same New York day.
 *
 * Used to decide whether the projected time label needs a date. Dragging a few bars past the close
 * is still "today" and wants a bare clock; dragging far enough to cross midnight needs to say so,
 * or the time reads as the same session when it is not.
 */
function sameEtDay(a: number, b: number | undefined): boolean {
  if (b === undefined) return false;
  return etDate.format(a) === etDate.format(b);
}

const etYear = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric" });
const etMonthNum = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "numeric" });
const etDayNum = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", day: "numeric" });

/**
 * Candlestick chart over stored bars. All times are displayed in New York time, because that is
 * the session the strategy is defined in — the axis would be misleading in UTC or local time.
 */
export function PriceChart({
  symbol,
  timeframe,
  onTimeframeChange,
  centerTs,
  barsEitherSide = 180,
  levels = [],
  height = 420,
  timeframes,
  data,
  markers = [],
  followCursor = false,
  emptyMessage,
  onBarClick,
  fill = false,
  showTimeframeOverlay = false,
  onLevelDrag,
  onLevelDragEnd,
  onLevelRemove,
  onLevelQty,
  tickSize = 0.25,
  measure = false,
  onMeasureDone,
  measureRiskPoints,
  drawings,
  onDrawingsChange,
  tool = null,
  onToolDone,
  selectedDrawingId = null,
  onSelectDrawing,
  onOpenDrawingSettings,
  drawingTemplate,
  executions,
  magnet = "off",
  indicatorBoxes,
  indicatorLevels,
  po3,
  po3Style,
  selectionTs,
  resetSignal,
  captureRef,
  onPriceContextMenu,
  onCrosshairBar,
}: {
  symbol: string;
  timeframe: Timeframe;
  onTimeframeChange?: (tf: Timeframe) => void;
  /** Focus the view on this instant (a trade's entry, say). */
  centerTs?: number | null;
  barsEitherSide?: number;
  levels?: ChartLevel[];
  height?: number;
  /** Restrict the switcher; by default it shows whichever timeframes actually hold bars. */
  timeframes?: Timeframe[];
  /** Supply bars directly instead of fetching — used by replay, which controls what is visible. */
  data?: Candle[] | null;
  markers?: { ts: number; position: "aboveBar" | "belowBar"; color: string; shape: "arrowUp" | "arrowDown" | "circle"; text?: string }[];
  /** Keep the newest bar in view instead of refitting the whole range on every update. */
  followCursor?: boolean;
  emptyMessage?: string;
  /** Fires with the clicked bar's timestamp in epoch ms. Used by replay's "select bar". */
  onBarClick?: (ts: number) => void;
  /** Fill the parent element instead of using a fixed height. */
  fill?: boolean;
  /** Draw the small timeframe switcher over the chart. Off by default — use a toolbar. */
  showTimeframeOverlay?: boolean;
  /** Fires continuously while a draggable level is moved. */
  onLevelDrag?: (id: string, price: number) => void;
  onLevelDragEnd?: (id: string, price: number) => void;
  onLevelRemove?: (id: string) => void;
  /** A level's size was edited on the chart. */
  onLevelQty?: (id: string, contracts: number) => void;
  /** Prices snap to this increment while dragging. */
  tickSize?: number;
  /** Ruler: drag across the chart to measure price and time. */
  measure?: boolean;
  onMeasureDone?: () => void;
  /** When set, the ruler also reports the measured move in R. */
  measureRiskPoints?: number;
  drawings?: Drawing[];
  onDrawingsChange?: (next: Drawing[]) => void;
  tool?: DrawingKind | null;
  onToolDone?: () => void;
  selectedDrawingId?: string | null;
  onSelectDrawing?: (id: string | null) => void;
  onOpenDrawingSettings?: (id: string) => void;
  drawingTemplate?: Partial<DrawingStyle>;
  /** TradingView-style fill markers: an arrow tethered to the exact price/time of each execution. */
  executions?: ExecutionMark[];
  magnet?: MagnetMode;
  indicatorBoxes?: Box[];
  indicatorLevels?: Level[];
  po3?: Po3Candle[];
  po3Style?: { color: string; offset: number; width: number };
  /** Highlights a replay start point and shades everything after it. */
  selectionTs?: number | null;
  /** Bump to recentre the chart: default zoom, scrolled to the newest bar, price autoscaled. */
  resetSignal?: number;
  /** Receives a function that renders the current chart — candles, indicators and drawings — to a PNG. */
  captureRef?: React.MutableRefObject<(() => Promise<Blob | null>) | null>;
  /** Right-click inside the plot, with the price and time under the pointer. */
  onPriceContextMenu?: (info: { price: number; ts: number; x: number; y: number }) => void;
  /**
   * The bar under the crosshair, for a chart legend. Null when the pointer leaves.
   * `ts` is always populated — extrapolated past the last candle, or before the first, the same
   * way a dragged drawing's anchor is — even where there is no bar to report OHLC for.
   */
  onCrosshairBar?: (bar: { ts: number; open?: number; high?: number; low?: number; close?: number } | null) => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLines = useRef<IPriceLine[]>([]);
  const markersApi = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState<Timeframe[] | null>(null);

  // Only offer timeframes that actually have bars stored for this symbol.
  useEffect(() => {
    if (timeframes || !onTimeframeChange) return;
    let cancelled = false;
    fetch("/api/market/coverage")
      .then((r) => r.json())
      .then((j: { coverage: { symbol: string; timeframe: Timeframe; bars: number }[] }) => {
        if (cancelled) return;
        const mine = (j.coverage ?? []).filter((c) => c.symbol === symbol && c.bars > 0).map((c) => c.timeframe);
        setAvailable(TIMEFRAMES.filter((t) => mine.includes(t)));
      })
      .catch(() => setAvailable(CORE_TIMEFRAMES));
    return () => {
      cancelled = true;
    };
  }, [symbol, timeframes, onTimeframeChange]);

  const switcher = timeframes ?? available ?? CORE_TIMEFRAMES;

  const range = useMemo(() => {
    if (!centerTs) return null;
    const minutes: Record<Timeframe, number> = {
      "1s": 1 / 60, "30s": 0.5,
      "1m": 1, "2m": 2, "3m": 3, "4m": 4, "5m": 5, "15m": 15, "1h": 60, "4h": 240, "1d": 1440, "1w": 10080,
    };
    const span = minutes[timeframe] * 60000 * barsEitherSide;
    return { from: centerTs - span, to: centerTs + span };
  }, [centerTs, timeframe, barsEitherSide]);

  useEffect(() => {
    if (data !== undefined) return; // bars supplied by the caller
    let cancelled = false;
    setCandles(null);
    setError(null);
    const q = new URLSearchParams({ symbol, tf: timeframe, limit: "1500" });
    if (range) {
      q.set("from", String(range.from));
      q.set("to", String(range.to));
    }
    fetch(`/api/candles?${q}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Could not load candles");
        return j;
      })
      .then((j) => {
        if (!cancelled) setCandles(j.candles);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load candles");
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, timeframe, range, data]);

  const bars = data !== undefined ? data : candles;

  // Create the chart once.
  useEffect(() => {
    if (!holder.current || chartRef.current) return;
    const chart = createChart(holder.current, {
      layout: {
        background: { type: ColorType.Solid, color: CHART.background },
        textColor: CHART.text,
        // TradingView's axes sit at 12; a point up keeps them legible beside the larger UI.
        fontSize: 13,
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      rightPriceScale: { borderColor: CHART.border, scaleMargins: { top: 0.1, bottom: 0.08 } },
      timeScale: {
        borderColor: CHART.border,
        rightOffset: 10,
        tickMarkFormatter: (t: Time) => {
          const ms = (t as UTCTimestamp) * 1000;
          if (etAxis.format(ms) !== "00:00") return etAxis.format(ms);
          // The first day of a year gets the year itself, so scrolling across a boundary in
          // historical data says which one you have landed in.
          if (etMonthNum.format(ms) === "1" && etDayNum.format(ms) === "1") return etYear.format(ms);
          return etDate.format(ms);
        },
      },
      localization: {
        timeFormatter: (t: Time) => `${etTime.format((t as UTCTimestamp) * 1000)} ET`,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: CHART.crosshair,
          width: 1,
          style: LineStyle.Dashed,
          labelVisible: true,
          labelBackgroundColor: "#2a2e39",
        },
        horzLine: {
          color: CHART.crosshair,
          width: 1,
          style: LineStyle.Dashed,
          labelVisible: true,
          labelBackgroundColor: "#2a2e39",
        },
      },
      handleScale: { axisPressedMouseMove: { time: true, price: true } },
      autoSize: true,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: CHART.upBody,
      downColor: CHART.downBody,
      borderUpColor: CHART.candleBorder,
      borderDownColor: CHART.candleBorder,
      wickUpColor: CHART.wick,
      wickDownColor: CHART.wick,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    // A new series holds nothing, so the record of what is drawn has to start empty with it.
    // Without this the diff below compares the next update against bars that belonged to the
    // previous series — it reports no change and leaves the new one blank, or worse, appends on
    // top of a series whose last bar is newer than the bar being written.
    drawn.current = [];
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      priceLines.current = [];
      drawn.current = [];
    };
  }, []);

  // Feed data.
  /**
   * The indicator payload, kept current during render.
   *
   * Candles and indicators used to be pushed to the chart by two separate effects — candles first,
   * indicators second. Each push repaints, so every step drew one frame of new candles against the
   * previous frame's indicator geometry before correcting itself. That one bad frame is the flicker
   * you see on the boxes and levels when stepping.
   *
   * Reading the payload here lets the data effect hand both to the chart in the same breath.
   */
  const indicatorPayload = useRef({
    boxes: indicatorBoxes ?? [],
    levels: indicatorLevels ?? [],
    po3: po3 ?? [],
    po3Style: po3Style ?? { color: "#d1d4dc", offset: 13, width: 2 },
    bars: bars ?? [],
    selection: selectionTs ?? null,
  });
  indicatorPayload.current = {
    boxes: indicatorBoxes ?? [],
    levels: indicatorLevels ?? [],
    po3: po3 ?? [],
    po3Style: po3Style ?? { color: "#d1d4dc", offset: 13, width: 2 },
    bars: bars ?? [],
    selection: selectionTs ?? null,
  };

  const indicatorPrimitive = useRef<IndicatorPrimitive | null>(null);
  const fitted = useRef(false);
  /**
   * True while the chart is being updated by us rather than by the user.
   *
   * Appending a candle moves the visible range, which fires the same subscription a pan does. That
   * handler flushes React synchronously to keep the drawing overlay glued to price — the right
   * thing during a pan, and badly wrong here: it forces a synchronous re-render of the entire
   * replay page on every step, which is the flash you see. A self-inflicted range change gets a
   * normal, scheduled update instead.
   */
  const selfUpdate = useRef(false);
  /** Exactly what the series is holding, so the next change can be diffed against it. */
  const drawn = useRef<Candle[]>([]);
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !bars) return;

    // Indicators first, then candles. The candle write triggers the repaint, so the primitive must
    // already be holding geometry for the bars that are about to be drawn.
    indicatorPrimitive.current?.setData(indicatorPayload.current);
    selfUpdate.current = true;

    // Never hand the chart unordered data — it throws rather than recovering.
    const ordered = ensureAscending(bars);
    const point = (c: Candle) => ({
      time: Math.floor(c.ts / 1000) as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    });

    /**
     * Append where possible; replace only where necessary.
     *
     * A replay step changes one candle — the one forming — and sometimes adds one after it.
     * setData rebuilds the entire series for that: every bar re-ingested, the price scale
     * recomputed, the pane repainted from nothing. That is the redraw on every press. update()
     * writes only the bars that actually moved and leaves the rest of the series alone.
     */
    let patch = diffBars(drawn.current, ordered);
    if (patch.kind === "append") {
      try {
        for (let i = patch.from; i < ordered.length; i++) series.update(point(ordered[i]));
      } catch {
        /**
         * update() throws if handed a bar older than the series' last one, and the diff can only
         * reason about the arrays it is given — not about what the series actually holds, which
         * can drift after a remount or a window that moved in a way the comparison did not catch.
         *
         * Rebuilding is always correct; appending is only ever a shortcut past it. So any
         * disagreement resolves to the slow path rather than to a runtime error, which is what
         * this optimisation cost before: stepping a few bars took the whole page down.
         */
        series.setData(ordered.map(point));
        patch = { kind: "replace" };
      }
    } else if (patch.kind === "replace") {
      series.setData(ordered.map(point));
    }
    drawn.current = ordered;

    // Refitting on an append would pull the viewport around on every step. Keeping position is the
    // whole point of appending.
    if (!followCursor && patch.kind === "replace") chartRef.current?.timeScale().fitContent();
    else if (followCursor && !fitted.current && bars.length) {
      chartRef.current?.timeScale().fitContent();
      fitted.current = true;
    }
    // Cleared after the chart has finished reacting to the new data.
    const raf = requestAnimationFrame(() => {
      selfUpdate.current = false;
    });
    return () => cancelAnimationFrame(raf);
  }, [bars, followCursor]);

  // Crosshair readout for the legend.
  const crosshairRef = useRef(onCrosshairBar);
  crosshairRef.current = onCrosshairBar;

  // Clicking a bar (replay uses this to move the cursor).
  const clickRef = useRef(onBarClick);
  clickRef.current = onBarClick;
  /**
   * A click that reaches the chart itself never landed on a drawing — every drawing's hit
   * elements opt back into pointer events and swallow the click before it gets here. So this is
   * exactly the "clicked elsewhere" signal that should drop the current selection, the same way
   * clicking off a shape deselects it on a charting platform.
   */
  const selectedDrawingRef = useRef(selectedDrawingId);
  selectedDrawingRef.current = selectedDrawingId;
  const onSelectDrawingRef = useRef(onSelectDrawing);
  onSelectDrawingRef.current = onSelectDrawing;
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const handler = (param: { time?: Time }) => {
      if (selectedDrawingRef.current) onSelectDrawingRef.current?.(null);
      if (param.time === undefined || !clickRef.current) return;
      clickRef.current((param.time as UTCTimestamp) * 1000);
    };
    chart.subscribeClick(handler);
    return () => chart.unsubscribeClick(handler);
  }, [bars]);

  // Entry and exit markers.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (!markersApi.current) markersApi.current = createSeriesMarkers(series, []);
    markersApi.current.setMarkers(
      markers.map((m) => ({
        time: Math.floor(m.ts / 1000) as UTCTimestamp,
        position: m.position,
        color: m.color,
        shape: m.shape,
        text: m.text,
      })) as SeriesMarker<Time>[]
    );
  }, [markers, bars]);

  // Draw the trade's levels.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const line of priceLines.current) series.removePriceLine(line);
    priceLines.current = levels
      .filter((l) => !l.draggable)
      .map((l) =>
        series.createPriceLine({
          price: l.price,
          color: l.color,
          lineWidth: 1,
          lineStyle: l.dashed ? 2 : 0,
          axisLabelVisible: true,
          title: l.label,
        })
      );
  }, [levels, bars]);

  /* ---------------------- draggable levels (DOM overlay) --------------------- */

  const draggable = useMemo(() => levels.filter((l) => l.draggable && l.id), [levels]);
  const [coords, setCoords] = useState<Record<string, number>>({});
  const [dragging, setDragging] = useState<string | null>(null);
  /** The level whose size is being typed into, and the text so far. */
  const [qtyEdit, setQtyEdit] = useState<{ id: string; value: string } | null>(null);
  const [scaleWidth, setScaleWidth] = useState(60);

  // Positions are recomputed on a frame loop: the price scale can change from autoscaling,
  // panning, zooming or a window resize, and there is no single event that covers all of them.
  useEffect(() => {
    if (!draggable.length) return;
    let raf = 0;
    const tick = () => {
      const series = seriesRef.current;
      const chart = chartRef.current;
      if (series && chart) {
        const next: Record<string, number> = {};
        for (const l of draggable) {
          const y = series.priceToCoordinate(l.price);
          if (y !== null) next[l.id as string] = y;
        }
        setCoords((prev) => {
          const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
          for (const k of keys) if (Math.abs((prev[k] ?? -1) - (next[k] ?? -1)) > 0.5) return next;
          return prev;
        });
        try {
          const w = chart.priceScale("right").width();
          setScaleWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
        } catch {
          /* price scale not ready yet */
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [draggable]);

  /* -------------------------------- ruler --------------------------------- */

  const [rule, setRule] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const rulingRef = useRef(false);

  const measureInfo = useMemo(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!rule || !series || !chart || !bars?.length) return null;
    const p1 = series.coordinateToPrice(rule.y1);
    const p2 = series.coordinateToPrice(rule.y2);
    if (p1 === null || p2 === null) return null;
    const delta = p2 - p1;
    const pct = p1 !== 0 ? (delta / p1) * 100 : 0;
    /**
     * Bars and elapsed time come from the logical scale, not coordinateToTime.
     *
     * That call only answers for an x sitting exactly on a bar, so measuring into the space past
     * the last candle — the most common reason to measure at all, sizing a target — dropped the
     * whole second line of the readout. The logical index interpolates and extrapolates, and the
     * distance between the two ends is the bar count by definition.
     */
    const l1 = chart.timeScale().coordinateToLogical(rule.x1);
    const l2 = chart.timeScale().coordinateToLogical(rule.x2);
    let barCount: number | null = null;
    let minutes: number | null = null;
    if (l1 !== null && l1 !== undefined && l2 !== null && l2 !== undefined) {
      barCount = Math.abs(Math.round((l2 as number) - (l1 as number)));
      const ts1 = timeForLogical(bars, l1 as number);
      const ts2 = timeForLogical(bars, l2 as number);
      if (ts1 !== null && ts2 !== null) minutes = Math.round(Math.abs(ts2 - ts1) / 60000);
    }
    return {
      delta,
      pct,
      barCount,
      minutes,
      /**
       * The move in ticks.
       *
       * Points are what the instrument quotes in and ticks are what you actually trade in — a
       * stop is eight ticks, not two points. Showing both means never doing the division in your
       * head while the idea is still on screen.
       */
      ticks: tickSize && tickSize > 0 ? Math.round(delta / tickSize) : null,
      r: measureRiskPoints && measureRiskPoints > 0 ? delta / measureRiskPoints : null,
      up: delta >= 0,
    };
  }, [rule, bars, measureRiskPoints, tickSize]);

  const beginRule = useCallback(
    (clientX: number, clientY: number, transient: boolean) => {
      const holderEl = holder.current;
      if (!holderEl) return;
      const rect = holderEl.getBoundingClientRect();
      const x1 = clientX - rect.left;
      const y1 = clientY - rect.top;
      rulingRef.current = true;
      setRule({ x1, y1, x2: x1, y2: y1 });

      const move = (ev: PointerEvent) => {
        setRule((r) => (r ? { ...r, x2: ev.clientX - rect.left, y2: ev.clientY - rect.top } : r));
      };
      const up = () => {
        rulingRef.current = false;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        // A shift-drag is a glance, not a tool: it lives only as long as the button is down.
        // The armed ruler instead hands back to the caller, which disarms and clears it.
        if (transient) setRule(null);
        else onMeasureDone?.();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [onMeasureDone]
  );

  const startRule = useCallback(
    (e: React.PointerEvent) => {
      if (!measure) return;
      e.preventDefault();
      beginRule(e.clientX, e.clientY, false);
    },
    [measure, beginRule]
  );

  /**
   * Shift-drag measures anywhere, without arming the ruler first.
   *
   * It listens in the capture phase, and for mousedown specifically, because that is the event
   * the chart itself starts a pan on — catching it before the pane sees it is what keeps the
   * chart still while the measurement is drawn across it. A drawing, or an armed drawing tool,
   * swallows the press in its own overlay before it ever reaches here, so shift keeps meaning
   * "constrain to an axis" there.
   */
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const onDown = (e: MouseEvent) => {
      if (!e.shiftKey || e.button !== 0 || measure || rulingRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      beginRule(e.clientX, e.clientY, true);
    };
    el.addEventListener("mousedown", onDown, true);
    return () => el.removeEventListener("mousedown", onDown, true);
  }, [measure, beginRule]);

  // Clear the ruler when the tool is switched off.
  useEffect(() => {
    if (!measure) setRule(null);
  }, [measure]);

  // Recentre on demand — useful after panning far enough that price has left the screen.
  useEffect(() => {
    if (!resetSignal) return;
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    chart.timeScale().resetTimeScale();
    chart.timeScale().scrollToRealTime();
    series.priceScale().applyOptions({ autoScale: true });
  }, [resetSignal]);

  /**
   * Render the chart to a PNG.
   *
   * takeScreenshot covers the candles and anything drawn as a primitive — which is every
   * indicator. Drawings live in an SVG overlay, so they are serialised and composited on top;
   * otherwise a screenshot would quietly omit the position box marking the trade.
   */
  useEffect(() => {
    if (!captureRef) return;
    captureRef.current = async () => {
      const chart = chartRef.current;
      const el = holder.current;
      if (!chart || !el) return null;
      const base = chart.takeScreenshot(true, false);

      const svg = el.parentElement?.querySelector("svg[data-drawings]") as SVGSVGElement | null;
      if (svg && svg.childNodes.length) {
        try {
          const clone = svg.cloneNode(true) as SVGSVGElement;
          clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
          const markup = new XMLSerializer().serializeToString(clone);
          const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
          await new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => {
              base.getContext("2d")?.drawImage(img, 0, 0);
              URL.revokeObjectURL(url);
              resolve();
            };
            img.onerror = () => {
              URL.revokeObjectURL(url);
              resolve();
            };
            img.src = url;
          });
        } catch {
          /* keep the chart-only screenshot rather than failing the capture */
        }
      }

      return await new Promise<Blob | null>((resolve) => base.toBlob((b) => resolve(b), "image/png"));
    };
    return () => {
      if (captureRef) captureRef.current = null;
    };
  }, [captureRef]);

  /* ------------------------- indicator primitive ------------------------- */

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const primitive = new IndicatorPrimitive();
    indicatorPrimitive.current = primitive;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (series as any).attachPrimitive(primitive);
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      try { (series as any).detachPrimitive?.(primitive); } catch { /* chart already disposed */ }
      indicatorPrimitive.current = null;
    };
  }, []);

  // Still needed for changes that do not touch the bars — toggling an indicator, or moving the
  // replay selection — where the data effect above does not run.
  useEffect(() => {
    indicatorPrimitive.current?.setData(indicatorPayload.current);
  }, [indicatorBoxes, indicatorLevels, po3, po3Style, bars, selectionTs]);

  /* ---------------------- overlay plumbing ---------------------- */

  const [plot, setPlot] = useState({ w: 0, h: 0 });

  /**
   * The projected time under the cursor when it is past the last candle.
   *
   * lightweight-charts only labels the axis where bars exist, so hovering into the empty space to
   * the right — which is most of where you look when you are about to step forward — leaves the
   * axis blank. The time is already known (timeForLogical extrapolates from the bar spacing); this
   * is only about drawing it.
   */
  const [futureTime, setFutureTime] = useState<{ x: number; ts: number } | null>(null);

  /**
   * Panning and zooming move every overlay's pixel position, but React has no idea it happened —
   * the chart redraws itself on its own canvas. Probing the data coordinates of the plot's corner
   * each frame and bumping a version when they move is what keeps drawings and indicators glued
   * to price instead of lagging until the next unrelated re-render.
   */
  const [viewVersion, setViewVersion] = useState(0);
  const viewProbe = useRef({ t: Number.NaN, p: Number.NaN });

  // Panning fires this synchronously as the chart updates. Flushing the drawing overlay here
  // paints it in the same frame as the candles instead of one behind them.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const onRange = () => {
      // Our own data update — schedule the overlay redraw normally. Flushing here would re-render
      // the whole page synchronously for every candle stepped.
      if (selfUpdate.current) {
        setViewVersion((v) => v + 1);
        return;
      }
      try {
        flushSync(() => setViewVersion((v) => v + 1));
      } catch {
        setViewVersion((v) => v + 1);
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
  }, [bars]);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const chart = chartRef.current;
      const series = seriesRef.current;
      if (chart && series) {
        const t = chart.timeScale().coordinateToLogical(0);
        const price = series.coordinateToPrice(0);
        const lt = viewProbe.current.t;
        const lp = viewProbe.current.p;
        const moved =
          (t !== null && t !== undefined && (Number.isNaN(lt) || Math.abs((t as number) - lt) > 1e-4)) ||
          (price !== null && (Number.isNaN(lp) || Math.abs(price - lp) > 1e-9));
        if (moved) {
          viewProbe.current = { t: (t as number) ?? Number.NaN, p: price ?? Number.NaN };
          setViewVersion((v) => v + 1);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      const chart = chartRef.current;
      const el = holder.current;
      if (!chart || !el) return;
      let axis = 26;
      try {
        axis = chart.timeScale().height();
      } catch {
        /* not ready */
      }
      const w = Math.max(0, el.clientWidth - scaleWidth);
      const h = Math.max(0, el.clientHeight - axis);
      setPlot((prev) => (Math.abs(prev.w - w) > 1 || Math.abs(prev.h - h) > 1 ? { w, h } : prev));
    };
    const tick = () => {
      measure();
      raf = requestAnimationFrame(tick);
    };
    /**
     * Measure once directly, not only inside the frame loop.
     *
     * The drawing layer is gated on this width being non-zero, and requestAnimationFrame does not
     * run at all while the tab is hidden — so a chart that first laid out in a background tab had
     * no drawing layer until something brought it forward. Measuring synchronously means the
     * overlay exists as soon as the chart does, and the loop is left to track later changes.
     */
    measure();

    /**
     * And again whenever the element actually gets a size.
     *
     * On the first commit the holder often has no layout yet, so the synchronous measure above
     * reads zero — and with requestAnimationFrame suspended (a hidden tab), nothing ever corrected
     * it and the drawing layer stayed unmounted. A ResizeObserver fires when layout happens,
     * whether or not frames are being painted.
     */
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (observer && holder.current) observer.observe(holder.current);

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [drawings, scaleWidth]);

  /**
   * Conversions go through a fractional bar index rather than the time scale's exact lookup.
   * timeToCoordinate only resolves timestamps that sit on a bar, so anything between candles or
   * to the right of the last one returned null — and a drawing dragged there stopped rendering.
   */
  const barsRef = useRef(bars);
  barsRef.current = bars;

  const converters = useMemo<Converters>(
    () => ({
      priceToY: (price) => seriesRef.current?.priceToCoordinate(price) ?? null,
      yToPrice: (y) => seriesRef.current?.coordinateToPrice(y) ?? null,
      timeToX: (t) => {
        const chart = chartRef.current;
        const list = barsRef.current;
        if (!chart || !list?.length) return null;
        const logical = logicalForTime(list, t);
        if (logical === null) return null;
        /**
         * logicalToCoordinate silently returns 0 for a non-integer index — an anchor's timestamp
         * only lands exactly on a bar of whichever timeframe it was drawn on, so switching to any
         * other timeframe hands this a fractional index and the drawing snaps to the left edge.
         * Interpolating between the coordinates of the two neighbouring integer bars sidesteps
         * that: bar spacing is uniform in pixel space, so the interpolation is exact.
         */
        const ts = chart.timeScale();
        const lo = Math.floor(logical);
        const hi = Math.ceil(logical);
        const cLo = ts.logicalToCoordinate(lo as Logical);
        if (cLo === null) return null;
        if (hi === lo) return cLo;
        const cHi = ts.logicalToCoordinate(hi as Logical);
        if (cHi === null) return cLo;
        return cLo + (cHi - cLo) * (logical - lo);
      },
      xToTime: (x) => {
        const chart = chartRef.current;
        const list = barsRef.current;
        if (!chart || !list?.length) return null;
        const logical = chart.timeScale().coordinateToLogical(x);
        if (logical === null || logical === undefined) return null;
        return timeForLogical(list, logical as number);
      },
    }),
    []
  );

  const snap = useCallback(
    (price: number) => (tickSize > 0 ? Math.round(price / tickSize) * tickSize : price),
    [tickSize]
  );

  const startDrag = useCallback(
    (level: ChartLevel) => (e: React.PointerEvent) => {
      if (!level.id || !onLevelDrag) return;
      e.preventDefault();
      e.stopPropagation();
      const id = level.id;
      setDragging(id);
      const holderEl = holder.current;

      const move = (ev: PointerEvent) => {
        const series = seriesRef.current;
        if (!series || !holderEl) return;
        const rect = holderEl.getBoundingClientRect();
        const raw = series.coordinateToPrice(ev.clientY - rect.top);
        if (raw === null) return;
        let price = snap(raw);
        if (level.min !== undefined) price = Math.max(price, level.min);
        if (level.max !== undefined) price = Math.min(price, level.max);
        onLevelDrag(id, price);
      };
      const up = (ev: PointerEvent) => {
        move(ev);
        setDragging(null);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        const series = seriesRef.current;
        if (series && holderEl && onLevelDragEnd) {
          const rect = holderEl.getBoundingClientRect();
          const raw = series.coordinateToPrice(ev.clientY - rect.top);
          if (raw !== null) {
            let price = snap(raw);
            if (level.min !== undefined) price = Math.max(price, level.min);
            if (level.max !== undefined) price = Math.min(price, level.max);
            onLevelDragEnd(id, price);
          }
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [onLevelDrag, onLevelDragEnd, snap]
  );

  return (
    <div className={fill ? "relative w-full h-full" : "relative w-full"} style={fill ? undefined : { height }}>
      <div
        ref={holder}
        className="absolute inset-0"
        onPointerMove={(e) => {
          if (!crosshairRef.current) return;
          const el = holder.current;
          const chart = chartRef.current;
          const series = seriesRef.current;
          const list = barsRef.current;
          if (!el || !chart || !series) return;
          const rect = el.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const logical = chart.timeScale().coordinateToLogical(x);
          if (logical === null || logical === undefined) {
            crosshairRef.current(null);
            return;
          }
          const ts = timeForLogical(list ?? [], logical as number);
          if (ts === null) {
            crosshairRef.current(null);
            return;
          }
          // A real bar's OHLC rides along only when the pointer is actually over that bar's own
          // slot — past the last candle (or before the first) there is a time but nothing to show.
          const idx = Math.round(logical as number);
          const bar = list && idx >= 0 && idx < list.length && Math.abs((logical as number) - idx) < 0.5 ? list[idx] : null;
          crosshairRef.current({ ts, ...(bar ? { open: bar.open, high: bar.high, low: bar.low, close: bar.close } : {}) });

          // Past the last bar the chart draws no axis label, so one is drawn here instead.
          const lastIdx = (list?.length ?? 0) - 1;
          setFutureTime(list && lastIdx >= 0 && (logical as number) > lastIdx + 0.5 ? { x, ts } : null);
        }}
        onPointerLeave={() => {
          crosshairRef.current?.(null);
          setFutureTime(null);
        }}
        onContextMenu={(e) => {
          if (!onPriceContextMenu) return;
          const el = holder.current;
          const series = seriesRef.current;
          const chart = chartRef.current;
          if (!el || !series || !chart) return;
          const rect = el.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const price = series.coordinateToPrice(y);
          const time = chart.timeScale().coordinateToTime(x);
          if (price === null) return;
          e.preventDefault();
          onPriceContextMenu({
            price,
            ts: time === null || time === undefined ? Date.now() : (time as UTCTimestamp) * 1000,
            x,
            y,
          });
        }}
      />

      {/*
        The projected time, drawn on the axis where the chart itself stops labelling.

        Styled to match lightweight-charts' own crosshair label rather than the app's UI, because
        it stands in for that label — a differently-shaped chip appearing only past the last candle
        would read as a different kind of thing.
      */}
      {futureTime && plot.h > 0 && futureTime.x < plot.w && (
        <div
          className="absolute z-30 pointer-events-none tnum whitespace-nowrap rounded-[2px] px-1.5 py-[3px]"
          style={{
            left: futureTime.x,
            top: plot.h + 2,
            transform: "translateX(-50%)",
            fontSize: 11,
            background: CHART.crosshair,
            color: "#0d0c0c",
            fontWeight: 500,
          }}
        >
          {sameEtDay(futureTime.ts, barsRef.current?.[(barsRef.current?.length ?? 1) - 1]?.ts)
            ? etAxis.format(futureTime.ts)
            : `${etDate.format(futureTime.ts)} ${etAxis.format(futureTime.ts)}`}
        </div>
      )}

      {drawings && onDrawingsChange && plot.w > 0 && (
        <div className="absolute inset-0" style={{ pointerEvents: "none" }}>
          {/*
            The wrapper must not capture pointer events: it covers the whole plot, and swallowing
            mousemove stops the chart drawing its crosshair. The SVG inside re-enables events for
            itself when a tool is armed, and each shape opts in individually — a descendant can
            still receive events under a pointer-events:none ancestor.
          */}
          {/*
            While a drawing tool is armed the SVG has to capture the pointer, which stops the chart
            seeing it — and that is exactly when the crosshair matters most. So the position is fed
            back to the chart, which then draws its own crosshair and axis labels as usual.
          */}
          <div
            className="absolute"
            style={{ left: 0, top: 0, width: plot.w, height: plot.h, pointerEvents: "none" }}
            onPointerMove={(e) => {
              const chart = chartRef.current;
              const series = seriesRef.current;
              const el = holder.current;
              if (!chart || !series || !el) return;
              const rect = el.getBoundingClientRect();
              const price = series.coordinateToPrice(e.clientY - rect.top);
              const logical = chart.timeScale().coordinateToLogical(e.clientX - rect.left);
              if (price === null || logical === null || logical === undefined) return;
              const ts = timeForLogical(barsRef.current ?? [], logical as number);
              if (ts === null) return;
              chart.setCrosshairPosition(price, Math.floor(ts / 1000) as UTCTimestamp, series);
              // Armed tools capture the pointer, so the main hover handler never runs — without
              // this the projected label would vanish exactly while you are placing a drawing out
              // ahead of price, which is when it is most useful.
              const lastIdx = (barsRef.current?.length ?? 0) - 1;
              setFutureTime(lastIdx >= 0 && (logical as number) > lastIdx + 0.5 ? { x: e.clientX - rect.left, ts } : null);
            }}
            onPointerLeave={() => {
              chartRef.current?.clearCrosshairPosition();
              setFutureTime(null);
            }}
          >
            <DrawingLayer
              drawings={drawings}
              onChange={onDrawingsChange}
              tool={tool}
              onToolDone={() => onToolDone?.()}
              converters={converters}
              width={plot.w}
              height={plot.h}
              selectedId={selectedDrawingId}
              onSelect={(id) => onSelectDrawing?.(id)}
              template={drawingTemplate}
              onOpenSettings={onOpenDrawingSettings}
              timeframe={timeframe}
              bars={bars}
              tickSize={tickSize}
              magnet={magnet}
              viewVersion={viewVersion}
            />
          </div>
        </div>
      )}
      {executions && executions.length > 0 && plot.w > 0 && (
        <div className="absolute inset-0" style={{ pointerEvents: "none" }}>
          <ExecutionMarkers marks={executions} converters={converters} width={plot.w} height={plot.h} viewVersion={viewVersion} />
        </div>
      )}
      {(bars === null || error || bars.length === 0) && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface/70 text-center px-4">
          {error ? (
            <p className="text-body text-neg">{error}</p>
          ) : bars === null ? (
            <Spinner label="Loading candles…" />
          ) : (
            <p className="text-body text-ink-3 max-w-[46ch] leading-relaxed">
              {emptyMessage ?? `No ${timeframe} candles stored for ${symbol} in this window. Import them on the Market data page.`}
            </p>
          )}
        </div>
      )}
      {/* risk / reward bands */}
      {draggable.map((l) => {
        const y = coords[l.id as string];
        const yTo = l.zoneTo !== undefined ? seriesRef.current?.priceToCoordinate(l.zoneTo) ?? null : null;
        if (y === undefined || yTo === null || l.zoneTo === undefined) return null;
        const top = Math.min(y, yTo);
        const height = Math.abs(y - yTo);
        return (
          <div
            key={`zone-${l.id}`}
            className="absolute left-0 z-10 pointer-events-none"
            style={{ top, height, right: scaleWidth, background: l.zoneColor ?? "rgba(255,255,255,0.05)" }}
          />
        );
      })}

      {draggable.map((l) => {
        const y = coords[l.id as string];
        if (y === undefined) return null;
        const active = dragging === l.id;
        const editing = qtyEdit && qtyEdit.id === l.id ? qtyEdit : null;
        return (
          <div
            key={l.id}
            className="absolute left-0 z-20"
            style={{ top: y, right: scaleWidth, transform: "translateY(-50%)", height: 0 }}
          >
            <div
              className="absolute inset-x-0"
              style={{
                top: -LEVEL_CHIP.lineWidth / 2,
                borderTop: `${active ? LEVEL_CHIP.lineWidthActive : LEVEL_CHIP.lineWidth}px ${
                  l.dashed ? "dashed" : "solid"
                } ${l.color}`,
                opacity: 1,
              }}
            />
            <div
              onPointerDown={startDrag(l)}
              className="absolute inset-x-0 cursor-ns-resize"
              style={{ top: LEVEL_CHIP.grabOffset, height: LEVEL_CHIP.grabHeight, pointerEvents: "auto" }}
              title={`Drag to move ${l.label.toLowerCase()}`}
            />
            {/*
              * The price, on the axis, in the order's colour.
              *
              * Every platform puts it there, and for the same reason: the axis is where you read
              * price, so an order that only labels itself out in the chart makes you measure it
              * against the ticks by eye. It is drawn rather than handed to the series as a price
              * line because these levels move under the pointer — recreating a chart primitive on
              * every frame of a drag is a repaint of the whole pane per pixel.
              */}
            <div
              className="absolute tnum whitespace-nowrap select-none text-center pointer-events-none"
              style={{
                right: -scaleWidth,
                width: scaleWidth - 2,
                height: LEVEL_CHIP.height,
                top: LEVEL_CHIP.offset,
                lineHeight: `${LEVEL_CHIP.height}px`,
                fontSize: LEVEL_CHIP.fontSize,
                borderRadius: LEVEL_CHIP.radius,
                // Filled, like the axis tag the chart draws for a fixed price line — the two kinds
                // of level sit on the same axis and must not look like two different features.
                background: l.color,
                color: "#0a0a0c",
              }}
            >
              {l.price.toFixed(2)}
            </div>
            {/*
              * The order chip: size, then what the line is, then a way out of it.
              *
              * Three segments rather than a run of text, because they are three different kinds of
              * thing and only the middle one is worth reading twice — the same anatomy a broker's
              * order line has, dividers and all, so it can be read without being learned.
              */}
            <div
              className="absolute flex items-stretch overflow-hidden tnum whitespace-nowrap select-none"
              style={{
                right: 4,
                height: LEVEL_CHIP.height,
                top: LEVEL_CHIP.offset,
                fontSize: LEVEL_CHIP.fontSize,
                borderRadius: LEVEL_CHIP.radius,
                background: LEVEL_CHIP.fill,
                border: `1px solid ${l.color}`,
                // A drop shadow at rest, not only while dragging: the chip sits on top of candles
                // and wicks, and without one it reads as part of the chart rather than over it.
                boxShadow: active
                  ? `0 0 0 1.5px ${l.color}, 0 2px 8px rgba(0,0,0,0.75)`
                  : `0 1px 4px rgba(0,0,0,0.7)`,
                pointerEvents: "auto",
              }}
            >
              {l.qty !== undefined &&
                (editing ? (
                  <input
                    autoFocus
                    value={editing.value}
                    inputMode="numeric"
                    onChange={(e) => setQtyEdit({ id: l.id as string, value: e.target.value.replace(/[^0-9]/g, "") })}
                    onBlur={() => {
                      const next = Number(editing.value);
                      if (Number.isFinite(next) && next > 0) onLevelQty?.(l.id as string, next);
                      setQtyEdit(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      // Escape abandons the edit rather than committing whatever was half-typed.
                      if (e.key === "Escape") setQtyEdit(null);
                      e.stopPropagation();
                    }}
                    className="w-[38px] px-1 text-center outline-none tnum"
                    style={{ background: "transparent", color: l.color, borderRight: `1px solid ${l.color}` }}
                  />
                ) : (
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => l.qtyEditable && setQtyEdit({ id: l.id as string, value: String(l.qty) })}
                    className={`px-1.5 flex items-center ${l.qtyEditable ? "cursor-text" : "cursor-default"}`}
                    style={{ color: l.color, borderRight: `1px solid ${l.color}` }}
                    title={l.qtyEditable ? "Click to change the size" : `${l.qty} contracts`}
                  >
                    {l.qty}
                  </button>
                ))}

              <span
                onPointerDown={startDrag(l)}
                className="px-1.5 flex items-center gap-1.5 cursor-ns-resize"
                style={{ color: l.tagTone === "pos" ? "#e8f5e9" : l.tagTone === "neg" ? "#e5424f" : l.color }}
                title={`Drag to move ${l.label.toLowerCase()}`}
              >
                <span>{l.tag ?? l.label}</span>
                {/* The price only while it is moving — otherwise the axis already says it. */}
                {active && <span className="opacity-85">{l.price.toFixed(2)}</span>}
                {l.note && <span className="opacity-85">{l.note}</span>}
              </span>

              {l.removable && onLevelRemove && (
                <button
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onLevelRemove(l.id as string);
                  }}
                  className="px-1.5 flex items-center text-[12px] leading-none opacity-70 hover:opacity-100 hover:bg-white/10 transition-opacity"
                  style={{ color: l.color, borderLeft: `1px solid ${l.color}` }}
                  title={`Remove ${l.label.toLowerCase()}`}
                >
                  ×
                </button>
              )}
            </div>
          </div>
        );
      })}

      {measure && (
        <div className="absolute inset-0 z-30 cursor-crosshair" onPointerDown={startRule} style={{ pointerEvents: "auto" }} />
      )}

      {rule && measureInfo && (
        <div className="absolute inset-0 z-30 pointer-events-none">
          <div
            className="absolute border"
            style={{
              left: Math.min(rule.x1, rule.x2),
              top: Math.min(rule.y1, rule.y2),
              width: Math.abs(rule.x2 - rule.x1),
              height: Math.abs(rule.y2 - rule.y1),
              background: "rgba(209,212,220,0.10)",
              borderColor: "rgba(209,212,220,0.55)",
            }}
          />
          <div
            className="absolute px-2 py-1 rounded-xs text-caption tnum whitespace-nowrap"
            style={{
              left: Math.min(rule.x1, rule.x2),
              // Clears both lines of the readout rather than the single line it used to be.
              top: Math.min(rule.y1, rule.y2) - 46,
              background: "#1a1819",
              border: "1px solid #2a2e39",
              color: "#e7eaee",
            }}
          >
            {/* Price on the first line, time on the second — the way a ruler is read. */}
            <div>
              {measureInfo.up ? "+" : ""}
              {measureInfo.delta.toFixed(2)}
              {measureInfo.ticks !== null && ` (${measureInfo.ticks >= 0 ? "+" : ""}${measureInfo.ticks} ticks)`}
              {" · "}
              {measureInfo.pct >= 0 ? "+" : ""}
              {measureInfo.pct.toFixed(2)}%
              {measureInfo.r !== null && ` · ${measureInfo.r >= 0 ? "+" : ""}${measureInfo.r.toFixed(2)}R`}
            </div>
            {(measureInfo.barCount !== null || measureInfo.minutes) && (
              <div className="opacity-70">
                {measureInfo.barCount !== null && `${measureInfo.barCount} bars`}
                {measureInfo.barCount !== null && measureInfo.minutes ? ", " : ""}
                {measureInfo.minutes !== null && measureInfo.minutes > 0 && formatSpan(measureInfo.minutes)}
              </div>
            )}
          </div>
        </div>
      )}

      {onTimeframeChange && showTimeframeOverlay && (
        <div className="absolute top-2 left-2 z-10 inline-flex items-center bg-base/90 border border-line rounded-sm p-[2px] h-6">
          {switcher
            .filter((t) => TIMEFRAMES.includes(t))
            .map((t) => (
              <button
                key={t}
                onClick={() => onTimeframeChange(t)}
                className={`px-1.5 h-full rounded-xs text-caption transition-colors ${
                  t === timeframe ? "bg-raised text-ink" : "text-ink-3 hover:text-ink-2"
                }`}
              >
                {t}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
