"use client";

import React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  type AutoscaleInfo,
  type Logical,
  type IRange,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle, Timeframe } from "@/lib/aggregate";
import { timeForLogical, timeToCoordinate, type Drawing } from "@/lib/drawings";
import type { Box, Level, Po3Candle } from "@/lib/indicators";
import { barIndexAt } from "@/lib/trade-frame";
import { CANDLE_LOOK, CHART, chartLook } from "./price-chart";
import { DrawingLayer, type Converters } from "./drawing-layer";
import { IndicatorPrimitive } from "./indicator-primitive";

/** The picture's size in CSS pixels. The canvas comes back at the screen's pixel density on top of that. */
const WIDTH = 1600;
const HEIGHT = 900;

/**
 * Drawings are written in an SVG, and an SVG turned into an image has none of the page's fonts —
 * left alone its text falls back to a serif. Named here so it matches the chart's own lettering.
 */
const FONT = 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

export interface SnapshotTrade {
  direction: "long" | "short";
  entryTs: number;
  exitTs: number;
  entry: number;
  stop: number;
  target: number | null;
  exit: number;
  /** Written on the exit marker, e.g. "+2.0R". */
  result: string;
  win: boolean;
}

export interface SnapshotInput {
  /** Oldest first, ending at the last bar of the frame. Anything before the frame is history for the indicators. */
  bars: Candle[];
  timeframe: Timeframe;
  /** The bars to show, as indices into `bars` — see tradeFrame. */
  frame: { first: number; last: number };
  trade: SnapshotTrade;
  drawings: Drawing[];
  indicators: { boxes: Box[]; levels: Level[]; po3: Po3Candle[]; po3Style: { color: string; offset: number; width: number } };
  tickSize: number;
}

const noop = () => {};

/** An SVG as an image that can be drawn onto a canvas. Null if the browser will not load it. */
function svgImage(svg: SVGSVGElement): Promise<HTMLImageElement | null> {
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml;charset=utf-8" }));
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * A replay trade's screenshot, drawn on a chart of its own.
 *
 * The replay chart only reaches the bar being played, so a picture taken off it can show the
 * run-up to a trade but never what followed. This builds a second chart off screen from the stored
 * candles instead — the same look, indicators and drawings as the one on screen, framed from
 * before the setup to after the exit — takes the picture, and throws the chart away. Nothing about
 * it is ever on screen, so the replay never shows a candle it has not reached.
 *
 * Every step runs straight through rather than waiting on the next frame: a browser stops drawing
 * frames for a window that is minimised or covered, and a picture that waited on one would not be
 * taken until you came back to it.
 */
export async function renderTradeSnapshot(input: SnapshotInput): Promise<Blob | null> {
  const { bars, frame, trade } = input;
  if (!bars.length) return null;

  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:${-WIDTH * 3}px;top:0;width:${WIDTH}px;height:${HEIGHT}px;pointer-events:none;`;
  document.body.appendChild(host);
  const chart = createChart(host, { ...chartLook(), width: WIDTH, height: HEIGHT, autoSize: false, handleScroll: false, handleScale: false });

  try {
    // The trade's own prices are in the picture even where no candle reached them: the stop on a
    // winner, the target on a loser. A target so far off that fitting it would flatten the candles
    // is left out — the position drawing still points at it.
    const planned = [trade.entry, trade.stop, trade.exit];
    const series = chart.addSeries(CandlestickSeries, {
      ...CANDLE_LOOK,
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const res = original();
        if (!res?.priceRange) return res;
        let { minValue, maxValue } = res.priceRange;
        const span = maxValue - minValue;
        const wanted = [...planned];
        if (trade.target !== null && trade.target > minValue - span / 2 && trade.target < maxValue + span / 2) wanted.push(trade.target);
        for (const p of wanted) {
          minValue = Math.min(minValue, p);
          maxValue = Math.max(maxValue, p);
        }
        return { ...res, priceRange: { minValue, maxValue } };
      },
    });
    series.setData(bars.map((b) => ({ time: Math.floor(b.ts / 1000) as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close })));

    // Indicators at full strength from the start; a fade-in would be caught halfway.
    const primitive = new IndicatorPrimitive({ animate: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (series as any).attachPrimitive(primitive);
    primitive.setData({ ...input.indicators, bars, selection: null, drawings: input.drawings, timeframe: input.timeframe });

    // The same entry arrow and exit dot as the replay chart, placed on the bars they happened in.
    const barTime = (ts: number) => Math.floor(bars[Math.max(0, barIndexAt(bars, ts))].ts / 1000) as UTCTimestamp;
    const long = trade.direction === "long";
    createSeriesMarkers(series, [
      { time: barTime(trade.entryTs), position: long ? "belowBar" : "aboveBar", color: CHART.markerNeutral, shape: long ? "arrowUp" : "arrowDown" },
      {
        time: barTime(trade.exitTs),
        position: long ? "aboveBar" : "belowBar",
        color: trade.win ? CHART.markerBright : CHART.markerNeutral,
        shape: "circle",
        text: trade.result,
      },
    ]);

    // PO3 candles are drawn against the right edge of the pane, so leave them room clear of the
    // bars after the exit.
    const { po3, po3Style } = input.indicators;
    const po3Room = po3.length ? po3Style.offset + po3.length * (po3Style.width + 1) : 0;
    chart.timeScale().setVisibleLogicalRange({ from: frame.first - 0.5, to: frame.last + 2 + po3Room } as IRange<Logical>);

    // The first picture settles the scales, which the drawings need in order to be placed.
    const canvas = chart.takeScreenshot(true, false);
    const pane = chart.paneSize();
    const converters: Converters = {
      priceToY: (price) => series.priceToCoordinate(price),
      yToPrice: (y) => series.coordinateToPrice(y),
      timeToX: (t) => timeToCoordinate(chart.timeScale(), bars, t),
      xToTime: (x) => {
        const logical = chart.timeScale().coordinateToLogical(x);
        return logical === null ? null : timeForLogical(bars, logical as number);
      },
    };

    const holder = document.createElement("div");
    const drawings = createRoot(holder);
    try {
      flushSync(() =>
        drawings.render(
          <DrawingLayer
            drawings={input.drawings}
            onChange={noop}
            tool={null}
            onToolDone={noop}
            converters={converters}
            width={pane.width}
            height={pane.height}
            selectedId={null}
            onSelect={noop}
            timeframe={input.timeframe}
            bars={bars}
            tickSize={input.tickSize}
          />
        )
      );
      const svg = holder.querySelector("svg[data-drawings]") as SVGSVGElement | null;
      if (svg) {
        const clone = svg.cloneNode(true) as SVGSVGElement;
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        clone.setAttribute("font-family", FONT);
        // The drawings only, not the parts of the overlay that are there to work the chart.
        clone.querySelectorAll("[data-ui]").forEach((n) => n.remove());
        const img = await svgImage(clone);
        // The canvas is at the screen's pixel density and the drawings were laid out in CSS
        // pixels, so they are scaled up to meet it — drawn as they came, on a Retina screen they
        // landed at half size in the top-left corner of the picture.
        const scale = canvas.width / WIDTH;
        if (img) canvas.getContext("2d")?.drawImage(img, 0, 0, pane.width * scale, pane.height * scale);
      }
    } finally {
      drawings.unmount();
    }

    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
  } finally {
    chart.remove();
    host.remove();
  }
}
