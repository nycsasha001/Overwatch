"use client";

import React, { useMemo } from "react";
import type { Converters } from "./drawing-layer";
import { CHART } from "./price-chart";

/** A single order fill: an entry into a position, or an exit out of one. */
export interface ExecutionMark {
  ts: number;
  price: number;
  qty: number;
  direction: "long" | "short";
  kind: "entry" | "exit";
}

/**
 * TradingView-style fill markers: a coloured arrow tethered to the exact fill point by a dashed
 * leader line, with the size and price floating on the line. Blue for a long, red for a short —
 * an exit uses the same colour as its entry (it is still the same trade) but points the opposite
 * way, since closing is the mirror of opening.
 */
export function ExecutionMarkers({
  marks,
  converters,
  width,
  height,
  viewVersion = 0,
}: {
  marks: ExecutionMark[];
  converters: Converters;
  width: number;
  height: number;
  viewVersion?: number;
}) {
  const glyphs = useMemo(
    () =>
      marks
        .map((m, i) => {
          const px = converters.timeToX(m.ts);
          const py = converters.priceToY(m.price);
          if (px === null || py === null) return null;
          if (px < -20 || px > width + 20) return null;
          return { key: `${m.ts}-${m.kind}-${i}`, px, py, mark: m };
        })
        .filter((g): g is { key: string; px: number; py: number; mark: ExecutionMark } => g !== null),
    // viewVersion is a redraw trigger: pan/zoom moves every pixel position without changing marks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [marks, converters, width, viewVersion]
  );

  if (!glyphs.length) return null;

  return (
    <svg width={width} height={height} className="absolute inset-0 z-10" style={{ pointerEvents: "none" }}>
      {glyphs.map(({ key, px, py, mark }) => (
        <ExecutionGlyph key={key} px={px} anchorY={py} mark={mark} />
      ))}
    </svg>
  );
}

const ARROW_H = 9;
const TRI_H = 6;
const STEM_HW = 1.3;
const TRI_HW = 4;
const GAP1 = 3;
const TEXT_H = 12;
const GAP2 = 4;
const TOTAL = ARROW_H + GAP1 + TEXT_H + GAP2;

function ExecutionGlyph({ px, anchorY, mark }: { px: number; anchorY: number; mark: ExecutionMark }) {
  const color = mark.direction === "long" ? CHART.executionLong : CHART.executionShort;
  // Entry points the way the position opened (buy = up, sell = down); an exit is the mirror of
  // its own entry, since closing a long sells it and closing a short buys it back.
  const opens = (mark.direction === "long") === (mark.kind === "entry");
  const s = opens ? -1 : 1; // -1: arrow above the fill, points up. +1: below, points down.

  const apexY = anchorY + s * TOTAL;
  const triBaseY = apexY + s * TRI_H;
  const stemEndY = apexY + s * ARROW_H;
  const textCenterY = anchorY + s * (GAP2 + TEXT_H / 2);

  const arrowPath = `M ${px} ${apexY} L ${px + TRI_HW} ${triBaseY} L ${px + STEM_HW} ${triBaseY} L ${
    px + STEM_HW
  } ${stemEndY} L ${px - STEM_HW} ${stemEndY} L ${px - STEM_HW} ${triBaseY} L ${px - TRI_HW} ${triBaseY} Z`;

  const priceText = mark.price.toFixed(2);

  return (
    <g style={{ pointerEvents: "none" }}>
      <line x1={px} y1={anchorY} x2={px} y2={apexY} stroke={CHART.markerBright} strokeWidth={1} strokeDasharray="1 3" opacity={0.55} />
      <text x={px} y={textCenterY} textAnchor="middle" dominantBaseline="middle" fontSize={10.5} fill={CHART.text} className="tnum">
        {mark.qty} @ {priceText}
      </text>
      <path d={arrowPath} fill={color} />
    </g>
  );
}
