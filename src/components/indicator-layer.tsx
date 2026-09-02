"use client";

import React, { useMemo } from "react";
import type { Converters } from "./drawing-layer";
import { clampSpan } from "@/lib/drawings";
import type { Box, Level, Po3Candle } from "@/lib/indicators";

/** Read-only overlay: indicators are drawn above the candles but never take pointer events. */
export function IndicatorLayer({
  boxes,
  levels,
  po3,
  converters,
  width,
  height,
  po3Color,
  po3Offset,
  po3Width,
  barSpacing,
  viewVersion = 0,
}: {
  boxes: Box[];
  levels: Level[];
  po3: Po3Candle[];
  converters: Converters;
  width: number;
  height: number;
  po3Color: string;
  po3Offset: number;
  po3Width: number;
  barSpacing: number;
  /** Changes whenever the chart is panned or zoomed, forcing a redraw at the new coordinates. */
  viewVersion?: number;
}) {
  const shapes = useMemo(() => {
    const out: React.ReactNode[] = [];

    for (const [i, b] of boxes.entries()) {
      const x1 = converters.timeToX(b.from);
      const yTop = converters.priceToY(b.top);
      const yBottom = converters.priceToY(b.bottom);
      if (x1 === null || yTop === null || yBottom === null) continue;
      const x2 = b.to === Infinity ? width : converters.timeToX(b.to) ?? width;
      const { x, w } = clampSpan(x1, x2, width);
      if (w <= 0) continue;
      const boxTop = Math.min(yTop, yBottom);
      const boxHeight = Math.abs(yBottom - yTop);
      const pos = b.labelPosition ?? "right";
      const labelX = pos === "center" ? x + w / 2 : pos === "left" ? x + 4 : x + w - 4;
      const anchor = pos === "center" ? "middle" : pos === "left" ? "start" : "end";
      out.push(
        <g key={`b${i}`}>
          <rect x={x} y={boxTop} width={w} height={boxHeight} fill={b.color} />
          {b.midline && boxHeight > 5 && (
            <line
              x1={x}
              x2={x + w}
              y1={boxTop + boxHeight / 2}
              y2={boxTop + boxHeight / 2}
              stroke="#ffffff"
              strokeWidth={0.8}
              strokeDasharray="4 4"
              opacity={0.3}
            />
          )}
          {b.label && pos !== "hidden" && boxHeight > 9 && (
            <text
              x={labelX}
              y={pos === "center" ? boxTop + boxHeight / 2 - 3 : boxTop + 9}
              fontSize={9}
              fill="#9598a1"
              textAnchor={anchor}
              opacity={0.85}
            >
              {b.label}
            </text>
          )}
        </g>
      );
    }

    for (const [i, l] of levels.entries()) {
      const y = converters.priceToY(l.price);
      const x1 = converters.timeToX(l.from);
      if (y === null || x1 === null) continue;
      const x2 = l.to === Infinity ? width : converters.timeToX(l.to) ?? width;
      const { x, w } = clampSpan(x1, x2, width);
      if (w <= 0) continue;
      out.push(
        <g key={`l${i}`} opacity={l.swept ? 0.4 : 1}>
          <line x1={x} x2={x + w} y1={y} y2={y} stroke={l.color} strokeWidth={1} strokeDasharray={l.dashed ? "4 3" : undefined} />
          {l.label && (
            <text x={x + 4} y={y - 3} fontSize={9} fill={l.color} opacity={0.9}>
              {l.label}
            </text>
          )}
        </g>
      );
    }

    // Power of three: the higher-timeframe candles projected to the right of live price.
    if (po3.length) {
      const slot = Math.max(barSpacing * po3Width, 6);
      const gap = Math.max(barSpacing, 3);
      const startX = width - (po3.length * (slot + gap) + barSpacing * po3Offset);
      po3.forEach((c, i) => {
        const yO = converters.priceToY(c.open);
        const yH = converters.priceToY(c.high);
        const yL = converters.priceToY(c.low);
        const yC = converters.priceToY(c.close);
        if (yO === null || yH === null || yL === null || yC === null) return;
        const x = startX + i * (slot + gap);
        const mid = x + slot / 2;
        const up = c.close >= c.open;
        out.push(
          <g key={`p${i}`} opacity={c.complete ? 0.9 : 1}>
            <line x1={mid} x2={mid} y1={yH} y2={yL} stroke="#ffffff" strokeWidth={1} />
            <rect
              x={x}
              y={Math.min(yO, yC)}
              width={slot}
              height={Math.max(Math.abs(yC - yO), 1)}
              fill={up ? po3Color : "#000000"}
              stroke={po3Color}
              strokeWidth={1}
              strokeDasharray={c.complete ? undefined : "3 2"}
            />
          </g>
        );
      });
    }

    return out;
  }, [boxes, levels, po3, converters, width, po3Color, po3Offset, po3Width, barSpacing, viewVersion]);

  return (
    <svg width={width} height={height} className="absolute inset-0 z-10" style={{ pointerEvents: "none" }}>
      {shapes}
    </svg>
  );
}
